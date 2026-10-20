const assert = require('assert/strict')

const storage = new Map()
let readFailureKey = ''
let writeFailureKey = ''

function clone(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
}

global.wx = {
  getStorageSync(key) {
    if (key === readFailureKey) throw new Error('simulated read failure')
    return clone(storage.get(key))
  },
  setStorageSync(key, value) {
    if (key === writeFailureKey) throw new Error('simulated write failure')
    storage.set(key, clone(value))
  },
  removeStorageSync(key) {
    if (key === writeFailureKey) throw new Error('simulated removal failure')
    storage.delete(key)
  },
}

const PROJECTS_KEY = 'audioTool.projects.v1'
const RECORDS_KEY = 'audioTool.records.v1'
const ACTIVE_KEY = 'audioTool.activeProject.v1'
const SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const baseLine = {
  purpose: '主扩', fromDevice: '调音台', fromPort: 'L', toDevice: '功放', toPort: 'CH1',
  buildType: 'finished', cableType: 'balanced', spec: '双芯屏蔽', connectorA: 'xlrFemale',
  connectorB: 'xlrMale', lengthText: '8', status: 'checked', notes: '',
}

function freshRecords() {
  delete require.cache[require.resolve('../utils/records')]
  return require('../utils/records')
}

function project(id, name, extras = {}) {
  return {
    id, name, venueName: `${name} 场地`, engineer: '工程师', projectDate: '2026-09-20',
    notes: `${name} note`, roomLengthText: '12', roomWidthText: '8', roomHeightText: '4',
    standardClassKey: 'conference', gradeKey: 'II', createdAt: 1, updatedAt: 100,
    ...extras,
  }
}

function reset(projects) {
  storage.clear()
  storage.set(PROJECTS_KEY, clone(projects))
  // A storage-valid historical row; malformed-row refusal has its own adversarial tests.
  storage.set(RECORDS_KEY, [{ id: 'record-1', module: 'limiter', preferences: { model: 'reference' }, resultText: 'saved limiter result', favorite: true, projectIds: ['p1'], createdAt: 1, updatedAt: 2 }])
  storage.set(ACTIVE_KEY, 'p2')
  storage.set(SCHEMA_KEY, 3)
  readFailureKey = ''
  writeFailureKey = ''
  return freshRecords()
}

let records = reset([project('p1', 'A 项目'), project('p2', 'B 项目')])
const originalProjects = clone(storage.get(PROJECTS_KEY))
const originalRecords = clone(storage.get(RECORDS_KEY))
const empty = records.getProjectWiring('p1')
assert.equal(empty.ok, true)
assert.deepEqual(empty.schedule, { version: 1, revision: 0, nextNumber: 1, lines: [] })
assert.deepEqual(storage.get(PROJECTS_KEY), originalProjects, '读取旧项目不能自动持久化空schedule')

let saved = records.saveProjectWiring('p1', { type: 'upsert', line: baseLine }, 0)
assert.equal(saved.ok, true, saved.error)
assert.equal(saved.schedule.lines[0].code, 'A001')
const storedProjects = storage.get(PROJECTS_KEY)
assert.equal(storedProjects.find((item) => item.id === 'p1').wiringSchedule.revision, 1)
assert.equal(storedProjects.find((item) => item.id === 'p2').wiringSchedule, undefined)
assert.equal(storedProjects.find((item) => item.id === 'p1').venueName, 'A 项目 场地')
assert.equal(storedProjects.find((item) => item.id === 'p1').roomLengthText, '12')
assert.ok(storedProjects.find((item) => item.id === 'p1').updatedAt > 100)
assert.deepEqual(storage.get(RECORDS_KEY), originalRecords, '布线保存不写历史记录')
assert.equal(storage.get(ACTIVE_KEY), 'p2', '布线保存不看写入或变更 active project')
assert.equal(storage.get(SCHEMA_KEY), 3, '布线不引入新的schema版本')
assert.equal(Object.hasOwn(records.MODULES, 'projectWiring'), false)

const stale = records.saveProjectWiring('p1', { type: 'upsert', line: { ...baseLine, purpose: '旧视图' } }, 0)
assert.equal(stale.ok, false)
assert.match(stale.error, /其他页面更新/)
assert.equal(storage.get(PROJECTS_KEY).find((item) => item.id === 'p1').wiringSchedule.revision, 1)

const update = records.updateProject('p1', { venueName: '改过的场地' })
assert.equal(update.venueName, '改过的场地')
assert.equal(update.wiringSchedule.revision, 1, 'updateProject保留布线字段')

records = reset([project('p1', 'A 项目'), project('p2', 'B 项目')])
saved = records.saveProjectWiring('p1', { type: 'upsert', line: baseLine }, 0)
const projectBeforeFailure = clone(storage.get(PROJECTS_KEY))
writeFailureKey = PROJECTS_KEY
const writeFailure = records.saveProjectWiring('p1', { type: 'upsert', line: baseLine }, 1)
assert.equal(writeFailure.ok, false)
assert.match(writeFailure.error, /保存项目布线失败/)
assert.deepEqual(storage.get(PROJECTS_KEY), projectBeforeFailure, '写入失败不得改项目或updatedAt')
writeFailureKey = ''
assert.equal(records.getProjectWiring('p1').schedule.revision, 1)

readFailureKey = PROJECTS_KEY
const readFailure = records.getProjectWiring('p1')
assert.equal(readFailure.ok, false)
assert.match(readFailure.error, /读取项目布线失败/)
const failedReadSave = records.saveProjectWiring('p1', { type: 'upsert', line: baseLine }, 1)
assert.equal(failedReadSave.ok, false)
assert.deepEqual(storage.get(PROJECTS_KEY), projectBeforeFailure, '读取失败后不能使用缓存盲写')
readFailureKey = ''

records = reset([project('p1', 'A 项目')])
storage.set(RECORDS_KEY, [{
  id: 'saved-record', module: 'limiter', preferences: { model: 'reference' }, resultText: 'limit result',
  favorite: true, projectIds: ['p1'], createdAt: 1, updatedAt: 2,
}])
let workspace = records.getWorkspaceSnapshot()
assert.equal(workspace.ok, true)
assert.equal(workspace.projects[0].id, 'p1')
assert.equal(workspace.records[0].id, 'saved-record')

readFailureKey = PROJECTS_KEY
workspace = records.getWorkspaceSnapshot({ forceRefresh: true })
assert.equal(workspace.ok, false)
assert.match(workspace.error, /读取失败|已阻止写入/)
assert.equal(workspace.projects[0].id, 'p1', 'force refresh failure preserves last successful project snapshot')
assert.equal(workspace.records[0].id, 'saved-record', 'partial read failure preserves last successful records')
const beforeBlockedCreate = clone(storage.get(PROJECTS_KEY))
assert.equal(records.createProject('不应创建'), null, 'mutations refuse a failed storage read')
assert.deepEqual(storage.get(PROJECTS_KEY), beforeBlockedCreate, 'failed snapshot cannot overwrite project storage')
readFailureKey = ''

records = reset([project('p1', 'A 项目')])
// Exercise a real empty result collection after a transient read failure.
storage.set(RECORDS_KEY, [])
readFailureKey = RECORDS_KEY
workspace = records.getWorkspaceSnapshot({ forceRefresh: true })
assert.equal(workspace.ok, false)
readFailureKey = ''
workspace = records.getWorkspaceSnapshot()
assert.equal(workspace.ok, true, 'failed empty fallback is not cached as a successful read')
assert.deepEqual(workspace.records, [], 'recovered empty storage remains a real empty state')

records = reset([project('p1', 'A 项目', { wiringSchedule: { version: 999, revision: 0, nextNumber: 1, lines: [] } })])
const unknownVersion = records.getProjectWiring('p1')
assert.equal(unknownVersion.ok, false)
assert.equal(unknownVersion.schedule, null)
assert.match(unknownVersion.error, /版本异常/)
const unknownBefore = clone(storage.get(PROJECTS_KEY))
assert.equal(records.saveProjectWiring('p1', { type: 'upsert', line: baseLine }, 0).ok, false)
assert.deepEqual(storage.get(PROJECTS_KEY), unknownBefore, '未知版本不得被空schedule覆盖')

for (const malformedSchedule of [
  { version: 1, revision: 0, nextNumber: 1 },
  { version: 1, revision: -1, nextNumber: 1, lines: [] },
  { version: 1, revision: 0, nextNumber: 1, lines: [{ ...baseLine, id: 'x', code: 'A001', fromDevice: 'x'.repeat(101) }] },
  { version: 1, revision: 0, nextNumber: 1, lines: [{ ...baseLine, id: 'x', code: 'A001', purpose: 'x'.repeat(101) }] },
  { version: 1, revision: 0, nextNumber: 1, lines: [{ ...baseLine, id: 'x', code: 'A001', lengthText: 8 }] },
  { version: 1, revision: 0, nextNumber: 1, lines: [{ ...baseLine, id: 'x', code: 'A001', notes: ' padded ' }] },
  { version: 1, revision: 0, nextNumber: 1, lines: [{ ...baseLine, id: 'x', code: 'A001', extraData: 'preserve me?' }] },
  { version: 1, revision: 0, nextNumber: 1, lines: [
    { ...baseLine, id: 'x', code: 'A001' }, { ...baseLine, id: 'y', code: 'a001' },
  ] },
]) {
  records = reset([project('p1', 'A 项目', { wiringSchedule: malformedSchedule })])
  const malformed = records.getProjectWiring('p1')
  assert.equal(malformed.ok, false)
  assert.match(malformed.error, /格式或版本异常/)
  const before = clone(storage.get(PROJECTS_KEY))
  assert.equal(records.saveProjectWiring('p1', { type: 'delete', id: 'x' }, 0).ok, false)
  assert.deepEqual(storage.get(PROJECTS_KEY), before)
}

records = reset([project('p1', 'A 项目'), project('p2', 'B 项目')])
const crossProject = records.saveProjectWiring('p2', { type: 'upsert', line: baseLine }, 0)
assert.equal(crossProject.ok, true)
assert.equal(records.getProjectWiring('p1').schedule.lines.length, 0)
assert.equal(records.getProjectWiring('p2').schedule.lines[0].code, 'A001')
records.deleteProject('p2')
const noResurrection = records.saveProjectWiring('p2', { type: 'delete', id: crossProject.schedule.lines[0].id }, 1)
assert.equal(noResurrection.ok, false)
assert.match(noResurrection.error, /不存在或已删除/)
assert.equal(storage.get(PROJECTS_KEY).some((item) => item.id === 'p2'), false)

console.log('project wiring storage test passed')

const assert = require('assert/strict')
const wiring = require('../utils/project-wiring')

const clone = (value) => JSON.parse(JSON.stringify(value))
const baseLine = {
  purpose: '保留用途', fromDevice: '调音台', fromPort: 'MAIN L', toDevice: '音箱', toPort: 'IN 1',
  buildType: 'bulk', cableType: 'custom', spec: '', connectorA: '', connectorB: '',
  lengthText: '', status: 'checked', notes: '保留备注',
}
function change(schedule, command) {
  const before = clone(schedule)
  const result = wiring.applyScheduleChange(schedule, command)
  assert.deepEqual(schedule, before, '命令不能原地修改调用者持有的数据')
  assert.equal(result.ok, true, result.error)
  return result
}
function failsWithoutChange(schedule, command) {
  const result = wiring.applyScheduleChange(schedule, command)
  assert.equal(result.ok, false)
  assert.deepEqual(result.schedule, schedule, '失败命令必须回滚整批资料及版本')
  return result
}

const empty = { version: 1, revision: 0, nextNumber: 1, lines: [] }
assert.deepEqual(wiring.emptySchedule(), empty)
assert.deepEqual(wiring.normalizeSchedule(empty), empty)
const legacy = change(empty, { type: 'upsert', line: baseLine }).schedule
assert.equal(Object.hasOwn(legacy, 'devices'), false)
assert.equal(Object.hasOwn(legacy.lines[0], 'fromDeviceId'), false)
assert.deepEqual(wiring.normalizeSchedule(legacy), legacy, '旧资料规范化形状不变')

const added = change(legacy, {
  type: 'add-devices', devices: [
    { type: 'mixer', name: '调音台' }, { type: 'mixer', name: '调音台' }, { type: 'speaker', name: '音箱' },
  ],
})
const devices = added.schedule.devices
assert.equal(added.schedule.revision, legacy.revision + 1)
assert.equal(added.schedule.nextNumber, legacy.nextNumber)
assert.deepEqual(added.schedule.lines, legacy.lines, '新增设备不迁移旧线或自动按名称绑定')
assert.deepEqual(added.deviceIds, devices.map((device) => device.id))
assert.notEqual(devices[0].id, devices[1].id, '同名设备必须是独立实例')
assert.deepEqual(devices.map((device) => device.name), ['调音台', '调音台', '音箱'])
assert.deepEqual(wiring.DEVICE_OPTIONS.map((option) => option.id),
  ['receiver', 'mixer', 'processor', 'amplifier', 'speaker', 'custom'])
for (const invalidDevices of [[], Array(33).fill({ type: 'custom', name: '设备' }),
  [{ type: 'mixer', name: '可用' }, { type: 'unknown', name: '不保存' }],
  [{ type: 'custom', name: ' ' }], [{ type: 'custom', name: 'x'.repeat(101) }],
  [{ type: 'custom', name: '设备', ports: ['IN1'] }]]) {
  failsWithoutChange(added.schedule, { type: 'add-devices', devices: invalidDevices })
}

const endpointLine = (index, extras = {}) => ({
  ...baseLine, fromDeviceId: devices[index].id, toDeviceId: devices[2].id, ...extras,
})
const appended = change(added.schedule, { type: 'append-lines', lines: [
  endpointLine(0, { fromPort: 'AUX L', toPort: 'LEFT', lengthText: '08.00' }),
  endpointLine(1, { fromPort: '输出-B', toPort: '右声道', lengthText: '' }),
  endpointLine(0, { fromPort: 'USB return', toPort: '备份 X', lengthText: '3.25' }),
] })
const schedule = appended.schedule
assert.equal(schedule.revision, added.schedule.revision + 1, '任意端口批次仅递增一次版本')
assert.equal(schedule.nextNumber, legacy.nextNumber + 3)
assert.deepEqual(schedule.lines.slice(1).map((line) => line.code), ['A002', 'A003', 'A004'])
assert.deepEqual(schedule.lines.slice(1).map((line) => line.fromPort), ['AUX L', '输出-B', 'USB return'])
assert.deepEqual(schedule.lines.slice(1).map((line) => line.lengthText), ['8', '', '3.25'])
assert.deepEqual(appended.lineIds, schedule.lines.slice(1).map((line) => line.id))
assert.deepEqual(schedule.devices, devices)
assert.notEqual(schedule.lines[1].fromDeviceId, schedule.lines[2].fromDeviceId)
assert.equal(wiring.buildMaterialSummary(schedule).knownLengthText, '11.25 m')
assert.deepEqual(schedule.lines[0], legacy.lines[0])

const edited = change(schedule, { type: 'upsert', line: { id: schedule.lines[1].id, fromPort: 'AUX R' } }).schedule
assert.deepEqual(edited.devices, devices)
assert.deepEqual(edited.lines[1], { ...schedule.lines[1], fromPort: 'AUX R' }, '局部编辑保留ID、线号和全部旧字段')
const clearCommand = clone({ type: 'upsert', line: {
  id: schedule.lines[1].id, fromDevice: '历史设备', fromDeviceId: null,
} })
const cleared = change(schedule, clearCommand).schedule
const expectedClearedLine = { ...schedule.lines[1], fromDevice: '历史设备' }
delete expectedClearedLine.fromDeviceId
assert.deepEqual(cleared.lines[1], expectedClearedLine, 'JSON往返的null仅清除指定绑定，保留隐藏字段及其他端点')
assert.equal(cleared.nextNumber, schedule.nextNumber)
assert.equal(cleared.revision, schedule.revision + 1)
const unboundAppend = change(added.schedule, clone({ type: 'append-lines', lines: [
  { ...baseLine, fromDeviceId: null, toDeviceId: null }, endpointLine(0, { toDeviceId: null }),
] })).schedule
assert.deepEqual(unboundAppend.lines[1], { ...baseLine, id: unboundAppend.lines[1].id, code: 'A002' })
assert.equal(Object.hasOwn(unboundAppend.lines[2], 'toDeviceId'), false)
assert.equal(unboundAppend.lines[2].fromDeviceId, devices[0].id)
assert.equal(unboundAppend.revision, added.schedule.revision + 1)
const removed = change(edited, { type: 'delete', id: edited.lines[1].id }).schedule
assert.deepEqual(removed.devices, devices)
assert.equal(removed.nextNumber, schedule.nextNumber)
assert.deepEqual(removed.lines.map((line) => line.code), ['A001', 'A003', 'A004'])
const afterDelete = change(removed, { type: 'append-lines', lines: [endpointLine(1)] }).schedule
assert.equal(afterDelete.lines.at(-1).code, 'A005', '新命令不回收已删线号')
const duplicated = change(schedule, { type: 'duplicate', id: schedule.lines[1].id }).schedule
assert.deepEqual(duplicated.devices, devices)
assert.equal(duplicated.lines.at(-1).fromDeviceId, devices[0].id)
assert.equal(duplicated.lines.at(-1).status, 'pending')

for (const invalidLines of [[], Array(33).fill(endpointLine(0)),
  [endpointLine(0), endpointLine(1, { lengthText: '0' })],
  [endpointLine(0), endpointLine(1, { toDeviceId: 'missing' })],
  [endpointLine(0), endpointLine(1, { fromDeviceId: 7 })],
  [endpointLine(0), endpointLine(1, { id: schedule.lines[0].id })]]) {
  failsWithoutChange(schedule, { type: 'append-lines', lines: invalidLines })
}
failsWithoutChange(legacy, { type: 'upsert', line: { ...baseLine, fromDeviceId: devices[0].id } })
failsWithoutChange(schedule, { type: 'upsert', line: { id: schedule.lines[1].id, toDeviceId: 'missing' } })
failsWithoutChange(schedule, { type: 'batch', line: endpointLine(0, { toDeviceId: 'missing' }), count: 2,
  fromPrefix: 'OUT', fromStart: 1, toPrefix: 'IN', toStart: 1 })
const nearRevisionLimit = { ...added.schedule, revision: Number.MAX_SAFE_INTEGER - 1 }
assert.equal(change(nearRevisionLimit, { type: 'append-lines', lines: [endpointLine(0), endpointLine(1)] })
  .schedule.revision, Number.MAX_SAFE_INTEGER, '内部验证不额外消耗版本号')

const previousWx = global.wx
const storage = new Map()
let readFailureKey = ''
let writeFailureKey = ''
let writes = []
global.wx = {
  getStorageSync(key) {
    if (key === readFailureKey) throw new Error('read failure')
    return storage.has(key) ? clone(storage.get(key)) : undefined
  },
  setStorageSync(key, value) {
    if (key === writeFailureKey) throw new Error('write failure')
    writes.push(key)
    storage.set(key, clone(value))
  },
}
const PROJECTS_KEY = 'audioTool.projects.v1'
function freshRecords() {
  delete require.cache[require.resolve('../utils/records')]
  return require('../utils/records')
}
function reset(storedSchedule = legacy) {
  storage.clear()
  storage.set(PROJECTS_KEY, [
    { id: 'p1', name: '工程', createdAt: 1, updatedAt: 2, wiringSchedule: clone(storedSchedule), customData: '保留' },
    { id: 'p2', name: '其他工程', createdAt: 1, updatedAt: 2 },
  ])
  storage.set('audioTool.records.v1', [])
  storage.set('audioTool.activeProject.v1', 'p2')
  storage.set('audioTool.storageSchemaVersion', 3)
  readFailureKey = ''
  writeFailureKey = ''
  writes = []
  return freshRecords()
}
try {
  let records = reset()
  const beforeRead = clone(storage.get(PROJECTS_KEY))
  assert.deepEqual(records.getProjectWiring('p1').schedule, legacy)
  assert.deepEqual(storage.get(PROJECTS_KEY), beforeRead)
  assert.deepEqual(writes, [], '读取不迁移或写入旧资料')
  const savedDevices = records.saveProjectWiring('p1', { type: 'add-devices', devices: [
    { type: 'receiver', name: '设备' }, { type: 'receiver', name: '设备' },
  ] }, legacy.revision)
  assert.equal(savedDevices.ok, true, savedDevices.error)
  assert.equal(savedDevices.deviceIds.length, 2)
  assert.deepEqual(writes, [PROJECTS_KEY], '每批设备只写一次项目列表')
  const storedLine = { ...baseLine, fromDeviceId: savedDevices.deviceIds[0], toDeviceId: savedDevices.deviceIds[1] }
  writes = []
  const savedLines = records.saveProjectWiring('p1', { type: 'append-lines', lines: [
    storedLine, { ...storedLine, fromPort: 'B', toPort: 'C', lengthText: '2.5' },
  ] }, savedDevices.schedule.revision)
  assert.equal(savedLines.ok, true, savedLines.error)
  assert.deepEqual(writes, [PROJECTS_KEY], '每批线路只写一次项目列表')
  assert.equal(Object.hasOwn(savedLines, 'deviceIds'), false)
  records = freshRecords()
  assert.deepEqual(records.getProjectWiring('p1').schedule, savedLines.schedule, '重载后设备和引用完整保留')
  assert.equal(storage.get(PROJECTS_KEY)[0].customData, '保留')
  assert.equal(storage.get(PROJECTS_KEY)[1].wiringSchedule, undefined)
  assert.equal(storage.get('audioTool.activeProject.v1'), 'p2')
  assert.equal(storage.get('audioTool.storageSchemaVersion'), 3)

  const beforeFailure = clone(storage.get(PROJECTS_KEY))
  const command = { type: 'append-lines', lines: [storedLine] }
  assert.equal(records.saveProjectWiring('p1', command, savedDevices.schedule.revision).ok, false, '旧版本拒绝保存')
  writeFailureKey = PROJECTS_KEY
  const failedWrite = records.saveProjectWiring('p1', command, savedLines.schedule.revision)
  assert.equal(failedWrite.ok, false)
  assert.deepEqual(failedWrite.schedule, savedLines.schedule)
  assert.deepEqual(storage.get(PROJECTS_KEY), beforeFailure)
  writeFailureKey = ''
  readFailureKey = PROJECTS_KEY
  assert.equal(records.saveProjectWiring('p1', command, savedLines.schedule.revision).ok, false)
  assert.deepEqual(storage.get(PROJECTS_KEY), beforeFailure, '读取失败不得用缓存盲写')
  readFailureKey = ''

  records = reset(savedLines.schedule)
  const boundLine = savedLines.schedule.lines[1]
  const serializedClear = clone({ type: 'upsert', line: {
    id: boundLine.id, fromDevice: '旧来源', fromDeviceId: null, toDeviceId: null,
  } })
  const savedClear = records.saveProjectWiring('p1', serializedClear, savedLines.schedule.revision)
  assert.equal(savedClear.ok, true, savedClear.error)
  const expectedSavedClear = { ...boundLine, fromDevice: '旧来源' }
  delete expectedSavedClear.fromDeviceId
  delete expectedSavedClear.toDeviceId
  assert.deepEqual(savedClear.schedule.lines[1], expectedSavedClear)
  assert.equal(savedClear.schedule.nextNumber, savedLines.schedule.nextNumber)
  assert.equal(savedClear.schedule.revision, savedLines.schedule.revision + 1)
  assert.deepEqual(writes, [PROJECTS_KEY])
  records = freshRecords()
  assert.deepEqual(records.getProjectWiring('p1').schedule, savedClear.schedule, '清除标记不能入库，重载后仍未绑定')

  for (const malformed of [
    { ...savedLines.schedule, devices: [...savedLines.schedule.devices, savedLines.schedule.devices[0]] },
    { ...savedLines.schedule, devices: [{ ...savedLines.schedule.devices[0], ports: [] }] },
    { ...savedLines.schedule, devices: [] },
    { ...savedLines.schedule, lines: [{ ...savedLines.schedule.lines[0], fromDeviceId: 'missing' }] },
    { ...savedLines.schedule, lines: [{ ...savedLines.schedule.lines[1], fromDeviceId: null }] },
    { ...savedLines.schedule, lines: [{ ...savedLines.schedule.lines[1], toDeviceId: null }] },
  ]) {
    records = reset(malformed)
    const before = clone(storage.get(PROJECTS_KEY))
    assert.equal(records.getProjectWiring('p1').ok, false, '重复ID或悬空引用阻止读写')
    assert.equal(records.saveProjectWiring('p1', { type: 'delete', id: legacy.lines[0].id }, malformed.revision).ok, false)
    assert.deepEqual(storage.get(PROJECTS_KEY), before)
    assert.deepEqual(writes, [])
  }
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
  delete require.cache[require.resolve('../utils/records')]
}

console.log('project wiring device tests passed (legacy compatibility, device identities, atomic batches, persistence and failure guards)')

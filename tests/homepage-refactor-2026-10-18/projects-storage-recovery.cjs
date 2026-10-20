'use strict'

const assert = require('node:assert/strict')

const recordsPath = require.resolve('../../utils/records')
const actionsPath = require.resolve('../../utils/result-record-actions')
const schema = 'audioTool.storageSchemaVersion'
const projectKey = 'audioTool.projects.v1'
const recordKey = 'audioTool.records.v1'
const favoriteKey = 'audioTool.favorites.v1'
const recoveryKey = 'audioTool.recovery.v1'
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

const project = { id: 'project-one', name: 'QA 项目', createdAt: 100, updatedAt: 200, notes: 'keep' }
const record = {
  id: 'record-one', module: 'cable', title: 'QA 线路记录', summary: '摘要',
  preferences: { mode: 'professional', professionalDistanceText: '12' }, resultText: '真实保存结果',
  signature: JSON.stringify(['cable', { mode: 'professional', professionalDistanceText: '12' }]),
  favorite: false, archived: false, projectIds: [project.id], createdAt: 110, updatedAt: 210,
}
const favorite = {
  ...record, id: 'favorite-one', favorite: true, projectIds: [], originProjectIds: [project.id],
}

function setup({ projects = [project], records = [record], favorites = [favorite], extra = {} } = {}) {
  const storage = new Map(Object.entries(clone({
    [schema]: 4,
    [projectKey]: projects,
    [recordKey]: records,
    [favoriteKey]: favorites,
    [recoveryKey]: [],
    ...extra,
  })))
  const failKeys = new Set()
  const toasts = []
  global.wx = {
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync: (key, value) => {
      if (failKeys.has(key)) throw new Error(`injected failure: ${key}`)
      storage.set(key, clone(value))
    },
    removeStorageSync: (key) => storage.delete(key),
    showToast: ({ title }) => toasts.push(title),
    vibrateShort: () => {},
  }
  delete require.cache[recordsPath]
  delete require.cache[actionsPath]
  return {
    storage, failKeys, toasts,
    api: require(recordsPath),
    actions: require(actionsPath),
  }
}

function run(name, body, results) {
  try {
    body()
    results.push({ name, status: 'PASS' })
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack })
  }
}

const results = []

run('project deletion persists recovery first and restores project, record links, and wiring snapshot', () => {
  const withWiring = { ...project, wiringSchedule: { version: 1, revision: 1, nextNumber: 2, devices: [], lines: [] } }
  const fixture = setup({ projects: [withWiring] })
  assert.equal(fixture.api.deleteProject(project.id), true)
  const deleted = fixture.api.getWorkspaceSnapshot({ forceRefresh: true })
  assert.equal(deleted.projects.some((item) => item.id === project.id), false)
  assert.ok(deleted.recoveryEntries.some((entry) => entry.kind === 'project' && entry.targetId === project.id))
  delete require.cache[recordsPath]
  const reloaded = require(recordsPath)
  assert.equal(reloaded.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const entry = reloaded.getRecoveryEntries().find((item) => item.kind === 'project' && item.targetId === project.id)
  assert.ok(entry)
  assert.equal(reloaded.restoreRecoveryEntry(entry.id), true)
  assert.deepEqual(reloaded.getProjects().find((item) => item.id === project.id).wiringSchedule, withWiring.wiringSchedule)
  assert.equal(reloaded.getProjectRecords(project.id)[0].id, record.id)
}, results)

run('record deletion and recovery preserve the independent favorite snapshot', () => {
  const fixture = setup({ records: [record], favorites: [{ ...favorite, id: record.id }] })
  assert.equal(fixture.api.removeRecord(record.id), true)
  assert.equal(fixture.api.getRecords().some((item) => item.id === record.id), false)
  assert.equal(fixture.api.getFavorites().some((item) => item.id === record.id), true)
  const entry = fixture.api.getRecoveryEntries().find((item) => item.kind === 'record')
  assert.ok(entry)
  assert.equal(fixture.api.restoreRecoveryEntry(entry.id), true)
  assert.equal(fixture.api.getRecords().find((item) => item.id === record.id).resultText, record.resultText)
  assert.equal(fixture.api.getFavorites().find((item) => item.id === record.id).resultText, record.resultText)
}, results)

run('project records retain signature sharing while Save As and favorites use independent snapshots', () => {
  const fixture = setup({ projects: [project, { ...project, id: 'project-two', name: '第二项目' }] })
  const payload = { ...record, preferences: clone(record.preferences), resultText: record.resultText }
  const first = fixture.api.addRecordToProject(payload, project.id)
  const shared = fixture.api.addRecordToProject({ ...payload, title: '共享记录标题已更新' }, 'project-two')
  assert.equal(shared.id, first.id)
  assert.deepEqual(shared.projectIds, [project.id, 'project-two'])

  const favoriteSnapshot = fixture.api.saveFavoriteSnapshot(payload)
  assert.ok(favoriteSnapshot)
  assert.notEqual(favoriteSnapshot.id, first.id)
  assert.equal(fixture.api.getRecordById(first.id).resultText, payload.resultText)
  assert.equal(fixture.api.getFavoriteByPayload(payload).resultText, payload.resultText)

  const savedCopy = fixture.api.addRecordToProject(payload, project.id, undefined, { saveAs: true })
  assert.ok(savedCopy)
  assert.notEqual(savedCopy.id, first.id)
  assert.notEqual(savedCopy.id, favoriteSnapshot.id)
  assert.equal(fixture.api.getRecordById(first.id).projectIds.length, 2)
}, results)

run('RECOVERY_KEY failure keeps favorite and does not claim cancel succeeded', () => {
  const fixture = setup()
  fixture.failKeys.add(recoveryKey)
  const page = {
    data: { currentFavorite: true },
    setData(changes) { Object.assign(this.data, changes) },
    getRecordPayload: () => ({ module: favorite.module, preferences: favorite.preferences, resultText: favorite.resultText, title: favorite.title }),
  }
  assert.equal(fixture.actions.togglePageFavorite(page), false)
  assert.equal(fixture.api.getFavorites()[0].id, favorite.id)
  assert.equal(page.data.currentFavorite, true)
  assert.ok(fixture.toasts.some((text) => text.includes('取消收藏失败')))
}, results)

for (const kind of ['project', 'record', 'favorite']) {
  run(`${kind} restore rejects conflicting same-ID content and retains both current row and recovery copy`, () => {
    const fixture = setup()
    const remove = kind === 'project' ? fixture.api.deleteProject
      : kind === 'record' ? fixture.api.removeRecord : fixture.api.removeFavorite
    const targetId = kind === 'project' ? project.id : kind === 'record' ? record.id : favorite.id
    assert.equal(remove(targetId), true)
    const entry = fixture.api.getRecoveryEntries().find((item) => item.kind === kind && item.targetId === targetId)
    assert.ok(entry)
    const targetKey = kind === 'project' ? projectKey : kind === 'record' ? recordKey : favoriteKey
    const existing = kind === 'project' ? project : kind === 'record' ? record : favorite
    const conflict = { ...existing, id: targetId, name: '新内容', title: '新内容', resultText: '更新后的不同内容' }
    fixture.storage.set(targetKey, [conflict])
    assert.equal(fixture.api.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
    assert.equal(fixture.api.restoreRecoveryEntry(entry.id), false)
    assert.equal(fixture.api.getRecoveryEntries().some((item) => item.id === entry.id), true)
    assert.equal(fixture.storage.get(targetKey)[0].resultText, conflict.resultText)
  }, results)
}

run('favorite load preflight blocks unsupported models without changing preferences or navigation', () => {
  const fixture = setup()
  let detail
  global.Page = (definition) => { detail = definition }
  const favoriteDetailPath = require.resolve('../../pages/projects/favorite-detail')
  delete require.cache[favoriteDetailPath]
  const favoriteDetail = require(favoriteDetailPath)
  const invalid = {
    id: 'favorite-unknown-model', module: 'limiter', title: 'legacy',
    preferences: { ...record.preferences, amplifierModel: 'QA 功放2x2', speakerModel: 'KF-D12F' },
    resultText: '保留的历史结果',
  }
  assert.equal(favoriteDetail.checkFavoriteLoad(invalid).canLoad, false)
  let navigated = false
  global.wx.navigateTo = () => { navigated = true }
  const before = clone(Object.fromEntries(fixture.storage))
  const page = {
    data: { favorite: { ...invalid, canLoad: false } },
    setData(changes) { Object.assign(this.data, changes) },
  }
  detail.openWorkingCopy.call(page)
  assert.equal(navigated, false)
  assert.equal(page.data.favorite.canLoad, false)
  assert.match(page.data.favorite.loadReason, /不可用/)
  assert.deepEqual(clone(Object.fromEntries(fixture.storage)), before)
  assert.equal(favoriteDetail.checkFavoriteLoad({
    ...invalid, preferences: { amplifierModel: 'KT-P21000', speakerModel: 'KF-D12F' },
  }).canLoad, true)
  assert.equal(favoriteDetail.checkFavoriteLoad({
    id: 'favorite-camera-manual', module: 'camera',
    preferences: { sourceMode: 'manual', cameraModel: 'QA camera', viewIndex: 0 },
    resultText: '完整历史结果',
  }).canLoad, false, 'camera favorites must not map manual settings onto the current library-only editor')
  assert.equal(favoriteDetail.checkFavoriteLoad({
    id: 'favorite-wiring-valid', module: 'audioWiring',
    preferences: {
      version: 1, outputId: 'xlrBalanced', inputId: 'xlrBalanced',
      manualSelected: { output: false, input: false }, viewMode: 'connectors', face: 'solder',
    },
    resultText: '已保存的接线结果',
  }).canLoad, true)
  assert.equal(favoriteDetail.checkFavoriteLoad({
    id: 'favorite-wiring-legacy', module: 'audioWiring',
    preferences: { version: 0, outputId: 'unknown', inputId: 'xlrBalanced' },
    resultText: '旧接线结果',
  }).canLoad, false)
  assert.equal(favoriteDetail.checkFavoriteLoad({
    id: 'favorite-wiring-invalid-controls', module: 'audioWiring',
    preferences: { version: 1, outputId: 'xlrBalanced', inputId: 'xlrBalanced' },
    resultText: '接线结果',
  }).canLoad, false, 'wiring work copies must reject malformed controls instead of falling back to defaults')
  assert.doesNotMatch(
    require('node:fs').readFileSync(favoriteDetailPath, 'utf8'),
    /require\(['"]\.\.\/audio-wiring\/wiring-model['"]\)/,
    'main-package favorite detail must not load audio-wiring subpackage code',
  )
}, results)

console.log(JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2))
if (results.some((result) => result.status !== 'PASS')) process.exitCode = 1

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

function setup({ projects = [project], records = [record], favorites = [favorite], extra = {}, failReadKeys = [] } = {}) {
  const storage = new Map(Object.entries(clone({
    [schema]: 4,
    [projectKey]: projects,
    [recordKey]: records,
    [favoriteKey]: favorites,
    [recoveryKey]: [],
    ...extra,
  })))
  const failKeys = new Set()
  const failReads = new Set(failReadKeys)
  const toasts = []
  global.wx = {
    getStorageSync: (key) => {
      if (failReads.has(key)) throw new Error(`injected read failure: ${key}`)
      return clone(storage.get(key))
    },
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
    storage, failKeys, failReads, toasts,
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

run('restore uses the current recovery list and preserves rows added after the cache was filled', () => {
  const restoreEntry = {
    id: 'restore-stale-cache', kind: 'project', targetId: 'restore-project', deletedAt: 100,
    snapshot: { id: 'restore-project', name: '恢复项目', createdAt: 90, updatedAt: 100 },
  }
  const concurrentEntry = {
    id: 'added-after-cache', kind: 'record', targetId: 'other-record', deletedAt: 101,
    snapshot: { id: 'other-record' },
  }
  const fixture = setup({ extra: { [recoveryKey]: [restoreEntry] } })
  assert.equal(fixture.api.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  fixture.storage.set(recoveryKey, [restoreEntry, concurrentEntry])

  assert.equal(fixture.api.restoreRecoveryEntry(restoreEntry.id), true)
  assert.deepEqual(fixture.storage.get(recoveryKey), [concurrentEntry])
  assert.equal(fixture.storage.get(projectKey).some((item) => item.id === restoreEntry.snapshot.id), true)
}, results)

run('restore does not write from cached rows when reading the raw recovery list fails', () => {
  const row = {
    id: 'restore-read-failure', kind: 'project', targetId: 'restore-project', deletedAt: 100,
    snapshot: { id: 'restore-project', name: '恢复项目', createdAt: 90, updatedAt: 100 },
  }
  const concurrentEntry = {
    id: 'added-before-read-failure', kind: 'record', targetId: 'other-record', deletedAt: 101,
    snapshot: { id: 'other-record' },
  }
  const fixture = setup({ extra: { [recoveryKey]: [row] } })
  assert.equal(fixture.api.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  fixture.storage.set(recoveryKey, [row, concurrentEntry])
  const before = clone(Object.fromEntries(fixture.storage))
  fixture.failReads.add(recoveryKey)

  assert.equal(fixture.api.restoreRecoveryEntry(row.id), false)
  assert.deepEqual(clone(Object.fromEntries(fixture.storage)), before)

  fixture.failReads.clear()
  assert.equal(fixture.api.removeFavorite(favorite.id), true)
  assert.equal(fixture.storage.get(recoveryKey).some((item) => item.id === concurrentEntry.id), true)
}, results)

run('a failed restore keeps its fresh recovery list for subsequent mutations', () => {
  const row = {
    id: 'restore-write-failure', kind: 'project', targetId: 'restore-project', deletedAt: 100,
    snapshot: { id: 'restore-project', name: '恢复项目', createdAt: 90, updatedAt: 100 },
  }
  const concurrentEntry = {
    id: 'added-before-write-failure', kind: 'record', targetId: 'other-record', deletedAt: 101,
    snapshot: { id: 'other-record' },
  }
  const fixture = setup({ extra: { [recoveryKey]: [row] } })
  assert.equal(fixture.api.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  fixture.storage.set(recoveryKey, [row, concurrentEntry])
  fixture.failKeys.add(projectKey)

  assert.equal(fixture.api.restoreRecoveryEntry(row.id), false)
  assert.deepEqual(fixture.storage.get(recoveryKey), [row, concurrentEntry])
  fixture.failKeys.clear()
  assert.equal(fixture.api.removeFavorite(favorite.id), true)
  assert.equal(fixture.storage.get(recoveryKey).some((item) => item.id === concurrentEntry.id), true)
}, results)

run('recovery retention removes only expired raw entries and preserves extended rows', () => {
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const now = 1_000_000_000_000
  const expired = {
    id: 'expired-row', kind: 'record', targetId: 'expired-record', deletedAt: now - thirtyDays - 1,
    snapshot: { id: 'expired-record' },
  }
  const recent = {
    id: 'recent-row', kind: 'favorite', targetId: 'recent-favorite', deletedAt: now - thirtyDays + 1,
    snapshot: { id: 'recent-favorite' }, opaqueFutureField: { version: 2 },
  }
  const fixture = setup({ extra: { [recoveryKey]: [expired, recent] } })
  const result = fixture.api.processRecoveryRetention(now)
  assert.deepEqual(result, { ok: true, error: '', removedCount: 1 })
  assert.deepEqual(fixture.storage.get(recoveryKey), [recent], 'the raw survivor is preserved byte-for-byte as data')
}, results)

run('legacy recent entries start their 30-day clock on first maintenance, not their old updatedAt', () => {
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const now = 1_000_000_000_000
  const legacy = {
    id: 'legacy-row', kind: 'legacy-recent', targetId: 'legacy-result', deletedAt: 1,
    snapshot: { id: 'legacy-result' },
  }
  const fixture = setup({ extra: { [recoveryKey]: [legacy] } })
  assert.deepEqual(fixture.api.processRecoveryRetention(now), { ok: true, error: '', removedCount: 0 })
  assert.equal(fixture.storage.get(recoveryKey)[0].deletedAt, now)
  assert.equal(fixture.storage.get(recoveryKey)[0].retentionStartedAt, now)
  assert.deepEqual(fixture.api.processRecoveryRetention(now + thirtyDays - 1).removedCount, 0)
  assert.deepEqual(fixture.api.processRecoveryRetention(now + thirtyDays).removedCount, 1)
  assert.deepEqual(fixture.storage.get(recoveryKey), [])
}, results)

run('missing recovery timestamps begin at first maintenance', () => {
  const now = 1_000_000_000_000
  const missingDate = { id: 'undated-row', kind: 'project', targetId: 'project-old', snapshot: { id: 'project-old' } }
  const fixture = setup({ extra: { [recoveryKey]: [missingDate] } })
  assert.equal(fixture.api.processRecoveryRetention(now).ok, true)
  assert.equal(fixture.storage.get(recoveryKey)[0].deletedAt, now)
}, results)

run('a missing recovery key in an otherwise valid v4 store is treated as empty', () => {
  const fixture = setup({ extra: { [recoveryKey]: undefined } })
  assert.equal(fixture.storage.has(recoveryKey), false)
  assert.deepEqual(fixture.api.processRecoveryRetention(1_000_000_000_000), { ok: true, error: '', removedCount: 0 })
  assert.equal(fixture.storage.has(recoveryKey), false, 'an empty recovery key stays absent')
  assert.deepEqual(fixture.api.getRecoveryEntries(), [])
}, results)

run('a future deletion timestamp is preserved when the device clock moves backward', () => {
  const now = 1_000_000_000_000
  const future = {
    id: 'future-row', kind: 'record', targetId: 'future-record', deletedAt: now + 60_000,
    snapshot: { id: 'future-record' },
  }
  const fixture = setup({ extra: { [recoveryKey]: [future] } })
  assert.deepEqual(fixture.api.processRecoveryRetention(now), { ok: true, error: '', removedCount: 0 })
  assert.deepEqual(fixture.storage.get(recoveryKey), [future])
}, results)

run('retention read and write failures report failure and preserve stored entries', () => {
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const now = 1_000_000_000_000
  const expired = {
    id: 'expired-row', kind: 'record', targetId: 'expired-record', deletedAt: now - thirtyDays - 1,
    snapshot: { id: 'expired-record' },
  }
  const readFailure = setup({ extra: { [recoveryKey]: [expired] }, failReadKeys: [recoveryKey] })
  assert.equal(readFailure.api.processRecoveryRetention(now).ok, false)
  assert.deepEqual(readFailure.storage.get(recoveryKey), [expired])

  const writeFailure = setup({ extra: { [recoveryKey]: [expired] } })
  writeFailure.failKeys.add(recoveryKey)
  const result = writeFailure.api.processRecoveryRetention(now)
  assert.equal(result.ok, false)
  assert.match(result.error, /仍保留/)
  assert.deepEqual(writeFailure.storage.get(recoveryKey), [expired])
}, results)

run('permanent deletion removes one recovery copy without touching related stores', () => {
  const first = {
    id: 'first-row', kind: 'favorite', targetId: 'first-favorite', deletedAt: 100,
    snapshot: { id: 'first-favorite' }, opaqueFutureField: { keep: true },
  }
  const second = { id: 'second-row', kind: 'record', targetId: 'second-record', deletedAt: 101, snapshot: { id: 'second-record' } }
  const fixture = setup({ extra: { [recoveryKey]: [first, second] } })
  const otherStores = [projectKey, recordKey, favoriteKey].map((key) => [key, clone(fixture.storage.get(key))])
  assert.equal(fixture.api.permanentlyDeleteRecoveryEntry(first.id), true)
  assert.deepEqual(fixture.storage.get(recoveryKey), [second])
  otherStores.forEach(([key, value]) => assert.deepEqual(fixture.storage.get(key), value))

  const beforeFailure = clone(fixture.storage.get(recoveryKey))
  fixture.failKeys.add(recoveryKey)
  assert.equal(fixture.api.permanentlyDeleteRecoveryEntry(second.id), false)
  assert.deepEqual(fixture.storage.get(recoveryKey), beforeFailure)
}, results)

run('recovery page asks before permanently deleting and describes the copy scope', () => {
  const row = { id: 'confirm-row', kind: 'favorite', targetId: 'confirm-favorite', deletedAt: 100, snapshot: { id: 'confirm-favorite' } }
  const fixture = setup({ extra: { [recoveryKey]: [row] } })
  const pagePath = require.resolve('../../pages/projects/recovery')
  const originalPage = global.Page
  let definition
  global.Page = (value) => { definition = value }
  delete require.cache[pagePath]
  require(pagePath)
  if (originalPage === undefined) delete global.Page
  else global.Page = originalPage

  let modal
  global.wx.showModal = (options) => { modal = options }
  const page = { _pageVisible: false, _unloaded: false, refresh() {}, setData() {} }
  const event = { currentTarget: { dataset: { id: row.id } } }
  definition.permanentlyDeleteEntry.call(page, event)
  assert.equal(modal.confirmText, '永久删除')
  assert.match(modal.content, /迁移前备份/)
  modal.success({ confirm: false })
  assert.deepEqual(fixture.storage.get(recoveryKey), [row], 'cancel leaves the recovery row intact')

  definition.permanentlyDeleteEntry.call(page, event)
  modal.success({ confirm: true })
  assert.deepEqual(fixture.storage.get(recoveryKey), [])
}, results)

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

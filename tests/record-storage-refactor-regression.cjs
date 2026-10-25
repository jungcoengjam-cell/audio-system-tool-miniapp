'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const beforeRoot = path.join(root, 'tmp/architecture-continuation-2026-10-25/before')
const phase2BeforeRoot = path.join(root, 'tmp/architecture-continuation-2026-10-25/phase2-migration/before')
const currentRecordsPath = path.join(root, 'utils/records.js')
const currentRecordsRequire = createRequire(currentRecordsPath)
const keys = {
  schema: 'audioTool.storageSchemaVersion',
  projects: 'audioTool.projects.v1',
  records: 'audioTool.records.v1',
  favorites: 'audioTool.favorites.v1',
  recovery: 'audioTool.recovery.v1',
  backups: 'audioTool.storageMigrationBackups.v1',
  journal: 'audioTool.storageMigrationJournal.v1',
}
const project = { id: 'project-one', name: '项目一', createdAt: 100, updatedAt: 200 }
const record = {
  id: 'record-one', module: 'spl', title: '声压估算', summary: '摘要',
  preferences: { distanceText: '8' }, resultText: '保存结果', signature: 'spl-signature',
  favorite: false, archived: false, projectIds: [project.id], createdAt: 110, updatedAt: 210,
}
const initialCurrent = {
  [keys.schema]: 4,
  [keys.projects]: [project],
  [keys.records]: [record],
  [keys.favorites]: [],
  [keys.recovery]: [],
}
const initialLegacy = {
  [keys.schema]: 3,
  [keys.projects]: [{ ...project, id: 'legacy-project', name: '旧项目' }],
  [keys.records]: [{ ...record, id: 'legacy-record', projectIds: ['legacy-project'], favorite: true }],
}
const FIXED_NOW = Date.UTC(2026, 9, 25, 12)

function copy(value) {
  if (value === undefined) return { $type: 'undefined' }
  return JSON.parse(JSON.stringify(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function storageSnapshot(storage) {
  return [...storage.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, copy(value)])
}

function createPlatform(initial, failureRules = [], { removeAvailable = true } = {}) {
  const storage = new Map(Object.entries(clone(initial)))
  const trace = []
  const attempts = new Map()
  let failures = [...failureRules]
  let parseInRecordsRealm = null
  const shouldFail = (operation, key) => {
    const identity = `${operation}:${key}`
    const attempt = (attempts.get(identity) || 0) + 1
    attempts.set(identity, attempt)
    return failures.some((rule) => rule.operation === operation && rule.key === key && rule.attempt === attempt)
  }
  const wx = {
    getStorageSync(key) {
      assert.equal(this, wx, 'wx.getStorageSync must keep the platform receiver')
      const failed = shouldFail('get', key)
      const value = storage.get(key)
      trace.push({ operation: 'get', key, ok: !failed, value: copy(value) })
      if (failed) throw new Error(`injected read failure: ${key}`)
      return value === undefined ? undefined
        : parseInRecordsRealm ? parseInRecordsRealm(JSON.stringify(value)) : clone(value)
    },
    setStorageSync(key, value) {
      assert.equal(this, wx, 'wx.setStorageSync must keep the platform receiver')
      const failed = shouldFail('set', key)
      trace.push({ operation: 'set', key, ok: !failed, value: copy(value) })
      if (failed) throw new Error(`injected write failure: ${key}`)
      storage.set(key, clone(value))
    },
  }
  if (removeAvailable) {
    wx.removeStorageSync = function removeStorageSync(key) {
      assert.equal(this, wx, 'wx.removeStorageSync must keep the platform receiver')
      const failed = shouldFail('remove', key)
      trace.push({ operation: 'remove', key, ok: !failed })
      if (failed) throw new Error(`injected remove failure: ${key}`)
      storage.delete(key)
    }
  }
  return {
    wx,
    storage,
    trace,
    failWith: (nextRules) => { failures = [...nextRules] },
    bindRealm: (context) => { parseInRecordsRealm = vm.runInContext('JSON.parse', context) },
    snapshot: () => storageSnapshot(storage),
  }
}

function createRecordsRealm(version, wx, platform) {
  const context = vm.createContext({ wx })
  vm.runInContext(`Date.now = () => ${FIXED_NOW}; Math.random = () => 0.125;`, context)
  platform.bindRealm(context)
  const sourcePath = version === 'before'
    ? path.join(beforeRoot, 'utils/records.js')
    : version === 'phase2-before' ? path.join(phase2BeforeRoot, 'records.js') : currentRecordsPath
  const source = fs.readFileSync(sourcePath, 'utf8')
  let cachedApi = null

  function requireRecords() {
    if (cachedApi) return cachedApi
    const module = { exports: {} }
    const loadDependency = (request) => currentRecordsRequire(request)
    const wrapper = new vm.Script(
      `(function (require, module, exports, __filename, __dirname) {\n${source}\n})`,
      { filename: sourcePath },
    ).runInContext(context)
    wrapper(loadDependency, module, module.exports, sourcePath, path.dirname(sourcePath))
    cachedApi = module.exports
    return cachedApi
  }

  return {
    context,
    requireRecords,
    clearRecordsCache() { cachedApi = null },
    replaceWx(nextWx) { context.wx = nextWx },
  }
}

function runScenario(version, initial, execute, failureRules = [], platformOptions = {}) {
  const platform = createPlatform(initial, failureRules, platformOptions)
  const previousWx = global.wx
  global.wx = platform.wx
  const realm = createRecordsRealm(version, platform.wx, platform)
  try {
    const api = realm.requireRecords()
    const outcome = execute({ api, platform, realm })
    return {
      exports: Object.keys(api).sort(),
      outcome: copy(outcome),
      trace: clone(platform.trace),
      storage: platform.snapshot(),
    }
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

function runMigrationSuccess(version) {
  return runScenario(version, initialLegacy, ({ api }) => {
    const migrated = api.getWorkspaceSnapshot({ forceRefresh: true })
    const stable = api.getWorkspaceSnapshot({ forceRefresh: true })
    const created = api.createProject('新项目')
    const afterWrite = api.getWorkspaceSnapshot({ forceRefresh: true })
    return { migrated, stable, created, afterWrite }
  })
}

function runMigrationRetry(version) {
  return runScenario(version, initialLegacy, ({ api, platform }) => {
    const blocked = api.getWorkspaceSnapshot({ forceRefresh: true })
    const afterFailure = platform.snapshot()
    platform.failWith([])
    const retried = api.getWorkspaceSnapshot({ forceRefresh: true })
    const secondRead = api.getWorkspaceSnapshot({ forceRefresh: true })
    return { blocked, afterFailure, retried, secondRead }
  }, [{ operation: 'set', key: keys.backups, attempt: 1 }])
}

function runRemoveFallback(version) {
  return runScenario(version, initialLegacy, ({ api }) => (
    api.getWorkspaceSnapshot({ forceRefresh: true })
  ), [], { removeAvailable: false })
}

function runAtomicFailures(version) {
  const cases = [
    ['write-1-recovery', [{ operation: 'set', key: keys.recovery, attempt: 1 }]],
    ['write-2-records', [{ operation: 'set', key: keys.records, attempt: 1 }]],
    ['write-3-projects', [{ operation: 'set', key: keys.projects, attempt: 1 }]],
    ['rollback-records-fails', [
      { operation: 'set', key: keys.projects, attempt: 1 },
      { operation: 'set', key: keys.records, attempt: 2 },
    ]],
  ]
  return Object.fromEntries(cases.map(([name, failureRules]) => [name, runScenario(
    version,
    initialCurrent,
    ({ api }) => api.removeRecordFromProject(record.id, project.id),
    failureRules,
  )]))
}

function runFutureSchema(version) {
  return runScenario(version, { ...initialCurrent, [keys.schema]: 99 }, ({ api }) => ({
    snapshot: api.getWorkspaceSnapshot({ forceRefresh: true }),
    createProject: api.createProject('不可写入'),
  }))
}

function runReadFailureAndRetry(version) {
  return runScenario(version, initialCurrent, ({ api, platform }) => {
    const blockedMutation = api.createProject('读取失败时不可写')
    const storageAfterBlockedMutation = platform.snapshot()
    platform.failWith([])
    const recoveredSnapshot = api.getWorkspaceSnapshot({ forceRefresh: true })
    const retryMutation = api.createProject('读取恢复后可写')
    return { blockedMutation, storageAfterBlockedMutation, recoveredSnapshot, retryMutation }
  }, [{ operation: 'get', key: keys.records, attempt: 1 }])
}

function runCacheRefresh(version) {
  return runScenario(version, initialCurrent, ({ api, platform }) => {
    const first = api.getProjects()
    const externalProject = { ...project, id: 'external-project', name: '外部项目', updatedAt: 300 }
    platform.storage.set(keys.projects, [externalProject])
    const cached = api.getProjects()
    const refreshed = api.getWorkspaceSnapshot({ forceRefresh: true })
    return { first, cached, refreshed }
  })
}

function runInstanceIsolationAndDynamicWx(version) {
  const firstPlatform = createPlatform(initialCurrent)
  const secondProject = { ...project, id: 'second-project', name: '第二平台项目', updatedAt: 300 }
  const secondPlatform = createPlatform({
    ...initialCurrent,
    [keys.projects]: [secondProject],
  })
  const previousWx = global.wx
  global.wx = firstPlatform.wx
  const realm = createRecordsRealm(version, firstPlatform.wx, firstPlatform)
  try {
    const firstApi = realm.requireRecords()
    const repeatedRequire = realm.requireRecords()
    const firstRead = firstApi.getProjects()
    global.wx = secondPlatform.wx
    realm.replaceWx(secondPlatform.wx)
    secondPlatform.bindRealm(realm.context)
    const cachedFirstRead = firstApi.getProjects()
    realm.clearRecordsCache()
    const secondApi = realm.requireRecords()
    const secondInstanceRead = secondApi.getProjects()
    const dynamicWxRead = firstApi.getWorkspaceSnapshot({ forceRefresh: true })
    return {
      sameBeforeClear: repeatedRequire === firstApi,
      isolatedAfterClear: secondApi !== firstApi,
      exports: Object.keys(firstApi).sort(),
      firstRead: copy(firstRead),
      cachedFirstRead: copy(cachedFirstRead),
      secondInstanceRead: copy(secondInstanceRead),
      dynamicWxRead: copy(dynamicWxRead),
      firstTrace: clone(firstPlatform.trace),
      secondTrace: clone(secondPlatform.trace),
      firstStorage: firstPlatform.snapshot(),
      secondStorage: secondPlatform.snapshot(),
    }
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

function runRecoveryRetry(version) {
  return runScenario(version, initialCurrent, ({ api, platform }) => {
    const removed = api.removeRecordFromProject(record.id, project.id)
    const entries = api.getRecoveryEntries()
    assert.ok(entries.length, `unlink should create a recovery entry (removed=${removed})`)
    const entry = entries[0]
    platform.failWith([{ operation: 'set', key: keys.projects, attempt: 2 }])
    const blockedRestore = api.restoreRecoveryEntry(entry.id)
    const afterFailure = platform.snapshot()
    platform.failWith([])
    const restored = api.restoreRecoveryEntry(entry.id)
    return { removed, entry, blockedRestore, afterFailure, restored }
  })
}

function runSuite(version) {
  return {
    migrationSuccess: runMigrationSuccess(version),
    migrationRetry: runMigrationRetry(version),
    removeFallback: runRemoveFallback(version),
    atomicFailures: runAtomicFailures(version),
    futureSchema: runFutureSchema(version),
    readFailureAndRetry: runReadFailureAndRetry(version),
    cacheRefresh: runCacheRefresh(version),
    instanceIsolationAndDynamicWx: runInstanceIsolationAndDynamicWx(version),
    recoveryRetry: runRecoveryRetry(version),
  }
}

function runPhase2Suite(version) {
  const rawWriteAndRollbackFailure = runScenario(version, initialLegacy, ({ api, platform }) => {
    const migrated = api.getWorkspaceSnapshot({ forceRefresh: true })
    const backup = api.getStorageMigrationBackups().backups[0]
    platform.failWith([
      { operation: 'set', key: keys.projects, attempt: 2 },
      { operation: 'set', key: keys.schema, attempt: 3 },
    ])
    const restored = api.restoreStorageMigrationBackup(backup.id)
    return { migrated, backupId: backup.id, restored }
  })
  const journalCleanupFailure = runScenario(version, initialLegacy, ({ api, platform }) => {
    const migrated = api.getWorkspaceSnapshot({ forceRefresh: true })
    const backup = api.getStorageMigrationBackups().backups[0]
    platform.failWith([{ operation: 'remove', key: keys.journal, attempt: 2 }])
    const restored = api.restoreStorageMigrationBackup(backup.id)
    return { migrated, backupId: backup.id, restored }
  })
  return { rawWriteAndRollbackFailure, journalCleanupFailure }
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function digestSuite(suite) {
  return Object.fromEntries(Object.entries(suite).map(([name, value]) => [name, digest(value)]))
}

const expectedDigests = {
  migrationSuccess: '69387f3ebaa898dfccdaee873aaf55f5b5402eac4967c61d7fcc94d5308a3ee3',
  migrationRetry: '02d24ce3bd1b56ef0df8910ae78bd6cb4d752b90971a85167939a22eea63a543',
  removeFallback: 'fad96216fcf8f27cd143fde9e9ab36e1c9236a1e81f631f3fb40f73fa0b724a5',
  atomicFailures: '7b3a2a6b7ed9ab36be772a792db354088f2598147165c5ebf41b53a6b832a4c3',
  futureSchema: '7c7bbe83d5f3be8f289c23ef15f0bbaa5b8197cf90b48bc2a96d76467cacd4fc',
  readFailureAndRetry: '91bfa543347f610e10586dcb1e5a840f326a7c19b3972f8af342d2cf5668208f',
  cacheRefresh: '8fbe1c0335b87305afa42dfa18b9a98c711e50d533924d51aef94bfc65932e0d',
  instanceIsolationAndDynamicWx: '4f8061f03a4a1af9137cf4b076ed78296249b8e858445900de2ec3b96cb4297d',
  recoveryRetry: 'f0f09a7e3a9bb693cc40199222ca50db7bb2c1e5308e57a1b2a0421906d527c0',
}
const expectedPhase2Digests = {
  rawWriteAndRollbackFailure: '5d3b07b6f08119c7cf92a6c68d1f7207c9ac3df73a82d9ee166a626033014eb7',
  journalCleanupFailure: '4be647e0d9f6b111017e6d5480fe21cb020a535a067613f275d600ab21703e36',
}

const current = runSuite('current')
const currentPhase2 = runPhase2Suite('current')
if (process.argv.includes('--capture-before')) {
  const before = runSuite('before')
  assert.deepEqual(current, before, 'starting source and before snapshot must behave identically')
  console.log(JSON.stringify({ digests: digestSuite(before), before }, null, 2))
} else if (process.argv.includes('--capture-phase2')) {
  const before = runPhase2Suite('phase2-before')
  assert.deepEqual(currentPhase2, before, 'phase2 starting source and current source must match before migration extraction')
  console.log(JSON.stringify({ digests: digestSuite(before), before }, null, 2))
} else if (process.argv.includes('--compare-before')) {
  const before = runSuite('before')
  assert.deepEqual(current, before, 'records API, complete wx IO traces, and final storage must match before snapshot')
  assert.deepEqual(digestSuite(current), expectedDigests)
  const phase2Before = runPhase2Suite('phase2-before')
  assert.deepEqual(currentPhase2, phase2Before, 'migration error and rollback traces must match phase2 starting source')
  assert.deepEqual(digestSuite(currentPhase2), expectedPhase2Digests)
  console.log('Record storage regression passed (API, IO traces, and final storage match start snapshot).')
} else {
  assert.deepEqual(digestSuite(current), expectedDigests,
    'records API, storage traces, and final snapshots must match frozen pre-refactor behavior')
  assert.deepEqual(digestSuite(currentPhase2), expectedPhase2Digests,
    'migration failure and rollback traces must match phase2 frozen behavior')
  console.log('Record storage regression passed (frozen API and storage behavior).')
}

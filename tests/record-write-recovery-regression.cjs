'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const vm = require('node:vm')
const { createRecordStorage } = require('../utils/record-storage')

const keys = {
  schema: 'audioTool.storageSchemaVersion',
  journal: 'audioTool.recordWriteJournal.v1',
  records: 'audioTool.records.v1',
  projects: 'audioTool.projects.v1',
  favorites: 'audioTool.favorites.v1',
  recovery: 'audioTool.recovery.v1',
  active: 'audioTool.activeProject.v1',
}
const businessKeys = [keys.records, keys.projects, keys.favorites, keys.recovery]
const oldData = {
  [keys.records]: [{ id: 'record-old', projectIds: ['project-old'], rawField: 'keep' }],
  [keys.projects]: [{ id: 'project-old', name: '旧项目', rawField: 'keep' }],
  [keys.favorites]: [{ id: 'favorite-old', rawField: 'keep' }],
  [keys.recovery]: [{ id: 'recovery-old', rawField: 'keep' }],
}
const nextData = {
  [keys.records]: [{ id: 'record-new' }],
  [keys.projects]: [{ id: 'project-new', name: '新项目' }],
  [keys.favorites]: [{ id: 'favorite-new' }],
  [keys.recovery]: [{ id: 'recovery-new' }],
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function makeInitial(overrides = {}) {
  return { [keys.schema]: 4, ...clone(oldData), ...clone(overrides) }
}

function writesFor(next = nextData) {
  return [keys.recovery, keys.records, keys.projects, keys.favorites].map((key) => ({
    key,
    value: clone(next[key]),
    // The journal must capture raw storage, not this possibly normalized hint.
    previousValue: [{ id: 'intentionally-wrong-hint' }],
  }))
}

function snapshotEntries(before = oldData) {
  return businessKeys.map((key) => Object.prototype.hasOwnProperty.call(before, key)
    ? { key, present: true, value: clone(before[key]) }
    : { key, present: false })
}

function makeJournal(entries = snapshotEntries(), transactionId = 'seeded-transaction') {
  return { version: 1, schemaVersion: 4, transactionId, entries: clone(entries) }
}

function createPlatform(initial, failureRules = [], { removeAvailable = true, crossRealmReads = false } = {}) {
  const storage = new Map(Object.entries(clone(initial)))
  const trace = []
  const attempts = new Map()
  const crossRealmParse = crossRealmReads ? vm.runInContext('JSON.parse', vm.createContext({})) : null
  let rules = [...failureRules]

  function matchingRule(operation, key) {
    const identity = `${operation}:${key}`
    const attempt = (attempts.get(identity) || 0) + 1
    attempts.set(identity, attempt)
    return rules.find((rule) => rule.operation === operation && rule.key === key && rule.attempt === attempt)
  }

  const wx = {
    getStorageSync(key) {
      assert.equal(this, wx)
      const rule = matchingRule('get', key)
      if (rule && !rule.after) {
        trace.push({ operation: 'get', key, outcome: 'throw-before' })
        throw new Error(`injected get failure: ${key}`)
      }
      const value = storage.get(key)
      trace.push({ operation: 'get', key, outcome: rule ? 'throw-after' : 'ok' })
      if (rule) throw new Error(`injected get failure after read: ${key}`)
      return value === undefined ? undefined
        : crossRealmParse ? crossRealmParse(JSON.stringify(value)) : clone(value)
    },
    setStorageSync(key, value) {
      assert.equal(this, wx)
      const rule = matchingRule('set', key)
      if (rule?.replaceValue !== undefined) storage.set(key, clone(rule.replaceValue))
      if (rule && !rule.after) {
        trace.push({ operation: 'set', key, outcome: 'throw-before' })
        throw new Error(`injected set failure: ${key}`)
      }
      storage.set(key, clone(value))
      trace.push({ operation: 'set', key, outcome: rule ? 'throw-after' : 'ok' })
      if (rule) throw new Error(`injected set failure after write: ${key}`)
    },
  }
  if (removeAvailable) {
    wx.removeStorageSync = function removeStorageSync(key) {
      assert.equal(this, wx)
      const rule = matchingRule('remove', key)
      if (rule?.replaceValue !== undefined) storage.set(key, clone(rule.replaceValue))
      if (rule && !rule.after) {
        trace.push({ operation: 'remove', key, outcome: 'throw-before' })
        throw new Error(`injected remove failure: ${key}`)
      }
      storage.delete(key)
      trace.push({ operation: 'remove', key, outcome: rule ? 'throw-after' : 'ok' })
      if (rule) throw new Error(`injected remove failure after delete: ${key}`)
    }
  }

  return {
    wx,
    storage,
    trace,
    setFailures(nextRules) { rules = [...nextRules] },
    snapshot() { return Object.fromEntries([...storage.entries()].map(([key, value]) => [key, clone(value)])) },
  }
}

function createStorage(platform, onRecoveryInvalidate = () => {}) {
  return createRecordStorage({
    getWx: () => platform.wx,
    getMigrationError: () => '',
    storageSchemaKey: keys.schema,
    storageSchemaVersion: 4,
    atomicStorageKeys: businessKeys,
    onRecoveryInvalidate,
  })
}

function assertBusinessData(storage, expected) {
  for (const key of businessKeys) {
    if (Object.prototype.hasOwnProperty.call(expected, key)) assert.deepEqual(storage.get(key), expected[key], key)
    else assert.equal(storage.has(key) && storage.get(key) !== undefined
      && storage.get(key) !== null && storage.get(key) !== '', false, `${key} should be absent`)
  }
}

function createRecordsApi(platform) {
  const recordsPath = path.resolve(__dirname, '../utils/records.js')
  delete require.cache[recordsPath]
  global.wx = platform.wx
  return { api: require(recordsPath), recordsPath }
}

const results = []
function check(name, run) {
  try {
    run()
    results.push({ name, status: 'PASS' })
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack })
  }
}

check('WAL is written before business keys and removed only after commit', () => {
  const platform = createPlatform(makeInitial())
  const storage = createStorage(platform)
  assert.equal(storage.writeValuesAtomically(writesFor()), true)
  assertBusinessData(platform.storage, nextData)
  assert.equal(platform.storage.has(keys.journal), false)
  const journalWrite = platform.trace.findIndex((item) => item.operation === 'set' && item.key === keys.journal)
  const firstBusinessWrite = platform.trace.findIndex((item) => item.operation === 'set' && businessKeys.includes(item.key))
  const journalDelete = platform.trace.findIndex((item) => item.operation === 'remove' && item.key === keys.journal)
  assert(journalWrite >= 0 && firstBusinessWrite > journalWrite && journalDelete > firstBusinessWrite)
})

check('business write that lands then throws restores the exact raw snapshot including the failed key', () => {
  const platform = createPlatform(makeInitial(), [{ operation: 'set', key: keys.records, attempt: 1, after: true }])
  const storage = createStorage(platform)
  storage.readValueResult(keys.records, [])
  assert.equal(storage.writeValuesAtomically(writesFor()), false)
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
  assert.equal(storage.storageValueCache.has(keys.records), false)
})

check('each business write position and each rollback position is recoverable', () => {
  const writes = writesFor()
  for (const write of writes) {
    const platform = createPlatform(makeInitial(), [{ operation: 'set', key: write.key, attempt: 1 }])
    const storage = createStorage(platform)
    assert.equal(storage.writeValuesAtomically(writes), false, `failed write ${write.key}`)
    assertBusinessData(platform.storage, oldData)
    assert.equal(platform.storage.has(keys.journal), false, `journal after ${write.key}`)
  }

  for (const rollbackKey of businessKeys) {
    const platform = createPlatform(makeInitial(), [
      { operation: 'remove', key: keys.journal, attempt: 1 },
      { operation: 'set', key: rollbackKey, attempt: 2 },
    ])
    const firstStorage = createStorage(platform)
    assert.equal(firstStorage.writeValuesAtomically(writes), false, `failed rollback ${rollbackKey}`)
    assert.equal(platform.storage.has(keys.journal), true, `pending journal after ${rollbackKey}`)
    platform.setFailures([])
    const restartedStorage = createStorage(platform)
    assert.equal(restartedStorage.readValueResult(keys.records, []).ok, true, `restart recovery ${rollbackKey}`)
    assertBusinessData(platform.storage, oldData)
    assert.equal(platform.storage.has(keys.journal), false, `cleared journal after ${rollbackKey}`)
  }
})

check('journal delete that throws before removal restores all keys and reports failure', () => {
  const platform = createPlatform(makeInitial(), [{ operation: 'remove', key: keys.journal, attempt: 1 }])
  const storage = createStorage(platform)
  assert.equal(storage.writeValuesAtomically(writesFor()), false)
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
})

check('journal delete that throws after removal is confirmed as a committed save', () => {
  const platform = createPlatform(makeInitial(), [{ operation: 'remove', key: keys.journal, attempt: 1, after: true }])
  const storage = createStorage(platform)
  assert.equal(storage.writeValuesAtomically(writesFor()), true)
  assertBusinessData(platform.storage, nextData)
  assert.equal(platform.storage.has(keys.journal), false)
})

check('initial journal write that lands then throws never touches business keys', () => {
  const platform = createPlatform(makeInitial(), [{ operation: 'set', key: keys.journal, attempt: 1, after: true }])
  const storage = createStorage(platform)
  assert.equal(storage.writeValuesAtomically(writesFor()), false)
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
  assert.equal(platform.trace.some((item) => item.operation === 'set' && businessKeys.includes(item.key)), false)
})

check('journal write failure before persistence leaves business values untouched', () => {
  const platform = createPlatform(makeInitial(), [{ operation: 'set', key: keys.journal, attempt: 1 }])
  const storage = createStorage(platform)
  assert.equal(storage.writeValuesAtomically(writesFor()), false)
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
  assert.equal(platform.trace.some((item) => item.operation === 'set' && businessKeys.includes(item.key)), false)
})

check('raw non-array data is rejected even when a healthy array is cached', () => {
  const platform = createPlatform(makeInitial())
  const storage = createStorage(platform)
  assert.equal(storage.readValueResult(keys.records, []).ok, true)
  platform.storage.set(keys.records, true)
  platform.trace.length = 0
  assert.equal(storage.writeValuesAtomically(writesFor()), false)
  assert.equal(platform.trace.some((item) => item.operation === 'set' || item.operation === 'remove'), false)
  assert.equal(platform.storage.has(keys.journal), false)
  assert.equal(platform.storage.get(keys.records), true)
})

check('cold restart restores partial writes and removes keys that were originally absent', () => {
  const before = {
    [keys.records]: [{ id: 'raw-record', nested: { keep: true } }],
    [keys.projects]: [{ id: 'raw-project', name: '原始项目' }],
    [keys.favorites]: [],
  }
  const initial = {
    [keys.schema]: 4,
    [keys.records]: [{ id: 'partial-record' }],
    [keys.projects]: [{ id: 'partial-project', name: '临时项目' }],
    [keys.favorites]: [{ id: 'partial-favorite' }],
    [keys.recovery]: [{ id: 'partial-recovery' }],
    [keys.journal]: makeJournal(snapshotEntries(before), 'cold-restart'),
  }
  const platform = createPlatform(initial)
  const coldStorage = createStorage(platform)
  const result = coldStorage.readValueResult(keys.records, [])
  assert.deepEqual(result, { ok: true, value: before[keys.records] })
  assertBusinessData(platform.storage, before)
  assert.equal(platform.storage.has(keys.journal), false)
  assert.deepEqual(coldStorage.readValueResult(keys.records, []), result)
})

check('valid cross-realm journal data is accepted', () => {
  const platform = createPlatform(makeInitial({
    [keys.records]: [{ id: 'partial-record' }],
    [keys.journal]: makeJournal(snapshotEntries(), 'cross-realm'),
  }), [], { crossRealmReads: true })
  const storage = createStorage(platform)
  const result = storage.readValueResult(keys.records, [])
  assert.equal(result.ok, true)
  assert.deepEqual(clone(result.value), oldData[keys.records])
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
})

check('failed recovery blocks reads and writes, retries, and is idempotent', () => {
  const initial = makeInitial({
    [keys.records]: [{ id: 'partial-record' }],
    [keys.projects]: [{ id: 'partial-project', name: '临时项目' }],
    [keys.journal]: makeJournal(snapshotEntries(), 'retry-recovery'),
  })
  const platform = createPlatform(initial, [
    { operation: 'set', key: keys.records, attempt: 1 },
    { operation: 'set', key: keys.records, attempt: 2 },
  ])
  const storage = createStorage(platform)
  assert.equal(storage.readValueResult(keys.records, []).ok, false)
  assert.equal(storage.writeValue(keys.projects, [{ id: 'must-not-write' }]), false)
  assert.notDeepEqual(platform.storage.get(keys.projects), [{ id: 'must-not-write' }])
  assert.equal(platform.storage.has(keys.journal), true)
  platform.setFailures([])
  assert.deepEqual(storage.readValueResult(keys.records, []), { ok: true, value: oldData[keys.records] })
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
})

check('rollback failure leaves the undo log for cold-start recovery', () => {
  const platform = createPlatform(makeInitial(), [
    { operation: 'set', key: keys.records, attempt: 1 },
    { operation: 'set', key: keys.recovery, attempt: 2 },
  ])
  const firstStorage = createStorage(platform)
  assert.equal(firstStorage.writeValuesAtomically(writesFor()), false)
  assert.equal(platform.storage.has(keys.journal), true)
  assert.deepEqual(platform.storage.get(keys.recovery), nextData[keys.recovery])

  platform.setFailures([])
  const restartedStorage = createStorage(platform)
  assert.deepEqual(restartedStorage.readValueResult(keys.records, []), {
    ok: true,
    value: oldData[keys.records],
  })
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
})

check('recovery write that lands then throws is verified and completes safely', () => {
  const initial = makeInitial({
    [keys.records]: [{ id: 'partial-record' }],
    [keys.journal]: makeJournal(snapshotEntries(), 'restore-lands'),
  })
  const platform = createPlatform(initial, [{ operation: 'set', key: keys.records, attempt: 1, after: true }])
  const storage = createStorage(platform)
  assert.deepEqual(storage.readValueResult(keys.records, []), { ok: true, value: oldData[keys.records] })
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
})

check('journal cleanup failure after recovery leaves a retryable journal', () => {
  const initial = makeInitial({
    [keys.records]: [{ id: 'partial-record' }],
    [keys.journal]: makeJournal(snapshotEntries(), 'cleanup-retry'),
  })
  const platform = createPlatform(initial, [{ operation: 'remove', key: keys.journal, attempt: 1 }])
  const storage = createStorage(platform)
  assert.equal(storage.readValueResult(keys.records, []).ok, false)
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), true)
  platform.setFailures([])
  assert.deepEqual(storage.readValueResult(keys.records, []), { ok: true, value: oldData[keys.records] })
  assert.equal(platform.storage.has(keys.journal), false)
})

check('recovery cleanup that deletes then throws is confirmed by raw readback', () => {
  const initial = makeInitial({
    [keys.records]: [{ id: 'partial-record' }],
    [keys.journal]: makeJournal(snapshotEntries(), 'cleanup-after-delete'),
  })
  const platform = createPlatform(initial, [{ operation: 'remove', key: keys.journal, attempt: 1, after: true }])
  const storage = createStorage(platform)
  assert.deepEqual(storage.readValueResult(keys.records, []), { ok: true, value: oldData[keys.records] })
  assertBusinessData(platform.storage, oldData)
  assert.equal(platform.storage.has(keys.journal), false)
})

check('every pre-commit checkpoint recovers on cold start', () => {
  const writes = writesFor()
  for (let completed = 0; completed <= writes.length; completed += 1) {
    const partial = clone(oldData)
    for (const write of writes.slice(0, completed)) partial[write.key] = clone(write.value)
    const platform = createPlatform(makeInitial({
      ...partial,
      [keys.journal]: makeJournal(snapshotEntries(oldData), `checkpoint-${completed}`),
    }))
    const coldStorage = createStorage(platform)
    assert.equal(coldStorage.readValueResult(keys.records, []).ok, true, `checkpoint ${completed}`)
    assertBusinessData(platform.storage, oldData)
    assert.equal(platform.storage.has(keys.journal), false)
  }
})

check('a failed journal read blocks and retries recovery', () => {
  const platform = createPlatform(makeInitial({
    [keys.records]: [{ id: 'partial-record' }],
    [keys.journal]: makeJournal(snapshotEntries(), 'journal-read-retry'),
  }), [{ operation: 'get', key: keys.journal, attempt: 1 }])
  const storage = createStorage(platform)
  assert.equal(storage.readValueResult(keys.records, []).ok, false)
  assert.equal(platform.storage.has(keys.journal), true)
  assert.deepEqual(platform.storage.get(keys.records), [{ id: 'partial-record' }])
  platform.setFailures([])
  assert.deepEqual(storage.readValueResult(keys.records, []), { ok: true, value: oldData[keys.records] })
  assertBusinessData(platform.storage, oldData)
})

check('removeStorageSync fallback clears the journal and restores an absent key', () => {
  const before = { ...clone(oldData) }
  delete before[keys.recovery]
  const platform = createPlatform(makeInitial({
    [keys.recovery]: [{ id: 'partial-recovery' }],
    [keys.journal]: makeJournal(snapshotEntries(before), 'remove-fallback'),
  }), [], { removeAvailable: false })
  const storage = createStorage(platform)
  assert.equal(storage.readValueResult(keys.records, []).ok, true)
  assertBusinessData(platform.storage, before)
  assert.equal(storage.readRawStorageValue(keys.journal).present, false)
})

check('invalid logs and duplicate or illegal keys block without being overwritten', () => {
  const malformed = [
    { version: 2, transactionId: 'future-journal', entries: snapshotEntries() },
    { version: 1, schemaVersion: 3, transactionId: 'old-schema-journal', entries: snapshotEntries() },
    { version: 1, schemaVersion: 4, transactionId: 'illegal-key', entries: [{ key: keys.schema, present: true, value: 4 }] },
    { version: 1, schemaVersion: 4, transactionId: 'duplicate-key', entries: [
      { key: keys.records, present: true, value: clone(oldData[keys.records]) },
      { key: keys.records, present: true, value: clone(oldData[keys.records]) },
    ] },
    { version: 1, schemaVersion: 4, transactionId: 'bad-shape', entries: [{ key: keys.records, present: true }] },
    { version: 1, schemaVersion: 4, transactionId: 'non-array', entries: [
      { key: keys.records, present: true, value: true },
    ] },
    { version: 1, schemaVersion: 4, transactionId: 'empty-string', entries: [
      { key: keys.records, present: true, value: '' },
    ] },
  ]
  for (const journal of malformed) {
    const initial = makeInitial({ [keys.records]: [{ id: 'partial-record' }], [keys.journal]: journal })
    const platform = createPlatform(initial)
    const storage = createStorage(platform)
    const before = platform.snapshot()
    assert.equal(storage.readValueResult(keys.records, []).ok, false)
    assert.deepEqual(platform.snapshot(), before)
    assert.equal(platform.trace.some((item) => item.operation === 'remove' || item.operation === 'set'), false)
  }
})

check('future schema and schema read failure never restore an old snapshot', () => {
  const journal = makeJournal(snapshotEntries(), 'future-schema')
  const future = createPlatform(makeInitial({
    [keys.schema]: 5,
    [keys.records]: [{ id: 'partial-record' }],
    [keys.journal]: journal,
  }))
  const futureStorage = createStorage(future)
  const futureBefore = future.snapshot()
  assert.equal(futureStorage.readValueResult(keys.records, []).ok, false)
  assert.deepEqual(future.snapshot(), futureBefore)

  const readFailure = createPlatform(makeInitial({
    [keys.records]: [{ id: 'partial-record' }],
    [keys.journal]: journal,
  }), [{ operation: 'get', key: keys.schema, attempt: 1 }])
  const failedStorage = createStorage(readFailure)
  const readFailureBefore = readFailure.snapshot()
  assert.equal(failedStorage.readValueResult(keys.records, []).ok, false)
  assert.deepEqual(readFailure.snapshot(), readFailureBefore)
})

check('journal identity mismatch or failed readback preserves the current scene', () => {
  const replacement = makeJournal(snapshotEntries(), 'other-transaction')
  const mismatch = createPlatform(makeInitial(), [{
    operation: 'remove', key: keys.journal, attempt: 1, replaceValue: replacement,
  }])
  const mismatchStorage = createStorage(mismatch)
  assert.equal(mismatchStorage.writeValuesAtomically(writesFor()), false)
  assertBusinessData(mismatch.storage, nextData)
  assert.deepEqual(mismatch.storage.get(keys.journal), replacement)

  const readbackFailure = createPlatform(makeInitial(), [
    { operation: 'remove', key: keys.journal, attempt: 1 },
    { operation: 'get', key: keys.journal, attempt: 2 },
  ])
  const readbackStorage = createStorage(readbackFailure)
  assert.equal(readbackStorage.writeValuesAtomically(writesFor()), false)
  assertBusinessData(readbackFailure.storage, nextData)
  assert.equal(readbackFailure.storage.has(keys.journal), true)
})

check('deleted journal with failed raw readback stays ambiguous and does not trigger rollback', () => {
  const platform = createPlatform(makeInitial(), [
    { operation: 'remove', key: keys.journal, attempt: 1, after: true },
    { operation: 'get', key: keys.journal, attempt: 2 },
  ])
  const storage = createStorage(platform)
  assert.equal(storage.writeValuesAtomically(writesFor()), false)
  assertBusinessData(platform.storage, nextData)
  assert.equal(platform.storage.has(keys.journal), false)
})

check('migration backup restoration cannot bypass a pending write journal', () => {
  const migrationKeys = [keys.schema, keys.projects, keys.records, keys.favorites, keys.recovery, keys.active]
  const backupValues = { [keys.schema]: 4, ...oldData }
  const backupStorage = Object.fromEntries(migrationKeys.map((key) => (
    Object.prototype.hasOwnProperty.call(backupValues, key)
      ? [key, { present: true, value: clone(backupValues[key]) }]
      : [key, { present: false }]
  )))
  const backup = {
    id: 'migration-backup-one',
    version: 1,
    migration: 'independent-favorites-v1',
    schemaVersionBefore: 4,
    createdAt: 100,
    storage: backupStorage,
  }
  const initial = makeInitial({
    [keys.records]: [{ id: 'partial-record' }],
    [keys.projects]: [{ id: 'partial-project', name: '临时项目' }],
    'audioTool.storageMigrationBackups.v1': { version: 1, entries: [backup] },
    [keys.journal]: makeJournal(snapshotEntries(), 'backup-restore-gate'),
  })
  const platform = createPlatform(initial, [{ operation: 'set', key: keys.records, attempt: 1 }])
  const previousWx = global.wx
  const loaded = createRecordsApi(platform)
  try {
    const beforeBackup = clone(platform.storage.get('audioTool.storageMigrationBackups.v1'))
    assert.equal(loaded.api.restoreStorageMigrationBackup(backup.id), false)
    assert.deepEqual(platform.storage.get('audioTool.storageMigrationBackups.v1'), beforeBackup)
    assert.equal(platform.storage.has(keys.journal), true)
    assert.equal(platform.storage.get(keys.records)[0].id, 'partial-record')

    platform.setFailures([])
    assert.equal(loaded.api.restoreStorageMigrationBackup(backup.id), true)
    assertBusinessData(platform.storage, oldData)
    assert.equal(platform.storage.has(keys.journal), false)
  } finally {
    delete require.cache[loaded.recordsPath]
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

check('readProjectWiringStorage and active-project reads recover before accessing cached state', () => {
  const project = { id: 'project-old', name: '原始项目', createdAt: 100, updatedAt: 100 }
  const otherProject = { id: 'project-new', name: '临时项目', createdAt: 200, updatedAt: 200 }
  const platform = createPlatform({
    [keys.schema]: 4,
    [keys.projects]: [project],
    [keys.records]: [],
    [keys.favorites]: [],
    [keys.recovery]: [],
    [keys.active]: project.id,
  })
  const previousWx = global.wx
  const loaded = createRecordsApi(platform)
  try {
    assert.equal(loaded.api.getProjects()[0].id, project.id)
    platform.storage.set(keys.projects, [otherProject])
    platform.storage.set(keys.journal, makeJournal([
      { key: keys.projects, present: true, value: [project] },
    ], 'wiring-read'))
    assert.equal(loaded.api.getProjectWiring(project.id).project.id, project.id)
    assert.equal(loaded.api.getProjects()[0].id, project.id)

    platform.storage.set(keys.projects, [otherProject])
    platform.storage.set(keys.journal, makeJournal([
      { key: keys.projects, present: true, value: [project] },
    ], 'active-read'))
    assert.equal(loaded.api.getActiveProject().id, project.id)
    assert.equal(platform.storage.has(keys.journal), false)
  } finally {
    delete require.cache[loaded.recordsPath]
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

console.log(JSON.stringify({ results }, null, 2))
if (results.some((item) => item.status !== 'PASS')) process.exitCode = 1

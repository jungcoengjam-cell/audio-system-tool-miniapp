'use strict'

const assert = require('node:assert/strict')

const recordsPath = require.resolve('../utils/records')
const keys = {
  schema: 'audioTool.storageSchemaVersion',
  projects: 'audioTool.projects.v1',
  records: 'audioTool.records.v1',
  favorites: 'audioTool.favorites.v1',
  recovery: 'audioTool.recovery.v1',
  backups: 'audioTool.storageMigrationBackups.v1',
  journal: 'audioTool.storageMigrationJournal.v1',
}
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const project = { id: 'old-project', name: '旧项目', createdAt: 100, updatedAt: 200, notes: '保留' }
const preferences = { speakerCount: '2', distanceText: '8' }
const record = {
  id: 'old-record',
  module: 'spl',
  title: '旧声压估算',
  summary: '理论估算',
  preferences,
  resultText: '旧结果：500W，#200',
  signature: JSON.stringify(['spl', preferences]),
  favorite: true,
  archived: false,
  projectIds: [project.id],
  createdAt: 110,
  updatedAt: 210,
}
const initial = {
  [keys.schema]: 3,
  [keys.projects]: [project],
  [keys.records]: [record],
}

function setup() {
  const storage = new Map(Object.entries(clone(initial)))
  const writeEvents = []
  let failWriteKey = ''
  let failRemoveKey = ''
  global.wx = {
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync: (key, value) => {
      writeEvents.push({ key, value: clone(value) })
      if (key === failWriteKey) throw new Error('injected write failure: ' + key)
      storage.set(key, clone(value))
    },
    removeStorageSync: (key) => {
      if (key === failRemoveKey) throw new Error('injected remove failure: ' + key)
      storage.delete(key)
    },
    showToast: () => {},
  }
  delete require.cache[recordsPath]
  return {
    api: require(recordsPath),
    storage,
    writeEvents,
    failWrite: (key) => { failWriteKey = key },
    failRemove: (key) => { failRemoveKey = key },
  }
}

function assertOriginalRows(fixture) {
  assert.equal(fixture.storage.get(keys.schema), 3)
  assert.deepEqual(fixture.storage.get(keys.projects), initial[keys.projects])
  assert.deepEqual(fixture.storage.get(keys.records), initial[keys.records])
  assert.equal(fixture.storage.has(keys.favorites), false)
}
function backupEntries(fixture) {
  const value = fixture.storage.get(keys.backups)
  return value?.version === 1 && Array.isArray(value.entries) ? value.entries : []
}
function assertBackupRetainsOwnerData(fixture, count = 1) {
  const entries = backupEntries(fixture)
  assert.equal(entries.length, count)
  const saved = entries[0]
  assert.equal(saved.version, 1)
  assert.equal(saved.migration, 'independent-favorites-v1')
  assert.equal(saved.schemaVersionBefore, 3)
  assert.deepEqual(saved.storage[keys.projects], { present: true, value: initial[keys.projects] })
  assert.deepEqual(saved.storage[keys.records], { present: true, value: initial[keys.records] })
}
function assertMigratedOnce(fixture) {
  const snapshot = fixture.api.getWorkspaceSnapshot({ forceRefresh: true })
  assert.equal(snapshot.ok, true)
  assert.equal(fixture.storage.get(keys.schema), 4)
  assert.equal(fixture.storage.has(keys.journal), false)
  assert.equal(fixture.api.getProjectRecords(project.id).filter((item) => item.id === record.id).length, 1)
  assert.equal(fixture.api.getFavorites().filter((item) => item.id === record.id).length, 1)
  assertBackupRetainsOwnerData(fixture)
}

const results = []
function check(name, body) {
  try {
    body()
    results.push({ name, status: 'PASS' })
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack })
  }
}

const previousWx = global.wx
try {
  check('backup write failure leaves valid old data untouched and retries once', () => {
    const fixture = setup()
    fixture.failWrite(keys.backups)
    const blocked = fixture.api.getWorkspaceSnapshot({ forceRefresh: true })
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /创建迁移前备份失败/)
    assertOriginalRows(fixture)
    assert.equal(fixture.storage.has(keys.backups), false)
    assert.equal(fixture.storage.has(keys.journal), false)

    fixture.failWrite('')
    assertMigratedOnce(fixture)
    const stable = clone(Object.fromEntries(fixture.storage))
    assertMigratedOnce(fixture)
    assert.deepEqual(Object.fromEntries(fixture.storage), stable)
  })

  check('journal write failure preserves the backup and retries without duplicate backups', () => {
    const fixture = setup()
    fixture.failWrite(keys.journal)
    const blocked = fixture.api.getWorkspaceSnapshot({ forceRefresh: true })
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /保存项目数据迁移状态失败/)
    assertOriginalRows(fixture)
    assert.equal(fixture.storage.has(keys.journal), false)
    assertBackupRetainsOwnerData(fixture)

    fixture.failWrite('')
    assertMigratedOnce(fixture)
    assert.deepEqual(fixture.api.getStorageMigrationBackups().backups.map((item) => item.schemaVersionBefore), [3])
  })

  check('favorite snapshot failure rolls back converted records and retries idempotently', () => {
    const fixture = setup()
    fixture.failWrite(keys.favorites)
    const blocked = fixture.api.getWorkspaceSnapshot({ forceRefresh: true })
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /项目数据迁移未完成/)
    const convertedWriteIndex = fixture.writeEvents.findIndex((event) => event.key === keys.records
      && event.value?.[0]?.id === record.id && event.value[0].favorite === false)
    const favoriteFailureIndex = fixture.writeEvents.findIndex((event) => event.key === keys.favorites)
    assert(convertedWriteIndex >= 0, 'Converted project record was never written before failure')
    assert(favoriteFailureIndex > convertedWriteIndex, 'Favorite write did not fail after converted records were written')
    assert.equal(fixture.storage.get(keys.records)[0].favorite, true, 'Rollback must restore legacy favorite=true')
    assertOriginalRows(fixture)
    assert.equal(fixture.storage.has(keys.journal), true)
    assertBackupRetainsOwnerData(fixture)

    fixture.failWrite('')
    assertMigratedOnce(fixture)
    const stable = clone(Object.fromEntries(fixture.storage))
    assertMigratedOnce(fixture)
    assert.deepEqual(Object.fromEntries(fixture.storage), stable)
    assert.equal(fixture.api.getProjectRecords(project.id).filter((item) => item.id === record.id).length, 1)
    assert.equal(fixture.api.getFavorites().filter((item) => item.id === record.id).length, 1)
  })

  check('journal cleanup failure is observable as incomplete and retry is idempotent', () => {
    const fixture = setup()
    fixture.failRemove(keys.journal)
    const incomplete = fixture.api.getWorkspaceSnapshot({ forceRefresh: true })
    assert.equal(incomplete.ok, false, 'Schema 4 alone must not report migration success while the journal remains')
    assert.match(incomplete.error, /迁移状态未能清理/)
    assert.equal(fixture.storage.get(keys.schema), 4)
    assert.equal(fixture.storage.has(keys.journal), true)
    assertBackupRetainsOwnerData(fixture)
    assert.equal(fixture.storage.get(keys.records).filter((item) => item.id === record.id).length, 1)
    assert.equal(fixture.storage.get(keys.favorites).filter((item) => item.id === record.id).length, 1)

    fixture.failRemove('')
    assertMigratedOnce(fixture)
    const stable = clone(Object.fromEntries(fixture.storage))
    assertMigratedOnce(fixture)
    assert.deepEqual(Object.fromEntries(fixture.storage), stable)
  })
} finally {
  delete require.cache[recordsPath]
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

console.log(JSON.stringify({ results }, null, 2))
if (results.some((item) => item.status !== 'PASS')) process.exitCode = 1

'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const storage = new Map()
const writes = []
let failFavoriteWrite = false

const preferences = { sceneMode: 'meeting', speakerModel: 'legacy-speaker' }
const canonicalRecord = {
  id: 'venue-project-record',
  module: 'venue',
  title: '项目记录中的受保护标题',
  summary: '项目记录中的受保护摘要',
  resultText: '项目记录中的受保护正文',
  preferences,
  signature: JSON.stringify(['venue', preferences]),
  favorite: false,
  projectIds: ['project-1'],
  projectMetadata: { 'project-1': { note: '项目专属备注', savedAt: 10 } },
  createdAt: 10,
  updatedAt: 11,
}

storage.set('audioTool.storageSchemaVersion', 4)
storage.set('audioTool.projects.v1', [{ id: 'project-1', name: '历史项目', createdAt: 1, updatedAt: 1 }])
storage.set('audioTool.records.v1', [canonicalRecord])
storage.set('audioTool.favorites.v1', [])
storage.set('audioTool.recovery.v1', [])

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) {
    if (failFavoriteWrite && key === 'audioTool.favorites.v1') throw new Error('simulated favorites write failure')
    writes.push({ key, value })
    storage.set(key, value)
  },
}

function loadFreshRecords() {
  const filename = path.join(root, 'utils/records.js')
  delete require.cache[filename]
  return require(filename)
}

function json(value) {
  return JSON.stringify(value)
}

let records = loadFreshRecords()
assert.equal(records.getFavoriteByPayload({ module: 'venue', preferences: { sceneMode: 'unrecorded' } }), null)
const writesBeforeUnanchoredCreation = writes.length
assert.equal(records.saveFavoriteSnapshot({
  module: 'venue',
  title: '无项目记录的新收藏',
  summary: '无记录摘要',
  resultText: '无记录正文',
  preferences: { sceneMode: 'unrecorded' },
}), null, 'a new retired-module favorite needs a matching canonical project record')
assert.equal(writes.length, writesBeforeUnanchoredCreation, 'an unanchored legacy favorite performs no write')
assert.deepEqual(storage.get('audioTool.favorites.v1'), [])

const recordsBeforeCreate = json(storage.get('audioTool.records.v1'))
const callerPayload = {
  ...canonicalRecord,
  id: 'forged-record-id',
  title: '调用方伪造标题',
  summary: '调用方伪造摘要',
  resultText: '调用方伪造正文',
  signature: 'caller-supplied-signature',
  projectIds: ['forged-project'],
  projectMetadata: { 'forged-project': { note: '不应复制' } },
}
const created = records.saveFavoriteSnapshot(callerPayload, { saveAs: true })
assert(created, 'a favorite may be copied from a same-identity canonical project record')
assert.notEqual(created.id, canonicalRecord.id, 'the copied favorite gets an independent ID')
assert.equal(created.title, canonicalRecord.title)
assert.equal(created.summary, canonicalRecord.summary)
assert.equal(created.resultText, canonicalRecord.resultText)
assert.deepEqual(created.preferences, canonicalRecord.preferences)
assert.equal(created.signature, canonicalRecord.signature, 'favorite identity is computed from module and preferences')
assert.deepEqual(created.originProjectIds, canonicalRecord.projectIds)
assert.deepEqual(created.projectIds, [])
assert.equal(Object.hasOwn(created, 'projectMetadata'), false, 'project-only metadata stays on the project record')
assert.equal(json(storage.get('audioTool.records.v1')), recordsBeforeCreate,
  'creating a favorite does not rewrite project records or metadata')

const createdAsLegacySnapshot = {
  ...created,
  title: '收藏快照历史自定义标题',
  summary: '收藏快照历史摘要',
  resultText: '收藏快照历史正文',
  snapshotNote: 'favorite-only data',
  updatedAt: 20,
}
storage.set('audioTool.favorites.v1', [createdAsLegacySnapshot])
records = loadFreshRecords()
const writesBeforeExistingUpdate = writes.length
const updatedExisting = records.saveFavoriteSnapshot({
  ...canonicalRecord,
  id: 'forged-favorite-id',
  title: '更新调用方标题',
  summary: '更新调用方摘要',
  resultText: '更新调用方正文',
  signature: 'forged-signature',
}, { favoriteId: created.id })
assert(updatedExisting, 'the matching existing legacy favorite remains manageable')
assert.equal(updatedExisting.id, created.id)
assert.equal(updatedExisting.title, createdAsLegacySnapshot.title,
  'an existing favorite keeps its own historical custom title instead of canonical title')
assert.equal(updatedExisting.summary, createdAsLegacySnapshot.summary)
assert.equal(updatedExisting.resultText, createdAsLegacySnapshot.resultText)
assert.deepEqual(updatedExisting.preferences, createdAsLegacySnapshot.preferences)
assert.equal(updatedExisting.snapshotNote, createdAsLegacySnapshot.snapshotNote)
assert.equal(updatedExisting.signature, canonicalRecord.signature,
  'the stored signature is recomputed from the verified identity, not copied from the caller')
assert.equal(writes.length, writesBeforeExistingUpdate + 1)
assert.equal(json(storage.get('audioTool.records.v1')), recordsBeforeCreate,
  'favorite management leaves the canonical project record unchanged')

const favoritesBeforeRejectedIds = json(storage.get('audioTool.favorites.v1'))
const writesBeforeRejectedIds = writes.length
assert.equal(records.saveFavoriteSnapshot({
  ...callerPayload,
  preferences: { sceneMode: 'changed-identity' },
}, { favoriteId: created.id }), null, 'favoriteId cannot authorize changed preferences')
assert.equal(records.saveFavoriteSnapshot(callerPayload, { favoriteId: 'unknown-favorite-id' }), null,
  'an unknown favoriteId cannot create a favorite')
assert.equal(json(storage.get('audioTool.favorites.v1')), favoritesBeforeRejectedIds)
assert.equal(writes.length, writesBeforeRejectedIds, 'rejected identities perform no storage writes')

const favoriteStoreBeforeWriteFailure = json(storage.get('audioTool.favorites.v1'))
const writesBeforeWriteFailure = writes.length
failFavoriteWrite = true
try {
  assert.equal(records.saveFavoriteSnapshot(callerPayload, { favoriteId: created.id }), null,
    'a failed favorite store write reports failure')
} finally {
  failFavoriteWrite = false
}
assert.equal(json(storage.get('audioTool.favorites.v1')), favoriteStoreBeforeWriteFailure,
  'a failed write preserves the old snapshot')
assert.equal(writes.length, writesBeforeWriteFailure)

const favoriteOnlyPreferences = { sceneMode: 'orphan-favorite-only' }
const favoriteOnly = {
  id: 'legacy-favorite-without-project-record',
  module: 'venue',
  title: '孤立收藏中的历史标题',
  summary: '孤立收藏中的历史摘要',
  resultText: '孤立收藏中的历史正文',
  preferences: favoriteOnlyPreferences,
  signature: JSON.stringify(['venue', favoriteOnlyPreferences]),
  favorite: true,
  archived: false,
  projectIds: [],
  originProjectIds: [],
  createdAt: 30,
  updatedAt: 31,
}
storage.set('audioTool.favorites.v1', [favoriteOnly])
records = loadFreshRecords()
assert.equal(records.getFavoriteByPayload(favoriteOnly).title, favoriteOnly.title,
  'an existing favorite-only legacy snapshot remains readable without a canonical record')
const favoriteOnlyManagement = records.saveFavoriteSnapshot({
  ...favoriteOnly,
  title: 'caller overwrite',
  summary: 'caller overwrite',
  resultText: 'caller overwrite',
  signature: 'caller overwrite',
}, { favoriteId: favoriteOnly.id })
assert(favoriteOnlyManagement, 'an orphan favorite remains manageable by its matching saved identity')
assert.equal(favoriteOnlyManagement.title, favoriteOnly.title)
assert.equal(favoriteOnlyManagement.summary, favoriteOnly.summary)
assert.equal(favoriteOnlyManagement.resultText, favoriteOnly.resultText)
assert.deepEqual(favoriteOnlyManagement.preferences, favoriteOnly.preferences)

console.log('legacy favorite contract regression PASS')

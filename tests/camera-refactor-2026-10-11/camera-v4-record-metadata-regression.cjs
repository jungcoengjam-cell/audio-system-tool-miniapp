'use strict'

const assert = require('node:assert/strict')

const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const FAVORITES_KEY = 'audioTool.favorites.v1'
const RECOVERY_KEY = 'audioTool.recovery.v1'
const ACTIVE_KEY = 'audioTool.activeProject.v1'
const SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const CAMERA_PREFERENCES_KEY = 'audioTool.camera.preferences'
const SCHEMA_VERSION = 4
const storage = new Map([
  [RECORDS_KEY, []],
  [PROJECTS_KEY, []],
  [FAVORITES_KEY, []],
  [RECOVERY_KEY, []],
  [ACTIVE_KEY, ''],
  [SCHEMA_KEY, SCHEMA_VERSION],
])
let failedWriteKey = ''
const navigation = []

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

global.wx = {
  getStorageSync(key) {
    return clone(storage.get(key))
  },
  setStorageSync(key, value) {
    if (key === failedWriteKey) throw new Error(`simulated ${key} write failure`)
    storage.set(key, clone(value))
  },
  removeStorageSync(key) {
    storage.delete(key)
  },
  getStorageInfoSync() {
    return { currentSize: 1, limitSize: 1024 }
  },
  navigateTo({ url }) {
    navigation.push(url)
  },
}

delete require.cache[require.resolve('../../utils/records')]
let records = require('../../utils/records')
const resultRecordContext = require('../../utils/result-record-context')

function attachEditor(record, sourceKind, projectId, originalPreferences) {
  storage.set(CAMERA_PREFERENCES_KEY, clone(originalPreferences))
  const sessionId = resultRecordContext.openRecordEditor(record, sourceKind, projectId)
  assert(sessionId, 'opening a saved camera result creates an editor context session')
  const session = resultRecordContext.getSession(sessionId)
  assert(session)
  assert.equal(session.sourceKind, sourceKind)
  assert.equal(session.recordId, sourceKind === 'project-record' ? record.id : '')
  assert.equal(session.projectId, projectId || '')
  assert.deepEqual(session.originalPreferences, originalPreferences,
    'the editor session captures existing temporary camera preferences')
  assert(navigation.at(-1).includes(`editorSessionId=${encodeURIComponent(sessionId)}`),
    'the calculator route carries the editor session identity')

  const page = {
    data: {},
    setData(changes) { Object.assign(this.data, changes) },
  }
  const attached = resultRecordContext.attachResultEditor(page, 'camera', { editorSessionId: sessionId })
  assert(attached)
  assert.equal(page._resultEditorSessionId, sessionId)
  assert.equal(page.data.editorSessionActive, true)
  assert.equal(page.data.editorSourceKind, sourceKind)
  assert.deepEqual(storage.get(CAMERA_PREFERENCES_KEY), session.preferences,
    'the page reads working preferences from its attached saved-result session')
  return { sessionId, session, page }
}

function cancelEditor({ sessionId, page }, originalPreferences) {
  assert.equal(resultRecordContext.discardResultEditor(page), true,
    'cancelling the saved-result editor discards its working copy')
  assert.equal(resultRecordContext.getSession(sessionId), null)
  assert.deepEqual(storage.get(CAMERA_PREFERENCES_KEY), originalPreferences,
    'cancelling restores the exact temporary camera preferences')
}

const projectA = records.createProject('V4 相机项目 A')
const projectB = records.createProject('V4 相机项目 B')
assert(projectA && projectB)
assert.equal(records.STORAGE_SCHEMA_VERSION, 4)
assert.equal(storage.get(SCHEMA_KEY), SCHEMA_VERSION, 'project metadata fixtures use the current schema 4')

const legacyPreferences = {
  sourceMode: 'library',
  cameraIndex: 0,
  lensIndex: 0,
  targetMode: 'ground',
  groundWidthText: '6',
  setbackText: '4.83',
  cameraHeightText: '2.3',
}
const legacyRecord = {
  id: 'camera-record-v3-legacy',
  module: 'camera',
  title: '旧版摄像机收藏标题',
  summary: '旧版摄像机记录摘要',
  resultText: '旧版摄像机结果文本',
  preferences: legacyPreferences,
  favorite: false,
  projectIds: [projectA.id],
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
}
const legacyFavorite = {
  ...legacyRecord,
  id: 'camera-favorite-v3-legacy',
  favorite: true,
  originProjectIds: [projectA.id],
  projectIds: [],
}
storage.set(RECORDS_KEY, [legacyRecord])
storage.set(FAVORITES_KEY, [legacyFavorite])
delete require.cache[require.resolve('../../utils/records')]
records = require('../../utils/records')
const legacyLoaded = records.getRecords().find((item) => item.id === legacyRecord.id)
const legacyFavoriteLoaded = records.getFavorites().find((item) => item.id === legacyFavorite.id)
assert(legacyLoaded, 'V3 camera record remains readable after V4 metadata extension')
assert(legacyFavoriteLoaded, 'V3 camera favorite remains readable in the independent favorites catalog')
assert.equal(legacyLoaded.projectMetadata, undefined, 'legacy camera record is not rewritten with synthetic metadata')
const legacyView = records.getProjectRecordView(legacyLoaded, projectA.id)
assert.equal(legacyView.title, legacyRecord.title, 'old project camera record keeps its shared title without metadata')
assert.equal(legacyView.hasProjectMetadata, undefined)
assert.equal(legacyView.projectNote, undefined)
assert.deepEqual(storage.get(RECORDS_KEY), [legacyRecord], 'reading old camera record does not mutate persisted bytes')
assert.deepEqual(storage.get(FAVORITES_KEY), [legacyFavorite], 'reading old camera favorite does not mutate persisted bytes')
const temporaryPreferences = { sourceMode: 'library', cameraModel: 'temporary-model', temporaryMarker: 'keep' }
storage.set(CAMERA_PREFERENCES_KEY, temporaryPreferences)
assert.equal(records.restoreRecord(legacyLoaded), '/pages/camera/camera')
assert.deepEqual(storage.get(CAMERA_PREFERENCES_KEY), temporaryPreferences,
  'the route helper does not directly replace temporary preferences')
const legacyEditor = attachEditor(legacyFavoriteLoaded, 'favorite', '', temporaryPreferences)
assert.deepEqual(storage.get(CAMERA_PREFERENCES_KEY), { ...legacyPreferences, cameraCalculationVersion: 2 },
  'the attached favorite session provides a working copy with its current calculation marker')
assert.deepEqual(storage.get(RECORDS_KEY), [legacyRecord], 'opening an old camera favorite does not mutate the project record')
assert.deepEqual(storage.get(FAVORITES_KEY), [legacyFavorite], 'opening an old camera favorite does not mutate its snapshot')
cancelEditor(legacyEditor, temporaryPreferences)
assert.deepEqual(storage.get(RECORDS_KEY), [legacyRecord], 'cancelling preserves the original persisted camera record')
assert.deepEqual(storage.get(FAVORITES_KEY), [legacyFavorite], 'cancelling preserves the original camera favorite snapshot')
assert.equal(storage.get(SCHEMA_KEY), SCHEMA_VERSION)

const cameraPreferences = {
  sourceMode: 'library',
  cameraIndex: 0,
  lensIndex: 0,
  targetMode: 'ground',
  groundWidthText: '6',
  groundDepthText: '8',
  setbackText: '4.83',
  cameraHeightText: '2.3',
  aimAngleText: '0',
}
const payload = {
  module: 'camera',
  title: '摄像机安装计算',
  summary: '视场角与安装参数',
  resultText: '镜头距区域前沿：4.83 m\n建议镜头高：2.3 m',
  preferences: cameraPreferences,
}
const signature = JSON.stringify(['camera', cameraPreferences])
const globalTitle = payload.title
const globalResultText = payload.resultText
const globalPreferences = clone(payload.preferences)

const savedA = records.addRecordToProject(payload, projectA.id, {
  name: 'A 项目的相机配置',
  note: 'A 备注',
})
assert(savedA, 'camera metadata is accepted by the project record API')
assert.equal(savedA.module, 'camera')
assert.equal(savedA.signature, signature, 'project metadata is not part of the record signature')
assert.equal(savedA.title, globalTitle, 'project name does not replace the shared camera title')
assert.equal(savedA.resultText, globalResultText)
assert.deepEqual(savedA.preferences, globalPreferences)
assert.deepEqual(Object.keys(savedA.preferences), Object.keys(cameraPreferences),
  'project metadata is not appended to serialized camera preferences')
assert.deepEqual(savedA.projectIds, [projectA.id])
assert.equal(savedA.projectMetadata[projectA.id].name, 'A 项目的相机配置')
assert.equal(savedA.projectMetadata[projectA.id].note, 'A 备注')
assert(Number.isFinite(savedA.projectMetadata[projectA.id].savedAt))
assert.equal(storage.get(SCHEMA_KEY), SCHEMA_VERSION)

const savedB = records.addRecordToProject(payload, projectB.id, {
  name: 'B 项目的相机配置',
  note: 'B 备注',
})
assert.equal(savedB.id, savedA.id, 'same camera preferences share one canonical record')
assert.deepEqual(savedB.projectIds, [projectA.id, projectB.id])
assert.equal(savedB.projectMetadata[projectA.id].name, 'A 项目的相机配置')
assert.equal(savedB.projectMetadata[projectA.id].note, 'A 备注')
assert.equal(savedB.projectMetadata[projectB.id].name, 'B 项目的相机配置')
assert.equal(savedB.projectMetadata[projectB.id].note, 'B 备注')
assert.equal(savedB.title, globalTitle)
assert.equal(savedB.resultText, globalResultText)
assert.deepEqual(savedB.preferences, globalPreferences)
assert.equal(savedB.signature, signature)

const viewA = records.getProjectRecordView(savedB, projectA.id)
const viewB = records.getProjectRecordView(savedB, projectB.id)
assert.equal(viewA.title, 'A 项目的相机配置')
assert.equal(viewA.projectNote, 'A 备注')
assert.equal(viewA.hasProjectMetadata, true)
assert.equal(viewB.title, 'B 项目的相机配置')
assert.equal(viewB.projectNote, 'B 备注')
assert.equal(viewB.hasProjectMetadata, true)
assert.equal(records.getRecordByPayload(payload).title, globalTitle,
  'project-specific views do not mutate the shared camera favorite title')

const updatedA = records.addRecordToProject(payload, projectA.id, {
  name: 'A 项目更新配置',
  note: 'A 更新备注',
})
assert.equal(updatedA.id, savedA.id)
assert.equal(updatedA.projectMetadata[projectA.id].name, 'A 项目更新配置')
assert.equal(updatedA.projectMetadata[projectA.id].note, 'A 更新备注')
assert.equal(updatedA.projectMetadata[projectB.id].name, 'B 项目的相机配置',
  'updating project A leaves project B metadata intact')
assert.equal(updatedA.projectMetadata[projectB.id].note, 'B 备注')

const favorited = records.toggleFavorite(payload)
assert.equal(favorited.favorite, true)
assert.notEqual(favorited.id, savedA.id, 'the independent favorite has its own snapshot identity')
assert.equal(favorited.title, globalTitle, 'favorite title remains the canonical shared title')
assert.equal(favorited.summary, payload.summary)
assert.equal(favorited.resultText, globalResultText)
assert.deepEqual(favorited.preferences, globalPreferences)
assert.equal(favorited.signature, signature)
assert.deepEqual(favorited.projectIds, [], 'a favorite is not linked into project records')
assert.deepEqual(favorited.originProjectIds, [projectA.id, projectB.id])
assert.equal(favorited.projectMetadata, undefined, 'a favorite snapshot does not copy project-only metadata')
const temporaryFavoritePreferences = { sourceMode: 'library', cameraModel: 'temporary-favorite-context' }
assert.equal(records.restoreRecord(favorited), '/pages/camera/camera')
assert.deepEqual(storage.get(CAMERA_PREFERENCES_KEY), temporaryPreferences,
  'the route helper leaves the current temporary preferences untouched')
const favoriteRecordsBeforeEditor = clone(storage.get(RECORDS_KEY))
const favoriteSnapshotsBeforeEditor = clone(storage.get(FAVORITES_KEY))
const favoriteEditor = attachEditor(favorited, 'favorite', '', temporaryFavoritePreferences)
assert.deepEqual(storage.get(CAMERA_PREFERENCES_KEY), { ...globalPreferences, cameraCalculationVersion: 2 },
  'a favorite opens as a context-scoped working copy')
assert.deepEqual(storage.get(RECORDS_KEY), favoriteRecordsBeforeEditor)
assert.deepEqual(storage.get(FAVORITES_KEY), favoriteSnapshotsBeforeEditor)
cancelEditor(favoriteEditor, temporaryFavoritePreferences)
assert.deepEqual(storage.get(RECORDS_KEY), favoriteRecordsBeforeEditor)
assert.deepEqual(storage.get(FAVORITES_KEY), favoriteSnapshotsBeforeEditor)
assert.equal(storage.get(SCHEMA_KEY), SCHEMA_VERSION)

function snapshot() {
  return {
    records: clone(storage.get(RECORDS_KEY)),
    projects: clone(storage.get(PROJECTS_KEY)),
  }
}

const beforeRecordsFailure = snapshot()
failedWriteKey = RECORDS_KEY
assert.equal(records.addRecordToProject(payload, projectA.id, {
  name: '不得保存的 A 配置',
  note: 'records 写失败',
}), null, 'records write failure rejects the metadata mutation')
failedWriteKey = ''
assert.deepEqual(snapshot(), beforeRecordsFailure, 'records write failure leaves both stores unchanged')
assert.equal(records.getRecordByPayload(payload).projectMetadata[projectA.id].name, 'A 项目更新配置',
  'records write failure leaves the cached metadata unchanged')

const beforeProjectsFailure = snapshot()
failedWriteKey = PROJECTS_KEY
assert.equal(records.addRecordToProject(payload, projectA.id, {
  name: '不得保存的 B 配置',
  note: 'projects 写失败',
}), null, 'project timestamp write failure rejects the metadata mutation')
failedWriteKey = ''
assert.deepEqual(snapshot(), beforeProjectsFailure,
  'project write failure rolls back the preceding camera record write')
assert.equal(records.getRecordByPayload(payload).projectMetadata[projectB.id].name, 'B 项目的相机配置',
  'project write rollback preserves the project B metadata')

assert.equal(records.removeRecordFromProject(savedA.id, projectA.id), true)
let afterRemoval = records.getRecordByPayload(payload)
assert.deepEqual(afterRemoval.projectIds, [projectB.id])
assert.equal(afterRemoval.projectMetadata[projectA.id], undefined,
  'removing camera record from project A clears only A metadata')
assert.equal(afterRemoval.projectMetadata[projectB.id].name, 'B 项目的相机配置')
assert.equal(afterRemoval.favorite, false, 'project records do not embed independent favorites')
assert.equal(afterRemoval.title, globalTitle)

const reattachedA = records.addRecordToProject(payload, projectA.id, {
  name: 'A 重关联配置',
  note: 'A 重关联备注',
})
assert.equal(reattachedA.id, savedA.id)
assert(records.deleteProject(projectA.id), 'deleting project A succeeds')
let afterProjectDeletion = records.getRecordByPayload(payload)
assert.deepEqual([...afterProjectDeletion.projectIds].sort(), [projectA.id, projectB.id].sort(),
  'project deletion keeps the record link so recovery can restore the same project identity')
assert.equal(afterProjectDeletion.projectMetadata[projectA.id].name, 'A 重关联配置',
  'project deletion retains metadata with the recoverable record association')
assert.equal(afterProjectDeletion.projectMetadata[projectB.id].name, 'B 项目的相机配置')
assert.equal(afterProjectDeletion.title, globalTitle)
assert.equal(records.getProjects().some((item) => item.id === projectA.id), false)
const deletedProjectA = records.getRecoveryEntries().find((entry) => entry.kind === 'project' && entry.targetId === projectA.id)
assert(deletedProjectA, 'deleted project A is retained in the recovery catalog')
assert(records.restoreRecoveryEntry(deletedProjectA.id), 'project A can be recovered with its original ID')
assert.equal(records.getProjectRecords(projectA.id)[0].id, savedA.id)

assert(records.deleteProject(projectB.id), 'deleting project B succeeds')
const afterSecondProjectDeletion = records.getRecordByPayload(payload)
assert.deepEqual([...afterSecondProjectDeletion.projectIds].sort(), [projectA.id, projectB.id].sort(),
  'deleting project B also keeps the record link while the project is recoverable')
const deletedProjectB = records.getRecoveryEntries().find((entry) => entry.kind === 'project' && entry.targetId === projectB.id)
assert(deletedProjectB, 'deleted project B is retained in the recovery catalog')
assert(records.restoreRecoveryEntry(deletedProjectB.id), 'project B can be recovered with its original ID')
assert.equal(records.removeRecordFromProject(savedA.id, projectA.id), true)
assert.equal(records.removeRecordFromProject(savedA.id, projectB.id), true)
assert.equal(records.getRecordByPayload(payload), null,
  'explicitly removing the last project link removes the project record')
const independentFavorite = records.getFavoriteByPayload(payload)
assert(independentFavorite, 'the independent favorite remains after all project links are removed')
assert.deepEqual(independentFavorite.projectIds, [])
assert.deepEqual(independentFavorite.preferences, globalPreferences)
assert.equal(independentFavorite.title, globalTitle)
assert.equal(independentFavorite.resultText, globalResultText)
assert.equal(independentFavorite.signature, signature)
assert.equal(storage.get(SCHEMA_KEY), SCHEMA_VERSION, 'camera metadata operations preserve schema version 4')

process.stdout.write('camera-v4-record-metadata-regression: PASS\n')

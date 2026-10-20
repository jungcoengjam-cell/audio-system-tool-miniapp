'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')
const { cameras } = require('../../data/cameras')
const records = require('../../utils/records')

const PREFS_KEY = 'audioTool.camera.preferences'
const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const FAVORITES_KEY = 'audioTool.favorites.v1'
const RECOVERY_KEY = 'audioTool.recovery.v1'
const SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const SCHEMA_VERSION = 4
const PROJECT_ID = 'project-v3-camera-legacy'
const NOW = 1791710000000
const resultRecordContext = require('../../utils/result-record-context')

function tap(index) { return { currentTarget: { dataset: { index: String(index) } } } }

function makeEnvironment(seed = {}) {
  const env = createDelayedEnvironment()
  for (const [key, value] of Object.entries(seed)) env.storage.set(key, env.clone(value))
  return env
}

function loadPage(env, options = {}) {
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad(options)
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  return page
}

function legacyCustomPreferences() {
  return {
    sourceMode: 'custom',
    cameraModel: 'TV-6124HK',
    viewIndex: 0,
    viewLabel: '旧自定义角度',
    definitionMode: 'angles',
    customMountType: 'fixed',
    customHorizontalFovText: '73.25',
    customVerticalFovText: '41.75',
    customSensorWidthText: '17.125',
    customSensorHeightText: '9.625',
    customFocalLengthText: '22.375',
    sceneMode: 'ground',
    heightMode: 'fixed',
    marginPercent: 15,
    groundWidthText: '7.25',
    groundDepthText: '12.5',
    subjectHeightText: '2.1',
    planeWidthText: '5.5',
    planeHeightText: '3.25',
    planeBottomHeightText: '0.65',
    fixedCameraHeightText: '2.75',
    legacyOpaqueField: { preserve: true, marker: 'v3-custom-record' },
  }
}

function makePersistentRecord(preferences, { projectIds = [] } = {}) {
  return {
    id: 'record-v3-camera-legacy',
    module: 'camera',
    title: 'V3 legacy camera record',
    summary: 'stored camera result',
    preferences,
    signature: JSON.stringify(['camera', preferences]),
    resultText: 'Historical camera result bytes must remain unchanged.',
    favorite: false,
    projectIds,
    createdAt: NOW,
    updatedAt: NOW,
    legacyOpaqueRecordField: { retain: ['exact', 'bytes'] },
  }
}

function makeFavoriteSnapshot(record) {
  return {
    ...record,
    id: `favorite-${record.id}`,
    favorite: true,
    originProjectIds: [...record.projectIds],
    projectIds: [],
  }
}

function makeProject() {
  return {
    id: PROJECT_ID,
    name: 'V3 legacy camera project',
    venueName: '', engineer: '', projectDate: '2026-10-11', notes: '',
    roomLengthText: '', roomWidthText: '', roomHeightText: '',
    standardClassKey: 'conference', gradeKey: 'II',
    createdAt: NOW, updatedAt: NOW,
  }
}

function snapshotRawStorage(env, keys = [PREFS_KEY, RECORDS_KEY, PROJECTS_KEY, FAVORITES_KEY, RECOVERY_KEY, SCHEMA_KEY]) {
  return Object.fromEntries(keys.map((key) => [key,
    env.storage.has(key) ? JSON.stringify(env.storage.get(key)) : null]))
}

function openRestoredPage(env, record, sourceKind, projectId = '') {
  const originalPreferences = env.storage.has(PREFS_KEY) ? env.clone(env.storage.get(PREFS_KEY)) : undefined
  const sessionId = resultRecordContext.openRecordEditor(record, sourceKind, projectId)
  assert(sessionId, 'opening a saved camera result creates an editor context session')
  const session = resultRecordContext.getSession(sessionId)
  assert(session, 'the saved camera editor session is persisted before navigation')
  assert.equal(session.sourceKind, sourceKind)
  assert.deepEqual(session.originalPreferences, originalPreferences,
    'the editor session retains the preexisting temporary preferences for cancellation')
  assert.equal(session.recordId, sourceKind === 'project-record' ? record.id : '')
  assert.equal(session.projectId, projectId)
  const navigation = env.navigation.at(-1)
  assert(navigation?.url.includes(`editorSessionId=${encodeURIComponent(sessionId)}`),
    'the camera page is opened with the saved editor session identity')
  if (projectId) assert(navigation.url.includes(`projectId=${encodeURIComponent(projectId)}`))

  const page = loadPage(env, { editorSessionId: sessionId })
  assert.equal(page._resultEditorSessionId, sessionId)
  assert.equal(page.data.editorSessionActive, true, 'camera onLoad attaches the saved editor context')
  assert.equal(page.data.editorSourceKind, sourceKind)
  return { sessionId, session, page }
}

function testLegacyCustomRestoreIsUnsupportedAndPreservesRawRecords() {
  const preferences = legacyCustomPreferences()
  const project = makeProject()
  const record = makePersistentRecord(preferences, { projectIds: [PROJECT_ID] })
  const favoriteSnapshot = makeFavoriteSnapshot(record)
  const temporaryPreferences = {
    sourceMode: 'library', cameraModel: 'TV-6124HK', groundWidthText: '6.5',
    temporaryMarker: 'preserve-on-cancel',
  }
  const env = makeEnvironment({
    [PREFS_KEY]: temporaryPreferences,
    [RECORDS_KEY]: [record],
    [PROJECTS_KEY]: [project],
    [FAVORITES_KEY]: [favoriteSnapshot],
    [RECOVERY_KEY]: [],
    [SCHEMA_KEY]: SCHEMA_VERSION,
  })
  const beforeRestore = snapshotRawStorage(env)
  const workspace = records.getWorkspaceSnapshot({ forceRefresh: true })
  assert.equal(workspace.ok, true)
  const favorite = workspace.favorites.find((item) => item.id === favoriteSnapshot.id)
  const projectRecord = records.getProjectRecords(PROJECT_ID).find((item) => item.id === record.id)
  assert(favorite, 'the legacy custom snapshot remains in the independent favorites catalog')
  assert(projectRecord, 'the legacy custom calculation record remains in its project')

  for (const { restoreSource, sourceKind, projectId } of [
    { restoreSource: favorite, sourceKind: 'favorite', projectId: '' },
    { restoreSource: projectRecord, sourceKind: 'project-record', projectId: PROJECT_ID },
  ]) {
    assert.equal(records.restoreRecord(restoreSource), '/pages/camera/camera')
    assert.equal(JSON.stringify(env.storage.get(PREFS_KEY)), beforeRestore[PREFS_KEY],
      'the route lookup does not overwrite temporary preferences')
    const { sessionId, page } = openRestoredPage(env, restoreSource, sourceKind, projectId)
    assert.equal(page.data.legacyCustomUnsupported, true)
    assert.equal(page.data.result, null, 'restored custom angle data must not silently calculate as a library camera')
    assert.match(page.data.resultEmptyText, /旧自定义配置.*无法计算/)
    assert.equal(page.data.customHorizontalFovText, preferences.customHorizontalFovText,
      'unsupported custom parameters remain readable in the attached editor session')
    assert.equal(page.data.customVerticalFovText, preferences.customVerticalFovText)
    assert.equal(page.data.selectedCamera.model, 'TV-6124HK', 'library metadata may be displayed but does not replace unsupported input')
    assert.equal(typeof page.onSourceModeTap, 'undefined', 'the removed custom-source handler is not reachable')
    assert.equal(typeof page.onDefinitionModeTap, 'undefined', 'the removed optics-definition handler is not reachable')
    page.toggleCurrentFavorite()
    page.saveToActiveProject()
    page.generateResultReportImage()
    page.onFieldInput({ currentTarget: { dataset: { field: 'groundWidthText' } }, detail: { value: '99' } })
    page.onSceneModeTap(tap(1))
    page.onPreviewViewTap(tap(1))
    env.flushNextTicks()
    assert.equal(page.data.result, null, 'disabled actions and controls cannot revive a legacy custom result')
    assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), beforeRestore[RECORDS_KEY],
      'opening and using an unsupported favorite/project record preserves its original record bytes')
    assert.equal(JSON.stringify(env.storage.get(FAVORITES_KEY)), beforeRestore[FAVORITES_KEY],
      'opening an unsupported favorite preserves its independent snapshot bytes')
    assert.equal(JSON.stringify(env.storage.get(PROJECTS_KEY)), beforeRestore[PROJECTS_KEY])
    assert.equal(records.getRecords().filter((item) => item.id === record.id).length, 1, 'unsupported restore does not duplicate the record')
    page.onUnload()
    assert.equal(resultRecordContext.getSession(sessionId), null, 'leaving an unchanged editor closes its context session')
    const after = snapshotRawStorage(env)
    assert.deepEqual(after, beforeRestore, 'cancelling an unchanged legacy editor restores original temporary preferences and stored snapshots')
  }

  return { status: 'passed', identity: record.id, favoriteIdentity: favorite.id, restoredFrom: ['favorite', 'project'], rawStorage: 'byte-equivalent JSON' }
}

function testExplicitLibrarySelectionAndResetAreRecoveryActions() {
  const preferences = legacyCustomPreferences()
  const record = makePersistentRecord(preferences, { projectIds: [PROJECT_ID] })
  const favoriteSnapshot = makeFavoriteSnapshot(record)
  const env = makeEnvironment({
    [PREFS_KEY]: preferences,
    [RECORDS_KEY]: [record],
    [PROJECTS_KEY]: [makeProject()],
    [FAVORITES_KEY]: [favoriteSnapshot],
    [RECOVERY_KEY]: [],
    [SCHEMA_KEY]: SCHEMA_VERSION,
  })
  records.getWorkspaceSnapshot({ forceRefresh: true })
  const recordBytesBefore = JSON.stringify(env.storage.get(RECORDS_KEY))
  const favoriteBytesBefore = JSON.stringify(env.storage.get(FAVORITES_KEY))
  const page = loadPage(env)
  assert.equal(page.data.result, null)
  page.openCameraSelector()
  const sameLibraryModel = page.data.selectorItems.find((item) => item.model === 'TV-6124HK')
  assert(sameLibraryModel, 'selector includes the library model currently shown as the legacy record context')
  page.selectCamera(tap(sameLibraryModel.index))
  env.flushNextTicks()
  assert.equal(page.data.legacyCustomUnsupported, false)
  assert.equal(page.data.sourceModeIndex, 0)
  assert.equal(page.data.selectedCamera.model, 'TV-6124HK')
  assert(page.data.result, 'an explicit model selection restores a fresh library calculation')
  assert(Number.isFinite(page.data.result.primaryDistanceMeters), 'the explicitly selected library model has a numeric fresh result')
  const selectedLibraryDistance = page.data.result.primaryDistanceMeters
  assert.equal(env.storage.get(PREFS_KEY).sourceMode, 'library')
  assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), recordBytesBefore,
    'explicit library selection leaves the historic custom favorite/project record intact')
  assert.equal(JSON.stringify(env.storage.get(FAVORITES_KEY)), favoriteBytesBefore,
    'explicit library selection leaves the independent historical favorite intact')

  page.resetToDefaults()
  env.flushNextTicks()
  assert.equal(page.data.selectedCamera.model, 'TV-6124HK')
  assert.equal(page.data.result, null, 'reset leaves the calculator empty until new dimensions are entered')
  for (const field of [
    'groundWidthText', 'groundDepthText', 'subjectHeightText',
    'planeWidthText', 'planeHeightText', 'planeBottomHeightText', 'fixedCameraHeightText',
    'customHorizontalFovText', 'customVerticalFovText', 'customSensorWidthText',
    'customSensorHeightText', 'customFocalLengthText',
  ]) assert.equal(page.data[field], '', `${field} remains blank after reset`)
  assert.deepEqual(env.storage.get(PREFS_KEY), page.getPreferences(),
    'reset persists the blank numeric values and default selectors')
  assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), recordBytesBefore,
    'reset only recovers page defaults; it does not remove legacy records')
  assert.equal(JSON.stringify(env.storage.get(FAVORITES_KEY)), favoriteBytesBefore,
    'reset leaves the independent historical favorite intact')
  return { status: 'passed', selectedModel: page.data.selectedCamera.model, selectedLibraryDistance, reset: 'blank-inputs-no-result' }
}

function testDormantCustomFieldsKeepLibraryFavoriteSignatureOnRestore() {
  const seedPreferences = {
    sourceMode: 'library',
    cameraModel: 'TV-6124HK',
    viewIndex: 0,
    viewLabel: '广角端',
    definitionMode: 'sensor',
    customMountType: 'fixed',
    customHorizontalFovText: '73.125',
    customVerticalFovText: '41.875',
    customSensorWidthText: '13.375',
    customSensorHeightText: '8.625',
    customFocalLengthText: '22.875',
    sceneMode: 'ground',
    heightMode: 'auto',
    marginPercent: 10,
    groundWidthText: '6',
    groundDepthText: '4',
    subjectHeightText: '1.8',
    planeWidthText: '6',
    planeHeightText: '2.5',
    planeBottomHeightText: '0.8',
    fixedCameraHeightText: '2.3',
  }
  assert(cameras.some((camera) => camera.model === seedPreferences.cameraModel))
  const env = makeEnvironment({
    [PREFS_KEY]: seedPreferences,
    [RECORDS_KEY]: [],
    [PROJECTS_KEY]: [makeProject()],
    [FAVORITES_KEY]: [],
    [RECOVERY_KEY]: [],
    [SCHEMA_KEY]: SCHEMA_VERSION,
  })
  records.getWorkspaceSnapshot({ forceRefresh: true })
  const firstPage = loadPage(env)
  assert(firstPage.data.result, 'library preferences still calculate through the active product catalog')
  const preferences = firstPage.getPreferences()
  for (const field of ['customHorizontalFovText', 'customVerticalFovText', 'customSensorWidthText',
    'customSensorHeightText', 'customFocalLengthText']) {
    assert.equal(preferences[field], seedPreferences[field], `dormant field ${field} must remain part of the library preference identity`)
  }
  assert.equal(preferences.definitionMode, 'sensor')
  assert.equal(preferences.customMountType, 'fixed')

  const signature = JSON.stringify(['camera', preferences])
  const record = makePersistentRecord(preferences, { projectIds: [PROJECT_ID] })
  record.signature = signature
  const favoriteSnapshot = makeFavoriteSnapshot(record)
  favoriteSnapshot.signature = signature
  env.storage.set(RECORDS_KEY, [record])
  env.storage.set(FAVORITES_KEY, [favoriteSnapshot])
  records.getWorkspaceSnapshot({ forceRefresh: true })
  firstPage.onShow()
  assert.equal(firstPage.data.currentFavorite, true, 'favorite lookup uses the full ordered preference signature with dormant values')
  assert.equal(records.getRecordByPayload(firstPage.getRecordLookupPayload())?.id, record.id)
  const recordBytes = JSON.stringify(env.storage.get(RECORDS_KEY))
  const projectBytes = JSON.stringify(env.storage.get(PROJECTS_KEY))
  const favoriteBytes = JSON.stringify(env.storage.get(FAVORITES_KEY))

  const storedFavorite = records.getFavorites().find((item) => item.id === favoriteSnapshot.id)
  assert(storedFavorite)
  const temporaryPreferences = { ...preferences, groundWidthText: '6.75', temporaryMarker: 'restore-exactly' }
  env.storage.set(PREFS_KEY, temporaryPreferences)
  assert.equal(records.restoreRecord(storedFavorite), '/pages/camera/camera')
  assert.deepEqual(env.storage.get(PREFS_KEY), temporaryPreferences,
    'the legacy route helper does not replace the current temporary preference set')
  const { sessionId, page: restoredPage } = openRestoredPage(env, storedFavorite, 'favorite')
  assert.equal(restoredPage.data.result?.displayModel, firstPage.data.result.displayModel)
  assert.equal(restoredPage.data.currentFavorite, true)
  assert.equal(records.getRecordByPayload(restoredPage.getRecordLookupPayload())?.id, record.id,
    'the favorite editor still resolves its separate project record identity')
  assert.equal(records.getFavoriteByPayload(restoredPage.getRecordLookupPayload())?.id, storedFavorite.id,
    'the restored page resolves the independent favorite snapshot by its full parameter signature')
  assert.equal(records.getRecords().length, 1, 'entering a favorite does not create a duplicate project record')
  assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), recordBytes, 'favorite lookup leaves original project record bytes unchanged')
  assert.equal(JSON.stringify(env.storage.get(FAVORITES_KEY)), favoriteBytes, 'favorite lookup leaves original favorite bytes unchanged')
  assert.equal(JSON.stringify(env.storage.get(PROJECTS_KEY)), projectBytes, 'page restore does not rewrite the project catalog')
  assert(records.getProjectRecords(PROJECT_ID).some((item) => item.id === record.id))
  restoredPage.onUnload()
  assert.equal(resultRecordContext.getSession(sessionId), null)
  assert.deepEqual(env.storage.get(PREFS_KEY), temporaryPreferences,
    'leaving the favorite editor restores the exact preexisting temporary preferences')
  firstPage.onUnload()
  return { status: 'passed', signature, identity: record.id, favoriteIdentity: storedFavorite.id, preservedDormantFields: true }
}

function testUnsupportedStructuredCameraOperationHasNoResultOrPreferenceWrite() {
  const env = makeEnvironment()
  const page = loadPage(env)
  const before = snapshotRawStorage(env)
  const returned = page.beginStructuredOperation({
    horizontalFov: 60, verticalFov: 36, sceneMode: 'ground', widthMeters: 6, depthMeters: 4,
  }, 'full-area')
  env.flushNextTicks()
  assert.equal(returned?.status, 'unsupported')
  assert.equal(returned?.active, false)
  assert.equal(returned?.ready, false)
  assert.equal(page.data.result, null)
  assert.match(page.data.operationUnsupportedMessage, /仅支持库内摄像机/)
  assert.equal(snapshotRawStorage(env)[PREFS_KEY], before[PREFS_KEY], 'unsupported angle-based operation is not silently converted and stored as a library model')
  assert.equal(page.data.sourceModeIndex, 0)
  return { status: 'passed', message: page.data.operationUnsupportedMessage }
}

function run() {
  return {
    status: 'passed',
    legacyCustomRestore: testLegacyCustomRestoreIsUnsupportedAndPreservesRawRecords(),
    explicitLibraryRecovery: testExplicitLibrarySelectionAndResetAreRecoveryActions(),
    dormantLibrarySignature: testDormantCustomFieldsKeepLibraryFavoriteSignatureOnRestore(),
    structuredUnsupported: testUnsupportedStructuredCameraOperationHasNoResultOrPreferenceWrite(),
  }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`)

module.exports = { run }

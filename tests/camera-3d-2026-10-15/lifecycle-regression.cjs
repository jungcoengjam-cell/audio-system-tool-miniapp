'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')
const env = createDelayedEnvironment()
const preferencesKey = 'audioTool.camera.preferences'
const favoritesKey = 'audioTool.favorites.v1'
const records = require('../../utils/records')
const resultRecordContext = require('../../utils/result-record-context')

env.storage.set(preferencesKey, { cameraCalculationVersion: 1 })

function open(options = {}) {
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad(options)
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  return page
}

function openSavedRecord(record, sourceKind, projectId = '') {
  const sessionId = resultRecordContext.openRecordEditor(record, sourceKind, projectId)
  assert(sessionId, `${sourceKind} record opens a real result-editor session`)
  const session = resultRecordContext.getSession(sessionId)
  assert(session)
  assert.equal(session.sourceKind, sourceKind)
  assert.equal(session.recordId, sourceKind === 'project-record' ? record.id : '')
  assert.equal(session.projectId, projectId)
  assert(env.navigation.at(-1)?.url.includes(`editorSessionId=${encodeURIComponent(sessionId)}`),
    'navigation uses the result-editor session route')
  const page = open({ editorSessionId: sessionId })
  assert.equal(page._resultEditorSessionId, sessionId)
  assert.equal(page.data.editorSourceKind, sourceKind)
  assert.equal(page.data.editorSessionActive, true)
  return { sessionId, page }
}

const originalPage = open()
assert.equal(originalPage.data.result.primaryDistanceMeters, 4.83)
assert.equal(originalPage.getPreferences().cameraCalculationVersion, undefined)
const project = records.createProject('camera framing history QA')
assert(project)
const originalPayload = originalPage.getRecordPayload()
const v1Record = records.addRecordToProject(originalPayload, project.id, { name: 'V1 camera layout', note: '' })
assert(v1Record)
assert.equal(v1Record.preferences.cameraCalculationVersion, undefined,
  'v1 project snapshot retains the legacy implicit-version representation')
const favorite = records.toggleFavorite(originalPayload)
assert(favorite)
assert.equal(records.getProjectRecords(project.id).length, 1)
assert.equal(records.getFavorites().length, 1, 'favorites and project records are separate stores')
const oldProjectRecord = JSON.parse(JSON.stringify(v1Record))
const originalFavorite = JSON.parse(JSON.stringify(favorite))
const originalFavoriteStorage = JSON.stringify(env.storage.get(favoritesKey))
originalPage.onUnload()

const { sessionId: v1SessionId, page: reopenedV1 } = openSavedRecord(v1Record, 'project-record', project.id)
assert.equal(reopenedV1.data.result.primaryDistanceMeters, 4.83, 'a real v1 project editor session reopens with its original distance')
assert.equal(reopenedV1.getPreferences().cameraCalculationVersion, undefined,
  'an unchanged historical project record keeps its implicit v1 preference representation')
reopenedV1.onThemeChange({ theme: 'dark' }); env.flushNextTicks()
assert.equal(reopenedV1.data.result.primaryDistanceMeters, 4.83)
assert.deepEqual(records.getRecords().find((item) => item.id === v1Record.id), oldProjectRecord,
  'opening and theming the v1 project record never rewrite its stored project row')
assert.equal(JSON.stringify(env.storage.get(favoritesKey)), originalFavoriteStorage,
  'opening and theming never rewrite the independent favorite snapshot')
const oldSignature = reopenedV1.getResultReportSignature()
reopenedV1.setData({ resultReportImagePath: 'wxfile://old-light.png' })
reopenedV1.resultReportSignature = oldSignature
reopenedV1.commitCalculatedState({}); env.flushNextTicks()
assert.equal(reopenedV1.data.resultReportImagePath, 'wxfile://old-light.png',
  'an unchanged v1 calculation retains its theme-matched PNG')
reopenedV1.onThemeChange({ theme: 'light' }); env.flushNextTicks()
assert.notEqual(reopenedV1.getResultReportSignature(), oldSignature)
assert.equal(reopenedV1.data.resultReportImagePath, '', 'a theme switch invalidates the cached PNG')
reopenedV1.onMarginChange({ detail: { value: '4' } }); env.flushNextTicks()
assert.equal(reopenedV1.data.result.framingVersion, 2, 'an explicit input edit opts into the current calculation')
assert.equal(reopenedV1.getPreferences().cameraCalculationVersion, 2)
assert.equal(reopenedV1.data.result.depthMeters, 4)
assert.equal(reopenedV1.data.result.depthMarginMeters, 0)
const newResult = JSON.parse(JSON.stringify(reopenedV1.data.result))
const v2Record = records.addRecordToProject(reopenedV1.getRecordPayload(), project.id,
  { name: 'V2 camera layout', note: '' })
assert(v2Record && v2Record.id !== v1Record.id, 'a v2 save creates a distinct project record')
assert.equal(v2Record.preferences.cameraCalculationVersion, 2)
assert.deepEqual(records.getRecords().find((item) => item.id === v1Record.id), oldProjectRecord,
  'the v1 project record and historical result remain unchanged')
assert.deepEqual(records.getFavorites().find((item) => item.id === favorite.id), originalFavorite,
  'editing the project record does not mutate the independent favorite snapshot')
assert.equal(resultRecordContext.discardResultEditor(reopenedV1), true,
  'the saved v2 project row is retained while the remaining editor draft is explicitly discarded')
reopenedV1.onUnload()
assert.equal(resultRecordContext.getSession(v1SessionId), null)

const temporaryPreferencesBeforeFavorite = JSON.stringify(env.storage.get(preferencesKey))
const { sessionId: favoriteSessionId, page: favoritePage } = openSavedRecord(favorite, 'favorite')
assert.equal(favoritePage.data.result.framingVersion, 2,
  'opening a favorite creates a current v2 working copy without changing its stored snapshot')
assert.equal(favoritePage.getPreferences().cameraCalculationVersion, 2)
assert.equal(JSON.stringify(env.storage.get(favoritesKey)), originalFavoriteStorage)
assert.deepEqual(records.getRecords().find((item) => item.id === v1Record.id), oldProjectRecord,
  'the canonical project record remains available while the favorite opens independently')
favoritePage.onUnload()
assert.equal(resultRecordContext.getSession(favoriteSessionId), null)
assert.equal(JSON.stringify(env.storage.get(preferencesKey)), temporaryPreferencesBeforeFavorite,
  'leaving the favorite editor restores the exact temporary preferences')

const { sessionId: v2SessionId, page: reopenedV2 } = openSavedRecord(v2Record, 'project-record', project.id)
assert.equal(reopenedV2.data.result.primaryDistanceMeters, newResult.primaryDistanceMeters)
assert.deepEqual(reopenedV2.data.result.framingBounds, newResult.framingBounds)
assert.equal(reopenedV2.data.result.framingVersion, 2)
reopenedV2.resetToDefaults(); env.flushNextTicks()
assert.equal(reopenedV2.data.result, null)
assert.equal(reopenedV2.data.groundWidthText, '')
assert.equal(records.getProjectRecords(project.id).length, 2, 'reset preserves both project records')
assert.equal(records.getFavorites().length, 1, 'reset preserves the independent favorite snapshot')
assert.deepEqual(records.getRecords().find((item) => item.id === v1Record.id), oldProjectRecord)
assert.deepEqual(records.getFavorites().find((item) => item.id === favorite.id), originalFavorite)
assert.equal(resultRecordContext.discardResultEditor(reopenedV2), true)
reopenedV2.onUnload()
assert.equal(resultRecordContext.getSession(v2SessionId), null)
assert.equal(env.offlineAttempts.length, 0, 'camera calculations and record actions remain offline')

console.log(JSON.stringify({
  status: 'passed',
  checks: [
    'v1 project record through real editor session',
    'favorite uses a separate snapshot and v2 working copy',
    'theme-aware PNG cache invalidation',
    'stored project and favorite bytes remain immutable on open/theme/edit',
    'explicit input edit switches editor session to v2',
    'v2 project record reopens with matching spatial bounds',
    'reset clears inputs while preserving both project records and favorite',
  ],
}, null, 2))

'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')
const records = require('../../utils/records')

const PREFS_KEY = 'audioTool.camera.preferences'
const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'

function event(index) { return { currentTarget: { dataset: { index: String(index) } } } }
function projectEvent(id) { return { currentTarget: { dataset: { id } } } }

function createPage() {
  const env = createDelayedEnvironment()
  env.wx.getFileSystemManager = () => ({
    access({ path, success }) { success?.({ path }) },
  })
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  records.getWorkspaceSnapshot({ forceRefresh: true })
  return { env, page }
}

function snapshotInputs(page) {
  return Object.fromEntries([
    'cameraIndex', 'viewIndex', 'sceneModeIndex', 'heightModeIndex', 'marginIndex',
    'groundWidthText', 'groundDepthText', 'subjectHeightText',
    'planeWidthText', 'planeHeightText', 'planeBottomHeightText', 'fixedCameraHeightText',
  ].map((field) => [field, page.data[field]]))
}

function selectCamera(env, page, model) {
  page.openCameraSelector()
  const item = page.data.selectorItems.find((candidate) => candidate.model === model)
  assert(item, `the library selector should contain ${model}`)
  page.selectCamera(event(item.index))
  env.flushNextTicks()
  return item
}

function testLibrarySwitchesAndRemovedCustomHandlersStayUnavailable() {
  const { env, page } = createPage()
  assert(page.data.result, 'the default library calculation should be ready')
  assert.equal(page.data.sourceModeIndex, 0)
  for (const handler of [
    'onSourceModeTap', 'onDefinitionModeTap', 'onCustomMountTypeTap',
    'copyInstallSummary', 'copyResult', 'toggleCalculationDetails',
  ]) {
    assert.equal(typeof page[handler], 'undefined', `${handler} must remain removed with the V3 UI`)
  }

  selectCamera(env, page, 'TS-0650JSM')
  assert.equal(page.data.viewOptions.length, 2, 'the selected library camera should expose both views')
  for (let repetition = 0; repetition < 2; repetition += 1) {
    page.onViewTap(event(1))
    env.flushNextTicks()
    assert.equal(page.data.viewIndex, 1)
    assert(page.data.result, 'switching the second library view should retain a result')
    page.onViewTap(event(0))
    env.flushNextTicks()
    assert.equal(page.data.viewIndex, 0)

    page.onSceneModeTap(event(1))
    env.flushNextTicks()
    assert.equal(page.data.sceneModeIndex, 1)
    assert.equal(page.data.result.sceneMode, 'plane')
    page.onSceneModeTap(event(0))
    env.flushNextTicks()
    assert.equal(page.data.sceneModeIndex, 0)
    assert.equal(page.data.result.sceneMode, 'ground')

    page.onHeightModeTap(event(1))
    env.flushNextTicks()
    assert.equal(page.data.result.heightMode, 'fixed')
    page.onHeightModeTap(event(0))
    env.flushNextTicks()
    assert.equal(page.data.result.heightMode, 'auto')

    page.onMarginChange({ detail: { value: 0 } })
    env.flushNextTicks()
    assert.equal(page.data.result.marginPercent, 0)
    page.onMarginChange({ detail: { value: 4 } })
    env.flushNextTicks()
    assert.equal(page.data.result.marginPercent, 20)
  }

  const stored = env.storage.get(PREFS_KEY)
  assert.equal(stored.sourceMode, 'library')
  assert.equal(stored.cameraModel, 'TS-0650JSM')
  assert.equal(stored.sceneMode, 'ground')
  assert.equal(stored.heightMode, 'auto')
  assert.equal(stored.marginPercent, 20)
  assert.equal(page.data.legacyCustomUnsupported, false)
  page._cameraUnloaded = true
  return { status: 'passed', model: stored.cameraModel, viewCount: 2, repetitions: 2 }
}

function testFavoriteSharePreviewCancellationProjectAndResetKeepData() {
  const { env, page } = createPage()
  const initialInputs = snapshotInputs(page)
  const previewCalls = []
  const shareCalls = []
  const saveCalls = []
  const toastCount = () => env.effects.toasts.length
  env.wx.previewImage = (options) => previewCalls.push(options)
  env.wx.showShareImageMenu = (options) => shareCalls.push(options)
  env.wx.saveImageToPhotosAlbum = (options) => saveCalls.push(options)

  page.toggleCurrentFavorite()
  const favoriteRecords = records.getRecords().filter((record) => record.module === 'camera' && record.favorite)
  assert.equal(favoriteRecords.length, 1, 'favorite action should persist one current library record')
  assert.equal(page.data.currentFavorite, true)

  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, 1, 'share rail action should start report drawing')
  env.finishDraw(0)
  env.flushNextTicks()
  assert.equal(env.pending.canvases.length, 1, 'finished report drawing should export an image')
  env.finishCanvas(0, 'wxfile://camera-v3-actions-qa.png')
  env.flushNextTicks()
  assert.equal(page.data.resultReportPreviewVisible, true, 'report generation should open the preview sheet')
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-v3-actions-qa.png')

  page.previewResultReportImage()
  assert.equal(page.data.resultReportImageViewerVisible, true,
    'preview action should open the generated image in the in-app viewer')
  assert.equal(previewCalls.length, 0, 'preview uses the current in-app viewer rather than the old native preview API')

  const beforeShareCancelToasts = toastCount()
  page.shareResultReportImage()
  assert.equal(shareCalls[0]?.path, 'wxfile://camera-v3-actions-qa.png')
  shareCalls[0].fail?.({ errMsg: 'showShareImageMenu:fail cancel' })
  assert.equal(toastCount(), beforeShareCancelToasts, 'canceling native share should not show an error toast')

  const beforeSaveCancelToasts = toastCount()
  page.saveResultReportImage()
  assert.equal(saveCalls[0]?.filePath, 'wxfile://camera-v3-actions-qa.png')
  saveCalls[0].fail?.({ errMsg: 'saveImageToPhotosAlbum:fail cancel' })
  assert.equal(toastCount(), beforeSaveCancelToasts, 'canceling photo save should not show an error toast')

  page.closeResultReportImageViewer()
  assert.equal(page.data.resultReportImageViewerVisible, false, 'closing the in-app viewer returns to the report preview sheet')
  page.closeResultReportPreview(true)
  assert.equal(page.data.resultReportPreviewVisible, false, 'close/return should dismiss the preview sheet')
  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(page.data.resultReportPreviewVisible, true, 'reopening an unchanged report should reuse and show it')
  assert.equal(env.pending.draws.length, 0, 'reopening an unchanged report should not redraw')
  page.closeResultReportPreview(true)
  assert.deepEqual(snapshotInputs(page), initialInputs, 'preview, share cancellation, save cancellation and return preserve inputs')

  const project = records.createProject('Camera V3 actions QA')
  assert(project, 'project save test needs a local project')
  records.getWorkspaceSnapshot({ forceRefresh: true })
  const previousGetCurrentPages = global.getCurrentPages
  global.getCurrentPages = () => [page]
  page._pageVisible = true
  try {
    assert.equal(page.saveToActiveProject(), true)
    assert.equal(page.data.projectDialogStep, 'select')
    assert.equal(page.selectCameraProjectTarget(projectEvent(project.id)), true)
    assert.equal(page.data.projectDialogStep, 'confirm', 'choosing a project opens an in-page confirmation step')
    assert.equal(page.closeCameraProjectDialog(true), true, 'closing before confirmation cancels the project save')
    assert.deepEqual(snapshotInputs(page), initialInputs, 'canceling project confirmation preserves inputs')
    assert.equal(records.getProjectRecords(project.id).length, 0, 'canceling confirmation must not write the record to the project')

    assert.equal(page.saveToActiveProject(), true)
    assert.equal(page.selectCameraProjectTarget(projectEvent(project.id)), true)
    assert.equal(page.saveCameraProjectTarget(), true, 'the in-page confirmation saves the current result')
    env.flushNextTicks()
    assert.equal(page.data.projectDialogStep, 'success')
    assert(records.getProjectRecords(project.id).some((record) => record.module === 'camera'),
      'confirming project save should persist the camera record')
    assert.deepEqual(snapshotInputs(page), initialInputs, 'confirming project save preserves inputs')

    const recordsBeforeReset = JSON.stringify(env.storage.get(RECORDS_KEY))
    const projectsBeforeReset = JSON.stringify(env.storage.get(PROJECTS_KEY))
    page.onSceneModeTap(event(1))
    env.flushNextTicks()
    page.onMarginChange({ detail: { value: 0 } })
    env.flushNextTicks()
    page.resetToDefaults()
    env.flushNextTicks()
    assert.equal(page.data.selectedCamera.model, 'TV-6124HK')
    assert.equal(page.data.result, null, 'reset leaves the calculator empty until new values are entered')
    for (const field of [
      'groundWidthText', 'groundDepthText', 'subjectHeightText',
      'planeWidthText', 'planeHeightText', 'planeBottomHeightText', 'fixedCameraHeightText',
      'customHorizontalFovText', 'customVerticalFovText', 'customSensorWidthText',
      'customSensorHeightText', 'customFocalLengthText',
    ]) assert.equal(page.data[field], '', `${field} remains blank after reset`)
    assert.deepEqual(env.storage.get(PREFS_KEY), page.getPreferences(),
      'reset persists blank numeric values with default selectors')
    assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), recordsBeforeReset, 'reset must not delete or rewrite saved records')
    assert.equal(JSON.stringify(env.storage.get(PROJECTS_KEY)), projectsBeforeReset, 'reset must not delete or rewrite projects')
  } finally {
    page._pageVisible = false
    global.getCurrentPages = previousGetCurrentPages
    page._cameraUnloaded = true
  }

  return {
    status: 'passed',
    favorite: 'persisted',
    reportPreview: 'generated/opened/closed/reopened',
    shareAndSave: 'mocked-cancel callbacks ignored',
    project: 'in-page confirmation cancellation and save verified',
    reset: 'defaults restored without changing records/projects',
    wxApiLimitation: 'mock callbacks only; no native share, album permission, or device UI was exercised',
  }
}

function run() {
  return {
    status: 'passed',
    suite: 'camera V3 action/controller regression',
    librarySwitches: testLibrarySwitchesAndRemovedCustomHandlersStayUnavailable(),
    resultAndStorageActions: testFavoriteSharePreviewCancellationProjectAndResetKeepData(),
    wxApiLimitation: 'The delayed harness mocks WeChat APIs; native permissions and system UI are not verified.',
  }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`)

module.exports = { run }

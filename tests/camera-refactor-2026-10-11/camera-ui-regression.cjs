'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')
const { cameras } = require('../../data/cameras')
const {
  calculateVerticalPlanePlacement,
  getCameraMountType,
} = require('../../utils/camera-fov')

const CAMERA_PREFERENCES_KEY = 'audioTool.camera.preferences'

function createPage(preferences) {
  const env = createDelayedEnvironment()
  if (preferences) env.storage.set(CAMERA_PREFERENCES_KEY, env.clone(preferences))
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  return { env, page }
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
}
function event(index) { return { currentTarget: { dataset: { index } } } }
function input(page, field, value) {
  page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value: String(value) } })
}
function blur(env, page) { page.onFieldBlur(); env.flushNextTicks() }
function selectCamera(env, page, model) {
  page.openCameraSelector()
  const item = page.data.selectorItems.find((candidate) => candidate.model === model)
  assert(item, `camera selector should contain ${model}`)
  page.selectCamera(event(item.index))
  env.flushNextTicks()
  return item
}
function snapshotInputs(page) {
  return Object.fromEntries([
    'sourceModeIndex', 'cameraIndex', 'viewIndex', 'definitionModeIndex', 'customMountTypeIndex',
    'customHorizontalFovText', 'customVerticalFovText', 'customSensorWidthText',
    'customSensorHeightText', 'customFocalLengthText', 'sceneModeIndex', 'heightModeIndex',
    'marginIndex', 'groundWidthText', 'groundDepthText', 'subjectHeightText', 'planeWidthText',
    'planeHeightText', 'planeBottomHeightText', 'fixedCameraHeightText',
  ].map((field) => [field, page.data[field]]))
}

function testApprovedGeometryBaselines() {
  const library = createPage()
  assert.equal(library.page.data.selectedCamera.model, 'TV-6124HK')
  assert.equal(library.page.data.result.primaryDistanceMeters, 4.65)
  assert.equal(library.page.data.result.presentedMinimumDistanceMeters, 4.66)
  assert.equal(library.page.data.result.cameraHeightMeters, 2.3)

  const legacy = createPage(legacyCustomPreferences())
  const legacyPreferencesBefore = JSON.stringify(legacy.env.storage.get(CAMERA_PREFERENCES_KEY))
  assert.equal(legacy.page.data.legacyCustomUnsupported, true,
    'a saved custom-source preference must enter the explicit unsupported state')
  assert.equal(legacy.page.data.result, null, 'legacy custom optics must not be reinterpreted as a library result')
  assert.equal(typeof legacy.page.onSourceModeTap, 'undefined', 'the retired custom-source tap handler is absent')
  assert.equal(typeof legacy.page.onDefinitionModeTap, 'undefined', 'the retired custom-optics editor handler is absent')
  assert.equal(legacy.page.data.sourceModeIndex, 0, 'current page state remains library-only')
  input(legacy.page, 'customHorizontalFovText', '55')
  legacy.page.onFieldBlur()
  assert.equal(legacy.page.data.result, null, 'editing is blocked while a legacy custom configuration is unsupported')
  assert.equal(JSON.stringify(legacy.env.storage.get(CAMERA_PREFERENCES_KEY)), legacyPreferencesBefore,
    'an unsupported saved custom preference remains byte-equivalent until explicit recovery')

  legacy.page.openCameraSelector()
  const libraryItem = legacy.page.data.selectorItems.find((item) => item.model === 'TV-6124HK')
  assert(libraryItem, 'the explicit recovery selector offers the previous model as a library model')
  legacy.page.selectCamera(event(libraryItem.index))
  legacy.env.flushNextTicks()
  assert.equal(legacy.page.data.legacyCustomUnsupported, false)
  assert(legacy.page.data.result, 'selecting a library model explicitly restores a current calculation')
  assert.equal(legacy.page.data.result.displayModel, 'TV-6124HK')
  assert.equal(legacy.env.storage.get(CAMERA_PREFERENCES_KEY).sourceMode, 'library')

  const plane = createPage()
  plane.page.onSceneModeTap(event(1))
  plane.env.flushNextTicks()
  assert.equal(plane.page.data.result.sceneMode, 'plane')
  assert.equal(plane.page.data.result.distanceMeters, 4.63)
  assert.equal(plane.page.data.result.cameraHeightMeters, 2.05)
}
function testCameraInputTabsAndUnifiedPreview() {
  const { env, page } = createPage()
  assert.deepEqual(page.data.inputTabs.map((tab) => tab.value), ['camera', 'target', 'install'])
  assert.equal(page.data.inputTabIndex, 0)
  assert.deepEqual(page.data.previewViewOptions.map((item) => item.value), ['spatial'])
  assert.equal(page.data.previewViewIndex, 0)
  assert(page.data.result, 'the initial valid calculation should be visible')
  assert(page.data.result.calculationRows.length > 0, 'the result retains its calculation details')
  assert.match(page.getResultText(), /计算结论：/, 'the current result text exposes the derivation without a retired accordion state')

  const originalResult = page.data.result
  const storageBefore = JSON.stringify([...env.storage.entries()])
  for (const index of [1, 2, 0, 0, 2, 1]) page.onInputTabTap(event(index))
  assert.equal(page.data.result, originalResult, 'input-tab changes must not recalculate or replace the result')
  assert.equal(page.data.inputTabIndex, 1)
  assert.equal(JSON.stringify([...env.storage.entries()]), storageBefore, 'input-tab changes must not write preferences')

  for (const index of [1, 0, 1, 0, 1]) page.onPreviewViewTap(event(index))
  assert.equal(page.data.result, originalResult, 'the unified spatial preview must leave calculation data intact')
  assert.equal(page.data.previewViewIndex, 0, 'retired plan/elevation choices cannot change the spatial view')
  assert.equal(JSON.stringify([...env.storage.entries()]), storageBefore, 'preview interactions must not write preferences')
  page.onInputTabTap(event(0))
  assert.equal(page.data.result, originalResult, 'returning to camera inputs preserves the displayed calculation')
}
function testOpticsMountsScenesAndLimits() {
  const { env, page } = createPage()
  const before = page.data.result
  page.onMarginChange({ detail: { value: 0 } })
  env.flushNextTicks()
  assert.equal(page.data.result.marginPercent, 0)
  page.onMarginChange({ detail: { value: 4 } })
  env.flushNextTicks()
  assert.equal(page.data.result.marginPercent, 20)
  page.onHeightModeTap(event(1))
  env.flushNextTicks()
  assert.equal(page.data.result.heightMode, 'fixed')
  assert.equal(page.data.result.cameraHeightMeters, Number(page.data.fixedCameraHeightText))
  page.onHeightModeTap(event(0))
  env.flushNextTicks()
  assert.equal(page.data.result.heightMode, 'auto')
  assert(before, 'precondition')

  assert.equal(typeof page.onSourceModeTap, 'undefined', 'custom source selection is not part of the current library-only page')
  assert.equal(typeof page.onDefinitionModeTap, 'undefined', 'custom optics entry modes are retired from the current page')
  assert.equal(page.data.sourceModeIndex, 0, 'mount and lens tests use the selected library camera')

  const dual = createPage()
  selectCamera(dual.env, dual.page, 'TS-0650JSM')
  assert.equal(dual.page.data.viewOptions.length, 2)
  assert.equal(dual.page.data.result.mountType, getCameraMountType(cameras.find((item) => item.model === 'TS-0650JSM'), 0))
  dual.page.onViewTap(event(1))
  dual.env.flushNextTicks()
  assert.equal(dual.page.data.result.horizontalOnly, true, 'the fixed second view must remain horizontal-only')
  assert.equal(dual.page.data.result.verticalFov, null)
  assert.equal(dual.page.data.result.requiresInitialAim, true)
  assert.match(dual.page.data.result.aimText, /下|上|左|右|固定/)

  const eptz = createPage()
  selectCamera(eptz.env, eptz.page, 'TS-0663JP')
  assert.equal(eptz.page.data.result.mountType, 'eptz')
  assert.equal(eptz.page.data.result.requiresInitialAim, true)
  assert(eptz.page.data.result.aimText, 'fixed-install ePTZ should retain its initial aiming reference')

  const fixed = createPage()
  selectCamera(fixed.env, fixed.page, 'TV-6124UK')
  assert.equal(fixed.page.data.result.mountType, 'fixed')
  assert.equal(fixed.page.data.result.requiresInitialAim, true)

  const ptz = createPage()
  selectCamera(ptz.env, ptz.page, 'TV-6124HK')
  assert.equal(ptz.page.data.result.mountType, 'ptz')
  assert.equal(ptz.page.data.result.requiresInitialAim, false)

  const longModel = [...cameras].sort((a, b) => b.model.length - a.model.length)[0]
  const longPage = createPage()
  selectCamera(longPage.env, longPage.page, longModel.model)
  assert.equal(longPage.page.data.selectedCamera.model, longModel.model)
  assert(longModel.model.length >= 10, `expected a representative long model, received ${longModel.model}`)
}

function testInvalidInputClearsDisplayedResult() {
  const { env, page } = createPage()
  input(page, 'groundWidthText', '')
  assert.equal(page.data.result, null, 'blank active input must clear the result synchronously')
  assert.equal(page.data.resultReportImagePath, '', 'blank input must invalidate an existing report path')
  assert(page.data.inputErrors.groundWidthText)
  input(page, 'groundWidthText', '0')
  assert.equal(page.data.result, null, 'zero active input must keep the result cleared')
  assert(page.data.inputErrors.groundWidthText)
  input(page, 'groundWidthText', '6')
  blur(env, page)
  assert(page.data.result, 'restoring a valid input should restore the result')


}

function testResetDoesNotDeleteSavedRecords() {
  const { env, page } = createPage()
  page.toggleCurrentFavorite()
  const recordsBefore = [...env.storage.entries()].filter(([key]) => /records|favorite|project/i.test(key))
  assert(recordsBefore.length, 'precondition: saving a favorite should create a local record entry')
  input(page, 'groundWidthText', '9')
  blur(env, page)
  assert.equal(page.data.result.widthMeters, 9)
  page.resetToDefaults()
  env.flushNextTicks()
  assert.equal(page.data.groundWidthText, '', 'reset clears edited geometry inputs')
  assert.equal(page.data.selectedCamera.model, 'TV-6124HK')
  assert.equal(page.data.result, null, 'reset leaves the result empty until valid inputs are entered again')
  const recordsAfter = [...env.storage.entries()].filter(([key]) => /records|favorite|project/i.test(key))
  assert.deepEqual(recordsAfter, recordsBefore, 'reset should not erase saved calculation records')
}

function testLegacyStructuredOperationRemainsUnsupported() {
  const { env, page } = createPage()
  const result = page.beginStructuredOperation({
    horizontalFov: 60,
    verticalFov: 36,
    sceneMode: 'ground',
    widthMeters: 6,
    depthMeters: 4,
    subjectHeightMeters: 1.8,
    heightMode: 'auto',
    marginPercent: 10,
  }, 'full-area')
  env.flushNextTicks()
  assert.equal(result.status, 'unsupported', 'the retired angle-driven entry point remains explicitly unsupported')
  assert.equal(page.data.result, null, 'unsupported structured input cannot create a displayed library result')
  assert.match(page.data.operationUnsupportedMessage, /仅支持库内摄像机/)
  assert.equal(page.data.operationActive, false)
}

function testReportAndProjectReturnPreserveInputs() {
  const { env, page } = createPage()
  const initialInputs = snapshotInputs(page)
  const shareCalls = []
  const saveCalls = []
  const previewCalls = []
  env.wx.showShareImageMenu = (options) => shareCalls.push(options)
  env.wx.saveImageToPhotosAlbum = (options) => saveCalls.push(options)
  env.wx.previewImage = (options) => previewCalls.push(options)

  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, 1)
  env.finishDraw(0)
  env.flushNextTicks()
  assert.equal(env.pending.canvases.length, 1)
  env.finishCanvas(0, 'wxfile://camera-ui-qa.png')
  env.flushNextTicks()
  assert.equal(page.data.resultReportPreviewVisible, true)
  env.wx.getFileSystemManager = () => ({ access: (options) => options?.success?.() })
  page.previewResultReportImage()
  assert.equal(previewCalls[0]?.current, 'wxfile://camera-ui-qa.png')
  page.shareResultReportImage()
  assert.equal(shareCalls[0]?.path, 'wxfile://camera-ui-qa.png')
  page.saveResultReportImage()
  assert.equal(saveCalls[0]?.filePath, 'wxfile://camera-ui-qa.png')
  saveCalls[0].fail?.({ errMsg: 'saveImageToPhotosAlbum:fail cancel' })
  page.closeResultReportPreview(true)
  assert.equal(page.data.resultReportPreviewVisible, false)
  assert.deepEqual(snapshotInputs(page), initialInputs, 'preview, share, save cancellation, and return should preserve inputs')

  const records = require('../../utils/records')
  const project = records.createProject('Camera UI QA project')
  assert(project)
  page._pageVisible = true
  assert.equal(page.saveToActiveProject(), true)
  assert.equal(page.data.projectDialogVisible, true)
  assert.equal(page.data.projectDialogStep, 'select')
  assert(page.data.projectProjects.some((item) => item.id === project.id))
  page.selectCameraProjectTarget({ currentTarget: { dataset: { id: project.id } } })
  assert.equal(page.data.projectDialogStep, 'confirm')
  page.closeCameraProjectDialog(true)
  assert.equal(page.data.projectDialogVisible, false)
  assert.equal(records.getProjectRecords(project.id).length, 0, 'closing before save must not add a project record')
  assert.deepEqual(snapshotInputs(page), initialInputs, 'canceling project selection should preserve inputs')

  assert.equal(page.saveToActiveProject(), true)
  page.selectCameraProjectTarget({ currentTarget: { dataset: { id: project.id } } })
  page.onCameraProjectConfigNameInput({ detail: { value: 'Camera UI saved setup' } })
  assert.equal(page.saveCameraProjectTarget(), true)
  env.flushNextTicks()
  assert.equal(page.data.projectDialogStep, 'success')
  assert.deepEqual(snapshotInputs(page), initialInputs, 'saving to a project should preserve inputs')
  assert(records.getProjectRecords(project.id).some((record) => record.module === 'camera'))
  page.closeCameraProjectDialog(true)
  page._pageVisible = false
}

function testKnownExtremePlaneGeometryRisk() {
  const result = calculateVerticalPlanePlacement({
    horizontalFov: 71,
    verticalFov: 80,
    diagonalFov: 100,
  }, {
    calculationVersion: 1,
    widthMeters: 6,
    heightMeters: 2.5,
    bottomHeightMeters: 50,
    heightMode: 'fixed',
    cameraHeightMeters: 0.5,
    marginRatio: 0.1,
  })
  assert(result)
  assert.equal(result.distanceMeters, 4.63)
  assert.equal(result.aimAngleDegrees, 84.8)
  const lowerRayAngle = result.aimAngleDegrees - 80 / 2
  const upperRayAngle = result.aimAngleDegrees + 80 / 2
  assert(lowerRayAngle < 90 && upperRayAngle >= 90,
    'the known plane repro must cross the 90 degree tangent boundary')
  return result
}

function run() {
  testApprovedGeometryBaselines()
  testCameraInputTabsAndUnifiedPreview()
  testOpticsMountsScenesAndLimits()
  testInvalidInputClearsDisplayedResult()
  testResetDoesNotDeleteSavedRecords()
  testLegacyStructuredOperationRemainsUnsupported()
  testReportAndProjectReturnPreserveInputs()
  const extremePlane = testKnownExtremePlaneGeometryRisk()
  return {
    status: 'passed',
    baseline: 'passed',
    tabsPreviewDerivation: 'passed',
    opticsMountsScenes: 'passed',
    invalidationResetStorage: 'passed',
    reportProjectReturns: 'passed',
    legacyStructuredUnsupported: 'passed',
    knownExtremePlaneGeometryRisk: {
      status: 'reproduced-existing-risk',
      distanceMeters: extremePlane.distanceMeters,
      aimAngleDegrees: extremePlane.aimAngleDegrees,
      frameTopHeight: extremePlane.frameTopHeightMeters,
      frameBottomHeight: extremePlane.frameBottomHeightMeters,
      frameHeight: extremePlane.frameHeightMeters,
      note: 'Legacy core geometry crosses the 90 degree tangent boundary; renderer QA must clip angle-based rays without using this inverted frame height.',
    },
  }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`)

module.exports = { run }

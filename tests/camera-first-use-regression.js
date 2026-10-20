'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./p2-safety-remediation/minimal/delayed-environment.cjs')

const CAMERA_PREFERENCE_KEY = 'audioTool.camera.preferences'

function createPage() {
  const env = createDelayedEnvironment()
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  return { env, page }
}

function createPageFromPreferences(preferences) {
  const env = createDelayedEnvironment()
  env.storage.set(CAMERA_PREFERENCE_KEY, env.clone(preferences))
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  return { env, page }
}

function input(page, field, value) {
  page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value: String(value) } })
}

function blur(env, page) {
  page.onFieldBlur()
  env.flushNextTicks()
}

function chooseScene(env, page, index) {
  page.onSceneModeTap({ currentTarget: { dataset: { index } } })
  env.flushNextTicks()
}

function generateReport(env, page) {
  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, 1, 'report generation should queue a draw')
  env.finishDraw(0)
  env.flushNextTicks()
  assert.equal(env.pending.canvases.length, 1, 'report drawing should queue an export')
  env.finishCanvas(0, 'wxfile://camera-first-use.png')
  env.flushNextTicks()
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-first-use.png')
}

function testGeometryAndActiveValidation() {
  const { env, page } = createPage()
  assert.equal(page.data.result.primaryDistanceMeters, 4.65, 'camera-normal 10% framing allowance must use the real 4 m depth')
  assert.equal(page.data.result.framingVersion, 2)
  assert.equal(page.data.result.effectiveDepthMeters, 4, 'framing allowance must not enlarge site depth')
  assert.equal(page.data.result.cameraHeightMeters, 2.3, 'default automatic height baseline must remain 2.3 m')

  chooseScene(env, page, 1)
  assert.equal(page.data.result.primaryDistanceMeters, 4.63, 'plane distance baseline must remain 4.63 m')
  assert.equal(page.data.result.cameraHeightMeters, 2.05, 'plane height baseline must remain 2.05 m')

  input(page, 'planeBottomHeightText', '   ')
  assert.equal(page.data.result, null, 'a whitespace bottom height must immediately clear the result')
  assert(page.data.inputErrors.planeBottomHeightText, 'the active bottom-height field should carry its own error')
  input(page, 'planeBottomHeightText', '0')
  blur(env, page)
  assert.equal(page.data.inputErrors.planeBottomHeightText, undefined, 'restoring an explicit zero should clear the error')
  assert(page.data.result, 'an explicit zero bottom height should calculate')
  assert.equal(page.data.result.bottomHeightMeters, 0, 'the explicit zero bottom height must be preserved')

  input(page, 'groundWidthText', '')
  assert(page.data.result, 'an inactive ground field must not block the active plane scene')
  blur(env, page)
  assert(page.data.result, 'calculation should ignore an invalid hidden ground field')
  chooseScene(env, page, 0)
  assert.equal(page.data.result, null, 'switching to the scene with a blank width must block calculation')
  assert(page.data.inputErrors.groundWidthText, 'the now-active ground width should show an inline error')
  chooseScene(env, page, 1)
  assert(page.data.result, 'switching away should ignore the blank ground field again')

  page.onHeightModeTap({ currentTarget: { dataset: { index: 1 } } })
  env.flushNextTicks()
  input(page, 'fixedCameraHeightText', '')
  assert.equal(page.data.result, null, 'an empty active fixed height should clear the old result')
  page.onHeightModeTap({ currentTarget: { dataset: { index: 0 } } })
  env.flushNextTicks()
  assert(page.data.result, 'an invalid fixed height should not block automatic-height mode')
  assert.equal(page.data.inputErrors.fixedCameraHeightText, undefined)
}

function testLegacyCustomPreferenceRequiresExplicitRecovery() {
  const legacyPreferences = {
    sourceMode: 'custom',
    cameraModel: 'TV-6124HK',
    viewIndex: 0,
    definitionMode: 'angles',
    customMountType: 'ptz',
    customHorizontalFovText: '60',
    customVerticalFovText: '36',
    customSensorWidthText: '6.4',
    customSensorHeightText: '3.6',
    customFocalLengthText: '4.5',
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
  const { env, page } = createPageFromPreferences(legacyPreferences)
  assert.equal(page.data.legacyCustomUnsupported, true,
    'a stored custom source must enter an explicit unsupported-recovery state')
  assert.equal(page.data.result, null, 'a legacy custom result must not be displayed as a library calculation')
  assert.equal(page.data.selectedCamera.model, 'TV-6124HK',
    'legacy model fields must remain available for explicit library recovery without reviving the old custom result')
  assert.deepEqual(env.storage.get(CAMERA_PREFERENCE_KEY), legacyPreferences,
    'loading unsupported custom preferences must preserve their exact stored values')
  assert.equal(env.effects.storage.length, 0,
    'loading unsupported custom preferences must not automatically overwrite user preferences')

  chooseScene(env, page, 1)
  input(page, 'planeWidthText', '8')
  blur(env, page)
  assert.equal(page.data.legacyCustomUnsupported, true,
    'scene and input changes must not silently recover legacy custom preferences')
  assert.equal(page.data.result, null,
    'scene and input changes must not expose a calculated result while legacy custom preferences are blocked')
  assert.deepEqual(env.storage.get(CAMERA_PREFERENCE_KEY), legacyPreferences,
    'scene and input changes must not overwrite the untouched legacy custom preference bytes')
  assert.equal(env.effects.storage.length, 0,
    'scene and input changes must not write preferences before the user explicitly recovers')

  page.openCameraSelector()
  page.closeCameraSelector()
  env.flushNextTicks()
  assert.equal(page.data.legacyCustomUnsupported, true,
    'opening and closing the model selector alone must leave legacy custom preferences blocked')
  assert.equal(page.data.result, null,
    'closing the model selector must not reveal a stale or synthetic result')
  assert.deepEqual(env.storage.get(CAMERA_PREFERENCE_KEY), legacyPreferences,
    'closing the selector must preserve the legacy preference until a model is explicitly selected')
  assert.equal(env.effects.storage.length, 0,
    'opening or closing the selector must not silently write replacement preferences')

  chooseScene(env, page, 0)
  assert.equal(page.data.legacyCustomUnsupported, true,
    'returning to the default scene must not itself release a legacy custom preference')
  assert.equal(page.data.result, null)
  assert.deepEqual(env.storage.get(CAMERA_PREFERENCE_KEY), legacyPreferences)
  assert.equal(env.effects.storage.length, 0)

  page.openCameraSelector()
  const libraryCamera = page.data.selectorItems.find((item) => item.model === 'TV-6124HK')
  assert(libraryCamera, 'explicit recovery must offer the existing library camera')
  assert.equal(page.data.selectedCamera.model, libraryCamera.model,
    'the explicit recovery choice must remain available even when it matches the legacy model key')
  page.selectCamera({ currentTarget: { dataset: { index: libraryCamera.index } } })
  env.flushNextTicks()
  assert.equal(page.data.legacyCustomUnsupported, false,
    'explicitly selecting a library model must leave the unsupported recovery state')
  assert.equal(page.data.result.displayModel, 'TV-6124HK',
    'the fresh result must identify the explicitly selected library model')
  assert.equal(page.data.result.primaryDistanceMeters, 4.65,
    'explicit library recovery must use the authorized camera-normal framing calculation')

  const resetCase = createPageFromPreferences(legacyPreferences)
  resetCase.page.resetToDefaults()
  resetCase.env.flushNextTicks()
  assert.equal(resetCase.page.data.legacyCustomUnsupported, false,
    'reset must leave the unsupported custom recovery state')
  assert.equal(resetCase.page.data.selectedCamera.model, 'TV-6124HK')
  assert.equal(resetCase.page.data.result, null,
    'reset must leave the calculator empty until new numeric values are entered')
  for (const field of [
    'groundWidthText', 'groundDepthText', 'subjectHeightText',
    'planeWidthText', 'planeHeightText', 'planeBottomHeightText', 'fixedCameraHeightText',
    'customHorizontalFovText', 'customVerticalFovText', 'customSensorWidthText',
    'customSensorHeightText', 'customFocalLengthText',
  ]) assert.equal(resetCase.page.data[field], '', `${field} remains blank after reset`)
  assert.deepEqual(resetCase.env.storage.get(CAMERA_PREFERENCE_KEY), resetCase.page.getPreferences(),
    'reset persists the blank numeric values and default library selections')

  const invalidLegacyPreferences = { ...legacyPreferences, groundWidthText: 'invalid' }
  const invalidRecovery = createPageFromPreferences(invalidLegacyPreferences)
  invalidRecovery.page.openCameraSelector()
  const invalidLibraryCamera = invalidRecovery.page.data.selectorItems.find((item) => item.model === 'TV-6124HK')
  invalidRecovery.page.selectCamera({ currentTarget: { dataset: { index: invalidLibraryCamera.index } } })
  invalidRecovery.env.flushNextTicks()
  assert.equal(invalidRecovery.page.data.legacyCustomUnsupported, false,
    'an explicit library choice must leave the legacy custom recovery state even when the active inputs need correction')
  assert.equal(invalidRecovery.page.data.result, null,
    'invalid inputs after explicit recovery must remain blocked instead of producing a synthetic legacy result')
  assert.equal(invalidRecovery.env.storage.get(CAMERA_PREFERENCE_KEY).sourceMode, 'library',
    'explicit recovery with invalid inputs must persist the deliberate switch to library mode')
  assert.equal(invalidRecovery.env.storage.get(CAMERA_PREFERENCE_KEY).groundWidthText, 'invalid',
    'recovery must preserve the invalid input for correction instead of silently substituting a result')
}

function testReportInvalidation() {
  const saved = createPage()
  generateReport(saved.env, saved.page)
  input(saved.page, 'groundWidthText', '')
  assert.equal(saved.page.data.result, null)
  assert.equal(saved.page.data.resultReportImagePath, '', 'invalid input must clear an already generated image')
  assert.equal(saved.page.data.resultReportPreviewVisible, false)
  assert.equal(saved.page.data.isGeneratingResultReport, false)

  const generating = createPage()
  generating.page.generateResultReportImage()
  generating.env.flushNextTicks()
  assert.equal(generating.env.pending.draws.length, 1)
  input(generating.page, 'groundDepthText', ' ')
  assert.equal(generating.page.data.result, null)
  assert.equal(generating.page.data.resultReportImagePath, '')
  assert.equal(generating.page.data.isGeneratingResultReport, false)
  generating.env.finishDraw(0)
  generating.env.flushNextTicks()
  assert.equal(generating.env.pending.canvases.length, 0, 'a stale in-flight draw must not export after validation fails')
  assert.equal(generating.page.data.resultReportImagePath, '')
}

function testSelectorAndHorizontalOnlyResult() {
  const { env, page } = createPage()
  page.openCameraSelector()
  const selectorItem = page.data.selectorItems.find((item) => item.model === 'TS-0650JSM')
  assert(selectorItem, 'the dual-view camera should remain searchable')
  assert.equal(selectorItem.opticsLines.length, 2, 'the selector should keep one compact line per camera view')
  assert(!Object.hasOwn(selectorItem, 'views') && !Object.hasOwn(selectorItem, 'source'), 'selector items must not retain full product records')
  assert(selectorItem.opticsLines[0].includes('广角端'))
  assert(selectorItem.opticsLines[0].includes('厂家水平') && selectorItem.opticsLines[0].includes('垂直'))
  assert(selectorItem.opticsLines[0].includes('参数完整'))
  assert(selectorItem.opticsLines[1].includes('固定视角'))
  assert(selectorItem.opticsLines[1].includes('缺垂直角，仅水平预估'))
  assert(selectorItem.opticsLines.every((line) => !line.includes('长焦端')), 'selector should describe the installed wide/fixed view only')

  page.selectCamera({ currentTarget: { dataset: { index: selectorItem.index } } })
  env.flushNextTicks()
  const fixedViewIndex = page.data.viewOptions.findIndex((view) => view.label === '教师全景')
  assert(fixedViewIndex >= 0)
  page.onViewTap({ currentTarget: { dataset: { index: fixedViewIndex } } })
  env.flushNextTicks()
  assert.equal(page.data.result.horizontalOnly, true, 'a catalog view without vertical FOV should remain horizontal-only')
  assert(page.data.selectedOpticsLines[0].includes('固定视角'))
  assert(page.data.selectedOpticsLines[0].includes('垂直 未提供'))
  const resultText = page.getResultText()
  assert(resultText.includes('垂直未校核') && resultText.includes('最终安装应通过样机画面复核'),
    'saved result semantics must retain the horizontal-only limitation')
  assert(page.data.result.distanceReferenceText.includes('实际前沿（水平）'),
    'the live graph result must retain its actual front-edge horizontal distance reference')
  assert(resultText.includes(`摄像机距区域前沿：${page.data.result.cameraSetbackMeters} m`),
    'saved result semantics must retain the actual front-edge distance and calculated value')
}

function testInputFlushAndHeightBasis() {
  const { env, page } = createPage()
  input(page, 'groundWidthText', '8')
  blur(env, page)
  assert.equal(page.data.result.widthMeters, 8, 'blur must publish the latest valid geometry')
  assert.notEqual(page.data.result.primaryDistanceMeters, 4.83,
    'the visible calculation must refresh from the latest width without a copy action')

  page.onHeightModeTap({ currentTarget: { dataset: { index: 1 } } })
  env.flushNextTicks()
  assert.equal(page.data.result.heightMode, 'fixed')
  assert.equal(page.data.result.cameraHeightMeters, Number(page.data.fixedCameraHeightText))
  page.onHeightModeTap({ currentTarget: { dataset: { index: 0 } } })
  env.flushNextTicks()
  assert.equal(page.data.result.heightMode, 'auto')
  assert.equal(page.data.result.cameraHeightMeters, 2.3,
    'automatic height baseline must remain unchanged after changing modes')
}

function testStructuredOperationIsUnsupportedWithoutCameraBinding() {
  const { env, page } = createPage()
  const facts = {
    horizontalFov: 60,
    sceneMode: 'ground',
    widthMeters: 6,
    depthMeters: 4,
    subjectHeightMeters: 1.8,
    heightMode: 'auto',
    marginPercent: 10,
  }
  const savedPreferences = env.clone(env.storage.get(CAMERA_PREFERENCE_KEY))
  const preferenceWriteCount = env.effects.storage.length
  const unsupported = page.beginStructuredOperation(facts, 'full-area')
  env.flushNextTicks()
  assert.equal(unsupported.status, 'unsupported')
  assert.equal(unsupported.active, false)
  assert.equal(page.data.operationActive, false,
    'a structured camera operation without a bound library model/view must remain inactive')
  assert.equal(page.getOperationSnapshot(), null,
    'unsupported structured facts must not create a camera operation snapshot')
  assert.equal(page.data.result, null,
    'unsupported structured facts must clear any prior result rather than expose a library or synthetic result')
  assert.match(page.data.operationUnsupportedMessage, /仅支持库内摄像机/)

  const rejectedCommit = page.commitStructuredCalculatedState({ state: facts })
  assert.equal(rejectedCommit, null,
    'the camera structured-commit fallback must reject an operation that was not explicitly bound to a library camera/view')
  assert.equal(page.data.result, null,
    'a rejected structured commit must not publish a synthetic result')
  assert.match(page.data.operationUnsupportedMessage, /仅支持库内摄像机/)
  assert.deepEqual(env.storage.get(CAMERA_PREFERENCE_KEY), savedPreferences,
    'unsupported structured operations must not overwrite the library preferences')
  assert.equal(env.effects.storage.length, preferenceWriteCount,
    'unsupported structured operations must not write preferences')
  assert.equal(page.getRecordPayload(), null,
    'a rejected structured operation must not expose a record payload without a result')
}

function run() {
  testGeometryAndActiveValidation()
  testLegacyCustomPreferenceRequiresExplicitRecovery()
  testReportInvalidation()
  testSelectorAndHorizontalOnlyResult()
  testInputFlushAndHeightBasis()
  testStructuredOperationIsUnsupportedWithoutCameraBinding()
  return { cameraFirstUse: 'passed', validation: 'passed', legacyCustomRecovery: 'passed', horizontalOnly: 'passed', structuredOperationUnsupported: 'passed' }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`)

module.exports = { run }

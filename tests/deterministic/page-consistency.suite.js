'use strict'

const path = require('path')
const cameraCoverage = require('../helpers/camera-coverage-reference')
const pageCases = [
  ['limiter', '../../pages/limiter/limiter'],
  ['spl', '../../pages/spl/spl'],
  ['cable', '../../pages/cable/cable'],
  ['camera', '../../pages/camera/camera'],
  ['led-screen', '../../pages/led-screen/led-screen'],
  ['gain-structure', '../../pages/gain-structure/gain-structure'],
  ['dmx-address', '../../pages/dmx-address/dmx-address'],
]

function bootPage(relativePath) {
  const previous = { Page: global.Page, wx: global.wx, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout }
  const storage = new Map()
  const copied = []
  const wx = new Proxy({
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    setClipboardData: ({ data, success }) => { copied.push(data); if (success) success() },
    showToast: () => {}, showModal: () => {}, vibrateShort: () => {},
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 812, pixelRatio: 2 }),
  }, { get(target, key) { return key in target ? target[key] : () => {} } })
  global.wx = wx
  require('../helpers/offline-guard').registerWx(wx)
  global.setTimeout = () => 1
  global.clearTimeout = () => {}
  let definition
  global.Page = (config) => { definition = config }
  try {
    const modulePath = path.resolve(__dirname, relativePath)
    delete require.cache[require.resolve(modulePath)]
    require(modulePath)
    if (!definition || !definition.data) throw new Error(relativePath + ' did not register a page definition')
    const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(changes, callback) {
      for (const [key, value] of Object.entries(changes)) {
        const match = key.match(/^([^.[\]]+)\[(\d+)\]\.(.+)$/)
        if (match) {
          const list = match[1]
          const index = Number(match[2])
          const field = match[3]
          this.data[list][index] = { ...this.data[list][index], [field]: value }
        } else this.data[key] = value
      }
      if (callback) callback()
    },
    })
    return { page, storage, copied, restore: () => restoreGlobals(previous) }
  } catch (error) {
    restoreGlobals(previous)
    throw error
  }
}

function restoreGlobals(previous) {
  global.Page = previous.Page
  global.wx = previous.wx
  global.setTimeout = previous.setTimeout
  global.clearTimeout = previous.clearTimeout
}

function cameraOptionsFromPage(page) {
  const state = page.data
  const sceneMode = state.sceneModes[state.sceneModeIndex].value
  const options = {
    sceneMode,
    calculationVersion: Number(state.cameraCalculationVersion) === 1 ? 1 : 2,
    heightMode: state.heightModes[state.heightModeIndex].value,
    cameraHeightMeters: Number(state.fixedCameraHeightText),
    marginRatio: Number(state.marginOptions[state.marginIndex]) / 100,
    widthMeters: Number(sceneMode === 'ground' ? state.groundWidthText : state.planeWidthText),
  }
  if (sceneMode === 'ground') {
    options.depthMeters = Number(state.groundDepthText)
    options.subjectHeightMeters = Number(state.subjectHeightText)
  } else {
    options.heightMeters = Number(state.planeHeightText)
    options.bottomHeightMeters = Number(state.planeBottomHeightText)
  }
  return options
}

function assertCameraPageCoverage(assert, finiteTree, page, label) {
  const result = page.data.result
  assert(result, `${label} should have a calculated camera result`)
  if (result.horizontalOnly) {
    assert.strictEqual(result.verticalCoverageVerified, false,
      `${label} horizontal-only result must leave vertical coverage unverified`)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'coverageVerified'), false,
      `${label} horizontal-only result must not claim complete coverage`)
    return null
  }
  const fov = page.getFovDefinition(page.data)
  const options = cameraOptionsFromPage(page)
  return Number(result.framingVersion) === 2
    ? cameraCoverage.assertFramedPlacementCoverage(assert, finiteTree, fov, options, result, label)
    : cameraCoverage.assertCompletePlacementCoverageV1(assert, finiteTree, fov, options, result, label)
}

module.exports = function register({ test, assert, finiteTree, close }) {
  for (const [name, modulePath] of pageCases) {
    test(name + (name === 'limiter' || name === 'camera'
      ? ' page result text and record payload agree'
      : ' page output, copied text, and record payload agree'), () => {
      const context = bootPage(modulePath)
      try {
        const page = context.page
        assert.strictEqual(typeof page.onLoad, 'function', name + ' onLoad is required')
        if (name === 'limiter') {
          context.storage.set('audioTool.limiter.preferences', {
            amplifierModel: 'TC-2350B', speakerModel: 'TS-803C', count: 1,
            wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1, highPassFrequency: 80,
          })
        }
        if (name === 'gain-structure') {
          context.storage.set('audioTool.gainStructure.preferences', {
            amplifierModel: 'TC-X2200B', stageValue: 1, mode: 'stereo',
            loadImpedance: null, targetPeakDbfs: -6,
          })
        }
        page.onLoad()
        finiteTree(page.data, name + '.data')
        assert(page.data.result, name + ' should calculate its valid default input')
        if (name === 'camera') assertCameraPageCoverage(assert, finiteTree, page, 'camera default page')
        if (name === 'limiter') {
          assert.strictEqual(typeof page.getResultText, 'function', name + ' must expose result text')
          const text = page.getResultText()
          assert(typeof text === 'string' && text.trim().length > 0, name + ' result text must be present')
          assert(!/NaN|Infinity/.test(text), name + ' result text must not expose non-finite values')
          assert.strictEqual(typeof page.getRecordPayload, 'function', name + ' should implement getRecordPayload')
          const record = page.getRecordPayload()
          assert(record, name + ' valid result should produce a record payload')
          assert.strictEqual(text, record.resultText, 'limiter result text must match saved record text')
        } else if (name === 'camera') {
          assert.strictEqual(page.data.sourceModeIndex, 0, 'camera result should use the current library-only input path')
          assert.strictEqual(typeof page.getResultText, 'function', name + ' must expose visible result text')
          const text = page.getResultText()
          assert(typeof text === 'string' && text.trim().length > 0, name + ' result text must be present')
          assert(!/NaN|Infinity/.test(text), name + ' result text must not expose non-finite values')
          const record = page.getRecordPayload()
          assert(record, name + ' valid result should produce a record payload')
          assert.strictEqual(record.module, 'camera')
          assert.strictEqual(record.preferences.sourceMode, 'library')
          assert.strictEqual(record.preferences.cameraModel, page.data.selectedCamera.model)
          assert.strictEqual(record.resultText, text, 'camera record text must match the visible result text')
        } else {
          assert.strictEqual(typeof page.copyResult, 'function', name + ' should implement copyResult')
          page.copyResult()
          const copiedText = context.copied[context.copied.length - 1]
          const text = page.getResultText()
          assert(typeof text === 'string' && text.trim().length > 0, name + ' result text must be present')
          assert(!/NaN|Infinity/.test(text), name + ' result text must not expose non-finite values')
          assert.strictEqual(copiedText, text, name + ' copied text must match visible result text')
          assert.strictEqual(typeof page.getRecordPayload, 'function', name + ' should implement getRecordPayload')
          const record = page.getRecordPayload()
          assert(record, name + ' valid result should produce a record payload')
          assert.strictEqual(copiedText, record.resultText, name + ' copied text must match the text saved in records')
        }
      } finally { context.restore() }
    }, { classification: 'implementation bug', basis: 'Each real calculator page should keep its calculation, copied text, and record text consistent.' })
  }

  test('gain structure starts blank and reset clears only its saved draft', () => {
    const context = bootPage('../../pages/gain-structure/gain-structure')
    try {
      const page = context.page
      page.onLoad()
      assert.strictEqual(page.data.calculationState, 'empty')
      assert.strictEqual(page.data.result, null)
      assert.strictEqual(page.data.hasValidResult, false)
      assert.strictEqual(page.data.selectedAmplifier, null)
      assert.strictEqual(page.clearDraft(), true)
      assert.strictEqual(page.data.calculationState, 'empty')
      assert.strictEqual(page.data.result, null)
      assert.strictEqual(page.data.hasSavedDraft, false)
      assert.strictEqual(context.storage.has('audioTool.gainStructure.preferences'), false)
      page.onLoad()
      assert.strictEqual(page.data.calculationState, 'empty', 'a relaunch after reset must stay blank')
      assert.strictEqual(page.data.result, null)
    } finally { context.restore() }
  }, { classification: 'implementation bug', basis: 'A fresh or reset gain page should not silently restore a calculation without a saved draft.' })

  test('calculator mode changes recalculate from current fields without leaking the other mode', () => {
    const context = bootPage('../../pages/cable/cable')
    try {
      const page = context.page
      page.onLoad()
      const initialConstant = page.data.result
      page.onModeTap({ currentTarget: { dataset: { index: 1 } } })
      assert.strictEqual(page.data.modeIndex, 1)
      assert(page.data.result, 'professional mode should calculate from its own input fields')
      assert.notDeepStrictEqual(page.data.result, initialConstant, 'mode switch should update the calculated result')
      assert(page.getResultText().includes('专业音箱'), 'copied result should describe professional mode')
      page.onModeTap({ currentTarget: { dataset: { index: 0 } } })
      assert.strictEqual(page.data.modeIndex, 0)
      assert.deepStrictEqual(page.data.result, initialConstant, 'switching back should restore constant-voltage result')
    } finally { context.restore() }
  }, { classification: 'implementation bug', basis: 'Switching calculator modes must calculate using that mode’s own fields and return consistently when switched back.' })

  test('camera page scene-mode switch recalculates through its actual page method', () => {
    const context = bootPage('../../pages/camera/camera')
    try {
      const page = context.page
      page.onLoad()
      const originalResult = page.data.result
      assertCameraPageCoverage(assert, finiteTree, page, 'camera scene-switch default')
      const otherIndex = page.data.sceneModeIndex === 0 ? 1 : 0
      page.onSceneModeTap({ currentTarget: { dataset: { index: otherIndex } } })
      assert.strictEqual(page.data.sceneModeIndex, otherIndex)
      assert(page.data.result, 'camera scene change should leave a valid result for default fields')
      finiteTree(page.data.result, 'camera.modeResult')
      assertCameraPageCoverage(assert, finiteTree, page, 'camera scene after switch')
      assert.notDeepStrictEqual(page.data.result, originalResult, 'scene-mode change should affect page output')
      assert(page.getResultText().length > 0)
    } finally { context.restore() }
  }, { classification: 'implementation bug', basis: 'Camera scene mode is a real input mode and must recalculate the displayed result through the page handler.' })

  test('camera page library selection keeps raw and displayed V2 coverage in its result record', () => {
    const context = bootPage('../../pages/camera/camera')
    try {
      const page = context.page
      page.onLoad()
      assertCameraPageCoverage(assert, finiteTree, page, 'case #9 page default before input changes')
      assert.strictEqual(page.openCameraSelector(), true)
      const cameraOption = page.data.selectorItems.find((item) => item.model === 'TS-0650JSP')
      assert(cameraOption, 'supported library camera should appear in the model selector')
      page.selectCamera({ currentTarget: { dataset: { index: cameraOption.index } } })
      assert.strictEqual(page.data.selectedCamera.model, 'TS-0650JSP')
      page.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } })
      page.onHeightModeTap({ currentTarget: { dataset: { index: 1 } } })

      const result = page.data.result
      const fov = page.getFovDefinition(page.data)
      const options = cameraOptionsFromPage(page)
      assert.strictEqual(options.calculationVersion, 2)
      assert.strictEqual(result.framingVersion, 2)
      assert.strictEqual(result.calculationHorizontalFov, 21,
        'camera FOV should come from the selected manufacturer library view')
      assert.strictEqual(result.calculationVerticalFov, 12,
        'camera FOV should use the selected view’s documented vertical angle')
      assertCameraPageCoverage(assert, finiteTree, page, 'camera page supported library selection')
      assert.strictEqual(result.presentation.statusKind, 'verified-v2',
        'current library result should retain its verified V2 display state')
      const displayedCoverage = cameraCoverage.evaluatePresentedFramingCoverage(fov, options, result.presentation)
      assert(displayedCoverage.valid,
        'parsed displayed distance, height, and pitch must keep every target corner in front of the lens')
      close(displayedCoverage.distanceMeters, result.presentedMinimumDistanceMeters,
        1e-12, 'displayed distance text should match the result presentation value')
      assert(displayedCoverage.horizontalCovered && displayedCoverage.verticalCovered,
        'the displayed distance/height/pitch tuple must cover both axes under independent V2 corner projection')
      assert.strictEqual(result.presentation.validation.fits, true,
        'production display validation should agree with the independently projected displayed tuple')

      const visibleText = page.getResultText()
      const record = page.getRecordPayload()
      assert(record, 'supported library result should produce a record payload')
      assert.strictEqual(record.preferences.cameraModel, 'TS-0650JSP')
      assert.strictEqual(record.preferences.sceneMode, 'plane')
      assert.strictEqual(record.preferences.heightMode, 'fixed')
      assert.strictEqual(record.resultText, visibleText,
        'saved camera record should retain the visible result text')
      assert(visibleText.includes(result.presentation.distanceText),
        'visible result text should retain the verified displayed distance')
      assert(!/NaN|Infinity/.test(visibleText), 'visible camera result text must remain finite')
    } finally { context.restore() }
  }, { classification: 'implementation bug', basis: 'The current camera page must calculate from a selected library model and preserve raw and displayed V2 coverage in its saved record payload.' })

  test('LED frame width input uses centimeters and invalid input clears the displayed result', () => {
    const context = bootPage('../../pages/led-screen/led-screen')
    try {
      const page = context.page
      page.onLoad()
      assert(page.data.result, 'valid defaults should produce an LED result')
      page.setData({ frameWidthText: '5' })
      page.commitCalculatedState()
      close(page.data.result.frameWidthMeters, 0.05)
      page.setData({ wallWidthText: 'invalid' })
      page.commitCalculatedState()
      assert.strictEqual(page.data.result, null, 'invalid input must clear the stale result')
    } finally { context.restore() }
  }, { classification: 'implementation bug', basis: 'The LED page displays frame width in centimeters, converts it to meters for calculation, and clears stale results on invalid input.' })
}

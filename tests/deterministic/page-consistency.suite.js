'use strict'

const path = require('path')
const cameraCoverage = require('../helpers/camera-coverage-reference')
const pageCases = [
  ['limiter', '../../pages/limiter/limiter'],
  ['spl', '../../pages/spl/spl'],
  ['cable', '../../pages/cable/cable'],
  ['venue', '../../pages/venue/venue'],
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
  return cameraCoverage.assertCompletePlacementCoverage(
    assert, finiteTree, fov, cameraOptionsFromPage(page), result, label,
  )
}

module.exports = function register({ test, assert, finiteTree, close }) {
  for (const [name, modulePath] of pageCases) {
    test(name + ' page output, copied text, and record payload agree', () => {
      const context = bootPage(modulePath)
      try {
        const page = context.page
        assert.strictEqual(typeof page.onLoad, 'function', name + ' onLoad is required')
        page.onLoad()
        finiteTree(page.data, name + '.data')
        assert(page.data.result, name + ' should calculate its valid default input')
        if (name === 'camera') assertCameraPageCoverage(assert, finiteTree, page, 'camera default page')
        assert.strictEqual(typeof page.getResultText, 'function', name + ' must expose result text')
        const text = page.getResultText()
        assert(typeof text === 'string' && text.trim().length > 0, name + ' result text must be present')
        assert(!/NaN|Infinity/.test(text), name + ' result text must not expose non-finite values')
        assert.strictEqual(typeof page.copyResult, 'function', name + ' should implement copyResult')
        page.copyResult()
        assert.strictEqual(context.copied[context.copied.length - 1], page.getResultText(), name + ' copied text must match visible result text')
        assert.strictEqual(typeof page.getRecordPayload, 'function', name + ' should implement getRecordPayload')
        const record = page.getRecordPayload()
        assert(record, name + ' valid result should produce a record payload')
        assert.strictEqual(context.copied[context.copied.length - 1], record.resultText, name + ' copied text must match the text saved in records')
      } finally { context.restore() }
    }, { classification: 'implementation bug', basis: 'Each real calculator page should keep its calculation, copied text, and record text consistent.' })
  }

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

  test('camera page case #9 keeps raw and displayed two-axis coverage through copy and record', () => {
    const context = bootPage('../../pages/camera/camera')
    try {
      const page = context.page
      page.onLoad()
      assertCameraPageCoverage(assert, finiteTree, page, 'case #9 page default before input changes')
      page.commitCalculatedState({
        sourceModeIndex: 1,
        definitionModeIndex: 0,
        sceneModeIndex: 1,
        heightModeIndex: 1,
        marginIndex: 0,
        customHorizontalFovText: '60',
        customVerticalFovText: '10',
        planeWidthText: '10',
        planeHeightText: '3',
        planeBottomHeightText: '0',
        fixedCameraHeightText: '10',
      })
      const result = page.data.result
      const fov = page.getFovDefinition(page.data)
      const options = cameraOptionsFromPage(page)
      cameraCoverage.assertCompletePlacementCoverage(
        assert, finiteTree, fov, options, result, 'camera page case #9',
      )
      assert.strictEqual(result.distanceMeters, 10.05,
        'case #9 should display the rounded calculation distance')
      assert(result.verticalMinimumDistanceMeters > result.horizontalMinimumDistanceMeters,
        'case #9 vertical check should begin at the horizontal constraint and move to the far feasible branch')
      const calculationText = result.calculationRows
        .map((row) => `${row.title} ${row.formula} ${row.substitution}`)
        .join('\n')
      assert(calculationText.includes('水平视场角') && calculationText.includes('tan('),
        'camera result should explain the horizontal FOV width boundary')
      assert(calculationText.includes('垂直包络角') && calculationText.includes('垂直视场角'),
        'camera result should explain the independent vertical envelope check')
      assert(!result.calculationRows.some((row) => row.formula.includes('max(')),
        'the calculation narrative must not describe the branch-aware solution as max(Dh, Dv)')
      const displayedCoverage = cameraCoverage.evaluatePlacementCoverage(fov, options, result.distanceMeters)
      assert(displayedCoverage.horizontalCovered && displayedCoverage.verticalCovered,
        'the displayed 10.05 m distance on the real page must cover both axes')

      page.copyResult()
      const copiedText = context.copied[context.copied.length - 1]
      const record = page.getRecordPayload()
      assert(record, 'case #9 should produce a record payload')
      assert.strictEqual(copiedText, page.getResultText(), 'copied result must match the visible case #9 result')
      assert.strictEqual(record.resultText, copiedText, 'saved case #9 record must match the copied result')
      assert(copiedText.includes('10.05 m'), 'copied result should retain the displayed case #9 distance')
      assert(copiedText.includes('垂直包络角') && copiedText.includes('tan('),
        'visible, copied, and recorded result should retain the two-axis calculation model')
    } finally { context.restore() }
  }, { classification: 'implementation bug', basis: 'The actual camera page must preserve the raw and displayed case #9 coverage result through its copy and record paths.' })

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

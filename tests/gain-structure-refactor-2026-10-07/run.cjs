'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { amplifiers } = require('../../data/equipment')
const { amplifierInputStages } = require('../../data/amplifier-input-stages')
const records = require('../../utils/records')

const root = path.resolve(__dirname, '../..')
const baselinePath = path.join(__dirname, 'initial-gain-page.cjs')
// The fixture has identical content across checkouts but different byte hashes:
// observed LF bytes hash to 8f288e..., while CRLF bytes hash to ca3644....
// Normalize CRLF only so the immutable-content check is stable across checkout line endings.
const expectedCanonicalBaselineHash = '8f288e565d3d419bd17c933cb57ee1e58fa776c5624b77bca94b16e6a285d756'
const baselineSource = fs.readFileSync(baselinePath, 'utf8')
assert.strictEqual(
  crypto.createHash('sha256').update(baselineSource.replace(/\r\n/g, '\n')).digest('hex'),
  expectedCanonicalBaselineHash,
  'the immutable pre-refactor gain page fixture changed',
)

const preferencesKey = 'audioTool.gainStructure.preferences'
const recordStorageKeys = [
  'audioTool.records.v1',
  'audioTool.projects.v1',
  'audioTool.activeProject.v1',
  'audioTool.storageSchemaVersion',
]
const restoredValidPreferences = {
  amplifierModel: 'TC-X2200B',
  stageValue: 1,
  mode: 'stereo',
  loadImpedance: null,
  targetPeakDbfs: -6,
}

function evaluatePage(relativePath, source, recordsOverride) {
  let definition
  const pagePath = path.join(root, relativePath)
  const localRequire = (request) => {
    if (request === '../../utils/records' && recordsOverride) return recordsOverride
    return require(path.resolve(path.dirname(pagePath), request))
  }
  const module = { exports: {} }
  const registerPage = (value) => { definition = value }
  const previousPage = global.Page
  global.Page = registerPage
  try {
    new Function('require', 'Page', 'module', 'exports', source)(
      localRequire,
      registerPage,
      module,
      module.exports,
    )
  } finally {
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
  assert(definition && definition.data, `${relativePath} did not register a page`)
  return { definition, api: module.exports.__gainStructureTest || {} }
}

function appendExports(source) {
  return `${source}\nmodule.exports.__gainStructureTest = {
    amplifiers, amplifierInputStages, modes, targetPeaks, buildLoadOptions,
    buildAmplifierState, calculatePageResult, buildStageOptions,
  }\n`
}

const baseline = evaluatePage(
  'pages/gain-structure/gain-structure.js',
  appendExports(baselineSource),
)
const currentSource = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.js'), 'utf8')
const current = evaluatePage(
  'pages/gain-structure/gain-structure.js',
  appendExports(currentSource),
)

function makeState(api, amplifierIndex, stageValue, modeIndex, loadValue, targetPeakDbfs) {
  const amplifier = api.amplifiers[amplifierIndex]
  const amplifierState = api.buildAmplifierState(amplifierIndex)
  const stageIndex = amplifierState.stageOptions.findIndex((option) => option.value === stageValue)
  const modes = api.modes
  const loadOptions = amplifierState.showPowerContext
    ? api.buildLoadOptions(amplifier, modes[modeIndex].value)
    : []
  const loadIndex = amplifierState.showPowerContext
    ? loadOptions.findIndex((option) => option.value === loadValue)
    : -1
  const targetPeakIndex = api.targetPeaks.findIndex((option) => option.value === targetPeakDbfs)
  return {
    ...current.definition.data,
    ...amplifierState,
    modes,
    targetPeaks: api.targetPeaks,
    stageIndex,
    modeIndex,
    loadOptions,
    loadIndex,
    targetPeakIndex,
  }
}

function canonicalTextAndPayload(page, state, result) {
  const text = page.getResultText(state, result)
  const payload = page.getRecordPayload(state, result)
  return { text, payload }
}

const tests = []
function test(name, run) { tests.push({ name, run }) }

test('pre-refactor calculation and canonical output match across every real amplifier combination', () => {
  const alignmentModes = new Set()
  let combinationCount = 0
  for (let amplifierIndex = 0; amplifierIndex < amplifiers.length; amplifierIndex += 1) {
    const inputStage = amplifierInputStages[amplifiers[amplifierIndex].model]
    if (!inputStage) continue
    const isVoltageGain = inputStage.controlType === 'voltageGain'
    const modeIndices = isVoltageGain ? [0, 1] : [0]
    for (const stageValue of inputStage.options) {
      for (const modeIndex of modeIndices) {
        const amplifier = amplifiers[amplifierIndex]
        const mode = baseline.api.modes[modeIndex].value
        const loadOptions = isVoltageGain
          ? baseline.api.buildLoadOptions(amplifier, mode)
          : []
        const loadValues = isVoltageGain ? loadOptions.map((item) => item.value) : [null]
        for (const loadValue of loadValues) {
          for (const targetPeakDbfs of baseline.api.targetPeaks.map((item) => item.value)) {
            const referenceState = makeState(
              baseline.api, amplifierIndex, stageValue, modeIndex, loadValue, targetPeakDbfs,
            )
            const currentState = makeState(
              current.api, amplifierIndex, stageValue, modeIndex, loadValue, targetPeakDbfs,
            )
            const label = `${amplifier.model}/${stageValue}/${mode}/${loadValue}/${targetPeakDbfs}`
            const referenceResult = baseline.api.calculatePageResult(referenceState)
            const currentResult = current.api.calculatePageResult(currentState)
            assert.deepStrictEqual(currentResult, referenceResult, `${label} result changed`)
            combinationCount += 1
            if (!referenceResult.valid) continue
            alignmentModes.add(referenceResult.alignmentMode)
            const referenceTextAndPayload = canonicalTextAndPayload(
              baseline.definition, referenceState, referenceResult,
            )
            const currentTextAndPayload = canonicalTextAndPayload(
              current.definition, currentState, currentResult,
            )
            assert.deepStrictEqual(currentTextAndPayload, referenceTextAndPayload,
              `${label} canonical text or record payload changed`)
          }
        }
      }
    }
  }
  assert(combinationCount > 500, `expected a full model matrix, checked ${combinationCount}`)
  for (const mode of ['attenuate', 'direct', 'insufficientDrive']) {
    if (mode !== 'direct') assert(alignmentModes.has(mode), `the selectable equipment matrix did not cover ${mode}`)
  }
  const directAmpIndex = amplifiers.findIndex((item) => item.model === 'KT-P21000')
  const directBase = makeState(baseline.api, directAmpIndex, 1, 0, null, -6)
  const directBaseResult = baseline.api.calculatePageResult(directBase)
  const directTarget = Math.round((directBaseResult.fullPowerInputDbu - directBaseResult.dspMaxOutputDbu) * 100) / 100
  const directReferenceState = makeState(baseline.api, directAmpIndex, 1, 0, null, -6)
  const directCurrentState = makeState(current.api, directAmpIndex, 1, 0, null, -6)
  directReferenceState.targetPeaks = [{ value: directTarget, label: `${directTarget} dBFS` }]
  directCurrentState.targetPeaks = [{ value: directTarget, label: `${directTarget} dBFS` }]
  directReferenceState.targetPeakIndex = 0
  directCurrentState.targetPeakIndex = 0
  const directReference = baseline.api.calculatePageResult(directReferenceState)
  const directResult = current.api.calculatePageResult(directCurrentState)
  assert.strictEqual(directResult.alignmentMode, 'direct', 'the zero-difference boundary should render the direct state')
  alignmentModes.add(directResult.alignmentMode)
  assert.deepStrictEqual(directResult, directReference, 'direct alignment result changed')
  assert.deepStrictEqual(
    canonicalTextAndPayload(current.definition, directCurrentState, directResult),
    canonicalTextAndPayload(baseline.definition, directReferenceState, directReference),
    'direct alignment text or payload changed',
  )
  for (let amplifierIndex = 0; amplifierIndex < amplifiers.length; amplifierIndex += 1) {
    const inputStage = amplifierInputStages[amplifiers[amplifierIndex].model]
    if (!inputStage) continue
    const modeIndex = inputStage.controlType === 'voltageGain' ? 1 : 0
    const invalidReference = makeState(baseline.api, amplifierIndex, inputStage.options[0], modeIndex, null, -6)
    const invalidCurrent = makeState(current.api, amplifierIndex, inputStage.options[0], modeIndex, null, -6)
    invalidReference.stageIndex = -1
    invalidCurrent.stageIndex = -1
    assert.deepStrictEqual(
      current.api.calculatePageResult(invalidCurrent),
      baseline.api.calculatePageResult(invalidReference),
      `${amplifiers[amplifierIndex].model} invalid core input changed`,
    )
  }
})

function makeWx(options = {}) {
  const storage = new Map()
  recordStorageKeys.forEach((key) => storage.set(key, key.endsWith('.v1') ? [] : ''))
  if (options.preferences) storage.set(preferencesKey, { ...options.preferences })
  const copied = []
  let preferenceWrites = 0
  const sharePaths = []
  const savePaths = []
  const previewPaths = []
  const exports = []
  const accessRequests = []
  const wx = {
    getStorageSync(key) {
      if (options.failReads?.has(key)) throw new Error('read failed')
      return storage.get(key)
    },
    setStorageSync(key, value) {
      if (options.failWrites?.has(key)) throw new Error('write failed')
      if (key === preferencesKey) preferenceWrites += 1
      storage.set(key, value)
    },
    removeStorageSync(key) {
      if (options.failRemoves?.has(key)) throw new Error('remove failed')
      storage.delete(key)
    },
    getStorageInfoSync: () => ({ currentSize: 0, limitSize: 10240 }),
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 812, pixelRatio: 2, theme: 'light' }),
    getWindowInfo: () => ({ windowHeight: options.windowHeight || 812, windowWidth: 375 }),
    canIUse: () => options.pageContainerSupported !== false,
    vibrateShort: () => {},
    showToast: () => {},
    showModal: ({ success }) => success?.({ confirm: true }),
    setClipboardData: ({ data }) => copied.push(data),
    navigateTo: () => {},
    hideKeyboard: () => {},
    getFileSystemManager: () => ({
      access(request) {
        if (options.access) options.access(request, accessRequests)
        else accessRequests.push(request)
      },
    }),
    createCanvasContext() {
      return new Proxy({}, {
        get(_target, key) {
          if (key === 'measureText') return (value) => ({ width: String(value).length * 7 })
          if (key === 'draw') return (reserve, callback) => {
            const done = typeof reserve === 'function' ? reserve : callback
            done?.()
          }
          return () => {}
        },
      })
    },
    canvasToTempFilePath(request) { exports.push(request) },
    showShareImageMenu: ({ path: imagePath }) => sharePaths.push(imagePath),
    saveImageToPhotosAlbum: ({ filePath }) => savePaths.push(filePath),
    previewImage: ({ current }) => previewPaths.push(current),
  }
  return { wx, storage, copied, sharePaths, savePaths, previewPaths, exports, accessRequests, get preferenceWrites() { return preferenceWrites } }
}

function bootPage(options = {}, recordOverrides) {
  const context = makeWx(options)
  const previousWx = global.wx
  global.wx = context.wx
  const realSnapshot = records.getWorkspaceSnapshot
  try {
    realSnapshot({ forceRefresh: true })
  } catch (error) {}
  const loaded = evaluatePage(
    'pages/gain-structure/gain-structure.js',
    currentSource,
    recordOverrides,
  )
  const page = Object.assign({}, loaded.definition, {
    data: JSON.parse(JSON.stringify(loaded.definition.data)),
    setData(changes, callback) {
      Object.assign(this.data, changes)
      if (callback) callback.call(this)
    },
  })
  page.onLoad()
  page.onShow()
  return {
    ...context,
    page,
    restore() { global.wx = previousWx },
  }
}

test('fresh start, saved-draft restore, reset, and relaunch preserve saved records', () => {
  const context = bootPage()
  try {
    const { page } = context
    assert.strictEqual(page.data.pageContainerSupported, true,
      'onLoad should reflect support for the native page-container')
    assert.strictEqual(page.data.calculationState, 'empty')
    assert.strictEqual(page.data.result, null)
    assert.strictEqual(page.data.selectedAmplifier, null)
    assert.strictEqual(page.data.hasValidResult, false)
    assert.strictEqual(page.data.canReset, false)
    assert.deepStrictEqual(page.data.groupTabs.map((item) => item.key), ['amplifier', 'calibration'])
  } finally { context.restore() }

  const restored = bootPage({ preferences: restoredValidPreferences })
  try {
    assert.strictEqual(restored.page.data.hasSavedDraft, true)
    assert.strictEqual(restored.page.data.calculationState, 'valid')
    assert.strictEqual(restored.page.data.result.valid, true)
    assert.strictEqual(restored.page.data.showPowerContext, false)
    assert.strictEqual(restored.page.data.loadIndex, -1)
    assert(!restored.page.data.groupTabs.some((item) => item.key === 'load'))
    assert.strictEqual(restored.page.getRecordPayload().module, 'gainStructure')
    assert.strictEqual(restored.page.toggleCurrentFavorite(), true)
    const favorited = records.getWorkspaceSnapshot({ forceRefresh: true }).records
    assert.strictEqual(favorited.length, 1)
    assert.strictEqual(favorited[0].favorite, true)
    const favoriteId = favorited[0].id
    restored.page.onHide()
    restored.page.onShow()
    assert.strictEqual(restored.page.data.currentFavorite, true)
    restored.page.toggleCurrentFavorite()
    assert.strictEqual(restored.page.data.currentFavorite, false)
    restored.page.toggleCurrentFavorite()
    const toggledAgain = records.getWorkspaceSnapshot({ forceRefresh: true }).records
    assert.strictEqual(toggledAgain.length, 1, 'repeated favorite changes must not duplicate the record')
    assert.strictEqual(toggledAgain[0].favorite, true)
    assert.strictEqual(toggledAgain[0].resultSignature, favorited[0].resultSignature,
      'repeated favorite changes should preserve one record for the same result')
    const resetFailure = new Set([preferencesKey])
    const failureContext = bootPage({ preferences: restoredValidPreferences, failRemoves: resetFailure })
    try {
      failureContext.page.toggleCurrentFavorite()
      const beforeFailedReset = failureContext.page.data.result
      assert.strictEqual(failureContext.page.requestReset(), true)
      assert.strictEqual(failureContext.page.data.result, beforeFailedReset,
        'failed preference removal must preserve the calculation')
      assert.strictEqual(failureContext.page.data.currentFavorite, true,
        'failed preference removal must preserve the favorite state')
      assert(failureContext.page.data.resetError, 'failed preference removal must show a persistent reset error')
      assert.strictEqual(failureContext.storage.has(preferencesKey), true)
      resetFailure.delete(preferencesKey)
      assert.strictEqual(failureContext.page.requestReset(), true)
      assert.strictEqual(failureContext.page.data.result, null)
      assert.strictEqual(failureContext.page.data.resetError, '')
    } finally { failureContext.restore() }
    assert.strictEqual(restored.page.clearDraft(), true)
    assert.strictEqual(restored.page.data.result, null)
    assert.strictEqual(restored.page.data.hasSavedDraft, false)
    assert.strictEqual(restored.storage.has(preferencesKey), false)
    const afterReset = records.getWorkspaceSnapshot({ forceRefresh: true }).records
    assert.strictEqual(afterReset.length, 1)
    assert.strictEqual(afterReset[0].favorite, true)
  } finally { restored.restore() }

  const fallback = bootPage({ pageContainerSupported: false })
  try {
    assert.strictEqual(fallback.page.data.pageContainerSupported, false,
      'onLoad should reflect the fallback overlay path')
  } finally { fallback.restore() }

  const relaunched = bootPage()
  try {
    assert.strictEqual(relaunched.page.data.calculationState, 'empty')
    assert.strictEqual(relaunched.page.data.result, null)
  } finally { relaunched.restore() }
})

test('semantic edits derive immediately, clear incomplete output, and omit load for sensitivity models', () => {
  const context = bootPage({ preferences: restoredValidPreferences })
  try {
    const { page } = context
    assert.strictEqual(page.data.result.valid, true)
    const initialRevision = page._inputRevision
    const voltageIndex = amplifiers.findIndex((item) => item.model === 'TC-22000')
    assert(page.selectAmplifier({ currentTarget: { dataset: { index: voltageIndex } } }))
    assert.strictEqual(page.data.showPowerContext, true)
    assert(page.data.groupTabs.some((item) => item.key === 'load'))
    assert.strictEqual(page.data.calculationState, 'incomplete')
    assert.strictEqual(page.data.result, null,
      'selecting a new model must immediately discard the previous result')
    assert.strictEqual(page.data.hasValidResult, false)
    assert.strictEqual(page.data.currentFavorite, false)
    assert(page.onStageTap({ currentTarget: { dataset: { index: 0 } } }),
      'the voltage-gain model requires an explicit stage selection')
    assert.strictEqual(page.data.hasValidResult, false)
    assert.strictEqual(page.getRecordPayload(), null)
    assert.strictEqual(page.data.loadReminderActive, true)
    assert(page.onModeTap({ currentTarget: { dataset: { index: 1 } } }))
    assert.strictEqual(page.data.loadIndex, 0)
    assert.strictEqual(page.data.loadReminderActive, true)
    assert.strictEqual(page.data.hasValidResult, false)
    assert(page.onLoadChange({ detail: { value: 2 } }))
    assert.strictEqual(page.data.loadReminderActive, false)
    assert.strictEqual(page.data.calculationState, 'valid')
    assert.strictEqual(page.data.result.valid, true,
      'a complete voltage-gain selection should calculate on the load change')
    assert.strictEqual(page.data.hasValidResult, true)
    assert(page._inputRevision > initialRevision)
    assert.strictEqual(page.calculate().valid, true,
      'the compatibility calculate method should still derive the current result')

    page.onGroupTap({ currentTarget: { dataset: { group: 'load' } } })
    const sensitiveIndex = amplifiers.findIndex((item) => item.model === 'TC-X2200B')
    assert(page.selectAmplifier({ currentTarget: { dataset: { index: sensitiveIndex } } }))
    assert.strictEqual(page.data.activeGroup, 'amplifier')
    assert.strictEqual(page.data.showPowerContext, false)
    assert.strictEqual(page.data.loadOptions.length, 0)
    assert.strictEqual(page.data.loadIndex, -1)
    assert(!page.data.groupTabs.some((item) => item.key === 'load'))
    assert.strictEqual(page.data.calculationState, 'valid')
    assert.strictEqual(page.data.result.valid, true,
      'a sensitivity model must calculate without requiring a load selection')
    assert.strictEqual(page.data.hasValidResult, true)
  } finally { context.restore() }
})

test('restored completeness, invalid core warnings, and non-input UI events never expose stale output', () => {
  const incomplete = bootPage({ preferences: {
    amplifierModel: 'TC-22000',
    mode: 'stereo',
    loadImpedance: null,
    targetPeakDbfs: -6,
  } })
  try {
    const { page } = incomplete
    assert.strictEqual(page.data.hasSavedDraft, true)
    assert.strictEqual(page.data.stageIndex, -1)
    assert.strictEqual(page.data.result, null)
    assert.strictEqual(page.data.calculationState, 'incomplete')
    assert.strictEqual(page.data.hasValidResult, false)
    assert.strictEqual(page.data.loadReminderActive, true)
    assert.strictEqual(page.getRecordPayload(), null)
    assert(page.onStageTap({ currentTarget: { dataset: { index: 0 } } }))
    assert.strictEqual(page.data.result, null,
      'a valid stage with an unselected voltage-gain load must remain incomplete')
    assert(page.data.outputHint.includes('负载阻抗'))
    assert(page.onLoadChange({ detail: { value: 1 } }))
    assert.strictEqual(page.data.result.valid, true,
      'restored missing dependencies should resolve through the same automatic path')
    assert.strictEqual(page.data.loadReminderActive, false)

    const revision = page._inputRevision
    const writes = incomplete.preferenceWrites
    page.onGroupTap({ currentTarget: { dataset: { group: 'calibration' } } })
    page.openAmplifierSelector()
    page.closeAmplifierSelector()
    page.onHide()
    page.onShow()
    assert.strictEqual(page._inputRevision, revision,
      'group, selector, hide, and show events must not recalculate semantic input')
    assert.strictEqual(incomplete.preferenceWrites, writes,
      'presentation-only events must not rewrite the input draft')
  } finally { incomplete.restore() }

  const invalid = bootPage({ preferences: restoredValidPreferences })
  try {
    const { page } = invalid
    page.data.targetPeaks[page.data.targetPeakIndex].value = 1
    const coreWarning = page.calculate()
    assert.strictEqual(coreWarning.valid, false)
    assert.strictEqual(page.data.calculationState, 'invalid')
    assert.strictEqual(page.data.result.warning, coreWarning.warning)
    assert.strictEqual(page.data.hasValidResult, false)
    assert.strictEqual(page.getRecordPayload(), null,
      'a core validation warning must hide the prior numeric result and actions')
  } finally { invalid.restore() }
})

test('out-of-order setData callbacks cannot restore old preferences or favorite state', () => {
  const context = bootPage({ preferences: restoredValidPreferences })
  try {
    const { page } = context
    const originalSetData = page.setData
    const callbacks = []
    page.setData = function queueCallbacks(changes, callback) {
      Object.assign(this.data, changes)
      if (callback) callbacks.push(callback)
    }
    const startingWrites = context.preferenceWrites
    const startingRevision = page._inputRevision
    assert(page.onTargetPeakTap({ currentTarget: { dataset: { index: 0 } } }))
    const olderCallback = callbacks[0]
    assert(page.onTargetPeakTap({ currentTarget: { dataset: { index: 2 } } }))
    const newerCallback = callbacks[1]
    assert.strictEqual(callbacks.length, 2)
    assert.strictEqual(context.preferenceWrites, startingWrites,
      'preferences should wait for the current view commit callback')
    assert(page._inputRevision > startingRevision)

    newerCallback.call(page)
    assert.strictEqual(context.storage.get(preferencesKey).targetPeakDbfs, -9,
      'the latest callback should persist the latest selected target')
    const writesAfterLatest = context.preferenceWrites
    olderCallback.call(page)
    assert.strictEqual(context.storage.get(preferencesKey).targetPeakDbfs, -9,
      'a delayed callback must not restore an older preference value')
    assert.strictEqual(context.preferenceWrites, writesAfterLatest,
      'a stale callback must not write preferences or synchronize an old favorite')
    assert.strictEqual(page.getRecordLookupPayload().preferences.targetPeakDbfs, -9)
    page.setData = originalSetData
  } finally { context.restore() }
})

test('invalid tap indexes do not mutate the calculation and V/dBu controls remain distinct', () => {
  const context = bootPage({ preferences: restoredValidPreferences })
  try {
    const { page } = context
    const before = page.data.result
    assert.strictEqual(page.onStageTap({ currentTarget: { dataset: { index: -1 } } }), false)
    assert.strictEqual(page.onStageTap({ currentTarget: { dataset: { index: 999 } } }), false)
    assert.strictEqual(page.onTargetPeakTap({ currentTarget: { dataset: { index: 999 } } }), false)
    assert.strictEqual(page.onModeTap({ currentTarget: { dataset: { index: 999 } } }), false)
    assert.strictEqual(page.onLoadChange({ detail: { value: 999 } }), false)
    assert.strictEqual(page.data.result, before)

    page.openAmplifierSelector()
    page.onSelectorInput({ detail: { value: 'TC-22000' } })
    assert.strictEqual(page.data.selectorKeyword, 'TC-22000')
    assert(page.data.amplifierCategories.length > 1)
    page.onSelectorCategoryTap({ currentTarget: { dataset: { index: 1 } } })
    assert.strictEqual(page.data.selectorCategoryIndex, 1)
    const filteredCount = page.data.selectorTotalCount
    assert.strictEqual(page.data.selectorItems.length, Math.min(60, filteredCount))
    page.closeAmplifierSelector()
    page.openAmplifierSelector()
    assert.strictEqual(page.data.selectorKeyword, '')
    assert.strictEqual(page.data.selectorCategoryIndex, 0)
    assert.strictEqual(page.data.selectorTotalCount, amplifiers.length)
    assert.strictEqual(page.data.selectorItems.length, Math.min(60, amplifiers.length))
    page.closeAmplifierSelector()

    const dbuIndex = amplifiers.findIndex((item) => item.model === 'TC-41500DT')
    assert(page.selectAmplifier({ currentTarget: { dataset: { index: dbuIndex } } }))
    assert.strictEqual(page.data.stageTypeLabel, '输入灵敏度档位')
    assert(page.data.stageOptions.every((option) => option.label.endsWith('dBu')))
    assert(!page.data.groupTabs.some((item) => item.key === 'load'))
    assert.strictEqual(page.onSelectorCategoryTap({ currentTarget: { dataset: { index: 999 } } }), undefined)
  } finally { context.restore() }
})

test('report generation, file cache validation, cancellation, and actions use one current image path', () => {
  const context = bootPage({ preferences: restoredValidPreferences })
  try {
    const { page, exports, accessRequests, sharePaths, savePaths, previewPaths } = context
    page.openSharePreview()
    assert.strictEqual(exports.length, 1)
    assert.strictEqual(page.data.isGeneratingResultReport, true)
    const interrupted = exports.shift()
    page.closeSharePreview()
    interrupted.success({ tempFilePath: 'temp://stale-gain.png' })
    assert.strictEqual(page.data.resultReportImagePath, '')
    assert.strictEqual(page.data.shareSheetVisible, false)

    page.openSharePreview()
    const firstExport = exports.shift()
    firstExport.success({ tempFilePath: 'temp://gain-result.png' })
    assert.strictEqual(page.data.resultReportImagePath, 'temp://gain-result.png')
    assert.strictEqual(page.data.resultReportPreviewVisible, true)
    assert.strictEqual(page.openSharePreview(), false, 'repeated open should not duplicate the sheet')
    page.closeSharePreview()

    page.openSharePreview()
    assert.strictEqual(accessRequests.length, 1)
    assert.strictEqual(page.data.isCheckingResultReportCache, true)
    const staleAccess = accessRequests.shift()
    page.closeSharePreview()
    staleAccess.success()
    assert.strictEqual(page.data.resultReportPreviewVisible, false)
    assert.strictEqual(page.data.shareSheetVisible, false)

    page.openSharePreview()
    const validAccess = accessRequests.shift()
    assert.strictEqual(validAccess.path, 'temp://gain-result.png')
    validAccess.success()
    assert.strictEqual(page.data.isCheckingResultReportCache, false)
    assert.strictEqual(page.data.resultReportPreviewVisible, true)
    page.closeSharePreview()
    page.openSharePreview()
    const missingCache = accessRequests.shift()
    missingCache.fail()
    assert.strictEqual(exports.length, 1, 'a missing temp image must trigger exactly one regeneration')
    exports.shift().success({ tempFilePath: 'temp://gain-regenerated.png' })
    assert.strictEqual(page.data.resultReportImagePath, 'temp://gain-regenerated.png')
    page.previewResultReportImage()
    page.shareResultReportImage()
    page.saveResultReportImage()
    assert.deepStrictEqual(previewPaths, ['temp://gain-regenerated.png'])
    assert.deepStrictEqual(sharePaths, ['temp://gain-regenerated.png'])
    assert.deepStrictEqual(savePaths, ['temp://gain-regenerated.png'])
    page.closeSharePreview()

    page.openSharePreview()
    const hideAccess = accessRequests.shift()
    page.onHide()
    hideAccess.success()
    assert.strictEqual(page.data.shareSheetVisible, false)
    assert.strictEqual(page.data.resultReportPreviewVisible, false)
  } finally { context.restore() }
})

test('semantic edits invalidate in-flight report cache and export callbacks', () => {
  const context = bootPage({ preferences: restoredValidPreferences })
  try {
    const { page, exports, accessRequests } = context
    page.openSharePreview()
    const firstExport = exports.shift()
    firstExport.success({ tempFilePath: 'temp://current-before-edit.png' })
    assert.strictEqual(page.data.resultReportImagePath, 'temp://current-before-edit.png')
    page.closeSharePreview()

    page.openSharePreview()
    const pendingAccess = accessRequests.shift()
    assert(pendingAccess, 'the saved image should use asynchronous file-liveness validation')
    assert.strictEqual(page.onTargetPeakTap({ currentTarget: { dataset: { index: 0 } } }), true)
    assert.strictEqual(page.data.shareSheetVisible, false)
    assert.strictEqual(page.data.resultReportImagePath, '')
    pendingAccess.success()
    assert.strictEqual(page.data.resultReportPreviewVisible, false,
      'a cache callback from the previous input revision must not revive the old preview')
    assert.strictEqual(page.data.resultReportImagePath, '')

    page.openSharePreview()
    const pendingExport = exports.shift()
    assert(pendingExport, 'the edited result should start a fresh image export')
    assert.strictEqual(page.onTargetPeakTap({ currentTarget: { dataset: { index: 2 } } }), true)
    pendingExport.success({ tempFilePath: 'temp://stale-after-edit.png' })
    assert.strictEqual(page.data.resultReportImagePath, '',
      'an export callback from an older input revision must not store its image')
    assert.strictEqual(page.data.resultReportPreviewVisible, false)
    assert.strictEqual(page.data.hasValidResult, true,
      'each target edit should still have its own immediately derived result')
  } finally { context.restore() }
})

test('project selection, create, frozen save, deletion/rename recheck, write errors, and keyboard episodes', () => {
  const addCalls = []
  const recordsOverride = {
    ...records,
    getWorkspaceSnapshot(...args) {
      if (recordsOverride.beforeSnapshot) return recordsOverride.beforeSnapshot(...args)
      return records.getWorkspaceSnapshot(...args)
    },
    addRecordToProject(...args) {
      addCalls.push(args)
      if (recordsOverride.failAdd) return null
      return records.addRecordToProject(...args)
    },
  }
  const context = bootPage({ preferences: restoredValidPreferences }, recordsOverride)
  try {
    const { page } = context
    const firstProject = records.createProject('演示项目')
    page.openProjectSheet()
    assert.strictEqual(page.data.projectLoadState, 'ready')
    assert.strictEqual(page.data.projectItems[0].id, firstProject.id)
    page.chooseProject({ currentTarget: { dataset: { id: firstProject.id } } })
    assert.strictEqual(page.saveProjectConfiguration(), true)
    assert.strictEqual(page.data.projectStep, 'success')
    assert.strictEqual(addCalls.length, 1)
    assert.strictEqual(addCalls[0].length, 2, 'gain save must call the records API with exactly two arguments')
    assert.strictEqual(addCalls[0][0].module, 'gainStructure')
    assert.strictEqual(records.getProjectRecords(firstProject.id).length, 1)
    assert.strictEqual(page.saveProjectConfiguration(), false, 'repeated save must not add a duplicate record')
    page.closeProjectSheet()

    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: firstProject.id } } })
    const addCountBeforeChange = addCalls.length
    page.onTargetPeakTap({ currentTarget: { dataset: { index: 0 } } })
    assert.strictEqual(page.data.projectSheetVisible, false,
      'changing an input must close a sheet holding a frozen result')
    assert.strictEqual(page.saveProjectConfiguration(), false)
    assert.strictEqual(addCalls.length, addCountBeforeChange,
      'a project sheet opened for an older result must not write either payload')
    assert.strictEqual(page.data.result.valid, true,
      'the edited result should already be current when the sheet closes')

    const interruptedProject = records.createProject('读取期间输入变化')
    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: interruptedProject.id } } })
    const addCountBeforeInterruptedRead = addCalls.length
    recordsOverride.beforeSnapshot = (...args) => {
      recordsOverride.beforeSnapshot = null
      const nextTarget = page.data.targetPeakIndex === 2 ? 0 : 2
      page.onTargetPeakTap({ currentTarget: { dataset: { index: nextTarget } } })
      return records.getWorkspaceSnapshot(...args)
    }
    assert.strictEqual(page.saveProjectConfiguration(), false,
      'an edit during the project recheck must cancel the frozen save')
    assert.strictEqual(addCalls.length, addCountBeforeInterruptedRead,
      'a superseded project payload must never reach records storage')
    assert.strictEqual(page._projectSavePending, false,
      'input edits must release the interrupted save lock')
    assert.strictEqual(page._projectSnapshotForSave, null,
      'input edits must discard the old frozen payload')
    assert.strictEqual(page.data.projectSheetVisible, false)
    assert.strictEqual(page.data.result.valid, true)
    assert.strictEqual(page.openProjectSheet(), true,
      'a fresh sheet should open immediately after the interrupted save is invalidated')
    page.chooseProject({ currentTarget: { dataset: { id: interruptedProject.id } } })
    assert.strictEqual(page.saveProjectConfiguration(), true,
      'the fresh current snapshot should save normally')
    assert.strictEqual(addCalls.length, addCountBeforeInterruptedRead + 1)
    page.closeProjectSheet()

    const searchProjectA = records.createProject('Alpha Target')
    const searchProjectB = records.createProject('Beta Target')
    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: searchProjectA.id } } })
    const addCountBeforeSearch = addCalls.length
    page.onProjectSearch({ detail: { value: 'Beta Target' } })
    assert.deepStrictEqual(page.data.projectItems.map((item) => item.id), [searchProjectB.id])
    assert.strictEqual(page.data.projectTargetId, '',
      'searching away from a selected target must clear the hidden project')
    assert.strictEqual(page.saveProjectConfiguration(), false,
      'a hidden project must not remain a valid save target')
    assert.strictEqual(addCalls.length, addCountBeforeSearch)
    page.chooseProject({ currentTarget: { dataset: { id: searchProjectB.id } } })
    assert.strictEqual(page.saveProjectConfiguration(), true,
      'selecting the visible search result should permit saving')
    assert.strictEqual(addCalls.length, addCountBeforeSearch + 1)
    page.closeProjectSheet()

    const renamedProject = records.createProject('待改名项目')
    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: renamedProject.id } } })
    records.updateProject(renamedProject.id, { name: '已改名项目' })
    assert.strictEqual(page.saveProjectConfiguration(), false)
    assert.strictEqual(page.data.projectTargetId, '')
    assert(page.data.projectSaveError.includes('名称已变化'))
    page.closeProjectSheet()

    const deletedProject = records.createProject('待删除项目')
    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: deletedProject.id } } })
    records.deleteProject(deletedProject.id)
    assert.strictEqual(page.saveProjectConfiguration(), false)
    assert.strictEqual(page.data.projectTargetId, '')
    assert(page.data.projectSaveError.includes('不存在'))
    page.closeProjectSheet()

    page.openProjectSheet()
    page.beginNewProject()
    page.onNewProjectNameInput({ detail: { value: '新项目' } })
    assert.strictEqual(page.createProjectFromForm(), true)
    assert.strictEqual(page.data.projectTargetName, '新项目')
    assert.strictEqual(page.saveProjectConfiguration(), true)
    page.closeProjectSheet()

    recordsOverride.failAdd = true
    const failureProject = records.createProject('写入失败项目')
    page.openProjectSheet()
    page.chooseProject({ currentTarget: { dataset: { id: failureProject.id } } })
    assert.strictEqual(page.saveProjectConfiguration(), false)
    assert(page.data.projectSaveError.includes('保存失败'))
    assert.strictEqual(page.data.isSavingProject, false)
    page.closeProjectSheet()

    page.openProjectSheet()
    const episode = page.data.projectKeyboardEpisode
    const focusEvent = { currentTarget: { dataset: { projectField: 'projectSearch', projectEpisode: episode } }, timeStamp: 100 }
    assert.strictEqual(page.onProjectInputFocus(focusEvent), true)
    assert.strictEqual(page.onProjectKeyboardHeightChange({
      ...focusEvent,
      size: { windowHeight: 512 },
      detail: { height: 300 },
    }), true)
    assert.strictEqual(page.data.projectKeyboardActive, true)
    assert(page.data.projectKeyboardVisibleHeight <= 512)
    const latePositiveHeight = { ...focusEvent, size: { windowHeight: 512 }, detail: { height: 260 } }
    assert.strictEqual(page.onProjectInputBlur({ ...focusEvent, timeStamp: 200 }), true)
    assert.strictEqual(page.data.projectKeyboardActive, false,
      'blur must restore the sheet even when no height-zero event arrives')
    assert.strictEqual(page.data.projectKeyboardPanelStyle, '')
    assert.strictEqual(page.onProjectKeyboardHeightChange(latePositiveHeight), false,
      'height callbacks from the blurred keyboard episode must be ignored')
    const staleKeyboardEvent = { ...focusEvent, size: { windowHeight: 512 }, detail: { height: 260 } }
    page.resetProjectKeyboardState()
    assert.strictEqual(page.onProjectKeyboardHeightChange(staleKeyboardEvent), false)
    page.onPageContainerBeforeLeave()
    assert.strictEqual(page.onPageContainerAfterLeave(), true)
    assert.strictEqual(page.data.projectSheetVisible, false)
  } finally { context.restore() }
})

let failures = 0
for (const { name, run } of tests) {
  try {
    run()
    process.stdout.write(`PASS ${name}\n`)
  } catch (error) {
    failures += 1
    process.stderr.write(`FAIL ${name}\n${error.stack || error}\n`)
  }
}
if (failures) process.exitCode = 1
else process.stdout.write(`Passed ${tests.length} gain refactor tests.\n`)

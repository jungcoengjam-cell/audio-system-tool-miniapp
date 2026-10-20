const assert = require('assert')
const fs = require('fs')

let pageDefinition = null
global.Page = (definition) => { pageDefinition = definition }

function createRuntime(options = {}) {
  const runtime = {
    toasts: [], clipboard: [], saves: [], shares: [], previews: [], reportExports: [], reportTexts: [], reportLineWidths: [],
    reportDrawCallbacks: [], reportContextIds: [], removedThemeHandlers: [], pendingClipboardCallbacks: [],
    screenQueries: 0, screenDraws: 0, screenTexts: [], transforms: [], scaleCalls: 0,
    screenNodeCreations: 0, deferNextScreenQuery: false, pendingScreenQueries: [],
    measuredWidth: 319, throwNextScreenContext: false, page: null, canvasAttached: false,
    storage: new Map(Object.entries(options.storage || {})), storageWrites: [],
    failStorageRead: Boolean(options.failStorageRead), failStorageWrite: Boolean(options.failStorageWrite),
    storageApiAvailable: options.storageApiAvailable !== false,
  }

  function createScreenContext() {
    const context = {
      font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      textAlign: 'left', textBaseline: 'alphabetic',
      beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
      fill() {}, stroke() {}, arc() {},
      fillRect(...args) { runtime.screenDraws += 1; runtime.lastScreenFillRect = args },
      fillText(value, x, y) { runtime.screenTexts.push({ value, x, y, font: this.font }) },
      setTransform(...args) { runtime.transforms.push(args) },
      scale() { runtime.scaleCalls += 1 },
    }
    return context
  }

  function createScreenNode() {
    runtime.screenNodeCreations += 1
    const context = createScreenContext()
    return {
      id: runtime.screenNodeCreations,
      width: 0,
      height: 0,
      getContext(kind) {
        assert.strictEqual(kind, '2d')
        if (runtime.throwNextScreenContext) {
          runtime.throwNextScreenContext = false
          throw new Error('simulated 2D context failure')
        }
        return context
      },
    }
  }

  runtime.attachScreenCanvas = () => {
    runtime.canvasAttached = true
    runtime.screenCanvasNode = createScreenNode()
  }
  runtime.detachScreenCanvas = () => { runtime.canvasAttached = false }
  runtime.snapshotScreenQuery = () => ({
    node: runtime.canvasAttached ? runtime.screenCanvasNode : null,
    width: runtime.canvasAttached && runtime.page ? runtime.measuredWidth : 0,
    height: runtime.canvasAttached && runtime.page ? runtime.page.data.diagramCanvasHeight : 0,
  })
  runtime.resolveNextScreenQuery = () => {
    const pending = runtime.pendingScreenQueries.shift()
    assert(pending, 'a deferred screen canvas query should exist')
    pending.callback([pending.result])
  }

  function createReportContext(canvasId) {
    runtime.reportContextIds.push(canvasId)
    return {
      font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      textAlign: 'left', textBaseline: 'alphabetic',
      setFontSize(size) { this.font = `${size}px sans-serif` },
      setFillStyle(value) { this.fillStyle = value },
      setTextAlign(value) { this.textAlign = value },
      setTextBaseline(value) { this.textBaseline = value },
      fillText(value) { runtime.reportTexts.push(String(value)) }, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
      fill() {}, setStrokeStyle(value) { this.strokeStyle = value },
      setLineWidth(value) { this.lineWidth = value; runtime.reportLineWidths.push(value) },
      stroke() {}, arc() {}, fillRect() {}, save() {}, scale() {}, restore() {},
      draw(reserve, callback) {
        runtime.reportDrawCallbacks.push(callback)
      },
    }
  }

  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }),
    getAppBaseInfo: () => ({ theme: 'light' }),
    ...(runtime.storageApiAvailable ? {
      getStorageSync(key) {
        if (runtime.failStorageRead) throw new Error('simulated storage read failure')
        return runtime.storage.get(key)
      },
      setStorageSync(key, value) {
        if (runtime.failStorageWrite) throw new Error('simulated storage write failure')
        runtime.storage.set(key, value)
        runtime.storageWrites.push({ key, value: JSON.parse(JSON.stringify(value)) })
      },
    } : {}),
    onThemeChange() {},
    offThemeChange(handler) { runtime.removedThemeHandlers.push(handler) },
    showToast(value) { runtime.toasts.push(value) },
    showLoading() {}, hideLoading() {}, vibrateShort() {},
    setClipboardData(value) {
      runtime.clipboard.push(value.data)
      if (runtime.deferClipboardCallback) runtime.pendingClipboardCallbacks.push(value)
      else if (value.success) value.success()
    },
    previewImage(value) { runtime.previews.push(value) },
    showShareImageMenu(value) { runtime.shares.push(value) },
    saveImageToPhotosAlbum(value) { runtime.saves.push(value.filePath); if (value.success) value.success() },
    createSelectorQuery() {
      let page = null
      let selector = ''
      let fields = null
      const query = {
        in(value) { page = value; return query },
        select(value) { selector = value; return query },
        fields(value) { fields = value; return query },
        exec(callback) {
          runtime.screenQueries += 1
          assert.strictEqual(page, runtime.page)
          assert.strictEqual(selector, '#wiringDiagramCanvas')
          assert.deepStrictEqual(fields, { node: true, size: true })
          const result = runtime.snapshotScreenQuery()
          if (runtime.deferNextScreenQuery) {
            runtime.deferNextScreenQuery = false
            runtime.pendingScreenQueries.push({ callback, result })
          } else callback([result])
        },
      }
      return query
    },
    createCanvasContext(canvasId) {
      assert.strictEqual(canvasId, 'resultReportCanvas', 'only the shared legacy export canvas should be used')
      return createReportContext(canvasId)
    },
    canvasToTempFilePath(value) { runtime.reportExports.push(value) },
  }
  return runtime
}

function createPage(runtime) {
  const page = {
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    mutationCount: 0,
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      this.mutationCount += 1
      if (Object.prototype.hasOwnProperty.call(changes, 'supported')) {
        if (changes.supported) {
          if (!runtime.canvasAttached) runtime.attachScreenCanvas()
        } else runtime.detachScreenCanvas()
      }
      if (callback) callback()
    },
  }
  for (const [key, value] of Object.entries(pageDefinition)) if (typeof value === 'function') page[key] = value
  runtime.page = page
  page.onLoad()
  assert.strictEqual(page.data.diagramError, '', 'diagramError must be declared on initial data')
  page.onShow()
  page.onReady()
  return page
}

function choose(page, side, id) {
  page.openEndpointSelector({ currentTarget: { dataset: { side } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id } } })
}

function chooseRequirement(page, requirementId, optionId) {
  page.selectWiringRequirement({ currentTarget: { dataset: { requirementId, optionId } } })
}

function testWiringPreferencesAndFirstUse() {
  const storageKey = 'audioWiringPreferencesV1'
  const { buildWiringText } = require('../pages/audio-wiring/wiring-model')
  const runtime = createRuntime()
  const page = createPage(runtime)
  assert.strictEqual(page.data.outputId, 'xlrBalanced')
  assert.strictEqual(page.data.inputId, 'terminalBalanced')
  assert.deepStrictEqual(page.data.manualSelected, { output: false, input: false })
  assert.strictEqual(runtime.storageWrites.length, 0, 'onLoad must not save the default example as user-selected')
  assert.strictEqual(page.data.supported, true, 'the ready default example remains usable without a new confirmation gate')
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.length, 1, 'the example can still be copied under the existing ready-model rule')
  assert.strictEqual(runtime.clipboard.at(-1),
    `默认示例，先核对实际两端接口。\n\n${buildWiringText(page.data.model)}`,
    'default clipboard text carries the example notice before the unchanged connection text')
  const defaultReport = startReport(page, runtime)
  assert(runtime.reportTexts.join('').includes('默认示例，先核对实际两端接口。'),
    'a standalone report preserves the default-example warning')
  defaultReport.success({ tempFilePath: '/tmp/default-example.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/default-example.png')
  page.closeResultReportPreview()
  assert.strictEqual(runtime.storageWrites.length, 0, 'copying/exporting does not persist a wiring plan')

  choose(page, 'output', 'xlrBalanced')
  assert.deepStrictEqual(page.data.manualSelected, { output: true, input: false },
    'reselecting the same output still records that the user checked it')
  assert.strictEqual(runtime.storageWrites.length, 1)
  assert.strictEqual(page.data.resultReportImagePath, '',
    'a changed example notice invalidates the old report image')
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.at(-1),
    `仍有接口为默认示例，请核对实际两端接口。\n\n${buildWiringText(page.data.model)}`,
    'one-endpoint selection carries the remaining example notice in copied text')
  choose(page, 'input', 'terminalBalanced')
  assert.deepStrictEqual(page.data.manualSelected, { output: true, input: true })
  assert.strictEqual(page.data.resultReportImagePath, '',
    'removing the last example notice invalidates the cached report')
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.at(-1), buildWiringText(page.data.model),
    'two manually checked endpoints copy only the original connection text')

  page.selectViewMode({ currentTarget: { dataset: { mode: 'connectors' } } })
  page.selectConnectorFace({ currentTarget: { dataset: { face: 'solder' } } })
  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  const writesBeforeRequirement = runtime.storageWrites.length
  chooseRequirement(page, 'sourceChannel', 'left')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert.strictEqual(runtime.storageWrites.length, writesBeforeRequirement,
    'requirements are transient and never written to local storage')
  choose(page, 'input', 'xlrBalanced')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')

  const stored = runtime.storage.get(storageKey)
  assert.deepStrictEqual(Object.keys(stored).sort(),
    ['face', 'inputId', 'manualSelected', 'outputId', 'version', 'viewMode'].sort(),
    'the saved preference schema contains no requirements, results, copied text, or pin plan')
  assert.strictEqual(stored.version, 1)
  assert.strictEqual(stored.outputId, 'stereo35')
  assert.strictEqual(stored.inputId, 'tsMono')
  assert.strictEqual(stored.viewMode, 'connectors')
  assert.strictEqual(stored.face, 'solder')
  assert.deepStrictEqual(stored.manualSelected, { output: true, input: true })
  const { OUTPUT_OPTIONS, INPUT_OPTIONS } = require('../pages/audio-wiring/wiring-model')
  assert(OUTPUT_OPTIONS.some((option) => option.id === stored.outputId))
  assert(INPUT_OPTIONS.some((option) => option.id === stored.inputId))

  const malicious = { ...stored, selections: { sourceChannel: 'left', outputMode: 'coldReturn' } }
  const restoredRuntime = createRuntime({ storage: { [storageKey]: malicious } })
  const restoredPage = createPage(restoredRuntime)
  assert.strictEqual(restoredPage.data.outputId, 'stereo35')
  assert.strictEqual(restoredPage.data.inputId, 'tsMono')
  assert.strictEqual(restoredPage.data.viewMode, 'connectors')
  assert.strictEqual(restoredPage.data.face, 'solder')
  assert.deepStrictEqual(restoredPage.data.selections, {}, 'cached requirement selections must be ignored')
  assert.strictEqual(restoredPage.data.wiringStatus, 'needs-choice')
  assert.strictEqual(restoredPage.data.supported, false)
  assert.strictEqual(restoredPage.data.showRestoredHint, true)
  assert(restoredPage.data.requirements.some((item) => item.id === 'sourceChannel' && !item.value),
    'stereo channel must be chosen again after re-entry')
  const copiesBeforeRestoreAttempt = restoredRuntime.clipboard.length
  const exportsBeforeRestoreAttempt = restoredRuntime.reportExports.length
  restoredPage.copyConnection()
  restoredPage.generateResultReportImage()
  assert.strictEqual(restoredRuntime.clipboard.length, copiesBeforeRestoreAttempt)
  assert.strictEqual(restoredRuntime.reportExports.length, exportsBeforeRestoreAttempt,
    'restored endpoints cannot bypass the needs-choice safety state')

  const maliciousColdReturn = {
    ...stored,
    outputId: 'xlrBalanced',
    inputId: 'rcaStereo',
    selections: { outputMode: 'coldReturn', destinationChannel: 'both', sourceChannel: 'right' },
  }
  const coldRestoreRuntime = createRuntime({ storage: { [storageKey]: maliciousColdReturn } })
  const coldRestorePage = createPage(coldRestoreRuntime)
  assert.deepStrictEqual(coldRestorePage.data.selections, {})
  assert.strictEqual(coldRestorePage.data.wiringStatus, 'needs-choice')
  assert.deepStrictEqual(coldRestorePage.data.requirements.map((item) => item.id), ['outputMode', 'destinationChannel'])
  assert(coldRestorePage.data.requirements.every((item) => !item.value),
    'cold-return and destination-channel conditions always need fresh choices')

  const readyPreference = {
    version: 1,
    outputId: 'xlrBalanced',
    inputId: 'terminalBalanced',
    manualSelected: { output: true, input: true },
    viewMode: 'connectors',
    face: 'mating',
  }
  const restoredReadyRuntime = createRuntime({ storage: { [storageKey]: readyPreference } })
  const restoredReadyPage = createPage(restoredReadyRuntime)
  assert.strictEqual(restoredReadyRuntime.storageWrites.length, 0, 'restoration itself does not write preferences')
  assert(restoredReadyPage.data.showRestoredHint)
  restoredReadyPage.copyConnection()
  assert.strictEqual(restoredReadyRuntime.clipboard.at(-1),
    `已恢复上次接口，请按本次设备核对；接线条件需重新确认。\n\n${buildWiringText(restoredReadyPage.data.model)}`,
    'restored clipboard text carries the current-equipment notice')
  const restoredReadyReportStart = restoredReadyRuntime.reportTexts.length
  const restoredReadyReport = startReport(restoredReadyPage, restoredReadyRuntime)
  assert(restoredReadyRuntime.reportTexts.slice(restoredReadyReportStart).join('').includes('按本次设备核对'),
    'a restored report reminds users to check the current equipment')
  restoredReadyReport.success({ tempFilePath: '/tmp/restored-ready.png' })

  const invalidRuntime = createRuntime({ storage: { [storageKey]: {
    ...stored, outputId: 'unrecognized-endpoint', manualSelected: { output: 1, input: true },
  } } })
  const invalidPage = createPage(invalidRuntime)
  assert.strictEqual(invalidPage.data.outputId, 'xlrBalanced')
  assert.strictEqual(invalidPage.data.inputId, 'terminalBalanced')
  assert.deepStrictEqual(invalidPage.data.manualSelected, { output: false, input: false })
  assert(invalidPage.data.wiringStorageWarning.includes('无法识别'))
  const badVersionRuntime = createRuntime({ storage: { [storageKey]: { ...stored, version: 99 } } })
  const badVersionPage = createPage(badVersionRuntime)
  assert.strictEqual(badVersionPage.data.outputId, 'xlrBalanced')
  assert(badVersionPage.data.wiringStorageWarning)

  const missingApiRuntime = createRuntime({ storageApiAvailable: false })
  const missingApiPage = createPage(missingApiRuntime)
  assert(missingApiPage.data.wiringStorageWarning.includes('无法记住'))
  choose(missingApiPage, 'output', 'xlrBalanced')
  assert.strictEqual(missingApiPage.data.manualSelected.output, true,
    'missing storage APIs leave the current page interactive')
  assert.strictEqual(missingApiRuntime.storageWrites.length, 0)

  const readFailureRuntime = createRuntime({ failStorageRead: true })
  const readFailurePage = createPage(readFailureRuntime)
  assert(readFailurePage.data.wiringStorageWarning.includes('读取'))
  assert.strictEqual(readFailurePage.data.supported, true)
  const writeFailureRuntime = createRuntime({ failStorageWrite: true })
  const writeFailurePage = createPage(writeFailureRuntime)
  choose(writeFailurePage, 'input', 'terminalBalanced')
  assert.strictEqual(writeFailurePage.data.manualSelected.input, true)
  assert(writeFailurePage.data.wiringStorageWarning.includes('保存失败'))
}

function testEndpointHelpKeepsPageState() {
  const runtime = createRuntime()
  const page = createPage(runtime)
  const report = startReport(page, runtime)
  report.success({ tempFilePath: '/tmp/help-cache.png' })
  page.closeResultReportPreview()
  const screenQueries = runtime.screenQueries
  const screenDraws = runtime.screenDraws
  const savedSelection = { ...page.data.selections }
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'output' } } })
  page.openEndpointHelp()
  assert.strictEqual(page.data.selectorVisible, true)
  assert.strictEqual(page.data.selectorHelpVisible, true)
  assert.strictEqual(runtime.screenQueries, screenQueries, 'help stays inside the existing modal without querying the canvas')
  assert.strictEqual(runtime.screenDraws, screenDraws, 'the covered diagram stays hidden while help is open')
  assert.deepStrictEqual(page.data.selections, savedSelection)
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/help-cache.png')
  page.closeEndpointHelp()
  assert.strictEqual(page.data.selectorHelpVisible, false, 'back returns to interface choices')
  assert.strictEqual(page.data.selectorVisible, true)
  page.closeEndpointSelector()
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/help-cache.png')
  const wxml = fs.readFileSync(require.resolve('../pages/audio-wiring/index.wxml'), 'utf8')
  assert(wxml.includes('当前为默认示例；正式制作前，请核对并选择实际两端接口。'))
  ;['看不懂接口', 'OUT', 'TRS 有 T/R/S', 'TRRS 耳麦', '+、−、G', 'bindtap="openEndpointHelp"',
    'bindtap="closeEndpointHelp"'].forEach((text) => assert(wxml.includes(text), `endpoint help includes ${text}`))
}

function finishReportDraw(runtime) {
  const callback = runtime.reportDrawCallbacks.shift()
  assert.strictEqual(typeof callback, 'function', 'report canvas should queue a draw completion')
  callback()
  const task = runtime.reportExports.at(-1)
  assert(task, 'report export should begin after drawing')
  return task
}

function startReport(page, runtime) {
  const previousCount = runtime.reportExports.length
  page.generateResultReportImage()
  assert.strictEqual(page.data.isGeneratingResultReport, true)
  const task = finishReportDraw(runtime)
  assert.strictEqual(runtime.reportExports.length, previousCount + 1)
  return task
}

function testSupportedOptionsAndCopy(page, runtime) {
  const { OUTPUT_OPTIONS, INPUT_OPTIONS, buildWiringText } = require('../pages/audio-wiring/wiring-model')
  const { getWiringHitAreas } = require('../pages/audio-wiring/wiring-renderer')
  const balanced = ['xlrBalanced', 'trsBalanced', 'terminalBalanced']
  const mono = ['rcaMono', 'tsMono']
  const stereo = ['rcaStereo', 'tsStereo']
  const readyPairs = new Set()
  const choicePairs = new Set()
  balanced.forEach((output) => balanced.forEach((input) => readyPairs.add(`${output}|${input}`)))
  readyPairs.add('stereo35|rcaStereo')
  readyPairs.add('stereo35|tsStereo')
  mono.forEach((output) => mono.forEach((input) => readyPairs.add(`${output}|${input}`)))
  mono.forEach((output) => balanced.forEach((input) => readyPairs.add(`${output}|${input}`)))
  balanced.forEach((output) => {
    mono.concat(stereo).forEach((input) => choicePairs.add(`${output}|${input}`))
  })
  balanced.concat(mono).forEach((input) => choicePairs.add(`stereo35|${input}`))
  mono.forEach((output) => stereo.forEach((input) => choicePairs.add(`${output}|${input}`)))
  assert.strictEqual(readyPairs.size, 21)
  assert.strictEqual(choicePairs.size, 21)
  assert.strictEqual(page.data.outputId, 'xlrBalanced')
  assert.strictEqual(page.data.inputId, 'terminalBalanced')
  assert.strictEqual(page.data.supported, true)
  assert.strictEqual(page.data.outputSignalSummary, '平衡单声道')

  let readyCount = 0
  let needsChoiceCount = 0
  OUTPUT_OPTIONS.forEach((output) => INPUT_OPTIONS.forEach((input) => {
    choose(page, 'output', output.id)
    choose(page, 'input', input.id)
    const pair = `${output.id}|${input.id}`
    const expectedStatus = readyPairs.has(pair) ? 'ready' : choicePairs.has(pair) ? 'needs-choice' : 'unsupported'
    assert.strictEqual(page.data.wiringStatus, expectedStatus, `${output.id} → ${input.id}`)
    assert.strictEqual(page.data.supported, expectedStatus === 'ready', `${output.id} → ${input.id}`)
    if (expectedStatus === 'ready') {
      readyCount += 1
    } else {
      assert.strictEqual(page.data.model.connections.length, 0)
      if (expectedStatus === 'needs-choice') {
        needsChoiceCount += 1
        assert(page.data.requirements.length > 0, `${pair} should expose a choice instead of a dead-end state`)
      }
      const exportsBefore = runtime.reportExports.length
      const copiesBefore = runtime.clipboard.length
      page.copyConnection()
      page.generateResultReportImage()
      assert.strictEqual(runtime.reportExports.length, exportsBefore)
      assert.strictEqual(runtime.clipboard.length, copiesBefore)
    }
  }))
  assert.strictEqual(readyCount, 21)
  assert.strictEqual(needsChoiceCount, 21)

  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'rcaStereo')
  assert.strictEqual(page.data.outputSignalSummary, '立体声非平衡')
  assert.strictEqual(page.data.outputSignalPortLabel, '立体声模拟 L/R')
  assert.strictEqual(page.data.outputSignalTypeLabel, '非平衡')
  assert(!page.data.outputSignalPortLabel.includes('LINE'), '3.5 mm stereo retains its model label without a LINE claim')
  assert(page.data.model.output.signalLabel.includes('L/R'), 'display text must not replace the full model signal label')
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.at(-1), buildWiringText(page.data.model))

  const areas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { viewMode: 'wiring', showTitle: false })
  assert(areas[0].width >= 44)
  const point = { x: areas[0].left + areas[0].width / 2, y: areas[0].top + areas[0].height / 2 }
  page.onDiagramTouchStart({ touches: [{ x: point.x, y: point.y, pageX: point.x + 32, pageY: point.y + 480 }] })
  page.onDiagramTouchEnd({ changedTouches: [{ x: point.x, y: point.y, pageX: point.x + 32, pageY: point.y + 480 }] })
  assert.strictEqual(page.data.selectedConnection.id, areas[0].id)
}

function testWiringRequirements(page, runtime) {
  const { buildWiringText, getWiringModel } = require('../pages/audio-wiring/wiring-model')
  const { getWiringHitAreas } = require('../pages/audio-wiring/wiring-renderer')
  choose(page, 'output', 'xlrBalanced')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert.strictEqual(page.data.supported, false)
  assert.strictEqual(page.data.requirements[0].id, 'outputMode')
  assert.deepStrictEqual(page.data.selections, {})
  assert.strictEqual(page.data.model.connections.length, 0)
  const copiesBefore = runtime.clipboard.length
  const exportsBefore = runtime.reportExports.length
  page.copyConnection()
  page.generateResultReportImage()
  assert.strictEqual(runtime.clipboard.length, copiesBefore, 'unknown wiring choice must not copy a connection')
  assert.strictEqual(runtime.reportExports.length, exportsBefore, 'unknown wiring choice must not export a diagram')

  const legacyColdOpen = getWiringModel('xlrBalanced', 'tsMono', { outputMode: 'coldOpen' })
  assert.strictEqual(legacyColdOpen.status, 'needs-choice', 'legacy coldOpen must remain unresolved')
  assert.strictEqual(legacyColdOpen.supported, false)
  assert.strictEqual(legacyColdOpen.connections.length, 0)
  assert.deepStrictEqual(page.data.requirements[0].options.map((option) => option.id), ['coldReturn'],
    'the selector must no longer offer a cold-open option')
  chooseRequirement(page, 'outputMode', 'coldOpen')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice', 'a stale coldOpen event must not resolve the requirement')
  assert.strictEqual(page.data.supported, false)
  assert.deepStrictEqual(page.data.selections, {})
  assert.strictEqual(page.data.resultReportImagePath, '')
  const copiesAfterLegacyOption = runtime.clipboard.length
  const exportsAfterLegacyOption = runtime.reportExports.length
  page.copyConnection()
  page.generateResultReportImage()
  assert.strictEqual(runtime.clipboard.length, copiesAfterLegacyOption, 'legacy coldOpen cannot be copied')
  assert.strictEqual(runtime.reportExports.length, exportsAfterLegacyOption, 'legacy coldOpen cannot be exported')

  chooseRequirement(page, 'outputMode', 'coldReturn')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert.strictEqual(page.data.supported, true)
  assert.strictEqual(page.data.selections.outputMode, 'coldReturn')
  const { getReportHeight } = require('../pages/audio-wiring/wiring-renderer')
  assert.strictEqual(page.data.resultReportCanvasHeight, getReportHeight(720, page.data.model, {
    viewMode: page.data.viewMode,
    face: page.data.face,
    selectedId: '',
    theme: page.data.theme,
    preferenceNotice: '',
  }), 'requirement selection sizes the report with the same current view options')
  assert.strictEqual(page.data.model.connections.length, 3, 'coldReturn must contain signal, cold-return, and shield lines')
  assert(page.data.selectionSummary.length > 0)
  assert(page.data.criticalNotes.length > 0)
  const coldReturnText = buildWiringText(page.data.model)
  const copiedWireLines = coldReturnText.split('\n').filter((line) => line.startsWith('- '))
  assert.strictEqual(copiedWireLines.length, 3, 'coldReturn copy must list all three wire connections')
  page.data.model.connections.forEach((connection) => {
    assert(coldReturnText.includes(`- ${connection.fromLabel} → ${connection.toLabel}：${connection.label}`))
  })
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.at(-1), coldReturnText)

  const writesBeforeWithdrawal = runtime.storageWrites.length
  page.clearWiringRequirement({ currentTarget: { dataset: { requirementId: 'outputMode' } } })
  assert.strictEqual(page.data.wiringStatus, 'needs-choice', 'withdrawing manual confirmation restores needs-choice')
  assert.deepStrictEqual(page.data.selections, {})
  assert.strictEqual(page.data.supported, false)
  assert.strictEqual(page.data.resultReportImagePath, '')
  const copiesBeforeWithdrawal = runtime.clipboard.length
  const exportsBeforeWithdrawal = runtime.reportExports.length
  page.copyConnection()
  page.generateResultReportImage()
  assert.strictEqual(runtime.clipboard.length, copiesBeforeWithdrawal, 'withdrawn cold-return confirmation cannot be copied')
  assert.strictEqual(runtime.reportExports.length, exportsBeforeWithdrawal, 'withdrawn cold-return confirmation cannot be exported')
  assert.strictEqual(runtime.storageWrites.length, writesBeforeWithdrawal, 'manual wiring conditions are not persisted')
  chooseRequirement(page, 'outputMode', 'coldReturn')
  assert.strictEqual(page.data.wiringStatus, 'ready', 'explicit manual confirmation restores the original supported path')

  const reportTextStart = runtime.reportTexts.length
  const coldReturnExport = startReport(page, runtime)
  const coldReturnReportText = runtime.reportTexts.slice(reportTextStart).join('')
  const relationStart = runtime.reportTexts.indexOf('对应关系', reportTextStart)
  const relationEnd = runtime.reportTexts.indexOf('适用说明', relationStart + 1)
  assert(relationStart >= reportTextStart && relationEnd > relationStart, 'coldReturn export must include its pin mapping section')
  const exportedRelations = runtime.reportTexts.slice(relationStart + 1, relationEnd).join('')
  page.data.model.connections.forEach((connection) => {
    assert(exportedRelations.includes(connection.fromLabel), `export includes source pin ${connection.fromLabel}`)
    assert(exportedRelations.includes(connection.toLabel), `export includes target pin ${connection.toLabel}`)
  })
  assert(coldReturnReportText.includes('冷端') && coldReturnReportText.includes('汇接'))
  coldReturnExport.success({ tempFilePath: '/tmp/cold-return.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/cold-return.png')
  page.closeResultReportPreview()

  const areas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { viewMode: 'wiring', showTitle: false })
  const point = { x: areas[0].left + areas[0].width / 2, y: areas[0].top + areas[0].height / 2 }
  page.onDiagramTap({ detail: point })
  assert(page.data.selectedConnection)

  choose(page, 'input', 'rcaStereo')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert.strictEqual(page.data.resultReportImagePath, '', 'changing endpoint must clear the prior coldReturn image')
  chooseRequirement(page, 'outputMode', 'coldReturn')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  chooseRequirement(page, 'destinationChannel', 'left')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  const leftAreas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { viewMode: 'wiring', showTitle: false })
  const leftPoint = { x: leftAreas[0].left + leftAreas[0].width / 2, y: leftAreas[0].top + leftAreas[0].height / 2 }
  page.onDiagramTap({ detail: leftPoint })
  assert(page.data.selectedId, 'the selected left-channel diagram line must set selectedId before changing the requirement')
  assert(page.data.selectedConnection, 'the selected left-channel diagram line must be non-empty before the change')
  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  assert.strictEqual(runtime.pendingScreenQueries.length, 1)
  const staleExport = startReport(page, runtime)
  chooseRequirement(page, 'destinationChannel', 'right')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert.strictEqual(page.data.selections.destinationChannel, 'right')
  assert.strictEqual(page.data.selectedId, '')
  assert.strictEqual(page.data.selectedConnection, null)
  assert.strictEqual(page.data.resultReportImagePath, '')
  const drawsAfterChoice = runtime.screenDraws
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsAfterChoice, 'choice changes must invalidate the previous screen canvas query')
  const mutationsBeforeStaleExport = page.mutationCount
  staleExport.success({ tempFilePath: '/tmp/stale-choice.png' })
  assert.strictEqual(page.data.resultReportImagePath, '')
  assert.strictEqual(page.mutationCount, mutationsBeforeStaleExport, 'choice change must invalidate a pending image callback')

  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert(page.data.requirements.some((item) => item.id === 'sourceChannel'))
  chooseRequirement(page, 'sourceChannel', 'left')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert.strictEqual(page.data.selections.sourceChannel, 'left')

  choose(page, 'output', 'rcaMono')
  choose(page, 'input', 'tsStereo')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert(page.data.requirements.some((item) => item.id === 'destinationChannel'))
  chooseRequirement(page, 'destinationChannel', 'both')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  choose(page, 'input', 'terminalBalanced')
  assert.deepStrictEqual(page.data.selections, {}, 'changing an endpoint must clear every prior wiring choice')

  const wxml = fs.readFileSync(require.resolve('../pages/audio-wiring/index.wxml'), 'utf8')
  assert(wxml.includes('bindtap="selectWiringRequirement"'))
  assert(wxml.includes('{{criticalNotes}}'))
  assert(wxml.includes('要保留左右两路内容'))
  assert(wxml.includes("wiringStatus === 'needs-choice'"), 'needs-choice must have a separate state from unsupported')
}

function testScreenCanvasApiAndResize(page, runtime) {
  assert(runtime.screenDraws > 0, 'the 2D screen renderer should draw the initial diagram')
  assert.strictEqual(runtime.reportContextIds.length, 0)
  assert.deepStrictEqual(runtime.transforms.at(-1), [2, 0, 0, 2, 0, 0])
  assert.strictEqual(runtime.screenCanvasNode.width, Math.round(page.data.diagramCanvasWidth * 2))
  assert.strictEqual(runtime.screenCanvasNode.height, Math.round(page.data.diagramCanvasHeight * 2))
  assert.strictEqual(runtime.scaleCalls, 0, 'DPR transform must not accumulate with scale()')
  assert(runtime.screenTexts.some((item) => /(?:500|600) /.test(item.font)), 'renderer font assignment must reach the native context')
  assert(!runtime.reportContextIds.includes('wiringDiagramCanvas'))

  const mutationsBeforeStableRedraw = page.mutationCount
  page.renderDiagram()
  assert.strictEqual(page.mutationCount, mutationsBeforeStableRedraw, 'a successful stable redraw must not write unchanged diagramError')

  runtime.measuredWidth = 287
  const mutationsBeforeResize = page.mutationCount
  page.onResize()
  assert.strictEqual(page.mutationCount, mutationsBeforeResize + 1, 'a size-changing resize should write the new measured canvas dimensions once')
  assert.strictEqual(page.data.diagramCanvasWidth, 287)
  assert.strictEqual(runtime.screenCanvasNode.width, 574)
  assert(runtime.transforms.every((value) => value[0] === 2 && value[3] === 2))
}

function testCanvasRemountAndModalRecovery(page, runtime) {
  const firstNodeId = runtime.screenCanvasNode.id
  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'terminalBalanced')
  assert.strictEqual(page.data.supported, false)
  choose(page, 'output', 'xlrBalanced')
  assert.strictEqual(page.data.supported, true)
  assert(runtime.screenCanvasNode.id > firstNodeId, 'supported canvas should be queried again after unsupported state remounts it')

  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  assert.strictEqual(runtime.pendingScreenQueries.length, 1)
  const queriesBeforeSheet = runtime.screenQueries
  const drawsBeforeSheet = runtime.screenDraws
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'output' } } })
  assert.strictEqual(page.data.selectorVisible, true)
  page.renderDiagram()
  assert.strictEqual(runtime.screenQueries, queriesBeforeSheet, 'render requests must not query while selector sheet is open')
  assert.strictEqual(runtime.screenDraws, drawsBeforeSheet, 'screen canvas must not draw while selector sheet is open')
  page.closeEndpointSelector()
  assert.strictEqual(page.data.selectorVisible, false)
  assert(runtime.screenQueries > queriesBeforeSheet, 'closing selector must requery and redraw the canvas')
  assert(runtime.screenDraws > drawsBeforeSheet)
  const drawsAfterClose = runtime.screenDraws
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsAfterClose, 'query started before opening selector must not draw after it closes')
  const wxml = fs.readFileSync(require.resolve('../pages/audio-wiring/index.wxml'), 'utf8')
  assert(wxml.includes('<canvas type="2d" id="wiringDiagramCanvas"'))
  assert(wxml.includes('hidden="{{selectorVisible || resultReportPreviewVisible || diagramError}}"'))
  assert(wxml.includes('style="height:{{diagramCanvasHeight}}px;"'))
}

function testStaleQueriesAndVisibility() {
  const runtime = createRuntime()
  require('../pages/audio-wiring/index')
  const page = createPage(runtime)
  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  assert.strictEqual(runtime.pendingScreenQueries.length, 1)
  const drawsBeforeHide = runtime.screenDraws
  page.onHide()
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsBeforeHide, 'late query after hide must not draw')
  page.onShow()
  assert(runtime.screenDraws > drawsBeforeHide, 'onShow must requery and redraw')

  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  const drawsBeforeSwitch = runtime.screenDraws
  page.selectViewMode({ currentTarget: { dataset: { mode: 'connectors' } } })
  const drawsAfterLatest = runtime.screenDraws
  assert(drawsAfterLatest > drawsBeforeSwitch, 'latest view query should draw')
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsAfterLatest, 'late query after a fast view switch must be ignored')

  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  const drawsBeforeUnload = runtime.screenDraws
  page.onUnload()
  const mutationsBeforeLate = page.mutationCount
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsBeforeUnload)
  assert.strictEqual(page.mutationCount, mutationsBeforeLate, 'late query after unload must not write page state')
}

function testDrawingFailureRecovery(page, runtime) {
  runtime.throwNextScreenContext = true
  page.renderDiagram()
  assert.strictEqual(page.data.diagramError, '接线图暂时无法显示')
  const queriesBeforeRetry = runtime.screenQueries
  page.retryDiagram()
  assert.strictEqual(page.data.diagramError, '')
  assert(runtime.screenQueries > queriesBeforeRetry, 'retry must reacquire the 2D canvas node')
}

function testExportLifecycle(page, runtime) {
  const success = startReport(page, runtime)
  const pendingExportCount = runtime.reportExports.length
  page.generateResultReportImage()
  assert.strictEqual(runtime.reportExports.length, pendingExportCount)
  success.success({ tempFilePath: '/tmp/wiring-success.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/wiring-success.png')
  assert.strictEqual(page.data.resultReportPreviewVisible, true)
  const queriesDuringPreview = runtime.screenQueries
  const drawsDuringPreview = runtime.screenDraws
  page.renderDiagram()
  assert.strictEqual(runtime.screenQueries, queriesDuringPreview, 'render requests must not query while report preview is open')
  assert.strictEqual(runtime.screenDraws, drawsDuringPreview, 'screen canvas must stay hidden while report preview is open')
  const queriesWhilePreviewOpen = runtime.screenQueries
  page.closeResultReportPreview()
  assert(runtime.screenQueries > queriesWhilePreviewOpen, 'closing report preview must restore the 2D screen diagram')
  page.generateResultReportImage()
  assert.strictEqual(page.data.resultReportPreviewVisible, true)
  page.previewResultReportImage()
  page.saveResultReportImage()
  page.shareResultReportImage()
  assert.strictEqual(runtime.previews.at(-1).current, '/tmp/wiring-success.png')
  assert.strictEqual(runtime.saves.at(-1), '/tmp/wiring-success.png')
  assert.strictEqual(runtime.shares.at(-1).path, '/tmp/wiring-success.png')

  page.closeResultReportPreview()
  page.onHide()
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/wiring-success.png', 'successful image should survive hide')
  page.onShow()
  page.generateResultReportImage()
  assert.strictEqual(page.data.resultReportPreviewVisible, true, 'cached image should reopen after returning to the page')
  page.closeResultReportPreview()
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id: 'invalid-option-id' } } })
  assert.strictEqual(page.data.selectorVisible, false, 'invalid selector events should close the sheet')
  assert.strictEqual(page.data.resultReportImagePath, '', 'invalid selector events should invalidate a cached export')

  page.selectViewMode({ currentTarget: { dataset: { mode: 'connectors' } } })
  assert.strictEqual(page.data.resultReportImagePath, '')
  const failed = startReport(page, runtime)
  failed.fail({ errMsg: 'simulated export failure' })
  assert.strictEqual(page.data.isGeneratingResultReport, false)
  assert.strictEqual(page.data.resultReportImagePath, '')
  const retry = startReport(page, runtime)
  retry.success({ tempFilePath: '/tmp/wiring-retry.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/wiring-retry.png')

  page.closeResultReportPreview()
  page.selectConnectorFace({ currentTarget: { dataset: { face: 'solder' } } })
  const oldTask = startReport(page, runtime)
  page.selectConnectorFace({ currentTarget: { dataset: { face: 'mating' } } })
  const currentTask = startReport(page, runtime)
  const beforeOldCallback = page.mutationCount
  oldTask.success({ tempFilePath: '/tmp/stale.png' })
  assert.strictEqual(page.mutationCount, beforeOldCallback)
  currentTask.success({ tempFilePath: '/tmp/current.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/current.png')

  page.closeResultReportPreview()
  page.selectViewMode({ currentTarget: { dataset: { mode: 'wiring' } } })
  const hiddenTask = startReport(page, runtime)
  page.onHide()
  const beforeHiddenCallback = page.mutationCount
  hiddenTask.success({ tempFilePath: '/tmp/hidden-stale.png' })
  assert.strictEqual(page.mutationCount, beforeHiddenCallback)
  page.onShow()
  page.closeResultReportPreview()
  const unloadTask = startReport(page, runtime)
  page.onUnload()
  const beforeUnloadCallback = page.mutationCount
  unloadTask.success({ tempFilePath: '/tmp/unload-stale.png' })
  assert.strictEqual(page.mutationCount, beforeUnloadCallback)
  assert.strictEqual(runtime.removedThemeHandlers.length, 1)
  assert(runtime.reportContextIds.every((id) => id === 'resultReportCanvas'), 'export continues through shared legacy canvas')
}

function testReportUsesCurrentView() {
  const { getReportHeight, getWiringHitAreas } = require('../pages/audio-wiring/wiring-renderer')
  const runtime = createRuntime()
  const page = createPage(runtime)
  page.selectViewMode({ currentTarget: { dataset: { mode: 'connectors' } } })
  page.selectConnectorFace({ currentTarget: { dataset: { face: 'solder' } } })
  const areas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { viewMode: 'connectors', face: 'solder', selectedId: '', showTitle: false })
  assert(areas.length > 0)
  const point = { x: areas[0].left + areas[0].width / 2, y: areas[0].top + areas[0].height / 2 }
  page.onDiagramTap({ detail: point })
  assert.strictEqual(page.data.selectedId, areas[0].id)
  const expectedHeight = getReportHeight(720, page.data.model, {
    viewMode: 'connectors', face: 'solder', selectedId: areas[0].id, theme: 'light',
    preferenceNotice: '默认示例，先核对实际两端接口。',
  })
  assert.strictEqual(page.data.resultReportCanvasHeight, expectedHeight,
    'report height uses the same view, face, highlight, and theme as the current diagram')
  runtime.reportTexts.length = 0
  runtime.reportLineWidths.length = 0
  const task = startReport(page, runtime)
  const exportedText = runtime.reportTexts.join('').replace(/\s/g, '')
  assert(exportedText.includes('接头视角') && exportedText.includes('焊接面'),
    'report names the solder-face connector view captured at click time')
  assert(runtime.reportLineWidths.includes(4), 'report diagram carries the selected connection highlight')
  assert(runtime.reportTexts.some((value) => value.includes('对应关系')))
  task.success({ tempFilePath: '/tmp/current-solder-view.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/current-solder-view.png')
}

function testModalAndLateInteractionCallbacks() {
  const runtime = createRuntime()
  require('../pages/audio-wiring/index')
  const page = createPage(runtime)

  const pendingReport = startReport(page, runtime)
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  assert.strictEqual(page.data.selectorVisible, true)
  assert.strictEqual(page.data.isGeneratingResultReport, false, 'opening selector cancels an in-flight report')
  const mutationsBeforeLateReport = page.mutationCount
  pendingReport.success({ tempFilePath: '/tmp/late-selector-report.png' })
  assert.strictEqual(page.mutationCount, mutationsBeforeLateReport, 'late report callback must not mutate an open selector')
  assert.strictEqual(page.data.resultReportPreviewVisible, false)
  assert.strictEqual(page.data.selectorVisible, true)

  page.closeEndpointSelector()
  const areas = require('../pages/audio-wiring/wiring-renderer').getWiringHitAreas(
    page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight, { viewMode: 'wiring', showTitle: false },
  )
  const point = { x: areas[0].left + areas[0].width / 2, y: areas[0].top + areas[0].height / 2 }
  page.onDiagramTouchStart({ touches: [{ x: point.x, y: point.y }] })
  page.onHide()
  const mutationsBeforeHiddenTouch = page.mutationCount
  page.onDiagramTouchEnd({ changedTouches: [{ x: point.x, y: point.y }] })
  assert.strictEqual(page.mutationCount, mutationsBeforeHiddenTouch, 'late touch end after hide must not mutate page state')

  page.onShow()
  page.onDiagramTouchStart({ touches: [{ x: point.x, y: point.y }] })
  page.onHide()
  page.onShow()
  const mutationsBeforeReshownTouch = page.mutationCount
  page.onDiagramTouchEnd({ changedTouches: [{ x: point.x, y: point.y }] })
  assert.strictEqual(page.mutationCount, mutationsBeforeReshownTouch, 'touch start before hide must be cleared so late touch end after show cannot select a wire')

  const completedReport = startReport(page, runtime)
  completedReport.success({ tempFilePath: '/tmp/cached-selector-report.png' })
  page.closeResultReportPreview()
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/cached-selector-report.png', 'opening selector must preserve completed report cache')
  page.closeEndpointSelector()
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/cached-selector-report.png', 'cancelling selector must preserve completed report cache')
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id: page.data.inputId } } })
  assert.strictEqual(page.data.resultReportImagePath, '',
    'confirming the default endpoint updates report notice and invalidates the old image')
  const partialSelectionReport = startReport(page, runtime)
  partialSelectionReport.success({ tempFilePath: '/tmp/partial-selection.png' })
  page.closeResultReportPreview()
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id: page.data.inputId } } })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/partial-selection.png',
    'reconfirming an already checked endpoint leaves the report cache intact')

  page.onShow()
  runtime.deferClipboardCallback = true
  const toastCount = runtime.toasts.length
  page.copyConnection()
  const clipboard = runtime.pendingClipboardCallbacks.pop()
  page.onUnload()
  clipboard.success()
  assert.strictEqual(runtime.toasts.length, toastCount, 'clipboard callback after unload must not show a toast')
}

function run() {
  require('../pages/audio-wiring/index')
  testWiringPreferencesAndFirstUse()
  testEndpointHelpKeepsPageState()
  const runtime = createRuntime()
  const page = createPage(runtime)
  testScreenCanvasApiAndResize(page, runtime)
  testSupportedOptionsAndCopy(page, runtime)
  testWiringRequirements(page, runtime)
  testCanvasRemountAndModalRecovery(page, runtime)
  testDrawingFailureRecovery(page, runtime)
  testExportLifecycle(page, runtime)
  testReportUsesCurrentView()
  testModalAndLateInteractionCallbacks()
  testStaleQueriesAndVisibility()
  console.log('audio wiring page tests passed (strict 2D canvas/selector query/export mocks; WeChat native layers and album permissions not exercised)')
}

run()

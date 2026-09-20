const assert = require('assert')
const fs = require('fs')

let pageDefinition = null
global.Page = (definition) => { pageDefinition = definition }

function createRuntime() {
  const runtime = {
    toasts: [], clipboard: [], saves: [], shares: [], previews: [], reportExports: [], reportTexts: [],
    reportDrawCallbacks: [], reportContextIds: [], removedThemeHandlers: [], pendingClipboardCallbacks: [],
    screenQueries: 0, screenDraws: 0, screenTexts: [], transforms: [], scaleCalls: 0,
    screenNodeCreations: 0, deferNextScreenQuery: false, pendingScreenQueries: [],
    measuredWidth: 319, throwNextScreenContext: false, page: null, canvasAttached: false,
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
      fill() {}, setStrokeStyle(value) { this.strokeStyle = value }, setLineWidth(value) { this.lineWidth = value },
      stroke() {}, arc() {}, fillRect() {}, save() {}, scale() {}, restore() {},
      draw(reserve, callback) {
        runtime.reportDrawCallbacks.push(callback)
      },
    }
  }

  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }),
    getAppBaseInfo: () => ({ theme: 'light' }),
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
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id: page.data.inputId } } })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/cached-selector-report.png', 'reselecting the same endpoint must preserve completed report cache')

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
  const runtime = createRuntime()
  require('../pages/audio-wiring/index')
  const page = createPage(runtime)
  testScreenCanvasApiAndResize(page, runtime)
  testSupportedOptionsAndCopy(page, runtime)
  testWiringRequirements(page, runtime)
  testCanvasRemountAndModalRecovery(page, runtime)
  testDrawingFailureRecovery(page, runtime)
  testExportLifecycle(page, runtime)
  testModalAndLateInteractionCallbacks()
  testStaleQueriesAndVisibility()
  console.log('audio wiring page tests passed (strict 2D canvas/selector query/export mocks; WeChat native layers and album permissions not exercised)')
}

run()

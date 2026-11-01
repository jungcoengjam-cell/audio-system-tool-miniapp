'use strict'

const assert = require('node:assert/strict')
const { createEnvironment } = require('./p2-safety/harness.cjs')
const { createLayoutExportMethods } = require('../pages/dmx-layout/layout-export-controller')
const layoutRenderer = require('../pages/dmx-layout/layout-renderer')
const layoutModel = require('../pages/dmx-layout/layout-model')
const canvasAdapter = require('../pages/dmx-layout/layout-canvas-adapter')
const { createReportController } = require('../pages/project-wiring/report-controller')
const wiring = require('../utils/project-wiring')

function createRuntime() {
  const env = createEnvironment()
  let theme = 'light'
  let listener = null
  const pendingDraws = []
  const pendingExports = []
  const contexts = []
  const loading = []
  env.wx.getAppBaseInfo = () => ({ theme })
  env.wx.getSystemInfoSync = () => ({ theme, windowWidth: 390, windowHeight: 844, pixelRatio: 2 })
  env.wx.onThemeChange = (callback) => { listener = callback }
  env.wx.offThemeChange = (callback) => { if (listener === callback) listener = null }
  env.wx.showLoading = (options) => loading.push({ type: 'show', options })
  env.wx.hideLoading = () => loading.push({ type: 'hide' })
  env.wx.getFileSystemManager = () => ({
    access: ({ success }) => success && success(),
    accessSync() {},
  })
  env.wx.createCanvasContext = (canvasId) => {
    const context = {
      canvasId,
      fills: [],
      strokes: [],
      font: '12px sans-serif',
      fillStyle: '#000000',
      strokeStyle: '#000000',
      setFillStyle(value) { this.fillStyle = value; this.fills.push(value) },
      setStrokeStyle(value) { this.strokeStyle = value; this.strokes.push(value) },
      setFontSize(size) { this.font = `${size}px sans-serif` },
      measureText(value) { return { width: [...String(value)].length * 8 } },
      draw(reserve, callback) {
        const complete = typeof reserve === 'function' ? reserve : callback
        if (complete) pendingDraws.push(complete)
      },
    }
    const proxy = new Proxy(context, {
      get(target, key) {
        if (key in target) return target[key]
        return () => {}
      },
    })
    contexts.push(proxy)
    return proxy
  }
  env.wx.canvasToTempFilePath = (options) => pendingExports.push(options)

  return {
    env,
    pendingDraws,
    pendingExports,
    contexts,
    loading,
    setTheme(value) { theme = value },
    finishDraw() {
      const callback = pendingDraws.shift()
      assert.equal(typeof callback, 'function', 'report canvas draw is pending')
      callback()
    },
    finishExport(path, error) {
      const options = pendingExports.shift()
      assert(options, 'report image export is pending')
      if (error) options.fail(error)
      else options.success({ tempFilePath: path })
    },
  }
}

function capturePage(runtime, route) {
  if (route === 'pages/limiter/limiter.js') {
    runtime.env.storage.set('audioTool.limiter.preferences', {
      amplifierModel: 'TC-2350B', speakerModel: 'TS-803C', count: 1,
      wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1, highPassFrequency: 80,
    })
  } else if (route === 'pages/gain-structure/gain-structure.js') {
    runtime.env.storage.set('audioTool.gainStructure.preferences', {
      amplifierModel: 'TC-X2200B', stageValue: 1, mode: 'stereo',
      loadImpedance: null, targetPeakDbfs: -6,
    })
  }
  const page = runtime.env.loadPage(route)
  page.onLoad()
  page._pageVisible = true
  page._isUnloaded = false
  page._ledUnloaded = false
  global.getCurrentPages = () => [page]
  return page
}

const resultRecord = (module, title) => ({
  module,
  title,
  summary: 'Theme controller fixture',
  resultText: `${title}\n结果性质：产品参数计算\n测试值：100`,
})

const fixtures = [
  {
    name: 'limiter', route: 'pages/limiter/limiter.js', marker: '_resultReportImageTheme',
    imagePath: 'resultReportImagePath', start: 'generateResultReportImage',
    prepare(page) {
      page.data.shareSheetVisible = true
      page._activePageContainerOverlay = { name: 'share', epoch: 1 }
    },
  },
  {
    name: 'gain', route: 'pages/gain-structure/gain-structure.js', marker: '_resultReportImageTheme',
    imagePath: 'resultReportImagePath', start: 'generateResultReportImage',
    prepare(page) {
      page.data.shareSheetVisible = true
    },
  },
  {
    name: 'LED', route: 'pages/led-screen/led-screen.js', marker: '_reportImageTheme',
    imagePath: 'reportImagePath', start: 'generateReportImage',
    prepare(page) {
      const result = {
        dimensionText: '4.8 × 2.7 m', layoutText: '16:9 · 24 列 × 9 行',
        installedDimensionText: '5.0 × 2.9 m', frameWidthText: '0.1 m',
        horizontalMarginMeters: '0.2', actualTopMarginMeters: '0.2', actualBottomMarginMeters: '0.2',
        unitLabel: 'P2.5 单元', unitSizeText: '600 × 337.5 mm', resolutionText: '1920 × 1080',
        pitchModeLabel: '推荐点间距', pitchText: '2.5 mm', targetAspectRatioKey: '16:9',
        actualRatioText: '16:9', ratioDeviationText: '0.0%', viewingAssessmentText: '观看距离合适',
        comfortableRangeText: '3–12 m', statusKey: 'fit', statusLabel: '适合安装', statusText: '适合安装',
        ratioFallbackText: '', columns: 24, rows: 9, screenWidthMeters: 4.8, screenHeightMeters: 2.7,
      }
      const state = {
        wallWidthText: '5.2', wallHeightText: '3.1', topReserveText: '0.2', bottomReserveText: '0.2',
        viewingDistanceText: '4', result,
      }
      const capture = { id: 'led-fixture' }
      page.flushInputCalculation = () => {}
      page.getOutputState = () => state
      page.captureCurrentOutput = () => capture
      page.isCapturedOutputCurrent = (value) => value === capture
    },
  },
  {
    name: 'cable', route: 'pages/cable/cable.js', marker: '_resultReportImageTheme',
    imagePath: 'resultReportImagePath', start: 'generateResultReportImage',
    prepare(page) {
      page.data.result = {
        type: 'constant', distanceMeters: 100, designPowerW: 110, isWithinStandard: true,
        selectedArea: '1.5', formulaMinimumArea: '0.75', spec: '2 × 1.5 mm²',
        description: '示例规格描述', distanceBracket: '100 m', powerBracket: '100 W',
        currentA: 4, warnings: [], hasFormula: true, status: '适用标准',
      }
      page.data.constantPowerText = '100'
      page.data.environments = [{ label: '室内' }]
      page.data.environmentIndex = 0
      page.flushInputCalculation = () => {}
      page.getRecordPayload = () => resultRecord('cable', '线材测试结果')
      page.getResultReportSignature = () => 'cable-content-v1'
      page.updateResultReportPreviewLayout = () => {}
    },
  },
]

function runResultPageFixture(fixture) {
  const runtime = createRuntime()
  const page = capturePage(runtime, fixture.route)
  fixture.prepare(page)
  const signatureBefore = typeof page.getResultReportSignature === 'function'
    ? page.getResultReportSignature()
    : (typeof page.getRecordPayload === 'function' ? JSON.stringify(page.getRecordPayload()) : '')

  page[fixture.start]()
  assert(runtime.pendingDraws.length, `${fixture.name}: light generation reaches Canvas draw`)
  runtime.finishDraw()
  assert(runtime.pendingExports.length, `${fixture.name}: light draw starts export`)
  const lightContext = runtime.contexts.find((context) => context.canvasId && context.fills.length)
  runtime.finishExport(`wxfile://${fixture.name}-light.png`)
  assert.equal(page.data[fixture.imagePath], `wxfile://${fixture.name}-light.png`)
  assert.equal(page[fixture.marker], 'light', `${fixture.name}: cache records its render-time theme`)
  assert(lightContext && lightContext.fills.length, `${fixture.name}: light image contains painted colors`)

  const contextCountAfterLight = runtime.contexts.length
  page[fixture.start]()
  assert.equal(runtime.contexts.length, contextCountAfterLight,
    `${fixture.name}: same-theme image is reused without a new Canvas context`)

  runtime.setTheme('dark')
  page[fixture.start]()
  assert(runtime.pendingDraws.length, `${fixture.name}: dark theme mismatch starts a redraw`)
  runtime.finishDraw()
  assert(runtime.pendingExports.length)
  const darkContext = runtime.contexts.at(-1)
  runtime.finishExport(`wxfile://${fixture.name}-dark.png`)
  assert.equal(page.data[fixture.imagePath], `wxfile://${fixture.name}-dark.png`)
  assert.equal(page[fixture.marker], 'dark')
  assert.notDeepEqual(darkContext.fills, lightContext.fills,
    `${fixture.name}: dark export must actually use different colors`)
  if (signatureBefore && typeof page.getResultReportSignature === 'function') {
    assert.equal(page.getResultReportSignature(), signatureBefore,
      `${fixture.name}: theme does not change content signature`)
  }

  const retainedPath = page.data[fixture.imagePath]
  runtime.setTheme('light')
  page[fixture.start]()
  assert(runtime.pendingDraws.length, `${fixture.name}: stale-callback fixture starts a light generation`)
  runtime.finishDraw()
  assert(runtime.pendingExports.length)
  runtime.setTheme('dark')
  runtime.finishExport(`wxfile://${fixture.name}-stale-light.png`)
  assert.notEqual(page.data[fixture.imagePath], `wxfile://${fixture.name}-stale-light.png`,
    `${fixture.name}: export callback from the old theme cannot publish`)
  assert.equal(page.data.isGeneratingResultReport || page.data.isGeneratingReport || false, false,
    `${fixture.name}: cancellation must settle loading state`)
  if (page.data[fixture.imagePath]) {
    assert.equal(page.data[fixture.imagePath], retainedPath,
      `${fixture.name}: cancellation preserves only the prior complete image`)
  }
  page.onUnload?.()
  return { name: fixture.name, cacheHit: true, themeRedraw: true, staleExportRejected: true }
}

function createDmxContext() {
  const calls = []
  const state = { font: '16px sans-serif' }
  const context = new Proxy({
    calls,
    setTransform(...args) { calls.push(['setTransform', ...args]) },
    measureText(value) {
      const size = Number(/([\d.]+)px/.exec(state.font)?.[1] || 16)
      return { width: layoutRenderer.estimateExportTextWidth(String(value), size) }
    },
  }, {
    get(target, key) {
      if (key in target) return target[key]
      return (...args) => calls.push([String(key), ...args])
    },
    set(_target, key, value) {
      state[key] = value
      calls.push([`set:${String(key)}`, value])
      return true
    },
  })
  return { context, calls }
}

function runDmxLayoutFixture(runtime) {
  const draws = []
  const { context, calls } = createDmxContext()
  const node = { width: 0, height: 0, getContext: () => context }
  runtime.env.wx.createSelectorQuery = () => {
    let fieldsCallback = null
    const query = {
      in() { return this },
      select() { return { fields(_options, callback) { fieldsCallback = callback; return query } } },
      exec(callback) { fieldsCallback?.({ node, width: 1120, height: 1160 }); callback?.() },
    }
    return query
  }
  const deps = {
    CANVAS_THEMES: layoutRenderer.CANVAS_THEMES,
    EXPORT_CANVAS_ID: 'dmxLayoutExportCanvas', EXPORT_WIDTH: 1120, EXPORT_HEIGHT: 1160,
    buildLightingExportPages: layoutRenderer.buildLightingExportPages,
    calculateScheme() {}, clone: (value) => JSON.parse(JSON.stringify(value)),
    configureCanvas2DNode: canvasAdapter.configureCanvas2DNode,
    createCanvas2DAdapter: canvasAdapter.createCanvas2DAdapter,
    createDefaultStageLayout: layoutModel.createDefaultStageLayout,
    createStageGeometry: layoutModel.createStageGeometry,
    layoutFingerprint() { return '' }, makeId() { return 'fixture' }, migrateLegacyLayout() {},
    readLightingWorkspace() { return { ok: false } }, schemeFingerprint() { return '' },
    renderLightingExportPage(...args) {
      draws.push(args[3])
      return layoutRenderer.renderLightingExportPage(...args)
    },
    saveGeneratedImage() {}, shareGeneratedImage() {}, vibrate() {}, wx: runtime.env.wx,
    Date, setTimeout, clearTimeout, getTheme: () => runtime.env.wx.getAppBaseInfo().theme,
  }
  const methods = createLayoutExportMethods(deps)
  const page = {
    ...methods,
    data: { isGeneratingImage: false, previewVisible: false, previewClosing: false,
      layoutImagePath: '', layoutImagePaths: [], exportCanvasActive: false },
    _alive: true, _visible: true, _layout: layoutModel.createDefaultStageLayout('12', '8', () => 'rod-1'),
    _layoutDirty: false, _generationToken: 0, _visibilityToken: 1,
    setData(patch, callback) { Object.assign(this.data, patch); callback?.() },
    buildExportSnapshot(theme) {
      return { layout: this._layout, fixtures: [], contextLabel: '主题回归', theme: layoutRenderer.CANVAS_THEMES[theme] }
    },
    cancelSheetClose() {}, suspendStageCanvas() {}, restoreStageCanvas() {},
  }
  global.getCurrentPages = () => [page]
  const finish = (path) => {
    const options = runtime.pendingExports.shift()
    assert(options, 'DMX layout image export is pending')
    options.success({ tempFilePath: path })
  }
  const start = () => {
    const before = calls.length
    page.generateLayoutImage()
    assert(calls.length > before, 'DMX layout invokes the shared lighting renderer')
    assert(runtime.pendingExports.length, 'DMX layout starts a canvas export')
  }

  runtime.setTheme('light')
  start()
  assert.equal(draws.at(-1), 'light', 'DMX light export forwards light to the renderer')
  finish('wxfile://dmx-light.png')
  assert.equal(page.data.layoutImagePath, 'wxfile://dmx-light.png')
  assert.equal(page._layoutImageTheme, 'light')

  const lightDraws = draws.length
  start()
  assert.equal(draws.length, lightDraws + 1,
    'DMX layout retains its existing always-export behavior for same-theme requests')
  assert.equal(draws.at(-1), 'light')
  finish('wxfile://dmx-light-again.png')

  runtime.setTheme('dark')
  start()
  assert.equal(draws.at(-1), 'dark', 'DMX dark export forwards dark to the renderer')
  finish('wxfile://dmx-dark.png')
  assert.equal(page.data.layoutImagePath, 'wxfile://dmx-dark.png')
  assert.equal(page._layoutImageTheme, 'dark')
  assert(calls.some((call) => call[0] === 'set:fillStyle' && call[1] === layoutRenderer.CANVAS_THEMES.dark.background),
    'DMX dark export reaches the renderer with the dark palette')

  runtime.setTheme('light')
  start()
  runtime.setTheme('dark')
  finish('wxfile://dmx-stale-light.png')
  assert.notEqual(page.data.layoutImagePath, 'wxfile://dmx-stale-light.png',
    'DMX export from an obsolete theme cannot publish')
  assert.equal(page.data.isGeneratingImage, false, 'DMX theme cancellation settles generation state')
  assert.equal(page._layoutImageTheme, 'dark')
  assert(runtime.loading.some((entry) => entry.type === 'hide'), 'DMX theme cancellation closes loading')
  return { name: 'DMX layout', sameThemeCache: 'not applicable; controller always exports',
    themeForwarding: draws.slice(0, 4), staleExportRejected: true }
}

function createProjectSchedule() {
  let schedule = wiring.emptySchedule()
  const added = wiring.applyScheduleChange(schedule, {
    type: 'add-devices', devices: [
      { type: 'mixer', name: 'Console Theme', autoName: false },
      { type: 'speaker', name: 'Speaker Theme', autoName: false },
    ],
  })
  assert.equal(added.ok, true, added.error)
  schedule = added.schedule
  const [consoleId, speakerId] = added.deviceIds
  const updated = wiring.applyScheduleChange(schedule, {
    type: 'upsert', line: {
      purpose: '主题回归线路', fromDevice: 'Console Theme', fromDeviceId: consoleId, fromPort: 'OUT-1',
      toDevice: 'Speaker Theme', toDeviceId: speakerId, toPort: 'IN-1', buildType: 'bulk',
      cableType: 'balanced', spec: '2-core shielded', connectorA: 'xlrFemale', connectorB: 'xlrMale',
      lengthText: '4', status: 'pending', notes: '',
    },
  })
  assert.equal(updated.ok, true, updated.error)
  return updated.schedule
}

function runProjectWiringFixture(runtime) {
  global.wx = runtime.env.wx
  const report = require('../pages/project-wiring/report')
  const originalBuilder = report.buildScheduleReportPages
  const originalDraw = report.drawScheduleReport
  const contentMarkers = []
  report.buildScheduleReportPages = (name, schedule, type) => {
    contentMarkers.push([name, schedule.revision, type])
    return originalBuilder(name, schedule, type)
  }
  try {
    const draws = []
    report.drawScheduleReport = (context, page, options) => {
      draws.push(options.theme)
      return originalDraw(context, page, options)
    }
    const exportTypes = ['project', 'lines', 'materials', 'labels'].map((id) => ({ id }))
    const controller = createReportController({ exportTypes,
      safeToast() {}, vibrate() {}, shareGeneratedImage() {} })
    const page = {
      ...controller,
      projectId: 'project-theme-fixture',
      _schedule: createProjectSchedule(),
      data: { project: { name: '主题测试项目' }, exportTypeIndex: 0, loading: false, saving: false,
        editorVisible: false, batchVisible: false, reportImages: [], reportImagePath: '',
        reportPreviewVisible: false, reportCanvasWidth: 0, reportCanvasHeight: 0,
        reportSaveRunning: false, reportSaveInFlight: false },
      _destroyed: false, _hidden: false, _reportRevision: 0,
      setData(patch, callback) { Object.assign(this.data, patch); callback?.() },
      syncReportSaveView() {},
      showReportPage(index) {
        this.data.reportPageIndex = index
        this.data.reportImagePath = this.data.reportImages[index]?.path || ''
        this.data.reportPreviewVisible = Boolean(this.data.reportImagePath)
      },
    }
    page._schedule.revision = 7
    global.getCurrentPages = () => [page]
    const complete = (path) => {
      const options = runtime.pendingExports.shift()
      assert(options, 'project wiring image export is pending')
      options.success({ tempFilePath: path })
    }
    const start = (type = 'project') => {
      const contextCount = runtime.contexts.length
      page.generateExport(type)
      assert(runtime.pendingDraws.length, 'project wiring report draw is pending')
      assert(runtime.contexts.length > contextCount, 'project wiring creates the share canvas')
      runtime.finishDraw()
      assert(runtime.pendingExports.length, 'project wiring starts PNG export after drawing')
    }

    runtime.setTheme('light')
    start()
    assert.equal(draws.at(-1), 'light', 'project wiring light theme reaches its renderer')
    complete('wxfile://wiring-light.png')
    assert.equal(page.data.reportImagePath, 'wxfile://wiring-light.png')
    assert.equal(page._reportImageTheme, 'light')
    const signature = page._reportSignature
    assert.equal(signature, 'project-theme-fixture:7:project')
    const exportCount = runtime.contexts.length
    page.data.reportPreviewVisible = false
    page.generateExport('project')
    assert.equal(runtime.contexts.length, exportCount,
      'project wiring reuses a completed image for the same content and theme')
    assert.equal(page._reportSignature, signature)

    page.data.reportPreviewVisible = false
    start('lines')
    assert.equal(draws.at(-1), 'light', 'line list report receives the light theme')
    complete('wxfile://wiring-lines-light.png')
    const lightLineFills = runtime.contexts.at(-1).fills.slice()

    page.data.reportPreviewVisible = false
    runtime.setTheme('dark')
    start()
    assert.equal(draws.at(-1), 'dark', 'project wiring dark theme reaches its renderer')
    complete('wxfile://wiring-dark.png')
    assert.equal(page.data.reportImagePath, 'wxfile://wiring-dark.png')
    assert.equal(page._reportImageTheme, 'dark')
    const darkFills = runtime.contexts.at(-1).fills
    assert(darkFills.includes('#000000'), 'project wiring project report uses its dark background')
    assert.equal(page._reportSignature, signature, 'theme is not added to project content signature')

    page.data.reportPreviewVisible = false
    runtime.setTheme('dark')
    start('lines')
    assert.equal(draws.at(-1), 'dark', 'line list report receives the dark theme')
    complete('wxfile://wiring-lines-dark.png')
    const darkLineFills = runtime.contexts.at(-1).fills
    assert.notDeepEqual(darkLineFills, lightLineFills,
      'non-project line report uses its dark palette while keeping the same schedule input')
    assert.equal(page._reportSignature, 'project-theme-fixture:7:lines')

    for (const type of ['materials', 'labels']) {
      page.data.reportPreviewVisible = false
      start(type)
      assert.equal(draws.at(-1), 'dark', `${type} report receives the dark theme`)
      complete(`wxfile://wiring-${type}-dark.png`)
      assert.equal(page._reportSignature, `project-theme-fixture:7:${type}`)
      assert.equal(page._reportImageTheme, 'dark')
    }

    const projectPage = originalBuilder('主题测试项目', page._schedule, 'project').pages[0]
    const bridgeDefault = runtime.env.wx.createCanvasContext('bridge-default')
    const explicitLight = runtime.env.wx.createCanvasContext('bridge-light')
    originalDraw(bridgeDefault, projectPage)
    originalDraw(explicitLight, projectPage, { theme: 'light' })
    assert.deepEqual(bridgeDefault.fills, explicitLight.fills,
      'project/PDF bridge omission continues to draw exactly like explicit light')
    assert.notEqual(bridgeDefault.fills[0], '#000000', 'project/PDF bridge default keeps the light background')

    page.data.reportPreviewVisible = false
    runtime.setTheme('light')
    const beforeStaleSignature = page._reportSignature
    start('labels')
    runtime.setTheme('dark')
    complete('wxfile://wiring-stale-light.png')
    assert.notEqual(page.data.reportImagePath, 'wxfile://wiring-stale-light.png',
      'project wiring export from an obsolete theme cannot publish')
    assert.equal(page.data.reportImages.length, 0, 'theme change cancellation does not publish partial pages')
    assert.notEqual(page._reportSignature, beforeStaleSignature,
      'starting a theme-mismatched project report invalidates the prior PNG cache')
    assert.equal(page._reportPending, false, 'project wiring cancellation settles pending state')
    assert(runtime.loading.some((entry) => entry.type === 'hide'), 'project wiring cancellation closes loading')
    return { name: 'project wiring', sameThemeCache: true, reportTypes: ['project', 'lines', 'materials', 'labels'],
      themeRedraw: true, projectPdfDefaultLight: true, staleExportRejected: true,
      themes: draws.slice(), reportCalls: contentMarkers.length }
  } finally {
    report.buildScheduleReportPages = originalBuilder
    report.drawScheduleReport = originalDraw
  }
}

const runtime = createRuntime()
const result = fixtures.map(runResultPageFixture)
result.push(runDmxLayoutFixture(runtime))
result.push(runProjectWiringFixture(runtime))
process.stdout.write(`${JSON.stringify({ status: 'passed', result })}\n`)

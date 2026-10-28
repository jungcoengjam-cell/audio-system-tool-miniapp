const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const Module = require('module')
const path = require('path')
const { APP_VERSION, PRODUCT_DATA_DATE } = require('../data/app-meta')

const ROOT = path.resolve(__dirname, '..')
const BASELINE = path.join(ROOT, 'docs/recovery/package-structure-2026-09-30/before')
const storage = new Map()
const isolatedModules = [
  'utils/performance.js',
  'pages/led-screen/report.js',
  'utils/result-report.js',
].map((relativePath) => path.join(ROOT, relativePath))
const originalModuleEntries = new Map(isolatedModules.map((filename) => [filename, require.cache[filename]]))
const originalDateNow = Date.now
const originalWx = global.wx
const originalPage = global.Page
const originalGetCurrentPages = global.getCurrentPages
Date.now = () => 1790750000000

function loadRevision(relativePath, baseline, dependencyOverrides = {}) {
  const filename = path.join(ROOT, relativePath)
  const sourcePath = baseline ? path.join(BASELINE, `${relativePath}.baseline`) : filename
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalLoad = Module._load
  const overrideEntries = new Map(Object.entries(dependencyOverrides))
  if (overrideEntries.size) {
    Module._load = function loadWithDependencyOverrides(request, parent, isMain) {
      const resolved = Module._resolveFilename(request, parent, isMain)
      if (overrideEntries.has(resolved)) return overrideEntries.get(resolved)
      return originalLoad.call(this, request, parent, isMain)
    }
  }
  try {
    loaded._compile(fs.readFileSync(sourcePath, 'utf8'), filename)
  } finally {
    Module._load = originalLoad
  }
  return loaded.exports
}

function installRuntime(trace, queues, fault) {
  global.getCurrentPages = () => queues.page ? [queues.page] : []
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getStorageInfoSync: () => ({ currentSize: 1, limitSize: 10 }),
    setNavigationBarTitle: () => {},
    vibrateShort: (options) => trace.push(['vibrate', options]),
    showLoading: (options) => trace.push(['loading', options]),
    hideLoading: () => trace.push(['hideLoading']),
    showToast: (options) => trace.push(['toast', options]),
    createCanvasContext: (canvasId, page) => {
      if (fault === 'create-throws') throw new Error('create failed')
      trace.push(['createCanvas', canvasId, page === queues.page])
      return new Proxy({}, {
        get: (_, key) => {
          if (key === 'draw') return (reserve, callback) => {
            trace.push(['draw', reserve])
            queues.draws.push(callback)
          }
          if (key === 'measureText') return (text) => {
            const result = { width: String(text).length * 10 }
            trace.push(['canvasCall', key, [text], result])
            return result
          }
          return (...args) => trace.push(['canvasCall', key, args])
        },
        set: (_, key, value) => {
          trace.push(['canvasProperty', key, value])
          return true
        },
      })
    },
    canvasToTempFilePath: (options, page) => {
      if (fault === 'export-throws') throw new Error('export failed synchronously')
      const publicOptions = { ...options }
      delete publicOptions.success
      delete publicOptions.fail
      trace.push(['export', publicOptions, page === queues.page])
      queues.exports.push(options)
    },
  }
  global.Page = (definition) => { queues.page = definition }
}

function recordSetData(page, trace, deferredCallbacks = null) {
  page.setData = (changes, callback) => {
    trace.push(['setData', changes])
    page.data = { ...page.data, ...changes }
    if (callback) {
      if (deferredCallbacks) {
        trace.push(['setDataCallback', 'queued'])
        deferredCallbacks.push(callback)
      } else {
        trace.push(['setDataCallback', 'begin'])
        callback()
        trace.push(['setDataCallback', 'end'])
      }
    }
  }
}

function flushSetDataCallbacks(queues, trace) {
  while (queues.setDataCallbacks.length) {
    const callback = queues.setDataCallbacks.shift()
    trace.push(['setDataCallback', 'begin'])
    callback()
    trace.push(['setDataCallback', 'end'])
  }
}

function setup(kind, baseline, trace, queues, fault) {
  storage.clear()
  installRuntime(trace, queues, fault)
  const perfPath = path.join(ROOT, 'utils/performance.js')
  delete require.cache[perfPath]
  const performance = require(perfPath)
  performance.startMeasurement = (name, details = {}) => {
    trace.push(['measureStart', name, details])
    return (result = {}) => trace.push(['measureFinish', name, result])
  }
  performance.printPerformanceSummary = () => {}

  const drawingPath = kind === 'led' ? 'pages/led-screen/report.js' : 'utils/result-report.js'
  const drawingFile = path.join(ROOT, drawingPath)
  delete require.cache[drawingFile]
  if (fault === 'draw-throws') {
    const drawing = require(drawingFile)
    const method = kind === 'led' ? 'drawLedScreenReport' : 'drawResultReport'
    drawing[method] = () => { throw new Error('draw failed synchronously') }
  }

  if (kind === 'led') {
    loadRevision('pages/led-screen/led-screen.js', baseline)
    // The redesigned LED report sizes its canvas with setData, then draws in
    // that callback. Model WeChat's deferred callback and make the page visible.
    recordSetData(queues.page, trace, queues.setDataCallbacks)
    queues.page.onLoad()
    queues.page.onShow()
    flushSetDataCallbacks(queues, trace)
    return {
      page: queues.page,
      generate: () => queues.page.generateReportImage(),
      invalidate: () => {
        queues.page.reportRevision += 1
        queues.page.reportPendingSignature = 'changed-source'
        queues.page.setData({ isGeneratingReport: false })
      },
    }
  }

  const controller = loadRevision('utils/result-report-controller.js', baseline)
  const page = {
    data: controller.createResultReportData(),
    getRecordPayload: () => ({ module: 'limiter', title: 'R', summary: 'S', resultText: 'R' }),
  }
  recordSetData(page, trace)
  Object.assign(page, controller.createResultReportMethods({ performancePrefix: 'Test', emptyToast: 'No result' }))
  queues.page = page
  return {
    page,
    generate: () => page.generateResultReportImage(),
    invalidate: () => {
      page.resultReportRevision += 1
      page.setData({ isGeneratingResultReport: false })
    },
  }
}

function takeSnapshot(kind, page) {
  const keys = kind === 'result'
    ? ['resultReportRevision', 'resultReportPendingSignature', 'resultReportSignature']
    : ['reportRevision', 'reportPendingSignature', 'reportSignature']
  const data = JSON.parse(JSON.stringify(page.data))
  return {
    data,
    fields: Object.fromEntries(keys.map((key) => [key, page[key] ?? null])),
  }
}

function run(kind, baseline, outcome, fault = '') {
  const trace = []
  const queues = { draws: [], exports: [], setDataCallbacks: [] }
  const owner = setup(kind, baseline, trace, queues, fault)
  trace.length = 0
  let thrown = ''
  const generate = () => {
    owner.generate()
    if (kind === 'led') flushSetDataCallbacks(queues, trace)
  }
  try { generate() } catch (error) { thrown = error.message }
  if (fault === 'create-throws' || fault === 'draw-throws') {
    return { trace: JSON.parse(JSON.stringify(trace)), state: takeSnapshot(kind, owner.page), thrown }
  }
  if (fault === 'export-throws') {
    try { queues.draws.shift()() } catch (error) { thrown = error.message }
    return { trace: JSON.parse(JSON.stringify(trace)), state: takeSnapshot(kind, owner.page), thrown }
  }
  if (outcome.startsWith('interleave-')) {
    const oldDraw = queues.draws.shift()
    if (outcome === 'interleave-draw') {
      owner.invalidate()
      generate()
      oldDraw()
      queues.draws.shift()()
      const newExport = queues.exports.shift()
      newExport.success({ tempFilePath: 'temp://new.png' })
      return { trace: JSON.parse(JSON.stringify(trace)), state: takeSnapshot(kind, owner.page), thrown }
    }
    oldDraw()
    const oldExport = queues.exports.shift()
    owner.invalidate()
    generate()
    if (outcome === 'interleave-success') oldExport.success({ tempFilePath: 'temp://old.png' })
    else oldExport.fail({ errMsg: 'old failed' })
    queues.draws.shift()()
    queues.exports.shift().success({ tempFilePath: 'temp://new.png' })
    return { trace: JSON.parse(JSON.stringify(trace)), state: takeSnapshot(kind, owner.page), thrown }
  }
  if (outcome === 'stale-draw') owner.invalidate()
  assert.equal(queues.draws.length, 1, `${kind}: 应进入 Canvas 绘制`)
  queues.draws.shift()()
  if (outcome === 'stale-draw') return { trace: JSON.parse(JSON.stringify(trace)), state: takeSnapshot(kind, owner.page), thrown }
  assert.equal(queues.exports.length, 1, `${kind}: draw 后应导出`)
  const options = queues.exports.shift()
  if (outcome === 'stale-success' || outcome === 'stale-fail') owner.invalidate()
  if (outcome === 'fail' || outcome === 'stale-fail') options.fail({ errMsg: 'failed' })
  else options.success({ tempFilePath: outcome === 'empty' ? '' : 'temp://report.png' })
  return { trace: JSON.parse(JSON.stringify(trace)), state: takeSnapshot(kind, owner.page), thrown }
}

function assertLedScenarioSemantics(outcome, fault, result) {
  assertLedCurrentSemanticContract(outcome, fault, result)
}

const cases = []
for (const kind of ['led', 'result']) {
  for (const outcome of ['success', 'empty', 'fail', 'stale-draw', 'stale-success', 'stale-fail',
    'interleave-draw', 'interleave-success', 'interleave-fail']) cases.push({ kind, outcome, fault: '' })
  for (const fault of ['create-throws', 'draw-throws', 'export-throws']) cases.push({ kind, outcome: 'success', fault })
}
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const CURRENT_RESULT_REPORT_FOOTER = `版本 ${APP_VERSION} · 产品资料 ${PRODUCT_DATA_DATE}`
const FROZEN_RESULT_REPORT_FOOTER = '版本 5.1.0 · 产品资料 2026-09-01'
function resultTraceWithFrozenFooter(trace, scenario) {
  const expectedDrawCount = scenario.fault === 'create-throws' || scenario.fault === 'draw-throws' ? 0
    : scenario.outcome.startsWith('interleave-') ? 2 : 1
  const drawCount = trace.filter((entry) => entry[0] === 'draw').length
  assert.equal(drawCount, expectedDrawCount,
    `result/${scenario.outcome}/${scenario.fault}: 页面绘制次数偏离生命周期合同`)
  const versionCalls = trace.filter((entry) => entry[0] === 'canvasCall'
    && entry[1] === 'fillText' && typeof entry[2]?.[0] === 'string' && entry[2][0].startsWith('版本 '))
  assert.equal(versionCalls.length, drawCount,
    `result/${scenario.outcome}/${scenario.fault}: 每次绘制都必须保留一个完整版本页脚`)
  assert.deepEqual(versionCalls.map((entry) => entry[2][0]),
    Array.from({ length: drawCount }, () => CURRENT_RESULT_REPORT_FOOTER),
    `result/${scenario.outcome}/${scenario.fault}: 当前版本页脚必须完整且不能被省略`)

  const normalized = trace.map((entry) => {
    if (entry[0] !== 'canvasCall' || entry[1] !== 'fillText'
      || entry[2]?.[0] !== CURRENT_RESULT_REPORT_FOOTER) return entry
    return [entry[0], entry[1], [FROZEN_RESULT_REPORT_FOOTER, ...entry[2].slice(1)], ...entry.slice(3)]
  })
  assert.equal(normalized.filter((entry) => entry[0] === 'canvasCall'
    && entry[1] === 'fillText' && entry[2]?.[0] === FROZEN_RESULT_REPORT_FOOTER).length, drawCount,
  `result/${scenario.outcome}/${scenario.fault}: 历史摘要归一化只能覆盖完整当前页脚`)
  for (let index = 0; index < trace.length; index += 1) {
    const actual = trace[index]
    const comparable = normalized[index]
    if (actual === comparable) continue
    assert.equal(actual[0], 'canvasCall', `result/${scenario.outcome}/${scenario.fault}: 不得改写其他轨迹命令`)
    assert.equal(actual[1], 'fillText', `result/${scenario.outcome}/${scenario.fault}: 不得改写非文字 Canvas 命令`)
    assert.deepEqual(comparable,
      [actual[0], actual[1], [FROZEN_RESULT_REPORT_FOOTER, ...actual[2].slice(1)], ...actual.slice(3)],
      `result/${scenario.outcome}/${scenario.fault}: 归一化只允许替换页脚文本参数`)
  }
  return normalized
}
function resultTraceForFrozenDigest(current, scenario) {
  const shouldVibrate = !scenario.fault && (scenario.outcome === 'success' || scenario.outcome.startsWith('interleave-'))
  const expectedHaptics = shouldVibrate ? [['vibrate', { type: 'medium' }]] : []
  assert.deepEqual(current.trace.filter((entry) => entry[0] === 'vibrate'), expectedHaptics,
    `result/${scenario.outcome}/${scenario.fault}: 仅当前生成成功后 medium 一次，失败或过期回调不得震动`)
  const nonHapticTrace = current.trace.filter((entry) => entry[0] !== 'vibrate')
  return resultTraceWithFrozenFooter(nonHapticTrace, scenario)
}
const sourcePaths = [
  'pages/led-screen/led-screen.js',
  'utils/result-report-controller.js',
]
const getBaselineSourceHashes = () => Object.fromEntries(sourcePaths.map((relativePath) => [
  relativePath,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(BASELINE, `${relativePath}.baseline`))).digest('hex'),
]))
const fixturePath = path.join(__dirname, 'report-canvas-equivalence.fixture.json')
const EXPECTED_CURRENT_LED_RESULT = {
  unitKey: 'module', unitType: 'module', unitLabel: '模组', unitSizeText: '320 × 160 mm',
  columns: 14, rows: 15, totalUnits: 210,
  screenWidthMeters: 4.48, screenHeightMeters: 2.4, dimensionText: '4.48 × 2.4 m',
  frameWidthMeters: 0.05, frameWidthCentimeters: 5, frameWidthText: '5 cm / 边',
  installedWidthMeters: 4.58, installedHeightMeters: 2.5, installedDimensionText: '4.58 × 2.5 m',
  actualRatio: 1.867, targetAspectRatioKey: '16:9', targetAspectRatio: 16 / 9, ratioText: '1.87:1',
  ratioCloseToTarget: false, horizontalMarginMeters: 0.71, horizontalMarginText: '0.71 m / 侧',
  actualTopMarginMeters: 0.25, actualBottomMarginMeters: 0.25, verticalMarginText: '0.25 / 0.25 m',
  estimatedPixelWidth: 2928, estimatedPixelHeight: 1569, resolutionText: '约 2928 × 1569',
  pixelPitch: 1.53, pitchText: 'P1.53', pitchMode: 'recommended', pitchModeLabel: '系统推荐',
  viewingDistanceMeters: 3, minimumDistanceMeters: 1.53, comfortableMinimumMeters: 2.6,
  comfortableMaximumMeters: 4.59, comfortableRangeText: '2.6～4.59 m',
  statusKey: 'fit', statusLabel: '观看距离匹配',
  statusText: '最近观看位置处于该点间距的舒适观看范围。',
  layoutText: '横向模组 14 × 纵向模组 15，总共 210 块',
  ratioFallback: false, ratioDeviationPercent: 5.000000000000007, ratioDeviationText: '5.0%',
  actualRatioText: '1.87:1', ratioSummaryText: '目标 16:9 · 实际 1.87:1（偏差 5.0%）',
  ratioFallbackText: '', viewingAssessmentText: '',
  viewingDetailsText: '最近观看位置处于该点间距的舒适观看范围。',
  integerLayoutNote: '完整单元拼装会产生比例偏差，内容按实际比例适配。',
  diagramHeightRpx: 315, diagramStageStyle: 'padding-top:50.000000%',
  diagramFitStyle: 'width:100.000000%', wallDiagramStyle: 'padding-top:50.000000%',
  diagramLabelsBelow: false, frameStyle: 'left:11.833%;top:8.333%;width:76.333%;height:83.333%',
  screenStyle: 'left:1.092%;top:2.000%;width:97.817%;height:96.000%;background-size:7.143% 6.667%',
}
const EXPECTED_CURRENT_LED_DATA = {
  wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2',
  frameWidthText: '5', viewingDistanceText: '3',
  aspectRatioOptions: [
    { key: '16:9', label: '16:9' }, { key: '4:3', label: '4:3' }, { key: '21:9', label: '21:9' },
    { key: '16:10', label: '16:10' }, { key: '32:9', label: '32:9' },
  ],
  aspectRatioIndex: 0,
  unitOptions: [
    { key: 'module', label: '模组 · 320 × 160 mm' },
    { key: 'cabinetStandard', label: '常规箱体 · 640 × 480 mm' },
    { key: 'cabinetPremiumA', label: '高端 A 系列 · 600 × 337.5 mm' },
  ],
  unitIndex: 0,
  pitchOptions: [
    { value: 'recommended', label: '系统推荐' }, { value: 1.25, label: 'P1.25' },
    { value: 1.53, label: 'P1.53' }, { value: 1.86, label: 'P1.86' }, { value: 2, label: 'P2.0' },
  ],
  pitchIndex: 0,
  result: EXPECTED_CURRENT_LED_RESULT,
  currentFavorite: false, inputError: '', inputSuggestion: '', fieldErrors: {}, inputPending: false,
  reportCanvasWidth: 750, reportCanvasHeight: 1304,
  reportImagePath: '', reportPreviewVisible: false, reportPreviewClosing: false, reportPreviewError: false,
  resetPersistenceError: false, isGeneratingReport: false,
  operationSnapshot: null, operationActive: false, viewingDetailsExpanded: false,
  projectDialogVisible: false, projectDialogClosing: false, projectDialogStep: 'select',
  projectDialogRevision: 0, projectFocusEpisode: 0, projectProjects: [], filteredProjects: [],
  projectSearchText: '', projectNameText: '', projectConfigName: '', projectConfigNote: '',
  projectNameError: '', projectNoteError: '', projectSavedConfigName: '', projectTarget: null,
  projectFrozenTitle: '', projectFrozenSummary: '', projectError: '', projectLoadFailed: false,
  projectSaving: false, projectKeyboardOpen: false, projectKeyboardHeight: 0, projectKeyboardBottom: 0,
  projectFocusedInputId: '', projectViewportHeight: 720, projectSheetMaxHeight: 648,
  projectSaveBlocked: false, editorDirty: false,
}
const EXPECTED_CURRENT_LED_PAYLOAD = {
  input: {
    wallWidthMeters: '6', wallHeightMeters: '3', topReserveMeters: '0.2',
    bottomReserveMeters: '0.2', viewingDistanceMeters: '3',
  },
  result: EXPECTED_CURRENT_LED_RESULT,
}
const EXPECTED_CURRENT_LED_LAYOUT = {
  sections: [
    { type: 'title', y: 42, lines: ['LED 大屏尺寸方案'], lineHeight: 40 },
    {
      type: 'hero', y: 104, height: 250,
      primaryLines: ['4.48 × 2.4 m'],
      layoutLines: ['横向模组 14 × 纵向模组 15，总共 210 块'],
      outerLines: ['安装外尺寸（含包边）  4.58 × 2.5 m'],
    },
    {
      type: 'diagram', y: 372, height: 502,
      titleLines: ['墙面安装示意'], titleHeight: 34, wallLabelTop: 72,
      wallLabelLines: ['墙体 6 × 3 m'], diagramWall: { width: 544, height: 272 },
      diagramHeight: 272, outerTop: 393,
      outerFrameLines: ['包边外框 4.58 × 2.5 m · 单边包边 5 cm / 边'],
      clearanceTop: 428,
      clearanceLines: ['左右实际余量  0.71 m / 0.71 m', '上 / 下实际余量  0.25 m / 0.25 m'],
    },
    {
      type: 'specs', y: 892, height: 370, titleLines: ['方案参数'], titleHeight: 40,
      cells: [
        { label: '拼装规格', value: '模组 · 320×160 mm', x: 72, y: 960, width: 296,
          labelLines: ['拼装规格'], valueLines: ['模组 · 320×160 mm'], valueFontSize: 21, valueLineHeight: 27, height: 82 },
        { label: '估算分辨率', value: '约 2928 × 1569', x: 382, y: 960, width: 296,
          labelLines: ['估算分辨率'], valueLines: ['约 2928 × 1569'], valueFontSize: 21, valueLineHeight: 27, height: 82 },
        { label: '点间距', value: '系统推荐 P1.53', x: 72, y: 1056, width: 296,
          labelLines: ['点间距'], valueLines: ['系统推荐 P1.53'], valueFontSize: 21, valueLineHeight: 27, height: 82 },
        { label: '目标 / 实际比例（偏差）', value: '16:9 / 1.87:1（5.0%）', x: 382, y: 1056, width: 296,
          labelLines: ['目标 / 实际比例（偏差）'], valueLines: ['16:9 / 1.87:1（5.0%）'], valueFontSize: 21, valueLineHeight: 27, height: 82 },
        { label: '最近观看距离', value: '3 m', x: 72, y: 1152, width: 296,
          labelLines: ['最近观看距离'], valueLines: ['3 m'], valueFontSize: 21, valueLineHeight: 27, height: 82 },
        { label: '舒适观看距离', value: '2.6～4.59 m', x: 382, y: 1152, width: 296,
          labelLines: ['舒适观看距离'], valueLines: ['2.6～4.59 m'], valueFontSize: 21, valueLineHeight: 27, height: 82 },
      ],
    },
  ],
  height: 1304,
}
const EXPECTED_CURRENT_LED_TEXT = [
  ['LED 大屏尺寸方案', 44, 73], ['净屏尺寸', 375, 138], ['4.48 × 2.4 m', 375, 196],
  ['横向模组 14 × 纵向模组 15，总共 210 块', 375, 282],
  ['安装外尺寸（含包边）  4.58 × 2.5 m', 375, 332], ['墙面安装示意', 72, 426],
  ['净屏 4.48 × 2.4 m', 375, 614.5], ['墙体 6 × 3 m', 375, 462],
  ['包边外框 4.58 × 2.5 m · 单边包边 5 cm / 边', 375, 782],
  ['左右实际余量  0.71 m / 0.71 m', 72, 818], ['上 / 下实际余量  0.25 m / 0.25 m', 72, 841],
  ['方案参数', 72, 943], ['拼装规格', 88, 982], ['模组 · 320×160 mm', 88, 1013],
  ['估算分辨率', 398, 982], ['约 2928 × 1569', 398, 1013],
  ['点间距', 88, 1078], ['系统推荐 P1.53', 88, 1109],
  ['目标 / 实际比例（偏差）', 398, 1078], ['16:9 / 1.87:1（5.0%）', 398, 1109],
  ['最近观看距离', 88, 1174], ['3 m', 88, 1205],
  ['舒适观看距离', 398, 1174], ['2.6～4.59 m', 398, 1205],
]
const LED_EXPECTED_FONT_STACK = '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
function expectedLedTextStyle(size, weight, fillStyle, textAlign = 'left') {
  return {
    fillStyle,
    font: `${weight} ${size}px ${LED_EXPECTED_FONT_STACK}`,
    fontSize: size,
    textAlign,
  }
}
const EXPECTED_CURRENT_LED_TEXT_STYLES = [
  expectedLedTextStyle(32, 700, '#1d1d1f'),
  expectedLedTextStyle(21, 650, '#087f70', 'center'),
  expectedLedTextStyle(58, 700, '#1d1d1f', 'center'),
  expectedLedTextStyle(22, 500, '#5f6869', 'center'),
  expectedLedTextStyle(23, 650, '#087f70', 'center'),
  expectedLedTextStyle(27, 650, '#1d1d1f'),
  expectedLedTextStyle(15, 600, '#ffffff', 'center'),
  expectedLedTextStyle(18, 500, '#5f6869', 'center'),
  expectedLedTextStyle(18, 400, '#778181', 'center'),
  expectedLedTextStyle(18, 500, '#5f6869'),
  expectedLedTextStyle(18, 500, '#5f6869'),
  expectedLedTextStyle(26, 650, '#1d1d1f'),
  ...Array.from({ length: 6 }, () => [
    expectedLedTextStyle(18, 600, '#778181'),
    expectedLedTextStyle(21, 650, '#1d1d1f'),
  ]).flat(),
]
const EXPECTED_CURRENT_LED_FILL_RECT_STYLES = ['#f5f7f6', '#f5f7fa', '#c7c7cc', '#4f46e5']
const EXPECTED_CURRENT_LED_FILL_STYLES = [
  '#eaf7f5', '#ffffff', 'rgba(19,22,58,.76)', '#ffffff',
  '#eef6ff', '#eef6ff', '#eef6ff', '#eef6ff', '#eef6ff', '#eef6ff',
]
const EXPECTED_CURRENT_LED_STROKE_RECT_STYLES = [
  { strokeStyle: '#93a0ad', lineWidth: 2 },
  { strokeStyle: '#8e8e93', lineWidth: 1 },
]
const EXPECTED_CURRENT_LED_GRID_STROKE_STYLE = { strokeStyle: 'rgba(255,255,255,.3)', lineWidth: 1 }
const LED_LIFECYCLE_EXPECTATIONS = {
  'success|': {
    revision: 1, pending: '', signature: '6|3|0.2|0.2|5|3|16:9|module|1.53|14|15',
    path: 'temp://report.png', preview: true, height: 1304, thrown: '', draws: 1,
    measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 2,
    eventCounts: { createCanvas: 2, vibrate: 1, setData: 3, setDataCallback: 3, loading: 1,
      measureStart: 2, measureFinish: 2, draw: 1, export: 1, hideLoading: 1 },
  },
  'empty|': {
    revision: 1, pending: '', signature: null, path: '', preview: false, height: 1304, thrown: '', draws: 1,
    measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 2,
    eventCounts: { createCanvas: 2, setData: 2, setDataCallback: 3, loading: 1,
      measureStart: 2, measureFinish: 2, draw: 1, export: 1, hideLoading: 1, toast: 1 },
  },
  'fail|': {
    revision: 1, pending: '', signature: null, path: '', preview: false, height: 1304, thrown: '', draws: 1,
    measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 2,
    eventCounts: { createCanvas: 2, setData: 2, setDataCallback: 3, loading: 1,
      measureStart: 2, measureFinish: 2, draw: 1, export: 1, hideLoading: 1, toast: 1 },
  },
  'stale-draw|': {
    revision: 2, pending: 'changed-source', signature: null, path: '', preview: false,
    height: 1304, thrown: '', draws: 1, measureStarts: ['LED大屏/长图绘制'], measureFinishes: 1,
    eventCounts: { createCanvas: 2, setData: 2, setDataCallback: 3, loading: 1,
      measureStart: 1, measureFinish: 1, draw: 1 },
  },
  'stale-success|': {
    revision: 2, pending: 'changed-source', signature: null, path: '', preview: false,
    height: 1304, thrown: '', draws: 1, measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 1,
    eventCounts: { createCanvas: 2, setData: 2, setDataCallback: 3, loading: 1,
      measureStart: 2, measureFinish: 1, draw: 1, export: 1 },
  },
  'stale-fail|': {
    revision: 2, pending: 'changed-source', signature: null, path: '', preview: false,
    height: 1304, thrown: '', draws: 1, measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 1,
    eventCounts: { createCanvas: 2, setData: 2, setDataCallback: 3, loading: 1,
      measureStart: 2, measureFinish: 1, draw: 1, export: 1 },
  },
  'interleave-draw|': {
    revision: 3, pending: '', signature: '6|3|0.2|0.2|5|3|16:9|module|1.53|14|15',
    path: 'temp://new.png', preview: true, height: 1304, thrown: '', draws: 2,
    measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 3,
    eventCounts: { createCanvas: 4, vibrate: 1, setData: 5, setDataCallback: 6, loading: 2,
      measureStart: 3, measureFinish: 3, draw: 2, export: 1, hideLoading: 1 },
  },
  'interleave-success|': {
    revision: 3, pending: '', signature: '6|3|0.2|0.2|5|3|16:9|module|1.53|14|15',
    path: 'temp://new.png', preview: true, height: 1304, thrown: '', draws: 2,
    measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图导出', 'LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 3,
    eventCounts: { createCanvas: 4, vibrate: 1, setData: 5, setDataCallback: 6, loading: 2,
      measureStart: 4, measureFinish: 3, draw: 2, export: 2, hideLoading: 1 },
  },
  'interleave-fail|': {
    revision: 3, pending: '', signature: '6|3|0.2|0.2|5|3|16:9|module|1.53|14|15',
    path: 'temp://new.png', preview: true, height: 1304, thrown: '', draws: 2,
    measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图导出', 'LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 3,
    eventCounts: { createCanvas: 4, vibrate: 1, setData: 5, setDataCallback: 6, loading: 2,
      measureStart: 4, measureFinish: 3, draw: 2, export: 2, hideLoading: 1 },
  },
  'success|create-throws': {
    revision: null, pending: null, signature: null, path: '', preview: false, height: 1580,
    thrown: '', draws: 0, measureStarts: [], measureFinishes: 0,
    eventCounts: { toast: 1 },
  },
  'success|draw-throws': {
    revision: 1, pending: '', signature: null, path: '', preview: false, height: 1304,
    thrown: '', draws: 0, measureStarts: ['LED大屏/长图绘制'], measureFinishes: 1,
    eventCounts: { createCanvas: 2, setData: 2, setDataCallback: 3, loading: 1,
      measureStart: 1, measureFinish: 1, hideLoading: 1, toast: 1 },
  },
  'success|export-throws': {
    revision: 1, pending: '', signature: null, path: '', preview: false, height: 1304,
    thrown: '', draws: 1, measureStarts: ['LED大屏/长图绘制', 'LED大屏/长图导出'], measureFinishes: 2,
    eventCounts: { createCanvas: 2, setData: 2, setDataCallback: 3, loading: 1,
      measureStart: 2, measureFinish: 2, draw: 1, hideLoading: 1, toast: 1 },
  },
}
const LED_CANVAS_OPERATION_COUNTS = {
  beginPath: 37, closePath: 10, fill: 10, fillRect: 4, fillText: 24, lineTo: 67,
  measureText: 280, moveTo: 37, quadraticCurveTo: 40, setFillStyle: 318, setFontSize: 304,
  setLineWidth: 3, setStrokeStyle: 3, setTextAlign: 304, stroke: 27, strokeRect: 2,
  'property:font': 304,
}
const LED_DRAW_THROW_OPERATION_COUNTS = {
  measureText: 265, setFillStyle: 265, setFontSize: 265, setTextAlign: 265, 'property:font': 265,
}
function roundedRectGeometryTrace(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  return [
    ['beginPath', []], ['moveTo', [x + r, y]], ['lineTo', [x + width - r, y]],
    ['quadraticCurveTo', [x + width, y, x + width, y + r]],
    ['lineTo', [x + width, y + height - r]],
    ['quadraticCurveTo', [x + width, y + height, x + width - r, y + height]],
    ['lineTo', [x + r, y + height]],
    ['quadraticCurveTo', [x, y + height, x, y + height - r]],
    ['lineTo', [x, y + r]], ['quadraticCurveTo', [x, y, x + r, y]],
    ['closePath', []], ['fill', []],
  ]
}

function expectedCurrentLedGeometryTrace() {
  const { sections, height } = EXPECTED_CURRENT_LED_LAYOUT
  const input = EXPECTED_CURRENT_LED_PAYLOAD.input
  const result = EXPECTED_CURRENT_LED_RESULT
  const [hero, diagram, specs] = sections.slice(1)
  const trace = [['fillRect', [0, 0, 750, height]]]
  trace.push(...roundedRectGeometryTrace(44, hero.y, 662, hero.height, 24))
  trace.push(...roundedRectGeometryTrace(44, diagram.y, 662, diagram.height, 22))

  const wallWidth = diagram.diagramWall.width
  const wallHeight = diagram.diagramWall.height
  const wallX = 44 + (662 - wallWidth) / 2
  const diagramTop = diagram.y + diagram.wallLabelTop + diagram.wallLabelLines.length * 24 + 7
  const wallY = diagramTop + (diagram.diagramHeight - wallHeight) / 2
  trace.push(['fillRect', [wallX, wallY, wallWidth, wallHeight]])
  trace.push(['strokeRect', [wallX, wallY, wallWidth, wallHeight]])

  const frameX = wallX + result.horizontalMarginMeters / Number(input.wallWidthMeters) * wallWidth
  const frameY = wallY + result.actualTopMarginMeters / Number(input.wallHeightMeters) * wallHeight
  const frameWidth = result.installedWidthMeters / Number(input.wallWidthMeters) * wallWidth
  const frameHeight = result.installedHeightMeters / Number(input.wallHeightMeters) * wallHeight
  trace.push(['fillRect', [frameX, frameY, frameWidth, frameHeight]])
  trace.push(['strokeRect', [frameX, frameY, frameWidth, frameHeight]])

  const screenX = frameX + result.frameWidthMeters / result.installedWidthMeters * frameWidth
  const screenY = frameY + result.frameWidthMeters / result.installedHeightMeters * frameHeight
  const screenWidth = result.screenWidthMeters / result.installedWidthMeters * frameWidth
  const screenHeight = result.screenHeightMeters / result.installedHeightMeters * frameHeight
  trace.push(['fillRect', [screenX, screenY, screenWidth, screenHeight]])
  for (let column = 1; column < result.columns; column += 1) {
    const x = screenX + column / result.columns * screenWidth
    trace.push(['beginPath', []], ['moveTo', [x, screenY]], ['lineTo', [x, screenY + screenHeight]], ['stroke', []])
  }
  for (let row = 1; row < result.rows; row += 1) {
    const y = screenY + row / result.rows * screenHeight
    trace.push(['beginPath', []], ['moveTo', [screenX, y]], ['lineTo', [screenX + screenWidth, y]], ['stroke', []])
  }
  trace.push(...roundedRectGeometryTrace(290, 595.5, 170, 31, 8))
  trace.push(...roundedRectGeometryTrace(44, specs.y, 662, specs.height, 22))
  specs.cells.forEach((cell) => trace.push(...roundedRectGeometryTrace(cell.x, cell.y, cell.width, cell.height, 16)))
  return trace
}

function collectLedEffectiveDrawingStyles(canvasTrace) {
  const state = {}
  const styles = { fillRect: [], fill: [], strokeRect: [], stroke: [], fillText: [] }
  canvasTrace.forEach((entry) => {
    if (entry[0] === 'canvasProperty' && entry[1] === 'font') state.font = entry[2]
    if (entry[0] === 'canvasCall') {
      const [, method, args] = entry
      const value = args?.[0]
      if (method === 'setFillStyle') state.fillStyle = value
      else if (method === 'setStrokeStyle') state.strokeStyle = value
      else if (method === 'setLineWidth') state.lineWidth = value
      else if (method === 'setFontSize') state.fontSize = value
      else if (method === 'setTextAlign') state.textAlign = value
      else if (method === 'fillRect' || method === 'fill') styles[method].push(state.fillStyle)
      else if (method === 'strokeRect' || method === 'stroke') {
        styles[method].push({ strokeStyle: state.strokeStyle, lineWidth: state.lineWidth })
      } else if (method === 'fillText') {
        styles.fillText.push({
          fillStyle: state.fillStyle,
          font: state.font,
          fontSize: state.fontSize,
          textAlign: state.textAlign,
        })
      }
    }
  })
  return styles
}

function repeatLedExpectedStyles(styles, count) {
  return Array.from({ length: count }, () => styles).flat()
}

function assertLedCurrentSemanticContract(outcome, fault, current) {
  const key = `${outcome}|${fault}`
  const expected = LED_LIFECYCLE_EXPECTATIONS[key]
  assert(expected, `未声明 LED 报告生命周期合同：${key}`)

  const expectedData = {
    ...EXPECTED_CURRENT_LED_DATA,
    result: EXPECTED_CURRENT_LED_RESULT,
    // This geometry-only placeholder state is unrelated to report content.
    resultAreaStyle: '',
    reportCanvasHeight: expected.height,
    reportImagePath: expected.path,
    reportPreviewVisible: expected.preview,
  }
  assert.deepEqual(current.state.data, expectedData,
    `led/${key}: 完整页面输入、计算结果、适配数据或报告状态偏离独立合同`)
  assert.deepEqual(current.state.fields, {
    reportRevision: expected.revision,
    reportPendingSignature: expected.pending,
    reportSignature: expected.signature,
  }, `led/${key}: 报告修订、待处理签名或已提交签名偏离生命周期合同`)
  assert.equal(current.thrown, expected.thrown, `led/${key}: 同步错误传播结果变化`)

  const report = require('../pages/led-screen/report')
  const payload = report.buildLedScreenReportPayload(current.state.data)
  assert.deepEqual(payload, EXPECTED_CURRENT_LED_PAYLOAD,
    `led/${key}: 生成报告的输入或结果数据偏离固定 synthetic payload`)
  const layout = report.buildLedScreenReportLayout({
    measureText: (text) => ({ width: String(text).length * 10 }),
  }, payload)
  assert.deepEqual(layout, EXPECTED_CURRENT_LED_LAYOUT,
    `led/${key}: 报告分页、区块尺寸、标签或参数卡布局偏离独立合同`)

  const canvasTrace = current.trace.filter((entry) => ['canvasCall', 'canvasProperty'].includes(entry[0]))
  const eventTrace = current.trace.filter((entry) => !['canvasCall', 'canvasProperty'].includes(entry[0]))
  const operationCounts = {}
  canvasTrace.forEach((entry) => {
    const operation = entry[0] === 'canvasProperty' ? `property:${entry[1]}` : entry[1]
    operationCounts[operation] = (operationCounts[operation] || 0) + 1
  })
  const expectedOperationCounts = fault === 'create-throws' ? {}
    : fault === 'draw-throws' ? LED_DRAW_THROW_OPERATION_COUNTS
      : Object.fromEntries(Object.entries(LED_CANVAS_OPERATION_COUNTS)
        .map(([operation, count]) => [operation, count * expected.draws]))
  assert.deepEqual(operationCounts, expectedOperationCounts,
    `led/${key}: Canvas 调用总量、文本测量或绘制原语顺序覆盖发生变化`)

  const textCalls = canvasTrace.filter((entry) => entry[0] === 'canvasCall' && entry[1] === 'fillText')
    .map((entry) => entry[2])
  assert.deepEqual(textCalls, Array.from({ length: expected.draws }, () => EXPECTED_CURRENT_LED_TEXT).flat(),
    `led/${key}: 完整报告文案、分页内容或绘制坐标偏离合同`)
  const effectiveStyles = collectLedEffectiveDrawingStyles(canvasTrace)
  assert.deepEqual(effectiveStyles.fillRect,
    repeatLedExpectedStyles(EXPECTED_CURRENT_LED_FILL_RECT_STYLES, expected.draws),
  `led/${key}: 背景、墙体、包边或净屏填充颜色偏离独立合同`)
  assert.deepEqual(effectiveStyles.fill,
    repeatLedExpectedStyles(EXPECTED_CURRENT_LED_FILL_STYLES, expected.draws),
  `led/${key}: 报告卡片、净屏标注或参数卡填充颜色偏离独立合同`)
  assert.deepEqual(effectiveStyles.strokeRect,
    repeatLedExpectedStyles(EXPECTED_CURRENT_LED_STROKE_RECT_STYLES, expected.draws),
  `led/${key}: 墙体或包边描边颜色、线宽偏离独立合同`)
  assert.deepEqual(effectiveStyles.stroke,
    repeatLedExpectedStyles(Array.from({ length: EXPECTED_CURRENT_LED_RESULT.columns - 1
      + EXPECTED_CURRENT_LED_RESULT.rows - 1 }, () => EXPECTED_CURRENT_LED_GRID_STROKE_STYLE), expected.draws),
  `led/${key}: 模组网格描边颜色或线宽偏离独立合同`)
  assert.deepEqual(effectiveStyles.fillText,
    repeatLedExpectedStyles(EXPECTED_CURRENT_LED_TEXT_STYLES, expected.draws),
  `led/${key}: 实际文字绘制的颜色、字体、字号或对齐方式偏离独立合同`)
  const geometryMethods = new Set([
    'beginPath', 'closePath', 'fill', 'fillRect', 'lineTo', 'moveTo',
    'quadraticCurveTo', 'stroke', 'strokeRect',
  ])
  const geometryTrace = canvasTrace.filter((entry) => entry[0] === 'canvasCall' && geometryMethods.has(entry[1]))
    .map((entry) => [entry[1], entry[2]])
  assert.deepEqual(geometryTrace,
    Array.from({ length: expected.draws }, expectedCurrentLedGeometryTrace).flat(),
  `led/${key}: 报告卡片、墙体/包边/净屏边界、模组网格或参数卡完整绘制轨迹变化`)

  const eventCounts = {}
  eventTrace.forEach((entry) => { eventCounts[entry[0]] = (eventCounts[entry[0]] || 0) + 1 })
  assert.deepEqual(eventCounts, expected.eventCounts, `led/${key}: 完整页面副作用次数变化`)
  assert.deepEqual(eventTrace.filter((entry) => entry[0] === 'measureStart').map((entry) => entry[1]),
    expected.measureStarts, `led/${key}: 绘制与导出计时的起始顺序变化`)
  const finishNames = {
    0: [],
    1: ['LED大屏/长图绘制'],
    2: ['LED大屏/长图绘制', 'LED大屏/长图导出'],
    3: ['LED大屏/长图绘制', 'LED大屏/长图绘制', 'LED大屏/长图导出'],
  }[expected.measureFinishes]
  assert.deepEqual(eventTrace.filter((entry) => entry[0] === 'measureFinish').map((entry) => entry[1]),
    finishNames, `led/${key}: 绘制与导出计时结束数量或顺序变化`)
  assert.deepEqual(eventTrace.filter((entry) => entry[0] === 'createCanvas'),
    Array.from({ length: expected.eventCounts.createCanvas || 0 }, () => ['createCanvas', 'ledScreenReportCanvas', true]),
  `led/${key}: Canvas 上下文 id、页面归属或创建次数变化`)
  assert.deepEqual(eventTrace.filter((entry) => entry[0] === 'vibrate'),
    Array.from({ length: expected.eventCounts.vibrate || 0 }, () => ['vibrate', { type: 'medium' }]),
  `led/${key}: 生成报告的触觉反馈副作用变化`)
  assert.deepEqual(eventTrace.filter((entry) => entry[0] === 'loading'),
    Array.from({ length: expected.eventCounts.loading || 0 }, () => ['loading', { title: '正在生成图片', mask: true }]),
  `led/${key}: 报告加载提示变化`)
  assert.deepEqual(eventTrace.filter((entry) => entry[0] === 'draw').map((entry) => entry[1]),
    Array.from({ length: expected.draws }, () => false), `led/${key}: Canvas draw reserve 标志或次数变化`)
  const exportOptions = {
    canvasId: 'ledScreenReportCanvas', width: 750, height: expected.height,
    destWidth: 1500, destHeight: expected.height * 2, fileType: 'png', quality: 1,
  }
  assert.deepEqual(eventTrace.filter((entry) => entry[0] === 'export'),
    Array.from({ length: expected.eventCounts.export || 0 }, () => ['export', exportOptions, true]),
  `led/${key}: 报告导出目标、尺寸、倍率或调用次数变化`)
  const toasts = eventTrace.filter((entry) => entry[0] === 'toast')
  if (fault === 'create-throws' || fault === 'draw-throws' || fault === 'export-throws' || outcome === 'fail') {
    assert(toasts.some((entry) => /图片生成失败/.test(entry[1]?.title || '')),
      `led/${key}: 当前生成错误必须提示用户`)
  }
}

try {
  if (process.argv.includes('--capture-fixture')) {
    const originalFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
    const scenarios = cases.map((scenario) => ({
      ...scenario,
      sha256: digest(run(scenario.kind, true, scenario.outcome, scenario.fault)),
    }))
    // Keep the retired project-image rows as historical evidence without executing them.
    scenarios.push(...originalFixture.scenarios.filter((scenario) => scenario.kind === 'project'))
    const sourceHashes = getBaselineSourceHashes()
    if (originalFixture.sourceHashes['pages/records/project.js']) {
      sourceHashes['pages/records/project.js'] = originalFixture.sourceHashes['pages/records/project.js']
    }
    fs.writeFileSync(fixturePath, JSON.stringify({ sourceHashes, scenarios }, null, 2) + '\n')
  } else if (process.argv.includes('--capture-led-fixture')) {
    // LED reporting now intentionally measures and lays out a longer report.
    // Rebaseline its 12 cases while preserving all other historical rows byte-for-byte.
    const originalText = fs.readFileSync(fixturePath, 'utf8')
    const originalFixture = JSON.parse(originalText)
    const ledScenarios = cases.filter((scenario) => scenario.kind === 'led').map((scenario) => {
      const current = run('led', false, scenario.outcome, scenario.fault)
      assertLedScenarioSemantics(scenario.outcome, scenario.fault, current)
      return { ...scenario, sha256: digest(current) }
    })
    let updatedText = originalText
    for (const scenario of ledScenarios) {
      const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`"kind": "led",\\s*"outcome": "${escape(scenario.outcome)}",\\s*"fault": "${escape(scenario.fault)}",\\s*"sha256": "[a-f0-9]{64}`)
      assert.match(updatedText, pattern, `fixture missing LED case ${scenario.outcome}/${scenario.fault}`)
      updatedText = updatedText.replace(pattern, (match) => `${match.slice(0, -64)}${scenario.sha256}`)
    }
    const updatedFixture = JSON.parse(updatedText)
    assert.deepEqual(updatedFixture.sourceHashes, originalFixture.sourceHashes, 'LED rebaseline must preserve sourceHashes')
    assert.deepEqual(updatedFixture.scenarios.filter((item) => item.kind !== 'led'),
      originalFixture.scenarios.filter((item) => item.kind !== 'led'), 'LED rebaseline must preserve non-LED historical cases')
    fs.writeFileSync(fixturePath, updatedText)
    console.log('Rebaselined only 12 LED report scenarios; non-LED historical cases and sourceHashes are preserved.')
  } else {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
    const compareBefore = process.argv.includes('--compare-before')
    if (compareBefore) {
      // LED is intentionally excluded from old-source equivalence after its UI redesign.
      const comparablePaths = sourcePaths.filter((relativePath) => relativePath !== 'pages/led-screen/led-screen.js')
      const currentHashes = getBaselineSourceHashes()
      const fixtureHashes = fixture.sourceHashes
      assert.deepEqual(Object.fromEntries(comparablePaths.map((relativePath) => [relativePath, currentHashes[relativePath]])),
        Object.fromEntries(comparablePaths.map((relativePath) => [relativePath, fixtureHashes[relativePath]])),
        '冻结结果报告源码与原 fixture 来源哈希不一致')
    }
    for (const scenario of cases) {
      const current = run(scenario.kind, false, scenario.outcome, scenario.fault)
      const frozen = fixture.scenarios.find((item) => item.kind === scenario.kind
        && item.outcome === scenario.outcome && item.fault === scenario.fault)
      assert.ok(frozen, 'fixture缺少场景 ' + scenario.kind + '/' + scenario.outcome + '/' + scenario.fault)
      if (scenario.kind === 'led') {
        assertLedScenarioSemantics(scenario.outcome, scenario.fault, current)
        if (!compareBefore) console.log(JSON.stringify({
          case: 'led/' + scenario.outcome + '/' + (scenario.fault || '(no fault)'),
          preservedHistoricalSha256: frozen.sha256,
          currentSemanticDigest: digest(current),
          historicalHashReproduced: digest(current) === frozen.sha256,
          canvasDraws: LED_LIFECYCLE_EXPECTATIONS[scenario.outcome + '|' + scenario.fault].draws,
        }))
      } else {
        const comparable = { ...current, trace: resultTraceForFrozenDigest(current, scenario) }
        const before = run('result', true, scenario.outcome, scenario.fault)
        const legacyComparable = { ...before, trace: resultTraceWithFrozenFooter(before.trace, scenario) }
        assert.equal(digest(legacyComparable), frozen.sha256,
          'result/' + scenario.outcome + '/' + scenario.fault + ': 冻结原源码必须保留原 fixture hash')
        const legacyWithoutHaptics = {
          ...legacyComparable,
          trace: legacyComparable.trace.filter((entry) => entry[0] !== 'vibrate'),
        }
        assert.deepEqual(comparable, legacyWithoutHaptics,
          'result/' + scenario.outcome + '/' + scenario.fault + ': 移除触感差异后，页面状态、Canvas 与其他副作用必须等价')
        if (!compareBefore) console.log(JSON.stringify({
          case: 'result/' + scenario.outcome + '/' + (scenario.fault || '(no fault)'),
          legacyFixtureHashReproduced: true,
          legacyHapticCount: legacyComparable.trace.filter((entry) => entry[0] === 'vibrate').length,
          currentHaptics: current.trace.filter((entry) => entry[0] === 'vibrate').map((entry) => entry[1].type),
        }))
        if (compareBefore) assert.deepEqual(comparable, {
          ...before,
          trace: resultTraceWithFrozenFooter(before.trace.filter((entry) => entry[0] !== 'vibrate'), scenario),
        }, 'result/' + scenario.outcome + '/' + scenario.fault + ': 触感/版本差异外偏离冻结原源码')
      }
      if (scenario.outcome === 'success' && !scenario.fault) {
        const exportIndex = current.trace.findIndex((entry) => entry[0] === 'export')
        const finishIndex = current.trace.findIndex((entry) => entry[0] === 'measureFinish' && /导出|结果图导出/.test(entry[1]))
        assert.ok(exportIndex >= 0 && finishIndex > exportIndex, scenario.kind + ': 导出计时与回调顺序丢失')
      }
    }
    console.log(compareBefore
      ? '12 个结果图场景通过冻结源码差分；12 个 LED 场景通过当前语义检查。'
      : 'Canvas 合同通过：12 个结果图场景与冻结原源码等价（忽略已契约化触感差异）；12 个 LED 场景通过当前生命周期、分页布局、Canvas 绘制与失败处理合同。退役项目长图的 fixture 行仅作为历史数据保留。')
  }
} finally {
  Date.now = originalDateNow
  if (originalWx === undefined) delete global.wx
  else global.wx = originalWx
  if (originalPage === undefined) delete global.Page
  else global.Page = originalPage
  if (originalGetCurrentPages === undefined) delete global.getCurrentPages
  else global.getCurrentPages = originalGetCurrentPages
  isolatedModules.forEach((filename) => {
    delete require.cache[filename]
    const original = originalModuleEntries.get(filename)
    if (original) require.cache[filename] = original
  })
}

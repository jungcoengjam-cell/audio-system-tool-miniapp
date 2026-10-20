const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const Module = require('module')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const BASELINE = path.join(ROOT, 'docs/recovery/package-structure-2026-09-30/before')
const storage = new Map()
const isolatedModules = [
  'utils/performance.js',
  'pages/records/project-report.js',
  'pages/led-screen/report.js',
  'utils/result-report.js',
].map((relativePath) => path.join(ROOT, relativePath))
const originalModuleEntries = new Map(isolatedModules.map((filename) => [filename, require.cache[filename]]))
const originalDateNow = Date.now
const originalWx = global.wx
const originalPage = global.Page
Date.now = () => 1790750000000

function loadRevision(relativePath, baseline) {
  const filename = path.join(ROOT, relativePath)
  const sourcePath = baseline ? path.join(BASELINE, `${relativePath}.baseline`) : filename
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  loaded._compile(fs.readFileSync(sourcePath, 'utf8'), filename)
  return loaded.exports
}

function installRuntime(trace, queues, fault) {
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

function seedProject() {
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.projects.v1', [{ id: 'p', name: 'P', createdAt: 1, updatedAt: 1 }])
  storage.set('audioTool.records.v1', [{
    id: 'r', module: 'limiter', title: 'R', summary: 'S', preferences: { speakerModel: 'S' },
    resultText: 'R', projectIds: ['p'], favorite: false, createdAt: 1, updatedAt: 1,
  }])
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

  const drawingPath = kind === 'project' ? 'pages/records/project-report.js'
    : kind === 'led' ? 'pages/led-screen/report.js' : 'utils/result-report.js'
  const drawingFile = path.join(ROOT, drawingPath)
  delete require.cache[drawingFile]
  if (fault === 'draw-throws') {
    const drawing = require(drawingFile)
    const method = kind === 'project' ? 'drawProjectReport' : kind === 'led' ? 'drawLedScreenReport' : 'drawResultReport'
    drawing[method] = () => { throw new Error('draw failed synchronously') }
  }

  if (kind === 'project') {
    seedProject()
    loadRevision('pages/records/project.js', baseline)
    recordSetData(queues.page, trace)
    queues.page.onLoad({ id: 'p' })
    return {
      page: queues.page,
      generate: () => queues.page.generateProjectReportImage(),
      invalidate: () => {
        queues.page.reportRevision += 1
        queues.page.reportPendingSignature = 'changed-source'
        queues.page.setData({ isGeneratingReport: false })
      },
    }
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
  if (kind === 'led') {
    // This fixture protects the report controller and Canvas side effects. LED
    // form feedback and responsive wall geometry have separate first-use tests.
    // Keep the frozen controller comparable after those presentation changes.
    for (const key of ['fieldErrors', 'inputSuggestion', 'inputPending']) delete data[key]
    if (data.result) {
      for (const key of ['diagramHeightRpx', 'diagramFitStyle', 'wallDiagramStyle',
        'diagramLabelsBelow', 'ratioFallback', 'ratioDeviationPercent',
        'ratioDeviationText', 'actualRatioText', 'ratioSummaryText', 'ratioFallbackText', 'integerLayoutNote']) {
        delete data.result[key]
      }
    }
  }
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
  const { data } = result.state
  const superseded = !fault && outcome.startsWith('interleave-')
  const expectedPath = fault ? '' : outcome === 'success' ? 'temp://report.png'
    : superseded ? 'temp://new.png' : ''
  assert.equal(data.reportImagePath, expectedPath,
    `led/${outcome}/${fault}: only the current successful export may publish an image`)
  assert.equal(data.reportPreviewVisible, Boolean(expectedPath),
    `led/${outcome}/${fault}: preview state must follow the current image`)
  assert.equal(data.isGeneratingReport, false,
    `led/${outcome}/${fault}: settled or invalidated generation must leave loading state`)
  if (fault === 'create-throws' || fault === 'draw-throws' || fault === 'export-throws' || outcome === 'fail') {
    assert(result.trace.some((entry) => entry[0] === 'toast' && /图片生成失败/.test(entry[1]?.title || '')),
      `led/${outcome}/${fault}: current generation failure should be reported`)
  }
}

const cases = []
for (const kind of ['project', 'led', 'result']) {
  for (const outcome of ['success', 'empty', 'fail', 'stale-draw', 'stale-success', 'stale-fail',
    'interleave-draw', 'interleave-success', 'interleave-fail']) cases.push({ kind, outcome, fault: '' })
  for (const fault of ['create-throws', 'draw-throws', 'export-throws']) cases.push({ kind, outcome: 'success', fault })
}
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sourcePaths = [
  'pages/records/project.js',
  'pages/led-screen/led-screen.js',
  'utils/result-report-controller.js',
]
const getBaselineSourceHashes = () => Object.fromEntries(sourcePaths.map((relativePath) => [
  relativePath,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(BASELINE, `${relativePath}.baseline`))).digest('hex'),
]))
const fixturePath = path.join(__dirname, 'report-canvas-equivalence.fixture.json')

try {
  if (process.argv.includes('--capture-fixture')) {
    const scenarios = cases.map((scenario) => ({
      ...scenario,
      sha256: digest(run(scenario.kind, true, scenario.outcome, scenario.fault)),
    }))
    fs.writeFileSync(fixturePath, `${JSON.stringify({ sourceHashes: getBaselineSourceHashes(), scenarios }, null, 2)}\n`)
  } else if (process.argv.includes('--capture-led-fixture')) {
    // LED reporting now intentionally measures and lays out a longer report.
    // Rebaseline only its 12 cases; project/result snapshots stay byte-for-byte intact.
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
      originalFixture.scenarios.filter((item) => item.kind !== 'led'), 'LED rebaseline must preserve project/result cases')
    fs.writeFileSync(fixturePath, updatedText)
    console.log('Rebaselined only 12 LED report scenarios; project/result cases and sourceHashes are preserved.')
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
        '本地冻结源码与project/result fixture来源哈希不一致')
    }
    for (const scenario of cases) {
      const current = run(scenario.kind, false, scenario.outcome, scenario.fault)
      const frozen = fixture.scenarios.find((item) => item.kind === scenario.kind
        && item.outcome === scenario.outcome && item.fault === scenario.fault)
      assert.ok(frozen, `fixture缺少场景 ${scenario.kind}/${scenario.outcome}/${scenario.fault}`)
      if (scenario.kind === 'led') assertLedScenarioSemantics(scenario.outcome, scenario.fault, current)
      assert.equal(digest(current), frozen.sha256,
        `${scenario.kind}/${scenario.outcome}/${scenario.fault}: 页面副作用、Canvas绘制轨迹或最终状态变化`)
      if (compareBefore && scenario.kind !== 'led') {
        const before = run(scenario.kind, true, scenario.outcome, scenario.fault)
        assert.deepEqual(current, before, `${scenario.kind}/${scenario.outcome}/${scenario.fault}: 偏离冻结原源码`)
      }
      if (scenario.outcome === 'success' && !scenario.fault) {
        const exportIndex = current.trace.findIndex((entry) => entry[0] === 'export')
        const finishIndex = current.trace.findIndex((entry) => entry[0] === 'measureFinish' && /导出|结果图导出/.test(entry[1]))
        assert.ok(exportIndex >= 0 && finishIndex > exportIndex, `${scenario.kind}: 导出计时与回调顺序丢失`)
      }
    }
  }
  console.log(`三处真实结果图调用方的${process.argv.includes('--compare-before') ? '旧源码差分' : '冻结fixture'}等价检查通过（${cases.length} 个场景）。`)
} finally {
  Date.now = originalDateNow
  if (originalWx === undefined) delete global.wx
  else global.wx = originalWx
  if (originalPage === undefined) delete global.Page
  else global.Page = originalPage
  isolatedModules.forEach((filename) => {
    delete require.cache[filename]
    const original = originalModuleEntries.get(filename)
    if (original) require.cache[filename] = original
  })
}

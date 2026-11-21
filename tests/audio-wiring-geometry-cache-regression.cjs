'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Module = require('module')

const root = path.resolve(__dirname, '..')
const rendererPath = require.resolve(path.join(root, 'pages/audio-wiring/wiring-renderer.js'))
const pagePath = require.resolve(path.join(root, 'pages/audio-wiring/index.js'))
const originalRendererCache = require.cache[rendererPath]
const originalPageCache = require.cache[pagePath]
const previousWx = global.wx
const previousPage = global.Page
const previousBuilderCalls = global.__audioWiringGeometryBuilderCalls
const previousBuilderBehavior = global.__audioWiringGeometryBuilderBehavior
const previousCacheFailure = global.__audioWiringGeometryCacheFailure

function instrumentRenderer() {
  const source = fs.readFileSync(rendererPath, 'utf8')
  const functionMarker = 'function selectSolderRoutes(model, layout) {'
  const returnMarker = "  return { routes, error: '' }"
  const failureMarkers = [
    ['function makeOnLoadSolderGeometryKey(model, width, contentWidth, options, output, input, photoBottom, maxHeight) {', 'key'],
    ['function getOnLoadSolderGeometry(key, connections, output, input) {', 'get'],
    ['function storeOnLoadSolderGeometry(key, routeSelection, connections, output, input) {', 'store'],
  ]
  assert(source.includes(functionMarker), 'the direct solder solver instrumentation point must exist')
  assert(source.includes(returnMarker), 'the successful direct route result instrumentation point must exist')
  let instrumented = source
    .replace(functionMarker, `${functionMarker}\n  global.__audioWiringGeometryBuilderCalls += 1\n  if (global.__audioWiringGeometryBuilderBehavior === 'throw') throw new Error('injected direct solver exception')\n  if (global.__audioWiringGeometryBuilderBehavior === 'error') return { routes: [], error: 'injected route build failure' }`)
    .replace(returnMarker, `  const result = { routes, error: '' }
  if (global.__audioWiringGeometryBuilderBehavior === 'invalid' && result.routes[0]) result.routes[0].points[0][0] = Infinity
  if (global.__audioWiringGeometryBuilderBehavior === 'reverse') result.routes.reverse()
  return result`)
  for (const [marker, failure] of failureMarkers) {
    assert(source.includes(marker), `the ${failure} cache failure injection point must exist`)
    instrumented = instrumented.replace(marker,
      `${marker}\n  if (global.__audioWiringGeometryCacheFailure === '${failure}') throw new Error('injected ${failure} cache failure')`)
  }
  const instrumentedModule = new Module(rendererPath, module)
  instrumentedModule.filename = rendererPath
  instrumentedModule.paths = Module._nodeModulePaths(path.dirname(rendererPath))
  instrumentedModule._compile(instrumented, rendererPath)
  require.cache[rendererPath] = instrumentedModule
  return instrumentedModule.exports
}

function canvasArgument(value) {
  if (Array.isArray(value)) return value.map(canvasArgument)
  if (value && typeof value === 'object') {
    if (typeof value.token === 'string') return { image: value.token }
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canvasArgument(value[key])]))
  }
  return value
}

function makeCanvasRecorder() {
  const commands = []
  const state = Object.create(null)
  const context = new Proxy(state, {
    get(target, property) {
      if (property === 'font') return target.font
      if (typeof property === 'symbol') return undefined
      return (...args) => commands.push([String(property), ...args.map(canvasArgument)])
    },
    set(target, property, value) {
      target[property] = value
      commands.push([`set:${String(property)}`, canvasArgument(value)])
      return true
    },
  })
  return { context, commands }
}

function routeGeometry(metrics) {
  const anchors = (layout) => Array.from(layout.anchors, ([key, point]) => [key, {
    x: point.x,
    y: point.y,
    photo: point.photo,
    routeDirection: point.routeDirection,
  }])
  return JSON.parse(JSON.stringify({
    mode: metrics.mode,
    height: metrics.height,
    supported: metrics.supported,
    routingError: metrics.routingError,
    outputAnchors: anchors(metrics.output),
    inputAnchors: anchors(metrics.input),
    connections: metrics.connectionAnchors.map((item) => ({
      id: item.id,
      fromPin: item.fromPin,
      toPin: item.toPin,
      from: { x: item.from.x, y: item.from.y },
      to: { x: item.to.x, y: item.to.y },
      photoFrom: { x: item.photoFrom.x, y: item.photoFrom.y },
      photoTo: { x: item.photoTo.x, y: item.photoTo.y },
      points: item.points,
      length: item.length,
    })),
  }))
}

function assertRouteEndpoints(metrics, model, label) {
  const outputs = metrics.output.anchors
  const inputs = metrics.input.anchors
  const byId = new Map(model.connections.map((connection) => [connection.id, connection]))
  assert.strictEqual(metrics.connectionAnchors.length, model.connections.length,
    `${label}: every model connection must have a route`)
  for (const route of metrics.connectionAnchors) {
    const connection = byId.get(route.id)
    assert(connection, `${label}: route id ${route.id} must belong to the current model`)
    const source = outputs.get(String(connection.fromPin))
    const target = inputs.get(String(connection.toPin))
    assert(source && target, `${label}: both physical pin anchors must exist for ${route.id}`)
    assert.strictEqual(route.fromPin, connection.fromPin, `${label}: ${route.id} must retain its named output pin`)
    assert.strictEqual(route.toPin, connection.toPin, `${label}: ${route.id} must retain its named input pin`)
    assert(Math.hypot(route.photoFrom.x - source.x, route.photoFrom.y - source.y) <= 0.01,
      `${label}: ${route.id} must identify the real output photo pin ${connection.fromPin}`)
    assert(Math.hypot(route.photoTo.x - target.x, route.photoTo.y - target.y) <= 0.01,
      `${label}: ${route.id} must identify the real input photo pin ${connection.toPin}`)
    const first = route.points[0]
    const last = route.points[route.points.length - 1]
    assert(route.points.length >= 2, `${label}: ${route.id} must contain a complete path`)
    assert(Math.hypot(route.from.x - source.x, route.from.y - source.y) <= 0.01,
      `${label}: ${route.id} from must be its actual output photo pin`)
    assert(Math.hypot(route.to.x - target.x, route.to.y - target.y) <= 0.01,
      `${label}: ${route.id} to must be its actual input photo pin`)
    assert(Math.hypot(first[0] - route.from.x, first[1] - route.from.y) <= 0.01,
      `${label}: ${route.id} must start at its real output photo pin`)
    assert(Math.hypot(last[0] - route.to.x, last[1] - route.to.y) <= 0.01,
      `${label}: ${route.id} must end at its real input photo pin`)
  }
}

function commandsWithoutImageIdentity(commands) {
  return commands.map(([name, ...args]) => name === 'drawImage'
    ? [name, '<image>', ...args.slice(1)]
    : [name, ...args])
}

function imageTokens(commands) {
  return commands.filter(([name]) => name === 'drawImage').map(([, image]) => image && image.image)
}

function reportOptions(data) {
  const manualSelected = data.manualSelected || {}
  const preferenceNotice = data.showRestoredHint
    ? '已恢复上次接口，请按本次设备核对。'
    : !manualSelected.output && !manualSelected.input
      ? '默认示例，先核对实际两端接口。'
      : !manualSelected.output || !manualSelected.input
        ? '仍有接口为默认示例，请核对实际两端接口。'
        : ''
  return {
    layout: 'solder-wiring',
    compact: true,
    viewMode: 'connectors',
    face: 'solder',
    selectedId: typeof data.selectedId === 'string' ? data.selectedId : '',
    theme: data.theme,
    preferenceNotice,
  }
}

function canvasPhotos(photoModule, model, owner) {
  return Object.fromEntries(photoModule.getModelPhotoSpecs(model).map((spec) => [spec.key, { token: `${owner}:${spec.key}` }]))
}

function makePage(definition) {
  const page = Object.create(definition)
  page.data = { ...definition.data }
  page.setData = function (patch, callback) {
    this.data = { ...this.data, ...patch }
    if (callback) callback.call(this)
  }
  return page
}

function makeScreenCanvas(owner, recorder) {
  let imageNumber = 0
  let canvasWidth = 0
  let canvasHeight = 0
  return {
    getContext() { return recorder.context },
    createImage() {
      const image = { token: `${owner}:screen:${++imageNumber}` }
      Object.defineProperty(image, 'src', {
        set(value) {
          image.path = value
          queueMicrotask(() => { if (image.onload) image.onload() })
        },
      })
      return image
    },
    set width(value) { canvasWidth = value },
    get width() { return canvasWidth },
    set height(value) { canvasHeight = value },
    get height() { return canvasHeight },
  }
}

async function renderFromOnReady(page, owner, renderer) {
  const recorder = makeCanvasRecorder()
  const canvas = makeScreenCanvas(owner, recorder)
  global.wx.createSelectorQuery = () => ({
    in() { return this },
    select() { return this },
    fields() { return this },
    exec(callback) { callback([{ node: canvas, width: page.data.diagramCanvasWidth }]) },
  })
  page._isWiringVisible = true
  page.onReady()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.strictEqual(page.data.diagramError, '', 'the real onReady draw path must finish without a renderer error')
  assert.strictEqual(renderer.getDiagramHeight(page.data.diagramCanvasWidth, page.data.model, {
    layout: 'solder-wiring', avoidRail: true, selectedId: page.data.selectedId, theme: page.data.theme, showTitle: false,
  }), page.data.diagramCanvasHeight)
  return { recorder, canvas }
}

function makePreferences(outputId, inputId) {
  return {
    version: 1,
    outputId,
    inputId,
    manualSelected: { output: true, input: true },
    viewMode: 'connectors',
    face: 'solder',
  }
}

async function main() {
  global.__audioWiringGeometryBuilderCalls = 0
  global.__audioWiringGeometryBuilderBehavior = 'normal'
  global.__audioWiringGeometryCacheFailure = ''
  const renderer = instrumentRenderer()
  const photoModule = require(path.join(root, 'pages/audio-wiring/wiring-photos.js'))
  let definition
  let windowWidth = 375
  let theme = 'light'
  let preferences = undefined
  global.wx = {
    getWindowInfo: () => ({ windowWidth, pixelRatio: 2, theme }),
    getSystemInfoSync: () => ({ windowWidth, pixelRatio: 2, theme }),
    getAppBaseInfo: () => ({ theme }),
    getStorageSync: (key) => key === 'audioWiringPreferencesV1' ? preferences : undefined,
    setStorageSync() {},
    onThemeChange() {},
  }
  global.Page = (value) => { definition = value }
  delete require.cache[pagePath]
  require(pagePath)
  assert(definition, 'the production audio Page must register')

  const cold = makePage(definition)
  cold.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, 2,
    'the cold audio onLoad must solve screen and report geometry once each')
  assert.strictEqual(cold.data.model.status, 'ready')
  const warm = makePage(definition)
  warm.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, 2,
    'the second real factory model must hit both successful onLoad geometry slots')
  assert.notStrictEqual(cold.data.model, warm.data.model, 'page entries must keep distinct mutable model objects')
  assert.strictEqual(warm.data.diagramCanvasHeight, cold.data.diagramCanvasHeight)
  assert.strictEqual(warm.data.resultReportCanvasHeight, cold.data.resultReportCanvasHeight)

  const coldScreen = await renderFromOnReady(cold, 'cold', renderer)
  const warmScreen = await renderFromOnReady(warm, 'warm', renderer)
  assert.deepStrictEqual(commandsWithoutImageIdentity(coldScreen.recorder.commands),
    commandsWithoutImageIdentity(warmScreen.recorder.commands),
  'real onReady Canvas instructions must match between cold direct solve and cross-model cache hit')
  assert(imageTokens(coldScreen.recorder.commands).some((token) => token && token.startsWith('cold:screen:')))
  assert(imageTokens(warmScreen.recorder.commands).some((token) => token && token.startsWith('warm:screen:')))
  assert.notDeepStrictEqual(imageTokens(coldScreen.recorder.commands), imageTokens(warmScreen.recorder.commands),
    'screen image instances must remain isolated per canvas')

  const drawReport = (page, owner) => {
    const recorder = makeCanvasRecorder()
    const options = reportOptions(page.data)
    const photos = canvasPhotos(photoModule, page.data.model, owner)
    const result = renderer.drawWiringReport(recorder.context, page.data.model, 720,
      page.data.resultReportCanvasHeight, { ...options, photos })
    return { recorder, result }
  }
  const coldMetricsRecorder = makeCanvasRecorder()
  const warmMetricsRecorder = makeCanvasRecorder()
  const diagramOptions = (page) => ({
    layout: 'solder-wiring', avoidRail: true, selectedId: page.data.selectedId,
    theme: page.data.theme, showTitle: false,
  })
  const coldMetrics = renderer.drawWiringDiagram(coldMetricsRecorder.context, cold.data.model,
    cold.data.diagramCanvasWidth, cold.data.diagramCanvasHeight,
    { ...diagramOptions(cold), photos: canvasPhotos(photoModule, cold.data.model, 'cold-metrics') })
  const warmMetrics = renderer.drawWiringDiagram(warmMetricsRecorder.context, warm.data.model,
    warm.data.diagramCanvasWidth, warm.data.diagramCanvasHeight,
    { ...diagramOptions(warm), photos: canvasPhotos(photoModule, warm.data.model, 'warm-metrics') })
  const coldGeometry = routeGeometry(coldMetrics)
  assertRouteEndpoints(coldMetrics, cold.data.model, 'cold route mapping')
  assertRouteEndpoints(warmMetrics, warm.data.model, 'warm route mapping')
  assert.deepStrictEqual(routeGeometry(warmMetrics), coldGeometry,
    'cold and hot route polylines, anchors, and heights must be numerically identical')
  assert.notStrictEqual(coldMetrics.connectionAnchors[0].points, warmMetrics.connectionAnchors[0].points,
    'route points must be copied into each page instead of shared')
  assert.deepStrictEqual(renderer.getWiringHitAreas(cold.data.model, cold.data.diagramCanvasWidth,
    cold.data.diagramCanvasHeight, diagramOptions(cold)),
  renderer.getWiringHitAreas(warm.data.model, warm.data.diagramCanvasWidth,
    warm.data.diagramCanvasHeight, diagramOptions(warm)),
  'hit testing areas must match between cold and hot renderer paths')
  assert.deepStrictEqual(commandsWithoutImageIdentity(coldMetricsRecorder.commands),
    commandsWithoutImageIdentity(warmMetricsRecorder.commands),
  'direct wiring Canvas instructions must match after normalizing per-canvas image identity')

  const coldReport = drawReport(cold, 'cold-report')
  const warmReport = drawReport(warm, 'warm-report')
  assert.deepStrictEqual(coldReport.result, warmReport.result, 'report render dimensions must match')
  assert.deepStrictEqual(commandsWithoutImageIdentity(coldReport.recorder.commands),
    commandsWithoutImageIdentity(warmReport.recorder.commands),
  'full report Canvas instructions and embedded geometry must match')
  assert(imageTokens(coldReport.recorder.commands).some((token) => token && token.startsWith('cold-report:')))
  assert(imageTokens(warmReport.recorder.commands).some((token) => token && token.startsWith('warm-report:')))
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, 2,
  'onReady drawing, hit areas, and report generation must not defer direct route solving to later')

  coldMetrics.connectionAnchors[0].points[0][0] = 123456
  const afterMutation = makePage(definition)
  afterMutation.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, 2,
    'mutating caller-owned route points must not poison the frozen cross-model geometry snapshot')
  const afterMutationMetrics = renderer.drawWiringDiagram(makeCanvasRecorder().context, afterMutation.data.model,
    afterMutation.data.diagramCanvasWidth, afterMutation.data.diagramCanvasHeight,
    diagramOptions(afterMutation))
  assert.deepStrictEqual(routeGeometry(afterMutationMetrics), coldGeometry,
    'a later page must still receive the original unmutated geometry')

  preferences = makePreferences('xlrBalanced', 'xlrBalanced')
  global.__audioWiringGeometryBuilderBehavior = 'reverse'
  const reorderedCold = makePage(definition)
  const beforeReorderedSolve = global.__audioWiringGeometryBuilderCalls
  reorderedCold.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeReorderedSolve + 2,
    'reversed direct-solver output must cold-build screen and report geometry')
  global.__audioWiringGeometryBuilderBehavior = 'normal'
  const reorderedMetrics = renderer.drawWiringDiagram(makeCanvasRecorder().context, reorderedCold.data.model,
    reorderedCold.data.diagramCanvasWidth, reorderedCold.data.diagramCanvasHeight,
    { layout: 'solder-wiring', avoidRail: true, selectedId: '', theme: reorderedCold.data.theme, showTitle: false })
  assertRouteEndpoints(reorderedMetrics, reorderedCold.data.model, 'reordered cold row result')
  const reorderedHot = makePage(definition)
  const beforeReorderedHit = global.__audioWiringGeometryBuilderCalls
  reorderedHot.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeReorderedHit,
    'stable connection IDs must hit both on-load slots regardless of row array order')
  const reorderedHotMetrics = renderer.drawWiringDiagram(makeCanvasRecorder().context, reorderedHot.data.model,
    reorderedHot.data.diagramCanvasWidth, reorderedHot.data.diagramCanvasHeight,
    { layout: 'solder-wiring', avoidRail: true, selectedId: '', theme: reorderedHot.data.theme, showTitle: false })
  assertRouteEndpoints(reorderedHotMetrics, reorderedHot.data.model, 'reordered warm row cache result')
  assert.deepStrictEqual(routeGeometry(reorderedHotMetrics), routeGeometry(reorderedMetrics),
    'the cache must preserve each route’s actual physical endpoint pins after order normalization')
  preferences = undefined

  for (const failure of ['key', 'get']) {
    preferences = undefined
    windowWidth = 375
    theme = 'light'
    global.__audioWiringGeometryCacheFailure = failure
    const cacheFailurePage = makePage(definition)
    const beforeFailure = global.__audioWiringGeometryBuilderCalls
    cacheFailurePage.onLoad({})
    global.__audioWiringGeometryCacheFailure = ''
    assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeFailure + 2,
      `${failure} cache exceptions must cold-solve both layouts`)
    assert.strictEqual(cacheFailurePage.data.diagramCanvasHeight, cold.data.diagramCanvasHeight,
      `${failure} cache exceptions must preserve the cold diagram height`)
    assert.strictEqual(cacheFailurePage.data.resultReportCanvasHeight, cold.data.resultReportCanvasHeight,
      `${failure} cache exceptions must preserve the cold report height`)
    const faultScreen = await renderFromOnReady(cacheFailurePage, `${failure}-fault`, renderer)
    assert.deepStrictEqual(commandsWithoutImageIdentity(faultScreen.recorder.commands),
      commandsWithoutImageIdentity(coldScreen.recorder.commands),
    `${failure} cache exceptions must preserve the real onReady Canvas output`)
    const faultReport = drawReport(cacheFailurePage, `${failure}-fault-report`)
    assert.deepStrictEqual(faultReport.result, coldReport.result)
    assert.deepStrictEqual(commandsWithoutImageIdentity(faultReport.recorder.commands),
      commandsWithoutImageIdentity(coldReport.recorder.commands),
    `${failure} cache exceptions must preserve report drawing`)
  }

  windowWidth = 379
  global.__audioWiringGeometryCacheFailure = 'store'
  const storeFailurePage = makePage(definition)
  const beforeStoreFailure = global.__audioWiringGeometryBuilderCalls
  storeFailurePage.onLoad({})
  global.__audioWiringGeometryCacheFailure = ''
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeStoreFailure + 1,
    'a store exception must occur after the uncached screen solver succeeds')
  assert.notStrictEqual(storeFailurePage.data.diagramCanvasHeight, 340,
    'a store exception must retain the solver-computed screen height')
  assert.strictEqual(storeFailurePage.data.resultReportCanvasHeight, cold.data.resultReportCanvasHeight)
  const storeRetry = makePage(definition)
  storeRetry.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeStoreFailure + 2,
    'a failed store must not leave an entry that suppresses the next screen solver call')
  assert.strictEqual(storeFailurePage.data.diagramCanvasHeight, storeRetry.data.diagramCanvasHeight)
  assert.strictEqual(storeFailurePage.data.resultReportCanvasHeight, storeRetry.data.resultReportCanvasHeight)
  const storeFailureScreen = await renderFromOnReady(storeFailurePage, 'store-fault', renderer)
  const storeRetryScreen = await renderFromOnReady(storeRetry, 'store-retry', renderer)
  assert.deepStrictEqual(commandsWithoutImageIdentity(storeFailureScreen.recorder.commands),
    commandsWithoutImageIdentity(storeRetryScreen.recorder.commands),
  'a store exception must preserve the rendered diagram')
  const storeFailureReport = drawReport(storeFailurePage, 'store-fault-report')
  const storeRetryReport = drawReport(storeRetry, 'store-retry-report')
  assert.deepStrictEqual(storeFailureReport.result, storeRetryReport.result)
  assert.deepStrictEqual(commandsWithoutImageIdentity(storeFailureReport.recorder.commands),
    commandsWithoutImageIdentity(storeRetryReport.recorder.commands),
  'a store exception must preserve the rendered report')
  windowWidth = 375

  let previousCalls = global.__audioWiringGeometryBuilderCalls
  theme = 'dark'
  const dark = makePage(definition)
  dark.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, previousCalls + 1,
    'theme changes must miss screen geometry while retaining theme-independent report geometry')
  previousCalls = global.__audioWiringGeometryBuilderCalls
  windowWidth = 390
  const wider = makePage(definition)
  wider.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, previousCalls + 1,
    'a changed screen width must miss while the unchanged report layout may hit')
  previousCalls = global.__audioWiringGeometryBuilderCalls
  windowWidth = 400
  const wideAgain = makePage(definition)
  wideAgain.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, previousCalls + 1,
    'a second distinct screen width must also miss')
  previousCalls = global.__audioWiringGeometryBuilderCalls
  windowWidth = 375
  theme = 'light'
  const originalWidthAgain = makePage(definition)
  originalWidthAgain.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, previousCalls + 1,
    'the bounded two-slot LRU must evict older screen widths instead of growing without bound')
  previousCalls = global.__audioWiringGeometryBuilderCalls
  preferences = makePreferences('stereo35', 'terminalBalanced')
  const changedInterface = makePage(definition)
  changedInterface.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, previousCalls + 2,
    'changing the factory endpoint combination must miss both screen and report geometry')

  const getterModel = { ...cold.data.model }
  let getterReads = 0
  Object.defineProperty(getterModel, 'title', {
    enumerable: true,
    configurable: true,
    get() { getterReads += 1; return cold.data.model.title },
  })
  const endRejectedScope = renderer.registerOnLoadSolderGeometryCacheModel(getterModel)
  endRejectedScope()
  assert.strictEqual(getterReads, 0, 'a getter-bearing model must be rejected from the cache without invoking it')
  previousCalls = global.__audioWiringGeometryBuilderCalls
  renderer.getDiagramHeight(283, getterModel, { layout: 'solder-wiring', avoidRail: true, theme: 'light' })
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, previousCalls + 1,
    'a model without an accepted factory lease must take the original solver path')

  const runNoCacheFailureCase = (behavior, outputId, inputId) => {
    preferences = makePreferences(outputId, inputId)
    global.__audioWiringGeometryBuilderBehavior = behavior
    const failing = makePage(definition)
    const beforeFailure = global.__audioWiringGeometryBuilderCalls
    failing.onLoad({})
    assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeFailure + 2,
      `${behavior} samples must attempt both initial layouts`)
    global.__audioWiringGeometryBuilderBehavior = 'normal'
    const retry = makePage(definition)
    retry.onLoad({})
    assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeFailure + 4,
      `${behavior} route results must not be written into the cross-model cache`)
  }
  runNoCacheFailureCase('error', 'xlrBalanced', 'rcaStereo')
  runNoCacheFailureCase('invalid', 'stereo35', 'tsMono')

  preferences = makePreferences('stereo635', 'rcaStereo')
  global.__audioWiringGeometryBuilderBehavior = 'throw'
  const solverFailure = makePage(definition)
  const beforeSolverFailure = global.__audioWiringGeometryBuilderCalls
  solverFailure.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeSolverFailure + 2)
  assert.strictEqual(solverFailure.data.diagramCanvasHeight, 340,
    'a solver exception must retain the existing diagram fallback')
  assert.strictEqual(solverFailure.data.resultReportCanvasHeight, 960,
    'a solver exception must retain the existing report fallback')
  global.__audioWiringGeometryBuilderBehavior = 'normal'
  const solverRetry = makePage(definition)
  solverRetry.onLoad({})
  assert.strictEqual(global.__audioWiringGeometryBuilderCalls, beforeSolverFailure + 4,
    'cache guards must not swallow solver exceptions or cache failed solver results')
  assert.notStrictEqual(solverRetry.data.diagramCanvasHeight, 340)
  assert.notStrictEqual(solverRetry.data.resultReportCanvasHeight, 960)

  process.stdout.write('Audio wiring geometry cache regressions passed.\n')
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
}).finally(() => {
  if (originalRendererCache) require.cache[rendererPath] = originalRendererCache
  else delete require.cache[rendererPath]
  if (originalPageCache) require.cache[pagePath] = originalPageCache
  else delete require.cache[pagePath]
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  if (previousBuilderCalls === undefined) delete global.__audioWiringGeometryBuilderCalls
  else global.__audioWiringGeometryBuilderCalls = previousBuilderCalls
  if (previousBuilderBehavior === undefined) delete global.__audioWiringGeometryBuilderBehavior
  else global.__audioWiringGeometryBuilderBehavior = previousBuilderBehavior
  if (previousCacheFailure === undefined) delete global.__audioWiringGeometryCacheFailure
  else global.__audioWiringGeometryCacheFailure = previousCacheFailure
})

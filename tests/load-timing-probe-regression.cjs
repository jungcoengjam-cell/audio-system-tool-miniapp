const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const performanceSource = fs.readFileSync(path.join(root, 'utils/performance.js'), 'utf8')

function makeHarness({ envVersion = 'develop', clockMode = 'performance' } = {}) {
  let time = 100
  let timerSerial = 0
  let dateThrows = false
  let dateValueOverride
  let performanceCallCount = 0
  let clockModeNow = clockMode
  const timers = new Map()
  const logs = []
  const sandbox = {
    module: { exports: {} },
    exports: {},
    wx: {
      getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
      getPerformance() {
        performanceCallCount += 1
        if (clockModeNow === 'inconsistent-instances') {
          const instanceTime = performanceCallCount % 2 ? time + 10000 : time - 10000
          return { now: () => instanceTime }
        }
        if (clockModeNow === 'nonfinite-instances') {
          const instanceTime = performanceCallCount % 2 ? time + 10000 : NaN
          return { now: () => instanceTime }
        }
        if (clockModeNow === 'throw') throw new Error('clock unavailable')
        if (clockModeNow === 'missing') return {}
        if (clockModeNow === 'invalid') return { now: () => NaN }
        return { now: () => time }
      },
    },
    Date: { now: () => {
      if (dateThrows) throw new Error('Date.now unavailable')
      return dateValueOverride === undefined ? time : dateValueOverride
    } },
    console: { info: (...args) => logs.push(args) },
    setTimeout(callback, delay) {
      const id = ++timerSerial
      timers.set(id, { callback, due: time + delay })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
  }
  vm.runInNewContext(performanceSource, sandbox, { filename: 'utils/performance.js' })
  return {
    probe: sandbox.module.exports,
    logs,
    advance(milliseconds, runTimers = false) {
      time += milliseconds
      if (!runTimers) return
      const dueTimers = [...timers.entries()].filter(([, timer]) => timer.due <= time)
      dueTimers.forEach(([id, timer]) => {
        timers.delete(id)
        timer.callback()
      })
    },
    setClockMode(value) { clockModeNow = value },
    setDateThrows(value) { dateThrows = value },
    setDateValue(value) { dateValueOverride = value },
    setTime(value) { time = value },
    getPerformanceCallCount() { return performanceCallCount },
  }
}

function latestSample(harness) {
  const record = harness.logs.filter(([message]) => String(message).includes('[PERF] 首页工具/首次加载/')).pop()
  return record && record[1]
}

function loadRoute(harness, route, pageRoute = route, { module = true } = {}) {
  const { probe } = harness
  assert.strictEqual(probe.beginToolLoadProbe(route), true, `start ${route}`)
  if (module) probe.markToolLoadStage(pageRoute, 'module')
  harness.advance(25)
  probe.markToolLoadStage(pageRoute, 'onLoad')
  harness.advance(75)
  probe.markToolLoadStage(pageRoute, 'onReady')
  return latestSample(harness)
}

function testEntryRoutes() {
  const entries = [
    ['/pages/audio-wiring/index', '接线助手'],
    ['/pages/project-wiring/index', '通道与线缆'],
    ['/pages/dmx-address/dmx-address', '灯具编址'],
  ]
  entries.forEach(([route]) => {
    const harness = makeHarness()
    const sample = loadRoute(harness, route)
    assert(sample, `missing sample for ${route}`)
    assert.strictEqual(sample.tapToModuleMs, 0)
    assert.strictEqual(sample.moduleToOnLoadMs, 25)
    assert.strictEqual(sample.onLoadToReadyMs, 75)
    assert.strictEqual(sample.tapToReadyMs, 100)
    assert.strictEqual(sample.moduleMarkers[0].state, 'observed')
    assert.strictEqual(sample.clock, 'Date.now (ms-resolution primary)')
    assert.strictEqual(harness.getPerformanceCallCount(), 0, 'load probe uses one clock source and does not reacquire wx performance clocks')
  })

  const warm = makeHarness()
  const warmSample = loadRoute(warm, '/pages/audio-wiring/index', undefined, { module: false })
  assert.strictEqual(warmSample.tapToModuleMs, null)
  assert.strictEqual(warmSample.moduleToOnLoadMs, null)
  assert.strictEqual(warmSample.moduleMarkers[0].elapsedMs, null)
  assert.match(warmSample.moduleMarkers[0].state, /possible-cache-reuse/)
}

function testControlProtocolRedirectStages() {
  const harness = makeHarness()
  const { probe } = harness
  const route = '/pages/control-protocol/index'
  assert.strictEqual(probe.beginToolLoadProbe(route), true)
  probe.markToolLoadStage(route, 'module')
  harness.advance(10)
  probe.markToolLoadStage(route, 'onLoad')
  harness.advance(20)
  probe.markToolLoadStage('/pages/control-protocol/detail', 'module')
  harness.advance(30)
  probe.markToolLoadStage('/pages/control-protocol/detail', 'onLoad')
  harness.advance(40)
  probe.markToolLoadStage('/pages/control-protocol/detail', 'onReady')
  const sample = latestSample(harness)
  assert(sample)
  assert.deepStrictEqual(Array.from(sample.moduleMarkers, (item) => item.page), ['控制协议中转页', '控制协议资料页'])
  assert.strictEqual(sample.tapToReadyMs, 100)
  assert.deepStrictEqual(Array.from(sample.stages, (item) => `${item.page}/${item.phase}`), [
    '控制协议中转页/module',
    '控制协议中转页/onLoad',
    '控制协议资料页/module',
    '控制协议资料页/onLoad',
    '控制协议资料页/onReady',
  ])
  assert.strictEqual(sample.onLoadToReadyMs, 40)

  const marks = []
  let registeredPage
  const redirects = []
  const indexSandbox = {
    module: { exports: {} },
    exports: {},
    Page(definition) { registeredPage = definition },
    wx: { redirectTo(options) { redirects.push(options) } },
    require(request) {
      assert.strictEqual(request, '../../utils/performance')
      return { markToolLoadStage: (...args) => marks.push(args) }
    },
  }
  const indexSource = fs.readFileSync(path.join(root, 'pages/control-protocol/index.js'), 'utf8')
  vm.runInNewContext(indexSource, indexSandbox, { filename: 'pages/control-protocol/index.js' })
  registeredPage.onLoad({ referenceId: 'fixture' })
  assert.deepStrictEqual(marks, [
    ['/pages/control-protocol/index', 'module'],
    ['/pages/control-protocol/index', 'onLoad'],
  ])
  assert.strictEqual(redirects.length, 1)
  assert.strictEqual(redirects[0].url, '/pages/control-protocol/detail?referenceId=fixture')
}

function testNavigationLifecycleAndInvalidation() {
  const hiddenByNormalNavigation = makeHarness()
  hiddenByNormalNavigation.probe.beginToolLoadProbe('/pages/audio-wiring/index')
  hiddenByNormalNavigation.probe.markToolLoadHomeHidden()
  hiddenByNormalNavigation.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
  hiddenByNormalNavigation.advance(25)
  hiddenByNormalNavigation.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad')
  hiddenByNormalNavigation.advance(75)
  hiddenByNormalNavigation.probe.markToolLoadStage('/pages/audio-wiring/index', 'onReady')
  const sample = latestSample(hiddenByNormalNavigation)
  assert(sample, 'the expected home-page hide during navigator navigation must not cancel timing')

  const returnedEarly = makeHarness()
  returnedEarly.probe.beginToolLoadProbe('/pages/audio-wiring/index')
  returnedEarly.probe.markToolLoadHomeHidden()
  returnedEarly.probe.markToolLoadHomeShown()
  returnedEarly.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
  returnedEarly.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad')
  returnedEarly.probe.markToolLoadStage('/pages/audio-wiring/index', 'onReady')
  assert.strictEqual(latestSample(returnedEarly), undefined, 'returning to tools before readiness must cancel the attempt')
  loadRoute(returnedEarly, '/pages/audio-wiring/index')
  assert(latestSample(returnedEarly), 'a later clean click must be measurable')

  const otherRoute = makeHarness()
  otherRoute.probe.beginToolLoadProbe('/pages/audio-wiring/index')
  assert.strictEqual(otherRoute.probe.beginToolLoadProbe('/pages/cable/cable'), false)
  otherRoute.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
  otherRoute.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad')
  otherRoute.probe.markToolLoadStage('/pages/audio-wiring/index', 'onReady')
  assert.strictEqual(latestSample(otherRoute), undefined, 'a non-target tap must clear the previous attempt')

  for (const route of ['/pages/audio-wiring/index', '/pages/project-wiring/index']) {
    const overlap = makeHarness()
    overlap.probe.beginToolLoadProbe('/pages/audio-wiring/index')
    overlap.probe.beginToolLoadProbe(route)
    overlap.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
    overlap.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad')
    overlap.probe.markToolLoadStage('/pages/audio-wiring/index', 'onReady')
    overlap.probe.markToolLoadStage('/pages/project-wiring/index', 'module')
    overlap.probe.markToolLoadStage('/pages/project-wiring/index', 'onLoad')
    overlap.probe.markToolLoadStage('/pages/project-wiring/index', 'onReady')
    assert.strictEqual(latestSample(overlap), undefined, 'overlapping navigation must not assign an event to either click')
    loadRoute(overlap, '/pages/project-wiring/index')
    assert(latestSample(overlap), 'a settled overlap must allow a new click')
  }

  const timedOut = makeHarness()
  timedOut.probe.beginToolLoadProbe('/pages/dmx-address/dmx-address')
  timedOut.advance(30001, true)
  timedOut.probe.markToolLoadStage('/pages/dmx-address/dmx-address', 'module')
  timedOut.probe.markToolLoadStage('/pages/dmx-address/dmx-address', 'onLoad')
  timedOut.probe.markToolLoadStage('/pages/dmx-address/dmx-address', 'onReady')
  assert.strictEqual(latestSample(timedOut), undefined, 'a timed-out attempt must not become a sample')
  loadRoute(timedOut, '/pages/dmx-address/dmx-address')
  assert(latestSample(timedOut))
}

function testClockFailuresAndEnvironmentGating() {
  const fallback = makeHarness({ clockMode: 'throw' })
  const fallbackSample = loadRoute(fallback, '/pages/dmx-address/dmx-address')
  assert.strictEqual(fallbackSample.clock, 'Date.now (ms-resolution primary)')
  assert.strictEqual(fallback.getPerformanceCallCount(), 0)

  const invalidClockFallsBack = makeHarness({ clockMode: 'invalid' })
  const invalidSample = loadRoute(invalidClockFallsBack, '/pages/project-wiring/index')
  assert.strictEqual(invalidSample.clock, 'Date.now (ms-resolution primary)')
  assert.strictEqual(invalidClockFallsBack.getPerformanceCallCount(), 0)

  const brokenAfterStart = makeHarness()
  brokenAfterStart.probe.beginToolLoadProbe('/pages/audio-wiring/index')
  brokenAfterStart.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
  brokenAfterStart.setDateValue(NaN)
  assert.doesNotThrow(() => brokenAfterStart.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad'))
  assert.strictEqual(latestSample(brokenAfterStart), undefined)
  assert(brokenAfterStart.logs.some(([message]) => String(message).includes('clock-error')),
    'a non-finite Date.now read after starting must discard the sample explicitly')

  const backwardsClock = makeHarness()
  backwardsClock.probe.beginToolLoadProbe('/pages/audio-wiring/index')
  backwardsClock.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
  backwardsClock.advance(5)
  backwardsClock.setTime(99)
  assert.doesNotThrow(() => backwardsClock.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad'))
  assert.strictEqual(latestSample(backwardsClock), undefined, 'a backward clock must not be clamped into a valid sample')
  assert(backwardsClock.logs.some(([message]) => String(message).includes('clock-error')))

  const throwingClockAfterStart = makeHarness()
  throwingClockAfterStart.probe.beginToolLoadProbe('/pages/audio-wiring/index')
  throwingClockAfterStart.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
  throwingClockAfterStart.setDateThrows(true)
  assert.doesNotThrow(() => throwingClockAfterStart.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad'))
  assert.strictEqual(latestSample(throwingClockAfterStart), undefined)
  assert(throwingClockAfterStart.logs.some(([message]) => String(message).includes('clock-error')))

  const brokenDate = makeHarness({ clockMode: 'missing' })
  brokenDate.setDateThrows(true)
  assert.doesNotThrow(() => brokenDate.probe.beginToolLoadProbe('/pages/audio-wiring/index'))
  assert.strictEqual(brokenDate.getPerformanceCallCount(), 0)
  brokenDate.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
  brokenDate.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad')
  brokenDate.probe.markToolLoadStage('/pages/audio-wiring/index', 'onReady')
  assert.strictEqual(latestSample(brokenDate), undefined)

  for (const envVersion of ['release', 'trial']) {
    const harness = makeHarness({ envVersion })
    harness.probe.beginToolLoadProbe('/pages/audio-wiring/index')
    harness.probe.markToolLoadStage('/pages/audio-wiring/index', 'module')
    harness.probe.markToolLoadStage('/pages/audio-wiring/index', 'onLoad')
    harness.probe.markToolLoadStage('/pages/audio-wiring/index', 'onReady')
    if (envVersion === 'release') assert.strictEqual(harness.logs.length, 0, 'production must not emit probe logs')
    else assert(latestSample(harness), 'trial builds should retain the development probe')
  }
}

function testToolsTapBinding() {
  const harness = makeHarness()
  let page
  const toolsSource = fs.readFileSync(path.join(root, 'pages/tools/tools.js'), 'utf8')
  const dependencies = {
    '../../utils/tool-registry': { CATEGORY_FILTERS: ['全部'] },
    '../../utils/haptics': { vibrate() {} },
    '../../utils/primary-navigation': { activatePrimaryTab: () => true },
    '../../utils/tool-visibility': { readToolVisibility: () => ({ ok: true }), getVisibleTools: () => [] },
    '../../utils/performance': harness.probe,
  }
  vm.runInNewContext(toolsSource, {
    Page(definition) { page = definition },
    require(request) { return dependencies[request] },
  }, { filename: 'pages/tools/tools.js' })
  page.onToolNavigationTap({ currentTarget: { dataset: { loadRoute: '/pages/dmx-address/dmx-address' } } })
  page.onHide()
  const { probe } = harness
  probe.markToolLoadStage('/pages/dmx-address/dmx-address', 'module')
  harness.advance(25)
  probe.markToolLoadStage('/pages/dmx-address/dmx-address', 'onLoad')
  harness.advance(75)
  probe.markToolLoadStage('/pages/dmx-address/dmx-address', 'onReady')
  assert(latestSample(harness), 'the home navigator handler must start the measured interaction')

  const wxml = fs.readFileSync(path.join(root, 'pages/tools/tools.wxml'), 'utf8')
  assert.match(wxml, /<navigator[^>]*url="\{\{item\.path\}\}"[^>]*data-load-route="\{\{item\.path\}\}"[^>]*bindtap="onToolNavigationTap"/)
  assert.doesNotMatch(wxml, /catchtap="onToolNavigationTap"/)
}

function testSourceMarkers() {
  const markers = [
    ['pages/audio-wiring/index.js', '/pages/audio-wiring/index'],
    ['pages/project-wiring/index.js', '/pages/project-wiring/index', false],
    ['pages/dmx-address/dmx-address.js', '/pages/dmx-address/dmx-address'],
    ['pages/control-protocol/index.js', '/pages/control-protocol/index'],
    ['pages/control-protocol/detail.js', '/pages/control-protocol/detail'],
  ]
  markers.forEach(([relativePath, route, hasOnLoad = true]) => {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    assert(source.includes(`markToolLoadStage('${route}', 'module')`), `${relativePath} needs an early module marker`)
    if (hasOnLoad) assert(source.includes(`markToolLoadStage('${route}', 'onLoad')`), `${relativePath} needs an onLoad marker`)
  })
  const lifecycleSource = fs.readFileSync(path.join(root, 'pages/project-wiring/page-lifecycle.js'), 'utf8')
  assert(lifecycleSource.includes("markToolLoadStage('/pages/project-wiring/index', 'onLoad')"))
  assert(lifecycleSource.includes("markToolLoadStage('/pages/project-wiring/index', 'onReady')"))
  assert(fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.js'), 'utf8').includes("markToolLoadStage('/pages/dmx-address/dmx-address', 'onReady')"))
}

testEntryRoutes()
testControlProtocolRedirectStages()
testNavigationLifecycleAndInvalidation()
testClockFailuresAndEnvironmentGating()
testToolsTapBinding()
testSourceMarkers()
console.log('Load timing probe regression passed.')

function testControlProtocolDirectEntryProbe() {
  const route = '/pages/control-protocol/detail'
  const cold = makeHarness()
  assert.strictEqual(cold.probe.beginToolLoadProbe(route), true, 'the direct detail route must retain the controlProtocol probe ID')
  cold.probe.markToolLoadStage(route, 'module')
  cold.advance(12)
  cold.probe.markToolLoadStage(route, 'onLoad')
  cold.advance(34)
  cold.probe.markToolLoadStage(route, 'onReady')
  const coldSample = latestSample(cold)
  assert(coldSample)
  assert.strictEqual(coldSample.entry, 'controlProtocol')
  assert.strictEqual(coldSample.entryRoute, route)
  assert.strictEqual(coldSample.tapToModuleMs, 0)
  assert.strictEqual(coldSample.moduleToOnLoadMs, 12)
  assert.strictEqual(coldSample.onLoadToReadyMs, 34)
  assert.strictEqual(coldSample.tapToReadyMs, 46)
  assert.deepStrictEqual(Array.from(coldSample.moduleMarkers, (item) => item.page), ['控制协议资料页'],
    'a direct entry must not misreport the skipped index as cached')
  assert.strictEqual(coldSample.moduleMarkers[0].state, 'observed')

  const warm = makeHarness()
  assert.strictEqual(warm.probe.beginToolLoadProbe(route), true)
  warm.advance(25)
  warm.probe.markToolLoadStage(route, 'onLoad')
  warm.advance(75)
  warm.probe.markToolLoadStage(route, 'onReady')
  const warmSample = latestSample(warm)
  assert(warmSample)
  assert.strictEqual(warmSample.entryRoute, route)
  assert.strictEqual(warmSample.tapToModuleMs, null)
  assert.strictEqual(warmSample.moduleMarkers.length, 1)
  assert.strictEqual(warmSample.moduleMarkers[0].page, '控制协议资料页')
  assert.match(warmSample.moduleMarkers[0].state, /possible-cache-reuse/)
  assert.strictEqual(warmSample.onLoadToReadyMs, 75)

  const legacyWarm = makeHarness()
  const indexRoute = '/pages/control-protocol/index'
  assert.strictEqual(legacyWarm.probe.beginToolLoadProbe(indexRoute), true)
  legacyWarm.advance(10)
  legacyWarm.probe.markToolLoadStage(indexRoute, 'onLoad')
  legacyWarm.advance(20)
  legacyWarm.probe.markToolLoadStage(route, 'onLoad')
  legacyWarm.advance(30)
  legacyWarm.probe.markToolLoadStage(route, 'onReady')
  const legacySample = latestSample(legacyWarm)
  assert(legacySample)
  assert.strictEqual(legacySample.entryRoute, indexRoute)
  assert.deepStrictEqual(Array.from(legacySample.moduleMarkers, (item) => item.page), ['控制协议中转页', '控制协议资料页'])
  assert(legacySample.moduleMarkers.every((item) => /possible-cache-reuse/.test(item.state)))
  assert.strictEqual(legacySample.tapToReadyMs, 60)
  assert.strictEqual(legacySample.onLoadToReadyMs, 30)

  const multiSample = makeHarness()
  multiSample.probe.beginToolLoadProbe(route)
  multiSample.probe.markToolLoadStage(route, 'module')
  multiSample.probe.markToolLoadStage(route, 'onLoad')
  multiSample.probe.markToolLoadStage(route, 'onReady')
  multiSample.probe.beginToolLoadProbe(indexRoute)
  multiSample.probe.markToolLoadStage(indexRoute, 'module')
  multiSample.probe.markToolLoadStage(indexRoute, 'onLoad')
  multiSample.probe.markToolLoadStage(route, 'module')
  multiSample.probe.markToolLoadStage(route, 'onLoad')
  multiSample.probe.markToolLoadStage(route, 'onReady')
  const measurements = multiSample.logs.filter(([message]) => String(message).includes('[PERF] 首页工具/首次加载/controlProtocol：'))
  assert.strictEqual(measurements.length, 2, 'direct and compatibility entries must both continue producing the existing probe ID')
  assert.deepStrictEqual(Array.from(multiSample.probe.getPerformanceSummary('首页工具/首次加载/controlProtocol'), (item) => item.count), [2])

  const production = makeHarness({ envVersion: 'release' })
  assert.strictEqual(production.probe.beginToolLoadProbe(route), false)
  assert.strictEqual(production.probe.markToolLoadStage(route, 'onLoadEnd'), false)
  assert.strictEqual(production.logs.length, 0, 'production must ignore the new direct-entry and onLoadEnd markers')

  const noId = makeHarness()
  assert.strictEqual(noId.probe.beginToolLoadProbe('/pages/control-protocol/untracked'), false)
  assert.strictEqual(noId.probe.markToolLoadStage(route, 'onLoadEnd'), false)
  assert.strictEqual(noId.logs.length, 0, 'an unregistered path must not create a sample')
}

function testControlProtocolEntryCompatibilityAndReturn() {
  const registry = require(path.join(root, 'utils/tool-registry'))
  const directRoute = registry.getTool('controlProtocol').path
  assert.strictEqual(directRoute, '/pages/control-protocol/detail')
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert(appConfig.subPackages.some((pack) => pack.root === 'pages/control-protocol' && pack.pages.includes('detail')),
    'the direct destination must remain registered in the control-protocol subpackage')
  const toolsWxml = fs.readFileSync(path.join(root, 'pages/tools/tools.wxml'), 'utf8')
  assert.match(toolsWxml, /<navigator[^>]*url="\{\{item\.path\}\}"/)

  const indexSource = fs.readFileSync(path.join(root, 'pages/control-protocol/index.js'), 'utf8')
  function captureIndexPage(onRedirect) {
    let page
    const marks = []
    vm.runInNewContext(indexSource, {
      module: { exports: {} },
      exports: {},
      Page(definition) { page = definition },
      wx: { redirectTo(options) { onRedirect(options) } },
      require(request) {
        assert.strictEqual(request, '../../utils/performance')
        return { markToolLoadStage: (...args) => marks.push(args) }
      },
    }, { filename: 'pages/control-protocol/index.js' })
    return { page, marks }
  }

  const noQueryRedirects = []
  captureIndexPage((options) => noQueryRedirects.push(options)).page.onLoad({})
  assert.strictEqual(noQueryRedirects.length, 1)
  assert.strictEqual(noQueryRedirects[0].url, '/pages/control-protocol/detail',
    'the legacy index route must keep its no-query redirect')

  const bothQueryRedirects = []
  const referenceId = 'ref ?/台'
  const appearanceGroupId = 'group#1'
  const { page: legacyIndex } = captureIndexPage((options) => bothQueryRedirects.push(options))
  legacyIndex.onLoad({ referenceId, appearanceGroupId, ignored: 'discard-me' })
  assert.strictEqual(bothQueryRedirects.length, 1)
  assert.strictEqual(bothQueryRedirects[0].url,
    `/pages/control-protocol/detail?referenceId=${encodeURIComponent(referenceId)}&appearanceGroupId=${encodeURIComponent(appearanceGroupId)}`,
    'the old route must keep forwarding both documented query keys and ignore unknown keys')

  const detailPath = path.join(root, 'pages/control-protocol/detail.js')
  const resolvedDetailPath = require.resolve(detailPath)
  const oldPage = global.Page
  const oldWx = global.wx
  let detailPage
  const storage = Object.create(null)
  try {
    delete require.cache[resolvedDetailPath]
    global.Page = (definition) => { detailPage = definition }
    global.wx = {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
      getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => { storage[key] = value },
      getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }),
    }
    require(resolvedDetailPath)
    assert(detailPage, 'the direct destination page must register')

    const defaultState = {
      ...detailPage,
      data: { ...detailPage.data },
      setData(patch, callback) {
        this.data = { ...this.data, ...patch }
        if (callback) callback()
      },
    }
    detailPage.onLoad.call(defaultState, {})
    assert(defaultState.data.currentDeviceRef,
      'a direct no-query tool entry must retain the existing remembered-or-first-available selection')
    assert(defaultState.data.deviceTitle)

    function routeOnly(url) { return String(url).split('?')[0] }
    function wxForStack(stack) {
      return {
        navigateBack({ delta = 1, fail } = {}) {
          if (stack.length > delta) stack.splice(stack.length - delta, delta)
          else if (typeof fail === 'function') fail()
        },
        redirectTo({ url }) {
          if (stack.length) stack[stack.length - 1] = routeOnly(url)
          else stack.push(routeOnly(url))
        },
      }
    }

    const directStack = ['/pages/tools/tools', directRoute]
    global.wx = wxForStack(directStack)
    detailPage.returnToGallery.call(defaultState)
    assert.deepStrictEqual(directStack, ['/pages/tools/tools'],
      'direct detail navigation must return to the same tools page')

    const legacyStack = ['/pages/tools/tools', '/pages/control-protocol/index']
    const legacyRedirects = []
    const legacyWithStack = captureIndexPage(({ url }) => {
      legacyRedirects.push(url)
      legacyStack[legacyStack.length - 1] = routeOnly(url)
    })
    legacyWithStack.page.onLoad({ referenceId, appearanceGroupId })
    assert.deepStrictEqual(legacyStack, ['/pages/tools/tools', '/pages/control-protocol/detail'],
      'the compatibility redirect must replace index and preserve the underlying tools page')
    assert(legacyRedirects[0].includes(`referenceId=${encodeURIComponent(referenceId)}`))
    assert(legacyRedirects[0].includes(`appearanceGroupId=${encodeURIComponent(appearanceGroupId)}`))
    global.wx = wxForStack(legacyStack)
    detailPage.returnToGallery.call(defaultState)
    assert.deepStrictEqual(legacyStack, ['/pages/tools/tools'],
      'the old redirect route and direct route must share the same return behavior')

    const emptyStack = ['/pages/control-protocol/detail']
    global.wx = wxForStack(emptyStack)
    detailPage.returnToGallery.call(defaultState)
    assert.deepStrictEqual(emptyStack, ['/pages/control-protocol/index'],
      'the existing no-back-stack compatibility fallback must remain intact')
  } finally {
    delete require.cache[resolvedDetailPath]
    global.Page = oldPage
    global.wx = oldWx
  }
}

function testAudioWiringLoadEndStages() {
  const harness = makeHarness()
  const route = '/pages/audio-wiring/index'
  assert.strictEqual(harness.probe.beginToolLoadProbe(route), true)
  harness.probe.markToolLoadStage(route, 'module')
  harness.probe.markToolLoadStage(route, 'onLoad')
  harness.advance(123)
  assert.strictEqual(harness.probe.markToolLoadStage(route, 'onLoadEnd'), true)
  harness.advance(456)
  harness.probe.markToolLoadStage(route, 'onReady')
  const sample = latestSample(harness)
  assert(sample)
  assert.strictEqual(sample.tapToReadyMs, 579)
  assert.strictEqual(sample.onLoadToReadyMs, 579, 'the existing onLoad-to-ready field must remain unchanged')
  assert.strictEqual(sample.onLoadToEndMs, 123)
  assert.strictEqual(sample.onLoadEndToReadyMs, 456)
  assert.deepStrictEqual(Array.from(sample.stages, (item) => item.phase), ['module', 'onLoad', 'onLoadEnd', 'onReady'])

  const source = fs.readFileSync(path.join(root, 'pages/audio-wiring/index.js'), 'utf8')
  const onLoadStart = source.indexOf('  onLoad(options = {}) {')
  const onLoadMark = source.indexOf("markToolLoadStage('/pages/audio-wiring/index', 'onLoad')", onLoadStart)
  const setDataLookup = source.indexOf('const setDataMethod = this.setData', onLoadStart)
  const setDataCall = source.indexOf('setDataMethod.call(this, initialData, onInitialDataSet)', setDataLookup)
  const setDataCallEnd = source.indexOf("markToolLoadStage('/pages/audio-wiring/index', 'audioSetDataEnd')", setDataCall)
  const endMark = source.indexOf("markToolLoadStage('/pages/audio-wiring/index', 'onLoadEnd')", setDataCallEnd)
  const onReadyStart = source.indexOf('  onReady() {', endMark)
  const readyMark = source.indexOf("markToolLoadStage('/pages/audio-wiring/index', 'onReady')", onReadyStart)
  const renderCall = source.indexOf('this.renderDiagram()', readyMark)
  assert(onLoadStart >= 0 && onLoadMark > onLoadStart && setDataCall > onLoadMark
    && setDataLookup > onLoadMark && setDataCallEnd > setDataCall && endMark > setDataCallEnd && onReadyStart > endMark
    && readyMark > onReadyStart && renderCall > readyMark,
  'audio onLoadEnd must follow the initial setData call and onReady must remain before Canvas drawing')
}

testControlProtocolDirectEntryProbe()
testControlProtocolEntryCompatibilityAndReturn()
testAudioWiringLoadEndStages()
console.log('Direct-entry and onLoadEnd regressions passed.')

function testAudioDetailedOnLoadTiming() {
  const route = '/pages/audio-wiring/index'
  const durations = [2, 3, 4, 5, 6, 7]
  const internalStages = [
    ['audioEditorAttachStart', 'audioEditorAttachEnd'],
    ['audioWindowInfoStart', 'audioWindowInfoEnd'],
    ['audioPreferenceReadStart', 'audioPreferenceReadEnd'],
    ['audioModelBuildStart', 'audioModelBuildEnd'],
    ['audioThemeStart', 'audioThemeEnd'],
  ]

  function recordAudioSample(harness, { cold = true } = {}) {
    const { probe } = harness
    assert.strictEqual(probe.beginToolLoadProbe(route), true)
    if (cold) probe.markToolLoadStage(route, 'module')
    harness.advance(25)
    probe.markToolLoadStage(route, 'onLoad')
    internalStages.forEach(([start, end], index) => {
      assert.strictEqual(probe.markToolLoadStage(route, start), true, `${start} is audio-only and supported`)
      harness.advance(durations[index])
      assert.strictEqual(probe.markToolLoadStage(route, end), true, `${end} is audio-only and supported`)
    })
    assert.strictEqual(probe.markToolLoadStage(route, 'audioDataPrepareStart'), true)
    harness.advance(durations[5])
    assert.strictEqual(probe.markToolLoadStage(route, 'onLoadEnd'), true)
    harness.advance(8)
    probe.markToolLoadStage(route, 'onReady')
    return latestSample(harness)
  }

  const cold = makeHarness({ clockMode: 'inconsistent-instances' })
  const coldSample = recordAudioSample(cold)
  assert(coldSample)
  assert.strictEqual(cold.getPerformanceCallCount(), 0,
    'inconsistent wx performance instances must not be mixed into a single load sample')
  assert.strictEqual(coldSample.clock, 'Date.now (ms-resolution primary)')
  assert.strictEqual(coldSample.tapToModuleMs, 0)
  assert.strictEqual(coldSample.moduleToOnLoadMs, 25)
  assert.strictEqual(coldSample.tapToReadyMs, 60)
  assert.strictEqual(coldSample.onLoadToEndMs, 27)
  assert.strictEqual(coldSample.onLoadEndToReadyMs, 8)
  assert.strictEqual(coldSample.onLoadToReadyMs, 35)
  assert.strictEqual(coldSample.editorAttachMs, 2)
  assert.strictEqual(coldSample.windowInfoMs, 3)
  assert.strictEqual(coldSample.preferenceReadMs, 4)
  assert.strictEqual(coldSample.modelBuildMs, 5)
  assert.strictEqual(coldSample.themeMs, 6)
  assert.strictEqual(coldSample.initialDataMs, 7)
  assert.strictEqual(coldSample.unmeasuredOnLoadMs, 0)
  assert(coldSample.notes.some((note) => note.includes('毫秒精度')),
    'the summary must state that the load clock has no sub-millisecond precision')
  assert.deepStrictEqual(Array.from(coldSample.stages, (stage) => stage.phase), [
    'module', 'onLoad',
    'audioEditorAttachStart', 'audioEditorAttachEnd',
    'audioWindowInfoStart', 'audioWindowInfoEnd',
    'audioPreferenceReadStart', 'audioPreferenceReadEnd',
    'audioModelBuildStart', 'audioModelBuildEnd',
    'audioThemeStart', 'audioThemeEnd',
    'audioDataPrepareStart', 'onLoadEnd', 'onReady',
  ])
  assert.strictEqual(Object.hasOwn(coldSample, 'preferences'), false,
    'the diagnostic record must not include stored preference values')

  const warm = makeHarness({ envVersion: 'trial', clockMode: 'nonfinite-instances' })
  const warmSample = recordAudioSample(warm, { cold: false })
  assert(warmSample)
  assert.strictEqual(warm.getPerformanceCallCount(), 0,
    'non-finite values from separate wx performance objects must not corrupt the warm sample')
  assert.strictEqual(warmSample.tapToModuleMs, null)
  assert.strictEqual(warmSample.moduleMarkers[0].elapsedMs, null)
  assert.match(warmSample.moduleMarkers[0].state, /possible-cache-reuse/)
  assert.strictEqual(warmSample.editorAttachMs, 2)
  assert(warm.logs.some(([message]) => String(message).includes('[PERF] 首页工具/首次加载/')),
    'trial builds should emit the same detailed timings')

  const missingStages = makeHarness()
  missingStages.probe.beginToolLoadProbe(route)
  missingStages.probe.markToolLoadStage(route, 'onLoad')
  missingStages.probe.markToolLoadStage(route, 'onLoadEnd')
  missingStages.probe.markToolLoadStage(route, 'onReady')
  const incomplete = latestSample(missingStages)
  assert(incomplete)
  for (const key of [
    'editorAttachMs', 'windowInfoMs', 'preferenceReadMs', 'modelBuildMs', 'themeMs', 'initialDataMs',
    'diagramHeightMs', 'reportHeightMs', 'setDataCallMs', 'initialDataResidualMs', 'unmeasuredOnLoadMs',
  ]) {
    assert.strictEqual(incomplete[key], null, `${key} must be null when its markers are missing`)
  }

  const otherRoute = makeHarness()
  assert.strictEqual(otherRoute.probe.beginToolLoadProbe('/pages/project-wiring/index'), true)
  assert.strictEqual(otherRoute.probe.markToolLoadStage('/pages/project-wiring/index', 'audioEditorAttachStart'), false,
    'audio-only phases must be rejected for other routes')
  assert.strictEqual(otherRoute.probe.markToolLoadStage('/pages/project-wiring/index', 'audioDiagramHeightStart'), false,
    'audio initial-data phases must be rejected for other routes')
  otherRoute.probe.markToolLoadStage('/pages/project-wiring/index', 'onLoad')
  otherRoute.probe.markToolLoadStage('/pages/project-wiring/index', 'onReady')
  const otherSample = latestSample(otherRoute)
  assert(otherSample)
  assert.strictEqual(Object.hasOwn(otherSample, 'editorAttachMs'), false)

  const noAttempt = makeHarness()
  assert.strictEqual(noAttempt.probe.markToolLoadStage(route, 'audioEditorAttachStart'), false)
  assert.strictEqual(noAttempt.logs.length, 0)

  const release = makeHarness({ envVersion: 'release' })
  assert.strictEqual(release.probe.beginToolLoadProbe(route), false)
  assert.strictEqual(release.probe.markToolLoadStage(route, 'audioEditorAttachStart'), false)
  assert.strictEqual(release.logs.length, 0, 'production must not collect or log audio-only timings')

  const brokenClock = makeHarness()
  brokenClock.probe.beginToolLoadProbe(route)
  brokenClock.probe.markToolLoadStage(route, 'onLoad')
  brokenClock.setClockMode('invalid')
  assert.doesNotThrow(() => brokenClock.probe.markToolLoadStage(route, 'audioEditorAttachStart'))
  assert.strictEqual(latestSample(brokenClock), undefined,
    'an invalid clock should cancel diagnostics without changing page behavior')

  const source = fs.readFileSync(path.join(root, 'pages/audio-wiring/index.js'), 'utf8')
  const onLoadStart = source.indexOf('  onLoad(options = {}) {')
  const attachStart = source.indexOf("markToolLoadStage('/pages/audio-wiring/index', 'audioEditorAttachStart')", onLoadStart)
  const attachCall = source.indexOf("attachResultEditor(this, 'audioWiring', options)", attachStart)
  const attachEnd = source.indexOf("markToolLoadStage('/pages/audio-wiring/index', 'audioEditorAttachEnd')", attachCall)
  assert(onLoadStart >= 0 && attachStart > onLoadStart && attachCall > attachStart && attachEnd > attachCall,
    'editor timing markers must bracket the existing attachResultEditor call')

  const windowStart = source.indexOf('function getWindowWidth()')
  const windowStartMark = source.indexOf("'audioWindowInfoStart'", windowStart)
  const windowCall = source.indexOf('const info = typeof wx.getWindowInfo', windowStart)
  const windowEndMark = source.indexOf("'audioWindowInfoEnd'", windowCall)
  const windowEnd = source.indexOf('function rectOf', windowStart)
  assert(windowStart >= 0 && windowStartMark > windowStart && windowCall > windowStartMark
    && windowEndMark > windowCall && windowEnd > windowEndMark,
  'window timing markers must bracket the existing window-info/fallback read')

  const preferenceStart = source.indexOf("'audioPreferenceReadStart'", onLoadStart)
  const storageCall = source.indexOf('wx.getStorageSync(WIRING_PREFERENCE_STORAGE_KEY)', preferenceStart)
  const preferenceEnd = source.indexOf("'audioPreferenceReadEnd'", storageCall)
  const modelStart = source.indexOf("'audioModelBuildStart'", preferenceEnd)
  const modelCall = source.indexOf('getSafeWiringModel(outputId, inputId, selections, null)', modelStart)
  const modelEnd = source.indexOf("'audioModelBuildEnd'", modelCall)
  const themeStart = source.indexOf("'audioThemeStart'", modelEnd)
  const themeCall = source.indexOf('getCurrentTheme()', themeStart)
  const themeEnd = source.indexOf("'audioThemeEnd'", themeCall)
  const dataStart = source.indexOf("'audioDataPrepareStart'", themeEnd)
  const reportOptions = source.indexOf('const reportOptions = getReportOptions', dataStart)
  assert(preferenceStart >= 0 && storageCall > preferenceStart && preferenceEnd > storageCall
    && modelStart > preferenceEnd && modelCall > modelStart && modelEnd > modelCall
    && themeStart > modelEnd && themeCall > themeStart && themeEnd > themeCall
    && dataStart > themeEnd && reportOptions > dataStart,
  'preference, model, theme, and initial-data timing markers must follow their operation order')
}

testAudioDetailedOnLoadTiming()
console.log('Audio onLoad breakdown regressions passed.')

function testAudioInitialDataSubstages() {
  const route = '/pages/audio-wiring/index'
  const harness = makeHarness()
  assert.strictEqual(harness.probe.beginToolLoadProbe(route), true)
  harness.probe.markToolLoadStage(route, 'module')
  harness.advance(25)
  harness.probe.markToolLoadStage(route, 'onLoad')

  const outerStages = [
    ['audioEditorAttachStart', 'audioEditorAttachEnd', 2],
    ['audioWindowInfoStart', 'audioWindowInfoEnd', 3],
    ['audioPreferenceReadStart', 'audioPreferenceReadEnd', 4],
    ['audioModelBuildStart', 'audioModelBuildEnd', 5],
    ['audioThemeStart', 'audioThemeEnd', 6],
  ]
  outerStages.forEach(([start, end, duration]) => {
    harness.probe.markToolLoadStage(route, start)
    harness.advance(duration)
    harness.probe.markToolLoadStage(route, end)
  })
  harness.probe.markToolLoadStage(route, 'audioDataPrepareStart')
  const initialDataStages = [
    ['audioDiagramHeightStart', 'audioDiagramHeightEnd', 7],
    ['audioReportHeightStart', 'audioReportHeightEnd', 8],
    ['audioSetDataStart', 'audioSetDataEnd', 9],
  ]
  initialDataStages.forEach(([start, end, duration]) => {
    assert.strictEqual(harness.probe.markToolLoadStage(route, start), true)
    harness.advance(duration)
    assert.strictEqual(harness.probe.markToolLoadStage(route, end), true)
  })
  harness.advance(10)
  harness.probe.markToolLoadStage(route, 'onLoadEnd')
  harness.advance(8)
  harness.probe.markToolLoadStage(route, 'onReady')

  const sample = latestSample(harness)
  assert(sample)
  assert.strictEqual(sample.initialDataMs, 34)
  assert.strictEqual(sample.diagramHeightMs, 7)
  assert.strictEqual(sample.reportHeightMs, 8)
  assert.strictEqual(sample.setDataCallMs, 9)
  assert.strictEqual(sample.initialDataResidualMs, 10)
  assert.strictEqual(sample.unmeasuredOnLoadMs, 0)
  assert.deepStrictEqual(Array.from(sample.stages, (stage) => stage.phase).slice(-9), [
    'audioDataPrepareStart',
    'audioDiagramHeightStart', 'audioDiagramHeightEnd',
    'audioReportHeightStart', 'audioReportHeightEnd',
    'audioSetDataStart', 'audioSetDataEnd',
    'onLoadEnd', 'onReady',
  ])
  assert(sample.notes.some((note) => note.includes('同步执行的回调')))

  const warm = makeHarness({ envVersion: 'trial', clockMode: 'inconsistent-instances' })
  warm.probe.beginToolLoadProbe(route)
  warm.advance(25)
  warm.probe.markToolLoadStage(route, 'onLoad')
  warm.probe.markToolLoadStage(route, 'audioDataPrepareStart')
  warm.probe.markToolLoadStage(route, 'audioDiagramHeightStart')
  warm.advance(5)
  warm.probe.markToolLoadStage(route, 'audioDiagramHeightEnd')
  warm.probe.markToolLoadStage(route, 'audioReportHeightStart')
  warm.advance(6)
  warm.probe.markToolLoadStage(route, 'audioReportHeightEnd')
  warm.probe.markToolLoadStage(route, 'audioSetDataStart')
  warm.advance(7)
  warm.probe.markToolLoadStage(route, 'audioSetDataEnd')
  warm.advance(8)
  warm.probe.markToolLoadStage(route, 'onLoadEnd')
  warm.advance(8)
  warm.probe.markToolLoadStage(route, 'onReady')
  const warmSample = latestSample(warm)
  assert(warmSample)
  assert.strictEqual(warmSample.tapToModuleMs, null)
  assert.strictEqual(warmSample.diagramHeightMs, 5)
  assert.strictEqual(warmSample.reportHeightMs, 6)
  assert.strictEqual(warmSample.setDataCallMs, 7)
  assert.strictEqual(warmSample.initialDataResidualMs, 8)
  assert.strictEqual(warm.getPerformanceCallCount(), 0)

  const missing = makeHarness()
  missing.probe.beginToolLoadProbe(route)
  missing.probe.markToolLoadStage(route, 'onLoad')
  missing.probe.markToolLoadStage(route, 'audioDataPrepareStart')
  missing.probe.markToolLoadStage(route, 'audioDiagramHeightStart')
  missing.advance(2)
  missing.probe.markToolLoadStage(route, 'audioDiagramHeightEnd')
  missing.probe.markToolLoadStage(route, 'onLoadEnd')
  missing.probe.markToolLoadStage(route, 'onReady')
  const missingSample = latestSample(missing)
  assert(missingSample)
  assert.strictEqual(missingSample.diagramHeightMs, 2)
  assert.strictEqual(missingSample.reportHeightMs, null)
  assert.strictEqual(missingSample.setDataCallMs, null)
  assert.strictEqual(missingSample.initialDataResidualMs, null)

  const inconsistent = makeHarness()
  inconsistent.probe.beginToolLoadProbe(route)
  inconsistent.probe.markToolLoadStage(route, 'onLoad')
  inconsistent.probe.markToolLoadStage(route, 'audioDataPrepareStart')
  inconsistent.probe.markToolLoadStage(route, 'audioDiagramHeightStart')
  inconsistent.probe.markToolLoadStage(route, 'audioReportHeightStart')
  inconsistent.probe.markToolLoadStage(route, 'audioSetDataStart')
  inconsistent.advance(5)
  inconsistent.probe.markToolLoadStage(route, 'audioDiagramHeightEnd')
  inconsistent.advance(5)
  inconsistent.probe.markToolLoadStage(route, 'audioReportHeightEnd')
  inconsistent.advance(5)
  inconsistent.probe.markToolLoadStage(route, 'audioSetDataEnd')
  inconsistent.probe.markToolLoadStage(route, 'onLoadEnd')
  inconsistent.probe.markToolLoadStage(route, 'onReady')
  const inconsistentSample = latestSample(inconsistent)
  assert(inconsistentSample)
  assert.strictEqual(inconsistentSample.initialDataMs, 15)
  assert.strictEqual(inconsistentSample.diagramHeightMs, 5)
  assert.strictEqual(inconsistentSample.reportHeightMs, 10)
  assert.strictEqual(inconsistentSample.setDataCallMs, 15)
  assert.strictEqual(inconsistentSample.initialDataResidualMs, null,
    'an impossible subtotal must not be clamped or presented as a valid residual')
}

function testAudioInitialDataPageSemantics() {
  const events = []
  const payloads = []
  const diagramHeights = []
  const reportHeights = []
  const modelPath = require.resolve(path.join(root, 'pages/audio-wiring/wiring-model.js'))
  const rendererPath = require.resolve(path.join(root, 'pages/audio-wiring/wiring-renderer.js'))
  const displayPath = require.resolve(path.join(root, 'pages/audio-wiring/wiring-display.js'))
  const performancePath = require.resolve(path.join(root, 'utils/performance.js'))
  const pagePath = require.resolve(path.join(root, 'pages/audio-wiring/index.js'))
  const modelModule = require(modelPath)
  const rendererModule = require(rendererPath)
  const displayModule = require(displayPath)
  const performanceModule = require(performancePath)
  const originalFunctions = {
    getFixedWiringSelections: modelModule.getFixedWiringSelections,
    getWiringModel: modelModule.getWiringModel,
    getDiagramHeight: rendererModule.getDiagramHeight,
    getReportHeight: rendererModule.getReportHeight,
    getWiringGuide: displayModule.getWiringGuide,
    markToolLoadStage: performanceModule.markToolLoadStage,
  }
  const previousWx = global.wx
  const previousPage = global.Page
  const cachedPage = require.cache[pagePath]
  let definition
  let selectionCalls = 0
  let modelCalls = 0
  let guideCalls = 0
  let diagramCalls = 0
  let reportCalls = 0

  try {
    global.wx = {
      getSystemInfoSync: () => ({ windowWidth: 375, pixelRatio: 2, theme: 'light' }),
      getStorageSync: () => undefined,
      setStorageSync() {},
    }
    global.Page = (value) => { definition = value }
    modelModule.getFixedWiringSelections = (...args) => {
      selectionCalls += 1
      return originalFunctions.getFixedWiringSelections(...args)
    }
    modelModule.getWiringModel = (...args) => {
      modelCalls += 1
      return originalFunctions.getWiringModel(...args)
    }
    rendererModule.getDiagramHeight = (...args) => {
      diagramCalls += 1
      events.push('diagramHeight')
      const value = originalFunctions.getDiagramHeight(...args)
      diagramHeights.push(value)
      return value
    }
    rendererModule.getReportHeight = (...args) => {
      reportCalls += 1
      events.push('reportHeight')
      const value = originalFunctions.getReportHeight(...args)
      reportHeights.push(value)
      return value
    }
    displayModule.getWiringGuide = (...args) => {
      guideCalls += 1
      return originalFunctions.getWiringGuide(...args)
    }
    performanceModule.markToolLoadStage = (route, phase) => {
      events.push(`stage:${phase}`)
      return true
    }
    delete require.cache[pagePath]
    require(pagePath)
    assert(definition, 'the real audio Page definition must register')

    function createPage({ shouldThrow = false } = {}) {
      const page = Object.create(definition)
      page.data = { ...definition.data }
      Object.defineProperty(page, 'setData', {
        configurable: true,
        get() {
          events.push('setDataLookup')
          return function (patch, callback) {
            assert.strictEqual(this, page, 'setData must preserve the Page receiver')
            events.push('setDataCallStart')
            if (shouldThrow) throw expectedError
            payloads.push(patch)
            page.data = { ...page.data, ...patch }
            if (callback) {
              events.push('callbackStart')
              callback.call(this)
              events.push('callbackEnd')
            }
            events.push('setDataCallEnd')
          }
        },
      })
      return page
    }

    const expectedError = new Error('setData failure')
    const page = createPage()
    page.onLoad.call(page, {})
    assert.strictEqual(payloads.length, 1, 'onLoad must send one unchanged initial data object')
    const payload = payloads[0]
    assert.deepStrictEqual(Object.keys(payload), [
      'outputId', 'inputId', 'outputEndpoint', 'inputEndpoint', 'manualSelected', 'selections',
      'showRestoredHint', 'wiringStorageWarning', 'model', 'supported', 'wiringStatus',
      'selectionSummary', 'criticalNotes', 'wiringGuide', 'outputSignalPortLabel', 'outputSignalTypeLabel',
      'inputSignalPortLabel', 'inputSignalTypeLabel', 'outputSignalSummary', 'inputSignalSummary',
      'outputOptions', 'inputOptions', 'viewMode', 'face', 'hasBothEndpoints', 'theme',
      'diagramCanvasWidth', 'diagramCanvasHeight', 'resultReportCanvasHeight',
    ], 'the original initial setData key and spread order must be preserved')
    assert.strictEqual(payload.outputId, 'xlrBalanced')
    assert.strictEqual(payload.inputId, 'terminalBalanced')
    assert.strictEqual(payload.supported, true)
    assert.strictEqual(payload.wiringStatus, 'ready')
    assert.strictEqual(payload.diagramCanvasWidth, 319)
    assert.strictEqual(payload.diagramCanvasHeight, diagramHeights[0])
    assert.strictEqual(payload.resultReportCanvasHeight, reportHeights[0])
    assert.strictEqual(payload.outputEndpoint.id, 'xlrBalanced')
    assert.strictEqual(payload.inputEndpoint.id, 'terminalBalanced')
    assert.strictEqual(payload.wiringGuide, originalFunctions.getWiringGuide(payload.model))
    assert.strictEqual(selectionCalls, 1)
    assert.strictEqual(modelCalls, 1)
    assert.strictEqual(guideCalls, 1)
    assert.strictEqual(diagramCalls, 1, 'instrumentation must not repeat the diagram-height calculation')
    assert.strictEqual(reportCalls, 1, 'instrumentation must not repeat the report-height calculation')

    const phaseIndex = (phase) => events.indexOf(`stage:${phase}`)
    assert(events.indexOf('setDataLookup') < phaseIndex('audioDiagramHeightStart'),
      'the original setData method lookup must happen before initial-data field evaluation')
    assert(phaseIndex('audioDiagramHeightStart') < events.indexOf('diagramHeight')
      && events.indexOf('diagramHeight') < phaseIndex('audioDiagramHeightEnd')
      && phaseIndex('audioDiagramHeightEnd') < phaseIndex('audioReportHeightStart')
      && phaseIndex('audioReportHeightStart') < events.indexOf('reportHeight')
      && events.indexOf('reportHeight') < phaseIndex('audioReportHeightEnd'),
    'the two existing height calculations must remain in order and run once')
    assert(events.indexOf('reportHeight') < phaseIndex('audioSetDataStart')
      && phaseIndex('audioSetDataStart') < events.indexOf('setDataCallStart')
      && events.indexOf('setDataCallStart') < events.indexOf('callbackStart')
      && events.indexOf('callbackEnd') < events.indexOf('setDataCallEnd')
      && events.indexOf('setDataCallEnd') < phaseIndex('audioSetDataEnd')
      && phaseIndex('audioSetDataEnd') < phaseIndex('onLoadEnd'),
    'the synchronous setData call and callback must be inside the measured call interval')

    const secondPage = createPage()
    secondPage.onLoad.call(secondPage, {})
    assert.strictEqual(payloads.length, 2)
    assert.notStrictEqual(payloads[0].model, payloads[1].model,
      'a new onLoad must retain the existing per-model layout cache identity')
    assert.strictEqual(diagramCalls, 2)
    assert.strictEqual(reportCalls, 2)
    assert.strictEqual(payloads[1].diagramCanvasHeight, payloads[0].diagramCanvasHeight)
    assert.strictEqual(payloads[1].resultReportCanvasHeight, payloads[0].resultReportCanvasHeight)

    const throwingPage = createPage({ shouldThrow: true })
    assert.throws(() => throwingPage.onLoad.call(throwingPage, {}), (error) => error === expectedError,
      'a setData exception must continue to propagate unchanged')
    assert.strictEqual(events.filter((event) => event === 'stage:onLoadEnd').length, 2,
      'onLoadEnd must not be emitted when setData throws')
  } finally {
    delete require.cache[pagePath]
    if (cachedPage) require.cache[pagePath] = cachedPage
    modelModule.getFixedWiringSelections = originalFunctions.getFixedWiringSelections
    modelModule.getWiringModel = originalFunctions.getWiringModel
    rendererModule.getDiagramHeight = originalFunctions.getDiagramHeight
    rendererModule.getReportHeight = originalFunctions.getReportHeight
    displayModule.getWiringGuide = originalFunctions.getWiringGuide
    performanceModule.markToolLoadStage = originalFunctions.markToolLoadStage
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
}

testAudioInitialDataSubstages()
testAudioInitialDataPageSemantics()
console.log('Audio initial-data timing and Page semantics regressions passed.')

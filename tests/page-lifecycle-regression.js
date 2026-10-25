const assert = require('assert/strict')

const originalPage = global.Page
const originalWx = global.wx
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout
const timers = new Map()
let nextTimerId = 1

global.setTimeout = (callback, delay) => {
  const id = nextTimerId++
  timers.set(id, { callback, delay })
  return id
}
global.clearTimeout = (id) => { timers.delete(id) }
const runTimer = (id) => {
  const timer = timers.get(id)
  if (!timer) return false
  timers.delete(id)
  timer.callback()
  return true
}
const runNextTimer = () => {
  const id = timers.keys().next().value
  return id === undefined ? undefined : (runTimer(id), id)
}
const fresh = (modulePath) => {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}
const clone = (value) => JSON.parse(JSON.stringify(value))
const installPage = (modulePath, wxOverrides = {}) => {
  let page
  global.Page = (config) => { page = config }
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    setNavigationBarTitle: () => {},
    ...wxOverrides,
  }
  fresh(modulePath)
  assert(page, `${modulePath} 未注册页面`)
  return page
}
const installSetData = (page) => {
  let count = 0
  page.data = clone(page.data)
  page.setData = (changes, callback) => {
    count += 1
    Object.entries(changes).forEach(([key, value]) => {
      const match = key.match(/^([^.\[]+)\[(\d+)\]\.(.+)$/)
      if (match) {
        const [, collection, index, property] = match
        page.data[collection][Number(index)] = {
          ...page.data[collection][Number(index)],
          [property]: value,
        }
      } else page.data[key] = value
    })
    if (callback) callback()
  }
  return () => count
}
const observerHarness = () => {
  const callbacks = []
  return {
    callbacks,
    createIntersectionObserver() {
      return {
        relativeToViewport() { return this },
        observe(selector, callback) { callbacks.push({ selector, callback }) },
        disconnect() {},
      }
    },
  }
}

try {
  // A first visible callback that arrives after unload cannot start the principle animation.
  const lateObserver = observerHarness()
  const lateObserverPage = installPage('../pages/knowledge/detail', lateObserver)
  lateObserverPage.createIntersectionObserver = lateObserver.createIntersectionObserver
  const lateObserverSetDataCount = installSetData(lateObserverPage)
  lateObserverPage.onLoad({ id: 'fill-handoff' })
  lateObserverPage.onReady()
  assert.equal(lateObserver.callbacks.length, 1)
  const beforeLateObserverWrites = lateObserverSetDataCount()
  lateObserverPage.onUnload()
  lateObserver.callbacks[0].callback({ intersectionRatio: 0.5 })
  assert.equal(lateObserverSetDataCount(), beforeLateObserverWrites)
  assert.equal(lateObserverPage.principleAnimationTimer, null)

  // Normal first entry, 40ms activation, and replay remain functional.
  const principleObserver = observerHarness()
  const principlePage = installPage('../pages/knowledge/detail', principleObserver)
  principlePage.createIntersectionObserver = principleObserver.createIntersectionObserver
  installSetData(principlePage)
  principlePage.onLoad({ id: 'fill-handoff' })
  principlePage.onReady()
  principleObserver.callbacks[0].callback({ intersectionRatio: 0.5 })
  const queuedPrincipleTimer = principlePage.principleAnimationTimer
  assert.equal(timers.has(queuedPrincipleTimer), true)
  runTimer(queuedPrincipleTimer)
  assert.equal(principlePage.data.principleAnimationActive, true)
  principlePage.replayPrincipleAnimation()
  assert.equal(principlePage.data.principleAnimationActive, false)
  runNextTimer()
  assert.equal(principlePage.data.principleAnimationActive, true)

  // A timer callback already taken by the runtime must also be inert after unload.
  const lateTimerObserver = observerHarness()
  const lateTimerPage = installPage('../pages/knowledge/detail', lateTimerObserver)
  lateTimerPage.createIntersectionObserver = lateTimerObserver.createIntersectionObserver
  const lateTimerSetDataCount = installSetData(lateTimerPage)
  lateTimerPage.onLoad({ id: 'fill-handoff' })
  lateTimerPage.onReady()
  lateTimerObserver.callbacks[0].callback({ intersectionRatio: 0.5 })
  const lateTimerId = lateTimerPage.principleAnimationTimer
  const lateTimerCallback = timers.get(lateTimerId).callback
  const beforeLateTimerWrites = lateTimerSetDataCount()
  lateTimerPage.onUnload()
  lateTimerCallback()
  assert.equal(lateTimerSetDataCount(), beforeLateTimerWrites)

  // Demo first entry, timed advance, replay, and hide/show resume retain their existing behavior.
  const demoObserver = observerHarness()
  const demoPage = installPage('../pages/knowledge/detail', demoObserver)
  demoPage.createIntersectionObserver = demoObserver.createIntersectionObserver
  installSetData(demoPage)
  demoPage.onLoad({ id: 'camera-fov-distance' })
  demoPage.onReady()
  demoPage.cardVisible = false
  demoObserver.callbacks[0].callback({ intersectionRatio: 0.5 })
  assert.equal(demoPage.data.demoPlaying, true)
  assert.equal(demoPage.data.demoIndex, 0)
  const firstDemoTimer = demoPage.demoTimer
  runTimer(firstDemoTimer)
  assert.equal(demoPage.data.demoIndex, 1)
  assert.equal(demoPage.data.demoPlaying, true)
  demoPage.replayDemo()
  assert.equal(demoPage.data.demoIndex, 0)
  assert.equal(demoPage.data.demoPlaying, true)
  demoPage.onHide()
  assert.equal(demoPage.data.demoPlaying, false)
  assert.equal(demoPage.resumeIntent, true)
  demoPage.onShow()
  assert.equal(demoPage.data.demoPlaying, true)
  demoPage.pauseDemo()
  assert.equal(demoPage.userPaused, true)
  demoPage.onHide()
  demoPage.onShow()
  assert.equal(demoPage.data.demoPlaying, false)
  const beforeInvalidStep = demoPage.data.demoIndex
  demoPage.selectDemoStep({ currentTarget: { dataset: { index: 'invalid' } } })
  assert.equal(demoPage.data.demoIndex, beforeInvalidStep)

  // A malformed stored view index falls back to view 0 without touching real storage.
  let storedViewIndex = -1
  const cameraPage = installPage('../pages/camera/camera', {
    getStorageSync: () => ({ cameraModel: 'TS-0650JSM', viewIndex: storedViewIndex }),
  })
  installSetData(cameraPage)
  ;[-1, 0.5, NaN, Infinity].forEach((invalidIndex) => {
    storedViewIndex = invalidIndex
    cameraPage.onLoad()
    assert.equal(cameraPage.data.viewIndex, 0)
  })
  storedViewIndex = 1
  cameraPage.onLoad()
  assert.equal(cameraPage.data.viewIndex, 1)
  storedViewIndex = 999
  cameraPage.onLoad()
  assert.equal(cameraPage.data.viewIndex, cameraPage.data.viewOptions.length - 1)
  assert.equal(typeof cameraPage.data.selectedMountLabel, 'string')

  // A selector callback that outlives hide/unload cannot recreate or redraw a released canvas.
  const queryCallbacks = []
  let clearRectCount = 0
  const rawCanvasContext = new Proxy({}, {
    get: (target, key) => {
      if (key === 'clearRect') return () => { clearRectCount += 1 }
      if (key === 'scale') return () => {}
      return () => {}
    },
  })
  global.wx.createSelectorQuery = () => ({
    in() { return this },
    select() { return this },
    fields() { return this },
    exec(callback) { queryCallbacks.push(callback) },
  })
  global.wx.getWindowInfo = () => ({ pixelRatio: 1 })
  cameraPage._pageVisible = true
  cameraPage.drawPreview()
  assert.equal(queryCallbacks.length, 1)
  cameraPage.onHide()
  cameraPage.onShow()
  assert.equal(queryCallbacks.length, 2)
  queryCallbacks[0]([{ node: { getContext: () => rawCanvasContext }, width: 640, height: 500 }])
  assert.equal(Boolean(cameraPage._canvasCache), false)
  queryCallbacks[1]([{ node: { getContext: () => rawCanvasContext }, width: 640, height: 500 }])
  assert(cameraPage._canvasCache)
  const beforeResizeQueries = queryCallbacks.length
  cameraPage.onResize()
  assert.equal(queryCallbacks.length, beforeResizeQueries + 1)
  const beforeResizeStaleWrites = clearRectCount
  queryCallbacks[1]([{ node: { getContext: () => rawCanvasContext }, width: 640, height: 500 }])
  assert.equal(clearRectCount, beforeResizeStaleWrites)
  queryCallbacks[2]([{ node: { getContext: () => rawCanvasContext }, width: 640, height: 500 }])
  assert(cameraPage._canvasCache)

  const beforeViewSwitchQueries = queryCallbacks.length
  const beforePlanSwitchWrites = clearRectCount
  assert.equal(cameraPage.data.previewViewOptions.length, 1,
    'the approved camera preview exposes one spatial view')
  cameraPage.onPreviewViewTap({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(cameraPage.data.previewViewIndex, 0, 'an out-of-range preview index is ignored')
  assert.equal(queryCallbacks.length, beforeViewSwitchQueries)
  assert.equal(clearRectCount, beforePlanSwitchWrites, 'an ignored preview index does not redraw the cached canvas')
  const beforeElevationSwitchWrites = clearRectCount
  cameraPage.onPreviewViewTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(cameraPage.data.previewViewIndex, 0)
  assert.equal(queryCallbacks.length, beforeViewSwitchQueries)
  assert.equal(clearRectCount, beforeElevationSwitchWrites, 'selecting the existing spatial view is a no-op')
  const beforeCacheReuseWrites = clearRectCount
  const beforeCacheReuseQueries = queryCallbacks.length
  cameraPage.drawPreview()
  assert.equal(queryCallbacks.length, beforeCacheReuseQueries)
  assert.equal(clearRectCount, beforeCacheReuseWrites + 1)

  // A selector query queued immediately before unload cannot recreate or redraw the released canvas.
  cameraPage.invalidatePreviewCanvas()
  cameraPage.drawPreview()
  assert.equal(queryCallbacks.length, beforeCacheReuseQueries + 1)
  const beforeUnloadCanvasWrites = clearRectCount
  cameraPage.onUnload()
  queryCallbacks[3]([{ node: { getContext: () => rawCanvasContext }, width: 640, height: 500 }])
  assert.equal(cameraPage._canvasCache, null)
  assert.equal(clearRectCount, beforeUnloadCanvasWrites)

  // The index page's current onShow contract activates and persists the basis tab.
  const primaryTabWrites = []
  const indexPage = installPage('../pages/index/index', {
    setStorageSync(key, value) { primaryTabWrites.push({ key, value }) },
  })
  const indexSetDataCount = installSetData(indexPage)
  const basisVisibilityTimersBeforeShow = timers.size
  indexPage.onShow()
  assert.deepEqual(primaryTabWrites, [{ key: 'audioTool.primaryTab.v1', value: 'basis' }])
  assert.deepEqual(indexPage.data.basisTools, require('../utils/tool-registry').getBasisTools(),
    'basis onShow refreshes visible directory entries')
  assert.equal(indexSetDataCount(), 1, 'basis onShow updates render data once with the visible entries')
  assert.equal(timers.size, basisVisibilityTimersBeforeShow, 'basis visibility refresh does not queue asynchronous updates')
  indexPage.onUnload?.()
  assert.equal(indexSetDataCount(), 1, 'basis unload does not trigger a late render update')

  console.log('page lifecycle regression PASS')
} finally {
  timers.clear()
  global.Page = originalPage
  global.wx = originalWx
  global.setTimeout = originalSetTimeout
  global.clearTimeout = originalClearTimeout
}

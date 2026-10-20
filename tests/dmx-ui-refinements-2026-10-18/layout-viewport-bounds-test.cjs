const assert = require('node:assert/strict')
const { createDmxLayoutPage } = require('../../pages/dmx-layout/page-factory')

function makeWx({ windowInfo, systemInfo, capsule } = {}) {
  return {
    getWindowInfo: windowInfo,
    getSystemInfoSync: systemInfo,
    getMenuButtonBoundingClientRect: capsule,
  }
}

function resize(wxApi, mode, eventSize = {}) {
  global.wx = wxApi
  const page = createDmxLayoutPage({ mode })
  page._alive = true
  page._visible = true
  page.data.layoutPanelVisible = true
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch)
    if (callback) callback()
  }
  page.onResize({ size: eventSize })
  return page
}

function assertBounded(page, width, height, safeBottomMax = height) {
  const data = page.data
  for (const key of ['windowWidth', 'windowHeight', 'navigationHeight', 'shareTop', 'shareRight', 'navTitleCenter', 'canvasShellHeight', 'overlaySafeTop', 'overlaySafeBottom', 'overlayAvailableHeight', 'settingsBodyMaxHeight']) {
    assert(Number.isFinite(data[key]) && data[key] >= 0, key + ' should be finite and nonnegative')
  }
  assert(data.windowWidth <= width && data.windowHeight <= height, 'resolved window dimensions should stay bounded')
  assert(data.navigationHeight <= data.windowHeight, 'navigation should not exceed the window')
  assert(data.canvasShellHeight <= data.windowHeight, 'canvas shell should not exceed the window')
  assert(data.overlaySafeBottom <= safeBottomMax, 'bottom inset should not exceed the window')
  assert(data.overlaySafeTop + data.overlaySafeBottom <= data.windowHeight, 'safe rectangle should stay inside the window')
  assert(data.overlayAvailableHeight === data.windowHeight - data.overlaySafeTop - data.overlaySafeBottom, 'available overlay height should not use an overflowing minimum')
  assert(data.settingsBodyMaxHeight <= data.overlayAvailableHeight, 'settings scroll height should fit the safe rectangle')
}

const capsule = { left: 747, right: 834, top: 8, bottom: 40, width: 87, height: 32 }
const page = resize(makeWx({
  windowInfo: () => ({ windowWidth: 844, windowHeight: 390, statusBarHeight: 0, safeArea: { top: 0, bottom: 369 } }),
  systemInfo: () => ({}),
  capsule: () => capsule,
}), 'landscape', { windowWidth: 844, windowHeight: 390 })
assertBounded(page, 844, 390)
assert(page.data.overlaySafeTop >= capsule.bottom + 8, 'valid capsule clears the overlay safe top')
assert(page.data.canvasShellHeight > 0, 'normal landscape keeps a usable canvas')

const fallbackFromThrowingApi = resize(makeWx({
  windowInfo: () => { throw Error('unavailable') },
  systemInfo: () => ({ windowWidth: 568, windowHeight: 320, statusBarHeight: Infinity, safeArea: { top: NaN, bottom: Infinity } }),
  capsule: () => ({ left: -2, right: 900, top: 0, bottom: 9999, width: 902, height: 9999 }),
}), 'landscape', { width: Infinity, height: -1 })
assertBounded(fallbackFromThrowingApi, 568, 320)
assert.equal(fallbackFromThrowingApi.data.overlaySafeTop, 52, 'invalid capsule should use bounded navigation fallback')

const fallbackFromBadValues = resize(makeWx({
  windowInfo: () => ({ windowWidth: 0, windowHeight: -1, statusBarHeight: Infinity, safeArea: { top: Infinity, bottom: 0 } }),
  systemInfo: () => ({ windowWidth: 320, windowHeight: 568, statusBarHeight: 44, safeArea: { top: 44, bottom: 534 } }),
  capsule: () => ({ left: 223, right: 310, top: 52, bottom: 84, width: 87, height: 32 }),
}), 'portrait', { windowWidth: 0, windowHeight: NaN })
assertBounded(fallbackFromBadValues, 320, 568)
assert(fallbackFromBadValues.data.overlaySafeTop >= 92, 'valid fallback capsule should remain protected')

const noWindowApis = resize(makeWx({
  windowInfo: undefined,
  systemInfo: undefined,
  capsule: () => ({ left: 200, right: 280, top: 300, bottom: 500, width: 80, height: 200 }),
}), 'landscape')
assertBounded(noWindowApis, 844, 390)
assert(noWindowApis.data.overlaySafeTop <= noWindowApis.data.windowHeight, 'out-of-window capsule should not inflate navigation')

let staleSetData = 0
const stale = createDmxLayoutPage({ mode: 'portrait' })
stale._alive = false
stale._visible = false
stale.setData = () => { staleSetData += 1 }
global.wx = makeWx({ windowInfo: () => ({ windowWidth: 390, windowHeight: 844 }) })
stale.onResize({ size: { windowWidth: 844, windowHeight: 390 } })
assert.equal(staleSetData, 0, 'late resize after hide/unload must not update the page')

console.log('Layout viewport bounds and stale resize guard passed')

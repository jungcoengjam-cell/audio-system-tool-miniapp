'use strict'

const assert = require('node:assert/strict')
const {
  readLayoutViewportMetrics,
} = require('../pages/dmx-layout/layout-viewport')
const {
  getLightingViewportMetrics,
  getFixtureSearchScrollMetrics,
  computeFloatingCardFrame,
  getAddressCardChipColumns,
} = require('../pages/dmx-address/viewport')

const layoutCalls = []
const layoutMetrics = readLayoutViewportMetrics({
  getWindowInfo() {
    layoutCalls.push('window')
    return { windowWidth: 390, windowHeight: 844, statusBarHeight: 24, safeArea: { bottom: 820 } }
  },
  getSystemInfoSync() {
    layoutCalls.push('system')
    return { windowWidth: 844, windowHeight: 390 }
  },
  getMenuButtonBoundingClientRect() {
    layoutCalls.push('capsule')
    return { left: 747, right: 834, top: 8, bottom: 40, width: 87, height: 32 }
  },
}, true, { windowWidth: 320, windowHeight: 568 })
assert.deepEqual(layoutCalls, ['window', 'system', 'capsule'], 'layout viewport should preserve the WeChat API read order')
assert.equal(layoutMetrics.windowWidth, 320, 'resize event width should take priority over device info')
assert.equal(layoutMetrics.windowHeight, 568, 'resize event height should take priority over device info')
assert(layoutMetrics.overlaySafeTop + layoutMetrics.overlaySafeBottom <= layoutMetrics.windowHeight)

const malformedLayout = readLayoutViewportMetrics({
  getWindowInfo() { throw new Error('window info unavailable') },
  getSystemInfoSync() {
    return { windowWidth: 320, windowHeight: 160, statusBarHeight: Infinity, safeArea: { bottom: 9999 } }
  },
  getMenuButtonBoundingClientRect() { throw new Error('capsule unavailable') },
}, false, {})
assert.equal(malformedLayout.windowWidth, 320)
assert.equal(malformedLayout.windowHeight, 160)
assert(Number.isFinite(malformedLayout.canvasShellHeight) && malformedLayout.canvasShellHeight >= 0)
assert(malformedLayout.overlaySafeTop + malformedLayout.overlaySafeBottom <= malformedLayout.windowHeight)

const previousWx = global.wx
const addressCalls = []
try {
  global.wx = {
    getSystemInfoSync() {
      addressCalls.push('system')
      return { windowWidth: 568, windowHeight: 320, statusBarHeight: 24, safeArea: { bottom: 308 } }
    },
    getMenuButtonBoundingClientRect() {
      addressCalls.push('capsule')
      return { left: 200, right: 280, top: 28, bottom: 60, width: 80, height: 32 }
    },
  }
  const lightingMetrics = getLightingViewportMetrics({ windowWidth: 320, windowHeight: 160 })
  assert.deepEqual(addressCalls, ['system', 'capsule'], 'address viewport should preserve the WeChat API read order')
  assert.equal(lightingMetrics.windowWidth, 320, 'resize event width should take priority over system info')
  assert.equal(lightingMetrics.windowHeight, 160, 'resize event height should take priority over system info')
  assert(Number.isFinite(lightingMetrics.overlayMaxHeight) && lightingMetrics.overlayMaxHeight >= 1)

  const fallbackCalls = []
  global.wx = {
    getSystemInfoSync() { fallbackCalls.push('system'); throw new Error('system info unavailable') },
    getMenuButtonBoundingClientRect() { fallbackCalls.push('capsule'); throw new Error('capsule unavailable') },
  }
  const fallback = getLightingViewportMetrics({})
  assert.deepEqual(fallbackCalls, ['system', 'capsule'])
  assert.equal(fallback.windowWidth, 390)
  assert.equal(fallback.windowHeight, 720)
  assert(fallback.overlaySafeTop + fallback.overlaySafeBottom + fallback.overlayMaxHeight <= fallback.windowHeight)
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

const batchLayout = getFixtureSearchScrollMetrics({ windowHeight: 320, overlaySearchSheetHeight: 220 }, true, 500)
assert.deepEqual(batchLayout, {
  fixtureSearchResultsHeight: 24,
  fixtureBatchFooterHeight: 58,
  batchSelectedListHeight: 10,
}, 'small viewport batch footer should leave the minimum result area')
assert.equal(getFixtureSearchScrollMetrics({ windowHeight: 320, overlaySearchSheetHeight: 220 }, false, 500).fixtureBatchFooterHeight, 0)

const emptyCard = computeFloatingCardFrame({ fixtureChips: [] }, { windowWidth: 390, windowHeight: 844 }, 76, 12)
const crowdedCard = computeFloatingCardFrame({
  fixtureChips: Array.from({ length: 320 }, (_, index) => index),
  hasChannelGuide: true,
}, { windowWidth: 390, windowHeight: 844 }, 76, 12)
assert(Number.isFinite(emptyCard.cardHeight) && Number.isFinite(crowdedCard.cardHeight))
assert(crowdedCard.cardHeight > emptyCard.cardHeight, 'many chips should grow the floating card up to the safe viewport')
assert(crowdedCard.targetTop + crowdedCard.cardHeight <= 844 - 12)

assert.equal(getAddressCardChipColumns(320), 6)
assert.equal(getAddressCardChipColumns(350), 7)
assert.equal(getAddressCardChipColumns(351), 7)
assert.equal(getAddressCardChipColumns(390), 8)

console.log('DMX viewport boundary regression passed')

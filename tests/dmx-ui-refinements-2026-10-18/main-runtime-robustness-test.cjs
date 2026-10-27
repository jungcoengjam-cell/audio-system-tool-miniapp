// Controller-level lifecycle and fallback checks using the actual page and the
// shared WeChat boundary runtime. This is not native WeChat or device QA.
const assert = require('node:assert/strict')
const { createRuntime } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function twoGroups() {
  return [
    { name: 'TL-SL323 200W成像灯', fixtureSource: 'library', fixtureModel: 'TL-SL323', channelCount: '2', libraryChannelCount: '2', fixtureCount: '1', targetUniverse: 'A' },
    { name: 'TL-SL323 200W成像灯', fixtureSource: 'library', fixtureModel: 'TL-SL323', channelCount: '2', libraryChannelCount: '2', fixtureCount: '40', targetUniverse: 'A' },
  ]
}

async function test(name, body) {
  await body()
  console.log('PASS ' + name)
}

async function main() {
  await test('stale resize selector cannot replace a newer floating card', async () => {
    const runtime = createRuntime()
    runtime.seed(twoGroups())
    try {
      const page = runtime.make('main')
      runtime.state.deferSelectors = true
      page.openFloatingCard(runtime.event({ index: 0 }))
      runtime.selectors.shift().run(runtime.rect)
      await wait(35)
      assert.equal(page.data.floatingGroup._lightingGroupId, page.data.groupCards[0]._lightingGroupId)

      page.onResize({ size: { windowWidth: 390, windowHeight: 844 } })
      const oldResizeQuery = runtime.selectors.shift()
      assert(oldResizeQuery, 'resize must request a fresh source rectangle')
      page.closeFloatingCard()
      page.openFloatingCard(runtime.event({ index: 1 }))
      assert.equal(runtime.selectors.length, 0, 'opening another card is ignored while the floating card is closing')
      await wait(260)
      page.openFloatingCard(runtime.event({ index: 1 }))
      const newOpenQuery = runtime.selectors.shift()
      assert(newOpenQuery, 'new card must request its own source rectangle after close completes')
      newOpenQuery.run(runtime.rect)
      await wait(35)
      const beforeLateResult = { style: page.data.floatingStyle, origin: JSON.stringify(page._floatingOrigin), groupId: page.data.floatingGroup._lightingGroupId }
      assert.equal(beforeLateResult.groupId, page.data.groupCards[1]._lightingGroupId)
      oldResizeQuery.run(runtime.rect)
      assert.equal(page.data.floatingStyle, beforeLateResult.style)
      assert.equal(JSON.stringify(page._floatingOrigin), beforeLateResult.origin)
      assert.equal(page.data.floatingGroup._lightingGroupId, beforeLateResult.groupId)
    } finally {
      runtime.dispose()
    }
  })

  await test('short viewports and malformed capsule geometry stay finite and bounded', () => {
    const cases = [
      { name: 'throwing capsule', capsule: () => { throw new Error('capsule unavailable') } },
      { name: 'infinite capsule', capsule: () => ({ left: Infinity, right: Infinity, top: 0, bottom: Infinity, width: Infinity, height: Infinity }) },
      { name: 'zero capsule', capsule: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) },
    ]
    for (const item of cases) {
      const runtime = createRuntime()
      runtime.seed()
      const previousSystem = global.wx.getSystemInfoSync
      const previousCapsule = global.wx.getMenuButtonBoundingClientRect
      global.wx.getSystemInfoSync = () => ({ windowWidth: 320, windowHeight: 160, statusBarHeight: 0, safeArea: { bottom: 148 } })
      global.wx.getMenuButtonBoundingClientRect = item.capsule
      try {
        const page = runtime.make('main')
        const metricKeys = ['windowWidth', 'windowHeight', 'overlaySafeTop', 'overlaySafeBottom', 'overlayMaxHeight', 'overlayCenterTop', 'overlaySearchMaxHeight', 'overlayPendingMaxHeight', 'overlayAddMaxHeight', 'overlaySaveMaxHeight', 'overlayGuideHeight', 'overlayReportHeight']
        for (const key of metricKeys) assert(Number.isFinite(page.data[key]), `${item.name}: ${key} should be finite`)
        assert(page.data.windowWidth <= 320 && page.data.windowHeight <= 160, `${item.name}: do not invent a larger viewport`)
        assert(page.data.overlaySafeTop >= 0 && page.data.overlaySafeBottom >= 0 && page.data.overlayMaxHeight >= 1)
        assert(page.data.overlaySafeTop + page.data.overlaySafeBottom + page.data.overlayMaxHeight <= page.data.windowHeight + 1)
        assert(page.data.navigationHeight <= page.data.windowHeight)
      } finally {
        global.wx.getSystemInfoSync = previousSystem
        global.wx.getMenuButtonBoundingClientRect = previousCapsule
        runtime.dispose()
      }
    }

    const runtime = createRuntime()
    runtime.seed()
    const previousSystem = global.wx.getSystemInfoSync
    const previousCapsule = global.wx.getMenuButtonBoundingClientRect
    global.wx.getSystemInfoSync = () => { throw new Error('system info unavailable') }
    global.wx.getMenuButtonBoundingClientRect = () => { throw new Error('capsule unavailable') }
    try {
      const page = runtime.make('main')
      for (const key of ['windowWidth', 'windowHeight', 'overlaySafeTop', 'overlaySafeBottom', 'overlayMaxHeight', 'overlayCenterTop']) assert(Number.isFinite(page.data[key]), `${key} should use finite fallback metrics`)
    } finally {
      global.wx.getSystemInfoSync = previousSystem
      global.wx.getMenuButtonBoundingClientRect = previousCapsule
      runtime.dispose()
    }
  })

  await test('resize is ignored after hide or unload and stale resize callbacks cannot reposition', async () => {
    for (const lifecycle of ['hide', 'unload']) {
      const runtime = createRuntime({ deferSelectors: true })
      runtime.seed()
      try {
        const page = runtime.make('main')
        page.openFloatingCard(runtime.event({ index: 0 }))
        const openingQuery = runtime.selectors.shift()
        assert(openingQuery, 'opening the card should measure its source')
        openingQuery.run(runtime.rect)
        await wait(35)
        assert(page.data.floatingGroup, 'the card should be open before resizing')

        const pendingCallbacks = []
        const setData = page.setData
        page.setData = (patch, callback) => setData(patch, () => {
          if (callback) pendingCallbacks.push(callback)
        })
        page.onResize({ size: { windowWidth: 568, windowHeight: 320 } })
        assert.equal(pendingCallbacks.length, 1, 'resize metrics should have one completion callback')
        const selectorCountBeforeLifecycleEnd = runtime.stats.selectors.length

        if (lifecycle === 'hide') page.onHide()
        else page.onUnload()
        const patchCountAfterLifecycleEnd = page._qaPatches.length
        page.onResize({ size: { windowWidth: 320, windowHeight: 568 } })
        assert.equal(page._qaPatches.length, patchCountAfterLifecycleEnd, `${lifecycle}: inactive resize must not setData`)
        assert.equal(page.data.windowHeight, 320, `${lifecycle}: inactive resize must not update viewport metrics`)

        pendingCallbacks[0]()
        assert.equal(runtime.stats.selectors.length, selectorCountBeforeLifecycleEnd, `${lifecycle}: stale resize callback must not request a new source measurement`)
      } finally {
        runtime.dispose()
      }
    }
  })

  await test('cancel after hide or unload never calls setData', async () => {
    const runtime = createRuntime()
    runtime.seed()
    try {
      const page = runtime.make('main')
      page.openFloatingCard(runtime.event({ index: 0 }))
      await wait(35)
      page.onFloatingTouchStart({ touches: [{ clientX: 20, clientY: 20 }] })
      page.onHide()
      const afterHide = page._qaPatches.length
      page.onFloatingTouchCancel()
      assert.equal(page._qaPatches.length, afterHide)

      page.onShow()
      page.openFloatingCard(runtime.event({ index: 0 }))
      await wait(35)
      page.onFloatingTouchStart({ touches: [{ clientX: 20, clientY: 20 }] })
      page.onUnload()
      const afterUnload = page._qaPatches.length
      page.onFloatingTouchCancel()
      assert.equal(page._qaPatches.length, afterUnload)
    } finally {
      runtime.dispose()
    }
  })

  await test('a resize during close completes the floating-card close', async () => {
    const runtime = createRuntime()
    runtime.seed()
    try {
      const page = runtime.make('main')
      page.openFloatingCard(runtime.event({ index: 0 }))
      await wait(35)
      assert.equal(page.data.floatingVisible, true)
      page.closeFloatingCard()
      page.onResize({ size: { windowWidth: 320, windowHeight: 568 } })
      await wait(260)
      assert.equal(page.data.floatingVisible, false)
      assert.equal(page.data.floatingGroup, null)
      assert.equal(page._floatingClosing, false)
    } finally {
      runtime.dispose()
    }
  })

  await test('a deleted group gesture cannot swipe-open its replacement row', () => {
    const runtime = createRuntime()
    runtime.seed(twoGroups())
    try {
      const page = runtime.make('main')
      const start = { clientX: 200, clientY: 200 }
      page.onGroupTouchStart(runtime.event({ index: 0 }, {}, { touches: [start], changedTouches: [start] }))
      page.onGroupTouchMove(runtime.event({ index: 0 }, {}, { touches: [{ clientX: 150, clientY: 200 }], changedTouches: [{ clientX: 150, clientY: 200 }] }))
      assert.equal(page.data.swipeDragIndex, 0)
      page.requestDeleteGroup(runtime.event({ index: 0 }))
      page.confirmPendingChange()
      const replacementId = page.data.groups[0]._lightingGroupId
      assert.equal(page.data.swipeDragIndex, -1)
      page.onGroupTouchEnd(runtime.event({ index: 0 }, {}, { touches: [], changedTouches: [{ clientX: 100, clientY: 200 }] }))
      assert.equal(page.data.swipedGroupIndex, -1)
      assert.equal(page.data.groups[0]._lightingGroupId, replacementId)
    } finally {
      runtime.dispose()
    }
  })
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})

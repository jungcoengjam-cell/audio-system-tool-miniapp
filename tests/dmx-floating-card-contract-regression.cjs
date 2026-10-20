'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
const floatingStart = wxml.indexOf('<view wx:if="{{floatingVisible && floatingGroup}}" class="floating-card')
const floatingEnd = wxml.indexOf('\n  </view>\n', floatingStart)
assert(floatingStart >= 0 && floatingEnd > floatingStart, 'Current floating-card WXML block is missing')
const floatingMarkup = wxml.slice(floatingStart, floatingEnd)

assert.equal((wxml.match(/bindtap="openFloatingCard"/g) || []).length, 2, 'The thumbnail and collapsed address preview are the two explicit open surfaces')
assert.match(wxml, /class="fixture-thumb" data-index="\{\{groupIndex\}\}" bindtap="openFloatingCard"/)
assert.match(wxml, /class="address-chips address-chips-preview"[^>]*bindtap="openFloatingCard"/)
assert(floatingMarkup.includes('picker class="fixture-control-picker"'))
assert(floatingMarkup.includes('bindchange="onCardModeChange"'), 'The expanded catalog card must expose channel-mode selection')
assert(floatingMarkup.includes('bindinput="onCardQuantityInput"') && floatingMarkup.includes('bindblur="onCardQuantityBlur"'),
  'The expanded catalog card must expose quantity editing and validation')
assert(wxml.includes('class="floating-backdrop" bindtap="closeFloatingCard"'), 'Outside tap must reach the card close handler')
const gestureBindings = [
  ['bindtouchstart="onFloatingTouchStart"', 'onFloatingTouchStart'],
  ['bindtouchmove="onFloatingTouchMove"', 'onFloatingTouchMove'],
  ['bindtouchend="onFloatingTouchEnd"', 'onFloatingTouchEnd'],
  ['bindtouchcancel="onFloatingTouchCancel"', 'onFloatingTouchCancel'],
]
for (const [binding, method] of gestureBindings) {
  assert(floatingMarkup.includes(binding), 'The floating card is missing its ' + method + ' gesture binding')
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function main() {
  const runtime = createRuntime()
  runtime.seed([
    { name: '200W平板柔光灯', fixtureSource: 'library', fixtureModel: 'TL-SK3101', channelCount: '2', libraryChannelCount: '2', fixtureCount: '3', targetUniverse: 'A' },
    { name: '200W成像灯', fixtureSource: 'library', fixtureModel: 'TL-SL323', channelCount: '2', libraryChannelCount: '2', fixtureCount: '2', targetUniverse: 'B' },
  ])
  try {
    const page = runtime.make('main')
    const layoutPage = runtime.make()
    const otherFixture = layoutPage._fixtures.find((item) => item.groupIndex === 1)
    assert(otherFixture, 'The unrelated second group fixture must exist')
    runtime.place(layoutPage, layoutPage._fixtures.indexOf(otherFixture))
    page.onShow()

    const initial = clone(runtime.workspace.readLightingWorkspace().scheme)
    const firstGroupId = initial.groupIds[0]
    const otherGroupId = initial.groupIds[1]
    const firstFixtureIds = clone(initial.fixtureIdsByGroup[firstGroupId])
    const otherFixtureIds = clone(initial.fixtureIdsByGroup[otherGroupId])
    const otherFixtureId = otherFixtureIds[0]
    const otherPlacement = clone(initial.layout.positionsById[otherFixtureId])
    assert(otherPlacement, 'The unrelated group fixture must have a persisted layout position')

    page.openFloatingCard(runtime.event({ index: 0 }))
    await wait(35)
    assert.equal(page.data.floatingVisible, true)
    assert.equal(page.data.floatingGroup._lightingGroupId, firstGroupId)
    assert.deepEqual(page.data.floatingGroup.channelModes, [2, 5], 'The card must expose the actual catalog modes')

    const writesBeforeModeChange = runtime.stats.writes
    page.onCardModeChange(runtime.event({ index: 0 }, { value: '1' }))
    assert.equal(page.data.pendingChange?.kind, 'edit')
    assert.equal(page.data.pendingChange?.valid, true)
    assert.equal(runtime.stats.writes, writesBeforeModeChange, 'Catalog preview must wait for confirmation before persisting')
    page.confirmPendingChange()

    let snapshot = runtime.workspace.readLightingWorkspace().scheme
    assert.equal(snapshot.preferences.groups[0].channelCount, '5', 'Confirmed catalog mode must be persisted')
    assert.deepEqual(snapshot.fixtureIdsByGroup[firstGroupId], firstFixtureIds)
    assert.equal(snapshot.preferences.groups[1].fixtureModel, 'TL-SL323')
    assert.equal(snapshot.preferences.groups[1].fixtureCount, '2')
    assert.equal(snapshot.preferences.groups[1].targetUniverse, 'B')
    assert.deepEqual(snapshot.fixtureIdsByGroup[otherGroupId], otherFixtureIds)
    assert.deepEqual(snapshot.layout.positionsById[otherFixtureId], otherPlacement, 'Editing the first group changed an unrelated fixture placement')

    for (const value of ['', '0', '201', '1.5']) {
      const label = JSON.stringify(value)
      const before = clone(runtime.workspace.readLightingWorkspace().scheme)
      const writesBeforeInvalid = runtime.stats.writes
      page.onCardQuantityInput(runtime.event({ index: 0 }, { value }))
      page.onCardQuantityBlur(runtime.event({ index: 0 }, { value }))
      assert.equal(runtime.stats.writes, writesBeforeInvalid, 'Invalid quantity ' + label + ' must not write storage')
      assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, before, 'Invalid quantity ' + label + ' changed persisted groups')
      assert.equal(page.data.groups[0].fixtureCount, '3', 'Invalid quantity ' + label + ' must restore the saved count')
      assert.deepEqual(page._scheme.fixtureIdsByGroup[firstGroupId], firstFixtureIds)
      assert.deepEqual(page._scheme.fixtureIdsByGroup[otherGroupId], otherFixtureIds)
    }

    const writesBeforeValidQuantity = runtime.stats.writes
    page.onCardQuantityInput(runtime.event({ index: 0 }, { value: '5' }))
    page.onCardQuantityBlur(runtime.event({ index: 0 }, { value: '5' }))
    assert.equal(page.data.pendingChange?.kind, 'edit')
    assert.equal(page.data.pendingChange?.valid, true)
    assert.equal(runtime.stats.writes, writesBeforeValidQuantity, 'Quantity impact preview must not persist before confirmation')
    page.confirmPendingChange()

    snapshot = runtime.workspace.readLightingWorkspace().scheme
    assert.equal(snapshot.preferences.groups[0].fixtureCount, '5', 'Confirmed quantity must be persisted')
    assert.equal(snapshot.preferences.groups[0].channelCount, '5')
    assert.equal(snapshot.preferences.groups[1].fixtureModel, 'TL-SL323')
    assert.equal(snapshot.preferences.groups[1].fixtureCount, '2')
    assert.deepEqual(snapshot.fixtureIdsByGroup[firstGroupId].slice(0, 3), firstFixtureIds)
    assert.deepEqual(snapshot.fixtureIdsByGroup[otherGroupId], otherFixtureIds)
    assert.deepEqual(snapshot.layout.positionsById[otherFixtureId], otherPlacement, 'Quantity editing changed an unrelated fixture placement')

    page.closeFloatingCard()
    await wait(260)
    assert.equal(page.data.floatingVisible, false, 'The outside-tap handler must dismiss the floating card')
    assert.equal(page.data.floatingGroup, null)

    page.openFloatingCard(runtime.event({ index: 0 }))
    await wait(35)
    const start = { clientX: 80, clientY: 100 }
    page.onFloatingTouchStart({ touches: [start], changedTouches: [start] })
    page.onFloatingTouchMove({ touches: [{ clientX: 180, clientY: 103 }], changedTouches: [{ clientX: 180, clientY: 103 }] })
    assert.equal(page.data.floatingSwipeDragging, true)
    assert.equal(page.data.floatingSwipeOffset, 100)
    page.onFloatingTouchEnd({ touches: [], changedTouches: [{ clientX: 180, clientY: 103 }] })
    await wait(260)
    assert.equal(page.data.floatingVisible, false, 'A right swipe must dismiss the floating card')

    page.openFloatingCard(runtime.event({ index: 0 }))
    await wait(35)
    page.onFloatingTouchStart({ touches: [start], changedTouches: [start] })
    page.onHide()
    const patchesAfterHide = page._qaPatches.length
    const writesAfterHide = runtime.stats.writes
    page.onFloatingTouchCancel()
    assert.equal(page._qaPatches.length, patchesAfterHide, 'A late gesture callback must not update a hidden page')
    assert.equal(runtime.stats.writes, writesAfterHide, 'A late gesture callback must not write from a hidden page')

    page.onShow()
    page.openFloatingCard(runtime.event({ index: 0 }))
    await wait(35)
    page.onFloatingTouchStart({ touches: [start], changedTouches: [start] })
    page.onUnload()
    const patchesAfterUnload = page._qaPatches.length
    const writesAfterUnload = runtime.stats.writes
    page.onFloatingTouchCancel()
    assert.equal(page._qaPatches.length, patchesAfterUnload, 'A late gesture callback must not update an unloaded page')
    assert.equal(runtime.stats.writes, writesAfterUnload, 'A late gesture callback must not write from an unloaded page')

    console.log('DMX floating-card contract passed: catalog mode, invalid/valid quantity, persisted unrelated state, outside tap, right swipe, lifecycle')
  } finally {
    runtime.dispose()
  }
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
const assert = require('node:assert/strict')
const { createRuntime, clone } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')
const { resolveSavedLayout } = require('../pages/dmx-layout/layout-storage')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function testLateMeasureAfterUnload() {
  const r = createRuntime({ deferSelectors: true }); r.seed()
  try {
    const page = r.make()
    assert(r.selectors.length > 0, 'Actual lifecycle did not queue canvas measurements')
    page.onUnload(); page._qaActive = false
    const before = { patches: page._qaPatches.length, draw: r.stats.draw, writes: r.stats.writes }
    r.drain(r.selectors)
    assert.equal(page._qaPatches.length, before.patches, 'Unloaded selector callback wrote view state')
    assert.equal(r.stats.draw, before.draw, 'Unloaded selector callback drew canvas')
    assert.equal(r.stats.writes, before.writes, 'Unloaded selector callback wrote migrated storage')
  } finally { r.dispose() }
}

function testHideShowMeasurementOrdering() {
  const r = createRuntime({ deferSelectors: true }); r.seed()
  try {
    const page = r.make(), old = r.selectors.splice(0)
    assert(old.length)
    page.onCanvasTouchStart({ touches: [{ clientX: 12, clientY: 132 }] })
    assert.equal(page.data.scrollEnabled, false)
    page.onHide()
    assert.equal(page.data.scrollEnabled, true, 'Interrupted empty-space gesture locked scrolling')
    const hidden = { patches: page._qaPatches.length, draw: r.stats.draw, selectors: r.selectors.length }
    page.measureCanvas(() => page.drawLayout())
    assert.equal(r.selectors.length, hidden.selectors, 'Hidden page scheduled a new measurement')
    for (const item of old) item.run({ left: 1, top: 1, width: 100, height: 100 })
    assert.equal(page._qaPatches.length, hidden.patches, 'Hidden selector callback changed state')
    assert.equal(r.stats.draw, hidden.draw, 'Hidden selector callback drew')
    page.onShow()
    const first = r.selectors.shift(); assert(first)
    page.measureCanvas(() => page.drawLayout())
    const second = r.selectors.pop(); assert(second)
    second.run({ left: 9, top: 19, width: 300, height: 500 })
    const draw = r.stats.draw
    first.run({ left: 2, top: 3, width: 200, height: 200 })
    assert.deepEqual(page._canvasRect, { left: 9, top: 19, width: 300, height: 500 }, 'Old measurement overwrote newer CSS logical-pixel geometry')
    assert.equal(r.stats.draw, draw, 'Old measurement redrew with stale dimensions')
  } finally { r.dispose() }
}

async function testInterruptedFineDragIsCoherent() {
  for (const interrupt of ['pinch', 'hide', 'unload', 'cancel']) {
    const r = createRuntime(); r.seed()
    try {
      const page = r.make(); r.place(page)
      const fixture = page._fixtures[0], id = fixture.stableId
      const before = clone(page._layout), checks = clone(page._scheme.checksById), addresses = page._fixtures.map(item => item.addressText)
      const geometry = page.getGeometry(), position = page._layout.positionsById[id]
      const rod = geometry.rods.find(item => item.id === position.rodId)
      const logical = r.model.layoutFixturePoint(geometry, rod, position)
      const touch = point => ({ clientX: r.rect.left + point.x * r.rect.width / page.data.canvasWidth, clientY: r.rect.top + point.y * r.rect.height / page.data.canvasHeight })
      page.onCanvasTouchStart({ touches: [touch(logical)] })
      await wait(410)
      assert.equal(page._touchState?.dragging, true, 'Real long press did not start fine adjustment')
      const changedPoint = { x: logical.x + (rod.x2 - rod.x1) * .18, y: logical.y + (rod.y2 - rod.y1) * .18 }
      page.onCanvasTouchMove({ touches: [touch(changedPoint)] })
      assert.notDeepEqual(page._layout.positionsById[id], before.positionsById[id], 'Drag did not change its tentative position')
      if (interrupt === 'pinch') { page.onCanvasTouchStart({ touches: [{ clientX: 100, clientY: 200 }, { clientX: 200, clientY: 200 }] }); page.onCanvasTouchEnd({ touches: [] }) }
      if (interrupt === 'hide') { page.onHide(); page.onShow() }
      if (interrupt === 'unload') { page.onUnload(); page._qaActive = false }
      if (interrupt === 'cancel') page.onCanvasTouchCancel({ touches: [], changedTouches: [] })
      const saved = r.workspace.readLightingWorkspace().scheme
      assert.deepEqual(page._layout, saved.layout, interrupt + ': visual and persisted positions diverged')
      // Current implementation explicitly rolls back unfinished fine drags.
      assert.deepEqual(page._layout.positionsById[id], before.positionsById[id], interrupt + ': unfinished drag did not roll back')
      assert.deepEqual(saved.checksById, checks, interrupt + ': position interaction changed address checks')
      assert.deepEqual(page._fixtures.map(item => item.addressText), addresses)
      assert.equal(page.data.scrollEnabled, true)
    } finally { r.dispose() }
  }
}

function testSavedLayoutRecoveryPolicy() {
  for (const preserveUnplaced of [false, true]) {
    const legacy = { rowCount: 2, schemeId: 'full', sidePairManual: true, sidePairCount: 1, frontDirection: 'up', stageWidthText: '12', stageDepthText: '8', preserveUnplaced, positions: {}, barCounts: [[1], [1], [0], [0], [0]] }
    const r = createRuntime(); r.seed(undefined, legacy)
    try {
      const portrait = r.make(), expected = resolveSavedLayout(legacy, portrait._fixtures, portrait._groups)
      assert.equal(Object.keys(portrait._layout.positionsById).length, Object.keys(expected.positions).length, 'Migration reinterpreted legacy missing-placement policy')
      assert.equal(portrait.data.placedFixtureCount + portrait.data.unplacedFixtureCount, 4)
      assert.equal(portrait.data.unplacedFixtureCount, preserveUnplaced ? 4 : 0)
      assert(portrait._layout.legacySideRods.length > 0, 'Effective side rods were dropped')
      const saved = r.workspace.readLightingWorkspace().scheme
      assert.deepEqual(saved.legacySideLayout, legacy, 'Original migration snapshot was rewritten')
      const landscape = r.make('landscape')
      assert.deepEqual(landscape._layout, portrait._layout)
      landscape.onUnload(); landscape._qaActive = false; portrait.onShow()
      assert.deepEqual(portrait._layout, saved.layout, 'Orientation return changed recovered positions')
    } finally { r.dispose() }
  }
}

function testHiddenExportCancelsAndCanRetry() {
  for (const stage of ['selector', 'native']) {
    const r = createRuntime({ deferTicks: true, deferExports: true }); r.seed()
    try {
      const page = r.make()
      r.state.deferSelectors = true
      page.generateLayoutImage()
      assert.equal(r.selectors.length, 1, 'Export should wait for its real selector query')
      if (stage === 'native') { r.drain(r.selectors); assert.equal(r.exports.length, 1) }
      page.onHide()
      const before = { patches: page._qaPatches.length, exports: r.exports.length, toasts: r.toasts.length }
      r.drain(r.ticks); r.drain(r.selectors); r.drain(r.frames)
      if (stage === 'native') { r.exports[0].success({ tempFilePath: 'hidden.png' }); r.exports[0].fail({ errMsg: 'hidden failure' }) }
      assert.equal(page._qaPatches.length, before.patches, 'Hidden export callback changed state')
      assert.equal(r.exports.length, before.exports, 'Hidden export callback started native conversion')
      assert.equal(r.toasts.length, before.toasts, 'Hidden export claimed success/failure')
      assert.equal(page.data.isGeneratingImage, false)
      assert.equal(page.data.previewVisible, false)
      r.state.deferTicks = false; r.state.deferSelectors = false; r.state.deferExports = false
      page.onShow(); page.generateLayoutImage()
      assert.equal(page.data.previewVisible, true, 'Export could not retry after return')
      assert(page.data.layoutImagePaths.length > 0)
    } finally { r.dispose() }
  }
}

;(async () => {
  let failures = 0
  for (const test of [testLateMeasureAfterUnload, testHideShowMeasurementOrdering, testInterruptedFineDragIsCoherent, testSavedLayoutRecoveryPolicy, testHiddenExportCancelsAndCanRetry]) {
    try { await test(); console.log('PASS ' + test.name) } catch (error) { failures++; console.error('FAIL ' + test.name + '\n' + error.stack) }
  }
  assert.equal(failures, 0, 'dmx-lifecycle-regression: controller failures')
  console.log('dmx-lifecycle-regression: 5 checks passed (4 gesture interruptions; 2 hidden export stages)')
})().catch(error => { console.error(error); process.exitCode = 1 })

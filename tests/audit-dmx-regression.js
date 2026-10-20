const assert = require('node:assert/strict')
const { createRuntime, clone, stageLightingProductIndex } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

// Old layout-only check controls moved to the lifted address card. The safety
// requirement remains synchronization through real storage in both orientations.
function testProgressReload() {
  const r = createRuntime(); r.seed()
  try {
    const main = r.make('main'), portrait = r.make(), landscape = r.make('landscape')
    const fixture = main._calculationResult.fixtures[0]
    r.checkMain(main, fixture)
    for (const layout of [portrait, landscape]) {
      layout.setData({ layoutImagePath: 'stale.png', layoutImagePaths: ['stale.png'], previewVisible: true })
      layout.onShow()
      assert(layout._scheme.checksById[fixture.stableId], 'Check did not reload by stable identity')
      assert(layout.data.placementGroups.flatMap(group => group.fixtures).find(item => item.id === fixture.stableId).checked)
      assert.equal(layout.data.previewVisible, false, 'Return kept an outdated exported preview')
      assert.equal(layout.data.layoutImagePath, '', 'Return kept an outdated exported image')
    }
    r.checkMain(main, fixture); portrait.onShow(); landscape.onShow()
    assert(!portrait._scheme.checksById[fixture.stableId]); assert(!landscape._scheme.checksById[fixture.stableId])
    assert.deepEqual(portrait._fixtures.map(item => item.stableId), landscape._fixtures.map(item => item.stableId))
  } finally { r.dispose() }
}

function testSettingsAndPan() {
  const r = createRuntime(); r.seed()
  try {
    const page = r.make(); r.place(page)
    const beforeAddresses = page._fixtures.map(item => item.addressText), beforeChecks = clone(page._scheme.checksById)
    page.openLayoutSettings()
    page.changeDraftRodCount(r.event({ kind: 'internalRods', delta: 1 }))
    assert.equal(page._layout.internalRods.length, 3, 'Draft changed persisted rods before apply')
    page.onDraftStageInput(r.event({ key: 'stageWidthText' }, { value: '14' }))
    page.applyLayoutSettings()
    assert.equal(page._layout.internalRods.length, 4)
    assert.equal(page._layout.stageWidthText, '14')
    assert.equal(page.data.placedFixtureCount + page.data.unplacedFixtureCount, 4)
    assert.deepEqual(page._fixtures.map(item => item.addressText), beforeAddresses)
    assert.deepEqual(page._scheme.checksById, beforeChecks)
    // Empty-space one-finger panning is explicitly allowed by the new handoff.
    const start = { clientX: 12, clientY: 132 }
    page.onCanvasTouchStart({ touches: [start] })
    page.onCanvasTouchMove({ touches: [{ clientX: 42, clientY: 147 }] })
    page.onCanvasTouchEnd({ touches: [] })
    assert.notEqual(page._view.x, 0, 'Empty-space panning did not move the view')
    const oldView = clone(page._view), a = { clientX: 100, clientY: 220 }, b = { clientX: 200, clientY: 220 }
    const center = page.canvasPoint({}, { clientX: 150, clientY: 220 })
    const anchor = r.model.transformViewPointInverse(center, oldView)
    page.onCanvasTouchStart({ touches: [a, b] })
    page.onCanvasTouchMove({ touches: [{ clientX: 50, clientY: 220 }, { clientX: 250, clientY: 220 }] })
    assert(page._view.s > oldView.s)
    const after = r.model.transformViewPointInverse(center, page._view)
    assert(Math.abs(after.x - anchor.x) < 1e-8 && Math.abs(after.y - anchor.y) < 1e-8, 'Pinch lost its logical anchor')
    assert(Object.values(page._view).every(Number.isFinite))
    page.onCanvasTouchEnd({ touches: [] })
    assert.equal(page.data.scrollEnabled, true)
  } finally { r.dispose() }
}

function testGenerationGuard() {
  for (const stage of ['selector', 'native-success', 'native-fail']) {
    const r = createRuntime({ deferTicks: true, deferExports: true }); r.seed()
    try {
      const page = r.make()
      r.state.deferSelectors = true
      page.generateLayoutImage()
      assert.equal(r.selectors.length, 1, 'Export must wait for its native canvas-node selector query')
      if (stage !== 'selector') { r.drain(r.selectors); assert.equal(r.exports.length, 1) }
      page.onUnload(); page._qaActive = false
      const before = { patches: page._qaPatches.length, writes: r.stats.writes, toasts: r.toasts.length, draws: r.stats.draw, exports: r.exports.length }
      r.drain(r.ticks); r.drain(r.selectors); r.drain(r.frames)
      if (stage === 'native-success') r.exports[0].success({ tempFilePath: 'late.png' })
      if (stage === 'native-fail') r.exports[0].fail({ errMsg: 'late native failure' })
      assert.equal(page._qaPatches.length, before.patches, stage + ': late view write')
      assert.equal(r.stats.writes, before.writes, stage + ': late storage write')
      assert.equal(r.toasts.length, before.toasts, stage + ': late toast')
      assert.equal(r.stats.draw, before.draws, stage + ': late raw 2D drawing')
      assert.equal(r.exports.length, before.exports, stage + ': late native export')
      assert.equal(page.data.previewVisible, false)
      assert.equal(page.data.layoutImagePath, '')
      assert(r.stats.hideLoading > 0)
    } finally { r.dispose() }
  }
}

function testHistoricalCustomModelCache() {
  const product = stageLightingProductIndex.get('TL-SL323')
  const r = createRuntime(); r.seed([{ name: '历史自定义灯', fixtureSource: 'custom', fixtureModel: product.model, fixtureCount: '2', channelCount: '8', libraryChannelCount: '2', targetUniverse: 'A' }])
  try {
    const main = r.make('main')
    assert.equal(main.data.groups[0].fixtureModel, product.model, 'Historical recovery cache was lost')
    assert.equal(main._calculationResult.fixtures[0].fixtureModel, '', 'Custom calculation leaked a library model')
    main.openFixtureChannelGuide(r.event({ globalIndex: 1 }))
    assert.equal(main.data.fixtureChannelGuide, null, 'Historical custom result opened an unrelated channel profile')
    const before = clone(r.workspace.readLightingWorkspace().scheme), writes = r.stats.writes
    main.openModelPicker(r.event({ index: 0 })); main.selectFixture(r.event({ model: product.model }))
    assert(main.data.pendingChange?.valid, 'Real catalog replacement must provide a valid preview')
    assert.equal(r.stats.writes, writes, 'Preview wrote storage')
    main.cancelPendingChange()
    assert.deepEqual(r.workspace.readLightingWorkspace().scheme, before, 'Cancel changed historical data')
    main.openModelPicker(r.event({ index: 0 })); main.selectFixture(r.event({ model: product.model })); main.confirmPendingChange()
    assert.equal(main._calculationResult.fixtures[0].fixtureModel, product.model)
    assert.equal(main._calculationResult.fixtures[0].channelCount, product.channelModes[0])
    assert.equal(main._calculationResult.fixtures.length, 2)
  } finally { r.dispose() }
}

let failures = 0
for (const test of [testProgressReload, testSettingsAndPan, testGenerationGuard, testHistoricalCustomModelCache]) {
  try { test(); console.log('PASS ' + test.name) } catch (error) { failures++; console.error('FAIL ' + test.name + '\n' + error.stack) }
}
assert.equal(failures, 0, 'audit-dmx-regression: controller failures')
console.log('audit-dmx-regression: 4 real-controller checks passed (including 3 selector/export interruption stages)')

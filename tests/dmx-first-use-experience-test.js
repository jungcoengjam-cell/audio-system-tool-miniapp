const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone, stageLightingProductIndex } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')
const root = path.resolve(__dirname, '..')

function testTemporaryFirstUseAndReopen() {
  const r = createRuntime(); r.seed()
  try {
    const page = r.make()
    assert.equal(page._contextId, 'temporary')
    assert.equal(page.data.contextLabel, '临时设置')
    assert.equal(page.data.hasPlan, true, 'A project must not be required')
    assert.equal(page.data.placedFixtureCount, 0, 'New workspaces must wait for real placement')
    assert.equal(page.data.unplacedFixtureCount, 4)
    const ids = page._fixtures.map(item => item.stableId)
    assert.equal(new Set(ids).size, 4)
    assert.equal(page.saveLayoutOnly(clone(page._layout)), true)
    const saved = clone(r.workspace.readLightingWorkspace().scheme)
    page.onUnload(); page._qaActive = false
    const reopen = r.make()
    assert.deepEqual(reopen._fixtures.map(item => item.stableId), ids)
    assert.deepEqual(reopen._layout, saved.layout)
    assert.equal(reopen.data.unplacedFixtureCount, 4)
    assert.deepEqual(r.storage.get('audioTool.projects.v1') || [], [], 'First use created a project')
  } finally { r.dispose() }
}

function testSettingsPreserveAndExplicitArrangeUndo() {
  const r = createRuntime(); r.seed()
  try {
    const page = r.make(); r.place(page, 0); r.place(page, 1)
    const custom = clone(page._layout), ids = Object.keys(custom.positionsById)
    custom.positionsById[ids[0]].t = .13; custom.positionsById[ids[1]].t = .81
    assert(page.saveLayoutOnly(custom))
    page.openLayoutSettings(); page.onDraftStageInput(r.event({ key: 'stageWidthText' }, { value: '13' })); page.applyLayoutSettings()
    assert.deepEqual(page._layout.positionsById, custom.positionsById, 'Default settings reordered manual fixtures')
    const before = clone(page._layout), writes = r.stats.writes
    page.openLayoutSettings(); page.onDraftArrangementTap(r.event({ mode: 'uniform' })); page.applyLayoutSettings()
    assert.equal(r.modals.length, 1, 'Explicit arrangement lacks overwrite confirmation')
    assert.match(r.modals[0].content, /2/)
    r.answer(false)
    assert.deepEqual(page._layout, before); assert.equal(r.stats.writes, writes, 'Cancel wrote a layout')
    page.applyLayoutSettings(); r.answer(true)
    assert.notDeepEqual(page._layout.positionsById, before.positionsById)
    assert.equal(page.data.layoutUndoVisible, true)
    const main = r.make('main'), fixture = main._calculationResult.fixtures[0]
    r.checkMain(main, fixture)
    page._view = { s: 1.7, x: 12, y: -4 }
    page.setData({ layoutImagePath: 'obsolete.png', previewVisible: true })
    page.undoLayoutArrangement()
    const latest = r.workspace.readLightingWorkspace().scheme
    assert.deepEqual(latest.layout.positionsById, before.positionsById, 'Undo did not restore manual positions exactly')
    assert(latest.checksById[fixture.stableId], 'Layout undo rolled back a later independent address check')
    assert.deepEqual(page._view, { s: 1.7, x: 12, y: -4 }, 'Layout undo reset independent zoom/pan')
    assert.equal(page.data.layoutUndoVisible, false)
    assert.equal(page.data.previewVisible, false, 'Layout undo kept stale export')
    assert.equal(page.data.layoutImagePath, '')
    // Subsequent geometry changes invalidate an older layout-only undo.
    page.openLayoutSettings(); page.onDraftArrangementTap(r.event({ mode: 'uniform' })); page.applyLayoutSettings(); r.answer(true)
    assert.equal(page.data.layoutUndoVisible, true)
    page.openLayoutSettings(); page.onDraftStageInput(r.event({ key: 'stageDepthText' }, { value: '9' })); page.applyLayoutSettings()
    assert.equal(page.data.layoutUndoVisible, false)
    const after = clone(page._layout); page.undoLayoutArrangement(); assert.deepEqual(page._layout, after)
  } finally { r.dispose() }
}

async function testRodReductionCancelConfirm() {
  const r = createRuntime(); r.seed()
  try {
    const page = r.make(), lastRod = page._layout.internalRods.at(-1).id
    page.assignFixtureToRod(page._fixtures[0], lastRod)
    const main = r.make('main'); r.checkMain(main, main._calculationResult.fixtures[0]); page.onShow()
    const before = clone(page._layout), addresses = page._fixtures.map(item => item.addressText), checks = clone(page._scheme.checksById), writes = r.stats.writes
    page.openLayoutSettings(); page.changeDraftRodCount(r.event({ kind: 'internalRods', delta: -1 })); page.applyLayoutSettings()
    assert.equal(page.data.reductionConfirm.fixtures.length, 1)
    assert.equal(page._layout.internalRods.length, 3)
    page.cancelLayoutReduction()
    assert.deepEqual(page._layout, before); assert.equal(r.stats.writes, writes)
    assert.equal(page._pendingSettingsLayout, null, 'Cancelling invalidates the candidate before its visual exit')
    await new Promise(resolve => setTimeout(resolve, 210))
    page.applyLayoutSettings(); page.confirmLayoutReduction()
    assert.equal(page._layout.internalRods.length, 2)
    assert.equal(page.data.placedFixtureCount, 0)
    assert.equal(page.data.unplacedFixtureCount, 4)
    assert.deepEqual(page._fixtures.map(item => item.addressText), addresses)
    assert.deepEqual(r.workspace.readLightingWorkspace().scheme.checksById, checks)
  } finally { r.dispose() }
}

function testPortraitReopenAndStaleUnload() {
  const r = createRuntime(); r.seed()
  try {
    const portrait = r.make(); r.place(portrait)
    assert.equal(typeof portrait.openLandscapeLayout, 'undefined')
    const landscape = r.make('portrait', { lightingContextId: portrait._contextId })
    assert.deepEqual(landscape._layout, portrait._layout)
    landscape.assignFixtureToRod(landscape._fixtures[1], landscape._layout.frontRods[0].id)
    landscape.goBack(); assert.equal(r.navigation.at(-1).type, 'navigateBack')
    portrait.onShow()
    const latest = clone(r.workspace.readLightingWorkspace().scheme.layout)
    assert.deepEqual(portrait._layout, latest)
    // The earlier page instance must never flush an obsolete local copy.
    landscape._layout.positionsById[landscape._fixtures[0].stableId].t = .987
    landscape.onHide(); landscape.onUnload(); landscape._qaActive = false
    assert.deepEqual(r.workspace.readLightingWorkspace().scheme.layout, latest)
  } finally { r.dispose() }
}

function testNavigationFailureKeepsEditingSaveable() {
  for (const kind of ['portrait', 'landscape']) {
    const r = createRuntime(); r.seed()
    try {
      const page = r.make(kind); r.state.failNavigation = true
      page.goBack(); assert(r.navigation.length > 0)
      r.place(page, 1)
      assert.equal(r.workspace.readLightingWorkspace().scheme.layout.positionsById[page._fixtures[1].stableId].rodId, page._layout.internalRods[0].id)
      assert.equal(page._layoutDirty, false, 'Failed navigation permanently disabled saving')
      const saved = clone(r.workspace.readLightingWorkspace().scheme.layout)
      page.onHide(); page.onUnload(); page._qaActive = false
      assert.deepEqual(r.workspace.readLightingWorkspace().scheme.layout, saved)
    } finally { r.dispose() }
  }
}

function testModalCompletionAfterHideIsIgnored() {
  for (const returnBeforeAnswer of [false, true]) {
    const r = createRuntime(); r.seed()
    try {
      const page = r.make(); r.place(page)
      page.openLayoutSettings(); page.onDraftArrangementTap(r.event({ mode: 'uniform' })); page.applyLayoutSettings()
      assert.equal(r.modals.length, 1)
      const before = clone(page._layout)
      page.onHide(); if (returnBeforeAnswer) page.onShow()
      const writes = r.stats.writes, patches = page._qaPatches.length
      r.answer(true)
      assert.deepEqual(page._layout, before, 'Modal from a prior visibility session rearranged fixtures')
      assert.equal(r.stats.writes, writes, 'Late modal wrote layout storage')
      assert.equal(page._qaPatches.length, patches, 'Late modal changed view state')
    } finally { r.dispose() }
  }
}

function testActualMainCapabilitiesRemainReachable() {
  const r = createRuntime(); r.seed()
  try {
    const main = r.make('main'), wxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
    for (const method of ['openFloatingCard', 'toggleFixtureCheck', 'openFixtureChannelGuide']) {
      const gesture = method === 'openFixtureChannelGuide' ? '(?:tap|longpress)' : 'tap'
      assert(new RegExp('(?:bind|catch)' + gesture + '="' + method + '"').test(wxml), method + ' has no rendered entry')
      assert.equal(typeof main[method], 'function')
    }
    assert(!/(?:bind|catch)tap="onOpenCombinedExport"/.test(wxml), 'Main share entry must stay removed as requested')
    for (const method of ['copyResult', 'toggleCurrentFavorite', 'openBatchFixtureSearch', 'onOpenCombinedExport']) {
      assert.equal(typeof main[method], 'function', method + ' behavior method was removed')
    }
    const fixture = main._calculationResult.fixtures[0]
    main.openFixtureChannelGuide(r.event({ globalIndex: fixture.globalIndex }))
    assert(main.data.fixtureChannelGuide?.channels.length > 0, 'Real supported profile failed to open')
    assert.equal(main.data.fixtureChannelGuide.model, fixture.fixtureModel)
    main.closeFixtureChannelGuide(); main.copyResult(); assert.match(r.stats.clipboard.at(-1), /A001/)
    main.toggleCurrentFavorite(); assert.equal(main.data.currentFavorite, true)
    const count = main._calculationResult.fixtures.length
    main.openBatchFixtureSearch(); assert.equal(main.data.fixtureBatchOpen, true)
    const product = stageLightingProductIndex.get('TL-SK3101')
    main.selectFixture(r.event({ model: product.model })); assert(main.data.batchSelectedItems.length > 0)
    main.confirmBatchAdd(); assert(main._calculationResult.fixtures.length > count)
    main.onOpenCombinedExport()
    const navigation = new URL(r.navigation.at(-1).url, 'https://qa.invalid')
    assert.equal(navigation.pathname, '/pages/dmx-layout/dmx-layout')
    assert.equal(navigation.searchParams.get('openExport'), '1')
    const layout = r.make('portrait', Object.fromEntries(navigation.searchParams))
    assert.equal(layout.data.previewVisible, true, 'Header export did not reach the combined exporter')
    assert.equal(layout._exportSnapshot.fixtures.length, main._calculationResult.fixtures.length)
  } finally { r.dispose() }
}

;(async () => {
  let failures = 0
  for (const test of [testTemporaryFirstUseAndReopen, testSettingsPreserveAndExplicitArrangeUndo, testRodReductionCancelConfirm, testPortraitReopenAndStaleUnload, testNavigationFailureKeepsEditingSaveable, testModalCompletionAfterHideIsIgnored, testActualMainCapabilitiesRemainReachable]) {
    try { await test(); console.log('PASS ' + test.name) } catch (error) { failures++; console.error('FAIL ' + test.name + '\n' + error.stack) }
  }
  assert.equal(failures, 0, 'dmx-first-use-experience-test: controller failures')
  console.log('dmx-first-use-experience-test: 7 real-controller checks passed')
})().catch(error => { console.error(error); process.exitCode = 1 })

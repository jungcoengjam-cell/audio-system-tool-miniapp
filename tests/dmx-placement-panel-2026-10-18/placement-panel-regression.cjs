const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const root = path.resolve(__dirname, '../..')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function testPreviewScrollAndTapAreReadOnly() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    const fixture = page._fixtures[0]
    runtime.place(page, 0)
    page.openPlacementPanel()
    const beforeLayout = clone(page._layout)
    const beforeChecks = clone(page._scheme.checksById)
    const writes = runtime.stats.writes
    const patchStart = page._qaPatches.length

    page.onPreviewScroll({ detail: { scrollLeft: 112, scrollWidth: 620, width: 240 } })
    await wait(55)
    const scrollPatches = page._qaPatches.slice(patchStart)
    assert(scrollPatches.every((patch) => !Object.hasOwn(patch, 'previewScrollLeft')))
    assert.equal(runtime.stats.writes, writes)
    assert.deepEqual(page._layout, beforeLayout)
    assert.deepEqual(page._scheme.checksById, beforeChecks)

    page.onPreviewFixtureTap(runtime.event({ fixtureId: fixture.stableId }))
    assert.equal(page.data.selectedFixtureId, fixture.stableId)
    assert.deepEqual(page._layout, beforeLayout, 'Selecting a preview lamp changed its placement')
    assert.deepEqual(page._scheme.checksById, beforeChecks, 'Selecting a preview lamp changed field checks')
    assert.equal(runtime.stats.writes, writes, 'Selecting a preview lamp wrote storage')
  } finally {
    // The pending range update has a bounded 40ms timer; dispose invalidates it.
    runtime.dispose()
  }
}

function testClearLayoutPreservesTheSchemeAndHandlesFailure() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    runtime.place(page, 0, 0)
    runtime.place(page, 1, 1)
    const before = clone(runtime.workspace.readLightingWorkspace().scheme)
    page.openPlacementPanel()
    const writes = runtime.stats.writes

    page.clearLayoutImage()
    assert.equal(runtime.modals.length, 1)
    runtime.answer(false)
    assert.equal(runtime.stats.writes, writes, 'Canceling clear wrote storage')
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme.layout, before.layout)

    page.clearLayoutImage()
    page.clearLayoutImage()
    assert.equal(runtime.modals.length, 1, 'A duplicate clear confirmation was opened')
    runtime.answer(true)
    const saved = runtime.workspace.readLightingWorkspace().scheme
    const expectedLayout = clone(before.layout)
    expectedLayout.positionsById = {}
    assert.deepEqual(saved.layout, expectedLayout, 'Clear changed data beyond positionsById')
    assert.deepEqual(saved.preferences, before.preferences)
    assert.deepEqual(saved.groupIds, before.groupIds)
    assert.deepEqual(saved.fixtureIdsByGroup, before.fixtureIdsByGroup)
    assert.deepEqual(saved.checksById, before.checksById)
    assert.equal(page.data.placedFixtureCount, 0)
    assert.equal(page.data.unplacedFixtureCount, page._fixtures.length)
    assert.equal(page.data.layoutUndoVisible, false, 'Clear retained an older arrangement undo')
  } finally { runtime.dispose() }

  const failed = createRuntime()
  failed.seed()
  try {
    const page = failed.make()
    failed.place(page, 0)
    const persisted = clone(failed.workspace.readLightingWorkspace().scheme.layout)
    page.openPlacementPanel()
    failed.state.failWrites = true
    page.clearLayoutImage()
    failed.answer(true)
    assert.deepEqual(failed.workspace.readLightingWorkspace().scheme.layout, persisted, 'Failed clear changed storage')
    assert.deepEqual(page._layout.positionsById, {}, 'Failed clear discarded the retryable local edit')
    assert.equal(page._layoutDirty, true)
    assert.match(page.data.placementNotice, /未保存/)
    failed.state.failWrites = false
    page.retryLayoutSave()
    assert.deepEqual(failed.workspace.readLightingWorkspace().scheme.layout.positionsById, {})
    assert.equal(page._layoutDirty, false)
  } finally { failed.dispose() }
}

function testLateClearAfterHideCannotWrite() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    runtime.place(page, 0)
    const saved = clone(runtime.workspace.readLightingWorkspace().scheme.layout)
    page.openPlacementPanel()
    page.clearLayoutImage()
    const writes = runtime.stats.writes
    page.onHide()
    runtime.answer(true)
    assert.equal(runtime.stats.writes, writes)
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme.layout, saved)
  } finally { runtime.dispose() }
}

function testClearWithStaleLayoutFingerprintCannotOverwrite() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    runtime.place(page, 0)
    page.openPlacementPanel()
    page.clearLayoutImage()
    const latest = runtime.workspace.readLightingWorkspace()
    const external = clone(latest.scheme)
    external.layout.stageDepthText = '13'
    assert(runtime.workspace.saveLightingScheme(latest.contextId, external, latest.revision).ok)
    const writes = runtime.stats.writes
    runtime.answer(true)
    assert.equal(runtime.stats.writes, writes, 'A stale clear confirmation performed another write')
    const saved = runtime.workspace.readLightingWorkspace().scheme.layout
    assert.equal(saved.stageDepthText, '13', 'Clear replaced an independently updated layout')
    assert.notDeepEqual(saved.positionsById, {}, 'Stale clear emptied the new layout')
  } finally { runtime.dispose() }
}

function testBatchPickerCanReselectTheFirstRodAfterTargetRemoval() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    page.openLayoutSettings()
    page.onDraftArrangementTap(runtime.event({ mode: 'unplaced' }))
    const rods = page.data.layoutDraft.internalRods
    const options = page.data.batchRodOptions
    assert.equal(options[0].id, '', 'Picker needs a real placeholder at native index 0')
    assert.equal(page.data.batchRodCount, rods.length + page.data.layoutDraft.frontRods.length)
    assert.equal(options[1].id, rods[0].id, 'First live rod must be at native index 1')
    const lastIndex = options.findIndex((option) => option.id === rods.at(-1).id)
    page.onBatchTargetRodChange(runtime.event({}, { value: lastIndex }))
    assert.equal(page.data.batchTargetRodId, rods.at(-1).id)

    page.changeDraftRodCount(runtime.event({ kind: 'internalRods', delta: -1 }))
    assert.equal(page.data.batchTargetRodId, '', 'Deleting the selected target must clear it')
    assert.equal(page.data.batchTargetRodIndex, 0)
    assert.equal(page.data.batchRodOptions[0].id, '')
    page.onBatchTargetRodChange(runtime.event({}, { value: 1 }))
    assert.equal(page.data.batchTargetRodId, rods[0].id, 'Selecting native index 1 must select the first real rod')
    assert.equal(page.data.batchTargetRodIndex, 1)

    page.changeDraftRodCount(runtime.event({ kind: 'internalRods', delta: -1 }))
    page.changeDraftRodCount(runtime.event({ kind: 'internalRods', delta: -1 }))
    while (page.data.layoutDraft.frontRods.length) {
      page.changeDraftRodCount(runtime.event({ kind: 'frontRods', delta: -1 }))
    }
    assert.equal(page.data.batchRodCount, 0, 'Removing every candidate rod must update the no-rod state')
    assert.equal(page.data.batchArrangementEnabled, false)
    const revision = runtime.workspace.readLightingWorkspace().revision
    const writes = runtime.stats.writes
    page.applyLayoutSettings()
    assert.equal(runtime.workspace.readLightingWorkspace().revision, revision, 'Applying without rods wrote a batch')
    assert.equal(runtime.stats.writes, writes)
  } finally { runtime.dispose() }
}

function testBatchModeWithNoUnplacedFixturesIsInert() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    const targetId = page._layout.internalRods[0].id
    page._fixtures.forEach((fixture) => page.assignFixtureToRod(fixture, targetId))
    page.openLayoutSettings()
    page.onDraftArrangementTap(runtime.event({ mode: 'unplaced' }))
    assert.equal(page.data.batchUnplacedCount, 0)
    assert.equal(page.data.batchArrangementEnabled, false)
    const revision = runtime.workspace.readLightingWorkspace().revision
    const writes = runtime.stats.writes
    page.applyLayoutSettings()
    assert.equal(runtime.workspace.readLightingWorkspace().revision, revision)
    assert.equal(runtime.stats.writes, writes)
    assert.equal(runtime.modals.length, 0)
  } finally { runtime.dispose() }
}

function testBatchArrangementCombinesRemovedAndUnplacedFixturesAndUndo() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    const main = runtime.make('main')
    runtime.checkMain(main, main._calculationResult.fixtures[0])
    page.onShow()

    const fixtures = page._fixtures
    const targetId = page._layout.internalRods[0].id
    const removedId = page._layout.internalRods.at(-1).id
    const frontId = page._layout.frontRods[0].id
    page.assignFixtureToRod(fixtures[0], targetId)
    page.assignFixtureToRod(fixtures[1], removedId)
    page.assignFixtureToRod(fixtures[2], frontId)
    const before = clone(page._layout)
    const checks = clone(page._scheme.checksById)
    const addresses = page._fixtures.map((fixture) => fixture.addressText)
    const targetPosition = clone(before.positionsById[String(fixtures[0].stableId)])
    const revision = runtime.workspace.readLightingWorkspace().revision

    page.openLayoutSettings()
    page.onDraftArrangementTap(runtime.event({ mode: 'unplaced' }))
    page.onBatchTargetRodChange(runtime.event({}, { value: 1 }))
    assert.equal(page.data.batchTargetRodId, targetId)
    assert.equal(page.data.batchUnplacedCount, 1)
    page.changeDraftRodCount(runtime.event({ kind: 'internalRods', delta: -1 }))
    assert.equal(page.data.batchUnplacedCount, 2, 'Removed-rod fixture must join the unplaced batch')
    page.applyLayoutSettings()
    assert(page.data.reductionConfirm)
    assert.match(page.data.reductionConfirm.note, /移除杆上的 1 台灯具/)
    assert.match(page.data.reductionConfirm.note, /共 2 台未上杆灯具安排到/)
    assert.equal(runtime.workspace.readLightingWorkspace().revision, revision, 'Pending reduction saved early')

    page.confirmLayoutReduction()
    const saved = runtime.workspace.readLightingWorkspace()
    assert.equal(saved.revision, revision + 1, 'Rod reduction and batch placement must be one save')
    assert.equal(page.data.layoutUndoVisible, true)
    assert.match(page.data.layoutUndoLabel, /已安排 2 台未上杆灯具/)
    assert.equal(String(page._layout.positionsById[String(fixtures[0].stableId)].rodId), targetId)
    assert.deepEqual(page._layout.positionsById[String(fixtures[0].stableId)], targetPosition, 'Target rod existing position moved')
    assert.equal(page._layout.positionsById[String(fixtures[1].stableId)].rodId, targetId)
    assert.equal(page._layout.positionsById[String(fixtures[2].stableId)].rodId, frontId)
    assert.equal(page._layout.positionsById[String(fixtures[3].stableId)].rodId, targetId)
    assert.notEqual(page._layout.positionsById[String(fixtures[1].stableId)].t, page._layout.positionsById[String(fixtures[3].stableId)].t)
    assert.deepEqual(page._fixtures.map((fixture) => fixture.addressText), addresses)
    assert.deepEqual(saved.scheme.checksById, checks)

    page.undoLayoutArrangement()
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme.layout, before, 'Undo must restore the entire prior geometry and placement')
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme.checksById, checks, 'Layout undo rolled back an independent check')
  } finally { runtime.dispose() }
}

function testCanceledAndStaleBatchConfirmationDoNotWrite() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    page.openLayoutSettings()
    page.onDraftArrangementTap(runtime.event({ mode: 'unplaced' }))
    page.onBatchTargetRodChange(runtime.event({}, { value: 1 }))
    const before = clone(page._layout)
    const revision = runtime.workspace.readLightingWorkspace().revision
    page.applyLayoutSettings()
    assert.equal(runtime.modals.length, 1)
    runtime.answer(false)
    assert.deepEqual(page._layout, before)
    assert.equal(runtime.workspace.readLightingWorkspace().revision, revision)

    page.applyLayoutSettings()
    assert.equal(runtime.modals.length, 1)
    page.setData({ 'layoutDraft.stageDepthText': '9' })
    const writes = runtime.stats.writes
    runtime.answer(true)
    assert.equal(runtime.workspace.readLightingWorkspace().revision, revision)
    assert.equal(runtime.stats.writes, writes, 'Stale native confirmation committed a changed draft')
  } finally { runtime.dispose() }
}

function testBatchConfirmationRejectsChangedTargetAndMode() {
  for (const mutation of ['target', 'mode']) {
    const runtime = createRuntime()
    runtime.seed()
    try {
      const page = runtime.make()
      page.openLayoutSettings()
      page.onDraftArrangementTap(runtime.event({ mode: 'unplaced' }))
      page.onBatchTargetRodChange(runtime.event({}, { value: 1 }))
      const before = clone(page._layout)
      const revision = runtime.workspace.readLightingWorkspace().revision
      page.applyLayoutSettings()
      assert.equal(runtime.modals.length, 1)
      if (mutation === 'target') {
        page.onBatchTargetRodChange(runtime.event({}, { value: 2 }))
        assert.notEqual(page.data.batchTargetRodId, page.data.batchRodOptions[1].id)
      } else {
        page.onDraftArrangementTap(runtime.event({ mode: 'preserve' }))
        assert.equal(page.data.arrangementMode, 'preserve')
      }
      const writes = runtime.stats.writes
      runtime.answer(true)
      assert.deepEqual(page._layout, before, 'A stale confirmation changed layout after ' + mutation + ' changed')
      assert.equal(runtime.workspace.readLightingWorkspace().revision, revision, 'A stale confirmation saved after ' + mutation + ' changed')
      assert.equal(runtime.stats.writes, writes, 'A stale confirmation wrote storage after ' + mutation + ' changed')
      assert.equal(page.data.layoutPanelVisible, true, 'Stale confirmation should leave the editable panel open')
    } finally { runtime.dispose() }
  }
}

function testPlacementAndSettingsScrollSurfacesAndCornerStyles() {
  const wxml = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxss'), 'utf8')
  const legacyWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml'), 'utf8')
  const legacyWxss = fs.readFileSync(path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss'), 'utf8')
  assert(!/class="placement-overlay[^\"]*"[^>]*catchtouchmove/.test(wxml))
  assert(!/class="settings-overlay[^\"]*"[^>]*catchtouchmove/.test(wxml))
  assert(!/class="export-overlay[^\"]*"[^>]*catchtouchmove/.test(wxml))
  assert(!wxml.includes('scroll-left='), 'Native preview strip must not receive a feedback scroll-left binding')
  assert(wxml.includes('bindtap="onPreviewFixtureTap"'))
  assert(wxml.includes('bindtap="clearLayoutImage"'))
  assert(wxml.includes('bindchange="onBatchTargetRodChange"'))
  for (const css of [wxss, legacyWxss]) {
    assert(/\.placement-card\s*\{[^}]*border-radius:\s*(?!0)/s.test(css), 'Placement sheet needs rounded lower corners')
    assert(/\.settings-card\s*\{[^}]*border-radius:\s*(?!0)/s.test(css), 'Settings sheet needs rounded lower corners')
    assert(css.includes('button.placement-clear-button'))
    assert(css.includes('.batch-arrangement-panel'))
    assert(css.includes('.sheet-closing'))
    assert(css.includes('prefers-reduced-motion:reduce'))
  }
}

async function run() {
  await testPreviewScrollAndTapAreReadOnly()
  console.log('PASS preview scroll stays native and preview taps only select')
  testClearLayoutPreservesTheSchemeAndHandlesFailure()
  console.log('PASS clear empties only layout positions, guards duplicates, and retains failed edits for retry')
  testLateClearAfterHideCannotWrite()
  console.log('PASS delayed clear confirmation after hide is ignored')
  testClearWithStaleLayoutFingerprintCannotOverwrite()
  console.log('PASS clear confirmation cannot overwrite a changed layout fingerprint')
  testBatchPickerCanReselectTheFirstRodAfterTargetRemoval()
  console.log('PASS native picker can choose first rod after target removal')
  testBatchModeWithNoUnplacedFixturesIsInert()
  console.log('PASS batch mode with no unplaced fixtures is inert')
  testBatchArrangementCombinesRemovedAndUnplacedFixturesAndUndo()
  console.log('PASS batch placement combines removed and unplaced fixtures in one save with full undo')
  testCanceledAndStaleBatchConfirmationDoNotWrite()
  console.log('PASS canceled and stale batch confirmations do not write')
  testBatchConfirmationRejectsChangedTargetAndMode()
  console.log('PASS batch confirmation rejects a changed target or arrangement mode')
  testPlacementAndSettingsScrollSurfacesAndCornerStyles()
  console.log('PASS modal scroll surfaces, corners, and motion contracts')
}

run().catch((error) => { console.error(error); process.exitCode = 1 })

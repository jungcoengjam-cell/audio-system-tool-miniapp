const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const root = path.resolve(__dirname, '../..')

function testRetiredArrangementModeCannotCommit() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    runtime.place(page, 0)
    const before = clone(runtime.workspace.readLightingWorkspace().scheme.layout)
    const writes = runtime.stats.writes
    page.openLayoutSettings()
    page.setData({ arrangementMode: 'unplaced' })
    page.applyLayoutSettings()
    assert.equal(runtime.stats.writes, writes, 'Retired unplaced mode wrote storage')
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme.layout, before)
    assert.equal(page.data.layoutPanelVisible, true, 'Invalid mode unexpectedly closed settings')
  } finally { runtime.dispose() }
}

function testPreserveLeavesPlacedAndUnplacedFixturesAlone() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    runtime.place(page, 0, 0)
    runtime.place(page, 1, 1)
    const before = clone(page._layout.positionsById)
    const checks = clone(page._scheme.checksById)
    const addresses = page._fixtures.map((fixture) => fixture.addressText)
    const unplaced = page._fixtures.filter((fixture) => !before[fixture.stableId]).map((fixture) => fixture.stableId)

    page.openLayoutSettings()
    page.onDraftArrangementTap(runtime.event({ mode: 'preserve' }))
    page.applyLayoutSettings()

    const saved = runtime.workspace.readLightingWorkspace().scheme
    assert.deepEqual(saved.layout.positionsById, before)
    assert.deepEqual(saved.checksById, checks)
    assert.deepEqual(page._fixtures.map((fixture) => fixture.addressText), addresses)
    assert(unplaced.every((id) => !saved.layout.positionsById[id]), 'Preserve mode placed an unplaced fixture')
    assert.equal(page.data.unplacedFixtureCount, unplaced.length)
  } finally { runtime.dispose() }
}

function testUniformConfirmationKeepsUnplacedFixturesAndUndoRestoresPositions() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    runtime.place(page, 0, 0)
    runtime.place(page, 1, 0)
    runtime.place(page, 2, 1)
    const before = clone(page._layout.positionsById)
    const checks = clone(page._scheme.checksById)
    const addresses = page._fixtures.map((fixture) => fixture.addressText)
    const unplaced = page._fixtures.filter((fixture) => !before[fixture.stableId]).map((fixture) => fixture.stableId)

    page.openLayoutSettings()
    page.onDraftArrangementTap(runtime.event({ mode: 'uniform' }))
    page.applyLayoutSettings()
    assert.equal(runtime.modals.length, 1, 'Uniform mode should retain its confirmation')
    runtime.answer(false)
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme.layout.positionsById, before, 'Cancel changed positions')

    page.applyLayoutSettings()
    runtime.answer(true)
    const arranged = runtime.workspace.readLightingWorkspace().scheme
    assert(unplaced.every((id) => !arranged.layout.positionsById[id]), 'Uniform mode placed an unplaced fixture')
    for (const rodId of [page._layout.internalRods[0].id, page._layout.internalRods[1].id]) {
      const entries = Object.values(arranged.layout.positionsById).filter((position) => position.rodId === rodId)
      assert(entries.length > 0)
      const sorted = entries.map((position) => position.t).sort((a, b) => a - b)
      if (sorted.length > 2) {
        const gaps = sorted.slice(1).map((value, index) => value - sorted[index])
        assert(gaps.every((gap) => Math.abs(gap - gaps[0]) < 1e-8), 'Rod positions were not uniformly spaced')
      }
    }
    assert.deepEqual(arranged.checksById, checks)
    assert.deepEqual(page._fixtures.map((fixture) => fixture.addressText), addresses)
    assert.equal(page.data.layoutUndoVisible, true)

    page.undoLayoutArrangement()
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme.layout.positionsById, before, 'Undo did not restore prior positions')
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme.checksById, checks)
  } finally { runtime.dispose() }
}

function testRodReductionConfirmationAndUniformUndoRestoreTheRemovedRod() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make()
    const removedRod = page._layout.internalRods.at(-1).id
    runtime.place(page, 0, 0)
    runtime.place(page, 1, 2)
    const before = clone(page._layout)
    const checks = clone(page._scheme.checksById)
    const movedFixture = page._fixtures[1]

    page.openLayoutSettings()
    page.onDraftArrangementTap(runtime.event({ mode: 'uniform' }))
    page.changeDraftRodCount(runtime.event({ kind: 'internalRods', delta: -1 }))
    page.applyLayoutSettings()
    assert(page.data.reductionConfirm, 'Removing a populated rod must ask for confirmation')
    assert(page.data.reductionConfirm.rods.includes('灯杆3'))
    page.confirmLayoutReduction()

    let saved = runtime.workspace.readLightingWorkspace().scheme
    assert.equal(saved.layout.internalRods.some((rod) => rod.id === removedRod), false)
    assert.equal(saved.layout.positionsById[movedFixture.stableId], undefined, 'Removed rod fixture should become unplaced')
    assert.equal(page.data.layoutUndoVisible, true)
    page.undoLayoutArrangement()
    saved = runtime.workspace.readLightingWorkspace().scheme
    assert.deepEqual(saved.layout, before, 'Undo should restore the removed rod and all old positions')
    assert.deepEqual(saved.checksById, checks)
  } finally { runtime.dispose() }
}

function testProductionSettingsExposeOnlySupportedModesAndKeepSinglePlacementHelpers() {
  const source = fs.readFileSync(path.join(root, 'pages/dmx-layout/page-factory.js'), 'utf8')
  const templates = [
    'pages/dmx-layout/dmx-layout.wxml',
    'pages/dmx-layout-landscape/dmx-layout-landscape.wxml',
  ].map((relative) => fs.readFileSync(path.join(root, relative), 'utf8'))
  const styles = [
    'pages/dmx-layout/dmx-layout.wxss',
    'pages/dmx-layout-landscape/dmx-layout-landscape.wxss',
  ].map((relative) => fs.readFileSync(path.join(root, relative), 'utf8'))

  assert.match(source, /if \(!\['preserve', 'uniform'\]\.includes\(arrangementMode\)\) return/)
  assert.match(source, /unplacedFixtureCount:/)
  assert.match(source, /nextRodPosition\(layout, geometryRod, exceptId\)/)
  for (const template of templates) {
    assert.equal((template.match(/class="arrangement-choice /g) || []).length, 2)
    assert.doesNotMatch(template, /未上杆批量安排|batch-target|batch-arrangement|onBatchTargetRodChange/)
  }
  for (const style of styles) assert.doesNotMatch(style, /batch-target|batch-arrangement|arrangement-choice-batch/)
}

testRetiredArrangementModeCannotCommit()
testPreserveLeavesPlacedAndUnplacedFixturesAlone()
testUniformConfirmationKeepsUnplacedFixturesAndUndoRestoresPositions()
testRodReductionConfirmationAndUniformUndoRestoreTheRemovedRod()
testProductionSettingsExposeOnlySupportedModesAndKeepSinglePlacementHelpers()
console.log('PASS panel settings: retired batch disabled; preserve/uniform/reduction/undo retained (5 cases)')

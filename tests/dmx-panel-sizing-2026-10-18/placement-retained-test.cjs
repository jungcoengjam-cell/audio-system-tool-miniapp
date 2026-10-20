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


(async()=>{await testPreviewScrollAndTapAreReadOnly();testClearLayoutPreservesTheSchemeAndHandlesFailure();testLateClearAfterHideCannotWrite();testClearWithStaleLayoutFingerprintCannotOverwrite();console.log("PASS retained preview/select and clear safety 4 cases")})().catch(e=>{console.error(e);process.exitCode=1})

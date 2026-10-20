'use strict'

const assert = require('node:assert/strict')
const { createRuntime, clone, model, stageLightingProductIndex } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const cases = []
function test(name, body) { cases.push({ name, body }) }
function seedSingleGroup(runtime, fixtureCount = 4, fixtureModel = 'TL-SL323', channelCount = 2) {
  const product = stageLightingProductIndex.get(fixtureModel)
  assert(product, `Missing approved catalog fixture ${fixtureModel}`)
  runtime.seed([{
    name: product.name,
    fixtureSource: 'library',
    fixtureModel: product.model,
    channelCount: String(channelCount),
    libraryChannelCount: String(channelCount),
    fixtureCount: String(fixtureCount),
    targetUniverse: 'A',
  }])
}
function makeCurrentPage(runtime) {
  const page = runtime.make('portrait')
  assert.equal(page.route, 'pages/dmx-layout/dmx-layout', 'Use the registered portrait route for current-flow checks')
  return page
}
function currentScheme(runtime, contextId) {
  const latest = runtime.workspace.readLightingWorkspace(contextId)
  assert.equal(latest.ok, true, 'Expected the current synthetic workspace to remain readable')
  return latest.scheme
}

test('30 current-page fixture placements keep unique positions and preserve verified checks when unplaced', () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 30)
    const addressPage = runtime.make('main')
    assert.equal(addressPage._calculationResult.fixtures.length, 30)
    const checkedFixture = addressPage._calculationResult.fixtures[0]
    runtime.checkMain(addressPage, checkedFixture)
    const checksBefore = clone(currentScheme(runtime, addressPage._contextId).checksById)
    assert(checksBefore[checkedFixture.stableId], 'Fixture check must be persisted through the real address Page first')

    const page = makeCurrentPage(runtime)
    assert.equal(page._fixtures.length, 30)
    page.openPlacementPanel()
    const rodId = page._layout.internalRods[0].id
    page.onSelectRod(runtime.event({ rodId }))
    for (const fixture of page._fixtures) page.onPanelFixtureTap(runtime.event({ fixtureId: fixture.stableId }))

    let saved = currentScheme(runtime, page._contextId)
    const positions = Object.values(saved.layout.positionsById)
    assert.equal(positions.length, 30)
    assert.equal(new Set(positions.map(position => position.t)).size, 30, 'Each of the 30 placements needs its own rod coordinate')
    assert(positions.every(position => position.rodId === rodId && position.t >= 0 && position.t <= 1))
    assert.deepEqual(saved.checksById, checksBefore, 'Placement must not discard independently saved fixture checks')

    page.onPanelFixtureTap(runtime.event({ fixtureId: checkedFixture.stableId }))
    saved = currentScheme(runtime, page._contextId)
    assert.equal(Object.keys(saved.layout.positionsById).length, 29)
    assert.deepEqual(saved.checksById, checksBefore, 'Unplacing must preserve checks')
  } finally { runtime.dispose() }
})

test('cross-rod move cancel is inert and confirm moves one fixture without changing its address identity', () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 2)
    const page = makeCurrentPage(runtime)
    const fixture = page._fixtures[0]
    const sourceRodId = page._layout.internalRods[0].id
    const destinationRodId = page._layout.frontRods[0].id
    const addressBefore = fixture.addressText
    runtime.place(page, 0, 0)
    page.openPlacementPanel()
    page.onSelectRod(runtime.event({ rodId: destinationRodId }))

    const cancelBaseline = clone(currentScheme(runtime, page._contextId).layout)
    const writesBeforeCancel = runtime.stats.writes
    page.onPanelFixtureTap(runtime.event({ fixtureId: fixture.stableId }))
    assert.equal(runtime.modals.length, 1, 'Moving a placed fixture to another rod must ask for confirmation')
    runtime.answer(false)
    let saved = currentScheme(runtime, page._contextId)
    assert.deepEqual(saved.layout, cancelBaseline, 'Cancel must leave the complete public saved layout unchanged')
    assert.equal(runtime.stats.writes, writesBeforeCancel, 'Cancel must not write storage')
    assert.equal(saved.layout.positionsById[fixture.stableId].rodId, sourceRodId, 'Cancel must leave the saved position unchanged')
    assert.equal(Object.keys(saved.layout.positionsById).length, 1)

    page.onPanelFixtureTap(runtime.event({ fixtureId: fixture.stableId }))
    assert.equal(runtime.modals.length, 1)
    runtime.answer(true)
    saved = currentScheme(runtime, page._contextId)
    assert.equal(saved.layout.positionsById[fixture.stableId].rodId, destinationRodId)
    assert.equal(Object.keys(saved.layout.positionsById).length, 1, 'Confirm must move, not duplicate, the fixture')
    assert.equal(page._fixtures[0].addressText, addressBefore, 'A layout move must not change address identity')
  } finally { runtime.dispose() }
})

test('single-rod clear confirms against the active rod and preserves every unrelated scheme field', () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 4)
    const addressPage = runtime.make('main')
    const checkedFixture = addressPage._calculationResult.fixtures[0]
    runtime.checkMain(addressPage, checkedFixture)
    const page = makeCurrentPage(runtime)
    const internalRodId = page._layout.internalRods[0].id
    const frontRodId = page._layout.frontRods[0].id
    page.assignFixtureToRod(page._fixtures[0], internalRodId)
    page.assignFixtureToRod(page._fixtures[1], frontRodId)
    page.openPlacementPanel()
    page.onSelectRod(runtime.event({ rodId: internalRodId }))

    const before = clone(currentScheme(runtime, page._contextId))
    const cancelWrites = runtime.stats.writes
    page.clearSelectedRodLayout()
    assert.equal(runtime.modals.length, 1)
    assert.equal(runtime.modals[0].title, '清空当前灯杆灯位')
    assert(runtime.modals[0].content.includes(page.data.selectedRodName), 'Confirmation must identify the active rod by name')
    runtime.answer(false)
    assert.equal(runtime.stats.writes, cancelWrites, 'Cancel must not write')
    assert.deepEqual(currentScheme(runtime, page._contextId), before, 'Cancel must preserve the complete public scheme')

    page.clearSelectedRodLayout()
    const writesBeforeConfirm = runtime.stats.writes
    runtime.answer(true)
    const after = currentScheme(runtime, page._contextId)
    assert(runtime.stats.writes > writesBeforeConfirm, 'Confirm must save the scoped clear')
    assert.equal(after.layout.positionsById[page._fixtures[0].stableId], undefined, 'The active rod position must be removed')
    assert.equal(after.layout.positionsById[page._fixtures[1].stableId].rodId, frontRodId, 'Other rod positions must remain')
    assert.deepEqual(after.preferences, before.preferences, 'Groups, mode, quantity and address settings must remain')
    assert.deepEqual(after.fixtureIdsByGroup, before.fixtureIdsByGroup, 'Fixture group membership must remain')
    assert.deepEqual(after.checksById, before.checksById, 'Checked state must remain')
  } finally { runtime.dispose() }
})

test('single-rod clear confirmation is inert after hide, rod change, layout change, or duplicate callback', () => {
  for (const staleAction of ['hide', 'rod-change', 'layout-change', 'duplicate']) {
    const runtime = createRuntime()
    try {
      seedSingleGroup(runtime, 4)
      const page = makeCurrentPage(runtime)
      const firstRodId = page._layout.internalRods[0].id
      const otherRodId = page._layout.frontRods[0].id
      runtime.place(page, 0)
      page.openPlacementPanel()
      page.onSelectRod(runtime.event({ rodId: firstRodId }))
      page.clearSelectedRodLayout()
      const confirmation = runtime.modals.shift()
      assert(confirmation)
      const writesBeforeStaleCallback = runtime.stats.writes
      if (staleAction === 'hide') page.onHide()
      if (staleAction === 'rod-change') page.onSelectRod(runtime.event({ rodId: otherRodId }))
      if (staleAction === 'layout-change') page.assignFixtureToRod(page._fixtures[1], otherRodId)
      const writesBeforeCallback = runtime.stats.writes
      confirmation.success({ confirm: true })
      if (staleAction === 'duplicate') {
        assert(runtime.stats.writes > writesBeforeCallback, 'The first current confirmation must save')
        const writesAfterFirstCallback = runtime.stats.writes
        confirmation.success({ confirm: true })
        assert.equal(runtime.stats.writes, writesAfterFirstCallback, 'Duplicate callback must not save twice')
        continue
      }
      assert.equal(runtime.stats.writes, writesBeforeCallback, `${staleAction} callback must not add a clear write`)
      if (staleAction === 'hide') assert.equal(writesBeforeStaleCallback, writesBeforeCallback, 'Hide must not trigger an implicit write')
      confirmation.success({ confirm: true })
      assert.equal(runtime.stats.writes, writesBeforeCallback, 'Duplicate callback must remain inert')
    } finally { runtime.dispose() }
  }
})

test('closing and reopening placement invalidates an old clear confirmation', async () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 4)
    const page = makeCurrentPage(runtime)
    runtime.place(page, 0)
    page.openPlacementPanel()
    page.clearSelectedRodLayout()
    const confirmation = runtime.modals.shift()
    assert(confirmation)
    page.closePlacementPanel()
    await new Promise(resolve => setTimeout(resolve, 220))
    assert.equal(page.data.placementVisible, false, 'The close lifecycle must finish before reopening')
    page.openPlacementPanel()
    const writesBeforeStaleCallback = runtime.stats.writes
    const savedBefore = clone(currentScheme(runtime, page._contextId).layout)
    confirmation.success({ confirm: true })
    assert.equal(runtime.stats.writes, writesBeforeStaleCallback, 'A confirmation from the prior panel session must not save')
    assert.deepEqual(currentScheme(runtime, page._contextId).layout, savedBefore, 'A stale callback must preserve all positions')
  } finally { runtime.dispose() }
})

test('clear modal respects native button limits and clears pending after native failure', () => {
  const runtime = createRuntime()
  const originalShowModal = global.wx.showModal
  const invalidRequests = []
  const nativeFailures = []
  let failNext = false
  let throwNext = false
  try {
    seedSingleGroup(runtime, 4)
    const addressPage = runtime.make('main')
    const checkedFixture = addressPage._calculationResult.fixtures[0]
    runtime.checkMain(addressPage, checkedFixture)
    const checksBeforeClear = clone(currentScheme(runtime, addressPage._contextId).checksById)
    assert(checksBeforeClear[checkedFixture.stableId], 'Full-clear preservation needs a real address-page check')
    const page = makeCurrentPage(runtime)
    const internalRodId = page._layout.internalRods[0].id
    const frontRodId = page._layout.frontRods[0].id
    runtime.place(page, 0, 0)
    page.assignFixtureToRod(page._fixtures[1], frontRodId)
    page.openPlacementPanel()
    page.onSelectRod(runtime.event({ rodId: internalRodId }))

    global.wx.showModal = (options) => {
      const confirmLength = Array.from(String(options.confirmText || '确定')).length
      const cancelLength = Array.from(String(options.cancelText || '取消')).length
      if (confirmLength > 4 || cancelLength > 4) {
        invalidRequests.push(options)
        options.fail?.({ errMsg: 'fail invalid button text' })
        return
      }
      if (throwNext) {
        throwNext = false
        throw new Error('simulated synchronous wx.showModal failure')
      }
      if (failNext) {
        failNext = false
        nativeFailures.push(options)
        options.fail?.({ errMsg: 'mock native failure' })
        return
      }
      originalShowModal(options)
    }

    let invalidFailureCount = 0
    global.wx.showModal({
      title: '验证平台限制',
      content: '',
      confirmText: '清空当前杆',
      cancelText: '取消',
      fail: () => { invalidFailureCount += 1 },
    })
    assert.equal(invalidFailureCount, 1, 'The strict wx.showModal stub must reject labels longer than four characters')
    assert.equal(invalidRequests.length, 1)
    const invalidCount = invalidRequests.length

    const writesBeforeFailure = runtime.stats.writes
    failNext = true
    page.clearSelectedRodLayout()
    assert.equal(nativeFailures.length, 1, 'The native failure must reach the clear request')
    assert.equal(invalidRequests.length, invalidCount, 'The clear request must use valid button labels')
    assert.equal(page._clearLayoutPending, false, 'Native failure must release the internal pending lock')
    assert.equal(page.data.clearLayoutPending, false, 'Native failure must release the rendered pending state')
    assert.equal(page.data.placementNotice, '清空确认失败，请重试')
    assert.equal(runtime.stats.writes, writesBeforeFailure, 'Native failure must not write layout storage')

    const writesBeforeThrow = runtime.stats.writes
    throwNext = true
    assert.doesNotThrow(() => page.clearSelectedRodLayout(), 'A synchronous native throw must be handled in the clear flow')
    assert.equal(page._clearLayoutPending, false, 'A synchronous throw must release the internal pending lock')
    assert.equal(page.data.clearLayoutPending, false, 'A synchronous throw must release the rendered pending state')
    assert.equal(page.data.placementNotice, '清空确认失败，请重试')
    assert.equal(runtime.stats.writes, writesBeforeThrow, 'Synchronous native failure must not write layout storage')

    page.clearSelectedRodLayout()
    assert.equal(runtime.modals.length, 1, 'A failed confirmation must be retryable')
    const rodConfirmation = runtime.modals.shift()
    assert.equal(rodConfirmation.confirmText, '确认清空')
    assert(Array.from(rodConfirmation.confirmText).length <= 4)
    assert(Array.from(rodConfirmation.cancelText).length <= 4)
    assert.equal(page.data.clearLayoutPending, true)
    rodConfirmation.success({ confirm: false })
    assert.equal(page.data.clearLayoutPending, false, 'Cancel must release pending state')
    assert.equal(runtime.stats.writes, writesBeforeFailure, 'Cancel after retry must remain inert')

    const modalErrorsBefore = runtime.toasts.length
    page.clearSelectedRodLayout()
    const staleFailure = runtime.modals.shift()
    assert(staleFailure)
    page.onHide()
    page.onShow()
    page.openPlacementPanel()
    page.onSelectRod(runtime.event({ rodId: internalRodId }))
    page.clearSelectedRodLayout()
    const currentConfirmation = runtime.modals.shift()
    assert(currentConfirmation)
    assert.equal(page.data.clearLayoutPending, true)
    staleFailure.fail({ errMsg: 'late native failure' })
    assert.equal(page.data.clearLayoutPending, true, 'An old failure must not release a newer request')
    assert.equal(runtime.toasts.length, modalErrorsBefore, 'An old failure must not show stale feedback')
    currentConfirmation.success({ confirm: false })
    assert.equal(page.data.clearLayoutPending, false)

    page.clearSelectedRodLayout()
    const currentRodConfirmation = runtime.modals.shift()
    currentRodConfirmation.success({ confirm: true })
    let saved = currentScheme(runtime, page._contextId)
    assert.equal(saved.layout.positionsById[page._fixtures[0].stableId], undefined)
    assert.equal(saved.layout.positionsById[page._fixtures[1].stableId].rodId, frontRodId)

    const fieldsBeforeFullClear = clone(saved)
    page.clearLayoutImage()
    const wholeImageConfirmation = runtime.modals.shift()
    assert(wholeImageConfirmation)
    assert.equal(wholeImageConfirmation.title, '清空整个灯位图')
    assert.equal(wholeImageConfirmation.confirmText, '确认清空')
    wholeImageConfirmation.success({ confirm: true })
    saved = currentScheme(runtime, page._contextId)
    assert.deepEqual(saved.layout.positionsById, {}, 'Full clear must only remove placement positions')
    assert.deepEqual(saved.preferences, fieldsBeforeFullClear.preferences)
    assert.deepEqual(saved.fixtureIdsByGroup, fieldsBeforeFullClear.fixtureIdsByGroup)
    assert(Object.keys(fieldsBeforeFullClear.checksById).length > 0, 'Full-clear preservation must start with at least one real check')
    assert.deepEqual(saved.checksById, fieldsBeforeFullClear.checksById)
  } finally {
    global.wx.showModal = originalShowModal
    runtime.dispose()
  }
})

test('invalid rod settings show every bad rod, locate the first, and clear only corrected feedback', () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 2)
    const page = makeCurrentPage(runtime)
    page.openLayoutSettings()
    const layoutBefore = clone(page._layout)
    const writesBefore = runtime.stats.writes
    const firstRod = page.data.layoutDraft.internalRods[0]
    const secondRod = page.data.layoutDraft.frontRods[0]
    page.setData({ 'layoutDraft.internalRods[0].distanceText': '0' })
    page.setData({ 'layoutDraft.frontRods[0].distanceText': '201' })
    page.applyLayoutSettings()
    assert.match(page.data.layoutValidationErrorsById[firstRod.id], /大于 0/)
    assert.match(page.data.layoutValidationErrorsById[secondRod.id], /200 m/)
    assert.equal(page.data.layoutErrorScrollIntoView, `rod-error-${firstRod.id}`)
    assert.deepEqual(page._layout, layoutBefore, 'Invalid draft must not alter the last valid layout')
    assert.equal(runtime.stats.writes, writesBefore, 'Invalid draft must not save')
    assert.equal(page.data.layoutDraft.internalRods[0].distanceText, '0', 'Invalid input must remain editable in the draft')
    page.onDraftDistanceInput(runtime.event({ kind: 'internalRods', index: 0 }, { value: '1' }))
    assert.equal(page.data.layoutValidationErrorsById[firstRod.id], undefined, 'Editing the invalid rod must clear its stale feedback')
    assert.match(page.data.layoutValidationErrorsById[secondRod.id], /200 m/, 'Other invalid rods must remain visible')
    page.onDraftDistanceInput(runtime.event({ kind: 'frontRods', index: 0 }, { value: '1' }))
    assert.equal(page.data.layoutValidationErrorsById[secondRod.id], undefined, 'Correcting the remaining rod must clear its own feedback')
  } finally { runtime.dispose() }
})

test('a stale current-page layout cannot overwrite a newer saved layout (CAS conflict)', () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 4)
    const stalePage = makeCurrentPage(runtime)
    const writerPage = makeCurrentPage(runtime)
    assert.equal(stalePage._contextId, writerPage._contextId)

    const moved = writerPage._fixtures[2]
    writerPage.assignFixtureToRod(moved, writerPage._layout.frontRods[0].id)
    const latestLayout = clone(currentScheme(runtime, writerPage._contextId).layout)
    const staleLayout = clone(stalePage._layout)
    const conflictingFixture = stalePage._fixtures[3]
    staleLayout.positionsById[conflictingFixture.stableId] = {
      rodId: staleLayout.internalRods[0].id,
      t: 0.25,
    }

    assert.equal(stalePage.saveLayoutOnly(staleLayout), false, 'Stale editor must reject a compare-and-swap save')
    assert.deepEqual(currentScheme(runtime, stalePage._contextId).layout, latestLayout, 'The newer saved layout must remain intact')
    assert.equal(stalePage._layoutDirty, true)
    assert.match(stalePage.data.saveNotice, /已在其他页面更新|避免覆盖最新布局/)
  } finally { runtime.dispose() }
})

test('a current portrait Page reloads saved positions after hide/show', () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 4)
    const returningPage = makeCurrentPage(runtime)
    assert.equal(returningPage.saveLayoutOnly(clone(returningPage._layout)), true)
    returningPage.onHide()

    const writerPage = makeCurrentPage(runtime)
    const target = writerPage._fixtures[2]
    const targetRodId = writerPage._layout.frontRods[0].id
    writerPage.assignFixtureToRod(target, targetRodId)
    const savedLayout = clone(currentScheme(runtime, writerPage._contextId).layout)
    assert.equal(savedLayout.positionsById[target.stableId].rodId, targetRodId)

    returningPage.onShow()
    assert.deepEqual(returningPage._layout.positionsById, savedLayout.positionsById, 'Returning Page must load the latest persisted positions')
    assert.equal(returningPage._layoutDirty, false)
  } finally { runtime.dispose() }
})

test('export snapshot uses latest saved preferences and recomputed fixture addresses', () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 2, 'TL-SK3101', 2)
    const page = makeCurrentPage(runtime)
    assert.equal(page.saveLayoutOnly(clone(page._layout)), true)
    runtime.place(page, 0, 0)
    const layoutBeforeModeChange = clone(currentScheme(runtime, page._contextId).layout)
    const before = page.buildExportSnapshot()
    assert(before)
    const beforeAddresses = before.fixtures.map(fixture => fixture.addressText)
    const beforeIds = before.fixtures.map(fixture => fixture.stableId)
    assert.deepEqual(beforeAddresses, ['A001', 'A003'], 'Independent mode-2 golden for two TL-SK3101 fixtures')

    const latest = runtime.workspace.readLightingWorkspace(page._contextId)
    assert.equal(latest.ok, true)
    const next = clone(latest.scheme)
    next.preferences.groups[0].channelCount = '5'
    next.preferences.groups[0].libraryChannelCount = '5'
    assert.equal(runtime.workspace.saveLightingScheme(latest.contextId, next, latest.revision).ok, true)
    assert.equal(page.saveLayoutOnly(clone(page._layout)), true)

    const refreshed = page.buildExportSnapshot()
    assert(refreshed)
    const expected = runtime.workspace.calculateScheme(currentScheme(runtime, page._contextId)).result
    const refreshedAddresses = refreshed.fixtures.map(fixture => fixture.addressText)
    assert.deepEqual(refreshedAddresses, ['A001', 'A006'], 'Independent mode-5 golden for two TL-SK3101 fixtures')
    assert.deepEqual(refreshedAddresses, expected.fixtures.map(fixture => fixture.addressText), 'Public workspace calculation cross-check')
    assert.deepEqual(refreshed.fixtures.map(fixture => fixture.stableId), beforeIds, 'Mode change must not change fixture identity')
    assert.deepEqual(currentScheme(runtime, page._contextId).layout, layoutBeforeModeChange, 'Mode change must preserve the complete saved layout and positions')
    assert.notDeepEqual(refreshedAddresses, beforeAddresses,
      'The changed channel mode must produce changed fixture addresses in the export snapshot')
  } finally { runtime.dispose() }
})

test('failed layout save blocks back navigation and export until retry succeeds', () => {
  const runtime = createRuntime()
  try {
    seedSingleGroup(runtime, 4)
    const page = makeCurrentPage(runtime)
    assert.equal(page.saveLayoutOnly(clone(page._layout)), true, 'Start from a clean persisted layout')
    assert.equal(page._layoutDirty, false)
    const savedBeforeFailure = clone(currentScheme(runtime, page._contextId).layout)
    runtime.state.failWrites = true
    runtime.place(page, 0, 0)
    assert.equal(page._layoutDirty, true)
    assert.equal(runtime.stats.alertEnabled, true, 'Unsaved layout must register the page exit warning')
    assert.equal(page.data.saveRetryVisible, true)

    page.goBack()
    page.generateLayoutImage()
    assert.equal(runtime.navigation.length, 0, 'Failed save must prevent leaving with unsaved layout')
    assert.equal(runtime.exports.length, 0, 'Failed save must prevent exporting stale layout')
    assert.deepEqual(currentScheme(runtime, page._contextId).layout, savedBeforeFailure, 'Failed save and blocked actions must not alter public persisted layout')
    assert.equal(page.data.saveRetryVisible, true)

    runtime.state.failWrites = false
    page.retryLayoutSave()
    assert.equal(page._layoutDirty, false)
    assert.equal(runtime.stats.alertEnabled, false)
    assert.equal(page.data.saveRetryVisible, false)
    page.goBack()
    assert.equal(runtime.navigation.length, 1, 'Navigation can proceed after a successful retry')
    assert.equal(Object.keys(currentScheme(runtime, page._contextId).layout.positionsById).length, 1)
  } finally { runtime.dispose() }
})

test('reversed fixture batches retain stable interleave order and address identity', () => {
  const batchGroup = (groupIndex, count) => Array.from({ length: count }, (_, index) => ({
    groupIndex,
    fixtureIndex: index + 1,
    addressText: `${String.fromCharCode(65 + groupIndex)}${String(index + 1).padStart(3, '0')}`,
  })).reverse()
  const mixedA4B2 = model.interleaveBatchFixtures([...batchGroup(0, 4), ...batchGroup(1, 2)])
  assert.deepEqual(mixedA4B2.map(fixture => fixture.groupIndex), [0, 1, 0, 0, 1, 0])
  assert.deepEqual(mixedA4B2.filter(fixture => fixture.groupIndex === 0).map(fixture => fixture.fixtureIndex), [1, 2, 3, 4])
  const mixedA3B3C3 = model.interleaveBatchFixtures([...batchGroup(0, 3), ...batchGroup(1, 3), ...batchGroup(2, 3)])
  assert.deepEqual(mixedA3B3C3.map(fixture => fixture.groupIndex), [0, 1, 2, 0, 1, 2, 0, 1, 2])
  assert.deepEqual(mixedA4B2.map(fixture => `${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`), [
    '0:1:A001', '1:1:B001', '0:2:A002', '0:3:A003', '1:2:B002', '0:4:A004',
  ], 'Independent interleave golden preserves ordered address identity')
  const mixedA6B2 = model.interleaveBatchFixtures([...batchGroup(0, 6), ...batchGroup(1, 2)])
  assert.deepEqual(mixedA6B2.map(fixture => fixture.groupIndex), [0, 0, 1, 0, 0, 1, 0, 0])
  assert.equal(new Set(mixedA3B3C3.map(fixture => `${fixture.groupIndex}:${fixture.fixtureIndex}`)).size, 9)
})

async function run() {
  const failures = []
  for (const item of cases) {
    try {
      await item.body()
      console.log(`PASS ${item.name}`)
    } catch (error) {
      failures.push({ name: item.name, error })
      console.log(`FAIL ${item.name}: ${error && error.stack || error}`)
    }
  }
  console.log(`SUMMARY current portrait-page flow ${cases.length - failures.length}/${cases.length} passed; failures=${failures.length}`)
  if (failures.length) process.exitCode = 1
}
run().catch((error) => { console.error(error); process.exitCode = 1 })

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')
const { UNIVERSE_LABELS } = require('../utils/dmx-address')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')

assert(wxml.includes('class="add-group-button') && wxml.includes('bindtap="addGroup"'),
  'The page add-group control must open the catalog flow')
assert(wxml.includes('class="fixture-search-row') && wxml.includes('data-model="{{fixture.model}}" bindtap="selectFixture"'),
  'A catalog row must select one fixture model')
assert(wxml.includes('bindchange="onPendingModeChange"')
  && wxml.includes('bindinput="onPendingQuantityInput"')
  && wxml.includes('bindblur="onPendingQuantityBlur"')
  && wxml.includes('bindtap="confirmPendingChange"'),
  'The pending add sheet must expose supported mode, quantity and confirmation controls')
assert(wxml.includes('class="layout-entry" bindtap="openFixtureLayout"'),
  'The current lighting-layout navigation must remain reachable')
assert.match(wxml, /wx:if="\{\{allocationMode == 'manual'\}\}" class="fixture-control-row"[\s\S]{0,420}bindchange="onGroupUniverseChange"/,
  'Manual fixture cards must expose the native target-universe picker')
assert.match(wxml, /pendingChange\.kind == 'allocationMode'[\s\S]{0,750}bindchange="onPendingUniverseChange"/,
  'The manual-mode confirmation must expose candidate group-universe pickers')
assert.match(wxml, /pendingChange\.kind == 'groupUniverse'[\s\S]{0,550}bindchange="onPendingUniverseChange"/,
  'The group-universe confirmation must reuse the candidate picker handler')
assert.match(wxml, /allocationMode == 'manual'[\s\S]{0,360}pendingChange\.targetUniverseIndex[\s\S]{0,180}bindchange="onPendingUniverseChange"/,
  'Manual single-group add confirmation must allow changing its target universe')
assert(wxml.includes("pendingChange.kind != 'groupUniverse' && pendingChange.groupIndex >= 0"),
  'A target-universe confirmation must not render an empty quantity input')
assert(wxml.includes('wx:if="{{pendingChange.showEffectPreview}}"'),
  'An invalid domain assignment must hide effect rows until it can be calculated')

function selectFixtureAfterPickerExit(runtime, page, model) {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const timers = []
  global.setTimeout = (callback, delay, ...args) => {
    const timer = { callback, delay, args, cancelled: false }
    timers.push(timer)
    return timer
  }
  global.clearTimeout = (timer) => {
    if (timers.includes(timer)) timer.cancelled = true
    else originalClearTimeout(timer)
  }
  try {
    page.selectFixture(runtime.event({ model }))
    assert.equal(page.data.fixtureSearchOpen, true, 'fixture picker must remain mounted during its exit')
    assert.equal(page.data.fixturePickerClosing, true, 'fixture picker must enter its closing state')
    assert.equal(page.data.pendingChange, null, 'selection preview must wait for picker exit')
    const timer = page._sheetCloseTimers?.fixturePicker
    assert(timer, 'fixture picker close timer must be scheduled after rendering')
    assert.equal(timer.delay, 180, 'fixture picker exit must retain its 180 ms duration')
    assert.equal(timer.cancelled, false)
    assert(timers.includes(timer), 'fixture picker close must use the scheduled timer')
    timer.callback(...timer.args)
    assert.equal(page.data.fixtureSearchOpen, false, 'fixture picker must unmount after exit')
    assert.equal(page.data.pendingChange?.kind, 'add', 'selection preview must open after picker exit')
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
}

function seedPlacedUnrelatedGroup(runtime) {
  runtime.seed([{
    name: 'TL-SL323',
    fixtureSource: 'library',
    fixtureModel: 'TL-SL323',
    channelCount: '2',
    libraryChannelCount: '2',
    fixtureCount: '2',
    targetUniverse: 'A',
  }])
  const page = runtime.make('main')
  const layoutPage = runtime.make()
  const existing = layoutPage._fixtures.find((fixture) => fixture.groupIndex === 0)
  assert(existing, 'The existing fixture must reach the layout page')
  runtime.place(layoutPage, layoutPage._fixtures.indexOf(existing))
  page.onShow()
  return { page, layoutPage }
}

function assertCurrentAddFlowDoesNotWriteBeforeConfirm(runtime, page) {
  const before = clone(runtime.workspace.readLightingWorkspace().scheme)
  const writes = runtime.stats.writes
  page.addGroup()
  assert.equal(page.data.fixtureSearchOpen, true, 'The add button must open the single-model catalog')
  assert.equal(page.data.fixtureBatchOpen, false, 'The reachable add button must not open multi-model selection')
  assert.equal(page.data.fixtureSearchGroupIndex, -1, 'A new group must be created from the catalog selection')
  selectFixtureAfterPickerExit(runtime, page, 'TL-SK3101')
  assert.equal(page.data.pendingChange.kind, 'add')
  assert.equal(page.data.pendingChange.valid, true)
  assert.equal(runtime.stats.writes, writes, 'Selecting a model must not persist before confirmation')
  assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, before)

  page.onPendingModeChange(runtime.event({}, { value: '1' }))
  assert.deepEqual(page.data.pendingChange.channelModes, [2, 5])
  assert.equal(page.data.pendingChange.channelCount, 5, 'The selected supported channel mode must be used in the preview')
  assert.equal(runtime.stats.writes, writes, 'Selecting a mode must not persist before confirmation')

  for (const value of ['0', '201', '1.5']) {
    page.onPendingQuantityInput(runtime.event({}, { value }))
    page.onPendingQuantityBlur()
    assert.equal(page.data.pendingChange.valid, false, 'Invalid quantity ' + value + ' must block confirmation')
    assert.equal(runtime.stats.writes, writes, 'Invalid quantity ' + value + ' must not write')
    page.confirmPendingChange()
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, before, 'Invalid quantity ' + value + ' changed stored data')
  }

  page.onPendingQuantityInput(runtime.event({}, { value: '3' }))
  page.onPendingQuantityBlur()
  assert.equal(page.data.pendingChange.valid, true)
  assert.equal(page.data.pendingChange.addPreview.fixtureCountValue, 3)
  assert.equal(page.data.pendingChange.addPreview.rangeText, 'A005–A019')
  assert.deepEqual(page.data.pendingChange.addPreview.fixtureChips.map((chip) => chip.addressText),
    ['A005', 'A010', 'A015'], 'The preview must show the independent expected starts for three 5-channel fixtures')
  assert.equal(runtime.stats.writes, writes, 'Mode and quantity preview must wait for confirmation')
}

function testSingleModelAddAndRestore() {
  const runtime = createRuntime()
  try {
    const { page } = seedPlacedUnrelatedGroup(runtime)
    const before = clone(runtime.workspace.readLightingWorkspace().scheme)
    const firstGroupId = before.groupIds[0]
    const firstFixtureIds = clone(before.fixtureIdsByGroup[firstGroupId])
    const preservedPositions = clone(before.layout.positionsById)
    const writesBeforeAdd = runtime.stats.writes
    assertCurrentAddFlowDoesNotWriteBeforeConfirm(runtime, page)
    assert.equal(runtime.stats.writes, writesBeforeAdd, 'Nothing in the pending flow should persist before confirmation')

    page.confirmPendingChange()
    const saved = runtime.workspace.readLightingWorkspace()
    assert.equal(saved.ok, true)
    assert.equal(runtime.stats.writes > writesBeforeAdd, true, 'Confirmation must persist the new group')
    assert.deepEqual(saved.scheme.groupIds.slice(0, 1), [firstGroupId])
    assert.deepEqual(saved.scheme.fixtureIdsByGroup[firstGroupId], firstFixtureIds)
    assert.deepEqual(saved.scheme.layout.positionsById, preservedPositions, 'Adding a group must preserve unrelated layout positions')
    assert.deepEqual(saved.scheme.preferences.groups.map((group) => [
      group.fixtureModel, group.channelCount, group.fixtureCount,
    ]), [
      ['TL-SL323', '2', '2'],
      ['TL-SK3101', '5', '3'],
    ], 'The saved fixture groups must match the selected model, mode and quantity')

    const fixtureFacts = page._calculationResult.fixtures.map((fixture) => fixture.addressText)
    assert.deepEqual(fixtureFacts, ['A001', 'A003', 'A005', 'A010', 'A015'],
      'The composed page must retain independent sequential address expectations')
    assert.equal(page._calculationResult.totalFixtures, 5)
    assert.equal(page._calculationResult.totalChannels, 19)

    page.onHide()
    page.onUnload()
    page._qaActive = false
    const restoredPage = runtime.make('main')
    const restored = runtime.workspace.readLightingWorkspace()
    assert.deepEqual(restored.scheme.preferences.groups.map((group) => [
      group.fixtureModel, group.channelCount, group.fixtureCount,
    ]), [
      ['TL-SL323', '2', '2'],
      ['TL-SK3101', '5', '3'],
    ], 'The confirmed result must survive a page reload')
    assert.deepEqual(restored.scheme.layout.positionsById, preservedPositions,
      'Reloading the added group must keep the unrelated fixture placement')
    assert.deepEqual(restoredPage._calculationResult.fixtures.map((fixture) => fixture.addressText),
      ['A001', 'A003', 'A005', 'A010', 'A015'])
  } finally {
    runtime.dispose()
  }
}

function testManualDomainOverflow() {
  const runtime = createRuntime()
  try {
    runtime.seed([{
      name: 'TL-SK3101',
      fixtureSource: 'library',
      fixtureModel: 'TL-SK3101',
      channelCount: '2',
      libraryChannelCount: '2',
      fixtureCount: '1',
      targetUniverse: 'A',
    }])
    const preferences = runtime.storage.get('audioTool.dmxAddress.preferences')
    preferences.startAddressText = '500'
    preferences.allocationMode = 'manual'
    runtime.storage.set('audioTool.dmxAddress.preferences', preferences)
    let page = runtime.make('main')
    const firstFixtureId = page._calculationResult.fixtures[0].stableId
    const savedBefore = clone(runtime.workspace.readLightingWorkspace().scheme)
    const writes = runtime.stats.writes
    page.addGroup()
    selectFixtureAfterPickerExit(runtime, page, 'TL-SV3104')
    assert.equal(page.data.pendingChange.kind, 'add')
    assert.equal(page.data.pendingChange.valid, true, 'A 20-channel fixture that does not fit in A must continue into B')
    assert.match(page.data.pendingChange.addPreview.rangeText, /^B001/)
    assert.equal(runtime.stats.writes, writes, 'A spillover preview must not persist before confirmation')
    page.confirmPendingChange()
    const saved = runtime.workspace.readLightingWorkspace().scheme
    assert.equal(runtime.stats.writes > writes, true, 'Confirming a valid spillover must persist the plan')
    assert.deepEqual(saved.preferences.groups.map((group) => group.targetUniverse), ['A', 'A'],
      'The persisted field remains the selected starting domain')
    assert.deepEqual(page._calculationResult.fixtures.map((fixture) => fixture.addressText), ['A500', 'B001'])
    assert.equal(page._calculationResult.fixtures[0].stableId, firstFixtureId,
      'Moving the appended group to B must retain the existing fixture identity')

    page.onHide()
    page.onUnload()
    page._qaActive = false
    page = runtime.make('main')
    assert.deepEqual(page._calculationResult.fixtures.map((fixture) => fixture.addressText), ['A500', 'B001'],
      'Reload must restore the confirmed A-to-B spillover')
    assert.equal(page._calculationResult.fixtures[0].stableId, firstFixtureId)
  } finally {
    runtime.dispose()
  }
}

function testConcurrentWorkspaceConflict() {
  const runtime = createRuntime()
  try {
    runtime.seed()
    const page = runtime.make('main')
    page.addGroup()
    selectFixtureAfterPickerExit(runtime, page, 'TL-SK3101')
    assert.equal(page.data.pendingChange.kind, 'add')
    const current = runtime.workspace.readLightingWorkspace()
    const external = clone(current.scheme)
    external.preferences.startAddressText = '7'
    const changed = runtime.workspace.saveLightingScheme(current.contextId, external, current.revision)
    assert.equal(changed.ok, true, 'The competing valid workspace update must be accepted')
    const persistedAfterExternalSave = clone(runtime.workspace.readLightingWorkspace().scheme)
    const writesAfterExternalSave = runtime.stats.writes

    page.confirmPendingChange()
    const persistedAfterConflict = runtime.workspace.readLightingWorkspace().scheme
    assert.equal(page._unsavedScheme, true, 'A stale-page save must be retained as an unsaved draft')
    assert.equal(page.data.saveRetryAvailable, true, 'A revision conflict must expose retry for the retained draft')
    assert.equal(page.data.contextError, '保存未完成，点击重试保存。')
    assert.equal(runtime.stats.writes, writesAfterExternalSave, 'A revision conflict must not overwrite the current workspace')
    assert.deepEqual(persistedAfterConflict, persistedAfterExternalSave)
    assert.equal(persistedAfterConflict.preferences.startAddressText, '7')
    assert.equal(persistedAfterConflict.preferences.groups.length, 1,
      'The unconfirmed stale draft must not replace the concurrently saved groups')
  } finally {
    runtime.dispose()
  }
}

function setStoredAllocationMode(runtime, allocationMode) {
  const preferences = runtime.storage.get('audioTool.dmxAddress.preferences')
  preferences.allocationMode = allocationMode
  runtime.storage.set('audioTool.dmxAddress.preferences', preferences)
}

function choosePendingUniverse(runtime, page, groupIndex, label) {
  const universeIndex = UNIVERSE_LABELS.indexOf(label)
  assert(universeIndex >= 0, 'The test target must be a supported universe')
  page.onPendingUniverseChange(runtime.event({ index: groupIndex }, { value: String(universeIndex) }))
}

function makeLibraryGroup(fixtureCount, targetUniverse = 'A') {
  return {
    name: 'TL-SL323',
    fixtureSource: 'library',
    fixtureModel: 'TL-SL323',
    channelCount: '2',
    libraryChannelCount: '2',
    fixtureCount: String(fixtureCount),
    targetUniverse,
  }
}

function makeCustomGroup(channelCount, fixtureCount, targetUniverse) {
  return {
    name: `自定义${targetUniverse}`,
    fixtureSource: 'custom',
    fixtureModel: '',
    customName: `自定义${targetUniverse}`,
    customChannelCount: String(channelCount),
    channelCount: String(channelCount),
    fixtureCount: String(fixtureCount),
    targetUniverse,
  }
}

function testEmptyManualSwitchAndCancel() {
  const runtime = createRuntime()
  try {
    runtime.seed([])
    let page = runtime.make('main')
    const original = clone(runtime.workspace.readLightingWorkspace().scheme)
    const writes = runtime.stats.writes
    page.switchAllocationMode(runtime.event({ mode: 'manual' }))
    assert.equal(page.data.pendingChange.kind, 'allocationMode')
    assert.equal(page.data.pendingChange.valid, true, 'An empty scheme must be valid in manual mode')
    assert.deepEqual(page.data.pendingChange.universeGroups, [], 'An empty scheme has no domains to assign')
    assert.equal(runtime.stats.writes, writes, 'Opening the switch confirmation must not write')
    page.onUserCancelPendingChange()
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, original,
      'Cancelling the empty-scheme mode switch must preserve the stored scheme')

    page.onHide()
    page.onUnload()
    page._qaActive = false
    page = runtime.make('main')
    assert.equal(page.data.allocationMode, 'auto', 'Reload after cancellation must retain continuous allocation')
    page.switchAllocationMode(runtime.event({ mode: 'manual' }))
    page.confirmPendingChange()
    const saved = runtime.workspace.readLightingWorkspace().scheme
    assert.equal(saved.preferences.allocationMode, 'manual', 'The empty candidate must switch to manual on confirmation')
    assert.deepEqual(saved.preferences.groups, [])
  } finally {
    runtime.dispose()
  }
}

function testExistingGroupsCanBeAssignedAndRestored() {
  const runtime = createRuntime()
  try {
    runtime.seed([makeLibraryGroup(2), { ...makeLibraryGroup(1), name: '第二组' }])
    setStoredAllocationMode(runtime, 'manual')
    let page = runtime.make('main')
    const writes = runtime.stats.writes
    page.onGroupUniverseChange(runtime.event({ index: 0 }, { value: '1' }))
    assert.equal(page.data.pendingChange.kind, 'groupUniverse')
    assert.equal(page.data.pendingChange.targetUniverse, 'B')
    assert.equal(page.data.pendingChange.quantityText, undefined,
      'The domain-only confirmation must not invent a quantity field')
    assert.equal(runtime.stats.writes, writes)
    page.confirmPendingChange()

    page.onGroupUniverseChange(runtime.event({ index: 1 }, { value: '2' }))
    assert.equal(page.data.pendingChange.kind, 'groupUniverse')
    assert.equal(page.data.pendingChange.targetUniverse, 'C')
    page.confirmPendingChange()
    let saved = runtime.workspace.readLightingWorkspace().scheme
    assert.deepEqual(saved.preferences.groups.map((group) => group.targetUniverse), ['B', 'C'])
    assert.deepEqual(page._calculationResult.groups.map((group) => group.fixtures[0].universeLabel), ['B', 'C'])

    const beforeCancel = clone(saved)
    page.onGroupUniverseChange(runtime.event({ index: 0 }, { value: '3' }))
    assert.equal(page.data.pendingChange.targetUniverse, 'D')
    page.onUserCancelPendingChange()
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, beforeCancel,
      'Cancelling an existing-group domain change must not persist it')
    page.onHide()
    page.onUnload()
    page._qaActive = false
    page = runtime.make('main')
    saved = runtime.workspace.readLightingWorkspace().scheme
    assert.deepEqual(saved.preferences.groups.map((group) => group.targetUniverse), ['B', 'C'],
      'Reload must preserve the confirmed B/C group assignments')
    assert.deepEqual(page.data.groups.map((group) => group.targetUniverseIndex), [1, 2])
  } finally {
    runtime.dispose()
  }
}

function testFullAGroupCanBeAddedToB() {
  const runtime = createRuntime()
  try {
    runtime.seed([makeLibraryGroup(200), makeLibraryGroup(56)])
    setStoredAllocationMode(runtime, 'manual')
    const page = runtime.make('main')
    assert.equal(page._calculationResult.totalChannels, 512, 'The existing A-domain groups must occupy all 512 channels')
    assert.equal(page._calculationResult.valid, true)
    const savedBeforeAdd = clone(runtime.workspace.readLightingWorkspace().scheme)
    const writes = runtime.stats.writes
    page.addGroup()
    selectFixtureAfterPickerExit(runtime, page, 'TL-SK3101')
    assert.equal(page.data.pendingChange.kind, 'add')
    assert.equal(page.data.pendingChange.targetUniverse, 'A', 'A remains the default domain for a new group')
    assert.equal(page.data.pendingChange.valid, true, 'The default A starting domain must continue into B when A is full')
    assert.match(page.data.pendingChange.addPreview.rangeText, /^B001/)
    assert.equal(runtime.stats.writes, writes, 'A valid default spillover preview must not write before confirmation')
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, savedBeforeAdd)
    page.confirmPendingChange()
    const saved = runtime.workspace.readLightingWorkspace().scheme
    assert.deepEqual(saved.preferences.groups.map((group) => group.targetUniverse), ['A', 'A', 'A'])
    assert.equal(page._calculationResult.fixtures.at(-1).addressText, 'B001')
  } finally {
    runtime.dispose()
  }
}

function testAutoCrossDomainCanBeCorrectedBeforeManualConfirm() {
  const runtime = createRuntime()
  try {
    runtime.seed([makeLibraryGroup(200), makeLibraryGroup(200)])
    const page = runtime.make('main')
    assert.equal(page._calculationResult.valid, true)
    const autoSecondGroup = page._calculationResult.groups[1]
    assert.equal(autoSecondGroup.fixtures[0].addressText, 'A401', 'The second automatic group must start in A')
    assert(autoSecondGroup.fixtures.some((fixture) => fixture.universeLabel === 'B'),
      'The automatic second group must cross into B for this regression')
    const savedBefore = clone(runtime.workspace.readLightingWorkspace().scheme)
    const writes = runtime.stats.writes

    page.switchAllocationMode(runtime.event({ mode: 'manual' }))
    assert.equal(page.data.pendingChange.valid, true, 'The manual proposal can spill the second group into B')
    assert.deepEqual(page.data.pendingChange.universeGroups.map((group) => group.targetUniverse), ['A', 'A'],
      'Manual proposals must retain the automatic first fixture domain')
    assert.equal(page.data.pendingChange.showEffectPreview, true,
      'A valid manual proposal must show its real fixture changes')
    assert.equal(runtime.stats.writes, writes, 'Opening a valid mode-switch preview must not write')
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, savedBefore)
    page.confirmPendingChange()
    page.finishPendingChangeClose()
    const firstManualSave = runtime.workspace.readLightingWorkspace().scheme
    assert.equal(firstManualSave.preferences.allocationMode, 'manual')
    assert.deepEqual(firstManualSave.preferences.groups.map((group) => group.targetUniverse), ['A', 'A'])
    assert.deepEqual(page._calculationResult.groups[1].fixtures.map((fixture) => fixture.universeLabel),
      [...Array(56).fill('A'), ...Array(144).fill('B')])
    assert.match(page.getResultText(), /A、B域/)
    assert.match(page.buildResultReportRecord().resultText, /A、B域/)
    const writesAfterManualConfirm = runtime.stats.writes

    page.onGroupUniverseChange(runtime.event({ index: 1 }, { value: '1' }))
    assert.equal(page.data.pendingChange.kind, 'groupUniverse')
    assert.equal(page.data.pendingChange.targetUniverse, 'B')
    assert.equal(page.data.pendingChange.valid, true, 'Changing the second group starting domain must produce a valid candidate')
    const secondPreview = page.data.pendingChange.affectedGroups.find((group) => group.id === page.data.groups[1]._lightingGroupId)
    assert.equal(secondPreview.beforeUniverse, 'A、B域', 'The old range label must show all actual fixture domains')
    assert.equal(secondPreview.afterUniverse, 'B域')
    assert.match(secondPreview.beforeRange, /^A401/)
    assert.match(secondPreview.afterRange, /^B001/)
    assert.equal(runtime.stats.writes, writesAfterManualConfirm, 'Changing a starting domain must wait for confirmation')
    page.confirmPendingChange()
    page.finishPendingChangeClose()

    const saved = runtime.workspace.readLightingWorkspace().scheme
    assert.equal(saved.preferences.allocationMode, 'manual')
    assert.deepEqual(saved.preferences.groups.map((group) => group.targetUniverse), ['A', 'B'])
    assert.equal(page._calculationResult.groups[1].fixtures[0].addressText, 'B001')
    const beforeCancel = clone(saved)
    page.onGroupUniverseChange(runtime.event({ index: 1 }, { value: '2' }))
    page.onUserCancelPendingChange()
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, beforeCancel,
      'Cancelling a later domain edit must retain the confirmed manual scheme')

    page.onHide()
    page.onUnload()
    page._qaActive = false
    const restoredPage = runtime.make('main')
    assert.equal(restoredPage.data.allocationMode, 'manual')
    assert.deepEqual(restoredPage.data.groups.map((group) => group.targetUniverse), ['A', 'B'])
    assert.equal(restoredPage._calculationResult.groups[1].fixtures[0].addressText, 'B001')
  } finally {
    runtime.dispose()
  }
}

function testManualGOverflowCorrection() {
  const runtime = createRuntime()
  try {
    runtime.seed([
      ...UNIVERSE_LABELS.slice(0, -1).map((label) => makeCustomGroup(512, 1, label)),
      makeCustomGroup(4, 127, 'G'),
    ])
    setStoredAllocationMode(runtime, 'manual')
    const page = runtime.make('main')
    const existingFixtureIds = page._calculationResult.fixtures.map((fixture) => fixture.stableId)
    const savedBefore = clone(runtime.workspace.readLightingWorkspace().scheme)
    const writes = runtime.stats.writes
    page.addGroup()
    selectFixtureAfterPickerExit(runtime, page, 'TL-SK3101')
    page.onPendingModeChange(runtime.event({}, { value: '1' }))
    assert.equal(page.data.pendingChange.valid, false, 'A 5-channel fixture cannot fit in the final four G slots')
    assert.match(page.data.pendingChange.error, /G512/)
    page.confirmPendingChange()
    assert.equal(runtime.stats.writes, writes, 'A G512 overflow must not write a partial plan')
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, savedBefore)

    page.onPendingModeChange(runtime.event({}, { value: '0' }))
    assert.equal(page.data.pendingChange.valid, true, 'A supported 2-channel mode must fit in the remaining G slots')
    assert.match(page.data.pendingChange.addPreview.rangeText, /^G509–G510$/)
    assert.equal(runtime.stats.writes, writes, 'The corrected preview must also wait for confirmation')
    page.confirmPendingChange()
    assert.equal(page._calculationResult.fixtures.at(-1).addressText, 'G509')
    assert.deepEqual(page._calculationResult.fixtures.slice(0, existingFixtureIds.length).map((fixture) => fixture.stableId),
      existingFixtureIds, 'A corrected plan must preserve existing fixture identities')
  } finally {
    runtime.dispose()
  }
}

function testSevenManualDomainsAndGOccupancy() {
  const runtime = createRuntime()
  try {
    runtime.seed(UNIVERSE_LABELS.map((label) => makeLibraryGroup(1, label)))
    setStoredAllocationMode(runtime, 'manual')
    let page = runtime.make('main')
    const existingFixtureIds = page._calculationResult.fixtures.map((fixture) => fixture.stableId)
    assert.deepEqual(page.data.universeOptions, UNIVERSE_LABELS)
    assert.deepEqual(page._calculationResult.fixtures.map((fixture) => fixture.addressText),
      UNIVERSE_LABELS.map((label) => `${label}001`),
      'Manual assignment must allocate one fixture in every supported domain')

    page.onSelectedUniverseChange(runtime.event({}, { value: '6' }))
    assert.equal(page.data.selectedUniverseLabel, 'G')
    assert.equal(page.data.nextAvailableAddress, 'G003', 'The manual occupancy strip must show the selected G cursor')
    assert.deepEqual(page.data.selectedUniverseFixtures.map((fixture) => fixture.addressText), ['G001'])

    page.addGroup()
    selectFixtureAfterPickerExit(runtime, page, 'TL-SK3101')
    assert.equal(page.data.pendingChange.kind, 'add')
    choosePendingUniverse(runtime, page, UNIVERSE_LABELS.length, 'G')
    assert.equal(page.data.pendingChange.valid, true)
    assert.match(page.data.pendingChange.addPreview.rangeText, /^G003/)
    page.confirmPendingChange()
    const saved = runtime.workspace.readLightingWorkspace().scheme
    assert.deepEqual(saved.preferences.groups.map((group) => group.targetUniverse), [...UNIVERSE_LABELS, 'G'])
    assert.deepEqual(page._calculationResult.fixtures.slice(0, existingFixtureIds.length).map((fixture) => fixture.stableId), existingFixtureIds,
      'Extending the manual plan must retain existing fixture identities')
    assert.deepEqual(page._calculationResult.fixtures.filter((fixture) => fixture.universeLabel === 'G').map((fixture) => fixture.addressText), ['G001', 'G003'])

    page.onHide()
    page.onUnload()
    page._qaActive = false
    page = runtime.make('main')
    assert.deepEqual(page.data.groups.map((group) => group.targetUniverse), [...UNIVERSE_LABELS, 'G'],
      'Reload must restore the confirmed E/F/G assignments')
    page.onSelectedUniverseChange(runtime.event({}, { value: '6' }))
    assert.equal(page.data.nextAvailableAddress, 'G005', 'Reloaded G occupancy must use the last saved address')
    assert.deepEqual(page._calculationResult.fixtures.slice(0, existingFixtureIds.length).map((fixture) => fixture.stableId), existingFixtureIds)
  } finally {
    runtime.dispose()
  }
}

function testManualEmptyDomainStartsAtConfiguredAddress() {
  const runtime = createRuntime()
  try {
    runtime.seed([makeLibraryGroup(1, 'G')])
    const preferences = runtime.storage.get('audioTool.dmxAddress.preferences')
    preferences.startAddressText = '73'
    preferences.allocationMode = 'manual'
    runtime.storage.set('audioTool.dmxAddress.preferences', preferences)
    const page = runtime.make('main')

    page.onSelectedUniverseChange(runtime.event({}, { value: '0' }))
    assert.equal(page.data.nextAvailableAddress, 'A073',
      'An empty A domain must use its configured start address even when the plan begins in G')
    page.onSelectedUniverseChange(runtime.event({}, { value: '4' }))
    assert.equal(page.data.nextAvailableAddress, 'E001', 'An empty later domain must start at 001')
  } finally {
    runtime.dispose()
  }
}

testSingleModelAddAndRestore()
testManualDomainOverflow()
testConcurrentWorkspaceConflict()
testEmptyManualSwitchAndCancel()
testExistingGroupsCanBeAssignedAndRestored()
testFullAGroupCanBeAddedToB()
testAutoCrossDomainCanBeCorrectedBeforeManualConfirm()
testManualGOverflowCorrection()
testSevenManualDomainsAndGOccupancy()
testManualEmptyDomainStartsAtConfiguredAddress()
console.log('DMX single-model add and group-domain regression passed: catalog path, mode and quantity validation, A–G domain assignment, overflow correction, cancel/restore, continuous allocation and workspace conflict')

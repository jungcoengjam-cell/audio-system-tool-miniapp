'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

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
    const page = runtime.make('main')
    const savedBefore = clone(runtime.workspace.readLightingWorkspace().scheme)
    const writes = runtime.stats.writes
    page.addGroup()
    selectFixtureAfterPickerExit(runtime, page, 'TL-SV3104')
    assert.equal(page.data.pendingChange.kind, 'add')
    assert.equal(page.data.pendingChange.valid, false, 'A 20-channel fixture that crosses the manual A-domain boundary must be rejected')
    assert.match(page.data.pendingChange.error, /无法完整放入 A 域/)
    page.confirmPendingChange()
    assert.equal(runtime.stats.writes, writes, 'An address-overflow preview must not persist')
    assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, savedBefore)
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

testSingleModelAddAndRestore()
testManualDomainOverflow()
testConcurrentWorkspaceConflict()
console.log('DMX single-model add regression passed: catalog path, supported mode, quantity validation, address preview/overflow, confirm/restore, unrelated placement, workspace conflict')

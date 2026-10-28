'use strict'

const assert = require('node:assert/strict')
const { createDmxSheetLifecycleMethods } = require('../../pages/dmx-address/sheet-lifecycle')
const { createDmxCardInteractionMethods } = require('../../pages/dmx-address/card-interactions')
const { createDmxLayoutPage } = require('../../pages/dmx-layout/page-factory')
const { createRuntime, clone } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

function createTimers() {
  const rows = []
  let nextId = 1
  return {
    rows,
    setTimeout(callback, delay, ...args) {
      const timer = { id: nextId++, callback, delay, args, cancelled: false, ran: false }
      rows.push(timer)
      return timer.id
    },
    clearTimeout(id) {
      const timer = rows.find((item) => item.id === id)
      if (timer) timer.cancelled = true
    },
    run(id) {
      const timer = rows.find((item) => item.id === id)
      assert(timer, 'Expected timer ' + id)
      assert.equal(timer.cancelled, false, 'Cannot run a canceled timer')
      assert.equal(timer.ran, false, 'Timer may only run once')
      timer.ran = true
      timer.callback(...timer.args)
    },
    active(delay) {
      return rows.filter((timer) => !timer.cancelled && !timer.ran && (delay === undefined || timer.delay === delay))
    },
  }
}

function installTimers(timers) {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  global.setTimeout = timers.setTimeout
  global.clearTimeout = timers.clearTimeout
  return () => {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
}

function makeDeferredSetData(page) {
  const callbacks = []
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      parts.slice(0, -1).forEach((part) => { target = target[part] || (target[part] = {}) })
      target[parts.at(-1)] = clone(value)
    })
    if (typeof callback === 'function') callbacks.push(callback)
  }
  return {
    callbacks,
    flush() {
      let passes = 0
      while (callbacks.length && passes < 100) {
        callbacks.shift()()
        passes += 1
      }
      assert(passes < 100, 'setData callbacks did not settle')
    },
  }
}

function testAddressSheetCloseWaitsForRenderAndRejectsStaleCallbacks() {
  const timers = createTimers()
  const callbacks = []
  const methods = createDmxSheetLifecycleMethods({
    cancelResultReportGeneration() {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })
  const page = {
    ...methods,
    data: { fixtureSearchOpen: true, fixtureBatchOpen: false, fixtureSearchGroupIndex: -1, fixtureSearchSelectedModel: '', fixturePickerClosing: false },
    _pageAlive: true,
    _pageVisible: true,
    _contextId: 'context-a',
    _sheetCloseTimers: Object.create(null),
    _sheetCloseTokens: Object.create(null),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) callbacks.push(callback)
    },
  }
  let staleFinalized = 0
  let currentFinalized = 0

  page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => { staleFinalized += 1 })
  page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => { currentFinalized += 1 })
  assert.equal(timers.active().length, 0, 'Close timer must wait for setData render callback')
  callbacks.shift()()
  assert.equal(timers.active().length, 0, 'Superseded setData callback must not start a timer')
  callbacks.shift()()
  const currentTimer = page._sheetCloseTimers.fixturePicker
  assert.equal(timers.active(180).length, 1, 'Current close should start one 180 ms timer after render')
  timers.run(currentTimer)
  assert.equal(staleFinalized, 0, 'Superseded close must not finalize')
  assert.equal(currentFinalized, 1, 'Current close must finalize once')

  page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => { staleFinalized += 1 })
  page.openSheetModal('fixturePicker', 'fixturePickerClosing')
  callbacks.shift()()
  assert.equal(timers.active().length, 0, 'Reopen must invalidate a queued close callback')
  assert.equal(page.data.fixturePickerClosing, false)

  page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => { staleFinalized += 1 })
  callbacks.shift()()
  const canceledTimer = page._sheetCloseTimers.fixturePicker
  page.openSheetModal('fixturePicker', 'fixturePickerClosing')
  assert.equal(timers.rows.find((item) => item.id === canceledTimer).cancelled, true,
    'Reopen must cancel an already scheduled close timer')
  assert.equal(staleFinalized, 0, 'Reopen must cancel an already scheduled close timer')

  page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => { staleFinalized += 1 })
  page._pageVisible = false
  callbacks.shift()()
  assert.equal(timers.active().length, 0, 'Hidden page must not schedule a delayed close')
}

function testLayoutSheetCloseWaitsForRenderCallback() {
  const timers = createTimers()
  const callbacks = []
  const definition = createDmxLayoutPage({ mode: 'portrait' })
  const page = {
    ...definition,
    data: { layoutPanelVisible: true, layoutPanelClosing: false },
    _alive: true,
    _visible: true,
    _visibilityToken: 4,
    _contextId: 'layout-a',
    _sheetCloseTimers: Object.create(null),
    _sheetCloseTokens: Object.create(null),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) callbacks.push(callback)
    },
  }
  let finalized = 0
  const restoreTimers = installTimers(timers)
  try {
    page.beginSheetClose('settings', 'layoutPanelClosing', () => { finalized += 1 })
    assert.equal(timers.active().length, 0, 'Layout timer must wait for setData render callback')
    callbacks.shift()()
    const timer = page._sheetCloseTimers.settings
    assert.equal(timers.active(180).length, 1)
    timers.run(timer)
    assert.equal(finalized, 1)
  } finally {
    restoreTimers()
  }
}

function testFloatingCardCloseWaitsForRenderCallback() {
  const timers = createTimers()
  const callbacks = []
  const methods = createDmxCardInteractionMethods({
    Date: { now: () => 1 },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    wx: {},
  })
  const page = {
    ...methods,
    data: { floatingGroup: { id: 'g1' }, floatingVisible: true, floatingClosing: false },
    _pageAlive: true,
    _pageVisible: true,
    _floatingClosing: false,
    _floatingOrigin: { left: 1, top: 2, width: 3, height: 4 },
    _floatingTransitionId: 0,
    _floatingPositionRequestId: 0,
    _floatingTransitionTimer: null,
    _floatingTouchStart: null,
    _touchGestureToken: 0,
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) callbacks.push(callback)
    },
  }
  page.closeFloatingCard()
  assert.equal(timers.active().length, 0, 'Floating card timer must wait for the closing style render')
  callbacks.shift()()
  const timer = page._floatingTransitionTimer
  assert.equal(timers.active(230).length, 1)
  timers.run(timer)
  assert.equal(page.data.floatingGroup, null)
}

function testRealFixturePickerSelectionAndBatchConfirmationAnimateOnce() {
  const timers = createTimers()
  const restoreTimers = installTimers(timers)
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make('main')
    const deferred = makeDeferredSetData(page)
    const model = 'TL-SL323'

    page.resetFixturePicker('search', { fixtureSearchGroupIndex: -1 })
    const nextGroupId = page._nextGroupId
    page.selectFixture(runtime.event({ model }))
    page.selectFixture(runtime.event({ model }))
    assert.equal(page.data.fixtureSearchOpen, true, 'Selected fixture picker must remain mounted during exit')
    assert.equal(page.data.fixturePickerClosing, true)
    assert.equal(page.data.pendingChange, null, 'Confirmation preview waits until picker exit finishes')
    assert.equal(page._nextGroupId, nextGroupId, 'Repeated selection must not allocate duplicate fixture groups')
    assert.equal(page._sheetCloseTimers.fixturePicker, null, 'Timer waits for asynchronous setData callback')
    deferred.flush()
    timers.run(page._sheetCloseTimers.fixturePicker)
    assert.equal(page.data.fixtureSearchOpen, false)
    assert.equal(page.data.pendingChange?.kind, 'add', 'Picker exit should then open the add confirmation')
    assert.equal(page._nextGroupId, nextGroupId + 1, 'Fixture group is allocated once')

    const writesBeforeConfirm = runtime.stats.writes
    page.confirmPendingChange()
    const writesAfterConfirm = runtime.stats.writes
    assert(writesAfterConfirm > writesBeforeConfirm, 'Confirm should commit the lighting scheme immediately')
    assert(page.data.pendingChange, 'Successful confirmation remains mounted during its exit')
    assert.equal(page.data.pendingChangeClosing, true)
    page.confirmPendingChange()
    assert.equal(runtime.stats.writes, writesAfterConfirm, 'Repeated confirm during exit must not recommit')
    deferred.flush()
    timers.run(page._sheetCloseTimers.pendingChange)
    assert.equal(page.data.pendingChange, null)
    assert.equal(page.data.groups.length, 2, 'Confirmed fixture result remains applied after animated dismissal')
  } finally {
    runtime.dispose()
    restoreTimers()
  }

  const batchTimers = createTimers()
  const restoreBatchTimers = installTimers(batchTimers)
  const batchRuntime = createRuntime()
  batchRuntime.seed()
  try {
    const page = batchRuntime.make('main')
    const deferred = makeDeferredSetData(page)
    page.resetFixturePicker('batch')
    page.toggleBatchFixture(batchRuntime.event({ model: 'TL-SL323' }))
    page.confirmBatchAdd()
    const writesAfterAdd = batchRuntime.stats.writes
    assert.equal(page.data.fixtureBatchOpen, true, 'Batch picker must stay mounted during exit')
    assert.equal(page.data.fixturePickerClosing, true)
    assert.equal(page.data.groups[0].fixtureCount, '5', 'Batch result commits immediately')
    page.confirmBatchAdd()
    assert.equal(batchRuntime.stats.writes, writesAfterAdd, 'Repeated batch confirm during exit must not commit twice')
    deferred.flush()
    batchTimers.run(page._sheetCloseTimers.fixturePicker)
    assert.equal(page.data.fixtureBatchOpen, false)
  } finally {
    batchRuntime.dispose()
    restoreBatchTimers()
  }
}

function testSaveContextCommitsBeforeSheetExitAndSurvivesImmediateHide() {
  const timers = createTimers()
  const restoreTimers = installTimers(timers)
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make('main')
    const deferred = makeDeferredSetData(page)
    const previousContext = page._contextId
    page.onSaveNewProjectToggle()
    page.onNewProjectNameEntry()
    page.onProjectNameInput({ detail: { value: '动画回归项目' } })
    page.saveLightingAsNewProject()
    const savedContext = page.data.pendingProjectSaveId
    assert(savedContext && savedContext !== previousContext)
    assert.equal(page._contextId, savedContext, 'Successful save must switch the page context before animation')
    assert.equal(runtime.workspace.readLightingWorkspace(savedContext).contextId, savedContext,
      'The switched context must already match persisted workspace state')
    assert.equal(page.data.showSaveNewProject, true, 'Save sheet remains mounted while exiting')
    assert.equal(page.data.saveProjectClosing, true)

    deferred.flush()
    const saveExitTimer = page._sheetCloseTimers.saveProject
    assert.equal(timers.rows.find((timer) => timer.id === saveExitTimer).delay, 180)
    assert.equal(page.data.showSaveNewProject, true, 'Successful save waits for its visible exit transition')
    timers.run(saveExitTimer)
    assert.equal(page.data.showSaveNewProject, false)

    page.onSaveNewProjectToggle()
    page.onNewProjectNameEntry()
    page.onProjectNameInput({ detail: { value: '动画回归项目-立即隐藏' } })
    page.saveLightingAsNewProject()
    const hiddenSaveContext = page.data.pendingProjectSaveId
    assert(hiddenSaveContext && hiddenSaveContext !== savedContext)
    assert.equal(page._contextId, hiddenSaveContext, 'Second save also changes the project context synchronously')

    page.onHide()
    deferred.flush()
    assert.equal(page._contextId, hiddenSaveContext, 'Immediate hide must not discard the completed project context switch')
    assert.equal(runtime.workspace.readLightingWorkspace(hiddenSaveContext).contextId, hiddenSaveContext)
    assert.equal(timers.active().filter((timer) => timer.delay === 180).length, 0,
      'Forced hide must invalidate the queued animated exit')
    assert.equal(page.data.showSaveNewProject, false, 'Hide still performs immediate modal cleanup')
  } finally {
    runtime.dispose()
    restoreTimers()
  }
}

function testLayoutReductionCommitIsImmediateAndSheetExitIsAnimated() {
  const timers = createTimers()
  const restoreTimers = installTimers(timers)
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make('portrait')
    runtime.place(page, 0, 2)
    const deferred = makeDeferredSetData(page)
    const originalRodCount = page._layout.internalRods.length

    page.openLayoutSettings()
    const writesBeforeApply = runtime.stats.writes
    page.applyLayoutSettings()
    assert(runtime.stats.writes > writesBeforeApply, 'A successful layout apply must save before its exit animation')
    assert.equal(page.data.layoutPanelVisible, true)
    assert.equal(page.data.layoutPanelClosing, true)
    assert.equal(page._sheetCloseTimers.settings, null, 'Direct apply timer waits for closing style render')
    deferred.flush()
    timers.run(page._sheetCloseTimers.settings)
    assert.equal(page.data.layoutPanelVisible, false)
    deferred.flush()

    page.openLayoutSettings()
    page.changeDraftRodCount(runtime.event({ kind: 'internalRods', delta: -1 }))
    page.applyLayoutSettings()
    assert(page.data.reductionConfirm, 'Removing a populated rod should require confirmation')

    const writesBefore = runtime.stats.writes
    page.confirmLayoutReduction()
    assert(runtime.stats.writes > writesBefore, 'Confirmed reduction must save immediately')
    assert.equal(page._layout.internalRods.length, originalRodCount - 1)
    assert(page.data.reductionConfirm, 'Reduction confirmation remains mounted during its exit')
    assert.equal(page.data.reductionClosing, true)
    assert.equal(page.data.layoutPanelClosing, false, 'Parent sheet exit starts after the nested confirmation renders its closing state')
    assert.equal(page._sheetCloseTimers.settings, null, 'Parent timer waits for both setData render callbacks')

    deferred.flush()
    assert.equal(page.data.layoutPanelClosing, true)
    timers.run(page._sheetCloseTimers.settings)
    assert.equal(page.data.reductionConfirm, null)
    assert.equal(page.data.layoutPanelVisible, false)
  } finally {
    runtime.dispose()
    restoreTimers()
  }
}

function testDmxInlineDisclosuresStayMountedThroughCollapse() {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const page = runtime.make('main')
    const wxml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/dmx-address/dmx-address.wxml'), 'utf8')
    assert.match(wxml, /id="dmx-pending-removed-details" class="disclosure-motion \{\{removedDetailsExpanded \?/)
    assert.doesNotMatch(wxml, /<view wx:if="\{\{removedDetailsExpanded\}\}"/,
      'Removed fixture details must not unmount when their disclosure collapses')
    assert.match(wxml, /id="fixture-channel-guide-detail" class="[^"]*disclosure-motion[^"]*fixtureChannelGuideDetailExpanded/)

    page.data.pendingChange = { kind: 'delete' }
    page.toggleRemovedDetails()
    assert.equal(page.data.removedDetailsExpanded, true)
    page.toggleRemovedDetails()
    assert.equal(page.data.removedDetailsExpanded, false)
    page.data.removedDetailsExpanded = true
    page.cancelPendingChange({ preserveVisual: true })
    assert.equal(page.data.removedDetailsExpanded, true, 'Cancel keeps expanded content mounted during the parent sheet exit')
    page.finishPendingChangeClose()
    assert.equal(page.data.removedDetailsExpanded, false, 'Expanded details reset after the parent sheet finishes closing')

    page.data.fixtureChannelGuide = {
      channels: [
        { channel: 1, actualAddress: '001', name: 'Dimmer', ranges: [{ range: '0-255', description: '亮度' }] },
        { channel: 2, actualAddress: '002', name: 'Strobe', ranges: [{ range: '0-255', description: '频闪' }] },
      ],
    }
    page.data.fixtureChannelGuideClosing = false
    page.data.fixtureChannelGuideDetail = null
    page.data.fixtureChannelGuideDetailExpanded = false
    page.selectFixtureChannelGuideDetail(runtime.event({ channelIndex: 0 }))
    const firstDetail = page.data.fixtureChannelGuideDetail
    assert.equal(page.data.fixtureChannelGuideDetailExpanded, true)
    page.closeFixtureChannelGuideDetail()
    assert.equal(page.data.fixtureChannelGuideDetailExpanded, false)
    assert.equal(page.data.fixtureChannelGuideDetail, firstDetail,
      'Detail data remains available to the disclosure while its grid row collapses')
    page.selectFixtureChannelGuideDetail(runtime.event({ channelIndex: 0 }))
    assert.equal(page.data.fixtureChannelGuideDetailExpanded, true, 'The same channel can reopen after collapse')
    page.selectFixtureChannelGuideDetail(runtime.event({ channelIndex: 1 }))
    assert.equal(page.data.fixtureChannelGuideDetail.channel, 2, 'Selecting another channel replaces detail content without closing the panel')
    assert.equal(page.data.fixtureChannelGuideDetailExpanded, true)
    page.closeFixtureChannelGuide()
    assert.equal(page.data.fixtureChannelGuideDetail, null, 'Closing the whole guide clears retained detail data')
    assert.equal(page.data.fixtureChannelGuideDetailExpanded, false)
  } finally {
    runtime.dispose()
  }
}

testAddressSheetCloseWaitsForRenderAndRejectsStaleCallbacks()
testLayoutSheetCloseWaitsForRenderCallback()
testFloatingCardCloseWaitsForRenderCallback()
testRealFixturePickerSelectionAndBatchConfirmationAnimateOnce()
testSaveContextCommitsBeforeSheetExitAndSurvivesImmediateHide()
testLayoutReductionCommitIsImmediateAndSheetExitIsAnimated()
testDmxInlineDisclosuresStayMountedThroughCollapse()
console.log('PASS DMX modal animation lifecycle: async render timing, stale close races, fixture select/batch/confirm, save hide, layout reduction, and inline disclosures (7 cases)')

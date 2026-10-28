'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

const originalPage = global.Page
const originalWx = global.wx
const pageDefinitions = {}

global.wx = {
  vibrateShort() {},
  getSystemInfoSync() { return {} },
}

function capturePage(name, relativePath) {
  let definition = null
  global.Page = (value) => { definition = value }
  require(path.resolve(__dirname, relativePath))
  assert.ok(definition, `${name} page registers`)
  pageDefinitions[name] = definition
}

capturePage('controlProtocol', '../pages/control-protocol/detail.js')
capturePage('spl', '../pages/spl/spl.js')
capturePage('project', '../pages/records/project.js')
global.Page = originalPage

const timers = new Map()
let nextTimerId = 0
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout
global.setTimeout = (callback, delay) => {
  const id = ++nextTimerId
  timers.set(id, { callback, delay: Number(delay), cleared: false, fired: false })
  return id
}
global.clearTimeout = (id) => {
  const timer = timers.get(id)
  if (timer) timer.cleared = true
}

function activeTimers() {
  return [...timers.entries()].filter(([, timer]) => !timer.cleared && !timer.fired)
}

function resetTimers() {
  timers.clear()
}

function runTimer(id, { force = false } = {}) {
  const timer = timers.get(id)
  assert.ok(timer, `timer ${id} exists`)
  if (timer.cleared && !force) return
  timer.fired = true
  timer.callback()
}

function makeAsyncPage(name, data, properties = {}) {
  const callbacks = []
  const instance = {
    ...pageDefinitions[name],
    data: { ...pageDefinitions[name].data, ...data },
    ...properties,
    setData(changes, callback) {
      Object.assign(this.data, changes)
      if (typeof callback === 'function') callbacks.push(callback)
    },
    commitNextSetData() {
      const callback = callbacks.shift()
      assert.equal(typeof callback, 'function', 'a setData callback is pending')
      callback()
    },
    pendingSetDataCallbacks: callbacks,
  }
  return instance
}

function testControlProtocolOverlay() {
  const page = makeAsyncPage('controlProtocol', { activeOverlay: '', sheetOpen: false }, {
    _pageUnloaded: false,
    _sheetDuration: 320,
    _sheetOpenTimer: null,
    _sheetCloseTimer: null,
    _sheetTransitionEpoch: 0,
    _sheetCloseReady: false,
  })

  page.openOverlay()
  assert.equal(page.data.activeOverlay, 'device')
  assert.equal(page.data.sheetOpen, false)
  assert.equal(activeTimers().length, 0, 'open waits for the mount setData callback before starting its 16 ms timer')
  page.commitNextSetData()
  assert.deepEqual(activeTimers().map(([, timer]) => timer.delay), [16])
  const openingTimer = activeTimers()[0][0]
  runTimer(openingTimer)
  assert.equal(page.data.sheetOpen, true, 'the opening timer starts the sheet transition')

  page.closeOverlay()
  assert.equal(page.data.sheetOpen, false)
  assert.equal(activeTimers().length, 0, 'close waits for the closing setData callback before starting its timer')
  page.commitNextSetData()
  assert.deepEqual(activeTimers().map(([, timer]) => timer.delay), [344], 'close keeps the original 320 ms duration plus 24 ms fallback')

  resetTimers()
  const closingPage = makeAsyncPage('controlProtocol', { activeOverlay: 'device', sheetOpen: true }, {
    _pageUnloaded: false,
    _sheetDuration: 320,
    _sheetOpenTimer: null,
    _sheetCloseTimer: null,
    _sheetTransitionEpoch: 2,
    _sheetCloseReady: false,
  })
  closingPage.closeOverlay()
  closingPage.openOverlay()
  assert.equal(activeTimers().length, 0, 'pending setData callbacks do not start close or open timers before commit')
  closingPage.commitNextSetData() // stale close callback
  assert.equal(activeTimers().length, 0, 'a stale close callback after reopening cannot start its timer')
  closingPage.commitNextSetData() // current open callback
  assert.deepEqual(activeTimers().map(([, timer]) => timer.delay), [16], 'only the reopened panel receives an opening timer')
  const reopenedTimer = activeTimers()[0][0]
  closingPage.onSheetTransitionEnd({ target: {}, currentTarget: {} })
  assert.equal(closingPage.data.activeOverlay, 'device', 'a late transition event cannot remove a reopened, not-yet-open panel')
  runTimer(reopenedTimer)
  assert.equal(closingPage.data.sheetOpen, true)

  resetTimers()
  const staleTimerPage = makeAsyncPage('controlProtocol', { activeOverlay: 'device', sheetOpen: true }, {
    _pageUnloaded: false,
    _sheetDuration: 320,
    _sheetOpenTimer: null,
    _sheetCloseTimer: null,
    _sheetTransitionEpoch: 4,
    _sheetCloseReady: false,
  })
  staleTimerPage.closeOverlay()
  staleTimerPage.commitNextSetData()
  const staleCloseTimer = activeTimers().find(([, timer]) => timer.delay === 344)[0]
  staleTimerPage.openOverlay()
  assert.equal(activeTimers().length, 0, 'reopening cancels the close timer before its own render commits')
  staleTimerPage.commitNextSetData()
  const activeBeforeStaleCallback = activeTimers().filter(([, timer]) => timer.delay === 16)[0]
  assert.ok(activeBeforeStaleCallback, 'reopening schedules its own timer after its commit')
  runTimer(staleCloseTimer, { force: true })
  assert.equal(staleTimerPage.data.activeOverlay, 'device', 'a queued old close timer cannot remove the new panel')
  assert.equal(staleTimerPage._sheetOpenTimer, activeBeforeStaleCallback[0], 'a stale callback cannot clear the new timer handle')
  resetTimers()
}

function testSplShareAndProjectSheets() {
  const sharePage = makeAsyncPage('spl', {
    canUseResultActions: true,
    isCalculationPending: false,
    shareSheetVisible: true,
    shareSheetClosing: false,
    isGeneratingResultReport: false,
    isCheckingResultReportCache: false,
  }, { _isUnloaded: false, _shareCloseRevision: 0, _shareCloseTimer: null })

  assert.equal(sharePage.closeSharePreview(), true)
  assert.equal(activeTimers().length, 0, 'SPL share close waits for the closing state to render')
  sharePage.commitNextSetData()
  assert.deepEqual(activeTimers().map(([, timer]) => timer.delay), [320])
  const shareCloseTimer = activeTimers()[0][0]
  sharePage.closeSharePreview({ silent: true })
  assert.equal(activeTimers().length, 0, 'silent close clears an outstanding share timer')
  runTimer(shareCloseTimer, { force: true })
  assert.equal(sharePage.data.shareSheetVisible, false, 'the canceled share timer cannot change the closed state')

  resetTimers()
  const generatingSharePage = makeAsyncPage('spl', {
    canUseResultActions: true,
    isCalculationPending: false,
    shareSheetVisible: true,
    shareSheetClosing: false,
    isGeneratingResultReport: true,
    isCheckingResultReportCache: false,
  }, {
    _isUnloaded: false,
    _shareCloseRevision: 3,
    _shareCloseTimer: null,
    resultReportRevision: 7,
    resultReportPendingSignature: 'pending-signature',
    resultReportSignature: 'current-signature',
    _reportCacheCheckRevision: 7,
  })
  generatingSharePage.closeSharePreview()
  assert.equal(generatingSharePage.data.isGeneratingResultReport, true,
    'normal close cancels report work without changing the visible generating state')
  assert.equal(generatingSharePage.resultReportPendingSignature, '', 'the canceled generation token is invalidated')
  assert.equal(generatingSharePage.resultReportSignature, '', 'closing clears the stale report signature')
  generatingSharePage.commitNextSetData()
  const generatingCloseTimer = activeTimers()[0][0]
  runTimer(generatingCloseTimer)
  assert.equal(generatingSharePage.data.isGeneratingResultReport, false,
    'the loading state is cleared with the sheet after its exit duration')

  const silentGeneratingPage = makeAsyncPage('spl', {
    canUseResultActions: true,
    isCalculationPending: false,
    shareSheetVisible: true,
    shareSheetClosing: false,
    isGeneratingResultReport: true,
    isCheckingResultReportCache: false,
  }, { _isUnloaded: false, _shareCloseRevision: 0, _shareCloseTimer: null })
  silentGeneratingPage.closeSharePreview({ silent: true })
  assert.equal(silentGeneratingPage.data.isGeneratingResultReport, false, 'silent close still cancels generation immediately')
  assert.equal(silentGeneratingPage.data.shareSheetVisible, false)

  resetTimers()
  const projectPage = makeAsyncPage('spl', {
    projectSheetVisible: true,
    projectSheetClosing: false,
    isSavingProject: false,
  }, {
    _isUnloaded: false,
    _projectCloseRevision: 0,
    _projectRevision: 1,
    _projectSnapshotForSave: { payload: {} },
    _projectSavePending: false,
    _projectCloseTimer: null,
    resetProjectKeyboardState() { return {} },
  })
  assert.equal(projectPage.closeProjectSheet(), true)
  assert.equal(activeTimers().length, 0, 'SPL project close waits for the closing state to render')
  projectPage.commitNextSetData()
  assert.deepEqual(activeTimers().map(([, timer]) => timer.delay), [320])
  resetTimers()
}

function testSplLifecycleCancelsCloseTimers() {
  const sharePage = makeAsyncPage('spl', {
    canUseResultActions: true,
    isCalculationPending: false,
    shareSheetVisible: true,
    shareSheetClosing: false,
    isGeneratingResultReport: false,
    isCheckingResultReportCache: false,
  }, {
    _isUnloaded: false,
    _previewImageOpening: false,
    _shareCloseRevision: 0,
    _shareCloseTimer: null,
    _projectCloseRevision: 0,
    _projectCloseTimer: null,
    cancelSpeakerSelectorClose() {},
    flushDistanceCalculation() {},
    invalidateProjectSave() {},
    resetProjectKeyboardState() { return {} },
  })
  sharePage.closeSharePreview()
  sharePage.commitNextSetData()
  const shareTimer = activeTimers()[0][0]
  sharePage.onHide()
  assert.equal(activeTimers().length, 0, 'SPL hide clears the share close timer')
  assert.equal(sharePage.data.shareSheetVisible, false)
  runTimer(shareTimer, { force: true })
  assert.equal(sharePage.data.shareSheetClosing, false, 'a stale share timer cannot reopen or mutate the hidden sheet')

  resetTimers()
  const projectPage = makeAsyncPage('spl', {
    projectSheetVisible: true,
    projectSheetClosing: false,
    isSavingProject: false,
  }, {
    _isUnloaded: false,
    _projectCloseRevision: 0,
    _projectRevision: 1,
    _projectSnapshotForSave: { payload: {} },
    _projectSavePending: false,
    _projectCloseTimer: null,
    cancelSpeakerSelectorClose() {},
    cancelDistanceCalculation() {},
    invalidateProjectSave() {},
    resetProjectKeyboardState() { return {} },
  })
  projectPage.closeProjectSheet()
  projectPage.commitNextSetData()
  const projectTimer = activeTimers()[0][0]
  projectPage.onUnload()
  assert.equal(activeTimers().length, 0, 'SPL unload clears the project close timer')
  runTimer(projectTimer, { force: true })
  assert.equal(projectPage.data.projectSheetVisible, true, 'an old project timer cannot update an unloaded page')
  resetTimers()
}

function testProjectRenameSheet() {
  const openPage = makeAsyncPage('project', {
    project: { name: '现场项目' },
    workspaceError: '',
    renameVisible: true,
    renameClosing: false,
    renameDraft: '尚未保存的新名称',
  }, { _projectDestroyed: false, _renameCloseRevision: 0, _renameCloseTimer: null })
  openPage.onHide()
  assert.equal(openPage.data.renameVisible, true, 'hide preserves an open rename sheet that was not closing')
  assert.equal(openPage.data.renameDraft, '尚未保存的新名称', 'hide preserves the uncommitted rename draft')
  assert.equal(openPage.data.renameClosing, false)

  const page = makeAsyncPage('project', {
    project: { name: '现场项目' },
    workspaceError: '',
    renameVisible: true,
    renameClosing: false,
    renameDraft: '现场项目',
  }, { _projectDestroyed: false, _renameCloseRevision: 0, _renameCloseTimer: null })

  page.closeRenameProject()
  assert.equal(activeTimers().length, 0, 'rename close waits for its closing state to render')
  page.startRenameProject()
  page.commitNextSetData() // old close callback after a new open
  assert.equal(page.data.renameVisible, true)
  assert.equal(page.data.renameClosing, false)
  assert.equal(activeTimers().length, 0, 'an old rename close callback cannot schedule a timer after reopening')

  page.closeRenameProject()
  page.commitNextSetData()
  assert.deepEqual(activeTimers().map(([, timer]) => timer.delay), [180], 'rename keeps its 180 ms close duration')
  const renameCloseTimer = activeTimers()[0][0]
  page.onHide()
  assert.equal(activeTimers().length, 0, 'hide cancels the rename timer')
  assert.equal(page.data.renameVisible, false, 'hide dismisses a pending rename sheet')
  runTimer(renameCloseTimer, { force: true })
  assert.equal(page.data.renameVisible, false, 'the stale rename callback leaves the hidden page closed')

  const unloadPage = makeAsyncPage('project', {
    renameVisible: true,
    renameClosing: false,
  }, { _projectDestroyed: false, _renameCloseRevision: 0, _renameCloseTimer: null })
  unloadPage.closeRenameProject()
  unloadPage.commitNextSetData()
  const unloadTimer = activeTimers()[0][0]
  unloadPage.onUnload()
  assert.equal(activeTimers().length, 0, 'project detail unload clears the rename timer')
  runTimer(unloadTimer, { force: true })
  assert.equal(unloadPage.data.renameVisible, true, 'a stale rename timer cannot update an unloaded page')
  resetTimers()
}

try {
  testControlProtocolOverlay()
  testSplShareAndProjectSheets()
  testSplLifecycleCancelsCloseTimers()
  testProjectRenameSheet()
  console.log('Overlay render commit regression checks passed (control protocol, SPL share/project sheets, and project rename).')
} finally {
  global.setTimeout = originalSetTimeout
  global.clearTimeout = originalClearTimeout
  global.Page = originalPage
  global.wx = originalWx
}

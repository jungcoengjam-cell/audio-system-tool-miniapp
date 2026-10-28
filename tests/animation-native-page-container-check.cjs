'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { amplifiers } = require('../data/equipment')

const previousPage = global.Page
const previousWx = global.wx
let definition
const navigationCalls = []
const storage = new Map()

global.Page = (value) => { definition = value }
global.wx = {
  navigateTo(options) { navigationCalls.push(options) },
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  hideLoading() {},
}

require('../pages/gain-structure/gain-structure')
const gainDefinition = definition
require('../pages/limiter/limiter')
const limiterDefinition = definition

function makePage(pageDefinition, data = {}) {
  const page = {
    data: { ...pageDefinition.data, ...data },
    setData(changes, callback) {
      Object.assign(this.data, changes)
      callback?.()
    },
    pauseReminderClock() {},
    resumeReminderClock() {},
    resetProjectKeyboardState() { return {} },
  }
  const methods = [
    'cancelPageContainerFallbackClose', 'clearPageContainerOverlay',
    'closePageContainerOverlay', 'onPageContainerBeforeLeave', 'onPageContainerAfterLeave',
    'openPageContainerOverlay', 'closeAmplifierSelector', 'selectAmplifier', 'openAmplifierDetail',
    'closeSharePreview', 'finishResultReportGeneration', 'commitCalculatedState', 'closeProjectSheet', 'invalidateProjectSave',
    'preparePageContainerLeave', 'cancelPendingImageWork', 'cancelOverlayRequests',
    'finishFallbackPageContainerLeave', 'closeEquipmentSelector', 'commitInput', 'selectEquipment', 'openEquipmentDetail',
    'closeDetails', 'onHide', 'canRunReminderClock',
  ]
  methods.forEach((name) => {
    if (typeof pageDefinition[name] === 'function') page[name] = pageDefinition[name]
  })
  return page
}

function initializeGainOverlay(page, name, epoch = 1, fields = {}) {
  Object.assign(page.data, {
    pageContainerSupported: true,
    pageContainerClosingOverlay: '',
    ...fields,
  })
  Object.assign(page, {
    _isUnloaded: false,
    _pageVisible: true,
    _pageContainerEpoch: epoch,
    _pageContainerFallbackCloseRevision: 0,
    _pageContainerFallbackCloseTimer: null,
    _activePageContainerOverlay: { name, epoch },
    _pageContainerLeave: null,
    _pendingPageContainerClose: null,
    _selectorMatches: [],
    _projectRequestId: 0,
    _projectSavePending: false,
    _projectSnapshotForSave: null,
    syncFavorite() {},
  })
}

function initializeLimiterOverlay(page, name, epoch = 1, fields = {}) {
  Object.assign(page.data, {
    pageContainerSupported: true,
    pageContainerClosingOverlay: '',
    ...fields,
  })
  Object.assign(page, {
    _isUnloaded: false,
    _pageVisible: false,
    _pageContainerEpoch: epoch,
    _pageContainerFallbackCloseRevision: 0,
    _pageContainerFallbackCloseTimer: null,
    _pendingPageContainerFallbackClose: null,
    _pendingPageContainerClose: null,
    _activePageContainerOverlay: { name, epoch },
    _pageContainerLeave: null,
    _projectRequestId: 0,
    _projectSavePending: false,
    _projectSnapshotForSave: null,
    _reportCacheCheckRevision: 0,
    _selectorMatches: [],
  })
}

function assertNativeWxmlRetainsPanelContent() {
  const root = path.resolve(__dirname, '..')
  const gainWxml = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.wxml'), 'utf8')
  const limiterWxml = fs.readFileSync(path.join(root, 'pages/limiter/limiter.wxml'), 'utf8')
  const gainPanels = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-overlays.wxml'), 'utf8')
  const limiterPanels = fs.readFileSync(path.join(root, 'pages/limiter/limiter-overlays.wxml'), 'utf8')
  assert.match(gainWxml, /<page-container\s+show="\{\{pageContainerSupported && !pageContainerClosingOverlay/)
  assert.match(limiterWxml, /show="\{\{pageContainerSupported && !pageContainerClosingOverlay/)
  assert.match(gainPanels, /wx:if="\{\{selectorVisible\}\}"/)
  assert.match(gainPanels, /wx:if="\{\{shareSheetVisible\}\}"/)
  assert.match(limiterPanels, /wx:if="\{\{selectorVisible\}\}"/)
  assert.match(limiterPanels, /wx:if="\{\{detailsVisible\}\}"/)
  assert.match(limiterPanels, /wx:if="\{\{shareSheetVisible\}\}"/)
  assert.match(limiterPanels, /wx:if="\{\{projectSheetVisible\}\}"/)
}

function checkGainNativeSelectionAndNavigation() {
  const page = makePage(gainDefinition, {
    amplifierIndex: 0,
    selectedAmplifier: amplifiers[0],
    stageIndex: 0,
    modeIndex: 0,
    loadIndex: 0,
    targetPeakIndex: 1,
    selectorVisible: true,
    selectorItems: [{ index: 1 }],
    selectorTotalCount: 1,
  })
  initializeGainOverlay(page, 'selector', 4)
  let clearCount = 0
  const originalClear = page.clearPageContainerOverlay
  page.clearPageContainerOverlay = function (...args) {
    clearCount += 1
    return originalClear.apply(this, args)
  }

  page.selectAmplifier({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.amplifierIndex, 1, 'the selected amplifier is committed immediately')
  assert.equal(page.data.selectorVisible, true, 'native selection keeps the selector content mounted for exit')
  assert.equal(page.data.selectorItems.length, 1, 'native selection keeps selector items through afterleave')
  assert.equal(page.data.pageContainerClosingOverlay, 'selector', 'selection starts the native leave transition')
  assert.equal(page._pendingPageContainerClose?.epoch, 4, 'selection retains a pending close for this epoch')
  assert.equal(clearCount, 0, 'input recalculation does not clear the native leave epoch')

  page.onPageContainerAfterLeave()
  assert.equal(page.data.selectorVisible, false, 'native selection hides the selector after afterleave')
  assert.equal(page.data.selectorItems.length, 0, 'selector data clears after the native exit')
  assert.equal(page.data.pageContainerClosingOverlay, '', 'the closing marker clears after native exit')
  assert.equal(page._activePageContainerOverlay, null, 'the closed native overlay releases its epoch')
  assert.doesNotThrow(() => page.closePageContainerOverlay('selector', { selectorVisible: false }))
  assert.doesNotThrow(() => page.commitCalculatedState({ targetPeakIndex: 0 }, 'idle-native-input'))

  page.openPageContainerOverlay('selector')
  page.setData({ selectorVisible: true, selectorItems: [{ index: 1 }], selectorTotalCount: 1 })
  assert.equal(page.data.pageContainerClosingOverlay, '', 'reopening clears the prior closing marker')
  page.openAmplifierDetail({ currentTarget: { dataset: { model: 'Example Amplifier' } } })
  assert.equal(navigationCalls.length, 0, 'native detail navigation waits for the overlay exit')
  assert.equal(page.data.selectorVisible, true, 'detail navigation leaves selector content mounted during exit')
  page.onPageContainerAfterLeave()
  assert.equal(navigationCalls.length, 1, 'detail navigation runs after native afterleave')

  page.openPageContainerOverlay('selector')
  page.setData({ selectorVisible: true, selectorItems: [{ index: 2 }], selectorTotalCount: 1 })
  page.onPageContainerBeforeLeave()
  page.onPageContainerAfterLeave()
  assert.equal(page.data.selectorVisible, false, 'native back without an app close request completes afterleave cleanup')
  assert.equal(page.data.selectorItems.length, 0, 'native back clears selector data only after leaving')
}

function checkGainShareAndProjectClose() {
  const sharePage = makePage(gainDefinition, {
    shareSheetVisible: true,
    isGeneratingResultReport: true,
    isCheckingResultReportCache: true,
    resultReportImagePath: 'wxfile://gain-share.png',
    resultReportPreviewVisible: true,
  })
  initializeGainOverlay(sharePage, 'share', 8)
  sharePage.resultReportRevision = 11
  sharePage.closeSharePreview()
  assert.equal(sharePage.data.shareSheetVisible, true, 'gain share content stays visible during native close')
  assert.equal(sharePage.data.isGeneratingResultReport, true, 'gain keeps the generating branch stable during native exit')
  assert.equal(sharePage.data.isCheckingResultReportCache, true, 'gain keeps the cache-check branch stable during native exit')
  assert.equal(sharePage.data.resultReportImagePath, 'wxfile://gain-share.png', 'gain share content data stays until afterleave')
  sharePage.finishResultReportGeneration(11, { resultReportImagePath: 'wxfile://stale-gain-share.png' })
  assert.equal(sharePage.data.isGeneratingResultReport, true, 'a stale image completion cannot change the exit-state branch')
  assert.equal(sharePage.data.resultReportImagePath, 'wxfile://gain-share.png', 'a stale image completion cannot replace retained content')
  assert.equal(sharePage.data.pageContainerClosingOverlay, 'share')
  sharePage.onPageContainerAfterLeave()
  assert.equal(sharePage.data.shareSheetVisible, false, 'gain share hides after native exit')
  assert.equal(sharePage.data.isGeneratingResultReport, false, 'gain clears the generating branch after native exit')
  assert.equal(sharePage.data.isCheckingResultReportCache, false, 'gain clears the cache-check branch after native exit')
  assert.equal(sharePage.data.resultReportImagePath, 'wxfile://gain-share.png', 'closing preview preserves its generated image path')

  const projectPage = makePage(gainDefinition, { projectSheetVisible: true, projectItems: [{ id: 'p1' }] })
  initializeGainOverlay(projectPage, 'project', 9)
  projectPage.closeProjectSheet()
  assert.equal(projectPage.data.projectSheetVisible, true, 'gain save panel remains mounted during exit')
  assert.deepEqual(projectPage.data.projectItems, [{ id: 'p1' }], 'gain project content remains through afterleave')
  projectPage.onPageContainerAfterLeave()
  assert.equal(projectPage.data.projectSheetVisible, false, 'gain save panel hides after native exit')
}

function checkLimiterNativeSelectionAndBack() {
  const page = makePage(limiterDefinition, {
    selectorVisible: true,
    selectorType: 'amplifier',
    selectorItems: [{ index: 0 }],
    selectorTotalCount: 1,
  })
  initializeLimiterOverlay(page, 'selector', 2)
  page.selectEquipment({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.amplifierIndex, 0, 'limiter commits the selected equipment')
  assert.equal(page.data.selectorVisible, true, 'limiter selection keeps native selector content mounted')
  assert.equal(page.data.selectorItems.length, 1, 'limiter retains selector items through afterleave')
  assert.equal(page.data.pageContainerClosingOverlay, 'selector')
  assert.equal(page._pendingPageContainerClose?.epoch, 2)
  page.onPageContainerAfterLeave()
  assert.equal(page.data.selectorVisible, false, 'limiter selector hides after native exit')
  assert.equal(page.data.selectorItems.length, 0, 'limiter selector items clear after native exit')
  assert.doesNotThrow(() => page.closePageContainerOverlay('selector', { selectorVisible: false }))

  const idlePage = makePage(limiterDefinition, { pageContainerSupported: true })
  Object.assign(idlePage, {
    _isUnloaded: false,
    _pendingPageContainerClose: null,
    _activePageContainerOverlay: null,
    _pageContainerLeave: null,
  })
  assert.doesNotThrow(() => idlePage.closePageContainerOverlay('selector', { selectorVisible: false }))

  const backPage = makePage(limiterDefinition, { detailsVisible: true })
  initializeLimiterOverlay(backPage, 'details', 3)
  backPage.onPageContainerBeforeLeave()
  backPage.onPageContainerAfterLeave()
  assert.equal(backPage.data.detailsVisible, false, 'native system back removes details after afterleave')
  assert.equal(backPage.data.pageContainerClosingOverlay, '')
  assert.equal(backPage._activePageContainerOverlay, null)
}

function checkLimiterShareAndProjectClose() {
  const sharePage = makePage(limiterDefinition, {
    shareSheetVisible: true,
    isGeneratingResultReport: true,
    resultReportImagePath: 'wxfile://limiter-share.png',
    resultReportPreviewVisible: true,
  })
  initializeLimiterOverlay(sharePage, 'share', 5)
  sharePage.resultReportRevision = 14
  sharePage.closeSharePreview()
  assert.equal(sharePage.data.shareSheetVisible, true, 'limiter share content stays mounted during native close')
  assert.equal(sharePage.data.isGeneratingResultReport, true, 'limiter keeps its generating branch stable during native exit')
  assert.equal(sharePage.data.resultReportImagePath, 'wxfile://limiter-share.png', 'generated or cached image data survives until afterleave')
  sharePage.finishResultReportGeneration(14, { resultReportImagePath: 'wxfile://stale-limiter-share.png' })
  assert.equal(sharePage.data.isGeneratingResultReport, true, 'a stale limiter image completion cannot switch the exit-state branch')
  assert.equal(sharePage.data.resultReportImagePath, 'wxfile://limiter-share.png', 'a stale limiter image completion cannot replace retained content')
  assert.equal(sharePage.data.pageContainerClosingOverlay, 'share')
  sharePage.onPageContainerAfterLeave()
  assert.equal(sharePage.data.shareSheetVisible, false, 'limiter share hides only after native exit')
  assert.equal(sharePage.data.isGeneratingResultReport, false, 'limiter clears the generating branch after native exit')
  assert.equal(sharePage.data.resultReportImagePath, 'wxfile://limiter-share.png', 'limiter keeps the image path while the panel leaves')

  const projectPage = makePage(limiterDefinition, { projectSheetVisible: true, projectItems: [{ id: 'p2' }] })
  initializeLimiterOverlay(projectPage, 'project', 6)
  projectPage.closeProjectSheet()
  assert.equal(projectPage.data.projectSheetVisible, true, 'limiter save panel remains mounted during exit')
  assert.deepEqual(projectPage.data.projectItems, [{ id: 'p2' }], 'limiter project data remains through afterleave')
  projectPage.onPageContainerAfterLeave()
  assert.equal(projectPage.data.projectSheetVisible, false, 'limiter save panel hides after native exit')
}

function run() {
  assertNativeWxmlRetainsPanelContent()
  checkGainNativeSelectionAndNavigation()
  checkGainShareAndProjectClose()
  checkLimiterNativeSelectionAndBack()
  checkLimiterShareAndProjectClose()
  console.log('Native page-container lifecycle check passed (gain/limiter selection, share, project, back, afterleave, and deferred detail navigation).')
}

try {
  run()
} finally {
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

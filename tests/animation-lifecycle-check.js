'use strict'

const assert = require('assert')
const { amplifiers } = require('../data/equipment')

const previousPage = global.Page
const previousWx = global.wx
let definition
const pageDefinitions = {}
const navigationCalls = []

global.Page = (value) => { definition = value }
global.wx = {
  navigateTo(options) { navigationCalls.push(options) },
  getStorageSync() { return null },
  setStorageSync() {},
}
require('../pages/products/detail')
pageDefinitions.productDetail = definition
require('../pages/gain-structure/gain-structure')
pageDefinitions.gainStructure = definition
require('../pages/limiter/limiter')
pageDefinitions.limiter = definition

function makePage(pageDefinition = pageDefinitions.productDetail, data = {}) {
  const page = {
    data: { ...pageDefinition.data, dmxImportVisible: true, ...data },
    _dmxImportPageVisible: true,
    _dmxImportUnloaded: false,
    _dmxImportCloseRevision: 0,
    _dmxImportCloseTimer: null,
    _dmxImportNavigatePending: false,
    _dmxImportSubmitting: false,
    _dmxImportOpenedSignature: 'test-signature',
    setData(changes, callback) {
      Object.assign(this.data, changes)
      callback?.()
    },
  }
  ;[
    'cancelDmxProductImportClose',
    'closeDmxProductImport',
    'navigateToPendingDmxImport',
    'onHide',
    'onShow',
    'onUnload',
    'openDmxProductImport',
  ].forEach((name) => { if (pageDefinition[name]) page[name] = pageDefinition[name] })
  return page
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  const hiddenPage = makePage()
  hiddenPage._dmxImportNavigatePending = true
  hiddenPage.closeDmxProductImport({
    force: true,
    afterClose: () => hiddenPage.navigateToPendingDmxImport(),
  })
  hiddenPage.onHide()
  assert.strictEqual(hiddenPage.data.dmxImportVisible, false, 'hide immediately removes the import overlay')
  assert.strictEqual(hiddenPage._dmxImportNavigatePending, true, 'hide preserves the confirmed navigation intent')
  hiddenPage.onShow()
  assert.strictEqual(navigationCalls.length, 1, 'resume navigates once after a hide during close')
  assert.strictEqual(hiddenPage._dmxImportNavigatePending, false, 'navigation consumes the pending intent')
  await wait(220)
  hiddenPage.onHide()
  hiddenPage.onShow()
  assert.strictEqual(navigationCalls.length, 1, 'returning from the target page does not navigate twice')

  const unloadedPage = makePage()
  unloadedPage._dmxImportNavigatePending = true
  unloadedPage.closeDmxProductImport({
    force: true,
    afterClose: () => unloadedPage.navigateToPendingDmxImport(),
  })
  unloadedPage.onUnload()
  await wait(220)
  assert.strictEqual(navigationCalls.length, 1, 'unload cancels the page timer without a late navigation')

  const reopenedPage = makePage()
  reopenedPage._dmxImportNavigatePending = true
  assert.strictEqual(reopenedPage.openDmxProductImport({ type: 'lighting', channelModes: [8] }), false,
    'the import overlay cannot reopen while a confirmed navigation is pending')

  const gainDefinition = pageDefinitions.gainStructure
  let clearedGainOverlay = false
  const gainPage = makePage(gainDefinition, {
    amplifierIndex: 0,
    selectedAmplifier: amplifiers[0],
    stageIndex: 0,
    modeIndex: 0,
    loadIndex: 0,
    selectorVisible: true,
    selectorItems: [{ index: 0 }],
    selectorTotalCount: 1,
    pageContainerSupported: false,
  })
  Object.assign(gainPage, {
    _isUnloaded: false,
    _pageVisible: true,
    _pageContainerEpoch: 1,
    _pageContainerFallbackCloseRevision: 0,
    _pageContainerFallbackCloseTimer: null,
    _activePageContainerOverlay: { name: 'selector', epoch: 1 },
    _pageContainerLeave: null,
    _inputRevision: 0,
    clearPageContainerOverlay(name) {
      clearedGainOverlay = true
      return gainDefinition.clearPageContainerOverlay.call(this, name)
    },
    syncFavorite() {},
  })
  ;[
    'cancelPageContainerFallbackClose',
    'closePageContainerOverlay',
    'onPageContainerBeforeLeave',
    'commitCalculatedState',
  ].forEach((name) => { gainPage[name] = gainDefinition[name] })
  gainPage.closePageContainerOverlay('selector', { selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
  assert.strictEqual(gainPage.data.selectorVisible, true, 'gain selector remains mounted while it exits')
  gainPage.commitCalculatedState({ amplifierIndex: 1, selectedAmplifier: amplifiers[1] }, 'amplifier')
  assert.strictEqual(clearedGainOverlay, false, 'calculation keeps the pending fallback-close epoch valid')
  await wait(220)
  assert.strictEqual(gainPage.data.selectorVisible, false, 'gain selector closes after its exit duration')
  assert.strictEqual(gainPage.data.pageContainerFallbackClosing, false, 'gain fallback close state is cleared')

  const limiterDefinition = pageDefinitions.limiter
  const limiterPage = makePage(limiterDefinition, {
    selectorVisible: true,
    selectorItems: [{ index: 0 }],
    selectorTotalCount: 1,
    pageContainerSupported: false,
  })
  Object.assign(limiterPage, {
    _isUnloaded: false,
    _pageVisible: true,
    _pageContainerEpoch: 1,
    _pageContainerFallbackCloseRevision: 0,
    _pageContainerFallbackCloseTimer: null,
    _pendingPageContainerFallbackClose: null,
    _activePageContainerOverlay: { name: 'selector', epoch: 1 },
    _pageContainerLeave: null,
    _projectRequestId: 0,
    _projectSavePending: false,
    resetProjectKeyboardState() {},
    pauseReminderClock() {},
    cancelPendingImageWork() {},
  })
  ;[
    'cancelPageContainerFallbackClose',
    'closePageContainerOverlay',
    'finishFallbackPageContainerLeave',
    'onHide',
    'preparePageContainerLeave',
  ].forEach((name) => { limiterPage[name] = limiterDefinition[name] })
  limiterPage.closePageContainerOverlay('selector', { selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
  assert.strictEqual(limiterPage.data.selectorVisible, true, 'limiter selector remains mounted while it exits')
  limiterPage.onHide()
  assert.strictEqual(limiterPage.data.selectorVisible, false, 'hide completes a pending limiter close immediately')
  assert.strictEqual(limiterPage.data.pageContainerFallbackClosing, false, 'hide clears the limiter closing state')
  await wait(220)
  assert.strictEqual(limiterPage.data.selectorVisible, false, 'the cancelled limiter timer cannot restore stale UI')

  console.log('Animation lifecycle check passed (product navigation and gain/limiter fallback close races).')
}

run().finally(() => {
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
})

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')

const originalPage = global.Page
const originalWx = global.wx
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout
const originalLoad = Module._load
const storage = new Map()
const storageWrites = []
const toasts = []
const timers = new Map()
let nextTimerId = 1
let page
let setDataCalls = 0

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const timerSet = (callback, delay, ...args) => {
  const id = nextTimerId++
  timers.set(id, { callback, delay, args })
  return id
}
const timerClear = (id) => timers.delete(id)
global.setTimeout = timerSet
global.clearTimeout = timerClear
global.wx = {
  getStorageSync(key) { return clone(storage.get(key)) },
  setStorageSync(key, value) { storageWrites.push(String(key)); storage.set(key, clone(value)) },
  removeStorageSync(key) { storage.delete(key) },
  getStorageInfoSync() { return { keys: [...storage.keys()], currentSize: 0, limitSize: 10240 } },
  getSystemInfoSync() { return { windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 } },
  getWindowInfo() { return { windowWidth: 390, windowHeight: 844, pixelRatio: 3 } },
  setNavigationBarTitle() {},
  showToast(options = {}) { toasts.push(options.title || '') },
  showLoading() {},
  hideLoading() {},
  vibrateShort() {},
  vibrateLong() {},
  disableAlertBeforeUnload() {},
}
global.Page = (definition) => {
  page = definition
  page.data = clone(definition.data)
  page.setData = (changes, callback) => {
    setDataCalls += 1
    for (const [key, value] of Object.entries(changes || {})) {
      const path = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (const part of path.slice(0, -1)) {
        if (!target[part] || typeof target[part] !== 'object') target[part] = /^\d+$/.test(part) ? [] : {}
        target = target[part]
      }
      target[path[path.length - 1]] = value
    }
    if (typeof callback === 'function') callback.call(page)
  }
}
function loadFresh(relativePath) {
  const resolved = require.resolve(relativePath)
  delete require.cache[resolved]
  return require(resolved)
}
function runTimerWithDelay(delay) {
  const entry = [...timers.entries()].find(([, value]) => value.delay === delay)
  assert(entry, 'missing controlled timer with delay ' + delay)
  timers.delete(entry[0])
  entry[1].callback(...entry[1].args)
  return entry[1].callback
}
function closeGuideThroughBoundHandler() {
  page.onUserCloseFixtureChannelGuide()
  assert.equal(page.data.fixtureChannelGuideClosing, true)
  runTimerWithDelay(180)
  assert.equal(page.data.fixtureChannelGuide, null)
}
function openGuideThroughWxmlBoundHandler() {
  const fixture = page._calculationResult.fixtures[0]
  assert(fixture && Number.isInteger(fixture.globalIndex))
  page.openFixtureChannelGuide({ currentTarget: { dataset: { globalIndex: fixture.globalIndex } } })
  return fixture
}
function assertGuideMatchesProfile(guide, channelGuideApi, model, channelCount) {
  const expectedMode = channelGuideApi.getDmxChannelMode(model, channelCount)
  assert(expectedMode, `${model} ${channelCount} CH profile mode is missing`)
  const actualMetadata = guide.channels.map(({ channel, name, summary, ranges }) => ({
    channel, name, summary, ranges,
  }))
  assert.deepEqual(actualMetadata, expectedMode.channels,
    `${model} ${channelCount} CH channel order or metadata is stale`)
  assert.equal(guide.channels[0].actualAddress, 'A001', `${model} ${channelCount} CH first address changed`)
  assert.equal(guide.channels.at(-1).actualAddress,
    `A${String(channelCount).padStart(3, '0')}`, `${model} ${channelCount} CH last address changed`)
}

let profileDataModuleInitializations = 0
let guideModuleInitializations = 0
let guideBuildCalls = 0
let profilePartInitializations = 0

try {
  const workspace = loadFresh('../pages/dmx-layout/lighting-workspace')
  const initialWorkspace = workspace.readLightingWorkspace('temporary')
  assert.equal(initialWorkspace.ok, true, 'synthetic workspace did not initialize')
  const seedScheme = workspace.createLightingScheme({
    startAddressText: '1',
    allocationMode: 'auto',
    groups: [{
      name: 'TL-SV3103',
      fixtureSource: 'library',
      fixtureModel: 'TL-SV3103',
      libraryChannelCount: '14',
      channelCount: '14',
      fixtureCount: '1',
      targetUniverse: 'A',
    }],
  })
  const saved = workspace.saveLightingScheme('temporary', seedScheme, initialWorkspace.revision)
  assert.equal(saved.ok, true, 'could not persist synthetic TL-SV3103 / 14 CH workspace')
  assert.equal(workspace.readLightingWorkspace('temporary').scheme.preferences.groups[0].channelCount, '14')
  storageWrites.length = 0

  const pageModule = require.resolve('../pages/dmx-address/dmx-address')
  const resultViewModule = require.resolve('../pages/dmx-address/result-view')
  const guideModule = require.resolve('../pages/dmx-address/utils/dmx-channel-guide')
  const profileModule = require.resolve('../pages/dmx-address/data/stage-lighting-channels')
  const profilePartPaths = [
    '../pages/dmx-address/data/stage-lighting-channels-extra',
    '../pages/dmx-address/data/stage-lighting-channels-final-a',
    '../pages/dmx-address/data/stage-lighting-channels-final-b',
  ].map((file) => require.resolve(file))
  ;[pageModule, resultViewModule, guideModule, profileModule, ...profilePartPaths].forEach((file) => delete require.cache[file])

  const profilePartSet = new Set(profilePartPaths)
  Module._load = function countedLoad(request, parent, isMain) {
    let resolved = ''
    try { resolved = Module._resolveFilename(request, parent, isMain) } catch (_) {}
    const isUncached = Boolean(resolved && !Module._cache[resolved])
    if (isUncached && resolved === profileModule) profileDataModuleInitializations += 1
    if (isUncached && profilePartSet.has(resolved)) profilePartInitializations += 1
    if (isUncached && resolved === guideModule) guideModuleInitializations += 1
    const loaded = originalLoad.apply(this, arguments)
    if (resolved === guideModule && loaded && typeof loaded.buildActualDmxChannelGuide === 'function' && !loaded.__lazyLoadProbeWrapped) {
      const originalBuild = loaded.buildActualDmxChannelGuide
      loaded.buildActualDmxChannelGuide = function countedGuideBuild(...args) {
        guideBuildCalls += 1
        return originalBuild.apply(this, args)
      }
      Object.defineProperty(loaded, '__lazyLoadProbeWrapped', { value: true })
    }
    return loaded
  }

  require(pageModule)
  assert(page && typeof page.onLoad === 'function', 'the real DMX page definition was not composed')
  const dmxWxml = fs.readFileSync(require.resolve('../pages/dmx-address/dmx-address.wxml'), 'utf8')
  assert(dmxWxml.includes('catchlongpress="openFixtureChannelGuide"'),
    'test handler is no longer the real WXML guide-opening route')

  page.onLoad({})
  assert.equal(page._contextId, 'temporary')
  assert.equal(page._calculationResult.valid, true)
  assert.equal(page.data.groups[0].fixtureModel, 'TL-SV3103')
  assert.equal(page.data.groups[0].channelCount, '14')
  assert.equal(profileDataModuleInitializations, 0, 'onLoad eagerly initialized the full profile data module')
  assert.equal(profilePartInitializations, 0, 'onLoad eagerly initialized a profile data partition')
  assert.equal(guideModuleInitializations, 0, 'onLoad eagerly initialized the channel-guide module')
  assert.equal(guideBuildCalls, 0)

  page.onShow()
  assert.equal(page._calculationResult.valid, true)
  assert.equal(profileDataModuleInitializations, 0, 'onShow eagerly initialized the full profile data module')
  assert.equal(profilePartInitializations, 0, 'onShow eagerly initialized a profile data partition')
  assert.equal(guideModuleInitializations, 0, 'onShow eagerly initialized the channel-guide module')
  assert.equal(guideBuildCalls, 0)
  assert.equal(page.data.groupCards[0].fixtureChips[0].channelGuideAvailable, true,
    'lightweight availability metadata did not expose the selected fixture guide')

  const initialQueryCount = guideBuildCalls
  const firstFixture = openGuideThroughWxmlBoundHandler()
  assert.equal(page.data.fixtureChannelGuide.model, 'TL-SV3103')
  assert.equal(page.data.fixtureChannelGuide.channelCount, 14)
  assert.equal(page.data.fixtureChannelGuide.channels.length, 14)
  assert.equal(page.data.fixtureChannelGuide.channels[0].channel, 1)
  const channelGuideApi = require('../pages/dmx-address/utils/dmx-channel-guide')
  assertGuideMatchesProfile(page.data.fixtureChannelGuide, channelGuideApi, 'TL-SV3103', 14)
  assert.equal(guideModuleInitializations, 1, 'first guide open did not initialize its lazy module exactly once')
  assert.equal(profileDataModuleInitializations, 1, 'first guide open did not initialize profile data exactly once')
  assert.equal(profilePartInitializations, profilePartPaths.length,
    'first guide open did not initialize each profile data partition exactly once')
  assert.equal(guideBuildCalls, initialQueryCount + 1, 'first guide open did not build the selected profile once')
  closeGuideThroughBoundHandler()

  openGuideThroughWxmlBoundHandler()
  assert.equal(page.data.fixtureChannelGuide.model, 'TL-SV3103')
  assert.equal(page.data.fixtureChannelGuide.channels.length, 14)
  assertGuideMatchesProfile(page.data.fixtureChannelGuide, channelGuideApi, 'TL-SV3103', 14)
  assert.equal(guideModuleInitializations, 1, 'reopening reinitialized the guide module')
  assert.equal(profileDataModuleInitializations, 1, 'reopening reloaded the full profile data module')
  assert.equal(profilePartInitializations, profilePartPaths.length, 'reopening reinitialized profile data partitions')
  assert.equal(guideBuildCalls, initialQueryCount + 2, 'reopening should resolve current profile data through the cached module')
  closeGuideThroughBoundHandler()

  page.onCardModeChange({
    currentTarget: { dataset: { index: '0' } },
    detail: { value: '1' },
  })
  assert.equal(page.data.pendingChange.kind, 'edit')
  assert.equal(page.data.pendingChange.channelCount, 16)
  page.confirmPendingChange()
  assert.equal(page.data.groups[0].channelCount, '16')
  assert.equal(page._calculationResult.fixtures[0].channelCount, 16)
  openGuideThroughWxmlBoundHandler()
  assert.equal(page.data.fixtureChannelGuide.model, 'TL-SV3103')
  assert.equal(page.data.fixtureChannelGuide.channelCount, 16)
  assert.equal(page.data.fixtureChannelGuide.channels.length, 16,
    'mode change reused stale 14-channel content')
  assertGuideMatchesProfile(page.data.fixtureChannelGuide, channelGuideApi, 'TL-SV3103', 16)
  assert.equal(profileDataModuleInitializations, 1)
  assert.equal(profilePartInitializations, profilePartPaths.length)
  closeGuideThroughBoundHandler()

  page.openModelPicker({ currentTarget: { dataset: { index: '0' } } })
  assert.equal(page.data.fixtureSearchOpen, true)
  page.selectFixture({ currentTarget: { dataset: { model: 'TL-SV3104' } } })
  assert.equal(page.data.pendingChange.fixtureModel, 'TL-SV3104')
  page.confirmPendingChange()
  assert.equal(page.data.groups[0].fixtureModel, 'TL-SV3104')
  const changedModeCount = Number(page.data.groups[0].channelCount)
  openGuideThroughWxmlBoundHandler()
  assert.equal(page.data.fixtureChannelGuide.model, 'TL-SV3104',
    'fixture change reused the previous model guide')
  assert.equal(page.data.fixtureChannelGuide.channelCount, changedModeCount)
  assert.equal(page.data.fixtureChannelGuide.channels.length, changedModeCount)
  assertGuideMatchesProfile(page.data.fixtureChannelGuide, channelGuideApi, 'TL-SV3104', changedModeCount)
  assert.equal(profileDataModuleInitializations, 1)
  assert.equal(profilePartInitializations, profilePartPaths.length)
  closeGuideThroughBoundHandler()

  page.switchFixtureSource({ currentTarget: { dataset: { index: '0', source: 'custom' } } })
  assert.equal(page.data.groups[0].fixtureSource, 'custom')
  const unavailableFixture = page._calculationResult.fixtures[0]
  const toastCount = toasts.length
  page.openFixtureChannelGuide({ currentTarget: { dataset: { globalIndex: unavailableFixture.globalIndex } } })
  assert.equal(page.data.fixtureChannelGuide, null)
  assert.equal(toasts.length, toastCount + 1)
  assert.equal(toasts.at(-1), '该型号暂无已核对的通道资料')
  assert.equal(profileDataModuleInitializations, 1)

  page.switchFixtureSource({ currentTarget: { dataset: { index: '0', source: 'library' } } })
  assert.equal(page.data.groups[0].fixtureSource, 'library')
  openGuideThroughWxmlBoundHandler()
  assert.equal(page.data.fixtureChannelGuide.model, 'TL-SV3104')
  page.onUserCloseFixtureChannelGuide()
  const pendingClose = [...timers.entries()].find(([, timer]) => timer.delay === 180)
  assert(pendingClose, 'guide close did not schedule its existing bounded timer')
  const lateCloseCallback = pendingClose[1].callback
  page.onUnload()
  assert.equal(page._pageAlive, false)
  const setDataAfterUnload = setDataCalls
  lateCloseCallback()
  assert.equal(setDataCalls, setDataAfterUnload, 'disposed page accepted a late guide-close timer write')

  console.log('PASS DMX channel-guide lazy behavior ' + JSON.stringify({
    onLoadProfileModuleInitializations: 0,
    onShowProfileModuleInitializations: 0,
    firstOpenProfileModuleInitializations: 1,
    guideModuleInitializations: guideModuleInitializations,
    profilePartInitializations: profilePartInitializations,
    guideBuildCalls: guideBuildCalls,
    tlSv3103InitialChannels: firstFixture.channelCount,
    afterModeChangeChannels: 16,
    afterFixtureChangeModel: 'TL-SV3104',
    missingProfileHandled: true,
    disposedCloseCallbackWrites: 0,
  }))
} finally {
  Module._load = originalLoad
  timers.clear()
  global.Page = originalPage
  global.wx = originalWx
  global.setTimeout = originalSetTimeout
  global.clearTimeout = originalClearTimeout
}

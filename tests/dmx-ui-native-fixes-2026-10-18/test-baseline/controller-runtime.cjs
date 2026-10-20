// Only WeChat platform boundaries are mocked. Pages, storage migration and DMX
// calculations below are the actual production modules, shared by regression cases.
const assert = require('node:assert/strict')
const path = require('node:path')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const root = path.resolve(__dirname, '../..')
const workspace = require('../../pages/dmx-layout/lighting-workspace')
const model = require('../../pages/dmx-layout/layout-model')
const { stageLightingProductIndex } = require('../../data/stage-lighting')

function createRuntime(options = {}) {
  const storage = new Map(), pages = [], selectors = [], ticks = [], draws = [], exports = [], modals = [], navigation = [], toasts = []
  const stats = { writes: 0, draw: 0, loading: 0, hideLoading: 0, clipboard: [], favorites: [], selectors: [], alertEnabled: false }
  const state = { deferSelectors: Boolean(options.deferSelectors), deferTicks: Boolean(options.deferTicks), deferDraws: Boolean(options.deferDraws), deferExports: Boolean(options.deferExports), failNavigation: false, failWrites: false, failWriteKeys: [], selectorRects: {} }
  const rect = { left: 10, top: 130, width: 370, height: 620 }
  let definition
  const context = () => new Proxy({
    measureText: text => ({ width: String(text).length * 12 }),
    draw(_reserve, callback) { stats.draw++; if (callback) { if (state.deferDraws) draws.push(callback); else callback() } },
  }, { get: (target, key) => key in target ? target[key] : (() => {}) })
  global.wx = {
    getStorageSync: key => clone(storage.get(key)),
    setStorageSync(key, value) { if (state.failWrites || state.failWriteKeys.includes(key)) throw new Error('mock storage unavailable'); stats.writes++; storage.set(key, clone(value)) },
    removeStorageSync(key) { if (state.failWrites || state.failWriteKeys.includes(key)) throw new Error('mock storage unavailable'); stats.writes++; storage.delete(key) },
    getSystemInfoSync: () => ({ theme: 'light', windowWidth: 390, windowHeight: 844, statusBarHeight: 24, pixelRatio: 2 }),
    getAppBaseInfo: () => ({ theme: 'light' }),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 293, right: 380, top: 28, bottom: 60, width: 87, height: 32 }),
    onThemeChange() {}, offThemeChange() {}, onWindowResize() {}, offWindowResize() {}, setNavigationBarTitle() {}, setNavigationBarColor() {}, setBackgroundColor() {},
    showToast: value => toasts.push(clone(value)), showLoading: () => stats.loading++, hideLoading: () => stats.hideLoading++, vibrateShort() {},
    showModal: value => modals.push(value), showActionSheet: value => modals.push(value),
    nextTick(callback) { if (state.deferTicks) ticks.push(callback); else callback() },
    createCanvasContext: context,
    canvasToTempFilePath(value) { exports.push(value); if (!state.deferExports) value.success?.({ tempFilePath: 'qa-export-' + exports.length + '.png' }) },
    createSelectorQuery() {
      let selector, callback
      const query = {
        in: () => query,
        select(value) { selector = value; return query },
        boundingClientRect(value) { callback = value; return query },
        exec(done) {
          stats.selectors.push(selector)
          const run = (value = Object.hasOwn(state.selectorRects, selector) ? state.selectorRects[selector] : rect) => { callback?.(clone(value)); done?.([clone(value)]) }
          if (state.deferSelectors) selectors.push({ selector, run }); else run()
          return query
        },
      }
      return query
    },
    navigateTo: value => navigate('navigateTo', value),
    navigateBack: value => navigate('navigateBack', value),
    redirectTo: value => navigate('redirectTo', value),
    enableAlertBeforeUnload(value) { stats.alertEnabled = true; value?.success?.() }, disableAlertBeforeUnload(value) { stats.alertEnabled = false; value?.success?.() },
    setClipboardData(value) { stats.clipboard.push(value.data); value.success?.() },
  }
  function navigate(type, value) { navigation.push({ type, ...value }); if (state.failNavigation) value.fail?.({ errMsg: 'mock navigation failed' }); else value.success?.() }
  global.getApp = () => ({ globalData: { theme: 'light' } })
  global.getCurrentPages = () => pages.filter(page => page._qaActive)
  global.Page = value => { definition = value }

  function seed(groups, legacyLayout) {
    assert.equal(pages.length, 0, 'Use a fresh runtime for each isolated test')
    storage.clear()
    const product = stageLightingProductIndex.get('TL-SL323')
    storage.set('audioTool.dmxAddress.preferences', {
      startAddressText: '1', allocationMode: 'auto', groupSummary: '',
      groups: clone(groups || [{ name: product.name, fixtureSource: 'library', fixtureModel: product.model, channelCount: '2', libraryChannelCount: '2', fixtureCount: '4', targetUniverse: 'A' }]),
    })
    if (legacyLayout) storage.set('audioTool.dmxLayout.v1', clone(legacyLayout))
  }

  function make(kind = 'portrait', loadOptions = {}) {
    const relative = kind === 'main' ? 'pages/dmx-address/dmx-address.js' : kind === 'landscape' ? 'pages/dmx-layout-landscape/dmx-layout-landscape.js' : 'pages/dmx-layout/dmx-layout.js'
    const file = path.join(root, relative)
    definition = null; delete require.cache[require.resolve(file)]; require(file)
    assert(definition, 'Actual page did not register: ' + relative)
    const page = { ...definition, data: clone(definition.data), route: relative.slice(0, -3), _qaActive: true, _qaPatches: [] }
    page.setData = (patch, callback) => {
      page._qaPatches.push(clone(patch))
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = page.data
        for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {})
        target[parts.at(-1)] = clone(value)
      }
      callback?.()
    }
    pages.push(page); page.onLoad(loadOptions); page.onShow(); page.onReady?.()
    return page
  }
  function event(dataset = {}, detail = {}, extra = {}) { return { currentTarget: { dataset }, detail, ...extra } }
  function answer(confirm) { assert(modals.length, 'No actual modal was requested'); modals.shift().success?.({ confirm }) }
  function checkMain(main, fixture) { main.openFloatingCard(event({ index: fixture.groupIndex })); main.toggleFixtureCheck(event({ stableId: fixture.stableId })) }
  function place(page, index = 0, rodIndex = 0) { page.assignFixtureToRod(page._fixtures[index], page._layout.internalRods[rodIndex].id) }
  function drain(queue) { for (const item of queue.splice(0)) typeof item === 'function' ? item() : item.run() }
  function dispose() { for (const page of pages) { page.onUnload?.(); page._qaActive = false } }
  return { storage, pages, selectors, ticks, draws, exports, modals, navigation, toasts, stats, state, rect, seed, make, event, answer, checkMain, place, drain, dispose, workspace, model }
}
module.exports = { createRuntime, clone, workspace, model, stageLightingProductIndex }

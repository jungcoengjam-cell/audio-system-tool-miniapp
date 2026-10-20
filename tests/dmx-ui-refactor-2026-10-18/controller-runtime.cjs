// Only WeChat platform boundaries are mocked. Pages, storage migration and DMX
// calculations below are the actual production modules, shared by regression cases.
const assert = require('node:assert/strict')
const path = require('node:path')

function clone(value, seen = new Map()) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (value.__qaNativeCanvasNode || value.__qaNativeCanvasContext) return value
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const result = []
    seen.set(value, result)
    value.forEach((item) => result.push(clone(item, seen)))
    return result
  }
  const result = {}
  seen.set(value, result)
  Object.entries(value).forEach(([key, item]) => { result[key] = clone(item, seen) })
  return result
}

const root = path.resolve(__dirname, '../..')
const workspace = require('../../pages/dmx-layout/lighting-workspace')
const model = require('../../pages/dmx-layout/layout-model')
const { stageLightingProductIndex } = require('../../data/stage-lighting')

function createRuntime(options = {}) {
  const storage = new Map(), pages = [], selectors = [], ticks = [], frames = [], exports = [], modals = [], navigation = [], toasts = []
  const drawCalls = []
  const stats = { writes: 0, draw: 0, drawCalls, loading: 0, hideLoading: 0, clipboard: [], favorites: [], selectors: [], alertEnabled: false }
  const state = {
    deferSelectors: Boolean(options.deferSelectors),
    deferTicks: Boolean(options.deferTicks),
    deferExports: Boolean(options.deferExports),
    failNavigation: false,
    failWrites: false,
    failWriteKeys: [],
    selectorRects: { ...(options.selectorRects || {}) },
    selectorFields: { ...(options.selectorFields || {}) },
  }
  const rect = { left: 10, top: 130, width: 370, height: 620 }
  let definition

  function recordDraw(context, method, args) {
    const call = { method, args: clone(args), fillStyle: context.fillStyle, strokeStyle: context.strokeStyle, lineWidth: context.lineWidth, font: context.font, textAlign: context.textAlign, canvas: context.canvas.__qaCanvasName }
    drawCalls.push(call)
    stats.draw = drawCalls.length
    return call
  }

  function makeContext(canvas) {
    const context = {
      __qaNativeCanvasContext: true,
      canvas,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      lineDashOffset: 0,
      globalAlpha: 1,
      transform: [1, 0, 0, 1, 0, 0],
      lineDash: [],
      setTransform(...args) { this.transform = args.slice(); return this.transform },
      resetTransform() { this.transform = [1, 0, 0, 1, 0, 0] },
      setLineDash(values) { this.lineDash = Array.isArray(values) ? values.slice() : [] },
      measureText(text) {
        const match = String(this.font).match(/([\d.]+)px/)
        const fontSize = match ? Number(match[1]) : 10
        return { width: Array.from(String(text)).length * fontSize * 0.56, actualBoundingBoxAscent: fontSize * 0.8, actualBoundingBoxDescent: fontSize * 0.2 }
      },
      beginPath(...args) { return recordDraw(this, 'beginPath', args) },
      closePath(...args) { return recordDraw(this, 'closePath', args) },
      moveTo(...args) { return recordDraw(this, 'moveTo', args) },
      lineTo(...args) { return recordDraw(this, 'lineTo', args) },
      arc(...args) { return recordDraw(this, 'arc', args) },
      rect(...args) { return recordDraw(this, 'rect', args) },
      quadraticCurveTo(...args) { return recordDraw(this, 'quadraticCurveTo', args) },
      bezierCurveTo(...args) { return recordDraw(this, 'bezierCurveTo', args) },
      clip(...args) { return recordDraw(this, 'clip', args) },
      save(...args) { return recordDraw(this, 'save', args) },
      restore(...args) { return recordDraw(this, 'restore', args) },
      fill(...args) { return recordDraw(this, 'fill', args) },
      stroke(...args) { return recordDraw(this, 'stroke', args) },
      fillRect(...args) { return recordDraw(this, 'fillRect', args) },
      strokeRect(...args) { return recordDraw(this, 'strokeRect', args) },
      clearRect(...args) { return recordDraw(this, 'clearRect', args) },
      fillText(...args) { return recordDraw(this, 'fillText', args) },
      strokeText(...args) { return recordDraw(this, 'strokeText', args) },
    }
    return context
  }

  function makeCanvasNode(name, width = 370, height = 620) {
    const node = {
      __qaNativeCanvasNode: true,
      __qaCanvasName: name,
      width,
      height,
      _nextFrameId: 1,
      _frames: new Map(),
      frameHistory: new Map(),
      cancelledFrames: [],
      context: null,
      getContext(type) {
        assert.equal(type, '2d', 'The production page should request a 2D canvas context')
        return this.context
      },
      requestAnimationFrame(callback) {
        const id = this._nextFrameId++
        const frame = { id, node: this, callback, run: () => {
          if (!this._frames.has(id)) return false
          this._frames.delete(id)
          callback(Date.now())
          return true
        } }
        this._frames.set(id, frame)
        this.frameHistory.set(id, frame)
        frames.push(frame)
        return id
      },
      cancelAnimationFrame(id) {
        this.cancelledFrames.push(id)
        this._frames.delete(id)
      },
    }
    node.context = makeContext(node)
    return node
  }

  const mainCanvas = makeCanvasNode('main', rect.width, rect.height)
  const exportCanvas = makeCanvasNode('export', 1, 1)
  const knownCanvasNodes = { '#dmxLayoutCanvas': mainCanvas, '#dmxLayoutExportCanvas': exportCanvas }

  global.wx = {
    getStorageSync: key => clone(storage.get(key)),
    setStorageSync(key, value) { if (state.failWrites || state.failWriteKeys.includes(key)) throw new Error('mock storage unavailable'); stats.writes++; storage.set(key, clone(value)) },
    removeStorageSync(key) { if (state.failWrites || state.failWriteKeys.includes(key)) throw new Error('mock storage unavailable'); stats.writes++; storage.delete(key) },
    getSystemInfoSync: () => ({ theme: 'light', windowWidth: 390, windowHeight: 844, statusBarHeight: 24, pixelRatio: 2 }),
    getAppBaseInfo: () => ({ theme: 'light' }),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 24, pixelRatio: 2 }),
    getMenuButtonBoundingClientRect: () => ({ left: 293, right: 380, top: 28, bottom: 60, width: 87, height: 32 }),
    onThemeChange() {}, offThemeChange() {}, onWindowResize() {}, offWindowResize() {}, setNavigationBarTitle() {}, setNavigationBarColor() {}, setBackgroundColor() {},
    showToast: value => toasts.push(clone(value)), showLoading: () => stats.loading++, hideLoading: () => stats.hideLoading++, vibrateShort() {},
    showModal: value => modals.push(value), showActionSheet: value => modals.push(value),
    nextTick(callback) { if (state.deferTicks) ticks.push(callback); else callback() },
    canvasToTempFilePath(value) { exports.push(value); if (!state.deferExports) value.success?.({ tempFilePath: 'qa-export-' + exports.length + '.png' }) },
    createSelectorQuery() {
      const selectionsForQuery = []
      const query = {
        in: () => query,
        select(selector) {
          const selection = { selector, rectCallback: null, fieldsCallback: null, fieldsOptions: null }
          selectionsForQuery.push(selection)
          stats.selectors.push(selector)
          return {
            boundingClientRect(callback) { selection.rectCallback = callback; return query },
            fields(fields, callback) { selection.fieldsOptions = clone(fields); selection.fieldsCallback = callback; return query },
          }
        },
        exec(done) {
          const run = (override) => {
            const results = selectionsForQuery.map((selection) => {
              const selector = selection.selector
              const bySelector = override && (override.bySelector || override.selectors)
              const hasSelectorOverride = Boolean(bySelector && Object.hasOwn(bySelector, selector))
              let value = hasSelectorOverride ? bySelector[selector] : undefined
              if (value === undefined && override && !override.bySelector && !override.selectors && selection.rectCallback
                && ['left', 'top', 'width', 'height'].some((key) => Object.hasOwn(override, key))) value = override
              if (value === undefined && selection.rectCallback && Object.hasOwn(state.selectorRects, selector)) value = state.selectorRects[selector]
              if (selection.rectCallback) {
                const bounds = value === undefined ? (selector === '#dmxLayoutCanvasShell' ? rect : rect) : value
                const clonedBounds = clone(bounds)
                selection.rectCallback(clonedBounds)
                return clonedBounds
              }
              if (selection.fieldsCallback) {
                const defaults = selector === '#dmxLayoutCanvas' ? { node: mainCanvas, width: rect.width, height: rect.height }
                  : selector === '#dmxLayoutExportCanvas' ? { node: exportCanvas, width: 1, height: 1 }
                    : { node: knownCanvasNodes[selector] || null, width: rect.width, height: rect.height }
                const fieldsOverride = override && override.fieldsBySelector && Object.hasOwn(override.fieldsBySelector, selector)
                  ? override.fieldsBySelector[selector] : undefined
                const rectSize = override && !override.bySelector && !override.selectors
                  && ['width', 'height'].some((key) => Object.hasOwn(override, key)) ? override : null
                const fieldsValue = fieldsOverride !== undefined ? fieldsOverride
                  : hasSelectorOverride ? value
                    : Object.hasOwn(state.selectorFields, selector) ? state.selectorFields[selector]
                      : (rectSize && defaults.node ? { ...defaults, width: rectSize.width ?? defaults.width, height: rectSize.height ?? defaults.height } : defaults)
                const result = clone(fieldsValue)
                if (fieldsValue && fieldsValue.node && fieldsValue.node.__qaNativeCanvasNode) result.node = fieldsValue.node
                selection.fieldsCallback(result)
                return result
              }
              return null
            })
            done?.(results)
          }
          const record = { selectors: selectionsForQuery.map(item => item.selector), selector: selectionsForQuery.map(item => item.selector).join(','), run }
          if (state.deferSelectors) selectors.push(record)
          else run()
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
  return { storage, pages, selectors, ticks, frames, exports, modals, navigation, toasts, stats, state, rect, mainCanvas, exportCanvas, seed, make, event, answer, checkMain, place, drain, dispose, workspace, model }
}
module.exports = { createRuntime, clone, workspace, model, stageLightingProductIndex }

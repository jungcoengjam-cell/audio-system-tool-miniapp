'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../..')
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

function setPath(target, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current = target
  for (const part of parts.slice(0, -1)) current = current[part] || (current[part] = {})
  current[parts.at(-1)] = value
}

function createLedBrowserEnvironment({ width = 390, height = 844 } = {}) {
  const storage = new Map()
  const pending = { nextTicks: [], draws: [], canvases: [], modals: [] }
  const effects = { storage: [], canvas: [], clipboard: [], navigation: [], toasts: [], nativePreviews: [] }
  let definition = null
  const noop = () => {}
  const wx = {
    getSystemInfoSync: () => ({ theme: 'light', windowWidth: width, windowHeight: height, screenWidth: width, screenHeight: height }),
    getWindowInfo: () => ({ windowWidth: width, windowHeight: height, screenWidth: width, screenHeight: height }),
    onThemeChange: noop, offThemeChange: noop, hideKeyboard: noop, vibrateShort: noop,
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync: (key, value) => { storage.set(key, clone(value)); effects.storage.push({ key, value: clone(value) }) },
    removeStorageSync: (key) => storage.delete(key),
    getStorageInfoSync: () => ({ currentSize: 1, limitSize: 100 }),
    showToast: (options) => effects.toasts.push(clone(options)),
    showLoading: noop, hideLoading: noop,
    showModal: (options) => pending.modals.push(options),
    showActionSheet: noop,
    previewImage: (options) => effects.nativePreviews.push(clone(options)),
    navigateTo: (options) => effects.navigation.push(clone(options)),
    setNavigationBarTitle: noop,
    setClipboardData: (options) => { effects.clipboard.push(String(options?.data ?? '')); options?.success?.({}) },
    getFileSystemManager: () => ({ accessSync: noop }),
    nextTick: (callback) => pending.nextTicks.push(callback),
    createCanvasContext: () => {
      const context = {
        save: noop, restore: noop, scale: noop, translate: noop, setFillStyle: noop, fillRect: noop,
        setStrokeStyle: noop, setLineWidth: noop, strokeRect: noop, setFontSize: noop, fillText: noop,
        beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, setTextAlign: noop, arc: noop,
        fill: noop, setLineDash: noop, measureText: (text) => ({ width: String(text).length * 8 }),
        draw: (reserve, callback) => { const done = typeof reserve === 'function' ? reserve : callback; if (done) pending.draws.push(done) },
      }
      return new Proxy(context, { get: (target, key) => key in target ? target[key] : noop })
    },
    canvasToTempFilePath: (options) => pending.canvases.push(options),
  }

  global.wx = wx
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => []

  function loadPage(relativePath) {
    const absolute = path.resolve(repoRoot, relativePath)
    definition = null
    delete require.cache[require.resolve(absolute)]
    require(absolute)
    assert(definition, `Page not registered: ${relativePath}`)
    const page = { ...definition, data: clone(definition.data) }
    page.setData = (patch, callback) => {
      for (const [key, value] of Object.entries(patch)) setPath(page.data, key, clone(value))
      if (callback) pending.nextTicks.push(callback)
    }
    return page
  }

  function flushNextTicks() {
    let count = 0
    while (pending.nextTicks.length) {
      if (++count > 1000) throw new Error('LED browser fixture nextTick loop exceeded 1000 callbacks')
      pending.nextTicks.shift()()
    }
  }

  function finishDraw(index) {
    assert(index >= 0 && index < pending.draws.length, `missing pending LED draw ${index}`)
    pending.draws.splice(index, 1)[0]()
  }

  function finishCanvas(index, filePath, error = null) {
    assert(index >= 0 && index < pending.canvases.length, `missing pending LED canvas export ${index}`)
    const options = pending.canvases.splice(index, 1)[0]
    if (error) options.fail?.(error)
    else options.success?.({ tempFilePath: filePath })
  }

  function activateGlobal() { global.wx = wx }

  return { wx, storage, effects, pending, loadPage, flushNextTicks, finishDraw, finishCanvas, activateGlobal }
}

module.exports = { createLedBrowserEnvironment }

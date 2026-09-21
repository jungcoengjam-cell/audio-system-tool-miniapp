'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../..')

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function createEnvironment() {
  const storage = new Map()
  const navigation = []
  const dialogs = []
  let definition = null
  const wx = {
    getSystemInfoSync: () => ({ theme: 'light' }),
    onThemeChange() {}, offThemeChange() {},
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, clone(value)),
    showToast() {}, showLoading() {}, hideLoading() {}, vibrateShort() {},
    showModal: (options) => { dialogs.push(clone(options)); options?.success?.({ confirm: false, cancel: true }) },
    setNavigationBarTitle() {},
    navigateTo: (options) => navigation.push(clone(options)),
    nextTick: (callback) => callback(),
    createCanvasContext: () => ({
      save() {}, restore() {}, scale() {}, translate() {}, setFillStyle() {}, fillRect() {},
      setStrokeStyle() {}, setLineWidth() {}, strokeRect() {}, setFontSize() {}, fillText() {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setTextAlign() {}, arc() {}, fill() {},
      setLineDash() {}, draw() {},
    }),
    canvasToTempFilePath() {},
  }
  global.wx = wx
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => []
  const offline = require('../helpers/offline-guard')
  offline.registerWx(wx)

  function loadPage(relativePath) {
    const absolute = path.resolve(repoRoot, relativePath)
    definition = null
    delete require.cache[require.resolve(absolute)]
    require(absolute)
    assert(definition, `Page not registered: ${relativePath}`)
    const page = { ...definition, data: clone(definition.data) }
    page.setData = (patch, callback) => {
      for (const [key, value] of Object.entries(patch)) {
        const segments = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = page.data
        for (const segment of segments.slice(0, -1)) target = target[segment]
        target[segments.at(-1)] = value
      }
      if (callback) callback()
    }
    return page
  }

  return { dialogs, loadPage, navigation, storage, wx, offlineAttempts: offline.attempts }
}

function patchExport(modulePath, name, wrapperFactory) {
  const absolute = path.resolve(repoRoot, modulePath)
  const mod = require(absolute)
  const original = mod[name]
  const calls = []
  mod[name] = wrapperFactory(original, calls)
  return {
    calls,
    restore() { mod[name] = original },
  }
}

module.exports = { createEnvironment, patchExport, repoRoot }

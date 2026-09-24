'use strict'

const assert = require('node:assert/strict')
const { createEnvironment } = require('../../p2-safety/harness.cjs')

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

// The normal offline harness answers every modal immediately with cancel.  A
// safety test needs to retain callbacks so it can prove that a response from a
// previous operation cannot confirm a newer one, and that a late canvas/report
// callback cannot repopulate stale output.
function createDelayedEnvironment() {
  const env = createEnvironment()
  const pending = { modals: [], nextTicks: [], draws: [], canvases: [] }
  const effects = { storage: [], navigation: [], toasts: [], loading: [], canvas: [], clipboard: [] }

  env.wx.showModal = (options) => {
    pending.modals.push(options)
    env.dialogs.push(clone({ title: options?.title, content: options?.content }))
  }
  env.wx.nextTick = (callback) => { pending.nextTicks.push(callback) }
  env.wx.createCanvasContext = () => {
    const noop = () => {}
    const context = {
      save: noop, restore: noop, scale: noop, translate: noop, setFillStyle: noop,
      fillRect: noop, setStrokeStyle: noop, setLineWidth: noop, strokeRect: noop,
      setFontSize: noop, fillText: noop, beginPath: noop, moveTo: noop,
      lineTo: noop, stroke: noop, setTextAlign: noop, arc: noop, fill: noop,
      measureText: (text) => ({ width: String(text).length * 8 }),
      setLineDash: noop,
      draw: (reserve, callback) => {
        const complete = typeof reserve === 'function' ? reserve : callback
        if (complete) pending.draws.push(complete)
      },
    }
    return new Proxy(context, { get: (target, key) => key in target ? target[key] : noop })
  }
  env.wx.navigateTo = (options) => {
    effects.navigation.push(clone(options))
    env.navigation.push(clone(options))
  }
  env.wx.setStorageSync = (key, value) => {
    effects.storage.push({ key, value: clone(value) })
    env.storage.set(key, clone(value))
  }
  env.wx.showToast = (options) => { effects.toasts.push(clone(options)) }
  env.wx.setClipboardData = (options) => {
    effects.clipboard.push(String(options?.data ?? ''))
    options?.success?.({})
  }
  env.wx.showLoading = (options) => { effects.loading.push({ type: 'show', options: clone(options) }) }
  env.wx.hideLoading = () => { effects.loading.push({ type: 'hide' }) }
  env.wx.canvasToTempFilePath = (options) => {
    pending.canvases.push(options)
    effects.canvas.push({ type: 'queued', canvasId: options?.canvasId })
  }

  const loadPage = env.loadPage
  env.loadPage = (relativePath) => {
    const page = loadPage(relativePath)
    const setData = page.setData
    page.setData = (patch, callback) => {
      setData(patch)
      if (callback) pending.nextTicks.push(callback)
    }
    return page
  }

  function answerModal(index, confirm = true, content = '') {
    assert(index >= 0 && index < pending.modals.length, `missing delayed modal ${index}`)
    const options = pending.modals[index]
    pending.modals.splice(index, 1)
    options.success?.({ confirm, cancel: !confirm, content })
  }
  function finishCanvas(index, filePath = `wxfile://report-${index}.png`, error = null) {
    assert(index >= 0 && index < pending.canvases.length, `missing delayed canvas ${index}`)
    const options = pending.canvases[index]
    pending.canvases.splice(index, 1)
    if (error) options.fail?.(error)
    else options.success?.({ tempFilePath: filePath })
  }
  function finishDraw(index) {
    assert(index >= 0 && index < pending.draws.length, `missing delayed draw ${index}`)
    const callback = pending.draws[index]
    pending.draws.splice(index, 1)
    callback()
  }
  function flushNextTicks() {
    while (pending.nextTicks.length) pending.nextTicks.shift()()
  }
  return {
    ...env,
    pending,
    effects,
    answerModal,
    finishCanvas,
    finishDraw,
    flushNextTicks,
    clone,
  }
}

module.exports = { createDelayedEnvironment, clone }

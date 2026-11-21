const assert = require('node:assert/strict')
const Module = require('node:module')
const { createRuntime, clone } = require('./project-wiring-redesign-2026-10-16/runtime.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const saves = (env) => env.events.shares.filter((event) => event.type === 'save')
const reportControllerPath = require.resolve('../pages/project-wiring/report-controller')
const originalLoad = Module._load
let activeEnv = null
let longImageSequence = 0

Module._load = function (request, parent, isMain) {
  if (request === './report-long-image' && parent && parent.filename === reportControllerPath) {
    return {
      exportLongProjectImage(options) {
        const owner = activeEnv
        if (!owner || !options.isCurrent()) return
        owner.events.longImageReleases ||= []
        const tempFilePath = '/long-project-' + (++longImageSequence) + '.png'
        const release = () => owner.events.longImageReleases.push(tempFilePath)
        if (owner.deferLongImageCallbacks) {
          owner.longImageRequests ||= []
          owner.longImageRequests.push({ ...options, tempFilePath, release })
          return
        }
        owner.events.exports.push({ canvasId: options.canvasId, width: options.page.width,
          height: options.page.height, longImage: true })
        options.success({ tempFilePath, release })
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

async function run() {
  {
    const env = createRuntime({ count: 40 })
    activeEnv = env
    const listeners = new Set()
    const onThemeChange = env.wx.onThemeChange
    const offThemeChange = env.wx.offThemeChange
    env.wx.onThemeChange = (listener) => { listeners.add(listener); onThemeChange(listener) }
    env.wx.offThemeChange = (listener) => {
      assert.ok(listeners.delete(listener), 'unload removes the exact registered theme listener')
      offThemeChange(listener)
    }
    const page = env.page({ id: 'qa-project-1' })
    try {
      await env.dispatch('shareProject')
      assert.equal(page.data.reportImages.length, 1, 'project wiring is exported as one long image')
      const images = clone(page.data.reportImages)
      const exports = env.events.exports.length
      env.deferPhotoSaveCallbacks(true)
      page.saveAllReportImages()
      assert.equal(saves(env).length, 1)
      page.onHide()
      page.onShow()
      await env.dispatch('shareProject')
      assert.equal(page.data.reportPreviewVisible, true)
      assert.deepEqual(page.data.reportImages, images, 'returning to the same project retains the rendered report')
      assert.equal(env.events.exports.length, exports, 'reopening after hide uses the report cache')
      page.saveAllReportImages()
      assert.equal(saves(env).length, 1, 'the uncancellable album request blocks a duplicate save')
      assert.deepEqual(env.completeNextPhotoSave(), { completed: true, pending: 0 })
      assert.equal(saves(env).length, 1, 'the canceled queue does not resume after returning')
      await env.dispatch('shareProject')
      assert.deepEqual(page.data.reportSavedPageIndices, [0], 'the completed album request is retained for cache reopen')
      assert.equal(page.data.reportSaveInFlight, false)
      const oldPath = page.data.reportImagePath
      page.saveAllReportImages()
      assert.equal(saves(env).length, 1, 'a saved long image is not queued a second time')
      env.theme('dark')
      assert.equal(listeners.size, 1)
      await env.dispatch('shareProject')
      const currentPath = page.data.reportImagePath
      assert.notEqual(currentPath, oldPath, 'theme change generates a fresh long image')
      assert.deepEqual(env.events.longImageReleases, [oldPath], 'replacement releases the old cached image')
      page.onUnload()
      const dataAfterUnload = clone(page.data)
      const navigationCount = env.events.navigationColors.length
      env.theme('light')
      assert.deepEqual(page.data, dataAfterUnload, 'theme changes cannot render into a destroyed page')
      assert.equal(saves(env).length, 1, 'unload does not issue another album save')
      assert.deepEqual(env.events.longImageReleases, [oldPath, currentPath], 'unload releases the remaining cached image')
      assert.equal(listeners.size, 0)
      assert.equal(env.events.navigationColors.length, navigationCount, 'theme changes cannot reach the destroyed page')
    } finally {
      if (!page._destroyed) page.onUnload()
    }
  }

  {
    const env = createRuntime()
    activeEnv = env
    env.deferLongImageCallbacks = true
    const pending = []
    env.longImageRequests = pending
    const oldPage = env.page({ id: 'qa-project-1' })
    await env.dispatch('shareProject')
    assert.equal(pending.length, 1)
    oldPage.onHide()
    oldPage.onUnload()
    const oldData = clone(oldPage.data)
    const page = env.page({ id: 'qa-project-2' })
    try {
      const currentData = clone(page.data)
      const { tempFilePath, release, success } = pending[0]
      success({ tempFilePath, release })
      assert.deepEqual(oldPage.data, oldData, 'late canvas completion cannot revive the unloaded report')
      assert.deepEqual(page.data, currentData, 'an old page callback cannot alter the newly opened project')
      assert.equal(pending.length, 1, 'late completion cannot advance the old export queue')
      assert.equal(env.events.loading, 0)
      assert.deepEqual(env.events.longImageReleases, [tempFilePath],
        'the rejected late long image is released')
    } finally {
      page.onUnload()
    }
  }

  {
    const env = createRuntime()
    activeEnv = env
    const page = env.page({ id: 'qa-project-1' })
    try {
      await env.dispatch('shareProject')
      const images = clone(page.data.reportImages)
      const exports = env.events.exports.length
      const callbacks = []
      const setData = page.setData
      page.setData = function (patch, callback) {
        setData.call(this, patch)
        if (typeof callback === 'function') callbacks.push(callback)
      }
      page.closeReportPreview()
      assert.ok(callbacks.length, 'closing waits for a render commit')
      page.onHide()
      page.onShow()
      page.setData = setData
      await env.dispatch('shareProject')
      while (callbacks.length) callbacks.shift()()
      await delay(270)
      assert.equal(page.data.reportPreviewVisible, true, 'an old close commit cannot close the report reopened after return')
      assert.deepEqual(page.data.reportImages, images, 'the old overlay cleanup cannot clear the reopened report cache')
      assert.equal(env.events.exports.length, exports)
    } finally {
      page.onUnload()
    }
  }

  console.log('project wiring report/lifecycle regression passed (3 combined scenarios)')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

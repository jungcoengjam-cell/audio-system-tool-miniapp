'use strict'

const assert = require('node:assert/strict')
const { createEnvironment } = require('./p2-safety/harness.cjs')

function createRecorder(pendingDraws) {
  const contexts = []
  return {
    contexts,
    create(canvasId) {
      const fills = []
      const strokes = []
      const context = {
        canvasId,
        fills,
        strokes,
        font: '12px sans-serif',
        fillStyle: '#000000',
        strokeStyle: '#000000',
        setFillStyle(value) { this.fillStyle = value; fills.push(value) },
        setStrokeStyle(value) { this.strokeStyle = value; strokes.push(value) },
        draw(reserve, callback) {
          const complete = typeof reserve === 'function' ? reserve : callback
          if (complete) pendingDraws.push(complete)
        },
      }
      const proxy = new Proxy(context, {
        get(target, key) {
          if (key in target) return target[key]
          return () => {}
        },
      })
      contexts.push(proxy)
      return proxy
    },
  }
}

function setup() {
  const env = createEnvironment()
  let theme = 'light'
  let themeListener = null
  let deferImageInfo = false
  const pendingImages = []
  const pendingDraws = []
  const pendingExports = []
  const loading = []
  const previews = []
  env.wx.getAppBaseInfo = () => ({ theme })
  env.wx.getSystemInfoSync = () => ({ theme })
  env.wx.onThemeChange = (listener) => { themeListener = listener }
  env.wx.offThemeChange = (listener) => { if (themeListener === listener) themeListener = null }
  env.wx.getImageInfo = (options) => {
    if (deferImageInfo) pendingImages.push(options)
    else options.success({ path: options.src, width: 384, height: 384 })
  }
  env.wx.showLoading = (options) => loading.push({ type: 'show', options })
  env.wx.hideLoading = () => loading.push({ type: 'hide' })
  env.wx.previewImage = (options) => previews.push(options)
  const recorder = createRecorder(pendingDraws)
  env.wx.createCanvasContext = (canvasId) => recorder.create(canvasId)
  env.wx.canvasToTempFilePath = (options) => pendingExports.push(options)

  const page = env.loadPage('pages/audio-wiring/index.js')
  page.onLoad()
  page.updateResultReportPreviewLayout = () => true
  page.onShow()
  assert(page.data.supported, 'default wiring fixture has a supported result')

  return {
    env,
    page,
    recorder,
    pendingImages,
    pendingDraws,
    pendingExports,
    loading,
    previews,
    get theme() { return theme },
    set theme(value) { theme = value },
    setDeferImageInfo(value) { deferImageInfo = Boolean(value) },
    changeTheme(value) {
      theme = value
      assert.equal(typeof themeListener, 'function', 'audio wiring remains subscribed to WeChat theme changes')
      themeListener({ theme: value })
    },
    resolveImages() {
      pendingImages.splice(0).forEach((options) => {
        options.success({ path: options.src, width: 384, height: 384 })
      })
    },
    finishDraw() {
      const callback = pendingDraws.shift()
      assert.equal(typeof callback, 'function', 'report draw callback is pending')
      callback()
    },
    finishExport(path, error) {
      const options = pendingExports.shift()
      assert(options, 'image export callback is pending')
      if (error) options.fail(error)
      else options.success({ tempFilePath: path })
    },
  }
}

function finishGeneratedImage(runtime, path) {
  if (runtime.pendingImages.length) runtime.resolveImages()
  assert(runtime.pendingDraws.length, 'photos resolve before report draw')
  runtime.finishDraw()
  runtime.finishExport(path)
}

function testAudioWiringThemeCacheAndLifecycle() {
  const runtime = setup()
  const { page, recorder, pendingExports, loading, previews } = runtime
  page.generateResultReportImage()
  finishGeneratedImage(runtime, 'wxfile://wiring-light.png')
  assert.equal(page.data.resultReportImagePath, 'wxfile://wiring-light.png')
  assert.equal(page._reportImageTheme, 'light')
  assert.equal(recorder.contexts.at(-1).fills[0], '#ffffff', 'light export uses the report light background')
  assert.equal(page.data.isGeneratingResultReport, false)
  assert.equal(loading.at(-1).type, 'hide')

  const lightExportCount = pendingExports.length
  page.generateResultReportImage()
  assert.equal(pendingExports.length, lightExportCount, 'same-theme cache hit does not render or export again')
  assert.equal(page.data.resultReportPreviewVisible, true)

  runtime.changeTheme('dark')
  assert.equal(page.data.resultReportImagePath, 'wxfile://wiring-light.png', 'theme change retains the existing preview snapshot')
  assert.equal(page._reportImageTheme, 'light')
  page.generateResultReportImage()
  finishGeneratedImage(runtime, 'wxfile://wiring-dark.png')
  assert.equal(page.data.resultReportImagePath, 'wxfile://wiring-dark.png')
  assert.equal(page._reportImageTheme, 'dark')
  assert.equal(recorder.contexts.at(-1).fills[0], '#111214', 'dark export uses the dark report background')

  const darkExportCount = pendingExports.length
  page.generateResultReportImage()
  assert.equal(pendingExports.length, darkExportCount, 'matching dark theme also reuses its image')
  assert.equal(page.previewResultReportImage(), true)
  assert.equal(previews.at(-1).current, 'wxfile://wiring-dark.png')
  page.onHide()
  runtime.theme = 'light'
  page.onShow()
  assert.equal(page.data.theme, 'light', 'onShow rereads the latest system theme')
  assert.equal(page.data.resultReportImagePath, 'wxfile://wiring-dark.png', 'onShow preserves the saved dark snapshot')
  assert.equal(page._reportImageTheme, 'dark')

  runtime.setDeferImageInfo(true)
  page.generateResultReportImage()
  assert.equal(page.data.isGeneratingResultReport, true)
  assert(runtime.pendingImages.length, 'light regeneration waits for the report photo callback')
  runtime.changeTheme('dark')
  assert.equal(page.data.isGeneratingResultReport, false, 'theme switch clears in-flight loading state')
  const drawCountBeforeLatePhotos = recorder.contexts.length
  runtime.resolveImages()
  assert.equal(recorder.contexts.length, drawCountBeforeLatePhotos, 'late image callbacks cannot begin obsolete drawing')
  assert.equal(pendingExports.length, darkExportCount)
  assert.equal(page.data.resultReportImagePath, '', 'the obsolete light image does not commit')
  assert.equal(page._reportImageTheme, '')
  assert.equal(loading.at(-1).type, 'hide')

  runtime.setDeferImageInfo(false)
  page.generateResultReportImage()
  assert(runtime.pendingDraws.length, 'current dark generation reaches its canvas draw')
  runtime.finishDraw()
  assert.equal(pendingExports.length, darkExportCount + 1)
  runtime.changeTheme('light')
  assert.equal(page.data.isGeneratingResultReport, false)
  runtime.finishExport('wxfile://stale-wiring-dark.png')
  assert.equal(page.data.resultReportImagePath, '', 'late canvas export cannot commit after cancellation')
  assert.equal(page._reportImageTheme, '')
  assert.equal(loading.at(-1).type, 'hide')

  runtime.setDeferImageInfo(false)
  page.generateResultReportImage()
  runtime.resolveImages()
  runtime.finishDraw()
  runtime.finishExport('', new Error('simulated export failure'))
  assert.equal(page.data.isGeneratingResultReport, false, 'export failure also settles loading state')
  assert.equal(page._reportImageTheme, '')

  page.onUnload()
  return {
    status: 'passed',
    lightAndDarkCacheHits: true,
    themeMismatchRegenerates: true,
    onShowSnapshotRetention: true,
    latePhotoAndExportRejected: true,
    exportFailureSettles: true,
    canvasContexts: recorder.contexts.length,
  }
}

const result = testAudioWiringThemeCacheAndLifecycle()
process.stdout.write(`${JSON.stringify(result)}\n`)

'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./p2-safety-remediation/minimal/delayed-environment.cjs')

function createCanvasRecorder(pending) {
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
        setFillStyle(value) { fills.push(value) },
        setStrokeStyle(value) { strokes.push(value) },
        setFontSize(value) { this.font = `${value}px sans-serif` },
        setTextAlign() {},
        setLineWidth() {},
        setLineDash() {},
        measureText(value) { return { width: [...String(value)].length * 8 } },
        draw(reserve, callback) {
          const complete = typeof reserve === 'function' ? reserve : callback
          if (complete) pending.draws.push(complete)
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

function makePage() {
  const env = createDelayedEnvironment()
  let theme = 'light'
  let themeListener = null
  const previews = []
  env.wx.getAppBaseInfo = () => ({ theme })
  env.wx.getSystemInfoSync = () => ({ theme })
  env.wx.onThemeChange = (listener) => { themeListener = listener }
  env.wx.offThemeChange = (listener) => { if (themeListener === listener) themeListener = null }
  env.wx.getFileSystemManager = () => ({ access: ({ success }) => success && success() })
  env.wx.previewImage = (options) => previews.push(options)
  const recorder = createCanvasRecorder(env.pending)
  env.wx.createCanvasContext = (canvasId) => recorder.create(canvasId)
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.drawPreview = () => {}
  page.updateResultReportPreviewLayout = () => true
  page.onShow()
  env.flushNextTicks()
  return {
    env,
    page,
    recorder,
    previews,
    get theme() { return theme },
    set theme(value) { theme = value },
    changeTheme(value) {
      theme = value
      assert.equal(typeof themeListener, 'function', 'camera remains subscribed to WeChat theme changes')
      themeListener({ theme: value })
      env.flushNextTicks()
    },
  }
}

function completeGeneration(env, recorder, index, path) {
  env.flushNextTicks()
  assert(env.pending.draws.length > 0, 'report canvas draw callback is pending')
  env.finishDraw(0)
  assert(env.pending.canvases.length > 0, 'draw completion starts image export')
  env.finishCanvas(0, path)
  env.flushNextTicks()
  return recorder.contexts[index]
}

function testThemeCacheAndPreviewSnapshot() {
  const { env, page, recorder, previews, changeTheme } = makePage()
  const contentSignature = page.getResultReportSignature()

  assert.equal(page.generateResultReportImage(), true)
  const lightContext = completeGeneration(env, recorder, 1, 'wxfile://camera-light.png')
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-light.png')
  assert.equal(page._resultReportImageTheme, 'light')
  assert.equal(page.resultReportSignature, contentSignature)
  assert.equal(lightContext.fills[0], '#f6f7f9', 'generated light image uses the light report background')

  const exportCount = env.effects.canvas.filter((item) => item.type === 'queued').length
  assert.equal(page.generateResultReportImage(), true, 'same content and theme reuses the cached image')
  assert.equal(env.effects.canvas.filter((item) => item.type === 'queued').length, exportCount)
  assert.equal(page.data.resultReportPreviewVisible, true)

  assert.equal(page.previewResultReportImage(), true, 'the saved result opens its native full-image preview')
  assert.equal(previews.at(-1).current, 'wxfile://camera-light.png')
  const previewState = page._nativeImagePreview
  page.onHide()
  assert.equal(page._nativeImagePreview, previewState)
  assert.equal(previewState.hidden, true)
  changeTheme('dark')
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-light.png', 'theme change preserves the displayed snapshot')
  assert.equal(page._resultReportImageTheme, 'light')
  assert.equal(page.resultReportSignature, contentSignature, 'theme does not contaminate the content signature')

  page.onShow()
  env.flushNextTicks()
  assert.equal(page._nativeImagePreview, null, 'native preview return clears only its transient lifecycle token')
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-light.png')
  assert.equal(page._resultReportImageTheme, 'light')
  assert.equal(page.data.theme, 'dark')
  assert.equal(page.canUseCurrentResultReport(), true, 'old image remains valid as the current content snapshot')

  const beforeDarkContexts = recorder.contexts.length
  assert.equal(page.generateResultReportImage(), true, 'theme mismatch regenerates instead of reusing light image')
  const darkContext = completeGeneration(env, recorder, beforeDarkContexts + 1, 'wxfile://camera-dark.png')
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-dark.png')
  assert.equal(page._resultReportImageTheme, 'dark')
  assert.equal(page.resultReportSignature, contentSignature)
  assert.equal(darkContext.fills[0], '#000000', 'generated dark image uses the dark report background')

  const darkExportCount = env.effects.canvas.filter((item) => item.type === 'queued').length
  assert.equal(page.generateResultReportImage(), true, 'same dark theme reuses its cache')
  assert.equal(env.effects.canvas.filter((item) => item.type === 'queued').length, darkExportCount)

  changeTheme('light')
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-dark.png', 'existing dark snapshot survives theme change')
  const previousPath = page.data.resultReportImagePath
  assert.equal(page.generateResultReportImage(), true)
  env.flushNextTicks()
  env.finishDraw(0)
  assert.equal(env.pending.canvases.length, 1, 'light-theme export is now in flight')
  changeTheme('dark')
  assert.equal(page.data.isGeneratingResultReport, false, 'theme change ends the obsolete generation and loading state')
  env.finishCanvas(0, 'wxfile://stale-camera-light.png')
  assert.equal(page.data.resultReportImagePath, previousPath, 'late export cannot replace the retained snapshot')
  assert.equal(page._resultReportImageTheme, 'dark')
  assert.equal(page.resultReportSignature, contentSignature)

  page.onUnload()
  return {
    status: 'passed',
    lightCacheHit: true,
    darkCacheHit: true,
    themeMismatchRegenerates: true,
    previewSnapshotRetained: true,
    staleExportRejected: true,
    canvasContexts: recorder.contexts.length,
  }
}

const result = testThemeCacheAndPreviewSnapshot()
process.stdout.write(`${JSON.stringify(result)}\n`)

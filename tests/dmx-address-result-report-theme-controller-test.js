'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createResultReportMethods, createResultReportData, resetStaleResultReport } = require('../utils/result-report-controller')
const nativeImagePreview = require('../pages/native-image-preview')
const { DARK_RESULT_COLORS, getResultImageTheme } = require('../pages/result-image-theme')
const dmxResultUiPath = require.resolve('../pages/dmx-address/result-report-ui')
const dmxPagePath = require.resolve('../pages/dmx-address/dmx-address')
const {
  DARK_RESULT_REPORT_COLOR_MAP,
  createDmxAddressResultReportThemeController,
  createResultReportThemeContext,
} = require('../pages/dmx-address/result-report-ui')

const originalDateNow = Date.now
const originalWx = global.wx
const originalGetCurrentPages = global.getCurrentPages
Date.now = () => new Date('2026-10-29T12:00:00.000Z').getTime()
console.info = () => {}

function testThemeImplementationUsesExistingUiModule() {
  const pageSource = fs.readFileSync(dmxPagePath, 'utf8')
  const uiSource = fs.readFileSync(dmxResultUiPath, 'utf8')
  const uiRequire = "require('./result-report-ui')"
  assert(pageSource.includes(uiRequire), 'DMX page uses its existing result UI module')
  assert(!pageSource.includes("require('./result-report-theme-controller')")
    && !pageSource.includes("require('./result-report-theme')")
    && !uiSource.includes("require('./result-report-theme-controller')")
    && !uiSource.includes("require('./result-report-theme')"),
  'DMX runtime does not require separate same-package theme modules')

  const uiDependency = require.resolve('./result-report-ui', { paths: [path.dirname(dmxPagePath)] })
  assert.equal(uiDependency, dmxResultUiPath, 'the DMX page resolves the existing result UI entry')
  for (const [sourcePath, source] of [[dmxPagePath, pageSource], [dmxResultUiPath, uiSource]]) {
    for (const [, request] of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!request.startsWith('.')) continue
      assert.doesNotThrow(() => require.resolve(request, { paths: [path.dirname(sourcePath)] }),
        `${path.relative(process.cwd(), sourcePath)} dependency resolves: ${request}`)
    }
  }
}

function createRecorder(harness) {
  const trace = []
  const context = { trace, wrongThis: false, _font: '' }
  const methods = [
    'setFillStyle', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo',
    'closePath', 'fill', 'setStrokeStyle', 'setLineWidth', 'stroke', 'setTextAlign',
    'fillText', 'measureText',
  ]
  methods.forEach((name) => {
    context[name] = function (...args) {
      if (this !== context) context.wrongThis = true
      trace.push({ name, args })
      if (name === 'measureText') return { width: [...String(args[0])].length * 11 }
      return undefined
    }
  })
  context.draw = function (reserve, callback) {
    if (this !== context) context.wrongThis = true
    trace.push({ name: 'draw', args: [reserve] })
    const done = typeof reserve === 'function' ? reserve : callback
    if (!done) return
    if (harness.deferDraw) harness.pendingDraw = done
    else done()
  }
  Object.defineProperty(context, 'font', {
    enumerable: true,
    get() {
      if (this !== context) context.wrongThis = true
      return context._font
    },
    set(value) {
      if (this !== context) context.wrongThis = true
      context._font = value
      trace.push({ name: 'font', args: [value] })
    },
  })
  harness.contexts.push(context)
  return context
}

function createHarness(options = {}) {
  const harness = {
    theme: options.theme || 'light',
    deferDraw: Boolean(options.deferDraw),
    deferExport: Boolean(options.deferExport),
    failCreate: Boolean(options.failCreate),
    failExport: Boolean(options.failExport),
    contexts: [],
    pendingDraw: null,
    pendingExport: null,
    exports: [],
    exportCount: 0,
    createCount: 0,
    showLoadingCount: 0,
    hideLoadingCount: 0,
    toasts: [],
    previewCalls: [],
    nextPath: 0,
    page: null,
  }
  global.wx = {
    createCanvasContext(canvasId, page) {
      assert.equal(canvasId, 'resultReportCanvas')
      assert.equal(page, harness.page)
      harness.createCount += 1
      if (harness.failCreate) throw new Error('canvas unavailable')
      return createRecorder(harness)
    },
    canvasToTempFilePath(exportOptions, page) {
      assert.equal(page, harness.page)
      harness.exportCount += 1
      harness.exports.push({
        canvasId: exportOptions.canvasId,
        width: exportOptions.width,
        height: exportOptions.height,
        destWidth: exportOptions.destWidth,
        destHeight: exportOptions.destHeight,
        fileType: exportOptions.fileType,
        quality: exportOptions.quality,
      })
      if (harness.deferExport) harness.pendingExport = exportOptions
      else if (harness.failExport) exportOptions.fail()
      else exportOptions.success({ tempFilePath: `temp://dmx-report-${++harness.nextPath}.png` })
    },
    showLoading() { harness.showLoadingCount += 1 },
    hideLoading() { harness.hideLoadingCount += 1 },
    showToast(value) { harness.toasts.push(value) },
    vibrateShort() {},
    previewImage(value) { harness.previewCalls.push(value) },
  }
  global.getCurrentPages = () => harness.page ? [harness.page] : []
  return harness
}

const record = {
  module: 'dmxAddress',
  title: '自动编址 · 2 组 · 8 台灯具',
  summary: '起始 1 → 结束 166 · 下一可用 167',
  resultText: [
    '1. 舞台染色灯 · 4 台 × 20 CH · 1 → 80',
    '2. 摇头灯 · 4 台 × 21 CH · 81 → 164',
    '注：示例现场须核对',
    '限幅阈值：-6 dB',
  ].join('\n'),
}

function createPage(harness, methods, baseMethods) {
  const page = {
    ...createResultReportData(),
    resultReportCanvasWidth: 750,
    data: { ...createResultReportData() },
    resultReportRevision: 0,
    resultReportSignature: '',
    resultReportPendingSignature: '',
    _resultReportImageTheme: undefined,
    _pageAlive: true,
    _pageVisible: true,
    buildResultReportRecord() { return record },
    getRecordPayload() { return record },
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) callback()
    },
  }
  Object.assign(page, baseMethods || {}, methods || {})
  harness.page = page
  return page
}

function createControllerPage(harness) {
  const resultReportMethods = createResultReportMethods({
    performancePrefix: 'DMX',
    emptyToast: '暂无可生成的编址结果',
  })
  const themeMethods = createDmxAddressResultReportThemeController({
    resultReportMethods,
    getTheme: () => harness.theme,
  })
  return {
    resultReportMethods,
    page: createPage(harness, themeMethods, resultReportMethods),
    themeMethods,
  }
}

function normalizeColorTrace(trace) {
  const reverse = Object.fromEntries(Object.entries(DARK_RESULT_REPORT_COLOR_MAP)
    .map(([light, dark]) => [dark, light]))
  return trace.map((entry) => {
    if (entry.name !== 'setFillStyle' && entry.name !== 'setStrokeStyle') return entry
    const color = String(entry.args[0]).toLowerCase()
    return { name: entry.name, args: [reverse[color] || entry.args[0], ...entry.args.slice(1)] }
  })
}

function renderWithGenericController() {
  const harness = createHarness({ theme: 'light' })
  const methods = createResultReportMethods({ performancePrefix: 'DMX', emptyToast: '暂无可生成的编址结果' })
  const page = createPage(harness, methods)
  methods.generateResultReportImage.call(page)
  return { harness, page, context: harness.contexts[0] }
}

function testThemeGetterAndFacade() {
  assert.equal(getResultImageTheme(), 'light', 'missing wx falls back to light')
  assert.deepEqual(DARK_RESULT_COLORS, {
    '#f5f5f7': '#111214', '#ffffff': '#1c1d20', '#e5e5ea': '#3b3e42',
    '#eaf7f5': '#18332f', '#c5e5de': '#2c6257', '#eef6ff': '#1b2d3e',
    '#d6e5f4': '#38536d', '#1d1d1f': '#f2f3f5', '#6e6e73': '#c4c7cc',
    '#087f70': '#5bd0b9', '#fff4e5': '#382817', '#8a5700': '#ffd08a',
    '#f0d4ad': '#70512d',
  }, 'shared limiter/gain palette retains all original dark color values')
  const receiverChecks = []
  const receiverApi = {
    getAppBaseInfo() {
      receiverChecks.push(this === receiverApi)
      return { theme: 'auto' }
    },
    getSystemInfoSync() {
      receiverChecks.push(this === receiverApi)
      return { theme: 'dark' }
    },
  }
  assert.equal(getResultImageTheme(receiverApi), 'dark')
  assert.deepEqual(receiverChecks, [true, true], 'theme getters retain the wx receiver')
  assert.equal(getResultImageTheme({
    getAppBaseInfo: () => ({ theme: 'dark' }),
    getSystemInfoSync: () => ({ theme: 'light' }),
  }), 'dark')
  assert.equal(getResultImageTheme({
    getAppBaseInfo: () => ({ theme: 'auto' }),
    getSystemInfoSync: () => ({ theme: 'dark' }),
  }), 'dark')
  assert.equal(getResultImageTheme({
    getAppBaseInfo: () => { throw new Error('unavailable') },
    getSystemInfoSync: () => ({ theme: 'light' }),
  }), 'light')
  assert.equal(getResultImageTheme({
    getAppBaseInfo: () => ({ theme: 'auto' }),
    getSystemInfoSync: () => { throw new Error('unavailable') },
  }), 'light')
  assert.equal(getResultImageTheme({}), 'light')
  assert.equal(getResultImageTheme({
    getAppBaseInfo: () => ({ theme: 'auto' }),
    getSystemInfoSync: () => ({ theme: 'auto' }),
  }), 'light')

  const baseline = renderWithGenericController()
  const lightHarness = createHarness({ theme: 'light' })
  const lightSetup = createControllerPage(lightHarness)
  lightSetup.themeMethods.generateResultReportImage.call(lightSetup.page)
  assert.strictEqual(createResultReportThemeContext(lightHarness.contexts[0], 'light'), lightHarness.contexts[0])
  assert.deepEqual(lightHarness.contexts[0].trace, baseline.context.trace,
    'default light must reproduce the generic controller Canvas trace exactly')

  const darkHarness = createHarness({ theme: 'dark' })
  const darkSetup = createControllerPage(darkHarness)
  darkSetup.themeMethods.generateResultReportImage.call(darkSetup.page)
  assert.deepEqual(normalizeColorTrace(darkHarness.contexts[0].trace), baseline.context.trace,
    'dark Canvas trace must differ from generic light only at fill/stroke colors')
  assert.equal(baseline.context.wrongThis, false)
  assert.equal(lightHarness.contexts[0].wrongThis, false)
  assert.equal(darkHarness.contexts[0].wrongThis, false)
  const usedColors = [...new Set(baseline.context.trace
    .filter((entry) => entry.name === 'setFillStyle' || entry.name === 'setStrokeStyle')
    .map((entry) => String(entry.args[0]).toLowerCase()))]
  assert.deepEqual(usedColors.filter((color) => !DARK_RESULT_REPORT_COLOR_MAP[color]), [])
  assert.equal(usedColors.length, 13, 'all generic result renderer colors should have a dark mapping')
  const lightColors = baseline.context.trace.filter((entry) => entry.name === 'setFillStyle' || entry.name === 'setStrokeStyle')
  const darkColors = darkHarness.contexts[0].trace.filter((entry) => entry.name === 'setFillStyle' || entry.name === 'setStrokeStyle')
  assert.equal(darkColors.filter((entry, index) => entry.args[0] !== lightColors[index].args[0]).length, 22)
}

function testThemeCacheAndContentSignature() {
  const harness = createHarness({ theme: 'light' })
  const { resultReportMethods, page, themeMethods } = createControllerPage(harness)
  themeMethods.generateResultReportImage.call(page)
  const signature = resultReportMethods.getResultReportSignature.call(page)
  assert.equal(page.resultReportSignature, signature)
  assert.equal(page._resultReportImageTheme, 'light')
  assert.equal(page.data.resultReportImagePath, 'temp://dmx-report-1.png')
  assert.equal(page.data.resultReportPreviewVisible, true)
  assert.deepEqual(resetStaleResultReport(page, record), {},
    'theme metadata must not turn the content-only signature stale')

  page.setData({ resultReportPreviewVisible: false })
  themeMethods.generateResultReportImage.call(page)
  assert.equal(harness.exportCount, 1, 'matching content and theme should reuse the PNG')
  assert.equal(page.data.resultReportPreviewVisible, true)

  const cachedPath = page.data.resultReportImagePath
  harness.theme = 'dark'
  themeMethods.generateResultReportImage.call(page)
  assert.equal(harness.exportCount, 2, 'same content in another theme must generate a new PNG')
  assert.equal(page.data.resultReportImagePath, 'temp://dmx-report-2.png')
  assert.notEqual(page.data.resultReportImagePath, cachedPath)
  assert.equal(page._resultReportImageTheme, 'dark')
  assert.equal(page.resultReportSignature, signature, 'theme must stay outside the content signature')

  page.setData({ resultReportPreviewVisible: false })
  themeMethods.generateResultReportImage.call(page)
  assert.equal(harness.exportCount, 2, 'matching dark cache should be reused')
}

function testCancellationAndHiddenCallback() {
  const canceled = createHarness({ theme: 'light', deferDraw: true })
  const canceledSetup = createControllerPage(canceled)
  canceledSetup.themeMethods.generateResultReportImage.call(canceledSetup.page)
  assert.equal(canceled.page.data.isGeneratingResultReport, true)
  assert.equal(canceled.showLoadingCount, 1)
  canceled.page.cancelResultReportImageGeneration()
  assert.equal(canceled.page.data.isGeneratingResultReport, false)
  assert.equal(canceled.page.resultReportPendingSignature, '')
  canceled.pendingDraw()
  assert.equal(canceled.exportCount, 0, 'canceled draw callback must not export')
  assert.equal(canceled.page.data.resultReportImagePath, '')
  assert.equal(canceled.hideLoadingCount, 1)

  const hidden = createHarness({ theme: 'light', deferDraw: true })
  const hiddenSetup = createControllerPage(hidden)
  hiddenSetup.themeMethods.generateResultReportImage.call(hiddenSetup.page)
  hidden.page._pageVisible = false
  hidden.pendingDraw()
  assert.equal(hidden.exportCount, 0, 'hidden page must not export after delayed draw')
  assert.equal(hidden.page.data.isGeneratingResultReport, false, 'hidden stale generation must finish its loading state')
  assert.equal(hidden.hideLoadingCount, 1)
  assert.equal(hidden.page.data.resultReportImagePath, '')
}

function testLateThemeCallbackAndPreviewReturn() {
  const late = createHarness({ theme: 'light', deferExport: true })
  const lateSetup = createControllerPage(late)
  lateSetup.themeMethods.generateResultReportImage.call(lateSetup.page)
  assert.equal(late.exportCount, 1)
  late.theme = 'dark'
  late.pendingExport.success({ tempFilePath: 'temp://late-light.png' })
  assert.equal(late.page.data.resultReportImagePath, '', 'late old-theme export must not publish')
  assert.equal(late.page._resultReportImageTheme, undefined)
  assert.equal(late.page.resultReportSignature, '')
  assert.equal(late.page.data.isGeneratingResultReport, false)
  assert.equal(late.hideLoadingCount, 1)

  const returned = createHarness({ theme: 'light' })
  const returnedSetup = createControllerPage(returned)
  returnedSetup.themeMethods.generateResultReportImage.call(returnedSetup.page)
  const imagePath = returned.page.data.resultReportImagePath
  assert.equal(nativeImagePreview.preview(returned.page, imagePath, () => {}, undefined, global.wx), true)
  assert.equal(nativeImagePreview.onHide(returned.page), true)
  returned.page._pageVisible = false
  returned.page.cancelResultReportImageGeneration()
  returned.theme = 'dark'
  assert.equal(nativeImagePreview.onShow(returned.page), true)
  returned.page._pageVisible = true
  assert.equal(returned.page.data.resultReportPreviewVisible, true, 'returning from original preview preserves the report sheet')
  assert.equal(returned.page.data.resultReportImagePath, imagePath, 'original PNG path remains available on return')
  assert.equal(returned.page._resultReportImageTheme, 'light', 'image cache records its render-time theme')

  returnedSetup.themeMethods.generateResultReportImage.call(returned.page)
  assert.equal(returned.exportCount, 2, 'next generation after returning must use the new system theme')
  assert.equal(returned.page._resultReportImageTheme, 'dark')
}

function testCanvasFailuresAndMissingWx() {
  const createFailure = createHarness({ failCreate: true })
  const createSetup = createControllerPage(createFailure)
  createSetup.themeMethods.generateResultReportImage.call(createSetup.page)
  assert.equal(createFailure.page.data.isGeneratingResultReport, false)
  assert.equal(createFailure.page.resultReportPendingSignature, '')
  assert.equal(createFailure.hideLoadingCount, 1)
  assert.equal(createFailure.toasts[createFailure.toasts.length - 1].title, '图片生成失败，请重试')

  const exportFailure = createHarness({ failExport: true })
  const exportSetup = createControllerPage(exportFailure)
  exportSetup.themeMethods.generateResultReportImage.call(exportSetup.page)
  assert.equal(exportFailure.page.data.isGeneratingResultReport, false)
  assert.equal(exportFailure.page.resultReportPendingSignature, '')
  assert.equal(exportFailure.hideLoadingCount, 1)
  assert.equal(exportFailure.toasts[exportFailure.toasts.length - 1].title, '图片生成失败，请重试')
  assert.equal(exportFailure.page.data.resultReportImagePath, '')

  const unavailable = createHarness()
  const unavailableSetup = createControllerPage(unavailable)
  global.wx = { showToast: (value) => unavailable.toasts.push(value) }
  unavailableSetup.themeMethods.generateResultReportImage.call(unavailableSetup.page)
  assert.equal(unavailable.page.data.isGeneratingResultReport, false)
  assert.equal(unavailable.showLoadingCount, 0)
  assert.equal(unavailable.toasts[unavailable.toasts.length - 1].title, '当前微信版本暂不支持生成图片')
}

try {
  testThemeImplementationUsesExistingUiModule()
  testThemeGetterAndFacade()
  testThemeCacheAndContentSignature()
  testCancellationAndHiddenCallback()
  testLateThemeCallbackAndPreviewReturn()
  testCanvasFailuresAndMissingWx()
  console.log('DMX themed result report controller checks passed')
} finally {
  Date.now = originalDateNow
  global.wx = originalWx
  global.getCurrentPages = originalGetCurrentPages
}

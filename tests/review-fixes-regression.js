const assert = require('assert/strict')
const fs = require('fs')

function fresh(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

const storage = new Map()
let storageFailure = false
global.wx = {
  getStorageSync: (key) => {
    const value = storage.get(key)
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
  },
  setStorageSync: (key, value) => {
    if (storageFailure) throw new Error('storage unavailable')
    storage.set(key, value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value)
  },
  removeStorageSync: (key) => storage.delete(key),
}

const preferences = fresh('../utils/preferences')
assert.deepEqual(preferences.writePreferencesDetailed('review', { value: 1 }), { ok: true, changed: true })
assert.deepEqual(preferences.writePreferencesDetailed('review', { value: 1 }), { ok: true, changed: false })
storageFailure = true
assert.deepEqual(preferences.writePreferencesDetailed('review', { value: 2 }), { ok: false, changed: false })
assert.equal(preferences.writePreferences('review', { value: 2 }), false)
storageFailure = false
assert.equal(preferences.writePreferences('review', { value: 2 }), true)
assert.equal(preferences.writePreferences('review', { value: 2 }), false)

const products = fresh('../utils/products')
const speaker = products.getProductList('speaker')[0]
const amplifier = products.getProductList('amplifier')[0]
const fixture = products.getProductList('lighting')
  .map((item) => products.getProductDetail('lighting', item.model))
  .find((item) => item.categoryKey === 'fixture' && Array.isArray(item.channelModes) && item.channelModes.length > 0)
assert(fixture, '专项测试未找到真实 DMX 灯具样本')
storage.set(products.RECENT_STORAGE_KEY, [
  null,
  {},
  { type: 'speaker', model: speaker.model, viewedAt: 1 },
  { type: 'speaker', model: 'unknown-model', viewedAt: 2 },
  { type: 'invalid', model: speaker.model, viewedAt: 3 },
  { type: 'amplifier', model: amplifier.model, viewedAt: 4 },
  { type: 'speaker', model: '', viewedAt: 5 },
])
assert.deepEqual(products.getRecentProducts('speaker').map((item) => item.model), [speaker.model])
assert.deepEqual(products.getRecentProducts('amplifier').map((item) => item.model), [amplifier.model])
const favoriteKey = 'audioTool.records.v1'
const projectKey = 'audioTool.projects.v1'
storage.set(favoriteKey, [{ id: 'favorite' }])
storage.set(projectKey, [{ id: 'project' }])
const recentModels = products.getProductList('speaker').slice(0, 13).map((item) => item.model)
storage.set(products.RECENT_STORAGE_KEY, [null, { type: 'speaker', model: recentModels[0], viewedAt: 1 }])
recentModels.forEach((model) => products.markProductViewed('speaker', model))
const markedRecent = storage.get(products.RECENT_STORAGE_KEY)
assert.equal(markedRecent.length, 12)
assert.deepEqual(markedRecent.map((item) => item.model), recentModels.slice(1).reverse().concat(recentModels[0]).slice(0, 12))
assert.deepEqual(storage.get(favoriteKey), [{ id: 'favorite' }])
assert.deepEqual(storage.get(projectKey), [{ id: 'project' }])
storage.delete(favoriteKey)
storage.delete(projectKey)

let productDetailPage
const navigations = []
const toastTitles = []
global.Page = (config) => {
  productDetailPage = config
  productDetailPage.data = { ...config.data }
  productDetailPage.setData = function setData(changes, callback) {
    this.data = { ...this.data, ...changes }
    if (callback) callback()
  }
}
global.wx.navigateTo = ({ url }) => navigations.push(url)
global.wx.showToast = ({ title }) => toastTitles.push(title)
global.wx.setNavigationBarTitle = () => {}
fresh('../pages/products/detail')
const calculatorCases = [
  ['limiter', products.getProductDetail('speaker', speaker.model)],
  ['limiter', products.getProductDetail('amplifier', amplifier.model)],
  ['spl', products.getProductDetail('speaker', speaker.model)],
  ['camera', products.getProductDetail('camera', products.getProductList('camera')[0].model)],
  ['dmxAddress', fixture],
]

function checkDmxDestinationImport(url, detail) {
  const [destinationPath, queryString = ''] = url.split('?')
  assert.equal(destinationPath, '/pages/dmx-address/dmx-address')
  const options = Object.fromEntries(new URLSearchParams(queryString))
  assert.deepEqual(options, { lightingCatalogImport: '1' }, 'DMX import route carries the exact destination flag')

  const previousPage = global.Page
  const lightingWorkspace = fresh('../pages/dmx-layout/lighting-workspace')
  const originalImport = lightingWorkspace.importLegacyLightingPreferences
  let importCount = 0
  let destinationPage
  lightingWorkspace.importLegacyLightingPreferences = (...args) => {
    importCount += 1
    return originalImport(...args)
  }

  try {
    global.Page = (definition) => {
      destinationPage = { ...definition, data: { ...definition.data } }
    }
    fresh('../pages/dmx-address/dmx-address')
    destinationPage.setData = function setData(patch, callback) {
      this.data = { ...this.data, ...patch }
      if (callback) callback()
    }
    destinationPage.onLoad(options)

    assert.equal(importCount, 1, 'destination onLoad consumes the import flag once')
    assert.equal(destinationPage._contextId, lightingWorkspace.TEMPORARY_CONTEXT_ID)
    assert.equal(destinationPage.data.currentContextTemporary, true)
    const importedPreferences = storage.get('audioTool.dmxAddress.preferences')
    assert.equal(destinationPage.data.startAddressText, importedPreferences.startAddressText || '1')
    assert.equal(destinationPage.data.allocationMode, importedPreferences.allocationMode === 'manual' ? 'manual' : 'auto')
    assert.equal(destinationPage.data.groups.length, 1, 'destination restores the imported fixture group')
    assert.equal(destinationPage.data.groups[0].fixtureModel, detail.model)
    assert.equal(destinationPage.data.groups[0].channelCount, String(detail.channelModes[0]))
    assert.equal(destinationPage.data.groups[0].fixtureCount, '1')

    const firstGroupCount = destinationPage.data.groups.length
    destinationPage.onShow()
    destinationPage.onShow()
    assert.equal(importCount, 1, 'repeated show does not re-import legacy preferences')
    assert.equal(destinationPage.data.groups.length, firstGroupCount, 'repeated show does not duplicate the imported group')
    assert.equal(destinationPage.data.groups[0].fixtureModel, detail.model)
  } finally {
    lightingWorkspace.importLegacyLightingPreferences = originalImport
    global.Page = previousPage
  }
}

calculatorCases.forEach(([module, detail]) => {
  if (module === 'dmxAddress') storage.delete('audioTool.dmxAddress.preferences')
  productDetailPage._productDetail = detail
  storageFailure = false
  productDetailPage.openCalculator({ currentTarget: { dataset: { module } } })
  if (module === 'dmxAddress') {
    assert.equal(productDetailPage.data.dmxImportVisible, true, 'DMX 带入先打开确认面板')
    productDetailPage.selectDmxImportMode({
      currentTarget: { dataset: { channelCount: String(detail.channelModes[0]) } },
    })
    productDetailPage.confirmDmxProductImport()
    checkDmxDestinationImport(navigations[navigations.length - 1], detail)
  }
  const navigationCount = navigations.length
  const storedPreferences = storage.get({
    limiter: 'audioTool.limiter.preferences',
    spl: 'audioTool.spl.preferences',
    camera: 'audioTool.camera.preferences',
    dmxAddress: 'audioTool.dmxAddress.preferences',
  }[module])
  assert.equal(navigations[navigations.length - 1], {
    limiter: '/pages/limiter/limiter',
    spl: '/pages/spl/spl',
    camera: '/pages/camera/camera',
    dmxAddress: '/pages/dmx-address/dmx-address?lightingCatalogImport=1',
  }[module])
  if (module === 'limiter') {
    assert.equal(storedPreferences[detail.type === 'amplifier' ? 'amplifierModel' : 'speakerModel'], detail.model)
  } else if (module === 'spl') assert.equal(storedPreferences.speakerModel, detail.model)
  else if (module === 'camera') assert.equal(storedPreferences.cameraModel, detail.model)
  else {
    assert.equal(storedPreferences.groups[0].fixtureModel, detail.model)
    assert.equal(storedPreferences.groups[0].channelCount, String(detail.channelModes[0]))
  }
  productDetailPage.openCalculator({ currentTarget: { dataset: { module } } })
  if (module === 'dmxAddress') {
    assert.equal(productDetailPage.data.dmxImportVisible, true)
    productDetailPage.selectDmxImportMode({
      currentTarget: { dataset: { channelCount: String(detail.channelModes[0]) } },
    })
    productDetailPage.selectDmxImportAction({ currentTarget: { dataset: { action: 'append' } } })
    productDetailPage.confirmDmxProductImport()
  }
  assert.equal(navigations.length, navigationCount + 1, `${module} 未变化偏好不应阻止导航`)
  storageFailure = true
  const failedNavigationCount = navigations.length
  const beforeFailedWrite = JSON.stringify(storage.get({
    limiter: 'audioTool.limiter.preferences', spl: 'audioTool.spl.preferences',
    camera: 'audioTool.camera.preferences', dmxAddress: 'audioTool.dmxAddress.preferences',
  }[module]))
  productDetailPage._productDetail = {
    ...detail,
    model: `${detail.model}-changed-for-review`,
  }
  productDetailPage.openCalculator({ currentTarget: { dataset: { module } } })
  if (module === 'dmxAddress') {
    productDetailPage.selectDmxImportMode({
      currentTarget: { dataset: { channelCount: String(detail.channelModes[0]) } },
    })
    productDetailPage.selectDmxImportAction({ currentTarget: { dataset: { action: 'append' } } })
    productDetailPage.confirmDmxProductImport()
  }
  assert.equal(navigations.length, failedNavigationCount, `${module} 写入失败后仍然导航`)
  assert.equal(JSON.stringify(storage.get({
    limiter: 'audioTool.limiter.preferences', spl: 'audioTool.spl.preferences',
    camera: 'audioTool.camera.preferences', dmxAddress: 'audioTool.dmxAddress.preferences',
  }[module])), beforeFailedWrite, `${module} 写入失败改变了偏好存储`)
  if (module === 'dmxAddress') {
    assert.equal(productDetailPage.data.dmxImportVisible, true, 'DMX 写入失败时保留确认面板')
    assert.equal(productDetailPage.data.dmxImportChannelCount, String(detail.channelModes[0]))
    assert.equal(productDetailPage.data.dmxImportAction, 'append')
    assert.match(productDetailPage.data.dmxImportError, /保存失败/)
  } else assert.equal(toastTitles.at(-1), '设置保存失败，请重试')
  storageFailure = false
  if (module === 'dmxAddress') productDetailPage.confirmDmxProductImport()
  else productDetailPage.openCalculator({ currentTarget: { dataset: { module } } })
  assert.equal(navigations.length, failedNavigationCount + 1, `${module} 写入失败后无法重试`)
})

let reportDrawnText = []

function reportContext() {
  return new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (value) => ({ width: String(value).length * 12 })
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      if (key === 'fillText') return (value) => reportDrawnText.push(String(value))
      return () => {}
    },
  })
}

function checkLateReportCallbacks(modulePath, loadMethod, generateMethod, canvasId, pageSetup, options = {}) {
  let page
  const exports = []
  let setDataCount = 0
  let hideLoadingCount = 0
  global.Page = (config) => { page = config }
  global.wx.createCanvasContext = (id) => {
    assert.equal(id, canvasId)
    return reportContext()
  }
  global.wx.canvasToTempFilePath = (options) => { exports.push(options) }
  global.wx.showLoading = () => {}
  global.wx.hideLoading = () => { hideLoadingCount += 1 }
  fresh(modulePath)
  page.setData = (changes, callback) => {
    setDataCount += 1
    page.data = { ...page.data, ...changes }
    if (callback) callback()
  }
  const loadArgs = pageSetup(page)
  page[loadMethod](...(loadArgs || []))
  if (options.trigger) options.trigger(page)
  else page[generateMethod]()
  assert(exports[0], `${modulePath} 未创建导出请求`)
  options.verifyExportRequest?.(exports[0], page)
  const toastCount = toastTitles.length
  const oldCallbackSetDataCount = setDataCount
  page.onUnload()
  const oldCallbackHideLoadingCount = hideLoadingCount
  const oldPage = page
  exports[0].fail({ errMsg: 'late failure' })
  exports[0].success({ tempFilePath: 'temp://late-success.png' })
  assert.equal(toastTitles.length, toastCount, `${modulePath} 卸载后迟到失败仍提示`)
  assert.equal(oldPage.data.isGeneratingReport, true, `${modulePath} 迟到回调改写了页面状态`)
  assert.equal(setDataCount, oldCallbackSetDataCount, `${modulePath} 卸载后迟到回调调用了 setData`)
  assert.equal(hideLoadingCount, oldCallbackHideLoadingCount, `${modulePath} 卸载后迟到回调隐藏了 loading`)

  global.Page = (config) => { page = config }
  fresh(modulePath)
  page.setData = (changes, callback) => {
    setDataCount += 1
    page.data = { ...page.data, ...changes }
    if (callback) callback()
  }
  const newLoadArgs = pageSetup(page)
  page[loadMethod](...(newLoadArgs || []))
  if (options.trigger) options.trigger(page)
  else page[generateMethod]()
  assert(exports[1], `${modulePath} 未创建新导出请求`)
  options.verifyExportRequest?.(exports[1], page)
  const newGeneratingState = page.data.isGeneratingReport
  const newPath = page.data.reportImagePath
  const newToastCount = toastTitles.length
  const oldDuringNewSetDataCount = setDataCount
  const oldDuringNewHideLoadingCount = hideLoadingCount
  exports[0].fail({ errMsg: 'old failure during new request' })
  exports[0].success({ tempFilePath: 'temp://old-success-during-new.png' })
  assert.equal(page.data.isGeneratingReport, newGeneratingState)
  assert.equal(page.data.reportImagePath, newPath)
  assert.equal(toastTitles.length, newToastCount)
  assert.equal(setDataCount, oldDuringNewSetDataCount, `${modulePath} 新请求进行中旧回调调用了 setData`)
  assert.equal(hideLoadingCount, oldDuringNewHideLoadingCount, `${modulePath} 新请求进行中旧回调隐藏了 loading`)
  exports[1].success({ tempFilePath: 'temp://current-success.png' })
  assert.equal(page.data.isGeneratingReport, false, `${modulePath} 当前成功未结束生成状态`)
  assert.equal(page.data.reportImagePath, 'temp://current-success.png')
  assert.equal(page.data.reportPreviewVisible, true, `${modulePath} 当前成功未显示预览`)

  page.data.reportImagePath = ''
  page.data.reportPreviewVisible = false
  page.reportSignature = ''
  if (options.trigger) options.trigger(page)
  else page[generateMethod]()
  assert(exports[2], `${modulePath} 未创建当前失败请求`)
  options.verifyExportRequest?.(exports[2], page)
  const currentToastCount = toastTitles.length
  exports[2].fail({ errMsg: 'current failure' })
  assert.equal(toastTitles.length, currentToastCount + 1, `${modulePath} 当前失败未提示`)
  assert.equal(page.data.isGeneratingReport, false, `${modulePath} 当前失败未恢复按钮状态`)

  if (options.cancelOnHide) {
    page.data.reportImagePath = ''
    page.data.reportPreviewVisible = false
    page.reportSignature = ''
    const cancelIndex = exports.length
    assert.equal(options.trigger(page), true, `${modulePath} 隐藏取消前无法启动导出`)
    assert(exports[cancelIndex], `${modulePath} 隐藏取消未创建异步导出请求`)
    options.verifyExportRequest?.(exports[cancelIndex], page)
    assert.equal(page.data.isGeneratingReport, true, `${modulePath} 隐藏取消场景未处于生成中`)
    const requestRevision = page.reportRevision
    page.onHide()
    assert.equal(page._pageVisible, false, `${modulePath} onHide 未标记页面隐藏`)
    assert.equal(page.reportRevision > requestRevision, true, `${modulePath} 隐藏时未使进行中的导出失效`)
    const afterHide = {
      isGeneratingReport: page.data.isGeneratingReport,
      reportImagePath: page.data.reportImagePath,
      reportPreviewVisible: page.data.reportPreviewVisible,
      reportPreviewError: page.data.reportPreviewError,
      setDataCount,
      hideLoadingCount,
      toastCount: toastTitles.length,
    }
    exports[cancelIndex].success({ tempFilePath: 'temp://hidden-late-success.png' })
    exports[cancelIndex].fail({ errMsg: 'hidden-late-failure' })
    assert.deepEqual({
      isGeneratingReport: page.data.isGeneratingReport,
      reportImagePath: page.data.reportImagePath,
      reportPreviewVisible: page.data.reportPreviewVisible,
      reportPreviewError: page.data.reportPreviewError,
      setDataCount,
      hideLoadingCount,
      toastCount: toastTitles.length,
    }, afterHide, `${modulePath} 隐藏后迟到导出回调改变了页面状态`)
  }
}

const ledScreenWxml = fs.readFileSync(require.resolve('../pages/led-screen/led-screen.wxml'), 'utf8')
assert(ledScreenWxml.includes('bindtap="openSharePreview"'), 'LED 页面 WXML 不再由分享入口触发方案图片生成')
checkLateReportCallbacks(
  '../pages/led-screen/led-screen', 'onLoad', 'generateReportImage', 'ledScreenReportCanvas',
  () => {},
  {
    trigger(page) {
      page.onShow()
      reportDrawnText = []
      return page.openSharePreview()
    },
    verifyExportRequest(request, page) {
      assert.equal(request.canvasId, 'ledScreenReportCanvas')
      assert.equal(request.width, 750)
      assert.equal(request.height, page.data.reportCanvasHeight)
      assert(Number.isInteger(request.height) && request.height > 0, 'LED report export height is invalid')
      assert.equal(request.fileType, 'png')
      assert.equal(request.quality, 1)
      assert(reportDrawnText.includes('LED 大屏尺寸方案'), 'LED report draw omitted the report title payload')
      assert(reportDrawnText.includes(page.data.result.dimensionText), 'LED report draw omitted the current calculated dimensions')
      assert(reportDrawnText.includes(`墙体 ${page.data.wallWidthText} × ${page.data.wallHeightText} m`),
        'LED report draw omitted the current wall-input payload')
    },
    cancelOnHide: true,
  },
)

const drawing = fresh('../utils/report-drawing')
const calls = []
const context = {
  beginPath: () => calls.push('beginPath'),
  moveTo: (...args) => calls.push(['moveTo', ...args]),
  lineTo: (...args) => calls.push(['lineTo', ...args]),
  quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
  closePath: () => calls.push('closePath'),
  setFillStyle: (value) => calls.push(['fill', value]),
  fill: () => calls.push('fill'),
  setTextAlign: (value) => calls.push(['align', value]),
  fillText: (...args) => calls.push(['text', ...args]),
  measureText: (value) => ({ width: [...String(value)].length }),
}
drawing.roundedRect(context, 0, 0, 10, 4, 20, '#fff')
drawing.drawText(context, 123, 2, 3, 12)
assert.equal(calls.some((call) => Array.isArray(call) && call[1] === '#1d1d1f'), true)
assert.deepEqual(drawing.splitText(context, 'abcdef', 3, 2), ['abc', 'def'])

console.log('审查修复回归通过：偏好写入三态、产品最近记录净化及共享报告绘图基础均正常。')

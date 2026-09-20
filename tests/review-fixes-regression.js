const assert = require('assert/strict')

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

let productDetailPage
const navigations = []
const toastTitles = []
global.Page = (config) => { productDetailPage = config }
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
calculatorCases.forEach(([module, detail]) => {
  productDetailPage._productDetail = detail
  storageFailure = false
  productDetailPage.openCalculator({ currentTarget: { dataset: { module } } })
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
    dmxAddress: '/pages/dmx-address/dmx-address',
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
  assert.equal(navigations.length, failedNavigationCount, `${module} 写入失败后仍然导航`)
  assert.equal(JSON.stringify(storage.get({
    limiter: 'audioTool.limiter.preferences', spl: 'audioTool.spl.preferences',
    camera: 'audioTool.camera.preferences', dmxAddress: 'audioTool.dmxAddress.preferences',
  }[module])), beforeFailedWrite, `${module} 写入失败改变了偏好存储`)
  assert.equal(toastTitles.at(-1), '设置保存失败，请重试')
  storageFailure = false
  productDetailPage.openCalculator({ currentTarget: { dataset: { module } } })
  assert.equal(navigations.length, failedNavigationCount + 1, `${module} 写入失败后无法重试`)
})

function reportContext() {
  return new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return (value) => ({ width: String(value).length * 12 })
      if (key === 'draw') return (reserve, callback) => {
        const done = typeof reserve === 'function' ? reserve : callback
        if (done) done()
      }
      return () => {}
    },
  })
}

function checkLateReportCallbacks(modulePath, loadMethod, generateMethod, canvasId, pageSetup) {
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
  page[generateMethod]()
  assert(exports[0], `${modulePath} 未创建导出请求`)
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
  page[generateMethod]()
  assert(exports[1], `${modulePath} 未创建新导出请求`)
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
  page[generateMethod]()
  assert(exports[2], `${modulePath} 未创建当前失败请求`)
  const currentToastCount = toastTitles.length
  exports[2].fail({ errMsg: 'current failure' })
  assert.equal(toastTitles.length, currentToastCount + 1, `${modulePath} 当前失败未提示`)
  assert.equal(page.data.isGeneratingReport, false, `${modulePath} 当前失败未恢复按钮状态`)
}

checkLateReportCallbacks(
  '../pages/led-screen/led-screen', 'onLoad', 'generateReportImage', 'ledScreenReportCanvas',
  () => {},
)

const recordsApi = fresh('../utils/records')
const reviewProject = recordsApi.createProject('审查回归项目')
recordsApi.addRecordToProject({
  module: 'limiter',
  title: '审查记录',
  summary: '用于导出失败回归',
  preferences: { speakerModel: speaker.model },
  resultText: '限幅器计算结果',
}, reviewProject.id)
checkLateReportCallbacks(
  '../pages/records/project', 'onLoad', 'generateProjectReportImage', 'projectReportCanvas',
  () => [{ id: reviewProject.id }],
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

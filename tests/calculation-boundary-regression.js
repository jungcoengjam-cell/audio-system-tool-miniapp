const assert = require('assert/strict')

const originalPage = global.Page
const originalWx = global.wx

function fresh(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function installPage(modulePath) {
  let page
  global.Page = (config) => { page = config }
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    setNavigationBarTitle: () => {},
    ...global.wx,
  }
  fresh(modulePath)
  page.data = clone(page.data)
  page.setData = (changes, callback) => {
    Object.entries(changes).forEach(([key, value]) => {
      const match = key.match(/^([^\[]+)\[(\d+)\]\.(.+)$/)
      if (!match) {
        page.data[key] = value
        return
      }
      const [, collection, index, property] = match
      page.data[collection][Number(index)] = {
        ...page.data[collection][Number(index)],
        [property]: value,
      }
    })
    if (callback) callback()
  }
  return page
}


function calculateLed(input = {}) {
  const { calculateLedScreenPlan } = require('../utils/led-screen')
  return calculateLedScreenPlan({
    wallWidthMeters: '6',
    wallHeightMeters: '3',
    topReserveMeters: '0.2',
    bottomReserveMeters: '0.2',
    frameWidthMeters: '0.05',
    viewingDistanceMeters: '3',
    aspectRatioKey: '16:9',
    unitKey: 'module',
    pixelPitch: 'recommended',
    ...input,
  })
}

try {
  ;['topReserveMeters', 'bottomReserveMeters', 'frameWidthMeters'].forEach((field) => {
    ;['', '   '].forEach((value) => {
      const result = calculateLed({ [field]: value })
      assert.match(result.error, /请填写有效的/)
    })
    const negative = calculateLed({ [field]: '-0.1' })
    assert.match(negative.error, /不能小于 0/)
  })
  ;[0, '0', ' 0 '].forEach((value) => {
    assert.equal(calculateLed({ topReserveMeters: value }).error, undefined)
    assert.equal(calculateLed({ bottomReserveMeters: value }).error, undefined)
    assert.equal(calculateLed({ frameWidthMeters: value }).error, undefined)
  })
  assert.equal(calculateLed({ frameWidthMeters: undefined }).frameWidthMeters, 0.05)

  // LED-page input -> blur follows the same invalid-result clearing and recovery contract.
  const ledPage = installPage('../pages/led-screen/led-screen')
  ledPage.onLoad()
  assert(ledPage.data.result)
  ledPage.data.reportImagePath = 'temp://old-led-report.png'
  ledPage.data.reportPreviewVisible = true
  ledPage.data.isGeneratingReport = true
  ledPage.reportSignature = 'old-led-report'
  ledPage.reportPendingSignature = 'old-led-report'
  ledPage.onFieldInput({ currentTarget: { dataset: { field: 'topReserveText' } }, detail: { value: '' } })
  ledPage.onFieldBlur()
  assert.equal(ledPage.data.result, null)
  assert.match(ledPage.data.inputError, /请填写有效的上方预留空间/)
  assert.equal(ledPage.data.reportImagePath, '')
  assert.equal(ledPage.data.reportPreviewVisible, false)
  assert.equal(ledPage.data.isGeneratingReport, false)
  assert.equal(ledPage.reportSignature, '')
  assert.equal(ledPage.reportPendingSignature, '')
  ledPage.onFieldInput({ currentTarget: { dataset: { field: 'topReserveText' } }, detail: { value: '0' } })
  ledPage.onFieldBlur()
  assert(ledPage.data.result)
  assert.equal(ledPage.data.inputError, '')
  ledPage.onFieldInput({ currentTarget: { dataset: { field: 'frameWidthText' } }, detail: { value: '' } })
  ledPage.onFieldBlur()
  assert.equal(ledPage.data.result, null)
  assert.match(ledPage.data.inputError, /请填写有效的四周包边尺寸/)
  ledPage.onFieldInput({ currentTarget: { dataset: { field: 'frameWidthText' } }, detail: { value: '5' } })
  ledPage.onFieldBlur()
  assert(ledPage.data.result)
  ledPage.onUnload()
  assert.equal(ledPage.inputCalculationTimer, null)

  console.log('calculation boundary regression PASS')
} finally {
  global.Page = originalPage
  global.wx = originalWx
}

const assert = require('assert')

const previousWx = global.wx
const previousPage = global.Page
const previousGetCurrentPages = global.getCurrentPages
let activePages = []
const vibrationTypes = []
const saveCalls = []
const shareCalls = []
const drawCallbacks = []
const exportCalls = []

global.getCurrentPages = () => activePages
global.wx = {
  vibrateShort: ({ type }) => vibrationTypes.push(type),
  showToast() {},
  showLoading() {},
  hideLoading() {},
  showShareImageMenu: (options) => shareCalls.push(options),
  saveImageToPhotosAlbum: (options) => saveCalls.push(options),
  createCanvasContext() {
    return new Proxy({}, {
      get: (target, key) => key === 'draw'
        ? (...args) => drawCallbacks.push(args.find((item) => typeof item === 'function'))
        : key === 'measureText' ? () => ({ width: 40 }) : () => {},
    })
  },
  canvasToTempFilePath: (options) => exportCalls.push(options),
}

function checkImageActionFeedback() {
  const actions = require('../utils/report-image-actions')
  const page = { _pageVisible: true }
  const otherPage = {}
  activePages = [page]

  assert.strictEqual(actions.shareGeneratedImage('temp://share.png'), true)
  assert.strictEqual(vibrationTypes.length, 0, 'opening the system share menu has no app haptic')
  shareCalls[0].fail({ errMsg: 'cancel' })
  assert.strictEqual(vibrationTypes.length, 0, 'share cancellation stays silent')

  assert.strictEqual(actions.saveGeneratedImage('temp://saved.png'), true)
  assert.strictEqual(vibrationTypes.length, 0, 'photo save does not vibrate before success')
  saveCalls[0].success()
  assert.deepStrictEqual(vibrationTypes, ['medium'], 'photo save success vibrates once')

  assert.strictEqual(actions.saveGeneratedImage('temp://failed.png'), true)
  saveCalls[1].fail({ errMsg: 'save failed' })
  assert.deepStrictEqual(vibrationTypes, ['medium'], 'photo save failure stays silent')

  assert.strictEqual(actions.saveGeneratedImage('temp://stale.png'), true)
  activePages = [otherPage]
  saveCalls[2].success()
  assert.deepStrictEqual(vibrationTypes, ['medium'], 'late photo-save callback cannot vibrate a different page')
}

function checkResultReportFeedback() {
  const controller = require('../utils/result-report-controller')
  const page = {
    data: { ...controller.createResultReportData() },
    resultReportRevision: 0,
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      if (callback) callback()
    },
    getRecordPayload() {
      return { module: 'limiter', title: 'test', summary: 'test', resultText: '结果：正常' }
    },
  }
  Object.assign(page, controller.createResultReportMethods())
  activePages = [page]

  page.generateResultReportImage()
  assert.deepStrictEqual(vibrationTypes, ['medium'], 'report generation does not vibrate before export success')
  drawCallbacks[0]()
  exportCalls[0].success({ tempFilePath: 'temp://report.png' })
  assert.deepStrictEqual(vibrationTypes, ['medium', 'medium'], 'current successful report generation vibrates once')

  page.data.resultReportImagePath = ''
  page.resultReportSignature = ''
  page.generateResultReportImage()
  drawCallbacks[1]()
  exportCalls[1].fail()
  assert.deepStrictEqual(vibrationTypes, ['medium', 'medium'], 'report generation failure stays silent')

  page.data.resultReportImagePath = ''
  page.resultReportSignature = ''
  page.generateResultReportImage()
  drawCallbacks[2]()
  const otherPage = {}
  activePages = [otherPage]
  exportCalls[2].success({ tempFilePath: 'temp://hidden-report.png' })
  assert.strictEqual(page.data.resultReportImagePath, 'temp://hidden-report.png', 'the existing generation completion still updates while another page is on top')
  assert.deepStrictEqual(vibrationTypes, ['medium', 'medium'], 'a hidden-page completion does not vibrate')

  activePages = [page]
  page.data.resultReportPreviewVisible = false
  page.generateResultReportImage()
  assert.deepStrictEqual(vibrationTypes, ['medium', 'medium', 'light'], 'opening a cached report preview vibrates on a real visibility change')
  page.generateResultReportImage()
  assert.deepStrictEqual(vibrationTypes, ['medium', 'medium', 'light'], 'reopening an already-visible cached preview stays silent')
}

function checkHighFrequencyPathsStayQuiet() {
  const fs = require('fs')
  const path = require('path')
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const dmxAddress = read('pages/dmx-address/dmx-address.js')
  const limiter = read('pages/limiter/limiter.js')
  const quantityStart = dmxAddress.indexOf('adjustBatchQuantity(event)')
  const quantityEnd = dmxAddress.indexOf('\nconfirmBatchAdd()', quantityStart)
  const quantityHandler = dmxAddress.slice(quantityStart, quantityEnd)
  assert(!quantityHandler.includes('vibrate('), 'repeated batch quantity steps stay quiet')
  const shareStart = limiter.indexOf('shareResultReportImage()')
  const shareEnd = limiter.indexOf('\n  openCalculationDetails(event)', shareStart)
  const shareHandler = limiter.slice(shareStart, shareEnd)
  assert(!shareHandler.includes("vibrate('medium')"), 'opening the native image share menu stays quiet')
}

try {
  checkImageActionFeedback()
  checkResultReportFeedback()
  checkHighFrequencyPathsStayQuiet()
  console.log('Calculator haptics regression checks passed')
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  if (previousGetCurrentPages === undefined) delete global.getCurrentPages
  else global.getCurrentPages = previousGetCurrentPages
}

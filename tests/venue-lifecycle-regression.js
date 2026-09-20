const assert = require('node:assert/strict')

const originalPage = global.Page
const originalWx = global.wx
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout
let pageDefinition
let timerId = 0
const timers = new Map()
const selectorCallbacks = []
const canvasDrawCallbacks = []
const canvasEvents = []
const exportsPending = []

global.Page = (definition) => { pageDefinition = definition }
global.setTimeout = (callback, delay) => {
  const id = ++timerId
  timers.set(id, { callback, delay })
  return id
}
global.clearTimeout = (id) => timers.delete(id)
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync() {},
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange() {},
  offThemeChange() {},
  vibrateShort() {},
  showToast() {},
  showLoading() {},
  hideLoading() {},
  nextTick(callback) { callback() },
  createSelectorQuery() {
    const query = {
      select() { return this },
      boundingClientRect(callback) { selectorCallbacks.push(callback); return this },
      exec() {},
    }
    return query
  },
  createCanvasContext(id) {
    canvasEvents.push({ type: 'create', id })
    return {
      clearRect() { canvasEvents.push({ type: 'clear', id }) },
      draw(_reserve, callback) {
        canvasEvents.push({ type: 'draw', id })
        if (callback) canvasDrawCallbacks.push(callback)
      },
      measureText() { return { width: 40 } },
      setFillStyle() {}, setStrokeStyle() {}, setFontSize() {}, setTextAlign() {},
      fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, save() {}, restore() {}, arc() {}, closePath() {},
    }
  },
  canvasToTempFilePath(options) { exportsPending.push(options) },
}

delete require.cache[require.resolve('../pages/venue/venue')]
require('../pages/venue/venue')
const reportController = require('../utils/result-report-controller')

function createPage({ deferRender = false } = {}) {
  const page = { ...pageDefinition, data: JSON.parse(JSON.stringify(pageDefinition.data)) }
  page._pageVisible = false
  page.renderCallbacks = []
  page._setDataCalls = []
  page.setData = (changes, callback) => {
    page._setDataCalls.push(changes)
    for (const [key, value] of Object.entries(changes)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (const part of parts.slice(0, -1)) {
        if (!target[part]) target[part] = {}
        target = target[part]
      }
      target[parts.at(-1)] = value
    }
    if (callback) {
      if (deferRender) page.renderCallbacks.push(callback)
      else callback()
    }
  }
  return page
}

function preparePlan(page) {
  page.calculate({ sceneModeIndex: 1 })
  page._pageVisible = true
  page.isVenuePlanReady = true
  page.isVenuePlanMeasured = true
  page.data.showVenuePlan = true
  page.data.planImagePath = ''
  page.pendingVenuePlan = page.buildVenuePlanForResult(page.data.result)
  page.venuePlanResult = page.data.result
  return page.pendingVenuePlan
}

// Re-tapping the selected scene does not clear the visible plan; changing mode
// still recalculates and advances the plan revision.
{
  const page = createPage()
  preparePlan(page)
  const revision = page.venuePlanRevision
  const clearsBefore = canvasEvents.filter((event) => event.type === 'clear').length
  page.onSceneModeTap({ currentTarget: { dataset: { index: page.data.sceneModeIndex } } })
  assert.equal(canvasEvents.filter((event) => event.type === 'clear').length, clearsBefore)
  assert.equal(page.venuePlanRevision, revision)
  page.onSceneModeTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.result.kind, 'report')
  assert(page.venuePlanRevision > revision)
}

// Direct unload cancels report work and makes already queued draw/export callbacks inert.
{
  const page = createPage()
  Object.assign(page, reportController.createResultReportMethods())
  page.getRecordPayload = () => ({ module: 'venue', title: '会议室', summary: '测试', resultText: '测试结果' })
  page.buildResultReportRecord = page.getRecordPayload
  const originalCreateCanvasContext = global.wx.createCanvasContext
  let reportDraw
  global.wx.createCanvasContext = () => new Proxy({}, {
    get(_target, key) {
      if (key === 'draw') return (_reserve, callback) => { reportDraw = callback }
      if (key === 'measureText') return () => ({ width: 40 })
      return () => {}
    },
  })
  page.generateResultReportImage()
  assert(reportDraw)
  const beforeUnloadWrites = page.data.isGeneratingResultReport
  assert.equal(beforeUnloadWrites, true)
  page.onUnload()
  assert.equal(page.data.isGeneratingResultReport, false)
  assert.equal(page.resultReportPendingSignature, '')
  reportDraw()
  assert.equal(exportsPending.length, 0)
  assert.equal(page.data.resultReportImagePath, '')
  global.wx.createCanvasContext = originalCreateCanvasContext
}

// A positive selector measurement queued before hide cannot update hidden state.
{
  const page = createPage()
  preparePlan(page)
  page.isVenuePlanMeasured = false
  page.measureVenuePlanCanvas()
  const lateMeasurement = selectorCallbacks.pop()
  assert(lateMeasurement)
  page.onHide()
  const hiddenRevision = page.venuePlanRevision
  const writesAfterHide = page._setDataCalls.length
  lateMeasurement({ width: 390 })
  assert.equal(page.venuePlanRevision, hiddenRevision)
  assert.equal(page.data.planCanvasWidth, 320)
  assert.equal(page._setDataCalls.length, writesAfterHide)
}

// Export success after hide or closing the plan cannot clear the canvas or
// schedule a snapshot timer; reopening starts fresh work for the current epoch.
for (const transition of ['hide-show', 'close-reopen']) {
  const page = createPage()
  const plan = preparePlan(page)
  page.commitVenuePlanCanvas({ draw(_reserve, callback) { callback() } }, plan,
    page.venuePlanRevision, () => {}, {})
  const oldExport = exportsPending.pop()
  assert(oldExport)
  if (transition === 'hide-show') page.onHide()
  else page.toggleVenuePlan()
  const contextCount = canvasEvents.filter((event) => event.type === 'create').length
  oldExport.success({ tempFilePath: `temp://${transition}.png` })
  assert.equal(canvasEvents.filter((event) => event.type === 'create').length, contextCount)
  assert.equal(page.venuePlanSnapshotTimer, undefined)
  assert.equal(page.data.planImagePath, '')
  if (transition === 'hide-show') page.onShow()
  else page.toggleVenuePlan()
  const currentMeasurement = selectorCallbacks.pop()
  assert(currentMeasurement)
  currentMeasurement({ width: 320 })
  assert.notEqual(page.venuePlanRevision, 0)
}

// A delayed clear callback from an old export cannot cancel the fallback timer
// that belongs to a newly started export after the page becomes visible again.
{
  const page = createPage()
  const plan = preparePlan(page)
  page.commitVenuePlanCanvas({ draw(_reserve, callback) { callback() } }, plan,
    page.venuePlanRevision, () => {}, {})
  const oldExport = exportsPending.pop()
  oldExport.success({ tempFilePath: 'temp://old.png' })
  const oldClearCallback = canvasDrawCallbacks.pop()
  assert(oldClearCallback)
  const oldTimer = page.venuePlanSnapshotTimer

  page.onHide()
  page.onShow()
  page.commitVenuePlanCanvas({ draw(_reserve, callback) { callback() } }, plan,
    page.venuePlanRevision, () => {}, {})
  const newExport = exportsPending.pop()
  newExport.success({ tempFilePath: 'temp://new.png' })
  const newClearCallback = canvasDrawCallbacks.pop()
  const newTimer = page.venuePlanSnapshotTimer
  assert(newClearCallback)
  assert.notEqual(newTimer, oldTimer)

  oldClearCallback()
  assert.equal(page.venuePlanSnapshotTimer, newTimer)
  newClearCallback()
  assert.equal(page.data.planImagePath, 'temp://new.png')
}

// Active export still reveals normally, and a fresh measurement after hide can
// recover the plan without accepting callbacks from the previous epoch.
{
  const page = createPage()
  const plan = preparePlan(page)
  page.commitVenuePlanCanvas({ draw(_reserve, callback) { callback() } }, plan,
    page.venuePlanRevision, () => {}, {})
  const activeExport = exportsPending.pop()
  activeExport.success({ tempFilePath: 'temp://active.png' })
  canvasDrawCallbacks.pop()()
  assert.equal(page.data.planImagePath, 'temp://active.png')

  page.data.planImagePath = ''
  page.isVenuePlanMeasured = false
  page.onHide()
  page.onShow()
  const freshMeasurement = selectorCallbacks.pop()
  assert(freshMeasurement)
  freshMeasurement({ width: 320 })
  assert.equal(page.isVenuePlanMeasured, true)
  assert(timers.size > 0)
}

// Render callbacks may be deferred even though this.data changes immediately.
// When an invalid PAG edit replaces result, the pending plan must stay attached
// to the actual result object before the measurement callback runs.
{
  const page = createPage({ deferRender: true })
  preparePlan(page)
  page.data.discussionPagNagEnabled = true
  Object.assign(page.data, {
    discussionPagNagDsText: '1', discussionPagNagD0Text: '10',
    discussionPagNagDnText: '2', discussionPagNagD1Text: '3',
    discussionPagNagD2Text: '7', discussionPagNagNomText: '2',
  })
  page.calculate({ discussionPagNagEnabled: true })
  page.renderCallbacks.pop()?.()
  page.isVenuePlanMeasured = false
  page.measureVenuePlanCanvas()
  const measurement = selectorCallbacks.pop()
  assert(measurement)
  page.calculate({ discussionPagNagD0Text: '' })
  assert.equal(page.venuePlanResult, page.data.result)
  measurement({ width: 390 })
  assert.equal(page.data.planCanvasWidth, 390)
}

console.log('venue lifecycle regression PASS')

global.Page = originalPage
global.wx = originalWx
global.setTimeout = originalSetTimeout
global.clearTimeout = originalClearTimeout

const assert = require('assert')
const path = require('path')
const { execFileSync } = require('child_process')

const storage = new Map()
const previousWx = global.wx
const previousPage = global.Page
let projectPage

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  showToast() {},
  hideLoading() {},
  vibrateShort() {},
  navigateTo() {},
}
global.Page = (definition) => { projectPage = definition }

function resetStorage() {
  storage.clear()
  delete require.cache[require.resolve('../utils/records')]
}

function checkCompareToggle() {
  const toasts = []
  global.wx.showToast = ({ title }) => toasts.push(title)
  const recordA = { id: 'a', module: 'limiter', preferences: {}, resultText: 'a' }
  const recordB = { id: 'b', module: 'limiter', preferences: {}, resultText: 'b' }
  const recordC = { id: 'c', module: 'limiter', preferences: {}, resultText: 'c' }
  const page = {
    rawRecords: [recordA, recordB, recordC],
    data: { compareSelectedIds: ['a', 'b'] },
    setData(changes) { this.data = { ...this.data, ...changes } },
  }
  projectPage.toggleCompareRecord.call(page, { currentTarget: { dataset: { id: 'a' } } })
  assert.deepStrictEqual(page.data.compareSelectedIds, ['b'])
  assert.strictEqual(page.data.comparison, null)
  projectPage.toggleCompareRecord.call(page, { currentTarget: { dataset: { id: 'c' } } })
  assert.deepStrictEqual(page.data.compareSelectedIds, ['b', 'c'])
  projectPage.toggleCompareRecord.call(page, { currentTarget: { dataset: { id: 'a' } } })
  assert.deepStrictEqual(page.data.compareSelectedIds, ['b', 'c'])
  assert.strictEqual(toasts.filter((title) => title === '每次最多比较两条记录').length, 1)
}

function checkVenuePreferenceFreshRead() {
  resetStorage()
  const records = require('../utils/records')
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.projects.v1', [{
    id: 'project-1', name: 'Project', roomLengthText: '12', roomWidthText: '8', roomHeightText: '3',
    standardClassKey: 'conference', gradeKey: 'II', createdAt: 1, updatedAt: 1,
  }])
  records.getProjects()
  storage.set('audioTool.venue.preferences', { lengthText: '12', discussion: 'old' })
  assert.strictEqual(records.prepareProjectModule('project-1', 'venue'), '/pages/venue/venue')
  storage.set('audioTool.venue.preferences', { lengthText: '30', discussion: 'new' })
  assert.strictEqual(records.prepareProjectModule('project-1', 'venue'), '/pages/venue/venue')
  assert.strictEqual(storage.get('audioTool.venue.preferences').discussion, 'new')
  storage.delete('audioTool.venue.preferences')
  assert.strictEqual(records.prepareProjectModule('project-1', 'venue'), '/pages/venue/venue')
  assert.strictEqual(storage.get('audioTool.venue.preferences').lengthText, '12')
  assert.strictEqual(storage.get('audioTool.venue.preferences').widthText, '8')
  assert.strictEqual(storage.get('audioTool.venue.preferences')?.discussion, undefined)
  const originalGet = global.wx.getStorageSync
  global.wx.getStorageSync = (key) => {
    if (key === 'audioTool.venue.preferences') throw new Error('injected venue preference read failure')
    return originalGet.call(global.wx, key)
  }
  assert.strictEqual(records.prepareProjectModule('project-1', 'venue'), '')
  global.wx.getStorageSync = originalGet
  let writes = 0
  const originalSet = global.wx.setStorageSync
  global.wx.setStorageSync = (key, value) => { writes += 1; return originalSet.call(global.wx, key, value) }
  assert.strictEqual(records.restoreRecord({ module: 'venue', preferences: { lengthText: '99' } }), '/pages/venue/venue')
  assert.strictEqual(storage.get('audioTool.venue.preferences').lengthText, '99')
  assert.strictEqual(records.createProject('Recovery project').name, 'Recovery project')
  assert(writes >= 2)
  global.wx.setStorageSync = originalSet
}

function checkMigrationReadFailure() {
  resetStorage()
  const records = require('../utils/records')
  const project = { id: 'p', name: 'Project', roomLengthText: '12', roomWidthText: '8', roomHeightText: '3', standardClassKey: 'conference', gradeKey: 'II', createdAt: 1, updatedAt: 1 }
  const archived = { id: 'r', module: 'limiter', preferences: { threshold: -6 }, resultText: 'archived', projectIds: ['p'], createdAt: 1, updatedAt: 1 }
  storage.set('audioTool.storageSchemaVersion', 2)
  storage.set('audioTool.projects.v1', [project])
  storage.set('audioTool.records.v1', [archived])
  const originalGet = global.wx.getStorageSync
  let failProjectsRead = true
  global.wx.getStorageSync = (key) => {
    if (key === 'audioTool.projects.v1' && failProjectsRead) throw new Error('injected read failure')
    return originalGet.call(global.wx, key)
  }
  records.getRecords()
  assert.strictEqual(storage.get('audioTool.storageSchemaVersion'), 2)
  assert.deepStrictEqual(storage.get('audioTool.projects.v1'), [project])
  failProjectsRead = false
  records.getRecords()
  assert.strictEqual(storage.get('audioTool.storageSchemaVersion'), 3)
  assert.strictEqual(storage.get('audioTool.records.v1')[0].id, 'r')
  global.wx.getStorageSync = originalGet

  resetStorage()
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.projects.v1', [project])
  let failSchemaRead = true
  global.wx.getStorageSync = (key) => {
    if (key === 'audioTool.storageSchemaVersion' && failSchemaRead) throw new Error('injected schema read failure')
    return originalGet.call(global.wx, key)
  }
  const recordsSchema = require('../utils/records')
  assert.strictEqual(recordsSchema.createProject('Schema blocked'), null)
  assert.deepStrictEqual(storage.get('audioTool.projects.v1'), [project])
  failSchemaRead = false
  assert.strictEqual(recordsSchema.createProject('Schema retry').name, 'Schema retry')
  global.wx.getStorageSync = originalGet

  resetStorage()
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.projects.v1', [project])
  let failProjectsReadAgain = true
  global.wx.getStorageSync = (key) => {
    if (key === 'audioTool.projects.v1' && failProjectsReadAgain) throw new Error('injected project read failure')
    return originalGet.call(global.wx, key)
  }
  const recordsCreate = require('../utils/records')
  assert.strictEqual(recordsCreate.createProject('New project'), null)
  assert.deepStrictEqual(storage.get('audioTool.projects.v1'), [project])
  failProjectsReadAgain = false
  assert.strictEqual(recordsCreate.createProject('New project').name, 'New project')

  resetStorage()
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.records.v1', [archived])
  let failRecordsRead = true
  global.wx.getStorageSync = (key) => {
    if (key === 'audioTool.records.v1' && failRecordsRead) throw new Error('injected record read failure')
    return originalGet.call(global.wx, key)
  }
  const recordsSave = require('../utils/records')
  let writes = 0
  const originalSet = global.wx.setStorageSync
  global.wx.setStorageSync = (key, value) => { writes += 1; return originalSet.call(global.wx, key, value) }
  assert.strictEqual(recordsSave.saveRecord({ module: 'limiter', title: 'new', preferences: {}, resultText: 'new' }, { favorite: true }), null)
  assert.strictEqual(writes, 0)
  assert.deepStrictEqual(storage.get('audioTool.records.v1'), [archived])
  failRecordsRead = false
  assert(recordsSave.saveRecord({ module: 'limiter', title: 'new', preferences: {}, resultText: 'new' }, { favorite: true }))
  assert.strictEqual(storage.get('audioTool.records.v1').some((record) => record.id === 'r'), true)
  global.wx.setStorageSync = originalSet
  global.wx.getStorageSync = originalGet
}

function checkReportCancellation() {
  const controller = require('../utils/result-report-controller')
  let hidden = 0
  global.wx.hideLoading = () => { hidden += 1 }
  const page = {
    data: { isGeneratingResultReport: true, resultReportImagePath: 'cached://image' },
    resultReportRevision: 4,
    resultReportPendingSignature: 'pending',
    setData(changes) { this.data = { ...this.data, ...changes } },
  }
  controller.cancelResultReportGeneration(page)
  controller.cancelResultReportGeneration(page)
  assert.strictEqual(page.data.isGeneratingResultReport, false)
  assert.strictEqual(page.data.resultReportImagePath, 'cached://image')
  assert.strictEqual(page.resultReportPendingSignature, '')
  assert.strictEqual(page.resultReportRevision, 6)
  assert.strictEqual(hidden, 1)
  page.resultReportRevision = 7
  page.data.isGeneratingResultReport = true
  page.resultReportPendingSignature = 'new'
  page.resultReportImagePath = 'cached://image'
  const methods = controller.createResultReportMethods()
  methods.finishResultReportGeneration.call(page, 6, { resultReportImagePath: 'stale://image' })
  assert.strictEqual(page.data.isGeneratingResultReport, true)
  assert.strictEqual(page.data.resultReportImagePath, 'cached://image')

  const drawCallbacks = []
  const exports = []
  const toasts = []
  global.wx.showToast = ({ title }) => toasts.push(title)
  global.wx.createCanvasContext = () => new Proxy({}, {
    get: (target, key) => {
      if (key === 'draw') return (...args) => drawCallbacks.push(args.find((item) => typeof item === 'function'))
      if (key === 'measureText') return () => ({ width: 40 })
      return () => {}
    },
  })
  global.wx.canvasToTempFilePath = (options) => exports.push(options)
  const page2 = {
    data: { ...controller.createResultReportData() },
    resultReportRevision: 0,
    setData(changes, callback) { this.data = { ...this.data, ...changes }; if (callback) callback() },
    getRecordPayload() { return { module: 'limiter', title: 'test', summary: 'test', resultText: '结果：正常' } },
  }
  Object.assign(page2, controller.createResultReportMethods())
  page2.generateResultReportImage()
  assert.strictEqual(typeof drawCallbacks[0], 'function', `draw callback missing: ${JSON.stringify(drawCallbacks)}`)
  drawCallbacks[0]()
  assert.strictEqual(exports.length, 1)
  controller.cancelResultReportGeneration(page2)
  page2.generateResultReportImage()
  drawCallbacks[1]()
  exports[0].success({ tempFilePath: 'stale://image' })
  assert.strictEqual(page2.data.isGeneratingResultReport, true)
  assert.notStrictEqual(page2.data.resultReportImagePath, 'stale://image')
  exports[0].fail()
  assert.strictEqual(toasts.length, 0)
  exports[1].success({ tempFilePath: 'fresh://image' })
  assert.strictEqual(page2.data.resultReportImagePath, 'fresh://image')
  assert.strictEqual(page2.data.isGeneratingResultReport, false)
  delete global.wx.createCanvasContext
  delete global.wx.canvasToTempFilePath
}

function checkRecordViewBudgets() {
  const script = path.resolve(__dirname, 'helpers/record-view-payload.js')
  for (const count of [35, 70]) {
    const result = JSON.parse(execFileSync(process.execPath, [script, String(count)], { encoding: 'utf8' }))
    assert(result.projectViewBytes < 80 * 1024, `${count} 条项目视图载荷过大`)
    assert(result.favoritesViewBytes < 80 * 1024, `${count} 条收藏视图载荷过大`)
  }
}

try {
  require('../pages/records/project')
  checkCompareToggle()
  checkVenuePreferenceFreshRead()
  checkMigrationReadFailure()
  checkReportCancellation()
  checkRecordViewBudgets()
  console.log('Astra runtime regression checks passed')
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
}

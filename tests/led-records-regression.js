const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

const storage = new Map()
let storageFailure = false
let storageReadFailureKey = ''
let storageWriteFailureKey = ''
let pageDefinition = null
let clipboard = ''
const toastTitles = []
const modals = []

function clone(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
}

global.wx = {
  getStorageSync: (key) => {
    if (key === storageReadFailureKey) throw new Error('storage read unavailable')
    return clone(storage.get(key))
  },
  setStorageSync: (key, value) => {
    if (storageFailure || key === storageWriteFailureKey) throw new Error('storage unavailable')
    storage.set(key, clone(value))
  },
  removeStorageSync: (key) => storage.delete(key),
  showToast: ({ title }) => toastTitles.push(title),
  showModal: (options) => modals.push(options),
  setClipboardData: ({ data, success }) => { clipboard = data; if (success) success() },
  vibrateShort: () => {},
  hideLoading: () => {},
  getStorageInfoSync: () => ({ currentSize: 1, limitSize: 100 }),
  navigateTo: () => {},
  setNavigationBarTitle: () => {},
}
global.Page = (definition) => { pageDefinition = definition }

function fresh(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

function reset() {
  storage.clear()
  storageFailure = false
  storageReadFailureKey = ''
  storageWriteFailureKey = ''
  toastTitles.length = 0
  modals.length = 0
  clipboard = ''
  pageDefinition = null
  ;['../utils/records', '../utils/preferences', '../utils/result-record-actions', '../pages/led-screen/led-screen',
    '../pages/records/project', '../pages/records/project-report'].forEach((modulePath) => {
    try { delete require.cache[require.resolve(modulePath)] } catch (error) {}
  })
}

function makePage(modulePath = '../pages/led-screen/led-screen', options) {
  pageDefinition = null
  fresh(modulePath)
  assert(pageDefinition, `${modulePath} 未注册页面`)
  const page = {
    data: clone(pageDefinition.data),
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      if (callback) callback()
    },
  }
  Object.keys(pageDefinition).forEach((key) => {
    if (key !== 'data') page[key] = pageDefinition[key]
  })
  if (modulePath.includes('led-screen')) {
    page.onLoad(options)
    page.onShow()
  } else {
    page.onLoad(options)
  }
  return page
}

function defaultPreferences() {
  return {
    wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2',
    frameWidthText: '5', viewingDistanceText: '3', aspectRatio: '16:9',
    unitKey: 'module', pitch: 'recommended',
  }
}

function checkPageActionsAndPersistence() {
  reset()
  const records = fresh('../utils/records')
  const page = makePage()
  assert.equal(records.getRecords().length, 0, '普通计算不应生成历史记录')
  assert.deepEqual(page.getRecordPayload().preferences, defaultPreferences())
  assert(page.getResultText().includes('LED 大屏尺寸预估'))

  page.toggleCurrentFavorite()
  let saved = records.getRecords()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].favorite, true)
  const firstId = saved[0].id
  page.saveToActiveProject()
  assert.equal(modals.length, 1)
  modals[0].success({ confirm: true, content: 'LED 现场项目' })
  const project = records.getActiveProject()
  assert(project)
  saved = records.getProjectRecords(project.id)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].favorite, true)
  page.toggleCurrentFavorite()
  assert.equal(records.getProjectRecords(project.id)[0].favorite, false)
  page.toggleCurrentFavorite()
  assert.equal(records.getRecords()[0].id, firstId, '相同输入收藏应复用记录')
  page.saveToActiveProject()
  assert.equal(records.getProjectRecords(project.id).length, 1, '加入项目应去重')
  assert.equal(records.restoreRecord(saved[0]), '/pages/led-screen/led-screen')
}

function checkRestoreAndComparison() {
  reset()
  const records = fresh('../utils/records')
  const original = makePage()
  original.onFieldInput({ currentTarget: { dataset: { field: 'wallWidthText' } }, detail: { value: '9.6' } })
  original.onFieldBlur()
  original.onAspectRatioChange({ detail: { value: 1 } })
  original.onUnitChange({ detail: { value: 1 } })
  original.onPitchChange({ detail: { value: 3 } })
  original.toggleCurrentFavorite()
  const record = records.getRecords()[0]
  const expectedResult = clone(original.data.result)
  storage.set('audioTool.ledScreen.preferences', defaultPreferences())
  assert.equal(records.restoreRecord(record), '/pages/led-screen/led-screen')
  const restored = makePage()
  assert.deepEqual(restored.data.result, expectedResult, '九项偏好恢复后结果改变')
  assert.equal(restored.data.currentFavorite, true, '恢复收藏后当前收藏状态未同步')

  const other = {
    ...record,
    id: 'other',
    preferences: {
      ...record.preferences,
      topReserveText: '0.3', aspectRatio: '21:9', unitKey: 'module', pitch: 1.25,
    },
  }
  const comparison = fresh('../utils/record-comparison').buildRecordComparison([record, other])
  assert(comparison.rows.some((row) => row.key === 'topReserveText'))
  assert(comparison.rows.some((row) => row.key === 'aspectRatio'))
  assert(!comparison.identical)
  assert(fresh('../utils/records').MODULES.ledScreen)
}

function checkInvalidAndStorageFailures() {
  reset()
  const records = fresh('../utils/records')
  const page = makePage()
  page.toggleCurrentFavorite()
  const before = clone(records.getRecords())
  page.onFieldInput({ currentTarget: { dataset: { field: 'wallWidthText' } }, detail: { value: ' ' } })
  page.saveToActiveProject()
  page.toggleCurrentFavorite()
  assert.equal(page.data.result, null)
  assert.equal(page.data.currentFavorite, false)
  assert.deepEqual(records.getRecords(), before, '无效输入仍保存了旧结果')
  assert.equal(modals.length, 0)

  reset()
  const failedPage = makePage()
  storageFailure = true
  failedPage.toggleCurrentFavorite()
  assert(toastTitles.includes('保存失败，请检查本地存储'))
  assert.equal(fresh('../utils/records').getRecords().length, 0)

  reset()
  storageReadFailureKey = 'audioTool.records.v1'
  const readFailedPage = makePage()
  readFailedPage.toggleCurrentFavorite()
  assert(toastTitles.includes('保存失败，请检查本地存储'))
  assert.equal(readFailedPage.data.currentFavorite, false)
  storageReadFailureKey = ''

  reset()
  const projectFailurePage = makePage()
  const projectRecords = require('../utils/records')
  const project = projectRecords.createProject('写入失败项目')
  storageWriteFailureKey = 'audioTool.projects.v1'
  projectFailurePage.saveToActiveProject()
  assert(toastTitles.includes('保存失败，请检查本地存储'))
  storageWriteFailureKey = ''
  assert.equal(projectRecords.getProjectRecords(project.id).length, 0, '项目写入失败后残留了记录')
  assert.equal(projectRecords.getRecords().length, 0, '项目写入失败后记录数据未回滚')

  reset()
  const visibilityPage = makePage()
  const visibilityRecords = require('../utils/records')
  visibilityPage.toggleCurrentFavorite()
  assert.equal(visibilityPage.data.currentFavorite, true)
  visibilityRecords.toggleFavorite(visibilityPage.getRecordPayload())
  visibilityPage.onShow()
  assert.equal(visibilityPage.data.currentFavorite, false, '重新显示页面未同步外部取消收藏')
}

function checkProjectReportAndWxml() {
  reset()
  const records = fresh('../utils/records')
  const page = makePage()
  page.toggleCurrentFavorite()
  const project = records.createProject('LED 汇总项目')
  records.addRecordToProject(page.getRecordPayload(), project.id)
  const detail = makePage('../pages/records/project', { id: project.id })
  assert.equal(detail.data.moduleProgress.length, 8)
  assert.equal(detail.data.recordGroups.find((group) => group.module === 'ledScreen').records.length, 1)
  detail.copyProject()
  assert(clipboard.includes('LED 大屏尺寸预估'))
  const report = fresh('../pages/records/project-report').buildProjectReportPayload(
    detail.data.project, detail.data.recordGroups,
  )
  assert.equal(report.totalModuleCount, 8)
  assert(report.groups.some((group) => group.module === 'ledScreen'))
  assert(fs.readFileSync(path.join(__dirname, '../pages/led-screen/led-screen.wxml'), 'utf8')
    .includes('bindtap="saveToActiveProject"'))
}

checkPageActionsAndPersistence()
checkRestoreAndComparison()
checkInvalidAndStorageFailures()
checkProjectReportAndWxml()
console.log('LED records regression passed')

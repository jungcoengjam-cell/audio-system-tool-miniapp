const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

const storage = new Map()
const STORAGE_SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const FAVORITES_KEY = 'audioTool.favorites.v1'
const RECOVERY_KEY = 'audioTool.recovery.v1'
const ACTIVE_PROJECT_KEY = 'audioTool.activeProject.v1'
const STORAGE_SCHEMA_VERSION = 4
let storageFailure = false
let storageReadFailureKey = ''
let storageWriteFailureKey = ''
let pageDefinition = null
const toastTitles = []

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
  storage.set(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION)
  storage.set(RECORDS_KEY, [])
  storage.set(PROJECTS_KEY, [])
  storage.set(FAVORITES_KEY, [])
  storage.set(RECOVERY_KEY, [])
  storage.set(ACTIVE_PROJECT_KEY, '')
  storageFailure = false
  storageReadFailureKey = ''
  storageWriteFailureKey = ''
  toastTitles.length = 0
  pageDefinition = null
  ;['../utils/records', '../utils/preferences', '../utils/result-record-actions', '../pages/led-screen/led-screen',
    '../pages/records/project'].forEach((modulePath) => {
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

function projectEvent(page, step, fields = {}) {
  return { currentTarget: { dataset: { dialogRevision: page.data.projectDialogRevision, step, ...fields } } }
}

function createProjectThroughSheet(page, name) {
  assert.equal(page.openProjectSheet(), true, 'valid LED output should open the project sheet')
  assert.equal(page.data.projectDialogStep, 'select')
  assert.equal(page.openProjectCreateForm(projectEvent(page, 'select')), true)
  page.onProjectNameInput({ ...projectEvent(page, 'create'), detail: { value: name } })
  assert.equal(page.createProjectFromForm(projectEvent(page, 'create')), true)
  assert.equal(page.data.projectDialogStep, 'confirm')
  return page.data.projectTarget
}

function selectProjectThroughSheet(page, project) {
  assert.equal(page.openProjectSheet(), true, 'valid LED output should open the project sheet')
  assert.equal(page.selectProjectTarget(projectEvent(page, 'select', { id: project.id })), true)
  assert.equal(page.data.projectDialogStep, 'confirm')
}

function saveProjectThroughSheet(page, name, note) {
  page.onProjectConfigNameInput({ ...projectEvent(page, 'confirm'), detail: { value: name } })
  page.onProjectConfigNoteInput({ ...projectEvent(page, 'confirm'), detail: { value: note } })
  assert.equal(page.saveProjectTarget(projectEvent(page, 'confirm')), true)
  assert.equal(page.data.projectDialogStep, 'success')
}

function checkPageActionsAndPersistence() {
  reset()
  const records = fresh('../utils/records')
  const page = makePage()
  assert.equal(records.getRecords().length, 0, '普通计算不应生成历史记录')
  assert.deepEqual(page.getRecordPayload().preferences, defaultPreferences())
  assert(page.getResultText().includes('LED 大屏尺寸预估'))

  page.toggleCurrentFavorite()
  let saved = records.getFavorites()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].favorite, true)
  const firstId = saved[0].id
  const target = createProjectThroughSheet(page, 'LED现场项目')
  assert.equal(target.name, 'LED现场项目')
  const project = records.getProjects().find((item) => item.id === target.id)
  assert(project && project.id === target.id)
  assert.equal(records.getActiveProject(), null, '创建项目不再隐式设置全局当前项目')
  saveProjectThroughSheet(page, 'LED现场配置', '现场观看距离按 3 m 复核')
  saved = records.getProjectRecords(project.id)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].favorite, false)
  assert.notEqual(saved[0].id, firstId, '项目记录和收藏快照拥有独立 ID')
  let projectView = records.getProjectRecordView(saved[0], project.id)
  assert.equal(projectView.hasProjectMetadata, true)
  assert.equal(projectView.title, 'LED现场配置')
  assert.equal(projectView.projectNote, '现场观看距离按 3 m 复核')

  page.closeProjectDialog(true)
  page.toggleCurrentFavorite()
  assert.equal(records.getProjectRecords(project.id)[0].favorite, false)
  assert.equal(records.getFavorites().length, 0, '取消收藏不影响项目记录')
  assert(records.getRecoveryEntries().some((entry) => entry.kind === 'favorite' && entry.targetId === firstId))
  page.toggleCurrentFavorite()
  assert.notEqual(records.getFavorites()[0].id, firstId, '重新收藏创建新的独立快照')
  assert.equal(records.getProjectRecords(project.id)[0].id, saved[0].id, '重新收藏不替换项目记录')
  selectProjectThroughSheet(page, project)
  assert.equal(page.data.projectConfigName, 'LED现场配置', 'reopening a project should restore its configuration name')
  assert.equal(page.data.projectConfigNote, '现场观看距离按 3 m 复核', 'reopening a project should restore its note')
  saveProjectThroughSheet(page, 'LED现场配置', '现场观看距离按 3 m 复核')
  assert.equal(records.getProjectRecords(project.id).length, 1, '加入项目应去重')
  saved = records.getProjectRecords(project.id)
  projectView = records.getProjectRecordView(saved[0], project.id)
  assert.equal(projectView.title, 'LED现场配置', 'saving the same calculation must retain project metadata')
  assert.equal(projectView.projectNote, '现场观看距离按 3 m 复核')
  assert.equal(records.restoreRecord(saved[0]), '/pages/led-screen/led-screen')
}

function checkRestoreAndFavoriteCompatibility() {
  reset()
  const records = fresh('../utils/records')
  const original = makePage()
  original.onFieldInput({ currentTarget: { dataset: { field: 'wallWidthText' } }, detail: { value: '9.6' } })
  original.onFieldBlur()
  original.onAspectRatioChange({ detail: { value: 1 } })
  original.onUnitChange({ detail: { value: 1 } })
  original.onPitchChange({ detail: { value: 3 } })
  original.toggleCurrentFavorite()
  const record = records.getFavorites()[0]
  const expectedResult = clone(original.data.result)
  storage.set('audioTool.ledScreen.preferences', defaultPreferences())
  assert.equal(records.restoreRecord(record), '/pages/led-screen/led-screen')
  assert.deepEqual(storage.get('audioTool.ledScreen.preferences'), defaultPreferences(),
    '解析旧载入路由不覆盖工具临时输入')
  const context = fresh('../utils/result-record-context')
  const editorSessionId = context.openRecordEditor(record, 'favorite')
  const restored = makePage('../pages/led-screen/led-screen', { editorSessionId })
  assert.deepEqual(restored.data.result, expectedResult, '九项偏好恢复后结果改变')
  assert.equal(restored.data.currentFavorite, true, '恢复收藏后当前收藏状态未同步')
  assert.equal(restored.data.editorSessionActive, true, '收藏载入建立独立编辑上下文')
  assert.equal(context.discardResultEditor(restored), true, '放弃工作副本成功')
  assert.deepEqual(storage.get('audioTool.ledScreen.preferences'), defaultPreferences(),
    '放弃收藏工作副本后恢复原临时输入')
  assert.deepEqual(records.getFavoriteByPayload(record), record, '编辑收藏副本不修改独立收藏快照')

  assert(fresh('../utils/records').MODULES.ledScreen)
}

function checkLegacyRecordCompatibility() {
  reset()
  const records = fresh('../utils/records')
  const page = makePage()
  const project = records.createProject('旧版 LED 项目')
  const legacyRecord = records.addRecordToProject(page.getRecordPayload(), project.id)
  assert(legacyRecord)
  assert.equal(legacyRecord.projectMetadata, undefined, 'legacy project records should remain valid without new metadata')
  assert.equal(legacyRecord.favorite, false)
  assert.deepEqual(legacyRecord.projectIds, [project.id])
  const legacyFavorite = records.saveRecord(page.getRecordPayload(), { projectId: project.id, favorite: true })
  assert(legacyFavorite)
  assert.equal(legacyFavorite.favorite, true)
  assert.deepEqual(legacyFavorite.projectIds, [], '兼容收藏调用创建独立快照，不附加项目记录')
  assert.notEqual(legacyFavorite.id, legacyRecord.id)

  const legacyView = records.getProjectRecordView(legacyRecord, project.id)
  assert.equal(legacyView.title, legacyRecord.title, 'legacy project views should keep the stored title')
  assert.equal(legacyView.hasProjectMetadata, undefined)
  assert.equal(legacyView.projectNote, undefined)
  assert.equal(records.restoreRecord(legacyRecord), '/pages/led-screen/led-screen')

  const detail = makePage('../pages/records/project', { id: project.id })
  const projectLedRecords = detail.data.recordGroups.find((group) => group.module === 'ledScreen').records
  assert.equal(projectLedRecords.length, 1, 'project detail should still show a legacy LED record')
  assert.equal(projectLedRecords[0].id, legacyRecord.id)
  assert.equal(projectLedRecords[0].title, legacyRecord.title)
  page.toggleCurrentFavorite()
  assert.equal(records.getRecordById(legacyRecord.id).id, legacyRecord.id, '取消收藏保留项目记录 ID')
  assert.equal(records.getRecordById(legacyRecord.id).favorite, false)
  assert.deepEqual(records.getRecordById(legacyRecord.id).projectIds, [project.id], '收藏变化保留项目关系')
  assert.equal(records.getFavoriteByPayload(page.getRecordPayload()), null)
  assert(records.getRecoveryEntries().some((entry) => entry.kind === 'favorite'
    && entry.targetId === legacyFavorite.id), '旧调用收藏可从恢复区找回原始快照')
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
  assert.equal(page.data.projectDialogVisible, false, 'invalid input must not open the project sheet')

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
  selectProjectThroughSheet(projectFailurePage, project)
  projectFailurePage.onProjectConfigNameInput({
    ...projectEvent(projectFailurePage, 'confirm'), detail: { value: '失败配置' },
  })
  projectFailurePage.onProjectConfigNoteInput({
    ...projectEvent(projectFailurePage, 'confirm'), detail: { value: '' },
  })
  storageWriteFailureKey = 'audioTool.projects.v1'
  assert.equal(projectFailurePage.saveProjectTarget(projectEvent(projectFailurePage, 'confirm')), true)
  assert.match(projectFailurePage.data.projectError, /保存失败/)
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

function checkProjectReportPayloadAndWxml() {
  reset()
  const records = fresh('../utils/records')
  const page = makePage()
  page.toggleCurrentFavorite()
  const project = records.createProject('LED 汇总项目')
  records.addRecordToProject(page.getRecordPayload(), project.id, {
    name: 'LED 项目方案',
    note: '报告保留项目备注',
  })
  const detail = makePage('../pages/records/project', { id: project.id })
  const expectedModuleKeys = [
    'limiter', 'spl', 'cable', 'camera', 'gainStructure', 'dmxAddress', 'ledScreen', 'audioWiring',
  ]
  assert.deepEqual(detail.data.moduleProgress.map((item) => item.key), expectedModuleKeys,
    '项目进度应包含七个计算模块和接线助手')
  assert.equal(detail.data.moduleProgress.length, expectedModuleKeys.length)
  assert.equal(detail.data.recordGroups.find((group) => group.module === 'ledScreen').records.length, 1)
  const reportModel = require('../pages/records/report-model')
  const source = reportModel.loadProjectReportSource(project.id)
  assert.equal(source.ok, true, source.error)
  const sections = reportModel.getProjectReportSections(source)
  const ledItem = sections.find((section) => section.key === 'calculation')
    .items.find((item) => item.record.module === 'ledScreen')
  assert(ledItem, 'the PDF report retains the LED project record as a selectable item')
  const report = reportModel.buildReportPayload(source, [ledItem.id])
  assert.equal(report.itemCount, 1)
  assert.equal(report.selectedItems[0].record.resultText, page.getResultText(),
    'the selected PDF report snapshot retains the complete saved LED result')
  assert.equal(report.selectedItems[0].record.projectNote, '报告保留项目备注')
  const reportText = report.pages.flatMap((item) => item.lines).map((line) => line.text).join('')
  assert(reportText.includes('LED 项目方案'))
  assert(reportText.includes('项目备注：报告保留项目备注'))
  assert(reportText.includes(`关键结果：${ledItem.record.summary}`))
  assert(reportText.includes('墙体宽度（m）'))
  assert(fs.readFileSync(path.join(__dirname, '../pages/led-screen/led-screen.wxml'), 'utf8')
    .includes('bindtap="openProjectSheet"'))
}

checkPageActionsAndPersistence()
checkRestoreAndFavoriteCompatibility()
checkLegacyRecordCompatibility()
checkInvalidAndStorageFailures()
checkProjectReportPayloadAndWxml()
console.log('LED records regression passed')

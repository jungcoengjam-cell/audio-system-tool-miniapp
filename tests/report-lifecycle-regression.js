const assert = require('assert/strict')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const storage = new Map()
const drawCallbacks = []
const exportsQueue = []
const toasts = []
const ledSetDataCallbacks = []
const modalRequests = []
let navigateBackCount = 0
let writeFailure = false
let showLoadingCount = 0
let hideLoadingCount = 0
let page

function resetRuntime() {
  storage.clear()
  drawCallbacks.length = 0
  exportsQueue.length = 0
  toasts.length = 0
  ledSetDataCallbacks.length = 0
  modalRequests.length = 0
  navigateBackCount = 0
  writeFailure = false
  showLoadingCount = 0
  hideLoadingCount = 0
  delete require.cache[require.resolve('../utils/records')]
}

function clone(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
}

function installRuntime() {
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => {
      if (writeFailure) throw new Error('injected storage failure')
      storage.set(key, clone(value))
    },
    removeStorageSync: (key) => storage.delete(key),
    showToast: ({ title }) => toasts.push(title),
    showModal: (options) => modalRequests.push(options),
    navigateBack: () => { navigateBackCount += 1 },
    showLoading: () => { showLoadingCount += 1 },
    hideLoading: () => { hideLoadingCount += 1 },
    vibrateShort: () => {},
    setNavigationBarTitle: () => {},
    getStorageInfoSync: () => ({ currentSize: 1, limitSize: 10 }),
    createCanvasContext: () => new Proxy({}, {
      get: (_, key) => {
        if (key === 'draw') return (reserve, callback) => drawCallbacks.push(callback)
        if (key === 'measureText') return (value) => ({ width: String(value).length })
        return () => {}
      },
      set: () => true,
    }),
    canvasToTempFilePath: (options) => exportsQueue.push(options),
  }
  global.Page = (definition) => { page = definition }
}

function fresh(modulePath) {
  const filename = path.resolve(ROOT, modulePath)
  delete require.cache[require.resolve(filename)]
  require(filename)
  page.setData = (changes, callback) => {
    page.data = { ...page.data, ...changes }
    if (callback) callback()
  }
  return page
}

function loadLed() {
  resetRuntime()
  installRuntime()
  const led = fresh('pages/led-screen/led-screen.js')
  led.setData = (changes, callback) => {
    led.data = { ...led.data, ...changes }
    if (callback) ledSetDataCallbacks.push(callback)
  }
  led.onLoad()
  led.onShow()
  flushLedSetDataCallbacks()
  return led
}

function flushLedSetDataCallbacks() {
  while (ledSetDataCallbacks.length) ledSetDataCallbacks.shift()()
}

function generateLedReport(led) {
  const result = led.generateReportImage()
  flushLedSetDataCallbacks()
  return result
}

function completeCurrentExport(tempFilePath) {
  assert.equal(drawCallbacks.length > 0, true, '没有等待中的 draw 回调')
  drawCallbacks.shift()()
  assert.equal(exportsQueue.length > 0, true, '没有等待中的导出回调')
  const request = exportsQueue.shift()
  if (tempFilePath) request.success({ tempFilePath })
  else request.fail({ errMsg: 'export failed' })
}

function assertCachedReportReuse(reportPage, label, methodName = 'generateReportImage') {
  const drawCount = drawCallbacks.length
  const exportCount = exportsQueue.length
  const showCount = showLoadingCount
  const hideCount = hideLoadingCount
  reportPage[methodName]()
  assert.equal(reportPage.data.reportPreviewVisible, true, `${label}没有打开缓存预览`)
  assert.equal(drawCallbacks.length, drawCount, `${label}重复绘制`)
  assert.equal(exportsQueue.length, exportCount, `${label}重复导出`)
  assert.equal(showLoadingCount, showCount, `${label}重复显示 loading`)
  assert.equal(hideLoadingCount, hideCount, `${label}重复隐藏 loading`)
}

function seedProject() {
  storage.set('audioTool.storageSchemaVersion', 4)
  storage.set('audioTool.projects.v1', [{ id: 'p', name: 'P', createdAt: 1, updatedAt: 1 }])
  storage.set('audioTool.records.v1', [{
    id: 'r', module: 'limiter', title: 'R', summary: 'S', preferences: { speakerModel: 'S' },
    resultText: 'R', projectIds: ['p'], favorite: false, createdAt: 1, updatedAt: 1,
  }])
  storage.set('audioTool.favorites.v1', [])
  storage.set('audioTool.recovery.v1', [])
}

function loadProject() {
  resetRuntime()
  installRuntime()
  seedProject()
  const project = fresh('pages/records/project.js')
  project.onLoad({ id: 'p' })
  return project
}

function checkLedInitialCacheAndFailure() {
  const led = loadLed()
  generateLedReport(led)
  assert.equal(led.data.isGeneratingReport, true)
  completeCurrentExport('temp://led-first.png')
  assert.equal(led.data.reportImagePath, 'temp://led-first.png')
  assert.equal(led.data.reportPreviewVisible, true)
  assertCachedReportReuse(led, 'LED报告相同输入')
  led.onFieldInput({
    currentTarget: { dataset: { field: 'wallWidthText' } },
    detail: { value: led.data.wallWidthText },
  })
  assert.equal(led.data.reportImagePath, 'temp://led-first.png', '同值输入错误清理缓存')
  led.cancelInputCalculation()

  const failedLed = loadLed()
  generateLedReport(failedLed)
  const toastCount = toasts.length
  completeCurrentExport()
  assert.equal(failedLed.data.isGeneratingReport, false)
  assert.equal(toasts.length, toastCount + 1)
  const retryShowCount = showLoadingCount
  generateLedReport(failedLed)
  assert.equal(showLoadingCount, retryShowCount + 1, 'LED失败后不能重试')
  completeCurrentExport('temp://led-retry.png')
  assert.equal(failedLed.data.reportImagePath, 'temp://led-retry.png')
}

function checkLedStaleCallbackAndNewLoading() {
  const drawPendingLed = loadLed()
  generateLedReport(drawPendingLed)
  const oldDraw = drawCallbacks.shift()
  drawPendingLed.commitCalculatedState({ wallWidthText: '7' })
  flushLedSetDataCallbacks()
  oldDraw()
  assert.equal(exportsQueue.length, 0, '来源变化后旧 draw 仍进入导出')
  assert.equal(drawPendingLed.data.reportImagePath, '')
  assert.equal(drawPendingLed.data.isGeneratingReport, false)

  const led = loadLed()
  generateLedReport(led)
  drawCallbacks.shift()()
  const oldExport = exportsQueue.shift()
  led.commitCalculatedState({ wallWidthText: '7' })
  flushLedSetDataCallbacks()
  generateLedReport(led)
  assert.equal(led.data.isGeneratingReport, true)
  const newShowLoadingCount = showLoadingCount
  const newHideLoadingCount = hideLoadingCount
  const toastCount = toasts.length
  oldExport.success({ tempFilePath: 'temp://old-led.png' })
  assert.equal(led.data.isGeneratingReport, true)
  assert.equal(led.data.reportImagePath, '')
  assert.equal(showLoadingCount, newShowLoadingCount)
  assert.equal(hideLoadingCount, newHideLoadingCount)
  assert.equal(toasts.length, toastCount)
  completeCurrentExport('temp://new-led.png')
  assert.equal(led.data.reportImagePath, 'temp://new-led.png')
  assert.equal(led.data.isGeneratingReport, false)

  const inputLed = loadLed()
  generateLedReport(inputLed)
  drawCallbacks.shift()()
  const inputOldExport = exportsQueue.shift()
  const beforeInputHideCount = hideLoadingCount
  inputLed.onFieldInput({
    currentTarget: { dataset: { field: 'wallWidthText' } },
    detail: { value: '7' },
  })
  assert.equal(inputLed.data.reportImagePath, '')
  assert.equal(inputLed.data.reportPreviewVisible, false)
  assert.equal(inputLed.data.isGeneratingReport, false)
  assert.equal(hideLoadingCount, beforeInputHideCount + 1)
  inputOldExport.success({ tempFilePath: 'temp://stale-input-led.png' })
  assert.equal(inputLed.data.reportImagePath, '')
  assert.equal(hideLoadingCount, beforeInputHideCount + 1)
  inputLed.cancelInputCalculation()
}

function checkProjectInitialCacheFailureAndMissing() {
  const project = loadProject()
  project.generateProjectReportImage()
  completeCurrentExport('temp://project-first.png')
  assert.equal(project.data.reportImagePath, 'temp://project-first.png')
  assertCachedReportReuse(project, '项目报告相同输入', 'generateProjectReportImage')

  const failedProject = loadProject()
  failedProject.generateProjectReportImage()
  const toastCount = toasts.length
  completeCurrentExport()
  assert.equal(failedProject.data.isGeneratingReport, false)
  assert.equal(toasts.length, toastCount + 1)
  const retryShowCount = showLoadingCount
  failedProject.generateProjectReportImage()
  assert.equal(showLoadingCount, retryShowCount + 1, '项目报告失败后不能重试')
  completeCurrentExport('temp://project-retry.png')
  assert.equal(failedProject.data.reportImagePath, 'temp://project-retry.png')

  const missingProject = loadProject()
  missingProject.generateProjectReportImage()
  drawCallbacks.shift()()
  const oldExport = exportsQueue.shift()
  require('../utils/records').deleteProject('p')
  missingProject.refresh()
  oldExport.success({ tempFilePath: 'temp://missing-old.png' })
  assert.equal(missingProject.data.missing, true)
  assert.equal(missingProject.data.reportImagePath, '')
  assert.equal(missingProject.data.isGeneratingReport, false)
}

function checkProjectSourceChangesInvalidateOldCallbacks() {
  const removedRecordProject = loadProject()
  const records = require('../utils/records')
  removedRecordProject.generateProjectReportImage()
  drawCallbacks.shift()()
  const oldSuccess = exportsQueue.shift()
  assert.equal(records.removeRecordFromProject('r', 'p'), true)
  removedRecordProject.refresh()
  oldSuccess.success({ tempFilePath: 'temp://removed-record-old.png' })
  assert.equal(removedRecordProject.data.reportImagePath, '')
  assert.equal(removedRecordProject.data.isGeneratingReport, false)

  const updatedProject = loadProject()
  updatedProject.generateProjectReportImage()
  drawCallbacks.shift()()
  const oldFailure = exportsQueue.shift()
  const currentRecords = require('../utils/records')
  assert.equal(currentRecords.updateProject('p', { venueName: 'Changed' })?.venueName, 'Changed')
  updatedProject.refresh()
  updatedProject.generateProjectReportImage()
  assert.equal(updatedProject.data.isGeneratingReport, true)
  const newShowLoadingCount = showLoadingCount
  const newHideLoadingCount = hideLoadingCount
  oldFailure.fail({ errMsg: 'old export failed' })
  assert.equal(updatedProject.data.isGeneratingReport, true)
  assert.equal(showLoadingCount, newShowLoadingCount)
  assert.equal(hideLoadingCount, newHideLoadingCount)
  completeCurrentExport('temp://updated-project-new.png')
  assert.equal(updatedProject.data.reportImagePath, 'temp://updated-project-new.png')
  assert.equal(updatedProject.data.isGeneratingReport, false)
}

function checkProjectsFavoriteStates() {
  resetRuntime()
  installRuntime()
  storage.set('audioTool.storageSchemaVersion', 4)
  const project = { id: 'p', name: 'P', createdAt: 1, updatedAt: 1 }
  const preferences = {
    amplifierModel: 'KT-P21000', speakerModel: 'KF-D12F', count: '2', wiring: 'parallel',
    mode: 'voltage', sensitivityVoltage: '1.4', highPassFrequency: '35',
  }
  const projectRecord = {
    id: 'record-one', module: 'limiter', title: '项目限幅记录', summary: '项目快照', preferences,
    resultText: '项目计算结果', signature: JSON.stringify(['limiter', preferences]),
    projectIds: ['p'], favorite: false, archived: false, createdAt: 1, updatedAt: 2,
  }
  const favorite = {
    ...projectRecord, id: 'favorite-one', title: '独立常用快照', projectIds: [], favorite: true,
    originProjectIds: ['p'],
  }
  storage.set('audioTool.projects.v1', [project])
  storage.set('audioTool.records.v1', [projectRecord])
  storage.set('audioTool.favorites.v1', [favorite])
  storage.set('audioTool.recovery.v1', [])
  const favoriteDetail = fresh('pages/projects/favorite-detail.js')
  favoriteDetail.onLoad({ id: favorite.id })
  assert.equal(favoriteDetail.data.favorite.id, favorite.id)
  assert.deepEqual(storage.get('audioTool.records.v1'), [projectRecord], '收藏详情读取不得改写项目记录')

  favoriteDetail.removeCurrentFavorite()
  assert.equal(modalRequests.length, 1)
  modalRequests.shift().success({ confirm: false })
  assert.deepEqual(storage.get('audioTool.favorites.v1'), [favorite], '取消移入恢复区应保留独立快照')
  assert.deepEqual(storage.get('audioTool.records.v1'), [projectRecord], '取消管理操作应保留项目记录')
  assert.equal(storage.get('audioTool.recovery.v1').length, 0)
  assert.equal(navigateBackCount, 0)

  favoriteDetail.removeCurrentFavorite()
  modalRequests.shift().success({ confirm: true })
  assert.deepEqual(storage.get('audioTool.favorites.v1'), [])
  assert.deepEqual(storage.get('audioTool.records.v1'), [projectRecord], '移除收藏不得删除关联项目记录')
  const recoveryFavorite = storage.get('audioTool.recovery.v1').find((entry) => entry.kind === 'favorite')
  assert.equal(recoveryFavorite.targetId, favorite.id)
  assert.deepEqual(recoveryFavorite.snapshot, favorite, '移入恢复区应保存完整收藏快照')
  assert.equal(navigateBackCount, 1)

  resetRuntime()
  installRuntime()
  storage.set('audioTool.storageSchemaVersion', 4)
  storage.set('audioTool.projects.v1', [project])
  storage.set('audioTool.records.v1', [projectRecord])
  storage.set('audioTool.favorites.v1', [favorite])
  storage.set('audioTool.recovery.v1', [])
  const failedFavoriteDetail = fresh('pages/projects/favorite-detail.js')
  failedFavoriteDetail.onLoad({ id: favorite.id })
  writeFailure = true
  failedFavoriteDetail.removeCurrentFavorite()
  modalRequests.shift().success({ confirm: true })
  writeFailure = false
  assert.deepEqual(storage.get('audioTool.favorites.v1'), [favorite], '恢复区写入失败时收藏仍保留')
  assert.deepEqual(storage.get('audioTool.records.v1'), [projectRecord], '恢复区写入失败不能影响项目记录')
  assert.deepEqual(storage.get('audioTool.recovery.v1'), [])
  assert.equal(navigateBackCount, 0, '恢复区写入失败不能离开收藏详情')
  assert.equal(toasts.includes('操作失败，请重试'), true)

  failedFavoriteDetail.removeCurrentFavorite()
  modalRequests.shift().success({ confirm: true })
  assert.deepEqual(storage.get('audioTool.favorites.v1'), [], '存储恢复后允许重试移入恢复区')
  assert.deepEqual(storage.get('audioTool.records.v1'), [projectRecord])
  assert.equal(storage.get('audioTool.recovery.v1').length, 1)
  assert.equal(navigateBackCount, 1)
}

try {
  checkLedInitialCacheAndFailure()
  checkLedStaleCallbackAndNewLoading()
  checkProjectInitialCacheFailureAndMissing()
  checkProjectSourceChangesInvalidateOldCallbacks()
  checkProjectsFavoriteStates()
  console.log('report lifecycle regression passed')
} finally {
  delete global.wx
  delete global.Page
}

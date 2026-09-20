const assert = require('assert/strict')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const storage = new Map()
const drawCallbacks = []
const exportsQueue = []
const toasts = []
let writeFailure = false
let showLoadingCount = 0
let hideLoadingCount = 0
let page

function resetRuntime() {
  storage.clear()
  drawCallbacks.length = 0
  exportsQueue.length = 0
  toasts.length = 0
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
  led.onLoad()
  return led
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
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.projects.v1', [{ id: 'p', name: 'P', createdAt: 1, updatedAt: 1 }])
  storage.set('audioTool.records.v1', [{
    id: 'r', module: 'limiter', title: 'R', summary: 'S', preferences: { speakerModel: 'S' },
    resultText: 'R', projectIds: ['p'], favorite: false, createdAt: 1, updatedAt: 1,
  }])
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
  led.generateReportImage()
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
  failedLed.generateReportImage()
  const toastCount = toasts.length
  completeCurrentExport()
  assert.equal(failedLed.data.isGeneratingReport, false)
  assert.equal(toasts.length, toastCount + 1)
  const retryShowCount = showLoadingCount
  failedLed.generateReportImage()
  assert.equal(showLoadingCount, retryShowCount + 1, 'LED失败后不能重试')
  completeCurrentExport('temp://led-retry.png')
  assert.equal(failedLed.data.reportImagePath, 'temp://led-retry.png')
}

function checkLedStaleCallbackAndNewLoading() {
  const drawPendingLed = loadLed()
  drawPendingLed.generateReportImage()
  const oldDraw = drawCallbacks.shift()
  drawPendingLed.commitCalculatedState({ wallWidthText: '7' })
  oldDraw()
  assert.equal(exportsQueue.length, 0, '来源变化后旧 draw 仍进入导出')
  assert.equal(drawPendingLed.data.reportImagePath, '')
  assert.equal(drawPendingLed.data.isGeneratingReport, false)

  const led = loadLed()
  led.generateReportImage()
  drawCallbacks.shift()()
  const oldExport = exportsQueue.shift()
  led.commitCalculatedState({ wallWidthText: '7' })
  led.generateReportImage()
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
  inputLed.generateReportImage()
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
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.projects.v1', [])
  storage.set('audioTool.records.v1', [{
    id: 'favorite', module: 'limiter', title: 'F', summary: 'S', preferences: { speakerModel: 'S' },
    resultText: 'R', signature: JSON.stringify(['limiter', { speakerModel: 'S' }]),
    projectIds: [], favorite: true, createdAt: 1, updatedAt: 1,
  }])
  const projects = fresh('pages/projects/projects.js')
  projects.onShow()
  projects.toggleRecordFavorite({ currentTarget: { dataset: { id: 'favorite' } } })
  assert.deepEqual(storage.get('audioTool.records.v1'), [])
  assert.equal(toasts.includes('保存失败，请检查本地存储'), false)

  resetRuntime()
  installRuntime()
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.projects.v1', [{ id: 'p', name: 'P', createdAt: 1, updatedAt: 1 }])
  const projectRecord = {
    id: 'favorite', module: 'limiter', title: 'F', summary: 'S', preferences: { speakerModel: 'S' },
    resultText: 'R', signature: JSON.stringify(['limiter', { speakerModel: 'S' }]),
    projectIds: ['p'], favorite: true, createdAt: 1, updatedAt: 1,
  }
  storage.set('audioTool.records.v1', [projectRecord])
  const projectProjects = fresh('pages/projects/projects.js')
  projectProjects.onShow()
  projectProjects.toggleRecordFavorite({ currentTarget: { dataset: { id: 'favorite' } } })
  assert.equal(storage.get('audioTool.records.v1')[0].favorite, false)
  assert.deepEqual(storage.get('audioTool.records.v1')[0].projectIds, ['p'])
  projectProjects.toggleRecordFavorite({ currentTarget: { dataset: { id: 'favorite' } } })
  assert.equal(storage.get('audioTool.records.v1')[0].favorite, true)

  resetRuntime()
  installRuntime()
  storage.set('audioTool.storageSchemaVersion', 3)
  storage.set('audioTool.projects.v1', [{ id: 'p', name: 'P', createdAt: 1, updatedAt: 1 }])
  const failedRecord = { ...projectRecord }
  storage.set('audioTool.records.v1', [failedRecord])
  const failedProjects = fresh('pages/projects/projects.js')
  failedProjects.onShow()
  writeFailure = true
  failedProjects.toggleRecordFavorite({ currentTarget: { dataset: { id: 'favorite' } } })
  writeFailure = false
  assert.deepEqual(storage.get('audioTool.records.v1'), [failedRecord])
  assert.equal(toasts.includes('保存失败，请检查本地存储'), true)
  failedProjects.toggleRecordFavorite({ currentTarget: { dataset: { id: 'favorite' } } })
  assert.equal(storage.get('audioTool.records.v1')[0].favorite, false)
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

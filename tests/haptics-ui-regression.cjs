'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const HAPTICS_FILE = require.resolve(path.join(ROOT, 'utils/haptics.js'))
const storage = new Map()
const vibrations = []
const toasts = []
let modalRequest = null
let clipboardRequest = null
let failStorageWrite = false

function clone(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
}

function resetRuntime() {
  storage.clear()
  vibrations.length = 0
  toasts.length = 0
  modalRequest = null
  clipboardRequest = null
  failStorageWrite = false
  global.getApp = () => ({ globalData: { primaryNavigation: { restoreChecked: true } } })
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) {
      if (failStorageWrite) throw new Error('storage write failed')
      storage.set(key, clone(value))
    },
    removeStorageSync(key) { storage.delete(key) },
    showToast(options) { toasts.push(options) },
    showModal(options) { modalRequest = options },
    showActionSheet(options) { modalRequest = options },
    setClipboardData(options) { clipboardRequest = options },
    navigateTo() {},
    navigateBack() {},
    setNavigationBarTitle() {},
    showLoading() {},
    hideLoading() {},
    vibrateShort() {},
    getStorageInfoSync() { return { currentSize: 1, limitSize: 10 } },
    env: { USER_DATA_PATH: '/tmp' },
    getImageInfo() {},
    createSelectorQuery() {},
    canvasToTempFilePath() {},
  }
}

function loadPage(relativePath, overrides = {}) {
  let definition
  const filename = path.resolve(ROOT, relativePath)
  const replacements = new Map(Object.entries(overrides).map(([relative, exports]) => [
    require.resolve(path.resolve(ROOT, relative)), exports,
  ]))
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    let resolved
    try { resolved = Module._resolveFilename(request, parent, isMain) } catch (_) {}
    if (resolved === HAPTICS_FILE) return { vibrate: (type) => vibrations.push(type) }
    if (replacements.has(resolved)) return replacements.get(resolved)
    return originalLoad.apply(this, arguments)
  }
  global.Page = (pageDefinition) => { definition = pageDefinition }
  delete require.cache[filename]
  try { require(filename) } finally { Module._load = originalLoad }
  assert(definition, `Page 未注册：${relativePath}`)
  const page = { ...definition, data: clone(definition.data || {}) }
  page.setData = (changes, callback) => {
    Object.entries(changes || {}).forEach(([key, value]) => {
      if (!key.includes('[')) page.data[key] = value
    })
    if (callback) callback()
  }
  return page
}

function event(dataset = {}, detail = {}) {
  return { currentTarget: { dataset }, detail }
}

function testChangedChoicesAndSettingsPersistence() {
  resetRuntime()
  const tools = loadPage('pages/tools/tools.js')
  tools.refreshTools = () => {}
  tools.data.activeCategory = '全部'
  tools.onCategoryTap(event({ category: '视频' }))
  tools.onCategoryTap(event({ category: '视频' }))
  tools.onCategoryTap(event({ category: 'unknown' }))
  assert.deepEqual(vibrations, ['light'], '工具筛选只对有效变化反馈一次')

  const settings = loadPage('pages/settings/settings.js')
  settings.data.toolRows = [{ id: 'camera', visible: true }]
  settings.onToolVisibilityChange(event({ id: 'camera' }, { value: false }))
  assert.deepEqual(vibrations, ['light', 'light'], '设置开关持久化成功且值变化后反馈')
  settings.onToolVisibilityChange(event({ id: 'camera' }, { value: false }))
  failStorageWrite = true
  settings.onToolVisibilityChange(event({ id: 'camera' }, { value: true }))
  assert.deepEqual(vibrations, ['light', 'light'], '重复开关和写入失败不反馈')

  const basis = loadPage('pages/basis/detail.js')
  basis.toggleFullExplanation()
  assert.deepEqual(vibrations.slice(-1), ['light'], '依据说明展开/收起是离散状态变化')
}

function testProductSelectionsAndImport() {
  resetRuntime()
  const library = loadPage('pages/products/library.js')
  library.data = {
    ...library.data,
    types: [{ key: 'a' }, { key: 'b' }], typeIndex: 0,
    categories: [{ key: 'all' }, { key: 'x' }], categoryIndex: 0,
    capabilityFilters: [{ key: 'all' }, { key: 'dmx' }], capabilityFilterIndex: 0,
    products: [{ model: 'A', compareSelected: false }, { model: 'B', compareSelected: false }],
    compareSelectedModels: [], productComparison: null,
  }
  library.cancelSearchRefresh = () => {}
  let refreshCount = 0
  library.refresh = (_a, _b, patch) => { refreshCount += 1; Object.assign(library.data, patch) }
  library.onTypeTap(event({ index: 1 }))
  library.onTypeTap(event({ index: 1 }))
  assert.equal(refreshCount, 2, '重复类型点击保留原刷新语义')
  assert.deepEqual(vibrations, ['light'], '类型筛选重复值不重复反馈')
  library.onCategoryTap(event({ index: 1 }))
  library.onCategoryTap(event({ index: 1 }))
  library.onCapabilityTap(event({ index: 1 }))
  assert.deepEqual(vibrations, ['light', 'light', 'light'], '类型、类别和能力只在变化时反馈')
  library.toggleProductCompare(event({ model: 'A' }))
  library.toggleProductCompare(event({ model: 'A' }))
  assert.equal(vibrations.length, 5, '比较勾选和取消各反馈一次')
  library.clearProductComparison()
  assert.equal(vibrations.length, 5, '空比较列表清除不反馈')
  library.data.compareSelectedModels = ['A']
  library.clearProductComparison()
  assert.equal(vibrations.length, 6, '清空有效比较选择反馈一次')

  let importResult = { ok: true }
  const detail = loadPage('pages/products/detail.js', {
    'utils/dmx-product-import.js': {
      inspectDmxPreferences() {},
      readDmxPreferencesStatus: () => ({ ok: true, preferences: {} }),
      saveDmxProductImport: () => importResult,
    },
  })
  detail.data.dmxImportModes = [{ channelCount: '8' }, { channelCount: '16' }]
  detail.data.dmxImportChannelCount = ''
  detail.data.dmxImportAction = ''
  detail.data.dmxImportGroupsReadable = true
  detail.data.dmxImportVisible = true
  detail._dmxImportOpenedSignature = '{}'
  detail.selectDmxImportMode(event({ channelCount: '16' }))
  detail.selectDmxImportMode(event({ channelCount: '16' }))
  detail.selectDmxImportAction(event({ action: 'append' }))
  detail.selectDmxImportAction(event({ action: 'append' }))
  assert.deepEqual(vibrations.slice(-2), ['light', 'light'], 'DMX 导入选项只对变化反馈')
  const before = vibrations.length
  detail.confirmDmxProductImport()
  assert.deepEqual(vibrations.slice(before), ['medium'], '导入保存成功后反馈')
  detail.data.dmxImportVisible = true
  detail._dmxImportOpenedSignature = '{}'
  importResult = { ok: false, error: 'write failed' }
  const failedAt = vibrations.length
  detail.confirmDmxProductImport()
  assert.equal(vibrations.length, failedAt, '导入失败不反馈')
}

function testProjectsRecoveryAndClipboard() {
  resetRuntime()
  let createResult = { id: 'p' }
  let restoreResult = true
  const recordsMock = {
    createProject: () => createResult,
    getModuleMetadata: () => null,
    getWorkspaceSnapshot: () => ({ ok: true, projects: [], records: [], favorites: [], recoveryEntries: [] }),
    toggleFavoriteById: () => false,
    getProjects: () => [{ id: 'p', name: 'P' }],
    getRecoveryEntries: () => [{ id: 'r', kind: 'project', snapshot: { name: 'P' } }],
    getStorageMigrationBackups: () => ({ ok: true, backups: [] }),
    restoreRecoveryEntry: () => restoreResult,
    restoreStorageMigrationBackup: () => restoreResult,
  }
  const projects = loadPage('pages/projects/projects.js', { 'utils/records.js': recordsMock })
  projects.refresh = () => {}
  projects.refreshFiltered = () => {}
  projects.onShow()
  projects.data.tabs = ['项目', '收藏']
  projects.data.tabIndex = 0
  projects.data.projectFilters = [{ key: 'all' }, { key: 'wiring' }]
  projects.data.projectFilter = 'all'
  projects.data.favoriteModules = [{ key: 'all' }, { key: 'camera' }]
  projects.data.favoriteFilter = 'all'
  projects.onTabTap(event({ index: 1 }))
  projects.onTabTap(event({ index: 1 }))
  projects.onProjectFilterTap(event({ key: 'wiring' }))
  projects.onProjectFilterTap(event({ key: 'wiring' }))
  projects.onFavoriteFilterTap(event({ key: 'camera' }))
  assert.deepEqual(vibrations, ['light', 'light', 'light'], '项目页签与筛选只对变化反馈')
  projects.createProject()
  modalRequest.success({ confirm: false })
  assert.equal(vibrations.length, 3, '取消创建不反馈')
  projects.createProject()
  modalRequest.success({ confirm: true, content: 'P' })
  assert.deepEqual(vibrations.slice(-1), ['medium'], '项目创建成功后反馈')
  createResult = null
  projects.createProject()
  modalRequest.success({ confirm: true, content: 'P' })
  assert.equal(vibrations.at(-1), 'medium', '项目创建失败不增加反馈')

  const recovery = loadPage('pages/projects/recovery.js', {
    'utils/records.js': recordsMock,
    'utils/result-record-context.js': {
      discardInterruptedSession: () => restoreResult,
      getInterruptedSessions: () => ({ ok: true, sessions: [] }),
      resumeResultEditor: () => restoreResult,
    },
  })
  recovery.refresh = () => {}
  recovery.onShow()
  recovery.restoreEntry(event({ id: 'r' }))
  assert.equal(vibrations.at(-1), 'medium', '恢复成功后反馈')
  const beforeFail = vibrations.length
  restoreResult = false
  recovery.restoreEntry(event({ id: 'r' }))
  assert.equal(vibrations.length, beforeFail, '恢复失败不反馈')
  recovery.onHide()
  restoreResult = true
  recovery.restoreEntry(event({ id: 'r' }))
  assert.equal(vibrations.length, beforeFail, '页面隐藏后的恢复回调不反馈')

  const favorite = loadPage('pages/projects/favorite-detail.js', {
    'utils/records.js': recordsMock,
  })
  favorite.data.favorite = { id: 'f', parametersText: '{"mode":"test"}' }
  favorite._pageVisible = true
  favorite.copyParameters()
  clipboardRequest.success()
  assert.equal(vibrations.at(-1), 'medium', '复制成功后反馈')
  const beforeClipboardFailure = vibrations.length
  favorite.copyParameters()
  clipboardRequest.fail()
  assert.equal(vibrations.length, beforeClipboardFailure, '复制失败不反馈')
  const beforeHide = vibrations.length
  favorite.copyParameters()
  const staleClipboard = clipboardRequest
  favorite.onHide()
  staleClipboard.success()
  assert.equal(vibrations.length, beforeHide, '隐藏页的迟到复制回调不反馈')
  favorite.toggleRawParameters()
  assert.equal(vibrations.at(-1), 'light', '显示参数明细状态切换反馈')

}

async function testReportCompletionAndSharedHelpers() {
  resetRuntime()
  let finishBuild
  const report = loadPage('pages/records/report.js', {
    'pages/records/report-model.js': {
      REPORT_WIDTH: 750,
      buildReportPayload() {},
      getProjectReportSections: () => [{ items: [{ id: 'item-a' }] }],
      getReportSourceFingerprint() {},
      loadProjectReportSource() {},
      summarizeSelection() { return {} },
    },
    'pages/records/report-pdf-export.js': {
      buildReportPdfFile: () => new Promise((resolve, reject) => { finishBuild = { resolve, reject } }),
    },
  })
  report.reportSource = {}
  report.data.selectedItemIds = ['item-a']
  report.updateSelection = (ids) => { report.data.selectedItemIds = ids }
  report.toggleReportItem(event({ id: 'item-a' }))
  assert.equal(vibrations.at(-1), 'light', '报告条目勾选变化反馈')
  const beforeInvalid = vibrations.length
  report.toggleReportItem(event({ id: 'unknown' }))
  assert.equal(vibrations.length, beforeInvalid, '无效报告条目不反馈')
  report._reportPages = [{ path: '/one.png' }, { path: '/two.png' }]
  report.data.currentPageIndex = 0
  report.setCurrentPage(0)
  assert.equal(vibrations.length, beforeInvalid, '重复页码不反馈')
  report.setCurrentPage(1)
  assert.equal(vibrations.at(-1), 'light', '报告翻页变化反馈')
  report._unloaded = false
  report._reportRevision = 2
  report._renderedPages = [{ path: '/one.png', width: 750, height: 900 }]
  report._buildingSignature = 'report-signature'
  report.finishReportGeneration(2)
  assert.equal(vibrations.at(-1), 'medium', '报告预览完成后反馈')
  const staleCount = vibrations.length
  report.finishReportGeneration(1)
  assert.equal(vibrations.length, staleCount, '过期预览任务不反馈')

  report.data.mode = 'preview'
  report._reportPages = [{ path: '/one.png', width: 750, height: 900 }]
  report.reportSignature = 'pdf-signature'
  report.releaseReportPdfCanvas = () => {}
  report.cleanupReportPdfFile = () => {}
  report.generateReportPdf()
  const successPromise = report._pdfPromise
  finishBuild.resolve({ filePath: '/tmp/report.pdf', pageCount: 1 })
  await successPromise
  assert.equal(vibrations.at(-1), 'medium', 'PDF 完成后反馈')

  report._reportPdfPath = ''
  report._reportPdfSignature = ''
  report.generateReportPdf()
  const canceledPromise = report._pdfPromise
  const beforeCancel = vibrations.length
  report.cancelReportPdfExport()
  finishBuild.resolve({ filePath: '/tmp/stale.pdf', pageCount: 1 })
  await canceledPromise
  assert.equal(vibrations.length, beforeCancel, '取消后迟到的 PDF 成功回调不反馈')

  report.generateReportPdf()
  const failedPromise = report._pdfPromise
  const beforeFailure = vibrations.length
  finishBuild.reject(new Error('write failed'))
  await failedPromise
  assert.equal(vibrations.length, beforeFailure, 'PDF 失败不反馈')

  const favoriteSource = fs.readFileSync(path.join(ROOT, 'pages/projects/favorite-detail.js'), 'utf8')
  const actionSource = fs.readFileSync(path.join(ROOT, 'utils/result-record-actions.js'), 'utf8')
  assert.match(actionSource, /function togglePageFavorite[\s\S]*?vibrate\('medium'\)/, '收藏 helper 负责自身成功反馈')
  assert.doesNotMatch(favoriteSource.match(/openWorkingCopy\(\) \{[\s\S]*?\n  \},/)?.[0] || '', /vibrate\(/, '打开收藏副本不重复触感')
  for (const [file, method] of [
    ['pages/tools/tools.js', 'openSettings'],
    ['pages/products/library.js', 'onSearchInput'],
    ['pages/projects/projects.js', 'onSearchInput'],
    ['pages/records/project.js', 'onProjectScroll'],
    ['pages/records/project.js', 'openProjectReport'],
  ]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const body = source.match(new RegExp(`${method}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\},`))?.[0] || ''
    assert.doesNotMatch(body, /vibrate\(/, `${file}.${method} 不触感`)
  }
}

async function main() {
  testChangedChoicesAndSettingsPersistence()
  testProductSelectionsAndImport()
  testProjectsRecoveryAndClipboard()
  await testReportCompletionAndSharedHelpers()
  console.log('haptics-ui-regression PASS: effective selections, persistence failures, successful callbacks, cancellation/stale guards, and shared-helper de-duplication')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')

const root = path.resolve(__dirname, '..')

function loadPage(relativePath, mocks) {
  const filename = path.join(root, relativePath)
  const pageModule = new Module(filename, module)
  pageModule.filename = filename
  pageModule.paths = Module._nodeModulePaths(path.dirname(filename))
  const previousPage = global.Page
  const originalLoad = Module._load
  let definition
  global.Page = (page) => { definition = page }
  Module._load = function loadMockedPageDependency(request, parent, isMain) {
    if (parent && parent.filename === filename && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request]
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    pageModule._compile(fs.readFileSync(filename, 'utf8'), filename)
  } finally {
    Module._load = originalLoad
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
  assert.ok(definition, `${relativePath} registered a Page controller`)
  return definition
}

function instantiate(definition) {
  const instance = Object.create(definition)
  instance.data = JSON.parse(JSON.stringify(definition.data))
  instance.setData = function setData(patch, callback) {
    Object.assign(this.data, patch)
    if (callback) callback()
  }
  return instance
}

const toolsDefinition = loadPage('pages/tools/tools.js', {
  '../../data/app-meta': { APP_VERSION: 'test', PRODUCT_DATA_DATE: 'test' },
  '../../utils/preferences': { removePreferences: () => true },
  '../../utils/haptics': { vibrate() {} },
})
assert.deepStrictEqual(toolsDefinition.data.audioModules.map(({ id }) => id), [
  'audioWiring', 'projectWiring', 'gainStructure', 'limiter', 'spl', 'venue', 'cable',
])
assert.strictEqual(toolsDefinition.data.audioModules[0].title, '接线助手')
assert.strictEqual(toolsDefinition.data.audioModules[1].title, '通道与线缆')
assert.strictEqual(toolsDefinition.data.audioModules[1].path, '/pages/project-wiring/index')
const projectWiringImage = '/assets/home/module-project-wiring-catalog.png'
assert.strictEqual(toolsDefinition.data.audioModules[1].image, projectWiringImage)
const projectWiringImagePath = path.join(root, 'assets', 'home', 'module-project-wiring-catalog.png')
assert(fs.existsSync(projectWiringImagePath), '通道与线缆入口专属图片文件缺失')

const toolsWxml = fs.readFileSync(path.join(root, 'pages/tools/tools.wxml'), 'utf8')
const toolsWxss = fs.readFileSync(path.join(root, 'pages/tools/tools.wxss'), 'utf8')
assert(toolsWxml.includes('url="{{item.path}}"'))
const audioModuleVisual = toolsWxml.match(/<navigator wx:for="{{audioModules}}"[\s\S]*?<view class="module-visual">([\s\S]*?)<\/view>/)
assert(audioModuleVisual)
assert.strictEqual(audioModuleVisual[1].trim(),
  '<image class="module-image" src="{{item.image}}" mode="aspectFit" lazy-load aria-label="{{item.title}}配图" />')
assert(!toolsWxml.includes('project-wiring-visual') && !toolsWxss.includes('.project-wiring-visual')
  && !toolsWxss.includes('.wiring-device') && !toolsWxss.includes('.wiring-cable')
  && !toolsWxss.includes('.wiring-list-mark'), '通道与线缆入口仍保留 CSS 图形分支')
assert(toolsWxss.includes('.module-card{') && toolsWxss.includes('width:196rpx;height:234rpx'))

let workspace = null
let lastWorkspaceOptions = null
let projectCreateModalCount = 0
const routes = []
let activeProjectChanges = 0
const recordsApi = {
  MODULES: { limiter: { label: '限幅器', trustLabel: '核验完成', theme: 'blue' } },
  getWorkspaceSnapshot: (options) => { lastWorkspaceOptions = options; return workspace },
  setActiveProject() { activeProjectChanges += 1; return true },
}
const projectsDefinition = loadPage('pages/projects/projects.js', {
  '../../utils/performance': {
    printPerformanceSummary() {},
    startMeasurement: () => () => null,
  },
  '../../utils/records': recordsApi,
})
const previousWx = global.wx
global.wx = {
  navigateTo: ({ url }) => routes.push(url),
  showModal: () => { projectCreateModalCount += 1 },
  showToast() {},
}
try {
  const project = {
    id: 'project / 42',
    name: '社区剧场',
    updatedAt: 100,
    wiringSchedule: {
      revision: 4,
      lines: [{ id: 'line-1' }, { id: 'line-2' }, { id: 'line-3' }],
    },
  }
  const favorite = {
    id: 'favorite-1', updatedAt: 99, favorite: true, module: 'limiter',
    title: '功放限幅器', summary: '限幅建议', projectIds: [],
  }
  workspace = { projects: [project], records: [favorite], activeProject: project }
  const page = instantiate(projectsDefinition)
  page.onShow()
  assert.deepStrictEqual(page.data.recordTabs, ['现场项目', '常用收藏'])
  assert.strictEqual(page.data.recordTabIndex, 0)
  assert.strictEqual(page.data.projects.length, 1)
  assert.strictEqual(page.data.projects[0].wiringLineCount, 3)
  assert.strictEqual(Object.hasOwn(page.data.projects[0], 'wiringSchedule'), false,
    '项目卡视图只接收线路数，不携带完整 schedule')
  assert.strictEqual(Object.hasOwn(page.data.activeProject, 'wiringSchedule'), false,
    '当前项目视图不携带完整 schedule')
  assert.deepStrictEqual(page.data.displayRecords, [], '首页默认显示现场项目')

  page.openProjectWiring({ currentTarget: { dataset: { id: project.id } } })
  assert.strictEqual(routes.at(-1), '/pages/project-wiring/index?id=project%20%2F%2042',
    '项目布线入口必须携带明确且编码后的项目 id')
  assert.strictEqual(activeProjectChanges, 0, '直接布线入口不应切换当前项目')
  page.openProjectReport({ currentTarget: { dataset: { id: project.id } } })
  assert.strictEqual(routes.at(-1), `/pages/records/project?id=${project.id}`,
    '报告按钮打开既有项目详情')

  page.onRecordTabTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(page.data.recordTabIndex, 1)
  assert.strictEqual(page.data.displayRecords.length, 1)
  assert.strictEqual(page.data.displayRecords[0].id, favorite.id, '常用收藏标签仍显示收藏记录')
  page.onShow()
  assert.strictEqual(page.data.recordTabIndex, 1, '重新显示页面时保留用户选择的标签')

  const priorDisplayRecords = page.data.displayRecords
  workspace = { ok: false, error: '本地项目和收藏数据读取失败，请重试。', projects: [], records: [], activeProject: null }
  page.refreshWorkspace('readFailure')
  assert.strictEqual(page.data.workspaceError, workspace.error, '读取失败时显示错误状态')
  assert.strictEqual(page.data.projects[0].id, project.id, '读取失败保留上次成功项目')
  assert.strictEqual(page.data.displayRecords, priorDisplayRecords, '读取失败保留上次成功收藏视图')
  page.createProject()
  assert.strictEqual(projectCreateModalCount, 0, '读取失败时不开放新建写入入口')

  workspace = { ok: true, projects: [project], records: [favorite], activeProject: project }
  page.retryWorkspace()
  assert.strictEqual(lastWorkspaceOptions.forceRefresh, true, '重试必须绕过存储缓存重新读取')
  assert.strictEqual(page.data.workspaceError, '', '同一快照重读成功也清除错误横幅')
  assert.strictEqual(page.data.projects[0].id, project.id)

  workspace = { projects: [], records: [favorite], activeProject: null }
  const emptyPage = instantiate(projectsDefinition)
  emptyPage.onShow()
  assert.strictEqual(emptyPage.data.recordTabIndex, 0)
  assert.deepStrictEqual(emptyPage.data.projects, [], '无项目时项目列表为空')
  assert.deepStrictEqual(emptyPage.data.displayRecords, [], '无项目首页不误显示收藏结果')
  emptyPage.onRecordTabTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(emptyPage.data.displayRecords[0].id, favorite.id,
    '无项目时仍可以切换并查看常用收藏')
  assert.strictEqual(activeProjectChanges, 0)
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

const projectsWxml = fs.readFileSync(path.join(root, 'pages/projects/projects.wxml'), 'utf8')
const projectsWxss = fs.readFileSync(path.join(root, 'pages/projects/projects.wxss'), 'utf8')
assert(projectsWxml.includes('catchtap="openProjectWiring"') && projectsWxml.includes('catchtap="openProjectReport"'))
assert(projectsWxml.includes('{{item.wiringLineCount}} 条线路'))
assert(projectsWxml.includes('新建项目，整理线路和计算结果。'))
assert(!projectsWxml.includes('project-open-hint'))
assert(projectsWxss.includes('.project-primary-actions .project-action{box-sizing:border-box;flex:1;min-width:0;height:88rpx;min-height:44px;')
  && projectsWxss.includes('border-radius:22rpx;font-size:27rpx;font-weight:600;'))

const projectDetailWxml = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
assert(projectDetailWxml.includes('<view class="project-wiring-title">通道与线缆</view>'))
assert(projectDetailWxml.includes('<view class="project-wiring-subtitle">线路端点与材料清单</view>'))

let detailWorkspace = { ok: true, projects: [], records: [], activeProject: null }
const detailSnapshotOptions = []
const detailEffects = { activate: 0, prepare: 0, update: 0, restore: 0, remove: 0, clipboard: 0, image: 0, navigate: 0 }
let detailReportExport = null
const detailProject = { id: 'detail-project', name: '详情存储测试', createdAt: 1, updatedAt: 2 }
const detailRecord = {
  id: 'detail-record', module: 'limiter', projectIds: [detailProject.id], updatedAt: 2,
  title: '限幅测试', summary: '测试摘要', resultText: '测试结果',
}
const detailRecordsApi = {
  MODULES: { limiter: { label: '限幅器', trustLabel: '产品参数计算', trustDescription: '', theme: 'cyan' } },
  getWorkspaceSnapshot(options) { detailSnapshotOptions.push(options); return detailWorkspace },
  getProjectRecordView: require('../utils/records').getProjectRecordView,
  getStorageHealth: () => ({ warning: false, text: '本地保存', percent: 1 }),
  prepareProjectModule() { detailEffects.prepare += 1; return '/pages/limiter/limiter' },
  removeRecordFromProject() { detailEffects.remove += 1; return true },
  restoreRecord() { detailEffects.restore += 1; return '/pages/limiter/limiter' },
  setActiveProject() { detailEffects.activate += 1; return true },
  updateProject() { detailEffects.update += 1; return true },
}
const previousDetailWx = global.wx
global.wx = {
  setNavigationBarTitle() {},
  showToast() {},
  showModal() {},
  showLoading() {},
  hideLoading() { detailEffects.hideLoading = (detailEffects.hideLoading || 0) + 1 },
  navigateTo() { detailEffects.navigate += 1 },
  setClipboardData() { detailEffects.clipboard += 1 },
  createCanvasContext: () => ({}),
  canvasToTempFilePath() {},
}
try {
  const detailDefinition = loadPage('pages/records/project.js', {
    '../../data/app-meta': { APP_VERSION: 'test', PRODUCT_DATA_DATE: 'test' },
    '../../utils/performance': { printPerformanceSummary() {}, startMeasurement: () => () => null },
    '../../utils/haptics': { vibrate() {} },
    '../../utils/records': detailRecordsApi,
    '../../utils/report-canvas': { drawAndExportReport: (page, options) => { detailReportExport = options } },
    '../../utils/report-image-actions': {
      previewGeneratedImage() { detailEffects.image += 1 },
      saveGeneratedImage() { detailEffects.image += 1 },
      shareGeneratedImage() { detailEffects.image += 1 },
    },
    './project-report': {
      REPORT_CANVAS_ID: 'test-canvas',
      REPORT_WIDTH: 720,
      buildProjectReportPayload: () => ({ groups: [] }),
      calculateProjectReportHeight: () => 1200,
      drawProjectReport() {},
      getExportDimensions: () => ({}),
    },
  })
  detailWorkspace = { ok: true, projects: [detailProject], records: [detailRecord], activeProject: detailProject }
  const detailPage = instantiate(detailDefinition)
  detailPage.onLoad({ id: detailProject.id })
  assert.strictEqual(detailSnapshotOptions.at(-1).forceRefresh, true, '详情初次进入绕过本地快照缓存')
  detailPage.onShow()
  assert.strictEqual(detailPage.data.project.id, detailProject.id)
  detailPage.data.reportImagePath = '/tmp/previous-report.png'
  detailPage.generateProjectReportImage()
  assert.ok(detailReportExport && detailReportExport.isCurrent(), '报告生成回调初始有效')
  const isCurrentReport = detailReportExport.isCurrent
  detailPage.data.reportPreviewVisible = true
  detailWorkspace = { ok: false, error: '本地读取失败', projects: [detailProject], records: [detailRecord], activeProject: detailProject }
  detailPage.onShow()
  assert.strictEqual(detailSnapshotOptions.at(-1).forceRefresh, true, '返回详情页时重新验证本地存储')
  assert.strictEqual(detailPage.data.project.id, detailProject.id, '读取失败保留上次成功项目')
  assert.strictEqual(detailPage.data.records.length, 1, '读取失败保留上次成功记录')
  assert.strictEqual(detailPage.data.reportImagePath, '/tmp/previous-report.png', '读取失败保留上次报告')
  assert.strictEqual(detailPage.data.reportPreviewVisible, true, '读取失败保留预览状态')
  assert.strictEqual(detailPage.data.workspaceError, '本地读取失败')
  assert.strictEqual(detailPage.data.isGeneratingReport, false, '读取失败停止报告生成')
  assert.strictEqual(isCurrentReport(), false, '读取失败使过期报告回调失效')
  assert.strictEqual(detailPage.reportPendingSignature, '', '读取失败清除待完成报告签名')
  assert.ok(detailEffects.hideLoading > 0, '读取失败关闭生成提示')

  detailPage.activateProject()
  detailPage.startEditProject()
  detailPage.openProjectModule({ currentTarget: { dataset: { module: 'limiter' } } })
  detailPage.openProjectWiring()
  detailPage.saveProjectDetails()
  detailPage.restoreRecord({ currentTarget: { dataset: { id: detailRecord.id } } })
  detailPage.removeProjectRecord({ currentTarget: { dataset: { id: detailRecord.id } } })
  detailPage.copyProject()
  detailPage.generateProjectReportImage()
  detailPage.saveProjectReportImage()
  detailPage.shareProjectReportImage()
  detailPage.previewProjectReportImage()
  assert.deepStrictEqual(detailEffects, {
    activate: 0, prepare: 0, update: 0, restore: 0, remove: 0,
    clipboard: 0, image: 0, navigate: 0, hideLoading: detailEffects.hideLoading,
  }, '读取失败期间阻止写入、复制、导出和导航')

  detailWorkspace = { ok: true, projects: [detailProject], records: [detailRecord], activeProject: detailProject }
  detailPage.retryWorkspace()
  assert.strictEqual(detailSnapshotOptions.at(-1).forceRefresh, true, '重试强制重新读取存储')
  assert.strictEqual(detailPage.data.workspaceError, '', '同一快照重试成功时清除错误')

  detailWorkspace = { ok: false, error: '冷启动读取失败', projects: [], records: [], activeProject: null }
  const coldPage = instantiate(detailDefinition)
  coldPage.onLoad({ id: detailProject.id })
  assert.strictEqual(coldPage.data.missing, false, '冷启动存储错误不误报项目不存在')
  assert.strictEqual(coldPage.data.workspaceError, '冷启动读取失败')
  detailWorkspace = { ok: true, projects: [], records: [], activeProject: null }
  coldPage.retryWorkspace()
  assert.strictEqual(coldPage.data.missing, true, '重试成功确认项目不存在')
  assert.strictEqual(coldPage.data.workspaceError, '', '确认不存在后清除错误状态')

  const erroredMissingPage = instantiate(detailDefinition)
  erroredMissingPage.onLoad({ id: detailProject.id })
  detailWorkspace = { ok: false, error: '再次读取失败', projects: [], records: [], activeProject: null }
  erroredMissingPage.refresh()
  detailWorkspace = { ok: true, projects: [], records: [], activeProject: null }
  erroredMissingPage.retryWorkspace()
  assert.strictEqual(erroredMissingPage.data.missing, true)
  assert.strictEqual(erroredMissingPage.data.workspaceError, '', '已知缺失项目重试后清除错误')
} finally {
  if (previousDetailWx === undefined) delete global.wx
  else global.wx = previousDetailWx
}

assert(projectDetailWxml.includes('bindtap="retryWorkspace"'), '详情页读取错误提供重试')
assert(projectDetailWxml.includes('disabled="{{workspaceError}}"'), '详情页错误时禁用保存和导出控件')

const recordsModulePath = require.resolve('../utils/records')
const priorRecordsModule = require.cache[recordsModulePath]
const priorStorageWx = global.wx
const storageKeys = {
  records: 'audioTool.records.v1',
  projects: 'audioTool.projects.v1',
  active: 'audioTool.activeProject.v1',
  schema: 'audioTool.storageSchemaVersion',
}
try {
  for (const failingKey of [storageKeys.records, storageKeys.projects]) {
    const persisted = new Map([
      [storageKeys.projects, [{
        id: 'warm-project', name: '缓存项目', createdAt: 100, updatedAt: 200,
        projectDate: '2026-10-01',
      }]],
      [storageKeys.records, [{
        id: 'warm-favorite', module: 'limiter', favorite: true, projectIds: [],
        preferences: { model: 'test' }, resultText: '测试结果', title: '缓存收藏',
        summary: '离线读取前的已展示记录', createdAt: 100, updatedAt: 200,
      }]],
      [storageKeys.active, 'warm-project'],
      [storageKeys.schema, 3],
    ])
    let readFailureKey = ''
    const clone = (value) => value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
    global.wx = {
      getStorageSync(key) {
        if (key === readFailureKey) throw new Error('simulated single-key read failure')
        return clone(persisted.get(key))
      },
      setStorageSync(key, value) { persisted.set(key, clone(value)) },
      showToast() {},
    }
    delete require.cache[recordsModulePath]
    const actualRecords = require('../utils/records')
    const actualSnapshot = actualRecords.getWorkspaceSnapshot({ forceRefresh: true })
    assert.strictEqual(actualSnapshot.ok, true, '真实records模块先成功读入本地工作区')
    const snapshotCalls = []
    const getSnapshot = actualRecords.getWorkspaceSnapshot
    actualRecords.getWorkspaceSnapshot = (options) => {
      snapshotCalls.push(options)
      return getSnapshot(options)
    }
    const projectsPageDefinition = loadPage('pages/projects/projects.js', {
      '../../utils/performance': { printPerformanceSummary() {}, startMeasurement: () => () => null },
      '../../utils/records': actualRecords,
    })
    const page = instantiate(projectsPageDefinition)
    page.onShow()
    assert.strictEqual(page.data.projects[0].id, 'warm-project')
    page.onRecordTabTap({ currentTarget: { dataset: { index: 1 } } })
    assert.strictEqual(page.data.displayRecords[0].id, 'warm-favorite')
    const previousProjects = page.data.projects
    const previousFavorites = page.data.displayRecords

    readFailureKey = failingKey
    page.onShow()
    assert.strictEqual(snapshotCalls.at(-1).forceRefresh, true, '项目页onShow绕过已暖缓存')
    assert.ok(page.data.workspaceError, `${failingKey}读取失败显示错误状态`)
    assert.strictEqual(page.data.projects, previousProjects, '单键读取失败保留上次项目视图')
    assert.strictEqual(page.data.displayRecords, previousFavorites, '单键读取失败保留上次收藏视图')

    readFailureKey = ''
    page.retryWorkspace()
    assert.strictEqual(page.data.workspaceError, '', '恢复读取后清除错误状态')
    assert.strictEqual(page.data.projects[0].id, 'warm-project')
    assert.strictEqual(page.data.displayRecords[0].id, 'warm-favorite')
    delete require.cache[recordsModulePath]
  }
} finally {
  delete require.cache[recordsModulePath]
  if (priorRecordsModule) require.cache[recordsModulePath] = priorRecordsModule
  if (priorStorageWx === undefined) delete global.wx
  else global.wx = priorStorageWx
}

console.log('项目布线双入口、项目页存储失败闭环专项通过。')

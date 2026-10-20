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

const priorToolWx = global.wx
const toolStorage = new Map()
global.wx = {
  getStorageSync: (key) => toolStorage.get(key),
  setStorageSync: (key, value) => toolStorage.set(key, value),
  removeStorageSync: (key) => toolStorage.delete(key),
}
const toolsDefinition = loadPage('pages/tools/tools.js', {
  '../../data/app-meta': { APP_VERSION: 'test', PRODUCT_DATA_DATE: 'test' },
  '../../utils/preferences': { removePreferences: () => true },
  '../../utils/haptics': { vibrate() {} },
})
const { CATEGORY_FILTERS, getTool, getTools } = require('../utils/tool-registry')
const { TOOL_VISIBILITY_KEY } = require('../utils/tool-visibility')
assert.deepStrictEqual(CATEGORY_FILTERS, ['全部', '布线', '音频', '视频', '灯光', '中控'])
assert.deepStrictEqual(getTools('布线').map(({ id }) => id), ['audioWiring', 'projectWiring', 'cable'])
assert.deepStrictEqual(toolsDefinition.data.categories, CATEGORY_FILTERS)
assert.strictEqual(getTool('audioWiring').title, '接线助手')
assert.strictEqual(getTool('projectWiring').title, '通道与线缆')
assert.strictEqual(getTool('projectWiring').path, '/pages/project-wiring/index')
const projectWiringImagePath = path.join(root, 'assets', 'home', 'module-project-wiring-catalog.png')
assert(fs.existsSync(projectWiringImagePath), '通道与线缆入口专属图片文件缺失')

const toolsWxml = fs.readFileSync(path.join(root, 'pages/tools/tools.wxml'), 'utf8')
assert(toolsWxml.includes('<navigator wx:for="{{tools}}"') && toolsWxml.includes('url="{{item.path}}"'),
  '整个工具目录卡片通过 registry 路由打开')
assert(toolsWxml.includes('wx:for="{{categories}}"') && toolsWxml.includes('data-category="{{item}}"'),
  '工具分类筛选使用 registry 提供的分类')
assert(toolsWxml.includes('aria-label="打开{{item.title}}，{{item.subtitle}}"'),
  '工具卡路由保留标题和用途的辅助信息')
const toolsPageInstance = instantiate(toolsDefinition)
try {
  toolsPageInstance.onShow()
  assert.deepStrictEqual(toolsPageInstance.data.tools.map(({ id }) => id), getTools('全部').map(({ id }) => id),
    '首页工具目录通过真实可见性接口展示 registry 的完整结果')
  assert.strictEqual(toolsPageInstance.data.tools.find(({ id }) => id === 'projectWiring').icon,
    '/assets/home/module-project-wiring-catalog.png')
  toolStorage.set(TOOL_VISIBILITY_KEY, { version: 1, hiddenToolIds: ['limiter'] })
  toolsPageInstance.onShow()
  assert(!toolsPageInstance.data.tools.some(({ id }) => id === 'limiter'),
    '关闭的工具通过真实存储设置从工具目录筛除')
  assert.deepStrictEqual(toolsPageInstance.data.tools.map(({ id }) => id),
    getTools('全部').filter(({ id }) => id !== 'limiter').map(({ id }) => id),
    '可见性筛选保留其余工具和 registry 顺序')
  toolStorage.delete(TOOL_VISIBILITY_KEY)
  toolsPageInstance.onShow()
  toolsPageInstance.onCategoryTap({ currentTarget: { dataset: { category: '布线' } } })
  assert.deepStrictEqual(toolsPageInstance.data.tools.map(({ id }) => id), ['audioWiring', 'projectWiring', 'cable'],
    '布线筛选仍展示接线助手、通道与线缆、线材选型')
  toolsPageInstance.onCategoryTap({ currentTarget: { dataset: { category: '未知分类' } } })
  assert.deepStrictEqual(toolsPageInstance.data.tools.map(({ id }) => id), ['audioWiring', 'projectWiring', 'cable'],
    '未知分类不会清空上次有效的工具列表')
} finally {
  if (priorToolWx === undefined) delete global.wx
  else global.wx = priorToolWx
}

let workspace = null
let lastWorkspaceOptions = null
let projectCreateModalCount = 0
const routes = []
let activeProjectChanges = 0
const recordsApi = {
  MODULES: { limiter: { label: '限幅器', trustLabel: '核验完成', theme: 'blue' } },
  getModuleMetadata: (key) => recordsApi.MODULES[key],
  getWorkspaceSnapshot: (options) => { lastWorkspaceOptions = options; return workspace },
  setActiveProject() { activeProjectChanges += 1; return true },
}
const projectsDefinition = loadPage('pages/projects/projects.js', {
  '../../utils/performance': {
    printPerformanceSummary() {},
    startMeasurement: () => () => null,
  },
  '../../utils/records': recordsApi,
  '../dmx-layout/lighting-workspace': { getLightingContexts: () => ({ ok: true, rows: [] }) },
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
  workspace = { ok: true, projects: [project], records: [favorite], favorites: [favorite], recoveryEntries: [], activeProject: project }
  const page = instantiate(projectsDefinition)
  page.onShow()
  assert.deepStrictEqual(page.data.tabs, ['项目', '收藏'])
  assert.strictEqual(page.data.tabIndex, 0)
  assert.strictEqual(page.data.projects.length, 1)
  assert.strictEqual(page.data.projects[0].wiringCount, 3)
  assert.strictEqual(Object.hasOwn(page.data.projects[0], 'wiringSchedule'), false,
    '项目卡视图只接收线路数，不携带完整 schedule')
  assert.strictEqual(Object.hasOwn(page.data, 'activeProject'), false, '项目列表不绑定历史当前项目状态')
  assert.strictEqual(page.data.favorites[0].id, favorite.id, '收藏视图数据保留，首屏由项目标签展示现场项目')

  page.openProject({ currentTarget: { dataset: { id: project.id } } })
  assert.strictEqual(routes.at(-1), '/pages/records/project?id=project%20%2F%2042',
    '项目卡以编码后的稳定 ID 打开项目详情')
  assert.strictEqual(activeProjectChanges, 0, '打开项目详情不会切换当前项目')

  page.onTabTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(page.data.tabIndex, 1)
  assert.strictEqual(page.data.favorites.length, 1)
  assert.strictEqual(page.data.favorites[0].id, favorite.id, '收藏标签仍显示收藏记录')
  page.onShow()
  assert.strictEqual(page.data.tabIndex, 1, '重新显示页面时保留用户选择的标签')

  const priorDisplayRecords = page.data.favorites
  workspace = { ok: false, error: '本地项目和收藏数据读取失败，请重试。', projects: [], records: [], favorites: [], recoveryEntries: [], activeProject: null }
  page.refresh({ forceRefresh: true })
  assert.strictEqual(page.data.workspaceError, workspace.error, '读取失败时显示错误状态')
  assert.strictEqual(page.data.projects[0].id, project.id, '读取失败保留上次成功项目')
  assert.strictEqual(page.data.favorites, priorDisplayRecords, '读取失败保留上次成功收藏视图')
  page.createProject()
  assert.strictEqual(projectCreateModalCount, 0, '读取失败时不开放新建写入入口')

  workspace = { ok: true, projects: [project], records: [favorite], favorites: [favorite], recoveryEntries: [], activeProject: project }
  page.retryWorkspace()
  assert.strictEqual(lastWorkspaceOptions.forceRefresh, true, '重试必须绕过存储缓存重新读取')
  assert.strictEqual(page.data.workspaceError, '', '同一快照重读成功也清除错误横幅')
  assert.strictEqual(page.data.projects[0].id, project.id)

  workspace = { ok: true, projects: [], records: [favorite], favorites: [favorite], recoveryEntries: [], activeProject: null }
  const emptyPage = instantiate(projectsDefinition)
  emptyPage.onShow()
  assert.strictEqual(emptyPage.data.tabIndex, 0)
  assert.deepStrictEqual(emptyPage.data.projects, [], '无项目时项目列表为空')
  assert.strictEqual(emptyPage.data.favorites[0].id, favorite.id, '无项目首页仍保留独立收藏数据')
  emptyPage.onTabTap({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(emptyPage.data.favorites[0].id, favorite.id,
    '无项目时仍可以切换并查看常用收藏')
  assert.strictEqual(activeProjectChanges, 0)
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

const projectsWxml = fs.readFileSync(path.join(root, 'pages/projects/projects.wxml'), 'utf8')
const projectsWxss = fs.readFileSync(path.join(root, 'pages/projects/projects.wxss'), 'utf8')
assert(projectsWxml.includes('class="home-panel project-list-card"') && projectsWxml.includes('bindtap="openProject"'))
assert(projectsWxml.includes('{{item.contentText}}') && projectsWxml.includes('线路'))
assert(projectsWxml.includes('项目') && projectsWxml.includes('收藏'))
assert(!projectsWxml.includes('project-open-hint'))
assert(!projectsWxml.includes('project-current-badge') && !projectsWxml.includes('size="mini"'),
  '项目入口没有当前项目徽标，恢复/新建按钮不受 mini 原生尺寸样式影响')
assert(projectsWxss.includes('.project-header .project-header-actions button.project-recovery-button')
  && projectsWxss.includes('height:44px;min-height:44px;max-height:44px;')
  && projectsWxss.includes('padding:0 14px;align-items:center;justify-content:center;')
  && projectsWxss.includes('line-height:44px;'), '恢复/新建按钮覆盖原生行高并四向居中')
assert(projectsWxss.includes('.project-tab{') && projectsWxss.includes('min-height:44px;flex:1;'))

const projectDetailWxml = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
assert(projectDetailWxml.includes('<view class="interior-section-title">通道与线缆</view>'))
assert(projectDetailWxml.includes('data-id="{{item.id}}" bindtap="openProjectWiring"')
  && projectDetailWxml.includes('data-swipe-type="line"')
  && projectDetailWxml.includes('catchtap="onProjectSwipeDelete"'))
assert(projectDetailWxml.includes('{{item.endpointSummary}}') && projectDetailWxml.includes('{{item.materialSummary}}'),
  '项目线路卡显示真实端点和材料信息，并整卡打开布线工作区')

let detailWorkspace = { ok: true, projects: [], records: [], activeProject: null }
const detailSnapshotOptions = []
const detailEffects = { activate: 0, draft: 0, recordEditor: 0, delete: 0, update: 0, actionSheet: 0, modal: 0, clipboard: 0, image: 0, navigate: 0, navigateBack: 0 }
let detailReportExport = null
const detailUrls = []
const detailActionSheets = []
const detailProject = { id: 'detail-project', name: '详情存储测试', createdAt: 1, updatedAt: 2 }
const detailRecord = {
  id: 'detail-record', module: 'limiter', projectIds: [detailProject.id], updatedAt: 2,
  title: '限幅测试', summary: '测试摘要', resultText: '测试结果',
}
const detailRecordsApi = {
  MODULES: {
    limiter: { label: '限幅器', path: '/pages/limiter/limiter', trustLabel: '产品参数计算', trustDescription: '', theme: 'cyan' },
    dmxAddress: { label: '灯具编址', path: '/pages/dmx-address/dmx-address' },
  },
  getModuleMetadata: (key) => detailRecordsApi.MODULES[key],
  getWorkspaceSnapshot(options) { detailSnapshotOptions.push(options); return detailWorkspace },
  getProjectRecordView: require('../utils/records').getProjectRecordView,
  getStorageHealth: () => ({ warning: false, text: '本地保存', percent: 1 }),
  deleteProject() { detailEffects.delete += 1; return true },
  setActiveProject() { detailEffects.activate += 1; return true },
  updateProject() { detailEffects.update += 1; return true },
}
const previousDetailWx = global.wx
global.wx = {
  setNavigationBarTitle() {},
  showToast() {},
  showModal() { detailEffects.modal += 1 },
  showLoading() {},
  hideLoading() { detailEffects.hideLoading = (detailEffects.hideLoading || 0) + 1 },
  navigateTo({ url }) { detailEffects.navigate += 1; detailUrls.push(url) },
  navigateBack() { detailEffects.navigateBack += 1 },
  showActionSheet(options) { detailEffects.actionSheet += 1; detailActionSheets.push(options) },
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
    '../../utils/result-record-context': {
      openProjectDraft() { detailEffects.draft += 1; return 'draft-session' },
      openRecordEditor() { detailEffects.recordEditor += 1; return true },
    },
    '../dmx-layout/lighting-workspace': {
      readLightingWorkspace: () => ({ ok: true, scheme: { fixtures: [] }, revision: 1 }),
      calculateScheme: () => ({ ok: true, valid: true, result: { fixtures: [] } }),
    },
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
  detailPage.openProjectWiring()
  assert.strictEqual(detailUrls.at(-1), '/pages/project-wiring/index?id=detail-project',
    '项目详情线路入口沿用稳定项目 ID，并明确进入对应线路工作区')
  assert.strictEqual(detailEffects.activate, 0, '打开项目线路不会写入历史项目状态')
  detailPage.openManagementMenu()
  assert(!detailActionSheets.at(-1).itemList.includes('设为当前项目'), '项目菜单不提供设为当前项目功能')
  detailPage.openProjectReport()
  assert.strictEqual(detailUrls.at(-1), '/pages/records/report?id=detail-project',
    '项目报告入口使用稳定项目 ID 的正式报告路由')
  detailPage.openAddProjectModule()
  assert.deepStrictEqual(detailActionSheets.at(-1).itemList, ['计算记录', '通道与线缆', '灯位方案'],
    '单一添加内容菜单保留计算、线路和灯位三个入口')
  detailActionSheets.at(-1).success({ tapIndex: 1 })
  assert.strictEqual(detailUrls.at(-1), '/pages/project-wiring/index?id=detail-project',
    '项目添加菜单的线路入口保持项目上下文')
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

  detailPage.startEditProject()
  detailPage.openProjectModule({ currentTarget: { dataset: { module: 'limiter' } } })
  detailPage.openProjectWiring()
  detailPage.openProjectLighting()
  detailPage.openProjectReport()
  detailPage.openManagementMenu()
  detailPage.openAddProjectModule()
  detailPage.confirmDeleteProject()
  detailPage.saveProjectDetails()
  detailPage.onProjectItemTap({ currentTarget: { dataset: { id: detailRecord.id } } })
  detailPage.copyProject()
  detailPage.generateProjectReportImage()
  detailPage.saveProjectReportImage()
  detailPage.shareProjectReportImage()
  detailPage.previewProjectReportImage()
  assert.deepStrictEqual(detailEffects, {
    activate: 0, draft: 0, recordEditor: 0, delete: 0, update: 0, actionSheet: 2, modal: 0,
    clipboard: 0, image: 0, navigate: 3, navigateBack: 0, hideLoading: detailEffects.hideLoading,
  }, '读取失败期间阻止项目资料写入、删除、弹层、记录编辑、复制、导出和导航')

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
  favorites: 'audioTool.favorites.v1',
  recovery: 'audioTool.recovery.v1',
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
        id: 'warm-record', module: 'limiter', favorite: false, projectIds: ['warm-project'],
        preferences: { model: 'test-record' }, resultText: '测试结果', title: '缓存计算记录',
        summary: '离线读取前的项目计算记录', createdAt: 100, updatedAt: 200,
      }]],
      [storageKeys.favorites, [{
        id: 'warm-favorite', module: 'limiter', favorite: true, projectIds: [],
        preferences: { model: 'test-favorite' }, resultText: '测试收藏结果', title: '缓存收藏',
        summary: '离线读取前的已展示收藏', createdAt: 100, updatedAt: 200,
      }]],
      [storageKeys.recovery, []],
      [storageKeys.active, 'warm-project'],
      [storageKeys.schema, 4],
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
    page.onTabTap({ currentTarget: { dataset: { index: 1 } } })
    assert.strictEqual(page.data.favorites[0].id, 'warm-favorite')
    const previousProjects = page.data.projects
    const previousFavorites = page.data.favorites

    readFailureKey = failingKey
    page.onShow()
    assert.strictEqual(snapshotCalls.at(-1).forceRefresh, true, '项目页onShow绕过已暖缓存')
    assert.ok(page.data.workspaceError, `${failingKey}读取失败显示错误状态`)
    assert.strictEqual(page.data.projects, previousProjects, '单键读取失败保留上次项目视图')
    assert.strictEqual(page.data.favorites, previousFavorites, '单键读取失败保留上次收藏视图')

    readFailureKey = ''
    page.retryWorkspace()
    assert.strictEqual(page.data.workspaceError, '', '恢复读取后清除错误状态')
    assert.strictEqual(page.data.projects[0].id, 'warm-project')
    assert.strictEqual(page.data.favorites[0].id, 'warm-favorite')
    delete require.cache[recordsModulePath]
  }
} finally {
  delete require.cache[recordsModulePath]
  if (priorRecordsModule) require.cache[recordsModulePath] = priorRecordsModule
  if (priorStorageWx === undefined) delete global.wx
  else global.wx = priorStorageWx
}

function runProjectDetailSwipeDeletionRegression() {
  const storageKeys = {
    records: 'audioTool.records.v1',
    projects: 'audioTool.projects.v1',
    favorites: 'audioTool.favorites.v1',
    recovery: 'audioTool.recovery.v1',
    active: 'audioTool.activeProject.v1',
    schema: 'audioTool.storageSchemaVersion',
  }
  const previousWx = global.wx
  const recordsModulePath = require.resolve('../utils/records')
  const previousRecordsModule = require.cache[recordsModulePath]
  const storage = new Map()
  const writeAttempts = []
  const modalRequests = []
  const openedRecords = []
  const navigated = []
  const toasts = []
  let readFailureKey = ''
  let writeFailureKey = ''
  let throwModalNext = false
  let actualRecords
  const clone = (value) => value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
  const line = (id, code, overrides = {}) => ({
    id, code, purpose: 'program audio', fromDevice: 'Console', fromPort: 'MAIN L',
    toDevice: 'Speaker', toPort: 'IN 1', buildType: 'bulk', cableType: 'balanced',
    spec: '2-core shielded', connectorA: 'xlrFemale', connectorB: 'xlrMale',
    lengthText: '8', status: 'pending', notes: '', ...overrides,
  })
  const project = (id, name, wiringSchedule) => ({
    id, name, venueName: `${name} venue`, engineer: 'Engineer', projectDate: '2026-10-20',
    notes: `${name} notes`, roomLengthText: '12', roomWidthText: '8', roomHeightText: '4',
    standardClassKey: 'conference', gradeKey: 'II', createdAt: 100, updatedAt: 200,
    ...(wiringSchedule ? { wiringSchedule: clone(wiringSchedule) } : {}),
  })
  const sharedRecord = {
    id: 'shared-record', module: 'limiter', title: 'Canonical title', summary: 'Shared calculation',
    resultText: 'Original calculation output', preferences: { model: 'preserve-me', threshold: -6 },
    favorite: false, archived: false, projectIds: ['project-a', 'project-b'], createdAt: 100, updatedAt: 200,
    projectMetadata: {
      'project-a': { name: 'A-side result', note: 'A-side note', savedAt: 210 },
      'project-b': { name: 'B-side result', note: 'B-side note', savedAt: 220 },
    },
  }
  const otherRecord = {
    id: 'other-record', module: 'limiter', title: 'Other result', summary: 'Unrelated calculation',
    resultText: 'Other output', preferences: { model: 'other' }, favorite: false, archived: false,
    projectIds: ['project-a'], createdAt: 90, updatedAt: 190,
    projectMetadata: { 'project-a': { name: 'Other result', note: 'Keep this row', savedAt: 190 } },
  }
  const favorite = {
    id: 'independent-favorite', module: 'limiter', title: 'Independent favorite', summary: 'Saved separately',
    resultText: 'Favorite output', preferences: { model: 'favorite' }, favorite: true, archived: false,
    projectIds: [], createdAt: 50, updatedAt: 60, signature: '["limiter",{"model":"favorite"}]',
  }
  const scheduleA = {
    version: 1, revision: 7, nextNumber: 5,
    devices: [{ id: 'device-a', type: 'mixer', name: 'Console' }],
    lines: [
      line('line-target', 'A001', { fromDeviceId: 'device-a' }),
      line('line-other', 'A002', { toDeviceId: 'device-a', notes: 'preserve' }),
    ],
  }
  const scheduleB = {
    version: 1, revision: 3, nextNumber: 2,
    devices: [{ id: 'device-b', type: 'speaker', name: 'Other room speaker' }],
    lines: [line('line-project-b', 'B001', { toDeviceId: 'device-b' })],
  }
  function resetStorage() {
    storage.clear()
    storage.set(storageKeys.projects, [
      project('project-a', 'Project A', scheduleA),
      project('project-b', 'Project B', scheduleB),
    ])
    storage.set(storageKeys.records, [clone(otherRecord), clone(sharedRecord)])
    storage.set(storageKeys.favorites, [clone(favorite)])
    storage.set(storageKeys.recovery, [])
    storage.set(storageKeys.active, 'project-b')
    storage.set(storageKeys.schema, 4)
    writeAttempts.length = 0
    modalRequests.length = 0
    navigated.length = 0
    toasts.length = 0
    openedRecords.length = 0
    readFailureKey = ''
    writeFailureKey = ''
  }
  global.wx = {
    getStorageSync(key) {
      if (key === readFailureKey) throw new Error('simulated project detail read failure')
      return clone(storage.get(key))
    },
    setStorageSync(key, value) {
      writeAttempts.push(key)
      if (key === writeFailureKey) throw new Error('simulated project detail write failure')
      storage.set(key, clone(value))
    },
    removeStorageSync(key) { storage.delete(key) },
    getStorageInfoSync() { return { currentSize: 10, limitSize: 1000 } },
    setNavigationBarTitle() {},
    showToast(options) { toasts.push(options) },
    navigateTo(options) { navigated.push(options.url) },
    showModal(options) {
      assert(Array.from(String(options.confirmText || '')).length <= 4, '原生确认按钮文案不得超过4字')
      assert(Array.from(String(options.cancelText || '')).length <= 4, '原生取消按钮文案不得超过4字')
      if (throwModalNext) {
        throwModalNext = false
        throw new Error('simulated synchronous native modal failure')
      }
      modalRequests.push(options)
    },
  }
  try {
    delete require.cache[recordsModulePath]
    actualRecords = require('../utils/records')
    const definition = loadPage('pages/records/project.js', {
      '../../data/app-meta': { APP_VERSION: 'test', PRODUCT_DATA_DATE: 'test' },
      '../../utils/performance': { printPerformanceSummary() {}, startMeasurement: () => () => null },
      '../../utils/haptics': { vibrate() {} },
      '../../utils/report-canvas': { drawAndExportReport() {} },
      '../../utils/report-image-actions': {
        previewGeneratedImage() {}, saveGeneratedImage() {}, shareGeneratedImage() {},
      },
      '../../utils/records': actualRecords,
      '../../utils/result-record-context': {
        openProjectDraft() {},
        openRecordEditor(record) { openedRecords.push(record.id); return true },
      },
      '../dmx-layout/lighting-workspace': {
        readLightingWorkspace() { return { ok: true, exists: false, scheme: null, revision: 0 } },
        calculateScheme() { return null },
      },
      './project-report': {
        REPORT_CANVAS_ID: 'report', REPORT_WIDTH: 320, buildProjectReportPayload() {},
        calculateProjectReportHeight() {}, drawProjectReport() {}, getExportDimensions() {},
      },
    })
    function createPage() {
      resetStorage()
      const page = instantiate(definition)
      page.setData = function setNestedData(patch, callback) {
        Object.entries(patch).forEach(([key, value]) => {
          const parts = Array.from(key.matchAll(/([^.[\]]+)|\[(\d+)\]/g), (match) => (
            match[1] === undefined ? Number(match[2]) : match[1]
          ))
          let target = this.data
          parts.forEach((part, index) => {
            if (index === parts.length - 1) target[part] = value
            else {
              if (!target[part]) target[part] = typeof parts[index + 1] === 'number' ? [] : {}
              target = target[part]
            }
          })
        })
        if (callback) callback()
      }
      page.onLoad({ id: 'project-a' })
      page.onShow()
      assert.strictEqual(page.data.project.id, 'project-a', '项目详情测试须通过真实onLoad加载')
      return page
    }
    function rowEvent(type, id) {
      return { currentTarget: { dataset: { swipeType: type, swipeId: id, id } } }
    }
    function swipeOpen(page, type, id) {
      page.onProjectSwipeStart({
        ...rowEvent(type, id),
        touches: [{ clientX: 120, clientY: 20 }],
      })
      page.onProjectSwipeMove({ touches: [{ clientX: 24, clientY: 20 }] })
      page.onProjectSwipeEnd()
      assert.deepStrictEqual(page._projectOpenSwipe, { key: `${type}:${id}`, type, id, offset: -72 },
        '真实触摸起止必须按稳定类型和 ID 打开对应左滑操作')
      const actionButtonTouch = {
        ...rowEvent(type, id),
        touches: [{ clientX: 24, clientY: 20 }],
      }
      page.onProjectSwipeStart(actionButtonTouch)
      page.onProjectSwipeEnd()
      assert.strictEqual(page._projectOpenSwipe?.key, `${type}:${id}`,
        '按下已显示的操作按钮不应关闭行或吞掉按钮点击')
    }
    function tapDelete(page, type, id) {
      page.onProjectSwipeDelete(rowEvent(type, id))
      return modalRequests[modalRequests.length - 1]
    }
    function assertDeleteWaitsForSwipeEnd(page, type, id, getRow) {
      const row = getRow(page)
      page.onProjectSwipeStart({ ...rowEvent(type, id), touches: [{ clientX: 120, clientY: 20 }] })
      page.onProjectSwipeMove({ touches: [{ clientX: 48, clientY: 20 }] })
      assert.strictEqual(row.swipeDragging, true, `${type}最大位移拖动期间保留手势状态`)
      assert.strictEqual(row.swipeOffset, -72, `${type}动作位移到达完整宽度`)
      assert.strictEqual(row.swipeOpen, false, `${type}触摸结束前不进入确认态`)
      const modalCountBeforeDragTap = modalRequests.length
      const writesBeforeDragTap = writeAttempts.length
      page.onProjectSwipeDelete(rowEvent(type, id))
      assert.strictEqual(modalRequests.length, modalCountBeforeDragTap,
        `${type}最大位移但触摸尚未结束时零确认`)
      assert.strictEqual(writeAttempts.length, writesBeforeDragTap,
        `${type}最大位移但触摸尚未结束时零写入`)
      page.onProjectSwipeEnd()
      assert.strictEqual(row.swipeDragging, false, `${type}触摸结束后清除手势状态`)
      assert.strictEqual(row.swipeOpen, true, `${type}触摸结束后进入完整展开态`)
      page.onProjectSwipeDelete(rowEvent(type, id))
      assert.strictEqual(modalRequests.length, modalCountBeforeDragTap + 1,
        `${type}完整展开且触摸结束后仍可打开确认`)
      modalRequests.at(-1).success({ confirm: false })
      assert.strictEqual(writeAttempts.length, writesBeforeDragTap,
        `${type}确认取消仍零写入`)
    }

    assertDeleteWaitsForSwipeEnd(createPage(), 'record', 'shared-record', (currentPage) => (
      currentPage.data.recordGroups.flatMap((group) => group.records).find((record) => record.id === 'shared-record')
    ))
    assertDeleteWaitsForSwipeEnd(createPage(), 'line', 'line-target', (currentPage) => (
      currentPage.data.wiringLines.find((item) => item.id === 'line-target')
    ))

    let page = createPage()
    assert.strictEqual(page.rawRecords.find((record) => record.id === 'shared-record').title, 'A-side result',
      '详情页展示本项目的投影标题')
    assert.strictEqual(page.rawRecords.find((record) => record.id === 'shared-record').projectNote, 'A-side note')
    page.onProjectSwipeStart({ ...rowEvent('record', 'shared-record'), touches: [{ clientX: 100, clientY: 8 }] })
    page.onProjectSwipeEnd()
    page.onProjectItemTap({ currentTarget: { dataset: { id: 'shared-record' } } })
    assert.deepStrictEqual(openedRecords, ['shared-record'], '普通轻触仍通过稳定 ID 打开计算记录')

    page = createPage()
    const partialStart = { ...rowEvent('record', 'shared-record'), touches: [{ clientX: 100, clientY: 8 }] }
    page.onProjectSwipeStart(partialStart)
    page.onProjectSwipeMove({ touches: [{ clientX: 70, clientY: 8 }] })
    const partialRecord = page.data.recordGroups.flatMap((group) => group.records)
      .find((record) => record.id === 'shared-record')
    assert.strictEqual(partialRecord.swipeDragging, true, '水平拖动期间保留dragging状态')
    assert.strictEqual(partialRecord.swipeOffset, -30, '回归用例停在未完全展开的位置')
    assert.strictEqual(partialRecord.swipeOpen, false, '未完全展开仍不能进入确认态')
    const partialModalCount = modalRequests.length
    const partialWriteCount = writeAttempts.length
    page.onProjectSwipeDelete(rowEvent('record', 'shared-record'))
    assert.strictEqual(modalRequests.length, partialModalCount, '部分拖动露出操作时点击不能绕过fully-open确认守卫')
    assert.strictEqual(writeAttempts.length, partialWriteCount, '未完全展开操作零写入')
    page.onProjectSwipeMove({ touches: [{ clientX: 100, clientY: 8 }] })
    assert.strictEqual(partialRecord.swipeOffset, 0, '手势回滑时操作位移回到关闭位置')
    page.onProjectSwipeEnd()
    assert.strictEqual(partialRecord.swipeDragging, false, '回滑结束清除dragging状态')
    assert.strictEqual(partialRecord.swipeOpen, false, '回滑结束不显示关闭操作')
    page.onProjectSwipeStart({ ...rowEvent('record', 'shared-record'), touches: [{ clientX: 100, clientY: 8 }] })
    page.onProjectSwipeMove({ touches: [{ clientX: 70, clientY: 8 }] })
    page.onProjectSwipeCancel()
    assert.strictEqual(partialRecord.swipeOffset, 0, '取消拖动复位操作位移')
    assert.strictEqual(partialRecord.swipeDragging, false, '取消拖动清除dragging状态')
    assert.strictEqual(partialRecord.swipeOpen, false, '取消拖动不打开操作')

    page = createPage()
    const opensBeforeVertical = openedRecords.length
    page.onProjectSwipeStart({ ...rowEvent('record', 'shared-record'), touches: [{ clientX: 100, clientY: 8 }] })
    page.onProjectSwipeMove({ touches: [{ clientX: 98, clientY: 46 }] })
    page.onProjectScroll({ detail: { scrollTop: 40 } })
    page.onProjectSwipeEnd()
    page.onProjectItemTap({ currentTarget: { dataset: { id: 'shared-record' } } })
    assert.strictEqual(openedRecords.length, opensBeforeVertical, '纵向滚动不应误开记录或删除操作')
    page.onProjectSwipeStart({ ...rowEvent('record', 'shared-record'), touches: [{ clientX: 100, clientY: 8 }] })
    page.onProjectSwipeEnd()
    page.onProjectItemTap({ currentTarget: { dataset: { id: 'shared-record' } } })
    assert.strictEqual(openedRecords.length, opensBeforeVertical + 1, '非横向的普通点击仍可打开记录')

    page = createPage()
    page.onProjectSearchInput({ detail: { value: 'A-side' } })
    const filteredIds = page.data.recordGroups.flatMap((group) => group.records.map((record) => record.id))
    assert.deepStrictEqual(filteredIds, ['shared-record'], '搜索重排后的可见行仍使用真实稳定 ID')
    swipeOpen(page, 'record', 'shared-record')
    let modal = tapDelete(page, 'record', 'shared-record')
    assert.strictEqual(modal.title, '移除项目记录？')
    assert(modal.content.includes('仅从“Project A”移除') && modal.content.includes('其他项目和独立收藏保留'))
    modal.fail({ errMsg: 'native modal failed' })
    assert.strictEqual(page._projectDeletionPending, null, '原生确认失败必须释放当前pending')
    assert.deepStrictEqual(writeAttempts, [], '原生确认失败零写入')
    modal = tapDelete(page, 'record', 'shared-record')
    modal.success({ confirm: false })
    assert.deepStrictEqual(writeAttempts, [], '取消项目内移除零写入')
    const modalCountBeforeThrow = modalRequests.length
    throwModalNext = true
    page.onProjectSwipeDelete(rowEvent('record', 'shared-record'))
    assert.strictEqual(modalRequests.length, modalCountBeforeThrow, 'showModal同步抛错时不应遗留确认回调')
    assert.strictEqual(page._projectDeletionPending, null, 'showModal同步抛错必须释放pending')
    assert.deepStrictEqual(writeAttempts, [], 'showModal同步抛错零写入')
    modal = tapDelete(page, 'record', 'shared-record')
    modal.success({ confirm: false })
    assert.deepStrictEqual(writeAttempts, [], '原生同步失败后重试仍可取消且零写入')

    const recordsBeforeWriteFailure = clone(storage.get(storageKeys.records))
    const recoveryBeforeWriteFailure = clone(storage.get(storageKeys.recovery))
    modal = tapDelete(page, 'record', 'shared-record')
    writeFailureKey = storageKeys.records
    modal.success({ confirm: true })
    writeFailureKey = ''
    assert.deepStrictEqual(storage.get(storageKeys.records), recordsBeforeWriteFailure,
      '记录存储写入失败必须回滚记录原值')
    assert.deepStrictEqual(storage.get(storageKeys.recovery), recoveryBeforeWriteFailure,
      '记录存储写入失败必须回滚已暂存的回收站关系')
    assert.strictEqual(page._projectDeletionPending, null, '记录写入失败后释放pending以便重试')
    assert(page.data.recordGroups.flatMap((group) => group.records).some((record) => record.id === 'shared-record'),
      '记录写入失败后刷新视图仍保留原项目关系')
    swipeOpen(page, 'record', 'shared-record')
    modal = tapDelete(page, 'record', 'shared-record')
    const favoriteBefore = clone(storage.get(storageKeys.favorites))
    modal.success({ confirm: true })
    const writesAfterConfirm = writeAttempts.length
    modal.success({ confirm: true })
    assert.strictEqual(writeAttempts.length, writesAfterConfirm, '重复原生回调不得重复提交')
    const savedRecord = storage.get(storageKeys.records).find((record) => record.id === 'shared-record')
    assert.deepStrictEqual(savedRecord.projectIds, ['project-b'], '只解除当前项目关联并保留另一项目关系')
    assert.deepStrictEqual(savedRecord.projectMetadata, { 'project-b': sharedRecord.projectMetadata['project-b'] },
      '移除A项目元信息，保留B项目自己的名称和备注')
    assert.deepStrictEqual(savedRecord.preferences, sharedRecord.preferences, '项目内移除不修改计算参数')
    assert.strictEqual(savedRecord.resultText, sharedRecord.resultText, '项目内移除不修改计算结果')
    assert.deepStrictEqual(storage.get(storageKeys.favorites), favoriteBefore,
      '独立收藏来自独立快照存储，项目内移除保持其内容原样')
    assert(!page.data.recordGroups.flatMap((group) => group.records).some((record) => record.id === 'shared-record'),
      '移除后刷新项目分组和可见记录')
    const recovery = actualRecords.getRecoveryEntries().find((entry) => entry.kind === 'record-project-link')
    assert(recovery && recovery.projectId === 'project-a', '项目关联移除写入可恢复的项目关系记录')
    assert.strictEqual(actualRecords.restoreRecoveryEntry(recovery.id), true, '回收站能恢复A项目关系')
    const restored = actualRecords.getWorkspaceSnapshot({ forceRefresh: true }).records.find((record) => record.id === 'shared-record')
    assert.deepStrictEqual(restored.projectIds.sort(), ['project-a', 'project-b'])
    assert.strictEqual(restored.projectMetadata['project-a'].note, 'A-side note')
    assert.strictEqual(restored.projectMetadata['project-b'].note, 'B-side note')

    page = createPage()
    swipeOpen(page, 'record', 'shared-record')
    modal = tapDelete(page, 'record', 'shared-record')
    const currentRecords = storage.get(storageKeys.records).map((record) => (
      record.id === 'shared-record'
        ? { ...record, projectMetadata: { ...record.projectMetadata, 'project-a': { ...record.projectMetadata['project-a'], note: 'externally updated' } } }
        : record
    ))
    storage.set(storageKeys.records, currentRecords)
    const writesBeforeStale = writeAttempts.length
    modal.success({ confirm: true })
    assert.strictEqual(writeAttempts.length, writesBeforeStale, '记录快照变化后确认必须零写入')
    assert(storage.get(storageKeys.records).find((record) => record.id === 'shared-record').projectIds.includes('project-a'),
      '记录变更时保留当前项目关系')

    page = createPage()
    swipeOpen(page, 'record', 'shared-record')
    modal = tapDelete(page, 'record', 'shared-record')
    const recordsWithChangedPreferences = storage.get(storageKeys.records).map((record) => (
      record.id === 'shared-record'
        ? { ...record, preferences: { ...record.preferences, threshold: -9 } }
        : record
    ))
    storage.set(storageKeys.records, recordsWithChangedPreferences)
    const writesBeforePreferencesStale = writeAttempts.length
    modal.success({ confirm: true })
    assert.strictEqual(writeAttempts.length, writesBeforePreferencesStale, '计算偏好变化后旧确认必须零写入')
    assert(storage.get(storageKeys.records).find((record) => record.id === 'shared-record').projectIds.includes('project-a'),
      '计算偏好变化时保留当前项目关系')

    page = createPage()
    const timestampFreeRecord = {
      ...sharedRecord,
      id: 'timestamp-free-record',
      title: 'Timestamp-free result',
      projectMetadata: {
        'project-a': { name: 'A timestamp-free result', note: 'A metadata without saved time' },
        'project-b': { name: 'B timestamp-free result', note: 'B metadata without saved time' },
      },
    }
    delete timestampFreeRecord.createdAt
    delete timestampFreeRecord.updatedAt
    storage.set(storageKeys.records, [...storage.get(storageKeys.records), timestampFreeRecord])
    page.refresh({ forceRefresh: true })
    const originalDateNow = Date.now
    let syntheticNow = 10000
    Date.now = () => { syntheticNow += 1000; return syntheticNow }
    try {
      const firstRead = actualRecords.getWorkspaceSnapshot({ forceRefresh: true }).records
        .find((record) => record.id === 'timestamp-free-record')
      const secondRead = actualRecords.getWorkspaceSnapshot({ forceRefresh: true }).records
        .find((record) => record.id === 'timestamp-free-record')
      assert.notStrictEqual(firstRead.createdAt, secondRead.createdAt,
        '合法的旧记录每次读取都会获得不同的规范化默认时间')
      page.refresh({ forceRefresh: true })
      page.onProjectSearchInput({ detail: { value: 'Timestamp-free' } })
      swipeOpen(page, 'record', 'timestamp-free-record')
      modal = tapDelete(page, 'record', 'timestamp-free-record')
      const favoriteBeforeTimestampFreeRemoval = clone(storage.get(storageKeys.favorites))
      modal.success({ confirm: true })
      const remainingTimestampFree = actualRecords.getWorkspaceSnapshot({ forceRefresh: true }).records
        .find((record) => record.id === 'timestamp-free-record')
      assert(!remainingTimestampFree?.projectIds?.includes('project-a'),
        '读取补充的默认时间变化不应阻断内容未变记录的项目内移除')
      assert.deepStrictEqual(remainingTimestampFree?.projectIds, ['project-b'], '无时间戳记录仍只解除A项目关系')
      assert.deepStrictEqual(remainingTimestampFree?.projectMetadata, {
        'project-b': { name: 'B timestamp-free result', note: 'B metadata without saved time' },
      }, '无savedAt的B项目元数据必须原样保留')
      assert.deepStrictEqual(storage.get(storageKeys.favorites), favoriteBeforeTimestampFreeRemoval,
        '无时间戳共享记录的移除不能改独立收藏快照')
      const timestampFreeRecovery = actualRecords.getRecoveryEntries()
        .find((entry) => entry.kind === 'record-project-link' && entry.snapshot?.id === 'timestamp-free-record')
      assert(timestampFreeRecovery, '无时间戳共享记录的A项目关系仍可回收恢复')
      assert.strictEqual(actualRecords.restoreRecoveryEntry(timestampFreeRecovery.id), true)
      const restoredTimestampFree = actualRecords.getWorkspaceSnapshot({ forceRefresh: true }).records
        .find((record) => record.id === 'timestamp-free-record')
      assert.deepStrictEqual(restoredTimestampFree.projectIds.sort(), ['project-a', 'project-b'])
      assert.strictEqual(restoredTimestampFree.projectMetadata['project-a'].note, 'A metadata without saved time')
      assert.strictEqual(restoredTimestampFree.projectMetadata['project-b'].note, 'B metadata without saved time')
    } finally {
      Date.now = originalDateNow
    }

    page = createPage()
    swipeOpen(page, 'record', 'shared-record')
    modal = tapDelete(page, 'record', 'shared-record')
    const writesBeforeHide = writeAttempts.length
    page.onHide()
    modal.success({ confirm: true })
    assert.strictEqual(writeAttempts.length, writesBeforeHide, '页面隐藏后到达的确认回调不能写入')
    page.onShow()
    assert(!page.data.workspaceError, '页面重新显示后应重新读取项目并清除错误状态')

    page = createPage()
    swipeOpen(page, 'record', 'shared-record')
    modal = tapDelete(page, 'record', 'shared-record')
    const writesBeforeFilter = writeAttempts.length
    page.onProjectSearchInput({ detail: { value: 'Other' } })
    modal.success({ confirm: true })
    assert.strictEqual(writeAttempts.length, writesBeforeFilter, '搜索筛选变化后旧确认不能操作已重排列表')
    assert.strictEqual(page._projectDeletionPending, null)

    page = createPage()
    const priorVisibleRows = page.data.recordGroups
    readFailureKey = storageKeys.records
    page.onProjectSwipeStart({ ...rowEvent('record', 'shared-record'), touches: [{ clientX: 100, clientY: 10 }] })
    page.onProjectSwipeMove({ touches: [{ clientX: 10, clientY: 10 }] })
    page.onProjectSwipeEnd()
    const writesBeforeReadError = writeAttempts.length
    page.onProjectSwipeDelete(rowEvent('record', 'shared-record'))
    assert.strictEqual(modalRequests.length, 0, '预检读取失败时不展示具有破坏性的确认')
    assert.strictEqual(writeAttempts.length, writesBeforeReadError, '预检读取失败零写入')
    assert(page.data.workspaceError, '预检读取失败显示错误状态并阻止后续操作')
    assert.strictEqual(page.data.recordGroups, priorVisibleRows, '读取错误保留上次项目视图')
    readFailureKey = ''
    page.retryWorkspace()
    assert.strictEqual(page.data.workspaceError, '')

    page = createPage()
    swipeOpen(page, 'record', 'shared-record')
    modal = tapDelete(page, 'record', 'shared-record')
    readFailureKey = storageKeys.records
    const priorRowsAtConfirm = page.data.recordGroups
    const writesBeforeConfirmReadError = writeAttempts.length
    modal.success({ confirm: true })
    assert.strictEqual(writeAttempts.length, writesBeforeConfirmReadError, '最终确认读取失败零写入')
    assert(page.data.workspaceError, '最终确认读取失败显示重试状态')
    assert.strictEqual(page.data.recordGroups, priorRowsAtConfirm, '最终确认读取错误保留此前视图')
    readFailureKey = ''
    page.retryWorkspace()

    page = createPage()
    page.onProjectViewFilterTap({ currentTarget: { dataset: { key: 'wiring' } } })
    assert.strictEqual(page.data.wiringLines.length, 2)
    const otherProjectBefore = clone(storage.get(storageKeys.projects).find((item) => item.id === 'project-b'))
    const deviceIdsBefore = storage.get(storageKeys.projects).find((item) => item.id === 'project-a')
      .wiringSchedule.devices.map((device) => device.id)
    swipeOpen(page, 'line', 'line-target')
    modal = tapDelete(page, 'line', 'line-target')
    assert.strictEqual(modal.title, '删除该线路？')
    assert(modal.content.includes('仅删除') && modal.content.includes('设备和其他线路保留'))
    modal.success({ confirm: false })
    assert.deepStrictEqual(writeAttempts, [], '取消线路删除零写入')
    const scheduleBeforeLineWriteFailure = clone(storage.get(storageKeys.projects).find((item) => item.id === 'project-a').wiringSchedule)
    modal = tapDelete(page, 'line', 'line-target')
    writeFailureKey = storageKeys.projects
    modal.success({ confirm: true })
    writeFailureKey = ''
    assert.deepStrictEqual(storage.get(storageKeys.projects).find((item) => item.id === 'project-a').wiringSchedule,
      scheduleBeforeLineWriteFailure, '线路存储写入失败必须保留完整原线路表')
    assert(page.data.wiringLines.some((item) => item.id === 'line-target'), '线路写入失败后仍显示原线路并可重试')
    swipeOpen(page, 'line', 'line-target')
    modal = tapDelete(page, 'line', 'line-target')
    modal.success({ confirm: true })
    const projectAAfterLineDelete = storage.get(storageKeys.projects).find((item) => item.id === 'project-a')
    assert.deepStrictEqual(projectAAfterLineDelete.wiringSchedule.lines.map((item) => item.id), ['line-other'],
      '只删除当前线路稳定 ID')
    assert.deepStrictEqual(projectAAfterLineDelete.wiringSchedule.devices.map((device) => device.id), deviceIdsBefore,
      '删除线路不连带删除设备')
    assert.strictEqual(projectAAfterLineDelete.wiringSchedule.revision, 8, '线路删除使用确认时捕获的线路版本')
    assert.deepStrictEqual(storage.get(storageKeys.projects).find((item) => item.id === 'project-b'), otherProjectBefore,
      '线路删除只写当前项目')
    assert.deepStrictEqual(page.data.wiringLines.map((item) => item.id), ['line-other'], '线路删除后刷新项目内容行')
    const projectWxml = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
    const projectWxss = fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8')
    const projectJs = fs.readFileSync(path.join(root, 'pages/records/project.js'), 'utf8')
    assert(projectWxml.includes('data-id="{{record.id}}" bindtap="onProjectItemTap"')
      && projectWxml.includes('data-id="{{item.id}}" bindtap="openProjectWiring"'),
    '左滑入口不替换计算记录和线路的原有点击导航')
    const swipeActions = Array.from(projectWxml.matchAll(/<view\b(?=[^>]*class="interior-swipe-delete")(?=[^>]*aria-role="button")[^>]*>([\s\S]*?)<\/view>/g))
    const swipeLabels = swipeActions.map((action) => action[1].match(/<text class="interior-swipe-label">([^<]+)<\/text>/)?.[1] || null)
    assert.deepStrictEqual(swipeLabels, ['移除', '删除', '移出灯位'],
      '记录、线路和灯位左滑操作均用显式文字节点呈现')
    assert(!/<button\b[^>]*class="interior-swipe-delete"/.test(projectWxml)
      && swipeActions[0][0].includes('data-swipe-type="record" data-swipe-id="{{record.id}}" catchtap="onProjectSwipeDelete"')
      && swipeActions[1][0].includes('data-swipe-type="line" data-swipe-id="{{item.id}}" catchtap="onProjectSwipeDelete"')
      && swipeActions[2][0].includes('data-swipe-type="lighting" data-swipe-id="{{item.stableId}}" catchtap="onProjectSwipeDelete"'),
    '三类左滑操作继续使用 aria-role 视图并绑定各自稳定 ID 和原确认处理器')
    assert(projectWxml.includes('wx:if="{{record.swipeOpen || (record.swipeDragging && record.swipeOffset < 0)}}"')
      && (projectWxml.match(/wx:if="\{\{item\.swipeOpen \|\| \(item\.swipeDragging && item\.swipeOffset < 0\)\}\}"/g) || []).length === 2,
    '三类左滑操作在负向拖动时即显示，回滑到零位后隐藏')
    const swipeRule = projectWxss.match(/\.interior-swipe-delete\{([^}]+)\}/)
    const swipeRowRule = projectWxss.match(/\.interior-swipe-row\{([^}]+)\}/)
    const rowRule = projectWxss.match(/\.interior-item\{([^}]+)\}/)
    const contentRule = projectWxss.match(/\.interior-swipe-content\{([^}]+)\}/)
    const labelRule = projectWxss.match(/\.interior-swipe-label\{([^}]+)\}/)
    const actionWidth = Number(swipeRule?.[1].match(/width:(\d+)px/)?.[1])
    const actionMinWidth = Number(swipeRule?.[1].match(/min-width:(\d+)px/)?.[1])
    const actionMaxWidth = Number(swipeRule?.[1].match(/max-width:(\d+)px/)?.[1])
    const swipeOffsetWidth = Number(projectJs.match(/const PROJECT_SWIPE_ACTION_WIDTH = (\d+)/)?.[1])
    const rowMinHeight = Number(rowRule?.[1].match(/min-height:(\d+)px/)?.[1])
    const actionZIndex = Number(swipeRule?.[1].match(/z-index:(\d+)/)?.[1])
    const contentZIndex = Number(contentRule?.[1].match(/z-index:(\d+)/)?.[1])
    assert(actionWidth === 72 && actionMinWidth === 72 && actionMaxWidth === 72 && swipeOffsetWidth === 72
      && swipeRule[1].includes('top:0') && swipeRule[1].includes('right:0')
      && swipeRule[1].includes('bottom:0') && swipeRule[1].includes('min-height:44px')
      && !/(?:^|;)height:\d+px(?:;|$)/.test(swipeRule[1]) && !swipeRule[1].includes('transform:'),
    '左滑操作固定72px宽、上下贴合容器且保留至少44px触点')
    assert(swipeRowRule?.[1].includes('isolation:isolate') && swipeRowRule[1].includes('overflow:hidden')
      && actionZIndex === 0 && contentZIndex === 1 && rowMinHeight >= 44,
    '独立裁切层让完整左滑操作位于可平移卡片下方')
    assert(labelRule?.[1].includes('color:#fff')
      && labelRule[1].includes('font-size:14px') && labelRule[1].includes('line-height:20px')
      && labelRule[1].includes('white-space:nowrap'),
    '左滑操作文字不换行并显示在行内容上方')
  } finally {
    delete require.cache[recordsModulePath]
    if (previousRecordsModule) require.cache[recordsModulePath] = previousRecordsModule
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

function runProjectDetailLightingSwipeRegression() {
  const storageKeys = {
    records: 'audioTool.records.v1',
    projects: 'audioTool.projects.v1',
    favorites: 'audioTool.favorites.v1',
    recovery: 'audioTool.recovery.v1',
    active: 'audioTool.activeProject.v1',
    schema: 'audioTool.storageSchemaVersion',
  }
  const previousWx = global.wx
  const recordsModulePath = require.resolve('../utils/records')
  const lightingModulePath = require.resolve('../pages/dmx-layout/lighting-workspace')
  const previousRecordsModule = require.cache[recordsModulePath]
  const previousLightingModule = require.cache[lightingModulePath]
  const storage = new Map()
  const writeAttempts = []
  const modalRequests = []
  const navigated = []
  const toasts = []
  let readFailureKey = ''
  let writeFailureKey = ''
  let throwModalNext = false
  let actualRecords
  let lightingWorkspace
  const clone = (value) => value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
  const project = (id, name) => ({
    id, name, venueName: `${name} venue`, engineer: 'Engineer', projectDate: '2026-10-20',
    notes: `${name} notes`, roomLengthText: '12', roomWidthText: '8', roomHeightText: '4',
    standardClassKey: 'conference', gradeKey: 'II', createdAt: 100, updatedAt: 200,
  })
  const fixtureFingerprint = (fixture) => JSON.stringify([
    String(fixture.fixtureModel || ''),
    Number(fixture.channelCount) || 0,
    String(fixture.universeLabel || ''),
    Number(fixture.startAddress) || 0,
    Number(fixture.endAddress) || 0,
  ])

  function resetStorage() {
    storage.clear()
    storage.set(storageKeys.projects, [project('project-a', 'Project A'), project('project-b', 'Project B')])
    storage.set(storageKeys.records, [])
    storage.set(storageKeys.favorites, [])
    storage.set(storageKeys.recovery, [])
    storage.set(storageKeys.active, 'project-b')
    storage.set(storageKeys.schema, 4)
    writeAttempts.length = 0
    modalRequests.length = 0
    navigated.length = 0
    toasts.length = 0
    readFailureKey = ''
    writeFailureKey = ''
    throwModalNext = false
  }

  global.wx = {
    getStorageSync(key) {
      if (key === readFailureKey) throw new Error('simulated project lighting read failure')
      return clone(storage.get(key))
    },
    setStorageSync(key, value) {
      writeAttempts.push(key)
      if (key === writeFailureKey) throw new Error('simulated project lighting write failure')
      storage.set(key, clone(value))
    },
    removeStorageSync(key) { storage.delete(key) },
    getStorageInfoSync() { return { currentSize: 10, limitSize: 1000 } },
    setNavigationBarTitle() {},
    showToast(options) { toasts.push(options) },
    navigateTo(options) { navigated.push(options.url) },
    showModal(options) {
      assert(Array.from(String(options.confirmText || '')).length <= 4, '原生确认按钮文案不得超过4字')
      assert(Array.from(String(options.cancelText || '')).length <= 4, '原生取消按钮文案不得超过4字')
      if (throwModalNext) {
        throwModalNext = false
        throw new Error('simulated synchronous native modal failure')
      }
      modalRequests.push(options)
    },
  }

  try {
    delete require.cache[recordsModulePath]
    delete require.cache[lightingModulePath]
    actualRecords = require('../utils/records')
    lightingWorkspace = require('../pages/dmx-layout/lighting-workspace')

    function seedLighting(projectId, prefix) {
      const initial = lightingWorkspace.readLightingWorkspace(projectId)
      assert.strictEqual(initial.ok, true, `${projectId}灯位工作区应可初始化`)
      const { createGroup, buildPreferences } = require('../pages/dmx-address/group-input')
      const group = createGroup(1, {
        fixtureSource: 'library', fixtureModel: 'TL-SE3401', libraryChannelCount: 16,
        channelCount: '16', fixtureCount: '2', targetUniverse: 'A',
      })
      const scheme = lightingWorkspace.createLightingScheme(buildPreferences({
        groups: [group], startAddressText: '1', allocationMode: 'manual',
      }))
      assert(scheme, `${projectId}有效灯位方案应可创建`)
      scheme.groupIds = [`${prefix}-group`]
      scheme.fixtureIdsByGroup = { [`${prefix}-group`]: [`${prefix}-target`, `${prefix}-other`] }
      const calculated = lightingWorkspace.calculateScheme(scheme)
      assert(calculated.ok && calculated.valid, `${projectId} fixture scheme should pass the real calculator`)
      calculated.result.fixtures.forEach((fixture) => {
        calculated.scheme.checksById[fixture.stableId] = { fingerprint: fixtureFingerprint(fixture) }
      })
      calculated.scheme.layout = {
        stageWidthText: '12',
        stageDepthText: '8',
        apronDirection: 'bottom',
        internalRods: [
          { id: `${prefix}-rod-a`, distance: 1, note: 'preserve rod A' },
          { id: `${prefix}-rod-b`, distance: 2, note: 'preserve rod B' },
        ],
        frontRods: [{ id: `${prefix}-front`, distance: 1 }],
        positionsById: {
          [`${prefix}-target`]: { rodId: `${prefix}-rod-a`, t: 0.25 },
          [`${prefix}-other`]: { rodId: `${prefix}-rod-b`, t: 0.75 },
        },
        customLayoutField: `${prefix}-preserve-layout-field`,
      }
      calculated.scheme.legacySideLayout = { source: `${prefix}-preserve-legacy` }
      const saved = lightingWorkspace.saveLightingScheme(projectId, calculated.scheme, initial.revision)
      assert.strictEqual(saved.ok, true, `${projectId}灯位方案应通过真实workspace API保存`)
      const latest = lightingWorkspace.readLightingWorkspace(projectId)
      assert.strictEqual(latest.ok, true)
      assert.deepStrictEqual(Object.keys(latest.scheme.checksById).sort(), [`${prefix}-other`, `${prefix}-target`].sort(),
        '测试灯位方案须包含可守恒的双灯具核对')
      return { targetId: `${prefix}-target`, otherId: `${prefix}-other` }
    }

    function createPage() {
      resetStorage()
      const projectAFixtures = seedLighting('project-a', 'fixture-a')
      seedLighting('project-b', 'fixture-b')
      const definition = loadPage('pages/records/project.js', {
        '../../data/app-meta': { APP_VERSION: 'test', PRODUCT_DATA_DATE: 'test' },
        '../../utils/performance': { printPerformanceSummary() {}, startMeasurement: () => () => null },
        '../../utils/haptics': { vibrate() {} },
        '../../utils/report-canvas': { drawAndExportReport() {} },
        '../../utils/report-image-actions': {
          previewGeneratedImage() {}, saveGeneratedImage() {}, shareGeneratedImage() {},
        },
        '../../utils/records': actualRecords,
        '../../utils/result-record-context': { openProjectDraft() {}, openRecordEditor() { return true } },
        './project-report': {
          REPORT_CANVAS_ID: 'report', REPORT_WIDTH: 320, buildProjectReportPayload() {},
          calculateProjectReportHeight() {}, drawProjectReport() {}, getExportDimensions() {},
        },
      })
      const page = instantiate(definition)
      page.setData = function setNestedData(patch, callback) {
        Object.entries(patch).forEach(([key, value]) => {
          const parts = Array.from(key.matchAll(/([^.[\]]+)|\[(\d+)\]/g), (match) => (
            match[1] === undefined ? Number(match[2]) : match[1]
          ))
          let target = this.data
          parts.forEach((part, index) => {
            if (index === parts.length - 1) target[part] = value
            else {
              if (!target[part]) target[part] = typeof parts[index + 1] === 'number' ? [] : {}
              target = target[part]
            }
          })
        })
        if (callback) callback()
      }
      page.onLoad({ id: 'project-a' })
      page.onShow()
      assert.strictEqual(page.data.project.id, 'project-a', '灯位滑动测试必须经过真实页面onLoad')
      assert.strictEqual(page.data.lightingFixtures.length, 2, '详情页保留项目内全部有效灯具行')
      assert(page.data.lightingFixtures.every((item) => item.isPlaced), '初始两个灯具均显示为已上杆')
      writeAttempts.length = 0
      modalRequests.length = 0
      return { page, projectAFixtures }
    }

    function rowEvent(type, id) {
      return { currentTarget: { dataset: { swipeType: type, swipeId: id, id } } }
    }
    function swipeOpen(page, type, id) {
      page.onProjectSwipeStart({ ...rowEvent(type, id), touches: [{ clientX: 120, clientY: 20 }] })
      page.onProjectSwipeMove({ touches: [{ clientX: 24, clientY: 20 }] })
      page.onProjectSwipeEnd()
      assert.deepStrictEqual(page._projectOpenSwipe, { key: `${type}:${id}`, type, id, offset: -72 },
        '灯位行必须依据 stableId 打开左滑操作')
      page.onProjectSwipeStart({ ...rowEvent(type, id), touches: [{ clientX: 24, clientY: 20 }] })
      page.onProjectSwipeEnd()
      assert.strictEqual(page._projectOpenSwipe?.key, `${type}:${id}`, '按下已展开操作不能收起灯位行')
    }
    function tapDelete(page, id) {
      page.onProjectSwipeDelete(rowEvent('lighting', id))
      return modalRequests[modalRequests.length - 1]
    }
    function assertLightingDeleteWaitsForSwipeEnd() {
      const { page, projectAFixtures } = createPage()
      const id = projectAFixtures.targetId
      const row = page.data.lightingFixtures.find((item) => item.stableId === id)
      page.onProjectSwipeStart({ ...rowEvent('lighting', id), touches: [{ clientX: 120, clientY: 20 }] })
      page.onProjectSwipeMove({ touches: [{ clientX: 48, clientY: 20 }] })
      assert.strictEqual(row.swipeDragging, true, '灯位最大位移拖动期间保留手势状态')
      assert.strictEqual(row.swipeOffset, -72, '灯位动作位移到达完整宽度')
      assert.strictEqual(row.swipeOpen, false, '灯位触摸结束前不进入确认态')
      const modalCountBeforeDragTap = modalRequests.length
      const writesBeforeDragTap = workspaceWrites()
      page.onProjectSwipeDelete(rowEvent('lighting', id))
      assert.strictEqual(modalRequests.length, modalCountBeforeDragTap, '灯位触摸结束前零确认')
      assert.strictEqual(workspaceWrites(), writesBeforeDragTap, '灯位触摸结束前零workspace写入')
      page.onProjectSwipeEnd()
      assert.strictEqual(row.swipeDragging, false, '灯位触摸结束后清除手势状态')
      assert.strictEqual(row.swipeOpen, true, '灯位触摸结束后进入完整展开态')
      page.onProjectSwipeDelete(rowEvent('lighting', id))
      assert.strictEqual(modalRequests.length, modalCountBeforeDragTap + 1, '灯位抬手后仍可打开确认')
      modalRequests.at(-1).success({ confirm: false })
      assert.strictEqual(workspaceWrites(), writesBeforeDragTap, '灯位确认取消仍零workspace写入')
    }
    function workspaceWrites() {
      return writeAttempts.filter((key) => key === lightingWorkspace.WORKSPACE_KEY).length
    }

    assertLightingDeleteWaitsForSwipeEnd()

    let { page, projectAFixtures } = createPage()
    const projectABefore = lightingWorkspace.readLightingWorkspace('project-a')
    const projectBBefore = lightingWorkspace.readLightingWorkspace('project-b')
    const targetBefore = page.data.lightingFixtures.find((item) => item.stableId === projectAFixtures.targetId)
    const otherBefore = page.data.lightingFixtures.find((item) => item.stableId === projectAFixtures.otherId)
    const writesBeforeNavigation = navigated.length
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    page.openProjectLighting()
    assert.strictEqual(navigated.length, writesBeforeNavigation + 1,
      '灯位行展开时无stableId的顶部灯光入口仍能导航')
    assert.strictEqual(page._projectOpenSwipe, null, '顶部灯光入口导航前收起展开的灯位行')
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    page.openProjectLighting({ currentTarget: { dataset: { id: projectAFixtures.targetId } } })
    assert.strictEqual(navigated.length, writesBeforeNavigation + 1, '滑动后的冒泡点击只收起行，不误导航')
    page.openProjectLighting({ currentTarget: { dataset: { id: projectAFixtures.targetId } } })
    assert.strictEqual(navigated.at(-1), '/pages/dmx-address/dmx-address?lightingProjectId=project-a',
      '普通灯位点击仍打开原项目灯光方案')

    page = createPage().page
    projectAFixtures = { targetId: 'fixture-a-target', otherId: 'fixture-a-other' }
    const before = lightingWorkspace.readLightingWorkspace('project-a')
    const beforeProjectB = lightingWorkspace.readLightingWorkspace('project-b')
    const originalFixtureCount = page.data.project.lightingFixtureCount
    const originalRows = page.data.lightingFixtures.map((item) => ({ id: item.stableId, address: item.addressSummary }))
    const expectedScheme = clone(before.scheme)
    delete expectedScheme.layout.positionsById[projectAFixtures.targetId]
    const initialWorkspaceWrites = workspaceWrites()
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    const modal = tapDelete(page, projectAFixtures.targetId)
    assert(modal, '已上杆灯位应显示移出确认')
    assert.strictEqual(modal.title, '移出灯位？')
    assert.strictEqual(modal.confirmText, '移出灯位')
    assert(modal.content.includes('灯具数量、地址、核对和其他灯位保留'))
    assert.strictEqual(workspaceWrites(), initialWorkspaceWrites, '显示移出确认前不保存灯光方案')
    modal.success({ confirm: true })
    modal.success({ confirm: true })
    const after = lightingWorkspace.readLightingWorkspace('project-a')
    const afterProjectB = lightingWorkspace.readLightingWorkspace('project-b')
    assert.strictEqual(after.revision, before.revision + 1, '成功移出仅通过workspace CAS提交一个新版本')
    assert.deepStrictEqual(after.scheme, expectedScheme, '仅移除stableId对应的位置，方案其余字段逐项守恒')
    assert.strictEqual(Object.keys(after.scheme.checksById).length, 2, '移出灯位保留灯具数量与核对')
    assert.strictEqual(after.scheme.checksById[projectAFixtures.targetId].fingerprint,
      before.scheme.checksById[projectAFixtures.targetId].fingerprint, '目标灯具核对记录仍保留')
    assert.deepStrictEqual(after.scheme.layout.internalRods, before.scheme.layout.internalRods, '其他灯杆定义保留')
    assert.deepStrictEqual(after.scheme.layout.frontRods, before.scheme.layout.frontRods, '前沿灯杆定义保留')
    assert.deepStrictEqual(after.scheme.legacySideLayout, before.scheme.legacySideLayout, 'legacy布局字段保留')
    assert.strictEqual(page.data.project.lightingFixtureCount, originalFixtureCount, '项目灯具数量不变')
    assert.deepStrictEqual(page.data.lightingFixtures.map((item) => ({ id: item.stableId, address: item.addressSummary })),
      originalRows, '移出后所有灯位行和地址仍保留')
    assert.strictEqual(page.data.lightingFixtures.find((item) => item.stableId === projectAFixtures.targetId).isPlaced,
      false, '移出后的灯位行显示未上杆状态')
    assert.strictEqual(page.data.lightingFixtures.find((item) => item.stableId === projectAFixtures.otherId).isPlaced,
      true, '其他灯具仍显示已上杆')
    assert.deepStrictEqual(afterProjectB.scheme, beforeProjectB.scheme, '移出A项目灯位不修改B项目方案')
    assert.strictEqual(afterProjectB.revision, beforeProjectB.revision, '移出A项目灯位不修改B项目版本')
    const writesAfterCommit = workspaceWrites()
    const requestsAfterCommit = modalRequests.length
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    tapDelete(page, projectAFixtures.targetId)
    assert.strictEqual(workspaceWrites(), writesAfterCommit, '未上杆灯位再次操作零workspace保存')
    assert.strictEqual(modalRequests.length, requestsAfterCommit, '未上杆灯位不再弹出破坏性确认')
    const projectWxml = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
    const projectWxss = fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8')
    assert(projectWxml.includes('data-swipe-type="lighting" data-swipe-id="{{item.stableId}}"')
      && projectWxml.includes('data-id="{{item.stableId}}" bindtap="openProjectLighting"')
      && projectWxml.includes('<text class="interior-swipe-label">移出灯位</text>')
      && projectWxml.includes("{{item.isPlaced ? '' : ' · 未上杆'}}"),
    '灯位滑动、stableId导航、明确操作文字和未上杆提示均由项目详情模板呈现')
    assert(!projectWxss.includes('.interior-lighting-swipe-delete')
      && !projectWxss.includes('.interior-lighting-swipe-label'), '灯位左滑操作复用共享文字与层级样式')

    page = createPage().page
    projectAFixtures = { targetId: 'fixture-a-target', otherId: 'fixture-a-other' }
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    let cancelModal = tapDelete(page, projectAFixtures.targetId)
    let writesBeforeCancel = workspaceWrites()
    cancelModal.success({ confirm: false })
    assert.strictEqual(workspaceWrites(), writesBeforeCancel, '取消移出不写workspace')
    assert.strictEqual(page._projectDeletionPending, null, '取消后释放移出pending')

    page = createPage().page
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    let failModal = tapDelete(page, projectAFixtures.targetId)
    writesBeforeCancel = workspaceWrites()
    failModal.fail()
    assert.strictEqual(workspaceWrites(), writesBeforeCancel, '原生确认fail不写workspace')
    assert.strictEqual(page._projectDeletionPending, null, '原生确认fail释放pending并允许重试')
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    assert(tapDelete(page, projectAFixtures.targetId), '确认fail后可再次打开移出确认')

    page = createPage().page
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    throwModalNext = true
    const writesBeforeModalThrow = workspaceWrites()
    tapDelete(page, projectAFixtures.targetId)
    assert.strictEqual(workspaceWrites(), writesBeforeModalThrow, '原生确认同步抛错不写workspace')
    assert.strictEqual(page._projectDeletionPending, null, '原生确认同步抛错释放pending')
    assert(tapDelete(page, projectAFixtures.targetId), '原生确认同步抛错后可重试')

    page = createPage().page
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    let staleModal = tapDelete(page, projectAFixtures.targetId)
    const latestBeforeExternalChange = lightingWorkspace.readLightingWorkspace('project-a')
    const externallyChanged = clone(latestBeforeExternalChange.scheme)
    externallyChanged.layout.positionsById[projectAFixtures.targetId].t = 0.4
    const externalSave = lightingWorkspace.saveLightingScheme('project-a', externallyChanged, latestBeforeExternalChange.revision)
    assert.strictEqual(externalSave.ok, true, '并发方案编辑通过真实workspace API提交')
    writeAttempts.length = 0
    staleModal.success({ confirm: true })
    assert.strictEqual(workspaceWrites(), 0, '旧revision/方案快照确认不覆盖并发方案')
    assert.strictEqual(lightingWorkspace.readLightingWorkspace('project-a').scheme.layout.positionsById[projectAFixtures.targetId].t,
      0.4, '并发灯位位置保留')
    assert.strictEqual(page._projectDeletionPending, null, '陈旧方案确认释放pending')

    page = createPage().page
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    staleModal = tapDelete(page, projectAFixtures.targetId)
    const sameRevisionBefore = lightingWorkspace.readLightingWorkspace('project-a')
    const rawEnvelope = clone(storage.get(lightingWorkspace.WORKSPACE_KEY))
    rawEnvelope.contexts['project-a'].scheme.layout.customLayoutField = 'same-revision-external-change'
    storage.set(lightingWorkspace.WORKSPACE_KEY, rawEnvelope)
    writeAttempts.length = 0
    staleModal.success({ confirm: true })
    assert.strictEqual(workspaceWrites(), 0, 'revision未变化但完整方案快照变化时旧确认零保存')
    const sameRevisionAfter = lightingWorkspace.readLightingWorkspace('project-a')
    assert.strictEqual(sameRevisionAfter.revision, sameRevisionBefore.revision, '同revision外部变更测试保持revision原值')
    assert.strictEqual(sameRevisionAfter.scheme.layout.customLayoutField, 'same-revision-external-change',
      '同revision外部方案内容保留')
    assert(sameRevisionAfter.scheme.layout.positionsById[projectAFixtures.targetId], '同revision方案变更时保留目标灯位')
    assert.strictEqual(page._projectDeletionPending, null, '同revision陈旧确认释放pending')

    page = createPage().page
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    staleModal = tapDelete(page, projectAFixtures.targetId)
    const writesBeforeHide = workspaceWrites()
    page.onHide()
    staleModal.success({ confirm: true })
    assert.strictEqual(workspaceWrites(), writesBeforeHide, '隐藏页返回的陈旧确认不得提交灯位变更')
    assert.strictEqual(page._projectDeletionPending, null, '隐藏页面使旧确认失效')

    page = createPage().page
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    readFailureKey = lightingWorkspace.WORKSPACE_KEY
    const modalsBeforePreflightReadFailure = modalRequests.length
    const writesBeforePreflightReadFailure = workspaceWrites()
    tapDelete(page, projectAFixtures.targetId)
    assert.strictEqual(modalRequests.length, modalsBeforePreflightReadFailure, '灯位预检读失败不弹确认')
    assert.strictEqual(workspaceWrites(), writesBeforePreflightReadFailure, '灯位预检读失败零保存')
    assert(toasts.some((toast) => toast.title === '读取灯位失败，请重试'), '灯位预检读失败给出可重试提示')
    readFailureKey = ''
    page.retryWorkspace()

    page = createPage().page
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    let readFailureModal = tapDelete(page, projectAFixtures.targetId)
    readFailureKey = lightingWorkspace.WORKSPACE_KEY
    const writesBeforeConfirmReadFailure = workspaceWrites()
    readFailureModal.success({ confirm: true })
    assert.strictEqual(workspaceWrites(), writesBeforeConfirmReadFailure, '最终确认灯位读取失败零保存')
    assert.strictEqual(page._projectDeletionPending, null, '最终确认读取失败释放pending')
    assert(toasts.some((toast) => toast.title === '读取灯位失败，请重试'), '最终确认读取失败提示用户重试')
    readFailureKey = ''
    page.retryWorkspace()
    assert.strictEqual(page.data.lightingFixtures.length, 2, '恢复读取后原灯位列表可重试')

    page = createPage().page
    swipeOpen(page, 'lighting', projectAFixtures.targetId)
    let writeFailureModal = tapDelete(page, projectAFixtures.targetId)
    writeFailureKey = lightingWorkspace.WORKSPACE_KEY
    writeFailureModal.success({ confirm: true })
    writeFailureKey = ''
    const afterWriteFailure = lightingWorkspace.readLightingWorkspace('project-a')
    assert.strictEqual(afterWriteFailure.revision, 1, '底层workspace写入失败经journal恢复后不增加版本')
    assert(afterWriteFailure.scheme.layout.positionsById[projectAFixtures.targetId], '底层workspace写入失败保留原灯位')
    assert.strictEqual(page._projectDeletionPending, null, '底层workspace写入失败释放pending')
    assert(page.data.lightingFixtures.some((item) => item.stableId === projectAFixtures.targetId && item.isPlaced),
      '底层workspace写入失败保留当前灯位行并可重试')
  } finally {
    delete require.cache[recordsModulePath]
    delete require.cache[lightingModulePath]
    if (previousRecordsModule) require.cache[recordsModulePath] = previousRecordsModule
    if (previousLightingModule) require.cache[lightingModulePath] = previousLightingModule
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

runProjectDetailSwipeDeletionRegression()
runProjectDetailLightingSwipeRegression()

console.log('项目布线双入口、项目详情记录/线路/灯位左滑存储闭环专项通过。')

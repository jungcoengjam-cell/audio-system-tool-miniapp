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
assert.strictEqual(toolsDefinition.data.audioModules[1].image, undefined)

const toolsWxml = fs.readFileSync(path.join(root, 'pages/tools/tools.wxml'), 'utf8')
const toolsWxss = fs.readFileSync(path.join(root, 'pages/tools/tools.wxss'), 'utf8')
assert(toolsWxml.includes('url="{{item.path}}"'))
assert(toolsWxml.includes('wx:if="{{item.visual == \'project-wiring\'}}"'))
assert(toolsWxml.includes('class="wiring-device wiring-device-source"'))
assert(toolsWxml.includes('class="wiring-device wiring-device-destination"'))
assert.strictEqual((toolsWxml.match(/class="wiring-list-row"/g) || []).length, 3)
assert(toolsWxss.includes('.module-card{') && toolsWxss.includes('width:196rpx;height:234rpx'))
assert(toolsWxss.includes('.project-wiring-visual{')
  && toolsWxss.includes('.wiring-cable-one{')
  && toolsWxss.includes('.wiring-device-destination{')
  && toolsWxss.includes('@media (prefers-color-scheme: dark){.project-wiring-visual'))

let workspace = null
const routes = []
let activeProjectChanges = 0
const recordsApi = {
  MODULES: { limiter: { label: '限幅器', trustLabel: '核验完成', theme: 'blue' } },
  getWorkspaceSnapshot: () => workspace,
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
global.wx = { navigateTo: ({ url }) => routes.push(url) }
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

console.log('项目布线双入口与项目首页专项通过。')

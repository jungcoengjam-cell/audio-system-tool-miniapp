'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const app = require(path.join(root, 'app.json'))
const { MODULES } = require(path.join(root, 'utils/records'))
const registry = require(path.join(root, 'utils/tool-registry'))
const navigation = require(path.join(root, 'utils/primary-navigation'))

function pageAvailable(route) {
  const normalized = route.replace(/^\//, '')
  if (app.pages.includes(normalized)) return true
  return app.subPackages.some((pack) => normalized === `${pack.root}/${pack.pages.find((page) => `${pack.root}/${page}` === normalized)?.split('/').pop()}`)
}

assert.deepEqual(app.tabBar.list.map(({ text }) => text), ['工具', '项目', '依据'])
assert.deepEqual(app.tabBar.list.map(({ pagePath }) => `/${pagePath}`), navigation.PRIMARY_TABS.map(({ route }) => route))
assert.equal(app.tabBar.list[2].pagePath, 'pages/index/index', 'the established index route remains the basis tab')
assert.ok(app.pages.includes('pages/settings/settings'))
assert.ok(app.pages.includes('pages/basis/detail'))
assert.ok(app.pages.includes('pages/projects/favorite-detail'))
assert.ok(app.pages.includes('pages/projects/recovery'))
assert.ok(app.pages.includes('pages/records/report'))

assert.deepEqual(registry.CATEGORY_FILTERS, ['全部', '布线', '音频', '视频', '灯光', '中控'])
assert.equal(registry.getTools().length, 10)
assert.equal(new Set(registry.getTools().map(({ id }) => id)).size, 10)
for (const category of registry.CATEGORY_FILTERS.slice(1)) {
  assert.ok(registry.getTools(category).length > 0, `${category} must have at least one tool`)
  assert.ok(registry.getTools(category).every((tool) => tool.category === category))
}
for (const tool of registry.getTools()) {
  assert.ok(pageAvailable(tool.path), `${tool.id} route must exist in app.json: ${tool.path}`)
  if (MODULES[tool.id]) assert.equal(tool.path, MODULES[tool.id].path, `${tool.id} must reuse records registry route`)
}
assert.equal(registry.getTool('controlProtocol').path, '/pages/control-protocol/index')
assert.equal(registry.getTool('projectWiring').path, '/pages/project-wiring/index')
assert.equal(registry.getTool('unknown'), null)

const basisTools = registry.getBasisTools()
assert.deepEqual(basisTools.map(({ id }) => id), ['cable', 'gainStructure', 'limiter', 'spl', 'camera', 'ledScreen'])
for (const item of basisTools) assert.equal(item.path, `/pages/basis/detail?tool=${item.id}`)
const { buildBasisPresentation } = require(path.join(root, 'pages/basis/presentation'))
for (const tool of registry.BASIS_TOOLS) {
  const view = buildBasisPresentation(tool)
  assert.ok(view.pathSteps.length >= 3 && view.pathSteps.length <= 4, `${tool.id} has a compact process path`)
  assert.equal(view.methodGroups.map(({ text }) => text).join(''), tool.basis.method, `${tool.id} method copy remains complete`)
  for (const group of view.methodGroups) assert.equal(`${group.lead}${group.equation || (group.lead ? '' : group.text)}`, group.text, `${tool.id} method presentation preserves every character`)
  assert.equal(view.inputRows.map(({ label, separator, meaning, ending }) => `${label}${separator}${meaning}${ending}`).join(''), tool.basis.inputs, `${tool.id} input copy remains complete`)
  assert.equal(view.limitRows.map(({ text }) => text).join(''), tool.basis.limits, `${tool.id} limit copy remains complete`)
  assert.ok(view.limitRows.length >= 2 && view.limitRows.length <= 4, `${tool.id} limits are split into readable boundary notes`)
  assert.deepEqual(view.sourceTags, view.sourceTags.filter((tag) => tag.length > 0))
}
assert.deepEqual(buildBasisPresentation(registry.getBasisTool('cable')).sourceTags, ['公司线材标准'])
assert.ok(buildBasisPresentation(registry.getBasisTool('gainStructure')).sourceTags.includes('用户设备实测'))
assert.ok(buildBasisPresentation(registry.getBasisTool('gainStructure')).sourceTags.includes('所选型号说明书'))
assert.ok(buildBasisPresentation(registry.getBasisTool('ledScreen')).sourceTags.includes('工具内置规格'))
const ledInputs = registry.getBasisTool('ledScreen').basis.inputs
assert.match(ledInputs, /上下预留和观看距离：m；包边：cm\/边；单元尺寸：mm；内部统一换算为 m 计算/)
assert.match(ledInputs, /目标画面比例；点间距 P：mm。输出净屏和包边尺寸：m/)
const ledForm = fs.readFileSync(path.join(root, 'pages/led-screen/led-screen.wxml'), 'utf8')
const ledScript = fs.readFileSync(path.join(root, 'pages/led-screen/led-screen.js'), 'utf8')
assert.match(ledForm, /包边（每边）[\s\S]*?<text>cm<\/text>/)
assert.match(ledScript, /unitWidthMm/)
assert.match(ledScript, /unitHeightMm/)
assert.match(ledScript, /frameWidthMeters: frameWidthCm === null \? NaN : frameWidthCm \/ 100/)

const moduleUtils = new Map()
for (const tool of registry.BASIS_TOOLS) {
  const basis = tool.basis
  for (const field of ['subject', 'summary', 'what', 'method', 'inputs', 'sourceSummary', 'limits']) {
    assert.ok(typeof basis[field] === 'string' && basis[field].trim(), `${tool.id}.${field} must have user-facing copy`)
  }
  assert.ok(!/(?:utils|data)\/[\w./-]+/.test(basis.sourceSummary), `${tool.id} source UI must not show implementation paths`)
  assert.ok(Array.isArray(basis.sourceFiles) && basis.sourceFiles.length > 0, `${tool.id} needs an internal audit mapping`)
  for (const source of basis.sourceFiles) {
    const [relativePath, detail = ''] = source.split(' · ')
    assert.ok(fs.existsSync(path.join(root, relativePath)), `${tool.id} audit source exists: ${relativePath}`)
    if (relativePath.startsWith('utils/')) {
      let exports = moduleUtils.get(relativePath)
      if (!exports) {
        exports = require(path.join(root, relativePath))
        moduleUtils.set(relativePath, exports)
      }
      const functionNames = detail.match(/[A-Za-z][A-Za-z0-9]*(?=\s*(?:\/|$))/g) || []
      for (const name of functionNames) assert.equal(typeof exports[name], 'function', `${relativePath} exports ${name}`)
    }
  }
}

const camera = registry.getBasisTool('camera').basis
assert.match(camera.method, /8 个三维角点/)
assert.match(camera.method, /4 个角点/)
assert.match(camera.method, /每个候选距离都会重算俯仰与投影/)
assert.match(camera.limits, /水平角时只算水平约束并明确标注未完成垂直校核/)
assert.match(camera.sourceSummary, /镜头说明书/)
assert.match(registry.getBasisTool('gainStructure').basis.sourceSummary, /用户设备实测/)
assert.match(registry.getBasisTool('limiter').basis.sourceSummary, /不适用于所有 DSP/)
assert.match(registry.getBasisTool('cable').basis.method, /S ≥ P × L × 5/)
assert.match(registry.getBasisTool('cable').basis.method, /单程距离/)

const toolWxml = fs.readFileSync(path.join(root, 'pages/tools/tools.wxml'), 'utf8')
assert.match(toolWxml, /navigator wx:for="\{\{tools\}\}"/)
assert.match(toolWxml, /aria-label="打开\{\{item.title\}\}，\{\{item.subtitle\}\}"/)
assert.doesNotMatch(toolWxml, /home-tool-subtitle/)
const basisWxml = fs.readFileSync(path.join(root, 'pages/basis/detail.wxml'), 'utf8')
assert.doesNotMatch(basisWxml, /sourceFiles/)
assert.match(basisWxml, /计算示意/)
assert.match(basisWxml, /关键计算关系/)
assert.match(basisWxml, /关键边界/)
assert.match(basisWxml, /完整计算说明/)
assert.match(basisWxml, /presentation\.completeExplanation\.method/)
assert.match(basisWxml, /presentation\.completeExplanation\.inputs/)
assert.match(basisWxml, /presentation\.completeExplanation\.sourceSummary/)
assert.match(basisWxml, /bindtap="toggleFullExplanation"/)
const basisIndexWxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
assert.doesNotMatch(basisIndexWxml, /home-basis-category|item\.category/)
assert.match(basisIndexWxml, /item\.summary/)
assert.match(basisIndexWxml, /查看图解与说明/)
assert.doesNotMatch(basisIndexWxml, /sourceFiles|utils\/|data\//)
const toolsWxss = fs.readFileSync(path.join(root, 'pages/tools/tools.wxss'), 'utf8')
const basisWxss = fs.readFileSync(path.join(root, 'pages/basis/detail.wxss'), 'utf8')
const basisIndexWxss = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8')
const settingsWxss = fs.readFileSync(path.join(root, 'pages/settings/settings.wxss'), 'utf8')
for (const source of [toolsWxss, settingsWxss]) assert.match(source, /max-width:\s*340px/)
for (const source of [basisWxss, basisIndexWxss]) assert.match(source, /max-width:\s*374px/)
assert.match(basisWxss, /\.basis-detail-subtitle,\.basis-quick-method,\.basis-reference-copy,\.basis-full-copy\{font-size:14px/)
assert.match(basisWxss, /\.basis-quick-method[\s\S]*?overflow-wrap:anywhere/)
assert.match(basisIndexWxss, /\.home-basis-summary\{[^}]*font-size:26rpx/)
assert.match(basisWxss, /\.basis-figure\{[^}]*width:100%/)
assert.match(basisWxss, /\.basis-quick-method/)
assert.doesNotMatch(basisIndexWxss, /\.home-basis-category/)
assert.match(settingsWxss, /\.home-section-label,.settings-row-subtitle,.settings-footnote,.settings-info-label,.settings-info-value\{font-size:13px\}/)
assert.match(toolsWxss, /\.home-tool-title\{font-size:13px;line-height:1\.2\}\.home-library-title\{font-size:13px\}/)

const framing = require(path.join(root, 'utils/camera-framing'))
const fov = require(path.join(root, 'utils/camera-fov'))
const groundOptions = { widthMeters: 4, depthMeters: 6, subjectHeightMeters: 2.2, marginRatio: 0.1 }
const groundPlacement = fov.calculateGroundAreaPlacement({ horizontalFov: 90, verticalFov: 60, diagonalFov: 100 }, groundOptions)
assert.equal(groundPlacement.framingVersion, 2)
assert.equal(groundPlacement.worldDimensions.depth, 6)
assert.equal(groundPlacement.worldDimensions.top, 2.2)
assert.ok(groundPlacement.coverageVerified)
const groundCorners = framing.targetCorners({ distance: groundPlacement.primaryDistanceMeters, width: 4, depth: 6, top: 2.2 })
assert.equal(groundCorners.length, 8)
assert.ok(groundPlacement.requiredHorizontalFov <= groundPlacement.horizontalFov)
assert.ok(groundPlacement.requiredVerticalFov <= groundPlacement.verticalFov)
const planeCorners = framing.targetCorners({ distance: 5, width: 4, bottom: 0.5, top: 3 })
assert.equal(planeCorners.length, 4)

let appDefinition
globalThis.App = (definition) => { appDefinition = definition }
require(path.join(root, 'app.js'))
function launchApp(options) {
  const appState = { globalData: { primaryNavigation: { launchPath: '', restoreAllowed: false, restoreChecked: true } } }
  appDefinition.onLaunch.call(appState, options)
  return appState
}

const saved = new Map([
  ['audioTool.activeProject.v1', 'project-17'],
  ['audioTool.cable.preferences', { distance: '120', conductor: 'copper' }],
])
let appState = launchApp({ path: 'pages/tools/tools', scene: 1001 })
const switchCalls = []
globalThis.getApp = () => appState
globalThis.wx = {
  getStorageSync: (key) => saved.get(key),
  setStorageSync: (key, value) => saved.set(key, value),
  switchTab: ({ url }) => switchCalls.push(url),
}
assert.deepEqual(appState.globalData.primaryNavigation, {
  launchPath: 'pages/tools/tools', restoreAllowed: true, restoreChecked: false,
})
assert.equal(navigation.activatePrimaryTab('tools'), true, 'first ordinary default launch remains on tools')
assert.deepEqual(switchCalls, [])
assert.equal(saved.get(navigation.STORAGE_KEY), 'tools')
assert.equal(navigation.activatePrimaryTab('projects'), true, 'a user-selected tab becomes the preference')
assert.equal(saved.get(navigation.STORAGE_KEY), 'projects')
assert.equal(navigation.activatePrimaryTab('projects'), true, 'returning to the selected tab is not redirected')
assert.deepEqual(switchCalls, [])

saved.set(navigation.STORAGE_KEY, 'basis')
appState = launchApp({ path: 'pages/tools/tools', scene: 1005 })
switchCalls.length = 0
assert.equal(navigation.activatePrimaryTab('tools'), false, 'a later ordinary default launch restores the last valid tab')
assert.deepEqual(switchCalls, ['/pages/index/index'])
assert.equal(saved.get(navigation.STORAGE_KEY), 'basis', 'restore does not overwrite the preference before the tab is shown')
assert.equal(navigation.activatePrimaryTab('basis'), true)
assert.equal(saved.get(navigation.STORAGE_KEY), 'basis')
assert.equal(navigation.activatePrimaryTab('projects'), true)
assert.equal(navigation.activatePrimaryTab('projects'), true, 'returning from another page keeps the selected tab')
assert.deepEqual(switchCalls, ['/pages/index/index'])

saved.set(navigation.STORAGE_KEY, 'basis')
appState = launchApp({ path: 'pages/camera/camera', scene: 1007 })
switchCalls.length = 0
assert.equal(appState.globalData.primaryNavigation.restoreAllowed, false, 'calculator deep links disable tab restoration')
assert.equal(appState.globalData.primaryNavigation.restoreChecked, true)
assert.equal(navigation.activatePrimaryTab('projects'), true, 'the first user tab after a calculator deep link is honored')
assert.deepEqual(switchCalls, [])
assert.equal(saved.get(navigation.STORAGE_KEY), 'projects')
assert.equal(navigation.activatePrimaryTab('basis'), true)
assert.equal(navigation.activatePrimaryTab('projects'), true, 'tab returns after a deep link do not replay launch restoration')
assert.deepEqual(switchCalls, [])

for (const [launchPath, selectedTab, expectedSaved] of [
  ['pages/projects/projects', 'projects', 'projects'],
  ['pages/index/index', 'basis', 'basis'],
]) {
  saved.set(navigation.STORAGE_KEY, 'basis')
  appState = launchApp({ path: launchPath, scene: 1007 })
  switchCalls.length = 0
  assert.equal(appState.globalData.primaryNavigation.restoreAllowed, false, `${launchPath} explicit launch disables restoration`)
  assert.equal(navigation.activatePrimaryTab(selectedTab), true, `${selectedTab} explicit launch is honored`)
  assert.deepEqual(switchCalls, [])
  assert.equal(saved.get(navigation.STORAGE_KEY), expectedSaved)
}

saved.set(navigation.STORAGE_KEY, 'basis')
appState = launchApp({ path: 'pages/tools/tools?source=share', query: { source: 'share' }, scene: 1007 })
switchCalls.length = 0
assert.equal(appState.globalData.primaryNavigation.restoreAllowed, false, 'a parameterized tools deep link is not treated as an ordinary launch')
assert.equal(navigation.activatePrimaryTab('tools'), true)
assert.deepEqual(switchCalls, [])
assert.equal(saved.get(navigation.STORAGE_KEY), 'tools')

assert.equal(navigation.initializePrimaryNavigation({}).restoreAllowed, false, 'missing launch path fails closed')
assert.equal(navigation.initializePrimaryNavigation({ path: 'pages/tools/tools', scene: 9999 }).restoreAllowed, true, 'path-based default restore does not rely on an incomplete scene allowlist')

saved.set(navigation.STORAGE_KEY, 'legacy-page-route')
appState = launchApp({ path: 'pages/tools/tools', scene: 1001 })
switchCalls.length = 0
assert.equal(navigation.activatePrimaryTab('tools'), true)
assert.deepEqual(switchCalls, [])
assert.equal(saved.get(navigation.STORAGE_KEY), 'tools', 'invalid preference safely falls back to the tools tab')
assert.equal(saved.get('audioTool.activeProject.v1'), 'project-17')
assert.deepEqual(saved.get('audioTool.cable.preferences'), { distance: '120', conductor: 'copper' })
assert.equal(navigation.normalizeLaunchPath('/pages/camera/camera?tool=test'), 'pages/camera/camera')

let detailPage
globalThis.Page = (definition) => { detailPage = definition }
require(path.join(root, 'pages/basis/detail.js'))
let basisPageData = {}
detailPage.onLoad.call({ setData: (values) => { basisPageData = { ...basisPageData, ...values } } }, { tool: 'limiter' })
assert.equal(basisPageData.basisTool.id, 'limiter')
assert.equal(basisPageData.presentation.methodGroups.map(({ text }) => text).join(''), basisPageData.basisTool.basis.method)
assert.equal(basisPageData.presentation.pathSteps.length, 4)
let backCalls = 0
let navigateCalls = 0
globalThis.getCurrentPages = () => [{ route: 'pages/limiter/limiter' }, { route: 'pages/basis/detail' }]
globalThis.wx.navigateBack = ({ delta }) => { backCalls = delta }
globalThis.wx.navigateTo = () => { navigateCalls += 1 }
detailPage.openTool.call({ data: { basisTool: registry.getBasisTool('limiter') } })
assert.equal(backCalls, 1, 'opening the calculator from its basis detail returns to the existing calculator instance')
assert.equal(navigateCalls, 0)

let settingsPage
globalThis.Page = (definition) => { settingsPage = definition }
require(path.join(root, 'pages/settings/settings.js'))
let resetModal
const removedPreferences = []
let resetToast
globalThis.wx.showModal = (options) => { resetModal = options }
globalThis.wx.removeStorageSync = (key) => {
  removedPreferences.push(key)
  saved.delete(key)
}
globalThis.wx.showToast = (options) => { resetToast = options }
globalThis.wx.vibrateShort = () => {}
const settingsInstance = { ...settingsPage, data: { ...settingsPage.data }, setData(values) { Object.assign(this.data, values) } }
settingsInstance.resetPreferences()
assert.match(resetModal.content, /清除七个计算工具记住的上次输入/)
assert.match(resetModal.content, /重新显示全部工具/)
assert.match(resetModal.content, /项目、收藏、计算记录和产品资料保留/)
resetModal.success({ confirm: true })
assert.deepEqual(removedPreferences, [
  'audioTool.limiter.preferences', 'audioTool.spl.preferences', 'audioTool.cable.preferences',
  'audioTool.camera.preferences', 'audioTool.ledScreen.preferences',
  'audioTool.gainStructure.preferences', 'audioTool.dmxAddress.preferences',
  'audioTool.toolVisibility.v1',
])
assert.equal(saved.get(navigation.STORAGE_KEY), 'tools', 'reset preserves the last valid primary tab')
assert.equal(saved.get('audioTool.activeProject.v1'), 'project-17', 'reset preserves the inert historical active-project key')
assert.equal(resetToast.title, '已恢复默认')

console.log('navigation-basis-behavior: all checks passed')

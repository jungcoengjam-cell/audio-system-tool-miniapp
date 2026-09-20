const assert = require('assert')
const path = require('path')

const root = path.resolve(__dirname, '..')
const storage = new Map()
const queuedNextTicks = []
let definition = null
let exportCallbacks = null
let toastCount = 0
let hideLoadingCount = 0

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

global.wx = {
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
  getStorageSync: (key) => clone(storage.get(key)),
  setStorageSync: (key, value) => storage.set(key, clone(value)),
  showToast: () => { toastCount += 1 },
  showLoading: () => {},
  hideLoading: () => { hideLoadingCount += 1 },
  vibrateShort: () => {},
  navigateTo: () => {},
  nextTick: (callback) => queuedNextTicks.push(callback),
  createCanvasContext: () => ({
    save() {}, restore() {}, scale() {}, translate() {}, setFillStyle() {}, fillRect() {},
    setStrokeStyle() {}, setLineWidth() {}, strokeRect() {}, setFontSize() {}, fillText() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setTextAlign() {}, arc() {}, fill() {},
    setLineDash() {}, draw() {},
  }),
  canvasToTempFilePath: (options) => { exportCallbacks = options },
}
global.Page = (value) => { definition = value }

function createPage(relativePath) {
  const file = path.join(root, relativePath)
  definition = null
  delete require.cache[require.resolve(file)]
  require(file)
  assert(definition, `${relativePath} 未注册页面`)
  const page = { ...definition, data: clone(definition.data) }
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      const segments = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      segments.slice(0, -1).forEach((segment) => { target = target[segment] })
      target[segments.at(-1)] = value
    })
    if (callback) callback()
  }
  return page
}

function setDmxPreferences(groups) {
  storage.set('audioTool.dmxAddress.preferences', {
    startAddressText: '1',
    allocationMode: 'auto',
    groups,
  })
  storage.delete('audioTool.dmxLayout.v1')
  storage.delete('audioTool.dmxAddress.progress')
}

function testProgressReload() {
  setDmxPreferences([{ name: '测试灯', fixtureSource: 'custom', fixtureCount: '2', channelCount: '8', targetUniverse: 'A' }])
  const portrait = createPage('pages/dmx-layout/dmx-layout.js')
  portrait.onLoad()
  portrait.setData({ layoutImagePath: 'old.png', previewVisible: true })
  const landscape = createPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  landscape.onLoad()
  landscape.selectFixture(landscape._fixtures[0])
  landscape.toggleSelectedProgress()
  landscape.onUnload()
  portrait._awaitingLandscapeReturn = true
  portrait.onShow()
  assert(portrait._checkedKeys.has('0:1:A001'), '横屏标记后返回未保留进度')
  const landscapeCancel = createPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  landscapeCancel.onLoad()
  landscapeCancel.selectFixture(landscapeCancel._fixtures[0])
  landscapeCancel.toggleSelectedProgress()
  landscapeCancel.onUnload()
  portrait._awaitingLandscapeReturn = true
  portrait.onShow()
  assert(!portrait._checkedKeys.has('0:1:A001'), '横屏取消标记后返回仍残留旧进度')
  portrait.selectFixture(portrait._fixtures[1])
  portrait.toggleSelectedProgress()
  assert(portrait._checkedKeys.has('0:2:A009'), '人像模式第二台标记未持久化')
  assert.strictEqual(portrait.data.previewVisible, false, '横屏返回未清除旧图预览状态')
  assert.strictEqual(portrait.data.layoutImagePath, '', '横屏返回未清除旧图路径')
}

function testBarConfigurationAndPan() {
  const page = createPage('pages/dmx-layout/dmx-layout.js')
  page.onLoad()
  page.onRowChange({ detail: { value: 3 } })
  assert.strictEqual(page._positionDefinitions.length, 4, '排数变更未重建 4 个灯位定义')
  assert.strictEqual(page._barCounts.length, 4, '排数变更未重建 4 组计数')
  assert.strictEqual(page.data.barRows.length, 4, '排数变更后 barRows 仍是旧长度')
  page.onSchemeChange({ detail: { value: 2 } })
  assert.strictEqual(page.data.barRows.length, page._positionDefinitions.length, '方案切换后 barRows 未同步')
  page.onSidePairChange({ detail: { value: 2 } })
  assert.strictEqual(page.data.barRows.length, page._positionDefinitions.length, '侧光对数变更后 barRows 未同步')
  page.data.barRows = []
  page.toggleBarConfiguration()
  assert.strictEqual(page.data.barRows.length, page._positionDefinitions.length, '展开配置时未刷新最新 barRows')

  page._canvasRect = { left: 0, top: 0, width: 350, height: 450 }
  const oneXPan = page.clampViewPan(1, -100, 100)
  assert(oneXPan.x === 0, '1 倍缩放不应留下平移空白')
  assert(oneXPan.y === 0, '1 倍缩放不应留下垂直空白')
  assert.deepStrictEqual(page.clampViewPan(2, -999, 999), { x: -350, y: 0 }, '2 倍缩放边界错误')
  assert.deepStrictEqual(page.clampViewPan(2.5, 999, -999), { x: 0, y: -675 }, '2.5 倍缩放边界错误')
  page._view = { s: 2, x: -100, y: -120 }
  page._canvasScaleX = 0.5
  page._canvasScaleY = 0.5
  const logical = { x: 300, y: 400 }
  const client = { x: logical.x * 0.5 * 2 - 100, y: logical.y * 0.5 * 2 - 120 }
  const roundTrip = page.logicalPoint(client)
  assert(Math.abs(roundTrip.x - logical.x) < 1e-9 && Math.abs(roundTrip.y - logical.y) < 1e-9, '缩放平移坐标换算未保持锚点')
}

function testGenerationGuard() {
  setDmxPreferences([{ name: '测试灯', fixtureSource: 'custom', fixtureCount: '1', channelCount: '8', targetUniverse: 'A' }])
  exportCallbacks = null
  const beforeNextTick = createPage('pages/dmx-layout/dmx-layout.js')
  beforeNextTick.onLoad()
  beforeNextTick.drawLayout = () => { throw new Error('卸载后不应执行 nextTick 导出绘制') }
  beforeNextTick.generateLayoutImage()
  const queuedDraw = queuedNextTicks.shift()
  beforeNextTick.onUnload()
  queuedDraw()
  assert.strictEqual(exportCallbacks, null, 'nextTick 前卸载仍启动导出 Canvas')
  assert.strictEqual(beforeNextTick.data.previewVisible, false, 'nextTick 前卸载产生预览')

  exportCallbacks = null
  const page = createPage('pages/dmx-layout/dmx-layout.js')
  page.onLoad()
  page.drawLayout = (options, callback) => { if (callback) callback() }
  page.generateLayoutImage()
  assert.strictEqual(queuedNextTicks.length > 0, true, '生成图未排入 nextTick')
  queuedNextTicks.shift()()
  assert(exportCallbacks, '导出 Canvas 回调未创建')
  const success = exportCallbacks.success
  const toastsBeforeUnload = toastCount
  page.onUnload()
  success({ tempFilePath: 'late.png' })
  assert.strictEqual(page.data.previewVisible, false, '卸载后迟到成功回调仍显示预览')
  assert.strictEqual(page.data.layoutImagePath, '', '卸载后迟到成功回调仍写入图片路径')
  assert.strictEqual(toastCount, toastsBeforeUnload, '卸载后迟到回调错误弹 Toast')
  assert(hideLoadingCount > 0, '卸载时未收尾生成 loading')

  exportCallbacks = null
  const lateFail = createPage('pages/dmx-layout/dmx-layout.js')
  lateFail.onLoad()
  lateFail.drawLayout = (options, callback) => { if (callback) callback() }
  lateFail.generateLayoutImage()
  queuedNextTicks.shift()()
  const fail = exportCallbacks.fail
  const failToastsBeforeUnload = toastCount
  lateFail.onUnload()
  fail()
  assert.strictEqual(lateFail.data.previewVisible, false, '卸载后迟到失败回调写入预览状态')
  assert.strictEqual(toastCount, failToastsBeforeUnload, '卸载后迟到失败回调错误弹 Toast')
}

function testCustomFixtureModelCache() {
  const { dmxFixtures } = require('../data/stage-lighting')
  const model = dmxFixtures[0].model
  const fixture = dmxFixtures[0]
  storage.set('audioTool.dmxAddress.preferences', {
    startAddressText: '1', allocationMode: 'auto', groups: [{
      name: `${fixture.model} ${fixture.name}`,
      fixtureSource: 'library', fixtureModel: model, fixtureCount: '1',
      channelCount: String(fixture.channelModes[0]), targetUniverse: 'A',
    }],
  })
  const page = createPage('pages/dmx-address/dmx-address.js')
  page.onLoad()
  page.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'custom' } } })
  assert.strictEqual(page.data.groups[0].fixtureModel, model, '库内切自定义时丢失旧产品型号缓存')
  assert.strictEqual(page._calculationResult.fixtures[0].fixtureModel, '', '自定义计算结果仍携带旧产品型号')
  page.openFixtureChannelGuide({ currentTarget: { dataset: { globalIndex: 1 } } })
  assert.strictEqual(page.data.fixtureChannelGuide, null, '自定义结果错误展示旧产品已核对通道')
  page.onGroupInput({ currentTarget: { dataset: { index: 0, field: 'channelCount' } }, detail: { value: '20' } })
  page.flushScheduledCalculation()
  page.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'library' } } })
  assert.strictEqual(page.data.groups[0].fixtureModel, model, '切回库内未恢复旧产品型号')
  assert.strictEqual(page.data.groups[0].channelCount, String(fixture.channelModes[0]), '切回库内未恢复旧通道模式')
}

testProgressReload()
testBarConfigurationAndPan()
testGenerationGuard()
testCustomFixtureModelCache()
console.log('audit-dmx-regression: 5 checks passed')

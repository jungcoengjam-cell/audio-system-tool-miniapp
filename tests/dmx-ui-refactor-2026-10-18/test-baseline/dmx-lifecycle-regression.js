const assert = require('assert')
const path = require('path')
const { calculateDmxAddressPlan } = require('../utils/dmx-address')
const layoutModel = require('../pages/dmx-layout/layout-model')
const { resolveSavedLayout } = require('../pages/dmx-layout/layout-storage')

const root = path.resolve(__dirname, '..')
const storage = new Map([
  ['audioTool.dmxAddress.preferences', {
    startAddressText: '1', allocationMode: 'auto', groups: [
      { name: '测试灯', fixtureSource: 'custom', fixtureCount: '2', channelCount: '8', targetUniverse: 'A' },
    ],
  }],
])
const selectorCallbacks = []
const drawCallbacks = []
const nextTickCallbacks = []
let canvasDrawCount = 0
let exportOptions = null
let pageDefinition = null

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function createContext() {
  const context = {}
  for (const name of [
    'save', 'restore', 'scale', 'translate', 'setFillStyle', 'fillRect', 'setStrokeStyle',
    'setLineWidth', 'strokeRect', 'setFontSize', 'fillText', 'beginPath', 'moveTo', 'lineTo',
    'stroke', 'setTextAlign', 'arc', 'fill', 'setLineDash',
  ]) context[name] = () => {}
  context.draw = (reserve, callback) => {
    canvasDrawCount += 1
    if (callback) drawCallbacks.push(callback)
  }
  return context
}

global.wx = {
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
  getStorageSync: (key) => clone(storage.get(key)),
  setStorageSync: (key, value) => storage.set(key, clone(value)),
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  vibrateShort: () => {},
  nextTick: (callback) => nextTickCallbacks.push(callback),
  canvasToTempFilePath: (options) => { exportOptions = options },
  createCanvasContext: () => createContext(),
  createSelectorQuery: () => {
    const query = {
      select: () => query,
      boundingClientRect: (callback) => { selectorCallbacks.push(callback); return query },
      exec: () => {},
    }
    return query
  },
}
global.Page = (definition) => { pageDefinition = definition }

function createPage(relativePath = 'pages/dmx-layout/dmx-layout.js') {
  pageDefinition = null
  const file = path.join(root, relativePath)
  delete require.cache[require.resolve(file)]
  require(file)
  assert(pageDefinition, '位置图页面未注册')
  const page = { ...pageDefinition, data: clone(pageDefinition.data) }
  page._setDataCalls = []
  page.setData = (patch, callback) => {
    page._setDataCalls.push(clone(patch))
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

function invokeSelector(rect = { left: 0, top: 0, width: 350, height: 450 }) {
  const callback = selectorCallbacks.shift()
  assert(callback, '没有排队的 Canvas 测量回调')
  callback(rect)
}

function testLateMeasureAfterUnload() {
  const page = createPage()
  page.onLoad()
  page.onReady()
  const before = canvasDrawCount
  page.onUnload()
  invokeSelector()
  assert.strictEqual(canvasDrawCount, before, '卸载后的测量回调仍绘制 Canvas')

  const drawPage = createPage()
  drawPage.onLoad()
  let lateCallbackCount = 0
  drawPage.drawLayout({}, () => { lateCallbackCount += 1 })
  const lateDraw = drawCallbacks.shift()
  assert(lateDraw, '普通 Canvas 绘制没有排队回调')
  const setDataCallsBeforeUnload = drawPage._setDataCalls.length
  drawPage.onUnload()
  lateDraw()
  assert.strictEqual(lateCallbackCount, 0, '卸载后的 Canvas 回调仍调用外部回调')
  assert.strictEqual(drawPage._setDataCalls.length, setDataCallsBeforeUnload,
    '卸载后的 Canvas 回调仍触发视图更新或新任务')
}

function testHideAndShowRemeasures() {
  const page = createPage()
  page.onLoad()
  page.onReady()
  const before = canvasDrawCount
  const oldMeasure = selectorCallbacks.shift()
  assert(oldMeasure, '首次测量没有排队回调')
  let oldDrawCallbackCount = 0
  page.drawLayout({}, () => { oldDrawCallbackCount += 1 })
  const oldDraw = drawCallbacks.shift()
  assert(oldDraw, '首次普通绘制没有排队回调')
  page.setData({ scrollEnabled: false, paletteDragging: true })
  page.onHide()
  const hiddenQueriesBefore = selectorCallbacks.length
  page.measureCanvas()
  assert.strictEqual(selectorCallbacks.length, hiddenQueriesBefore,
    '隐藏后的主动 measureCanvas 仍排入 selector query')
  page.onShow()
  assert.strictEqual(page.data.scrollEnabled, true, '隐藏中断手势后重新显示未恢复滚动')
  assert.strictEqual(page.data.paletteDragging, false, '隐藏中断 palette 拖动后未清理拖动状态')
  const newMeasure = selectorCallbacks.shift()
  assert(newMeasure, '重新显示后没有排队新测量')
  newMeasure({ left: 9, top: 9, width: 200, height: 200 })
  const drawCountAfterNewMeasure = canvasDrawCount
  oldMeasure({ left: 1, top: 1, width: 100, height: 100 })
  assert.deepStrictEqual(page._canvasRect, { left: 9, top: 9, width: 200, height: 200 },
    '新测量完成后迟到的旧测量覆盖了 Canvas 尺寸')
  assert.strictEqual(canvasDrawCount, drawCountAfterNewMeasure,
    '隐藏期间的旧测量回调仍绘制 Canvas')
  oldDraw()
  assert.strictEqual(oldDrawCallbackCount, 0, '重新显示后迟到的旧 Canvas 回调仍调用外部回调')
  assert(canvasDrawCount > before, '重新显示后没有恢复 Canvas 测量和绘制')
}

function testDragToGestureTransitionCommits() {
  const page = createPage()
  page.onLoad()
  page._canvasRect = { left: 0, top: 0, width: 350, height: 450 }
  page._canvasScaleX = 0.5
  page._canvasScaleY = 0.5
  const fixture = page._fixtures[0]
  const key = `${fixture.groupIndex}:${fixture.fixtureIndex}`
  const oldPosition = { ...page._positions[key] }
  const oldBars = JSON.stringify(page._barCounts)
  const stage = page.getDisplayStageRect()
  const oldPoint = layoutModel.posPoint(oldPosition, stage, true)
  page.onCanvasTouchStart({ touches: [{ clientX: oldPoint.x * 0.5, clientY: oldPoint.y * 0.5 }] })
  page.onCanvasTouchMove({ touches: [{ clientX: (stage.left + 30) * 0.5, clientY: (stage.top + 270) * 0.5 }] })
  page.onCanvasTouchStart({ touches: [
    { clientX: 100, clientY: 100 }, { clientX: 180, clientY: 100 },
  ] })
  assert.notDeepStrictEqual(page._positions[key], oldPosition, '拖动没有在双指切换前改变位置')
  const expectedBars = layoutModel.barsFromPositions(
    page._fixtures, page._positions, page._groups, page._positionDefinitions,
    page.data.rowIndex + 1, page.data.sidePairIndex + 1,
  )
  assert.notStrictEqual(JSON.stringify(expectedBars), oldBars, '测试没有跨到另一个杆位')
  assert.deepStrictEqual(page._barCounts, expectedBars, '双指切换前没有同步杆位计数')
  const saved = storage.get('audioTool.dmxLayout.v1')
  assert.deepStrictEqual(saved.positions[key], page._positions[key], '双指切换前没有保存已移动位置')
  page.onCanvasTouchEnd({ touches: [] })

  const hiddenPage = createPage()
  hiddenPage.onLoad()
  hiddenPage._canvasRect = { left: 0, top: 0, width: 350, height: 450 }
  hiddenPage._canvasScaleX = 0.5
  hiddenPage._canvasScaleY = 0.5
  const hiddenFixture = hiddenPage._fixtures[0]
  const hiddenKey = `${hiddenFixture.groupIndex}:${hiddenFixture.fixtureIndex}`
  const hiddenStage = hiddenPage.getDisplayStageRect()
  const hiddenOld = { ...hiddenPage._positions[hiddenKey] }
  const hiddenPoint = layoutModel.posPoint(hiddenOld, hiddenStage, true)
  hiddenPage.onCanvasTouchStart({ touches: [{ clientX: hiddenPoint.x * 0.5, clientY: hiddenPoint.y * 0.5 }] })
  hiddenPage.onCanvasTouchMove({ touches: [{ clientX: (hiddenStage.left + 30) * 0.5, clientY: (hiddenStage.top + 270) * 0.5 }] })
  const hiddenPosition = { ...hiddenPage._positions[hiddenKey] }
  hiddenPage.onHide()
  const hiddenSaved = storage.get('audioTool.dmxLayout.v1')
  assert.deepStrictEqual(hiddenSaved.positions[hiddenKey], hiddenPosition,
    '拖动后隐藏未保存最新位置')
  assert.deepStrictEqual(hiddenSaved.barCounts, hiddenPage._barCounts,
    '拖动后隐藏仍持久化旧杆位计数')
  hiddenPage.onShow()
  assert.deepStrictEqual(hiddenPage._barCounts, layoutModel.barsFromPositions(
    hiddenPage._fixtures, hiddenPage._positions, hiddenPage._groups,
    hiddenPage._positionDefinitions, hiddenPage.data.rowIndex + 1, hiddenPage.data.sidePairIndex + 1,
  ), '隐藏后重新显示杆位计数未保持一致')

  const unloadPage = createPage()
  unloadPage.onLoad()
  unloadPage._canvasRect = { left: 0, top: 0, width: 350, height: 450 }
  unloadPage._canvasScaleX = 0.5
  unloadPage._canvasScaleY = 0.5
  const unloadFixture = unloadPage._fixtures[0]
  const unloadKey = `${unloadFixture.groupIndex}:${unloadFixture.fixtureIndex}`
  const unloadStage = unloadPage.getDisplayStageRect()
  const unloadPoint = layoutModel.posPoint(unloadPage._positions[unloadKey], unloadStage, true)
  unloadPage.onCanvasTouchStart({ touches: [{ clientX: unloadPoint.x * 0.5, clientY: unloadPoint.y * 0.5 }] })
  unloadPage.onCanvasTouchMove({ touches: [{ clientX: (unloadStage.left + 32) * 0.5, clientY: (unloadStage.top + 268) * 0.5 }] })
  const unloadPosition = { ...unloadPage._positions[unloadKey] }
  unloadPage.onUnload()
  const unloadSaved = storage.get('audioTool.dmxLayout.v1')
  assert.deepStrictEqual(unloadSaved.positions[unloadKey], unloadPosition,
    '拖动后直接卸载未保存最新位置')
  assert.deepStrictEqual(unloadSaved.barCounts, unloadPage._barCounts,
    '拖动后直接卸载仍持久化旧杆位计数')
}

function testSavedLayoutRecoveryPolicy() {
  const groups = [{ id: 'group-1', name: '测试灯', channelCount: '8', fixtureCount: '2', targetUniverse: 'A' }]
  const result = calculateDmxAddressPlan({ startAddress: '1', groups, allocationMode: 'auto' })
  const firstKey = `${result.fixtures[0].groupIndex}:${result.fixtures[0].fixtureIndex}`
  const completeSaved = {
    rowCount: 3, schemeId: 'top', preserveUnplaced: false,
    positions: {}, barCounts: [[1], [1], [0]],
  }
  storage.set('audioTool.dmxLayout.v1', clone(completeSaved))
  selectorCallbacks.length = 0
  const portrait = createPage('pages/dmx-layout/dmx-layout.js')
  portrait.onLoad()
  assert.strictEqual(Object.keys(portrait._positions).length, result.fixtures.length,
    'portrait onLoad 未恢复 preserveUnplaced=false 的缺位')
  assert.deepStrictEqual(portrait._barCounts, completeSaved.barCounts,
    'portrait onLoad 改写了已保存杆位计数')
  assert.strictEqual(portrait.data.barRows.length, portrait._positionDefinitions.length,
    'portrait onLoad 的页面杆位字段未同步')

  const completePositions = clone(portrait._positions)
  const completeBars = clone(portrait._barCounts)
  storage.set('audioTool.dmxLayout.v1', {
    ...completeSaved, positions: completePositions, barCounts: completeBars,
  })
  portrait._awaitingLandscapeReturn = true
  portrait.onShow()
  selectorCallbacks.shift()
  assert.deepStrictEqual(clone(portrait._positions), completePositions,
    'portrait 返回后 reloadSavedLayout 未恢复完整位置')
  assert.deepStrictEqual(portrait._barCounts, completeBars,
    'portrait 返回后 reloadSavedLayout 未恢复完整杆位')

  const landscape = createPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  landscape.onLoad()
  assert.strictEqual(landscape.data.isLandscape, true, '横屏实际入口未加载')
  assert.deepStrictEqual(clone(landscape._positions), completePositions, '横屏入口位置恢复不一致')
  landscape.onUnload()
  portrait._awaitingLandscapeReturn = true
  portrait.onShow()
  selectorCallbacks.shift()
  assert.deepStrictEqual(clone(portrait._positions), completePositions, '横屏退出后竖屏返回位置不一致')

  const schemeChanged = {
    rowCount: 2, schemeId: 'full', sidePairManual: true, sidePairCount: 1,
    preserveUnplaced: false, positions: {}, barCounts: [[1], [1], [0], [0]],
  }
  storage.set('audioTool.dmxLayout.v1', clone(schemeChanged))
  portrait.reloadSavedLayout()
  selectorCallbacks.shift()
  assert.strictEqual(portrait.data.schemeIndex, 2, 'reloadSavedLayout 未应用方案变化')
  assert.strictEqual(portrait.data.rowIndex, 1, 'reloadSavedLayout 未应用排数变化')
  assert.strictEqual(Object.keys(portrait._positions).length, result.fixtures.length,
    '方案变化后 preserveUnplaced=false 未自动补齐位置')
  assert.strictEqual(portrait.data.barRows.length, portrait._positionDefinitions.length,
    '方案变化后页面杆位字段未同步')

  const preserved = { ...schemeChanged, preserveUnplaced: true, positions: {}, barCounts: [[1], [1], [0], [0]] }
  storage.set('audioTool.dmxLayout.v1', clone(preserved))
  const preservedPage = createPage('pages/dmx-layout/dmx-layout.js')
  preservedPage.onLoad()
  assert.strictEqual(Object.keys(preservedPage._positions).length, 0,
    'portrait onLoad 错误补齐 preserveUnplaced=true 的缺位')
  assert.deepStrictEqual(preservedPage._barCounts, [[0], [0], [0], [0], [0]],
    'portrait onLoad 未按有效位置重建 preserveUnplaced=true 的杆位')
  assert.strictEqual(preservedPage.data.unplacedFixtureCount, result.fixtures.length,
    'portrait onLoad 未反映 preserveUnplaced=true 的缺位数')
  preservedPage.reloadSavedLayout()
  selectorCallbacks.shift()
  assert.strictEqual(Object.keys(preservedPage._positions).length, 0,
    'reloadSavedLayout 错误补齐 preserveUnplaced=true 的缺位')
  assert.deepStrictEqual(preservedPage._barCounts, [[0], [0], [0], [0], [0]],
    'reloadSavedLayout 未按有效位置重建 preserveUnplaced=true 的杆位')

  storage.set('audioTool.dmxLayout.v1', {
    ...completeSaved, positions: completePositions, barCounts: completeBars,
  })
  const completePage = createPage('pages/dmx-layout/dmx-layout.js')
  completePage.onLoad()
  assert.deepStrictEqual(clone(completePage._positions), completePositions,
    '完整保存布局 onLoad 未保持位置')
  assert.deepStrictEqual(completePage._barCounts, completeBars,
    '完整保存布局 onLoad 未保持杆位')
  assert(firstKey in completePage._positions, '完整保存布局缺少第一台灯')

  const incompleteAutomatic = resolveSavedLayout({
    rowCount: 3, schemeId: 'top', preserveUnplaced: false, positions: {}, barCounts: [[1], [1], [0]],
  }, result.fixtures, groups)
  assert.strictEqual(Object.keys(incompleteAutomatic.positions).length, result.fixtures.length,
    'preserveUnplaced=false 未按首次加载策略自动补齐位置')
  const incompletePreserved = resolveSavedLayout({
    rowCount: 3, schemeId: 'top', preserveUnplaced: true, positions: {}, barCounts: [[1], [1], [0]],
  }, result.fixtures, groups)
  assert.strictEqual(Object.keys(incompletePreserved.positions).length, 0,
    'preserveUnplaced=true 错误自动补齐缺位')
}

function testExportIsNotBlockedByVisibilityGuard() {
  drawCallbacks.length = 0
  nextTickCallbacks.length = 0
  exportOptions = null
  const page = createPage()
  page.onLoad()
  page.generateLayoutImage()
  page.onHide()
  const nextTick = nextTickCallbacks.shift()
  assert(nextTick, '导出没有排入 nextTick')
  nextTick()
  const draw = drawCallbacks.shift()
  assert(draw, '隐藏后导出 Canvas 被错误拦截')
  draw()
  assert(exportOptions, '隐藏后导出回调未创建')
}

testLateMeasureAfterUnload()
testHideAndShowRemeasures()
testDragToGestureTransitionCommits()
testSavedLayoutRecoveryPolicy()
testExportIsNotBlockedByVisibilityGuard()
console.log('dmx-lifecycle-regression: 5 checks passed')

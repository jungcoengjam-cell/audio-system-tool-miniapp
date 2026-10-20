const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { resolveSavedLayout } = require('../pages/dmx-layout/layout-storage')
const layoutModel = require('../pages/dmx-layout/layout-model')

const root = path.resolve(__dirname, '..')
const LAYOUT_KEY = 'audioTool.dmxLayout.v1'
const ADDRESS_KEY = 'audioTool.dmxAddress.preferences'
const PROGRESS_KEY = 'audioTool.dmxAddress.progress'
const storage = new Map()
let pageDefinition = null
let modalResult = { confirm: false }
let modalOptions = []
let storageWriteCount = 0
let currentPages = []
let lastNavigation = null
let deferModalResult = false
let pendingModalResult = null
let failNavigateBack = false
let failRedirectTo = false

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
  context.draw = (_reserve, callback) => { if (callback) callback() }
  return context
}

global.wx = {
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
  getStorageSync: (key) => clone(storage.get(key)),
  setStorageSync: (key, value) => { storageWriteCount += 1; storage.set(key, clone(value)) },
  showToast: () => {},
  showModal: (options) => {
    modalOptions.push(options)
    if (deferModalResult) pendingModalResult = options
    else options.success?.(clone(modalResult))
  },
  showLoading: () => {},
  hideLoading: () => {},
  canvasToTempFilePath: (options) => options.success?.({ tempFilePath: '/tmp/dmx-position-test.png' }),
  vibrateShort: () => {},
  createCanvasContext: () => createContext(),
  createSelectorQuery: () => {
    const query = {
      select: () => query,
      boundingClientRect: (callback) => { query.callback = callback; return query },
      exec: () => query.callback?.({ left: 0, top: 0, width: 350, height: 450 }),
    }
    return query
  },
  navigateTo: (options) => { lastNavigation = { type: 'navigateTo', ...options } },
  navigateBack: (options) => {
    lastNavigation = { type: 'navigateBack', ...options }
    if (failNavigateBack) options.fail?.({ errMsg: 'mock navigateBack failure' })
  },
  redirectTo: (options) => {
    lastNavigation = { type: 'redirectTo', ...options }
    if (failRedirectTo) options.fail?.({ errMsg: 'mock redirectTo failure' })
  },
}
global.getCurrentPages = () => currentPages
global.Page = (definition) => { pageDefinition = definition }

function resetStorage(layout) {
  storage.clear()
  storageWriteCount = 0
  modalOptions = []
  modalResult = { confirm: false }
  deferModalResult = false
  pendingModalResult = null
  failNavigateBack = false
  failRedirectTo = false
  lastNavigation = null
  storage.set(ADDRESS_KEY, {
    startAddressText: '1',
    allocationMode: 'auto',
    groups: [{
      name: '首用体验测试灯',
      fixtureSource: 'custom',
      channelCount: '8',
      fixtureCount: '4',
      targetUniverse: 'A',
    }],
  })
  if (layout) storage.set(LAYOUT_KEY, clone(layout))
}

function createPage(relativePath = 'pages/dmx-layout/dmx-layout.js') {
  pageDefinition = null
  const file = path.join(root, relativePath)
  delete require.cache[require.resolve(file)]
  require(file)
  assert(pageDefinition, `页面未注册：${relativePath}`)
  const page = { ...pageDefinition, data: clone(pageDefinition.data) }
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

function testFirstAutomaticLayoutAndLegacySource() {
  resetStorage()
  const first = createPage()
  first.onLoad()
  assert.equal(first._positionSource, 'automatic', '首次自动初排来源未标为 automatic')
  assert.equal(first._positionAutoFilledCount, 0, '首次自动初排被误计为旧位置补齐')
  assert.match(first.data.positionSourceHint, /自动排布.*建议位置，需现场核对/)
  assert.match(first.data.positionProgressText, /位置已布置 4 \/ 4，待布置 0/)
  first.saveLayout()
  assert.equal(storage.get(LAYOUT_KEY).positionSource, 'automatic', '首次自动初排来源没有持久化')

  const reopened = createPage()
  reopened.onLoad()
  assert.equal(reopened._positionSource, 'automatic', '重进后自动来源丢失')
  assert.equal(reopened._positionAutoFilledCount, 0, '重进后首次初排仍误显示旧位置补齐')
  assert.match(reopened.data.positionSourceHint, /自动排布.*建议位置，需现场核对/)
  reopened.applyAutomaticLayout()
  assert.equal(modalOptions.length, 0, 'automatic 来源的默认重排仍弹出覆盖确认')
  assert.equal(reopened.data.automaticLayoutUndoVisible, true, '无确认重排后没有保留撤销')
  reopened.undoAutomaticLayout()
  assert.equal(reopened.data.automaticLayoutUndoVisible, false)

  const firstKey = layoutModel.posKey(reopened._fixtures[0])
  const legacy = {
    rowCount: 3,
    schemeId: 'top',
    preserveUnplaced: false,
    positions: { [firstKey]: { zone: 'top', positionIndex: 0, x: 0.31, y: 0.25 } },
    barCounts: [[4], [0], [0]],
  }
  resetStorage(legacy)
  const oldPage = createPage()
  oldPage.onLoad()
  assert.equal(oldPage._positionSource, 'unknown', '旧存档被错误推断为 automatic')
  assert.match(oldPage.data.positionSourceHint, /历史位置来源不明；3 台位置由系统补齐，建议现场核对/)
  assert.match(oldPage.data.positionProgressText, /位置已布置 4 \/ 4，待布置 0/)

  const invalidPositionLegacy = {
    ...legacy,
    positions: { [firstKey]: { zone: 'top', positionIndex: 0 } },
  }
  resetStorage(invalidPositionLegacy)
  const invalidPositionPage = createPage()
  invalidPositionPage.onLoad()
  assert.equal(invalidPositionPage._positionAutoFilledCount, 4,
    '缺少 x/y 的旧位置被误计为可恢复位置')

  const withMetadata = resolveSavedLayout({ ...legacy, positionSource: 'manual', positionAutoFilledCount: 3 }, oldPage._fixtures, oldPage._groups)
  const withoutMetadata = resolveSavedLayout(legacy, oldPage._fixtures, oldPage._groups)
  assert.deepEqual(withMetadata.positions, withoutMetadata.positions,
    '展示来源元数据影响了既有位置恢复结果')

  oldPage.setPositionSource('manual')
  oldPage.refreshFixturePalette()
  assert.match(oldPage.data.positionSourceHint, /旧记录中 3 台位置由系统补齐/,
    '旧位置自动补齐后改为手动来源，提示没有保留补齐事实')
  oldPage.saveLayout()
  const reopenedLegacy = createPage()
  reopenedLegacy.onLoad()
  assert.equal(reopenedLegacy._positionAutoFilledCount, 3,
    '手动来源存档后丢失了旧位置自动补齐数量')
  assert.match(reopenedLegacy.data.positionSourceHint, /旧记录中 3 台位置由系统补齐/)

  modalOptions = []
  reopenedLegacy.applyAutomaticLayout()
  assert.equal(modalOptions.length, 1, '旧记录有位置时没有显示覆盖确认')
  assert.match(modalOptions[0].content, /4 台灯具/)
}

function testConfiguredAndAutomaticSourcePersistence() {
  resetStorage()
  const configured = createPage()
  configured.onLoad()
  configured.applyBarConfiguration({ type: 'tap' })
  assert.equal(configured._positionSource, 'configured', 'WXML tap event was used as the source')
  assert.equal(storage.get(LAYOUT_KEY).positionSource, 'configured', 'configured 来源没有保存')
  const reopened = createPage()
  reopened.onLoad()
  assert.equal(reopened._positionSource, 'configured', 'configured 来源重进后丢失')

  reopened.onRowChange({ detail: { value: 0 } })
  assert.equal(reopened._positionSource, 'automatic', '灯位方案重平衡没有标为 automatic')
  assert.equal(storage.get(LAYOUT_KEY).positionSource, 'automatic',
    '灯位方案自动重平衡来源没有保存')
}

function testCancelConfirmUndoAndIndependentProgress() {
  const initialPosition = { zone: 'top', positionIndex: 0, x: 0.31, y: 0.25 }
  const legacy = {
    rowCount: 3,
    schemeId: 'top',
    preserveUnplaced: true,
    positions: { '0:1': initialPosition },
    barCounts: [[1], [0], [0]],
    positionSource: 'manual',
  }
  resetStorage(legacy)
  const page = createPage()
  page.onLoad()
  assert.equal(page._positionSource, 'manual')
  const before = {
    positions: clone(page._positions),
    barCounts: clone(page._barCounts),
    preserve: page._preserve,
    source: page._positionSource,
    storage: clone(storage.get(LAYOUT_KEY)),
    writes: storageWriteCount,
  }
  modalResult = { confirm: false }
  page.applyAutomaticLayout()
  assert.equal(modalOptions.length, 1, '手动位置没有显示覆盖确认')
  assert.deepEqual(clone(page._positions), before.positions, '取消覆盖改变了灯具位置')
  assert.deepEqual(page._barCounts, before.barCounts, '取消覆盖改变了杆位配置')
  assert.equal(page._preserve, before.preserve)
  assert.equal(page._positionSource, before.source)
  assert.equal(page.data.automaticLayoutUndoVisible, false)
  assert.deepEqual(storage.get(LAYOUT_KEY), before.storage, '取消覆盖写入了布局')
  assert.equal(storageWriteCount, before.writes, '取消覆盖触发了本地写入')

  modalResult = { confirm: true }
  page.applyAutomaticLayout()
  assert.equal(page._positionSource, 'automatic')
  assert.equal(Object.keys(page._positions).length, page._fixtures.length)
  assert.equal(page.data.automaticLayoutUndoVisible, true, '确认覆盖后没有显示撤销')
  assert.deepEqual(Object.keys(page._automaticLayoutUndoSnapshot).sort(), [
    'barCounts', 'positionAutoFilledCount', 'positionSource', 'positions', 'preserve',
  ], '撤销快照包含了不应回滚的显示状态')
  const automaticPositions = clone(page._positions)
  const placedText = page.data.positionProgressText
  page.selectFixture(page._fixtures[0])
  page.toggleSelectedProgress()
  assert.equal(page.data.positionProgressText, placedText,
    '地址核对进度改变了灯位布置数量')
  const progressKey = page.data.selectedFixture.progressKey
  assert(storage.get(PROGRESS_KEY).keys.includes(progressKey), '地址已设置标记没有独立持久化')

  page.toggleAddressLabels()
  assert.equal(page.data.addressLabelMode, 'smart')
  const secondFixture = page._fixtures[1]
  page.setData({ searchText: secondFixture.addressText })
  page.searchFixture()
  assert.match(page.data.searchResultText, new RegExp(`已定位 ${secondFixture.addressText}`))
  page.generateLayoutImage()
  assert.equal(page.data.layoutImagePath, '/tmp/dmx-position-test.png', '测试图片没有生成')
  assert.equal(page.data.previewVisible, true, '生成图片后没有打开预览')

  page.undoAutomaticLayout()
  assert.deepEqual(clone(page._positions), before.positions, '撤销没有逐项恢复手动位置')
  assert.deepEqual(page._barCounts, before.barCounts, '撤销没有精确恢复杆位计数')
  assert.equal(page._preserve, before.preserve, '撤销没有恢复 preserve 状态')
  assert.equal(page._positionSource, before.source, '撤销没有恢复来源')
  assert.equal(page.data.automaticLayoutUndoVisible, false)
  assert.equal(page._checkedKeys.has(progressKey), true, '撤销回滚了独立地址进度')
  assert(storage.get(PROGRESS_KEY).keys.includes(progressKey), '撤销改写了地址进度存储')
  assert.notDeepEqual(clone(page._positions), automaticPositions)
  assert.equal(page.data.addressLabelMode, 'smart', '撤销回滚了之后切换的地址显示模式')
  assert.equal(page.data.addressLabelsVisible, true, '撤销回滚了之后的地址可见状态')
  assert.equal(page.data.addressLabelModeText, '智能地址', '地址模式按钮文案与当前模式不一致')
  assert.equal(page.data.searchResultText, '', '撤销保留了旧搜索结果')
  assert.equal(page.data.layoutImagePath, '', '撤销保留了旧位置图')
  assert.equal(page.data.previewVisible, false, '撤销后仍显示旧位置图预览')
  assert.equal(page.data.selectedFixture, null,
    '恢复后没有位置的当前选择没有清除')

  page.applyAutomaticLayout()
  page.selectFixture(page._fixtures[0])
  page.undoAutomaticLayout()
  assert.equal(page.data.selectedFixture?.addressText, page._fixtures[0].addressText,
    '恢复后仍有位置的当前选择没有保留')

  page.applyAutomaticLayout()
  page._view = { s: 1.75, x: 12, y: -4 }
  page.setData({ viewZoomed: true, paletteGroupIndex: 0 })
  page._tap = { x: 20, y: 30 }
  page.onCanvasTouchEnd({ changedTouches: [{ clientX: 20, clientY: 30 }] })
  assert.equal(page.data.addressLabelsVisible, false)
  page.undoAutomaticLayout()
  assert.equal(page.data.addressLabelsVisible, false, '撤销回滚了之后隐藏地址的状态')
  assert.equal(page.data.addressLabelModeText, '显示地址', '隐藏地址后的按钮文案不正确')
  assert.equal(page.data.viewZoomed, true, '撤销回滚了之后的缩放状态')
  assert.deepEqual(page._view, { s: 1.75, x: 12, y: -4 }, '撤销重置了之后的缩放视图')
  assert.equal(page.data.paletteGroupIndex, 0, '撤销回滚了当前灯具分组')

  page.applyAutomaticLayout()
  assert.equal(page.data.automaticLayoutUndoVisible, true)
  page.onStageInput({ currentTarget: { dataset: { key: 'stageWidthText' } }, detail: { value: '13' } })
  assert.equal(page.data.automaticLayoutUndoVisible, false, '后续布局编辑没有失效撤销')
  const unchangedAfterInvalidation = clone(page._positions)
  page.undoAutomaticLayout()
  assert.deepEqual(clone(page._positions), unchangedAfterInvalidation, '撤销失效后仍可恢复旧布局')
}

function testLandscapeReturnConfigurationAndUnloadGuard() {
  resetStorage()
  const portrait = createPage()
  portrait.route = 'pages/dmx-layout/dmx-layout'
  portrait.onLoad()
  portrait.openLandscapeLayout()
  const landscape = createPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  landscape.route = 'pages/dmx-layout-landscape/dmx-layout-landscape'
  landscape.onLoad()
  currentPages = [portrait, landscape]
  landscape.openPortraitConfiguration()
  assert.equal(lastNavigation.type, 'navigateBack', '横屏没有返回已有竖屏页')
  assert.equal(portrait._expandBarConfigurationOnLandscapeReturn, true)
  assert.equal(landscape._skipSaveOnUnload, true, '横屏返回没有设置卸载写回保护')
  portrait.onShow()
  assert.equal(portrait.data.barConfigurationExpanded, true, '返回竖屏后没有展开逐杆配置')

  const savedBeforeOldUnload = clone(storage.get(LAYOUT_KEY))
  const newerLayout = clone(savedBeforeOldUnload)
  const positionKey = Object.keys(newerLayout.positions)[0]
  newerLayout.positions[positionKey].x = 0.123
  storage.set(LAYOUT_KEY, newerLayout)
  landscape._positions[positionKey].x = 0.987
  landscape.onHide()
  landscape.onUnload()
  assert.deepEqual(storage.get(LAYOUT_KEY), newerLayout, '旧横屏卸载覆盖了更新后的布局')

  currentPages = []
  const standaloneLandscape = createPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  standaloneLandscape.onLoad()
  standaloneLandscape.openPortraitConfiguration()
  assert.equal(lastNavigation.type, 'redirectTo', '独立横屏入口没有安全切换到竖屏')
  assert.equal(lastNavigation.url, '/pages/dmx-layout/dmx-layout?expandBarConfiguration=1')
  assert.equal(standaloneLandscape._skipSaveOnUnload, true)
  const redirectedPortrait = createPage()
  redirectedPortrait.onLoad({ expandBarConfiguration: '1' })
  redirectedPortrait.onReady()
  assert.equal(redirectedPortrait.data.barConfigurationExpanded, true)
  assert.equal(redirectedPortrait.data.scrollIntoViewTarget, 'dmxBarConfigurationPanel',
    '独立横屏跳转后的竖屏首屏没有滚动到配置面板')
  redirectedPortrait.onUnload()
  assert.equal(portrait.data.scrollIntoViewTarget, 'dmxBarConfigurationPanel',
    '返回竖屏后没有将逐杆配置滚动到视口')
  portrait.onUnload()
}

function testFailedPortraitRedirectRestoresLandscapeSaving() {
  resetStorage()
  const portrait = createPage()
  portrait.route = 'pages/dmx-layout/dmx-layout'
  portrait.onLoad()
  const landscape = createPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  landscape.onLoad()
  currentPages = [portrait, landscape]
  failNavigateBack = true
  failRedirectTo = true
  landscape.openPortraitConfiguration()
  assert.equal(landscape._skipSaveOnUnload, false,
    'navigateBack 和最后一级 redirectTo 都失败后仍跳过横屏写回')
  assert.equal(portrait._awaitingLandscapeReturn, true,
    '导航失败后竖屏没有保留待消费的返回刷新标志')
  assert.equal(portrait._expandBarConfigurationOnLandscapeReturn, false,
    '导航失败后竖屏残留配置展开标志')
  const key = Object.keys(landscape._positions)[0]
  landscape._positions[key].x = 0.432
  landscape.onUnload()
  assert.equal(storage.get(LAYOUT_KEY).positions[key].x, 0.432,
    '导航失败后留在横屏编辑，卸载没有保存最新位置')
  portrait.onShow()
  assert.equal(portrait._positions[key].x, 0.432,
    '横屏导航失败后竖屏 onShow 没有读取横屏最新位置')
  portrait.onUnload()
  assert.equal(storage.get(LAYOUT_KEY).positions[key].x, 0.432,
    '横屏导航失败后竖屏卸载把横屏最新位置回退')

  resetStorage()
  const standalone = createPage('pages/dmx-layout-landscape/dmx-layout-landscape.js')
  standalone.onLoad()
  failRedirectTo = true
  currentPages = []
  standalone.openPortraitConfiguration()
  assert.equal(standalone._skipSaveOnUnload, false,
    '独立横屏最后一级 redirectTo 失败后仍跳过写回')
  const standaloneKey = Object.keys(standalone._positions)[0]
  standalone._positions[standaloneKey].x = 0.678
  standalone.onUnload()
  assert.equal(storage.get(LAYOUT_KEY).positions[standaloneKey].x, 0.678,
    '独立横屏导航失败后卸载没有保存最新位置')
  currentPages = []
}

function testModalCompletionAfterHideIsIgnored() {
  resetStorage({
    rowCount: 3,
    schemeId: 'top',
    positions: { '0:1': { zone: 'top', positionIndex: 0, x: 0.31, y: 0.25 } },
    barCounts: [[1], [0], [0]],
    positionSource: 'manual',
  })
  const page = createPage()
  page.onLoad()
  const beforePositions = clone(page._positions)
  const beforeWrites = storageWriteCount
  deferModalResult = true
  page.applyAutomaticLayout()
  assert(pendingModalResult, '覆盖确认弹窗没有挂起')
  page.onHide()
  pendingModalResult.success({ confirm: true })
  assert.deepEqual(clone(page._positions), beforePositions,
    '页面离开后确认回调仍重排了旧页面')
  assert.equal(storageWriteCount, beforeWrites,
    '页面离开后确认回调仍写入旧页面布局')
  page.onUnload()
  deferModalResult = false
  pendingModalResult = null
}

function testUserFacingCopyAndWorkspaceTabs() {
  const addressWxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
  const addressJs = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.js'), 'utf8')
  const portraitWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxml'), 'utf8')
  const landscapeWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml'), 'utf8')
  const addressWxss = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')

  assert(addressWxml.includes('data-workspace="config"') && addressWxml.includes('data-workspace="plan"'),
    '01 编址配置与 02 地址方案双工作区没有保留')
  assert(addressWxml.includes('result && result.valid') && addressWxml.includes('workspace-ready-mark'),
    '有效方案就绪标记没有绑定到有效结果')
  assert(addressWxss.includes('.workspace-option-active{background:var(--theme-primary-fill)'),
    '双工作区选中态不够明显')
  assert(!addressWxml.includes('查看地址方案') && !addressWxml.includes('class="plan-workspace-note'),
    '配置工作区新增了方案跳转按钮或禁用小字')
  assert(addressWxml.includes('生成地址方案图') && addressWxml.includes('地址方案图已生成'),
    '地址导图入口名称没有明确为地址方案图')
  assert(addressWxml.includes('地址已设置 {{result.selectedUniverse.checkedCount}}')
    && addressWxml.includes('地址已设置 {{result.selectedGroup.checkedCount}}')
    && addressJs.includes('地址已设置标记'), '地址结果进度或清空提示没有限定为地址')
  assert(portraitWxml.includes('{{positionSourceHint}}') && portraitWxml.includes('{{positionProgressText}}')
    && portraitWxml.includes('地址待设置'), '竖屏位置图缺少来源、布置数量或地址状态说明')
  assert(landscapeWxml.includes('{{positionSourceHint}}') && landscapeWxml.includes('{{positionProgressText}}')
    && landscapeWxml.includes('openPortraitConfiguration')
    && landscapeWxml.includes('undoAutomaticLayout'), '横屏位置图缺少来源、布置数量、配置入口或撤销')
  assert(portraitWxml.includes('scroll-into-view="{{scrollIntoViewTarget}}"')
    && portraitWxml.includes('id="dmxBarConfigurationPanel"'), '竖屏配置入口没有可靠的滚动定位目标')
}

testFirstAutomaticLayoutAndLegacySource()
testConfiguredAndAutomaticSourcePersistence()
testCancelConfirmUndoAndIndependentProgress()
testLandscapeReturnConfigurationAndUnloadGuard()
testFailedPortraitRedirectRestoresLandscapeSaving()
testModalCompletionAfterHideIsIgnored()
testUserFacingCopyAndWorkspaceTabs()
console.log('dmx-first-use-experience-test: 7 checks passed')

const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const pageFile = path.join(root, 'pages/dmx-address/dmx-address.js')
const source = fs.readFileSync(pageFile, 'utf8')
const storage = new Map([['audioTool.dmxAddress.preferences', {
  startAddressText: '1', allocationMode: 'auto', groups: [
    { name: '一组', fixtureSource: 'custom', customName: '一组', fixtureCount: '1', channelCount: '8', targetUniverse: 'A' },
    { name: '二组', fixtureSource: 'custom', customName: '二组', fixtureCount: '1', channelCount: '8', targetUniverse: 'A' },
  ],
}]])
const timers = new Map()
let nextTimerId = 1
let pageDefinition = null
let pageHidden = false
let setDataCalls = []

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const wx = {
  getStorageSync: (key) => clone(storage.get(key)),
  setStorageSync: (key, value) => storage.set(key, clone(value)),
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  vibrateShort: () => {},
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
}

function createPage() {
  const page = { ...pageDefinition, data: clone(pageDefinition.data) }
  page.setData = (patch, callback) => {
    setDataCalls.push({ hidden: pageHidden, patch: clone(patch) })
    Object.entries(patch).forEach(([key, value]) => {
      const segments = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      segments.slice(0, -1).forEach((segment) => { target = target[segment] })
      target[segments.at(-1)] = clone(value)
    })
    if (callback) callback()
  }
  return page
}

function fixtureSearchPatches() {
  return setDataCalls.filter(({ patch }) => (
    Object.prototype.hasOwnProperty.call(patch, 'fixtureSearchResults')
    || Object.prototype.hasOwnProperty.call(patch, 'fixtureSearchTotal')
  ))
}

function resetHarness() {
  timers.clear()
  setDataCalls = []
  pageHidden = false
}

function runTimer(id) {
  const timer = timers.get(id)
  assert(timer, `timer ${id} 不存在`)
  timers.delete(id)
  timer.callback()
}

function runAllTimers() {
  while (timers.size) runTimer(timers.keys().next().value)
}

function pageHide(page) {
  pageHidden = true
  page.onHide()
}

function pageShow(page) {
  pageHidden = false
  page.onShow()
}

const fakeSetTimeout = (callback, delay) => {
  const id = nextTimerId++
  timers.set(id, { callback, delay })
  return id
}
const fakeClearTimeout = (id) => timers.delete(id)

const previousWx = global.wx
try {
  global.wx = wx
  const sandbox = {
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, RegExp, Set, String,
    console, structuredClone, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    require: Module.createRequire(pageFile),
    module: { exports: {} }, exports: {}, __filename: pageFile, __dirname: path.dirname(pageFile),
    wx,
    Page: (definition) => { pageDefinition = definition },
  }
  vm.runInNewContext(source, sandbox, { filename: pageFile })
  assert(pageDefinition, 'DMX 地址页面未注册')
  const addressWxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
  assert.match(addressWxml, /bindtap="clearFixtureSearch"/, '搜索清空入口不再绑定 clearFixtureSearch')
  const boundaryObservations = []

  resetHarness()
  const debouncePage = createPage()
  debouncePage.onLoad()
  pageShow(debouncePage)
  debouncePage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  debouncePage.onFixtureSearchInput({ detail: { value: 'SV3103' } })
  assert.strictEqual(timers.size, 1, '可见搜索没有保留单个 debounce timer')
  const debounceTimerId = debouncePage._fixtureSearchTimer
  const debounceDelay = timers.get(debounceTimerId).delay
  assert.strictEqual(debounceDelay, 120, '可见搜索 debounce delay 已改变')
  assert.strictEqual(fixtureSearchPatches().length, 1, '打开选择器的初始结果不应计入搜索 debounce')
  runTimer(debounceTimerId)
  assert.strictEqual(fixtureSearchPatches().length, 2, '可见搜索 debounce 未执行一次')
  assert.deepStrictEqual(debouncePage.data.fixtureSearchResults.map((item) => item.model), ['TL-SV3103'],
    'SV3103 搜索结果不再唯一匹配 TL-SV3103')

  resetHarness()
  const hiddenPage = createPage()
  hiddenPage.onLoad()
  pageShow(hiddenPage)
  hiddenPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  hiddenPage.selectFixtureCategory({ currentTarget: { dataset: { category: '效果灯' } } })
  hiddenPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  hiddenPage.onFixtureSearchInput({ detail: { value: 'SV' } })
  const consecutiveInputTimerCount = timers.size
  assert.strictEqual(consecutiveInputTimerCount, 1, '连续搜索输入没有只保留一个 timer')
  const beforeHideSearchPatches = fixtureSearchPatches().length
  const resultsBeforeHide = JSON.stringify(hiddenPage.data.fixtureSearchResults)
  const pendingSearchCallback = timers.get(hiddenPage._fixtureSearchTimer).callback
  pageHide(hiddenPage)
  assert.strictEqual(timers.size, 0, '隐藏后仍保留 fixture 搜索 timer')
  assert.strictEqual(fixtureSearchPatches().length, beforeHideSearchPatches, '隐藏时立即提交了搜索结果')
  assert.strictEqual(hiddenPage.data.fixtureSearchOpen, true, '隐藏时丢失搜索选择器会话')
  assert.strictEqual(hiddenPage.data.fixtureSearchKeyword, 'SV', '隐藏时清除了最新搜索词')
  assert.strictEqual(hiddenPage.data.fixtureSearchCategory, '效果灯', '隐藏时清除了已选分类')
  assert.strictEqual(JSON.stringify(hiddenPage.data.fixtureSearchResults), resultsBeforeHide, '隐藏期间替换了原搜索结果')
  const hiddenSetDataCount = setDataCalls.length
  hiddenPage.onFixtureSearchInput({ detail: { value: 'late-hidden-input' } })
  hiddenPage.selectFixtureCategory({ currentTarget: { dataset: { category: '舞台特效' } } })
  pendingSearchCallback()
  assert.strictEqual(setDataCalls.length, hiddenSetDataCount, '隐藏页输入、切分类或迟到 debounce 仍触发 setData')
  assert.strictEqual(fixtureSearchPatches().length, beforeHideSearchPatches, '取消的 debounce 在隐藏页迟到回写')
  pageShow(hiddenPage)
  assert.strictEqual(hiddenPage.data.fixtureSearchOpen, true, '返回时没有恢复原搜索选择器')
  assert.strictEqual(hiddenPage.data.fixtureBatchOpen, false, '搜索选择器恢复成了批量选择模式')
  const afterShowSearchPatches = fixtureSearchPatches()
  assert.strictEqual(afterShowSearchPatches.length, beforeHideSearchPatches + 1,
    '重新显示时没有只恢复一次最新搜索')
  assert.strictEqual(hiddenPage.data.fixtureSearchKeyword, 'SV')
  assert(hiddenPage.data.fixtureSearchResults.length > 0, '重新显示后搜索结果为空')
  assert(hiddenPage.data.fixtureSearchResults.every((item) => item.model.includes('SV')),
    '重新显示后未按最新关键词 SV 恢复搜索')
  assert(hiddenPage.data.fixtureSearchResults.every((item) => item.category === '效果灯'),
    '重新显示未按最新分类恢复搜索')
  assert.strictEqual(hiddenPage._fixtureSearchNeedsRefresh, false)
  const showSearchPatchBytes = Buffer.byteLength(JSON.stringify(afterShowSearchPatches.at(-1).patch))
  const hiddenAfterSearchPatches = setDataCalls.filter(({ hidden, patch }) => hidden && (
    Object.prototype.hasOwnProperty.call(patch, 'fixtureSearchResults')
    || Object.prototype.hasOwnProperty.call(patch, 'fixtureSearchTotal')
  ))
  const hiddenAfter = {
    patchCount: hiddenAfterSearchPatches.length,
    payloadBytes: hiddenAfterSearchPatches.reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item.patch)), 0),
  }
  pageShow(hiddenPage)
  assert.strictEqual(fixtureSearchPatches().length, afterShowSearchPatches.length,
    '重复 onShow 错误重复执行搜索恢复')
  assert.strictEqual(hiddenPage.data.fixtureSearchOpen, true, '重复 hide/show 后搜索选择器状态丢失')

  resetHarness()
  const hiddenClearPage = createPage()
  hiddenClearPage.onLoad()
  pageShow(hiddenClearPage)
  hiddenClearPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  hiddenClearPage.onFixtureSearchInput({ detail: { value: 'SV3103' } })
  runTimer(hiddenClearPage._fixtureSearchTimer)
  const hiddenClearKeyword = hiddenClearPage.data.fixtureSearchKeyword
  const hiddenClearResults = JSON.stringify(hiddenClearPage.data.fixtureSearchResults)
  pageHide(hiddenClearPage)
  const hiddenClearWrites = setDataCalls.length
  hiddenClearPage.clearFixtureSearch()
  const hiddenClearWriteDelta = setDataCalls.length - hiddenClearWrites
  assert.strictEqual(setDataCalls.length, hiddenClearWrites, '隐藏页迟到的 WXML 清空事件仍写入 setData')
  assert.strictEqual(hiddenClearPage.data.fixtureSearchKeyword, hiddenClearKeyword, '隐藏页清空事件覆盖了保留关键词')
  assert.strictEqual(JSON.stringify(hiddenClearPage.data.fixtureSearchResults), hiddenClearResults, '隐藏页清空事件覆盖了保留结果')
  pageShow(hiddenClearPage)
  assert.strictEqual(hiddenClearPage.data.fixtureSearchKeyword, 'SV3103', '隐藏页清空事件破坏了恢复关键词')
  assert.deepStrictEqual(hiddenClearPage.data.fixtureSearchResults.map((item) => item.model), ['TL-SV3103'])
  const keywordAfterHiddenResume = hiddenClearPage.data.fixtureSearchKeyword
  hiddenClearPage.clearFixtureSearch()
  assert.strictEqual(hiddenClearPage.data.fixtureSearchKeyword, '', '可见清空没有清除关键词')
  assert(hiddenClearPage.data.fixtureSearchTotal > 1, '可见清空没有恢复完整结果')
  boundaryObservations.push({
    case: 'late hidden clear and visible clear',
    hiddenClearWrites: hiddenClearWriteDelta,
    keywordAfterResume: keywordAfterHiddenResume,
    visibleClearKeyword: hiddenClearPage.data.fixtureSearchKeyword,
    visibleClearResultCount: hiddenClearPage.data.fixtureSearchTotal,
  })

  resetHarness()
  const revisionPage = createPage()
  revisionPage.onLoad()
  pageShow(revisionPage)
  revisionPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  revisionPage.selectFixtureCategory({ currentTarget: { dataset: { category: '效果灯' } } })
  revisionPage.onFixtureSearchInput({ detail: { value: 'SV3103' } })
  pageHide(revisionPage)
  const targetGroupIndex = revisionPage.data.fixtureSearchGroupIndex
  const targetGroupId = revisionPage.data.groups[targetGroupIndex]._lightingGroupId
  const workspaceApi = Module.createRequire(pageFile)('../dmx-layout/lighting-workspace')
  const revisionBefore = workspaceApi.readLightingWorkspace(revisionPage._contextId)
  assert(revisionBefore.ok)
  const revisedScheme = clone(revisionBefore.scheme)
  revisedScheme.preferences.startAddressText = '17'
  revisedScheme.preferences.groups.reverse()
  revisedScheme.groupIds.reverse()
  const revisedCalculation = workspaceApi.calculateScheme(revisedScheme)
  assert(revisedCalculation.ok && revisedCalculation.valid)
  const savedRevision = workspaceApi.saveLightingScheme(revisionPage._contextId, revisedCalculation.scheme, revisionBefore.revision)
  assert(savedRevision.ok, '隐藏时同 context 的合法方案保存失败')
  const revisionSearchPatches = fixtureSearchPatches().length
  pageShow(revisionPage)
  assert.strictEqual(revisionPage.data.fixtureSearchOpen, true, '同 context workspace revision 更新关闭了搜索选择器')
  assert.strictEqual(revisionPage.data.fixtureSearchKeyword, 'SV3103')
  assert.strictEqual(revisionPage.data.fixtureSearchCategory, '效果灯')
  assert.strictEqual(revisionPage._workspaceRevision, savedRevision.revision, '返回时没有载入同 context 最新 revision')
  const restoredTargetIndex = revisionPage.data.groups.findIndex((group) => group._lightingGroupId === targetGroupId)
  assert(restoredTargetIndex >= 0, '同 context 刷新丢失搜索目标灯组 identity')
  assert.notStrictEqual(restoredTargetIndex, targetGroupIndex, '测试未实际改变目标灯组索引')
  assert.strictEqual(revisionPage.data.fixtureSearchGroupIndex, restoredTargetIndex, '搜索目标灯组没有按 identity 恢复')
  assert.deepStrictEqual(revisionPage.data.fixtureSearchResults.map((item) => item.model), ['TL-SV3103'], 'workspace 更新后未只恢复最新搜索结果')
  assert.strictEqual(fixtureSearchPatches().length, revisionSearchPatches + 1, '同 context revision 恢复必须只计算一次最新查询')
  assert.strictEqual(revisionPage._fixtureSearchNeedsRefresh, false)
  boundaryObservations.push({
    case: 'same-context hidden workspace revision refresh',
    contextPreserved: revisionPage._contextId === revisionBefore.contextId,
    revisionFrom: revisionBefore.revision,
    revisionTo: revisionPage._workspaceRevision,
    pickerOpen: revisionPage.data.fixtureSearchOpen,
    keyword: revisionPage.data.fixtureSearchKeyword,
    category: revisionPage.data.fixtureSearchCategory,
    targetGroupIdentityPreserved: revisionPage.data.groups[revisionPage.data.fixtureSearchGroupIndex]?._lightingGroupId === targetGroupId,
    resultModels: revisionPage.data.fixtureSearchResults.map((item) => item.model),
    searchPatchesDuringShow: fixtureSearchPatches().length - revisionSearchPatches,
  })
  pageHide(revisionPage)
  const alternateWorkspace = { ...revisionBefore, contextId: 'explicit-context-change-probe' }
  revisionPage.applyWorkspaceState(alternateWorkspace, 'switchContext')
  assert.strictEqual(revisionPage.data.fixtureSearchOpen, false, '显式 context change 不应保留或重开旧搜索会话')
  assert.strictEqual(revisionPage._fixtureSearchNeedsRefresh, false, '显式 context change 不应留下旧恢复意图')
  pageShow(revisionPage)
  assert.strictEqual(revisionPage.data.fixtureSearchOpen, false, '显式 context change 后 onShow 不应重开旧搜索会话')
  boundaryObservations.push({
    case: 'explicit context change does not reopen old picker',
    contextId: revisionPage._contextId,
    pickerOpen: revisionPage.data.fixtureSearchOpen,
    pendingRefresh: revisionPage._fixtureSearchNeedsRefresh,
  })

  resetHarness()
  const repeatedHidePage = createPage()
  repeatedHidePage.onLoad()
  pageShow(repeatedHidePage)
  repeatedHidePage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  repeatedHidePage.selectFixtureCategory({ currentTarget: { dataset: { category: '效果灯' } } })
  repeatedHidePage.onFixtureSearchInput({ detail: { value: 'SV3103' } })
  pageHide(repeatedHidePage)
  assert.strictEqual(repeatedHidePage._fixtureSearchNeedsRefresh, true, '首次隐藏未保留待刷新意图')
  pageHide(repeatedHidePage)
  assert.strictEqual(repeatedHidePage._fixtureSearchNeedsRefresh, true, '连续第二次隐藏覆盖了待刷新意图')
  pageShow(repeatedHidePage)
  assert.strictEqual(repeatedHidePage.data.fixtureSearchOpen, true)
  assert.strictEqual(repeatedHidePage.data.fixtureSearchKeyword, 'SV3103')
  assert.strictEqual(repeatedHidePage.data.fixtureSearchCategory, '效果灯')
  assert.deepStrictEqual(repeatedHidePage.data.fixtureSearchResults.map((item) => item.model), ['TL-SV3103'])
  const repeatedShowPatches = fixtureSearchPatches().length
  pageHide(repeatedHidePage)
  pageShow(repeatedHidePage)
  assert.strictEqual(repeatedHidePage.data.fixtureSearchKeyword, 'SV3103', '后续无输入 hide/show 丢失当前关键词')
  assert.strictEqual(repeatedHidePage.data.fixtureSearchCategory, '效果灯', '后续无输入 hide/show 丢失当前分类')
  assert.deepStrictEqual(repeatedHidePage.data.fixtureSearchResults.map((item) => item.model), ['TL-SV3103'])
  assert.strictEqual(fixtureSearchPatches().length, repeatedShowPatches + 1, '每次显示应当只按最新查询刷新一次')
  pageHide(repeatedHidePage)
  pageHide(repeatedHidePage)
  pageShow(repeatedHidePage)
  assert.strictEqual(repeatedHidePage.data.fixtureSearchOpen, true)
  assert.deepStrictEqual(repeatedHidePage.data.fixtureSearchResults.map((item) => item.model), ['TL-SV3103'])
  boundaryObservations.push({
    case: 'multiple hide/show cycles with repeated hide',
    hideEvents: 5,
    showCycles: 3,
    pickerOpen: repeatedHidePage.data.fixtureSearchOpen,
    keyword: repeatedHidePage.data.fixtureSearchKeyword,
    category: repeatedHidePage.data.fixtureSearchCategory,
    resultModels: repeatedHidePage.data.fixtureSearchResults.map((item) => item.model),
    pendingRefreshConsumed: repeatedHidePage._fixtureSearchNeedsRefresh === false,
  })

  resetHarness()
  const invalidPage = createPage()
  invalidPage.onLoad()
  pageShow(invalidPage)
  invalidPage._calculationResult.valid = false
  invalidPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  invalidPage.onFixtureSearchInput({ detail: { value: 'SV' } })
  pageHide(invalidPage)
  pageShow(invalidPage)
  assert.strictEqual(fixtureSearchPatches().length, 2,
    '非法编址方案返回时未在 valid 早退前恢复搜索')

  resetHarness()
  const batchPage = createPage()
  batchPage.onLoad()
  pageShow(batchPage)
  batchPage.openBatchFixtureSearch()
  batchPage.toggleBatchFixture({ currentTarget: { dataset: { model: 'TL-SV3103' } } })
  batchPage.onFixtureSearchInput({ detail: { value: 'SV' } })
  pageHide(batchPage)
  pageShow(batchPage)
  assert.strictEqual(batchPage.data.fixtureBatchOpen, true, '返回时没有恢复原批量选择弹层')
  assert.strictEqual(batchPage.data.fixtureSearchOpen, false, '批量弹层恢复成了单选模式')
  assert.strictEqual(batchPage.data.batchSelectedItems[0].model, 'TL-SV3103', '批量选择在隐藏返回后丢失')
  assert(batchPage.data.fixtureSearchResults.some((item) => item.model === 'TL-SV3103' && item.batchSelected),
    '批量选择恢复后结果行未保持选中')
  batchPage.onFixtureSearchInput({ detail: { value: '' } })
  pageHide(batchPage)
  pageShow(batchPage)
  assert.strictEqual(batchPage.data.fixtureBatchOpen, true, '清空关键词返回后批量选择弹层关闭')
  assert.strictEqual(batchPage.data.fixtureSearchKeyword, '', '清空关键词返回后搜索词没有保持为空')
  assert(batchPage.data.fixtureSearchTotal > 1, '清空关键词后没有恢复完整搜索范围')
  assert.strictEqual(batchPage.data.batchSelectedItems[0].model, 'TL-SV3103', '清空关键词后批量选择丢失')

  resetHarness()
  const cancelPage = createPage()
  cancelPage.onLoad()
  pageShow(cancelPage)
  cancelPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  cancelPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  cancelPage.onUserCloseFixturePicker()
  assert.strictEqual(cancelPage.data.fixturePickerClosing, true, '用户关闭搜索选择器没有进入关闭状态')
  pageHide(cancelPage)
  const searchPatchesAfterClose = fixtureSearchPatches().length
  pageShow(cancelPage)
  assert.strictEqual(cancelPage._fixtureSearchNeedsRefresh, false, '关闭弹层后错误保留待刷新标记')
  assert.strictEqual(cancelPage.data.fixtureSearchOpen, false, '隐藏前已显式关闭的搜索选择器被自动重开')
  assert.strictEqual(cancelPage.data.fixtureBatchOpen, false, '隐藏前已显式关闭的批量弹层被自动重开')
  assert.strictEqual(fixtureSearchPatches().length, searchPatchesAfterClose, '关闭弹层后错误恢复旧搜索')

  resetHarness()
  const switchGroupPage = createPage()
  switchGroupPage.onLoad()
  pageShow(switchGroupPage)
  switchGroupPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  switchGroupPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  const oldGroupTimer = switchGroupPage._fixtureSearchTimer
  const oldGroupCallback = timers.get(oldGroupTimer).callback
  pageHide(switchGroupPage)
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, true, '换组前没有记录待刷新意图')
  const hiddenGroupIndex = switchGroupPage.data.fixtureSearchGroupIndex
  const hiddenGroupSearchPatches = fixtureSearchPatches().length
  switchGroupPage.openFixtureSearch({ currentTarget: { dataset: { index: 1 } } })
  assert.strictEqual(switchGroupPage.data.fixtureSearchGroupIndex, hiddenGroupIndex, '隐藏页的迟到型号点击不应切换灯组')
  assert.strictEqual(fixtureSearchPatches().length, hiddenGroupSearchPatches, '隐藏页的迟到型号点击不应提交搜索结果')
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, true, '隐藏时的迟到点击不应改变待恢复搜索')
  oldGroupCallback()
  assert.strictEqual(fixtureSearchPatches().length, hiddenGroupSearchPatches, '已取消的旧搜索 timer 在隐藏后仍回写')
  pageShow(switchGroupPage)
  assert.strictEqual(switchGroupPage.data.fixtureSearchOpen, true, '返回时没有恢复正在搜索的灯组选择器')
  assert.strictEqual(switchGroupPage.data.fixtureSearchGroupIndex, hiddenGroupIndex, '恢复搜索时改变了原灯组索引')
  switchGroupPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  const visibleGroupTimer = switchGroupPage._fixtureSearchTimer
  assert(timers.has(visibleGroupTimer), '可见换组前必须有一个实际待执行的搜索 timer')
  switchGroupPage.openFixtureSearch({ currentTarget: { dataset: { index: 1 } } })
  assert(!timers.has(visibleGroupTimer), '可见换组未取消当前搜索 timer')
  assert.strictEqual(switchGroupPage.data.fixtureSearchGroupIndex, 1, '可见页面应打开指定灯组的型号选择')
  assert(!timers.has(oldGroupTimer), '重开其他组时未清理旧搜索 timer')
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, false, '重开其他组时错误保留待刷新标记')
  pageShow(switchGroupPage)
  switchGroupPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  switchGroupPage.selectFixtureCategory({ currentTarget: { dataset: { category: '舞台特效' } } })
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, false, '切换分类时错误保留待刷新标记')
  assert.strictEqual(timers.size, 0, '即时切换分类没有取消待执行 debounce')
  pageHide(switchGroupPage)
  pageShow(switchGroupPage)
  assert.strictEqual(switchGroupPage.data.fixtureSearchOpen, true, '分类更新后的搜索会话没有恢复')
  assert.strictEqual(switchGroupPage.data.fixtureSearchCategory, '舞台特效', '隐藏返回后分类选择丢失')

  resetHarness()
  const unloadPage = createPage()
  unloadPage.onLoad()
  pageShow(unloadPage)
  unloadPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  unloadPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  const unloadCallback = timers.get(unloadPage._fixtureSearchTimer).callback
  pageHide(unloadPage)
  const unloadSearchPatches = fixtureSearchPatches().length
  unloadPage.onUnload()
  unloadCallback()
  runAllTimers()
  assert.strictEqual(timers.size, 0, '卸载后仍残留搜索 timer')
  assert.strictEqual(unloadPage._fixtureSearchNeedsRefresh, false, '卸载后仍残留搜索恢复标记')
  assert.strictEqual(fixtureSearchPatches().length, unloadSearchPatches, '卸载后迟到 timer 执行搜索回写')

  console.log(JSON.stringify({
    normalDebounceDelay: debounceDelay,
    consecutiveInputTimerCount,
    hiddenAfter,
    showRecoveryPayloadBytes: showSearchPatchBytes,
    cases: 11,
    boundaryObservations,
  }))
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

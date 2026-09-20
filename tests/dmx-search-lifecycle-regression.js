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

  resetHarness()
  const debouncePage = createPage()
  debouncePage.onLoad()
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
  hiddenPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  hiddenPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  hiddenPage.onFixtureSearchInput({ detail: { value: 'SV' } })
  const consecutiveInputTimerCount = timers.size
  assert.strictEqual(consecutiveInputTimerCount, 1, '连续搜索输入没有只保留一个 timer')
  const beforeHideSearchPatches = fixtureSearchPatches().length
  pageHide(hiddenPage)
  assert.strictEqual(timers.size, 0, '隐藏后仍保留 fixture 搜索 timer')
  assert.strictEqual(fixtureSearchPatches().length, beforeHideSearchPatches, '隐藏时立即提交了搜索结果')
  hiddenPage.data.fixtureSearchCategory = '效果灯'
  pageShow(hiddenPage)
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

  resetHarness()
  const invalidPage = createPage()
  invalidPage.onLoad()
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
  batchPage.openBatchFixtureSearch()
  batchPage.toggleBatchFixture({ currentTarget: { dataset: { model: 'TL-SV3103' } } })
  batchPage.onFixtureSearchInput({ detail: { value: 'SV' } })
  pageHide(batchPage)
  pageShow(batchPage)
  assert.strictEqual(batchPage.data.batchSelectedItems[0].model, 'TL-SV3103', '批量选择在隐藏返回后丢失')
  assert(batchPage.data.fixtureSearchResults.some((item) => item.model === 'TL-SV3103' && item.batchSelected),
    '批量选择恢复后结果行未保持选中')
  batchPage.onFixtureSearchInput({ detail: { value: '' } })
  pageHide(batchPage)
  pageShow(batchPage)
  assert(batchPage.data.fixtureSearchTotal > 1, '清空关键词后没有恢复完整搜索范围')
  assert.strictEqual(batchPage.data.batchSelectedItems[0].model, 'TL-SV3103', '清空关键词后批量选择丢失')

  resetHarness()
  const cancelPage = createPage()
  cancelPage.onLoad()
  cancelPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  cancelPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  pageHide(cancelPage)
  const searchPatchesBeforeClose = fixtureSearchPatches().length
  cancelPage.closeFixturePicker()
  const searchPatchesAfterClose = fixtureSearchPatches().length
  pageShow(cancelPage)
  assert.strictEqual(cancelPage._fixtureSearchNeedsRefresh, false, '关闭弹层后错误保留待刷新标记')
  assert(searchPatchesAfterClose >= searchPatchesBeforeClose, '关闭弹层未清理搜索状态')
  assert.strictEqual(fixtureSearchPatches().length, searchPatchesAfterClose, '关闭弹层后错误恢复旧搜索')

  resetHarness()
  const switchGroupPage = createPage()
  switchGroupPage.onLoad()
  switchGroupPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  switchGroupPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  const oldGroupTimer = switchGroupPage._fixtureSearchTimer
  pageHide(switchGroupPage)
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, true, '换组前没有记录待刷新意图')
  switchGroupPage.openFixtureSearch({ currentTarget: { dataset: { index: 1 } } })
  assert(!timers.has(oldGroupTimer), '重开其他组时未清理旧搜索 timer')
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, false, '重开其他组时错误保留待刷新标记')
  pageShow(switchGroupPage)

  switchGroupPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  pageHide(switchGroupPage)
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, true, '换分类前没有记录待刷新意图')
  switchGroupPage.selectFixtureCategory({ currentTarget: { dataset: { category: '舞台特效' } } })
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, false, '切换分类时错误保留待刷新标记')
  pageShow(switchGroupPage)
  switchGroupPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  pageHide(switchGroupPage)
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, true, '选灯具前没有记录待刷新意图')
  switchGroupPage.selectFixture({ currentTarget: { dataset: { model: 'TL-SV3103' } } })
  assert.strictEqual(switchGroupPage._fixtureSearchNeedsRefresh, false, '选择灯具后错误保留待刷新标记')
  pageShow(switchGroupPage)
  assert.strictEqual(switchGroupPage.data.fixtureSearchOpen, false, '选择灯具后搜索弹层未关闭')

  resetHarness()
  const unloadPage = createPage()
  unloadPage.onLoad()
  unloadPage.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
  unloadPage.onFixtureSearchInput({ detail: { value: 'TL' } })
  pageHide(unloadPage)
  const unloadSearchPatches = fixtureSearchPatches().length
  unloadPage.onUnload()
  runAllTimers()
  assert.strictEqual(timers.size, 0, '卸载后仍残留搜索 timer')
  assert.strictEqual(unloadPage._fixtureSearchNeedsRefresh, false, '卸载后仍残留搜索恢复标记')
  assert.strictEqual(fixtureSearchPatches().length, unloadSearchPatches, '卸载后迟到 timer 执行搜索回写')

  console.log(JSON.stringify({
    normalDebounceDelay: debounceDelay,
    consecutiveInputTimerCount,
    hiddenAfter,
    showRecoveryPayloadBytes: showSearchPatchBytes,
    cases: 7,
  }))
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

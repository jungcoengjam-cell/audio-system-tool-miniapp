'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const pageFile = path.join(root, 'pages/dmx-address/dmx-address.js')
const source = fs.readFileSync(pageFile, 'utf8')
const timers = new Map()
let nextTimerId = 1
let pageDefinition = null
let writes = 0

const fakeSetTimeout = (callback, delay) => {
  const id = nextTimerId++
  timers.set(id, { callback, delay })
  return id
}
const fakeClearTimeout = (id) => timers.delete(id)
const wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => { writes += 1 },
  showToast: () => {},
  vibrateShort: () => {},
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
}

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

  function makePage() {
    const page = { ...pageDefinition, data: structuredClone(pageDefinition.data) }
    page._pageAlive = true
    page._pageVisible = true
    page._fixtureSearchTimer = null
    page._fixtureSearchToken = 0
    page._fixtureSearchNeedsRefresh = false
    page._nextGroupId = 1
    page._contextId = 'temporary'
    page._suppressFloatingOpenUntil = 0
    page._sheetCloseTimers = Object.create(null)
    page._sheetCloseTokens = Object.create(null)
    page.setData = (patch, callback) => {
      Object.entries(patch).forEach(([key, value]) => {
        const segments = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = page.data
        segments.slice(0, -1).forEach((segment) => { target = target[segment] })
        target[segments.at(-1)] = value
      })
      if (callback) callback()
    }
    page.buildSchemeFromState = (state) => ({ groups: state.groups })
    page.buildPendingPreview = (candidate, descriptor) => {
      page._crossBoundaryPreview = { candidate, descriptor }
    }
    return page
  }

  const page = makePage()
  page.addGroup()
  assert.equal(page.data.fixtureSearchOpen, true)
  page.onFixtureSearchInput({ detail: { value: 'SV3103' } })
  const staleSearchTimerId = page._fixtureSearchTimer
  const staleSearchCallback = timers.get(staleSearchTimerId)?.callback
  assert(staleSearchCallback, 'search input should schedule the injected page timer')
  assert.equal(timers.get(staleSearchTimerId).delay, 120)

  page.selectFixtureCategory({ currentTarget: { dataset: { category: '效果灯' } } })
  const categoryResults = structuredClone(page.data.fixtureSearchResults)
  assert(categoryResults.some((item) => item.model === 'TL-SV3103'))
  staleSearchCallback()
  assert.equal(JSON.stringify(page.data.fixtureSearchResults), JSON.stringify(categoryResults), 'cancelled search callback must not replace category results')

  page.onFixtureSearchInput({ detail: { value: 'not-a-model' } })
  const selectionTimerId = page._fixtureSearchTimer
  const selectionCallback = timers.get(selectionTimerId)?.callback
  assert(selectionCallback, 'second input should schedule one pending timer')
  const writesBeforeSelect = writes
  page.selectFixture({ currentTarget: { dataset: { model: 'TL-SV3103' } } })
  assert.equal(writes, writesBeforeSelect, 'selection preview must not persist before confirmation')
  assert.equal(page.data.fixtureSearchOpen, false)
  assert.equal(page.data.pendingChange, null, 'the real pending flow remains delegated to buildPendingPreview')
  assert.equal(page._crossBoundaryPreview?.descriptor.kind, 'add')
  assert.equal(page._crossBoundaryPreview?.descriptor.fixtureModel, 'TL-SV3103')
  assert.equal(page._crossBoundaryPreview?.candidate.groups.length, 1)
  const closedSearchResults = structuredClone(page.data.fixtureSearchResults)
  const writesBeforeLateSearch = writes
  selectionCallback()
  assert.equal(JSON.stringify(page.data.fixtureSearchResults), JSON.stringify(closedSearchResults), 'selection must invalidate its prior search timer')
  assert.equal(writes, writesBeforeLateSearch, 'selection preview must not persist before confirmation')

  const reopened = makePage()
  reopened.addGroup()
  reopened.onUserCloseFixturePicker()
  assert.equal(reopened.data.fixturePickerClosing, true)
  const closeTimerId = reopened._sheetCloseTimers.fixturePicker
  const staleCloseCallback = timers.get(closeTimerId)?.callback
  assert(staleCloseCallback, 'user close should schedule the shared modal-close timer')
  reopened.addGroup()
  assert.equal(reopened.data.fixtureSearchOpen, true)
  assert.equal(reopened.data.fixturePickerClosing, false)
  staleCloseCallback()
  assert.equal(reopened.data.fixtureSearchOpen, true, 'old close callback must not close a reopened picker')
  assert.equal(reopened.data.fixturePickerClosing, false)
  console.log('DMX picker cross-boundary regression passed')
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

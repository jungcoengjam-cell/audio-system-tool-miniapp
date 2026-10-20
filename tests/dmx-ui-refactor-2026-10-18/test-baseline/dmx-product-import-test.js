const assert = require('node:assert/strict')

const previousPage = global.Page
const previousWx = global.wx
const storage = new Map()
const writes = []
const routes = []
const toasts = []
let failRead = false
let failWrite = false
let page

global.Page = (definition) => { page = definition }
global.wx = {
  getStorageSync(key) {
    if (key === 'audioTool.dmxAddress.preferences' && failRead) throw new Error('read failed')
    return storage.has(key) ? storage.get(key) : ''
  },
  setStorageSync(key, value) {
    if (key === 'audioTool.dmxAddress.preferences' && failWrite) throw new Error('write failed')
    writes.push(key)
    storage.set(key, value)
  },
  setNavigationBarTitle() {},
  navigateTo(options) { routes.push(options.url) },
  showToast(options) { toasts.push(options.title) },
}

const products = require('../utils/products')
const { dmxFixtures } = require('../data/stage-lighting')
const {
  DMX_PREFERENCES_KEY,
  buildDmxProductImport,
} = require('../utils/dmx-product-import')
const multiModeFixture = dmxFixtures.find((fixture) => fixture.channelModes.length > 1)
const product = products.getProductDetail('lighting', multiModeFixture.model)
const detailPath = require.resolve('../pages/products/detail')
delete require.cache[detailPath]
require('../pages/products/detail')
page.data = { ...page.data }
page.setData = (patch) => { page.data = { ...page.data, ...patch } }

function reset(productDetail = product) {
  page.data = {
    product: null,
    dmxImportVisible: false,
    dmxImportModes: [],
    dmxImportChannelCount: '',
    dmxImportFixtureCount: '1',
    dmxImportHasGroups: false,
    dmxImportExistingGroupCount: 0,
    dmxImportGroupsReadable: true,
    dmxImportAction: '',
    dmxImportError: '',
    dmxImportSubmitting: false,
    dmxImportAllocationHint: '',
  }
  page._productDetail = productDetail
  page._dmxImportSubmitting = false
  page._dmxImportOpenedSignature = ''
  writes.length = 0
  routes.length = 0
  toasts.length = 0
  failRead = false
  failWrite = false
}

function openPanel() {
  page.openCalculator({ currentTarget: { dataset: { module: 'dmxAddress' } } })
  assert.equal(page.data.dmxImportVisible, true)
}

function selectMode(value) {
  page.selectDmxImportMode({ currentTarget: { dataset: { channelCount: String(value) } } })
}

function selectAction(value) {
  page.selectDmxImportAction({ currentTarget: { dataset: { action: value } } })
}

const originalGroup = {
  id: 'group-1',
  name: '既有灯具组',
  fixtureSource: 'custom',
  fixtureModel: '',
  customName: '既有灯具组',
  customChannelCount: '8',
  channelCount: '8',
  fixtureCount: '2',
  targetUniverse: 'B',
}
const originalPreferences = {
  startAddressText: '25',
  allocationMode: 'manual',
  groups: [originalGroup],
  unrelatedPreference: 'keep-me',
}

try {
  storage.set(DMX_PREFERENCES_KEY, JSON.parse(JSON.stringify(originalPreferences)))
  reset()
  openPanel()
  assert.equal(page.data.dmxImportChannelCount, '', 'mode requires explicit selection')
  assert.deepEqual(page.data.dmxImportModes.map((mode) => mode.channelCount), multiModeFixture.channelModes)
  assert.equal(writes.length, 0, 'opening the import panel does not write')
  selectMode(multiModeFixture.channelModes[1])
  page.onDmxImportFixtureCountInput({ detail: { value: '3' } })
  selectAction('append')
  page.confirmDmxProductImport()
  page.confirmDmxProductImport()
  let saved = storage.get(DMX_PREFERENCES_KEY)
  assert.equal(writes.length, 1, 'duplicate confirm does not write twice')
  assert.equal(routes.length, 1)
  assert.equal(routes[0], '/pages/dmx-address/dmx-address')
  assert.deepEqual(saved.groups[0], originalGroup, 'append preserves every prior group field')
  assert.equal(saved.groups[1].fixtureModel, multiModeFixture.model)
  assert.equal(saved.groups[1].channelCount, String(multiModeFixture.channelModes[1]))
  assert.equal(saved.groups[1].fixtureCount, '3')
  assert.equal(saved.groups[1].targetUniverse, 'B', 'manual append follows the final group domain')
  assert.notEqual(saved.groups[1].id, saved.groups[0].id)
  assert.equal(saved.startAddressText, originalPreferences.startAddressText)
  assert.equal(saved.allocationMode, originalPreferences.allocationMode)
  assert.equal(saved.unrelatedPreference, originalPreferences.unrelatedPreference)

  reset()
  openPanel()
  selectMode(multiModeFixture.channelModes[0])
  selectAction('append')
  page.confirmDmxProductImport()
  saved = storage.get(DMX_PREFERENCES_KEY)
  assert.equal(saved.groups.length, 3, 'same-model import appends again')
  assert.equal(new Set(saved.groups.map((group) => group.id)).size, 3, 'appended group ids remain unique')

  reset()
  storage.set(DMX_PREFERENCES_KEY, JSON.parse(JSON.stringify(originalPreferences)))
  openPanel()
  selectMode(multiModeFixture.channelModes[0])
  page.onDmxImportFixtureCountInput({ detail: { value: '4' } })
  selectAction('replace')
  page.confirmDmxProductImport()
  saved = storage.get(DMX_PREFERENCES_KEY)
  assert.equal(saved.groups.length, 1)
  assert.equal(saved.groups[0].fixtureCount, '4')
  assert.equal(saved.startAddressText, originalPreferences.startAddressText)
  assert.equal(saved.allocationMode, originalPreferences.allocationMode)
  assert.equal(saved.unrelatedPreference, originalPreferences.unrelatedPreference)

  reset()
  storage.set(DMX_PREFERENCES_KEY, JSON.parse(JSON.stringify(originalPreferences)))
  const beforeCancel = JSON.stringify(storage.get(DMX_PREFERENCES_KEY))
  openPanel()
  page.closeDmxProductImport()
  assert.equal(writes.length, 0, 'cancel performs no write')
  assert.equal(JSON.stringify(storage.get(DMX_PREFERENCES_KEY)), beforeCancel)

  const singleModeProduct = { ...product, model: 'TEST-SINGLE-MODE', name: '单模式测试灯', channelModes: [8] }
  storage.set(DMX_PREFERENCES_KEY, { startAddressText: '1', allocationMode: 'auto' })
  reset(singleModeProduct)
  openPanel()
  assert.equal(page.data.dmxImportChannelCount, '')
  assert.equal(page.data.dmxImportModes.length, 1)
  assert.equal(page.data.dmxImportModes[0].channelCount, 8)
  selectMode(8)
  page.confirmDmxProductImport()
  assert.equal(writes.length, 1, 'single-mode fixture still requires an explicit tap')

  for (const invalidCount of ['', '0', '201', '1.5', '1e2', '-1']) {
    reset()
    openPanel()
    selectMode(multiModeFixture.channelModes[0])
    page.onDmxImportFixtureCountInput({ detail: { value: invalidCount } })
    selectAction('replace')
    page.confirmDmxProductImport()
    assert.equal(writes.length, 0, `invalid quantity ${invalidCount || '(empty)'} is rejected`)
    assert.equal(page.data.dmxImportVisible, true)
    assert.equal(page.data.dmxImportFixtureCount, invalidCount)
    assert.match(page.data.dmxImportError, /1–200/)
  }

  reset()
  storage.set(DMX_PREFERENCES_KEY, JSON.parse(JSON.stringify(originalPreferences)))
  openPanel()
  page.onDmxImportFixtureCountInput({ detail: { value: '2' } })
  selectAction('append')
  page.confirmDmxProductImport()
  assert.equal(writes.length, 0, 'missing mode is rejected')
  assert.match(page.data.dmxImportError, /选择一个有效的厂家通道模式/)

  reset()
  storage.set(DMX_PREFERENCES_KEY, JSON.parse(JSON.stringify(originalPreferences)))
  openPanel()
  selectMode(multiModeFixture.channelModes[0])
  selectAction('replace')
  storage.set(DMX_PREFERENCES_KEY, { ...originalPreferences, startAddressText: '26' })
  page.confirmDmxProductImport()
  assert.equal(writes.length, 0, 'stale panel cannot replace a changed draft')
  assert.equal(page.data.dmxImportVisible, true)
  assert.match(page.data.dmxImportError, /草稿在面板打开后已变化/)

  reset()
  storage.set(DMX_PREFERENCES_KEY, JSON.parse(JSON.stringify(originalPreferences)))
  openPanel()
  selectMode(multiModeFixture.channelModes[0])
  selectAction('replace')
  failRead = true
  page.confirmDmxProductImport()
  assert.equal(writes.length, 0, 'read failure blocks all writes')
  assert.equal(page.data.dmxImportVisible, true)
  assert.equal(page.data.dmxImportChannelCount, String(multiModeFixture.channelModes[0]))
  assert.equal(page.data.dmxImportAction, 'replace')
  assert.match(page.data.dmxImportError, /读取 DMX 设置失败/)

  reset()
  storage.set(DMX_PREFERENCES_KEY, JSON.parse(JSON.stringify(originalPreferences)))
  openPanel()
  selectMode(multiModeFixture.channelModes[0])
  page.onDmxImportFixtureCountInput({ detail: { value: '5' } })
  selectAction('append')
  failWrite = true
  page.confirmDmxProductImport()
  assert.equal(writes.length, 0)
  assert.equal(routes.length, 0)
  assert.equal(page.data.dmxImportVisible, true, 'write failure keeps the panel open')
  assert.equal(page.data.dmxImportChannelCount, String(multiModeFixture.channelModes[0]))
  assert.equal(page.data.dmxImportFixtureCount, '5')
  assert.equal(page.data.dmxImportAction, 'append')
  assert.match(page.data.dmxImportError, /保存失败/)

  const basePreferences = {
    startAddressText: '1',
    allocationMode: 'auto',
    groups: Array.from({ length: 20 }, (_, index) => ({
      name: `组${index + 1}`, channelCount: '1', fixtureCount: '1', targetUniverse: 'A',
    })),
  }
  const overGroupLimit = buildDmxProductImport({
    preferences: basePreferences,
    product,
    channelCountText: String(multiModeFixture.channelModes[0]),
    fixtureCountText: '1',
    action: 'append',
  })
  assert.equal(overGroupLimit.ok, false)
  assert.match(overGroupLimit.error, /最多保留 20 个/)
  const recoverByReplace = buildDmxProductImport({
    preferences: basePreferences,
    product,
    channelCountText: String(multiModeFixture.channelModes[0]),
    fixtureCountText: '1',
    action: 'replace',
  })
  assert.equal(recoverByReplace.ok, true, 'explicit replace can recover an over-limit draft')
  assert.equal(recoverByReplace.preferences.groups.length, 1)

  const tooManyFixtures = buildDmxProductImport({
    preferences: {
      startAddressText: '1',
      allocationMode: 'auto',
      groups: Array.from({ length: 3 }, (_, index) => ({
        name: `大组${index + 1}`, channelCount: '1', fixtureCount: '200', targetUniverse: 'A',
      })),
    },
    product,
    channelCountText: String(multiModeFixture.channelModes[0]),
    fixtureCountText: '1',
    action: 'append',
  })
  assert.equal(tooManyFixtures.ok, false)
  assert.match(tooManyFixtures.error, /最多支持 500 台/)

  const noSpace = buildDmxProductImport({
    preferences: {
      startAddressText: '1',
      allocationMode: 'manual',
      groups: [{ name: '满域', channelCount: '512', fixtureCount: '1', targetUniverse: 'A' }],
    },
    product,
    channelCountText: String(multiModeFixture.channelModes[0]),
    fixtureCountText: '1',
    action: 'append',
  })
  assert.equal(noSpace.ok, false, 'existing DMX allocator rejects an unencodable append')

  console.log('dmx-product-import-test: ok')
} finally {
  delete require.cache[detailPath]
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}

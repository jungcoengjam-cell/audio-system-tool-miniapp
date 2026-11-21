'use strict'

const assert = require('node:assert/strict')

const aliasIndexPath = require.resolve('../data/model-alias-search-index')
const { findModelAliasMatches, formatModelAliasMatches } = require('../utils/model-alias-search')
assert.deepEqual(findModelAliasMatches('TC-22000', ''), [])
assert.equal(require.cache[aliasIndexPath], undefined, 'empty search must not load the packed index')

const { buildCatalogCategories, buildCatalogOptions, filterCatalogItems } = require('../utils/catalog-selector')
const emptyOption = { index: 0, model: 'TC-22000', category: 'TC系列' }
assert.equal(filterCatalogItems([emptyOption], [{ label: '全部' }], '', 0)[0], emptyOption)
assert.equal(require.cache[aliasIndexPath], undefined, 'empty catalog filtering must not load the packed index')

const source = require('../pages/products/data/model-cross-reference')
const packedRows = require('../data/model-alias-search-index')
const { buildPackedIndex } = require('./generate-model-alias-search-index.cjs')
const expected = new Map()
const isSearchable = (value) => value !== null && value !== undefined
  && String(value).trim() !== '' && String(value).trim() !== '/'
function addValue(model, value) {
  if (!isSearchable(value)) return
  const aliases = expected.get(model) || []
  const alias = String(value)
  if (!aliases.includes(alias)) aliases.push(alias)
  expected.set(model, aliases)
}
Object.entries(source.records || {}).forEach(([model, references]) => {
  expected.set(model, expected.get(model) || [])
  ;(Array.isArray(references) ? references : []).forEach((reference) => {
    ;(Array.isArray(reference.values) ? reference.values : []).forEach((pair) => {
      ;(Array.isArray(pair) ? pair : []).forEach((value) => addValue(model, value))
    })
  })
})
Object.entries(source.historical || {}).forEach(([model, references]) => {
  expected.set(model, expected.get(model) || [])
  ;(Array.isArray(references) ? references : []).forEach((reference) => addValue(model, reference.targetModel))
})
const expectedRows = [...expected].map(([model, aliases]) => (
  [model, ...aliases.filter((alias) => alias !== model)].join('|')
)).join('\n')
assert.equal(packedRows, expectedRows, 'packed rows must match every source model value and historical target')
for (const separator of ['|', '\r', '\n']) {
  assert.throws(() => buildPackedIndex({ records: { ['BAD' + separator + 'MODEL']: [] } }), /原型号.*保留分隔符/,
    'canonical models containing an index separator must be rejected')
  assert.throws(() => buildPackedIndex({ records: {
    MODEL: [{ values: [['MODEL', 'BAD' + separator + 'ALIAS']] }],
  } }), /对照型号.*保留分隔符/,
  'aliases containing an index separator must be rejected')
}

assert.deepEqual(findModelAliasMatches('TC-22000', 'AK-2C2000'), ['AK-2C2000'])
assert.deepEqual(findModelAliasMatches('TC-22000', 'ak-2c2000'), ['AK-2C2000'], 'case-insensitive search')
assert(findModelAliasMatches('TC-22000', '2C20').includes('AK-2C2000'), 'partial model search')
assert.deepEqual(findModelAliasMatches('KT-B10A', 'KT-B10'), ['KT-B10'], 'historical model target')
assert.deepEqual(findModelAliasMatches('KT-P21000', 'KP-K21000AK'), [], 'aliases must not be joined across field boundaries')
assert(!packedRows.includes('600W追光灯'), 'descriptive text must not enter the model index')
assert(!packedRows.includes('金业诚兴'), 'brand labels must not enter the model index')
const shortMatches = findModelAliasMatches('TC-22000', '2')
assert(shortMatches.length > 2, 'short query should retain all matches for filtering')
assert.equal(formatModelAliasMatches(shortMatches), shortMatches.slice(0, 2).join(' · ') + ' 等' + shortMatches.length + '项',
  'row hints must display at most two aliases without truncating search matches')

const { amplifiers, speakers } = require('../data/equipment')
const amplifierOptions = buildCatalogOptions(amplifiers)
const amplifierCategories = buildCatalogCategories(amplifierOptions)
const amplifierMatches = filterCatalogItems(amplifierOptions, amplifierCategories, 'AK-2C2000', 0)
const amplifierHit = amplifierMatches.find((item) => item.model === 'TC-22000')
assert(amplifierHit, 'gain/limiter amplifier catalog must find the source model')
assert.equal(amplifierOptions[amplifierHit.index].model, 'TC-22000', 'alias result must retain its real option index')
assert(!Object.hasOwn(amplifierOptions[amplifierHit.index], 'aliasMatch'), 'base catalog options remain unmodified')
const otherAmplifierCategory = amplifierCategories.findIndex((item) => item.label !== '全部' && item.label !== amplifierHit.category)
assert(otherAmplifierCategory > 0)
assert(!filterCatalogItems(amplifierOptions, amplifierCategories, 'AK-2C2000', otherAmplifierCategory)
  .some((item) => item.model === 'TC-22000'), 'category filtering must remain in force')

const limiterSpeakers = speakers.filter((item) => !item.calculationDisabled)
const splSpeakers = limiterSpeakers.filter((item) => Number.isFinite(item.sensitivityDb))
const limiterOptions = buildCatalogOptions(limiterSpeakers)
const splOptions = buildCatalogOptions(splSpeakers)
const limiterHit = filterCatalogItems(limiterOptions, buildCatalogCategories(limiterOptions), 'AK-6566D', 0)
  .find((item) => item.model === 'KA-2100H')
const splHit = filterCatalogItems(splOptions, buildCatalogCategories(splOptions), 'AK-6566D', 0)
  .find((item) => item.model === 'KA-2100H')
assert(limiterHit && splHit, 'limiter and SPL speaker catalogs must find eligible speaker aliases')
assert.equal(limiterSpeakers[limiterHit.index].model, 'KA-2100H')
assert.equal(splSpeakers[splHit.index].sensitivityDb, splSpeakers.find((item) => item.model === 'KA-2100H').sensitivityDb,
  'SPL keeps the source sensitivity parameter')

const { dmxFixtures, stageLightingProductIndex } = require('../data/stage-lighting')
const { createFixtureCatalog } = require('../pages/dmx-address/fixture-catalog')
const fixtureCatalog = createFixtureCatalog(dmxFixtures, {
  getFixtureDisplayName: (fixture) => fixture.name,
  getFixtureSpriteIndex: () => 0,
})
const dmxMatches = fixtureCatalog.searchFixtures('EA-TU9646')
assert.deepEqual(dmxMatches.rows.map((item) => item.model).sort(), ['TL-SK9202', 'TL-SK9204'])
dmxMatches.rows.forEach((row) => {
  const fixture = stageLightingProductIndex.get(row.model)
  assert(fixture, 'search must return an existing addressable fixture')
  assert.equal(row.modeText, '13 CH / 17 CH')
  assert.equal(fixture.channelModes.join(','), '13,17', 'selected models keep original channel data')
})
const customOnly = fixtureCatalog.searchFixtures('model-not-in-index')
assert.equal(customOnly.total, 0, 'unknown custom models must not be added to the catalog')

const { createLayoutLocateMethods } = require('../pages/dmx-layout/layout-interactions')
const sortFixtures = (left, right) => left.addressText.localeCompare(right.addressText)
const locateMethods = createLayoutLocateMethods({
  LOCATE_RESULT_ROW_HEIGHT: 74,
  classifyFixtureVisualType: () => 'profile',
  fixtureSort: sortFixtures,
  rodName: () => '',
})
const locatePage = Object.assign({}, locateMethods, {
  data: { searchText: 'EA-TU9646' },
  _fixtures: dmxMatches.rows.map((row, index) => ({
    stableId: 'fixture-' + index,
    addressText: 'A00' + (index + 1),
    groupName: '组 ' + (index + 1),
    fixtureModel: row.model,
    name: row.name,
    channelCount: 13,
  })).concat([{ stableId: 'custom', addressText: 'A003', groupName: '自定义组', fixtureModel: 'CUSTOM-9', name: '自定义灯具' }]),
  _layout: { positionsById: {} },
  setData(changes) { Object.assign(this.data, changes) },
})
locatePage.searchFixture()
assert.deepEqual(locatePage.data.searchResults.map((item) => item.fixtureModel).sort(), ['TL-SK9202', 'TL-SK9204'])
assert(locatePage.data.searchResults.every((item) => !Object.hasOwn(item, 'aliasMatch')),
  'layout search keeps the existing result shape')
locatePage.data.searchText = 'CUSTOM-9'
locatePage.searchFixture()
assert.deepEqual(locatePage.data.searchResults.map((item) => item.fixtureModel), ['CUSTOM-9'],
  'direct custom-model search remains available without alias expansion')

console.log('产品对照型号搜索索引与目录回归通过')

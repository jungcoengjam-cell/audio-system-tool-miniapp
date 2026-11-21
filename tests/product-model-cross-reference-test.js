const assert = require('node:assert/strict')

const catalogTypes = ['amplifier', 'speaker', 'camera', 'lighting']
const crossReference = require('../pages/products/data/model-cross-reference')
const {
  getProductModelCrossReferenceSourceText,
  getProductModelCrossReferences,
  searchProductModelCrossReferences,
} = require('../pages/products/utils/model-cross-reference')
const {
  ALL_CATEGORY,
  filterProducts,
  getProduct,
  getProductFilters,
  getProductList,
} = require('../pages/products/utils/products')

const { columnGroups, records, historical } = crossReference
const modelsByType = Object.fromEntries(catalogTypes.map((type) => [type, getProductList(type)]))
const typeByModel = new Map()

catalogTypes.forEach((type) => {
  modelsByType[type].forEach((product) => {
    assert(!typeByModel.has(product.model), '现库型号必须唯一：' + product.model)
    typeByModel.set(product.model, type)
  })
})

const recordModels = Object.keys(records)
assert.equal(recordModels.length, 358, '应收录 323 个方案参数命中及 35 个停产补充型号')

const schemeModels = recordModels.filter((model) => (
  records[model].some((reference) => reference.sheet === '方案参数')
))
const discontinuedModels = recordModels.filter((model) => (
  records[model].some((reference) => reference.sheet === '停产')
))
assert.equal(schemeModels.length, 323, '方案参数精确型号覆盖数')
assert.equal(discontinuedModels.length, 35, '停产型号补充覆盖数')
recordModels.forEach((model) => {
  assert(typeByModel.has(model), '不得导入现库外型号：' + model)
  records[model].forEach((reference) => {
    assert(Number.isInteger(reference.row) && reference.row > 0, '缺少来源行号：' + model)
    const definitions = columnGroups[reference.sheet]
    assert(Array.isArray(definitions), '缺少来源字段定义：' + reference.sheet)
    assert.equal(reference.values.length, definitions.length, '来源值组数不匹配：' + model + '/' + reference.sheet)
  })
  const sourceRows = records[model].map((reference) => reference.sheet + '\u0000' + reference.row)
  assert.equal(new Set(sourceRows).size, sourceRows.length, '同一型号来源表/行不得重复：' + model)
})

const historyOnlyModels = Object.keys(historical).filter((model) => !records[model]).sort()
assert.deepEqual(historyOnlyModels, ['KT-B10A', 'TS-606A', 'TS-6152'])
typeByModel.forEach((type, model) => {
  assert(records[model] || historical[model], '现库型号缺少来源关系：' + type + '/' + model)
})

const lightingOldModelEntries = Object.entries(historical).flatMap(([model, entries]) => (
  entries.filter((entry) => entry.kind === '旧型号').map((entry) => ({ model, entry }))
))
assert.equal(lightingOldModelEntries.length, 34, '只收录 34 条灯光旧型号记录')
assert(!lightingOldModelEntries.some(({ entry }) => entry.targetModel === '600W追光灯'),
  '旧型号栏中的名称不得作为型号或搜索别名')
lightingOldModelEntries.forEach(({ model, entry }) => {
  assert.notEqual(entry.targetModel, model, '旧型号不能等于现库型号：' + model)
})

const expectedSearchTerms = new Map()
function addExpectedTerm(type, value, model) {
  if (value === null || value === undefined || String(value).trim() === '' || String(value).trim() === '/') return
  const normalized = String(value)
  const key = type + '\u0000' + normalized
  const term = expectedSearchTerms.get(key) || { type, value: normalized, models: new Set() }
  term.models.add(model)
  expectedSearchTerms.set(key, term)
}

recordModels.forEach((model) => {
  const type = typeByModel.get(model)
  records[model].forEach((reference) => {
    const definitions = columnGroups[reference.sheet]
    definitions.forEach((definition, index) => {
      const pair = reference.values[index] || []
      addExpectedTerm(type, pair[0], model)
      addExpectedTerm(type, pair[1], model)
    })
  })
})
Object.entries(historical).forEach(([model, entries]) => {
  const type = typeByModel.get(model)
  entries.forEach((entry) => addExpectedTerm(type, entry.targetModel, model))
})

expectedSearchTerms.forEach(({ type, value, models }) => {
  const returnedModels = new Set(filterProducts(type, value).map((product) => product.model))
  models.forEach((model) => {
    assert(returnedModels.has(model), 'filterProducts 必须以对照型号“' + value + '”找到 ' + model)
  })
})

const oneToMany = Array.from(expectedSearchTerms.values()).find((term) => term.models.size > 1)
assert(oneToMany, '数据中应覆盖至少一个一对多型号对照')
const oneToManyResults = new Set(filterProducts(oneToMany.type, oneToMany.value).map((product) => product.model))
oneToMany.models.forEach((model) => {
  assert(oneToManyResults.has(model), '一对多搜索不能漏掉 ' + oneToMany.value + ' → ' + model)
})

const aliasOnly = Array.from(expectedSearchTerms.values()).find((term) => (
  Array.from(term.models).some((model) => (
    !model.toLocaleLowerCase().includes(term.value.toLocaleLowerCase())
    && !term.value.toLocaleLowerCase().includes(model.toLocaleLowerCase())
  ))
  && filterProducts(term.type, term.value).length <= 12
))
assert(aliasOnly, '应能找到不包含现库型号文本的对照型号样本')
const aliasOwner = Array.from(aliasOnly.models).find((model) => (
  !model.toLocaleLowerCase().includes(aliasOnly.value.toLocaleLowerCase())
  && !aliasOnly.value.toLocaleLowerCase().includes(model.toLocaleLowerCase())
))
const aliasResult = filterProducts(aliasOnly.type, aliasOnly.value)
  .find((product) => product.model === aliasOwner)
assert(aliasResult && aliasResult.crossReferenceMatched, '别名命中列表应标记为对照型号命中')
assert(aliasResult.crossReferenceHint.includes(aliasOnly.value), '列表提示应显示命中的对照型号')

const previousPage = global.Page
const previousWx = global.wx
let libraryDefinition = null
let openedUrl = ''
global.Page = (definition) => { libraryDefinition = definition }
const libraryPath = require.resolve('../pages/products/library')
delete require.cache[libraryPath]
require(libraryPath)
delete require.cache[libraryPath]
global.Page = previousPage
const libraryPage = Object.assign({}, libraryDefinition, {
  data: JSON.parse(JSON.stringify(libraryDefinition.data)),
  setData(patch, callback) {
    this.data = { ...this.data, ...patch }
    if (typeof callback === 'function') callback()
  },
})
libraryPage.onLoad({ type: aliasOnly.type })
libraryPage.onSearchConfirm({ detail: { value: aliasOnly.value } })
const listedAliasProduct = libraryPage.data.products.find((product) => product.model === aliasOwner)
assert(listedAliasProduct, '实际资料库页面应显示对照型号命中')
assert(listedAliasProduct.crossReferenceMatched, '实际列表行应显示对照命中状态')
assert(listedAliasProduct.crossReferenceHint.includes(aliasOnly.value), '实际列表行应显示命中型号')
assert.equal(listedAliasProduct.compareSelected, false, '搜索命中不得自动选中产品')
global.wx = { navigateTo(options) { openedUrl = options.url } }
libraryPage.openProduct({ currentTarget: { dataset: { model: aliasOwner } } })
assert(openedUrl.includes('model=' + encodeURIComponent(aliasOwner)), '打开详情应保留现库产品型号')
if (previousWx === undefined) delete global.wx
else global.wx = previousWx

const speakerCapability = getProductFilters('speaker').find((item) => item.key !== 'all')
const capableSpeaker = modelsByType.speaker.find((item) => item.capabilities[speakerCapability.key])
assert(capableSpeaker, '应有音箱能力筛选样本')
const capableAlias = Array.from(expectedSearchTerms.values()).find((term) => (
  term.type === 'speaker' && term.models.has(capableSpeaker.model)
))
assert(capableAlias, '应有具备能力的音箱对照型号样本')
const capabilityResults = filterProducts('speaker', capableAlias.value, ALL_CATEGORY, speakerCapability.key)
assert(capabilityResults.some((item) => item.model === capableSpeaker.model),
  '能力筛选应保留匹配对照型号的现库设备')
assert(capabilityResults.every((item) => item.capabilities[speakerCapability.key]),
  '对照搜索不得绕过能力筛选')

const categorySample = modelsByType.speaker[0]
const categoryAlias = Array.from(expectedSearchTerms.values()).find((term) => (
  term.type === 'speaker' && term.models.has(categorySample.model)
))
assert(categoryAlias, '应有分类筛选的音箱对照样本')
assert(
  filterProducts('speaker', categoryAlias.value, categorySample.category, 'all')
    .every((item) => item.category === categorySample.category),
  '对照搜索不得绕过分类筛选',
)

const sourceText = getProductModelCrossReferenceSourceText()
assert(sourceText.includes(crossReference.source.fileName), '详情应显示来源文件')
assert(sourceText.includes(crossReference.source.version), '详情应显示来源版本')

const historyExpectations = {
  'KT-B10A': 'KT-B10',
  'TS-606A': 'TS-606H',
  'TS-6152': 'TS-8152',
}
Object.entries(historyExpectations).forEach(([model, targetModel]) => {
  assert(historical[model].some((entry) => entry.targetModel === targetModel),
    '历史关系目标型号不正确：' + model)
  assert(getProductModelCrossReferences(model).some((reference) => (
    reference.kind === 'history' && reference.targetModel === targetModel
  )), '详情应显示历史关系：' + model)
})
assert(getProductModelCrossReferences('TS-606A').some((reference) => (
  reference.noteSummary.includes('预下架') && reference.noteSummary.includes('KP-606A')
)), 'TS-606A 详情应保留精炼的预下架和替代说明')
assert.equal(getProduct('speaker', 'KT-B10A').model, 'KT-B10A', '历史关系不得改写现库产品身份')
assert.equal(getProduct('speaker', 'KT-B10'), null, '历史目标型号不得据此新建产品')
assert(!searchProductModelCrossReferences('KP-606A').has('TS-606A'),
  '说明文字中的替代产品不得混入型号映射搜索')

const stopModel = discontinuedModels[0]
assert(getProductModelCrossReferences(stopModel).some((reference) => (
  reference.kind === 'discontinued' && reference.statusLabel === '停产'
)), '停产来源必须在详情中明确标注')

const senlangMismatches = []
recordModels.forEach((model) => {
  records[model].forEach((reference) => {
    const definitions = columnGroups[reference.sheet]
    definitions.forEach((definition, index) => {
      const pair = reference.values[index] || []
      if (definition.brand === 'SENLANG'
        && pair[0] && pair[1]
        && String(pair[0]).trim() !== '/'
        && String(pair[1]).trim() !== '/'
        && String(pair[0]) !== String(pair[1])) {
        senlangMismatches.push({ model, row: reference.row, sheet: reference.sheet })
      }
    })
  })
})
assert.equal(senlangMismatches.length, 4, 'SENLANG 内部识别与产品型号不一致记录应保留四处')

console.log('产品型号对照通过：358 个精确/停产产品、34 条灯光旧型号、3 个历史关系；全部导入型号可由 filterProducts 找回。')

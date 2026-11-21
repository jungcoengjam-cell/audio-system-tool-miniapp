const ALL_CATEGORY = '全部'
const { findModelAliasMatches, formatModelAliasMatches } = require('./model-alias-search')

function getModelCategory(model = '') {
  const prefix = String(model).replace(/\d.*$/, '').replace(/-$/, '')
  return `${prefix || '其他'}系列`
}

function buildCatalogOptions(items, extendOption) {
  return items.map((item, index) => ({
    index,
    model: item.model,
    category: getModelCategory(item.model),
    ...(extendOption ? extendOption(item, index) : {}),
  }))
}

function buildCatalogCategories(items) {
  const labels = []
  items.forEach((item) => {
    if (!labels.includes(item.category)) labels.push(item.category)
  })
  return [{ label: ALL_CATEGORY }, ...labels.map((label) => ({ label }))]
}

function filterCatalogItems(items, categories, keyword, categoryIndex) {
  const category = categories[categoryIndex]?.label || ALL_CATEGORY
  const normalizedKeyword = String(keyword || '').trim().toLowerCase()
  const matches = []
  items.forEach((item) => {
    if (category !== ALL_CATEGORY && item.category !== category) return
    if (!normalizedKeyword
      || item.model.toLowerCase().includes(normalizedKeyword)
      || item.category.toLowerCase().includes(normalizedKeyword)) {
      matches.push(item)
      return
    }
    const aliases = findModelAliasMatches(item.model, normalizedKeyword)
    if (aliases.length) matches.push({ ...item, aliasMatch: formatModelAliasMatches(aliases) })
  })
  return matches
}

function findCatalogModelIndex(items, model, fallbackIndex = 0) {
  const index = items.findIndex((item) => item.model === model)
  return index >= 0 ? index : fallbackIndex
}

module.exports = {
  buildCatalogCategories,
  buildCatalogOptions,
  filterCatalogItems,
  findCatalogModelIndex,
  getModelCategory,
}

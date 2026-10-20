const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishLibraryModuleLoad = startMeasurement('产品资料库/脚本加载')
const { PRODUCT_COUNTS } = require('../../data/app-meta')
const {
  ALL_CATEGORY,
  buildProductComparison,
  filterProducts,
  getCategories,
  getProductFilters,
  getRecentProducts,
} = require('../../utils/products')

const PRODUCT_PAGE_SIZE = 12
const SEARCH_REFRESH_DELAY = 140

function decorateProducts(products, selectedModels) {
  const selectedSet = new Set(selectedModels)
  return products.map((item) => ({
    model: item.model,
    category: item.category,
    meta: item.meta,
    statusLabel: item.statusLabel,
    statusKey: item.statusKey,
    abilityLabels: item.abilityLabels,
    verifiedType: item.verifiedType,
    compareSelected: selectedSet.has(item.model),
  }))
}

function decorateRecentProducts(products) {
  return products.map((item) => ({
    model: item.model,
    category: item.category,
  }))
}

function hasSameRecentProducts(current, next) {
  return current.length === next.length && current.every((item, index) => (
    item.model === next[index].model && item.category === next[index].category
  ))
}

finishLibraryModuleLoad({
  ...PRODUCT_COUNTS,
})

Page({
  data: {
    types: [
      { key: 'amplifier', label: '功放', count: PRODUCT_COUNTS.amplifier },
      { key: 'speaker', label: '音箱', count: PRODUCT_COUNTS.speaker },
      { key: 'camera', label: '摄像机', count: PRODUCT_COUNTS.camera },
      { key: 'lighting', label: '灯光', count: PRODUCT_COUNTS.lighting },
    ],
    typeIndex: 0,
    keyword: '',
    categories: [],
    categoryIndex: 0,
    capabilityFilters: [],
    capabilityFilterIndex: 0,
    products: [],
    productTotalCount: 0,
    hasMoreProducts: false,
    recentProducts: [],
    showRecent: true,
    compareSelectedModels: [],
    productComparison: null,
  },

  onLoad(options = {}) {
    const finishInitialization = startMeasurement('产品资料库/初始化总耗时')
    const typeIndex = options.type === 'lighting'
      ? 3
      : options.type === 'camera' ? 2 : options.type === 'speaker' ? 1 : 0
    this._skipNextShowRefresh = true
    this.refresh(true, true, { typeIndex }, (details) => finishInitialization(details))
  },

  onShow() {
    if (this._skipNextShowRefresh) {
      this._skipNextShowRefresh = false
      return
    }
    this.refreshRecentProducts()
  },

  onUnload() {
    this.cancelSearchRefresh()
    this.pendingSearchKeyword = null
    printPerformanceSummary('产品资料库/')
  },

  onTypeTap(event) {
    this.cancelSearchRefresh()
    this.pendingSearchKeyword = null
    this.refresh(true, true, {
      typeIndex: Number(event.currentTarget.dataset.index),
      keyword: '',
      categoryIndex: 0,
      capabilityFilterIndex: 0,
      compareSelectedModels: [],
      productComparison: null,
    })
  },

  onSearchInput(event) {
    this.scheduleSearchRefresh(event.detail.value)
  },

  onSearchConfirm(event) {
    this.cancelSearchRefresh()
    this.pendingSearchKeyword = null
    this.refresh(false, true, { keyword: event.detail.value })
  },

  clearSearch() {
    this.cancelSearchRefresh()
    this.pendingSearchKeyword = null
    this.refresh(false, true, { keyword: '' })
  },

  onCategoryTap(event) {
    const keyword = this.pendingSearchKeyword ?? this.data.keyword
    this.cancelSearchRefresh()
    this.pendingSearchKeyword = null
    this.refresh(false, true, {
      keyword,
      categoryIndex: Number(event.currentTarget.dataset.index),
    })
  },

  onCapabilityTap(event) {
    const keyword = this.pendingSearchKeyword ?? this.data.keyword
    this.cancelSearchRefresh()
    this.pendingSearchKeyword = null
    this.refresh(false, true, {
      keyword,
      capabilityFilterIndex: Number(event.currentTarget.dataset.index),
    })
  },

  scheduleSearchRefresh(keyword) {
    this.cancelSearchRefresh()
    this.pendingSearchKeyword = keyword
    this.searchRefreshTimer = setTimeout(() => {
      this.searchRefreshTimer = null
      this.pendingSearchKeyword = null
      this.refresh(false, true, { keyword })
    }, SEARCH_REFRESH_DELAY)
  },

  cancelSearchRefresh() {
    if (!this.searchRefreshTimer) return
    clearTimeout(this.searchRefreshTimer)
    this.searchRefreshTimer = null
  },

  refreshRecentProducts() {
    const type = this.data.types[this.data.typeIndex].key
    const recentProducts = decorateRecentProducts(getRecentProducts(type).slice(0, 6))
    if (hasSameRecentProducts(this.data.recentProducts, recentProducts)) return false
    const finishViewUpdate = startMeasurement('产品资料库/最近查看视图更新', {
      type,
      rendered: recentProducts.length,
    })
    this.setData({ recentProducts }, () => finishViewUpdate())
    return true
  },

  refresh(resetCategories, resetVisible = false, changes = {}, onUpdated) {
    const finishRefresh = startMeasurement('产品资料库/刷新总耗时', {
      resetCategories,
      resetVisible,
    })
    const state = { ...this.data, ...changes }
    const type = state.types[state.typeIndex].key
    const categories = resetCategories || !state.categories.length
      ? getCategories(type)
      : state.categories
    const categoryIndex = Math.min(state.categoryIndex, categories.length - 1)
    const category = categories[categoryIndex] || ALL_CATEGORY
    const capabilityFilters = getProductFilters(type)
    const capabilityFilterIndex = Math.min(
      state.capabilityFilterIndex,
      capabilityFilters.length - 1,
    )
    const capability = capabilityFilters[capabilityFilterIndex].key
    const keyword = state.keyword
    const compareSelectedModels = state.compareSelectedModels
    const finishFilter = startMeasurement('产品资料库/产品筛选', {
      type,
      keywordLength: keyword.length,
      category,
      capability,
    })
    const filteredProducts = filterProducts(type, keyword, category, capability)
    finishFilter({ matches: filteredProducts.length })
    const visibleCount = resetVisible
      ? PRODUCT_PAGE_SIZE
      : Math.max(PRODUCT_PAGE_SIZE, state.products.length)
    const products = decorateProducts(
      filteredProducts.slice(0, visibleCount),
      compareSelectedModels,
    )
    const showRecent = !keyword.trim() && category === ALL_CATEGORY && capability === 'all'
    this.filteredProducts = filteredProducts

    const finishViewUpdate = startMeasurement('产品资料库/setData视图更新', {
      type,
      rendered: products.length,
      matches: filteredProducts.length,
    })
    const nextData = {
      ...changes,
      categoryIndex,
      capabilityFilterIndex,
      products,
      productTotalCount: filteredProducts.length,
      hasMoreProducts: products.length < filteredProducts.length,
      recentProducts: showRecent
        ? decorateRecentProducts(getRecentProducts(type).slice(0, 6))
        : [],
      showRecent,
    }
    if (resetCategories || !this.data.categories.length) {
      nextData.categories = categories
      nextData.capabilityFilters = capabilityFilters
    }
    this.setData(nextData, () => {
      const details = {
        type,
        rendered: products.length,
        matches: filteredProducts.length,
      }
      finishViewUpdate(details)
      finishRefresh(details)
      if (typeof onUpdated === 'function') onUpdated(details)
    })
  },

  loadMoreProducts() {
    const filteredProducts = this.filteredProducts || []
    if (this.data.products.length >= filteredProducts.length) return
    const appendStart = this.data.products.length
    const finishAppend = startMeasurement('产品资料库/追加列表视图更新', {
      before: appendStart,
      matches: filteredProducts.length,
    })
    const appendedProducts = decorateProducts(
      filteredProducts.slice(appendStart, appendStart + PRODUCT_PAGE_SIZE),
      this.data.compareSelectedModels,
    )
    const nextLength = appendStart + appendedProducts.length
    const patch = {
      hasMoreProducts: nextLength < filteredProducts.length,
    }
    appendedProducts.forEach((product, index) => {
      patch[`products[${appendStart + index}]`] = product
    })
    this.setData(patch, () => finishAppend({ rendered: nextLength }))
  },

  openProduct(event) {
    const type = this.data.types[this.data.typeIndex].key
    const model = event.currentTarget.dataset.model
    wx.navigateTo({
      url: `/pages/products/detail?type=${type}&model=${encodeURIComponent(model)}`,
    })
  },


  toggleProductCompare(event) {
    const model = event.currentTarget.dataset.model
    const selected = this.data.compareSelectedModels
    let next
    if (selected.includes(model)) next = selected.filter((item) => item !== model)
    else if (selected.length < 3) next = [...selected, model]
    else {
      wx.showToast({ title: '每次最多比较三款产品', icon: 'none' })
      return
    }
    const type = this.data.types[this.data.typeIndex].key
    const patch = {
      compareSelectedModels: next,
      productComparison: next.length >= 2 ? buildProductComparison(type, next) : null,
    }
    this.data.products.forEach((product, index) => {
      const compareSelected = next.includes(product.model)
      if (product.compareSelected !== compareSelected) {
        patch[`products[${index}].compareSelected`] = compareSelected
      }
    })
    this.setData(patch)
  },

  clearProductComparison() {
    const patch = {
      compareSelectedModels: [],
      productComparison: null,
    }
    this.data.products.forEach((product, index) => {
      if (product.compareSelected) patch[`products[${index}].compareSelected`] = false
    })
    this.setData(patch)
  },
})

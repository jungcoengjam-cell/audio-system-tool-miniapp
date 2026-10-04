const { CATEGORIES } = require('./catalog')
const { catalog } = require('./runtime-catalog')
const { searchGallery } = require('./model')

function categoryOptions(selectedKey) {
  return CATEGORIES.map((item) => ({ ...item, selected: item.key === selectedKey }))
}

Page({
  data: {
    categories: categoryOptions('all'),
    categoryKey: 'all',
    keyword: '',
    items: [],
    isEmpty: true,
  },

  onLoad() {
    this.refreshGallery()
  },

  refreshGallery() {
    const items = searchGallery(catalog, {
      category: this.data.categoryKey,
      keyword: this.data.keyword,
    })
    this.setData({ items, isEmpty: items.length === 0 })
  },

  onCategoryTap(event) {
    const categoryKey = String(event.currentTarget.dataset.key || 'all')
    this.setData({ categoryKey, categories: categoryOptions(categoryKey) }, () => this.refreshGallery())
  },

  onSearchInput(event) {
    this.setData({ keyword: String(event.detail.value || '') }, () => this.refreshGallery())
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.refreshGallery())
  },

  clearFilters() {
    this.setData({
      keyword: '',
      categoryKey: 'all',
      categories: categoryOptions('all'),
    }, () => this.refreshGallery())
  },

  openDevice(event) {
    const appearanceGroupId = String(event.currentTarget.dataset.groupId || '')
    if (!appearanceGroupId) return
    wx.navigateTo({
      url: `/pages/control-protocol/detail?appearanceGroupId=${encodeURIComponent(appearanceGroupId)}`,
    })
  },
})

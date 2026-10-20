'use strict'

const { CATEGORY_FILTERS, getTools } = require('../../utils/tool-registry')
const { activatePrimaryTab } = require('../../utils/primary-navigation')

Page({
  data: {
    categories: CATEGORY_FILTERS,
    activeCategory: '全部',
    tools: getTools('全部'),
  },

  onShow() {
    if (!activatePrimaryTab('tools')) return
  },

  onCategoryTap(event) {
    const category = event.currentTarget.dataset.category
    if (!CATEGORY_FILTERS.includes(category)) return
    this.setData({ activeCategory: category, tools: getTools(category) })
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },
})

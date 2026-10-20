'use strict'

const { CATEGORY_FILTERS } = require('../../utils/tool-registry')
const { activatePrimaryTab } = require('../../utils/primary-navigation')
const { readToolVisibility, getVisibleTools } = require('../../utils/tool-visibility')

Page({
  data: {
    categories: CATEGORY_FILTERS,
    activeCategory: '全部',
    tools: [],
    visibilityError: '',
  },

  onShow() {
    if (!activatePrimaryTab('tools')) return
    this.refreshTools()
  },

  refreshTools() {
    const visibility = readToolVisibility()
    this.setData({
      tools: getVisibleTools(this.data.activeCategory, visibility),
      visibilityError: visibility.ok ? '' : visibility.error,
    })
  },

  onCategoryTap(event) {
    const category = event.currentTarget.dataset.category
    if (!CATEGORY_FILTERS.includes(category)) return
    this.setData({ activeCategory: category })
    this.refreshTools()
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },
})

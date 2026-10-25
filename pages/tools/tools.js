'use strict'

const { CATEGORY_FILTERS } = require('../../utils/tool-registry')
const { vibrate } = require('../../utils/haptics')
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
    const changed = category !== this.data.activeCategory
    this.setData({ activeCategory: category })
    this.refreshTools()
    if (changed) vibrate('light')
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },
})

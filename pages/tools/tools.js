'use strict'

const { CATEGORY_FILTERS } = require('../../utils/tool-registry')
const { vibrate } = require('../../utils/haptics')
const { activatePrimaryTab } = require('../../utils/primary-navigation')
const { readToolVisibility, getVisibleTools } = require('../../utils/tool-visibility')
let beginToolLoadProbe = () => false
let markToolLoadHomeHidden = () => false
let markToolLoadHomeShown = () => false
try {
  const performanceProbe = require('../../utils/performance')
  if (typeof performanceProbe.beginToolLoadProbe === 'function') {
    beginToolLoadProbe = (route) => {
      try { return performanceProbe.beginToolLoadProbe(route) } catch (error) { return false }
    }
  }
  if (typeof performanceProbe.markToolLoadHomeHidden === 'function') {
    markToolLoadHomeHidden = () => {
      try { return performanceProbe.markToolLoadHomeHidden() } catch (error) { return false }
    }
  }
  if (typeof performanceProbe.markToolLoadHomeShown === 'function') {
    markToolLoadHomeShown = () => {
      try { return performanceProbe.markToolLoadHomeShown() } catch (error) { return false }
    }
  }
} catch (error) {}

Page({
  data: {
    categories: CATEGORY_FILTERS,
    activeCategory: '全部',
    tools: [],
    visibilityError: '',
  },

  onShow() {
    try { markToolLoadHomeShown() } catch (error) {}
    if (!activatePrimaryTab('tools')) return
    this.refreshTools()
  },

  onHide() {
    try { markToolLoadHomeHidden() } catch (error) {}
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

  onToolNavigationTap(event = {}) {
    try {
      const route = event.currentTarget && event.currentTarget.dataset
        ? event.currentTarget.dataset.loadRoute
        : ''
      beginToolLoadProbe(route)
    } catch (error) {}
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },
})

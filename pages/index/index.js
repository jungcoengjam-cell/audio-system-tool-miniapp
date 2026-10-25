'use strict'

const { getBasisTools } = require('../../utils/tool-registry')
const { activatePrimaryTab } = require('../../utils/primary-navigation')
const { readToolVisibility } = require('../../utils/tool-visibility')

Page({
  data: {
    basisTools: [],
    visibilityError: '',
    visibilityReady: false,
  },

  onShow() {
    if (!activatePrimaryTab('basis')) return
    this.refreshBasisTools()
  },

  refreshBasisTools() {
    const visibility = readToolVisibility()
    const hidden = new Set(visibility.ok ? visibility.hiddenIds : [])
    this.setData({
      basisTools: getBasisTools().filter(tool => !hidden.has(tool.id)),
      visibilityError: visibility.ok ? '' : visibility.error,
      visibilityReady: true,
    })
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },
})

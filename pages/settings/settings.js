'use strict'

const { APP_VERSION, PRODUCT_DATA_DATE } = require('../../data/app-meta')
const { removePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const { getTools } = require('../../utils/tool-registry')
const { readToolVisibility, setToolVisible, resetToolVisibility } = require('../../utils/tool-visibility')

const TOOL_PREFERENCE_KEYS = [
  'audioTool.limiter.preferences',
  'audioTool.spl.preferences',
  'audioTool.cable.preferences',
  'audioTool.camera.preferences',
  'audioTool.ledScreen.preferences',
  'audioTool.gainStructure.preferences',
  'audioTool.dmxAddress.preferences',
]

Page({
  data: {
    appVersion: APP_VERSION,
    productDataDate: PRODUCT_DATA_DATE,
    toolRows: [],
    visibilityError: '',
  },

  onShow() {
    this.refreshToolVisibility()
  },

  refreshToolVisibility() {
    const state = readToolVisibility()
    const hidden = new Set(state.hiddenIds)
    this.setData({
      toolRows: getTools().map(tool => ({ id: tool.id, title: tool.title, icon: tool.icon, visible: !hidden.has(tool.id) })),
      visibilityError: state.ok ? '' : state.error,
    })
  },

  onToolVisibilityChange(event) {
    const id = event.currentTarget.dataset.id
    const visible = event.detail.value
    if (!setToolVisible(id, visible)) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      // Recreate switch nodes so a failed native toggle returns to stored state.
      this.setData({ toolRows: [] }, () => this.refreshToolVisibility())
      return
    }
    this.refreshToolVisibility()
  },

  resetPreferences() {
    wx.showModal({
      title: '恢复默认设置',
      content: '清除七个计算工具记住的上次输入，并重新显示全部工具。项目、收藏、计算记录和产品资料保留。',
      confirmText: '恢复默认',
      success: ({ confirm }) => {
        if (!confirm) return
        try {
          for (const key of TOOL_PREFERENCE_KEYS) {
            if (!removePreferences(key)) throw new Error('remove preferences failed')
          }
          if (!resetToolVisibility()) throw new Error('reset visibility failed')
          this.refreshToolVisibility()
          vibrate('medium')
          wx.showToast({ title: '已恢复默认', icon: 'success' })
        } catch (error) {
          this.refreshToolVisibility()
          wx.showToast({ title: '部分设置未恢复，请重试', icon: 'none' })
        }
      },
    })
  },
})

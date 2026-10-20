'use strict'

const { APP_VERSION, PRODUCT_DATA_DATE } = require('../../data/app-meta')
const { removePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')

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
  },

  resetPreferences() {
    wx.showModal({
      title: '恢复默认设置',
      content: '仅清除七个计算工具记住的上次输入，产品资料和小程序功能不会受影响。',
      confirmText: '恢复默认',
      success: ({ confirm }) => {
        if (!confirm) return
        try {
          for (const key of TOOL_PREFERENCE_KEYS) {
            if (!removePreferences(key)) throw new Error('remove preferences failed')
          }
          vibrate('medium')
          wx.showToast({ title: '已恢复默认', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: '操作失败，请重试', icon: 'none' })
        }
      },
    })
  },
})

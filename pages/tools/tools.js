const { APP_VERSION, PRODUCT_DATA_DATE } = require('../../data/app-meta')
const { removePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')

const MODULES = [
  { id: 'audioWiring', domain: 'audio', title: '接线助手', image: '/assets/home/module-audio-wiring-catalog.png', path: '/pages/audio-wiring/index' },
  { id: 'projectWiring', domain: 'audio', title: '通道与线缆', image: '/assets/home/module-project-wiring-catalog.png', path: '/pages/project-wiring/index' },
  { id: 'gainStructure', domain: 'audio', title: '增益结构', image: '/assets/home/module-gain-structure-catalog.png', path: '/pages/gain-structure/gain-structure' },
  { id: 'limiter', domain: 'audio', title: '限幅器', image: '/assets/home/module-limiter-catalog.png', path: '/pages/limiter/limiter' },
  { id: 'spl', domain: 'audio', title: '声压级', image: '/assets/home/module-spl-catalog.png', path: '/pages/spl/spl' },
  { id: 'venue', domain: 'audio', title: '会议室扩声', image: '/assets/home/module-venue-catalog.png', path: '/pages/venue/venue' },
  { id: 'cable', domain: 'audio', title: '线材选型', image: '/assets/home/module-cable-catalog.png', path: '/pages/cable/cable' },
  { id: 'camera', domain: 'video', title: '摄像机视场角', image: '/assets/home/module-camera-catalog.png', path: '/pages/camera/camera' },
  { id: 'ledScreen', domain: 'video', title: 'LED 大屏', image: '/assets/home/module-led-screen-catalog.png', path: '/pages/led-screen/led-screen' },
  { id: 'dmxAddress', domain: 'lighting', title: '灯具地址码', image: '/assets/home/module-dmx-address-catalog.png', path: '/pages/dmx-address/dmx-address' },
]

Page({
  data: {
    appVersion: APP_VERSION,
    productDataDate: PRODUCT_DATA_DATE,
    audioModules: MODULES.filter((item) => item.domain === 'audio'),
    videoModules: MODULES.filter((item) => item.domain === 'video'),
    lightingModules: MODULES.filter((item) => item.domain === 'lighting'),
  },

  resetPreferences() {
    wx.showModal({
      title: '恢复默认设置',
      content: '仅清除八个计算工具记住的上次输入，产品资料和小程序功能不会受影响。',
      confirmText: '恢复默认',
      success: ({ confirm }) => {
        if (!confirm) return
        try {
          const keys = [
            'audioTool.limiter.preferences',
            'audioTool.spl.preferences',
            'audioTool.cable.preferences',
            'audioTool.venue.preferences',
            'audioTool.camera.preferences',
            'audioTool.ledScreen.preferences',
            'audioTool.gainStructure.preferences',
            'audioTool.dmxAddress.preferences',
          ]
          if (keys.map(removePreferences).some((removed) => !removed)) throw new Error('remove preferences failed')
          vibrate('medium')
          wx.showToast({ title: '已恢复默认', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: '操作失败，请重试', icon: 'none' })
        }
      },
    })
  },
})

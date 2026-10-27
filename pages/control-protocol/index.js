let markToolLoadStage = () => false
try {
  const performanceProbe = require('../../utils/performance')
  if (typeof performanceProbe.markToolLoadStage === 'function') {
    markToolLoadStage = (route, phase) => {
      try { return performanceProbe.markToolLoadStage(route, phase) } catch (error) { return false }
    }
  }
  markToolLoadStage('/pages/control-protocol/index', 'module')
} catch (error) {}

const DETAIL_URL = '/pages/control-protocol/detail'
const COMPATIBILITY_KEYS = ['referenceId', 'appearanceGroupId']

Page({
  onLoad(options = {}) {
    markToolLoadStage('/pages/control-protocol/index', 'onLoad')
    const query = COMPATIBILITY_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(options, key))
      .map((key) => `${key}=${encodeURIComponent(String(options[key] || ''))}`)
      .join('&')
    wx.redirectTo({ url: query ? `${DETAIL_URL}?${query}` : DETAIL_URL })
  },
})

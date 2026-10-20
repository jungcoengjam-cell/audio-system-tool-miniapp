const DETAIL_URL = '/pages/control-protocol/detail'
const COMPATIBILITY_KEYS = ['referenceId', 'appearanceGroupId']

Page({
  onLoad(options = {}) {
    const query = COMPATIBILITY_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(options, key))
      .map((key) => `${key}=${encodeURIComponent(String(options[key] || ''))}`)
      .join('&')
    wx.redirectTo({ url: query ? `${DETAIL_URL}?${query}` : DETAIL_URL })
  },
})

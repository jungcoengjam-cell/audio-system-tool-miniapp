function vibrate(type = 'light') {
  try {
    if (typeof wx === 'undefined' || typeof wx.vibrateShort !== 'function') return
    wx.vibrateShort({ type, fail() {} })
  } catch (error) {
    // 触感反馈只用于辅助确认，不支持时不影响原操作。
  }
}

module.exports = { vibrate }

const { vibrate } = require('./haptics')

function previewGeneratedImage(imagePath) {
  if (!imagePath || typeof wx.previewImage !== 'function') return false
  wx.previewImage({ current: imagePath, urls: [imagePath] })
  return true
}

function shareGeneratedImage(imagePath) {
  if (!imagePath) return false
  vibrate('medium')
  if (typeof wx.showShareImageMenu === 'function') {
    wx.showShareImageMenu({
      path: imagePath,
      fail: ({ errMsg = '' } = {}) => {
        if (!/cancel/i.test(errMsg)) wx.showToast({ title: '转发未完成，请重试', icon: 'none' })
      },
    })
    return true
  }
  previewGeneratedImage(imagePath)
  wx.showToast({ title: '请长按图片转发', icon: 'none' })
  return true
}

function saveGeneratedImage(imagePath) {
  if (!imagePath || typeof wx.saveImageToPhotosAlbum !== 'function') return false
  vibrate('medium')
  wx.saveImageToPhotosAlbum({
    filePath: imagePath,
    success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
    fail: ({ errMsg = '' } = {}) => {
      if (/cancel/i.test(errMsg)) return
      if (/auth|authorize|permission|deny/i.test(errMsg) && typeof wx.openSetting === 'function') {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存图片到相册，再重新保存。',
          confirmText: '去设置',
          success: ({ confirm }) => { if (confirm) wx.openSetting() },
        })
        return
      }
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    },
  })
  return true
}

module.exports = {
  previewGeneratedImage,
  saveGeneratedImage,
  shareGeneratedImage,
}

const { vibrate } = require('./haptics')

function getCurrentPage() {
  if (typeof getCurrentPages !== 'function') return { supported: false, page: null }
  try {
    const pages = getCurrentPages()
    return {
      supported: true,
      page: Array.isArray(pages) && pages.length ? pages[pages.length - 1] : null,
    }
  } catch (error) {
    return { supported: true, page: null }
  }
}

function isPageContextCurrent(page) {
  if (!page || page._pageVisible === false || page._pageAlive === false
    || page._isUnloaded || page._cameraUnloaded || page._ledUnloaded
    || page._alive === false || page._visible === false) return false
  if (typeof getCurrentPages !== 'function') return false
  try {
    const pages = getCurrentPages()
    return Array.isArray(pages) && pages.length > 0 && pages[pages.length - 1] === page
  } catch (error) {
    return false
  }
}

function previewGeneratedImage(imagePath) {
  if (!imagePath || typeof wx.previewImage !== 'function') return false
  wx.previewImage({ current: imagePath, urls: [imagePath] })
  return true
}

function shareGeneratedImage(imagePath) {
  if (!imagePath) return false
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

function saveGeneratedImage(imagePath, options = {}) {
  if (!imagePath || typeof wx.saveImageToPhotosAlbum !== 'function') return false
  const pageContext = getCurrentPage()
  const isCurrent = () => {
    try {
      if (typeof options.isCurrent === 'function' && !options.isCurrent()) return false
      return pageContext.supported && isPageContextCurrent(pageContext.page)
    } catch (error) {
      return false
    }
  }
  wx.saveImageToPhotosAlbum({
    filePath: imagePath,
    success: () => {
      if (isCurrent()) vibrate('medium')
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    },
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
  isPageContextCurrent,
  previewGeneratedImage,
  saveGeneratedImage,
  shareGeneratedImage,
}

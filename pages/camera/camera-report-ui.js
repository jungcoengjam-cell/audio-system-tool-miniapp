const { vibrate } = require('../../utils/haptics')
const { isPageContextCurrent } = require('../../utils/report-image-actions')
const nativeImagePreview = require('../native-image-preview')

const PREVIEW_CLOSE_DURATION = 320

function createCameraReportUiData() {
  return {
    resultReportPreviewClosing: false,
    resultReportPreviewStyle: '',
    isCheckingResultReportCache: false,
  }
}

function cancelPreviewClose(page) {
  if (page._cameraReportPreviewCloseTimer != null) {
    clearTimeout(page._cameraReportPreviewCloseTimer)
  }
  page._cameraReportPreviewCloseTimer = null
}

function currentSignature(page) {
  if (!page || typeof page.getResultReportSignature !== 'function') return ''
  try {
    return page.getResultReportSignature() || ''
  } catch (error) {
    return ''
  }
}

function currentImageTheme(page) {
  return page?.data?.theme === 'dark' ? 'dark' : 'light'
}

function isPageActive(page) {
  return Boolean(page && !page._cameraUnloaded && !page._isUnloaded && page._pageVisible !== false)
}

function isCurrentReport(page, path, signature) {
  if (!isPageActive(page) || !page.data || !path
    || page.data.resultUpdating || page.data.legacyCustomUnsupported
    || page.data.resultReportImagePath !== path
    || !signature || page.resultReportSignature !== signature
    || currentSignature(page) !== signature) return false
  if (typeof page.canUseCurrentResultReport === 'function') {
    try {
      return Boolean(page.canUseCurrentResultReport())
    } catch (error) {
      return false
    }
  }
  return true
}

function bump(page, key) {
  page[key] = (Number(page[key]) || 0) + 1
  return page[key]
}

function hiddenPreviewChanges(page) {
  cancelPreviewClose(page)
  bump(page, '_cameraReportPreviewLayoutRevision')
  bump(page, '_cameraReportCacheCheckRevision')
  bump(page, '_cameraReportPreviewAccessRevision')
  return {
    resultReportPreviewVisible: false,
    resultReportPreviewClosing: false,
    resultReportPreviewStyle: '',
    isCheckingResultReportCache: false,
  }
}

function cancelCameraReportUi(page) {
  if (!page) return
  nativeImagePreview.cancel(page)
  const changes = hiddenPreviewChanges(page)
  if (typeof page.setData !== 'function' || !page.data
    || page._cameraUnloaded || page._isUnloaded) return
  const changed = Object.fromEntries(Object.entries(changes)
    .filter(([key, value]) => !Object.is(page.data[key], value)))
  if (Object.keys(changed).length) page.setData(changed)
}

function showToast(title) {
  if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
    wx.showToast({ title, icon: 'none' })
  }
}

function accessLocalImage(path, onSuccess, onFailure) {
  try {
    const fileSystem = typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function'
      ? wx.getFileSystemManager()
      : null
    if (!fileSystem || typeof fileSystem.access !== 'function') {
      onFailure()
      return
    }
    fileSystem.access({ path, success: onSuccess, fail: onFailure })
  } catch (error) {
    onFailure()
  }
}

function createCameraReportUiMethods(baseMethods = {}) {
  const base = baseMethods || {}

  return {
    ...base,

    finishResultReportGeneration(revision, changes = {}) {
      if (this.resultReportRevision !== revision) return
      if (typeof wx !== 'undefined' && typeof wx.hideLoading === 'function') wx.hideLoading()
      this.resultReportPendingSignature = ''
      const updates = { isGeneratingResultReport: false, ...changes }
      if (changes.resultReportPreviewVisible) {
        cancelPreviewClose(this)
        updates.resultReportPreviewClosing = false
        updates.resultReportPreviewStyle = ''
      }
      this.setData(updates, () => {
        if (changes.resultReportPreviewVisible) this.updateResultReportPreviewLayout()
      })
    },

    generateResultReportImage() {
      if (typeof base.generateResultReportImage !== 'function') return false
      if (this.data?.isCheckingResultReportCache || this.data?.isGeneratingResultReport
        || this.data?.resultUpdating || this.data?.legacyCustomUnsupported) return false

      const path = this.data?.resultReportImagePath
      const signature = currentSignature(this)
      const imageTheme = currentImageTheme(this)
      if (!path || !signature || this.resultReportSignature !== signature
        || this._resultReportImageTheme !== imageTheme) {
        return base.generateResultReportImage.call(this)
      }

      const inputRevision = this._inputRevision || 0
      const revision = bump(this, '_cameraReportCacheCheckRevision')
      const reportRevision = this.resultReportRevision || 0
      cancelPreviewClose(this)
      bump(this, '_cameraReportPreviewLayoutRevision')
      this.setData({
        isCheckingResultReportCache: true,
        resultReportPreviewClosing: false,
        resultReportPreviewStyle: '',
      })

      const isCurrent = () => this._cameraReportCacheCheckRevision === revision
        && (this._inputRevision || 0) === inputRevision
        && currentImageTheme(this) === imageTheme
        && this._resultReportImageTheme === imageTheme
        && isCurrentReport(this, path, signature)
      const openCached = () => {
        if (!isCurrent()) return
        const shouldNotifyOpen = !this.data.resultReportPreviewVisible
        this._cameraReportCacheCheckRevision = 0
        this.setData({
          isCheckingResultReportCache: false,
          resultReportPreviewVisible: true,
          resultReportPreviewClosing: false,
          resultReportPreviewStyle: '',
        }, () => {
          if (shouldNotifyOpen && this.resultReportRevision === reportRevision
            && !this.data.isCheckingResultReportCache && this.data.resultReportPreviewVisible
            && isPageContextCurrent(this) && isCurrentReport(this, path, signature)) vibrate('light')
          this.updateResultReportPreviewLayout()
        })
      }
      const regenerate = () => {
        if (this._cameraReportCacheCheckRevision !== revision
          || (this._inputRevision || 0) !== inputRevision
          || !isPageActive(this) || currentSignature(this) !== signature) return
        this._cameraReportCacheCheckRevision = 0
        cancelPreviewClose(this)
        this.resultReportSignature = ''
        this._resultReportImageTheme = ''
        this.resultReportPendingSignature = ''
        this.setData({
          ...hiddenPreviewChanges(this),
          resultReportImagePath: '',
          isGeneratingResultReport: false,
        }, () => {
          if (isPageActive(this) && (this._inputRevision || 0) === inputRevision
            && currentSignature(this) === signature) {
            base.generateResultReportImage.call(this)
          }
        })
      }

      accessLocalImage(path, openCached, regenerate)
      return true
    },

    hideResultReportPreview() {
      return hiddenPreviewChanges(this)
    },

    invalidateResultReportPreview() {
      this.resultReportSignature = ''
      this._resultReportImageTheme = ''
      return {
        ...hiddenPreviewChanges(this),
        resultReportImagePath: '',
      }
    },

    updateResultReportPreviewLayout() {
      const path = this.data?.resultReportImagePath
      const signature = this.resultReportSignature
      if (!isPageActive(this) || !this.data?.resultReportPreviewVisible
        || this.data.resultReportPreviewClosing || !path || !signature
        || currentSignature(this) !== signature) return false

      bump(this, '_cameraReportPreviewLayoutRevision')
      if (this.data.resultReportPreviewStyle) this.setData({ resultReportPreviewStyle: '' })
      return true
    },

    closeResultReportPreview(immediate) {
      if (!this.data?.resultReportPreviewVisible
        || (this.data.resultReportPreviewClosing && immediate !== true)) return false
      nativeImagePreview.cancel(this)
      if (immediate !== true && isPageActive(this) && isPageContextCurrent(this)) vibrate('light')
      if (immediate === true || !isPageActive(this)) {
        this.setData(hiddenPreviewChanges(this))
        return true
      }

      const closingRevision = bump(this, '_cameraReportPreviewLayoutRevision')
      bump(this, '_cameraReportCacheCheckRevision')
      cancelPreviewClose(this)
      this.setData({ resultReportPreviewClosing: true }, () => {
        if (closingRevision !== this._cameraReportPreviewLayoutRevision
          || !this.data.resultReportPreviewVisible || !this.data.resultReportPreviewClosing) return
        const timer = setTimeout(() => {
          if (this._cameraReportPreviewCloseTimer !== timer
            || closingRevision !== this._cameraReportPreviewLayoutRevision
            || !this.data.resultReportPreviewVisible || !this.data.resultReportPreviewClosing) return
          this._cameraReportPreviewCloseTimer = null
          this.setData(hiddenPreviewChanges(this))
        }, PREVIEW_CLOSE_DURATION)
        this._cameraReportPreviewCloseTimer = timer
      })
      return true
    },

    preventTouchMove() {},

    stopTap() {},

    previewResultReportImage() {
      const path = this.data?.resultReportImagePath
      const signature = this.resultReportSignature
      if (!this.data?.resultReportPreviewVisible || this.data.resultReportPreviewClosing
        || !isCurrentReport(this, path, signature)) return false

      const revision = bump(this, '_cameraReportPreviewAccessRevision')
      const inputRevision = this._inputRevision || 0
      const isCurrent = () => this._cameraReportPreviewAccessRevision === revision
        && (this._inputRevision || 0) === inputRevision
        && this.data.resultReportPreviewVisible && !this.data.resultReportPreviewClosing
        && isCurrentReport(this, path, signature)
      const openPreview = () => {
        if (!isCurrent()) return
        if (!nativeImagePreview.preview(this, path, () => cancelCameraReportUi(this))) {
          showToast('原图预览暂不可用，请重试')
          return
        }
        if (isPageContextCurrent(this)) vibrate('light')
      }
      const invalidate = () => {
        if (!isCurrent()) return
        this.resultReportSignature = ''
        this._resultReportImageTheme = ''
        this.setData({
          ...hiddenPreviewChanges(this),
          resultReportImagePath: '',
        })
        showToast('原图不可用，请重新生成')
      }

      accessLocalImage(path, openPreview, invalidate)
      return true
    },

    shareResultReportImage() {
      if (!this.data?.resultReportPreviewVisible || this.data.resultReportPreviewClosing
        || !isCurrentReport(this, this.data.resultReportImagePath, this.resultReportSignature)
        || typeof base.shareResultReportImage !== 'function') return false
      return nativeImagePreview.share(this, this.data.resultReportImagePath,
        () => base.shareResultReportImage.call(this), () => cancelCameraReportUi(this))
    },

    saveResultReportImage() {
      if (!this.data?.resultReportPreviewVisible || this.data.resultReportPreviewClosing
        || !isCurrentReport(this, this.data.resultReportImagePath, this.resultReportSignature)
        || typeof base.saveResultReportImage !== 'function') return false
      return base.saveResultReportImage.call(this)
    },
  }
}

module.exports = {
  cancelCameraReportUi,
  createCameraReportUiData,
  createCameraReportUiMethods,
}

const { vibrate } = require('../../utils/haptics')
const { previewGeneratedImage } = require('../../utils/report-image-actions')

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

function rectOf(value) {
  if (!value?.rect || typeof value.rect !== 'object') return value
  return {
    ...value.rect,
    width: value.rect.width ?? value.width,
    height: value.rect.height ?? value.height,
  }
}

function styleNumber(value, name, fallback) {
  const style = value?.computedStyle || value || {}
  const number = Number.parseFloat(style[name])
  return Number.isFinite(number) ? number : fallback
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
      if (!path || !signature || this.resultReportSignature !== signature) {
        return base.generateResultReportImage.call(this)
      }

      const inputRevision = this._inputRevision || 0
      const revision = bump(this, '_cameraReportCacheCheckRevision')
      cancelPreviewClose(this)
      bump(this, '_cameraReportPreviewLayoutRevision')
      this.setData({
        isCheckingResultReportCache: true,
        resultReportPreviewClosing: false,
        resultReportPreviewStyle: '',
      })

      const isCurrent = () => this._cameraReportCacheCheckRevision === revision
        && (this._inputRevision || 0) === inputRevision
        && isCurrentReport(this, path, signature)
      const openCached = () => {
        if (!isCurrent()) return
        this._cameraReportCacheCheckRevision = 0
        vibrate('light')
        this.setData({
          isCheckingResultReportCache: false,
          resultReportPreviewVisible: true,
          resultReportPreviewClosing: false,
          resultReportPreviewStyle: '',
        }, () => this.updateResultReportPreviewLayout())
      }
      const regenerate = () => {
        if (this._cameraReportCacheCheckRevision !== revision
          || (this._inputRevision || 0) !== inputRevision
          || !isPageActive(this) || currentSignature(this) !== signature) return
        this._cameraReportCacheCheckRevision = 0
        cancelPreviewClose(this)
        this.resultReportSignature = ''
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
      return {
        ...hiddenPreviewChanges(this),
        resultReportImagePath: '',
      }
    },

    updateResultReportPreviewLayout() {
      const path = this.data?.resultReportImagePath
      const signature = this.resultReportSignature
      const inputRevision = this._inputRevision || 0
      if (!isPageActive(this) || !this.data?.resultReportPreviewVisible
        || this.data.resultReportPreviewClosing || !path || !signature
        || currentSignature(this) !== signature) return false

      const revision = bump(this, '_cameraReportPreviewLayoutRevision')
      if (this.data.resultReportPreviewStyle) this.setData({ resultReportPreviewStyle: '' })
      if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return false

      const nodes = {}
      let query
      try {
        query = wx.createSelectorQuery().in(this)
        const read = (selector, styles = []) => {
          const selection = query.select(selector)
          const callback = (value) => { nodes[selector] = value }
          if (typeof selection.fields === 'function') {
            selection.fields({ rect: true, size: true, computedStyle: styles }, callback)
          } else {
            selection.boundingClientRect(callback)
          }
        }
        read('.page-root')
        read('.result-report-preview-overlay', ['paddingTop', 'paddingBottom'])
        read('.result-report-preview-sheet', ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'])
        read('.result-report-preview-header')
        read('.result-report-preview-actions')
        read('.result-report-preview-scroll', [
          'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
        ])
        read('.result-report-preview-image')
      } catch (error) {
        return false
      }

      const current = () => revision === this._cameraReportPreviewLayoutRevision
        && isCurrentReport(this, path, signature)
        && (this._inputRevision || 0) === inputRevision
        && this.data.resultReportPreviewVisible && !this.data.resultReportPreviewClosing
      try {
        query.exec(() => {
          if (!current()) return
          const root = rectOf(nodes['.page-root'])
          const overlay = rectOf(nodes['.result-report-preview-overlay'])
          const sheet = rectOf(nodes['.result-report-preview-sheet'])
          const header = rectOf(nodes['.result-report-preview-header'])
          const actions = rectOf(nodes['.result-report-preview-actions'])
          const scroll = rectOf(nodes['.result-report-preview-scroll'])
          const image = rectOf(nodes['.result-report-preview-image'])
          const rootTop = Number(root?.top) || 0
          const rootHeight = Number(root?.height) || 0
          const overlayTop = Number(overlay?.top)
          const overlayHeight = Number(overlay?.height)
          const viewportTop = Math.max(rootTop, Number.isFinite(overlayTop) ? overlayTop : rootTop)
          const rootBottom = rootTop + rootHeight
          const overlayBottom = Number.isFinite(overlay?.bottom)
            ? overlay.bottom
            : (Number.isFinite(overlayHeight)
              ? (Number.isFinite(overlayTop) ? overlayTop : rootTop) + overlayHeight
              : rootBottom)
          const viewportBottom = Math.min(rootBottom || overlayBottom, overlayBottom)
          const viewportHeight = Math.max(0, viewportBottom - viewportTop)
          const scale = (Number(root?.width) || 390) / 750
          const overlayPaddingTop = styleNumber(nodes['.result-report-preview-overlay'], 'paddingTop', 32 * scale)
          const overlayPaddingBottom = styleNumber(nodes['.result-report-preview-overlay'], 'paddingBottom', 16 * scale)
          const sheetRectHeight = Number(sheet?.height) || 0
          const sheetTopGap = sheetRectHeight > 0 ? Math.max(0, Number(sheet.top) - viewportTop) : 0
          const sheetBottomGap = sheetRectHeight > 0 ? Math.max(0, viewportBottom - Number(sheet.bottom)) : 0
          const sheetSweepHeight = sheetRectHeight + sheetTopGap + sheetBottomGap
          const availableSheetHeight = Math.max(0, Math.min(viewportHeight,
            sheetSweepHeight > 0 ? sheetSweepHeight : viewportHeight)
            - overlayPaddingTop - overlayPaddingBottom)
          const sheetBorders = styleNumber(nodes['.result-report-preview-sheet'], 'borderTopWidth', 1)
            + styleNumber(nodes['.result-report-preview-sheet'], 'borderBottomWidth', 1)
          const fixedHeight = styleNumber(nodes['.result-report-preview-sheet'], 'paddingTop', 20 * scale)
            + styleNumber(nodes['.result-report-preview-sheet'], 'paddingBottom', 16 * scale)
            + sheetBorders + (Number(header?.height) || 0) + (Number(actions?.height) || 0)
          const availableScrollHeight = Math.max(0, availableSheetHeight - fixedHeight)
          const scrollBorders = styleNumber(nodes['.result-report-preview-scroll'], 'borderTopWidth', 1)
            + styleNumber(nodes['.result-report-preview-scroll'], 'borderBottomWidth', 1)
          const horizontalBorders = styleNumber(nodes['.result-report-preview-scroll'], 'borderLeftWidth', 1)
            + styleNumber(nodes['.result-report-preview-scroll'], 'borderRightWidth', 1)
          const scrollWidth = Number(scroll?.width) || Math.max(0, (Number(root?.width) || 0) - (76 * scale))
          const imageWidth = Number(image?.width) || Math.max(0, scrollWidth - horizontalBorders)
          const naturalImageHeight = (Number(this.data.resultReportCanvasHeight) || 0)
            * imageWidth / (Number(this.data.resultReportCanvasWidth) || 750)
          if (!viewportHeight || !availableSheetHeight || !imageWidth || !naturalImageHeight) return
          const scrollHeight = Math.min(naturalImageHeight + scrollBorders, availableScrollHeight)
          const nextStyle = '--camera-report-sheet-max-height:' + Math.round(availableSheetHeight * 100) / 100
            + 'px;--camera-report-scroll-height:' + Math.round(scrollHeight * 100) / 100 + 'px'
          if (this.data.resultReportPreviewStyle !== nextStyle) {
            this.setData({ resultReportPreviewStyle: nextStyle })
          }
        })
      } catch (error) {
        return false
      }
      return true
    },

    closeResultReportPreview(immediate) {
      if (!this.data?.resultReportPreviewVisible
        || (this.data.resultReportPreviewClosing && immediate !== true)) return false
      vibrate('light')
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
        if (!previewGeneratedImage(path)) {
          showToast('原图预览暂不可用，请重试')
          return
        }
        vibrate('light')
      }
      const invalidate = () => {
        if (!isCurrent()) return
        this.resultReportSignature = ''
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
      return base.shareResultReportImage.call(this)
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

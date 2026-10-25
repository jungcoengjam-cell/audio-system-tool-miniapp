const { vibrate } = require('./haptics')
const { startMeasurement } = require('./performance')
const {
  previewGeneratedImage,
  saveGeneratedImage,
  shareGeneratedImage,
} = require('./report-image-actions')
const {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  buildResultReportPayload,
  calculateResultReportHeight,
  drawResultReport,
  getExportDimensions,
} = require('./result-report')

function createResultReportData() {
  return {
    resultReportCanvasWidth: REPORT_WIDTH,
    resultReportCanvasHeight: 1250,
    resultReportImagePath: '',
    resultReportPreviewVisible: false,
    isGeneratingResultReport: false,
  }
}

function buildResultReportSignature(record) {
  return record ? [record.module, record.title, record.summary, record.resultText].join('|') : ''
}

function cancelResultReportGeneration(page) {
  page.resultReportRevision = (page.resultReportRevision || 0) + 1
  page.resultReportPendingSignature = ''
  const wasGenerating = Boolean(page.data && page.data.isGeneratingResultReport)
  if (wasGenerating && typeof wx.hideLoading === 'function') wx.hideLoading()
  if (wasGenerating && typeof page.setData === 'function') page.setData({ isGeneratingResultReport: false })
}

function resetStaleResultReport(page, record) {
  const nextSignature = buildResultReportSignature(record)
  const currentSignature = page.resultReportPendingSignature || page.resultReportSignature
  if (!currentSignature || currentSignature === nextSignature) return {}

  cancelResultReportGeneration(page)
  page.resultReportSignature = ''
  return {
    resultReportImagePath: '',
    resultReportPreviewVisible: false,
    isGeneratingResultReport: false,
  }
}

function resolveResultReportRecord(page) {
  return typeof page.buildResultReportRecord === 'function'
    ? page.buildResultReportRecord()
    : page.getRecordPayload()
}

function createResultReportMethods(options = {}) {
  const performancePrefix = options.performancePrefix || '计算结果'
  const emptyToast = options.emptyToast || '暂无可生成的计算结果'

  return {
    getResultReportSignature(record = resolveResultReportRecord(this)) {
      return buildResultReportSignature(record)
    },

    finishResultReportGeneration(revision, changes = {}) {
      if (this.resultReportRevision !== revision) return
      if (typeof wx.hideLoading === 'function') wx.hideLoading()
      this.resultReportPendingSignature = ''
      this.setData({ isGeneratingResultReport: false, ...changes })
    },

    generateResultReportImage() {
      const record = resolveResultReportRecord(this)
      const payload = buildResultReportPayload(record)
      if (!payload || this.data.isGeneratingResultReport) {
        if (!payload) wx.showToast({ title: emptyToast, icon: 'none' })
        return
      }

      const signature = this.getResultReportSignature(record)
      if (this.data.resultReportImagePath && this.resultReportSignature === signature) {
        vibrate('light')
        this.setData({ resultReportPreviewVisible: true })
        return
      }
      if (typeof wx.createCanvasContext !== 'function'
        || typeof wx.canvasToTempFilePath !== 'function') {
        wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
        return
      }

      vibrate('medium')
      const resultReportCanvasHeight = calculateResultReportHeight(payload)
      const revision = (this.resultReportRevision || 0) + 1
      this.resultReportRevision = revision
      this.resultReportPendingSignature = signature
      this.setData({
        resultReportCanvasHeight,
        isGeneratingResultReport: true,
        resultReportPreviewVisible: false,
      }, () => {
        if (this.resultReportRevision !== revision) return
        if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })
        try {
          const context = wx.createCanvasContext(REPORT_CANVAS_ID, this)
          const finishDrawing = startMeasurement(`${performancePrefix}/结果图绘制`)
          drawResultReport(context, payload, resultReportCanvasHeight)
          finishDrawing({ height: resultReportCanvasHeight })
          context.draw(false, () => {
            if (this.resultReportRevision !== revision) return
            const exportDimensions = getExportDimensions(resultReportCanvasHeight)
            const finishExport = startMeasurement(`${performancePrefix}/结果图导出`, exportDimensions)
            wx.canvasToTempFilePath({
              canvasId: REPORT_CANVAS_ID,
              width: REPORT_WIDTH,
              height: resultReportCanvasHeight,
              ...exportDimensions,
              fileType: 'png',
              quality: 1,
              success: ({ tempFilePath }) => {
                if (this.resultReportRevision !== revision) return
                finishExport({ success: Boolean(tempFilePath) })
                if (!tempFilePath) {
                  this.finishResultReportGeneration(revision)
                  wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
                  return
                }
                this.resultReportSignature = signature
                this.finishResultReportGeneration(revision, {
                  resultReportImagePath: tempFilePath,
                  resultReportPreviewVisible: true,
                })
              },
              fail: () => {
                if (this.resultReportRevision !== revision) return
                finishExport({ success: false })
                this.finishResultReportGeneration(revision)
                wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
              },
            }, this)
          })
        } catch (error) {
          this.finishResultReportGeneration(revision)
          wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
        }
      })
    },

    closeResultReportPreview() {
      vibrate('light')
      this.setData({ resultReportPreviewVisible: false })
    },

    preventTouchMove() {},

    stopTap() {},

    previewResultReportImage() {
      previewGeneratedImage(this.data.resultReportImagePath)
    },

    shareResultReportImage() {
      shareGeneratedImage(this.data.resultReportImagePath)
    },

    saveResultReportImage() {
      saveGeneratedImage(this.data.resultReportImagePath)
    },
  }
}

module.exports = {
  buildResultReportSignature,
  cancelResultReportGeneration,
  createResultReportData,
  createResultReportMethods,
  resetStaleResultReport,
}

'use strict'

const nativeImagePreview = require('../native-image-preview')
const { startMeasurement } = require('../../utils/performance')
const { vibrate } = require('../../utils/haptics')
const { isPageContextCurrent: isCurrentPageContext } = require('../../utils/report-image-actions')
const { drawAndExportReport } = require('../../utils/report-canvas')
const { buildResultReportSignature, cancelResultReportGeneration } = require('../../utils/result-report-controller')
const {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  buildResultReportPayload,
  calculateResultReportHeight,
  drawResultReport,
  getExportDimensions,
} = require('../../utils/result-report')
const { getResultImageTheme } = require('../result-image-theme')

const DARK_RESULT_REPORT_COLOR_MAP = Object.freeze({
  '#f5f5f7': '#000000',
  '#ffffff': '#1c1c1e',
  '#1d1d1f': '#f5f5f7',
  '#6e6e73': '#c5c5cb',
  '#8e8e93': '#aeaeb2',
  '#e5e5ea': '#38383a',
  '#007aff': '#59adff',
  '#eef6ff': '#15273b',
  '#27b7ca': '#4dd0df',
  '#eaf9fb': '#12363b',
  '#fff7e8': '#302616',
  '#9a5b00': '#ffb340',
  '#7a5421': '#e6c98d',
})

const DRAW_METHODS = [
  'setFillStyle',
  'fillRect',
  'beginPath',
  'moveTo',
  'lineTo',
  'quadraticCurveTo',
  'closePath',
  'fill',
  'setStrokeStyle',
  'setLineWidth',
  'stroke',
  'setTextAlign',
  'fillText',
  'measureText',
]

function mapResultReportThemeColor(color) {
  if (typeof color !== 'string') return color
  return DARK_RESULT_REPORT_COLOR_MAP[color.toLowerCase()] || color
}

function createDarkResultReportContext(context) {
  const facade = {}

  DRAW_METHODS.forEach((methodName) => {
    if (methodName === 'setFillStyle' || methodName === 'setStrokeStyle') {
      facade[methodName] = function setColorStyle(color, ...args) {
        return context[methodName](mapResultReportThemeColor(color), ...args)
      }
      return
    }
    facade[methodName] = function delegateCanvasMethod(...args) {
      return context[methodName](...args)
    }
  })

  Object.defineProperty(facade, 'font', {
    enumerable: true,
    get() { return context.font },
    set(value) { context.font = value },
  })

  return facade
}

function createResultReportThemeContext(context, theme = 'light') {
  if (theme !== 'dark') return context
  return createDarkResultReportContext(context)
}

function resolveRecord(page) {
  return typeof page.buildResultReportRecord === 'function'
    ? page.buildResultReportRecord()
    : page.getRecordPayload()
}

function getSignature(page, record) {
  return typeof page.getResultReportSignature === 'function'
    ? page.getResultReportSignature(record)
    : buildResultReportSignature(record)
}

function createDmxAddressResultReportThemeController(options = {}) {
  const resultReportMethods = options.resultReportMethods || {}
  const readTheme = options.getTheme || getResultImageTheme
  const performancePrefix = options.performancePrefix || 'DMX'
  const emptyToast = options.emptyToast || '暂无可生成的编址结果'

  const currentTheme = () => {
    try { return readTheme() === 'dark' ? 'dark' : 'light' } catch (error) { return 'light' }
  }

  return {
    generateResultReportImage() {
      const record = resolveRecord(this)
      const payload = buildResultReportPayload(record)
      if (!payload || this.data.isGeneratingResultReport) {
        if (!payload) wx.showToast({ title: emptyToast, icon: 'none' })
        return
      }

      const signature = getSignature(this, record)
      const theme = currentTheme()
      if (this.data.resultReportImagePath && this.resultReportSignature === signature
        && this._resultReportImageTheme === theme) {
        const shouldNotifyOpen = !this.data.resultReportPreviewVisible
        const revision = this.resultReportRevision || 0
        this.setData({ resultReportPreviewVisible: true }, () => {
          if (shouldNotifyOpen && this.resultReportRevision === revision
            && this.data.resultReportPreviewVisible && this._resultReportImageTheme === theme
            && currentTheme() === theme && isCurrentPageContext(this)) vibrate('light')
        })
        return
      }

      if (typeof wx.createCanvasContext !== 'function'
        || typeof wx.canvasToTempFilePath !== 'function') {
        wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
        return
      }

      const height = calculateResultReportHeight(payload)
      const revision = (this.resultReportRevision || 0) + 1
      this.resultReportRevision = revision
      this.resultReportPendingSignature = signature
      let settled = false
      const finish = (changes = {}) => {
        if (settled || this.resultReportRevision !== revision) return false
        settled = true
        resultReportMethods.finishResultReportGeneration.call(this, revision, changes)
        return true
      }
      const isCurrent = () => {
        if (this.resultReportRevision !== revision) return false
        const current = this.resultReportPendingSignature === signature
          && getSignature(this) === signature
          && this._pageVisible !== false && this._pageAlive !== false && !this._isUnloaded
          && currentTheme() === theme
        if (current) return true
        finish()
        return false
      }

      this.setData({
        resultReportCanvasHeight: height,
        isGeneratingResultReport: true,
        resultReportPreviewVisible: false,
      }, () => {
        if (this.resultReportRevision !== revision || settled || !isCurrent()) return
        if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })
        try {
          drawAndExportReport(this, {
            canvasId: REPORT_CANVAS_ID,
            isCurrent,
            width: REPORT_WIDTH,
            height,
            draw: (context) => {
              const finishDrawing = startMeasurement(`${performancePrefix}/结果图绘制`)
              drawResultReport(createResultReportThemeContext(context, theme), payload, height)
              finishDrawing({ height })
            },
            getExportOptions: () => getExportDimensions(height),
            startExportMeasurement: (dimensions) => startMeasurement(`${performancePrefix}/结果图导出`, dimensions),
            onSuccess: (tempFilePath) => {
              if (!isCurrent() || !tempFilePath || !finish({
                resultReportImagePath: tempFilePath,
                resultReportPreviewVisible: true,
              })) return
              this.resultReportSignature = signature
              this._resultReportImageTheme = theme
              if (!this.resultReportPendingSignature && isCurrentPageContext(this)) vibrate('medium')
            },
            onFailure: () => {
              if (finish()) wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
            },
          })
        } catch (error) {
          if (finish()) wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
        }
      })
    },

    cancelResultReportImageGeneration() {
      cancelResultReportGeneration(this)
    },
  }
}

function createDmxAddressResultReportUiMethods(dependencies = {}) {
const { resultReportMethods, isPageContextCurrent, vibrate } = dependencies
const themedResultReportMethods = createDmxAddressResultReportThemeController({ resultReportMethods })
return {
buildResultReportRecord(result = this._calculationResult, preferences = this.getPreferences()) {
if (!result?.valid) return null
const resultText = result.groups.map((group) => {
const firstFixture = group.fixtures[0]
const lastFixture = group.fixtures[group.fixtures.length - 1]
const endAddress = lastFixture.rangeText.split('–').pop()
const groupDomain = result.allocationMode === 'manual' ? ` · ${group.targetUniverse}域` : ''
return `${group.groupIndex + 1}. ${group.name} · ${group.fixtureCount} 台 × ${group.channelCount} CH${groupDomain} · ${firstFixture.addressText} → ${endAddress}`
}).join('\n')
return {
module: 'dmxAddress',
title: `${result.modeText} · ${result.totalGroups} 组 · ${result.totalFixtures} 台灯具`,
summary: `${result.modeText} · ${result.startText} → ${result.endText} · 下一可用 ${result.nextText}`,
preferences,
resultText,
}
},
...resultReportMethods,
generateResultReportImage() {
this.openSheetModal('resultReportPreview', 'resultReportPreviewClosing')
return themedResultReportMethods.generateResultReportImage.call(this)
},
closeResultReportPreview() {
nativeImagePreview.cancel(this)
this.cancelSheetClose('resultReportPreview', 'resultReportPreviewClosing')
return resultReportMethods.closeResultReportPreview.call(this)
},
onUserCloseResultReportPreview() {
if (!this.data.resultReportPreviewVisible || this.data.resultReportPreviewClosing) return
nativeImagePreview.cancel(this)
if (isPageContextCurrent(this)) vibrate('light')
this.beginSheetClose('resultReportPreview', 'resultReportPreviewClosing', () => this.closeResultReportPreview())
},
previewResultReportImage() {
if (this.data.resultReportPreviewClosing) return
return nativeImagePreview.preview(this, this.data.resultReportImagePath, () => {
if (typeof this.clearSheetCloseTimer === 'function') this.clearSheetCloseTimer('resultReportPreview')
this.setData({ resultReportPreviewVisible: false, resultReportPreviewClosing: false })
})
},
shareResultReportImage() {
if (this.data.resultReportPreviewClosing) return
return nativeImagePreview.share(this, this.data.resultReportImagePath,
(path) => resultReportMethods.shareResultReportImage.call(this), () => {
if (typeof this.clearSheetCloseTimer === 'function') this.clearSheetCloseTimer('resultReportPreview')
this.setData({ resultReportPreviewVisible: false, resultReportPreviewClosing: false })
})
},
saveResultReportImage() {
if (this.data.resultReportPreviewClosing) return
return resultReportMethods.saveResultReportImage.call(this)
}
}
}

module.exports = {
  DARK_RESULT_REPORT_COLOR_MAP,
  createDmxAddressResultReportThemeController,
  createDmxAddressResultReportUiMethods,
  createResultReportThemeContext,
  mapResultReportThemeColor,
}

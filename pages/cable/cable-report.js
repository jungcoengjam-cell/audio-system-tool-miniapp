const { vibrate } = require('../../utils/haptics')
const { startMeasurement } = require('../../utils/performance')
const { drawAndExportReport } = require('../../utils/report-canvas')
const { getExportDimensions, roundedRect, strokeRoundedRect } = require('../../utils/report-drawing')
const nativeImagePreview = require('../native-image-preview')
const { getResultImageTheme } = require('../result-image-theme')
const {
  isPageContextCurrent,
  saveGeneratedImage,
  shareGeneratedImage,
} = require('../../utils/report-image-actions')

const REPORT_CANVAS_ID = 'resultReportCanvas'
const REPORT_WIDTH = 750
const PREVIEW_CLOSE_DURATION = 320
const SIDE_MARGIN = 44
const CARD_WIDTH = REPORT_WIDTH - (SIDE_MARGIN * 2)
const CARD_PADDING = 28
const CONTENT_WIDTH = CARD_WIDTH - (CARD_PADDING * 2)
const COLORS = {
  background: '#f5f7f6',
  mint: '#eaf7f5',
  blue: '#eef6ff',
  warning: '#fff5e8',
  text: '#1d1d1f',
  accent: '#087f70',
  secondary: '#5f6869',
  tertiary: '#778181',
  line: '#d8e5e2',
  warningText: '#80530f',
  mintBorder: '#c5e5de',
  blueBorder: '#d6e5f4',
  card: '#ffffff',
  parameterLine: '#e4e8e8',
  warningBorder: '#f0d4ad',
}
const DARK_COLORS = {
  background: '#000000',
  mint: '#123a34',
  blue: '#14283a',
  warning: '#302616',
  text: '#f5f5f7',
  accent: '#54d6bb',
  secondary: '#c5c5cb',
  tertiary: '#aeaeb2',
  line: '#38383a',
  warningText: '#ffd18a',
  mintBorder: '#2d6257',
  blueBorder: '#33465c',
  card: '#1c1c1e',
  parameterLine: '#38383a',
  warningBorder: '#684c24',
}

function fontString(size, weight = 400) {
  return `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`
}

function wrapMeasuredText(context, value, maxWidth, size, weight = 400) {
  context.font = fontString(size, weight)
  const paragraphs = String(value === undefined || value === null ? '' : value).split(/\r?\n/)
  const lines = []
  paragraphs.forEach((paragraph) => {
    let line = ''
    for (const character of [...paragraph]) {
      const candidate = line + character
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = character
      } else {
        line = candidate
      }
    }
    lines.push(line)
  })
  return lines.length ? lines : ['']
}

function getAreaText(result) {
  return result.selectedArea ? `${result.selectedArea} mm²` : '— mm²'
}

function buildCableReportPayload(state = {}) {
  const result = state.result
  if (!result) return null

  const isConstant = result.type === 'constant'
  const powerText = isConstant ? state.constantPowerText : state.professionalPowerText
  const environment = isConstant
    ? state.environments?.[state.environmentIndex]?.label || '—'
    : ''
  const parameters = [
    ['输入总功率', `${powerText} W`],
    ['最远单程距离', `${result.distanceMeters} m`],
    ...(isConstant ? [['敷设环境', environment]] : []),
    ['设计带载功率', `${result.designPowerW} W`],
    ['采用档位', isConstant
      ? `${result.distanceBracket} / ${result.powerBracket || '表外'}`
      : `按设计带载功率 ${result.designPowerW} W 对照公司表格选档`],
  ]
  const secondary = isConstant
    ? [
      { label: '单芯截面积', value: getAreaText(result) },
      { label: '公司公式校核下限', value: `${result.formulaMinimumArea} mm²` },
    ]
    : [
      { label: '单芯截面积', value: getAreaText(result) },
      { label: '对应线材载流量', value: result.currentA ? `${result.currentA} A` : '— A' },
    ]

  return {
    title: '线材选型',
    primaryLabel: result.isWithinStandard ? '推荐线材' : '工程复核用选型参考',
    spec: result.spec,
    description: result.description,
    secondary,
    parameters,
    warnings: [...(result.warnings || [])],
  }
}


function buildCableReportLayout(context, payload) {
  const layout = { sections: [], height: 0 }
  let y = 42

  const titleLines = wrapMeasuredText(context, payload.title, CARD_WIDTH, 30, 650)
  layout.sections.push({ type: 'title', y, lines: titleLines, lineHeight: 38 })
  y += (titleLines.length * 38) + 24

  const mainLabelLines = wrapMeasuredText(context, payload.primaryLabel, CONTENT_WIDTH - 48, 23, 650)
  const specLines = wrapMeasuredText(context, payload.spec, CONTENT_WIDTH - 48, 72, 700)
  const descriptionLines = wrapMeasuredText(context, payload.description, CONTENT_WIDTH - 48, 22, 400)
  const mainHeight = 26 + (mainLabelLines.length * 32) + 10
    + (specLines.length * 84) + 12 + (descriptionLines.length * 32) + 26
  layout.sections.push({
    type: 'main', y, height: mainHeight, labelLines: mainLabelLines,
    specLines, descriptionLines,
  })
  y += mainHeight + 18

  const metricGap = 12
  const metricWidth = (CONTENT_WIDTH - metricGap) / 2
  const metrics = payload.secondary.map((metric, index) => {
    const innerWidth = metricWidth - 36
    const labelLines = wrapMeasuredText(context, metric.label, innerWidth, 24, 600)
    const valueLines = wrapMeasuredText(context, metric.value, innerWidth, 30, 650)
    const contentHeight = (labelLines.length * 32) + 10 + (valueLines.length * 40)
    return {
      ...metric,
      x: SIDE_MARGIN + (index * (metricWidth + metricGap)),
      width: metricWidth,
      labelLines,
      valueLines,
      contentHeight,
    }
  })
  const metricsHeight = Math.max(144, ...metrics.map((metric) => metric.contentHeight + 44))
  layout.sections.push({ type: 'metrics', y, height: metricsHeight, metrics })
  y += metricsHeight + 26

  const labelWidth = 228
  const columnGap = 16
  const valueWidth = CONTENT_WIDTH - 48 - labelWidth - columnGap
  const parameterRows = payload.parameters.map(([label, value]) => {
    const labelLines = wrapMeasuredText(context, label, labelWidth, 26, 650)
    const valueLines = wrapMeasuredText(context, value, valueWidth, 26, 500)
    const lineCount = Math.max(labelLines.length, valueLines.length)
    return { labelLines, valueLines, lineHeight: 36, height: (lineCount * 36) + 28 }
  })
  const parameterTitleLines = wrapMeasuredText(context, '输入参数', CONTENT_WIDTH, 32, 650)
  const parameterTitleHeight = (parameterTitleLines.length * 40) + 10
  const parameterCardHeight = parameterRows.reduce((total, row) => total + row.height, 0)
  layout.sections.push({
    type: 'parameters', y, height: parameterTitleHeight + parameterCardHeight,
    titleLines: parameterTitleLines,
    cardY: y + parameterTitleHeight,
    cardHeight: parameterCardHeight,
    labelX: SIDE_MARGIN + 24,
    valueX: SIDE_MARGIN + 24 + labelWidth + columnGap,
    parameterRows,
  })
  y += parameterTitleHeight + parameterCardHeight + 18

  if (payload.warnings.length) {
    const warningLines = payload.warnings.map((warning) => wrapMeasuredText(
      context, '注意：' + warning, CONTENT_WIDTH - 48, 21, 500,
    ))
    const warningHeight = 24 + 24
      + warningLines.reduce((total, lines) => total + (lines.length * 30) + 12, 0)
      + 24
    layout.sections.push({
      type: 'warnings', y, height: warningHeight,
      title: '工程复核条件', warningLines,
    })
    y += warningHeight + 18
  }

  layout.height = Math.ceil(y + 28)
  return layout
}

function setTextStyle(context, size, color, weight = 400, align = 'left') {
  context.font = fontString(size, weight)
  context.setFillStyle(color)
  context.setTextAlign(align)
}

function drawLines(context, lines, x, y, lineHeight, size, color, weight = 400, align = 'left') {
  setTextStyle(context, size, color, weight, align)
  lines.forEach((line, index) => context.fillText(line, x, y + (index * lineHeight)))
}

function drawCableReport(context, payload, layout, theme = 'light') {
  const colors = theme === 'dark' ? DARK_COLORS : COLORS
  context.setFillStyle(colors.background)
  context.fillRect(0, 0, REPORT_WIDTH, layout.height)

  layout.sections.forEach((section) => {
    if (section.type === 'title') {
      drawLines(context, section.lines, SIDE_MARGIN, section.y + 30, section.lineHeight, 30, colors.text, 650)
      return
    }

    if (section.type === 'main') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, colors.mint)
      strokeRoundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, colors.mintBorder)
      const center = REPORT_WIDTH / 2
      let lineY = section.y + 26
      drawLines(context, section.labelLines, center, lineY + 23, 32, 23, colors.accent, 650, 'center')
      lineY += (section.labelLines.length * 32) + 10
      drawLines(context, section.specLines, center, lineY + 72, 84, 72, colors.text, 700, 'center')
      lineY += (section.specLines.length * 84) + 12
      drawLines(context, section.descriptionLines, center, lineY + 22, 32, 22, colors.secondary, 400, 'center')
      return
    }

    if (section.type === 'metrics') {
      section.metrics.forEach((metric) => {
        roundedRect(context, metric.x, section.y, metric.width, section.height, 22, colors.blue)
        strokeRoundedRect(context, metric.x, section.y, metric.width, section.height, 22, colors.blueBorder)
        const center = metric.x + (metric.width / 2)
        let metricY = section.y + ((section.height - metric.contentHeight) / 2)
        drawLines(context, metric.labelLines, center, metricY + 24, 32, 24, colors.secondary, 600, 'center')
        metricY += (metric.labelLines.length * 32) + 10
        drawLines(context, metric.valueLines, center, metricY + 30, 40, 30, colors.text, 650, 'center')
      })
      return
    }

    if (section.type === 'parameters') {
      drawLines(context, section.titleLines, SIDE_MARGIN, section.y + 32, 40, 32, colors.text, 650)
      roundedRect(context, SIDE_MARGIN, section.cardY, CARD_WIDTH, section.cardHeight, 22, colors.card)
      strokeRoundedRect(context, SIDE_MARGIN, section.cardY, CARD_WIDTH, section.cardHeight, 22, colors.line)
      let rowY = section.cardY
      section.parameterRows.forEach((row, index) => {
        drawLines(context, row.labelLines, section.labelX, rowY + 14 + 26,
          row.lineHeight, 26, colors.secondary, 650)
        drawLines(context, row.valueLines, section.valueX, rowY + 14 + 26,
          row.lineHeight, 26, colors.text, 500)
        rowY += row.height
        if (index < section.parameterRows.length - 1) {
          context.beginPath()
          context.moveTo(SIDE_MARGIN + 18, rowY)
          context.lineTo(SIDE_MARGIN + CARD_WIDTH - 18, rowY)
          context.setStrokeStyle(colors.parameterLine)
          context.setLineWidth(1)
          context.stroke()
        }
      })
      return
    }

    if (section.type === 'warnings') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, colors.warning)
      strokeRoundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, colors.warningBorder)
      const x = SIDE_MARGIN + CARD_PADDING
      let lineY = section.y + 24
      if (section.warningLines.length) {
        drawLines(context, [section.title], x, lineY + 18, 22, 18, colors.warningText, 650)
        lineY += 22 + 8
        section.warningLines.forEach((lines) => {
          drawLines(context, lines, x, lineY + 18, 30, 21, colors.warningText, 400)
          lineY += (lines.length * 30) + 12
        })
      }
    }
  })
}

function cancelReportPreviewClose(page) {
  if (page._reportPreviewCloseTimer != null) clearTimeout(page._reportPreviewCloseTimer)
  page._reportPreviewCloseTimer = null
}

function buildReportSignature(record) {
  return record ? [record.module, record.title, record.summary, record.resultText].join('|') : ''
}

function createCableReportMethods() {
  return {
    getResultReportSignature(record = this.getRecordPayload()) {
      return buildReportSignature(record)
    },

    finishResultReportGeneration(revision, changes = {}) {
      if (this.resultReportRevision !== revision) return
      if (typeof wx.hideLoading === 'function') wx.hideLoading()
      this.resultReportPendingSignature = ''
      const updates = { isGeneratingResultReport: false, ...changes }
      if (changes.resultReportPreviewVisible) {
        cancelReportPreviewClose(this)
        updates.resultReportPreviewClosing = false
      }
      this.setData(updates, () => {
        if (changes.resultReportPreviewVisible) this.updateResultReportPreviewLayout()
      })
    },

    generateResultReportImage() {
      if (typeof this.flushInputCalculation === 'function') this.flushInputCalculation()
      const record = this.getRecordPayload()
      const payload = buildCableReportPayload(this.data)
      if (!payload || !record || this.data.inputPending || this.data.isGeneratingResultReport
        || this.data.isCheckingResultReportCache) {
        if (!payload || !record) wx.showToast({ title: '暂无可生成的选型结果', icon: 'none' })
        return
      }

      const signature = this.getResultReportSignature(record)
      const theme = getResultImageTheme()
      const inputRevision = this._inputRevision || 0
      const reopeningPreview = this.data.resultReportPreviewVisible && this.data.resultReportPreviewClosing
      const wasPreviewVisible = Boolean(this.data.resultReportPreviewVisible)
      cancelReportPreviewClose(this)
      this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      if (this.data.resultReportImagePath && this.resultReportSignature === signature
        && this._resultReportImageTheme === theme) {
        const cachedPath = this.data.resultReportImagePath
        const revision = (this.resultReportRevision || 0) + 1
        this.resultReportRevision = revision
        this._reportCacheCheckRevision = revision
        this.setData({
          isCheckingResultReportCache: true,
          resultReportPreviewVisible: reopeningPreview,
          resultReportPreviewClosing: false,
        }, () => {
          const cacheCheckCurrent = () => !this._isUnloaded
            && this._reportCacheCheckRevision === revision
            && this.resultReportRevision === revision
            && (this._inputRevision || 0) === inputRevision
            && this.getResultReportSignature(this.getRecordPayload()) === signature
          const retryWithCurrentTheme = () => {
            if (!cacheCheckCurrent()) return
            this._reportCacheCheckRevision = 0
            this.setData({ isCheckingResultReportCache: false }, () => {
              if (!this._isUnloaded && this.resultReportRevision === revision
                && (this._inputRevision || 0) === inputRevision
                && this.getResultReportSignature(this.getRecordPayload()) === signature) {
                this.generateResultReportImage()
              }
            })
          }
          const showCached = () => {
            if (!cacheCheckCurrent()) return
            if (getResultImageTheme() !== theme) return retryWithCurrentTheme()
            this._reportCacheCheckRevision = 0
            cancelReportPreviewClose(this)
            this.setData({ isCheckingResultReportCache: false, resultReportPreviewVisible: true, resultReportPreviewClosing: false }, () => {
              if (!wasPreviewVisible && this.resultReportRevision === revision
                && (this._inputRevision || 0) === inputRevision
                && this.getResultReportSignature(this.getRecordPayload()) === signature
                && isPageContextCurrent(this)) vibrate('light')
              this.updateResultReportPreviewLayout()
            })
          }
          const regenerate = () => {
            if (!cacheCheckCurrent()) return
            this._reportCacheCheckRevision = 0
            this.resultReportSignature = ''
            this.setData({
              isCheckingResultReportCache: false,
              resultReportImagePath: '',
              resultReportPreviewVisible: false,
              resultReportPreviewClosing: false,
            }, () => {
              if (!this._isUnloaded && this.resultReportRevision === revision
                && (this._inputRevision || 0) === inputRevision
                && this.getResultReportSignature(this.getRecordPayload()) === signature) {
                this.generateResultReportImage()
              }
            })
          }
          try {
            const fileSystem = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
            if (!fileSystem || typeof fileSystem.access !== 'function') return showCached()
            fileSystem.access({ path: cachedPath, success: showCached, fail: regenerate })
          } catch (error) {
            regenerate()
          }
        })
        return
      }
      if (typeof wx.createCanvasContext !== 'function'
        || typeof wx.canvasToTempFilePath !== 'function') {
        wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
        return
      }

      let measureContext
      let layout
      try {
        measureContext = wx.createCanvasContext(REPORT_CANVAS_ID, this)
        layout = buildCableReportLayout(measureContext, payload)
      } catch (error) {
        wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
        return
      }

      const revision = (this.resultReportRevision || 0) + 1
      this.resultReportRevision = revision
      this.resultReportPendingSignature = signature
      cancelReportPreviewClose(this)
      this.setData({
        resultReportCanvasWidth: REPORT_WIDTH,
        resultReportCanvasHeight: layout.height,
        isGeneratingResultReport: true,
        resultReportPreviewVisible: false,
        resultReportPreviewClosing: false,
      }, () => {
        if (this.resultReportRevision !== revision) return
        const generationCurrent = () => !this._isUnloaded
          && this.resultReportRevision === revision
          && (this._inputRevision || 0) === inputRevision
          && this.getResultReportSignature(this.getRecordPayload()) === signature
        const isCurrent = () => {
          if (!generationCurrent()) return false
          if (getResultImageTheme() === theme) return true
          this.finishResultReportGeneration(revision)
          return false
        }
        if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })
        try {
          drawAndExportReport(this, {
            canvasId: REPORT_CANVAS_ID,
            isCurrent,
            width: REPORT_WIDTH,
            height: layout.height,
            draw: (context) => {
              const finishDrawing = startMeasurement('线材选型/结果图绘制')
              drawCableReport(context, payload, layout, theme)
              finishDrawing({ height: layout.height })
            },
            getExportOptions: () => getExportDimensions(layout.height),
            startExportMeasurement: (dimensions) => startMeasurement('线材选型/结果图导出', dimensions),
            onSuccess: (tempFilePath) => {
              if (!isCurrent()) return
              this.resultReportSignature = signature
              this._resultReportImageTheme = theme
              this.finishResultReportGeneration(revision, {
                resultReportImagePath: tempFilePath,
                resultReportPreviewVisible: true,
              })
              if (this.resultReportRevision === revision && !this.resultReportPendingSignature
                && isPageContextCurrent(this)) vibrate('medium')
            },
            onFailure: () => {
              if (!isCurrent()) return
              this.finishResultReportGeneration(revision)
              wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
            },
          })
        } catch (error) {
          if (!isCurrent()) return
          this.finishResultReportGeneration(revision)
          wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
        }
      })
    },

    hideResultReportPreview() {
      nativeImagePreview.cancel(this)
      cancelReportPreviewClose(this)
      this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      this._reportCacheCheckRevision = 0
      return {
        resultReportPreviewVisible: false,
        resultReportPreviewClosing: false,
        resultReportPreviewStyle: '',
        isCheckingResultReportCache: false,
      }
    },

    invalidateResultReportPreview() {
      const hidden = this.hideResultReportPreview()
      this.resultReportSignature = ''
      return {
        ...hidden,
        resultReportImagePath: '',
      }
    },

    updateResultReportPreviewLayout() {
      const path = this.data.resultReportImagePath
      const signature = this.resultReportSignature
      if (!this._pageVisible || this._isUnloaded || !this.data.resultReportPreviewVisible
        || this.data.resultReportPreviewClosing || !path || !signature) return false
      this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      if (this.data.resultReportPreviewStyle) this.setData({ resultReportPreviewStyle: '' })
      return true
    },
    closeResultReportPreview(immediate) {
      if (!this.data.resultReportPreviewVisible
        || (this.data.resultReportPreviewClosing && immediate !== true)) return false
      nativeImagePreview.cancel(this)
      if (immediate !== true && this._pageVisible && !this._isUnloaded && isPageContextCurrent(this)) vibrate('light')
      if (immediate === true || !this._pageVisible || this._isUnloaded) {
        this.setData(this.hideResultReportPreview())
        return true
      }
      const closingRevision = this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      this._reportCacheCheckRevision = 0
      this.setData({ resultReportPreviewClosing: true }, () => {
        if (closingRevision !== this._reportPreviewLayoutRevision
          || !this.data.resultReportPreviewVisible || !this.data.resultReportPreviewClosing) return
        const timer = setTimeout(() => {
          if (this._reportPreviewCloseTimer !== timer || closingRevision !== this._reportPreviewLayoutRevision
            || !this.data.resultReportPreviewVisible || !this.data.resultReportPreviewClosing) return
          this._reportPreviewCloseTimer = null
          this.setData(this.hideResultReportPreview())
        }, PREVIEW_CLOSE_DURATION)
        this._reportPreviewCloseTimer = timer
      })
      return true
    },

    preventTouchMove() {},

    stopTap() {},

    previewResultReportImage() {
      const path = this.data.resultReportImagePath
      if (!path || !this.data.resultReportPreviewVisible || this.data.resultReportPreviewClosing
        || !this._pageVisible || this._isUnloaded) return false
      const signature = this.getResultReportSignature(this.getRecordPayload())
      if (!signature || signature !== this.resultReportSignature) {
        this.setData(this.invalidateResultReportPreview())
        return false
      }
      return nativeImagePreview.preview(this, path,
        () => this.setData(this.hideResultReportPreview()))
    },

    shareResultReportImage() {
      const path = this.data.resultReportImagePath
      if (!path || !this.data.resultReportPreviewVisible || this.data.resultReportPreviewClosing
        || !this._pageVisible || this._isUnloaded) return false
      return nativeImagePreview.share(this, path, shareGeneratedImage,
        () => this.setData(this.hideResultReportPreview()))
    },

    saveResultReportImage() {
      const path = this.data.resultReportImagePath
      if (!path || !this.data.resultReportPreviewVisible || this.data.resultReportPreviewClosing
        || !this._pageVisible || this._isUnloaded) return false
      const signature = this.resultReportSignature
      const inputRevision = this._inputRevision || 0
      saveGeneratedImage(path, {
        isCurrent: () => this._pageVisible && !this._isUnloaded
          && (this._inputRevision || 0) === inputRevision
          && this.data.resultReportImagePath === path
          && this.resultReportSignature === signature
          && this.getResultReportSignature(this.getRecordPayload()) === signature,
      })
      return true
    },
  }
}

module.exports = {
  buildCableReportLayout,
  buildCableReportPayload,
  buildReportSignature,
  createCableReportMethods,
  drawCableReport,
  wrapMeasuredText,
}

const { vibrate } = require('../../utils/haptics')
const { startMeasurement } = require('../../utils/performance')
const { drawAndExportReport } = require('../../utils/report-canvas')
const { getExportDimensions, roundedRect } = require('../../utils/report-drawing')
const {
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

function strokeRoundedRect(context, x, y, width, height, radius, color) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
  context.setStrokeStyle(color)
  context.setLineWidth(1)
  context.stroke()
}

function drawCableReport(context, payload, layout) {
  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, REPORT_WIDTH, layout.height)

  layout.sections.forEach((section) => {
    if (section.type === 'title') {
      drawLines(context, section.lines, SIDE_MARGIN, section.y + 30, section.lineHeight, 30, COLORS.text, 650)
      return
    }

    if (section.type === 'main') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, COLORS.mint)
      strokeRoundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, '#c5e5de')
      const center = REPORT_WIDTH / 2
      let lineY = section.y + 26
      drawLines(context, section.labelLines, center, lineY + 23, 32, 23, COLORS.accent, 650, 'center')
      lineY += (section.labelLines.length * 32) + 10
      drawLines(context, section.specLines, center, lineY + 72, 84, 72, COLORS.text, 700, 'center')
      lineY += (section.specLines.length * 84) + 12
      drawLines(context, section.descriptionLines, center, lineY + 22, 32, 22, COLORS.secondary, 400, 'center')
      return
    }

    if (section.type === 'metrics') {
      section.metrics.forEach((metric) => {
        roundedRect(context, metric.x, section.y, metric.width, section.height, 22, COLORS.blue)
        strokeRoundedRect(context, metric.x, section.y, metric.width, section.height, 22, '#d6e5f4')
        const center = metric.x + (metric.width / 2)
        let metricY = section.y + ((section.height - metric.contentHeight) / 2)
        drawLines(context, metric.labelLines, center, metricY + 24, 32, 24, COLORS.secondary, 600, 'center')
        metricY += (metric.labelLines.length * 32) + 10
        drawLines(context, metric.valueLines, center, metricY + 30, 40, 30, COLORS.text, 650, 'center')
      })
      return
    }

    if (section.type === 'parameters') {
      drawLines(context, section.titleLines, SIDE_MARGIN, section.y + 32, 40, 32, COLORS.text, 650)
      roundedRect(context, SIDE_MARGIN, section.cardY, CARD_WIDTH, section.cardHeight, 22, '#ffffff')
      strokeRoundedRect(context, SIDE_MARGIN, section.cardY, CARD_WIDTH, section.cardHeight, 22, COLORS.line)
      let rowY = section.cardY
      section.parameterRows.forEach((row, index) => {
        drawLines(context, row.labelLines, section.labelX, rowY + 14 + 26,
          row.lineHeight, 26, COLORS.secondary, 650)
        drawLines(context, row.valueLines, section.valueX, rowY + 14 + 26,
          row.lineHeight, 26, COLORS.text, 500)
        rowY += row.height
        if (index < section.parameterRows.length - 1) {
          context.beginPath()
          context.moveTo(SIDE_MARGIN + 18, rowY)
          context.lineTo(SIDE_MARGIN + CARD_WIDTH - 18, rowY)
          context.setStrokeStyle('#e4e8e8')
          context.setLineWidth(1)
          context.stroke()
        }
      })
      return
    }

    if (section.type === 'warnings') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, COLORS.warning)
      strokeRoundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, '#f0d4ad')
      const x = SIDE_MARGIN + CARD_PADDING
      let lineY = section.y + 24
      if (section.warningLines.length) {
        drawLines(context, [section.title], x, lineY + 18, 22, 18, COLORS.warningText, 650)
        lineY += 22 + 8
        section.warningLines.forEach((lines) => {
          drawLines(context, lines, x, lineY + 18, 30, 21, COLORS.warningText, 400)
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
      const inputRevision = this._inputRevision || 0
      const reopeningPreview = this.data.resultReportPreviewVisible && this.data.resultReportPreviewClosing
      cancelReportPreviewClose(this)
      this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      if (this.data.resultReportImagePath && this.resultReportSignature === signature) {
        const cachedPath = this.data.resultReportImagePath
        const revision = (this.resultReportRevision || 0) + 1
        this.resultReportRevision = revision
        this._reportCacheCheckRevision = revision
        vibrate('light')
        this.setData({
          isCheckingResultReportCache: true,
          resultReportPreviewVisible: reopeningPreview,
          resultReportPreviewClosing: false,
        }, () => {
          const isCurrent = () => !this._isUnloaded
            && this._reportCacheCheckRevision === revision
            && this.resultReportRevision === revision
            && (this._inputRevision || 0) === inputRevision
            && this.getResultReportSignature(this.getRecordPayload()) === signature
          const showCached = () => {
            if (!isCurrent()) return
            this._reportCacheCheckRevision = 0
            cancelReportPreviewClose(this)
            this.setData({ isCheckingResultReportCache: false, resultReportPreviewVisible: true, resultReportPreviewClosing: false }, () => this.updateResultReportPreviewLayout())
          }
          const regenerate = () => {
            if (!isCurrent()) return
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

      vibrate('medium')
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
        if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })
        try {
          drawAndExportReport(this, {
            canvasId: REPORT_CANVAS_ID,
            isCurrent: () => !this._isUnloaded
              && this.resultReportRevision === revision
              && (this._inputRevision || 0) === inputRevision
              && this.getResultReportSignature(this.getRecordPayload()) === signature,
            width: REPORT_WIDTH,
            height: layout.height,
            draw: (context) => {
              const finishDrawing = startMeasurement('线材选型/结果图绘制')
              drawCableReport(context, payload, layout)
              finishDrawing({ height: layout.height })
            },
            getExportOptions: () => getExportDimensions(layout.height),
            startExportMeasurement: (dimensions) => startMeasurement('线材选型/结果图导出', dimensions),
            onSuccess: (tempFilePath) => {
              this.resultReportSignature = signature
              this.finishResultReportGeneration(revision, {
                resultReportImagePath: tempFilePath,
                resultReportPreviewVisible: true,
              })
            },
            onFailure: () => {
              this.finishResultReportGeneration(revision)
              wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
            },
          })
        } catch (error) {
          this.finishResultReportGeneration(revision)
          wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
        }
      })
    },

    hideResultReportPreview() {
      cancelReportPreviewClose(this)
      this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      this._reportCacheCheckRevision = 0
      const viewerEpisode = (this._reportImageViewerEpisode || 0) + 1
      this._reportImageViewerEpisode = viewerEpisode
      return {
        resultReportPreviewVisible: false,
        resultReportPreviewClosing: false,
        resultReportImageViewerVisible: false,
        resultReportImageViewerScale: 100,
        resultReportImageViewerEpisode: viewerEpisode,
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
      const inputRevision = this._inputRevision || 0
      if (!this._pageVisible || this._isUnloaded || !this.data.resultReportPreviewVisible
        || this.data.resultReportPreviewClosing || !path || !signature) return false
      const revision = (this._reportPreviewLayoutRevision || 0) + 1
      this._reportPreviewLayoutRevision = revision
      if (this.data.resultReportPreviewStyle) this.setData({ resultReportPreviewStyle: '' })
      if (typeof wx.createSelectorQuery !== 'function') return false
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
      const current = () => revision === this._reportPreviewLayoutRevision
        && !this._isUnloaded && this._pageVisible
        && this.data.resultReportPreviewVisible && !this.data.resultReportPreviewClosing
        && this.data.resultReportImagePath === path
        && this.resultReportSignature === signature
        && (this._inputRevision || 0) === inputRevision
        && this.getResultReportSignature(this.getRecordPayload()) === signature
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
            : (Number.isFinite(overlayHeight) ? (Number.isFinite(overlayTop) ? overlayTop : rootTop) + overlayHeight : rootBottom)
          const viewportBottom = Math.min(rootBottom || overlayBottom, overlayBottom)
          const viewportHeight = Math.max(0, viewportBottom - viewportTop)
          const scale = (Number(root?.width) || 390) / REPORT_WIDTH
          const overlayPaddingTop = styleNumber(nodes['.result-report-preview-overlay'], 'paddingTop', 32 * scale)
          const overlayPaddingBottom = styleNumber(nodes['.result-report-preview-overlay'], 'paddingBottom', 16 * scale)
          const sheetPaddingTop = styleNumber(nodes['.result-report-preview-sheet'], 'paddingTop', 20 * scale)
          const sheetPaddingBottom = styleNumber(nodes['.result-report-preview-sheet'], 'paddingBottom', 16 * scale)
          const sheetRectHeight = Number(sheet?.height) || 0
          const sheetTopGap = sheetRectHeight > 0 ? Math.max(0, Number(sheet.top) - viewportTop) : 0
          const sheetBottomGap = sheetRectHeight > 0 ? Math.max(0, viewportBottom - Number(sheet.bottom)) : 0
          const sheetSweepHeight = sheetRectHeight + sheetTopGap + sheetBottomGap
          const availableSheetHeight = Math.max(0, Math.min(viewportHeight,
            sheetSweepHeight > 0 ? sheetSweepHeight : viewportHeight)
            - overlayPaddingTop - overlayPaddingBottom)
          const sheetBorders = styleNumber(nodes['.result-report-preview-sheet'], 'borderTopWidth', 1)
            + styleNumber(nodes['.result-report-preview-sheet'], 'borderBottomWidth', 1)
          const fixedHeight = sheetPaddingTop + sheetPaddingBottom + sheetBorders
            + (Number(header?.height) || 0) + (Number(actions?.height) || 0)
          const availableScrollHeight = Math.max(0, availableSheetHeight - fixedHeight)
          const scrollBorders = styleNumber(nodes['.result-report-preview-scroll'], 'borderTopWidth', 1)
            + styleNumber(nodes['.result-report-preview-scroll'], 'borderBottomWidth', 1)
          const horizontalBorders = styleNumber(nodes['.result-report-preview-scroll'], 'borderLeftWidth', 1)
            + styleNumber(nodes['.result-report-preview-scroll'], 'borderRightWidth', 1)
          const scrollWidth = Number(scroll?.width) || Math.max(0, (Number(root?.width) || 0) - (76 * scale))
          const imageWidth = Number(image?.width) || Math.max(0, scrollWidth - horizontalBorders)
          const naturalImageHeight = (Number(this.data.resultReportCanvasHeight) || 0)
            * imageWidth / REPORT_WIDTH
          if (!viewportHeight || !availableSheetHeight || !imageWidth || !naturalImageHeight) return
          const scrollHeight = Math.min(naturalImageHeight + scrollBorders, availableScrollHeight)
          const nextStyle = '--cable-report-sheet-max-height:' + Math.round(availableSheetHeight * 100) / 100
            + 'px;--cable-report-scroll-height:' + Math.round(scrollHeight * 100) / 100 + 'px'
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
      if (!this.data.resultReportPreviewVisible
        || (this.data.resultReportPreviewClosing && immediate !== true)) return false
      vibrate('light')
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
      const viewerEpisode = (this._reportImageViewerEpisode || 0) + 1
      this._reportImageViewerEpisode = viewerEpisode
      this.setData({
        resultReportImageViewerVisible: true,
        resultReportImageViewerScale: 100,
        resultReportImageViewerEpisode: viewerEpisode,
      })
      return true
    },

    setResultReportImageViewerScale(event) {
      if (!this.data.resultReportImageViewerVisible || !this._pageVisible || this._isUnloaded) return false
      const scale = Number(event.currentTarget.dataset.scale)
      if (![100, 200, 300].includes(scale)) return false
      const signature = this.getResultReportSignature(this.getRecordPayload())
      if (!signature || signature !== this.resultReportSignature || !this.data.resultReportImagePath) {
        this.setData(this.invalidateResultReportPreview())
        return false
      }
      this.setData({ resultReportImageViewerScale: scale })
      return true
    },

    closeResultReportImageViewer() {
      if (!this.data.resultReportImageViewerVisible) return false
      const viewerEpisode = (this._reportImageViewerEpisode || 0) + 1
      this._reportImageViewerEpisode = viewerEpisode
      this.setData({
        resultReportImageViewerVisible: false,
        resultReportImageViewerScale: 100,
        resultReportImageViewerEpisode: viewerEpisode,
      })
      return true
    },

    onResultReportImageViewerError(event) {
      const dataset = event?.currentTarget?.dataset || {}
      if (!this.data.resultReportImageViewerVisible || !this._pageVisible || this._isUnloaded
        || Number(dataset.viewerEpisode) !== Number(this.data.resultReportImageViewerEpisode)
        || dataset.imagePath !== this.data.resultReportImagePath) return false
      this.closeResultReportImageViewer()
      wx.showToast({ title: '原图加载失败，请重试', icon: 'none' })
      return true
    },

    shareResultReportImage() {
      const path = this.data.resultReportImagePath
      if (!path || !this.data.resultReportPreviewVisible || this.data.resultReportPreviewClosing
        || !this._pageVisible || this._isUnloaded) return false
      shareGeneratedImage(path)
      return true
    },

    saveResultReportImage() {
      const path = this.data.resultReportImagePath
      if (!path || !this.data.resultReportPreviewVisible || this.data.resultReportPreviewClosing
        || !this._pageVisible || this._isUnloaded) return false
      saveGeneratedImage(path)
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

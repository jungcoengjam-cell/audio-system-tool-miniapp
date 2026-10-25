const { vibrate } = require('../../utils/haptics')
const { startMeasurement } = require('../../utils/performance')
const { drawAndExportReport } = require('../../utils/report-canvas')
const { isPageContextCurrent } = require('../../utils/report-image-actions')
const { REPORT_CANVAS_ID } = require('../../utils/result-report')
const {
  REPORT_WIDTH,
  REPORT_COLORS,
  roundedRect,
  setText,
  getExportDimensions,
} = require('../../utils/report-drawing')
const { adaptCanvas2dContext, drawPreviewAtSize } = require('./preview-renderer')
const { getPresentedMinimumDistanceMeters } = require('./camera-presentation')

const CONTENT_X = 44
const CARD_WIDTH = REPORT_WIDTH - (CONTENT_X * 2)
const CARD_PADDING = 28
const CARD_CONTENT_WIDTH = CARD_WIDTH - (CARD_PADDING * 2)
const PREVIEW_LOGICAL_WIDTH = 331
const PREVIEW_LOGICAL_HEIGHT = 350
const PREVIEW_PANEL_HEIGHT = 752
const PREVIEW_GAP = 18

function adaptLegacyReportPreviewContext(context) {
  const adapted = adaptCanvas2dContext(context)
  return {
    ...adapted,
    setFillStyle: (value) => context.setFillStyle(value),
    setStrokeStyle: (value) => context.setStrokeStyle(value),
    setLineWidth: (value) => context.setLineWidth(value),
    setFontSize: (value) => context.setFontSize(value),
    setTextAlign: (value) => context.setTextAlign(value),
  }
}
const COLORS = {
  ...REPORT_COLORS,
  background: '#f5f7f6',
  mint: '#eaf7f5',
  blue: '#eef6ff',
  warningSoft: '#fff5e8',
  accent: '#087f70',
  secondary: '#5f6869',
  tertiary: '#778181',
  line: '#d8e5e2',
  warning: '#80530f',
}

function reportColors(theme) {
  return theme === 'dark' ? {
    ...COLORS, background: '#000000', text: '#eef2f6', secondary: '#a9b8c1', tertiary: '#81909c',
    mint: '#102327', blue: '#111b25', surface: '#10171f', line: '#263343',
    accent: '#73d1da', warningSoft: '#2b2110', warning: '#e9b654',
  } : { ...COLORS, background: '#f6f7f9', surface: '#ffffff' }
}

function isMissing(value) {
  return value === undefined || value === null
    || (typeof value === 'string' && !value.trim())
    || (typeof value === 'number' && !Number.isFinite(value))
}

function formatNumber(value) {
  if (isMissing(value)) return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function formatMeasure(value, unit) {
  return isMissing(value) ? '—' : `${formatNumber(value)} ${unit}`
}

function formatGeneratedAt(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function buildCameraReportPayload(result, metadata = {}) {
  if (!result || !result.displayModel || isMissing(result.primaryDistanceMeters)) return null

  const ground = result.sceneMode === 'ground'
  const horizontalOnly = Boolean(result.horizontalOnly)
  const presentation = result.presentation || {}
  const fixedHeightExists = result.heightMode === 'fixed' && !isMissing(result.cameraHeightMeters)
  const aimValue = isMissing(presentation.aimValue || result.aimValue)
    ? (horizontalOnly ? '未校核' : '—')
    : String(presentation.aimValue || result.aimValue)
  const limitation = isMissing(result.resultNatureText)
    ? (horizontalOnly ? '当前仅为水平参考，垂直范围未校核。安装前请现场复核。' : '安装前请结合现场条件复核。')
    : String(result.resultNatureText)
  const horizontalLimitationTail = limitation
    .replace(/仅为水平方向参考距离[；;，, ]*/g, '')
    .replace(/垂直覆盖尚未校核[。.!]?/g, '')
    .trim()
  const explicitLimitation = horizontalOnly
    ? `仅水平参考，垂直未校核。${horizontalLimitationTail ? ` ${horizontalLimitationTail}` : ''}`
    : limitation
  const distanceEndLabel = result.distanceEndLabel || (ground ? '场地前缘' : '目标平面')
  const dimensions = ground
    ? [
      { label: '场地宽度', value: formatMeasure(result.widthMeters, 'm') },
      { label: '场地纵深', value: formatMeasure(result.depthMeters, 'm') },
      { label: '目标高度', value: formatMeasure(result.subjectHeightMeters, 'm') },
    ]
    : [
      { label: '目标宽度', value: formatMeasure(result.widthMeters, 'm') },
      { label: '目标高度', value: formatMeasure(result.heightMeters, 'm') },
      { label: '底边高度', value: formatMeasure(result.bottomHeightMeters, 'm') },
    ]

  return {
    result,
    theme: metadata.theme === 'dark' ? 'dark' : 'light',
    generatedAt: metadata.generatedAt || formatGeneratedAt(metadata.timestamp),
    title: presentation.statusKind === 'display-unverified' ? '摄像机覆盖校核结果'
      : presentation.statusKind === 'horizontal-reference' ? '摄像机水平覆盖参考' : '摄像机安装建议',
    cameraLabel: [result.displayModel, result.displayView].filter(Boolean).join(' · '),
    sceneLabel: result.sceneLabel || (ground ? '地面场景' : '垂直平面'),
    dimensions,
    distanceLabel: horizontalOnly
      ? '水平覆盖下界'
      : (ground ? '理论最小水平退距' : '理论最小水平距离'),
    distanceValue: presentation.distanceText || formatMeasure(getPresentedMinimumDistanceMeters(result), 'm'),
    distanceEndpointText: `镜头中心 → ${distanceEndLabel}（水平）`,
    distanceReferenceText: result.distanceReferenceText || '按当前目标面计算水平距离',
    heightLabel: result.heightDisplayLabel || '镜头中心高度',
    heightValue: presentation.heightDisplayText || formatMeasure(result.cameraHeightMeters, 'm'),
    heightBasis: presentation.statusKind === 'display-unverified'
      ? fixedHeightExists ? '固定高度输入（展示组合未通过校核）' : '自动计算参考值（展示组合未通过校核）'
      : presentation.statusKind === 'horizontal-reference'
        ? fixedHeightExists ? '固定高度输入（仅水平校核）' : '自动计算参考值（仅水平校核）'
      : fixedHeightExists
        ? '已有固定高度输入'
        : (result.heightBasis || result.heightBasisDisplay || (isMissing(result.cameraHeightMeters) ? '未校核' : '自动建议')),
    marginLabel: isMissing(result.marginPercent) ? '—' : `${formatNumber(result.marginPercent)}%`,
    mountLabel: result.mountLabel || '—',
    aimLabel: result.aimLabel || '安装朝向',
    aimValue,
    mountGuidanceText: result.mountGuidanceText || '安装方式需结合现场结构复核。',
    limitationText: explicitLimitation,
    presentationStatusText: presentation.statusText || (horizontalOnly
      ? '仅水平参考，垂直覆盖未校核；不作为完整安装建议。'
      : result.framingVersion === 2
        ? '当前显示值未能完成双轴校核；请勿据此安装。'
        : '历史版本参考值；未按当前 v2 三维双轴规则核验，请现场复核。'),
    horizontalOnlyStatus: horizontalOnly ? '仅水平参考 · 垂直未校核 · 非完整安装距离' : '',
    views: [
      { key: 'spatial', label: '正交三维示意' },
    ],
  }
}

function measureCanvasText(context, value) {
  if (typeof context.measureText !== 'function') {
    const fontSize = Number(context.font?.match(/([\d.]+)px/)?.[1]) || 16
    return [...String(value)].reduce((width, character) => (
      width + (character.codePointAt(0) <= 0xff ? fontSize * 0.56 : fontSize)
    ), 0)
  }
  const measured = context.measureText(String(value))
  const width = Number(measured?.width ?? measured)
  return Number.isFinite(width) && width >= 0 ? width : String(value).length * 16
}

function wrapMeasuredText(context, text, maxWidth, size, weight = 400) {
  const paragraphs = String(text === undefined || text === null ? '' : text).split(/\r?\n/)
  const lines = []
  setCameraReportText(context, size, COLORS.text, weight)
  paragraphs.forEach((paragraph) => {
    let line = ''
    for (const character of [...paragraph]) {
      const candidate = line + character
      if (line && measureCanvasText(context, candidate) > maxWidth) {
        lines.push(line)
        line = character
      } else {
        line = candidate
      }
    }
    lines.push(line)
  })
  return lines.length ? lines : ['\u2014']
}

function drawLines(context, lines, x, y, lineHeight, size, color, weight = 400, align = 'left') {
  setCameraReportText(context, size, color, weight, align)
  lines.forEach((value, index) => context.fillText(value, x, y + (index * lineHeight)))
}

function setCameraReportText(context, size, color, weight = 400, align = 'left') {
  if (typeof context.setFontSize === 'function') context.setFontSize(size)
  setText(context, size, color, weight, align)
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

function buildCameraReportLayout(context, payload) {
  if (!payload || !payload.result) return { sections: [], height: 0 }
  const layout = { sections: [], height: 0 }
  let y = 42

  const titleLines = wrapMeasuredText(context, payload.title || '摄像机安装建议', CARD_WIDTH, 30, 650)
  layout.sections.push({ type: 'title', y, lines: titleLines, lineHeight: 38 })
  y += (titleLines.length * 38) + 10

  const identityText = [payload.cameraLabel, payload.sceneLabel].filter(Boolean).join(' · ')
  const identityLines = wrapMeasuredText(context, identityText, CARD_WIDTH, 20, 500)
  layout.sections.push({ type: 'identity', y, lines: identityLines, lineHeight: 28 })
  y += (identityLines.length * 28) + 20

  const mainLabelLines = wrapMeasuredText(context, payload.distanceLabel, CARD_CONTENT_WIDTH, 23, 650)
  const valueLines = wrapMeasuredText(context, payload.distanceValue, CARD_CONTENT_WIDTH, 72, 700)
  const endpointLines = wrapMeasuredText(context, payload.distanceEndpointText, CARD_CONTENT_WIDTH, 22, 400)
  const mainHeight = 26 + (mainLabelLines.length * 32) + 10
    + (valueLines.length * 84) + 12 + (endpointLines.length * 32) + 26
  layout.sections.push({
    type: 'main', y, height: mainHeight, labelLines: mainLabelLines,
    valueLines, endpointLines,
  })
  y += mainHeight + 18

  const metricGap = 12
  const metricWidth = (CARD_CONTENT_WIDTH - metricGap) / 2
  const metrics = [
    { label: payload.heightLabel, value: payload.heightValue },
    { label: '取景余量', value: payload.marginLabel },
  ].map((metric, index) => {
    const labelLines = wrapMeasuredText(context, metric.label, metricWidth - 36, 24, 600)
    const valueLines = wrapMeasuredText(context, metric.value, metricWidth - 36, 30, 650)
    const contentHeight = (labelLines.length * 32) + 10 + (valueLines.length * 40)
    return {
      ...metric,
      x: CONTENT_X + CARD_PADDING + (index * (metricWidth + metricGap)),
      width: metricWidth,
      labelLines,
      valueLines,
      contentHeight,
    }
  })
  const metricsHeight = Math.max(144, ...metrics.map((metric) => metric.contentHeight + 44))
  layout.sections.push({ type: 'metrics', y, height: metricsHeight, metrics })
  y += metricsHeight + 26

  const parameters = [
    ...payload.dimensions.map((item) => [item.label, item.value]),
    ['安装方式', payload.mountLabel],
    [payload.aimLabel, payload.aimValue],
  ]
  const labelWidth = 228
  const columnGap = 16
  const valueWidth = CARD_CONTENT_WIDTH - 48 - labelWidth - columnGap
  const parameterRows = parameters.map(([label, value]) => {
    const labelLines = wrapMeasuredText(context, label, labelWidth, 26, 650)
    const valueLines = wrapMeasuredText(context, value, valueWidth, 26, 500)
    const lineCount = Math.max(labelLines.length, valueLines.length)
    return { labelLines, valueLines, lineHeight: 36, height: (lineCount * 36) + 28 }
  })
  const parameterTitleLines = wrapMeasuredText(context, '目标与安装参数', CARD_CONTENT_WIDTH, 32, 650)
  const parameterTitleHeight = (parameterTitleLines.length * 40) + 10
  const parameterCardHeight = parameterRows.reduce((total, row) => total + row.height, 0)
  layout.sections.push({
    type: 'parameters', y, height: parameterTitleHeight + parameterCardHeight,
    titleLines: parameterTitleLines,
    cardY: y + parameterTitleHeight,
    cardHeight: parameterCardHeight,
    labelX: CONTENT_X + CARD_PADDING,
    valueX: CONTENT_X + CARD_PADDING + labelWidth + columnGap,
    parameterRows,
  })
  y += parameterTitleHeight + parameterCardHeight + 18

  const statusText = [payload.presentationStatusText, payload.horizontalOnlyStatus]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' ')
  if (statusText) {
    const statusLines = wrapMeasuredText(context, statusText, CARD_CONTENT_WIDTH, 21, 500)
    const statusHeight = 24 + 24 + (statusLines.length * 30) + 22
    layout.sections.push({ type: 'status', y, height: statusHeight, lines: statusLines })
    y += statusHeight + 18
  }

  payload.views.forEach((view) => {
    const labelLines = wrapMeasuredText(context, view.label, CARD_CONTENT_WIDTH, 22, 650)
    layout.sections.push({
      type: 'diagram', y, height: PREVIEW_PANEL_HEIGHT, view, labelLines,
    })
    y += PREVIEW_PANEL_HEIGHT + PREVIEW_GAP
  })

  layout.height = Math.ceil(y - (payload.views.length ? PREVIEW_GAP : 0) + 28)
  return layout
}

function drawPreviewPanel(context, adaptedContext, payload, section) {
  const colors = reportColors(payload.theme)
  roundedRect(context, CONTENT_X, section.y, CARD_WIDTH, section.height, 22, colors.background)
  strokeRoundedRect(context, CONTENT_X, section.y, CARD_WIDTH, section.height, 22, colors.line)
  drawLines(context, section.labelLines, CONTENT_X + CARD_PADDING,
    section.y + 31, 28, 22, colors.text, 650)
  context.save()
  context.translate(CONTENT_X, section.y + 46)
  context.scale(2, 2)
  drawPreviewAtSize(adaptedContext, payload.result, PREVIEW_LOGICAL_WIDTH,
    PREVIEW_LOGICAL_HEIGHT, section.view.key, payload.theme)
  context.restore()
}

function drawCameraReport(context, payload, layout) {
  if (!context || !payload || !payload.result || !layout || !Array.isArray(layout.sections)
    || !Number.isFinite(Number(layout.height))) return false
  const colors = reportColors(payload.theme)
  context.setFillStyle(colors.background)
  context.fillRect(0, 0, REPORT_WIDTH, layout.height)
  const adaptedContext = adaptLegacyReportPreviewContext(context)
  layout.sections.forEach((section) => {
    if (section.type === 'title') {
      drawLines(context, section.lines, CONTENT_X, section.y + 30,
        section.lineHeight, 30, colors.text, 650)
      return
    }

    if (section.type === 'identity') {
      drawLines(context, section.lines, CONTENT_X, section.y + 20,
        section.lineHeight, 20, colors.secondary, 500)
      return
    }

    if (section.type === 'main') {
      roundedRect(context, CONTENT_X, section.y, CARD_WIDTH, section.height, 22, colors.mint)
      strokeRoundedRect(context, CONTENT_X, section.y, CARD_WIDTH, section.height, 22, colors.line)
      const center = REPORT_WIDTH / 2
      let lineY = section.y + 26
      drawLines(context, section.labelLines, center, lineY + 23, 32, 23, colors.accent, 650, 'center')
      lineY += (section.labelLines.length * 32) + 10
      drawLines(context, section.valueLines, center, lineY + 72, 84, 72, colors.text, 700, 'center')
      lineY += (section.valueLines.length * 84) + 12
      drawLines(context, section.endpointLines, center, lineY + 22, 32, 22,
        colors.secondary, 400, 'center')
      return
    }

    if (section.type === 'metrics') {
      section.metrics.forEach((metric) => {
        roundedRect(context, metric.x, section.y, metric.width, section.height, 22, colors.blue)
        strokeRoundedRect(context, metric.x, section.y, metric.width, section.height, 22, colors.line)
        const center = metric.x + (metric.width / 2)
        let metricY = section.y + ((section.height - metric.contentHeight) / 2)
        drawLines(context, metric.labelLines, center, metricY + 24, 32, 24,
          colors.secondary, 600, 'center')
        metricY += (metric.labelLines.length * 32) + 10
        drawLines(context, metric.valueLines, center, metricY + 30, 40, 30,
          colors.text, 650, 'center')
      })
      return
    }

    if (section.type === 'parameters') {
      drawLines(context, section.titleLines, CONTENT_X, section.y + 32, 40, 32, colors.text, 650)
      roundedRect(context, CONTENT_X, section.cardY, CARD_WIDTH, section.cardHeight, 22, colors.surface)
      strokeRoundedRect(context, CONTENT_X, section.cardY, CARD_WIDTH, section.cardHeight, 22, colors.line)
      let rowY = section.cardY
      section.parameterRows.forEach((row, index) => {
        drawLines(context, row.labelLines, section.labelX, rowY + 14 + 26,
          row.lineHeight, 26, colors.secondary, 650)
        drawLines(context, row.valueLines, section.valueX, rowY + 14 + 26,
          row.lineHeight, 26, colors.text, 500)
        rowY += row.height
        if (index < section.parameterRows.length - 1) {
          context.beginPath()
          context.moveTo(CONTENT_X + 18, rowY)
          context.lineTo(CONTENT_X + CARD_WIDTH - 18, rowY)
          context.setStrokeStyle(colors.line)
          context.setLineWidth(1)
          context.stroke()
        }
      })
      return
    }

    if (section.type === 'status') {
      roundedRect(context, CONTENT_X, section.y, CARD_WIDTH, section.height, 22, colors.warningSoft)
      strokeRoundedRect(context, CONTENT_X, section.y, CARD_WIDTH, section.height, 22, colors.line)
      drawLines(context, section.lines, CONTENT_X + CARD_PADDING, section.y + 24 + 21,
        30, 21, colors.warning, 500)
      return
    }

    if (section.type === 'diagram') drawPreviewPanel(context, adaptedContext, payload, section)
  })
  return true
}

function calculateCameraReportHeight(payload) {
  if (!payload || !payload.result) return 0
  const estimateContext = {
    font: '16px sans-serif',
    setFillStyle() {},
    setTextAlign() {},
    measureText(value) {
      const fontSize = Number(this.font.match(/([\d.]+)px/)?.[1]) || 16
      const width = [...String(value)].reduce((total, character) => (
        total + (character.codePointAt(0) <= 0xff ? fontSize * 0.56 : fontSize)
      ), 0)
      return { width }
    },
  }
  return buildCameraReportLayout(estimateContext, payload).height
}

function showToast(title) {
  if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
    wx.showToast({ title, icon: 'none' })
  }
}

function createCameraReportMethods(baseMethods = {}) {
  const base = baseMethods || {}
  return {
    ...base,

    getResultReportSignature(record) {
      const signature = base.getResultReportSignature?.call(this, record) || ''
      return signature ? JSON.stringify([signature, this.data?.theme === 'dark' ? 'dark' : 'light']) : ''
    },

    generateResultReportImage() {
      const result = this.data?.result
      const payload = buildCameraReportPayload(result, { theme: this.data?.theme })
      if (!payload || this.data?.isGeneratingResultReport) {
        if (!payload) showToast('当前没有可生成的安装建议')
        return false
      }

      const signature = typeof this.getResultReportSignature === 'function'
        ? this.getResultReportSignature()
        : ''
      if (!signature) {
        showToast('当前没有可生成的安装建议')
        return false
      }
      if (this.data.resultReportImagePath && this.resultReportSignature === signature) {
        const shouldNotifyOpen = !this.data.resultReportPreviewVisible
        const revision = this.resultReportRevision || 0
        this.setData({ resultReportPreviewVisible: true }, () => {
          if (shouldNotifyOpen && this.resultReportRevision === revision
            && this.data.resultReportPreviewVisible && isPageContextCurrent(this)) vibrate('light')
          if (typeof this.updateResultReportPreviewLayout === 'function') this.updateResultReportPreviewLayout()
        })
        return true
      }
      if (typeof wx === 'undefined' || typeof wx.createCanvasContext !== 'function'
        || typeof wx.canvasToTempFilePath !== 'function') {
        showToast('当前微信版本暂不支持生成图片')
        return false
      }

      let layout
      try {
        const measureContext = wx.createCanvasContext(REPORT_CANVAS_ID, this)
        layout = buildCameraReportLayout(measureContext, payload)
      } catch (error) {
        showToast('图片排版失败，请重试')
        return false
      }
      if (!layout || !Number.isFinite(layout.height) || layout.height <= 0) {
        showToast('图片排版失败，请重试')
        return false
      }

      const revision = (this.resultReportRevision || 0) + 1
      this.resultReportRevision = revision
      this.resultReportPendingSignature = signature
      this.setData({
        resultReportCanvasWidth: REPORT_WIDTH,
        resultReportCanvasHeight: layout.height,
        isGeneratingResultReport: true,
        resultReportPreviewVisible: false,
      }, () => {
        if (this.resultReportRevision !== revision) return
        if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })
        const isCurrent = () => this.resultReportRevision === revision
          && this.resultReportPendingSignature === signature
          && this.data?.result === result
          && !this.data?.resultUpdating
          && !this.data?.legacyCustomUnsupported
          && typeof this.getResultReportSignature === 'function'
          && this.getResultReportSignature() === signature
        try {
          drawAndExportReport(this, {
            canvasId: REPORT_CANVAS_ID,
            isCurrent,
            width: REPORT_WIDTH,
            height: layout.height,
            draw: (canvasContext) => {
              const finishDrawing = startMeasurement('摄像机/报告绘制')
              drawCameraReport(canvasContext, payload, layout)
              finishDrawing({ height: layout.height, previewCount: payload.views.length })
            },
            getExportOptions: () => getExportDimensions(layout.height),
            startExportMeasurement: (exportDimensions) => startMeasurement('摄像机/报告导出', exportDimensions),
            onSuccess: (tempFilePath) => {
              this.resultReportSignature = signature
              this.finishResultReportGeneration(revision, {
                resultReportImagePath: tempFilePath,
                resultReportPreviewVisible: true,
              })
              if (this.resultReportRevision === revision && !this.resultReportPendingSignature
                && isPageContextCurrent(this)) vibrate('medium')
            },
            onFailure: () => {
              this.finishResultReportGeneration(revision)
              showToast('图片生成失败，请重试')
            },
          })
        } catch (error) {
          this.finishResultReportGeneration(revision)
          showToast('图片生成失败，请重试')
        }
      })
      return true
    },
  }
}

module.exports = {
  buildCameraReportPayload,
  buildCameraReportLayout,
  calculateCameraReportHeight,
  drawCameraReport,
  createCameraReportMethods,
}

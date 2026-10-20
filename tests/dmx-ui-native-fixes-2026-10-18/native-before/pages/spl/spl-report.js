const { getExportDimensions, roundedRect } = require('../../utils/report-drawing')

const SPL_REPORT_DESIGN_VERSION = 'spl-report-v3'
const REPORT_CANVAS_ID = 'resultReportCanvas'
const REPORT_WIDTH = 750
const SIDE_MARGIN = 44
const CARD_WIDTH = REPORT_WIDTH - (SIDE_MARGIN * 2)
const CARD_PADDING = 28
const CONTENT_WIDTH = CARD_WIDTH - (CARD_PADDING * 2)
const COLORS = {
  background: '#f5f7f6',
  mint: '#eaf7f5',
  mintLine: '#c5e5de',
  blue: '#eef6ff',
  blueLine: '#d6e5f4',
  white: '#ffffff',
  text: '#1d1d1f',
  accent: '#087f70',
  secondary: '#5f6869',
  line: '#d8e5e2',
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

function buildSplReportPayload(state = {}) {
  const result = state.result
  if (!result || state.isCalculationPending) return null

  return {
    title: '声压级估算',
    primaryLabel: '当前距离理论声压级 · 自由场理论估算',
    primaryValue: String(result.selectedSpl),
    primaryUnit: 'dB SPL',
    description: [
      `${result.model} × ${result.speakerCount} 只`,
      `${result.distanceMeters} m`,
      result.summationModeShortLabel || result.summationMode,
    ].filter(Boolean).join(' · '),
    metrics: [
      { label: '1 m 理论声压级', value: `${result.oneMeterSpl} dB SPL` },
      { label: '总额定功率', value: `${result.totalRatedPower} W` },
      { label: '灵敏度 @ 1W/1m', value: `${result.sensitivityDb} dB` },
      { label: '本次叠加增益', value: `+${result.summationGainDb} dB` },
    ],
    parameters: [
      ['音箱型号', result.model],
      ['音箱数量', `${result.speakerCount} 只`],
      ['测量距离', `${result.distanceMeters} m`],
      ['叠加方式', result.summationModeShortLabel || result.summationMode],
    ],
    distanceRows: Array.isArray(result.distanceRows) ? result.distanceRows : [],
  }
}

function buildSplReportSignature(record) {
  if (!record) return ''
  return `${SPL_REPORT_DESIGN_VERSION}|${[record.module, record.title, record.summary, record.resultText].join('|')}`
}

function buildSplReportLayout(context, payload) {
  const sections = []
  let y = 42

  const titleLines = wrapMeasuredText(context, payload.title, CARD_WIDTH, 30, 650)
  sections.push({ type: 'title', y, lines: titleLines, lineHeight: 38 })
  y += (titleLines.length * 38) + 24

  const mainLabelLines = wrapMeasuredText(context, payload.primaryLabel, CONTENT_WIDTH - 48, 23, 650)
  const descriptionLines = wrapMeasuredText(context, payload.description, CONTENT_WIDTH - 48, 22, 400)
  const primaryValueSize = 72
  const primaryLineHeight = 84
  const primaryValueFont = `700 ${primaryValueSize}px Arial`
  context.font = primaryValueFont
  const primaryValueWidth = context.measureText(payload.primaryValue).width
  context.font = fontString(24, 650)
  const primaryUnitWidth = context.measureText(payload.primaryUnit).width
  const mainHeight = 26 + (mainLabelLines.length * 32) + 10 + primaryLineHeight + 12
    + (descriptionLines.length * 32) + 26
  sections.push({
    type: 'main',
    y,
    height: mainHeight,
    labelLines: mainLabelLines,
    descriptionLines,
    primaryValueSize,
    primaryLineHeight,
    primaryValueFont,
    primaryValueWidth,
    primaryUnitWidth,
  })
  y += mainHeight + 18

  const metricGap = 12
  const metricWidth = (CONTENT_WIDTH - metricGap) / 2
  const metrics = payload.metrics.map((metric, index) => {
    const innerWidth = metricWidth - 36
    const labelLines = wrapMeasuredText(context, metric.label, innerWidth, 24, 600)
    const valueLines = wrapMeasuredText(context, metric.value, innerWidth, 30, 650)
    const contentHeight = (labelLines.length * 32) + 10 + (valueLines.length * 40)
    return {
      ...metric,
      x: SIDE_MARGIN + CARD_PADDING + ((index % 2) * (metricWidth + metricGap)),
      row: Math.floor(index / 2),
      width: metricWidth,
      labelLines,
      valueLines,
      height: Math.max(144, contentHeight + 44),
      contentHeight,
    }
  })
  const metricRowHeights = [0, 1].map((row) => Math.max(
    ...metrics.filter((metric) => metric.row === row).map((metric) => metric.height),
  ))
  let metricY = y
  metrics.forEach((metric) => {
    metric.y = metricY + metricRowHeights.slice(0, metric.row).reduce((total, height) => total + height + metricGap, 0)
  })
  const metricsHeight = metricRowHeights.reduce((total, height) => total + height, 0) + metricGap
  sections.push({ type: 'metrics', metrics })
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
  const parameterTitleLines = wrapMeasuredText(context, '估算条件', CONTENT_WIDTH, 32, 650)
  const parameterTitleHeight = (parameterTitleLines.length * 40) + 10
  const parameterCardHeight = parameterRows.reduce((total, row) => total + row.height, 0)
  sections.push({
    type: 'parameters',
    y,
    height: parameterTitleHeight + parameterCardHeight,
    titleLines: parameterTitleLines,
    cardY: y + parameterTitleHeight,
    cardHeight: parameterCardHeight,
    labelX: SIDE_MARGIN + 24,
    valueX: SIDE_MARGIN + 24 + labelWidth + columnGap,
    parameterRows,
  })
  y += parameterTitleHeight + parameterCardHeight + 18

  const distanceTitleLines = wrapMeasuredText(context, '不同距离声压级', CONTENT_WIDTH, 32, 650)
  const distanceCellGap = 12
  const distanceCellWidth = (CONTENT_WIDTH - distanceCellGap) / 2
  const distanceCellHeight = 84
  const distanceRows = payload.distanceRows.map((row, index) => ({
    ...row,
    x: SIDE_MARGIN + CARD_PADDING + ((index % 2) * (distanceCellWidth + distanceCellGap)),
    y: y + (Math.floor(index / 2) * (distanceCellHeight + 8))
      + (distanceTitleLines.length * 40) + 10,
    width: distanceCellWidth,
    height: distanceCellHeight,
    labelLines: wrapMeasuredText(context, `${row.distanceMeters} m`, distanceCellWidth - 36, 24, 600),
    valueLines: wrapMeasuredText(context, `${row.spl} dB SPL`, distanceCellWidth - 36, 30, 650),
  }))
  const distanceGridHeight = Math.max(0,
    Math.ceil(distanceRows.length / 2) * (distanceCellHeight + 8) - 8)
  sections.push({
    type: 'distances',
    y,
    titleLines: distanceTitleLines,
    titleHeight: (distanceTitleLines.length * 40) + 10,
    rows: distanceRows,
    height: (distanceTitleLines.length * 40) + 10 + distanceGridHeight,
  })
  y += (distanceTitleLines.length * 40) + 10 + distanceGridHeight

  return { sections, height: Math.ceil(y + 28) }
}

function calculateSplReportHeight(payload, context) {
  return buildSplReportLayout(context, payload).height
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

function drawSplReport(context, payload, height) {
  const layout = buildSplReportLayout(context, payload)
  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, REPORT_WIDTH, height || layout.height)

  layout.sections.forEach((section) => {
    if (section.type === 'title') {
      drawLines(context, section.lines, SIDE_MARGIN, section.y + 30,
        section.lineHeight, 30, COLORS.text, 650)
      return
    }

    if (section.type === 'main') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, COLORS.mint)
      strokeRoundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, COLORS.mintLine)
      const center = REPORT_WIDTH / 2
      let lineY = section.y + 26
      drawLines(context, section.labelLines, center, lineY + 23, 32, 23, COLORS.accent, 650, 'center')
      lineY += (section.labelLines.length * 32) + 10

      const valueX = center - ((section.primaryValueWidth + section.primaryUnitWidth + 12) / 2)
      context.font = section.primaryValueFont
      context.setFillStyle(COLORS.text)
      context.setTextAlign('left')
      context.fillText(payload.primaryValue, valueX, lineY + section.primaryValueSize)
      drawLines(context, [payload.primaryUnit], valueX + section.primaryValueWidth + 12, lineY + section.primaryValueSize,
        32, 24, COLORS.secondary, 650)
      lineY += section.primaryLineHeight + 12
      drawLines(context, section.descriptionLines, center, lineY + 22, 32, 22,
        COLORS.secondary, 400, 'center')
      return
    }

    if (section.type === 'metrics') {
      section.metrics.forEach((metric) => {
        roundedRect(context, metric.x, metric.y, metric.width, metric.height, 22, COLORS.blue)
        strokeRoundedRect(context, metric.x, metric.y, metric.width, metric.height, 22, COLORS.blueLine)
        const center = metric.x + (metric.width / 2)
        let metricY = metric.y + ((metric.height - metric.contentHeight) / 2)
        drawLines(context, metric.labelLines, center, metricY + 24, 32, 24,
          COLORS.secondary, 600, 'center')
        metricY += (metric.labelLines.length * 32) + 10
        drawLines(context, metric.valueLines, center, metricY + 30, 40, 30,
          COLORS.text, 650, 'center')
      })
      return
    }

    if (section.type === 'parameters') {
      drawLines(context, section.titleLines, SIDE_MARGIN, section.y + 32, 40, 32, COLORS.text, 650)
      roundedRect(context, SIDE_MARGIN, section.cardY, CARD_WIDTH, section.cardHeight, 22, COLORS.white)
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

    if (section.type === 'distances') {
      drawLines(context, section.titleLines, SIDE_MARGIN, section.y + 32, 40, 32, COLORS.text, 650)
      section.rows.forEach((row) => {
        const fill = row.isSelected ? COLORS.mint : COLORS.white
        const stroke = row.isSelected ? COLORS.mintLine : COLORS.line
        roundedRect(context, row.x, row.y, row.width, row.height, 22, fill)
        strokeRoundedRect(context, row.x, row.y, row.width, row.height, 22, stroke)
        const center = row.x + (row.width / 2)
        drawLines(context, row.labelLines, center, row.y + 30, 32, 24,
          COLORS.secondary, 600, 'center')
        drawLines(context, row.valueLines, center, row.y + 66, 40, 30,
          row.isSelected ? COLORS.accent : COLORS.text, 650, 'center')
      })
    }
  })
}

module.exports = {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  SPL_REPORT_DESIGN_VERSION,
  buildSplReportPayload,
  buildSplReportSignature,
  calculateSplReportHeight,
  drawSplReport,
  getExportDimensions,
}

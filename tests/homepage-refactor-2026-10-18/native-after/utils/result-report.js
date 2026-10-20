const { APP_VERSION, PRODUCT_DATA_DATE } = require('../data/app-meta')
const { MODULES } = require('./records')
const {
  REPORT_WIDTH,
  REPORT_COLORS,
  roundedRect,
  drawText,
  drawWrappedText: drawWrappedTextShared,
  getExportDimensions,
} = require('./report-drawing')

const REPORT_CANVAS_ID = 'resultReportCanvas'
const MAX_RESULT_LINES = 20

const COLORS = {
  ...REPORT_COLORS,
  cyan: '#27b7ca',
  cyanSoft: '#eaf9fb',
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, options = {}) {
  return drawWrappedTextShared(context, text, x, y, maxWidth, lineHeight, options, 20)
}

function formatGeneratedAt(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getLineCountEstimate(text) {
  const units = [...String(text || '')].reduce((total, character) => (
    total + (/^[\x00-\xff]$/.test(character) ? 0.55 : 1)
  ), 0)
  return Math.max(1, Math.min(2, Math.ceil(units / 27)))
}

function cleanResultLines(resultText, moduleLabel) {
  const lines = String(resultText || '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines[0] && lines[0].includes(moduleLabel) && /(计算|估算|选型|编址)/.test(lines[0])) lines.shift()
  const cleaned = lines.filter((line) => !line.startsWith('结果性质：'))
  if (cleaned.length <= MAX_RESULT_LINES) return cleaned
  return [
    ...cleaned.slice(0, MAX_RESULT_LINES - 1),
    `其余 ${cleaned.length - MAX_RESULT_LINES + 1} 项请复制文字结果查看。`,
  ]
}

function buildResultReportPayload(record, metadata = {}) {
  if (!record?.module || !record.resultText) return null
  const moduleInfo = MODULES[record.module]
  if (!moduleInfo) return null
  const lines = cleanResultLines(record.resultText, moduleInfo.label)
  if (!lines.length) return null
  return {
    moduleLabel: moduleInfo.label,
    trustLabel: moduleInfo.trustLabel,
    trustDescription: moduleInfo.trustDescription,
    title: record.title || moduleInfo.label,
    summary: record.summary || '',
    lines,
    generatedAt: metadata.generatedAt || formatGeneratedAt(),
    appVersion: metadata.appVersion || APP_VERSION,
    productDataDate: metadata.productDataDate || PRODUCT_DATA_DATE,
  }
}

function calculateResultReportHeight(payload) {
  const bodyLines = payload.lines.reduce((total, line) => total + getLineCountEstimate(line), 0)
  return Math.min(2600, Math.max(1320, 750 + (bodyLines * 38) + (payload.lines.length * 16)))
}

function drawResultReport(context, payload, height) {
  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, REPORT_WIDTH, height)

  roundedRect(context, 44, 42, 174, 36, 18, COLORS.cyanSoft)
  drawText(context, `${payload.moduleLabel} · 计算结果`, 131, 67, 16, COLORS.cyan, 650, 'center')
  drawWrappedText(context, payload.title, 44, 137, 662, 48, {
    size: 40,
    color: COLORS.text,
    weight: 700,
    maxLines: 1,
  })
  drawWrappedText(context, payload.summary, 44, 190, 662, 30, {
    size: 21,
    color: COLORS.secondary,
    maxLines: 2,
  })

  let y = 258
  roundedRect(context, 44, y, 662, 82, 22, COLORS.blueSoft)
  drawText(context, '结果性质', 70, y + 31, 16, COLORS.tertiary, 400)
  drawText(context, payload.trustLabel, 70, y + 61, 23, COLORS.blue, 650)
  drawText(context, payload.generatedAt, 680, y + 49, 17, COLORS.tertiary, 400, 'right')

  y += 108
  const bodyHeight = 64 + payload.lines.reduce((total, line) => (
    total + (getLineCountEstimate(line) * 38) + 16
  ), 0)
  roundedRect(context, 44, y, 662, bodyHeight, 28, COLORS.card)
  drawText(context, '详细结果', 72, y + 44, 27, COLORS.text, 650)
  context.setStrokeStyle(COLORS.line)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(72, y + 64)
  context.lineTo(678, y + 64)
  context.stroke()

  let lineY = y + 103
  payload.lines.forEach((line) => {
    const lineCount = drawWrappedText(context, line, 72, lineY, 606, 38, {
      size: 21,
      color: line.startsWith('注：') ? COLORS.tertiary : COLORS.text,
      weight: /^(限幅阈值|建立时间|释放时间)/.test(line) ? 650 : 400,
      maxLines: 2,
    })
    lineY += (lineCount * 38) + 16
  })

  y += bodyHeight + 24
  roundedRect(context, 44, y, 662, 132, 24, '#fff7e8')
  drawText(context, '使用边界', 72, y + 39, 20, '#9a5b00', 650)
  drawWrappedText(context, payload.trustDescription, 72, y + 72, 606, 28, {
    size: 18,
    color: '#7a5421',
    maxLines: 2,
  })

  const footerY = height - 72
  context.setStrokeStyle(COLORS.line)
  context.beginPath()
  context.moveTo(44, footerY - 31)
  context.lineTo(706, footerY - 31)
  context.stroke()
  drawText(context, `版本 ${payload.appVersion} · 产品资料 ${payload.productDataDate}`,
    44, footerY, 16, COLORS.tertiary, 400)
  drawText(context, '音视频工具', 706, footerY, 17, COLORS.tertiary, 500, 'right')
}

module.exports = {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  buildResultReportPayload,
  calculateResultReportHeight,
  drawResultReport,
  getExportDimensions,
}

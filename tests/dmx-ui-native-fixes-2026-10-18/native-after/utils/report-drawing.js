const DEFAULT_TEXT_COLOR = '#1d1d1f'
const REPORT_WIDTH = 750
const MAX_EXPORT_HEIGHT = 4096
const REPORT_COLORS = {
  background: '#f5f5f7',
  card: '#ffffff',
  text: '#1d1d1f',
  secondary: '#6e6e73',
  tertiary: '#8e8e93',
  line: '#e5e5ea',
  blue: '#007aff',
  blueSoft: '#eef6ff',
}

function roundedRect(context, x, y, width, height, radius, fillStyle) {
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
  context.setFillStyle(fillStyle)
  context.fill()
}

function setText(context, size, color = DEFAULT_TEXT_COLOR, weight = 400, align = 'left') {
  context.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`
  context.setFillStyle(color)
  context.setTextAlign(align)
}

function drawText(context, text, x, y, size, color, weight, align) {
  setText(context, size, color, weight, align)
  context.fillText(String(text), x, y)
}

function splitText(context, text, maxWidth, maximumLines = 2) {
  const characters = [...String(text || '')]
  const lines = []
  let line = ''
  characters.forEach((character) => {
    const candidate = line + character
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = character
    } else {
      line = candidate
    }
  })
  if (line) lines.push(line)
  if (lines.length <= maximumLines) return lines
  const output = lines.slice(0, maximumLines)
  let last = output[maximumLines - 1]
  while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
  output[maximumLines - 1] = `${last}…`
  return output
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, options = {}, defaultSize = 18) {
  setText(context, options.size || defaultSize,
    options.color || REPORT_COLORS.secondary, options.weight || 400)
  const lines = splitText(context, text, maxWidth, options.maxLines || 2)
  lines.forEach((line, index) => context.fillText(line, x, y + (index * lineHeight)))
  return lines.length
}

function drawPill(context, text, right, y, options = {}, defaultSize = 18,
  defaultPadding = 28, defaultHeight = 34) {
  const size = options.size || defaultSize
  setText(context, size, options.color || REPORT_COLORS.blue, 600)
  const width = Math.ceil(context.measureText(text).width) + defaultPadding
  const height = options.height || defaultHeight
  roundedRect(context, right - width, y, width, height, height / 2,
    options.background || REPORT_COLORS.blueSoft)
  drawText(context, text, right - (width / 2), y + height - 10, size,
    options.color || REPORT_COLORS.blue, 600, 'center')
}

function getExportDimensions(height) {
  const scale = Math.min(2, MAX_EXPORT_HEIGHT / height)
  return {
    destWidth: Math.round(REPORT_WIDTH * scale),
    destHeight: Math.round(height * scale),
  }
}

module.exports = {
  REPORT_WIDTH,
  REPORT_COLORS,
  roundedRect,
  setText,
  drawText,
  splitText,
  drawWrappedText,
  drawPill,
  getExportDimensions,
}

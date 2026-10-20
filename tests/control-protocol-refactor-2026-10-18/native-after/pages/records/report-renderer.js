const {
  drawText,
  roundedRect,
} = require('../../utils/report-drawing')

const COLORS = Object.freeze({
  paper: '#ffffff',
  text: '#1d1d1f',
  secondary: '#515158',
  muted: '#74747a',
  blue: '#0066cc',
  blueSoft: '#eaf3ff',
  line: '#e5e5ea',
  mono: '#5f6570',
})

function drawReportPage(context, page, project) {
  const width = page.width
  const height = page.height
  const left = 48
  const right = width - left
  context.setFillStyle(COLORS.paper)
  context.fillRect(0, 0, width, height)

  roundedRect(context, left, 35, 168, 32, 16, COLORS.blueSoft)
  drawText(context, 'PROJECT REPORT', left + 84, 57, 14, COLORS.blue, 650, 'center')
  drawText(context, '项目报告', left, 99, 30, COLORS.text, 700)
  page.header.nameLines.forEach((line, index) => {
    drawText(context, line, left, 132 + (index * 27), 20, COLORS.secondary, 600)
  })
  const metaY = 139 + (page.header.nameLines.length * 27)
  drawText(context, `项目编号：${project.id}`, left, metaY, 14, COLORS.muted, 400)
  drawText(context, `生成时间：${page.header.generatedAt}`, right, metaY, 14, COLORS.muted, 400, 'right')
  context.setStrokeStyle(COLORS.line)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(left, metaY + 18)
  context.lineTo(right, metaY + 18)
  context.stroke()

  let y = page.top + page.header.height
  page.lines.forEach((line) => {
    const baseline = y + Math.max(1, Math.round(line.lineHeight * 0.72))
    if (line.style === 'section') {
      roundedRect(context, left, y + 1, width - (left * 2), Math.max(30, line.lineHeight - 4), 12, COLORS.blueSoft)
      drawText(context, line.text, left + 14, baseline, line.size, COLORS.blue, line.weight)
    } else if (line.style === 'heading') {
      drawText(context, line.text, left, baseline, line.size, COLORS.text, line.weight)
    } else if (line.style === 'subhead') {
      drawText(context, line.text, left, baseline, line.size, COLORS.blue, line.weight)
    } else if (line.style === 'muted') {
      drawText(context, line.text, left, baseline, line.size, COLORS.muted, line.weight)
    } else if (line.style === 'mono') {
      drawText(context, line.text, left, baseline, line.size, COLORS.mono, line.weight)
    } else if (line.text) {
      drawText(context, line.text, left, baseline, line.size, COLORS.secondary, line.weight)
    }
    y += line.lineHeight
  })

  const footerY = height - 34
  context.setStrokeStyle(COLORS.line)
  context.beginPath()
  context.moveTo(left, footerY - 18)
  context.lineTo(right, footerY - 18)
  context.stroke()
  drawText(context, '音视频系统项目数据汇总', left, footerY, 13, COLORS.muted, 400)
  drawText(context, `第 ${page.pageNumber} / ${page.pageCount} 页`, right, footerY, 14, COLORS.muted, 500, 'right')
}

module.exports = { drawReportPage }

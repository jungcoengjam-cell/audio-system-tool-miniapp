const REPORT_CANVAS_ID = 'projectReportCanvas'
const MAX_REPORT_RECORDS = 12
const { MODULES } = require('../../utils/records')
const {
  REPORT_WIDTH,
  REPORT_COLORS,
  roundedRect,
  setText,
  drawText,
  splitText,
  drawWrappedText,
  drawPill: drawPillShared,
  getExportDimensions,
} = require('../../utils/report-drawing')

const COLORS = {
  ...REPORT_COLORS,
  green: '#2b9a66',
}

const THEME_COLORS = {
  cyan: '#27b7ca',
  violet: '#6f6ce8',
  amber: '#e09a20',
  green: '#37a67a',
  blue: '#007aff',
  teal: '#087f70',
  indigo: '#5856d6',
}

function drawClippedText(context, text, x, y, maxWidth, options = {}) {
  setText(context, options.size || 18, options.color || COLORS.text,
    options.weight || 400, options.align || 'left')
  const [line = ''] = splitText(context, text, maxWidth, 1)
  context.fillText(line, x, y)
}

function drawPill(context, text, right, y, options = {}) {
  return drawPillShared(context, text, right, y, options, 17, 26, 33)
}

function limitGroups(groups) {
  const sourceGroups = (groups || []).filter((group) => group.records?.length)
  const selectedByModule = Object.create(null)
  let selectedCount = 0

  sourceGroups.forEach((group) => {
    if (selectedCount >= MAX_REPORT_RECORDS) return
    selectedByModule[group.module] = [group.records[0]]
    selectedCount += 1
  })
  sourceGroups.forEach((group) => {
    for (let index = 1; index < group.records.length && selectedCount < MAX_REPORT_RECORDS; index += 1) {
      selectedByModule[group.module].push(group.records[index])
      selectedCount += 1
    }
  })

  return {
    groups: sourceGroups.map((group) => ({
      ...group,
      records: selectedByModule[group.module] || [],
    })).filter((group) => group.records.length),
    omittedCount: Math.max(0,
      sourceGroups.reduce((total, group) => total + group.records.length, 0) - selectedCount),
  }
}

function calculateProjectReportHeight(payload) {
  const groupCount = payload.groups.length
  const recordCount = payload.groups.reduce((total, group) => total + group.records.length, 0)
  return 700 + (groupCount * 76) + (recordCount * 126) + (payload.omittedCount ? 54 : 0) + 138
}

function buildProjectReportPayload(project, groups, metadata = {}) {
  if (!project || !groups?.length) return null
  const limited = limitGroups(groups)
  return {
    project,
    groups: limited.groups,
    omittedCount: limited.omittedCount,
    completedModuleCount: groups.length,
    totalModuleCount: metadata.totalModuleCount || Object.keys(MODULES).length,
    generatedAt: metadata.generatedAt || '',
    appVersion: metadata.appVersion || '',
    productDataDate: metadata.productDataDate || '',
  }
}

function drawProjectInfo(context, payload) {
  const { project } = payload
  roundedRect(context, 44, 212, 662, 284, 28, COLORS.card)
  drawText(context, '项目资料', 74, 258, 27, COLORS.text, 650)
  drawPill(context, `${project.recordCount} 条记录`, 676, 232, {
    color: COLORS.green,
    background: '#eaf7f0',
  })

  const rows = [
    ['场地名称', project.venueName || '未填写', '调试日期', project.projectDate || '未填写'],
    ['调试人员', project.engineer || '未填写', '场地尺寸', project.dimensionText || '未填写'],
    ['扩声目标', project.standardText || '未填写', '更新时间', project.timeText || '未填写'],
  ]
  rows.forEach((row, index) => {
    const y = 296 + (index * 49)
    drawText(context, row[0], 74, y, 16, COLORS.tertiary, 400)
    drawClippedText(context, row[1], 158, y, 190, { size: 19, weight: 550 })
    drawText(context, row[2], 390, y, 16, COLORS.tertiary, 400)
    drawClippedText(context, row[3], 474, y, 190, { size: 19, weight: 550 })
  })
  context.setStrokeStyle(COLORS.line)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(74, 438)
  context.lineTo(676, 438)
  context.stroke()
  drawText(context, '现场备注', 74, 469, 16, COLORS.tertiary, 400)
  drawWrappedText(context, project.notes || '暂无备注', 158, 469, 500, 23, {
    size: 18,
    color: COLORS.secondary,
    maxLines: 2,
  })
}

function drawProgress(context, payload) {
  roundedRect(context, 44, 520, 662, 132, 25, COLORS.blueSoft)
  drawText(context, '项目汇总', 74, 558, 20, COLORS.blue, 650)
  drawText(context, `${payload.completedModuleCount} / ${payload.totalModuleCount}`, 74, 611,
    34, COLORS.text, 700)
  drawText(context, '已归档模块', 202, 611, 17, COLORS.tertiary, 400)
  drawText(context, `${payload.project.recordCount}`, 390, 611, 34, COLORS.text, 700)
  drawText(context, '计算记录', 442, 611, 17, COLORS.tertiary, 400)
  drawText(context, payload.generatedAt, 676, 611, 17, COLORS.tertiary, 400, 'right')
}

function drawRecord(context, record, group, x, y, width) {
  const height = 112
  roundedRect(context, x, y, width, height, 20, '#fafafa')
  context.setFillStyle(THEME_COLORS[group.theme] || COLORS.blue)
  context.fillRect(x, y + 14, 5, height - 28)
  drawClippedText(context, record.title, x + 22, y + 31, width - 190, {
    size: 22,
    weight: 650,
  })
  drawText(context, record.timeText, x + width - 18, y + 31, 15, COLORS.tertiary, 400, 'right')
  drawWrappedText(context, record.summary, x + 22, y + 65, width - 44, 22, {
    size: 17,
    color: COLORS.secondary,
    maxLines: 2,
  })
}

function drawProjectResults(context, payload) {
  let y = 692
  drawText(context, '项目结果', 44, y, 31, COLORS.text, 700)
  drawText(context, '按模块归类', 706, y, 18, COLORS.tertiary, 400, 'right')
  y += 30

  payload.groups.forEach((group) => {
    y += 36
    drawText(context, group.label, 44, y, 24, COLORS.text, 650)
    drawPill(context, group.trustLabel, 706, y - 24, {
      size: 15,
      color: THEME_COLORS[group.theme] || COLORS.blue,
      background: '#ffffff',
      height: 30,
    })
    y += 18
    group.records.forEach((record) => {
      y += 12
      drawRecord(context, record, group, 44, y, 662)
      y += 114
    })
    y += 10
  })

  if (payload.omittedCount) {
    roundedRect(context, 44, y + 10, 662, 44, 15, '#fff7e8')
    drawText(context, `另有 ${payload.omittedCount} 条记录未在长图展开，可复制文字报告查看。`,
      375, y + 38, 17, '#9a5b00', 500, 'center')
    y += 54
  }
  return y
}

function drawProjectReport(context, payload, height) {
  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, REPORT_WIDTH, height)

  roundedRect(context, 44, 42, 146, 34, 17, COLORS.blueSoft)
  drawText(context, 'PROJECT REPORT', 117, 66, 16, COLORS.blue, 650, 'center')
  drawWrappedText(context, payload.project.name, 44, 126, 662, 50, {
    size: 39,
    color: COLORS.text,
    weight: 700,
    maxLines: 1,
  })
  drawText(context,
    `${payload.project.venueName || '现场项目'} · ${payload.project.projectDate || '日期未填写'}`,
    44, 190, 20, COLORS.secondary, 400)

  drawProjectInfo(context, payload)
  drawProgress(context, payload)
  const contentBottom = drawProjectResults(context, payload)
  const footerY = Math.max(contentBottom + 58, height - 104)
  context.setStrokeStyle(COLORS.line)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(44, footerY - 34)
  context.lineTo(706, footerY - 34)
  context.stroke()
  drawText(context, '本报告为项目内计算结果汇总，不替代现场测量、工程复核与最终深化。',
    44, footerY, 17, COLORS.tertiary, 400)
  drawText(context, `版本 ${payload.appVersion} · 产品资料 ${payload.productDataDate}`,
    44, footerY + 35, 16, COLORS.tertiary, 400)
  drawText(context, '音视频工具', 706, footerY + 35, 17, COLORS.tertiary, 500, 'right')
}

module.exports = {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  buildProjectReportPayload,
  calculateProjectReportHeight,
  drawProjectReport,
  getExportDimensions,
}

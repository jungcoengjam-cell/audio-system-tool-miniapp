const {
  buildMaterialSummary,
  buildScheduleText,
  normalizeSchedule,
  CABLE_OPTIONS,
  CONNECTOR_OPTIONS,
  STATUS_OPTIONS,
} = require('../../utils/project-wiring')

const REPORT_WIDTH = 720
const MAX_PAGE_HEIGHT = 1750
const CONTENT_BOTTOM = 1640
const BODY_WIDTH = 608
const BODY_SIZE = 22
const BODY_LINE_HEIGHT = 32

const LIGHT = Object.freeze({
  background: '#f5f5f7', card: '#ffffff', text: '#1d1d1f', secondary: '#5f5f64',
  tertiary: '#74747a', border: '#e1e1e6', accent: '#0066cc', accentSoft: '#eaf3ff',
  warning: '#8a5700', warningSoft: '#fff5df', source: '#2872c7', destination: '#7358c7',
})
const DARK = Object.freeze({
  background: '#000000', card: '#1c1c1e', text: '#f5f5f7', secondary: '#c5c5cb',
  tertiary: '#a0a0a7', border: '#38383a', accent: '#69aef7', accentSoft: '#172b43',
  warning: '#ffbf5c', warningSoft: '#3a2d17', source: '#76b8ff', destination: '#bea6ff',
})
function labelsById(options) {
  const labels = {}
  options.forEach((item) => { labels[item.id] = item.label })
  return Object.freeze(labels)
}

const CABLE_LABELS = labelsById(CABLE_OPTIONS)
const CONNECTOR_LABELS = labelsById(CONNECTOR_OPTIONS)
const STATUS_LABELS = labelsById(STATUS_OPTIONS)
const CLOSING_PUNCTUATION = new Set([...`，。；：、！？）》】〕〉”’」』…％,.;:!?)]}`])

function estimatedCharacterWidth(character, size) {
  if (/\s/.test(character)) return size * 0.34
  if (/^[\x00-\xff]$/.test(character)) return size
  return size
}

function wrapText(value, width = BODY_WIDTH, size = BODY_SIZE) {
  const result = []
  String(value || '').split(/\r?\n/).forEach((part) => {
    const words = [...part]
    let line = ''
    let lineWidth = 0
    words.forEach((character) => {
      const nextWidth = estimatedCharacterWidth(character, size)
      if (line && lineWidth + nextWidth > width) {
        if (CLOSING_PUNCTUATION.has(character) && [...line].length > 1) {
          const parts = [...line]
          const carried = parts.pop()
          result.push(parts.join(''))
          line = `${carried}${character}`
          lineWidth = [...line].reduce((sum, item) => sum + estimatedCharacterWidth(item, size), 0)
        } else {
          result.push(line)
          line = character
          lineWidth = nextWidth
        }
      } else {
        line += character
        lineWidth += nextWidth
      }
    })
    result.push(line)
  })
  return result.length ? result : ['']
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.keys(value).forEach((key) => freezeDeep(value[key]))
  return Object.freeze(value)
}

function materialItemText(item) {
  const title = item.title.replace(/规格待填写/g, '规格待确认')
  if (item.key.startsWith('bulk:')) {
    const length = item.unknownLengthCount
      ? `已知长度：${item.quantity} m · 待确认长度：${item.unknownLengthCount} 条`
      : `总长度：${item.totalLengthText}`
    return [title, length]
  }
  if (item.key.startsWith('connector:')) {
    return [title, item.quantity === null ? item.detail : `数量：${item.quantity} ${item.unit}`]
  }
  return [title, item.detail, `数量：${item.quantity} ${item.unit}`, `总长：${item.totalLengthText}`]
}

function buildRows(schedule, summary, type) {
  if (type === 'materials') {
    const rows = []
    const sections = [
      ['成品线（含两端接头）', summary.finished],
      ['散线', summary.bulk],
      ['散线接头（单独核对）', summary.connectors],
    ]
    sections.forEach(([title, items]) => {
      if (!items.length) return
      rows.push({ kind: 'section', title, textLines: [title] })
      items.forEach((item, index) => rows.push({
        kind: 'material',
        key: item.key,
        number: index + 1,
        title: item.title,
        detail: item.detail,
        quantity: item.quantity,
        unit: item.unit,
        lengthText: item.lengthText,
        totalLengthText: item.totalLengthText,
        unknownLengthCount: item.unknownLengthCount,
        textLines: materialItemText(item),
      }))
    })
    const incompleteLineCount = schedule.lines.filter((line) => !line.spec || !line.connectorA
      || !line.connectorB || !line.lengthText).length
    if (rows.length && incompleteLineCount) rows.unshift({
      kind: 'notice',
      textLines: [`有 ${incompleteLineCount} 条线路资料待补全；缺项不作为确定采购量。`],
    })
    return rows
  }

  if (type === 'labels') {
    const labels = summary.labels || []
    return labels.map((label, index) => ({
      kind: 'label',
      key: `${label.code}:${label.direction}:${index}`,
      code: label.code,
      local: label.local,
      remote: label.remote,
      direction: label.direction,
      side: label.direction === 'to' ? '源端标签' : '目的端标签',
      textLines: [
        `${label.code} · ${label.direction === 'to' ? '源端标签' : '目的端标签'}`,
        `本端：${label.local}`,
        `对端：${label.remote}`,
      ],
    }))
  }

  return schedule.lines.map((line, index) => {
    const from = [line.fromDevice, line.fromPort].filter(Boolean).join(' / ')
    const to = [line.toDevice, line.toPort].filter(Boolean).join(' / ')
    const spec = line.spec || '规格待确认'
    const connectorA = CONNECTOR_LABELS[line.connectorA] || (line.connectorA || '接头待确认')
    const connectorB = CONNECTOR_LABELS[line.connectorB] || (line.connectorB || '接头待确认')
    const cable = CABLE_LABELS[line.cableType] || '线材待确认'
    const length = line.lengthText ? `${line.lengthText} m` : '长度待确认'
    return {
      kind: 'line',
      key: line.id,
      number: index + 1,
      code: line.code,
      purpose: line.purpose || '用途待填写',
      status: STATUS_LABELS[line.status] || '状态待确认',
      from,
      to,
      cable,
      spec,
      connectorA,
      connectorB,
      length,
      notes: line.notes || '',
      textLines: [
        `${index + 1}. ${line.code} · ${line.purpose || '用途待填写'} · ${STATUS_LABELS[line.status] || '状态待确认'}`,
        `起点：${from} → 终点：${to}`,
        `线材：${cable} · 规格：${spec}`,
        `两端接头：${connectorA} → ${connectorB} · 长度：${length}`,
        ...(line.notes ? [`备注：${line.notes}`] : []),
      ],
    }
  })
}

function layoutRows(sourceRows, startY) {
  let y = startY
  return sourceRows.map((source) => {
    const fontSize = source.kind === 'section' ? 18 : BODY_SIZE
    const wrapped = source.textLines.flatMap((line) => wrapText(line, BODY_WIDTH, fontSize))
    const padding = source.kind === 'section' ? 14 : 22
    const lineHeight = source.kind === 'section' ? 30 : BODY_LINE_HEIGHT
    const height = Math.max(source.kind === 'section' ? 44 : 54, padding + (wrapped.length * lineHeight))
    const row = {
      ...source,
      lines: wrapped,
      y,
      height,
      fontSize,
      lineHeight,
    }
    y += height + (source.kind === 'section' ? 2 : 10)
    return row
  })
}

function splitOversizedRows(rows, availableHeight) {
  const maxLines = Math.max(1, Math.floor((availableHeight - 80) / BODY_LINE_HEIGHT))
  return rows.flatMap((row) => {
    const measured = layoutRows([row], 0)[0]
    if (measured.height <= availableHeight) return [row]
    const chunks = []
    for (let index = 0; index < measured.lines.length; index += maxLines) {
      const lines = measured.lines.slice(index, index + maxLines)
      chunks.push(index === 0 ? { ...row, textLines: lines }
        : {
          ...row,
          kind: 'continuation',
          key: `${row.key || row.kind}:continuation:${index}`,
          textLines: [`${row.code || '内容'}（续）`, ...lines],
        })
    }
    return chunks
  })
}

function paginateRows(rows, projectName, title, subtitleLines, type) {
  const nameLines = wrapText(projectName, BODY_WIDTH, 19)
  const subtitleY = 132 + (nameLines.length * 25) + 3
  const startY = subtitleY + (subtitleLines.length * 20) + 10
  const availableHeight = CONTENT_BOTTOM - startY
  const pageableRows = splitOversizedRows(rows, availableHeight)
  const groups = []
  let group = []
  let used = 0
  pageableRows.forEach((row, index) => {
    const measured = layoutRows([row], 0)[0]
    const rowHeight = measured.height + (row.kind === 'section' ? 2 : 10)
    const nextRow = pageableRows[index + 1]
    const nextMeasured = nextRow ? layoutRows([nextRow], 0)[0] : null
    const nextHeight = nextMeasured ? nextMeasured.height + 10 : 0
    if (row.kind === 'section' && group.length && used + rowHeight + nextHeight > availableHeight) {
      groups.push(group)
      group = []
      used = 0
    }
    if (group.length && used + rowHeight > availableHeight) {
      groups.push(group)
      group = []
      used = 0
    }
    group.push(row)
    used += rowHeight
  })
  if (group.length) groups.push(group)
  return groups.map((pageRows, index) => {
    const pageLayout = layoutRows(pageRows, startY)
    const contentEnd = pageLayout.reduce((bottom, row) => Math.max(bottom, row.y + row.height), startY)
    const height = Math.min(MAX_PAGE_HEIGHT, Math.max(520, contentEnd + 88))
    return freezeDeep({
      type,
      title,
      projectName,
      width: REPORT_WIDTH,
      height,
      pageNumber: index + 1,
      pageCount: groups.length,
      nameLines,
      subtitleLines,
      rows: pageLayout,
      footer: `项目布线资料 · 第 ${index + 1} / ${groups.length} 页 · 以现场核对为准`,
    })
  })
}

function buildScheduleReportPages(projectName, scheduleValue, type = 'lines') {
  const normalizedType = ['lines', 'materials', 'labels'].includes(type) ? type : 'lines'
  const schedule = normalizeSchedule(scheduleValue)
  const summary = buildMaterialSummary(schedule)
  const name = String(projectName || '').trim() || '未命名项目'
  const titles = { lines: '线路明细', materials: '材料清单', labels: '双端线号标签' }
  const summaryLine = normalizedType === 'materials'
    ? `已知总长 ${summary.knownLengthText} · ${summary.unknownLengthCount} 条长度待确认`
    : normalizedType === 'labels'
      ? `共 ${summary.labels.length} 张标签 · 每条线路两端各一张`
      : `共 ${summary.lineCount} 条线路 · ${summary.checkedCount} 条已核对 · ${summary.lineCount - summary.checkedCount} 条待核对`
  const text = buildScheduleText(name, schedule).replace(/规格待填写/g, '规格待确认')
  const rows = buildRows(schedule, summary, normalizedType)
  const pages = rows.length ? paginateRows(rows, name, titles[normalizedType], [summaryLine], normalizedType) : []
  return freezeDeep({ pages, text, lineCount: summary.lineCount, type: normalizedType })
}

function palette(theme) {
  return theme === 'dark' ? DARK : LIGHT
}

function setText(context, size, color, weight = 400, align = 'left') {
  context.setFontSize(size)
  context.setFillStyle(color)
  context.setTextAlign(align)
  context.setTextBaseline('alphabetic')
  context.font = `${weight} ${size}px sans-serif`
}

function drawText(context, value, x, y, size, color, weight = 400, align = 'left') {
  setText(context, size, color, weight, align)
  context.fillText(String(value), x, y)
}

function roundedRect(context, x, y, width, height, radius, fill, stroke) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
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
  context.setFillStyle(fill)
  context.fill()
  if (stroke) {
    context.setStrokeStyle(stroke)
    context.setLineWidth(1)
    context.stroke()
  }
}

function drawScheduleReport(context, page, options = {}) {
  if (!context || !page || !Array.isArray(page.rows)) throw new TypeError('布线报告页面无效')
  const colors = palette(options.theme)
  context.setFillStyle(colors.background)
  context.fillRect(0, 0, page.width, page.height)
  roundedRect(context, 40, 30, 168, 34, 17, colors.accentSoft)
  drawText(context, '项目布线资料', 124, 53, 15, colors.accent, 600, 'center')
  drawText(context, page.title, 40, 98, 30, colors.text, 700)
  let nameY = 132
  page.nameLines.forEach((line, index) => {
    drawText(context, line, 40, nameY + (index * 25), 19, colors.secondary, 500)
  })
  const subtitleY = nameY + (page.nameLines.length * 25) + 3
  page.subtitleLines.forEach((line, index) => drawText(context, line, 40,
    subtitleY + (index * 20), 14, colors.tertiary, 500))
  page.rows.forEach((row) => {
    const cardColor = row.kind === 'notice' ? colors.warningSoft : colors.card
    roundedRect(context, 40, row.y, 640, row.height, row.kind === 'label' ? 18 : 14,
      cardColor, colors.border)
    if (row.kind === 'label') {
      const sideColor = row.direction === 'to' ? colors.source : colors.destination
      context.setFillStyle(sideColor)
      context.fillRect(40, row.y + 8, 5, row.height - 16)
    }
    row.lines.forEach((line, index) => {
      const isHeadline = index === 0 && ['line', 'material', 'label', 'section', 'continuation'].includes(row.kind)
      const color = row.kind === 'notice' ? colors.warning
        : row.kind === 'label' && index === 0 ? (row.direction === 'to' ? colors.source : colors.destination)
          : isHeadline ? colors.text : colors.secondary
      drawText(context, line, 56, row.y + 25 + (index * row.lineHeight), row.fontSize, color,
        isHeadline ? 600 : 400)
    })
  })
  context.setStrokeStyle(colors.border)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(40, page.height - 60)
  context.lineTo(680, page.height - 60)
  context.stroke()
  drawText(context, page.footer, 40, page.height - 30, 13, colors.tertiary, 400)
  return { height: page.height, contentHeight: page.height }
}

module.exports = {
  buildScheduleReportPages,
  drawScheduleReport,
}

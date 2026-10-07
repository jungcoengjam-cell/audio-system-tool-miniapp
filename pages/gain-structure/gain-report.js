const {
  REPORT_WIDTH,
  REPORT_COLORS,
  roundedRect,
  setText,
  drawText,
} = require('../../utils/report-drawing')

const COLORS = {
  ...REPORT_COLORS,
  card: '#ffffff',
  hero: '#eaf7f5',
  heroBorder: '#c5e5de',
  accent: '#087f70',
  warning: '#fff4e5',
  warningText: '#8a5700',
  tile: '#eef6ff',
  tileBorder: '#d6e5f4',
}

const LEFT = 44
const CONTENT_WIDTH = REPORT_WIDTH - (LEFT * 2)
const GAP = 14

function textValue(value) {
  return value == null ? '' : String(value)
}

function splitLabelValue(line) {
  const source = textValue(line)
  const fullWidthColon = source.indexOf('：')
  const asciiColon = source.indexOf(':')
  const colonIndex = fullWidthColon >= 0 ? fullWidthColon : asciiColon
  if (colonIndex < 0) return { label: '', value: source }
  return {
    label: source.slice(0, colonIndex).trim(),
    value: source.slice(colonIndex + 1).trim(),
  }
}

function findField(lines, label) {
  const match = lines.map(splitLabelValue).find((field) => field.label === label)
  return match ? match.value : ''
}

function getCanonicalResultNature(resultText) {
  const line = textValue(resultText).split(/\r?\n/)
    .find((item) => item.startsWith('结果性质：'))
  return line ? line.slice('结果性质：'.length).trim() : ''
}

function wrapText(context, text, maxWidth, size, weight = 400) {
  const source = textValue(text)
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    throw new RangeError('无法生成增益结果图片：文本宽度无效。')
  }
  if (!context || typeof context.measureText !== 'function') {
    throw new TypeError('无法生成增益结果图片：缺少文本测量画布。')
  }

  setText(context, size, COLORS.text, weight)
  const lines = []
  source.split(/\r\n?|\n/).forEach((paragraph) => {
    if (!paragraph) {
      lines.push('')
      return
    }
    let line = ''
    const tokens = paragraph.match(/(?:[+-]?\d+(?:\.\d+)?\s*(?:dBFS|dBu|dB|V|W|Ω|ohm)(?![A-Za-z]))|\s+|./gu) || []
    const appendCharacter = (character) => {
      const candidate = line + character
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.replace(/\s+$/, ''))
        line = character.replace(/^\s+/, '')
      } else {
        line = candidate
      }
    }
    tokens.forEach((token) => {
      if (/^\s+$/.test(token)) {
        if (line && context.measureText(line + token).width <= maxWidth) line += token
        return
      }
      if (line && context.measureText(line + token).width > maxWidth) {
        lines.push(line.replace(/\s+$/, ''))
        line = ''
      }
      if (context.measureText(token).width > maxWidth) {
        Array.from(token).forEach(appendCharacter)
      } else {
        line += token
      }
    })
    lines.push(line.replace(/\s+$/, ''))
  })
  return lines.length ? lines : ['']
}

function addTextLines(commands, lines, x, top, lineHeight, size, color,
  weight = 400, align = 'left') {
  lines.forEach((line, index) => {
    commands.push({
      type: 'text', text: line, x, y: top + size + (index * lineHeight),
      size, color, weight, align,
    })
  })
  return lines.length * lineHeight
}

function addSectionTitle(commands, context, title, y) {
  const lines = wrapText(context, title, CONTENT_WIDTH, 24, 650)
  return y + addTextLines(commands, lines, LEFT, y, 32, 24, COLORS.text, 650) + 10
}

function addKeyValueRow(commands, context, label, value, y, options = {}) {
  const labelWidth = options.labelWidth || 220
  const labelSize = options.labelSize || 24
  const valueSize = options.valueSize || 30
  const labelLineHeight = options.labelLineHeight || 32
  const valueLineHeight = options.valueLineHeight || 40
  const columnGap = options.columnGap || 14
  const labelLines = wrapText(context, label, labelWidth, labelSize, 500)
  const valueLines = wrapText(context, value || '—',
    CONTENT_WIDTH - labelWidth - columnGap, valueSize, 500)
  const rowHeight = Math.max(labelLines.length * labelLineHeight,
    valueLines.length * valueLineHeight)
  addTextLines(commands, labelLines, LEFT, y, labelLineHeight,
    labelSize, COLORS.secondary, 500)
  addTextLines(commands, valueLines, LEFT + labelWidth + columnGap, y,
    valueLineHeight, valueSize, COLORS.text, 500)
  return rowHeight + (options.bottomGap == null ? 12 : options.bottomGap)
}

function addRoundedCard(commands, x, y, width, height, fill, stroke) {
  commands.push({ type: 'roundRect', x, y, width, height, radius: 22, fill })
  if (stroke) {
    commands.push({
      type: 'roundRectStroke', x, y, width, height, radius: 22,
      color: stroke, lineWidth: 1,
    })
  }
}

function drawCard(context, command) {
  const { x, y, width, height, radius } = command
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
  context.setStrokeStyle(command.color)
  context.setLineWidth(command.lineWidth)
  context.stroke()
}

function getAdjustment(value) {
  const source = textValue(value)
  const numberMatch = /(-?\d+(?:\.\d+)?)\s*dB\b/i.exec(source)
  const isDriveShortfall = /驱动差额|驱动不足|余量不足/.test(source)
  const isAttenuation = /系统对齐衰减|建议衰减|系统衰减/.test(source)
  const label = isDriveShortfall
    ? '驱动差额'
    : isAttenuation ? '系统对齐衰减'
      : source ? '系统对齐结果' : '调整量未提供'
  const displayValue = numberMatch
    ? `${numberMatch[1]} dB`
    : source ? source : '—'
  return { label, displayValue, isDriveShortfall }
}

function buildReportModel(payload, measureContext) {
  if (!payload || !Array.isArray(payload.lines)) {
    throw new TypeError('无法生成增益结果图片：输入内容无效。')
  }
  if (!measureContext || typeof measureContext.measureText !== 'function') {
    throw new TypeError('无法生成增益结果图片：缺少文本测量画布。')
  }

  const lines = payload.lines.map((line) => textValue(line))
  const fields = {
    target: findField(lines, '目标峰值'),
    ratedInput: findField(lines, '功放额定输出输入点'),
    adjustment: getAdjustment(lines.find((line) => /驱动差额|驱动不足|系统对齐衰减/.test(line)) || ''),
    execution: findField(lines, '衰减执行位置'),
    dspInput: findField(lines, 'DSP 输入表目标'),
    dspOutput: findField(lines, 'DSP 最终输出增益'),
    amplifierKnob: findField(lines, '功放输入电平控制'),
    placementWarning: lines.find((line) => (
      line.includes('DSP') && line.includes('衰减') && line.includes('功放')
    )) || '',
  }
  const numericAdjustment = /-?\d+(?:\.\d+)?\s*dB\b/i.test(fields.adjustment.displayValue)
  const numericTarget = /-?\d+(?:\.\d+)?\s*dBFS\b/i.test(fields.target)
    && /-?\d+(?:\.\d+)?\s*dBu\b/i.test(fields.target)
  const numericRatedInput = /\d+(?:\.\d+)?\s*V\b/i.test(fields.ratedInput)
    && /-?\d+(?:\.\d+)?\s*dBu\b/i.test(fields.ratedInput)
  if (!numericAdjustment || !numericTarget || !numericRatedInput) {
    throw new TypeError('无法生成增益结果图片：缺少规范的调整值、DSP 目标峰值或功放额定输入点。')
  }

  const commands = []
  let y = 32
  const badge = textValue(payload.moduleLabel) || '系统增益结构'
  const badgeLines = wrapText(measureContext, badge, CONTENT_WIDTH - 32, 18, 650)
  const badgeHeight = Math.max(38, 16 + badgeLines.length * 24)
  addRoundedCard(commands, LEFT, y, Math.min(CONTENT_WIDTH, 210), badgeHeight,
    COLORS.tile, COLORS.tileBorder)
  y += 7
  y += addTextLines(commands, badgeLines, LEFT + 16, y, 24, 18,
    COLORS.accent, 650) + 28

  const heroTop = y
  const heroPadding = 24
  const heroLabelLines = wrapText(measureContext, fields.adjustment.label,
    CONTENT_WIDTH - (heroPadding * 2), 23, 650)
  const heroValueLines = wrapText(measureContext, fields.adjustment.displayValue,
    CONTENT_WIDTH - (heroPadding * 2), 72, 720)
  const heroText = []
  let heroY = heroTop + heroPadding
  heroY += addTextLines(heroText, heroLabelLines, REPORT_WIDTH / 2, heroY,
    31, 23, fields.adjustment.isDriveShortfall ? COLORS.warningText : COLORS.accent,
    650, 'center') + 8
  heroY += addTextLines(heroText, heroValueLines, REPORT_WIDTH / 2, heroY,
    84, 72, COLORS.text, 720, 'center')
  const heroHeight = Math.ceil(heroY - heroTop + heroPadding)
  addRoundedCard(commands, LEFT, heroTop, CONTENT_WIDTH, heroHeight,
    fields.adjustment.isDriveShortfall ? COLORS.warning : COLORS.hero,
    fields.adjustment.isDriveShortfall ? '#f0d4ad' : COLORS.heroBorder)
  commands.push(...heroText)
  y = heroTop + heroHeight + 20

  const metricGap = 12
  const metricWidth = (CONTENT_WIDTH - metricGap) / 2
  const metrics = [
    { label: 'DSP 目标峰值', value: fields.target },
    { label: '功放额定输入点', value: fields.ratedInput },
  ]
  const metricModels = metrics.map((metric, index) => {
    const x = LEFT + (index * (metricWidth + metricGap))
    const innerWidth = metricWidth - 32
    const labelLines = wrapText(measureContext, metric.label, innerWidth, 24, 600)
    const valueLines = wrapText(measureContext, metric.value || '—', innerWidth, 30, 650)
    const height = Math.max(142, 22 + (labelLines.length * 32) + 10 + (valueLines.length * 40) + 22)
    const cardCommands = []
    let metricY = y + 18
    metricY += addTextLines(cardCommands, labelLines, x + 16, metricY,
      32, 24, COLORS.secondary, 600)
    metricY += 10
    addTextLines(cardCommands, valueLines, x + 16, metricY,
      40, 30, COLORS.text, 650)
    return { x, height, cardCommands }
  })
  const metricsHeight = Math.max(...metricModels.map((metric) => metric.height))
  metricModels.forEach((metric) => {
    addRoundedCard(commands, metric.x, y, metricWidth, metricsHeight,
      COLORS.tile, COLORS.tileBorder)
    commands.push(...metric.cardCommands)
  })
  y += metricsHeight + 26

  y = addSectionTitle(commands, measureContext, '衰减执行位置与设备设置', y)
  const placementTop = y
  const placementCommands = []
  let placementY = placementTop + 20
  placementY += addKeyValueRow(placementCommands, measureContext,
    '衰减执行位置', fields.execution, placementY)
  placementY += addKeyValueRow(placementCommands, measureContext,
    'DSP 输入表目标', fields.dspInput, placementY)
  placementY += addKeyValueRow(placementCommands, measureContext,
    'DSP 最终输出增益', fields.dspOutput, placementY)
  placementY += addKeyValueRow(placementCommands, measureContext,
    '功放输入电平控制', fields.amplifierKnob, placementY, { bottomGap: 8 })
  const placementHeight = Math.ceil(placementY - placementTop + 16)
  addRoundedCard(commands, LEFT, placementTop, CONTENT_WIDTH, placementHeight,
    COLORS.card, COLORS.line)
  commands.push(...placementCommands)
  y = placementTop + placementHeight + 12

  if (fields.placementWarning) {
    const warningLines = wrapText(measureContext, fields.placementWarning,
      CONTENT_WIDTH - 36, 24, 600)
    const warningHeight = Math.max(72, 20 + (warningLines.length * 34) + 16)
    addRoundedCard(commands, LEFT, y, CONTENT_WIDTH, warningHeight,
      COLORS.warning, '#f0d4ad')
    addTextLines(commands, warningLines, LEFT + 18, y + 12,
      34, 24, COLORS.warningText, 600)
    y += warningHeight + 20
  } else {
    y += 8
  }

  const traceabilityRows = [
    `生成时间：${textValue(payload.generatedAt)}`,
    `小程序版本：${textValue(payload.appVersion)} · 产品资料日期：${textValue(payload.productDataDate)}`,
  ].filter((row) => !row.endsWith('：'))
  if (traceabilityRows.length) {
    const footerTop = y + 2
    commands.push({
      type: 'line', x: LEFT, y: footerTop, width: CONTENT_WIDTH,
      color: COLORS.line, lineWidth: 1,
    })
    let footerY = footerTop + 14
    traceabilityRows.forEach((row) => {
      const footerLines = wrapText(measureContext, row, CONTENT_WIDTH, 18, 400)
      footerY += addTextLines(commands, footerLines, LEFT, footerY,
        26, 18, COLORS.tertiary, 400) + 2
    })
    y = footerY + 8
  } else {
    y += 18
  }
  return { commands, height: Math.ceil(y) }
}

function calculateResultReportHeight(payload, measureContext) {
  return buildReportModel(payload, measureContext).height
}

function drawResultReport(context, payload, height) {
  const model = buildReportModel(payload, context)
  if (model.height > height) {
    throw new RangeError('增益结果图片的高度与实际排版不匹配。')
  }
  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, REPORT_WIDTH, height)
  model.commands.forEach((command) => {
    if (command.type === 'roundRect') {
      roundedRect(context, command.x, command.y, command.width, command.height,
        command.radius, command.fill)
    } else if (command.type === 'roundRectStroke') {
      drawCard(context, command)
    } else if (command.type === 'line') {
      context.beginPath()
      context.moveTo(command.x, command.y)
      context.lineTo(command.x + command.width, command.y)
      context.setStrokeStyle(command.color)
      context.setLineWidth(command.lineWidth)
      context.stroke()
    } else if (command.type === 'text') {
      drawText(context, command.text, command.x, command.y, command.size,
        command.color, command.weight, command.align)
    }
  })
}

module.exports = {
  calculateResultReportHeight,
  drawResultReport,
  getCanonicalResultNature,
}

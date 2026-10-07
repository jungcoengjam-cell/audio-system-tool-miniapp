const {
  REPORT_WIDTH,
  roundedRect,
  drawText,
  setText,
} = require('../../utils/report-drawing')

const COLORS = {
  background: '#f5f5f7',
  card: '#eef6ff',
  cardBorder: '#c8dcf2',
  text: '#1d1d1f',
  secondary: '#6e6e73',
  tertiary: '#6e6e73',
  line: '#d9dfe8',
  result: '#087f5b',
  reminder: '#fff4e5',
  reminderText: '#8a5700',
}

const LEFT = 44
const CONTENT_WIDTH = REPORT_WIDTH - (LEFT * 2)
const INPUT_LABEL_WIDTH = 210
const INPUT_VALUE_X = LEFT + INPUT_LABEL_WIDTH + 16
const INPUT_VALUE_WIDTH = CONTENT_WIDTH - INPUT_LABEL_WIDTH - 16
const OMITTED_LINES = new Set([
  '功放额定输出低于音箱额定承受能力，阈值按功放满功率输入限制。',
  '阈值按音箱额定功率计算。',
  '注：按说明书额定功率作理论计算，现场仍需核对接线、标定和实际电平。',
])

function textValue(value) {
  return value == null ? '' : String(value)
}

function wrapText(context, text, maxWidth, size, weight = 400) {
  const source = textValue(text)
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    throw new RangeError('结果图片文字区域宽度无效。')
  }
  if (!context || typeof context.measureText !== 'function') {
    throw new TypeError('限幅器结果图片需要可测量文本的画布上下文。')
  }
  setText(context, size, COLORS.text, weight)
  const lines = []
  source.split(/\r\n?|\n/).forEach((paragraph) => {
    if (!paragraph) {
      lines.push('')
      return
    }
    let line = ''
    Array.from(paragraph).forEach((character) => {
      const candidate = line + character
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = character
      } else {
        line = candidate
      }
    })
    lines.push(line)
  })
  return lines.length ? lines : ['']
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

function lineHasLabel(line, labels) {
  return labels.includes(splitLabelValue(line).label)
}

function findAndConsume(lines, consumed, predicate) {
  const index = lines.findIndex((line, lineIndex) => (
    !consumed.has(lineIndex) && predicate(line)
  ))
  return index < 0 ? null : { index, line: lines[index] }
}

function takeInputField(lines, consumed, labels) {
  const candidates = []
  lines.forEach((line, index) => {
    if (!consumed.has(index) && lineHasLabel(line, labels)) {
      candidates.push({ index, line, label: splitLabelValue(line).label })
    }
  })
  if (!candidates.length) return null
  const selected = candidates.find((candidate) => candidate.label === labels[0]) || candidates[0]
  const selectedValue = splitLabelValue(selected.line).value.trim()
  candidates.forEach((candidate) => {
    if (splitLabelValue(candidate.line).value.trim() === selectedValue) {
      consumed.add(candidate.index)
    }
  })
  return selected.line
}

function consumeExactLegacyLine(lines, consumed, label, expectedValue) {
  if (!expectedValue) return
  const expected = expectedValue.trim()
  lines.forEach((line, index) => {
    if (consumed.has(index)) return
    const parsed = splitLabelValue(line)
    if (parsed.label === label && parsed.value.trim() === expected) consumed.add(index)
  })
}

function parseThreshold(line) {
  if (!line) return null
  const { label, value } = splitLabelValue(line)
  const match = /^(.*?)\s*dBFS(.*)$/i.exec(value)
  if (!match) return null
  return {
    label: label || '限幅阈值',
    value: match[1].trim(),
    unit: 'dBFS',
    calibration: match[2].trim(),
  }
}

function parseTiming(line, fallbackLabel) {
  if (!line) return { label: fallbackLabel, value: '—', unit: 'ms' }
  const { label, value } = splitLabelValue(line)
  const match = /^(.*?)(\s*(?:ms|毫秒))$/i.exec(value)
  if (!match) return { label: label || fallbackLabel, value, unit: '' }
  return { label: label || fallbackLabel, value: match[1].trim(), unit: match[2].trim() }
}

function addTextLines(commands, lines, x, top, lineHeight, size, color, weight = 400, align = 'left') {
  lines.forEach((line, index) => {
    commands.push({
      type: 'text', text: line, x, y: top + size + (index * lineHeight),
      size, color, weight, align,
    })
  })
  return lines.length * lineHeight
}

function addLine(commands, x1, y1, x2, y2, color = COLORS.line, width = 1) {
  commands.push({ type: 'line', x1, y1, x2, y2, color, width })
}

function addSeparator(commands, y) {
  addLine(commands, LEFT, y, LEFT + CONTENT_WIDTH, y)
}

function buildReportModel(payload, measureContext) {
  if (!payload || !Array.isArray(payload.lines)) {
    throw new TypeError('限幅器结果图片数据无效。')
  }
  if (!measureContext || typeof measureContext.measureText !== 'function') {
    throw new TypeError('限幅器结果图片缺少文本测量上下文。')
  }

  const sourceLines = payload.lines.map((line) => textValue(line))
  const consumed = new Set()
  sourceLines.forEach((line, index) => {
    if (OMITTED_LINES.has(line)) consumed.add(index)
  })

  const thresholdItem = findAndConsume(sourceLines, consumed,
    (line) => lineHasLabel(line, ['限幅阈值']))
  const threshold = parseThreshold(thresholdItem && thresholdItem.line)
  if (threshold) consumed.add(thresholdItem.index)
  const attackItem = findAndConsume(sourceLines, consumed,
    (line) => lineHasLabel(line, ['建立时间 Attack', '建立 Attack']))
  if (attackItem) consumed.add(attackItem.index)
  const releaseItem = findAndConsume(sourceLines, consumed,
    (line) => lineHasLabel(line, ['释放时间 Release', '释放 Release']))
  if (releaseItem) consumed.add(releaseItem.index)

  const secondaryItems = []
  sourceLines.forEach((line, index) => {
    if (consumed.has(index)) return
    if (lineHasLabel(line, [
      '总负载', '总阻抗', '目标输出电压', 'DSP 模拟输出', 'DSP模拟输出', 'DSP 输出',
    ])) {
      consumed.add(index)
      secondaryItems.push(line)
    }
  })

  const inputFields = [
    takeInputField(sourceLines, consumed, ['功放型号', '功放']),
    takeInputField(sourceLines, consumed, ['音箱型号', '音箱']),
    takeInputField(sourceLines, consumed, ['每通道音箱数量']),
    takeInputField(sourceLines, consumed, ['连接方式', '连接']),
    takeInputField(sourceLines, consumed, ['功放模式']),
    takeInputField(sourceLines, consumed, ['功放输入灵敏度']),
    takeInputField(sourceLines, consumed, ['通道 HPF']),
  ].filter(Boolean).map(splitLabelValue)

  const inputValue = (label) => {
    const field = inputFields.find((item) => item.label === label)
    return field ? field.value : ''
  }
  const speakerModel = inputValue('音箱型号')
  const speakerCount = inputValue('每通道音箱数量')
  if (speakerModel && speakerCount) {
    consumeExactLegacyLine(sourceLines, consumed, '音箱',
      `${speakerModel} × ${speakerCount} 只/通道`)
  }
  const wiring = inputValue('连接方式')
  const amplifierMode = inputValue('功放模式')
  if (wiring && amplifierMode) {
    consumeExactLegacyLine(sourceLines, consumed, '连接', `${wiring} · ${amplifierMode}`)
  }

  const reminderItems = []
  sourceLines.forEach((line, index) => {
    if (!consumed.has(index) && line.startsWith('提醒：')) {
      consumed.add(index)
      reminderItems.push(line)
    }
  })
  const supplementaryItems = sourceLines.filter((line, index) => !consumed.has(index))
  const moduleLabel = textValue(payload.moduleLabel) || '计算结果'
  const commands = []
  let y = 12

  const title = textValue(payload.title) || moduleLabel

  const summary = textValue(payload.summary).trim()
  const summaryRepeatsStructuredValues = Boolean(threshold
    && /阈值/.test(summary)
    && ((attackItem || releaseItem) ? /(Attack|Release)/i.test(summary) : true))
  if (summary && !summaryRepeatsStructuredValues && summary !== title) {
    y += 6
    const summaryLines = wrapText(measureContext, summary, CONTENT_WIDTH, 30, 500)
    y += addTextLines(commands, summaryLines, LEFT, y, 38, 30, COLORS.secondary, 500)
  }

  const shouldDrawTiming = Boolean(attackItem || releaseItem || thresholdItem
    || /限幅器/.test(moduleLabel))
  if (threshold || shouldDrawTiming || reminderItems.length) {
    y += 16
    const cardTop = y
    const innerLeft = LEFT + 28
    const innerWidth = CONTENT_WIDTH - 56
    const cardCommands = []
    let cardY = cardTop + 24

    reminderItems.forEach((item, index) => {
      const lines = wrapText(measureContext, item, innerWidth - 24, 26, 600)
      const badgeHeight = Math.max(42, (lines.length * 34) + 16)
      cardCommands.push({
        type: 'roundRect', x: innerLeft, y: cardY, width: innerWidth,
        height: badgeHeight, radius: 12, fill: COLORS.reminder,
      })
      cardY += addTextLines(cardCommands, lines, innerLeft + 12, cardY + 8,
        34, 26, COLORS.reminderText, 600)
      cardY = Math.max(cardY, cardTop + 24 + badgeHeight) + (index < reminderItems.length - 1 ? 8 : 14)
    })

    if (threshold) {
      const labelLines = wrapText(measureContext, threshold.label, innerWidth, 29, 600)
      const valueText = `${threshold.value}${threshold.unit ? ` ${threshold.unit}` : ''}`
      const valueLines = wrapText(measureContext, valueText, innerWidth, 80, 700)
      const calibrationLines = threshold.calibration
        ? wrapText(measureContext, threshold.calibration, innerWidth, 29, 500)
        : []
      const center = LEFT + (CONTENT_WIDTH / 2)
      cardY += addTextLines(cardCommands, labelLines, center, cardY, 36, 29, COLORS.secondary, 600, 'center')
      cardY += 4
      cardY += addTextLines(cardCommands, valueLines, center, cardY, 92, 80, COLORS.result, 700, 'center')
      if (calibrationLines.length) {
        cardY += 2
        cardY += addTextLines(cardCommands, calibrationLines, center, cardY,
          36, 29, COLORS.secondary, 500, 'center')
      }
      cardY += 14
    }

    if (shouldDrawTiming) {
      const timing = [
        parseTiming(attackItem && attackItem.line, '建立时间 Attack'),
        parseTiming(releaseItem && releaseItem.line, '释放时间 Release'),
      ]
      const columnGap = 24
      const columnWidth = (innerWidth - columnGap) / 2
      const timingColumns = timing.map((item) => ({
        ...item,
        labelLines: wrapText(measureContext, item.label, columnWidth, 28, 600),
        valueLines: wrapText(measureContext,
          `${item.value}${item.unit ? ` ${item.unit}` : ''}`,
          columnWidth, 54, 700),
      }))
      const labelHeight = Math.max(...timingColumns.map((item) => item.labelLines.length * 36))
      const valueHeight = Math.max(...timingColumns.map((item) => item.valueLines.length * 62))
      timingColumns.forEach((item, index) => {
        const x = innerLeft + (index * (columnWidth + columnGap))
        const center = x + (columnWidth / 2)
        addTextLines(cardCommands, item.labelLines, center, cardY, 36,
          28, COLORS.secondary, 600, 'center')
        addTextLines(cardCommands, item.valueLines, center, cardY + labelHeight + 4,
          62, 54, COLORS.result, 700, 'center')
      })
      cardY += labelHeight + 4 + valueHeight + 8
    }

    const cardHeight = Math.ceil(cardY - cardTop + 24)
    commands.push({
      type: 'roundRect', x: LEFT, y: cardTop, width: CONTENT_WIDTH,
      height: cardHeight, radius: 24, fill: COLORS.card,
    })
    commands.push({
      type: 'roundRectStroke', x: LEFT, y: cardTop, width: CONTENT_WIDTH,
      height: cardHeight, radius: 24, color: COLORS.cardBorder, lineWidth: 1,
    })
    commands.push(...cardCommands)
    y = cardTop + cardHeight + 18
  }

  if (secondaryItems.length) {
    secondaryItems.forEach((item, index) => {
      const lines = wrapText(measureContext, item, CONTENT_WIDTH, 34, 500)
      y += addTextLines(commands, lines, LEFT, y, 44, 34, COLORS.text, 500)
      if (index < secondaryItems.length - 1) y += 2
    })
    y += 8
  }

  if (inputFields.length) {
    addSeparator(commands, y)
    y += 18
    const sectionTitle = wrapText(measureContext, '输入参数', CONTENT_WIDTH, 32, 650)
    y += addTextLines(commands, sectionTitle, LEFT, y, 40, 32, COLORS.text, 650)
    y += 8
    inputFields.forEach((field) => {
      const labelLines = wrapText(measureContext, field.label, INPUT_LABEL_WIDTH, 28, 500)
      const valueLines = wrapText(measureContext, field.value, INPUT_VALUE_WIDTH, 36, 400)
      addTextLines(commands, labelLines, LEFT, y, 36, 28, COLORS.secondary, 500)
      addTextLines(commands, valueLines, INPUT_VALUE_X, y, 46, 36, COLORS.text, 400)
      y += Math.max(labelLines.length * 36, valueLines.length * 46) + 8
    })
  }

  if (supplementaryItems.length) {
    if (inputFields.length || secondaryItems.length || threshold || shouldDrawTiming) {
      y += 2
      addSeparator(commands, y)
      y += 18
    }
    const sectionTitle = wrapText(measureContext, '补充信息', CONTENT_WIDTH, 32, 650)
    y += addTextLines(commands, sectionTitle, LEFT, y, 40, 32, COLORS.text, 650)
    y += 8
    supplementaryItems.forEach((item, index) => {
      const lines = wrapText(measureContext, item, CONTENT_WIDTH, 32, 400)
      y += addTextLines(commands, lines, LEFT, y, 42, 32, COLORS.secondary, 400)
      if (index < supplementaryItems.length - 1) y += 4
    })
  }

  y += 28
  return { commands, height: Math.ceil(y) }
}

function calculateResultReportHeight(payload, measureContext) {
  return buildReportModel(payload, measureContext).height
}

function strokeRoundedRect(context, command) {
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

function drawResultReport(context, payload, height) {
  const model = buildReportModel(payload, context)
  if (model.height > height) {
    throw new RangeError('结果图片高度与实际文字排版不匹配。')
  }
  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, REPORT_WIDTH, height)
  model.commands.forEach((command) => {
    if (command.type === 'roundRect') {
      roundedRect(context, command.x, command.y, command.width, command.height,
        command.radius, command.fill)
    } else if (command.type === 'roundRectStroke') {
      strokeRoundedRect(context, command)
    } else if (command.type === 'line') {
      context.setStrokeStyle(command.color)
      context.setLineWidth(command.width)
      context.beginPath()
      context.moveTo(command.x1, command.y1)
      context.lineTo(command.x2, command.y2)
      context.stroke()
    } else if (command.type === 'text') {
      drawText(context, command.text, command.x, command.y, command.size,
        command.color, command.weight, command.align)
    }
  })
}

module.exports = { calculateResultReportHeight, drawResultReport }

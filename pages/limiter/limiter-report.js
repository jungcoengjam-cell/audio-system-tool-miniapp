const {
  REPORT_WIDTH,
  roundedRect,
  drawText,
  setText,
} = require('../../utils/report-drawing')

const COLORS = {
  background: '#f5f5f7',
  card: '#ffffff',
  cardBorder: '#e5e5ea',
  hero: '#eaf7f5',
  heroBorder: '#c5e5de',
  tile: '#eef6ff',
  tileBorder: '#d6e5f4',
  text: '#1d1d1f',
  secondary: '#6e6e73',
  accent: '#087f70',
  reminder: '#fff4e5',
  reminderText: '#8a5700',
  reminderBorder: '#f0d4ad',
}

const LEFT = 44
const CONTENT_WIDTH = REPORT_WIDTH - (LEFT * 2)
const INPUT_LABEL_WIDTH = 228
const INPUT_VALUE_X = LEFT + 24 + INPUT_LABEL_WIDTH + 16
const INPUT_VALUE_WIDTH = CONTENT_WIDTH - 48 - INPUT_LABEL_WIDTH - 16
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
    const appendCharacter = (character) => {
      const candidate = line + character
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.replace(/\s+$/, ''))
        line = character.replace(/^\s+/, '')
      } else {
        line = candidate
      }
    }
    const tokens = paragraph.match(/(?:[+-]?\d+(?:\.\d+)?\s*(?:dBFS|dBu|dB|V|W|Ω|ohm|ms|毫秒|Hz|kHz)(?![A-Za-z]))|\s+|./giu) || []
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

function addRoundedCard(commands, x, y, width, height, fill, stroke) {
  commands.push({ type: 'roundRect', x, y, width, height, radius: 22, fill })
  if (stroke) {
    commands.push({
      type: 'roundRectStroke', x, y, width, height, radius: 22,
      color: stroke, lineWidth: 1,
    })
  }
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
    const { label, value } = splitLabelValue(line)
    if (label === '总负载') {
      const load = /^\s*([+-]?\d+(?:\.\d+)?)\s*Ω\s*·\s*([+-]?\d+(?:\.\d+)?)\s*W\s*$/.exec(value)
      consumed.add(index)
      if (load) {
        secondaryItems.push({ label: '总阻抗', value: load[1].trim() + ' Ω' })
        secondaryItems.push({ label: '音箱总额定功率', value: load[2].trim() + ' W' })
      } else {
        secondaryItems.push({ label: '总负载', value })
      }
    } else if ([
      '总阻抗', '目标输出电压', 'DSP 模拟输出', 'DSP模拟输出', 'DSP 输出',
    ].includes(label)) {
      consumed.add(index)
      secondaryItems.push({ label, value })
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
      speakerModel + ' × ' + speakerCount + ' 只/通道')
  }
  const wiring = inputValue('连接方式')
  const amplifierMode = inputValue('功放模式')
  if (wiring && amplifierMode) {
    consumeExactLegacyLine(sourceLines, consumed, '连接', wiring + ' · ' + amplifierMode)
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
  let y = 32

  const badgeWidth = Math.min(CONTENT_WIDTH, 260)
  const badgeHeight = 52
  addRoundedCard(commands, LEFT, y, badgeWidth, badgeHeight,
    COLORS.tile, COLORS.tileBorder)
  addTextLines(commands, ['限幅器'], LEFT + 16, y + ((badgeHeight - 32) / 2),
    32, 24, COLORS.accent, 650, 'left')
  y += badgeHeight + 22

  const shouldDrawTiming = Boolean(attackItem || releaseItem || thresholdItem
    || /限幅器/.test(moduleLabel))
  if (threshold || shouldDrawTiming) {
    const heroTop = y
    const heroPadding = 26
    const heroWidth = CONTENT_WIDTH - (heroPadding * 2)
    const center = LEFT + (CONTENT_WIDTH / 2)
    const heroCommands = []
    let heroY = heroTop + heroPadding

    if (threshold) {
      const labelLines = wrapText(measureContext, threshold.label, heroWidth, 23, 650)
      const valueText = threshold.value + (threshold.unit ? ' ' + threshold.unit : '')
      const valueLines = wrapText(measureContext, valueText, heroWidth, 72, 720)
      const calibrationLines = threshold.calibration
        ? wrapText(measureContext, threshold.calibration, heroWidth, 24, 400)
        : []
      heroY += addTextLines(heroCommands, labelLines, center, heroY,
        32, 23, COLORS.accent, 650, 'center') + 12
      heroY += addTextLines(heroCommands, valueLines, center, heroY,
        84, 72, COLORS.text, 720, 'center')
      if (calibrationLines.length) {
        heroY += 8
        heroY += addTextLines(heroCommands, calibrationLines, center, heroY,
          34, 24, COLORS.secondary, 400, 'center')
      }
    }

    if (shouldDrawTiming) {
      heroY += threshold ? 14 : 0
      const timing = [
        parseTiming(attackItem && attackItem.line, '建立时间 Attack'),
        parseTiming(releaseItem && releaseItem.line, '释放时间 Release'),
      ]
      const columnGap = 24
      const columnWidth = (heroWidth - columnGap) / 2
      const timingColumns = timing.map((item) => ({
        ...item,
        labelLines: wrapText(measureContext, item.label, columnWidth, 23, 650),
        valueLines: wrapText(measureContext,
          item.value + (item.unit ? ' ' + item.unit : ''),
          columnWidth, 72, 720),
      }))
      const labelHeight = Math.max(...timingColumns.map((item) => item.labelLines.length * 32))
      const valueHeight = Math.max(...timingColumns.map((item) => item.valueLines.length * 84))
      timingColumns.forEach((item, index) => {
        const x = LEFT + heroPadding + (index * (columnWidth + columnGap))
        const columnCenter = x + (columnWidth / 2)
        addTextLines(heroCommands, item.labelLines, columnCenter, heroY, 32,
          23, COLORS.accent, 650, 'center')
      })
      heroY += labelHeight + 8
      timingColumns.forEach((item, index) => {
        const x = LEFT + heroPadding + (index * (columnWidth + columnGap))
        const columnCenter = x + (columnWidth / 2)
        addTextLines(heroCommands, item.valueLines, columnCenter, heroY, 84,
          72, COLORS.text, 720, 'center')
      })
      heroY += valueHeight
    }

    const heroHeight = Math.ceil(heroY - heroTop + heroPadding)
    addRoundedCard(commands, LEFT, heroTop, CONTENT_WIDTH, heroHeight,
      COLORS.hero, COLORS.heroBorder)
    commands.push(...heroCommands)
    y = heroTop + heroHeight + 18
  }

  if (reminderItems.length) {
    const reminderWidth = CONTENT_WIDTH - 40
    const reminderLines = reminderItems.flatMap((item) => (
      wrapText(measureContext, item, reminderWidth, 24, 600)
    ))
    const reminderLineHeight = 34
    const reminderTextHeight = reminderLines.length * reminderLineHeight
    const reminderTop = y
    const reminderHeight = reminderTextHeight + 40
    addRoundedCard(commands, LEFT, reminderTop, CONTENT_WIDTH, reminderHeight,
      COLORS.reminder, COLORS.reminderBorder)
    addTextLines(commands, reminderLines, LEFT + (CONTENT_WIDTH / 2),
      reminderTop + 20, reminderLineHeight, 24, COLORS.reminderText, 600, 'center')
    y = reminderTop + reminderHeight + 20
  }

  if (secondaryItems.length) {
    const metricGap = 12
    const metricWidth = (CONTENT_WIDTH - metricGap) / 2
    const tileInnerWidth = metricWidth - 36
    for (let index = 0; index < secondaryItems.length; index += 2) {
      const row = secondaryItems.slice(index, index + 2).map((metric, column) => {
        const labelLines = wrapText(measureContext, metric.label, tileInnerWidth, 24, 600)
        const valueLines = wrapText(measureContext, metric.value || '—', tileInnerWidth, 30, 650)
        const contentHeight = (labelLines.length * 32) + 10 + (valueLines.length * 40)
        return {
          x: LEFT + (column * (metricWidth + metricGap)),
          labelLines,
          valueLines,
          contentHeight,
        }
      })
      const rowHeight = Math.max(144, ...row.map((metric) => metric.contentHeight + 44))
      row.forEach((metric) => {
        addRoundedCard(commands, metric.x, y, metricWidth, rowHeight,
          COLORS.tile, COLORS.tileBorder)
        const center = metric.x + (metricWidth / 2)
        let metricY = y + ((rowHeight - metric.contentHeight) / 2)
        metricY += addTextLines(commands, metric.labelLines, center, metricY,
          32, 24, COLORS.secondary, 600, 'center') + 10
        addTextLines(commands, metric.valueLines, center, metricY,
          40, 30, COLORS.text, 650, 'center')
      })
      y += rowHeight + (index + 2 < secondaryItems.length ? 12 : 0)
    }
    y += 26
  }

  if (inputFields.length) {
    const sectionTitle = wrapText(measureContext, '输入参数', CONTENT_WIDTH, 32, 650)
    y += addTextLines(commands, sectionTitle, LEFT, y, 40, 32, COLORS.text, 650, 'left')
    y += 10

    const inputRows = inputFields.map((field) => {
      const labelLines = wrapText(measureContext, field.label, INPUT_LABEL_WIDTH, 26, 650)
      const valueLines = wrapText(measureContext, field.value || '—', INPUT_VALUE_WIDTH, 26, 500)
      const lineCount = Math.max(labelLines.length, valueLines.length)
      return { labelLines, valueLines, lineCount, height: (lineCount * 36) + 28 }
    })
    const inputTop = y
    const inputHeight = inputRows.reduce((total, row) => total + row.height, 0)
    addRoundedCard(commands, LEFT, inputTop, CONTENT_WIDTH, inputHeight,
      COLORS.card, COLORS.cardBorder)
    let rowY = inputTop
    inputRows.forEach((row) => {
      const textTop = rowY + 14
      addTextLines(commands, row.labelLines, LEFT + 24, textTop, 36,
        26, COLORS.secondary, 650, 'left')
      addTextLines(commands, row.valueLines, INPUT_VALUE_X, textTop, 36,
        26, COLORS.text, 500, 'left')
      rowY += row.height
    })
    y = inputTop + inputHeight
  }

  if (supplementaryItems.length) {
    if (inputFields.length) y += 18
    const supplementaryInnerWidth = CONTENT_WIDTH - 48
    const supplementaryRows = supplementaryItems.map((item) => {
      const lines = wrapText(measureContext, item, supplementaryInnerWidth, 26, 400)
      return { lines, height: (lines.length * 36) + 12 }
    })
    const supplementaryTop = y
    const supplementaryHeight = 14
      + supplementaryRows.reduce((total, row) => total + row.height, 0) + 14
    addRoundedCard(commands, LEFT, supplementaryTop, CONTENT_WIDTH, supplementaryHeight,
      COLORS.card, COLORS.cardBorder)
    let supplementaryY = supplementaryTop + 14
    supplementaryRows.forEach((row) => {
      addTextLines(commands, row.lines, LEFT + 24, supplementaryY, 36,
        26, COLORS.secondary, 400, 'left')
      supplementaryY += row.height
    })
    y = supplementaryTop + supplementaryHeight
  }

  y += 20
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

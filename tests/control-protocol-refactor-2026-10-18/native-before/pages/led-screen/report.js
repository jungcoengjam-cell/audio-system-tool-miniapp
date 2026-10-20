const REPORT_CANVAS_ID = 'ledScreenReportCanvas'
const REPORT_WIDTH = 750
const REPORT_HEIGHT = 1580
const SIDE_MARGIN = 44
const CARD_WIDTH = REPORT_WIDTH - SIDE_MARGIN * 2
const CARD_PADDING = 28
const CONTENT_WIDTH = CARD_WIDTH - CARD_PADDING * 2
const COLORS = {
  background: '#f5f7f6', card: '#ffffff', mint: '#eaf7f5', accent: '#087f70',
  blue: '#eef6ff', warning: '#fff5e8', text: '#1d1d1f', secondary: '#5f6869',
  tertiary: '#778181', line: '#d8e5e2', wall: '#f5f7fa', frame: '#c7c7cc',
  screen: '#4f46e5', warningText: '#80530f',
}

function fontString(size, weight = 400) {
  return `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`
}

function setText(context, size, color = COLORS.secondary, weight = 400, align = 'left') {
  context.font = fontString(size, weight)
  if (typeof context.setFontSize === 'function') context.setFontSize(size)
  if (typeof context.setFillStyle === 'function') context.setFillStyle(color)
  if (typeof context.setTextAlign === 'function') context.setTextAlign(align)
}

function measureText(context, value, size, weight = 400) {
  setText(context, size, COLORS.secondary, weight)
  if (typeof context.measureText === 'function') {
    const measured = context.measureText(String(value))
    const width = Number(measured?.width)
    if (Number.isFinite(width) && width >= 0) return width
  }
  return [...String(value)].reduce((width, character) => (
    width + (/^[\u0000-\u00ff]$/.test(character) ? size * 0.56 : size)
  ), 0)
}

function wrapMeasuredText(context, value, maxWidth, size, weight = 400) {
  const paragraphs = String(value === undefined || value === null ? '' : value).split(/\r?\n/)
  const lines = []
  paragraphs.forEach((paragraph) => {
    let line = ''
    for (const character of [...paragraph]) {
      const candidate = line + character
      if (line && measureText(context, candidate, size, weight) > maxWidth) {
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

function roundedRect(context, x, y, width, height, radius, fillStyle) {
  if (typeof context.setFillStyle === 'function') context.setFillStyle(fillStyle)
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
  context.fill()
}

function strokeRect(context, x, y, width, height, color, lineWidth = 1) {
  if (typeof context.setStrokeStyle === 'function') context.setStrokeStyle(color)
  if (typeof context.setLineWidth === 'function') context.setLineWidth(lineWidth)
  context.strokeRect(x, y, width, height)
}

function drawText(context, value, x, y, size, color, weight = 400, align = 'left') {
  setText(context, size, color, weight, align)
  context.fillText(String(value), x, y)
}

function drawLines(context, lines, x, y, lineHeight, size, color, weight = 400, align = 'left') {
  lines.forEach((line, index) => drawText(context, line, x, y + index * lineHeight,
    size, color, weight, align))
}

function fitRect(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const width = Number(sourceWidth)
  const height = Number(sourceHeight)
  const scale = Math.min(maxWidth / width, maxHeight / height)
  return { width: width * scale, height: height * scale }
}

function metricLayout(context, metric, x, y, width, valueFontSize) {
  const innerWidth = width - 32
  const labelLines = wrapMeasuredText(context, metric.label, innerWidth, 18, 600)
  const valueLines = wrapMeasuredText(context, metric.value, innerWidth, valueFontSize, 650)
  const labelLineHeight = 22
  const valueLineHeight = valueFontSize + 6
  return {
    ...metric, x, y, width, labelLines, valueLines, valueFontSize, valueLineHeight,
    height: 82 + Math.max(0, labelLines.length - 1) * labelLineHeight
      + Math.max(0, valueLines.length - 1) * valueLineHeight,
  }
}

function buildLedScreenReportLayout(context, payload) {
  const { input, result } = payload
  const layout = { sections: [], height: 0 }
  let y = 42

  const titleLines = wrapMeasuredText(context, 'LED 大屏尺寸方案', CARD_WIDTH, 32, 700)
  layout.sections.push({ type: 'title', y, lines: titleLines, lineHeight: 40 })
  y += titleLines.length * 40 + 22

  const primaryLines = wrapMeasuredText(context, result.dimensionText, CONTENT_WIDTH, 58, 700)
  const layoutLines = wrapMeasuredText(context, result.layoutText, CONTENT_WIDTH, 22, 500)
  const outerLines = wrapMeasuredText(context,
    `安装外尺寸（含包边）  ${result.installedDimensionText}`, CONTENT_WIDTH, 23, 650)
  const heroHeight = 34 + 30 + primaryLines.length * 68 + 13
    + layoutLines.length * 30 + 17 + outerLines.length * 32 + 26
  layout.sections.push({ type: 'hero', y, height: heroHeight, primaryLines, layoutLines, outerLines })
  y += heroHeight + 18

  const diagramTitleLines = wrapMeasuredText(context, '墙面安装示意', CONTENT_WIDTH, 27, 650)
  const diagramWall = fitRect(Number(input.wallWidthMeters), Number(input.wallHeightMeters), 550, 272)
  const diagramHeight = Math.max(190, diagramWall.height)
  const wallLabelLines = wrapMeasuredText(context,
    `墙体 ${input.wallWidthMeters} × ${input.wallHeightMeters} m`, CONTENT_WIDTH, 18, 500)
  const outerFrameLines = wrapMeasuredText(context,
    `包边外框 ${result.installedDimensionText} · 单边包边 ${result.frameWidthText}`,
    CONTENT_WIDTH, 18, 400)
  const clearanceLines = [
    ...wrapMeasuredText(context,
      `左右实际余量  ${result.horizontalMarginMeters} m / ${result.horizontalMarginMeters} m`,
      CONTENT_WIDTH, 18, 500),
    ...wrapMeasuredText(context,
      `上 / 下实际余量  ${result.actualTopMarginMeters} m / ${result.actualBottomMarginMeters} m`,
      CONTENT_WIDTH, 18, 500),
  ]
  const titleHeight = diagramTitleLines.length * 34
  const wallLabelTop = CARD_PADDING + titleHeight + 10
  const diagramTop = wallLabelTop + wallLabelLines.length * 24 + 7
  const outerTop = diagramTop + diagramHeight + 18
  const clearanceTop = outerTop + outerFrameLines.length * 23 + 12
  const diagramCardHeight = clearanceTop + clearanceLines.length * 23 + CARD_PADDING
  layout.sections.push({
    type: 'diagram', y, height: diagramCardHeight, titleLines: diagramTitleLines,
    titleHeight, wallLabelTop, wallLabelLines, diagramWall, diagramHeight,
    outerTop, outerFrameLines, clearanceTop, clearanceLines,
  })
  y += diagramCardHeight + 18

  const specs = [
    { label: '拼装规格', value: `${result.unitLabel} · ${result.unitSizeText.replace(' × ', '×')}` },
    { label: '估算分辨率', value: result.resolutionText },
    { label: '点间距', value: `${result.pitchModeLabel} ${result.pitchText}` },
    {
      label: '目标 / 实际比例（偏差）',
      value: `${result.targetAspectRatioKey} / ${result.actualRatioText}（${result.ratioDeviationText}）`,
    },
    { label: '最近观看距离', value: `${input.viewingDistanceMeters} m` },
    { label: '舒适观看距离', value: result.comfortableRangeText },
  ]
  const specTitleLines = wrapMeasuredText(context, '方案参数', CONTENT_WIDTH, 26, 650)
  const specTitleHeight = specTitleLines.length * 32 + 8
  const specGap = 14
  const specWidth = (CONTENT_WIDTH - specGap) / 2
  const valueFontSize = [21, 20, 19, 18].find((size) => [
    ...specs.map((metric) => metric.value),
  ].every((value) => measureText(context, value, size, 650) <= specWidth - 32)) || 18
  const specCells = specs.map((metric, index) => {
    const x = SIDE_MARGIN + CARD_PADDING + (index % 2) * (specWidth + specGap)
    return metricLayout(context, metric, x, 0, specWidth, valueFontSize)
  })
  const specCellHeight = Math.max(...specCells.map((cell) => cell.height))
  specCells.forEach((cell, index) => {
    const row = Math.floor(index / 2)
    cell.y = y + CARD_PADDING + specTitleHeight
      + row * (specCellHeight + specGap)
    cell.height = specCellHeight
  })
  const specRowCount = Math.ceil(specCells.length / 2)
  const specGridHeight = specRowCount * specCellHeight + (specRowCount - 1) * specGap
  const specsHeight = CARD_PADDING + specTitleHeight + specGridHeight + CARD_PADDING
  layout.sections.push({ type: 'specs', y, height: specsHeight, titleLines: specTitleLines,
    titleHeight: specTitleHeight, cells: specCells })
  y += specsHeight + 18

  const warnings = []
  if (result.statusKey !== 'fit') {
    warnings.push({ label: result.statusLabel, text: result.viewingAssessmentText || result.statusText })
  }
  if (result.ratioFallbackText) warnings.push({ label: '画面比例', text: result.ratioFallbackText })
  if (warnings.length) {
    const warningRows = warnings.map((warning) => {
      const labelLines = wrapMeasuredText(context, warning.label, CONTENT_WIDTH - 48, 19, 650)
      const textLines = wrapMeasuredText(context, warning.text || '', CONTENT_WIDTH - 48, 19, 400)
      return { ...warning, labelLines, textLines, height: labelLines.length * 26 + textLines.length * 29 + 8 }
    })
    const warningTitleLines = wrapMeasuredText(context, '观看距离与比例提示', CONTENT_WIDTH, 24, 650)
    const warningHeight = CARD_PADDING + warningTitleLines.length * 31 + 12
      + warningRows.reduce((sum, row) => sum + row.height + 12, -12) + CARD_PADDING
    layout.sections.push({ type: 'warnings', y, height: warningHeight, titleLines: warningTitleLines, rows: warningRows })
    y += warningHeight + 12
  }

  layout.height = Math.ceil(y + 24)
  return layout
}

function drawWallDiagram(context, payload, section) {
  const { input, result } = payload
  const wallX = SIDE_MARGIN + (CARD_WIDTH - section.diagramWall.width) / 2
  const diagramTop = section.y + section.wallLabelTop + section.wallLabelLines.length * 24 + 7
  const wallY = diagramTop + (section.diagramHeight - section.diagramWall.height) / 2
  const wallWidth = section.diagramWall.width
  const wallHeight = section.diagramWall.height

  if (typeof context.setFillStyle === 'function') context.setFillStyle(COLORS.wall)
  context.fillRect(wallX, wallY, wallWidth, wallHeight)
  strokeRect(context, wallX, wallY, wallWidth, wallHeight, '#93a0ad', 2)

  const wallWidthMeters = Number(input.wallWidthMeters)
  const wallHeightMeters = Number(input.wallHeightMeters)
  const frameX = wallX + (result.horizontalMarginMeters / wallWidthMeters * wallWidth)
  const frameY = wallY + (result.actualTopMarginMeters / wallHeightMeters * wallHeight)
  const frameWidth = result.installedWidthMeters / wallWidthMeters * wallWidth
  const frameHeight = result.installedHeightMeters / wallHeightMeters * wallHeight
  if (typeof context.setFillStyle === 'function') context.setFillStyle(COLORS.frame)
  context.fillRect(frameX, frameY, frameWidth, frameHeight)
  strokeRect(context, frameX, frameY, frameWidth, frameHeight, '#8e8e93', 1)

  const screenX = frameX + result.frameWidthMeters / result.installedWidthMeters * frameWidth
  const screenY = frameY + result.frameWidthMeters / result.installedHeightMeters * frameHeight
  const screenWidth = result.screenWidthMeters / result.installedWidthMeters * frameWidth
  const screenHeight = result.screenHeightMeters / result.installedHeightMeters * frameHeight
  if (typeof context.setFillStyle === 'function') context.setFillStyle(COLORS.screen)
  context.fillRect(screenX, screenY, screenWidth, screenHeight)

  if (typeof context.setStrokeStyle === 'function') context.setStrokeStyle('rgba(255,255,255,.3)')
  if (typeof context.setLineWidth === 'function') context.setLineWidth(1)
  const cellWidth = screenWidth / Math.max(1, result.columns)
  const cellHeight = screenHeight / Math.max(1, result.rows)
  const columnStep = Math.max(1, Math.ceil(3 / Math.max(cellWidth, 0.01)), Math.ceil(result.columns / 100))
  const rowStep = Math.max(1, Math.ceil(3 / Math.max(cellHeight, 0.01)), Math.ceil(result.rows / 100))
  for (let column = columnStep; column < result.columns; column += columnStep) {
    const x = screenX + column / result.columns * screenWidth
    context.beginPath(); context.moveTo(x, screenY); context.lineTo(x, screenY + screenHeight); context.stroke()
  }
  for (let row = rowStep; row < result.rows; row += rowStep) {
    const y = screenY + row / result.rows * screenHeight
    context.beginPath(); context.moveTo(screenX, y); context.lineTo(screenX + screenWidth, y); context.stroke()
  }

  const badgeMaxWidth = Math.max(0, screenWidth - 12)
  const badgeText = `净屏 ${result.dimensionText}`
  const badgeLines = wrapMeasuredText(context, badgeText, badgeMaxWidth - 20, 15, 600)
  const badgeWidth = Math.min(badgeMaxWidth, Math.max(...badgeLines.map((line) => measureText(context, line, 15, 600))) + 20)
  const badgeHeight = badgeLines.length * 19 + 12
  if (badgeWidth >= 54 && badgeHeight <= screenHeight - 8) {
    const badgeX = screenX + (screenWidth - badgeWidth) / 2
    const badgeY = screenY + (screenHeight - badgeHeight) / 2
    roundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, 8, 'rgba(19,22,58,.76)')
    drawLines(context, badgeLines, screenX + screenWidth / 2,
      badgeY + 19, 19, 15, '#ffffff', 600, 'center')
  }

  drawLines(context, section.wallLabelLines, REPORT_WIDTH / 2,
    section.y + section.wallLabelTop + 18, 24, 18, COLORS.secondary, 500, 'center')
  drawLines(context, section.outerFrameLines, REPORT_WIDTH / 2,
    section.y + section.outerTop + 17, 23, 18, COLORS.tertiary, 400, 'center')
  drawLines(context, section.clearanceLines, SIDE_MARGIN + CARD_PADDING,
    section.y + section.clearanceTop + 18, 23, 18, COLORS.secondary, 500)
}

function drawMetricCell(context, cell) {
  roundedRect(context, cell.x, cell.y, cell.width, cell.height, 16, COLORS.blue)
  const labelLineHeight = 22
  const valueY = cell.y + 53 + Math.max(0, cell.labelLines.length - 1) * labelLineHeight
  drawLines(context, cell.labelLines, cell.x + 16, cell.y + 22,
    labelLineHeight, 18, COLORS.tertiary, 600)
  drawLines(context, cell.valueLines, cell.x + 16,
    valueY, cell.valueLineHeight, cell.valueFontSize, COLORS.text, 650)
}

function drawLedScreenReport(context, payload, layout = buildLedScreenReportLayout(context, payload)) {
  if (typeof context.setFillStyle === 'function') context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, REPORT_WIDTH, layout.height)

  layout.sections.forEach((section) => {
    if (section.type === 'title') {
      drawLines(context, section.lines, SIDE_MARGIN, section.y + 31, section.lineHeight, 32, COLORS.text, 700)
      return
    }
    if (section.type === 'hero') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 24, COLORS.mint)
      drawText(context, '净屏尺寸', REPORT_WIDTH / 2, section.y + 34, 21, COLORS.accent, 650, 'center')
      drawLines(context, section.primaryLines, REPORT_WIDTH / 2,
        section.y + 92, 68, 58, COLORS.text, 700, 'center')
      const afterPrimary = section.y + 92 + section.primaryLines.length * 68
      drawLines(context, section.layoutLines, REPORT_WIDTH / 2,
        afterPrimary + 18, 30, 22, COLORS.secondary, 500, 'center')
      drawLines(context, section.outerLines, REPORT_WIDTH / 2,
        afterPrimary + 18 + section.layoutLines.length * 30 + 20, 32, 23, COLORS.accent, 650, 'center')
      return
    }
    if (section.type === 'diagram') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, COLORS.card)
      drawLines(context, section.titleLines, SIDE_MARGIN + CARD_PADDING,
        section.y + CARD_PADDING + 26, 34, 27, COLORS.text, 650)
      drawWallDiagram(context, payload, section)
      return
    }
    if (section.type === 'specs') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, COLORS.card)
      drawLines(context, section.titleLines, SIDE_MARGIN + CARD_PADDING,
        section.y + CARD_PADDING + 23, 32, 26, COLORS.text, 650)
      section.cells.forEach((cell) => drawMetricCell(context, cell))
      return
    }
    if (section.type === 'warnings') {
      roundedRect(context, SIDE_MARGIN, section.y, CARD_WIDTH, section.height, 22, COLORS.warning)
      drawLines(context, section.titleLines, SIDE_MARGIN + CARD_PADDING,
        section.y + CARD_PADDING + 22, 31, 24, COLORS.warningText, 650)
      let rowY = section.y + CARD_PADDING + section.titleLines.length * 31 + 12
      section.rows.forEach((row) => {
        drawLines(context, row.labelLines, SIDE_MARGIN + CARD_PADDING, rowY + 19,
          26, 19, COLORS.warningText, 650)
        rowY += row.labelLines.length * 26
        drawLines(context, row.textLines, SIDE_MARGIN + CARD_PADDING, rowY + 21,
          29, 19, COLORS.secondary, 400)
        rowY += row.textLines.length * 29 + 20
      })
    }
  })
}

function buildLedScreenReportPayload(state) {
  if (!state || !state.result) return null
  return {
    input: {
      wallWidthMeters: state.wallWidthText,
      wallHeightMeters: state.wallHeightText,
      topReserveMeters: state.topReserveText,
      bottomReserveMeters: state.bottomReserveText,
      viewingDistanceMeters: state.viewingDistanceText,
    },
    result: state.result,
  }
}

module.exports = {
  REPORT_CANVAS_ID, REPORT_HEIGHT, REPORT_WIDTH,
  buildLedScreenReportLayout, buildLedScreenReportPayload, drawLedScreenReport, wrapMeasuredText,
}

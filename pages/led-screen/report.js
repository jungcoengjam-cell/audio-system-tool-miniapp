const REPORT_CANVAS_ID = 'ledScreenReportCanvas'
const REPORT_WIDTH = 750
const REPORT_HEIGHT = 1580
const {
  REPORT_COLORS,
  roundedRect,
  setText,
  drawText,
  drawPill,
} = require('../../utils/report-drawing')

const COLORS = {
  ...REPORT_COLORS,
  indigo: '#4f46e5',
  frame: '#c7c7cc',
  wall: '#f8fafc',
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, options = {}) {
  setText(context, options.size || 18, options.color || COLORS.secondary, options.weight || 400)
  const characters = [...String(text)]
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
  lines.slice(0, options.maxLines || 2).forEach((item, index) => {
    context.fillText(item, x, y + (index * lineHeight))
  })
}

function drawMetric(context, x, y, value, label) {
  drawText(context, value, x, y, 26, COLORS.text, 600)
  drawText(context, label, x, y + 31, 17, COLORS.tertiary, 400)
}

function fitRect(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
  return { width: sourceWidth * scale, height: sourceHeight * scale }
}

function drawWallDiagram(context, payload) {
  const { input, result } = payload
  const cardX = 44
  const cardY = 680
  const cardWidth = 662
  const cardHeight = 492
  roundedRect(context, cardX, cardY, cardWidth, cardHeight, 26, COLORS.card)
  drawText(context, '墙面安装示意', 74, 730, 28, COLORS.text, 650)
  drawText(context, '按本次实际尺寸比例绘制', 676, 730, 17, COLORS.tertiary, 400, 'right')

  const wallWidthMeters = Number(input.wallWidthMeters)
  const wallHeightMeters = Number(input.wallHeightMeters)
  const fitted = fitRect(wallWidthMeters, wallHeightMeters, 558, 292)
  const wallX = 96 + ((558 - fitted.width) / 2)
  const wallY = 786 + ((292 - fitted.height) / 2)
  const wallWidth = fitted.width
  const wallHeight = fitted.height

  context.setFillStyle(COLORS.wall)
  context.fillRect(wallX, wallY, wallWidth, wallHeight)
  context.setStrokeStyle('#64748b')
  context.setLineWidth(2)
  context.strokeRect(wallX, wallY, wallWidth, wallHeight)

  const frameX = wallX + (result.horizontalMarginMeters / wallWidthMeters * wallWidth)
  const frameY = wallY + (result.actualTopMarginMeters / wallHeightMeters * wallHeight)
  const frameWidth = result.installedWidthMeters / wallWidthMeters * wallWidth
  const frameHeight = result.installedHeightMeters / wallHeightMeters * wallHeight
  context.setFillStyle(COLORS.frame)
  context.fillRect(frameX, frameY, frameWidth, frameHeight)
  context.setStrokeStyle('#8e8e93')
  context.setLineWidth(1)
  context.strokeRect(frameX, frameY, frameWidth, frameHeight)

  const screenX = frameX + (result.frameWidthMeters / result.installedWidthMeters * frameWidth)
  const screenY = frameY + (result.frameWidthMeters / result.installedHeightMeters * frameHeight)
  const screenWidth = result.screenWidthMeters / result.installedWidthMeters * frameWidth
  const screenHeight = result.screenHeightMeters / result.installedHeightMeters * frameHeight
  context.setFillStyle(COLORS.indigo)
  context.fillRect(screenX, screenY, screenWidth, screenHeight)

  context.setStrokeStyle('rgba(255, 255, 255, .28)')
  context.setLineWidth(1)
  const columnStep = Math.max(1, Math.ceil(result.columns / 24))
  const rowStep = Math.max(1, Math.ceil(result.rows / 14))
  for (let column = columnStep; column < result.columns; column += columnStep) {
    const x = screenX + (column / result.columns * screenWidth)
    context.beginPath()
    context.moveTo(x, screenY)
    context.lineTo(x, screenY + screenHeight)
    context.stroke()
  }
  for (let row = rowStep; row < result.rows; row += rowStep) {
    const y = screenY + (row / result.rows * screenHeight)
    context.beginPath()
    context.moveTo(screenX, y)
    context.lineTo(screenX + screenWidth, y)
    context.stroke()
  }

  if (screenWidth > 170 && screenHeight > 62) {
    roundedRect(context, screenX + (screenWidth / 2) - 78, screenY + (screenHeight / 2) - 18,
      156, 36, 10, 'rgba(19, 22, 58, .72)')
    drawText(context, result.dimensionText, screenX + (screenWidth / 2),
      screenY + (screenHeight / 2) + 7, 16, '#ffffff', 600, 'center')
  }

  drawText(context, `墙宽 ${input.wallWidthMeters} m`, wallX + (wallWidth / 2), wallY - 15,
    17, COLORS.secondary, 400, 'center')
  drawText(context, `墙高 ${input.wallHeightMeters} m`, wallX + wallWidth + 12,
    wallY + (wallHeight / 2) + 6, 17, COLORS.secondary, 400)
  drawText(context,
    `左右各 ${result.horizontalMarginMeters} m  ·  上 ${result.actualTopMarginMeters} m  ·  下 ${result.actualBottomMarginMeters} m`,
    375, 1127, 18, COLORS.secondary, 400, 'center')
}

function drawLedScreenReport(context, payload) {
  const { input, result } = payload
  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, REPORT_WIDTH, REPORT_HEIGHT)

  roundedRect(context, 44, 42, 150, 34, 17, COLORS.blueSoft)
  drawText(context, 'LED DISPLAY PLAN', 119, 66, 16, COLORS.blue, 650, 'center')
  drawText(context, 'LED 大屏尺寸预估', 44, 128, 48, COLORS.text, 700)
  drawText(context, '墙体尺寸、观看距离与拼装单元的前期方案', 44, 168, 21, COLORS.secondary, 400)

  roundedRect(context, 44, 196, 662, 248, 28, COLORS.card)
  drawText(context, '推荐净屏', 74, 238, 20, COLORS.secondary, 500)
  drawPill(context, result.ratioText, 676, 218)
  drawText(context, result.dimensionText, 74, 306, 52, COLORS.text, 700)
  drawText(context, result.layoutText, 74, 344, 21, COLORS.secondary, 400)
  context.setStrokeStyle(COLORS.line)
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(74, 369)
  context.lineTo(676, 369)
  context.stroke()
  drawMetric(context, 74, 397, result.installedDimensionText, `含 ${result.frameWidthText} 安装外尺寸`)
  context.beginPath()
  context.moveTo(371, 380)
  context.lineTo(371, 424)
  context.stroke()
  drawMetric(context, 402, 397, result.resolutionText, '标称点间距估算分辨率')

  roundedRect(context, 44, 460, 662, 196, 26, COLORS.card)
  drawText(context, '设计条件', 74, 505, 27, COLORS.text, 650)
  drawText(context, `墙体  ${input.wallWidthMeters} × ${input.wallHeightMeters} m`, 74, 548, 20, COLORS.secondary, 400)
  drawText(context, `上 / 下预留  ${input.topReserveMeters} / ${input.bottomReserveMeters} m`, 388, 548, 20, COLORS.secondary, 400)
  drawText(context, `画面比例  ${result.targetAspectRatioKey}`, 74, 591, 20, COLORS.secondary, 400)
  drawText(context, `拼装单元  ${result.unitSizeText}`, 388, 591, 20, COLORS.secondary, 400)
  drawText(context, `四周包边  ${result.frameWidthText}`, 74, 634, 20, COLORS.secondary, 400)
  drawText(context, `最近观看  ${result.viewingDistanceMeters} m`, 388, 634, 20, COLORS.secondary, 400)

  drawWallDiagram(context, payload)

  roundedRect(context, 44, 1196, 662, 246, 26, COLORS.card)
  drawText(context, '观看距离校核', 74, 1242, 27, COLORS.text, 650)
  drawPill(context, result.statusLabel, 676, 1218, {
    color: ['fit', 'surplus'].includes(result.statusKey) ? COLORS.blue : '#9a5b00',
    background: ['fit', 'surplus'].includes(result.statusKey) ? COLORS.blueSoft : '#fff7e8',
  })
  drawText(context, result.pitchText, 74, 1305, 40, COLORS.blue, 700)
  drawText(context, result.pitchModeLabel, 74, 1336, 17, COLORS.tertiary, 400)
  drawText(context, `${result.viewingDistanceMeters} m`, 294, 1305, 30, COLORS.text, 650)
  drawText(context, '最近观看距离', 294, 1336, 17, COLORS.tertiary, 400)
  drawText(context, result.comfortableRangeText, 494, 1305, 25, COLORS.text, 600)
  drawText(context, '舒适观看范围', 494, 1336, 17, COLORS.tertiary, 400)
  drawWrappedText(context, result.statusText, 74, 1392, 602, 25, {
    size: 18,
    color: COLORS.secondary,
    maxLines: 2,
  })

  drawText(context, '前期尺寸预估 · 最终以实际产品像素矩阵及结构深化为准', 44, 1501,
    18, COLORS.tertiary, 400)
  drawText(context, '音视频工具', 706, 1540, 17, COLORS.tertiary, 500, 'right')
}

function buildLedScreenReportPayload(state) {
  if (!state || !state.result) return null
  return {
    input: {
      wallWidthMeters: state.wallWidthText,
      wallHeightMeters: state.wallHeightText,
      topReserveMeters: state.topReserveText,
      bottomReserveMeters: state.bottomReserveText,
    },
    result: state.result,
  }
}

module.exports = {
  REPORT_CANVAS_ID,
  REPORT_HEIGHT,
  REPORT_WIDTH,
  buildLedScreenReportPayload,
  drawLedScreenReport,
}

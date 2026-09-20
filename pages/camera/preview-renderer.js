function adaptCanvas2dContext(context) {
  return {
    setFillStyle: (value) => { context.fillStyle = value },
    setStrokeStyle: (value) => { context.strokeStyle = value },
    setLineWidth: (value) => { context.lineWidth = value },
    setFontSize: (value) => { context.font = `${value}px -apple-system, BlinkMacSystemFont, sans-serif` },
    beginPath: () => context.beginPath(),
    closePath: () => context.closePath(),
    moveTo: (...args) => context.moveTo(...args),
    lineTo: (...args) => context.lineTo(...args),
    arc: (...args) => context.arc(...args),
    fill: () => context.fill(),
    stroke: () => context.stroke(),
    fillRect: (...args) => context.fillRect(...args),
    strokeRect: (...args) => context.strokeRect(...args),
    fillText: (...args) => context.fillText(...args),
  }
}

function drawLabel(context, text, x, y, color = '#64748b', size = 16) {
  context.setFillStyle(color)
  context.setFontSize(size)
  context.fillText(text, x, y)
}

function drawLine(context, points, color = '#94a3b8', width = 1) {
  context.beginPath()
  context.moveTo(points[0][0], points[0][1])
  points.slice(1).forEach(([x, y]) => context.lineTo(x, y))
  context.setStrokeStyle(color)
  context.setLineWidth(width)
  context.stroke()
}

function drawDimension(context, x1, y1, x2, y2, label, labelX, labelY) {
  drawLine(context, [[x1, y1], [x2, y2]], '#64748b', 1)
  if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
    drawLine(context, [[x1, y1 - 4], [x1, y1 + 4]], '#64748b')
    drawLine(context, [[x2, y2 - 4], [x2, y2 + 4]], '#64748b')
  } else {
    drawLine(context, [[x1 - 4, y1], [x1 + 4, y1]], '#64748b')
    drawLine(context, [[x2 - 4, y2], [x2 + 4, y2]], '#64748b')
  }
  drawLabel(context, label, labelX, labelY, '#475569', 11)
}

function drawCamera(context, x, y) {
  context.setFillStyle('#111827')
  context.fillRect(x - 8, y - 7, 16, 14)
  context.setFillStyle('#38bdf8')
  context.beginPath()
  context.arc(x + 6, y, 2.5, 0, Math.PI * 2)
  context.fill()
}

function drawPanel(context, panel, title) {
  const { x, y, width, height } = panel
  context.setFillStyle('#f8fafc')
  context.fillRect(x, y, width, height)
  context.setStrokeStyle('#dbe4f0')
  context.strokeRect(x, y, width, height)
  drawLabel(context, title, x + 12, y + 21, '#334155', 13)
}

function getCanvasPanels(width, height) {
  const outer = 4
  const gap = 8
  const panelHeight = (height - outer * 2 - gap) / 2
  return [
    { x: outer, y: outer, width: width - outer * 2, height: panelHeight },
    { x: outer, y: outer + panelHeight + gap, width: width - outer * 2, height: panelHeight },
  ]
}

function getPlotBounds(panel) {
  return {
    left: panel.x + 28,
    right: panel.x + panel.width - 24,
    top: panel.y + 40,
    bottom: panel.y + panel.height - 28,
  }
}

function getDrawingScale(plot, horizontalMeters, verticalMeters) {
  return Math.min(
    (plot.right - plot.left) / Math.max(horizontalMeters, 0.01),
    (plot.bottom - plot.top) / Math.max(verticalMeters, 0.01),
  )
}

function getCenteredDrawingStart(plot, drawingWidth) {
  return plot.left + Math.max(0, (plot.right - plot.left - drawingWidth) / 2)
}

function drawViewDirection(context, cameraX, centerY, targetX) {
  const endX = Math.max(cameraX + 16, targetX)
  drawLine(context, [[cameraX + 8, centerY], [endX, centerY]], '#60a5fa', 1)
  context.beginPath()
  context.moveTo(endX, centerY)
  context.lineTo(endX - 6, centerY - 4)
  context.lineTo(endX - 6, centerY + 4)
  context.closePath()
  context.setFillStyle('#60a5fa')
  context.fill()
}

function drawGroundPlan(context, result, panel) {
  drawPanel(context, panel, '01  俯视 · 水平覆盖')
  const plot = getPlotBounds(panel)
  const totalLength = result.cameraSetbackMeters + result.depthMeters
  const requiredHalfAngle = result.requiredHorizontalFov * Math.PI / 360
  const envelopeWidthAtFar = 2 * totalLength * Math.tan(requiredHalfAngle)
  const scale = getDrawingScale(plot, totalLength, envelopeWidthAtFar)
  const cameraX = getCenteredDrawingStart(plot, totalLength * scale)
  const centerY = (plot.top + plot.bottom) / 2
  const nearX = cameraX + result.cameraSetbackMeters * scale
  const farX = nearX + result.depthMeters * scale
  const halfWidth = result.widthMeters * scale / 2
  const envelopeHalfWidthAtFar = envelopeWidthAtFar * scale / 2

  context.beginPath()
  context.moveTo(cameraX, centerY)
  context.lineTo(farX, centerY - envelopeHalfWidthAtFar)
  context.lineTo(farX, centerY + envelopeHalfWidthAtFar)
  context.closePath()
  context.setFillStyle('rgba(0, 122, 255, .1)')
  context.fill()
  context.setStrokeStyle('#007aff')
  context.setLineWidth(2)
  context.stroke()

  context.setFillStyle('rgba(52, 199, 89, .16)')
  context.fillRect(nearX, centerY - halfWidth, farX - nearX, halfWidth * 2)
  context.setStrokeStyle('#34a853')
  context.strokeRect(nearX, centerY - halfWidth, farX - nearX, halfWidth * 2)
  drawViewDirection(context, cameraX, centerY, nearX - 5)
  drawCamera(context, cameraX, centerY)
  drawLabel(context, '摄像机', Math.max(panel.x + 8, cameraX - 16), centerY + 21, '#334155', 10)
  drawLabel(context, '目标区域', nearX + Math.max(4, (farX - nearX) / 2 - 22), centerY + 4, '#15803d', 10)
  const bottomY = panel.y + panel.height - 13
  drawDimension(context, cameraX, bottomY, nearX, bottomY, `退距 ${result.cameraSetbackMeters} m`, (cameraX + nearX) / 2 - 28, bottomY - 6)
  const topY = plot.top - 4
  drawDimension(context, nearX, topY, farX, topY, `目标纵深 ${result.depthMeters} m`, (nearX + farX) / 2 - 38, topY - 6)
  const rightX = Math.min(panel.x + panel.width - 9, farX + 11)
  drawDimension(context, rightX, centerY - halfWidth, rightX, centerY + halfWidth, `目标宽 ${result.widthMeters} m`, farX - 66, centerY + 4)
}

function drawGroundElevation(context, result, panel) {
  drawPanel(context, panel, '02  侧视 · 垂直覆盖')
  const plot = getPlotBounds(panel)
  const totalLength = result.cameraSetbackMeters + result.depthMeters
  const maximumHeight = Math.max(result.cameraHeightMeters, result.subjectHeightMeters)
  const scale = getDrawingScale(plot, totalLength, maximumHeight)
  const cameraX = getCenteredDrawingStart(plot, totalLength * scale)
  const nearX = cameraX + result.cameraSetbackMeters * scale
  const farX = nearX + result.depthMeters * scale
  const floorY = plot.bottom
  const cameraY = floorY - result.cameraHeightMeters * scale
  const subjectTopY = floorY - result.subjectHeightMeters * scale

  drawLine(context, [[panel.x + 16, floorY], [panel.x + panel.width - 12, floorY]], '#64748b', 2)
  context.setFillStyle('rgba(52, 199, 89, .14)')
  context.fillRect(nearX, subjectTopY, farX - nearX, floorY - subjectTopY)
  context.setStrokeStyle('#34a853')
  context.strokeRect(nearX, subjectTopY, farX - nearX, floorY - subjectTopY)

  context.beginPath()
  context.moveTo(cameraX, cameraY)
  context.lineTo(nearX, subjectTopY)
  context.lineTo(farX, subjectTopY)
  context.lineTo(farX, floorY)
  context.lineTo(nearX, floorY)
  context.closePath()
  context.setFillStyle('rgba(88, 86, 214, .12)')
  context.fill()
  context.setStrokeStyle('#5856d6')
  context.setLineWidth(2)
  context.stroke()
  drawCamera(context, cameraX, cameraY)
  drawLabel(context, result.requiresInitialAim ? `初始${result.aimText}` : 'PTZ 可转向', cameraX + 12, cameraY - 8, '#475569', 10)
  const leftX = cameraX - 10
  drawDimension(context, leftX, cameraY, leftX, floorY, `${result.cameraHeightMeters} m`, panel.x + 3, (cameraY + floorY) / 2)
  const rightX = Math.min(panel.x + panel.width - 9, farX + 11)
  drawDimension(context, rightX, subjectTopY, rightX, floorY, `人物 ${result.subjectHeightMeters} m`, farX - 72, (subjectTopY + floorY) / 2)
}

function drawPlanePlan(context, result, panel) {
  drawPanel(context, panel, '01  俯视 · 水平覆盖')
  const plot = getPlotBounds(panel)
  const requiredHalfAngle = result.requiredHorizontalFov * Math.PI / 360
  const envelopeWidth = 2 * result.distanceMeters * Math.tan(requiredHalfAngle)
  const scale = getDrawingScale(plot, result.distanceMeters, envelopeWidth)
  const cameraX = getCenteredDrawingStart(plot, result.distanceMeters * scale)
  const centerY = (plot.top + plot.bottom) / 2
  const planeX = cameraX + result.distanceMeters * scale
  const halfWidth = result.widthMeters * scale / 2
  const envelopeHalfWidth = envelopeWidth * scale / 2
  context.beginPath()
  context.moveTo(cameraX, centerY)
  context.lineTo(planeX, centerY - envelopeHalfWidth)
  context.lineTo(planeX, centerY + envelopeHalfWidth)
  context.closePath()
  context.setFillStyle('rgba(0, 122, 255, .1)')
  context.fill()
  context.setStrokeStyle('#007aff')
  context.setLineWidth(2)
  context.stroke()
  drawViewDirection(context, cameraX, centerY, planeX - 5)
  drawCamera(context, cameraX, centerY)
  drawLabel(context, '摄像机', Math.max(panel.x + 8, cameraX - 16), centerY + 21, '#334155', 10)
  drawLine(context, [[planeX, centerY - halfWidth], [planeX, centerY + halfWidth]], '#34a853', 4)
  drawLabel(context, '目标平面', planeX - 48, centerY - halfWidth - 7, '#15803d', 10)
  const bottomY = panel.y + panel.height - 13
  drawDimension(context, cameraX, bottomY, planeX, bottomY, `${result.distanceMeters} m`, (cameraX + planeX) / 2 - 20, bottomY - 6)
  const rightX = Math.min(panel.x + panel.width - 9, planeX + 11)
  drawDimension(context, rightX, centerY - halfWidth, rightX, centerY + halfWidth, `宽 ${result.widthMeters} m`, planeX - 54, centerY + 4)
}

function drawPlaneElevation(context, result, panel) {
  drawPanel(context, panel, '02  侧视 · 垂直覆盖')
  const plot = getPlotBounds(panel)
  const maximumHeight = Math.max(result.cameraHeightMeters, result.bottomHeightMeters + result.heightMeters, 1)
  const scale = getDrawingScale(plot, result.distanceMeters, maximumHeight)
  const cameraX = getCenteredDrawingStart(plot, result.distanceMeters * scale)
  const planeX = cameraX + result.distanceMeters * scale
  const floorY = plot.bottom
  const cameraY = floorY - result.cameraHeightMeters * scale
  const targetBottomY = floorY - result.bottomHeightMeters * scale
  const targetTopY = floorY - (result.bottomHeightMeters + result.heightMeters) * scale
  drawLine(context, [[panel.x + 16, floorY], [panel.x + panel.width - 12, floorY]], '#64748b', 2)
  context.setFillStyle('rgba(52, 199, 89, .16)')
  context.fillRect(planeX - 7, targetTopY, 14, targetBottomY - targetTopY)
  context.setStrokeStyle('#34a853')
  context.strokeRect(planeX - 7, targetTopY, 14, targetBottomY - targetTopY)
  context.beginPath()
  context.moveTo(cameraX, cameraY)
  context.lineTo(planeX, targetTopY)
  context.lineTo(planeX, targetBottomY)
  context.closePath()
  context.setFillStyle('rgba(88, 86, 214, .12)')
  context.fill()
  context.setStrokeStyle('#5856d6')
  context.setLineWidth(2)
  context.stroke()
  drawCamera(context, cameraX, cameraY)
  drawLabel(context, result.requiresInitialAim ? `初始${result.aimText}` : 'PTZ 可转向', cameraX + 12, cameraY - 8, '#475569', 10)
  const leftX = cameraX - 10
  drawDimension(context, leftX, cameraY, leftX, floorY, `${result.cameraHeightMeters} m`, panel.x + 3, (cameraY + floorY) / 2)
  const rightX = Math.min(panel.x + panel.width - 9, planeX + 11)
  drawDimension(context, rightX, targetTopY, rightX, targetBottomY, `${result.heightMeters} m`, planeX - 42, (targetTopY + targetBottomY) / 2)
}

function drawUnavailableElevation(context, result, panel) {
  drawPanel(context, panel, '侧视：垂直覆盖待说明书参数校核')
  drawLabel(context, '说明书未提供垂直视场角', panel.x + 24, panel.y + 84, '#b45309', 15)
  drawLabel(context, '当前仅计算水平覆盖距离，', panel.x + 24, panel.y + 116, '#64748b', 12)
  drawLabel(context, '不能判断上下边界是否入画。', panel.x + 24, panel.y + 138, '#64748b', 12)
  drawLabel(
    context,
    result.requiresInitialAim ? `初始瞄准参考：${result.aimText}` : '机械云台可现场调整水平与俯仰',
    panel.x + 24,
    panel.y + 172,
    '#334155',
    12,
  )
}

function drawPreviewAtSize(context, result, width, height) {
  context.setFillStyle('#fff')
  context.fillRect(0, 0, width, height)
  const panels = getCanvasPanels(width, height)
  if (result.sceneMode === 'ground') {
    drawGroundPlan(context, result, panels[0])
    if (result.horizontalOnly) drawUnavailableElevation(context, result, panels[1])
    else drawGroundElevation(context, result, panels[1])
  } else {
    drawPlanePlan(context, result, panels[0])
    if (result.horizontalOnly) drawUnavailableElevation(context, result, panels[1])
    else drawPlaneElevation(context, result, panels[1])
  }
}

module.exports = {
  adaptCanvas2dContext,
  drawPreviewAtSize,
}

function adaptCanvas2dContext(context) {
  return {
    setFillStyle: (value) => { context.fillStyle = value },
    setStrokeStyle: (value) => { context.strokeStyle = value },
    setLineWidth: (value) => { context.lineWidth = value },
    setFontSize: (value) => { context.font = `${value}px -apple-system, BlinkMacSystemFont, sans-serif` },
    setTextAlign: (value) => { context.textAlign = value },
    measureText: (value) => {
      const text = String(value)
      if (typeof context.measureText !== 'function') return text.length * 7
      const metrics = context.measureText(text)
      const width = Number(metrics?.width)
      return Number.isFinite(width) && width >= 0 ? width : text.length * 7
    },
    setLineDash: (value) => { if (typeof context.setLineDash === 'function') context.setLineDash(value) },
    beginPath: () => context.beginPath(),
    closePath: () => context.closePath(),
    moveTo: (...args) => context.moveTo(...args),
    lineTo: (...args) => context.lineTo(...args),
    arc: (...args) => context.arc(...args),
    rect: (...args) => context.rect(...args),
    clip: () => context.clip(),
    save: () => context.save(),
    restore: () => context.restore(),
    fill: () => context.fill(),
    stroke: () => context.stroke(),
    fillRect: (...args) => context.fillRect(...args),
    strokeRect: (...args) => context.strokeRect(...args),
    fillText: (...args) => context.fillText(...args),
  }
}

const COLORS = {
  background: '#10243a',
  panel: '#142b43',
  grid: 'rgba(191, 219, 254, .1)',
  text: '#e8f1fb',
  muted: '#a9bfd5',
  camera: '#7dd3fc',
  angle: '#60a5fa',
  target: '#fb7185',
  margin: '#fbbf24',
  ground: '#91a9bd',
}

const radians = (degrees) => Number(degrees) * Math.PI / 180

function formatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function drawLabel(context, text, x, y, color = COLORS.text, size = 13, align = 'left') {
  context.setFillStyle(color)
  context.setFontSize(size)
  context.setTextAlign(align)
  context.fillText(String(text), x, y)
  context.setTextAlign('left')
}

function drawFittedLabel(context, text, x, y, maxWidth, color = COLORS.text, size = 13, minSize = 10, align = 'left') {
  let fittedSize = size
  context.setFontSize(fittedSize)
  while (fittedSize > minSize && context.measureText(text) > maxWidth) {
    fittedSize -= 1
    context.setFontSize(fittedSize)
  }
  drawLabel(context, text, x, y, color, fittedSize, align)
}

function drawLine(context, points, color = COLORS.muted, width = 1, dash = []) {
  if (points.length < 2) return
  context.beginPath()
  context.moveTo(points[0][0], points[0][1])
  points.slice(1).forEach(([x, y]) => context.lineTo(x, y))
  context.setStrokeStyle(color)
  context.setLineWidth(width)
  context.setLineDash(dash)
  context.stroke()
  if (dash.length) context.setLineDash([])
}

function drawPolygon(context, points, fill, stroke, width = 1, dash = []) {
  if (points.length < 3) return
  context.beginPath()
  context.moveTo(points[0][0], points[0][1])
  points.slice(1).forEach(([x, y]) => context.lineTo(x, y))
  context.closePath()
  context.setFillStyle(fill)
  context.fill()
  if (stroke) {
    context.setStrokeStyle(stroke)
    context.setLineWidth(width)
    context.setLineDash(dash)
    context.stroke()
    if (dash.length) context.setLineDash([])
  }
}

function drawCamera(context, x, y) {
  context.setFillStyle(COLORS.camera)
  context.fillRect(x - 8, y - 5, 14, 10)
  context.beginPath()
  context.moveTo(x + 6, y - 4)
  context.lineTo(x + 12, y - 7)
  context.lineTo(x + 12, y + 7)
  context.lineTo(x + 6, y + 4)
  context.closePath()
  context.fill()
}

function makeTransform(plot, bounds, sharedScale) {
  const xRange = Math.max(0.01, bounds.xMax - bounds.xMin)
  const yRange = Math.max(0.01, bounds.yMax - bounds.yMin)
  const scale = Number.isFinite(sharedScale) && sharedScale > 0
    ? sharedScale
    : Math.min(plot.width / xRange, plot.height / yRange)
  const usedWidth = xRange * scale
  const usedHeight = yRange * scale
  const left = plot.left + (plot.width - usedWidth) / 2
  const top = plot.top + (plot.height - usedHeight) / 2
  return {
    scale,
    x: (value) => left + (Number(value) - bounds.xMin) * scale,
    y: (value) => top + (bounds.yMax - Number(value)) * scale,
  }
}

function drawPlotGrid(context, plot, transform, bounds) {
  context.setFillStyle(COLORS.panel)
  context.fillRect(plot.left, plot.top, plot.width, plot.height)
  for (let index = 1; index < 4; index += 1) {
    const y = plot.top + plot.height * index / 4
    drawLine(context, [[plot.left, y], [plot.left + plot.width, y]], COLORS.grid, 1)
  }
  const zeroY = transform.y(0)
  if (zeroY >= plot.top && zeroY <= plot.top + plot.height) {
    drawLine(context, [[plot.left, zeroY], [plot.left + plot.width, zeroY]], COLORS.ground, 1.5)
  }
  if (bounds.xMin < 0 && bounds.xMax > 0) {
    const zeroX = transform.x(0)
    drawLine(context, [[zeroX, plot.top], [zeroX, plot.top + plot.height]], COLORS.grid, 1)
  }
}

function withPlotClip(context, plot, draw) {
  context.save()
  context.beginPath()
  context.rect(plot.left, plot.top, plot.width, plot.height)
  context.clip()
  draw()
  context.restore()
}

function drawPolarRay(context, transform, camera, angleDegrees, radius, color, width = 2) {
  const angle = radians(angleDegrees)
  const endX = camera.x + Math.cos(angle) * radius
  const endY = camera.y + Math.sin(angle) * radius
  drawLine(context, [
    [transform.x(camera.x), transform.y(camera.y)],
    [transform.x(endX), transform.y(endY)],
  ], color, width)
}

function drawAngleWedge(context, transform, camera, angles, radius, fill) {
  const points = [[transform.x(camera.x), transform.y(camera.y)]]
  const first = Number(angles[0])
  const last = Number(angles[angles.length - 1])
  const span = Math.abs(last - first)
  const steps = Math.max(1, Math.ceil(span / 2))
  for (let index = 0; index <= steps; index += 1) {
    const angleDegrees = first + (last - first) * index / steps
    const angle = radians(angleDegrees)
    points.push([
      transform.x(camera.x + Math.cos(angle) * radius),
      transform.y(camera.y + Math.sin(angle) * radius),
    ])
  }
  drawPolygon(context, points, fill, null)
}

function getSharedScale(result, width, height) {
  const plotWidth = Math.max(1, width - 32)
  const plotHeight = Math.max(1, height - 42)
  const isGround = result.sceneMode === 'ground'
  const planNear = isGround ? Number(result.cameraSetbackMeters) : Number(result.distanceMeters)
  const planFar = isGround ? planNear + Number(result.depthMeters) : planNear
  const effectiveNear = isGround ? Number(result.effectiveNearDistanceMeters) : planNear
  const effectiveFar = isGround ? effectiveNear + Number(result.effectiveDepthMeters || result.depthMeters) : planNear
  const halfTargetWidth = Number(result.widthMeters) / 2
  const halfEffectiveWidth = Number(result.effectiveWidthMeters || result.widthMeters) / 2
  const planX = Math.max(planFar, effectiveFar, 0.1)
  const planY = Math.max(halfTargetWidth, halfEffectiveWidth, 0.1) * 2.56
  const target = isGround
    ? {
      bottom: 0,
      top: Number(result.subjectHeightMeters),
      effectiveBottom: 0,
      effectiveTop: Number(result.effectiveSubjectHeightMeters || result.subjectHeightMeters),
    }
    : getPlaneTargetHeights(result)
  const cameraHeight = Number(result.cameraHeightMeters)
  const elevationMin = Math.min(target.bottom, target.effectiveBottom, cameraHeight)
  const elevationMax = Math.max(target.top, target.effectiveTop, cameraHeight)
  const elevationX = Math.max(planFar, effectiveFar, Number(result.distanceMeters) || 0, 0.1)
    + Math.max(0.4, Math.max(planFar, effectiveFar, Number(result.distanceMeters) || 0, 0.1) * 0.14)
  const elevationRange = Math.max(0, elevationMax - elevationMin)
  const elevationPadding = Math.max(0.3, elevationRange * 0.18)
  const elevationY = elevationRange + 2 * elevationPadding
  return Math.min(plotWidth / planX, plotHeight / planY, plotWidth / elevationX, plotHeight / elevationY)
}

function drawPlan(context, result, width, height) {
  const isGround = result.sceneMode === 'ground'
  const targetNear = isGround ? Number(result.cameraSetbackMeters) : Number(result.distanceMeters)
  const targetFar = isGround ? targetNear + Number(result.depthMeters) : targetNear
  const effectiveNear = isGround ? Number(result.effectiveNearDistanceMeters) : targetNear
  const effectiveFar = isGround ? effectiveNear + Number(result.effectiveDepthMeters || result.depthMeters) : targetNear
  const halfTargetWidth = Number(result.widthMeters) / 2
  const halfEffectiveWidth = Number(result.effectiveWidthMeters || result.widthMeters) / 2
  const xMax = Math.max(targetFar, effectiveFar, 0.1)
  const yExtent = Math.max(halfTargetWidth, halfEffectiveWidth, 0.1) * 1.28
  const plot = { left: 16, top: 28, width: width - 32, height: height - 42 }
  const bounds = { xMin: 0, xMax, yMin: -yExtent, yMax: yExtent }
  const sharedScale = getSharedScale(result, width, height)
  const transform = makeTransform(plot, bounds, sharedScale)
  const camera = { x: 0, y: 0 }
  const horizontalFov = Number(result.horizontalFov)
  const halfAngle = horizontalFov / 2
  const rayRadius = Math.hypot(xMax - bounds.xMin, yExtent * 2) * 3 + 1
  const physical = [
    [transform.x(targetNear), transform.y(halfTargetWidth)],
    [transform.x(targetFar), transform.y(halfTargetWidth)],
    [transform.x(targetFar), transform.y(-halfTargetWidth)],
    [transform.x(targetNear), transform.y(-halfTargetWidth)],
  ]
  const margin = [
    [transform.x(effectiveNear), transform.y(halfEffectiveWidth)],
    [transform.x(effectiveFar), transform.y(halfEffectiveWidth)],
    [transform.x(effectiveFar), transform.y(-halfEffectiveWidth)],
    [transform.x(effectiveNear), transform.y(-halfEffectiveWidth)],
  ]

  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, width, height)
  drawFittedLabel(context, `俯视 · 水平视场角 ${formatNumber(horizontalFov)}°`, 16, 20, width - 32, COLORS.text, 14, 12)
  drawPlotGrid(context, plot, transform, bounds)
  withPlotClip(context, plot, () => {
    drawAngleWedge(context, transform, camera, [-halfAngle, halfAngle], rayRadius, 'rgba(96, 165, 250, .12)')
    drawPolarRay(context, transform, camera, -halfAngle, rayRadius, COLORS.angle, 2)
    drawPolarRay(context, transform, camera, halfAngle, rayRadius, COLORS.angle, 2)
    drawPolygon(context, margin, 'rgba(251, 191, 36, .06)', COLORS.margin, 1.5, [6, 4])
    drawPolygon(context, physical, 'rgba(251, 113, 133, .18)', COLORS.target, 2)
  })
  drawCamera(context, transform.x(camera.x), transform.y(camera.y))
}

function getPlaneTargetHeights(result) {
  const bottom = Number(result.bottomHeightMeters)
  const height = Number(result.heightMeters)
  const center = bottom + height / 2
  const effectiveHeight = Number(result.effectiveHeightMeters) || height * (1 + (Number(result.marginRatio) || 0))
  return {
    bottom,
    top: bottom + height,
    effectiveBottom: Number.isFinite(Number(result.effectiveBottomHeightMeters))
      ? Number(result.effectiveBottomHeightMeters)
      : center - effectiveHeight / 2,
    effectiveTop: Number.isFinite(Number(result.effectiveTopHeightMeters))
      ? Number(result.effectiveTopHeightMeters)
      : center + effectiveHeight / 2,
  }
}

function drawElevation(context, result, width, height) {
  const complete = !result.horizontalOnly && Number.isFinite(Number(result.verticalFov))
  const isGround = result.sceneMode === 'ground'
  const targetNear = isGround ? Number(result.cameraSetbackMeters) : Number(result.distanceMeters)
  const targetFar = isGround ? targetNear + Number(result.depthMeters) : targetNear
  const effectiveNear = isGround ? Number(result.effectiveNearDistanceMeters) : targetNear
  const effectiveFar = isGround ? effectiveNear + Number(result.effectiveDepthMeters || result.depthMeters) : targetNear
  const target = isGround
    ? { bottom: 0, top: Number(result.subjectHeightMeters), effectiveBottom: 0, effectiveTop: Number(result.effectiveSubjectHeightMeters || result.subjectHeightMeters) }
    : getPlaneTargetHeights(result)
  const camera = { x: 0, y: Number(result.cameraHeightMeters) }
  const xMax = Math.max(targetFar, effectiveFar, Number(result.distanceMeters) || 0, 0.1)
  const angleValues = complete
    ? [Number(result.aimAngleDegrees) - Number(result.verticalFov) / 2, Number(result.aimAngleDegrees) + Number(result.verticalFov) / 2]
    : []
  const targetMin = Math.min(target.bottom, target.effectiveBottom, camera.y)
  const targetMax = Math.max(target.top, target.effectiveTop, camera.y)
  const yPadding = Math.max(0.3, (targetMax - targetMin) * 0.18)
  const xPadding = Math.max(0.2, xMax * 0.07)
  const plot = { left: 16, top: 28, width: width - 32, height: height - 42 }
  const bounds = { xMin: -xPadding, xMax: xMax + xPadding, yMin: targetMin - yPadding, yMax: targetMax + yPadding }
  const sharedScale = getSharedScale(result, width, height)
  const transform = makeTransform(plot, bounds, sharedScale)
  const radius = Math.hypot(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) * 4 + 1
  const physical = [
    [transform.x(targetNear), transform.y(target.top)],
    [transform.x(targetFar), transform.y(target.top)],
    [transform.x(targetFar), transform.y(target.bottom)],
    [transform.x(targetNear), transform.y(target.bottom)],
  ]
  const margin = [
    [transform.x(effectiveNear), transform.y(target.effectiveTop)],
    [transform.x(effectiveFar), transform.y(target.effectiveTop)],
    [transform.x(effectiveFar), transform.y(target.effectiveBottom)],
    [transform.x(effectiveNear), transform.y(target.effectiveBottom)],
  ]

  context.setFillStyle(COLORS.background)
  context.fillRect(0, 0, width, height)
  drawFittedLabel(
    context,
    complete ? `侧视 · 瞄准 ${formatNumber(result.aimAngleDegrees)}° / 垂直视场角 ${formatNumber(result.verticalFov)}°` : '侧视 · 垂直视场角未校核',
    16,
    20,
    width - 32,
    complete ? COLORS.text : COLORS.margin,
    14,
    12,
  )
  drawPlotGrid(context, plot, transform, bounds)
  withPlotClip(context, plot, () => {
    if (complete) {
      const lower = angleValues[0]
      const upper = angleValues[1]
      drawAngleWedge(context, transform, camera, [lower, upper], radius, 'rgba(96, 165, 250, .12)')
      drawPolarRay(context, transform, camera, lower, radius, COLORS.angle, 2)
      drawPolarRay(context, transform, camera, upper, radius, COLORS.angle, 2)
    }
    drawPolygon(context, margin, 'rgba(251, 191, 36, .06)', COLORS.margin, 1.5, [6, 4])
    drawPolygon(context, physical, 'rgba(251, 113, 133, .18)', COLORS.target, 2)
  })
  drawCamera(context, transform.x(camera.x), transform.y(camera.y))
}

function drawPreviewAtSize(context, result, width, height, view = 'plan') {
  if (!result || !Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) return
  const normalizedView = view === 'elevation' ? 'elevation' : 'plan'
  if (normalizedView === 'elevation') drawElevation(context, result, width, height)
  else drawPlan(context, result, width, height)
}

module.exports = {
  adaptCanvas2dContext,
  drawPreviewAtSize,
}

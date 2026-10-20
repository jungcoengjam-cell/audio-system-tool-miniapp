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
    supportsArc: typeof context.arc === 'function',
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
  background: '#081a2d',
  panel: '#0c2238',
  panelBorder: 'rgba(155, 193, 222, .22)',
  grid: 'rgba(177, 204, 230, .075)',
  gridMajor: 'rgba(177, 204, 230, .14)',
  plate: 'rgba(7, 23, 39, .96)',
  plateBorder: 'rgba(156, 191, 218, .32)',
  text: '#eaf3fc',
  muted: '#9db5cb',
  camera: '#75d9ed',
  cameraHalo: 'rgba(64, 190, 222, .13)',
  cameraHaloBorder: 'rgba(117, 217, 237, .45)',
  cameraGlyphFill: '#123249',
  angle: '#72aaff',
  angleFill: 'rgba(114, 170, 255, .12)',
  aim: 'rgba(177, 216, 255, .72)',
  target: '#ff8b98',
  targetFill: 'rgba(255, 120, 139, .18)',
  margin: '#f7c66a',
  marginFill: 'rgba(247, 198, 106, .045)',
  dimension: '#d3e8f4',
  dimensionLeader: 'rgba(157, 196, 218, .72)',
  ground: '#a5bdcf',
}

const LIGHT_COLORS = {
  background: '#f4f7fb',
  panel: '#ffffff',
  panelBorder: 'rgba(52, 77, 101, .2)',
  grid: 'rgba(52, 77, 101, .12)',
  gridMajor: 'rgba(52, 77, 101, .22)',
  plate: 'rgba(255, 255, 255, .96)',
  plateBorder: 'rgba(52, 77, 101, .32)',
  text: '#243547',
  muted: '#607487',
  camera: '#007c91',
  cameraHalo: 'rgba(0, 124, 145, .13)',
  cameraHaloBorder: 'rgba(0, 101, 119, .48)',
  cameraGlyphFill: '#e4f3f5',
  angle: '#2368b4',
  angleFill: 'rgba(35, 104, 180, .12)',
  aim: 'rgba(35, 90, 145, .72)',
  target: '#c13c53',
  targetFill: 'rgba(193, 60, 83, .15)',
  margin: '#875b00',
  marginFill: 'rgba(176, 125, 11, .1)',
  dimension: '#334b60',
  dimensionLeader: 'rgba(61, 84, 106, .72)',
  ground: '#5e768b',
}

function getPalette(context) {
  return context?.palette || COLORS
}

const LAYOUT = {
  sideInset: 60,
  headingBaseline: 20,
  plotTop: 30,
  plotBottomInset: 34,
  dimensionLineInset: 26,
  dimensionLabelInset: 5,
}

const radians = (degrees) => Number(degrees) * Math.PI / 180

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function isKnownNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function drawLabel(context, text, x, y, color = getPalette(context).text, size = 13, align = 'left') {
  context.setFillStyle(color)
  context.setFontSize(size)
  context.setTextAlign(align)
  context.fillText(String(text), x, y)
  context.setTextAlign('left')
}

function drawFittedLabel(context, text, x, y, maxWidth, color = getPalette(context).text, size = 13, minSize = 12, align = 'left') {
  let fittedSize = size
  context.setFontSize(fittedSize)
  while (fittedSize > minSize && context.measureText(text) > maxWidth) {
    fittedSize -= 1
    context.setFontSize(fittedSize)
  }
  drawLabel(context, text, x, y, color, fittedSize, align)
}

function drawCenteredHeading(context, fullText, compactText, width, plot, color) {
  context.setFontSize(13)
  const text = context.measureText(fullText) <= plot.width ? fullText : compactText
  drawFittedLabel(
    context,
    text,
    width / 2,
    LAYOUT.headingBaseline,
    plot.width,
    color,
    13,
    12,
    'center',
  )
}

function drawTwoLineHeading(context, statusText, detailText, width, plot, statusColor) {
  drawFittedLabel(context, statusText, width / 2, 14, plot.width, statusColor, 13, 12, 'center')
  drawFittedLabel(context, detailText, width / 2, 28, plot.width, getPalette(context).text, 13, 12, 'center')
}

function makePlot(width, height, extraTopInset = 0) {
  const inset = Math.min(LAYOUT.sideInset, Math.max(0, (width - 1) / 2))
  const plotWidth = Math.max(1, width - inset * 2)
  const top = LAYOUT.plotTop + Math.max(0, Number(extraTopInset) || 0)
  const plotHeight = Math.max(1, height - top - LAYOUT.plotBottomInset)
  return {
    left: (width - plotWidth) / 2,
    top,
    width: plotWidth,
    height: plotHeight,
    right: (width + plotWidth) / 2,
    bottom: top + plotHeight,
    safeLeft: inset,
    safeRight: width - inset,
  }
}

function measureFittedText(context, text, maxWidth, size = 12, minSize = 12) {
  let fittedSize = size
  context.setFontSize(fittedSize)
  while (fittedSize > minSize && context.measureText(text) > maxWidth) {
    fittedSize -= 1
    context.setFontSize(fittedSize)
  }
  return { size: fittedSize, width: context.measureText(text) }
}

function drawTextPlate(context, text, requestedCenterX, baselineY, plot, color = getPalette(context).text, size = 12) {
  const maxWidth = Math.max(1, plot.width - 16)
  const measured = measureFittedText(context, text, maxWidth, size, 12)
  const halfTextWidth = measured.width / 2
  const minCenterX = Math.min(plot.safeRight, plot.safeLeft + halfTextWidth + 4)
  const maxCenterX = Math.max(plot.safeLeft, plot.safeRight - halfTextWidth - 4)
  const centerX = Math.max(minCenterX, Math.min(maxCenterX, requestedCenterX))
  const left = centerX - halfTextWidth - 4
  const right = centerX + halfTextWidth + 4
  const top = baselineY - measured.size - 3
  const bottom = baselineY + 3

  drawRoundedRect(context, left, top, right - left, bottom - top, 5, getPalette(context).plate, getPalette(context).plateBorder, 0.8)
  drawLabel(context, text, centerX, baselineY, color, measured.size, 'center')
  return { centerX, left, right, top, bottom, baselineY, size: measured.size }
}

function traceRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  if (!safeRadius || context.supportsArc === false) {
    context.rect(x, y, width, height)
    return
  }
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.arc(x + width - safeRadius, y + safeRadius, safeRadius, -Math.PI / 2, 0)
  context.lineTo(x + width, y + height - safeRadius)
  context.arc(x + width - safeRadius, y + height - safeRadius, safeRadius, 0, Math.PI / 2)
  context.lineTo(x + safeRadius, y + height)
  context.arc(x + safeRadius, y + height - safeRadius, safeRadius, Math.PI / 2, Math.PI)
  context.lineTo(x, y + safeRadius)
  context.arc(x + safeRadius, y + safeRadius, safeRadius, Math.PI, Math.PI * 1.5)
  context.closePath()
}

function drawRoundedRect(context, x, y, width, height, radius, fill, stroke, lineWidth = 1) {
  if (!(width > 0) || !(height > 0)) return
  traceRoundedRect(context, x, y, width, height, radius)
  context.setFillStyle(fill)
  context.fill()
  if (stroke) {
    context.setStrokeStyle(stroke)
    context.setLineWidth(lineWidth)
    context.stroke()
  }
}

function drawDimensionMark(context, x1, y1, x2, y2, color = getPalette(context).text) {
  drawLine(context, [[x1, y1], [x2, y2]], color, 1.2)
  if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
    drawLine(context, [[x1, y1 - 3], [x1, y1 + 3]], color, 1.2)
    drawLine(context, [[x2, y2 - 3], [x2, y2 + 3]], color, 1.2)
  } else {
    drawLine(context, [[x1 - 3, y1], [x1 + 3, y1]], color, 1.2)
    drawLine(context, [[x2 - 3, y2], [x2 + 3, y2]], color, 1.2)
  }
}

function getPointsBounds(points, padding = 0) {
  if (!Array.isArray(points) || !points.length) return null
  const xs = points.map((point) => Number(point[0]))
  const ys = points.map((point) => Number(point[1]))
  return {
    left: Math.min(...xs) - padding,
    right: Math.max(...xs) + padding,
    top: Math.min(...ys) - padding,
    bottom: Math.max(...ys) + padding,
  }
}

function boxesOverlap(first, second, padding = 0) {
  if (!first || !second) return false
  return first.left < second.right + padding
    && first.right + padding > second.left
    && first.top < second.bottom + padding
    && first.bottom + padding > second.top
}

function getMainPreviewRailBounds(width, height) {
  if (height <= 200) return null
  return {
    left: Math.max(0, width - 54),
    right: width,
    top: 0,
    bottom: Math.min(120, height),
    reservedUiRegion: true,
  }
}

function getDimensionPlateBox(context, text, centerX, baselineY, canvasWidth, canvasHeight) {
  const measured = measureFittedText(context, text, Math.max(12, canvasWidth - 20), 12, 12)
  const plateWidth = measured.width + 12
  const plateHeight = measured.size + 8
  const safeHalfWidth = Math.min(plateWidth / 2, Math.max(0, canvasWidth / 2 - 4))
  const safeBaseline = Math.max(measured.size + 5, Math.min(canvasHeight - 5, baselineY))
  const safeCenterX = Math.max(safeHalfWidth + 4, Math.min(canvasWidth - safeHalfWidth - 4, centerX))
  return {
    centerX: safeCenterX,
    baselineY: safeBaseline,
    left: safeCenterX - plateWidth / 2,
    right: safeCenterX + plateWidth / 2,
    top: safeBaseline - measured.size - 4,
    bottom: safeBaseline + 4,
    size: measured.size,
    textWidth: measured.width,
    plateWidth,
    plateHeight,
  }
}

function getDimensionCandidates(anchor, start, end, preferredX, preferredY, plateWidth, plateHeight) {
  const isMostlyVertical = Math.abs(end[1] - start[1]) >= Math.abs(end[0] - start[0])
  const horizontalGap = plateWidth / 2 + 10
  const verticalGap = plateHeight + 7
  const candidates = [{ x: preferredX, y: preferredY }]
  const nearby = isMostlyVertical
    ? [
      [horizontalGap, 0],
      [-horizontalGap, 0],
      [0, -verticalGap],
      [0, verticalGap],
    ]
    : [
      [0, -verticalGap],
      [0, verticalGap],
      [horizontalGap, 0],
      [-horizontalGap, 0],
    ]
  nearby.forEach(([dx, dy]) => candidates.push({ x: preferredX + dx, y: preferredY + dy }))

  const ringX = plateWidth + 8
  const ringY = plateHeight + 7
  for (let ring = 1; ring <= 5; ring += 1) {
    candidates.push(
      { x: preferredX, y: preferredY - ring * ringY },
      { x: preferredX, y: preferredY + ring * ringY },
      { x: preferredX - ring * ringX, y: preferredY },
      { x: preferredX + ring * ringX, y: preferredY },
      { x: preferredX - ring * ringX, y: preferredY - ring * ringY },
      { x: preferredX + ring * ringX, y: preferredY - ring * ringY },
      { x: preferredX - ring * ringX, y: preferredY + ring * ringY },
      { x: preferredX + ring * ringX, y: preferredY + ring * ringY },
    )
  }
  candidates.push(
    { x: anchor.x, y: anchor.y - verticalGap },
    { x: anchor.x, y: anchor.y + verticalGap },
    { x: anchor.x - horizontalGap, y: anchor.y },
    { x: anchor.x + horizontalGap, y: anchor.y },
  )
  return candidates
}

function getDimensionLabelBox(context, text, start, end, plot, occupied, preferred, width, height) {
  const anchor = { x: (start[0] + end[0]) / 2, y: (start[1] + end[1]) / 2 }
  const measured = measureFittedText(context, text, Math.max(12, width - 20), 12, 12)
  const plateWidth = measured.width + 12
  const plateHeight = measured.size + 8
  const obstacles = (occupied || []).filter(Boolean)
  const candidates = getDimensionCandidates(
    anchor,
    start,
    end,
    Number(preferred.x),
    Number(preferred.y),
    plateWidth,
    plateHeight,
  )
  let bestClear = null
  let bestOutsideReservedRegions = null
  let bestFallback = null

  candidates.forEach((candidate) => {
    const box = getDimensionPlateBox(context, text, candidate.x, candidate.y, width, height)
    const colliding = obstacles.filter((obstacle) => boxesOverlap(box, obstacle, 3))
    const distance = Math.hypot(box.centerX - Number(preferred.x), box.baselineY - Number(preferred.y))
    const candidateResult = { box, distance, collisions: colliding.length }
    const reservedCollisions = colliding.filter((obstacle) => obstacle.reservedUiRegion).length
    if (colliding.length === 0 && (!bestClear || distance < bestClear.distance)) {
      bestClear = candidateResult
    }
    if (reservedCollisions === 0
      && (!bestOutsideReservedRegions || colliding.length < bestOutsideReservedRegions.collisions
        || (colliding.length === bestOutsideReservedRegions.collisions
          && distance < bestOutsideReservedRegions.distance))) {
      bestOutsideReservedRegions = candidateResult
    }
    if (!bestFallback
      || reservedCollisions < bestFallback.reservedCollisions
      || (reservedCollisions === bestFallback.reservedCollisions
        && (colliding.length < bestFallback.collisions
          || (colliding.length === bestFallback.collisions && distance < bestFallback.distance)))) {
      bestFallback = candidateResult
      bestFallback.reservedCollisions = reservedCollisions
    }
  })

  return (bestClear || bestOutsideReservedRegions || bestFallback)?.box
    || getDimensionPlateBox(context, text, plot.left + 12, plot.top + 48, width, height)
}

function getNearestBoxPoint(box, point) {
  return {
    x: Math.max(box.left, Math.min(box.right, point.x)),
    y: Math.max(box.top, Math.min(box.bottom, point.y)),
  }
}

function drawDimensionAnnotation(context, text, start, end, plot, occupied, preferred, width, height) {
  drawDimensionMark(context, start[0], start[1], end[0], end[1], getPalette(context).dimension)
  const box = getDimensionLabelBox(context, text, start, end, plot, occupied, preferred, width, height)
  const anchor = { x: (start[0] + end[0]) / 2, y: (start[1] + end[1]) / 2 }
  const connection = getNearestBoxPoint(box, anchor)
  if (Math.hypot(connection.x - anchor.x, connection.y - anchor.y) > 7) {
    drawLine(context, [[anchor.x, anchor.y], [connection.x, connection.y]], getPalette(context).dimensionLeader, 0.8)
  }
  drawRoundedRect(context, box.left, box.top, box.right - box.left, box.bottom - box.top, 5, getPalette(context).plate, getPalette(context).plateBorder, 0.8)
  drawLabel(context, text, box.centerX, box.baselineY, getPalette(context).text, box.size, 'center')
  occupied.push(box)
  return box
}

function drawDistanceDimension(context, result, transform, plot, height, targetNear) {
  const x1 = transform.x(0)
  const x2 = transform.x(targetNear)
  const lineY = height - LAYOUT.dimensionLineInset
  const groundY = transform.y(0)
  const labelY = height - LAYOUT.dimensionLabelInset
  const distanceLabel = result.sceneMode === 'ground'
    ? `${result.horizontalOnly ? '仅水平前沿下限' : '理论最小前沿退距'} ${formatNumber(result.cameraSetbackMeters)}m`
    : `${result.horizontalOnly ? '仅水平平面下限' : '理论最小平面距离'} ${formatNumber(result.distanceMeters)}m`
  const labelMeasure = measureFittedText(context, distanceLabel, plot.width - 16, 14, 12)
  const requestedCenterX = (x1 + x2) / 2

  drawLine(context, [[x1, groundY], [x1, lineY]], getPalette(context).muted, 0.8, [2, 3])
  drawLine(context, [[x2, groundY], [x2, lineY]], getPalette(context).muted, 0.8, [2, 3])
  drawDimensionMark(context, x1, lineY, x2, lineY, getPalette(context).text)

  const labelTop = labelY - labelMeasure.size - 3
  drawLine(context, [
    [requestedCenterX, lineY + 3],
    [requestedCenterX, labelTop],
  ], getPalette(context).muted, 0.9)
  const label = drawTextPlate(context, distanceLabel, requestedCenterX, labelY, plot, getPalette(context).text, 14)
  if (Math.abs(label.centerX - requestedCenterX) > 1) {
    drawLine(context, [
      [requestedCenterX, labelTop],
      [label.centerX, labelTop],
    ], getPalette(context).muted, 0.9)
  }
  return label
}

function drawPlanHeightCallout(context, result, transform, plot) {
  const cameraX = transform.x(0)
  const cameraY = transform.y(0)
  const cameraHeightKnown = isKnownNumber(result.cameraHeightMeters)
  const heightLabel = cameraHeightKnown
    ? (result.heightMode === 'fixed' ? '已有镜头高' : '建议镜头高')
    : '镜头高度'
  const heightValue = cameraHeightKnown
    ? formatNumber(result.cameraHeightMeters) + 'm'
    : '未校核 —'
  const titleBaseline = Math.max(plot.top + 14, Math.min(plot.bottom - 28, cameraY - 24))
  const valueBaseline = titleBaseline + 14
  const noteX = cameraHeightKnown ? plot.left + 10 : 8
  const textAlign = cameraHeightKnown ? 'right' : 'left'
  drawLine(context, [
    [cameraX - 9, cameraY - 4],
    [noteX, (titleBaseline + valueBaseline) / 2],
  ], getPalette(context).camera, 1)
  drawLabel(context, heightLabel, noteX, titleBaseline, getPalette(context).camera, 12, textAlign)
  drawLabel(context, heightValue, noteX, valueBaseline, getPalette(context).camera, 14, textAlign)
  context.setFontSize(12)
  const titleWidth = context.measureText(heightLabel)
  context.setFontSize(14)
  const valueWidth = context.measureText(heightValue)
  return cameraHeightKnown ? {
    left: noteX - Math.max(titleWidth, valueWidth) - 5,
    right: noteX + 3,
    top: titleBaseline - 13,
    bottom: valueBaseline + 4,
  } : {
    left: noteX - 3,
    right: noteX + Math.max(titleWidth, valueWidth) + 3,
    top: titleBaseline - 13,
    bottom: valueBaseline + 4,
  }
}

function drawElevationHeightDimension(context, result, transform, plot) {
  const cameraHeightKnown = isKnownNumber(result.cameraHeightMeters)
  const cameraHeight = cameraHeightKnown ? Number(result.cameraHeightMeters) : 0
  if (cameraHeightKnown && cameraHeight < 0) return null
  if (!cameraHeightKnown) {
    const noteX = 8
    const titleBaseline = Math.min(plot.bottom - 27, plot.top + 44)
    const title = '镜头高度'
    const value = '未校核 —'
    drawLabel(context, title, noteX, titleBaseline, getPalette(context).camera, 12, 'left')
    drawLabel(context, value, noteX, titleBaseline + 14, getPalette(context).camera, 14, 'left')
    context.setFontSize(12)
    const titleWidth = context.measureText(title)
    context.setFontSize(14)
    const valueWidth = context.measureText(value)
    return {
      left: noteX - 3,
      right: noteX + Math.max(titleWidth, valueWidth) + 3,
      top: titleBaseline - 13,
      bottom: titleBaseline + 18,
    }
  }

  const cameraX = transform.x(0)
  const cameraY = transform.y(cameraHeight)
  const groundY = transform.y(0)
  const dimensionX = Math.max(plot.left, Math.min(plot.left + 18, cameraX - 8))
  const middleY = (cameraY + groundY) / 2
  const heightLabel = cameraHeightKnown
    ? (result.heightMode === 'fixed' ? '已有镜头高' : '建议镜头高')
    : '镜头高度未校核'
  const heightValue = formatNumber(cameraHeight) + 'm'
  const titleBaseline = Math.max(plot.top + 12, Math.min(plot.bottom - 26, middleY - 7))
  const valueBaseline = titleBaseline + 14
  const noteX = Math.max(4, plot.left + 10)

  drawLine(context, [[cameraX - 11, cameraY], [dimensionX, cameraY]], getPalette(context).camera, 0.9)
  drawLine(context, [[cameraX - 11, groundY], [dimensionX, groundY]], getPalette(context).camera, 0.9)
  drawDimensionMark(context, dimensionX, cameraY, dimensionX, groundY, getPalette(context).camera)

  drawLine(context, [
    [dimensionX, middleY],
    [noteX - 3, (titleBaseline + valueBaseline) / 2],
  ], getPalette(context).camera, 1)
  drawLabel(context, heightLabel, noteX, titleBaseline, getPalette(context).camera, 12, 'right')
  drawLabel(context, `${formatNumber(cameraHeight)}m`, noteX, valueBaseline, getPalette(context).camera, 14, 'right')
  context.setFontSize(12)
  const titleWidth = context.measureText(heightLabel)
  context.setFontSize(14)
  const valueWidth = context.measureText(heightValue)
  return {
    left: noteX - Math.max(titleWidth, valueWidth) - 5,
    right: noteX + 3,
    top: titleBaseline - 13,
    bottom: valueBaseline + 4,
  }
}

function drawLine(context, points, color = getPalette(context).muted, width = 1, dash = []) {
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

function drawCamera(context, x, y, aimAngle = null) {
  drawRoundedRect(context, x - 11, y - 11, 22, 22, 11, getPalette(context).cameraHalo, getPalette(context).cameraHaloBorder, 0.8)
  if (isKnownNumber(aimAngle)) {
    const rotation = -radians(aimAngle)
    const cosine = Math.cos(rotation)
    const sine = Math.sin(rotation)
    const glyph = [
      [-15, -4], [-7, -4], [-7, -6], [-2, -6], [-2, -4],
      [0, 0], [-2, 4], [-2, 6], [-7, 6], [-7, 4], [-15, 4],
    ].map(([localX, localY]) => [
      x + localX * cosine - localY * sine,
      y + localX * sine + localY * cosine,
    ])
    drawPolygon(context, glyph, getPalette(context).cameraGlyphFill, getPalette(context).camera, 1)
  } else {
    drawLine(context, [[x - 6, y], [x + 6, y]], getPalette(context).camera, 1)
    drawLine(context, [[x, y - 6], [x, y + 6]], getPalette(context).camera, 1)
  }
  if (context.supportsArc !== false) {
    context.beginPath()
    context.arc(x, y, 2.2, 0, Math.PI * 2)
    context.setFillStyle(getPalette(context).text)
    context.fill()
  } else {
    context.setFillStyle(getPalette(context).text)
    context.fillRect(x - 1.5, y - 1.5, 3, 3)
  }
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
  drawRoundedRect(context, plot.left, plot.top, plot.width, plot.height, 12, getPalette(context).panel, null)
  context.save()
  traceRoundedRect(context, plot.left, plot.top, plot.width, plot.height, 12)
  context.clip()
  for (let index = 1; index < 5; index += 1) {
    const y = plot.top + plot.height * index / 5
    const color = index === 2 ? getPalette(context).gridMajor : getPalette(context).grid
    drawLine(context, [[plot.left, y], [plot.left + plot.width, y]], color, 1)
  }
  for (let index = 1; index < 6; index += 1) {
    const x = plot.left + plot.width * index / 6
    const color = index === 3 ? getPalette(context).gridMajor : getPalette(context).grid
    drawLine(context, [[x, plot.top], [x, plot.top + plot.height]], color, 1)
  }
  const zeroY = transform.y(0)
  if (zeroY >= plot.top && zeroY <= plot.top + plot.height) {
    drawLine(context, [[plot.left, zeroY], [plot.left + plot.width, zeroY]], getPalette(context).ground, 1.5)
  }
  if (bounds.xMin < 0 && bounds.xMax > 0) {
    const zeroX = transform.x(0)
    drawLine(context, [[zeroX, plot.top], [zeroX, plot.top + plot.height]], getPalette(context).gridMajor, 1)
  }
  context.restore()
  traceRoundedRect(context, plot.left, plot.top, plot.width, plot.height, 12)
  context.setStrokeStyle(getPalette(context).panelBorder)
  context.setLineWidth(1)
  context.stroke()
}

function withPlotClip(context, plot, draw) {
  context.save()
  traceRoundedRect(context, plot.left, plot.top, plot.width, plot.height, 12)
  context.clip()
  draw()
  context.restore()
}

function drawPolarRay(context, transform, camera, angleDegrees, radius, color, width = 2, dash = []) {
  const angle = radians(angleDegrees)
  const endX = camera.x + Math.cos(angle) * radius
  const endY = camera.y + Math.sin(angle) * radius
  drawLine(context, [
    [transform.x(camera.x), transform.y(camera.y)],
    [transform.x(endX), transform.y(endY)],
  ], color, width, dash)
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

function getSharedScale(result, plot) {
  const plotWidth = Math.max(1, plot.width)
  const plotHeight = Math.max(1, plot.height)
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
  const elevationMin = Math.min(0, target.bottom, target.effectiveBottom, cameraHeight)
  const elevationMax = Math.max(0, target.top, target.effectiveTop, cameraHeight)
  const elevationTargetFar = Math.max(planFar, effectiveFar, Number(result.distanceMeters) || 0, 0.1)
  const elevationXPadding = Math.max(0.2, elevationTargetFar * 0.07)
  const elevationX = elevationTargetFar + elevationXPadding * 2
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
  const plot = makePlot(width, height, result.horizontalOnly ? 4 : 0)
  const bounds = { xMin: 0, xMax, yMin: -yExtent, yMax: yExtent }
  const sharedScale = getSharedScale(result, plot)
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

  context.setFillStyle(getPalette(context).background)
  context.fillRect(0, 0, width, height)
  if (result.horizontalOnly) {
    drawTwoLineHeading(
      context,
      '仅水平参考·垂直未校核',
      `俯视·水平角${formatNumber(horizontalFov)}°`,
      width,
      plot,
      getPalette(context).margin,
    )
  } else {
    drawCenteredHeading(
      context,
      `俯视·水平角${formatNumber(horizontalFov)}°`,
      `水平角${formatNumber(horizontalFov)}°`,
      width,
      plot,
      getPalette(context).text,
    )
  }
  drawPlotGrid(context, plot, transform, bounds)
  withPlotClip(context, plot, () => {
    drawAngleWedge(context, transform, camera, [-halfAngle, halfAngle], rayRadius, getPalette(context).angleFill)
    drawPolarRay(context, transform, camera, 0, rayRadius, getPalette(context).aim, 1, [5, 5])
    drawPolarRay(context, transform, camera, -halfAngle, rayRadius, getPalette(context).angle, 2.2)
    drawPolarRay(context, transform, camera, halfAngle, rayRadius, getPalette(context).angle, 2.2)
    drawPolygon(context, margin, getPalette(context).marginFill, getPalette(context).margin, 1.35, [6, 4])
    drawPolygon(context, physical, getPalette(context).targetFill, getPalette(context).target, 2.1)
  })
  const cameraX = transform.x(camera.x)
  const cameraY = transform.y(camera.y)
  const occupied = [
    { left: 4, right: width - 4, top: 0, bottom: result.horizontalOnly ? 36 : 26 },
    { left: 4, right: width - 4, top: height - 38, bottom: height - 2 },
    getMainPreviewRailBounds(width, height),
    drawDistanceDimension(context, result, transform, plot, height, targetNear),
    drawPlanHeightCallout(context, result, transform, plot),
    { left: cameraX - 18, right: cameraX + 12, top: cameraY - 13, bottom: cameraY + 13 },
    getPointsBounds(physical, 4),
    getPointsBounds(margin, 4),
  ].filter(Boolean)

  const widthLabel = '宽 ' + formatNumber(result.widthMeters) + 'm'
  const widthStart = [transform.x(targetFar), transform.y(halfTargetWidth)]
  const widthEnd = [transform.x(targetFar), transform.y(-halfTargetWidth)]
  const widthLabelWidth = measureFittedText(context, widthLabel, Math.max(12, width - 20), 12, 12).width + 12
  drawDimensionAnnotation(
    context,
    widthLabel,
    widthStart,
    widthEnd,
    plot,
    occupied,
    { x: widthStart[0] + widthLabelWidth / 2 + 10, y: (widthStart[1] + widthEnd[1]) / 2 },
    width,
    height,
  )

  if (isGround) {
    const depthLabel = '纵深 ' + formatNumber(result.depthMeters) + 'm'
    const depthStart = [transform.x(targetNear), transform.y(halfTargetWidth)]
    const depthEnd = [transform.x(targetFar), transform.y(halfTargetWidth)]
    drawDimensionAnnotation(
      context,
      depthLabel,
      depthStart,
      depthEnd,
      plot,
      occupied,
      { x: (depthStart[0] + depthEnd[0]) / 2, y: depthStart[1] - 12 },
      width,
      height,
    )
  }
  drawCamera(context, cameraX, cameraY, 0)
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
  const cameraHeightKnown = isKnownNumber(result.cameraHeightMeters)
  const complete = !result.horizontalOnly
    && cameraHeightKnown
    && isKnownNumber(result.aimAngleDegrees)
    && isKnownNumber(result.verticalFov)
  const isGround = result.sceneMode === 'ground'
  const targetNear = isGround ? Number(result.cameraSetbackMeters) : Number(result.distanceMeters)
  const targetFar = isGround ? targetNear + Number(result.depthMeters) : targetNear
  const effectiveNear = isGround ? Number(result.effectiveNearDistanceMeters) : targetNear
  const effectiveFar = isGround ? effectiveNear + Number(result.effectiveDepthMeters || result.depthMeters) : targetNear
  const target = isGround
    ? { bottom: 0, top: Number(result.subjectHeightMeters), effectiveBottom: 0, effectiveTop: Number(result.effectiveSubjectHeightMeters || result.subjectHeightMeters) }
    : getPlaneTargetHeights(result)
  const camera = { x: 0, y: cameraHeightKnown ? Number(result.cameraHeightMeters) : 0 }
  const xMax = Math.max(targetFar, effectiveFar, Number(result.distanceMeters) || 0, 0.1)
  const angleValues = complete
    ? [Number(result.aimAngleDegrees) - Number(result.verticalFov) / 2, Number(result.aimAngleDegrees) + Number(result.verticalFov) / 2]
    : []
  const targetMin = Math.min(0, target.bottom, target.effectiveBottom, camera.y)
  const targetMax = Math.max(0, target.top, target.effectiveTop, camera.y)
  const yPadding = Math.max(0.3, (targetMax - targetMin) * 0.18)
  const xPadding = Math.max(0.2, xMax * 0.07)
  const plot = makePlot(width, height, complete ? 0 : 4)
  const bounds = { xMin: -xPadding, xMax: xMax + xPadding, yMin: targetMin - yPadding, yMax: targetMax + yPadding }
  const sharedScale = getSharedScale(result, plot)
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
  const aimDescription = isKnownNumber(result.aimAngleDegrees)
    ? '侧视·俯仰' + formatNumber(result.aimAngleDegrees) + '°'
    : '侧视·俯仰未校核'

  context.setFillStyle(getPalette(context).background)
  context.fillRect(0, 0, width, height)
  if (complete) {
    drawCenteredHeading(
      context,
      `侧视·俯仰${formatNumber(result.aimAngleDegrees)}°·垂直${formatNumber(result.verticalFov)}°`,
      `俯仰${formatNumber(result.aimAngleDegrees)}°·垂直${formatNumber(result.verticalFov)}°`,
      width,
      plot,
      getPalette(context).text,
    )
  } else {
    drawTwoLineHeading(
      context,
      '仅水平参考·垂直未校核',
      aimDescription,
      width,
      plot,
      getPalette(context).margin,
    )
  }
  drawPlotGrid(context, plot, transform, bounds)
  withPlotClip(context, plot, () => {
    if (complete) {
      const lower = angleValues[0]
      const upper = angleValues[1]
      drawAngleWedge(context, transform, camera, [lower, upper], radius, getPalette(context).angleFill)
      drawPolarRay(context, transform, camera, lower, radius, getPalette(context).angle, 2.2)
      drawPolarRay(context, transform, camera, upper, radius, getPalette(context).angle, 2.2)
    }
    if (cameraHeightKnown && isKnownNumber(result.aimAngleDegrees)) {
      drawPolarRay(context, transform, camera, Number(result.aimAngleDegrees), radius, getPalette(context).aim, 1, [5, 5])
    }
    drawPolygon(context, margin, getPalette(context).marginFill, getPalette(context).margin, 1.35, [6, 4])
    drawPolygon(context, physical, getPalette(context).targetFill, getPalette(context).target, 2.1)
  })
  const cameraX = transform.x(camera.x)
  const cameraY = transform.y(camera.y)
  const occupied = [
    { left: 4, right: width - 4, top: 0, bottom: result.horizontalOnly ? 36 : 26 },
    { left: 4, right: width - 4, top: height - 38, bottom: height - 2 },
    getMainPreviewRailBounds(width, height),
    drawDistanceDimension(context, result, transform, plot, height, targetNear),
    drawElevationHeightDimension(context, result, transform, plot),
    cameraHeightKnown
      ? { left: cameraX - 18, right: cameraX + 12, top: cameraY - 13, bottom: cameraY + 13 }
      : null,
    getPointsBounds(physical, 4),
    getPointsBounds(margin, 4),
  ].filter(Boolean)

  if (isGround) {
    const depthLabel = '纵深 ' + formatNumber(result.depthMeters) + 'm'
    const depthStart = [transform.x(targetNear), transform.y(target.top)]
    const depthEnd = [transform.x(targetFar), transform.y(target.top)]
    drawDimensionAnnotation(
      context,
      depthLabel,
      depthStart,
      depthEnd,
      plot,
      occupied,
      { x: (depthStart[0] + depthEnd[0]) / 2, y: depthStart[1] - 12 },
      width,
      height,
    )

    const highestLabel = '最高 ' + formatNumber(result.subjectHeightMeters) + 'm'
    const highestStart = [transform.x(targetFar), transform.y(target.bottom)]
    const highestEnd = [transform.x(targetFar), transform.y(target.top)]
    const highestLabelWidth = measureFittedText(context, highestLabel, Math.max(12, width - 20), 12, 12).width + 12
    drawDimensionAnnotation(
      context,
      highestLabel,
      highestStart,
      highestEnd,
      plot,
      occupied,
      { x: highestStart[0] + highestLabelWidth / 2 + 10, y: (highestStart[1] + highestEnd[1]) / 2 },
      width,
      height,
    )
  } else {
    const planeX = transform.x(targetNear)
    const heightLabel = '高度 ' + formatNumber(result.heightMeters) + 'm'
    const heightStart = [planeX, transform.y(target.top)]
    const heightEnd = [planeX, transform.y(target.bottom)]
    const heightLabelWidth = measureFittedText(context, heightLabel, Math.max(12, width - 20), 12, 12).width + 12
    drawDimensionAnnotation(
      context,
      heightLabel,
      heightStart,
      heightEnd,
      plot,
      occupied,
      { x: planeX - heightLabelWidth / 2 - 10, y: (heightStart[1] + heightEnd[1]) / 2 },
      width,
      height,
    )

    const bottomLabel = '底边离地 ' + formatNumber(result.bottomHeightMeters) + 'm'
    const bottomStart = [planeX, transform.y(target.bottom)]
    const bottomEnd = [planeX, transform.y(0)]
    const bottomLabelWidth = measureFittedText(context, bottomLabel, Math.max(12, width - 20), 12, 12).width + 12
    drawDimensionAnnotation(
      context,
      bottomLabel,
      bottomStart,
      bottomEnd,
      plot,
      occupied,
      { x: planeX + bottomLabelWidth / 2 + 10, y: (bottomStart[1] + bottomEnd[1]) / 2 },
      width,
      height,
    )
  }
  if (cameraHeightKnown) {
    drawCamera(
      context,
      cameraX,
      cameraY,
      isKnownNumber(result.aimAngleDegrees) ? Number(result.aimAngleDegrees) : null,
    )
  }
}

function drawPreviewAtSize(context, result, width, height, view = 'plan', theme) {
  if (!result || !Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) return
  const themedContext = Object.create(context)
  themedContext.palette = theme === 'light' ? LIGHT_COLORS : COLORS
  const normalizedView = view === 'elevation' ? 'elevation' : 'plan'
  if (normalizedView === 'elevation') drawElevation(themedContext, result, width, height)
  else drawPlan(themedContext, result, width, height)
}

module.exports = {
  adaptCanvas2dContext,
  drawPreviewAtSize,
}

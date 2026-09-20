const NON_AUDIENCE_COLOR = '#e3e7ed'
const REPORT_HEATMAP_STOPS = [
  { value: -12, color: '#4057b2' },
  { value: -7, color: '#398bc6' },
  { value: -3, color: '#4ebfcb' },
  { value: 0, color: '#55b788' },
  { value: 3, color: '#b8ca65' },
  { value: 6, color: '#f2bb4c' },
  { value: 12, color: '#df625e' },
]
const REPORT_HEATMAP_TICKS = [-12, -6, 0, 6, 12]
const REPORT_HEATMAP_GRADIENT = `linear-gradient(90deg, ${REPORT_HEATMAP_STOPS.map((stop) => `${stop.color} ${((stop.value + 12) / 24) * 100}%`).join(', ')})`
const DISCUSSION_COVERAGE_COLORS = ['#e3e7ed', '#78c8cf', '#769bdb', '#ac83cd']
const DISCUSSION_GRID_COLUMNS = 32
const DISCUSSION_MIN_GRID_ROWS = 20
const DISCUSSION_MAX_GRID_ROWS = 48
const REPORT_PLAN_PADDING = { left: 48, right: 66, top: 34, bottom: 60 }
const DISCUSSION_PLAN_PADDING = { left: 46, right: 32, top: 34, bottom: 48 }
const { buildDiscussionCoverageSummary } = require('../../utils/venue-discussion')
const { buildReportCoveragePolygon: buildGeometryCoveragePolygon } = require('../../utils/venue-geometry')

function parseHexColor(color) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))
}

function getHeatmapColor(relativeLevelDb) {
  if (!Number.isFinite(relativeLevelDb)) return null
  const value = Math.min(Math.max(relativeLevelDb, REPORT_HEATMAP_STOPS[0].value), REPORT_HEATMAP_STOPS[REPORT_HEATMAP_STOPS.length - 1].value)
  for (let index = 1; index < REPORT_HEATMAP_STOPS.length; index += 1) {
    const upper = REPORT_HEATMAP_STOPS[index]
    if (value > upper.value) continue
    const lower = REPORT_HEATMAP_STOPS[index - 1]
    const ratio = (value - lower.value) / (upper.value - lower.value)
    const lowerRgb = parseHexColor(lower.color)
    const upperRgb = parseHexColor(upper.color)
    const rgb = lowerRgb.map((channel, channelIndex) => Math.round(channel + ((upperRgb[channelIndex] - channel) * ratio)))
    return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  }
  return REPORT_HEATMAP_STOPS[REPORT_HEATMAP_STOPS.length - 1].color
}

function clipPolygonToRect(polygon, bounds) {
  const edges = [
    {
      inside: (point) => point.x >= bounds.left,
      intersection: (start, end) => ({
        x: bounds.left,
        y: start.y + ((end.y - start.y) * (bounds.left - start.x) / (end.x - start.x)),
      }),
    },
    {
      inside: (point) => point.x <= bounds.right,
      intersection: (start, end) => ({
        x: bounds.right,
        y: start.y + ((end.y - start.y) * (bounds.right - start.x) / (end.x - start.x)),
      }),
    },
    {
      inside: (point) => point.y >= bounds.top,
      intersection: (start, end) => ({
        x: start.x + ((end.x - start.x) * (bounds.top - start.y) / (end.y - start.y)),
        y: bounds.top,
      }),
    },
    {
      inside: (point) => point.y <= bounds.bottom,
      intersection: (start, end) => ({
        x: start.x + ((end.x - start.x) * (bounds.bottom - start.y) / (end.y - start.y)),
        y: bounds.bottom,
      }),
    },
  ]

  return edges.reduce((points, edge) => {
    if (!points.length) return []
    const clipped = []
    let previous = points[points.length - 1]
    let previousInside = edge.inside(previous)
    points.forEach((current) => {
      const currentInside = edge.inside(current)
      if (currentInside !== previousInside) {
        const denominator = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)
        if (denominator > 0) clipped.push(edge.intersection(previous, current))
      }
      if (currentInside) clipped.push(current)
      previous = current
      previousInside = currentInside
    })
    return clipped
  }, polygon)
}

function buildReportCoveragePolygon(source, plan) {
  return buildGeometryCoveragePolygon(source, plan, plan.speakerCenterHeightMeters)
}

function drawSourceCoverage(context, source, plan, roomLeft, roomTop, roomWidth, roomHeight) {
  const polygon = buildReportCoveragePolygon(source, plan)
  if (polygon.length < 3) return
  const color = source.type === 'main' ? '#173d7a' : '#0f8a70'

  context.save()
  context.beginPath()
  context.moveTo(
    roomLeft + (polygon[0].x / plan.roomWidthMeters) * roomWidth,
    roomTop + (polygon[0].y / plan.roomDepthMeters) * roomHeight,
  )
  polygon.slice(1).forEach((point) => {
    context.lineTo(
      roomLeft + (point.x / plan.roomWidthMeters) * roomWidth,
      roomTop + (point.y / plan.roomDepthMeters) * roomHeight,
    )
  })
  context.closePath()
  context.setStrokeStyle(color)
  context.setGlobalAlpha(0.76)
  context.setLineWidth(1)
  context.stroke()
  context.restore()
}

function drawDistanceGuide(context, group, index, plan, roomLeft, roomTop, roomWidth, roomHeight, canvasWidth) {
  const guideDistance = Number.isFinite(group.mainToFillDistanceMetersRaw)
    ? group.mainToFillDistanceMetersRaw
    : group.mainToFillDistanceMeters
  const endY = roomTop + (guideDistance / plan.roomDepthMeters) * roomHeight
  const guideX = roomLeft + roomWidth + 12 + (index * 14)
  const label = `${group.mainToFillDistanceMeters} m`
  const labelWidth = 28
  const labelX = Math.min(Math.max(guideX + 5, 4), canvasWidth - labelWidth - 4)
  const labelY = Math.max(roomTop + 12, Math.min((roomTop + endY) / 2, roomTop + roomHeight - 12))

  context.save()
  context.setFillStyle('rgba(23, 61, 122, 0.78)')
  for (let y = roomTop + 5; y < endY - 5; y += 8) {
    context.fillRect(guideX - 0.5, y, 1, 4)
  }
  context.setStrokeStyle('#173d7a')
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(guideX - 4, roomTop + 4)
  context.lineTo(guideX, roomTop)
  context.lineTo(guideX + 4, roomTop + 4)
  context.moveTo(guideX - 4, endY - 4)
  context.lineTo(guideX, endY)
  context.lineTo(guideX + 4, endY - 4)
  context.stroke()
  context.setFillStyle('rgba(255, 255, 255, 0.9)')
  context.fillRect(labelX - 3, labelY - 8, labelWidth, 14)
  context.setFillStyle('#173d7a')
  context.setFontSize(9)
  context.fillText(label, labelX, labelY + 2)
  context.restore()
}

function drawRoomDimensions(context, plan, roomLeft, roomTop, roomWidth, roomHeight) {
  const widthGuideY = roomTop + roomHeight + 18
  const depthGuideX = roomLeft - 24
  const widthLabel = `宽 ${plan.roomWidthMeters} m`
  const depthLabel = `长 ${plan.roomDepthMeters} m`
  const widthBadgeWidth = Math.max(48, (widthLabel.length * 8) + 8)
  const depthBadgeWidth = Math.max(46, (depthLabel.length * 8) + 8)
  const widthBadgeX = roomLeft + (roomWidth / 2) - (widthBadgeWidth / 2)
  const depthBadgeX = Math.max(3, depthGuideX - 28)

  context.save()
  context.setStrokeStyle('#58729a')
  context.setFillStyle('#58729a')
  context.setLineWidth(1)
  context.beginPath()
  context.moveTo(roomLeft, widthGuideY)
  context.lineTo(roomLeft + roomWidth, widthGuideY)
  context.moveTo(roomLeft + 4, widthGuideY - 4)
  context.lineTo(roomLeft, widthGuideY)
  context.lineTo(roomLeft + 4, widthGuideY + 4)
  context.moveTo(roomLeft + roomWidth - 4, widthGuideY - 4)
  context.lineTo(roomLeft + roomWidth, widthGuideY)
  context.lineTo(roomLeft + roomWidth - 4, widthGuideY + 4)
  context.moveTo(depthGuideX, roomTop)
  context.lineTo(depthGuideX, roomTop + roomHeight)
  context.moveTo(depthGuideX - 4, roomTop + 4)
  context.lineTo(depthGuideX, roomTop)
  context.lineTo(depthGuideX + 4, roomTop + 4)
  context.moveTo(depthGuideX - 4, roomTop + roomHeight - 4)
  context.lineTo(depthGuideX, roomTop + roomHeight)
  context.lineTo(depthGuideX + 4, roomTop + roomHeight - 4)
  context.stroke()
  context.setFontSize(10)
  context.setFillStyle('rgba(255, 255, 255, 0.88)')
  context.fillRect(widthBadgeX, widthGuideY - 8, widthBadgeWidth, 14)
  context.fillRect(depthBadgeX, roomTop + (roomHeight / 2) - 8, depthBadgeWidth, 14)
  context.setFillStyle('#49617f')
  context.fillText(widthLabel, widthBadgeX + 4, widthGuideY + 2)
  context.fillText(depthLabel, depthBadgeX + 3, roomTop + (roomHeight / 2) + 2)
  context.restore()
}

function drawListeningZones(context, plan, roomLeft, roomTop, roomWidth, roomHeight) {
  const firstRowY = roomTop
    + (plan.firstListeningDistanceMeters / plan.roomDepthMeters) * roomHeight
  const lastRowY = roomTop
    + (plan.lastListeningDistanceMeters / plan.roomDepthMeters) * roomHeight
  const listeningLeft = roomLeft
    + (plan.listeningSideMarginMeters / plan.roomWidthMeters) * roomWidth
  const listeningWidth = (plan.listeningWidthMeters / plan.roomWidthMeters) * roomWidth

  context.save()
  context.setFillStyle('#75839a')
  context.setFontSize(10)
  context.fillText('听音区外', roomLeft + 7, roomTop + 15)
  context.setStrokeStyle('#58729a')
  context.setLineWidth(1)
  for (let x = listeningLeft; x < listeningLeft + listeningWidth; x += 9) {
    context.fillRect(x, firstRowY - 0.5, 5, 1)
    context.fillRect(x, lastRowY - 0.5, 5, 1)
  }
  context.strokeRect(listeningLeft, firstRowY, listeningWidth, Math.max(lastRowY - firstRowY, 1))
  context.setFillStyle('rgba(255, 255, 255, 0.9)')
  context.fillRect(roomLeft + 6, firstRowY + 4, 55, 14)
  context.setFillStyle('#58729a')
  context.fillText('首排听音线', roomLeft + 9, firstRowY + 14)
  context.setFillStyle('rgba(255, 255, 255, 0.9)')
  context.fillRect(roomLeft + 6, Math.max(lastRowY - 18, firstRowY + 20), 62, 14)
  context.setFillStyle('#58729a')
  context.fillText('最后一排线', roomLeft + 9, Math.max(lastRowY - 8, firstRowY + 30))
  context.restore()
}

function buildDiscussionDirectionalPolygon(source, plan) {
  const roomCorners = [
    [0, 0],
    [plan.roomWidthMeters, 0],
    [0, plan.roomDepthMeters],
    [plan.roomWidthMeters, plan.roomDepthMeters],
  ]
  // 角度包络本身没有距离截断；绘图延至房间边界后裁切，这个长度不是声学服务距离。
  const length = Math.max(
    Number(source.coverageLengthMeters) || 0,
    ...roomCorners.map(([widthMeters, depthMeters]) => Math.hypot(
      widthMeters - source.widthMeters,
      depthMeters - source.depthMeters,
    )),
  )
  const halfWidth = Math.tan((source.coverageDeg / 2) * Math.PI / 180) * length
  const endWidth = source.widthMeters + (source.aimWidth * length)
  const endDepth = source.depthMeters + (source.aimDepth * length)
  const perpendicularWidth = -source.aimDepth
  const perpendicularDepth = source.aimWidth
  return clipPolygonToRect([
    { x: source.widthMeters, y: source.depthMeters },
    {
      x: endWidth + (perpendicularWidth * halfWidth),
      y: endDepth + (perpendicularDepth * halfWidth),
    },
    {
      x: endWidth - (perpendicularWidth * halfWidth),
      y: endDepth - (perpendicularDepth * halfWidth),
    },
  ], {
    left: 0,
    right: plan.roomWidthMeters,
    top: 0,
    bottom: plan.roomDepthMeters,
  })
}

function drawDiscussionCoverage(context, source, plan, toX, toY, scale) {
  context.save()
  context.setStrokeStyle('#18895b')
  context.setLineWidth(1)
  context.beginPath()
  if (plan.coverageShape === 'directional') {
    const polygon = buildDiscussionDirectionalPolygon(source, plan)
    if (polygon.length < 3) {
      context.restore()
      return
    }
    context.moveTo(toX(polygon[0].x), toY(polygon[0].y))
    polygon.slice(1).forEach((point) => context.lineTo(toX(point.x), toY(point.y)))
    context.closePath()
  } else {
    if (typeof context.rect === 'function' && typeof context.clip === 'function') {
      context.beginPath()
      context.rect(toX(0), toY(0), plan.roomWidthMeters * scale, plan.roomDepthMeters * scale)
      context.clip()
    }
    context.beginPath()
    context.arc(toX(source.widthMeters), toY(source.depthMeters), source.coverageRadiusMeters * scale, 0, Math.PI * 2)
  }
  context.setGlobalAlpha(0.42)
  context.stroke()
  context.restore()
}

function getDiscussionCoverageCounts(plan, points) {
  const source = plan.sources[0] || {}
  const summary = buildDiscussionCoverageSummary({
    seats: points.map((point, index) => ({ id: `sample-${index}`, ...point })),
    speakerPositions: plan.sources,
    coverageShape: plan.coverageShape,
    recommendedCoverageDeg: source.coverageDeg,
    coverageRadiusMeters: source.coverageRadiusMeters,
    speakerHeight: plan.elevation?.speakerHeightMeters,
  })
  return summary.seatCoverage.map((seat) => seat.coveringSourceCount)
}

function drawDiscussionCoverageGrid(context, plan, roomLeft, roomTop, roomWidth, roomHeight) {
  const gridRows = Math.min(
    DISCUSSION_MAX_GRID_ROWS,
    Math.max(DISCUSSION_MIN_GRID_ROWS, Math.round(DISCUSSION_GRID_COLUMNS * (plan.roomDepthMeters / plan.roomWidthMeters))),
  )
  const cellWidth = roomWidth / DISCUSSION_GRID_COLUMNS
  const cellHeight = roomHeight / gridRows
  const points = []
  for (let row = 0; row < gridRows; row += 1) {
    for (let column = 0; column < DISCUSSION_GRID_COLUMNS; column += 1) {
      const widthMeters = ((column + 0.5) / DISCUSSION_GRID_COLUMNS) * plan.roomWidthMeters
      const depthMeters = ((row + 0.5) / gridRows) * plan.roomDepthMeters
      points.push({ widthMeters, depthMeters })
    }
  }
  const coverageCounts = getDiscussionCoverageCounts(plan, points)
  context.save()
  context.beginPath()
  context.rect(roomLeft, roomTop, roomWidth, roomHeight)
  context.clip()
  points.forEach((point, index) => {
      const column = index % DISCUSSION_GRID_COLUMNS
      const row = Math.floor(index / DISCUSSION_GRID_COLUMNS)
      const coverageCount = Math.min(coverageCounts[index] || 0, 3)
      context.setFillStyle(DISCUSSION_COVERAGE_COLORS[coverageCount])
      context.fillRect(
        roomLeft + (column * cellWidth),
        roomTop + (row * cellHeight),
        Math.ceil(cellWidth) + 0.5,
        Math.ceil(cellHeight) + 0.5,
      )
  })
  context.restore()
}

function drawDiscussionPlan(context, plan, canvasWidth, canvasHeight) {
  const padding = DISCUSSION_PLAN_PADDING
  const availableWidth = canvasWidth - padding.left - padding.right
  const availableHeight = canvasHeight - padding.top - padding.bottom
  const scale = Math.min(
    availableWidth / plan.roomWidthMeters,
    availableHeight / plan.roomDepthMeters,
  )
  const roomWidth = plan.roomWidthMeters * scale
  const roomHeight = plan.roomDepthMeters * scale
  const roomLeft = Math.round((canvasWidth - roomWidth) / 2)
  const roomTop = padding.top
  const toX = (value) => roomLeft + (value / plan.roomWidthMeters) * roomWidth
  const toY = (value) => roomTop + (value / plan.roomDepthMeters) * roomHeight

  context.setFillStyle('#f5f8fc')
  context.fillRect(0, 0, canvasWidth, canvasHeight)
  drawDiscussionCoverageGrid(context, plan, roomLeft, roomTop, roomWidth, roomHeight)

  const centerX = toX(plan.roomWidthMeters / 2)
  const centerY = toY(plan.roomDepthMeters / 2)
  const listeningArea = plan.listeningAreaGeometry
  context.save()
  context.setStrokeStyle('rgba(71, 112, 177, 0.62)')
  context.setLineWidth(1)
  if (listeningArea.shape === 'round') {
    const radius = (listeningArea.diameterMeters / 2) * scale
    context.beginPath()
    context.arc(centerX, centerY, radius, 0, Math.PI * 2)
    context.stroke()
    context.setFillStyle('#476fa5')
    context.setFontSize(9)
    context.fillText('核心听音区', centerX - 24, centerY - radius + 12)
  } else {
    const areaWidth = listeningArea.widthMeters * scale
    const areaHeight = listeningArea.lengthMeters * scale
    const areaLeft = centerX - areaWidth / 2
    const areaTop = centerY - areaHeight / 2
    context.strokeRect(areaLeft, areaTop, areaWidth, areaHeight)
    context.setFillStyle('#476fa5')
    context.setFontSize(9)
    context.fillText('核心听音区', areaLeft + 5, areaTop + 12)
  }
  context.restore()

  plan.sources.forEach((source) => drawDiscussionCoverage(context, source, plan, toX, toY, scale))

  context.setStrokeStyle('#9b7d4d')
  context.setLineWidth(1.5)
  if (plan.tableGeometry.shape === 'round') {
    const radius = (plan.tableGeometry.diameterMeters / 2) * scale
    context.beginPath()
    context.arc(centerX, centerY, radius, 0, Math.PI * 2)
    context.stroke()
  } else {
    const tableWidth = plan.tableGeometry.widthMeters * scale
    const tableHeight = plan.tableGeometry.lengthMeters * scale
    context.strokeRect(centerX - tableWidth / 2, centerY - tableHeight / 2, tableWidth, tableHeight)
  }

  plan.spacingGuides.forEach((guide) => {
    const startX = toX(guide.start.widthMeters)
    const startY = toY(guide.start.depthMeters)
    const endX = toX(guide.end.widthMeters)
    const endY = toY(guide.end.depthMeters)
    const dx = endX - startX
    const dy = endY - startY
    const length = Math.max(Math.hypot(dx, dy), 1)
    const offsetX = (-dy / length) * 11
    const offsetY = (dx / length) * 11
    const x1 = startX + offsetX
    const y1 = startY + offsetY
    const x2 = endX + offsetX
    const y2 = endY + offsetY
    const labelX = (x1 + x2) / 2
    const labelY = (y1 + y2) / 2
    const labelWidth = Math.max(38, (guide.label.length * 6) + 8)
    const labelMinX = roomLeft + 4
    const labelMaxX = Math.max(labelMinX, roomLeft + roomWidth - labelWidth - 4)
    const labelLeft = Math.min(Math.max(labelX - (labelWidth / 2), labelMinX), labelMaxX)

    context.save()
    context.setStrokeStyle('rgba(28, 92, 154, 0.82)')
    context.setLineWidth(1)
    context.beginPath()
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
    context.moveTo(x1 - (offsetX * 0.35), y1 - (offsetY * 0.35))
    context.lineTo(x1 + (offsetX * 0.35), y1 + (offsetY * 0.35))
    context.moveTo(x2 - (offsetX * 0.35), y2 - (offsetY * 0.35))
    context.lineTo(x2 + (offsetX * 0.35), y2 + (offsetY * 0.35))
    context.stroke()
    context.setFillStyle('rgba(255, 255, 255, 0.9)')
    context.fillRect(labelLeft, labelY - 8, labelWidth, 14)
    context.setFillStyle('#1c5c9a')
    context.setFontSize(9)
    context.fillText(guide.label, labelLeft + 4, labelY + 2)
    context.restore()
  })

  plan.seats.forEach((seat) => {
    context.beginPath()
    context.setFillStyle(seat.covered ? '#52729d' : '#d35f5f')
    context.arc(toX(seat.widthMeters), toY(seat.depthMeters), 3.5, 0, Math.PI * 2)
    context.fill()
  })

  plan.sources.forEach((source) => {
    const x = toX(source.widthMeters)
    const y = toY(source.depthMeters)
    context.beginPath()
    context.setFillStyle('#13885a')
    context.arc(x, y, 8, 0, Math.PI * 2)
    context.fill()
    context.setStrokeStyle('#ffffff')
    context.setLineWidth(2)
    context.stroke()
    context.setFillStyle('#ffffff')
    context.setFontSize(8)
    context.fillText(source.marker || plan.sourceMarker, x - 2.5, y + 3)
    context.setFillStyle('rgba(255, 255, 255, 0.9)')
    context.fillRect(x + 6, y - 7, Math.max(20, (source.label.length * 6) + 6), 12)
    context.setFillStyle('#13704d')
    context.setFontSize(9)
    context.fillText(source.label, x + 9, y + 3)
  })

  drawRoomDimensions(context, plan, roomLeft, roomTop, roomWidth, roomHeight)
  context.setStrokeStyle('#31577f')
  context.setLineWidth(2)
  context.strokeRect(roomLeft, roomTop, roomWidth, roomHeight)
  context.setFillStyle('#31577f')
  context.setFontSize(12)
  context.fillText(`围桌${plan.installationShortLabel}布局`, roomLeft, roomTop - 12)
}

function getVenuePlanCanvasHeight(plan, canvasWidth) {
  const width = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : 320
  const padding = plan?.kind === 'discussion' ? DISCUSSION_PLAN_PADDING : REPORT_PLAN_PADDING
  const roomWidth = Number(plan?.roomWidthMeters)
  const roomDepth = Number(plan?.roomDepthMeters)
  const availableWidth = Math.max(width - padding.left - padding.right, 1)
  const aspectHeight = Number.isFinite(roomWidth) && roomWidth > 0 && Number.isFinite(roomDepth) && roomDepth > 0
    ? padding.top + padding.bottom + (availableWidth * roomDepth / roomWidth)
    : width * 0.76
  return Math.round(Math.min(560, Math.max(width * 0.76, aspectHeight)))
}


function drawVenuePlan(context, plan, canvasWidth, canvasHeight) {
  if (plan.kind === 'discussion') {
    drawDiscussionPlan(context, plan, canvasWidth, canvasHeight)
    return
  }
  const padding = REPORT_PLAN_PADDING
  const availableWidth = canvasWidth - padding.left - padding.right
  const availableHeight = canvasHeight - padding.top - padding.bottom
  const scale = Math.min(
    availableWidth / plan.roomWidthMeters,
    availableHeight / plan.roomDepthMeters,
  )
  const roomWidth = plan.roomWidthMeters * scale
  const roomHeight = plan.roomDepthMeters * scale
  const roomLeft = Math.round((canvasWidth - roomWidth) / 2)
  const roomTop = padding.top
  const cellWidth = roomWidth / plan.gridColumns
  const cellHeight = roomHeight / plan.gridRows
  
  context.setFillStyle('#f5f8fc')
  context.fillRect(0, 0, canvasWidth, canvasHeight)
  
  context.save()
  context.beginPath()
  context.rect(roomLeft, roomTop, roomWidth, roomHeight)
  context.clip()
  plan.cells.forEach((cell) => {
    const relativeLevelDb = cell.relativeLevelDbRaw !== undefined
      ? cell.relativeLevelDbRaw
      : cell.relativeLevelDb
    const heatmapColor = cell.isAudience ? getHeatmapColor(relativeLevelDb) : NON_AUDIENCE_COLOR
    context.setFillStyle(heatmapColor || NON_AUDIENCE_COLOR)
    context.fillRect(
      roomLeft + (cell.column * cellWidth),
      roomTop + (cell.row * cellHeight),
      Math.ceil(cellWidth) + 0.5,
      Math.ceil(cellHeight) + 0.5,
    )
  })
  context.restore()
  
  drawListeningZones(context, plan, roomLeft, roomTop, roomWidth, roomHeight)
  
  plan.sources.forEach((source) => {
    drawSourceCoverage(context, source, plan, roomLeft, roomTop, roomWidth, roomHeight)
  })
  
  plan.fillDistanceGroups.forEach((group, index) => {
    drawDistanceGuide(context, group, index, plan, roomLeft, roomTop, roomWidth, roomHeight, canvasWidth)
  })
  
  drawRoomDimensions(context, plan, roomLeft, roomTop, roomWidth, roomHeight)
  
  context.setStrokeStyle('#163b72')
  context.setLineWidth(2)
  context.strokeRect(roomLeft, roomTop, roomWidth, roomHeight)
  context.setFillStyle('rgba(19, 58, 110, 0.88)')
  context.fillRect(roomLeft, roomTop - 8, roomWidth, 8)
  
  context.setFontSize(13)
  context.setFillStyle('#24466f')
  context.fillText('主扩安装面', roomLeft, roomTop - 12)
  plan.sources.forEach((source) => {
    const x = roomLeft + (source.widthMeters / plan.roomWidthMeters) * roomWidth
    const y = roomTop + (source.depthMeters / plan.roomDepthMeters) * roomHeight
    const color = source.type === 'main' ? '#173d7a' : '#0f8a70'
    context.beginPath()
    context.setFillStyle(color)
    context.arc(x, y, source.type === 'main' ? 9 : 8, 0, Math.PI * 2)
    context.fill()
    context.setStrokeStyle('#ffffff')
    context.setLineWidth(2)
    context.stroke()
    context.setFillStyle('#ffffff')
    context.setFontSize(9)
    context.fillText(source.type === 'main' ? 'M' : 'F', x - 3, y + 3)
    context.setFillStyle(color)
    context.setFontSize(10)
    context.setFillStyle('rgba(255, 255, 255, 0.9)')
    context.fillRect(x + 7, y - 7, Math.max(18, (source.label.length * 6) + 6), 12)
    context.setFillStyle(color)
    context.fillText(source.label, x + 10, y + 3)
  })
  

}

module.exports = {
  buildDiscussionDirectionalPolygon,
  buildReportCoveragePolygon,
  DISCUSSION_COVERAGE_COLORS,
  DISCUSSION_GRID_COLUMNS,
  DISCUSSION_MAX_GRID_ROWS,
  DISCUSSION_MIN_GRID_ROWS,
  clipPolygonToRect,
  drawDiscussionCoverage,
  drawDiscussionCoverageGrid,
  getVenuePlanCanvasHeight,
  drawSourceCoverage,
  drawVenuePlan,
  getDiscussionCoverageCounts,
  getHeatmapColor,
  REPORT_HEATMAP_GRADIENT,
  REPORT_HEATMAP_STOPS,
  REPORT_HEATMAP_TICKS,
}

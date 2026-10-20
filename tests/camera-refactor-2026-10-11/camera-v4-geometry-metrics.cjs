'use strict'

function makeBounds() {
  return { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
}

function addPoint(bounds, point, padding = 0) {
  if (!Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) return
  const x = Number(point[0])
  const y = Number(point[1])
  bounds.left = Math.min(bounds.left, x - padding)
  bounds.top = Math.min(bounds.top, y - padding)
  bounds.right = Math.max(bounds.right, x + padding)
  bounds.bottom = Math.max(bounds.bottom, y + padding)
}

function addRect(bounds, rect) {
  if (!rect || !['left', 'top', 'right', 'bottom'].every((key) => Number.isFinite(Number(rect[key])))) return
  bounds.left = Math.min(bounds.left, Number(rect.left))
  bounds.top = Math.min(bounds.top, Number(rect.top))
  bounds.right = Math.max(bounds.right, Number(rect.right))
  bounds.bottom = Math.max(bounds.bottom, Number(rect.bottom))
}

function clipSegment(start, end, rect) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  let t0 = 0
  let t1 = 1
  const tests = [[-dx, start[0] - rect.left], [dx, rect.right - start[0]],
    [-dy, start[1] - rect.top], [dy, rect.bottom - start[1]]]
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null
      continue
    }
    const ratio = q / p
    if (p < 0) t0 = Math.max(t0, ratio)
    else t1 = Math.min(t1, ratio)
    if (t0 > t1) return null
  }
  return [
    [start[0] + t0 * dx, start[1] + t0 * dy],
    [start[0] + t1 * dx, start[1] + t1 * dy],
  ]
}

function finishBounds(bounds) {
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) return null
  const left = Number(bounds.left.toFixed(3))
  const top = Number(bounds.top.toFixed(3))
  const right = Number(bounds.right.toFixed(3))
  const bottom = Number(bounds.bottom.toFixed(3))
  return { left, top, right, bottom, width: Number((right - left).toFixed(3)), height: Number((bottom - top).toFixed(3)) }
}

function ratios(bounds, canvas, card) {
  if (!bounds) return null
  return {
    canvas: {
      width: Number((bounds.width / canvas.width).toFixed(4)),
      height: Number((bounds.height / canvas.height).toFixed(4)),
    },
    card: {
      width: Number((bounds.width / card.width).toFixed(4)),
      height: Number((bounds.height / card.height).toFixed(4)),
    },
  }
}

function calculateGeometryMetrics(renderInfo, canvasBox, cardBox) {
  const canvas = {
    width: Number(renderInfo?.css?.width || canvasBox?.width || 0),
    height: Number(renderInfo?.css?.height || canvasBox?.height || 0),
  }
  const card = { width: Number(cardBox?.width || 0), height: Number(cardBox?.height || 0) }
  const safeCanvas = canvas.width > 0 && canvas.height > 0 ? canvas : { width: 1, height: 1 }
  const safeCard = card.width > 0 && card.height > 0 ? card : { width: 1, height: 1 }
  const colors = ['#60a5fa', '#fb7185', '#fbbf24', '#7dd3fc']
  const colorBounds = Object.fromEntries(colors.map((color) => [color, makeBounds()]))
  const plot = makeBounds()
  const all = makeBounds()
  const plotRects = new Map()

  for (const path of renderInfo?.geometryPaths || []) {
    const color = String(path.color || '').replace(/\s+/g, '').toLowerCase()
    const bounds = colorBounds[color]
    const points = Array.isArray(path.points) ? path.points : []
    if (!bounds || points.length < 2) continue
    const rect = path.clipRect || { left: 0, top: 0, right: safeCanvas.width, bottom: safeCanvas.height }
    if (path.clipRect) {
      const rectKey = [rect.left, rect.top, rect.right, rect.bottom].join(':')
      plotRects.set(rectKey, rect)
    }
    const edgePoints = path.closed ? [...points, points[0]] : points
    const padding = Math.max(0, Number(path.width || 0) / 2)
    for (let index = 1; index < edgePoints.length; index += 1) {
      const clipped = clipSegment(edgePoints[index - 1], edgePoints[index], rect)
      if (clipped) {
        addPoint(bounds, clipped[0], padding)
        addPoint(bounds, clipped[1], padding)
        addPoint(all, clipped[0], padding)
        addPoint(all, clipped[1], padding)
      }
    }
  }

  for (const rect of plotRects.values()) addRect(plot, rect)
  for (const rect of renderInfo?.cameraRects || []) {
    const marker = { left: Number(rect.x), top: Number(rect.y),
      right: Number(rect.x) + Number(rect.width), bottom: Number(rect.y) + Number(rect.height) }
    addRect(colorBounds['#7dd3fc'], marker)
    addRect(all, marker)
  }

  const plotRect = finishBounds(plot)
  const geometryBounds = finishBounds(all)
  const byColor = Object.fromEntries(colors.map((color) => {
    const bounds = finishBounds(colorBounds[color])
    return [color, { bounds, ratios: ratios(bounds, safeCanvas, safeCard) }]
  }))
  return {
    canvas,
    card,
    plotRect,
    plotRatios: ratios(plotRect, safeCanvas, safeCard),
    geometryBounds,
    geometryRatios: ratios(geometryBounds, safeCanvas, safeCard),
    byColor,
  }
}

module.exports = { calculateGeometryMetrics }

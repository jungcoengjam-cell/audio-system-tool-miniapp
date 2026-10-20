const {
CANVAS_WIDTH,
CANVAS_HEIGHT,
defAnchor,
sideCanvasRange,
posPoint,
posKey,
fixtureSort,
renderMetrics,
shorten,
createStageGeometry,
  getSceneBounds,
pointOnRod,
  layoutFixturePoint,
} = require('./layout-model')

const GROUP_COLORS = ['#5856d6', '#007aff', '#00a878', '#d97706', '#c24182', '#4759c9']
const LAYOUT_GROUP_COLORS = ['#8a2bff', '#007aff', '#00b8ba']
const LAYOUT_GROUP_BANDS = ['#f2edff', '#eaf3ff', '#e8f8f7']
const CANVAS_THEMES = {
light: { background: '#f5f5f7', text: '#1d1d1f', secondary: '#6e6e73', stage: '#ffffff', border: '#88888d', rail: '#7a808a', accent: '#007aff', side: '#00b8ba', selected: '#111111', markerText: '#ffffff', markerOutline: '#ffffff', success: '#248a3d' },
dark: { background: '#000000', text: '#ffffff', secondary: '#c7c7cc', stage: '#1c1c1e', border: '#88888d', rail: '#8e8e93', accent: '#0a84ff', side: '#63d391', selected: '#ffffff', markerText: '#ffffff', markerOutline: '#ffffff', success: '#63d391' },
}
function getCanvasTheme(theme) {
return CANVAS_THEMES[theme === 'dark' ? 'dark' : 'light']
}
function getMarkerTextColor(hex) {
const value = String(hex || '').replace('#', '')
if (value.length !== 6) return '#ffffff'
const rgb = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
const luminance = rgb.map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
return (luminance + .05) / .05 >= 4.5 ? '#000000' : '#ffffff'
}
function getFixtureRadius(fixtureCount) {
return fixtureCount <= 30 ? 30 : fixtureCount <= 60 ? 25 : fixtureCount <= 100 ? 21 : fixtureCount <= 150 ? 18 : fixtureCount <= 300 ? 16 : 14
}
function getAddressFontSize(radius) {
return radius >= 28 ? 16 : radius >= 24 ? 14 : radius >= 20 ? 12 : radius >= 17 ? 10 : 8
}
function getRenderRadius(s, v) {
const count = s.fixtures.length
if (count > 30) return getFixtureRadius(count) / v
const points=s.fixtures.map(f=>s.positions[posKey(f)]).filter(Boolean).map(p=>posPoint(p,s.stage,s.frontAtBottom))
let minimum = Infinity
for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) minimum = Math.min(minimum, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y))
return Math.min(30, Math.max(10, minimum / 2 - 2)) / v
}
function getExportAddressLayout(snapshot) {
const { data, stage } = snapshot, width = data.canvasWidth || CANVAS_WIDTH, height = data.canvasHeight || CANVAS_HEIGHT
const r = getRenderRadius(snapshot, 1), limit = 2 * r + 4, map = new Map()
snapshot.fixtures.forEach((f) => { const p = snapshot.positions[posKey(f)]; if (!p) return; const k = `${p.zone}:${p.positionIndex}`
const b = map.get(k) || { definition: snapshot.definitions.find((d) => d.zone === p.zone && d.positionIndex === p.positionIndex), entries: [] }
b.entries.push({ fixture: f, point: posPoint(p, stage, snapshot.frontAtBottom) }); map.set(k, b) })
const bars = []
map.forEach((b) => { if (!b.definition) return; const side = b.definition.zone.startsWith('side-'), axis = (e) => side ? e.point.y : e.point.x
b.entries.sort((a, c) => axis(a) - axis(c) || fixtureSort(a.fixture, c.fixture)); b.gap = Infinity
for (let i = 1; i < b.entries.length; i += 1) b.gap = Math.min(b.gap, Math.max(0, axis(b.entries[i]) - axis(b.entries[i - 1])))
if (b.entries.length > 1 && b.gap < limit) bars.push(b) })
bars.sort((a, b) => a.definition.locationIndex - b.definition.locationIndex)
if (!bars.length) return { markers: new Map(), bars: [], canvasHeight: height, destWidth: width * 2, destHeight: height * 2 }
const groups = data.groupLegend || [], metrics = renderMetrics(width, height, stage, groups.length, data.schemeIndex === 2), rows = Math.ceil(Math.min(8, groups.length) / (groups.length > 4 ? 2 : 1))
const bottom = Math.max(stage.top + stage.height + 130, metrics.legendTop + (rows - 1) * metrics.legendStep + 30, metrics.noteY || 0, metrics.sideNoteY || 0, metrics.overflowY || 0)
const markers = new Map(), dense = bars.some((b) => b.gap < 1.5), axisStart = 30, axisEnd = width - 30; let y = bottom + (dense ? 64 : 32)
bars.forEach((b) => {
const mr = Math.max(.35, Math.min(4.5, (b.gap - 1) / 2)); b.entries.forEach(({ fixture }) => markers.set(posKey(fixture), mr))
const side = b.definition.zone.startsWith('side-'), range = sideCanvasRange(b.definition, stage, snapshot.frontAtBottom, (data.sidePairIndex || 0) + 1)
const origin = side ? range.startY : stage.left, span = side ? range.endY - range.startY : stage.width, segments = []
for (let start = 0; start < b.entries.length; start += 20) {
const part = b.entries.slice(start, start + 20), headerY = y
part.forEach((e, i) => { e.actualX = axisStart + Math.max(0, Math.min(1, ((side ? e.point.y : e.point.x) - origin) / (span || 1))) * (axisEnd - axisStart); e.slotX = axisStart + ((i + .5) / part.length) * (axisEnd - axisStart) })
segments.push({ headerY, entries: part }); y += 70
}
y += 4; b.segments = segments
})
const canvasHeight = Math.ceil(y + 16), scale = Math.min(2, data.isLandscape ? 2 : 1500 / width, 4096 / canvasHeight)
return { markers, bars, canvasHeight, destWidth: Math.floor(width * scale), destHeight: Math.floor(canvasHeight * scale) }
}
function drawDirectionArrow(ctx, startX, startY, endX, endY) {
const angle = Math.atan2(endY - startY, endX - startX)
ctx.beginPath()
ctx.moveTo(startX, startY)
ctx.lineTo(endX, endY)
ctx.lineTo(endX - (10 * Math.cos(angle - Math.PI / 6)), endY - (10 * Math.sin(angle - Math.PI / 6)))
ctx.moveTo(endX, endY)
ctx.lineTo(endX - (10 * Math.cos(angle + Math.PI / 6)), endY - (10 * Math.sin(angle + Math.PI / 6)))
ctx.stroke()
}

function renderLayout(ctx, snapshot, options = {}) {
const data = snapshot.data
const canvasWidth = data.canvasWidth || CANVAS_WIDTH
const baseCanvasHeight = data.canvasHeight || CANVAS_HEIGHT
const canvasHeight = options.exportMode ? (data.exportCanvasHeight || baseCanvasHeight) : baseCanvasHeight
const viewScale = snapshot.viewScale
const stage = snapshot.stage
const groups = data.groupLegend || []
const metrics = renderMetrics(canvasWidth, baseCanvasHeight, stage, groups.length, data.schemeIndex === 2)
const widthMeters = snapshot.widthMeters
const depthMeters = snapshot.depthMeters
const frontAtBottom = snapshot.frontAtBottom
const theme = snapshot.theme
const selectedKey = options.exportMode ? '' : snapshot.selectedKey
const fixtures = snapshot.fixtures
const fixtureCount = fixtures.length
const exportLayout = options.exportMode ? getExportAddressLayout(snapshot) : null
const hasDensityMode = exportLayout?.bars.some((bar) => bar.gap < 1.5)
const radius = getRenderRadius(snapshot, viewScale)
ctx.setFillStyle(theme.background)
ctx.fillRect(0, 0, canvasWidth, canvasHeight)
if (!data.isLandscape) {
ctx.setFillStyle(theme.text)
ctx.setFontSize(34)
ctx.fillText('灯具位置图', metrics.titleX, metrics.titleY)
}
ctx.setFillStyle(theme.secondary)
ctx.setFontSize(18)
ctx.fillText(`宽 ${widthMeters} m × 纵深 ${depthMeters} m · ${fixtureCount} 台 · ${data.addressRangeText}`, metrics.titleX, metrics.subtitleY)
ctx.setFillStyle(theme.stage)
ctx.setStrokeStyle(theme.border)
ctx.setLineWidth(2)
ctx.fillRect(stage.left, stage.top, stage.width, stage.height)
ctx.strokeRect(stage.left, stage.top, stage.width, stage.height)
const frontText = '舞台前沿'
const backText = '后场'
ctx.setFillStyle(theme.accent)
ctx.setFontSize(18)
ctx.fillText(frontAtBottom ? backText : frontText, stage.left + (stage.width / 2) - 18, stage.top - (frontAtBottom ? 14 : 90))
ctx.fillText(frontAtBottom ? frontText : backText, stage.left + (stage.width / 2) - 30, stage.top + stage.height + (frontAtBottom ? 100 : 30))
const rows = data.rowIndex + 1
const pairs = data.sidePairIndex + 1
ctx.setStrokeStyle(theme.rail)
ctx.setLineWidth(3)
ctx.setFillStyle(theme.accent)
ctx.setFontSize(16)
snapshot.definitions.forEach((d) => {
const anchor = defAnchor(d, stage, frontAtBottom, rows, pairs)
ctx.beginPath()
if (d.zone === 'top') {
ctx.moveTo(stage.left, anchor.y)
ctx.lineTo(stage.left + stage.width, anchor.y)
ctx.stroke()
ctx.setTextAlign('left')
ctx.fillText(`${d.positionIndex + 1}号杆`, stage.width < 200 ? stage.left - 160 : stage.left + 8, anchor.y - 8)
} else if (d.zone === 'front') {
ctx.setStrokeStyle(theme.accent)
ctx.moveTo(stage.left, anchor.y)
ctx.lineTo(stage.left + stage.width, anchor.y)
ctx.stroke()
ctx.setTextAlign('center')
ctx.setTextAlign('right')
ctx.fillText('面光位', stage.left - 8, anchor.y + 6)
drawDirectionArrow(ctx, stage.left + (stage.width / 2), anchor.y, stage.left + (stage.width / 2), frontAtBottom ? stage.top + stage.height - 18 : stage.top + 18)
} else {
const inwardX = d.zone === 'side-left' ? stage.left + 10 : stage.left + stage.width - 10
const sideRail = sideCanvasRange(d, stage, frontAtBottom, pairs)
ctx.setStrokeStyle(theme.side)
ctx.beginPath()
ctx.moveTo(anchor.x, sideRail.startY)
ctx.lineTo(anchor.x, sideRail.endY)
ctx.stroke()
drawDirectionArrow(ctx, anchor.x, anchor.y, inwardX, anchor.y)
ctx.setTextAlign(d.zone === 'side-left' ? 'right' : 'left')
ctx.fillText(`${d.zone === 'side-left' ? '左' : '右'}${d.positionIndex + 1}`, anchor.x + (d.zone === 'side-left' ? -36 : 36), anchor.y - 4)
}
ctx.setStrokeStyle(theme.rail)
})
ctx.setTextAlign('left')
fixtures.forEach((fixture) => {
const key = posKey(fixture)
const position = snapshot.positions[key]
if (!position) return
const point = posPoint(position, stage, frontAtBottom)
const { x, y } = point
const color = GROUP_COLORS[fixture.groupIndex % GROUP_COLORS.length]
const completed = snapshot.checkedKeys.has(snapshot.progKey(fixture))
const markerRadius = exportLayout?.markers.get(key)
if (markerRadius) {
ctx.setFillStyle(color)
ctx.beginPath()
ctx.arc(x, y, markerRadius, 0, Math.PI * 2)
ctx.fill()
return
}
ctx.beginPath()
ctx.setFillStyle(color)
ctx.arc(x, y, radius, 0, Math.PI * 2)
ctx.fill()
if (completed || key === selectedKey) {
ctx.setStrokeStyle(key === selectedKey ? theme.selected : theme.success)
ctx.setLineWidth(key === selectedKey ? 4 : 2)
ctx.beginPath()
ctx.arc(x, y, radius + (key === selectedKey ? 9 : 5), 0, Math.PI * 2)
ctx.stroke()
}
if (key === selectedKey && snapshot.dragPoint) {
ctx.setStrokeStyle(theme.accent)
ctx.setLineWidth(2)
ctx.setLineDash([7, 7], 0)
ctx.beginPath()
ctx.moveTo(x, y + radius + 10)
ctx.lineTo(snapshot.dragPoint.x, snapshot.dragPoint.y)
ctx.stroke()
ctx.setLineDash([], 0)
}
const showAddress = options.exportMode || (data.addressLabelsVisible && (data.addressLabelMode === 'all' || fixture.groupIndex === snapshot.selectedGroup || key === selectedKey))
if (showAddress) {
const fontSize = getAddressFontSize(radius * viewScale) / viewScale
ctx.setFillStyle(getMarkerTextColor(color))
ctx.setFontSize(fontSize)
ctx.setTextAlign('center')
ctx.fillText(fixture.addressText, x, y + (fontSize * 0.34))
ctx.setTextAlign('left')
}
})
const palettePreview = options.exportMode ? null : snapshot.palettePreview
if (palettePreview) {
const { fixture, targetX, targetY, badgeX, badgeY } = palettePreview
const color = GROUP_COLORS[fixture.groupIndex % GROUP_COLORS.length]
ctx.setStrokeStyle(theme.accent)
ctx.setLineWidth(2)
ctx.setLineDash([7, 7], 0)
ctx.beginPath()
ctx.moveTo(badgeX, badgeY + 32)
ctx.lineTo(targetX, targetY)
ctx.stroke()
ctx.setLineDash([], 0)
ctx.setStrokeStyle(theme.accent)
ctx.setLineWidth(3)
ctx.beginPath()
ctx.arc(targetX, targetY, 13 / viewScale, 0, Math.PI * 2)
ctx.stroke()
ctx.setFillStyle(color)
ctx.setStrokeStyle(theme.markerOutline)
ctx.setLineWidth(4)
ctx.beginPath()
ctx.arc(badgeX, badgeY, 32 / viewScale, 0, Math.PI * 2)
ctx.fill()
ctx.stroke()
ctx.setFillStyle(getMarkerTextColor(color))
ctx.setFontSize(16 / viewScale)
ctx.setTextAlign('center')
ctx.fillText(fixture.addressText, badgeX, badgeY + 6)
ctx.setTextAlign('left')
}
const visibleGroups = groups.slice(0, 8)
const columns = visibleGroups.length > 4 ? 2 : 1
const legendRows = Math.ceil(visibleGroups.length / columns)
const legendTop = metrics.legendTop
visibleGroups.forEach((group, index) => {
const column = columns === 2 && index >= legendRows ? 1 : 0
const row = columns === 2 ? index % legendRows : index
const x = metrics.titleX + 10 + (column * (data.isLandscape ? 430 : 320))
const y = legendTop + (row * metrics.legendStep)
ctx.setFillStyle(group.color)
ctx.fillRect(x, y - 12, 14, 14)
ctx.setFillStyle(theme.text)
ctx.setFontSize(15)
ctx.fillText(`${shorten(group.name, 17)} · ${group.count} 台`, x + 23, y)
})
if (groups.length > visibleGroups.length) {
ctx.setFillStyle(theme.secondary)
ctx.setFontSize(14)
ctx.fillText(`另有 ${groups.length - visibleGroups.length} 个灯具组，点选灯具可查看名称。`, metrics.titleX, metrics.overflowY)
}
if (!data.isLandscape) {
ctx.setFillStyle(theme.secondary)
ctx.setFontSize(14)
if (data.schemeIndex === 2) ctx.fillText('侧光同一位置的展开仅为地址辨识，不代表安装高度。', metrics.titleX, metrics.sideNoteY)
ctx.fillText('示意图用于位置与地址核对，不代表光束覆盖或照度模拟。', metrics.titleX, metrics.noteY)
}
if (exportLayout?.bars.length) {
ctx.setTextAlign('left')
ctx.setFillStyle(theme.secondary)
ctx.setFontSize(12)
ctx.fillText('标签辨址，刻度示真实位置（顶光/面光左→右，侧光上→下）。', metrics.titleX, exportLayout.bars[0].segments[0].headerY - (hasDensityMode ? 48 : 8))
if (hasDensityMode) ctx.fillText('总览示密度，地址见分段图。', metrics.titleX, exportLayout.bars[0].segments[0].headerY - 30)
ctx.setStrokeStyle(theme.border)
ctx.setLineWidth(1)
exportLayout.bars.forEach((bar) => bar.segments.forEach((segment, i) => {
const first = i * 20 + 1, last = first + segment.entries.length - 1, side = bar.definition.zone.startsWith('side-')
const axisY = segment.headerY + 35, labelY = axisY + 25
ctx.setFillStyle(theme.text)
ctx.setTextAlign('left')
ctx.setFontSize(14)
ctx.fillText(`${bar.definition.label} ${i + 1}/${bar.segments.length}段 ${first}-${last}台 ${side ? '上→下' : '左→右'}`, metrics.titleX, segment.headerY + 15)
ctx.beginPath()
ctx.moveTo(30, axisY)
ctx.lineTo(canvasWidth - 30, axisY)
segment.entries.forEach((entry) => {
ctx.moveTo(entry.actualX, axisY)
ctx.lineTo(entry.slotX, labelY - 5)
})
ctx.stroke()
ctx.setTextAlign('center')
ctx.setFontSize(12)
segment.entries.forEach((entry) => {
ctx.setFillStyle(GROUP_COLORS[entry.fixture.groupIndex % GROUP_COLORS.length])
ctx.fillRect(entry.actualX - 1, axisY - 5, 2, 10)
ctx.fillText(entry.fixture.addressText, entry.slotX, labelY)
})
}))
}
}

function stageScreenPoint(point, view = {}) {
  const scale = Number.isFinite(view.s) && view.s > 0 ? view.s : 1
  return { x: point.x * scale + (Number(view.x) || 0), y: point.y * scale + (Number(view.y) || 0) }
}

function estimateExportTextWidth(value, fontSize) {
  return Array.from(String(value || '')).reduce((width, character) => {
    if (/\s/.test(character)) return width + fontSize * .36
    if (/[\u2e80-\u9fff\uf900-\ufaff]/.test(character)) return width + fontSize
    if (/[.,:;!'|]/.test(character)) return width + fontSize * .38
    return width + fontSize * .62
  }, 0)
}

function measureCanvasTextWidth(ctx, value, fontSize) {
  const text = String(value || '')
  const size = Number(fontSize) > 0 ? Number(fontSize) : 16
  if (typeof ctx.setFontSize === 'function') {
    try { ctx.setFontSize(size) } catch (_) {}
  }
  if (typeof ctx.measureText === 'function') {
    try {
      const metrics = ctx.measureText(text)
      const width = Number(typeof metrics === 'number' ? metrics : metrics && metrics.width)
      if (Number.isFinite(width) && width > 0) return width
    } catch (_) {}
  }
  return Math.max(estimateExportTextWidth(text, size), Array.from(text).length * size)
}

function wrapExportText(value, maxWidth, fontSize) {
  const text = String(value || '')
  if (!text) return ['']
  const lines = []
  let line = ''
  Array.from(text).forEach((character) => {
    const candidate = line + character
    if (line && estimateExportTextWidth(candidate, fontSize) > maxWidth) {
      lines.push(line)
      line = character
    } else {
      line = candidate
    }
  })
  if (line) lines.push(line)
  return lines
}

function drawStageLine(ctx, view, x1, y1, x2, y2) {
  const start = stageScreenPoint({ x: x1, y: y1 }, view)
  const end = stageScreenPoint({ x: x2, y: y2 }, view)
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
}

function classifyFixtureVisualType(fixture = {}) {
  const label = [fixture.fixtureType, fixture.fixtureModel, fixture.model, fixture.groupName, fixture.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/(摇头|moving|beam|hybrid|wash|aura)/i.test(label)) return 'moving'
  if (/(成像|追光|聚光|profile|follow\s?spot|ellipsoidal)/i.test(label)) return 'profile'
  return 'soft'
}

function drawFixtureMiniature(ctx, point, type, color, size) {
  const unit = Math.max(5, Number(size) || 12)
  const centerX = point.x
  const centerY = point.y
  const lineWidth = Math.max(1, unit * .075)
  const baseWidth = unit * .38
  const baseHeight = Math.max(1.5, unit * .12)
  const headCenterY = centerY - unit * .27
  const headHeight = unit * .3
  const headWidth = type === 'soft' ? unit * .82 : unit * .68
  const baseTop = centerY + unit * .22

  ctx.setLineWidth(lineWidth)
  ctx.setStrokeStyle(color)
  ctx.setFillStyle('#ffffff')
  ctx.fillRect(centerX - baseWidth / 2, baseTop, baseWidth, baseHeight)
  ctx.strokeRect(centerX - baseWidth / 2, baseTop, baseWidth, baseHeight)

  ctx.beginPath()
  ctx.moveTo(centerX - unit * .28, headCenterY + headHeight * .22)
  ctx.lineTo(centerX - unit * .22, centerY + unit * .09)
  ctx.lineTo(centerX - unit * .13, baseTop)
  ctx.moveTo(centerX + unit * .28, headCenterY + headHeight * .22)
  ctx.lineTo(centerX + unit * .22, centerY + unit * .09)
  ctx.lineTo(centerX + unit * .13, baseTop)
  ctx.stroke()

  if (type === 'moving') {
    ctx.beginPath()
    ctx.moveTo(centerX - headWidth * .47, headCenterY - headHeight * .1)
    ctx.lineTo(centerX + headWidth * .39, headCenterY - headHeight * .35)
    ctx.lineTo(centerX + headWidth * .47, headCenterY + headHeight * .34)
    ctx.lineTo(centerX - headWidth * .37, headCenterY + headHeight * .2)
    ctx.closePath()
    ctx.setFillStyle('#ffffff')
    ctx.fill()
    ctx.setStrokeStyle(color)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(centerX + unit * .22, headCenterY - unit * .03, Math.max(1, unit * .09), 0, Math.PI * 2)
    ctx.setFillStyle(color)
    ctx.fill()
  } else {
    ctx.setFillStyle('#ffffff')
    ctx.fillRect(centerX - headWidth / 2, headCenterY - headHeight / 2, headWidth, headHeight)
    ctx.setStrokeStyle(color)
    ctx.strokeRect(centerX - headWidth / 2, headCenterY - headHeight / 2, headWidth, headHeight)
    if (type === 'profile') {
      ctx.beginPath()
      ctx.arc(centerX, headCenterY, Math.max(1, unit * .1), 0, Math.PI * 2)
      ctx.setFillStyle(color)
      ctx.fill()
    } else {
      const lensSize = Math.max(1, unit * .08)
      ;[-1, 0, 1].forEach((offset) => {
        ctx.setFillStyle(color)
        ctx.fillRect(centerX + offset * unit * .2 - lensSize / 2, headCenterY - lensSize / 2, lensSize, lensSize)
      })
    }
  }
}

function renderStageDiagram(ctx, snapshot, options = {}) {
  const geometry = snapshot.geometry
  if (!geometry?.stage) return
  const theme = snapshot.theme || CANVAS_THEMES.light
  const view = options.view || { s: 1, x: 0, y: 0 }
  const scale = Number.isFinite(view.s) && view.s > 0 ? view.s : 1
  const stage = geometry.stage
  const origin = stageScreenPoint({ x: stage.left, y: stage.top }, view)
  const stageWidth = stage.width * scale
  const stageHeight = stage.height * scale
  const pixelRatio = Number(options.pixelRatio) > 0 ? Number(options.pixelRatio) : 1
  const text = (value, x, y, size = 18, color = theme.text, align = 'left') => {
    ctx.setFillStyle(color)
    ctx.setTextAlign(align)
    // Canvas text is specified in device pixels and should remain legible while zooming.
    ctx.setFontSize(size * pixelRatio)
    ctx.fillText(String(value), x, y)
  }
  const annotations = []
  const viewportWidth = Number(options.backgroundWidth) || geometry.canvasWidth
  const viewportHeight = Number(options.backgroundHeight) || geometry.canvasHeight
  const annotationOffsets = (xOffsets, yOffsets) => {
    const offsets = []
    yOffsets.forEach((dy) => xOffsets.forEach((dx) => offsets.push({ dx, dy })))
    return offsets
  }
  const queueAnnotation = (value, x, y, size, color, align, priority, offsets = [{ dx: 0, dy: 0 }]) => {
    annotations.push({ value: String(value), x, y, size, color, align, priority, offsets, order: annotations.length })
  }
  const annotationBounds = (item, x, y) => {
    const fontSize = item.size * pixelRatio
    const width = measureCanvasTextWidth(ctx, item.value, fontSize)
    const left = item.align === 'right' ? x - width : item.align === 'center' ? x - width / 2 : x
    return { left, right: left + width, top: y - fontSize * .96, bottom: y + fontSize * .32 }
  }
  const drawAnnotations = () => {
    const reserved = []
    annotations.sort((a, b) => b.priority - a.priority || a.order - b.order).forEach((item) => {
      for (const offset of item.offsets) {
        const x = item.x + offset.dx
        const y = item.y + offset.dy
        const bounds = annotationBounds(item, x, y)
        const inset = 6 * pixelRatio
        if (bounds.left < inset || bounds.right > viewportWidth - inset
          || bounds.top < inset || bounds.bottom > viewportHeight - inset) continue
        const overlaps = reserved.some((other) => bounds.left < other.right + 4 * pixelRatio
          && bounds.right + 4 * pixelRatio > other.left
          && bounds.top < other.bottom + 4 * pixelRatio
          && bounds.bottom + 4 * pixelRatio > other.top)
        if (overlaps) continue
        text(item.value, x, y, item.size, item.color, item.align)
        reserved.push(bounds)
        break
      }
    })
  }
  if (options.background) {
    ctx.setFillStyle(options.background)
    ctx.fillRect(options.backgroundX || 0, options.backgroundY || 0, options.backgroundWidth || geometry.canvasWidth, options.backgroundHeight || geometry.canvasHeight)
  }
  if (geometry.pixelsPerMeter * scale >= 22) {
    const gridStep = geometry.pixelsPerMeter * .5
    const viewportWidth = Number(options.backgroundWidth) || geometry.canvasWidth
    const viewportHeight = Number(options.backgroundHeight) || geometry.canvasHeight
    const worldLeft = -((Number(view.x) || 0) / scale)
    const worldTop = -((Number(view.y) || 0) / scale)
    const worldRight = (viewportWidth - (Number(view.x) || 0)) / scale
    const worldBottom = (viewportHeight - (Number(view.y) || 0)) / scale
    const firstX = stage.left + Math.floor((worldLeft - stage.left) / gridStep) * gridStep
    const firstY = stage.top + Math.floor((worldTop - stage.top) / gridStep) * gridStep
    const gridViewport = options.gridViewport
    const canClipGrid = gridViewport
      && typeof ctx.save === 'function'
      && typeof ctx.restore === 'function'
      && typeof ctx.rect === 'function'
      && typeof ctx.clip === 'function'
    if (canClipGrid) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(gridViewport.x, gridViewport.y, gridViewport.width, gridViewport.height)
      ctx.clip()
    }
    ctx.setStrokeStyle(options.gridColor || (theme.background === '#000000' ? '#111214' : '#f3f5f8'))
    ctx.setLineWidth(Math.max(.5, scale))
    for (let x = firstX; x <= worldRight; x += gridStep) drawStageLine(ctx, view, x, worldTop, x, worldBottom)
    for (let y = firstY; y <= worldBottom; y += gridStep) drawStageLine(ctx, view, worldLeft, y, worldRight, y)
    if (canClipGrid) ctx.restore()
  }
  ctx.setFillStyle(theme.stage)
  ctx.setStrokeStyle(theme.border)
  ctx.setLineWidth(Math.max(1, 2 * scale))
  ctx.fillRect(origin.x, origin.y, stageWidth, stageHeight)
  ctx.strokeRect(origin.x, origin.y, stageWidth, stageHeight)

  if (geometry.pixelsPerMeter * scale >= 22) {
    ctx.setStrokeStyle(options.gridColor || (theme.background === '#000000' ? '#17171a' : '#eef0f4'))
    ctx.setLineWidth(Math.max(.5, scale))
    for (let distance = .5; distance < geometry.widthMeters; distance += .5) {
      const x = stage.left + distance * geometry.pixelsPerMeter
      if (x < stage.left + stage.width) drawStageLine(ctx, view, x, stage.top, x, stage.top + stage.height)
    }
    for (let distance = .5; distance < geometry.depthMeters; distance += .5) {
      const y = stage.top + distance * geometry.pixelsPerMeter
      if (y < stage.top + stage.height) drawStageLine(ctx, view, stage.left, y, stage.left + stage.width, y)
    }
  }

  const margin = 28
  ctx.setStrokeStyle(theme.accent)
  ctx.setLineWidth(Math.max(1, 1.5 * scale))
  const widthY = stage.top - margin
  drawStageLine(ctx, view, stage.left, widthY, stage.left + stage.width, widthY)
  drawStageLine(ctx, view, stage.left, widthY - 5, stage.left, widthY + 5)
  drawStageLine(ctx, view, stage.left + stage.width, widthY - 5, stage.left + stage.width, widthY + 5)
  const widthText = `${geometry.widthMeters} m`
  const widthFontSize = 16 * pixelRatio
  const widthTextWidth = measureCanvasTextWidth(ctx, widthText, widthFontSize)
  const annotationInset = 6 * pixelRatio
  const widthLabelPoint = stageScreenPoint({ x: 0, y: widthY - 7 }, view)
  const widthMinX = annotationInset + widthTextWidth / 2
  const widthMaxX = viewportWidth - annotationInset - widthTextWidth / 2
  const widthMinY = annotationInset + widthFontSize * .96
  const widthMaxY = viewportHeight - annotationInset - widthFontSize * .32
  const widthLabelX = widthMinX <= widthMaxX
    ? Math.max(widthMinX, Math.min(widthMaxX, origin.x + stageWidth / 2))
    : viewportWidth / 2
  const widthLabelY = widthMinY <= widthMaxY
    ? Math.max(widthMinY, Math.min(widthMaxY, widthLabelPoint.y))
    : Math.max(widthFontSize * .96, Math.min(viewportHeight - widthFontSize * .32, widthLabelPoint.y))
  queueAnnotation(widthText, widthLabelX, widthLabelY, 16, theme.text, 'center', 120,
    annotationOffsets([0, -24 * pixelRatio, 24 * pixelRatio], [0, 18 * pixelRatio, -18 * pixelRatio, 36 * pixelRatio, -36 * pixelRatio]))
  const depthX = stage.left - margin
  drawStageLine(ctx, view, depthX, stage.top, depthX, stage.top + stage.height)
  drawStageLine(ctx, view, depthX - 5, stage.top, depthX + 5, stage.top)
  drawStageLine(ctx, view, depthX - 5, stage.top + stage.height, depthX + 5, stage.top + stage.height)
  const depthLabel = stageScreenPoint({ x: depthX - 8, y: stage.top + stage.height / 2 }, view)
  const depthText = `${geometry.depthMeters} m`
  const canvasWidth = Number(options.backgroundWidth) || geometry.canvasWidth
  const depthLabelMinX = measureCanvasTextWidth(ctx, depthText, 16 * pixelRatio) + 8 * pixelRatio
  depthLabel.x = Math.min(canvasWidth - 12 * pixelRatio, Math.max(depthLabelMinX, depthLabel.x))
  queueAnnotation(depthText, depthLabel.x, depthLabel.y, 16, theme.text, 'right', 120)

  const apron = geometry.apronDirection
  ctx.setStrokeStyle(options.apronColor || theme.accent)
  ctx.setLineWidth(Math.max(3, 4 * scale))
  const apronLine = apron === 'bottom'
    ? { x1: stage.left, y1: stage.top + stage.height, x2: stage.left + stage.width, y2: stage.top + stage.height }
    : apron === 'top'
      ? { x1: stage.left, y1: stage.top, x2: stage.left + stage.width, y2: stage.top }
      : apron === 'left'
        ? { x1: stage.left, y1: stage.top, x2: stage.left, y2: stage.top + stage.height }
        : { x1: stage.left + stage.width, y1: stage.top, x2: stage.left + stage.width, y2: stage.top + stage.height }
  drawStageLine(ctx, view, apronLine.x1, apronLine.y1, apronLine.x2, apronLine.y2)
  const apronPoint = stageScreenPoint(geometry.apronLabel, view)
  const apronXShift = apron === 'left' ? -12 : apron === 'right' ? 12 : 0
  const apronYShift = apron === 'top' ? -8 : apron === 'bottom' ? 21 : 5
  queueAnnotation(
    geometry.apronLabel.text,
    apronPoint.x + apronXShift * scale,
    apronPoint.y + apronYShift * scale,
    17,
    theme.accent,
    'center',
    110,
    annotationOffsets([0, -34 * pixelRatio, 34 * pixelRatio, -68 * pixelRatio, 68 * pixelRatio], [0, -22 * pixelRatio, 22 * pixelRatio, -44 * pixelRatio, 44 * pixelRatio, 66 * pixelRatio]),
  )
  const frontRods = geometry.rods.filter((rod) => rod.type === 'front')
  frontRods.forEach((rod) => {
    const value = `${Number(rod.distance).toFixed(1)} m`
    ctx.setStrokeStyle(theme.secondary)
    ctx.setLineWidth(Math.max(1, scale))
    if (apron === 'bottom' || apron === 'top') {
      const x = stage.left + Math.min(24, stage.width * .08)
      const apronY = apron === 'bottom' ? stage.top + stage.height : stage.top
      drawStageLine(ctx, view, x, apronY, x, rod.y1)
      drawStageLine(ctx, view, x - 4, apronY, x + 4, apronY)
      drawStageLine(ctx, view, x - 4, rod.y1, x + 4, rod.y1)
      const label = stageScreenPoint({ x: x + 10, y: (apronY + rod.y1) / 2 }, view)
      queueAnnotation(value, label.x, label.y + 4 * scale, 13, theme.text, 'left', 100,
        annotationOffsets([0, 28 * pixelRatio, -28 * pixelRatio, 56 * pixelRatio, -56 * pixelRatio], [0, -20 * pixelRatio, 20 * pixelRatio, -40 * pixelRatio, 40 * pixelRatio]))
    } else {
      const y = stage.top + Math.min(24, stage.height * .08)
      const apronX = apron === 'right' ? stage.left + stage.width : stage.left
      drawStageLine(ctx, view, apronX, y, rod.x1, y)
      drawStageLine(ctx, view, apronX, y - 4, apronX, y + 4)
      drawStageLine(ctx, view, rod.x1, y - 4, rod.x1, y + 4)
      const label = stageScreenPoint({ x: (apronX + rod.x1) / 2, y: y + 15 }, view)
      queueAnnotation(value, label.x, label.y, 13, theme.text, 'center', 100,
        annotationOffsets([0, 32 * pixelRatio, -32 * pixelRatio, 64 * pixelRatio, -64 * pixelRatio], [0, -20 * pixelRatio, 20 * pixelRatio, -40 * pixelRatio, 40 * pixelRatio]))
    }
  })
  const frontDistance = frontRods.length ? Math.max(...frontRods.map((rod) => rod.distance)) : .3
  const curveDepth = frontDistance + .85
  const curve = apron === 'bottom'
    ? { start: { x: stage.left - 18, y: stage.top + stage.height + curveDepth * geometry.pixelsPerMeter }, control: { x: stage.left + stage.width / 2, y: stage.top + stage.height + (curveDepth + .42) * geometry.pixelsPerMeter }, end: { x: stage.left + stage.width + 18, y: stage.top + stage.height + curveDepth * geometry.pixelsPerMeter } }
    : apron === 'top'
      ? { start: { x: stage.left - 18, y: stage.top - curveDepth * geometry.pixelsPerMeter }, control: { x: stage.left + stage.width / 2, y: stage.top - (curveDepth + .42) * geometry.pixelsPerMeter }, end: { x: stage.left + stage.width + 18, y: stage.top - curveDepth * geometry.pixelsPerMeter } }
      : apron === 'right'
        ? { start: { x: stage.left + stage.width + curveDepth * geometry.pixelsPerMeter, y: stage.top - 18 }, control: { x: stage.left + stage.width + (curveDepth + .42) * geometry.pixelsPerMeter, y: stage.top + stage.height / 2 }, end: { x: stage.left + stage.width + curveDepth * geometry.pixelsPerMeter, y: stage.top + stage.height + 18 } }
        : { start: { x: stage.left - curveDepth * geometry.pixelsPerMeter, y: stage.top - 18 }, control: { x: stage.left - (curveDepth + .42) * geometry.pixelsPerMeter, y: stage.top + stage.height / 2 }, end: { x: stage.left - curveDepth * geometry.pixelsPerMeter, y: stage.top + stage.height + 18 } }
  const curveStart = stageScreenPoint(curve.start, view)
  const curveControl = stageScreenPoint(curve.control, view)
  const curveEnd = stageScreenPoint(curve.end, view)
  ctx.setStrokeStyle(theme.secondary)
  ctx.setLineWidth(Math.max(1, scale))
  ctx.setLineDash([6 * scale, 5 * scale], 0)
  ctx.beginPath()
  ctx.moveTo(curveStart.x, curveStart.y)
  ctx.quadraticCurveTo(curveControl.x, curveControl.y, curveEnd.x, curveEnd.y)
  ctx.stroke()
  ctx.setLineDash([], 0)
  const audience = stageScreenPoint(geometry.audience, view)
  queueAnnotation(geometry.audience.text, audience.x, audience.y, 16, theme.secondary, 'center', 80,
    annotationOffsets([0, -34 * pixelRatio, 34 * pixelRatio, -68 * pixelRatio, 68 * pixelRatio], [0, -24 * pixelRatio, 24 * pixelRatio, -48 * pixelRatio, 48 * pixelRatio, 72 * pixelRatio]))

  const fixtureById = new Map((snapshot.fixtures || []).map((fixture) => [String(fixture.id || fixture.stableId), fixture]))
  const positions = snapshot.layout?.positionsById || {}
  const placedByRod = new Map()
  Object.entries(positions).forEach(([fixtureId, position]) => {
    const fixture = fixtureById.get(String(fixtureId))
    if (!fixture || !position?.rodId) return
    const list = placedByRod.get(String(position.rodId)) || []
    list.push({ fixture, position })
    placedByRod.set(String(position.rodId), list)
  })
  const addressLabelLayout = (rod, point, lane = 0) => {
    const verticalRod = Math.abs(rod.x2 - rod.x1) < Math.abs(rod.y2 - rod.y1)
    const align = verticalRod ? (rod.side === 'left' ? 'right' : 'left') : 'center'
    const fontSize = (Number(options.addressFontSize) > 0 ? Number(options.addressFontSize) : 12) * pixelRatio
    const laneGap = fontSize + 2 * pixelRatio
    const x = point.x + (verticalRod ? (rod.side === 'left' ? -10 - lane * laneGap : 14 + lane * laneGap) * scale : 0)
    const y = point.y + (verticalRod ? 4 * scale : (24 * scale + lane * laneGap))
    return { x, y, align, fontSize: Number(options.addressFontSize) > 0 ? Number(options.addressFontSize) : 12, verticalRod, side: rod.side }
  }
  geometry.rods.forEach((rod) => {
    const front = rod.type === 'front'
    const legacySide = rod.type === 'legacy-side'
    const selectedRod = String(rod.id) === String(snapshot.selectedRodId || '')
    const rodColor = selectedRod ? theme.accent : front || legacySide ? (options.frontRodColor || '#8a2bff') : theme.rail
    ctx.setStrokeStyle(rodColor)
    ctx.setLineWidth(Math.max(3, (selectedRod ? 7 : 5) * scale))
    drawStageLine(ctx, view, rod.x1, rod.y1, rod.x2, rod.y2)
    const start = stageScreenPoint({ x: rod.x1, y: rod.y1 }, view)
    const end = stageScreenPoint({ x: rod.x2, y: rod.y2 }, view)
    ctx.setFillStyle(rodColor)
    ctx.setStrokeStyle(theme.stage)
    ctx.setLineWidth(Math.max(1, 1.5 * scale))
    ;[start, end].forEach((point) => {
      ctx.beginPath()
      ctx.arc(point.x, point.y, Math.max(3, 5 * scale), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })
    const labelPoint = stageScreenPoint({ x: (rod.x1 + rod.x2) / 2, y: (rod.y1 + rod.y2) / 2 }, view)
    if (!options.hideRodLabels) {
      const labelOffsets = selectedRod || front || legacySide
        ? annotationOffsets([0, -36 * pixelRatio, 36 * pixelRatio, -72 * pixelRatio, 72 * pixelRatio], [0, -22 * pixelRatio, 22 * pixelRatio, -44 * pixelRatio, 44 * pixelRatio])
        : scale >= 4
          ? annotationOffsets([0, -48 * pixelRatio, 48 * pixelRatio, -72 * pixelRatio, 72 * pixelRatio], [0])
        : [{ dx: 0, dy: 0 }]
      queueAnnotation(rod.label, labelPoint.x, labelPoint.y - 10 * scale, 14, rodColor, 'center',
        selectedRod ? 105 : front ? 90 : legacySide ? 60 : 95, labelOffsets)
    }
    const placed = (placedByRod.get(String(rod.id)) || []).slice().sort((a, b) => Number(a.position.t) - Number(b.position.t))
    const span = Math.hypot(end.x - start.x, end.y - start.y)
    const gap = placed.length > 1 ? span / (placed.length - 1) : span
    const labelEvery = options.forceAllAddresses
      ? 1
      : placed.length > 28 ? Math.max(1, Math.ceil(25 / Math.max(1, gap / 24))) : 1
    const labelLaneCount = options.forceAllAddresses
      ? Math.max(1, Math.floor(Number(options.addressLabelLaneCount) || 1))
      : 1
    const miniatureSize = Math.min(22 * scale, Math.max(5 * scale, gap * .78))
    placed.forEach(({ fixture, position }, index) => {
      const point = stageScreenPoint(layoutFixturePoint(geometry, rod, position), view)
      const color = LAYOUT_GROUP_COLORS[Math.max(0, Number(fixture.groupIndex) || 0) % LAYOUT_GROUP_COLORS.length]
      const highlighted = String(fixture.id || fixture.stableId) === String(snapshot.highlightFixtureId || '')
      const selected = String(fixture.id || fixture.stableId) === String(snapshot.selectedFixtureId || '')
      const dragging = String(fixture.id || fixture.stableId) === String(snapshot.draggingFixtureId || '')
      const size = miniatureSize + (highlighted || dragging ? 4 * scale : 0)
      drawFixtureMiniature(ctx, point, classifyFixtureVisualType(fixture), color, size)
      if (highlighted || selected || dragging) {
        ctx.setStrokeStyle(highlighted || dragging ? theme.accent : theme.text)
        ctx.setLineWidth(Math.max(2, 2.5 * scale))
        ctx.beginPath()
        ctx.arc(point.x, point.y, size * .7 + 4 * scale, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (index % labelEvery === 0 || highlighted || selected) {
        const lane = options.forceAllAddresses ? index % labelLaneCount : 0
        const label = addressLabelLayout(rod, point, lane)
        const offsets = label.verticalRod
          ? annotationOffsets([0, label.side === 'left' ? -14 * pixelRatio : 14 * pixelRatio, label.side === 'left' ? -28 * pixelRatio : 28 * pixelRatio, label.side === 'left' ? 14 * pixelRatio : -14 * pixelRatio], [0, -12 * pixelRatio, 12 * pixelRatio])
          : annotationOffsets([0], [0, -14 * pixelRatio, 14 * pixelRatio, -28 * pixelRatio, 28 * pixelRatio, -42 * pixelRatio, 42 * pixelRatio])
        queueAnnotation(fixture.addressText || '', label.x, label.y, label.fontSize, color, label.align,
          highlighted || selected || dragging ? 116 : 45, offsets)
      }
    })
  })
  if (snapshot.siteLabel) {
    const site = stageScreenPoint({ x: stage.left + 8, y: stage.top + 24 }, view)
    const siteLines = wrapExportText(snapshot.siteLabel, Math.max(40, stageWidth - 16 * scale), 13 * pixelRatio)
    siteLines.forEach((line, index) => queueAnnotation(line, site.x, site.y + index * 16 * scale, 13, theme.secondary, 'left', 10))
  }
  drawAnnotations()
  ctx.setTextAlign('left')
}

function groupExportFixtures(fixtures) {
  const groups = new Map()
  fixtures.forEach((fixture) => {
    const key = String(fixture.groupId || fixture.groupIndex || fixture.id || fixture.stableId)
    let model = String(fixture.fixtureModel || fixture.model || '').trim()
    const rawName = String(fixture.groupName || fixture.name || '未命名灯具组').trim()
    let name = model && rawName.toLocaleLowerCase().startsWith(model.toLocaleLowerCase())
      ? rawName.slice(model.length).replace(/^[\s·:：_-]+/, '').trim() || rawName
      : rawName
    if (model && rawName.toLocaleLowerCase() === model.toLocaleLowerCase()) {
      name = rawName
      model = ''
    }
    const entry = groups.get(key) || {
      id: key,
      name,
      model,
      mode: fixture.modeName || fixture.channelModeName || fixture.channelModeText || `${fixture.channelCount || 0} CH`,
      fixtures: [],
    }
    entry.fixtures.push(fixture)
    groups.set(key, entry)
  })
  return [...groups.values()].map((group) => ({ ...group, fixtures: group.fixtures.slice().sort(fixtureSort) }))
}

function buildLightingExportPages(snapshot = {}, options = {}) {
  const baseWidth = Math.max(720, Math.min(4096, Number(options.width) || 1120))
  const baseHeight = Math.max(900, Math.min(4096, Number(options.height) || 1160))
  const maxDimension = Math.max(baseWidth, baseHeight, Math.min(4096, Number(options.maxDimension) || 4096))
  const layout = snapshot.layout || {}
  const geometry = snapshot.geometry || createStageGeometry(layout, baseWidth - 72, baseHeight - 170)
  const fixtureById = new Map((snapshot.fixtures || []).map((fixture) => [String(fixture.id || fixture.stableId), fixture]))
  const positions = layout.positionsById || {}
  const countsByRod = new Map()
  Object.entries(positions).forEach(([fixtureId, position]) => {
    if (!fixtureById.has(String(fixtureId)) || !position || !position.rodId) return
    const count = countsByRod.get(String(position.rodId)) || 0
    countsByRod.set(String(position.rodId), count + 1)
  })
  let maxRodCount = 0
  let maxRodLengthMeters = 0
  ;(geometry.rods || []).forEach((rod) => {
    const count = countsByRod.get(String(rod.id)) || 0
    const rodLengthMeters = Math.hypot(rod.x2 - rod.x1, rod.y2 - rod.y1) / Math.max(.001, geometry.pixelsPerMeter)
    if (count > maxRodCount) {
      maxRodCount = count
      maxRodLengthMeters = rodLengthMeters
    } else if (count === maxRodCount) {
      maxRodLengthMeters = Math.max(maxRodLengthMeters, rodLengthMeters)
    }
  })
  const projectName = String(snapshot.contextLabel || '临时设置')
  const projectLines = wrapExportText(projectName, baseWidth - 96, 22)
  const diagramTop = 112 + Math.max(0, projectLines.length - 1) * 28
  const sceneBounds = getSceneBounds(geometry)
  const sceneWidthMeters = sceneBounds.width / Math.max(.001, geometry.pixelsPerMeter)
  const sceneHeightMeters = sceneBounds.height / Math.max(.001, geometry.pixelsPerMeter)
  const targetScale = maxRodCount > 1 && maxRodLengthMeters > 0
    ? ((maxRodCount - 1) * 24) / maxRodLengthMeters
    : 0
  const requestedDiagramWidth = Math.ceil(sceneWidthMeters * targetScale + 148)
  const requestedDiagramHeight = Math.ceil(sceneHeightMeters * targetScale + 148)
  const width = Math.min(maxDimension, Math.max(baseWidth, requestedDiagramWidth + 72))
  const height = Math.min(maxDimension, Math.max(baseHeight, diagramTop + requestedDiagramHeight + 48))
  const diagramHeight = height - diagramTop - 48
  const diagramWidth = width - 72
  const availableScale = Math.max(.001, Math.min(
    (diagramWidth - 148) / Math.max(.001, sceneWidthMeters),
    (diagramHeight - 148) / Math.max(.001, sceneHeightMeters),
  ))
  const addressSpacing = maxRodCount > 1 ? Math.max(1, (maxRodLengthMeters * availableScale) / (maxRodCount - 1)) : 32
  const addressFontSize = Math.max(8, Math.min(12, addressSpacing * .36))
  const addressLabelLaneCount = maxRodCount > 80 ? 5 : maxRodCount > 32 ? 3 : 1
  return [{
    number: 1,
    total: 1,
    width,
    height,
    title: '灯位图',
    projectLines,
    diagramTop,
    diagramWidth,
    diagramHeight,
    diagramX: 36,
    footerY: height - 24,
    addressFontSize,
    addressLabelLaneCount,
  }]
}

function renderLightingExportPage(ctx, snapshot, page = {}) {
  const width = page.width || 1120
  const height = page.height || 1160
  const diagramTop = Number(page.diagramTop) || 112
  const diagramX = Number(page.diagramX) || 36
  const diagramWidth = Number(page.diagramWidth) || width - 72
  const diagramHeight = Number(page.diagramHeight) || height - diagramTop - 48
  ctx.setFillStyle('#ffffff')
  ctx.fillRect(0, 0, width, height)
  ctx.setTextAlign('center')
  ctx.setFillStyle('#17243b')
  ctx.setFontSize(42)
  ctx.fillText('灯位图', width / 2, 54)
  ctx.setFillStyle('#55647b')
  ctx.setFontSize(22)
  ;(page.projectLines || [String(snapshot.contextLabel || '临时设置')]).forEach((line, index) => {
    ctx.fillText(line, width / 2, 94 + index * 28)
  })
  const geometry = createStageGeometry(snapshot.layout || {}, diagramWidth, diagramHeight)
  renderStageDiagram(ctx, {
    ...snapshot,
    geometry,
    theme: CANVAS_THEMES.light,
    siteLabel: '',
    selectedRodId: '',
    selectedFixtureId: '',
    highlightFixtureId: '',
    draggingFixtureId: '',
  }, {
    view: { s: 1, x: diagramX, y: diagramTop },
    backgroundWidth: width,
    backgroundHeight: height,
    gridViewport: { x: diagramX, y: diagramTop, width: diagramWidth, height: diagramHeight },
    frontRodColor: '#8a2bff',
    forceAllAddresses: true,
    addressFontSize: page.addressFontSize || 12,
    addressLabelLaneCount: page.addressLabelLaneCount || 1,
  })
  ctx.setFillStyle('#7b8492')
  ctx.setTextAlign('center')
  ctx.setFontSize(14)
  ctx.fillText('TuneBuddy', width / 2, Number(page.footerY) || height - 24)
  ctx.setTextAlign('left')
}

module.exports = {
  renderLayout,
  renderStageDiagram,
  classifyFixtureVisualType,
  drawFixtureMiniature,
  wrapExportText,
  estimateExportTextWidth,
  groupExportFixtures,
  buildLightingExportPages,
  renderLightingExportPage,
  getCanvasTheme,
  getMarkerTextColor,
  getFixtureRadius,
  getRenderRadius,
  getExportAddressLayout,
  GROUP_COLORS,
  LAYOUT_GROUP_COLORS,
  LAYOUT_GROUP_BANDS,
  CANVAS_THEMES,
}

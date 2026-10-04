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
} = require('./layout-model')

const GROUP_COLORS = ['#5856d6', '#007aff', '#00a878', '#d97706', '#c24182', '#4759c9', '#ef4444', '#0891b2']
const CANVAS_THEMES = {
light: { background: '#f5f5f7', text: '#1d1d1f', secondary: '#6e6e73', stage: '#ffffff', border: '#88888d', rail: '#7a808a', accent: '#007aff', side: '#00a878', selected: '#111111', markerText: '#ffffff', markerOutline: '#ffffff', success: '#248a3d' },
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

module.exports = { renderLayout, getCanvasTheme, getMarkerTextColor, getFixtureRadius, getRenderRadius, getExportAddressLayout, GROUP_COLORS, CANVAS_THEMES }

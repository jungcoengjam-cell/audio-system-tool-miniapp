const CANVAS_WIDTH = 700
const CANVAS_HEIGHT = 900
const VALID_ZONES = ['top', 'front', 'side-left', 'side-right']

function clamp(value, minimum = 0, maximum = 1) {
return Math.min(maximum, Math.max(minimum, value))
}
function recommendSidePairCount(depthMeters) {
return depthMeters <= 6 ? 1 : depthMeters <= 12 ? 2 : 3
}
function posDefs(rows, schemeId = 'top', pairs = 1) {
const definitions = []
if (schemeId !== 'top') definitions.push({ zone: 'front', positionIndex: 0, label: '面光位' })
for (let index = 0; index < rows; index += 1) {
definitions.push({ zone: 'top', positionIndex: index, label: `${index + 1} 号顶光杆` })
}
if (schemeId === 'full') {
for (let index = 0; index < pairs; index += 1) {
definitions.push({ zone: 'side-left', positionIndex: index, label: `左侧光 ${index + 1}` })
definitions.push({ zone: 'side-right', positionIndex: index, label: `右侧光 ${index + 1}` })
}
}
return definitions.map((definition, locationIndex) => ({ ...definition, locationIndex }))
}
function defKey(zone, positionIndex) {
return `${zone}:${positionIndex}`
}
function getDefinitionMap(definitions) {
return definitions.reduce((map, definition) => {
map[defKey(definition.zone, definition.positionIndex)] = definition
return map
}, Object.create(null))
}
function defY(d, rows, pairs) {
if (d.zone === 'top') return (d.positionIndex + 1) / (rows + 1)
if (d.zone === 'front') return 1
const rail = sideRange(d.positionIndex, pairs)
return (rail.start + rail.end) / 2
}
function sideRange(positionIndex, pairs) {
const count = Math.max(1, Number(pairs) || 1)
const index = Math.min(count - 1, Math.max(0, Number(positionIndex) || 0))
const span = 0.92 / count
const start = 0.04 + (index * span)
return { start, end: start + span }
}
function sideCanvasRange(d, stage, frontAtBottom, pairs) {
const rail = sideRange(d.positionIndex, pairs)
const start = frontAtBottom ? rail.start : 1 - rail.end
const end = frontAtBottom ? rail.end : 1 - rail.start
return {
startY: stage.top + (start * stage.height),
endY: stage.top + (end * stage.height),
}
}
function posPoint(position, stage, frontAtBottom) {
const visualY = frontAtBottom ? position.y : 1 - position.y
if (position.zone === 'front') {
return { x: stage.left + (clamp(position.x, 0.04, 0.96) * stage.width), y: frontAtBottom ? stage.top + stage.height + 42 : stage.top - 42 }
}
if (position.zone === 'side-left' || position.zone === 'side-right') {
return {
x: position.zone === 'side-left' ? stage.left - 42 : stage.left + stage.width + 42,
y: stage.top + (clamp(visualY, 0.03, 0.97) * stage.height),
}
}
return {
x: stage.left + (clamp(position.x, 0.02, 0.98) * stage.width),
y: stage.top + (clamp(visualY, 0.02, 0.98) * stage.height),
}
}
function posKey(fixture) {
return `${fixture.groupIndex}:${fixture.fixtureIndex}`
}
function fixtureSort(a, b) {
return (Number(a?.groupIndex) || 0) - (Number(b?.groupIndex) || 0)
|| (Number(a?.fixtureIndex) || 0) - (Number(b?.fixtureIndex) || 0)
|| String(a?.addressText || '').localeCompare(String(b?.addressText || ''))
}
function interleaveBatchFixtures(fixtures) {
const groups = []
;fixtures?.forEach((fixture) => {
const i = fixture.groupIndex
if (!groups[i]) groups[i] = []
groups[i].push(fixture)
})
const slots = []
groups.forEach((items, groupIndex) => items.sort(fixtureSort).forEach((fixture, index) => slots.push({ fixture, groupIndex, index, count: items.length })))
return slots.sort((a, b) => (
(a.index + 1) * (b.count + 1) - (b.index + 1) * (a.count + 1)
) || a.groupIndex - b.groupIndex || fixtureSort(a.fixture, b.fixture))
.map(({ fixture }) => fixture)
}
function balancedBars(groups, rows) {
const counts = Array.from({ length: rows }, () => groups.map(() => 0))
groups.forEach((group, groupIndex) => {
const total = Math.max(0, Number(group.fixtureCount) || 0)
for (let fixtureIndex = 0; fixtureIndex < total; fixtureIndex += 1) {
counts[fixtureIndex % rows][groupIndex] += 1
}
})
return counts
}
function normBars(savedCounts, groups, rows) {
if (!Array.isArray(savedCounts) || savedCounts.length !== rows) {
return balancedBars(groups, rows)
}
const counts = savedCounts.map((row) => groups.map((group, groupIndex) => (
Math.max(0, Math.floor(Number(row?.[groupIndex]) || 0))
)))
const valid = groups.every((group, groupIndex) => (
counts.reduce((sum, row) => sum + row[groupIndex], 0) === Number(group.fixtureCount)
))
return valid ? counts : balancedBars(groups, rows)
}
function posFromBars(fixtures, barCounts, groups, definitions, rows, pairs, legacyOrder) {
const fixturesByGroup = groups.map((group, groupIndex) => (
fixtures.filter((fixture) => fixture.groupIndex === groupIndex)
))
const offsets = groups.map(() => 0)
const bars = barCounts.map(() => [])
barCounts.forEach((counts, barIndex) => counts.forEach((count, groupIndex) => {
const start = offsets[groupIndex]
bars[barIndex].push(...fixturesByGroup[groupIndex].slice(start, start + count))
offsets[groupIndex] += count
}))
const positions = Object.create(null)
bars.forEach((bar, barIndex) => {
bar = legacyOrder ? bar : interleaveBatchFixtures(bar)
bar.forEach((fixture, fixtureIndex) => {
const d = definitions[barIndex]
const isSide = d.zone.startsWith('side-')
const baseY = defY(d, rows, pairs)
const sideRail = isSide ? sideRange(d.positionIndex, pairs) : null
const sideY = sideRail
? sideRail.start + ((fixtureIndex + 1) / (bar.length + 1)) * (sideRail.end - sideRail.start)
: baseY
positions[posKey(fixture)] = {
zone: d.zone,
positionIndex: d.positionIndex,
x: isSide ? (d.zone === 'side-left' ? 0 : 1) : (fixtureIndex + 1) / (bar.length + 1),
y: clamp(sideY, 0.03, 0.97),
}
})
})
return positions
}
function normPos(saved, rows, definitions, pairs) {
if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null
const zone = VALID_ZONES.includes(saved.zone) ? saved.zone : 'top'
const inferredIndex = zone === 'top'
? Math.min(rows - 1, Math.max(0, Math.round(clamp(saved.y) * (rows + 1)) - 1))
: 0
const positionIndex = Number.isInteger(saved.positionIndex) ? saved.positionIndex : inferredIndex
const definitionMap = getDefinitionMap(definitions)
let d = definitionMap[defKey(zone, positionIndex)]
if (!d && zone.startsWith('side-')) {
d = definitionMap[defKey(zone, Math.min(pairs - 1, Math.max(0, positionIndex)))]
}
if (!d) {
const topIndex = Math.min(rows - 1, Math.max(0, Math.round(clamp(saved.y) * (rows + 1)) - 1))
d = definitionMap[defKey('top', topIndex)] || definitions.find((item) => item.zone === 'top')
}
if (!d) return null
return {
zone: d.zone,
positionIndex: d.positionIndex,
x: d.zone === 'side-left' ? 0 : d.zone === 'side-right' ? 1 : clamp(saved.x),
y: d.zone === 'front' ? 1 : clamp(saved.y),
}
}
function defAnchor(d, stage, frontAtBottom, rows, pairs) {
return posPoint({
zone: d.zone,
positionIndex: d.positionIndex,
x: 0.5,
y: defY(d, rows, pairs),
}, stage, frontAtBottom)
}
function nearestPlacement(point, stage, frontAtBottom, definitions, rows, pairs) {
let nearest = null
definitions.forEach((d) => {
const anchor = defAnchor(d, stage, frontAtBottom, rows, pairs)
const isSide = d.zone === 'side-left' || d.zone === 'side-right'
const targetX = isSide ? anchor.x : clamp(point.x, stage.left + 8, stage.left + stage.width - 8)
const sideRail = isSide ? sideCanvasRange(d, stage, frontAtBottom, pairs) : null
const targetY = sideRail ? clamp(point.y, sideRail.startY, sideRail.endY) : anchor.y
const distance = Math.hypot(point.x - targetX, point.y - targetY)
if (!nearest || distance < nearest.distance) {
const visualY = clamp((targetY - stage.top) / stage.height)
nearest = {
distance,
targetX,
targetY,
position: {
zone: d.zone,
positionIndex: d.positionIndex,
x: d.zone === 'side-left' ? 0 : d.zone === 'side-right' ? 1 : clamp((targetX - stage.left) / stage.width, 0.04, 0.96),
y: d.zone === 'front' ? 1 : (frontAtBottom ? visualY : 1 - visualY),
},
}
}
})
return nearest
}
function restorePositions(fixtures, savedPositions, rows, definitions, pairs) {
const positions = Object.create(null)
fixtures.forEach((fixture) => {
const key = posKey(fixture)
const saved = normPos(savedPositions?.[key], rows, definitions, pairs)
if (saved) positions[key] = saved
})
return positions
}
function barsFromPositions(fixtures, positions, groups, definitions, rows, pairs) {
const counts = Array.from({ length: definitions.length }, () => groups.map(() => 0))
const definitionMap = getDefinitionMap(definitions)
fixtures.forEach((fixture) => {
const position = positions[posKey(fixture)]
if (!position) return
const normalized = normPos(position, rows, definitions, pairs)
const definition = normalized && definitionMap[defKey(normalized.zone, normalized.positionIndex)]
if (definition) counts[definition.locationIndex][fixture.groupIndex] += 1
})
return counts
}
function shorten(value, limit = 15) {
const text = String(value || '')
return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}
function createBarRows(barCounts, groups, definitions) {
return barCounts.map((counts, barIndex) => ({
barIndex,
label: definitions[barIndex].label,
groups: groups.map((group, groupIndex) => ({
groupIndex,
name: group.name,
total: Number(group.fixtureCount),
countText: String(counts[groupIndex]),
})),
}))
}
function barStatus(barCounts, groups) {
const parts = groups.map((group, groupIndex) => {
const assigned = barCounts.reduce((sum, row) => sum + row[groupIndex], 0)
return { text: `${shorten(group.name, 8)} ${assigned}/${group.fixtureCount}`, valid: assigned === Number(group.fixtureCount) }
})
return { valid: parts.every((item) => item.valid), text: parts.map((item) => item.text).join(' · ') }
}
function mergePositions(fixtures, automaticPositions, savedPositions, rows, definitions, pairs) {
const positions = Object.create(null)
fixtures.forEach((fixture) => {
const key = posKey(fixture)
const saved = normPos(savedPositions?.[key], rows, definitions, pairs)
positions[key] = saved || automaticPositions[key]
})
return positions
}
function parsePositive(value, fallback) {
const number = Number(value)
return Number.isFinite(number) && number > 0 ? number : fallback
}
function stageRect(widthMeters, depthMeters, canvasWidth = CANVAS_WIDTH, canvasHeight = CANVAS_HEIGHT) {
const landscape = canvasWidth > canvasHeight
const maximum = landscape
? { left: 90, top: 160, width: canvasWidth - 180, height: Math.min(330, canvasHeight - 270) }
: { left: 130, top: 230, width: 440, height: 360 }
const ratio = widthMeters / depthMeters
const maximumRatio = maximum.width / maximum.height
const width = ratio >= maximumRatio ? maximum.width : maximum.height * ratio
const height = ratio >= maximumRatio ? maximum.width / ratio : maximum.height
return {
left: maximum.left + ((maximum.width - width) / 2),
top: maximum.top + ((maximum.height - height) / 2),
width,
height,
}
}
function renderMetrics(canvasWidth, canvasHeight, stage, groupCount, showSideNote) {
const landscape = canvasWidth > canvasHeight
const n = Math.min(8, Math.max(0, Number(groupCount) || 0))
const rows = Math.ceil(n / (n > 4 ? 2 : 1))
const legendStep = landscape ? 20 : 28
const legendTop = stage.top + stage.height + 132
let y = legendTop + (Math.max(0, rows - 1) * legendStep) + 28
const overflowY = groupCount > 8 ? (landscape ? canvasHeight - 7 : y) : null
if (overflowY) y += 28
const sideNoteY = !landscape && showSideNote ? y : null
return { titleX: landscape ? 20 : 42, titleY: landscape ? 30 : 52, subtitleY: landscape ? 50 : 82, legendTop, legendStep, overflowY, sideNoteY, noteY: landscape ? null : y + (sideNoteY ? 28 : 0) }
}

const APRON_DIRECTIONS = ['bottom', 'right', 'top', 'left']

function normalizeApronDirection(value) {
  return APRON_DIRECTIONS.includes(value) ? value : 'bottom'
}

function normalizeLayoutRods(rods = []) {
  if (!Array.isArray(rods)) return []
  return rods.map((rod, index) => ({
    ...(rod && typeof rod === 'object' ? rod : {}),
    id: String(rod?.id || `rod-${index + 1}`),
    distance: Number(rod?.distance),
  })).filter((rod) => Number.isFinite(rod.distance) && rod.distance > 0)
}

function createDefaultStageLayout(stageWidthText = '12', stageDepthText = '8', createId = null) {
  const width = parsePositive(stageWidthText, 12)
  const depth = parsePositive(stageDepthText, 8)
  const id = typeof createId === 'function' ? createId : (kind, index) => `${kind}-${index + 1}`
  return {
    stageWidthText: String(stageWidthText || width),
    stageDepthText: String(stageDepthText || depth),
    apronDirection: 'bottom',
    internalRods: [
      { id: id('internal', 0), distance: Number((depth * .8).toFixed(1)) },
      { id: id('internal', 1), distance: Number((depth * .5).toFixed(1)) },
      { id: id('internal', 2), distance: Number((depth * .2).toFixed(1)) },
    ],
    frontRods: [{ id: id('front', 0), distance: Number(Math.max(1, depth * .35).toFixed(1)) }],
    positionsById: {},
  }
}

function createStageGeometry(layout = {}, canvasWidth = CANVAS_WIDTH, canvasHeight = CANVAS_HEIGHT) {
  const widthMeters = parsePositive(layout.stageWidthText, 12)
  const depthMeters = parsePositive(layout.stageDepthText, 8)
  const apronDirection = normalizeApronDirection(layout.apronDirection)
  const horizontalApron = apronDirection === 'top' || apronDirection === 'bottom'
  const internalRods = normalizeLayoutRods(layout.internalRods)
  const frontRods = normalizeLayoutRods(layout.frontRods)
  const legacySideRods = normalizeLayoutRods(layout.legacySideRods)
  const frontExtent = frontRods.length
    ? Math.max(...frontRods.map((rod) => rod.distance)) + 1.35
    : 1.4
  const sideExtent = legacySideRods.length ? Math.max(...legacySideRods.map((rod) => rod.distance)) + .25 : 0
  const outerWidth = widthMeters + sideExtent * 2 + (horizontalApron ? 0 : frontExtent)
  const outerHeight = depthMeters + (horizontalApron ? frontExtent : 0)
  const margin = Math.max(44, Math.min(74, Math.round(Math.min(canvasWidth, canvasHeight) * .075)))
  const availableWidth = Math.max(100, canvasWidth - margin * 2)
  const availableHeight = Math.max(100, canvasHeight - margin * 2)
  const scale = Math.max(.001, Math.min(availableWidth / outerWidth, availableHeight / outerHeight))
  const extraX = Math.max(0, (availableWidth - outerWidth * scale) / 2)
  const extraY = Math.max(0, (availableHeight - outerHeight * scale) / 2)
  const stageLeft = margin + extraX + sideExtent * scale + (apronDirection === 'left' ? frontExtent * scale : 0)
  const stageTop = margin + extraY + (apronDirection === 'top' ? frontExtent * scale : 0)
  const stage = { left: stageLeft, top: stageTop, width: widthMeters * scale, height: depthMeters * scale }
  const apron = apronDirection === 'bottom'
    ? { x1: stage.left, y1: stage.top + stage.height, x2: stage.left + stage.width, y2: stage.top + stage.height }
    : apronDirection === 'top'
      ? { x1: stage.left, y1: stage.top, x2: stage.left + stage.width, y2: stage.top }
      : apronDirection === 'left'
        ? { x1: stage.left, y1: stage.top, x2: stage.left, y2: stage.top + stage.height }
        : { x1: stage.left + stage.width, y1: stage.top, x2: stage.left + stage.width, y2: stage.top + stage.height }
  const rods = []
  internalRods.forEach((rod, index) => {
    const distance = Math.min(rod.distance, apronDirection === 'top' || apronDirection === 'bottom' ? depthMeters : widthMeters)
    const line = horizontalApron
      ? { x1: stage.left, x2: stage.left + stage.width, y1: apronDirection === 'bottom' ? stage.top + stage.height - distance * scale : stage.top + distance * scale, y2: apronDirection === 'bottom' ? stage.top + stage.height - distance * scale : stage.top + distance * scale }
      : { x1: apronDirection === 'left' ? stage.left + distance * scale : stage.left + stage.width - distance * scale, x2: apronDirection === 'left' ? stage.left + distance * scale : stage.left + stage.width - distance * scale, y1: stage.top, y2: stage.top + stage.height }
    rods.push({ ...line, id: rod.id, type: 'internal', index, distance: rod.distance, label: `灯杆${index + 1}` })
  })
  frontRods.forEach((rod, index) => {
    const line = horizontalApron
      ? { x1: stage.left, x2: stage.left + stage.width, y1: apronDirection === 'bottom' ? stage.top + stage.height + rod.distance * scale : stage.top - rod.distance * scale, y2: apronDirection === 'bottom' ? stage.top + stage.height + rod.distance * scale : stage.top - rod.distance * scale }
      : { x1: apronDirection === 'right' ? stage.left + stage.width + rod.distance * scale : stage.left - rod.distance * scale, x2: apronDirection === 'right' ? stage.left + stage.width + rod.distance * scale : stage.left - rod.distance * scale, y1: stage.top, y2: stage.top + stage.height }
    rods.push({ ...line, id: rod.id, type: 'front', index, distance: rod.distance, label: `面光杆${index + 1}` })
  })
  legacySideRods.forEach((rod, index) => {
    const x = rod.side === 'right' ? stage.left + stage.width + rod.distance * scale : stage.left - rod.distance * scale
    const startT = clamp(Number(rod.startT), 0, 1)
    const endT = clamp(Number(rod.endT), startT, 1)
    rods.push({
      x1: x,
      x2: x,
      y1: stage.top + startT * stage.height,
      y2: stage.top + endT * stage.height,
      id: rod.id,
      type: 'legacy-side',
      index,
      side: rod.side,
      positionIndex: rod.positionIndex,
      distance: rod.distance,
      startT,
      endT,
      label: `${rod.side === 'left' ? '左' : '右'}侧光${Number(rod.positionIndex) + 1}`,
    })
  })
  const audienceOffset = (frontRods.length ? Math.max(...frontRods.map((rod) => rod.distance)) : .3) + 1.6
  const audience = horizontalApron
    ? { x: stage.left + stage.width / 2, y: apronDirection === 'bottom' ? stage.top + stage.height + audienceOffset * scale : stage.top - audienceOffset * scale }
    : { x: apronDirection === 'right' ? stage.left + stage.width + audienceOffset * scale : stage.left - audienceOffset * scale, y: stage.top + stage.height / 2 }
  const labelNames = { top: '台口方向 · 上', right: '台口方向 · 右', bottom: '台口方向 · 下', left: '台口方向 · 左' }
  const apronLabel = horizontalApron
    ? { x: stage.left + stage.width / 2, y: apronDirection === 'bottom' ? stage.top + stage.height + 20 : stage.top - 12 }
    : { x: apronDirection === 'right' ? stage.left + stage.width + 20 : stage.left - 20, y: stage.top + stage.height / 2 }
  return {
    canvasWidth,
    canvasHeight,
    widthMeters,
    depthMeters,
    pixelsPerMeter: scale,
    apronDirection,
    apronLabel: { ...apronLabel, text: '台口' },
    audience: { ...audience, text: '观众区' },
    directionText: labelNames[apronDirection],
    stage,
    rods,
    bounds: { left: 0, top: 0, width: canvasWidth, height: canvasHeight },
  }
}

function pointOnRod(rod, t) {
  const rawProgress = clamp(Number(t) || 0, 0, 1)
  const interval = Number(rod?.endT) - Number(rod?.startT)
  const progress = rod?.type === 'legacy-side' && interval > 0
    ? clamp((rawProgress - Number(rod.startT)) / interval, 0, 1)
    : rawProgress
  return { x: rod.x1 + (rod.x2 - rod.x1) * progress, y: rod.y1 + (rod.y2 - rod.y1) * progress }
}

function layoutFixturePoint(geometry, rod, position = {}) {
  if (position.legacyPoint && geometry?.stage) {
    return {
      x: geometry.stage.left + Number(position.legacyPoint.x) * geometry.stage.width,
      y: geometry.stage.top + Number(position.legacyPoint.y) * geometry.stage.height,
    }
  }
  return pointOnRod(rod, position.t)
}

function projectPointToRod(rod, point) {
  const dx = rod.x2 - rod.x1
  const dy = rod.y2 - rod.y1
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return 0
  const progress = clamp(((point.x - rod.x1) * dx + (point.y - rod.y1) * dy) / lengthSquared, 0, 1)
  if (rod?.type === 'legacy-side') return Number(rod.startT) + progress * (Number(rod.endT) - Number(rod.startT))
  return progress
}

function transformViewPoint(point, view = {}) {
  const scale = Number.isFinite(view.s) && view.s > 0 ? view.s : 1
  return { x: point.x * scale + (Number(view.x) || 0), y: point.y * scale + (Number(view.y) || 0) }
}

function transformViewPointInverse(point, view = {}) {
  const scale = Number.isFinite(view.s) && view.s > 0 ? view.s : 1
  return { x: (point.x - (Number(view.x) || 0)) / scale, y: (point.y - (Number(view.y) || 0)) / scale }
}

function zoomViewAt(view = {}, nextScale, anchor = { x: 0, y: 0 }, minScale = .55, maxScale = 4) {
  const oldScale = Number.isFinite(view.s) && view.s > 0 ? view.s : 1
  const scale = clamp(Number(nextScale) || oldScale, minScale, maxScale)
  const logical = transformViewPointInverse(anchor, { ...view, s: oldScale })
  return { s: scale, x: anchor.x - logical.x * scale, y: anchor.y - logical.y * scale }
}

function getSceneBounds(geometry) {
  if (!geometry || !Array.isArray(geometry.rods)) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  const xs = [geometry.stage.left, geometry.stage.left + geometry.stage.width]
  const ys = [geometry.stage.top, geometry.stage.top + geometry.stage.height]
  geometry.rods.forEach((rod) => { xs.push(rod.x1, rod.x2); ys.push(rod.y1, rod.y2) })
  const pad = 52
  const left = Math.min(...xs) - pad
  const top = Math.min(...ys) - pad
  const right = Math.max(...xs) + pad
  const bottom = Math.max(...ys) + pad
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

module.exports = {
CANVAS_WIDTH,
CANVAS_HEIGHT,
clamp,
recommendSidePairCount,
posDefs,
defY,
sideRange,
sideCanvasRange,
posPoint,
posKey,
fixtureSort,
interleaveBatchFixtures,
balancedBars,
normBars,
posFromBars,
defAnchor,
nearestPlacement,
restorePositions,
barsFromPositions,
createBarRows,
barStatus,
mergePositions,
parsePositive,
stageRect,
renderMetrics,
shorten,
APRON_DIRECTIONS,
normalizeApronDirection,
normalizeLayoutRods,
createDefaultStageLayout,
createStageGeometry,
pointOnRod,
layoutFixturePoint,
projectPointToRod,
transformViewPoint,
transformViewPointInverse,
zoomViewAt,
getSceneBounds,
}

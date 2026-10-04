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
}

const assert = require('assert/strict')
const { calculateVenueEstimate } = require('../utils/venue')
const { calculateDiscussionEstimate } = require('../utils/venue-discussion')
const { buildDiscussionPlan } = require('../utils/venue-discussion-plan')
const { buildVenuePlan } = require('../utils/venue-plan')
const { buildDiscussionCoverageSummary } = require('../utils/venue-discussion')
const {
  buildDiscussionDirectionalPolygon,
  DISCUSSION_GRID_COLUMNS,
  DISCUSSION_MAX_GRID_ROWS,
  DISCUSSION_MIN_GRID_ROWS,
  getDiscussionCoverageCounts,
  getVenuePlanCanvasHeight,
  drawVenuePlan,
  getHeatmapColor,
  REPORT_HEATMAP_STOPS,
} = require('../pages/venue/plan-renderer')

assert.equal(getHeatmapColor(-100), REPORT_HEATMAP_STOPS[0].color)
assert.equal(getHeatmapColor(100), REPORT_HEATMAP_STOPS[REPORT_HEATMAP_STOPS.length - 1].color)
for (const invalid of [null, undefined, '', false, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(getHeatmapColor(invalid), null)
assert.notEqual(getHeatmapColor(-2), getHeatmapColor(5))

function createRecorder() {
  const commands = []
  const context = {}
  const record = (name) => (...args) => commands.push([name, ...args])
  ;['setFillStyle', 'setStrokeStyle', 'setLineWidth', 'setFontSize', 'setGlobalAlpha', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'save', 'restore', 'rect', 'clip'].forEach((name) => { context[name] = record(name) })
  return { context, commands }
}

const rawPlan = {
  kind: 'report', roomWidthMeters: 4, roomDepthMeters: 2, gridColumns: 5, gridRows: 1,
  firstListeningDistanceMeters: 0, lastListeningDistanceMeters: 2, listeningWidthMeters: 4, listeningSideMarginMeters: 0,
  speakerCenterHeightMeters: 2, sources: [], fillDistanceGroups: [],
  cells: [
    { column: 0, row: 0, isAudience: true, relativeLevelDbRaw: -2.3, relativeLevelDb: -2 },
    { column: 1, row: 0, isAudience: true, relativeLevelDb: 5 },
    { column: 2, row: 0, isAudience: true, relativeLevelDbRaw: Number.NaN, relativeLevelDb: 0 },
    { column: 3, row: 0, isAudience: true, relativeLevelDbRaw: undefined, relativeLevelDb: 5 },
    { column: 4, row: 0, isAudience: true, relativeLevelDbRaw: null, relativeLevelDb: 0 },
  ],
}
const rawRecorder = createRecorder()
drawVenuePlan(rawRecorder.context, rawPlan, 320, 240)
const renderedCellColors = rawRecorder.commands
  .filter((command) => command[0] === 'setFillStyle')
  .map((command) => command[1])
  .slice(1, 6)
assert.equal(renderedCellColors[0], getHeatmapColor(-2.3))
assert.equal(renderedCellColors[1], getHeatmapColor(5))
assert.equal(renderedCellColors[2], '#e3e7ed')
assert.equal(renderedCellColors[3], getHeatmapColor(5))
assert.equal(renderedCellColors[4], '#e3e7ed')
const constantRecorder = createRecorder()
drawVenuePlan(constantRecorder.context, {
  ...rawPlan,
  cells: rawPlan.cells.map((cell) => ({ ...cell, relativeLevelDbRaw: 0, relativeLevelDb: 0 })),
}, 320, 240)
const constantCellColors = constantRecorder.commands
  .filter((command) => command[0] === 'setFillStyle')
  .map((command) => command[1])
  .slice(1, 6)
assert.equal(new Set(constantCellColors).size, 1)
assert.equal(getVenuePlanCanvasHeight({ kind: 'report', roomWidthMeters: 8, roomDepthMeters: 12 }, 320), 403)
assert.equal(getVenuePlanCanvasHeight({ kind: 'discussion', roomWidthMeters: 8, roomDepthMeters: 12 }, 320), 445)
assert.equal(getVenuePlanCanvasHeight({ kind: 'report', roomWidthMeters: 1, roomDepthMeters: 100 }, 1000), 560)

const report = buildVenuePlan(calculateVenueEstimate({
  lengthMeters: '12', widthMeters: '8', heightMeters: '4',
  standardClassKey: 'conference', gradeKey: 'II',
  firstListeningDistanceMeters: '3', lastListeningDistanceMeters: '11',
  listeningWidthMeters: '7', layout: 'short',
}))
const audienceColors = new Set(report.cells.filter((cell) => cell.isAudience).map((cell) => getHeatmapColor(cell.relativeLevelDbRaw)))
assert(audienceColors.size > 1, 'default report audience is still rendered as one heat color')

function pointInPolygon(point, polygon) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y))
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y) / (previousPoint.y - currentPoint.y)) + currentPoint.x
    if (intersects) inside = !inside
  }
  return inside
}

for (const [roomWidthMeters, roomDepthMeters] of [[8, 6], [17, 17], [12, 8]]) {
  const plan = {
    kind: 'discussion',
    roomWidthMeters,
    roomDepthMeters,
    coverageShape: 'directional',
    sources: [{ id: 'source-1', widthMeters: roomWidthMeters / 2, depthMeters: 1, aimWidth: 0, aimDepth: 1, coverageDeg: 120, coverageLengthMeters: 3 }],
    elevation: { speakerHeightMeters: 3 },
  }
  const rows = Math.min(DISCUSSION_MAX_GRID_ROWS, Math.max(DISCUSSION_MIN_GRID_ROWS, Math.round(DISCUSSION_GRID_COLUMNS * roomDepthMeters / roomWidthMeters)))
  const polygon = buildDiscussionDirectionalPolygon(plan.sources[0], plan)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < DISCUSSION_GRID_COLUMNS; column += 1) {
      const widthMeters = ((column + 0.5) / DISCUSSION_GRID_COLUMNS) * roomWidthMeters
      const depthMeters = ((row + 0.5) / rows) * roomDepthMeters
      const expected = buildDiscussionCoverageSummary({
        seats: [{ id: 'sample', widthMeters, depthMeters }],
        speakerPositions: plan.sources,
        coverageShape: plan.coverageShape,
        recommendedCoverageDeg: 120,
        speakerHeight: 3,
      }).seatCoverage[0].coveringSourceCount
      assert.equal(pointInPolygon({ x: widthMeters, y: depthMeters }, polygon) ? 1 : 0, expected)
      assert.equal(getDiscussionCoverageCounts(plan, [{ widthMeters, depthMeters }])[0], expected)
    }
  }
}

const samplePlan = {
  kind: 'discussion', roomWidthMeters: 17, roomDepthMeters: 17, coverageShape: 'directional',
  sources: [{ id: 'source-1', widthMeters: 8.5, depthMeters: 1, aimWidth: 0, aimDepth: 1, coverageDeg: 120, coverageLengthMeters: 3 }],
  elevation: { speakerHeightMeters: 3 },
}
const samplePoints = Array.from({ length: 1536 }, (_, index) => ({
  widthMeters: ((index % 32) + 0.5) * samplePlan.roomWidthMeters / 32,
  depthMeters: (Math.floor(index / 32) + 0.5) * samplePlan.roomDepthMeters / 48,
}))
assert.equal(getDiscussionCoverageCounts(samplePlan, samplePoints).length, 1536)

const discussionInput = (overrides = {}) => ({
  lengthMeters: 10, widthMeters: 8, heightMeters: 3, tableShape: 'round', tableDiameterMeters: 3,
  participantCount: 12, audioMode: 'voiceLift', installationCondition: 'flat', standardClassKey: 'conference', gradeKey: 'II', ...overrides,
})
function getGridPoints(plan, columns = 32, rows = 32) {
  return Array.from({ length: columns * rows }, (_, index) => ({
    widthMeters: ((index % columns) + 0.5) * plan.roomWidthMeters / columns,
    depthMeters: (Math.floor(index / columns) + 0.5) * plan.roomDepthMeters / rows,
  }))
}
for (const input of [
  discussionInput({ lengthMeters: 8, widthMeters: 6, heightMeters: 3, participantCount: 12, installationCondition: 'blocked' }),
  discussionInput({ lengthMeters: 17, widthMeters: 17, heightMeters: 3, tableDiameterMeters: 8, participantCount: 32, installationCondition: 'blocked' }),
  discussionInput({ lengthMeters: 12, widthMeters: 8, heightMeters: 3, tableDiameterMeters: 4, participantCount: 16, installationCondition: 'blocked' }),
]) {
  const { calculateDiscussionEstimate } = require('../utils/venue-discussion')
  const { buildDiscussionPlan } = require('../utils/venue-discussion-plan')
  const result = calculateDiscussionEstimate(input)
  assert.equal(result.error, undefined)
  const plan = buildDiscussionPlan(result)
  const originalPlan = JSON.parse(JSON.stringify(plan))
  const points = getGridPoints(plan)
  const coreCounts = getDiscussionCoverageCounts(plan, points)
  const polygonCounts = points.map((point) => plan.sources.reduce((count, source) => (
    count + (pointInPolygon({ x: point.widthMeters, y: point.depthMeters }, buildDiscussionDirectionalPolygon(source, plan)) ? 1 : 0)
  ), 0))
  assert.deepEqual(polygonCounts, coreCounts)
  const beforeSeats = JSON.parse(JSON.stringify(plan.seats))
  const counts = getDiscussionCoverageCounts(plan, plan.seats.map((seat) => ({ widthMeters: seat.widthMeters, depthMeters: seat.depthMeters })))
  assert.deepEqual(counts, plan.seats.map((seat) => seat.coveringSourceCount))
  assert.deepEqual(plan.seats, beforeSeats)
  assert.deepEqual(plan, originalPlan)
}

const rectangularResult = calculateDiscussionEstimate(discussionInput({
  tableShape: 'rectangular', tableLengthMeters: 4.8, tableWidthMeters: 1.8, participantCount: 12, installationCondition: 'flat',
}))
const rectangularPlan = buildDiscussionPlan(rectangularResult)
assert.deepEqual(
  getDiscussionCoverageCounts(rectangularPlan, rectangularPlan.seats.map((seat) => ({ widthMeters: seat.widthMeters, depthMeters: seat.depthMeters }))),
  rectangularPlan.seats.map((seat) => seat.coveringSourceCount),
)

console.log('venue heatmap renderer regression PASS')

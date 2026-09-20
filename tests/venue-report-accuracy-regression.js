const assert = require('assert/strict')

const { calculateVenueEstimate } = require('../utils/venue')
const {
  buildVenuePlan,
  getDirectLevelAtPoint,
} = require('../utils/venue-plan')
const {
  buildDiscussionDirectionalPolygon,
  buildReportCoveragePolygon,
  clipPolygonToRect,
  drawDiscussionCoverage,
  drawSourceCoverage,
} = require('../pages/venue/plan-renderer')

function report(input = {}) {
  return calculateVenueEstimate({
    lengthMeters: '12',
    widthMeters: '8',
    heightMeters: '4',
    firstListeningDistanceMeters: '3',
    lastListeningDistanceMeters: '11',
    listeningWidthMeters: '7',
    layout: 'short',
    standardClassKey: 'conference',
    gradeKey: 'II',
    ...input,
  })
}

function pointInPolygon(point, polygon) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y))
      && (point.x < ((previousPoint.x - currentPoint.x)
        * (point.y - currentPoint.y) / (previousPoint.y - currentPoint.y)) + currentPoint.x)
    if (intersects) inside = !inside
  }
  return inside
}

function createCanvasRecorder() {
  const commands = []
  const context = {}
  ;[
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'fill', 'stroke',
    'rect', 'clip', 'arc', 'setFillStyle', 'setStrokeStyle', 'setLineWidth', 'setGlobalAlpha',
  ].forEach((name) => {
    context[name] = (...args) => commands.push([name, ...args])
  })
  return { context, commands }
}

function independentPlanLevel(point, source, speakerHeightMeters) {
  const forwardDistance = point.depthMeters - source.depthMeters
  const lateralDistance = point.widthMeters - source.widthMeters
  const verticalDelta = speakerHeightMeters - 1.2
  const pathDistance = Math.hypot(forwardDistance, lateralDistance, verticalDelta)
  return (source.levelAtOneMeterRaw ?? source.levelAtOneMeter)
    - 20 * Math.log10(Math.max(pathDistance, Number.EPSILON))
}

function assertIndependentGridCell(heightMeters) {
  const result = report({ heightMeters: String(heightMeters) })
  const plan = buildVenuePlan(result)
  const cell = plan.cells.find((item) => item.isAudience)
  assert(cell, `层高 ${heightMeters} m 应有听音网格点`)
  const point = {
    widthMeters: ((cell.column + 0.5) / plan.gridColumns) * plan.roomWidthMeters,
    depthMeters: ((cell.row + 0.5) / plan.gridRows) * plan.roomDepthMeters,
  }
  const energy = plan.sources.reduce((sum, source) => sum + (10 ** (
    independentPlanLevel(point, source, result.speakerCenterHeightRaw) / 10
  )), 0)
  const expectedRelativeLevel = 10 * Math.log10(energy) - result.standardMaxSpl
  assert(Math.abs(cell.relativeLevelDbRaw - expectedRelativeLevel) < 1e-12,
    `层高 ${heightMeters} m 的 plan 网格应使用 raw 高度和完整 3D 声程`)
}

const defaultInput = {
  lengthMeters: '12',
  widthMeters: '8',
  heightMeters: '4',
  firstListeningDistanceMeters: '3',
  lastListeningDistanceMeters: '11',
  listeningWidthMeters: '7',
  layout: 'short',
  standardClassKey: 'conference',
  gradeKey: 'II',
}
const inputSnapshot = { ...defaultInput }
const defaultResult = report(defaultInput)
assert.deepEqual(defaultInput, inputSnapshot, '输入对象被计算过程修改')
assert.equal(Array.isArray(defaultResult.reviewWarnings), true)
assert.equal(defaultResult.recommendedAimDownDeg, 15)
assert(Math.abs(defaultResult.recommendedAimDownDegRaw - 15.0428977346) < 1e-9)

const defaultPlan = buildVenuePlan(defaultResult)
assert(defaultPlan.sources.every((source) => Number.isFinite(source.aimDownDeg)))
assert(defaultPlan.sources.every((source) => Number.isFinite(source.levelAtOneMeterRaw)))
assert.equal(defaultPlan.sources[0].aimDownDeg, defaultResult.recommendedAimDownDegRaw)
assert.equal(defaultPlan.statistics.statusKey, 'review')
assert.equal(defaultPlan.statistics.statusText, '声学覆盖待核验')
assert.equal(typeof defaultPlan.statistics.distanceTrendPass, 'boolean')
assert.equal(defaultPlan.modelBasis, 'distance-only')
assert.equal(defaultPlan.coverageVerification, 'unverified')
assert.equal(defaultPlan.sources[0].coverageDeg, 100)
assert.equal(defaultResult.layoutSelection.candidateCount, 6)
assert.equal(defaultResult.layoutSelection.selectedId, 'ratio-1-axis')
assert(defaultPlan.sources.every((source) => (
  source.widthMeters >= 0
  && source.widthMeters <= defaultPlan.roomWidthMeters
  && source.depthMeters >= 0
  && source.depthMeters <= defaultPlan.roomDepthMeters
)))
assert.equal(new Set(defaultPlan.sources.map((source) => `${source.widthMeters}:${source.depthMeters}`)).size, defaultPlan.sources.length)
assert(defaultPlan.cells.every((cell) => Number.isFinite(cell.relativeLevelDbRaw)))
assertIndependentGridCell(2.61)
assertIndependentGridCell(0.31)

const wideShallow = report({
  lengthMeters: '14',
  widthMeters: '10',
  heightMeters: '3.5',
  firstListeningDistanceMeters: '2',
  lastListeningDistanceMeters: '9',
  listeningWidthMeters: '12',
  layout: 'long',
})
assert.equal(wideShallow.minimumHorizontalCoverage, 98.3)
assert.equal(wideShallow.recommendedHorizontalCoverage, 120)
assert.equal(wideShallow.speakerRecommendation.hasMainMatch, true)
assert.equal(wideShallow.speakerRecommendation.packages[0].main.horizontalCoverageDeg, 100)
assert.equal(wideShallow.speakerRecommendation.packages[0].main.verticalCoverageDeg, 90)

const overHorizontalLimit = report({
  lengthMeters: '2.5',
  widthMeters: '15',
  heightMeters: '3',
  firstListeningDistanceMeters: '1',
  lastListeningDistanceMeters: '2',
  listeningWidthMeters: '15',
  layout: 'long',
})
assert.match(overHorizontalLimit.error, /超过自动布置上限 120°/)
assert.match(overHorizontalLimit.error, /134\.34°/)
assert.equal(Array.isArray(overHorizontalLimit.reviewWarnings), true)

const threeDimensional = report({
  lengthMeters: '8',
  widthMeters: '6',
  heightMeters: '4',
  firstListeningDistanceMeters: '2',
  lastListeningDistanceMeters: '5',
  listeningWidthMeters: '4',
})
const nearDistance = Math.hypot(2, 1.3)
const farDistance = Math.hypot(5, 1, 1.3)
const expectedVariation = 20 * Math.log10(farDistance / nearDistance)
assert(Math.abs(threeDimensional.nearestDistanceRaw - nearDistance) < 1e-12)
assert(Math.abs(threeDimensional.farthestDistanceRaw - farDistance) < 1e-12)
assert(Math.abs(threeDimensional.directVariationDbRaw - expectedVariation) < 1e-12)
assert.equal(threeDimensional.fillCount, 0)

const negativeForwardLevel = getDirectLevelAtPoint({
  point: { widthMeters: 2, depthMeters: 0 },
  source: {
    widthMeters: 2,
    depthMeters: 1,
    levelAtOneMeter: 100,
    coverageDeg: 120,
    verticalCoverageDeg: 90,
    aimDownDeg: 20,
  },
  speakerCenterHeightMeters: 2.5,
})
const expectedNegativeForwardLevel = 100 - (20 * Math.log10(Math.hypot(-1, 1.3)))
assert(Math.abs(negativeForwardLevel - expectedNegativeForwardLevel) < 1e-12)
const sameDistanceDifferentDirection = getDirectLevelAtPoint({
  point: { widthMeters: 3, depthMeters: 0 },
  source: {
    widthMeters: 2,
    depthMeters: 0,
    levelAtOneMeter: 100,
    coverageDeg: 40,
    verticalCoverageDeg: 30,
    aimYawDeg: 0,
    aimDownDeg: 0,
  },
  speakerCenterHeightMeters: 2.5,
})
assert(Math.abs(sameDistanceDifferentDirection - expectedNegativeForwardLevel) < 1e-12)
const oneMeterLevel = getDirectLevelAtPoint({
  point: { widthMeters: 0, depthMeters: 1 },
  source: { widthMeters: 0, depthMeters: 0, levelAtOneMeter: 100 },
  speakerCenterHeightMeters: 1.2,
})
const twoMeterLevel = getDirectLevelAtPoint({
  point: { widthMeters: 0, depthMeters: 2 },
  source: { widthMeters: 0, depthMeters: 0, levelAtOneMeter: 100 },
  speakerCenterHeightMeters: 1.2,
})
assert(Math.abs(oneMeterLevel - twoMeterLevel - 6.0205999133) < 1e-10)

const lowCeiling = report({ heightMeters: '0.31' })
assert(lowCeiling.recommendedAimDownDeg < 0, '低于听音耳高时应保留向上指向的负角度')

const fourFillGroups = report({
  lengthMeters: '12',
  widthMeters: '4',
  heightMeters: '4',
  firstListeningDistanceMeters: '0.5',
  lastListeningDistanceMeters: '11',
  listeningWidthMeters: '1',
  layout: 'short',
  gradeKey: 'I',
})
assert.equal(fourFillGroups.fillCount, 4)
const fillDistances = fourFillGroups.speakerRecommendation.fillPlacementGroups
  .map((group) => group.mainToFillDistanceMetersRaw)
assert(fillDistances.every((distance, index) => index === 0 || distance > fillDistances[index - 1]))

const overlappingFillGeometry = report({
  lengthMeters: '2',
  widthMeters: '2',
  heightMeters: '1.5',
  firstListeningDistanceMeters: '0.01',
  lastListeningDistanceMeters: '0.6',
  listeningWidthMeters: '0.01',
})
assert.match(overlappingFillGeometry.error, /补声几何条件不足/)

const fixed60Plan = { roomWidthMeters: 8, roomDepthMeters: 12 }
const fixed60Source = {
  widthMeters: 2.25,
  depthMeters: 0,
  coverageDeg: 60,
  coverageEndDepthMeters: 11,
  verticalCoverageDeg: 90,
  aimYawDeg: 0,
  aimDownDeg: 0,
  type: 'main',
}
const clippedReportPolygon = buildReportCoveragePolygon(fixed60Source, fixed60Plan)
assert(clippedReportPolygon.length >= 4)
assert(clippedReportPolygon.every((point) => (
  point.x >= 0 && point.x <= 8 && point.y >= 0 && point.y <= 12
)))
assert(pointInPolygon({ x: 1, y: 3 }, clippedReportPolygon), '真实 60° 扇区内的点被裁切绘图漏掉')
assert(!pointInPolygon({ x: 0.1, y: 1 }, clippedReportPolygon), '水平或垂直角包络外的点不应被绘入')
const reportCanvas = createCanvasRecorder()
drawSourceCoverage(reportCanvas.context, fixed60Source, fixed60Plan, 0, 0, 80, 120)
const reportMoveTo = reportCanvas.commands.find((command) => command[0] === 'moveTo')
assert.equal(reportMoveTo[0], 'moveTo')
assert(Math.abs(reportMoveTo[1] - (clippedReportPolygon[0].x * 10)) < 1e-9)
assert(Math.abs(reportMoveTo[2] - (clippedReportPolygon[0].y * 10)) < 1e-9, '报告覆盖绘制未使用实际裁切多边形')

const clippedDirectionalPolygon = buildDiscussionDirectionalPolygon({
  widthMeters: 1,
  depthMeters: 1,
  aimWidth: 1,
  aimDepth: 0,
  coverageLengthMeters: 12,
  coverageDeg: 90,
}, { roomWidthMeters: 8, roomDepthMeters: 6 })
assert(clippedDirectionalPolygon.length >= 3)
assert(clippedDirectionalPolygon.every((point) => (
  point.x >= 0 && point.x <= 8 && point.y >= 0 && point.y <= 6
)))

const directionalCanvas = createCanvasRecorder()
const directionalSource = {
  widthMeters: -1,
  depthMeters: 1,
  aimWidth: 1,
  aimDepth: 0,
  coverageLengthMeters: 12,
  coverageDeg: 90,
}
const directionalPlan = { coverageShape: 'directional', roomWidthMeters: 8, roomDepthMeters: 6 }
const directionalExpectedPolygon = buildDiscussionDirectionalPolygon(directionalSource, directionalPlan)
drawDiscussionCoverage(
  directionalCanvas.context,
  directionalSource,
  directionalPlan,
  (value) => value * 10,
  (value) => value * 10,
  10,
)
const directionalMoveTo = directionalCanvas.commands.find((command) => command[0] === 'moveTo')
assert.deepEqual(directionalMoveTo, [
  'moveTo', directionalExpectedPolygon[0].x * 10, directionalExpectedPolygon[0].y * 10,
], '定向覆盖绘制未从裁切多边形首点开始')

const roundCanvas = createCanvasRecorder()
drawDiscussionCoverage(
  roundCanvas.context,
  { widthMeters: 1, depthMeters: 1, coverageRadiusMeters: 8 },
  { coverageShape: 'round', roomWidthMeters: 8, roomDepthMeters: 6 },
  (value) => value * 10,
  (value) => value * 10,
  10,
)
assert(roundCanvas.commands.some((command) => command[0] === 'clip'), '圆形覆盖未记录房间 clip')

const allSides = clipPolygonToRect([
  { x: -3, y: -2 },
  { x: 11, y: -2 },
  { x: 11, y: 8 },
  { x: -3, y: 8 },
], { left: 0, right: 8, top: 0, bottom: 6 })
assert.deepEqual(allSides.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y)), [
  { x: 0, y: 0 },
  { x: 0, y: 6 },
  { x: 8, y: 0 },
  { x: 8, y: 6 },
])

const rawNinetyNine = report({
  lengthMeters: '14',
  widthMeters: '10',
  heightMeters: '3.5',
  firstListeningDistanceMeters: '2',
  lastListeningDistanceMeters: '9',
  listeningWidthMeters: '12',
  layout: 'long',
})
assert(rawNinetyNine.minimumHorizontalCoverageRaw > 98 && rawNinetyNine.minimumHorizontalCoverageRaw < 99)
assert.equal(rawNinetyNine.recommendedHorizontalCoverage, 120)
assert(rawNinetyNine.speakerRecommendation.packages.length > 0, '100°型号应满足未舍入的98～99°几何需求')
assert.equal(buildVenuePlan(rawNinetyNine).sources[0].coverageDeg, 100)

const yawLayout = report({
  lengthMeters: '14',
  widthMeters: '8',
  heightMeters: '4',
  firstListeningDistanceMeters: '1',
  lastListeningDistanceMeters: '12',
  listeningWidthMeters: '8',
  layout: 'short',
})
assert(yawLayout.mainSpeakerPositions[0].aimYawDeg > 0)
const yawPlan = buildVenuePlan(yawLayout)
const expectedAimDepth = ((yawLayout.speakerCenterHeightRaw - 1.2)
  / Math.tan(yawPlan.sources[0].aimDownDeg * Math.PI / 180))
  * Math.cos(yawPlan.sources[0].aimYawDeg * Math.PI / 180)
assert(Math.abs(yawPlan.sources[0].aimDepthMeters - expectedAimDepth) < 1e-12)

console.log('venue report accuracy regression PASS')

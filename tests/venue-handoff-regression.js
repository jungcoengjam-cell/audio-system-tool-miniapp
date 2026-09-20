const assert = require('assert')

const {
  buildVenueHandoffReview,
  calculateArrivalDifferenceMs,
  calculatePathDistanceMeters,
} = require('../utils/venue-handoff')
const { calculateVenueEstimate } = require('../utils/venue')
const {
  buildVenueHandoffReviewForResult,
  buildVenuePlan,
} = require('../utils/venue-plan')

function source({
  id,
  label = id,
  type,
  widthMeters,
  depthMeters,
  aimDepthMeters,
  coverageDeg = 180,
  verticalCoverageDeg = 180,
  aimYawDeg = 0,
  aimDownDeg = 0,
}) {
  return {
    id,
    label,
    type,
    widthMeters,
    depthMeters,
    aimDepthMeters,
    coverageDeg,
    verticalCoverageDeg,
    aimYawDeg,
    aimDownDeg,
  }
}

function planWithSources(sources, overrides = {}) {
  return {
    speakerCenterHeightMeters: 2.5,
    earHeightMeters: 1.2,
    listeningSideMarginMeters: 0,
    listeningWidthMeters: 12,
    sources,
    ...overrides,
  }
}

const threeDimensionalDistance = calculatePathDistanceMeters({
  point: { widthMeters: 3, depthMeters: 4 },
  source: { widthMeters: 0, depthMeters: 0 },
  speakerCenterHeightMeters: 4,
  earHeightMeters: 1,
})
assert(Math.abs(threeDimensionalDistance - Math.sqrt(34)) < 1e-12)

assert.equal(calculateArrivalDifferenceMs({
  upstreamDistanceMeters: 343,
  fillDistanceMeters: 0,
}), 1000)
assert.equal(calculateArrivalDifferenceMs({
  upstreamDistanceMeters: 10,
  fillDistanceMeters: 5,
}), (5 / 343) * 1000)
assert.equal(calculateArrivalDifferenceMs({
  upstreamDistanceMeters: 5,
  fillDistanceMeters: 10,
}), (-5 / 343) * 1000)
assert.equal(calculateArrivalDifferenceMs({
  upstreamDistanceMeters: 10,
  fillDistanceMeters: 10,
}), 0)
;[
  { upstreamDistanceMeters: 'bad', fillDistanceMeters: 10 },
  { upstreamDistanceMeters: -1, fillDistanceMeters: 10 },
  { upstreamDistanceMeters: 10, fillDistanceMeters: -1 },
  { upstreamDistanceMeters: 10, fillDistanceMeters: 10, speedOfSoundMetersPerSecond: 0 },
  { upstreamDistanceMeters: 10, fillDistanceMeters: 10, speedOfSoundMetersPerSecond: -343 },
  { upstreamDistanceMeters: null, fillDistanceMeters: 10 },
  { upstreamDistanceMeters: '', fillDistanceMeters: 10 },
  { upstreamDistanceMeters: ' ', fillDistanceMeters: 10 },
  { upstreamDistanceMeters: true, fillDistanceMeters: 10 },
  { upstreamDistanceMeters: {}, fillDistanceMeters: 10 },
].forEach((input) => assert.equal(calculateArrivalDifferenceMs(input), null))

const twoGroups = buildVenueHandoffReview(planWithSources([
  source({ id: 'main-left', label: 'M1', type: 'main', widthMeters: 3, depthMeters: 0 }),
  source({ id: 'main-right', label: 'M2', type: 'main', widthMeters: 9, depthMeters: 0 }),
  source({ id: 'fill-1-left', label: 'F1', type: 'fill', widthMeters: 3, depthMeters: 4, aimDepthMeters: 6 }),
  source({ id: 'fill-1-right', label: 'F2', type: 'fill', widthMeters: 9, depthMeters: 4, aimDepthMeters: 6 }),
  source({ id: 'fill-2-left', label: 'F3', type: 'fill', widthMeters: 3, depthMeters: 8, aimDepthMeters: 10 }),
  source({ id: 'fill-2-right', label: 'F4', type: 'fill', widthMeters: 9, depthMeters: 8, aimDepthMeters: 10 }),
]))
assert.equal(twoGroups.groups.length, 2)
assert.deepEqual(twoGroups.groups.map((group) => group.points.map((point) => point.label)), [
  ['1/4', '1/2', '3/4'],
  ['1/4', '1/2', '3/4'],
])
assert(twoGroups.groups.every((group) => group.commonPointCount === 3))
assert(twoGroups.groups[0].points.every((point) => point.upstreamSourceLabel.startsWith('M')))
assert(twoGroups.groups[1].points.every((point) => point.upstreamSourceLabel.startsWith('F')))
assert(twoGroups.groups[1].points.every((point) => point.fillSourceLabel.startsWith('F')))
assert(twoGroups.groups[1].points.every((point) => point.arrivalDifferenceMsRaw > 0))

const noFill = buildVenueHandoffReview(planWithSources([
  source({ id: 'main', type: 'main', widthMeters: 6, depthMeters: 0 }),
]))
assert.deepEqual(noFill.groups, [])

const noCommonRange = buildVenueHandoffReview(planWithSources([
  source({ id: 'main', type: 'main', widthMeters: 6, depthMeters: 0 }),
  source({
    id: 'fill',
    type: 'fill',
    widthMeters: 6.5,
    depthMeters: 4,
    aimDepthMeters: 6,
    coverageDeg: 10,
  }),
]))
assert.equal(noCommonRange.groups[0].commonPointCount, 0)
assert(noCommonRange.groups[0].points.every((point) => (
  point.available === false
  && point.arrivalDifferenceMsRaw === null
  && point.upstreamDistanceMetersRaw === null
  && point.fillDistanceMetersRaw === null
)))
assert.equal(noCommonRange.groups[0].minimumArrivalDifferenceMsRaw, null)
assert.equal(noCommonRange.groups[0].maximumArrivalDifferenceMsRaw, null)

const missingFields = buildVenueHandoffReview({
  speakerCenterHeightMeters: 'missing',
  listeningWidthMeters: 12,
  listeningSideMarginMeters: 0,
  sources: [{ type: 'fill', depthMeters: 4, label: 'F1' }],
})
assert.equal(missingFields.groups.length, 1)
assert.equal(missingFields.groups[0].referenceDepthMetersRaw, null)
assert(missingFields.groups[0].points.every((point) => point.available === false))
assert(!JSON.stringify(missingFields).includes('NaN'))

const invalidListeningWidth = buildVenueHandoffReview(planWithSources([
  source({ id: 'main', type: 'main', widthMeters: 6, depthMeters: 0 }),
  source({ id: 'fill', type: 'fill', widthMeters: 6, depthMeters: 4, aimDepthMeters: 6 }),
], { listeningWidthMeters: 0 }))
assert.equal(invalidListeningWidth.groups[0].totalPointCount, 3)
assert.deepEqual(invalidListeningWidth.groups[0].points, [])

const invalidPose = buildVenueHandoffReview(planWithSources([
  source({ id: 'main', type: 'main', widthMeters: 6, depthMeters: 0 }),
  source({
    id: 'fill',
    type: 'fill',
    widthMeters: 6,
    depthMeters: 4,
    aimDepthMeters: 6,
    aimYawDeg: 'bad',
  }),
]))
assert.equal(invalidPose.groups[0].commonPointCount, 0)

const backwardsPose = buildVenueHandoffReview(planWithSources([
  source({ id: 'main', type: 'main', widthMeters: 6, depthMeters: 0 }),
  source({
    id: 'fill',
    type: 'fill',
    widthMeters: 6,
    depthMeters: 4,
    aimDepthMeters: 6,
    aimYawDeg: 180,
  }),
]))
assert.equal(backwardsPose.groups[0].commonPointCount, 0)

const boundaryWidth = 4
const boundarySourceWidth = 1 + Math.tan(Math.PI / 6)
const boundary = buildVenueHandoffReview(planWithSources([
  source({ id: 'main', type: 'main', widthMeters: boundarySourceWidth, depthMeters: 0 }),
  source({
    id: 'fill-left',
    type: 'fill',
    widthMeters: boundarySourceWidth,
    depthMeters: 2,
    aimDepthMeters: 3,
    coverageDeg: 60,
  }),
  source({
    id: 'fill-right',
    type: 'fill',
    widthMeters: boundarySourceWidth,
    depthMeters: 2,
    aimDepthMeters: 3,
    coverageDeg: 60,
  }),
], { listeningWidthMeters: boundaryWidth }))
assert.equal(boundary.groups[0].points[0].available, true)

const justOutsideBoundary = buildVenueHandoffReview(planWithSources([
  source({ id: 'main', type: 'main', widthMeters: boundarySourceWidth, depthMeters: 0 }),
  source({
    id: 'fill-left',
    type: 'fill',
    widthMeters: boundarySourceWidth,
    depthMeters: 2,
    aimDepthMeters: 3,
    coverageDeg: 59.9,
  }),
  source({
    id: 'fill-right',
    type: 'fill',
    widthMeters: boundarySourceWidth,
    depthMeters: 2,
    aimDepthMeters: 3,
    coverageDeg: 59.9,
  }),
], { listeningWidthMeters: boundaryWidth }))
assert.equal(justOutsideBoundary.groups[0].points[0].available, false)

const result = calculateVenueEstimate({
  lengthMeters: '12',
  widthMeters: '8',
  heightMeters: '4',
  firstListeningDistanceMeters: '3',
  lastListeningDistanceMeters: '11',
  listeningWidthMeters: '7',
  layout: 'short',
  standardClassKey: 'conference',
  gradeKey: 'II',
})
const actualPlan = buildVenuePlan(result)
assert(actualPlan.handoffReview)
assert.equal(actualPlan.handoffReview.basis, 'nominal-geometry')
assert.equal(actualPlan.handoffReview.speedOfSoundMetersPerSecond, 343)
assert.equal(actualPlan.handoffReview.groups.length, 1)
assert(actualPlan.handoffReview.groups[0].points.every((point) => (
  point.arrivalDifferenceMsRaw === null || Number.isFinite(point.arrivalDifferenceMsRaw)
)))

const wrapperMatrix = [
  result,
  calculateVenueEstimate({
    lengthMeters: '12',
    widthMeters: '8',
    heightMeters: '4',
    firstListeningDistanceMeters: '3',
    lastListeningDistanceMeters: '6',
    listeningWidthMeters: '7',
    layout: 'short',
    standardClassKey: 'conference',
    gradeKey: 'II',
  }),
  calculateVenueEstimate({
    lengthMeters: '12',
    widthMeters: '8',
    heightMeters: '4',
    firstListeningDistanceMeters: '1',
    lastListeningDistanceMeters: '11',
    listeningWidthMeters: '6',
    layout: 'short',
    standardClassKey: 'conference',
    gradeKey: 'II',
  }),
]
wrapperMatrix.forEach((caseResult) => {
  assert.deepEqual(
    buildVenueHandoffReviewForResult(caseResult),
    buildVenuePlan(caseResult).handoffReview,
  )
})

console.log('venue handoff regression PASS')

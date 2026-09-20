const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const baseline = JSON.parse(zlib.gunzipSync(fs.readFileSync(
  path.join(__dirname, 'fixtures/calculator-renderer-baseline.json.gz'),
)))
const { drawPreviewAtSize } = require('../pages/camera/preview-renderer')
const { drawVenuePlan } = require('../pages/venue/plan-renderer')
const { calculateVenueEstimate } = require('../utils/venue')
const { buildVenuePlan } = require('../utils/venue-plan')
const { calculateDiscussionEstimate } = require('../utils/venue-discussion')
const { buildDiscussionPlan } = require('../utils/venue-discussion-plan')

function createRecorder() {
  const commands = []
  const context = {}
  const record = (name) => (...args) => commands.push([name, ...args])
  ;[
    'setFillStyle', 'setStrokeStyle', 'setLineWidth', 'setFontSize', 'setGlobalAlpha',
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'fill', 'stroke',
    'fillRect', 'strokeRect', 'fillText', 'save', 'restore', 'rect', 'clip',
  ].forEach((name) => { context[name] = record(name) })
  return { context, commands }
}

function compareCase(name, expectedCommands, draw) {
  const recorder = createRecorder()
  draw(recorder.context)
  assert.deepEqual(recorder.commands, expectedCommands, `${name} Canvas 指令与旧页基线不同`)
  assert(recorder.commands.length > 0, `${name} 未产生 Canvas 指令`)
}

const ground = {
  sceneMode: 'ground', cameraSetbackMeters: 1.2, depthMeters: 6, widthMeters: 5,
  requiredHorizontalFov: 62, cameraHeightMeters: 2.6, subjectHeightMeters: 1.8,
  requiresInitialAim: true, aimText: '固定机位', horizontalOnly: false,
}
const plane = {
  sceneMode: 'plane', distanceMeters: 4.5, widthMeters: 5, requiredHorizontalFov: 62,
  cameraHeightMeters: 2.6, bottomHeightMeters: 0.8, heightMeters: 2.5,
  requiresInitialAim: false, aimText: '', horizontalOnly: false,
}
const cameraResults = {
  'camera-ground': ground,
  'camera-ground-horizontal-only': { ...ground, horizontalOnly: true },
  'camera-plane': plane,
  'camera-plane-horizontal-only': { ...plane, horizontalOnly: true },
}
baseline.camera.forEach(({ name, width, height, commands }) => {
  compareCase(name, commands, (context) => drawPreviewAtSize(context, cameraResults[name], width, height))
})

const reportResult = calculateVenueEstimate({
  lengthMeters: '12', widthMeters: '8', heightMeters: '4',
  standardClassKey: 'conference', gradeKey: 'II',
  firstListeningDistanceMeters: '3', lastListeningDistanceMeters: '11',
  listeningWidthMeters: '7', layout: 'short',
})
const discussionResults = ['round', 'rectangular'].map((tableShape) => calculateDiscussionEstimate({
  lengthMeters: '12', widthMeters: '8', heightMeters: '4',
  standardClassKey: 'conference', gradeKey: 'II', tableShape,
  tableDiameterMeters: '3', tableLengthMeters: '4.8', tableWidthMeters: '1.8',
  participantCount: '12', audioMode: 'voiceLift', installationCondition: 'flat',
}))
const plans = {
  'venue-report': buildVenuePlan(reportResult),
  'venue-report-boundary': buildVenuePlan(reportResult),
  'venue-discussion-round': buildDiscussionPlan(discussionResults[0]),
  'venue-discussion-round-boundary': buildDiscussionPlan(discussionResults[0]),
  'venue-discussion-rectangular': buildDiscussionPlan(discussionResults[1]),
  'venue-discussion-rectangular-boundary': buildDiscussionPlan(discussionResults[1]),
}
baseline.venue.forEach(({ name, width, height, commands }) => {
  compareCase(name, commands, (context) => drawVenuePlan(context, plans[name], width, height))
})

console.log('calculator renderer regression PASS')

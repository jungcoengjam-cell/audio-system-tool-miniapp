const assert = require('assert/strict')
const { calculateVenueEstimate } = require('../utils/venue')
const { calculateDiscussionEstimate } = require('../utils/venue-discussion')

const originalPage = global.Page
const originalWx = global.wx
let pageDefinition
global.Page = (definition) => { pageDefinition = definition }
let selectorWidth = 320
let exportOptions = null
let pendingClearDrawCallback = null
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  nextTick: (callback) => callback(),
  createSelectorQuery: () => ({
    select() { return this },
    boundingClientRect(callback) { this.callback = callback; return this },
    exec() { this.callback({ width: selectorWidth }); },
  }),
  canvasToTempFilePath: (options) => { exportOptions = options; options.success({ tempFilePath: 'temp://venue.png' }) },
  createCanvasContext: () => ({ clearRect() {}, draw(_reserve, callback) { pendingClearDrawCallback = callback } }),
}

const pagePath = require.resolve('../pages/venue/venue')
delete require.cache[pagePath]
require(pagePath)
assert(pageDefinition)

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function prepare(result) {
  const page = { ...pageDefinition, data: clone(pageDefinition.data) }
  page.setData = (changes, callback) => {
    Object.assign(page.data, changes)
    if (callback) callback()
  }
  page.data.result = result
  page.data.showVenuePlan = true
  page.data.planImagePath = ''
  page._pageVisible = true
  page.isVenuePlanReady = true
  page.isVenuePlanMeasured = false
  page.venuePlanRevision = 1
  page.ensureVenuePlan({ syncView: false })
  return page
}

for (const result of [
  calculateVenueEstimate({ lengthMeters: '12', widthMeters: '8', heightMeters: '4', standardClassKey: 'conference', gradeKey: 'II', firstListeningDistanceMeters: '3', lastListeningDistanceMeters: '11', listeningWidthMeters: '7', layout: 'short' }),
  calculateDiscussionEstimate({ lengthMeters: '12', widthMeters: '8', heightMeters: '4', standardClassKey: 'conference', gradeKey: 'II', tableShape: 'round', tableDiameterMeters: '3', participantCount: '12', audioMode: 'voiceLift', installationCondition: 'flat' }),
]) {
  let queuedPlan = null
  const page = prepare(result)
  page.queueVenuePlan = (plan) => { queuedPlan = plan }
  page.measureVenuePlanCanvas()
  assert.equal(page.data.planCanvasWidth, 320)
  assert.equal(page.data.planCanvasHeight, result.kind === 'discussion' ? 445 : 403)
  assert(queuedPlan)

  exportOptions = null
  page.commitVenuePlanCanvas({
    draw(_reserve, callback) { if (callback) callback() },
  }, queuedPlan, page.venuePlanRevision, () => {}, {})
  assert.equal(exportOptions.width, 320)
  assert.equal(exportOptions.height, result.kind === 'discussion' ? 445 : 403)
  assert.equal(exportOptions.destWidth, 640)
  assert.equal(exportOptions.destHeight, (result.kind === 'discussion' ? 445 : 403) * 2)
  assert.equal(page.data.planImagePath, '')
  assert(pendingClearDrawCallback)
  pendingClearDrawCallback()
  assert.equal(page.data.planImagePath, 'temp://venue.png')
  assert.equal(page.venuePlanSnapshotTimer, null)
}

global.Page = originalPage
global.wx = originalWx
console.log('venue plan controller regression PASS')

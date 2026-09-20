const assert = require('assert/strict')

const {
  buildDiscussionCoverageSummary,
  calculateDiscussionEstimate,
} = require('../utils/venue-discussion')
const { calculateVenueEstimate } = require('../utils/venue')
const { buildDiscussionPlan } = require('../utils/venue-discussion-plan')
const { buildResultReportPayload } = require('../utils/result-report')

function discussionInput(overrides = {}) {
  return {
    lengthMeters: 10,
    widthMeters: 8,
    heightMeters: 3,
    tableShape: 'round',
    tableDiameterMeters: 3,
    participantCount: 12,
    audioMode: 'voiceLift',
    installationCondition: 'flat',
    standardClassKey: 'conference',
    gradeKey: 'II',
    ...overrides,
  }
}

function calculate(input) {
  const result = calculateDiscussionEstimate(input)
  assert.equal(result.error, undefined, result.error || '讨论型输入不应失败')
  return result
}

// 参会人数只接受 4～40 的整数；小数不能被四舍五入成另一组有效输入。
for (const invalidParticipantCount of [3.9, 4.1, 12.6, 39.9, 40.4, '3.9', '12.6', '40.4', NaN, Infinity, -Infinity, null, undefined, [], [12], {}, { valueOf: () => 12 }, true, false]) {
  const result = calculateDiscussionEstimate(discussionInput({ participantCount: invalidParticipantCount }))
  assert(result.error, `非法参会人数不应生成计划：${String(invalidParticipantCount)}`)
  assert.equal(result.speakerPositions, undefined)
}
const minimumParticipantResult = calculate(discussionInput({ participantCount: 4 }))
const maximumParticipantResult = calculate(discussionInput({ participantCount: 40 }))
assert.equal(minimumParticipantResult.participantCount, 4)
assert.equal(maximumParticipantResult.participantCount, 40)
const integerTextResult = calculate(discussionInput({ participantCount: ' 12.0 ' }))
const integerNumberResult = calculate(discussionInput({ participantCount: 12 }))
assert.equal(integerTextResult.participantCount, integerNumberResult.participantCount)
assert.deepEqual(integerTextResult.speakerPositions, integerNumberResult.speakerPositions)

function assertSourceBounds(result) {
  result.speakerPositions.forEach((source) => {
    assert(source.widthMeters >= 0 && source.widthMeters <= result.roomWidthMeters)
    assert(source.depthMeters >= 0 && source.depthMeters <= result.roomLengthMeters)
    assert(Number.isFinite(source.widthMeters) && Number.isFinite(source.depthMeters))
  })
}

// 有限确定性矩阵覆盖圆桌/矩形桌、吸顶/吊装/壁挂、两种路由和层高边界。
const matrix = [
  discussionInput({ heightMeters: 2.5, installationCondition: 'blocked' }),
  discussionInput({ heightMeters: 2.6, installationCondition: 'flat' }),
  discussionInput({ heightMeters: 4.6, installationCondition: 'open' }),
  discussionInput({ heightMeters: 3, participantCount: 8 }),
  discussionInput({ heightMeters: 3, participantCount: 16 }),
  discussionInput({ heightMeters: 4.5, participantCount: 24, tableDiameterMeters: 5 }),
  discussionInput({ heightMeters: 3, audioMode: 'remote', installationCondition: 'blocked' }),
  discussionInput({ heightMeters: 4.6, audioMode: 'remote', installationCondition: 'open' }),
  discussionInput({ lengthMeters: 8, widthMeters: 6, tableShape: 'rectangular', tableLengthMeters: 4.8, tableWidthMeters: 1.8, tableDiameterMeters: undefined, participantCount: 12 }),
  discussionInput({ lengthMeters: 8, widthMeters: 6, tableShape: 'rectangular', tableLengthMeters: 4.8, tableWidthMeters: 1.8, participantCount: 16, installationCondition: 'blocked' }),
  discussionInput({ lengthMeters: 12, widthMeters: 8, tableShape: 'rectangular', tableLengthMeters: 7, tableWidthMeters: 2.4, participantCount: 16, installationCondition: 'flat' }),
  discussionInput({ lengthMeters: 12, widthMeters: 8, tableShape: 'rectangular', tableLengthMeters: 7, tableWidthMeters: 2.4, participantCount: 16, installationCondition: 'open' }),
  discussionInput({ lengthMeters: 12, widthMeters: 8, tableShape: 'rectangular', tableLengthMeters: 7, tableWidthMeters: 2.4, participantCount: 16, installationCondition: 'blocked' }),
  discussionInput({ lengthMeters: 14, widthMeters: 10, tableShape: 'round', tableDiameterMeters: 5, participantCount: 20, installationCondition: 'flat' }),
  discussionInput({ lengthMeters: 14, widthMeters: 10, tableShape: 'round', tableDiameterMeters: 5, participantCount: 20, installationCondition: 'blocked' }),
  discussionInput({ lengthMeters: 14, widthMeters: 10, tableShape: 'round', tableDiameterMeters: 5, participantCount: 20, installationCondition: 'open' }),
  discussionInput({ lengthMeters: 17, widthMeters: 17, heightMeters: 2.6, tableShape: 'rectangular', tableLengthMeters: 14, tableWidthMeters: 4, participantCount: 32, installationCondition: 'flat' }),
  discussionInput({ lengthMeters: 8, widthMeters: 6, heightMeters: 3, tableShape: 'round', tableDiameterMeters: 3, participantCount: 12, installationCondition: 'blocked' }),
  discussionInput({ lengthMeters: 10, widthMeters: 8, heightMeters: 2.6, tableShape: 'rectangular', tableLengthMeters: 7, tableWidthMeters: 2.4, participantCount: 16, audioMode: 'remote', installationCondition: 'open' }),
  discussionInput({ lengthMeters: 10, widthMeters: 8, heightMeters: 5, tableShape: 'round', tableDiameterMeters: 3, participantCount: 12, audioMode: 'remote', installationCondition: 'open' }),
]
matrix.forEach((input) => {
  const result = calculate(input)
  assertSourceBounds(result)
  assert(result.speakerCount >= result.routingMinimumCount)
  assert.equal(result.speakerPositions.length, result.speakerCount)
  assert(result.layoutSelection.candidates.every((candidate) => !candidate.isValid || candidate.sourceCount === candidate.count))
})

const candidateProbe = calculate(discussionInput())
assert.equal(candidateProbe.coverageVerification, 'unverified')
assert.equal(candidateProbe.coverageSummary.dataBasis, 'nominal-geometry')
assert.equal(candidateProbe.coverageSummary.acousticCoverageVerified, false)
assert.equal(candidateProbe.layoutSelection.basis, 'nominal-geometry')
assert.equal(candidateProbe.layoutSelection.candidateCount, 18)
assert.equal(candidateProbe.layoutSelection.candidates.length, 18)
assert.equal(typeof candidateProbe.layoutSelection.summary, 'string')
assert(candidateProbe.layoutSelection.summary.includes('比较18组候选'))
assert(candidateProbe.layoutSelection.selectedMetrics)
assert(candidateProbe.layoutSelection.candidates.every((candidate) => [2, 4, 6, 8, 10, 12].includes(candidate.count)))
assert(candidateProbe.layoutSelection.candidates.every((candidate) => Number.isFinite(candidate.rawRequiredCoverageDeg)))
assert(candidateProbe.layoutSelection.candidates.some((candidate) => Math.abs(candidate.rawRequiredCoverageDeg - Math.round(candidate.rawRequiredCoverageDeg)) > 0.001))
assert(candidateProbe.layoutSelection.selectedId)
assert(candidateProbe.layoutSelection.candidates.some((candidate) => candidate.variant === 'baseline'))
assert(candidateProbe.layoutSelection.candidates.some((candidate) => candidate.variant === 'compact'))
assert(candidateProbe.layoutSelection.candidates.some((candidate) => candidate.variant === 'expanded'))
assert(candidateProbe.speakerCount >= candidateProbe.routingMinimumCount)

for (const tableShape of ['round', 'rectangular']) {
  for (const installationCondition of ['flat', 'blocked', 'open']) {
    const input = tableShape === 'round'
      ? discussionInput({ tableShape, tableDiameterMeters: 3, installationCondition, audioMode: 'voiceLift' })
      : discussionInput({ tableShape, tableLengthMeters: 5, tableWidthMeters: 2, installationCondition, audioMode: 'voiceLift' })
    const result = calculate(input)
    assert.equal(result.layoutSelection.candidateCount, 18)
    assert(result.speakerCount >= result.routingMinimumCount)
    assertSourceBounds(result)
  }
}

const largeLowHeight = calculate(discussionInput({
  lengthMeters: 17,
  widthMeters: 17,
  heightMeters: 2.6,
  tableShape: 'rectangular',
  tableLengthMeters: 14,
  tableWidthMeters: 4,
  participantCount: 32,
  installationCondition: 'flat',
}))
assert(largeLowHeight.speakerCount >= largeLowHeight.routingMinimumCount)
assert.equal(largeLowHeight.coverageMinimumCountVerified, false)
assert(largeLowHeight.layoutSelection.summary.includes('90°内无完整覆盖'))
assert(largeLowHeight.coverageSummary.uncoveredSeatCount > 0 || largeLowHeight.minimumCoverageDeg > 120)
assert(largeLowHeight.reviewWarnings.some((warning) => warning.includes('覆盖') || warning.includes('120°')))

const nominalBackup = calculate(discussionInput({
  lengthMeters: 12,
  widthMeters: 8,
  heightMeters: 2.6,
  tableShape: 'rectangular',
  tableLengthMeters: 7,
  tableWidthMeters: 2.4,
  participantCount: 12,
  audioMode: 'remote',
  installationCondition: 'flat',
}))
const nominalPreferred = nominalBackup.layoutSelection.candidates.some((candidate) => candidate.nominalComplete && candidate.rawRequiredCoverageDeg <= 90)
const nominalAtMost120 = nominalBackup.layoutSelection.candidates.some((candidate) => candidate.uncoveredSeatCount === 0 && candidate.rawRequiredCoverageDeg <= 120)
assert.equal(nominalPreferred, false)
assert.equal(nominalAtMost120, true)
assert.equal(nominalBackup.coverageSummary.uncoveredSeatCount, 0)
assert(nominalBackup.layoutSelection.summary.includes('90°内无完整覆盖'))
assert(nominalBackup.speakerCount >= nominalBackup.routingMinimumCount)

const stableA = calculate(discussionInput())
const stableB = calculate(discussionInput())
assert.equal(stableA.layoutSelection.selectedId, stableB.layoutSelection.selectedId)
assert.deepEqual(stableA.speakerPositions, stableB.speakerPositions)

const roundedRadius = calculate(discussionInput({
  lengthMeters: 10,
  widthMeters: 8,
  heightMeters: 4.5,
  tableShape: 'rectangular',
  tableLengthMeters: 7,
  tableWidthMeters: 2.4,
  participantCount: 16,
}))
const roundedPlan = buildDiscussionPlan(roundedRadius)
assert.equal(roundedRadius.coverageRadiusMeters, (4.4 - 1.2) * Math.tan((roundedRadius.recommendedCoverageDeg / 2) * Math.PI / 180))
assert.equal(roundedPlan.statistics.coveredSeatCount, roundedRadius.coverageSummary.coveredSeatCount)
assert.equal(roundedPlan.statistics.statusKey, 'review')
assert.equal(roundedPlan.statistics.geometryStatusKey, roundedRadius.coverageSummary.excessiveOverlapSeatCount || roundedRadius.coverageSummary.uncoveredSeatCount ? 'review' : 'pass')
assert(roundedPlan.elevation.rawRequiredVerticalCoverageDeg <= roundedPlan.elevation.requiredVerticalCoverageDeg)
assert(roundedPlan.elevation.requiredVerticalCoverageDeg - roundedPlan.elevation.rawRequiredVerticalCoverageDeg < 0.1)

const wall = calculate(discussionInput({
  lengthMeters: 8,
  widthMeters: 6,
  heightMeters: 3,
  tableShape: 'round',
  tableDiameterMeters: 3,
  participantCount: 12,
  installationCondition: 'blocked',
}))
const wallPlan = buildDiscussionPlan(wall)
assert.equal(wall.coverageSummary.uncoveredSeatIds.length, 0)
assert(Number.isFinite(wall.coverageSummary.eligibleMaximumHorizontalMeters))
assert(Number.isFinite(wall.maximumNearestDistanceMeters))
assert(Number.isFinite(wall.maximumNearestDistanceMetersExact))
assert(wall.layoutSelection.candidates.some((candidate) => candidate.count === 2))
assert.equal(wallPlan.elevation.recommendedDownTiltDeg, null)
assert(wallPlan.elevation.downTiltSummary.includes('各音箱按负责坐席分别调整'))
wallPlan.seats.forEach((seat) => {
  assert(seat.responsibleSpeakerId)
  assert(seat.coveringSourceIds.includes(seat.responsibleSpeakerId))
})

const noEligible = buildDiscussionCoverageSummary({
  seats: [{ id: 'seat-1', widthMeters: 10, depthMeters: 0 }],
  speakerPositions: [{ id: 'speaker-1', widthMeters: 0, depthMeters: 0, aimWidth: -1, aimDepth: 0 }],
  coverageShape: 'directional',
  recommendedCoverageDeg: 120,
  speakerHeight: 2.5,
})
assert.deepEqual(noEligible.uncoveredSeatIds, ['seat-1'])
assert.equal(noEligible.maximumPathDistanceMeters, null)
assert.equal(noEligible.responsibleBySource[0].seatCount, 0)

const justOutsideNominalHalfAngle = buildDiscussionCoverageSummary({
  seats: [{ id: 'seat-just-outside', widthMeters: Math.cos((30.00001 * Math.PI) / 180), depthMeters: Math.sin((30.00001 * Math.PI) / 180) }],
  speakerPositions: [{ id: 'speaker-1', widthMeters: 0, depthMeters: 0, aimWidth: 1, aimDepth: 0 }],
  coverageShape: 'directional',
  recommendedCoverageDeg: 60,
  speakerHeight: 2.5,
})
assert.deepEqual(justOutsideNominalHalfAngle.uncoveredSeatIds, ['seat-just-outside'])

const raggedRepair = calculate(discussionInput({
  lengthMeters: 10,
  widthMeters: 8,
  heightMeters: 2.6,
  tableShape: 'rectangular',
  tableLengthMeters: 7,
  tableWidthMeters: 2.4,
  participantCount: 16,
  audioMode: 'remote',
  installationCondition: 'open',
}))
const rowCounts = Object.values(raggedRepair.speakerPositions.reduce((rows, source) => {
  const key = source.depthMeters.toFixed(6)
  rows[key] = (rows[key] || 0) + 1
  return rows
}, {}))
assert(rowCounts.every((count) => count === 2), `网格存在不完整行：${JSON.stringify(rowCounts)}`)
assert.equal(raggedRepair.speakerPositions.length % 2, 0)
assert(raggedRepair.speakerPositions.every((source) => Number.isFinite(source.widthMeters) && Number.isFinite(source.depthMeters)))

const remoteGrid = calculate(discussionInput({
  lengthMeters: 12,
  widthMeters: 8,
  tableShape: 'rectangular',
  tableLengthMeters: 7,
  tableWidthMeters: 2.4,
  participantCount: 16,
  audioMode: 'remote',
  installationCondition: 'open',
}))
const remoteRows = Object.values(remoteGrid.speakerPositions.reduce((rows, source) => {
  const key = source.depthMeters.toFixed(6)
  rows[key] = (rows[key] || 0) + 1
  return rows
}, {}))
assert(remoteRows.length > 0 && remoteRows.every((count) => count === remoteRows[0]))

const scope = calculate(discussionInput({
  lengthMeters: 17,
  widthMeters: 17,
  heightMeters: 2.6,
  tableShape: 'rectangular',
  tableLengthMeters: 14,
  tableWidthMeters: 4,
  participantCount: 32,
}))
const scopePlan = buildDiscussionPlan(scope)
assert.equal(scopePlan.statistics.coveredSeatCount, scope.coverageSummary.coveredSeatCount)
assert(scope.reviewWarnings.some((warning) => warning.includes('标称角几何范围')))
assert(scope.reviewWarnings.some((warning) => warning.includes('覆盖') || warning.includes('交叠')))
assert.equal(scopePlan.statistics.statusKey, 'review')
assert(['pass', 'review'].includes(scopePlan.statistics.geometryStatusKey))

// 实际页面函数调用：折叠状态不预建 plan，但复制/生成摘要仍带统一覆盖与 review warning。
let venuePageConfig
global.Page = (config) => { venuePageConfig = config }
const storage = new Map()
let clipboard = ''
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getSystemInfoSync: () => ({ theme: 'light' }),
  onThemeChange: () => {},
  offThemeChange: () => {},
  showToast: () => {},
  showModal: () => {},
  vibrateShort: () => {},
  setClipboardData: ({ data }) => { clipboard = data },
}
delete require.cache[require.resolve('../pages/venue/venue')]
require('../pages/venue/venue')
const page = { ...venuePageConfig, data: JSON.parse(JSON.stringify(venuePageConfig.data)) }
page.setData = (changes, callback) => {
  Object.assign(page.data, changes)
  if (callback) callback()
}
page._pageVisible = false
page.calculate({
  sceneModeIndex: 1,
  lengthText: '17',
  widthText: '17',
  heightText: '2.6',
  discussionTableShapeIndex: 1,
  discussionInstallationConditionIndex: 0,
  participantCountText: '32',
  tableLengthText: '14',
  tableWidthText: '4',
})
assert.equal(page.pendingVenuePlan, null)
const pageRecord = page.buildResultReportRecord(page.data, page.data.result)
assert.deepEqual(Object.keys(pageRecord).sort(), ['module', 'preferences', 'resultText', 'summary', 'title'])
const pageCoverageText = `${page.data.result.coverageSummary.coveredSeatCount}/${page.data.result.coverageSummary.participantCount}`
const pageRawAngleText = `${Math.round(page.data.result.minimumCoverageDeg * 10) / 10}°`
assert(pageRecord.resultText.includes(`几何参考坐席范围：${pageCoverageText}`))
assert(pageRecord.resultText.includes(pageRawAngleText))
const reportPayload = buildResultReportPayload(pageRecord)
assert(reportPayload.lines.some((line) => line.includes(pageCoverageText)))
assert(reportPayload.lines.some((line) => line.includes(pageRawAngleText)))
assert(reportPayload.lines.length <= 20)
assert(reportPayload.lines.every((line) => {
  const units = [...line].reduce((total, character) => total + (/^[\x00-\xff]$/.test(character) ? 0.55 : 1), 0)
  return line.length > 0 && Math.ceil(units / 27) <= 2
}))
page.copyResult()
assert(clipboard.includes(pageCoverageText))
assert(clipboard.includes(pageRawAngleText))

const reportContext = new Proxy({}, {
  get: (target, key) => {
    if (key === 'measureText') return () => ({ width: 12 })
    if (key === 'draw') return (reserve, callback) => {
      const done = typeof reserve === 'function' ? reserve : callback
      if (done) done()
    }
    return () => {}
  },
})
let exportedReport
wx.showLoading = () => {}
wx.hideLoading = () => {}
wx.createCanvasContext = () => reportContext
wx.canvasToTempFilePath = (options) => {
  exportedReport = options
  options.success({ tempFilePath: 'temp://venue-discussion-report.png' })
}
page.generateResultReportImage()
assert(exportedReport)
assert.equal(page.data.resultReportImagePath, 'temp://venue-discussion-report.png')
page.ensureVenuePlan({ syncView: false })
page.toggleCurrentFavorite()
assert.equal(page.data.currentFavorite, true)
const favoriteStorageSnapshot = JSON.stringify([...storage.entries()])
page.calculate({ participantCountText: '12.6' })
assert.equal(page.data.result, null)
assert.equal(page.pendingVenuePlan, null)
assert.equal(page.data.planImagePath, '')
assert.equal(page.data.resultReportImagePath, '')
assert.equal(page.data.currentFavorite, false)
page.toggleCurrentFavorite()
page.saveToActiveProject()
assert.equal(JSON.stringify([...storage.entries()]), favoriteStorageSnapshot)
page.calculate({ participantCountText: '32' })
page.onShow()
assert.equal(page.data.result.participantCount, 32)
assert.equal(page.data.currentFavorite, true)
page.calculate({ participantCountText: '12' })
assert(page.data.result)
assert.equal(page.data.result.participantCount, 12)

const reportBase = calculateVenueEstimate({
  lengthMeters: 14,
  widthMeters: 10,
  heightMeters: 3.5,
  firstListeningDistanceMeters: 2,
  lastListeningDistanceMeters: 9,
  listeningWidthMeters: 12,
  layout: 'long',
  standardClassKey: 'conference',
  gradeKey: 'II',
})
assert.equal(reportBase.error, undefined)
assert.equal(reportBase.reviewWarnings?.some((warning) => warning.includes('标称角')), true)
const reportReviewRecord = page.buildResultReportRecord(page.data, reportBase)
assert(reportReviewRecord.resultText.includes('资料边界：标称角范围与声学资料待核验'))
const reportReviewPayload = buildResultReportPayload(reportReviewRecord)
assert(reportReviewPayload.lines.some((line) => line.includes('资料边界')))
assert(reportReviewPayload.lines.length <= 20)
assert(reportReviewPayload.lines.every((line) => {
  const units = [...line].reduce((total, character) => total + (/^[\x00-\xff]$/.test(character) ? 0.55 : 1), 0)
  return Math.ceil(units / 27) <= 3
}))

console.log(`venue discussion accuracy regression passed: ${matrix.length} deterministic cases`)

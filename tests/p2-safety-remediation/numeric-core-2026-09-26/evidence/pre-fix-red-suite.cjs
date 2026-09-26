const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
function loadHead(relative) {
  const source = execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, encoding: 'utf8' })
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports })
  return module.exports
}
const gain = loadHead('utils/gain-structure.js')
const limiter = loadHead('utils/limiter.js')
const spl = loadHead('utils/spl.js')
const camera = loadHead('utils/camera-fov.js')
const gainInput = {
  amplifier: { model: 'synthetic-negative-power', stereoPower: { 4: -100 } },
  inputStage: { controlType: 'voltageGain', unit: 'dB', options: [20] },
  selectedStageValue: 20, mode: 'stereo', loadImpedance: 4,
}
const fov = { horizontalFov: 60, verticalFov: 40, diagonalFov: 70 }
const checks = [
  ['NC-GAIN-01', () => assert.notEqual(gain.calculateGainStructure(gainInput).valid, true), () => gain.calculateGainStructure(gainInput)],
  ['NC-LIM-01', () => assert.notEqual(limiter.calculateLimiter({
    amplifier: { model: 'Synthetic', stereoPower: { 4: Infinity } },
    speaker: { impedance: 4, ratedPower: 100 }, count: 1, mode: 'stereo', sensitivityVoltage: 1,
  }).valid, true), () => limiter.calculateLimiter({
    amplifier: { model: 'Synthetic', stereoPower: { 4: Infinity } },
    speaker: { impedance: 4, ratedPower: 100 }, count: 1, mode: 'stereo', sensitivityVoltage: 1,
  })],
  ['NC-SPL-01', () => assert.equal(spl.calculateSpeakerSpl({
    speaker: { sensitivityDb: 95, ratedPower: Number.MAX_VALUE }, distanceMeters: 1, speakerCount: 2,
  }), null), () => spl.calculateSpeakerSpl({
    speaker: { sensitivityDb: 95, ratedPower: Number.MAX_VALUE }, distanceMeters: 1, speakerCount: 2,
  })],
  ['NC-SPL-02', () => assert.equal(spl.calculateSplAtDistance(95, 100, 1, Infinity), null), () => spl.calculateSplAtDistance(95, 100, 1, Infinity)],
  ['NC-CAM-01', () => assert.equal(camera.calculateCoverage(fov, { distanceMeters: Number.MAX_VALUE }), null), () => camera.calculateCoverage(fov, { distanceMeters: Number.MAX_VALUE })],
  ['NC-CAM-02', () => assert.equal(camera.calculateCoverage(
    { horizontalFov: NaN, verticalFov: Infinity, diagonalFov: NaN }, { distanceMeters: 3 },
  ), null), () => camera.calculateCoverage(
    { horizontalFov: NaN, verticalFov: Infinity, diagonalFov: NaN }, { distanceMeters: 3 },
  )],
]
const outcomes = checks.map(([id, assertion, invoke]) => {
  try {
    const value = invoke()
    assertion()
    return { id, expectedRegression: 'unexpectedly passed', value }
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error
    return { id, expectedRegression: 'failed before fix', failure: error.message, actual: invoke() }
  }
})
assert.ok(outcomes.every((item) => item.expectedRegression === 'failed before fix'))
const report = {
  status: 'PRE_FIX_REGRESSIONS_CONFIRMED',
  source: 'git HEAD versions of the four production cores',
  expectedFailingCases: outcomes.map((item) => item.id),
  outcomes,
}
const tagNonFinite = (key, value) => (
  typeof value === 'number' && !Number.isFinite(value)
    ? Number.isNaN(value) ? 'NaN' : value > 0 ? '+Infinity' : '-Infinity'
    : value
)
const raw = JSON.stringify(report, tagNonFinite, 2) + '\n'
report.sha256 = crypto.createHash('sha256').update(raw).digest('hex')
fs.writeFileSync(path.join(__dirname, 'pre-fix-red-suite.json'), JSON.stringify(report, tagNonFinite, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ status: report.status, cases: report.expectedFailingCases }, null, 2))

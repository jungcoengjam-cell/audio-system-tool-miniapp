const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../..')
const gain = require(path.join(root, 'utils/gain-structure'))
const limiter = require(path.join(root, 'utils/limiter'))
const spl = require(path.join(root, 'utils/spl'))
const camera = require(path.join(root, 'utils/camera-fov'))

const gainInput = {
  amplifier: { model: 'synthetic-negative-power', stereoPower: { 4: -100 } },
  inputStage: { controlType: 'voltageGain', unit: 'dB', options: [20] },
  selectedStageValue: 20, mode: 'stereo', loadImpedance: 4,
}
const limiterInput = {
  amplifier: { model: 'Synthetic', stereoPower: { 4: Infinity } },
  speaker: { impedance: 4, ratedPower: 100 }, count: 1, mode: 'stereo', sensitivityVoltage: 1,
}
const cases = {
  'NC-GAIN-01': gain.calculateGainStructure(gainInput),
  'NC-LIM-01': limiter.calculateLimiter(limiterInput),
  'NC-SPL-01': spl.calculateSpeakerSpl({
    speaker: { sensitivityDb: 95, ratedPower: Number.MAX_VALUE }, distanceMeters: 1, speakerCount: 2,
  }),
  'NC-SPL-02': spl.calculateSplAtDistance(95, 100, 1, Infinity),
  'NC-CAM-01': camera.calculateCoverage(
    { horizontalFov: 60, verticalFov: 40, diagonalFov: 70 }, { distanceMeters: Number.MAX_VALUE },
  ),
  'NC-CAM-02': camera.calculateCoverage(
    { horizontalFov: NaN, verticalFov: Infinity, diagonalFov: NaN }, { distanceMeters: 3 },
  ),
}
function tagged(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return Number.isNaN(value) ? 'NaN' : value > 0 ? '+Infinity' : '-Infinity'
  }
  if (Array.isArray(value)) return value.map(tagged)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tagged(item)]))
  return value
}
const report = {
  status: 'PRE_FIX',
  source: 'new direct calls before production edits',
  phase1FindingSources: ['SPL-01', 'GAIN-01', 'LIM-01', 'SPL-02', 'CAM-04', 'CAM-05'],
  cases: Object.fromEntries(Object.entries(cases).map(([id, value]) => [id, { valid: value?.valid, tagged: tagged(value) }])),
}
const text = JSON.stringify(report, null, 2) + '\n'
report.sha256 = crypto.createHash('sha256').update(text).digest('hex')
fs.writeFileSync(path.join(__dirname, 'pre-fix-behavior.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ path: 'evidence/pre-fix-behavior.json', sha256: report.sha256, cases: Object.keys(cases) }, null, 2))

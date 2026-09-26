const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const gain = require(path.join(root, 'utils/gain-structure'))
const limiter = require(path.join(root, 'utils/limiter'))
const spl = require(path.join(root, 'utils/spl'))
const camera = require(path.join(root, 'utils/camera-fov'))

const gainOptions = {
  amplifier: { model: 'Baseline', stereoPower: { 4: 200 } },
  inputStage: { controlType: 'voltageGain', unit: 'dB', options: [20] },
  selectedStageValue: 20,
  mode: 'stereo',
  loadImpedance: 4,
}
const cases = {
  gainResolve: gain.resolveFullPowerInput(gainOptions),
  gainCalculate: gain.calculateGainStructure(gainOptions),
  limiter: limiter.calculateLimiter({
    amplifier: { model: 'Baseline', stereoPower: { 4: 200 } },
    speaker: { impedance: 4, ratedPower: 100 }, count: 1, wiring: 'series',
    mode: 'stereo', sensitivityVoltage: 1, highPassFrequency: 80,
  }),
  splHelper: spl.calculateSplAtDistance(95, 100, 8, -3),
  splAggregate: spl.calculateSpeakerSpl({
    speaker: { model: 'Baseline', sensitivityDb: 95, ratedPower: 100 },
    distanceMeters: 8, speakerCount: 2, summationMode: 'distributed',
  }),
  camera: camera.calculateCoverage(
    { horizontalFov: 60, verticalFov: 40, diagonalFov: 70 },
    { distanceMeters: 3 },
  ),
}
const serialized = JSON.stringify(cases, null, 2) + '\n'
const productionFiles = [
  'utils/gain-structure.js', 'utils/limiter.js', 'utils/spl.js', 'utils/camera-fov.js',
]
const baseline = {
  createdAt: new Date().toISOString(),
  validOutputs: cases,
  validOutputsSha256: crypto.createHash('sha256').update(serialized).digest('hex'),
  productionSha256: Object.fromEntries(productionFiles.map((file) => [
    file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
  ])),
}
fs.mkdirSync(path.join(__dirname, 'evidence'), { recursive: true })
fs.writeFileSync(path.join(__dirname, 'evidence/valid-output-baseline.json'), JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({
  cases: Object.keys(cases),
  validOutputsSha256: baseline.validOutputsSha256,
  sourceHashes: baseline.productionSha256,
}, null, 2))

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../..')
const gain = require(path.join(root, 'utils/gain-structure'))
const limiter = require(path.join(root, 'utils/limiter'))
const camera = require(path.join(root, 'utils/camera-fov'))
const outputs = {
  gainSensitivity: gain.calculateGainStructure({
    inputStage: { controlType: 'inputSensitivity', unit: 'dBu', options: [-10] },
    selectedStageValue: -10,
  }),
  limiterTimingUnavailable: limiter.calculateLimiter({
    amplifier: { model: 'Baseline', stereoPower: { 4: 200 } },
    speaker: { impedance: 4, ratedPower: 100 }, count: 1, wiring: 'series',
    mode: 'stereo', sensitivityVoltage: 1,
  }),
  cameraTargetWidth: camera.calculateCoverage(
    { horizontalFov: 60, verticalFov: 40, diagonalFov: 70 },
    { calculationMode: 'targetWidth', targetWidthMeters: 6 },
  ),
}
const raw = JSON.stringify(outputs, null, 2) + '\n'
const evidence = {
  createdAt: new Date().toISOString(),
  validOutputs: outputs,
  validOutputsSha256: crypto.createHash('sha256').update(raw).digest('hex'),
}
fs.writeFileSync(path.join(__dirname, 'evidence/valid-output-supplement.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ cases: Object.keys(outputs), validOutputsSha256: evidence.validOutputsSha256 }, null, 2))

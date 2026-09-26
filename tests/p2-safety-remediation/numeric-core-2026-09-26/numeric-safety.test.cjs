const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const gain = require(path.join(root, 'utils/gain-structure'))
const limiter = require(path.join(root, 'utils/limiter'))
const spl = require(path.join(root, 'utils/spl'))
const camera = require(path.join(root, 'utils/camera-fov'))
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence/valid-output-baseline.json'), 'utf8'))
const supplementalBaseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence/valid-output-supplement.json'), 'utf8'))
let passed = 0

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`)
    throw error
  }
}

function finiteLeaves(value, location = '$') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${location} is non-finite: ${value}`)
  else if (Array.isArray(value)) value.forEach((item, index) => finiteLeaves(item, `${location}[${index}]`))
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => finiteLeaves(item, `${location}.${key}`))
  }
}

function assertExplicitInvalid(result) {
  assert.equal(result?.valid, false)
  assert.equal(typeof result.warning, 'string')
  assert.ok(result.warning.length > 0)
}

const gainInput = {
  amplifier: { model: 'synthetic-negative-power', stereoPower: { 4: -100 } },
  inputStage: { controlType: 'voltageGain', unit: 'dB', options: [20] },
  selectedStageValue: 20, mode: 'stereo', loadImpedance: 4,
}
const limiterInput = {
  amplifier: { model: 'Synthetic', stereoPower: { 4: Infinity } },
  speaker: { impedance: 4, ratedPower: 100 }, count: 1, wiring: 'series',
  mode: 'stereo', sensitivityVoltage: 1,
}
const cameraFov = { horizontalFov: 60, verticalFov: 40, diagonalFov: 70 }

check('GAIN-01 malformed rated-power leaf cannot produce valid resolver/calculation results', () => {
  assertExplicitInvalid(gain.resolveFullPowerInput(gainInput))
  assertExplicitInvalid(gain.calculateGainStructure(gainInput))
})

check('GAIN exported resolver rejects finite-input underflow and calculation rejects overflow', () => {
  const sensitivityOverflow = gain.resolveFullPowerInput({
    inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [Number.MAX_VALUE] },
    selectedStageValue: Number.MAX_VALUE,
  })
  assertExplicitInvalid(sensitivityOverflow)
  const underflow = gain.resolveFullPowerInput({
    ...gainInput,
    amplifier: { model: 'Synthetic', stereoPower: { 4: 100 } },
    inputStage: { controlType: 'voltageGain', unit: 'dB', options: [10000] },
    selectedStageValue: 10000,
  })
  assertExplicitInvalid(underflow)
  const overflow = gain.calculateGainStructure({
    ...gainInput,
    amplifier: { model: 'Synthetic', stereoPower: { 4: Number.MAX_VALUE } },
    inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [1] },
    selectedStageValue: 1,
    dspMaxOutputDbu: Number.MAX_VALUE,
  })
  assertExplicitInvalid(overflow)
})

check('LIM-01 and finite-input derived overflow cannot return valid limiter results', () => {
  assertExplicitInvalid(limiter.calculateLimiter(limiterInput))
  const overflow = limiter.calculateLimiter({
    amplifier: { model: 'Synthetic', stereoPower: { 8: Number.MAX_VALUE } },
    speaker: { impedance: 4, ratedPower: Number.MAX_VALUE }, count: 2, wiring: 'series',
    mode: 'stereo', sensitivityVoltage: 1,
  })
  assertExplicitInvalid(overflow)
})

check('SPL-01 aggregate overflow is explicit non-success', () => {
  const result = spl.calculateSpeakerSpl({
    speaker: { model: 'Synthetic', sensitivityDb: 95, ratedPower: Number.MAX_VALUE },
    distanceMeters: 1, speakerCount: 2,
  })
  assert.equal(result, null)
})

check('SPL-02/03 non-finite summation gain is explicit non-success while signed gain remains valid', () => {
  assert.equal(spl.calculateSplAtDistance(95, 100, 1, Infinity), null)
  assert.equal(spl.calculateSplAtDistance(95, 100, 1, NaN), null)
  const signed = spl.calculateSplAtDistance(-12, 100, 4, -3)
  assert.ok(signed)
  finiteLeaves(signed)
  assert.ok(spl.calculateSplAtDistance(95, 100, 1, 0))
  assert.equal(spl.buildDistanceRows(95, 100, 1, Infinity), null)
  assert.deepEqual(spl.buildDistanceRows(95, 100, 1), spl.buildDistanceRows(95, 100, 1, 0))
})

check('CAM-04/05 overflow and malformed FOV cannot produce coverage results', () => {
  assert.equal(camera.calculateCoverage(cameraFov, { distanceMeters: Number.MAX_VALUE }), null)
  assert.equal(camera.calculateCoverage(
    { horizontalFov: NaN, verticalFov: Infinity, diagonalFov: NaN },
    { distanceMeters: 3 },
  ), null)
})

check('valid finite snapshots remain byte-for-byte stable', () => {
  const current = {
    gainResolve: gain.resolveFullPowerInput({
      amplifier: { model: 'Baseline', stereoPower: { 4: 200 } },
      inputStage: { controlType: 'voltageGain', unit: 'dB', options: [20] },
      selectedStageValue: 20, mode: 'stereo', loadImpedance: 4,
    }),
    gainCalculate: gain.calculateGainStructure({
      amplifier: { model: 'Baseline', stereoPower: { 4: 200 } },
      inputStage: { controlType: 'voltageGain', unit: 'dB', options: [20] },
      selectedStageValue: 20, mode: 'stereo', loadImpedance: 4,
    }),
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
    camera: camera.calculateCoverage(cameraFov, { distanceMeters: 3 }),
  }
  const serialized = JSON.stringify(current, null, 2) + '\n'
  assert.equal(crypto.createHash('sha256').update(serialized).digest('hex'), baseline.validOutputsSha256)
  assert.equal(JSON.stringify(current), JSON.stringify(baseline.validOutputs))
  finiteLeaves(current)

  const supplemental = {
    gainSensitivity: gain.calculateGainStructure({
      inputStage: { controlType: 'inputSensitivity', unit: 'dBu', options: [-10] },
      selectedStageValue: -10,
    }),
    limiterTimingUnavailable: limiter.calculateLimiter({
      amplifier: { model: 'Baseline', stereoPower: { 4: 200 } },
      speaker: { impedance: 4, ratedPower: 100 }, count: 1, wiring: 'series',
      mode: 'stereo', sensitivityVoltage: 1,
    }),
    cameraTargetWidth: camera.calculateCoverage(cameraFov, {
      calculationMode: 'targetWidth', targetWidthMeters: 6,
    }),
  }
  const supplementalSerialized = JSON.stringify(supplemental, null, 2) + '\n'
  assert.equal(
    crypto.createHash('sha256').update(supplementalSerialized).digest('hex'),
    supplementalBaseline.validOutputsSha256,
  )
  assert.equal(JSON.stringify(supplemental), JSON.stringify(supplementalBaseline.validOutputs))
  finiteLeaves(supplemental)
})

check('finite diagonal FOV is accepted without an extra 179-degree restriction', () => {
  const nearLimitFov = camera.resolveCustomFov({ horizontalFov: 178.9, verticalFov: 178.9 })
  assert.ok(nearLimitFov.diagonalFov > 179)
  const result = camera.calculateCoverage(nearLimitFov, { distanceMeters: 3 })
  assert.ok(result)
  assert.ok(Number.isFinite(result.diagonalFov))
})

check('CAM-03 tiny positive distance keeps the frozen 0 m display behavior', () => {
  const result = camera.calculateCoverage(cameraFov, { distanceMeters: Number.MIN_VALUE })
  assert.equal(result.distanceMeters, 0)
})

console.log(`Numeric safety remediation: ${passed} checks passed`)

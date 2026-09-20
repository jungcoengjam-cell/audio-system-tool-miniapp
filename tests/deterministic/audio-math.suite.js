'use strict'

const { calculateLimiter, calculateTiming } = require('../../utils/limiter')
const { calculateSpeakerSpl, calculateSplAtDistance, getSummationGainDb } = require('../../utils/spl')
const { calculateConstantVoltageCable, calculateProfessionalSpeakerCable } = require('../../utils/cable')
const {
  calculateGainStructure,
  dbuToVoltage,
  resolveStageValue,
  voltageToDbu,
} = require('../../utils/gain-structure')
const { amplifiers, speakers } = require('../../data/equipment')
const { amplifierInputStages } = require('../../data/amplifier-input-stages')

const referenceAmplifier = { model: 'reference', stereoPower: { 2: 200, 4: 100, 8: 200 }, bridgePower: { 4: 400 } }
const referenceSpeaker = { model: 'reference', impedance: 4, ratedPower: 100, sensitivityDb: 90 }

module.exports = ({ test, assert, close, finiteTree }) => {
  test('limiter matches an independent 0 dBu and dBFS golden case', () => {
    const result = calculateLimiter({
      amplifier: referenceAmplifier,
      speaker: referenceSpeaker,
      count: 1,
      wiring: 'parallel',
      mode: 'stereo',
      sensitivityVoltage: 0.775,
    })
    assert.equal(result.valid, true)
    close(result.speakerAllowedVoltage, 20)
    close(result.amplifierRatedVoltage, 20)
    close(result.limiterInputVoltage, 0.775)
    close(result.limiterInputDbu, 0)
    close(result.thresholdDbfs, -18.4)
    assert.equal(result.limitedBy, 'speaker')
    finiteTree(result)
  }, { classification: 'implementation bug', basis: 'docs/calculation.md §4–9; utils/limiter.js calculateLimiter' })

  test('limiter preserves power across series and parallel load invariants', () => {
    const parallel = calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count: 2, wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1 })
    const series = calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count: 2, wiring: 'series', mode: 'stereo', sensitivityVoltage: 1 })
    assert.equal(parallel.valid, true)
    assert.equal(series.valid, true)
    assert.equal(parallel.loadImpedance, 2)
    assert.equal(series.loadImpedance, 8)
    close(parallel.amplifierRatedVoltage, 20)
    close(parallel.speakerAllowedVoltage, 20)
    close(series.amplifierRatedVoltage, 40)
    close(series.speakerAllowedVoltage, 40)
    const bridge = calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count: 1, wiring: 'parallel', mode: 'bridge', sensitivityVoltage: 0.775 })
    assert.equal(bridge.valid, true)
    assert.equal(bridge.amplifierRatedPower, 400)
    close(bridge.amplifierRatedVoltage, 40)
    close(bridge.targetOutputVoltage, 20)
  }, { classification: 'implementation bug', basis: 'docs/calculation.md §2, §5; utils/limiter.js findRatedPower' })

  test('limiter rejects negative speaker rated power instead of returning valid NaN results', () => {
    const result = calculateLimiter({ amplifier: referenceAmplifier, speaker: { ...referenceSpeaker, ratedPower: -1 }, count: 1, wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1 })
    assert.equal(result.valid, false)
  }, { classification: 'implementation bug', basis: 'utils/limiter.js calculateLimiter input validation', issue: 'AUDIO-LIMITER-NEGATIVE-POWER' })

  test('limiter rejects nonpositive or noninteger speaker counts', () => {
    for (const count of [0, -1, 1.5]) {
      assert.equal(calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count, wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1 }).valid, false)
    }
  }, { classification: 'implementation bug', basis: 'utils/limiter.js calculateLimiter input validation' })

  test('limiter rejects missing amplifier or speaker records', () => {
    assert.equal(calculateLimiter({ speaker: referenceSpeaker, count: 1, sensitivityVoltage: 1 }).valid, false)
    assert.equal(calculateLimiter({ amplifier: referenceAmplifier, count: 1, sensitivityVoltage: 1 }).valid, false)
  }, { classification: 'implementation bug', basis: 'utils/limiter.js calculateLimiter input validation' })

  test('limiter rejects zero speaker impedance', () => {
    const amplifierWithInvalidZeroOhmData = { ...referenceAmplifier, stereoPower: { ...referenceAmplifier.stereoPower, 0: 100 } }
    assert.equal(calculateLimiter({ amplifier: amplifierWithInvalidZeroOhmData, speaker: { ...referenceSpeaker, impedance: 0 }, count: 1, sensitivityVoltage: 1 }).valid, false)
  }, { classification: 'implementation bug', basis: 'utils/limiter.js calculateLimiter input validation', issue: 'AUDIO-LIMITER-ZERO-IMPEDANCE' })

  test('limiter rejects zero speaker rated power', () => {
    assert.equal(calculateLimiter({ amplifier: referenceAmplifier, speaker: { ...referenceSpeaker, ratedPower: 0 }, count: 1, sensitivityVoltage: 1 }).valid, false)
  }, { classification: 'implementation bug', basis: 'utils/limiter.js calculateLimiter input validation', issue: 'AUDIO-LIMITER-ZERO-POWER' })

  test('limiter rejects nonpositive and nonfinite speaker power and impedance domains', () => {
    for (const ratedPower of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(calculateLimiter({ amplifier: referenceAmplifier, speaker: { ...referenceSpeaker, ratedPower }, count: 1, wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1 }).valid, false, `ratedPower=${ratedPower}`)
    }
    for (const impedance of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(calculateLimiter({ amplifier: referenceAmplifier, speaker: { ...referenceSpeaker, impedance }, count: 1, wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 1 }).valid, false, `impedance=${impedance}`)
    }
  }, { classification: 'implementation bug', basis: 'utils/limiter.js calculateLimiter requires finite positive rated power and impedance' })

  test('limiter rejects zero or nonfinite input sensitivity', () => {
    for (const sensitivityVoltage of [0, -1, NaN, Infinity]) {
      assert.equal(calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count: 1, wiring: 'parallel', mode: 'stereo', sensitivityVoltage }).valid, false)
    }
  }, { classification: 'implementation bug', basis: 'utils/limiter.js calculateLimiter input validation' })

  test('HPF timing bands retain the implemented inclusive upper bounds', () => {
    const boundaries = [
      [31, 45, 16], [63, 16, 8], [125, 8, 4], [250, 4, 2],
      [500, 2, 1], [1000, 1, 0.5], [2000, 0.5, 0.3],
    ]
    for (const [frequency, atOrBelow, above] of boundaries) {
      for (const [value, attack] of [[frequency - 0.001, atOrBelow], [frequency, atOrBelow], [frequency + 0.001, above]]) {
        const timing = calculateTiming(value)
        assert.equal(timing.attackTimeMs, attack, `${value} Hz attack`)
        assert.equal(timing.releaseTimeMs, attack * 16, `${value} Hz release`)
      }
    }
  }, { classification: 'engineering-rule ambiguity', basis: 'docs/calculation.md §11 labels “1–2 kHz” and “≥2 kHz” overlap at 2 kHz; utils/limiter.js calculateTiming' })

  test('limiter timing is absent for zero, negative, or nonfinite HPF without invalidating the threshold', () => {
    for (const highPassFrequency of [0, -1, NaN, Infinity, null]) {
      const result = calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count: 1, wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 0.775, highPassFrequency })
      assert.equal(result.valid, true)
      assert.equal(result.timingReady, false)
      assert.equal(result.attackTimeMs, undefined)
      close(result.thresholdDbfs, -18.4)
    }
  }, { classification: 'implementation bug', basis: 'docs/calculation.md §11; utils/limiter.js calculateLimiter' })

  test('SPL matches an independent rated-power and inverse-distance golden case', () => {
    const atTenMeters = calculateSplAtDistance(90, 100, 10)
    assert.equal(atTenMeters.oneMeterSpl, 110)
    assert.equal(atTenMeters.spl, 90)
    finiteTree(atTenMeters)
  }, { classification: 'implementation bug', basis: 'docs/spl-calculation.md §2; utils/spl.js calculateSplAtDistance' })

  test('SPL summation gains are 3 dB distributed and 6 dB coherent for two speakers', () => {
    close(getSummationGainDb(2, 'distributed'), 3)
    close(getSummationGainDb(2, 'coherent'), 6)
    const distributed = calculateSpeakerSpl({ speaker: referenceSpeaker, distanceMeters: 10, speakerCount: 2, summationMode: 'distributed' })
    const coherent = calculateSpeakerSpl({ speaker: referenceSpeaker, distanceMeters: 10, speakerCount: 2, summationMode: 'coherent' })
    close(distributed.selectedSpl, 93)
    close(coherent.selectedSpl, 96)
    assert.equal(coherent.totalRatedPower, 200)
  }, { classification: 'implementation bug', basis: 'docs/spl-calculation.md §3; utils/spl.js calculateSpeakerSpl' })

  test('SPL zero rated power is rejected instead of emitting negative infinity', () => {
    const result = calculateSplAtDistance(90, 0, 1)
    assert.equal(result, null)
  }, { classification: 'implementation bug', basis: 'utils/spl.js calculateSplAtDistance positive-power domain', issue: 'AUDIO-SPL-ZERO-POWER' })

  test('SPL negative rated power is rejected instead of emitting NaN', () => {
    assert.equal(calculateSplAtDistance(90, -1, 1), null)
  }, { classification: 'implementation bug', basis: 'utils/spl.js calculateSplAtDistance positive-power domain', issue: 'AUDIO-SPL-NEGATIVE-POWER' })

  test('SPL rejects nonpositive and nonfinite rated power in both calculation entry points', () => {
    for (const ratedPower of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(calculateSplAtDistance(90, ratedPower, 1), null, `ratedPower=${ratedPower}`)
    }
    for (const ratedPower of [0, -1]) {
      assert.equal(calculateSpeakerSpl({ speaker: { ...referenceSpeaker, ratedPower }, distanceMeters: 1 }), null, `ratedPower=${ratedPower}`)
    }
  }, { classification: 'implementation bug', basis: 'utils/spl.js calculateSplAtDistance/calculateSpeakerSpl require finite positive rated power' })

  test('SPL rejects invalid distance and speaker count inputs', () => {
    for (const distanceMeters of [0, 0.99, -1, NaN, Infinity]) assert.equal(calculateSplAtDistance(90, 100, distanceMeters), null)
    for (const speakerCount of [0, -1, 1.5]) assert.equal(getSummationGainDb(speakerCount, 'distributed'), null)
  }, { classification: 'implementation bug', basis: 'docs/spl-calculation.md §2–3; utils/spl.js calculateSplAtDistance/getSummationGainDb' })

  test('SPL changes by -20 dB for tenfold distance and +10 dB for tenfold power', () => {
    const base = calculateSplAtDistance(90, 10, 2).spl
    const tenfoldDistance = calculateSplAtDistance(90, 10, 20).spl
    const tenfoldPower = calculateSplAtDistance(90, 100, 2).spl
    close(tenfoldDistance - base, -20)
    close(tenfoldPower - base, 10)
  }, { classification: 'implementation bug', basis: 'docs/spl-calculation.md §2; utils/spl.js calculateSplAtDistance' })

  test('SPL core accepts distances above the page 1000 m input cap as a mathematical estimate', () => {
    const result = calculateSplAtDistance(90, 100, 1001)
    assert.equal(result.spl, 50)
    finiteTree(result)
  }, { classification: 'engineering-rule ambiguity', basis: 'docs/spl-calculation.md §2 identifies 1–1000 m as first-version input scope; core helper has no product-domain cap' })

  test('constant-voltage cable follows the table bracket and reports its formula floor', () => {
    const result = calculateConstantVoltageCable({ totalPowerW: 100, distanceMeters: 100, environment: 'indoor' })
    assert.equal(result.designPowerW, 150)
    assert.equal(result.distanceBracket, '100 m')
    assert.equal(result.powerBracket, '250 W')
    assert.equal(result.selectedArea, 0.5)
    close(result.formulaMinimumArea, 0.08)
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md; utils/cable.js calculateConstantVoltageCable' })

  test('constant-voltage cable selects every distance bracket at the exact edge and just above it', () => {
    const expected = [
      [100, '100 m', 0.5, '250 m', 0.75],
      [250, '250 m', 0.75, '500 m', 1],
      [500, '500 m', 1, '750 m', 1.5],
      [750, '750 m', 1.5, '1000 m', 2],
      [1000, '1000 m', 2, null, null],
    ]
    for (const [edge, bracket, area, nextBracket, nextArea] of expected) {
      const atEdge = calculateConstantVoltageCable({ totalPowerW: 200, distanceMeters: edge, environment: 'indoor' })
      assert.equal(atEdge.distanceBracket, bracket)
      assert.equal(atEdge.selectedArea, area)
      if (nextBracket) {
        const aboveEdge = calculateConstantVoltageCable({ totalPowerW: 200, distanceMeters: edge + 0.001, environment: 'indoor' })
        assert.equal(aboveEdge.distanceBracket, nextBracket)
        assert.equal(aboveEdge.selectedArea, nextArea)
      } else {
        assert.ok(calculateConstantVoltageCable({ totalPowerW: 200, distanceMeters: edge + 0.001, environment: 'indoor' }).error)
      }
    }
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md distance bracket rules; utils/cable.js calculateConstantVoltageCable' })

  test('outdoor constant-voltage cable rounds up to the next standard area', () => {
    const indoor = calculateConstantVoltageCable({ totalPowerW: 200, distanceMeters: 500, environment: 'indoor' })
    const outdoor = calculateConstantVoltageCable({ totalPowerW: 200, distanceMeters: 500, environment: 'outdoor' })
    assert.equal(indoor.selectedArea, 1)
    assert.equal(outdoor.indoorArea, 1)
    assert.equal(outdoor.selectedArea, 2)
    assert.equal(outdoor.isWithinStandard, true)
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md outdoor cable rule; utils/cable.js findStandardArea' })

  test('outdoor constant-voltage cable rounds a 2 mm² indoor selection upward to 4 mm²', () => {
    const indoor = calculateConstantVoltageCable({ totalPowerW: 200, distanceMeters: 1000, environment: 'indoor' })
    const outdoor = calculateConstantVoltageCable({ totalPowerW: 200, distanceMeters: 1000, environment: 'outdoor' })
    assert.equal(indoor.selectedArea, 2)
    assert.equal(outdoor.indoorArea, 2)
    assert.equal(outdoor.selectedArea, 4)
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md outdoor cable rule; utils/cable.js findStandardArea' })

  test('constant-voltage formula independently converts watts to kW and meters to km above table power', () => {
    const result = calculateConstantVoltageCable({ totalPowerW: 2000, distanceMeters: 500, environment: 'indoor' })
    // 2000 W × 1.5 = 3000 W = 3 kW; 500 m = 0.5 km; 3 × 0.5 × 5 = 7.5 mm².
    assert.equal(result.designPowerW, 3000)
    assert.equal(result.formulaMinimumArea, 7.5)
    assert.equal(result.selectedArea, 10)
    assert.equal(result.isWithinStandard, false)
    assert.equal(result.status, '需工程复核')
    assert.ok(result.warnings.some((warning) => warning.includes('超过公司表格的 1500 W 上限')))
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md company formula and over-1500 W rule; utils/cable.js calculateConstantVoltageCable' })

  test('professional speaker cable table boundaries choose the first sufficient row', () => {
    const rowInputs = [[50 / 1.5, 50, 0.8], [200, 300, 1.6], [400, 600, 2.4], [800 / 1.5, 800, 3.2], [1000, 1500, 4]]
    for (const [power, designPower, area] of rowInputs) {
      const result = calculateProfessionalSpeakerCable({ totalPowerW: power, distanceMeters: 100 })
      assert.equal(result.designPowerW, designPower)
      assert.equal(result.selectedArea, area)
    }
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md professional cable rules; utils/cable.js calculateProfessionalSpeakerCable' })

  test('professional speaker cable changes table rows just below and above each rounded power threshold', () => {
    const boundaries = [[50, 0.8, 0.8, 1.6], [300, 1.6, 1.6, 2.4], [600, 2.4, 2.4, 3.2], [800, 3.2, 3.2, 4], [1500, 4, 4, 0]]
    for (const [boundary, belowArea, exactArea, aboveArea] of boundaries) {
      const belowPower = (boundary - 0.06) / 1.5 // ×1.5 gives x.94, which rounds to boundary - 0.1 W.
      const abovePower = (boundary + 0.06) / 1.5 // ×1.5 gives x.06, which rounds to boundary + 0.1 W.
      assert.equal(calculateProfessionalSpeakerCable({ totalPowerW: belowPower, distanceMeters: 10 }).selectedArea, belowArea, `${boundary} W below`)
      assert.equal(calculateProfessionalSpeakerCable({ totalPowerW: boundary / 1.5, distanceMeters: 10 }).selectedArea, exactArea, `${boundary} W exact`)
      assert.equal(calculateProfessionalSpeakerCable({ totalPowerW: abovePower, distanceMeters: 10 }).selectedArea, aboveArea, `${boundary} W above`)
    }
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md professional power rows; utils/cable.js one-decimal design-power rounding' })

  test('professional cable over 100 m flags review and keeps the power-selected row', () => {
    const within = calculateProfessionalSpeakerCable({ totalPowerW: 30, distanceMeters: 100 })
    assert.equal(within.selectedArea, 0.8)
    assert.equal(within.isWithinStandard, true)
    const over = calculateProfessionalSpeakerCable({ totalPowerW: 30, distanceMeters: 101 })
    assert.equal(over.isWithinStandard, false)
    assert.equal(over.selectedArea, 0.8)
    assert.equal(over.warnings.length, 1)
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md professional cable rules; utils/cable.js calculateProfessionalSpeakerCable' })

  test('constant-voltage power brackets use raw design power while displayed power remains rounded', () => {
    const result = calculateConstantVoltageCable({ totalPowerW: 40.02, distanceMeters: 500, environment: 'indoor' })
    assert.equal(result.designPowerW, 60)
    assert.equal(result.powerBracket, '120 W')
    assert.equal(result.selectedArea, 0.75)
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md requires unrounded design power for bracket selection; utils/cable.js rounds display only', issue: 'AUDIO-CABLE-DESIGN-ROUNDING' })

  test('constant-voltage raw design power selects every table threshold exactly, below, and above', () => {
    const thresholds = [60, 120, 250, 350, 450, 650, 1000, 1500]
    const nextThresholds = [120, 250, 350, 450, 650, 1000, 1500, null]
    for (let index = 0; index < thresholds.length; index += 1) {
      const threshold = thresholds[index]
      const bracketAtOrBelow = `${threshold} W`
      const below = calculateConstantVoltageCable({ totalPowerW: (threshold - 0.001) / 1.5, distanceMeters: 100, environment: 'indoor' })
      const exact = calculateConstantVoltageCable({ totalPowerW: threshold / 1.5, distanceMeters: 100, environment: 'indoor' })
      const above = calculateConstantVoltageCable({ totalPowerW: (threshold + 0.001) / 1.5, distanceMeters: 100, environment: 'indoor' })
      assert.equal(below.powerBracket, bracketAtOrBelow, `${threshold} W below`)
      assert.equal(exact.powerBracket, bracketAtOrBelow, `${threshold} W exact`)
      if (threshold === 1500) {
        assert.equal(above.status, '需工程复核', 'above 1500 W must enter review')
        assert.ok(above.warnings.some((warning) => warning.includes('超过公司表格的 1500 W 上限')))
      } else {
        assert.equal(above.powerBracket, `${nextThresholds[index]} W`, `${threshold} W above`)
      }
    }
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md raw design-power threshold policy and independent company table constants; utils/cable.js calculateConstantVoltageCable' })

  test('constant-voltage formula selects standard areas from raw formula values', () => {
    const atEight = calculateConstantVoltageCable({ totalPowerW: 8 * 200 / 1.5, distanceMeters: 1000, environment: 'indoor' })
    const justBelowTen = calculateConstantVoltageCable({ totalPowerW: 9.996 * 200 / 1.5, distanceMeters: 1000, environment: 'indoor' })
    const atTen = calculateConstantVoltageCable({ totalPowerW: 10 * 200 / 1.5, distanceMeters: 1000, environment: 'indoor' })
    const justAboveTen = calculateConstantVoltageCable({ totalPowerW: 10.004 * 200 / 1.5, distanceMeters: 1000, environment: 'indoor' })
    assert.equal(atEight.formulaMinimumArea, 8)
    assert.equal(atEight.selectedArea, 10)
    assert.equal(justBelowTen.formulaMinimumArea, 10)
    assert.equal(justBelowTen.selectedArea, 10)
    assert.equal(atTen.formulaMinimumArea, 10)
    assert.equal(atTen.selectedArea, 10)
    assert.equal(justAboveTen.formulaMinimumArea, 10)
    assert.equal(justAboveTen.selectedArea, 0, 'raw requirement above 10 mm² must not select an undersized 10 mm² cable')
    assert.equal(justAboveTen.status, '需工程复核')
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md raw formula minimum controls standard-area ceiling; independent S=(P/1000)*(L/1000)*5' })

  test('cable calculators reject nonpositive and nonfinite required measurements', () => {
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      assert.ok(calculateConstantVoltageCable({ totalPowerW: value, distanceMeters: 10 }).error)
      assert.ok(calculateProfessionalSpeakerCable({ totalPowerW: value, distanceMeters: 10 }).error)
      assert.ok(calculateProfessionalSpeakerCable({ totalPowerW: 10, distanceMeters: value }).error)
    }
    assert.ok(calculateConstantVoltageCable({ totalPowerW: 10, distanceMeters: 1001 }).error)
  }, { classification: 'implementation bug', basis: 'docs/cable-selection.md boundaries; utils/cable.js cable input validation' })

  test('dBu and Vrms conversions round-trip with the 0.775 V reference', () => {
    close(voltageToDbu(0.775), 0)
    close(dbuToVoltage(0), 0.775)
    close(voltageToDbu(1), 20 * Math.log10(1 / 0.775))
    close(dbuToVoltage(20 * Math.log10(1 / 0.775)), 1)
    close(dbuToVoltage(8.2), 0.775 * (10 ** (8.2 / 20)))
  }, { classification: 'implementation bug', basis: 'docs/gain-structure-calculation.md §1–2; utils/gain-structure.js voltageToDbu/dbuToVoltage' })

  test('gain structure matches the independent DSP alignment arithmetic', () => {
    const result = calculateGainStructure({
      inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [0.775], defaultValue: 0.775 },
    })
    assert.equal(result.valid, true)
    close(result.fullPowerInputDbu, 0)
    close(result.targetDspOutputDbu, 12.4)
    close(result.recommendedAttenuationDb, 12.4)
    close(result.naturalFullPowerDbfs, -18.4)
    close(result.alignedFullPowerDbfs, -6)
    finiteTree(result)
  }, { classification: 'implementation bug', basis: 'docs/gain-structure-calculation.md §1–5; utils/gain-structure.js calculateGainStructure' })

  test('gain structure rejects zero input voltage rather than returning a valid infinite result', () => {
    const result = calculateGainStructure({ inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [0], defaultValue: 0 } })
    assert.equal(result.valid, false)
  }, { classification: 'implementation bug', basis: 'utils/gain-structure.js resolveFullPowerInput requires a positive physical voltage', issue: 'AUDIO-GAIN-ZERO-VOLTAGE' })

  test('gain structure rejects negative input voltage rather than returning a valid NaN result', () => {
    const result = calculateGainStructure({ inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [-1], defaultValue: -1 } })
    assert.equal(result.valid, false)
  }, { classification: 'implementation bug', basis: 'utils/gain-structure.js resolveFullPowerInput requires a positive physical voltage', issue: 'AUDIO-GAIN-NEGATIVE-VOLTAGE' })

  test('gain structure rejects nonpositive or nonfinite converted sensitivity voltage but accepts valid negative dBu', () => {
    for (const dbu of [-10000, NaN, Infinity, -Infinity]) {
      const result = calculateGainStructure({ inputStage: { controlType: 'inputSensitivity', unit: 'dBu', options: [dbu], defaultValue: dbu } })
      assert.equal(result.valid, false, `dBu=${dbu}`)
    }
    for (const dbu of [-6, 0]) {
      const result = calculateGainStructure({ inputStage: { controlType: 'inputSensitivity', unit: 'dBu', options: [dbu], defaultValue: dbu } })
      const expectedVoltage = 0.775 * (10 ** (dbu / 20))
      assert.equal(result.valid, true, `${dbu} dBu is a valid sensitivity`)
      close(result.fullPowerInputVoltage, expectedVoltage, 0.0005)
      close(result.fullPowerInputDbu, dbu)
      finiteTree(result)
      if (dbu === -6) close(result.recommendedAttenuationDb, 18.4)
    }
  }, { classification: 'implementation bug', basis: 'utils/gain-structure.js inputSensitivity must validate converted physical voltage; dBu-to-voltage uses 0.775*10^(dBu/20)' })

  test('voltage-gain amplifier back-calculates rated input from independent output voltage', () => {
    const result = calculateGainStructure({
      amplifier: { model: 'reference', stereoPower: { 4: 100 } },
      inputStage: { controlType: 'voltageGain', unit: 'dB', options: [20] },
      selectedStageValue: 20,
      mode: 'stereo',
      loadImpedance: 4,
    })
    assert.equal(result.valid, true)
    close(result.amplifierRatedVoltage, 20)
    close(result.fullPowerInputVoltage, 2)
    close(result.fullPowerInputDbu, 8.23)
    finiteTree(result)
  }, { classification: 'implementation bug', basis: 'docs/gain-structure-calculation.md §2.2; utils/gain-structure.js resolveFullPowerInput' })

  test('gain alignment applies the 0.05 dB deadband on each side', () => {
    const run = (fullPowerInputDbu) => calculateGainStructure({
      inputStage: { controlType: 'inputSensitivity', unit: 'dBu', options: [fullPowerInputDbu] },
      selectedStageValue: fullPowerInputDbu,
    })
    assert.equal(run(12.349).alignmentMode, 'attenuate') // 0.051 dB above threshold.
    assert.equal(run(12.351).alignmentMode, 'direct') // 0.049 dB above threshold.
    assert.equal(run(12.449).alignmentMode, 'direct') // 0.049 dB below threshold.
    assert.equal(run(12.451).alignmentMode, 'insufficientDrive') // 0.051 dB below threshold.
  }, { classification: 'implementation bug', basis: 'utils/gain-structure.js ALIGNMENT_TOLERANCE_DB' })

  test('gain structure validates stage choices and digital input boundaries', () => {
    assert.equal(resolveStageValue({ options: [1, 2] }, undefined).valid, false)
    assert.equal(resolveStageValue({ options: [1, 2] }, 3).valid, false)
    for (const targetPeakDbfs of [1, NaN, Infinity]) {
      assert.equal(calculateGainStructure({ inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [1], defaultValue: 1 }, targetPeakDbfs }).valid, false)
    }
    assert.equal(calculateGainStructure({ inputStage: { controlType: 'inputSensitivity', unit: 'V', options: [1], defaultValue: 1 }, programHeadroomDb: 0 }).valid, false)
  }, { classification: 'implementation bug', basis: 'docs/gain-structure-calculation.md §3–5; utils/gain-structure.js resolveStageValue/calculateGainStructure' })

  test('unknown limiter enum values currently follow the documented code fallback paths', () => {
    const unknownMode = calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count: 1, wiring: 'parallel', mode: 'unknown', sensitivityVoltage: 0.775 })
    const stereo = calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count: 1, wiring: 'parallel', mode: 'stereo', sensitivityVoltage: 0.775 })
    const unknownWiring = calculateLimiter({ amplifier: referenceAmplifier, speaker: referenceSpeaker, count: 2, wiring: 'unknown', mode: 'stereo', sensitivityVoltage: 1 })
    assert.equal(unknownMode.valid, stereo.valid)
    close(unknownMode.thresholdDbfs, stereo.thresholdDbfs)
    assert.equal(unknownWiring.loadImpedance, 8) // Current helper falls through to series for non-parallel values.
    assert.equal(calculateSpeakerSpl({ speaker: referenceSpeaker, distanceMeters: 1, summationMode: 'unknown' }).summationGainDb, 0)
  }, { classification: 'engineering-rule ambiguity', basis: 'utils/limiter.js calculateLimiter/getLoadImpedance and utils/spl.js getSummationGainDb; enum validation/default policy is not specified by calculation docs' })

  test('amplifier and speaker product data used by audio math has valid numeric calculation inputs', () => {
    assert.ok(amplifiers.length > 0)
    assert.ok(speakers.length > 0)
    for (const amplifier of amplifiers) {
      for (const tableName of ['stereoPower', 'bridgePower']) {
        const table = amplifier[tableName]
        if (!table) continue
        for (const [load, power] of Object.entries(table)) {
          assert.ok(Number.isFinite(Number(load)) && Number(load) > 0, `${amplifier.model} ${tableName} load ${load}`)
          assert.ok(Number.isFinite(power) && power > 0, `${amplifier.model} ${tableName} power ${load}`)
        }
      }
    }
    for (const speaker of speakers) {
      if (speaker.calculationDisabled) continue
      assert.ok(Number.isFinite(speaker.impedance) && speaker.impedance > 0, `${speaker.model} impedance`)
      assert.ok(Number.isFinite(speaker.ratedPower) && speaker.ratedPower > 0, `${speaker.model} ratedPower`)
      if (speaker.sensitivityDb !== undefined) assert.ok(Number.isFinite(speaker.sensitivityDb), `${speaker.model} sensitivityDb`)
    }
    for (const [model, stage] of Object.entries(amplifierInputStages)) {
      assert.ok(stage.options.length > 0, `${model} stage options`)
      assert.ok(['inputSensitivity', 'voltageGain'].includes(stage.controlType), `${model} controlType`)
      assert.ok(['V', 'dBu', 'dB'].includes(stage.unit), `${model} unit`)
      assert.ok(stage.options.every(Number.isFinite), `${model} numeric stage options`)
      if (stage.defaultValue !== undefined) assert.ok(stage.options.includes(stage.defaultValue), `${model} default stage`)
    }
  }, { classification: 'implementation bug', basis: 'tests/release-check.js product input invariants; data/equipment.js and data/amplifier-input-stages.js' })

  test('SPL-enabled product data has sensitivity and missing-sensitivity speakers stay unavailable for SPL only', () => {
    for (const speaker of speakers) {
      if (speaker.calculationDisabled) continue
      if (speaker.sensitivityDb === undefined) {
        assert.equal(calculateSpeakerSpl({ speaker, distanceMeters: 1 }), null, `${speaker.model} without sensitivity must not produce SPL`)
      } else {
        assert.ok(Number.isFinite(speaker.sensitivityDb), `${speaker.model} SPL sensitivity`)
        assert.ok(calculateSpeakerSpl({ speaker, distanceMeters: 1 }), `${speaker.model} with sensitivity should calculate SPL`)
      }
    }
  }, { classification: 'implementation bug', basis: 'docs/spl-calculation.md §1, §5; utils/spl.js calculateSpeakerSpl and data/equipment.js' })
}

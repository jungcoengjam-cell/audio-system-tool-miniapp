'use strict'

const fs = require('node:fs')
const path = require('node:path')
const led = require('../../utils/led-screen')

const input = {
  wallWidthMeters: 6,
  wallHeightMeters: 3,
  topReserveMeters: 0.2,
  bottomReserveMeters: 0.2,
  frameWidthMeters: 0.05,
  viewingDistanceMeters: 2,
  unitKey: 'module',
  aspectRatioKey: '16:9',
  pixelPitch: 'recommended',
}
const result = led.calculateLedScreenPlan(input)
const baseline = {
  capturedAt: new Date().toISOString(),
  source: 'utils/led-screen.js calculateLedScreenPlan',
  input,
  options: {
    aspectRatios: led.LED_ASPECT_RATIOS,
    units: Object.values(led.LED_UNIT_SPECS),
    fixedPitches: led.LED_PIXEL_PITCHES,
    pitchModes: [...led.LED_PIXEL_PITCHES.map((value) => ({ value, label: `P${value}` })),
      { value: 'recommended', label: '系统推荐' }],
    counts: {
      aspectRatios: led.LED_ASPECT_RATIOS.length,
      units: Object.keys(led.LED_UNIT_SPECS).length,
      pitchSelections: led.LED_PIXEL_PITCHES.length + 1,
    },
  },
  result,
  assessment: result && {
    recommendation: `自动推荐 ${result.pitchText}`,
    viewingDistanceStatus: result.statusLabel,
    viewingDistanceText: result.statusText,
    comfortableRangeText: result.comfortableRangeText,
  },
}
const out = path.join(__dirname, 'baseline', 'led-sample-6x3.json')
fs.writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ output: path.relative(process.cwd(), out), input, counts: baseline.options.counts, result, assessment: baseline.assessment }, null, 2)}\n`)

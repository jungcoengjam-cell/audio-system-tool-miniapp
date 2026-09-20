const assert = require('assert')
const {
  LED_ASPECT_RATIOS,
  LED_UNIT_SPECS,
  PREFERRED_RATIO_ERROR,
  calculateLedScreenPlan,
} = require('../utils/led-screen')

function buildInput(overrides = {}) {
  return {
    wallWidthMeters: 3,
    wallHeightMeters: 2.4,
    topReserveMeters: 0,
    bottomReserveMeters: 0,
    frameWidthMeters: 0,
    viewingDistanceMeters: 3,
    aspectRatioKey: '16:9',
    unitKey: 'module',
    pixelPitch: 'recommended',
    ...overrides,
  }
}

// Independent oracle: deliberately checks every installable row/column pair.
function exhaustiveOracle(input) {
  const unit = LED_UNIT_SPECS[input.unitKey]
  const aspect = LED_ASPECT_RATIOS.find((item) => item.key === input.aspectRatioKey)
  const maximumColumns = Math.floor(
    (input.wallWidthMeters - input.frameWidthMeters * 2) * 1000 / unit.widthMm,
  )
  const maximumRows = Math.floor(
    (input.wallHeightMeters
      - input.topReserveMeters
      - input.bottomReserveMeters
      - input.frameWidthMeters * 2) * 1000 / unit.heightMm,
  )
  let preferred = null
  let fallback = null
  for (let rows = 1; rows <= maximumRows; rows += 1) {
    for (let columns = 1; columns <= maximumColumns; columns += 1) {
      const actualRatio = columns * unit.widthMm / (rows * unit.heightMm)
      const ratioError = Math.abs(actualRatio - aspect.value) / aspect.value
      const candidate = { rows, columns, ratioError, area: columns * rows }
      if (ratioError <= PREFERRED_RATIO_ERROR + 1e-9
        && (!preferred
          || candidate.area > preferred.area
          || (candidate.area === preferred.area
            && candidate.ratioError < preferred.ratioError))) {
        preferred = candidate
      }
      if (!fallback
        || ratioError < fallback.ratioError - 1e-9
        || (Math.abs(ratioError - fallback.ratioError) <= 1e-9
          && candidate.area > fallback.area)) {
        fallback = candidate
      }
    }
  }
  return preferred || fallback
}

function assertMatchesOracle(overrides) {
  const input = buildInput(overrides)
  const expected = exhaustiveOracle(input)
  const actual = calculateLedScreenPlan(input)
  assert.strictEqual(actual.error, undefined, JSON.stringify({ input, actual }))
  assert.deepStrictEqual(
    { rows: actual.rows, columns: actual.columns },
    { rows: expected.rows, columns: expected.columns },
  )
}

for (const unitKey of Object.keys(LED_UNIT_SPECS)) {
  for (const aspect of LED_ASPECT_RATIOS) {
    assertMatchesOracle({ unitKey, aspectRatioKey: aspect.key })
  }
}

// Broad independent coverage: every bounded installation capacity is checked
// against the row/column double-loop oracle for every unit and aspect pair.
for (const [unitKey, unit] of Object.entries(LED_UNIT_SPECS)) {
  for (const aspect of LED_ASPECT_RATIOS) {
    for (let rows = 1; rows <= 25; rows += 1) {
      for (let columns = 1; columns <= 40; columns += 1) {
        assertMatchesOracle({
          wallWidthMeters: columns * unit.widthMm / 1000,
          wallHeightMeters: rows * unit.heightMm / 1000,
          unitKey,
          aspectRatioKey: aspect.key,
        })
      }
    }
  }
}

// Also cover the width-limited tail for a low q ratio (the optimal row can
// sit just above ceil(maxColumns / q)).
assertMatchesOracle({
  wallWidthMeters: 4.57,
  wallHeightMeters: 3.78,
  aspectRatioKey: '4:3',
  unitKey: 'module',
})

// The reported regression: the 5% upper boundary is a larger legal layout.
const boundaryPlan = calculateLedScreenPlan(buildInput({
  wallWidthMeters: 4.48,
  wallHeightMeters: 2.4,
  aspectRatioKey: '16:9',
  unitKey: 'module',
}))
assert.strictEqual(boundaryPlan.columns, 14)
assert.strictEqual(boundaryPlan.rows, 15)
assert(Math.abs(boundaryPlan.actualRatio - (16 / 9) * 1.05) < 0.001)

const reportedRegressionPlan = calculateLedScreenPlan(buildInput({
  wallWidthMeters: 8.321,
  wallHeightMeters: 4.321,
  aspectRatioKey: '16:9',
  unitKey: 'module',
}))
assert.strictEqual(reportedRegressionPlan.columns, 25)
assert.strictEqual(reportedRegressionPlan.rows, 27)
assert.strictEqual(reportedRegressionPlan.totalUnits, 675)

// Existing default result, including wall reserves and 5 cm/side frame.
const defaultPlan = calculateLedScreenPlan({
  wallWidthMeters: 6,
  wallHeightMeters: 3,
  topReserveMeters: 0.2,
  bottomReserveMeters: 0.2,
  frameWidthMeters: 0.05,
  viewingDistanceMeters: 3,
  aspectRatioKey: '16:9',
  unitKey: 'module',
  pixelPitch: 'recommended',
})
assert.strictEqual(defaultPlan.columns, 14)
assert.strictEqual(defaultPlan.rows, 15)
assert.strictEqual(defaultPlan.dimensionText, '4.48 × 2.4 m')

// Tiny fallback: no integer layout reaches the preferred 5% ratio.
const fallbackPlan = calculateLedScreenPlan(buildInput({
  wallWidthMeters: 0.32,
  wallHeightMeters: 0.16,
}))
assert.strictEqual(fallbackPlan.columns, 1)
assert.strictEqual(fallbackPlan.rows, 1)
assert(fallbackPlan.actualRatio > (16 / 9) * (1 + PREFERRED_RATIO_ERROR))

// Invalid null reserves/frames must not be coerced to zero.
assert(calculateLedScreenPlan(buildInput({ topReserveMeters: null })).error)
assert(calculateLedScreenPlan(buildInput({ bottomReserveMeters: null })).error)
assert(calculateLedScreenPlan(buildInput({ frameWidthMeters: null })).error)
for (const invalidNumber of [NaN, Infinity, -Infinity]) {
  assert(calculateLedScreenPlan(buildInput({ topReserveMeters: invalidNumber })).error)
  assert(calculateLedScreenPlan(buildInput({ bottomReserveMeters: invalidNumber })).error)
  assert(calculateLedScreenPlan(buildInput({ frameWidthMeters: invalidNumber })).error)
}

// Large but safely countable dimensions remain quick and finite.
const largeStart = Date.now()
const largePlan = calculateLedScreenPlan(buildInput({
  wallWidthMeters: 1e7,
  wallHeightMeters: 1e7,
}))
assert.strictEqual(largePlan.error, undefined)
assert(Date.now() - largeStart < 500)

// Overflowing mm and non-safe unit counts fail quickly instead of looping.
const overflow = calculateLedScreenPlan(buildInput({ wallWidthMeters: 1e308 }))
assert(overflow.error)
const unsafeCount = calculateLedScreenPlan(buildInput({ wallWidthMeters: 1e16 }))
assert(unsafeCount.error)
const unsafeTotalUnits = calculateLedScreenPlan(buildInput({
  wallWidthMeters: 1e8,
  wallHeightMeters: 1e8,
}))
assert(unsafeTotalUnits.error)

console.log('LED regression audit passed')

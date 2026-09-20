const assert = require('assert/strict')

const { calculatePagNagReview } = require('../utils/venue-pag-nag')

const base = {
  ds: 0.2,
  d0: 10,
  dn: 1,
  d1: 7.9075912893876845,
  d2: 2.3853720883753127,
  nom: 1,
}

function close(actual, expected, tolerance = 1e-12) {
  assert(Number.isFinite(actual))
  assert(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`)
}

function assertError(input, field, errorKind) {
  const result = calculatePagNagReview(input)
  assert.equal(result.field, field)
  assert.equal(result.errorKind, errorKind)
  assert.equal(typeof result.error, 'string')
  assert.equal('pagDb' in result, false)
  assert.equal('nagDb' in result, false)
  assert.equal('marginDb' in result, false)
}

const expected = calculatePagNagReview(base)
assert.deepEqual(Object.keys(expected), [
  'basis', 'verification', 'distancesMeters', 'openMicrophoneCount',
  'feedbackStabilityMarginDb', 'pagDb', 'nagDb', 'marginDb',
])
assert.equal(expected.basis, 'omnidirectional-single-path')
assert.equal(expected.verification, 'unverified')
assert.equal(expected.feedbackStabilityMarginDb, 6)
assert.deepEqual(expected.distancesMeters, {
  ds: base.ds,
  d0: base.d0,
  dn: base.dn,
  d1: base.d1,
  d2: base.d2,
})
assert.equal(expected.openMicrophoneCount, 1)
close(expected.pagDb, 38.38916170957634)
close(expected.nagDb, 20)
close(expected.marginDb, 18.389161709576342)

for (const field of ['ds', 'd0', 'dn', 'd1', 'd2', 'nom']) {
  assertError({ ...base, [field]: undefined }, field, 'missing')
  assertError({ ...base, [field]: null }, field, 'missing')
  assertError({ ...base, [field]: '' }, field, 'missing')
  assertError({ ...base, [field]: '   ' }, field, 'missing')
}
assert.equal(calculatePagNagReview({ ...base, nom: '' }).error, '请填写同时开放话筒数。')
assert.equal(calculatePagNagReview({ ...base, nom: 1.5 }).error, '同时开放话筒数必须为正整数。')

for (const value of [true, false, [], [12], {}, { valueOf: () => 12 }, NaN, Infinity, -Infinity]) {
  assertError({ ...base, ds: value }, 'ds', 'invalid')
}
for (const value of [0, -1, '0', '-1', 'NaN', 'Infinity']) {
  assertError({ ...base, d1: value }, 'd1', 'invalid')
}
for (const value of [0, -1, 1.5, '1.5', Number.MAX_SAFE_INTEGER + 1]) {
  assertError({ ...base, nom: value }, 'nom', 'invalid')
}
assertError(null, 'ds', 'missing')
assertError([], 'ds', 'invalid')

assertError({ ...base, dn: 10.0001 }, 'geometry', 'inconsistent')
assertError({ ...base, d0: 10, dn: 10 + 1e-10 }, 'geometry', 'inconsistent')
assertError({ ...base, d0: 1e-20, dn: 1e-10 }, 'geometry', 'inconsistent')
assertError({ ...base, ds: 1, d1: 1, d2: 1, d0: 10, dn: 1 }, 'geometry', 'inconsistent')
assert(calculatePagNagReview({ ...base, ds: 1, d1: 1, d2: 1, d0: 10, dn: 1 }).error.includes('嘴到话筒'))

const textInput = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, String(value)]))
assert.deepEqual(calculatePagNagReview(textInput), expected)

for (const nom of [2, 4]) {
  const result = calculatePagNagReview({ ...base, nom })
  close(expected.pagDb - result.pagDb, 10 * Math.log10(nom))
  close(expected.nagDb, result.nagDb)
  close(expected.marginDb - result.marginDb, 10 * Math.log10(nom))
}

const scale = calculatePagNagReview({
  ds: base.ds * 1e120,
  d0: base.d0 * 1e120,
  dn: base.dn * 1e120,
  d1: base.d1 * 1e120,
  d2: base.d2 * 1e120,
  nom: base.nom,
})
close(scale.pagDb, expected.pagDb, 1e-10)
close(scale.nagDb, expected.nagDb, 1e-10)
close(scale.marginDb, expected.marginDb, 1e-10)

const negativePag = calculatePagNagReview({ ds: 10, d0: 10, dn: 10, d1: 1, d2: 9, nom: 1 })
assert(negativePag.pagDb < 0)
assert.equal(negativePag.nagDb, 0)

const equalNearFar = calculatePagNagReview({ ...base, dn: base.d0 })
close(equalNearFar.nagDb, 0)

const marginZeroRatio = 10 ** 0.3
const marginZero = calculatePagNagReview({ ds: 1, d0: 2, dn: 1, d1: marginZeroRatio, d2: 1, nom: 1 })
close(marginZero.marginDb, 0, 1e-12)
const marginPositive = calculatePagNagReview({ ds: 1, d0: 2, dn: 1, d1: marginZeroRatio * (1 + 1e-7), d2: 1, nom: 1 })
const marginNegative = calculatePagNagReview({ ds: 1, d0: 2, dn: 1, d1: marginZeroRatio * (1 - 1e-7), d2: 1, nom: 1 })
assert(marginPositive.marginDb > 0 && marginPositive.marginDb < 0.001)
assert(marginNegative.marginDb < 0 && marginNegative.marginDb > -0.001)

const extremeLarge = calculatePagNagReview({
  ds: Number.MAX_VALUE * 0.2,
  d0: Number.MAX_VALUE,
  dn: Number.MAX_VALUE * 0.5,
  d1: Number.MAX_VALUE * 0.7,
  d2: Number.MAX_VALUE * 0.2,
  nom: 1,
})
assert(Number.isFinite(extremeLarge.pagDb))
assert(Number.isFinite(extremeLarge.nagDb))
assert(Number.isFinite(extremeLarge.marginDb))

const extremeSmall = calculatePagNagReview({
  ds: Number.MIN_VALUE * 2,
  d0: Number.MIN_VALUE * 8,
  dn: Number.MIN_VALUE * 2,
  d1: Number.MIN_VALUE * 4,
  d2: Number.MIN_VALUE * 2,
  nom: 1,
})
assert(Number.isFinite(extremeSmall.pagDb))
assert(Number.isFinite(extremeSmall.nagDb))
assert(Number.isFinite(extremeSmall.marginDb))

console.log('venue PAG/NAG regression passed')

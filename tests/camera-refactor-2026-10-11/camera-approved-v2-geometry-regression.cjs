'use strict'

const assert = require('node:assert/strict')
const api = require('../../utils/camera-fov')
const rad = Math.PI / 180
let assertions = 0
function check(value, message) { assertions += 1; assert(value, message) }
function close(actual, expected, tolerance, message) {
  check(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} versus ${expected}`)
}
const optics = (h, v) => ({ horizontalFov: h, verticalFov: v,
  diagonalFov: 2 * Math.atan(Math.hypot(Math.tan(h * rad / 2), Math.tan(v * rad / 2))) / rad })

// Contract A. Independent angular form: the vertical image extrema are
// +/-tan(beta/2) when the optical axis bisects the extreme vertical rays.
// Horizontal extrema follow from the nearest axial corner depth.
function angularEnvelope(d, p) {
  const zs = [p.b - p.h, p.b + p.H - p.h]
  const xs = p.D === 0 ? [d] : [d, d + p.D]
  const alpha = xs.flatMap(x => zs.map(z => Math.atan2(z, x)))
  const lo = Math.min(...alpha), hi = Math.max(...alpha)
  const pitch = (lo + hi) / 2, beta = hi - lo
  const axial = xs.flatMap(x => zs.map(z => x * Math.cos(pitch) + z * Math.sin(pitch)))
  const q = Math.min(...axial)
  return { pitch: pitch / rad, beta: beta / rad, minAxialDepth: q,
    horizontal: 2 * Math.atan((1 + p.m) * p.W / (2 * q)) / rad,
    vertical: 2 * Math.atan((1 + p.m) * Math.tan(beta / 2)) / rad,
    targetHalfU: p.W / (2 * q), targetHalfV: Math.tan(beta / 2) }
}

// The complete vertical feasibility set is analytical, not a joint distance
// bisection. P(d)>=0 is equivalent to beta(d)<=betaLimit, even above 90deg.
// Entirely below lens: beta=atan2(H*d-A*D,d*d+D*d+A*B).
// Entirely above lens: beta=atan2(H*d+B*D,d*d+D*d+A*B).
// Lens inside the vertical extent: beta=atan2(H*d,d*d+A*B).
function verticalPolynomial(p, v) {
  const A = p.b - p.h, B = p.b + p.H - p.h
  const limit = 2 * Math.atan(Math.tan(v * rad / 2) / (1 + p.m))
  const c = B <= 0 ? -A * p.D : A >= 0 ? B * p.D : 0
  const depth = A >= 0 || B <= 0 ? p.D : 0
  const a = Math.sin(limit), b = depth * a - p.H * Math.cos(limit)
  const c0 = A * B * a - c * Math.cos(limit)
  const disc = b * b - 4 * a * c0
  const roots = []
  if (disc >= 0) {
    const s = Math.sqrt(disc)
    // Stable quadratic roots, including narrow near/far intervals.
    const q = -0.5 * (b + (b >= 0 ? s : -s))
    if (q !== 0) roots.push(q / a, c0 / q)
    else roots.push(-b / (2 * a))
  }
  return { limitDegrees: limit / rad, a, b, c: c0,
    roots: [...new Set(roots.filter(x => x >= 0 && Number.isFinite(x)))].sort((x, y) => x - y),
    evaluate: d => a * d * d + b * d + c0 }
}

function solveIndependent(p, f, horizontalOnly = false) {
  const scale = Math.max(p.W, p.H, p.D, p.h, 1)
  let low = scale * 1e-12, high = scale
  const fitsH = d => angularEnvelope(d, p).horizontal <= f.horizontalFov
  if (fitsH(low)) high = low
  else {
    while (!fitsH(high)) high *= 2
    for (let k = 0; k < 110; k += 1) {
      const mid = (low + high) / 2
      if (fitsH(mid)) high = mid
      else low = mid
    }
  }
  const horizontalMinimum = high
  let distance = high, vertical = null
  if (!horizontalOnly) {
    vertical = verticalPolynomial(p, f.verticalFov)
    if (angularEnvelope(distance, p).vertical > f.verticalFov + 1e-11) {
      const next = vertical.roots.find(x => x >= distance)
      check(next !== undefined, 'analytical vertical feasible boundary exists')
      distance = next
    }
  }
  return { distance, horizontalMinimum, ...angularEnvelope(distance, p),
    verticalPolynomial: vertical && { a: vertical.a, b: vertical.b, c: vertical.c,
      roots: vertical.roots, limitDegrees: vertical.limitDegrees } }
}

function physical(scene, options) {
  const ground = scene === 'ground'
  const H = ground ? options.subjectHeightMeters : options.heightMeters
  const b = ground ? 0 : options.bottomHeightMeters
  const h = options.heightMode === 'fixed' ? options.cameraHeightMeters
    : ground ? Math.max(1.5, H + 0.5) : b + H / 2
  const rawMargin = Number(options.marginRatio)
  return { W: options.widthMeters, D: ground ? options.depthMeters : 0, H, b, h,
    m: Number.isFinite(rawMargin) && rawMargin >= 0 && rawMargin <= 0.5 ? rawMargin : 0.1 }
}

const cases = []
function runCase(name, scene, options, f = optics(71, 42.7), horizontalOnly = false) {
  const p = physical(scene, options)
  const expected = solveIndependent(p, f, horizontalOnly)
  const actual = horizontalOnly
    ? api.calculateHorizontalOnlyPlacement(f, { ...options, sceneMode: scene })
    : scene === 'ground' ? api.calculateGroundAreaPlacement(f, options)
      : api.calculateVerticalPlanePlacement(f, options)
  check(actual !== null, `${name}: public v2 result`)
  const tolerance = Math.max(1, expected.distance) * 2e-8
  close(actual.calculationDistanceMeters, expected.distance, tolerance, `${name}: independent distance`)
  close(actual.calculationAimAngleDegrees, expected.pitch, 2e-7, `${name}: independent tilt`)
  const atActual = angularEnvelope(actual.calculationDistanceMeters, p)
  check(atActual.horizontal <= f.horizontalFov + 2e-8, `${name}: horizontal limit`)
  if (!horizontalOnly) check(atActual.vertical <= f.verticalFov + 2e-8, `${name}: vertical limit`)
  close(actual.cameraHeightMeters, Math.round((p.h + Number.EPSILON) * 100) / 100, 1e-12, `${name}: height mode`)
  check(actual.framingVersion === 2 && actual.marginSpace === 'camera-normal', `${name}: version metadata`)
  check(JSON.stringify(actual.worldDimensions) === JSON.stringify({ width: p.W, depth: p.D,
    bottom: p.b, top: p.b + p.H, cameraHeight: p.h }), `${name}: original physical dimensions`)
  const bounds = actual.framingBounds
  for (const axis of ['U', 'V']) {
    const original = bounds.target[`max${axis}`] - bounds.target[`min${axis}`]
    const expanded = bounds.expanded[`max${axis}`] - bounds.expanded[`min${axis}`]
    close(expanded / original, 1 + p.m, 2e-12, `${name}: total ${axis} margin ratio`)
  }
  if (scene === 'ground') check(actual.depthMarginMeters === 0 && actual.effectiveDepthMeters === p.D,
    `${name}: no floor-depth expansion`)
  if (horizontalOnly) check(actual.verticalCoverageVerified === false && actual.aimAngleDegrees === null
    && actual.calculationVerticalFov === null, `${name}: no complete vertical-coverage claim`)
  if (expected.distance > tolerance * 10) {
    const closer = angularEnvelope(expected.distance - Math.max(1e-6, expected.distance * 1e-6), p)
    check(closer.horizontal > f.horizontalFov || (!horizontalOnly && closer.vertical > f.verticalFov),
      `${name}: immediately nearer point violates a binding constraint`)
  }
  const row = { name, scene, horizontalOnly, fov: f, physical: p, expected,
    actual: { distance: actual.calculationDistanceMeters, displayedDistance: actual.primaryDistanceMeters,
      pitch: actual.calculationAimAngleDegrees, height: actual.cameraHeightMeters },
    absoluteDistanceError: Math.abs(actual.calculationDistanceMeters - expected.distance), atActual }
  cases.push(row)
  return row
}

const refOptions = { widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8, heightMode: 'auto', marginRatio: 0.1 }
const reference = runCase('reference-library-ground', 'ground', refOptions)
runCase('reference-custom-ground', 'ground', refOptions, optics(60, 36))
for (const scene of ['ground', 'plane']) for (const heightMode of ['auto', 'fixed']) {
  for (const marginRatio of [0, 0.1, 0.5]) {
    const common = { widthMeters: 6, heightMode, cameraHeightMeters: 5.2, marginRatio }
    const options = scene === 'ground'
      ? { ...common, depthMeters: 4, subjectHeightMeters: 1.8 }
      : { ...common, heightMeters: 2.5, bottomHeightMeters: 0.8 }
    runCase(`${scene}-${heightMode}-margin-${marginRatio}`, scene, options)
  }
}
runCase('ground-auto-minimum-height', 'ground', { ...refOptions, subjectHeightMeters: 0.4 })
runCase('ground-fixed-inside-target', 'ground', { ...refOptions, heightMode: 'fixed', cameraHeightMeters: 0.8 })
runCase('plane-fixed-below-target', 'plane', { widthMeters: 1, heightMeters: 4, bottomHeightMeters: 2,
  heightMode: 'fixed', cameraHeightMeters: 0.5, marginRatio: 0.1 }, optics(40, 20))
runCase('plane-fixed-inside-vertical-binding', 'plane', { widthMeters: 1, heightMeters: 5, bottomHeightMeters: 0,
  heightMode: 'fixed', cameraHeightMeters: 2.5, marginRatio: 0.1 }, optics(90, 12))
const near = runCase('plane-narrow-near-feasible-interval', 'plane', { widthMeters: 0.375, heightMeters: 5,
  bottomHeightMeters: 0, heightMode: 'fixed', cameraHeightMeters: 6, marginRatio: 0 }, optics(21, 12))
check(near.expected.distance < 0.25, 'near feasible window must not jump to the far vertical root')
const witness = angularEnvelope(0.25, near.physical)
check(witness.horizontal < 21 && witness.vertical < 12, 'independent near-interval witness')
for (const scene of ['ground', 'plane']) for (const heightMode of ['auto', 'fixed']) {
  runCase(`${scene}-${heightMode}-horizontal-only`, scene, scene === 'ground'
    ? { ...refOptions, heightMode, cameraHeightMeters: 4 }
    : { widthMeters: 6, heightMeters: 2.5, bottomHeightMeters: 0.8, heightMode, cameraHeightMeters: 4, marginRatio: 0.1 },
  optics(71, 42.7), true)
}

const planeAuto = cases.find(x => x.name === 'plane-auto-margin-0.1')
const planeClosed = Math.max(6 * 1.1 / (2 * Math.tan(71 * rad / 2)), 2.5 * 1.1 / (2 * Math.tan(42.7 * rad / 2)))
close(planeAuto.expected.distance, planeClosed, 1e-12, 'independent plane-auto closed form')
for (const marginRatio of [-0.01, 0.5001, NaN]) {
  const r = api.calculateGroundAreaPlacement(optics(71, 42.7), { ...refOptions, marginRatio })
  close(r.calculationDistanceMeters, reference.actual.distance, 1e-12, 'existing invalid-margin fallback remains 0.1')
}
const invalid = [
  { options: { ...refOptions, widthMeters: 0 }, reason: 'zero width' },
  { options: { ...refOptions, depthMeters: 0 }, reason: 'zero depth' },
  { options: { ...refOptions, subjectHeightMeters: -1 }, reason: 'negative height' },
  { options: { ...refOptions, heightMode: 'fixed', cameraHeightMeters: 0 }, reason: 'zero fixed camera height' },
]
for (const entry of invalid) check(api.calculateGroundAreaPlacement(optics(71, 42.7), entry.options) === null,
  `invalid input: ${entry.reason}`)
check(api.calculateVerticalPlanePlacement(optics(71, 42.7), { widthMeters: 6, heightMeters: 2.5,
  bottomHeightMeters: -1, heightMode: 'auto', marginRatio: 0.1 }) === null, 'negative plane bottom rejected')
for (const f of [optics(0, 42.7), optics(179, 42.7), optics(71, 0), optics(71, 179)]) {
  check(api.calculateGroundAreaPlacement(f, refOptions) === null, 'invalid FOV boundary rejected')
}

// Compatibility derivation is explicit v1, never substituted for v2.
const legacyWidthDistance = 6 * 1.1 / (2 * Math.tan(71 * rad / 2))
const legacyActual = api.calculateGroundAreaPlacement(optics(71, 42.7), { ...refOptions, calculationVersion: 1 })
const legacyDerivedDistance = legacyWidthDistance + 4 * 0.1 / 2
close(legacyActual.cameraSetbackMeters, Math.round(legacyDerivedDistance * 100) / 100, 1e-12, 'explicit v1 reference golden')
const legacyCustomOptions = { ...refOptions, calculationVersion: 1 }
const legacyCustom = api.calculateGroundAreaPlacement(optics(60, 36), legacyCustomOptions)
const legacyCustomDistance = 6 * 1.1 / (2 * Math.tan(60 * rad / 2)) + 4 * 0.1 / 2
close(legacyCustom.cameraSetbackMeters, Math.round(legacyCustomDistance * 100) / 100, 1e-12,
  'explicit v1 custom 60/36 setback golden')
check(legacyCustom.primaryDistanceMeters === 5.92 && legacyCustom.cameraSetbackMeters === 5.92,
  'explicit v1 custom 60/36 display remains 5.92')
const legacyPlaneAuto = api.calculateVerticalPlanePlacement(optics(71, 42.7), {
  widthMeters: 6, heightMeters: 2.5, bottomHeightMeters: 0.8,
  heightMode: 'auto', marginRatio: 0.1, calculationVersion: 1,
})
const legacyPlaneAutoDistance = 6 * 1.1 / (2 * Math.tan(71 * rad / 2))
close(legacyPlaneAuto.calculationDistanceMeters, legacyPlaneAutoDistance, 1e-12,
  'explicit v1 plane-auto width-bound distance')
check(legacyPlaneAuto.primaryDistanceMeters === 4.63 && legacyPlaneAuto.cameraHeightMeters === 2.05,
  'explicit v1 plane-auto display and height remain 4.63 and 2.05')

// User explicitly approved Contract A: centered expansion of the camera-normal
// projected envelope. This test keeps its mathematical oracle independent from
// production framing code and preserves the old calculation only as explicit v1.
close(reference.expected.distance, 4.65314185024064, 2e-8, 'approved v2 reference raw distance')
check(reference.actual.displayedDistance === 4.65, 'approved v2 default display remains 4.65')
check(legacyActual.primaryDistanceMeters === 4.83, 'explicit v1 compatibility display remains 4.83')
check(legacyActual.cameraSetbackMeters === 4.83, 'explicit v1 compatibility setback remains 4.83')
close(legacyActual.calculationDistanceMeters, legacyDerivedDistance - 0.2, 1e-12,
  'explicit v1 keeps its original near-edge calculation distance')
console.log(`approved v2 camera geometry passed: ${cases.length} cases, ${assertions} assertions; default 4.65 m; explicit v1 library/custom/plane-auto displays 4.83/5.92/4.63 m`)

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const current = require('../../utils/camera-fov')
const legacy = require('./before/camera-fov')
const { buildCameraScene, fitCameraScene } = require('../../pages/camera/camera-scene')
const { drawPreviewAtSize } = require('../../pages/camera/preview-renderer')
const rad = Math.PI / 180
const close = (actual, expected, message) => assert(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${message}: ${actual} / ${expected}`)
const optics = (h, v) => ({ horizontalFov: h, verticalFov: v, diagonalFov: current.diagonalFromAxes(h, v) })

// Independent pinhole projection, without importing the production framing
// module or trusting its stored bounds.
function envelope(distance, options, ground) {
  const bottom = ground ? 0 : options.bottomHeightMeters
  const top = bottom + (ground ? options.subjectHeightMeters : options.heightMeters)
  const xs = ground ? [distance, distance + options.depthMeters] : [distance]
  const angles = xs.flatMap((x) => [bottom, top].map((z) => Math.atan2(z - options.cameraHeightMeters, x)))
  const pitch = (Math.min(...angles) + Math.max(...angles)) / 2
  const us = [], vs = []
  for (const x of xs) for (const z of [bottom, top]) for (const y of [-options.widthMeters / 2, options.widthMeters / 2]) {
    const dz = z - options.cameraHeightMeters
    const axial = x * Math.cos(pitch) + dz * Math.sin(pitch)
    assert(axial > 0)
    us.push(y / axial)
    vs.push((-x * Math.sin(pitch) + dz * Math.cos(pitch)) / axial)
  }
  return { minU: Math.min(...us), maxU: Math.max(...us), minV: Math.min(...vs), maxV: Math.max(...vs), pitch }
}

function fits(bounds, fov, margin) {
  const horizontal = Math.max(Math.abs(bounds.minU), Math.abs(bounds.maxU)) * (1 + margin)
  const vertical = Math.max(Math.abs(bounds.minV), Math.abs(bounds.maxV)) * (1 + margin)
  return horizontal <= Math.tan(fov.horizontalFov * rad / 2) + 1e-9
    && vertical <= Math.tan(fov.verticalFov * rad / 2) + 1e-9
}

const cases = [
  { ground: true, fov: optics(44, 25), width: 6, depth: 4, height: 1.8, cameraHeight: 2.3 },
  { ground: true, fov: optics(44.062, 25.037), width: 6, depth: 4, height: 1.8, cameraHeight: 2.3 },
  { ground: true, fov: optics(83, 50), width: 6, depth: 4, height: 1.8, cameraHeight: 2.3 },
  { ground: true, fov: optics(66, 18), width: 3, depth: 20, height: 2.5, cameraHeight: 6 },
  { ground: true, fov: optics(120, 70), width: 2, depth: 1000, height: 1.8, cameraHeight: 2.3 },
  { ground: false, fov: optics(44, 25), width: 6, height: 2.5, bottom: 0.8, cameraHeight: 2.05 },
  { ground: false, fov: optics(70, 20), width: 3, height: 4, bottom: 1, cameraHeight: 2.3 },
  { ground: false, fov: optics(60, 35), width: 8, height: 2, bottom: 8, cameraHeight: 2 },
  { ground: false, fov: optics(21, 12), width: 0.375, height: 5, bottom: 0, cameraHeight: 6, nearWitness: 0.25 },
]
let checked = 0
for (const item of cases) for (const marginRatio of [0, 0.05, 0.1, 0.2, 0.5]) {
  const options = { widthMeters: item.width, depthMeters: item.depth, subjectHeightMeters: item.height,
    heightMeters: item.height, bottomHeightMeters: item.bottom || 0, heightMode: 'fixed', cameraHeightMeters: item.cameraHeight, marginRatio }
  const calculate = item.ground ? current.calculateGroundAreaPlacement : current.calculateVerticalPlanePlacement
  const result = calculate(item.fov, options)
  assert(result)
  const bounds = envelope(result.calculationDistanceMeters, options, item.ground)
  assert(fits(bounds, item.fov, marginRatio), 'independent corner projection must fit both axes')
  if (item.nearWitness && marginRatio === 0) {
    assert(fits(envelope(item.nearWitness, options, item.ground), item.fov, marginRatio), 'the independent near witness must be feasible')
    assert(result.calculationDistanceMeters <= item.nearWitness, 'do not skip the near feasible interval and return a much farther solution')
  }
  if (result.calculationDistanceMeters > Math.max(item.width, item.cameraHeight) * 1e-7) {
    assert(!fits(envelope(result.calculationDistanceMeters * (1 - 1e-5), options, item.ground), item.fov, marginRatio),
      'a materially closer placement must violate an axis under the same centred aim rule')
  }
  const target = result.framingBounds.target, expanded = result.framingBounds.expanded
  for (const key of ['minU', 'maxU', 'minV', 'maxV']) close(target[key], bounds[key], key)
  close(expanded.maxU - expanded.minU, (bounds.maxU - bounds.minU) * (1 + marginRatio), 'total width allowance')
  close(expanded.maxV - expanded.minV, (bounds.maxV - bounds.minV) * (1 + marginRatio), 'total height allowance')
  close((expanded.minV + expanded.maxV) / 2, (bounds.minV + bounds.maxV) / 2, 'height anchor')
  if (item.ground) { assert.equal(result.effectiveDepthMeters, item.depth); assert.equal(result.depthMarginMeters, 0) }
  const scene = buildCameraScene(result)
  assert.equal(scene.sections.length, 2)
  assert.equal(scene.people.length, item.ground ? 4 : 0)
  assert.equal(Boolean(scene.outerFrame), marginRatio > 0)
  for (const section of scene.sections) {
    assert.deepEqual(section.points[0], scene.lens, 'common apex must be the actual lens centre')
    section.points.slice(1).forEach((point) => close(point.x, result.calculationDistanceMeters, 'sections end at actual front'))
    if (!section.clipped) {
      const vectors = section.points.slice(1).map((point) => [point.x, point.y, point.z - scene.lens.z])
      const cosine = vectors[0].reduce((sum, value, i) => sum + value * vectors[1][i], 0)
        / (Math.hypot(...vectors[0]) * Math.hypot(...vectors[1]))
      close(Math.acos(Math.max(-1, Math.min(1, cosine))) / rad,
        section.axis === 'horizontal' ? item.fov.horizontalFov : item.fov.verticalFov, 'optical angle')
    }
  }
  for (const point of scene.innerFrame) {
    close(point.x * Math.cos(bounds.pitch) + (point.z - scene.lens.z) * Math.sin(bounds.pitch),
      result.framingBounds.referenceDepthMeters, 'frame is camera-normal, not a vertical facade')
  }
  const transform = fitCameraScene(scene, 331, 350)
  for (const factor of [0.1, 10]) {
    const scaledOptions = Object.fromEntries(Object.entries(options).map(([key, value]) => [key, key.endsWith('Meters') ? value * factor : value]))
    const scaled = calculate(item.fov, scaledOptions)
    close(scaled.calculationDistanceMeters / factor, result.calculationDistanceMeters, 'distance scale invariance')
    const scaledScene = buildCameraScene(scaled)
    const scaledTransform = fitCameraScene(scaledScene, 331, 350)
    scene.site.forEach((point, index) => {
      const a = transform.project(point), b = scaledTransform.project(scaledScene.site[index])
      close(a.x, b.x, 'orthographic x scale invariance'); close(a.y, b.y, 'orthographic y scale invariance')
    })
  }
  const legacyFn = item.ground ? legacy.calculateGroundAreaPlacement : legacy.calculateVerticalPlanePlacement
  assert.deepEqual(calculate(item.fov, { ...options, calculationVersion: 1 }), legacyFn(item.fov, options), 'v1 results remain byte-value equivalent')
  for (const theme of ['dark', 'light']) {
    let fill = '', currentPath = [], sections = 0
    const finiteArgs = (...args) => args.filter((arg) => typeof arg === 'number').forEach((arg) => assert(Number.isFinite(arg)))
    const context = {
      supportsArc: false, setFillStyle: (value) => { fill = value }, setStrokeStyle() {}, setLineWidth: finiteArgs,
      setFontSize: finiteArgs, setTextAlign() {}, measureText: (value) => String(value).length * 7,
      setLineDash() {}, beginPath() { currentPath = [] }, closePath() {}, moveTo(...args) { finiteArgs(...args); currentPath.push(args) },
      lineTo(...args) { finiteArgs(...args); currentPath.push(args) }, stroke() {},
      fill() { if (/rgba\((38,152,236|173,115,241|140,83,205)/.test(fill)) { sections += 1; assert.equal(currentPath.length, 3) } },
      fillRect: finiteArgs, strokeRect: finiteArgs, fillText: finiteArgs,
    }
    drawPreviewAtSize(context, result, 331, 350, 'spatial', theme)
    assert.equal(sections, 2, 'exactly two optical fills; margin strips use a different material')
  }
  checked += 1
}
fs.writeFileSync(path.join(__dirname, 'evidence/geometry.json'), JSON.stringify({ passed: checked, scaleVariants: checked * 2, legacyComparisons: checked,
  checks: ['independent projection and near-minimum distance', 'total centred allowance', 'real depth', 'common lens apex', 'two section planes and near-front intersections', 'camera-normal frames', 'one orthographic scale', 'finite rendering in both themes'] }, null, 2))
console.log(`PASS ${checked} geometry cases, ${checked * 2} scale variants, ${checked} immutable legacy comparisons`)

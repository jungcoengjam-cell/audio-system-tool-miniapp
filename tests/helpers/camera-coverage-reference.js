'use strict'

const DEGREE = Math.PI / 180

function cameraHeightFor(options) {
  if (options.heightMode === 'fixed') return Number(options.cameraHeightMeters)
  if (options.sceneMode === 'plane') {
    return Number(options.bottomHeightMeters) + Number(options.heightMeters) / 2
  }
  return Math.max(1.5, Number(options.subjectHeightMeters) + 0.5)
}

function evaluatePlacementCoverageV1(fov, options, distanceMeters) {
  const requestedMargin = Number(options.marginRatio)
  const marginRatio = Number.isFinite(requestedMargin) && requestedMargin >= 0 && requestedMargin <= 0.5
    ? requestedMargin
    : 0.1
  const effectiveWidth = Number(options.widthMeters) * (1 + marginRatio)
  const cameraHeight = cameraHeightFor(options)
  const horizontalRequiredFov = 2 * Math.atan2(effectiveWidth / 2, distanceMeters) / DEGREE
  let verticalHeights

  if (options.sceneMode === 'plane') {
    const center = Number(options.bottomHeightMeters) + Number(options.heightMeters) / 2
    const effectiveHeight = Number(options.heightMeters) * (1 + marginRatio)
    verticalHeights = [
      { distance: distanceMeters, height: center - effectiveHeight / 2 },
      { distance: distanceMeters, height: center + effectiveHeight / 2 },
    ]
  } else {
    const effectiveDepth = Number(options.depthMeters) * (1 + marginRatio)
    const effectiveSubjectHeight = Number(options.subjectHeightMeters) * (1 + marginRatio)
    verticalHeights = [
      { distance: distanceMeters, height: 0 },
      { distance: distanceMeters, height: effectiveSubjectHeight },
      { distance: distanceMeters + effectiveDepth, height: 0 },
      { distance: distanceMeters + effectiveDepth, height: effectiveSubjectHeight },
    ]
  }

  const verticalAngles = verticalHeights.map(({ distance, height }) => (
    Math.atan2(height - cameraHeight, distance) / DEGREE
  ))
  const verticalRequiredFov = Math.max(...verticalAngles) - Math.min(...verticalAngles)
  return {
    horizontalRequiredFov,
    verticalRequiredFov,
    horizontalCovered: horizontalRequiredFov <= Number(fov.horizontalFov) + 1e-8,
    verticalCovered: verticalRequiredFov <= Number(fov.verticalFov) + 1e-8,
  }
}

// Independent version-2 oracle: project every physical target corner into the
// pitched camera image plane, then add the documented total-width/height
// allowance around the projected bounds' centre.
function evaluateFramedPlacementCoverage(fov, options, distanceMeters, pose = null, toleranceDegrees = 1e-8) {
  const width = Number(options.widthMeters)
  const ground = options.sceneMode === 'ground'
  const depth = ground ? Number(options.depthMeters) : 0
  const bottom = ground ? 0 : Number(options.bottomHeightMeters)
  const top = bottom + Number(ground ? options.subjectHeightMeters : options.heightMeters)
  const cameraHeight = Number.isFinite(pose?.cameraHeightMeters)
    ? pose.cameraHeightMeters
    : cameraHeightFor(options)
  const requestedMargin = Number(options.marginRatio)
  const marginRatio = Number.isFinite(requestedMargin) && requestedMargin >= 0 && requestedMargin <= 0.5
    ? requestedMargin
    : 0.1
  const xCoordinates = ground ? [distanceMeters, distanceMeters + depth] : [distanceMeters]
  const points = xCoordinates.flatMap((x) => [-width / 2, width / 2]
    .flatMap((y) => [bottom, top].map((z) => ({ x, y, z }))))
  const worldAngles = points.map(({ x, z }) => Math.atan2(z - cameraHeight, x) / DEGREE)
  const pitchDegrees = Number.isFinite(pose?.pitchDegrees)
    ? pose.pitchDegrees
    : (Math.min(...worldAngles) + Math.max(...worldAngles)) / 2
  const pitch = pitchDegrees * DEGREE
  const sinPitch = Math.sin(pitch)
  const cosPitch = Math.cos(pitch)
  const projected = points.map((point) => {
    const heightOffset = point.z - cameraHeight
    const depthAlongView = point.x * cosPitch + heightOffset * sinPitch
    if (!(depthAlongView > 0)) return null
    return {
      u: point.y / depthAlongView,
      v: (-point.x * sinPitch + heightOffset * cosPitch) / depthAlongView,
      depth: depthAlongView,
    }
  })
  if (projected.some((point) => point === null)) {
    return {
      valid: false, distanceMeters, cameraHeightMeters: cameraHeight, pitchDegrees,
      points, projected, horizontalCovered: false, verticalCovered: false,
    }
  }
  const target = {
    minU: Math.min(...projected.map((point) => point.u)),
    maxU: Math.max(...projected.map((point) => point.u)),
    minV: Math.min(...projected.map((point) => point.v)),
    maxV: Math.max(...projected.map((point) => point.v)),
  }
  const centerU = (target.minU + target.maxU) / 2
  const centerV = (target.minV + target.maxV) / 2
  const halfWidth = (target.maxU - target.minU) * (1 + marginRatio) / 2
  const halfHeight = (target.maxV - target.minV) * (1 + marginRatio) / 2
  const expanded = {
    minU: centerU - halfWidth,
    maxU: centerU + halfWidth,
    minV: centerV - halfHeight,
    maxV: centerV + halfHeight,
  }
  const requiredHorizontalFov = 2 * Math.atan(Math.max(Math.abs(expanded.minU), Math.abs(expanded.maxU))) / DEGREE
  const requiredVerticalFov = 2 * Math.atan(Math.max(Math.abs(expanded.minV), Math.abs(expanded.maxV))) / DEGREE
  return {
    valid: true,
    pitchDegrees,
    points,
    projected,
    target,
    expanded,
    marginRatio,
    requiredHorizontalFov,
    requiredVerticalFov,
    horizontalCovered: requiredHorizontalFov <= Number(fov.horizontalFov) + toleranceDegrees,
    verticalCovered: requiredVerticalFov <= Number(fov.verticalFov) + toleranceDegrees,
    distanceMeters,
    cameraHeightMeters: cameraHeight,
  }
}

function parsePresentedMeters(text, name) {
  const match = String(text ?? '').trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*m$/i)
  if (!match || !Number.isFinite(Number(match[1]))) throw new Error(`${name} must be a finite meter label: ${String(text)}`)
  return Number(match[1])
}

function parsePresentedPitch(text) {
  const match = String(text ?? '').trim().match(/^(俯角|仰角|水平)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)°$/i)
  if (!match || !Number.isFinite(Number(match[2]))) throw new Error(`displayed pitch must include a direction and finite degrees: ${String(text)}`)
  const magnitude = Number(match[2])
  if (match[1] === '俯角') return -Math.abs(magnitude)
  if (match[1] === '仰角') return Math.abs(magnitude)
  if (magnitude !== 0) throw new Error(`horizontal pitch label must be zero degrees: ${String(text)}`)
  return 0
}

function evaluatePresentedFramingCoverage(fov, options, presentation) {
  const distanceMeters = parsePresentedMeters(presentation?.distanceText, 'presentation.distanceText')
  const cameraHeightMeters = parsePresentedMeters(presentation?.heightDisplayText, 'presentation.heightDisplayText')
  const pitchDegrees = parsePresentedPitch(presentation?.pitchLabel)
  return evaluateFramedPlacementCoverage(fov, options, distanceMeters, {
    cameraHeightMeters,
    pitchDegrees,
  }, 1e-12)
}

function findHorizontalBoundaryV2(fov, options) {
  const width = Number(options.widthMeters)
  const depth = options.sceneMode === 'ground' ? Number(options.depthMeters) : 0
  const height = Number(options.sceneMode === 'ground' ? options.subjectHeightMeters : options.heightMeters)
  const cameraHeight = cameraHeightFor(options)
  const scale = Math.max(width, depth, height, cameraHeight)
  if (!(scale > 0) || !Number.isFinite(scale)) return null
  const horizontalFits = (distance) => evaluateFramedPlacementCoverage(fov, options, distance).horizontalCovered
  let lower = scale * 1e-10
  let upper = Math.max(scale, lower)
  if (!horizontalFits(lower)) {
    let iterations = 0
    while (!horizontalFits(upper) && iterations < 80) {
      upper *= 2
      iterations += 1
    }
    if (!Number.isFinite(upper) || !horizontalFits(upper)) return null
    for (let index = 0; index < 100; index += 1) {
      const middle = (lower + upper) / 2
      if (horizontalFits(middle)) upper = middle
      else lower = middle
    }
  } else {
    upper = lower
  }
  return upper
}

function assertCompletePlacementCoverageV1(assert, finiteTree, fov, options, result, label = 'camera placement') {
  assert(result, `${label} should return a solution for this valid input`)
  finiteTree(result, `${label}.result`)
  assert.strictEqual(result.coverageVerified, true, `${label} should mark full two-axis coverage as verified`)
  assert(Number.isFinite(result.calculationDistanceMeters) && result.calculationDistanceMeters > 0,
    `${label} should expose a positive unrounded calculationDistanceMeters`)
  const roundedCalculationDistance = Math.round((result.calculationDistanceMeters + Number.EPSILON) * 100) / 100
  assert.strictEqual(result.verticalMinimumDistanceMeters, roundedCalculationDistance,
    `${label} verticalMinimumDistanceMeters should report the vertical check at the constrained returned distance`)
  const coverage = evaluatePlacementCoverageV1(fov, options, result.calculationDistanceMeters)
  assert(coverage.horizontalCovered,
    `${label} horizontal coverage ${coverage.horizontalRequiredFov}° exceeds ${fov.horizontalFov}°`)
  assert(coverage.verticalCovered,
    `${label} vertical coverage ${coverage.verticalRequiredFov}° exceeds ${fov.verticalFov}°`)
  return coverage
}

// Keep the pre-V2 helper names for existing consumers that check historical
// V1 outputs; V2 checks should use the explicitly named framed oracle below.
const evaluatePlacementCoverage = evaluatePlacementCoverageV1
const assertCompletePlacementCoverage = assertCompletePlacementCoverageV1

function assertFramedPlacementCoverage(assert, finiteTree, fov, options, result, label = 'camera placement') {
  assert(result, `${label} should return a solution for this valid input`)
  finiteTree(result, `${label}.result`)
  assert.strictEqual(result.coverageVerified, true, `${label} should mark full two-axis coverage as verified`)
  assert(Number.isFinite(result.calculationDistanceMeters) && result.calculationDistanceMeters > 0,
    `${label} should expose a positive unrounded calculationDistanceMeters`)
  const roundedCalculationDistance = Math.round((result.calculationDistanceMeters + Number.EPSILON) * 100) / 100
  assert.strictEqual(result.verticalMinimumDistanceMeters, roundedCalculationDistance,
    `${label} verticalMinimumDistanceMeters should report the full V2 check at the returned distance`)

  const coverage = evaluateFramedPlacementCoverage(fov, options, result.calculationDistanceMeters)
  assert(coverage.valid, `${label} must project every real target corner in front of the lens`)
  assert(coverage.horizontalCovered,
    `${label} projected horizontal envelope ${coverage.requiredHorizontalFov}° exceeds ${fov.horizontalFov}°`)
  assert(coverage.verticalCovered,
    `${label} projected vertical envelope ${coverage.requiredVerticalFov}° exceeds ${fov.verticalFov}°`)
  const roundedHorizontalRequirement = Math.round((coverage.requiredHorizontalFov + Number.EPSILON) * 10) / 10
  const roundedVerticalRequirement = Math.round((coverage.requiredVerticalFov + Number.EPSILON) * 10) / 10
  assert.strictEqual(result.requiredHorizontalFov, roundedHorizontalRequirement,
    `${label} reported horizontal FOV requirement should match rounded independent corner projection`)
  assert.strictEqual(result.requiredVerticalFov, roundedVerticalRequirement,
    `${label} reported vertical FOV requirement should match rounded independent corner projection`)
  assert(result.framingBounds, `${label} should expose the raw V2 framing bounds`)
  for (const axis of ['minU', 'maxU', 'minV', 'maxV']) {
    assert(Math.abs(result.framingBounds.target[axis] - coverage.target[axis]) <= 1e-8,
      `${label} ${axis} target extreme should match independent corner projection`)
    assert(Math.abs(result.framingBounds.expanded[axis] - coverage.expanded[axis]) <= 1e-8,
      `${label} ${axis} margin extreme should match independent centred expansion`)
  }
  assert(Math.abs(coverage.expanded.maxU - coverage.expanded.minU
    - (coverage.target.maxU - coverage.target.minU) * (1 + coverage.marginRatio)) <= 1e-10,
  `${label} horizontal total margin should scale the projected envelope by 1 + margin`)
  assert(Math.abs(coverage.expanded.maxV - coverage.expanded.minV
    - (coverage.target.maxV - coverage.target.minV) * (1 + coverage.marginRatio)) <= 1e-10,
  `${label} vertical total margin should scale the projected envelope by 1 + margin`)
  assert(Math.abs((coverage.expanded.minU + coverage.expanded.maxU) / 2
    - (coverage.target.minU + coverage.target.maxU) / 2) <= 1e-10,
  `${label} horizontal margin should preserve the projected envelope centre`)
  assert(Math.abs((coverage.expanded.minV + coverage.expanded.maxV) / 2
    - (coverage.target.minV + coverage.target.maxV) / 2) <= 1e-10,
  `${label} vertical margin should preserve the projected envelope centre`)
  return coverage
}

module.exports = {
  assertCompletePlacementCoverage,
  evaluatePlacementCoverage,
  assertCompletePlacementCoverageV1,
  evaluatePlacementCoverageV1,
  assertFramedPlacementCoverage,
  evaluateFramedPlacementCoverage,
  evaluatePresentedFramingCoverage,
  findHorizontalBoundaryV2,
}

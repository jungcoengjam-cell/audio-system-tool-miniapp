'use strict'

const DEGREE = Math.PI / 180

function cameraHeightFor(options) {
  if (options.heightMode === 'fixed') return Number(options.cameraHeightMeters)
  if (options.sceneMode === 'plane') {
    return Number(options.bottomHeightMeters) + Number(options.heightMeters) / 2
  }
  return Math.max(1.5, Number(options.subjectHeightMeters) + 0.5)
}

function evaluatePlacementCoverage(fov, options, distanceMeters) {
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

function assertCompletePlacementCoverage(assert, finiteTree, fov, options, result, label = 'camera placement') {
  assert(result, `${label} should return a solution for this valid input`)
  finiteTree(result, `${label}.result`)
  assert.strictEqual(result.coverageVerified, true, `${label} should mark full two-axis coverage as verified`)
  assert(Number.isFinite(result.calculationDistanceMeters) && result.calculationDistanceMeters > 0,
    `${label} should expose a positive unrounded calculationDistanceMeters`)
  const roundedCalculationDistance = Math.round((result.calculationDistanceMeters + Number.EPSILON) * 100) / 100
  assert.strictEqual(result.verticalMinimumDistanceMeters, roundedCalculationDistance,
    `${label} verticalMinimumDistanceMeters should report the vertical check at the constrained returned distance`)
  const coverage = evaluatePlacementCoverage(fov, options, result.calculationDistanceMeters)
  assert(coverage.horizontalCovered,
    `${label} horizontal coverage ${coverage.horizontalRequiredFov}° exceeds ${fov.horizontalFov}°`)
  assert(coverage.verticalCovered,
    `${label} vertical coverage ${coverage.verticalRequiredFov}° exceeds ${fov.verticalFov}°`)
  return coverage
}

module.exports = { assertCompletePlacementCoverage, evaluatePlacementCoverage }

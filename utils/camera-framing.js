const DEGREE = Math.PI / 180

// Camera coordinates: right, up and forward. World x is ground setback,
// world y is target width, world z is height. Image bounds are dimensionless
// coordinates on a plane one unit in front of the lens, not world facades.
function cameraBasis(pitchDegrees) {
  const pitch = pitchDegrees * DEGREE
  return {
    forward: { x: Math.cos(pitch), y: 0, z: Math.sin(pitch) },
    right: { x: 0, y: 1, z: 0 },
    up: { x: -Math.sin(pitch), y: 0, z: Math.cos(pitch) },
  }
}

function projectCameraPoint(point, cameraHeight, basis) {
  const z = point.z - cameraHeight
  const depth = point.x * basis.forward.x + z * basis.forward.z
  if (!(depth > 0)) return null
  return {
    u: point.y / depth,
    v: (point.x * basis.up.x + z * basis.up.z) / depth,
    depth,
  }
}

function targetCorners({ distance, width, depth = 0, bottom = 0, top }) {
  const points = []
  for (const x of depth > 0 ? [distance, distance + depth] : [distance]) {
    for (const y of [-width / 2, width / 2]) {
      for (const z of [bottom, top]) points.push({ x, y, z })
    }
  }
  return points
}

function expandBounds(bounds, marginRatio) {
  const centerU = (bounds.minU + bounds.maxU) / 2
  const centerV = (bounds.minV + bounds.maxV) / 2
  const halfU = (bounds.maxU - bounds.minU) * (1 + marginRatio) / 2
  const halfV = (bounds.maxV - bounds.minV) * (1 + marginRatio) / 2
  return { minU: centerU - halfU, maxU: centerU + halfU, minV: centerV - halfV, maxV: centerV + halfV }
}

function framingEnvelope({ distance, width, depth = 0, bottom = 0, top, cameraHeight, marginRatio = 0, pitchDegrees }) {
  const points = targetCorners({ distance, width, depth, bottom, top })
  const angles = points.map((point) => Math.atan2(point.z - cameraHeight, point.x) / DEGREE)
  const pitch = Number.isFinite(pitchDegrees)
    ? pitchDegrees : (Math.min(...angles) + Math.max(...angles)) / 2
  const basis = cameraBasis(pitch)
  const projected = points.map((point) => projectCameraPoint(point, cameraHeight, basis))
  if (projected.some((point) => !point)) return null
  const target = {
    minU: Math.min(...projected.map((point) => point.u)),
    maxU: Math.max(...projected.map((point) => point.u)),
    minV: Math.min(...projected.map((point) => point.v)),
    maxV: Math.max(...projected.map((point) => point.v)),
  }
  const expanded = expandBounds(target, marginRatio)
  return {
    pitchDegrees: pitch,
    target,
    expanded,
    requiredHorizontalFov: 2 * Math.atan(Math.max(Math.abs(expanded.minU), Math.abs(expanded.maxU))) / DEGREE,
    requiredVerticalFov: 2 * Math.atan(Math.max(Math.abs(expanded.minV), Math.abs(expanded.maxV))) / DEGREE,
  }
}

function solveFramingDistance(options, horizontalFov, verticalFov = null, horizontalMinimumDistance = null) {
  const scale = Math.max(options.width, options.depth || 0, options.top - options.bottom, options.cameraHeight)
  if (!(scale > 0) || !Number.isFinite(scale)) return null
  const evaluate = (distance) => framingEnvelope({ ...options, distance })
  const fits = (envelope) => envelope
    && envelope.requiredHorizontalFov <= horizontalFov + 1e-10
    && (verticalFov === null || envelope.requiredVerticalFov <= verticalFov + 1e-10)
  let lower = scale * 1e-10
  if (verticalFov !== null) {
    // A target entirely above/below the lens can have both a near and a far
    // vertical feasible interval. Begin at the horizontal minimum: if it is
    // vertically feasible it is already the first joint solution; otherwise
    // only the far vertical crossing remains. Starting a joint bisection at
    // zero could jump over a narrow, valid near interval.
    const horizontal = horizontalMinimumDistance === null
      ? solveFramingDistance(options, horizontalFov) : { distance: horizontalMinimumDistance }
    if (!horizontal) return null
    lower = horizontal.distance
  }
  let upper = Math.max(scale, lower)
  if (fits(evaluate(lower))) upper = lower
  else {
    let iterations = 0
    while (!fits(evaluate(upper)) && iterations < 80) {
      upper *= 2
      iterations += 1
    }
    if (!Number.isFinite(upper) || !fits(evaluate(upper))) return null
    for (let index = 0; index < 80; index += 1) {
      const middle = (lower + upper) / 2
      if (fits(evaluate(middle))) upper = middle
      else lower = middle
    }
  }
  return { distance: upper, ...evaluate(upper) }
}

module.exports = { cameraBasis, projectCameraPoint, targetCorners, expandBounds, framingEnvelope, solveFramingDistance }

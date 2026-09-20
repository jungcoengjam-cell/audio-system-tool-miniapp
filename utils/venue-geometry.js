const DEFAULT_EAR_HEIGHT_METERS = 1.2

function degrees(value) {
  return value * 180 / Math.PI
}

function radians(value) {
  return value * Math.PI / 180
}

function transformPointToSpeakerAngles(point, source, speakerCenterHeightMeters, earHeightMeters = DEFAULT_EAR_HEIGHT_METERS) {
  const right = point.widthMeters - source.widthMeters
  const forward = point.depthMeters - source.depthMeters
  const down = speakerCenterHeightMeters - earHeightMeters
  const yaw = radians(Number(source.aimYawDeg) || 0)
  const pitch = radians(Number(source.aimDownDeg) || 0)
  const aimedRight = (right * Math.cos(yaw)) - (forward * Math.sin(yaw))
  const horizontalForward = (forward * Math.cos(yaw)) + (right * Math.sin(yaw))
  const aimedForward = (horizontalForward * Math.cos(pitch)) + (down * Math.sin(pitch))
  const aimedDown = (-horizontalForward * Math.sin(pitch)) + (down * Math.cos(pitch))
  return {
    yawDeg: degrees(Math.atan2(aimedRight, aimedForward)),
    pitchDeg: degrees(Math.atan2(aimedDown, aimedForward)),
    rightMeters: right,
    forwardMeters: forward,
    horizontalDistanceMeters: Math.hypot(right, forward),
    pathDistanceMeters: Math.hypot(right, forward, down),
    localRightMeters: aimedRight,
    localForwardMeters: aimedForward,
    localDownMeters: aimedDown,
  }
}

function getCoverageMetrics(points, source, speakerCenterHeightMeters) {
  const angles = points.map((point) => transformPointToSpeakerAngles(
    point,
    source,
    speakerCenterHeightMeters,
  ))
  const yawExtent = angles.reduce((maximum, item) => Math.max(maximum, Math.abs(item.yawDeg)), 0)
  const pitchExtent = angles.reduce((maximum, item) => Math.max(maximum, Math.abs(item.pitchDeg)), 0)
  const nearest = angles.reduce((best, item) => item.pathDistanceMeters < best.pathDistanceMeters ? item : best)
  const farthest = angles.reduce((best, item) => item.pathDistanceMeters > best.pathDistanceMeters ? item : best)
  return {
    requiredHorizontalCoverageRaw: yawExtent * 2,
    requiredVerticalCoverageRaw: pitchExtent * 2,
    nearestDistanceRaw: nearest.pathDistanceMeters,
    farthestDistanceRaw: farthest.pathDistanceMeters,
    nearestHorizontalDistanceRaw: nearest.horizontalDistanceMeters,
    farthestHorizontalDistanceRaw: farthest.horizontalDistanceMeters,
    angles,
  }
}

function getCoverageHalfPlaneFunctions(source, speakerCenterHeightMeters, horizontalCoverageDeg, verticalCoverageDeg) {
  const yaw = radians(Number(source.aimYawDeg) || 0)
  const pitch = radians(Number(source.aimDownDeg) || 0)
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)
  const down = speakerCenterHeightMeters - DEFAULT_EAR_HEIGHT_METERS
  const horizontalTangent = Math.tan(radians(horizontalCoverageDeg / 2))
  const verticalTangent = Math.tan(radians(verticalCoverageDeg / 2))
  const evaluate = (x, y) => {
    const right = x - source.widthMeters
    const forward = y - source.depthMeters
    const aimedRight = (right * cosYaw) - (forward * sinYaw)
    const horizontalForward = (forward * cosYaw) + (right * sinYaw)
    const aimedForward = (horizontalForward * cosPitch) + (down * sinPitch)
    const aimedDown = (-horizontalForward * sinPitch) + (down * cosPitch)
    return { aimedRight, aimedForward, aimedDown }
  }
  return [
    (x, y) => evaluate(x, y).aimedForward,
    (x, y) => (horizontalTangent * evaluate(x, y).aimedForward) - evaluate(x, y).aimedRight,
    (x, y) => (horizontalTangent * evaluate(x, y).aimedForward) + evaluate(x, y).aimedRight,
    (x, y) => (verticalTangent * evaluate(x, y).aimedForward) - evaluate(x, y).aimedDown,
    (x, y) => (verticalTangent * evaluate(x, y).aimedForward) + evaluate(x, y).aimedDown,
  ]
}

function clipPolygonByHalfPlane(polygon, evaluate) {
  if (!polygon.length) return []
  const clipped = []
  const epsilon = 1e-10
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    const currentValue = evaluate(current.x, current.y)
    const previousValue = evaluate(previous.x, previous.y)
    const currentInside = currentValue >= -epsilon
    const previousInside = previousValue >= -epsilon
    if (currentInside !== previousInside) {
      const denominator = previousValue - currentValue
      const ratio = Math.abs(denominator) > epsilon ? previousValue / denominator : 0
      clipped.push({
        x: previous.x + ((current.x - previous.x) * ratio),
        y: previous.y + ((current.y - previous.y) * ratio),
      })
    }
    if (currentInside) clipped.push(current)
  })
  return clipped
}

function buildReportCoveragePolygon(source, plan, speakerCenterHeightMeters) {
  const endDepthMeters = Number(source.coverageEndDepthMeters)
  const startDepthMeters = Number(source.depthMeters) || 0
  if (!Number.isFinite(endDepthMeters) || endDepthMeters <= startDepthMeters) return []
  const room = {
    left: 0,
    right: plan.roomWidthMeters,
    top: Math.max(0, startDepthMeters),
    bottom: Math.min(plan.roomDepthMeters, endDepthMeters),
  }
  if (room.bottom <= room.top) return []
  let polygon = [
    { x: room.left, y: room.top },
    { x: room.right, y: room.top },
    { x: room.right, y: room.bottom },
    { x: room.left, y: room.bottom },
  ]
  const horizontalCoverageDeg = Number.isFinite(Number(source.coverageDeg)) ? Number(source.coverageDeg) : 0
  const verticalCoverageDeg = Number.isFinite(Number(source.verticalCoverageDeg)) ? Number(source.verticalCoverageDeg) : 180
  getCoverageHalfPlaneFunctions(
    source,
    Number.isFinite(Number(speakerCenterHeightMeters)) ? Number(speakerCenterHeightMeters) : 2.5,
    horizontalCoverageDeg,
    verticalCoverageDeg,
  ).forEach((evaluate) => {
    polygon = clipPolygonByHalfPlane(polygon, evaluate)
  })
  return polygon
}

module.exports = {
  DEFAULT_EAR_HEIGHT_METERS,
  transformPointToSpeakerAngles,
  getCoverageMetrics,
  buildReportCoveragePolygon,
}

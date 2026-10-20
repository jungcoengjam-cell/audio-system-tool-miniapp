const { cameraBasis, framingEnvelope } = require('../../utils/camera-framing')

const DEGREE = Math.PI / 180
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
const add = (point, direction, length) => ({
  x: point.x + direction.x * length, y: point.y + direction.y * length, z: point.z + direction.z * length,
})

function frameOnCameraPlane(bounds, lens, basis, depth) {
  const center = add(lens, basis.forward, depth)
  return [[bounds.minU, bounds.minV], [bounds.maxU, bounds.minV],
    [bounds.maxU, bounds.maxV], [bounds.minU, bounds.maxV]].map(([u, v]) => (
    add(add(center, basis.right, u * depth), basis.up, v * depth)
  ))
}

function rayToFront(lens, basis, distance, u, v) {
  const direction = add(add(basis.forward, basis.right, u), basis.up, v)
  if (!(direction.x > 1e-12)) return null
  return add(lens, direction, distance / direction.x)
}

function buildCameraScene(result) {
  if (!result) return null
  const ground = result.sceneMode === 'ground'
  const dimensions = result.worldDimensions || {
    width: Number(result.widthMeters), depth: ground ? Number(result.depthMeters) : 0,
    bottom: ground ? 0 : Number(result.bottomHeightMeters),
    top: ground ? Number(result.subjectHeightMeters) : Number(result.bottomHeightMeters) + Number(result.heightMeters),
    cameraHeight: Number(result.cameraHeightMeters),
  }
  const { width, depth, bottom, top, cameraHeight } = dimensions
  const distance = finite(result.calculationDistanceMeters)
    ? Number(result.calculationDistanceMeters) + (result.framingVersion === 2 || !ground ? 0 : Number(result.depthMarginMeters) || 0)
    : Number(result.primaryDistanceMeters)
  const pitchDegrees = [result.calculationAimAngleDegrees, result.aimAngleDegrees, result.referenceAimAngleDegrees]
    .find(finite) ?? ((result.aimDirection === '向下' ? -1 : 1) * (Number(result.tiltDegrees) || 0))
  if (![width, distance, cameraHeight].every((value) => Number.isFinite(value) && value > 0)
    || ![depth, bottom, top, Number(pitchDegrees)].every(Number.isFinite)) return null
  const lens = { x: 0, y: 0, z: cameraHeight }
  const groundProjection = { x: 0, y: 0, z: 0 }
  const frontCenter = { x: distance, y: 0, z: 0 }
  const basis = cameraBasis(Number(pitchDegrees))
  const envelope = framingEnvelope({ distance, width, depth, bottom, top, cameraHeight, pitchDegrees: Number(pitchDegrees) })
  if (!envelope) return null
  const marginRatio = Number(result.marginRatio) || Number(result.marginPercent) / 100 || 0
  let framing = result.framingBounds
  if (!framing) {
    // Historical calculations expanded physical ground depth and height.
    // Show their actual old envelope, without relabelling it as a v2 margin.
    const old = framingEnvelope({
      distance: ground ? distance - (Number(result.depthMarginMeters) || 0) : distance,
      width: width * (1 + marginRatio), depth: ground ? depth * (1 + marginRatio) : 0,
      bottom: ground ? 0 : bottom - (top - bottom) * marginRatio / 2,
      top: ground ? top * (1 + marginRatio) : top + (top - bottom) * marginRatio / 2,
      cameraHeight, pitchDegrees: Number(pitchDegrees),
    })
    const centerHeight = (bottom + top) / 2
    framing = { target: envelope.target, expanded: old?.target || envelope.target,
      referenceDepthMeters: distance * basis.forward.x + (centerHeight - cameraHeight) * basis.forward.z }
  }
  const innerFrame = frameOnCameraPlane(framing.target, lens, basis, framing.referenceDepthMeters)
  const outerFrame = marginRatio > 0 ? frameOnCameraPlane(framing.expanded, lens, basis, framing.referenceDepthMeters) : null
  const hTangent = Math.tan(Number(result.calculationHorizontalFov ?? result.horizontalFov) * DEGREE / 2)
  const sections = [{
    axis: 'horizontal', points: [lens,
      rayToFront(lens, basis, distance, -hTangent, 0), rayToFront(lens, basis, distance, hTangent, 0)],
  }]
  if (!result.horizontalOnly && finite(result.verticalFov)) {
    const vTangent = Math.tan(Number(result.calculationVerticalFov ?? result.verticalFov) * DEGREE / 2)
    const low = rayToFront(lens, basis, distance, 0, -vTangent)
    const high = rayToFront(lens, basis, distance, 0, vTangent)
    // At extreme pitch a FOV boundary may never meet the front plane in
    // front of the lens. Use the finite target section and mark that clip.
    sections.push({ axis: 'vertical', clipped: !low || !high, points: [lens,
      low || rayToFront(lens, basis, distance, 0, envelope.target.minV),
      high || rayToFront(lens, basis, distance, 0, envelope.target.maxV)] })
  }
  const site = [
    { x: distance, y: -width / 2, z: bottom }, { x: distance + depth, y: -width / 2, z: bottom },
    { x: distance + depth, y: width / 2, z: bottom }, { x: distance, y: width / 2, z: bottom },
  ]
  const siteTop = site.map((point) => ({ ...point, z: top }))
  const bodySize = Math.min(width * 0.12, cameraHeight * 0.32, (top - bottom) * 0.45)
  const body = []
  for (const f of [-bodySize, -bodySize * 0.06]) {
    for (const r of [-bodySize * 0.32, bodySize * 0.32]) {
      for (const u of [-bodySize * 0.29, bodySize * 0.29]) body.push(add(add(add(lens, basis.forward, f), basis.right, r), basis.up, u))
    }
  }
  const people = ground ? [[0.24, -0.28], [0.78, -0.28], [0.24, 0.28], [0.78, 0.28]]
    .map(([x, y]) => ({ x: distance + depth * x, y: width * y, z: 0, height: top })) : []
  return { ground, dimensions, distance, pitchDegrees: Number(pitchDegrees), basis, lens, groundProjection, frontCenter,
    site, siteTop, innerFrame, outerFrame, marginRatio, sections: sections.filter((section) => section.points.every(Boolean)),
    body, bodySize, people, historical: result.framingVersion !== 2, horizontalOnly: Boolean(result.horizontalOnly) }
}

// A single orthographic camera, rotated 45 degrees in plan and 30 in elevation.
// The two screen axes are orthonormal: every world point uses one scale.
function orthographicPoint(point) {
  return { x: (point.x + point.y) * Math.SQRT1_2,
    y: (-point.x + point.y) * Math.SQRT1_2 * 0.5 - point.z * Math.sqrt(0.75) }
}

function fitCameraScene(scene, width, height) {
  const points = [scene.lens, scene.groundProjection, ...scene.site, ...scene.siteTop, ...scene.innerFrame,
    ...(scene.outerFrame || []), ...scene.body, ...scene.sections.flatMap((section) => section.points)]
    .map(orthographicPoint)
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const side = Math.min(30, width * 0.08)
  const top = Math.min(98, height * 0.26)
  const bottom = Math.min(100, height * 0.26)
  const scale = Math.min((width - side * 2) / Math.max(maxX - minX, 1e-12),
    (height - top - bottom) / Math.max(maxY - minY, 1e-12))
  const centerX = width / 2 - (minX + maxX) * scale / 2
  const centerY = top + (height - top - bottom) / 2 - (minY + maxY) * scale / 2
  return { scale, project: (point) => {
    const projected = orthographicPoint(point)
    return { x: centerX + projected.x * scale, y: centerY + projected.y * scale }
  } }
}

module.exports = { buildCameraScene, fitCameraScene, orthographicPoint }

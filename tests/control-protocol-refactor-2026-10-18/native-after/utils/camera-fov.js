const { solveFramingDistance } = require('./camera-framing')
const DEGREE = Math.PI / 180

function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function positive(value) {
  return Number.isFinite(value) && value > 0
}

function isAngle(value) {
  return positive(value) && value < 179
}

function angleFromRatio(numerator, denominator) {
  return 2 * Math.atan(numerator / (2 * denominator)) / DEGREE
}

function diagonalFromAxes(horizontalFov, verticalFov) {
  if (!isAngle(horizontalFov) || !isAngle(verticalFov)) return null
  return 2 * Math.atan(Math.hypot(
    Math.tan(horizontalFov * DEGREE / 2),
    Math.tan(verticalFov * DEGREE / 2),
  )) / DEGREE
}

function resolveAxisFov(view, endpoint, axis) {
  const suffix = endpoint === 'tele' ? 'Tele' : 'Wide'
  return Number(view[`${axis}${suffix}`])
}

function resolveLibraryFov(camera, viewIndex = 0, endpoint = 'wide') {
  const view = camera?.views?.[viewIndex]
  if (!view) return null
  const hasTele = isAngle(Number(view.hTele)) && isAngle(Number(view.vTele))
  if (endpoint === 'tele' && !hasTele) return null
  const safeEndpoint = endpoint === 'tele' && hasTele ? 'tele' : 'wide'
  const horizontalFov = resolveAxisFov(view, safeEndpoint, 'h')
  const verticalFov = resolveAxisFov(view, safeEndpoint, 'v')
  if (!isAngle(horizontalFov) || !isAngle(verticalFov)) return null

  const suffix = safeEndpoint === 'tele' ? 'Tele' : 'Wide'
  const focalLength = Number(view[`focal${suffix}Mm`]) || null
  return {
    camera,
    view,
    endpoint: safeEndpoint,
    endpointLabel: hasTele ? (safeEndpoint === 'tele' ? '长焦端全区域参考' : '广角端全景') : '固定视角',
    focalLength,
    horizontalFov,
    verticalFov,
    diagonalFov: diagonalFromAxes(horizontalFov, verticalFov),
    verticalSource: '厂家说明书标注',
    fovSource: '厂家说明书水平/垂直视场角',
  }
}

function resolveLibraryHorizontalFov(camera, viewIndex = 0, endpoint = 'wide') {
  const view = camera?.views?.[viewIndex]
  if (!view) return null
  const hasTele = isAngle(Number(view.hTele))
  if (endpoint === 'tele' && !hasTele) return null
  const safeEndpoint = endpoint === 'tele' && hasTele ? 'tele' : 'wide'
  const horizontalFov = resolveAxisFov(view, safeEndpoint, 'h')
  if (!isAngle(horizontalFov)) return null
  const suffix = safeEndpoint === 'tele' ? 'Tele' : 'Wide'
  return {
    camera,
    view,
    endpoint: safeEndpoint,
    endpointLabel: hasTele
      ? (safeEndpoint === 'tele' ? '长焦端水平参考' : '广角端水平预估')
      : '固定视角水平预估',
    focalLength: Number(view[`focal${suffix}Mm`]) || null,
    horizontalFov,
    verticalFov: null,
    diagonalFov: null,
    horizontalOnly: true,
    verticalSource: '说明书未提供',
    fovSource: '厂家说明书水平视场角',
  }
}

function resolveLibraryOptics(camera, viewIndex = 0, endpoint = 'wide') {
  return resolveLibraryFov(camera, viewIndex, endpoint)
    || resolveLibraryHorizontalFov(camera, viewIndex, endpoint)
}

function resolveCustomFov(options) {
  const definitionMode = options.definitionMode || 'angles'
  let horizontalFov
  let verticalFov
  let verticalSource

  if (definitionMode === 'sensor') {
    const sensorWidth = Number(options.sensorWidth)
    const sensorHeight = Number(options.sensorHeight)
    const focalLength = Number(options.focalLength)
    if (![sensorWidth, sensorHeight, focalLength].every(positive)) return null
    horizontalFov = angleFromRatio(sensorWidth, focalLength)
    verticalFov = angleFromRatio(sensorHeight, focalLength)
    verticalSource = '由有效传感器尺寸与焦距计算'
  } else {
    horizontalFov = Number(options.horizontalFov)
    verticalFov = Number(options.verticalFov)
    verticalSource = '用户输入'
  }

  if (!isAngle(horizontalFov) || !isAngle(verticalFov)) return null
  return {
    horizontalFov,
    verticalFov,
    diagonalFov: diagonalFromAxes(horizontalFov, verticalFov),
    verticalSource,
    fovSource: definitionMode === 'sensor' ? '传感器与焦距理论计算' : '自定义视场角',
  }
}

function calculateCoverage(fov, options = {}) {
  if (
    !fov
    || !isAngle(fov.horizontalFov)
    || !isAngle(fov.verticalFov)
    || !Number.isFinite(fov.diagonalFov)
  ) return null
  const calculationMode = options.calculationMode || 'distance'
  const horizontalTangent = Math.tan(fov.horizontalFov * DEGREE / 2)
  const verticalTangent = Math.tan(fov.verticalFov * DEGREE / 2)
  let distanceMeters = Number(options.distanceMeters)
  let coverageWidthMeters

  if (calculationMode === 'targetWidth') {
    coverageWidthMeters = Number(options.targetWidthMeters)
    if (!positive(coverageWidthMeters)) return null
    distanceMeters = coverageWidthMeters / (2 * horizontalTangent)
  } else {
    if (!positive(distanceMeters)) return null
    coverageWidthMeters = 2 * distanceMeters * horizontalTangent
  }

  const coverageHeightMeters = 2 * distanceMeters * verticalTangent
  const result = {
    ...fov,
    calculationMode,
    distanceMeters: round(distanceMeters, 2),
    coverageWidthMeters: round(coverageWidthMeters, 2),
    coverageHeightMeters: round(coverageHeightMeters, 2),
    coverageAreaSquareMeters: round(coverageWidthMeters * coverageHeightMeters, 2),
    horizontalFov: round(fov.horizontalFov, 1),
    verticalFov: round(fov.verticalFov, 1),
    diagonalFov: round(fov.diagonalFov, 1),
  }
  const requiredNumbers = [
    result.distanceMeters,
    result.coverageWidthMeters,
    result.coverageHeightMeters,
    result.coverageAreaSquareMeters,
    result.horizontalFov,
    result.verticalFov,
    result.diagonalFov,
  ]
  return requiredNumbers.every(Number.isFinite) ? result : null
}

function angleToPoint(heightOffset, horizontalDistance) {
  return Math.atan2(heightOffset, horizontalDistance) / DEGREE
}

function horizontalAngleForWidth(widthMeters, distanceMeters) {
  return 2 * Math.atan(widthMeters / (2 * distanceMeters)) / DEGREE
}

function getVerticalEnvelope(points, cameraHeightMeters, distanceOffset = 0) {
  const angles = points.map(({ distance, height }) => (
    angleToPoint(height - cameraHeightMeters, distance + distanceOffset)
  ))
  const minimumAngle = Math.min(...angles)
  const maximumAngle = Math.max(...angles)
  return {
    minimumAngle,
    maximumAngle,
    spanDegrees: maximumAngle - minimumAngle,
    aimAngleDegrees: (maximumAngle + minimumAngle) / 2,
  }
}

function solveMinimumDistance(getSpanDegrees, availableFov, lower) {
  if (!isAngle(availableFov) || !positive(lower)) return null
  if (getSpanDegrees(lower) <= availableFov) return lower
  let upper = lower
  while (getSpanDegrees(upper) > availableFov && upper < 100000) upper *= 2
  if (upper >= 100000 && getSpanDegrees(upper) > availableFov) return null
  for (let index = 0; index < 70; index += 1) {
    const middle = (lower + upper) / 2
    if (getSpanDegrees(middle) > availableFov) lower = middle
    else upper = middle
  }
  return upper
}

function describeAim(angleDegrees) {
  if (Math.abs(angleDegrees) < 0.05) return { direction: '水平', degrees: 0, text: '水平拍摄' }
  const direction = angleDegrees < 0 ? '向下' : '向上'
  const degrees = round(Math.abs(angleDegrees), 1)
  return { direction, degrees, text: `${direction} ${degrees}°` }
}

function decoratePlacement(fov, values) {
  if (Object.values(values).some((value) => typeof value === 'number' && !Number.isFinite(value))
    || values.requiredHorizontalFov > fov.horizontalFov + 1e-9
    || values.requiredVerticalFov > fov.verticalFov + 1e-9) return null
  return {
    ...fov,
    ...values,
    coverageVerified: true,
    horizontalFov: round(fov.horizontalFov, 1),
    verticalFov: round(fov.verticalFov, 1),
    diagonalFov: round(fov.diagonalFov, 1),
    requiredHorizontalFov: round(values.requiredHorizontalFov, 1),
    requiredVerticalFov: round(values.requiredVerticalFov, 1),
    horizontalUtilizationPercent: round(values.requiredHorizontalFov / fov.horizontalFov * 100),
    verticalUtilizationPercent: round(values.requiredVerticalFov / fov.verticalFov * 100),
    marginPercent: round(values.marginRatio * 100),
  }
}

function describeDistanceConstraint(horizontalDistance, verticalDistance) {
  return verticalDistance <= horizontalDistance + 1e-9
    ? '水平下限处垂直校核通过'
    : '垂直校核增距'
}

function decorateHorizontalPlacement(fov, values) {
  return {
    ...fov,
    ...values,
    horizontalOnly: true,
    verticalCoverageVerified: false,
    horizontalFov: round(fov.horizontalFov, 1),
    requiredHorizontalFov: round(values.requiredHorizontalFov, 1),
    horizontalUtilizationPercent: round(values.requiredHorizontalFov / fov.horizontalFov * 100),
    marginPercent: round(values.marginRatio * 100),
    distanceConstraintText: '仅按说明书水平视场角计算；缺少垂直视场角，不能校核上下边界与完整安装距离',
  }
}

function calculateLegacyHorizontalOnlyPlacement(fov, options = {}) {
  if (!fov || !isAngle(fov.horizontalFov)) return null
  const sceneMode = options.sceneMode === 'plane' ? 'plane' : 'ground'
  const widthMeters = Number(options.widthMeters)
  const marginRatio = Number(options.marginRatio)
  const safeMargin = Number.isFinite(marginRatio) && marginRatio >= 0 && marginRatio <= 0.5
    ? marginRatio
    : 0.1
  const heightMode = options.heightMode === 'fixed' ? 'fixed' : 'auto'
  if (!positive(widthMeters)) return null

  const effectiveWidth = widthMeters * (1 + safeMargin)
  const horizontalDistance = effectiveWidth / (2 * Math.tan(fov.horizontalFov * DEGREE / 2))
  const requiredHorizontalFov = horizontalAngleForWidth(effectiveWidth, horizontalDistance)

  if (sceneMode === 'plane') {
    const heightMeters = Number(options.heightMeters)
    const bottomHeightMeters = Number(options.bottomHeightMeters)
    const cameraHeightMeters = heightMode === 'fixed'
      ? Number(options.cameraHeightMeters)
      : bottomHeightMeters + heightMeters / 2
    if (![heightMeters, cameraHeightMeters].every(positive)
      || !Number.isFinite(bottomHeightMeters) || bottomHeightMeters < 0) return null
    const aim = describeAim(angleToPoint(
      bottomHeightMeters + heightMeters / 2 - cameraHeightMeters,
      horizontalDistance,
    ))
    return decorateHorizontalPlacement(fov, {
      sceneMode,
      sceneLabel: '垂直平面',
      widthMeters: round(widthMeters, 2),
      heightMeters: round(heightMeters, 2),
      bottomHeightMeters: round(bottomHeightMeters, 2),
      cameraHeightMeters: round(cameraHeightMeters, 2),
      heightMode,
      heightBasis: heightMode === 'auto' ? '镜头中心与目标中心等高' : '按现场固定高度给出初始瞄准角',
      effectiveWidthMeters: round(effectiveWidth, 2),
      horizontalMinimumDistanceMeters: round(horizontalDistance, 2),
      distanceMeters: round(horizontalDistance, 2),
      frameWidthMeters: round(2 * horizontalDistance * Math.tan(fov.horizontalFov * DEGREE / 2), 2),
      requiredHorizontalFov,
      aimDirection: aim.direction,
      tiltDegrees: aim.degrees,
      aimText: aim.text,
      marginRatio: safeMargin,
      primaryDistanceLabel: '水平覆盖距目标平面',
      primaryDistanceMeters: round(horizontalDistance, 2),
    })
  }

  const depthMeters = Number(options.depthMeters)
  const subjectHeightMeters = Number(options.subjectHeightMeters)
  const cameraHeightMeters = heightMode === 'fixed'
    ? Number(options.cameraHeightMeters)
    : Math.max(1.5, subjectHeightMeters + 0.5)
  if (![depthMeters, subjectHeightMeters, cameraHeightMeters].every(positive)) return null
  const effectiveDepth = depthMeters * (1 + safeMargin)
  const effectiveSubjectHeight = subjectHeightMeters * (1 + safeMargin)
  const depthMarginEachSide = (effectiveDepth - depthMeters) / 2
  const cameraSetbackMeters = horizontalDistance + depthMarginEachSide
  const envelope = getVerticalEnvelope([
    { distance: 0, height: 0 },
    { distance: 0, height: effectiveSubjectHeight },
    { distance: effectiveDepth, height: 0 },
    { distance: effectiveDepth, height: effectiveSubjectHeight },
  ], cameraHeightMeters, horizontalDistance)
  const aim = describeAim(envelope.aimAngleDegrees)
  return decorateHorizontalPlacement(fov, {
    sceneMode,
    sceneLabel: '地面区域',
    widthMeters: round(widthMeters, 2),
    depthMeters: round(depthMeters, 2),
    subjectHeightMeters: round(subjectHeightMeters, 2),
    cameraHeightMeters: round(cameraHeightMeters, 2),
    heightMode,
    heightBasis: heightMode === 'auto' ? '人物最高点 + 0.5 m 安装余量' : '按现场固定高度给出初始瞄准角',
    effectiveWidthMeters: round(effectiveWidth, 2),
    effectiveDepthMeters: round(effectiveDepth, 2),
    effectiveSubjectHeightMeters: round(effectiveSubjectHeight, 2),
    horizontalMinimumDistanceMeters: round(horizontalDistance, 2),
    depthMarginMeters: round(depthMarginEachSide, 2),
    cameraSetbackMeters: round(cameraSetbackMeters, 2),
    distanceToCenterMeters: round(cameraSetbackMeters + depthMeters / 2, 2),
    distanceToFarEdgeMeters: round(cameraSetbackMeters + depthMeters, 2),
    effectiveNearDistanceMeters: round(horizontalDistance, 2),
    requiredHorizontalFov,
    aimDirection: aim.direction,
    tiltDegrees: aim.degrees,
    aimText: aim.text,
    marginRatio: safeMargin,
    primaryDistanceLabel: '水平覆盖距区域前沿',
    primaryDistanceMeters: round(cameraSetbackMeters, 2),
  })
}

function calculateLegacyGroundAreaPlacement(fov, options = {}) {
  if (!fov || !isAngle(fov.horizontalFov) || !isAngle(fov.verticalFov)) return null
  const widthMeters = Number(options.widthMeters)
  const depthMeters = Number(options.depthMeters)
  const subjectHeightMeters = Number(options.subjectHeightMeters)
  const marginRatio = Number(options.marginRatio)
  const safeMargin = Number.isFinite(marginRatio) && marginRatio >= 0 && marginRatio <= 0.5
    ? marginRatio
    : 0.1
  const heightMode = options.heightMode === 'fixed' ? 'fixed' : 'auto'
  const cameraHeightMeters = heightMode === 'fixed'
    ? Number(options.cameraHeightMeters)
    : Math.max(1.5, subjectHeightMeters + 0.5)
  if (![widthMeters, depthMeters, subjectHeightMeters, cameraHeightMeters].every(positive)) return null

  const effectiveWidth = widthMeters * (1 + safeMargin)
  const effectiveDepth = depthMeters * (1 + safeMargin)
  const effectiveSubjectHeight = subjectHeightMeters * (1 + safeMargin)
  const depthMarginEachSide = (effectiveDepth - depthMeters) / 2
  const minimumNearDistanceForWidth = effectiveWidth
    / (2 * Math.tan(fov.horizontalFov * DEGREE / 2))
  const verticalPoints = [
    { distance: 0, height: 0 },
    { distance: 0, height: effectiveSubjectHeight },
    { distance: effectiveDepth, height: 0 },
    { distance: effectiveDepth, height: effectiveSubjectHeight },
  ]
  const effectiveNearDistance = solveMinimumDistance(
    (distance) => getVerticalEnvelope(verticalPoints, cameraHeightMeters, distance).spanDegrees,
    fov.verticalFov,
    minimumNearDistanceForWidth,
  )
  if (!Number.isFinite(effectiveNearDistance)) return null

  const cameraSetbackMeters = effectiveNearDistance + depthMarginEachSide
  const envelope = getVerticalEnvelope(verticalPoints, cameraHeightMeters, effectiveNearDistance)
  const requiredHorizontalFov = horizontalAngleForWidth(effectiveWidth, effectiveNearDistance)
  const aim = describeAim(envelope.aimAngleDegrees)

  return decoratePlacement(fov, {
    sceneMode: 'ground',
    sceneLabel: '地面区域',
    widthMeters: round(widthMeters, 2),
    depthMeters: round(depthMeters, 2),
    subjectHeightMeters: round(subjectHeightMeters, 2),
    cameraHeightMeters: round(cameraHeightMeters, 2),
    heightMode,
    heightBasis: heightMode === 'auto' ? '人物最高点 + 0.5 m 安装余量' : '按现场固定高度校核',
    effectiveWidthMeters: round(effectiveWidth, 2),
    effectiveDepthMeters: round(effectiveDepth, 2),
    effectiveSubjectHeightMeters: round(effectiveSubjectHeight, 2),
    horizontalMinimumDistanceMeters: round(minimumNearDistanceForWidth, 2),
    verticalMinimumDistanceMeters: round(effectiveNearDistance, 2),
    depthMarginMeters: round(depthMarginEachSide, 2),
    cameraSetbackMeters: round(cameraSetbackMeters, 2),
    distanceToCenterMeters: round(cameraSetbackMeters + depthMeters / 2, 2),
    distanceToFarEdgeMeters: round(cameraSetbackMeters + depthMeters, 2),
    effectiveNearDistanceMeters: round(effectiveNearDistance, 2),
    calculationDistanceMeters: effectiveNearDistance,
    requiredHorizontalFov,
    requiredVerticalFov: envelope.spanDegrees,
    distanceConstraintText: describeDistanceConstraint(
      minimumNearDistanceForWidth,
      effectiveNearDistance,
    ),
    aimAngleDegrees: round(envelope.aimAngleDegrees, 1),
    aimDirection: aim.direction,
    tiltDegrees: aim.degrees,
    aimText: aim.text,
    marginRatio: safeMargin,
    primaryDistanceLabel: '距拍摄区前沿',
    primaryDistanceMeters: round(cameraSetbackMeters, 2),
  })
}

function calculateLegacyVerticalPlanePlacement(fov, options = {}) {
  if (!fov || !isAngle(fov.horizontalFov) || !isAngle(fov.verticalFov)) return null
  const widthMeters = Number(options.widthMeters)
  const heightMeters = Number(options.heightMeters)
  const bottomHeightMeters = Number(options.bottomHeightMeters)
  const marginRatio = Number(options.marginRatio)
  const safeMargin = Number.isFinite(marginRatio) && marginRatio >= 0 && marginRatio <= 0.5
    ? marginRatio
    : 0.1
  const heightMode = options.heightMode === 'fixed' ? 'fixed' : 'auto'
  if (![widthMeters, heightMeters].every(positive)
    || !Number.isFinite(bottomHeightMeters) || bottomHeightMeters < 0) return null

  const targetCenterHeight = bottomHeightMeters + heightMeters / 2
  const cameraHeightMeters = heightMode === 'fixed'
    ? Number(options.cameraHeightMeters)
    : targetCenterHeight
  if (!positive(cameraHeightMeters)) return null

  const effectiveWidth = widthMeters * (1 + safeMargin)
  const effectiveHeight = heightMeters * (1 + safeMargin)
  const effectiveBottom = targetCenterHeight - effectiveHeight / 2
  const effectiveTop = targetCenterHeight + effectiveHeight / 2
  const minimumDistanceForWidth = effectiveWidth
    / (2 * Math.tan(fov.horizontalFov * DEGREE / 2))
  const verticalPoints = [
    { distance: 0, height: effectiveBottom },
    { distance: 0, height: effectiveTop },
  ]
  const distanceMeters = solveMinimumDistance(
    (distance) => getVerticalEnvelope(verticalPoints, cameraHeightMeters, distance).spanDegrees,
    fov.verticalFov,
    minimumDistanceForWidth,
  )
  if (!Number.isFinite(distanceMeters)) return null

  const envelope = getVerticalEnvelope(verticalPoints, cameraHeightMeters, distanceMeters)
  const requiredHorizontalFov = horizontalAngleForWidth(effectiveWidth, distanceMeters)
  const aim = describeAim(envelope.aimAngleDegrees)
  const frameBottomAngle = envelope.aimAngleDegrees - fov.verticalFov / 2
  const frameTopAngle = envelope.aimAngleDegrees + fov.verticalFov / 2
  const frameBottomHeight = cameraHeightMeters + distanceMeters * Math.tan(frameBottomAngle * DEGREE)
  const frameTopHeight = cameraHeightMeters + distanceMeters * Math.tan(frameTopAngle * DEGREE)

  return decoratePlacement(fov, {
    sceneMode: 'plane',
    sceneLabel: '垂直平面',
    widthMeters: round(widthMeters, 2),
    heightMeters: round(heightMeters, 2),
    bottomHeightMeters: round(bottomHeightMeters, 2),
    targetCenterHeightMeters: round(targetCenterHeight, 2),
    cameraHeightMeters: round(cameraHeightMeters, 2),
    heightMode,
    heightBasis: heightMode === 'auto' ? '镜头中心与目标中心等高' : '按现场固定高度校核',
    effectiveWidthMeters: round(effectiveWidth, 2),
    effectiveHeightMeters: round(effectiveHeight, 2),
    effectiveBottomHeightMeters: round(effectiveBottom, 2),
    effectiveTopHeightMeters: round(effectiveTop, 2),
    horizontalMinimumDistanceMeters: round(minimumDistanceForWidth, 2),
    verticalMinimumDistanceMeters: round(distanceMeters, 2),
    distanceMeters: round(distanceMeters, 2),
    calculationDistanceMeters: distanceMeters,
    frameWidthMeters: round(2 * distanceMeters * Math.tan(fov.horizontalFov * DEGREE / 2), 2),
    frameHeightMeters: round(frameTopHeight - frameBottomHeight, 2),
    frameBottomHeightMeters: round(frameBottomHeight, 2),
    frameTopHeightMeters: round(frameTopHeight, 2),
    requiredHorizontalFov,
    requiredVerticalFov: envelope.spanDegrees,
    distanceConstraintText: describeDistanceConstraint(
      minimumDistanceForWidth,
      distanceMeters,
    ),
    aimAngleDegrees: round(envelope.aimAngleDegrees, 1),
    aimDirection: aim.direction,
    tiltDegrees: aim.degrees,
    aimText: aim.text,
    marginRatio: safeMargin,
    primaryDistanceLabel: '距目标平面',
    primaryDistanceMeters: round(distanceMeters, 2),
  })
}

// Version 2 applies total linear width/height allowance in the camera image
// cross-section. Physical site depth and height remain untouched. Version 1
// is retained solely to reopen pre-existing saved configurations verbatim.
function calculateFramedPlacement(fov, options, sceneMode, horizontalOnly = false) {
  if (!fov || !isAngle(fov.horizontalFov) || (!horizontalOnly && !isAngle(fov.verticalFov))) return null
  const width = Number(options.widthMeters)
  const ground = sceneMode === 'ground'
  const depth = ground ? Number(options.depthMeters) : 0
  const height = Number(ground ? options.subjectHeightMeters : options.heightMeters)
  const bottom = ground ? 0 : Number(options.bottomHeightMeters)
  const heightMode = options.heightMode === 'fixed' ? 'fixed' : 'auto'
  const cameraHeight = heightMode === 'fixed' ? Number(options.cameraHeightMeters)
    : ground ? Math.max(1.5, height + 0.5) : bottom + height / 2
  const margin = Number(options.marginRatio)
  const marginRatio = Number.isFinite(margin) && margin >= 0 && margin <= 0.5 ? margin : 0.1
  if (![width, height, cameraHeight].every(positive) || (ground && !positive(depth))
    || !Number.isFinite(bottom) || bottom < 0) return null
  const framingOptions = { width, depth, bottom, top: bottom + height, cameraHeight, marginRatio }
  const horizontal = solveFramingDistance(framingOptions, fov.horizontalFov)
  const solved = horizontalOnly ? horizontal : horizontal
    && solveFramingDistance(framingOptions, fov.horizontalFov, fov.verticalFov, horizontal.distance)
  if (!solved || !horizontal) return null
  const distance = solved.distance
  const aim = describeAim(solved.pitchDegrees)
  const axisDepth = distance * Math.cos(solved.pitchDegrees * DEGREE)
    + (bottom + height / 2 - cameraHeight) * Math.sin(solved.pitchDegrees * DEGREE)
  const values = {
    sceneMode, sceneLabel: ground ? '地面区域' : '垂直平面',
    framingVersion: 2, marginSpace: 'camera-normal',
    worldDimensions: { width, depth, bottom, top: bottom + height, cameraHeight },
    widthMeters: round(width, 2), cameraHeightMeters: round(cameraHeight, 2), heightMode,
    heightBasis: heightMode === 'fixed' ? '按现场固定高度校核'
      : ground ? '人物最高点 + 0.5 m 安装余量' : '镜头中心与目标中心等高',
    // These are lengths in the camera-normal cross-section, not site sizes.
    effectiveWidthMeters: round((solved.expanded.maxU - solved.expanded.minU) * axisDepth, 2),
    effectiveHeightMeters: round((solved.expanded.maxV - solved.expanded.minV) * axisDepth, 2),
    horizontalMinimumDistanceMeters: round(horizontal.distance, 2),
    verticalMinimumDistanceMeters: round(distance, 2),
    calculationDistanceMeters: distance, calculationAimAngleDegrees: solved.pitchDegrees,
    calculationHorizontalFov: fov.horizontalFov,
    calculationVerticalFov: horizontalOnly ? null : fov.verticalFov,
    requiredHorizontalFov: solved.requiredHorizontalFov,
    requiredVerticalFov: solved.requiredVerticalFov,
    distanceConstraintText: horizontalOnly ? '仅水平参考，垂直未校核'
      : describeDistanceConstraint(horizontal.distance, distance),
    aimAngleDegrees: horizontalOnly ? null : round(solved.pitchDegrees, 1),
    referenceAimAngleDegrees: solved.pitchDegrees,
    aimDirection: aim.direction, tiltDegrees: aim.degrees, aimText: aim.text,
    marginRatio,
    framingBounds: { target: solved.target, expanded: solved.expanded, referenceDepthMeters: axisDepth },
    primaryDistanceLabel: ground ? '距拍摄区前沿' : '距目标平面',
    primaryDistanceMeters: round(distance, 2),
    ...(ground ? {
      depthMeters: round(depth, 2), subjectHeightMeters: round(height, 2),
      effectiveDepthMeters: round(depth, 2), effectiveSubjectHeightMeters: round(height, 2),
      depthMarginMeters: 0, cameraSetbackMeters: round(distance, 2),
      distanceToCenterMeters: round(distance + depth / 2, 2),
      distanceToFarEdgeMeters: round(distance + depth, 2),
      effectiveNearDistanceMeters: round(distance, 2),
    } : {
      heightMeters: round(height, 2), bottomHeightMeters: round(bottom, 2),
      targetCenterHeightMeters: round(bottom + height / 2, 2),
      distanceMeters: round(distance, 2),
      frameWidthMeters: round(2 * axisDepth * Math.tan(fov.horizontalFov * DEGREE / 2), 2),
      frameHeightMeters: horizontalOnly ? null : round(2 * axisDepth * Math.tan(fov.verticalFov * DEGREE / 2), 2),
    }),
  }
  return horizontalOnly ? decorateHorizontalPlacement(fov, values) : decoratePlacement(fov, values)
}

function calculateGroundAreaPlacement(fov, options = {}) {
  return options.calculationVersion === 1 ? calculateLegacyGroundAreaPlacement(fov, options)
    : calculateFramedPlacement(fov, options, 'ground')
}

function calculateVerticalPlanePlacement(fov, options = {}) {
  return options.calculationVersion === 1 ? calculateLegacyVerticalPlanePlacement(fov, options)
    : calculateFramedPlacement(fov, options, 'plane')
}

function calculateHorizontalOnlyPlacement(fov, options = {}) {
  return options.calculationVersion === 1 ? calculateLegacyHorizontalOnlyPlacement(fov, options)
    : calculateFramedPlacement(fov, options, options.sceneMode === 'plane' ? 'plane' : 'ground', true)
}

function getHorizontalCameraViews(camera) {
  return (camera?.views || []).filter((view) => isAngle(Number(view.hWide)))
}

function getCameraMountType(camera, viewIndex = null) {
  return Number.isInteger(viewIndex)
    ? camera?.views?.[viewIndex]?.mountType || camera?.mountType || 'fixed'
    : camera?.mountType || 'fixed'
}

function getCameraMountLabel(camera, viewIndex = null) {
  return {
    ptz: '机械云台',
    eptz: '电子云台（固定安装）',
    fixed: '固定式/枪机',
    mixed: '混合镜头结构',
  }[getCameraMountType(camera, viewIndex)]
}

function getCalculableCameraViews(camera) {
  return (camera?.views || []).filter((view) => (
    isAngle(Number(view.hWide)) && isAngle(Number(view.vWide))
  ))
}

module.exports = {
  calculateCoverage,
  calculateGroundAreaPlacement,
  calculateHorizontalOnlyPlacement,
  calculateVerticalPlanePlacement,
  diagonalFromAxes,
  getCameraMountLabel,
  getCameraMountType,
  getCalculableCameraViews,
  getHorizontalCameraViews,
  resolveCustomFov,
  resolveLibraryFov,
  resolveLibraryHorizontalFov,
  resolveLibraryOptics,
}

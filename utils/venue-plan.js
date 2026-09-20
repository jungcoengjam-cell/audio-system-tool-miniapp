const GRID_COLUMNS = 32
const MIN_GRID_ROWS = 20
const MAX_GRID_ROWS = 48
const LISTENER_EAR_HEIGHT_METERS = 1.2
const FILL_SIDE_WALL_OFFSET_RATIO = 0.1
const REFERENCE_WIDTH_RATIOS = [0.25, 0.5, 0.75]
const FILL_REFERENCE_DEPTH_RATIO = 2 / 3
// 主扩使用目标色带的上半区服务前排，可延长有效接力距离并降低补声工作电平。
const MAIN_TARGET_OFFSET_DB = 3
// 给补声交接保留少量电平余地，避免与主扩叠加后形成连续热点。
const FILL_TARGET_OFFSET_DB = -1
const MUTED_LEVEL_OFFSET_DB = 60
const { buildVenueHandoffReview } = require('./venue-handoff')

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function toEnergy(levelDb) {
  return 10 ** (levelDb / 10)
}

function toDb(energy) {
  return 10 * Math.log10(Math.max(energy, 0.0000001))
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function getDirectLevelAtPoint({ point, source, speakerCenterHeightMeters }) {
  const forwardDistance = point.depthMeters - source.depthMeters
  const lateralDistance = point.widthMeters - source.widthMeters
  const speakerHeight = Number.isFinite(Number(speakerCenterHeightMeters))
    ? Number(speakerCenterHeightMeters)
    : 2.5
  const verticalDelta = speakerHeight - LISTENER_EAR_HEIGHT_METERS
  const verticalDistance = Math.abs(verticalDelta)
  const pathDistance = Math.sqrt(
    (forwardDistance ** 2)
    + (lateralDistance ** 2)
    + (verticalDistance ** 2),
  )

  const sourceLevelAtOneMeter = Number.isFinite(source.levelAtOneMeterRaw)
    ? source.levelAtOneMeterRaw
    : source.levelAtOneMeter
  return sourceLevelAtOneMeter
    - (20 * Math.log10(Math.max(pathDistance, Number.EPSILON)))
}

function getReferencePoints(roomWidthMeters, depthMeters, listeningWidthMeters, sideMarginMeters) {
  const listeningWidth = listeningWidthMeters || roomWidthMeters
  const sideMargin = Number(sideMarginMeters) || 0
  return REFERENCE_WIDTH_RATIOS.map((widthRatio) => ({
    widthMeters: sideMargin + (listeningWidth * widthRatio),
    depthMeters,
  }))
}

function getAimDepthMeters(sourceDepthMeters, verticalDistanceMeters, aimDownDeg, aimYawDeg = 0) {
  const tangent = Math.tan((aimDownDeg * Math.PI) / 180)
  return sourceDepthMeters + (Math.abs(tangent) > 0.000001
    ? (verticalDistanceMeters / tangent) * Math.cos((aimYawDeg * Math.PI) / 180)
    : Number.MAX_SAFE_INTEGER)
}

function getCalibratedLevel({
  sourceTemplates,
  existingSources = [],
  referencePoints,
  targetLevelDb,
  speakerCenterHeightMeters,
}) {
  const targetEnergy = toEnergy(targetLevelDb)
  const candidates = referencePoints.map((point) => {
    const existingEnergy = existingSources.reduce((sum, source) => sum + toEnergy(getDirectLevelAtPoint({
      point,
      source,
      speakerCenterHeightMeters,
    })), 0)
    const requiredEnergy = targetEnergy - existingEnergy
    if (requiredEnergy <= targetEnergy * 0.001) return null

    const transferEnergy = sourceTemplates.reduce((sum, source) => sum + toEnergy(getDirectLevelAtPoint({
      point,
      source: { ...source, levelAtOneMeter: 0 },
      speakerCenterHeightMeters,
    })), 0)
    return transferEnergy > 0 ? toDb(requiredEnergy / transferEnergy) : null
  }).filter(Number.isFinite)

  return candidates.length ? median(candidates) : targetLevelDb - MUTED_LEVEL_OFFSET_DB
}

function getSpeakerSources(result) {
  const roomWidthMeters = result.frontWidthMeters
  const listeningWidthMeters = result.listeningWidth || roomWidthMeters
  const listeningSideMarginMeters = Number.isFinite(result.listeningSideMarginRaw)
    ? result.listeningSideMarginRaw
    : (Number(result.listeningSideMargin) || 0)
  const lastListeningDistanceMeters = Number.isFinite(result.lastListeningDistanceRaw)
    ? result.lastListeningDistanceRaw
    : (result.lastListeningDistance || result.depthMeters)
  const mainProfile = result.speakerRecommendation?.packages?.[0]?.main
  const mainCoverageDeg = mainProfile?.horizontalCoverageDeg || result.recommendedHorizontalCoverage
  const mainVerticalCoverageDeg = mainProfile?.verticalCoverageDeg || result.recommendedVerticalCoverage
  const mainCapability = mainProfile?.maximumSplDb
  const speakerHeight = Number.isFinite(result.speakerCenterHeightRaw)
    ? result.speakerCenterHeightRaw
    : result.speakerCenterHeight
  const verticalDelta = speakerHeight - LISTENER_EAR_HEIGHT_METERS
  const mainAimDownDeg = Number.isFinite(result.recommendedAimDownDegRaw)
    ? result.recommendedAimDownDegRaw
    : result.recommendedAimDownDeg
  const mainPositions = Array.isArray(result.mainSpeakerPositions) && result.mainSpeakerPositions.length >= 2
    ? result.mainSpeakerPositions
    : [
      { widthMeters: listeningSideMarginMeters + (listeningWidthMeters * 0.25), depthMeters: 0, aimYawDeg: 0 },
      { widthMeters: listeningSideMarginMeters + (listeningWidthMeters * 0.75), depthMeters: 0, aimYawDeg: 0 },
    ]
  const mainTemplates = mainPositions.map((position, index) => ({
    id: `main-${index ? 'right' : 'left'}`,
    label: `M${index + 1}`,
    type: 'main',
    widthMeters: position.widthMeters,
    depthMeters: Number.isFinite(position.depthMeters) ? position.depthMeters : 0,
    aimYawDeg: Number.isFinite(position.aimYawDeg) ? position.aimYawDeg : 0,
    aimDownDeg: Number.isFinite(position.aimDownDeg) ? position.aimDownDeg : mainAimDownDeg,
  })).map((source) => ({
    ...source,
    levelAtOneMeter: 0,
    coverageDeg: mainCoverageDeg,
    verticalCoverageDeg: mainVerticalCoverageDeg,
    aimDownDeg: source.aimDownDeg,
    aimDepthMeters: getAimDepthMeters(source.depthMeters, verticalDelta, source.aimDownDeg, source.aimYawDeg),
    coverageEndDepthMeters: lastListeningDistanceMeters,
    capabilityAtOneMeter: mainCapability,
  }))
  const mainLevelAtOneMeter = getCalibratedLevel({
    sourceTemplates: mainTemplates,
    referencePoints: getReferencePoints(
      roomWidthMeters,
      result.firstListeningDistance,
      listeningWidthMeters,
      listeningSideMarginMeters,
    ),
    targetLevelDb: result.standardMaxSpl + MAIN_TARGET_OFFSET_DB,
    speakerCenterHeightMeters: speakerHeight,
  })
  const sources = mainTemplates.map((source) => ({
    ...source,
    levelAtOneMeter: round(mainLevelAtOneMeter),
    levelAtOneMeterRaw: mainLevelAtOneMeter,
    capacityMarginDb: Number.isFinite(source.capabilityAtOneMeter)
      ? round(source.capabilityAtOneMeter - mainLevelAtOneMeter)
      : null,
    capacityMarginDbRaw: Number.isFinite(source.capabilityAtOneMeter)
      ? source.capabilityAtOneMeter - mainLevelAtOneMeter
      : null,
  }))

  const fillGroups = result.speakerRecommendation?.fillPlacementGroups || []
  const fillProfile = result.speakerRecommendation?.packages?.[0]?.fill
  const fillCoverageDeg = fillProfile?.horizontalCoverageDeg || mainCoverageDeg
  const fillVerticalCoverageDeg = fillProfile?.verticalCoverageDeg || mainVerticalCoverageDeg
  const fillSideWallOffsetMeters = clamp(
    roomWidthMeters * FILL_SIDE_WALL_OFFSET_RATIO,
    Math.min(0.35, roomWidthMeters * 0.2),
    Math.max(roomWidthMeters / 2 - 0.35, roomWidthMeters * 0.2),
  )

  fillGroups.forEach((group, groupIndex) => {
    const requestedDepthMeters = Number.isFinite(group.mainToFillDistanceMetersRaw)
      ? group.mainToFillDistanceMetersRaw
      : group.mainToFillDistanceMeters
    const depthMeters = clamp(requestedDepthMeters, 0.1, lastListeningDistanceMeters - 0.1)
    const nextGroup = fillGroups[groupIndex + 1]
    const nextGroupDepthMeters = nextGroup && (Number.isFinite(nextGroup.mainToFillDistanceMetersRaw)
      ? nextGroup.mainToFillDistanceMetersRaw
      : nextGroup.mainToFillDistanceMeters)
    const coverageEndDepthMeters = nextGroup
      ? clamp(nextGroupDepthMeters, depthMeters + 0.1, lastListeningDistanceMeters)
      : lastListeningDistanceMeters
    const referenceDepthMeters = depthMeters
      + ((coverageEndDepthMeters - depthMeters) * FILL_REFERENCE_DEPTH_RATIO)
    const templates = [fillSideWallOffsetMeters, roomWidthMeters - fillSideWallOffsetMeters]
      .map((widthMeters, sourceIndex) => ({
        id: `fill-${groupIndex + 1}-${sourceIndex ? 'right' : 'left'}`,
        label: `F${(groupIndex * 2) + sourceIndex + 1}`,
        type: 'fill',
         widthMeters,
         depthMeters,
         levelAtOneMeter: 0,
         aimYawDeg: 0,
         coverageDeg: fillCoverageDeg,
        verticalCoverageDeg: fillVerticalCoverageDeg,
        aimDownDeg: Math.atan2(verticalDelta, Math.max(referenceDepthMeters - depthMeters, 0.000001)) * 180 / Math.PI,
        aimDepthMeters: referenceDepthMeters,
        coverageEndDepthMeters,
        capabilityAtOneMeter: fillProfile?.maximumSplDb,
      }))
    const levelAtOneMeter = getCalibratedLevel({
      sourceTemplates: templates,
      existingSources: sources,
      referencePoints: getReferencePoints(
        roomWidthMeters,
        referenceDepthMeters,
        listeningWidthMeters,
        listeningSideMarginMeters,
      ),
      targetLevelDb: result.standardMaxSpl + FILL_TARGET_OFFSET_DB,
      speakerCenterHeightMeters: speakerHeight,
    })

    sources.push(...templates.map((source) => ({
      ...source,
      levelAtOneMeter: round(levelAtOneMeter),
      levelAtOneMeterRaw: levelAtOneMeter,
      capacityMarginDb: Number.isFinite(source.capabilityAtOneMeter)
        ? round(source.capabilityAtOneMeter - levelAtOneMeter)
        : null,
      capacityMarginDbRaw: Number.isFinite(source.capabilityAtOneMeter)
        ? source.capabilityAtOneMeter - levelAtOneMeter
        : null,
    })))
  })

  return sources
}

function getPlanStatistics(cells, result, sources) {
  const audienceLevels = cells
    .filter((cell) => cell.isAudience)
    .map((cell) => cell.relativeLevelDbRaw)
  if (!audienceLevels.length) {
    return {
      minimumRelativeDb: 0,
      minimumRelativeDbRaw: 0,
      maximumRelativeDb: 0,
      maximumRelativeDbRaw: 0,
      variationDb: 0,
      variationDbRaw: 0,
      referenceLimitDb: result.uniformityCheckDb,
      statusKey: 'review',
      statusText: '声学覆盖待核验',
      distanceTrendPass: false,
      hasHotspot: false,
      hotspotText: '',
      capacityShortfallCount: 0,
    }
  }

  const minimumRelativeDb = Math.min(...audienceLevels)
  const maximumRelativeDb = Math.max(...audienceLevels)
  const hotspotCellCount = audienceLevels.filter((levelDb) => levelDb >= 6).length
  const severeHotspotCellCount = audienceLevels.filter((levelDb) => levelDb >= 12).length
  const weakCellCount = audienceLevels.filter((levelDb) => levelDb < -7).length
  const hasHotspot = hotspotCellCount >= 2
  const hasSevereHotspot = severeHotspotCellCount >= 2
  const capacityShortfallCount = sources.filter((source) => (
    Number.isFinite(source.capacityMarginDbRaw) && source.capacityMarginDbRaw < 3
  )).length
  const variationDbRaw = maximumRelativeDb - minimumRelativeDb
  // 粗略场地模型不显示无实际意义的 0.1 dB 精度，但趋势判定使用完整精度。
  const variationDb = round(variationDbRaw, 0)
  const trendPass = variationDbRaw <= result.uniformityCheckDb
    && !hasHotspot
    && weakCellCount === 0
    && capacityShortfallCount === 0

  return {
    minimumRelativeDb: round(minimumRelativeDb),
    minimumRelativeDbRaw: minimumRelativeDb,
    maximumRelativeDb: round(maximumRelativeDb),
    maximumRelativeDbRaw: maximumRelativeDb,
    variationDb,
    variationDbRaw,
    referenceLimitDb: result.uniformityCheckDb,
    statusKey: 'review',
    statusText: '声学覆盖待核验',
    distanceTrendPass: trendPass,
    hasHotspot,
    hotspotText: hasSevereHotspot
      ? '听众区存在高于目标 ≥ 12 dB 的明显热点，应优先复核声源工作电平与覆盖交叠。'
      : '听众区存在高于目标 ≥ 6 dB 的热点，请复核补声电平、覆盖交叠及主扩近场。',
    capacityShortfallCount,
  }
}

function buildVenuePlan(result) {
  const roomWidthMeters = result.frontWidthMeters
  const roomDepthMeters = result.depthMeters
  const gridRows = clamp(
    Math.round(GRID_COLUMNS * (roomDepthMeters / roomWidthMeters)),
    MIN_GRID_ROWS,
    MAX_GRID_ROWS,
  )
  const sources = getSpeakerSources(result)
  const lastListeningDistanceMeters = Number.isFinite(result.lastListeningDistanceRaw)
    ? result.lastListeningDistanceRaw
    : (result.lastListeningDistance || result.depthMeters)
  const listeningSideMarginMeters = Number.isFinite(result.listeningSideMarginRaw)
    ? result.listeningSideMarginRaw
    : (result.listeningSideMargin || 0)
  const listeningWidthMeters = result.listeningWidth || roomWidthMeters
  const fillDistanceGroups = (result.speakerRecommendation?.fillPlacementGroups || []).map((group) => ({
    mainToFillDistanceMeters: group.mainToFillDistanceMeters,
    mainToFillDistanceMetersRaw: Number.isFinite(group.mainToFillDistanceMetersRaw)
      ? group.mainToFillDistanceMetersRaw
      : group.mainToFillDistanceMeters,
  }))
  const cells = []

  for (let row = 0; row < gridRows; row += 1) {
    const depthMeters = ((row + 0.5) / gridRows) * roomDepthMeters
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const widthMeters = ((column + 0.5) / GRID_COLUMNS) * roomWidthMeters
      const energy = sources.reduce((sum, source) => sum + toEnergy(getDirectLevelAtPoint({
        point: { widthMeters, depthMeters },
        source,
        speakerCenterHeightMeters: Number.isFinite(result.speakerCenterHeightRaw)
          ? result.speakerCenterHeightRaw
          : result.speakerCenterHeight,
      })), 0)
      const levelDb = toDb(energy)

      cells.push({
        column,
        row,
        isAudience: (
          depthMeters >= result.firstListeningDistance
          && depthMeters <= lastListeningDistanceMeters
          && widthMeters >= listeningSideMarginMeters
          && widthMeters <= (listeningSideMarginMeters + listeningWidthMeters)
        ),
        relativeLevelDbRaw: levelDb - result.standardMaxSpl,
        relativeLevelDb: round(levelDb - result.standardMaxSpl),
      })
    }
  }

  const plan = {
    kind: 'report',
    modelBasis: 'distance-only',
    coverageVerification: 'unverified',
    speakerCenterHeightMeters: Number.isFinite(result.speakerCenterHeightRaw)
      ? result.speakerCenterHeightRaw
      : result.speakerCenterHeight,
    roomWidthMeters,
    roomDepthMeters,
    firstListeningDistanceMeters: result.firstListeningDistance,
    lastListeningDistanceMeters,
    listeningWidthMeters,
    listeningSideMarginMeters,
    gridColumns: GRID_COLUMNS,
    gridRows,
    sources,
    fillDistanceGroups,
    cells,
    statistics: getPlanStatistics(cells, result, sources),
  }
  plan.handoffReview = buildVenueHandoffReview(plan)
  return plan
}

function buildVenueHandoffReviewForResult(result) {
  const roomWidthMeters = result.frontWidthMeters
  return buildVenueHandoffReview({
    speakerCenterHeightMeters: Number.isFinite(result.speakerCenterHeightRaw)
      ? result.speakerCenterHeightRaw
      : result.speakerCenterHeight,
    listeningSideMarginMeters: Number.isFinite(result.listeningSideMarginRaw)
      ? result.listeningSideMarginRaw
      : (result.listeningSideMargin || 0),
    listeningWidthMeters: result.listeningWidth || roomWidthMeters,
    sources: getSpeakerSources(result),
  })
}

module.exports = {
  buildVenuePlan,
  buildVenueHandoffReviewForResult,
  getDirectLevelAtPoint,
}

const {
  transformPointToSpeakerAngles,
} = require('./venue-geometry')

const DEFAULT_EAR_HEIGHT_METERS = 1.2
const DEFAULT_SPEED_OF_SOUND_METERS_PER_SECOND = 343
const GROUP_DEPTH_EPSILON_METERS = 1e-9
const ANGLE_EPSILON_DEGREES = 1e-9

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function calculatePathDistanceMeters({
  point,
  source,
  speakerCenterHeightMeters,
  earHeightMeters = DEFAULT_EAR_HEIGHT_METERS,
}) {
  const pointWidth = finiteNumber(point?.widthMeters)
  const pointDepth = finiteNumber(point?.depthMeters)
  const sourceWidth = finiteNumber(source?.widthMeters)
  const sourceDepth = finiteNumber(source?.depthMeters)
  const speakerHeight = finiteNumber(speakerCenterHeightMeters)
  const earHeight = finiteNumber(earHeightMeters)
  if ([pointWidth, pointDepth, sourceWidth, sourceDepth, speakerHeight, earHeight]
    .some((value) => value === null)) return null

  return Math.hypot(
    pointWidth - sourceWidth,
    pointDepth - sourceDepth,
    speakerHeight - earHeight,
  )
}

function calculateArrivalDifferenceMs({
  upstreamDistanceMeters,
  fillDistanceMeters,
  speedOfSoundMetersPerSecond = DEFAULT_SPEED_OF_SOUND_METERS_PER_SECOND,
}) {
  const upstreamDistance = finiteNumber(upstreamDistanceMeters)
  const fillDistance = finiteNumber(fillDistanceMeters)
  const speed = finiteNumber(speedOfSoundMetersPerSecond)
  if (upstreamDistance === null || fillDistance === null || upstreamDistance < 0
    || fillDistance < 0 || speed === null || speed <= 0) return null
  return ((upstreamDistance - fillDistance) / speed) * 1000
}

function sourceHeight(plan, source) {
  const hasSourceHeight = source && Object.prototype.hasOwnProperty.call(source, 'speakerCenterHeightMeters')
  return hasSourceHeight
    ? finiteNumber(source.speakerCenterHeightMeters)
    : finiteNumber(plan?.speakerCenterHeightMeters)
}

function sourceLabel(source) {
  const label = typeof source?.label === 'string' ? source.label.trim() : ''
  if (label) return label
  const id = typeof source?.id === 'string' ? source.id.trim() : ''
  return id || null
}

function hasNominalCoverage(source, point, plan) {
  const horizontalCoverage = finiteNumber(source?.coverageDeg)
  const verticalCoverage = finiteNumber(source?.verticalCoverageDeg)
  const height = sourceHeight(plan, source)
  const earHeight = plan && Object.prototype.hasOwnProperty.call(plan, 'earHeightMeters')
    ? finiteNumber(plan.earHeightMeters)
    : DEFAULT_EAR_HEIGHT_METERS
  const pointWidth = finiteNumber(point?.widthMetersRaw)
  const pointDepth = finiteNumber(point?.depthMetersRaw)
  const sourceWidth = finiteNumber(source?.widthMeters)
  const sourceDepth = finiteNumber(source?.depthMeters)
  const aimYaw = finiteNumber(source?.aimYawDeg)
  const aimDown = finiteNumber(source?.aimDownDeg)
  if (horizontalCoverage === null || verticalCoverage === null
    || horizontalCoverage <= 0 || horizontalCoverage > 180
    || verticalCoverage <= 0 || verticalCoverage > 180
    || height === null || earHeight === null
    || pointWidth === null || pointDepth === null
    || sourceWidth === null || sourceDepth === null
    || aimYaw === null || aimDown === null) return false

  const angles = transformPointToSpeakerAngles({
    widthMeters: pointWidth,
    depthMeters: pointDepth,
  }, source, height, earHeight)
  return Number.isFinite(angles.localForwardMeters)
    && angles.localForwardMeters > 0
    && Number.isFinite(angles.yawDeg)
    && Number.isFinite(angles.pitchDeg)
    && Math.abs(angles.yawDeg) <= (horizontalCoverage / 2) + ANGLE_EPSILON_DEGREES
    && Math.abs(angles.pitchDeg) <= (verticalCoverage / 2) + ANGLE_EPSILON_DEGREES
}

function groupFillSources(sources) {
  const groups = []
  sources.forEach((source) => {
    const depth = finiteNumber(source?.depthMeters)
    if (depth === null) return
    let group = groups.find((item) => Math.abs(item.depth - depth) <= GROUP_DEPTH_EPSILON_METERS)
    if (!group) {
      group = { depth, sources: [] }
      groups.push(group)
    }
    group.sources.push(source)
  })
  return groups.sort((a, b) => a.depth - b.depth)
}

function getGroupReferenceDepth(group) {
  const aimDepths = group.sources.map((source) => finiteNumber(source?.aimDepthMeters))
  if (aimDepths.some((value) => value === null)) return null
  const referenceDepth = aimDepths[0]
  return aimDepths.every((value) => Math.abs(value - referenceDepth) <= GROUP_DEPTH_EPSILON_METERS)
    ? referenceDepth
    : null
}

function getReferencePoints(plan, referenceDepth) {
  const sideMargin = finiteNumber(plan?.listeningSideMarginMeters)
  const listeningWidth = finiteNumber(plan?.listeningWidthMeters)
  if (sideMargin === null || listeningWidth === null || listeningWidth <= 0 || referenceDepth === null) return []
  return [
    { label: '1/4', ratio: 0.25 },
    { label: '1/2', ratio: 0.5 },
    { label: '3/4', ratio: 0.75 },
  ].map(({ label, ratio }) => ({
    label,
    widthMetersRaw: sideMargin + (listeningWidth * ratio),
    depthMetersRaw: referenceDepth,
  }))
}

function getQualifiedSources(sources, point, plan) {
  return sources.map((source) => {
    const height = sourceHeight(plan, source)
    if (height === null || !hasNominalCoverage(source, point, plan)) return null
    const distance = calculatePathDistanceMeters({
      point: { widthMeters: point.widthMetersRaw, depthMeters: point.depthMetersRaw },
      source,
      speakerCenterHeightMeters: height,
      earHeightMeters: plan && Object.prototype.hasOwnProperty.call(plan, 'earHeightMeters')
        ? plan.earHeightMeters
        : DEFAULT_EAR_HEIGHT_METERS,
    })
    const label = sourceLabel(source)
    return distance === null || label === null ? null : { source, distance, label }
  }).filter(Boolean)
}

function selectNearest(items) {
  return items.reduce((nearest, item) => (
    !nearest || item.distance < nearest.distance ? item : nearest
  ), null)
}

function buildPointReview({ point, upstreamSources, fillSources, plan }) {
  const base = {
    label: point.label,
    widthMetersRaw: point.widthMetersRaw,
    depthMetersRaw: point.depthMetersRaw,
    available: false,
    upstreamSourceLabel: null,
    fillSourceLabel: null,
    upstreamDistanceMetersRaw: null,
    fillDistanceMetersRaw: null,
    arrivalDifferenceMsRaw: null,
  }
  if (point.widthMetersRaw === null || point.depthMetersRaw === null) return base

  const upstream = selectNearest(getQualifiedSources(upstreamSources, point, plan))
  const fill = selectNearest(getQualifiedSources(fillSources, point, plan))
  if (!upstream || !fill) return base
  const arrivalDifferenceMs = calculateArrivalDifferenceMs({
    upstreamDistanceMeters: upstream.distance,
    fillDistanceMeters: fill.distance,
  })
  if (arrivalDifferenceMs === null || !Number.isFinite(arrivalDifferenceMs)) return base

  return {
    ...base,
    available: true,
    upstreamSourceLabel: upstream.label,
    fillSourceLabel: fill.label,
    upstreamDistanceMetersRaw: upstream.distance,
    fillDistanceMetersRaw: fill.distance,
    arrivalDifferenceMsRaw: arrivalDifferenceMs,
  }
}

function buildVenueHandoffReview(plan) {
  const sources = Array.isArray(plan?.sources) ? plan.sources : []
  const fillGroups = groupFillSources(sources.filter((source) => source?.type === 'fill'))
  const mainSources = sources.filter((source) => source?.type === 'main')
  const speedOfSoundMetersPerSecond = DEFAULT_SPEED_OF_SOUND_METERS_PER_SECOND

  return {
    basis: 'nominal-geometry',
    speedOfSoundMetersPerSecond,
    groups: fillGroups.map((group, groupIndex) => {
      const referenceDepth = getGroupReferenceDepth(group)
      const points = getReferencePoints(plan, referenceDepth).map((point) => buildPointReview({
        point,
        upstreamSources: [
          ...mainSources,
          ...fillGroups
            .filter((candidate) => candidate.depth < group.depth - GROUP_DEPTH_EPSILON_METERS)
            .flatMap((candidate) => candidate.sources),
        ],
        fillSources: group.sources,
        plan,
      }))
      const availableDifferences = points
        .map((point) => point.arrivalDifferenceMsRaw)
        .filter((value) => Number.isFinite(value))
      return {
        index: groupIndex + 1,
        label: `第 ${groupIndex + 1} 组补声`,
        installationDepthMetersRaw: group.depth,
        referenceDepthMetersRaw: referenceDepth,
        commonPointCount: availableDifferences.length,
        totalPointCount: 3,
        points,
        minimumArrivalDifferenceMsRaw: availableDifferences.length
          ? Math.min(...availableDifferences)
          : null,
        maximumArrivalDifferenceMsRaw: availableDifferences.length
          ? Math.max(...availableDifferences)
          : null,
      }
    }),
  }
}

module.exports = {
  buildVenueHandoffReview,
  calculateArrivalDifferenceMs,
  calculatePathDistanceMeters,
}

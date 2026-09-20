const { buildDiscussionCoverageSummary } = require('./venue-discussion')

function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function getDistance(first, second) {
  return Math.hypot(
    first.widthMeters - second.widthMeters,
    first.depthMeters - second.depthMeters,
  )
}

function createSpacingGuide(first, second, prefix) {
  const distanceMeters = round(getDistance(first, second))
  return {
    start: first,
    end: second,
    distanceMeters,
    label: `${prefix} ${distanceMeters} m`,
  }
}

function buildSpacingGuides(result, sources) {
  if (sources.length < 2) return []
  if (result.installationMode === 'wall') {
    const pairs = []
    sources.forEach((source, index) => {
      sources.slice(index + 1).forEach((other) => pairs.push({ source, other }))
    })
    const opposite = pairs.find(({ source, other }) => source.wallPairIndex === other.wallPairIndex)
    const sameWall = pairs
      .filter(({ source, other }) => (
        Math.abs(source.aimWidth) > Math.abs(source.aimDepth)
          ? Math.abs(source.widthMeters - other.widthMeters) < 0.05
          : Math.abs(source.depthMeters - other.depthMeters) < 0.05
      ))
      .sort((first, second) => getDistance(first.source, first.other) - getDistance(second.source, second.other))[0]
    return [
      ...(opposite ? [createSpacingGuide(opposite.source, opposite.other, '对向')] : []),
      ...(sameWall ? [createSpacingGuide(sameWall.source, sameWall.other, '同墙')] : []),
    ]
  }
  if (result.tableShape === 'round') {
    const centerX = result.roomWidthMeters / 2
    const centerY = result.roomLengthMeters / 2
    const ordered = [...sources].sort((first, second) => (
      Math.atan2(first.depthMeters - centerY, first.widthMeters - centerX)
      - Math.atan2(second.depthMeters - centerY, second.widthMeters - centerX)
    ))
    return [createSpacingGuide(ordered[0], ordered[1], sources.length === 2 ? '中心距' : '相邻')]
  }

  const pairs = []
  sources.forEach((source, index) => {
    sources.slice(index + 1).forEach((other) => pairs.push({ source, other }))
  })
  const horizontal = pairs
    .filter(({ source, other }) => Math.abs(source.depthMeters - other.depthMeters) < 0.05)
    .sort((first, second) => getDistance(first.source, first.other) - getDistance(second.source, second.other))[0]
  const vertical = pairs
    .filter(({ source, other }) => Math.abs(source.widthMeters - other.widthMeters) < 0.05)
    .sort((first, second) => getDistance(first.source, first.other) - getDistance(second.source, second.other))[0]
  return [
    ...(horizontal ? [createSpacingGuide(horizontal.source, horizontal.other, '横向')] : []),
    ...(vertical ? [createSpacingGuide(vertical.source, vertical.other, '纵向')] : []),
  ]
}

function buildElevation(result, coverage) {
  const earHeightMeters = 1.2
  const verticalOffset = result.speakerHeight - earHeightMeters
  const isWall = result.installationMode === 'wall'
  const rawNearestHorizontalDistanceMeters = coverage.eligibleMinimumHorizontalMeters == null
    ? null
    : coverage.eligibleMinimumHorizontalMeters
  const rawFarthestHorizontalDistanceMeters = coverage.eligibleMaximumHorizontalMeters == null
    ? null
    : coverage.eligibleMaximumHorizontalMeters
  const nearestHorizontalDistanceMeters = rawNearestHorizontalDistanceMeters == null
    ? null
    : round(rawNearestHorizontalDistanceMeters)
  const farthestHorizontalDistanceMeters = rawFarthestHorizontalDistanceMeters == null
    ? null
    : round(rawFarthestHorizontalDistanceMeters)
  const rawRequiredVerticalCoverageDeg = isWall
    ? Math.max((coverage.downTiltMaximumDeg || 0) - (coverage.downTiltMinimumDeg || 0), 0)
    : rawFarthestHorizontalDistanceMeters == null
      ? 0
      : 2 * Math.atan(rawFarthestHorizontalDistanceMeters / verticalOffset) * 180 / Math.PI
  const requiredVerticalCoverageDeg = round(rawRequiredVerticalCoverageDeg)
  const downTiltMinimumDeg = coverage.downTiltMinimumDeg == null ? null : round(coverage.downTiltMinimumDeg)
  const downTiltMaximumDeg = coverage.downTiltMaximumDeg == null ? null : round(coverage.downTiltMaximumDeg)
  const downTiltReferenceDeg = downTiltMinimumDeg == null || downTiltMaximumDeg == null
    ? null
    : round((downTiltMinimumDeg + downTiltMaximumDeg) / 2)
  const coveragePass = isWall
    ? null
    : coverage.coveredSeatCount === coverage.participantCount
      && result.recommendedCoverageDeg >= rawRequiredVerticalCoverageDeg

  return {
    mode: result.installationMode,
    dataBasis: 'nominal-geometry',
    acousticCoverageVerified: false,
    isWall,
    roomHeightMeters: result.roomHeightMeters,
    speakerHeightMeters: result.speakerHeight,
    earHeightMeters,
    nearestHorizontalDistanceMeters,
    farthestHorizontalDistanceMeters,
    requiredVerticalCoverageDeg,
    rawRequiredVerticalCoverageDeg,
    coverageHalfAngleDeg: round(requiredVerticalCoverageDeg / 2, 0),
    coverageHalfAngleNegativeDeg: -round(requiredVerticalCoverageDeg / 2, 0),
    recommendedDownTiltDeg: isWall ? null : 0,
    downTiltMinimumDeg,
    downTiltMaximumDeg,
    downTiltReferenceDeg,
    coveragePass,
    statusKey: coveragePass === null ? 'verify' : coveragePass ? 'pass' : 'review',
    statusText: coveragePass === null
      ? `需核对音箱垂直覆盖角不小于约 ${requiredVerticalCoverageDeg}°`
      : coveragePass
        ? '当前覆盖角档位可包络最不利坐席'
        : '当前覆盖角档位不足，需调整高度或增加分区',
    downTiltSummary: isWall
      ? downTiltMinimumDeg == null
        ? '当前没有方向合格的责任坐席，请调整指向或布置。'
        : `各音箱按负责坐席分别调整；下倾参考范围约 ${downTiltMinimumDeg}°～${downTiltMaximumDeg}°。`
      : '',
    summary: isWall
      ? `按各音箱负责坐席分别复核名义几何垂直覆盖范围；最近/最远合格水平距约 ${nearestHorizontalDistanceMeters ?? '—'} / ${farthestHorizontalDistanceMeters ?? '—'} m，声学有效覆盖尚待核验。`
      : `坐席耳高按 ${earHeightMeters} m 估算，最不利水平偏距约 ${farthestHorizontalDistanceMeters ?? '—'} m；这是名义理想包络，声学有效覆盖尚待核验。`,
    speakerTopPercent: round((1 - (result.speakerHeight / result.roomHeightMeters)) * 100, 0),
    aimTopPercent: round((1 - (result.speakerHeight / result.roomHeightMeters)) * 100, 0) + 3,
    earTopPercent: round((1 - (earHeightMeters / result.roomHeightMeters)) * 100, 0),
    aimRotateDeg: round(isWall ? (downTiltReferenceDeg || 0) : 90, 0),
  }
}

function buildDiscussionPlan(result) {
  const coverage = buildDiscussionCoverageSummary(result)
  const sources = result.speakerPositions.map((source) => ({
    ...source,
    coverageDeg: result.recommendedCoverageDeg,
    ...(result.coverageRadiusMeters ? { coverageRadiusMeters: result.coverageRadiusMeters } : {}),
  }))
  const seats = result.seats.map((seat, index) => {
    const seatCoverage = coverage.seatCoverage[index]
    return {
      ...seat,
      coveringSourceCount: seatCoverage.coveringSourceCount,
      coveringSourceIds: seatCoverage.coveringSourceIds,
      responsibleSpeakerId: seatCoverage.responsibleSpeakerId,
      nearestHorizontalDistanceMeters: seatCoverage.nearestHorizontalDistanceMeters,
      nearestPathDistanceMeters: seatCoverage.nearestPathDistanceMeters,
      covered: seatCoverage.covered,
    }
  })
  const coveragePass = coverage.coveredSeatCount === result.participantCount
    && coverage.excessiveOverlapSeatCount === 0
  const geometryStatusKey = coveragePass ? 'pass' : 'review'
  const statusText = coverage.uncoveredSeatIds.length
    ? '存在几何覆盖缺口'
    : coverage.excessiveOverlapSeatCount
      ? '几何交叠待复核'
      : '声学覆盖待核验'

  return {
    kind: 'discussion',
    roomWidthMeters: result.roomWidthMeters,
    roomDepthMeters: result.roomLengthMeters,
    tableGeometry: result.tableGeometry,
    listeningAreaGeometry: result.listeningAreaGeometry,
    installationMode: result.installationMode,
    installationShortLabel: result.installationShortLabel,
    sourceMarker: result.sourceMarker,
    coverageShape: result.coverageShape,
    sources,
    seats,
    spacingGuides: buildSpacingGuides(result, sources),
    elevation: buildElevation(result, coverage),
    statistics: {
      coveredSeatCount: coverage.coveredSeatCount,
      participantCount: result.participantCount,
      coveragePercent: round((coverage.coveredSeatCount / result.participantCount) * 100, 0),
      minimumCoverageCount: coverage.minimumCoverageCount,
      maximumCoverageCount: coverage.maximumCoverageCount,
      doubleCoveredSeatCount: coverage.doubleCoveredSeatCount,
      excessiveOverlapSeatCount: coverage.excessiveOverlapSeatCount,
      uncoveredSeatIds: coverage.uncoveredSeatIds,
      responsibleBySource: coverage.responsibleBySource,
      zoneCount: result.zoneCount,
      geometryStatusKey,
      statusKey: 'review',
      statusText,
    },
  }
}

module.exports = {
  buildDiscussionPlan,
}

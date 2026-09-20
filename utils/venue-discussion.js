const { STANDARD_CLASSES } = require('./venue')

const DISCUSSION_TABLE_SHAPES = [
  { value: 'round', label: '圆桌' },
  { value: 'rectangular', label: '矩形会议桌' },
]

const DISCUSSION_AUDIO_MODES = [
  {
    value: 'remote',
    label: '远端会议 / 媒体播放',
    description: '本地发言不送回本地音箱，音箱主要播放远端与节目声。',
  },
  {
    value: 'voiceLift',
    label: '需要本地语音提升',
    description: '按多个独立扬声器分区估算，并采用 Mix-Minus 避开邻近话筒。',
  },
]

const DISCUSSION_INSTALLATION_CONDITIONS = [
  {
    value: 'flat',
    label: '平顶，可安装吸顶',
    description: '顶面允许开孔或承重，且主要坐席上方没有连续灯具、风口或结构梁遮挡。',
  },
  {
    value: 'blocked',
    label: '顶面不可安装',
    description: '不可开孔、不能承重或存在明显遮挡，改按两侧墙面壁挂音箱估算。',
  },
  {
    value: 'open',
    label: '开放式或挑高顶',
    description: '没有常规封闭吊顶或层高较高，改按降低安装高度的吊装音箱估算。',
  },
]

const ROOM_SCOPE = {
  maxFloorAreaSquareMeters: 300,
  maxHeightMeters: 6,
  maxParticipants: 40,
}
const SEAT_RING_OFFSET_METERS = 0.6
const MIN_SEAT_WALL_CLEARANCE_METERS = 0.45
const LISTENER_EAR_HEIGHT_METERS = 1.2
const CEILING_SPEAKER_CLEARANCE_METERS = 0.15
const WALL_SPEAKER_INSET_METERS = 0.15
const CALCULATION_RESERVE_DB = 3
const COVERAGE_OPTIONS = [60, 90, 120]
const DEFAULT_SPEECH_COVERAGE_DEG = 90
const VOICE_LIFT_DISTANCE_REFERENCE_METERS = 7.5
const LISTENING_AREA_BUFFER_METERS = 0.5

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parsePositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function distributeOnRectangle(centerX, centerY, width, depth, count) {
  const perimeter = (width + depth) * 2
  return Array.from({ length: count }, (_, index) => {
    let position = (index / count) * perimeter
    if (position <= width) return { widthMeters: centerX - width / 2 + position, depthMeters: centerY - depth / 2 }
    position -= width
    if (position <= depth) return { widthMeters: centerX + width / 2, depthMeters: centerY - depth / 2 + position }
    position -= depth
    if (position <= width) return { widthMeters: centerX + width / 2 - position, depthMeters: centerY + depth / 2 }
    position -= width
    return { widthMeters: centerX - width / 2, depthMeters: centerY + depth / 2 - position }
  })
}

function buildSeats({ roomWidth, roomLength, tableShape, tableDiameter, tableWidth, tableLength, participantCount }) {
  const centerX = roomWidth / 2
  const centerY = roomLength / 2
  if (tableShape === 'round') {
    const radius = (tableDiameter / 2) + SEAT_RING_OFFSET_METERS
    return Array.from({ length: participantCount }, (_, index) => {
      const angle = (-Math.PI / 2) + ((index / participantCount) * Math.PI * 2)
      return {
        id: `seat-${index + 1}`,
        widthMeters: centerX + (Math.cos(angle) * radius),
        depthMeters: centerY + (Math.sin(angle) * radius),
      }
    })
  }

  return distributeOnRectangle(
    centerX,
    centerY,
    tableWidth + (SEAT_RING_OFFSET_METERS * 2),
    tableLength + (SEAT_RING_OFFSET_METERS * 2),
    participantCount,
  ).map((seat, index) => ({ id: `seat-${index + 1}`, ...seat }))
}

function buildGridSources(centerX, centerY, xSpan, ySpan, columns, rows) {
  const positions = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      positions.push({
        widthMeters: centerX + (columns === 1 ? 0 : ((column / (columns - 1)) - 0.5) * xSpan),
        depthMeters: centerY + (rows === 1 ? 0 : ((row / (rows - 1)) - 0.5) * ySpan),
      })
    }
  }
  return positions
}

function chooseGridDimensions(count, aspectRatio) {
  let best = null
  for (let columns = 1; columns <= count; columns += 1) {
    if (count % columns !== 0) continue
    const rows = count / columns
    const gridAspectRatio = columns / rows
    const score = Math.abs(Math.log(gridAspectRatio / Math.max(aspectRatio, 0.01)))
    const balance = Math.abs(columns - rows)
    if (!best || score < best.score || (score === best.score && balance < best.balance)) {
      best = { columns, rows, score, balance }
    }
  }
  return best || { columns: 1, rows: count }
}

function getVoiceLiftMinimumCount(tableShape, tableDiameter, tableLength) {
  if (tableShape === 'round') return tableDiameter <= 3 ? 4 : tableDiameter <= 5 ? 6 : 8
  return clamp(Math.ceil(tableLength / 2.4), 2, 4) * 2
}

function buildOverheadSpeakerPositions({
  roomWidth,
  roomLength,
  tableShape,
  tableDiameter,
  tableWidth,
  tableLength,
  audioMode,
  speakerCount,
  coverageRadiusMeters,
  marker,
  mountType,
  layoutScale = 1,
}) {
  const centerX = roomWidth / 2
  const centerY = roomLength / 2
  if (tableShape === 'round') {
    const seatRingRadius = (tableDiameter / 2) + SEAT_RING_OFFSET_METERS
    const radius = (audioMode === 'voiceLift'
      ? seatRingRadius * 0.9
      : speakerCount === 2
        ? clamp(seatRingRadius * 0.72, 0.8, coverageRadiusMeters * 0.65)
        : seatRingRadius * 0.72) * layoutScale
    return Array.from({ length: speakerCount }, (_, index) => {
      const angle = (-Math.PI / 2) + ((index / speakerCount) * Math.PI * 2)
      return {
        id: `speaker-${index + 1}`,
        label: `${marker}${index + 1}`,
        marker,
        mountType,
        widthMeters: centerX + (Math.cos(angle) * radius),
        depthMeters: centerY + (Math.sin(angle) * radius),
      }
    })
  }

  const occupiedWidth = tableWidth + (SEAT_RING_OFFSET_METERS * 2)
  const occupiedLength = tableLength + (SEAT_RING_OFFSET_METERS * 2)
  let columns
  let rows
  let xSpan
  let ySpan
  if (audioMode === 'voiceLift') {
    columns = 2
    rows = Math.ceil(speakerCount / 2)
    // 两列音箱放在长桌两侧坐席分区上方，不再集中在桌面中心。
    xSpan = occupiedWidth * 0.95
    // 首末排靠近端部坐席，减少端部坐席同时落入三只音箱覆盖区的情况。
    ySpan = Math.min(occupiedLength * 0.96, tableLength + 1)
  } else if (speakerCount === 2) {
    const alongLength = occupiedLength >= occupiedWidth
    columns = alongLength ? 1 : 2
    rows = alongLength ? 2 : 1
    xSpan = alongLength ? 0 : occupiedWidth * 0.6
    ySpan = alongLength ? occupiedLength * 0.6 : 0
  } else {
    const grid = chooseGridDimensions(speakerCount, occupiedWidth / occupiedLength)
    columns = grid.columns
    rows = grid.rows
    xSpan = occupiedWidth * 0.65
    ySpan = occupiedLength * 0.65
  }
  return buildGridSources(centerX, centerY, xSpan * layoutScale, ySpan * layoutScale, columns, rows)
    .map((source, index) => ({
      id: `speaker-${index + 1}`,
      label: `${marker}${index + 1}`,
      marker,
      mountType,
      ...source,
    }))
}

function buildWallSpeakerPositions({
  roomWidth,
  roomLength,
  occupiedWidth,
  occupiedLength,
  speakerCount,
  spanScale = 1,
  aimMode = 'baseline',
  seats = [],
}) {
  const pairCount = Math.ceil(speakerCount / 2)
  const onLongWalls = roomLength >= roomWidth
  const alongCenter = (onLongWalls ? roomLength : roomWidth) / 2
  const occupiedSpan = onLongWalls ? occupiedLength : occupiedWidth
  const wallSpan = onLongWalls ? roomLength : roomWidth
  const serviceSpan = Math.min(occupiedSpan * 0.92 * spanScale, wallSpan - 0.8)
  const alongPositions = Array.from({ length: pairCount }, (_, index) => (
    alongCenter + (pairCount === 1 ? 0 : ((index / (pairCount - 1)) - 0.5) * serviceSpan)
  ))
  const positions = []

  alongPositions.forEach((along, index) => {
    const outwardOffset = pairCount === 1
      ? 0
      : Math.sign(along - alongCenter) * Math.min(occupiedSpan * 0.22, 0.7)
    const crossDistance = onLongWalls
      ? (roomWidth / 2) - WALL_SPEAKER_INSET_METERS
      : (roomLength / 2) - WALL_SPEAKER_INSET_METERS
    const aimDistance = Math.hypot(crossDistance, outwardOffset)
    const crossAim = crossDistance / aimDistance
    const alongAim = outwardOffset / aimDistance
    let first = onLongWalls
      ? { widthMeters: WALL_SPEAKER_INSET_METERS, depthMeters: along, aimWidth: crossAim, aimDepth: alongAim }
      : { widthMeters: along, depthMeters: WALL_SPEAKER_INSET_METERS, aimWidth: alongAim, aimDepth: crossAim }
    let second = onLongWalls
      ? { widthMeters: roomWidth - WALL_SPEAKER_INSET_METERS, depthMeters: along, aimWidth: -crossAim, aimDepth: alongAim }
      : { widthMeters: along, depthMeters: roomLength - WALL_SPEAKER_INSET_METERS, aimWidth: alongAim, aimDepth: -crossAim }
    if (aimMode === 'responsibility' && seats.length) {
      const retarget = (source) => {
        const nearestSeats = seats
          .map((seat) => ({ seat, distance: Math.hypot(source.widthMeters - seat.widthMeters, source.depthMeters - seat.depthMeters) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, Math.max(1, Math.ceil(seats.length / speakerCount)))
        const target = nearestSeats.reduce((sum, item) => ({
          widthMeters: sum.widthMeters + item.seat.widthMeters,
          depthMeters: sum.depthMeters + item.seat.depthMeters,
        }), { widthMeters: 0, depthMeters: 0 })
        const count = nearestSeats.length
        const widthDelta = (target.widthMeters / count) - source.widthMeters
        const depthDelta = (target.depthMeters / count) - source.depthMeters
        const distance = Math.hypot(widthDelta, depthDelta) || 1
        return { ...source, aimWidth: widthDelta / distance, aimDepth: depthDelta / distance }
      }
      first = retarget(first)
      second = retarget(second)
    }
    positions.push(first, second)
  })

  const coverageLengthMeters = onLongWalls
    ? roomWidth - (WALL_SPEAKER_INSET_METERS * 2)
    : roomLength - (WALL_SPEAKER_INSET_METERS * 2)
  return positions.slice(0, speakerCount).map((source, index) => ({
    id: `speaker-${index + 1}`,
    label: `W${index + 1}`,
    marker: 'W',
    mountType: 'wall',
    coverageLengthMeters,
    wallPairIndex: Math.floor(index / 2),
    ...source,
  }))
}

function getDirectionalAngleDeg(source, target) {
  const widthDelta = target.widthMeters - source.widthMeters
  const depthDelta = target.depthMeters - source.depthMeters
  const distance = Math.hypot(widthDelta, depthDelta)
  if (!distance) return 0
  const cosine = clamp(
    ((widthDelta * source.aimWidth) + (depthDelta * source.aimDepth)) / distance,
    -1,
    1,
  )
  return Math.acos(cosine) * 180 / Math.PI
}

function buildDiscussionCoverageSummary({
  seats,
  speakerPositions,
  coverageShape,
  recommendedCoverageDeg,
  coverageRadiusMeters,
  speakerHeight,
} = {}) {
  const sources = Array.isArray(speakerPositions) ? speakerPositions : []
  const seatList = Array.isArray(seats) ? seats : []
  const verticalDistance = Number(speakerHeight) - LISTENER_EAR_HEIGHT_METERS
  const coversSeat = (source, seat) => coverageShape === 'directional'
    ? getDirectionalAngleDeg(source, seat) <= (recommendedCoverageDeg / 2) + 1e-9
    : Math.hypot(
      source.widthMeters - seat.widthMeters,
      source.depthMeters - seat.depthMeters,
    ) <= coverageRadiusMeters + 1e-9

  const seatCoverage = seatList.map((seat) => {
    const coveringSources = sources.filter((source) => coversSeat(source, seat))
    const nearestPhysical = sources
      .map((source) => ({
        source,
        horizontalMeters: Math.hypot(
          source.widthMeters - seat.widthMeters,
          source.depthMeters - seat.depthMeters,
        ),
      }))
      .sort((first, second) => first.horizontalMeters - second.horizontalMeters)[0]
    const nearestEligible = coveringSources
      .map((source) => ({
        source,
        horizontalMeters: Math.hypot(
          source.widthMeters - seat.widthMeters,
          source.depthMeters - seat.depthMeters,
        ),
      }))
      .sort((first, second) => first.horizontalMeters - second.horizontalMeters)[0]
    const nearest = coverageShape === 'directional' ? nearestEligible : nearestPhysical
    return {
      seatId: seat.id,
      coveringSourceIds: coveringSources.map((source) => source.id),
      coveringSourceCount: coveringSources.length,
      covered: coveringSources.length > 0,
      responsibleSpeakerId: nearest?.source.id || null,
      nearestHorizontalDistanceMeters: nearest?.horizontalMeters ?? null,
      nearestPathDistanceMeters: nearest
        ? Math.hypot(nearest.horizontalMeters, verticalDistance)
        : null,
      physicalNearestHorizontalDistanceMeters: nearestPhysical?.horizontalMeters ?? null,
      physicalNearestPathDistanceMeters: nearestPhysical
        ? Math.hypot(nearestPhysical.horizontalMeters, verticalDistance)
        : null,
    }
  })

  const responsibleBySource = sources.map((source) => {
    const assignedSeats = seatCoverage
      .filter((seat) => seat.responsibleSpeakerId === source.id)
      .map((seat) => {
        const horizontalMeters = seat.nearestHorizontalDistanceMeters
        return {
          seatId: seat.seatId,
          horizontalMeters,
          downTiltDeg: Math.atan2(verticalDistance, horizontalMeters) * 180 / Math.PI,
        }
      })
    const angles = assignedSeats.map((seat) => seat.downTiltDeg)
    return {
      speakerId: source.id,
      seatIds: assignedSeats.map((seat) => seat.seatId),
      seatCount: assignedSeats.length,
      minimumDownTiltDeg: angles.length ? Math.min(...angles) : null,
      maximumDownTiltDeg: angles.length ? Math.max(...angles) : null,
    }
  })
  const coveredSeats = seatCoverage.filter((seat) => seat.covered)
  const distanceSeats = coverageShape === 'directional' ? coveredSeats : seatCoverage
  const nearestHorizontalDistances = distanceSeats
    .map((seat) => coverageShape === 'directional'
      ? seat.nearestHorizontalDistanceMeters
      : seat.physicalNearestHorizontalDistanceMeters)
    .filter((value) => value != null)
  const nearestPathDistances = distanceSeats
    .map((seat) => coverageShape === 'directional'
      ? seat.nearestPathDistanceMeters
      : seat.physicalNearestPathDistanceMeters)
    .filter((value) => value != null)
  const assignedAngles = responsibleBySource
    .flatMap((source) => [source.minimumDownTiltDeg, source.maximumDownTiltDeg])
    .filter((value) => value != null)
  const eligibleMinimumHorizontal = nearestHorizontalDistances.length
    ? Math.min(...nearestHorizontalDistances)
    : null
  const eligibleMaximumHorizontal = nearestHorizontalDistances.length
    ? Math.max(...nearestHorizontalDistances)
    : null

  return {
    seatCoverage,
    responsibleBySource,
    coveredSeatCount: coveredSeats.length,
    participantCount: seatList.length,
    uncoveredSeatIds: seatCoverage.filter((seat) => !seat.covered).map((seat) => seat.seatId),
    coverageCounts: seatCoverage.map((seat) => seat.coveringSourceCount),
    minimumCoverageCount: seatCoverage.length ? Math.min(...seatCoverage.map((seat) => seat.coveringSourceCount)) : 0,
    maximumCoverageCount: seatCoverage.length ? Math.max(...seatCoverage.map((seat) => seat.coveringSourceCount)) : 0,
    doubleCoveredSeatCount: seatCoverage.filter((seat) => seat.coveringSourceCount === 2).length,
    excessiveOverlapSeatCount: seatCoverage.filter((seat) => seat.coveringSourceCount >= 3).length,
    maximumHorizontalDistanceMeters: nearestHorizontalDistances.length ? Math.max(...nearestHorizontalDistances) : null,
    maximumPathDistanceMeters: nearestPathDistances.length ? Math.max(...nearestPathDistances) : null,
    eligibleMinimumHorizontalMeters: eligibleMinimumHorizontal,
    eligibleMaximumHorizontalMeters: eligibleMaximumHorizontal,
    downTiltMinimumDeg: assignedAngles.length ? Math.min(...assignedAngles) : null,
    downTiltMaximumDeg: assignedAngles.length ? Math.max(...assignedAngles) : null,
  }
}

function getWallCoverageRequirement(seats, sources) {
  return Math.max(...seats.map((seat) => (
    Math.min(...sources.map((source) => getDirectionalAngleDeg(source, seat))) * 2
  )))
}

function getNearestHorizontalDistance(target, sources) {
  return Math.min(...sources.map((source) => Math.hypot(
    source.widthMeters - target.widthMeters,
    source.depthMeters - target.depthMeters,
  )))
}

function getOverheadCoverageRequirement(seats, sources, verticalDistance) {
  const farthestNearestDistance = Math.max(...seats.map((seat) => (
    getNearestHorizontalDistance(seat, sources)
  )))
  return 2 * Math.atan(farthestNearestDistance / verticalDistance) * 180 / Math.PI
}

function getMinimumPairDistance(items) {
  if (items.length < 2) return 0
  let minimum = Infinity
  items.forEach((item, index) => {
    items.slice(index + 1).forEach((other) => {
      minimum = Math.min(minimum, Math.hypot(
        item.widthMeters - other.widthMeters,
        item.depthMeters - other.depthMeters,
      ))
    })
  })
  return round(minimum)
}

function getMaximumPairDistance(items) {
  let maximum = 0
  items.forEach((item, index) => {
    items.slice(index + 1).forEach((other) => {
      maximum = Math.max(maximum, Math.hypot(
        item.widthMeters - other.widthMeters,
        item.depthMeters - other.depthMeters,
      ))
    })
  })
  return round(maximum)
}

function getSeatSpacing(tableShape, tableDiameter, tableWidth, tableLength, participantCount) {
  const perimeter = tableShape === 'round'
    ? Math.PI * (tableDiameter + (SEAT_RING_OFFSET_METERS * 2))
    : 2 * (tableWidth + tableLength + (SEAT_RING_OFFSET_METERS * 4))
  return round(perimeter / participantCount, 2)
}

function getCoverageOption(minimumCoverageDeg) {
  return COVERAGE_OPTIONS.find((value) => value >= minimumCoverageDeg)
    || COVERAGE_OPTIONS[COVERAGE_OPTIONS.length - 1]
}

const LAYOUT_VARIANTS = [
  { key: 'baseline', label: '基准布局', scale: 1 },
  { key: 'compact', label: '收拢布局', scale: 0.85 },
  { key: 'expanded', label: '展开布局', scale: 1.1 },
]

function dedupeAndValidateSources(sources, roomWidth, roomLength) {
  const valid = []
  sources.forEach((source) => {
    if (!Number.isFinite(source.widthMeters) || !Number.isFinite(source.depthMeters)) return
    if (source.widthMeters < 0 || source.widthMeters > roomWidth || source.depthMeters < 0 || source.depthMeters > roomLength) return
    if (valid.some((other) => Math.hypot(source.widthMeters - other.widthMeters, source.depthMeters - other.depthMeters) < 1e-6)) return
    valid.push(source)
  })
  return valid
}

function getResponsiblePathStats(coverage) {
  const paths = coverage.seatCoverage
    .map((seat) => seat.nearestPathDistanceMeters)
    .filter((value) => Number.isFinite(value))
  return {
    minimum: paths.length ? Math.min(...paths) : null,
    maximum: paths.length ? Math.max(...paths) : null,
  }
}

function getDistanceChangeDb(minimumPath, maximumPath) {
  if (!Number.isFinite(minimumPath) || !Number.isFinite(maximumPath) || minimumPath <= 0 || maximumPath <= 0) return null
  return 20 * Math.log10(maximumPath / minimumPath)
}

function getInstallationAdvice(roomHeight, audioMode, installationCondition) {
  let key = installationCondition === 'blocked'
    ? 'wall'
    : installationCondition === 'open'
      ? 'pendant'
      : 'ceiling'
  if (installationCondition === 'flat' && roomHeight < 2.6) key = 'wall'
  if (installationCondition === 'flat' && roomHeight > 4.5) key = 'pendant'

  if (key === 'wall') {
    return {
      key,
      label: '两侧墙面壁挂分区',
      shortLabel: '壁挂',
      marker: 'W',
      coverageShape: 'directional',
      speakerHeight: round(Math.min(2.5, roomHeight - 0.3)),
      reason: installationCondition === 'blocked'
        ? '顶面不可开孔、承重或存在遮挡，因此改在会议桌两侧长墙成对布置，朝核心坐席区定向覆盖。'
        : `当前层高约 ${roomHeight} m，吸顶音箱距离坐席过近，壁挂方式更便于控制近场热点和覆盖方向。`,
      condition: '墙面安装点应避开显示屏、玻璃反射面和高柜；左右音箱不能直接对准对侧话筒，并需现场复核垂直指向。',
      recommendedSpeakerType: '具有明确水平覆盖角、可调壁架和独立分区驱动能力的小型壁挂会议音箱',
    }
  }
  if (key === 'pendant') {
    return {
      key,
      label: '降低高度的吊装分布式',
      shortLabel: '吊装',
      marker: 'P',
      coverageShape: 'circle',
      speakerHeight: round(Math.min(roomHeight - 0.3, Math.max(2.5, roomHeight - 1.2), 3.2)),
      reason: installationCondition === 'open'
        ? '开放式或挑高顶不适合直接套用嵌入式吸顶坐标，因此把扬声器吊装到较低工作高度，仍按坐席区上方分布。'
        : `当前层高约 ${roomHeight} m，直接贴顶会增加声程和覆盖交叠，因此采用降低安装高度的吊装分布式布局。`,
      condition: '吊点、钢丝绳与安全绳必须满足结构承重要求；实际吊装高度还要避开灯具、风管和摄像视线。',
      recommendedSpeakerType: '覆盖角与分区匹配、具备合规吊装附件和独立分区驱动能力的吊装会议音箱',
    }
  }
  return {
    key,
    label: '吸顶分布式',
    shortLabel: '吸顶',
    marker: 'S',
    coverageShape: 'circle',
    speakerHeight: round(roomHeight - CEILING_SPEAKER_CLEARANCE_METERS),
    reason: `当前层高约 ${roomHeight} m，且顶面允许安装；围桌坐席集中在房间中部，吸顶分区能缩短并均衡各坐席声程${audioMode === 'voiceLift' ? '，也便于划分 Mix-Minus 服务区' : ''}。`,
    condition: '安装点应避开灯具、风口和结构梁，并以所选产品在语音频段的实际覆盖角复核间距。',
    recommendedSpeakerType: '覆盖角与分区匹配、支持独立分区驱动的吸顶会议音箱',
  }
}

function calculateDiscussionEstimate({
  lengthMeters,
  widthMeters,
  heightMeters,
  tableShape = 'round',
  tableDiameterMeters,
  tableLengthMeters,
  tableWidthMeters,
  participantCount,
  audioMode = 'voiceLift',
  installationCondition = 'flat',
  standardClassKey = 'conference',
  gradeKey = 'II',
} = {}) {
  const roomLength = parsePositiveNumber(lengthMeters)
  const roomWidth = parsePositiveNumber(widthMeters)
  const roomHeight = parsePositiveNumber(heightMeters)
  const participants = (typeof participantCount === 'number' || typeof participantCount === 'string')
    ? Number(participantCount)
    : null
  const standardClass = STANDARD_CLASSES.find((item) => item.key === standardClassKey)
  const grade = standardClass?.grades.find((item) => item.key === gradeKey)
  const shape = DISCUSSION_TABLE_SHAPES.find((item) => item.value === tableShape)
  const mode = DISCUSSION_AUDIO_MODES.find((item) => item.value === audioMode)
  const installation = DISCUSSION_INSTALLATION_CONDITIONS.find((item) => item.value === installationCondition)

  if (!roomLength || !roomWidth || !roomHeight || !standardClass || !grade || !shape || !mode || !installation) {
    return { error: '请完整输入场地尺寸，并选择会议桌形状、使用方式、安装条件和目标等级。' }
  }
  if (!Number.isInteger(participants) || participants < 4 || participants > ROOM_SCOPE.maxParticipants) {
    return { error: `参会人数请输入 4～${ROOM_SCOPE.maxParticipants} 的整数。` }
  }
  if ((roomLength * roomWidth) > ROOM_SCOPE.maxFloorAreaSquareMeters || roomHeight > ROOM_SCOPE.maxHeightMeters) {
    return { error: '围桌讨论初版仅适用于面积不超过 300 m²、层高不超过 6 m 的规则矩形会议室。' }
  }
  if (roomHeight < 2.3) {
    return { error: '当前层高不足 2.3 m，不进入自动布置；建议由方案工程师单独复核安装方式和净空。' }
  }

  const tableDiameter = tableShape === 'round' ? parsePositiveNumber(tableDiameterMeters) : null
  const tableLength = tableShape === 'rectangular' ? parsePositiveNumber(tableLengthMeters) : null
  const tableWidth = tableShape === 'rectangular' ? parsePositiveNumber(tableWidthMeters) : null
  if ((tableShape === 'round' && !tableDiameter) || (tableShape === 'rectangular' && (!tableLength || !tableWidth))) {
    return { error: tableShape === 'round' ? '请输入圆桌直径。' : '请输入矩形会议桌的长度和宽度。' }
  }

  const occupiedWidth = tableShape === 'round'
    ? tableDiameter + (SEAT_RING_OFFSET_METERS * 2)
    : tableWidth + (SEAT_RING_OFFSET_METERS * 2)
  const occupiedLength = tableShape === 'round'
    ? tableDiameter + (SEAT_RING_OFFSET_METERS * 2)
    : tableLength + (SEAT_RING_OFFSET_METERS * 2)
  if (
    occupiedWidth + (MIN_SEAT_WALL_CLEARANCE_METERS * 2) > roomWidth
    || occupiedLength + (MIN_SEAT_WALL_CLEARANCE_METERS * 2) > roomLength
  ) {
    return { error: '会议桌、座位环与墙面净距在当前房间内放不下；请检查桌面尺寸或场地长宽。' }
  }

  const seats = buildSeats({
    roomWidth,
    roomLength,
    tableShape,
    tableDiameter,
    tableWidth,
    tableLength,
    participantCount: participants,
  })
  const installationAdvice = getInstallationAdvice(roomHeight, audioMode, installationCondition)
  const speakerHeight = installationAdvice.speakerHeight
  const verticalDistance = speakerHeight - LISTENER_EAR_HEIGHT_METERS
  const designCoverageRadiusMeters =
    verticalDistance * Math.tan((DEFAULT_SPEECH_COVERAGE_DEG / 2) * Math.PI / 180)
  const voiceLift = audioMode === 'voiceLift'
  const routingMinimumCount = voiceLift
    ? getVoiceLiftMinimumCount(tableShape, tableDiameter, tableLength)
    : 2
  const wallInput = { roomWidth, roomLength, occupiedWidth, occupiedLength }
  const nominalCoverageLimit = installationAdvice.key === 'wall' ? 120 : 90
  const candidateList = []
  for (let speakerCount = 2; speakerCount <= 12; speakerCount += 2) {
    LAYOUT_VARIANTS.forEach((variant) => {
      const sources = installationAdvice.key === 'wall'
        ? buildWallSpeakerPositions({
          ...wallInput,
          speakerCount,
          spanScale: variant.scale,
          aimMode: variant.key === 'baseline' ? 'baseline' : 'responsibility',
          seats,
        })
        : buildOverheadSpeakerPositions({
          roomWidth,
          roomLength,
          tableShape,
          tableDiameter,
          tableWidth,
          tableLength,
          audioMode,
          speakerCount,
          coverageRadiusMeters: designCoverageRadiusMeters,
          marker: installationAdvice.marker,
          mountType: installationAdvice.key,
          layoutScale: variant.scale,
        })
      const validSources = dedupeAndValidateSources(sources, roomWidth, roomLength)
      const rawRequiredCoverageDeg = installationAdvice.key === 'wall'
        ? getWallCoverageRequirement(seats, validSources)
        : getOverheadCoverageRequirement(seats, validSources, verticalDistance)
      const nominalCoverageDeg = getCoverageOption(rawRequiredCoverageDeg)
      const coverageRadius = installationAdvice.key === 'wall'
        ? null
        : verticalDistance * Math.tan((nominalCoverageDeg / 2) * Math.PI / 180)
      const coverage = buildDiscussionCoverageSummary({
        seats,
        speakerPositions: validSources,
        coverageShape: installationAdvice.coverageShape,
        recommendedCoverageDeg: nominalCoverageDeg,
        coverageRadiusMeters: coverageRadius,
        speakerHeight,
      })
      const responsiblePathStats = getResponsiblePathStats(coverage)
      candidateList.push({
        id: `${speakerCount}-${variant.key}`,
        count: speakerCount,
        sourceCount: validSources.length,
        variant: variant.key,
        variantLabel: variant.label,
        sources: validSources,
        rawRequiredCoverageDeg,
        nominalCoverageDeg,
        coverageRadiusMeters: coverageRadius,
        coverage,
        uncoveredSeatCount: coverage.uncoveredSeatIds.length,
        excessiveOverlapSeatCount: coverage.excessiveOverlapSeatCount,
        tripleOverlapCount: coverage.excessiveOverlapSeatCount,
        minimumResponsiblePathMeters: responsiblePathStats.minimum,
        worstResponsiblePathMeters: responsiblePathStats.maximum,
        normalizedNearestPathChangeDb: getDistanceChangeDb(responsiblePathStats.minimum, responsiblePathStats.maximum),
        isValid: validSources.length === speakerCount,
        nominalComplete: coverage.uncoveredSeatIds.length === 0 && rawRequiredCoverageDeg <= nominalCoverageLimit + 1e-9,
      })
    })
  }
  const allowedCandidates = candidateList.filter((candidate) => candidate.count >= routingMinimumCount && candidate.isValid)
  const preferredCandidates = allowedCandidates.filter((candidate) => candidate.nominalComplete && candidate.nominalCoverageDeg <= nominalCoverageLimit)
  const backupCandidates = allowedCandidates.filter((candidate) => (
    candidate.uncoveredSeatCount === 0 && candidate.rawRequiredCoverageDeg <= 120 + 1e-9
  ))
  const coverageMinimumCandidate = candidateList
    .filter((candidate) => candidate.nominalComplete && candidate.nominalCoverageDeg <= nominalCoverageLimit && candidate.isValid)
    .sort((first, second) => first.count - second.count || candidateList.indexOf(first) - candidateList.indexOf(second))[0]
  const coverageMinimumCount = coverageMinimumCandidate?.count || 12
  const coverageMinimumCountVerified = Boolean(coverageMinimumCandidate)
  const selectionPool = (preferredCandidates.length
    ? preferredCandidates
    : (backupCandidates.length ? backupCandidates : allowedCandidates))
  if (!selectionPool.length) {
    return { error: '当前候选布局均未生成有效的音箱坐标，无法形成满足路由分区起点的方案；请由方案工程师复核。' }
  }
  const selected = [...selectionPool].sort((first, second) => (
    first.uncoveredSeatCount - second.uncoveredSeatCount
      || first.count - second.count
      || first.excessiveOverlapSeatCount - second.excessiveOverlapSeatCount
      || (first.worstResponsiblePathMeters ?? Infinity) - (second.worstResponsiblePathMeters ?? Infinity)
      || (first.normalizedNearestPathChangeDb ?? Infinity) - (second.normalizedNearestPathChangeDb ?? Infinity)
      || candidateList.indexOf(first) - candidateList.indexOf(second)
  ))[0]
  const sources = selected.sources
  const minimumCoverageDeg = selected.rawRequiredCoverageDeg
  const minimumCoverageDisplayDeg = round(minimumCoverageDeg)
  const recommendedCoverageDeg = selected.nominalCoverageDeg
  const coverageRadiusMeters = selected.coverageRadiusMeters
  const coverageSummary = selected.coverage
  const layoutSelectionSummary = `比较${candidateList.length}组候选，采用${selected.count}只${selected.variantLabel.replace('布局', '')}${coverageMinimumCountVerified ? '' : `；${nominalCoverageLimit}°内无完整覆盖`}${selected.uncoveredSeatCount ? `；未覆盖${selected.uncoveredSeatCount}席` : ''}。`
  coverageSummary.dataBasis = 'nominal-geometry'
  coverageSummary.acousticCoverageVerified = false
  coverageSummary.uncoveredSeatCount = coverageSummary.uncoveredSeatIds.length
  coverageSummary.tripleOverlapCount = coverageSummary.excessiveOverlapSeatCount
  coverageSummary.nominalCoverageDeg = recommendedCoverageDeg
  coverageSummary.rawRequiredCoverageDeg = minimumCoverageDeg
  coverageSummary.minimumResponsiblePathMeters = selected.minimumResponsiblePathMeters
  coverageSummary.worstResponsiblePathMeters = selected.worstResponsiblePathMeters
  coverageSummary.normalizedNearestPathChangeDb = selected.normalizedNearestPathChangeDb
  const maximumHorizontalDistance = coverageSummary.maximumHorizontalDistanceMeters
  const maximumPathDistance = coverageSummary.maximumPathDistanceMeters
  const requiredSplAtOneMeter = round(
    grade.maxSpl + CALCULATION_RESERVE_DB + (20 * Math.log10(Math.max(maximumPathDistance ?? 0, 1))),
  )
  const seatSpacingMeters = getSeatSpacing(
    tableShape,
    tableDiameter,
    tableWidth,
    tableLength,
    participants,
  )
  const tableSummary = tableShape === 'round'
    ? `圆桌 Ø ${tableDiameter} m`
    : `矩形桌 ${tableLength} × ${tableWidth} m`
  const listeningAreaGeometry = tableShape === 'round'
    ? {
        shape: 'round',
        diameterMeters: round(Math.min(
          occupiedWidth + (LISTENING_AREA_BUFFER_METERS * 2),
          roomWidth - 0.4,
          roomLength - 0.4,
        )),
      }
    : {
        shape: 'rectangular',
        widthMeters: round(Math.min(
          occupiedWidth + (LISTENING_AREA_BUFFER_METERS * 2),
          roomWidth - 0.4,
        )),
        lengthMeters: round(Math.min(
          occupiedLength + (LISTENING_AREA_BUFFER_METERS * 2),
          roomLength - 0.4,
        )),
      }
  const actualListeningBufferMeters = round(tableShape === 'round'
    ? (listeningAreaGeometry.diameterMeters - occupiedWidth) / 2
    : Math.min(
        (listeningAreaGeometry.widthMeters - occupiedWidth) / 2,
        (listeningAreaGeometry.lengthMeters - occupiedLength) / 2,
      ))
  const minimumSpeakerSpacingMeters = getMinimumPairDistance(sources)
  const maximumParticipantDistanceMeters = getMaximumPairDistance(seats)
  const mountLayoutReason = installationAdvice.key === 'wall'
    ? `音箱按会议桌两侧长墙成对布置并朝核心坐席区定向，安装高度约 ${speakerHeight} m；建议水平覆盖角约 ${recommendedCoverageDeg}°。`
      : `音箱分布在坐席服务区上方，安装高度约 ${speakerHeight} m；建议单只覆盖角约 ${recommendedCoverageDeg}°，平面参考半径约 ${round(coverageRadiusMeters)} m。`
  const reasons = [
    `${tableSummary}、${participants} 人围桌就座，以桌面、坐席环及外围约 ${actualListeningBufferMeters} m 活动余量作为核心听音区，不要求空墙角达到同等覆盖。`,
    voiceLift
      ? `本地语音提升按 ${sources.length} 个独立扬声器分区估算；每个分区应避免放大自身邻近话筒，形成 Mix-Minus 路由。`
      : '本地发言依靠自然声交流；本地话筒不送回本地扬声器，扬声器主要播放远端会议与媒体节目声。',
    `比较 ${candidateList.length} 个候选布局后，${coverageMinimumCountVerified ? `名义 ${nominalCoverageLimit}° 内完整覆盖候选的数量起点为 ${coverageMinimumCount} 只` : `本候选集未找到名义 ${nominalCoverageLimit}° 内的完整覆盖方案，继续按候选排序并进入复核`}；${voiceLift ? `Mix-Minus 分区起点为 ${routingMinimumCount} 只，` : ''}本次选择 ${sources.length} 只（${selected.variantLabel}）。`,
    `${mountLayoutReason} 图中代表性最小中心间距约 ${minimumSpeakerSpacingMeters} m。`,
    `最不利坐席到最近扬声器的三维声程约 ${maximumPathDistance == null ? '—' : round(maximumPathDistance)} m；单只扬声器前期能力参考为不低于 ${requiredSplAtOneMeter} dB SPL @ 1m。`,
  ]
  const reviewWarnings = [
    ...(minimumCoverageDeg > COVERAGE_OPTIONS[COVERAGE_OPTIONS.length - 1]
      ? [`最不利坐席需要约 ${minimumCoverageDisplayDeg}° 的覆盖角，已超过当前 120° 估算档位；应调整音箱位置、增加分区或改用更合适的安装方式。`]
      : []),
    ...(coverageSummary.uncoveredSeatIds.length
      ? [`当前 ${recommendedCoverageDeg}° / 参考服务区仍有 ${coverageSummary.uncoveredSeatIds.length} 个坐席未覆盖，请调整音箱位置或覆盖角。`]
      : []),
    ...(coverageSummary.excessiveOverlapSeatCount
      ? [`${coverageSummary.excessiveOverlapSeatCount} 个坐席同时落入三个及以上服务区，建议调整音箱位置或覆盖角。`]
      : []),
    ...(installationAdvice.key !== 'wall' && !preferredCandidates.length && backupCandidates.length
      ? ['名义 90° 候选未能完整覆盖，当前退回不超过 120° 的备选布局，需复核。']
      : []),
    '图中为标称角几何范围；有效覆盖和声学均匀度尚待产品指向性与现场核验。',
  ]
  const warnings = [
    ...(seatSpacingMeters < 0.55 ? [`按当前桌面周长估算，平均坐席间距约 ${seatSpacingMeters} m，座位可能偏拥挤。`] : []),
    ...(voiceLift && maximumParticipantDistanceMeters < VOICE_LIFT_DISTANCE_REFERENCE_METERS
      ? [`最远坐席间距约 ${maximumParticipantDistanceMeters} m，未达到通常优先考虑 Voice Lift 的 7.5 m 参考距离；建议先评估自然声是否已足够。`]
      : []),
    '该结果只用于确定扬声器分区与能力起点，不包含房间混响、传声增益、反馈稳定度、AEC 或实际话筒拾音条件。',
  ]

  return {
    kind: 'discussion',
    floorAreaSquareMeters: round(roomLength * roomWidth),
    roomLengthMeters: roomLength,
    roomWidthMeters: roomWidth,
    roomHeightMeters: roomHeight,
    standardLabel: `${standardClass.label} ${grade.label}`,
    standardMaxSpl: grade.maxSpl,
    calculationReserveDb: CALCULATION_RESERVE_DB,
    tableShape,
    tableShapeLabel: shape.label,
    tableSummary,
    tableGeometry: tableShape === 'round'
      ? { shape: 'round', diameterMeters: tableDiameter }
      : { shape: 'rectangular', lengthMeters: tableLength, widthMeters: tableWidth },
    listeningAreaGeometry,
    listeningAreaBufferMeters: actualListeningBufferMeters,
    participantCount: participants,
    seatSpacingMeters,
    audioMode,
    audioModeLabel: mode.label,
    systemLabel: voiceLift
      ? `分区${installationAdvice.shortLabel}语音提升`
      : `${installationAdvice.shortLabel}分区会议播放`,
    systemSummary: `${sources.length} 只${installationAdvice.shortLabel}扬声器 · ${sources.length} 个服务区`,
    speakerCount: sources.length,
    zoneCount: sources.length,
    coverageMinimumCount,
    coverageMinimumCountVerified,
    routingMinimumCount,
    minimumSpeakerSpacingMeters,
    maximumParticipantDistanceMeters,
    installationCondition,
    installationConditionLabel: installation.label,
    installationConditionDescription: installation.description,
    installationMode: installationAdvice.key,
    installationRecommendationKey: installationAdvice.key,
    installationRecommendationLabel: installationAdvice.label,
    installationRecommendationReason: installationAdvice.reason,
    installationRecommendationCondition: installationAdvice.condition,
    installationShortLabel: installationAdvice.shortLabel,
    sourceMarker: installationAdvice.marker,
    installationSourceLabel: `${installationAdvice.shortLabel}音箱`,
    coverageShape: installationAdvice.coverageShape,
    coverageShapeLabel: installationAdvice.coverageShape === 'directional' ? '定向扇形服务区' : '平面圆形参考服务区',
    speakerHeight,
    recommendedSpeakerType: installationAdvice.recommendedSpeakerType,
    minimumCoverageDeg,
    recommendedCoverageDeg,
    coverageRadiusMeters,
    coverageReferenceText: installationAdvice.coverageShape === 'directional'
      ? `水平定向覆盖约 ${recommendedCoverageDeg}°，从两侧墙面朝核心坐席区交叉衔接`
      : `覆盖角约 ${recommendedCoverageDeg}°，单区平面参考半径约 ${round(coverageRadiusMeters)} m`,
    planIntro: installationAdvice.coverageShape === 'directional'
      ? '蓝色区域是核心听音区；绿色扇形是壁挂音箱从两侧墙面朝桌区的水平定向服务区。图中分别标注对向音箱距离与同墙相邻间距。'
      : `蓝色区域是核心听音区；绿色圆域是单只${installationAdvice.shortLabel}音箱在坐席面的参考服务区。图中标注代表性音箱中心间距。`,
    maximumNearestDistanceMeters: maximumPathDistance == null ? null : round(maximumPathDistance),
    maximumHorizontalDistanceMeters: maximumHorizontalDistance == null ? null : round(maximumHorizontalDistance),
    maximumNearestDistanceMetersExact: maximumPathDistance,
    maximumHorizontalDistanceMetersExact: maximumHorizontalDistance,
    requiredSplAtOneMeter,
    routingPrinciple: voiceLift
      ? '采用 Mix-Minus：每支话筒送往较远扬声器分区，并从自身邻近分区中衰减或排除；结合自动混音、AEC 与反馈抑制现场调校。'
      : '本地话筒不回送本地扬声器；远端会议、提示音和媒体节目按各扬声器分区均匀播放。',
    seats,
    speakerPositions: sources,
    coverageSummary,
    coverageVerification: 'unverified',
    layoutSelection: {
      basis: 'nominal-geometry',
      candidateCount: candidateList.length,
      selectedId: selected.id,
      coverageMinimumCount,
      coverageMinimumCountVerified,
      summary: layoutSelectionSummary,
      selectedMetrics: {
        count: selected.count,
        variant: selected.variant,
        nominalCoverageDeg: selected.nominalCoverageDeg,
        rawRequiredCoverageDeg: selected.rawRequiredCoverageDeg,
        uncoveredSeatCount: selected.uncoveredSeatCount,
        tripleOverlapCount: selected.tripleOverlapCount,
        worstResponsiblePathMeters: selected.worstResponsiblePathMeters,
        minimumResponsiblePathMeters: selected.minimumResponsiblePathMeters,
        normalizedNearestPathChangeDb: selected.normalizedNearestPathChangeDb,
      },
      candidates: candidateList.map((candidate) => ({
        id: candidate.id,
        count: candidate.count,
        variant: candidate.variant,
        rawRequiredCoverageDeg: candidate.rawRequiredCoverageDeg,
        nominalCoverageDeg: candidate.nominalCoverageDeg,
        uncoveredSeatCount: candidate.uncoveredSeatCount,
        tripleOverlapCount: candidate.tripleOverlapCount,
        worstResponsiblePathMeters: candidate.worstResponsiblePathMeters,
        minimumResponsiblePathMeters: candidate.minimumResponsiblePathMeters,
        normalizedNearestPathChangeDb: candidate.normalizedNearestPathChangeDb,
        nominalComplete: candidate.nominalComplete,
        sourceCount: candidate.sources.length,
        isValid: candidate.isValid,
      })),
    },
    reasons,
    warnings,
    reviewWarnings,
  }
}

module.exports = {
  DISCUSSION_AUDIO_MODES,
  DISCUSSION_INSTALLATION_CONDITIONS,
  DISCUSSION_TABLE_SHAPES,
  buildDiscussionCoverageSummary,
  calculateDiscussionEstimate,
}

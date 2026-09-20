const {
  mainSpeakers,
  fillSpeakers,
} = require('../data/speaker-recommendation-profiles')
const {
  getCoverageMetrics,
  transformPointToSpeakerAngles,
} = require('./venue-geometry')

const COVERAGE_HORIZONTAL_OPTIONS = [60, 90, 120]
const COVERAGE_VERTICAL_OPTIONS = [30, 40, 50, 60, 70, 80, 90]
const CALCULATION_RESERVE_DB = 3
const FILL_HANDOFF_DROP_DB = 6
const NOMINAL_SPEAKER_CENTER_HEIGHT_METERS = 2.5
const CEILING_CLEARANCE_METERS = 0.3

// 本模块刻意收敛到变量较少的普通会议室，以下是产品功能边界，不是国标分类阈值。
const CONFERENCE_ROOM_SCOPE = {
  maxFloorAreaSquareMeters: 300,
  maxDepthMeters: 20,
  maxHeightMeters: 6,
}

const STANDARD_CLASSES = [
  {
    key: 'conference',
    label: '会议类扩声',
    scenario: '普通会议室、培训室等以语言清晰度为主的平顶、单层、规则矩形空间。',
    grades: [
      { key: 'II', label: '二级', maxSpl: 95, uniformityCheckDb: 8 },
      { key: 'I', label: '一级', maxSpl: 98, uniformityCheckDb: 6 },
    ],
  },
]

function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parsePositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function nextCoverage(options, minimum) {
  return options.find((item) => item >= minimum) || null
}

function getReportServicePoints({
  listeningSideMarginMeters,
  listeningWidthMeters,
  firstListeningDistance,
  lastListeningDistance,
  sourceWidthMeters,
  side,
}) {
  const left = listeningSideMarginMeters + (side === 'left' ? 0 : listeningWidthMeters / 2)
  const right = listeningSideMarginMeters + (side === 'left' ? listeningWidthMeters / 2 : listeningWidthMeters)
  const axis = sourceWidthMeters >= left && sourceWidthMeters <= right ? sourceWidthMeters : null
  const widths = [left, (left + right) / 2, right]
  if (axis !== null) widths.push(axis)
  const depths = [firstListeningDistance, (firstListeningDistance + lastListeningDistance) / 2, lastListeningDistance]
  const points = []
  depths.forEach((depthMeters) => {
    widths.forEach((widthMeters) => {
      if (!points.some((point) => point.widthMeters === widthMeters && point.depthMeters === depthMeters)) {
        points.push({ widthMeters, depthMeters })
      }
    })
  })
  return points
}

function buildReportLayoutCandidates({
  listeningSideMarginMeters,
  listeningWidthMeters,
  firstListeningDistance,
  lastListeningDistance,
  speakerCenterHeightRaw,
}) {
  const positions = [0.25, 0.125, 0.375]
  const candidates = []
  positions.forEach((positionRatio, positionIndex) => {
    const leftWidthMeters = listeningSideMarginMeters + (listeningWidthMeters * positionRatio)
    const rightWidthMeters = listeningSideMarginMeters + (listeningWidthMeters * (1 - positionRatio))
    ;[
      { key: 'axis', yawLeftDeg: 0, yawRightDeg: 0 },
      { key: 'bisector', yawLeftDeg: null, yawRightDeg: null },
    ].forEach((yawMode, yawIndex) => {
      const leftBase = { widthMeters: leftWidthMeters, depthMeters: 0, aimYawDeg: 0 }
      const rightBase = { widthMeters: rightWidthMeters, depthMeters: 0, aimYawDeg: 0 }
      if (yawMode.key === 'bisector') {
        const leftCorners = getReportServicePoints({
          listeningSideMarginMeters,
          listeningWidthMeters,
          firstListeningDistance,
          lastListeningDistance,
          sourceWidthMeters: leftWidthMeters,
          side: 'left',
        }).filter((point) => (
          (point.widthMeters === listeningSideMarginMeters || point.widthMeters === listeningSideMarginMeters + (listeningWidthMeters / 2))
          && (point.depthMeters === firstListeningDistance || point.depthMeters === lastListeningDistance)
        ))
        const rightCorners = getReportServicePoints({
          listeningSideMarginMeters,
          listeningWidthMeters,
          firstListeningDistance,
          lastListeningDistance,
          sourceWidthMeters: rightWidthMeters,
          side: 'right',
        }).filter((point) => (
          (point.widthMeters === listeningSideMarginMeters + (listeningWidthMeters / 2) || point.widthMeters === listeningSideMarginMeters + listeningWidthMeters)
          && (point.depthMeters === firstListeningDistance || point.depthMeters === lastListeningDistance)
        ))
        const leftAngles = leftCorners.map((point) => transformPointToSpeakerAngles(
          point,
          leftBase,
          speakerCenterHeightRaw,
        ).yawDeg)
        const rightAngles = rightCorners.map((point) => transformPointToSpeakerAngles(
          point,
          rightBase,
          speakerCenterHeightRaw,
        ).yawDeg)
        leftBase.aimYawDeg = (Math.min(...leftAngles) + Math.max(...leftAngles)) / 2
        rightBase.aimYawDeg = (Math.min(...rightAngles) + Math.max(...rightAngles)) / 2
      }
      const sources = [
        { ...leftBase, side: 'left' },
        { ...rightBase, side: 'right' },
      ]
      sources.forEach((source) => {
        const points = getReportServicePoints({
          listeningSideMarginMeters,
          listeningWidthMeters,
          firstListeningDistance,
          lastListeningDistance,
          sourceWidthMeters: source.widthMeters,
          side: source.side,
        })
        const physicalAngles = points.map((point) => Math.atan2(
          speakerCenterHeightRaw - 1.2,
          Math.max(Math.hypot(
            point.widthMeters - source.widthMeters,
            point.depthMeters - source.depthMeters,
          ), Number.EPSILON),
        ) * 180 / Math.PI)
        source.aimDownDeg = (Math.min(...physicalAngles) + Math.max(...physicalAngles)) / 2
        source.points = points
      })
      const sourceMetrics = sources.map((source) => getCoverageMetrics(
        source.points,
        source,
        speakerCenterHeightRaw,
      ))
      const requiredHorizontalCoverageRaw = Math.max(...sourceMetrics.map((item) => item.requiredHorizontalCoverageRaw))
      const requiredVerticalCoverageRaw = Math.max(...sourceMetrics.map((item) => item.requiredVerticalCoverageRaw))
      const nearestDistanceRaw = Math.min(...sourceMetrics.map((item) => item.nearestDistanceRaw))
      const farthestDistanceRaw = Math.max(...sourceMetrics.map((item) => item.farthestDistanceRaw))
      const nearestHorizontalDistanceRaw = Math.min(...sourceMetrics.map((item) => item.nearestHorizontalDistanceRaw))
      const farthestHorizontalDistanceRaw = Math.max(...sourceMetrics.map((item) => item.farthestHorizontalDistanceRaw))
      const distanceVariationDbRaw = 20 * Math.log10(farthestDistanceRaw / nearestDistanceRaw)
      const maximumHorizontalCoverage = Math.max(...mainSpeakers.map((item) => item.horizontalCoverageDeg))
      const maximumVerticalCoverage = Math.max(...mainSpeakers.map((item) => item.verticalCoverageDeg))
      const nominalGeometryCovered = mainSpeakers.some((item) => (
        item.horizontalCoverageDeg >= requiredHorizontalCoverageRaw
        && item.verticalCoverageDeg >= requiredVerticalCoverageRaw
      ))
      const normalizedOverAngle = (
        Math.max(0, requiredHorizontalCoverageRaw - maximumHorizontalCoverage) / maximumHorizontalCoverage
        + Math.max(0, requiredVerticalCoverageRaw - maximumVerticalCoverage) / maximumVerticalCoverage
      )
      candidates.push({
        id: `ratio-${String(positionIndex + 1)}-${yawMode.key}`,
        inputOrder: candidates.length,
        positionRatio,
        yawMode: yawMode.key,
        sources: sources.map(({ points, side, ...source }) => source),
        metrics: {
          requiredHorizontalCoverageRaw,
          requiredVerticalCoverageRaw,
          nearestDistanceRaw,
          farthestDistanceRaw,
          nearestHorizontalDistanceRaw,
          farthestHorizontalDistanceRaw,
          distanceVariationDbRaw,
          normalizedOverAngle,
          nominalGeometryCovered,
        },
      })
    })
  })
  candidates.sort((a, b) => (
    Number(b.metrics.nominalGeometryCovered) - Number(a.metrics.nominalGeometryCovered)
    || a.metrics.normalizedOverAngle - b.metrics.normalizedOverAngle
    || a.metrics.farthestDistanceRaw - b.metrics.farthestDistanceRaw
    || a.metrics.distanceVariationDbRaw - b.metrics.distanceVariationDbRaw
    || a.inputOrder - b.inputOrder
  ))
  return candidates
}

function getVenueScale(volume) {
  return volume < 300 ? '小型会议室' : '中型会议室'
}

function getFillRecommendation(directVariationDb, targetVariationDb) {
  if (directVariationDb <= targetVariationDb) {
    return {
      count: 0,
      status: '主扩直达声差在预检查范围内',
      summary: '两只主扩可作为均匀度预估起点',
      reason: '按首排与最远点的直达声距离估算，前后声压差未超过本次预估控制值。',
    }
  }

  if (directVariationDb <= targetVariationDb + 8) {
    return {
      count: 2,
      status: '主扩直达声差偏大，需补声处理',
      summary: '建议增加 2 只后区补声音箱',
      reason: '仅靠前置主扩时，首排与后排的直达声差超过本次预估控制值；建议增加一组后区补声，使后区声压过渡更平缓。',
    }
  }

  return {
    count: 4,
    status: '主扩直达声差较大，需两组补声',
    summary: '建议预留 4 只补声音箱，分中区与后区布置',
    reason: '首排与最远点的直达声差较大，不能把一对前置主扩视为均匀覆盖方案；建议按两组补声作初步预估。',
  }
}

function getClosestProfile(profiles, requiredMaximumSplDb) {
  return profiles
    .filter((item) => item.maximumSplDb >= requiredMaximumSplDb)
    .map((item) => ({
      ...item,
      capacityMarginDb: round(item.maximumSplDb - requiredMaximumSplDb),
      capacityMarginDbRaw: item.maximumSplDb - requiredMaximumSplDb,
    }))
    .sort((a, b) => a.capacityMarginDb - b.capacityMarginDb)[0] || null
}

function getMainSpeakerCandidates({
  requiredSplAtOneMeter,
  requiredSplAtOneMeterRaw = requiredSplAtOneMeter,
  requiredHorizontalCoverage,
  requiredVerticalCoverage,
}) {
  return mainSpeakers
    .filter((item) => (
      item.maximumSplDb >= requiredSplAtOneMeterRaw
      && item.horizontalCoverageDeg >= requiredHorizontalCoverage
      && item.verticalCoverageDeg >= requiredVerticalCoverage
    ))
    .map((item) => {
      const capacityMarginDbRaw = item.maximumSplDb - requiredSplAtOneMeterRaw
      const capacityMarginDb = round(capacityMarginDbRaw)
      const coverageExcessDeg = (
        item.horizontalCoverageDeg - requiredHorizontalCoverage
        + item.verticalCoverageDeg - requiredVerticalCoverage
      )
      return {
        ...item,
        capacityMarginDb,
        capacityMarginDbRaw,
        coverageExcessDeg,
        score: (capacityMarginDb * 3) + (coverageExcessDeg * 0.12),
      }
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
}

function getFillRequirement({ standardMaxSpl, depthMeters }) {
  const assumedListeningDistanceRaw = Math.max(3, Math.min(6, depthMeters / 3))
  return {
    assumedListeningDistance: round(assumedListeningDistanceRaw),
    assumedListeningDistanceRaw,
    requiredMaximumSplDb: round(standardMaxSpl + CALCULATION_RESERVE_DB
      + (20 * Math.log10(assumedListeningDistanceRaw))),
    requiredMaximumSplDbRaw: standardMaxSpl + CALCULATION_RESERVE_DB
      + (20 * Math.log10(assumedListeningDistanceRaw)),
  }
}

function getFillPlacementRecommendation({
  fillCount,
  firstListeningDistance,
  depthMeters,
  heightDifferenceMeters,
}) {
  if (fillCount <= 0) return []

  const groupCount = Math.ceil(fillCount / 2)
  const groupSize = Math.ceil(fillCount / groupCount)
  const handoffRatio = 10 ** (FILL_HANDOFF_DROP_DB / 20)
  const nearestPathDistance = Math.hypot(firstListeningDistance, heightDifferenceMeters)
  const maximumPlacementDepth = depthMeters - 0.5
  if (maximumPlacementDepth <= 0) {
    return { error: '当前补声几何条件不足，无法在主扩后方保留有效的补声安装位置。' }
  }

  const groups = Array.from({ length: groupCount }, (_, index) => {
    const targetPathDistance = nearestPathDistance * (handoffRatio ** (index + 1))
    const calculatedHandoffDistance = Math.sqrt(Math.max(
      (targetPathDistance ** 2) - (heightDifferenceMeters ** 2),
      0,
    ))
    const mainToFillDistanceMetersRaw = Math.min(calculatedHandoffDistance, maximumPlacementDepth)
    const serviceAreaLabel = groupCount === 1
      ? '后区听音区域'
      : index === 0
        ? '中区听音区域'
        : '后区听音区域'

    return {
      label: groupCount === 1 ? '补声组' : `第 ${index + 1} 组补声`,
      count: groupSize,
      mainToFillDistanceMeters: round(mainToFillDistanceMetersRaw),
      mainToFillDistanceMetersRaw,
      serviceAreaLabel,
      mainDropDb: FILL_HANDOFF_DROP_DB * (index + 1),
    }
  })

  const hasInvalidGeometry = groups.some((group, index) => (
    !Number.isFinite(group.mainToFillDistanceMetersRaw)
    || group.mainToFillDistanceMetersRaw < 0.1
    || (index > 0 && group.mainToFillDistanceMetersRaw
      < groups[index - 1].mainToFillDistanceMetersRaw + 0.1)
    || !Number.isFinite(group.mainToFillDistanceMeters)
    || group.mainToFillDistanceMeters <= 0
    || (index > 0 && group.mainToFillDistanceMeters
      <= groups[index - 1].mainToFillDistanceMeters)
  ))
  return hasInvalidGeometry
    ? { error: '当前补声几何条件不足：补声组安装距离无法保持为正值且严格递增，请调整听音纵深或改由工程师布置。' }
    : groups
}

function buildSpeakerRecommendation({
  requiredSplAtOneMeter,
  requiredSplAtOneMeterRaw,
  requiredHorizontalCoverage,
  recommendedHorizontalCoverage,
  requiredVerticalCoverage,
  recommendedVerticalCoverage,
  standardMaxSpl,
  depthMeters,
  firstListeningDistance,
  heightDifferenceMeters,
  fillCount,
}) {
  const mainCandidates = getMainSpeakerCandidates({
    requiredSplAtOneMeter,
    requiredSplAtOneMeterRaw,
    requiredHorizontalCoverage,
    requiredVerticalCoverage,
  })
  const fillRequirement = getFillRequirement({ standardMaxSpl, depthMeters })
  const fillPlacementGroups = getFillPlacementRecommendation({
    fillCount,
    firstListeningDistance,
    depthMeters,
    heightDifferenceMeters,
  })
  if (fillPlacementGroups.error) {
    return { error: fillPlacementGroups.error }
  }
  const fillCandidate = fillCount > 0
    ? getClosestProfile(fillSpeakers, fillRequirement.requiredMaximumSplDbRaw)
    : null

  const packages = mainCandidates.map((main, index) => ({
    label: `方案 ${String.fromCharCode(65 + index)}`,
    main: {
      ...main,
      count: 2,
    },
    fill: fillCandidate && fillCount > 0
      ? {
        ...fillCandidate,
        count: fillCount,
        requiredMaximumSplDb: fillRequirement.requiredMaximumSplDb,
        requiredMaximumSplDbRaw: fillRequirement.requiredMaximumSplDbRaw,
        assumedListeningDistance: fillRequirement.assumedListeningDistance,
        placementGroups: fillPlacementGroups,
      }
      : null,
  }))

  const missingParts = []
  if (fillCount > 0 && !fillCandidate) missingParts.push('补声')
  const reviewWarnings = []
  reviewWarnings.push('标称角仅作几何筛选；频段指向性与最大声压测试口径尚待核验。')
  if (!mainCandidates.length) {
    reviewWarnings.push(
       `当前已登记音箱资料没有同时满足几何最低需求 ${requiredHorizontalCoverage.toFixed(2)}°H、${requiredVerticalCoverage.toFixed(2)}°V 和声压能力要求的主扩候选（显示档位 ${recommendedHorizontalCoverage}°H/${recommendedVerticalCoverage}°V）；最大声压测试口径待核对，请调整布置或由工程师专项选型。`,
    )
  }
  if (fillCount > 0 && !fillCandidate) {
    reviewWarnings.push('当前已登记音箱资料没有满足补声声压能力要求的候选；最大声压测试口径待核对，请由工程师专项选型。')
  }

  return {
    systemLabel: '点声源 L/R 主扩',
    systemReason: '本模块仅针对普通矩形会议室，以定覆盖点声源作为左右主扩进行初步选型。',
    qualificationStatus: 'provisional',
    hasMainMatch: packages.length > 0,
    packages,
    mainRequirement: {
      requiredMaximumSplDb: requiredSplAtOneMeter,
      requiredMaximumSplDbRaw: requiredSplAtOneMeterRaw,
      horizontalCoverageDeg: recommendedHorizontalCoverage,
      horizontalCoverageRequiredDeg: requiredHorizontalCoverage,
      verticalCoverageDeg: recommendedVerticalCoverage,
      verticalCoverageRequiredDeg: requiredVerticalCoverage,
    },
    fillRequirement,
    fillPlacementGroups,
    missingParts,
    reviewWarnings,
    notes: [
      '仅从已登记角色、标称覆盖角和最大声压字段的公司音箱资料中筛选；最大声压测试口径待核对，覆盖角可变或参数不完整的型号不参与自动推荐。',
      '补声位置用于粗略确定安装区域；实际电平、延时、相位与指向必须在安装完成后按现场测量确定。',
    ],
  }
}

function calculateVenueEstimate({
  lengthMeters,
  widthMeters,
  heightMeters,
  firstListeningDistanceMeters,
  lastListeningDistanceMeters,
  listeningWidthMeters,
  layout,
  standardClassKey,
  gradeKey,
} = {}) {
  const length = parsePositiveNumber(lengthMeters)
  const width = parsePositiveNumber(widthMeters)
  const height = parsePositiveNumber(heightMeters)
  const firstListeningDistance = parsePositiveNumber(firstListeningDistanceMeters)
  const standardClass = STANDARD_CLASSES.find((item) => item.key === standardClassKey)
  const grade = standardClass?.grades.find((item) => item.key === gradeKey)

  if (!length || !width || !height || !firstListeningDistance || !standardClass || !grade) {
    return { error: '请完整输入场地尺寸、首排听音距离，并选择目标等级。' }
  }
  if (height <= CEILING_CLEARANCE_METERS) {
    return { error: `层高必须高于 ${CEILING_CLEARANCE_METERS} m，当前条件无法给出有效的音箱安装方案。` }
  }

  const useShortWall = layout === 'short'
  const frontWidthMeters = useShortWall ? Math.min(length, width) : Math.max(length, width)
  const depthMeters = useShortWall ? Math.max(length, width) : Math.min(length, width)
  const rawFloorAreaSquareMeters = length * width
  const floorAreaSquareMeters = round(rawFloorAreaSquareMeters)
  const volumeCubicMeters = round(length * width * height)
  const lastListeningDistance = lastListeningDistanceMeters === undefined
    ? depthMeters
    : parsePositiveNumber(lastListeningDistanceMeters)
  const listeningWidth = listeningWidthMeters === undefined
    ? frontWidthMeters
    : parsePositiveNumber(listeningWidthMeters)

  if (
    rawFloorAreaSquareMeters > CONFERENCE_ROOM_SCOPE.maxFloorAreaSquareMeters
    || depthMeters > CONFERENCE_ROOM_SCOPE.maxDepthMeters
    || height > CONFERENCE_ROOM_SCOPE.maxHeightMeters
  ) {
    return {
      error: `本模块仅输出普通矩形会议室的点声源初步建议：面积不超过 ${CONFERENCE_ROOM_SCOPE.maxFloorAreaSquareMeters} m²、主扩服务纵深不超过 ${CONFERENCE_ROOM_SCOPE.maxDepthMeters} m、层高不超过 ${CONFERENCE_ROOM_SCOPE.maxHeightMeters} m。礼堂、音乐厅、阶梯/分层或异形场地请由方案工程师专项设计。`,
    }
  }

  if (firstListeningDistance >= depthMeters) {
    return { error: '首排听音距离应小于主扩服务纵深。请检查主扩安装方向或首排距离。' }
  }

  if (!lastListeningDistance || lastListeningDistance > depthMeters) {
    return { error: '最后一排距离应大于 0，且不能超过当前主扩方向下的场地纵深。' }
  }

  if (lastListeningDistance <= firstListeningDistance) {
    return { error: '最后一排听音距离应大于首排听音距离。' }
  }

  if (!listeningWidth || listeningWidth > frontWidthMeters) {
    return { error: '有效听音区宽度应大于 0，且不能超过当前主扩方向下的场地宽度。' }
  }

  // 普通会议室优先按常用 2.5 m 安装中心高度预估；顶棚不足时才下调。
  const speakerCenterHeightRaw = Math.min(
    NOMINAL_SPEAKER_CENTER_HEIGHT_METERS,
    height - CEILING_CLEARANCE_METERS,
  )
  const speakerCenterHeight = round(speakerCenterHeightRaw)
  const listenerEarHeight = 1.2
  const heightDelta = speakerCenterHeightRaw - listenerEarHeight
  const heightDifference = Math.abs(heightDelta)
  const listeningSideMarginRaw = (frontWidthMeters - listeningWidth) / 2
  const layoutCandidates = buildReportLayoutCandidates({
    listeningSideMarginMeters: listeningSideMarginRaw,
    listeningWidthMeters: listeningWidth,
    firstListeningDistance,
    lastListeningDistance,
    speakerCenterHeightRaw,
  })
  const selectedLayout = layoutCandidates[0]
  const selectedMetrics = selectedLayout.metrics
  const nearestDistanceRaw = selectedMetrics.nearestDistanceRaw
  const farthestDistanceRaw = selectedMetrics.farthestDistanceRaw
  const distanceLossDbRaw = 20 * Math.log10(farthestDistanceRaw)
  const directVariationDbRaw = 20 * Math.log10(farthestDistanceRaw / nearestDistanceRaw)
  const farthestDistance = round(farthestDistanceRaw)
  const distanceLossDb = round(distanceLossDbRaw)
  const directVariationDb = round(directVariationDbRaw)
  const requiredSplAtOneMeterRaw = grade.maxSpl + CALCULATION_RESERVE_DB + distanceLossDbRaw
  const requiredSplAtOneMeter = round(requiredSplAtOneMeterRaw)

  const requiredHorizontalCoverage = selectedMetrics.requiredHorizontalCoverageRaw
  const minimumHorizontalCoverage = round(requiredHorizontalCoverage)
  const recommendedHorizontalCoverage = nextCoverage(
    COVERAGE_HORIZONTAL_OPTIONS,
    Math.max(requiredHorizontalCoverage, 60),
  )
  if (!recommendedHorizontalCoverage) {
    return {
      error: `首排至最后一排的主扩半区需要约 ${requiredHorizontalCoverage.toFixed(2)}° 水平覆盖，已超过自动布置上限 120°；请调整主扩位置、听音区宽度/距离或由工程师专项设计。`,
      reviewWarnings: [`水平覆盖需求 ${requiredHorizontalCoverage.toFixed(2)}° 超过当前自动布置上限 120°。`],
    }
  }

  const minimumVerticalCoverageRaw = selectedMetrics.requiredVerticalCoverageRaw
  const recommendedVerticalCoverage = nextCoverage(
    COVERAGE_VERTICAL_OPTIONS,
    Math.max(minimumVerticalCoverageRaw, 30),
  )
  if (!recommendedVerticalCoverage) {
    return {
      error: `首排至最后一排的主扩垂直覆盖需求约 ${minimumVerticalCoverageRaw.toFixed(2)}°，超过当前自动布置上限 90°；请由工程师专项设计。`,
      reviewWarnings: [`垂直覆盖需求 ${minimumVerticalCoverageRaw.toFixed(2)}° 超过当前自动布置上限 90°。`],
    }
  }
  const recommendedAimDownDegRaw = selectedLayout.sources[0].aimDownDeg
  const recommendedAimDownDeg = round(recommendedAimDownDegRaw)
  const listeningSideMargin = round(listeningSideMarginRaw)

  const fill = getFillRecommendation(directVariationDbRaw, grade.uniformityCheckDb)
  const speakerRecommendation = buildSpeakerRecommendation({
    requiredSplAtOneMeter,
    requiredSplAtOneMeterRaw,
    requiredHorizontalCoverage,
    requiredVerticalCoverage: minimumVerticalCoverageRaw,
    recommendedHorizontalCoverage,
    recommendedVerticalCoverage,
    standardMaxSpl: grade.maxSpl,
    depthMeters: lastListeningDistance,
    firstListeningDistance: selectedMetrics.nearestHorizontalDistanceRaw,
    heightDifferenceMeters: heightDifference,
    fillCount: fill.count,
  })
  if (speakerRecommendation.error) {
    return { error: speakerRecommendation.error }
  }
  const standardLabel = `${standardClass.label} ${grade.label}`
  const reasons = [
    `目标为 ${standardLabel}，其最大声压级能力目标为不小于 ${grade.maxSpl} dB SPL。`,
    `按“${useShortWall ? '短边前置主扩' : '长边前置主扩'}”估算，场地横向宽度约 ${frontWidthMeters} m、纵深约 ${depthMeters} m；实际听音区宽度约 ${listeningWidth} m，首排至最后一排为 ${firstListeningDistance}～${lastListeningDistance} m。`,
    `首排距离为 ${firstListeningDistance} m、最远听音位置约 ${farthestDistance} m；两点的自由场直达声差约 ${directVariationDb} dB。`,
    `本模块按最大声压级能力目标额外预留 ${CALCULATION_RESERVE_DB} dB，用于前期容量估算；单只主扩建议具备约 ${requiredSplAtOneMeter} dB SPL @ 1m 的能力。`,
    `主扩水平几何最低需求约 ${requiredHorizontalCoverage.toFixed(2)}°，显示档位为 ${recommendedHorizontalCoverage}°；垂直几何最低需求约 ${minimumVerticalCoverageRaw.toFixed(2)}°，显示档位为 ${recommendedVerticalCoverage}°，初始下倾角约 ${recommendedAimDownDeg}°。候选型号的标称 H/V 角另行复核。`,
    fill.reason,
  ]

  return {
    kind: 'report',
    floorAreaSquareMeters,
    venueScale: getVenueScale(volumeCubicMeters),
    standardLabel,
    standardMaxSpl: grade.maxSpl,
    calculationReserveDb: CALCULATION_RESERVE_DB,
    frontWidthMeters,
    depthMeters,
    firstListeningDistance,
    lastListeningDistance,
    lastListeningDistanceRaw: lastListeningDistance,
    listeningWidth,
    listeningSideMargin,
    listeningSideMarginRaw,
    farthestDistance,
    farthestDistanceRaw,
    nearestDistance: round(nearestDistanceRaw),
    nearestDistanceRaw,
    distanceLossDb,
    distanceLossDbRaw,
    directVariationDb,
    directVariationDbRaw,
    uniformityCheckDb: grade.uniformityCheckDb,
    uniformityStatus: fill.status,
    mainDirectSoundPass: fill.count === 0,
    mainCount: 2,
    mainSystemSummary: '主扩 2 只',
    fillCount: fill.count,
    fillSummary: fill.summary,
    requiredSplAtOneMeter,
    requiredSplAtOneMeterRaw,
    minimumHorizontalCoverage,
    minimumHorizontalCoverageRaw: requiredHorizontalCoverage,
    recommendedHorizontalCoverage,
    minimumVerticalCoverage: round(minimumVerticalCoverageRaw),
    minimumVerticalCoverageRaw,
    recommendedVerticalCoverage,
    speakerCenterHeight,
    speakerCenterHeightRaw,
    heightDeltaMeters: heightDelta,
    heightDifferenceMeters: heightDifference,
    recommendedAimDownDeg,
    recommendedAimDownDegRaw,
    mainSpeakerPositions: selectedLayout.sources.map((source) => ({
      widthMeters: source.widthMeters,
      depthMeters: source.depthMeters,
      aimYawDeg: source.aimYawDeg,
      aimDownDeg: source.aimDownDeg,
    })),
    layoutSelection: {
      candidateCount: layoutCandidates.length,
      selectedId: selectedLayout.id,
      basis: 'nominal-geometry',
      summary: `比较 6 组位置与指向，采用左右对称前置方案${selectedLayout.sources.some((source) => Math.abs(source.aimYawDeg) > 0.000001) ? '，并调整指向以包络座席' : ''}。`,
      candidates: layoutCandidates.map((candidate) => ({
        id: candidate.id,
        positionRatio: candidate.positionRatio,
        yawMode: candidate.yawMode,
        metrics: { ...candidate.metrics },
      })),
    },
    coverageVerification: 'unverified',
    capacityVerification: 'source-review-required',
    speakerRecommendation,
    reviewWarnings: speakerRecommendation.reviewWarnings,
    reasons,
  }
}

module.exports = {
  STANDARD_CLASSES,
  calculateVenueEstimate,
}

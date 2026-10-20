const LED_ASPECT_RATIOS = [
  { key: '16:9', label: '16:9', value: 16 / 9 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '21:9', label: '21:9', value: 21 / 9 },
  { key: '16:10', label: '16:10', value: 16 / 10 },
  { key: '32:9', label: '32:9', value: 32 / 9 },
]
const TARGET_ASPECT_RATIO = LED_ASPECT_RATIOS[0].value
const PREFERRED_RATIO_ERROR = 0.05

const LED_UNIT_SPECS = {
  module: {
    key: 'module',
    type: 'module',
    label: '模组',
    widthMm: 320,
    heightMm: 160,
  },
  cabinetStandard: {
    key: 'cabinetStandard',
    type: 'cabinet',
    label: '常规箱体',
    widthMm: 640,
    heightMm: 480,
  },
  cabinetPremiumA: {
    key: 'cabinetPremiumA',
    type: 'cabinet',
    label: '高端 A 系列',
    widthMm: 600,
    heightMm: 337.5,
  },
}

const LED_PIXEL_PITCHES = [1.25, 1.53, 1.86, 2]

function round(value, digits = 2) {
  const scale = 10 ** digits
  return Math.round((value + Number.EPSILON) * scale) / scale
}

function formatNumber(value, digits = 2) {
  return round(value, digits).toString()
}

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function getUnitSpec(key) {
  return LED_UNIT_SPECS[key] || null
}

function getAspectRatio(key = '16:9') {
  return LED_ASPECT_RATIOS.find((item) => item.key === key) || null
}

function chooseRecommendedPitch(distanceMeters) {
  for (let index = LED_PIXEL_PITCHES.length - 1; index >= 0; index -= 1) {
    if (distanceMeters >= LED_PIXEL_PITCHES[index] * 1.7) return LED_PIXEL_PITCHES[index]
  }
  return LED_PIXEL_PITCHES[0]
}

function evaluateViewingDistance(distanceMeters, pitch) {
  const minimumDistanceMeters = round(pitch, 2)
  const comfortableMinimumMeters = round(pitch * 1.7, 2)
  const comfortableMaximumMeters = round(pitch * 3, 2)
  let statusKey = 'fit'
  let statusLabel = '观看距离匹配'
  let statusText = '最近观看位置处于该点间距的舒适观看范围。'

  if (distanceMeters < minimumDistanceMeters) {
    statusKey = 'avoid'
    statusLabel = '距离过近'
    statusText = '最近观看位置小于点间距的最低距离参考，近看可能明显感知像素。'
  } else if (distanceMeters < comfortableMinimumMeters) {
    statusKey = 'near'
    statusLabel = '观看位置偏近'
    statusText = '可以观看，但低于舒适距离参考，建议选用更细点间距。'
  } else if (distanceMeters > comfortableMaximumMeters) {
    statusKey = 'surplus'
    statusLabel = '清晰度富余'
    statusText = '观看距离较远，当前点间距清晰度有富余。'
  }

  return {
    minimumDistanceMeters,
    comfortableMinimumMeters,
    comfortableMaximumMeters,
    comfortableRangeText: `${formatNumber(comfortableMinimumMeters)}～${formatNumber(comfortableMaximumMeters)} m`,
    statusKey,
    statusLabel,
    statusText,
  }
}

function buildCandidate(rows, columns, unit, targetAspectRatio) {
  const widthMm = columns * unit.widthMm
  const heightMm = rows * unit.heightMm
  const actualRatio = widthMm / heightMm
  const ratioError = Math.abs(actualRatio - targetAspectRatio) / targetAspectRatio
  return {
    rows,
    columns,
    widthMm,
    heightMm,
    actualRatio,
    ratioError,
    area: widthMm * heightMm,
  }
}

function findBestLayout(unit, limits, targetAspectRatio) {
  if (!Number.isFinite(limits.wallWidthMm) || !Number.isFinite(limits.usableHeightMm)) {
    return { error: '当前墙面尺寸超出可可靠计算范围。' }
  }
  const maximumRows = Math.floor(limits.usableHeightMm / unit.heightMm)
  const maximumColumns = Math.floor(limits.wallWidthMm / unit.widthMm)
  if (!Number.isSafeInteger(maximumRows) || !Number.isSafeInteger(maximumColumns)) {
    return { error: '当前墙面尺寸超出可可靠计算范围。' }
  }
  if (!Number.isSafeInteger(maximumRows * maximumColumns)) {
    return { error: '当前墙面尺寸超出可可靠计算范围。' }
  }
  if (maximumRows < 1 || maximumColumns < 1) return null

  const columnsPerRow = targetAspectRatio * unit.heightMm / unit.widthMm
  if (!(columnsPerRow > 0) || !Number.isFinite(columnsPerRow)) {
    return { error: '当前墙面尺寸超出可可靠计算范围。' }
  }
  const widthLimitedRow = Math.ceil(maximumColumns / columnsPerRow)
  if (!Number.isSafeInteger(widthLimitedRow) || widthLimitedRow < 1) {
    return { error: '当前墙面尺寸超出可可靠计算范围。' }
  }

  let closestFallback = null

  function considerCandidate(rows, columns) {
    if (!Number.isSafeInteger(columns) || columns < 1 || columns > maximumColumns) return null
    const candidate = buildCandidate(rows, columns, unit, targetAspectRatio)
    if (!Number.isFinite(candidate.area)) {
      return null
    }
    if (!closestFallback
      || candidate.ratioError < closestFallback.ratioError - 1e-9
      || (Math.abs(candidate.ratioError - closestFallback.ratioError) <= 1e-9
        && candidate.area > closestFallback.area)) {
      closestFallback = candidate
    }
    return candidate
  }

  function preferredCandidateForRows(rows) {
    const idealColumns = rows * columnsPerRow
    const preferredUpperBound = idealColumns * (1 + PREFERRED_RATIO_ERROR)
    if (!Number.isFinite(idealColumns) || !Number.isFinite(preferredUpperBound)) return null
    const floatingEpsilon = Number.EPSILON * Math.max(1, Math.abs(preferredUpperBound)) * 16
    const candidateColumns = new Set([
      Math.floor(idealColumns),
      Math.ceil(idealColumns),
      maximumColumns,
      Math.floor(preferredUpperBound + floatingEpsilon),
    ])
    let largestPreferredForRows = null
    for (const rawColumns of candidateColumns) {
      const columns = Math.max(1, Math.min(maximumColumns, rawColumns))
      const candidate = considerCandidate(rows, columns)
      if (candidate && candidate.ratioError <= PREFERRED_RATIO_ERROR + 1e-9
        && (!largestPreferredForRows || columns > largestPreferredForRows.columns
          || (columns === largestPreferredForRows.columns
            && candidate.ratioError < largestPreferredForRows.ratioError))) {
        largestPreferredForRows = candidate
      }
    }
    return largestPreferredForRows
  }

  // Rows above this point are width-limited. Their ratio error grows
  // monotonically, so calculate the highest row that can still be preferred
  // and inspect only that row instead of walking the whole width-limited tail.
  const highPreferredRowBound = maximumColumns
    / (columnsPerRow * (1 - PREFERRED_RATIO_ERROR))
  if (!Number.isFinite(highPreferredRowBound)) {
    return { error: '当前墙面尺寸超出可可靠计算范围。' }
  }
  const highPreferredRowEpsilon = Number.EPSILON
    * Math.max(1, Math.abs(highPreferredRowBound)) * 16
  const highestHighPreferredRow = Math.min(
    maximumRows,
    Math.floor(highPreferredRowBound + highPreferredRowEpsilon),
  )
  if (highestHighPreferredRow > widthLimitedRow) {
    const widthLimitedCandidate = considerCandidate(highestHighPreferredRow, maximumColumns)
    if (widthLimitedCandidate
      && widthLimitedCandidate.ratioError <= PREFERRED_RATIO_ERROR + 1e-9) {
      return widthLimitedCandidate
    }
  }

  const firstRow = Math.min(maximumRows, widthLimitedRow)
  for (let rows = firstRow; rows >= 1; rows -= 1) {
    const preferred = preferredCandidateForRows(rows)
    if (preferred) return preferred
  }
  return closestFallback
}

function calculateLedScreenPlan(input) {
  const wallWidthMeters = toFiniteNumber(input.wallWidthMeters)
  const wallHeightMeters = toFiniteNumber(input.wallHeightMeters)
  const topReserveMeters = toFiniteNumber(input.topReserveMeters)
  const bottomReserveMeters = toFiniteNumber(input.bottomReserveMeters)
  const frameWidthMeters = input.frameWidthMeters === undefined
    ? 0.05
    : toFiniteNumber(input.frameWidthMeters)
  const viewingDistanceMeters = toFiniteNumber(input.viewingDistanceMeters)
  const unit = getUnitSpec(input.unitKey)
  const aspectRatio = getAspectRatio(input.aspectRatioKey)
  const requestedPitch = input.pixelPitch === 'recommended'
    ? 'recommended'
    : toFiniteNumber(input.pixelPitch)

  if (!(wallWidthMeters > 0) || !(wallHeightMeters > 0)) {
    return { error: '请填写有效的墙体宽度和高度。' }
  }
  if (topReserveMeters === null) {
    return { error: '请填写有效的上方预留空间。' }
  }
  if (bottomReserveMeters === null) {
    return { error: '请填写有效的下方预留空间。' }
  }
  if (frameWidthMeters === null) {
    return { error: '请填写有效的四周包边尺寸。' }
  }
  if (topReserveMeters < 0 || bottomReserveMeters < 0) {
    return { error: '上下预留空间不能小于 0。' }
  }
  if (frameWidthMeters < 0) {
    return { error: '四周包边尺寸不能小于 0。' }
  }
  if (frameWidthMeters * 2 >= wallWidthMeters) {
    return { error: '左右包边尺寸之和必须小于墙体宽度。' }
  }
  if (topReserveMeters + bottomReserveMeters + frameWidthMeters * 2 >= wallHeightMeters) {
    return { error: '上下预留与包边尺寸之和必须小于墙体高度。' }
  }
  if (!(viewingDistanceMeters > 0)) {
    return { error: '请填写有效的最近观看距离。' }
  }
  if (!unit) return { error: '请选择有效的模组或箱体规格。' }
  if (!aspectRatio) return { error: '请选择有效的画面比例。' }
  if (requestedPitch !== 'recommended' && !LED_PIXEL_PITCHES.includes(requestedPitch)) {
    return { error: '请选择公司现有的点间距规格。' }
  }

  const limits = {
    wallWidthMm: (wallWidthMeters - frameWidthMeters * 2) * 1000,
    usableHeightMm: (
      wallHeightMeters - topReserveMeters - bottomReserveMeters - frameWidthMeters * 2
    ) * 1000,
  }
  const layout = findBestLayout(unit, limits, aspectRatio.value)
  if (layout && layout.error) return { error: layout.error }
  if (!layout) return { error: `当前可用墙面放不下一块${unit.label}。` }

  const pixelPitch = requestedPitch === 'recommended'
    ? chooseRecommendedPitch(viewingDistanceMeters)
    : requestedPitch
  const viewing = evaluateViewingDistance(viewingDistanceMeters, pixelPitch)
  const screenWidthMeters = layout.widthMm / 1000
  const screenHeightMeters = layout.heightMm / 1000
  const installedWidthMeters = screenWidthMeters + frameWidthMeters * 2
  const installedHeightMeters = screenHeightMeters + frameWidthMeters * 2
  const horizontalMarginMeters = (wallWidthMeters - installedWidthMeters) / 2
  const remainingVerticalMeters = (
    wallHeightMeters - topReserveMeters - bottomReserveMeters - installedHeightMeters
  )
  const actualTopMarginMeters = topReserveMeters + remainingVerticalMeters / 2
  const actualBottomMarginMeters = bottomReserveMeters + remainingVerticalMeters / 2
  const estimatedPixelWidth = Math.round(layout.widthMm / pixelPitch)
  const estimatedPixelHeight = Math.round(layout.heightMm / pixelPitch)
  if (!Number.isSafeInteger(estimatedPixelWidth) || !Number.isSafeInteger(estimatedPixelHeight)) {
    return { error: '当前墙面尺寸超出可可靠计算范围。' }
  }
  const ratioCloseToTarget = layout.ratioError <= 0.015

  return {
    unitKey: unit.key,
    unitType: unit.type,
    unitLabel: unit.label,
    unitSizeText: `${formatNumber(unit.widthMm, 1)} × ${formatNumber(unit.heightMm, 1)} mm`,
    columns: layout.columns,
    rows: layout.rows,
    totalUnits: layout.columns * layout.rows,
    screenWidthMeters: round(screenWidthMeters, 3),
    screenHeightMeters: round(screenHeightMeters, 3),
    dimensionText: `${formatNumber(screenWidthMeters, 3)} × ${formatNumber(screenHeightMeters, 3)} m`,
    frameWidthMeters: round(frameWidthMeters, 3),
    frameWidthCentimeters: round(frameWidthMeters * 100, 1),
    frameWidthText: `${formatNumber(frameWidthMeters * 100, 1)} cm / 边`,
    installedWidthMeters: round(installedWidthMeters, 3),
    installedHeightMeters: round(installedHeightMeters, 3),
    installedDimensionText: `${formatNumber(installedWidthMeters, 3)} × ${formatNumber(installedHeightMeters, 3)} m`,
    actualRatio: round(layout.actualRatio, 3),
    targetAspectRatioKey: aspectRatio.key,
    targetAspectRatio: aspectRatio.value,
    ratioText: ratioCloseToTarget ? `≈ ${aspectRatio.label}` : `${formatNumber(layout.actualRatio, 2)}:1`,
    ratioCloseToTarget,
    horizontalMarginMeters: round(horizontalMarginMeters, 3),
    horizontalMarginText: `${formatNumber(horizontalMarginMeters, 3)} m / 侧`,
    actualTopMarginMeters: round(actualTopMarginMeters, 3),
    actualBottomMarginMeters: round(actualBottomMarginMeters, 3),
    verticalMarginText: `${formatNumber(actualTopMarginMeters, 3)} / ${formatNumber(actualBottomMarginMeters, 3)} m`,
    estimatedPixelWidth,
    estimatedPixelHeight,
    resolutionText: `约 ${estimatedPixelWidth} × ${estimatedPixelHeight}`,
    pixelPitch,
    pitchText: `P${formatNumber(pixelPitch, 4)}`,
    pitchMode: requestedPitch === 'recommended' ? 'recommended' : 'specified',
    pitchModeLabel: requestedPitch === 'recommended' ? '系统推荐' : '指定点间距',
    viewingDistanceMeters: round(viewingDistanceMeters, 2),
    ...viewing,
  }
}

module.exports = {
  LED_ASPECT_RATIOS,
  LED_PIXEL_PITCHES,
  LED_UNIT_SPECS,
  PREFERRED_RATIO_ERROR,
  TARGET_ASPECT_RATIO,
  calculateLedScreenPlan,
  chooseRecommendedPitch,
  evaluateViewingDistance,
}

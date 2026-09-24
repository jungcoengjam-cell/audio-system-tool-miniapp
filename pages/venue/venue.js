const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishVenueModuleLoad = startMeasurement('会议室/脚本加载')
const { STANDARD_CLASSES, calculateVenueEstimate } = require('../../utils/venue')
const { buildVenuePlan, buildVenueHandoffReviewForResult } = require('../../utils/venue-plan')
const {
  DISCUSSION_INSTALLATION_CONDITIONS,
  DISCUSSION_TABLE_SHAPES,
  calculateDiscussionEstimate,
} = require('../../utils/venue-discussion')
const { buildDiscussionPlan } = require('../../utils/venue-discussion-plan')
const { findValueIndex, readPreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  cancelResultReportGeneration,
  createResultReportData,
  createResultReportMethods,
  resetStaleResultReport,
} = require('../../utils/result-report-controller')
const {
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')
const { addRecordToProject, createProject, getActiveProject } = require('../../utils/records')
const {
  drawVenuePlan: renderVenuePlan,
  getVenuePlanCanvasHeight,
  REPORT_HEATMAP_GRADIENT,
  REPORT_HEATMAP_TICKS,
} = require('./plan-renderer')
const { calculatePagNagReview } = require('../../utils/venue-pag-nag')
const {
  createOperationMethods,
  prepareOperation,
  captureOperationResult,
  isOperationResultCurrent,
  invalidateOperation,
} = require('../../utils/operation-inputs')
const {
  formatDb,
  formatMargin,
  getPagNagDescription,
  getPagNagInputLines,
  getPagNagResultLines,
} = require('./pag-nag')

const DEFAULT_PLAN_CANVAS_WIDTH = 320
const DEFAULT_PLAN_CANVAS_HEIGHT = 240
const PREFERENCE_KEY = 'audioTool.venue.preferences'
const resultReportMethods = createResultReportMethods({
  performancePrefix: '会议室',
  emptyToast: '暂无可生成的预估结果',
})
const SCENE_MODES = [
  { value: 'report', label: '报告 / 培训型' },
  { value: 'discussion', label: '围桌讨论型' },
]

const VENUE_REPORT_FIELDS = {
  lengthText: { label: '场地长度', unit: 'm' },
  widthText: { label: '场地宽度', unit: 'm' },
  heightText: { label: '场地高度', unit: 'm' },
  firstListeningDistanceText: { label: '首排距离', unit: 'm' },
  lastListeningDistanceText: { label: '末排距离', unit: 'm' },
  listeningWidthText: { label: '听音宽度', unit: 'm' },
  gradeIndex: {
    label: '目标等级', unit: 'index', display: (value) => value === undefined || value === '' || value === -1
      ? '待确认' : STANDARD_CLASSES[0].grades[value]?.label || '无效等级',
    read: (_page, data) => Number.isInteger(data.gradeIndex) && STANDARD_CLASSES[0].grades[data.gradeIndex]
      ? data.gradeIndex : undefined,
  },
  layoutIndex: {
    label: '主扩安装方向', unit: 'index', display: (value) => value === undefined || value === '' || value === -1
      ? '待确认' : VENUE_LAYOUTS[value]?.label || '无效方向',
    read: (_page, data) => Number.isInteger(data.layoutIndex) && VENUE_LAYOUTS[data.layoutIndex]
      ? data.layoutIndex : undefined,
  },
}

const VENUE_REPORT_CONTRACT = {
  id: 'venue-report',
  fields: VENUE_REPORT_FIELDS,
  requiredFields: Object.keys(VENUE_REPORT_FIELDS),
}

const venueOperationMethods = createOperationMethods(VENUE_REPORT_CONTRACT)
const VENUE_LAYOUTS = [
  { value: 'short', label: '短边前置主扩（推荐）' },
  { value: 'long', label: '长边前置主扩' },
]

function structuredVenueState(page, values) {
  const gradeIndex = Number(values.gradeIndex)
  const layoutIndex = Number(values.layoutIndex)
  if (!Number.isInteger(gradeIndex) || !STANDARD_CLASSES[0].grades[gradeIndex]
    || !Number.isInteger(layoutIndex) || !VENUE_LAYOUTS[layoutIndex]) return null
  return {
    sceneModes: SCENE_MODES,
    sceneModeIndex: 0,
    standardClasses: STANDARD_CLASSES,
    standardClassIndex: 0,
    gradeIndex,
    layouts: VENUE_LAYOUTS,
    layoutIndex,
    lengthText: values.lengthText,
    widthText: values.widthText,
    heightText: values.heightText,
    firstListeningDistanceText: values.firstListeningDistanceText,
    lastListeningDistanceText: values.lastListeningDistanceText,
    listeningWidthText: values.listeningWidthText,
    showVenuePlan: page.data.showVenuePlan,
  }
}

function structuredActive(page) {
  return Boolean(page.getOperationSnapshot?.())
}

function compactVenueReviewWarning(warning) {
  const angleMatch = String(warning).match(/约\s*([\d.]+)°/)
  const uncoveredMatch = String(warning).match(/仍有\s*(\d+)\s*个坐席未覆盖/)
  const overlapMatch = String(warning).match(/(\d+)\s*个坐席同时落入三个及以上服务区/)
  if (/没有同时满足|暂无.*候选|无自动候选/.test(String(warning)) && /主扩候选/.test(String(warning))) {
    return '复核：音箱库暂无满足覆盖和声压要求的主扩候选。'
  }
  if (angleMatch && /超过当前\s*120°/.test(String(warning))) return `复核：覆盖角约 ${angleMatch[1]}°，超过 120°。`
  if (uncoveredMatch) return `复核：覆盖缺口 ${uncoveredMatch[1]} 席。`
  if (overlapMatch) return `复核：${overlapMatch[1]} 席存在过度交叠。`
  return `复核：${warning}`
}

function roundUpToTenth(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Number((Math.ceil(number * 10) / 10).toFixed(1))
}

function formatMeters(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : '资料不足'
}

function getCoverageEnvelopeText(result) {
  const horizontal = roundUpToTenth(
    result.minimumHorizontalCoverageRaw
      ?? result.minimumHorizontalCoverageDeg
      ?? result.minimumHorizontalCoverage
      ?? result.recommendedHorizontalCoverage,
  )
  const vertical = roundUpToTenth(
    result.minimumVerticalCoverageRaw
      ?? result.minimumVerticalCoverageDeg
      ?? result.minimumVerticalCoverage
      ?? result.recommendedVerticalCoverage,
  )
  if (horizontal === null || vertical === null) return '资料不足，需复核几何包络'
  return `几何包络至少 ${horizontal.toFixed(1)}°H × ${vertical.toFixed(1)}°V`
}

function getLayoutComparisonSummary(result) {
  const selection = result?.layoutSelection
  if (typeof selection?.summary === 'string' && selection.summary.trim()) return selection.summary
  if (Number.isFinite(Number(selection?.candidateCount))) {
    return `候选布局 ${selection.candidateCount} 套，按标称几何比较`
  }
  return '资料不足，需复核布局比较'
}

function formatMainYaw(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '资料不足，需复核水平偏转'
  if (Math.abs(number) < 0.05) return '正向后排'
  return number > 0
    ? `向右偏转${Math.abs(number).toFixed(1)}°`
    : `向左偏转${Math.abs(number).toFixed(1)}°`
}

function getMainPositionLines(result) {
  const positions = result?.mainSpeakerPositions
  if (!Array.isArray(positions) || positions.length === 0) return []
  return positions.slice(0, 2).map((position, index) => {
    const width = Number(position.widthMeters)
    const depth = Number(position.depthMeters)
    if (!Number.isFinite(width) || !Number.isFinite(depth)) return `M${index + 1}：位置见布局图`
    const yaw = position.aimYawDeg ?? position.yawDeg
    return `M${index + 1} 距左 ${formatMeters(width)} m、距前 ${formatMeters(depth)} m、${formatMainYaw(yaw)}`
  })
}

function enrichVenueResult(result) {
  return {
    ...result,
    layoutComparisonSummary: getLayoutComparisonSummary(result),
    layoutPositionLines: result.kind === 'report' ? getMainPositionLines(result) : [],
    coverageEnvelopeText: getCoverageEnvelopeText(result),
    planDisplayIntro: result.kind === 'discussion'
      ? '覆盖图用于坐席分区的几何参考；标称角范围不代表真实频段指向性或均匀度。'
      : '色阶仅表示等向点源的距离衰减与能量相加；标称角范围是理想几何包络，不代表真实覆盖。',
  }
}

function getFirstRecommendationPackage(result) {
  return result?.speakerRecommendation?.packages?.[0] || null
}

function getFillPlacementGroups(result) {
  return result?.speakerRecommendation?.fillPlacementGroups || []
}

function getFiniteRawNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const number = Number(value.trim())
  return Number.isFinite(number) ? number : null
}

function formatRawMeters(value) {
  const number = getFiniteRawNumber(value)
  return number === null ? '资料不足' : number.toFixed(2)
}

function classifyHandoffDifference(value) {
  const number = getFiniteRawNumber(value)
  if (number === null) return '先复核指向'
  if (Math.abs(number) < 0.05) return '传播差约0.0ms'
  return number > 0 ? `补声先到 ${number.toFixed(1)} ms` : `补声后到 ${Math.abs(number).toFixed(1)} ms`
}

function formatHandoffPoint(point = {}) {
  const widthText = getFiniteRawNumber(point.widthMetersRaw) !== null
    ? `横向距左 ${formatRawMeters(point.widthMetersRaw)} m`
    : '横向位置资料不足'
  const sourceText = point.upstreamSourceLabel && point.fillSourceLabel
    ? `${point.upstreamSourceLabel} → ${point.fillSourceLabel}`
    : '暂不可比较'
  const difference = getFiniteRawNumber(point.arrivalDifferenceMsRaw)
  const hasUsableDifference = point.available === true && difference !== null
  return {
    ...point,
    positionText: widthText,
    sourceText,
    statusText: hasUsableDifference
      ? classifyHandoffDifference(difference)
      : '先复核指向',
  }
}

function getHandoffGroupDirectionText(group = {}) {
  const points = Array.isArray(group.points) ? group.points : []
  const valid = points
    .map((point) => getFiniteRawNumber(point.arrivalDifferenceMsRaw))
    .filter((value, index) => points[index]?.available === true && value !== null)
  if (!valid.length) return '有效点：先复核指向'
  const directions = new Set(valid.map((value) => {
    if (Math.abs(value) < 0.05) return '传播差约0.0ms'
    return value > 0 ? '补声较参考前级先到' : '补声较参考前级后到'
  }))
  if (directions.size === 1) {
    const direction = [...directions][0]
    return direction
  }
  return `有效点传播差：${[...directions].join('、')}`
}

function adaptHandoffReview(review) {
  if (!review || review.basis !== 'nominal-geometry' || !Array.isArray(review.groups)) return null
  return {
    ...review,
    speedOfSoundMetersPerSecond: Number(review.speedOfSoundMetersPerSecond) || 343,
    groups: review.groups.map((group) => {
      const points = Array.isArray(group.points) ? group.points.map(formatHandoffPoint) : []
      const commonPointCount = getFiniteRawNumber(group.commonPointCount) !== null
        ? getFiniteRawNumber(group.commonPointCount)
        : points.filter((point) => point.available === true).length
      const totalPointCount = getFiniteRawNumber(group.totalPointCount) !== null
        ? getFiniteRawNumber(group.totalPointCount)
        : 3
      const minimum = getFiniteRawNumber(group.minimumArrivalDifferenceMsRaw)
      const maximum = getFiniteRawNumber(group.maximumArrivalDifferenceMsRaw)
      const formatArrivalText = (value) => {
        if (value === null) return ''
        const text = value.toFixed(1)
        return text === '-0.0' ? '0.0' : text
      }
      const minimumText = formatArrivalText(minimum)
      const maximumText = formatArrivalText(maximum)
      const rangeText = commonPointCount > 0 && minimum !== null && maximum !== null
        ? minimumText === maximumText
          ? `传播差约 ${minimumText} ms`
          : `传播差范围 ${minimumText}～${maximumText} ms`
        : '传播差范围资料不足'
      return {
        ...group,
        points,
        commonPointCount,
        totalPointCount,
        installationDepthText: `补声安装距前 ${formatRawMeters(group.installationDepthMetersRaw)} m`,
        referenceDepthText: `参考排距前 ${formatRawMeters(group.referenceDepthMetersRaw)} m`,
        commonPointText: `共同几何角范围 ${commonPointCount}/${totalPointCount} 点`,
        directionText: getHandoffGroupDirectionText({ ...group, points }),
        rangeText,
      }
    }),
  }
}

function getHandoffReviewFromPlan(plan) {
  return adaptHandoffReview(plan?.handoffReview)
}

function getHandoffGroupReportSummary(group = {}) {
  const points = group.points || []
  const valid = points
    .filter((point) => point.available === true)
    .map((point) => getFiniteRawNumber(point.arrivalDifferenceMsRaw))
    .filter((value) => value !== null)
  const upstreamLabels = [...new Set(points
    .filter((point) => point.available === true && point.upstreamSourceLabel)
    .map((point) => point.upstreamSourceLabel))]
  const fillLabels = [...new Set(points
    .filter((point) => point.available === true && point.fillSourceLabel)
    .map((point) => point.fillSourceLabel))]
  const sourceSummary = upstreamLabels.length && fillLabels.length
    ? `${upstreamLabels.join('/')}→${fillLabels.join('/')}`
    : ''
  const directions = new Set(valid.map((value) => {
    if (Math.abs(value) < 0.05) return 'near'
    return value > 0 ? 'early' : 'late'
  }))
  let propagationText = '先复核指向'
  if (directions.size === 1 && directions.has('near')) propagationText = '传播差约0.0ms'
  else if (directions.size === 1 && (directions.has('early') || directions.has('late'))) {
    const absValues = valid.map((value) => Math.abs(value)).filter((value) => value >= 0.05)
    const lower = Math.min(...absValues)
    const upper = Math.max(...absValues)
    const lowerText = lower.toFixed(1)
    const upperText = upper.toFixed(1)
    const range = lowerText === upperText
      ? lowerText
      : `${lowerText}～${upperText}`
    propagationText = `${directions.has('early') ? '补声先到' : '补声后到'} ${range} ms`
  } else if (directions.size > 1) propagationText = '先后随位置变化'
  return `参考排${formatRawMeters(group.referenceDepthMetersRaw)}m；共同范围${group.commonPointCount ?? 0}/${group.totalPointCount ?? 3}点；${sourceSummary ? `${sourceSummary} ` : ''}${propagationText}`
}

function formatHandoffGroupDetail(group = {}, placementGroup = {}) {
  const points = group.points || []
  const pointSummary = points.map((point) => {
    const displayPoint = point.positionText ? point : formatHandoffPoint(point)
    return `${displayPoint.label || '点'}（${displayPoint.positionText || '横向位置资料不足'}）· ${displayPoint.sourceText} · ${displayPoint.statusText}`
  }).join('；')
  const serviceAreaText = placementGroup.serviceAreaLabel ? ` · ${placementGroup.serviceAreaLabel}` : ''
  return `${group.label || `补声组 ${group.index ?? ''}`}：${group.installationDepthText || `补声安装距前 ${formatRawMeters(group.installationDepthMetersRaw)} m`}，${group.referenceDepthText || `参考排距前 ${formatRawMeters(group.referenceDepthMetersRaw)} m`}${serviceAreaText}，${group.commonPointText || `共同几何角范围 ${group.commonPointCount ?? 0}/${group.totalPointCount ?? 3} 点`}；${group.directionText || '有效点：先复核指向'}。${pointSummary}`
}

function getHandoffReviewNote(review) {
  if (!review?.groups?.length) return ''
  return `补声传播复核按 ${review.speedOfSoundMetersPerSecond || 343} m/s 的几何传播差；电子延时、电平、相位待现场测量。只计算最近合格参考源，不代表实际主导声源或等电平位置。`
}

function getHandoffReviewReportNotes(review) {
  if (!review?.groups?.length) {
    return ['距离模型：等向点源距离衰减与能量相加；不含真实指向性、反射、延时、相位或干涉。']
  }
  return [
    '距离模型：等向点源距离衰减与能量相加；不含真实指向性、反射或干涉。',
    '传播复核：按343m/s几何差；电子延时、电平、相位现场测量；最近合格源仅作参考。',
  ]
}

function isPagNagIncomplete(state = {}, result = state.result) {
  return result?.kind === 'discussion'
    && state.discussionPagNagEnabled === true
    && !result.pagNagReview
}

Page({
  data: {
    sceneModes: SCENE_MODES,
    sceneModeIndex: 0,
    standardClasses: STANDARD_CLASSES,
    standardClassIndex: 0,
    gradeIndex: 0,
    layouts: VENUE_LAYOUTS,
    layoutIndex: 0,
    lengthText: '12',
    widthText: '8',
    heightText: '4',
    firstListeningDistanceText: '3',
    lastListeningDistanceText: '11',
    listeningWidthText: '7',
    discussionTableShapes: DISCUSSION_TABLE_SHAPES,
    discussionTableShapeIndex: 0,
    discussionInstallationConditions: DISCUSSION_INSTALLATION_CONDITIONS,
    discussionInstallationConditionIndex: 0,
    participantCountText: '12',
    tableDiameterText: '3',
    tableLengthText: '4.8',
    tableWidthText: '1.8',
    discussionPagNagEnabled: false,
    discussionPagNagSpeakerMode: 'single',
    discussionPagNagDsText: '',
    discussionPagNagD0Text: '',
    discussionPagNagDnText: '',
    discussionPagNagD1Text: '',
    discussionPagNagD2Text: '',
    discussionPagNagNomText: '',
    pagNagGuideKey: 'ds',
    discussionPagNagError: '',
    discussionPagNagDisplay: null,
    pagNagOutputBlocked: false,
    planCanvasWidth: DEFAULT_PLAN_CANVAS_WIDTH,
    planCanvasHeight: DEFAULT_PLAN_CANVAS_HEIGHT,
    planImagePath: '',
    result: null,
    currentFavorite: false,
    planStats: null,
    planElevation: null,
    reportHeatmapGradient: REPORT_HEATMAP_GRADIENT,
    reportHeatmapTicks: REPORT_HEATMAP_TICKS,
    inputError: '',
    operationActive: false,
    operationSnapshot: null,
    showVenueDetails: false,
    showVenuePlan: false,
    handoffReview: null,
    ...createResultReportData(),
  },

  onLoad() {
    this._pageVisible = false
    const preferences = readPreferences(PREFERENCE_KEY)
    const standardClassIndex = findValueIndex(
      this.data.standardClasses,
      preferences.standardClassKey,
      (item) => item.key,
    )
    const standardClass = this.data.standardClasses[standardClassIndex]
    const pagNagPreferencesEnabled = preferences.sceneMode === 'discussion'
      && preferences.discussionPagNagEnabled === true

    this.calculate({
      sceneModeIndex: findValueIndex(this.data.sceneModes, preferences.sceneMode, (item) => item.value),
      standardClassIndex,
      gradeIndex: findValueIndex(standardClass.grades, preferences.gradeKey, (item) => item.key),
      layoutIndex: findValueIndex(this.data.layouts, preferences.layout, (item) => item.value),
      lengthText: preferences.lengthText || '12',
      widthText: preferences.widthText || '8',
      heightText: preferences.heightText || '4',
      firstListeningDistanceText: preferences.firstListeningDistanceText || '3',
      lastListeningDistanceText: preferences.lastListeningDistanceText || '11',
      listeningWidthText: preferences.listeningWidthText || '7',
      discussionTableShapeIndex: findValueIndex(
        this.data.discussionTableShapes,
        preferences.discussionTableShape,
        (item) => item.value,
      ),
      discussionInstallationConditionIndex: findValueIndex(
        this.data.discussionInstallationConditions,
        preferences.discussionInstallationCondition,
        (item) => item.value,
      ),
      participantCountText: preferences.participantCountText || '12',
      tableDiameterText: preferences.tableDiameterText || '3',
      tableLengthText: preferences.tableLengthText || '4.8',
      tableWidthText: preferences.tableWidthText || '1.8',
      discussionPagNagEnabled: pagNagPreferencesEnabled,
      discussionPagNagSpeakerMode: pagNagPreferencesEnabled
        ? (Object.prototype.hasOwnProperty.call(preferences, 'discussionPagNagSpeakerMode')
          ? preferences.discussionPagNagSpeakerMode : 'single') : 'single',
      discussionPagNagDsText: pagNagPreferencesEnabled
        ? (preferences.discussionPagNagDsText || '') : '',
      discussionPagNagD0Text: pagNagPreferencesEnabled
        ? (preferences.discussionPagNagD0Text || '') : '',
      discussionPagNagDnText: pagNagPreferencesEnabled
        ? (preferences.discussionPagNagDnText || '') : '',
      discussionPagNagD1Text: pagNagPreferencesEnabled
        ? (preferences.discussionPagNagD1Text || '') : '',
      discussionPagNagD2Text: pagNagPreferencesEnabled
        ? (preferences.discussionPagNagD2Text || '') : '',
      discussionPagNagNomText: pagNagPreferencesEnabled
        ? (preferences.discussionPagNagNomText || '') : '',
    })
  },

  onReady() {
    this.isVenuePlanReady = true
    if (this.data.showVenuePlan) this.measureVenuePlanCanvas()
  },

  onShow() {
    this._pageVisible = true
    if (this.data.result) syncPageFavorite(this)
    if (this.data.showVenuePlan) this.measureVenuePlanCanvas()
  },

  onHide() {
    this._pageVisible = false
    this.cancelVenuePlanWork()
    cancelResultReportGeneration(this)
    this.flushCalculate()
    printPerformanceSummary('会议室/')
  },

  onUnload() {
    this._pageVisible = false
    this.cancelVenuePlanWork()
    cancelResultReportGeneration(this)
    if (this.venueCalculateTimer) {
      clearTimeout(this.venueCalculateTimer)
      this.venueCalculateTimer = null
    }
    invalidateOperation(this, 'unload')
  },

  onOperationStateChange(snapshot) {
    const wasReady = Boolean(this.data.operationSnapshot?.ready)
    const sameOperation = this.data.operationSnapshot?.id === snapshot?.id
    const patch = { operationActive: Boolean(snapshot?.active), operationSnapshot: snapshot }
    if (snapshot) {
      const uiFields = Object.keys(VENUE_REPORT_FIELDS)
      if (!this._venueManualUiSnapshot) {
        this._venueManualUiSnapshot = Object.fromEntries(['sceneModeIndex', ...uiFields]
          .map((key) => [key, this.data[key]]))
      }
      patch.sceneModeIndex = 0
      for (const field of snapshot.fields) {
        patch[field.key] = field.value === undefined
          ? (field.key === 'gradeIndex' || field.key === 'layoutIndex' ? -1 : '')
          : field.value
      }
    } else if (this._venueManualUiSnapshot) {
      Object.assign(patch, this._venueManualUiSnapshot)
      this._venueManualUiSnapshot = null
    }
    this.setData(patch)
    if (sameOperation && !wasReady && snapshot?.ready) this.calculate()
  },

  onOperationInvalidate(reason) {
    this.cancelVenuePlanWork()
    this.invalidateVenuePlan()
    cancelResultReportGeneration(this)
    this.venueCoreCalculationCache = null
    this.venueCoreActiveKey = ''
    this.setData({
      result: null,
      currentFavorite: false,
      planStats: null,
      planElevation: null,
      planImagePath: '',
      handoffReview: null,
      inputError: reason === 'unsupported-scene' ? '报告型结构化操作不支持围桌讨论模式，请结束本次操作后再切换。' : '',
      ...resetStaleResultReport(this, null),
    })
  },

  getOutputState() {
    const snapshot = this.getOperationSnapshot()
    if (!snapshot) return this.data
    if (!snapshot.active || !snapshot.ready) return null
    const values = Object.fromEntries(snapshot.fields.map((field) => [field.key, field.value]))
    return structuredVenueState(this, values)
  },

  endOperation() {
    this.endStructuredOperation()
    this.calculate()
  },

  hasCurrentOperationResult(result = this.data.result) {
    const snapshot = this.getOperationSnapshot()
    const guard = snapshot && result ? captureOperationResult(this, result) : null
    return !snapshot || Boolean(snapshot.active && snapshot.ready && guard && isOperationResultCurrent(this, guard))
  },

  setSelectionAndCalculate(field, index) {
    if (!Number.isInteger(index) || this.data[field] === index) return
    vibrate('light')
    this.calculate({ [field]: index })
  },

  onGradeTap(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (structuredActive(this)) {
      const grade = STANDARD_CLASSES[0].grades[index]
      if (grade) {
        this.setData({ gradeIndex: index })
        this.setOperationCandidate('gradeIndex', index, 'index')
      }
      return
    }
    this.setSelectionAndCalculate('gradeIndex', index)
  },

  onSceneModeTap(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || this.data.sceneModeIndex === index) return
    if (structuredActive(this)) {
      invalidateOperation(this, 'unsupported-scene')
      return
    }
    this.clearVenuePlanCanvas()
    this.setSelectionAndCalculate('sceneModeIndex', index)
  },

  onDiscussionShapeTap(event) {
    if (structuredActive(this)) {
      invalidateOperation(this, 'unsupported-scene')
      return
    }
    this.setSelectionAndCalculate(
      'discussionTableShapeIndex',
      Number(event.currentTarget.dataset.index),
    )
  },

  onDiscussionInstallationConditionTap(event) {
    if (structuredActive(this)) {
      invalidateOperation(this, 'unsupported-scene')
      return
    }
    this.setSelectionAndCalculate(
      'discussionInstallationConditionIndex',
      Number(event.currentTarget.dataset.index),
    )
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    if (structuredActive(this)) {
      const descriptor = VENUE_REPORT_FIELDS[field]
      if (!descriptor) {
        invalidateOperation(this, 'unsupported-input')
        return
      }
      this.setOperationCandidate(field, event.detail.value, descriptor.unit)
      this.setData({ [field]: event.detail.value })
      return
    }
    this.setData({ [field]: event.detail.value }, () => this.queueCalculate())
  },

  onDiscussionPagNagToggle(event) {
    if (structuredActive(this)) {
      invalidateOperation(this, 'unsupported-scene')
      return
    }
    vibrate('light')
    this.calculate({ discussionPagNagEnabled: event.detail.value === true })
  },

  onDiscussionPagNagSpeakerModeChange(event) {
    if (structuredActive(this)) {
      invalidateOperation(this, 'unsupported-scene')
      return
    }
    const mode = event.currentTarget?.dataset?.mode
    if (!['single', 'multiple'].includes(mode)
      || mode === this.data.discussionPagNagSpeakerMode) return
    if (this.venueCalculateTimer) {
      clearTimeout(this.venueCalculateTimer)
      this.venueCalculateTimer = null
    }
    vibrate('light')
    this.calculate({
      discussionPagNagSpeakerMode: mode,
      discussionPagNagD1Text: '',
      discussionPagNagD2Text: '',
      pagNagGuideKey: 'd1',
    })
    wx.showToast({ title: 'D1、D2 已清空，请重新测量', icon: 'none' })
  },

  onPagNagGuideSelect(event) {
    if (structuredActive(this)) {
      invalidateOperation(this, 'unsupported-scene')
      return
    }
    const key = String(event.currentTarget.dataset.key || '')
    if (!['ds', 'd0', 'dn', 'd1', 'd2', 'nom'].includes(key)
      || this.data.pagNagGuideKey === key) return
    this.setData({ pagNagGuideKey: key })
  },

  onPickerChange(event) {
    const field = event.currentTarget.dataset.field
    if (structuredActive(this)) {
      if (field !== 'layoutIndex') {
        invalidateOperation(this, 'unsupported-scene')
        return
      }
      const index = Number(event.detail.value)
      const layout = VENUE_LAYOUTS[index]
      if (layout) {
        this.setData({ layoutIndex: index })
        this.setOperationCandidate('layoutIndex', index, 'index')
      }
      return
    }
    this.setSelectionAndCalculate(field, Number(event.detail.value))
  },

  queueCalculate() {
    if (this.venueCalculateTimer) clearTimeout(this.venueCalculateTimer)
    this.venueCalculateTimer = setTimeout(() => {
      this.venueCalculateTimer = null
      this.calculate()
    }, 180)
  },

  flushCalculate() {
    if (!this.venueCalculateTimer) return
    clearTimeout(this.venueCalculateTimer)
    this.venueCalculateTimer = null
    this.calculate()
  },

  calculate(changes = {}) {
    if (this.venueCalculateTimer) {
      clearTimeout(this.venueCalculateTimer)
      this.venueCalculateTimer = null
    }
    const operation = prepareOperation(this)
    if (operation.blocked) return null
    if (operation.structured && this.hasCurrentOperationResult()) return this.data.result
    if (!isOperationResultCurrent(this, operation.guard)) return null
    const state = operation.structured
      ? structuredVenueState(this, operation.state)
      : { ...this.data, ...changes }
    if (!state) {
      this.setData({ result: null, inputError: '结构化报告输入的等级或布置方向无效。' })
      return null
    }
    const standardClass = state.standardClasses[state.standardClassIndex]
    const grade = standardClass.grades[state.gradeIndex]
    const sceneMode = state.sceneModes[state.sceneModeIndex].value
    const finishCalculation = startMeasurement('会议室/核心计算', { sceneMode })
    const sharedInput = {
      lengthMeters: state.lengthText,
      widthMeters: state.widthText,
      heightMeters: state.heightText,
      standardClassKey: standardClass.key,
      gradeKey: grade.key,
    }
    const coreInput = sceneMode === 'discussion'
      ? {
        ...sharedInput,
        tableShape: state.discussionTableShapes[state.discussionTableShapeIndex].value,
        audioMode: 'voiceLift',
        installationCondition: state.discussionInstallationConditions[
          state.discussionInstallationConditionIndex
        ].value,
        participantCount: state.participantCountText,
        tableDiameterMeters: state.tableDiameterText,
        tableLengthMeters: state.tableLengthText,
        tableWidthMeters: state.tableWidthText,
      }
      : {
        ...sharedInput,
        firstListeningDistanceMeters: state.firstListeningDistanceText,
        lastListeningDistanceMeters: state.lastListeningDistanceText,
        listeningWidthMeters: state.listeningWidthText,
        layout: state.layouts[state.layoutIndex].value,
      }
    const coreKey = JSON.stringify({ sceneMode, input: coreInput })
    const coreCacheHit = !operation.structured && this.venueCoreCalculationCache?.key === coreKey
    const calculatedResult = coreCacheHit
      ? this.venueCoreCalculationCache.result
      : sceneMode === 'discussion'
        ? calculateDiscussionEstimate(coreInput)
        : calculateVenueEstimate(coreInput)

    if (!isOperationResultCurrent(this, operation.guard)) {
      finishCalculation({ success: false })
      return null
    }

    if (calculatedResult.error) {
      finishCalculation({ success: false })
      this.venueCoreActiveKey = ''
      this.invalidateVenuePlan()
      this.setData({
        ...changes,
        result: null,
        currentFavorite: false,
        planStats: null,
        planElevation: null,
        planImagePath: '',
        handoffReview: null,
        inputError: calculatedResult.error,
        discussionPagNagError: '',
        discussionPagNagDisplay: null,
        pagNagOutputBlocked: sceneMode === 'discussion' && state.discussionPagNagEnabled === true,
        ...resetStaleResultReport(this, null),
      })
      return
    }

    if (!operation.structured && !coreCacheHit) this.venueCoreCalculationCache = { key: coreKey, result: calculatedResult }
    const coreUnchanged = coreCacheHit
      && this.venueCoreActiveKey === coreKey
      && Boolean(this.data.result)

    const pagNagEnabled = sceneMode === 'discussion' && state.discussionPagNagEnabled === true
    let pagNagReview = null
    let discussionPagNagError = ''
    if (pagNagEnabled) {
      const review = calculatePagNagReview({
        ds: state.discussionPagNagDsText,
        d0: state.discussionPagNagD0Text,
        dn: state.discussionPagNagDnText,
        d1: state.discussionPagNagD1Text,
        d2: state.discussionPagNagD2Text,
        nom: state.discussionPagNagNomText,
        speakerMode: state.discussionPagNagSpeakerMode,
      })
      if (review.error) discussionPagNagError = review.error
      else pagNagReview = review
    }
    const result = enrichVenueResult(pagNagReview ? { ...calculatedResult, pagNagReview } : calculatedResult)

    const resultGuard = operation.structured ? operation.commit(result) : null
    if (operation.structured && (!resultGuard || !isOperationResultCurrent(this, resultGuard))) {
      finishCalculation({ success: false })
      return null
    }

    finishCalculation({ success: true, kind: result.kind, cached: coreCacheHit })
    let plan = null
    if (coreUnchanged) {
      if (this.pendingVenuePlan && this.venuePlanResult === this.data.result) {
        plan = this.pendingVenuePlan
      }
    } else {
      this.invalidateVenuePlan()
      if (state.showVenuePlan && this._pageVisible) {
        plan = this.buildVenuePlanForResult(result)
        this.pendingVenuePlan = plan
      }
    }
    this.venueCoreActiveKey = coreKey
    if (!operation.structured && (!pagNagEnabled || pagNagReview)) writePreferences(PREFERENCE_KEY, this.getPreferences(state))
    if (pagNagEnabled && !pagNagReview) cancelResultReportGeneration(this)
    const nextState = { ...state, result }
    const hasResultReportSignature = Boolean(
      this.resultReportPendingSignature || this.resultReportSignature,
    )
    const resultReportChanges = hasResultReportSignature
      ? resetStaleResultReport(this, this.buildResultReportRecord(nextState, result))
      : {}
    const hasCurrentPagNagReview = Boolean(this.data.result?.pagNagReview)
    const changesToCommit = { ...changes }
    if (coreUnchanged && pagNagReview) {
      changesToCommit['result.pagNagReview'] = pagNagReview
    } else if (!coreUnchanged || hasCurrentPagNagReview) {
      changesToCommit.result = result
    }
    if (!coreUnchanged) Object.assign(changesToCommit, {
      planStats: plan?.statistics || null,
      planElevation: plan?.elevation || null,
      planImagePath: '',
      handoffReview: null,
    })
    Object.assign(changesToCommit, {
      inputError: '',
      discussionPagNagError,
      discussionPagNagDisplay: pagNagReview ? {
        pagText: formatDb(pagNagReview.pagDb),
        nagText: formatDb(pagNagReview.nagDb),
        marginText: formatMargin(pagNagReview.marginDb),
        reviewText: pagNagReview.basis === 'omnidirectional-multiple-speakers'
          ? '多音箱最近声程估算，声级/指向性差异及路由须现场复核。'
          : '单链路结果需现场复核。',
      } : null,
      pagNagOutputBlocked: pagNagEnabled && !pagNagReview,
      currentFavorite: pagNagEnabled && !pagNagReview ? false : this.data.currentFavorite,
      ...(pagNagEnabled && !pagNagReview ? {
        resultReportImagePath: '',
        resultReportPreviewVisible: false,
        isGeneratingResultReport: false,
      } : {}),
      ...resultReportChanges,
    })
    const committedResult = coreUnchanged ? this.data.result : result
    this.setData(changesToCommit, () => {
      if (this.data.result !== committedResult
        || (operation.structured && !isOperationResultCurrent(this, resultGuard))) return
      if (this._pageVisible) syncPageFavorite(this)
      if (!coreUnchanged && this.data.showVenuePlan && this._pageVisible) this.measureVenuePlanCanvas()
      if (this.data.showVenueDetails && result.kind === 'report' && result.fillCount) {
        this.setData({ handoffReview: this.getHandoffReviewForResult(result) })
      }
    })
    if (plan) this.venuePlanResult = this.data.result
    else if (coreUnchanged && this.pendingVenuePlan) this.venuePlanResult = this.data.result
  },

  cancelVenuePlanWork() {
    this.venuePlanRevision = (this.venuePlanRevision || 0) + 1;
    ['venuePlanTimer', 'venuePlanMeasureTimer', 'venuePlanSnapshotTimer'].forEach((key) => {
      if (!this[key]) return
      clearTimeout(this[key])
      this[key] = null
    })
  },

  invalidateVenuePlan() {
    this.cancelVenuePlanWork()
    this.pendingVenuePlan = null
    this.venuePlanResult = null
    this.venueHandoffReviewCache = new WeakMap()
    this.isVenuePlanMeasured = false
  },

  buildVenuePlanForResult(result) {
    const finishPlanBuild = startMeasurement('会议室/方案建模', { kind: result.kind })
    const plan = result.kind === 'discussion'
      ? buildDiscussionPlan(result)
      : buildVenuePlan(result)
    finishPlanBuild({
      sources: plan.sources.length,
      cells: plan.cells?.length || 0,
      seats: plan.seats?.length || 0,
    })
    return plan
  },

  ensureVenuePlan({ syncView = true } = {}) {
    const { result } = this.data
    if (!result) return null

    if (!this.pendingVenuePlan || this.venuePlanResult !== result) {
      this.pendingVenuePlan = this.buildVenuePlanForResult(result)
      this.venuePlanResult = result
    }
    const plan = this.pendingVenuePlan
    if (syncView && (this.data.planStats !== plan.statistics
      || this.data.planElevation !== (plan.elevation || null))) {
      this.setData({
        planStats: plan.statistics,
        planElevation: plan.elevation || null,
      })
    }
    return plan
  },

  getHandoffReviewForResult(result = this.data.result) {
    if (!result || result.kind !== 'report' || !result.fillCount) return null
    if (!this.venueHandoffReviewCache) this.venueHandoffReviewCache = new WeakMap()
    if (this.pendingVenuePlan && this.venuePlanResult === result) {
      const planReview = getHandoffReviewFromPlan(this.pendingVenuePlan)
      if (planReview) {
        this.venueHandoffReviewCache.set(result, planReview)
        return planReview
      }
    }
    if (this.venueHandoffReviewCache.has(result)) return this.venueHandoffReviewCache.get(result)
    if (typeof buildVenueHandoffReviewForResult !== 'function') return null
    const review = adaptHandoffReview(buildVenueHandoffReviewForResult(result))
    this.venueHandoffReviewCache.set(result, review)
    return review
  },

  queueVenuePlan(plan = this.ensureVenuePlan()) {
    if (!plan || this.pendingVenuePlan !== plan || this.venuePlanResult !== this.data.result) return
    if (!this.data.showVenuePlan || !this._pageVisible
      || !this.isVenuePlanReady || !this.isVenuePlanMeasured
      || this.data.planImagePath) return

    if (this.venuePlanTimer) {
      clearTimeout(this.venuePlanTimer)
    }

    const revision = this.venuePlanRevision || 0
    this.venuePlanTimer = setTimeout(() => {
      this.venuePlanTimer = null
      if (this.pendingVenuePlan === plan
        && this.venuePlanRevision === revision
        && this._pageVisible) this.drawVenuePlan(plan)
    }, 0)
  },

  getVenuePlanCanvasId(plan = this.pendingVenuePlan) {
    return plan?.kind === 'discussion' ? 'venueDiscussionCanvas' : 'venueReportCanvas'
  },

  measureVenuePlanCanvas(attempt = 0) {
    if (!this.data.showVenuePlan || !this._pageVisible
      || !this.isVenuePlanReady || !this.data.result || this.data.planImagePath) return
    const plan = this.ensureVenuePlan()
    if (!plan) return
    const revision = this.venuePlanRevision

    wx.nextTick(() => {
      if (!this._pageVisible || this.pendingVenuePlan !== plan
        || this.venuePlanRevision !== revision) return
      const canvasId = this.getVenuePlanCanvasId(plan)
      wx.createSelectorQuery()
        .select(`#${canvasId}`)
        .boundingClientRect((rect) => {
          if (!this._pageVisible || this.pendingVenuePlan !== plan
            || this.venuePlanRevision !== revision) return
          if (!rect || !rect.width) {
            if (attempt < 4 && this.data.showVenuePlan && this._pageVisible) {
              if (this.venuePlanMeasureTimer) clearTimeout(this.venuePlanMeasureTimer)
              this.venuePlanMeasureTimer = setTimeout(() => {
                this.venuePlanMeasureTimer = null
                if (this._pageVisible && this.pendingVenuePlan === plan
                  && this.venuePlanRevision === revision) {
                  this.measureVenuePlanCanvas(attempt + 1)
                }
              }, 50)
            } else if (this.data.showVenuePlan && this._pageVisible) {
              this.isVenuePlanMeasured = true
              this.queueVenuePlan(plan)
            }
            return
          }

          const planCanvasWidth = Math.round(rect.width)
          const planCanvasHeight = Math.round(getVenuePlanCanvasHeight(plan, planCanvasWidth))
          this.isVenuePlanMeasured = true
          if (planCanvasWidth === this.data.planCanvasWidth
            && planCanvasHeight === this.data.planCanvasHeight) {
            this.queueVenuePlan(plan)
          } else {
            this.setData({ planCanvasWidth, planCanvasHeight }, () => this.queueVenuePlan(plan))
          }
        })
        .exec()
    })
  },

  toggleVenueDetails() {
    vibrate('light')
    const showVenueDetails = !this.data.showVenueDetails
    let handoffReview = null
    if (showVenueDetails) {
      this.clearVenuePlanCanvas()
      this.cancelVenuePlanWork()
      this.isVenuePlanMeasured = false
      if (this.data.result?.kind === 'report' && this.data.result.fillCount) {
        handoffReview = this.getHandoffReviewForResult(this.data.result)
      }
    }
    this.setData({
      showVenueDetails,
      showVenuePlan: false,
      handoffReview,
    })
  },

  toggleVenuePlan() {
    vibrate('light')
    const showVenuePlan = !this.data.showVenuePlan
    let plan = null
    if (!showVenuePlan) {
      this.clearVenuePlanCanvas()
      this.cancelVenuePlanWork()
      this.isVenuePlanMeasured = false
    } else {
      plan = this.ensureVenuePlan({ syncView: false })
    }
    this.setData({
      showVenueDetails: false,
      showVenuePlan,
      ...(plan ? {
        planStats: plan.statistics,
        planElevation: plan.elevation || null,
      } : {}),
    }, () => {
      if (showVenuePlan && !this.data.planImagePath) this.measureVenuePlanCanvas()
    })
  },

  drawVenuePlan(plan) {
    if (!plan) return

    const revision = this.venuePlanRevision
    const finishDrawing = startMeasurement('会议室/Canvas绘制', { kind: plan.kind })
    const context = wx.createCanvasContext(this.getVenuePlanCanvasId(plan), this)
    renderVenuePlan(context, plan, this.data.planCanvasWidth, this.data.planCanvasHeight)
    this.commitVenuePlanCanvas(context, plan, revision, finishDrawing, {
      sources: plan.sources.length,
      ...(plan.kind === 'discussion'
        ? { seats: plan.seats.length }
        : { cells: plan.cells.length }),
    })
  },
  clearVenuePlanCanvas() {
    if (!this.data.showVenuePlan || this.data.planImagePath
      || typeof wx.createCanvasContext !== 'function') return
    const context = wx.createCanvasContext(this.getVenuePlanCanvasId(), this)
    context.clearRect(0, 0, this.data.planCanvasWidth, this.data.planCanvasHeight)
    context.draw()
  },

  commitVenuePlanCanvas(context, plan, revision, finishDrawing, measurement) {
    const canvasId = this.getVenuePlanCanvasId(plan)
    context.draw(false, () => {
      finishDrawing(measurement)
      if (!this.data.showVenuePlan || !this._pageVisible
        || this.pendingVenuePlan !== plan || this.venuePlanRevision !== revision) return

      wx.canvasToTempFilePath({
        canvasId,
        width: this.data.planCanvasWidth,
        height: this.data.planCanvasHeight,
        destWidth: this.data.planCanvasWidth * 2,
        destHeight: this.data.planCanvasHeight * 2,
        success: ({ tempFilePath }) => {
          if (!tempFilePath || !this.data.showVenuePlan || !this._pageVisible
            || this.pendingVenuePlan !== plan || this.venuePlanRevision !== revision) return
          let completed = false
          let snapshotTimer = null
          const revealSnapshot = () => {
            if (completed) return
            if (!this.data.showVenuePlan || !this._pageVisible
              || this.pendingVenuePlan !== plan || this.venuePlanRevision !== revision) return
            completed = true
            if (snapshotTimer && this.venuePlanSnapshotTimer === snapshotTimer) {
              clearTimeout(snapshotTimer)
              this.venuePlanSnapshotTimer = null
            }
            this.setData({ planImagePath: tempFilePath })
          }
          const clearContext = wx.createCanvasContext(canvasId, this)
          clearContext.clearRect(0, 0, this.data.planCanvasWidth, this.data.planCanvasHeight)
          this.venuePlanSnapshotTimer = setTimeout(revealSnapshot, 80)
          snapshotTimer = this.venuePlanSnapshotTimer
          clearContext.draw(false, revealSnapshot)
        },
      }, this)
    })
  },

  getPreferences(state = this.data) {
    const snapshot = this.getOperationSnapshot()
    if (snapshot) {
      state = this.getOutputState()
      if (!state) return null
    }
    const standardClass = state.standardClasses[state.standardClassIndex]
    const sceneMode = state.sceneModes[state.sceneModeIndex].value
    const preferences = {
      sceneMode,
      standardClassKey: standardClass.key,
      gradeKey: standardClass.grades[state.gradeIndex].key,
      layout: state.layouts[state.layoutIndex].value,
      lengthText: state.lengthText,
      widthText: state.widthText,
      heightText: state.heightText,
      firstListeningDistanceText: state.firstListeningDistanceText,
      lastListeningDistanceText: state.lastListeningDistanceText,
      listeningWidthText: state.listeningWidthText,
    }
    if (snapshot) return preferences
    Object.assign(preferences, {
      discussionTableShape: state.discussionTableShapes[state.discussionTableShapeIndex].value,
      discussionInstallationCondition: state.discussionInstallationConditions[
        state.discussionInstallationConditionIndex
      ].value,
      participantCountText: state.participantCountText,
      tableDiameterText: state.tableDiameterText,
      tableLengthText: state.tableLengthText,
      tableWidthText: state.tableWidthText,
    })
    if (sceneMode === 'discussion' && state.discussionPagNagEnabled === true) {
      return {
        ...preferences,
        discussionPagNagEnabled: true,
        discussionPagNagDsText: state.discussionPagNagDsText,
        discussionPagNagD0Text: state.discussionPagNagD0Text,
        discussionPagNagDnText: state.discussionPagNagDnText,
        discussionPagNagD1Text: state.discussionPagNagD1Text,
        discussionPagNagD2Text: state.discussionPagNagD2Text,
        discussionPagNagNomText: state.discussionPagNagNomText,
        ...(state.discussionPagNagSpeakerMode === 'multiple'
          ? { discussionPagNagSpeakerMode: 'multiple' } : {}),
      }
    }
    return preferences
  },

  getResultText(plan = this.pendingVenuePlan) {
    if (arguments.length === 0) {
      this.flushCalculate()
      plan = this.pendingVenuePlan
    }
    const state = this.getOutputState()
    const result = this.data.result
    if (!state || !result || !this.hasCurrentOperationResult(result)) return ''
    if (isPagNagIncomplete(state, result)) return ''
    const currentPlan = this.venuePlanResult === result ? plan : null
    const planStats = currentPlan?.statistics || null
    const planElevation = currentPlan?.elevation || null
    const handoffReview = result.kind === 'report'
      ? (getHandoffReviewFromPlan(currentPlan) || this.getHandoffReviewForResult(result))
      : null

    if (result.kind === 'discussion') {
      const layoutSummary = result.layoutComparisonSummary || getLayoutComparisonSummary(result)
      return [
        '会议室扩声预估｜围桌讨论型',
        '结果性质：前期拓扑与能力预估',
        `场地：${state.lengthText} × ${state.widthText} × ${state.heightText} m`,
        `会议桌：${result.tableSummary} · ${result.participantCount} 人`,
        `使用方式：${result.audioModeLabel}`,
        `顶面条件：${result.installationConditionLabel}`,
        `目标：${result.standardLabel}（最大声压级 ≥ ${result.standardMaxSpl} dB SPL）`,
        ...(result.pagNagReview ? [
          getPagNagDescription(result.pagNagReview),
          ...getPagNagInputLines(result.pagNagReview),
          ...getPagNagResultLines(result.pagNagReview),
        ] : []),
        ...(result.reviewWarnings || []).map((warning) => `复核：${warning}`),
        `建议系统：${result.systemLabel}`,
        `核心听音区：桌面、坐席环及外围约 ${result.listeningAreaBufferMeters} m 活动余量`,
        `安装方式建议：${result.installationRecommendationLabel}`,
        `判断依据：${result.installationRecommendationReason}`,
        `安装前提：${result.installationRecommendationCondition}`,
        `扬声器分区：${result.speakerCount} 只 / ${result.zoneCount} 区`,
        `候选比较：候选集内比较，分区作为布局起点`,
        `音箱条件：${result.recommendedSpeakerType}`,
        `布局比较：${layoutSummary}`,
        '音箱位置与间距：见布局图',
        `几何参考：${result.coverageReferenceText || getCoverageEnvelopeText(result)}`,
        ...(planStats && planElevation ? [
          `垂直覆盖需求：约 ${planElevation.requiredVerticalCoverageDeg}°`,
          ...(planElevation.isWall ? [planElevation.downTiltSummary] : []),
        ] : []),
        `音箱最小中心间距：约 ${result.minimumSpeakerSpacingMeters} m`,
        `单只能力参考：≥ ${result.requiredSplAtOneMeter} dB SPL @ 1m`,
        `路由原则：${result.routingPrinciple}`,
        ...(planStats ? [
          `几何参考坐席范围：${planStats.coveredSeatCount}/${planStats.participantCount} · ${planStats.statusText || '资料不足，需复核'}`,
          `几何交叠参考：${planStats.doubleCoveredSeatCount} 个坐席由两个服务区衔接，最大交叠 ${planStats.maximumCoverageCount} 区`,
        ] : []),
        '资料边界：标称角范围与声学资料待核验；几何参考不等于真实覆盖。',
        ...(result.warnings || []).map((warning) => `${result.pagNagReview ? '布局估算注意' : '注意'}：${warning}`),
      ].join('\n')
    }

    const firstPackage = getFirstRecommendationPackage(result)
    const layoutSummary = result.layoutComparisonSummary || getLayoutComparisonSummary(result)
    const layoutPositionLines = result.layoutPositionLines || getMainPositionLines(result)
    const coverageEnvelopeText = result.coverageEnvelopeText || getCoverageEnvelopeText(result)
    return [
      '会议室扩声预估',
      '结果性质：前期粗略方案',
        `场地：${state.lengthText} × ${state.widthText} × ${state.heightText} m`,
      `主扩方向：${state.layouts[state.layoutIndex].label}`,
      `听音区：宽 ${result.listeningWidth} m，距主扩 ${result.firstListeningDistance}～${result.lastListeningDistance} m`,
      `目标：${result.standardLabel}（最大声压级 ≥ ${result.standardMaxSpl} dB SPL）`,
      ...(result.reviewWarnings || []).map((warning) => `复核：${warning}`),
      `建议数量：主扩 ${result.mainCount} 只${result.fillCount ? ` + 补声 ${result.fillCount} 只` : '，无需补声'}`,
      `单只主扩能力：≥ ${result.requiredSplAtOneMeter} dB SPL @ 1m`,
      coverageEnvelopeText,
      `安装参考：中心高度约 ${result.speakerCenterHeight} m，初始下倾角约 ${result.recommendedAimDownDeg}°`,
      `布局比较：${layoutSummary}`,
      '坐标：面朝后排，横向距左墙，纵向距主扩安装面。',
      ...(layoutPositionLines.length ? layoutPositionLines : ['主扩位置：见布局图']),
      `主扩直达声差预检：${result.directVariationDb} dB`,
      ...(planStats ? [`距离模型最大−最小差：${planStats.variationDb} dB · ${planStats.statusText || '资料不足，需复核'}`] : []),
      ...(firstPackage ? [`候选主扩：${firstPackage.main.model} × ${firstPackage.main.count}`] : []),
      ...(firstPackage?.fill ? [`候选补声：${firstPackage.fill.model} × ${firstPackage.fill.count}`] : []),
      ...getFillPlacementGroups(result).map((group, index) => (
        handoffReview?.groups?.[index]
          ? formatHandoffGroupDetail(handoffReview.groups[index], group)
          : `${group.label}：距主扩安装基准面约 ${group.mainToFillDistanceMeters} m，${group.serviceAreaLabel}`
      )),
      '资料边界：标称角范围与声学资料待核验。',
      `距离模型：等向点源距离衰减与能量相加；不含真实指向性、反射、延时、相位或干涉。${handoffReview ? ` ${getHandoffReviewNote(handoffReview)}` : ''}`,
    ].join('\n')
  },

  getRecordPayload() {
    this.flushCalculate()
    const state = this.getOutputState()
    if (!state || !this.data.result || !this.hasCurrentOperationResult() || isPagNagIncomplete(state, this.data.result)) return null
    const plan = this.ensureVenuePlan({ syncView: false })
    const resultText = this.getResultText(plan)
    if (!resultText) return null

    const { result } = this.data
    if (result.kind === 'discussion') {
      return {
        module: 'venue',
        title: `${state.lengthText} × ${state.widthText} × ${state.heightText} m 围桌会议`,
        summary: `${result.systemLabel} · ${result.speakerCount} 只 / ${result.zoneCount} 区`,
        preferences: this.getPreferences(),
        resultText,
      }
    }
    return {
      module: 'venue',
        title: `${state.lengthText} × ${state.widthText} × ${state.heightText} m 会议室`,
      summary: `${result.standardLabel} · 主扩 ${result.mainCount} 只${result.fillCount ? ` + 补声 ${result.fillCount} 只` : ''}`,
      preferences: this.getPreferences(),
      resultText,
    }
  },

  buildResultReportRecord(state, result) {
    if (arguments.length === 0) {
      this.flushCalculate()
      state = this.data
      result = state.result
    } else {
      state = state || this.data
      if (arguments.length < 2) result = state.result
    }
    if (this.getOperationSnapshot()) {
      state = this.getOutputState()
      if (!state) return null
    }
    if (!result || !this.hasCurrentOperationResult(result)) return null
    if (isPagNagIncomplete(state, result)) return null
    const dimensions = `${state.lengthText} × ${state.widthText} × ${state.heightText} m`
    let title
    let summary
    let resultText

    if (result.kind === 'discussion') {
      const layoutSummary = result.layoutComparisonSummary || getLayoutComparisonSummary(result)
      title = `${dimensions} 围桌会议`
      summary = `${result.systemLabel} · ${result.speakerCount} 只 / ${result.zoneCount} 区`
      if (result.pagNagReview) {
        const pagNagLines = getPagNagInputLines(result.pagNagReview)
        resultText = [
          `场地：${dimensions} · 会议桌：${result.tableSummary} · ${result.participantCount} 人`,
          `目标：${result.standardLabel} · ≥ ${result.standardMaxSpl} dB SPL`,
          ...(result.reviewWarnings || []).map(compactVenueReviewWarning),
          `系统建议：${result.systemLabel} · 布局：${layoutSummary}`,
          `音箱位置与间距：见布局图 · 分区 ${result.speakerCount} 只 / ${result.zoneCount} 区`,
          `安装建议：${result.installationRecommendationLabel} · 中心高度约 ${result.speakerHeight} m`,
          `几何参考：约 ${result.recommendedCoverageDeg}° · 最不利最近声程 ${result.maximumNearestDistanceMeters} m`,
          ...(result.coverageSummary ? [
            `几何坐席：${result.coverageSummary.coveredSeatCount}/${result.coverageSummary.participantCount} · 交叠 ${result.coverageSummary.doubleCoveredSeatCount} 席 / 最大 ${result.coverageSummary.maximumCoverageCount} 区`,
          ] : []),
          `最低能力：≥ ${result.requiredSplAtOneMeter} dB SPL @ 1m · 各区独立输出`,
          '路由原则：邻近话筒不送本区音箱，采用 Mix-Minus。',
          ...(result.pagNagReview?.basis === 'omnidirectional-multiple-speakers'
            ? ['多音箱取点：仅选播放本话筒的音箱；A距话筒最近，B距最远听众最近，可为同箱。'] : []),
          ...pagNagLines,
          'NAG目标：近、远听众声音相当。',
          ...getPagNagResultLines(result.pagNagReview),
          '资料边界：标称角范围与声学资料待核验；围桌图仅为几何参考，不代表真实覆盖或均匀度。',
        ].join('\n')
      } else {
        resultText = [
          '会议室扩声预估｜围桌讨论型',
          `场地：${dimensions}`,
          `会议桌：${result.tableSummary} · ${result.participantCount} 人`,
          `目标：${result.standardLabel} · ≥ ${result.standardMaxSpl} dB SPL`,
          ...(result.reviewWarnings || []).map(compactVenueReviewWarning),
          `系统建议：${result.systemLabel}`,
          `布局比较：${layoutSummary}`,
          '音箱位置与间距：见布局图',
          `扬声器分区：${result.speakerCount} 只 / ${result.zoneCount} 区`,
          `安装建议：${result.installationRecommendationLabel} · 中心高度约 ${result.speakerHeight} m`,
          `几何参考：约 ${result.recommendedCoverageDeg}° · 最不利最近声程 ${result.maximumNearestDistanceMeters} m`,
          ...(result.coverageSummary ? [
            `几何参考坐席范围：${result.coverageSummary.coveredSeatCount}/${result.coverageSummary.participantCount}`,
            `几何交叠参考：${result.coverageSummary.doubleCoveredSeatCount} 个坐席由两个服务区衔接，最大交叠 ${result.coverageSummary.maximumCoverageCount} 区`,
          ] : []),
          `最低能力：≥ ${result.requiredSplAtOneMeter} dB SPL @ 1m`,
          '路由原则：各区独立输出；邻近话筒不送本区音箱，采用 Mix-Minus。',
          '资料边界：标称角范围与声学资料待核验；围桌图仅为几何参考，不代表真实覆盖或均匀度。',
        ].join('\n')
      }
    } else {
      const firstPackage = getFirstRecommendationPackage(result)
      const layoutSummary = result.layoutComparisonSummary || getLayoutComparisonSummary(result)
      const layoutPositionLines = result.layoutPositionLines || getMainPositionLines(result)
      const coverageEnvelopeText = result.coverageEnvelopeText || getCoverageEnvelopeText(result)
      const handoffReview = this.getHandoffReviewForResult(result)
      const reportReviewWarnings = (result.reviewWarnings || [])
        .filter((warning) => !/标称角仅作几何筛选；频段指向性与最大声压测试口径尚待核验/.test(String(warning)))
      title = `${dimensions} 会议室`
      summary = `${result.standardLabel} · 主扩 ${result.mainCount} 只${result.fillCount ? ` + 补声 ${result.fillCount} 只` : ''}`
      resultText = [
        '会议室扩声预估｜报告 / 培训型',
        `场地：${dimensions}`,
        `听音区：宽 ${result.listeningWidth} m · 距主扩 ${result.firstListeningDistance}～${result.lastListeningDistance} m`,
        `目标：${result.standardLabel} · ≥ ${result.standardMaxSpl} dB SPL`,
        ...reportReviewWarnings.map(compactVenueReviewWarning),
        '资料边界：标称角范围与声学资料待核验；最大声压测试口径需核对。',
        ...getHandoffReviewReportNotes(handoffReview),
        `系统建议：主扩 ${result.mainCount} 只${result.fillCount ? ` + 补声 ${result.fillCount} 只` : ' · 无需补声'}`,
        `最低能力：≥ ${result.requiredSplAtOneMeter} dB SPL @ 1m`,
        coverageEnvelopeText,
        `安装参考：中心高度约 ${result.speakerCenterHeight} m · 初始下倾约 ${result.recommendedAimDownDeg}°`,
        `布局比较：${layoutSummary}`,
        '坐标：面朝后排，横向距左墙，纵向距主扩安装面。',
        ...(layoutPositionLines.length ? layoutPositionLines : ['主扩位置：见布局图']),
        ...(firstPackage ? [`候选主扩：${firstPackage.main.model} × ${firstPackage.main.count}`] : []),
        ...(firstPackage?.fill ? [`候选补声：${firstPackage.fill.model} × ${firstPackage.fill.count}`] : []),
        ...getFillPlacementGroups(result).slice(0, 2).map((group, index) => (
          `${group.label}：距主扩约 ${group.mainToFillDistanceMeters} m${handoffReview?.groups?.[index] ? `；${getHandoffGroupReportSummary(handoffReview.groups[index])}` : ` · ${group.serviceAreaLabel}`}`
        )),
      ].join('\n')
    }

    return {
      module: 'venue',
      title,
      summary,
      preferences: this.getPreferences(state),
      resultText,
    }
  },

  getRecordLookupPayload() {
    this.flushCalculate()
    const state = this.getOutputState()
    if (!state || !this.data.result || !this.hasCurrentOperationResult() || isPagNagIncomplete(state, this.data.result)) return null
    return { module: 'venue', preferences: this.getPreferences() }
  },

  ...resultReportMethods,

  copyResult() {
    this.flushCalculate()
    const state = this.getOutputState()
    if (!state || !this.hasCurrentOperationResult() || isPagNagIncomplete(state, this.data.result)) return
    const resultText = this.getResultText(this.ensureVenuePlan({ syncView: false }))
    if (!resultText) return
    vibrate('medium')
    wx.setClipboardData({ data: resultText })
  },

  toggleCurrentFavorite() {
    togglePageFavorite(this)
  },

  saveToActiveProject() {
    const payload = this.getRecordPayload()
    const result = this.data.result
    const guard = payload && result ? captureOperationResult(this, result) : null
    if (!payload || !guard || !isOperationResultCurrent(this, guard)) return
    const preferences = JSON.stringify(payload.preferences)
    const current = () => this.data.result === result
      && JSON.stringify(this.getPreferences()) === preferences
      && isOperationResultCurrent(this, guard)
    const save = (project) => {
      if (!project || !current()) return
      if (!addRecordToProject(payload, project.id)) {
        wx.showToast({ title: '保存失败，请检查本地存储', icon: 'none' })
        return
      }
      vibrate('medium')
      wx.showToast({ title: `已加入${project.name}`, icon: 'none' })
    }
    const project = getActiveProject()
    if (project) return save(project)
    wx.showModal({
      title: '新建现场项目', content: '', editable: true,
      placeholderText: '例如：三楼会议室', confirmText: '创建并加入',
      success: ({ confirm, content }) => {
        if (!confirm || !current()) return
        const created = createProject(content)
        if (created) save(created)
        else wx.showToast({ title: '请输入项目名称', icon: 'none' })
      },
    })
  },

  ...venueOperationMethods,
})

finishVenueModuleLoad()

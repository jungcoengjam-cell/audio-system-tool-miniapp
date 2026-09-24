const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishCameraModuleLoad = startMeasurement('摄像机/脚本加载')
const { cameras } = require('../../data/cameras')
const {
  calculateGroundAreaPlacement,
  calculateHorizontalOnlyPlacement,
  calculateVerticalPlanePlacement,
  getCameraMountLabel,
  getCameraMountType,
  getHorizontalCameraViews,
  resolveCustomFov,
  resolveLibraryOptics,
} = require('../../utils/camera-fov')
const { findValueIndex, readPreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  createOperationMethods,
  prepareOperation,
  disposeOperation,
  captureOperationResult,
  isOperationResultCurrent,
  invalidateOperation,
} = require('../../utils/operation-inputs')
const {
  cancelResultReportGeneration,
  createResultReportData,
  createResultReportMethods,
  resetStaleResultReport,
} = require('../../utils/result-report-controller')
const {
  addPageToActiveProject,
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')
const { adaptCanvas2dContext, drawPreviewAtSize: renderPreviewAtSize } = require('./preview-renderer')

const PREFERENCE_KEY = 'audioTool.camera.preferences'
const DEFAULT_MODEL = 'TV-6124HK'
const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 500
const INPUT_CALCULATION_DELAY = 160
const finishCameraCatalogPreparation = startMeasurement('摄像机/产品库预处理')
const selectableCameras = cameras
  .map((camera) => ({
    ...camera,
    views: getHorizontalCameraViews(camera).map((view, index) => ({
      ...view,
      mountLabel: getCameraMountLabel(camera, index),
    })),
  }))
  .filter((camera) => camera.views.length)
finishCameraCatalogPreparation({ sourceModels: cameras.length, selectableModels: selectableCameras.length })
const resultReportMethods = createResultReportMethods({
  performancePrefix: '摄像机',
  emptyToast: '暂无可生成的安装结果',
})

const CAMERA_OPERATION_FIELDS = {
  horizontalFov: { label: '水平视场角', unit: 'deg' },
  verticalFov: {
    label: '垂直视场角', unit: 'deg',
    read: (page) => Number(page.data.customVerticalFovText),
  },
  sceneMode: { label: '场景类型', unit: 'key' },
  widthMeters: { label: '区域宽度', unit: 'm' },
  depthMeters: { label: '区域纵深', unit: 'm' },
  subjectHeightMeters: { label: '人物最高点', unit: 'm' },
  heightMode: { label: '安装高度模式', unit: 'key' },
  cameraHeightMeters: { label: '已有镜头中心高', unit: 'm' },
  marginPercent: { label: '构图余量', unit: '%' },
}
const cameraOperationMethods = createOperationMethods({
  id: 'full-area',
  kinds: ['horizontal-only'],
  fields: CAMERA_OPERATION_FIELDS,
  requiredFields: {
    'full-area': Object.keys(CAMERA_OPERATION_FIELDS).filter((field) => field !== 'cameraHeightMeters'),
    'horizontal-only': Object.keys(CAMERA_OPERATION_FIELDS).filter((field) => field !== 'verticalFov' && field !== 'cameraHeightMeters'),
  },
})

function findCameraIndex(model) {
  const index = selectableCameras.findIndex((camera) => camera.model === model)
  return index >= 0 ? index : selectableCameras.findIndex((camera) => camera.model === DEFAULT_MODEL)
}

function operationInputError(facts, kind) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return ''
  if (kind !== 'full-area' && kind !== 'horizontal-only') return 'invalid operation kind'
  if (facts.sceneMode !== undefined && facts.sceneMode !== 'ground') return 'unsupported scene mode'
  if (facts.heightMode !== undefined && facts.heightMode !== 'auto' && facts.heightMode !== 'fixed') return 'invalid height mode'
  if (facts.marginPercent !== undefined
    && (!Number.isFinite(Number(facts.marginPercent)) || Number(facts.marginPercent) < 0 || Number(facts.marginPercent) > 50)) return 'invalid margin'
  if (facts.heightMode === 'fixed'
    && (!Number.isFinite(Number(facts.cameraHeightMeters)) || Number(facts.cameraHeightMeters) <= 0)) return 'fixed camera height is required'
  return ''
}

const CAMERA_INPUT_FIELDS = {
  customHorizontalFovText: ['horizontalFov', 'deg'],
  customVerticalFovText: ['verticalFov', 'deg'],
  groundWidthText: ['widthMeters', 'm'],
  groundDepthText: ['depthMeters', 'm'],
  subjectHeightText: ['subjectHeightMeters', 'm'],
  fixedCameraHeightText: ['cameraHeightMeters', 'm'],
}

function buildCameraOptions() {
  return selectableCameras.map(({ model, category, sensor }, index) => ({
    model,
    category,
    sensor,
    index,
  }))
}

function buildSelectedCamera(camera) {
  return camera
    ? { model: camera.model, category: camera.category, sensor: camera.sensor }
    : { model: '', category: '', sensor: '' }
}

const cameraOptions = buildCameraOptions()

function filterCameras(items, keyword) {
  const normalized = String(keyword || '').trim().toLowerCase()
  if (!normalized) return items
  return items.filter((camera) => [camera.model, camera.category, camera.sensor]
    .some((value) => String(value || '').toLowerCase().includes(normalized)))
}

function buildViewOptions(camera) {
  return camera.views.map(({ label }) => ({ label }))
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function buildCalculationProcess(result) {
  const rows = [
    {
      title: '加入构图余量',
      formula: '有效宽度 = 原宽度 × (1 + 余量)',
      substitution: `${result.widthMeters} × (1 + ${result.marginPercent}%)`,
      value: `${result.effectiveWidthMeters} m`,
    },
    {
      title: '计算水平最低距离',
      formula: 'Dₕ = 有效宽度 ÷ [2 × tan(水平视场角 ÷ 2)]',
      substitution: `${result.effectiveWidthMeters} ÷ [2 × tan(${result.horizontalFov}° ÷ 2)]`,
      value: `${result.horizontalMinimumDistanceMeters} m`,
    },
  ]

  if (!result.horizontalOnly) {
    rows.push({
      title: '满足水平约束后校核垂直距离',
      formula: '从水平最低距离起求解：垂直包络角 ≤ 镜头垂直视场角',
      substitution: result.sceneMode === 'ground'
        ? `镜头高 ${result.cameraHeightMeters} m，有效高度 0–${result.effectiveSubjectHeightMeters} m，有效纵深 ${result.effectiveDepthMeters} m，垂直角 ${result.verticalFov}°`
        : `镜头高 ${result.cameraHeightMeters} m，有效上下边界 ${result.effectiveBottomHeightMeters}–${result.effectiveTopHeightMeters} m，垂直角 ${result.verticalFov}°`,
      value: `${formatNumber(result.calculationDistanceMeters)} m`,
    })
  }

  const limitingDistance = result.horizontalOnly
    ? result.horizontalMinimumDistanceMeters
    : result.calculationDistanceMeters
  rows.push(result.sceneMode === 'ground'
    ? {
      title: '换算到实际区域前沿',
      formula: `${result.horizontalOnly ? 'Dₕ' : '满足水平约束的距离'} + 纵深方向构图余量`,
      substitution: `${formatNumber(limitingDistance)} + ${result.depthMarginMeters}`,
      value: `${result.primaryDistanceMeters} m`,
    }
    : {
      title: '确定最终最低距离',
      formula: result.horizontalOnly ? 'D = Dₕ' : '当前模型下双轴覆盖通过的理论最小距离',
      substitution: result.horizontalOnly
        ? `${result.horizontalMinimumDistanceMeters}`
        : formatNumber(limitingDistance),
      value: `${result.primaryDistanceMeters} m`,
    })

  const barMaximum = Math.max(limitingDistance, 0.01)
  return {
    rows,
    conclusion: result.horizontalOnly
      ? `当前只能确认水平方向至少需要 ${result.primaryDistanceMeters} m；垂直覆盖仍需说明书参数或样机画面确认。`
      : `当前独立水平/垂直视场角模型下，理论最小距离为 ${result.primaryDistanceMeters} m；两轴校核通过。`,
    visual: {
      horizontalBarPercent: Math.max(12, Math.round(result.horizontalMinimumDistanceMeters / barMaximum * 100)),
      verticalBarPercent: result.horizontalOnly
        ? 0
        : Math.max(12, Math.round(result.verticalMinimumDistanceMeters / barMaximum * 100)),
      limitingDistanceMeters: formatNumber(limitingDistance),
      limitingAxisLabel: result.horizontalOnly
        ? '仅水平约束'
        : result.distanceConstraintText,
      hasDepthMargin: result.sceneMode === 'ground' && result.depthMarginMeters > 0,
      depthMarginMeters: result.depthMarginMeters || 0,
    },
  }
}

Page({
  data: {
    sourceModes: ['库内摄像机', '自定义摄像机'],
    sourceModeIndex: 0,
    cameraIndex: findCameraIndex(DEFAULT_MODEL),
    selectedCamera: buildSelectedCamera(selectableCameras[findCameraIndex(DEFAULT_MODEL)]),
    cameraCount: selectableCameras.length,
    viewOptions: [],
    viewIndex: 0,
    selectedMountLabel: '',
    definitionModes: [
      { value: 'angles', label: '已知视场角' },
      { value: 'sensor', label: '传感器 + 焦距' },
    ],
    definitionModeIndex: 0,
    customMountTypes: [
      { value: 'ptz', label: '机械云台' },
      { value: 'fixed', label: '固定式/枪机' },
    ],
    customMountTypeIndex: 0,
    customHorizontalFovText: '60',
    customVerticalFovText: '36',
    customSensorWidthText: '6.4',
    customSensorHeightText: '3.6',
    customFocalLengthText: '4.5',
    sceneModes: [
      { value: 'ground', label: '地面区域', description: '会议桌、坐席区、舞台活动区' },
      { value: 'plane', label: '垂直平面', description: '屏幕、黑板、背景墙、舞台口' },
    ],
    sceneModeIndex: 0,
    heightModes: [
      { value: 'auto', label: '自动建议高度' },
      { value: 'fixed', label: '已有安装高度' },
    ],
    heightModeIndex: 0,
    marginOptions: [0, 5, 10, 15, 20],
    marginIndex: 2,
    groundWidthText: '6',
    groundDepthText: '4',
    subjectHeightText: '1.8',
    planeWidthText: '6',
    planeHeightText: '2.5',
    planeBottomHeightText: '0.8',
    fixedCameraHeightText: '2.3',
    result: null,
    calculationError: '',
    previewExpanded: false,
    calculationExpanded: false,
    currentFavorite: false,
    selectorVisible: false,
    selectorKeyword: '',
    selectorItems: [],
    operationSnapshot: null,
    operationActive: false,
    ...createResultReportData(),
  },

  onLoad() {
    const finishInitialization = startMeasurement('摄像机/初始化总耗时')
    this._pageVisible = false
    this._cameraUnloaded = false
    const preferences = readPreferences(PREFERENCE_KEY)
    const sourceModeIndex = preferences.sourceMode === 'custom' ? 1 : 0
    const cameraIndex = findCameraIndex(preferences.cameraModel || DEFAULT_MODEL)
    const camera = selectableCameras[cameraIndex]
    const rawViewIndex = Number(preferences.viewIndex)
    const viewIndex = Number.isFinite(rawViewIndex) && Number.isInteger(rawViewIndex) && rawViewIndex >= 0
      ? Math.min(rawViewIndex, camera.views.length - 1)
      : 0
    this.commitCalculatedState({
      sourceModeIndex,
      cameraIndex,
      selectedCamera: buildSelectedCamera(camera),
      viewOptions: buildViewOptions(camera),
      viewIndex,
      selectedMountLabel: camera.views[viewIndex].mountLabel,
      definitionModeIndex: preferences.definitionMode === 'sensor' ? 1 : 0,
      customMountTypeIndex: preferences.customMountType === 'fixed' ? 1 : 0,
      customHorizontalFovText: preferences.customHorizontalFovText || '60',
      customVerticalFovText: preferences.customVerticalFovText || '36',
      customSensorWidthText: preferences.customSensorWidthText || '6.4',
      customSensorHeightText: preferences.customSensorHeightText || '3.6',
      customFocalLengthText: preferences.customFocalLengthText || '4.5',
      sceneModeIndex: preferences.sceneMode === 'plane' ? 1 : 0,
      heightModeIndex: preferences.heightMode === 'fixed' ? 1 : 0,
      marginIndex: findValueIndex(
        this.data.marginOptions,
        preferences.marginPercent === undefined ? 10 : Number(preferences.marginPercent),
      ),
      groundWidthText: preferences.groundWidthText || '6',
      groundDepthText: preferences.groundDepthText || '4',
      subjectHeightText: preferences.subjectHeightText || '1.8',
      planeWidthText: preferences.planeWidthText || '6',
      planeHeightText: preferences.planeHeightText || '2.5',
      planeBottomHeightText: preferences.planeBottomHeightText || '0.8',
      fixedCameraHeightText: preferences.fixedCameraHeightText || '2.3',
    }, () => finishInitialization({ model: camera.model }))
  },

  onShow() {
    this._pageVisible = true
    if (this.data.result) syncPageFavorite(this)
    if (this.data.previewExpanded) this.drawPreview()
  },
  onHide() {
    this._pageVisible = false
    this.invalidatePreviewCanvas({ keepCache: true })
    this.flushPendingCalculation()
  },
  onUnload() {
    disposeOperation(this)
    if (this._cameraUnloaded) return
    this._cameraUnloaded = true
    this._pageVisible = false
    this.invalidatePreviewCanvas()
    this.cancelPendingCalculation()
    cancelResultReportGeneration(this)
    printPerformanceSummary('摄像机/')
  },

  ...cameraOperationMethods,

  beginStructuredOperation(facts = {}, kind = 'full-area') {
    const error = operationInputError(facts, kind)
    if (error) facts = { __cameraOperationRejected: error }
    return cameraOperationMethods.beginStructuredOperation.call(this, facts, kind)
  },

  endOperation() {
    cameraOperationMethods.endStructuredOperation.call(this)
    this.commitCalculatedState()
  },

  onOperationStateChange(snapshot) {
    if (this._cameraUnloaded) return
    const previous = this.data.operationSnapshot
    const shouldCalculate = Boolean(snapshot?.ready
      && (!previous || previous.id !== snapshot.id || previous.revision !== snapshot.revision))
    const blockers = new Set(snapshot?.blockers || [])
    const fields = snapshot?.fields.filter((field) => field.value !== undefined || blockers.has(field.key))
      .map((field) => field.value === undefined && blockers.has(field.key)
        ? { ...field, displayValue: '待输入' }
        : field)
    const displaySnapshot = snapshot && { ...snapshot, fields }
    this.setData({ operationSnapshot: displaySnapshot, operationActive: Boolean(snapshot?.active) }, () => {
      if (!shouldCalculate || this._cameraUnloaded) return
      const current = this.getOperationSnapshot()
      if (!current?.ready || current.id !== snapshot.id || current.revision !== snapshot.revision) return
      const operation = prepareOperation(this)
      if (operation.blocked || operationInputError(operation.state, current.kind)) {
        invalidateOperation(this, 'invalid-camera-operation-input')
        return
      }
      this.commitCalculatedState()
    })
  },

  onOperationInvalidate(reason) {
    this.cancelPendingCalculation()
    cancelResultReportGeneration(this)
    this.resultReportSignature = ''
    this.resultReportPendingSignature = ''
    this.setData({
      result: null,
      currentFavorite: false,
      calculationError: reason === 'end' ? '' : '本次操作输入已变化，请重新确认后计算。',
      resultReportImagePath: '',
      resultReportPreviewVisible: false,
      isGeneratingResultReport: false,
      operationActive: false,
    })
  },

  hasCurrentOperationResult(result = this.data.result) {
    if (this._cameraUnloaded || !result || this.data.result !== result) return false
    const snapshot = this.getOperationSnapshot()
    if (!snapshot) return true
    const guard = captureOperationResult(this, result)
    return Boolean(snapshot.active && snapshot.ready && guard && isOperationResultCurrent(this, guard))
  },
  onResize() {
    this.invalidatePreviewCanvas()
    if (this._pageVisible) this.drawPreview()
  },

  onSourceModeTap(event) {
    const sourceModeIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(sourceModeIndex) || sourceModeIndex === this.data.sourceModeIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-mode-changed')
    this.commitCalculatedState({ sourceModeIndex })
  },

  onDefinitionModeTap(event) {
    const definitionModeIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(definitionModeIndex) || definitionModeIndex === this.data.definitionModeIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-optics-changed')
    this.commitCalculatedState({ definitionModeIndex })
  },

  onCustomMountTypeTap(event) {
    const customMountTypeIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(customMountTypeIndex) || customMountTypeIndex === this.data.customMountTypeIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-mount-changed')
    this.commitCalculatedState({
      customMountTypeIndex,
    })
  },

  onSceneModeTap(event) {
    const sceneModeIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(sceneModeIndex) || sceneModeIndex === this.data.sceneModeIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-scene-changed')
    this.commitCalculatedState({ sceneModeIndex })
  },

  onHeightModeTap(event) {
    const heightModeIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(heightModeIndex) || heightModeIndex === this.data.heightModeIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) {
      const heightMode = this.data.heightModes[heightModeIndex].value
      this.setData({ heightModeIndex })
      this.setOperationCandidate('heightMode', heightMode, 'key')
      return
    }
    if (this.getOperationSnapshot()) { this.setData({ heightModeIndex }); return }
    this.commitCalculatedState({ heightModeIndex })
  },

  onMarginChange(event) {
    const marginIndex = Number(event.detail.value)
    if (!Number.isInteger(marginIndex) || marginIndex === this.data.marginIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) {
      this.setData({ marginIndex })
      this.setOperationCandidate('marginPercent', this.data.marginOptions[marginIndex], '%')
      return
    }
    if (this.getOperationSnapshot()) { this.setData({ marginIndex }); return }
    this.commitCalculatedState({ marginIndex })
  },

  toggleCalculationDetails() {
    vibrate('light')
    this.setData({ calculationExpanded: !this.data.calculationExpanded })
  },

  togglePreviewDetails() {
    vibrate('light')
    const previewExpanded = !this.data.previewExpanded
    this.invalidatePreviewCanvas()
    this.setData({ previewExpanded }, () => {
      if (previewExpanded) this.drawPreview()
    })
  },

  onViewTap(event) {
    const viewIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(viewIndex) || viewIndex === this.data.viewIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-model-view-changed')
    this.commitCalculatedState({
      viewIndex,
      selectedMountLabel: selectableCameras[this.data.cameraIndex].views[viewIndex].mountLabel,
    })
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    const snapshot = this.getOperationSnapshot()
    this.setData({ [field]: value })
    if (snapshot?.active) {
      const operationField = CAMERA_INPUT_FIELDS[field]
      if (operationField) this.setOperationCandidate(operationField[0], Number(value), operationField[1])
      else invalidateOperation(this, 'camera-optics-changed')
      return
    }
    if (snapshot) return
    this.scheduleCalculation()
  },

  onFieldBlur() { this.flushPendingCalculation() },

  scheduleCalculation() {
    this.cancelPendingCalculation()
    this._calculationTimer = setTimeout(() => {
      this._calculationTimer = null
      this.calculate()
    }, INPUT_CALCULATION_DELAY)
  },

  cancelPendingCalculation() {
    if (!this._calculationTimer) return
    clearTimeout(this._calculationTimer)
    this._calculationTimer = null
  },

  flushPendingCalculation(afterCalculate) {
    if (!this._calculationTimer) {
      if (afterCalculate) afterCalculate()
      return
    }
    this.cancelPendingCalculation()
    this.calculate(afterCalculate)
  },

  openCameraSelector() {
    this.setData({ selectorVisible: true, selectorKeyword: '', selectorItems: cameraOptions })
  },
  closeCameraSelector() { this.setData({ selectorVisible: false }) },
  stopTap() {},

  onSelectorInput(event) {
    const selectorKeyword = event.detail.value
    this.setData({ selectorKeyword, selectorItems: filterCameras(cameraOptions, selectorKeyword) })
  },

  selectCamera(event) {
    const cameraIndex = Number(event.currentTarget.dataset.index)
    const camera = selectableCameras[cameraIndex]
    if (cameraIndex !== this.data.cameraIndex) vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-model-changed')
    this.commitCalculatedState({
      cameraIndex,
      viewOptions: buildViewOptions(camera),
      viewIndex: 0,
      selectedMountLabel: camera.views[0].mountLabel,
      selectorVisible: false,
    })
  },

  getFovDefinition(state = this.data) {
    if (state.sourceModeIndex === 0) {
      return resolveLibraryOptics(
        selectableCameras[state.cameraIndex],
        state.viewIndex,
        'wide',
      )
    }
    return resolveCustomFov({
      definitionMode: state.definitionModes[state.definitionModeIndex].value,
      horizontalFov: Number(state.customHorizontalFovText),
      verticalFov: Number(state.customVerticalFovText),
      sensorWidth: Number(state.customSensorWidthText),
      sensorHeight: Number(state.customSensorHeightText),
      focalLength: Number(state.customFocalLengthText),
    })
  },

  calculate(afterCommit) {
    return this.commitCalculatedState({}, afterCommit)
  },

  commitStructuredCalculatedState(operation) {
    const values = operation.state
    const kind = this.getOperationSnapshot()?.kind
    const sceneMode = values.sceneMode
    const fov = kind === 'horizontal-only'
      ? { horizontalOnly: true, horizontalFov: Number(values.horizontalFov) }
      : resolveCustomFov({
        definitionMode: 'angles',
        horizontalFov: Number(values.horizontalFov),
        verticalFov: Number(values.verticalFov),
      })
    const options = {
      widthMeters: Number(values.widthMeters),
      depthMeters: Number(values.depthMeters),
      subjectHeightMeters: Number(values.subjectHeightMeters),
      heightMode: values.heightMode,
      marginRatio: Number(values.marginPercent) / 100,
      ...(values.heightMode === 'fixed' ? { cameraHeightMeters: Number(values.cameraHeightMeters) } : {}),
    }
    const finishCoreCalculation = startMeasurement('摄像机/核心几何计算', { sceneMode, structured: true, kind })
    const result = fov?.horizontalOnly
      ? calculateHorizontalOnlyPlacement(fov, { sceneMode, ...options })
      : calculateGroundAreaPlacement(fov, options)
    finishCoreCalculation({ success: Boolean(result), horizontalOnly: Boolean(fov?.horizontalOnly) })
    if (!result) {
      this.setData({ result: null, calculationError: '请检查本次操作的视场角、区域尺寸、高度模式和构图余量。' })
      return null
    }

    if (!operation.commit(result)) return null
    Object.assign(result, {
      displayModel: '自定义摄像机', displayView: '本次操作确认参数',
      sourceText: '本次结构化操作明确提供的视场角与场景尺寸。',
      sourceNote: result.horizontalOnly ? '本次操作仅确认水平视场角。' : '',
      endpointLabel: '本次确认视角', mountType: 'unspecified',
      mountLabel: '安装结构待现场确认', requiresInitialAim: false,
      aimValue: '待现场确认', aimLabel: '安装方式待确认',
      distanceMeaning: result.horizontalOnly ? '水平覆盖参考距离（非完整安装距离）' : '当前模型下理论最小距离',
      endpointExplanation: result.horizontalOnly ? '本次操作未确认垂直覆盖。' : '按本次明确确认的水平与垂直视场角计算。',
    })
    const calculationProcess = buildCalculationProcess(result)
    Object.assign(result, { calculationRows: calculationProcess.rows,
      calculationConclusion: calculationProcess.conclusion, calculationVisual: calculationProcess.visual })
    this._canvasCache = null
    this.setData({ result, calculationError: '' }, () => {
      if (!this.hasCurrentOperationResult(result)) return
      if (this._pageVisible) syncPageFavorite(this)
      this.drawPreview()
    })
    return result
  },

  commitCalculatedState(changes = {}, afterCommit) {
    const finishCalculation = startMeasurement('摄像机/计算到结果更新')
    this.cancelPendingCalculation()
    if (this._cameraUnloaded) return null
    const operation = prepareOperation(this)
    if (operation.disposed) return null
    if (operation.structured && operation.blocked) {
      if (Object.keys(changes).length) {
        const selectedCamera = Number.isInteger(changes.cameraIndex)
          ? buildSelectedCamera(selectableCameras[changes.cameraIndex]) : undefined
        this.setData({ ...changes, ...(selectedCamera ? { selectedCamera } : {}) })
      }
      return null
    }
    if (operation.structured) return this.commitStructuredCalculatedState(operation)
    const state = { ...this.data, ...changes }
    const selectedCamera = buildSelectedCamera(selectableCameras[state.cameraIndex])
    const fov = this.getFovDefinition(state)
    const heightMode = state.heightModes[state.heightModeIndex].value
    const marginRatio = state.marginOptions[state.marginIndex] / 100
    const sceneMode = state.sceneModes[state.sceneModeIndex].value
    const groundOptions = {
        widthMeters: Number(state.groundWidthText),
        depthMeters: Number(state.groundDepthText),
        subjectHeightMeters: Number(state.subjectHeightText),
        heightMode,
        cameraHeightMeters: Number(state.fixedCameraHeightText),
        marginRatio,
      }
    const planeOptions = {
        widthMeters: Number(state.planeWidthText),
        heightMeters: Number(state.planeHeightText),
        bottomHeightMeters: Number(state.planeBottomHeightText),
        heightMode,
        cameraHeightMeters: Number(state.fixedCameraHeightText),
        marginRatio,
      }
    const finishCoreCalculation = startMeasurement('摄像机/核心几何计算', { sceneMode })
    const result = fov?.horizontalOnly
      ? calculateHorizontalOnlyPlacement(fov, {
        sceneMode,
        ...(sceneMode === 'ground' ? groundOptions : planeOptions),
      })
      : sceneMode === 'ground'
        ? calculateGroundAreaPlacement(fov, groundOptions)
        : calculateVerticalPlanePlacement(fov, planeOptions)
    finishCoreCalculation({ success: Boolean(result), horizontalOnly: Boolean(fov?.horizontalOnly) })

    if (!result) {
      this._canvasCache = null
      const resultReportChanges = resetStaleResultReport(this, null)
      const finishViewUpdate = startMeasurement('摄像机/setData视图更新', { success: false })
      this.setData({
        ...changes,
        selectedCamera,
        result: null,
        ...resultReportChanges,
        calculationError: !fov
          ? '请选择说明书提供水平视场角的型号；自定义摄像机需填写两个角度，或填写有效传感器尺寸与焦距。'
          : '请检查区域尺寸、人物高度、底边高度和固定安装高度，所有必填尺寸均需有效。',
      }, () => {
        finishViewUpdate()
        finishCalculation({ success: false })
        if (afterCommit) afterCommit()
      })
      return
    }

    const camera = selectableCameras[state.cameraIndex]
    const isLibrary = state.sourceModeIndex === 0
    const mountType = isLibrary
      ? getCameraMountType(camera, state.viewIndex)
      : state.customMountTypes[state.customMountTypeIndex].value
    result.displayModel = isLibrary ? camera.model : '自定义摄像机'
    result.displayView = isLibrary ? fov.view.label : state.definitionModes[state.definitionModeIndex].label
    result.sourceText = isLibrary
      ? `${camera.source}｜参数页 ${camera.sourcePages}`
      : '用户输入参数；请以所用摄像机说明书为准。'
    result.sourceNote = [isLibrary ? camera.note : '', result.horizontalOnly
      ? '本结果仅使用说明书水平视场角，不推算垂直角，不能作为完整安装距离。'
      : ''].filter(Boolean).join(' ')
    result.endpointLabel = fov.endpointLabel || '自定义视角'
    result.mountType = mountType
    result.mountLabel = isLibrary
      ? getCameraMountLabel(camera, state.viewIndex)
      : state.customMountTypes[state.customMountTypeIndex].label
    result.requiresInitialAim = mountType !== 'ptz'
    result.aimValue = result.requiresInitialAim ? result.aimText : '云台取景'
    result.aimLabel = result.requiresInitialAim ? '固定安装初始俯仰角' : '现场调整水平与俯仰'
    result.heightSummary = `${result.horizontalOnly ? '参考' : '建议'}镜头中心高 ${result.cameraHeightMeters} m`
    const isWide = isLibrary && Number(fov.view.hTele) > 0
    result.distanceMeaning = result.horizontalOnly
      ? '水平拍全目标宽度所需最低距离（非完整安装距离）'
      : '当前模型下理论最小距离'
    result.endpointExplanation = result.horizontalOnly
      ? '说明书缺少垂直视场角；当前只能确认水平方向能否拍全，无法确认目标上下边界是否入画。'
      : isWide
        ? '安装点位统一按广角端计算，确保能够拍全目标区域；长焦端参数仅在产品资料库中保留，用于查阅特写能力。'
        : '该结果按当前固定或自定义视场角计算。'
    const calculationProcess = buildCalculationProcess(result)
    result.calculationRows = calculationProcess.rows
    result.calculationConclusion = calculationProcess.conclusion
    result.calculationVisual = calculationProcess.visual
    const pageState = { ...state, result }
    const resultReportChanges = resetStaleResultReport(
      this,
      this.getRecordPayload(pageState, result),
    )

    const finishViewUpdate = startMeasurement('摄像机/setData视图更新', { success: true })
    this.setData({ ...changes, selectedCamera, result, calculationError: '', ...resultReportChanges }, () => {
      finishViewUpdate()
      if (this._pageVisible) syncPageFavorite(this)
      this.drawPreview()
      finishCalculation({ success: true, horizontalOnly: result.horizontalOnly })
      if (afterCommit) afterCommit()
    })
    writePreferences(PREFERENCE_KEY, this.getPreferences(state))
    return result
  },

  drawPreview() {
    if (!this._pageVisible || !this.data.result || !this.data.previewExpanded
      || typeof wx.createSelectorQuery !== 'function') return
    if (this._canvasCache) {
      this.renderPreview(this._canvasCache, 'cached')
      return
    }
    if (this._canvasQueryPending) return
    const queryRevision = (this._canvasRevision || 0) + 1
    this._canvasRevision = queryRevision
    this._canvasQueryPending = true
    const finishCanvasQuery = startMeasurement('摄像机/Canvas节点查询')
    wx.createSelectorQuery().in(this).select('#cameraFovCanvas').fields({ node: true, size: true })
      .exec((result) => {
        if (this._canvasRevision !== queryRevision) {
          finishCanvasQuery({ success: false })
          return
        }
        this._canvasQueryPending = false
        if (!this._pageVisible || !this.data.result || !this.data.previewExpanded) {
          finishCanvasQuery({ success: false })
          return
        }
        const canvasInfo = result?.[0]
        const canvas = canvasInfo?.node
        if (!canvas || typeof canvas.getContext !== 'function') {
          finishCanvasQuery({ success: false })
          return
        }
        finishCanvasQuery({ success: true })
        const width = Number(canvasInfo.width) || CANVAS_WIDTH
        const height = Number(canvasInfo.height) || CANVAS_HEIGHT
        const pixelRatio = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo().pixelRatio || 1 : 1
        canvas.width = Math.round(width * pixelRatio)
        canvas.height = Math.round(height * pixelRatio)
        const rawContext = canvas.getContext('2d')
        rawContext.scale(pixelRatio, pixelRatio)
        this._canvasCache = {
          canvas,
          rawContext,
          context: adaptCanvas2dContext(rawContext),
          width,
          height,
        }
        this.renderPreview(this._canvasCache, 'initial')
      })
  },

  renderPreview(canvasCache, source) {
    if (!this._pageVisible || !this.data.result || !this.data.previewExpanded) return
    const finishCanvasDrawing = startMeasurement('摄像机/Canvas绘制', { source })
    canvasCache.rawContext.clearRect(0, 0, canvasCache.width, canvasCache.height)
    this.drawPreviewAtSize(canvasCache.context, canvasCache.width, canvasCache.height)
    finishCanvasDrawing({ width: canvasCache.width, height: canvasCache.height })
  },

  drawPreviewAtSize(context, width, height) {
    renderPreviewAtSize(context, this.data.result, width, height)
  },

  invalidatePreviewCanvas({ keepCache = false } = {}) {
    this._canvasRevision = (this._canvasRevision || 0) + 1
    this._canvasQueryPending = false
    if (!keepCache) this._canvasCache = null
  },

  getPreferences(state = this.data) {
    const camera = selectableCameras[state.cameraIndex]
    return {
      sourceMode: state.sourceModeIndex === 0 ? 'library' : 'custom',
      cameraModel: camera.model,
      viewIndex: state.viewIndex,
      viewLabel: camera.views[state.viewIndex]?.label || '',
      definitionMode: state.definitionModes[state.definitionModeIndex].value,
      customMountType: state.customMountTypes[state.customMountTypeIndex].value,
      customHorizontalFovText: state.customHorizontalFovText,
      customVerticalFovText: state.customVerticalFovText,
      customSensorWidthText: state.customSensorWidthText,
      customSensorHeightText: state.customSensorHeightText,
      customFocalLengthText: state.customFocalLengthText,
      sceneMode: state.sceneModes[state.sceneModeIndex].value,
      heightMode: state.heightModes[state.heightModeIndex].value,
      marginPercent: state.marginOptions[state.marginIndex],
      groundWidthText: state.groundWidthText,
      groundDepthText: state.groundDepthText,
      subjectHeightText: state.subjectHeightText,
      planeWidthText: state.planeWidthText,
      planeHeightText: state.planeHeightText,
      planeBottomHeightText: state.planeBottomHeightText,
      fixedCameraHeightText: state.fixedCameraHeightText,
    }
  },

  getOperationPreferences() {
    const snapshot = this.getOperationSnapshot()
    if (!snapshot?.active || !snapshot.ready) return null
    const values = Object.fromEntries(snapshot.fields.filter((field) => field.confirmed).map((field) => [field.key, field.value]))
    return {
      sourceMode: 'custom',
      definitionMode: 'angles',
      sceneMode: values.sceneMode,
      heightMode: values.heightMode,
      marginPercent: values.marginPercent,
      customHorizontalFovText: String(values.horizontalFov),
      customVerticalFovText: values.verticalFov === undefined ? '' : String(values.verticalFov),
      groundWidthText: String(values.widthMeters),
      groundDepthText: String(values.depthMeters),
      subjectHeightText: String(values.subjectHeightMeters),
      ...(values.cameraHeightMeters === undefined ? {} : { fixedCameraHeightText: String(values.cameraHeightMeters) }),
    }
  },

  getRecordLookupPayload() {
    if (!this.hasCurrentOperationResult()) return null
    const preferences = this.getOperationSnapshot() ? this.getOperationPreferences() : this.getPreferences()
    return preferences ? { module: 'camera', preferences } : null
  },

  getResultText(state = this.data, result = state.result) {
    if (arguments.length === 0 && !this.hasCurrentOperationResult(result)) return ''
    if (!result) return ''
    const sceneRows = result.sceneMode === 'ground'
      ? [
        `拍摄区域：宽 ${result.widthMeters} m × 纵深 ${result.depthMeters} m；人物最高 ${result.subjectHeightMeters} m`,
        `摄像机距区域前沿：${result.cameraSetbackMeters} m`,
        `摄像机距区域中心：${result.distanceToCenterMeters} m`,
      ]
      : [
        `目标平面：宽 ${result.widthMeters} m × 高 ${result.heightMeters} m；底边离地 ${result.bottomHeightMeters} m`,
        `摄像机距目标平面：${result.distanceMeters} m`,
        result.horizontalOnly
          ? `理论水平画面宽度：${result.frameWidthMeters} m；垂直范围未校核`
          : `理论画面范围：宽 ${result.frameWidthMeters} m × 高 ${result.frameHeightMeters} m`,
      ]
    return [
      `摄像机安装反算｜${result.sceneLabel}`,
      `结果性质：${result.horizontalOnly ? '仅水平覆盖预估，非完整安装距离' : '当前模型双轴校核通过的理论最小距离'}`,
      `摄像机：${result.displayModel}｜${result.displayView}｜${result.endpointLabel}`,
      `镜头端点说明：${result.endpointExplanation}`,
      ...sceneRows,
      `镜头中心${result.horizontalOnly ? '参考' : '建议'}高度：${result.cameraHeightMeters} m（${result.heightBasis}）`,
      `安装结构：${result.mountLabel}`,
      `取景方式：${result.requiresInitialAim ? `固定安装，初始俯仰角 ${result.aimText}` : '机械云台可上下左右转动，无需固定初始俯角'}`,
      `构图余量：${result.marginPercent}%`,
      `镜头视场角：水平 ${result.horizontalFov}°｜垂直 ${result.horizontalOnly ? '说明书未提供' : `${result.verticalFov}°`}`,
      `目标最低所需视场角：水平 ${result.requiredHorizontalFov}°${result.horizontalOnly ? '｜垂直未校核' : `｜垂直 ${result.requiredVerticalFov}°`}`,
      `距离判定：${result.distanceConstraintText}`,
      '计算过程：',
      ...result.calculationRows.map((row, index) => `${index + 1}. ${row.title}：${row.formula}；代入 ${row.substitution}；结果 ${row.value}`),
      `计算结论：${result.calculationConclusion}`,
      `资料来源：${result.sourceText}`,
      `注：${result.horizontalOnly ? '当前仅校核水平覆盖；' : ''}仅为无遮挡、目标居中的光学几何估算，最终安装应通过样机画面复核。`,
    ].join('\n')
  },

  getRecordPayload(state = this.data, result = state.result) {
    if (arguments.length === 0 && !this.hasCurrentOperationResult(result)) return null
    const resultText = this.getResultText(state, result)
    if (!resultText) return null
    const preferences = (state.cameraStructuredOperation || this.getOperationSnapshot())
      ? this.getOperationPreferences()
      : this.getPreferences(state)
    if (!preferences) return null
    return {
      module: 'camera',
      title: `${result.displayModel} · ${result.sceneLabel}`,
      summary: `${result.endpointLabel} · ${result.primaryDistanceLabel} ${result.primaryDistanceMeters} m · ${result.mountLabel}`,
      preferences,
      resultText,
    }
  },

  ...resultReportMethods,
  generateResultReportImage() {
    if (this._cameraUnloaded || (this.getOperationSnapshot() && !this.hasCurrentOperationResult())) return
    return resultReportMethods.generateResultReportImage.call(this)
  },
  canUseCurrentResultReport() {
    if (!this.hasCurrentOperationResult() || !this.data.resultReportImagePath) return false
    return this.resultReportSignature === this.getResultReportSignature()
  },
  previewResultReportImage() {
    if (!this.canUseCurrentResultReport()) return false
    return resultReportMethods.previewResultReportImage.call(this)
  },
  shareResultReportImage() {
    if (!this.canUseCurrentResultReport()) return false
    return resultReportMethods.shareResultReportImage.call(this)
  },
  saveResultReportImage() {
    if (!this.canUseCurrentResultReport()) return false
    return resultReportMethods.saveResultReportImage.call(this)
  },
  copyResult() {
    if (!this.hasCurrentOperationResult()) return
    const resultText = this.getResultText()
    if (!resultText) return
    vibrate('medium')
    wx.setClipboardData({ data: resultText })
  },
  toggleCurrentFavorite() {
    if (!this.getOperationSnapshot() && this.hasCurrentOperationResult()) togglePageFavorite(this)
  },
  saveToActiveProject() {
    if (this.getOperationSnapshot() || !this.hasCurrentOperationResult()) return
    const result = this.data.result
    const guard = captureOperationResult(this, result)
    if (!guard) return
    return addPageToActiveProject(this, () => !this.getOperationSnapshot()
      && this.data.result === result && isOperationResultCurrent(this, guard))
  },
})

finishCameraModuleLoad({ sourceModels: cameras.length, selectableModels: selectableCameras.length })

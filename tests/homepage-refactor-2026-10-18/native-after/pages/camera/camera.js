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
  cancelCameraReportUi,
  createCameraReportUiData,
  createCameraReportUiMethods,
} = require('./camera-report-ui')
const { createCameraReportMethods } = require('./camera-report')
const {
  requestEditorLeave,
  saveEditorRecord: saveEditorRecordAction,
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')
const { attachResultEditor, captureEditorBaseline, createEditorNavigationMethods, finalizeResultEditor } = require('../../utils/result-record-context')
const { adaptCanvas2dContext, drawPreviewAtSize: renderPreviewAtSize } = require('./preview-renderer')
const { createCameraProjectData, createCameraProjectMethods } = require('./camera-project')

const PREFERENCE_KEY = 'audioTool.camera.preferences'
const DEFAULT_MODEL = 'TV-6124HK'
const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 500
function getCurrentTheme() {
  try {
    const appInfo = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : null
    if (appInfo?.theme === 'light' || appInfo?.theme === 'dark') return appInfo.theme
  } catch (error) {}
  try {
    const systemInfo = typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null
    if (systemInfo?.theme === 'light' || systemInfo?.theme === 'dark') return systemInfo.theme
  } catch (error) {}
  return 'light'
}
const DEFAULT_CAMERA_INPUTS = {
  customHorizontalFovText: '60',
  customVerticalFovText: '36',
  customSensorWidthText: '6.4',
  customSensorHeightText: '3.6',
  customFocalLengthText: '4.5',
  groundWidthText: '6',
  groundDepthText: '4',
  subjectHeightText: '1.8',
  planeWidthText: '6',
  planeHeightText: '2.5',
  planeBottomHeightText: '0.8',
  fixedCameraHeightText: '2.3',
}
const CLEARED_CAMERA_INPUTS = Object.fromEntries(
  Object.keys(DEFAULT_CAMERA_INPUTS).map((field) => [field, '']),
)
const CAMERA_INPUT_TABS = [
  { value: 'camera', label: '相机与镜头' },
  { value: 'target', label: '目标区域' },
  { value: 'install', label: '安装设置' },
]
const PREVIEW_VIEW_OPTIONS = [
  { value: 'spatial', label: '三维示意' },
]
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
const resultReportBaseMethods = createResultReportMethods({
  performancePrefix: '摄像机',
  emptyToast: '暂无可生成的安装结果',
})
const cameraReportBaseMethods = createCameraReportMethods(resultReportBaseMethods)
const resultReportMethods = createCameraReportUiMethods(cameraReportBaseMethods)
const cameraProjectMethods = createCameraProjectMethods()

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

const CAMERA_INPUT_FIELDS = {
  customHorizontalFovText: ['horizontalFov', 'deg'],
  customVerticalFovText: ['verticalFov', 'deg'],
  groundWidthText: ['widthMeters', 'm'],
  groundDepthText: ['depthMeters', 'm'],
  subjectHeightText: ['subjectHeightMeters', 'm'],
  fixedCameraHeightText: ['cameraHeightMeters', 'm'],
}

function buildCameraOptions() {
  return selectableCameras.map((camera, index) => ({
    model: camera.model,
    category: camera.category,
    sensor: camera.sensor,
    opticsLines: buildCameraOpticsLines(camera),
    index,
  }))
}

function buildSelectedCamera(camera) {
  return camera
    ? { model: camera.model, category: camera.category, sensor: camera.sensor }
    : { model: '', category: '', sensor: '' }
}

function validAngle(value) {
  return Number.isFinite(value) && value > 0 && value < 179
}

function validPositiveInput(value) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return false
  const number = Number(value)
  return Number.isFinite(number) && number > 0
}

function formatManufacturerAngle(value) {
  const angle = Number(value)
  return validAngle(angle) ? `${formatNumber(angle)}°` : '未提供'
}

function buildOpticsLine(view) {
  const horizontal = Number(view.hWide)
  const vertical = Number(view.vWide)
  const hasHorizontal = validAngle(horizontal)
  const hasVertical = validAngle(vertical)
  const integrity = hasHorizontal && hasVertical
    ? '参数完整'
    : hasHorizontal
      ? '缺垂直角，仅水平预估'
      : '角度不完整'
  const endpointLabel = validAngle(Number(view.hTele)) ? '广角端' : '固定视角'
  return `${view.label} · ${endpointLabel}：厂家水平 ${formatManufacturerAngle(horizontal)} / 垂直 ${formatManufacturerAngle(vertical)} · ${integrity}`
}

function buildCameraOpticsLines(camera) {
  return camera.views.map((view) => buildOpticsLine(view))
}

function buildSelectedOpticsLines(camera, viewIndex) {
  const view = camera?.views?.[viewIndex]
  if (!view) return []
  return [buildOpticsLine(view)]
}

function validateCameraInputs(state) {
  const errors = {}
  const positive = (key, label) => {
    if (!validPositiveInput(state[key])) errors[key] = `${label}须为大于 0 的有效数值。`
  }

  if (state.sceneModes[state.sceneModeIndex].value === 'ground') {
    positive('groundWidthText', '区域宽度')
    positive('groundDepthText', '区域纵深')
    positive('subjectHeightText', '人物最高点')
  } else {
    positive('planeWidthText', '目标宽度')
    positive('planeHeightText', '目标高度')
    const rawBottom = state.planeBottomHeightText
    const bottom = typeof rawBottom === 'string' && !rawBottom.trim() ? NaN : Number(rawBottom)
    if (!Number.isFinite(bottom) || bottom < 0) errors.planeBottomHeightText = '底边离地须为大于或等于 0 的有效数值。'
  }

  if (state.heightModes[state.heightModeIndex].value === 'fixed') {
    positive('fixedCameraHeightText', '镜头中心高度')
  }
  return errors
}

function isCameraInputFieldActive(field, state) {
  if (['customHorizontalFovText', 'customVerticalFovText', 'customSensorWidthText', 'customSensorHeightText', 'customFocalLengthText'].includes(field)) return false
  if (['groundWidthText', 'groundDepthText', 'subjectHeightText'].includes(field)) {
    return state.sceneModes[state.sceneModeIndex].value === 'ground'
  }
  if (['planeWidthText', 'planeHeightText', 'planeBottomHeightText'].includes(field)) {
    return state.sceneModes[state.sceneModeIndex].value === 'plane'
  }
  if (field === 'fixedCameraHeightText') {
    return state.heightModes[state.heightModeIndex].value === 'fixed'
  }
  return true
}

function clearAppliedInputValues(page, values) {
  if (!values || !page._pendingInputValues) return
  Object.keys(values).forEach((field) => {
    if (page._pendingInputValues[field] === values[field]) delete page._pendingInputValues[field]
  })
}

function bumpCameraInputRevision(page) {
  page._inputRevision = (Number(page._inputRevision) || 0) + 1
  return page._inputRevision
}

function bumpCameraResetEpoch(page) {
  page._cameraResetEpoch = (Number(page._cameraResetEpoch) || 0) + 1
  return page._cameraResetEpoch
}

function clearCameraResultReport(page) {
  cancelCameraReportUi(page)
  const reportChanges = resetStaleResultReport(page, null)
  if (!Object.keys(reportChanges).length) cancelResultReportGeneration(page)
  page.resultReportSignature = ''
  page.resultReportPendingSignature = ''
  return {
    ...reportChanges,
    resultReportImagePath: '',
    resultReportPreviewVisible: false,
    isGeneratingResultReport: false,
  }
}

function resetCameraResultReportIfStale(page, record) {
  const signature = page.resultReportPendingSignature || page.resultReportSignature
  if (!signature || signature === page.getResultReportSignature(record)) return {}
  return resetStaleResultReport(page, null)
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

function buildDefaultCameraState() {
  const cameraIndex = findCameraIndex(DEFAULT_MODEL)
  const camera = selectableCameras[cameraIndex]
  return {
    sourceModeIndex: 0,
    cameraIndex,
    selectedCamera: buildSelectedCamera(camera),
    selectedOpticsLines: buildSelectedOpticsLines(camera, 0),
    cameraCount: selectableCameras.length,
    viewOptions: buildViewOptions(camera),
    viewIndex: 0,
    selectedMountLabel: camera.views[0].mountLabel,
    definitionModeIndex: 0,
    customMountTypeIndex: 0,
    ...DEFAULT_CAMERA_INPUTS,
    sceneModeIndex: 0,
    heightModeIndex: 0,
    marginIndex: 2,
    cameraCalculationVersion: 2,
  }
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function buildCalculationProcess(result) {
  if (result.framingVersion === 2) {
    return {
      rows: [
        { title: '确定真实目标边界', formula: '场地纵深保持输入值，投影目标各角点到相机取景截面',
          substitution: `宽 ${result.widthMeters} m，${result.sceneMode === 'ground' ? `纵深 ${result.depthMeters} m` : `高 ${result.heightMeters} m`}`,
          value: '使用镜头中心与俯仰基底' },
        { title: '加入取景余量', formula: '投影包络总宽、总高分别 × (1 + 余量)，两侧均分',
          substitution: `1 + ${result.marginPercent}%`, value: `每侧 ${result.marginPercent / 2}%` },
        { title: '求解前沿退距', formula: result.horizontalOnly ? '扩张后的水平投影包络不超过镜头水平视场角'
          : '扩张后的水平、垂直投影包络同时位于镜头视场角内',
          substitution: `水平 ${result.horizontalFov}°${result.horizontalOnly ? '；垂直未校核' : `，垂直 ${result.verticalFov}°`}`,
          value: `${result.primaryDistanceMeters} m` },
      ],
      conclusion: result.horizontalOnly ? `仅水平参考 ${result.primaryDistanceMeters} m，垂直覆盖未校核。`
        : `相机坐标下双轴包络校核通过，理论最小前沿退距 ${result.primaryDistanceMeters} m；场地纵深未增加。`,
      visual: { horizontalBarPercent: 100, verticalBarPercent: result.horizontalOnly ? 0 : 100,
        limitingDistanceMeters: formatNumber(result.calculationDistanceMeters), limitingAxisLabel: result.distanceConstraintText,
        hasDepthMargin: false, depthMarginMeters: 0 },
    }
  }
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

function addCameraDisplayMetadata(result, { sceneMode, heightMode, opticsSourceLabel, isWide = false }) {
  const ground = sceneMode === 'ground'
  Object.assign(result, {
    heightMode,
    heightDisplayLabel: heightMode === 'fixed'
      ? (result.horizontalOnly ? '已有镜头中心高度 · 仅水平参考' : '已有镜头中心高度')
      : (result.horizontalOnly ? '建议镜头中心高度 · 仅水平参考' : '建议镜头中心高度'),
    heightBasisDisplay: heightMode === 'fixed'
      ? '沿用已填写高度'
      : ground ? '最高点 + 0.5 m，且不低于 1.5 m' : '与目标中心等高',
    distanceStartLabel: '镜头中心',
    distanceEndLabel: ground ? '拍摄区前沿' : '目标平面',
    distanceReferenceText: ground ? '镜头中心至拍摄区实际前沿（水平）' : '镜头中心至目标平面（水平）',
    resultNatureText: result.horizontalOnly
      ? '仅为水平方向参考距离；垂直覆盖尚未校核。'
      : result.framingVersion === 2
        ? '按理想镜头模型在相机坐标下校核目标各角点及取景余量的理论最小距离；未计遮挡和镜头畸变。'
        : '按独立水平与垂直视场角模型估算的理论最小距离；该二维校核不等于真实三维视锥逐方向验证，且未计遮挡。',
    opticsIntegrityText: result.horizontalOnly
      ? `${opticsSourceLabel}水平角 ${formatNumber(result.horizontalFov)}°；垂直角未提供`
      : `${opticsSourceLabel}水平角 ${formatNumber(result.horizontalFov)}° / 垂直角 ${formatNumber(result.verticalFov)}°；参数完整`,
    isWideEndpoint: isWide,
    ...(ground ? {} : {
      targetTopHeightDisplay: formatNumber(Number(result.bottomHeightMeters) + Number(result.heightMeters)),
    }),
  })
}

function addCameraMountGuidance(result) {
  if (result.mountType === 'ptz') {
    result.requiresInitialAim = false
    result.aimValue = '现场可调'
    result.aimLabel = '机械云台水平与俯仰'
    result.mountGuidanceText = '机械云台可在现场调整水平与俯仰；示意角度不作为固定安装要求。'
    return result
  }
  if (result.mountType === 'unspecified') {
    result.requiresInitialAim = false
    result.aimValue = '待现场确认'
    result.aimLabel = '安装方式待确认'
    result.mountGuidanceText = '安装结构待现场确认；暂不判断是否可转向或需要固定初始角度。'
    return result
  }
  result.requiresInitialAim = true
  result.aimValue = result.aimText
  result.aimLabel = '固定安装初始俯仰角参考'
  result.mountGuidanceText = result.mountType === 'eptz'
    ? `电子云台为固定安装，初始俯仰参考 ${result.aimText}；安装时需现场调整本体朝向并用实际画面复核，电子裁切不能替代物理转向。`
    : `固定式/枪机初始俯仰参考 ${result.aimText}；安装时需现场调整本体朝向并用实际画面复核。`
  return result
}

Page({
  ...createEditorNavigationMethods(),
  data: {
    inputTabs: CAMERA_INPUT_TABS,
    inputTabIndex: 0,
    previewViewOptions: PREVIEW_VIEW_OPTIONS,
    previewViewIndex: 0,
    resultUpdating: false,
    resultZoneReserved: false,
    theme: 'light',
    resultPlaceholderStyle: 'min-height:240rpx;',
    resultEmptyText: '正在读取摄像机参数…',
    sourceModeIndex: 0,
    legacyCustomUnsupported: false,
    operationUnsupportedMessage: '',
    cameraIndex: findCameraIndex(DEFAULT_MODEL),
    selectedCamera: buildSelectedCamera(selectableCameras[findCameraIndex(DEFAULT_MODEL)]),
    selectedOpticsLines: buildSelectedOpticsLines(selectableCameras[findCameraIndex(DEFAULT_MODEL)], 0),
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
    inputErrors: {},
    currentFavorite: false,
    selectorVisible: false,
    selectorKeyword: '',
    selectorItems: [],
    operationSnapshot: null,
    operationActive: false,
    ...createResultReportData(),
    ...createCameraReportUiData(),
    ...createCameraProjectData(),
  },

  onLoad(options = {}) {
    attachResultEditor(this, 'camera', options)
    const finishInitialization = startMeasurement('摄像机/初始化总耗时')
    this._pageVisible = false
    this._cameraUnloaded = false
    this._themeChangeHandler = ({ theme } = {}) => this.onThemeChange({ theme })
    if (typeof wx.onThemeChange === 'function') wx.onThemeChange(this._themeChangeHandler)
    const preferences = readPreferences(PREFERENCE_KEY)
    const legacyCustomUnsupported = preferences.sourceMode === 'custom'
    const cameraIndex = findCameraIndex(preferences.cameraModel || DEFAULT_MODEL)
    const camera = selectableCameras[cameraIndex]
    const rawViewIndex = Number(preferences.viewIndex)
    const viewIndex = Number.isFinite(rawViewIndex) && Number.isInteger(rawViewIndex) && rawViewIndex >= 0
      ? Math.min(rawViewIndex, camera.views.length - 1)
      : 0
    const restoredState = {
      cameraCalculationVersion: preferences.cameraCalculationVersion === 1 ? 1 : 2,
      theme: getCurrentTheme(),
      sourceModeIndex: 0,
      cameraIndex,
      selectedCamera: buildSelectedCamera(camera),
      selectedOpticsLines: buildSelectedOpticsLines(camera, viewIndex),
      viewOptions: buildViewOptions(camera),
      viewIndex,
      selectedMountLabel: camera.views[viewIndex].mountLabel,
      definitionModeIndex: preferences.definitionMode === 'sensor' ? 1 : 0,
      customMountTypeIndex: preferences.customMountType === 'fixed' ? 1 : 0,
      customHorizontalFovText: preferences.customHorizontalFovText ?? '60',
      customVerticalFovText: preferences.customVerticalFovText ?? '36',
      customSensorWidthText: preferences.customSensorWidthText ?? '6.4',
      customSensorHeightText: preferences.customSensorHeightText ?? '3.6',
      customFocalLengthText: preferences.customFocalLengthText ?? '4.5',
      sceneModeIndex: preferences.sceneMode === 'plane' ? 1 : 0,
      heightModeIndex: preferences.heightMode === 'fixed' ? 1 : 0,
      marginIndex: findValueIndex(
        this.data.marginOptions,
        preferences.marginPercent === undefined ? 10 : Number(preferences.marginPercent),
      ),
      groundWidthText: preferences.groundWidthText ?? '6',
      groundDepthText: preferences.groundDepthText ?? '4',
      subjectHeightText: preferences.subjectHeightText ?? '1.8',
      planeWidthText: preferences.planeWidthText ?? '6',
      planeHeightText: preferences.planeHeightText ?? '2.5',
      planeBottomHeightText: preferences.planeBottomHeightText ?? '0.8',
      fixedCameraHeightText: preferences.fixedCameraHeightText ?? '2.3',
      inputTabIndex: 0,
      previewViewIndex: 0,
      result: null,
      resultUpdating: false,
      operationUnsupportedMessage: '',
    }
    if (legacyCustomUnsupported) {
      this.setData({
        ...restoredState,
        legacyCustomUnsupported: true,
        resultZoneReserved: false,
        inputErrors: {},
        calculationError: '',
        resultEmptyText: '此旧自定义配置在仅库内版本无法计算。请显式选择库内型号或重置；已保存的收藏和项目记录会保留。',
        currentFavorite: false,
      }, () => {
        captureEditorBaseline(this)
        finishInitialization({ model: 'legacy-custom-unsupported' })
      })
      return
    }
    const hasClearedInputs = Object.keys(CLEARED_CAMERA_INPUTS)
      .every((field) => preferences[field] === '')
    if (hasClearedInputs) {
      this.setData({
        ...restoredState,
        result: null,
        resultUpdating: false,
        resultZoneReserved: false,
        currentFavorite: false,
        inputErrors: {},
        calculationError: '',
        resultEmptyText: '',
      }, () => {
        captureEditorBaseline(this)
        finishInitialization({ model: camera.model, empty: true })
      })
      return
    }
    this.commitCalculatedState(restoredState, () => {
      captureEditorBaseline(this)
      finishInitialization({ model: camera.model })
    })
  },

  saveEditorContext(event) {
    return saveEditorRecordAction(this, event?.currentTarget?.dataset?.saveAs === 'true')
  },

  leaveEditorContext() {
    return requestEditorLeave(this)
  },

  onShow() {
    this._pageVisibilityRevision = (this._pageVisibilityRevision || 0) + 1
    this._pageVisible = true
    if (this.data.result) syncPageFavorite(this)
    const refreshVisibleResult = () => {
      if (this._cameraUnloaded || !this._pageVisible || !this.data.result) return
      this.captureResultHeroHeight()
      this.drawPreview()
    }
    const theme = getCurrentTheme()
    if (theme === this.data.theme) refreshVisibleResult()
    else this.setData({ theme, ...clearCameraResultReport(this) }, refreshVisibleResult)
  },
  onThemeChange({ theme } = {}) {
    if (this._cameraUnloaded) return
    const nextTheme = theme === 'dark' ? 'dark' : 'light'
    if (nextTheme === this.data.theme) return
    this.setData({ theme: nextTheme, ...clearCameraResultReport(this) }, () => {
      if (!this._cameraUnloaded && this._pageVisible && this.data.result) this.drawPreview()
    })
  },
  onHide() {
    this._pageVisibilityRevision = (this._pageVisibilityRevision || 0) + 1
    this._pageVisible = false
    this.cancelCameraProjectForHide()
    cancelResultReportGeneration(this)
    cancelCameraReportUi(this)
    this.invalidatePreviewCanvas({ keepCache: true })
    this.flushPendingCalculation()
  },
  onUnload() {
    disposeOperation(this)
    if (this._cameraUnloaded) return
    this._cameraUnloaded = true
    this._pageVisibilityRevision = (this._pageVisibilityRevision || 0) + 1
    this._pageVisible = false
    this.cancelCameraProjectForHide()
    this.invalidatePreviewCanvas()
    this.cancelPendingCalculation()
    cancelResultReportGeneration(this)
    cancelCameraReportUi(this)
    if (this._themeChangeHandler && typeof wx.offThemeChange === 'function') {
      wx.offThemeChange(this._themeChangeHandler)
    }
    this._themeChangeHandler = null
    printPerformanceSummary('摄像机/')
    finalizeResultEditor(this)
  },

  ...cameraOperationMethods,
  ...cameraProjectMethods,

  beginStructuredOperation() {
    const message = '当前仅支持库内摄像机；按角度发起的旧操作不可用，请选择库内型号。'
    return this.rejectStructuredOperation(message)
  },

  rejectStructuredOperation(message = '当前仅支持库内摄像机；按角度发起的旧操作不可用，请选择库内型号。') {
    if (this._cameraUnloaded) return Object.freeze({ active: false, ready: false, status: 'unsupported', error: message })
    this.cancelPendingCalculation()
    this._pendingInputValues = {}
    this.invalidatePreviewCanvas()
    const resultReportChanges = clearCameraResultReport(this)
    if (this.getOperationSnapshot()) cameraOperationMethods.endStructuredOperation.call(this)
    this.setData({
      result: null,
      resultUpdating: false,
      resultZoneReserved: Boolean(this.data.resultZoneReserved || this.data.result),
      resultEmptyText: '',
      calculationError: message,
      operationUnsupportedMessage: message,
      currentFavorite: false,
      inputErrors: {},
      operationSnapshot: null,
      operationActive: false,
      ...resultReportChanges,
    })
    return Object.freeze({ active: false, ready: false, status: 'unsupported', error: message,
      blockers: Object.freeze([]), fields: Object.freeze([]) })
  },

  endOperation() {
    if (this.getOperationSnapshot()) return this.rejectStructuredOperation()
    return null
  },

  onOperationStateChange(snapshot) {
    if (this._cameraUnloaded) return
    if (snapshot) {
      this.rejectStructuredOperation()
      return
    }
    this.setData({ operationSnapshot: null, operationActive: false })
  },

  onOperationInvalidate(reason) {
    bumpCameraInputRevision(this)
    this.cancelPendingCalculation()
    this.invalidatePreviewCanvas()
    cancelResultReportGeneration(this)
    cancelCameraReportUi(this)
    this.resultReportSignature = ''
    this.resultReportPendingSignature = ''
    this.setData({
      result: null,
      resultUpdating: false,
      resultEmptyText: reason === 'end' ? '本次操作已结束，请输入当前安装条件。' : '本次输入已变化，请重新确认后计算。',
      currentFavorite: false,
      inputErrors: {},
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
    if (this._pageVisible) {
      this.captureResultHeroHeight()
      this.drawPreview()
      if (this.data.resultReportPreviewVisible) this.updateResultReportPreviewLayout()
    }
  },

  onSceneModeTap(event) {
    if (this.data.legacyCustomUnsupported) return
    const sceneModeIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(sceneModeIndex) || sceneModeIndex === this.data.sceneModeIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-scene-changed')
    this.commitCalculatedState({ sceneModeIndex })
  },

  onHeightModeTap(event) {
    if (this.data.legacyCustomUnsupported) return
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
    if (this.data.legacyCustomUnsupported) return
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

  onInputTabTap(event) {
    const inputTabIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(inputTabIndex) || inputTabIndex < 0
      || inputTabIndex >= this.data.inputTabs.length || inputTabIndex === this.data.inputTabIndex) return
    vibrate('light')
    this.setData({ inputTabIndex })
  },

  onPreviewViewTap(event) {
    if (this.data.legacyCustomUnsupported) return
    const previewViewIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(previewViewIndex) || previewViewIndex < 0
      || previewViewIndex >= this.data.previewViewOptions.length
      || previewViewIndex === this.data.previewViewIndex) return
    vibrate('light')
    this.setData({ previewViewIndex }, () => {
      if (this.data.resultUpdating) return
      this.captureResultHeroHeight()
      this.drawPreview()
    })
  },

  resetToDefaults() {
    if (this._cameraUnloaded || this.getOperationSnapshot()) return false
    vibrate('light')
    bumpCameraResetEpoch(this)
    this.cancelPendingCalculation()
    bumpCameraInputRevision(this)
    this._pendingInputValues = {}
    this.invalidatePreviewCanvas()
    this.cancelCameraProjectForHide()
    clearCameraResultReport(this)

    const resetState = { ...buildDefaultCameraState(), ...CLEARED_CAMERA_INPUTS }
    writePreferences(PREFERENCE_KEY, this.getPreferences({ ...this.data, ...resetState }))
    this.setData({
      ...resetState,
      inputTabIndex: 0,
      previewViewIndex: 0,
      legacyCustomUnsupported: false,
      operationUnsupportedMessage: '',
      selectorVisible: false,
      selectorKeyword: '',
      selectorItems: [],
      result: null,
      resultUpdating: false,
      resultZoneReserved: false,
      currentFavorite: false,
      inputErrors: {},
      calculationError: '',
      resultEmptyText: '',
      resultReportImagePath: '',
      resultReportPreviewVisible: false,
      isGeneratingResultReport: false,
      resultReportCanvasHeight: 1250,
      operationSnapshot: null,
      operationActive: false,
      projectDialogVisible: false,
      projectDialogClosing: false,
      projectDialogRevision: this._cameraProjectRevision,
      projectSaving: false,
    })
    return true
  },
  onViewTap(event) {
    if (this.data.legacyCustomUnsupported) return
    const viewIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(viewIndex) || viewIndex === this.data.viewIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-model-view-changed')
    this.commitCalculatedState({
      viewIndex,
      selectedMountLabel: selectableCameras[this.data.cameraIndex].views[viewIndex].mountLabel,
      selectedOpticsLines: buildSelectedOpticsLines(selectableCameras[this.data.cameraIndex], viewIndex),
    })
  },

  onFieldInput(event) {
    if (this._cameraUnloaded || this.data.legacyCustomUnsupported) return
    bumpCameraInputRevision(this)
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    const snapshot = this.getOperationSnapshot()
    this._pendingInputValues = { ...(this._pendingInputValues || {}), [field]: value }
    if (snapshot?.active) {
      this.setData({ [field]: value, inputErrors: {} })
      const operationField = CAMERA_INPUT_FIELDS[field]
      if (operationField) this.setOperationCandidate(operationField[0], Number(value), operationField[1])
      else invalidateOperation(this, 'camera-optics-changed')
      return
    }
    if (snapshot) {
      this.setData({ [field]: value })
      return
    }
    const state = { ...this.data, ...this._pendingInputValues }
    if (!isCameraInputFieldActive(field, state)) {
      this.setData({ [field]: value })
      return
    }
    const inputErrors = validateCameraInputs(state)
    if (Object.keys(inputErrors).length) {
      this.cancelPendingCalculation()
      this.invalidatePreviewCanvas()
      const resultReportChanges = clearCameraResultReport(this)
      this.setData({
        [field]: value,
        inputErrors,
        calculationError: '',
        operationUnsupportedMessage: '',
        result: null,
        resultUpdating: false,
        resultZoneReserved: Boolean(this.data.resultZoneReserved || this.data.result),
        resultEmptyText: '请检查高亮输入项，修正后会重新计算。',
        currentFavorite: false,
        ...resultReportChanges,
      })
      return
    }
    const resultReportChanges = clearCameraResultReport(this)
    this.setData({
      [field]: value,
      inputErrors: {},
      calculationError: '',
      operationUnsupportedMessage: '',
      resultUpdating: Boolean(this.data.result),
      resultEmptyText: '正在更新安装建议…',
      ...resultReportChanges,
    })
    this.scheduleCalculation()
  },

  onFieldBlur() { if (!this.data.legacyCustomUnsupported) this.flushPendingCalculation() },

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

  runAfterPendingCalculation(callback) {
    if (this._cameraUnloaded || typeof callback !== 'function') return
    const visibilityRevision = this._pageVisibilityRevision || 0
    const resetEpoch = this._cameraResetEpoch || 0
    const runIfCurrent = () => {
      if (this._cameraUnloaded || this._pageVisible === false
        || visibilityRevision !== (this._pageVisibilityRevision || 0)
        || resetEpoch !== (this._cameraResetEpoch || 0)) return
      callback()
    }
    if (this._calculationTimer) {
      this.flushPendingCalculation(runIfCurrent)
      return
    }
    if (this.data.resultUpdating) {
      this.commitCalculatedState({}, runIfCurrent)
      return
    }
    runIfCurrent()
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
    if (!camera) return
    if (cameraIndex !== this.data.cameraIndex) vibrate('light')
    if (this.getOperationSnapshot()?.active) invalidateOperation(this, 'camera-model-changed')
    this._persistLegacyUnlock = Boolean(this.data.legacyCustomUnsupported)
    this._explicitLibrarySelection = true
    try {
      this.commitCalculatedState({
        sourceModeIndex: 0,
        legacyCustomUnsupported: false,
        operationUnsupportedMessage: '',
        cameraIndex,
        selectedOpticsLines: buildSelectedOpticsLines(camera, 0),
        viewOptions: buildViewOptions(camera),
        viewIndex: 0,
        selectedMountLabel: camera.views[0].mountLabel,
        selectorVisible: false,
      })
    } finally {
      this._explicitLibrarySelection = false
      this._persistLegacyUnlock = false
    }
  },

  getFovDefinition(state = this.data) {
    if (state.sourceModeIndex !== 0) return null
    return resolveLibraryOptics(
      selectableCameras[state.cameraIndex],
      state.viewIndex,
      'wide',
    )
  },

  calculate(afterCommit) {
    return this.commitCalculatedState(this._pendingInputValues || {}, afterCommit)
  },

  commitStructuredCalculatedState() {
    this.rejectStructuredOperation()
    return null
  },

  commitCalculatedState(changes = {}, afterCommit) {
    const finishCalculation = startMeasurement('摄像机/计算到结果更新')
    this.cancelPendingCalculation()
    bumpCameraInputRevision(this)
    if (this._cameraUnloaded) {
      finishCalculation({ success: false, reason: 'unloaded' })
      return null
    }
    if (this.data.legacyCustomUnsupported && !this._explicitLibrarySelection) {
      finishCalculation({ success: false, reason: 'legacy-custom-unsupported' })
      return null
    }
    const requestedSourceMode = changes.sourceModeIndex === undefined ? this.data.sourceModeIndex : changes.sourceModeIndex
    if (requestedSourceMode !== 0) {
      finishCalculation({ success: false, reason: 'unsupported-source-mode' })
      return null
    }
    const operation = prepareOperation(this)
    if (operation.disposed) {
      finishCalculation({ success: false, reason: 'disposed-operation' })
      return null
    }
    if (operation.structured) {
      this.commitStructuredCalculatedState(operation)
      finishCalculation({ success: false, reason: 'unsupported-structured-operation' })
      return null
    }
    const appliedInputValues = { ...(this._pendingInputValues || {}) }
    const calculatedChanges = { ...appliedInputValues, ...changes }
    // A restored v1 record stays on its original formula until an input is
    // edited. Merely opening, theming or exporting it must not recalculate v2.
    if (!Object.prototype.hasOwnProperty.call(changes, 'cameraCalculationVersion')
      && Object.keys(calculatedChanges).some((key) => key.endsWith('Text')
        || ['cameraIndex', 'viewIndex', 'sceneModeIndex', 'heightModeIndex', 'marginIndex'].includes(key))) {
      calculatedChanges.cameraCalculationVersion = 2
    }
    const state = { ...this.data, ...calculatedChanges }
    const selectedCamera = buildSelectedCamera(selectableCameras[state.cameraIndex])
    const inputErrors = validateCameraInputs(state)
    if (Object.keys(inputErrors).length) {
      this.invalidatePreviewCanvas()
      const resultReportChanges = clearCameraResultReport(this)
      this.setData({
        ...calculatedChanges,
        selectedCamera,
        result: null,
        resultUpdating: false,
        resultZoneReserved: Boolean(this.data.resultZoneReserved || this.data.result),
        resultEmptyText: '请检查高亮输入项，修正后会重新计算。',
        currentFavorite: false,
        operationUnsupportedMessage: '',
        inputErrors,
        calculationError: '',
        ...resultReportChanges,
      }, () => {
        clearAppliedInputValues(this, appliedInputValues)
        if (afterCommit) afterCommit()
      })
      if (this._persistLegacyUnlock) writePreferences(PREFERENCE_KEY, this.getPreferences(state))
      return null
    }
    const fov = this.getFovDefinition(state)
    const heightMode = state.heightModes[state.heightModeIndex].value
    const marginRatio = state.marginOptions[state.marginIndex] / 100
    const sceneMode = state.sceneModes[state.sceneModeIndex].value
    const groundOptions = {
      calculationVersion: state.cameraCalculationVersion,
      widthMeters: Number(state.groundWidthText),
      depthMeters: Number(state.groundDepthText),
      subjectHeightMeters: Number(state.subjectHeightText),
      heightMode,
      cameraHeightMeters: Number(state.fixedCameraHeightText),
      marginRatio,
    }
    const planeOptions = {
      calculationVersion: state.cameraCalculationVersion,
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
      this.invalidatePreviewCanvas()
      const resultReportChanges = clearCameraResultReport(this)
      const finishViewUpdate = startMeasurement('摄像机/setData视图更新', { success: false })
      this.setData({
        ...calculatedChanges,
        selectedCamera,
        result: null,
        resultUpdating: false,
        resultZoneReserved: Boolean(this.data.resultZoneReserved || this.data.result),
        inputErrors: {},
        resultEmptyText: '',
        operationUnsupportedMessage: '',
        ...resultReportChanges,
        calculationError: !fov
          ? '请选择资料库中提供水平视场角的摄像机型号。'
          : '请检查区域尺寸、人物高度、底边高度和固定安装高度，所有必填尺寸均需有效。',
      }, () => {
        clearAppliedInputValues(this, appliedInputValues)
        finishViewUpdate()
        finishCalculation({ success: false })
        if (afterCommit) afterCommit()
      })
      if (this._persistLegacyUnlock) writePreferences(PREFERENCE_KEY, this.getPreferences(state))
      return
    }

    const camera = selectableCameras[state.cameraIndex]
    const mountType = getCameraMountType(camera, state.viewIndex)
    result.displayModel = camera.model
    result.displayView = fov.view.label
    result.sourceText = `${camera.source}｜参数页 ${camera.sourcePages}`
    result.sourceNote = [camera.note, result.horizontalOnly
      ? '本结果仅使用说明书水平视场角，不推算垂直角，不能作为完整安装距离。'
      : ''].filter(Boolean).join(' ')
    result.endpointLabel = fov.endpointLabel
    result.mountType = mountType
    result.mountLabel = getCameraMountLabel(camera, state.viewIndex)
    result.requiresInitialAim = mountType !== 'ptz'
    result.heightSummary = `${result.horizontalOnly ? '参考' : '建议'}镜头中心高 ${result.cameraHeightMeters} m`
    const opticsSourceLabel = '厂家'
    const isWide = Number(fov.view.hTele) > 0
    result.distanceMeaning = result.horizontalOnly
      ? '水平拍全目标宽度所需最低距离（非完整安装距离）'
      : '当前模型下理论最小距离'
    addCameraDisplayMetadata(result, { sceneMode, heightMode, opticsSourceLabel, isWide })
    addCameraMountGuidance(result)
    result.endpointExplanation = result.horizontalOnly
      ? '说明书缺少垂直视场角；当前只能确认水平方向能否拍全，无法确认目标上下边界是否入画。'
      : isWide
        ? '安装点位统一按广角端计算，确保能够拍全目标区域；长焦端参数仅在产品资料库中保留，用于查阅特写能力。'
      : '该结果按资料库中的当前固定或广角端视场角计算。'
    const calculationProcess = buildCalculationProcess(result)
    result.calculationRows = calculationProcess.rows
    result.calculationConclusion = calculationProcess.conclusion
    result.calculationVisual = calculationProcess.visual
    const pageState = { ...state, result }
    cancelCameraReportUi(this)
    const resultReportChanges = resetCameraResultReportIfStale(
      this,
      this.getRecordPayload(pageState, result),
    )

    const finishViewUpdate = startMeasurement('摄像机/setData视图更新', { success: true })
    const canPaintUpdatedResult = Boolean(this._pageVisible && this._canvasCache)
    if (canPaintUpdatedResult) this.renderPreview(this._canvasCache, 'updated', result)
    this.setData({
      ...calculatedChanges,
      selectedCamera,
      result,
      resultUpdating: false,
      resultZoneReserved: true,
      operationUnsupportedMessage: '',
      inputErrors: {},
      calculationError: '',
      resultEmptyText: '',
      ...resultReportChanges,
    }, () => {
      clearAppliedInputValues(this, appliedInputValues)
      finishViewUpdate()
      this.captureResultHeroHeight()
      if (this._pageVisible) syncPageFavorite(this)
      if (!canPaintUpdatedResult) this.drawPreview()
      finishCalculation({ success: true, horizontalOnly: result.horizontalOnly })
      if (afterCommit) afterCommit()
    })
    writePreferences(PREFERENCE_KEY, this.getPreferences(state))
    return result
  },

  drawPreview() {
    if (!this._pageVisible || !this.data.result || typeof wx.createSelectorQuery !== 'function') return
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
        if (!this._pageVisible || !this.data.result) {
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

  captureResultHeroHeight() {
    if (this._cameraUnloaded || !this.data.result || !this._pageVisible
      || typeof wx.createSelectorQuery !== 'function') return
    const query = wx.createSelectorQuery().in(this)
    if (typeof query.select !== 'function') return
    const selector = query.select('#cameraResultHero')
    if (!selector || typeof selector.boundingClientRect !== 'function') return
    const revision = (this._resultHeroHeightRevision || 0) + 1
    this._resultHeroHeightRevision = revision
    selector.boundingClientRect((rect) => {
      if (this._cameraUnloaded || revision !== this._resultHeroHeightRevision || !this.data.result) return
      const height = Number(rect?.height)
      if (!Number.isFinite(height) || height <= 0) return
      const roundedHeight = Math.ceil(height)
      this._lastResultHeroHeightPx = roundedHeight
      const resultPlaceholderStyle = `min-height:${roundedHeight}px;`
      if (this.data.resultPlaceholderStyle !== resultPlaceholderStyle) this.setData({ resultPlaceholderStyle })
    }).exec()
  },

  renderPreview(canvasCache, source, result = this.data.result) {
    if (!this._pageVisible || !result) return
    const finishCanvasDrawing = startMeasurement('摄像机/Canvas绘制', { source })
    canvasCache.rawContext.clearRect(0, 0, canvasCache.width, canvasCache.height)
    this.drawPreviewAtSize(canvasCache.context, canvasCache.width, canvasCache.height, result)
    finishCanvasDrawing({ width: canvasCache.width, height: canvasCache.height })
  },

  drawPreviewAtSize(context, width, height, result = this.data.result) {
    renderPreviewAtSize(context, result, width, height, 'spatial', this.data.theme)
  },

  invalidatePreviewCanvas({ keepCache = false } = {}) {
    this._canvasRevision = (this._canvasRevision || 0) + 1
    this._canvasQueryPending = false
    if (!keepCache) this._canvasCache = null
  },

  getPreferences(state = this.data) {
    const camera = selectableCameras[state.cameraIndex]
    return {
      ...(state.cameraCalculationVersion === 1 ? {} : { cameraCalculationVersion: 2 }),
      sourceMode: 'library',
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

  getEditorPreferences(state = this.data) {
    return this.getPreferences(state)
  },

  getOperationPreferences() {
    return null
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
          ? `${result.framingVersion === 2 ? '镜头法向截面水平宽度' : '理论水平画面宽度'}：${result.frameWidthMeters} m；垂直范围未校核`
          : `${result.framingVersion === 2 ? '镜头法向取景截面' : '理论画面范围'}：宽 ${result.frameWidthMeters} m × 高 ${result.frameHeightMeters} m`,
      ]
    return [
      `摄像机安装反算｜${result.sceneLabel}`,
      `结果性质：${result.horizontalOnly ? '仅水平覆盖预估，非完整安装距离' : '当前模型双轴校核通过的理论最小距离'}`,
      `摄像机：${result.displayModel}｜${result.displayView}｜${result.endpointLabel}`,
      `镜头端点说明：${result.endpointExplanation}`,
      ...sceneRows,
      `${result.heightDisplayLabel}：${result.cameraHeightMeters} m（${result.heightBasis}）`,
      `安装结构：${result.mountLabel}`,
      `取景方式：${result.mountGuidanceText}`,
      `构图余量：${result.marginPercent}%`,
      `镜头视场角：水平 ${result.horizontalFov}°｜垂直 ${result.horizontalOnly ? '说明书未提供' : `${result.verticalFov}°`}`,
      `目标最低所需视场角：水平 ${result.requiredHorizontalFov}°${result.horizontalOnly ? '｜垂直未校核' : `｜垂直 ${result.requiredVerticalFov}°`}`,
      `距离判定：${result.distanceConstraintText}`,
      '计算过程：',
      ...result.calculationRows.map((row, index) => `${index + 1}. ${row.title}：${row.formula}；代入 ${row.substitution}；结果 ${row.value}`),
      `计算结论：${result.calculationConclusion}`,
      `资料来源：${result.sourceText}`,
      `注：${result.horizontalOnly ? '当前仅校核水平覆盖；' : result.framingVersion === 2 ? '使用理想镜头的相机坐标包络；' : '独立水平/垂直视场角二维校核；'}未计遮挡和镜头畸变，最终安装应通过样机画面复核。`,
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
    if (this._cameraUnloaded || this._pageVisible === false || this.data.legacyCustomUnsupported) return
    if (this._calculationTimer || this.data.resultUpdating) {
      this.runAfterPendingCalculation(() => this.generateResultReportImage())
      return
    }
    if (this.getOperationSnapshot() && !this.hasCurrentOperationResult()) return
    return resultReportMethods.generateResultReportImage.call(this)
  },
  canUseCurrentResultReport() {
    if (this._cameraUnloaded || this._pageVisible === false
      || this.data.resultUpdating || this.data.legacyCustomUnsupported) return false
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
  toggleCurrentFavorite() {
    if (this._cameraUnloaded || this._pageVisible === false || this.data.legacyCustomUnsupported) return
    if (this._calculationTimer || this.data.resultUpdating) {
      this.runAfterPendingCalculation(() => this.toggleCurrentFavorite())
      return
    }
    if (!this.getOperationSnapshot() && this.hasCurrentOperationResult()) togglePageFavorite(this)
  },
  saveToActiveProject() {
    if (this._cameraUnloaded || this._pageVisible === false || this.data.legacyCustomUnsupported) return
    if (this._calculationTimer || this.data.resultUpdating) {
      this.runAfterPendingCalculation(() => this.saveToActiveProject())
      return
    }
    if (this.getOperationSnapshot() || !this.hasCurrentOperationResult()) return
    return this.openCameraProjectDialog()
  },
})

finishCameraModuleLoad({ sourceModels: cameras.length, selectableModels: selectableCameras.length })

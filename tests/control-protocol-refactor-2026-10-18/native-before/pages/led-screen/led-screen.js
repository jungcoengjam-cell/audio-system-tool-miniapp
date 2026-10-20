const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishLedScreenModuleLoad = startMeasurement('LED大屏/脚本加载')
const { calculateLedScreenPlan, LED_PIXEL_PITCHES, LED_UNIT_SPECS, PREFERRED_RATIO_ERROR } = require('../../utils/led-screen')
const { findValueIndex, readPreferences, writePreferences, writePreferencesDetailed } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  createOperationMethods,
  prepareOperation,
  disposeOperation,
  captureOperationResult,
  isOperationResultCurrent,
} = require('../../utils/operation-inputs')
const { syncPageFavorite, togglePageFavorite } = require('../../utils/result-record-actions')
const { getExportDimensions } = require('../../utils/report-drawing')
const {
  previewGeneratedImage,
  saveGeneratedImage,
  shareGeneratedImage,
} = require('../../utils/report-image-actions')
const {
  REPORT_CANVAS_ID,
  REPORT_HEIGHT,
  REPORT_WIDTH,
  buildLedScreenReportLayout,
  buildLedScreenReportPayload,
  drawLedScreenReport,
} = require('./report')
const { createLedProjectData, createLedProjectMethods } = require('./led-project')
const getUnitSpec = (key) => LED_UNIT_SPECS[key] || null

const PREFERENCE_KEY = 'audioTool.ledScreen.preferences'
const INPUT_CALCULATION_DELAY = 160
const DIAGRAM_STAGE_WIDTH_RPX = 628
const DIAGRAM_STAGE_HEIGHT_RPX = 420
const LED_OPERATION_FIELDS = {
  wallWidthMeters: { label: '墙体宽度', unit: 'm', dataKey: 'wallWidthText' },
  wallHeightMeters: { label: '墙体高度', unit: 'm', dataKey: 'wallHeightText' },
  topReserveMeters: { label: '上方预留', unit: 'm', dataKey: 'topReserveText' },
  bottomReserveMeters: { label: '下方预留', unit: 'm', dataKey: 'bottomReserveText' },
  frameWidthCm: { label: '四周包边', unit: 'cm', dataKey: 'frameWidthText' },
  viewingDistanceMeters: { label: '最近观看距离', unit: 'm', dataKey: 'viewingDistanceText' },
  aspectRatioKey: {
    label: '画面比例', unit: 'ratio', dataKey: 'aspectRatioIndex',
    read: (page) => page.data.aspectRatioOptions[page.data.aspectRatioIndex]?.key,
    display: (value) => value,
  },
  unitKey: {
    label: '拼装单元', unit: 'key', dataKey: 'unitIndex',
    read: (page) => page.data.unitOptions[page.data.unitIndex]?.key,
    display: (value) => getUnitSpec(value)?.label || value,
  },
  unitWidthMm: {
    label: '拼装单元宽度', unit: 'mm',
    read: (page) => {
      const snapshot = page.getOperationSnapshot?.()
      const selected = snapshot?.fields.find((field) => field.key === 'unitKey')
      const current = page.data.unitOptions[page.data.unitIndex]?.key
      return selected?.confirmed && selected.value === current ? getUnitSpec(current)?.widthMm : undefined
    },
  },
  unitHeightMm: {
    label: '拼装单元高度', unit: 'mm',
    read: (page) => {
      const snapshot = page.getOperationSnapshot?.()
      const selected = snapshot?.fields.find((field) => field.key === 'unitKey')
      const current = page.data.unitOptions[page.data.unitIndex]?.key
      return selected?.confirmed && selected.value === current ? getUnitSpec(current)?.heightMm : undefined
    },
  },
  pixelPitch: {
    label: '点间距模式/数值', unit: 'pitch', dataKey: 'pitchIndex',
    read: (page) => page.data.pitchOptions[page.data.pitchIndex]?.value,
    display: (value) => value === 'recommended' ? '系统推荐' : `P${value}`,
  },
}
const ledOperationMethods = createOperationMethods({
  id: 'led-screen-layout',
  fields: LED_OPERATION_FIELDS,
  requiredFields: Object.keys(LED_OPERATION_FIELDS),
})

function drawAndExportLedReport(page, options) {
  const {
    canvasId,
    isCurrent,
    width,
    height,
    draw,
    getExportOptions,
    startExportMeasurement,
    onSuccess,
    onFailure,
  } = options
  let settled = false
  let finishExport = () => {}
  const fail = () => {
    if (settled || !isCurrent()) return
    settled = true
    onFailure()
  }
  const recordExportResult = (success) => {
    try {
      finishExport({ success })
      return true
    } catch (error) {
      fail()
      return false
    }
  }

  try {
    const context = wx.createCanvasContext(canvasId, page)
    draw(context)
    context.draw(false, () => {
      if (settled || !isCurrent()) return
      try {
        const exportOptions = getExportOptions()
        finishExport = startExportMeasurement()
        wx.canvasToTempFilePath({
          canvasId,
          width,
          height,
          ...exportOptions,
          fileType: 'png',
          quality: 1,
          success: ({ tempFilePath } = {}) => {
            if (settled || !isCurrent()) return
            if (!recordExportResult(Boolean(tempFilePath))) return
            if (!tempFilePath) return fail()
            settled = true
            onSuccess(tempFilePath)
          },
          fail: () => {
            if (settled || !isCurrent()) return
            if (!recordExportResult(false)) return
            fail()
          },
        }, page)
      } catch (error) {
        recordExportResult(false)
        fail()
      }
    })
  } catch (error) {
    fail()
  }
}
const ledProjectMethods = createLedProjectMethods()

function operationUiState(page, values) {
  const indexOf = (items, value, key) => value === undefined ? -1 : items.findIndex((item) => item[key] === value)
  return {
    wallWidthText: values.wallWidthMeters,
    wallHeightText: values.wallHeightMeters,
    topReserveText: values.topReserveMeters,
    bottomReserveText: values.bottomReserveMeters,
    frameWidthText: values.frameWidthCm,
    viewingDistanceText: values.viewingDistanceMeters,
    aspectRatioIndex: indexOf(page.data.aspectRatioOptions, values.aspectRatioKey, 'key'),
    unitIndex: indexOf(page.data.unitOptions, values.unitKey, 'key'),
    pitchIndex: indexOf(page.data.pitchOptions, values.pixelPitch, 'value'),
  }
}

function finiteInputNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function pageInputFeedback(state, calculationError = '') {
  const fieldErrors = {}
  let inputSuggestion = ''
  const mark = (fields, message, suggestion = '') => {
    fields.forEach((field) => { fieldErrors[field] = message })
    if (!inputSuggestion && suggestion) inputSuggestion = suggestion
  }
  if (!calculationError) return { fieldErrors, inputSuggestion }

  if (calculationError.includes('墙体宽度和高度')) {
    const wallWidth = finiteInputNumber(state.wallWidthText ?? state.wallWidthMeters)
    const wallHeight = finiteInputNumber(state.wallHeightText ?? state.wallHeightMeters)
    if (!(wallWidth > 0)) mark(['wallWidthText'], '请输入大于 0 的墙体宽度。')
    if (!(wallHeight > 0)) mark(['wallHeightText'], '请输入大于 0 的墙体高度。')
  } else if (calculationError.includes('上方预留')) mark(['topReserveText'], '请填写有效的上方预留。')
  else if (calculationError.includes('下方预留')) mark(['bottomReserveText'], '请填写有效的下方预留。')
  else if (calculationError.includes('四周包边')) mark(['frameWidthText'], '请填写有效的每边包边。')
  else if (calculationError.includes('上下预留空间不能')) {
    const topReserve = finiteInputNumber(state.topReserveText ?? state.topReserveMeters)
    const bottomReserve = finiteInputNumber(state.bottomReserveText ?? state.bottomReserveMeters)
    if (topReserve < 0) mark(['topReserveText'], '预留不能小于 0。')
    if (bottomReserve < 0) mark(['bottomReserveText'], '预留不能小于 0。')
  } else if (calculationError.includes('包边尺寸不能')) mark(['frameWidthText'], '包边不能小于 0。')
  else if (calculationError.includes('左右包边尺寸之和')) {
    mark(['wallWidthText'], '需容纳左右包边。')
    mark(['frameWidthText'], '请调小每边包边。', '请调小每边包边，或增大墙宽。')
  } else if (calculationError.includes('上下预留与包边尺寸之和')) {
    mark(['wallHeightText'], '需容纳预留和两侧包边。')
    mark(['topReserveText', 'bottomReserveText'], '请调低预留。')
    mark(['frameWidthText'], '请调小每边包边。', '请调小预留或包边，或增大墙高。')
  } else if (calculationError.includes('最近观看距离')) mark(['viewingDistanceText'], '请输入大于 0 的观看距离。')
  else if (calculationError.includes('画面比例')) mark(['aspectRatioIndex'], '请选择画面比例。')
  else if (calculationError.includes('模组或箱体规格')) mark(['unitIndex'], '请选择拼装单元。')
  else if (calculationError.includes('点间距规格')) mark(['pitchIndex'], '请选择点间距。')
  else if (calculationError.startsWith('当前可用墙面放不下一块')) {
    mark(
      ['wallWidthText', 'wallHeightText'],
      '当前尺寸放不下一个拼装单元。',
      '请检查墙体尺寸、上下预留和包边。',
    )
  } else if (calculationError.includes('超出可可靠计算范围')) {
    mark(['wallWidthText', 'wallHeightText'], '请检查墙体尺寸是否填写正确。', '请检查墙体尺寸是否填写正确。')
  }

  return { fieldErrors, inputSuggestion }
}

function calculateStructuredResult(values) {
  const unit = getUnitSpec(values.unitKey)
  if (!unit || Number(values.unitWidthMm) !== unit.widthMm || Number(values.unitHeightMm) !== unit.heightMm) {
    return { result: null, inputError: '请确认拼装单元的具体宽度和高度。' }
  }
  const frameWidthCm = finiteInputNumber(values.frameWidthCm)
  const calculation = calculateLedScreenPlan({
    wallWidthMeters: values.wallWidthMeters,
    wallHeightMeters: values.wallHeightMeters,
    topReserveMeters: values.topReserveMeters,
    bottomReserveMeters: values.bottomReserveMeters,
    frameWidthMeters: frameWidthCm === null ? NaN : frameWidthCm / 100,
    viewingDistanceMeters: values.viewingDistanceMeters,
    aspectRatioKey: values.aspectRatioKey,
    unitKey: values.unitKey,
    pixelPitch: values.pixelPitch,
  })
  const validation = pageInputFeedback(values, calculation.error)
  return calculation.error
    ? { result: null, inputError: calculation.error, ...validation }
    : {
      result: decorateResult(calculation, { wallWidthText: values.wallWidthMeters, wallHeightText: values.wallHeightMeters }),
      inputError: '', fieldErrors: {}, inputSuggestion: '',
    }
}

function getUnitKey(state) {
  return state.unitOptions?.[state.unitIndex]?.key
}

function decorateResult(result, state) {
  if (!result) return null
  const wallWidth = Number(state.wallWidthText)
  const wallHeight = Number(state.wallHeightText)
  const frameLeft = result.horizontalMarginMeters / wallWidth * 100
  const frameTop = result.actualTopMarginMeters / wallHeight * 100
  const frameWidth = result.installedWidthMeters / wallWidth * 100
  const frameHeight = result.installedHeightMeters / wallHeight * 100
  const screenLeft = result.frameWidthMeters / result.installedWidthMeters * 100
  const screenTop = result.frameWidthMeters / result.installedHeightMeters * 100
  const screenWidth = result.screenWidthMeters / result.installedWidthMeters * 100
  const screenHeight = result.screenHeightMeters / result.installedHeightMeters * 100
  const ratioWidthPercent = wallWidth / wallHeight
  const diagramFitWidthPercent = Math.min(
    100,
    DIAGRAM_STAGE_HEIGHT_RPX * ratioWidthPercent / DIAGRAM_STAGE_WIDTH_RPX * 100,
  )
  const diagramWidthRpx = DIAGRAM_STAGE_WIDTH_RPX * diagramFitWidthPercent / 100
  const diagramBoxHeightRpx = diagramWidthRpx / ratioWidthPercent
  const legacyDiagramHeightRpx = 630 * wallHeight / wallWidth
  const exactActualRatio = result.columns * getUnitSpec(result.unitKey).widthMm
    / (result.rows * getUnitSpec(result.unitKey).heightMm)
  const ratioDeviation = Math.abs(exactActualRatio - result.targetAspectRatio) / result.targetAspectRatio
  const ratioDeviationPercent = ratioDeviation * 100
  const ratioFallback = ratioDeviation > PREFERRED_RATIO_ERROR + 1e-9
  const actualRatioText = `${Number(exactActualRatio.toFixed(2))}:1`
  const ratioDeviationText = `${ratioDeviationPercent.toFixed(1)}%`
  const unitTypeLabel = result.unitType === 'module' ? '模组' : '箱体'
  const isFinestAvailablePitch = Number(result.pixelPitch) === Math.min(...LED_PIXEL_PITCHES)
  const viewingAssessmentText = result.statusKey === 'near'
    ? `${result.viewingDistanceMeters} m 低于 ${result.comfortableMinimumMeters} m 的舒适距离参考下限。${isFinestAvailablePitch
      ? `${result.pitchMode === 'recommended' ? '系统推荐' : '当前指定'}已是现有规格中最细的 ${result.pitchText}。`
      : `当前按 ${result.pitchModeLabel} ${result.pitchText} 校核。`}`
    : result.statusKey === 'avoid'
      ? `${result.viewingDistanceMeters} m 低于 ${result.pitchText} 对应的点间距距离参考。`
      : result.statusKey === 'surplus'
        ? `${result.viewingDistanceMeters} m 超过舒适距离参考上限 ${result.comfortableMaximumMeters} m，当前点间距清晰度有余。`
        : ''
  return {
    ...result,
    layoutText: `横向${unitTypeLabel} ${result.columns} × 纵向${unitTypeLabel} ${result.rows}，总共 ${result.totalUnits} 块`,
    ratioFallback,
    ratioDeviationPercent,
    ratioDeviationText,
    actualRatioText,
    ratioSummaryText: `目标 ${result.targetAspectRatioKey} · 实际 ${actualRatioText}（偏差 ${ratioDeviationText}）`,
    ratioFallbackText: ratioFallback ? '整数拼装偏差超过 5%，无法满足目标比例，当前为最接近方案。' : '',
    viewingAssessmentText,
    viewingDetailsText: result.statusKey === 'near' && isFinestAvailablePitch
      ? `“观看位置偏近”表示低于舒适距离参考下限；${result.pitchMode === 'recommended' ? '系统推荐' : '当前指定'}档位已选用现有最细规格 ${result.pitchText}。`
      : result.statusText,
    integerLayoutNote: ratioDeviation > 1e-9
      ? '完整单元拼装会产生比例偏差，内容按实际比例适配。'
      : '屏体按完整单元拼装，内容按实际比例显示。',
    diagramHeightRpx: Math.round(Math.min(DIAGRAM_STAGE_HEIGHT_RPX, legacyDiagramHeightRpx)),
    diagramStageStyle: `padding-top:${(diagramBoxHeightRpx / DIAGRAM_STAGE_WIDTH_RPX * 100).toFixed(6)}%`,
    diagramFitStyle: `width:${diagramFitWidthPercent.toFixed(6)}%`,
    wallDiagramStyle: `padding-top:${(wallHeight / wallWidth * 100).toFixed(6)}%`,
    diagramLabelsBelow: diagramWidthRpx < 260 || diagramBoxHeightRpx < 100,
    frameStyle: [
      `left:${frameLeft.toFixed(3)}%`,
      `top:${frameTop.toFixed(3)}%`,
      `width:${frameWidth.toFixed(3)}%`,
      `height:${frameHeight.toFixed(3)}%`,
    ].join(';'),
    screenStyle: [
      `left:${screenLeft.toFixed(3)}%`,
      `top:${screenTop.toFixed(3)}%`,
      `width:${screenWidth.toFixed(3)}%`,
      `height:${screenHeight.toFixed(3)}%`,
      `background-size:${(100 / result.columns).toFixed(3)}% ${(100 / result.rows).toFixed(3)}%`,
    ].join(';'),
  }
}

function calculatePageResult(state) {
  const frameWidthCm = finiteInputNumber(state.frameWidthText)
  const calculation = calculateLedScreenPlan({
    wallWidthMeters: state.wallWidthText,
    wallHeightMeters: state.wallHeightText,
    topReserveMeters: state.topReserveText,
    bottomReserveMeters: state.bottomReserveText,
    frameWidthMeters: frameWidthCm === null ? NaN : frameWidthCm / 100,
    viewingDistanceMeters: state.viewingDistanceText,
    aspectRatioKey: state.aspectRatioOptions?.[state.aspectRatioIndex]?.key ?? null,
    unitKey: getUnitKey(state),
    pixelPitch: state.pitchOptions?.[state.pitchIndex]?.value,
  })
  const validation = pageInputFeedback(state, calculation.error)
  return calculation.error
    ? { result: null, inputError: calculation.error, ...validation }
    : { result: decorateResult(calculation, state), inputError: '', fieldErrors: {}, inputSuggestion: '' }
}

function buildPreferences(state) {
  return {
    wallWidthText: state.wallWidthText,
    wallHeightText: state.wallHeightText,
    topReserveText: state.topReserveText,
    bottomReserveText: state.bottomReserveText,
    frameWidthText: state.frameWidthText,
    viewingDistanceText: state.viewingDistanceText,
    aspectRatio: state.aspectRatioOptions?.[state.aspectRatioIndex]?.key || '',
    unitKey: getUnitKey(state) || '',
    pitch: state.pitchOptions?.[state.pitchIndex]?.value ?? '',
  }
}

finishLedScreenModuleLoad()

Page({
  ...ledOperationMethods,
  ...ledProjectMethods,
  data: {
    wallWidthText: '6',
    wallHeightText: '3',
    topReserveText: '0.2',
    bottomReserveText: '0.2',
    frameWidthText: '5',
    viewingDistanceText: '3',
    aspectRatioOptions: [
      { key: '16:9', label: '16:9' },
      { key: '4:3', label: '4:3' },
      { key: '21:9', label: '21:9' },
      { key: '16:10', label: '16:10' },
      { key: '32:9', label: '32:9' },
    ],
    aspectRatioIndex: 0,
    unitOptions: [
      { key: 'module', label: '模组 · 320 × 160 mm' },
      { key: 'cabinetStandard', label: '常规箱体 · 640 × 480 mm' },
      { key: 'cabinetPremiumA', label: '高端 A 系列 · 600 × 337.5 mm' },
    ],
    unitIndex: 0,
    pitchOptions: [
      { value: 'recommended', label: '系统推荐' },
      { value: 1.25, label: 'P1.25' },
      { value: 1.53, label: 'P1.53' },
      { value: 1.86, label: 'P1.86' },
      { value: 2, label: 'P2.0' },
    ],
    pitchIndex: 0,
    result: null,
    currentFavorite: false,
    inputError: '',
    inputSuggestion: '',
    fieldErrors: {},
    inputPending: false,
    reportCanvasWidth: REPORT_WIDTH,
    reportCanvasHeight: REPORT_HEIGHT,
    reportImagePath: '',
    reportPreviewVisible: false,
    reportPreviewClosing: false,
    reportPreviewError: false,
    resetPersistenceError: false,
    isGeneratingReport: false,
    operationSnapshot: null,
    operationActive: false,
    viewingDetailsExpanded: false,
    ...createLedProjectData(),
  },

  onLoad() {
    this._pageVisible = false
    this._ledReportPreviewCloseTimer = null
    this._ledReportPreviewCloseRevision = 0
    this._favoriteSyncedSinceLoad = false
    const finishInitialization = startMeasurement('LED大屏/初始化总耗时')
    const preferences = readPreferences(PREFERENCE_KEY)
    const legacyUnitKey = preferences.assemblyType === 'cabinet'
      ? preferences.cabinet
      : preferences.assemblyType
    const unitKey = preferences.unitKey || legacyUnitKey
    const changes = {
      wallWidthText: preferences.wallWidthText === undefined ? '6' : preferences.wallWidthText,
      wallHeightText: preferences.wallHeightText === undefined ? '3' : preferences.wallHeightText,
      topReserveText: preferences.topReserveText ?? '0.2',
      bottomReserveText: preferences.bottomReserveText ?? '0.2',
      frameWidthText: preferences.frameWidthText ?? '5',
      viewingDistanceText: preferences.viewingDistanceText === undefined ? '3' : preferences.viewingDistanceText,
      aspectRatioIndex: findValueIndex(this.data.aspectRatioOptions, preferences.aspectRatio, (item) => item.key),
      unitIndex: findValueIndex(this.data.unitOptions, unitKey, (item) => item.key),
      pitchIndex: findValueIndex(this.data.pitchOptions, preferences.pitch, (item) => item.value),
    }
    const pageState = { ...this.data, ...changes }
    const finishCoreCalculation = startMeasurement('LED大屏/核心计算', { source: 'onLoad' })
    const resetFields = ['wallWidthText', 'wallHeightText', 'topReserveText', 'bottomReserveText', 'frameWidthText', 'viewingDistanceText']
    const intentionallyCleared = resetFields.every((field) => String(changes[field] ?? '').trim() === '')
    const calculated = intentionallyCleared
      ? { result: null, inputError: '', inputSuggestion: '', fieldErrors: {} }
      : calculatePageResult(pageState)
    finishCoreCalculation({ valid: Boolean(calculated.result) })
    const finishViewUpdate = startMeasurement('LED大屏/setData视图更新', { source: 'onLoad' })
    this.setData({ ...changes, ...calculated }, () => {
      finishViewUpdate()
      finishInitialization({ valid: Boolean(calculated.result) })
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        syncPageFavorite(this)
        this._favoriteSyncedSinceLoad = true
      }
    })
  },

  onShow() {
    this._pageVisible = true
    if (this.data.result) {
      syncPageFavorite(this)
      this._favoriteSyncedSinceLoad = true
    }
  },

  onHide() {
    this._pageVisible = false
    this.flushInputCalculation()
    this.cancelLedProjectDialogForHide()
    this.closeReportPreview(true)
    if (this.data.isGeneratingReport) this.invalidateReportGeneration()
    this.setData({ reportPreviewVisible: false, reportPreviewClosing: false, reportPreviewError: false, isGeneratingReport: false })
  },
  onUnload() {
    this._pageVisible = false
    disposeOperation(this)
    if (!this._ledUnloaded) {
      this._ledUnloaded = true
      this.cancelInputCalculation()
      this.cancelLedProjectDialogForHide()
      this.closeReportPreview(true)
      this.reportRevision = (this.reportRevision || 0) + 1
      this.reportPendingSignature = ''
      if (this.data.isGeneratingReport && typeof wx.hideLoading === 'function') wx.hideLoading()
      printPerformanceSummary('LED大屏/')
    }
  },

  onOperationStateChange(snapshot) {
    const previous = this.data.operationSnapshot
    const shouldCalculate = Boolean(snapshot?.ready && (!previous || previous.id !== snapshot.id || !previous.ready))
    const patch = { operationSnapshot: snapshot, operationActive: Boolean(snapshot?.active) }
    if (snapshot) {
      if (!this._ledManualUiSnapshot) {
        this._ledManualUiSnapshot = Object.fromEntries([
          'wallWidthText', 'wallHeightText', 'topReserveText', 'bottomReserveText',
          'frameWidthText', 'viewingDistanceText', 'aspectRatioIndex', 'unitIndex', 'pitchIndex',
        ].map((key) => [key, this.data[key]]))
      }
      const values = Object.fromEntries(snapshot.fields.map((field) => [field.key, field.value]))
      for (const [key, descriptor] of Object.entries(LED_OPERATION_FIELDS)) {
        if (!descriptor.dataKey) continue
        const value = values[key]
        patch[descriptor.dataKey] = value === undefined ? '' : value
      }
      const ui = operationUiState(this, values)
      patch.aspectRatioIndex = ui?.aspectRatioIndex ?? -1
      patch.unitIndex = ui?.unitIndex ?? -1
      patch.pitchIndex = ui?.pitchIndex ?? -1
      if (ui && values.unitKey && values.unitWidthMm !== undefined && values.unitHeightMm !== undefined) {
        patch.unitIndex = ui.unitIndex
      }
    } else if (this._ledManualUiSnapshot) {
      Object.assign(patch, this._ledManualUiSnapshot)
      this._ledManualUiSnapshot = null
    }
    this.setData(patch, () => {
      if (!shouldCalculate || this._ledUnloaded) return
      const current = this.getOperationSnapshot()
      if (!current || current.id !== snapshot.id || current.revision !== snapshot.revision || !current.ready) return
      if (prepareOperation(this).blocked) return
      this.commitCalculatedState()
    })
  },

  onOperationInvalidate(reason) {
    this.cancelInputCalculation()
    this.invalidateReportGeneration()
    this.closeProjectDialog(true)
    this._ledOperationResultGuard = null
    this.setData({
      result: null,
      currentFavorite: false,
      inputError: reason === 'end' ? '' : '本次操作输入已变化，请重新确认后计算。',
      inputSuggestion: '',
      fieldErrors: {},
      inputPending: false,
      reportImagePath: '',
      reportPreviewVisible: false,
      reportPreviewClosing: false,
      reportPreviewError: false,
      isGeneratingReport: false,
      viewingDetailsExpanded: false,
    })
  },

  beginOperation(facts, kind) { return this.beginStructuredOperation(facts, kind) },

  setOperationCandidate(field, value, unit) {
    const previous = this.getOperationSnapshot()?.fields.find((item) => item.key === field)?.value
    const accepted = ledOperationMethods.setOperationCandidate.call(this, field, value, unit)
    if (field === 'unitKey' && previous !== value) {
      ledOperationMethods.setOperationCandidate.call(this, 'unitWidthMm', undefined, 'mm')
      ledOperationMethods.setOperationCandidate.call(this, 'unitHeightMm', undefined, 'mm')
    }
    return accepted
  },

  endOperation() {
    this.endStructuredOperation()
    this.commitCalculatedState()
  },

  hasCurrentOperationResult(result = this.data.result) {
    if (this._ledUnloaded || !result || this.data.result !== result) return false
    const snapshot = this.getOperationSnapshot()
    if (!snapshot) return true
    const guard = captureOperationResult(this, result)
    return Boolean(snapshot.active && snapshot.ready && guard && isOperationResultCurrent(this, guard))
  },

  getOutputState() {
    const snapshot = this.getOperationSnapshot()
    if (!snapshot) return this.data
    if (!snapshot.active || !snapshot.ready || !this.hasCurrentOperationResult()) return null
    const values = Object.fromEntries(snapshot.fields.map((field) => [field.key, field.value]))
    const ui = operationUiState(this, values)
    if (!ui) return null
    return { ...ui, aspectRatioOptions: this.data.aspectRatioOptions, unitOptions: this.data.unitOptions,
      pitchOptions: this.data.pitchOptions, result: this.data.result }
  },

  captureCurrentOutput() {
    const result = this.data.result
    if (!this.hasCurrentOperationResult(result)) return null
    const guard = captureOperationResult(this, result)
    return guard ? { result, guard, structured: Boolean(this.getOperationSnapshot()) } : null
  },

  isCapturedOutputCurrent(capture) {
    return Boolean(!this._ledUnloaded && capture && this.data.result === capture.result
      && isOperationResultCurrent(this, capture.guard)
      && (!capture.structured || this.hasCurrentOperationResult(capture.result)))
  },

  invalidateReportGeneration() {
    const hasReportState = Boolean(
      this.reportSignature
      || this.reportPendingSignature
      || this.data.reportImagePath
      || this.data.reportPreviewVisible
      || this.data.reportPreviewClosing
      || this.data.isGeneratingReport,
    )
    if (this.data.reportPreviewVisible || this.data.reportPreviewClosing || this._ledReportPreviewCloseTimer != null) {
      this.closeReportPreview(true)
    }
    if (!hasReportState) return false
    this.reportRevision = (this.reportRevision || 0) + 1
    this.reportPendingSignature = ''
    this.reportSignature = ''
    if (this.data.isGeneratingReport && typeof wx.hideLoading === 'function') wx.hideLoading()
    return true
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    if (!field || this.data[field] === value) return
    this.closeReportPreview(true)
    if (this.getOperationSnapshot()) {
      const operationKey = Object.entries(LED_OPERATION_FIELDS).find(([, descriptor]) => descriptor.dataKey === field)?.[0]
      this.setData({ [field]: value, fieldErrors: {}, inputSuggestion: '', inputPending: false })
      if (operationKey) this.setOperationCandidate(operationKey, value, LED_OPERATION_FIELDS[operationKey].unit)
      return
    }
    if (this.data.projectDialogVisible) this.closeProjectDialog(true)
    this.invalidateReportGeneration()
    this._ledOperationResultGuard = null
    this.setData({
      [field]: value,
      result: null,
      currentFavorite: false,
      inputError: '',
      inputSuggestion: '',
      fieldErrors: {},
      inputPending: true,
      reportImagePath: '',
      reportPreviewVisible: false,
      reportPreviewClosing: false,
      isGeneratingReport: false,
    })
    this.scheduleInputCalculation()
  },

  onFieldBlur() { this.flushInputCalculation() },

  retryResetPersistence() {
    const persisted = writePreferencesDetailed(PREFERENCE_KEY, buildPreferences(this.data))
    this.setData({ resetPersistenceError: !persisted.ok })
    wx.showToast({ title: persisted.ok ? '已保存清空状态' : '保存失败，请检查本地存储', icon: 'none' })
    return persisted.ok
  },

  resetInputs() {
    this.cancelInputCalculation()
    this.invalidateReportGeneration()
    this.closeProjectDialog(true)
    if (this.getOperationSnapshot()) {
      this._ledManualUiSnapshot = null
      this.endStructuredOperation()
    }
    const changes = {
      wallWidthText: '',
      wallHeightText: '',
      topReserveText: '',
      bottomReserveText: '',
      frameWidthText: '',
      viewingDistanceText: '',
      aspectRatioIndex: 0,
      unitIndex: 0,
      pitchIndex: 0,
      result: null,
      currentFavorite: false,
      inputError: '',
      inputSuggestion: '',
      fieldErrors: {},
      inputPending: false,
      reportImagePath: '',
      reportPreviewVisible: false,
      reportPreviewClosing: false,
      isGeneratingReport: false,
      operationSnapshot: null,
      operationActive: false,
    }
    this._ledOperationResultGuard = null
    this.reportSignature = ''
    this.reportPendingSignature = ''
    this.setData(changes)
    const preferences = buildPreferences({ ...this.data, ...changes })
    const persisted = writePreferencesDetailed(PREFERENCE_KEY, preferences)
    this.setData({ resetPersistenceError: !persisted.ok })
    if (!persisted.ok) wx.showToast({ title: '清空未保存，请重试', icon: 'none' })
    vibrate('light')
    return true
  },

  onAspectRatioChange(event) {
    const aspectRatioIndex = Number(event.detail.value)
    if (!Number.isInteger(aspectRatioIndex) || aspectRatioIndex < -1 || aspectRatioIndex >= this.data.aspectRatioOptions.length) return
    if (aspectRatioIndex === this.data.aspectRatioIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()) {
      const aspectRatioKey = this.data.aspectRatioOptions[aspectRatioIndex]?.key
      this.setData({ aspectRatioIndex })
      this.setOperationCandidate('aspectRatioKey', aspectRatioKey, 'ratio')
      return
    }
    this.commitCalculatedState({ aspectRatioIndex }, this.invalidateReportGeneration())
  },

  onUnitChange(event) {
    const unitIndex = Number(event.detail.value)
    if (!Number.isInteger(unitIndex) || unitIndex < -1 || unitIndex >= this.data.unitOptions.length) return
    if (unitIndex === this.data.unitIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()) {
      const unit = this.data.unitOptions[unitIndex]
      const spec = getUnitSpec(unit?.key)
      this.setData({ unitIndex })
      this.setOperationCandidate('unitKey', spec?.key, 'key')
      this.setOperationCandidate('unitWidthMm', spec?.widthMm, 'mm')
      this.setOperationCandidate('unitHeightMm', spec?.heightMm, 'mm')
      return
    }
    this.commitCalculatedState({ unitIndex }, this.invalidateReportGeneration())
  },

  onPitchChange(event) {
    const pitchIndex = Number(event.detail.value)
    if (!Number.isInteger(pitchIndex) || pitchIndex < -1 || pitchIndex >= this.data.pitchOptions.length) return
    if (pitchIndex === this.data.pitchIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()) {
      const pixelPitch = this.data.pitchOptions[pitchIndex]?.value
      this.setData({ pitchIndex })
      this.setOperationCandidate('pixelPitch', pixelPitch, 'pitch')
      return
    }
    this.commitCalculatedState({ pitchIndex }, this.invalidateReportGeneration())
  },

  commitCalculatedState(changes = {}, alreadyInvalidated = false) {
    const operation = prepareOperation(this)
    if (operation.disposed || this._ledUnloaded) return null
    const finishCalculation = startMeasurement('LED大屏/计算到结果更新', {
      fields: Object.keys(changes).length,
    })
    this.cancelInputCalculation()
    if (operation.structured) {
      if (operation.blocked) {
        this.setData({
          result: null, currentFavorite: false, inputError: '请确认本次操作所需的所有输入。',
          inputSuggestion: '', fieldErrors: {}, inputPending: false,
        })
        return null
      }
      if (!operation.guard()) return null
      const calculated = calculateStructuredResult(operation.state)
      if (!operation.guard() || this._ledUnloaded) return null
      if (!calculated.result) {
        this.setData({
          result: null, currentFavorite: false, inputError: calculated.inputError,
          inputSuggestion: calculated.inputSuggestion || '', fieldErrors: calculated.fieldErrors || {}, inputPending: false,
        })
        return null
      }
      const guard = operation.commit(calculated.result)
      if (!guard) return null
      this._ledOperationResultGuard = guard
      this.setData({ ...calculated, currentFavorite: false, inputPending: false }, () => {
        if (!this.hasCurrentOperationResult(calculated.result)) return
        if (this._pageVisible) syncPageFavorite(this)
      })
      return calculated.result
    }
    const pageState = { ...this.data, ...changes }
    const finishCoreCalculation = startMeasurement('LED大屏/核心计算', { source: 'interaction' })
    const calculated = calculatePageResult(pageState)
    finishCoreCalculation({ valid: Boolean(calculated.result) })
    const nextReportSignature = this.getReportSignature(pageState, calculated.result)
    const previousReportSignature = this.reportPendingSignature || this.reportSignature
    const reportChanged = Boolean(previousReportSignature && previousReportSignature !== nextReportSignature)
    const reportInvalidated = alreadyInvalidated || (reportChanged && this.invalidateReportGeneration())
    const finishViewUpdate = startMeasurement('LED大屏/setData视图更新', { source: 'interaction' })
    this.setData({
      ...changes,
      ...calculated,
      ...(!calculated.result ? { currentFavorite: false } : {}),
      inputPending: false,
      ...(reportInvalidated ? {
        reportImagePath: '', reportPreviewVisible: false, reportPreviewClosing: false,
        isGeneratingReport: false,
      } : {}),
    }, () => {
      finishViewUpdate()
      if (calculated.result && this._pageVisible) syncPageFavorite(this)
      finishCalculation({
        valid: Boolean(calculated.result),
        reportChanged: Boolean(reportInvalidated),
      })
    })
    if (calculated.result) writePreferences(PREFERENCE_KEY, buildPreferences(pageState))
    return calculated.result
  },

  scheduleInputCalculation() {
    this.cancelInputCalculation()
    this.inputCalculationTimer = setTimeout(() => {
      this.inputCalculationTimer = null
      this.commitCalculatedState()
    }, INPUT_CALCULATION_DELAY)
  },

  cancelInputCalculation() {
    if (this.inputCalculationTimer === null || this.inputCalculationTimer === undefined) return
    clearTimeout(this.inputCalculationTimer)
    this.inputCalculationTimer = null
  },

  flushInputCalculation() {
    if (this.inputCalculationTimer === null || this.inputCalculationTimer === undefined) return
    this.cancelInputCalculation()
    this.commitCalculatedState()
  },

  getReportSignature(state = this.data, result = state.result) {
    if (!result) return ''
    return [
      state.wallWidthText,
      state.wallHeightText,
      state.topReserveText,
      state.bottomReserveText,
      state.frameWidthText,
      state.viewingDistanceText,
      result.targetAspectRatioKey,
      result.unitKey,
      result.pixelPitch,
      result.columns,
      result.rows,
    ].join('|')
  },

  finishReportGeneration(revision, changes = {}) {
    if (this.reportRevision !== revision) return
    if (typeof wx.hideLoading === 'function') wx.hideLoading()
    this.reportPendingSignature = ''
    this.setData({ isGeneratingReport: false, ...changes })
  },

  generateReportImage() {
    if (this._pageVisible === false || this._ledUnloaded) return false
    this.flushInputCalculation()
    const state = this.getOutputState()
    const capture = this.captureCurrentOutput()
    const payload = buildLedScreenReportPayload(state)
    if (!payload || !capture || this.data.isGeneratingReport || this.data.inputPending || this.data.inputError) return false
    const signature = this.getReportSignature(state)
    if (this.data.reportImagePath && this.reportSignature === signature) {
      if (!this.isCapturedOutputCurrent(capture)) return false
      if (this.hasAccessibleReportImage()) {
        vibrate('light')
        return this.openReportPreview()
      }
      this.reportSignature = ''
      this.setData({ reportImagePath: '', reportPreviewError: false })
    }
    if (typeof wx.createCanvasContext !== 'function'
      || typeof wx.canvasToTempFilePath !== 'function') {
      wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
      return false
    }

    let layout
    try {
      const measurementContext = wx.createCanvasContext(REPORT_CANVAS_ID, this)
      layout = buildLedScreenReportLayout(measurementContext, payload)
    } catch (error) {
      wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
      return false
    }
    if (!layout || !Number.isFinite(layout.height) || layout.height <= 0) return false

    this.cancelReportPreviewCloseTimer()
    vibrate('medium')
    const revision = (this.reportRevision || 0) + 1
    this.reportRevision = revision
    this.reportPendingSignature = signature
    const isCurrent = () => this._pageVisible !== false && !this._ledUnloaded
      && this.reportRevision === revision && this.isCapturedOutputCurrent(capture)
      && this.reportPendingSignature === signature
    this.setData({
      isGeneratingReport: true,
      reportPreviewVisible: false,
      reportPreviewClosing: false,
      reportPreviewError: false,
      reportCanvasHeight: layout.height,
    }, () => {
      if (!isCurrent() || this._ledUnloaded) return
      if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })
      try {
        drawAndExportLedReport(this, {
          canvasId: REPORT_CANVAS_ID,
          isCurrent,
          width: REPORT_WIDTH,
          height: layout.height,
          draw: (context) => {
            const finishReportDrawing = startMeasurement('LED大屏/长图绘制')
            try {
              drawLedScreenReport(context, payload, layout)
            } finally {
              finishReportDrawing()
            }
          },
          getExportOptions: () => getExportDimensions(layout.height),
          startExportMeasurement: () => startMeasurement('LED大屏/长图导出'),
          onSuccess: (tempFilePath) => {
            if (!isCurrent()) return
            this.reportSignature = signature
            this.openReportPreview({ reportImagePath: tempFilePath })
            this.finishReportGeneration(revision)
          },
          onFailure: () => {
            this.finishReportGeneration(revision)
            wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
          },
        })
      } catch (error) {
        if (!isCurrent()) return
        this.finishReportGeneration(revision)
        wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
      }
    })
    return true
  },

  openSharePreview() { return this.generateReportImage() },

  hasAccessibleReportImage(path = this.data.reportImagePath) {
    if (!path) return false
    try {
      const manager = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
      if (typeof manager?.accessSync !== 'function') return true
      manager.accessSync(path)
      return true
    } catch (error) {
      return false
    }
  },

  cancelReportPreviewCloseTimer() {
    if (this._ledReportPreviewCloseTimer !== null && this._ledReportPreviewCloseTimer !== undefined) {
      clearTimeout(this._ledReportPreviewCloseTimer)
    }
    this._ledReportPreviewCloseTimer = null
    this._ledReportPreviewCloseRevision = (this._ledReportPreviewCloseRevision || 0) + 1
    return this._ledReportPreviewCloseRevision
  },

  openReportPreview(changes = {}) {
    if (this._pageVisible === false || this._ledUnloaded) return false
    this.cancelReportPreviewCloseTimer()
    this.setData({
      reportPreviewVisible: true,
      reportPreviewClosing: false,
      reportPreviewError: false,
      ...changes,
    })
    return true
  },

  closeReportPreview(immediate = false) {
    if (immediate === true) {
      const hadPreview = Boolean(this.data.reportPreviewVisible || this.data.reportPreviewClosing || this.data.reportPreviewError)
      this.cancelReportPreviewCloseTimer()
      if (hadPreview) this.setData({ reportPreviewVisible: false, reportPreviewClosing: false, reportPreviewError: false })
      return hadPreview
    }
    if (!this.data.reportPreviewVisible || this.data.reportPreviewClosing
      || this._pageVisible === false || this._ledUnloaded) return false
    vibrate('light')
    const revision = this.cancelReportPreviewCloseTimer()
    this.setData({ reportPreviewClosing: true }, () => {
      const isCurrentClose = () => this._ledReportPreviewCloseRevision === revision
        && this._pageVisible !== false && !this._ledUnloaded
        && this.data.reportPreviewVisible && this.data.reportPreviewClosing
      if (!isCurrentClose()) return
      this._ledReportPreviewCloseTimer = setTimeout(() => {
        if (!isCurrentClose()) return
        this._ledReportPreviewCloseTimer = null
        this.setData({ reportPreviewVisible: false, reportPreviewClosing: false, reportPreviewError: false })
      }, 300)
    })
    return true
  },

  stopEvent() {},
  preventTouchMove() {},

  isCurrentReportPreview() {
    if (!this.data.reportPreviewVisible || this.data.reportPreviewClosing || this.data.reportPreviewError
      || this.data.isGeneratingReport || this._pageVisible === false || this._ledUnloaded
      || !this.data.reportImagePath) return false
    const output = this.getOutputState()
    const capture = this.captureCurrentOutput()
    return Boolean(output && capture && this.isCapturedOutputCurrent(capture)
      && this.reportSignature === this.getReportSignature(output))
  },

  previewReportImage() {
    if (!this.isCurrentReportPreview()) return false
    const path = this.data.reportImagePath
    if (!this.hasAccessibleReportImage(path)) {
      this.reportSignature = ''
      this.setData({ reportImagePath: '', reportPreviewError: false })
      return this.generateReportImage()
    }
    return previewGeneratedImage(path)
  },

  onReportPreviewImageError(event) {
    const dataset = event?.currentTarget?.dataset || {}
    if (!this.data.reportPreviewVisible || this.data.reportPreviewClosing || this._pageVisible === false || this._ledUnloaded
      || dataset.imagePath !== this.data.reportImagePath || !this.data.reportImagePath) return false
    this.reportSignature = ''
    this.setData({ reportImagePath: '', reportPreviewError: true })
    return true
  },

  retryReportPreview() {
    if (!this.data.reportPreviewVisible || this.data.reportPreviewClosing || this.data.isGeneratingReport
      || this._pageVisible === false || this._ledUnloaded) return false
    this.reportSignature = ''
    this.setData({ reportImagePath: '', reportPreviewError: false })
    return this.generateReportImage()
  },

  copyResultFromReport() {
    if (!this.data.reportPreviewVisible) return false
    return this.copyResult()
  },

  toggleViewingDetails() {
    if (!this.data.result || this.data.result.statusKey === 'fit') return false
    this.setData({ viewingDetailsExpanded: !this.data.viewingDetailsExpanded })
    return true
  },

  shareReportImage() {
    if (!this.isCurrentReportPreview()) return false
    const path = this.data.reportImagePath
    if (!this.hasAccessibleReportImage(path)) {
      this.reportSignature = ''
      this.setData({ reportImagePath: '', reportPreviewError: true })
      return false
    }
    return shareGeneratedImage(path)
  },

  saveReportImage() {
    if (!this.isCurrentReportPreview()) return false
    const path = this.data.reportImagePath
    if (!this.hasAccessibleReportImage(path)) {
      this.reportSignature = ''
      this.setData({ reportImagePath: '', reportPreviewError: true })
      return false
    }
    return saveGeneratedImage(path)
  },

  getRecordLookupPayload() {
    const state = this.getOutputState()
    return state?.result
      ? { module: 'ledScreen', preferences: buildPreferences(state) }
      : null
  },

  getResultText(state = this.data, result = state.result) {
    if (!result) return ''
    return [
      'LED 大屏尺寸预估',
      `现场墙面：${state.wallWidthText} × ${state.wallHeightText} m`,
      `上/下最低预留：${state.topReserveText} / ${state.bottomReserveText} m`,
      `目标画面比例：${result.targetAspectRatioKey}`,
      `实际比例：${result.actualRatioText || result.ratioText}（偏差 ${result.ratioDeviationText || '—'}）`,
      result.integerLayoutNote,
      ...(result.ratioFallbackText ? [`比例提示：${result.ratioFallbackText}`] : []),
      `实际屏体：${result.dimensionText}`,
      `四周包边：${result.frameWidthText}`,
      `含包边安装外尺寸：${result.installedDimensionText}`,
      `拼装数量：${result.layoutText}`,
      `拼装单元：${result.unitSizeText}`,
      `左右余量：${result.horizontalMarginText}`,
      `上/下实际余量：${result.verticalMarginText}`,
      `点间距：${result.pitchModeLabel} ${result.pitchText}`,
      `估算分辨率：${result.resolutionText}`,
      `最近观看距离：${result.viewingDistanceMeters} m`,
      `舒适观看范围：${result.comfortableRangeText}`,
      `观看校核：${result.statusLabel}`,
      '结果为前期尺寸预估，最终以实际模组/箱体像素矩阵及结构深化为准。',
    ].join('\n')
  },

  getRecordPayload(state = this.data, result = state.result) {
    if (arguments.length === 0) {
      state = this.getOutputState()
      result = state?.result
    }
    if (!state || !this.hasCurrentOperationResult(result)) return null
    const resultText = this.getResultText(state, result)
    if (!resultText) return null
    return {
      module: 'ledScreen',
      title: `${result.dimensionText} · ${result.unitLabel}`,
      summary: `${result.targetAspectRatioKey} · ${result.pitchModeLabel} ${result.pitchText} · 观看 ${result.viewingDistanceMeters} m`,
      preferences: buildPreferences(state),
      resultText,
    }
  },

  copyResult() {
    this.flushInputCalculation()
    const capture = this.captureCurrentOutput()
    const state = this.getOutputState()
    const text = state && this.getResultText(state)
    if (!text) return
    wx.setClipboardData({ data: text, success: () => { if (this.isCapturedOutputCurrent(capture)) vibrate('medium') } })
  },

  toggleCurrentFavorite() {
    this.flushInputCalculation()
    if (!this.captureCurrentOutput()) return
    togglePageFavorite(this)
  },

  saveToActiveProject() {
    return this.openProjectSheet()
  },
})

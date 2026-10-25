const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishLedScreenModuleLoad = startMeasurement('LED大屏/脚本加载')
const { calculateLedScreenPlan, LED_UNIT_SPECS } = require('../../utils/led-screen')
const { findValueIndex, readPreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  createOperationMethods,
  prepareOperation,
  disposeOperation,
  captureOperationResult,
  isOperationResultCurrent,
} = require('../../utils/operation-inputs')
const { syncPageFavorite, togglePageFavorite } = require('../../utils/result-record-actions')
const { addRecordToProject, createProject, getActiveProject } = require('../../utils/records')
const {
  previewGeneratedImage,
  saveGeneratedImage,
  shareGeneratedImage,
} = require('../../utils/report-image-actions')
const {
  REPORT_CANVAS_ID,
  REPORT_HEIGHT,
  REPORT_WIDTH,
  buildLedScreenReportPayload,
  drawLedScreenReport,
} = require('./report')
const getUnitSpec = (key) => LED_UNIT_SPECS[key] || null

const PREFERENCE_KEY = 'audioTool.ledScreen.preferences'
const INPUT_CALCULATION_DELAY = 160
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

function calculateStructuredResult(values) {
  const unit = getUnitSpec(values.unitKey)
  if (!unit || Number(values.unitWidthMm) !== unit.widthMm || Number(values.unitHeightMm) !== unit.heightMm) {
    return { result: null, inputError: '请确认拼装单元的具体宽度和高度。' }
  }
  const frameWidthCm = Number(values.frameWidthCm)
  const calculation = calculateLedScreenPlan({
    wallWidthMeters: values.wallWidthMeters,
    wallHeightMeters: values.wallHeightMeters,
    topReserveMeters: values.topReserveMeters,
    bottomReserveMeters: values.bottomReserveMeters,
    frameWidthMeters: Number.isFinite(frameWidthCm) ? frameWidthCm / 100 : NaN,
    viewingDistanceMeters: values.viewingDistanceMeters,
    aspectRatioKey: values.aspectRatioKey,
    unitKey: values.unitKey,
    pixelPitch: values.pixelPitch,
  })
  return calculation.error
    ? { result: null, inputError: calculation.error }
    : { result: decorateResult(calculation, { wallWidthText: values.wallWidthMeters, wallHeightText: values.wallHeightMeters }), inputError: '' }
}

function getUnitKey(state) {
  return state.unitOptions[state.unitIndex].key
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
  const diagramHeightRpx = 630 * wallHeight / wallWidth
  const unitTypeLabel = result.unitType === 'module' ? '模组' : '箱体'
  return {
    ...result,
    layoutText: `横向${unitTypeLabel} ${result.columns} × 纵向${unitTypeLabel} ${result.rows}，总共 ${result.totalUnits} 块`,
    diagramHeightRpx: Math.round(diagramHeightRpx),
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
  const frameWidthCm = Number(state.frameWidthText)
  const calculation = calculateLedScreenPlan({
    wallWidthMeters: state.wallWidthText,
    wallHeightMeters: state.wallHeightText,
    topReserveMeters: state.topReserveText,
    bottomReserveMeters: state.bottomReserveText,
    frameWidthMeters: String(state.frameWidthText).trim() && Number.isFinite(frameWidthCm)
      ? frameWidthCm / 100
      : NaN,
    viewingDistanceMeters: state.viewingDistanceText,
    aspectRatioKey: state.aspectRatioOptions[state.aspectRatioIndex].key,
    unitKey: getUnitKey(state),
    pixelPitch: state.pitchOptions[state.pitchIndex].value,
  })
  return calculation.error
    ? { result: null, inputError: calculation.error }
    : { result: decorateResult(calculation, state), inputError: '' }
}

function buildPreferences(state) {
  return {
    wallWidthText: state.wallWidthText,
    wallHeightText: state.wallHeightText,
    topReserveText: state.topReserveText,
    bottomReserveText: state.bottomReserveText,
    frameWidthText: state.frameWidthText,
    viewingDistanceText: state.viewingDistanceText,
    aspectRatio: state.aspectRatioOptions[state.aspectRatioIndex].key,
    unitKey: getUnitKey(state),
    pitch: state.pitchOptions[state.pitchIndex].value,
  }
}

finishLedScreenModuleLoad()

Page({
  ...ledOperationMethods,
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
    reportCanvasWidth: REPORT_WIDTH,
    reportCanvasHeight: REPORT_HEIGHT,
    reportImagePath: '',
    reportPreviewVisible: false,
    isGeneratingReport: false,
    operationSnapshot: null,
    operationActive: false,
  },

  onLoad() {
    this._pageVisible = false
    this._favoriteSyncedSinceLoad = false
    const finishInitialization = startMeasurement('LED大屏/初始化总耗时')
    const preferences = readPreferences(PREFERENCE_KEY)
    const legacyUnitKey = preferences.assemblyType === 'cabinet'
      ? preferences.cabinet
      : preferences.assemblyType
    const unitKey = preferences.unitKey || legacyUnitKey
    const changes = {
      wallWidthText: preferences.wallWidthText || '6',
      wallHeightText: preferences.wallHeightText || '3',
      topReserveText: preferences.topReserveText ?? '0.2',
      bottomReserveText: preferences.bottomReserveText ?? '0.2',
      frameWidthText: preferences.frameWidthText ?? '5',
      viewingDistanceText: preferences.viewingDistanceText || '3',
      aspectRatioIndex: findValueIndex(this.data.aspectRatioOptions, preferences.aspectRatio, (item) => item.key),
      unitIndex: findValueIndex(this.data.unitOptions, unitKey, (item) => item.key),
      pitchIndex: findValueIndex(this.data.pitchOptions, preferences.pitch, (item) => item.value),
    }
    const pageState = { ...this.data, ...changes }
    const finishCoreCalculation = startMeasurement('LED大屏/核心计算', { source: 'onLoad' })
    const calculated = calculatePageResult(pageState)
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
  },
  onUnload() {
    disposeOperation(this)
    if (!this._ledUnloaded) {
      this._pageVisible = false
      this._ledUnloaded = true
      this.cancelInputCalculation()
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
    this._ledOperationResultGuard = null
    this.setData({
      result: null,
      currentFavorite: false,
      inputError: reason === 'end' ? '' : '本次操作输入已变化，请重新确认后计算。',
      reportImagePath: '',
      reportPreviewVisible: false,
      isGeneratingReport: false,
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
      || this.data.isGeneratingReport,
    )
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
    if (this.getOperationSnapshot()) {
      const operationKey = Object.entries(LED_OPERATION_FIELDS).find(([, descriptor]) => descriptor.dataKey === field)?.[0]
      this.setData({ [field]: value })
      if (operationKey) this.setOperationCandidate(operationKey, value, LED_OPERATION_FIELDS[operationKey].unit)
      return
    }
    const reportInvalidated = this.data[field] !== value && this.invalidateReportGeneration()
    this.setData({
      [field]: value,
      ...(reportInvalidated ? { reportImagePath: '', reportPreviewVisible: false, isGeneratingReport: false } : {}),
    })
    this.scheduleInputCalculation()
  },

  onFieldBlur() { this.flushInputCalculation() },

  onAspectRatioChange(event) {
    const aspectRatioIndex = Number(event.detail.value)
    if (aspectRatioIndex === this.data.aspectRatioIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()) {
      const aspectRatioKey = this.data.aspectRatioOptions[aspectRatioIndex]?.key
      this.setData({ aspectRatioIndex })
      if (aspectRatioKey) this.setOperationCandidate('aspectRatioKey', aspectRatioKey, 'ratio')
      return
    }
    this.commitCalculatedState({ aspectRatioIndex }, this.invalidateReportGeneration())
  },

  onUnitChange(event) {
    const unitIndex = Number(event.detail.value)
    if (unitIndex === this.data.unitIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()) {
      const unit = this.data.unitOptions[unitIndex]
      const spec = getUnitSpec(unit?.key)
      if (!spec) return
      this.setData({ unitIndex })
      this.setOperationCandidate('unitKey', spec.key, 'key')
      this.setOperationCandidate('unitWidthMm', spec.widthMm, 'mm')
      this.setOperationCandidate('unitHeightMm', spec.heightMm, 'mm')
      return
    }
    this.commitCalculatedState({ unitIndex }, this.invalidateReportGeneration())
  },

  onPitchChange(event) {
    const pitchIndex = Number(event.detail.value)
    if (pitchIndex === this.data.pitchIndex) return
    vibrate('light')
    if (this.getOperationSnapshot()) {
      const pixelPitch = this.data.pitchOptions[pitchIndex]?.value
      this.setData({ pitchIndex })
      if (pixelPitch !== undefined) this.setOperationCandidate('pixelPitch', pixelPitch, 'pitch')
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
        this.setData({ result: null, currentFavorite: false, inputError: '请确认本次操作所需的所有输入。' })
        return null
      }
      if (!operation.guard()) return null
      const calculated = calculateStructuredResult(operation.state)
      if (!operation.guard() || this._ledUnloaded) return null
      if (!calculated.result) {
        this.setData({ result: null, currentFavorite: false, inputError: calculated.inputError })
        return null
      }
      const guard = operation.commit(calculated.result)
      if (!guard) return null
      this._ledOperationResultGuard = guard
      this.setData({ ...calculated, currentFavorite: false }, () => {
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
      ...(reportInvalidated ? { reportImagePath: '', reportPreviewVisible: false, isGeneratingReport: false } : {}),
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
    if (!this.inputCalculationTimer) return
    clearTimeout(this.inputCalculationTimer)
    this.inputCalculationTimer = null
  },

  flushInputCalculation() {
    if (!this.inputCalculationTimer) return
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
    this.flushInputCalculation()
    const state = this.getOutputState()
    const capture = this.captureCurrentOutput()
    const payload = buildLedScreenReportPayload(state)
    if (!payload || this.data.isGeneratingReport) return
    const signature = this.getReportSignature(state)
    if (this.data.reportImagePath && this.reportSignature === signature) {
      if (!this.isCapturedOutputCurrent(capture)) return
      vibrate('light')
      this.setData({ reportPreviewVisible: true })
      return
    }
    if (typeof wx.createCanvasContext !== 'function'
      || typeof wx.canvasToTempFilePath !== 'function') {
      wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
      return
    }

    vibrate('medium')
    const revision = (this.reportRevision || 0) + 1
    this.reportRevision = revision
    this.reportPendingSignature = signature
    const isCurrent = () => this.reportRevision === revision && this.isCapturedOutputCurrent(capture)
      && this.reportPendingSignature === signature
    this.setData({ isGeneratingReport: true, reportPreviewVisible: false })
    if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })

    try {
    const context = wx.createCanvasContext(REPORT_CANVAS_ID, this)
      const finishReportDrawing = startMeasurement('LED大屏/长图绘制')
      drawLedScreenReport(context, payload)
      finishReportDrawing()
      context.draw(false, () => {
        if (!isCurrent()) return
        const finishReportExport = startMeasurement('LED大屏/长图导出')
        wx.canvasToTempFilePath({
          canvasId: REPORT_CANVAS_ID,
          width: REPORT_WIDTH,
          height: REPORT_HEIGHT,
          destWidth: REPORT_WIDTH * 2,
          destHeight: REPORT_HEIGHT * 2,
          fileType: 'png',
          quality: 1,
          success: ({ tempFilePath }) => {
            if (!isCurrent()) return
            finishReportExport({ success: Boolean(tempFilePath) })
            if (!tempFilePath) {
              this.finishReportGeneration(revision)
              wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
              return
            }
            this.reportSignature = signature
            this.finishReportGeneration(revision, {
              reportImagePath: tempFilePath,
              reportPreviewVisible: true,
            })
          },
          fail: () => {
            if (!isCurrent()) return
            finishReportExport({ success: false })
            this.finishReportGeneration(revision)
            wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
          },
        }, this)
      })
    } catch (error) {
      if (!isCurrent()) return
      this.finishReportGeneration(revision)
      wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
    }
  },

  closeReportPreview() {
    vibrate('light')
    this.setData({ reportPreviewVisible: false })
  },

  stopEvent() {},
  preventTouchMove() {},

  previewReportImage() {
    const capture = this.captureCurrentOutput()
    if (capture && this.isCapturedOutputCurrent(capture) && this.reportSignature === this.getReportSignature(this.getOutputState())) {
      previewGeneratedImage(this.data.reportImagePath)
    }
  },

  shareReportImage() {
    const capture = this.captureCurrentOutput()
    if (capture && this.isCapturedOutputCurrent(capture) && this.reportSignature === this.getReportSignature(this.getOutputState())) {
      shareGeneratedImage(this.data.reportImagePath)
    }
  },

  saveReportImage() {
    const capture = this.captureCurrentOutput()
    if (capture && this.isCapturedOutputCurrent(capture) && this.reportSignature === this.getReportSignature(this.getOutputState())) {
      saveGeneratedImage(this.data.reportImagePath)
    }
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
      `目标画面比例：${result.targetAspectRatioKey}`,
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
    this.flushInputCalculation()
    const capture = this.captureCurrentOutput()
    const payload = this.getRecordPayload()
    if (!capture || !payload) return
    const save = (project) => {
      if (!project || !this.isCapturedOutputCurrent(capture)) return
      if (!addRecordToProject(payload, project.id)) {
        wx.showToast({ title: '保存失败，请检查本地存储', icon: 'none' })
        return
      }
      vibrate('medium')
      wx.showToast({ title: `已加入${project.name}`, icon: 'none' })
    }
    const activeProject = getActiveProject()
    if (activeProject) {
      save(activeProject)
      return
    }
    wx.showModal({
      title: '新建现场项目', content: '', editable: true,
      placeholderText: '例如：三楼会议室', confirmText: '创建并加入',
      success: ({ confirm, content }) => {
        if (!confirm || !this.isCapturedOutputCurrent(capture)) return
        const project = createProject(content)
        if (project) save(project)
        else wx.showToast({ title: '请输入项目名称', icon: 'none' })
      },
    })
  },
})

const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishLedScreenModuleLoad = startMeasurement('LED大屏/脚本加载')
const { calculateLedScreenPlan } = require('../../utils/led-screen')
const { findValueIndex, readPreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  addPageToActiveProject,
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')
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

const PREFERENCE_KEY = 'audioTool.ledScreen.preferences'
const INPUT_CALCULATION_DELAY = 160

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
    this._pageVisible = false
    this.cancelInputCalculation()
    this.reportRevision = (this.reportRevision || 0) + 1
    this.reportPendingSignature = ''
    if (this.data.isGeneratingReport && typeof wx.hideLoading === 'function') wx.hideLoading()
    printPerformanceSummary('LED大屏/')
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
    this.commitCalculatedState({ aspectRatioIndex }, this.invalidateReportGeneration())
  },

  onUnitChange(event) {
    const unitIndex = Number(event.detail.value)
    if (unitIndex === this.data.unitIndex) return
    vibrate('light')
    this.commitCalculatedState({ unitIndex }, this.invalidateReportGeneration())
  },

  onPitchChange(event) {
    const pitchIndex = Number(event.detail.value)
    if (pitchIndex === this.data.pitchIndex) return
    vibrate('light')
    this.commitCalculatedState({ pitchIndex }, this.invalidateReportGeneration())
  },

  commitCalculatedState(changes = {}, alreadyInvalidated = false) {
    const finishCalculation = startMeasurement('LED大屏/计算到结果更新', {
      fields: Object.keys(changes).length,
    })
    this.cancelInputCalculation()
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
    const payload = buildLedScreenReportPayload(this.data)
    if (!payload || this.data.isGeneratingReport) return
    const signature = this.getReportSignature()
    if (this.data.reportImagePath && this.reportSignature === signature) {
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
    const isCurrent = () => this.reportRevision === revision
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
    previewGeneratedImage(this.data.reportImagePath)
  },

  shareReportImage() {
    shareGeneratedImage(this.data.reportImagePath)
  },

  saveReportImage() {
    saveGeneratedImage(this.data.reportImagePath)
  },

  getRecordLookupPayload() {
    return this.data.result
      ? { module: 'ledScreen', preferences: buildPreferences(this.data) }
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
    const text = this.getResultText()
    if (!text) return
    wx.setClipboardData({ data: text, success: () => vibrate('medium') })
  },

  toggleCurrentFavorite() {
    this.flushInputCalculation()
    togglePageFavorite(this)
  },

  saveToActiveProject() {
    this.flushInputCalculation()
    addPageToActiveProject(this)
  },
})

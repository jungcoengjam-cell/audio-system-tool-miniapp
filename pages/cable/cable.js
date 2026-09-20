const {
  calculateConstantVoltageCable,
  calculateProfessionalSpeakerCable,
} = require('../../utils/cable')
const { findValueIndex, readPreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
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

const PREFERENCE_KEY = 'audioTool.cable.preferences'
const INPUT_CALCULATION_DELAY = 160
const resultReportMethods = createResultReportMethods({
  performancePrefix: '线材选型',
  emptyToast: '暂无可生成的选型结果',
})

function calculatePageResult(state) {
  const mode = state.modes[state.modeIndex].key
  const result = mode === 'constant'
    ? calculateConstantVoltageCable({
      totalPowerW: state.constantPowerText,
      distanceMeters: state.constantDistanceText,
      environment: state.environments[state.environmentIndex].value,
    })
    : calculateProfessionalSpeakerCable({
      totalPowerW: state.professionalPowerText,
      distanceMeters: state.professionalDistanceText,
    })

  return result.error
    ? { result: null, inputError: result.error }
    : { result, inputError: '' }
}

function buildPreferences(state) {
  return {
    mode: state.modes[state.modeIndex].key,
    environment: state.environments[state.environmentIndex].value,
    constantPowerText: state.constantPowerText,
    constantDistanceText: state.constantDistanceText,
    professionalPowerText: state.professionalPowerText,
    professionalDistanceText: state.professionalDistanceText,
  }
}

Page({
  data: {
    modes: [
      { key: 'constant', label: '定压广播', subtitle: '100 V 广播喇叭线' },
      { key: 'professional', label: '专业音箱', subtitle: '定阻金银线' },
    ],
    modeIndex: 0,
    environments: [
      { value: 'indoor', label: '室内' },
      { value: 'outdoor', label: '室外' },
    ],
    environmentIndex: 0,
    constantPowerText: '100',
    constantDistanceText: '100',
    professionalPowerText: '300',
    professionalDistanceText: '50',
    result: null,
    currentFavorite: false,
    inputError: '',
    ...createResultReportData(),
  },

  onLoad() {
    this._pageVisible = false
    this._favoriteSyncedSinceLoad = false
    const preferences = readPreferences(PREFERENCE_KEY)
    const changes = {
      modeIndex: findValueIndex(this.data.modes, preferences.mode, (item) => item.key),
      environmentIndex: findValueIndex(
        this.data.environments,
        preferences.environment,
        (item) => item.value,
      ),
      constantPowerText: preferences.constantPowerText || '100',
      constantDistanceText: preferences.constantDistanceText || '100',
      professionalPowerText: preferences.professionalPowerText || '300',
      professionalDistanceText: preferences.professionalDistanceText || '50',
    }
    const calculated = calculatePageResult({ ...this.data, ...changes })
    this.setData({ ...changes, ...calculated }, () => {
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
    cancelResultReportGeneration(this)
  },

  onModeTap(event) {
    const modeIndex = Number(event.currentTarget.dataset.index)
    if (modeIndex !== this.data.modeIndex) vibrate('light')
    this.commitCalculatedState({ modeIndex })
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [field]: event.detail.value })
    this.scheduleInputCalculation()
  },

  onInputBlur() {
    this.flushInputCalculation()
  },

  onEnvironmentChange(event) {
    const environmentIndex = Number(event.detail.value)
    if (environmentIndex !== this.data.environmentIndex) vibrate('light')
    this.commitCalculatedState({ environmentIndex })
  },

  calculate() {
    return this.commitCalculatedState()
  },

  commitCalculatedState(changes = {}) {
    this.cancelInputCalculation()
    const pageState = { ...this.data, ...changes }
    const calculated = calculatePageResult(pageState)
    const resultReportChanges = resetStaleResultReport(
      this,
      this.getRecordPayload(pageState, calculated.result),
    )
    this.setData({ ...changes, ...calculated, ...resultReportChanges }, () => {
      if (!calculated.result) return
      writePreferences(PREFERENCE_KEY, buildPreferences(pageState))
      if (this._pageVisible) syncPageFavorite(this)
    })
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

  getPreferences(state = this.data) {
    return buildPreferences(state)
  },

  getRecordLookupPayload() {
    return this.data.result
      ? { module: 'cable', preferences: this.getPreferences() }
      : null
  },

  getResultText(state = this.data, result = state.result) {
    if (!result) return ''

    const isConstant = result.type === 'constant'
    return [
      isConstant ? '定压广播线材选型' : '专业音箱线材选型',
      '结果性质：公司标准推荐',
      `输入总功率：${isConstant ? state.constantPowerText : state.professionalPowerText} W`,
      `最远单程距离：${result.distanceMeters} m`,
      ...(isConstant ? [`敷设环境：${state.environments[state.environmentIndex].label}`] : []),
      `设计带载功率：${result.designPowerW} W`,
      `推荐线材：${result.spec}`,
      `状态：${result.status}`,
      result.description,
      ...(result.hasFormula ? [`公司公式校核下限：${result.formulaMinimumArea} mm²`] : []),
      ...result.warnings.map((warning) => `注意：${warning}`),
      '注：按公司线材标准作选型参考，实际施工仍需结合敷设方式、环境和当地规范复核。',
    ].join('\n')
  },

  getRecordPayload(state = this.data, result = state.result) {
    const resultText = this.getResultText(state, result)
    if (!resultText) return null

    const modeLabel = state.modes[state.modeIndex].label
    return {
      module: 'cable',
      title: `${modeLabel} · ${result.spec}`,
      summary: `${result.distanceMeters} m · 设计功率 ${result.designPowerW} W · ${result.status}`,
      preferences: this.getPreferences(state),
      resultText,
    }
  },

  ...resultReportMethods,

  copyResult() {
    const resultText = this.getResultText()
    if (!resultText) return
    vibrate('medium')
    wx.setClipboardData({ data: resultText })
  },

  toggleCurrentFavorite() {
    togglePageFavorite(this)
  },

  saveToActiveProject() {
    addPageToActiveProject(this)
  },
})

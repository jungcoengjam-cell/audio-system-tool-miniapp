const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishGainModuleLoad = startMeasurement('增益架构/脚本加载')
const { amplifiers } = require('../../data/equipment')
const { amplifierInputStages } = require('../../data/amplifier-input-stages')
const { calculateGainStructure, voltageToDbu } = require('../../utils/gain-structure')
const { readPreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  cancelResultReportGeneration,
  createResultReportData,
  createResultReportMethods,
  resetStaleResultReport,
} = require('../../utils/result-report-controller')
const {
  buildCatalogCategories,
  buildCatalogOptions,
  filterCatalogItems,
  findCatalogModelIndex,
} = require('../../utils/catalog-selector')
const {
  addPageToActiveProject,
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')

const DEFAULT_AMPLIFIER_MODEL = 'TC-X2200B'
const PREFERENCE_KEY = 'audioTool.gainStructure.preferences'
const SELECTOR_BATCH_SIZE = 60

const targetPeaks = [
  { value: -3, label: '-3 dBFS', description: '较高输出' },
  { value: -6, label: '-6 dBFS', description: '推荐' },
  { value: -9, label: '-9 dBFS', description: '更保守' },
]

const modes = [
  { value: 'stereo', label: '立体声/单通道' },
  { value: 'bridge', label: '桥接' },
]

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function findModelIndex(model) {
  const fallbackIndex = findCatalogModelIndex(amplifierOptions, DEFAULT_AMPLIFIER_MODEL)
  return findCatalogModelIndex(amplifierOptions, model, fallbackIndex)
}

function formatStageOption(inputStage, value) {
  if (inputStage.controlType === 'voltageGain') {
    return { value, label: `${value} dB`, description: '电压增益' }
  }
  if (inputStage.unit === 'dBu') {
    return { value, label: `${value} dBu`, description: '输入灵敏度' }
  }
  return {
    value,
    label: `${value} V`,
    description: `${round(voltageToDbu(value), 1)} dBu`,
  }
}

function buildStageOptions(inputStage) {
  return (inputStage?.options || []).map((value) => formatStageOption(inputStage, value))
}

function findStageIndex(inputStage, stageOptions, requestedValue) {
  const requestedIndex = stageOptions.findIndex((item) => item.value === requestedValue)
  if (requestedIndex >= 0) return requestedIndex
  const defaultIndex = stageOptions.findIndex((item) => item.value === inputStage?.defaultValue)
  if (defaultIndex >= 0) return defaultIndex
  return stageOptions.length === 1 ? 0 : -1
}

function buildLoadOptions(amplifier, mode) {
  const table = mode === 'bridge' ? amplifier.bridgePower : amplifier.stereoPower
  return [
    { value: null, label: '请选择负载阻抗' },
    ...Object.keys(table || {})
      .map(Number)
      .sort((a, b) => a - b)
      .map((value) => ({
        value,
        label: `${value} Ω · ${table[value]} W`,
      })),
  ]
}

function buildAmplifierState(amplifierIndex, preferences = {}) {
  const amplifier = amplifiers[amplifierIndex]
  const inputStage = amplifierInputStages[amplifier.model]
  const stageOptions = buildStageOptions(inputStage)
  const sameModel = preferences.amplifierModel === amplifier.model
  const stageIndex = findStageIndex(
    inputStage,
    stageOptions,
    sameModel ? preferences.stageValue : undefined,
  )
  const modeIndex = Math.max(0, modes.findIndex(
    (item) => item.value === (sameModel ? preferences.mode : 'stereo'),
  ))
  const showPowerContext = inputStage.controlType === 'voltageGain'
  const loadOptions = showPowerContext
    ? buildLoadOptions(amplifier, modes[modeIndex].value)
    : []
  const loadIndex = showPowerContext && sameModel
    ? Math.max(0, loadOptions.findIndex((item) => item.value === preferences.loadImpedance))
    : 0

  return {
    amplifierIndex,
    selectedAmplifier: amplifierOptions[amplifierIndex],
    stageOptions,
    stageIndex,
    stageTypeLabel: inputStage.controlType === 'voltageGain' ? '电压增益档位' : '输入灵敏度档位',
    showPowerContext,
    modeIndex,
    loadOptions,
    loadIndex,
  }
}

function decorateResult(result) {
  if (!result?.valid) return result
  const attenuation = result.recommendedAttenuationDb
  const canAttenuate = result.alignmentMode !== 'insufficientDrive'
  const resultHead = result.alignmentMode === 'attenuate'
    ? {
      primaryValue: attenuation,
      primaryUnit: 'dB',
      primaryLabel: '建议系统对齐衰减',
      statusLabel: '可完成匹配',
      statusTone: 'ready',
      adjustmentText: `DSP 最终输出 -${attenuation} dB`,
    }
    : result.alignmentMode === 'insufficientDrive'
      ? {
        primaryValue: result.driveShortfallDb,
        primaryUnit: 'dB',
        primaryLabel: '距离额定输出仍差',
        statusLabel: '驱动电平不足',
        statusTone: 'warning',
        adjustmentText: `仍差 ${result.driveShortfallDb} dB`,
      }
      : {
        primaryValue: 0,
        primaryUnit: 'dB',
        primaryLabel: '建议系统对齐衰减',
        statusLabel: '直接匹配',
        statusTone: 'ready',
        adjustmentText: '无需额外衰减',
      }

  return {
    ...result,
    ...resultHead,
    executionMode: 'dsp',
    executionModeLabel: 'DSP 最终输出',
    dspInputSetting: `节目峰值约 ${result.targetPeakDbfs} dBFS；平均电平随节目内容与动态变化`,
    dspOutputSetting: canAttenuate && attenuation > 0
      ? `-${attenuation} dB`
      : '0 dB',
    dspOutputNote: canAttenuate && attenuation > 0
      ? `建议设在限幅器之后的最终输出增益；等效 0 dBFS 最大输出为 +${round(result.dspMaxOutputDbu - attenuation)} dBu。`
      : '保持单位增益；不要再增加一份相同衰减。',
    amplifierSetting: '0 dB 衰减',
    amplifierNote: '保持 0 dB 衰减或等效单位增益；仍需核对该型号面板、屏幕或软件设置。',
    placementWarning: !canAttenuate
      ? '当前目标驱动不足，DSP 和功放都不要再衰减；应更换输入级档位或提高目标峰值。'
      : '本次衰减只在 DSP 最终输出执行，功放输入电平控制不要重复衰减。',
  }
}

function calculatePageResult(state) {
  const amplifier = amplifiers[state.amplifierIndex]
  const inputStage = amplifierInputStages[amplifier.model]
  const stageOption = state.stageOptions[state.stageIndex]
  const modeOption = state.modes[state.modeIndex]
  const loadOption = state.loadOptions[state.loadIndex]
  return decorateResult(calculateGainStructure({
    amplifier,
    inputStage,
    selectedStageValue: stageOption?.value,
    mode: modeOption.value,
    loadImpedance: loadOption?.value,
    targetPeakDbfs: state.targetPeaks[state.targetPeakIndex].value,
  }))
}

function buildPreferences(state) {
  return {
    amplifierModel: state.selectedAmplifier.model,
    stageValue: state.stageOptions[state.stageIndex]?.value ?? null,
    mode: state.modes[state.modeIndex].value,
    loadImpedance: state.loadOptions[state.loadIndex]?.value ?? null,
    targetPeakDbfs: state.targetPeaks[state.targetPeakIndex].value,
  }
}

const amplifierOptions = buildCatalogOptions(amplifiers)
const amplifierCategories = buildCatalogCategories(amplifierOptions)
const initialAmplifierIndex = findModelIndex(DEFAULT_AMPLIFIER_MODEL)
const resultReportMethods = createResultReportMethods({
  performancePrefix: '增益架构',
  emptyToast: '暂无可生成的标定结果',
})
finishGainModuleLoad({ amplifiers: amplifierOptions.length })

Page({
  data: {
    amplifierCategories,
    ...buildAmplifierState(initialAmplifierIndex),
    targetPeaks,
    targetPeakIndex: 1,
    modes,
    result: null,
    currentFavorite: false,
    selectorVisible: false,
    selectorKeyword: '',
    selectorCategoryIndex: 0,
    selectorItems: [],
    selectorTotalCount: 0,
    ...createResultReportData(),
  },

  onLoad() {
    const finishInitialization = startMeasurement('增益架构/初始化总耗时')
    this._pageVisible = false
    this._favoriteSyncedSinceLoad = false
    const preferences = readPreferences(PREFERENCE_KEY)
    const amplifierIndex = findModelIndex(preferences.amplifierModel || DEFAULT_AMPLIFIER_MODEL)
    const storedTargetPeakIndex = targetPeaks.findIndex(
      (item) => item.value === preferences.targetPeakDbfs,
    )
    const targetPeakIndex = storedTargetPeakIndex >= 0 ? storedTargetPeakIndex : 1
    const amplifierState = buildAmplifierState(amplifierIndex, preferences)
    const pageState = {
      ...this.data,
      ...amplifierState,
      targetPeakIndex,
    }
    const finishCoreCalculation = startMeasurement('增益架构/核心计算', { source: 'onLoad' })
    const result = calculatePageResult(pageState)
    finishCoreCalculation({ valid: result.valid })
    const finishViewUpdate = startMeasurement('增益架构/setData视图更新', { source: 'onLoad' })
    this.setData({
      ...amplifierState,
      targetPeakIndex,
      result,
    }, () => {
      finishViewUpdate()
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        this.syncFavorite('onLoad')
        this._favoriteSyncedSinceLoad = true
      }
      finishInitialization({ model: pageState.selectedAmplifier.model })
    })
  },

  onShow() {
    this._pageVisible = true
    if (this.data.result) {
      this.syncFavorite('onShow')
      this._favoriteSyncedSinceLoad = true
    }
  },

  onHide() {
    this._pageVisible = false
  },

  onUnload() {
    this._pageVisible = false
    cancelResultReportGeneration(this)
    printPerformanceSummary('增益架构/')
  },

  openAmplifierSelector() {
    const finishFilter = startMeasurement('增益架构/设备搜索过滤', { source: 'open' })
    const selectorItems = filterCatalogItems(
      amplifierOptions,
      amplifierCategories,
      this.data.selectorKeyword,
      this.data.selectorCategoryIndex,
    )
    this._selectorMatches = selectorItems
    const visibleItems = selectorItems.slice(0, SELECTOR_BATCH_SIZE)
    finishFilter({ matches: selectorItems.length })
    const finishViewUpdate = startMeasurement('增益架构/设备搜索视图更新', { source: 'open' })
    this.setData({
      selectorVisible: true,
      selectorItems: visibleItems,
      selectorTotalCount: selectorItems.length,
    }, () => finishViewUpdate({
      matches: selectorItems.length,
      rendered: visibleItems.length,
    }))
  },

  closeAmplifierSelector() {
    this._selectorMatches = []
    this.setData({ selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
  },

  stopTap() {},

  onSelectorInput(event) {
    const selectorKeyword = event.detail.value
    const finishFilter = startMeasurement('增益架构/设备搜索过滤', { source: 'input' })
    const selectorItems = filterCatalogItems(
      amplifierOptions,
      amplifierCategories,
      selectorKeyword,
      this.data.selectorCategoryIndex,
    )
    this._selectorMatches = selectorItems
    const visibleItems = selectorItems.slice(0, SELECTOR_BATCH_SIZE)
    finishFilter({ matches: selectorItems.length })
    const finishViewUpdate = startMeasurement('增益架构/设备搜索视图更新', { source: 'input' })
    this.setData({
      selectorKeyword,
      selectorItems: visibleItems,
      selectorTotalCount: selectorItems.length,
    }, () => finishViewUpdate({
      matches: selectorItems.length,
      rendered: visibleItems.length,
    }))
  },

  onSelectorCategoryTap(event) {
    const selectorCategoryIndex = Number(event.currentTarget.dataset.index)
    if (selectorCategoryIndex !== this.data.selectorCategoryIndex) vibrate('light')
    const finishFilter = startMeasurement('增益架构/设备搜索过滤', { source: 'category' })
    const selectorItems = filterCatalogItems(
      amplifierOptions,
      amplifierCategories,
      this.data.selectorKeyword,
      selectorCategoryIndex,
    )
    this._selectorMatches = selectorItems
    const visibleItems = selectorItems.slice(0, SELECTOR_BATCH_SIZE)
    finishFilter({ matches: selectorItems.length })
    const finishViewUpdate = startMeasurement('增益架构/设备搜索视图更新', { source: 'category' })
    this.setData({
      selectorCategoryIndex,
      selectorItems: visibleItems,
      selectorTotalCount: selectorItems.length,
    }, () => finishViewUpdate({
      matches: selectorItems.length,
      rendered: visibleItems.length,
    }))
  },

  appendSelectorItems() {
    const selectorItems = this._selectorMatches || []
    const rendered = this.data.selectorItems.length
    if (rendered >= selectorItems.length) return
    const visibleItems = selectorItems.slice(0, rendered + SELECTOR_BATCH_SIZE)
    const finishViewUpdate = startMeasurement('增益架构/设备搜索视图更新', { source: 'append' })
    this.setData({ selectorItems: visibleItems }, () => finishViewUpdate({
      matches: selectorItems.length,
      rendered: visibleItems.length,
    }))
  },

  selectAmplifier(event) {
    const amplifierIndex = Number(event.currentTarget.dataset.index)
    if (amplifierIndex === this.data.amplifierIndex) {
      this._selectorMatches = []
      this.setData({ selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
      return
    }
    vibrate('light')
    this._selectorMatches = []
    this.commitCalculatedState({
      ...buildAmplifierState(amplifierIndex),
      selectorVisible: false,
      selectorItems: [],
      selectorTotalCount: 0,
    }, 'amplifier')
  },

  openAmplifierDetail(event) {
    this._selectorMatches = []
    this.setData({ selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
    wx.navigateTo({
      url: `/pages/products/detail?type=amplifier&model=${encodeURIComponent(event.currentTarget.dataset.model)}`,
    })
  },

  setSelectionAndCalculate(key, index) {
    if (!Number.isInteger(index) || this.data[key] === index) return false
    vibrate('light')
    this.commitCalculatedState({ [key]: index }, key)
    return true
  },

  onStageTap(event) {
    this.setSelectionAndCalculate('stageIndex', Number(event.currentTarget.dataset.index))
  },

  onTargetPeakTap(event) {
    this.setSelectionAndCalculate('targetPeakIndex', Number(event.currentTarget.dataset.index))
  },

  onModeTap(event) {
    const modeIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(modeIndex) || modeIndex === this.data.modeIndex) return
    vibrate('light')
    const amplifier = amplifiers[this.data.amplifierIndex]
    this.commitCalculatedState({
      modeIndex,
      loadOptions: buildLoadOptions(amplifier, this.data.modes[modeIndex].value),
      loadIndex: 0,
    }, 'mode')
  },

  onLoadChange(event) {
    this.setSelectionAndCalculate('loadIndex', Number(event.detail.value))
  },

  calculate() {
    return this.commitCalculatedState({}, 'calculate')
  },

  commitCalculatedState(changes = {}, source = 'interaction') {
    const finishCalculation = startMeasurement('增益架构/计算到结果更新', { source })
    const pageState = { ...this.data, ...changes }
    const finishCoreCalculation = startMeasurement('增益架构/核心计算', { source })
    const result = calculatePageResult(pageState)
    finishCoreCalculation({ valid: result.valid })
    const preferences = buildPreferences(pageState)
    const resultReportChanges = resetStaleResultReport(
      this,
      this.getRecordPayload(pageState, result),
    )
    const finishViewUpdate = startMeasurement('增益架构/setData视图更新', {
      source,
    })
    this.setData({ ...changes, result, ...resultReportChanges }, () => {
      finishViewUpdate()
      const finishPreferenceWrite = startMeasurement('增益架构/写入偏好')
      const preferencesChanged = writePreferences(PREFERENCE_KEY, preferences)
      finishPreferenceWrite({ changed: preferencesChanged })
      this.syncFavorite('calculation')
      finishCalculation({ valid: result.valid, preferencesChanged })
    })
    return result
  },

  getPreferences(state = this.data) {
    return buildPreferences(state)
  },

  getRecordLookupPayload() {
    return this.data.result?.valid
      ? { module: 'gainStructure', preferences: this.getPreferences() }
      : null
  },

  syncFavorite(source) {
    const finishFavoriteSync = startMeasurement('增益架构/同步收藏状态', { source })
    const currentFavorite = syncPageFavorite(this)
    finishFavoriteSync({ currentFavorite })
    return currentFavorite
  },

  getResultText(state = this.data, result = state.result) {
    if (!result?.valid) return ''
    const stage = state.stageOptions[state.stageIndex]
    const context = state.showPowerContext
      ? `${state.modes[state.modeIndex].label} · ${state.loadOptions[state.loadIndex].label}`
      : '按厂家输入灵敏度标定'
    const adjustment = result.alignmentMode === 'insufficientDrive'
      ? `驱动差额：${result.driveShortfallDb} dB`
      : `系统对齐衰减：${result.recommendedAttenuationDb} dB`

    return [
      '系统增益结构助手',
      '结果性质：厂家输入级参数与 DSP 标定计算',
      `功放：${state.selectedAmplifier.model}`,
      `输入级档位：${stage.label}（${stage.description}）`,
      `工作条件：${context}`,
      'DSP 标定：0 dBFS = +18.4 dBu',
      `目标峰值：${result.targetPeakDbfs} dBFS = ${result.targetDspOutputDbu} dBu`,
      `功放额定输出输入点：${result.fullPowerInputVoltage} V = ${result.fullPowerInputDbu} dBu`,
      adjustment,
      `衰减执行位置：${result.executionModeLabel}`,
      `DSP 输入表目标：${result.dspInputSetting}`,
      `DSP 最终输出增益：${result.dspOutputSetting}`,
      `功放输入电平控制：${result.amplifierSetting}`,
      result.placementWarning,
      '结果边界：系统对齐衰减只建立电气基准；相同衰减不代表相同功放功率、音箱端电压或现场声压级。',
      '后续步骤：先按功放、音箱和连接方式设置限幅保护，再在代表性听音位置校准现场声压。',
      '现场响度：让调音台工作在正常范围；如需长期大幅降低总推子，应记录并调整独立的 DSP 分区/扬声器组校准衰减，并重新复核限幅保护。',
      '现场复核：用测试信号、电平表和功放指示灯核对；理论值不替代实际校准。',
    ].join('\n')
  },

  getRecordPayload(state = this.data, result = state.result) {
    const resultText = this.getResultText(state, result)
    if (!resultText) return null
    const stage = state.stageOptions[state.stageIndex]
    const summary = result.alignmentMode === 'insufficientDrive'
      ? `目标峰值 ${result.targetPeakDbfs} dBFS · 驱动仍差 ${result.driveShortfallDb} dB`
      : `目标峰值 ${result.targetPeakDbfs} dBFS · 对齐衰减 ${result.recommendedAttenuationDb} dB`

    return {
      module: 'gainStructure',
      title: `${state.selectedAmplifier.model} · ${stage.label}`,
      summary,
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

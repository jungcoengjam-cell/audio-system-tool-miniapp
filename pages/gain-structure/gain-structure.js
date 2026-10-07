const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishGainModuleLoad = startMeasurement('增益架构/脚本加载')
const { amplifiers } = require('../../data/equipment')
const { amplifierInputStages } = require('../../data/amplifier-input-stages')
const { calculateGainStructure, voltageToDbu } = require('../../utils/gain-structure')
const { readPreferences, removePreferences, writePreferences } = require('../../utils/preferences')
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
const { addRecordToProject, createProject, getWorkspaceSnapshot } = require('../../utils/records')
const { drawAndExportReport } = require('../../utils/report-canvas')
const {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  buildResultReportPayload,
  calculateResultReportHeight,
  drawResultReport,
  getExportDimensions,
} = require('../../utils/result-report')

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
const groupTabs = [
  { key: 'amplifier', label: '功放' },
  { key: 'load', label: '负载' },
  { key: 'calibration', label: '标定' },
]

function getGroupTabs(showPowerContext) {
  return showPowerContext ? groupTabs : groupTabs.filter((item) => item.key !== 'load')
}

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

function validIndex(items, index) {
  return Number.isInteger(index) && index >= 0 && index < items.length
}

function buildLoadOptions(amplifier, mode) {
  if (!amplifier) return []
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
  if (!amplifier) {
    return {
      amplifierIndex: -1,
      selectedAmplifier: null,
      groupTabs: getGroupTabs(false),
      stageOptions: [],
      stageIndex: -1,
      stageTypeLabel: '输入级档位',
      showPowerContext: false,
      modeIndex: 0,
      loadOptions: [],
      loadIndex: -1,
    }
  }
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
  const storedLoadIndex = showPowerContext && sameModel
    ? loadOptions.findIndex((item) => item.value === preferences.loadImpedance)
    : -1
  const loadIndex = showPowerContext ? Math.max(0, storedLoadIndex) : -1

  return {
    amplifierIndex,
    selectedAmplifier: amplifierOptions[amplifierIndex],
    stageOptions,
    stageIndex,
    stageTypeLabel: inputStage.controlType === 'voltageGain' ? '电压增益档位' : '输入灵敏度档位',
    showPowerContext,
    groupTabs: getGroupTabs(showPowerContext),
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
  const inputStage = amplifier ? amplifierInputStages[amplifier.model] : null
  const stageOption = state.stageOptions?.[state.stageIndex]
  const modeOption = state.modes?.[state.modeIndex]
  const loadOption = state.loadOptions?.[state.loadIndex]
  return decorateResult(calculateGainStructure({
    amplifier,
    inputStage,
    selectedStageValue: stageOption?.value,
    mode: modeOption?.value,
    loadImpedance: loadOption?.value,
    targetPeakDbfs: state.targetPeaks?.[state.targetPeakIndex]?.value,
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

function buildCalculationView(result, hasInputs, stale = false) {
  if (stale) {
    return {
      calculationState: 'stale',
      hasValidResult: false,
      outputStatus: '结果需要重新计算',
      outputHint: '输入已改变，重新计算后再使用结果操作。',
      canCalculate: hasInputs,
      canReset: hasInputs,
      currentFavorite: false,
    }
  }
  if (!hasInputs && !result) {
    return {
      calculationState: 'empty',
      hasValidResult: false,
      outputStatus: '等待输入',
      outputHint: '选择功放型号开始设置。',
      canCalculate: false,
      canReset: false,
      currentFavorite: false,
    }
  }
  if (result?.valid) {
    return {
      calculationState: 'valid',
      hasValidResult: true,
      outputStatus: result.statusLabel,
      outputHint: '',
      canCalculate: true,
      canReset: hasInputs,
      currentFavorite: false,
    }
  }
  return {
    calculationState: result ? 'invalid' : 'incomplete',
    hasValidResult: false,
    outputStatus: result ? '请检查现场档位' : '参数尚未齐全',
    outputHint: result?.warning || '请补全功放型号和输入级档位后计算。',
    canCalculate: hasInputs,
    canReset: hasInputs,
    currentFavorite: false,
  }
}

function getProjectKeyboardHeight(event) {
  const eventHeight = Number(event?.size?.windowHeight)
  if (Number.isFinite(eventHeight) && eventHeight > 0) return eventHeight
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const height = Number(info?.windowHeight)
    return Number.isFinite(height) && height > 0 ? height : 0
  } catch (error) {
    return 0
  }
}

function getProjectKeyboardField(event) {
  return (event?.currentTarget?.dataset?.projectField
    || event?.target?.dataset?.projectField || '')
}

function getProjectKeyboardEpisode(event) {
  const raw = event?.currentTarget?.dataset?.projectEpisode
    ?? event?.target?.dataset?.projectEpisode
  const episode = Number(raw)
  return Number.isSafeInteger(episode) && episode >= 0 ? episode : null
}

const amplifierOptions = buildCatalogOptions(amplifiers)
const amplifierCategories = buildCatalogCategories(amplifierOptions)
const resultReportMethods = createResultReportMethods({
  performancePrefix: '增益架构',
  emptyToast: '暂无可生成的标定结果',
})
finishGainModuleLoad({ amplifiers: amplifierOptions.length })

Page({
  data: {
    amplifierCategories,
    ...buildAmplifierState(-1),
    groupTabs,
    activeGroup: 'amplifier',
    targetPeaks,
    targetPeakIndex: 1,
    modes,
    result: null,
    calculationState: 'empty',
    hasValidResult: false,
    hasDraftInputs: false,
    hasSavedDraft: false,
    canCalculate: false,
    canReset: false,
    outputStatus: '等待输入',
    outputHint: '选择功放型号开始设置。',
    resetError: '',
    loadReminderActive: false,
    currentFavorite: false,
    selectorVisible: false,
    selectorKeyword: '',
    selectorCategoryIndex: 0,
    selectorItems: [],
    selectorTotalCount: 0,
    shareSheetVisible: false,
    resultReportError: '',
    isCheckingResultReportCache: false,
    projectSheetVisible: false,
    projectStep: 'select',
    projectLoadState: 'idle',
    projectError: '',
    projectSearch: '',
    projectItems: [],
    projectTargetId: '',
    projectTargetName: '',
    newProjectName: '',
    projectNameError: '',
    projectSaveError: '',
    projectKeyboardEpisode: 0,
    projectKeyboardActive: false,
    projectKeyboardVisibleHeight: 0,
    projectKeyboardLift: 0,
    projectKeyboardPanelStyle: '',
    isSavingProject: false,
    savedProjectName: '',
    pageContainerSupported: false,
    ...createResultReportData(),
  },

  onLoad() {
    const finishInitialization = startMeasurement('增益架构/初始化总耗时')
    this._pageVisible = false
    this._isUnloaded = false
    this._favoriteSyncedSinceLoad = false
    this._selectorMatches = []
    this._projectKeyboardEpisode = 0
    this._projectRequestId = 0
    this._projectSavePending = false
    this._pageContainerEpoch = 0
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    this._inputRevision = 0
    let pageContainerSupported = false
    try {
      pageContainerSupported = typeof wx.canIUse === 'function' && wx.canIUse('page-container')
    } catch (error) {}
    const preferences = readPreferences(PREFERENCE_KEY) || {}
    const hasSavedDraft = Object.keys(preferences).length > 0
    const amplifierIndex = hasSavedDraft
      ? findModelIndex(preferences.amplifierModel || DEFAULT_AMPLIFIER_MODEL)
      : -1
    const storedTargetPeakIndex = targetPeaks.findIndex(
      (item) => item.value === preferences.targetPeakDbfs,
    )
    const targetPeakIndex = storedTargetPeakIndex >= 0 ? storedTargetPeakIndex : 1
    const amplifierState = buildAmplifierState(amplifierIndex, preferences)
    const pageState = {
      ...this.data,
      ...amplifierState,
      targetPeakIndex,
      pageContainerSupported,
    }
    const result = hasSavedDraft ? calculatePageResult(pageState) : null
    const finishViewUpdate = startMeasurement('增益架构/setData视图更新', { source: 'onLoad' })
    this.setData({
      ...amplifierState,
      targetPeakIndex,
      pageContainerSupported,
      result,
      hasSavedDraft,
      hasDraftInputs: hasSavedDraft,
      loadReminderActive: Boolean(amplifierState.showPowerContext && amplifierState.loadIndex === 0),
      ...buildCalculationView(result, hasSavedDraft),
    }, () => {
      finishViewUpdate({ source: 'onLoad', hasSavedDraft })
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        this.syncFavorite('onLoad')
        this._favoriteSyncedSinceLoad = true
      }
      finishInitialization({ valid: Boolean(result?.valid), hasSavedDraft })
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
    this._projectRequestId = (this._projectRequestId || 0) + 1
    this._projectSavePending = false
    this._projectSnapshotForSave = null
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    this._pageContainerEpoch = (this._pageContainerEpoch || 0) + 1
    this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    if (this.data.isGeneratingResultReport || this.data.isCheckingResultReportCache) {
      cancelResultReportGeneration(this)
      this._reportCacheCheckRevision = 0
    }
    this.setData({
      shareSheetVisible: false,
      isCheckingResultReportCache: false,
      projectSheetVisible: false,
      selectorVisible: false,
      resultReportPreviewVisible: false,
    })
  },

  onUnload() {
    this._pageVisible = false
    this._isUnloaded = true
    this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    cancelResultReportGeneration(this)
    printPerformanceSummary('增益架构/')
  },

  onGroupTap(event) {
    const key = event?.currentTarget?.dataset?.group
    if (!this.data.groupTabs.some((item) => item.key === key) || key === this.data.activeGroup) return false
    vibrate('light')
    this.setData({ activeGroup: key })
    return true
  },

  openPageContainerOverlay(name) {
    this._pageContainerEpoch = (this._pageContainerEpoch || 0) + 1
    this._activePageContainerOverlay = { name, epoch: this._pageContainerEpoch }
    this._pageContainerLeave = null
  },

  clearPageContainerOverlay(name) {
    if (name && this._activePageContainerOverlay?.name !== name) return false
    this._pageContainerEpoch = (this._pageContainerEpoch || 0) + 1
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    return true
  },

  onPageContainerBeforeLeave() {
    if (!this._activePageContainerOverlay || this._pageContainerLeave) return false
    this._pageContainerLeave = { ...this._activePageContainerOverlay }
    return true
  },

  onPageContainerAfterLeave() {
    const leaving = this._pageContainerLeave
    this._pageContainerLeave = null
    if (!leaving || this._activePageContainerOverlay?.epoch !== leaving.epoch) return false
    const close = {
      selector: this.closeAmplifierSelector,
      share: this.closeSharePreview,
      project: this.closeProjectSheet,
    }[leaving.name]
    if (close) close.call(this)
    return Boolean(close)
  },

  onPageContainerClickOverlay() {
    const name = this._activePageContainerOverlay?.name
    const close = {
      selector: this.closeAmplifierSelector,
      share: this.closeSharePreview,
      project: this.closeProjectSheet,
    }[name]
    if (close) close.call(this)
  },

  openAmplifierSelector() {
    if (this.data.selectorVisible || this.data.shareSheetVisible || this.data.projectSheetVisible) return false
    const selectorKeyword = ''
    const selectorCategoryIndex = 0
    const finishFilter = startMeasurement('增益架构/设备搜索过滤', { source: 'open' })
    const selectorItems = filterCatalogItems(
      amplifierOptions,
      amplifierCategories,
      selectorKeyword,
      selectorCategoryIndex,
    )
    this._selectorMatches = selectorItems
    const visibleItems = selectorItems.slice(0, SELECTOR_BATCH_SIZE)
    finishFilter({ matches: selectorItems.length })
    this.openPageContainerOverlay('selector')
    const finishViewUpdate = startMeasurement('增益架构/设备搜索视图更新', { source: 'open' })
    this.setData({
      selectorVisible: true,
      selectorKeyword,
      selectorCategoryIndex,
      selectorItems: visibleItems,
      selectorTotalCount: selectorItems.length,
    }, () => finishViewUpdate({
      matches: selectorItems.length,
      rendered: visibleItems.length,
    }))
  },

  closeAmplifierSelector() {
    this.clearPageContainerOverlay('selector')
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
    const selectorCategoryIndex = Number(event?.currentTarget?.dataset?.index)
    if (!validIndex(amplifierCategories, selectorCategoryIndex)) return
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
    const amplifierIndex = Number(event?.currentTarget?.dataset?.index)
    if (!validIndex(amplifiers, amplifierIndex)) return false
    if (amplifierIndex === this.data.amplifierIndex) {
      this.clearPageContainerOverlay('selector')
      this._selectorMatches = []
      this.setData({ selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
      return true
    }
    vibrate('light')
    this._selectorMatches = []
    const amplifierState = buildAmplifierState(amplifierIndex)
    this.commitCalculatedState({
      ...amplifierState,
      activeGroup: !amplifierState.showPowerContext && this.data.activeGroup === 'load'
        ? 'amplifier'
        : this.data.activeGroup,
      selectorVisible: false,
      selectorItems: [],
      selectorTotalCount: 0,
    }, 'amplifier', {
      stale: true,
      loadReminderActive: amplifierState.showPowerContext,
    })
    return true
  },

  openAmplifierDetail(event) {
    this.clearPageContainerOverlay('selector')
    this._selectorMatches = []
    this.setData({ selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
    wx.navigateTo({
      url: `/pages/products/detail?type=amplifier&model=${encodeURIComponent(event.currentTarget.dataset.model)}`,
    })
  },

  setSelectionAndCalculate(key, index) {
    const optionsByKey = {
      stageIndex: this.data.stageOptions,
      targetPeakIndex: this.data.targetPeaks,
      loadIndex: this.data.loadOptions,
    }
    const options = optionsByKey[key]
    if (!validIndex(options || [], index)
      || (key === 'loadIndex' && index === 0)
      || this.data[key] === index) return false
    vibrate('light')
    this.commitCalculatedState({ [key]: index }, key, {
      stale: true,
      loadReminderActive: key === 'loadIndex' ? false : this.data.loadReminderActive,
    })
    return true
  },

  onStageTap(event) {
    const index = Number(event?.currentTarget?.dataset?.index)
    return this.setSelectionAndCalculate('stageIndex', index)
  },

  onTargetPeakTap(event) {
    const index = Number(event?.currentTarget?.dataset?.index)
    return this.setSelectionAndCalculate('targetPeakIndex', index)
  },

  onModeTap(event) {
    const modeIndex = Number(event?.currentTarget?.dataset?.index)
    if (!validIndex(modes, modeIndex) || modeIndex === this.data.modeIndex || !this.data.showPowerContext) return false
    vibrate('light')
    const amplifier = amplifiers[this.data.amplifierIndex]
    this.commitCalculatedState({
      modeIndex,
      loadOptions: buildLoadOptions(amplifier, this.data.modes[modeIndex].value),
      loadIndex: 0,
    }, 'mode', { stale: true, loadReminderActive: true })
    return true
  },

  onLoadChange(event) {
    const index = Number(event?.detail?.value)
    return this.setSelectionAndCalculate('loadIndex', index)
  },

  calculate() {
    return this.commitCalculatedState({}, 'calculate', { stale: false })
  },

  commitCalculatedState(changes = {}, source = 'interaction', options = {}) {
    const finishCalculation = startMeasurement('增益架构/计算到结果更新', { source })
    const pageState = { ...this.data, ...changes }
    const hasInputChange = Object.keys(changes).some((key) => this.data[key] !== changes[key])
    if (hasInputChange) this._inputRevision = (this._inputRevision || 0) + 1
    if (hasInputChange) this.clearPageContainerOverlay()
    const hasDraftInputs = Boolean(this.data.hasDraftInputs || hasInputChange)
    const stale = Boolean(options.stale)
    let result = null
    if (!stale && hasDraftInputs) {
      const finishCoreCalculation = startMeasurement('增益架构/核心计算', { source })
      result = calculatePageResult(pageState)
      finishCoreCalculation({ valid: result.valid })
    }
    const preferences = Number.isInteger(pageState.amplifierIndex)
      && pageState.amplifierIndex >= 0 && amplifiers[pageState.amplifierIndex]
      ? buildPreferences(pageState)
      : null
    const resultReportChanges = resetStaleResultReport(
      this,
      result?.valid ? this.getRecordPayload(pageState, result) : null,
    )
    const shouldCloseProject = hasInputChange && this.data.projectSheetVisible
    if (shouldCloseProject) {
      this._projectRequestId = (this._projectRequestId || 0) + 1
      this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    }
    const view = buildCalculationView(result, hasDraftInputs, stale)
    const loadReminderActive = options.loadReminderActive === undefined
      ? this.data.loadReminderActive
      : Boolean(options.loadReminderActive)
    this.setData({
      ...changes,
      result,
      hasDraftInputs,
      hasSavedDraft: Boolean(preferences),
      loadReminderActive,
      ...view,
      ...resultReportChanges,
      ...(hasInputChange ? {
        shareSheetVisible: false,
        isCheckingResultReportCache: false,
        resultReportPreviewVisible: false,
        resultReportError: '',
      } : {}),
      ...(shouldCloseProject ? { projectSheetVisible: false, isSavingProject: false } : {}),
    }, () => {
      const finishPreferenceWrite = startMeasurement('增益架构/写入偏好')
      const preferencesChanged = preferences
        ? writePreferences(PREFERENCE_KEY, preferences)
        : false
      finishPreferenceWrite({ changed: preferencesChanged })
      if (result?.valid) this.syncFavorite('calculation')
      else this.setData({ currentFavorite: false })
      finishCalculation({ valid: Boolean(result?.valid), stale, preferencesChanged })
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

  preventTouchMove() {},

  openSharePreview() {
    if (!this.data.hasValidResult || this.data.shareSheetVisible
      || this.data.projectSheetVisible || this.data.selectorVisible) return false
    vibrate('light')
    this.openPageContainerOverlay('share')
    this.setData({ shareSheetVisible: true, resultReportError: '' }, () => {
      if (!this._isUnloaded && this.data.shareSheetVisible) this.generateResultReportImage()
    })
    return true
  },

  closeSharePreview() {
    if (!this.data.shareSheetVisible && !this.data.isGeneratingResultReport
      && !this.data.isCheckingResultReportCache) return false
    const wasGenerating = Boolean(this.data.isGeneratingResultReport)
    if (wasGenerating || this.data.isCheckingResultReportCache) {
      cancelResultReportGeneration(this)
      this._reportCacheCheckRevision = 0
      if (wasGenerating) this.resultReportSignature = ''
    }
    this.clearPageContainerOverlay('share')
    this.setData({
      shareSheetVisible: false,
      isCheckingResultReportCache: false,
      resultReportPreviewVisible: false,
      resultReportError: '',
    })
    return true
  },

  closeResultReportPreview() {
    return this.closeSharePreview()
  },

  retryResultReport() {
    if (!this.data.shareSheetVisible || this.data.isGeneratingResultReport
      || this.data.isCheckingResultReportCache) return false
    this.setData({ resultReportError: '' }, () => this.generateResultReportImage())
    return true
  },

  generateResultReportImage() {
    const record = this.getRecordPayload()
    const payload = buildResultReportPayload(record)
    if (!payload || !this.data.hasValidResult) {
      if (typeof wx.showToast === 'function') wx.showToast({ title: '暂无可生成的标定结果', icon: 'none' })
      return false
    }
    if (this.data.isGeneratingResultReport || this.data.isCheckingResultReportCache) return false
    const signature = this.getResultReportSignature(record)
    if (this.data.resultReportImagePath && this.resultReportSignature === signature) {
      const path = this.data.resultReportImagePath
      const revision = (this.resultReportRevision || 0) + 1
      this.resultReportRevision = revision
      this._reportCacheCheckRevision = revision
      this.setData({ isCheckingResultReportCache: true, resultReportPreviewVisible: false, resultReportError: '' }, () => {
        const isCurrent = () => !this._isUnloaded && this.data.shareSheetVisible
          && this._reportCacheCheckRevision === revision
          && this.resultReportRevision === revision
          && this.getResultReportSignature() === signature
        const showCached = () => {
          if (!isCurrent()) return
          this._reportCacheCheckRevision = 0
          this.setData({ isCheckingResultReportCache: false, resultReportPreviewVisible: true })
        }
        const regenerate = () => {
          if (!isCurrent()) return
          this._reportCacheCheckRevision = 0
          this.resultReportSignature = ''
          this.setData({
            isCheckingResultReportCache: false,
            resultReportImagePath: '',
            resultReportPreviewVisible: false,
          }, () => {
            if (!this._isUnloaded && this.data.shareSheetVisible
              && this.resultReportRevision === revision
              && this.getResultReportSignature() === signature) this.generateResultReportImage()
          })
        }
        try {
          const fileSystem = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
          if (!fileSystem || typeof fileSystem.access !== 'function') return regenerate()
          fileSystem.access({ path, success: showCached, fail: regenerate })
        } catch (error) { regenerate() }
      })
      return true
    }
    if (typeof wx.createCanvasContext !== 'function'
      || typeof wx.canvasToTempFilePath !== 'function') {
      this.setData({ resultReportError: '当前微信版本暂不支持生成图片。' })
      return false
    }
    const resultReportCanvasHeight = calculateResultReportHeight(payload)
    const revision = (this.resultReportRevision || 0) + 1
    this.resultReportRevision = revision
    this._reportCacheCheckRevision = 0
    this.resultReportPendingSignature = signature
    this.setData({
      resultReportCanvasHeight,
      resultReportImagePath: '',
      resultReportPreviewVisible: false,
      isGeneratingResultReport: true,
      isCheckingResultReportCache: false,
      resultReportError: '',
    }, () => {
      const isCurrent = () => !this._isUnloaded
        && this.resultReportRevision === revision
        && this.resultReportPendingSignature === signature
        && this.getResultReportSignature() === signature
      const finish = (changes = {}) => {
        if (!isCurrent()) return false
        this.resultReportPendingSignature = ''
        this.setData({ isGeneratingResultReport: false, ...changes })
        return true
      }
      try {
        drawAndExportReport(this, {
          canvasId: REPORT_CANVAS_ID,
          isCurrent,
          width: REPORT_WIDTH,
          height: resultReportCanvasHeight,
          draw: (context) => drawResultReport(context, payload, resultReportCanvasHeight),
          getExportOptions: () => getExportDimensions(resultReportCanvasHeight),
          startExportMeasurement: (dimensions) => startMeasurement('增益架构/结果图导出', dimensions),
          onSuccess: (imagePath) => {
            if (!imagePath) return finish({ resultReportError: '图片生成失败，请重试。' })
            this.resultReportSignature = signature
            finish({
              resultReportImagePath: imagePath,
              resultReportPreviewVisible: true,
              resultReportError: '',
            })
          },
          onFailure: () => finish({ resultReportError: '图片生成失败，请重试。' }),
        })
      } catch (error) {
        finish({ resultReportError: '图片生成失败，请重试。' })
      }
    })
    return true
  },

  previewResultReportImage() {
    if (!this.data.shareSheetVisible || !this.data.resultReportImagePath
      || !this.data.hasValidResult || this.data.isGeneratingResultReport
      || this.data.isCheckingResultReportCache) return false
    return resultReportMethods.previewResultReportImage.call(this)
  },

  shareResultReportImage() {
    if (!this.data.shareSheetVisible || !this.data.resultReportImagePath
      || !this.data.hasValidResult || this.data.isGeneratingResultReport
      || this.data.isCheckingResultReportCache) return false
    return resultReportMethods.shareResultReportImage.call(this)
  },

  saveResultReportImage() {
    if (!this.data.shareSheetVisible || !this.data.resultReportImagePath
      || !this.data.hasValidResult || this.data.isGeneratingResultReport
      || this.data.isCheckingResultReportCache) return false
    return resultReportMethods.saveResultReportImage.call(this)
  },

  requestReset() {
    if (!this.data.canReset || this._resetModalPending) return false
    vibrate('light')
    this._resetModalPending = true
    wx.showModal({
      title: '清空本次计算？',
      content: '将清空当前输入和结果，已保存的收藏与项目记录会保留。',
      confirmText: '清空',
      cancelText: '取消',
      success: ({ confirm }) => {
        this._resetModalPending = false
        if (!this._isUnloaded && confirm) this.clearDraft()
      },
      fail: () => { this._resetModalPending = false },
    })
    return true
  },

  clearDraft() {
    if (this._isUnloaded) return false
    const preferencesRemoved = removePreferences(PREFERENCE_KEY)
    if (!preferencesRemoved) {
      this.setData({ resetError: '本地草稿清除失败，请重试。' })
      return false
    }
    this._inputRevision = (this._inputRevision || 0) + 1
    this._projectRequestId = (this._projectRequestId || 0) + 1
    this._projectSavePending = false
    this.clearPageContainerOverlay()
    this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    this._selectorMatches = []
    cancelResultReportGeneration(this)
    this.resultReportSignature = ''
    this._projectSnapshotForSave = null
    this._lastProjectTarget = null
    this.setData({
      ...buildAmplifierState(-1),
      activeGroup: 'amplifier',
      targetPeakIndex: 1,
      result: null,
      ...buildCalculationView(null, false),
      hasDraftInputs: false,
      hasSavedDraft: false,
      loadReminderActive: false,
      selectorVisible: false,
      selectorKeyword: '',
      selectorCategoryIndex: 0,
      selectorItems: [],
      selectorTotalCount: 0,
      shareSheetVisible: false,
      isCheckingResultReportCache: false,
      resetError: '',
      resultReportError: '',
      resultReportImagePath: '',
      resultReportPreviewVisible: false,
      isGeneratingResultReport: false,
      currentFavorite: false,
      projectSheetVisible: false,
      projectStep: 'select',
      projectLoadState: 'idle',
      projectError: '',
      projectSearch: '',
      projectItems: [],
      projectTargetId: '',
      projectTargetName: '',
      newProjectName: '',
      projectNameError: '',
      projectSaveError: '',
      isSavingProject: false,
      savedProjectName: '',
    })
    return true
  },

  openProjectSheet() {
    if (!this.data.hasValidResult || this.data.projectSheetVisible
      || this.data.shareSheetVisible || this.data.selectorVisible || this._projectSavePending) return false
    const record = this.getRecordPayload()
    if (!record) return false
    vibrate('light')
    this.openPageContainerOverlay('project')
    this._projectRequestId = (this._projectRequestId || 0) + 1
    this._projectSnapshotForSave = {
      payload: JSON.parse(JSON.stringify(record)),
      signature: JSON.stringify(record),
      revision: this._inputRevision || 0,
    }
    const lastTarget = this._lastProjectTarget
    const keyboard = this.resetProjectKeyboardState({ captureBaseline: true, updateView: false })
    this.setData({
      projectSheetVisible: true,
      projectStep: 'select',
      projectLoadState: 'loading',
      projectError: '',
      projectSearch: '',
      projectItems: [],
      projectTargetId: '',
      projectTargetName: '',
      projectSaveError: '',
      projectNameError: '',
      newProjectName: '',
      isSavingProject: false,
      ...keyboard,
    })
    if (!this.refreshProjects()) return true
    if (lastTarget) {
      const current = this._projectSnapshot.projects.find((item) => item.id === lastTarget.id)
      if (current && current.name === lastTarget.name) {
        this.setProjectTarget(current)
      } else {
        this._lastProjectTarget = null
        this.setData({ projectSaveError: '上次选择的项目已改名或不存在，请重新选择。' })
      }
    }
    return true
  },

  refreshProjects() {
    let snapshot
    try {
      snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    } catch (error) {
      snapshot = null
    }
    this._projectSnapshot = snapshot
    if (!snapshot || snapshot.ok === false) {
      this.setData({
        projectLoadState: 'error',
        projectError: '项目列表读取失败，请重试。',
        projectItems: [],
      })
      return false
    }
    this.updateProjectList(snapshot.projects || [])
    this.setData({ projectLoadState: 'ready', projectError: '' })
    return true
  },

  updateProjectList(projects = this._projectSnapshot?.projects || []) {
    const keyword = String(this.data.projectSearch || '').trim().toLocaleLowerCase()
    const projectItems = projects
      .filter((item) => !keyword || item.name.toLocaleLowerCase().includes(keyword))
      .map(({ id, name }) => ({ id, name }))
    this.setData({ projectItems })
  },

  onProjectSearch(event) {
    const projectSearch = String(event?.detail?.value || '')
    const keyword = projectSearch.trim().toLocaleLowerCase()
    const projects = this._projectSnapshot?.projects || []
    const projectItems = projects
      .filter((item) => !keyword || item.name.toLocaleLowerCase().includes(keyword))
      .map(({ id, name }) => ({ id, name }))
    const targetIsVisible = !this.data.projectTargetId
      || projectItems.some((item) => item.id === this.data.projectTargetId)
    this.setData({
      projectSearch,
      projectItems,
      projectSaveError: targetIsVisible ? '' : '搜索结果已更改，请重新选择可见项目。',
      ...(!targetIsVisible ? { projectTargetId: '', projectTargetName: '' } : {}),
    })
  },

  chooseProject(event) {
    if (!this.data.projectSheetVisible || this.data.projectStep !== 'select') return false
    const id = event?.currentTarget?.dataset?.id
    const project = this._projectSnapshot?.projects?.find((item) => item.id === id)
    if (!project) return false
    this.setProjectTarget(project)
    return true
  },

  setProjectTarget(project) {
    if (!project || !project.id || !project.name) return false
    this._lastProjectTarget = { id: project.id, name: project.name }
    this.setData({
      projectTargetId: project.id,
      projectTargetName: project.name,
      projectSaveError: '',
    })
    return true
  },

  beginNewProject() {
    if (!this.data.projectSheetVisible || this.data.projectLoadState !== 'ready') return false
    const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    this.setData({
      projectStep: 'create',
      newProjectName: '',
      projectNameError: '',
      projectSaveError: '',
      ...keyboard,
    })
    return true
  },

  onNewProjectNameInput(event) {
    this.setData({
      newProjectName: String(event?.detail?.value || ''),
      projectNameError: '',
      projectSaveError: '',
    })
  },

  createProjectFromForm() {
    if (!this.data.projectSheetVisible || this.data.projectStep !== 'create') return false
    const name = String(this.data.newProjectName || '').trim()
    if (!name || name.length > 30) {
      this.setData({ projectNameError: !name ? '请输入项目名称。' : '项目名称最多 30 个字符。' })
      return false
    }
    let snapshot
    try {
      snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    } catch (error) {
      snapshot = null
    }
    if (!snapshot || snapshot.ok === false) {
      this.setData({ projectNameError: '读取项目列表失败，请重试后创建。' })
      return false
    }
    const existing = snapshot.projects.find((item) => item.name === name)
    const project = existing || createProject(name)
    if (!project) {
      this.setData({ projectNameError: '项目创建失败，请检查本地存储后重试。' })
      return false
    }
    let refreshed
    try {
      refreshed = getWorkspaceSnapshot({ forceRefresh: true })
    } catch (error) {
      refreshed = null
    }
    if (!refreshed || refreshed.ok === false) {
      this._projectSnapshot = refreshed
      this.setData({
        projectLoadState: 'error',
        projectError: '项目已创建，但列表读取失败；请重试后选择。',
        projectNameError: '',
      })
      return false
    }
    this._projectSnapshot = refreshed
    const verified = refreshed.projects.find((item) => item.id === project.id)
    if (!verified) {
      this.setData({ projectNameError: '新项目未能确认保存，请刷新列表后重试。' })
      return false
    }
    this._lastProjectTarget = { id: verified.id, name: verified.name }
    const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    this.setData({
      projectStep: 'select',
      projectSearch: '',
      projectTargetId: verified.id,
      projectTargetName: verified.name,
      projectLoadState: 'ready',
      projectError: '',
      projectNameError: '',
      projectSaveError: '',
      ...keyboard,
    }, () => this.updateProjectList(refreshed.projects))
    return true
  },

  backToProjectList() {
    if (!this.data.projectSheetVisible) return false
    const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    this.setData({
      projectStep: 'select',
      projectNameError: '',
      projectSaveError: '',
      ...keyboard,
    }, () => this.updateProjectList())
    return true
  },

  saveProjectConfiguration() {
    const frozen = this._projectSnapshotForSave
    const targetId = this.data.projectTargetId
    const targetName = this.data.projectTargetName
    if (!frozen || !targetId || this._projectSavePending
      || !this.data.projectSheetVisible || this.data.projectStep !== 'select') return false
    const requestId = (this._projectRequestId || 0) + 1
    this._projectRequestId = requestId
    this._projectSavePending = true
    this.setData({ isSavingProject: true, projectSaveError: '' })
    const isCurrent = () => !this._isUnloaded
      && this._projectRequestId === requestId
      && this._projectSavePending
      && this._projectSnapshotForSave === frozen
      && this.data.projectSheetVisible
      && this.data.projectTargetId === targetId
      && this.data.projectTargetName === targetName
      && this._inputRevision === frozen.revision
      && JSON.stringify(this.getRecordPayload()) === frozen.signature
    const fail = (message, extraChanges = {}) => {
      if (!isCurrent()) return false
      this._projectSavePending = false
      this.setData({ isSavingProject: false, projectSaveError: message, ...extraChanges })
      return false
    }
    let snapshot
    try {
      snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    } catch (error) {
      snapshot = null
    }
    if (!snapshot || snapshot.ok === false) return fail('读取项目状态失败，请重试。')
    this._projectSnapshot = snapshot
    this.updateProjectList(snapshot.projects || [])
    const target = snapshot.projects.find((item) => item.id === targetId)
    if (!target || target.name !== targetName) {
      this._lastProjectTarget = null
      return fail(
        !target ? '所选项目已不存在，请重新选择。' : '项目名称已变化，请重新选择。',
        { projectTargetId: '', projectTargetName: '' },
      )
    }
    if (!isCurrent()) return fail('当前结果已变化，请重新选择项目。')
    let saved
    try {
      saved = addRecordToProject(frozen.payload, target.id)
    } catch (error) {
      saved = null
    }
    if (!saved) return fail('保存失败，请检查本地存储后重试。')
    this._projectSavePending = false
    this._lastProjectTarget = { id: target.id, name: target.name }
    const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    this.setData({
      projectStep: 'success',
      savedProjectName: target.name,
      projectSaveError: '',
      isSavingProject: false,
      ...keyboard,
    })
    vibrate('medium')
    return true
  },

  continueAfterProjectSave() {
    return this.closeProjectSheet()
  },

  closeProjectSheet() {
    if (!this.data.projectSheetVisible) return false
    this._projectRequestId = (this._projectRequestId || 0) + 1
    this._projectSavePending = false
    this._projectSnapshotForSave = null
    this.clearPageContainerOverlay('project')
    const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    this.setData({
      projectSheetVisible: false,
      projectStep: 'select',
      isSavingProject: false,
      ...keyboard,
    })
    return true
  },

  resetProjectKeyboardState({ captureBaseline = false, hideKeyboard = false, updateView = true } = {}) {
    const hadFocus = Boolean(this._projectKeyboardFocusId)
    this._projectKeyboardEpisode = (this._projectKeyboardEpisode || 0) + 1
    this._projectKeyboardFocusId = ''
    this._projectKeyboardFocusStartedAt = 0
    this._projectKeyboardHeight = 0
    const currentHeight = getProjectKeyboardHeight()
    if (currentHeight) this._projectKeyboardWindowHeight = currentHeight
    if (captureBaseline || !this._projectKeyboardBaselineHeight) {
      this._projectKeyboardBaselineHeight = this._projectKeyboardWindowHeight || currentHeight
    }
    if (hideKeyboard && hadFocus && typeof wx.hideKeyboard === 'function') {
      try { wx.hideKeyboard({}) } catch (error) {}
    }
    const changes = {
      projectKeyboardEpisode: this._projectKeyboardEpisode,
      projectKeyboardActive: false,
      projectKeyboardVisibleHeight: 0,
      projectKeyboardLift: 0,
      projectKeyboardPanelStyle: '',
    }
    if (updateView && !this._isUnloaded && this.data) this.setData(changes)
    return changes
  },

  onProjectInputFocus(event) {
    if (this._isUnloaded || !this._pageVisible || !this.data.projectSheetVisible
      || getProjectKeyboardEpisode(event) !== this._projectKeyboardEpisode) return false
    const field = getProjectKeyboardField(event)
    const allowedField = this.data.projectStep === 'select' ? 'projectSearch'
      : this.data.projectStep === 'create' ? 'newProjectName' : ''
    if (!allowedField || field !== allowedField) return false
    const timestamp = Number(event?.timeStamp)
    this._projectKeyboardFocusId = field
    this._projectKeyboardFocusStartedAt = Number.isFinite(timestamp) ? timestamp : 0
    const currentHeight = getProjectKeyboardHeight(event)
    if (currentHeight) this._projectKeyboardWindowHeight = currentHeight
    if (!this._projectKeyboardBaselineHeight) this._projectKeyboardBaselineHeight = currentHeight
    return true
  },

  onProjectInputBlur(event) {
    if (this._isUnloaded || !this.data.projectSheetVisible
      || getProjectKeyboardEpisode(event) !== this._projectKeyboardEpisode) return false
    const field = getProjectKeyboardField(event)
    const timestamp = Number(event?.timeStamp)
    if (field !== this._projectKeyboardFocusId
      || (timestamp && this._projectKeyboardFocusStartedAt && timestamp < this._projectKeyboardFocusStartedAt)) return false
    this.resetProjectKeyboardState({ updateView: true })
    return true
  },

  onProjectKeyboardHeightChange(event) {
    if (this._isUnloaded || !this._pageVisible || !this.data.projectSheetVisible
      || getProjectKeyboardEpisode(event) !== this._projectKeyboardEpisode) return false
    const field = getProjectKeyboardField(event)
    const allowedField = this.data.projectStep === 'select' ? 'projectSearch'
      : this.data.projectStep === 'create' ? 'newProjectName' : ''
    const timestamp = Number(event?.timeStamp)
    const keyboardHeight = Number(event?.detail?.height)
    if (!allowedField || field !== allowedField || field !== this._projectKeyboardFocusId
      || !Number.isFinite(keyboardHeight)
      || (timestamp && this._projectKeyboardFocusStartedAt && timestamp < this._projectKeyboardFocusStartedAt)) return false
    if (keyboardHeight <= 0) {
      this.resetProjectKeyboardState({ updateView: true })
      return true
    }
    this._projectKeyboardHeight = keyboardHeight
    const currentHeight = getProjectKeyboardHeight(event)
    if (currentHeight) this._projectKeyboardWindowHeight = currentHeight
    const baselineHeight = this._projectKeyboardBaselineHeight || currentHeight
    const visibleHeight = Math.max(0, Math.min(currentHeight || baselineHeight, baselineHeight - keyboardHeight))
    const lift = Math.max(0, keyboardHeight - Math.max(0, baselineHeight - currentHeight))
    this.setData({
      projectKeyboardActive: true,
      projectKeyboardVisibleHeight: Math.floor(visibleHeight),
      projectKeyboardLift: Math.ceil(lift),
      projectKeyboardPanelStyle: 'max-height:' + Math.floor(visibleHeight)
        + 'px;margin-bottom:' + Math.ceil(lift) + 'px;',
    })
    return true
  },

  toggleCurrentFavorite() {
    if (!this.data.hasValidResult || this.data.shareSheetVisible
      || this.data.projectSheetVisible || this.data.selectorVisible || this._favoritePending) return false
    this._favoritePending = true
    try {
      togglePageFavorite(this)
    } finally {
      this._favoritePending = false
    }
    return true
  },

  copyResult() {
    const resultText = this.getResultText()
    if (!resultText) return
    vibrate('medium')
    wx.setClipboardData({ data: resultText })
  },

  saveToActiveProject() {
    addPageToActiveProject(this)
  },

})

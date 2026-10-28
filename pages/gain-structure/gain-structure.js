const { createGainProjectData, createGainProjectMethods } = require('./gain-project')
const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishGainModuleLoad = startMeasurement('增益架构/脚本加载')
const { amplifiers } = require('../../data/equipment')
const { amplifierInputStages } = require('../../data/amplifier-input-stages')
const { calculateGainStructure, voltageToDbu } = require('../../utils/gain-structure')
const { readPreferences, removePreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const { isPageContextCurrent } = require('../../utils/report-image-actions')
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
  requestEditorLeave,
  saveEditorRecord: saveEditorRecordAction,
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')
const { attachResultEditor, captureEditorBaseline, createEditorNavigationMethods, finalizeResultEditor } = require('../../utils/result-record-context')
const {
  addRecordToProject,
  createProject,
  getProjectRecordView,
  getRecordById,
  getRecordByPayload,
  getWorkspaceSnapshot,
} = require('../../utils/records')
const { drawAndExportReport } = require('../../utils/report-canvas')
const {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  buildResultReportPayload,
  getExportDimensions,
} = require('../../utils/result-report')
const {
  calculateResultReportHeight,
  drawResultReport,
  getCanonicalResultNature,
} = require('./gain-report')

const DEFAULT_AMPLIFIER_MODEL = 'TC-X2200B'
const PREFERENCE_KEY = 'audioTool.gainStructure.preferences'
const SELECTOR_BATCH_SIZE = 60
const PAGE_CONTAINER_FALLBACK_TRANSITION_DURATION = 180

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

function getInputReadiness(state) {
  const amplifier = amplifiers[state.amplifierIndex]
  const inputStage = amplifier ? amplifierInputStages[amplifier.model] : null
  if (!amplifier || !inputStage) {
    return { complete: false, hint: '请选择功放型号和输入级档位；完整后结果会自动更新。' }
  }
  if (!validIndex(state.stageOptions || [], state.stageIndex)) {
    return { complete: false, hint: '请先核对并选择输入级档位；完整后结果会自动更新。' }
  }
  if (!validIndex(state.modes || [], state.modeIndex)) {
    return { complete: false, hint: '请选择有效的功放工作模式。' }
  }
  if (!validIndex(state.targetPeaks || [], state.targetPeakIndex)) {
    return { complete: false, hint: '请选择有效的 DSP 目标峰值。' }
  }
  if (inputStage.controlType === 'voltageGain') {
    const loadOption = state.loadOptions?.[state.loadIndex]
    if (!validIndex(state.loadOptions || [], state.loadIndex)
      || state.loadIndex === 0 || !Number.isFinite(loadOption?.value)) {
      return {
        complete: false,
        hint: '请确认当前工作模式并选择有效负载阻抗；完整后结果会自动更新。',
      }
    }
  }
  return { complete: true, hint: '' }
}

function derivePageResult(state, hasInputs) {
  if (!hasInputs) return { result: null, hint: '' }
  const readiness = getInputReadiness(state)
  return readiness.complete
    ? { result: calculatePageResult(state), hint: '' }
    : { result: null, hint: readiness.hint }
}

function buildCalculationView(result, hasInputs, incompleteHint = '') {
  if (!hasInputs && !result) {
    return {
      calculationState: 'empty',
      hasValidResult: false,
      outputStatus: '等待输入',
      outputHint: '选择功放型号开始设置。',
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
      canReset: hasInputs,
      currentFavorite: false,
    }
  }
  return {
    calculationState: result ? 'invalid' : 'incomplete',
    hasValidResult: false,
    outputStatus: result ? '请检查现场档位' : '参数尚未齐全',
    outputHint: result?.warning || incompleteHint || '请补全输入参数；完整后结果会自动更新。',
    canReset: hasInputs,
    currentFavorite: false,
  }
}

function invalidateReportForInputChange(page) {
  page.resultReportRevision = (page.resultReportRevision || 0) + 1
  page.resultReportPendingSignature = ''
  page.resultReportSignature = ''
  page._reportCacheCheckRevision = 0
  if (page.data?.isGeneratingResultReport && typeof wx.hideLoading === 'function') {
    wx.hideLoading()
  }
  return {
    resultReportImagePath: '',
    resultReportPreviewVisible: false,
    isGeneratingResultReport: false,
    isCheckingResultReportCache: false,
  }
}

function cancelResultReportWorkForOverlayExit(page) {
  if (!page.data?.isGeneratingResultReport && !page.data?.isCheckingResultReportCache
    && !page._reportCacheCheckRevision) return false
  page.resultReportRevision = (page.resultReportRevision || 0) + 1
  page.resultReportPendingSignature = ''
  page._reportCacheCheckRevision = 0
  if (page.data?.isGeneratingResultReport && typeof wx.hideLoading === 'function') wx.hideLoading()
  return true
}

function formatProjectSavedAt(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return '保存时间未知'
  const date = new Date(value)
  const pad = (part) => String(part).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

const amplifierOptions = buildCatalogOptions(amplifiers)
const amplifierCategories = buildCatalogCategories(amplifierOptions)
const resultReportMethods = createResultReportMethods({
  performancePrefix: '增益架构',
  emptyToast: '暂无可生成的标定结果',
})
finishGainModuleLoad({ amplifiers: amplifierOptions.length })
const gainProjectMethods = createGainProjectMethods({
  addRecordToProject,
  createProject,
  getProjectRecordView,
  getRecordById,
  getRecordByPayload,
  getWorkspaceSnapshot,
  vibrate,
  formatProjectSavedAt,
  wx: new Proxy({}, {
    get(_target, key) {
      const currentWx = wx
      const value = currentWx[key]
      return typeof value === 'function' ? value.bind(currentWx) : value
    },
  }),
})

Page({
  ...createEditorNavigationMethods(requestEditorLeave),
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
    ...createGainProjectData(),
    pageContainerSupported: false,
    pageContainerFallbackClosing: false,
    pageContainerClosingOverlay: '',
    ...createResultReportData(),
  },

  onLoad(options = {}) {
    attachResultEditor(this, 'gainStructure', options)
    const finishInitialization = startMeasurement('增益架构/初始化总耗时')
    this._pageVisible = false
    this._isUnloaded = false
    this._favoriteSyncedSinceLoad = false
    this._selectorMatches = []
    this._projectKeyboardEpisode = 0
    this._projectConfigNameEdited = false
    this._projectConfigNoteEdited = false
    this._projectRequestId = 0
    this._projectSavePending = false
    this._pageContainerEpoch = 0
    this._pageContainerFallbackCloseRevision = 0
    this._pageContainerFallbackCloseTimer = null
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    this._pendingPageContainerClose = null
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
    const { result, hint } = derivePageResult(pageState, hasSavedDraft)
    const inputRevision = this._inputRevision
    const finishViewUpdate = startMeasurement('增益架构/setData视图更新', { source: 'onLoad' })
    this.setData({
      ...amplifierState,
      targetPeakIndex,
      pageContainerSupported,
      result,
      hasSavedDraft,
      hasDraftInputs: hasSavedDraft,
      loadReminderActive: Boolean(amplifierState.showPowerContext && amplifierState.loadIndex === 0),
      ...buildCalculationView(result, hasSavedDraft, hint),
    }, () => {
      finishViewUpdate({ source: 'onLoad', hasSavedDraft })
      captureEditorBaseline(this)
      if (this._isUnloaded || this._inputRevision !== inputRevision) {
        finishInitialization({ valid: false, hasSavedDraft, superseded: true })
        return
      }
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        if (result?.valid) this.syncFavorite('onLoad')
        this._favoriteSyncedSinceLoad = true
      }
      finishInitialization({ valid: Boolean(result?.valid), hasSavedDraft })
    })
  },

  saveEditorContext(event) {
    return saveEditorRecordAction(this, event?.currentTarget?.dataset?.saveAs === 'true')
  },

  leaveEditorContext() {
    return requestEditorLeave(this)
  },

  onShow() {
    this._pageVisible = true
    if (this.data.hasValidResult && this.data.result?.valid) {
      this.syncFavorite('onShow')
      this._favoriteSyncedSinceLoad = true
    }
  },

  onHide() {
    this._pageVisible = false
    this.cancelPageContainerFallbackClose()
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    this._pendingPageContainerClose = null
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
      isSavingProject: false,
      selectorVisible: false,
      pageContainerClosingOverlay: '',
      pageContainerFallbackClosing: false,
      resultReportPreviewVisible: false,
    })
  },

  onUnload() {
    this._pageVisible = false
    this._projectRequestId = (this._projectRequestId || 0) + 1
    this._projectSavePending = false
    this._projectSnapshotForSave = null
    this._isUnloaded = true
    this.cancelPageContainerFallbackClose()
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    this._pendingPageContainerClose = null
    this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    cancelResultReportGeneration(this)
    printPerformanceSummary('增益架构/')
    finalizeResultEditor(this)
  },

  onGroupTap(event) {
    const key = event?.currentTarget?.dataset?.group
    if (!this.data.groupTabs.some((item) => item.key === key) || key === this.data.activeGroup) return false
    vibrate('light')
    this.setData({ activeGroup: key })
    return true
  },

  openPageContainerOverlay(name) {
    this.cancelPageContainerFallbackClose()
    if (this.data.pageContainerFallbackClosing) this.setData({ pageContainerFallbackClosing: false })
    this._pendingPageContainerClose = null
    this._pageContainerEpoch = (this._pageContainerEpoch || 0) + 1
    this._activePageContainerOverlay = { name, epoch: this._pageContainerEpoch }
    this._pageContainerLeave = null
    if (this.data.pageContainerClosingOverlay) this.setData({ pageContainerClosingOverlay: '' })
  },

  clearPageContainerOverlay(name) {
    if (name && this._activePageContainerOverlay?.name !== name) return false
    this._pageContainerEpoch = (this._pageContainerEpoch || 0) + 1
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    this._pendingPageContainerClose = null
    return true
  },

  cancelPageContainerFallbackClose() {
    this._pageContainerFallbackCloseRevision = (this._pageContainerFallbackCloseRevision || 0) + 1
    clearTimeout(this._pageContainerFallbackCloseTimer)
    this._pageContainerFallbackCloseTimer = null
    return this._pageContainerFallbackCloseRevision
  },

  closePageContainerOverlay(name, changes, afterFallbackClose) {
    if (this._isUnloaded || !this.data) return false
    const supported = this.data.pageContainerSupported
    const active = this._activePageContainerOverlay
    const leaveStarted = active?.name === name
      && (this.onPageContainerBeforeLeave() || this._pageContainerLeave?.epoch === active.epoch)
    const fallbackEpoch = !supported && leaveStarted ? active.epoch : null
    if (!supported && fallbackEpoch != null) {
      if (this.data.pageContainerFallbackClosing) return false
      const closeRevision = this.cancelPageContainerFallbackClose()
      this.setData({ pageContainerFallbackClosing: true }, () => {
        if (this._isUnloaded || !this._pageVisible || closeRevision !== this._pageContainerFallbackCloseRevision
          || this._pageContainerLeave?.epoch !== fallbackEpoch || !this.data.pageContainerFallbackClosing) return
        const timer = setTimeout(() => {
          if (this._pageContainerFallbackCloseTimer !== timer || this._isUnloaded || !this._pageVisible
            || closeRevision !== this._pageContainerFallbackCloseRevision
            || this._pageContainerLeave?.epoch !== fallbackEpoch || !this.data.pageContainerFallbackClosing) return
          this._pageContainerFallbackCloseTimer = null
          this.setData({ ...changes, pageContainerFallbackClosing: false }, () => {
            if (this._isUnloaded || closeRevision !== this._pageContainerFallbackCloseRevision) return
            if (this._activePageContainerOverlay?.epoch === fallbackEpoch
              && !this.data.selectorVisible && !this.data.shareSheetVisible && !this.data.projectSheetVisible) {
              this._activePageContainerOverlay = null
            }
            if (this._pageContainerLeave?.epoch === fallbackEpoch) this._pageContainerLeave = null
            afterFallbackClose?.()
          })
        }, PAGE_CONTAINER_FALLBACK_TRANSITION_DURATION)
        this._pageContainerFallbackCloseTimer = timer
      })
      return true
    }
    if (supported && leaveStarted && this._pageContainerAfterLeaveEpoch !== active.epoch) {
      const pending = this._pendingPageContainerClose
      this._pendingPageContainerClose = {
        name,
        epoch: active.epoch,
        changes: { ...(pending?.epoch === active.epoch ? pending.changes : {}), ...changes },
        afterLeave: afterFallbackClose || (pending?.epoch === active.epoch ? pending.afterLeave : null),
      }
      this.setData({ pageContainerClosingOverlay: name })
      return true
    }
    if (supported) {
      const pending = this._pendingPageContainerClose
      if (pending && active && pending.epoch === active.epoch) changes = { ...pending.changes, ...changes }
      this.clearPageContainerOverlay(name)
      this._pageContainerAfterLeaveEpoch = null
    }
    if (name === 'project') {
      this._projectRequestId = (this._projectRequestId || 0) + 1
      this._projectSavePending = false
      this._projectSnapshotForSave = null
    }
    this.setData({ ...changes, ...(supported ? { pageContainerClosingOverlay: '' } : {}) }, () => {
      if (!supported && fallbackEpoch != null) {
        if (this._activePageContainerOverlay?.epoch === fallbackEpoch
          && !this.data.selectorVisible && !this.data.shareSheetVisible && !this.data.projectSheetVisible) {
          this._activePageContainerOverlay = null
        }
        if (this._pageContainerLeave?.epoch === fallbackEpoch) this._pageContainerLeave = null
        afterFallbackClose?.()
      } else if (!supported) {
        afterFallbackClose?.()
      }
    })
    return true
  },

  onPageContainerBeforeLeave() {
    if (!this._activePageContainerOverlay || this._pageContainerLeave) return false
    if (this._activePageContainerOverlay.name === 'project') this.invalidateProjectSave()
    this._pageContainerLeave = { ...this._activePageContainerOverlay }
    if (this._activePageContainerOverlay.name === 'share') cancelResultReportWorkForOverlayExit(this)
    if (this.data.pageContainerSupported) {
      this.setData({ pageContainerClosingOverlay: this._activePageContainerOverlay.name })
    }
    return true
  },

  onPageContainerAfterLeave() {
    const leaving = this._pageContainerLeave
    if (!leaving || this._activePageContainerOverlay?.epoch !== leaving.epoch) return false
    const pending = this._pendingPageContainerClose
    if (pending?.epoch === leaving.epoch) {
      this._pendingPageContainerClose = null
      this.setData({ ...pending.changes, pageContainerClosingOverlay: '' }, () => {
        if (this._activePageContainerOverlay?.epoch !== leaving.epoch) return
        this._activePageContainerOverlay = null
        if (this._pageContainerLeave?.epoch === leaving.epoch) this._pageContainerLeave = null
        pending.afterLeave?.()
      })
      return true
    }
    this._pageContainerAfterLeaveEpoch = leaving.epoch
    const close = {
      selector: this.closeAmplifierSelector,
      share: this.closeSharePreview,
      project: this.closeProjectSheet,
    }[leaving.name]
    if (close) close.call(this)
    else {
      const field = { selector: 'selectorVisible', share: 'shareSheetVisible', project: 'projectSheetVisible' }[leaving.name]
      this.clearPageContainerOverlay(leaving.name)
      this.setData({ ...(field ? { [field]: false } : {}), pageContainerClosingOverlay: '' })
    }
    this._pageContainerAfterLeaveEpoch = null
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
    if (!this.data.selectorVisible) return false
    this._selectorMatches = []
    return this.closePageContainerOverlay('selector', { selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
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
      return this.closeAmplifierSelector()
    }
    vibrate('light')
    this._selectorMatches = []
    this.closePageContainerOverlay('selector', { selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
    const amplifierState = buildAmplifierState(amplifierIndex)
    this.commitCalculatedState({
      ...amplifierState,
      activeGroup: !amplifierState.showPowerContext && this.data.activeGroup === 'load'
        ? 'amplifier'
        : this.data.activeGroup,
    }, 'amplifier', {
      loadReminderActive: amplifierState.showPowerContext,
    })
    return true
  },

  openAmplifierDetail(event) {
    const url = `/pages/products/detail?type=amplifier&model=${encodeURIComponent(event.currentTarget.dataset.model)}`
    this._selectorMatches = []
    const changes = { selectorVisible: false, selectorItems: [], selectorTotalCount: 0 }
    this.closePageContainerOverlay('selector', changes, () => wx.navigateTo({ url }))
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
    }, 'mode', { loadReminderActive: true })
    return true
  },

  onLoadChange(event) {
    const index = Number(event?.detail?.value)
    return this.setSelectionAndCalculate('loadIndex', index)
  },

  calculate() {
    return this.commitCalculatedState({}, 'calculate')
  },

  commitCalculatedState(changes = {}, source = 'interaction', options = {}) {
    const finishCalculation = startMeasurement('增益架构/计算到结果更新', { source })
    const pageState = { ...this.data, ...changes }
    const semanticKeys = ['amplifierIndex', 'stageIndex', 'modeIndex', 'loadIndex', 'targetPeakIndex']
    const hasInputChange = semanticKeys.some((key) => this.data[key] !== pageState[key])
    if (hasInputChange) this._inputRevision = (this._inputRevision || 0) + 1
    const inputRevision = this._inputRevision || 0
    const nativePageContainerLeavePending = Boolean(this.data.pageContainerSupported
      && this._pageContainerLeave && this._activePageContainerOverlay
      && this._pageContainerLeave.epoch === this._activePageContainerOverlay.epoch
      && this._pageContainerAfterLeaveEpoch !== this._pageContainerLeave.epoch)
    if (hasInputChange && !this.data.pageContainerFallbackClosing && !nativePageContainerLeavePending) {
      this.clearPageContainerOverlay()
    }
    const hasDraftInputs = Boolean(this.data.hasDraftInputs || hasInputChange)
    let result = this.data.result
    let hint = this.data.outputHint
    const shouldDerive = hasInputChange || source === 'calculate'
    if (shouldDerive) {
      const finishCoreCalculation = startMeasurement('增益架构/核心计算', { source })
      const derived = derivePageResult(pageState, hasDraftInputs)
      result = derived.result
      hint = derived.hint
      finishCoreCalculation({ valid: Boolean(result?.valid), complete: Boolean(result) })
    }
    const preferences = Number.isInteger(pageState.amplifierIndex)
      && pageState.amplifierIndex >= 0 && amplifiers[pageState.amplifierIndex]
      ? buildPreferences(pageState)
      : null
    const resultReportChanges = hasInputChange
      ? invalidateReportForInputChange(this)
      : resetStaleResultReport(
        this,
        result?.valid ? this.getRecordPayload(pageState, result) : null,
      )
    const shouldCloseProject = hasInputChange && this.data.projectSheetVisible
    if (shouldCloseProject) {
      this._projectRequestId = (this._projectRequestId || 0) + 1
      this._projectSavePending = false
      this._projectSnapshotForSave = null
      this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    }
    const view = buildCalculationView(result, hasDraftInputs, hint)
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
      if (this._isUnloaded || this._inputRevision !== inputRevision) {
        finishCalculation({ valid: Boolean(result?.valid), superseded: true })
        return
      }
      const finishPreferenceWrite = startMeasurement('增益架构/写入偏好')
      const preferencesChanged = preferences
        ? writePreferences(PREFERENCE_KEY, preferences)
        : false
      finishPreferenceWrite({ changed: preferencesChanged })
      if (result?.valid) this.syncFavorite('calculation')
      finishCalculation({ valid: Boolean(result?.valid), preferencesChanged })
    })
    return result
  },

  getPreferences(state = this.data) {
    return buildPreferences(state)
  },

  getEditorPreferences(state = this.data) {
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
      if (!this._isUnloaded && !this._pageContainerLeave && this.data.shareSheetVisible) this.generateResultReportImage()
    })
    return true
  },

  closeSharePreview() {
    if (!this.data.shareSheetVisible && !this.data.isGeneratingResultReport
      && !this.data.isCheckingResultReportCache) return false
    if (!this._pageContainerLeave || this._pageContainerLeave.name !== 'share') this.onPageContainerBeforeLeave()
    if (this._pageContainerLeave?.name !== 'share') cancelResultReportWorkForOverlayExit(this)
    const wasGenerating = Boolean(this.data.isGeneratingResultReport)
    if (wasGenerating) this.resultReportSignature = ''
    this.closePageContainerOverlay('share', {
      shareSheetVisible: false,
      isGeneratingResultReport: false,
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
    const inputRevision = this._inputRevision || 0
    this.setData({ resultReportError: '' }, () => {
      if (this._isUnloaded || !this.data.shareSheetVisible
        || this._inputRevision !== inputRevision) return
      this.generateResultReportImage()
    })
    return true
  },

  generateResultReportImage() {
    if (this._pageContainerLeave?.name === 'share') return false
    const record = this.getRecordPayload()
    const payload = buildResultReportPayload(record)
    if (!payload || !this.data.hasValidResult) {
      if (typeof wx.showToast === 'function') wx.showToast({ title: '暂无可生成的标定结果', icon: 'none' })
      return false
    }
    payload.resultNature = getCanonicalResultNature(record.resultText)
    if (this.data.isGeneratingResultReport || this.data.isCheckingResultReportCache) return false
    const signature = this.getResultReportSignature(record)
    if (this.data.resultReportImagePath && this.resultReportSignature === signature) {
      const path = this.data.resultReportImagePath
      const revision = (this.resultReportRevision || 0) + 1
      const inputRevision = this._inputRevision || 0
      this.resultReportRevision = revision
      this._reportCacheCheckRevision = revision
      this.setData({ isCheckingResultReportCache: true, resultReportPreviewVisible: false, resultReportError: '' }, () => {
        if (this._isUnloaded || this._inputRevision !== inputRevision) return
        const isCurrent = () => !this._isUnloaded && this.data.shareSheetVisible
          && this._inputRevision === inputRevision
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
              && this._inputRevision === inputRevision
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
    let resultReportCanvasHeight
    try {
      const measureContext = wx.createCanvasContext(REPORT_CANVAS_ID, this)
      resultReportCanvasHeight = calculateResultReportHeight(payload, measureContext)
    } catch (error) {
      this.setData({ resultReportError: '图片排版失败，请重试。' })
      return false
    }
    const revision = (this.resultReportRevision || 0) + 1
    const inputRevision = this._inputRevision || 0
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
      if (this._isUnloaded || this._inputRevision !== inputRevision) return
      const isCurrent = () => !this._isUnloaded
        && this._inputRevision === inputRevision
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
            const finished = finish({
              resultReportImagePath: imagePath,
              resultReportPreviewVisible: true,
              resultReportError: '',
            })
            if (finished && isPageContextCurrent(this)) vibrate('medium')
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
    this._resetModalPending = true
    wx.showModal({
      title: '清空本次计算？',
      content: '将清空当前输入和结果，已保存的收藏与项目记录会保留。',
      confirmText: '清空',
      cancelText: '取消',
      success: ({ confirm }) => {
        this._resetModalPending = false
        if (!this._isUnloaded && confirm && this.clearDraft() && isPageContextCurrent(this)) vibrate('light')
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
      projectConfigName: '',
      projectConfigNote: '',
      projectNameError: '',
      projectConfigNameError: '',
      projectNoteError: '',
      projectPreview: null,
      projectSaveError: '',
      isSavingProject: false,
      savedProjectName: '',
      savedConfigName: '',
      savedAtText: '',
    })
    return true
  },
...gainProjectMethods,

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
    const signature = JSON.stringify(this.getRecordPayload())
    wx.setClipboardData({ data: resultText, success: () => {
      if (!this._isUnloaded && JSON.stringify(this.getRecordPayload()) === signature
        && isPageContextCurrent(this)) vibrate('medium')
    } })
  },

})

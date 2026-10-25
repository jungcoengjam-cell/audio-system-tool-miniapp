const { createSplProjectData, createSplProjectMethods } = require('./spl-project')
const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishSplModuleLoad = startMeasurement('声压级/脚本加载')
const { speakers } = require('../../data/equipment')
const { calculateSpeakerSpl } = require('../../utils/spl')
const {
  findValueIndex,
  readPreferences,
  writePreferences,
  writePreferencesDetailed,
} = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const { isPageContextCurrent } = require('../../utils/report-image-actions')
const {
  cancelResultReportGeneration,
  createResultReportData,
  createResultReportMethods,
} = require('../../utils/result-report-controller')
const {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  buildSplReportPayload,
  buildSplReportSignature,
  calculateSplReportHeight,
  drawSplReport,
  getExportDimensions,
} = require('./spl-report')
const { drawAndExportReport } = require('../../utils/report-canvas')
const {
  saveGeneratedImage,
} = require('../../utils/report-image-actions')
const {
  buildCatalogCategories,
  buildCatalogOptions,
  filterCatalogItems,
  findCatalogModelIndex,
} = require('../../utils/catalog-selector')
const {
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

const DEFAULT_SPEAKER_MODEL = 'TS-803C'
const PREFERENCE_KEY = 'audioTool.spl.preferences'
const INPUT_CALCULATION_DELAY = 160
const SHEET_TRANSITION_DURATION = 320
const SELECTOR_BATCH_SIZE = 60
const SPEAKER_COUNTS = [1, 2, 3, 4, 6, 8, 12, 16]
const COUNT_PICKER_OPTIONS = ['请选择数量', ...SPEAKER_COUNTS.map((count) => `${count} 只`)]
const DEFAULT_SPL_PREFERENCES = {
  speakerModel: DEFAULT_SPEAKER_MODEL,
  distanceText: '4',
  speakerCount: 1,
  summationMode: 'distributed',
}
const EMPTY_SPL_PREFERENCES = {
  speakerModel: '',
  speakerCount: null,
  distanceText: '',
  summationMode: 'distributed',
}

const speakerCatalog = speakers.filter((item) => (
  !item.calculationDisabled && Number.isFinite(item.sensitivityDb)
))
const speakerOptions = buildCatalogOptions(speakerCatalog, (item) => ({
  sensitivityDb: item.sensitivityDb,
}))
const speakerCategories = buildCatalogCategories(speakerOptions)
const defaultSpeakerIndex = findCatalogModelIndex(speakerOptions, DEFAULT_SPEAKER_MODEL)
const resultReportMethods = createResultReportMethods({
  performancePrefix: '声压级',
  emptyToast: '暂无可生成的估算结果',
})
finishSplModuleLoad({ speakers: speakerOptions.length })

function formatProjectSavedAt(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return '保存时间未知'
  const date = new Date(value)
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function calculatePageResult(state) {
  const speaker = Number.isInteger(state?.speakerIndex) && state.speakerIndex >= 0
    ? speakerCatalog[state.speakerIndex]
    : null
  const speakerCount = Number.isInteger(state?.countIndex) && state.countIndex >= 0
    ? state.counts?.[state.countIndex]
    : null
  const summationMode = state?.summationModes?.[state.summationModeIndex]
  if (!speaker || !Number.isInteger(speakerCount) || !summationMode) {
    return { result: null, distanceError: '' }
  }

  const distanceText = String(state?.distanceText ?? '')
  if (!distanceText.trim()) return { result: null, distanceError: '' }
  const distanceMeters = Number(distanceText)
  if (!Number.isFinite(distanceMeters) || distanceMeters < 1 || distanceMeters > 1000) {
    return {
      result: null,
      distanceError: '请输入 1 至 1000 米之间的测量距离。',
    }
  }

  const result = calculateSpeakerSpl({
    speaker,
    distanceMeters,
    speakerCount,
    summationMode: summationMode.value,
  })
  if (!result) {
    return {
      result: null,
      distanceError: '当前音箱缺少有效的灵敏度或额定功率数据，无法进行声压级估算。',
    }
  }

  return {
    result: {
      ...result,
      summationModeLabel: summationMode.label,
      summationModeShortLabel: summationMode.shortLabel,
      summationModeDescription: summationMode.description,
    },
    distanceError: '',
  }
}

function buildPreferences(state) {
  const speaker = Number.isInteger(state?.speakerIndex) && state.speakerIndex >= 0
    ? speakerOptions[state.speakerIndex]
    : null
  const speakerCount = Number.isInteger(state?.countIndex) && state.countIndex >= 0
    ? state.counts?.[state.countIndex]
    : null
  const summationMode = state?.summationModes?.[state.summationModeIndex]?.value
  return {
    speakerModel: speaker?.model || '',
    distanceText: String(state?.distanceText ?? ''),
    speakerCount: Number.isInteger(speakerCount) ? speakerCount : null,
    summationMode: summationMode || 'distributed',
  }
}

function hasSplInputs(state = {}) {
  return (Number.isInteger(state.speakerIndex) && state.speakerIndex >= 0)
    || (Number.isInteger(state.countIndex) && state.countIndex >= 0)
    || String(state.distanceText ?? '').length > 0
    || (Number.isInteger(state.summationModeIndex) && state.summationModeIndex > 0)
}

function resetStaleSplReport(page, record) {
  const nextSignature = page.getResultReportSignature(record)
  const currentSignature = page.resultReportPendingSignature || page.resultReportSignature
  if (!currentSignature || currentSignature === nextSignature) return {}

  cancelResultReportGeneration(page)
  page.resultReportSignature = ''
  return {
    resultReportImagePath: '',
    resultReportPreviewVisible: false,
    isGeneratingResultReport: false,
  }
}

function rectOf(value) {
  if (!value?.rect || typeof value.rect !== 'object') return value
  return {
    ...value.rect,
    width: value.rect.width ?? value.width,
    height: value.rect.height ?? value.height,
  }
}

function styleNumber(value, name, fallback = 0) {
  const style = value?.computedStyle || value || {}
  const number = Number.parseFloat(style[name])
  return Number.isFinite(number) ? number : fallback
}
const splProjectMethods = createSplProjectMethods({
  SHEET_TRANSITION_DURATION,
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
  setTimeout: (...args) => setTimeout(...args),
})

Page({
  ...createEditorNavigationMethods(),
  data: {
    selectedSpeaker: speakerOptions[defaultSpeakerIndex],
    speakerCategories,
    speakerIndex: defaultSpeakerIndex,
    speakerKeyword: '',
    speakerCategoryIndex: 0,
    distanceText: '4',
    counts: SPEAKER_COUNTS,
    countPickerOptions: COUNT_PICKER_OPTIONS,
    countIndex: 0,
    showSummationMode: false,
    summationModes: [
      {
        value: 'distributed',
        label: '常规叠加（推荐）',
        shortLabel: '常规叠加',
        description: '相位未知或常规分散布置；每增加一倍数量约 +3 dB。',
      },
      {
        value: 'coherent',
        label: '同相叠加（理想）',
        shortLabel: '同相叠加',
        description: '等距离、同相、指向一致的理想条件；每增加一倍数量约 +6 dB。',
      },
    ],
    summationModeIndex: 0,
    resultTab: 'spl',
    result: null,
    isCalculationPending: false,
    canReset: true,
    canUseResultActions: false,
    isResetPending: false,
    currentFavorite: false,
    distanceError: '',
    selectorVisible: false,
    selectorKeyword: '',
    selectorCategoryIndex: 0,
    selectorItems: [],
    selectorTotalCount: 0,
    shareSheetVisible: false,
    shareSheetClosing: false,
    shareImageStyle: '',
    shareImageFrameStyle: '',
    isCheckingResultReportCache: false,
    ...createSplProjectData(),
    resetError: '',
    ...createResultReportData(),
  },

  onLoad(options = {}) {
    attachResultEditor(this, 'spl', options)
    const finishInitialization = startMeasurement('声压级/初始化总耗时')
    this._pageVisible = false
    this._favoriteSyncedSinceLoad = false
    this._isUnloaded = false
    this._inputRevision = 0
    this._projectRequestId = 0
    this._projectKeyboardEpisode = 0
    this._projectKeyboardFocusId = ''
    this._projectKeyboardFocusStartedAt = 0
    this._projectKeyboardBlurredField = ''
    this._projectKeyboardBlurredAt = 0
    this._projectKeyboardHeight = 0
    this._projectKeyboardBaselineHeight = 0
    this._projectKeyboardWindowHeight = 0
    this._previewImageOpening = false
    const preferences = readPreferences(PREFERENCE_KEY)
    const hasSpeakerModel = Object.prototype.hasOwnProperty.call(preferences, 'speakerModel')
    const hasDistanceText = Object.prototype.hasOwnProperty.call(preferences, 'distanceText')
    const speakerModel = hasSpeakerModel
      ? String(preferences.speakerModel ?? '')
      : DEFAULT_SPL_PREFERENCES.speakerModel
    const speakerIndex = speakerModel
      ? findCatalogModelIndex(speakerOptions, speakerModel)
      : -1
    const countIndex = preferences.speakerCount === null
      ? -1
      : findValueIndex(this.data.counts, preferences.speakerCount)
    const changes = {
      speakerIndex,
      distanceText: hasDistanceText
        ? String(preferences.distanceText ?? '')
        : DEFAULT_SPL_PREFERENCES.distanceText,
      countIndex,
      showSummationMode: countIndex >= 0 && this.data.counts[countIndex] > 1,
      summationModeIndex: findValueIndex(
        this.data.summationModes,
        preferences.summationMode,
        (item) => item.value,
      ),
    }
    changes.selectedSpeaker = changes.speakerIndex >= 0
      ? speakerOptions[changes.speakerIndex] || null
      : null
    const pageState = { ...this.data, ...changes }
    const finishCoreCalculation = startMeasurement('声压级/核心计算', { source: 'onLoad' })
    const calculated = calculatePageResult(pageState)
    finishCoreCalculation({ valid: Boolean(calculated.result) })
    const finishViewUpdate = startMeasurement('声压级/setData视图更新', { source: 'onLoad' })
    this.setData({
      ...changes,
      ...calculated,
      canReset: hasSplInputs(pageState),
      canUseResultActions: Boolean(calculated.result),
    }, () => {
      finishViewUpdate()
      captureEditorBaseline(this)
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        syncPageFavorite(this)
        this._favoriteSyncedSinceLoad = true
      }
      finishInitialization({ speaker: pageState.selectedSpeaker?.model || '' })
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
    if (this._previewImageOpening) {
      this._previewImageOpening = false
      this.updateShareImageLayout()
    }
    if (this.data.result) {
      syncPageFavorite(this)
      this._favoriteSyncedSinceLoad = true
    }
  },

  onHide() {
    this._pageVisible = false
    if (this._previewImageOpening) return
    this._shareCloseRevision = (this._shareCloseRevision || 0) + 1
    this._projectCloseRevision = (this._projectCloseRevision || 0) + 1
    this.flushDistanceCalculation()
    this.closeSharePreview({ silent: true })
    this.invalidateProjectSave({ updateView: false })
    this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    if (this.data.projectSheetVisible) {
      this._projectSnapshotForSave = null
      this._projectRevision = (this._projectRevision || 0) + 1
    }
    this.setData({
      isResetPending: false,
      resultTab: 'spl',
      projectSheetVisible: false,
      projectSheetClosing: false,
      shareSheetVisible: false,
      shareSheetClosing: false,
      projectRevision: this._projectRevision || this.data.projectRevision,
    })
  },

  onUnload() {
    this._pageVisible = false
    this._isUnloaded = true
    this._shareCloseRevision = (this._shareCloseRevision || 0) + 1
    this._projectCloseRevision = (this._projectCloseRevision || 0) + 1
    this.cancelDistanceCalculation()
    cancelResultReportGeneration(this)
    this.invalidateProjectSave({ updateView: false })
    this.resetProjectKeyboardState({ updateView: false })
    printPerformanceSummary('声压级/')
    finalizeResultEditor(this)
  },

  onDistanceInput(event) {
    this.beginInputRevision()
    const distanceText = event.detail.value
    this.setData({
      distanceText,
      isCalculationPending: true,
      canUseResultActions: false,
      canReset: hasSplInputs({ ...this.data, distanceText }),
      currentFavorite: false,
      distanceError: '',
    })
    this.scheduleDistanceCalculation()
  },

  onDistanceBlur() {
    this.flushDistanceCalculation()
  },

  onPickerChange(event) {
    const field = event.currentTarget.dataset.field
    const value = Number(event.detail.value)
    if (this.data[field] !== value) vibrate('light')
    const nextData = {
      [field]: value,
    }

    if (field === 'countIndex') {
      nextData.showSummationMode = this.data.counts[value] > 1
    }

    this.commitCalculatedState(nextData)
  },

  onCountPickerChange(event) {
    const pickerIndex = Number(event?.detail?.value)
    if (!Number.isInteger(pickerIndex) || pickerIndex < 0
      || pickerIndex >= COUNT_PICKER_OPTIONS.length) return false
    return this.onPickerChange({
      currentTarget: { dataset: { field: 'countIndex' } },
      detail: { value: pickerIndex - 1 },
    })
  },

  openSpeakerSelector() {
    if (this.data.selectorVisible || this.data.shareSheetVisible || this.data.projectSheetVisible) return false
    const keyword = this.data.speakerKeyword
    const categoryIndex = this.data.speakerCategoryIndex

    const finishFilter = startMeasurement('声压级/设备搜索过滤', { source: 'open' })
    const selectorItems = filterCatalogItems(
      speakerOptions,
      speakerCategories,
      keyword,
      categoryIndex,
    )
    this._selectorMatches = selectorItems
    const visibleItems = selectorItems.slice(0, SELECTOR_BATCH_SIZE)
    finishFilter({ matches: selectorItems.length })
    const finishViewUpdate = startMeasurement('声压级/设备搜索视图更新', { source: 'open' })
    this.setData({
      selectorVisible: true,
      selectorKeyword: keyword,
      selectorCategoryIndex: categoryIndex,
      selectorItems: visibleItems,
      selectorTotalCount: selectorItems.length,
    }, () => finishViewUpdate({
      matches: selectorItems.length,
      rendered: visibleItems.length,
    }))
  },

  closeSpeakerSelector() {
    this._selectorMatches = []
    this.setData({ selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
  },

  stopTap() {},

  onSelectorInput(event) {
    this.refreshSelector({
      keyword: event.detail.value,
      categoryIndex: this.data.selectorCategoryIndex,
    })
  },

  onSelectorCategoryTap(event) {
    const categoryIndex = Number(event.currentTarget.dataset.index)
    if (categoryIndex !== this.data.selectorCategoryIndex) vibrate('light')
    this.refreshSelector({
      keyword: this.data.selectorKeyword,
      categoryIndex,
    })
  },

  refreshSelector(options) {
    const { keyword, categoryIndex } = options
    const finishFilter = startMeasurement('声压级/设备搜索过滤', { source: 'filter' })
    const selectorItems = filterCatalogItems(
      speakerOptions,
      speakerCategories,
      keyword,
      categoryIndex,
    )
    this._selectorMatches = selectorItems
    const visibleItems = selectorItems.slice(0, SELECTOR_BATCH_SIZE)
    finishFilter({ matches: selectorItems.length })
    const finishViewUpdate = startMeasurement('声压级/设备搜索视图更新', { source: 'filter' })
    this.setData({
      speakerKeyword: keyword,
      speakerCategoryIndex: categoryIndex,
      selectorKeyword: keyword,
      selectorCategoryIndex: categoryIndex,
      selectorItems: visibleItems,
      selectorTotalCount: selectorItems.length,
    }, () => finishViewUpdate({
      matches: selectorItems.length,
      rendered: visibleItems.length,
    }))
  },

  appendSelectorItems() {
    const selectorMatches = this._selectorMatches || []
    const rendered = this.data.selectorItems.length
    if (rendered >= selectorMatches.length) return
    const selectorItems = selectorMatches.slice(0, rendered + SELECTOR_BATCH_SIZE)
    const finishViewUpdate = startMeasurement('声压级/设备搜索视图更新', { source: 'append' })
    this.setData({ selectorItems }, () => finishViewUpdate({
      matches: selectorMatches.length,
      rendered: selectorItems.length,
    }))
  },

  selectSpeaker(event) {
    const speakerIndex = Number(event.currentTarget.dataset.index)
    if (speakerIndex !== this.data.speakerIndex) vibrate('light')
    this._selectorMatches = []
    this.commitCalculatedState({
      speakerIndex,
      selectorVisible: false,
      selectorItems: [],
      selectorTotalCount: 0,
    })
  },

  openSpeakerDetail(event) {
    const model = event.currentTarget.dataset.model
    this._selectorMatches = []
    this.setData({ selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
    wx.navigateTo({
      url: `/pages/products/detail?type=speaker&model=${encodeURIComponent(model)}`,
    })
  },

  calculate() {
    return this.commitCalculatedState()
  },

  beginInputRevision() {
    this._inputRevision = (this._inputRevision || 0) + 1
    this.cancelDistanceCalculation()
    cancelResultReportGeneration(this)
    this._reportCacheCheckRevision = 0
    this._shareCloseRevision = (this._shareCloseRevision || 0) + 1
    this.resultReportSignature = ''
    this.resultReportPendingSignature = ''
    this.setData({
      resultTab: 'spl',
      shareSheetVisible: false,
      shareSheetClosing: false,
      isResetPending: false,
      isCheckingResultReportCache: false,
      isGeneratingResultReport: false,
      resultReportImagePath: '',
      resultReportPreviewVisible: false,
      resultReportError: '',
      shareImageStyle: '',
      shareImageFrameStyle: '',
    })
    if (this.data.projectSheetVisible) {
      this.invalidateProjectSave({ updateView: false })
      this._projectSnapshotForSave = null
      this._projectCloseRevision = (this._projectCloseRevision || 0) + 1
      this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
      this.setData({
        projectSheetVisible: false,
        projectSheetClosing: false,
        projectStep: 'select',
        isSavingProject: false,
      })
    }
    return this._inputRevision
  },

  commitCalculatedState(changes = {}, { skipRevision = false } = {}) {
    this.cancelDistanceCalculation()
    if (!skipRevision && !this.data.isCalculationPending) {
      this.beginInputRevision()
      this.setData({
        isCalculationPending: true,
        canUseResultActions: false,
        currentFavorite: false,
      })
    }
    const finishCalculation = startMeasurement('声压级/计算到结果更新', {
      fields: Object.keys(changes).length,
    })
    const viewChanges = { ...changes }
    if (Number.isInteger(changes.speakerIndex)) {
      viewChanges.selectedSpeaker = changes.speakerIndex >= 0
        ? speakerOptions[changes.speakerIndex] || null
        : null
    }
    const pageState = { ...this.data, ...viewChanges, isCalculationPending: false }
    const finishCoreCalculation = startMeasurement('声压级/核心计算', { source: 'interaction' })
    const calculated = calculatePageResult(pageState)
    finishCoreCalculation({ valid: Boolean(calculated.result) })
    const resultReportChanges = resetStaleSplReport(
      this,
      this.getRecordPayload(pageState, calculated.result),
    )
    const calculationRevision = this._inputRevision || 0
    const calculationSignature = JSON.stringify(buildPreferences(pageState))
    const finishViewUpdate = startMeasurement('声压级/setData视图更新', { source: 'interaction' })
    this.setData({
      ...viewChanges,
      ...calculated,
      ...resultReportChanges,
      isCalculationPending: false,
      canReset: hasSplInputs(pageState),
      canUseResultActions: Boolean(calculated.result),
      currentFavorite: false,
      resetError: '',
    }, () => {
      finishViewUpdate()
      let preferencesChanged = false
      let isCurrent = !this._isUnloaded && this._inputRevision === calculationRevision
      if (isCurrent) {
        try { isCurrent = JSON.stringify(buildPreferences(this.data)) === calculationSignature }
        catch (error) { isCurrent = false }
      }
      if (calculated.result && isCurrent) {
        preferencesChanged = writePreferences(PREFERENCE_KEY, buildPreferences(pageState))
        if (this._pageVisible) syncPageFavorite(this)
      }
      finishCalculation({ valid: Boolean(calculated.result), preferencesChanged, current: isCurrent })
    })
    return calculated.result
  },

  scheduleDistanceCalculation() {
    this.cancelDistanceCalculation()
    this.distanceCalculationTimer = setTimeout(() => {
      this.distanceCalculationTimer = null
      this.commitCalculatedState()
    }, INPUT_CALCULATION_DELAY)
  },

  cancelDistanceCalculation() {
    if (!this.distanceCalculationTimer) return
    clearTimeout(this.distanceCalculationTimer)
    this.distanceCalculationTimer = null
  },

  flushDistanceCalculation() {
    if (!this.distanceCalculationTimer) return
    this.cancelDistanceCalculation()
    this.commitCalculatedState()
  },

  getPreferences(state = this.data) {
    return buildPreferences(state)
  },

  getEditorPreferences(state = this.data) {
    return buildPreferences(state)
  },

  getRecordLookupPayload(state, result) {
    const hasExplicitState = arguments.length > 0
    const currentState = hasExplicitState ? state : this.data
    const currentResult = arguments.length > 1 ? result : currentState?.result
    if (!currentResult || (!hasExplicitState && this.data.isCalculationPending)) return null
    return { module: 'spl', preferences: this.getPreferences(currentState) }
  },

  getResultText(state = this.data, result = state.result) {
    const hasExplicitState = arguments.length > 0
    if (!hasExplicitState && (this.data.isCalculationPending || !this.data.canUseResultActions)) return ''
    if (!result) return ''

    return [
      '声压级与功率估算',
      '结果性质：自由场理论估算',
      `音箱：${result.model} × ${result.speakerCount} 只`,
      `测量距离：${result.distanceMeters} m`,
      `叠加方式：${result.summationModeShortLabel}`,
      `说明书灵敏度：${result.sensitivityDb} dB @ 1W/1m`,
      `总额定功率：${result.totalRatedPower} W`,
      `叠加增益：+${result.summationGainDb} dB`,
      `1 m 理论声压级：${result.oneMeterSpl} dB SPL`,
      `${result.distanceMeters} m 理论声压级：${result.selectedSpl} dB SPL`,
      '注：自由场理论估算，实际结果受节目电平、摆位、覆盖角度、相位和房间反射影响。',
    ].join('\n')
  },

  getRecordPayload(state = this.data, result = state.result) {
    const hasExplicitState = arguments.length > 0
    if (!hasExplicitState && (this.data.isCalculationPending || !this.data.canUseResultActions)) return null
    const resultText = this.getResultText(state, result)
    if (!resultText) return null

    return {
      module: 'spl',
      title: `${result.model} × ${result.speakerCount} 只`,
      summary: `${result.distanceMeters} m · ${result.selectedSpl} dB SPL · ${result.summationModeShortLabel}`,
      preferences: this.getPreferences(state),
      resultText,
    }
  },

  ...resultReportMethods,

  getResultReportSignature(record = this.getRecordPayload()) {
    return buildSplReportSignature(record)
  },

  onResultTabTap(event) {
    const tab = event?.currentTarget?.dataset?.tab
    if (!['spl', 'distance', 'reference'].includes(tab) || tab === this.data.resultTab) return false
    if (!this._pageVisible || this._isUnloaded || !this.data.result
      || !this.data.canUseResultActions || this.data.isCalculationPending
      || this.data.selectorVisible || this.data.shareSheetVisible || this.data.shareSheetClosing
      || this.data.projectSheetVisible || this.data.projectSheetClosing) return false
    vibrate('light')
    this.setData({ resultTab: tab })
    return true
  },

  openSharePreview() {
    if (!this.data.canUseResultActions || this.data.isCalculationPending
      || this.data.shareSheetVisible || this.data.projectSheetVisible
      || this.data.selectorVisible || this.data.isGeneratingResultReport
      || this.data.shareSheetClosing || this.data.isCheckingResultReportCache) return false
    vibrate('light')
    const inputRevision = this._inputRevision || 0
    const shareSessionRevision = this._shareCloseRevision || 0
    this.setData({
      shareSheetVisible: true,
      shareSheetClosing: false,
      resultReportError: '',
      shareImageStyle: 'width:100%;height:100%;',
      shareImageFrameStyle: '',
    }, () => {
      if (!this._isUnloaded && this.data.shareSheetVisible
        && !this.data.shareSheetClosing && this._inputRevision === inputRevision
        && (this._shareCloseRevision || 0) === shareSessionRevision) this.generateResultReportImage()
    })
    return true
  },

  closeSharePreview({ silent = false } = {}) {
    if (!this.data.shareSheetVisible && !this.data.isGeneratingResultReport
      && !this.data.isCheckingResultReportCache) return false
    if (this.data.isGeneratingResultReport || this.data.isCheckingResultReportCache) {
      cancelResultReportGeneration(this)
      this._reportCacheCheckRevision = 0
      this.resultReportSignature = ''
    }
    const closeRevision = (this._shareCloseRevision || 0) + 1
    this._shareCloseRevision = closeRevision
    if (!silent) {
      vibrate('light')
      this.setData({ shareSheetClosing: true })
      setTimeout(() => {
        if (this._isUnloaded || this._shareCloseRevision !== closeRevision) return
        this.setData({
          shareSheetVisible: false,
          shareSheetClosing: false,
          isCheckingResultReportCache: false,
          resultReportPreviewVisible: false,
          resultReportError: '',
          shareImageStyle: 'width:100%;height:100%;',
          shareImageFrameStyle: '',
        })
      }, SHEET_TRANSITION_DURATION)
      return true
    }
    this.setData({
      shareSheetVisible: false,
      shareSheetClosing: false,
      isCheckingResultReportCache: false,
      resultReportPreviewVisible: false,
      resultReportError: '',
      shareImageStyle: 'width:100%;height:100%;',
      shareImageFrameStyle: '',
    })
    return true
  },

  closeResultReportPreview() {
    return this.closeSharePreview()
  },

  retryResultReport() {
    if (!this.data.shareSheetVisible || this.data.isGeneratingResultReport
      || this.data.isCheckingResultReportCache || this.data.isCalculationPending
      || this.data.shareSheetClosing || !this.data.canUseResultActions) return false
    const inputRevision = this._inputRevision || 0
    const shareSessionRevision = this._shareCloseRevision || 0
    this.setData({ resultReportError: '' }, () => {
      if (!this._isUnloaded && this.data.shareSheetVisible
        && !this.data.shareSheetClosing && this._inputRevision === inputRevision
        && (this._shareCloseRevision || 0) === shareSessionRevision) this.generateResultReportImage()
    })
    return true
  },

  updateShareImageLayout() {
    if (!this.data.shareSheetVisible || this.data.shareSheetClosing || !this.data.resultReportPreviewVisible
      || !this.data.resultReportImagePath) return false
    const height = Number(this.data.resultReportCanvasHeight)
    if (!Number.isFinite(height) || height <= 0) return false
    const layoutRevision = this._shareLayoutRevision = (this._shareLayoutRevision || 0) + 1
    const inputRevision = this._inputRevision || 0
    const shareSessionRevision = this._shareCloseRevision || 0
    const reportRevision = this.resultReportRevision || 0
    const imagePath = this.data.resultReportImagePath
    const applyLayout = (nodes) => {
      if (this._isUnloaded || this._shareLayoutRevision !== layoutRevision
        || !this.data.shareSheetVisible || !this.data.resultReportPreviewVisible
        || this.data.shareSheetClosing
        || this._inputRevision !== inputRevision
        || (this._shareCloseRevision || 0) !== shareSessionRevision
        || this.resultReportRevision !== reportRevision
        || this.data.resultReportImagePath !== imagePath) return false
      const root = rectOf(nodes?.['.page-root'])
      const overlay = rectOf(nodes?.['.spl-overlay'])
      const panel = rectOf(nodes?.['#splSharePanel'])
      const header = rectOf(nodes?.['#splShareHeader'])
      const actions = rectOf(nodes?.['#splShareActions'])
      const frame = rectOf(nodes?.['#splShareImageFrame'])
      if (!root || !overlay || !panel || !header || !actions || !frame) return false

      const viewportLeft = Math.max(Number(root.left) || 0, Number(overlay.left) || 0)
      const viewportRight = Math.min(Number(root.right) || 0, Number(overlay.right) || 0)
      const panelLeft = Number(panel.left) || 0
      const panelRight = Number(panel.right) || 0
      const panelBorderTop = styleNumber(nodes['#splSharePanel'], 'borderTopWidth', 1)
      const panelBorderBottom = styleNumber(nodes['#splSharePanel'], 'borderBottomWidth', 1)
      const panelBorderLeft = styleNumber(nodes['#splSharePanel'], 'borderLeftWidth', 1)
      const panelBorderRight = styleNumber(nodes['#splSharePanel'], 'borderRightWidth', 1)
      const panelPaddingTop = styleNumber(nodes['#splSharePanel'], 'paddingTop', 15)
      const panelPaddingBottom = styleNumber(nodes['#splSharePanel'], 'paddingBottom', 46)
      const panelPaddingLeft = styleNumber(nodes['#splSharePanel'], 'paddingLeft', 16)
      const panelPaddingRight = styleNumber(nodes['#splSharePanel'], 'paddingRight', 16)
      const panelContentLeft = panelLeft + panelBorderLeft + panelPaddingLeft
      const panelContentRight = panelRight - panelBorderRight - panelPaddingRight
      const frameLeft = Math.max(Number(frame.left) || 0, panelContentLeft, viewportLeft)
      const frameRight = Math.min(Number(frame.right) || 0, panelContentRight, viewportRight)
      const horizontalInsets = styleNumber(nodes['#splShareImageFrame'], 'borderLeftWidth', 1)
        + styleNumber(nodes['#splShareImageFrame'], 'borderRightWidth', 1)
        + styleNumber(nodes['#splShareImageFrame'], 'paddingLeft')
        + styleNumber(nodes['#splShareImageFrame'], 'paddingRight')
      const verticalInsets = styleNumber(nodes['#splShareImageFrame'], 'borderTopWidth', 1)
        + styleNumber(nodes['#splShareImageFrame'], 'borderBottomWidth', 1)
        + styleNumber(nodes['#splShareImageFrame'], 'paddingTop')
        + styleNumber(nodes['#splShareImageFrame'], 'paddingBottom')
      const maxPanelHeight = Math.min(
        Number(root.height) || 0,
        Number(overlay.height) || 0,
      ) * 0.9
      const panelFixedInsets = panelBorderTop + panelBorderBottom
        + panelPaddingTop + panelPaddingBottom
      const headerBottomMargin = styleNumber(nodes['#splShareHeader'], 'marginBottom', 9)
      const maxFrameOuterHeight = maxPanelHeight - panelFixedInsets
        - (Number(header.height) || 0) - headerBottomMargin - (Number(actions.height) || 0)
      const availableWidth = Math.max(0, frameRight - frameLeft - horizontalInsets)
      const availableHeight = Math.max(0, maxFrameOuterHeight - verticalInsets)
      if (!(availableWidth > 0) || !(availableHeight > 0)) return false

      const scale = Math.min(availableWidth / REPORT_WIDTH, availableHeight / height)
      if (!Number.isFinite(scale) || scale <= 0) return false
      const imageWidth = Math.floor(REPORT_WIDTH * scale * 100) / 100
      const imageHeight = Math.floor(height * scale * 100) / 100
      const frameHeight = Math.floor(imageHeight + verticalInsets)
      this.setData({
        shareImageStyle: `width:${imageWidth}px;height:${imageHeight}px;max-width:100%;max-height:100%;`,
        shareImageFrameStyle: `height:${frameHeight}px;flex:none;`,
      })
      return { width: imageWidth, height: imageHeight }
    }
    try {
      if (typeof wx.createSelectorQuery !== 'function') return false
      const query = wx.createSelectorQuery()
      const scopedQuery = typeof query.in === 'function' ? query.in(this) : query
      const nodes = {}
      const read = (selector, styles = []) => {
        const selection = scopedQuery.select(selector)
        const callback = (value) => { nodes[selector] = value }
        if (typeof selection.fields === 'function') {
          selection.fields({ rect: true, size: true, computedStyle: styles }, callback)
        } else {
          selection.boundingClientRect(callback)
        }
      }
      read('.page-root')
      read('.spl-overlay')
      read('#splSharePanel', [
        'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
        'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
      ])
      read('#splShareHeader', ['marginBottom'])
      read('#splShareActions')
      read('#splShareImageFrame', [
        'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
        'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
      ])
      scopedQuery.exec(() => applyLayout(nodes))
      return true
    } catch (error) {
      return false
    }
  },

  onResultReportImageLoad() {
    if (!this.data.shareSheetVisible || !this.data.resultReportImagePath) return false
    return this.updateShareImageLayout()
  },

  generateResultReportImage() {
    if (this.data.shareSheetClosing) return false
    const record = this.getRecordPayload()
    const payload = buildSplReportPayload(this.data)
    if (!payload || !this.data.canUseResultActions || this.data.isCalculationPending) {
      if (this.data.shareSheetVisible) this.setData({ resultReportError: '当前参数尚无有效结果，请检查输入后重试。' })
      return false
    }
    if (this.data.isGeneratingResultReport || this.data.isCheckingResultReportCache) return false
    const signature = this.getResultReportSignature(record)
    const inputRevision = this._inputRevision || 0
    const shareSessionRevision = this._shareCloseRevision || 0
    const isCurrent = (revision) => !this._isUnloaded && this._pageVisible
      && this.data.shareSheetVisible && this.data.canUseResultActions
      && !this.data.shareSheetClosing
      && !this.data.isCalculationPending && this._inputRevision === inputRevision
      && (this._shareCloseRevision || 0) === shareSessionRevision
      && this.resultReportRevision === revision
      && this.getResultReportSignature() === signature

    if (this.data.resultReportImagePath && this.resultReportSignature === signature) {
      const path = this.data.resultReportImagePath
      const revision = (this.resultReportRevision || 0) + 1
      this.resultReportRevision = revision
      this._reportCacheCheckRevision = revision
      this.setData({
        isCheckingResultReportCache: true,
        resultReportPreviewVisible: false,
        resultReportError: '',
      }, () => {
        if (!isCurrent(revision) || this._reportCacheCheckRevision !== revision) return
        const showCached = () => {
          if (!isCurrent(revision) || this._reportCacheCheckRevision !== revision) return
          this._reportCacheCheckRevision = 0
          this.setData({ isCheckingResultReportCache: false, resultReportPreviewVisible: true }, () => {
            if (isCurrent(revision)) this.updateShareImageLayout()
          })
        }
        const regenerate = () => {
          if (!isCurrent(revision) || this._reportCacheCheckRevision !== revision) return
          this._reportCacheCheckRevision = 0
          this.resultReportSignature = ''
          this.setData({
            isCheckingResultReportCache: false,
            resultReportImagePath: '',
            resultReportPreviewVisible: false,
          }, () => {
            if (isCurrent(revision)) this.generateResultReportImage()
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
      resultReportCanvasHeight = calculateSplReportHeight(payload, measureContext)
    } catch (error) {
      this.setData({ resultReportError: '图片排版失败，请重试。' })
      return false
    }
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
      if (!isCurrent(revision) || this.resultReportPendingSignature !== signature) return
      const finish = (changes = {}) => {
        if (!isCurrent(revision) || this.resultReportPendingSignature !== signature) return false
        this.resultReportPendingSignature = ''
        this.setData({ isGeneratingResultReport: false, ...changes }, () => {
          if (changes.resultReportPreviewVisible && isCurrent(revision)) this.updateShareImageLayout()
        })
        return true
      }
      try {
        drawAndExportReport(this, {
          canvasId: REPORT_CANVAS_ID,
          isCurrent: () => isCurrent(revision) && this.resultReportPendingSignature === signature,
          width: REPORT_WIDTH,
          height: resultReportCanvasHeight,
          draw: (context) => drawSplReport(context, payload, resultReportCanvasHeight),
          getExportOptions: () => getExportDimensions(resultReportCanvasHeight),
          startExportMeasurement: (dimensions) => startMeasurement('声压级/结果图导出', dimensions),
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
      || !this.data.canUseResultActions || this.data.isCalculationPending
      || this.data.shareSheetClosing
      || this.data.isGeneratingResultReport || this.data.isCheckingResultReportCache) return false
    this._previewImageOpening = true
    try {
      wx.previewImage({
        current: this.data.resultReportImagePath,
        urls: [this.data.resultReportImagePath],
        fail: () => { this._previewImageOpening = false },
      })
      setTimeout(() => {
        if (this._pageVisible && this._previewImageOpening) this._previewImageOpening = false
      }, 2000)
      return true
    } catch (error) {
      this._previewImageOpening = false
      return false
    }
  },

  shareResultReportImage() {
    if (!this.data.shareSheetVisible || !this.data.resultReportImagePath
      || !this.data.canUseResultActions || this.data.isCalculationPending
      || this.data.shareSheetClosing
      || this.data.isGeneratingResultReport || this.data.isCheckingResultReportCache) return false
    if (typeof wx.showShareImageMenu === 'function') {
      wx.showShareImageMenu({
        path: this.data.resultReportImagePath,
        fail: ({ errMsg = '' } = {}) => {
          if (!/cancel/i.test(errMsg)) wx.showToast({ title: '转发未完成，请重试', icon: 'none' })
        },
      })
      return true
    }
    const opened = this.previewResultReportImage()
    if (opened) wx.showToast({ title: '请长按图片转发', icon: 'none' })
    return opened
  },

  saveResultReportImage() {
    if (!this.data.shareSheetVisible || !this.data.resultReportImagePath
      || !this.data.canUseResultActions || this.data.isCalculationPending
      || this.data.shareSheetClosing
      || this.data.isGeneratingResultReport || this.data.isCheckingResultReportCache) return false
    return saveGeneratedImage(this.data.resultReportImagePath)
  },

  requestReset() {
    if (!this.data.canReset || this.data.isResetPending || this._isUnloaded) return false
    return this.clearSplInputs()
  },

  clearSplInputs() {
    if (this._isUnloaded) return false
    const persisted = writePreferencesDetailed(PREFERENCE_KEY, EMPTY_SPL_PREFERENCES)
    if (!persisted?.ok) {
      this.setData({ resetError: '清空参数保存失败，当前输入未清除，请重试。' })
      wx.showToast({ title: '清空失败，请重试', icon: 'none' })
      return false
    }
    this.beginInputRevision()
    this._selectorMatches = []
    this._lastProjectTarget = null
    this._projectSnapshotForSave = null
    const changes = {
      speakerIndex: -1,
      selectedSpeaker: null,
      countIndex: -1,
      distanceText: '',
      summationModeIndex: 0,
      showSummationMode: false,
      selectorVisible: false,
      speakerKeyword: '',
      speakerCategoryIndex: 0,
      selectorKeyword: '',
      selectorCategoryIndex: 0,
      selectorItems: [],
      selectorTotalCount: 0,
      currentFavorite: false,
      canUseResultActions: false,
      isCalculationPending: false,
      resetError: '',
      isResetPending: false,
      shareSheetVisible: false,
      shareSheetClosing: false,
      resultReportImagePath: '',
      resultReportCanvasHeight: 1250,
      resultReportPreviewVisible: false,
      isCheckingResultReportCache: false,
      isGeneratingResultReport: false,
      resultReportError: '',
      shareImageStyle: 'width:100%;height:100%;',
      projectSheetVisible: false,
      projectSheetClosing: false,
      projectStep: 'select',
      projectLoadState: 'idle',
      projectError: '',
      projectSearch: '',
      projectItems: [],
      projectTargetId: '',
      projectTargetName: '',
      newProjectName: '',
      projectNameError: '',
      projectConfigName: '',
      projectConfigNote: '',
      projectConfigNameError: '',
      projectNoteError: '',
      projectSaveError: '',
      projectPreview: null,
      isSavingProject: false,
      projectKeyboardActive: false,
      projectKeyboardPanelStyle: '',
      savedProjectName: '',
      savedConfigName: '',
      savedAtText: '',
    }
    this.commitCalculatedState(changes, { skipRevision: true })
    vibrate('light')
    return true
  },
...splProjectMethods,

  onResize() {
    if (this._isUnloaded || !this._pageVisible) return
    if (this.data.shareSheetVisible && this.data.resultReportPreviewVisible) {
      this.updateShareImageLayout()
    }
    if (this.data.projectSheetVisible) {
      const currentHeight = getProjectKeyboardHeight()
      if (!this._projectKeyboardHeight && currentHeight) {
        this._projectKeyboardWindowHeight = currentHeight
        this._projectKeyboardBaselineHeight = currentHeight
      }
      if (this._projectKeyboardHeight) this.updateProjectKeyboardLayout()
    }
  },

  copyResult() {
    const resultText = this.getResultText()
    if (!resultText) return false
    const inputRevision = this._inputRevision || 0
    wx.setClipboardData({ data: resultText, success: () => {
      if (!this._isUnloaded && this._pageVisible
        && (this._inputRevision || 0) === inputRevision
        && this.getResultText() === resultText && isPageContextCurrent(this)) vibrate('medium')
    } })
    return true
  },

  toggleCurrentFavorite() {
    if (!this.data.canUseResultActions || this.data.isCalculationPending
      || this.data.shareSheetVisible || this.data.projectSheetVisible
      || this.data.selectorVisible || this._favoritePending) return false
    this._favoritePending = true
    try { togglePageFavorite(this) } finally { this._favoritePending = false }
    return true
  },
})

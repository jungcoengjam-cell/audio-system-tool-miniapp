const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishSplModuleLoad = startMeasurement('声压级/脚本加载')
const { speakers } = require('../../data/equipment')
const { calculateSpeakerSpl } = require('../../utils/spl')
const { findValueIndex, readPreferences, writePreferences } = require('../../utils/preferences')
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

const DEFAULT_SPEAKER_MODEL = 'TS-803C'
const PREFERENCE_KEY = 'audioTool.spl.preferences'
const INPUT_CALCULATION_DELAY = 160
const SELECTOR_BATCH_SIZE = 60

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

function calculatePageResult(state) {
  const distanceMeters = Number(state.distanceText)
  if (!Number.isFinite(distanceMeters) || distanceMeters < 1 || distanceMeters > 1000) {
    return {
      result: null,
      distanceError: '请输入 1 至 1000 米之间的测量距离。',
    }
  }

  const result = calculateSpeakerSpl({
    speaker: speakerCatalog[state.speakerIndex],
    distanceMeters,
    speakerCount: state.counts[state.countIndex],
    summationMode: state.summationModes[state.summationModeIndex].value,
  })
  if (!result) {
    return {
      result: null,
      distanceError: '当前音箱缺少有效的灵敏度或额定功率数据，无法进行声压级估算。',
    }
  }

  const summationMode = state.summationModes[state.summationModeIndex]
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
  return {
    speakerModel: speakerOptions[state.speakerIndex].model,
    distanceText: state.distanceText,
    speakerCount: state.counts[state.countIndex],
    summationMode: state.summationModes[state.summationModeIndex].value,
  }
}

Page({
  data: {
    selectedSpeaker: speakerOptions[defaultSpeakerIndex],
    speakerCategories,
    speakerIndex: defaultSpeakerIndex,
    speakerKeyword: '',
    speakerCategoryIndex: 0,
    distanceText: '4',
    counts: [1, 2, 3, 4, 6, 8, 12, 16],
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
    result: null,
    currentFavorite: false,
    distanceError: '',
    selectorVisible: false,
    selectorKeyword: '',
    selectorCategoryIndex: 0,
    selectorItems: [],
    selectorTotalCount: 0,
    ...createResultReportData(),
  },

  onLoad() {
    const finishInitialization = startMeasurement('声压级/初始化总耗时')
    this._pageVisible = false
    this._favoriteSyncedSinceLoad = false
    const preferences = readPreferences(PREFERENCE_KEY)
    const countIndex = findValueIndex(this.data.counts, preferences.speakerCount)
    const changes = {
      speakerIndex: findCatalogModelIndex(
        speakerOptions,
        preferences.speakerModel || DEFAULT_SPEAKER_MODEL,
      ),
      distanceText: preferences.distanceText || '4',
      countIndex,
      showSummationMode: this.data.counts[countIndex] > 1,
      summationModeIndex: findValueIndex(
        this.data.summationModes,
        preferences.summationMode,
        (item) => item.value,
      ),
    }
    changes.selectedSpeaker = speakerOptions[changes.speakerIndex]
    const pageState = { ...this.data, ...changes }
    const finishCoreCalculation = startMeasurement('声压级/核心计算', { source: 'onLoad' })
    const calculated = calculatePageResult(pageState)
    finishCoreCalculation({ valid: Boolean(calculated.result) })
    const finishViewUpdate = startMeasurement('声压级/setData视图更新', { source: 'onLoad' })
    this.setData({ ...changes, ...calculated }, () => {
      finishViewUpdate()
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        syncPageFavorite(this)
        this._favoriteSyncedSinceLoad = true
      }
      finishInitialization({ speaker: speakerOptions[pageState.speakerIndex].model })
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
    this.flushDistanceCalculation()
  },

  onUnload() {
    this._pageVisible = false
    this.cancelDistanceCalculation()
    cancelResultReportGeneration(this)
    printPerformanceSummary('声压级/')
  },

  onDistanceInput(event) {
    this.setData({ distanceText: event.detail.value })
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

  openSpeakerSelector() {
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

  commitCalculatedState(changes = {}) {
    this.cancelDistanceCalculation()
    const finishCalculation = startMeasurement('声压级/计算到结果更新', {
      fields: Object.keys(changes).length,
    })
    const viewChanges = { ...changes }
    if (Number.isInteger(changes.speakerIndex)) {
      viewChanges.selectedSpeaker = speakerOptions[changes.speakerIndex]
    }
    const pageState = { ...this.data, ...viewChanges }
    const finishCoreCalculation = startMeasurement('声压级/核心计算', { source: 'interaction' })
    const calculated = calculatePageResult(pageState)
    finishCoreCalculation({ valid: Boolean(calculated.result) })
    const resultReportChanges = resetStaleResultReport(
      this,
      this.getRecordPayload(pageState, calculated.result),
    )
    const finishViewUpdate = startMeasurement('声压级/setData视图更新', { source: 'interaction' })
    this.setData({
      ...viewChanges,
      ...calculated,
      ...resultReportChanges,
    }, () => {
      finishViewUpdate()
      let preferencesChanged = false
      if (calculated.result) {
        preferencesChanged = writePreferences(PREFERENCE_KEY, buildPreferences(pageState))
        if (this._pageVisible) syncPageFavorite(this)
      }
      finishCalculation({ valid: Boolean(calculated.result), preferencesChanged })
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

  getRecordLookupPayload() {
    return this.data.result
      ? { module: 'spl', preferences: this.getPreferences() }
      : null
  },

  getResultText(state = this.data, result = state.result) {
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

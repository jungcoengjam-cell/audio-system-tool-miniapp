const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishLimiterModuleLoad = startMeasurement('限幅器/脚本加载')
const { amplifiers, speakers } = require('../../data/equipment')
const { calculateLimiter } = require('../../utils/limiter')
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

const DEFAULT_AMPLIFIER_MODEL = 'TC-2350B'
const DEFAULT_SPEAKER_MODEL = 'TS-803C'
const PREFERENCE_KEY = 'audioTool.limiter.preferences'
const SELECTOR_BATCH_SIZE = 60

const amplifierCatalog = amplifiers
const speakerCatalog = speakers.filter((item) => !item.calculationDisabled)
const amplifierOptions = buildCatalogOptions(amplifierCatalog)
const speakerOptions = buildCatalogOptions(speakerCatalog)
const amplifierCategories = buildCatalogCategories(amplifierOptions)
const speakerCategories = buildCatalogCategories(speakerOptions)
const defaultAmplifierIndex = findCatalogModelIndex(amplifierOptions, DEFAULT_AMPLIFIER_MODEL)
const defaultSpeakerIndex = findCatalogModelIndex(speakerOptions, DEFAULT_SPEAKER_MODEL)
const resultReportMethods = createResultReportMethods({ performancePrefix: '限幅器' })
finishLimiterModuleLoad({
  amplifiers: amplifierOptions.length,
  speakers: speakerOptions.length,
})

function calculatePageResult(state) {
  return calculateLimiter({
    amplifier: amplifierCatalog[state.amplifierIndex],
    speaker: speakerCatalog[state.speakerIndex],
    count: state.counts[state.countIndex],
    wiring: state.wirings[state.wiringIndex].value,
    mode: state.modes[state.modeIndex].value,
    sensitivityVoltage: state.sensitivities[state.sensitivityIndex].value,
    highPassFrequency: state.highPassFrequencies[state.highPassFrequencyIndex].value,
  })
}

function buildPreferences(state) {
  return {
    amplifierModel: amplifierOptions[state.amplifierIndex].model,
    speakerModel: speakerOptions[state.speakerIndex].model,
    count: state.counts[state.countIndex],
    wiring: state.wirings[state.wiringIndex].value,
    mode: state.modes[state.modeIndex].value,
    sensitivityVoltage: state.sensitivities[state.sensitivityIndex].value,
    highPassFrequency: state.highPassFrequencies[state.highPassFrequencyIndex].value,
  }
}

Page({
  data: {
    selectedAmplifier: amplifierOptions[defaultAmplifierIndex],
    selectedSpeaker: speakerOptions[defaultSpeakerIndex],
    counts: [1, 2, 3, 4],
    wirings: [
      { value: 'parallel', label: '并联' },
      { value: 'series', label: '串联' },
    ],
    modes: [
      { value: 'stereo', label: '立体声/单通道' },
      { value: 'bridge', label: '桥接' },
    ],
    sensitivities: [
      { value: 1, label: '1 V（2.2 dBu）' },
      { value: 2, label: '2 V（8.2 dBu）' },
    ],
    highPassFrequencies: [
      { value: null, label: '未选择' },
      { value: 10, label: '10 Hz' },
      { value: 20, label: '20 Hz' },
      { value: 25, label: '25 Hz' },
      { value: 31, label: '31 Hz' },
      { value: 40, label: '40 Hz' },
      { value: 50, label: '50 Hz' },
      { value: 63, label: '63 Hz' },
      { value: 80, label: '80 Hz' },
      { value: 100, label: '100 Hz' },
      { value: 125, label: '125 Hz' },
      { value: 160, label: '160 Hz' },
      { value: 200, label: '200 Hz' },
      { value: 250, label: '250 Hz' },
      { value: 315, label: '315 Hz' },
      { value: 400, label: '400 Hz' },
      { value: 500, label: '500 Hz' },
      { value: 630, label: '630 Hz' },
      { value: 800, label: '800 Hz' },
      { value: 1000, label: '1 kHz' },
      { value: 1250, label: '1.25 kHz' },
      { value: 1600, label: '1.6 kHz' },
      { value: 2000, label: '2 kHz' },
      { value: 2500, label: '2 kHz 以上' },
    ],
    amplifierIndex: defaultAmplifierIndex,
    speakerIndex: defaultSpeakerIndex,
    amplifierKeyword: '',
    speakerKeyword: '',
    amplifierCategoryIndex: 0,
    speakerCategoryIndex: 0,
    countIndex: 0,
    wiringIndex: 0,
    showWiring: false,
    modeIndex: 0,
    sensitivityIndex: 0,
    highPassFrequencyIndex: 0,
    result: null,
    currentFavorite: false,
    selectorVisible: false,
    selectorType: '',
    selectorTitle: '',
    selectorKeyword: '',
    selectorCategoryIndex: 0,
    selectorCategories: [],
    selectorItems: [],
    selectorTotalCount: 0,
    ...createResultReportData(),
  },

  onLoad() {
    const finishInitialization = startMeasurement('限幅器/初始化总耗时')
    this._pageVisible = false
    this._favoriteSyncedSinceLoad = false
    const preferences = readPreferences(PREFERENCE_KEY)
    const amplifierIndex = findCatalogModelIndex(amplifierOptions, preferences.amplifierModel || DEFAULT_AMPLIFIER_MODEL)
    const speakerIndex = findCatalogModelIndex(speakerOptions, preferences.speakerModel || DEFAULT_SPEAKER_MODEL)
    const countIndex = findValueIndex(this.data.counts, preferences.count)
    const count = this.data.counts[countIndex]

    const changes = {
      amplifierIndex,
      speakerIndex,
      selectedAmplifier: amplifierOptions[amplifierIndex],
      selectedSpeaker: speakerOptions[speakerIndex],
      countIndex,
      wiringIndex: count > 1
        ? findValueIndex(this.data.wirings, preferences.wiring, (item) => item.value)
        : 0,
      showWiring: count > 1,
      modeIndex: findValueIndex(this.data.modes, preferences.mode, (item) => item.value),
      sensitivityIndex: findValueIndex(
        this.data.sensitivities,
        preferences.sensitivityVoltage,
        (item) => item.value,
      ),
      highPassFrequencyIndex: findValueIndex(
        this.data.highPassFrequencies,
        preferences.highPassFrequency,
        (item) => item.value,
      ),
    }
    const pageState = { ...this.data, ...changes }
    const finishCoreCalculation = startMeasurement('限幅器/核心计算', { source: 'onLoad' })
    const result = calculatePageResult(pageState)
    finishCoreCalculation({ valid: result.valid })
    const finishViewUpdate = startMeasurement('限幅器/setData视图更新', { source: 'onLoad' })
    this.setData({ ...changes, result }, () => {
      finishViewUpdate()
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        syncPageFavorite(this)
        this._favoriteSyncedSinceLoad = true
      }
      finishInitialization({
        amplifier: amplifierOptions[pageState.amplifierIndex].model,
        speaker: speakerOptions[pageState.speakerIndex].model,
      })
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
  },

  onUnload() {
    this._pageVisible = false
    cancelResultReportGeneration(this)
    printPerformanceSummary('限幅器/')
  },

  onPickerChange(event) {
    const field = event.currentTarget.dataset.field
    const value = Number(event.detail.value)
    if (this.data[field] !== value) vibrate('light')
    const nextData = {
      [field]: value,
    }

    if (field === 'countIndex') {
      const count = this.data.counts[value]
      nextData.showWiring = count > 1

      if (count === 1) {
        nextData.wiringIndex = 0
      }
    }

    this.commitCalculatedState(nextData)
  },

  openEquipmentSelector(event) {
    const type = event.currentTarget.dataset.type
    const isAmplifier = type === 'amplifier'
    const keyword = isAmplifier
      ? this.data.amplifierKeyword
      : this.data.speakerKeyword
    const categoryIndex = isAmplifier
      ? this.data.amplifierCategoryIndex
      : this.data.speakerCategoryIndex
    const categories = isAmplifier
      ? amplifierCategories
      : speakerCategories
    const items = isAmplifier
      ? amplifierOptions
      : speakerOptions

    const finishFilter = startMeasurement('限幅器/设备搜索过滤', {
      source: 'open',
      type,
    })
    const selectorMatches = filterCatalogItems(items, categories, keyword, categoryIndex)
    const selectorItems = selectorMatches.slice(0, SELECTOR_BATCH_SIZE)
    this._selectorMatches = selectorMatches
    finishFilter({ matches: selectorMatches.length })
    const finishViewUpdate = startMeasurement('限幅器/设备搜索视图更新', {
      source: 'open',
      type,
    })
    this.setData({
      selectorVisible: true,
      selectorType: type,
      selectorTitle: isAmplifier ? '选择功放型号' : '选择音箱型号',
      selectorKeyword: keyword,
      selectorCategoryIndex: categoryIndex,
      selectorCategories: categories,
      selectorItems,
      selectorTotalCount: selectorMatches.length,
    }, () => finishViewUpdate({
      matches: selectorMatches.length,
      rendered: selectorItems.length,
    }))
  },

  closeEquipmentSelector() {
    this._selectorMatches = []
    this.setData({
      selectorVisible: false,
      selectorItems: [],
      selectorTotalCount: 0,
    })
  },

  stopTap() {},

  onSelectorInput(event) {
    const keyword = event.detail.value
    this.refreshSelector({
      keyword,
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
    const keyword = options.keyword
    const categoryIndex = options.categoryIndex
    const isAmplifier = this.data.selectorType === 'amplifier'
    const items = isAmplifier
      ? amplifierOptions
      : speakerOptions
    const categories = isAmplifier
      ? amplifierCategories
      : speakerCategories
    const finishFilter = startMeasurement('限幅器/设备搜索过滤', {
      source: 'filter',
      type: this.data.selectorType,
    })
    const selectorMatches = filterCatalogItems(items, categories, keyword, categoryIndex)
    const selectorItems = selectorMatches.slice(0, SELECTOR_BATCH_SIZE)
    this._selectorMatches = selectorMatches
    finishFilter({ matches: selectorMatches.length })
    const nextData = {
      selectorKeyword: keyword,
      selectorCategoryIndex: categoryIndex,
      selectorItems,
      selectorTotalCount: selectorMatches.length,
    }

    if (isAmplifier) {
      nextData.amplifierKeyword = keyword
      nextData.amplifierCategoryIndex = categoryIndex
    } else {
      nextData.speakerKeyword = keyword
      nextData.speakerCategoryIndex = categoryIndex
    }

    const finishViewUpdate = startMeasurement('限幅器/设备搜索视图更新', {
      source: 'filter',
      type: this.data.selectorType,
    })
    this.setData(nextData, () => finishViewUpdate({
      matches: selectorMatches.length,
      rendered: selectorItems.length,
    }))
  },

  appendSelectorItems() {
    const selectorMatches = this._selectorMatches || []
    const rendered = this.data.selectorItems.length
    if (rendered >= selectorMatches.length) return
    const selectorItems = selectorMatches.slice(0, rendered + SELECTOR_BATCH_SIZE)
    const finishViewUpdate = startMeasurement('限幅器/设备搜索视图更新', {
      source: 'append',
      type: this.data.selectorType,
    })
    this.setData({ selectorItems }, () => finishViewUpdate({
      matches: selectorMatches.length,
      rendered: selectorItems.length,
    }))
  },

  selectEquipment(event) {
    const index = Number(event.currentTarget.dataset.index)
    const isAmplifier = this.data.selectorType === 'amplifier'
    const currentIndex = isAmplifier ? this.data.amplifierIndex : this.data.speakerIndex
    if (index !== currentIndex) vibrate('light')
    const nextData = {
      selectorVisible: false,
      selectorItems: [],
      selectorTotalCount: 0,
    }
    this._selectorMatches = []

    if (isAmplifier) {
      nextData.amplifierIndex = index
    } else {
      nextData.speakerIndex = index
    }

    this.commitCalculatedState(nextData)
  },

  openEquipmentDetail(event) {
    const type = this.data.selectorType === 'amplifier' ? 'amplifier' : 'speaker'
    const model = event.currentTarget.dataset.model

    this._selectorMatches = []
    this.setData({ selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
    wx.navigateTo({
      url: `/pages/products/detail?type=${type}&model=${encodeURIComponent(model)}`,
    })
  },

  calculate() {
    return this.commitCalculatedState()
  },

  commitCalculatedState(changes = {}) {
    const finishCalculation = startMeasurement('限幅器/计算到结果更新', {
      fields: Object.keys(changes).length,
    })
    const viewChanges = { ...changes }
    if (Number.isInteger(changes.amplifierIndex)) {
      viewChanges.selectedAmplifier = amplifierOptions[changes.amplifierIndex]
    }
    if (Number.isInteger(changes.speakerIndex)) {
      viewChanges.selectedSpeaker = speakerOptions[changes.speakerIndex]
    }
    const pageState = { ...this.data, ...viewChanges }
    const finishCoreCalculation = startMeasurement('限幅器/核心计算', { source: 'interaction' })
    const result = calculatePageResult(pageState)
    finishCoreCalculation({ valid: result.valid })
    const preferences = buildPreferences(pageState)
    const resultReportChanges = resetStaleResultReport(
      this,
      this.getRecordPayload(pageState, result),
    )
    const finishViewUpdate = startMeasurement('限幅器/setData视图更新', { source: 'interaction' })
    this.setData({
      ...viewChanges,
      result,
      ...resultReportChanges,
    }, () => {
      finishViewUpdate()
      const preferencesChanged = writePreferences(PREFERENCE_KEY, preferences)
      if (this._pageVisible) syncPageFavorite(this)
      finishCalculation({ valid: result.valid, preferencesChanged })
    })
    return result
  },

  getPreferences() {
    return buildPreferences(this.data)
  },

  getRecordLookupPayload() {
    return this.data.result?.valid
      ? { module: 'limiter', preferences: this.getPreferences() }
      : null
  },

  getResultText(state = this.data, result = state.result) {
    if (!result?.valid) return ''

    const count = state.counts[state.countIndex]
    const lines = [
      '限幅器参数计算',
      '结果性质：产品参数计算',
      `功放：${state.selectedAmplifier.model}`,
      `音箱：${state.selectedSpeaker.model} × ${count} 只/通道`,
      `连接：${count > 1 ? state.wirings[state.wiringIndex].label : '单只连接'} · ${state.modes[state.modeIndex].label}`,
      `功放输入灵敏度：${state.sensitivities[state.sensitivityIndex].label}`,
      `总负载：${result.loadImpedance} Ω · ${result.totalRatedPower} W`,
      `限幅阈值：${result.thresholdDbfs} dBFS（0 dBFS = +18.4 dBu）`,
    ]
    if (result.timingReady) {
      lines.push(
        `通道 HPF：${result.highPassFrequency} Hz`,
        `建立时间 Attack：${result.attackTimeMs} ms`,
        `释放时间 Release：${result.releaseTimeMs} ms`,
      )
    }
    lines.push(
      result.statusText,
      '注：按说明书额定功率作理论计算，现场仍需核对接线、标定和实际电平。',
    )
    return lines.join('\n')
  },

  getRecordPayload(state = this.data, result = state.result) {
    const resultText = this.getResultText(state, result)
    if (!resultText) return null

    const amplifierModel = state.selectedAmplifier.model
    const speakerModel = state.selectedSpeaker.model
    return {
      module: 'limiter',
      title: `${amplifierModel} + ${speakerModel}`,
      summary: result.timingReady
        ? `阈值 ${result.thresholdDbfs} dBFS · Attack ${result.attackTimeMs} ms · Release ${result.releaseTimeMs} ms`
        : `阈值 ${result.thresholdDbfs} dBFS`,
      preferences: buildPreferences(state),
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

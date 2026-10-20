const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const finishLimiterModuleLoad = startMeasurement('限幅器/脚本加载')
const { amplifiers, speakers } = require('../../data/equipment')
const { calculateLimiter } = require('../../utils/limiter')
const { readPreferences, writePreferencesDetailed, removePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  cancelResultReportGeneration, createResultReportData, createResultReportMethods,
  resetStaleResultReport,
} = require('../../utils/result-report-controller')
const {
  buildCatalogCategories, buildCatalogOptions, filterCatalogItems, findCatalogModelIndex,
} = require('../../utils/catalog-selector')
const {
  requestEditorLeave,
  saveEditorRecord: saveEditorRecordAction,
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')
const { attachResultEditor, captureEditorBaseline, finalizeResultEditor } = require('../../utils/result-record-context')
const {
  addRecordToProject, createProject, getProjectRecordView, getRecordByPayload, getWorkspaceSnapshot,
} = require('../../utils/records')
const { drawAndExportReport } = require('../../utils/report-canvas')
const {
  REPORT_CANVAS_ID, REPORT_WIDTH, buildResultReportPayload, getExportDimensions,
} = require('../../utils/result-report')
const { calculateResultReportHeight, drawResultReport } = require('./limiter-report')

const PREFERENCE_KEY = 'audioTool.limiter.preferences'
const SELECTOR_BATCH_SIZE = 60
const REMINDER_DURATION = 15000
const INPUT_FIELDS = ['amplifierIndex', 'speakerIndex', 'countIndex', 'wiringIndex', 'modeIndex', 'sensitivityIndex', 'highPassFrequencyIndex']
const GROUPS = [
  { key: 'device', label: '设备' },
  { key: 'load', label: '负载' },
  { key: 'settings', label: '设置' },
]
const amplifierCatalog = amplifiers
const speakerCatalog = speakers.filter((item) => !item.calculationDisabled)
const amplifierOptions = buildCatalogOptions(amplifierCatalog)
const speakerOptions = buildCatalogOptions(speakerCatalog)
const amplifierCategories = buildCatalogCategories(amplifierOptions)
const speakerCategories = buildCatalogCategories(speakerOptions)
finishLimiterModuleLoad({ amplifiers: amplifierOptions.length, speakers: speakerOptions.length })
const resultReportMethods = createResultReportMethods({ performancePrefix: '限幅器' })

function optionIndex(items, value, getter = (item) => item) {
  return items.findIndex((item) => getter(item) === value)
}

function validIndex(items, index) {
  return Number.isInteger(index) && index >= 0 && index < items.length
}

function eventIndex(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null
  const index = Number(value)
  return Number.isSafeInteger(index) ? index : null
}

const PROJECT_KEYBOARD_FIELDS = new Set([
  'projectSearch', 'newProjectName', 'projectConfigName', 'projectConfigNote',
])
const PROJECT_KEYBOARD_FIELDS_BY_STEP = {
  select: new Set(['projectSearch']),
  create: new Set(['newProjectName']),
  details: new Set(['projectConfigName', 'projectConfigNote']),
}

function isProjectKeyboardFieldForStep(step, field) {
  return Boolean(PROJECT_KEYBOARD_FIELDS_BY_STEP[step]
    && PROJECT_KEYBOARD_FIELDS_BY_STEP[step].has(field))
}

function getLimiterWindowHeight(event) {
  const eventHeight = Number(event && event.size && event.size.windowHeight)
  if (Number.isFinite(eventHeight) && eventHeight > 0) return eventHeight
  try {
    if (typeof wx === 'undefined') return 0
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const height = Number(info && info.windowHeight)
    return Number.isFinite(height) && height > 0 ? height : 0
  } catch (error) {
    return 0
  }
}

function projectKeyboardLayout(page) {
  const currentHeight = page._projectKeyboardCurrentWindowHeight || getLimiterWindowHeight()
  const baselineHeight = page._projectKeyboardBaselineHeight || currentHeight
  const keyboardHeight = Math.max(0, page._projectKeyboardHeight || 0)
  const visibleHeight = Math.max(0, Math.min(currentHeight, baselineHeight - keyboardHeight))
  const lift = Math.max(0, keyboardHeight - Math.max(0, baselineHeight - currentHeight))
  const active = keyboardHeight > 0 && Boolean(page._projectKeyboardFocusId)
  const roundedVisibleHeight = Math.floor(visibleHeight)
  const roundedLift = Math.ceil(lift)
  return {
    projectKeyboardActive: active,
    projectKeyboardVisibleHeight: roundedVisibleHeight,
    projectKeyboardLift: roundedLift,
    projectKeyboardPanelStyle: active
      ? `max-height:${roundedVisibleHeight}px;margin-bottom:${roundedLift}px;`
      : '',
  }
}

function projectKeyboardEventField(event) {
  return event && ((event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.projectField)
    || (event.target && event.target.dataset && event.target.dataset.projectField)) || ''
}

function projectKeyboardEventTime(event) {
  const time = Number(event && event.timeStamp)
  return Number.isFinite(time) && time > 0 ? time : 0
}

function projectKeyboardEventEpisode(event) {
  const raw = event && ((event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.projectEpisode)
    ?? (event.target && event.target.dataset && event.target.dataset.projectEpisode))
  const episode = Number(raw)
  return Number.isSafeInteger(episode) && episode >= 0 ? episode : null
}

function isCurrentProjectKeyboardEvent(page, event) {
  const episode = projectKeyboardEventEpisode(event)
  return episode != null && episode === page._projectKeyboardEpisode
}

function highPassValue(state) {
  return validIndex(state.highPassFrequencies, state.highPassFrequencyIndex)
    ? state.highPassFrequencies[state.highPassFrequencyIndex].value : null
}

function inputValue(state, field) {
  const arrays = {
    amplifierIndex: [amplifierOptions, 'model'], speakerIndex: [speakerOptions, 'model'],
    countIndex: [state.counts], wiringIndex: [state.wirings, 'value'],
    modeIndex: [state.modes, 'value'], sensitivityIndex: [state.sensitivities, 'value'],
  }
  if (field === 'highPassFrequencyIndex') return highPassValue(state)
  const [items, key] = arrays[field]
  const index = state[field]
  if (!validIndex(items, index)) return undefined
  return key ? items[index][key] : items[index]
}

function groupFor(field) {
  if (field === 'amplifierIndex' || field === 'speakerIndex') return 'device'
  if (field === 'countIndex' || field === 'wiringIndex' || field === 'modeIndex') return 'load'
  return 'settings'
}

function restoreDraft(saved, state) {
  const has = (key) => Object.prototype.hasOwnProperty.call(saved, key)
  const modelIndex = (options, key) => has(key) ? optionIndex(options, saved[key], (item) => item.model) : -1
  const valueIndex = (items, key) => has(key) ? optionIndex(items, saved[key], (item) => item.value) : -1
  const amplifierIndex = modelIndex(amplifierOptions, 'amplifierModel')
  const speakerIndex = modelIndex(speakerOptions, 'speakerModel')
  const countIndex = has('count') ? optionIndex(state.counts, saved.count) : -1
  const wiringIndex = countIndex >= 0 && state.counts[countIndex] === 1
    ? -1 : valueIndex(state.wirings, 'wiring')
  const highPassFrequencyIndex = has('highPassFrequency')
    ? optionIndex(state.highPassFrequencies, saved.highPassFrequency, (item) => item.value) : -1
  return {
    amplifierIndex, speakerIndex, countIndex,
    wiringIndex,
    modeIndex: valueIndex(state.modes, 'mode'),
    sensitivityIndex: valueIndex(state.sensitivities, 'sensitivityVoltage'),
    highPassFrequencyIndex,
    selectedAmplifier: amplifierIndex >= 0 ? amplifierOptions[amplifierIndex] : null,
    selectedSpeaker: speakerIndex >= 0 ? speakerOptions[speakerIndex] : null,
  }
}

function calculateReadyState(state) {
  const missing = []
  if (!validIndex(amplifierOptions, state.amplifierIndex)) missing.push(['device', '功放'])
  if (!validIndex(speakerOptions, state.speakerIndex)) missing.push(['device', '音箱'])
  if (!validIndex(state.counts, state.countIndex)) missing.push(['load', '每通道数量'])
  else if (state.counts[state.countIndex] > 1 && !validIndex(state.wirings, state.wiringIndex)) missing.push(['load', '连接方式'])
  if (!validIndex(state.modes, state.modeIndex)) missing.push(['load', '功放模式'])
  if (!validIndex(state.sensitivities, state.sensitivityIndex)) missing.push(['settings', '输入灵敏度'])

  if (missing.length) {
    const labels = GROUPS.map(({ key, label }) => {
      const fields = missing.filter(([group]) => group === key).map(([, name]) => name)
      return fields.length ? `${label}（${fields.join('、')}）` : ''
    }).filter(Boolean)
    return { result: null, calculationState: INPUT_FIELDS.some((field) => inputValue(state, field) != null) ? 'incomplete' : 'empty', missingMessage: labels.length ? `还需选择：${labels.join('；')}` : '' }
  }

  const count = state.counts[state.countIndex]
  const result = calculateLimiter({
    amplifier: amplifierCatalog[state.amplifierIndex],
    speaker: speakerCatalog[state.speakerIndex],
    count,
    wiring: count === 1 ? 'parallel' : state.wirings[state.wiringIndex].value,
    mode: state.modes[state.modeIndex].value,
    sensitivityVoltage: state.sensitivities[state.sensitivityIndex].value,
    highPassFrequency: highPassValue(state),
  })
  return { result, calculationState: result.valid ? 'valid' : 'invalid', missingMessage: '' }
}

function canonicalPreferences(state) {
  const count = state.counts[state.countIndex]
  return {
    amplifierModel: amplifierOptions[state.amplifierIndex].model,
    speakerModel: speakerOptions[state.speakerIndex].model,
    count,
    wiring: count === 1 ? 'parallel' : state.wirings[state.wiringIndex].value,
    mode: state.modes[state.modeIndex].value,
    sensitivityVoltage: state.sensitivities[state.sensitivityIndex].value,
    highPassFrequency: highPassValue(state),
  }
}

function savedDraftPreferences(state) {
  const saved = {}
  if (validIndex(amplifierOptions, state.amplifierIndex)) saved.amplifierModel = amplifierOptions[state.amplifierIndex].model
  if (validIndex(speakerOptions, state.speakerIndex)) saved.speakerModel = speakerOptions[state.speakerIndex].model
  if (validIndex(state.counts, state.countIndex)) saved.count = state.counts[state.countIndex]
  if (validIndex(state.wirings, state.wiringIndex)
    && (!validIndex(state.counts, state.countIndex) || state.counts[state.countIndex] !== 1)) {
    saved.wiring = state.wirings[state.wiringIndex].value
  }
  if (validIndex(state.modes, state.modeIndex)) saved.mode = state.modes[state.modeIndex].value
  if (validIndex(state.sensitivities, state.sensitivityIndex)) saved.sensitivityVoltage = state.sensitivities[state.sensitivityIndex].value
  if (validIndex(state.highPassFrequencies, state.highPassFrequencyIndex)) saved.highPassFrequency = highPassValue(state)
  return saved
}

function resultView(state) {
  const calculated = calculateReadyState(state)
  const result = calculated.result
  const valid = Boolean(result && result.valid)
  const fields = {
    result,
    calculationState: calculated.calculationState,
    missingMessage: calculated.missingMessage,
    hasValidResult: valid,
    currentFavorite: valid ? state.currentFavorite : false,
    thresholdText: valid ? String(result.thresholdDbfs) : '—',
    impedanceText: valid ? `${result.loadImpedance} Ω` : '— Ω',
    powerText: valid ? `${result.totalRatedPower} W` : '— W',
    voltageText: valid ? `${result.targetOutputVoltage} V` : '— V',
    dbuText: valid ? `${result.limiterInputDbu} dBu` : '— dBu',
    attackText: valid && result.timingReady ? `${result.attackTimeMs} ms` : '— ms',
    releaseText: valid && result.timingReady ? `${result.releaseTimeMs} ms` : '— ms',
    timingReady: valid && result.timingReady,
    highPassText: highPassValue(state) == null ? '未选择' : `${highPassValue(state)} Hz`,
    outputStatus: valid ? '计算完成' : calculated.calculationState === 'invalid'
      ? result.warning : calculated.calculationState === 'empty' ? '等待输入' : '参数不完整',
    outputHint: valid ? '' : calculated.calculationState === 'invalid'
      ? '请按计算结果提示检查当前配置。' : calculated.missingMessage,
    canReset: INPUT_FIELDS.some((field) => inputValue(state, field) != null),
  }
  return fields
}

function groupsWithReminders(reminderGroups = []) {
  return GROUPS.map((item) => ({ ...item, reminded: reminderGroups.includes(item.key) }))
}

function formatSavedAt(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function sameMetadata(left, name, note) {
  return Boolean(left && left.name === name && (left.note || '') === note)
}

Page({
  data: {
    selectedAmplifier: null, selectedSpeaker: null,
    counts: [1, 2, 3, 4],
    wirings: [{ value: 'parallel', label: '并联' }, { value: 'series', label: '串联' }],
    modes: [{ value: 'stereo', label: '立体声/单通道' }, { value: 'bridge', label: '桥接' }],
    sensitivities: [{ value: 1, label: '1 V（2.2 dBu）' }, { value: 2, label: '2 V（8.2 dBu）' }],
    highPassFrequencies: [
      { value: null, label: '未选择' }, { value: 10, label: '10 Hz' }, { value: 20, label: '20 Hz' },
      { value: 25, label: '25 Hz' }, { value: 31, label: '31 Hz' }, { value: 40, label: '40 Hz' },
      { value: 50, label: '50 Hz' }, { value: 63, label: '63 Hz' }, { value: 80, label: '80 Hz' },
      { value: 100, label: '100 Hz' }, { value: 125, label: '125 Hz' }, { value: 160, label: '160 Hz' },
      { value: 200, label: '200 Hz' }, { value: 250, label: '250 Hz' }, { value: 315, label: '315 Hz' },
      { value: 400, label: '400 Hz' }, { value: 500, label: '500 Hz' }, { value: 630, label: '630 Hz' },
      { value: 800, label: '800 Hz' }, { value: 1000, label: '1 kHz' }, { value: 1250, label: '1.25 kHz' },
      { value: 1600, label: '1.6 kHz' }, { value: 2000, label: '2 kHz' }, { value: 2500, label: '2 kHz 以上' },
    ],
    amplifierIndex: -1, speakerIndex: -1, countIndex: -1, wiringIndex: -1,
    modeIndex: -1, sensitivityIndex: -1, highPassFrequencyIndex: -1,
    amplifierKeyword: '', speakerKeyword: '', amplifierCategoryIndex: 0, speakerCategoryIndex: 0,
    selectorVisible: false, selectorType: '', selectorTitle: '', selectorKeyword: '',
    selectorCategoryIndex: 0, selectorCategories: [], selectorItems: [], selectorTotalCount: 0,
    activeGroup: 'device', groupTabs: groupsWithReminders(),
    reminderActive: false, reminderGroups: [], reminderSeconds: 0, reminderText: '',
    calculationState: 'empty', missingMessage: '', outputStatus: '等待输入', outputHint: '',
    thresholdText: '—', impedanceText: '— Ω', powerText: '— W', voltageText: '— V', dbuText: '— dBu',
    attackText: '— ms', releaseText: '— ms', highPassText: '未选择', timingReady: false,
    result: null, hasValidResult: false, canReset: false, currentFavorite: false,
    pageContainerSupported: false,
    detailsVisible: false, detailsTitle: '', detailsText: '',
    shareSheetVisible: false,
    projectSheetVisible: false, projectStep: 'select', projectLoadState: 'idle', projectError: '',
    projectSearch: '', projectItems: [], projectTargetId: '', projectTargetName: '',
    newProjectName: '', projectConfigName: '', projectConfigNote: '',
    projectNameError: '', projectNoteError: '', projectSaveError: '',
    projectKeyboardEpisode: 0,
    projectKeyboardActive: false, projectKeyboardVisibleHeight: 0,
    projectKeyboardLift: 0, projectKeyboardPanelStyle: '',
    savedProjectName: '', savedConfigName: '', savedAtText: '',
    ...createResultReportData(),
  },

  onLoad(options = {}) {
    attachResultEditor(this, 'limiter', options)
    const finishInitialization = startMeasurement('限幅器/初始化总耗时')
    this._pageVisible = false
    this._isUnloaded = false
    this._sessionPhase = 'composing'
    this._initialHpfPending = false
    this._inputRevision = 0
    this._reminderEpoch = 0
    this._reminderTimer = null
    this._reminderRemainingMs = 0
    this._pickerOverlayOpen = false
    this._projectRequestId = 0
    this._projectSavePending = false
    this._favoritePending = false
    this._projectNameTouched = false
    this._projectNoteTouched = false
    this._projectPrefillKey = ''
    this._projectSnapshot = null
    this._projectSnapshotForSave = null
    this._projectKeyboardBaselineHeight = 0
    this._projectKeyboardCurrentWindowHeight = 0
    this._projectKeyboardHeight = 0
    this._projectKeyboardFocusId = ''
    this._projectKeyboardFocusStartedAt = 0
    this._projectKeyboardBlurredField = ''
    this._projectKeyboardBlurredAt = 0
    this._projectKeyboardBlurredSession = 0
    this._projectKeyboardSession = 0
    this._projectKeyboardEpisode = 0
    this._projectKeyboardBaselineFrozen = false
    this._reportCacheCheckRevision = 0
    this._lastProjectTarget = null
    this._pageContainerEpoch = 0
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    let pageContainerSupported = false
    try { pageContainerSupported = typeof wx.canIUse === 'function' && wx.canIUse('page-container') } catch (error) {}
    const draft = restoreDraft(readPreferences(PREFERENCE_KEY), this.data)
    const state = { ...this.data, ...draft }
    const finishCore = startMeasurement('限幅器/核心计算', { source: 'onLoad' })
    const view = resultView(state)
    finishCore({ valid: view.hasValidResult })
    if (view.hasValidResult) {
      this._sessionPhase = 'active'
      this._initialHpfPending = highPassValue(state) == null
    }
    const finishView = startMeasurement('限幅器/setData视图更新', { source: 'onLoad' })
    this.setData({ pageContainerSupported, ...draft, ...view }, () => {
      if (this._isUnloaded) return
      finishView()
      captureEditorBaseline(this)
      if (this._pageVisible && view.hasValidResult) syncPageFavorite(this)
      finishInitialization({ valid: view.hasValidResult })
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
    if (this.data.projectSheetVisible) this.resetProjectKeyboardState({ captureBaseline: true })
    if (this.data.hasValidResult) syncPageFavorite(this)
    this.resumeReminderClock()
  },

  onHide() {
    this._pageVisible = false
    this.resetProjectKeyboardState({ hideKeyboard: true })
    this.pauseReminderClock()
    this.cancelPendingImageWork()
  },

  onResize(event) {
    if (this._isUnloaded || !this._pageVisible || !this.data.projectSheetVisible || this._pageContainerLeave) return
    const height = getLimiterWindowHeight(event)
    if (!height) return
    this._projectKeyboardCurrentWindowHeight = height
    if (this._projectKeyboardHeight || this._projectKeyboardFocusId) {
      this._projectKeyboardBaselineFrozen = true
    } else if (!this._projectKeyboardBaselineFrozen
      || height >= (this._projectKeyboardBaselineHeight || 0) - 1) {
      this._projectKeyboardBaselineHeight = height
      this._projectKeyboardBaselineFrozen = false
    }
    this.setData(projectKeyboardLayout(this))
  },

  onUnload() {
    this._isUnloaded = true
    this._pageVisible = false
    this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
    this.pauseReminderClock()
    this._reminderEpoch += 1
    this._reportCacheCheckRevision = 0
    this.resultReportRevision = (this.resultReportRevision || 0) + 1
    this.resultReportPendingSignature = ''
    if (this.data.isGeneratingResultReport && typeof wx.hideLoading === 'function') wx.hideLoading()
    this._projectRequestId += 1
    this._projectSavePending = false
    this._pageContainerEpoch += 1
    this._activePageContainerOverlay = null
    this._pageContainerLeave = null
    printPerformanceSummary('限幅器/')
    finalizeResultEditor(this)
  },

  openPageContainerOverlay(name) {
    const epoch = (this._pageContainerEpoch || 0) + 1
    this._pageContainerEpoch = epoch
    this._activePageContainerOverlay = { name, epoch }
  },

  isPageActionOccluded({ allowPicker = false } = {}) {
    return this._isUnloaded || !this.data || this._resetModalPending
      || (!allowPicker && this._pickerOverlayOpen)
      || this._activePageContainerOverlay || this._pageContainerLeave
      || this.data.selectorVisible || this.data.detailsVisible
      || this.data.shareSheetVisible || this.data.projectSheetVisible
  },

  isShareSheetActionAvailable() {
    return this._pageVisible && !this._isUnloaded && this.data.shareSheetVisible
      && this._activePageContainerOverlay?.name === 'share'
      && !this._pageContainerLeave && !this._resetModalPending && !this._pickerOverlayOpen
      && !this.data.selectorVisible && !this.data.detailsVisible && !this.data.projectSheetVisible
  },

  cancelPendingImageWork() {
    const pending = this.data.isGeneratingResultReport || this._reportCacheCheckRevision
    this._reportCacheCheckRevision = 0
    if (!pending) return
    cancelResultReportGeneration(this)
    this.resultReportSignature = ''
    this.setData({ resultReportImagePath: '', resultReportPreviewVisible: false })
  },

  cancelOverlayRequests() {
    this._projectRequestId += 1
    this._projectSavePending = false
    this._projectSnapshotForSave = null
    this.cancelPendingImageWork()
  },

  preparePageContainerLeave() {
    const active = this._activePageContainerOverlay
    if (!active) return false
    if (this._pageContainerLeave) return this._pageContainerLeave.epoch === active.epoch
    const supported = this.data.pageContainerSupported
    this._pageContainerLeave = { ...active, fallback: !supported }
    this.pauseReminderClock()
    if (supported) this.cancelOverlayRequests()
    return true
  },

  finishFallbackPageContainerLeave(epoch) {
    const leaving = this._pageContainerLeave
    if (this._isUnloaded || !leaving?.fallback || leaving.epoch !== epoch || this._pageContainerEpoch !== epoch) return
    if (this._activePageContainerOverlay?.epoch === epoch
      && !this.data.selectorVisible && !this.data.detailsVisible
      && !this.data.shareSheetVisible && !this.data.projectSheetVisible) {
      this._activePageContainerOverlay = null
    }
    this._pageContainerLeave = null
    this.resumeReminderClock()
  },

  closePageContainerOverlay(name, changes) {
    if (this._isUnloaded || !this.data) return
    const supported = this.data.pageContainerSupported
    const active = this._activePageContainerOverlay
    const leaveStarted = active?.name === name && this.preparePageContainerLeave()
    const fallbackEpoch = !supported && leaveStarted ? active.epoch : null
    if (name === 'project') {
      this._projectRequestId += 1
      this._projectSavePending = false
      this._projectSnapshotForSave = null
    }
    this.setData(changes, () => {
      if (!supported && fallbackEpoch != null) this.finishFallbackPageContainerLeave(fallbackEpoch)
      else if (!supported) this.resumeReminderClock()
    })
  },

  onPageContainerBeforeLeave() {
    this.preparePageContainerLeave()
  },

  onPageContainerAfterLeave() {
    if (this._isUnloaded) return
    const leaving = this._pageContainerLeave
    if (!leaving) return
    const active = this._activePageContainerOverlay
    if (active?.epoch === leaving.epoch && this._pageContainerEpoch === leaving.epoch) {
      const field = {
        selector: 'selectorVisible', details: 'detailsVisible',
        share: 'shareSheetVisible', project: 'projectSheetVisible',
      }[leaving.name]
      const changes = field && this.data[field] !== false ? { [field]: false } : {}
      if (leaving.name === 'selector' && (this.data.selectorItems.length || this.data.selectorTotalCount)) {
        Object.assign(changes, { selectorItems: [], selectorTotalCount: 0 })
      }
      if (Object.keys(changes).length) {
        this.setData(changes, () => {
          if (this._isUnloaded) return
          if (this._pageContainerEpoch === leaving.epoch
            && this._activePageContainerOverlay?.epoch === leaving.epoch
            && !this.data.selectorVisible && !this.data.detailsVisible
            && !this.data.shareSheetVisible && !this.data.projectSheetVisible) {
            this._activePageContainerOverlay = null
          }
          if (this._pageContainerLeave?.epoch === leaving.epoch) this._pageContainerLeave = null
          this.resumeReminderClock()
        })
        return
      }
      if (!this.data.selectorVisible && !this.data.detailsVisible
        && !this.data.shareSheetVisible && !this.data.projectSheetVisible) {
        this._activePageContainerOverlay = null
      }
    } else if (!this.data.selectorVisible && !this.data.detailsVisible
      && !this.data.shareSheetVisible && !this.data.projectSheetVisible) {
      if (this._activePageContainerOverlay?.epoch === leaving.epoch) this._activePageContainerOverlay = null
    }
    if (this._pageContainerLeave?.epoch === leaving.epoch) this._pageContainerLeave = null
    this.resumeReminderClock()
  },

  onPageContainerClickOverlay() {
    const name = this._activePageContainerOverlay?.name
    const close = {
      selector: this.closeEquipmentSelector, details: this.closeDetails,
      share: this.closeSharePreview, project: this.closeProjectSheet,
    }[name]
    if (close) close.call(this)
  },

  onGroupTap(event) {
    if (this.isPageActionOccluded()) return
    const group = event.currentTarget.dataset.group
    if (GROUPS.some((item) => item.key === group) && group !== this.data.activeGroup) {
      vibrate('light')
      this.setData({ activeGroup: group })
    }
  },

  onPickerChange(event) {
    if (this.isPageActionOccluded({ allowPicker: true }) || !this._pickerOverlayOpen) return this.cancelPicker()
    const field = event.currentTarget.dataset.field
    const value = eventIndex(event.detail.value)
    if (!INPUT_FIELDS.includes(field) || value == null) return this.cancelPicker()
    const list = field === 'amplifierIndex' ? amplifierOptions
      : field === 'speakerIndex' ? speakerOptions : this.data[{
        countIndex: 'counts', wiringIndex: 'wirings', modeIndex: 'modes',
        sensitivityIndex: 'sensitivities', highPassFrequencyIndex: 'highPassFrequencies',
      }[field]]
    if (!Array.isArray(list) || value >= list.length) return this.cancelPicker()
    this.commitInput({ [field]: value })
  },

  onCountStep(event) {
    if (this.isPageActionOccluded()) return
    const rawStep = event.currentTarget.dataset.step
    const step = rawStep === 1 || rawStep === '1' ? 1 : rawStep === -1 || rawStep === '-1' ? -1 : 0
    if (!step) return
    const current = validIndex(this.data.counts, this.data.countIndex) ? this.data.countIndex : -1
    const next = current + step
    if (next < 0 || next >= this.data.counts.length) return
    this.commitInput({ countIndex: next })
  },

  onChoiceTap(event) {
    if (this.isPageActionOccluded()) return
    const { field } = event.currentTarget.dataset
    const index = eventIndex(event.currentTarget.dataset.index)
    const items = field === 'modeIndex' ? this.data.modes
      : field === 'sensitivityIndex' ? this.data.sensitivities : null
    if (!items || index == null || !validIndex(items, index) || this.data[field] === index) return
    this.commitInput({ [field]: index })
  },

  pauseReminderForPicker() {
    if (this.isPageActionOccluded({ allowPicker: true }) || this._pickerOverlayOpen) return
    vibrate('light')
    this._pickerOverlayOpen = true
    this.pauseReminderClock()
  },

  cancelPicker() {
    this._pickerOverlayOpen = false
    this.resumeReminderClock()
  },

  commitInput(changes) {
    const next = { ...this.data, ...changes }
    if (Number.isInteger(changes.amplifierIndex)) next.selectedAmplifier = amplifierOptions[changes.amplifierIndex] || null
    if (Number.isInteger(changes.speakerIndex)) next.selectedSpeaker = speakerOptions[changes.speakerIndex] || null
    const changed = INPUT_FIELDS.filter((field) => inputValue(this.data, field) !== inputValue(next, field))
    const selection = {}
    if (Number.isInteger(changes.amplifierIndex)) selection.selectedAmplifier = next.selectedAmplifier
    if (Number.isInteger(changes.speakerIndex)) selection.selectedSpeaker = next.selectedSpeaker
    const closeSelector = this.data.selectorVisible ? { selectorVisible: false, selectorItems: [], selectorTotalCount: 0 } : {}
    const closeProject = this.data.projectSheetVisible && changed.length
      ? { projectSheetVisible: false, projectSaveError: '输入已变化，请重新打开项目保存。' }
      : {}
    const closingName = Object.keys(closeSelector).length ? 'selector'
      : Object.keys(closeProject).length ? 'project' : ''
    const active = this._activePageContainerOverlay
    const closingOverlay = closingName && active?.name === closingName && this.preparePageContainerLeave()
    const fallbackClosingEpoch = closingOverlay && !this.data.pageContainerSupported
      ? this._pageContainerLeave?.epoch : null
    this._selectorMatches = []
    if (Object.keys(closeProject).length) this.resetProjectKeyboardState({ hideKeyboard: true })
    if (!changed.length) {
      const resumePicker = this._pickerOverlayOpen
      this._pickerOverlayOpen = false
      if (Object.keys(closeSelector).length || Object.keys(closeProject).length) {
        this.setData({ ...closeSelector, ...closeProject }, () => {
          if (fallbackClosingEpoch != null) this.finishFallbackPageContainerLeave(fallbackClosingEpoch)
          else this.resumeReminderClock()
        })
      } else if (resumePicker) {
        this.resumeReminderClock()
      }
      return this.data.result
    }
    const resumePicker = this._pickerOverlayOpen
    this._pickerOverlayOpen = false
    if (this.data.projectSheetVisible) {
      this._projectSnapshotForSave = null
      this._projectRequestId += 1
      this._projectSavePending = false
    }
    vibrate('light')
    this._inputRevision += 1
    this._projectRequestId += 1
    this._projectSavePending = false
    const finishUpdate = startMeasurement('限幅器/计算到结果更新', { fields: changed.length })
    const finishCore = startMeasurement('限幅器/核心计算', { source: 'interaction' })
    const view = resultView(next)
    finishCore({ valid: view.hasValidResult, state: view.calculationState })
    const report = resetStaleResultReport(this, view.hasValidResult ? this.getRecordPayload(next, view.result) : null)
    const finishView = startMeasurement('限幅器/setData视图更新', { source: 'interaction' })
    this.setData({ ...changes, ...selection, ...closeSelector, ...closeProject, ...view, ...report }, () => {
      if (this._isUnloaded) return
      finishView()
      const write = writePreferencesDetailed(PREFERENCE_KEY, savedDraftPreferences(next))
      if (!write.ok) wx.showToast({ title: '当前输入已更新，但本地草稿保存失败', icon: 'none' })
      if (this._pageVisible && view.hasValidResult) syncPageFavorite(this)
      if (this._sessionPhase === 'composing' && view.hasValidResult) {
        this._sessionPhase = 'active'
        this._initialHpfPending = highPassValue(next) == null
      } else if (this._sessionPhase === 'active') {
        const onlyInitialHpf = changed.length === 1 && changed[0] === 'highPassFrequencyIndex' && this._initialHpfPending
        if (changed.includes('highPassFrequencyIndex') && this._initialHpfPending && highPassValue(next) != null) {
          this._initialHpfPending = false
        }
        if (!onlyInitialHpf) this.startReminder(groupFor(changed[0]))
      }
      if (fallbackClosingEpoch != null) this.finishFallbackPageContainerLeave(fallbackClosingEpoch)
      else if (resumePicker || this.canRunReminderClock()) this.resumeReminderClock()
      finishUpdate({ valid: view.hasValidResult, persisted: write.ok })
    })
    return view.result
  },

  openEquipmentSelector(event) {
    if (this.isPageActionOccluded()) return
    vibrate('light')
    const type = event.currentTarget.dataset.type
    const isAmplifier = type === 'amplifier'
    const keyword = isAmplifier ? this.data.amplifierKeyword : this.data.speakerKeyword
    const categoryIndex = isAmplifier ? this.data.amplifierCategoryIndex : this.data.speakerCategoryIndex
    const categories = isAmplifier ? amplifierCategories : speakerCategories
    const items = isAmplifier ? amplifierOptions : speakerOptions
    this.openPageContainerOverlay('selector')
    const finishFilter = startMeasurement('限幅器/设备搜索过滤', { source: 'open', type })
    const matches = filterCatalogItems(items, categories, keyword, categoryIndex)
    this._selectorMatches = matches
    finishFilter({ matches: matches.length })
    this.pauseReminderClock()
    const finishView = startMeasurement('限幅器/设备搜索视图更新', { source: 'open', type })
    this.setData({
      selectorVisible: true, selectorType: type,
      selectorTitle: isAmplifier ? '选择功放型号' : '选择音箱型号',
      selectorKeyword: keyword, selectorCategoryIndex: categoryIndex,
      selectorCategories: categories, selectorItems: matches.slice(0, SELECTOR_BATCH_SIZE), selectorTotalCount: matches.length,
    }, () => finishView({ matches: matches.length, rendered: Math.min(matches.length, SELECTOR_BATCH_SIZE) }))
  },

  closeEquipmentSelector() {
    this._selectorMatches = []
    this.closePageContainerOverlay('selector', { selectorVisible: false, selectorItems: [], selectorTotalCount: 0 })
  },

  onSelectorInput(event) {
    if (!this.data.selectorVisible || this._isUnloaded || this._pageContainerLeave) return
    this.refreshSelector(event.detail.value, this.data.selectorCategoryIndex)
  },

  onSelectorCategoryTap(event) {
    if (this._isUnloaded || this._pageContainerLeave) return
    const index = eventIndex(event.currentTarget.dataset.index)
    const categories = this.data.selectorType === 'amplifier' ? amplifierCategories
      : this.data.selectorType === 'speaker' ? speakerCategories : null
    if (!this.data.selectorVisible || !categories || index == null || !validIndex(categories, index)) return
    if (index !== this.data.selectorCategoryIndex) vibrate('light')
    this.refreshSelector(this.data.selectorKeyword, index)
  },

  refreshSelector(keyword, categoryIndex) {
    const isAmplifier = this.data.selectorType === 'amplifier'
    const items = isAmplifier ? amplifierOptions : speakerOptions
    const categories = isAmplifier ? amplifierCategories : speakerCategories
    const finishFilter = startMeasurement('限幅器/设备搜索过滤', { source: 'filter', type: this.data.selectorType })
    const matches = filterCatalogItems(items, categories, keyword, categoryIndex)
    this._selectorMatches = matches
    finishFilter({ matches: matches.length })
    const changes = { selectorKeyword: keyword, selectorCategoryIndex: categoryIndex, selectorItems: matches.slice(0, SELECTOR_BATCH_SIZE), selectorTotalCount: matches.length }
    if (isAmplifier) Object.assign(changes, { amplifierKeyword: keyword, amplifierCategoryIndex: categoryIndex })
    else Object.assign(changes, { speakerKeyword: keyword, speakerCategoryIndex: categoryIndex })
    const finishView = startMeasurement('限幅器/设备搜索视图更新', { source: 'filter', type: this.data.selectorType })
    this.setData(changes, () => finishView({ matches: matches.length, rendered: Math.min(matches.length, SELECTOR_BATCH_SIZE) }))
  },

  appendSelectorItems() {
    if (!this.data.selectorVisible || this._isUnloaded || this._pageContainerLeave) return
    const matches = this._selectorMatches || []
    if (this.data.selectorItems.length >= matches.length) return
    const items = matches.slice(0, this.data.selectorItems.length + SELECTOR_BATCH_SIZE)
    const finishView = startMeasurement('限幅器/设备搜索视图更新', { source: 'append', type: this.data.selectorType })
    this.setData({ selectorItems: items }, () => finishView({ matches: matches.length, rendered: items.length }))
  },

  selectEquipment(event) {
    if (!this.data.selectorVisible || this._isUnloaded || this._pageContainerLeave) return
    const index = eventIndex(event.currentTarget.dataset.index)
    const field = this.data.selectorType === 'amplifier' ? 'amplifierIndex'
      : this.data.selectorType === 'speaker' ? 'speakerIndex' : ''
    const options = field === 'amplifierIndex' ? amplifierOptions
      : field === 'speakerIndex' ? speakerOptions : null
    if (!options || index == null || !validIndex(options, index)
      || !this.data.selectorItems.some((item) => item.index === index)) return
    this.commitInput({ [field]: index })
  },

  openEquipmentDetail(event) {
    if (!this.data.selectorVisible || this._isUnloaded || this._pageContainerLeave) return
    const model = event.currentTarget.dataset.model
    const type = this.data.selectorType === 'amplifier' ? 'amplifier' : 'speaker'
    this.closeEquipmentSelector()
    wx.navigateTo({ url: `/pages/products/detail?type=${type}&model=${encodeURIComponent(model)}` })
  },

  getPreferences(state = this.data) {
    return state.result && state.result.valid ? canonicalPreferences(state) : null
  },

  getEditorPreferences(state = this.data) {
    return savedDraftPreferences(state)
  },

  getRecordLookupPayload() {
    const preferences = this.getPreferences()
    return preferences ? { module: 'limiter', preferences } : null
  },

  getResultText(state = this.data, result = state.result) {
    if (!result || !result.valid) return ''
    const count = state.counts[state.countIndex]
    const lines = [
      '限幅器参数计算', '结果性质：产品参数计算',
      `功放：${state.selectedAmplifier.model}`,
      `音箱：${state.selectedSpeaker.model} × ${count} 只/通道`,
      `连接：${count > 1 ? state.wirings[state.wiringIndex].label : '单只连接'} · ${state.modes[state.modeIndex].label}`,
      `功放输入灵敏度：${state.sensitivities[state.sensitivityIndex].label}`,
      `总负载：${result.loadImpedance} Ω · ${result.totalRatedPower} W`,
      `限幅阈值：${result.thresholdDbfs} dBFS（0 dBFS = +18.4 dBu）`,
    ]
    if (result.timingReady) lines.push(`通道 HPF：${result.highPassFrequency} Hz`, `建立时间 Attack：${result.attackTimeMs} ms`, `释放时间 Release：${result.releaseTimeMs} ms`)
    lines.push(result.statusText, '注：按说明书额定功率作理论计算，现场仍需核对接线、标定和实际电平。')
    return lines.join('\n')
  },

  getRecordPayload(state = this.data, result = state.result) {
    const resultText = this.getResultText(state, result)
    if (!resultText) return null
    const preferences = canonicalPreferences(state)
    return {
      module: 'limiter', title: `${state.selectedAmplifier.model} + ${state.selectedSpeaker.model}`,
      summary: result.timingReady
        ? `阈值 ${result.thresholdDbfs} dBFS · Attack ${result.attackTimeMs} ms · Release ${result.releaseTimeMs} ms`
        : `阈值 ${result.thresholdDbfs} dBFS`,
      preferences, resultText,
    }
  },

  buildResultReportRecord() {
    const record = this.getRecordPayload()
    if (!record) return null
    const state = this.data
    const count = state.counts[state.countIndex]
    const inputs = [
      `功放型号：${state.selectedAmplifier.model}`,
      `音箱型号：${state.selectedSpeaker.model}`,
      `每通道音箱数量：${count}`,
      `连接方式：${count === 1 ? '单只连接' : state.wirings[state.wiringIndex].label}`,
      `功放模式：${state.modes[state.modeIndex].label}`,
      `功放输入灵敏度：${state.sensitivities[state.sensitivityIndex].label}`,
      `通道 HPF：${highPassValue(state) == null ? '未选择' : `${highPassValue(state)} Hz`}`,
    ]
    if (state.reminderActive) inputs.push('提醒：部分参数仍沿用原值，请结合现场核对。')
    return { ...record, resultText: `${record.resultText}\n${inputs.join('\n')}` }
  },

  ...resultReportMethods,

  previewResultReportImage() {
    if (!this.isShareSheetActionAvailable()) return
    return resultReportMethods.previewResultReportImage.call(this)
  },

  saveResultReportImage() {
    if (!this.isShareSheetActionAvailable()) return
    return resultReportMethods.saveResultReportImage.call(this)
  },

  generateResultReportImage() {
    if (!this.isShareSheetActionAvailable() || this.data.isGeneratingResultReport) return
    const record = this.buildResultReportRecord()
    const payload = buildResultReportPayload(record)
    if (!payload) return wx.showToast({ title: '暂无可生成的计算结果', icon: 'none' })
    const signature = this.getResultReportSignature(record)
    const path = this.data.resultReportImagePath
    const generate = () => {
      if (typeof wx.createCanvasContext !== 'function' || typeof wx.canvasToTempFilePath !== 'function') {
        return wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
      }
      let height
      try {
        const measureContext = wx.createCanvasContext(REPORT_CANVAS_ID, this)
        height = calculateResultReportHeight(payload, measureContext)
      } catch (error) {
        return wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
      }
      const revision = (this.resultReportRevision || 0) + 1
      this.resultReportRevision = revision
      this._reportCacheCheckRevision = 0
      this.resultReportPendingSignature = signature
      this.setData({
        resultReportCanvasHeight: height, resultReportImagePath: '',
        isGeneratingResultReport: true, resultReportPreviewVisible: false,
      }, () => {
        const current = () => this.isShareSheetActionAvailable()
          && this.resultReportRevision === revision && this.resultReportPendingSignature === signature
          && this.getResultReportSignature() === signature
        if (!current()) return
        const finish = (changes = {}) => {
          if (!current()) return
          this.resultReportPendingSignature = ''
          this.setData({ isGeneratingResultReport: false, ...changes })
        }
        try {
          drawAndExportReport(this, {
            canvasId: REPORT_CANVAS_ID, isCurrent: current, width: REPORT_WIDTH, height,
            draw: (context) => {
              const endDrawing = startMeasurement('限幅器/结果图绘制')
              drawResultReport(context, payload, height)
              endDrawing({ height })
            },
            getExportOptions: () => getExportDimensions(height),
            startExportMeasurement: (dimensions) => startMeasurement('限幅器/结果图导出', dimensions),
            onSuccess: (imagePath) => {
              this.resultReportSignature = signature
              finish({ resultReportImagePath: imagePath, resultReportPreviewVisible: true })
            },
            onFailure: () => {
              finish()
              wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
            },
          })
        } catch (error) {
          finish()
          wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
        }
      })
    }
    if (!path || this.resultReportSignature !== signature) return generate()

    const revision = (this.resultReportRevision || 0) + 1
    this.resultReportRevision = revision
    this._reportCacheCheckRevision = revision
    this.setData({ isGeneratingResultReport: true, resultReportPreviewVisible: false }, () => {
      const current = () => this.isShareSheetActionAvailable() && this._reportCacheCheckRevision === revision
        && this.resultReportRevision === revision && this.getResultReportSignature() === signature
      const showCached = () => {
        if (!current()) return
        this._reportCacheCheckRevision = 0
        this.resultReportPendingSignature = ''
        this.setData({ isGeneratingResultReport: false, resultReportPreviewVisible: true })
      }
      const regenerate = () => {
        if (!current()) return
        this._reportCacheCheckRevision = 0
        this.resultReportSignature = ''
        this.setData({ isGeneratingResultReport: false, resultReportImagePath: '', resultReportPreviewVisible: false }, () => {
          if (this.isShareSheetActionAvailable()) this.generateResultReportImage()
        })
      }
      try {
        const fileSystem = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
        if (!fileSystem || typeof fileSystem.access !== 'function') return regenerate()
        fileSystem.access({ path, success: showCached, fail: regenerate })
      } catch (error) { regenerate() }
    })
  },

  shareResultReportImage() {
    if (!this.isShareSheetActionAvailable()) return false
    const path = this.data.resultReportImagePath
    if (!path) return false
    if (typeof wx.showShareImageMenu !== 'function') {
      return resultReportMethods.shareResultReportImage.call(this)
    }
    vibrate('medium')
    wx.showShareImageMenu({
      path,
      needShowEntrance: false,
      fail: ({ errMsg = '' } = {}) => {
        if (!/cancel/i.test(errMsg)) wx.showToast({ title: '转发未完成，请重试', icon: 'none' })
      },
    })
    return true
  },

  openCalculationDetails(event) {
    if (this.isPageActionOccluded()) return
    const type = event.currentTarget.dataset.type
    this.openPageContainerOverlay('details')
    this.pauseReminderClock()
    this.setData({
      detailsVisible: true,
      detailsTitle: type === 'limits' ? '使用限制与注意事项' : '计算依据与说明',
      detailsText: type === 'limits'
        ? '结果依据设备说明书中的额定参数计算，不替代现场测量或设备保护设置。请核实实际接线、功放工作模式、输入灵敏度和 DSP 标定。'
        : '页面根据功放与音箱额定参数计算负载、目标输出和限幅阈值。HPF 只用于 Attack 与 Release 推荐；未选择 HPF 时阈值仍可显示，保护时间保持空值。',
    })
  },

  closeDetails() {
    this.closePageContainerOverlay('details', { detailsVisible: false })
  },

  openSharePreview() {
    if (this.isPageActionOccluded() || !this.data.hasValidResult) return
    vibrate('light')
    this.openPageContainerOverlay('share')
    this.pauseReminderClock()
    this.setData({ shareSheetVisible: true }, () => {
      if (!this._isUnloaded) this.generateResultReportImage()
    })
  },

  closeSharePreview() {
    if (this._isUnloaded) return
    this.preparePageContainerLeave()
    this._reportCacheCheckRevision = 0
    if (this.data.isGeneratingResultReport) {
      cancelResultReportGeneration(this)
      this.resultReportSignature = ''
      this.setData({ resultReportImagePath: '', resultReportPreviewVisible: false })
    }
    this.closePageContainerOverlay('share', { shareSheetVisible: false })
  },

  retryResultReport() {
    if (this.isShareSheetActionAvailable() && !this.data.isGeneratingResultReport) this.generateResultReportImage()
  },

  toggleCurrentFavorite() {
    if (this.isPageActionOccluded() || !this.data.hasValidResult || this._favoritePending) return
    this._favoritePending = true
    try { togglePageFavorite(this) } finally { this._favoritePending = false }
  },

  resetProjectKeyboardState({ captureBaseline = false, hideKeyboard = false, updateView = true } = {}) {
    const hadProjectFocus = Boolean(this._projectKeyboardFocusId || this._projectKeyboardHeight)
    this._projectKeyboardSession = (this._projectKeyboardSession || 0) + 1
    this._projectKeyboardEpisode = (this._projectKeyboardEpisode || 0) + 1
    this._projectKeyboardFocusId = ''
    this._projectKeyboardFocusStartedAt = 0
    this._projectKeyboardBlurredField = ''
    this._projectKeyboardBlurredAt = 0
    this._projectKeyboardBlurredSession = 0
    this._projectKeyboardHeight = 0
    const currentHeight = getLimiterWindowHeight()
    if (currentHeight) this._projectKeyboardCurrentWindowHeight = currentHeight
    if (captureBaseline || !this._projectKeyboardBaselineHeight) {
      this._projectKeyboardBaselineHeight = this._projectKeyboardCurrentWindowHeight || currentHeight
      this._projectKeyboardBaselineFrozen = false
    } else if (hadProjectFocus) {
      this._projectKeyboardBaselineFrozen = currentHeight
        < this._projectKeyboardBaselineHeight - 1
    }
    if (hideKeyboard && hadProjectFocus && typeof wx !== 'undefined'
      && typeof wx.hideKeyboard === 'function') {
      try { wx.hideKeyboard({}) } catch (error) {}
    }
    const changes = {
      ...projectKeyboardLayout(this),
      projectKeyboardEpisode: this._projectKeyboardEpisode,
    }
    if (updateView && !this._isUnloaded && this.data) this.setData(changes)
    return changes
  },

  onProjectInputFocus(event) {
    if (this._isUnloaded || !this._pageVisible || this._pageContainerLeave || !this.data.projectSheetVisible) return
    if (!isCurrentProjectKeyboardEvent(this, event)) return
    const field = projectKeyboardEventField(event)
    if (!PROJECT_KEYBOARD_FIELDS.has(field) || !isProjectKeyboardFieldForStep(this.data.projectStep, field)) return
    const timestamp = projectKeyboardEventTime(event)
    this._projectKeyboardSession = (this._projectKeyboardSession || 0) + 1
    this._projectKeyboardFocusId = field
    this._projectKeyboardFocusStartedAt = timestamp
    this._projectKeyboardBlurredField = ''
    this._projectKeyboardBlurredAt = 0
    this._projectKeyboardBlurredSession = 0
    this._projectKeyboardBaselineFrozen = true
    const reportedHeight = Number(event && event.detail && event.detail.height)
    if (Number.isFinite(reportedHeight) && reportedHeight > 0) {
      this._projectKeyboardHeight = reportedHeight
    }
    this._projectKeyboardCurrentWindowHeight = getLimiterWindowHeight()
      || this._projectKeyboardCurrentWindowHeight
    if (!this._projectKeyboardBaselineHeight) {
      this._projectKeyboardBaselineHeight = this._projectKeyboardCurrentWindowHeight
    }
    this.setData(projectKeyboardLayout(this))
  },

  onProjectInputBlur(event) {
    if (this._isUnloaded || !this._pageVisible || this._pageContainerLeave) return
    if (!isCurrentProjectKeyboardEvent(this, event)) return
    const field = projectKeyboardEventField(event)
    const timestamp = projectKeyboardEventTime(event)
    if (!field || field !== this._projectKeyboardFocusId
      || !isProjectKeyboardFieldForStep(this.data.projectStep, field)) return
    if (timestamp && this._projectKeyboardFocusStartedAt
      && timestamp < this._projectKeyboardFocusStartedAt) return
    this._projectKeyboardBlurredField = field
    this._projectKeyboardBlurredAt = timestamp
    this._projectKeyboardBlurredSession = this._projectKeyboardSession
  },

  onProjectKeyboardHeightChange(event) {
    if (this._isUnloaded || !this._pageVisible || this._pageContainerLeave || !this.data.projectSheetVisible) return
    if (!isCurrentProjectKeyboardEvent(this, event)) return
    const field = projectKeyboardEventField(event)
    const timestamp = projectKeyboardEventTime(event)
    const keyboardHeight = Number(event && event.detail && event.detail.height)
    if (!PROJECT_KEYBOARD_FIELDS.has(field)
      || !isProjectKeyboardFieldForStep(this.data.projectStep, field)
      || !Number.isFinite(keyboardHeight)) return
    const isFocusedField = field === this._projectKeyboardFocusId
    const isCurrentBlur = field === this._projectKeyboardBlurredField
      && this._projectKeyboardBlurredSession === this._projectKeyboardSession
    if (!isFocusedField && !isCurrentBlur) return
    if (timestamp && this._projectKeyboardFocusStartedAt
      && timestamp < this._projectKeyboardFocusStartedAt) return
    if (isCurrentBlur && timestamp && this._projectKeyboardBlurredAt
      && timestamp < this._projectKeyboardBlurredAt) return
    this._projectKeyboardHeight = Math.max(0, keyboardHeight)
    this._projectKeyboardCurrentWindowHeight = getLimiterWindowHeight()
      || this._projectKeyboardCurrentWindowHeight
    if (this._projectKeyboardHeight > 0) this._projectKeyboardBaselineFrozen = true
    if (!this._projectKeyboardBaselineHeight) {
      this._projectKeyboardBaselineHeight = this._projectKeyboardCurrentWindowHeight
    }
    if (this._projectKeyboardHeight === 0) {
      this._projectKeyboardSession += 1
      this._projectKeyboardFocusId = ''
      this._projectKeyboardFocusStartedAt = 0
      this._projectKeyboardBlurredField = ''
      this._projectKeyboardBlurredAt = 0
      this._projectKeyboardBlurredSession = 0
      if (this._projectKeyboardCurrentWindowHeight
        >= this._projectKeyboardBaselineHeight - 1) {
        this._projectKeyboardBaselineHeight = this._projectKeyboardCurrentWindowHeight
        this._projectKeyboardBaselineFrozen = false
      } else {
        this._projectKeyboardBaselineFrozen = true
      }
    }
    this.setData(projectKeyboardLayout(this))
  },

  openProjectSheet() {
    if (this.isPageActionOccluded() || !this.data.hasValidResult || this._projectSavePending) return
    this._projectNameTouched = false
    this._projectNoteTouched = false
    this._projectPrefillKey = ''
    this._createdProjectThisFlow = false
    const record = this.getRecordPayload()
    if (!record) return
    vibrate('light')
    this.openPageContainerOverlay('project')
    const payload = JSON.parse(JSON.stringify(record))
    const projectPreview = {
      amplifierModel: this.data.selectedAmplifier.model,
      speakerModel: this.data.selectedSpeaker.model,
      thresholdText: this.data.thresholdText,
      impedanceText: this.data.impedanceText,
      powerText: this.data.powerText,
      highPassText: this.data.highPassText,
      attackText: this.data.attackText,
      releaseText: this.data.releaseText,
    }
    this._projectSnapshotForSave = { payload, signature: JSON.stringify(payload), revision: this._inputRevision, projectPreview }
    const lastTarget = this._lastProjectTarget
    this.pauseReminderClock()
    const projectKeyboard = this.resetProjectKeyboardState({ captureBaseline: true, updateView: false })
    this.setData({
      projectSheetVisible: true, projectStep: 'select', projectLoadState: 'loading', projectError: '',
      projectSearch: '', projectItems: [], projectTargetId: '', projectTargetName: '', projectPreview,
      projectConfigName: `${this.data.selectedAmplifier.model} + ${this.data.selectedSpeaker.model}`,
      projectConfigNote: '', projectNameError: '', projectNoteError: '', projectSaveError: '',
      ...projectKeyboard,
    })
    if (!this.refreshProjects()) return
    if (lastTarget) {
      const current = this._projectSnapshot.projects.find((project) => project.id === lastTarget.id)
      if (current && current.name === lastTarget.name) this.setProjectTarget(current)
      else {
        this._lastProjectTarget = null
        this.setData({ projectSaveError: '上次选择的项目已改名或不存在，请重新选择。' })
      }
    }
  },

  refreshProjects() {
    const snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    this._projectSnapshot = snapshot
    if (!snapshot || snapshot.ok === false) {
      this.setData({ projectLoadState: 'error', projectError: '项目列表读取失败，请重试。', projectItems: [] })
      return false
    }
    this.updateProjectList(snapshot.projects || [])
    this.setData({ projectLoadState: 'ready', projectError: '' })
    return true
  },

  updateProjectList(projects = (this._projectSnapshot && this._projectSnapshot.projects) || []) {
    const keyword = this.data.projectSearch.trim().toLocaleLowerCase()
    this.setData({ projectItems: projects.filter((project) => !keyword || project.name.toLocaleLowerCase().includes(keyword))
      .map(({ id, name }) => ({ id, name })) })
  },

  onProjectSearch(event) {
    this.setData({ projectSearch: event.detail.value }, () => this.updateProjectList())
  },

  chooseProject(event) {
    const id = event.currentTarget.dataset.id
    const project = this._projectSnapshot?.projects?.find((item) => item.id === id)
    if (!project) return
    this.setProjectTarget(project)
  },

  setProjectTarget(project) {
    if (this.data.projectStep !== 'details') this.resetProjectKeyboardState({ hideKeyboard: true })
    const changes = { projectTargetId: project.id, projectTargetName: project.name, projectStep: 'details', projectSaveError: '' }
    const payload = this._projectSnapshotForSave?.payload || this.getRecordPayload()
    const prefillKey = JSON.stringify([project.id, payload && payload.preferences])
    if (this._projectPrefillKey !== prefillKey) {
      this._projectPrefillKey = prefillKey
      if (!this._projectNameTouched) changes.projectConfigName = `${this.data.selectedAmplifier.model} + ${this.data.selectedSpeaker.model}`
      if (!this._projectNoteTouched) changes.projectConfigNote = ''
      const record = getRecordByPayload(payload)
      const canonicalRecord = record ? { ...record, title: payload?.title || '' } : null
      const projected = getProjectRecordView(canonicalRecord, project.id)
      if (projected) {
        if (!this._projectNameTouched) changes.projectConfigName = projected.title || `${this.data.selectedAmplifier.model} + ${this.data.selectedSpeaker.model}`
        if (!this._projectNoteTouched) changes.projectConfigNote = projected.projectNote || ''
      }
    }
    this._lastProjectTarget = project
    this.setData(changes)
  },

  beginNewProject() {
    this.resetProjectKeyboardState({ hideKeyboard: true })
    this.setData({ projectStep: 'create', newProjectName: '', projectNameError: '', projectSaveError: '' })
  },

  onNewProjectNameInput(event) {
    this.setData({ newProjectName: event.detail.value, projectNameError: '' })
  },

  createProjectFromForm() {
    if (this._projectSavePending) return
    const name = this.data.newProjectName.trim()
    if (!name || name.length > 30) {
      this.setData({ projectNameError: !name ? '请输入项目名称。' : '项目名称最多 30 个字符。' })
      return
    }
    const snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    this._projectSnapshot = snapshot
    if (!snapshot || snapshot.ok === false) {
      this.setData({ projectNameError: '读取项目列表失败，请重试后创建。' })
      return
    }
    const duplicate = snapshot.projects.find((project) => project.name === name)
    if (duplicate) return this.setProjectTarget(duplicate)
    const project = createProject(name)
    if (!project) {
      this.setData({ projectNameError: '项目创建失败，请检查本地存储后重试。' })
      return
    }
    this._createdProjectThisFlow = true
    this.refreshProjects()
    this.setProjectTarget(project)
  },

  onProjectConfigNameInput(event) {
    this._projectNameTouched = true
    this.setData({ projectConfigName: event.detail.value, projectNameError: '', projectSaveError: '' })
  },

  onProjectConfigNoteInput(event) {
    this._projectNoteTouched = true
    this.setData({ projectConfigNote: event.detail.value, projectNoteError: '', projectSaveError: '' })
  },

  backToProjectList() {
    if (this.data.projectStep === 'details') {
      this.resetProjectKeyboardState({ hideKeyboard: true })
      this.setData({ projectStep: 'select', projectSearch: '', projectSaveError: '' }, () => this.updateProjectList())
    } else if (this.data.projectStep === 'create') {
      this.resetProjectKeyboardState({ hideKeyboard: true })
      this.setData({ projectStep: 'select', projectNameError: '' })
    }
  },

  saveProjectConfiguration() {
    if (this._projectSavePending || this.data.projectStep !== 'details') return
    const name = this.data.projectConfigName.trim()
    const note = this.data.projectConfigNote.trim()
    if (!name || name.length > 60 || note.length > 200) {
      this.setData({
        projectNameError: !name ? '配置名称不能为空。' : name.length > 60 ? '配置名称最多 60 个字符。' : '',
        projectNoteError: note.length > 200 ? '备注最多 200 个字符。' : '',
      })
      return
    }
    const frozen = this._projectSnapshotForSave
    if (!frozen) return this.setData({ projectSaveError: '当前配置快照已失效，请重新选择项目。' })
    const payload = frozen.payload
    const signature = frozen.signature
    const targetId = this.data.projectTargetId
    const targetName = this.data.projectTargetName
    const targetSnapshot = this._lastProjectTarget && { id: this._lastProjectTarget.id, name: this._lastProjectTarget.name }
    const id = ++this._projectRequestId
    const revision = frozen.revision
    this._projectSavePending = true
    const finish = (error = '') => {
      if (this._isUnloaded || this._projectRequestId !== id) return
      this._projectSavePending = false
      this.setData({ projectSaveError: error })
    }
    const current = () => !this._isUnloaded && this._projectRequestId === id
      && this._inputRevision === revision && this._pageVisible && this.data.projectSheetVisible
      && this.data.projectStep === 'details' && JSON.stringify(this.getRecordPayload()) === signature
      && this._projectSnapshotForSave === frozen && this.data.projectTargetId === targetId
      && this.data.projectTargetName === targetName && targetSnapshot?.id === targetId
      && targetSnapshot?.name === targetName;
    const write = (target) => {
      if (!current()) return finish('页面或配置已变化，请重新选择项目后保存。')
      const saved = addRecordToProject(payload, target.id, { name, note })
      if (!saved) return finish(this._createdProjectThisFlow
        ? '项目已创建，但配置保存失败。可重试，不会重复创建项目。' : '配置保存失败，请检查本地存储后重试。')
      const metadata = saved.projectMetadata?.[target.id]
      if (!metadata) return finish('配置写入状态无法确认，请重新读取项目记录。')
      this._projectSavePending = false
      this._lastProjectTarget = target
      this.resetProjectKeyboardState({ hideKeyboard: true })
      this.setData({
        projectStep: 'success', projectSaveError: '',
        savedProjectName: target.name, savedConfigName: metadata.name,
        savedAtText: formatSavedAt(metadata.savedAt),
      })
      vibrate('medium')
    }
    const verifyAndWrite = (confirmMetadataChange = false) => {
      if (!current()) return finish('页面或配置已变化，请重新选择项目后保存。')
      const snapshot = getWorkspaceSnapshot({ forceRefresh: true })
      if (!snapshot || snapshot.ok === false) return finish('读取项目状态失败，请重试。')
      const target = snapshot.projects.find((project) => project.id === targetId)
      if (!target) return finish('所选项目已不存在，请重新选择。')
      if (target.name !== targetName) return finish('项目名称已变化，请重新选择。')
      const existing = getRecordByPayload(payload)
      const previousView = getProjectRecordView(existing ? { ...existing, title: payload.title } : null, target.id)
      const associated = Boolean(previousView?.projectIds?.includes(target.id))
      const previous = previousView && { name: previousView.title, note: previousView.projectNote }
      if (associated && !sameMetadata(previous, name, note) && !confirmMetadataChange) {
        wx.showModal({
          title: '更新项目配置？',
          content: '相同参数已在此项目中保存。确认后将更新该项目下的配置名称和备注。',
          confirmText: '确认更新', cancelText: '返回修改',
          success: ({ confirm }) => confirm ? verifyAndWrite(true) : finish(),
          fail: () => finish(),
        })
        return
      }
      write(target)
    }
    verifyAndWrite()
  },

  continueAfterProjectSave() {
    this._projectSnapshotForSave = null
    this.resetProjectKeyboardState({ hideKeyboard: true })
    this.closePageContainerOverlay('project', { projectSheetVisible: false })
  },

  closeProjectSheet() {
    if (this._projectSavePending) return
    this.resetProjectKeyboardState({ hideKeyboard: true })
    this.closePageContainerOverlay('project', { projectSheetVisible: false })
  },

  requestReset() {
    if (this.isPageActionOccluded() || !this.data.canReset) return
    vibrate('light')
    this._resetModalPending = true
    this.pauseReminderClock()
    wx.showModal({
      title: '清空本次计算？',
      content: '将清空当前限幅器输入和结果，已保存的收藏与项目记录会保留。',
      confirmText: '清空', cancelText: '取消',
      success: ({ confirm }) => {
        this._resetModalPending = false
        if (this._isUnloaded) return
        if (confirm) this.clearDraft()
        else this.resumeReminderClock()
      },
      fail: () => { this._resetModalPending = false; this.resumeReminderClock() },
    })
  },

  clearDraft() {
    if (this._isUnloaded) return false
    const active = this._activePageContainerOverlay
    const closingOverlay = active && this.preparePageContainerLeave()
    const fallbackClosingEpoch = closingOverlay && !this.data.pageContainerSupported
      ? this._pageContainerLeave?.epoch : null
    this._inputRevision += 1
    this._projectRequestId += 1
    this._projectSavePending = false
    this._favoritePending = false
    this.pauseReminderClock()
    this._reminderEpoch += 1
    this._reminderRemainingMs = 0
    this._sessionPhase = 'composing'
    this._initialHpfPending = false
    this._selectorMatches = []
    this._projectPrefillKey = ''
    cancelResultReportGeneration(this)
    this.resultReportSignature = ''
    const empty = {
      amplifierIndex: -1, speakerIndex: -1, countIndex: -1, wiringIndex: -1,
      modeIndex: -1, sensitivityIndex: -1, highPassFrequencyIndex: -1,
      selectedAmplifier: null, selectedSpeaker: null, activeGroup: 'device',
      selectorVisible: false, selectorType: '', selectorTitle: '', selectorKeyword: '',
      selectorCategoryIndex: 0, selectorCategories: [], selectorItems: [], selectorTotalCount: 0,
      amplifierKeyword: '', speakerKeyword: '', amplifierCategoryIndex: 0, speakerCategoryIndex: 0,
      reminderActive: false, reminderGroups: [], reminderSeconds: 0, reminderText: '',
      groupTabs: groupsWithReminders(), detailsVisible: false, shareSheetVisible: false, projectSheetVisible: false,
      projectStep: 'select', projectSearch: '', projectItems: [], projectTargetId: '', projectTargetName: '',
      projectNameError: '', projectNoteError: '', projectSaveError: '',
      resultReportImagePath: '', resultReportPreviewVisible: false, isGeneratingResultReport: false,
      currentFavorite: false,
    }
    this._projectSnapshotForSave = null
    this._lastProjectTarget = null
    this._pickerOverlayOpen = false
    this._reportCacheCheckRevision = 0
    const view = resultView({ ...this.data, ...empty })
    const persisted = removePreferences(PREFERENCE_KEY)
    this.setData({ ...empty, ...view }, () => {
      if (fallbackClosingEpoch != null) this.finishFallbackPageContainerLeave(fallbackClosingEpoch)
      else this.resumeReminderClock()
    })
    if (!persisted) wx.showToast({ title: '当前计算已清空，但本地草稿未能删除；重新打开可能恢复上次输入。', icon: 'none' })
    return persisted
  },

  startReminder(group) {
    this.pauseReminderClock()
    this._reminderEpoch += 1
    this._reminderRemainingMs = REMINDER_DURATION
    const initialSeconds = Math.ceil(REMINDER_DURATION / 1000)
    const labels = { device: '设备', load: '负载', settings: '设置' }
    const reminderGroups = GROUPS.filter((item) => item.key !== group).map((item) => item.key)
    this.setData({
      reminderActive: true, reminderGroups, reminderSeconds: initialSeconds,
      reminderText: `${labels[group]}已更改，请留意另外两组 · 倒计时结束后收起提醒，沿用当前值`,
      groupTabs: groupsWithReminders(reminderGroups),
    })
  },

  canRunReminderClock() {
    return this._pageVisible && !this.isPageActionOccluded()
  },

  pauseReminderClock() {
    if (this._reminderTimer == null) return
    clearTimeout(this._reminderTimer)
    this._reminderTimer = null
    this._reminderRemainingMs = Math.max(0, this._reminderRemainingMs - (Date.now() - this._reminderStartedAt))
    if (this.data && !this._isUnloaded) this.setData({ reminderSeconds: Math.ceil(this._reminderRemainingMs / 1000) })
  },

  resumeReminderClock() {
    if (this._reminderTimer != null || !this.data.reminderActive || !this.canRunReminderClock()) return
    if (this._reminderRemainingMs <= 0) return this.expireReminder(this._reminderEpoch)
    const epoch = this._reminderEpoch
    const startedAt = Date.now()
    let timer
    this._reminderStartedAt = startedAt
    timer = setTimeout(() => {
      if (this._reminderTimer !== timer || this._isUnloaded
        || epoch !== this._reminderEpoch || !this.data.reminderActive) return
      this._reminderTimer = null
      this._reminderRemainingMs = Math.max(0, this._reminderRemainingMs - (Date.now() - startedAt))
      if (this._reminderRemainingMs <= 0) this.expireReminder(epoch)
      else {
        this.setData({ reminderSeconds: Math.ceil(this._reminderRemainingMs / 1000) })
        this.resumeReminderClock()
      }
    }, Math.min(1000, this._reminderRemainingMs))
    this._reminderTimer = timer
  },

  expireReminder(epoch) {
    if (epoch !== this._reminderEpoch || this._isUnloaded) return
    this._reminderTimer = null
    this._reminderRemainingMs = 0
    this.setData({ reminderActive: false, reminderGroups: [], reminderSeconds: 0, reminderText: '', groupTabs: groupsWithReminders() })
  },

  stopTap() {},
  preventTouchMove() {},
})

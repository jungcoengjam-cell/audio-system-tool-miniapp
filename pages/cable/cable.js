const { createCableProjectData, createCableProjectMethods } = require('./cable-project')
const {
  calculateConstantVoltageCable,
  calculateProfessionalSpeakerCable,
} = require('../../utils/cable')
const { findValueIndex, readPreferences, writePreferencesDetailed } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const { isPageContextCurrent } = require('../../utils/report-image-actions')
const {
  cancelResultReportGeneration,
  createResultReportData,
  resetStaleResultReport,
} = require('../../utils/result-report-controller')
const {
  addRecordToProject,
  createProject,
  getProjectRecordView,
  getRecordById,
  getRecordByPayload,
  getWorkspaceSnapshot,
} = require('../../utils/records')
const {
  requestEditorLeave,
  saveEditorRecord: saveEditorRecordAction,
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')
const { attachResultEditor, captureEditorBaseline, createEditorNavigationMethods, finalizeResultEditor } = require('../../utils/result-record-context')
const { createCableReportMethods } = require('./cable-report')

const PREFERENCE_KEY = 'audioTool.cable.preferences'
const INPUT_CALCULATION_DELAY = 160
const DEFAULT_PREFERENCES = Object.freeze({
  mode: 'constant',
  environment: 'indoor',
  constantPowerText: '100',
  constantDistanceText: '100',
  professionalPowerText: '300',
  professionalDistanceText: '50',
})
const PREFERENCE_WRITE_ERROR = '本页偏好未能保存到本地；点此重试。'
const cableReportMethods = createCableReportMethods()

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

function canResetPreferences(state) {
  return Boolean(state.inputPending || state.inputError
    || state.preferenceSaveError
    || JSON.stringify(buildPreferences(state)) !== JSON.stringify(DEFAULT_PREFERENCES))
}

function writeCablePreferences(page, preferences) {
  if (page._resetPreferenceRetryPending) return false
  const result = writePreferencesDetailed(PREFERENCE_KEY, preferences)
  const changes = {
    preferenceSaveError: result.ok ? '' : PREFERENCE_WRITE_ERROR,
    preferenceSaveErrorAction: result.ok ? '' : 'write',
  }
  changes.canReset = result.ok
    ? canResetPreferences({ ...page.data, ...changes })
    : true
  page.setData(changes)
  return result.ok
}

function serializePayload(payload) {
  try {
    return JSON.stringify(payload)
  } catch (error) {
    return ''
  }
}

function cancelProjectCloseTimer(page) {
  if (page._projectCloseTimer != null) clearTimeout(page._projectCloseTimer)
  page._projectCloseTimer = null
}
const cableProjectMethods = createCableProjectMethods({
  addRecordToProject,
  createProject,
  getProjectRecordView,
  getRecordById,
  getRecordByPayload,
  getWorkspaceSnapshot,
  vibrate,
  serializePayload,
  cancelProjectCloseTimer,
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
  ...createEditorNavigationMethods(requestEditorLeave),
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
    canReset: false,
    preferenceSaveError: '',
    preferenceSaveErrorAction: '',
    inputError: '',
    inputPending: false,
    calculationState: 'blank',
    canUseResultActions: false,
    ...createCableProjectData(),
    ...createResultReportData(),
    resultReportPreviewClosing: false,
    resultReportPreviewStyle: '',
    isCheckingResultReportCache: false,
  },

  onLoad(options = {}) {
    attachResultEditor(this, 'cable', options)
    this._pageVisible = false
    this._isUnloaded = false
    this._favoriteSyncedSinceLoad = false
    this._inputRevision = 0
    this._reportPreviewLayoutRevision = 0
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
    const loadedState = { ...this.data, ...changes, ...calculated }
    this.setData({
      ...changes,
      ...calculated,
      calculationState: calculated.result ? 'ready' : calculated.inputError ? 'error' : 'blank',
      canUseResultActions: Boolean(calculated.result),
      inputPending: false,
      canReset: canResetPreferences(loadedState),
    }, () => {
      captureEditorBaseline(this)
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        syncPageFavorite(this)
        this._favoriteSyncedSinceLoad = true
      }
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
    if (this.data.resultReportPreviewVisible) this.updateResultReportPreviewLayout()
    if (this.data.result) {
      syncPageFavorite(this)
      this._favoriteSyncedSinceLoad = true
    }
  },

  onResize() {
    if (this.data.resultReportPreviewVisible) this.updateResultReportPreviewLayout()
  },

  onHide() {
    this._pageVisible = false
    cancelProjectCloseTimer(this)
    if (this.data.projectDialogVisible) this.closeProjectDialog(true)
    this.flushInputCalculation()
    cancelResultReportGeneration(this)
    this._reportCacheCheckRevision = 0
    this.setData(this.hideResultReportPreview())
  },

  onUnload() {
    this._pageVisible = false
    this._isUnloaded = true
    cancelProjectCloseTimer(this)
    this._inputRevision = (this._inputRevision || 0) + 1
    this._reportCacheCheckRevision = 0
    if (this.data.projectDialogVisible) this.closeProjectDialog(true)
    this.cancelInputCalculation()
    cancelResultReportGeneration(this)
    this.setData(this.hideResultReportPreview())
    finalizeResultEditor(this)
  },

  onModeTap(event) {
    const modeIndex = Number(event.currentTarget.dataset.index)
    if (modeIndex !== this.data.modeIndex) {
      vibrate('light')
      this.setData(this.invalidateResultReportPreview())
    }
    this.commitCalculatedState({ modeIndex })
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    this._inputRevision = (this._inputRevision || 0) + 1
    const previewChanges = this.invalidateResultReportPreview()
    cancelResultReportGeneration(this)
    const changes = {
      [field]: event.detail.value,
      inputPending: true,
      calculationState: 'pending',
      canUseResultActions: false,
      ...previewChanges,
      isGeneratingResultReport: false,
    }
    this.setData({
      ...changes,
      canReset: canResetPreferences({ ...this.data, ...changes }),
    })
    this.scheduleInputCalculation()
  },

  onInputBlur() {
    this.flushInputCalculation()
  },

  onEnvironmentChange(event) {
    const environmentIndex = Number(event.detail.value)
    if (environmentIndex !== this.data.environmentIndex) {
      vibrate('light')
      this.setData(this.invalidateResultReportPreview())
    }
    this.commitCalculatedState({ environmentIndex })
  },

  calculate() {
    return this.commitCalculatedState()
  },

  commitCalculatedState(changes = {}, options = {}) {
    this.cancelInputCalculation()
    const revision = (this._inputRevision || 0) + 1
    this._inputRevision = revision
    const pageState = { ...this.data, ...changes }
    const calculated = calculatePageResult(pageState)
    const calculationState = calculated.result ? 'ready' : calculated.inputError ? 'error' : 'blank'
    const resultReportChanges = resetStaleResultReport(
      this,
      this.getRecordPayload(pageState, calculated.result),
    )
    if (Object.keys(resultReportChanges).length) {
      this._reportCacheCheckRevision = 0
      resultReportChanges.isCheckingResultReportCache = false
    }
    this.setData({
      ...changes,
      ...calculated,
      calculationState,
      canUseResultActions: Boolean(calculated.result),
      inputPending: false,
      canReset: canResetPreferences({ ...pageState, ...calculated, inputPending: false }),
      ...resultReportChanges,
    }, () => {
      if (revision !== this._inputRevision) return
      if (!calculated.result) return
      if (!options.skipPreferenceWrite) writeCablePreferences(this, buildPreferences(pageState))
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

  getEditorPreferences(state = this.data) {
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

  ...cableReportMethods,

  resetInputs() {
    if (!this.data.canReset || this.data.projectSaving) return false
    const persisted = writePreferencesDetailed(PREFERENCE_KEY, DEFAULT_PREFERENCES)
    if (!persisted.ok) {
      this._resetPreferenceRetryPending = true
      this.setData({
        preferenceSaveError: PREFERENCE_WRITE_ERROR,
        preferenceSaveErrorAction: 'reset',
        canReset: true,
      })
      return false
    }
    this._resetPreferenceRetryPending = false
    this.setData({ preferenceSaveError: '', preferenceSaveErrorAction: '' })
    this.cancelInputCalculation()
    this._inputRevision = (this._inputRevision || 0) + 1
    cancelResultReportGeneration(this)
    this._reportCacheCheckRevision = 0
    if (this.data.projectDialogVisible) this.closeProjectDialog(true)
    else {
      this._projectDialogRevision = (this._projectDialogRevision || 0) + 1
      this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
      this._projectFocusContext = null
      if (this.data.projectKeyboardOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
    }
    this.setData(this.invalidateResultReportPreview())
    vibrate('light')
    return Boolean(this.commitCalculatedState({
      modeIndex: findValueIndex(this.data.modes, DEFAULT_PREFERENCES.mode, (item) => item.key),
      environmentIndex: findValueIndex(this.data.environments, DEFAULT_PREFERENCES.environment, (item) => item.value),
      constantPowerText: DEFAULT_PREFERENCES.constantPowerText,
      constantDistanceText: DEFAULT_PREFERENCES.constantDistanceText,
      professionalPowerText: DEFAULT_PREFERENCES.professionalPowerText,
      professionalDistanceText: DEFAULT_PREFERENCES.professionalDistanceText,
    }, { skipPreferenceWrite: true }))
  },

  retryPreferenceWrite() {
    if (this.data.preferenceSaveErrorAction === 'reset') return this.resetInputs()
    return writeCablePreferences(this, this.getPreferences())
  },

  copyResult() {
    this.flushInputCalculation()
    const resultText = this.getResultText()
    if (!resultText || !this.data.result || this.data.inputError || this.data.inputPending) return
    const payloadSignature = serializePayload(this.getRecordPayload())
    const inputRevision = this._inputRevision || 0
    wx.setClipboardData({ data: resultText, success: () => {
      if (this._pageVisible && !this._isUnloaded
        && (this._inputRevision || 0) === inputRevision
        && serializePayload(this.getRecordPayload()) === payloadSignature
        && isPageContextCurrent(this)) vibrate('medium')
    } })
  },

  toggleCurrentFavorite() {
    this.flushInputCalculation()
    if (!this.data.result || this.data.inputError || this.data.inputPending) return
    togglePageFavorite(this)
  },
...cableProjectMethods,
})

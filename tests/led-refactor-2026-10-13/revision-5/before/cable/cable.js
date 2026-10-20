const {
  calculateConstantVoltageCable,
  calculateProfessionalSpeakerCable,
} = require('../../utils/cable')
const { findValueIndex, readPreferences, writePreferencesDetailed } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  cancelResultReportGeneration,
  createResultReportData,
  resetStaleResultReport,
} = require('../../utils/result-report-controller')
const {
  addRecordToProject,
  createProject,
  getProjectRecordView,
  getRecordByPayload,
  getWorkspaceSnapshot,
} = require('../../utils/records')
const {
  syncPageFavorite,
  togglePageFavorite,
} = require('../../utils/result-record-actions')
const { createCableReportMethods } = require('./cable-report')

const PREFERENCE_KEY = 'audioTool.cable.preferences'
const INPUT_CALCULATION_DELAY = 160
const PROJECT_CLOSE_DURATION = 320
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

function projectMetadataDefaults(payload, projectId) {
  const record = getRecordByPayload(payload)
  const view = record ? getProjectRecordView(record, projectId) : null
  return view?.hasProjectMetadata
    ? { projectConfigName: view.title, projectConfigNote: view.projectNote || '' }
    : { projectConfigName: payload.title || '', projectConfigNote: '' }
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

function getWindowHeight() {
  try {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null
    const height = Number(info?.windowHeight || info?.screenHeight)
    return Number.isFinite(height) && height > 0 ? height : 720
  } catch (error) {
    return 720
  }
}

function getProjectSnapshot() {
  try {
    const snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    return snapshot?.ok ? snapshot : null
  } catch (error) {
    return null
  }
}

function getFilteredProjects(projects, query) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase()
  if (!normalizedQuery) return projects
  return projects.filter((project) => String(project.name || '').toLocaleLowerCase().includes(normalizedQuery))
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

function finishProjectDialogClose(page) {
  cancelProjectCloseTimer(page)
  page.setData({
    projectDialogVisible: false,
    projectDialogClosing: false,
    projectDialogRevision: page._projectDialogRevision,
    projectFocusEpisode: page._projectFocusEpisode,
    projectKeyboardOpen: false,
    projectKeyboardHeight: 0,
    projectKeyboardBottom: 0,
    projectFocusedInputId: '',
    projectViewportHeight: page._projectWindowBaseHeight || 720,
    projectSheetMaxHeight: Math.max(0, Math.floor((page._projectWindowBaseHeight || 720) * 0.9)),
    projectSaving: false,
    projectError: '',
    projectFrozenTitle: '',
    projectFrozenSummary: '',
    projectFrozenResultText: '',
  })
  return true
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
    canReset: false,
    preferenceSaveError: '',
    preferenceSaveErrorAction: '',
    inputError: '',
    inputPending: false,
    calculationState: 'blank',
    canUseResultActions: false,
    projectDialogVisible: false,
    projectDialogClosing: false,
    projectDialogStep: 'select',
    projectDialogRevision: 0,
    projectFocusEpisode: 0,
    projectProjects: [],
    filteredProjects: [],
    projectActiveId: '',
    projectSearchText: '',
    projectNameText: '',
    projectConfigName: '',
    projectConfigNote: '',
    projectNameError: '',
    projectNoteError: '',
    projectSavedConfigName: '',
    projectTarget: null,
    projectFrozenTitle: '',
    projectFrozenSummary: '',
    projectFrozenResultText: '',
    projectError: '',
    projectLoadFailed: false,
    projectSaving: false,
    projectKeyboardOpen: false,
    projectKeyboardHeight: 0,
    projectKeyboardBottom: 0,
    projectFocusedInputId: '',
    projectViewportHeight: 720,
    projectSheetMaxHeight: 640,
    projectSaveBlocked: false,
    ...createResultReportData(),
    resultReportPreviewClosing: false,
    resultReportPreviewStyle: '',
    resultReportImageViewerVisible: false,
    resultReportImageViewerScale: 100,
    resultReportImageViewerEpisode: 0,
    isCheckingResultReportCache: false,
  },

  onLoad() {
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
      if (this._pageVisible && !this._favoriteSyncedSinceLoad) {
        syncPageFavorite(this)
        this._favoriteSyncedSinceLoad = true
      }
    })
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
    vibrate('medium')
    wx.setClipboardData({ data: resultText })
  },

  toggleCurrentFavorite() {
    this.flushInputCalculation()
    if (!this.data.result || this.data.inputError || this.data.inputPending) return
    togglePageFavorite(this)
  },

  saveToActiveProject() {
    return this.openProjectSheet()
  },

  openProjectSheet() {
    this.flushInputCalculation()
    if (!this.data.result || this.data.inputError || this.data.inputPending) return false

    const payload = this.getRecordPayload()
    const payloadSignature = serializePayload(payload)
    if (!payload || !payloadSignature) return false

    cancelProjectCloseTimer(this)
    this._projectDialogRevision = (this._projectDialogRevision || 0) + 1
    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFrozenPayload = JSON.parse(payloadSignature)
    this._projectFrozenSignature = payloadSignature
    this._projectWindowBaseHeight = getWindowHeight()
    this._projectFocusContext = null
    this.setData({
      projectDialogVisible: true,
      projectDialogClosing: false,
      projectDialogStep: 'select',
      projectDialogRevision: this._projectDialogRevision,
      projectFocusEpisode: this._projectFocusEpisode,
      projectProjects: [],
      filteredProjects: [],
      projectActiveId: '',
      projectSearchText: '',
      projectNameText: '',
      projectConfigName: '',
      projectConfigNote: '',
      projectNameError: '',
      projectNoteError: '',
      projectSavedConfigName: '',
      projectTarget: null,
      projectFrozenTitle: payload.title,
      projectFrozenSummary: payload.summary,
      projectFrozenResultText: payload.resultText,
      projectError: '',
      projectLoadFailed: false,
      projectSaving: false,
      projectKeyboardOpen: false,
      projectKeyboardHeight: 0,
      projectKeyboardBottom: 0,
      projectFocusedInputId: '',
      projectViewportHeight: this._projectWindowBaseHeight,
      projectSheetMaxHeight: Math.max(0, Math.floor(this._projectWindowBaseHeight * 0.9)),
      projectSaveBlocked: false,
    })
    this.refreshProjectTargets()
    return true
  },

  refreshProjectTargets() {
    const snapshot = getProjectSnapshot()
    if (!snapshot) {
      this.setData({
        projectLoadFailed: true,
        projectError: '读取项目列表失败，请检查本地存储后重试。',
        projectProjects: [],
        filteredProjects: [],
      })
      return null
    }

    const projects = snapshot.projects.map((project) => ({ ...project }))
    this.setData({
      projectProjects: projects,
      filteredProjects: getFilteredProjects(projects, this.data.projectSearchText),
      projectActiveId: snapshot.activeProject?.id || '',
      projectLoadFailed: false,
      projectError: '',
    })
    return snapshot
  },

  retryProjectRead() {
    const snapshot = this.refreshProjectTargets()
    if (snapshot && this.data.projectDialogStep === 'confirm' && this.data.projectTarget) {
      const target = snapshot.projects.find((project) => project.id === this.data.projectTarget.id)
      if (!target || target.name !== this.data.projectTarget.name) {
        this.moveProjectToSelection(snapshot,
          target ? '项目名称已变更，请重新选择。' : '目标项目已不存在，请重新选择。')
      }
    }
  },

  onProjectSearch(event) {
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing) return
    const projectSearchText = event.detail.value
    this.setData({
      projectSearchText,
      filteredProjects: getFilteredProjects(this.data.projectProjects, projectSearchText),
    })
  },

  beginProjectInputFocus(event) {
    const dataset = event.currentTarget.dataset || {}
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing
      || Number(dataset.dialogRevision) !== this._projectDialogRevision
      || dataset.step !== this.data.projectDialogStep) return

    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFocusContext = {
      episode: this._projectFocusEpisode,
      revision: this._projectDialogRevision,
      step: this.data.projectDialogStep,
      field: dataset.field || '',
      timeStamp: Number.isFinite(Number(event.timeStamp)) ? Number(event.timeStamp) : null,
    }
    this.setData({
      projectFocusEpisode: this._projectFocusEpisode,
      projectFocusedInputId: dataset.step === 'confirm' ? dataset.field || '' : '',
    })
  },

  endProjectInputFocus(event) {
    const dataset = event.currentTarget.dataset || {}
    const focus = this._projectFocusContext
    if (!focus || !this.data.projectDialogVisible || this.data.projectDialogClosing
      || Number(dataset.dialogRevision) !== focus.revision
      || Number(dataset.focusEpisode) !== focus.episode
      || dataset.step !== focus.step
      || (dataset.field && dataset.field !== focus.field)) return
    this._projectBlurEpisode = focus.episode
  },

  onProjectKeyboardHeightChange(event) {
    const dataset = event.currentTarget.dataset || {}
    const focus = this._projectFocusContext
    if (!focus || !this.data.projectDialogVisible || this.data.projectDialogClosing
      || Number(dataset.dialogRevision) !== focus.revision
      || Number(dataset.focusEpisode) !== focus.episode
      || dataset.step !== focus.step
      || dataset.field !== focus.field) return

    const eventTimeStampValue = event.timeStamp ?? event.detail?.timeStamp
    const eventTimeStamp = Number(eventTimeStampValue)
    if (focus.timeStamp !== null && Number.isFinite(eventTimeStamp)
      && eventTimeStamp < focus.timeStamp) return

    const keyboardHeight = Math.max(0, Number(event.detail.height) || 0)
    if (!keyboardHeight) {
      this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
      this._projectFocusContext = null
      this.setData({
        projectFocusEpisode: this._projectFocusEpisode,
        projectKeyboardOpen: false,
        projectKeyboardHeight: 0,
        projectKeyboardBottom: 0,
        projectFocusedInputId: '',
        projectViewportHeight: this._projectWindowBaseHeight || 720,
        projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      })
      return
    }

    const baseHeight = this._projectWindowBaseHeight || getWindowHeight()
    const currentHeight = getWindowHeight()
    const heightBeforeKeyboard = currentHeight < baseHeight ? currentHeight : baseHeight
    const visibleHeight = Math.max(0,
      Math.min(heightBeforeKeyboard, baseHeight - keyboardHeight))
    const windowShrunkForKeyboard = currentHeight < baseHeight
    this.setData({
      projectKeyboardOpen: true,
      projectKeyboardHeight: keyboardHeight,
      projectKeyboardBottom: windowShrunkForKeyboard ? 0 : keyboardHeight,
      projectViewportHeight: visibleHeight,
      projectSheetMaxHeight: Math.max(0, Math.floor(visibleHeight)),
    })
  },

  onProjectNameInput(event) {
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing) return false
    this.setData({
      projectNameText: event.detail.value,
      projectError: '',
      projectLoadFailed: false,
    })
  },

  onProjectConfigNameInput(event) {
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing || this.data.projectDialogStep !== 'confirm') return false
    this.setData({ projectConfigName: String(event?.detail?.value || ''), projectNameError: '', projectError: '' })
    return true
  },

  onProjectConfigNoteInput(event) {
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing || this.data.projectDialogStep !== 'confirm') return false
    this.setData({ projectConfigNote: String(event?.detail?.value || ''), projectNoteError: '', projectError: '' })
    return true
  },

  openProjectCreateForm() {
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing || this.data.projectLoadFailed) return
    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFocusContext = null
    if (this.data.projectKeyboardOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
    this.setData({
      projectDialogStep: 'create',
      projectFocusEpisode: this._projectFocusEpisode,
      projectKeyboardOpen: false,
      projectKeyboardHeight: 0,
      projectKeyboardBottom: 0,
      projectFocusedInputId: '',
      projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectNameText: '',
      projectError: '',
      projectLoadFailed: false,
    })
  },

  createProjectFromForm() {
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing) return false
    const projectName = String(this.data.projectNameText || '').trim()
    if (!projectName) {
      this.setData({ projectError: '请输入项目名称。' })
      return false
    }
    this.flushInputCalculation()
    if (!this.isProjectSavePayloadCurrent()) return false

    if (!getProjectSnapshot()) {
      this.setData({
        projectLoadFailed: true,
        projectError: '读取项目列表失败，请检查本地存储后重试。',
      })
      return false
    }

    const project = createProject(this.data.projectNameText)
    if (!project) {
      this.setData({ projectError: '新建失败，请检查项目名称和本地存储。' })
      return false
    }

    const snapshot = getProjectSnapshot()
    if (!snapshot) {
      this.setData({
        projectLoadFailed: true,
        projectError: '项目已提交创建，但读取列表失败；请重试核对后再保存。',
      })
      return false
    }
    const freshProject = snapshot.projects.find((item) => item.id === project.id)
    if (!freshProject || freshProject.name !== project.name) {
      this.moveProjectToSelection(snapshot, '项目创建状态已变化，请从列表重新选择。')
      return false
    }

    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFocusContext = null
    if (this.data.projectKeyboardOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
    this.setData({
      projectDialogStep: 'confirm',
      projectFocusEpisode: this._projectFocusEpisode,
      projectKeyboardOpen: false,
      projectKeyboardHeight: 0,
      projectKeyboardBottom: 0,
      projectFocusedInputId: '',
      projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectTarget: { id: freshProject.id, name: freshProject.name, createdInDialog: true },
      ...projectMetadataDefaults(this._projectFrozenPayload, freshProject.id),
      projectNameError: '',
      projectNoteError: '',
      projectError: '',
      projectLoadFailed: false,
      projectActiveId: snapshot.activeProject?.id || '',
      projectProjects: snapshot.projects.map((item) => ({ ...item })),
      filteredProjects: getFilteredProjects(snapshot.projects, this.data.projectSearchText),
    })
    return true
  },

  selectProjectTarget(event) {
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing) return false
    const projectId = String(event.currentTarget.dataset.id || '')
    const project = this.data.projectProjects.find((item) => item.id === projectId)
    if (!project || this.data.projectLoadFailed) return false
    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFocusContext = null
    if (this.data.projectKeyboardOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
    this.setData({
      projectDialogStep: 'confirm',
      projectFocusEpisode: this._projectFocusEpisode,
      projectKeyboardOpen: false,
      projectKeyboardHeight: 0,
      projectKeyboardBottom: 0,
      projectFocusedInputId: '',
      projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectTarget: { id: project.id, name: project.name, createdInDialog: false },
      ...projectMetadataDefaults(this._projectFrozenPayload, project.id),
      projectNameError: '',
      projectNoteError: '',
      projectError: '',
      projectLoadFailed: false,
    })
    return true
  },

  moveProjectToSelection(snapshot, error) {
    const projects = snapshot.projects.map((project) => ({ ...project }))
    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFocusContext = null
    this.setData({
      projectDialogStep: 'select',
      projectFocusEpisode: this._projectFocusEpisode,
      projectProjects: projects,
      filteredProjects: getFilteredProjects(projects, this.data.projectSearchText),
      projectActiveId: snapshot.activeProject?.id || '',
      projectTarget: null,
      projectConfigName: '',
      projectConfigNote: '',
      projectNameError: '',
      projectNoteError: '',
      projectKeyboardOpen: false,
      projectKeyboardHeight: 0,
      projectKeyboardBottom: 0,
      projectFocusedInputId: '',
      projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectLoadFailed: false,
      projectError: error || '',
    })
  },

  returnToProjectSelection() {
    if (!this.data.projectDialogVisible || this.data.projectDialogClosing) return false
    if (this.data.projectSaveBlocked) {
      this.closeProjectDialog()
      return this.openProjectSheet()
    }
    const snapshot = getProjectSnapshot()
    if (!snapshot) {
      this.setData({ projectLoadFailed: true, projectError: '读取项目列表失败，请重试。' })
      return false
    }
    this.moveProjectToSelection(snapshot, '')
    return true
  },

  isProjectSavePayloadCurrent() {
    const currentPayload = this.getRecordPayload()
    const currentSignature = serializePayload(currentPayload)
    if (this._projectFrozenSignature && currentSignature === this._projectFrozenSignature) return true
    this.setData({
      projectError: '当前选型结果已变化，请返回重新选择保存内容。',
      projectSaveBlocked: true,
    })
    return false
  },

  saveProjectTarget() {
    if (this.data.projectSaving || !this.data.projectDialogVisible || this.data.projectDialogClosing
      || this.data.projectDialogStep !== 'confirm' || !this.data.projectTarget) return false

    const projectConfigName = String(this.data.projectConfigName || '').trim()
    const projectConfigNote = String(this.data.projectConfigNote || '').trim()
    const projectNameError = !projectConfigName
      ? '请输入配置名称。'
      : projectConfigName.length > 60 ? '配置名称最多 60 个字符。' : ''
    const projectNoteError = projectConfigNote.length > 200 ? '备注最多 200 个字符。' : ''
    if (projectNameError || projectNoteError) {
      this.setData({ projectNameError, projectNoteError })
      return false
    }

    this.flushInputCalculation()
    if (!this.isProjectSavePayloadCurrent()) return false
    const frozenPayload = this._projectFrozenPayload
    const selected = this.data.projectTarget
    if (!frozenPayload) return false
    this.setData({ projectSaving: true, projectError: '', projectLoadFailed: false })

    const snapshot = getProjectSnapshot()
    if (!snapshot) {
      this.setData({
        projectSaving: false,
        projectLoadFailed: true,
        projectError: '读取项目列表失败，请重试。',
      })
      return false
    }
    const project = snapshot.projects.find((item) => item.id === selected.id)
    if (!project) {
      this.moveProjectToSelection(snapshot, '目标项目已不存在，请重新选择。')
      this.setData({ projectSaving: false })
      return false
    }
    if (project.name !== selected.name) {
      this.moveProjectToSelection(snapshot, '项目名称已变更，请重新选择。')
      this.setData({ projectSaving: false })
      return false
    }

    const savedRecord = addRecordToProject(frozenPayload, project.id, {
      name: projectConfigName,
      note: projectConfigNote,
    })
    if (!savedRecord) {
      this.setData({ projectSaving: false, projectError: '保存失败，请检查本地存储后重试。' })
      return false
    }

    const verified = getProjectSnapshot()
    const expectedSignature = JSON.stringify([frozenPayload.module, frozenPayload.preferences])
    const persisted = verified?.records.find((record) => (
      record.signature === expectedSignature && record.projectIds?.includes(project.id)
    ))
    const projectView = persisted ? getProjectRecordView(persisted, project.id) : null
    if (!verified || !persisted || !projectView?.hasProjectMetadata
      || projectView.title !== projectConfigName || projectView.projectNote !== projectConfigNote) {
      this.setData({
        projectSaving: false,
        projectLoadFailed: !verified,
        projectError: '暂时无法核对保存状态，请重试确认。',
      })
      return false
    }

    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFocusContext = null
    this.setData({
      projectDialogStep: 'success',
      projectFocusEpisode: this._projectFocusEpisode,
      projectKeyboardOpen: false,
      projectKeyboardHeight: 0,
      projectKeyboardBottom: 0,
      projectFocusedInputId: '',
      projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectSaving: false,
      projectError: '',
      projectSavedConfigName: projectConfigName,
      projectConfigName,
      projectConfigNote,
      projectNameError: '',
      projectNoteError: '',
      projectLoadFailed: false,
    })
    vibrate('medium')
    return true
  },

  closeProjectDialog(immediate) {
    if (!this.data.projectDialogVisible) {
      cancelProjectCloseTimer(this)
      return false
    }
    if (this.data.projectDialogClosing && immediate !== true) return false
    this._projectDialogRevision = (this._projectDialogRevision || 0) + 1
    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFocusContext = null
    if (this.data.projectKeyboardOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
    this._projectFrozenPayload = null
    this._projectFrozenSignature = ''
    cancelProjectCloseTimer(this)
    if (immediate === true || !this._pageVisible || this._isUnloaded) {
      return finishProjectDialogClose(this)
    }
    const closingRevision = this._projectDialogRevision
    this.setData({
      projectDialogClosing: true,
      projectDialogRevision: closingRevision,
      projectFocusEpisode: this._projectFocusEpisode,
    }, () => {
      if (closingRevision !== this._projectDialogRevision
        || !this.data.projectDialogClosing || !this.data.projectDialogVisible) return
      const timer = setTimeout(() => {
        if (this._projectCloseTimer !== timer || closingRevision !== this._projectDialogRevision
          || !this.data.projectDialogClosing) return
        this._projectCloseTimer = null
        finishProjectDialogClose(this)
      }, PROJECT_CLOSE_DURATION)
      this._projectCloseTimer = timer
    })
    return true
  },

  stopProjectTap() {},

  preventProjectTouchMove() {},

  retryProjectSave() {
    return this.saveProjectTarget()
  },
})

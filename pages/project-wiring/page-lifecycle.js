const VIEW_PREFERENCE_KEY = 'audioTool.projectWiring.view.v1'
const INITIALIZE_ONLY_ROUTE_ID = '__workspace_initialize_only__'

function readWorkspaceViewPreference() {
  const absent = { version: 1, tab: 'devices', projectId: '', hasPreference: false, readFailure: false }
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return { ...absent, readFailure: true }
  try {
    let value = wx.getStorageSync(VIEW_PREFERENCE_KEY)
    if (value === undefined || value === null || value === '') return absent
    if (typeof value === 'string') {
      try { value = JSON.parse(value) } catch (error) {
        return { ...absent, hasPreference: true, invalidPreference: true }
      }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
      return { ...absent, hasPreference: true, invalidPreference: true }
    }
    const hasProjectId = Object.prototype.hasOwnProperty.call(value, 'projectId')
    const rawProjectId = value.projectId
    const validProjectId = typeof rawProjectId === 'string' && Boolean(rawProjectId) && rawProjectId === rawProjectId.trim() && rawProjectId.length <= 100
    return {
      version: 1,
      tab: value.tab === 'lines' ? 'lines' : 'devices',
      projectId: validProjectId ? rawProjectId : '',
      hasPreference: true,
      readFailure: false,
      invalidTab: Object.prototype.hasOwnProperty.call(value, 'tab') && value.tab !== 'devices' && value.tab !== 'lines',
      invalidProjectId: hasProjectId && !validProjectId,
    }
  } catch (error) {
    return { ...absent, readFailure: true }
  }
}

function createPageLifecycle({ emptySchedule, resetFormKeyboardAvoidance, isPerformanceMeasurementEnabled, startMeasurement }) {
  function initializePageState(options = {}) {
    this.projectId = typeof options.id === 'string' ? options.id : ''
    this._destroyed = false
    this._hidden = false
    this._skipNextShowRefresh = true
    this._searchTimer = null
    this._searchRevision = 0
    this._reportRevision = 0
    this._projectLoadRevision = 0
    this._projectPickerRevision = 0
    this._reportSignature = ''
    this._reportPending = false
    this._reportSaveJobRevision = 0
    this._reportSaveJob = null
    this._reportSaveInFlight = null
    this._reportSavedPages = new Map()
    this._schedule = emptySchedule()
    this._draftBaseline = ''
    this._draftTouched = false
    this._draftIsCopy = false
    this._batchCommand = null
    this._batchDirty = false
    const formViewport = this.getFormWindowMetrics()
    this._formViewportBaselineHeight = formViewport.windowHeight
    this._formViewportScreenWidth = formViewport.screenWidth
    this._formKeyboardHeight = 0
    this._formInputId = ''
    this._formScrollRevision = 0
    this._formScrollTimer = null
    this._formBlurTimer = null
    if (this.projectId) {
      this.refreshProjectWiring()
      return
    }
    this.openInitialProject(null)
  }

  function resumePageState() {
    this._hidden = false
    if (!this.data.editorVisible && !this.data.batchVisible) this.updateFormViewportBaseline()
    if (this._skipNextShowRefresh) {
      this._skipNextShowRefresh = false
      return
    }
    if (!this.data.editorVisible && !this.data.batchVisible && this.projectId) this.refreshProjectWiring()
  }

  function hidePageState() {
    this._hidden = true
    this.clearFormKeyboardViewport()
    this._formInputId = ''
    if (this._formBlurTimer) clearTimeout(this._formBlurTimer)
    this._formBlurTimer = null
    this.invalidateExport(false)
  }

  function destroyPageState() {
    this._destroyed = true
    this._hidden = true
    this.resetFormKeyboardAvoidance(false)
    this._searchRevision += 1
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = null
    this.invalidateExport(false)
  }

  return {
    onLoad(options = {}) {
      this._collapsedGroups = new Set()
      this._draftPairSerial = 0
      this._workspaceSuppressedTouches = Object.create(null)
      this._workspaceSuppressedTapTarget = null
      this._workspaceInteractionTraceEnabled = false
      this._workspaceInteractionTraceEvents = []
      this._workspaceInteractionTraceSequence = 0
      this._workspaceInteractionTraceStartedAt = 0
      this._workspaceActionTouch = null
      this._workspaceGroupGesture = null
      this._workspaceDraftBaseline = ''
      this._draftStoredEndpointNames = null
      this._deviceDraftBaseline = ''
      this._deviceDraftNameTouched = false
      this._deviceEditorSessionId = 0
      this._inlineRenameSequence = 0
      this._inlineRename = null
      this._inlineRenameTouch = null
      this._inlineRenameSavingOwner = 0
      this._workspaceViewPreference = readWorkspaceViewPreference()
      this._workspaceResumeRevision = 0
      this._workspaceResumeMode = ''
      this._workspaceHasExplicitRoute = typeof options.id === 'string' && Boolean(options.id.trim())
      this._workspaceIgnoreInitialActive = false
      this._workspaceOverlayTimers = Object.create(null)
      this._workspaceOverlayEpochs = Object.create(null)
      this._workspaceSwipeGesture = null
      this._workspaceOpenSwipe = null
      this._workspaceScrollGesture = null
      this._workspaceDeletionToken = 0
      this._workspaceDeletion = null
      this._workspaceDeletionInFlight = null
      this._workspaceEditorDeleteToken = 0
      this._workspaceEditorDelete = null
      this._workspaceEditorDeleteNeedsRefresh = null
      this._workspaceEditorSessionId = 0
      this._workspaceTransitionRevision = 0
      this._workspaceDeleteNeedsRefresh = false
      this._workspaceReportClearToken = 0
      this._workspaceReportClearPending = false
      this._workspaceRemovalToken = 0
      this._workspaceRemovalTimers = []
      this.setData({ workspaceTab: this._workspaceViewPreference.tab })
      this.updateWorkspaceNavigation()
      this._workspaceThemeChange = ({ theme } = {}) => this.applyWorkspaceNavigationTheme(theme)
      if (typeof wx !== 'undefined' && typeof wx.onThemeChange === 'function') wx.onThemeChange(this._workspaceThemeChange)
      this.applyWorkspaceNavigationTheme()
      if (this._workspaceHasExplicitRoute) {
        this._workspaceResumeMode = 'explicit'
        initializePageState.call(this, options)
        return
      }
      if (!this._workspaceViewPreference.hasPreference || this._workspaceViewPreference.readFailure) {
        this._workspaceResumeMode = 'global-fallback'
        initializePageState.call(this, { ...options, id: undefined })
        return
      }

      this._workspaceIgnoreInitialActive = true
      if (this._workspaceViewPreference.projectId && !this._workspaceViewPreference.invalidProjectId && !this._workspaceViewPreference.invalidPreference) {
        this._workspaceResumeMode = 'validating'
        initializePageState.call(this, { ...options, id: this._workspaceViewPreference.projectId })
        return
      }
      this._workspaceResumeMode = 'missing'
      this._workspaceInitializationOnly = true
      initializePageState.call(this, { ...options, id: INITIALIZE_ONLY_ROUTE_ID })
      this.finishMissingWorkspaceResume()
    },

    onShow() {
      const profilingEnabled = isPerformanceMeasurementEnabled()
      const sameProjectReturn = profilingEnabled && this._hidden
        && !this.data.editorVisible && !this.data.batchVisible
        && Boolean(this.projectId && this.data.project && this.data.project.id === this.projectId)
      if (sameProjectReturn) {
        this._d1SameProjectReturnFinish = startMeasurement('D1.workspace.same-project-return', { sameProject: 1 })
      }
      this.traceWorkspaceInteraction('page-lifecycle', { phase: 'show' })
      this.cancelWorkspaceOverlayTimers(true)
      this.closeWorkspaceSwipeRow()
      const pendingEditorDelete = this._workspaceEditorDeleteNeedsRefresh
      const needsEditorDeleteRefresh = Boolean(pendingEditorDelete && pendingEditorDelete.projectId === this.projectId && !this._destroyed)
      const needsDeletionRefresh = (this._workspaceDeleteNeedsRefresh || needsEditorDeleteRefresh) && !this._workspaceDeletionInFlight && !this._destroyed
      const loadRevisionBeforeShow = this._projectLoadRevision
      this._workspaceEditorDeleteNeedsRefresh = null
      if (needsEditorDeleteRefresh && this.isWorkspaceEditorContextCurrent(pendingEditorDelete, true)) {
        resetFormKeyboardAvoidance.call(this, false)
        this.setData({ editorVisible: false, continuousVisible: false, saving: false,
          draft: null, draftPairs: [], pairErrors: [], formError: '', formFieldErrors: {}, saveError: '',
          'workspaceOverlayPhases.lineEditor': '', 'workspaceOverlayPhases.continuous': '' })
        this._draftTouched = false
        this._draftBaseline = ''
      }
      if (needsDeletionRefresh) {
        this._workspaceDeleteNeedsRefresh = false
        this.setData({ saving: false })
      }
      this.updateWorkspaceNavigation()
      resumePageState.call(this)
      if (needsDeletionRefresh && this._projectLoadRevision === loadRevisionBeforeShow && this.projectId) {
        this.refreshProjectWiring()
      }
      this.syncUnloadWarning()
    },

    onHide() {
      if (this._d1SameProjectReturnFinish) {
        const finish = this._d1SameProjectReturnFinish
        this._d1SameProjectReturnFinish = null
        finish({ status: 3 })
      }
      this.traceWorkspaceInteraction('page-lifecycle', { phase: 'hide' })
      if (this._inlineRename) this.clearInlineRename(this._inlineRename, { invalidated: true })
      this.closeWorkspaceSwipeRow()
      this.cancelWorkspaceSwipeGesture()
      this._workspaceScrollGesture = null
      this._workspaceGroupGesture = null
      this._workspaceActionTouch = null
      this._workspaceSuppressedTapTarget = null
      this._workspaceSuppressedTouches = Object.create(null)
      this.nextWorkspaceTransitionRevision()
      this.clearWorkspaceRetiringRow()
      this.cancelWorkspaceOverlayTimers(true)
      if (this._workspaceDeletion && !this._workspaceDeletion.submitted) this.invalidateWorkspaceDeletion()
      else this.invalidateWorkspaceEditorDelete()
      hidePageState.call(this)
    },

    onUnload() {
      this.traceWorkspaceInteraction('page-lifecycle', { phase: 'unload' })
      if (this._inlineRename) this.clearInlineRename(this._inlineRename, { invalidated: true })
      this.cancelWorkspaceSwipeGesture()
      this._workspaceScrollGesture = null
      this._workspaceGroupGesture = null
      this._workspaceActionTouch = null
      this._workspaceSuppressedTapTarget = null
      this._workspaceSuppressedTouches = Object.create(null)
      this.cancelWorkspaceRemovalTimers()
      this._workspaceRetiringRow = null
      this.cancelWorkspaceOverlayTimers(true)
      this.nextWorkspaceTransitionRevision()
      this._workspaceResumeRevision += 1
      this._workspaceDeletionToken += 1
      this._workspaceDeletion = null
      this._workspaceDeletionInFlight = null
      this._workspaceEditorDeleteToken += 1
      this._workspaceEditorDelete = null
      this._workspaceEditorDeleteNeedsRefresh = null
      this.clearUnloadWarning()
      if (typeof wx !== 'undefined' && typeof wx.offThemeChange === 'function' && this._workspaceThemeChange) wx.offThemeChange(this._workspaceThemeChange)
      this._workspaceThemeChange = null
      destroyPageState.call(this)
    },
  }
}

module.exports = { createPageLifecycle, VIEW_PREFERENCE_KEY }

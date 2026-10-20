const { DEVICE_OPTIONS, CONNECTOR_OPTIONS, applyScheduleChange } = require('../../utils/project-wiring')
const { createProject, getProjectWiring, getProjects, saveProjectWiring } = require('../../utils/records')
const { buildWorkspace, circleLabel, deviceNames, generatePortPairs } = require('./workspace-model')
const { isPerformanceMeasurementEnabled, startMeasurement, measureJsonPayloadBytes } = require('../../utils/performance')

const endpointFields = ['fromDevice', 'fromPort', 'toDevice', 'toPort']
const VIEW_PREFERENCE_KEY = 'audioTool.projectWiring.view.v1'
const INITIALIZE_ONLY_ROUTE_ID = '__workspace_initialize_only__'
const SWIPE_ACTION_WIDTH = 72
const SWIPE_LOCK_THRESHOLD = 12
const SWIPE_START_THRESHOLD = 7
const WORKSPACE_OVERLAY_OPEN_MS = 300
const WORKSPACE_OVERLAY_CLOSE_MS = 240
const WORKSPACE_ROW_ENTER_MS = 16
const WORKSPACE_ROW_EXIT_CLEANUP_MS = 240
const WORKSPACE_INTERACTION_TRACE_BUILD = 'workspace-touch-2026-10-16-r1'
const WORKSPACE_INTERACTION_TRACE_LIMIT = 80
const WORKSPACE_SUPPRESSED_TOUCH_MS = 300
const INLINE_RENAME_ACTION_BLUR_MS = 350
const WORKSPACE_TRACE_ENUMS = {
  control: new Set(['action', 'connect', 'device', 'line', 'delete-device', 'delete-line']),
  reason: new Set(['explicit', 'recent-drag', 'no-action-touch', 'action-touch-moved', 'action-touch-match',
    'action-touch-target-mismatch', 'action-touch-not-matched', 'cancelled', 'background-tap', 'list-scroll',
    'stale-target', 'busy', 'ready', 'capture-rejected', 'target-missing', 'destroyed', 'hidden',
    'project-mismatch', 'revision-mismatch', 'load-revision-mismatch', 'token-mismatch', 'requested', 'accepted', 'modal-unavailable',
    'modal-failed', 'already-submitted', 'started', 'response-ok', 'response-failed', 'context-stale',
    'response-invalid', 'applied', 'editor-opened', 'editor-not-open']),
  axis: new Set(['tap', 'horizontal', 'vertical']),
  phase: new Set(['hide', 'show', 'unload', 'enter', 'exit']),
}
const WORKSPACE_TRACE_STAGES = new Set(['trace-start', 'trace-stop', 'action-tap', 'action-tap-result',
  'row-touch-start', 'row-touch-axis', 'row-touch-end', 'row-touch-cancel', 'swipe-row-close',
  'delete-guard', 'delete-capture', 'delete-modal', 'delete-modal-callback', 'delete-save',
  'delete-save-result', 'delete-apply', 'page-lifecycle', 'delete-render', 'connect-guard', 'connect-open'])
const connectorOptions = [{ id: '', label: '待补' }, ...CONNECTOR_OPTIONS]
const text = (value) => String(value === undefined || value === null ? '' : value)
const dataset = (event) => event && event.currentTarget && event.currentTarget.dataset || {}
const targetDataset = (event) => event && event.target && event.target.dataset || {}
const inputValue = (event) => text(event && event.detail && event.detail.value)
const datasetBoolean = (value) => value === true || value === 1 || value === '1' || value === 'true'
const endpointPlaceholder = () => ({ id: '', name: '请选择设备', choiceLabel: '请选择设备' })
function endpointChoices(side, draft, devices) {
  const sourceId = side === 'to' && draft && draft.fromDeviceId ? String(draft.fromDeviceId) : ''
  const choices = (devices || []).filter((device) => !sourceId || device.id !== sourceId)
  return [endpointPlaceholder(), ...choices]
}
function resolveEndpointChoiceIndex(choices, side, draft) {
  if (!draft) return 0
  const id = draft && draft[`${side}DeviceId`]
  const index = (choices || []).findIndex((device) => id
    ? device.id === id
    : Boolean(device.legacy && device.name === draft[`${side}Device`]))
  return Math.max(0, index)
}
const firstTouch = (event, list = 'touches') => {
  const touches = event && event[list]
  return touches && Number(touches.length) > 0 ? touches[0] : null
}
const touchIdentifier = (touch) => touch && touch.identifier !== undefined && touch.identifier !== null ? String(touch.identifier) : ''
const notify = (title) => { if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') wx.showToast({ title, icon: 'none' }) }
const isInlineRenameInputTarget = (event) => datasetBoolean(targetDataset(event).inlineRenameInput)
  || text(event && event.target && event.target.id) === 'wiring-device-inline-rename-name'

function deviceNameDraftResult(draft, nameTouched, schedule) {
  const type = draft && draft.type
  const typeLabel = DEVICE_OPTIONS.find((option) => option.id === type)?.label || ''
  const automatic = type !== 'custom' && !nameTouched
  const validation = deviceNames(automatic ? typeLabel : text(draft && draft.name).trim(), draft && draft.count)
  if (!validation.ok) return { ...validation, automatic }
  if (!automatic) {
    return {
      ok: true,
      names: validation.names.length === 1 ? [text(draft.name).trim()] : validation.names,
      error: '', automatic,
    }
  }
  const existing = schedule && Array.isArray(schedule.devices) ? schedule.devices : []
  const ids = new Set(existing.map((device) => device.id))
  const previewDevices = validation.names.map((_, index) => {
    let id = `__preview_auto_${index}`
    let suffix = 0
    while (ids.has(id)) id = `__preview_auto_${index}_${++suffix}`
    ids.add(id)
    return { id, type, name: typeLabel, autoName: true }
  })
  const projected = buildWorkspace({ ...(schedule || { version: 1, revision: 0, nextNumber: 1, lines: [] }),
    devices: [...existing, ...previewDevices] })
  const previewIds = new Set(previewDevices.map((device) => device.id))
  return { ok: true, names: projected.devices.filter((device) => previewIds.has(device.id)).map((device) => device.name), error: '', automatic }
}

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

function writeWorkspaceViewPreference(projectId, tab) {
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
  const value = { version: 1, tab: tab === 'lines' ? 'lines' : 'devices' }
  if (typeof projectId === 'string' && projectId && projectId === projectId.trim() && projectId.length <= 100) value.projectId = projectId
  try {
    wx.setStorageSync(VIEW_PREFERENCE_KEY, value)
    return true
  } catch (error) {
    return false
  }
}

// This module owns presentation drafts only. Persistent commands and IDs remain in
// project-wiring/records; the original page retains its lifecycle and report jobs.
function createWorkspaceUI(base) {
  return {
    data: {
      ...base.data,
      workspaceTab: 'devices', devices: [], groups: [], deviceCount: 0,
      deviceOptions: DEVICE_OPTIONS, deviceChoices: [], fromDeviceChoices: [], toDeviceChoices: [],
      connectorOptions,
      wheelProjectIndex: [0], pendingProjectId: '',
      newProjectVisible: false, deviceEditorVisible: false, deviceEditorMode: 'add',
      inlineRenameKey: '', inlineRenameValue: '', inlineRenameFocus: false, inlineRenameSessionId: 0,
      deviceDraft: { type: 'receiver', name: '接收机', count: '1' },
      deviceNamePreview: [], deviceFormError: '',
      detailVisible: false, detailLine: null,
      draftPairs: [], pairErrors: [], fromDeviceIndex: 0, toDeviceIndex: 0,
      draftCircleLabel: '', draftCircleNumeric: false, continuousVisible: false,
      continuousDraft: { fromPort: '', toPort: '', count: '2' },
      continuousPairs: [], continuousError: '',
      navigationStyle: '',
      navigationControlStyle: '', navigationShareStyle: '', navigationShareBelow: true,
      projectWheelSheetStyle: 'height:360px;', projectWheelHeight: 240, projectWheelRowHeight: 48,
      projectWheelIndicatorStyle: 'box-sizing:border-box;height:48px;background-color:transparent;opacity:1;', projectWheelMaskStyle: '',
      scheduleRevision: 0, workspaceOverlayPhases: {
        projectPicker: '', newProject: '', deviceEditor: '', lineDetails: '', lineEditor: '', continuous: '', report: '',
      },
      workspaceRetiringRow: null,
      workspaceDeletingId: '',
      workspaceEditorDeleting: false,
    },

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
        base.onLoad.call(this, options)
        return
      }
      if (!this._workspaceViewPreference.hasPreference || this._workspaceViewPreference.readFailure) {
        this._workspaceResumeMode = 'global-fallback'
        base.onLoad.call(this, { ...options, id: undefined })
        return
      }

      this._workspaceIgnoreInitialActive = true
      if (this._workspaceViewPreference.projectId && !this._workspaceViewPreference.invalidProjectId && !this._workspaceViewPreference.invalidPreference) {
        this._workspaceResumeMode = 'validating'
        base.onLoad.call(this, { ...options, id: this._workspaceViewPreference.projectId })
        return
      }
      this._workspaceResumeMode = 'missing'
      this._workspaceInitializationOnly = true
      base.onLoad.call(this, { ...options, id: INITIALIZE_ONLY_ROUTE_ID })
      this.finishMissingWorkspaceResume()
    },

    openInitialProject(project) {
      if (this._workspaceIgnoreInitialActive) return false
      return base.openInitialProject.call(this, project)
    },

    refreshProjectWiring() {
      if (this._workspaceInitializationOnly) {
        this._workspaceInitializationOnly = false
        this.projectId = ''
        this.setData({
          loading: false, project: null, selectionRequired: true, loadError: '',
          canRetry: false, lineCount: 0, visibleLines: [],
          statusCounts: { pending: 0, connected: 0, checked: 0 },
        })
        return false
      }
      return base.refreshProjectWiring.call(this)
    },

    validateWorkspaceResumeProject() {
      const revision = ++this._workspaceResumeRevision
      const projectId = this._workspaceViewPreference && this._workspaceViewPreference.projectId
      if (!projectId || this._destroyed) return false
      const finish = (projects) => {
        if (this._destroyed || revision !== this._workspaceResumeRevision) return
        if (!projects || projects.ok !== true) {
          if (String(projects && projects.error || '').includes('项目不存在或已删除')) {
            this._workspaceResumeMode = 'missing'
            this.projectId = projectId
            this.applyLoadResult(projects, { projectId, revision: this._projectLoadRevision })
            this.finishMissingWorkspaceResume()
            return
          }
          this._workspaceResumeMode = 'storage-error'
          this.projectId = projectId
          this.applyLoadResult(projects || { ok: false, error: '暂时无法检查项目资料' }, { projectId, revision: this._projectLoadRevision })
          this.setData({
            loading: false, project: null, selectionRequired: true,
            loadErrorTitle: '无法恢复上次项目',
            loadError: '暂时无法检查项目资料，请重试或从上方选择项目。',
            canRetry: true,
          })
          return
        }
        if (!projects.project || projects.project.id !== projectId || !projects.schedule) {
          this._workspaceResumeMode = 'missing'
          this.projectId = projectId
          this.applyLoadResult({ ok: false, error: '项目不存在或已删除' }, { projectId, revision: this._projectLoadRevision })
          this.finishMissingWorkspaceResume()
          return
        }
        this._workspaceResumeMode = 'resumed'
        this.projectId = projectId
        this.applyLoadResult(projects, { projectId, revision: this._projectLoadRevision })
      }
      try {
        const result = getProjectWiring(projectId)
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish(null))
        else finish(result)
      } catch (error) { finish(null) }
      return true
    },

    finishMissingWorkspaceResume() {
      this._workspaceResumeMode = 'missing'
      this.projectId = ''
      const hadRememberedProject = Boolean(this._workspaceViewPreference && this._workspaceViewPreference.projectId)
      writeWorkspaceViewPreference('', this._workspaceViewPreference.tab)
      this.setData({
        loading: false, project: null, selectionRequired: true,
        projectPickerVisible: false, projectPickerLoading: false,
        loadErrorTitle: '上次打开的项目已不可用',
        loadError: '请从上方选择项目，或新建项目。',
        canRetry: false,
         devices: [], groups: [], deviceCount: 0, deviceChoices: [], fromDeviceChoices: [], toDeviceChoices: [],
      })
      if (!hadRememberedProject) this.setData({ loadErrorTitle: '请选择项目', loadError: '请从顶部选择已有项目或新建项目。' })
    },

    retryLoad() {
      if (this._workspaceResumeMode === 'storage-error') {
        this.setData({ loading: true, loadError: '', canRetry: false })
        this.validateWorkspaceResumeProject()
        return
      }
      base.retryLoad.call(this)
    },

    prepareWorkspaceOverlayPhase(name) {
      if (this._workspaceOverlayTimers[name]) clearTimeout(this._workspaceOverlayTimers[name])
      this._workspaceOverlayTimers[name] = null
      const epoch = (this._workspaceOverlayEpochs[name] || 0) + 1
      this._workspaceOverlayEpochs[name] = epoch
      return epoch
    },

    scheduleWorkspaceOverlayPhase(name, phase, epoch, onFinished) {
      const duration = phase === 'closing' ? WORKSPACE_OVERLAY_CLOSE_MS : WORKSPACE_OVERLAY_OPEN_MS
      this._workspaceOverlayTimers[name] = setTimeout(() => {
        if (this._destroyed || this._workspaceOverlayEpochs[name] !== epoch) return
        this._workspaceOverlayTimers[name] = null
        if (this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases[name] === phase) {
          this.setData({ [`workspaceOverlayPhases.${name}`]: '' }, () => {
            if (typeof onFinished === 'function' && !this._destroyed && this._workspaceOverlayEpochs[name] === epoch) onFinished()
          })
        }
      }, duration)
    },

    beginWorkspaceOverlay(name, changes = {}) {
      if (!name || this._destroyed) return
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      const currentPhase = this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases[name]
      const alreadyMounted = currentPhase === 'closing' || currentPhase === 'opening' || currentPhase === 'preparing' || this.workspaceOverlayIsVisible(name)
      const epoch = this.prepareWorkspaceOverlayPhase(name)
      const phase = alreadyMounted ? 'opening' : 'preparing'
      this.setData({ ...changes, [`workspaceOverlayPhases.${name}`]: phase })
      if (phase === 'preparing') {
        const advance = () => {
          if (this._destroyed || this._workspaceOverlayEpochs[name] !== epoch
            || !this.data.workspaceOverlayPhases || this.data.workspaceOverlayPhases[name] !== 'preparing') return
          this.setData({ [`workspaceOverlayPhases.${name}`]: 'opening' })
          this.scheduleWorkspaceOverlayPhase(name, 'opening', epoch)
        }
        if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(advance)
        else setTimeout(advance, 0)
        return
      }
      this.scheduleWorkspaceOverlayPhase(name, 'opening', epoch)
    },

    endWorkspaceOverlay(name, onFinished, changes = {}) {
      return this.endWorkspaceOverlays([name], changes, onFinished)
    },

    endWorkspaceOverlays(names, changes = {}, onFinished) {
      if (this._destroyed) return
      const activeNames = [...new Set((names || []).filter((name) => name && this.data.workspaceOverlayPhases
        && (this.data.workspaceOverlayPhases[name] || this.workspaceOverlayIsVisible(name))))]
      if (!activeNames.length) {
        if (Object.keys(changes).length) this.setData(changes)
        if (typeof onFinished === 'function') onFinished()
        return
      }
      const phases = { ...changes }
      const epochs = Object.create(null)
      activeNames.forEach((name) => {
        epochs[name] = this.prepareWorkspaceOverlayPhase(name)
        phases[`workspaceOverlayPhases.${name}`] = 'closing'
      })
      this.setData(phases, () => this.scheduleWorkspaceOverlayClosures(activeNames, epochs, onFinished))
    },

    scheduleWorkspaceOverlayClosures(names, epochs, onFinished) {
      if (this._destroyed || !names.length) return
      const activeNames = names.filter((name) => this._workspaceOverlayEpochs[name] === epochs[name]
        && this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases[name] === 'closing')
      if (!activeNames.length) return
      let remaining = names.length
      const finished = () => {
        remaining -= 1
        if (remaining === 0 && typeof onFinished === 'function' && !this._destroyed
          && names.every((name) => this._workspaceOverlayEpochs[name] === epochs[name])) onFinished()
      }
      activeNames.forEach((name) => this.scheduleWorkspaceOverlayPhase(name, 'closing', epochs[name], finished))
    },

    workspaceOverlayIsVisible(name) {
      const fields = {
        projectPicker: 'projectPickerVisible', newProject: 'newProjectVisible',
        deviceEditor: 'deviceEditorVisible', lineDetails: 'detailVisible',
        lineEditor: 'editorVisible', continuous: 'continuousVisible', report: 'reportPreviewVisible',
      }
      return Boolean(this.data && this.data[fields[name]])
    },

    workspaceOnlyOverlayClosing(name) {
      const phases = this.data && this.data.workspaceOverlayPhases || {}
      return phases[name] === 'closing' && Object.keys(phases).every((other) => other === name
        || (!phases[other] && !this.workspaceOverlayIsVisible(other)))
    },

    nextWorkspaceTransitionRevision() {
      this._workspaceTransitionRevision = (this._workspaceTransitionRevision || 0) + 1
      return this._workspaceTransitionRevision
    },

    cleanupWorkspaceOverlayContents(names = []) {
      if (this._destroyed || !this.data.workspaceOverlayPhases) return
      const closing = new Set(names)
      const changes = {}
      const settled = (name) => closing.has(name) && !this.workspaceOverlayIsVisible(name)
        && !this.data.workspaceOverlayPhases[name]
      if (settled('projectPicker')) changes.projectPickerLoading = false
      if (settled('newProject')) {
        changes.projectPickerName = ''
        changes.projectPickerError = ''
      }
      if (settled('lineDetails')) changes.detailLine = null
      if (settled('continuous')) {
        changes.continuousPairs = []
        changes.continuousError = ''
      }
      if (settled('lineEditor') && !this.data.continuousVisible) {
        changes.draft = null
        changes.draftPairs = []
        changes.pairErrors = []
        changes.formError = ''
        changes.formFieldErrors = {}
        changes.saveError = ''
        this._draftTouched = false
        this._draftBaseline = ''
      }
      if (settled('deviceEditor')) {
        changes.deviceFormError = ''
        changes.batchError = ''
      }
      if (Object.keys(changes).length) this.setData(changes)
      if (settled('lineEditor') || settled('deviceEditor')) {
        if (!this.data.editorVisible && !this.data.deviceEditorVisible && !this.data.continuousVisible) {
          if (typeof base.resetFormKeyboardAvoidance === 'function') base.resetFormKeyboardAvoidance.call(this)
          this.clearUnloadWarning()
        }
      }
      if (settled('report')) this.finishWorkspaceReportClear()
    },

    transitionWorkspaceOverlays(closeNames, openName, changes = {}, onClosed) {
      if (this._destroyed) return
      const closes = [...new Set((closeNames || []).filter((name) => name && this.data.workspaceOverlayPhases
        && (this.data.workspaceOverlayPhases[name] || this.workspaceOverlayIsVisible(name))))]
      const openPhase = this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases[openName]
      const openWasMounted = openPhase === 'closing' || openPhase === 'opening' || openPhase === 'preparing' || this.workspaceOverlayIsVisible(openName)
      const epochs = Object.create(null)
      const phases = { ...changes }
      closes.forEach((name) => {
        epochs[name] = this.prepareWorkspaceOverlayPhase(name)
        phases[`workspaceOverlayPhases.${name}`] = 'closing'
      })
      if (openName) {
        epochs[openName] = this.prepareWorkspaceOverlayPhase(openName)
        phases[`workspaceOverlayPhases.${openName}`] = openWasMounted ? 'opening' : 'preparing'
      }
      this.setData(phases, () => {
        if (closes.length) this.scheduleWorkspaceOverlayClosures(closes, epochs, onClosed)
      })
      if (openName) {
        const phase = openWasMounted ? 'opening' : 'preparing'
        if (phase === 'preparing') {
          const advance = () => {
            if (this._destroyed || this._workspaceOverlayEpochs[openName] !== epochs[openName]
              || !this.data.workspaceOverlayPhases || this.data.workspaceOverlayPhases[openName] !== 'preparing') return
            this.setData({ [`workspaceOverlayPhases.${openName}`]: 'opening' })
            this.scheduleWorkspaceOverlayPhase(openName, 'opening', epochs[openName])
          }
          if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(advance)
          else setTimeout(advance, 0)
        } else this.scheduleWorkspaceOverlayPhase(openName, 'opening', epochs[openName])
      }
      if (!closes.length && typeof onClosed === 'function') onClosed()
    },

    cancelWorkspaceOverlayTimers(clearPhases = false) {
      Object.keys(this._workspaceOverlayTimers || {}).forEach((name) => {
        if (this._workspaceOverlayTimers[name]) clearTimeout(this._workspaceOverlayTimers[name])
        this._workspaceOverlayTimers[name] = null
        this._workspaceOverlayEpochs[name] = (this._workspaceOverlayEpochs[name] || 0) + 1
      })
      if (clearPhases && !this._destroyed && this.data && this.data.workspaceOverlayPhases) {
        const phases = {}
        Object.keys(this.data.workspaceOverlayPhases).forEach((name) => { phases[`workspaceOverlayPhases.${name}`] = '' })
        if (this.data.workspaceOverlayPhases.lineDetails === 'closing' && !this.data.detailVisible) phases.detailLine = null
        if (this.data.workspaceOverlayPhases.lineEditor === 'closing' && !this.data.editorVisible) {
          phases.draft = null
          phases.draftPairs = []
          phases.pairErrors = []
        }
        if (this.data.workspaceOverlayPhases.continuous === 'closing' && !this.data.continuousVisible) {
          phases.continuousPairs = []
          phases.continuousError = ''
        }
        if (this.data.workspaceOverlayPhases.newProject === 'closing' && !this.data.newProjectVisible) {
          phases.projectPickerName = ''
          phases.projectPickerError = ''
        }
        this.setData(phases)
      }
    },

    startWorkspaceInteractionTrace() {
      this._workspaceInteractionTraceEnabled = true
      this._workspaceInteractionTraceEvents = []
      this._workspaceInteractionTraceSequence = 0
      this._workspaceInteractionTraceStartedAt = Date.now()
      this.traceWorkspaceInteraction('trace-start', { reason: 'explicit' })
      return this.getWorkspaceInteractionTrace()
    },

    getWorkspaceInteractionTrace() {
      return {
        build: WORKSPACE_INTERACTION_TRACE_BUILD,
        enabled: Boolean(this._workspaceInteractionTraceEnabled),
        events: (this._workspaceInteractionTraceEvents || []).map((event) => ({ ...event })),
      }
    },

    stopWorkspaceInteractionTrace() {
      const result = this.getWorkspaceInteractionTrace()
      this.traceWorkspaceInteraction('trace-stop', { reason: 'explicit' })
      this._workspaceInteractionTraceEnabled = false
      result.enabled = false
      result.events = (this._workspaceInteractionTraceEvents || []).map((event) => ({ ...event }))
      return result
    },

    traceWorkspaceInteraction(stage, details = {}) {
      if (!this._workspaceInteractionTraceEnabled) return
      const boolFields = ['touchPresent', 'identifierPresent', 'identifierZero', 'targetPresent', 'tapArrived',
        'projectMatch', 'revisionMatch', 'loadRevisionMatch', 'tokenMatch', 'busy', 'suppressed',
        'accepted', 'confirmed', 'saveOk', 'rendered', 'destroyed', 'hidden']
      const enumFields = ['control', 'reason', 'axis', 'phase']
      const entry = {
        sequence: ++this._workspaceInteractionTraceSequence,
        elapsedMs: Math.max(0, Date.now() - this._workspaceInteractionTraceStartedAt),
        stage: WORKSPACE_TRACE_STAGES.has(stage) ? stage : 'other',
      }
      boolFields.forEach((key) => {
        if (typeof details[key] === 'boolean') entry[key] = details[key]
      })
      enumFields.forEach((key) => {
        if (typeof details[key] === 'string' && WORKSPACE_TRACE_ENUMS[key] && WORKSPACE_TRACE_ENUMS[key].has(details[key])) {
          entry[key] = details[key]
        }
      })
      const events = this._workspaceInteractionTraceEvents || (this._workspaceInteractionTraceEvents = [])
      events.push(entry)
      if (events.length > WORKSPACE_INTERACTION_TRACE_LIMIT) events.splice(0, events.length - WORKSPACE_INTERACTION_TRACE_LIMIT)
    },

    inlineRenameCandidate(session) {
      if (!session || !this._schedule) return null
      const devices = (this._workspace || buildWorkspace(this._schedule)).devices || []
      return devices.find((device) => device.key === session.deviceKey && device.id === session.deviceId) || null
    },

    inlineRenameContextCurrent(session) {
      if (!session || this._inlineRename !== session || this._destroyed || this._hidden
        || String(this.projectId || '') !== session.projectId
        || !this.data.project || String(this.data.project.id) !== session.projectId
        || !this._schedule || Number(this._schedule.revision) !== session.revision
        || Number(this._projectLoadRevision) !== session.loadRevision) return false
      const device = this.inlineRenameCandidate(session)
      return Boolean(device && Boolean(device.legacy) === session.legacy
        && String(device.name) === session.originalName)
    },

    inlineRenameEventCurrent(event, session = this._inlineRename) {
      if (!session || !this.inlineRenameContextCurrent(session)) return false
      const data = dataset(event)
      return text(data.deviceKey) === session.deviceKey
        && text(data.id || data.deviceId) === session.deviceId
        && text(data.projectId) === session.projectId
        && Number(data.revision) === session.revision
        && Number(data.renameSessionId) === session.id
    },

    clearInlineRename(session, options = {}) {
      if (!session || this._inlineRename !== session) return false
      if (session.boundaryTimer) clearTimeout(session.boundaryTimer)
      if (session.actionTimer) clearTimeout(session.actionTimer)
      if (this._inlineRenameTouch && this._inlineRenameTouch.timer) clearTimeout(this._inlineRenameTouch.timer)
      if (options.invalidated === true && session.phase === 'saving') {
        this._workspaceDeleteNeedsRefresh = true
        if (this._inlineRenameSavingOwner === session.id) {
          this._inlineRenameSavingOwner = 0
          if (!this._destroyed) this.setData({ saving: false })
        }
      }
      session.invalidated = options.invalidated === true
      this._inlineRename = null
      this._inlineRenameTouch = null
      this.setData({ inlineRenameKey: '', inlineRenameValue: '', inlineRenameFocus: false, inlineRenameSessionId: 0 })
      return true
    },

    queueInlineRenameAction(action) {
      const session = this._inlineRename
      if (!session || !action || !action.kind) return false
      if (session.phase === 'done') return false
      const actionData = action.data || {}
      if ((actionData.projectId && text(actionData.projectId) !== session.projectId)
        || (actionData.revision !== undefined && Number(actionData.revision) !== session.revision)) return false
      action.projectId = session.projectId
      action.revision = session.revision
      action.loadRevision = session.loadRevision
      action.capturedProjectId = session.projectId
      action.capturedRevision = session.revision
      action.capturedLoadRevision = session.loadRevision
      const pending = session.pendingAction
      const searchStreamKinds = ['search', 'search-confirm']
      const pendingSearch = pending && searchStreamKinds.includes(pending.kind)
      const actionSearch = searchStreamKinds.includes(action.kind)
      if (!pending || pending.kind === 'background' || pending.kind === 'row') {
        session.pendingAction = action
      } else if (pendingSearch && actionSearch) {
        // Search input is a value stream rather than a sequence of separate
        // navigation actions. Keep its latest text, and retain Done intent once
        // the search field has submitted a query.
        session.pendingAction = {
          ...action,
          kind: pending.kind === 'search-confirm' || action.kind === 'search-confirm' ? 'search-confirm' : 'search',
          data: { ...(action.data || {}), value: actionData.value },
        }
      }
      session.actionRequested = true
      if (this._inlineRenameTouch) {
        this._inlineRenameTouch.actionQueued = true
        if (this._inlineRenameTouch.timer) clearTimeout(this._inlineRenameTouch.timer)
        this._inlineRenameTouch.timer = null
      }
      this.setData({ inlineRenameFocus: false })
      if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') {
        try { wx.hideKeyboard({}) } catch (error) {}
      }
      if (session.boundaryValue !== undefined) this.scheduleInlineRenameBoundary(session)
      else if (!session.actionTimer) {
        session.actionTimer = setTimeout(() => {
          session.actionTimer = null
          if (this._inlineRename !== session || !session.pendingAction || session.phase === 'saving') return
          const pending = session.pendingAction
          this.clearInlineRename(session)
          notify('名称尚未确认，未保存')
          this.runInlineRenameAction(pending, session, null)
        }, INLINE_RENAME_ACTION_BLUR_MS)
      }
      return true
    },

    scheduleInlineRenameBoundary(session = this._inlineRename) {
      if (!session || this._inlineRename !== session || session.boundaryValue === undefined
        || session.phase === 'saving' || session.boundaryTimer) return false
      if (this._inlineRenameTouch && !this._inlineRenameTouch.actionQueued && !this._inlineRenameTouch.cancelled) return false
      session.boundaryTimer = setTimeout(() => {
        session.boundaryTimer = null
        if (this._inlineRename !== session || session.phase === 'saving') return
        if (this._inlineRenameTouch && !this._inlineRenameTouch.actionQueued && !this._inlineRenameTouch.cancelled) return
        this.finishInlineRenameBoundary(session)
      }, 0)
      return true
    },

    finishInlineRenameBoundary(session = this._inlineRename) {
      if (!session || this._inlineRename !== session || session.phase === 'saving') return false
      const value = session.boundaryValue === undefined ? session.latestValue : session.boundaryValue
      session.boundaryValue = undefined
      session.boundaryKind = ''
      if (this._inlineRenameTouch && this._inlineRenameTouch.timer) clearTimeout(this._inlineRenameTouch.timer)
      this._inlineRenameTouch = null
      return this.commitInlineRename(session, value)
    },

    commitInlineRename(session, rawValue) {
      if (!this.inlineRenameContextCurrent(session)) {
        if (session && this._inlineRename === session) this.clearInlineRename(session, { invalidated: true })
        return false
      }
      const name = text(rawValue).trim()
      if (!name || name.length > 100) {
        const action = session.pendingAction
        this.clearInlineRename(session)
        notify('请输入有效的设备名称')
        if (action) this.runInlineRenameAction(action, session, null)
        return false
      }
      if (name === session.originalName.trim()) {
        const action = session.pendingAction
        this.clearInlineRename(session)
        if (action) this.runInlineRenameAction(action, session, null)
        return true
      }
      return this.saveInlineRename(session, name)
    },

    runInlineRenameAction(action, session, response, resultDeviceId = '') {
      if (!action || this._destroyed || this._hidden || !this.data.project
        || !this._schedule || String(this.projectId || '') !== session.projectId
        || String(this.data.project.id) !== session.projectId
        || action.projectId !== session.projectId || action.loadRevision !== session.loadRevision
        || action.capturedProjectId !== session.projectId || action.capturedRevision !== session.revision
        || action.capturedLoadRevision !== session.loadRevision
        || Number(this._projectLoadRevision) !== session.loadRevision
        || Number(this._schedule.revision) !== Number(action.expectedRevision === undefined ? action.revision : action.expectedRevision)) return false
      const data = { ...(action.data || {}) }
      if (resultDeviceId && text(data.deviceKey) === session.deviceKey) {
        data.id = resultDeviceId
        data.deviceId = resultDeviceId
        data.deviceKey = `device:${resultDeviceId}`
      }
      if (data.id || data.actionType || data.deleteType) {
        data.projectId = session.projectId
        data.revision = this._schedule.revision
        const event = { currentTarget: { dataset: data }, target: { dataset: {} } }
        if ((data.actionType === 'connect' || data.actionType === 'rename-device'
          || data.deleteType === 'device' || data.deleteType === 'line')
          && !this.workspaceActionTargetPresent(event)) {
          notify('项目已更新，请重新操作')
          return false
        }
        if (action.kind === 'connect') return this.connectDevice(event)
        if (action.kind === 'rename') return this.renameDevice(event)
        if (action.kind === 'delete') return this.deleteWorkspaceRecord(event)
      }
      if (action.kind === 'tab') return this.onWorkspaceTab({ currentTarget: { dataset: { tab: data.tab } } })
      if (action.kind === 'picker') return this.requestProjectPicker()
      if (action.kind === 'new-project') return this.requestNewProject()
      if (action.kind === 'back') return this.requestPageBack()
      if (action.kind === 'share') return this.shareProject()
      if (action.kind === 'add-device') return this.openDeviceEditor()
      if (action.kind === 'add-line') return this.openNewLine()
      if (action.kind === 'clear-search') return this.clearSearch()
      if (action.kind === 'row') return this.onWorkspaceRowTap({ currentTarget: { dataset: { tapKey: data.tapKey } }, target: { dataset: {} } })
      if (action.kind === 'search') return this.onSearchInput({ currentTarget: { dataset: {} }, detail: { value: data.value } })
      if (action.kind === 'search-confirm') return this.applySearch({ currentTarget: { dataset: {} }, detail: { value: data.value } })
      return this.onWorkspaceBackgroundTap()
    },

    captureInlineRenameTouchStart(event) {
      const session = this._inlineRename
      if (!session) return
      if (isInlineRenameInputTarget(event)) {
        if (this._inlineRenameTouch && this._inlineRenameTouch.timer) clearTimeout(this._inlineRenameTouch.timer)
        this._inlineRenameTouch = null
        return
      }
      const point = firstTouch(event)
      if (!point) return
      if (this._inlineRenameTouch && this._inlineRenameTouch.timer) clearTimeout(this._inlineRenameTouch.timer)
      this._inlineRenameTouch = {
        sessionId: session.id, identifier: touchIdentifier(point),
        x: Number(point.clientX), y: Number(point.clientY), moved: false, ended: false,
        cancelled: false, actionQueued: false, timer: null,
      }
    },

    captureInlineRenameTouchMove(event) {
      const gesture = this._inlineRenameTouch
      const point = firstTouch(event)
      if (!gesture || !point || gesture.sessionId !== (this._inlineRename && this._inlineRename.id)) return
      if (Math.max(Math.abs(Number(point.clientX) - gesture.x), Math.abs(Number(point.clientY) - gesture.y)) > 6) gesture.moved = true
    },

    settleInlineRenameTouch(gesture, cancelled = false) {
      if (!gesture || this._inlineRenameTouch !== gesture) return
      gesture.cancelled = cancelled
      if (gesture.timer) clearTimeout(gesture.timer)
      this._inlineRenameTouch = null
      const session = this._inlineRename
      if ((cancelled || gesture.moved) && session && session.id === gesture.sessionId
        && session.boundaryValue !== undefined) this.scheduleInlineRenameBoundary(session)
    },

    captureInlineRenameTouchEnd() {
      const gesture = this._inlineRenameTouch
      if (!gesture) return
      gesture.ended = true
      if (gesture.moved) this.settleInlineRenameTouch(gesture, false)
    },

    captureInlineRenameTouchCancel() {
      const gesture = this._inlineRenameTouch
      if (!gesture) return
      this.settleInlineRenameTouch(gesture, true)
    },

    captureInlineRenameTap(event) {
      const session = this._inlineRename
      if (!session || isInlineRenameInputTarget(event)) return
      const gesture = this._inlineRenameTouch
      if (gesture && gesture.timer) clearTimeout(gesture.timer)
      if (gesture) gesture.tapSeen = true
      const settle = () => {
        if (gesture && this._inlineRenameTouch === gesture) this._inlineRenameTouch = null
        if (this._inlineRename === session && session.boundaryValue !== undefined) this.scheduleInlineRenameBoundary(session)
      }
      // Capture handlers run before the semantic tap handler. This task lets a
      // child catchtap queue its exact action before a blur can retire the row.
      setTimeout(settle, 0)
    },

    onInlineRenameInput(event) {
      const session = this._inlineRename
      if (!this.inlineRenameEventCurrent(event, session) || session.phase !== 'editing') return
      session.latestValue = inputValue(event)
      if (session.boundaryValue !== undefined) session.boundaryValue = session.latestValue
    },

    onInlineRenameBlur(event) {
      const session = this._inlineRename
      if (!this.inlineRenameEventCurrent(event, session) || session.phase === 'done') return
      session.boundaryValue = inputValue(event)
      session.boundaryKind = 'blur'
      this.scheduleInlineRenameBoundary(session)
    },

    onInlineRenameConfirm(event) {
      const session = this._inlineRename
      if (!this.inlineRenameEventCurrent(event, session) || session.phase !== 'editing') return
      session.boundaryValue = inputValue(event)
      session.boundaryKind = 'confirm'
      this.setData({ inlineRenameFocus: false })
      if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') {
        try { wx.hideKeyboard({}) } catch (error) {}
      }
      this.scheduleInlineRenameBoundary(session)
    },

    workspaceActionControl(event) {
      const data = dataset(event)
      if (data.actionType === 'connect') return 'connect'
      if (data.actionType === 'rename-device') return 'device'
      if (data.deleteType === 'device') return 'delete-device'
      if (data.deleteType === 'line') return 'delete-line'
      return 'action'
    },

    workspaceActionRowKey(event) {
      const data = dataset(event)
      const type = data.deleteType || (data.actionType === 'connect' || data.actionType === 'rename-device' ? 'device' : '')
      const id = text(data.id)
      return type && id ? `${type}:${id}` : ''
    },

    workspaceActionTargetPresent(event) {
      const data = dataset(event)
      const id = text(data.id)
      if (!id || !this._workspace) return false
      if (data.deleteType === 'line') return this._workspace.groups.some((group) => group.lines.some((line) => line.id === id))
      if (data.actionType === 'rename-device' || data.actionType === 'connect' || data.deleteType === 'device') {
        const matches = this._workspace.devices.filter((device) => device.id === id)
        const key = text(data.deviceKey)
        if (key) return matches.some((device) => device.key === key)
        return matches.length === 1
      }
      return this._workspace.devices.some((device) => device.id === id)
    },

    rememberWorkspaceSuppressedTouch(event, targetKey = '') {
      const key = text(targetKey)
      if (!key) return
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches')) || touchIdentifier(firstTouch(event))
      const now = Date.now()
      Object.keys(this._workspaceSuppressedTouches || {}).forEach((key) => {
        const record = this._workspaceSuppressedTouches[key]
        if (!record || record.expires < now) delete this._workspaceSuppressedTouches[key]
      })
      const record = { key, expires: now + WORKSPACE_SUPPRESSED_TOUCH_MS }
      this._workspaceSuppressedTapTarget = record
      if (identifier !== '') this._workspaceSuppressedTouches[identifier] = record
    },

    clearWorkspaceSuppressedTouchForStart(event) {
      const identifier = touchIdentifier(firstTouch(event))
      if (identifier !== '' && this._workspaceSuppressedTouches) delete this._workspaceSuppressedTouches[identifier]
      this._workspaceSuppressedTapTarget = null
      this._workspaceActionTouch = null
    },

    consumeWorkspaceSuppressedTouch(event, targetKey = '') {
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches'))
      const key = text(targetKey)
      const now = Date.now()
      if (identifier !== '' && this._workspaceSuppressedTouches) {
        const record = this._workspaceSuppressedTouches[identifier]
        delete this._workspaceSuppressedTouches[identifier]
        if (record && this._workspaceSuppressedTapTarget === record) this._workspaceSuppressedTapTarget = null
        if (record && record.expires >= now && record.key === key) {
          return true
        }
      }
      const fallback = this._workspaceSuppressedTapTarget
      if (fallback && fallback.expires < now) {
        this._workspaceSuppressedTapTarget = null
        Object.keys(this._workspaceSuppressedTouches || {}).forEach((touchId) => {
          if (this._workspaceSuppressedTouches[touchId] === fallback) delete this._workspaceSuppressedTouches[touchId]
        })
      }
      else if (fallback && fallback.key === key) {
        this._workspaceSuppressedTapTarget = null
        Object.keys(this._workspaceSuppressedTouches || {}).forEach((touchId) => {
          if (this._workspaceSuppressedTouches[touchId] === fallback) delete this._workspaceSuppressedTouches[touchId]
        })
        return true
      }
      return false
    },

    workspaceActionTouchKey(event) {
      const data = dataset(event)
      return [data.actionType || data.deleteType || 'action', text(data.projectId), text(data.id), text(data.revision)].join(':')
    },

    consumeWorkspaceActionTap(event) {
      const control = this.workspaceActionControl(event)
      const data = dataset(event)
      const targetPresent = this.workspaceActionTargetPresent(event)
      const projectMatch = Boolean(data.projectId && String(data.projectId) === String(this.projectId)
        && this.data.project && String(this.data.project.id) === String(data.projectId))
      const revisionMatch = Boolean(this._schedule && Number(data.revision) === Number(this._schedule.revision))
      this.traceWorkspaceInteraction('action-tap', {
        control, tapArrived: true, targetPresent, projectMatch, revisionMatch,
        busy: Boolean(this.data.loading || this.data.saving || this.data.projectCreating
          || this._workspaceDeletion || this._workspaceDeletionInFlight),
      })
      if (this.consumeWorkspaceSuppressedTouch(event, this.workspaceActionRowKey(event))) {
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: false, suppressed: true, reason: 'recent-drag' })
        return false
      }
      const touch = this._workspaceActionTouch
      if (!touch) {
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: true, suppressed: false, reason: 'no-action-touch' })
        return true
      }
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches'))
      if (identifier && touch.identifier && identifier === touch.identifier && touch.moved) {
        this._workspaceActionTouch = null
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: false, suppressed: true, reason: 'action-touch-moved' })
        return false
      }
      const key = this.workspaceActionTouchKey(event)
      if (touch.key === key && (!touch.completed || !touch.moved)) {
        this._workspaceActionTouch = null
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: true, suppressed: false, reason: 'action-touch-match' })
        return true
      }
      if (identifier && touch.identifier && identifier === touch.identifier && touch.key !== key) {
        this._workspaceActionTouch = null
        this.traceWorkspaceInteraction('action-tap-result', { control, accepted: false, suppressed: true, reason: 'action-touch-target-mismatch' })
        return false
      }
      this.traceWorkspaceInteraction('action-tap-result', { control, accepted: true, suppressed: false, reason: 'action-touch-not-matched' })
      return true
    },

    onSwipeTouchStart(event) {
      this.clearWorkspaceSuppressedTouchForStart(event)
      if (isInlineRenameInputTarget(event)) { this._workspaceSwipeGesture = null; return }
      const point = firstTouch(event)
      const type = dataset(event).swipeType
      const id = text(dataset(event).swipeId)
      const busy = Boolean(this.data.saving || !this.data.project || datasetBoolean(dataset(event).retiring))
      this.traceWorkspaceInteraction('row-touch-start', {
        control: type === 'line' ? 'line' : 'device', touchPresent: Boolean(point),
        identifierPresent: Boolean(point && touchIdentifier(point) !== ''),
        identifierZero: Boolean(point && touchIdentifier(point) === '0'),
        targetPresent: Boolean(id), busy,
      })
      if (busy) return
      if (!['device', 'line'].includes(type) || !id || !point) return
      const key = `${type}:${id}`
      if (this._workspaceOpenSwipe && this._workspaceOpenSwipe.key !== key) this.closeWorkspaceSwipeRow()
      const openOffset = this._workspaceOpenSwipe && this._workspaceOpenSwipe.key === key
        ? this._workspaceOpenSwipe.offset : 0
      this._workspaceSwipeGesture = {
        key, type, id,
        groupIndex: Number(dataset(event).groupIndex),
        startX: Number(point.clientX), startY: Number(point.clientY),
        lastX: Number(point.clientX), lastY: Number(point.clientY),
        startOffset: openOffset, lastOffset: openOffset, axis: '',
        touchId: touchIdentifier(point),
      }
    },

    onSwipeTouchMove(event) {
      const gesture = this._workspaceSwipeGesture
      const point = event && event.touches && event.touches[0]
      if (!gesture || !point) return
      const x = Number(point.clientX)
      const y = Number(point.clientY)
      const deltaX = x - gesture.startX
      const deltaY = y - gesture.startY
      gesture.lastX = x
      gesture.lastY = y
      if (!gesture.axis) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_START_THRESHOLD) return
        if (Math.abs(deltaX) >= Math.abs(deltaY) * 1.3) {
          gesture.axis = 'horizontal'
        } else if (Math.abs(deltaY) >= Math.abs(deltaX)) {
          gesture.axis = 'vertical'
          this.traceWorkspaceInteraction('row-touch-axis', { control: gesture.type, axis: 'vertical' })
          return
        } else return
        this.traceWorkspaceInteraction('row-touch-axis', { control: gesture.type, axis: gesture.axis })
      }
      if (gesture.axis !== 'horizontal') return
      const nextOffset = Math.max(0, Math.min(SWIPE_ACTION_WIDTH, gesture.startOffset - deltaX))
      gesture.lastOffset = nextOffset
      this.applyWorkspaceSwipeOffset(gesture, nextOffset, true)
    },

    applyWorkspaceSwipeOffset(gesture, offset, dragging) {
      const open = offset > 0
      const value = Math.max(0, Math.min(SWIPE_ACTION_WIDTH, offset))
      if (open) this._workspaceOpenSwipe = { key: gesture.key, type: gesture.type, id: gesture.id, offset: value }
      else this._workspaceOpenSwipe = null
      let path = ''
      if (gesture.type === 'device') {
        const index = this.data.devices.findIndex((item) => item && item.id === gesture.id && !item.retiring)
        if (index >= 0) path = `devices[${index}]`
      } else {
        const groupIndex = this.data.groups.findIndex((item) => item && Array.isArray(item.lines)
          && item.lines.some((line) => line && line.id === gesture.id && !line.retiring))
        const group = this.data.groups[groupIndex]
        const index = group && group.lines.findIndex((item) => item && item.id === gesture.id && !item.retiring)
        if (group && index >= 0) path = `groups[${groupIndex}].lines[${index}]`
      }
      if (!path) return
      this.setData({
        [`${path}.swipeOpen`]: open,
        [`${path}.swipeOffset`]: value,
        [`${path}.swipeDragging`]: Boolean(dragging),
      })
    },

    onSwipeTouchEnd(event) {
      const gesture = this._workspaceSwipeGesture
      if (!gesture) return
      if (gesture.axis === 'horizontal') {
        const offset = gesture.lastOffset >= SWIPE_ACTION_WIDTH / 2 ? SWIPE_ACTION_WIDTH : 0
        this.applyWorkspaceSwipeOffset(gesture, offset, false)
        this.rememberWorkspaceSuppressedTouch(event, gesture.key)
      } else if (gesture.axis === 'vertical') {
        this.applyWorkspaceSwipeOffset(gesture, 0, false)
        this.rememberWorkspaceSuppressedTouch(event, gesture.key)
      }
      this.traceWorkspaceInteraction('row-touch-end', {
        control: gesture.type, axis: gesture.axis || 'tap',
        touchPresent: Boolean(firstTouch(event, 'changedTouches') || firstTouch(event)),
        identifierPresent: Boolean(touchIdentifier(firstTouch(event, 'changedTouches')) || touchIdentifier(firstTouch(event))),
        identifierZero: (touchIdentifier(firstTouch(event, 'changedTouches')) || touchIdentifier(firstTouch(event))) === '0',
        suppressed: gesture.axis === 'horizontal' || gesture.axis === 'vertical',
      })
      this._workspaceSwipeGesture = null
    },

    onSwipeTouchCancel(event) {
      const gesture = this._workspaceSwipeGesture
      this.traceWorkspaceInteraction('row-touch-cancel', {
        control: gesture && gesture.type === 'line' ? 'line' : 'device',
        touchPresent: Boolean(firstTouch(event, 'changedTouches') || firstTouch(event)),
        suppressed: false, reason: 'cancelled',
      })
      this.cancelWorkspaceSwipeGesture()
      this.closeWorkspaceSwipeRow()
    },

    onSwipeScrollTouchStart(event) {
      this.cancelWorkspaceSwipeGesture()
      this.clearWorkspaceSuppressedTouchForStart(event)
      const point = firstTouch(event)
      this._workspaceScrollGesture = point ? { startX: Number(point.clientX), startY: Number(point.clientY), moved: false, tapKey: text(dataset(event).tapKey) } : null
    },

    onSwipeScrollTouchMove(event) {
      const gesture = this._workspaceScrollGesture
      const point = firstTouch(event)
      if (!gesture || !point) return
      const deltaX = Number(point.clientX) - gesture.startX
      const deltaY = Number(point.clientY) - gesture.startY
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
        gesture.moved = true
        if (Math.abs(deltaY) > Math.abs(deltaX)) this.closeWorkspaceSwipeRow()
      }
    },

    onSwipeScrollTouchEnd(event) {
      if (this._workspaceScrollGesture && this._workspaceScrollGesture.moved) this.rememberWorkspaceSuppressedTouch(event, this._workspaceScrollGesture.tapKey)
      this._workspaceScrollGesture = null
    },
    onSwipeScrollTouchCancel() { this._workspaceScrollGesture = null },

    onSwipeActionTouchStart(event) {
      this.cancelWorkspaceSwipeGesture()
      this.clearWorkspaceSuppressedTouchForStart(event)
      const point = firstTouch(event)
      this._workspaceActionTouch = point ? {
        key: this.workspaceActionTouchKey(event), identifier: touchIdentifier(point),
        startX: Number(point.clientX), startY: Number(point.clientY), moved: false, completed: false,
      } : null
    },

    onSwipeActionTouchMove(event) {
      const touch = this._workspaceActionTouch
      const point = firstTouch(event)
      if (!touch || !point) return
      if (Math.max(Math.abs(Number(point.clientX) - touch.startX), Math.abs(Number(point.clientY) - touch.startY)) > SWIPE_LOCK_THRESHOLD) touch.moved = true
    },

    onSwipeActionTouchEnd(event) {
      const touch = this._workspaceActionTouch
      if (!touch) return
      if (touch.moved) this.rememberWorkspaceSuppressedTouch(event, touch.key)
      touch.completed = true
    },

    onSwipeActionTouchCancel() { this._workspaceActionTouch = null },

    onWorkspaceBackgroundTap(event) {
      if (this._inlineRename && !isInlineRenameInputTarget(event)) {
        this.queueInlineRenameAction({ kind: 'background', data: {} })
        return
      }
      if (this._workspaceOpenSwipe) {
        this.traceWorkspaceInteraction('swipe-row-close', { control: this._workspaceOpenSwipe.type, reason: 'background-tap' })
      }
      this.closeWorkspaceSwipeRow()
    },
    onWorkspaceListScroll() {
      if (this._workspaceOpenSwipe) {
        this.traceWorkspaceInteraction('swipe-row-close', { control: this._workspaceOpenSwipe.type, reason: 'list-scroll' })
      }
      this.closeWorkspaceSwipeRow()
    },
    onWorkspaceRowTap(event) {
      if (isInlineRenameInputTarget(event)) return
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'row', data: { tapKey: text(dataset(event).tapKey) } })
        return
      }
      const key = `device:${text(dataset(event).tapKey).replace(/^device:/, '')}`
      if (this.consumeWorkspaceSuppressedTouch(event, key)) return
      this.closeWorkspaceSwipeRow()
    },

    onWorkspaceRootTap(event) {
      if (isInlineRenameInputTarget(event)) return
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'background', data: {} })
        return
      }
      this.onWorkspaceBackgroundTap(event)
    },

    closeWorkspaceSwipeRow() {
      this.cancelWorkspaceSwipeGesture()
      const openSwipe = this._workspaceOpenSwipe
      if (!openSwipe) return
      const gesture = {
        key: openSwipe.key, type: openSwipe.type, id: openSwipe.id,
        groupIndex: this.data.groups.findIndex((group) => group.lines.some((line) => line.id === openSwipe.id)),
      }
      this._workspaceOpenSwipe = null
      const index = this.data.devices.findIndex((item) => item.id === openSwipe.id && !item.retiring)
      if (openSwipe.type === 'device' && index >= 0) {
        this.setData({ [`devices[${index}].swipeOpen`]: false, [`devices[${index}].swipeOffset`]: 0, [`devices[${index}].swipeDragging`]: false })
        return
      }
      if (openSwipe.type === 'line' && gesture.groupIndex >= 0) {
        const lineIndex = this.data.groups[gesture.groupIndex].lines.findIndex((line) => line.id === openSwipe.id && !line.retiring)
        if (lineIndex >= 0) this.setData({
          [`groups[${gesture.groupIndex}].lines[${lineIndex}].swipeOpen`]: false,
          [`groups[${gesture.groupIndex}].lines[${lineIndex}].swipeOffset`]: 0,
          [`groups[${gesture.groupIndex}].lines[${lineIndex}].swipeDragging`]: false,
        })
      }
    },

    cancelWorkspaceSwipeGesture() {
      this._workspaceSwipeGesture = null
    },

    captureWorkspaceDeletion(type, id, viewRevision, deviceKey = '') {
      if (this._workspaceDeletion || this._workspaceDeletionInFlight || this.data.saving
        || this._destroyed || this._hidden || !this.data.project || this.data.project.id !== this.projectId) return null
      if (Number(viewRevision) !== Number(this._schedule.revision) || !Number.isSafeInteger(this._schedule.revision)) return null
      const projectId = String(this.projectId)
      const schedule = this._schedule
      let command
      let content
      let confirmText = '删除'
      let row = null
      let resolvedDeviceKey = ''
      if (type === 'device') {
        const candidates = (this._workspace || buildWorkspace(schedule)).devices.filter((device) => device.id === id)
        const workspaceDevice = deviceKey
          ? candidates.find((device) => device.key === deviceKey)
          : candidates.length === 1 ? candidates[0] : null
        if (!workspaceDevice) return null
        resolvedDeviceKey = workspaceDevice.key
        if (workspaceDevice.legacy) {
          const associated = schedule.lines.filter((line) => ['from', 'to'].some((side) => {
            if (line[`${side}DeviceId`]) return false
            const key = `legacy:${JSON.stringify(line[`${side}Device`] || '')}`
            return key === id
          }))
          const ids = associated.map((line) => line.id)
          if (!ids.length) return null
          command = { type: 'delete-lines', ids: ids.slice() }
          content = `此项来自历史线路，将删除关联的 ${ids.length} 条线路。`
          confirmText = '一并删除'
        } else {
          const record = schedule.devices.find((device) => device.id === id)
          if (!record) return null
          const ids = schedule.lines.filter((line) => line.fromDeviceId === id || line.toDeviceId === id).map((line) => line.id)
          command = { type: 'delete-device', id, deleteConnectedLines: ids.length > 0, expectedLineIds: ids.slice() }
          content = ids.length
            ? `删除设备“${workspaceDevice.name}”时，关联的 ${ids.length} 条线路也会一并删除。`
            : `将从本项目中删除设备“${workspaceDevice.name}”。`
          if (ids.length) confirmText = '一并删除'
        }
        const index = this.data.devices.findIndex((device) => device.id === id
          && (!deviceKey || device.key === deviceKey))
        const item = this.data.devices[index]
        if (!item) return null
        row = { type: 'device', item, index }
      } else if (type === 'line') {
        const record = schedule.lines.find((line) => line.id === id)
        if (!record) return null
        const item = (this._workspace || buildWorkspace(schedule)).lines.find((line) => line.id === id)
        const groupIndex = this.data.groups.findIndex((group) => group.lines.some((line) => line.id === id))
        const group = this.data.groups[groupIndex]
        const index = group ? group.lines.findIndex((line) => line.id === id) : -1
        if (!item || !group || index < 0) return null
        command = { type: 'delete', id }
        const label = circleLabel(record, schedule)
        content = `将从本项目布线表中删除线路 ${label}。`
        row = { type: 'line', item: group.lines[index], index, group: { ...group, lines: undefined }, groupIndex }
      } else return null

      const snapshot = {
        token: ++this._workspaceDeletionToken,
        projectId,
        revision: schedule.revision,
        loadRevision: this._projectLoadRevision,
        recordId: id,
        recordType: type,
        deviceKey: resolvedDeviceKey,
        command,
        expectedLineIds: command.expectedLineIds ? command.expectedLineIds.slice() : command.ids ? command.ids.slice() : [],
        row,
        submitted: false,
      }
      this._workspaceDeletion = snapshot
      this.closeWorkspaceSwipeRow()
      return { snapshot, content, confirmText }
    },

    isWorkspaceDeletionCurrent(snapshot) {
      return Boolean(snapshot && this._workspaceDeletion === snapshot
        && snapshot.token === this._workspaceDeletionToken
        && !this._destroyed && !this._hidden
        && this.projectId === snapshot.projectId
        && this.data.project && this.data.project.id === snapshot.projectId
        && this._schedule && this._schedule.revision === snapshot.revision
        && this._projectLoadRevision === snapshot.loadRevision
        && (snapshot.recordType !== 'device' || !snapshot.deviceKey
          || this._workspace && this._workspace.devices.some((item) => item.id === snapshot.recordId && item.key === snapshot.deviceKey)))
    },

    workspaceDeletionTraceStatus(snapshot) {
      const projectMatch = Boolean(snapshot && this.projectId === snapshot.projectId
        && this.data.project && this.data.project.id === snapshot.projectId)
      const revisionMatch = Boolean(snapshot && this._schedule && this._schedule.revision === snapshot.revision)
      const loadRevisionMatch = Boolean(snapshot && this._projectLoadRevision === snapshot.loadRevision)
      const tokenMatch = Boolean(snapshot && this._workspaceDeletion === snapshot
        && snapshot.token === this._workspaceDeletionToken)
      let targetPresent = false
      if (snapshot && this._workspace) {
        if (snapshot.recordType === 'device') targetPresent = this._workspace.devices.some((item) => item.id === snapshot.recordId
          && (!snapshot.deviceKey || item.key === snapshot.deviceKey))
        else if (snapshot.recordType === 'line') targetPresent = this._workspace.groups.some((group) => group.lines.some((item) => item.id === snapshot.recordId))
      }
      return {
        destroyed: Boolean(this._destroyed), hidden: Boolean(this._hidden), projectMatch, revisionMatch,
        loadRevisionMatch, tokenMatch,
        busy: Boolean(this.data.saving || (this._workspaceDeletionInFlight && this._workspaceDeletionInFlight !== snapshot)),
        targetPresent,
      }
    },

    workspaceDeletionTraceReason(status) {
      if (status.destroyed) return 'destroyed'
      if (status.hidden) return 'hidden'
      if (!status.projectMatch) return 'project-mismatch'
      if (!status.revisionMatch) return 'revision-mismatch'
      if (!status.loadRevisionMatch) return 'load-revision-mismatch'
      if (!status.tokenMatch) return 'token-mismatch'
      if (status.busy) return 'busy'
      if (!status.targetPresent) return 'target-missing'
      return ''
    },

    invalidateWorkspaceDeletion() {
      this._workspaceDeletionToken = (this._workspaceDeletionToken || 0) + 1
      this._workspaceDeletion = null
      if (!this._destroyed && this.data && this.data.workspaceDeletingId) this.setData({ workspaceDeletingId: '' })
      this.invalidateWorkspaceEditorDelete()
    },

    invalidateWorkspaceEditorDelete() {
      this._workspaceEditorDeleteToken = (this._workspaceEditorDeleteToken || 0) + 1
      this._workspaceEditorDelete = null
      if (!this._destroyed && this.data && this.data.workspaceEditorDeleting) this.setData({ workspaceEditorDeleting: false })
    },

    captureWorkspaceEditorContext() {
      const draft = this.data.draft
      if (!draft || (!this.data.draftIsNew && !draft.id) || !this.data.project || !this._schedule) return null
      return {
        projectId: String(this.projectId || ''),
        lineId: String(draft.id || ''),
        isNew: Boolean(this.data.draftIsNew),
        editorSessionId: this._workspaceEditorSessionId || 0,
        revision: this._schedule.revision,
        loadRevision: this._projectLoadRevision,
        overlayEpoch: this._workspaceOverlayEpochs && this._workspaceOverlayEpochs.lineEditor || 0,
      }
    },

    isWorkspaceEditorContextCurrent(snapshot, allowHidden = false) {
      return Boolean(snapshot && !this._destroyed && (allowHidden || !this._hidden)
        && this.data.editorVisible && !this.data.continuousVisible
        && this.data.project && String(this.data.project.id) === snapshot.projectId
        && String(this.projectId || '') === snapshot.projectId
        && this.data.draft && Boolean(this.data.draftIsNew) === snapshot.isNew
        && (this._workspaceEditorSessionId || 0) === snapshot.editorSessionId
        && String(this.data.draft.id || '') === snapshot.lineId
        && this._schedule && this._schedule.revision === snapshot.revision
        && this._projectLoadRevision === snapshot.loadRevision
        && (allowHidden || (this._workspaceOverlayEpochs && this._workspaceOverlayEpochs.lineEditor || 0) === snapshot.overlayEpoch))
    },

    isWorkspaceDeletionTargetCurrent(projectId, viewRevision) {
      return Boolean(projectId && String(projectId) === String(this.projectId)
        && this.data.project && String(this.data.project.id) === String(projectId)
        && this._schedule && Number(viewRevision) === Number(this._schedule.revision)
        && Number.isSafeInteger(this._schedule.revision))
    },

    deleteWorkspaceRecord(event) {
      if (!this.consumeWorkspaceActionTap(event)) return
      if (this._inlineRename) {
        const data = dataset(event)
        if (!this.queueInlineRenameAction({ kind: 'delete', data: { ...data } })) notify('项目已更新，请重新操作')
        return
      }
      const data = dataset(event)
      const targetCurrent = this.isWorkspaceDeletionTargetCurrent(data.projectId, data.revision)
      const busy = Boolean(this.data.saving || this._workspaceDeletion || this._workspaceDeletionInFlight)
      this.traceWorkspaceInteraction('delete-guard', {
        control: this.workspaceActionControl(event), targetPresent: this.workspaceActionTargetPresent(event),
        projectMatch: Boolean(data.projectId && String(data.projectId) === String(this.projectId)
          && this.data.project && String(this.data.project.id) === String(data.projectId)),
        revisionMatch: Boolean(this._schedule && Number(data.revision) === Number(this._schedule.revision)),
        busy, accepted: targetCurrent && !busy,
        reason: !targetCurrent ? 'stale-target' : busy ? 'busy' : 'ready',
      })
      if (!targetCurrent) {
        notify("项目已更新，请重新操作")
        return
      }
      if (busy) {
        notify("正在处理删除，请稍后重试")
        return
      }
      const captured = this.captureWorkspaceDeletion(data.deleteType, text(data.id), data.revision, text(data.deviceKey))
      this.traceWorkspaceInteraction('delete-capture', { control: this.workspaceActionControl(event), accepted: Boolean(captured), reason: captured ? 'ready' : 'capture-rejected', targetPresent: this.workspaceActionTargetPresent(event) })
      if (!captured) {
        notify("项目已更新，请重新操作")
        return
      }
      this.setData({ workspaceDeletingId: text(data.id) })
      const { snapshot, content, confirmText } = captured
      const confirm = (result) => {
        const status = this.workspaceDeletionTraceStatus(snapshot)
        const current = this.isWorkspaceDeletionCurrent(snapshot)
        if (!current) {
          this.traceWorkspaceInteraction('delete-modal-callback', {
            control: data.deleteType === 'device' ? 'delete-device' : 'delete-line', accepted: false,
            confirmed: Boolean(result && result.confirm === true), reason: this.workspaceDeletionTraceReason(status), ...status,
          })
          return
        }
        if (!result || result.confirm !== true) {
          this.traceWorkspaceInteraction('delete-modal-callback', {
            control: data.deleteType === 'device' ? 'delete-device' : 'delete-line', accepted: false,
            confirmed: false, reason: 'cancelled', ...status,
          })
          this.invalidateWorkspaceDeletion()
          return
        }
        this.traceWorkspaceInteraction('delete-modal-callback', {
          control: data.deleteType === 'device' ? 'delete-device' : 'delete-line', accepted: true,
          confirmed: true, reason: 'accepted', ...status,
        })
        this.submitWorkspaceDeletion(snapshot)
      }
      if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') {
        this.traceWorkspaceInteraction('delete-modal', { control: this.workspaceActionControl(event), accepted: false, reason: 'modal-unavailable', targetPresent: true })
        this.invalidateWorkspaceDeletion()
        notify('暂时无法确认删除')
        return
      }
      this.traceWorkspaceInteraction('delete-modal', { control: this.workspaceActionControl(event), accepted: true, reason: 'requested', targetPresent: true })
      wx.showModal({
        title: snapshot.recordType === 'device' ? '删除设备？' : '删除线路？',
        content,
        confirmText,
        confirmColor: '#d70015',
        success: confirm,
        fail: () => {
          this.traceWorkspaceInteraction('delete-modal-callback', {
            control: data.deleteType === 'device' ? 'delete-device' : 'delete-line',
            accepted: false, confirmed: false, reason: 'modal-failed',
          })
          if (this._workspaceDeletion === snapshot) this.invalidateWorkspaceDeletion()
        },
      })
    },

    submitWorkspaceDeletion(snapshot) {
      if (!this.isWorkspaceDeletionCurrent(snapshot) || snapshot.submitted || this.data.saving) {
        const status = this.workspaceDeletionTraceStatus(snapshot)
        this.traceWorkspaceInteraction('delete-save', {
          control: snapshot && snapshot.recordType === 'device' ? 'delete-device' : 'delete-line',
          accepted: false, reason: status.busy ? 'busy' : this.workspaceDeletionTraceReason(status) || 'already-submitted', ...status,
        })
        return false
      }
      snapshot.submitted = true
      this._workspaceDeletionInFlight = snapshot
      this.traceWorkspaceInteraction('delete-save', { control: snapshot.recordType === 'device' ? 'delete-device' : 'delete-line', accepted: true, reason: 'started', targetPresent: true })
      this.closeWorkspaceSwipeRow()
      this.invalidateExport(true)
      this.setData({ saving: true, saveError: '', formError: '', batchError: '' })
      let result
      try { result = saveProjectWiring(snapshot.projectId, snapshot.command, snapshot.revision) }
      catch (error) { result = { ok: false, error: error && error.message ? error.message : '删除失败，请重试。' } }
      const finish = (response) => {
        if (this._workspaceDeletionInFlight === snapshot) this._workspaceDeletionInFlight = null
        this.traceWorkspaceInteraction('delete-save-result', {
          control: snapshot.recordType === 'device' ? 'delete-device' : 'delete-line',
          saveOk: Boolean(response && response.ok === true),
          reason: response && response.ok === true ? 'response-ok' : 'response-failed',
        })
        const current = this.isWorkspaceDeletionCurrent(snapshot)
        const sameVisibleProject = Boolean(snapshot.token === this._workspaceDeletionToken
          && this._workspaceDeletion === snapshot
          && !this._destroyed && !this._hidden
          && this.projectId === snapshot.projectId
          && this.data.project && this.data.project.id === snapshot.projectId)
        if (this._workspaceDeletion === snapshot) this._workspaceDeletion = null
        if (!current) {
          this.traceWorkspaceInteraction('delete-apply', {
            control: snapshot.recordType === 'device' ? 'delete-device' : 'delete-line',
            accepted: false, reason: 'context-stale', ...this.workspaceDeletionTraceStatus(snapshot),
          })
          this._workspaceDeleteNeedsRefresh = true
          if (sameVisibleProject) {
            this._workspaceDeletionToken += 1
            this.setData({ saving: false, workspaceDeletingId: '' })
            this.refreshProjectWiring()
            this._workspaceDeleteNeedsRefresh = false
          }
          return
        }
        this._workspaceDeletionToken += 1
        if (!response || response.ok !== true || !response.schedule) {
          this.traceWorkspaceInteraction('delete-apply', { control: snapshot.recordType === 'device' ? 'delete-device' : 'delete-line', accepted: false, reason: 'response-invalid' })
          this.setData({ saving: false, workspaceDeletingId: '' })
          const error = response && response.error ? String(response.error) : '删除失败，请重试。'
          notify(error)
          return
        }
        if (!response.project || response.project.id !== snapshot.projectId
          || !response.schedule || response.schedule.revision <= snapshot.revision) {
          this.traceWorkspaceInteraction('delete-apply', { control: snapshot.recordType === 'device' ? 'delete-device' : 'delete-line', accepted: false, reason: 'response-invalid' })
          this.setData({ saving: false, workspaceDeletingId: '' })
          notify('删除结果已变化，请刷新项目后重试。')
          this.refreshProjectWiring()
          return
        }
        this.setData({ saving: false, workspaceDeletingId: '' })
        this.beginWorkspaceRowRemoval(snapshot)
        this.acceptSavedSchedule(response)
        this.traceWorkspaceInteraction('delete-apply', { control: snapshot.recordType === 'device' ? 'delete-device' : 'delete-line', accepted: true, reason: 'applied' })
        notify(snapshot.recordType === 'device' ? '设备已删除' : '线路已删除')
      }
      if (result && typeof result.then === 'function') result.then(finish).catch((error) => finish({
        ok: false, error: error && error.message ? error.message : '删除失败，请重试。',
      }))
      else finish(result)
      return true
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
      base.onHide.call(this)
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
        base.resetFormKeyboardAvoidance.call(this, false)
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
      base.onShow.call(this)
      if (needsDeletionRefresh && this._projectLoadRevision === loadRevisionBeforeShow && this.projectId) {
        this.refreshProjectWiring()
      }
      this.syncUnloadWarning()
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
      base.onUnload.call(this)
    },

    onResize() {
      this.updateWorkspaceNavigation()
      this.closeWorkspaceSwipeRow()
      this.cancelWorkspaceSwipeGesture()
      this._workspaceScrollGesture = null
      if (!this.data.editorVisible && !this.data.batchVisible) this.updateFormViewportBaseline()
    },

    resolveWorkspaceTheme(explicitTheme) {
      const valid = (value) => value === 'dark' || value === 'light'
      if (valid(explicitTheme)) return explicitTheme
      if (typeof wx !== 'undefined') {
        for (const method of ['getAppBaseInfo', 'getSystemInfoSync']) {
          try {
            const info = typeof wx[method] === 'function' ? wx[method]() : null
            if (info && valid(info.theme)) return info.theme
          } catch (error) {}
        }
      }
      try {
        const app = typeof getApp === 'function' ? getApp() : null
        if (app && app.globalData && valid(app.globalData.theme)) return app.globalData.theme
      } catch (error) {}
      return valid(this._workspaceTheme) ? this._workspaceTheme : 'light'
    },

    applyWorkspaceNavigationTheme(theme) {
      if (this._destroyed) return
      const resolvedTheme = this.resolveWorkspaceTheme(theme)
      const dark = resolvedTheme === 'dark'
      this._workspaceTheme = resolvedTheme
      const solid = dark ? '#121212' : '#ffffff'
      const faded = dark ? 'rgba(18,18,18,.7)' : 'rgba(255,255,255,.7)'
      // Native picker masks use two half-height background layers. The middle
      // indicator stays transparent so neither overlay covers the selected text.
      this.setData({
        projectWheelMaskStyle: `background-image:linear-gradient(180deg,${solid},${faded}),linear-gradient(180deg,${faded},${solid});background-position:top,bottom;background-repeat:no-repeat;`,
        projectWheelIndicatorStyle: `box-sizing:border-box;height:${this.data.projectWheelRowHeight}px;background-color:transparent;opacity:1;border-top:1px solid ${dark ? '#34363a' : '#dee4eb'};border-bottom:1px solid ${dark ? '#34363a' : '#dee4eb'};`,
      })
      if (typeof wx !== 'undefined' && typeof wx.setNavigationBarColor === 'function') {
        wx.setNavigationBarColor({ frontColor: dark ? '#ffffff' : '#000000', backgroundColor: dark ? '#000000' : '#ffffff' })
      }
    },

    updateWorkspaceNavigation() {
      let info = {}
      let fallback = {}
      let menu = null
      if (typeof wx !== 'undefined') {
        try { if (typeof wx.getSystemInfoSync === 'function') fallback = wx.getSystemInfoSync() || {} } catch (error) {}
        try { if (typeof wx.getWindowInfo === 'function') info = wx.getWindowInfo() || {} } catch (error) {}
        try { if (typeof wx.getMenuButtonBoundingClientRect === 'function') menu = wx.getMenuButtonBoundingClientRect() } catch (error) {}
      }
      const width = Number(info.windowWidth || info.screenWidth || fallback.windowWidth || fallback.screenWidth) || 390
      const height = Number(info.windowHeight || fallback.windowHeight) || 800
      const statusHeight = Math.max(0, Number(info.statusBarHeight || fallback.statusBarHeight || info.safeArea && info.safeArea.top || fallback.safeArea && fallback.safeArea.top) || 0)
      const validMenu = menu && [menu.left, menu.top, menu.bottom].every((value) => Number.isFinite(Number(value)))
        && Number(menu.left) > width / 2 && Number(menu.left) < width && Number(menu.bottom) > Number(menu.top)
      const menuLeft = validMenu ? Number(menu.left) : width - 104
      const rowHeight = validMenu ? Math.max(44, Number(menu.bottom) - statusHeight + 4) : 44
      const controlTop = Math.round(statusHeight + (rowHeight - 44) / 2)
      const shareLeft = Math.max(48, menuLeft - 8 - 44)
      const navigationShareBelow = !validMenu || shareLeft < width / 2 + 60 + 8
      const safeArea = info.safeArea || fallback.safeArea || {}
      const screenHeight = Number(info.screenHeight || fallback.screenHeight) || height
      const safeBottom = Math.min(60, Math.max(0, screenHeight - (Number(safeArea.bottom) || screenHeight)))
      const row = height < 740 ? 44 : 48
      const wheelChromeHeight = Math.ceil(49 + 64 * width / 750) + 1
      const sheetHeight = Math.min(height, Math.max(Math.round(height * 0.45), wheelChromeHeight + safeBottom + row))
      const wheelHeight = Math.max(1, Math.min(row * 5, sheetHeight - wheelChromeHeight - safeBottom))
      this.setData({
        navigationStyle: `height:${statusHeight + rowHeight}px;min-height:${statusHeight + rowHeight}px;`,
        navigationControlStyle: `top:${controlTop}px;`, navigationShareStyle: `top:${controlTop}px;left:${shareLeft}px;`, navigationShareBelow,
        projectWheelSheetStyle: `height:${sheetHeight}px;min-height:0;max-height:none;`, projectWheelHeight: wheelHeight, projectWheelRowHeight: row,
      })
      this.applyWorkspaceNavigationTheme()
    },

    requestPageBack() {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'back', data: {} })
        return
      }
      if (this.data.saving || this.data.projectCreating) return
      if (this._workspaceOpenSwipe) { this.closeWorkspaceSwipeRow(); return }
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      if (this.data.continuousVisible) { this.closeContinuous(); return }
      if (this.data.reportPreviewVisible) { this.closeReportPreview(); return }
      if (this.data.detailVisible) { this.closeLineDetails(); return }
      if (this.data.deviceEditorVisible) { this.requestCloseDeviceEditor(); return }
      if (this.data.editorVisible) { this.requestCloseEditor(); return }
      if (this.data.newProjectVisible) { this.closeNewProject(); return }
      if (this.data.projectPickerVisible) { this.cancelProjectPicker(); return }
      if (typeof wx !== 'undefined' && typeof wx.navigateBack === 'function') wx.navigateBack({
        fail: () => { if (typeof wx.switchTab === 'function') wx.switchTab({ url: '/pages/tools/tools' }) },
      })
    },

    applyLoadResult(result, request) {
      const ownsCurrentRequest = Boolean(request)
        && !this._destroyed
        && request.projectId === this.projectId
        && request.revision === this._projectLoadRevision
        && this.projectId === (this._workspaceViewPreference && this._workspaceViewPreference.projectId)
      const accepted = base.applyLoadResult.call(this, result, request)
      if (accepted) {
        if (this._inlineRename && !this.inlineRenameContextCurrent(this._inlineRename)) {
          this.clearInlineRename(this._inlineRename, { invalidated: true })
        }
        if (this._workspaceResumeMode === 'validating') this._workspaceResumeMode = 'resumed'
        this.refreshWorkspace()
        if (this.data.project && this.data.project.id === this.projectId) {
          writeWorkspaceViewPreference(this.projectId, this.data.workspaceTab)
        }
      } else if (ownsCurrentRequest && this._workspaceResumeMode === 'validating') {
        if (this.data.canRetry) {
          this._workspaceResumeMode = 'storage-error'
        } else this.finishMissingWorkspaceResume()
      } else if (!this._destroyed && !this.data.project) this.setData({ devices: [], groups: [], deviceCount: 0 })
      return accepted
    },

    refreshWorkspace(onRendered) {
      const profilingEnabled = isPerformanceMeasurementEnabled()
      const finishRefresh = profilingEnabled ? startMeasurement('D1.workspace.refresh-to-callback') : null
      const workspace = buildWorkspace(this._schedule)
      workspace.lines.forEach((line) => { line.circleNumeric = /^\d{1,4}$/.test(line.circleLabel) })
      const query = text(this.data.searchText).trim().toLocaleLowerCase()
      const openSwipeKey = this._workspaceOpenSwipe && this._workspaceOpenSwipe.key
      const groups = workspace.groups.map((group, groupIndex) => ({
        ...group,
        collapsed: this._collapsedGroups.has(group.key),
        groupIndex,
        lines: group.lines.filter((line) => !query || [line.code, line.fromDeviceName, line.toDeviceName, line.fromPort, line.toPort]
          .some((value) => text(value).toLocaleLowerCase().includes(query)))
          .map((line, lineIndex) => ({
            ...line,
            lineIndex,
            swipeKey: `line:${line.id}`,
            swipeOpen: openSwipeKey === `line:${line.id}`,
            swipeOffset: openSwipeKey === `line:${line.id}` ? this._workspaceOpenSwipe.offset : 0,
          })),
      })).filter((group) => group.lines.length).map((group, groupIndex) => ({ ...group, groupIndex }))
      const devices = workspace.devices.filter((device) => !query || [device.name, device.typeLabel]
        .some((value) => text(value).toLocaleLowerCase().includes(query)))
        .map((device, deviceIndex) => ({
          ...device,
          deviceIndex,
          swipeKey: `device:${device.id}`,
          swipeOpen: openSwipeKey === `device:${device.id}`,
          swipeOffset: openSwipeKey === `device:${device.id}` ? this._workspaceOpenSwipe.offset : 0,
        }))
      this.addWorkspaceRetiringRow(devices, groups)
      this._workspace = workspace
      const sourceChoices = endpointChoices('from', this.data.draft, workspace.devices)
      const destinationChoices = endpointChoices('to', this.data.draft, workspace.devices)
      const retiring = this._workspaceRetiringRow
      const retiringGhostRendered = Boolean(retiring && retiring.projectId === this.projectId && (retiring.type === 'device'
        ? devices.some((device) => device.id === retiring.item.id && device.retiring)
        : retiring.type === 'line' && groups.some((group) => group.key === retiring.group.key
          && (group.retiring || group.lines.some((line) => line.id === retiring.item.id && line.retiring)))))
      const retiringPhaseAtRender = retiring && retiring.phase
      const retiringTokenAtRender = retiring && retiring.token
      const payload = { devices, groups, deviceCount: workspace.devices.length, scheduleRevision: this._schedule.revision,
        deviceChoices: sourceChoices, fromDeviceChoices: sourceChoices, toDeviceChoices: destinationChoices,
        fromDeviceIndex: resolveEndpointChoiceIndex(sourceChoices, 'from', this.data.draft),
        toDeviceIndex: resolveEndpointChoiceIndex(destinationChoices, 'to', this.data.draft) }
      const payloadMeasurement = profilingEnabled ? measureJsonPayloadBytes('D1.workspace.setData-payload', payload) : null
      const finishSetData = profilingEnabled ? startMeasurement('D1.workspace.setData-callback') : null
      const sameProjectReturnFinish = profilingEnabled ? this._d1SameProjectReturnFinish : null
      const onRenderedCallback = () => {
        if (finishSetData) finishSetData({ status: 1, payloadBytes: payloadMeasurement ? payloadMeasurement.bytes : 0,
          lineCount: workspace.lines.length, deviceCount: workspace.devices.length })
        if (finishRefresh) finishRefresh({ status: 1, lineCount: workspace.lines.length, deviceCount: workspace.devices.length })
        if (sameProjectReturnFinish && this._d1SameProjectReturnFinish === sameProjectReturnFinish) {
          this._d1SameProjectReturnFinish = null
          sameProjectReturnFinish({ status: 1, lineCount: workspace.lines.length, deviceCount: workspace.devices.length })
        }
        if (typeof onRendered === 'function') onRendered()
        if (retiringGhostRendered && !this._destroyed && !this._hidden && this._workspaceRetiringRow
          && this._workspaceRetiringRow.token === retiringTokenAtRender && retiringTokenAtRender === this._workspaceRemovalToken) {
          this.traceWorkspaceInteraction('delete-render', {
            control: retiring.type === 'device' ? 'delete-device' : 'delete-line',
            phase: retiringPhaseAtRender, rendered: true,
          })
          this.scheduleWorkspaceRowExitAfterRender(retiring.token)
        }
      }
      this.setData(payload, profilingEnabled ? () => onRenderedCallback() : onRenderedCallback)
    },

    scheduleWorkspaceRowExitAfterRender(token) {
      const retiring = this._workspaceRetiringRow
      if (this._destroyed || this._hidden || !retiring || retiring.token !== token || retiring.phase !== 'enter'
        || retiring.exitScheduled || retiring.projectId !== this.projectId) return
      retiring.exitScheduled = true
      const timer = setTimeout(() => {
        if (this._destroyed || this._hidden || token !== this._workspaceRemovalToken || !this._workspaceRetiringRow
          || this._workspaceRetiringRow.token !== token || this._workspaceRetiringRow.phase !== 'enter'
          || this._workspaceRetiringRow.projectId !== this.projectId) return
        this._workspaceRemovalTimers = (this._workspaceRemovalTimers || []).filter((value) => value !== timer)
        this._workspaceRetiringRow.phase = 'exit'
        const current = this._workspaceRetiringRow
        this.setData({ workspaceRetiringRow: { type: current.type, id: current.item.id, phase: 'exit' } })
        this.refreshWorkspace(() => this.scheduleWorkspaceRowCleanupAfterRender(token))
      }, WORKSPACE_ROW_ENTER_MS)
      this._workspaceRemovalTimers.push(timer)
    },

    scheduleWorkspaceRowCleanupAfterRender(token) {
      const retiring = this._workspaceRetiringRow
      if (this._destroyed || this._hidden || !retiring || retiring.token !== token || retiring.phase !== 'exit'
        || retiring.projectId !== this.projectId) return
      const timer = setTimeout(() => {
        if (this._destroyed || this._hidden || token !== this._workspaceRemovalToken || !this._workspaceRetiringRow
          || this._workspaceRetiringRow.token !== token || this._workspaceRetiringRow.phase !== 'exit'
          || this._workspaceRetiringRow.projectId !== this.projectId) return
        this._workspaceRemovalTimers = (this._workspaceRemovalTimers || []).filter((value) => value !== timer)
        this._workspaceRetiringRow = null
        this.setData({ workspaceRetiringRow: null })
        this.refreshWorkspace()
      }, WORKSPACE_ROW_EXIT_CLEANUP_MS)
      this._workspaceRemovalTimers.push(timer)
    },

    addWorkspaceRetiringRow(devices, groups) {
      const retiring = this._workspaceRetiringRow
      if (!retiring || retiring.projectId !== this.projectId) return
      const phase = retiring.phase || 'enter'
      if (retiring.type === 'device') {
        if (devices.some((device) => device.id === retiring.item.id)) return
        const ghost = { ...retiring.item, retiring: true, removalPhase: phase, swipeOpen: false, swipeOffset: 0 }
        devices.splice(Math.min(retiring.index, devices.length), 0, ghost)
        return
      }
      if (retiring.type !== 'line') return
      const group = groups.find((item) => item.key === retiring.group.key)
      const targetGroup = group || {
        ...retiring.group,
        collapsed: false,
        groupIndex: groups.length,
        retiring: true,
        removalPhase: phase,
        lines: [],
      }
      if (!group) groups.splice(Math.min(retiring.groupIndex, groups.length), 0, targetGroup)
      if (targetGroup.lines.some((line) => line.id === retiring.item.id)) return
      targetGroup.lines.splice(Math.min(retiring.index, targetGroup.lines.length), 0, {
        ...retiring.item, retiring: true, removalPhase: phase, swipeOpen: false, swipeOffset: 0,
      })
      targetGroup.lineCount = targetGroup.lines.length
    },

    clearWorkspaceRetiringRow() {
      if (!this._workspaceRetiringRow) return
      this._workspaceRetiringRow = null
      this.cancelWorkspaceRemovalTimers()
      if (this._workspace && !this._destroyed && this.data.project) this.refreshWorkspace()
      this.setData({ workspaceRetiringRow: null })
    },

    beginWorkspaceRowRemoval(snapshot) {
      const current = snapshot.row
      if (!current || (current.type !== 'device' && current.type !== 'line')) return
      this.cancelWorkspaceRemovalTimers()
      const token = ++this._workspaceRemovalToken
      this._workspaceRetiringRow = { ...current, projectId: snapshot.projectId, phase: 'enter', token }
      this.setData({ workspaceRetiringRow: { type: current.type, id: current.item.id, phase: 'enter' } })
      this.refreshWorkspace()
    },

    cancelWorkspaceRemovalTimers() {
      (this._workspaceRemovalTimers || []).forEach((timer) => clearTimeout(timer))
      this._workspaceRemovalTimers = []
      this._workspaceRemovalToken = (this._workspaceRemovalToken || 0) + 1
    },

    onWorkspaceTab(event) {
      const tab = dataset(event).tab
      if ((tab !== 'devices' && tab !== 'lines') || tab === this.data.workspaceTab) return
      if (this._inlineRename) {
        if (!this.queueInlineRenameAction({ kind: 'tab', data: { tab } })) notify('项目已更新，请重新操作')
        return
      }
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      this.setData({ workspaceTab: tab })
      if (this.data.project && this.data.project.id === this.projectId) writeWorkspaceViewPreference(this.projectId, tab)
    },

    applySearch(event) {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'search-confirm', data: { value: inputValue(event) } })
        return
      }
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      base.applySearch.call(this, event)
      this.refreshWorkspace()
    },

    onSearchInput(event) {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'search', data: { value: inputValue(event) } })
        return
      }
      const profilingEnabled = isPerformanceMeasurementEnabled()
      const finishSearchInput = profilingEnabled ? startMeasurement('D1.workspace.search-to-setData-callback', {
        lineCount: this._schedule && this._schedule.lines ? this._schedule.lines.length : 0,
      }) : null
      // Retain the original cancellable search revision for project transitions.
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      base.onSearchInput.call(this, event)
      if (finishSearchInput) this.refreshWorkspace(() => finishSearchInput({ status: 1 }))
      else this.refreshWorkspace()
    },

    clearSearch() {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'clear-search', data: {} })
        return
      }
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      base.clearSearch.call(this)
      this.refreshWorkspace()
    },

    toggleGroup(event) {
      const key = dataset(event).key
      if (this.consumeWorkspaceSuppressedTouch(event, `group:${text(key)}`)) return
      if (!key) return
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      if (this._collapsedGroups.has(key)) this._collapsedGroups.delete(key)
      else this._collapsedGroups.add(key)
      this.refreshWorkspace()
    },

    onLineTouchStart(event) {
      this.clearWorkspaceSuppressedTouchForStart(event)
      const point = firstTouch(event)
      this._workspaceGroupGesture = point ? {
        key: text(dataset(event).key), tapKey: `group:${text(dataset(event).key)}`, identifier: touchIdentifier(point),
        x: Number(point.clientX), y: Number(point.clientY), moved: false,
      } : null
    },

    onLineTouchMove(event) {
      const point = firstTouch(event)
      const gesture = this._workspaceGroupGesture
      if (point && gesture && Math.max(Math.abs(Number(point.clientX) - gesture.x), Math.abs(Number(point.clientY) - gesture.y)) > 6) gesture.moved = true
    },

    onLineTouchEnd(event) {
      if (this._workspaceGroupGesture && this._workspaceGroupGesture.moved) this.rememberWorkspaceSuppressedTouch(event, this._workspaceGroupGesture.tapKey)
      this._workspaceGroupGesture = null
    },
    onLineTouchCancel(event) {
      const gesture = this._workspaceGroupGesture
      if (!gesture) return
      const point = firstTouch(event, 'changedTouches') || firstTouch(event)
      const identifier = touchIdentifier(point)
      if (identifier && gesture.identifier && identifier !== gesture.identifier) return
      if (gesture.identifier && this._workspaceSuppressedTouches) delete this._workspaceSuppressedTouches[gesture.identifier]
      this._workspaceSuppressedTapTarget = null
      this._workspaceGroupGesture = null
    },
    onPortCellScroll() {},

    onLineTap(event) {
      const lineId = text(dataset(event).id)
      if (this.consumeWorkspaceSuppressedTouch(event, `line:${lineId}`) || this.data.saving || datasetBoolean(dataset(event).retiring)) return
      if (this._workspaceOpenSwipe && this._workspaceOpenSwipe.key === `line:${lineId}`) {
        this.closeWorkspaceSwipeRow()
        return
      }
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      const line = (this._workspace || buildWorkspace(this._schedule)).lines.find((item) => item.id === lineId)
      if (!line) return
      this.invalidateExport(false)
      this.beginWorkspaceOverlay('lineDetails', { detailVisible: true, detailLine: line })
    },

    closeLineDetails(onFinished) {
      this.endWorkspaceOverlay('lineDetails', () => {
        this.setData({ detailLine: null })
        if (typeof onFinished === 'function') onFinished()
      }, { detailVisible: false })
    },

    editDetailLine() {
      const id = this.data.detailLine && this.data.detailLine.id
      if (!id || !this.data.project || !this._schedule) return
      const intent = this.nextWorkspaceTransitionRevision()
      const context = { projectId: String(this.projectId || ''), revision: this._schedule.revision, loadRevision: this._projectLoadRevision }
      this.closeLineDetails(() => {
        if (this._destroyed || intent !== this._workspaceTransitionRevision
          || String(this.projectId || '') !== context.projectId
          || !this.data.project || String(this.data.project.id) !== context.projectId
          || !this._schedule || this._schedule.revision !== context.revision
          || this._projectLoadRevision !== context.loadRevision
          || this.data.editorVisible || this.data.deviceEditorVisible || this.data.projectPickerVisible
          || this.data.newProjectVisible || this.data.reportPreviewVisible) return
        this.editLine({ currentTarget: { dataset: { id } } })
      })
    },

    guardWorkspaceTransition(proceed) {
      if (this.data.saving || this.data.projectCreating) return
      const intent = this.nextWorkspaceTransitionRevision()
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      const dirty = this.data.deviceEditorVisible ? this.hasUnsavedDeviceDraft()
        : this.data.editorVisible ? this.hasUnsavedDraft() : false
      const closeAndProceed = () => {
        if (this._destroyed || intent !== this._workspaceTransitionRevision) return
        const closing = Object.keys(this.data.workspaceOverlayPhases || {}).filter((name) =>
          this.workspaceOverlayIsVisible(name) || this.data.workspaceOverlayPhases[name])
        if (!closing.length) { proceed(); return }
        const changes = {}
        if (closing.includes('projectPicker')) { changes.projectPickerVisible = false; changes.projectPickerLoading = false }
        if (closing.includes('newProject')) changes.newProjectVisible = false
        if (closing.includes('deviceEditor')) { changes.deviceEditorVisible = false; changes.batchVisible = false }
        if (closing.includes('lineEditor')) { changes.editorVisible = false; changes.continuousVisible = false }
        if (closing.includes('lineDetails')) changes.detailVisible = false
        if (closing.includes('report')) changes.reportPreviewVisible = false
        if (closing.includes('lineEditor') || closing.includes('deviceEditor')) base.resetFormKeyboardAvoidance.call(this, false)
        this.endWorkspaceOverlays(closing, changes, () => {
          this.cleanupWorkspaceOverlayContents(closing)
          if (intent === this._workspaceTransitionRevision && !this._destroyed) proceed()
        })
        this.syncUnloadWarning()
      }
      if (!dirty) { closeAndProceed(); return }
      wx.showModal({ title: '\u653e\u5f03\u672a\u4fdd\u5b58\u7684\u4fee\u6539\uff1f', content: '\u5f53\u524d\u586b\u5199\u7684\u5185\u5bb9\u4e0d\u4f1a\u4fdd\u5b58\u3002',
        confirmText: '\u653e\u5f03\u4fee\u6539', confirmColor: '#d70015',
        success: ({ confirm }) => { if (confirm && !this._destroyed && intent === this._workspaceTransitionRevision) closeAndProceed() } })
    },

    requestProjectPicker() {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'picker', data: {} })
        return
      }
      this._workspaceIgnoreInitialActive = true
      this._workspaceResumeRevision += 1
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      if (this.workspaceOnlyOverlayClosing('projectPicker')) { this.openProjectPicker(); return }
      this.guardWorkspaceTransition(() => this.openProjectPicker())
    },

    openProjectPicker() {
      if (this._destroyed) return
      this.nextWorkspaceTransitionRevision()
      this._workspaceIgnoreInitialActive = true
      this._workspaceResumeRevision += 1
      this.invalidateExport(false)
      const revision = ++this._projectPickerRevision
      this.beginWorkspaceOverlay('projectPicker', { projectPickerVisible: true, projectPickerLoading: true, projectPickerError: '' })
      const finish = (value) => {
        if (this._destroyed || revision !== this._projectPickerRevision || !this.data.projectPickerVisible) return
        if (!Array.isArray(value)) {
          this.setData({ projectPickerLoading: false, projectPickerProjects: [], projectPickerError: '读取项目列表失败，请重试。' })
          return
        }
        const projects = value.filter((item) => item && item.id && item.name).map((item) => ({ id: text(item.id), name: text(item.name) }))
        this.setData({ projectPickerLoading: false, projectPickerProjects: projects, projectPickerError: '' })
        this.syncProjectWheel(projects)
      }
      try {
        const result = getProjects()
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish(null))
        else finish(result)
      } catch (error) { finish(null) }
    },

    cancelProjectPicker(onFinished) {
      if (this.data.projectCreating) return
      this.nextWorkspaceTransitionRevision()
      this._projectPickerRevision += 1
      this._workspaceIgnoreInitialActive = true
      const selectionRequired = !this.projectId
      this.endWorkspaceOverlay('projectPicker', () => {
        this.cleanupWorkspaceOverlayContents(['projectPicker'])
        if (typeof onFinished === 'function') onFinished()
      }, { projectPickerVisible: false, projectPickerLoading: false, selectionRequired })
    },

    syncProjectWheel(projects = this.data.projectPickerProjects) {
      const index = Math.max(0, projects.findIndex((project) => project.id === this.projectId))
      this.setData({ wheelProjectIndex: [index], pendingProjectId: projects[index] ? projects[index].id : '' })
    },

    onProjectWheelChange(event) {
      if (this.data.projectCreating || this.data.saving) return
      const index = Number(event.detail && event.detail.value && event.detail.value[0])
      const project = this.data.projectPickerProjects[index]
      if (!Number.isInteger(index) || !project) return
      this.setData({ wheelProjectIndex: [index], pendingProjectId: project.id })
    },

    selectProject(event) {
      // Legacy callers may set a candidate; only the explicit Done action enters it.
      const index = this.data.projectPickerProjects.findIndex((project) => project.id === text(dataset(event).id))
      if (index >= 0) this.onProjectWheelChange({ detail: { value: [index] } })
    },

    confirmProjectPicker() {
      const projects = this.data.projectPickerProjects
      const project = projects[this.data.wheelProjectIndex[0]]
      if (!project || this.data.projectPickerLoading || this.data.projectCreating || this.data.saving) return
      this.enterProject(project.id)
    },

    enterProject(projectId, allowWithoutPicker = false) {
      if (!projectId || this._destroyed || this.data.projectCreating || this.data.saving
        || this.data.editorVisible || this.data.deviceEditorVisible
        || (!this.data.projectPickerVisible && !allowWithoutPicker)) return
      this._workspaceResumeRevision += 1
      this._workspaceResumeMode = 'manual'
      this._workspaceIgnoreInitialActive = true
      this.invalidateWorkspaceDeletion()
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      this._collapsedGroups.clear()
      const retainedNewProjectName = this.data.newProjectVisible
        || this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.newProject === 'closing'
        ? this.data.projectPickerName : ''
      if (this.data.projectPickerVisible) {
        this.endWorkspaceOverlay('projectPicker', () => this.cleanupWorkspaceOverlayContents(['projectPicker']), {
          projectPickerVisible: false, projectPickerLoading: false, selectionRequired: !this.projectId,
        })
      }
      // The base entry routine requires the picker flag. Keep this compatibility flag
      // synchronous and unrendered; the picker has already entered its atomic closing phase.
      this.data.projectPickerVisible = true
      base.enterProject.call(this, projectId)
      this.data.projectPickerVisible = false
      if (retainedNewProjectName && (this.data.newProjectVisible
        || this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.newProject === 'closing')) {
        this.setData({ projectPickerName: retainedNewProjectName })
      }
      if (this.projectId === projectId && this.data.project && this.data.project.id === projectId) {
        writeWorkspaceViewPreference(this.projectId, this.data.workspaceTab)
      }
    },

    requestNewProject(event) {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'new-project', data: dataset(event) })
        return
      }
      this._workspaceIgnoreInitialActive = true
      this._workspaceResumeRevision += 1
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      if (this.workspaceOnlyOverlayClosing('newProject')) {
        this.nextWorkspaceTransitionRevision()
        this.beginWorkspaceOverlay('newProject', { newProjectVisible: true })
        return
      }
      this.guardWorkspaceTransition(() => {
        this.invalidateExport(false)
        this.beginWorkspaceOverlay('newProject', {
          newProjectVisible: true, projectPickerName: '', projectPickerError: '', projectCreating: false,
        })
      })
    },

    closeNewProject() {
      if (this.data.projectCreating) return
      this.nextWorkspaceTransitionRevision()
      this.endWorkspaceOverlay('newProject', () => this.cleanupWorkspaceOverlayContents(['newProject']), {
        newProjectVisible: false,
      })
    },

    createAndOpenProject() {
      if (this.data.projectCreating || this.data.saving || this.data.editorVisible || this.data.deviceEditorVisible) return
      const name = text(this.data.projectPickerName).trim().slice(0, 30)
      if (!name) { this.setData({ projectPickerError: "请输入项目名称。" }); return }
      const projectOverlayEpoch = this._workspaceOverlayEpochs && this._workspaceOverlayEpochs.newProject || 0
      this.setData({ projectCreating: true, projectPickerError: '' })
      const finish = (project) => {
        if (this._destroyed || (this._workspaceOverlayEpochs && this._workspaceOverlayEpochs.newProject || 0) !== projectOverlayEpoch) return
        if (!project || !project.id) {
          this.setData({ projectCreating: false, projectPickerError: "创建项目失败，请重试。" })
          return
        }
        this.endWorkspaceOverlay('newProject', () => this.cleanupWorkspaceOverlayContents(['newProject']), {
          projectCreating: false, newProjectVisible: false,
        })
        this.enterProject(text(project.id), true)
      }
      try {
        const result = createProject(name)
        if (result && typeof result.then === 'function') result.then(finish).catch(() => finish(null))
        else finish(result)
      } catch (error) { finish(null) }
    },

    openDeviceEditor(event) {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'add-device', data: dataset(event) })
        return
      }
      if (!this.data.project || this.data.loading || this.data.saving || this.data.projectCreating) return
      this.invalidateExport(false)
      this._deviceEditorSessionId = (this._deviceEditorSessionId || 0) + 1
      this._deviceDraftNameTouched = false
      const deviceDraft = { type: 'receiver', name: '\u63a5\u6536\u673a', count: '1' }
      this._deviceDraftBaseline = JSON.stringify(deviceDraft)
      this.beginWorkspaceOverlay('deviceEditor', {
        deviceEditorVisible: true, batchVisible: true, deviceEditorMode: 'add', deviceDraft,
        deviceFormError: '', saveError: '', batchError: '', saving: false,
      })
      this.beginFormKeyboardAvoidance('batch')
      this.refreshDeviceNames()
    },

    openNewLine(event) {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'add-line', data: dataset(event) })
        return
      }
      return base.openNewLine.call(this)
    },

    renameDevice(event) {
      if (!this.consumeWorkspaceActionTap(event)) return
      const target = dataset(event)
      if (this._inlineRename) {
        if (!this.queueInlineRenameAction({ kind: 'rename', data: { ...target } })) notify('项目已更新，请重新操作')
        return
      }
      const id = text(target.id || target.deviceId)
      const deviceKey = text(target.deviceKey)
      const targetCurrent = this.isWorkspaceDeletionTargetCurrent(target.projectId, target.revision)
      const busy = Boolean(this.data.loading || this.data.saving || this.data.projectCreating
        || this._workspaceDeletion || this._workspaceDeletionInFlight)
      if (!targetCurrent || busy || !this.workspaceActionTargetPresent(event)) {
        notify(!targetCurrent ? '项目已更新，请重新操作' : busy ? '项目正在处理中，请稍后重试' : '项目已更新，请重新操作')
        return
      }
      const devices = (this._workspace || buildWorkspace(this._schedule)).devices
      const candidates = devices.filter((device) => device.id === id)
      const workspaceDevice = deviceKey
        ? candidates.find((device) => device.key === deviceKey)
        : candidates.length === 1 ? candidates[0] : null
      if (!workspaceDevice) {
        notify(candidates.length > 1 ? '设备标识不明确，请刷新后重试' : '项目已更新，请重新操作')
        return
      }
      const isLegacy = workspaceDevice.legacy === true
      const legacyName = isLegacy ? text(workspaceDevice.name).trim() : ''
      if (isLegacy && (!legacyName || deviceKey === 'legacy:""')) {
        notify('请先为历史线路补全设备名，再重命名')
        return
      }
      const record = isLegacy ? null : (this._schedule.devices || []).find((device) => device.id === id)
      if (!isLegacy && !record) {
        notify('项目已更新，请重新操作')
        return
      }
      const endpointCount = isLegacy ? this._schedule.lines.reduce((count, line) => count
        + Number(line.fromDeviceId === undefined && text(line.fromDevice).trim() === legacyName)
        + Number(line.toDeviceId === undefined && text(line.toDevice).trim() === legacyName), 0) : 0
      if (isLegacy && !endpointCount) {
        notify('项目已更新，请重新操作')
        return
      }
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      const session = {
        id: ++this._inlineRenameSequence,
        projectId: String(this.projectId || ''), revision: Number(this._schedule.revision),
        loadRevision: Number(this._projectLoadRevision), deviceId: id, deviceKey: workspaceDevice.key,
        originalName: text(workspaceDevice.name), legacy: isLegacy,
        legacyEndpointCount: endpointCount, latestValue: text(workspaceDevice.name),
        boundaryValue: undefined, boundaryKind: '', pendingAction: null, phase: 'editing',
      }
      this._inlineRename = session
      this._inlineRenameTouch = null
      this.setData({ inlineRenameKey: session.deviceKey, inlineRenameValue: session.originalName,
        inlineRenameFocus: true, inlineRenameSessionId: session.id })
    },

    saveInlineRename(session, name) {
      if (!this.inlineRenameContextCurrent(session) || session.phase !== 'editing') return false
      const command = session.legacy
        ? { type: 'rename-legacy-device', legacyKey: session.deviceKey, name }
        : { type: 'rename-device', id: session.deviceId, name }
      const preview = applyScheduleChange(this._schedule, command)
      if (!preview || preview.ok !== true) {
        const action = session.pendingAction
        this.clearInlineRename(session)
        notify(preview && preview.error ? String(preview.error) : '无法保存设备名称，请重试')
        if (action) this.runInlineRenameAction(action, session, null)
        return false
      }

      const context = {
        projectId: session.projectId, revision: session.revision, loadRevision: session.loadRevision,
        deviceId: session.deviceId, deviceKey: session.deviceKey, legacy: session.legacy,
        legacyName: session.legacy ? session.originalName : '',
        legacyEndpointCount: session.legacyEndpointCount, requestedName: name, sessionId: session.id,
      }
      session.phase = 'saving'
      session.saveContext = context
      this._inlineRenameSavingOwner = session.id
      this.invalidateExport(true)
      this.setData({ saving: true, inlineRenameFocus: false })
      const refreshLateSave = () => {
        this._workspaceDeleteNeedsRefresh = true
        if (this._inlineRenameSavingOwner === session.id) {
          this._inlineRenameSavingOwner = 0
          if (!this._destroyed) this.setData({ saving: false })
        }
        if (!this._destroyed && !this._hidden && !this.data.saving
          && String(this.projectId || '') === context.projectId
          && this.data.project && String(this.data.project.id) === context.projectId) {
          this._workspaceDeleteNeedsRefresh = false
          this.refreshProjectWiring()
        }
      }
      const owns = () => this._inlineRename === session && !session.invalidated && session.saveContext === context
        && this._inlineRenameSavingOwner === session.id
      const releaseSaving = () => {
        if (this._inlineRenameSavingOwner !== session.id) return false
        this._inlineRenameSavingOwner = 0
        if (!this._destroyed) this.setData({ saving: false })
        return true
      }
      const fail = (message, stale = false) => {
        if (!owns()) { refreshLateSave(); return false }
        releaseSaving()
        if (!this.inlineRenameContextCurrent(session)) {
          this._workspaceDeleteNeedsRefresh = true
          this.clearInlineRename(session, { invalidated: true })
          return false
        }
        const action = session.pendingAction
        session.pendingAction = null
        if (action) {
          this.clearInlineRename(session)
          notify(message || '保存失败，请重试')
          this.runInlineRenameAction(action, session, null)
          return false
        }
        session.phase = 'editing'
        session.boundaryValue = undefined
        session.boundaryKind = ''
        this.setData({ inlineRenameFocus: true })
        notify(message || (stale ? '保存结果已过期，请刷新后重试' : '保存失败，请重试'))
        return false
      }
      const finish = (response) => {
        if (!response || response.ok !== true || !response.schedule) {
          return fail(response && response.error ? String(response.error) : '保存失败，请重试')
        }
        if (!owns()) { refreshLateSave(); return false }
        if (!this.inlineRenameContextCurrent(session)) {
          this._workspaceDeleteNeedsRefresh = true
          releaseSaving()
          this.clearInlineRename(session, { invalidated: true })
          return false
        }
        const resultSchedule = response.schedule
        const resultWorkspace = buildWorkspace(resultSchedule)
        const resultDeviceId = session.legacy ? text(response.deviceIds && response.deviceIds[0]) : session.deviceId
        const convertedEndpointCount = session.legacy && Array.isArray(resultSchedule.lines)
          ? resultSchedule.lines.reduce((count, line) => count
            + Number(line.fromDeviceId === resultDeviceId && line.fromDevice === name)
            + Number(line.toDeviceId === resultDeviceId && line.toDevice === name), 0) : 0
        const lineIdsBefore = (this._schedule.lines || []).map((line) => line.id)
        const lineIdsAfter = (resultSchedule.lines || []).map((line) => line.id)
        const sameLineIds = lineIdsBefore.length === lineIdsAfter.length
          && lineIdsBefore.every((lineId, index) => lineId === lineIdsAfter[index])
        const savedDevice = (resultSchedule.devices || []).find((device) => device.id === resultDeviceId)
        const validResult = response.project && response.project.id === context.projectId
          && Number(resultSchedule.revision) > context.revision && sameLineIds
          && (session.legacy
            ? Boolean(resultDeviceId && !(this._schedule.devices || []).some((device) => device.id === resultDeviceId)
              && savedDevice && savedDevice.type === 'custom' && savedDevice.autoName === false && savedDevice.name === name
              && resultWorkspace && !resultWorkspace.devices.some((device) => device.key === session.deviceKey && device.legacy)
              && convertedEndpointCount === session.legacyEndpointCount)
            : Boolean(savedDevice && savedDevice.name === name && savedDevice.autoName === false))
        if (!validResult) return fail('保存结果无效，请刷新后重试', true)

        const action = session.pendingAction
        session.pendingAction = null
        session.phase = 'done'
        releaseSaving()
        this.clearInlineRename(session)
        this.acceptSavedSchedule(response)
        if (!action) notify(session.legacy ? '历史线路设备已保存为新设备' : '设备已重命名')
        setTimeout(() => {
          if (action) {
            action.expectedRevision = Number(resultSchedule.revision)
            this.runInlineRenameAction(action, session, response, session.legacy ? resultDeviceId : '')
          }
        }, 0)
        return true
      }
      let result
      try { result = saveProjectWiring(context.projectId, command, context.revision) }
      catch (error) { result = { ok: false, error: error && error.message ? error.message : '保存失败，请重试' } }
      if (result && typeof result.then === 'function') result.then(finish).catch((error) => finish({
        ok: false, error: error && error.message ? error.message : '保存失败，请重试',
      }))
      else finish(result)
      return true
    },

    onDeviceType(event) {
      const option = DEVICE_OPTIONS.find((item) => item.id === dataset(event).type)
      if (!option || this.data.saving) return
      const oldOption = DEVICE_OPTIONS.find((item) => item.id === this.data.deviceDraft.type)
      const name = !this._deviceDraftNameTouched && (!this.data.deviceDraft.name || this.data.deviceDraft.name === (oldOption && oldOption.label))
        ? (option.id === 'custom' ? '' : option.label) : this.data.deviceDraft.name
      this.setData({ deviceDraft: { ...this.data.deviceDraft, type: option.id, name } })
      this.refreshDeviceNames()
    },

    onDeviceDraftInput(event) {
      const field = dataset(event).field
      if (!['name', 'count'].includes(field) || this.data.saving) return
      if (field === 'name') this._deviceDraftNameTouched = true
      this.setData({ deviceDraft: { ...this.data.deviceDraft, [field]: inputValue(event) } })
      this.refreshDeviceNames()
    },

    onDeviceCountStep(event) {
      const count = Math.min(32, Math.max(1, (Number(this.data.deviceDraft.count) || 1) + Number(dataset(event).delta || 0)))
      this.onDeviceDraftInput({ currentTarget: { dataset: { field: 'count' } }, detail: { value: text(count) } })
    },

    refreshDeviceNames() {
      const result = deviceNameDraftResult(this.data.deviceDraft, this._deviceDraftNameTouched, this._schedule)
      this.setData({ deviceNamePreview: result.ok ? result.names : [], deviceFormError: result.ok ? '' : result.error, saveError: '' })
      this.syncUnloadWarning()
    },

    hasUnsavedDeviceDraft() { return JSON.stringify(this.data.deviceDraft) !== this._deviceDraftBaseline },

    requestCloseDeviceEditor() {
      if (this.data.saving || !this.data.deviceEditorVisible) return
      const intent = this.nextWorkspaceTransitionRevision()
      const context = {
        projectId: String(this.projectId || ''),
        draft: JSON.stringify(this.data.deviceDraft),
        overlayEpoch: this._workspaceOverlayEpochs && this._workspaceOverlayEpochs.deviceEditor || 0,
      }
      const isCurrent = () => !this._destroyed && intent === this._workspaceTransitionRevision
        && this.data.deviceEditorVisible && String(this.projectId || '') === context.projectId
        && JSON.stringify(this.data.deviceDraft) === context.draft
        && (this._workspaceOverlayEpochs && this._workspaceOverlayEpochs.deviceEditor || 0) === context.overlayEpoch
      if (!this.hasUnsavedDeviceDraft()) { if (isCurrent()) this.closeDeviceEditor(); return }
      wx.showModal({ title: '\u653e\u5f03\u672a\u4fdd\u5b58\u7684\u8bbe\u5907\uff1f', content: '\u5f53\u524d\u8bbe\u5907\u5c1a\u672a\u6dfb\u52a0\u5230\u9879\u76ee\u3002', confirmText: '\u653e\u5f03', confirmColor: '#d70015',
        success: ({ confirm }) => { if (confirm && isCurrent()) this.closeDeviceEditor() } })
    },

    closeDeviceEditor() {
      if (this.data.saving || !this.data.deviceEditorVisible) return
      this.nextWorkspaceTransitionRevision()
      this._deviceEditorSessionId = (this._deviceEditorSessionId || 0) + 1
      this._deviceDraftNameTouched = false
      base.resetFormKeyboardAvoidance.call(this, false)
      this.endWorkspaceOverlay('deviceEditor', () => {
        this.cleanupWorkspaceOverlayContents(['deviceEditor'])
        this.setData({ deviceEditorMode: 'add' })
      }, {
        deviceEditorVisible: false, batchVisible: false,
      })
      this.syncUnloadWarning()
    },

    saveDevices() {
      if (this.data.saving || !this.data.deviceEditorVisible) return
      const result = deviceNameDraftResult(this.data.deviceDraft, this._deviceDraftNameTouched, this._schedule)
      if (!result.ok) { this.setData({ deviceFormError: result.error }); return }
      const type = this.data.deviceDraft.type
      const typeLabel = DEVICE_OPTIONS.find((option) => option.id === type)?.label || ''
      const automatic = type !== 'custom' && !this._deviceDraftNameTouched
      const devices = result.names.map((name) => ({ type, name: automatic ? typeLabel : name, autoName: automatic }))
      this.saveCommand({ type: 'add-devices', devices }, (saved) => {
        this.closeDeviceEditor()
        this.acceptSavedSchedule(saved)
        notify(`已添加 ${result.names.length} 台设备`)
      })
    },

    connectDevice(event) {
      if (!this.consumeWorkspaceActionTap(event)) return
      const target = dataset(event)
      if (this._inlineRename) {
        if (!this.queueInlineRenameAction({ kind: 'connect', data: { ...target } })) notify('项目已更新，请重新操作')
        return
      }
      const targetCurrent = this.isWorkspaceDeletionTargetCurrent(target.projectId, target.revision)
      const busy = Boolean(this.data.loading || this.data.saving || this.data.projectCreating)
      const targetPresent = this.workspaceActionTargetPresent(event)
      this.traceWorkspaceInteraction('connect-guard', {
        control: 'connect', targetPresent,
        projectMatch: Boolean(target.projectId && String(target.projectId) === String(this.projectId)
          && this.data.project && String(this.data.project.id) === String(target.projectId)),
        revisionMatch: Boolean(this._schedule && Number(target.revision) === Number(this._schedule.revision)),
        busy, accepted: targetCurrent && !busy && targetPresent,
        reason: !targetCurrent ? 'stale-target' : busy ? 'busy' : !targetPresent ? 'target-missing' : 'ready',
      })
      if (!targetCurrent) {
        notify('项目已更新，请重新操作')
        return
      }
      if (busy) {
        notify('项目正在处理中，请稍后重试')
        return
      }
      this.closeWorkspaceSwipeRow()
      const candidates = (this._workspace || buildWorkspace(this._schedule)).devices.filter((item) => item.id === text(target.id))
      const deviceKey = text(target.deviceKey)
      const device = deviceKey ? candidates.find((item) => item.key === deviceKey) : candidates.length === 1 ? candidates[0] : null
      if (!device) {
        notify('项目已更新，请重新操作')
        return
      }
      this.openNewLine()
      this.assignEndpoint('from', device)
      this.traceWorkspaceInteraction('connect-open', {
        control: 'connect', accepted: Boolean(this.data.editorVisible || this.data.continuousVisible),
        reason: this.data.editorVisible || this.data.continuousVisible ? 'editor-opened' : 'editor-not-open', targetPresent: true,
      })
    },

    makeDefaultDraft() {
      return { ...base.makeDefaultDraft.call(this), spec: '', connectorA: '', connectorB: '' }
    },

    makePair(pair = {}) {
      this._draftPairSerial = (this._draftPairSerial || 0) + 1
      return { key: `pair-${this._draftPairSerial}`, fromPort: text(pair.fromPort), toPort: text(pair.toPort), lengthText: text(pair.lengthText) }
    },

    endpointChoiceIndex(side, draft) {
      const choices = endpointChoices(side, draft, this._workspace && this._workspace.devices || this.data.devices)
      return resolveEndpointChoiceIndex(choices, side, draft)
    },

    refreshEndpointChoices(draft = this.data.draft) {
      const devices = this._workspace && this._workspace.devices || this.data.devices
      const fromChoices = endpointChoices('from', draft, devices)
      const toChoices = endpointChoices('to', draft, devices)
      this.setData({ deviceChoices: fromChoices, fromDeviceChoices: fromChoices, toDeviceChoices: toChoices,
        fromDeviceIndex: resolveEndpointChoiceIndex(fromChoices, 'from', draft),
        toDeviceIndex: resolveEndpointChoiceIndex(toChoices, 'to', draft) })
    },

    setDraft(draft, options = {}) {
      this.invalidateWorkspaceEditorDelete()
      this._workspaceEditorSessionId = (this._workspaceEditorSessionId || 0) + 1
      this._draftStoredEndpointNames = options.isNew ? null : {
        fromDeviceId: text(draft && draft.fromDeviceId), fromDevice: text(draft && draft.fromDevice),
        toDeviceId: text(draft && draft.toDeviceId), toDevice: text(draft && draft.toDevice),
      }
      const overlayChanges = {
        editorVisible: true, continuousVisible: false, detailVisible: false,
        draft: null, draftPairs: [], pairErrors: [],
      }
      if (this.data.detailVisible || (this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.lineDetails)) {
        this.transitionWorkspaceOverlays(['lineDetails'], 'lineEditor', overlayChanges,
          () => this.cleanupWorkspaceOverlayContents(['lineDetails']))
      } else {
        if (!this.data.workspaceOverlayPhases || this.data.workspaceOverlayPhases.lineDetails !== 'closing') overlayChanges.detailLine = null
        this.beginWorkspaceOverlay('lineEditor', overlayChanges)
      }
      base.setDraft.call(this, draft, options)
      this._draftDefaultSpec = false
      const presentationDraft = { ...this.data.draft }
      const devices = this._workspace && this._workspace.devices || this.data.devices
      if (presentationDraft.fromDeviceId) {
        const source = devices.find((device) => device.id === presentationDraft.fromDeviceId)
        if (source) presentationDraft.fromDevice = source.name
      }
      if (presentationDraft.toDeviceId) {
        const destination = devices.find((device) => device.id === presentationDraft.toDeviceId)
        if (destination) presentationDraft.toDevice = destination.name
      }
      this.setData({ draft: presentationDraft })
      const draftPairs = [this.makePair(presentationDraft)]
      const draftCircleLabel = circleLabel(presentationDraft, this._schedule)
      const fromDeviceChoices = endpointChoices('from', presentationDraft, devices)
      const toDeviceChoices = endpointChoices('to', presentationDraft, devices)
      this.setData({ draftPairs, pairErrors: [], continuousVisible: false,
        deviceChoices: fromDeviceChoices, fromDeviceChoices, toDeviceChoices,
        draftCircleLabel, draftCircleNumeric: /^\d{1,4}$/.test(draftCircleLabel),
        fromDeviceIndex: resolveEndpointChoiceIndex(fromDeviceChoices, 'from', this.data.draft),
        toDeviceIndex: resolveEndpointChoiceIndex(toDeviceChoices, 'to', this.data.draft) })
      this._workspaceDraftBaseline = this.workspaceDraftSignature()
      this.syncUnloadWarning()
    },

    workspaceDraftSignature() { return JSON.stringify({ draft: this.data.draft, pairs: this.data.draftPairs }) },

    hasUnsavedDraft() {
      if (!this.data.draft) return false
      return Boolean(this._draftTouched || this.workspaceDraftSignature() !== this._workspaceDraftBaseline)
    },

    onDraftInput(event) {
      if (this.data.saving) return
      base.onDraftInput.call(this, event)
      const field = dataset(event).field
      if (['fromPort', 'toPort', 'lengthText'].includes(field) && this.data.draftPairs.length) {
        const draftPairs = this.data.draftPairs.map((pair, index) => field === 'lengthText' || !index ? { ...pair, [field]: inputValue(event) } : pair)
        this.setData({ draftPairs })
      }
      this.syncUnloadWarning()
    },

    selectEndpoint(event) {
      const side = dataset(event).side
      if (!['from', 'to'].includes(side) || this.data.saving) return
      const choices = side === 'from' ? this.data.fromDeviceChoices : this.data.toDeviceChoices
      const index = Number(event.detail && event.detail.value)
      const device = Number.isInteger(index) ? choices[index] : null
      if (!device || !device.id) return
      this.assignEndpoint(side, device)
    },

    assignEndpoint(side, device) {
      if (!['from', 'to'].includes(side) || !device || !device.id) return
      const draft = { ...this.data.draft, [`${side}Device`]: device.name }
      if (device.legacy) draft[`${side}DeviceId`] = null
      else draft[`${side}DeviceId`] = device.id
      const invalidatedDestination = side === 'from' && Boolean(draft.toDeviceId)
        && draft.toDeviceId === device.id
      const formFieldErrors = { ...this.data.formFieldErrors }
      delete formFieldErrors[`${side}Device`]
      if (invalidatedDestination) {
        draft.toDevice = ''
        delete draft.toDeviceId
        formFieldErrors.toDevice = '\u8bf7\u91cd\u65b0\u9009\u62e9\u4e0d\u540c\u7684\u53bb\u5411\u8bbe\u5907'
      } else if (side === 'from' && draft.toDeviceId) delete formFieldErrors.toDevice
      if (side === 'to' && draft.fromDeviceId && draft.fromDeviceId === device.id) {
        formFieldErrors.toDevice = '\u6765\u6e90\u8bbe\u5907\u548c\u53bb\u5411\u8bbe\u5907\u4e0d\u80fd\u76f8\u540c'
        this.setData({ formFieldErrors, formError: formFieldErrors.toDevice })
        return
      }
      this._draftTouched = true
      const fromDeviceChoices = endpointChoices('from', draft, this._workspace && this._workspace.devices || this.data.devices)
      const toDeviceChoices = endpointChoices('to', draft, this._workspace && this._workspace.devices || this.data.devices)
      const formError = invalidatedDestination ? formFieldErrors.toDevice : ''
      this.setData({ draft, deviceChoices: fromDeviceChoices, fromDeviceChoices, toDeviceChoices,
        fromDeviceIndex: resolveEndpointChoiceIndex(fromDeviceChoices, 'from', draft),
        toDeviceIndex: resolveEndpointChoiceIndex(toDeviceChoices, 'to', draft),
        formFieldErrors, formError, saveError: '' })
      this.syncUnloadWarning()
    },

    onPairInput(event) {
      const { index, field } = dataset(event)
      if (!['fromPort', 'toPort', 'lengthText'].includes(field) || !this.data.draftPairs[Number(index)] || this.data.saving) return
      const draftPairs = this.data.draftPairs.map((pair, position) => position === Number(index) ? { ...pair, [field]: inputValue(event) } : pair)
      this._draftTouched = true
      const draft = Number(index) === 0 ? { ...this.data.draft, [field]: inputValue(event) } : this.data.draft
      const pairErrors = this.data.pairErrors.map((error, position) => position === Number(index) ? { ...error, [field]: false } : error)
      this.setData({ draftPairs, draft, pairErrors, formError: '', saveError: '' })
      this.syncUnloadWarning()
    },

    addDraftPair() {
      if (!this.data.draftIsNew || this.data.saving) return
      if (this.data.draftPairs.length >= 32) { notify('一次最多添加 32 条线路'); return }
      this._draftTouched = true
      this.setData({ draftPairs: [...this.data.draftPairs, this.makePair({ lengthText: this.data.draft.lengthText })], pairErrors: [], formError: '' })
      this.syncUnloadWarning()
    },

    removeDraftPair(event) {
      const index = Number(dataset(event).index)
      if (!this.data.draftIsNew || this.data.draftPairs.length <= 1 || !this.data.draftPairs[index] || this.data.saving) return
      const draftPairs = this.data.draftPairs.filter((pair, position) => index !== position)
      this._draftTouched = true
      this.setData({ draftPairs, draft: { ...this.data.draft, ...draftPairs[0] }, pairErrors: [], formError: '' })
      this.syncUnloadWarning()
    },

    onOptionChange(event) {
      if (this.data.saving) return
      base.onOptionChange.call(this, event)
      this.syncUnloadWarning()
    },

    onCustomConnectorInput(event) {
      if (this.data.saving) return
      base.onCustomConnectorInput.call(this, event)
      this.syncUnloadWarning()
    },

    requestCloseEditor() {
      if (this.data.saving || !this.data.editorVisible || this.data.continuousVisible) return
      const intent = this.nextWorkspaceTransitionRevision()
      const context = this.captureWorkspaceEditorContext()
      const closeIfCurrent = () => {
        if (intent === this._workspaceTransitionRevision && this.isWorkspaceEditorContextCurrent(context)) this.closeEditor()
      }
      if (!this.hasUnsavedDraft()) { closeIfCurrent(); return }
      wx.showModal({ title: '\u653e\u5f03\u672a\u4fdd\u5b58\u4fee\u6539\uff1f', content: '\u5173\u95ed\u540e\uff0c\u672c\u6b21\u586b\u5199\u7684\u7ebf\u8def\u5185\u5bb9\u4e0d\u4f1a\u4fdd\u5b58\u3002',
        confirmText: '\u653e\u5f03\u4fee\u6539', confirmColor: '#d70015',
        success: ({ confirm }) => { if (confirm) closeIfCurrent() } })
    },

    closeEditor() {
      if (!this.data.editorVisible && !(this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.lineEditor)) return
      this.nextWorkspaceTransitionRevision()
      this.invalidateWorkspaceEditorDelete()
      base.resetFormKeyboardAvoidance.call(this, false)
      this._draftTouched = false
      this._draftBaseline = ''
      this._draftStoredEndpointNames = null
      const closing = ['lineEditor']
      if (this.data.continuousVisible || (this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.continuous)) closing.push('continuous')
      this.endWorkspaceOverlays(closing, { editorVisible: false, continuousVisible: false, saving: false }, () =>
        this.cleanupWorkspaceOverlayContents(closing))
      this.syncUnloadWarning()
    },

    openContinuous() {
      if (!this.data.draftIsNew || this.data.saving || !this.data.editorVisible || this.data.continuousVisible) return
      const last = this.data.draftPairs[this.data.draftPairs.length - 1] || {}
      this.beginFormKeyboardAvoidance('editor')
      this.transitionWorkspaceOverlays(['lineEditor'], 'continuous', {
        editorVisible: true, continuousVisible: true,
        continuousDraft: { fromPort: last.fromPort || '', toPort: last.toPort || '', count: '2' },
      })
      this.refreshContinuousPreview()
    },

    onContinuousInput(event) {
      const field = dataset(event).field
      if (!['fromPort', 'toPort', 'count'].includes(field)) return
      this.setData({ continuousDraft: { ...this.data.continuousDraft, [field]: inputValue(event) } })
      this.refreshContinuousPreview()
    },

    onContinuousCountStep(event) {
      const count = Math.min(32, Math.max(1, (Number(this.data.continuousDraft.count) || 1) + Number(dataset(event).delta || 0)))
      this.onContinuousInput({ currentTarget: { dataset: { field: 'count' } }, detail: { value: text(count) } })
    },

    refreshContinuousPreview() {
      const draft = this.data.continuousDraft
      const result = generatePortPairs(draft.fromPort, draft.toPort, draft.count)
      this.setData({ continuousPairs: result.ok ? result.pairs : [], continuousError: result.ok ? '' : result.error })
    },

    closeContinuous() {
      if (!this.data.continuousVisible && !(this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.continuous)) return
      this.nextWorkspaceTransitionRevision()
      this.beginFormKeyboardAvoidance('editor')
      this.transitionWorkspaceOverlays(['continuous'], 'lineEditor', {
        editorVisible: true, continuousVisible: false,
      }, () => this.cleanupWorkspaceOverlayContents(['continuous']))
    },

    fillContinuous() {
      const draft = this.data.continuousDraft
      const result = generatePortPairs(draft.fromPort, draft.toPort, draft.count)
      if (!result.ok) { this.setData({ continuousError: result.error }); return }
      const existing = this.data.draftPairs
      const replaceEmpty = existing.length === 1 && !existing[0].fromPort && !existing[0].toPort
      const retained = replaceEmpty ? [] : existing
      if (retained.length + result.pairs.length > 32) { this.setData({ continuousError: '本次保存最多添加 32 条线路，请减少数量。' }); return }
      const draftPairs = [...retained, ...result.pairs.map((pair) => this.makePair({ ...pair, lengthText: this.data.draft.lengthText }))]
      this._draftTouched = true
      this.setData({ draftPairs, draft: { ...this.data.draft, fromPort: draftPairs[0].fromPort, toPort: draftPairs[0].toPort,
        lengthText: draftPairs[0].lengthText }, pairErrors: [], formError: '', saveError: '' })
      this.closeContinuous()
      this.syncUnloadWarning()
    },

    saveLine() {
      if (!this.data.draft || this.data.saving || this.data.continuousVisible) return
      const draft = this.data.draft
      const pairs = this.data.draftPairs
      const isNew = this.data.draftIsNew
      if (draft.fromDeviceId && draft.fromDeviceId === draft.toDeviceId) {
        const message = '\u6765\u6e90\u8bbe\u5907\u548c\u53bb\u5411\u8bbe\u5907\u4e0d\u80fd\u76f8\u540c\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9'
        this.setData({ formError: message, formFieldErrors: { ...this.data.formFieldErrors, toDevice: message } })
        return
      }
      const missing = endpointFields.filter((field) => field.endsWith('Device') && !text(draft[field]).trim())
      const pairErrors = pairs.map((pair) => ({ fromPort: !text(pair.fromPort).trim(), toPort: !text(pair.toPort).trim() }))
      if (missing.length || pairErrors.some((error) => error.fromPort || error.toPort)) {
        const formFieldErrors = Object.fromEntries(missing.map((field) => [field, '请选择设备']))
        this.setData({ formError: '请选择两端设备，并填写每条线路的两端端口。', formFieldErrors, pairErrors })
        return
      }
      const lines = pairs.map((pair) => {
        const line = { ...draft, fromPort: pair.fromPort, toPort: pair.toPort, lengthText: pair.lengthText }
        const stored = this._draftStoredEndpointNames
        if (!this.data.draftIsNew && stored) {
          if (stored.fromDeviceId && text(line.fromDeviceId) === stored.fromDeviceId) line.fromDevice = stored.fromDevice
          if (stored.toDeviceId && text(line.toDeviceId) === stored.toDeviceId) line.toDevice = stored.toDevice
        }
        delete line.key
        if (this.data.draftIsNew) { delete line.id; delete line.code }
        return line
      })
      const command = this.data.draftIsNew ? { type: 'append-lines', lines } : { type: 'upsert', line: lines[0] }
      const preview = applyScheduleChange(this._schedule, command)
      if (!preview.ok) { this.setData({ formError: preview.error }); return }
      this.saveCommand(command, (result) => {
        const count = lines.length
        this.closeEditor()
        this.acceptSavedSchedule(result)
        notify(isNew ? `已添加 ${count} 条线路` : '线路已保存')
      })
    },

    deleteLine() {
      if (this.data.draftIsNew || !this.data.draft || this.data.saving || !this.data.editorVisible) return
      const snapshot = this.captureWorkspaceEditorContext()
      if (!snapshot || !this.isWorkspaceEditorContextCurrent(snapshot)) {
        notify('项目已更新，请重新操作')
        return
      }
      if (this._workspaceEditorDelete) return
      const token = ++this._workspaceEditorDeleteToken
      snapshot.token = token
      this._workspaceEditorDelete = snapshot
      this.setData({ workspaceEditorDeleting: true })
      const clearPending = () => {
        if (this._workspaceEditorDelete !== snapshot || token !== this._workspaceEditorDeleteToken) return false
        this._workspaceEditorDelete = null
        this.setData({ workspaceEditorDeleting: false })
        return true
      }
      if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') {
        clearPending()
        notify('暂时无法确认删除')
        return
      }
      const label = circleLabel(this.data.draft, this._schedule)
      wx.showModal({
        title: '删除线路？',
        content: `将从本项目布线表中删除 ${label}。`,
        confirmText: '删除',
        confirmColor: '#d70015',
        success: ({ confirm }) => {
          if (!clearPending() || !confirm) return
          if (!this.isWorkspaceEditorContextCurrent(snapshot)) {
            if (!this._destroyed && !this._hidden && this.data.editorVisible) notify('项目已更新，请重新操作')
            return
          }
          this.saveCommand({ type: 'delete', id: snapshot.lineId }, (result) => {
            if (this._destroyed || this.projectId !== snapshot.projectId
              || !this.data.project || this.data.project.id !== snapshot.projectId) return
            const sameEditor = this.isWorkspaceEditorContextCurrent(snapshot, true)
            if (this._hidden) {
              this._workspaceEditorDeleteNeedsRefresh = snapshot
              if (sameEditor) {
                base.resetFormKeyboardAvoidance.call(this, false)
                this.setData({ editorVisible: false, continuousVisible: false, saving: false,
                  draft: null, draftPairs: [], pairErrors: [], formError: '', formFieldErrors: {}, saveError: '',
                  'workspaceOverlayPhases.lineEditor': '', 'workspaceOverlayPhases.continuous': '' })
                this._draftTouched = false
                this._draftBaseline = ''
                this.acceptSavedSchedule(result)
              }
              return
            }
            if (!sameEditor) {
              this._workspaceDeleteNeedsRefresh = true
              return
            }
            this.closeEditor()
            this.acceptSavedSchedule(result)
            notify('线路已删除')
          })
        },
        fail: () => { clearPending() },
      })
    },

    saveCommand(command, onSuccess) {
      return base.saveCommand.call(this, command, (result) => { this.setData({ saving: false }); onSuccess(result) })
    },

    syncUnloadWarning() {
      const dirty = this.data.deviceEditorVisible ? this.hasUnsavedDeviceDraft() : this.data.editorVisible && this.hasUnsavedDraft()
      if (dirty && typeof wx !== 'undefined' && typeof wx.enableAlertBeforeUnload === 'function') {
        wx.enableAlertBeforeUnload({ message: '当前填写的内容尚未保存。' })
      } else this.clearUnloadWarning()
    },

    clearUnloadWarning() {
      if (typeof wx !== 'undefined' && typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload()
    },

    shareProject(event) {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'share', data: dataset(event) })
        return
      }
      this.cancelWorkspaceSwipeGesture()
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      this.generateExport('project')
    },

    invalidateExport(clearImages) {
      const wasRunning = Boolean(this._reportSaveJob)
      this.cancelReportSaveJob()
      const wasPending = Boolean(this._reportPending)
      this._reportRevision = (this._reportRevision || 0) + 1
      this._reportPending = false
      if (wasPending && typeof wx !== 'undefined' && typeof wx.hideLoading === 'function') wx.hideLoading()
      const changes = {
        reportPreviewVisible: false,
        reportSaveRunning: false,
        reportSaveInFlight: Boolean(this._reportSaveInFlight),
      }
      if (!clearImages && (wasRunning || this._reportSaveInFlight)) changes.reportSaveMessage = this.getInactiveReportSaveMessage()
      if (clearImages) {
        this._workspaceReportClearToken = (this._workspaceReportClearToken || 0) + 1
        this._workspaceReportClearPending = true
        this._workspaceReportClearSignature = ''
      }
      const clearToken = this._workspaceReportClearPending ? this._workspaceReportClearToken : 0
      if (clearImages) {
        this._reportSignature = ''
        if (this._reportSavedPages) this._reportSavedPages.clear()
      }
      const reportMounted = Boolean(this.data && (this.data.reportPreviewVisible
        || this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.report))
      if (this.data && !this._destroyed && reportMounted && !this._hidden) {
        this.endWorkspaceOverlay('report', () => {
          if (clearToken) this.finishWorkspaceReportClear(clearToken)
        }, changes)
        return
      }
      if (this.data && !this._destroyed) {
        if (clearToken) {
          this._workspaceReportClearPending = false
          this._workspaceReportClearSignature = ''
        }
        this.setData({ ...changes, ...(clearToken ? this.workspaceReportClearState() : {}) })
      }
    },

    workspaceReportClearState() {
      return {
        reportImages: [], reportImagePath: '', reportSavedPageIndices: [], reportSaveMessage: '',
        reportSaveError: '', reportSaveAllLabel: "全部保存（0张）",
      }
    },

    finishWorkspaceReportClear(token = this._workspaceReportClearToken) {
      if (!token || !this._workspaceReportClearPending || token !== this._workspaceReportClearToken || this._destroyed
        || this.data.reportPreviewVisible || this.data.workspaceOverlayPhases.report) return false
      if (this._workspaceReportClearSignature !== undefined && this._reportSignature !== this._workspaceReportClearSignature) {
        this._workspaceReportClearPending = false
        this._workspaceReportClearSignature = ''
        return false
      }
      this._workspaceReportClearPending = false
      this._workspaceReportClearSignature = ''
      this.setData(this.workspaceReportClearState())
      return true
    },

    showReportPage(index) {
      const item = this.data.reportImages[index]
      if (!item) return
      this._workspaceReportClearToken = (this._workspaceReportClearToken || 0) + 1
      this._workspaceReportClearPending = false
      this._workspaceReportClearSignature = ''
      const changes = {
        reportPageIndex: index,
        reportPageTitle: item.title,
        reportImagePath: item.path,
        reportPreviewVisible: true,
      }
      if (this.data.reportPreviewVisible) this.setData(changes)
      else this.beginWorkspaceOverlay('report', changes)
      this.syncReportSaveView()
    },

    closeReportPreview() {
      this.nextWorkspaceTransitionRevision()
      const wasRunning = Boolean(this._reportSaveJob)
      this.cancelReportSaveJob()
      this.endWorkspaceOverlay('report', () => this.finishWorkspaceReportClear(), {
        reportPreviewVisible: false,
        reportSaveRunning: false,
        reportSaveInFlight: Boolean(this._reportSaveInFlight),
        ...(wasRunning || this._reportSaveInFlight ? { reportSaveMessage: this.getInactiveReportSaveMessage() } : {}),
      })
    },
  }
}

module.exports = { createWorkspaceUI }

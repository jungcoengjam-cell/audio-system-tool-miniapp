const { DEVICE_OPTIONS, CONNECTOR_OPTIONS, applyScheduleChange } = require('../../utils/project-wiring')
const { createProject, getProjectWiring, getProjects, saveProjectWiring } = require('../../utils/records')
const { buildWorkspace, circleLabel, deviceNames, generatePortPairs } = require('./workspace-model')

const endpointFields = ['fromDevice', 'fromPort', 'toDevice', 'toPort']
const VIEW_PREFERENCE_KEY = 'audioTool.projectWiring.view.v1'
const INITIALIZE_ONLY_ROUTE_ID = '__workspace_initialize_only__'
const SWIPE_ACTION_WIDTH = 72
const SWIPE_LOCK_THRESHOLD = 12
const SWIPE_SET_DATA_INTERVAL = 32
const WORKSPACE_OVERLAY_OPEN_MS = 300
const WORKSPACE_OVERLAY_CLOSE_MS = 240
const WORKSPACE_ROW_ENTER_MS = 16
const WORKSPACE_ROW_EXIT_CLEANUP_MS = 240
const connectorOptions = [{ id: '', label: '待补' }, ...CONNECTOR_OPTIONS]
const text = (value) => String(value === undefined || value === null ? '' : value)
const dataset = (event) => event && event.currentTarget && event.currentTarget.dataset || {}
const inputValue = (event) => text(event && event.detail && event.detail.value)
const datasetBoolean = (value) => value === true || value === 1 || value === '1' || value === 'true'
const firstTouch = (event, list = 'touches') => {
  const touches = event && event[list]
  return touches && Number(touches.length) > 0 ? touches[0] : null
}
const touchIdentifier = (touch) => touch && touch.identifier !== undefined && touch.identifier !== null ? String(touch.identifier) : ''
const notify = (title) => { if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') wx.showToast({ title, icon: 'none' }) }

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
      deviceOptions: DEVICE_OPTIONS, deviceChoices: [],
      connectorOptions,
      wheelProjectIndex: [0], pendingProjectId: '',
      newProjectVisible: false, deviceEditorVisible: false,
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
      this._workspaceActionTouch = null
      this._workspaceGroupGesture = null
      this._workspaceDraftBaseline = ''
      this._deviceDraftBaseline = ''
      this._workspaceViewPreference = readWorkspaceViewPreference()
      this._workspaceResumeRevision = 0
      this._workspaceResumeMode = ''
      this._workspaceHasExplicitRoute = typeof options.id === 'string' && Boolean(options.id.trim())
      this._workspaceIgnoreInitialActive = false
      this._workspaceOverlayTimers = Object.create(null)
      this._workspaceOverlayEpochs = Object.create(null)
      this._workspaceSwipeGesture = null
      this._workspaceSwipeTimer = null
      this._workspaceSwipePending = null
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
        devices: [], groups: [], deviceCount: 0, deviceChoices: [],
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

    rememberWorkspaceSuppressedTouch(event, targetKey = '') {
      this._workspaceSuppressedTapTarget = targetKey || null
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches')) || touchIdentifier(firstTouch(event))
      if (!identifier) return
      const now = Date.now()
      Object.keys(this._workspaceSuppressedTouches || {}).forEach((key) => {
        if (this._workspaceSuppressedTouches[key] < now) delete this._workspaceSuppressedTouches[key]
      })
      this._workspaceSuppressedTouches[identifier] = now + 300
    },

    clearWorkspaceSuppressedTouchForStart(event) {
      const identifier = touchIdentifier(firstTouch(event))
      if (identifier && this._workspaceSuppressedTouches) delete this._workspaceSuppressedTouches[identifier]
      this._workspaceSuppressedTapTarget = null
      this._workspaceActionTouch = null
    },

    consumeWorkspaceSuppressedTouch(event, targetKey = '') {
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches'))
      if (identifier && this._workspaceSuppressedTouches) {
        const expires = this._workspaceSuppressedTouches[identifier]
        delete this._workspaceSuppressedTouches[identifier]
        if (expires && expires >= Date.now()) {
          if (this._workspaceSuppressedTapTarget === targetKey) this._workspaceSuppressedTapTarget = null
          return true
        }
      }
      if (this._workspaceSuppressedTapTarget && this._workspaceSuppressedTapTarget === targetKey) {
        this._workspaceSuppressedTapTarget = null
        return true
      }
      return false
    },

    workspaceActionTouchKey(event) {
      const data = dataset(event)
      return [data.actionType || data.deleteType || 'action', text(data.projectId), text(data.id), text(data.revision)].join(':')
    },

    consumeWorkspaceActionTap(event) {
      if (this.consumeWorkspaceSuppressedTouch(event, this.workspaceActionTouchKey(event))) return false
      const touch = this._workspaceActionTouch
      if (!touch) return true
      const identifier = touchIdentifier(firstTouch(event, 'changedTouches'))
      if (identifier && touch.identifier && identifier === touch.identifier && touch.moved) {
        this._workspaceActionTouch = null
        return false
      }
      const key = this.workspaceActionTouchKey(event)
      if (touch.key === key && (!touch.completed || !touch.moved)) {
        this._workspaceActionTouch = null
        return true
      }
      if (identifier && touch.identifier && identifier === touch.identifier && touch.key !== key) {
        this._workspaceActionTouch = null
        return false
      }
      return true
    },

    onSwipeTouchStart(event) {
      this.clearWorkspaceSuppressedTouchForStart(event)
      if (this.data.saving || !this.data.project || datasetBoolean(dataset(event).retiring)) return
      const type = dataset(event).swipeType
      const id = text(dataset(event).swipeId)
      const point = firstTouch(event)
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
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_LOCK_THRESHOLD) return
        if (Math.abs(deltaX) >= Math.abs(deltaY) * 1.3) {
          gesture.axis = 'horizontal'
        } else if (Math.abs(deltaY) >= Math.abs(deltaX)) {
          gesture.axis = 'vertical'
          return
        } else return
      }
      if (gesture.axis !== 'horizontal') return
      const nextOffset = Math.max(0, Math.min(SWIPE_ACTION_WIDTH, gesture.startOffset - deltaX))
      gesture.lastOffset = nextOffset
      this.queueWorkspaceSwipeOffset(gesture, nextOffset)
    },

    queueWorkspaceSwipeOffset(gesture, offset) {
      this._workspaceSwipePending = { gesture, offset }
      if (this._workspaceSwipeTimer) return
      this._workspaceSwipeTimer = setTimeout(() => {
        this._workspaceSwipeTimer = null
        const pending = this._workspaceSwipePending
        this._workspaceSwipePending = null
        if (!pending || this._destroyed || this._workspaceSwipeGesture !== pending.gesture) return
        this.applyWorkspaceSwipeOffset(pending.gesture, pending.offset, true)
      }, SWIPE_SET_DATA_INTERVAL)
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
      if (this._workspaceSwipeTimer) clearTimeout(this._workspaceSwipeTimer)
      this._workspaceSwipeTimer = null
      this._workspaceSwipePending = null
      if (gesture.axis === 'horizontal') {
        const offset = gesture.lastOffset >= SWIPE_ACTION_WIDTH / 2 ? SWIPE_ACTION_WIDTH : 0
        this.applyWorkspaceSwipeOffset(gesture, offset, false)
        this.rememberWorkspaceSuppressedTouch(event, gesture.key)
      } else if (gesture.axis === 'vertical') {
        this.applyWorkspaceSwipeOffset(gesture, 0, false)
        this.rememberWorkspaceSuppressedTouch(event, gesture.key)
      }
      this._workspaceSwipeGesture = null
    },

    onSwipeTouchCancel() {
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

    onWorkspaceBackgroundTap() {
      this.closeWorkspaceSwipeRow()
    },
    onWorkspaceListScroll() { this.closeWorkspaceSwipeRow() },
    onWorkspaceRowTap(event) {
      const key = `device:${text(dataset(event).tapKey).replace(/^device:/, '')}`
      if (this.consumeWorkspaceSuppressedTouch(event, key)) return
      this.closeWorkspaceSwipeRow()
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
      if (this._workspaceSwipeTimer) clearTimeout(this._workspaceSwipeTimer)
      this._workspaceSwipeTimer = null
      this._workspaceSwipePending = null
      this._workspaceSwipeGesture = null
    },

    captureWorkspaceDeletion(type, id, viewRevision) {
      if (this._workspaceDeletion || this._workspaceDeletionInFlight || this.data.saving
        || this._destroyed || this._hidden || !this.data.project || this.data.project.id !== this.projectId) return null
      if (Number(viewRevision) !== Number(this._schedule.revision) || !Number.isSafeInteger(this._schedule.revision)) return null
      const projectId = String(this.projectId)
      const schedule = this._schedule
      let command
      let content
      let confirmText = '删除'
      let row = null
      if (type === 'device') {
        const workspaceDevice = (this._workspace || buildWorkspace(schedule)).devices.find((device) => device.id === id)
        if (!workspaceDevice) return null
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
            ? `删除设备“${record.name}”时，关联的 ${ids.length} 条线路也会一并删除。`
            : `将从本项目中删除设备“${record.name}”。`
          if (ids.length) confirmText = '一并删除'
        }
        const index = this.data.devices.findIndex((device) => device.id === id)
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
        const label = circleLabel(record)
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
        && this._projectLoadRevision === snapshot.loadRevision)
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
      const data = dataset(event)
      if (!this.isWorkspaceDeletionTargetCurrent(data.projectId, data.revision)) {
        notify("项目已更新，请重新操作")
        return
      }
      if (this.data.saving || this._workspaceDeletion || this._workspaceDeletionInFlight) {
        notify("正在处理删除，请稍后重试")
        return
      }
      const captured = this.captureWorkspaceDeletion(data.deleteType, text(data.id), data.revision)
      if (!captured) {
        notify("项目已更新，请重新操作")
        return
      }
      this.setData({ workspaceDeletingId: text(data.id) })
      const { snapshot, content, confirmText } = captured
      const confirm = (result) => {
        if (!this.isWorkspaceDeletionCurrent(snapshot)) return
        if (!result || result.confirm !== true) {
          this.invalidateWorkspaceDeletion()
          return
        }
        this.submitWorkspaceDeletion(snapshot)
      }
      if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') {
        this.invalidateWorkspaceDeletion()
        notify('暂时无法确认删除')
        return
      }
      wx.showModal({
        title: snapshot.recordType === 'device' ? '删除设备？' : '删除线路？',
        content,
        confirmText,
        confirmColor: '#d70015',
        success: confirm,
        fail: () => { if (this._workspaceDeletion === snapshot) this.invalidateWorkspaceDeletion() },
      })
    },

    submitWorkspaceDeletion(snapshot) {
      if (!this.isWorkspaceDeletionCurrent(snapshot) || snapshot.submitted || this.data.saving) return false
      snapshot.submitted = true
      this._workspaceDeletionInFlight = snapshot
      this.closeWorkspaceSwipeRow()
      this.invalidateExport(true)
      this.setData({ saving: true, saveError: '', formError: '', batchError: '' })
      let result
      try { result = saveProjectWiring(snapshot.projectId, snapshot.command, snapshot.revision) }
      catch (error) { result = { ok: false, error: error && error.message ? error.message : '删除失败，请重试。' } }
      const finish = (response) => {
        if (this._workspaceDeletionInFlight === snapshot) this._workspaceDeletionInFlight = null
        const current = this.isWorkspaceDeletionCurrent(snapshot)
        const sameVisibleProject = Boolean(snapshot.token === this._workspaceDeletionToken
          && this._workspaceDeletion === snapshot
          && !this._destroyed && !this._hidden
          && this.projectId === snapshot.projectId
          && this.data.project && this.data.project.id === snapshot.projectId)
        if (this._workspaceDeletion === snapshot) this._workspaceDeletion = null
        if (!current) {
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
          this.setData({ saving: false, workspaceDeletingId: '' })
          const error = response && response.error ? String(response.error) : '删除失败，请重试。'
          notify(error)
          return
        }
        if (!response.project || response.project.id !== snapshot.projectId
          || !response.schedule || response.schedule.revision <= snapshot.revision) {
          this.setData({ saving: false, workspaceDeletingId: '' })
          notify('删除结果已变化，请刷新项目后重试。')
          this.refreshProjectWiring()
          return
        }
        this.setData({ saving: false, workspaceDeletingId: '' })
        this.beginWorkspaceRowRemoval(snapshot)
        this.acceptSavedSchedule(response)
        notify(snapshot.recordType === 'device' ? '设备已删除' : '线路已删除')
      }
      if (result && typeof result.then === 'function') result.then(finish).catch((error) => finish({
        ok: false, error: error && error.message ? error.message : '删除失败，请重试。',
      }))
      else finish(result)
      return true
    },

    onHide() {
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
      const retiring = this._workspaceRetiringRow
      const retiringGhostRendered = Boolean(retiring && retiring.projectId === this.projectId && (retiring.type === 'device'
        ? devices.some((device) => device.id === retiring.item.id && device.retiring)
        : retiring.type === 'line' && groups.some((group) => group.key === retiring.group.key
          && (group.retiring || group.lines.some((line) => line.id === retiring.item.id && line.retiring)))))
      this.setData({ devices, groups, deviceCount: workspace.devices.length, scheduleRevision: this._schedule.revision,
        deviceChoices: [{ id: '', name: '请选择设备', choiceLabel: '请选择设备' }, ...workspace.devices] }, () => {
        if (typeof onRendered === 'function') onRendered()
        if (retiringGhostRendered) this.scheduleWorkspaceRowExitAfterRender(retiring.token)
      })
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
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      this.setData({ workspaceTab: tab })
      if (this.data.project && this.data.project.id === this.projectId) writeWorkspaceViewPreference(this.projectId, tab)
    },

    applySearch(event) {
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      base.applySearch.call(this, event)
      this.refreshWorkspace()
    },

    onSearchInput(event) {
      // Retain the original cancellable search revision for project transitions.
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      base.onSearchInput.call(this, event)
      this.refreshWorkspace()
    },

    clearSearch() {
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

    requestNewProject() {
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

    openDeviceEditor() {
      if (!this.data.project || this.data.loading || this.data.saving || this.data.projectCreating) return
      this.invalidateExport(false)
      const deviceDraft = { type: 'receiver', name: '\u63a5\u6536\u673a', count: '1' }
      this._deviceDraftBaseline = JSON.stringify(deviceDraft)
      this.beginWorkspaceOverlay('deviceEditor', {
        deviceEditorVisible: true, batchVisible: true, deviceDraft,
        deviceFormError: '', saveError: '', batchError: '', saving: false,
      })
      this.beginFormKeyboardAvoidance('batch')
      this.refreshDeviceNames()
    },

    onDeviceType(event) {
      const option = DEVICE_OPTIONS.find((item) => item.id === dataset(event).type)
      if (!option || this.data.saving) return
      const oldOption = DEVICE_OPTIONS.find((item) => item.id === this.data.deviceDraft.type)
      const name = !this.data.deviceDraft.name || this.data.deviceDraft.name === (oldOption && oldOption.label)
        ? (option.id === 'custom' ? '' : option.label) : this.data.deviceDraft.name
      this.setData({ deviceDraft: { ...this.data.deviceDraft, type: option.id, name } })
      this.refreshDeviceNames()
    },

    onDeviceDraftInput(event) {
      const field = dataset(event).field
      if (!['name', 'count'].includes(field) || this.data.saving) return
      this.setData({ deviceDraft: { ...this.data.deviceDraft, [field]: inputValue(event) } })
      this.refreshDeviceNames()
    },

    onDeviceCountStep(event) {
      const count = Math.min(32, Math.max(1, (Number(this.data.deviceDraft.count) || 1) + Number(dataset(event).delta || 0)))
      this.onDeviceDraftInput({ currentTarget: { dataset: { field: 'count' } }, detail: { value: text(count) } })
    },

    refreshDeviceNames() {
      const result = deviceNames(this.data.deviceDraft.name, this.data.deviceDraft.count)
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
      base.resetFormKeyboardAvoidance.call(this, false)
      this.endWorkspaceOverlay('deviceEditor', () => this.cleanupWorkspaceOverlayContents(['deviceEditor']), {
        deviceEditorVisible: false, batchVisible: false,
      })
      this.syncUnloadWarning()
    },

    saveDevices() {
      if (this.data.saving || !this.data.deviceEditorVisible) return
      const result = deviceNames(this.data.deviceDraft.name, this.data.deviceDraft.count)
      if (!result.ok) { this.setData({ deviceFormError: result.error }); return }
      this.saveCommand({ type: 'add-devices', devices: result.names.map((name) => ({ type: this.data.deviceDraft.type, name })) }, (saved) => {
        this.closeDeviceEditor()
        this.acceptSavedSchedule(saved)
        notify(`已添加 ${result.names.length} 台设备`)
      })
    },

    connectDevice(event) {
      if (!this.consumeWorkspaceActionTap(event)) return
      const target = dataset(event)
      if (!this.isWorkspaceDeletionTargetCurrent(target.projectId, target.revision)) {
        notify('项目已更新，请重新操作')
        return
      }
      if (this.data.loading || this.data.saving || this.data.projectCreating) {
        notify('项目正在处理中，请稍后重试')
        return
      }
      this.closeWorkspaceSwipeRow()
      const device = (this._workspace || buildWorkspace(this._schedule)).devices.find((item) => item.id === text(target.id))
      if (!device) {
        notify('项目已更新，请重新操作')
        return
      }
      this.openNewLine()
      this.assignEndpoint('from', device)
    },

    makeDefaultDraft() {
      return { ...base.makeDefaultDraft.call(this), spec: '', connectorA: '', connectorB: '' }
    },

    makePair(pair = {}) {
      this._draftPairSerial = (this._draftPairSerial || 0) + 1
      return { key: `pair-${this._draftPairSerial}`, fromPort: text(pair.fromPort), toPort: text(pair.toPort), lengthText: text(pair.lengthText) }
    },

    endpointChoiceIndex(side, draft) {
      return Math.max(0, this.data.deviceChoices.findIndex((device) => draft[`${side}DeviceId`]
        ? device.id === draft[`${side}DeviceId`] : device.legacy && device.name === draft[`${side}Device`]))
    },

    setDraft(draft, options = {}) {
      this.invalidateWorkspaceEditorDelete()
      this._workspaceEditorSessionId = (this._workspaceEditorSessionId || 0) + 1
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
      const draftPairs = [this.makePair(this.data.draft)]
      const draftCircleLabel = circleLabel({ code: this.data.draftCode })
      this.setData({ draftPairs, pairErrors: [], continuousVisible: false,
        draftCircleLabel, draftCircleNumeric: /^\d{1,4}$/.test(draftCircleLabel),
        fromDeviceIndex: this.endpointChoiceIndex('from', this.data.draft),
        toDeviceIndex: this.endpointChoiceIndex('to', this.data.draft) })
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
      const device = this.data.deviceChoices[Number(event.detail && event.detail.value)]
      if (!['from', 'to'].includes(side) || !device || !device.id || this.data.saving) return
      this.assignEndpoint(side, device)
    },

    assignEndpoint(side, device) {
      const draft = { ...this.data.draft, [`${side}Device`]: device.name }
      if (device.legacy) draft[`${side}DeviceId`] = null
      else draft[`${side}DeviceId`] = device.id
      this._draftTouched = true
      const formFieldErrors = { ...this.data.formFieldErrors }
      delete formFieldErrors[`${side}Device`]
      this.setData({ draft, [`${side}DeviceIndex`]: this.data.deviceChoices.findIndex((item) => item.id === device.id), formFieldErrors, formError: '', saveError: '' })
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
      const missing = endpointFields.filter((field) => field.endsWith('Device') && !text(draft[field]).trim())
      const pairErrors = pairs.map((pair) => ({ fromPort: !text(pair.fromPort).trim(), toPort: !text(pair.toPort).trim() }))
      if (missing.length || pairErrors.some((error) => error.fromPort || error.toPort)) {
        const formFieldErrors = Object.fromEntries(missing.map((field) => [field, '请选择设备']))
        this.setData({ formError: '请选择两端设备，并填写每条线路的两端端口。', formFieldErrors, pairErrors })
        return
      }
      const lines = pairs.map((pair) => {
        const line = { ...draft, fromPort: pair.fromPort, toPort: pair.toPort, lengthText: pair.lengthText }
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
      const label = circleLabel(this.data.draft)
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

    shareProject() {
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

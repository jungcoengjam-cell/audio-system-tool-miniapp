const { DEVICE_OPTIONS, CONNECTOR_OPTIONS } = require('../../utils/project-wiring')
const { createProject, getProjectWiring, getProjects, saveProjectWiring } = require('../../utils/records')
const { buildWorkspace, circleLabel } = require('./workspace-model')
const { isPerformanceMeasurementEnabled, startMeasurement, measureJsonPayloadBytes } = require('../../utils/performance')
const { vibrate } = require('../../utils/haptics')
const { VIEW_PREFERENCE_KEY } = require('./page-lifecycle')
const { createWorkspaceOverlayMethods } = require('./workspace-overlays')
const { createWorkspaceInteractionMethods } = require('./workspace-interactions')
const { createWorkspaceDeletionMethods } = require('./workspace-deletion')

const WORKSPACE_ROW_ENTER_MS = 16
const WORKSPACE_ROW_EXIT_CLEANUP_MS = 240
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
function currentWorkspaceWx() {
  return typeof wx === 'undefined' ? undefined : wx
}

function createWorkspaceRuntime() {
  const runtimeWx = new Proxy({}, {
    get(target, property) {
      const current = currentWorkspaceWx()
      const value = current && current[property]
      return typeof value === 'function' ? value.bind(current) : value
    },
  })
  return {
    wx: runtimeWx,
    Date: { now: () => Date.now() },
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
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

// This module owns workspace navigation, list interactions and overlay coordination.
// Lifecycle and report jobs are composed separately; persistent commands remain in project-wiring/records.
function createWorkspaceUI(base) {
  const runtime = createWorkspaceRuntime()
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

    ...createWorkspaceOverlayMethods(base, runtime),

    ...createWorkspaceInteractionMethods({
      Date: runtime.Date, text, dataset, datasetBoolean, firstTouch, touchIdentifier, isInlineRenameInputTarget,
    }),

    ...createWorkspaceDeletionMethods({
      wx: runtime.wx, buildWorkspace, circleLabel, saveProjectWiring, dataset, text, notify, vibrate,
    }),

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
        if (!this._hidden) vibrate('medium')
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

    syncUnloadWarning() {
      const dirty = this.data.deviceEditorVisible ? this.hasUnsavedDeviceDraft() : this.data.editorVisible && this.hasUnsavedDraft()
      if (dirty && typeof wx !== 'undefined' && typeof wx.enableAlertBeforeUnload === 'function') {
        wx.enableAlertBeforeUnload({ message: '当前填写的内容尚未保存。' })
      } else this.clearUnloadWarning()
    },

    clearUnloadWarning() {
      if (typeof wx !== 'undefined' && typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload()
    },

  }
}

module.exports = { createWorkspaceUI }

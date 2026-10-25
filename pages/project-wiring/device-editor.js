const { DEVICE_OPTIONS } = require('../../utils/project-wiring')
const { buildWorkspace, deviceNames } = require('./workspace-model')
const { vibrate } = require('../../utils/haptics')

const INLINE_RENAME_ACTION_BLUR_MS = 350
const text = (value) => String(value === undefined || value === null ? '' : value)
const dataset = (event) => event && event.currentTarget && event.currentTarget.dataset || {}
const targetDataset = (event) => event && event.target && event.target.dataset || {}
const inputValue = (event) => text(event && event.detail && event.detail.value)
const datasetBoolean = (value) => value === true || value === 1 || value === '1' || value === 'true'
const notify = (title) => { if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') wx.showToast({ title, icon: 'none' }) }
const firstTouch = (event, list = 'touches') => {
  const touches = event && event[list]
  return touches && Number(touches.length) > 0 ? touches[0] : null
}
const touchIdentifier = (touch) => touch && touch.identifier !== undefined && touch.identifier !== null ? String(touch.identifier) : ''

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

function createDeviceEditor(base, { applyScheduleChange, saveProjectWiring }) {
  return {
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
        if (!this._destroyed && !this._hidden) vibrate('medium')
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
      const changed = option.id !== this.data.deviceDraft.type
      const oldOption = DEVICE_OPTIONS.find((item) => item.id === this.data.deviceDraft.type)
      const name = !this._deviceDraftNameTouched && (!this.data.deviceDraft.name || this.data.deviceDraft.name === (oldOption && oldOption.label))
        ? (option.id === 'custom' ? '' : option.label) : this.data.deviceDraft.name
      this.setData({ deviceDraft: { ...this.data.deviceDraft, type: option.id, name } })
      this.refreshDeviceNames()
      if (changed) vibrate('light')
    },

    onDeviceDraftInput(event) {
      const field = dataset(event).field
      if (!['name', 'count'].includes(field) || this.data.saving) return
      if (field === 'name') this._deviceDraftNameTouched = true
      this.setData({ deviceDraft: { ...this.data.deviceDraft, [field]: inputValue(event) } })
      this.refreshDeviceNames()
    },

    onDeviceCountStep(event) {
      const previous = text(this.data.deviceDraft.count)
      const count = Math.min(32, Math.max(1, (Number(this.data.deviceDraft.count) || 1) + Number(dataset(event).delta || 0)))
      this.onDeviceDraftInput({ currentTarget: { dataset: { field: 'count' } }, detail: { value: text(count) } })
      if (text(count) !== previous) vibrate('light')
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
        if (!this._destroyed && !this._hidden) vibrate('medium')
        this.closeDeviceEditor()
        this.acceptSavedSchedule(saved)
        notify(`已添加 ${result.names.length} 台设备`)
      })
    },
  }
}

module.exports = { createDeviceEditor }

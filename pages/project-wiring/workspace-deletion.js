function createWorkspaceDeletionMethods(runtime) {
  const { wx, buildWorkspace, circleLabel, saveProjectWiring, dataset, text, notify, vibrate } = runtime
  return {
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
        if (!this._destroyed && !this._hidden) vibrate('medium')
        this.traceWorkspaceInteraction('delete-apply', { control: snapshot.recordType === 'device' ? 'delete-device' : 'delete-line', accepted: true, reason: 'applied' })
        notify(snapshot.recordType === 'device' ? '设备已删除' : '线路已删除')
      }
      if (result && typeof result.then === 'function') result.then(finish).catch((error) => finish({
        ok: false, error: error && error.message ? error.message : '删除失败，请重试。',
      }))
      else finish(result)
      return true
    },

  }
}

module.exports = { createWorkspaceDeletionMethods }

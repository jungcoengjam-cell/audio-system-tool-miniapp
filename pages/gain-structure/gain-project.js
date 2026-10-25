// Project save flow for the gain calculator page.

function createGainProjectData() {
  return {
    projectSheetVisible: false,
    projectStep: 'select',
    projectLoadState: 'idle',
    projectError: '',
    projectSearch: '',
    projectItems: [],
    projectTargetId: '',
    projectTargetName: '',
    newProjectName: '',
    projectConfigName: '',
    projectConfigNote: '',
    projectNameError: '',
    projectConfigNameError: '',
    projectNoteError: '',
    projectPreview: null,
    projectSaveError: '',
    projectKeyboardEpisode: 0,
    projectKeyboardActive: false,
    projectKeyboardVisibleHeight: 0,
    projectKeyboardLift: 0,
    projectKeyboardPanelStyle: '',
    isSavingProject: false,
    savedProjectName: '',
    savedConfigName: '',
    savedAtText: '',
  }
}

function createGainProjectMethods(runtime = {}) {
  const { addRecordToProject, createProject, getProjectRecordView, getRecordById, getRecordByPayload, getWorkspaceSnapshot, vibrate, formatProjectSavedAt, wx } = runtime
  function getProjectKeyboardHeight(event) {
    const eventHeight = Number(event?.size?.windowHeight)
    if (Number.isFinite(eventHeight) && eventHeight > 0) return eventHeight
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const height = Number(info?.windowHeight)
      return Number.isFinite(height) && height > 0 ? height : 0
    } catch (error) {
      return 0
    }
  }

  function getProjectKeyboardField(event) {
    return (event?.currentTarget?.dataset?.projectField
      || event?.target?.dataset?.projectField || '')
  }

  function getProjectRecordMetadataState(payload, projectId, recordId) {
    const record = (recordId && getRecordById(recordId)) || getRecordByPayload(payload)
    const linked = Boolean(record?.projectIds?.includes(projectId))
    const metadata = linked && record?.projectMetadata
      && typeof record.projectMetadata === 'object' && !Array.isArray(record.projectMetadata)
      ? record.projectMetadata[projectId]
      : null
    const view = linked ? getProjectRecordView(record, projectId) : null
    const hasProjectMetadata = Boolean(view?.hasProjectMetadata)
    const name = hasProjectMetadata ? view.title : String(payload?.title || '')
    const note = hasProjectMetadata ? String(view.projectNote || '') : ''
    const token = JSON.stringify({
      recordId: record?.id || '',
      linked,
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { name: metadata.name, note: metadata.note, savedAt: metadata.savedAt }
        : null,
    })
    return { record, linked, hasProjectMetadata, name, note, token }
  }

  function getProjectKeyboardEpisode(event) {
    const raw = event?.currentTarget?.dataset?.projectEpisode
      ?? event?.target?.dataset?.projectEpisode
    const episode = Number(raw)
    return Number.isSafeInteger(episode) && episode >= 0 ? episode : null
  }

  return {
    invalidateProjectSave({ updateView = true } = {}) {
      this._projectRequestId = (this._projectRequestId || 0) + 1
      const wasSaving = Boolean(this._projectSavePending || this.data?.isSavingProject)
      this._projectSavePending = false
      if (wasSaving && updateView && !this._isUnloaded && this.data?.projectSheetVisible) {
        this.setData({ isSavingProject: false })
      }
      return this._projectRequestId
    },

    openProjectSheet() {
      if (!this.data.hasValidResult || this.data.projectSheetVisible
        || this.data.shareSheetVisible || this.data.selectorVisible || this._projectSavePending) return false
      const record = this.getRecordPayload()
      if (!record) return false
      vibrate('light')
      this.openPageContainerOverlay('project')
      this.invalidateProjectSave({ updateView: false })
      this._projectSnapshotForSave = {
        payload: JSON.parse(JSON.stringify(record)),
        signature: JSON.stringify(record),
        revision: this._inputRevision || 0,
      }
      this._projectConfigNameEdited = false
      this._projectConfigNoteEdited = false
      const lastTarget = this._lastProjectTarget
      const keyboard = this.resetProjectKeyboardState({ captureBaseline: true, updateView: false })
      this.setData({
        projectSheetVisible: true,
        projectStep: 'select',
        projectLoadState: 'loading',
        projectError: '',
        projectSearch: '',
        projectItems: [],
        projectTargetId: '',
        projectTargetName: '',
        projectSaveError: '',
        projectNameError: '',
        projectConfigName: '',
        projectConfigNote: '',
        projectConfigNameError: '',
        projectNoteError: '',
        projectPreview: null,
        newProjectName: '',
        isSavingProject: false,
        savedProjectName: '',
        savedConfigName: '',
        savedAtText: '',
        ...keyboard,
      })
      if (!this.refreshProjects()) return true
      if (lastTarget) {
        const current = this._projectSnapshot.projects.find((item) => item.id === lastTarget.id)
        if (current && current.name === lastTarget.name) {
          this.setProjectTarget(current)
        } else {
          this._lastProjectTarget = null
          this.setData({ projectSaveError: '上次选择的项目已改名或不存在，请重新选择。' })
        }
      }
      return true
    },

    refreshProjects() {
      let snapshot
      try {
        snapshot = getWorkspaceSnapshot({ forceRefresh: true })
      } catch (error) {
        snapshot = null
      }
      this._projectSnapshot = snapshot
      if (!snapshot || snapshot.ok === false) {
        this.setData({
          projectLoadState: 'error',
          projectError: '项目列表读取失败，请重试。',
          projectItems: [],
        })
        return false
      }
      this.updateProjectList(snapshot.projects || [])
      this.setData({ projectLoadState: 'ready', projectError: '' })
      return true
    },

    updateProjectList(projects = this._projectSnapshot?.projects || []) {
      const keyword = String(this.data.projectSearch || '').trim().toLocaleLowerCase()
      const projectItems = projects
        .filter((item) => !keyword || item.name.toLocaleLowerCase().includes(keyword))
        .map(({ id, name }) => ({ id, name }))
      this.setData({ projectItems })
    },

    onProjectSearch(event) {
      this.invalidateProjectSave()
      const projectSearch = String(event?.detail?.value || '')
      const keyword = projectSearch.trim().toLocaleLowerCase()
      const projects = this._projectSnapshot?.projects || []
      const projectItems = projects
        .filter((item) => !keyword || item.name.toLocaleLowerCase().includes(keyword))
        .map(({ id, name }) => ({ id, name }))
      const targetIsVisible = !this.data.projectTargetId
        || projectItems.some((item) => item.id === this.data.projectTargetId)
      if (!targetIsVisible) this._lastProjectTarget = null
      this.setData({
        projectSearch,
        projectItems,
        projectSaveError: targetIsVisible ? '' : '搜索结果已更改，请重新选择可见项目。',
        ...(!targetIsVisible ? { projectTargetId: '', projectTargetName: '' } : {}),
      })
    },

    chooseProject(event) {
      if (!this.data.projectSheetVisible || this.data.projectStep !== 'select') return false
      const id = event?.currentTarget?.dataset?.id
      const isVisible = this.data.projectItems.some((item) => item.id === id)
      const project = isVisible ? this._projectSnapshot?.projects?.find((item) => item.id === id) : null
      if (!project) return false
      return this.setProjectTarget(project)
    },

    setProjectTarget(project) {
      if (!project || !project.id || !project.name || !this._projectSnapshotForSave) return false
      this.invalidateProjectSave({ updateView: false })
      this._lastProjectTarget = { id: project.id, name: project.name }
      const frozen = this._projectSnapshotForSave
      const metadata = getProjectRecordMetadataState(frozen.payload, project.id, this._resultEditorSession?.recordId)
      const projectPreviewResultText = String(frozen.payload.resultText || '')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('功放额定输出输入点：')
          || line.startsWith('衰减执行位置：'))
        .join('\n')
      const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
      this.setData({
        projectStep: 'details',
        projectTargetId: project.id,
        projectTargetName: project.name,
        projectConfigName: this._projectConfigNameEdited
          ? this.data.projectConfigName
          : String(metadata.name || frozen.payload.title || ''),
        projectConfigNote: this._projectConfigNoteEdited
          ? this.data.projectConfigNote
          : String(metadata.note || ''),
        projectConfigNameError: '',
        projectNoteError: '',
        projectSaveError: '',
        projectPreview: {
          title: String(frozen.payload.title || ''),
          summary: String(frozen.payload.summary || ''),
          resultText: projectPreviewResultText,
        },
        ...keyboard,
      })
      return true
    },

    beginNewProject() {
      if (!this.data.projectSheetVisible || this.data.projectLoadState !== 'ready') return false
      this.invalidateProjectSave({ updateView: false })
      const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
      this.setData({
        projectStep: 'create',
        newProjectName: '',
        projectNameError: '',
        projectSaveError: '',
        ...keyboard,
      })
      return true
    },

    onNewProjectNameInput(event) {
      this.invalidateProjectSave()
      this.setData({
        newProjectName: String(event?.detail?.value || ''),
        projectNameError: '',
        projectSaveError: '',
      })
    },

    createProjectFromForm() {
      if (!this.data.projectSheetVisible || this.data.projectStep !== 'create') return false
      const name = String(this.data.newProjectName || '').trim()
      if (!name || name.length > 30) {
        this.setData({ projectNameError: !name ? '请输入项目名称。' : '项目名称最多 30 个字符。' })
        return false
      }
      let snapshot
      try {
        snapshot = getWorkspaceSnapshot({ forceRefresh: true })
      } catch (error) {
        snapshot = null
      }
      if (!snapshot || snapshot.ok === false) {
        this.setData({ projectNameError: '读取项目列表失败，请重试后创建。' })
        return false
      }
      const existing = snapshot.projects.find((item) => item.name === name)
      const project = existing || createProject(name)
      if (!project) {
        this.setData({ projectNameError: '项目创建失败，请检查本地存储后重试。' })
        return false
      }
      let refreshed
      try {
        refreshed = getWorkspaceSnapshot({ forceRefresh: true })
      } catch (error) {
        refreshed = null
      }
      if (!refreshed || refreshed.ok === false) {
        this._projectSnapshot = refreshed
        this.setData({
          projectLoadState: 'error',
          projectError: '项目已创建，但列表读取失败；请重试后选择。',
          projectNameError: '',
        })
        return false
      }
      this._projectSnapshot = refreshed
      const verified = refreshed.projects.find((item) => item.id === project.id)
      if (!verified) {
        this.setData({ projectNameError: '新项目未能确认保存，请刷新列表后重试。' })
        return false
      }
      this.updateProjectList(refreshed.projects)
      this.setData({ projectSearch: '', projectLoadState: 'ready', projectNameError: '' })
      return this.setProjectTarget(verified)
    },

    backToProjectList() {
      if (!this.data.projectSheetVisible) return false
      this.invalidateProjectSave({ updateView: false })
      this._lastProjectTarget = null
      const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
      this.setData({
        projectStep: 'select',
        projectTargetId: '',
        projectTargetName: '',
        projectSearch: '',
        projectNameError: '',
        projectConfigNameError: '',
        projectNoteError: '',
        projectSaveError: '',
        isSavingProject: false,
        ...keyboard,
      }, () => this.updateProjectList())
      return true
    },

    onProjectConfigNameInput(event) {
      this.invalidateProjectSave()
      this._projectConfigNameEdited = true
      this.setData({
        projectConfigName: String(event?.detail?.value || ''),
        projectConfigNameError: '',
        projectSaveError: '',
      })
    },

    onProjectConfigNoteInput(event) {
      this.invalidateProjectSave()
      this._projectConfigNoteEdited = true
      this.setData({
        projectConfigNote: String(event?.detail?.value || ''),
        projectNoteError: '',
        projectSaveError: '',
      })
    },

    saveProjectConfiguration() {
      const frozen = this._projectSnapshotForSave
      const targetId = this.data.projectTargetId
      const targetName = this.data.projectTargetName
      const nameDraft = String(this.data.projectConfigName || '')
      const noteDraft = String(this.data.projectConfigNote || '')
      const configName = nameDraft.trim()
      const configNote = noteDraft.trim()
      if (!frozen || !targetId || this._projectSavePending
        || !this.data.projectSheetVisible || this.data.projectStep !== 'details') return false
      if (!configName || configName.length > 60) {
        this.setData({ projectConfigNameError: !configName ? '请输入配置名称。' : '配置名称最多 60 个字符。' })
        return false
      }
      if (configNote.length > 200) {
        this.setData({ projectNoteError: '备注最多 200 个字符。' })
        return false
      }

      const requestId = (this._projectRequestId || 0) + 1
      this._projectRequestId = requestId
      this._projectSavePending = true
      this.setData({
        isSavingProject: true,
        projectSaveError: '',
        projectConfigNameError: '',
        projectNoteError: '',
      })
      const isOwned = () => this._projectRequestId === requestId
        && this._projectSavePending
        && this._projectSnapshotForSave === frozen
      const isCurrent = () => {
        if (!isOwned() || this._isUnloaded || !this._pageVisible
          || !this.data.projectSheetVisible || this.data.projectStep !== 'details'
          || this.data.projectTargetId !== targetId
          || this.data.projectTargetName !== targetName
          || this.data.projectConfigName !== nameDraft
          || this.data.projectConfigNote !== noteDraft
          || this._inputRevision !== frozen.revision) return false
        try {
          return JSON.stringify(this.getRecordPayload()) === frozen.signature
        } catch (error) {
          return false
        }
      }
      const releaseOwned = () => {
        if (!isOwned()) return false
        this._projectSavePending = false
        return true
      }
      const fail = (message, extraChanges = {}) => {
        if (!releaseOwned()) return false
        if (!this._isUnloaded) this.setData({
          isSavingProject: false,
          projectSaveError: message,
          ...extraChanges,
        })
        return false
      }
      const readFreshSaveState = () => {
        let snapshot
        try {
          snapshot = getWorkspaceSnapshot({ forceRefresh: true })
        } catch (error) {
          snapshot = null
        }
        if (!snapshot || snapshot.ok === false) {
          return { ok: false, message: '读取项目状态失败，请重试。' }
        }
        this._projectSnapshot = snapshot
        const projects = snapshot.projects || []
        this.updateProjectList(projects)
        const target = projects.find((item) => item.id === targetId)
        if (!target) {
          return {
            ok: false,
            message: '所选项目已不存在，请重新选择。',
            clearTarget: true,
          }
        }
        if (target.name !== targetName) {
          return {
            ok: false,
            message: '项目名称已变化，请重新选择。',
            clearTarget: true,
          }
        }
        try {
          return {
            ok: true,
            target,
            metadata: getProjectRecordMetadataState(frozen.payload, targetId, this._resultEditorSession?.recordId),
          }
        } catch (error) {
          return { ok: false, message: '读取项目配置失败，请重试。' }
        }
      }
      const handleFreshStateFailure = (state) => fail(
        state.message,
        state.clearTarget
          ? {
            projectStep: 'select',
            projectTargetId: '',
            projectTargetName: '',
          }
          : {},
      )
      const persistProjectRecord = (state) => {
        if (!isCurrent()) return fail('当前结果或配置已变化，请重新确认后保存。')
        let saved
        try {
          saved = addRecordToProject(frozen.payload, targetId, {
            name: configName,
            note: configNote,
          })
        } catch (error) {
          saved = null
        }
        if (!saved) return fail('保存失败，请检查本地存储后重试。')
        if (!releaseOwned()) return false
        const savedMetadata = saved.projectMetadata?.[targetId]
        const savedAt = Number(savedMetadata?.savedAt)
        this._lastProjectTarget = { id: targetId, name: state.target.name }
        const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
        this.setData({
          projectStep: 'success',
          savedProjectName: state.target.name,
          savedConfigName: configName,
          savedAtText: formatProjectSavedAt(savedAt),
          projectSaveError: '',
          isSavingProject: false,
          ...keyboard,
        })
        vibrate('medium')
        return true
      }
      const showUpdateConfirmation = (baselineMetadata) => {
        if (!isCurrent()) return fail('当前结果或配置已变化，请重新确认后保存。')
        if (typeof wx.showModal !== 'function') {
          return fail('无法打开配置更新确认，请重试。')
        }
        try {
          wx.showModal({
            title: '更新已保存配置？',
            content: '该项目中已存在相同增益参数的配置。确认后将更新名称或备注，并刷新保存时间。',
            confirmText: '确认更新',
            cancelText: '取消',
            success: ({ confirm }) => {
              if (!isCurrent()) return fail('当前结果或配置已变化，请重新确认后保存。')
              if (!confirm) {
                if (releaseOwned()) this.setData({ isSavingProject: false, projectSaveError: '' })
                return
              }
              const latest = readFreshSaveState()
              if (!latest.ok) {
                handleFreshStateFailure(latest)
                return
              }
              if (!isCurrent()) return fail('当前结果或配置已变化，请重新确认后保存。')
              if (latest.metadata.token !== baselineMetadata.token) {
                fail('项目配置已变化，请重新确认后保存。')
                return
              }
              persistProjectRecord(latest)
            },
            fail: () => fail('确认操作未完成，请重试。'),
          })
        } catch (error) {
          return fail('确认操作未完成，请重试。')
        }
        return true
      }

      if (!isCurrent()) return fail('当前结果或配置已变化，请重新确认后保存。')
      const fresh = readFreshSaveState()
      if (!fresh.ok) return handleFreshStateFailure(fresh)
      if (!isCurrent()) return fail('当前结果或配置已变化，请重新确认后保存。')
      const needsConfirmation = fresh.metadata.linked
        && (fresh.metadata.name !== configName || fresh.metadata.note !== configNote)
      return needsConfirmation
        ? showUpdateConfirmation(fresh.metadata)
        : persistProjectRecord(fresh)
    },

    continueAfterProjectSave() {
      return this.closeProjectSheet()
    },

    closeProjectSheet() {
      if (!this.data.projectSheetVisible) return false
      this.invalidateProjectSave({ updateView: false })
      this._projectSnapshotForSave = null
      this.clearPageContainerOverlay('project')
      const keyboard = this.resetProjectKeyboardState({ hideKeyboard: true, updateView: false })
      this.setData({
        projectSheetVisible: false,
        projectStep: 'select',
        isSavingProject: false,
        ...keyboard,
      })
      return true
    },

    resetProjectKeyboardState({ captureBaseline = false, hideKeyboard = false, updateView = true } = {}) {
      const hadFocus = Boolean(this._projectKeyboardFocusId)
      this._projectKeyboardEpisode = (this._projectKeyboardEpisode || 0) + 1
      this._projectKeyboardFocusId = ''
      this._projectKeyboardFocusStartedAt = 0
      this._projectKeyboardHeight = 0
      const currentHeight = getProjectKeyboardHeight()
      if (currentHeight) this._projectKeyboardWindowHeight = currentHeight
      if (captureBaseline || !this._projectKeyboardBaselineHeight) {
        this._projectKeyboardBaselineHeight = this._projectKeyboardWindowHeight || currentHeight
      }
      if (hideKeyboard && hadFocus && typeof wx.hideKeyboard === 'function') {
        try { wx.hideKeyboard({}) } catch (error) {}
      }
      const changes = {
        projectKeyboardEpisode: this._projectKeyboardEpisode,
        projectKeyboardActive: false,
        projectKeyboardVisibleHeight: 0,
        projectKeyboardLift: 0,
        projectKeyboardPanelStyle: '',
      }
      if (updateView && !this._isUnloaded && this.data) this.setData(changes)
      return changes
    },

    onProjectInputFocus(event) {
      if (this._isUnloaded || !this._pageVisible || !this.data.projectSheetVisible
        || getProjectKeyboardEpisode(event) !== this._projectKeyboardEpisode) return false
      const field = getProjectKeyboardField(event)
      const allowedFields = {
        select: ['projectSearch'],
        create: ['newProjectName'],
        details: ['projectConfigName', 'projectConfigNote'],
      }[this.data.projectStep] || []
      if (!allowedFields.includes(field)) return false
      const timestamp = Number(event?.timeStamp)
      this._projectKeyboardFocusId = field
      this._projectKeyboardFocusStartedAt = Number.isFinite(timestamp) ? timestamp : 0
      const currentHeight = getProjectKeyboardHeight(event)
      if (currentHeight) this._projectKeyboardWindowHeight = currentHeight
      if (!this._projectKeyboardBaselineHeight) this._projectKeyboardBaselineHeight = currentHeight
      return true
    },

    onProjectInputBlur(event) {
      if (this._isUnloaded || !this.data.projectSheetVisible
        || getProjectKeyboardEpisode(event) !== this._projectKeyboardEpisode) return false
      const field = getProjectKeyboardField(event)
      const timestamp = Number(event?.timeStamp)
      if (field !== this._projectKeyboardFocusId
        || (timestamp && this._projectKeyboardFocusStartedAt && timestamp < this._projectKeyboardFocusStartedAt)) return false
      this.resetProjectKeyboardState({ updateView: true })
      return true
    },

    onProjectKeyboardHeightChange(event) {
      if (this._isUnloaded || !this._pageVisible || !this.data.projectSheetVisible
        || getProjectKeyboardEpisode(event) !== this._projectKeyboardEpisode) return false
      const field = getProjectKeyboardField(event)
      const allowedFields = {
        select: ['projectSearch'],
        create: ['newProjectName'],
        details: ['projectConfigName', 'projectConfigNote'],
      }[this.data.projectStep] || []
      const timestamp = Number(event?.timeStamp)
      const keyboardHeight = Number(event?.detail?.height)
      if (!allowedFields.includes(field) || field !== this._projectKeyboardFocusId
        || !Number.isFinite(keyboardHeight)
        || (timestamp && this._projectKeyboardFocusStartedAt && timestamp < this._projectKeyboardFocusStartedAt)) return false
      if (keyboardHeight <= 0) {
        this.resetProjectKeyboardState({ updateView: true })
        return true
      }
      this._projectKeyboardHeight = keyboardHeight
      const currentHeight = getProjectKeyboardHeight(event)
      if (currentHeight) this._projectKeyboardWindowHeight = currentHeight
      const baselineHeight = this._projectKeyboardBaselineHeight || currentHeight
      const visibleHeight = Math.max(0, Math.min(currentHeight || baselineHeight, baselineHeight - keyboardHeight))
      const lift = Math.max(0, keyboardHeight - Math.max(0, baselineHeight - currentHeight))
      this.setData({
        projectKeyboardActive: true,
        projectKeyboardVisibleHeight: Math.floor(visibleHeight),
        projectKeyboardLift: Math.ceil(lift),
        projectKeyboardPanelStyle: 'max-height:' + Math.floor(visibleHeight)
          + 'px;margin-bottom:' + Math.ceil(lift) + 'px;',
      })
      return true
    },

    saveToActiveProject() {
      addPageToActiveProject(this)
    },
  }
}

module.exports = { createGainProjectData, createGainProjectMethods }

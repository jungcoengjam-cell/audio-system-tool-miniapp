// Project save flow for the limiter calculator page.

function createLimiterProjectData() {
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
    projectNoteError: '',
    projectSaveError: '',
    projectKeyboardEpisode: 0,
    projectKeyboardActive: false,
    projectKeyboardVisibleHeight: 0,
    projectKeyboardLift: 0,
    projectKeyboardPanelStyle: '',
    savedProjectName: '',
    savedConfigName: '',
    savedAtText: '',
  }
}

function createLimiterProjectMethods(runtime = {}) {
  const { addRecordToProject, createProject, getProjectRecordView, getRecordById, getRecordByPayload, getWorkspaceSnapshot, vibrate, formatSavedAt, sameMetadata, getLimiterWindowHeight, projectKeyboardLayout, wx } = runtime
  const isWxAvailable = runtime.isWxAvailable || (() => true)
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

  return {
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
      if (hideKeyboard && hadProjectFocus && isWxAvailable()
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
        const record = (this._resultEditorSession?.recordId && getRecordById(this._resultEditorSession.recordId))
          || getRecordByPayload(payload)
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
        const existing = (this._resultEditorSession?.recordId && getRecordById(this._resultEditorSession.recordId))
          || getRecordByPayload(payload)
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
  }
}

module.exports = { createLimiterProjectData, createLimiterProjectMethods }

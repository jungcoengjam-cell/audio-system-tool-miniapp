// Project save flow for the cable calculator page.

function createCableProjectData() {
  return {
    projectDialogVisible: false,
    projectDialogClosing: false,
    projectDialogStep: 'select',
    projectDialogRevision: 0,
    projectFocusEpisode: 0,
    projectProjects: [],
    filteredProjects: [],
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
  }
}

function createCableProjectMethods(runtime = {}) {
  const { addRecordToProject, createProject, getProjectRecordView, getRecordById, getRecordByPayload, getWorkspaceSnapshot, vibrate, serializePayload, cancelProjectCloseTimer, wx, setTimeout } = runtime
  const PROJECT_CLOSE_DURATION = 320

  function projectMetadataDefaults(payload, projectId, recordId) {
    const record = (recordId && getRecordById(recordId)) || getRecordByPayload(payload)
    const view = record ? getProjectRecordView(record, projectId) : null
    return view?.hasProjectMetadata
      ? { projectConfigName: view.title, projectConfigNote: view.projectNote || '' }
      : { projectConfigName: payload.title || '', projectConfigNote: '' }
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

  return {
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
        ...projectMetadataDefaults(this._projectFrozenPayload, freshProject.id, this._resultEditorSession?.recordId),
        projectNameError: '',
        projectNoteError: '',
        projectError: '',
        projectLoadFailed: false,
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
        ...projectMetadataDefaults(this._projectFrozenPayload, project.id, this._resultEditorSession?.recordId),
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
      const persisted = verified?.records.find((record) => record.id === savedRecord.id
        && record.projectIds?.includes(project.id))
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
  }
}

module.exports = { createCableProjectData, createCableProjectMethods }

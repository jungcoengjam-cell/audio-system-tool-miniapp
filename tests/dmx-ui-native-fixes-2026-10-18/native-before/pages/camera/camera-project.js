const {
  addRecordToProject,
  createProject,
  getProjectRecordView,
  getRecordByPayload,
  getWorkspaceSnapshot,
} = require('../../utils/records')
const { vibrate } = require('../../utils/haptics')

const PROJECT_CLOSE_DURATION = 320

function serializePayload(payload) {
  try {
    return payload ? JSON.stringify(payload) : ''
  } catch (error) {
    return ''
  }
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

function getMetadataDefaults(payload, projectId) {
  const record = getRecordByPayload(payload)
  const view = record ? getProjectRecordView(record, projectId) : null
  return view?.hasProjectMetadata
    ? { projectConfigName: view.title, projectConfigNote: view.projectNote || '' }
    : { projectConfigName: payload.title || '', projectConfigNote: '' }
}

function cancelCloseTimer(page) {
  if (page._cameraProjectCloseTimer != null) clearTimeout(page._cameraProjectCloseTimer)
  page._cameraProjectCloseTimer = null
}

function resetKeyboard(page, hideKeyboard = true) {
  page._cameraProjectFocusEpisode = (page._cameraProjectFocusEpisode || 0) + 1
  page._cameraProjectFocusContext = null
  if (hideKeyboard && page.data.projectKeyboardOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
  return {
    projectFocusEpisode: page._cameraProjectFocusEpisode,
    projectKeyboardOpen: false,
    projectKeyboardHeight: 0,
    projectKeyboardBottom: 0,
    projectFocusedInputId: '',
    projectViewportHeight: page._cameraProjectWindowBaseHeight || 720,
    projectSheetMaxHeight: Math.max(0, Math.floor((page._cameraProjectWindowBaseHeight || 720) * 0.9)),
  }
}

function finishClose(page) {
  cancelCloseTimer(page)
  page._cameraProjectFrozenPayload = null
  page._cameraProjectFrozenSignature = ''
  page.setData({
    projectDialogVisible: false,
    projectDialogClosing: false,
    projectDialogRevision: page._cameraProjectRevision,
    projectTarget: null,
    projectSaving: false,
    projectError: '',
    projectLoadFailed: false,
    projectSaveBlocked: false,
    projectFrozenTitle: '',
    projectFrozenSummary: '',
    ...resetKeyboard(page),
  })
  return true
}

function isDialogCurrent(page, revision = page._cameraProjectRevision) {
  return page._cameraProjectRevision === revision
    && page.data.projectDialogVisible
    && !page.data.projectDialogClosing
    && page._pageVisible !== false
    && !page._cameraUnloaded
}

function isFrozenPayloadCurrent(page) {
  const current = typeof page.getRecordPayload === 'function' ? page.getRecordPayload() : null
  return Boolean(page._cameraProjectFrozenSignature
    && serializePayload(current) === page._cameraProjectFrozenSignature)
}

function createCameraProjectData() {
  return {
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

function createCameraProjectMethods() {
  return {
    openCameraProjectDialog() {
      if (this._cameraUnloaded || this._pageVisible === false || this.data.legacyCustomUnsupported
        || this.data.resultUpdating || !this.data.result
        || this.getOperationSnapshot?.()) return false
      const payload = this.getRecordPayload()
      const signature = serializePayload(payload)
      if (!payload || !signature) return false

      cancelCloseTimer(this)
      this._cameraProjectRevision = (this._cameraProjectRevision || 0) + 1
      this._cameraProjectFocusEpisode = (this._cameraProjectFocusEpisode || 0) + 1
      this._cameraProjectWindowBaseHeight = getWindowHeight()
      this._cameraProjectFrozenPayload = JSON.parse(signature)
      this._cameraProjectFrozenSignature = signature
      this._cameraProjectFocusContext = null
      this.setData({
        projectDialogVisible: true,
        projectDialogClosing: false,
        projectDialogStep: 'select',
        projectDialogRevision: this._cameraProjectRevision,
        projectFocusEpisode: this._cameraProjectFocusEpisode,
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
        projectError: '',
        projectLoadFailed: false,
        projectSaving: false,
        projectSaveBlocked: false,
        projectKeyboardOpen: false,
        projectKeyboardHeight: 0,
        projectKeyboardBottom: 0,
        projectFocusedInputId: '',
        projectViewportHeight: this._cameraProjectWindowBaseHeight,
        projectSheetMaxHeight: Math.max(0, Math.floor(this._cameraProjectWindowBaseHeight * 0.9)),
      })
      this.refreshCameraProjectTargets()
      return true
    },

    refreshCameraProjectTargets() {
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

    retryCameraProjectRead() {
      const snapshot = this.refreshCameraProjectTargets()
      if (!snapshot || !this.data.projectTarget) return Boolean(snapshot)
      const currentTarget = snapshot.projects.find((project) => project.id === this.data.projectTarget.id)
      if (!currentTarget || currentTarget.name !== this.data.projectTarget.name) {
        this.moveCameraProjectToSelection(snapshot,
          currentTarget ? '项目名称已变更，请重新选择。' : '目标项目已不存在，请重新选择。')
      }
      return true
    },

    onCameraProjectSearch(event) {
      if (!this.data.projectDialogVisible || this.data.projectDialogClosing) return false
      const projectSearchText = String(event?.detail?.value || '')
      this.setData({
        projectSearchText,
        filteredProjects: getFilteredProjects(this.data.projectProjects, projectSearchText),
      })
      return true
    },

    openCameraProjectCreateForm() {
      if (!isDialogCurrent(this) || this.data.projectLoadFailed) return false
      this.setData({
        projectDialogStep: 'create',
        ...resetKeyboard(this),
        projectNameText: '',
        projectError: '',
        projectLoadFailed: false,
      })
      return true
    },

    onCameraProjectNameInput(event) {
      if (!isDialogCurrent(this) || this.data.projectDialogStep !== 'create') return false
      this.setData({ projectNameText: String(event?.detail?.value || ''), projectError: '', projectLoadFailed: false })
      return true
    },

    onCameraProjectConfigNameInput(event) {
      if (!isDialogCurrent(this) || this.data.projectDialogStep !== 'confirm') return false
      this.setData({ projectConfigName: String(event?.detail?.value || ''), projectNameError: '', projectError: '' })
      return true
    },

    onCameraProjectConfigNoteInput(event) {
      if (!isDialogCurrent(this) || this.data.projectDialogStep !== 'confirm') return false
      this.setData({ projectConfigNote: String(event?.detail?.value || ''), projectNoteError: '', projectError: '' })
      return true
    },

    beginCameraProjectInputFocus(event) {
      const dataset = event?.currentTarget?.dataset || {}
      if (!isDialogCurrent(this) || Number(dataset.dialogRevision) !== this._cameraProjectRevision
        || dataset.step !== this.data.projectDialogStep) return false
      this._cameraProjectFocusEpisode = (this._cameraProjectFocusEpisode || 0) + 1
      this._cameraProjectFocusContext = {
        episode: this._cameraProjectFocusEpisode,
        revision: this._cameraProjectRevision,
        step: this.data.projectDialogStep,
        field: dataset.field || '',
        timeStamp: Number.isFinite(Number(event?.timeStamp)) ? Number(event.timeStamp) : null,
      }
      this.setData({
        projectFocusEpisode: this._cameraProjectFocusEpisode,
        projectFocusedInputId: dataset.field || '',
      })
      return true
    },

    endCameraProjectInputFocus(event) {
      const dataset = event?.currentTarget?.dataset || {}
      const focus = this._cameraProjectFocusContext
      if (!focus || !this.data.projectDialogVisible || this.data.projectDialogClosing
        || Number(dataset.dialogRevision) !== focus.revision
        || Number(dataset.focusEpisode) !== focus.episode
        || dataset.step !== focus.step
        || (dataset.field && dataset.field !== focus.field)) return false
      this._cameraProjectBlurEpisode = focus.episode
      return true
    },

    onCameraProjectKeyboardHeightChange(event) {
      const dataset = event?.currentTarget?.dataset || {}
      const focus = this._cameraProjectFocusContext
      if (!focus || !isDialogCurrent(this, focus.revision)
        || Number(dataset.dialogRevision) !== focus.revision
        || Number(dataset.focusEpisode) !== focus.episode
        || dataset.step !== focus.step || dataset.field !== focus.field) return false
      const eventTimeStamp = Number(event?.timeStamp ?? event?.detail?.timeStamp)
      if (focus.timeStamp !== null && Number.isFinite(eventTimeStamp) && eventTimeStamp < focus.timeStamp) return false
      const keyboardHeight = Math.max(0, Number(event?.detail?.height) || 0)
      if (!keyboardHeight) {
        this.setData({ ...resetKeyboard(this, false) })
        return true
      }
      const baseHeight = this._cameraProjectWindowBaseHeight || getWindowHeight()
      const currentHeight = getWindowHeight()
      const heightBeforeKeyboard = currentHeight < baseHeight ? currentHeight : baseHeight
      const visibleHeight = Math.max(0, Math.min(heightBeforeKeyboard, baseHeight - keyboardHeight))
      this.setData({
        projectKeyboardOpen: true,
        projectKeyboardHeight: keyboardHeight,
        projectKeyboardBottom: currentHeight < baseHeight ? 0 : keyboardHeight,
        projectViewportHeight: visibleHeight,
        projectSheetMaxHeight: Math.max(0, Math.floor(visibleHeight)),
      })
      return true
    },

    createCameraProjectFromForm() {
      if (!isDialogCurrent(this) || this.data.projectDialogStep !== 'create') return false
      const projectName = String(this.data.projectNameText || '').trim()
      if (!projectName) {
        this.setData({ projectError: '请输入项目名称。' })
        return false
      }
      if (!isFrozenPayloadCurrent(this)) {
        this.setData({ projectSaveBlocked: true, projectError: '当前安装结果已变化，请关闭后重新选择保存内容。' })
        return false
      }
      if (!getProjectSnapshot()) {
        this.setData({ projectLoadFailed: true, projectError: '读取项目列表失败，请检查本地存储后重试。' })
        return false
      }
      const project = createProject(projectName)
      if (!project) {
        this.setData({ projectError: '新建失败，请检查项目名称和本地存储。' })
        return false
      }
      const snapshot = getProjectSnapshot()
      const freshProject = snapshot?.projects.find((item) => item.id === project.id)
      if (!snapshot || !freshProject || freshProject.name !== project.name) {
        this.setData({
          projectLoadFailed: !snapshot,
          projectError: snapshot ? '项目创建状态已变化，请返回列表后重新选择。' : '项目已创建，但暂时无法读取项目列表，请重试。',
        })
        return false
      }
      this.setData({
        projectDialogStep: 'confirm',
        ...resetKeyboard(this),
        projectTarget: { id: freshProject.id, name: freshProject.name, createdInDialog: true },
        ...getMetadataDefaults(this._cameraProjectFrozenPayload, freshProject.id),
        projectNameError: '',
        projectNoteError: '',
        projectError: '',
        projectLoadFailed: false,
        projectProjects: snapshot.projects.map((item) => ({ ...item })),
        filteredProjects: getFilteredProjects(snapshot.projects, this.data.projectSearchText),
        projectActiveId: snapshot.activeProject?.id || '',
      })
      return true
    },

    selectCameraProjectTarget(event) {
      if (!isDialogCurrent(this) || this.data.projectDialogStep !== 'select') return false
      const projectId = String(event?.currentTarget?.dataset?.id || '')
      const project = this.data.projectProjects.find((item) => item.id === projectId)
      if (!project || this.data.projectLoadFailed) return false
      this.setData({
        projectDialogStep: 'confirm',
        ...resetKeyboard(this),
        projectTarget: { id: project.id, name: project.name, createdInDialog: false },
        ...getMetadataDefaults(this._cameraProjectFrozenPayload, project.id),
        projectNameError: '',
        projectNoteError: '',
        projectError: '',
        projectLoadFailed: false,
      })
      return true
    },

    moveCameraProjectToSelection(snapshot, error) {
      if (!isDialogCurrent(this)) return false
      this.setData({
        projectDialogStep: 'select',
        projectProjects: snapshot.projects.map((project) => ({ ...project })),
        filteredProjects: getFilteredProjects(snapshot.projects, this.data.projectSearchText),
        projectActiveId: snapshot.activeProject?.id || '',
        projectTarget: null,
        projectConfigName: '',
        projectConfigNote: '',
        projectNameError: '',
        projectNoteError: '',
        projectLoadFailed: false,
        projectError: error || '',
        ...resetKeyboard(this),
      })
      return true
    },

    returnToCameraProjectSelection() {
      if (!isDialogCurrent(this)) return false
      if (this.data.projectSaveBlocked || !isFrozenPayloadCurrent(this)) {
        this.closeCameraProjectDialog()
        return false
      }
      const snapshot = getProjectSnapshot()
      if (!snapshot) {
        this.setData({ projectLoadFailed: true, projectError: '读取项目列表失败，请重试。' })
        return false
      }
      return this.moveCameraProjectToSelection(snapshot, '')
    },

    saveCameraProjectTarget() {
      if (!isDialogCurrent(this) || this.data.projectSaving || this.data.projectDialogStep !== 'confirm'
        || !this.data.projectTarget || this.data.projectSaveBlocked) return false
      const name = String(this.data.projectConfigName || '').trim()
      const note = String(this.data.projectConfigNote || '').trim()
      const projectNameError = !name ? '请输入配置名称。' : name.length > 60 ? '配置名称最多 60 个字符。' : ''
      const projectNoteError = note.length > 200 ? '备注最多 200 个字符。' : ''
      if (projectNameError || projectNoteError) {
        this.setData({ projectNameError, projectNoteError })
        return false
      }
      if (!isFrozenPayloadCurrent(this)) {
        this.setData({ projectSaveBlocked: true, projectError: '当前安装结果已变化，关闭后请重新点击项目保存。' })
        return false
      }
      const revision = this._cameraProjectRevision
      this.setData({ projectSaving: true, projectError: '', projectLoadFailed: false }, () => {
        if (!isDialogCurrent(this, revision) || !this.data.projectSaving) return
        if (!isFrozenPayloadCurrent(this)) {
          this.setData({ projectSaving: false, projectSaveBlocked: true, projectError: '当前安装结果已变化，关闭后请重新点击项目保存。' })
          return
        }
        const target = this.data.projectTarget
        const frozenPayload = this._cameraProjectFrozenPayload
        const snapshot = getProjectSnapshot()
        if (!snapshot) {
          this.setData({ projectSaving: false, projectLoadFailed: true, projectError: '读取项目列表失败，请重试。' })
          return
        }
        const project = snapshot.projects.find((item) => item.id === target.id)
        if (!project || project.name !== target.name) {
          this.moveCameraProjectToSelection(snapshot,
            project ? '项目名称已变更，请重新选择。' : '目标项目已不存在，请重新选择。')
          this.setData({ projectSaving: false })
          return
        }
        const saved = addRecordToProject(frozenPayload, project.id, { name, note })
        if (!saved) {
          this.setData({ projectSaving: false, projectError: '保存失败，请检查本地存储后重试。' })
          return
        }
        const verified = getProjectSnapshot()
        const expectedSignature = JSON.stringify([frozenPayload.module, frozenPayload.preferences])
        const persisted = verified?.records.find((record) => (
          record.signature === expectedSignature && record.projectIds?.includes(project.id)
        ))
        const projectView = persisted ? getProjectRecordView(persisted, project.id) : null
        if (!verified || !persisted || !projectView?.hasProjectMetadata
          || projectView.title !== name || projectView.projectNote !== note) {
          this.setData({
            projectSaving: false,
            projectLoadFailed: !verified,
            projectError: '暂时无法核对保存状态，请重试确认。',
          })
          return
        }
        vibrate('medium')
        this.setData({
          projectDialogStep: 'success',
          projectSaving: false,
          projectError: '',
          projectLoadFailed: false,
          projectSavedConfigName: name,
          projectConfigName: name,
          projectConfigNote: note,
          projectNameError: '',
          projectNoteError: '',
          ...resetKeyboard(this),
        })
      })
      return true
    },

    closeCameraProjectDialog(immediate) {
      if (!this.data.projectDialogVisible) {
        cancelCloseTimer(this)
        return false
      }
      if ((this.data.projectSaving || this.data.projectDialogClosing) && immediate !== true) return false
      this._cameraProjectRevision = (this._cameraProjectRevision || 0) + 1
      cancelCloseTimer(this)
      if (immediate === true || this._pageVisible === false || this._cameraUnloaded) {
        return finishClose(this)
      }
      const keyboardChanges = resetKeyboard(this)
      const revision = this._cameraProjectRevision
      this.setData({ projectDialogClosing: true, projectDialogRevision: revision, ...keyboardChanges }, () => {
        if (revision !== this._cameraProjectRevision || !this.data.projectDialogClosing
          || !this.data.projectDialogVisible) return
        const timer = setTimeout(() => {
          if (this._cameraProjectCloseTimer !== timer || revision !== this._cameraProjectRevision
            || !this.data.projectDialogClosing) return
          this._cameraProjectCloseTimer = null
          finishClose(this)
        }, PROJECT_CLOSE_DURATION)
        this._cameraProjectCloseTimer = timer
      })
      return true
    },

    cancelCameraProjectForHide() {
      if (this.data.projectDialogVisible) return this.closeCameraProjectDialog(true)
      cancelCloseTimer(this)
      this._cameraProjectRevision = (this._cameraProjectRevision || 0) + 1
      this._cameraProjectFrozenPayload = null
      this._cameraProjectFrozenSignature = ''
      return false
    },

    stopCameraProjectTap() {},
    preventCameraProjectTouchMove() {},
  }
}

module.exports = {
  createCameraProjectData,
  createCameraProjectMethods,
}

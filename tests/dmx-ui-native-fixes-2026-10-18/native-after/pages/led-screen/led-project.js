const {
  addRecordToProject,
  createProject,
  getProjectRecordView,
  getRecordByPayload,
  getWorkspaceSnapshot,
} = require('../../utils/records')
const { vibrate } = require('../../utils/haptics')

const PROJECT_CLOSE_DURATION = 320

function serialize(value) {
  try { return value ? JSON.stringify(value) : '' } catch (error) { return '' }
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

function snapshotProjects() {
  try {
    const snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    return snapshot?.ok ? snapshot : null
  } catch (error) {
    return null
  }
}

function filterProjects(projects, query) {
  const normalized = String(query || '').trim().toLocaleLowerCase()
  return normalized
    ? projects.filter((project) => String(project.name || '').toLocaleLowerCase().includes(normalized))
    : projects
}

function isCurrentProjectEvent(page, event, step) {
  const dataset = event?.currentTarget?.dataset || {}
  if (!page.isLedProjectDialogCurrent()) return false
  if (page.data.projectSaving) return false
  if (dataset.dialogRevision !== undefined
    && Number(dataset.dialogRevision) !== Number(page._ledProjectRevision)) return false
  if (step && dataset.step !== undefined && dataset.step !== step) return false
  return true
}

function cancelCloseTimer(page) {
  if (page._ledProjectCloseTimer != null) clearTimeout(page._ledProjectCloseTimer)
  page._ledProjectCloseTimer = null
}

function bumpFocus(page, hideKeyboard = true) {
  page._ledProjectFocusEpisode = (page._ledProjectFocusEpisode || 0) + 1
  page._ledProjectFocusContext = null
  if (hideKeyboard && page.data.projectKeyboardOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
  return {
    projectFocusEpisode: page._ledProjectFocusEpisode,
    projectKeyboardOpen: false,
    projectKeyboardHeight: 0,
    projectKeyboardBottom: 0,
    projectFocusedInputId: '',
    projectViewportHeight: page._ledProjectWindowBaseHeight || 720,
    projectSheetMaxHeight: Math.max(0, Math.floor((page._ledProjectWindowBaseHeight || 720) * 0.9)),
  }
}

function createLedProjectData() {
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
    projectSheetMaxHeight: 648,
    projectSaveBlocked: false,
  }
}

function createLedProjectMethods() {
  return {
    isLedProjectDialogCurrent(revision = this._ledProjectRevision) {
      return this._ledProjectRevision === revision && this.data.projectDialogVisible
        && !this.data.projectDialogClosing && this._pageVisible !== false && !this._ledUnloaded
    },

    isLedProjectOutputCurrent() {
      const frozen = this._ledProjectFrozen
      return Boolean(frozen && this.isCapturedOutputCurrent(frozen.capture)
        && serialize(this.getRecordPayload()) === frozen.signature)
    },

    openProjectSheet() {
      this.flushInputCalculation()
      const capture = this.captureCurrentOutput()
      const payload = capture ? this.getRecordPayload() : null
      const signature = serialize(payload)
      if (!capture || !payload || !signature || !this.isCapturedOutputCurrent(capture)) return false

      cancelCloseTimer(this)
      this._ledProjectRevision = (this._ledProjectRevision || 0) + 1
      this._ledProjectWindowBaseHeight = getWindowHeight()
      this._ledProjectFrozen = { capture, payload: JSON.parse(signature), signature }
      this._ledProjectFocusContext = null
      this.setData({
        projectDialogVisible: true,
        projectDialogClosing: false,
        projectDialogStep: 'select',
        projectDialogRevision: this._ledProjectRevision,
        ...bumpFocus(this, false),
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
      })
      this.refreshProjectTargets()
      return true
    },

    refreshProjectTargets() {
      if (!this.isLedProjectDialogCurrent()) return null
      const snapshot = snapshotProjects()
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
        filteredProjects: filterProjects(projects, this.data.projectSearchText),
        projectActiveId: snapshot.activeProject?.id || '',
        projectLoadFailed: false,
        projectError: '',
      })
      return snapshot
    },

    retryProjectRead(event) {
      if (!isCurrentProjectEvent(this, event, 'select') || this.data.projectDialogStep !== 'select') return false
      const snapshot = this.refreshProjectTargets()
      if (!snapshot || !this.data.projectTarget) return Boolean(snapshot)
      const current = snapshot.projects.find((project) => project.id === this.data.projectTarget.id)
      if (!current || current.name !== this.data.projectTarget.name) {
        this.moveProjectToSelection(snapshot, current ? '项目名称已变更，请重新选择。' : '目标项目已不存在，请重新选择。')
      }
      return true
    },

    onProjectSearch(event) {
      if (!isCurrentProjectEvent(this, event, 'select') || this.data.projectDialogStep !== 'select') return false
      const projectSearchText = String(event?.detail?.value || '')
      this.setData({ projectSearchText, filteredProjects: filterProjects(this.data.projectProjects, projectSearchText) })
      return true
    },

    beginProjectInputFocus(event) {
      const dataset = event?.currentTarget?.dataset || {}
      if (!this.isLedProjectDialogCurrent(Number(dataset.dialogRevision))
        || dataset.step !== this.data.projectDialogStep || this.data.projectSaving) return false
      this._ledProjectFocusEpisode = (this._ledProjectFocusEpisode || 0) + 1
      this._ledProjectFocusContext = {
        episode: this._ledProjectFocusEpisode,
        revision: this._ledProjectRevision,
        step: this.data.projectDialogStep,
        field: dataset.field || '',
        timeStamp: Number.isFinite(Number(event?.timeStamp)) ? Number(event.timeStamp) : null,
      }
      this.setData({ projectFocusEpisode: this._ledProjectFocusEpisode, projectFocusedInputId: dataset.field || '' })
      return true
    },

    endProjectInputFocus(event) {
      const dataset = event?.currentTarget?.dataset || {}
      const focus = this._ledProjectFocusContext
      if (!focus || !this.data.projectDialogVisible || this.data.projectDialogClosing
        || Number(dataset.dialogRevision) !== focus.revision
        || Number(dataset.focusEpisode) !== focus.episode
        || dataset.step !== focus.step
        || (dataset.field && dataset.field !== focus.field)) return false
      return true
    },

    onProjectKeyboardHeightChange(event) {
      const dataset = event?.currentTarget?.dataset || {}
      const focus = this._ledProjectFocusContext
      if (!focus || !this.isLedProjectDialogCurrent(focus.revision)
        || Number(dataset.dialogRevision) !== focus.revision
        || Number(dataset.focusEpisode) !== focus.episode
        || dataset.step !== focus.step || dataset.field !== focus.field) return false
      const eventTimestamp = Number(event?.timeStamp ?? event?.detail?.timeStamp)
      if (focus.timeStamp !== null && Number.isFinite(eventTimestamp) && eventTimestamp < focus.timeStamp) return false
      const keyboardHeight = Math.max(0, Number(event?.detail?.height) || 0)
      if (!keyboardHeight) {
        this.setData({ ...bumpFocus(this, false) })
        return true
      }
      const baseHeight = this._ledProjectWindowBaseHeight || getWindowHeight()
      const currentHeight = getWindowHeight()
      const visibleHeight = Math.max(0, Math.min(currentHeight < baseHeight ? currentHeight : baseHeight,
        baseHeight - keyboardHeight))
      this.setData({
        projectKeyboardOpen: true,
        projectKeyboardHeight: keyboardHeight,
        projectKeyboardBottom: currentHeight < baseHeight ? 0 : keyboardHeight,
        projectViewportHeight: visibleHeight,
        projectSheetMaxHeight: Math.max(0, Math.floor(visibleHeight)),
      })
      return true
    },

    onProjectNameInput(event) {
      if (!isCurrentProjectEvent(this, event, 'create') || this.data.projectDialogStep !== 'create') return false
      this.setData({ projectNameText: String(event?.detail?.value || ''), projectError: '', projectLoadFailed: false })
      return true
    },

    onProjectConfigNameInput(event) {
      if (!isCurrentProjectEvent(this, event, 'confirm') || this.data.projectDialogStep !== 'confirm') return false
      this.setData({ projectConfigName: String(event?.detail?.value || ''), projectNameError: '', projectError: '' })
      return true
    },

    onProjectConfigNoteInput(event) {
      if (!isCurrentProjectEvent(this, event, 'confirm') || this.data.projectDialogStep !== 'confirm') return false
      this.setData({ projectConfigNote: String(event?.detail?.value || ''), projectNoteError: '', projectError: '' })
      return true
    },

    openProjectCreateForm(event) {
      if (!isCurrentProjectEvent(this, event, 'select') || this.data.projectDialogStep !== 'select'
        || this.data.projectLoadFailed) return false
      this.setData({
        projectDialogStep: 'create',
        ...bumpFocus(this),
        projectNameText: '',
        projectError: '',
        projectLoadFailed: false,
      })
      return true
    },

    continueLedProjectSave(project) {
      if (!project || !this.isLedProjectOutputCurrent()) return false
      const payload = this._ledProjectFrozen?.payload
      const record = getRecordByPayload(payload)
      const existing = record ? getProjectRecordView(record, project.id) : null
      this.setData({
        projectDialogStep: 'confirm',
        ...bumpFocus(this),
        projectTarget: { id: project.id, name: project.name },
        projectConfigName: existing?.hasProjectMetadata ? existing.title : payload.title,
        projectConfigNote: existing?.hasProjectMetadata ? existing.projectNote || '' : '',
        projectNameError: '',
        projectNoteError: '',
        projectError: '',
        projectLoadFailed: false,
      })
      return true
    },

    createProjectFromForm(event) {
      if (!isCurrentProjectEvent(this, event, 'create') || this.data.projectDialogStep !== 'create') return false
      const projectName = String(this.data.projectNameText || '').trim()
      if (!projectName) {
        this.setData({ projectError: '请输入项目名称。' })
        return false
      }
      if (!this.isLedProjectOutputCurrent()) return this.blockLedProjectSave()
      const before = this.data.projectProjects.find((project) => project.name === projectName.slice(0, 30))
      if (!snapshotProjects()) {
        this.setData({ projectLoadFailed: true, projectError: '读取项目列表失败，请重试。' })
        return false
      }
      const project = createProject(projectName)
      if (!project) {
        this.setData({ projectError: '新建失败，请检查项目名称和本地存储。' })
        return false
      }
      const snapshot = snapshotProjects()
      const current = snapshot?.projects.find((item) => item.id === project.id)
      if (!snapshot || !current || current.name !== project.name) {
        this.setData({
          projectLoadFailed: !snapshot,
          projectError: snapshot ? '项目创建状态已变化，请返回列表后重试。' : '项目已提交创建，但暂时无法读取列表，请重试。',
        })
        return false
      }
      this._ledCreatedProjectTarget = !before
      this.setData({
        projectProjects: snapshot.projects.map((item) => ({ ...item })),
        filteredProjects: filterProjects(snapshot.projects, this.data.projectSearchText),
        projectActiveId: snapshot.activeProject?.id || '',
      })
      return this.continueLedProjectSave(current)
    },

    selectProjectTarget(event) {
      if (!isCurrentProjectEvent(this, event, 'select') || this.data.projectDialogStep !== 'select') return false
      const projectId = String(event?.currentTarget?.dataset?.id || '')
      const project = this.data.projectProjects.find((item) => item.id === projectId)
      if (!project || this.data.projectLoadFailed) return false
      this._ledCreatedProjectTarget = false
      return this.continueLedProjectSave(project)
    },

    moveProjectToSelection(snapshot, error = '') {
      if (!this.isLedProjectDialogCurrent()) return false
      const projects = snapshot.projects.map((project) => ({ ...project }))
      this.setData({
        projectDialogStep: 'select',
        projectProjects: projects,
        filteredProjects: filterProjects(projects, this.data.projectSearchText),
        projectActiveId: snapshot.activeProject?.id || '',
        projectTarget: null,
        projectConfigName: '',
        projectConfigNote: '',
        projectNameError: '',
        projectNoteError: '',
        projectLoadFailed: false,
        projectError: error,
        ...bumpFocus(this),
      })
      return true
    },

    returnToProjectSelection(event) {
      if (!isCurrentProjectEvent(this, event)
        || !['create', 'confirm'].includes(this.data.projectDialogStep)) return false
      if (this.data.projectSaveBlocked || !this.isLedProjectOutputCurrent()) {
        this.closeProjectDialog(true)
        return false
      }
      const snapshot = snapshotProjects()
      if (!snapshot) {
        this.setData({ projectLoadFailed: true, projectError: '读取项目列表失败，请重试。' })
        return false
      }
      return this.moveProjectToSelection(snapshot)
    },

    blockLedProjectSave() {
      this.setData({ projectSaveBlocked: true, projectError: '当前方案已变化，请关闭后重新打开项目保存。' })
      return false
    },

    saveProjectTarget(event) {
      if (!isCurrentProjectEvent(this, event, 'confirm') || this.data.projectSaving
        || this.data.projectDialogStep !== 'confirm' || !this.data.projectTarget
        || this.data.projectSaveBlocked) return false
      const name = String(this.data.projectConfigName || '').trim()
      const note = String(this.data.projectConfigNote || '').trim()
      const projectNameError = !name ? '请输入配置名称。'
        : name.length > 60 ? '配置名称最多 60 个字符。' : ''
      const projectNoteError = note.length > 200 ? '备注最多 200 个字符。' : ''
      if (projectNameError || projectNoteError) {
        this.setData({ projectNameError, projectNoteError })
        return false
      }
      if (!this.isLedProjectOutputCurrent()) return this.blockLedProjectSave()

      const snapshot = snapshotProjects()
      if (!snapshot) {
        this.setData({ projectLoadFailed: true, projectError: '读取项目列表失败，请重试。' })
        return false
      }
      const target = this.data.projectTarget
      const project = snapshot.projects.find((item) => item.id === target.id)
      if (!project || project.name !== target.name) {
        this.moveProjectToSelection(snapshot, project ? '项目名称已变更，请重新选择。' : '目标项目已不存在，请重新选择。')
        return false
      }
      const revision = this._ledProjectRevision
      this.setData({ projectSaving: true, projectError: '', projectLoadFailed: false }, () => {
        if (!this.isLedProjectDialogCurrent(revision) || !this.data.projectSaving) return
        if (!this.isLedProjectOutputCurrent()) {
          this.blockLedProjectSave()
          this.setData({ projectSaving: false })
          return
        }
        const latest = snapshotProjects()
        if (!latest) {
          this.setData({ projectSaving: false, projectLoadFailed: true,
            projectError: '读取项目列表失败，请重试后保存。' })
          return
        }
        const currentTarget = this.data.projectTarget
        const currentProject = currentTarget && latest.projects.find((item) => item.id === currentTarget.id)
        if (!currentProject || currentProject.id !== target.id || currentProject.name !== target.name
          || currentTarget.id !== target.id || currentTarget.name !== target.name) {
          this.setData({ projectSaving: false })
          this.moveProjectToSelection(latest, currentProject
            ? '项目名称已变更，请重新选择。' : '目标项目已不存在，请重新选择。')
          return
        }
        if (!this.isLedProjectDialogCurrent(revision) || !this.data.projectSaving
          || !this.isLedProjectOutputCurrent()) {
          this.setData({ projectSaving: false })
          return
        }
        const frozen = this._ledProjectFrozen
        const saved = addRecordToProject(frozen.payload, currentProject.id, { name, note })
        if (!saved) {
          this.setData({ projectSaving: false, projectError: '保存失败，请检查本地存储后重试。' })
          return
        }
        const verified = snapshotProjects()
        const persisted = verified?.records.find((record) => record.signature === saved.signature
          && record.projectIds?.includes(currentProject.id))
        const view = persisted ? getProjectRecordView(persisted, currentProject.id) : null
        if (!verified || !persisted || !view?.hasProjectMetadata
          || view.title !== name || view.projectNote !== note) {
          this.setData({ projectSaving: false, projectLoadFailed: !verified,
            projectError: '暂时无法核对保存状态，请重试确认。' })
          return
        }
        if (!this.isLedProjectDialogCurrent(revision) || !this.isLedProjectOutputCurrent()) return
        vibrate('medium')
        this.setData({
          projectDialogStep: 'success',
          ...bumpFocus(this),
          projectSaving: false,
          projectError: '',
          projectLoadFailed: false,
          projectSavedConfigName: name,
          projectConfigName: name,
          projectConfigNote: note,
          projectNameError: '',
          projectNoteError: '',
        })
      })
      return true
    },

    closeProjectDialog(eventOrImmediate = false) {
      const hasEvent = Boolean(eventOrImmediate && typeof eventOrImmediate === 'object')
      if (hasEvent && !isCurrentProjectEvent(this, eventOrImmediate)) return false
      const immediate = eventOrImmediate === true
      if (!this.data.projectDialogVisible) {
        cancelCloseTimer(this)
        return false
      }
      if ((this.data.projectSaving || this.data.projectDialogClosing) && immediate !== true) return false
      this._ledProjectRevision = (this._ledProjectRevision || 0) + 1
      cancelCloseTimer(this)
      if (immediate === true || this._pageVisible === false || this._ledUnloaded) {
        this._ledProjectFrozen = null
        this.setData({
          projectDialogVisible: false,
          projectDialogClosing: false,
          projectDialogRevision: this._ledProjectRevision,
          projectTarget: null,
          projectSaving: false,
          projectError: '',
          projectLoadFailed: false,
          projectSaveBlocked: false,
          ...bumpFocus(this),
        })
        return true
      }
      const revision = this._ledProjectRevision
      this.setData({ projectDialogClosing: true, projectDialogRevision: revision, ...bumpFocus(this) }, () => {
        if (this._ledProjectRevision !== revision || !this.data.projectDialogVisible
          || !this.data.projectDialogClosing || this._pageVisible === false || this._ledUnloaded) return
        const timer = setTimeout(() => {
          if (this._ledProjectCloseTimer !== timer || this._ledProjectRevision !== revision
            || !this.data.projectDialogClosing) return
          this._ledProjectCloseTimer = null
          this._ledProjectFrozen = null
          this.setData({
            projectDialogVisible: false,
            projectDialogClosing: false,
            projectTarget: null,
            projectSaving: false,
            projectError: '',
            projectLoadFailed: false,
            projectSaveBlocked: false,
          })
        }, PROJECT_CLOSE_DURATION)
        this._ledProjectCloseTimer = timer
      })
      return true
    },

    cancelLedProjectDialogForHide() {
      if (this.data.projectDialogVisible) return this.closeProjectDialog(true)
      cancelCloseTimer(this)
      this._ledProjectRevision = (this._ledProjectRevision || 0) + 1
      this._ledProjectFrozen = null
      return false
    },

    stopProjectTap() {},
    preventProjectTouchMove() {},
  }
}

module.exports = { createLedProjectData, createLedProjectMethods }

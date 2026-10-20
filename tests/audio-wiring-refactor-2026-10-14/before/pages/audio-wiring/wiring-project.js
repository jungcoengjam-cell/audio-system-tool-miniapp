const {
  addRecordToProject,
  createProject,
  getProjectRecordView,
  getRecordByPayload,
  getRecords,
  getWorkspaceSnapshot,
  toggleFavorite,
} = require('../../utils/records')
const { vibrate } = require('../../utils/haptics')
const { OUTPUT_OPTIONS, INPUT_OPTIONS } = require('./wiring-model')

const PROJECT_CLOSE_DURATION = 260

const initialData = {
  projectDialogVisible: false,
  projectDialogClosing: false,
  projectDialogStep: 'select',
  projectDialogRevision: 0,
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
  projectFrozenResultText: '',
  projectError: '',
  projectLoadFailed: false,
  projectSaving: false,
  projectSaveBlocked: false,
  projectKeyboardOpen: false,
  projectKeyboardHeight: 0,
  projectKeyboardBottom: 0,
  projectFocusEpisode: 0,
  projectFocusedInputId: '',
  projectViewportHeight: 720,
  projectSheetMaxHeight: 648,
}

function serialize(value) {
  try { return JSON.stringify(value) } catch (error) { return '' }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function preferenceIdentity(preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return ''
  const copy = { ...preferences }
  delete copy.viewMode
  delete copy.face
  if (!Object.prototype.hasOwnProperty.call(copy, 'selections')) copy.selections = {}
  return stableStringify(copy)
}

function isLegacyCompatiblePreferences(preferences, currentPreferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return false
  const manual = preferences.manualSelected
  if (preferences.version !== 1
    || typeof preferences.outputId !== 'string'
    || typeof preferences.inputId !== 'string'
    || !manual || typeof manual !== 'object' || Array.isArray(manual)
    || typeof manual.output !== 'boolean' || typeof manual.input !== 'boolean'
    || !['wiring', 'connectors'].includes(preferences.viewMode)
    || !['mating', 'solder'].includes(preferences.face)) return false

  if (preferences.outputId && !OUTPUT_OPTIONS.some((option) => option.id === preferences.outputId)) return false
  if (preferences.inputId && !INPUT_OPTIONS.some((option) => option.id === preferences.inputId)) return false
  if ((!preferences.outputId && manual.output) || (!preferences.inputId && manual.input)) return false
  if (Object.prototype.hasOwnProperty.call(preferences, 'selections')
    && (!preferences.selections || typeof preferences.selections !== 'object' || Array.isArray(preferences.selections)
      || Object.values(preferences.selections).some((value) => typeof value !== 'string'))) return false

  const comparable = { ...preferences, selections: preferences.selections || {} }
  const current = { ...currentPreferences, selections: currentPreferences.selections || {} }
  delete comparable.viewMode
  delete comparable.face
  delete current.viewMode
  delete current.face
  return stableStringify(comparable) === stableStringify(current)
}

function recordOrder(record, originalIndex) {
  const updatedAt = Number(record && record.updatedAt)
  const createdAt = Number(record && record.createdAt)
  return { originalIndex, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0, createdAt: Number.isFinite(createdAt) ? createdAt : 0 }
}

function findCompatibleRecord(payload) {
  if (!payload || payload.module !== 'audioWiring' || !payload.preferences) return null
  const exact = getRecordByPayload(payload)
  if (exact) return exact
  const records = getRecords()
  return records.map((record, originalIndex) => ({ record, order: recordOrder(record, originalIndex) }))
    .filter(({ record }) => record.module === 'audioWiring'
      && isLegacyCompatiblePreferences(record.preferences, payload.preferences))
    .sort((a, b) => b.order.updatedAt - a.order.updatedAt
      || b.order.createdAt - a.order.createdAt || a.order.originalIndex - b.order.originalIndex)[0]?.record || null
}

function getCompatiblePayload(payload) {
  if (!payload) return null
  const record = findCompatibleRecord(payload)
  return record ? { module: payload.module, preferences: record.preferences } : payload
}

function getProjectSnapshot() {
  try {
    const snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    return snapshot && snapshot.ok !== false ? snapshot : null
  } catch (error) {
    return null
  }
}

function filteredProjects(projects, query) {
  const search = String(query || '').trim().toLocaleLowerCase()
  return search ? projects.filter((project) => String(project.name || '').toLocaleLowerCase().includes(search)) : projects
}

function getWindowHeight() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const height = Number(info && (info.windowHeight || info.screenHeight))
    return Number.isFinite(height) && height > 0 ? height : 720
  } catch (error) {
    return 720
  }
}

function cancelCloseTimer(page) {
  if (page._projectCloseTimer != null) clearTimeout(page._projectCloseTimer)
  page._projectCloseTimer = null
}

function pageCanSave(page) {
  return Boolean(page && page.data && page.data.supported && page.data.model
    && page.data.model.status === 'ready' && page.data.model.connections?.length
    && page._pageVisible !== false && !page._pageUnloaded)
}

function currentProjectPayload(page) {
  const payload = page && typeof page.getRecordPayload === 'function' ? page.getRecordPayload() : null
  if (!payload) return null
  const compatible = getCompatiblePayload(payload)
  return compatible ? { ...payload, preferences: compatible.preferences } : payload
}

function projectMetadataDefaults(payload, projectId) {
  const record = findCompatibleRecord(payload)
  const view = record ? getProjectRecordView(record, projectId) : null
  return view?.hasProjectMetadata
    ? { projectConfigName: view.title, projectConfigNote: view.projectNote || '' }
    : { projectConfigName: payload.title || '', projectConfigNote: '' }
}

function setFocusEpisode(page, hideKeyboard = true) {
  page._projectFocusEpisode = (page._projectFocusEpisode || 0) + 1
  page._projectFocusContext = null
  if (hideKeyboard && page.data.projectKeyboardOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
  return page._projectFocusEpisode
}

function closeDialogNow(page) {
  cancelCloseTimer(page)
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
  }, () => page.renderDiagram())
}

function isInputEventCurrent(page, event, step) {
  const dataset = event?.currentTarget?.dataset || {}
  return Boolean(page.data.projectDialogVisible && !page.data.projectDialogClosing
    && Number(dataset.dialogRevision) === page._projectDialogRevision
    && dataset.step === step && dataset.step === page.data.projectDialogStep)
}

function isDialogActionCurrent(page, event, step) {
  const dataset = event?.currentTarget?.dataset || {}
  return Boolean(page.data.projectDialogVisible && !page.data.projectDialogClosing
    && Number(dataset.dialogRevision) === page._projectDialogRevision
    && dataset.step === step && page.data.projectDialogStep === step)
}

const methods = {
  getRecordLookupPayload() {
    const payload = this.getRecordPayload()
    return getCompatiblePayload(payload)
  },

  findCompatibleWiringRecord(payload = this.getRecordPayload()) {
    return findCompatibleRecord(payload)
  },

  toggleCurrentFavorite() {
    if (!pageCanSave(this)) return false
    const payload = this.getRecordPayload()
    const existing = findCompatibleRecord(payload)
    const savePayload = existing ? { ...payload, preferences: existing.preferences } : payload
    const wasFavorite = Boolean(existing && existing.favorite)
    const record = toggleFavorite(savePayload)
    const removed = wasFavorite && !record && !getRecordByPayload(savePayload)
    if (!record && !removed) {
      wx.showToast({ title: '保存失败，请检查本地存储', icon: 'none' })
      return false
    }
    const currentFavorite = Boolean(findCompatibleRecord(payload)?.favorite)
    this.setData({ currentFavorite })
    vibrate('medium')
    const title = wasFavorite
      ? (currentFavorite ? '当前兼容方案仍已收藏' : '已取消收藏')
      : '已收藏常用'
    wx.showToast({ title, icon: 'none' })
    return true
  },

  invalidateProjectSave() {
    this._projectSaveRequestId = (this._projectSaveRequestId || 0) + 1
    this._projectSavePending = false
    if (this.data?.projectSaving) this.setData({ projectSaving: false })
    if (this.data?.projectDialogVisible && this.data.projectDialogStep === 'confirm') {
      this.setData({
        projectSaveBlocked: true,
        projectError: '当前选型结果已变化，请返回重新选择保存内容。',
      })
    }
  },

  openWiringProjectSheet() {
    if (!pageCanSave(this) || this.data.projectDialogVisible) return false
    const payload = currentProjectPayload(this)
    const frozenSignature = serialize(payload)
    if (!payload || !frozenSignature) return false
    cancelCloseTimer(this)
    this._projectDialogRevision = (this._projectDialogRevision || 0) + 1
    const focusEpisode = setFocusEpisode(this, false)
    this._projectFrozenPayload = JSON.parse(frozenSignature)
    this._projectFrozenSignature = frozenSignature
    this._projectWindowBaseHeight = getWindowHeight()
    this._projectSaveRequestId = (this._projectSaveRequestId || 0) + 1
    this._projectSavePending = false
    const snapshot = getProjectSnapshot()
    const projects = snapshot ? snapshot.projects.map((project) => ({ ...project })) : []
    this.invalidateDiagramRender()
    this.setData({
      ...initialData,
      projectDialogVisible: true,
      projectDialogStep: 'select',
      projectDialogRevision: this._projectDialogRevision,
      projectFocusEpisode: focusEpisode,
      projectProjects: projects,
      filteredProjects: projects,
      projectActiveId: snapshot?.activeProject?.id || '',
      projectFrozenTitle: payload.title,
      projectFrozenSummary: payload.summary,
      projectFrozenResultText: payload.resultText,
      projectLoadFailed: !snapshot,
      projectError: snapshot ? '' : '读取项目列表失败，请检查本地存储后重试。',
      projectViewportHeight: this._projectWindowBaseHeight,
      projectSheetMaxHeight: Math.max(0, Math.floor(this._projectWindowBaseHeight * 0.9)),
    })
    return true
  },

  refreshWiringProjectTargets() {
    const snapshot = getProjectSnapshot()
    if (!snapshot) {
      this.setData({ projectLoadFailed: true, projectError: '读取项目列表失败，请检查本地存储后重试。' })
      return null
    }
    const projects = snapshot.projects.map((project) => ({ ...project }))
    this.setData({
      projectProjects: projects,
      filteredProjects: filteredProjects(projects, this.data.projectSearchText),
      projectActiveId: snapshot.activeProject?.id || '',
      projectLoadFailed: false,
      projectError: '',
    })
    return snapshot
  },

  retryProjectRead(event) {
    if (!isDialogActionCurrent(this, event, this.data.projectDialogStep)) return false
    const snapshot = this.refreshWiringProjectTargets()
    if (snapshot && this.data.projectDialogStep === 'confirm' && this.data.projectTarget) {
      const target = snapshot.projects.find((project) => project.id === this.data.projectTarget.id)
      if (!target || target.name !== this.data.projectTarget.name) {
        this.moveWiringProjectToSelection(snapshot,
          target ? '项目名称已变更，请重新选择。' : '目标项目已不存在，请重新选择。')
      }
    }
  },

  onProjectSearch(event) {
    if (!isInputEventCurrent(this, event, 'select')) return
    const projectSearchText = String(event?.detail?.value || '')
    this.setData({
      projectSearchText,
      filteredProjects: filteredProjects(this.data.projectProjects, projectSearchText),
    })
  },

  beginProjectInputFocus(event) {
    const dataset = event?.currentTarget?.dataset || {}
    if (!isInputEventCurrent(this, event, dataset.step)) return
    this._projectFocusEpisode = (this._projectFocusEpisode || 0) + 1
    this._projectFocusContext = {
      episode: this._projectFocusEpisode,
      revision: this._projectDialogRevision,
      step: dataset.step,
      field: dataset.field || '',
      timeStamp: Number.isFinite(Number(event.timeStamp)) ? Number(event.timeStamp) : null,
    }
    this.setData({
      projectFocusEpisode: this._projectFocusEpisode,
      projectFocusedInputId: dataset.step === 'confirm' ? dataset.field || '' : '',
    })
  },

  endProjectInputFocus(event) {
    const dataset = event?.currentTarget?.dataset || {}
    const focus = this._projectFocusContext
    if (!focus || !isInputEventCurrent(this, event, focus.step)
      || Number(dataset.focusEpisode) !== focus.episode
      || (dataset.field && dataset.field !== focus.field)) return
    this._projectBlurEpisode = focus.episode
  },

  onProjectKeyboardHeightChange(event) {
    const dataset = event?.currentTarget?.dataset || {}
    const focus = this._projectFocusContext
    if (!focus || !isInputEventCurrent(this, event, focus.step)
      || Number(dataset.focusEpisode) !== focus.episode || dataset.field !== focus.field) return
    const eventTime = Number(event.timeStamp ?? event.detail?.timeStamp)
    if (focus.timeStamp !== null && Number.isFinite(eventTime) && eventTime < focus.timeStamp) return
    const keyboardHeight = Math.max(0, Number(event?.detail?.height) || 0)
    if (!keyboardHeight) {
      const episode = setFocusEpisode(this, false)
      this.setData({
        projectFocusEpisode: episode,
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
    const beforeKeyboard = currentHeight < baseHeight ? currentHeight : baseHeight
    const visibleHeight = Math.max(0, Math.min(beforeKeyboard, baseHeight - keyboardHeight))
    this.setData({
      projectKeyboardOpen: true,
      projectKeyboardHeight: keyboardHeight,
      projectKeyboardBottom: currentHeight < baseHeight ? 0 : keyboardHeight,
      projectViewportHeight: visibleHeight,
      projectSheetMaxHeight: Math.max(0, Math.floor(visibleHeight)),
    })
  },

  onProjectNameInput(event) {
    if (!isInputEventCurrent(this, event, 'create')) return false
    this.setData({ projectNameText: String(event?.detail?.value || ''), projectError: '', projectLoadFailed: false })
    return true
  },

  onProjectConfigNameInput(event) {
    if (!isInputEventCurrent(this, event, 'confirm')) return false
    this.setData({ projectConfigName: String(event?.detail?.value || ''), projectNameError: '', projectError: '' })
    return true
  },

  onProjectConfigNoteInput(event) {
    if (!isInputEventCurrent(this, event, 'confirm')) return false
    this.setData({ projectConfigNote: String(event?.detail?.value || ''), projectNoteError: '', projectError: '' })
    return true
  },

  openProjectCreateForm(event) {
    if (!isDialogActionCurrent(this, event, 'select') || this.data.projectLoadFailed) return false
    const episode = setFocusEpisode(this)
    this.setData({
      projectDialogStep: 'create', projectFocusEpisode: episode,
      projectKeyboardOpen: false, projectKeyboardHeight: 0, projectKeyboardBottom: 0,
      projectFocusedInputId: '', projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectNameText: '', projectError: '', projectLoadFailed: false,
    })
    return true
  },

  createProjectFromForm(event) {
    if (!isDialogActionCurrent(this, event, 'create') || this.data.projectSaving) return false
    const name = String(this.data.projectNameText || '').trim()
    if (!name) { this.setData({ projectError: '请输入项目名称。' }); return false }
    if (!this.isWiringProjectPayloadCurrent()) return false
    const snapshot = getProjectSnapshot()
    if (!snapshot || !isDialogActionCurrent(this, event, 'create') || !this.isWiringProjectPayloadCurrent()) {
      if (!snapshot) {
      this.setData({ projectLoadFailed: true, projectError: '读取项目列表失败，请检查本地存储后重试。' })
      }
      return false
    }
    const revision = this._projectDialogRevision
    const project = createProject(name)
    if (!project || revision !== this._projectDialogRevision || !this.data.projectDialogVisible) {
      this.setData({ projectError: '新建失败，请检查项目名称和本地存储。' })
      return false
    }
    const updated = getProjectSnapshot()
    if (!updated) {
      this.setData({ projectLoadFailed: true, projectError: '项目已创建，但读取列表失败；请重试核对。' })
      return false
    }
    const created = updated.projects.find((item) => item.id === project.id)
    if (!created || created.name !== project.name) {
      this.moveWiringProjectToSelection(updated, '项目创建状态已变化，请从列表重新选择。')
      return false
    }
    const episode = setFocusEpisode(this)
    this.setData({
      projectDialogStep: 'confirm', projectFocusEpisode: episode,
      projectKeyboardOpen: false, projectKeyboardHeight: 0, projectKeyboardBottom: 0,
      projectFocusedInputId: '', projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectTarget: { id: created.id, name: created.name, createdInDialog: true },
      ...projectMetadataDefaults(this._projectFrozenPayload, created.id),
      projectNameError: '', projectNoteError: '', projectError: '', projectLoadFailed: false,
      projectActiveId: updated.activeProject?.id || '', projectProjects: updated.projects.map((item) => ({ ...item })),
      filteredProjects: filteredProjects(updated.projects, this.data.projectSearchText),
    })
    return true
  },

  selectProjectTarget(event) {
    if (!isDialogActionCurrent(this, event, 'select') || this.data.projectLoadFailed) return false
    const id = String(event?.currentTarget?.dataset?.id || '')
    const project = this.data.projectProjects.find((item) => item.id === id)
    if (!project) return false
    const episode = setFocusEpisode(this)
    this.setData({
      projectDialogStep: 'confirm', projectFocusEpisode: episode,
      projectKeyboardOpen: false, projectKeyboardHeight: 0, projectKeyboardBottom: 0,
      projectFocusedInputId: '', projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectTarget: { id: project.id, name: project.name, createdInDialog: false },
      ...projectMetadataDefaults(this._projectFrozenPayload, project.id),
      projectNameError: '', projectNoteError: '', projectError: '',
    })
    return true
  },

  moveWiringProjectToSelection(snapshot, error) {
    const projects = snapshot.projects.map((project) => ({ ...project }))
    const episode = setFocusEpisode(this, false)
    this.setData({
      projectDialogStep: 'select', projectFocusEpisode: episode,
      projectProjects: projects, filteredProjects: filteredProjects(projects, this.data.projectSearchText),
      projectActiveId: snapshot.activeProject?.id || '', projectTarget: null,
      projectConfigName: '', projectConfigNote: '', projectNameError: '', projectNoteError: '',
      projectKeyboardOpen: false, projectKeyboardHeight: 0, projectKeyboardBottom: 0,
      projectFocusedInputId: '', projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectLoadFailed: false, projectError: error || '', projectSaveBlocked: false,
      projectSaving: false,
    })
  },

  returnToProjectSelection(event) {
    if (!isDialogActionCurrent(this, event, this.data.projectDialogStep)) return false
    if (this.data.projectSaveBlocked || !this.isWiringProjectPayloadCurrent()) {
      return this.closeProjectDialog(true) && this.openWiringProjectSheet()
    }
    const snapshot = this.refreshWiringProjectTargets()
    if (!snapshot) return false
    this.moveWiringProjectToSelection(snapshot, '')
    return true
  },

  isWiringProjectPayloadCurrent() {
    const current = currentProjectPayload(this)
    if (this._projectFrozenSignature && serialize(current) === this._projectFrozenSignature) return true
    this.setData({
      projectError: '当前选型结果已变化，请返回重新选择保存内容。',
      projectSaveBlocked: true,
    })
    return false
  },

  saveProjectTarget(event) {
    if (!isDialogActionCurrent(this, event, 'confirm') || this._projectSavePending
      || this.data.projectDialogStep !== 'confirm' || !this.data.projectTarget || this.data.projectSaveBlocked) return false
    const name = String(this.data.projectConfigName || '').trim()
    const note = String(this.data.projectConfigNote || '').trim()
    const projectNameError = !name ? '请输入配置名称。' : name.length > 60 ? '配置名称最多 60 个字符。' : ''
    const projectNoteError = note.length > 200 ? '备注最多 200 个字符。' : ''
    if (projectNameError || projectNoteError) {
      this.setData({ projectNameError, projectNoteError })
      return false
    }
    if (!this.isWiringProjectPayloadCurrent() || !this._projectFrozenPayload) return false
    const target = { ...this.data.projectTarget }
    const payload = this._projectFrozenPayload
    const requestId = (this._projectSaveRequestId || 0) + 1
    this._projectSaveRequestId = requestId
    this._projectSavePending = true
    const current = () => requestId === this._projectSaveRequestId && this._projectSavePending
      && this.data.projectDialogVisible && !this.data.projectDialogClosing
      && this.data.projectDialogStep === 'confirm' && !this._pageUnloaded
      && this._pageVisible !== false && serialize(currentProjectPayload(this)) === this._projectFrozenSignature
    const abortStaleRequest = () => {
      if (requestId !== this._projectSaveRequestId || !this._projectSavePending) return false
      this._projectSavePending = false
      const visibleConfirmation = this.data.projectDialogVisible && !this.data.projectDialogClosing
        && this.data.projectDialogStep === 'confirm' && !this._pageUnloaded && this._pageVisible !== false
      this.setData(visibleConfirmation ? {
        projectSaving: false,
        projectSaveBlocked: true,
        projectError: '当前选型结果或兼容记录已变化，请返回重新选择保存内容。',
      } : { projectSaving: false })
      return false
    }
    this.setData({ projectSaving: true, projectError: '', projectLoadFailed: false })
    const snapshot = getProjectSnapshot()
    if (!current()) return abortStaleRequest()
    if (!snapshot) {
      this._projectSavePending = false
      this.setData({ projectSaving: false, projectLoadFailed: true, projectError: '读取项目列表失败，请重试。' })
      return false
    }
    const project = snapshot.projects.find((item) => item.id === target.id)
    if (!project || project.name !== target.name) {
      this._projectSavePending = false
      this.moveWiringProjectToSelection(snapshot,
        project ? '项目名称已变更，请重新选择。' : '目标项目已不存在，请重新选择。')
      return false
    }
    if (!current()) return abortStaleRequest()
    const saved = addRecordToProject(payload, project.id, { name, note })
    if (!saved) {
      if (!current()) return abortStaleRequest()
      this._projectSavePending = false
      this.setData({ projectSaving: false, projectError: '保存失败，请检查本地存储后重试。' })
      return false
    }
    if (!current()) return abortStaleRequest()
    const verified = getProjectSnapshot()
    if (!current()) return abortStaleRequest()
    const signature = JSON.stringify([payload.module, payload.preferences])
    const persisted = verified?.records.find((record) => record.signature === signature
      && record.projectIds?.includes(project.id))
    const view = persisted ? getProjectRecordView(persisted, project.id) : null
    if (!verified || !persisted || !view?.hasProjectMetadata || view.title !== name || view.projectNote !== note) {
      this._projectSavePending = false
      this.setData({ projectSaving: false, projectLoadFailed: !verified, projectError: '暂时无法核对保存状态，请重试确认。' })
      return false
    }
    this._projectSavePending = false
    const episode = setFocusEpisode(this)
    this.setData({
      projectDialogStep: 'success', projectFocusEpisode: episode,
      projectKeyboardOpen: false, projectKeyboardHeight: 0, projectKeyboardBottom: 0,
      projectFocusedInputId: '', projectViewportHeight: this._projectWindowBaseHeight || 720,
      projectSheetMaxHeight: Math.max(0, Math.floor((this._projectWindowBaseHeight || 720) * 0.9)),
      projectSaving: false, projectError: '', projectSavedConfigName: name,
      projectNameError: '', projectNoteError: '', projectLoadFailed: false,
    })
    vibrate('medium')
    return true
  },

  closeProjectDialog(eventOrImmediate = false) {
    const immediate = eventOrImmediate === true
    if (eventOrImmediate && typeof eventOrImmediate === 'object'
      && !isDialogActionCurrent(this, eventOrImmediate, this.data.projectDialogStep)) return false
    if (!this.data.projectDialogVisible) { cancelCloseTimer(this); return false }
    if (this.data.projectDialogClosing && immediate !== true) return false
    this.invalidateProjectSave()
    this._projectDialogRevision = (this._projectDialogRevision || 0) + 1
    const episode = setFocusEpisode(this)
    this._projectFrozenPayload = null
    this._projectFrozenSignature = ''
    cancelCloseTimer(this)
    if (immediate === true || !this._pageVisible || this._pageUnloaded) {
      closeDialogNow(this)
      return true
    }
    const revision = this._projectDialogRevision
    this.setData({ projectDialogClosing: true, projectDialogRevision: revision, projectFocusEpisode: episode }, () => {
      if (revision !== this._projectDialogRevision || !this.data.projectDialogClosing || !this.data.projectDialogVisible) return
      const timer = setTimeout(() => {
        if (this._projectCloseTimer !== timer || revision !== this._projectDialogRevision || !this.data.projectDialogClosing) return
        this._projectCloseTimer = null
        closeDialogNow(this)
      }, PROJECT_CLOSE_DURATION)
      this._projectCloseTimer = timer
    })
    return true
  },

  stopProjectTap() {},
  preventProjectTouchMove() {},
  preventTouchMove() {},
}

module.exports = {
  findCompatibleRecord,
  getCompatiblePayload,
  initialData,
  methods,
}

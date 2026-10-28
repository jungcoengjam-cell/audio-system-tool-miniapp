const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const { vibrate } = require('../../utils/haptics')
const {
  MODULES,
  getModuleMetadata,
  getStorageHealth,
  getProjectRecordView,
  getWorkspaceSnapshot,
  deleteProject,
  removeRecordFromProject,
  saveProjectWiring,
  updateProject,
} = require('../../utils/records')
const { openProjectDraft, openRecordEditor } = require('../../utils/result-record-context')
const { readLightingWorkspace, calculateScheme, saveLightingScheme } = require('../dmx-layout/lighting-workspace')
const { buildProjectContentView } = require('./project-view-model')

const PROJECT_VIEW_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'calculations', label: '计算记录' },
  { key: 'wiring', label: '线路' },
  { key: 'lighting', label: '灯位' },
]

const PROJECT_SWIPE_ACTION_WIDTH = 72
const PROJECT_SWIPE_START_THRESHOLD = 7
const PROJECT_SWIPE_LOCK_RATIO = 1.3
const PROJECT_SWIPE_SUPPRESS_MS = 350

function projectRecordFingerprint(record) {
  if (!record || typeof record !== 'object') return ''
  const snapshot = { ...record }
  delete snapshot.createdAt
  delete snapshot.updatedAt
  return JSON.stringify(snapshot)
}

function projectSwipeItem(page, type, item) {
  const id = String(item && (type === 'lighting' ? item.stableId : item.id) || '')
  const key = `${type}:${id}`
  const openSwipe = page._projectOpenSwipe
  const gesture = page._projectSwipeGesture
  const active = openSwipe && openSwipe.key === key ? openSwipe : null
  return {
    ...item,
    swipeKey: key,
    swipeOpen: Boolean(active && active.offset === -PROJECT_SWIPE_ACTION_WIDTH),
    swipeOffset: active ? active.offset : 0,
    swipeDragging: Boolean(gesture && gesture.key === key && gesture.axis === 'horizontal'),
  }
}

function projectSwipeItemPath(page, type, id) {
  if (type === 'line') {
    const index = (page.data.wiringLines || []).findIndex((item) => item && String(item.id) === id)
    return index >= 0 ? `wiringLines[${index}]` : ''
  }
  if (type === 'lighting') {
    const index = (page.data.lightingFixtures || []).findIndex((item) => item && String(item.stableId) === id)
    return index >= 0 ? `lightingFixtures[${index}]` : ''
  }
  if (type !== 'record') return ''
  for (let groupIndex = 0; groupIndex < (page.data.recordGroups || []).length; groupIndex += 1) {
    const group = page.data.recordGroups[groupIndex]
    const recordIndex = (group.records || []).findIndex((item) => item && String(item.id) === id)
    if (recordIndex >= 0) return `recordGroups[${groupIndex}].records[${recordIndex}]`
  }
  return ''
}

function updateProjectSwipeOffset(page, type, id, offset, dragging = false) {
  const path = projectSwipeItemPath(page, type, id)
  if (!path) return false
  const value = Math.max(-PROJECT_SWIPE_ACTION_WIDTH, Math.min(0, Number(offset) || 0))
  const key = `${type}:${id}`
  page._projectOpenSwipe = value < 0 ? { key, type, id, offset: value } : null
  page.setData({
    [`${path}.swipeOpen`]: value === -PROJECT_SWIPE_ACTION_WIDTH && !dragging,
    [`${path}.swipeOffset`]: value,
    [`${path}.swipeDragging`]: Boolean(dragging),
  })
  return true
}

function closeProjectSwipe(page, preserveGesture = false) {
  const active = page._projectOpenSwipe
  if (!preserveGesture) page._projectSwipeGesture = null
  page._projectSwipeSuppress = null
  if (!active) return
  updateProjectSwipeOffset(page, active.type, active.id, 0, false)
}

function invalidateProjectDeletion(page) {
  page._projectDeletionToken = (page._projectDeletionToken || 0) + 1
  page._projectDeletionPending = null
}

function isCurrentProjectDeletion(page, request) {
  return Boolean(request && page._projectDeletionPending === request
    && page._projectDeletionToken === request.token
    && page._projectVisible && !page._projectDestroyed
    && page.projectId === request.projectId
    && page._projectSessionToken === request.sessionToken
    && page._projectRefreshToken === request.refreshToken
    && page._projectInteractionToken === request.interactionToken)
}

function releaseProjectDeletion(page, request) {
  if (page._projectDeletionPending !== request || page._projectDeletionToken !== request.token) return false
  page._projectDeletionPending = null
  return true
}

function consumeProjectSwipeTap(page, type, id) {
  const key = `${type}:${id}`
  const suppressed = page._projectSwipeSuppress
  if (suppressed && suppressed.key === key && Date.now() <= suppressed.until) {
    page._projectSwipeSuppress = null
    closeProjectSwipe(page)
    return true
  }
  if (page._projectOpenSwipe) {
    closeProjectSwipe(page)
    return true
  }
  return false
}

function prepareProjectNavigation(page) {
  page._projectInteractionToken = (page._projectInteractionToken || 0) + 1
  invalidateProjectDeletion(page)
  closeProjectSwipe(page)
}

function filterProjectRows(page) {
  const view = buildProjectContentView({
    projectId: page.projectId,
    records: page.rawRecords || [],
    filter: page.data.projectViewFilter,
    searchText: page.data.projectSearchText,
    wiringSchedule: page._projectWiringSchedule,
    lightingFixtures: page._projectLightingFixtures,
    lightingReadError: page.data.project?.lightingReadError,
  })
  const recordGroups = groupRecords(decorateRecords(view.visibleRecords)).map((group) => ({
    ...group,
    records: group.records.map((record) => projectSwipeItem(page, 'record', record)),
  }))
  const wiringLines = view.visibleWiringLines.map((line) => projectSwipeItem(page, 'line', line))
  const positionsById = page._projectLightingScheme?.layout?.positionsById
  const lightingFixtures = view.visibleLightingFixtures.map((fixture) => {
    const position = positionsById && positionsById[fixture.stableId]
    return projectSwipeItem(page, 'lighting', {
      ...fixture,
      isPlaced: Boolean(position && typeof position === 'object' && position.rodId),
    })
  })
  page.setData({
    recordGroups: view.showCalculations ? recordGroups : [],
    visibleRecordCount: view.visibleRecords.length,
    wiringLines,
    lightingFixtures,
    showWiring: view.showWiring,
    showLighting: view.showLighting,
    showCalculations: view.showCalculations,
    projectSearchEmpty: view.isSearchEmpty,
    projectTypeEmpty: view.isTypeEmpty,
  })
}

function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

function formatTime(timestamp, includeYear = false) {
  const date = new Date(timestamp)
  const dateText = includeYear
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${dateText} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDate(timestamp) {
  return formatTime(timestamp, true).slice(0, 10)
}

function showStoredLegacyResult(record) {
  const resultText = String(record?.resultText || record?.summary || '')
  if (!resultText) return
  const content = resultText.length > 1200
    ? `${resultText.slice(0, 1200)}\n\n完整结果可点击复制。`
    : resultText
  wx.showModal({
    title: record.title || '已保存的会议室结果',
    content,
    confirmText: '复制结果',
    cancelText: '关闭',
    success: ({ confirm }) => {
      if (!confirm) return
      wx.setClipboardData({
        data: resultText,
        success: () => wx.showToast({ title: '已复制完整结果', icon: 'none' }),
        fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
      })
    },
  })
}

function decorateRecords(records) {
  return records.map((record, index) => {
    const metadata = getModuleMetadata(record.module)
    const decorated = {
      id: record.id,
      module: record.module,
      displayIndex: index + 1,
      moduleLabel: metadata?.label || '计算',
      trustLabel: metadata?.trustLabel || '计算结果',
      theme: metadata?.theme || 'cyan',
      retired: Boolean(metadata?.retired),
      timeText: formatTime(record.updatedAt),
      title: record.title,
      summary: record.summary,
    }
    if (record.hasProjectMetadata) {
      decorated.updatedAt = record.updatedAt
      decorated.hasProjectMetadata = true
      decorated.projectNote = record.projectNote
    }
    return decorated
  })
}

function groupRecords(records) {
  const grouped = Object.create(null)
  const modules = [...Object.keys(MODULES), ...new Set(records
    .filter((record) => getModuleMetadata(record.module)?.retired)
    .map((record) => record.module))]
  modules.forEach((module) => { grouped[module] = [] })
  records.forEach((record) => {
    if (grouped[record.module]) grouped[record.module].push(record)
  })
  return modules.map((module) => {
    const metadata = getModuleMetadata(module)
    return {
      module,
      label: metadata.label,
      theme: metadata.theme,
      trustLabel: metadata.trustLabel,
      trustDescription: metadata.trustDescription,
      records: grouped[module],
    }
  }).filter((group) => group.records.length)
}

function getModuleProgress(records) {
  const counts = Object.create(null)
  records.forEach((record) => { counts[record.module] = (counts[record.module] || 0) + 1 })
  return Object.entries(MODULES).map(([key, module]) => {
    const count = counts[key] || 0
    return {
      key,
      label: module.label,
      theme: module.theme,
      count,
      complete: count > 0,
      statusText: count ? `${count} 条结果` : '尚未计算',
      actionText: count ? '继续计算' : '开始计算',
    }
  })
}

function getProjectWiringSummary(project) {
  const lines = Array.isArray(project && project.wiringSchedule && project.wiringSchedule.lines)
    ? project.wiringSchedule.lines
    : []
  return {
    lineCount: lines.length,
    pendingCount: lines.filter((line) => line && line.status !== 'checked').length,
  }
}

Page({
  data: {
    project: null,
    projectViewFilters: PROJECT_VIEW_FILTERS,
    projectViewFilter: 'all',
    projectSearchText: '',
    records: [],
    recordGroups: [],
    wiringLines: [],
    lightingFixtures: [],
    moduleProgress: [],
    moduleOptions: [],
    visibleRecordCount: 0,
    showWiring: false,
    showLighting: false,
    showCalculations: true,
    projectSearchEmpty: false,
    projectTypeEmpty: false,
    projectScrollTop: 0,
    storageHealth: null,
    editing: false,
    renameVisible: false,
    renameClosing: false,
    renameDraft: '',
    projectForm: {
      name: '',
      venueName: '',
      engineer: '',
      projectDate: '',
      notes: '',
      roomLengthText: '',
      roomWidthText: '',
      roomHeightText: '',
    },
    missing: false,
  },

  onLoad(options) {
    this.projectId = options.id || ''
    this._projectSessionToken = (this._projectSessionToken || 0) + 1
    this._projectInteractionToken = 0
    this._projectRefreshToken = 0
    this._projectVisible = true
    this._projectDestroyed = false
    this._renameCloseRevision = (this._renameCloseRevision || 0) + 1
    this._renameCloseTimer = null
    this._canonicalProjectRecordSnapshots = new Map()
    this._skipNextShowRefresh = true
    this.refresh({ forceRefresh: true })
    this.setData({ moduleOptions: Object.keys(MODULES).filter((key) => key !== 'dmxAddress').map((key) => ({ key, label: MODULES[key].label })) })
  },

  onShow() {
    this._projectVisible = true
    if (this._skipNextShowRefresh) {
      this._skipNextShowRefresh = false
      return
    }
    if (this.projectId && !this.data.editing) this.refresh({ forceRefresh: true })
  },

  onHide() {
    this._projectVisible = false
    this._projectInteractionToken = (this._projectInteractionToken || 0) + 1
    invalidateProjectDeletion(this)
    closeProjectSwipe(this)
    const renameWasClosing = this.data.renameClosing
    this.cancelRenameProjectClose()
    if (renameWasClosing && this.data.renameVisible) {
      this.setData({ renameVisible: false, renameClosing: false })
    }
  },

  onProjectScroll(event) {
    this._projectScrollTop = Number(event.detail && event.detail.scrollTop) || 0
    if (this._projectOpenSwipe || this._projectDeletionPending) {
      this._projectInteractionToken = (this._projectInteractionToken || 0) + 1
      invalidateProjectDeletion(this)
    }
    closeProjectSwipe(this, true)
  },

  onUnload() {
    this._projectDestroyed = true
    this._projectVisible = false
    this._projectSessionToken = (this._projectSessionToken || 0) + 1
    this._projectInteractionToken = (this._projectInteractionToken || 0) + 1
    invalidateProjectDeletion(this)
    closeProjectSwipe(this)
    this.cancelRenameProjectClose()
    printPerformanceSummary('项目详情/')
  },

  refresh(options = {}) {
    this._projectRefreshToken = (this._projectRefreshToken || 0) + 1
    invalidateProjectDeletion(this)
    closeProjectSwipe(this)
    const finishRefresh = startMeasurement('项目详情/刷新总耗时')
    const snapshot = getWorkspaceSnapshot({
      forceRefresh: options.forceRefresh === true || Boolean(this.data.workspaceError),
    })
    if (snapshot.ok === false) {
      this.setData({
        workspaceError: snapshot.error || '本地项目和收藏数据读取失败，请重试。',
      })
      finishRefresh({ storageError: true })
      return
    }
    const { projects, records: allRecords } = snapshot
    const project = projects.find((item) => item.id === this.projectId) || null
    if (!project) {
      if (this.projectViewSignature === 'missing') {
        if (this.data.workspaceError) this.setData({ workspaceError: '' })
        finishRefresh({ skipped: true, missing: true })
        return
      }
      this.projectViewSignature = 'missing'
      this.rawRecords = []
      this._canonicalProjectRecordSnapshots = new Map()
      this._projectLightingScheme = null
      this._projectLightingRevision = null
      this._projectLightingFixtures = []
      const finishViewUpdate = startMeasurement('项目详情/setData视图更新', { missing: true })
      this.setData({
        project: null,
        records: [],
        recordGroups: [],
        moduleProgress: [],
        ...(this.data.workspaceError ? { workspaceError: '' } : {}),
        missing: true,
      }, () => {
        finishViewUpdate()
        finishRefresh({ missing: true })
      })
      wx.setNavigationBarTitle({ title: '项目不存在' })
      return
    }
    this._projectWiringSchedule = project.wiringSchedule || {}
    const lightingState = readLightingWorkspace(project.id)
    this._projectLightingScheme = lightingState.ok ? lightingState.scheme : null
    this._projectLightingRevision = lightingState.ok ? Number(lightingState.revision) || 0 : null
    const lightingCalculation = lightingState.ok && lightingState.scheme
      ? calculateScheme(lightingState.scheme)
      : null
    const lightingFixtureCount = lightingCalculation?.ok && lightingCalculation.valid
      ? lightingCalculation.result.fixtures.length
      : 0
    this._projectLightingFixtures = lightingCalculation?.ok && lightingCalculation.valid
      ? lightingCalculation.result.fixtures
      : []

    const rawRecords = allRecords.filter((record) => record.projectIds?.includes(project.id))
      .map((record) => getProjectRecordView(record, project.id))
    this._canonicalProjectRecordSnapshots = new Map(allRecords
      .filter((record) => record.projectIds?.includes(project.id))
      .map((record) => [String(record.id), projectRecordFingerprint(record)]))
    const { wiringSchedule, ...projectViewFields } = project
    const wiringSummary = getProjectWiringSummary(project)
    const viewSignature = JSON.stringify({
      project: projectViewFields,
      wiringSummary,
      wiringRevision: Number(wiringSchedule && wiringSchedule.revision) || 0,
      lightingRevision: Number(lightingState.revision) || 0,
      lightingScheme: lightingState.ok ? lightingState.scheme : null,
      records: rawRecords.map((record) => {
        const signatureRecord = {
          id: record.id,
          updatedAt: record.updatedAt,
          favorite: record.favorite,
          projectIds: record.projectIds,
        }
        if (record.hasProjectMetadata) {
          signatureRecord.title = record.title
          signatureRecord.hasProjectMetadata = true
          signatureRecord.projectNote = record.projectNote
        }
        return signatureRecord
      }),
    })
    if (viewSignature === this.projectViewSignature) {
      if (this.data.workspaceError) this.setData({ workspaceError: '' })
      finishRefresh({ skipped: true, records: rawRecords.length })
      return
    }
    this.projectViewSignature = viewSignature
    const finishBuildView = startMeasurement('项目详情/整理项目记录', { records: rawRecords.length })
    const records = decorateRecords(rawRecords)
    const recordGroups = groupRecords(records)
    const normalizedProject = {
      ...projectViewFields,
      venueName: project.venueName || '',
      engineer: project.engineer || '',
      projectDate: project.projectDate || formatDate(project.createdAt),
      notes: project.notes || '',
      roomLengthText: project.roomLengthText || '',
      roomWidthText: project.roomWidthText || '',
      roomHeightText: project.roomHeightText || '',
      standardClassKey: project.standardClassKey || 'conference',
      gradeKey: project.gradeKey || 'II',
      dimensionText: project.roomLengthText && project.roomWidthText && project.roomHeightText
        ? `${project.roomLengthText} × ${project.roomWidthText} × ${project.roomHeightText} m`
        : '未填写',
      recordCount: records.length,
      timeText: formatTime(project.updatedAt),
      wiringLineCount: wiringSummary.lineCount,
      wiringPendingCount: wiringSummary.pendingCount,
      hasLighting: Boolean(lightingState.ok && lightingState.exists),
      lightingRevision: Number(lightingState.revision) || 0,
      lightingFixtureCount,
      lightingReadError: lightingState.ok ? '' : lightingState.error,
    }
    this.rawRecords = rawRecords
    this._projectWiringSchedule = project.wiringSchedule || {}
    finishBuildView({ groups: recordGroups.length })
    const finishViewUpdate = startMeasurement('项目详情/setData视图更新', { records: records.length })
    this.setData({
      project: normalizedProject,
      records: records.map(({ id, module }) => ({ id, module })),
      recordGroups,
      moduleProgress: getModuleProgress(records),
      projectScrollTop: this._projectScrollTop || 0,
      storageHealth: getStorageHealth(),
      ...(this.data.workspaceError ? { workspaceError: '' } : {}),
      missing: false,
    }, () => {
      filterProjectRows(this)
      finishViewUpdate()
      finishRefresh({ records: records.length, groups: recordGroups.length })
    })
    wx.setNavigationBarTitle({ title: '项目详情' })
  },

  retryWorkspace() {
    this.refresh({ forceRefresh: true })
  },

  startEditProject() {
    const project = this.data.project
    if (!project || this.data.workspaceError) return
    this.setData({
      editing: true,
      projectForm: {
        name: project.name,
        venueName: project.venueName,
        engineer: project.engineer,
        projectDate: project.projectDate,
        notes: project.notes,
        roomLengthText: project.roomLengthText,
        roomWidthText: project.roomWidthText,
        roomHeightText: project.roomHeightText,
      },
    })
  },

  cancelEditProject() {
    this.setData({ editing: false })
  },

  onProjectFieldInput(event) {
    const field = event.currentTarget.dataset.field
    if (!Object.prototype.hasOwnProperty.call(this.data.projectForm, field)) return
    this.setData({
      projectForm: { ...this.data.projectForm, [field]: event.detail.value },
    })
  },

  onProjectDateChange(event) {
    const projectDate = event.detail.value
    const changed = projectDate !== this.data.projectForm.projectDate
    this.setData({
      projectForm: { ...this.data.projectForm, projectDate },
    })
    if (changed) vibrate('light')
  },

  openProjectModule(event) {
    if (this.data.workspaceError) return
    this.launchProjectModule(String(event.currentTarget.dataset.module || ''))
  },

  launchProjectModule(moduleKey) {
    if (this.data.workspaceError) return false
    if (!this.projectId || !MODULES[moduleKey]) return false
    prepareProjectNavigation(this)
    if (moduleKey === 'dmxAddress') {
      wx.navigateTo({ url: `${MODULES.dmxAddress.path}?lightingProjectId=${encodeURIComponent(this.projectId)}` })
      return true
    }
    const sessionId = openProjectDraft(moduleKey, this.projectId)
    if (!sessionId) {
      wx.showToast({ title: '无法打开项目计算，请检查本地存储', icon: 'none' })
      return false
    }
    return true
  },

  openAddProjectModule() {
    if (this.data.workspaceError) return
    wx.showActionSheet({
      itemList: ['计算记录', '通道与线缆', '灯位方案'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) this.openProjectCalculatorPicker()
        if (tapIndex === 1) this.openProjectWiring()
        if (tapIndex === 2) this.openProjectLighting()
      },
    })
  },

  openProjectCalculatorPicker(start = 0, starts = [0]) {
    const options = this.data.moduleOptions || []
    const previous = start > 0
    const pageSize = previous ? 4 : 5
    const rows = options.slice(start, start + pageSize)
    const actions = rows.map((item) => ({ key: item.key }))
    const itemList = rows.map((item) => item.label)
    if (previous) {
      itemList.push('上一页')
      actions.push({ type: 'previous' })
    }
    if (start + rows.length < options.length) {
      itemList.push('下一页')
      actions.push({ type: 'next', start: start + rows.length })
    }
    wx.showActionSheet({
      itemList,
      success: ({ tapIndex }) => {
        const action = actions[tapIndex]
        if (!action) return
        if (action.type === 'previous') {
          const back = starts.slice(0, -1)
          return this.openProjectCalculatorPicker(back[back.length - 1] || 0, back)
        }
        if (action.type === 'next') return this.openProjectCalculatorPicker(action.start, [...starts, action.start])
        this.launchProjectModule(action.key)
      },
    })
  },

  openManagementMenu() {
    if (this.data.workspaceError || !this.data.project) return
    const actions = [
      { key: 'rename', label: '重命名' },
      { key: 'edit', label: '编辑项目资料' },
      { key: 'delete', label: '删除项目' },
    ]
    wx.showActionSheet({
      itemList: actions.map((item) => item.label),
      success: ({ tapIndex }) => {
        const action = actions[tapIndex]?.key
        if (action === 'rename') this.startRenameProject()
        if (action === 'edit') this.startEditProject()
        if (action === 'delete') this.confirmDeleteProject()
      },
    })
  },

  startRenameProject() {
    if (!this.data.project || this.data.workspaceError) return
    this.cancelRenameProjectClose()
    this.setData({ renameDraft: this.data.project.name, renameVisible: true, renameClosing: false })
  },

  cancelRenameProjectClose() {
    if (this._renameCloseTimer) clearTimeout(this._renameCloseTimer)
    this._renameCloseTimer = null
    this._renameCloseRevision = (this._renameCloseRevision || 0) + 1
  },

  closeRenameProject() {
    if (!this.data.renameVisible || this.data.renameClosing) return
    if (this._renameCloseTimer) clearTimeout(this._renameCloseTimer)
    this._renameCloseTimer = null
    const closeRevision = (this._renameCloseRevision || 0) + 1
    this._renameCloseRevision = closeRevision
    this.setData({ renameClosing: true }, () => {
      if (this._projectDestroyed || this._renameCloseRevision !== closeRevision
        || !this.data.renameVisible || !this.data.renameClosing) return
      const timer = setTimeout(() => {
        if (this._renameCloseTimer === timer) this._renameCloseTimer = null
        if (this._projectDestroyed || this._renameCloseRevision !== closeRevision
          || !this.data.renameVisible || !this.data.renameClosing) return
        this.setData({ renameVisible: false, renameClosing: false })
      }, 180)
      this._renameCloseTimer = timer
    })
  },

  onRenameInput(event) {
    this.setData({ renameDraft: event.detail.value || '' })
  },

  saveRenameProject() {
    const project = this.data.project
    const projectId = this.projectId
    const name = String(this.data.renameDraft || '').trim().slice(0, 30)
    if (!project || project.id !== projectId || !name || this.data.workspaceError) return
    const updated = updateProject(projectId, { name })
    if (!updated) {
      wx.showToast({ title: '项目名称为空或已存在', icon: 'none' })
      return
    }
    this.closeRenameProject()
    this.refresh({ forceRefresh: true })
    vibrate('medium')
    wx.showToast({ title: '项目已重命名', icon: 'none' })
  },

  confirmDeleteProject() {
    const project = this.data.project
    const projectId = this.projectId
    if (!project || project.id !== projectId || this.data.workspaceError) return
    const wiringCount = Number(project.wiringLineCount) || 0
    const lightingCount = Number(project.lightingFixtureCount) || 0
    const details = [
      `${project.recordCount || 0} 条计算记录`,
      `${wiringCount} 条线路`,
      `${project.hasLighting ? 1 : 0} 个灯位方案${lightingCount ? `（${lightingCount} 个灯位）` : ''}`,
    ].join('、')
    const modalOptions = {
      title: '移入回收站？',
      content: `“${project.name}”及${details}将移入回收站，可在“项目与记录 > 回收站”恢复。独立收藏不会删除。`,
      confirmText: '移入',
      confirmColor: '#ff3b30',
      success: ({ confirm }) => {
        if (!confirm || this.projectId !== projectId || this.data.project?.id !== projectId) return
        if (!deleteProject(projectId)) {
          wx.showToast({ title: '移入回收站失败，请重试', icon: 'none' })
          return
        }
        if (this._projectVisible && !this._projectDestroyed) vibrate('medium')
        wx.showToast({ title: '已移入回收站', icon: 'none' })
        wx.navigateBack({ delta: 1 })
      },
      fail: () => wx.showToast({ title: '确认失败，请重试', icon: 'none' }),
    }
    try {
      wx.showModal(modalOptions)
    } catch (error) {
      wx.showToast({ title: '确认失败，请重试', icon: 'none' })
    }
  },

  openProjectLighting(event) {
    const fixtureId = String(event?.currentTarget?.dataset?.id || '')
    if (fixtureId && consumeProjectSwipeTap(this, 'lighting', fixtureId)) return
    if (this.data.workspaceError || !this.projectId) return
    prepareProjectNavigation(this)
    const module = MODULES.dmxAddress
    wx.navigateTo({ url: `${module.path}?lightingProjectId=${encodeURIComponent(this.projectId)}` })
  },

  openProjectReport() {
    if (!this.projectId || this.data.workspaceError) return
    prepareProjectNavigation(this)
    wx.navigateTo({ url: `/pages/records/report?id=${encodeURIComponent(this.projectId)}` })
  },

  onProjectViewFilterTap(event) {
    const projectViewFilter = String(event.currentTarget.dataset.key || 'all')
    const changed = PROJECT_VIEW_FILTERS.some((item) => item.key === projectViewFilter)
      && projectViewFilter !== this.data.projectViewFilter
    this._projectInteractionToken = (this._projectInteractionToken || 0) + 1
    invalidateProjectDeletion(this)
    closeProjectSwipe(this)
    this.setData({ projectViewFilter }, () => filterProjectRows(this))
    if (changed) vibrate('light')
  },

  onProjectSearchInput(event) {
    this._projectInteractionToken = (this._projectInteractionToken || 0) + 1
    invalidateProjectDeletion(this)
    closeProjectSwipe(this)
    this.setData({ projectSearchText: event.detail.value || '' }, () => filterProjectRows(this))
  },

  clearProjectSearch() {
    this._projectInteractionToken = (this._projectInteractionToken || 0) + 1
    invalidateProjectDeletion(this)
    closeProjectSwipe(this)
    this.setData({ projectSearchText: '' }, () => filterProjectRows(this))
  },

  onProjectSwipeStart(event) {
    if (this.data.workspaceError || !this.data.project || !this._projectVisible || this._projectDeletionPending) return
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
    const type = String(dataset.swipeType || '')
    const id = String(dataset.swipeId || '')
    const point = event && event.touches && event.touches[0]
    if (!['record', 'line', 'lighting'].includes(type) || !id || !point) return
    const active = this._projectOpenSwipe
    if (active && active.key !== `${type}:${id}`) closeProjectSwipe(this)
    const current = this._projectOpenSwipe && this._projectOpenSwipe.key === `${type}:${id}`
      ? this._projectOpenSwipe.offset : 0
    this._projectSwipeGesture = {
      type,
      id,
      key: `${type}:${id}`,
      startX: Number(point.clientX),
      startY: Number(point.clientY),
      startOffset: current,
      lastOffset: current,
      axis: '',
    }
  },

  onProjectSwipeMove(event) {
    const gesture = this._projectSwipeGesture
    const point = event && event.touches && event.touches[0]
    if (!gesture || !point) return
    const deltaX = Number(point.clientX) - gesture.startX
    const deltaY = Number(point.clientY) - gesture.startY
    if (!gesture.axis) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < PROJECT_SWIPE_START_THRESHOLD) return
      if (Math.abs(deltaX) >= Math.abs(deltaY) * PROJECT_SWIPE_LOCK_RATIO) gesture.axis = 'horizontal'
      else if (Math.abs(deltaY) >= Math.abs(deltaX)) gesture.axis = 'vertical'
      else return
    }
    if (gesture.axis !== 'horizontal') return
    gesture.lastOffset = Math.max(-PROJECT_SWIPE_ACTION_WIDTH, Math.min(0, gesture.startOffset + deltaX))
    updateProjectSwipeOffset(this, gesture.type, gesture.id, gesture.lastOffset, true)
  },

  onProjectSwipeEnd() {
    const gesture = this._projectSwipeGesture
    if (!gesture) return
    if (gesture.axis === 'horizontal') {
      const offset = gesture.lastOffset <= -PROJECT_SWIPE_ACTION_WIDTH / 2 ? -PROJECT_SWIPE_ACTION_WIDTH : 0
      updateProjectSwipeOffset(this, gesture.type, gesture.id, offset, false)
      this._projectSwipeSuppress = { key: gesture.key, until: Date.now() + PROJECT_SWIPE_SUPPRESS_MS }
    } else if (gesture.axis === 'vertical') {
      if (this._projectOpenSwipe) closeProjectSwipe(this, true)
      this._projectSwipeSuppress = { key: gesture.key, until: Date.now() + PROJECT_SWIPE_SUPPRESS_MS }
    }
    this._projectSwipeGesture = null
  },

  onProjectSwipeCancel() {
    closeProjectSwipe(this)
  },

  onProjectSwipeDelete(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
    const type = String(dataset.swipeType || '')
    const id = String(dataset.swipeId || '')
    const key = `${type}:${id}`
    if (!['record', 'line', 'lighting'].includes(type) || !id || !this._projectVisible || this._projectDestroyed
      || this.data.workspaceError || this._projectDeletionPending || this._projectSwipeGesture
      || this._projectOpenSwipe?.key !== key || this._projectOpenSwipe.offset !== -PROJECT_SWIPE_ACTION_WIDTH) return

    let snapshot
    try {
      snapshot = getWorkspaceSnapshot({ forceRefresh: true })
    } catch (error) {
      snapshot = { ok: false, error: '本地项目内容读取失败，请重试。' }
    }
    if (!snapshot || snapshot.ok === false) {
      this.setData({ workspaceError: snapshot?.error || '本地项目内容读取失败，请重试。' })
      wx.showToast({ title: '读取失败，请重试', icon: 'none' })
      return
    }
    const projectId = this.projectId
    const project = snapshot.projects.find((item) => item.id === projectId)
    if (!project || this.data.project?.id !== projectId) {
      wx.showToast({ title: '项目内容已更新，请重试', icon: 'none' })
      this.refresh({ forceRefresh: true })
      return
    }

    let captured
    if (type === 'record') {
      const record = snapshot.records.find((item) => String(item.id) === id)
      const canonical = projectRecordFingerprint(record)
      if (!record?.projectIds?.includes(projectId) || !this.rawRecords?.some((item) => String(item.id) === id)
        || this._canonicalProjectRecordSnapshots?.get(id) !== canonical) {
        wx.showToast({ title: '项目内容已更新，请重试', icon: 'none' })
        this.refresh({ forceRefresh: true })
        return
      }
      captured = { recordSnapshot: canonical }
    } else if (type === 'line') {
      const schedule = project.wiringSchedule || {}
      const line = (schedule.lines || []).find((item) => item && String(item.id) === id)
      const visibleLine = (this.data.wiringLines || []).find((item) => item && String(item.id) === id)
      const priorLine = (this._projectWiringSchedule?.lines || []).find((item) => item && String(item.id) === id)
      const revision = Number(schedule.revision) || 0
      if (!line || !visibleLine || !priorLine || revision !== (Number(this._projectWiringSchedule?.revision) || 0)
        || JSON.stringify(line) !== JSON.stringify(priorLine)) {
        wx.showToast({ title: '项目内容已更新，请重试', icon: 'none' })
        this.refresh({ forceRefresh: true })
        return
      }
      captured = { lineSnapshot: JSON.stringify(line), revision }
    } else {
      let lightingState
      try {
        lightingState = readLightingWorkspace(projectId)
      } catch (error) {
        lightingState = { ok: false }
      }
      const visibleFixture = (this.data.lightingFixtures || []).find((item) => item && String(item.stableId) === id)
      let calculation
      try {
        if (lightingState?.ok && lightingState.contextId === projectId) calculation = calculateScheme(lightingState.scheme)
      } catch (error) {
        calculation = null
      }
      const fixture = calculation?.ok && calculation.valid
        ? calculation.result.fixtures.find((item) => String(item.stableId) === id)
        : null
      const priorFixture = (this._projectLightingFixtures || []).find((item) => item && String(item.stableId) === id)
      const positionsById = lightingState?.scheme?.layout?.positionsById
      const position = positionsById && positionsById[id]
      const viewMatches = Boolean(visibleFixture && priorFixture && fixture
        && this._projectLightingRevision === (Number(lightingState.revision) || 0)
        && JSON.stringify(this._projectLightingScheme) === JSON.stringify(lightingState.scheme)
        && JSON.stringify(priorFixture) === JSON.stringify(fixture))
      if (!lightingState?.ok || lightingState.contextId !== projectId) {
        wx.showToast({ title: '读取灯位失败，请重试', icon: 'none' })
        this.refresh({ forceRefresh: true })
        return
      }
      if (!viewMatches) {
        wx.showToast({ title: '灯位方案已更新，请重试', icon: 'none' })
        this.refresh({ forceRefresh: true })
        return
      }
      if (!(position && typeof position === 'object' && position.rodId)) {
        wx.showToast({ title: '该灯位未上杆', icon: 'none' })
        return
      }
      captured = {
        lightingRevision: Number(lightingState.revision) || 0,
        lightingSchemeSnapshot: JSON.stringify(lightingState.scheme),
        lightingFixtureSnapshot: JSON.stringify(fixture),
        lightingPositionSnapshot: JSON.stringify(position),
      }
    }

    const request = {
      token: (this._projectDeletionToken || 0) + 1,
      type,
      id,
      projectId,
      sessionToken: this._projectSessionToken,
      refreshToken: this._projectRefreshToken,
      interactionToken: this._projectInteractionToken,
      ...captured,
    }
    this._projectDeletionToken = request.token
    this._projectDeletionPending = request
    const modalOptions = {
      title: type === 'record' ? '移除项目记录？' : type === 'line' ? '删除该线路？' : '移出灯位？',
      content: type === 'record'
        ? `仅从“${project.name}”移除该记录，可在回收站恢复；其他项目和独立收藏保留。`
        : type === 'line'
          ? `仅删除“${project.name}”中的该线路，设备和其他线路保留。`
          : `仅将该灯从“${project.name}”的灯位图移出，灯具数量、地址、核对和其他灯位保留。`,
      confirmText: type === 'record' ? '移除' : type === 'line' ? '删除' : '移出灯位',
      cancelText: '取消',
      confirmColor: '#d70015',
      success: (result) => {
        if (!isCurrentProjectDeletion(this, request) || request.submitted) return
        request.submitted = true
        if (!result || !result.confirm) {
          releaseProjectDeletion(this, request)
          return
        }

        let latest
        try {
          latest = getWorkspaceSnapshot({ forceRefresh: true })
        } catch (error) {
          latest = { ok: false, error: '本地项目内容读取失败，请重试。' }
        }
        if (!latest || latest.ok === false) {
          releaseProjectDeletion(this, request)
          this.setData({ workspaceError: latest?.error || '本地项目内容读取失败，请重试。' })
          wx.showToast({ title: '读取失败，请重试', icon: 'none' })
          return
        }
        const latestProject = latest.projects.find((item) => item.id === request.projectId)
        const stillCurrent = this._projectVisible && !this._projectDestroyed
          && this.projectId === request.projectId && this.data.project?.id === request.projectId
          && latestProject && this._projectSessionToken === request.sessionToken
          && this._projectRefreshToken === request.refreshToken
          && this._projectInteractionToken === request.interactionToken
        const latestRecord = request.type === 'record'
          ? latest.records.find((item) => String(item.id) === request.id) : null
        const latestSchedule = latestProject?.wiringSchedule || {}
        const latestLine = request.type === 'line'
          ? (latestSchedule.lines || []).find((item) => item && String(item.id) === request.id) : null
        let latestLighting = null
        let latestLightingCalculation = null
        if (request.type === 'lighting') {
          try {
            latestLighting = readLightingWorkspace(request.projectId)
            if (latestLighting?.ok && latestLighting.contextId === request.projectId) {
              latestLightingCalculation = calculateScheme(latestLighting.scheme)
            }
          } catch (error) {
            latestLighting = { ok: false }
          }
          if (!latestLighting?.ok) {
            releaseProjectDeletion(this, request)
            wx.showToast({ title: '读取灯位失败，请重试', icon: 'none' })
            if (this._projectVisible && !this._projectDestroyed) this.refresh({ forceRefresh: true })
            return
          }
        }
        const latestFixture = latestLightingCalculation?.ok && latestLightingCalculation.valid
          ? latestLightingCalculation.result.fixtures.find((item) => String(item.stableId) === request.id)
          : null
        const latestPositionsById = latestLighting?.scheme?.layout?.positionsById
        const latestPosition = latestPositionsById && latestPositionsById[request.id]
        const lightingViewStillCurrent = request.type !== 'lighting' || Boolean(
          latestLighting?.ok && latestLighting.contextId === request.projectId
          && this._projectLightingRevision === request.lightingRevision
          && JSON.stringify(this._projectLightingScheme) === request.lightingSchemeSnapshot
          && (this.data.lightingFixtures || []).some((item) => String(item.stableId) === request.id)
        )
        const contentStillCurrent = request.type === 'record'
          ? Boolean(latestRecord?.projectIds?.includes(request.projectId)
            && projectRecordFingerprint(latestRecord) === request.recordSnapshot)
          : request.type === 'line'
            ? Boolean(latestLine && (Number(latestSchedule.revision) || 0) === request.revision
              && JSON.stringify(latestLine) === request.lineSnapshot)
            : Boolean(latestLighting?.ok && latestLighting.contextId === request.projectId
              && (Number(latestLighting.revision) || 0) === request.lightingRevision
              && JSON.stringify(latestLighting.scheme) === request.lightingSchemeSnapshot
              && latestFixture && JSON.stringify(latestFixture) === request.lightingFixtureSnapshot
              && latestPosition && typeof latestPosition === 'object' && latestPosition.rodId
              && JSON.stringify(latestPosition) === request.lightingPositionSnapshot)
        if (!stillCurrent || !contentStillCurrent || !lightingViewStillCurrent) {
          releaseProjectDeletion(this, request)
          wx.showToast({ title: request.type === 'lighting' ? '灯位方案已更新，请重试' : '项目内容已更新，请重试', icon: 'none' })
          if (this._projectVisible && !this._projectDestroyed) this.refresh({ forceRefresh: true })
          return
        }

        let saved = false
        try {
          if (request.type === 'record') {
            saved = removeRecordFromProject(request.id, request.projectId) === true
          } else {
            if (request.type === 'line') {
              const result = saveProjectWiring(request.projectId,
                { type: 'delete-lines', ids: [request.id] }, request.revision)
              saved = Boolean(result && result.ok)
            } else {
              const nextScheme = JSON.parse(JSON.stringify(latestLighting.scheme))
              delete nextScheme.layout.positionsById[request.id]
              const result = saveLightingScheme(request.projectId, nextScheme, request.lightingRevision)
              saved = Boolean(result && result.ok)
            }
          }
        } catch (error) {
          saved = false
        }
        releaseProjectDeletion(this, request)
        if (!saved) {
          wx.showToast({ title: request.type === 'lighting' ? '移出失败，请重试' : '删除失败，请重试', icon: 'none' })
          if (this._projectVisible && !this._projectDestroyed) this.refresh({ forceRefresh: true })
          return
        }
        vibrate('medium')
        closeProjectSwipe(this)
        this.refresh({ forceRefresh: true })
        wx.showToast({ title: request.type === 'record' ? '已从本项目移除' : request.type === 'line' ? '线路已删除' : '已移出灯位', icon: 'none' })
      },
      fail: () => {
        if (!isCurrentProjectDeletion(this, request) || request.submitted) return
        releaseProjectDeletion(this, request)
        wx.showToast({ title: '确认失败，请重试', icon: 'none' })
      },
    }
    try {
      if (typeof wx.showModal !== 'function') throw new Error('showModal unavailable')
      wx.showModal(modalOptions)
    } catch (error) {
      if (!request.submitted && releaseProjectDeletion(this, request)) wx.showToast({ title: '确认失败，请重试', icon: 'none' })
    }
  },

  onProjectItemTap(event) {
    const recordId = String(event.currentTarget.dataset.id || '')
    if (consumeProjectSwipeTap(this, 'record', recordId)) return
    if (this.data.workspaceError) return
    const record = this.rawRecords.find((item) => item.id === recordId)
    if (!record) return
    prepareProjectNavigation(this)
    if (getModuleMetadata(record.module)?.retired) {
      showStoredLegacyResult(record)
      return
    }
    if (!openRecordEditor(record, 'project-record', this.projectId)) {
      wx.showToast({ title: '无法打开已保存记录，请检查本地存储', icon: 'none' })
    }
  },

  openProjectWiring(event) {
    const lineId = String(event?.currentTarget?.dataset?.id || '')
    if (consumeProjectSwipeTap(this, 'line', lineId)) return
    if (!this.projectId || this.data.workspaceError) return
    prepareProjectNavigation(this)
    wx.navigateTo({ url: `/pages/project-wiring/index?id=${encodeURIComponent(this.projectId)}` })
  },

  saveProjectDetails() {
    if (this.data.workspaceError) return
    const updated = updateProject(this.projectId, this.data.projectForm)
    if (!updated) {
      wx.showToast({ title: '项目名称为空或已存在', icon: 'none' })
      return
    }
    this.setData({ editing: false })
    this.refresh()
    vibrate('medium')
    wx.showToast({ title: '项目资料已保存', icon: 'none' })
  },

  stopEvent() {},
  preventTouchMove() {},
})

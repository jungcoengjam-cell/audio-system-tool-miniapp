const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const {
  MODULES,
  addRecordToProject,
  createProject,
  deleteProject,
  getWorkspaceSnapshot,
  removeRecord,
  restoreRecord,
  setActiveProject,
  toggleFavoriteById,
} = require('../../utils/records')

function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function projectViewFields(project) {
  const { wiringSchedule, ...fields } = project || {}
  return fields
}

function getWiringLineCount(project) {
  const lines = project?.wiringSchedule?.lines
  return Array.isArray(lines) ? lines.length : 0
}

function buildViewSignature(projects, records, activeProject, recordTabIndex) {
  const projectSignature = projects.map((item) => (
    `${item.id}:${item.updatedAt}:${item.name}:${item.wiringSchedule?.revision || 0}:${getWiringLineCount(item)}`
  )).join('|')
  const recordSignature = records.map((item) => (
    `${item.id}:${item.updatedAt}:${item.favorite ? 1 : 0}:${(item.projectIds || []).join(',')}`
  )).join('|')
  return `${recordTabIndex}#${activeProject?.id || ''}#${projectSignature}#${recordSignature}`
}

Page({
  data: {
    recordTabs: ['现场项目', '常用收藏'],
    recordTabIndex: 0,
    displayRecords: [],
    projects: [],
    activeProject: null,
  },

  onShow() {
    this.refreshWorkspace('onShow')
  },

  onHide() {
    printPerformanceSummary('项目页/')
  },

  refreshWorkspace(source = 'interaction', changes = {}) {
    const finishRefresh = startMeasurement('项目页/工作区刷新总耗时', { source })
    const { projects: rawProjects, records: rawRecords, activeProject } = getWorkspaceSnapshot()
    const recordTabIndex = changes.recordTabIndex ?? this.data.recordTabIndex
    const viewSignature = buildViewSignature(rawProjects, rawRecords, activeProject, recordTabIndex)
    if (viewSignature === this.workspaceViewSignature) {
      finishRefresh({ projects: rawProjects.length, records: rawRecords.length, skipped: true })
      return
    }

    const projectNames = Object.create(null)
    const projectRecordCounts = Object.create(null)
    rawProjects.forEach((project) => {
      projectNames[project.id] = project.name
      projectRecordCounts[project.id] = 0
    })
    rawRecords.forEach((record) => {
      ;(record.projectIds || []).forEach((id) => {
        if (Object.prototype.hasOwnProperty.call(projectRecordCounts, id)) projectRecordCounts[id] += 1
      })
    })
    const decoratedRecords = recordTabIndex === 0 ? [] : rawRecords.filter((record) => record.favorite).map((record) => ({
      moduleLabel: MODULES[record.module]?.label || '计算',
      id: record.id,
      trustLabel: MODULES[record.module]?.trustLabel || '计算结果',
      theme: MODULES[record.module]?.theme || 'cyan',
      timeText: formatTime(record.updatedAt),
      title: record.title,
      summary: record.summary,
      projectNames: (record.projectIds || []).map((id) => projectNames[id]).filter(Boolean).join('、'),
      favorite: record.favorite,
    }))

    this.workspaceViewSignature = viewSignature
    this.rawRecords = rawRecords
    this.setData({
      ...changes,
      displayRecords: decoratedRecords,
      projects: rawProjects.map((project) => ({
        ...projectViewFields(project),
        timeText: formatTime(project.updatedAt),
        recordCount: projectRecordCounts[project.id] || 0,
        wiringLineCount: getWiringLineCount(project),
        isActive: project.id === activeProject?.id,
      })),
      activeProject: activeProject ? projectViewFields(activeProject) : null,
    }, () => finishRefresh({ projects: rawProjects.length, records: rawRecords.length }))
  },

  onRecordTabTap(event) {
    this.refreshWorkspace('recordTab', { recordTabIndex: Number(event.currentTarget.dataset.index) })
  },

  createProject() {
    wx.showModal({
      title: '新建现场项目',
      content: '',
      editable: true,
      placeholderText: '例如：三楼会议室',
      confirmText: '创建',
      success: ({ confirm, content }) => {
        if (!confirm) return
        const project = createProject(content)
        if (!project) {
          wx.showToast({ title: '请输入项目名称', icon: 'none' })
          return
        }
        this.refreshWorkspace()
      },
    })
  },

  selectProject(event) {
    wx.navigateTo({ url: `/pages/records/project?id=${event.currentTarget.dataset.id}` })
  },

  openProjectWiring(event) {
    const projectId = event.currentTarget.dataset.id
    if (!projectId) return
    wx.navigateTo({ url: `/pages/project-wiring/index?id=${encodeURIComponent(projectId)}` })
  },

  openProjectReport(event) {
    this.selectProject(event)
  },

  activateProject(event) {
    if (!setActiveProject(event.currentTarget.dataset.id)) {
      wx.showToast({ title: '设置失败，请重试', icon: 'none' })
      return
    }
    this.refreshWorkspace()
    wx.showToast({ title: '已设为当前项目', icon: 'none' })
  },

  restoreRecord(event) {
    const record = this.rawRecords.find((item) => item.id === event.currentTarget.dataset.id)
    const path = restoreRecord(record)
    if (path) wx.navigateTo({ url: path })
  },

  toggleRecordFavorite(event) {
    const recordId = event.currentTarget.dataset.id
    const before = (this.rawRecords || []).find((item) => item.id === recordId)
    if (!before) return
    const result = toggleFavoriteById(recordId)
    const after = getWorkspaceSnapshot().records.find((item) => item.id === recordId)
    const removedAsExpected = before.favorite && !after
    if (!result && !removedAsExpected) {
      wx.showToast({ title: '保存失败，请检查本地存储', icon: 'none' })
      return
    }
    this.refreshWorkspace()
  },

  addRecordToActiveProject(event) {
    const project = this.data.activeProject
    const record = this.rawRecords.find((item) => item.id === event.currentTarget.dataset.id)
    if (!project || !record) return
    if (!addRecordToProject(record, project.id)) {
      wx.showToast({ title: '保存失败，请检查本地存储', icon: 'none' })
      return
    }
    this.refreshWorkspace()
    wx.showToast({ title: `已加入${project.name}`, icon: 'none' })
  },

  deleteRecord(event) {
    const recordId = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后，该记录也会从相关现场项目中移除。',
      confirmColor: '#ff3b30',
      success: ({ confirm }) => {
        if (!confirm) return
        if (!removeRecord(recordId)) {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
          return
        }
        this.refreshWorkspace()
      },
    })
  },

  deleteProject(event) {
    const projectId = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除这个项目？',
      content: '项目及其布线资料会被删除；未收藏且不属于其他项目的计算记录将同时清理。',
      confirmColor: '#ff3b30',
      success: ({ confirm }) => {
        if (!confirm) return
        if (!deleteProject(projectId)) {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
          return
        }
        this.refreshWorkspace()
      },
    })
  },
})

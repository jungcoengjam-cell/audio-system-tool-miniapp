'use strict'

const {
  createProject,
  getModuleMetadata,
  getWorkspaceSnapshot,
  toggleFavoriteById,
} = require('../../utils/records')
const { getLightingContexts } = require('../dmx-layout/lighting-workspace')

const PROJECT_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'calculation', label: '计算记录' },
  { key: 'wiring', label: '线路' },
  { key: 'lighting', label: '灯位' },
]

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '时间未记录'
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function projectLines(project) {
  const lines = project?.wiringSchedule?.lines
  return Array.isArray(lines) ? lines.length : 0
}

function filterRows(rows, query, moduleKey) {
  const q = String(query || '').trim().toLowerCase()
  return rows.filter((row) => {
    if (moduleKey && moduleKey !== 'all' && row.module !== moduleKey) return false
    if (!q) return true
    return [row.title, row.name, row.summary, row.moduleLabel, row.venueName]
      .some((value) => String(value || '').toLowerCase().includes(q))
  })
}

Page({
  data: {
    tabs: ['项目', '收藏'],
    tabIndex: 0,
    projectFilters: PROJECT_FILTERS,
    projectFilter: 'all',
    favoriteModules: [],
    favoriteFilter: 'all',
    searchText: '',
    projects: [],
    favorites: [],
    activeProject: null,
    recoveryCount: 0,
    workspaceError: '',
    lightingWarning: '',
  },

  onShow() {
    this.refresh({ forceRefresh: true })
  },

  refresh(options = {}) {
    const snapshot = getWorkspaceSnapshot({ forceRefresh: options.forceRefresh === true || Boolean(this.data.workspaceError) })
    if (!snapshot.ok) {
      this.setData({ workspaceError: snapshot.error || '项目和收藏读取失败，请重试。' })
      return false
    }
    const lighting = getLightingContexts()
    const lightingRows = lighting.ok ? lighting.rows : []
    const lightingWarning = lighting.ok ? '' : '灯位统计暂不可用；项目内原始灯光数据仍保留。'
    const recordCounts = Object.create(null)
    snapshot.projects.forEach((project) => { recordCounts[project.id] = 0 })
    snapshot.records.forEach((record) => {
      ;(record.projectIds || []).forEach((projectId) => {
        if (Object.prototype.hasOwnProperty.call(recordCounts, projectId)) recordCounts[projectId] += 1
      })
    })
    const projects = snapshot.projects.map((project) => {
      const context = lightingRows.find((item) => item.id === project.id)
      const wiringCount = projectLines(project)
      const lightingCount = context?.hasLighting && Number(context.revision) > 0 ? 1 : 0
      return {
        id: project.id,
        name: project.name,
        venueName: project.venueName || '',
        recordCount: recordCounts[project.id] || 0,
        wiringCount,
        lightingCount,
        timeText: formatTime(project.updatedAt),
        isActive: snapshot.activeProject?.id === project.id,
        contentText: [
          recordCounts[project.id] ? `${recordCounts[project.id]} 条计算` : '',
          wiringCount ? `${wiringCount} 条线路` : '',
          lightingCount ? '含灯位方案' : '',
        ].filter(Boolean).join(' · ') || '尚无计算、线路或灯位内容',
      }
    })
    const metadataByModule = Object.create(null)
    Object.keys(require('../../utils/records').MODULES).forEach((key) => {
      metadataByModule[key] = getModuleMetadata(key)
    })
    const favorites = snapshot.favorites.map((favorite) => {
      const metadata = metadataByModule[favorite.module] || getModuleMetadata(favorite.module)
      return {
        id: favorite.id,
        module: favorite.module,
        moduleLabel: metadata?.label || favorite.module,
        theme: metadata?.theme || 'cyan',
        title: favorite.title || favorite.summary || metadata?.label || '计算收藏',
        summary: favorite.summary || favorite.resultText,
        timeText: formatTime(favorite.updatedAt || favorite.createdAt),
        archived: Boolean(metadata?.retired),
      }
    })
    const favoriteModules = [
      { key: 'all', label: '全部' },
      ...Array.from(new Set(snapshot.favorites.map((item) => item.module))).map((key) => ({
        key,
        label: getModuleMetadata(key)?.label || key,
      })),
    ]
    const filteredProjects = filterRows(projects, this.data.searchText, '')
      .filter((project) => {
        if (this.data.projectFilter === 'calculation') return project.recordCount > 0
        if (this.data.projectFilter === 'wiring') return project.wiringCount > 0
        if (this.data.projectFilter === 'lighting') return project.lightingCount > 0
        return true
      })
    const filteredFavorites = filterRows(favorites, this.data.searchText, this.data.favoriteFilter)
    this.setData({
      projects: filteredProjects,
      favorites: filteredFavorites,
      favoriteModules,
      activeProject: snapshot.activeProject,
      recoveryCount: snapshot.recoveryEntries.length,
      lightingWarning,
      workspaceError: '',
    })
    this._allProjects = projects
    this._allFavorites = favorites
    return true
  },

  refreshFiltered() {
    const projects = this._allProjects || []
    const favorites = this._allFavorites || []
    const filteredProjects = filterRows(projects, this.data.searchText, '').filter((project) => {
      if (this.data.projectFilter === 'calculation') return project.recordCount > 0
      if (this.data.projectFilter === 'wiring') return project.wiringCount > 0
      if (this.data.projectFilter === 'lighting') return project.lightingCount > 0
      return true
    })
    const filteredFavorites = filterRows(favorites, this.data.searchText, this.data.favoriteFilter)
    this.setData({ projects: filteredProjects, favorites: filteredFavorites })
  },

  onTabTap(event) {
    const tabIndex = Number(event.currentTarget.dataset.index)
    this.setData({ tabIndex, searchText: '' }, () => this.refresh({ forceRefresh: true }))
  },

  onSearchInput(event) {
    this.setData({ searchText: event.detail.value || '' }, () => this.refreshFiltered())
  },

  onProjectFilterTap(event) {
    this.setData({ projectFilter: String(event.currentTarget.dataset.key || 'all') }, () => this.refreshFiltered())
  },

  onFavoriteFilterTap(event) {
    this.setData({ favoriteFilter: String(event.currentTarget.dataset.key || 'all') }, () => this.refreshFiltered())
  },

  retryWorkspace() {
    this.refresh({ forceRefresh: true })
  },

  createProject() {
    if (this.data.workspaceError) return
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
          wx.showToast({ title: content?.trim() ? '新建失败，请检查本地存储' : '请输入项目名称', icon: 'none' })
          return
        }
        this.refresh({ forceRefresh: true })
      },
    })
  },

  openProject(event) {
    const projectId = String(event.currentTarget.dataset.id || '')
    if (projectId) wx.navigateTo({ url: `/pages/records/project?id=${encodeURIComponent(projectId)}` })
  },

  openFavorite(event) {
    const favoriteId = String(event.currentTarget.dataset.id || '')
    if (favoriteId) wx.navigateTo({ url: `/pages/projects/favorite-detail?id=${encodeURIComponent(favoriteId)}` })
  },

  openRecovery() {
    wx.navigateTo({ url: '/pages/projects/recovery' })
  },

  removeFavorite(event) {
    const favoriteId = String(event.currentTarget.dataset.id || '')
    toggleFavoriteById(favoriteId)
    this.refresh({ forceRefresh: true })
  },
})

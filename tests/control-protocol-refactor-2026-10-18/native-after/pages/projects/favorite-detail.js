'use strict'

const {
  getFavorites,
  getModuleMetadata,
  getProjects,
  getWorkspaceSnapshot,
  removeFavorite,
} = require('../../utils/records')
const { openRecordEditor } = require('../../utils/result-record-context')

function pretty(value) {
  try { return JSON.stringify(value, null, 2) } catch (error) { return String(value || '') }
}

function formatTime(value) {
  if (!Number.isFinite(value)) return '時間未記錄'
  return new Date(value).toLocaleString('zh-CN')
}

Page({
  data: {
    favorite: null,
    projectNames: [],
    workspaceError: '',
  },

  onLoad(options = {}) {
    this.favoriteId = String(options.id || '')
    this.refresh({ forceRefresh: true })
  },

  onShow() {
    if (this.favoriteId) this.refresh({ forceRefresh: true })
  },

  refresh(options = {}) {
    const snapshot = getWorkspaceSnapshot({ forceRefresh: options.forceRefresh === true })
    if (!snapshot.ok) {
      this.setData({ workspaceError: snapshot.error || '收藏读取失败，请重试。' })
      return false
    }
    const favorite = (snapshot.favorites || []).find((item) => item.id === this.favoriteId)
    if (!favorite) {
      this.setData({ favorite: null, workspaceError: '此收藏不存在，或已移入恢复区。' })
      return false
    }
    const metadata = getModuleMetadata(favorite.module)
    const projectNames = (favorite.originProjectIds || []).map((id) => (
      snapshot.projects.find((project) => project.id === id)?.name
    )).filter(Boolean)
    this.setData({
      favorite: {
        ...favorite,
        moduleLabel: metadata?.label || favorite.module,
        trustLabel: metadata?.trustLabel || '历史计算结果',
        parametersText: pretty(favorite.preferences),
        resultText: favorite.resultText,
        createdText: formatTime(favorite.createdAt),
        updatedText: formatTime(favorite.updatedAt),
      },
      projectNames,
      projectNamesText: projectNames.join('、'),
      workspaceError: '',
    })
    return true
  },

  retry() {
    this.refresh({ forceRefresh: true })
  },

  openWorkingCopy() {
    const favorite = this.data.favorite
    if (!favorite) return
    const result = openRecordEditor(favorite, 'favorite')
    if (!result) wx.showToast({ title: '无法打开计算副本，请检查本地存储', icon: 'none' })
  },

  copyParameters() {
    if (!this.data.favorite) return
    wx.setClipboardData({
      data: this.data.favorite.parametersText,
      success: () => wx.showToast({ title: '参数已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    })
  },

  removeCurrentFavorite() {
    const favorite = this.data.favorite
    if (!favorite) return
    wx.showModal({
      title: '移入恢复区？',
      content: '收藏快照会从常用列表移出，之后仍可在恢复区还原。项目计算记录不会受影响。',
      confirmText: '移入恢复区',
      cancelText: '取消',
      success: ({ confirm }) => {
        if (!confirm) return
        if (!removeFavorite(favorite.id)) {
          wx.showToast({ title: '操作失败，请重试', icon: 'none' })
          return
        }
        wx.navigateBack()
      },
    })
  },
})

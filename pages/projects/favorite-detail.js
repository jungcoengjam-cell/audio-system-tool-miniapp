'use strict'

const {
  getModuleMetadata,
  getProjects,
  getWorkspaceSnapshot,
  removeFavorite,
} = require('../../utils/records')
const { openRecordEditor } = require('../../utils/result-record-context')
const { vibrate } = require('../../utils/haptics')
const { formatPreferenceRows } = require('../records/report-model')
const { checkFavoriteLoad } = require('./favorite-load-check')

function pretty(value) {
  try { return JSON.stringify(value, null, 2) } catch (error) { return String(value || '') }
}

function formatTime(value) {
  if (!Number.isFinite(value)) return '时间未记录'
  return new Date(value).toLocaleString('zh-CN')
}

Page({
  data: {
    favorite: null,
    projectNames: [],
    workspaceError: '',
    rawParametersVisible: false,
  },

  onLoad(options = {}) {
    this._unloaded = false
    this._pageVisible = true
    this.favoriteId = String(options.id || '')
    this.refresh({ forceRefresh: true })
  },

  onUnload() {
    this._unloaded = true
    this._pageVisible = false
  },

  onShow() {
    this._pageVisible = true
    if (this.favoriteId) this.refresh({ forceRefresh: true })
  },

  onHide() {
    this._pageVisible = false
  },

  refresh(options = {}) {
    const snapshot = getWorkspaceSnapshot({ forceRefresh: options.forceRefresh === true })
    if (!snapshot.ok) {
      this.setData({ workspaceError: snapshot.error || '收藏读取失败，请重试。' })
      return false
    }
    const favorite = (snapshot.favorites || []).find((item) => item.id === this.favoriteId)
    if (!favorite) {
      this.setData({ favorite: null, workspaceError: '此收藏不存在，或已移入回收站。' })
      return false
    }
    const metadata = getModuleMetadata(favorite.module)
    const loadCheck = checkFavoriteLoad(favorite)
    const projectNames = (favorite.originProjectIds || []).map((id) => (
      snapshot.projects.find((project) => project.id === id)?.name
    )).filter(Boolean)
    const parameterRows = formatPreferenceRows(favorite.preferences, favorite.module)
    const parametersText = pretty(favorite.preferences)
    this.setData({
      favorite: {
        ...favorite,
        moduleLabel: metadata?.label || favorite.module,
        trustLabel: metadata?.trustLabel || '历史计算结果',
        parameterRows,
        parametersText,
        resultText: favorite.resultText,
        createdText: formatTime(favorite.createdAt),
        updatedText: formatTime(favorite.updatedAt),
        canLoad: loadCheck.canLoad,
        loadReason: loadCheck.reason,
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
    const loadCheck = checkFavoriteLoad(favorite)
    if (!loadCheck.canLoad) {
      this.setData({ favorite: { ...favorite, canLoad: false, loadReason: loadCheck.reason } })
      return
    }
    const result = openRecordEditor(favorite, 'favorite')
    if (!result) wx.showToast({ title: '无法打开计算副本，请检查本地存储或参数', icon: 'none' })
  },

  copyParameters() {
    const favorite = this.data.favorite
    if (!favorite) return
    wx.setClipboardData({
      data: favorite.parametersText,
      success: () => {
        if (this._pageVisible && !this._unloaded && this.data.favorite?.id === favorite.id) vibrate('medium')
        wx.showToast({ title: '参数已复制', icon: 'none' })
      },
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    })
  },

  toggleRawParameters() {
    this.setData({ rawParametersVisible: !this.data.rawParametersVisible })
    vibrate('light')
  },

  openManageMenu() {
    wx.showActionSheet({
      itemList: ['移入回收站'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) this.removeCurrentFavorite()
      },
    })
  },

  removeCurrentFavorite() {
    const favorite = this.data.favorite
    if (!favorite) return
    wx.showModal({
      title: '移入回收站？',
      content: '收藏快照会从常用列表移出，之后仍可在回收站还原。项目计算记录不会受影响。',
      confirmText: '移入回收站',
      cancelText: '取消',
      success: ({ confirm }) => {
        if (!confirm) return
        if (!removeFavorite(favorite.id)) {
          wx.showToast({ title: '操作失败，请重试', icon: 'none' })
          return
        }
        if (this._pageVisible && !this._unloaded && this.data.favorite?.id === favorite.id) vibrate('medium')
        wx.navigateBack()
      },
    })
  },
})

module.exports = { checkFavoriteLoad, formatTime }

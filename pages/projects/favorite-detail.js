'use strict'

const {
  getFavorites,
  getModuleMetadata,
  MODULES,
  getProjects,
  getWorkspaceSnapshot,
  removeFavorite,
} = require('../../utils/records')
const { openRecordEditor } = require('../../utils/result-record-context')
const { vibrate } = require('../../utils/haptics')
const { amplifiers, speakers } = require('../../data/equipment')
const { cameras } = require('../../data/cameras')
const { amplifierInputStages } = require('../../data/amplifier-input-stages')
const { formatPreferenceRows } = require('../records/report-model')
const { getHorizontalCameraViews } = require('../../utils/camera-fov')

const selectableSpeakers = speakers.filter((item) => !item.calculationDisabled)
const ledAspectRatios = new Set(['16:9', '4:3', '21:9', '16:10', '32:9'])
const ledUnits = new Set(['module', 'cabinetStandard', 'cabinetPremiumA'])
const ledPitches = new Set(['recommended', 1.25, 1.53, 1.86, 2])
// Stable endpoint IDs are mirrored here to avoid loading the audio-wiring subpackage from the main package.
const audioWiringOutputIds = new Set([
  'xlrBalanced', 'trsBalanced', 'terminalBalanced', 'stereo35', 'rcaMono', 'tsMono', 'stereo635',
])
const audioWiringInputIds = new Set([
  'xlrBalanced', 'trsBalanced', 'terminalBalanced', 'rcaStereo', 'tsStereo', 'rcaMono', 'tsMono', 'stereo635', 'stereo35',
])

function pretty(value) {
  try { return JSON.stringify(value, null, 2) } catch (error) { return String(value || '') }
}

function formatTime(value) {
  if (!Number.isFinite(value)) return '时间未记录'
  return new Date(value).toLocaleString('zh-CN')
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function checkFavoriteLoad(favorite) {
  const metadata = getModuleMetadata(favorite?.module)
  if (!metadata || metadata.retired || !MODULES[favorite.module] || favorite.module === 'dmxAddress') {
    return { canLoad: false, reason: '此历史模块不支持安全重算，原始参数和结果仍可查看。' }
  }
  const preferences = favorite.preferences
  if (!isPlainObject(preferences)) return { canLoad: false, reason: '保存的参数格式不完整，无法安全载入。' }
  if (favorite.module === 'limiter') {
    if (!amplifiers.some((item) => item.model === preferences.amplifierModel)) {
      return { canLoad: false, reason: `功放型号“${preferences.amplifierModel || '未记录'}”当前不可用，已阻止静默替换。` }
    }
    if (!selectableSpeakers.some((item) => item.model === preferences.speakerModel)) {
      return { canLoad: false, reason: `音箱型号“${preferences.speakerModel || '未记录'}”当前不可用，已阻止静默替换。` }
    }
  }
  if (favorite.module === 'spl'
    && !selectableSpeakers.some((item) => item.model === preferences.speakerModel && Number.isFinite(item.sensitivityDb))) {
    return { canLoad: false, reason: `音箱型号“${preferences.speakerModel || '未记录'}”当前不可用于声压计算。` }
  }
  if (favorite.module === 'gainStructure'
    && (!amplifiers.some((item) => item.model === preferences.amplifierModel)
      || !amplifierInputStages[preferences.amplifierModel])) {
    return { canLoad: false, reason: `功放型号“${preferences.amplifierModel || '未记录'}”当前不可用于增益计算。` }
  }
  if (favorite.module === 'camera') {
    if (preferences.cameraCalculationVersion !== undefined
      && ![1, 2].includes(preferences.cameraCalculationVersion)) {
      return { canLoad: false, reason: '摄像机参数版本较新，当前工具无法安全重算。' }
    }
    if (preferences.sourceMode === 'library') {
      const camera = cameras.find((item) => item.model === preferences.cameraModel)
      const viewIndex = Number(preferences.viewIndex)
      const views = camera ? getHorizontalCameraViews(camera) : []
      if (!camera || !Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex >= views.length) {
        return { canLoad: false, reason: `摄像机型号或视角“${preferences.cameraModel || '未记录'}”当前不可用。` }
      }
    } else {
      return { canLoad: false, reason: '摄像机参数来源无法识别，已阻止静默套用默认值。' }
    }
  }
  if (favorite.module === 'cable' && (!['constant', 'professional'].includes(preferences.mode)
    || !['indoor', 'outdoor'].includes(preferences.environment))) {
    return { canLoad: false, reason: '线材参数版本或选项无法识别，已阻止静默套用默认值。' }
  }
  if (favorite.module === 'ledScreen' && (!ledAspectRatios.has(preferences.aspectRatio)
    || !ledUnits.has(preferences.unitKey) || !ledPitches.has(preferences.pitch))) {
    return { canLoad: false, reason: 'LED 参数中存在当前版本无法识别的比例、拼装单元或点间距。' }
  }
  if (favorite.module === 'audioWiring') {
    const outputKnown = audioWiringOutputIds.has(preferences.outputId)
    const inputKnown = audioWiringInputIds.has(preferences.inputId)
    const manualSelected = preferences.manualSelected
    const controlsKnown = manualSelected && typeof manualSelected === 'object' && !Array.isArray(manualSelected)
      && typeof manualSelected.output === 'boolean' && typeof manualSelected.input === 'boolean'
      && ['wiring', 'connectors'].includes(preferences.viewMode)
      && ['mating', 'solder'].includes(preferences.face)
    if (preferences.version !== 1 || !outputKnown || !inputKnown || !controlsKnown) {
      return { canLoad: false, reason: '接线参数版本或接口型号当前不可用，已保留完整历史结果。' }
    }
  }
  return { canLoad: true, reason: '' }
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

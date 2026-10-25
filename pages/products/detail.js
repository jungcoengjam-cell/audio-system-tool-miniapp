const { getProductDetail, markProductViewed } = require('../../utils/products')
const { readPreferences, writePreferencesDetailed } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
  inspectDmxPreferences,
  readDmxPreferencesStatus,
  saveDmxProductImport,
} = require('../../utils/dmx-product-import')

const CALCULATOR_PATHS = {
  limiter: '/pages/limiter/limiter',
  spl: '/pages/spl/spl',
  camera: '/pages/camera/camera',
  dmxAddress: '/pages/dmx-address/dmx-address',
}

function projectRows(rows, fields) {
  return Array.isArray(rows)
    ? rows.map((row) => fields.reduce((result, field) => {
      result[field] = row[field]
      return result
    }, {}))
    : rows
}

function projectProductDetail(detail) {
  if (!detail) return null
  return {
    type: detail.type,
    model: detail.model,
    summary: detail.summary,
    category: detail.category,
    statusKey: detail.statusKey,
    statusLabel: detail.statusLabel,
    stereoRows: detail.stereoRows,
    bridgeRows: detail.bridgeRows,
    ratedPower: detail.ratedPower,
    powerLimitText: detail.powerLimitText,
    powerLimitLabel: detail.powerLimitLabel,
    impedance: detail.impedance,
    minimumFrequencyText: detail.minimumFrequencyText,
    sensitivityText: detail.sensitivityText,
    hasCoverageData: detail.hasCoverageData,
    maximumSplText: detail.maximumSplText,
    maximumSplLabel: detail.maximumSplLabel,
    coverageText: detail.coverageText,
    sensor: detail.sensor,
    megapixelsText: detail.megapixelsText,
    mountLabel: detail.mountLabel,
    specRows: detail.specRows,
    modeRows: detail.modeRows,
    dmxChannelGuide: detail.dmxChannelGuide
      ? {
        modes: projectRows(detail.dmxChannelGuide.modes, ['channelCount', 'label']),
        source: detail.dmxChannelGuide.source,
        sourcePageText: detail.dmxChannelGuide.sourcePageText,
        verificationStatus: detail.dmxChannelGuide.verificationStatus,
      }
      : detail.dmxChannelGuide,
    viewRows: projectRows(detail.viewRows, [
      'label',
      'statusKey',
      'statusLabel',
      'focalText',
      'zoomText',
      'mountLabel',
      'horizontalText',
      'verticalText',
      'missingText',
    ]),
    bandRows: detail.bandRows,
    note: detail.note,
    missingParameters: detail.missingParameters,
    modules: detail.modules,
    source: detail.source,
    sourcePageText: detail.sourcePageText,
    reviewDate: detail.reviewDate,
  }
}

Page({
  data: {
    product: null,
    dmxImportVisible: false,
    dmxImportModes: [],
    dmxImportChannelCount: '',
    dmxImportFixtureCount: '1',
    dmxImportHasGroups: false,
    dmxImportExistingGroupCount: 0,
    dmxImportGroupsReadable: true,
    dmxImportAction: '',
    dmxImportError: '',
    dmxImportSubmitting: false,
    dmxImportAllocationHint: '',
  },

  onLoad(options = {}) {
    const type = ['amplifier', 'speaker', 'camera', 'lighting'].includes(options.type)
      ? options.type
      : 'speaker'
    let model = ''
    try {
      model = decodeURIComponent(options.model || '')
    } catch (error) {
      model = ''
    }
    const product = getProductDetail(type, model)
    this._productDetail = product

    this.setData({ product: projectProductDetail(product) })
    wx.setNavigationBarTitle({ title: product ? product.model : '产品资料' })
    if (product) markProductViewed(type, model)
  },

  openCalculator(event) {
    const moduleKey = event.currentTarget.dataset.module
    const product = this._productDetail
    if (!product || !CALCULATOR_PATHS[moduleKey]) return

    if (moduleKey === 'dmxAddress' && product.type === 'lighting') {
      this.openDmxProductImport(product)
      return
    }

    let writeResult = null
    if (moduleKey === 'limiter') {
      const key = 'audioTool.limiter.preferences'
      const preferences = readPreferences(key)
      preferences[product.type === 'amplifier' ? 'amplifierModel' : 'speakerModel'] = product.model
      writeResult = writePreferencesDetailed(key, preferences)
    }

    if (moduleKey === 'spl' && product.type === 'speaker') {
      const key = 'audioTool.spl.preferences'
      writeResult = writePreferencesDetailed(key, { ...readPreferences(key), speakerModel: product.model })
    }

    if (moduleKey === 'camera' && product.type === 'camera') {
      const key = 'audioTool.camera.preferences'
      writeResult = writePreferencesDetailed(key, { ...readPreferences(key), sourceMode: 'library', cameraModel: product.model })
    }

    if (writeResult && !writeResult.ok) {
      wx.showToast({ title: '设置保存失败，请重试', icon: 'none' })
      return
    }

    wx.navigateTo({ url: CALCULATOR_PATHS[moduleKey] })
  },

  openDmxProductImport(product = this._productDetail) {
    if (!product || product.type !== 'lighting' || !Array.isArray(product.channelModes)
      || !product.channelModes.length) {
      wx.showToast({ title: '该灯具没有可用的厂家 DMX 通道模式', icon: 'none' })
      return
    }
    const read = readDmxPreferencesStatus()
    if (!read.ok) {
      wx.showToast({ title: read.error, icon: 'none' })
      return
    }
    const draft = inspectDmxPreferences(read.preferences)
    this._dmxImportSubmitting = false
    this._dmxImportOpenedSignature = JSON.stringify(read.preferences)
    this.setData({
      dmxImportVisible: true,
      dmxImportModes: product.channelModes.map((channelCount) => ({
        channelCount,
        label: `${channelCount} CH`,
      })),
      dmxImportChannelCount: '',
      dmxImportFixtureCount: '1',
      dmxImportHasGroups: draft.hasGroups,
      dmxImportExistingGroupCount: draft.existingGroupCount,
      dmxImportGroupsReadable: draft.groupsReadable,
      dmxImportAction: '',
      dmxImportError: '',
      dmxImportSubmitting: false,
      dmxImportAllocationHint: read.preferences.allocationMode === 'manual'
        ? '手动分域追加时，新组沿用现有末组域；替换时新组从 A 域开始。'
        : '',
    })
  },

  selectDmxImportMode(event) {
    const channelCount = String(event.currentTarget.dataset.channelCount || '')
    if (!this.data.dmxImportModes.some((mode) => String(mode.channelCount) === channelCount)) return
    const changed = channelCount !== this.data.dmxImportChannelCount
    this.setData({ dmxImportChannelCount: channelCount, dmxImportError: '' })
    if (changed) vibrate('light')
  },

  onDmxImportFixtureCountInput(event) {
    this.setData({ dmxImportFixtureCount: String(event.detail.value ?? ''), dmxImportError: '' })
  },

  selectDmxImportAction(event) {
    const action = event.currentTarget.dataset.action
    if (!['append', 'replace'].includes(action)) return
    if (action === 'append' && !this.data.dmxImportGroupsReadable) return
    const changed = action !== this.data.dmxImportAction
    this.setData({ dmxImportAction: action, dmxImportError: '' })
    if (changed) vibrate('light')
  },

  closeDmxProductImport() {
    if (this._dmxImportSubmitting) return
    this._dmxImportOpenedSignature = ''
    this.setData({
      dmxImportVisible: false,
      dmxImportChannelCount: '',
      dmxImportFixtureCount: '1',
      dmxImportAction: '',
      dmxImportError: '',
    })
  },

  stopDmxImportTap() {},

  confirmDmxProductImport() {
    if (this._dmxImportSubmitting || !this.data.dmxImportVisible) return
    this._dmxImportSubmitting = true
    this.setData({ dmxImportSubmitting: true, dmxImportError: '' })
    const product = this._productDetail
    const read = readDmxPreferencesStatus()
    if (!read.ok) {
      this._dmxImportSubmitting = false
      this.setData({ dmxImportSubmitting: false, dmxImportError: read.error })
      return
    }
    if (JSON.stringify(read.preferences) !== this._dmxImportOpenedSignature) {
      this._dmxImportSubmitting = false
      this.setData({
        dmxImportSubmitting: false,
        dmxImportError: '现有 DMX 草稿在面板打开后已变化，请取消并重新打开确认。',
      })
      return
    }
    const result = saveDmxProductImport({
      product,
      channelCountText: this.data.dmxImportChannelCount,
      fixtureCountText: this.data.dmxImportFixtureCount,
      action: this.data.dmxImportAction,
    })
    if (!result.ok) {
      this._dmxImportSubmitting = false
      this.setData({ dmxImportSubmitting: false, dmxImportError: result.error })
      return
    }
    vibrate('medium')
    this._dmxImportOpenedSignature = ''
    this.setData({ dmxImportVisible: false })
    wx.navigateTo({ url: `${CALCULATOR_PATHS.dmxAddress}?lightingCatalogImport=1` })
  },

  openDmxChannelGuide() {
    const product = this._productDetail
    if (!product || product.type !== 'lighting' || !product.dmxChannelGuide) return
    wx.navigateTo({ url: `/pages/dmx-address/channel-guide?model=${encodeURIComponent(product.model)}` })
  },

})

const { getProductDetail, markProductViewed } = require('../../utils/products')
const { readPreferences, writePreferencesDetailed } = require('../../utils/preferences')

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
    profile: detail.profile
      ? { roleText: detail.profile.roleText, source: detail.profile.source }
      : detail.profile,
    source: detail.source,
    sourcePageText: detail.sourcePageText,
    reviewDate: detail.reviewDate,
  }
}

Page({
  data: {
    product: null,
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

    if (moduleKey === 'dmxAddress' && product.type === 'lighting') {
      const key = 'audioTool.dmxAddress.preferences'
      const preferences = readPreferences(key)
      const channelCount = product.channelModes[0]
      writeResult = writePreferencesDetailed(key, {
        ...preferences,
        groups: [{
          name: `${product.model} ${product.name}`,
          fixtureModel: product.model,
          channelCount: String(channelCount),
          fixtureCount: '1',
        }],
      })
    }

    if (writeResult && !writeResult.ok) {
      wx.showToast({ title: '设置保存失败，请重试', icon: 'none' })
      return
    }

    wx.navigateTo({ url: CALCULATOR_PATHS[moduleKey] })
  },

  openDmxChannelGuide() {
    const product = this._productDetail
    if (!product || product.type !== 'lighting' || !product.dmxChannelGuide) return
    wx.navigateTo({ url: `/pages/dmx-address/channel-guide?model=${encodeURIComponent(product.model)}` })
  },

})

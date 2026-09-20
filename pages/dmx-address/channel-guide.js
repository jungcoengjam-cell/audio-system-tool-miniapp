const { buildDmxChannelGuide } = require('./utils/dmx-channel-guide')
const { stageLightingProductIndex } = require('../../data/stage-lighting')

function decode(value) {
  try { return decodeURIComponent(String(value || '')).trim() } catch (error) { return '' }
}

Page({
  data: { model: '', productName: '', guide: null, empty: true },

  onLoad(options = {}) {
    this.model = decode(options.model)
    this.channelCount = options.channelCount
    this.loadGuide()
    wx.setNavigationBarTitle({ title: '灯具通道资料' })
  },

  loadGuide() {
    const requestedCount = Number(this.channelCount)
    let guide = Number.isInteger(requestedCount)
      ? buildDmxChannelGuide({ model: this.model, channelCount: requestedCount })
      : null
    if (!guide) guide = buildDmxChannelGuide({ model: this.model })
    const product = stageLightingProductIndex.get(this.model)
    this.setData({
      model: this.model,
      productName: product ? product.name : '',
      guide,
      empty: !guide,
    })
  },

  switchMode(event) {
    this.channelCount = Number(event.currentTarget.dataset.channelCount)
    this.loadGuide()
  },

})

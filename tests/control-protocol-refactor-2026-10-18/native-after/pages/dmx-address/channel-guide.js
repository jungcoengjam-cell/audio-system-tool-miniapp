const { buildDmxChannelGuide, getDmxChannelMode, getDmxChannelModes } = require('./utils/dmx-channel-guide')
const { stageLightingProductIndex } = require('../../data/stage-lighting')
const { createOperationMethods, prepareOperation, disposeOperation, invalidateOperation, isOperationResultCurrent } = require('../../utils/operation-inputs')

const guideOperations = createOperationMethods({
  id: 'channel-guide',
  fields: {
    model: { label: '灯具型号', unit: '' },
    channelCount: { label: '通道模式', unit: 'CH' },
  },
  requiredFields: { 'channel-guide': ['model', 'channelCount'] },
})

function decode(value) {
  try { return decodeURIComponent(String(value || '')).trim() } catch (error) { return '' }
}

Page({
  ...guideOperations,
  data: { model: '', productName: '', guide: null, empty: true, operationSnapshot: null, operationModes: [] },

  onLoad(options = {}) {
    this.model = decode(options.model)
    this.channelCount = options.channelCount
    this.loadGuide()
    wx.setNavigationBarTitle({ title: '灯具通道资料' })
  },

  onUnload() {
    disposeOperation(this)
    this._guideUnloaded = true
    this.setData({ guide: null, empty: true, operationSnapshot: null, operationModes: [] })
  },

  loadGuide() {
    if (this._guideUnloaded) return
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

  beginStructuredOperation(facts = {}, kind = 'channel-guide') {
    const plain = facts && typeof facts === 'object' && !Array.isArray(facts)
      && (Object.getPrototypeOf(facts) === Object.prototype || Object.getPrototypeOf(facts) === null)
    const suppliedMode = plain ? facts.channelCount : undefined
    const values = plain ? { ...facts } : facts
    if (plain) delete values.channelCount
    const error = kind !== 'channel-guide' ? 'invalid operation kind' : values && typeof values === 'object' && !Array.isArray(values)
      && values.model !== undefined
      && (typeof values.model !== 'string' || !getDmxChannelModes(values.model).length)
      ? 'invalid structured model'
      : suppliedMode !== undefined && !getDmxChannelMode(values?.model, suppliedMode)
        ? 'invalid channel mode'
        : ''
    const snapshot = guideOperations.beginStructuredOperation.call(this,
      error ? { __invalidChannelGuide: error } : values, kind)
    if (!error && suppliedMode !== undefined && this.getOperationSnapshot()?.active) {
      this.setOperationCandidate('channelCount', suppliedMode, 'CH')
      this.confirmOperationField({ currentTarget: { dataset: { field: 'channelCount' } } })
    }
    return this.getOperationSnapshot() || snapshot
  },

  endOperation() {
    if (this._guideUnloaded) return
    guideOperations.endStructuredOperation.call(this)
    this.loadGuide()
  },

  onOperationStateChange(snapshot) {
    if (this._guideUnloaded) return
    const previous = this.data.operationSnapshot
    const shouldBuild = Boolean(snapshot?.ready
      && (!previous || previous.id !== snapshot.id || previous.revision !== snapshot.revision))
    const values = Object.fromEntries((snapshot?.fields || []).map((field) => [field.key, field.value]))
    const modes = getDmxChannelModes(values.model)
    const modeField = snapshot?.fields.find((field) => field.key === 'channelCount')
    const operationModes = modes.map((mode) => ({
      channelCount: mode.channelCount,
      label: `${mode.channelCount} CH`,
      selected: Boolean(modeField?.confirmed && modeField.value === mode.channelCount),
    }))
    const display = snapshot && {
      ...snapshot,
      fields: snapshot.fields.map((field) => ({
        ...field,
        displayValue: field.value === undefined ? '待输入' : `${field.value}${field.confirmed ? '' : '（待确认）'}`,
        hasValue: field.value !== undefined,
      })),
    }
    this.setData({
      operationSnapshot: display,
      operationModes,
      model: values.model || '',
      productName: values.model ? stageLightingProductIndex.get(values.model)?.name || '' : '',
    }, () => {
      if (!shouldBuild || this._guideUnloaded) return
      const current = this.getOperationSnapshot()
      if (!current?.ready || current.id !== snapshot.id || current.revision !== snapshot.revision) return
      const operation = prepareOperation(this)
      if (operation.blocked) return
      const guide = buildDmxChannelGuide({ model: operation.state.model, channelCount: operation.state.channelCount })
      if (!guide) { invalidateOperation(this, 'invalid-channel-guide-input'); return }
      const guard = operation.commit(guide)
      if (!guard || !isOperationResultCurrent(this, guard)) return
      this.setData({ guide, empty: false })
    })
  },

  onOperationInvalidate() {
    this.setData({ guide: null, empty: true, operationModes: [] })
  },

  switchMode(event) {
    if (this._guideUnloaded) return false
    const count = Number(event.currentTarget.dataset.channelCount)
    const snapshot = this.getOperationSnapshot()
    if (snapshot) {
      const model = snapshot.fields.find((field) => field.key === 'model')?.value
      if (!snapshot.active || !getDmxChannelMode(model, count)) return false
      if (!this.setOperationCandidate('channelCount', count, 'CH')) return false
      return this.confirmOperationField({ currentTarget: { dataset: { field: 'channelCount' } } })
    }
    this.channelCount = count
    this.loadGuide()
    return true
  },

})

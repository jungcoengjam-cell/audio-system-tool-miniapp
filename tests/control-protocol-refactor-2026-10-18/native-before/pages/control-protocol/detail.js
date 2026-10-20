const { catalog } = require('./runtime-catalog')
const {
  getReferenceManualDetail,
  getDevelopmentDraftPhotosForAppearanceGroup,
  resolveAppearanceGroupProtocol,
} = require('./model')

function messageForReason(reason) {
  const messages = {
    'unknown-appearance-group': '设备外观记录不存在或已更新，请返回图库重新查找。',
    'appearance-mapping-unreviewed': '该外观尚未确认唯一协议，暂不展示命令；请联系设备维护人员。',
    'appearance-photo-missing': '该设备暂无可公开的已审核实拍，暂不展示协议。',
    'device-variant-missing': '该外观组尚未关联设备型号，暂不能确定适用协议。',
    'device-variant-ambiguous': '该外观对应多个设备型号，无法自动确定适用协议；请联系设备维护人员。',
    'device-identity-incomplete': '设备品牌、型号或版本资料不完整，暂不能确定适用协议。',
    'controller-variant-missing': '该设备尚未关联控制卡型号，暂不能确定适用协议。',
    'controller-variant-ambiguous': '同一设备对应多个控制卡型号，无法自动确定适用协议；请联系设备维护人员。',
    'controller-identity-incomplete': '控制卡品牌、型号或版本资料不完整，暂不能确定适用协议。',
    'controller-source-unverified': '控制卡识别依据或复核资料尚未核验，暂不开放协议。',
    'protocol-not-found': '该控制卡尚无唯一协议记录，暂不开放命令。',
    'protocol-ambiguous': '该控制卡关联多份协议，无法自动确定适用版本；请联系设备维护人员。',
    'protocol-identity-mismatch': '协议适用的控制卡品牌或型号与目录记录不一致。',
    'protocol-version-mismatch': '协议适用的控制卡版本与目录记录不一致。',
    'protocol-not-verified': '协议尚未完成复核，暂不开放命令。',
    'protocol-source-unverified': '协议来源或授权尚未完成核验。',
    'protocol-incomplete': '协议标题、参数、命令或追溯信息不完整，暂不开放。',
  }
  return messages[reason] || '当前资料无法确认适用协议，请联系设备维护人员。'
}

function decoratePhotos(photos = []) {
  const labels = {
    appearanceGroup: '整体外观参考',
    deviceVariant: '型号/铭牌/接口',
    controllerVariant: '控制卡细节',
    referenceManual: '人工辨认参考',
  }
  return photos.map((photo) => ({
    ...photo,
    displayAngle: photo.developmentOnly === true && photo.status === 'draft'
      ? `开发预览照片（不参与正式协议准入） · ${photo.angleLabel || '现场对照'}`
      : `${labels[photo.ownerType] || '设备实拍'} · ${photo.angleLabel || '现场对照'}`,
  }))
}

function normalizeDeviceMac(value) {
  const input = String(value || '')
  if (!/^[0-9a-fA-F]{12}$/.test(input)) return ''
  return input.toUpperCase().match(/.{2}/g).join(' ')
}

function frameForManualCommand(command, transport, macValue) {
  if (!command || !command.frame) return ''
  if (command.requiresDeviceMac === true) {
    const mac = normalizeDeviceMac(macValue)
    if (!mac || !transport || transport.id !== 'udp') return ''
    const bytes = command.frame.split(/\s+/)
    const macBytes = mac.split(' ')
    const start = Number(command.macByteStart)
    if (!Number.isInteger(start) || start < 0 || bytes.length < start + macBytes.length) return ''
    bytes.splice(start, macBytes.length, ...macBytes)
    return bytes.join(' ')
  }
  return command.frame
}

function decorateManualCommands(commands, transport, macValue) {
  return commands.map((command) => {
    const frame = frameForManualCommand(command, transport, macValue)
    const displayFrame = frame || (command.requiresDeviceMac === true
      ? command.frame.split(/\s+/).map((byte, index) => index >= command.macByteStart && index < command.macByteStart + 6 ? '__' : byte).join(' ')
      : command.frame)
    return { ...command, displayFrame, copyEnabled: Boolean(frame) && (command.requiresDeviceMac === true || command.copyable !== false) }
  })
}

function manualTransportTabs(manual) {
  if (!manual) return []
  const labels = {
    rtu: '串口协议（RS485）',
    tcp: '网络协议（TCP/IP）',
    rs485: '串口协议（RS485）',
    udp: '网络协议（UDP）',
  }
  return manual.transports
    .map((transport, sourceIndex) => ({ id: transport.id, label: labels[transport.id] || transport.name, sourceIndex }))
    .sort((left, right) => {
      const rank = (tab) => ['rtu', 'rs485'].includes(tab.id) ? 0 : ['tcp', 'udp'].includes(tab.id) ? 1 : 2
      return rank(left) - rank(right)
    })
}

Page({
  data: {
    invalidGroup: false,
    group: null,
    reference: null,
    photos: [],
    protocol: null,
    manual: null,
    manualTransportTabs: [],
    manualTransport: null,
    manualTransportIndex: 0,
    loopOptions: [],
    selectedLoopIndex: 0,
    selectedLoopLabel: '第1路',
    selectedLoopCommands: [],
    commonManualCommands: [],
    manualWriteCommands: [],
    showManualWrites: false,
    deviceMacInput: '',
    deviceMacValid: false,
    deviceMacFormatted: '',
    statusMessage: '',
  },

  onLoad(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'referenceId')) {
      const reference = getReferenceManualDetail(catalog, String(options.referenceId || ''))
      if (!reference) {
        this.invalidateDetail('协议参考不存在、重复或资料不完整，请返回图库重新选择。')
        return
      }
      this.loadManualDetail({
        group: { id: reference.id, title: reference.title },
        reference,
        photos: [{ ...reference.photo, ownerType: 'referenceManual' }],
        protocol: null,
        manual: reference.manual,
        statusMessage: reference.applicabilityNote,
      })
      return
    }

    const appearanceGroupId = String(options.appearanceGroupId || '')
    const resolution = resolveAppearanceGroupProtocol(catalog, appearanceGroupId)
    if (!resolution.group) {
      this.invalidateDetail(messageForReason(resolution.reason))
      return
    }
    const photos = catalog.developmentDraftOnly === true
      ? getDevelopmentDraftPhotosForAppearanceGroup(catalog, resolution.group.id)
      : resolution.photos || []
    const manual = catalog.developmentDraftOnly === true
      ? resolution.group.developmentManual || null
      : null
    this.loadManualDetail({
      group: resolution.group,
      reference: null,
      photos,
      protocol: resolution.allowed ? resolution.protocol : null,
      manual,
      statusMessage: manual
        ? `${manual.applicabilityNote} 此详情为开发预览，只复制到剪贴板，不发送设备。`
        : resolution.allowed
        ? '已按唯一设备型号、控制卡型号和协议记录匹配。'
        : messageForReason(resolution.reason),
    })
  },

  loadManualDetail({ group, reference, photos, protocol, manual, statusMessage }) {
    const transportTabs = manualTransportTabs(manual)
    const manualTransportIndex = transportTabs.length ? transportTabs[0].sourceIndex : 0
    const manualTransport = manual ? manual.transports[manualTransportIndex] : null
    const allManualWriteCommands = manualTransport ? manualTransport.commands.filter((command) => command.category === 'write') : []
    const quickCommandCount = manual ? manual.quickCommandCount || 4 : 4
    const manualWriteCommands = allManualWriteCommands.slice(quickCommandCount)
    const loopCount = manual ? manual.loopCount || 40 : 40
    const loopOptions = Array.from({ length: loopCount }, (_, index) => `第${index + 1}路`)
    const selectedLoopCommands = this.getLoopCommands(manualWriteCommands, 1, manual)
    this.setData({
      invalidGroup: false,
      group,
      reference: reference || null,
      photos: decoratePhotos(photos),
      protocol: protocol || null,
      manual: manual || null,
      manualTransportTabs: transportTabs,
      manualTransport,
      manualTransportIndex,
      loopOptions,
      selectedLoopIndex: 0,
      selectedLoopLabel: '第1路',
      commonManualCommands: decorateManualCommands(allManualWriteCommands.slice(0, quickCommandCount), manualTransport, ''),
      manualWriteCommands: decorateManualCommands(manualWriteCommands, manualTransport, ''),
      selectedLoopCommands: decorateManualCommands(selectedLoopCommands, manualTransport, ''),
      showManualWrites: false,
      deviceMacInput: '',
      deviceMacValid: false,
      deviceMacFormatted: '',
      statusMessage: statusMessage || '',
    })
  },

  invalidateDetail(statusMessage) {
    this.setData({
      invalidGroup: true,
      group: null,
      reference: null,
      photos: [],
      protocol: null,
      manual: null,
      manualTransportTabs: [],
      manualTransport: null,
      manualTransportIndex: 0,
      loopOptions: [],
      selectedLoopIndex: 0,
      selectedLoopLabel: '第1路',
      selectedLoopCommands: [],
      commonManualCommands: [],
      manualWriteCommands: [],
      showManualWrites: false,
      deviceMacInput: '',
      deviceMacValid: false,
      deviceMacFormatted: '',
      statusMessage,
    })
  },

  returnToGallery() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.redirectTo({ url: '/pages/control-protocol/index' }),
    })
  },

  copyProtocol() {
    if (!this.data.protocol || !this.data.protocol.copyText) return
    wx.setClipboardData({ data: this.data.protocol.copyText })
  },

  copyManualCommand(event) {
    const manual = this.data.manual
    const commandId = String(event.currentTarget.dataset.commandId || '')
    if (!manual || !this.data.manualTransport || !commandId) return
    const visibleCommands = [
      ...this.data.commonManualCommands,
      ...this.data.selectedLoopCommands,
      ...(this.data.showManualWrites ? this.data.manualWriteCommands : []),
    ]
    const command = visibleCommands.find((item) => item.id === commandId && item.id.startsWith(`${this.data.manualTransport.id}-`)) || null
    if (!command || command.category !== 'write' || !command.frame) return
    if (command.requiresDeviceMac === true && !normalizeDeviceMac(this.data.deviceMacInput)) return
    if (command.copyable !== true && command.requiresDeviceMac !== true) return
    const frame = frameForManualCommand(command, this.data.manualTransport, this.data.deviceMacInput)
    if (!frame) return
    wx.setClipboardData({ data: frame })
  },

  selectManualTransport(event) {
    const index = Number(event.currentTarget.dataset.index)
    const manual = this.data.manual
    if (!manual || !Number.isInteger(index) || !manual.transports[index]) return
    const transport = manual.transports[index]
    const allManualWriteCommands = transport.commands.filter((command) => command.category === 'write')
    const quickCommandCount = manual.quickCommandCount || 4
    const manualWriteCommands = allManualWriteCommands.slice(quickCommandCount)
    this.setData({
      manualTransport: transport,
      manualTransportIndex: index,
      commonManualCommands: decorateManualCommands(allManualWriteCommands.slice(0, quickCommandCount), transport, this.data.deviceMacInput),
      manualWriteCommands: decorateManualCommands(manualWriteCommands, transport, this.data.deviceMacInput),
      selectedLoopCommands: decorateManualCommands(this.getLoopCommands(manualWriteCommands, this.data.selectedLoopIndex + 1, manual), transport, this.data.deviceMacInput),
    })
  },

  getLoopCommands(commands, loopNumber, manual = this.data.manual) {
    const prefix = `第${loopNumber}路`
    const actions = manual && manual.loopActions || ['启动', '关闭']
    const matches = actions.map((suffix) => commands.find((command) => command.label === `${prefix}${suffix}`))
    return matches.every(Boolean) ? matches : []
  },

  selectManualLoop(event) {
    const index = Number(event.detail.value)
    const loopCount = this.data.manual && this.data.manual.loopCount || 40
    if (!Number.isInteger(index) || index < 0 || index >= loopCount) return
    this.setData({
      selectedLoopIndex: index,
      selectedLoopLabel: `第${index + 1}路`,
      selectedLoopCommands: decorateManualCommands(this.getLoopCommands(this.data.manualWriteCommands, index + 1, this.data.manual), this.data.manualTransport, this.data.deviceMacInput),
    })
  },

  onDeviceMacInput(event) {
    const input = String(event.detail.value || '')
    const formatted = normalizeDeviceMac(input)
    const transport = this.data.manualTransport
    const manual = this.data.manual
    if (!transport || !manual) return
    const commands = transport.commands.filter((command) => command.category === 'write')
    const quickCommandCount = manual.quickCommandCount || 4
    const remainingCommands = commands.slice(quickCommandCount)
    this.setData({
      deviceMacInput: input,
      deviceMacValid: Boolean(formatted),
      deviceMacFormatted: formatted,
      commonManualCommands: decorateManualCommands(commands.slice(0, quickCommandCount), transport, input),
      manualWriteCommands: decorateManualCommands(remainingCommands, transport, input),
      selectedLoopCommands: decorateManualCommands(this.getLoopCommands(remainingCommands, this.data.selectedLoopIndex + 1), transport, input),
    })
  },

  clearDeviceMac() {
    this.onDeviceMacInput({ detail: { value: '' } })
  },

  toggleManualWrites() {
    this.setData({ showManualWrites: !this.data.showManualWrites })
  },

  copyProtocolCommand(event) {
    const commandId = String(event.currentTarget.dataset.commandId || '')
    const command = this.data.protocol && this.data.protocol.commands.find((item) => item.id === commandId)
    if (!command || !command.value) return
    wx.setClipboardData({ data: command.value })
  },

  previewPhoto(event) {
    const current = String(event.currentTarget.dataset.path || '')
    const urls = (this.data.photos || []).map((photo) => photo.path).filter(Boolean)
    if (!current || !urls.includes(current)) return
    wx.previewImage({ current, urls })
  },
})

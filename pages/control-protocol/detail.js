let markToolLoadStage = () => false
try {
  const performanceProbe = require('../../utils/performance')
  if (typeof performanceProbe.markToolLoadStage === 'function') {
    markToolLoadStage = (route, phase) => {
      try { return performanceProbe.markToolLoadStage(route, phase) } catch (error) { return false }
    }
  }
  markToolLoadStage('/pages/control-protocol/detail', 'module')
} catch (error) {}

const { catalog } = require('./runtime-catalog')
const {
  getReferenceManualDetail,
  getDevelopmentDraftPhotosForAppearanceGroup,
  resolveAppearanceGroupProtocol,
  searchGallery,
  searchReferenceManuals,
} = require('./model')
const { CATEGORIES } = require('./catalog')
const viewerState = require('./viewer-state')
const { vibrate } = require('../../utils/haptics')

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
  const displayLabels = { rtu: 'RS485', tcp: 'TCP/IP', rs485: 'RS485', udp: 'UDP' }
  return manual.transports
    .map((transport, sourceIndex) => ({
      id: transport.id,
      label: labels[transport.id] || transport.name,
      displayLabel: displayLabels[transport.id] || transport.name,
      sourceIndex,
    }))
    .sort((left, right) => {
      const rank = (tab) => ['rtu', 'rs485'].includes(tab.id) ? 0 : ['tcp', 'udp'].includes(tab.id) ? 1 : 2
      return rank(left) - rank(right)
    })
}

function sameDevice(left, right) {
  return Boolean(left && right && left.type === right.type && left.id === right.id)
}

function scopeSummary(reference, group, manual, protocol) {
  if (reference) {
    if (reference.deviceModel && reference.deviceModel !== '未知') {
      const model = String(reference.deviceModel).split('（')[0]
      return `仅限 ${model} 现场样本`
    }
    if (reference.controllerModel) {
      return `仅限照片中 ${reference.controllerModel} 控制卡`
    }
  }
  return (protocol && protocol.applicabilityNote)
    || (manual && manual.applicabilityNote)
    || (group && group.applicabilityNote)
    || ''
}

function categoryOptions(selectedKey) {
  return CATEGORIES.map((item) => ({ ...item, selected: item.key === selectedKey }))
}

function displayModel(reference, group, protocol) {
  if (reference) return reference.controllerModel || reference.title
  if (protocol && protocol.controllerModel) {
    return [protocol.controllerBrand, protocol.controllerModel].filter(Boolean).join(' · ')
  }
  if (!group) return ''
  const variants = Array.isArray(group.deviceVariants) ? group.deviceVariants : []
  const first = variants[0]
  return first ? [first.brand, first.model].filter(Boolean).join(' · ') : group.categoryLabel || '控制卡'
}

Page({
  data: {
    invalidGroup: false,
    group: null,
    reference: null,
    currentDeviceRef: null,
    deviceTitle: '',
    scopeSummary: '',
    photos: [],
    mainPhoto: null,
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
    readerScrollTop: 0,
    activeOverlay: '',
    sheetOpen: false,
    categoryKey: 'all',
    categories: categoryOptions('all'),
    keyword: '',
    directoryItems: [],
    directoryIsEmpty: true,
    directoryListHeight: 138,
    selectedDeviceHidden: false,
  },

  onLoad(options = {}) {
    markToolLoadStage('/pages/control-protocol/detail', 'onLoad')
    this._pageUnloaded = false
    this._pageHidden = false
    this._viewerState = viewerState.readViewerState(catalog)
    this._currentScrollTop = 0
    this._copyContextToken = 0
    this._copyAttempt = 0
    this._copyInFlight = 0
    this._copyFeedbackActive = false
    this._copyFeedbackMessage = ''
    this._sheetOpenTimer = null
    this._sheetCloseTimer = null
    this._sheetTransitionEpoch = 0
    this._sheetCloseReady = false
    this._copyFeedbackTimer = null
    this._sheetDuration = this.getSheetDuration()
    this._photoContextToken = 0
    this._photoRequestToken = 0
    this._photoLoadingRequest = 0
    this._photoLocalPaths = Object.create(null)
    this._photoCopyRequests = Object.create(null)

    if (Object.prototype.hasOwnProperty.call(options, 'referenceId')) {
      const referenceId = String(options.referenceId || '')
      if (!this.loadDevice({ type: 'reference', id: referenceId })) {
        this.invalidateDetail('协议参考不存在、重复或资料不完整，请返回图库重新选择。')
      }
      return
    }
    if (Object.prototype.hasOwnProperty.call(options, 'appearanceGroupId')) {
      const appearanceGroupId = String(options.appearanceGroupId || '')
      if (!this.loadDevice({ type: 'appearance', id: appearanceGroupId })) {
        const resolution = resolveAppearanceGroupProtocol(catalog, appearanceGroupId)
        this.invalidateDetail(messageForReason(resolution.reason))
      }
      return
    }

    const remembered = viewerState.normalizeDeviceRef(this._viewerState.deviceRef, catalog)
    const fallback = remembered || this.firstAvailableDevice()
    if (!fallback || !this.loadDevice(fallback)) {
      this.invalidateDetail('当前没有可查看的协议资料。')
    }
  },

  onReady() {
    markToolLoadStage('/pages/control-protocol/detail', 'onReady')
  },

  getSheetDuration() {
    try {
      const systemInfo = typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {}
      const app = typeof getApp === 'function' ? getApp() : null
      const reduced = systemInfo && (systemInfo.reducedMotion === true || systemInfo.prefersReducedMotion === true)
        || app && app.globalData && app.globalData.reducedMotion === true
      return reduced ? 0 : 320
    } catch (error) {
      return 320
    }
  },

  firstAvailableDevice() {
    const groups = searchGallery(catalog)
    if (groups.length) return { type: 'appearance', id: groups[0].groupId }
    const references = searchReferenceManuals(catalog)
    return references.length ? { type: 'reference', id: references[0].referenceId } : null
  },

  resolveDevice(deviceRef) {
    const safeRef = viewerState.normalizeDeviceRef(deviceRef, catalog)
    if (!safeRef) return null
    if (safeRef.type === 'reference') {
      const reference = getReferenceManualDetail(catalog, safeRef.id)
      return reference ? {
        deviceRef: safeRef,
        group: { id: reference.id, title: reference.title },
        reference,
        photos: [{ ...reference.photo, ownerType: 'referenceManual' }],
        protocol: null,
        manual: reference.manual,
        statusMessage: '人工选定的协议参考，不参与自动识别或自动匹配。',
      } : null
    }

    const resolution = resolveAppearanceGroupProtocol(catalog, safeRef.id)
    if (!resolution.group) return null
    const photos = catalog.developmentDraftOnly === true
      ? getDevelopmentDraftPhotosForAppearanceGroup(catalog, resolution.group.id)
      : resolution.photos || []
    const manual = catalog.developmentDraftOnly === true
      ? resolution.group.developmentManual || null
      : null
    return {
      deviceRef: safeRef,
      group: resolution.group,
      reference: null,
      photos,
      protocol: resolution.allowed ? resolution.protocol : null,
      manual,
      statusMessage: manual
        ? '开发预览资料：命令仅复制到剪贴板，不发送设备。'
        : resolution.allowed
        ? '已按唯一设备型号、控制卡型号和协议记录匹配。'
        : messageForReason(resolution.reason),
    }
  },

  getCurrentDeviceRef() {
    return this.data.currentDeviceRef || null
  },

  currentReading() {
    const deviceRef = this.getCurrentDeviceRef()
    const modeId = this.data.manualTransport && this.data.manualTransport.id
      || (this.data.protocol ? 'protocol' : '')
    if (!deviceRef || !modeId) return null
    return {
      modeId,
      reading: {
        scrollTop: this._currentScrollTop,
        loopIndex: this.data.selectedLoopIndex,
        showManualWrites: this.data.showManualWrites,
      },
    }
  },

  rememberCurrentView() {
    const current = this.getCurrentDeviceRef()
    const saved = this.currentReading()
    if (!current || !saved) return
    this._viewerState = viewerState.updateDevice(this._viewerState, current, saved.modeId, saved.reading, catalog)
  },

  persistViewerState() {
    if (!this.getCurrentDeviceRef()) return
    this.rememberCurrentView()
    viewerState.saveViewerState(this._viewerState, catalog)
  },

  onHide() {
    this._pageHidden = true
    this.persistViewerState()
  },

  onShow() {
    this._pageHidden = false
  },

  onUnload() {
    this.persistViewerState()
    this._pageUnloaded = true
    this.invalidateCopyContext()
    this.invalidatePhotoContext()
    this.clearSheetTimers()
  },

  loadDevice(deviceRef) {
    const safeRef = viewerState.normalizeDeviceRef(deviceRef, catalog)
    const resolved = this.resolveDevice(safeRef)
    if (!resolved) return false

    const previousRef = this.getCurrentDeviceRef()
    const switchingDevice = !sameDevice(previousRef, safeRef)
    if (previousRef) this.rememberCurrentView()
    if (switchingDevice) {
      this.invalidateCopyContext()
      this.invalidatePhotoContext()
    }

    const tabs = manualTransportTabs(resolved.manual)
    const modeIds = tabs.map((tab) => tab.id)
    const savedMode = viewerState.getLastMode(this._viewerState, safeRef, catalog)
    const modeId = modeIds.includes(savedMode) ? savedMode : (modeIds[0] || (resolved.protocol ? 'protocol' : ''))
    const manualTransportIndex = resolved.manual
      ? resolved.manual.transports.findIndex((transport) => transport.id === modeId)
      : 0
    const manualTransport = manualTransportIndex >= 0 && resolved.manual
      ? resolved.manual.transports[manualTransportIndex]
      : null
    const reading = modeId
      ? viewerState.getReading(this._viewerState, safeRef, modeId, catalog)
      : { scrollTop: 0, loopIndex: 0, showManualWrites: false }
    const allManualWriteCommands = manualTransport
      ? manualTransport.commands.filter((command) => command.category === 'write')
      : []
    const quickCommandCount = resolved.manual ? resolved.manual.quickCommandCount || 4 : 4
    const manualWriteCommands = allManualWriteCommands.slice(quickCommandCount)
    const loopCount = resolved.manual ? resolved.manual.loopCount || 40 : 40
    const loopIndex = Math.max(0, Math.min(loopCount - 1, reading.loopIndex || 0))
    const loopOptions = Array.from({ length: loopCount }, (_, index) => `第${index + 1}路`)
    const photoList = resolved.photos.map((photo) => ({ ...photo, imageFailed: false }))
    const mainPhoto = photoList[0] || null
    const nextData = {
      invalidGroup: false,
      group: resolved.group,
      reference: resolved.reference || null,
      currentDeviceRef: safeRef,
      deviceTitle: displayModel(resolved.reference, resolved.group, resolved.protocol),
      scopeSummary: scopeSummary(resolved.reference, resolved.group, resolved.manual, resolved.protocol),
      photos: photoList,
      mainPhoto,
      protocol: resolved.protocol || null,
      manual: resolved.manual || null,
      manualTransportTabs: tabs,
      manualTransport,
      manualTransportIndex: manualTransportIndex >= 0 ? manualTransportIndex : 0,
      loopOptions,
      selectedLoopIndex: loopIndex,
      selectedLoopLabel: `第${loopIndex + 1}路`,
      commonManualCommands: decorateManualCommands(allManualWriteCommands.slice(0, quickCommandCount), manualTransport, ''),
      manualWriteCommands: decorateManualCommands(manualWriteCommands, manualTransport, ''),
      selectedLoopCommands: decorateManualCommands(this.getLoopCommands(manualWriteCommands, loopIndex + 1, resolved.manual), manualTransport, ''),
      showManualWrites: reading.showManualWrites === true,
      deviceMacInput: '',
      deviceMacValid: false,
      deviceMacFormatted: '',
      statusMessage: resolved.statusMessage || '',
      readerScrollTop: reading.scrollTop,
    }
    this._currentScrollTop = reading.scrollTop
    this.setData(nextData)
    if (modeId) {
      this._viewerState = viewerState.updateDevice(this._viewerState, safeRef, modeId, reading, catalog)
      viewerState.saveViewerState(this._viewerState, catalog)
    } else {
      this._viewerState = { ...this._viewerState, deviceRef: safeRef }
      viewerState.saveViewerState(this._viewerState, catalog)
    }
    this.refreshDirectory()
    return true
  },

  invalidateDetail(statusMessage) {
    this.invalidateCopyContext()
    this.invalidatePhotoContext()
    this.setData({
      invalidGroup: true,
      group: null,
      reference: null,
      currentDeviceRef: null,
      deviceTitle: '',
      scopeSummary: '',
      photos: [],
      mainPhoto: null,
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
      readerScrollTop: 0,
      activeOverlay: '',
      sheetOpen: false,
    })
  },

  returnToGallery() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.redirectTo({ url: '/pages/control-protocol/index' }),
    })
  },

  onReaderScroll(event) {
    const scrollTop = Number(event.detail && event.detail.scrollTop)
    const nextScrollTop = Number.isFinite(scrollTop) ? Math.max(0, Math.min(200000, scrollTop)) : 0
    this._currentScrollTop = nextScrollTop
    if (Math.abs((Number(this.data.readerScrollTop) || 0) - nextScrollTop) >= 1) {
      this.setData({ readerScrollTop: nextScrollTop })
    }
  },

  refreshDirectory() {
    const filters = { category: this.data.categoryKey || 'all', keyword: this.data.keyword || '' }
    const groupItems = searchGallery(catalog, filters).map((item) => ({
      key: `appearance:${item.groupId}`,
      type: 'appearance',
      id: item.groupId,
      title: item.group.title,
      subtitle: item.group.categoryLabel || '控制卡',
      photoPath: item.photo && item.photo.path || '',
      imageFailed: false,
    }))
    const referenceItems = searchReferenceManuals(catalog, filters).map((item) => {
      const reference = getReferenceManualDetail(catalog, item.referenceId)
      return {
        key: `reference:${item.referenceId}`,
        type: 'reference',
        id: item.referenceId,
        title: item.title,
        subtitle: reference ? [reference.controllerBrand, reference.controllerModel].filter(Boolean).join(' · ') : '人工协议参考',
        photoPath: item.photo && item.photo.path || '',
        imageFailed: false,
      }
    })
    const directoryItems = [...groupItems, ...referenceItems].map((item) => ({
      ...item,
      selected: sameDevice(this.data.currentDeviceRef, { type: item.type, id: item.id }),
    }))
    const selectedDeviceHidden = Boolean(this.data.currentDeviceRef
      && !directoryItems.some((item) => item.selected))
    let maxListHeight = 680
    try {
      const info = wx.getSystemInfoSync()
      if (info && Number(info.windowHeight) > 0 && Number(info.windowWidth) > 0) {
        maxListHeight = Math.floor(info.windowHeight * 0.5 * 750 / info.windowWidth)
      }
    } catch (error) {
      // Keep a bounded fallback when viewport information is unavailable.
    }
    const directoryListHeight = Math.max(112, Math.min(directoryItems.length * 138 || 150, maxListHeight))
    this.setData({
      categories: categoryOptions(filters.category),
      directoryItems,
      directoryIsEmpty: directoryItems.length === 0,
      directoryListHeight,
      selectedDeviceHidden,
    })
  },

  openDeviceSelector() {
    this.refreshDirectory()
    this.openOverlay()
  },

  openOverlay() {
    if (this._sheetOpenTimer) clearTimeout(this._sheetOpenTimer)
    if (this._sheetCloseTimer) clearTimeout(this._sheetCloseTimer)
    this._sheetOpenTimer = null
    this._sheetCloseTimer = null
    const transitionEpoch = (this._sheetTransitionEpoch || 0) + 1
    this._sheetTransitionEpoch = transitionEpoch
    this._sheetCloseReady = false
    if (this._sheetDuration === 0) {
      this.setData({ activeOverlay: 'device', sheetOpen: true })
      return
    }
    this.setData({ activeOverlay: 'device', sheetOpen: false }, () => {
      if (this._pageUnloaded
        || this._sheetTransitionEpoch !== transitionEpoch
        || this.data.activeOverlay !== 'device'
        || this.data.sheetOpen) return
      const timer = setTimeout(() => {
        if (this._sheetOpenTimer === timer) this._sheetOpenTimer = null
        if (this._pageUnloaded
          || this._sheetTransitionEpoch !== transitionEpoch
          || this.data.activeOverlay !== 'device'
          || this.data.sheetOpen) return
        this.setData({ sheetOpen: true })
      }, 16)
      this._sheetOpenTimer = timer
    })
  },

  closeOverlay() {
    if (!this.data.activeOverlay) return
    if (this._sheetOpenTimer) clearTimeout(this._sheetOpenTimer)
    if (this._sheetCloseTimer) clearTimeout(this._sheetCloseTimer)
    this._sheetOpenTimer = null
    this._sheetCloseTimer = null
    const transitionEpoch = (this._sheetTransitionEpoch || 0) + 1
    this._sheetTransitionEpoch = transitionEpoch
    this._sheetCloseReady = false
    if (this._sheetDuration === 0) {
      this.setData({ activeOverlay: '', sheetOpen: false })
      return
    }
    this.setData({ sheetOpen: false }, () => {
      if (this._pageUnloaded
        || this._sheetTransitionEpoch !== transitionEpoch
        || this.data.activeOverlay !== 'device'
        || this.data.sheetOpen) return
      this._sheetCloseReady = true
      const timer = setTimeout(() => {
        if (this._sheetCloseTimer === timer) this._sheetCloseTimer = null
        if (!this._pageUnloaded
          && this._sheetTransitionEpoch === transitionEpoch
          && this.data.activeOverlay === 'device'
          && !this.data.sheetOpen) {
          this._sheetCloseReady = false
          this.setData({ activeOverlay: '', sheetOpen: false })
        }
      }, this._sheetDuration + 24)
      this._sheetCloseTimer = timer
    })
  },

  onSheetTransitionEnd(event) {
    if (this.data.sheetOpen || !this.data.activeOverlay || !this._sheetCloseReady) return
    if (event && event.target && event.currentTarget && event.target !== event.currentTarget) return
    if (this._sheetCloseTimer) clearTimeout(this._sheetCloseTimer)
    this._sheetCloseTimer = null
    this._sheetCloseReady = false
    this._sheetTransitionEpoch = (this._sheetTransitionEpoch || 0) + 1
    this.setData({ activeOverlay: '', sheetOpen: false })
  },

  clearSheetTimers() {
    if (this._sheetOpenTimer) clearTimeout(this._sheetOpenTimer)
    if (this._sheetCloseTimer) clearTimeout(this._sheetCloseTimer)
    this._sheetOpenTimer = null
    this._sheetCloseTimer = null
    this._sheetCloseReady = false
    this._sheetTransitionEpoch = (this._sheetTransitionEpoch || 0) + 1
  },

  onOverlayMaskTap() {
    this.closeOverlay()
  },

  stopOverlayTap() {},

  onCategoryTap(event) {
    const categoryKey = String(event.currentTarget.dataset.key || 'all')
    const safeKey = CATEGORIES.some((item) => item.key === categoryKey) ? categoryKey : 'all'
    const changed = safeKey !== this.data.categoryKey
    this.setData({ categoryKey: safeKey }, () => this.refreshDirectory())
    if (changed) vibrate('light')
  },

  onSearchInput(event) {
    this.setData({ keyword: String(event.detail.value || '') }, () => this.refreshDirectory())
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.refreshDirectory())
  },

  clearFilters() {
    const categoryChanged = this.data.categoryKey !== 'all'
    this.setData({ categoryKey: 'all', keyword: '' }, () => this.refreshDirectory())
    if (categoryChanged) vibrate('light')
  },

  selectDevice(event) {
    const type = String(event.currentTarget.dataset.type || '')
    const id = String(event.currentTarget.dataset.id || '')
    const selectedRef = { type, id }
    if (!viewerState.normalizeDeviceRef(selectedRef, catalog)) return
    const changed = !sameDevice(this.data.currentDeviceRef, selectedRef)
    if (changed && !this.loadDevice(selectedRef)) return
    if (changed) vibrate('light')
    this.closeOverlay()
  },

  onDirectoryPhotoError(event) {
    const key = String(event.currentTarget.dataset.key || '')
    if (!key) return
    this.setData({ directoryItems: this.data.directoryItems.map((item) => item.key === key ? { ...item, imageFailed: true } : item) })
  },

  retryDirectoryPhoto(event) {
    const key = String(event.currentTarget.dataset.key || '')
    this.setData({ directoryItems: this.data.directoryItems.map((item) => item.key === key ? { ...item, imageFailed: false } : item) })
  },

  onPhotoError(event) {
    const path = String(event.currentTarget.dataset.path || '')
    if (!path) return
    const photos = this.data.photos.map((photo) => photo.path === path ? { ...photo, imageFailed: true } : photo)
    this.setData({ photos, mainPhoto: photos.find((photo) => photo.path === path) || this.data.mainPhoto })
  },

  retryPhoto(event) {
    const path = String(event.currentTarget.dataset.path || '')
    const photos = this.data.photos.map((photo) => photo.path === path ? { ...photo, imageFailed: false } : photo)
    this.setData({ photos, mainPhoto: photos.find((photo) => photo.path === path) || null })
  },

  hidePhotoLoading(requestToken) {
    if (!this._photoLoadingRequest || (requestToken && this._photoLoadingRequest !== requestToken)) return
    this._photoLoadingRequest = 0
    if (typeof wx.hideLoading === 'function') wx.hideLoading()
  },

  invalidatePhotoContext() {
    this._photoContextToken += 1
    this._photoRequestToken += 1
    this.hidePhotoLoading()
  },

  isCurrentPhotoRequest(contextToken, requestToken) {
    return !this._pageUnloaded
      && contextToken === this._photoContextToken
      && requestToken === this._photoRequestToken
  },

  ensureLocalPhoto(sourcePath, callback) {
    if (Object.prototype.hasOwnProperty.call(this._photoLocalPaths, sourcePath)) {
      callback(null, this._photoLocalPaths[sourcePath])
      return
    }
    const existing = this._photoCopyRequests[sourcePath]
    if (existing) {
      existing.callbacks.push(callback)
      return
    }

    let fileSystem
    let userDataPath
    try {
      fileSystem = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
      userDataPath = wx.env && wx.env.USER_DATA_PATH
    } catch (error) {
      callback(error)
      return
    }
    if (!fileSystem || typeof fileSystem.copyFile !== 'function' || !userDataPath) {
      callback(new Error('Local photo cache is unavailable'))
      return
    }

    const basename = sourcePath.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_')
    const destination = `${String(userDataPath).replace(/\/+$/, '')}/tunebuddy-protocol-photo-${basename}`
    const request = { destination, callbacks: [callback] }
    this._photoCopyRequests[sourcePath] = request
    const finish = (error) => {
      if (this._photoCopyRequests[sourcePath] !== request) return
      delete this._photoCopyRequests[sourcePath]
      if (!error) this._photoLocalPaths[sourcePath] = destination
      const callbacks = request.callbacks.splice(0)
      callbacks.forEach((done) => done(error || null, error ? '' : destination))
    }
    try {
      fileSystem.copyFile({
        srcPath: sourcePath.replace(/^\/+/, ''),
        destPath: destination,
        success: () => finish(null),
        fail: (error) => finish(error || new Error('Photo copy failed')),
      })
    } catch (error) {
      finish(error)
    }
  },

  previewLocalPhotos(current, sourcePaths) {
    const urls = Array.from(new Set(sourcePaths.filter(Boolean)))
    if (!current || !urls.includes(current)) return
    this.hidePhotoLoading()
    const contextToken = this._photoContextToken
    const requestToken = ++this._photoRequestToken
    const needsCopy = urls.some((path) => !Object.prototype.hasOwnProperty.call(this._photoLocalPaths, path))
    if (needsCopy) {
      this._photoLoadingRequest = requestToken
      if (typeof wx.showLoading === 'function') wx.showLoading({ title: '准备原图…', mask: false })
    }

    const localPaths = new Array(urls.length)
    let remaining = urls.length
    let failed = false
    urls.forEach((sourcePath, index) => {
      this.ensureLocalPhoto(sourcePath, (error, localPath) => {
        if (failed) return
        if (error) {
          failed = true
          if (!this.isCurrentPhotoRequest(contextToken, requestToken)) return
          this.hidePhotoLoading(requestToken)
          wx.showToast({ title: '照片暂不可查看，请重试', icon: 'none' })
          return
        }
        localPaths[index] = localPath
        remaining -= 1
        if (remaining !== 0 || !this.isCurrentPhotoRequest(contextToken, requestToken)) return
        this.hidePhotoLoading(requestToken)
        const localCurrent = localPaths[urls.indexOf(current)]
        try {
          wx.previewImage({
            current: localCurrent,
            urls: localPaths,
            fail: () => {
              if (this.isCurrentPhotoRequest(contextToken, requestToken)) {
                wx.showToast({ title: '照片暂不可查看，请重试', icon: 'none' })
              }
            },
          })
        } catch (previewError) {
          if (this.isCurrentPhotoRequest(contextToken, requestToken)) {
            wx.showToast({ title: '照片暂不可查看，请重试', icon: 'none' })
          }
        }
      })
    })
  },

  previewDirectoryPhoto(event) {
    const current = String(event.currentTarget.dataset.path || '')
    const urls = this.data.directoryItems.map((item) => item.photoPath).filter(Boolean)
    if (!current || !urls.includes(current)) return
    this.previewLocalPhotos(current, [current])
  },

  selectManualTransport(event) {
    const index = Number(event.currentTarget.dataset.index)
    const manual = this.data.manual
    if (!manual || !Number.isInteger(index) || !manual.transports[index]) return
    const transport = manual.transports[index]
    if (this.data.manualTransport && this.data.manualTransport.id === transport.id) return
    this.rememberCurrentView()
    this.invalidateCopyContext()
    const reading = viewerState.getReading(this._viewerState, this.data.currentDeviceRef, transport.id, catalog)
    const allManualWriteCommands = transport.commands.filter((command) => command.category === 'write')
    const quickCommandCount = manual.quickCommandCount || 4
    const manualWriteCommands = allManualWriteCommands.slice(quickCommandCount)
    const loopCount = manual.loopCount || 40
    const loopIndex = Math.max(0, Math.min(loopCount - 1, this.data.selectedLoopIndex || 0))
    reading.loopIndex = loopIndex
    this._currentScrollTop = reading.scrollTop
    this.setData({
      manualTransport: transport,
      manualTransportIndex: index,
      commonManualCommands: decorateManualCommands(allManualWriteCommands.slice(0, quickCommandCount), transport, this.data.deviceMacInput),
      manualWriteCommands: decorateManualCommands(manualWriteCommands, transport, this.data.deviceMacInput),
      selectedLoopIndex: loopIndex,
      selectedLoopLabel: `第${loopIndex + 1}路`,
      showManualWrites: reading.showManualWrites,
      selectedLoopCommands: decorateManualCommands(this.getLoopCommands(manualWriteCommands, loopIndex + 1, manual), transport, this.data.deviceMacInput),
      readerScrollTop: reading.scrollTop,
    })
    vibrate('light')
    this._viewerState = viewerState.updateDevice(this._viewerState, this.data.currentDeviceRef, transport.id, reading, catalog)
    viewerState.saveViewerState(this._viewerState, catalog)
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
    const changed = index !== this.data.selectedLoopIndex
    const selectedLoopCommands = decorateManualCommands(
      this.getLoopCommands(this.data.manualWriteCommands, index + 1, this.data.manual),
      this.data.manualTransport,
      this.data.deviceMacInput,
    )
    this.setData({ selectedLoopIndex: index, selectedLoopLabel: `第${index + 1}路`, selectedLoopCommands })
    if (changed) vibrate('light')
    this.rememberCurrentView()
    viewerState.saveViewerState(this._viewerState, catalog)
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
    const showManualWrites = !this.data.showManualWrites
    this.setData({ showManualWrites })
    vibrate('light')
    this.rememberCurrentView()
    viewerState.saveViewerState(this._viewerState, catalog)
  },

  showCopyFeedback(message, contextToken) {
    if (this._pageUnloaded || contextToken !== this._copyContextToken) return
    if (this._copyFeedbackActive && this._copyFeedbackMessage === message) return
    this._copyFeedbackActive = true
    this._copyFeedbackMessage = message
    wx.showToast({ title: message, icon: 'none', duration: 1200 })
    if (this._copyFeedbackTimer) clearTimeout(this._copyFeedbackTimer)
    this._copyFeedbackTimer = setTimeout(() => {
      this._copyFeedbackTimer = null
      this._copyFeedbackActive = false
      this._copyFeedbackMessage = ''
    }, 1250)
  },

  invalidateCopyContext() {
    this._copyContextToken += 1
    this._copyInFlight = 0
    if (this._copyFeedbackTimer) clearTimeout(this._copyFeedbackTimer)
    this._copyFeedbackTimer = null
    this._copyFeedbackActive = false
    this._copyFeedbackMessage = ''
  },

  copyToClipboard(text) {
    if (!text || this._copyInFlight || typeof wx.setClipboardData !== 'function') return
    const attempt = ++this._copyAttempt
    const contextToken = this._copyContextToken
    this._copyInFlight = attempt
    const settle = (succeeded) => {
      const isCurrentAttempt = this._copyInFlight === attempt && contextToken === this._copyContextToken
      if (this._copyInFlight === attempt) this._copyInFlight = 0
      if (!isCurrentAttempt || this._pageUnloaded) return
      if (succeeded && !this._pageHidden) vibrate('medium')
      this.showCopyFeedback(succeeded ? '已复制到剪贴板' : '复制失败，请重试', contextToken)
    }
    try {
      wx.setClipboardData({
        data: text,
        success: () => settle(true),
        fail: () => settle(false),
      })
    } catch (error) {
      settle(false)
    }
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
    this.copyToClipboard(frame)
  },

  copyProtocolCommand(event) {
    const commandId = String(event.currentTarget.dataset.commandId || '')
    const command = this.data.protocol && this.data.protocol.commands.find((item) => item.id === commandId)
    if (!command || !command.value) return
    this.copyToClipboard(command.value)
  },

  previewPhoto(event) {
    const current = String(event.currentTarget.dataset.path || '')
    const urls = (this.data.photos || []).map((photo) => photo.path).filter(Boolean)
    if (!current || !urls.includes(current)) return
    this.previewLocalPhotos(current, urls)
  },
})

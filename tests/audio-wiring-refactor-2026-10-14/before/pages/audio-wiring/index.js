const {
  OUTPUT_OPTIONS,
  INPUT_OPTIONS,
  getWiringModel,
  buildWiringText,
} = require('./wiring-model')
const {
  drawWiringDiagram,
  getDiagramHeight,
  getWiringHitAreas,
  drawWiringReport,
  getReportHeight,
} = require('./wiring-renderer')
const { vibrate } = require('../../utils/haptics')
const {
  syncPageFavorite,
} = require('../../utils/result-record-actions')
const wiringProject = require('./wiring-project')
const {
  getLoadedScreenPhotos,
  loadScreenSolderPhotos,
  loadReportSolderPhotos,
} = require('./wiring-photos')
const {
  previewGeneratedImage,
  saveGeneratedImage,
  shareGeneratedImage,
} = require('../../utils/report-image-actions')

const DEFAULT_OUTPUT_ID = 'xlrBalanced'
const DEFAULT_INPUT_ID = 'terminalBalanced'
const WIRING_PREFERENCE_STORAGE_KEY = 'audioWiringPreferencesV1'
const WIRING_PREFERENCE_VERSION = 1
const EXPORT_CANVAS_ID = 'resultReportCanvas'
const EXPORT_WIDTH = 720

function createWiringLifecycle() {
  let revision = 0
  let visible = false
  let disposed = false

  return {
    begin() {
      revision += 1
      return revision
    },
    invalidate() {
      revision += 1
      return revision
    },
    setVisible(nextVisible) {
      visible = Boolean(nextVisible)
      revision += 1
      return revision
    },
    dispose() {
      disposed = true
      visible = false
      revision += 1
      return revision
    },
    isCurrent(token) {
      return !disposed && visible && token === revision
    },
    currentToken() {
      return revision
    },
  }
}

function commitIfWiringTaskCurrent(page, token, commit) {
  if (!page || !page._wiringLifecycle || !page._wiringLifecycle.isCurrent(token)) return false
  commit()
  return true
}

function getWindowWidth() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    if (info && Number(info.windowWidth) > 0) return Number(info.windowWidth)
  } catch (error) {}
  return 375
}

function rectOf(value) {
  if (!value?.rect || typeof value.rect !== 'object') return value
  return {
    ...value.rect,
    width: value.rect.width ?? value.width,
    height: value.rect.height ?? value.height,
  }
}

function styleNumber(value, name, fallback) {
  const style = value?.computedStyle || value || {}
  const number = Number.parseFloat(style[name])
  return Number.isFinite(number) ? number : fallback
}

function getPixelRatio() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const ratio = Number(info && info.pixelRatio)
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  } catch (error) {
    return 1
  }
}

function createScreenRendererContext(context) {
  if (!context) throw new Error('2D canvas context is unavailable')
  const adapter = {
    beginPath: (...args) => context.beginPath(...args),
    moveTo: (...args) => context.moveTo(...args),
    lineTo: (...args) => context.lineTo(...args),
    quadraticCurveTo: (...args) => context.quadraticCurveTo(...args),
    bezierCurveTo: (...args) => context.bezierCurveTo(...args),
    closePath: (...args) => context.closePath(...args),
    fill: (...args) => context.fill(...args),
    stroke: (...args) => context.stroke(...args),
    arc: (...args) => context.arc(...args),
    drawImage: (...args) => context.drawImage(...args),
    fillRect: (...args) => context.fillRect(...args),
    setFillStyle(value) { context.fillStyle = value },
    setStrokeStyle(value) { context.strokeStyle = value },
    setLineWidth(value) { context.lineWidth = value },
    setLineCap(value) { context.lineCap = value },
    setFontSize(value) { context.font = `${value}px sans-serif` },
    setTextAlign(value) { context.textAlign = value },
    setTextBaseline(value) { context.textBaseline = value },
    fillText: (...args) => context.fillText(...args),
  }
  Object.defineProperty(adapter, 'font', {
    get: () => context.font,
    set: (value) => { context.font = value },
  })
  return adapter
}

function distanceToPolyline(x, y, points) {
  let minimum = Infinity
  for (let index = 1; index < (points || []).length; index += 1) {
    const [x1, y1] = points[index - 1]
    const [x2, y2] = points[index]
    const dx = x2 - x1, dy = y2 - y1
    const lengthSquared = (dx * dx) + (dy * dy)
    const ratio = lengthSquared ? Math.max(0, Math.min(1, (((x - x1) * dx) + ((y - y1) * dy)) / lengthSquared)) : 0
    const distanceX = x - (x1 + (ratio * dx)), distanceY = y - (y1 + (ratio * dy))
    minimum = Math.min(minimum, (distanceX * distanceX) + (distanceY * distanceY))
  }
  return Math.sqrt(minimum)
}

function getCurrentTheme() {
  try {
    const info = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : wx.getSystemInfoSync()
    return info && info.theme === 'dark' ? 'dark' : 'light'
  } catch (error) {
    return 'light'
  }
}

function getCanvasWidth(windowWidth) {
  const rpxToPx = windowWidth / 750
  return Math.max(220, Math.round(windowWidth - 2 * 32 * rpxToPx - 2 * 24 * rpxToPx))
}

function makeUnsupportedEventModel(model, reason) {
  return {
    ...(model || {}),
    status: 'unsupported',
    supported: false,
    reason,
    connections: [],
    requirements: [],
    selectionSummary: [],
    criticalNotes: [],
  }
}

function getSafeWiringModel(outputId, inputId, selections, fallbackModel) {
  if (typeof outputId !== 'string' || !outputId || typeof inputId !== 'string' || !inputId) return null
  let model
  try {
    model = getWiringModel(outputId, inputId, selections)
  } catch (error) {
    return makeUnsupportedEventModel(fallbackModel, '无法识别当前接口组合，请重新选择接口。')
  }
  const status = model && ['ready', 'needs-choice', 'unsupported'].includes(model.status)
    ? model.status
    : model && model.supported ? 'ready' : 'unsupported'
  if (!model || !Array.isArray(model.connections) || (status === 'ready' && !model.connections.length)) {
    return makeUnsupportedEventModel(fallbackModel, '无法识别当前接口组合，请重新选择接口。')
  }
  const supported = status === 'ready' && model.supported === true
  return {
    ...model,
    status: supported ? 'ready' : status === 'needs-choice' ? 'needs-choice' : 'unsupported',
    supported,
    connections: supported ? model.connections : [],
    requirements: Array.isArray(model.requirements) ? model.requirements : [],
    selectionSummary: Array.isArray(model.selectionSummary) ? model.selectionSummary : [],
    criticalNotes: Array.isArray(model.criticalNotes) ? model.criticalNotes : [],
  }
}

function simplifySignalLabel(signalLabel) {
  const value = String(signalLabel || '')
  if (/立体声|L\/R/.test(value)) return '立体声非平衡'
  if (/非平衡单声道/.test(value)) return '非平衡单声道'
  if (/平衡单声道/.test(value)) return '平衡单声道'
  return value
}

function splitSignalLabel(signalLabel) {
  const parts = String(signalLabel || '').split(' · ')
  return {
    port: parts[0] || '',
    type: parts.slice(1).join(' · '),
  }
}

function getModelDisplayInfo(model) {
  const outputSignal = splitSignalLabel(model && model.output && model.output.signalLabel)
  const inputSignal = splitSignalLabel(model && model.input && model.input.signalLabel)
  return {
    requirements: Array.isArray(model && model.requirements) ? model.requirements : [],
    selectionSummary: Array.isArray(model && model.selectionSummary) ? model.selectionSummary : [],
    criticalNotes: Array.isArray(model && model.criticalNotes) ? model.criticalNotes : [],
    outputSignalPortLabel: outputSignal.port,
    outputSignalTypeLabel: outputSignal.type,
    inputSignalPortLabel: inputSignal.port,
    inputSignalTypeLabel: inputSignal.type,
    wiringStatus: model && model.status || (model && model.supported ? 'ready' : 'unsupported'),
    outputSignalSummary: simplifySignalLabel(model && model.output && model.output.signalLabel),
    inputSignalSummary: simplifySignalLabel(model && model.input && model.input.signalLabel),
  }
}

function getSafeDiagramHeight(width, model, options, fallback) {
  if (!model || !model.supported) return fallback
  try {
    return getDiagramHeight(width, model, { ...options, avoidRail: true })
  } catch (error) {
    return fallback
  }
}

function getSafeReportHeight(width, model, fallback, options = {}) {
  if (!model || !model.supported) return fallback
  try {
    return getReportHeight(width, model, options)
  } catch (error) {
    return fallback
  }
}

function getReportOptions(data = {}) {
  const manualSelected = data.manualSelected || {}
  const preferenceNotice = data.showRestoredHint
    ? '已恢复上次接口，请按本次设备核对；接线条件需重新确认。'
    : !manualSelected.output && !manualSelected.input
      ? '默认示例，先核对实际两端接口。'
      : !manualSelected.output || !manualSelected.input
        ? '仍有接口为默认示例，请核对实际两端接口。'
        : ''
  return {
    layout: 'solder-wiring',
    compact: true,
    viewMode: 'connectors',
    face: 'solder',
    selectedId: typeof data.selectedId === 'string' ? data.selectedId : '',
    theme: data.theme === 'dark' ? 'dark' : 'light',
    preferenceNotice,
  }
}

function getDefaultWiringPreferences() {
  return {
    outputId: DEFAULT_OUTPUT_ID,
    inputId: DEFAULT_INPUT_ID,
    manualSelected: { output: false, input: false },
    viewMode: 'connectors',
    face: 'solder',
  }
}

function isValidEndpointPreference(id, options, manualSelected) {
  if (typeof id !== 'string') return false
  if (id === '') return manualSelected === false
  return options.some((option) => option.id === id)
}

function isValidWiringPreferences(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && value.version === WIRING_PREFERENCE_VERSION
    && value.manualSelected && typeof value.manualSelected === 'object'
    && typeof value.manualSelected.output === 'boolean'
    && typeof value.manualSelected.input === 'boolean'
    && isValidEndpointPreference(value.outputId, OUTPUT_OPTIONS, value.manualSelected.output)
    && isValidEndpointPreference(value.inputId, INPUT_OPTIONS, value.manualSelected.input)
    && ['wiring', 'connectors'].includes(value.viewMode)
    && ['mating', 'solder'].includes(value.face))
}

function serializeWiringPreferences(data = {}) {
  return {
    version: WIRING_PREFERENCE_VERSION,
    outputId: data.outputId,
    inputId: data.inputId,
    manualSelected: {
      output: Boolean(data.manualSelected && data.manualSelected.output),
      input: Boolean(data.manualSelected && data.manualSelected.input),
    },
    viewMode: data.viewMode === 'connectors' ? 'connectors' : 'wiring',
    face: data.face === 'solder' ? 'solder' : 'mating',
  }
}

function getCanonicalWiringSelections(model, selections = {}) {
  const canonical = {}
  const requirements = Array.isArray(model && model.requirements) ? model.requirements : []
  requirements.forEach((requirement) => {
    const value = selections && selections[requirement.id]
    if (typeof value === 'string' && requirement.value === value
      && Array.isArray(requirement.options) && requirement.options.some((option) => option.id === value)) {
      canonical[requirement.id] = value
    }
  })
  return canonical
}

function serializeWiringRecordPreferences(data = {}) {
  return {
    ...serializeWiringPreferences(data),
    viewMode: 'connectors',
    face: 'solder',
    selections: getCanonicalWiringSelections(data.model, data.selections),
  }
}

function getWiringRecordNotice(data = {}) {
  const manualSelected = data.manualSelected || {}
  if (!manualSelected.output && !manualSelected.input) return '默认示例，先核对实际两端接口。'
  if (!manualSelected.output || !manualSelected.input) return '仍有接口为默认示例，请核对实际两端接口。'
  return ''
}

function isReadyWiringResult(page) {
  const model = page && page.data && page.data.model
  return Boolean(page && page.data && page.data.supported && model
    && model.status === 'ready' && model.supported === true
    && Array.isArray(model.connections) && model.connections.length)
}

function getEndpointOption(options, id) {
  return options.find((option) => option.id === id) || {}
}

Page({
  data: {
    outputOptions: OUTPUT_OPTIONS,
    inputOptions: INPUT_OPTIONS,
    outputId: DEFAULT_OUTPUT_ID,
    inputId: DEFAULT_INPUT_ID,
    manualSelected: { output: false, input: false },
    showRestoredHint: false,
    wiringStorageWarning: '',
    selections: {},
    model: null,
    wiringStatus: 'unsupported',
    supported: false,
    diagramError: '',
    requirements: [],
    selectionSummary: [],
    criticalNotes: [],
    selectedConnection: null,
    viewMode: 'wiring',
    face: 'mating',
    selectedId: '',
    theme: 'light',
    currentFavorite: false,
    selectorVisible: false,
    selectorSide: 'output',
    selectorTitle: '',
    selectorOptions: [],
    selectorHelpVisible: false,
    diagramCanvasWidth: 320,
    diagramCanvasHeight: 340,
    resultReportCanvasWidth: EXPORT_WIDTH,
    resultReportCanvasHeight: 960,
    resultReportImagePath: '',
    resultReportPreviewVisible: false,
    resultReportPreviewStyle: '',
    isGeneratingResultReport: false,
    ...wiringProject.initialData,
  },

  onLoad() {
    this._wiringLifecycle = createWiringLifecycle()
    this._pageVisible = false
    this._pageReady = false
    this._pageUnloaded = false
    this._diagramRequestRevision = 0
    this._reportPending = false
    this._reportLoading = false
    this._themeChangeHandler = ({ theme } = {}) => {
      const nextTheme = theme === 'dark' ? 'dark' : 'light'
      if (nextTheme === this.data.theme || this._pageUnloaded) return
      this.invalidateWiringGeneration()
      this.invalidateDiagramRender()
      this.setData({ theme: nextTheme, diagramError: '' }, () => this.renderDiagram())
    }
    if (typeof wx.onThemeChange === 'function') wx.onThemeChange(this._themeChangeHandler)

    const windowWidth = getWindowWidth()
    const diagramCanvasWidth = getCanvasWidth(windowWidth)
    let preferences = getDefaultWiringPreferences()
    let showRestoredHint = false
    let wiringStorageWarning = ''
    this._wiringStorageAvailable = typeof wx.getStorageSync === 'function'
      && typeof wx.setStorageSync === 'function'
    this._restoredReviewSides = { output: false, input: false }
    this._restoredWiringPreferences = false
    if (!this._wiringStorageAvailable) {
      wiringStorageWarning = '当前环境无法记住接口和视角；本次设置仍可使用。'
    } else {
      try {
        const stored = wx.getStorageSync(WIRING_PREFERENCE_STORAGE_KEY)
        if (stored !== undefined && stored !== null && stored !== '') {
          if (isValidWiringPreferences(stored)) {
            preferences = {
              outputId: stored.outputId,
              inputId: stored.inputId,
              manualSelected: { ...stored.manualSelected },
              viewMode: stored.viewMode,
              face: stored.face,
            }
            this._restoredWiringPreferences = true
            showRestoredHint = Boolean(stored.outputId || stored.inputId)
          } else {
            wiringStorageWarning = '上次保存的设置无法识别，已恢复默认示例；本次仍可使用。'
          }
        }
      } catch (error) {
        wiringStorageWarning = '读取上次设置失败；本次仍可使用，但设置可能无法记住。'
      }
    }
    const outputId = preferences.outputId
    const inputId = preferences.inputId
    const model = getSafeWiringModel(outputId, inputId, {}, null)
    const theme = getCurrentTheme()
    const reportOptions = getReportOptions({ ...preferences, showRestoredHint, theme })
    this.setData({
      outputId,
      inputId,
      outputEndpoint: getEndpointOption(OUTPUT_OPTIONS, outputId),
      inputEndpoint: getEndpointOption(INPUT_OPTIONS, inputId),
      manualSelected: preferences.manualSelected,
      showRestoredHint,
      wiringStorageWarning,
      model,
      supported: Boolean(model && model.status === 'ready' && model.supported),
      wiringStatus: model ? model.status : 'incomplete',
      ...getModelDisplayInfo(model),
      outputOptions: OUTPUT_OPTIONS,
      inputOptions: INPUT_OPTIONS,
      viewMode: 'connectors',
      face: 'solder',
      hasBothEndpoints: Boolean(outputId && inputId),
      theme,
      diagramCanvasWidth,
      diagramCanvasHeight: getSafeDiagramHeight(diagramCanvasWidth, model, { ...reportOptions, showTitle: false }, 340),
      resultReportCanvasHeight: getSafeReportHeight(EXPORT_WIDTH, model, 960, reportOptions),
    })
  },

  onReady() {
    this._pageReady = true
    if (this._isWiringVisible) this.renderDiagram()
  },

  onShow() {
    this._pageVisible = true
    this._isWiringVisible = true
    this._wiringLifecycle.setVisible(true)
    syncPageFavorite(this)
    if (this.data.resultReportPreviewVisible) this.updateResultReportPreviewLayout()
    if (this._pageReady) this.renderDiagram()
  },

  onResize() {
    if (this.data.resultReportPreviewVisible) this.updateResultReportPreviewLayout()
    else this.renderDiagram()
  },

  onHide() {
    this._pageVisible = false
    this._isWiringVisible = false
    this._wiringLifecycle.setVisible(false)
    this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
    if (this.data.resultReportPreviewStyle) this.setData({ resultReportPreviewStyle: '' })
    this.invalidateProjectSave()
    this.closeProjectDialog(true)
    this.invalidateDiagramRender()
    this._reportPending = false
    this.clearWiringGenerationState(false)
  },

  onUnload() {
    this._pageVisible = false
    this._pageUnloaded = true
    this._isWiringVisible = false
    this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
    this.invalidateDiagramRender()
    this.invalidateProjectSave()
    this.closeProjectDialog(true)
    this._reportPending = false
    this._wiringLifecycle.dispose()
    this.clearWiringGenerationState(true, false)
    if (this._themeChangeHandler && typeof wx.offThemeChange === 'function') {
      wx.offThemeChange(this._themeChangeHandler)
    }
  },

  clearWiringGenerationState(clearImage = true, updatePage = true) {
    if (this._reportLoading && typeof wx.hideLoading === 'function') wx.hideLoading()
    this._reportLoading = false
    this._reportPending = false
    if (updatePage && !this._pageUnloaded) {
      const changes = {}
      if (this.data.isGeneratingResultReport) changes.isGeneratingResultReport = false
      if (clearImage && this.data.resultReportImagePath) changes.resultReportImagePath = ''
      if (clearImage && this.data.resultReportPreviewVisible) changes.resultReportPreviewVisible = false
      if (clearImage && this.data.resultReportPreviewStyle) changes.resultReportPreviewStyle = ''
      if (clearImage) this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      if (Object.keys(changes).length) this.setData(changes)
    }
  },

  cancelPendingWiringGeneration() {
    if (this._wiringLifecycle) this._wiringLifecycle.invalidate()
    if (this._reportLoading && typeof wx.hideLoading === 'function') wx.hideLoading()
    this._reportLoading = false
    this._reportPending = false
    const changes = {}
    if (this.data.isGeneratingResultReport) changes.isGeneratingResultReport = false
    if (this.data.resultReportPreviewVisible) changes.resultReportPreviewVisible = false
    if (this.data.resultReportPreviewStyle) changes.resultReportPreviewStyle = ''
    this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
    if (Object.keys(changes).length) this.setData(changes)
  },

  invalidateWiringGeneration() {
    if (this._wiringLifecycle) this._wiringLifecycle.invalidate()
    this.clearWiringGenerationState()
  },

  invalidateProjectSave() {
    this._projectSaveRequestId = (this._projectSaveRequestId || 0) + 1
    this._projectSavePending = false
  },

  persistWiringPreferences(source = this.data) {
    if (!this._wiringStorageAvailable || typeof wx.setStorageSync !== 'function') {
      this.setData({ wiringStorageWarning: '无法保存设置，请检查本地存储后重试。' })
      return false
    }
    try {
      wx.setStorageSync(WIRING_PREFERENCE_STORAGE_KEY, serializeWiringPreferences(source))
      return true
    } catch (error) {
      this.setData({ wiringStorageWarning: '保存失败；请检查本地存储后重试。' })
      return false
    }
  },

  markEndpointManuallySelected(side) {
    const manualSelected = { ...this.data.manualSelected, [side]: true }
    const changes = { manualSelected }
    if (this._restoredWiringPreferences) {
      this._restoredReviewSides[side] = true
      if (this._restoredReviewSides.output && this._restoredReviewSides.input) {
        this._restoredWiringPreferences = false
        changes.showRestoredHint = false
      }
    }
    return changes
  },

  getRecordLookupPayload() {
    return wiringProject.getCompatiblePayload(this.getRecordPayload())
  },

  getRecordPayload() {
    if (!isReadyWiringResult(this)) return null
    const model = this.data.model
    let wiringText
    try {
      wiringText = buildWiringText(model)
    } catch (error) {
      return null
    }
    const notice = getWiringRecordNotice(this.data)
    return {
      module: 'audioWiring',
      title: `接线参考 · ${model.output.label} → ${model.input.label}`,
      summary: `${model.connections.length} 条连接${model.selectionSummary.length ? ` · ${model.selectionSummary.join('；')}` : ''}`,
      preferences: serializeWiringRecordPreferences(this.data),
      resultText: [
        '结果性质：接线参考',
        ...(notice ? [notice] : []),
        wiringText,
        '施工前请按具体设备型号说明书核对端口用途、端子标识和接线要求。',
      ].join('\n\n'),
    }
  },

  resetWiring() {
    const preferences = {
      outputId: '',
      inputId: '',
      manualSelected: { output: false, input: false },
      viewMode: 'connectors',
      face: 'solder',
    }
    if (!this._wiringStorageAvailable || typeof wx.setStorageSync !== 'function') {
      wx.showToast({ title: '重置未保存，请检查存储后重试', icon: 'none' })
      return false
    }
    if (!this.persistWiringPreferences({ ...this.data, ...preferences })) {
      wx.showToast({ title: '重置未保存，请检查存储后重试', icon: 'none' })
      return false
    }
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    this.invalidateProjectSave()
    this.closeProjectDialog(true)
    this._restoredWiringPreferences = false
    this._restoredReviewSides = { output: false, input: false }
    const model = null
    const reportOptions = getReportOptions({ ...preferences, theme: this.data.theme })
    vibrate('light')
    this.setData({
      ...preferences,
      model,
      outputEndpoint: {},
      inputEndpoint: {},
      ...getModelDisplayInfo(model),
      supported: false,
      hasBothEndpoints: false,
      wiringStatus: 'incomplete',
      showRestoredHint: false,
      selections: {},
      selectedId: '',
      selectedConnection: null,
      diagramError: '',
      selectorVisible: false,
      selectorHelpVisible: false,
      resultReportImagePath: '',
      resultReportPreviewVisible: false,
      resultReportPreviewStyle: '',
      isGeneratingResultReport: false,
      diagramCanvasHeight: 340,
      resultReportCanvasHeight: 960,
    }, () => {
      this.setData({ wiringStorageWarning: '' })
      syncPageFavorite(this)
      this.renderDiagram()
    })
    return true
  },

  toggleCurrentFavorite() {
    return wiringProject.toggleCurrentFavorite.call(this)
  },

  saveToActiveProject() {
    return this.openWiringProjectSheet()
  },

  finishWiringGeneration(token, changes = {}) {
    commitIfWiringTaskCurrent(this, token, () => {
      if (this._reportLoading && typeof wx.hideLoading === 'function') wx.hideLoading()
      this._reportLoading = false
      this._reportPending = false
      if (changes.resultReportPreviewVisible) {
        this.invalidateDiagramRender()
        this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      }
      this.setData({ isGeneratingResultReport: false, ...changes }, () => {
        if (changes.resultReportPreviewVisible) this.updateResultReportPreviewLayout()
      })
    })
  },

  renderDiagram() {
    if (!this._pageReady || !this._isWiringVisible || this._pageUnloaded || !this.data.model || !this.data.model.supported
      || this.data.selectorVisible || this.data.resultReportPreviewVisible || this.data.projectDialogVisible) {
      this._diagramNeedsRender = true
      return
    }
    this._diagramRequestRevision += 1
    this._diagramNeedsRender = true
    this.drawLatestDiagram(this._diagramRequestRevision)
  },

  invalidateDiagramRender() {
    this._diagramRequestRevision += 1
    this._diagramNeedsRender = true
    this._diagramTouchStart = null
  },

  drawLatestDiagram(requestRevision) {
    if (requestRevision !== this._diagramRequestRevision || !this._diagramNeedsRender
      || !this._isWiringVisible || this._pageUnloaded || !this.data.supported
      || this.data.selectorVisible || this.data.resultReportPreviewVisible || this.data.projectDialogVisible) return
    const model = this.data.model
    const options = {
      layout: 'solder-wiring',
      avoidRail: true,
      selectedId: this.data.selectedId,
      theme: this.data.theme,
      showTitle: false,
    }
    this._diagramNeedsRender = false
    try {
      wx.createSelectorQuery().in(this).select('#wiringDiagramCanvas').fields({ node: true, size: true }).exec((results) => {
        if (requestRevision !== this._diagramRequestRevision || !this._isWiringVisible || this._pageUnloaded
          || this.data.selectorVisible || this.data.resultReportPreviewVisible || this.data.projectDialogVisible || !this.data.supported) return
        const measured = Array.isArray(results) && results[0]
        const canvas = measured && measured.node
        const width = Number(measured && measured.width)
        if (!canvas || typeof canvas.getContext !== 'function' || !Number.isFinite(width) || width <= 0) {
          this.setData({ diagramError: '接线图暂时无法显示' })
          return
        }
        const height = getSafeDiagramHeight(width, model, options, this.data.diagramCanvasHeight)
        if (Math.abs(width - this.data.diagramCanvasWidth) > 0.5 || height !== this.data.diagramCanvasHeight) {
          this.setData({ diagramCanvasWidth: width, diagramCanvasHeight: height }, () => {
            if (requestRevision === this._diagramRequestRevision && this._isWiringVisible && !this._pageUnloaded
              && !this.data.selectorVisible && !this.data.resultReportPreviewVisible && !this.data.projectDialogVisible && this.data.supported) {
              this._diagramNeedsRender = true
              this.drawLatestDiagram(requestRevision)
            }
          })
          return
        }
        try {
          const pixelRatio = getPixelRatio()
          const context = canvas.getContext('2d')
          if (!context || typeof context.setTransform !== 'function') throw new Error('2D canvas context is unavailable')
          canvas.width = Math.round(width * pixelRatio)
          canvas.height = Math.round(height * pixelRatio)
          context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
          const rendererContext = createScreenRendererContext(context)
          const isCurrent = () => requestRevision === this._diagramRequestRevision && this._isWiringVisible
            && !this._pageUnloaded && !this.data.selectorVisible && !this.data.resultReportPreviewVisible
            && !this.data.projectDialogVisible && this.data.supported && this.data.model === model
          const draw = (photos) => {
            drawWiringDiagram(rendererContext, model, width, height, { ...options, photos })
            if (this.data.diagramError) this.setData({ diagramError: '' })
          }
          const cachedPhotos = getLoadedScreenPhotos(canvas, model)
          if (cachedPhotos) draw(cachedPhotos)
          else {
            const pendingPhotos = loadScreenSolderPhotos(canvas, model)
            const immediatelyLoadedPhotos = getLoadedScreenPhotos(canvas, model)
            if (immediatelyLoadedPhotos) draw(immediatelyLoadedPhotos)
            else pendingPhotos.then((photos) => {
              if (isCurrent()) draw(photos || {})
            }).catch(() => {
              if (isCurrent()) this.setData({ diagramError: '接头照片加载失败' })
            })
          }
        } catch (error) {
          if (requestRevision === this._diagramRequestRevision) this.setData({ diagramError: '接线图暂时无法显示' })
        }
      })
    } catch (error) {
      if (requestRevision === this._diagramRequestRevision) this.setData({ diagramError: '接线图暂时无法显示' })
    }
  },

  onDiagramTouchStart(event) {
    if (!this.isWiringPageInteractive()) {
      this._diagramTouchStart = null
      return
    }
    const touch = event && event.touches && event.touches[0]
    this._diagramTouchStart = touch && Number.isFinite(Number(touch.x)) && Number.isFinite(Number(touch.y))
      ? { x: Number(touch.x), y: Number(touch.y) }
      : null
  },

  onDiagramTouchEnd(event) {
    const touch = event && event.changedTouches && event.changedTouches[0]
    const start = this._diagramTouchStart
    this._diagramTouchStart = null
    if (!this.isWiringPageInteractive()) return
    if (!touch || !start) return
    const x = Number(touch.x)
    const y = Number(touch.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const dx = x - start.x
    const dy = y - start.y
    if ((dx * dx + dy * dy) > 324) return
    this.onDiagramTap({ detail: { x, y } })
  },

  onDiagramTouchCancel() {
    this._diagramTouchStart = null
  },

  isWiringPageInteractive() {
    return Boolean(this._pageReady && this._isWiringVisible && !this._pageUnloaded
      && !this.data.selectorVisible && !this.data.resultReportPreviewVisible && !this.data.projectDialogVisible && !this.data.diagramError)
  },

  retryDiagram() {
    if (!this.data.supported) return
    this.setData({ diagramError: '' }, () => this.renderDiagram())
  },

  openEndpointSelector(event) {
    const side = event && event.currentTarget && event.currentTarget.dataset.side === 'input' ? 'input' : 'output'
    const options = side === 'input' ? this.data.inputOptions : this.data.outputOptions
    this.cancelPendingWiringGeneration()
    this.invalidateDiagramRender()
    this.setData({
      selectorVisible: true,
      selectorHelpVisible: false,
      selectorSide: side,
      selectorTitle: side === 'input' ? '选择输入端' : '选择输出端',
      selectorOptions: options,
    })
  },

  closeEndpointSelector() {
    this.setData({ selectorVisible: false, selectorHelpVisible: false }, () => this.renderDiagram())
  },

  openEndpointHelp() {
    if (!this.data.selectorVisible) return
    this.setData({ selectorHelpVisible: true })
  },

  closeEndpointHelp() {
    this.setData({ selectorHelpVisible: false })
  },

  selectEndpointOption(event) {
    const side = this.data.selectorSide
    const id = event && event.currentTarget && event.currentTarget.dataset.id
    const options = side === 'input' ? this.data.inputOptions : this.data.outputOptions
    if (!options.some((item) => item.id === id)) {
      this.invalidateWiringGeneration()
      this.invalidateDiagramRender()
      wx.showToast({ title: '接口选项无效，请重新选择', icon: 'none' })
      this.setData({ selectorVisible: false, selectorHelpVisible: false }, () => this.renderDiagram())
      return
    }

    const outputId = side === 'output' ? id : this.data.outputId
    const inputId = side === 'input' ? id : this.data.inputId
    if (outputId === this.data.outputId && inputId === this.data.inputId) {
      const changes = this.markEndpointManuallySelected(side)
      this.invalidateProjectSave()
      const previousNotice = getReportOptions(this.data).preferenceNotice
      const reportOptions = getReportOptions({ ...this.data, ...changes })
      if (reportOptions.preferenceNotice !== previousNotice) {
        this.invalidateWiringGeneration()
        changes.resultReportCanvasHeight = getSafeReportHeight(EXPORT_WIDTH, this.data.model,
          this.data.resultReportCanvasHeight, reportOptions)
      }
      changes.selectorVisible = false
      changes.selectorHelpVisible = false
      this.setData(changes, () => {
        this.persistWiringPreferences()
        syncPageFavorite(this)
        this.renderDiagram()
      })
      return
    }
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    this.invalidateProjectSave()
    const selections = {}
    const model = getSafeWiringModel(outputId, inputId, selections, this.data.model)
    const output = this.data.outputOptions.find((item) => item.id === outputId)
    const input = this.data.inputOptions.find((item) => item.id === inputId)
    const endpointReview = this.markEndpointManuallySelected(side)
    const reportOptions = getReportOptions({ ...this.data, ...endpointReview, selectedId: '' })
    this._diagramNeedsRender = true
    this.setData({
      outputId,
      inputId,
      outputEndpoint: output || {},
      inputEndpoint: input || {},
      ...endpointReview,
      selections,
      model,
      hasBothEndpoints: Boolean(outputId && inputId),
      wiringStatus: model ? model.status : 'incomplete',
      supported: Boolean(model && model.status === 'ready' && model.supported),
      diagramError: '',
      ...getModelDisplayInfo(model),
      selectedId: '',
      selectedConnection: null,
      selectorVisible: false,
      selectorHelpVisible: false,
      diagramCanvasHeight: getSafeDiagramHeight(this.data.diagramCanvasWidth, model, {
        layout: 'solder-wiring',
        viewMode: 'connectors',
        face: 'solder',
        theme: this.data.theme,
        showTitle: false,
      }, this.data.diagramCanvasHeight),
      resultReportCanvasHeight: getSafeReportHeight(EXPORT_WIDTH, model, this.data.resultReportCanvasHeight, reportOptions),
      outputLabel: output && output.label,
      inputLabel: input && input.label,
    }, () => {
      this.persistWiringPreferences()
      syncPageFavorite(this)
      this.renderDiagram()
    })
  },

  selectWiringRequirement(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
    const requirementId = dataset.requirementId
    const optionId = dataset.optionId
    const requirement = this.data.requirements.find((item) => item.id === requirementId)
    if (!requirement || !Array.isArray(requirement.options)
      || !requirement.options.some((option) => option.id === optionId)) return
    if (requirement.value === optionId && this.data.selections[requirementId] === optionId) return

    const selections = { ...this.data.selections, [requirementId]: optionId }
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    this.invalidateProjectSave()
    const model = getSafeWiringModel(this.data.outputId, this.data.inputId, selections, this.data.model)
    const reportOptions = getReportOptions({ ...this.data, selectedId: '' })
    this._diagramNeedsRender = true
    this.setData({
      selections,
      model,
      wiringStatus: model ? model.status : 'incomplete',
      supported: Boolean(model && model.status === 'ready' && model.supported),
      ...getModelDisplayInfo(model),
      selectedId: '',
      selectedConnection: null,
      diagramError: '',
      diagramCanvasHeight: getSafeDiagramHeight(this.data.diagramCanvasWidth, model, {
        layout: 'solder-wiring',
        viewMode: 'connectors',
        face: 'solder',
        theme: this.data.theme,
        showTitle: false,
      }, this.data.diagramCanvasHeight),
      resultReportCanvasHeight: getSafeReportHeight(EXPORT_WIDTH, model, this.data.resultReportCanvasHeight, reportOptions),
    }, () => {
      syncPageFavorite(this)
      this.renderDiagram()
    })
  },

  clearWiringRequirement(event) {
    const requirementId = event && event.currentTarget && event.currentTarget.dataset
      && event.currentTarget.dataset.requirementId
    if (requirementId !== 'outputMode' || !this.data.selections.outputMode) return
    const selections = { ...this.data.selections }
    delete selections.outputMode
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    this.invalidateProjectSave()
    const model = getSafeWiringModel(this.data.outputId, this.data.inputId, selections, this.data.model)
    const reportOptions = getReportOptions({ ...this.data, selectedId: '' })
    this._diagramNeedsRender = true
    this.setData({
      selections,
      model,
      wiringStatus: model ? model.status : 'incomplete',
      supported: Boolean(model && model.status === 'ready' && model.supported),
      ...getModelDisplayInfo(model),
      selectedId: '',
      selectedConnection: null,
      diagramError: '',
      diagramCanvasHeight: getSafeDiagramHeight(this.data.diagramCanvasWidth, model, {
        layout: 'solder-wiring',
        ...reportOptions,
        showTitle: false,
      }, this.data.diagramCanvasHeight),
      resultReportCanvasHeight: getSafeReportHeight(EXPORT_WIDTH, model, this.data.resultReportCanvasHeight, reportOptions),
    }, () => {
      syncPageFavorite(this)
      this.renderDiagram()
    })
  },

  selectViewMode(event) {
    const viewMode = event && event.currentTarget && event.currentTarget.dataset.mode
    if (viewMode !== 'wiring' && viewMode !== 'connectors') return
    if (viewMode === this.data.viewMode) return
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    const changes = { viewMode, selectedId: '', selectedConnection: null, diagramError: '' }
    const reportOptions = getReportOptions({ ...this.data, ...changes })
    changes.diagramCanvasHeight = getSafeDiagramHeight(this.data.diagramCanvasWidth, this.data.model, {
      ...reportOptions,
      showTitle: false,
    }, this.data.diagramCanvasHeight)
    changes.resultReportCanvasHeight = getSafeReportHeight(EXPORT_WIDTH, this.data.model,
      this.data.resultReportCanvasHeight, reportOptions)
    this.setData(changes, () => {
      this.persistWiringPreferences()
      syncPageFavorite(this)
      this.renderDiagram()
    })
  },

  selectConnectorFace(event) {
    const face = event && event.currentTarget && event.currentTarget.dataset.face
    if ((face !== 'mating' && face !== 'solder') || face === this.data.face) return
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    const changes = { face, selectedId: '', selectedConnection: null, diagramError: '' }
    const reportOptions = getReportOptions({ ...this.data, ...changes })
    changes.diagramCanvasHeight = getSafeDiagramHeight(this.data.diagramCanvasWidth, this.data.model, {
      ...reportOptions,
      showTitle: false,
    }, this.data.diagramCanvasHeight)
    changes.resultReportCanvasHeight = getSafeReportHeight(EXPORT_WIDTH, this.data.model,
      this.data.resultReportCanvasHeight, reportOptions)
    this.setData(changes, () => {
      this.persistWiringPreferences()
      syncPageFavorite(this)
      this.renderDiagram()
    })
  },

  onDiagramTap(event) {
    if (!this.isWiringPageInteractive()) return
    const model = this.data.model
    if (!model || !model.supported || !Array.isArray(model.connections)) return
    const touch = event && event.detail
    const x = Number(touch && touch.x)
    const y = Number(touch && touch.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const options = {
      layout: 'solder-wiring',
      avoidRail: true,
      selectedId: this.data.selectedId,
      theme: this.data.theme,
      showTitle: false,
    }
    let areas = []
    try {
      areas = getWiringHitAreas(model, this.data.diagramCanvasWidth, this.data.diagramCanvasHeight, options)
    } catch (error) {
      return
    }
    let hit = null
    let closestDistance = Infinity
    for (const area of areas || []) {
      if (Array.isArray(area.pathPoints)) {
        const distance = distanceToPolyline(x, y, area.pathPoints)
        if (distance <= area.radius && distance < closestDistance) {
          hit = area
          closestDistance = distance
        }
        continue
      }
      if (Number.isFinite(Number(area.left))
        && Number.isFinite(Number(area.top))
        && Number.isFinite(Number(area.width))
        && Number.isFinite(Number(area.height))) {
        if (x >= area.left && x <= area.left + area.width
          && y >= area.top && y <= area.top + area.height) {
          hit = area
          break
        }
        continue
      }
      const dx = x - area.x
      const dy = y - area.y
      if ((dx * dx + dy * dy) <= area.radius * area.radius) {
        hit = area
        break
      }
    }
    if (!hit) return
    const connection = model.connections.find((item) => item.id === hit.id)
    if (!connection) return
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    const selectedId = this.data.selectedId === connection.id ? '' : connection.id
    this.setData({
      selectedId,
      selectedConnection: selectedId ? {
        ...connection,
        mappingText: `${connection.fromLabel} → ${connection.toLabel}`,
      } : null,
      resultReportCanvasHeight: getSafeReportHeight(EXPORT_WIDTH, model, this.data.resultReportCanvasHeight,
        getReportOptions({ ...this.data, selectedId })),
    }, () => this.renderDiagram())
  },

  copyConnection() {
    const model = this.data.model
    if (!model || !model.supported || !Array.isArray(model.connections) || !model.connections.length) {
      wx.showToast({ title: (model && model.reason) || '当前组合暂无可复制接法', icon: 'none' })
      return
    }
    let text
    try {
      text = buildWiringText(model)
      const preferenceNotice = getReportOptions(this.data).preferenceNotice
      if (preferenceNotice) text = `${preferenceNotice}\n\n${text}`
    } catch (error) {
      text = ''
    }
    if (!text || typeof wx.setClipboardData !== 'function') {
      wx.showToast({ title: '复制失败，请重试', icon: 'none' })
      return
    }
    const lifecycle = this._wiringLifecycle
    const token = lifecycle && lifecycle.currentToken()
    const isCurrent = () => !lifecycle || lifecycle.isCurrent(token)
    vibrate('medium')
    try {
      wx.setClipboardData({
        data: text,
        success: () => { if (isCurrent()) wx.showToast({ title: '接法已复制', icon: 'success' }) },
        fail: () => { if (isCurrent()) wx.showToast({ title: '复制失败，请重试', icon: 'none' }) },
      })
    } catch (error) {
      wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    }
  },

  generateResultReportImage() {
    const model = this.data.model
    if (!model || !model.supported || !Array.isArray(model.connections) || !model.connections.length) {
      wx.showToast({ title: (model && model.reason) || '当前组合暂无可生成的接线图', icon: 'none' })
      return
    }
    if (this.data.isGeneratingResultReport || this._reportPending) return
    if (this.data.resultReportImagePath) {
      vibrate('light')
      this.invalidateDiagramRender()
      this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
      this.setData({ resultReportPreviewVisible: true, resultReportPreviewStyle: '' },
        () => this.updateResultReportPreviewLayout())
      return
    }
    if (typeof wx.createCanvasContext !== 'function' || typeof wx.canvasToTempFilePath !== 'function') {
      wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
      return
    }

    vibrate('medium')
    const width = EXPORT_WIDTH
    const reportOptions = getReportOptions(this.data)
    const height = getReportHeight(width, model, reportOptions)
    const revision = this._wiringLifecycle.begin()
    this._reportPending = true
    this._reportLoading = true
    this.setData({
      resultReportCanvasWidth: width,
      resultReportCanvasHeight: height,
      isGeneratingResultReport: true,
      resultReportImagePath: '',
      resultReportPreviewVisible: false,
    }, () => {
      if (!this._wiringLifecycle.isCurrent(revision)) return
      if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })
      loadReportSolderPhotos(model, () => this._wiringLifecycle.isCurrent(revision), (error, photos) => {
        if (error) {
          commitIfWiringTaskCurrent(this, revision, () => {
            this.finishWiringGeneration(revision)
            wx.showToast({ title: '接头照片读取失败，请重试', icon: 'none' })
          })
          return
        }
        if (!photos || !this._wiringLifecycle.isCurrent(revision)) return
          try {
            const context = wx.createCanvasContext(EXPORT_CANVAS_ID, this)
            drawWiringReport(context, model, width, height, { ...reportOptions, photos })
            context.draw(false, () => {
              if (!this._wiringLifecycle.isCurrent(revision)) return
              try {
                wx.canvasToTempFilePath({
                  canvasId: EXPORT_CANVAS_ID,
                  width,
                  height,
                  destWidth: width,
                  destHeight: height,
                  fileType: 'png',
                  quality: 1,
                  success: ({ tempFilePath } = {}) => {
                    commitIfWiringTaskCurrent(this, revision, () => {
                      if (!tempFilePath) {
                        this.finishWiringGeneration(revision)
                        wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
                        return
                      }
                      this.finishWiringGeneration(revision, {
                        resultReportImagePath: tempFilePath,
                        resultReportPreviewVisible: true,
                      })
                    })
                  },
                  fail: () => commitIfWiringTaskCurrent(this, revision, () => {
                    this.finishWiringGeneration(revision)
                    wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
                  }),
                }, this)
              } catch (error) {
                commitIfWiringTaskCurrent(this, revision, () => {
                  this.finishWiringGeneration(revision)
                  wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
                })
              }
            })
          } catch (error) {
            commitIfWiringTaskCurrent(this, revision, () => {
              this.finishWiringGeneration(revision)
              wx.showToast({ title: '图片生成失败，请重试', icon: 'none' })
            })
          }
      })
    })
  },

  updateResultReportPreviewLayout() {
    const path = this.data.resultReportImagePath
    const recordSignature = JSON.stringify(this.getRecordPayload())
    const lifecycle = this._wiringLifecycle
    const lifecycleToken = lifecycle?.currentToken()
    if (!this._pageVisible || this._pageUnloaded || !this.data.resultReportPreviewVisible
      || this.data.resultReportPreviewClosing || !path || !recordSignature) return false
    const revision = (this._reportPreviewLayoutRevision || 0) + 1
    this._reportPreviewLayoutRevision = revision
    if (this.data.resultReportPreviewStyle) this.setData({ resultReportPreviewStyle: '' })
    if (typeof wx.createSelectorQuery !== 'function') return false

    const nodes = {}
    let query
    try {
      query = wx.createSelectorQuery().in(this)
      const read = (selector, styles = []) => {
        const selection = query.select(selector)
        const callback = (value) => { nodes[selector] = value }
        if (typeof selection.fields === 'function') {
          selection.fields({ rect: true, size: true, computedStyle: styles }, callback)
        } else {
          selection.boundingClientRect(callback)
        }
      }
      read('.page-root')
      read('.result-report-preview-overlay', ['paddingTop', 'paddingBottom'])
      read('.result-report-preview-sheet', ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'])
      read('.result-report-preview-header')
      read('.result-report-preview-actions')
      read('.result-report-preview-scroll', ['borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth'])
      read('.result-report-preview-image')
    } catch (error) {
      return false
    }

    const current = () => revision === this._reportPreviewLayoutRevision
      && !this._pageUnloaded && this._pageVisible && this.data.resultReportPreviewVisible
      && !this.data.resultReportPreviewClosing && this.data.resultReportImagePath === path
      && JSON.stringify(this.getRecordPayload()) === recordSignature
      && (!lifecycle || lifecycle.isCurrent(lifecycleToken))
    try {
      query.exec(() => {
        if (!current()) return
        const root = rectOf(nodes['.page-root'])
        const overlay = rectOf(nodes['.result-report-preview-overlay'])
        const sheet = rectOf(nodes['.result-report-preview-sheet'])
        const header = rectOf(nodes['.result-report-preview-header'])
        const actions = rectOf(nodes['.result-report-preview-actions'])
        const scroll = rectOf(nodes['.result-report-preview-scroll'])
        const image = rectOf(nodes['.result-report-preview-image'])
        const rootTop = Number(root?.top) || 0
        const rootHeight = Number(root?.height) || 0
        const overlayTop = Number(overlay?.top)
        const overlayHeight = Number(overlay?.height)
        const viewportTop = Math.max(rootTop, Number.isFinite(overlayTop) ? overlayTop : rootTop)
        const rootBottom = rootTop + rootHeight
        const overlayBottom = Number.isFinite(overlay?.bottom)
          ? overlay.bottom
          : (Number.isFinite(overlayHeight)
            ? (Number.isFinite(overlayTop) ? overlayTop : rootTop) + overlayHeight
            : rootBottom)
        const viewportBottom = Math.min(rootBottom || overlayBottom, overlayBottom)
        const viewportHeight = Math.max(0, viewportBottom - viewportTop)
        const scale = (Number(root?.width) || 390) / 750
        const overlayPaddingTop = styleNumber(nodes['.result-report-preview-overlay'], 'paddingTop', 32 * scale)
        const overlayPaddingBottom = styleNumber(nodes['.result-report-preview-overlay'], 'paddingBottom', 16 * scale)
        const sheetPaddingTop = styleNumber(nodes['.result-report-preview-sheet'], 'paddingTop', 20 * scale)
        const sheetPaddingBottom = styleNumber(nodes['.result-report-preview-sheet'], 'paddingBottom', 16 * scale)
        const sheetRectHeight = Number(sheet?.height) || 0
        const sheetTopGap = sheetRectHeight > 0 ? Math.max(0, Number(sheet.top) - viewportTop) : 0
        const sheetBottomGap = sheetRectHeight > 0 ? Math.max(0, viewportBottom - Number(sheet.bottom)) : 0
        const sheetSweepHeight = sheetRectHeight + sheetTopGap + sheetBottomGap
        const availableSheetHeight = Math.max(0, Math.min(viewportHeight,
          sheetSweepHeight > 0 ? sheetSweepHeight : viewportHeight)
          - overlayPaddingTop - overlayPaddingBottom)
        const sheetBorders = styleNumber(nodes['.result-report-preview-sheet'], 'borderTopWidth', 1)
          + styleNumber(nodes['.result-report-preview-sheet'], 'borderBottomWidth', 1)
        const fixedHeight = sheetPaddingTop + sheetPaddingBottom + sheetBorders
          + (Number(header?.height) || 0) + (Number(actions?.height) || 0)
        const availableScrollHeight = Math.max(0, availableSheetHeight - fixedHeight)
        const scrollBorders = styleNumber(nodes['.result-report-preview-scroll'], 'borderTopWidth', 1)
          + styleNumber(nodes['.result-report-preview-scroll'], 'borderBottomWidth', 1)
        const horizontalBorders = styleNumber(nodes['.result-report-preview-scroll'], 'borderLeftWidth', 1)
          + styleNumber(nodes['.result-report-preview-scroll'], 'borderRightWidth', 1)
        const scrollWidth = Number(scroll?.width) || Math.max(0, (Number(root?.width) || 0) - (76 * scale))
        const imageWidth = Number(image?.width) || Math.max(0, scrollWidth - horizontalBorders)
        const naturalImageHeight = (Number(this.data.resultReportCanvasHeight) || 0)
          * imageWidth / EXPORT_WIDTH
        if (!viewportHeight || !availableSheetHeight || !imageWidth || !naturalImageHeight) return
        const scrollHeight = Math.min(naturalImageHeight + scrollBorders, availableScrollHeight)
        const nextStyle = '--cable-report-sheet-max-height:' + Math.round(availableSheetHeight * 100) / 100
          + 'px;--cable-report-scroll-height:' + Math.round(scrollHeight * 100) / 100 + 'px'
        if (this.data.resultReportPreviewStyle !== nextStyle) {
          this.setData({ resultReportPreviewStyle: nextStyle })
        }
      })
    } catch (error) {
      return false
    }
    return true
  },

  closeResultReportPreview() {
    vibrate('light')
    this._reportPreviewLayoutRevision = (this._reportPreviewLayoutRevision || 0) + 1
    this.setData({ resultReportPreviewVisible: false, resultReportPreviewStyle: '' }, () => this.renderDiagram())
  },

  preventTouchMove() {},

  stopTap() {},

  previewResultReportImage() {
    previewGeneratedImage(this.data.resultReportImagePath)
  },

  shareResultReportImage() {
    shareGeneratedImage(this.data.resultReportImagePath)
  },

  saveResultReportImage() {
    saveGeneratedImage(this.data.resultReportImagePath)
  },
  ...wiringProject.methods,
})

module.exports = {
  commitIfWiringTaskCurrent,
  createWiringLifecycle,
  getSafeDiagramHeight,
  getSafeReportHeight,
}

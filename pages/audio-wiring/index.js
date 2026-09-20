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
  previewGeneratedImage,
  saveGeneratedImage,
  shareGeneratedImage,
} = require('../../utils/report-image-actions')

const DEFAULT_OUTPUT_ID = 'xlrBalanced'
const DEFAULT_INPUT_ID = 'terminalBalanced'
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

function normalizeInfoItems(items, fallbackLabel) {
  if (!Array.isArray(items)) return items ? [{ text: String(items) }] : []
  return items.map((item) => {
    if (typeof item === 'string') return { text: item }
    const text = item && (item.text || item.label || item.title || item.name || item.source)
    const detail = item && (item.claim || item.detail || item.description)
    return {
      text: text || fallbackLabel,
      detail: detail || '',
    }
  }).filter((item) => item.text)
}

function getWindowWidth() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    if (info && Number(info.windowWidth) > 0) return Number(info.windowWidth)
  } catch (error) {}
  return 375
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
    closePath: (...args) => context.closePath(...args),
    fill: (...args) => context.fill(...args),
    stroke: (...args) => context.stroke(...args),
    arc: (...args) => context.arc(...args),
    fillRect: (...args) => context.fillRect(...args),
    setFillStyle(value) { context.fillStyle = value },
    setStrokeStyle(value) { context.strokeStyle = value },
    setLineWidth(value) { context.lineWidth = value },
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

function getModelDisplayInfo(model) {
  return {
    noteItems: normalizeInfoItems(model && model.notes, '接线说明'),
    sourceItems: normalizeInfoItems(model && model.sources, '资料来源'),
    requirements: Array.isArray(model && model.requirements) ? model.requirements : [],
    selectionSummary: Array.isArray(model && model.selectionSummary) ? model.selectionSummary : [],
    criticalNotes: Array.isArray(model && model.criticalNotes) ? model.criticalNotes : [],
    wiringStatus: model && model.status || (model && model.supported ? 'ready' : 'unsupported'),
    outputSignalSummary: simplifySignalLabel(model && model.output && model.output.signalLabel),
    inputSignalSummary: simplifySignalLabel(model && model.input && model.input.signalLabel),
  }
}

function getSafeDiagramHeight(width, model, options, fallback) {
  if (!model || !model.supported) return fallback
  try {
    return getDiagramHeight(width, model, options)
  } catch (error) {
    return fallback
  }
}

function getSafeReportHeight(width, model, fallback) {
  if (!model || !model.supported) return fallback
  try {
    return getReportHeight(width, model)
  } catch (error) {
    return fallback
  }
}

Page({
  data: {
    outputOptions: OUTPUT_OPTIONS,
    inputOptions: INPUT_OPTIONS,
    outputId: DEFAULT_OUTPUT_ID,
    inputId: DEFAULT_INPUT_ID,
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
    explanationExpanded: false,
    selectorVisible: false,
    selectorSide: 'output',
    selectorTitle: '',
    selectorOptions: [],
    diagramCanvasWidth: 320,
    diagramCanvasHeight: 340,
    resultReportCanvasWidth: EXPORT_WIDTH,
    resultReportCanvasHeight: 960,
    resultReportImagePath: '',
    resultReportPreviewVisible: false,
    isGeneratingResultReport: false,
  },

  onLoad() {
    this._wiringLifecycle = createWiringLifecycle()
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
    const outputId = OUTPUT_OPTIONS.some((item) => item.id === DEFAULT_OUTPUT_ID)
      ? DEFAULT_OUTPUT_ID
      : (OUTPUT_OPTIONS[0] && OUTPUT_OPTIONS[0].id)
    const inputId = INPUT_OPTIONS.some((item) => item.id === DEFAULT_INPUT_ID)
      ? DEFAULT_INPUT_ID
      : (INPUT_OPTIONS[0] && INPUT_OPTIONS[0].id)
    const model = getSafeWiringModel(outputId, inputId, {}, null)
    const theme = getCurrentTheme()
    this.setData({
      outputId,
      inputId,
      model,
      supported: model.status === 'ready' && model.supported,
      ...getModelDisplayInfo(model),
      outputOptions: OUTPUT_OPTIONS,
      inputOptions: INPUT_OPTIONS,
      theme,
      diagramCanvasWidth,
      diagramCanvasHeight: getSafeDiagramHeight(diagramCanvasWidth, model, { viewMode: 'wiring', theme, showTitle: false }, 340),
      resultReportCanvasHeight: getSafeReportHeight(EXPORT_WIDTH, model, 960),
    })
  },

  onReady() {
    this._pageReady = true
    if (this._isWiringVisible) this.renderDiagram()
  },

  onShow() {
    this._isWiringVisible = true
    this._wiringLifecycle.setVisible(true)
    if (this._pageReady) this.renderDiagram()
  },

  onResize() {
    this.renderDiagram()
  },

  onHide() {
    this._isWiringVisible = false
    this._wiringLifecycle.setVisible(false)
    this.invalidateDiagramRender()
    this._reportPending = false
    this.clearWiringGenerationState(false)
  },

  onUnload() {
    this._pageUnloaded = true
    this._isWiringVisible = false
    this.invalidateDiagramRender()
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
    if (Object.keys(changes).length) this.setData(changes)
  },

  invalidateWiringGeneration() {
    if (this._wiringLifecycle) this._wiringLifecycle.invalidate()
    this.clearWiringGenerationState()
  },

  finishWiringGeneration(token, changes = {}) {
    commitIfWiringTaskCurrent(this, token, () => {
      if (this._reportLoading && typeof wx.hideLoading === 'function') wx.hideLoading()
      this._reportLoading = false
      this._reportPending = false
      if (changes.resultReportPreviewVisible) this.invalidateDiagramRender()
      this.setData({ isGeneratingResultReport: false, ...changes })
    })
  },

  renderDiagram() {
    if (!this._pageReady || !this._isWiringVisible || this._pageUnloaded || !this.data.model || !this.data.model.supported
      || this.data.selectorVisible || this.data.resultReportPreviewVisible) {
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
      || this.data.selectorVisible || this.data.resultReportPreviewVisible) return
    const model = this.data.model
    const options = {
      viewMode: this.data.viewMode,
      face: this.data.face,
      selectedId: this.data.selectedId,
      theme: this.data.theme,
      showTitle: false,
    }
    this._diagramNeedsRender = false
    try {
      wx.createSelectorQuery().in(this).select('#wiringDiagramCanvas').fields({ node: true, size: true }).exec((results) => {
        if (requestRevision !== this._diagramRequestRevision || !this._isWiringVisible || this._pageUnloaded
          || this.data.selectorVisible || this.data.resultReportPreviewVisible || !this.data.supported) return
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
              && !this.data.selectorVisible && !this.data.resultReportPreviewVisible && this.data.supported) {
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
          drawWiringDiagram(createScreenRendererContext(context), model, width, height, options)
          if (this.data.diagramError) this.setData({ diagramError: '' })
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
      && !this.data.selectorVisible && !this.data.resultReportPreviewVisible && !this.data.diagramError)
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
      selectorSide: side,
      selectorTitle: side === 'input' ? '选择输入端' : '选择输出端',
      selectorOptions: options,
    })
  },

  closeEndpointSelector() {
    this.setData({ selectorVisible: false }, () => this.renderDiagram())
  },

  selectEndpointOption(event) {
    const side = this.data.selectorSide
    const id = event && event.currentTarget && event.currentTarget.dataset.id
    const options = side === 'input' ? this.data.inputOptions : this.data.outputOptions
    if (!options.some((item) => item.id === id)) {
      this.invalidateWiringGeneration()
      this.invalidateDiagramRender()
      wx.showToast({ title: '接口选项无效，请重新选择', icon: 'none' })
      this.setData({ selectorVisible: false }, () => this.renderDiagram())
      return
    }

    const outputId = side === 'output' ? id : this.data.outputId
    const inputId = side === 'input' ? id : this.data.inputId
    if (outputId === this.data.outputId && inputId === this.data.inputId) {
      this.setData({ selectorVisible: false }, () => this.renderDiagram())
      return
    }
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    const selections = {}
    const model = getSafeWiringModel(outputId, inputId, selections, this.data.model)
    const output = this.data.outputOptions.find((item) => item.id === outputId)
    const input = this.data.inputOptions.find((item) => item.id === inputId)
    this._diagramNeedsRender = true
    this.setData({
      outputId,
      inputId,
      selections,
      model,
      supported: model.status === 'ready' && model.supported,
      diagramError: '',
      ...getModelDisplayInfo(model),
      selectedId: '',
      selectedConnection: null,
      selectorVisible: false,
      explanationExpanded: false,
      diagramCanvasHeight: getSafeDiagramHeight(this.data.diagramCanvasWidth, model, {
        viewMode: this.data.viewMode,
        face: this.data.face,
        theme: this.data.theme,
        showTitle: false,
      }, this.data.diagramCanvasHeight),
      resultReportCanvasHeight: getSafeReportHeight(EXPORT_WIDTH, model, this.data.resultReportCanvasHeight),
      outputLabel: output && output.label,
      inputLabel: input && input.label,
    }, () => this.renderDiagram())
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
    const model = getSafeWiringModel(this.data.outputId, this.data.inputId, selections, this.data.model)
    this._diagramNeedsRender = true
    this.setData({
      selections,
      model,
      wiringStatus: model.status,
      supported: model.status === 'ready' && model.supported,
      ...getModelDisplayInfo(model),
      selectedId: '',
      selectedConnection: null,
      diagramError: '',
      explanationExpanded: false,
      diagramCanvasHeight: getSafeDiagramHeight(this.data.diagramCanvasWidth, model, {
        viewMode: this.data.viewMode,
        face: this.data.face,
        theme: this.data.theme,
        showTitle: false,
      }, this.data.diagramCanvasHeight),
      resultReportCanvasHeight: getSafeReportHeight(EXPORT_WIDTH, model, this.data.resultReportCanvasHeight),
    }, () => this.renderDiagram())
  },

  selectViewMode(event) {
    const viewMode = event && event.currentTarget && event.currentTarget.dataset.mode
    if (viewMode !== 'wiring' && viewMode !== 'connectors') return
    if (viewMode === this.data.viewMode) return
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    this.setData({ viewMode, selectedId: '', selectedConnection: null, diagramError: '' }, () => this.renderDiagram())
  },

  selectConnectorFace(event) {
    const face = event && event.currentTarget && event.currentTarget.dataset.face
    if ((face !== 'mating' && face !== 'solder') || face === this.data.face) return
    this.invalidateWiringGeneration()
    this.invalidateDiagramRender()
    this.setData({ face, selectedId: '', selectedConnection: null, diagramError: '' }, () => this.renderDiagram())
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
      viewMode: this.data.viewMode,
      face: this.data.face,
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
    for (const area of areas || []) {
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
    }, () => this.renderDiagram())
  },

  toggleExplanation() {
    this.setData({ explanationExpanded: !this.data.explanationExpanded })
  },

  onSafeAreaTap() {},

  copyConnection() {
    const model = this.data.model
    if (!model || !model.supported || !Array.isArray(model.connections) || !model.connections.length) {
      wx.showToast({ title: (model && model.reason) || '当前组合暂无可复制接法', icon: 'none' })
      return
    }
    let text
    try {
      text = buildWiringText(model)
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
      this.setData({ resultReportPreviewVisible: true })
      return
    }
    if (typeof wx.createCanvasContext !== 'function' || typeof wx.canvasToTempFilePath !== 'function') {
      wx.showToast({ title: '当前微信版本暂不支持生成图片', icon: 'none' })
      return
    }

    vibrate('medium')
    const width = EXPORT_WIDTH
    const height = getReportHeight(width, model)
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
      try {
        const context = wx.createCanvasContext(EXPORT_CANVAS_ID, this)
        drawWiringReport(context, model, width, height, { theme: this.data.theme })
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
  },

  closeResultReportPreview() {
    vibrate('light')
    this.setData({ resultReportPreviewVisible: false }, () => this.renderDiagram())
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
})

module.exports = {
  commitIfWiringTaskCurrent,
  createWiringLifecycle,
  normalizeInfoItems,
  getSafeDiagramHeight,
  getSafeReportHeight,
}

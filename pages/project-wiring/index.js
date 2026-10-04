const {
  BUILD_OPTIONS,
  CABLE_OPTIONS,
  CONNECTOR_OPTIONS,
  STATUS_OPTIONS,
  applyScheduleChange,
  buildScheduleText,
  emptySchedule,
  normalizeSchedule,
} = require('../../utils/project-wiring')
const {
  createProject,
  getActiveProject,
  getProjectWiring,
  getProjects,
  saveProjectWiring,
} = require('../../utils/records')
const { shareGeneratedImage } = require('../../utils/report-image-actions')

const REPORT_CANVAS_ID = 'wiringReportCanvas'
const CONNECTOR_PICKER_OPTIONS = [{ id: '', label: '待确认' }, ...CONNECTOR_OPTIONS]
const CUSTOM_CONNECTOR_INDEX = CONNECTOR_PICKER_OPTIONS.findIndex((option) => option.id === 'custom')
const BATCH_CONNECTOR_OPTIONS = CONNECTOR_PICKER_OPTIONS
const CABLE_SPEC_OPTIONS = {
  balanced: [],
  unbalanced: [],
  speaker: ['RVV 2×1.5 mm²', 'RVV 2×2.5 mm²'],
}
const DEFAULT_AUDIO_SPEC = 'RVPE 2×0.5 mm²'
const EXPORT_TYPES = [
  { id: 'lines', label: '线路表' },
  { id: 'materials', label: '材料表' },
  { id: 'labels', label: '双端线号' },
]
const DRAFT_FIELDS = new Set([
  'purpose', 'fromDevice', 'fromPort', 'toDevice', 'toPort', 'buildType', 'cableType',
  'spec', 'connectorA', 'connectorB', 'lengthText', 'status', 'notes',
])
const REQUIRED_ROUTE_FIELDS = [
  { field: 'fromDevice', label: '来源设备', target: 'wiring-field-from-device' },
  { field: 'fromPort', label: '来源端口', target: 'wiring-field-from-port' },
  { field: 'toDevice', label: '去向设备', target: 'wiring-field-to-device' },
  { field: 'toPort', label: '去向端口', target: 'wiring-field-to-port' },
]
const ROUTE_ENDPOINT_FIELDS = ['fromDevice', 'fromPort', 'toDevice', 'toPort']

function optionIndex(options, id, fallback = 0) {
  const found = options.findIndex((option) => option.id === id)
  return found >= 0 ? found : Math.min(fallback, Math.max(options.length - 1, 0))
}

function getCableSpecOptions(cableType) {
  return CABLE_SPEC_OPTIONS[cableType] || []
}

function getDefaultSpec(cableType) {
  return ['balanced', 'unbalanced'].includes(cableType) ? DEFAULT_AUDIO_SPEC : ''
}

function getCableSpecOptionViews(cableType) {
  return getCableSpecOptions(cableType).map((value) => {
    const match = String(value).match(/^(\S+)\s+(.+)$/)
    return {
      value,
      model: match ? match[1] : value,
      size: match ? match[2] : '',
    }
  })
}

function findOptionId(options, pattern, fallback) {
  const option = options.find((item) => pattern.test(item.label))
  return option ? option.id : fallback
}

function connectorPickerIndex(value) {
  const exact = CONNECTOR_PICKER_OPTIONS.findIndex((option) => option.id === value)
  return exact >= 0 ? exact : CUSTOM_CONNECTOR_INDEX
}

function optionLabel(options, id, fallback = '待确认') {
  const option = options.find((item) => item.id === id)
  return option ? option.label : (id || fallback)
}

function sameRouteEndpoints(left, right) {
  return ROUTE_ENDPOINT_FIELDS.every((field) => String(left && left[field] || '').trim() === String(right && right[field] || '').trim())
}

function uniqueValues(lines, fields, limit = 8) {
  const values = []
  const seen = new Set()
  lines.forEach((line) => fields.forEach((field) => {
    const value = String(line[field] || '').trim()
    if (value && !seen.has(value)) {
      seen.add(value)
      values.push(value)
    }
  }))
  return values.slice(0, limit)
}

function formatCode(value) {
  return `A${String(Math.max(1, Number(value) || 1)).padStart(3, '0')}`
}

function getNextPreviewCode(schedule) {
  const used = new Set(schedule.lines.map((line) => String(line.code || '').toLocaleLowerCase()))
  let number = schedule.nextNumber
  let code = formatCode(number)
  while (used.has(code.toLocaleLowerCase())) {
    number += 1
    code = formatCode(number)
  }
  return code
}

function decorateLine(line) {
  return {
    id: line.id,
    code: line.code,
    purpose: line.purpose,
    fromDevice: line.fromDevice,
    fromPort: line.fromPort,
    toDevice: line.toDevice,
    toPort: line.toPort,
    spec: line.spec,
    lengthText: line.lengthText,
    status: line.status,
    cableType: line.cableType,
    statusLabel: optionLabel(STATUS_OPTIONS, line.status),
    cableTypeLabel: optionLabel(CABLE_OPTIONS, line.cableType),
  }
}

function hasMissingProject(error) {
  return /不存在|已删除|缺少项目|项目编号/i.test(String(error || ''))
}

function safeToast(title) {
  if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') wx.showToast({ title, icon: 'none' })
}

Page({
  data: {
    project: null,
    loading: true,
    loadError: '',
    loadErrorTitle: '暂时无法读取项目布线',
    canRetry: false,
    selectionRequired: false,
    projectPickerVisible: false,
    projectPickerLoading: false,
    projectPickerProjects: [],
    projectPickerError: '',
    projectPickerName: '',
    projectCreating: false,
    lineCount: 0,
    statusCounts: { pending: 0, connected: 0, checked: 0 },
    searchText: '',
    visibleLines: [],
    buildOptions: BUILD_OPTIONS,
    cableOptions: CABLE_OPTIONS,
    specOptions: [],
    specOptionViews: [],
    connectorOptions: CONNECTOR_PICKER_OPTIONS,
    batchConnectorOptions: BATCH_CONNECTOR_OPTIONS,
    customConnectorIndex: CUSTOM_CONNECTOR_INDEX,
    customConnectorA: '',
    customConnectorB: '',
    batchCustomConnectorA: '',
    batchCustomConnectorB: '',
    statusOptions: STATUS_OPTIONS,
    buildIndex: 0,
    cableIndex: 0,
    connectorAIndex: 0,
    connectorBIndex: 0,
    statusIndex: 0,
    exportTypes: EXPORT_TYPES,
    exportTypeIndex: 0,
    editorVisible: false,
    draftIsNew: true,
    draftCode: '',
    draft: null,
    formScrollTarget: '',
    formScrollTop: 0,
    formFrameStyle: '',
    formSheetStyle: '',
    formKeyboardSpacerHeight: 0,
    formError: '',
    formFieldErrors: {},
    saveError: '',
    saving: false,
    fromDeviceHistory: [],
    fromPortHistory: [],
    toDeviceHistory: [],
    toPortHistory: [],
    batchVisible: false,
    batchDraft: null,
    batchSpecOptions: [],
    batchSpecOptionViews: [],
    batchBuildIndex: 0,
    batchCableIndex: 0,
    batchConnectorAIndex: 0,
    batchConnectorBIndex: 0,
    batchPreviewLines: [],
    batchPossibleDuplicates: [],
    batchDuplicateWarning: '',
    batchError: '',
    reportCanvasWidth: 720,
    reportCanvasHeight: 400,
    reportPreviewVisible: false,
    reportPageTitle: '',
    reportPageIndex: 0,
    reportImages: [],
    reportImagePath: '',
    reportSavedPageIndices: [],
    reportSaveAllLabel: '保存全部0张',
    reportSaveRunning: false,
    reportSaveInFlight: false,
    reportSaveMessage: '',
    reportSaveError: '',
  },

  onLoad(options = {}) {
    this.projectId = typeof options.id === 'string' ? options.id : ''
    this._destroyed = false
    this._hidden = false
    this._skipNextShowRefresh = true
    this._searchTimer = null
    this._searchRevision = 0
    this._reportRevision = 0
    this._projectLoadRevision = 0
    this._projectPickerRevision = 0
    this._reportSignature = ''
    this._reportPending = false
    this._reportSaveJobRevision = 0
    this._reportSaveJob = null
    this._reportSaveInFlight = null
    this._reportSavedPages = new Map()
    this._schedule = emptySchedule()
    this._draftBaseline = ''
    this._draftTouched = false
    this._draftIsCopy = false
    this._batchCommand = null
    this._batchDirty = false
    const formViewport = this.getFormWindowMetrics()
    this._formViewportBaselineHeight = formViewport.windowHeight
    this._formViewportScreenWidth = formViewport.screenWidth
    this._formKeyboardHeight = 0
    this._formInputId = ''
    this._formScrollRevision = 0
    this._formScrollTimer = null
    this._formBlurTimer = null
    if (this.projectId) {
      this.refreshProjectWiring()
      return
    }
    let activeProject
    try {
      activeProject = getActiveProject()
    } catch (error) {
      activeProject = null
    }
    if (activeProject && typeof activeProject.then === 'function') {
      activeProject.then((project) => this.openInitialProject(project)).catch(() => this.openInitialProject(null))
    } else this.openInitialProject(activeProject)
  },

  openInitialProject(project) {
    if (this._destroyed) return
    if (project && project.id) {
      this.projectId = String(project.id)
      this.refreshProjectWiring()
      return
    }
    this.projectId = ''
    this.setData({ loading: false, selectionRequired: true, project: null, loadError: '' })
    this.openProjectPicker()
  },

  onShow() {
    this._hidden = false
    if (!this.data.editorVisible && !this.data.batchVisible) this.updateFormViewportBaseline()
    if (this._skipNextShowRefresh) {
      this._skipNextShowRefresh = false
      return
    }
    if (!this.data.editorVisible && !this.data.batchVisible && this.projectId) this.refreshProjectWiring()
  },

  onHide() {
    this._hidden = true
    this.clearFormKeyboardViewport()
    this._formInputId = ''
    if (this._formBlurTimer) clearTimeout(this._formBlurTimer)
    this._formBlurTimer = null
    this.invalidateExport(false)
  },

  onUnload() {
    this._destroyed = true
    this._hidden = true
    this.resetFormKeyboardAvoidance(false)
    this._searchRevision += 1
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = null
    this.invalidateExport(false)
  },

  getFormWindowMetrics() {
    let info = {}
    if (typeof wx !== 'undefined') {
      try {
        if (typeof wx.getWindowInfo === 'function') info = wx.getWindowInfo() || {}
      } catch (error) {}
      if (!Number(info.windowHeight) || !Number(info.screenWidth)) {
        try {
          if (typeof wx.getSystemInfoSync === 'function') {
            const fallback = wx.getSystemInfoSync() || {}
            info = {
              ...fallback,
              ...info,
              windowHeight: Number(info.windowHeight) > 0 ? info.windowHeight : fallback.windowHeight,
              screenWidth: Number(info.screenWidth) > 0 ? info.screenWidth : fallback.screenWidth,
            }
          }
        } catch (error) {}
      }
    }
    return {
      windowHeight: Number(info.windowHeight) > 0 ? Number(info.windowHeight) : 0,
      screenWidth: Number(info.screenWidth) > 0 ? Number(info.screenWidth) : 0,
    }
  },

  updateFormViewportBaseline() {
    const metrics = this.getFormWindowMetrics()
    if (!metrics.windowHeight) return
    const widthChanged = this._formViewportScreenWidth && metrics.screenWidth
      && this._formViewportScreenWidth !== metrics.screenWidth
    this._formViewportBaselineHeight = widthChanged || !this._formViewportBaselineHeight
      ? metrics.windowHeight
      : Math.max(this._formViewportBaselineHeight, metrics.windowHeight)
    if (metrics.screenWidth) this._formViewportScreenWidth = metrics.screenWidth
  },

  beginFormKeyboardAvoidance(mode) {
    this.updateFormViewportBaseline()
    this._formFrameBaselineHeight = this._formViewportBaselineHeight || this.getFormWindowMetrics().windowHeight
    const sheetRatio = mode === 'batch' ? 0.92 : 0.94
    const sheetHeight = Math.round(this._formFrameBaselineHeight * sheetRatio)
    const frameStyle = this._formFrameBaselineHeight
      ? `top:0;bottom:auto;height:${this._formFrameBaselineHeight}px;` : ''
    const sheetStyle = sheetHeight
      ? `height:calc(${sheetHeight}px - env(safe-area-inset-top) - env(safe-area-inset-bottom));` : ''
    this._formKeyboardHeight = 0
    this._formInputId = ''
    this._formScrollRevision += 1
    if (this._formScrollTimer) clearTimeout(this._formScrollTimer)
    if (this._formBlurTimer) clearTimeout(this._formBlurTimer)
    this._formScrollTimer = null
    this._formBlurTimer = null
    if (!this._destroyed) this.setData({
      formFrameStyle: frameStyle,
      formSheetStyle: sheetStyle,
      formKeyboardSpacerHeight: 0,
    })
  },

  resetFormKeyboardAvoidance(update = true) {
    this._formKeyboardHeight = 0
    this._formInputId = ''
    this._formFrameBaselineHeight = 0
    this._formScrollRevision += 1
    if (this._formScrollTimer) clearTimeout(this._formScrollTimer)
    if (this._formBlurTimer) clearTimeout(this._formBlurTimer)
    this._formScrollTimer = null
    this._formBlurTimer = null
    if (update && !this._destroyed) {
      this.setData({
        formFrameStyle: '',
        formSheetStyle: '',
        formKeyboardSpacerHeight: 0,
        formScrollTarget: '',
        formScrollTop: 0,
      })
    }
  },

  clearFormKeyboardViewport() {
    this._formScrollRevision += 1
    if (this._formScrollTimer) clearTimeout(this._formScrollTimer)
    this._formScrollTimer = null
    this._formKeyboardHeight = 0
    this.updateFormViewportBaseline()
    if (!this._destroyed && (this.data.editorVisible || this.data.batchVisible)
      && this.data.formKeyboardSpacerHeight !== 0) {
      this.setData({ formKeyboardSpacerHeight: 0 })
    }
  },

  getFormInputId(event) {
    const current = event && event.currentTarget
    const target = event && event.target
    return String(current && current.dataset && current.dataset.focusId
      || current && current.id
      || target && target.id
      || '')
  },

  onFormInputFocus(event) {
    if (this._destroyed || this._hidden || (!this.data.editorVisible && !this.data.batchVisible)) return
    const inputId = this.getFormInputId(event)
    if (!inputId) return
    this._formInputId = inputId
    if (this._formBlurTimer) clearTimeout(this._formBlurTimer)
    this._formBlurTimer = null
    const focusHeight = Number(event && event.detail && event.detail.height)
    const afterFocusRender = () => {
      if (this._destroyed || this._hidden || this._formInputId !== inputId
        || (!this.data.editorVisible && !this.data.batchVisible)) return
      if (Number.isFinite(focusHeight) && focusHeight > 0) {
        this.onFormKeyboardHeightChange({ currentTarget: event.currentTarget, detail: { height: focusHeight } })
      } else this.queueFocusedFormScroll(inputId)
    }
    if (this.data.formScrollTarget) {
      this.setData({ formScrollTarget: '' }, afterFocusRender)
    } else afterFocusRender()
  },

  onFormInputBlur(event) {
    const inputId = this.getFormInputId(event)
    if (!inputId || this._formInputId !== inputId) return
    this._formInputId = ''
    this._formScrollRevision += 1
    if (this._formBlurTimer) clearTimeout(this._formBlurTimer)
    this._formBlurTimer = setTimeout(() => {
      this._formBlurTimer = null
      if (!this._destroyed && !this._hidden && !this._formInputId) this.clearFormKeyboardViewport()
    }, 160)
  },

  onFormKeyboardHeightChange(event) {
    if (this._destroyed || this._hidden || (!this.data.editorVisible && !this.data.batchVisible)) return
    const eventInputId = this.getFormInputId(event)
    const rawHeight = Number(event && event.detail && event.detail.height)
    const keyboardHeight = Number.isFinite(rawHeight) ? Math.max(0, rawHeight) : 0
    if (eventInputId && this._formInputId && eventInputId !== this._formInputId) return
    if (keyboardHeight > 0 && (!this._formInputId || (eventInputId && eventInputId !== this._formInputId))) return
    if (!keyboardHeight) {
      this.clearFormKeyboardViewport()
      return
    }

    this._formKeyboardHeight = keyboardHeight
    const spacerHeight = Math.round(keyboardHeight)
    const revision = ++this._formScrollRevision
    const scrollAfterSpacer = () => {
      if (this._destroyed || this._hidden || revision !== this._formScrollRevision
        || (!this.data.editorVisible && !this.data.batchVisible)) return
      if (this._formInputId) this.queueFocusedFormScroll(this._formInputId)
    }
    if (this.data.formKeyboardSpacerHeight !== spacerHeight) {
      this.setData({ formKeyboardSpacerHeight: spacerHeight }, scrollAfterSpacer)
    } else if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(scrollAfterSpacer)
    else setTimeout(scrollAfterSpacer, 0)
  },

  queueFocusedFormScroll(inputId) {
    if (this._destroyed || this._hidden || this._formInputId !== inputId) return
    const revision = ++this._formScrollRevision
    const run = () => {
      this._formScrollTimer = null
      if (this._destroyed || this._hidden || revision !== this._formScrollRevision
        || this._formInputId !== inputId || (!this.data.editorVisible && !this.data.batchVisible)) return
      this.scrollFocusedFormInput(inputId, revision)
    }
    if (this._formScrollTimer) clearTimeout(this._formScrollTimer)
    if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(run)
    else this._formScrollTimer = setTimeout(run, 0)
  },

  scrollFocusedFormInput(inputId, revision) {
    if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return
    let query
    try {
      query = wx.createSelectorQuery()
      if (query && typeof query.in === 'function') query = query.in(this) || query
      const scrollSelector = this.data.editorVisible ? '.wiring-editor-scroll' : '.wiring-batch-scroll'
      query.select(`#${inputId}`).boundingClientRect()
      query.select(scrollSelector).fields({ rect: true, scrollOffset: true })
      query.exec((results) => {
        if (this._destroyed || this._hidden || revision !== this._formScrollRevision
          || this._formInputId !== inputId || (!this.data.editorVisible && !this.data.batchVisible)) return
        const inputRect = results && results[0]
        const scrollRect = results && results[1]
        if (!inputRect || !scrollRect) return
        const inputTop = Number(inputRect.top)
        const inputBottom = Number.isFinite(Number(inputRect.bottom))
          ? Number(inputRect.bottom) : inputTop + Number(inputRect.height || 0)
        const scrollTop = Number(scrollRect.top)
        const scrollBottom = Number.isFinite(Number(scrollRect.bottom))
          ? Number(scrollRect.bottom) : scrollTop + Number(scrollRect.height || 0)
        const currentScrollTop = Number(scrollRect.scrollTop)
        if (![inputTop, inputBottom, scrollTop, scrollBottom, currentScrollTop].every(Number.isFinite)) return
        const measuredScrollTop = Math.max(0, currentScrollTop)
        const visibleTop = scrollTop + 12
        const currentHeight = this.getFormWindowMetrics().windowHeight || Infinity
        const frameHeight = this._formFrameBaselineHeight || this._formViewportBaselineHeight || Infinity
        const keyboardTop = this._formKeyboardHeight > 0 ? frameHeight - this._formKeyboardHeight : Infinity
        const visibleBottom = Math.min(scrollBottom, currentHeight, keyboardTop) - 12
        let adjustment = 0
        if (inputTop < visibleTop) adjustment = inputTop - visibleTop
        else if (inputBottom > visibleBottom) adjustment = inputBottom - visibleBottom
        if (Math.abs(adjustment) < 1) return
        const nextScrollTop = Math.max(0, measuredScrollTop + adjustment)
        if (Math.abs(Number(this.data.formScrollTop) - nextScrollTop) < 0.01) {
          this.setData({ formScrollTop: measuredScrollTop }, () => {
            const applyTarget = () => {
              if (this._destroyed || this._hidden || revision !== this._formScrollRevision
                || this._formInputId !== inputId || (!this.data.editorVisible && !this.data.batchVisible)) return
              this.setData({ formScrollTop: nextScrollTop })
            }
            if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(applyTarget)
            else setTimeout(applyTarget, 0)
          })
        } else this.setData({ formScrollTop: nextScrollTop })
      })
    } catch (error) {}
  },

  refreshProjectWiring() {
    if (this._destroyed) return false
    const expectedProjectId = this.projectId
    const requestRevision = ++this._projectLoadRevision
    this.setData({ loading: true, loadError: '', canRetry: false })
    if (!this.projectId) {
      this.invalidateExport(true)
      this._loadedSignature = ''
      this._schedule = emptySchedule()
      this.setData({
        loading: false,
        project: null,
        selectionRequired: true,
        loadErrorTitle: '请先选择项目',
        loadError: '',
        canRetry: false,
        lineCount: 0,
        visibleLines: [],
      })
      return false
    }

    let result
    try {
      result = getProjectWiring(expectedProjectId)
    } catch (error) {
      result = { ok: false, error: error && error.message ? error.message : '读取项目资料失败' }
    }
    if (result && typeof result.then === 'function') {
      result.then((value) => this.applyLoadResult(value, { projectId: expectedProjectId, revision: requestRevision })).catch((error) => this.applyLoadResult({
        ok: false,
        error: error && error.message ? error.message : '读取项目资料失败',
      }, { projectId: expectedProjectId, revision: requestRevision }))
      return true
    }
    return this.applyLoadResult(result, { projectId: expectedProjectId, revision: requestRevision })
  },

  applyLoadResult(result, request = {}) {
    const expectedProjectId = request.projectId === undefined ? this.projectId : request.projectId
    const requestRevision = request.revision === undefined ? this._projectLoadRevision : request.revision
    if (this._destroyed || requestRevision !== this._projectLoadRevision || expectedProjectId !== this.projectId) return false
    if (!result || result.ok !== true || !result.project || result.project.id !== expectedProjectId || !result.schedule) {
      this.invalidateExport(true)
      this._loadedSignature = ''
      const error = result && result.error ? String(result.error) : '读取项目布线失败，请重试。'
      const missing = hasMissingProject(error) || (result && result.ok === true && result.project && result.project.id !== expectedProjectId)
      this._schedule = emptySchedule()
      this._decoratedLines = []
      this.setData({
        loading: false,
        project: null,
        selectionRequired: false,
        loadErrorTitle: missing ? '项目不存在或已删除' : '暂时无法读取项目布线',
        loadError: missing ? '请在本页重新选择一个项目后继续。' : error,
        canRetry: !missing,
        lineCount: 0,
        visibleLines: [],
        statusCounts: { pending: 0, connected: 0, checked: 0 },
      })
      return false
    }

    const schedule = normalizeSchedule(result.schedule)
    const signature = `${result.project.id}:${result.project.name || ''}:${schedule.revision}`
    if (this._loadedSignature && signature !== this._loadedSignature) this.invalidateExport(true)
    this._loadedSignature = signature
    this._schedule = schedule
    this._decoratedLines = schedule.lines.map(decorateLine)
    const statusCounts = schedule.lines.reduce((counts, line) => {
      if (Object.prototype.hasOwnProperty.call(counts, line.status)) counts[line.status] += 1
      return counts
    }, { pending: 0, connected: 0, checked: 0 })
    this.setData({
      loading: false,
      project: { id: result.project.id, name: String(result.project.name || '') },
      selectionRequired: false,
      loadError: '',
      canRetry: false,
      lineCount: schedule.lines.length,
      visibleLines: this.filterLines(this.data.searchText),
      statusCounts,
    })
    if (typeof wx !== 'undefined' && typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: '通道与线缆' })
    return true
  },

  requestProjectPicker() {
    if (this.data.saving || this.data.projectCreating) return
    const openPicker = () => {
      if (this._destroyed) return
      if (this.data.reportPreviewVisible) this.closeReportPreview()
      this.openProjectPicker()
    }
    if (this.data.editorVisible) {
      const closeAndOpen = () => { this.closeEditor(); openPicker() }
      if (!this.hasUnsavedDraft()) {
        closeAndOpen()
        return
      }
      wx.showModal({
        title: '切换项目并放弃编辑？',
        content: '当前线路有未保存修改。继续后会关闭编辑表单，但不会更改原线路。',
        confirmText: '继续选择',
        confirmColor: '#d70015',
        success: ({ confirm }) => { if (confirm && !this._destroyed) closeAndOpen() },
      })
      return
    }
    if (this.data.batchVisible) {
      const closeAndOpen = () => { this.closeBatch(); openPicker() }
      if (!this._batchDirty && !this.data.batchPreviewLines.length) {
        closeAndOpen()
        return
      }
      wx.showModal({
        title: '切换项目并放弃批量设置？',
        content: '当前批量线路的端口设置和预览尚未保存。',
        confirmText: '继续选择',
        confirmColor: '#d70015',
        success: ({ confirm }) => { if (confirm && !this._destroyed) closeAndOpen() },
      })
      return
    }
    openPicker()
  },

  openProjectPicker() {
    if (this._destroyed) return
    this.invalidateExport(false)
    const requestRevision = ++this._projectPickerRevision
    this.setData({
      projectPickerVisible: true,
      projectPickerLoading: true,
      projectPickerError: '',
      projectPickerName: '',
    })
    let result
    try {
      result = getProjects()
    } catch (error) {
      result = null
    }
    const finish = (projects) => {
      if (this._destroyed || requestRevision !== this._projectPickerRevision || !this.data.projectPickerVisible) return
      if (!Array.isArray(projects)) {
        this.setData({ projectPickerLoading: false, projectPickerProjects: [], projectPickerError: '读取项目列表失败，请重试或新建项目。' })
        return
      }
      const projectPickerProjects = projects.filter((project) => project && project.id && project.name).map((project) => ({
        id: String(project.id),
        name: String(project.name),
        lineCount: Array.isArray(project.wiringSchedule && project.wiringSchedule.lines)
          ? project.wiringSchedule.lines.length : 0,
      }))
      this.setData({ projectPickerLoading: false, projectPickerProjects, projectPickerError: '' })
    }
    if (result && typeof result.then === 'function') result.then(finish).catch(() => finish(null))
    else finish(result)
  },

  onProjectNameInput(event) {
    this.setData({ projectPickerName: String(event.detail && event.detail.value || ''), projectPickerError: '' })
  },

  cancelProjectPicker() {
    if (this.data.projectCreating) return
    this._projectPickerRevision += 1
    const selectionRequired = !this.projectId
    this.setData({ projectPickerVisible: false, projectPickerLoading: false, selectionRequired })
  },

  selectProject(event) {
    const projectId = String(event.currentTarget && event.currentTarget.dataset.id || '')
    if (!projectId || !this.data.projectPickerVisible || this.data.projectCreating || this.data.saving
      || this.data.editorVisible || this.data.batchVisible) return
    this.enterProject(projectId)
  },

  createAndOpenProject() {
    if (this.data.projectCreating || this.data.saving || this.data.editorVisible || this.data.batchVisible) return
    const name = String(this.data.projectPickerName || '').trim().slice(0, 30)
    if (!name) {
      this.setData({ projectPickerError: '请输入项目名称。' })
      return
    }
    this.setData({ projectCreating: true, projectPickerError: '' })
    let result
    try {
      result = createProject(name)
    } catch (error) {
      result = null
    }
    const finish = (project) => {
      if (this._destroyed) return
      if (!project || !project.id) {
        this.setData({ projectCreating: false, projectPickerError: '创建项目失败，请重试。' })
        return
      }
      this.setData({ projectCreating: false })
      this.enterProject(String(project.id))
    }
    if (result && typeof result.then === 'function') result.then(finish).catch(() => finish(null))
    else finish(result)
  },

  enterProject(projectId) {
    if (!projectId || this._destroyed || this.data.projectCreating || this.data.saving
      || this.data.editorVisible || this.data.batchVisible || !this.data.projectPickerVisible) return
    this._projectPickerRevision += 1
    if (this.projectId === projectId && this.data.project) {
      this.setData({ projectPickerVisible: false, projectPickerLoading: false, projectPickerError: '' })
      return
    }
    this._searchRevision += 1
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = null
    this.resetFormKeyboardAvoidance()
    this.invalidateExport(true)
    this.projectId = projectId
    this._loadedSignature = ''
    this._decoratedLines = []
    this._schedule = emptySchedule()
    this.setData({
      projectPickerVisible: false,
      projectPickerLoading: false,
      projectPickerError: '',
      projectPickerName: '',
      selectionRequired: false,
      project: null,
      loading: true,
      loadError: '',
      canRetry: false,
      lineCount: 0,
      statusCounts: { pending: 0, connected: 0, checked: 0 },
      searchText: '',
      visibleLines: [],
      reportImages: [],
      reportImagePath: '',
      reportPageIndex: 0,
    })
    this.refreshProjectWiring()
  },

  retryLoad() {
    this.refreshProjectWiring()
  },

  filterLines(query) {
    const value = String(query || '').trim().toLocaleLowerCase()
    if (!value) return (this._decoratedLines || []).slice()
    return (this._decoratedLines || []).filter((line) => [
      line.code, line.purpose, line.fromDevice, line.fromPort, line.toDevice, line.toPort,
    ].some((item) => String(item || '').toLocaleLowerCase().includes(value)))
  },

  applySearch() {
    const event = arguments[0]
    this._searchRevision += 1
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = null
    const query = event && event.detail && typeof event.detail.value === 'string'
      ? event.detail.value
      : this.data.searchText
    this.setData({ searchText: query, visibleLines: this.filterLines(query) })
  },

  onSearchInput(event) {
    const value = event.detail.value || ''
    const requestRevision = ++this._searchRevision
    this.setData({ searchText: value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null
      if (!this._destroyed && requestRevision === this._searchRevision) this.setData({ visibleLines: this.filterLines(value) })
    }, 180)
  },

  clearSearch() {
    this._searchRevision += 1
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = null
    this.setData({ searchText: '', visibleLines: this.filterLines('') })
  },

  makeDefaultDraft() {
    return {
      purpose: '',
      fromDevice: '',
      fromPort: '',
      toDevice: '',
      toPort: '',
      buildType: 'finished',
      cableType: 'balanced',
      spec: DEFAULT_AUDIO_SPEC,
      connectorA: findOptionId(CONNECTOR_OPTIONS, /XLR\s*母/, 'xlrFemale'),
      connectorB: findOptionId(CONNECTOR_OPTIONS, /XLR\s*公/, 'xlrMale'),
      lengthText: '',
      status: 'pending',
      notes: '',
    }
  },

  getHistoryData(draft) {
    const lines = this._schedule.lines
    return {
      fromDeviceHistory: uniqueValues(lines, ['fromDevice', 'toDevice']),
      fromPortHistory: uniqueValues(draft.fromDevice
        ? lines.filter((line) => line.fromDevice === draft.fromDevice || line.toDevice === draft.fromDevice)
        : lines, ['fromPort', 'toPort']),
      toDeviceHistory: uniqueValues(lines, ['toDevice', 'fromDevice']),
      toPortHistory: uniqueValues(draft.toDevice
        ? lines.filter((line) => line.toDevice === draft.toDevice || line.fromDevice === draft.toDevice)
        : lines, ['toPort', 'fromPort']),
    }
  },

  setDraft(draft, { isNew = false, isCopy = false, touched = false } = {}) {
    this.beginFormKeyboardAvoidance('editor')
    const normalizedDraft = { ...this.makeDefaultDraft(), ...draft }
    const existingLine = !isNew && normalizedDraft.id
      ? this._schedule.lines.find((line) => line.id === normalizedDraft.id)
      : null
    this._draftBaseline = existingLine ? JSON.stringify(existingLine) : ''
    this._draftTouched = touched
    this._draftIsCopy = isCopy
    this._draftDefaultSpec = isNew && !isCopy
    const knownConnectorIds = new Set(CONNECTOR_OPTIONS.filter((option) => option.id !== 'custom').map((option) => option.id))
    const customConnectorA = normalizedDraft.connectorA && normalizedDraft.connectorA !== 'custom' && !knownConnectorIds.has(normalizedDraft.connectorA)
      ? normalizedDraft.connectorA : ''
    const customConnectorB = normalizedDraft.connectorB && normalizedDraft.connectorB !== 'custom' && !knownConnectorIds.has(normalizedDraft.connectorB)
      ? normalizedDraft.connectorB : ''
    this._customConnectors = { connectorA: customConnectorA, connectorB: customConnectorB }
    this._connectorTouched = { connectorA: false, connectorB: false }
    this._optionIndexes = {
      buildType: optionIndex(BUILD_OPTIONS, normalizedDraft.buildType),
      cableType: optionIndex(CABLE_OPTIONS, normalizedDraft.cableType),
      connectorA: connectorPickerIndex(normalizedDraft.connectorA),
      connectorB: connectorPickerIndex(normalizedDraft.connectorB),
      status: optionIndex(STATUS_OPTIONS, normalizedDraft.status),
    }
    this.setData({
      editorVisible: true,
      draftIsNew: isNew,
      draftCode: normalizedDraft.code || getNextPreviewCode(this._schedule),
      draft: normalizedDraft,
      specOptions: getCableSpecOptions(normalizedDraft.cableType),
      specOptionViews: getCableSpecOptionViews(normalizedDraft.cableType),
      formScrollTarget: '',
      formScrollTop: 0,
      buildIndex: this._optionIndexes.buildType,
      cableIndex: this._optionIndexes.cableType,
      connectorAIndex: this._optionIndexes.connectorA,
      connectorBIndex: this._optionIndexes.connectorB,
      customConnectorA,
      customConnectorB,
      statusIndex: this._optionIndexes.status,
      formError: '',
      formFieldErrors: {},
      saveError: '',
      saving: false,
      ...this.getHistoryData(normalizedDraft),
    })
  },

  openNewLine() {
    if (!this.data.project || this.data.loading) return
    this.invalidateExport(false)
    this._draftIsCopy = false
    this.setDraft(this.makeDefaultDraft(), { isNew: true })
  },

  editLine(event) {
    const id = event.currentTarget.dataset.id
    const line = this._schedule.lines.find((item) => item.id === id)
    if (!line) return
    this.invalidateExport(false)
    this.setDraft({ ...line }, { isNew: false })
  },

  onDraftInput(event) {
    const field = event.currentTarget.dataset.field
    if (!DRAFT_FIELDS.has(field) || !this.data.draft) return
    const value = event.detail.value === undefined ? '' : String(event.detail.value)
    if (field === 'spec') this._draftDefaultSpec = false
    this._draftTouched = true
    const draft = { ...this.data.draft, [field]: value }
    const formFieldErrors = { ...this.data.formFieldErrors }
    delete formFieldErrors[field]
    this.setData({
      draft,
      ...(field === 'fromDevice' || field === 'fromPort' || field === 'toDevice' || field === 'toPort'
        ? this.getHistoryData(draft)
        : {}),
      formError: '',
      formFieldErrors,
      saveError: '',
      formScrollTarget: '',
    })
  },

  chooseSpecPreset(event) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!this.data.draft || !this.data.specOptions.includes(value)) return
    this.onDraftInput({ currentTarget: { dataset: { field: 'spec' } }, detail: { value } })
  },

  chooseHistoryValue(event) {
    const field = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.field
    const historyByField = {
      fromDevice: 'fromDeviceHistory',
      fromPort: 'fromPortHistory',
      toDevice: 'toDeviceHistory',
      toPort: 'toPortHistory',
    }
    if (!Object.prototype.hasOwnProperty.call(historyByField, field)) return
    const historyField = historyByField[field]
    if (!historyField || !this.data.draft || this.data.saving || !event.detail) return
    const rawIndex = event.detail.value
    if (typeof rawIndex !== 'number' && typeof rawIndex !== 'string') return
    if (rawIndex === null || rawIndex === undefined || (typeof rawIndex === 'string' && rawIndex.trim() === '')) return
    const index = Number(rawIndex)
    const history = this.data[historyField]
    if (!Array.isArray(history) || !Number.isInteger(index) || index < 0 || index >= history.length) return
    const value = history[index]
    this._draftTouched = true
    const draft = { ...this.data.draft, [field]: value }
    const formFieldErrors = { ...this.data.formFieldErrors }
    delete formFieldErrors[field]
    this.setData({ draft, ...this.getHistoryData(draft), formError: '', formFieldErrors, saveError: '' })
  },

  onOptionChange(event) {
    const field = event.currentTarget.dataset.field
    const optionsByField = {
      buildType: BUILD_OPTIONS,
      cableType: CABLE_OPTIONS,
      connectorA: CONNECTOR_PICKER_OPTIONS,
      connectorB: CONNECTOR_PICKER_OPTIONS,
      status: STATUS_OPTIONS,
    }
    const options = optionsByField[field]
    const index = Number(event.detail.value)
    if (!options || !Number.isInteger(index) || !options[index]) return
    this._draftTouched = true
    let draft = { ...this.data.draft, [field]: options[index].id }
    const changes = {}
    if (field === 'cableType') {
      changes.specOptions = getCableSpecOptions(draft.cableType)
      changes.specOptionViews = getCableSpecOptionViews(draft.cableType)
      if (this._draftDefaultSpec) draft.spec = getDefaultSpec(draft.cableType)
    }
    if (field === 'cableType' && this.data.draftIsNew && options[index].id !== 'balanced') {
      ;['connectorA', 'connectorB'].forEach((connectorField) => {
        if (!this._connectorTouched[connectorField] && ['xlrFemale', 'xlrMale'].includes(draft[connectorField])) {
          draft[connectorField] = ''
          this._optionIndexes[connectorField] = optionIndex(CONNECTOR_PICKER_OPTIONS, '')
          changes[connectorField === 'connectorA' ? 'connectorAIndex' : 'connectorBIndex'] = this._optionIndexes[connectorField]
          changes[connectorField === 'connectorA' ? 'customConnectorA' : 'customConnectorB'] = ''
        }
      })
    }
    if (field === 'connectorA' || field === 'connectorB') {
      this._connectorTouched[field] = true
      if (options[index].id === 'custom') draft[field] = this._customConnectors[field] || ''
      else {
        draft[field] = options[index].id
        this._customConnectors[field] = ''
        changes[field === 'connectorA' ? 'customConnectorA' : 'customConnectorB'] = ''
      }
    }
    this._optionIndexes[field] = index
    const indexField = {
      buildType: 'buildIndex', cableType: 'cableIndex', connectorA: 'connectorAIndex',
      connectorB: 'connectorBIndex', status: 'statusIndex',
    }[field]
    this.setData({ draft, [indexField]: index, ...changes, formError: '', saveError: '' })
  },

  onCustomConnectorInput(event) {
    const field = event.currentTarget.dataset.field
    if (!['connectorA', 'connectorB'].includes(field)) return
    const value = String(event.detail.value || '')
    this._connectorTouched[field] = true
    this._customConnectors[field] = value
    this._draftTouched = true
    this.setData({
      draft: { ...this.data.draft, [field]: value },
      [field === 'connectorA' ? 'customConnectorA' : 'customConnectorB']: value,
    })
  },

  hasUnsavedDraft() {
    if (!this._draftTouched) return false
    if (this.data.draftIsNew || !this._draftBaseline) return true
    const baseline = JSON.parse(this._draftBaseline)
    return [...DRAFT_FIELDS].some((field) => this.data.draft[field] !== baseline[field])
  },

  requestCloseEditor() {
    if (this.data.saving) return
    if (!this.hasUnsavedDraft()) {
      this.closeEditor()
      return
    }
    wx.showModal({
      title: '放弃未保存修改？',
      content: '关闭后，本次填写的线路内容不会保存。',
      confirmText: '放弃修改',
      confirmColor: '#d70015',
      success: ({ confirm }) => {
        if (confirm && !this._destroyed) this.closeEditor()
      },
    })
  },

  closeEditor() {
    this.resetFormKeyboardAvoidance()
    this._draftTouched = false
    this._draftBaseline = ''
    this.setData({ editorVisible: false, draft: null, formError: '', formFieldErrors: {}, saveError: '', saving: false })
  },

  showMissingRouteFields(missingFields) {
    const formFieldErrors = {}
    missingFields.forEach(({ field, label }) => { formFieldErrors[field] = `请填写${label}` })
    const firstMissing = missingFields[0]
    if (!firstMissing) return
    this.setData({
      formError: `还缺少：${missingFields.map(({ label }) => label).join('、')}。`,
      formFieldErrors,
      formScrollTarget: '',
    }, () => {
      if (this._destroyed || this._hidden || !this.data.editorVisible) return
      this.setData({ formScrollTop: 0, formScrollTarget: firstMissing.target })
    })
  },

  saveLine() {
    const draft = this.data.draft
    if (!draft || this.data.saving) return
    const missingFields = REQUIRED_ROUTE_FIELDS.filter(({ field }) => !String(draft[field] || '').trim())
    if (missingFields.length) {
      this.showMissingRouteFields(missingFields)
      return
    }
    const line = { ...draft }
    if (this.data.draftIsNew) {
      delete line.id
      delete line.code
    }
    this.saveCommand({ type: 'upsert', line }, (result) => {
      const savedLine = result.schedule.lines.find((item) => item.id === (line.id || result.lineIds?.[0]))
      this.closeEditor()
      this.acceptSavedSchedule(result)
      if (savedLine) wx.showToast({ title: `${savedLine.code} 已保存`, icon: 'success' })
    })
  },

  deleteLine() {
    if (this.data.draftIsNew || !this.data.draft || this.data.saving) return
    const code = this.data.draft.code || '这条线路'
    wx.showModal({
      title: '删除线路？',
      content: `将从本项目布线表中删除 ${code}。`,
      confirmText: '删除',
      confirmColor: '#d70015',
      success: ({ confirm }) => {
        if (!confirm || this._destroyed) return
        this.saveCommand({ type: 'delete', id: this.data.draft.id }, (result) => {
          this.closeEditor()
          this.acceptSavedSchedule(result)
          wx.showToast({ title: '线路已删除', icon: 'success' })
        })
      },
    })
  },

  duplicateLine() {
    if (this.data.draftIsNew || !this.data.draft || this.data.saving) return
    const duplicate = { ...this.data.draft, id: '', code: '', status: 'pending' }
    this._draftIsCopy = true
    this.setDraft(duplicate, { isNew: true, isCopy: true, touched: true })
    safeToast('复制内容已打开为新线路，原线路未修改；请确认两端端口后保存')
  },

  saveCommand(command, onSuccess) {
    if (!this.projectId || !this.data.project || this.data.saving) return false
    this.invalidateExport(true)
    this.setData({ saving: true, saveError: '', formError: '', batchError: '' })
    let result
    try {
      result = saveProjectWiring(this.projectId, command, this._schedule.revision)
    } catch (error) {
      result = { ok: false, error: error && error.message ? error.message : '保存失败，请重试。' }
    }
    const handleResult = (response) => {
      if (this._destroyed) return
      if (!response || response.ok !== true || !response.schedule) {
        const error = response && response.error ? String(response.error) : '保存失败，请重试。'
        this.setData({
          saving: false,
          saveError: this.data.editorVisible ? error : '',
          batchError: this.data.batchVisible ? error : '',
        })
        if (!this.data.editorVisible && !this.data.batchVisible) safeToast(error)
        return
      }
      onSuccess(response)
    }
    if (result && typeof result.then === 'function') result.then(handleResult).catch((error) => handleResult({
      ok: false,
      error: error && error.message ? error.message : '保存失败，请重试。',
    }))
    else handleResult(result)
    return true
  },

  acceptSavedSchedule(result) {
    this._loadedSignature = ''
    this.applyLoadResult({
      ok: true,
      project: result.project || this.data.project,
      schedule: result.schedule,
    })
  },

  makeBatchDraft() {
    const from = this._schedule.lines.find((line) => line.fromDevice) || {}
    const to = this._schedule.lines.find((line) => line.toDevice) || {}
    return {
      count: '2',
      fromDevice: from.fromDevice || '',
      fromPrefix: 'OUT-',
      fromStart: '1',
      toDevice: to.toDevice || '',
      toPrefix: 'IN-',
      toStart: '1',
      purpose: '',
      spec: DEFAULT_AUDIO_SPEC,
      cableType: 'balanced',
      buildType: 'finished',
      connectorA: '',
      connectorB: '',
      lengthText: '',
    }
  },

  openBatch() {
    if (!this.data.project || this.data.loading) return
    this.beginFormKeyboardAvoidance('batch')
    this.invalidateExport(false)
    this._batchCommand = null
    this._batchDirty = false
    this._batchDefaultSpec = true
    const batchDraft = this.makeBatchDraft()
    this.setData({
      batchVisible: true,
      formScrollTop: 0,
      batchDraft,
      batchSpecOptions: getCableSpecOptions(batchDraft.cableType),
      batchSpecOptionViews: getCableSpecOptionViews(batchDraft.cableType),
      batchPreviewLines: [],
      batchPossibleDuplicates: [],
      batchDuplicateWarning: '',
      batchError: '',
      batchBuildIndex: optionIndex(BUILD_OPTIONS, batchDraft.buildType),
      batchCableIndex: optionIndex(CABLE_OPTIONS, batchDraft.cableType),
      batchConnectorAIndex: optionIndex(BATCH_CONNECTOR_OPTIONS, batchDraft.connectorA),
      batchConnectorBIndex: optionIndex(BATCH_CONNECTOR_OPTIONS, batchDraft.connectorB),
      saving: false,
    })
  },

  onBatchInput(event) {
    const field = event.currentTarget.dataset.field
    const allowed = new Set(['count', 'fromDevice', 'fromPrefix', 'fromStart', 'toDevice', 'toPrefix', 'toStart', 'purpose', 'spec', 'lengthText'])
    if (!allowed.has(field)) return
    if (field === 'spec') this._batchDefaultSpec = false
    this._batchDirty = true
    this.setData({
      batchDraft: { ...this.data.batchDraft, [field]: String(event.detail.value || '') },
      batchPreviewLines: [],
      batchPossibleDuplicates: [],
      batchDuplicateWarning: '',
      batchError: '',
    })
  },

  chooseBatchSpecPreset(event) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!this.data.batchDraft || !this.data.batchSpecOptions.includes(value)) return
    this.onBatchInput({ currentTarget: { dataset: { field: 'spec' } }, detail: { value } })
  },

  onBatchCableChange(event) {
    const index = Number(event.detail.value)
    if (!Number.isInteger(index) || !CABLE_OPTIONS[index]) return
    this._batchDirty = true
    const cableType = CABLE_OPTIONS[index].id
    const batchDraft = { ...this.data.batchDraft, cableType }
    if (this._batchDefaultSpec) batchDraft.spec = getDefaultSpec(cableType)
    this.setData({
      batchCableIndex: index,
      batchDraft,
      batchSpecOptions: getCableSpecOptions(cableType),
      batchSpecOptionViews: getCableSpecOptionViews(cableType),
      batchPreviewLines: [],
      batchPossibleDuplicates: [],
      batchDuplicateWarning: '',
      batchError: '',
    })
  },

  onBatchBuildChange(event) {
    const index = Number(event.detail.value)
    if (!Number.isInteger(index) || !BUILD_OPTIONS[index]) return
    this._batchDirty = true
    this.setData({
      batchBuildIndex: index,
      batchDraft: { ...this.data.batchDraft, buildType: BUILD_OPTIONS[index].id },
      batchPreviewLines: [],
      batchPossibleDuplicates: [],
      batchDuplicateWarning: '',
      batchError: '',
    })
  },

  onBatchConnectorChange(event) {
    const field = event.currentTarget.dataset.field
    const index = Number(event.detail.value)
    if (!['connectorA', 'connectorB'].includes(field) || !Number.isInteger(index) || !BATCH_CONNECTOR_OPTIONS[index]) return
    this._batchDirty = true
    const indexField = field === 'connectorA' ? 'batchConnectorAIndex' : 'batchConnectorBIndex'
    const customField = field === 'connectorA' ? 'batchCustomConnectorA' : 'batchCustomConnectorB'
    const customValue = this.data[customField] || ''
    const connectorValue = BATCH_CONNECTOR_OPTIONS[index].id === 'custom'
      ? customValue
      : BATCH_CONNECTOR_OPTIONS[index].id
    this.setData({
      [indexField]: index,
      [customField]: BATCH_CONNECTOR_OPTIONS[index].id === 'custom' ? customValue : '',
      batchDraft: { ...this.data.batchDraft, [field]: connectorValue },
      batchPreviewLines: [],
      batchPossibleDuplicates: [],
      batchDuplicateWarning: '',
      batchError: '',
    })
  },

  onBatchCustomConnectorInput(event) {
    const field = event.currentTarget.dataset.field
    if (!['connectorA', 'connectorB'].includes(field)) return
    const value = String(event.detail.value || '')
    const customField = field === 'connectorA' ? 'batchCustomConnectorA' : 'batchCustomConnectorB'
    this._batchDirty = true
    this.setData({
      [customField]: value,
      batchDraft: { ...this.data.batchDraft, [field]: value },
      batchPreviewLines: [],
      batchPossibleDuplicates: [],
      batchDuplicateWarning: '',
      batchError: '',
    })
  },

  buildBatchCommand() {
    const draft = this.data.batchDraft || this.makeBatchDraft()
    const line = {
      purpose: draft.purpose,
      fromDevice: draft.fromDevice,
      toDevice: draft.toDevice,
      buildType: draft.buildType,
      cableType: draft.cableType,
      spec: draft.spec,
      connectorA: draft.connectorA,
      connectorB: draft.connectorB,
      lengthText: draft.lengthText,
      status: 'pending',
      notes: '',
    }
    return {
      type: 'batch',
      line,
      count: Number(draft.count),
      fromPrefix: draft.fromPrefix,
      fromStart: draft.fromStart,
      toPrefix: draft.toPrefix,
      toStart: draft.toStart,
    }
  },

  refreshBatchPreview() {
    if (!this.data.batchVisible) return
    const command = this.buildBatchCommand()
    const result = applyScheduleChange(this._schedule, command)
    if (!result || result.ok !== true) {
      this._batchCommand = null
      this.setData({
        batchPreviewLines: [],
        batchPossibleDuplicates: [],
        batchDuplicateWarning: '',
        batchError: result && result.error ? result.error : '预览失败，请检查批量线路资料。',
      })
      return
    }
    const ids = new Set(result.lineIds || [])
    const preview = result.schedule.lines.filter((line) => ids.has(line.id)).map((line) => {
      const existingCodes = this._schedule.lines.filter((existing) => sameRouteEndpoints(existing, line)).map((existing) => existing.code)
      return {
        ...decorateLine(line),
        possibleDuplicateCodes: existingCodes.join('、'),
      }
    })
    const batchPossibleDuplicates = preview.filter((line) => line.possibleDuplicateCodes).map((line) => ({
      previewCode: line.code,
      existingCodes: line.possibleDuplicateCodes.split('、'),
      existingCodesText: line.possibleDuplicateCodes,
    }))
    const batchDuplicateWarning = batchPossibleDuplicates.length
      ? `有 ${batchPossibleDuplicates.length} 条预览线路的两端与已有布线一致；线号仍会独立生成，可继续添加。`
      : ''
    this._batchCommand = command
    this.setData({ batchPreviewLines: preview, batchPossibleDuplicates, batchDuplicateWarning, batchError: '' })
  },

  requestCloseBatch() {
    if (this.data.saving) return
    if (!this._batchDirty && !this.data.batchPreviewLines.length) {
      this.closeBatch()
      return
    }
    wx.showModal({
      title: '放弃批量线路？',
      content: '关闭后，当前端口设置和预览不会保存。',
      confirmText: '放弃',
      confirmColor: '#d70015',
      success: ({ confirm }) => {
        if (confirm && !this._destroyed) this.closeBatch()
      },
    })
  },

  closeBatch() {
    this.resetFormKeyboardAvoidance()
    this._batchCommand = null
    this._batchDirty = false
    this.setData({
      batchVisible: false,
      batchDraft: null,
      batchPreviewLines: [],
      batchPossibleDuplicates: [],
      batchDuplicateWarning: '',
      batchError: '',
      saving: false,
    })
  },

  commitBatch() {
    if (!this._batchCommand || !this.data.batchPreviewLines.length || this.data.saving) return
    this.saveCommand(this._batchCommand, (result) => {
      const count = result.lineIds ? result.lineIds.length : this.data.batchPreviewLines.length
      this.closeBatch()
      this.acceptSavedSchedule(result)
      wx.showToast({ title: `已添加 ${count} 条线路`, icon: 'success' })
    })
  },

  copyCurrentText() {
    if (!this.data.project || this._destroyed || typeof wx.setClipboardData !== 'function') return
    const text = buildScheduleText(this.data.project.name, this._schedule)
    const revision = this._schedule.revision
    wx.setClipboardData({
      data: text,
      success: () => {
        if (this._destroyed || revision !== this._schedule.revision) return
        safeToast('布线清单已复制')
      },
      fail: () => {
        if (!this._destroyed) safeToast('复制失败，请重试')
      },
    })
  },

  selectExportType(event) {
    const index = Number(event.detail.value)
    if (!Number.isInteger(index) || !EXPORT_TYPES[index]) return
    if (index === this.data.exportTypeIndex) return
    this.invalidateExport(true)
    this.setData({ exportTypeIndex: index, reportImages: [], reportImagePath: '', reportPreviewVisible: false })
  },

  invalidateExport(clearImages) {
    const wasRunning = Boolean(this._reportSaveJob)
    this.cancelReportSaveJob()
    const wasPending = Boolean(this._reportPending)
    this._reportRevision = (this._reportRevision || 0) + 1
    this._reportPending = false
    if (wasPending) {
      if (typeof wx !== 'undefined' && typeof wx.hideLoading === 'function') wx.hideLoading()
    }
    const changes = {
      reportPreviewVisible: false,
      reportSaveRunning: false,
      reportSaveInFlight: Boolean(this._reportSaveInFlight),
    }
    if (!clearImages && (wasRunning || this._reportSaveInFlight)) {
      changes.reportSaveMessage = this.getInactiveReportSaveMessage()
    }
    if (clearImages) {
      this._reportSignature = ''
      if (this._reportSavedPages) this._reportSavedPages.clear()
      changes.reportImages = []
      changes.reportImagePath = ''
      changes.reportSavedPageIndices = []
      changes.reportSaveMessage = ''
      changes.reportSaveError = ''
      changes.reportSaveAllLabel = '保存全部0张'
    }
    if (this.data && !this._destroyed) this.setData(changes)
  },

  generateExport(typeOverride = '') {
    if (!this.data.project || !this._schedule.lines.length || this.data.loading || this.data.saving) {
      safeToast(this.data.project ? '请先添加线路，再导出图片' : '当前项目不可用')
      return
    }
    const selectedType = EXPORT_TYPES[this.data.exportTypeIndex] && EXPORT_TYPES[this.data.exportTypeIndex].id
    const type = EXPORT_TYPES.some((option) => option.id === typeOverride)
      ? typeOverride
      : (selectedType || 'lines')
    const expectedProjectId = this.projectId
    const expectedScheduleRevision = this._schedule.revision
    const signature = `${expectedProjectId}:${expectedScheduleRevision}:${type}`
    if (signature === this._reportSignature && this.data.reportImages.length) {
      this.syncReportSaveView()
      this.showReportPage(0)
      return
    }
    let reportModule
    try {
      reportModule = require('./report')
    } catch (error) {
      safeToast('图片报告模块暂不可用')
      return
    }
    if (!reportModule || typeof reportModule.buildScheduleReportPages !== 'function'
      || typeof reportModule.drawScheduleReport !== 'function') {
      safeToast('图片报告模块暂不可用')
      return
    }
    if (typeof wx.createCanvasContext !== 'function' || typeof wx.canvasToTempFilePath !== 'function') {
      safeToast('当前微信版本暂不支持生成图片')
      return
    }
    let report
    try {
      report = reportModule.buildScheduleReportPages(this.data.project.name, this._schedule, type)
    } catch (error) {
      safeToast('图片清单生成失败，请重试')
      return
    }
    const pages = report && Array.isArray(report.pages) ? report.pages : []
    if (!pages.length) {
      safeToast('暂无线路可导出')
      return
    }
    this.invalidateExport(true)
    const revision = this._reportRevision
    const pageImages = []
    const isCurrent = () => !this._destroyed && !this._hidden && this._reportRevision === revision
      && this.projectId === expectedProjectId
      && this._schedule.revision === expectedScheduleRevision
      && !this.data.editorVisible && !this.data.batchVisible
    this._reportPending = true
    if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成图片', mask: true })

    const finish = (error) => {
      if (!isCurrent()) return
      this._reportPending = false
      if (typeof wx.hideLoading === 'function') wx.hideLoading()
      if (error) {
        this.setData({ reportImages: [], reportImagePath: '', reportPreviewVisible: false })
        safeToast(error)
        return
      }
      this._reportSignature = signature
      this.setData({
        reportImages: pageImages,
        reportPageIndex: 0,
        reportSaveMessage: '',
        reportSaveError: '',
      }, () => {
        this.syncReportSaveView()
        this.showReportPage(0)
      })
    }

    const exportPage = (index) => {
      if (!isCurrent()) return
      if (index >= pages.length) {
        finish('')
        return
      }
      const page = pages[index]
      const width = Number(page.width) || 720
      const height = Number(page.height) || 400
      this.setData({ reportCanvasWidth: width, reportCanvasHeight: height }, () => {
        if (!isCurrent()) return
        try {
          const context = wx.createCanvasContext(REPORT_CANVAS_ID, this)
          reportModule.drawScheduleReport(context, page, { theme: 'light' })
          context.draw(false, () => {
            if (!isCurrent()) return
            wx.canvasToTempFilePath({
              canvasId: REPORT_CANVAS_ID,
              x: 0,
              y: 0,
              width,
              height,
              destWidth: width * 2,
              destHeight: height * 2,
              fileType: 'png',
              quality: 1,
              success: ({ tempFilePath }) => {
                if (!isCurrent()) return
                if (!tempFilePath) {
                  finish('图片生成失败，请重试')
                  return
                }
                pageImages.push({ path: tempFilePath, title: page.title || report.title || '布线清单' })
                exportPage(index + 1)
              },
              fail: () => {
                if (isCurrent()) finish('图片生成失败，请重试')
              },
            }, this)
          })
        } catch (error) {
          if (isCurrent()) finish('图片生成失败，请重试')
        }
      })
    }
    exportPage(0)
  },

  showReportPage(index) {
    const item = this.data.reportImages[index]
    if (!item) return
    this.setData({
      reportPageIndex: index,
      reportPageTitle: item.title,
      reportImagePath: item.path,
      reportPreviewVisible: true,
    })
    this.syncReportSaveView()
  },

  previousReportPage() {
    if (this.data.reportPageIndex <= 0) return
    this.showReportPage(this.data.reportPageIndex - 1)
  },

  nextReportPage() {
    if (this.data.reportPageIndex >= this.data.reportImages.length - 1) return
    this.showReportPage(this.data.reportPageIndex + 1)
  },

  closeReportPreview() {
    const wasRunning = Boolean(this._reportSaveJob)
    this.cancelReportSaveJob()
    this.setData({
      reportPreviewVisible: false,
      reportSaveRunning: false,
      reportSaveInFlight: Boolean(this._reportSaveInFlight),
      ...(wasRunning || this._reportSaveInFlight
        ? { reportSaveMessage: this.getInactiveReportSaveMessage() }
        : {}),
    })
  },

  previewReportImage() {
    const urls = this.data.reportImages.map((image) => image.path).filter(Boolean)
    if (!this.data.reportImagePath || !urls.length || typeof wx.previewImage !== 'function') return
    wx.previewImage({ current: this.data.reportImagePath, urls })
  },

  saveReportImage() {
    this.startReportSaveJob([this.data.reportPageIndex], 'single')
  },

  getReportSavedPageSet(signature = this._reportSignature) {
    if (!signature) return new Set()
    if (!this._reportSavedPages) this._reportSavedPages = new Map()
    if (!this._reportSavedPages.has(signature)) this._reportSavedPages.set(signature, new Set())
    return this._reportSavedPages.get(signature)
  },

  syncReportSaveView(extra = {}) {
    if (!this.data || this._destroyed) return
    const total = this.data.reportImages.length
    const saved = this.getReportSavedPageSet()
    const reportSavedPageIndices = [...saved].filter((index) => index >= 0 && index < total).sort((a, b) => a - b)
    const remaining = Math.max(0, total - reportSavedPageIndices.length)
    const reportSaveAllLabel = total > 0 && remaining === 0
      ? `全部已保存${total}张`
      : (reportSavedPageIndices.length ? `继续保存剩余${remaining}张` : `保存全部${total}张`)
    const currentMessage = String(this.data.reportSaveMessage || '')
    const staleActivityMessage = /^(准备保存|正在保存第|图片保存正在进行|当前图片保存请求仍在处理中|已停止后续保存；当前页请求无法取消|已停止后续请求)/.test(currentMessage)
    const reportSaveMessage = !this._reportSaveJob && staleActivityMessage
      ? this.getInactiveReportSaveMessage()
      : currentMessage
    this.setData({
      reportSavedPageIndices,
      reportSaveAllLabel,
      reportSaveInFlight: Boolean(this._reportSaveInFlight),
      reportSaveMessage,
      ...extra,
    })
  },

  getInactiveReportSaveMessage() {
    if (this._reportSaveInFlight) {
      return '已停止后续请求；当前图片保存无法取消，仍可能完成。完成后可继续。'
    }
    const total = this.data && Array.isArray(this.data.reportImages) ? this.data.reportImages.length : 0
    const saved = this.getReportSavedPageSet().size
    const remaining = Math.max(0, total - saved)
    if (!remaining) return `已保存 ${saved} / ${total} 张。`
    return `已停止后续请求；已保存 ${saved} / ${total} 张，可继续保存剩余 ${remaining} 张。`
  },

  isCurrentReportSaveJob(job) {
    return Boolean(job && this._reportSaveJob === job && !job.cancelled && !this._destroyed && !this._hidden
      && this._reportSignature === job.signature && this._reportRevision === job.reportRevision
      && this.data.reportPreviewVisible && !this.data.editorVisible && !this.data.batchVisible)
  },

  cancelReportSaveJob() {
    const job = this._reportSaveJob
    if (!job) return
    job.cancelled = true
    this._reportSaveJob = null
    this._reportSaveJobRevision = (this._reportSaveJobRevision || 0) + 1
  },

  saveReportImageFailureMessage(error) {
    const message = String(error && (error.errMsg || error.message) || '')
    if (/auth|authorize|permission|deny/i.test(message)) {
      return '保存权限未开启。请在微信设置中允许保存到相册，再点“继续保存”重试。'
    }
    if (/cancel/i.test(message)) return '保存已取消；已完成的图片仍保留，可继续保存剩余页。'
    return `保存失败${message ? `：${message}` : '，请重试'}；已完成的图片仍保留，可继续保存剩余页。`
  },

  startReportSaveJob(indices, mode) {
    if (!this.data.reportPreviewVisible || !this.data.reportImages.length || !this._reportSignature) return
    if (this._reportSaveJob || this._reportSaveInFlight) {
      this.syncReportSaveView({
        reportSaveMessage: this._reportSaveJob
          ? (this._reportSaveInFlight ? '当前图片保存请求仍在处理中，完成后可继续。' : '图片保存正在进行。')
          : this.getInactiveReportSaveMessage(),
      })
      return
    }
    if (typeof wx.saveImageToPhotosAlbum !== 'function') {
      this.syncReportSaveView({ reportSaveError: '当前微信版本暂不支持保存图片。' })
      return
    }
    const signature = this._reportSignature
    const saved = this.getReportSavedPageSet(signature)
    const uniqueIndices = [...new Set(indices)].filter((index) => Number.isInteger(index)
      && index >= 0 && index < this.data.reportImages.length)
    const queue = mode === 'single' ? uniqueIndices : uniqueIndices.filter((index) => !saved.has(index))
    if (!queue.length) {
      this.syncReportSaveView({
        reportSaveMessage: mode === 'single' ? '当前页已保存。' : '当前报告所有图片都已保存。',
        reportSaveError: '',
      })
      return
    }
    const job = {
      id: ++this._reportSaveJobRevision,
      signature,
      savedSet: saved,
      reportRevision: this._reportRevision,
      queue,
      position: 0,
      mode,
      cancelled: false,
    }
    this._reportSaveJob = job
    this.syncReportSaveView({
      reportSaveRunning: true,
      reportSaveError: '',
      reportSaveMessage: `准备保存 ${queue.length} 张图片…`,
    })
    this.runNextReportSavePage(job)
  },

  runNextReportSavePage(job) {
    if (!this.isCurrentReportSaveJob(job)) return
    if (job.position >= job.queue.length) {
      const savedCount = this.getReportSavedPageSet(job.signature).size
      this._reportSaveJob = null
      this.syncReportSaveView({
        reportSaveRunning: false,
        reportSaveError: '',
        reportSaveMessage: `已保存 ${savedCount} / ${this.data.reportImages.length} 张。`,
      })
      return
    }
    const index = job.queue[job.position]
    const image = this.data.reportImages[index]
    if (!image || !image.path) {
      this._reportSaveJob = null
      this.syncReportSaveView({
        reportSaveRunning: false,
        reportSaveError: `第 ${index + 1} 张没有可保存的图片路径；可继续重试。`,
      })
      return
    }
    const request = { job, index, done: false }
    this._reportSaveInFlight = request
    this.syncReportSaveView({ reportSaveInFlight: true, reportSaveMessage: `正在保存第 ${index + 1} / ${this.data.reportImages.length} 张…` })
    const finish = (error) => {
      if (request.done) return
      request.done = true
      if (this._reportSaveInFlight === request) this._reportSaveInFlight = null
      if (!error && this._reportSignature === job.signature
        && this.getReportSavedPageSet(job.signature) === job.savedSet) job.savedSet.add(index)
      if (!this.isCurrentReportSaveJob(job)) return
      if (error) {
        this._reportSaveJob = null
        this.syncReportSaveView({
          reportSaveRunning: false,
          reportSaveError: this.saveReportImageFailureMessage(error),
          reportSaveMessage: `已保存 ${this.getReportSavedPageSet(job.signature).size} / ${this.data.reportImages.length} 张。`,
        })
        return
      }
      job.position += 1
      this.syncReportSaveView({ reportSaveInFlight: false })
      this.runNextReportSavePage(job)
    }
    try {
      wx.saveImageToPhotosAlbum({
        filePath: image.path,
        success: () => finish(null),
        fail: (error) => finish(error || { errMsg: '保存失败，请重试' }),
      })
    } catch (error) {
      finish(error || { errMsg: '保存失败，请重试' })
    }
  },

  saveAllReportImages() {
    this.startReportSaveJob(this.data.reportImages.map((_, index) => index), 'all')
  },

  stopReportSaveJob() {
    if (!this._reportSaveJob) return
    this.cancelReportSaveJob()
    const message = this._reportSaveInFlight
      ? '已停止后续保存；当前页请求无法取消，可能仍会保存。完成后可继续。'
      : '已停止保存，可继续保存剩余图片。'
    this.syncReportSaveView({
      reportSaveRunning: false,
      reportSaveError: '',
      reportSaveMessage: message,
    })
  },

  shareReportImage() {
    shareGeneratedImage(this.data.reportImagePath)
  },

  stopEvent() {},
  preventTouchMove() {},
})

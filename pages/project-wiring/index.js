let markToolLoadStage = () => false
try {
  const performanceProbe = require('../../utils/performance')
  if (typeof performanceProbe.markToolLoadStage === 'function') {
    markToolLoadStage = (route, phase) => {
      try { return performanceProbe.markToolLoadStage(route, phase) } catch (error) { return false }
    }
  }
  markToolLoadStage('/pages/project-wiring/index', 'module')
} catch (error) {}

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
  getProjectWiring,
  getProjects,
  saveProjectWiring,
} = require('../../utils/records')
const { shareGeneratedImage } = require('../../utils/report-image-actions')
const { vibrate } = require('../../utils/haptics')
const { isPerformanceMeasurementEnabled, startMeasurement } = require('../../utils/performance')

const CONNECTOR_PICKER_OPTIONS = [{ id: '', label: '待确认' }, ...CONNECTOR_OPTIONS]
const CUSTOM_CONNECTOR_INDEX = CONNECTOR_PICKER_OPTIONS.findIndex((option) => option.id === 'custom')
const BATCH_CONNECTOR_OPTIONS = CONNECTOR_PICKER_OPTIONS
const EXPORT_TYPES = [
  { id: 'lines', label: '线路表' },
  { id: 'materials', label: '材料表' },
  { id: 'labels', label: '双端线号' },
  { id: 'project', label: '接线清单' },
]
const {
  createLineEditor,
  DEFAULT_AUDIO_SPEC,
  ROUTE_ENDPOINT_FIELDS,
  optionIndex,
  getCableSpecOptions,
  getDefaultSpec,
  getCableSpecOptionViews,
  safeToast,
} = require('./line-editor')
const { createDeviceEditor } = require('./device-editor')

function optionLabel(options, id, fallback = '待确认') {
  const option = options.find((item) => item.id === id)
  return option ? option.label : (id || fallback)
}

function sameRouteEndpoints(left, right) {
  return ROUTE_ENDPOINT_FIELDS.every((field) => String(left && left[field] || '').trim() === String(right && right[field] || '').trim())
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

const pageDefinition = {
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
        if (!this._hidden) vibrate('medium')
        safeToast('布线清单已复制')
      },
      fail: () => {
        if (!this._destroyed) safeToast('复制失败，请重试')
      },
    })
  },

  stopEvent() {},
  preventTouchMove() {},
}

const { createWorkspaceUI } = require('./workspace-ui')
const { createReportController } = require('./report-controller')
const { createPageLifecycle } = require('./page-lifecycle')

const workspaceUI = createWorkspaceUI(pageDefinition)
const editorDependencies = { applyScheduleChange, saveProjectWiring }
const deviceEditor = createDeviceEditor(pageDefinition, editorDependencies)
const lineEditor = createLineEditor(pageDefinition, editorDependencies)

Page({
  ...pageDefinition,
  ...workspaceUI,
  ...deviceEditor,
  ...lineEditor,
  ...createReportController({ exportTypes: EXPORT_TYPES, safeToast, vibrate, shareGeneratedImage }),
  ...createPageLifecycle({
    emptySchedule,
    resetFormKeyboardAvoidance: pageDefinition.resetFormKeyboardAvoidance,
    isPerformanceMeasurementEnabled,
    startMeasurement,
    markToolLoadStage,
  }),
})

const { drawAndExportReport } = require('../../utils/report-canvas')
const { getExportDimensions } = require('../../utils/report-drawing')
const {
  previewGeneratedImage,
  shareGeneratedImage,
} = require('../../utils/report-image-actions')
const {
  REPORT_WIDTH,
  buildReportPayload,
  getProjectReportSections,
  getReportSourceFingerprint,
  loadProjectReportSource,
  summarizeSelection,
} = require('./report-model')
const { drawReportPage } = require('./report-renderer')
const {
  REPORT_SEGMENT_HEIGHT,
  buildReportImageTasks,
  splitTaskIntoSegments,
} = require('./report-snapshot-adapter')
const {
  saveErrorNeedsSettings,
  saveReportPages,
  saveWxImageToAlbum,
} = require('./report-actions')

const BRIDGE_RETURN_SETTLE_MS = 500
const CANVAS_ID = 'projectReportExportCanvas'

function prepareReportImagePlan(items, projectName, measureContext) {
  const errors = {}
  const tasksById = {}
  const bridges = { audioWiring: [], projectWiring: [] }
  items.forEach((item) => {
    let result
    try { result = buildReportImageTasks(item, projectName, measureContext) } catch (error) {
      errors[item.id] = error?.message || '此项原生图片排版失败。'
      return
    }
    if (!result?.ok) errors[item.id] = result?.error || '此项无法生成原生工具图片。'
    else if (!result.bridge && (!Array.isArray(result.tasks) || !result.tasks.length)) errors[item.id] = '此项没有生成完整工具图片。'
    else if (result.bridge === 'audioWiring') bridges.audioWiring.push(item)
    else if (result.bridge === 'projectWiring') bridges.projectWiring.push(item)
    else tasksById[item.id] = result.tasks
  })
  return { errors, tasksById, bridges }
}

function asSelectionSections(source, selectedIds = [], extraErrors = {}) {
  const selected = new Set(selectedIds)
  const items = getProjectReportSections(source).flatMap((section) => section.items)
  const errors = extraErrors || {}
  return getProjectReportSections(source).map((section) => ({
    key: section.key,
    title: section.title,
    items: section.items.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      checked: selected.has(item.id),
      imageError: errors[item.id] || '',
    })),
  }))
}

Page({
  data: {
    project: null,
    selectionSections: [],
    selectedItemIds: [],
    selectedCount: 0,
    totalCount: 0,
    allSelected: false,
    hasSelection: false,
    isLoading: true,
    pageError: '',
    mode: 'select',
    isGenerating: false,
    renderProgressText: '',
    pageStatus: '',
    reportPages: [],
    currentPageIndex: 0,
    currentPageNumber: 1,
    currentPagePath: '',
    pageCount: 0,
    previewScrollTop: 0,
    reportCanvasWidth: REPORT_WIDTH,
    reportCanvasHeight: 1000,
    isSaving: false,
    savedPageIndexes: [],
    saveProgressText: '',
    saveButtonText: '保存全部页面',
  },

  onLoad(options = {}) {
    this.projectId = typeof options.id === 'string' ? options.id : ''
    this._unloaded = false
    this._reportRevision = 0
    this._reportPages = []
    this._bridgeResults = {}
    this._pendingBridgeResult = null
    this._saveRevision = 0
    this.loadSource()
  },

  onShow() {
    const active = this._activeReportBridge
    if (!active || !active.routeOpened) return
    active.parentReturned = true
    this.tryApplyPendingReportBridgeResult(active)
    if (this._activeReportBridge === active && !this._pendingBridgeResult && active.childReady) {
      // A native back gesture can unload the bridge before its event-channel result
      // arrives. The child also reports cancellation from onUnload; this is a safe
      // fallback that never advances to another route or opens a partial report.
      this.cancelReportGeneration()
    }
  },

  onUnload() {
    this._unloaded = true
    this.cancelActiveReportBridge()
    this._reportRevision = (this._reportRevision || 0) + 1
    this._saveRevision = (this._saveRevision || 0) + 1
    this._saveSignature = ''
  },

  cancelActiveReportBridge() {
    const active = this._activeReportBridge
    this._pendingBridgeResult = null
    if (!active) return
    if (active.returnTimer != null) {
      clearTimeout(active.returnTimer)
      active.returnTimer = null
    }
    active.channel?.emit('cancel-report', { ticket: active.ticket })
    this._activeReportBridge = null
  },

  createReportMeasureContext() {
    if (typeof wx === 'undefined' || typeof wx.createCanvasContext !== 'function') return null
    try {
      const context = wx.createCanvasContext(CANVAS_ID, this)
      return context && typeof context.measureText === 'function' ? context : null
    } catch (_) {
      return null
    }
  },

  loadSource(options = {}) {
    this.invalidateReportSave()
    const previousSelectedIds = options.preserveSelection && Array.isArray(this.data.selectedItemIds)
      ? [...this.data.selectedItemIds]
      : null
    this.setData({ isLoading: true, pageError: '', mode: 'select' })
    const source = loadProjectReportSource(this.projectId)
    if (!source.ok) {
      this.reportSource = null
      this._sourceFingerprint = ''
      this.reportSignature = ''
      this._reportPages = []
      this.setData({
        isLoading: false,
        pageError: source.error,
        reportPages: [],
        currentPagePath: '',
        pageCount: 0,
        selectionSections: [],
        selectedItemIds: previousSelectedIds || [],
      })
      return
    }
    this.reportSource = source
    const sections = getProjectReportSections(source)
    const allIds = sections.flatMap((section) => section.items.map((item) => item.id))
    const selectedSet = new Set(previousSelectedIds || [])
    const selectedIds = previousSelectedIds === null ? allIds : allIds.filter((id) => selectedSet.has(id))
    this._sourceFingerprint = getReportSourceFingerprint(source)
    this.reportSignature = ''
    this._reportPages = []
    this.setData({
      project: source.project,
      selectionSections: asSelectionSections(source, selectedIds),
      selectedItemIds: selectedIds,
      ...summarizeSelection(sections, selectedIds),
      isLoading: false,
      pageError: '',
      reportPages: [],
      currentPagePath: '',
      pageCount: 0,
      pageStatus: '',
      savedPageIndexes: [],
    })
  },

  retryLoadSource() {
    this.loadSource({ preserveSelection: true })
  },

  backToSelection() {
    if (this.data.mode !== 'preview') return
    const stoppedSaveText = this.invalidateReportSave('已返回选择。')
    this.setData({
      mode: 'select',
      pageStatus: stoppedSaveText || '已返回选择，原选择仍保留。',
    })
  },

  stopEvent() {},

  updateSelection(selectedIds) {
    this.invalidateReportSave()
    const sections = getProjectReportSections(this.reportSource)
    this.reportSignature = ''
    this._reportPages = []
    this.setData({
      selectedItemIds: selectedIds,
      selectionSections: asSelectionSections(this.reportSource, selectedIds),
      ...summarizeSelection(sections, selectedIds),
      reportPages: [],
      currentPagePath: '',
      currentPageIndex: 0,
      pageCount: 0,
      pageStatus: '',
      savedPageIndexes: [],
      saveProgressText: '',
    })
  },

  toggleReportItem(event) {
    const id = event.currentTarget.dataset.id
    if (!id || !this.reportSource) return
    const selected = new Set(this.data.selectedItemIds)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    const allIds = getProjectReportSections(this.reportSource).flatMap((section) => section.items.map((item) => item.id))
    this.updateSelection(allIds.filter((itemId) => selected.has(itemId)))
  },

  toggleAllReportItems() {
    if (!this.reportSource) return
    const allIds = getProjectReportSections(this.reportSource).flatMap((section) => section.items.map((item) => item.id))
    this.updateSelection(this.data.allSelected ? [] : allIds)
  },

  generateReport() {
    if (!this.reportSource || this.data.isGenerating || !this.data.hasSelection) return
    if (!this.refreshSourceForGeneration()) return
    this.invalidateReportSave()
    const selectedIds = [...this.data.selectedItemIds]
    const signature = JSON.stringify({
      source: this._sourceFingerprint,
      selectedIds: [...selectedIds].sort(),
    })
    if (this.reportSignature === signature && this._reportPages.length) {
      this.setData({
        mode: 'preview',
        currentPageIndex: 0,
        currentPageNumber: 1,
        currentPagePath: this._reportPages[0].path,
        pageCount: this._reportPages.length,
        previewScrollTop: 0,
      })
      return
    }
    const payload = buildReportPayload(this.reportSource, selectedIds)
    if (!payload?.pages?.length) {
      wx.showToast({ title: '请至少选择一项报告内容', icon: 'none' })
      return
    }
    if (typeof wx.createCanvasContext !== 'function' || typeof wx.canvasToTempFilePath !== 'function') {
      wx.showToast({ title: '当前微信版本暂不支持生成报告图片', icon: 'none' })
      return
    }

    const measureContext = this.createReportMeasureContext()
    const imagePlan = prepareReportImagePlan(payload.selectedItems || [], payload.project?.name || '', measureContext)
    const selectedErrors = Object.fromEntries(selectedIds
      .filter((id) => imagePlan.errors[id])
      .map((id) => [id, imagePlan.errors[id]]))
    if (Object.keys(selectedErrors).length) {
      this.setData({
        selectionSections: asSelectionSections(this.reportSource, selectedIds, selectedErrors),
        mode: 'select',
        pageStatus: `有 ${Object.keys(selectedErrors).length} 项无法按保存快照生成原生工具图片。请取消勾选标红项后重试。`,
      })
      wx.showToast({ title: '请先取消勾选无法生成图片的项目', icon: 'none' })
      return
    }

    this._reportRevision = (this._reportRevision || 0) + 1
    const revision = this._reportRevision
    this._buildingPayload = payload
    this._buildingImagePlan = imagePlan
    this._buildingPages = payload.pages
    this._renderedPages = []
    this._buildingSignature = signature
    this._bridgeSequence = ['audioWiring', 'projectWiring'].filter((key) => imagePlan.bridges[key].length)
    this._bridgeIndex = 0
    this._bridgeResults = {}
    this._imageQueue = null
    this.setData({
      mode: 'rendering',
      isGenerating: true,
      renderProgressText: `正在生成报告文字页：第 1 / ${payload.pages.length} 页`,
      pageStatus: '',
      reportCanvasWidth: REPORT_WIDTH,
      reportCanvasHeight: payload.pages[0].height,
    }, () => this.renderReportPage(0, revision))
  },

  refreshSourceForGeneration() {
    const refreshed = loadProjectReportSource(this.projectId)
    if (!refreshed.ok) {
      this.reportSource = null
      this._sourceFingerprint = ''
      this.reportSignature = ''
      this._reportPages = []
      this.setData({
        mode: 'select',
        pageError: refreshed.error,
        reportPages: [],
        currentPagePath: '',
        pageCount: 0,
        savedPageIndexes: [],
        saveProgressText: '',
        saveButtonText: '保存全部页面',
      })
      return false
    }

    const sections = getProjectReportSections(refreshed)
    const availableIds = sections.flatMap((section) => section.items.map((item) => item.id))
    const available = new Set(availableIds)
    const selectedIds = this.data.selectedItemIds.filter((id) => available.has(id))
    const selectionChanged = selectedIds.length !== this.data.selectedItemIds.length
    const sourceChanged = getReportSourceFingerprint(refreshed) !== this._sourceFingerprint
    this.reportSource = refreshed
    this._sourceFingerprint = getReportSourceFingerprint(refreshed)
    if (sourceChanged || selectionChanged) {
      this.reportSignature = ''
      this._reportPages = []
      this.setData({
        mode: 'select',
        pageError: '',
        selectionSections: asSelectionSections(refreshed, selectedIds),
        selectedItemIds: selectedIds,
        ...summarizeSelection(sections, selectedIds),
        reportPages: [],
        currentPageIndex: 0,
        currentPageNumber: 1,
        currentPagePath: '',
        pageCount: 0,
        savedPageIndexes: [],
        saveProgressText: '',
        saveButtonText: '保存全部页面',
        pageStatus: selectionChanged
          ? '项目内容有变化，已移除无法找到的内容并刷新候选。请检查选择后重新生成。'
          : '项目内容有变化，候选已刷新。请检查选择后重新生成。',
      })
      return false
    }
    this.setData({ pageError: '' })
    return true
  },

  renderReportPage(index, revision) {
    if (this._unloaded || revision !== this._reportRevision) return
    const pages = this._buildingPages || []
    const payload = this._buildingPayload
    if (!payload || index >= pages.length) return
    const page = pages[index]
    this.setData({
      reportCanvasWidth: page.width,
      reportCanvasHeight: page.height,
      renderProgressText: `正在生成报告文字页：第 ${index + 1} / ${pages.length} 页`,
    }, () => {
      if (this._unloaded || revision !== this._reportRevision) return
      try {
        drawAndExportReport(this, {
          canvasId: CANVAS_ID,
          isCurrent: () => !this._unloaded && this._reportRevision === revision,
          width: page.width,
          height: page.height,
          draw: (context) => drawReportPage(context, page, payload.project),
          getExportOptions: () => getExportDimensions(page.height),
          startExportMeasurement: () => () => {},
          onSuccess: (path) => {
            if (this._unloaded || this._reportRevision !== revision) return
            this._renderedPages.push({ path, width: page.width, height: page.height, pageNumber: index + 1 })
            if (index + 1 < pages.length) {
              this.renderReportPage(index + 1, revision)
              return
            }
            this.renderNextReportBridge(revision)
          },
          onFailure: () => this.failReportGeneration(revision, index),
        })
      } catch (error) {
        this.failReportGeneration(revision, index)
      }
    })
  },

  renderNextReportBridge(revision) {
    if (this._unloaded || revision !== this._reportRevision) return
    const bridge = this._bridgeSequence?.[this._bridgeIndex]
    if (!bridge) {
      this.prepareReportImageQueue(revision)
      return
    }
    const items = this._buildingImagePlan?.bridges?.[bridge] || []
    if (!items.length) {
      this.failReportGeneration(revision, this._buildingPages?.length || 0, {
        message: `未能读取${bridge === 'audioWiring' ? '接线' : '项目线路'}图片的冻结快照。`,
        errors: Object.fromEntries(items.map((item) => [item.id, '缺少图片生成快照。'])),
      })
      return
    }
    const ticket = `${revision}:${bridge}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    const active = {
      ticket,
      bridge,
      revision,
      channel: null,
      childReady: false,
      payloadSent: false,
      routeOpened: true,
      parentReturned: false,
      backComplete: false,
      items,
    }
    this._activeReportBridge = active
    const route = bridge === 'audioWiring'
      ? '/pages/audio-wiring/report-bridge'
      : '/pages/project-wiring/report-bridge'
    const url = `${route}?ticket=${encodeURIComponent(ticket)}&revision=${revision}`
    this.setData({
      renderProgressText: `正在启动${bridge === 'audioWiring' ? '接线' : '项目线路'}原生图片：${items.length} 项`,
    }, () => {
      if (this._unloaded || revision !== this._reportRevision || this._activeReportBridge !== active) return
      wx.navigateTo({
        url,
        events: {
          'report-bridge-ready': (ready) => this.handleReportBridgeReady(ready, active),
          'report-bridge-result': (bridgeResult) => this.handleReportBridgeResult(bridgeResult, active),
          'report-bridge-back-complete': (bridgeReturn) => this.handleReportBridgeBackComplete(bridgeReturn, active),
        },
        success: (result) => {
          if (this._unloaded || revision !== this._reportRevision || this._activeReportBridge !== active) {
            result?.eventChannel?.emit('cancel-report', { ticket })
            return
          }
          const channel = result?.eventChannel
          if (!channel || typeof channel.emit !== 'function') {
            this._activeReportBridge = null
            this.failReportGeneration(revision, this._buildingPages?.length || 0, {
              items,
              message: '当前环境无法接收分包原生图片结果。',
              errors: Object.fromEntries(items.map((item) => [item.id, '未能接收分包原生图片。'])),
            })
            return
          }
          active.channel = channel
          this.sendReportBridgePayload(active)
        },
        fail: (error) => {
          if (this._activeReportBridge !== active || revision !== this._reportRevision) return
          this._activeReportBridge = null
          this.failReportGeneration(revision, this._buildingPages?.length || 0, {
            items,
            message: '分包原生图片页面无法打开。',
            errors: Object.fromEntries(items.map((item) => [item.id, '原生图片生成页面无法打开。'])),
          })
        },
      })
    })
  },

  handleReportBridgeReady(ready, active) {
    if (this._unloaded || this._activeReportBridge !== active
      || active.revision !== this._reportRevision || ready?.bridge !== active.bridge) return
    active.childReady = true
    this.sendReportBridgePayload(active)
  },

  sendReportBridgePayload(active) {
    if (this._unloaded || this._activeReportBridge !== active || active.payloadSent
      || !active.childReady || !active.channel || active.revision !== this._reportRevision) return
    const selectedSchedule = this._buildingPayload?.selectedSchedule || { devices: [], lines: [] }
    const payload = {
      bridge: active.bridge,
      ticket: active.ticket,
      fingerprint: this._sourceFingerprint,
      revision: active.revision,
      projectName: this._buildingPayload?.project?.name || '',
      items: active.items,
      schedule: active.bridge === 'projectWiring' ? selectedSchedule : undefined,
    }
    active.payloadSent = true
    active.channel.emit('generate-report', payload)
  },

  handleReportBridgeResult(result, active) {
    const isPrePayloadCancel = Boolean(result?.cancelled && result.ticket === active.ticket
      && result.bridge === active.bridge && result.revision === active.revision
      && !result.fingerprint)
    if (this._unloaded || this._activeReportBridge !== active
      || active.revision !== this._reportRevision || !result
      || result.ticket !== active.ticket || result.bridge !== active.bridge
      || (!isPrePayloadCancel && result.fingerprint !== this._sourceFingerprint)
      || result.revision !== active.revision) return
    if (this._pendingBridgeResult) return
    // The bridge emits before navigateBack. Keep its result until both the parent has
    // returned to the foreground and the child's navigateBack.complete callback ran.
    this._pendingBridgeResult = {
      result: isPrePayloadCancel ? { ...result, fingerprint: this._sourceFingerprint } : result,
      active,
    }
    this.tryApplyPendingReportBridgeResult(active)
  },

  handleReportBridgeBackComplete(bridgeReturn, active) {
    if (this._unloaded || this._activeReportBridge !== active
      || active.revision !== this._reportRevision || !bridgeReturn
      || bridgeReturn.ticket !== active.ticket || bridgeReturn.bridge !== active.bridge
      || bridgeReturn.revision !== active.revision
      || (bridgeReturn.fingerprint && bridgeReturn.fingerprint !== this._sourceFingerprint)) return
    active.backComplete = true
    this.tryApplyPendingReportBridgeResult(active)
  },

  tryApplyPendingReportBridgeResult(active) {
    const pending = this._pendingBridgeResult
    if (!pending || pending.active !== active || !active.parentReturned) return
    if (pending.result.cancelled) {
      if (active.returnTimer != null) {
        clearTimeout(active.returnTimer)
        active.returnTimer = null
      }
      this._pendingBridgeResult = null
      this.applyReportBridgeResult(pending.result, active)
      return
    }
    if (!active.backComplete || active.returnTimer != null) return
    active.returnTimer = setTimeout(() => {
      active.returnTimer = null
      if (this._unloaded || this._reportRevision !== active.revision
        || this._activeReportBridge !== active || this._pendingBridgeResult !== pending
        || !active.parentReturned || !active.backComplete) return
      this._pendingBridgeResult = null
      this.applyReportBridgeResult(pending.result, active)
    }, BRIDGE_RETURN_SETTLE_MS)
  },

  applyReportBridgeResult(result, active) {
    if (this._unloaded || this._activeReportBridge !== active
      || active.revision !== this._reportRevision || !result
      || result.ticket !== active.ticket || result.bridge !== active.bridge
      || result.fingerprint !== this._sourceFingerprint || result.revision !== active.revision) return
    this._activeReportBridge = null
    const items = this._buildingImagePlan?.bridges?.[active.bridge] || []
    if (!result.ok) {
      if (result.cancelled) {
        this.cancelReportGeneration()
        return
      }
      const errors = result.errors && typeof result.errors === 'object' ? result.errors : {}
      const relevantErrors = Object.fromEntries(items.map((item) => [
        item.id, errors[item.id] || result.message || '原生图片生成失败。',
      ]))
      this.failReportGeneration(active.revision, this._buildingPages?.length || 0, {
        items,
        errors: relevantErrors,
        message: result.message || '原生图片生成失败。',
      })
      return
    }
    const returnedItems = Array.isArray(result.items) ? result.items : []
    if (active.bridge === 'audioWiring') {
      const expectedIds = items.map((item) => item.id)
      const byId = new Map(returnedItems.map((entry) => [entry?.id, entry]))
      if (returnedItems.length !== expectedIds.length || expectedIds.some((id) => (
        !byId.has(id) || !Array.isArray(byId.get(id).pages) || !byId.get(id).pages.length
      ))) {
        this.failReportGeneration(active.revision, this._buildingPages?.length || 0, {
          items,
          errors: Object.fromEntries(items.map((item) => [item.id, '分包未返回该接线记录的完整图片。'])),
          message: '接线图片不完整，已取消打开报告。',
        })
        return
      }
      this._bridgeResults.audioWiring = Object.fromEntries(expectedIds.map((id) => [id, byId.get(id).pages]))
    } else {
      const expectedIds = items.map((item) => item.line?.id)
      const bundle = returnedItems.find((entry) => entry?.id === '__projectWiring__')
      if (!bundle || !Array.isArray(bundle.pages) || !bundle.pages.length
        || !Array.isArray(bundle.lineIds) || bundle.lineIds.length !== expectedIds.length
        || expectedIds.some((id) => !bundle.lineIds.includes(id))) {
        this.failReportGeneration(active.revision, this._buildingPages?.length || 0, {
          items,
          errors: Object.fromEntries(items.map((item) => [item.id, '分包未返回全部所选线路的原生图片。'])),
          message: '项目线路图片不完整，已取消打开报告。',
        })
        return
      }
      this._bridgeResults.projectWiring = bundle.pages
    }
    this._bridgeIndex += 1
    this.renderNextReportBridge(active.revision)
  },

  prepareReportImageQueue(revision) {
    if (this._unloaded || revision !== this._reportRevision) return
    const items = this._buildingPayload?.selectedItems || []
    const imagePlan = this._buildingImagePlan
    if (!items.length || !imagePlan) {
      this.failReportGeneration(revision, this._buildingPages?.length || 0, { message: '报告工具图片快照已丢失。' })
      return
    }
    const queue = []
    let projectWiringAdded = false
    const missing = []
    items.forEach((item) => {
      if (Array.isArray(imagePlan.tasksById[item.id]) && imagePlan.tasksById[item.id].length) {
        imagePlan.tasksById[item.id].forEach((task) => queue.push({ kind: 'task', itemId: item.id, task }))
        return
      }
      if (item.type === 'calculation' && item.record?.module === 'audioWiring') {
        const pages = this._bridgeResults.audioWiring?.[item.id]
        if (!Array.isArray(pages) || !pages.length) missing.push(item)
        else pages.forEach((page) => queue.push({ kind: 'image', itemId: item.id, page }))
        return
      }
      if (item.type === 'wiring') {
        if (!projectWiringAdded) {
          const pages = this._bridgeResults.projectWiring
          if (!Array.isArray(pages) || !pages.length) missing.push(item)
          else pages.forEach((page) => queue.push({ kind: 'image', itemId: item.id, page }))
          projectWiringAdded = true
        }
        return
      }
      missing.push(item)
    })
    if (missing.length || !queue.length) {
      const errors = Object.fromEntries(missing.map((item) => [item.id, '该选中项没有对应的完整原生工具图片。']))
      this.failReportGeneration(revision, this._buildingPages?.length || 0, {
        items: missing,
        errors,
        message: '有选中内容缺少原生工具图片，已取消打开不完整报告。',
      })
      return
    }
    this._imageQueue = queue
    this._imageSegmentIndex = 0
    this.setData({ renderProgressText: `正在生成工具图片：共 ${queue.length} 项` }, () => {
      this.renderReportImageTask(0, revision, 0)
    })
  },

  renderReportImageTask(index, revision, segmentIndex = 0) {
    if (this._unloaded || revision !== this._reportRevision) return
    const queue = this._imageQueue || []
    if (index >= queue.length) {
      this.finishReportGeneration(revision)
      return
    }
    const entry = queue[index]
    if (entry.kind === 'image') {
      const page = entry.page
      if (!page?.path || !Number.isFinite(Number(page.width)) || !Number.isFinite(Number(page.height))) {
        this.failReportGeneration(revision, this._buildingPages?.length || 0, {
          items: this._buildingPayload.selectedItems.filter((item) => item.id === entry.itemId),
          errors: { [entry.itemId]: '分包返回了无效图片路径或尺寸。' },
          message: '原生工具图片路径无效，已取消打开不完整报告。',
        })
        return
      }
      this._renderedPages.push({ ...page, pageNumber: this._renderedPages.length + 1, itemId: entry.itemId })
      this.setData({ renderProgressText: `正在整理工具图片：${index + 1} / ${queue.length}` }, () => {
        this.renderReportImageTask(index + 1, revision, 0)
      })
      return
    }
    const task = entry.task
    const segments = splitTaskIntoSegments(task, REPORT_SEGMENT_HEIGHT)
    const segment = segments[segmentIndex]
    if (!segment) {
      this.failReportGeneration(revision, this._buildingPages?.length || 0, {
        items: this._buildingPayload.selectedItems.filter((item) => item.id === entry.itemId),
        errors: { [entry.itemId]: '原生工具图片没有生成完整分段。' },
        message: '原生工具图片分段不完整，已取消打开报告。',
      })
      return
    }
    this.setData({
      reportCanvasWidth: task.width,
      reportCanvasHeight: segment.height,
      renderProgressText: `正在生成工具图片 ${index + 1} / ${queue.length} · ${task.title}${segments.length > 1 ? ` · 分段 ${segmentIndex + 1} / ${segments.length}` : ''}`,
    }, () => {
      if (this._unloaded || revision !== this._reportRevision) return
      try {
        drawAndExportReport(this, {
          canvasId: CANVAS_ID,
          isCurrent: () => !this._unloaded && this._reportRevision === revision,
          width: task.width,
          height: segment.height,
          draw: (context) => task.drawSegment(context, segment.top, segment.height),
          getExportOptions: () => ({ destWidth: task.width, destHeight: segment.height }),
          startExportMeasurement: () => () => {},
          onSuccess: (path) => {
            if (this._unloaded || this._reportRevision !== revision) return
            if (!path) {
              this.failReportGeneration(revision, this._buildingPages?.length || 0, {
                items: this._buildingPayload.selectedItems.filter((item) => item.id === entry.itemId),
                errors: { [entry.itemId]: '原生工具图片导出失败。' },
                message: '原生工具图片导出失败，已取消打开不完整报告。',
              })
              return
            }
            const segmentTitle = segments.length > 1 ? ` · 分段 ${segmentIndex + 1} / ${segments.length}` : ''
            this._renderedPages.push({
              path,
              width: task.width,
              height: segment.height,
              pageNumber: this._renderedPages.length + 1,
              itemId: entry.itemId,
              title: `${task.title}${segmentTitle}`,
              sourceHeight: task.height,
              sourceTop: segment.top,
            })
            if (segmentIndex + 1 < segments.length) this.renderReportImageTask(index, revision, segmentIndex + 1)
            else this.renderReportImageTask(index + 1, revision, 0)
          },
          onFailure: () => this.failReportGeneration(revision, this._buildingPages?.length || 0, {
            items: this._buildingPayload.selectedItems.filter((item) => item.id === entry.itemId),
            errors: { [entry.itemId]: '原生工具图片绘制或导出失败。' },
            message: `“${task.title}”图片生成失败，已取消打开不完整报告。`,
          }),
        })
      } catch (_) {
        this.failReportGeneration(revision, this._buildingPages?.length || 0, {
          items: this._buildingPayload.selectedItems.filter((item) => item.id === entry.itemId),
          errors: { [entry.itemId]: '原生工具图片绘制失败。' },
          message: `“${task.title}”图片生成失败，已取消打开不完整报告。`,
        })
      }
    })
  },

  finishReportGeneration(revision) {
    if (this._unloaded || revision !== this._reportRevision) return
    this._reportPages = [...this._renderedPages]
    this.reportSignature = this._buildingSignature
    const pageCount = this._reportPages.length
    this.setData({
      mode: 'preview',
      isGenerating: false,
      isSaving: false,
      renderProgressText: '',
      reportPages: this._reportPages,
      currentPageIndex: 0,
      currentPageNumber: 1,
      currentPagePath: this._reportPages[0]?.path || '',
      pageCount,
      previewScrollTop: 0,
      pageStatus: `报告已生成，共 ${pageCount} 页。`,
      savedPageIndexes: [],
      saveProgressText: '',
      saveButtonText: `保存全部 ${pageCount} 页`,
    })
  },

  failReportGeneration(revision, pageIndex, details = {}) {
    if (this._unloaded || revision !== this._reportRevision) return
    this.cancelActiveReportBridge()
    this._reportRevision += 1
    this._reportPages = []
    const errors = details.errors && typeof details.errors === 'object' ? details.errors : {}
    if (Object.keys(errors).length && this.reportSource) {
      this.setData({ selectionSections: asSelectionSections(this.reportSource, this.data.selectedItemIds, errors) })
    }
    this.setData({
      mode: 'select',
      isGenerating: false,
      renderProgressText: '',
      reportPages: [],
      currentPagePath: '',
      pageCount: 0,
      pageStatus: details.message || `第 ${pageIndex + 1} 页生成失败，未打开不完整报告。请重试。`,
    })
    wx.showToast({ title: `第 ${pageIndex + 1} 页生成失败`, icon: 'none' })
  },

  cancelReportGeneration() {
    if (!this.data.isGenerating) return
    this._reportRevision = (this._reportRevision || 0) + 1
    this.cancelActiveReportBridge()
    this._buildingPayload = null
    this._buildingImagePlan = null
    this._buildingPages = null
    this._renderedPages = []
    this._imageQueue = null
    this.setData({
      mode: 'select',
      isGenerating: false,
      renderProgressText: '',
      pageStatus: '报告生成已取消，选择内容仍保留。',
    })
  },

  setCurrentPage(index) {
    const pages = this._reportPages || []
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) return
    this.setData({
      currentPageIndex: index,
      currentPageNumber: index + 1,
      currentPagePath: pages[index].path,
      previewScrollTop: 0,
    })
  },

  previousReportPage() {
    this.setCurrentPage(this.data.currentPageIndex - 1)
  },

  nextReportPage() {
    this.setCurrentPage(this.data.currentPageIndex + 1)
  },

  inspectReportPages() {
    const pages = this._reportPages || []
    const path = pages[this.data.currentPageIndex]?.path
    if (!path) return
    if (typeof wx.previewImage === 'function') {
      wx.previewImage({ current: path, urls: pages.map((page) => page.path) })
      return
    }
    previewGeneratedImage(path)
  },

  shareCurrentReportPage() {
    const path = this._reportPages?.[this.data.currentPageIndex]?.path
    if (!path) return
    if (!shareGeneratedImage(path)) wx.showToast({ title: '当前页面暂不支持分享图片', icon: 'none' })
  },

  saveAllReportPages() {
    if (this.data.isSaving || !this._reportPages?.length || !this.reportSignature) return
    if (typeof wx.saveImageToPhotosAlbum !== 'function') {
      this.setData({ saveProgressText: '当前微信版本暂不支持保存报告图片。' })
      return
    }
    this._saveRevision = (this._saveRevision || 0) + 1
    const revision = this._saveRevision
    const signature = this.reportSignature
    this._saveSignature = signature
    const pages = [...this._reportPages]
    const initialSaved = [...this.data.savedPageIndexes]
    this.setData({ isSaving: true, saveProgressText: '准备保存报告图片…' }, () => {
      const isCurrent = () => !this._unloaded
        && this._saveRevision === revision
        && this._saveSignature === signature
        && this.reportSignature === signature
      const saveTask = saveReportPages({
        pages,
        savedIndexes: initialSaved,
        saveImage: saveWxImageToAlbum,
        isCurrent,
        shouldContinue: isCurrent,
        onProgress: ({ currentIndex, completedCount, pageCount }) => {
          if (!isCurrent()) return
          this.setData({ saveProgressText: `正在保存第 ${currentIndex + 1} / ${pageCount} 页，已保存 ${completedCount} 页` })
        },
        onSaved: ({ currentIndex, completedCount, pageCount }) => {
          if (!isCurrent()) return
          const indexes = [...new Set([...this.data.savedPageIndexes, currentIndex])].sort((a, b) => a - b)
          this.setData({
            savedPageIndexes: indexes,
            saveProgressText: `已保存 ${completedCount} / ${pageCount} 页`,
          })
        },
      }).then((result) => {
        if (!isCurrent()) return
        this._saveSignature = ''
        this.setData({
          isSaving: false,
          savedPageIndexes: result.savedIndexes,
          saveProgressText: result.complete
            ? `已保存全部 ${pages.length} 页。`
            : result.canceled
              ? `已取消第 ${(result.failedIndex || 0) + 1} 页；已保存 ${result.savedIndexes.length} / ${pages.length} 页。再次保存会从未完成页继续。`
              : `第 ${(result.failedIndex || 0) + 1} 页保存失败；已保存 ${result.savedIndexes.length} / ${pages.length} 页。再次保存可继续。`,
          saveButtonText: result.complete ? `已保存全部 ${pages.length} 页` : '继续保存剩余页',
        })
        if (result.complete) {
          wx.showToast({ title: `已保存全部 ${pages.length} 页`, icon: 'success' })
          return
        }
        if (!result.canceled && saveErrorNeedsSettings(result.error) && typeof wx.showModal === 'function') {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册，再点“保存全部页面”继续。已成功保存的页面会跳过。',
            confirmText: '去设置',
            success: ({ confirm }) => { if (confirm && typeof wx.openSetting === 'function') wx.openSetting() },
          })
        } else if (!result.canceled) {
          wx.showToast({ title: `第 ${(result.failedIndex || 0) + 1} 页保存失败`, icon: 'none' })
        }
      })
      this._savePromise = saveTask
    })
  },

  invalidateReportSave(reason = '') {
    this._saveRevision = (this._saveRevision || 0) + 1
    this._saveSignature = ''
    if (!this.data.isSaving) return ''
    const pages = this._reportPages || []
    const savedCount = Array.isArray(this.data.savedPageIndexes) ? this.data.savedPageIndexes.length : 0
    const status = `${reason ? `${reason} ` : ''}已停止后续页面保存；已完成 ${savedCount} / ${pages.length} 页。正在处理的页面稍后请核对相册。`
    this.setData({ isSaving: false, saveProgressText: status })
    return status
  },
})

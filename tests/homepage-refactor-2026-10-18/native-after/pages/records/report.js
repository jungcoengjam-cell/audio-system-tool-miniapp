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
const { getReportNavigationMetrics } = require('./report-navigation')
const { drawReportPage } = require('./report-renderer')
const {
  saveErrorNeedsSettings,
  saveReportPages,
  saveWxImageToAlbum,
} = require('./report-actions')

const CANVAS_ID = 'projectReportExportCanvas'

function asSelectionSections(source, selectedIds = []) {
  const selected = new Set(selectedIds)
  return getProjectReportSections(source).map((section) => ({
    key: section.key,
    title: section.title,
    items: section.items.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      checked: selected.has(item.id),
    })),
  }))
}

function readNavigationMetrics() {
  let windowInfo = {}
  let menuRect = null
  try {
    if (typeof wx.getWindowInfo === 'function') windowInfo = wx.getWindowInfo()
    else if (typeof wx.getSystemInfoSync === 'function') windowInfo = wx.getSystemInfoSync()
  } catch (error) {
    windowInfo = {}
  }
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') menuRect = wx.getMenuButtonBoundingClientRect()
  } catch (error) {
    menuRect = null
  }
  return getReportNavigationMetrics(windowInfo, menuRect)
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
    statusBarHeightPx: 20,
    navContentHeightPx: 44,
    navBarTotalHeightPx: 64,
    navSideWidthPx: 88,
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
    this._saveRevision = 0
    this.updateNavigationMetrics()
    this.loadSource()
  },

  onUnload() {
    this._unloaded = true
    this._reportRevision = (this._reportRevision || 0) + 1
    this._saveRevision = (this._saveRevision || 0) + 1
    this._saveSignature = ''
  },

  updateNavigationMetrics() {
    this.setData(readNavigationMetrics())
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

  navigateBack() {
    if (this.data.mode === 'rendering') {
      this.cancelReportGeneration()
      return
    }
    if (this.data.mode === 'preview') {
      const stoppedSaveText = this.invalidateReportSave('已返回选择。')
      this.setData({
        mode: 'select',
        pageStatus: stoppedSaveText || '已返回选择，原选择仍保留。',
      })
      return
    }
    wx.navigateBack({ delta: 1 })
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

    this._reportRevision = (this._reportRevision || 0) + 1
    const revision = this._reportRevision
    this._buildingPayload = payload
    this._buildingPages = payload.pages
    this._renderedPages = []
    this._buildingSignature = signature
    this.setData({
      mode: 'rendering',
      isGenerating: true,
      renderProgressText: `正在生成第 1 / ${payload.pages.length} 页`,
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
      renderProgressText: `正在生成第 ${index + 1} / ${pages.length} 页`,
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
            this.finishReportGeneration(revision)
          },
          onFailure: () => this.failReportGeneration(revision, index),
        })
      } catch (error) {
        this.failReportGeneration(revision, index)
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

  failReportGeneration(revision, pageIndex) {
    if (this._unloaded || revision !== this._reportRevision) return
    this._reportRevision += 1
    this._reportPages = []
    this.setData({
      mode: 'select',
      isGenerating: false,
      renderProgressText: '',
      reportPages: [],
      currentPagePath: '',
      pageCount: 0,
      pageStatus: `第 ${pageIndex + 1} 页生成失败，未打开不完整报告。请重试。`,
    })
    wx.showToast({ title: `第 ${pageIndex + 1} 页生成失败`, icon: 'none' })
  },

  cancelReportGeneration() {
    if (!this.data.isGenerating) return
    this._reportRevision = (this._reportRevision || 0) + 1
    this._buildingPayload = null
    this._buildingPages = null
    this._renderedPages = []
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

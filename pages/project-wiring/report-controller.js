const REPORT_CANVAS_ID = 'wiringReportCanvas'
const dataset = (event) => event && event.currentTarget && event.currentTarget.dataset || {}

function createReportController({ exportTypes: EXPORT_TYPES, safeToast, vibrate, shareGeneratedImage }) {
  return {
    selectExportType(event) {
      const index = Number(event.detail.value)
      if (!Number.isInteger(index) || !EXPORT_TYPES[index]) return
      if (index === this.data.exportTypeIndex) return
      this.invalidateExport(true)
      this.setData({ exportTypeIndex: index, reportImages: [], reportImagePath: '', reportPreviewVisible: false })
      vibrate('light')
    },

    invalidateExport(clearImages) {
      const wasRunning = Boolean(this._reportSaveJob)
      this.cancelReportSaveJob()
      const wasPending = Boolean(this._reportPending)
      this._reportRevision = (this._reportRevision || 0) + 1
      this._reportPending = false
      if (wasPending && typeof wx !== 'undefined' && typeof wx.hideLoading === 'function') wx.hideLoading()
      const changes = {
        reportPreviewVisible: false,
        reportSaveRunning: false,
        reportSaveInFlight: Boolean(this._reportSaveInFlight),
      }
      if (!clearImages && (wasRunning || this._reportSaveInFlight)) changes.reportSaveMessage = this.getInactiveReportSaveMessage()
      if (clearImages) {
        this._workspaceReportClearToken = (this._workspaceReportClearToken || 0) + 1
        this._workspaceReportClearPending = true
        this._workspaceReportClearSignature = ''
      }
      const clearToken = this._workspaceReportClearPending ? this._workspaceReportClearToken : 0
      if (clearImages) {
        this._reportSignature = ''
        if (this._reportSavedPages) this._reportSavedPages.clear()
      }
      const reportMounted = Boolean(this.data && (this.data.reportPreviewVisible
        || this.data.workspaceOverlayPhases && this.data.workspaceOverlayPhases.report))
      if (this.data && !this._destroyed && reportMounted && !this._hidden) {
        this.endWorkspaceOverlay('report', () => {
          if (clearToken) this.finishWorkspaceReportClear(clearToken)
        }, changes)
        return
      }
      if (this.data && !this._destroyed) {
        if (clearToken) {
          this._workspaceReportClearPending = false
          this._workspaceReportClearSignature = ''
        }
        this.setData({ ...changes, ...(clearToken ? this.workspaceReportClearState() : {}) })
      }
    },

    generateExport(typeOverride = '') {
      if (!this.data.project || !this._schedule.lines.length || this.data.loading || this.data.saving) {
        safeToast(this.data.project ? '请先添加线路，再导出图片' : '请先选择项目')
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
        vibrate('medium')
        this._reportSignature = signature
        this.setData({
          reportImages: pageImages,
          reportPageIndex: 0,
          reportSaveMessage: '',
          reportSaveError: '',
        }, () => {
          if (!isCurrent()) return
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
      this._workspaceReportClearToken = (this._workspaceReportClearToken || 0) + 1
      this._workspaceReportClearPending = false
      this._workspaceReportClearSignature = ''
      const changes = {
        reportPageIndex: index,
        reportPageTitle: item.title,
        reportImagePath: item.path,
        reportPreviewVisible: true,
      }
      if (this.data.reportPreviewVisible) this.setData(changes)
      else this.beginWorkspaceOverlay('report', changes)
      this.syncReportSaveView()
    },

    onReportPageSwipe(event) {
      const index = Number(event && event.detail && event.detail.current)
      if (this._destroyed || this._hidden || !this.data.reportPreviewVisible || !Number.isSafeInteger(index)
        || index < 0 || index >= this.data.reportImages.length) return false
      if (index === this.data.reportPageIndex) return true
      this.showReportPage(index)
      return true
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
      this.nextWorkspaceTransitionRevision()
      const wasRunning = Boolean(this._reportSaveJob)
      this.cancelReportSaveJob()
      this.endWorkspaceOverlay('report', () => this.finishWorkspaceReportClear(), {
        reportPreviewVisible: false,
        reportSaveRunning: false,
        reportSaveInFlight: Boolean(this._reportSaveInFlight),
        ...(wasRunning || this._reportSaveInFlight ? { reportSaveMessage: this.getInactiveReportSaveMessage() } : {}),
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
        vibrate('medium')
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

    shareProject(event) {
      if (this._inlineRename) {
        this.queueInlineRenameAction({ kind: 'share', data: dataset(event) })
        return
      }
      this.cancelWorkspaceSwipeGesture()
      this.closeWorkspaceSwipeRow()
      this.clearWorkspaceRetiringRow()
      this.generateExport('project')
    },

    workspaceReportClearState() {
      return {
        reportImages: [], reportImagePath: '', reportSavedPageIndices: [], reportSaveMessage: '',
        reportSaveError: '', reportSaveAllLabel: "全部保存（0张）",
      }
    },

    finishWorkspaceReportClear(token = this._workspaceReportClearToken) {
      if (!token || !this._workspaceReportClearPending || token !== this._workspaceReportClearToken || this._destroyed
        || this.data.reportPreviewVisible || this.data.workspaceOverlayPhases.report) return false
      if (this._workspaceReportClearSignature !== undefined && this._reportSignature !== this._workspaceReportClearSignature) {
        this._workspaceReportClearPending = false
        this._workspaceReportClearSignature = ''
        return false
      }
      this._workspaceReportClearPending = false
      this._workspaceReportClearSignature = ''
      this.setData(this.workspaceReportClearState())
      return true
    },
  }
}

module.exports = { createReportController }

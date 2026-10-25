const { buildScheduleReportPages, drawScheduleReport } = require('./report')
const { createReportBridgeLifecycle } = require('../../utils/report-bridge-lifecycle')

const CANVAS_ID = 'projectWiringReportBridgeCanvas'

Page({
  data: { progressText: '等待报告快照', isWorking: false, canvasWidth: 720, canvasHeight: 1200 },
  ...createReportBridgeLifecycle({ bridge: 'projectWiring', cancelMessage: '项目线路图片生成已取消。' }),

  begin(payload) {
    this._payload = payload
    if (this._terminal || !payload || payload.bridge !== 'projectWiring'
      || !payload.ticket || !payload.fingerprint || !Number.isInteger(payload.revision)
      || typeof payload.projectName !== 'string' || !payload.schedule
      || !Array.isArray(payload.items) || !payload.items.length
      || !Array.isArray(payload.schedule.lines) || !Array.isArray(payload.schedule.devices)) {
      this.finish({ ok: false, errors: {}, message: '项目线路图片任务的批次快照无效。' })
      return
    }
    const expectedIds = payload.items.map((item) => item?.line?.id)
    const actualIds = payload.schedule.lines.map((line) => line?.id)
    if (expectedIds.some((id) => !id) || new Set(expectedIds).size !== expectedIds.length
      || expectedIds.length !== actualIds.length || expectedIds.some((id) => !actualIds.includes(id))) {
      this.finish({
        ok: false,
        errors: Object.fromEntries(payload.items.map((item) => [item.id, '所选项目线路与冻结线路快照不一致。'])),
        message: '项目线路图片任务无法对应到所选线路。',
      })
      return
    }
    let report
    try {
      report = buildScheduleReportPages(payload.projectName, payload.schedule, 'project')
    } catch (_) {
      report = null
    }
    if (!report || !Array.isArray(report.pages) || !report.pages.length || report.lineCount !== expectedIds.length) {
      this.finish({
        ok: false,
        errors: Object.fromEntries(payload.items.map((item) => [item.id, '项目线路原生报告未能保留全部所选线路。'])),
        message: '项目线路图片无法完整分页。',
      })
      return
    }
    if (report.pages.some((page) => !Number.isFinite(page.width) || !Number.isFinite(page.height)
      || page.width < 1 || page.height < 1 || page.height > 3600)) {
      this.finish({
        ok: false,
        errors: Object.fromEntries(payload.items.map((item) => [item.id, '项目线路原生图片尺寸超出安全范围。'])),
        message: '项目线路图片无法完整分页。',
      })
      return
    }
    this._pages = report.pages
    this._rendered = []
    this.setData({ isWorking: true, progressText: `正在生成项目线路图片：共 ${report.pages.length} 页` })
    this.renderNext(0)
  },

  renderNext(index) {
    if (!this._isCurrent()) return
    if (index >= this._pages.length) {
      this.finish({
        ok: true,
        items: [{
          id: '__projectWiring__',
          lineIds: this._payload.items.map((item) => item.line.id),
          pages: this._rendered,
        }],
      })
      return
    }
    const page = this._pages[index]
    this.setData({ canvasWidth: page.width, canvasHeight: page.height,
      progressText: `正在生成项目线路图片：第 ${index + 1} / ${this._pages.length} 页` }, () => {
      if (!this._isCurrent()) return
      try {
        const context = wx.createCanvasContext(CANVAS_ID, this)
        drawScheduleReport(context, page, { theme: 'light' })
        context.draw(false, () => {
          if (!this._isCurrent()) return
          wx.canvasToTempFilePath({
            canvasId: CANVAS_ID, width: page.width, height: page.height,
            destWidth: page.width, destHeight: page.height, fileType: 'png', quality: 1,
            success: ({ tempFilePath }) => {
              if (!this._isCurrent()) return
              if (!tempFilePath) {
                this.failAll('项目线路图片导出失败。')
                return
              }
              this._rendered.push({ path: tempFilePath, width: page.width, height: page.height,
                title: `项目线路原生图 · 第 ${index + 1} / ${this._pages.length} 页` })
              this.renderNext(index + 1)
            },
            fail: () => { if (this._isCurrent()) this.failAll('项目线路图片导出失败。') },
          }, this)
        })
      } catch (_) {
        if (this._isCurrent()) this.failAll('项目线路原生渲染失败。')
      }
    })
  },

  _isCurrent() {
    return !this._unloaded && !this._terminal && Boolean(this._payload?.ticket)
  },

  failAll(message) {
    const errors = Object.fromEntries((this._payload?.items || []).map((item) => [item.id, message]))
    this.finish({ ok: false, errors, message })
  },

})


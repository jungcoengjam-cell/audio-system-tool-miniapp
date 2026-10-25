const { getWiringModel, getFixedWiringSelections, buildWiringText } = require('./wiring-model')
const { drawWiringReport, getReportHeight } = require('./wiring-renderer')
const { loadReportSolderPhotos } = require('./wiring-photos')
const { createReportBridgeLifecycle } = require('../../utils/report-bridge-lifecycle')

const CANVAS_ID = 'audioWiringReportBridgeCanvas'
const WIDTH = 720
const MAX_SEGMENT_HEIGHT = 3600

function isRecordSnapshot(item) {
  const record = item?.record
  const prefs = record?.preferences
  return Boolean(item?.id && item.type === 'calculation' && record?.module === 'audioWiring'
    && typeof record.resultText === 'string' && record.resultText
    && prefs && prefs.version === 1
    && typeof prefs.outputId === 'string' && typeof prefs.inputId === 'string'
    && prefs.manualSelected && typeof prefs.manualSelected.output === 'boolean'
    && typeof prefs.manualSelected.input === 'boolean'
    && prefs.viewMode === 'connectors' && prefs.face === 'solder'
    && prefs.selections && typeof prefs.selections === 'object' && !Array.isArray(prefs.selections))
}

function buildRecordModel(item) {
  if (!isRecordSnapshot(item)) return { ok: false, error: '接线记录缺少完整历史输入快照。' }
  const { record } = item
  const prefs = record.preferences
  const fixedSelections = getFixedWiringSelections(prefs.outputId, prefs.inputId)
  if (JSON.stringify(fixedSelections) !== JSON.stringify(prefs.selections)) {
    return { ok: false, error: '接线历史条件选项与接口组合不一致。' }
  }
  const model = getWiringModel(prefs.outputId, prefs.inputId, fixedSelections)
  if (!model?.supported || model.status !== 'ready') {
    return { ok: false, error: model?.reason || '历史接线组合无法由现有原生接线渲染器读取。' }
  }
  let wiringText
  try {
    wiringText = buildWiringText(model)
  } catch (_) {
    return { ok: false, error: '历史接线组合无法生成完整连接文本。' }
  }
  const notice = !prefs.manualSelected.output && !prefs.manualSelected.input
    ? '默认示例，先核对实际两端接口。'
    : !prefs.manualSelected.output || !prefs.manualSelected.input
      ? '仍有接口为默认示例，请核对实际两端接口。'
      : ''
  const expected = [
    '结果性质：接线参考',
    ...(notice ? [notice] : []),
    wiringText,
    '施工前请按具体设备型号说明书核对端口用途、端子标识和接线要求。',
  ].join('\n\n')
  if (expected !== record.resultText) return { ok: false, error: '接线历史结果与保存的线路文本不一致。' }
  const options = {
    layout: 'solder-wiring', compact: true, viewMode: 'connectors', face: 'solder',
    selectedId: '', theme: 'light', preferenceNotice: notice,
  }
  const height = getReportHeight(WIDTH, model, options)
  if (!Number.isFinite(height) || height < 1) return { ok: false, error: '接线图无法计算原始分页高度。' }
  return { ok: true, item, model, options, height }
}

Page({
  data: { progressText: '等待报告快照', isWorking: false },
  ...createReportBridgeLifecycle({ bridge: 'audioWiring', cancelMessage: '接线图片生成已取消。' }),

  begin(payload) {
    const alreadyStarted = Boolean(this._payload)
    if (!alreadyStarted && payload && typeof payload === 'object') this._payload = payload
    if (alreadyStarted || this._terminal || !payload || payload.bridge !== 'audioWiring'
      || !payload.ticket || !payload.fingerprint || !Number.isInteger(payload.revision)
      || !Array.isArray(payload.items) || !payload.items.length) {
      this.finish({ ok: false, errors: {}, message: '接线图片任务的批次快照无效。' })
      return
    }
    this._payload = payload
    this._isCurrent = () => !this._unloaded && !this._terminal && this._payload?.ticket === payload.ticket
    const prepared = payload.items.map((item) => buildRecordModel(item))
    const errors = {}
    prepared.forEach((entry, index) => { if (!entry.ok) errors[payload.items[index]?.id || `item-${index}`] = entry.error })
    if (Object.keys(errors).length) {
      this.finish({ ok: false, errors, message: '部分接线历史快照无法匹配原生图片，请在报告选择页取消勾选失败项。' })
      return
    }
    this._prepared = prepared
    this._imagesById = {}
    this.setData({ isWorking: true, progressText: `准备接线图片：共 ${prepared.length} 项` })
    this.renderNext(0)
  },

  renderNext(index) {
    if (!this._isCurrent?.()) return
    if (index >= this._prepared.length) {
      this.finish({ ok: true, items: this._prepared.map(({ item }) => ({ id: item.id, pages: this._imagesById[item.id] || [] })) })
      return
    }
    const entry = this._prepared[index]
    this.setData({ progressText: `正在生成接线图片 ${index + 1} / ${this._prepared.length}` })
    loadReportSolderPhotos(entry.model, () => this._isCurrent(), (error, photos) => {
      if (!this._isCurrent()) return
      if (error || !photos) {
        this.finish({ ok: false, errors: { [entry.item.id]: '接线图所需的本地接头图片无法读取。' }, message: '接线图片生成失败。' })
        return
      }
      const pages = []
      const segmentCount = Math.ceil(entry.height / MAX_SEGMENT_HEIGHT)
      const renderSegment = (segmentIndex) => {
        if (!this._isCurrent()) return
        if (segmentIndex >= segmentCount) {
          this._imagesById[entry.item.id] = pages
          this.renderNext(index + 1)
          return
        }
        const top = segmentIndex * MAX_SEGMENT_HEIGHT
        const height = Math.min(MAX_SEGMENT_HEIGHT, entry.height - top)
        this.setData({ canvasWidth: WIDTH, canvasHeight: height })
        this.setData({ progressText: `正在生成接线图片 ${index + 1} / ${this._prepared.length} · 分段 ${segmentIndex + 1} / ${segmentCount}` }, () => {
          if (!this._isCurrent()) return
          try {
            const context = wx.createCanvasContext(CANVAS_ID, this)
            context.save()
            context.beginPath()
            context.rect(0, 0, WIDTH, height)
            context.clip()
            context.translate(0, -top)
            drawWiringReport(context, entry.model, WIDTH, entry.height, { ...entry.options, photos })
            context.restore()
            context.draw(false, () => {
              if (!this._isCurrent()) return
              wx.canvasToTempFilePath({
                canvasId: CANVAS_ID, width: WIDTH, height,
                destWidth: WIDTH, destHeight: height, fileType: 'png', quality: 1,
                success: ({ tempFilePath }) => {
                  if (!this._isCurrent()) return
                  if (!tempFilePath) {
                    this.finish({ ok: false, errors: { [entry.item.id]: '接线图图片导出失败。' }, message: '接线图片生成失败。' })
                    return
                  }
                  pages.push({ path: tempFilePath, width: WIDTH, height, title: `接线原生图 · 分段 ${segmentIndex + 1} / ${segmentCount}` })
                  renderSegment(segmentIndex + 1)
                },
                fail: () => {
                  if (this._isCurrent()) this.finish({ ok: false, errors: { [entry.item.id]: '接线图图片导出失败。' }, message: '接线图片生成失败。' })
                },
              }, this)
            })
          } catch (_) {
            if (this._isCurrent()) this.finish({ ok: false, errors: { [entry.item.id]: '接线图原生渲染失败。' }, message: '接线图片生成失败。' })
          }
        })
      }
      renderSegment(0)
    })
  },

})

module.exports = { buildRecordModel, isRecordSnapshot }

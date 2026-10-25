const assert = require('assert')
const {
  createPdfFromJpegPages,
  makeReportPdfFileName,
} = require('../pages/records/report-pdf')
const { buildReportPdfFile } = require('../pages/records/report-pdf-export')

function jpegBytes(marker) {
  return Uint8Array.from([0xff, 0xd8, marker & 0xff, 0xff, 0xd9])
}

function fixturePages() {
  return [
    { data: jpegBytes(1), width: 2, height: 2, logicalWidth: 200, logicalHeight: 200 },
    { data: jpegBytes(2), width: 4, height: 8, logicalWidth: 400, logicalHeight: 800 },
  ]
}

function verifyXref(pdfBytes) {
  const pdf = Buffer.from(pdfBytes)
  const text = pdf.toString('latin1')
  assert(text.startsWith('%PDF-1.4\n'))
  const startXref = Number(text.match(/startxref\n(\d+)/)?.[1])
  assert(Number.isInteger(startXref))
  assert.strictEqual(text.slice(startXref, startXref + 4), 'xref')
  const xrefLines = text.slice(startXref).split('\n')
  const objectCount = Number(xrefLines[1].split(' ')[1])
  for (let id = 1; id < objectCount; id += 1) {
    const offset = Number(xrefLines[id + 2].slice(0, 10))
    assert.strictEqual(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`)
  }
  assert(text.endsWith('%%EOF\n'))
  return text
}

function memoryFiles() {
  const files = new Map()
  const removed = []
  return {
    files,
    removed,
    async exportJpeg(_page, index) {
      const path = `/tmp/report-page-${index}.jpg`
      files.set(path, jpegBytes(index + 1))
      return { path, width: 2, height: 2 }
    },
    async getJpegSize(path) { return files.get(path)?.byteLength || 0 },
    async readJpeg(path) { return files.get(path) },
    async writePdf(path, bytes) { files.set(path, bytes) },
    async removeFile(path) { removed.push(path); files.delete(path) },
  }
}

async function testExportPipeline() {
  const store = memoryFiles()
  const result = await buildReportPdfFile({
    pages: [{ path: '/source/one.png', width: 200, height: 200 }, { path: '/source/two.png', width: 200, height: 200 }],
    outputPath: '/user/report.pdf',
    ...store,
    isCurrent: () => true,
  })
  assert.deepStrictEqual(result, { filePath: '/user/report.pdf', pageCount: 2 })
  verifyXref(store.files.get('/user/report.pdf'))
  assert(!store.files.has('/tmp/report-page-0.jpg') && !store.files.has('/tmp/report-page-1.jpg'))

  const failed = memoryFiles()
  failed.writePdf = async () => { throw new Error('write failed') }
  await assert.rejects(buildReportPdfFile({
    pages: [{ path: '/source/one.png', width: 200, height: 200 }],
    outputPath: '/user/partial.pdf',
    ...failed,
    isCurrent: () => true,
  }), /write failed/)
  assert(!failed.files.has('/user/partial.pdf') && !failed.files.has('/tmp/report-page-0.jpg'))

  const canceled = memoryFiles()
  let current = true
  const tempPaths = new Set()
  await assert.rejects(buildReportPdfFile({
    pages: [{ path: '/source/one.png', width: 200, height: 200 }],
    outputPath: '/user/canceled.pdf',
    ...canceled,
    tempPaths,
    isCurrent: () => current,
    exportJpeg: async () => {
      canceled.files.set('/tmp/canceled.jpg', jpegBytes(1))
      current = false
      return { path: '/tmp/canceled.jpg', width: 2, height: 2 }
    },
  }), (error) => error.code === 'REPORT_PDF_CANCELED')
  assert(!canceled.files.has('/tmp/canceled.jpg') && tempPaths.size === 0)

  const staleWrite = memoryFiles()
  let finishWrite
  let writeStarted
  const hasStarted = new Promise((resolve) => { writeStarted = resolve })
  let stillCurrent = true
  const pending = buildReportPdfFile({
    pages: [{ path: '/source/one.png', width: 200, height: 200 }],
    outputPath: '/user/stale.pdf',
    ...staleWrite,
    isCurrent: () => stillCurrent,
    writePdf: async (path, bytes) => {
      writeStarted()
      await new Promise((resolve) => { finishWrite = resolve })
      staleWrite.files.set(path, bytes)
    },
  })
  await hasStarted
  stillCurrent = false
  finishWrite()
  await assert.rejects(pending, (error) => error.code === 'REPORT_PDF_CANCELED')
  assert(!staleWrite.files.has('/user/stale.pdf'))
}

async function testPageCallbacks() {
  let definition
  global.Page = (value) => { definition = value }
  delete require.cache[require.resolve('../pages/records/report')]
  require('../pages/records/report')
  delete global.Page

  const page = { path: '/source/page.png', width: 200, height: 200 }
  let imageOptions
  let queryCalls = 0
  const tempExportOptions = []
  const images = []
  const drawCalls = []
  const removed = []
  const setDataChanges = []
  const canvas = {
    width: 1,
    height: 1,
    getContext() {
      return { fillStyle: '', fillRect() {}, drawImage(image) { drawCalls.push(image) } }
    },
    createImage() {
      const image = { src: '', onload: null, onerror: null }
      images.push(image)
      return image
    },
  }
  let setDataCalls = 0
  const firstJob = { canvas: null, cancelPendingExport: null, tempPaths: new Set(), outputWriteStarted: false }
  const controller = {
    setData(changes, callback) { setDataCalls += 1; setDataChanges.push(changes); if (callback) callback() },
    _unloaded: false,
    _activeReportPdfJob: firstJob,
    releaseReportPdfCanvas: definition.releaseReportPdfCanvas,
    cancelReportPdfExport: definition.cancelReportPdfExport,
    cleanupReportPdfFile: definition.cleanupReportPdfFile,
    removeReportFile(path) { removed.push(path); return Promise.resolve() },
  }
  let current = true
  let deferImageInfo = false
  let deferTempExport = false
  global.wx = {
    getImageInfo(options) {
      imageOptions = options
      if (!deferImageInfo) {
        const isRetry = options.src === '/source/retry.png'
        options.success({ width: isRetry ? 4 : 2, height: 2 })
      }
    },
    createSelectorQuery() {
      queryCalls += 1
      return {
        in() { return this },
        select() { return this },
        fields() { return this },
        exec(callback) { callback([{ node: canvas }]) },
      }
    },
    canvasToTempFilePath(options) {
      tempExportOptions.push(options)
      if (!deferTempExport) options.success({ tempFilePath: `/tmp/report-page-${tempExportOptions.length}.jpg` })
    },
  }
  deferImageInfo = true
  const staleImage = definition.exportReportPageAsJpeg.call(controller, page, 0, () => current, firstJob)
  current = false
  imageOptions.success({ width: 2, height: 2 })
  await assert.rejects(staleImage, /取消/)
  assert.strictEqual(queryCalls, 0, '过期图片回调不得查询或修改 PDF 画布')
  assert.strictEqual(setDataCalls, 0, 'PDF 画布尺寸不得通过页面 setData 调整')

  deferImageInfo = false
  current = true
  const firstPagePromise = definition.exportReportPageAsJpeg.call(controller, page, 0, () => current, firstJob)
  assert.strictEqual(canvas.width, 2)
  assert.strictEqual(canvas.height, 2)
  assert.strictEqual(tempExportOptions.length, 0, '图片触发 onload 前不得开始 JPEG 导出')
  const firstOnload = images[0].onload
  images[0].onload()
  assert.deepStrictEqual(await firstPagePromise, { path: '/tmp/report-page-1.jpg', width: 2, height: 2 })
  assert.strictEqual(tempExportOptions.length, 1)
  assert.strictEqual(drawCalls.length, 1, '第一页须解码后再绘制并导出')
  assert.strictEqual(canvas.width, 1, '单页导出后应释放大尺寸画布')
  assert.strictEqual(canvas.height, 1)

  const secondPagePromise = definition.exportReportPageAsJpeg.call(controller, page, 1, () => current, firstJob)
  assert.strictEqual(tempExportOptions.length, 1, '第二页解码前不得开始 JPEG 导出')
  const drawsBeforeLateFirstPageCallback = drawCalls.length
  firstOnload()
  assert.strictEqual(drawCalls.length, drawsBeforeLateFirstPageCallback, '前页迟到的重复 onload 不得绘制到下一页')
  assert.strictEqual(canvas.width, 2, '前页迟到回调不得缩放或清空下一页画布')
  images[1].onload()
  assert.deepStrictEqual(await secondPagePromise, { path: '/tmp/report-page-2.jpg', width: 2, height: 2 })
  assert.strictEqual(tempExportOptions.length, 2)
  assert.strictEqual(drawCalls.length, 2, '多页应按各自解码完成顺序导出')

  const decodeFailurePromise = definition.exportReportPageAsJpeg.call(controller, page, 2, () => current, firstJob)
  images[2].onerror(new Error('decode failed'))
  await assert.rejects(decodeFailurePromise, /decode failed/)
  assert.strictEqual(tempExportOptions.length, 2, '解码失败不得报告 JPEG 导出成功')
  assert.strictEqual(canvas.width, 1, '解码失败应释放 PDF 画布')

  const oldJob = { revision: 10, canvas: null, cancelPendingExport: null, tempPaths: new Set(), outputWriteStarted: false }
  controller._pdfRevision = 10
  controller._activeReportPdfJob = oldJob
  const oldIsCurrent = () => controller._activeReportPdfJob === oldJob && controller._pdfRevision === oldJob.revision
  const canceledPromise = definition.exportReportPageAsJpeg.call(controller, page, 3, oldIsCurrent, oldJob)
  const oldOnload = images[3].onload
  definition.onHide.call(controller)
  await assert.rejects(canceledPromise, /取消/)
  assert.strictEqual(controller._activeReportPdfJob, null, '页面隐藏应取消尚未解码的 PDF 页面')
  assert.strictEqual(canvas.width, 1, '取消活动导出时应释放画布')

  const retryJob = { revision: controller._pdfRevision + 1, canvas: null, cancelPendingExport: null, tempPaths: new Set(), outputWriteStarted: false }
  controller._pdfRevision = retryJob.revision
  controller._activeReportPdfJob = retryJob
  const retryPage = { path: '/source/retry.png', width: 400, height: 200 }
  const retryPromise = definition.exportReportPageAsJpeg.call(controller, retryPage, 0,
    () => controller._activeReportPdfJob === retryJob && controller._pdfRevision === retryJob.revision, retryJob)
  assert.strictEqual(canvas.width, 4)
  assert.strictEqual(canvas.height, 2)
  const drawsBeforeStaleOnload = drawCalls.length
  oldOnload()
  assert.strictEqual(drawCalls.length, drawsBeforeStaleOnload, '旧任务图片回调不得绘制到重试画布')
  assert.strictEqual(canvas.width, 4, '旧任务图片回调不得修改重试画布尺寸')
  images[4].onload()
  assert.deepStrictEqual(await retryPromise, { path: '/tmp/report-page-3.jpg', width: 4, height: 2 })

  const exportingJob = { revision: controller._pdfRevision + 1, canvas: null, cancelPendingExport: null, tempPaths: new Set(), outputWriteStarted: false }
  controller._pdfRevision = exportingJob.revision
  controller._activeReportPdfJob = exportingJob
  deferTempExport = true
  const exportingPromise = definition.exportReportPageAsJpeg.call(controller, page, 0,
    () => controller._activeReportPdfJob === exportingJob && controller._pdfRevision === exportingJob.revision, exportingJob)
  images[5].onload()
  assert.strictEqual(tempExportOptions.length, 4, '解码后应进入等待 JPEG 导出结果状态')
  const lateExportOptions = tempExportOptions[3]
  definition.onHide.call(controller)
  await assert.rejects(exportingPromise, /取消/)
  assert.strictEqual(canvas.width, 1, '导出结果未返回时取消应释放画布')

  const finalRetryJob = { revision: controller._pdfRevision + 1, canvas: null, cancelPendingExport: null, tempPaths: new Set(), outputWriteStarted: false }
  controller._pdfRevision = finalRetryJob.revision
  controller._activeReportPdfJob = finalRetryJob
  deferTempExport = false
  const finalRetryPromise = definition.exportReportPageAsJpeg.call(controller, retryPage, 0,
    () => controller._activeReportPdfJob === finalRetryJob && controller._pdfRevision === finalRetryJob.revision, finalRetryJob)
  assert.strictEqual(canvas.width, 4)
  const drawsBeforeLateExport = drawCalls.length
  lateExportOptions.success({ tempFilePath: '/tmp/report-canceled-late.jpg' })
  assert(removed.includes('/tmp/report-canceled-late.jpg'), '取消后迟到的 JPEG 文件必须清理')
  assert.strictEqual(canvas.width, 4, '旧 JPEG 导出回调不得改变重试画布')
  assert.strictEqual(drawCalls.length, drawsBeforeLateExport, '旧 JPEG 导出回调不得绘制到重试画布')
  images[6].onload()
  assert.deepStrictEqual(await finalRetryPromise, { path: '/tmp/report-page-5.jpg', width: 4, height: 2 })

  const exportFailureJob = { canvas: null, cancelPendingExport: null, tempPaths: new Set(), outputWriteStarted: false }
  controller._activeReportPdfJob = exportFailureJob
  const exportFailurePromise = definition.exportReportPageAsJpeg.call(controller, page, 5, () => current, exportFailureJob)
  global.wx.canvasToTempFilePath = () => { throw new Error('canvas export failed') }
  images[7].onload()
  await assert.rejects(exportFailurePromise, /canvas export failed/)
  assert.strictEqual(canvas.width, 1, 'Canvas 同步失败应释放 PDF 画布')
  assert(!setDataChanges.some((changes) => Object.prototype.hasOwnProperty.call(changes, 'pdfCanvasWidth')
    || Object.prototype.hasOwnProperty.call(changes, 'pdfCanvasHeight')), 'PDF Canvas 缓冲区尺寸只能通过 Canvas 2D 节点设置')
  delete global.wx
}

function testStalePdfActionsAndUnload() {
  let definition
  global.Page = (value) => { definition = value }
  delete require.cache[require.resolve('../pages/records/report')]
  require('../pages/records/report')
  delete global.Page

  let setDataCalls = 0
  let openOptions
  let shareOptions
  let modalOptions
  let openCalls = 0
  const removed = []
  const controller = {
    data: { pdfStatusText: '', pdfCanvasWidth: 8, pdfCanvasHeight: 8, isExportingPdf: true },
    _unloaded: false,
    _reportPdfPath: '/user/report.pdf',
    _reportPdfSignature: 'signature',
    reportSignature: 'signature',
    setData(changes) { setDataCalls += 1; this.data = { ...this.data, ...changes } },
    reportPdfFileMissing: definition.reportPdfFileMissing,
    clearMissingReportPdf: definition.clearMissingReportPdf,
    cancelReportPdfExport: definition.cancelReportPdfExport,
    releaseReportPdfCanvas: definition.releaseReportPdfCanvas,
    cleanupReportPdfFile: definition.cleanupReportPdfFile,
    invalidateReportPdf: definition.invalidateReportPdf,
    cancelActiveReportBridge() {},
    removeReportFile(path) { removed.push(path); return Promise.resolve() },
  }
  global.wx = {
    openDocument(options) { openOptions = options; openCalls += 1 },
    shareFileMessage(options) { shareOptions = options },
  }
  definition.openReportPdf.call(controller)
  controller._reportPdfPath = '/user/new-report.pdf'
  controller._reportPdfSignature = 'new-signature'
  controller.reportSignature = 'new-signature'
  openOptions.fail({ errMsg: 'file not found' })
  assert.strictEqual(controller._reportPdfPath, '/user/new-report.pdf', '旧打开回调不得清理新 PDF 路径')
  assert.strictEqual(setDataCalls, 0)
  controller._reportPdfPath = '/user/report.pdf'
  controller._reportPdfSignature = 'signature'
  controller.reportSignature = 'signature'
  definition.shareReportPdf.call(controller)
  controller._reportPdfPath = '/user/new-report.pdf'
  controller._reportPdfSignature = 'new-signature'
  controller.reportSignature = 'new-signature'
  shareOptions.fail({ errMsg: 'file not found' })
  assert.strictEqual(controller._reportPdfPath, '/user/new-report.pdf', '旧分享回调不得清理新 PDF 路径')
  assert.strictEqual(setDataCalls, 0)
  controller._reportPdfPath = '/user/report.pdf'
  controller._reportPdfSignature = 'signature'
  controller.reportSignature = 'signature'
  definition.openReportPdf.call(controller)
  controller._unloaded = true
  openOptions.fail({ errMsg: 'file not found' })
  assert.strictEqual(controller._reportPdfPath, '/user/report.pdf')
  assert.strictEqual(setDataCalls, 0, '卸载后的 PDF 打开失败回调不得改页面状态')

  controller._unloaded = false
  definition.shareReportPdf.call(controller)
  controller._unloaded = true
  shareOptions.fail({ errMsg: 'file not found' })
  assert.strictEqual(controller._reportPdfPath, '/user/report.pdf')
  assert.strictEqual(setDataCalls, 0, '卸载后的 PDF 分享失败回调不得改页面状态')

  controller._unloaded = false
  delete global.wx.shareFileMessage
  global.wx.showModal = (options) => { modalOptions = options }
  definition.shareReportPdf.call(controller)
  controller._unloaded = true
  const openCountBeforeStaleModal = openCalls
  modalOptions.success({ confirm: true })
  assert.strictEqual(openCalls, openCountBeforeStaleModal, '卸载后的 PDF 分享确认回调不得打开文件')

  controller._unloaded = false
  controller._activeReportPdfJob = {
    outputPath: '/user/partial.pdf',
    outputWriteStarted: false,
    tempPaths: new Set(['/tmp/page.jpg']),
  }
  definition.onHide.call(controller)
  assert.strictEqual(controller._activeReportPdfJob, null, '页面隐藏应取消活动中的 PDF 导出')
  assert.strictEqual(controller._reportPdfPath, '/user/report.pdf', '页面隐藏不得删除已完成 PDF')
  assert(removed.includes('/tmp/page.jpg') && !removed.includes('/user/report.pdf'))

  definition.openReportPdf.call(controller)
  openOptions.fail({ errMsg: 'file not found' })
  assert.strictEqual(controller._reportPdfPath, '', '缺失 PDF 应清空失效缓存以便重新生成')
  assert.strictEqual(controller.data.reportPdfPath, '')
  assert.match(controller.data.pdfStatusText, /重新生成/)

  controller._reportPdfPath = '/user/report.pdf'
  controller._reportPdfSignature = 'signature'
  controller.reportSignature = 'signature'
  const beforeUnloadSetDataCalls = setDataCalls
  definition.onUnload.call(controller)
  assert.strictEqual(controller._reportPdfPath, '')
  assert.deepStrictEqual(removed, ['/tmp/page.jpg', '/user/report.pdf'], '页面隐藏和卸载应清理对应 PDF 临时文件与缓存')
  assert.strictEqual(setDataCalls, beforeUnloadSetDataCalls, '页面卸载清理不得调用 setData')
  delete global.wx
}

async function main() {
  const pdf = createPdfFromJpegPages(fixturePages())
  const text = verifyXref(pdf)
  const pageBoxes = [...text.matchAll(/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/g)]
  assert.strictEqual(pageBoxes.length, 2)
  assert.strictEqual(Number(pageBoxes[0][1]), Number(pageBoxes[1][1]))
  assert(Math.abs(Number(pageBoxes[1][2]) - Number(pageBoxes[0][2]) * 2) < 0.002)
  assert(text.includes('/Width 4 /Height 8'))
  assert(/^厅_主控__-项目报告-19700101\d{6}-ab12\.pdf$/.test(makeReportPdfFileName('厅/主控:*', 0, 'ab12')))
  assert.throws(() => createPdfFromJpegPages([{ ...fixturePages()[0], data: Uint8Array.of(1, 2, 3, 4) }]), /完整的 JPEG/)
  assert.throws(() => createPdfFromJpegPages([{ ...fixturePages()[0], logicalHeight: 900 }]), /比例/)
  assert.throws(() => createPdfFromJpegPages(Array(121).fill(fixturePages()[0])), /页数/)

  await testExportPipeline()
  await testPageCallbacks()
  testStalePdfActionsAndUnload()
  console.log('项目报告 PDF writer/export 回归通过（多页、xref、原比例、命名、失败与过期清理）。')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

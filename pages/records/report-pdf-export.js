const {
  createPdfFromJpegPages,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_JPEG_BYTES,
  MAX_PAGES,
} = require('./report-pdf')

function byteLengthOf(value) {
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  return -1
}

function canceledError() {
  const error = new Error('PDF 导出已取消。')
  error.code = 'REPORT_PDF_CANCELED'
  return error
}

async function buildReportPdfFile(options = {}) {
  const pages = Array.isArray(options.pages) ? options.pages : []
  const outputPath = String(options.outputPath || '')
  const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true
  const exportJpeg = options.exportJpeg
  const getJpegSize = options.getJpegSize
  const readJpeg = options.readJpeg
  const writePdf = options.writePdf
  const removeFile = options.removeFile
  const tempPaths = options.tempPaths instanceof Set ? options.tempPaths : new Set()
  let outputWriteStarted = false

  const assertCurrent = () => {
    if (isCurrent() === false) throw canceledError()
  }
  const cleanupFile = async (filePath) => {
    if (!filePath || typeof removeFile !== 'function') return
    try { await removeFile(filePath) } catch (_) { /* Temp cleanup is best effort. */ }
  }

  if (!outputPath || typeof exportJpeg !== 'function' || typeof getJpegSize !== 'function'
    || typeof readJpeg !== 'function' || typeof writePdf !== 'function'
    || typeof removeFile !== 'function') {
    throw new TypeError('PDF 导出缺少文件或画布接口。')
  }
  if (!pages.length || pages.length > MAX_PAGES) {
    throw new RangeError(`PDF 页数必须在 1 到 ${MAX_PAGES} 页之间。`)
  }

  try {
    const jpegPages = []
    let totalJpegBytes = 0
    for (let index = 0; index < pages.length; index += 1) {
      assertCurrent()
      const page = pages[index]
      if (!page?.path) throw new Error(`第 ${index + 1} 页报告图片路径无效。`)
      const jpeg = await exportJpeg(page, index)
      if (jpeg?.path) tempPaths.add(jpeg.path)
      assertCurrent()
      if (!jpeg?.path || !Number.isInteger(jpeg.width) || !Number.isInteger(jpeg.height)) {
        throw new Error(`第 ${index + 1} 页 JPEG 转换结果无效。`)
      }
      if (jpeg.width < 1 || jpeg.height < 1 || jpeg.width > MAX_IMAGE_DIMENSION
        || jpeg.height > MAX_IMAGE_DIMENSION || jpeg.width * jpeg.height > MAX_IMAGE_PIXELS) {
        throw new RangeError(`第 ${index + 1} 页图片尺寸无效或超过上限。`)
      }

      const size = Number(await getJpegSize(jpeg.path))
      assertCurrent()
      if (!Number.isInteger(size) || size < 4 || size > MAX_JPEG_BYTES - totalJpegBytes) {
        throw new RangeError('报告图片总大小超过 PDF 导出上限。')
      }
      totalJpegBytes += size
      const data = await readJpeg(jpeg.path)
      assertCurrent()
      if (byteLengthOf(data) !== size) throw new Error(`第 ${index + 1} 页 JPEG 文件读取不完整。`)
      jpegPages.push({
        data,
        width: jpeg.width,
        height: jpeg.height,
        logicalWidth: Number(page.width) || jpeg.width,
        logicalHeight: Number(page.height) || jpeg.height,
      })
      await cleanupFile(jpeg.path)
      tempPaths.delete(jpeg.path)
      if (typeof options.onProgress === 'function') {
        assertCurrent()
        options.onProgress({ completedCount: index + 1, pageCount: pages.length })
      }
    }

    assertCurrent()
    const pdfBytes = createPdfFromJpegPages(jpegPages, options.pdfOptions)
    jpegPages.length = 0
    assertCurrent()
    outputWriteStarted = true
    const pdfBuffer = pdfBytes.byteOffset === 0 && pdfBytes.byteLength === pdfBytes.buffer.byteLength
      ? pdfBytes.buffer
      : pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)
    await writePdf(outputPath, pdfBuffer)
    assertCurrent()
    return { filePath: outputPath, pageCount: pages.length }
  } catch (error) {
    if (outputWriteStarted) await cleanupFile(outputPath)
    throw error
  } finally {
    for (const tempPath of [...tempPaths]) {
      await cleanupFile(tempPath)
      tempPaths.delete(tempPath)
    }
  }
}

module.exports = { buildReportPdfFile }

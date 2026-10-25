const DEFAULT_PAGE_WIDTH_POINTS = 595.28
const MAX_PAGES = 120
const MAX_IMAGE_DIMENSION = 8192
const MAX_IMAGE_PIXELS = 16777216
const MAX_JPEG_BYTES = 32 * 1024 * 1024

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new TypeError('JPEG 数据必须是 ArrayBuffer 或 Uint8Array。')
}

function asciiBytes(value) {
  const text = String(value)
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code > 0x7f) throw new TypeError('PDF 结构只允许 ASCII 字符。')
    bytes[index] = code
  }
  return bytes
}

function concatenate(parts) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(size)
  let offset = 0
  parts.forEach((part) => {
    output.set(part, offset)
    offset += part.byteLength
  })
  return output
}

function formatNumber(value) {
  return Number(value.toFixed(3)).toString()
}

function validatePage(page, index) {
  const bytes = asBytes(page?.data)
  const width = Number(page?.width)
  const height = Number(page?.height)
  const logicalWidth = Number(page?.logicalWidth ?? width)
  const logicalHeight = Number(page?.logicalHeight ?? height)
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_IMAGE_PIXELS) {
    throw new RangeError(`第 ${index + 1} 页图片尺寸无效或超过上限。`)
  }
  if (!Number.isFinite(logicalWidth) || !Number.isFinite(logicalHeight)
    || logicalWidth < 1 || logicalHeight < 1 || logicalHeight / logicalWidth > 24) {
    throw new RangeError(`第 ${index + 1} 页报告尺寸无效或超过上限。`)
  }
  const pixelAspect = width / height
  const logicalAspect = logicalWidth / logicalHeight
  if (Math.abs(pixelAspect / logicalAspect - 1) > 0.02) {
    throw new RangeError(`第 ${index + 1} 页像素比例与报告页面比例不匹配。`)
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.byteLength - 2] !== 0xff || bytes[bytes.byteLength - 1] !== 0xd9) {
    throw new TypeError(`第 ${index + 1} 页不是完整的 JPEG 图片。`)
  }
  return { bytes, width, height, logicalWidth, logicalHeight }
}

function createPdfFromJpegPages(pages, options = {}) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) {
    throw new RangeError(`PDF 页数必须在 1 到 ${MAX_PAGES} 页之间。`)
  }
  const pageWidthPoints = Number(options.pageWidthPoints) || DEFAULT_PAGE_WIDTH_POINTS
  if (!Number.isFinite(pageWidthPoints) || pageWidthPoints < 36 || pageWidthPoints > 1440) {
    throw new RangeError('PDF 页面宽度无效。')
  }
  const validatedPages = pages.map(validatePage)
  const totalImageBytes = validatedPages.reduce((total, page) => total + page.bytes.byteLength, 0)
  if (totalImageBytes > MAX_JPEG_BYTES) {
    throw new RangeError('报告图片总大小超过 PDF 导出上限。')
  }

  const objectCount = 2 + (validatedPages.length * 3)
  const objects = new Array(objectCount + 1)
  const pageObjectIds = validatedPages.map((page, index) => 3 + (index * 3))
  objects[1] = asciiBytes('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = asciiBytes(`<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`)

  validatedPages.forEach((page, index) => {
    const pageObjectId = pageObjectIds[index]
    const contentObjectId = pageObjectId + 1
    const imageObjectId = pageObjectId + 2
    const pageHeightPoints = pageWidthPoints * (page.logicalHeight / page.logicalWidth)
    const pageWidthText = formatNumber(pageWidthPoints)
    const pageHeightText = formatNumber(pageHeightPoints)
    const contents = asciiBytes(`q ${pageWidthText} 0 0 ${pageHeightText} 0 0 cm /Im0 Do Q`)

    objects[pageObjectId] = asciiBytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthText} ${pageHeightText}] `
      + `/Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    )
    objects[contentObjectId] = concatenate([
      asciiBytes(`<< /Length ${contents.byteLength} >>\nstream\n`),
      contents,
      asciiBytes('\nendstream'),
    ])
    objects[imageObjectId] = [
      asciiBytes(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.byteLength} >>\nstream\n`,
      ),
      page.bytes,
      asciiBytes('\nendstream'),
    ]
  })

  const parts = [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]
  const offsets = new Array(objectCount + 1).fill(0)
  let byteLength = parts[0].byteLength
  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    offsets[objectId] = byteLength
    const bodyParts = Array.isArray(objects[objectId]) ? objects[objectId] : [objects[objectId]]
    const objectParts = [
      asciiBytes(`${objectId} 0 obj\n`),
      ...bodyParts,
      asciiBytes('\nendobj\n'),
    ]
    parts.push(...objectParts)
    byteLength += objectParts.reduce((total, part) => total + part.byteLength, 0)
  }

  const xrefOffset = byteLength
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('')
  parts.push(asciiBytes(xref))
  return concatenate(parts)
}

function makeReportPdfFileName(projectName, timestamp = Date.now(), uniqueSuffix = '') {
  const safeName = String(projectName || '项目')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 36) || '项目'
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const suffix = String(uniqueSuffix || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16)
  return `${safeName}-项目报告-${stamp}${suffix ? `-${suffix}` : ''}.pdf`
}

module.exports = {
  DEFAULT_PAGE_WIDTH_POINTS,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_JPEG_BYTES,
  MAX_PAGES,
  createPdfFromJpegPages,
  makeReportPdfFileName,
}

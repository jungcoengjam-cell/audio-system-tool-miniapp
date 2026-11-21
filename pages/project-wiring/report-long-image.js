'use strict'

const SHORT_CANVAS_MAX_HEIGHT = 1800
const LONG_IMAGE_SEGMENT_HEIGHT = 768
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const ADLER_MOD = 65521
let pathSequence = 0

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[n] = value >>> 0
  }
  return table
})()

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
]
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]
const LENGTH_CODE = (() => {
  const result = new Array(259)
  LENGTH_BASE.forEach((base, index) => {
    const extraBits = LENGTH_EXTRA[index]
    const maximum = base + ((1 << extraBits) - 1)
    for (let length = base; length <= maximum; length += 1) {
      result[length] = { symbol: 257 + index, extraBits, extraValue: length - base }
    }
  })
  return result
})()

const FIXED_CODES = (() => {
  const result = new Array(288)
  for (let symbol = 0; symbol <= 287; symbol += 1) {
    let code
    let bits
    if (symbol <= 143) { code = 0x30 + symbol; bits = 8 }
    else if (symbol <= 255) { code = 0x190 + symbol - 144; bits = 9 }
    else if (symbol <= 279) { code = symbol - 256; bits = 7 }
    else { code = 0xc0 + symbol - 280; bits = 8 }
    let reversed = 0
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | (code & 1)
      code >>>= 1
    }
    result[symbol] = { code: reversed, bits }
  }
  return result
})()

const CANCELLED = Object.freeze({ cancelled: true })

function asError(value, fallback = '项目线路图片生成失败') {
  if (value instanceof Error) return value
  const error = new Error(String(value && (value.errMsg || value.message) || fallback))
  if (value && typeof value === 'object') error.detail = value
  return error
}

function notifyFailure(fail, error) {
  if (typeof fail !== 'function') return
  try { fail(asError(error)) } catch (_) { /* A consumer callback must not re-enter this export. */ }
}

function currentSafely(isCurrent) {
  try {
    return typeof isCurrent !== 'function' || isCurrent() !== false
  } catch (_) {
    return false
  }
}

function ensureCurrent(isCurrent) {
  if (!currentSafely(isCurrent)) throw CANCELLED
}

function callApi(target, method, options, thisArg) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(asError(error, `${method} 调用失败`))
      else resolve(value)
    }
    try {
      target[method]({
        ...options,
        success: (value) => finish(null, value),
        fail: (error) => finish(error || new Error(`${method} 调用失败`)),
      }, thisArg)
    } catch (error) {
      finish(error)
    }
  })
}

function drawContext(context) {
  return new Promise((resolve, reject) => {
    try { context.draw(false, resolve) } catch (error) { reject(error) }
  })
}

function setCanvasSize(pageContext, width, height) {
  return new Promise((resolve, reject) => {
    try {
      pageContext.setData({ reportCanvasWidth: width, reportCanvasHeight: height }, resolve)
    } catch (error) {
      reject(error)
    }
  })
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function writeUint32(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

function pngChunk(type, data) {
  const chunk = new Uint8Array(data.length + 12)
  writeUint32(chunk, 0, data.length)
  for (let index = 0; index < 4; index += 1) chunk[index + 4] = type.charCodeAt(index)
  chunk.set(data, 8)
  let crc = 0xffffffff
  for (let index = 4; index < 8; index += 1) crc = CRC_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8)
  for (let index = 0; index < data.length; index += 1) crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8)
  writeUint32(chunk, data.length + 8, (crc ^ 0xffffffff) >>> 0)
  return chunk
}

function pngHeader(width, height) {
  const ihdr = new Uint8Array(13)
  writeUint32(ihdr, 0, width)
  writeUint32(ihdr, 4, height)
  ihdr[8] = 8
  ihdr[9] = 2 // Truecolour RGB.
  const chunk = pngChunk('IHDR', ihdr)
  const header = new Uint8Array(PNG_SIGNATURE.length + chunk.length)
  header.set(PNG_SIGNATURE, 0)
  header.set(chunk, PNG_SIGNATURE.length)
  return header
}

function createDeflateWriter() {
  let bitValue = 0
  let bitCount = 0
  let output = null
  let outputOffset = 0

  const writeByte = (value) => {
    if (outputOffset >= output.length) throw new Error('PNG 压缩缓冲区不足')
    output[outputOffset] = value & 0xff
    outputOffset += 1
  }
  const writeBits = (value, count) => {
    let pending = value >>> 0
    for (let remaining = count; remaining > 0;) {
      const take = Math.min(8 - bitCount, remaining)
      bitValue |= (pending & ((1 << take) - 1)) << bitCount
      bitCount += take
      pending >>>= take
      remaining -= take
      if (bitCount === 8) {
        writeByte(bitValue)
        bitValue = 0
        bitCount = 0
      }
    }
  }
  const writeFixed = (symbol) => {
    const entry = FIXED_CODES[symbol]
    writeBits(entry.code, entry.bits)
  }
  const writeMatch = (length) => {
    const entry = LENGTH_CODE[length]
    writeFixed(entry.symbol)
    if (entry.extraBits) writeBits(entry.extraValue, entry.extraBits)
    writeBits(0, 5) // Fixed distance symbol 0 means distance 1.
  }

  return {
    beginSegment(rawByteCount) {
      output = new Uint8Array(Math.max(64, Math.ceil(((rawByteCount + 1) * 9) / 8) + 32))
      outputOffset = 0
    },
    beginBlock(finalBlock) {
      writeBits(finalBlock ? 1 : 0, 1)
      writeBits(1, 2) // BTYPE=01: fixed Huffman codes.
    },
    writeBytes(bytes) {
      for (let index = 0; index < bytes.length;) {
        if (bytes[index] !== 0) {
          writeFixed(bytes[index])
          index += 1
          continue
        }
        let end = index + 1
        while (end < bytes.length && bytes[end] === 0) end += 1
        let runLength = end - index
        if (runLength >= 4) {
          writeFixed(0)
          runLength -= 1
          while (runLength >= 3) {
            const length = Math.min(258, runLength)
            writeMatch(length)
            runLength -= length
          }
          while (runLength > 0) {
            writeFixed(0)
            runLength -= 1
          }
        } else {
          while (runLength > 0) {
            writeFixed(0)
            runLength -= 1
          }
        }
        index = end
      }
    },
    endBlock(finalBlock) {
      writeFixed(256)
      if (finalBlock && bitCount) {
        writeByte(bitValue)
        bitValue = 0
        bitCount = 0
      }
    },
    takeSegmentBytes() {
      const bytes = output.slice(0, outputOffset)
      output = null
      outputOffset = 0
      return bytes
    },
  }
}

function createAdler32() {
  let first = 1
  let second = 0
  let pending = 0
  return {
    update(bytes) {
      for (let index = 0; index < bytes.length; index += 1) {
        first += bytes[index]
        second += first
        pending += 1
        if (pending === 5552) {
          first %= ADLER_MOD
          second %= ADLER_MOD
          pending = 0
        }
      }
    },
    value() {
      first %= ADLER_MOD
      second %= ADLER_MOD
      return (second * 65536 + first) >>> 0
    },
  }
}

function createPngEncoder(width) {
  const deflater = createDeflateWriter()
  const adler = createAdler32()
  const row = new Uint8Array((width * 3) + 1)
  let started = false

  return {
    encodeSegment(rgba, segmentHeight, finalSegment) {
      deflater.beginSegment(row.length * segmentHeight)
      deflater.beginBlock(finalSegment)
      for (let y = 0; y < segmentHeight; y += 1) {
        row[0] = 1 // PNG Sub filter.
        const rgbaRow = y * width * 4
        for (let x = 0; x < width; x += 1) {
          const source = rgbaRow + (x * 4)
          const destination = 1 + (x * 3)
          const left = source - 4
          row[destination] = (rgba[source] - (x ? rgba[left] : 0)) & 0xff
          row[destination + 1] = (rgba[source + 1] - (x ? rgba[left + 1] : 0)) & 0xff
          row[destination + 2] = (rgba[source + 2] - (x ? rgba[left + 2] : 0)) & 0xff
        }
        adler.update(row)
        deflater.writeBytes(row)
      }
      deflater.endBlock(finalSegment)

      const compressed = deflater.takeSegmentBytes()
      let payload = compressed
      if (!started) {
        payload = new Uint8Array(compressed.length + 2)
        payload[0] = 0x78
        payload[1] = 0x01
        payload.set(compressed, 2)
        started = true
      }
      if (finalSegment) {
        const data = new Uint8Array(payload.length + 4)
        data.set(payload)
        writeUint32(data, payload.length, adler.value())
        payload = data
      }
      return pngChunk('IDAT', payload)
    },
  }
}

function normalizePixelData(result, width, height) {
  if (!result || (result.width !== undefined && result.width !== width)
    || (result.height !== undefined && result.height !== height)) return null
  const data = result.data
  if (data instanceof Uint8Array || (typeof Uint8ClampedArray !== 'undefined' && data instanceof Uint8ClampedArray)) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return data && typeof data.length === 'number' ? data : null
}

function uniqueFilePath(root) {
  const folder = root.replace(/[\\/]+$/, '')
  pathSequence += 1
  const random = Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')
  return `${folder}/pw-${Date.now().toString(36)}-${pathSequence.toString(36)}-${random}.png`
}

async function unlinkFile(fileSystem, path) {
  try {
    await callApi(fileSystem, 'unlink', { filePath: path })
    return true
  } catch (error) {
    return /no such file|not exist|enoent/i.test(error.message)
  }
}

function shortImage(options, width, height) {
  const { wx: wxApi, pageContext, canvasId, page, theme, draw, isCurrent, success, fail } = options
  let settled = false
  const finishFailure = (error) => {
    if (settled || !currentSafely(isCurrent)) return
    settled = true
    notifyFailure(fail, error)
  }

  if (typeof wxApi.createCanvasContext !== 'function' || typeof wxApi.canvasToTempFilePath !== 'function') {
    finishFailure(new Error('当前微信版本暂不支持生成图片'))
    return
  }
  try {
    pageContext.setData({ reportCanvasWidth: width, reportCanvasHeight: height }, () => {
      if (!currentSafely(isCurrent)) return
      try {
        const context = wxApi.createCanvasContext(canvasId, pageContext)
        draw(context, page, { theme, top: 0, height })
        context.draw(false, () => {
          if (!currentSafely(isCurrent)) return
          let exportSettled = false
          const onExport = (error, result) => {
            if (exportSettled || settled) return
            exportSettled = true
            if (!currentSafely(isCurrent)) {
              if (result && result.tempFilePath && typeof wxApi.getFileSystemManager === 'function') {
                try {
                  const fs = wxApi.getFileSystemManager()
                  if (fs && typeof fs.unlink === 'function') callApi(fs, 'unlink', { filePath: result.tempFilePath }).catch(() => {})
                } catch (_) { /* The platform also expires temporary canvas files. */ }
              }
              return
            }
            if (error) { finishFailure(error); return }
            if (!result || !result.tempFilePath) { finishFailure(new Error('图片导出没有生成临时文件')); return }
            settled = true
            try { success({ tempFilePath: result.tempFilePath }) } catch (_) { /* The caller owns the exported path. */ }
          }
          try {
            wxApi.canvasToTempFilePath({
              canvasId, x: 0, y: 0, width, height,
              destWidth: width * 2, destHeight: height * 2,
              fileType: 'png', quality: 1,
              success: (result) => onExport(null, result),
              fail: (error) => onExport(error || new Error('项目线路图片导出失败')),
            }, pageContext)
          } catch (error) {
            onExport(error)
          }
        })
      } catch (error) {
        finishFailure(error)
      }
    })
  } catch (error) {
    finishFailure(error)
  }
}

async function longImage(options, width, height, fileSystem) {
  const { wx: wxApi, pageContext, canvasId, page, theme, draw, isCurrent, success, fail } = options
  let path = ''
  let writeStarted = false
  let keepFile = false
  let failure = null

  try {
    ensureCurrent(isCurrent)
    path = uniqueFilePath(wxApi.env.USER_DATA_PATH)
    const encoder = createPngEncoder(width)
    writeStarted = true
    await callApi(fileSystem, 'writeFile', { filePath: path, data: toArrayBuffer(pngHeader(width, height)) })
    ensureCurrent(isCurrent)

    for (let top = 0; top < height; top += LONG_IMAGE_SEGMENT_HEIGHT) {
      const segmentHeight = Math.min(LONG_IMAGE_SEGMENT_HEIGHT, height - top)
      await setCanvasSize(pageContext, width, segmentHeight)
      ensureCurrent(isCurrent)
      const context = wxApi.createCanvasContext(canvasId, pageContext)
      draw(context, page, { theme, top, height: segmentHeight })
      await drawContext(context)
      ensureCurrent(isCurrent)
      const image = await callApi(wxApi, 'canvasGetImageData', {
        canvasId, x: 0, y: 0, width, height: segmentHeight,
      }, pageContext)
      ensureCurrent(isCurrent)
      const rgba = normalizePixelData(image, width, segmentHeight)
      if (!rgba || rgba.length !== width * segmentHeight * 4) throw new Error('画布像素数据长度无效')
      const idat = encoder.encodeSegment(rgba, segmentHeight, top + segmentHeight === height)
      await callApi(fileSystem, 'appendFile', { filePath: path, data: toArrayBuffer(idat) })
      ensureCurrent(isCurrent)
    }

    await callApi(fileSystem, 'appendFile', {
      filePath: path,
      data: toArrayBuffer(pngChunk('IEND', new Uint8Array(0))),
    })
    ensureCurrent(isCurrent)

    let releasePromise = null
    const release = () => {
      if (!releasePromise) releasePromise = unlinkFile(fileSystem, path)
      return releasePromise
    }
    keepFile = true
    try { success({ tempFilePath: path, release }) } catch (_) { release() }
  } catch (error) {
    if (error !== CANCELLED) failure = asError(error, '纵向长图生成失败')
  }

  if (!keepFile && path && writeStarted) {
    const removed = await unlinkFile(fileSystem, path)
    if (!removed && failure) failure.cleanupError = new Error('纵向长图临时文件清理失败')
  }
  if (failure && currentSafely(isCurrent)) {
    try { fail(failure) } catch (_) { /* Do not let a consumer callback re-enter this export. */ }
  }
}

function exportLongProjectImage(options = {}) {
  const {
    wx: wxApi, pageContext, canvasId, page, theme, draw,
    isCurrent = () => true, success, fail,
  } = options
  if (!wxApi || !pageContext || typeof pageContext.setData !== 'function' || !page
    || typeof draw !== 'function' || typeof success !== 'function' || typeof fail !== 'function'
    || typeof canvasId !== 'string' || !canvasId) {
    notifyFailure(fail, new Error('项目线路图片导出参数无效'))
    return
  }
  const width = Number(page.width)
  const height = Number(page.height)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > 0x7fffffff || height > 0x7fffffff
    || !Number.isSafeInteger((width * 3 + 1) * height)
    || !Number.isSafeInteger(width * Math.min(height, LONG_IMAGE_SEGMENT_HEIGHT) * 4)
    || width * Math.min(height, LONG_IMAGE_SEGMENT_HEIGHT) * 4 > 0x7fffffff) {
    notifyFailure(fail, new Error('项目线路图片尺寸无效'))
    return
  }
  if (!currentSafely(isCurrent)) return
  if (height <= SHORT_CANVAS_MAX_HEIGHT) {
    shortImage(options, width, height)
    return
  }
  if (typeof wxApi.createCanvasContext !== 'function' || typeof wxApi.canvasGetImageData !== 'function'
    || typeof wxApi.getFileSystemManager !== 'function' || !wxApi.env
    || typeof wxApi.env.USER_DATA_PATH !== 'string' || !wxApi.env.USER_DATA_PATH) {
    notifyFailure(fail, new Error('当前微信版本不支持生成纵向长图'))
    return
  }
  let fileSystem
  try { fileSystem = wxApi.getFileSystemManager() } catch (error) { notifyFailure(fail, error); return }
  if (!fileSystem || typeof fileSystem.writeFile !== 'function' || typeof fileSystem.appendFile !== 'function'
    || typeof fileSystem.unlink !== 'function') {
    notifyFailure(fail, new Error('当前微信版本不支持保存纵向长图'))
    return
  }
  longImage(options, width, height, fileSystem).catch((error) => {
    if (currentSafely(isCurrent)) notifyFailure(fail, error)
  })
}

module.exports = {
  exportLongProjectImage,
  SHORT_CANVAS_MAX_HEIGHT,
  LONG_IMAGE_SEGMENT_HEIGHT,
}

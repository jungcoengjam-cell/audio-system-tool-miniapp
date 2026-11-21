'use strict'

const assert = require('node:assert/strict')
const { inflateSync } = require('node:zlib')
const {
  exportLongProjectImage,
  SHORT_CANVAS_MAX_HEIGHT,
  LONG_IMAGE_SEGMENT_HEIGHT,
} = require('../pages/project-wiring/report-long-image')

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new TypeError('mock file-system received an unsupported buffer')
}

function callbackPromise(start) {
  return new Promise((resolve, reject) => start(resolve, reject))
}

function pixelAt(y, x) {
  return [(y + 11) & 0xff, (x * 31 + 17) & 0xff, (2 * y + 3 * x + 19) & 0xff]
}

function makeRuntime({ width, deferWrite = false, deferAppend = false, failAtTop = -1, pixel = pixelAt } = {}) {
  const files = new Map()
  const writes = []
  const appends = []
  const unlinks = []
  const sizes = []
  const pendingWrites = []
  const pending = []
  let currentPixels = null
  let activeTop = 0
  let activeHeight = 0
  const fs = {
    writeFile({ filePath, data, success, fail }) {
      const write = () => {
        try {
          assert(!files.has(filePath), 'unique output path must not overwrite another export')
          files.set(filePath, asBytes(data).slice())
          writes.push(filePath)
          success()
        } catch (error) { fail(error) }
      }
      if (deferWrite) pendingWrites.push({ success: write, fail })
      else write()
    },
    appendFile({ filePath, data, success, fail }) {
      const append = () => {
        try {
          const existing = files.get(filePath)
          assert(existing, 'append always targets this export file')
          const bytes = asBytes(data)
          const combined = new Uint8Array(existing.length + bytes.length)
          combined.set(existing)
          combined.set(bytes, existing.length)
          files.set(filePath, combined)
          appends.push(bytes.length)
          success()
        } catch (error) { fail(error) }
      }
      if (deferAppend && pending.length === 0) pending.push({ success: append, fail })
      else append()
    },
    unlink({ filePath, success, fail }) {
      unlinks.push(filePath)
      if (!files.delete(filePath)) {
        fail({ errMsg: 'unlink:fail ENOENT, file does not exist' })
        return
      }
      success()
    },
  }

  const wx = {
    env: { USER_DATA_PATH: 'wxfile://user-data' },
    getFileSystemManager: () => fs,
    createCanvasContext() {
      return {
        draw(reserve, callback) { callback() },
      }
    },
    canvasGetImageData({ width: imageWidth, height, success, fail }) {
      if (activeTop === failAtTop) {
        fail({ errMsg: 'canvasGetImageData:fail simulated read error' })
        return
      }
      assert.equal(imageWidth, width)
      assert.equal(height, activeHeight)
      success({ width: imageWidth, height, data: currentPixels })
    },
  }

  const pageContext = {
    data: {},
    setData(data, callback) {
      Object.assign(this.data, data)
      sizes.push({ ...data })
      if (callback) callback()
    },
  }

  const draw = (_context, _page, { top, height }) => {
    activeTop = top
    activeHeight = height
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color = pixel(top + y, x)
        const offset = (y * width + x) * 4
        pixels[offset] = color[0]
        pixels[offset + 1] = color[1]
        pixels[offset + 2] = color[2]
        pixels[offset + 3] = 255
      }
    }
    currentPixels = pixels
  }

  return {
    wx, pageContext, draw, files, writes, appends, unlinks, sizes, pendingWrites, pending,
    get activeTop() { return activeTop },
  }
}

function parsePng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  assert.deepEqual(Buffer.from(bytes.slice(0, 8)), signature, 'PNG signature is valid')
  const chunks = []
  let offset = 8
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length, 'PNG chunk header and CRC fit in file')
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
    const type = Buffer.from(bytes.slice(offset + 4, offset + 8)).toString('ascii')
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    assert(dataEnd + 4 <= bytes.length, `${type} chunk data and CRC fit in file`)
    const data = bytes.slice(dataStart, dataEnd)
    const crcInput = new Uint8Array(4 + length)
    crcInput.set(bytes.slice(offset + 4, offset + 8))
    crcInput.set(data, 4)
    const expectedCrc = crc32(crcInput)
    const actualCrc = new DataView(bytes.buffer, bytes.byteOffset + dataEnd, 4).getUint32(0, false)
    assert.equal(actualCrc, expectedCrc, `${type} chunk CRC is valid`)
    chunks.push({ type, data })
    offset = dataEnd + 4
    if (type === 'IEND') break
  }
  assert.equal(offset, bytes.length, 'IEND is the final PNG chunk')
  assert.equal(chunks[0].type, 'IHDR')
  assert.equal(chunks.at(-1).type, 'IEND')
  assert(chunks.some((chunk) => chunk.type === 'IDAT'))
  return chunks
}

function crc32(bytes) {
  let value = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    value ^= bytes[index]
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }
  return (value ^ 0xffffffff) >>> 0
}

function decodePngRgb(chunks) {
  const ihdr = chunks[0].data
  const width = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength).getUint32(0, false)
  const height = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength).getUint32(4, false)
  assert.equal(ihdr[8], 8, 'RGB PNG uses 8-bit channels')
  assert.equal(ihdr[9], 2, 'long export stores opaque RGB pixels')
  const dataLength = chunks.filter((chunk) => chunk.type === 'IDAT').reduce((total, chunk) => total + chunk.data.length, 0)
  const compressed = new Uint8Array(dataLength)
  let cursor = 0
  chunks.filter((chunk) => chunk.type === 'IDAT').forEach((chunk) => {
    compressed.set(chunk.data, cursor)
    cursor += chunk.data.length
  })
  const filtered = inflateSync(compressed)
  const stride = width * 3
  assert.equal(filtered.length, height * (stride + 1), 'inflated image has one filter byte per row')
  const rgb = new Uint8Array(height * stride)
  for (let y = 0; y < height; y += 1) {
    const source = y * (stride + 1)
    const target = y * stride
    assert.equal(filtered[source], 1, 'every row uses PNG Sub filter')
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 3 ? rgb[target + index - 3] : 0
      rgb[target + index] = (filtered[source + 1 + index] + left) & 0xff
    }
  }
  return { width, height, rgb }
}

function checkPixel(decoded, y, x) {
  const offset = (y * decoded.width + x) * 3
  assert.deepEqual([...decoded.rgb.slice(offset, offset + 3)], pixelAt(y, x), `pixel (${x}, ${y}) is unchanged`)
}

async function testLongImagePngAndRelease() {
  const width = 4
  const height = SHORT_CANVAS_MAX_HEIGHT + 1
  const runtime = makeRuntime({ width })
  const output = await callbackPromise((resolve, reject) => exportLongProjectImage({
    wx: runtime.wx,
    pageContext: runtime.pageContext,
    canvasId: 'wiringReportCanvas',
    page: { width, height },
    theme: 'dark',
    draw: runtime.draw,
    isCurrent: () => true,
    success: resolve,
    fail: reject,
  }))
  assert.equal(runtime.files.size, 1, 'a long export leaves exactly one output file')
  assert.equal(runtime.writes.length, 1, 'one private PNG file is created')
  assert.equal(runtime.appends.length, Math.ceil(height / LONG_IMAGE_SEGMENT_HEIGHT) + 1,
    'one IDAT append per canvas segment plus one IEND append')
  assert.equal(runtime.sizes.at(-1).reportCanvasHeight, height % LONG_IMAGE_SEGMENT_HEIGHT,
    'the final canvas allocation contains only the remaining rows')
  assert.match(output.tempFilePath, /^wxfile:\/\/user-data\/pw-[^/]+\.png$/)
  assert(output.tempFilePath.length < 100, 'the private output path stays short')
  assert.equal(typeof output.release, 'function')

  const chunks = parsePng(runtime.files.get(output.tempFilePath))
  const decoded = decodePngRgb(chunks)
  assert.equal(decoded.width, width)
  assert.equal(decoded.height, height)
  checkPixel(decoded, 0, 0)
  checkPixel(decoded, 767, width - 1)
  checkPixel(decoded, 768, 0)
  checkPixel(decoded, height - 1, width - 1)

  const [firstRelease, secondRelease] = await Promise.all([output.release(), output.release()])
  assert.equal(firstRelease, true)
  assert.equal(secondRelease, true, 'release is idempotent')
  assert.equal(runtime.files.size, 0, 'release removes this export file')
  assert.equal(runtime.unlinks.length, 1, 'concurrent release calls unlink only once')
}

async function testLongImageFailureCleansFile() {
  const width = 4
  const height = SHORT_CANVAS_MAX_HEIGHT + 1
  const runtime = makeRuntime({ width, failAtTop: LONG_IMAGE_SEGMENT_HEIGHT })
  const error = await callbackPromise((resolve, reject) => exportLongProjectImage({
    wx: runtime.wx,
    pageContext: runtime.pageContext,
    canvasId: 'wiringReportCanvas',
    page: { width, height },
    draw: runtime.draw,
    isCurrent: () => true,
    success: () => reject(new Error('failed export must not call success')),
    fail: resolve,
  }))
  assert(error instanceof Error)
  assert.match(error.message, /canvasGetImageData/)
  assert.equal(runtime.files.size, 0, 'failed exports remove the partial PNG')
  assert.equal(runtime.unlinks.length, 1)
}

async function testLongFlatBackgroundUsesDistanceRuns() {
  const width = 720
  const height = SHORT_CANVAS_MAX_HEIGHT + 1
  const background = [35, 48, 60]
  const runtime = makeRuntime({ width, pixel: () => background })
  const output = await callbackPromise((resolve, reject) => exportLongProjectImage({
    wx: runtime.wx,
    pageContext: runtime.pageContext,
    canvasId: 'wiringReportCanvas',
    page: { width, height },
    draw: runtime.draw,
    isCurrent: () => true,
    success: resolve,
    fail: reject,
  }))
  const png = runtime.files.get(output.tempFilePath)
  const chunks = parsePng(png)
  const decoded = decodePngRgb(chunks)
  assert.equal(decoded.width, width)
  assert.equal(decoded.height, height)
  for (const [y, x] of [[0, 0], [height - 1, width - 1]]) {
    const offset = (y * width + x) * 3
    assert.deepEqual([...decoded.rgb.slice(offset, offset + 3)], background)
  }
  assert(png.length < width * height, 'fixed-Huffman distance-1 runs compress a flat report well')
  await output.release()
  assert.equal(runtime.files.size, 0)
}

async function testCancellationCleansLateWrite() {
  const width = 4
  const height = SHORT_CANVAS_MAX_HEIGHT + 1
  const runtime = makeRuntime({ width, deferAppend: true })
  let current = true
  let succeeded = false
  let failed = false
  exportLongProjectImage({
    wx: runtime.wx,
    pageContext: runtime.pageContext,
    canvasId: 'wiringReportCanvas',
    page: { width, height },
    draw: runtime.draw,
    isCurrent: () => current,
    success: () => { succeeded = true },
    fail: () => { failed = true },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runtime.pending.length, 1, 'first IDAT file append is pending')
  current = false
  runtime.pending[0].success()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(succeeded, false, 'cancelled export does not commit')
  assert.equal(failed, false, 'cancellation is silent')
  assert.equal(runtime.files.size, 0, 'late append completion is cleaned up')
  assert.equal(runtime.unlinks.length, 1)
}

async function testCancellationCleansLateHeaderWrite() {
  const width = 4
  const height = SHORT_CANVAS_MAX_HEIGHT + 1
  const runtime = makeRuntime({ width, deferWrite: true })
  let current = true
  let succeeded = false
  let failed = false
  exportLongProjectImage({
    wx: runtime.wx,
    pageContext: runtime.pageContext,
    canvasId: 'wiringReportCanvas',
    page: { width, height },
    draw: runtime.draw,
    isCurrent: () => current,
    success: () => { succeeded = true },
    fail: () => { failed = true },
  })
  assert.equal(runtime.pendingWrites.length, 1, 'PNG header write is pending')
  current = false
  runtime.pendingWrites[0].success()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(succeeded, false)
  assert.equal(failed, false, 'cancellation remains silent after a late header write')
  assert.equal(runtime.files.size, 0, 'late header write success is immediately cleaned up')
  assert.equal(runtime.unlinks.length, 1)
}

function testShortImageKeepsLegacyExport() {
  const width = 720
  const height = 100
  let exportOptions
  let drawOptions
  let successValue
  let failureValue
  const pageContext = { setData(data, callback) { this.data = data; callback() } }
  const wx = {
    createCanvasContext(canvasId) {
      assert.equal(canvasId, 'wiringReportCanvas')
      return { draw(_reserve, callback) { callback() } }
    },
    canvasToTempFilePath(options) {
      exportOptions = options
      options.success({ tempFilePath: 'wxfile://short-report.png' })
    },
  }
  exportLongProjectImage({
    wx,
    pageContext,
    canvasId: 'wiringReportCanvas',
    page: { width, height },
    theme: 'light',
    draw: (_context, _page, options) => { drawOptions = options },
    isCurrent: () => true,
    success: (value) => { successValue = value },
    fail: (error) => { failureValue = error },
  })
  assert.equal(failureValue, undefined)
  assert.deepEqual(drawOptions, { theme: 'light', top: 0, height })
  assert.deepEqual(pageContext.data, { reportCanvasWidth: width, reportCanvasHeight: height })
  assert.equal(exportOptions.destWidth, width * 2)
  assert.equal(exportOptions.destHeight, height * 2)
  assert.deepEqual(successValue, { tempFilePath: 'wxfile://short-report.png' })
}

async function main() {
  testShortImageKeepsLegacyExport()
  await testLongImagePngAndRelease()
  await testLongFlatBackgroundUsesDistanceRuns()
  await testLongImageFailureCleansFile()
  await testCancellationCleansLateWrite()
  await testCancellationCleansLateHeaderWrite()
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    cases: ['short legacy export', 'long RGB PNG round trip', 'flat-background compression', 'failure cleanup',
      'late append cancellation cleanup', 'late header-write cancellation cleanup'],
  })}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})

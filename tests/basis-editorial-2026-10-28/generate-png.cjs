'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { launch, delay } = require('../homepage-refactor-2026-10-18/browser-driver.cjs')

const root = path.resolve(__dirname, '../..')
const sourceDir = path.join(__dirname, 'diagrams')
const assetDir = path.join(root, 'pages/basis/assets')
const ids = ['cable', 'gainStructure', 'limiter', 'spl', 'camera', 'ledScreen']

function pngChunks(buffer) {
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) })
    offset += length + 12
  }
  return chunks
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function decodeRgbPng(buffer) {
  const chunks = pngChunks(buffer)
  const header = chunks.find(({ type }) => type === 'IHDR').data
  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  const channels = header[9] === 2 ? 3 : header[9] === 6 ? 4 : 0
  if (header[8] !== 8 || !channels || header[12] !== 0) throw new Error('Expected non-interlaced 8-bit RGB/RGBA screenshot PNG')
  const packed = zlib.inflateSync(Buffer.concat(chunks.filter(({ type }) => type === 'IDAT').map(({ data }) => data)))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const inputOffset = y * (stride + 1)
    const filter = packed[inputOffset]
    const rowOffset = y * stride
    const previousOffset = rowOffset - stride
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0
      const up = y > 0 ? pixels[previousOffset + x] : 0
      const upperLeft = y > 0 && x >= channels ? pixels[previousOffset + x - channels] : 0
      const value = packed[inputOffset + 1 + x]
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = Math.floor((left + up) / 2)
      else if (filter === 4) predictor = paeth(left, up, upperLeft)
      else if (filter !== 0) throw new Error('Unsupported PNG filter: ' + filter)
      pixels[rowOffset + x] = (value + predictor) & 255
    }
  }
  return { width, height, channels, pixels }
}

function makePalette(pixels, channels, count = 120) {
  const histogram = new Map()
  for (let offset = 0; offset < pixels.length; offset += channels) {
    const key = pixels[offset] * 65536 + pixels[offset + 1] * 256 + pixels[offset + 2]
    histogram.set(key, (histogram.get(key) || 0) + 1)
  }
  const colors = [...histogram].map(([key, weight]) => ({
    r: key >>> 16,
    g: (key >>> 8) & 255,
    b: key & 255,
    weight,
  }))
  let boxes = [colors]
  while (boxes.length < count) {
    let selected = -1
    let selectedScore = -1
    let selectedChannel = 'r'
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i]
      if (box.length < 2) continue
      const ranges = ['r', 'g', 'b'].map((channel) => {
        let min = 255, max = 0
        for (const color of box) { min = Math.min(min, color[channel]); max = Math.max(max, color[channel]) }
        return { channel, range: max - min }
      }).sort((a, b) => b.range - a.range)
      const weight = box.reduce((sum, color) => sum + color.weight, 0)
      const score = ranges[0].range * Math.log2(weight + 1)
      if (score > selectedScore) { selected = i; selectedScore = score; selectedChannel = ranges[0].channel }
    }
    if (selected < 0 || selectedScore <= 0) break
    const box = boxes[selected].sort((a, b) => a[selectedChannel] - b[selectedChannel])
    const total = box.reduce((sum, color) => sum + color.weight, 0)
    let accumulated = 0, split = 1
    for (; split < box.length; split += 1) {
      accumulated += box[split - 1].weight
      if (accumulated >= total / 2) break
    }
    if (split >= box.length) split = box.length - 1
    boxes.splice(selected, 1, box.slice(0, split), box.slice(split))
  }
  const palette = boxes.map((box) => {
    const total = box.reduce((sum, color) => sum + color.weight, 0)
    const average = (channel) => Math.round(box.reduce((sum, color) => sum + color[channel] * color.weight, 0) / total)
    return [average('r'), average('g'), average('b')]
  })
  return palette
}

function crcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = crcTable()
function crc32(buffer) {
  let crc = 0xffffffff
  for (const value of buffer) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, data.length + 8)), data.length + 8)
  return chunk
}

function encodeIndexedPng(decoded, palette) {
  const { width, height, channels, pixels } = decoded
  const lookup = new Uint8Array(32 * 32 * 32)
  for (let r = 0; r < 32; r += 1) for (let g = 0; g < 32; g += 1) for (let b = 0; b < 32; b += 1) {
    const red = r * 8 + 4, green = g * 8 + 4, blue = b * 8 + 4
    let best = 0, bestDistance = Infinity
    for (let i = 0; i < palette.length; i += 1) {
      const color = palette[i]
      const dr = red - color[0], dg = green - color[1], db = blue - color[2]
      const distance = dr * dr * 3 + dg * dg * 4 + db * db * 2
      if (distance < bestDistance) { best = i; bestDistance = distance }
    }
    lookup[(r << 10) | (g << 5) | b] = best
  }
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels
      const index = ((pixels[offset] >> 3) << 10) | ((pixels[offset + 1] >> 3) << 5) | (pixels[offset + 2] >> 3)
      raw[row + 1 + x] = lookup[index]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 3
  const plte = Buffer.from(palette.flat())
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('PLTE', plte),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function quantizePng(buffer) {
  const decoded = decodeRgbPng(buffer)
  return encodeIndexedPng(decoded, makePalette(decoded.pixels, decoded.channels))
}

async function main() {
  const browser = await launch()
  const outputs = []
  try {
    await browser.viewport(750, 560, 'light')
    for (const id of ids) {
      if (!fs.existsSync(path.join(sourceDir, id + '.svg'))) throw new Error('Missing editable SVG source: ' + id)
      const url = `http://127.0.0.1:${browser.port}/tests/basis-editorial-2026-10-28/render.html?id=${id}`
      await browser.send('Page.navigate', { url })
      let image
      for (let attempt = 0; attempt < 80; attempt += 1) {
        image = await browser.evaluate('(() => { const node=document.querySelector("#illustration"); return node && {complete:node.complete,width:node.naturalWidth,height:node.naturalHeight} })()')
        if (image && image.complete && image.width === 750 && image.height === 560) break
        await delay(50)
      }
      if (!image || !image.complete || image.width !== 750 || image.height !== 560) {
        throw new Error(id + ' SVG did not render at 750 × 560: ' + JSON.stringify(image))
      }
      const screenshot = await browser.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 750, height: 560, scale: 1 },
      })
      const file = path.join(assetDir, id + '.png')
      const bytes = quantizePng(Buffer.from(screenshot.data, 'base64'))
      fs.writeFileSync(file, bytes)
      outputs.push({ name: path.basename(file), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length })
    }
  } finally {
    await browser.close()
  }
  console.log(JSON.stringify({ outputDir: assetDir, outputs, totalBytes: outputs.reduce((sum, item) => sum + item.bytes, 0) }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

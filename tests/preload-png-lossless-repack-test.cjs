'use strict'

// These three PNGs are used in the Wi-Fi-preloaded audio-wiring subpackage.
// Their original source hashes remain recorded in the baseline; only the
// lossless IDAT byte stream was repacked to reduce the package size.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')

const root = path.resolve(__dirname, '..')
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'preload-png-lossless-repack-baseline.json'), 'utf8'))
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const crcTable = new Uint32Array(256)
for (let value = 0; value < 256; value++) {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  crcTable[value] = crc >>> 0
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function parsePng(bytes, file) {
  assert(bytes.subarray(0, 8).equals(signature), `${file}: PNG signature`)
  const chunks = []
  let offset = 8
  while (offset < bytes.length) {
    const start = offset
    const length = bytes.readUInt32BE(offset)
    offset += 4
    assert(offset + 4 + length + 4 <= bytes.length, `${file}: complete chunk`)
    const type = bytes.toString('ascii', offset, offset + 4)
    offset += 4
    const data = bytes.subarray(offset, offset + length)
    offset += length
    const expectedCrc = bytes.readUInt32BE(offset)
    assert.equal(crc32(bytes.subarray(start + 4, offset)), expectedCrc, `${file}: ${type} CRC`)
    offset += 4
    chunks.push({ type, data, raw: bytes.subarray(start, offset) })
    if (type === 'IEND') break
  }
  assert.equal(offset, bytes.length, `${file}: no trailing bytes after IEND`)
  assert.equal(chunks[0]?.type, 'IHDR', `${file}: IHDR first`)
  assert.equal(chunks.at(-1)?.type, 'IEND', `${file}: IEND last`)
  return chunks
}

const results = []
let totalSavedBytes = 0
for (const [file, expected] of Object.entries(baseline.assets)) {
  const bytes = fs.readFileSync(path.join(root, file))
  const chunks = parsePng(bytes, file)
  const currentSha256 = sha256(bytes)
  assert.equal(bytes.length, expected.repackedBytes, `${file}: repacked byte size`)
  assert.equal(currentSha256, expected.repackedSha256, `${file}: repacked byte hash`)

  const idat = chunks.filter((chunk) => chunk.type === 'IDAT')
  assert.equal(idat.length, expected.repackedIdatChunks, `${file}: merged IDAT count`)
  const scanlines = zlib.inflateSync(Buffer.concat(idat.map((chunk) => chunk.data)))
  assert.equal(scanlines.length, expected.rawScanlineBytes, `${file}: raw scanline byte count`)
  assert.equal(sha256(scanlines), expected.rawScanlineSha256, `${file}: original decoded scanline bytes`)

  const header = chunks[0].data
  assert.deepEqual({
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
    bitDepth: header[8],
    colorType: header[9],
  }, expected.ihdr, `${file}: unchanged image dimensions and format`)

  const nonIdat = chunks.filter((chunk) => chunk.type !== 'IDAT')
  assert.deepEqual(chunks.map((chunk) => chunk.type), expected.repackedChunkTypes, `${file}: chunk order`)
  assert.deepEqual(nonIdat.map((chunk) => ({ type: chunk.type, rawChunkSha256: sha256(chunk.raw) })),
    expected.nonIdatChunks, `${file}: unchanged non-IDAT chunks and metadata`)
  assert.equal(sha256(Buffer.concat(nonIdat.map((chunk) => chunk.raw))), expected.nonIdatChunksSha256,
    `${file}: unchanged color and transparency metadata bytes`)

  const savedBytes = expected.originalBytes - bytes.length
  assert.equal(savedBytes, expected.savedBytes, `${file}: recorded byte savings`)
  assert(savedBytes > 0, `${file}: smaller source image`)
  totalSavedBytes += savedBytes
  results.push({
    file,
    originalSha256: expected.originalSha256,
    repackedSha256: currentSha256,
    originalBytes: expected.originalBytes,
    repackedBytes: bytes.length,
    savedBytes,
    originalIdatChunks: expected.originalIdatChunks,
    repackedIdatChunks: idat.length,
    rawScanlineSha256: sha256(scanlines),
    nonIdatChunksUnchanged: true,
  })
}

assert.equal(totalSavedBytes, 17919, 'all three lossless repacks retain the reviewed byte savings')
console.log(JSON.stringify({ passed: true, totalSavedBytes, assets: results }, null, 2))

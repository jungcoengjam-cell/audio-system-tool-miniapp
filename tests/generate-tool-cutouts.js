const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const inputDir = path.join(root, 'assets', 'home')
const names = [
  'module-cable-catalog.jpg',
  'module-camera-catalog.jpg',
  'module-dmx-address-catalog.jpg',
  'module-gain-structure-catalog.jpg',
  'module-led-screen-catalog.jpg',
  'module-limiter-catalog.jpg',
  'module-spl-catalog.jpg',
]

function applyWhiteMatte(data) {
  // Remove a white matte per pixel while preserving dark bodies and saturated beams.
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    const r = data[pixel]
    const g = data[pixel + 1]
    const b = data[pixel + 2]
    const minimum = Math.min(r, g, b)
    const chroma = Math.max(r, g, b) - minimum
    if (minimum >= 249 && chroma <= 6) {
      data[pixel + 3] = 0
      continue
    }
    const alpha = Math.max(0, Math.min(1, (255 - minimum) / 75))
    if (alpha >= 1) {
      data[pixel + 3] = 255
      continue
    }
    data[pixel] = Math.max(0, Math.min(255, Math.round((r - 255 * (1 - alpha)) / alpha)))
    data[pixel + 1] = Math.max(0, Math.min(255, Math.round((g - 255 * (1 - alpha)) / alpha)))
    data[pixel + 2] = Math.max(0, Math.min(255, Math.round((b - 255 * (1 - alpha)) / alpha)))
    data[pixel + 3] = Math.round(255 * alpha)
  }
}

function pointInPolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function restoreLedPanel(data, source, width, height) {
  // This fixed polygon protects the LED panel's internal highlight from matte removal.
  const polygon = [[31, 43], [237, 76], [237, 188], [31, 204]]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!pointInPolygon(x, y, polygon)) continue
      const offset = (y * width + x) * 4
      data[offset] = source[offset]
      data[offset + 1] = source[offset + 1]
      data[offset + 2] = source[offset + 2]
      data[offset + 3] = 255
    }
  }
}

async function main() {
  if (!process.argv[2]) {
    console.error('Usage: node tests/generate-tool-cutouts.js <output-directory>')
    process.exit(1)
  }
  const sharp = require(process.env.SHARP_PATH || 'sharp')
  const outputDir = path.resolve(process.argv[2])
  const paletteDir = path.join(outputDir, 'palette128')
  fs.mkdirSync(paletteDir, { recursive: true })
  const results = []
  for (const name of names) {
    const input = path.join(inputDir, name)
    const image = sharp(input)
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const source = Buffer.from(data)
    applyWhiteMatte(data)
    if (name === 'module-led-screen-catalog.jpg') restoreLedPanel(data, source, info.width, info.height)
    const output = path.join(paletteDir, name.replace(/\.jpg$/i, '.png'))
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9, palette: true, colours: 128, dither: 0, effort: 10 })
      .toFile(output)
    const decoded = await sharp(output).ensureAlpha().raw().toBuffer()
    let transparent = 0
    let semiTransparent = 0
    for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
      const alpha = decoded[pixel * 4 + 3]
      if (alpha === 0) transparent += 1
      else if (alpha < 255) semiTransparent += 1
    }
    results.push({ variant: 'palette128', name, output, width: info.width, height: info.height, transparent, semiTransparent, bytes: fs.statSync(output).size })
  }
  const summary = { outputDir, images: results }
  fs.writeFileSync(path.join(outputDir, 'alpha-stats.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

module.exports = { applyWhiteMatte, pointInPolygon, restoreLedPanel }

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error)
    process.exitCode = 1
  })
}

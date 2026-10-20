const path = require('path')
const { createCanvas, loadImage } = require('C:/Users/wxx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')

const directory = __dirname
const width = 460
const height = 240
const photoSize = 140
const photoY = 42
const maleX = 22
const femaleX = 298
const palette = { background: '#f5f6f8', text: '#20242a', positive: '#1976d2', negative: '#9a5b00', shield: '#5f6872' }

function alphaSummary(image) {
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const { data } = context.getImageData(0, 0, image.width, image.height)
  let left = image.width
  let right = -1
  let top = image.height
  let bottom = -1
  let transparent = 0
  let edgePixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = data[((y * image.width) + x) * 4 + 3]
      if (alpha === 0) {
        transparent += 1
      } else {
        if ((x === 0 || x === image.width - 1 || y === 0 || y === image.height - 1) && alpha > 16) edgePixels += 1
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  return { width: image.width, height: image.height, alphaBounds: { left, top, right, bottom },
    transparentPixels: transparent, visibleEdgePixels: edgePixels }
}

function pin(imageX, originalX, originalY) {
  return { x: imageX + ((originalX / 1280) * photoSize), y: photoY + ((originalY / 1280) * photoSize) }
}

function strokeCurve(context, start, end, c1, c2, color) {
  context.beginPath()
  context.moveTo(start.x, start.y)
  context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
  context.strokeStyle = palette.background
  context.lineWidth = 6
  context.lineCap = 'round'
  context.stroke()
  context.strokeStyle = color
  context.lineWidth = 2.5
  context.stroke()
}

function drawPinLabel(context, label, x, y, color) {
  context.font = '600 14px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const width = context.measureText(label).width + 10
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.roundRect(x - (width / 2), y - 9, width, 18, 8)
  context.fill()
  context.fillStyle = color
  context.fillText(label, x, y)
}

async function main() {
  const malePath = path.join(directory, 'xlr-male-rear-candidate.png')
  const femalePath = path.join(directory, 'xlr-female-rear-candidate.png')
  const [male, female] = await Promise.all([loadImage(malePath), loadImage(femalePath)])
  console.log(JSON.stringify({ male: alphaSummary(male), female: alphaSummary(female) }, null, 2))

  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = palette.background
  context.fillRect(0, 0, width, height)
  context.textBaseline = 'alphabetic'
  context.textAlign = 'center'
  context.font = '600 16px sans-serif'
  context.fillStyle = palette.text
  context.fillText('XLR rear solder-side preview / AI-cutout candidates', width / 2, 20)
  context.font = '500 14px sans-serif'
  context.fillText('OUTPUT · MALE', maleX + photoSize / 2, 37)
  context.fillText('INPUT · FEMALE', femaleX + photoSize / 2, 37)

  context.drawImage(male, maleX, photoY, photoSize, photoSize)
  context.drawImage(female, femaleX, photoY, photoSize, photoSize)

  const malePin2 = pin(maleX, 329, 633)
  const malePin1 = pin(maleX, 915, 633)
  const malePin3 = pin(maleX, 616, 915)
  const femalePin1 = pin(femaleX, 390, 662)
  const femalePin2 = pin(femaleX, 892, 662)
  const femalePin3 = pin(femaleX, 631, 910)

  strokeCurve(context, malePin1, femalePin1,
    { x: 168, y: 72 }, { x: 266, y: 72 }, palette.shield)
  strokeCurve(context, malePin2, femalePin2,
    { x: 140, y: 164 }, { x: 306, y: 164 }, palette.positive)
  strokeCurve(context, malePin3, femalePin3,
    { x: 166, y: 215 }, { x: 270, y: 215 }, palette.negative)

  drawPinLabel(context, '1', 230, 77, palette.shield)
  drawPinLabel(context, '2', 230, 166, palette.positive)
  drawPinLabel(context, '3', 230, 215, palette.negative)
  context.font = '400 11px sans-serif'
  context.fillStyle = '#5f6872'
  context.textAlign = 'center'
  context.fillText('Matching pin numbers; colors only distinguish leads', width / 2, 235)

  const output = path.join(directory, 'xlr-left-output-right-input-preview.png')
  require('node:fs').writeFileSync(output, canvas.toBuffer('image/png'))
  console.log(`preview=${output}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

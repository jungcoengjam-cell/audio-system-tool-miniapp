const assert = require('node:assert/strict')
const model = require('../../pages/dmx-layout/layout-model')
const renderer = require('../../pages/dmx-layout/layout-renderer')

function mockCanvas({ nativeMeasure = true } = {}) {
  let fontSize = 16
  let textAlign = 'left'
  const labels = []
  const widthOf = (value) => Array.from(String(value)).length * fontSize * .84
  const methods = {
    setFontSize(value) { fontSize = Number(value) },
    setTextAlign(value) { textAlign = value },
    fillText(value, x, y) {
      const width = widthOf(value)
      labels.push({ value: String(value), x, y, width, left: textAlign === 'right' ? x - width : x })
    },
  }
  if (nativeMeasure) methods.measureText = (value) => ({ width: widthOf(value) })
  const ctx = new Proxy(methods, {
    get(target, name) {
      if (name in target) return target[name]
      return () => {}
    },
  })
  return { ctx, labels }
}

function renderDepthLabel(depth, direction, nativeMeasure) {
  const layout = {
    stageWidthText: '200',
    stageDepthText: String(depth),
    apronDirection: direction,
    internalRods: [],
    frontRods: [],
    legacySideRods: [],
    positionsById: {},
  }
  const geometry = model.createStageGeometry(layout, 390, 740)
  const canvas = mockCanvas({ nativeMeasure })
  renderer.renderStageDiagram(canvas.ctx, {
    layout,
    fixtures: [],
    geometry,
    theme: renderer.getCanvasTheme('light'),
  }, {
    view: { s: 1, x: 0, y: 0 },
    backgroundWidth: 390,
    backgroundHeight: 740,
    pixelRatio: 2,
  })
  return canvas.labels.find((label) => label.value === `${depth} m`)
}

for (const direction of model.APRON_DIRECTIONS) {
  for (const depth of [8, 100, 200]) {
    const label = renderDepthLabel(depth, direction, true)
    assert(label, `Missing ${depth} m ruler label for ${direction}`)
    assert(label.left >= 14, `${depth} m ruler label clipped for ${direction}: left=${label.left}`)
  }
}

const fallbackLabel = renderDepthLabel(100, 'bottom', false)
assert(fallbackLabel && fallbackLabel.left >= 14,
  `Fallback ruler width estimate clipped the label: left=${fallbackLabel && fallbackLabel.left}`)

console.log('Canvas depth ruler labels stay inside the viewport with native and fallback measurement')

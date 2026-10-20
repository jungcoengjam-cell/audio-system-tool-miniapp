const assert = require('node:assert/strict')
const model = require('../../pages/dmx-layout/layout-model')
const renderer = require('../../pages/dmx-layout/layout-renderer')

function renderLabels({ width, depth, scale = 1, view } = {}) {
  const layout = {
    stageWidthText: String(width || 12),
    stageDepthText: String(depth || 8),
    apronDirection: 'bottom',
    internalRods: [
      { id: 'inner-back', distance: 6.4 },
      { id: 'inner-mid', distance: 4 },
      { id: 'inner-front', distance: 1.6 },
    ],
    frontRods: [{ id: 'front-1', distance: 2.8 }],
    legacySideRods: [],
    positionsById: {},
  }
  const geometry = model.createStageGeometry(layout, 780, 1480)
  const labels = []
  let fontSize = 16
  let textAlign = 'left'
  const measure = (value) => Array.from(String(value)).reduce((total, char) => {
    if (/\s/.test(char)) return total + fontSize * .35
    if (/[\u2e80-\u9fff\uf900-\ufaff]/.test(char)) return total + fontSize
    if (/^[0-9.,-]$/.test(char)) return total + fontSize * .56
    return total + fontSize * .62
  }, 0)
  const methods = {
    setFontSize(value) { fontSize = Number(value) },
    setTextAlign(value) { textAlign = value },
    measureText(value) { return { width: measure(value) } },
    fillText(value, x, y) {
      const content = String(value)
      const textWidth = measure(content)
      const left = textAlign === 'right' ? x - textWidth : textAlign === 'center' ? x - textWidth / 2 : x
      labels.push({ value: content, x, y, fontSize, left, right: left + textWidth, top: y - fontSize * .9, bottom: y + fontSize * .25 })
    },
  }
  const ctx = new Proxy(methods, {
    get(target, key) { return key in target ? target[key] : () => {} },
  })
  renderer.renderStageDiagram(ctx, {
    layout,
    fixtures: [],
    geometry,
    theme: renderer.getCanvasTheme('light'),
  }, {
    view: view || { s: scale, x: 0, y: 0 },
    backgroundWidth: 780,
    backgroundHeight: 1480,
    pixelRatio: 2,
  })
  return { labels, geometry }
}

function assertNoTextOverlap(labels, description) {
  for (let left = 0; left < labels.length; left += 1) {
    for (let right = left + 1; right < labels.length; right += 1) {
      const a = labels[left]
      const b = labels[right]
      const overlaps = a.left < b.right + 4 && a.right + 4 > b.left
        && a.top < b.bottom + 4 && a.bottom + 4 > b.top
      assert.equal(overlaps, false,
        `${description}: “${a.value}” overlaps “${b.value}” (${JSON.stringify({ a, b })})`)
    }
  }
}

const large = renderLabels({ width: 200, depth: 100 })
assertNoTextOverlap(large.labels, '200×100 m stage annotations must remain readable')
for (const label of ['200 m', '100 m', '台口', '面光杆1', '2.8 m', '观众区']) {
  assert.ok(large.labels.some((entry) => entry.value === label), `large stage must retain ${label}`)
}
assert.ok(large.labels.some((entry) => entry.value === '灯杆1')
  || large.labels.some((entry) => entry.value === '灯杆2')
  || large.labels.some((entry) => entry.value === '灯杆3'),
'at least one internal rod label should remain visible when space permits')

const normal = renderLabels({ width: 12, depth: 8 })
assertNoTextOverlap(normal.labels, '12×8 m stage annotations must not overlap')
for (const label of ['灯杆1', '灯杆2', '灯杆3']) {
  assert.ok(normal.labels.some((entry) => entry.value === label), `normal stage must show ${label}`)
}

const largeStage = large.geometry.stage
const stageBottom = largeStage.top + largeStage.height
// Use the page's actual pinch-zoom ceiling, rather than an unreachable renderer scale.
const zoom = 5
const zoomed = renderLabels({
  width: 200,
  depth: 100,
  view: { s: zoom, x: 390 - (largeStage.left + largeStage.width / 2) * zoom, y: 520 - stageBottom * zoom },
})
assertNoTextOverlap(zoomed.labels, 'Allowed 5x zoom annotations must not overlap')
for (const label of ['灯杆1', '灯杆2', '灯杆3']) {
  assert.ok(zoomed.labels.some((entry) => entry.value === label), `zoom should restore ${label}`)
}

console.log('Stage annotation collision, normal visibility, and zoom restoration tests passed')

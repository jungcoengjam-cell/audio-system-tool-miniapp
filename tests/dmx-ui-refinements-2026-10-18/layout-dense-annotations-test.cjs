const assert = require('node:assert/strict')
const model = require('../../pages/dmx-layout/layout-model')
const renderer = require('../../pages/dmx-layout/layout-renderer')

function renderDenseScene(width, height, apronDirection) {
  const layout = {
    stageWidthText: '12',
    stageDepthText: '8',
    apronDirection,
    internalRods: [
      { id: 'inner-back', distance: 5.333333333333334 },
      { id: 'inner-front', distance: 2.666666666666667 },
    ],
    frontRods: [{ id: 'front-1', distance: 1.1454545454545455 }],
    legacySideRods: [],
    positionsById: {},
  }
  const geometry = model.createStageGeometry(layout, width, height)
  const fixtures = Array.from({ length: 27 }, (_, index) => ({
    id: `fixture-${index + 1}`,
    stableId: `fixture-${index + 1}`,
    addressText: `A${String(index + 1).padStart(3, '0')}`,
    groupIndex: index < 10 ? 0 : index < 19 ? 1 : 2,
  }))
  const rodGroups = [fixtures.slice(0, 10), fixtures.slice(10, 19), fixtures.slice(19)]
  const rods = [
    geometry.rods.find((rod) => rod.type === 'front'),
    ...geometry.rods.filter((rod) => rod.type === 'internal'),
  ]
  rodGroups.forEach((group, rodIndex) => group.forEach((fixture, index) => {
    layout.positionsById[fixture.stableId] = {
      rodId: rods[rodIndex].id,
      t: (index + 1) / (group.length + 1),
    }
  }))

  let fontSize = 16
  let textAlign = 'left'
  const labels = []
  const measure = (value) => Array.from(String(value)).reduce((total, character) => {
    if (/\s/.test(character)) return total + fontSize * .35
    if (/[\u2e80-\u9fff\uf900-\ufaff]/.test(character)) return total + fontSize
    if (/^[0-9.,-]$/.test(character)) return total + fontSize * .56
    return total + fontSize * .62
  }, 0)
  const methods = {
    setFontSize(value) { fontSize = Number(value) },
    setTextAlign(value) { textAlign = value },
    measureText(value) { return { width: measure(value) } },
    fillText(value, x, y) {
      const text = String(value)
      const textWidth = measure(text)
      const left = textAlign === 'right' ? x - textWidth : textAlign === 'center' ? x - textWidth / 2 : x
      labels.push({ text, left, right: left + textWidth, top: y - fontSize * .96, bottom: y + fontSize * .32 })
    },
  }
  const ctx = new Proxy(methods, { get(target, key) { return key in target ? target[key] : () => {} } })
  renderer.renderStageDiagram(ctx, {
    layout,
    fixtures,
    geometry,
    theme: renderer.getCanvasTheme('light'),
  }, {
    view: { s: 1, x: 0, y: 0 },
    backgroundWidth: width,
    backgroundHeight: height,
    pixelRatio: 1,
  })
  return labels
}

for (const [width, height] of [[390, 844], [320, 568], [844, 390], [568, 320]]) {
  for (const direction of model.APRON_DIRECTIONS) {
    const labels = renderDenseScene(width, height, direction)
    for (const text of ['12 m', '8 m', '灯杆1', '灯杆2', '面光杆1', '1.1 m', '台口', '观众区']) {
      assert(labels.some((label) => label.text === text), `${width}×${height} ${direction} retains ${text}`)
    }
    assert(labels.every((label) => label.left >= -1 && label.top >= -1
      && label.right <= width + 1 && label.bottom <= height + 1),
    `${width}×${height} ${direction} keeps diagram labels inside the canvas`)
    const addresses = labels.filter((label) => /^A\d{3}$/.test(label.text))
    for (let left = 0; left < addresses.length; left += 1) {
      for (let right = left + 1; right < addresses.length; right += 1) {
        const a = addresses[left]
        const b = addresses[right]
        const overlap = a.left < b.right + 1 && a.right + 1 > b.left
          && a.top < b.bottom + 1 && a.bottom + 1 > b.top
        assert.equal(overlap, false, `${width}×${height} ${direction} address overlap: ${JSON.stringify({ a, b })}`)
      }
    }
  }
}

console.log('Dense layout annotations retain dimensions, rod names, stage labels, and non-overlapping addresses')

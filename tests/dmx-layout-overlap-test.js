const assert = require('assert')
const model = require('../pages/dmx-layout/layout-model')
const renderer = require('../pages/dmx-layout/layout-renderer')

function recordingContext() {
  const calls = [], texts = [], circles = []
  let fontSize = 16, textAlign = 'left', currentArc = null
  const ctx = new Proxy({}, { get: (_, name) => {
    if (name === 'calls') return calls
    if (name === 'texts') return texts
    if (name === 'circles') return circles
    if (name === 'setFontSize') return (value) => { fontSize = Number(value) || 16; calls.push([name, value]) }
    if (name === 'setTextAlign') return (value) => { textAlign = value; calls.push([name, value]) }
    if (name === 'fillText') return (value, x, y) => {
      const text = String(value)
      const width = Array.from(text).reduce((sum, char) => sum + (/[^\x00-\x7f]/.test(char) ? fontSize : fontSize * .55), 0)
      const left = textAlign === 'center' ? x - width / 2 : textAlign === 'right' ? x - width : x
      texts.push({ text, left, right: left + width, top: y - fontSize * .82, bottom: y + fontSize * .22, x, y, fontSize, textAlign })
      calls.push([name, value, x, y])
    }
    if (name === 'arc') return (x, y, radius, start, end) => { currentArc = { x, y, radius, start, end }; calls.push([name, x, y, radius, start, end]) }
    if (name === 'fill' || name === 'stroke') return (...args) => { if (currentArc) circles.push({ ...currentArc, operation: name }); calls.push([name, ...args]) }
    if (name === 'beginPath') return (...args) => { currentArc = null; calls.push([name, ...args]) }
    return (...args) => calls.push([name, ...args])
  } })
  return { ctx, calls, texts, circles }
}

function makeSnapshot(canvasWidth, canvasHeight, widthMeters, depthMeters, frontAtBottom, themeName, labelsVisible, groupCount) {
  const groups = [{ fixtureCount: 20 }]
  const fixtures = Array.from({ length: 20 }, (_, index) => ({ groupIndex: 0, fixtureIndex: index, addressText: `A${String(1 + index * 14).padStart(3, '0')}` }))
  const definitions = model.posDefs(3, 'full', 2)
  const positions = model.posFromBars(fixtures, [3, 3, 3, 3, 2, 2, 2, 2].map((count) => [count]), groups, definitions, 3, 2)
  return {
    data: { canvasWidth, canvasHeight, isLandscape: canvasWidth > canvasHeight, schemeIndex: 2, rowIndex: 2, sidePairIndex: 1, addressRangeText: 'A001 → A267', addressLabelsVisible: labelsVisible, addressLabelMode: 'all', groupLegend: Array.from({ length: groupCount }, (_, index) => ({ name: index === 0 ? 'TL-SV3103 娱乐灯' : `测试灯具组 ${index}`, count: 20, color: renderer.GROUP_COLORS[index % renderer.GROUP_COLORS.length] })) },
    fixtures, positions, definitions, checkedKeys: new Set([model.posKey(fixtures[0])]), selectedKey: model.posKey(fixtures[1]), selectedGroup: 0, dragPoint: null, palettePreview: null, theme: renderer.getCanvasTheme(themeName), stage: model.stageRect(widthMeters, depthMeters, canvasWidth, canvasHeight), viewScale: 1, widthMeters, depthMeters, frontAtBottom, progKey: (fixture) => model.posKey(fixture),
  }
}

function intersects(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top }
function textCircleDistance(text, circle) { const x = Math.max(text.left, Math.min(circle.x, text.right)); const y = Math.max(text.top, Math.min(circle.y, text.bottom)); return Math.hypot(circle.x - x, circle.y - y) }
function positionsCopy(positions) { return Object.fromEntries(Object.entries(positions).map(([key, value]) => [key, { ...value }])) }

const cases = []
for (const [width, height] of [[700, 900], [1200, 720]]) for (const [widthMeters, depthMeters] of [[12, 8], [4, 16]]) for (const frontAtBottom of [true, false]) for (const theme of ['light', 'dark']) for (const labelsVisible of [true, false]) for (const groupCount of [1, 9]) cases.push({ width, height, widthMeters, depthMeters, frontAtBottom, theme, labelsVisible, groupCount })

for (const testCase of cases) {
  const snapshot = makeSnapshot(testCase.width, testCase.height, testCase.widthMeters, testCase.depthMeters, testCase.frontAtBottom, testCase.theme, testCase.labelsVisible, testCase.groupCount)
  const beforePositions = positionsCopy(snapshot.positions)
  const recording = recordingContext()
  renderer.renderLayout(recording.ctx, snapshot)
  assert.deepStrictEqual(positionsCopy(snapshot.positions), beforePositions, 'renderer changed positions snapshot')
  const addressTexts = new Set(snapshot.fixtures.map((fixture) => fixture.addressText))
  const labels = recording.texts.filter((text) => !addressTexts.has(text.text))
  labels.forEach((text) => {
    assert(text.left >= 0 && text.right <= testCase.width && text.top >= 0 && text.bottom <= testCase.height, `text out of canvas: ${text.text}`)
  })
  recording.circles.filter((circle) => circle.radius >= 10 && circle.radius <= 40).forEach((circle) => labels.forEach((text) => {
    assert(textCircleDistance(text, circle) >= circle.radius, `${text.text} intersects fixture circle at ${circle.x},${circle.y}`)
  }))
  for (let i = 0; i < labels.length; i += 1) for (let j = i + 1; j < labels.length; j += 1) assert(!intersects(labels[i], labels[j]), `text overlap ${JSON.stringify(testCase)}: ${labels[i].text} / ${labels[j].text} (${labels[i].left},${labels[i].top},${labels[i].right},${labels[i].bottom}) (${labels[j].left},${labels[j].top},${labels[j].right},${labels[j].bottom})`)
  const radius = renderer.getRenderRadius(snapshot, 1)
  assert(recording.circles.some((circle) => circle.radius === radius + 9), 'selected marker lacks +9 ring')
  assert(recording.circles.some((circle) => circle.radius === radius + 5), 'completed marker lacks +5 ring')
  const exported = makeSnapshot(testCase.width, testCase.height, testCase.widthMeters, testCase.depthMeters, testCase.frontAtBottom, testCase.theme, false, testCase.groupCount)
  const exportRecording = recordingContext()
  renderer.renderLayout(exportRecording.ctx, exported, { exportMode: true })
  exportRecording.texts.forEach((text) => assert(text.left >= 0 && text.right <= testCase.width && text.top >= 0 && text.bottom <= testCase.height, `export text out of canvas: ${text.text}`))
  assert.deepStrictEqual(new Set(exportRecording.texts.filter((text) => addressTexts.has(text.text)).map((text) => text.text)), addressTexts, 'export must include every address')
}

console.log(`DMX layout overlap tests passed (${cases.length} cases)`)

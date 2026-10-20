const assert = require('assert')
const { OUTPUT_OPTIONS, INPUT_OPTIONS, getWiringModel } = require('../pages/audio-wiring/wiring-model')
const {
  drawWiringDiagram, getDiagramHeight, getWiringHitAreas,
  drawWiringReport, getReportHeight,
} = require('../pages/audio-wiring/wiring-renderer')
const { getModelPhotoSpecs, getSolderPhotoSpec } = require('../pages/audio-wiring/wiring-photos')
const { getWiringGuide, getCompactWiringConditions } = require('../pages/audio-wiring/wiring-display')

function recorder() {
  const calls = []
  let fillStyle = ''
  const ctx = {}
  ;['setFontSize', 'setTextAlign', 'setTextBaseline', 'setStrokeStyle', 'setLineWidth',
    'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke',
    'fillRect', 'save', 'restore', 'rect', 'clip', 'scale', 'setLineCap'].forEach((method) => {
    ctx[method] = (...args) => calls.push([method, ...args])
  })
  ctx.drawImage = (...args) => calls.push(['drawImage', ...args])
  ctx.setFillStyle = (value) => { fillStyle = value; calls.push(['setFillStyle', value]) }
  ctx.arc = (...args) => calls.push(['arc', ...args, fillStyle])
  ctx.fillText = (...args) => calls.push(['fillText', ...args, fillStyle])
  Object.defineProperty(ctx, 'font', { set: (value) => calls.push(['font', value]) })
  return { ctx, calls }
}

function assertBounds(calls, width, height, originX = 0, originY = 0) {
  calls.forEach((call) => {
    if (call[0] === 'moveTo' || call[0] === 'lineTo') {
      assert.ok(call[1] >= originX - 0.5 && call[1] <= originX + width + 0.5, `x in bounds: ${call}`)
      assert.ok(call[2] >= originY - 0.5 && call[2] <= originY + height + 0.5, `y in bounds: ${call}`)
    }
    if (call[0] === 'fillText') {
      assert.ok(call[2] >= originX && call[2] <= originX + width, `text x in bounds: ${call}`)
      assert.ok(call[3] >= originY && call[3] <= originY + height, `text y in bounds: ${call}`)
    }
    if (call[0] === 'arc') {
      assert.ok(call[1] - call[3] >= originX && call[1] + call[3] <= originX + width, `circle x in bounds: ${call}`)
      assert.ok(call[2] - call[3] >= originY && call[2] + call[3] <= originY + height, `circle y in bounds: ${call}`)
    }
  })
  openStrokePaths(calls).forEach((points) => points.forEach(([x, y]) => {
    assert.ok(x >= originX - 0.5 && x <= originX + width + 0.5, `curve x in bounds: ${x},${y}`)
    assert.ok(y >= originY - 0.5 && y <= originY + height + 0.5, `curve y in bounds: ${x},${y}`)
  }))
}

function render(model, width, options = {}) {
  const height = getDiagramHeight(width, model, options)
  const canvas = recorder()
  const metrics = drawWiringDiagram(canvas.ctx, model, width, height, options)
  assertBounds(canvas.calls, width, height)
  return { ...canvas, height, metrics }
}

function strokeCallGroups(calls) {
  const groups = []
  let current = null
  calls.forEach((call) => {
    if (call[0] === 'beginPath') current = []
    if (current) current.push(call)
    if (call[0] === 'stroke' && current) {
      groups.push(current)
      current = null
    }
  })
  return groups
}

function photosFor(model) {
  return Object.fromEntries(getModelPhotoSpecs(model).map((spec) => [spec.key, {}]))
}

function allReadyModels() {
  const models = []
  OUTPUT_OPTIONS.forEach((output) => INPUT_OPTIONS.forEach((input) => {
    const model = getWiringModel(output.id, input.id)
    if (model.supported) models.push(model)
  }))
  return models
}

function angleGap(first, second) {
  const difference = Math.atan2(first.y, first.x) - Math.atan2(second.y, second.x)
  return Math.abs((((difference + (3 * Math.PI)) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI)
}

function assertSharedInputApproaches(model, width, avoidRail = false) {
  const options = { layout: 'solder-wiring', showTitle: false, avoidRail, theme: 'light' }
  const height = getDiagramHeight(width, model, options)
  const metrics = drawWiringDiagram(recorder().ctx, model, width, height, options)
  assert.strictEqual(metrics.connectionAnchors.length, model.connections.length,
    `${model.output.id} → ${model.input.id} has complete routes at ${width}px`)
  const byTarget = new Map()
  metrics.connectionAnchors.forEach((wire) => {
    const key = String(wire.connection.toPin)
    if (!byTarget.has(key)) byTarget.set(key, [])
    byTarget.get(key).push(wire)
  })
  byTarget.forEach((wires, pin) => wires.forEach((wire, index) => {
    wires.slice(index + 1).forEach((other) => {
      if (String(wire.connection.fromPin) === String(other.connection.fromPin)) return
      const direction = (item) => ({
        x: item.curve.control2[0] - item.to.x,
        y: item.curve.control2[1] - item.to.y,
      })
      const separation = angleGap(direction(wire), direction(other))
      assert.ok(separation >= 60 - 1e-6,
        `${model.output.id} → ${model.input.id} routes approach input ${pin} at least 60° apart ` +
        `(${width}px, ${separation.toFixed(2)}°)`)
    })
  }))
}

const routeAuditModels = allReadyModels()
assert.strictEqual(routeAuditModels.length, 42, 'shared input approach audit covers every confirmed connection plan')
routeAuditModels.forEach((model) => {
  ;[[216, false], [274, true], [720, false]].forEach(([width, avoidRail]) =>
    assertSharedInputApproaches(model, width, avoidRail))
})

function closedPathBounds(calls) {
  const rectangles = []
  let points = null
  calls.forEach((call) => {
    if (call[0] === 'beginPath') points = []
    else if (points && (call[0] === 'moveTo' || call[0] === 'lineTo')) points.push([call[1], call[2]])
    else if (points && call[0] === 'bezierCurveTo' && points.length) {
      const [startX, startY] = points[points.length - 1]
      const [, , control1X, control1Y, control2X, control2Y, endX, endY] = call
      for (let step = 1; step <= 48; step += 1) {
        const t = step / 48, inverse = 1 - t
        points.push([
          inverse ** 3 * startX + 3 * inverse ** 2 * t * control1X + 3 * inverse * t ** 2 * control2X + t ** 3 * endX,
          inverse ** 3 * startY + 3 * inverse ** 2 * t * control1Y + 3 * inverse * t ** 2 * control2Y + t ** 3 * endY,
        ])
      }
    }
    else if (call[0] === 'closePath' && points && points.length >= 4) {
      const xs = points.map((point) => point[0])
      const ys = points.map((point) => point[1])
      rectangles.push({ left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) })
      points = null
    } else if ((call[0] === 'stroke' || call[0] === 'fill') && points) points = null
  })
  return rectangles.map((rect) => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }))
}

function openStrokePaths(calls) {
  return openStrokePathEntries(calls).map((entry) => entry.points)
}

function openStrokePathEntries(calls) {
  const paths = []
  let points = null
  let closed = false
  calls.forEach((call, callIndex) => {
    if (call[0] === 'beginPath') { points = []; closed = false }
    else if (points && (call[0] === 'moveTo' || call[0] === 'lineTo')) points.push([call[1], call[2]])
    else if (call[0] === 'closePath') closed = true
    else if (call[0] === 'stroke' && points) {
      if (!closed) paths.push({ points, callIndex })
      points = null
    } else if (call[0] === 'fill') points = null
  })
  return paths
}

function assertNoStrokeThroughCaption(calls, caption, centerX, baseline, message) {
  const textWidth = [...caption].reduce((sum, character) => sum + (character.codePointAt(0) > 0xff ? 9 : 4.5), 0)
  const left = centerX - (textWidth / 2) - 4
  const right = centerX + (textWidth / 2) + 4
  const top = baseline - 9
  const bottom = baseline + 2
  openStrokePaths(calls).filter((points) => points.length >= 5).forEach((points) => {
    for (let index = 1; index < points.length; index += 1) {
      const [x1, y1] = points[index - 1]
      const [x2, y2] = points[index]
      const crossesVertically = Math.abs(x1 - x2) < 0.01 && x1 >= left && x1 <= right
        && Math.max(Math.min(y1, y2), top) <= Math.min(Math.max(y1, y2), bottom)
      const crossesHorizontally = Math.abs(y1 - y2) < 0.01 && y1 >= top && y1 <= bottom
        && Math.max(Math.min(x1, x2), left) <= Math.min(Math.max(x1, x2), right)
      assert.ok(!crossesVertically && !crossesHorizontally,
        `${message}: stroke segment ${JSON.stringify([points[index - 1], points[index]])}`)
    }
  })
}

function assertPinLabelsStayReadable(calls, pins, anchors, baselineFor, message) {
  const routes = openStrokePathEntries(calls).filter((entry) => entry.points.length >= 5)
  const lastRouteStroke = Math.max(...routes.map((entry) => entry.callIndex))
  const labels = pins.map((pin) => {
    const point = anchors.get(pin.pin)
    assert(point, `${message}: anchor exists for ${pin.pin}`)
    const baseline = baselineFor(pin, point)
    const labelIndex = calls.findIndex((call) => call[0] === 'fillText' && call[1] === pin.pin
      && Math.abs(call[2] - point.x) < 0.01 && Math.abs(call[3] - baseline) < 0.01)
    assert(labelIndex >= 0, `${message}: pin ${pin.pin} uses the reserved label baseline`)
    assert(labelIndex > lastRouteStroke, `${message}: pin ${pin.pin} is drawn over all routes`)
    const width = [...String(pin.pin)].reduce((sum, character) =>
      sum + (character.codePointAt(0) > 0xff ? 9 : 4.5), 0)
    return { pin: pin.pin, x: point.x, baseline, width, labelIndex,
      left: point.x - width / 2 - 2, right: point.x + width / 2 + 2,
      top: baseline - 9, bottom: baseline + 2 }
  })
  labels.forEach((label) => {
    const routeOverlap = routes.some(({ points }) => {
      for (let index = 1; index < points.length; index += 1) {
        const [x1, y1] = points[index - 1]
        const [x2, y2] = points[index]
        const crossesVertically = Math.abs(x1 - x2) < 0.01 && x1 >= label.left && x1 <= label.right
          && Math.max(Math.min(y1, y2), label.top) <= Math.min(Math.max(y1, y2), label.bottom)
        const crossesHorizontally = Math.abs(y1 - y2) < 0.01 && y1 >= label.top && y1 <= label.bottom
          && Math.max(Math.min(x1, x2), label.left) <= Math.min(Math.max(x1, x2), label.right)
        if (crossesVertically || crossesHorizontally) return true
      }
      return false
    })
    if (!routeOverlap) return
    const expectedMask = { left: label.x - (label.width / 2) - 3,
      right: label.x + (label.width / 2) + 3, top: label.baseline - 9, bottom: label.baseline + 2 }
    assert(closedPathBounds(calls.slice(0, label.labelIndex)).some((rect) =>
      Math.abs(rect.left - expectedMask.left) < 0.01 && Math.abs(rect.right - expectedMask.right) < 0.01
      && Math.abs(rect.top - expectedMask.top) < 0.01 && Math.abs(rect.bottom - expectedMask.bottom) < 0.01),
    `${message}: ${label.pin} gets a background mask where a route passes behind it`)
  })
}

const basic = getWiringModel('xlrBalanced', 'xlrBalanced')
for (const width of [280, 320, 375]) {
  const functional = render(basic, width, { viewMode: 'wiring', theme: 'light' })
  const areas = getWiringHitAreas(basic, width, functional.height)
  assert.strictEqual(areas.length, basic.connections.length)
  assert.ok(areas.every((area) => area.left >= 0 && area.left + area.width <= width && area.top + area.height <= functional.height))
  render(basic, width, { viewMode: 'connectors', face: 'mating', theme: 'dark' })
  render(basic, width, { viewMode: 'connectors', face: 'solder', theme: 'light' })
  for (const face of ['mating', 'solder']) {
    const titledHeight = getDiagramHeight(width, basic, { viewMode: 'connectors', face })
    const untitled = render(basic, width, { viewMode: 'connectors', face, showTitle: false })
    assert.strictEqual(titledHeight - untitled.height, 24,
      `hiding the title keeps connector ${face} geometry in sync at width ${width}`)
  }
}

const narrowFourPin = getWiringModel('stereo35', 'rcaStereo', { destinationChannel: 'both' })
assert.strictEqual(narrowFourPin.status, 'ready')
const photoPairs = [
  ['xlrBalanced', 'xlrBalanced', {}],
  ['xlrBalanced', 'terminalBalanced', {}],
  ['stereo35', 'rcaStereo', { destinationChannel: 'both' }],
  ['xlrBalanced', 'rcaStereo', { outputMode: 'coldReturn', destinationChannel: 'both' }],
  ['stereo35', 'tsStereo', { destinationChannel: 'both' }],
  ['terminalBalanced', 'terminalBalanced', {}],
]
const photoOptions = { layout: 'solder-wiring', theme: 'dark', showTitle: false, avoidRail: true }
function geometrySnapshot(metrics) {
  return {
    height: metrics.height,
    endpoints: ['output', 'input'].map((side) => {
      const endpoint = metrics[side]
      return {
        boxes: endpoint.photoBoxes.map(({ key, x, y, size }) => ({ key, x, y, size })),
        anchors: [...endpoint.anchors.entries()].map(([pin, point]) => [pin, point.x, point.y]),
      }
    }),
    wires: metrics.connectionAnchors.map((wire) => ({
      id: wire.id, points: wire.points, from: [wire.from.x, wire.from.y], to: [wire.to.x, wire.to.y],
    })),
  }
}

for (const [outputId, inputId, selections] of photoPairs) {
  const model = getWiringModel(outputId, inputId, selections)
  assert.strictEqual(model.status, 'ready', `${outputId} → ${inputId} photo layout case is ready`)
  const specs = getModelPhotoSpecs(model)
  const photos = Object.fromEntries(specs.map((spec) => [spec.key, { key: spec.key }]))
  for (const width of [216, 272, 320]) {
    for (const theme of ['light', 'dark']) {
      const options = { ...photoOptions, theme }
      const heightWithoutPhotos = getDiagramHeight(width, model, options)
      const heightWithPhotos = getDiagramHeight(width, model, { ...options, photos })
      assert.strictEqual(heightWithPhotos, heightWithoutPhotos,
        `${outputId} → ${inputId} height is independent of image readiness at ${width}px ${theme}`)
      const hitsWithoutPhotos = getWiringHitAreas(model, width, heightWithoutPhotos, options)
      const hitsWithPhotos = getWiringHitAreas(model, width, heightWithPhotos, { ...options, photos })
      assert.deepStrictEqual(hitsWithPhotos, hitsWithoutPhotos,
        `${outputId} → ${inputId} hit regions do not depend on loaded image objects at ${width}px ${theme}`)
      const noPhotoMetrics = drawWiringDiagram(recorder().ctx, model, width, heightWithoutPhotos, options)
      const loadedCanvas = recorder()
      const loadedMetrics = drawWiringDiagram(loadedCanvas.ctx, model, width, heightWithPhotos, { ...options, photos })
      assert.deepStrictEqual(geometrySnapshot(loadedMetrics), geometrySnapshot(noPhotoMetrics),
        `${outputId} → ${inputId} anchors are manifest-derived, independent of image objects at ${width}px ${theme}`)
      assertBounds(loadedCanvas.calls, width, heightWithPhotos)
      const expectedPhotoDraws = loadedMetrics.output.photoBoxes.length + loadedMetrics.input.photoBoxes.length
      assert.strictEqual(loadedCanvas.calls.filter((call) => call[0] === 'drawImage').length, expectedPhotoDraws,
        'each manifest-derived endpoint photo box is drawn once when its image is loaded')
      loadedMetrics.connectionAnchors.forEach((wire) => {
        const hit = hitsWithPhotos.find((area) => area.id === wire.id)
        assert.deepStrictEqual(hit.pathPoints[0], [wire.from.x, wire.from.y], 'hit path starts at the manifest contact anchor')
        assert.deepStrictEqual(hit.pathPoints.at(-1), [wire.to.x, wire.to.y], 'hit path ends at the manifest contact anchor')
      })
    }
  }
}

const titledDiagram = render(basic, 375, { viewMode: 'wiring', showTitle: true })
const untitledDiagram = render(basic, 375, { viewMode: 'wiring', showTitle: false })
assert.strictEqual(titledDiagram.height - untitledDiagram.height, 24,
  'hiding the title also removes its vertical layout space')
assert.ok(titledDiagram.calls.some((call) => call[0] === 'fillText' && call[1] === basic.title && call[3] === 24))
assert.ok(!untitledDiagram.calls.some((call) => call[0] === 'fillText' && call[1] === basic.title))
assert.ok(untitledDiagram.calls.some((call) => call[0] === 'fillText' &&
  String(call[1]).startsWith('功能连线') && call[3] === 23), 'mode guidance moves into the freed title row')
const titledAreas = getWiringHitAreas(basic, 375, titledDiagram.height)
const untitledAreas = getWiringHitAreas(basic, 375, untitledDiagram.height, { showTitle: false })
assert.strictEqual(titledAreas[0].top - untitledAreas[0].top, 24)

// A single unbalanced source return fans to the balanced negative and shield pins.
const monoToBalanced = getWiringModel('tsMono', 'xlrBalanced', { outputMode: 'direct' })
assert.strictEqual(monoToBalanced.status, 'ready')
assert.ok(monoToBalanced.connections.some((wire) => wire.fromPin === 'S' && wire.toRole === 'negative'))
assert.ok(monoToBalanced.connections.some((wire) => wire.fromPin === 'S' && wire.toRole === 'shield'))
const fanout = render(monoToBalanced, 320, { viewMode: 'wiring', theme: 'dark' })
const sourcePinLabels = fanout.calls.filter((call) => call[0] === 'fillText' && call[1] === 'S')
assert.strictEqual(sourcePinLabels.length, 1, 'a physically shared source pin is labeled once')
assert.ok(fanout.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#ffb458'),
  'return-to-negative wire uses negative role color')

// Cold and shield meet only at the shared unbalanced input return.
const coldReturn = getWiringModel('xlrBalanced', 'rcaMono', { outputMode: 'coldReturn' })
const tiedTarget = render(coldReturn, 320, { viewMode: 'wiring', theme: 'light' })
assert.strictEqual(tiedTarget.calls.filter((call) => call[0] === 'fillText' && call[1] === '外壳').length, 1,
  'shared destination pin has one label')
assert.ok(tiedTarget.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#9a5b00'))
assert.ok(tiedTarget.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#5f6872'))

// Retired choice values cannot change the fixed cold-return route.
const coldOpen = getWiringModel('xlrBalanced', 'rcaMono', { outputMode: 'coldOpen' })
assert.strictEqual(coldOpen.status, 'ready')
assert.deepStrictEqual(coldOpen.connections.map((wire) => `${wire.fromPin}>${wire.toPin}`), ['2>中心针', '3>外壳', '1>外壳'])
assert.deepStrictEqual(coldOpen.unconnectedPins, [])

// Selecting L from a stereo source leaves R open and keeps the connector view readable.
const oneChannelBalanced = getWiringModel('stereo35', 'xlrBalanced', { sourceChannel: 'left' })
assert.strictEqual(oneChannelBalanced.status, 'ready')
assert.strictEqual(oneChannelBalanced.unconnectedPins.length, 1)
assert.strictEqual(oneChannelBalanced.unconnectedPins[0].pin, 'R')
oneChannelBalanced.unconnectedPins[0].reason = '未选择的右声道 R 输出保持未接并与左声道隔离；施工前按设备说明书核对输出用途。'
const oneChannelConnectors = render(oneChannelBalanced, 375, { viewMode: 'connectors', face: 'mating', theme: 'dark' })
const connectorText = oneChannelConnectors.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1])).join('')
assert.ok(connectorText.includes('右声道 R 输出保持未接并与左声道隔离'),
  'long unconnected-pin reason remains complete in the connector mapping')
const openAreas = getWiringHitAreas(oneChannelBalanced, 375, oneChannelConnectors.height, { viewMode: 'connectors' })
assert.strictEqual(openAreas.length, oneChannelBalanced.connections.length, 'unconnected R has no connection hit target')
const oneChannelMapText = oneChannelConnectors.calls.filter((call) => call[0] === 'fillText' &&
  (String(call[1]).includes('保持未接') || String(call[1]).includes('R 环')))
assert.ok(oneChannelMapText.length >= 2)
const openPinMapLine = oneChannelConnectors.calls.find((call) => call[0] === 'fillText' &&
  String(call[1]).startsWith('输出 R 环'))
assert.ok(openPinMapLine)
assert.ok(!openAreas.some((area) => openPinMapLine[2] >= area.left && openPinMapLine[2] <= area.left + area.width &&
  openPinMapLine[3] >= area.top && openPinMapLine[3] <= area.top + area.height),
'the unconnected R map row does not overlap a connection hit target')
const oneChannelLastBaseline = Math.max(...oneChannelMapText.map((call) => call[3]))
assert.ok(oneChannelConnectors.height - oneChannelLastBaseline <= 40, 'connector view leaves no excessive empty tail')

const solderOneChannel = render(oneChannelBalanced, 375, { viewMode: 'connectors', face: 'solder', theme: 'dark' })
const solderText = solderOneChannel.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1])).join('')
assert.ok(solderText.includes('右声道 R 输出保持未接并与左声道隔离'))
assert.ok(solderText.includes('左右镜像，定位朝上') && solderText.includes('按 T/R/S 标记确认'),
  'solder-face guidance remains complete after height compaction')
const solderLastBaseline = Math.max(...solderOneChannel.calls.filter((call) => call[0] === 'fillText' &&
  String(call[1]).includes('标记确认')).map((call) => call[3]))
assert.ok(solderOneChannel.height - solderLastBaseline <= 40, 'solder note sits near the end of the canvas')

// Six-line split: three physical source pins fan out to two separate destinations.
const splitBoth = getWiringModel('xlrBalanced', 'rcaStereo', {
  outputMode: 'coldReturn', destinationChannel: 'both',
})
assert.strictEqual(splitBoth.connections.length, 6)
const split = render(splitBoth, 320, { viewMode: 'wiring', theme: 'light' })
assert.ok(!split.calls.some((call) => call[0] === 'setStrokeStyle' && call[1] === '#ffffff'),
  'complex fan-out never draws background-colored strokes to erase crossing trunks')
const sharedPinNodes = split.calls.filter((call) => call[0] === 'arc' && call[3] === 3.5 && call[6] === '#5f6872')
assert.ok(sharedPinNodes.length >= 4, 'overlapping source groups get separate solid branch nodes')
assert.ok(split.calls.some((call) => call[0] === 'setStrokeStyle' && call[1] === '#1976d2'),
  'positive source shared trunk uses positive role color')
const splitDark = render(splitBoth, 320, { viewMode: 'wiring', theme: 'dark' })
assert.ok(!splitDark.calls.some((call) => call[0] === 'setStrokeStyle' && call[1] === '#111214'),
  'dark complex fan-out never draws background-colored strokes either')
const outputHeadingX = 10 + (82 / 2)
const sharedSourceLabels = split.calls.filter((call) => call[0] === 'fillText' && ['3', '1'].includes(call[1]) && call[2] === outputHeadingX)
assert.strictEqual(sharedSourceLabels.length, 2)
assert.ok(Math.abs(sharedSourceLabels[0][3] - sharedSourceLabels[1][3]) >= 14,
  'physical source pin labels remain separated when fan-out row groups overlap')
const splitHitAreas = getWiringHitAreas(splitBoth, 320, split.height, { viewMode: 'wiring' })
assert.ok(splitHitAreas.every((area) => area.width > 0 && area.height >= 44))
splitHitAreas.forEach((area) => {
  assert.ok(area.x >= area.left && area.x <= area.left + area.width)
  assert.ok(area.y >= area.top && area.y <= area.top + area.height)
})
const sharedPinTwoLabel = split.calls.find((call) => call[0] === 'fillText' && call[1] === '2' && call[2] === outputHeadingX)
assert.ok(sharedPinTwoLabel, 'shared source pin 2 has a single physical pin label')
const sharedPinTwoPoint = { x: sharedPinTwoLabel[2], y: sharedPinTwoLabel[3] - 4 }
assert.ok(!splitHitAreas.some((area) => sharedPinTwoPoint.x >= area.left &&
  sharedPinTwoPoint.x <= area.left + area.width && sharedPinTwoPoint.y >= area.top &&
  sharedPinTwoPoint.y <= area.top + area.height),
'tapping the shared source pin 2 label cannot select the cold-return row')
split.calls.filter((call) => call[0] === 'arc' && [3.5, 4].includes(call[3])).forEach((node) => {
  assert.ok(!splitHitAreas.some((area) => node[1] >= area.left && node[1] <= area.left + area.width &&
    node[2] >= area.top && node[2] <= area.top + area.height), 'shared junction nodes are outside row hit regions')
})
const rightOnly = render(getWiringModel('tsMono', 'tsStereo', { destinationChannel: 'both' }), 320,
  { viewMode: 'wiring', theme: 'dark' })
assert.ok(rightOnly.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#bb9bff'),
  'fixed 1-to-2 mono routing draws the right input with its right-channel color')
assert.ok(split.height > getDiagramHeight(320, basic), 'multiple fan-out rows grow diagram height')
const splitConnectors = render(splitBoth, 320, { viewMode: 'connectors', theme: 'dark' })
const splitAreas = getWiringHitAreas(splitBoth, 320, splitConnectors.height, { viewMode: 'connectors' })
assert.strictEqual(splitAreas.length, 6)
assert.ok(splitAreas.every((area) => area.height >= 44 && area.top + area.height <= splitConnectors.height))
const splitSolder = render(splitBoth, 272, { viewMode: 'connectors', face: 'solder', theme: 'light' })
const splitSolderTextCalls = splitSolder.calls.filter((call) => call[0] === 'fillText')
const solderNoteStart = splitSolderTextCalls.findIndex((call) => String(call[1]).startsWith('XLR焊接面'))
const lastMappingCall = splitSolderTextCalls[solderNoteStart - 1]
assert.ok(lastMappingCall && solderNoteStart > 0)
const solderNoteCalls = splitSolderTextCalls.slice(solderNoteStart)
const solderNote = solderNoteCalls.map((call) => String(call[1])).join('')
assert.strictEqual(solderNote,
  'XLR焊接面为插接面左右镜像，定位朝上。 TRS/TS焊片随型号而异，按 T/R/S 标记确认。')
assert.ok(solderNoteCalls.some((call) => String(call[1]).includes('TRS/TS')),
  'TRS/TS remains a single word across solder-note wrapping')
assert.strictEqual(solderNoteCalls[0][3] - lastMappingCall[3], 22,
  'solder note baseline follows the final mapping baseline with the intended gap')
assert.strictEqual(splitSolder.height, solderNoteCalls[0][3] + ((solderNoteCalls.length - 1) * 16) + 24,
  'diagram height reserves the same solder-note position and line count as drawing')

// Stereo-to-mono always takes T and keeps R explicitly open.
const oneChannel = getWiringModel('stereo35', 'tsMono')
assert.strictEqual(oneChannel.unconnectedPins.length, 1)
assert.strictEqual(oneChannel.unconnectedPins[0].pin, 'R')
assert.ok(!oneChannel.connections.some((wire) => wire.fromPin === 'R'), 'fixed T routing leaves stereo output R unconnected')
const oneChannelView = render(oneChannel, 320, { viewMode: 'wiring', theme: 'light' })
assert.ok(oneChannelView.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('悬空')),
  'the unselected stereo channel remains visibly open in the functional diagram')
const fixedStereoSolder = render(getWiringModel('stereo35', 'xlrBalanced', { sourceChannel: 'right' }), 320,
  { layout: 'solder-wiring', avoidRail: true, theme: 'light' })
assert.ok(fixedStereoSolder.calls.some((call) => call[0] === 'fillText' && call[1] === 'T') &&
  fixedStereoSolder.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('R · 未接')),
  'fixed stereo-to-balanced wiring labels connected T and the open R contact')
const fixedStereoPhoto = getSolderPhotoSpec(getWiringModel('stereo35', 'xlrBalanced').output)
const contentWidth = 320 - 56
const columnWidth = (contentWidth - 22) / 2
const photoSize = Math.min(112, columnWidth - 2)
const photoTop = 38 + 6
const photoDestination = (point) => {
  const crop = fixedStereoPhoto.contentRect
  const scale = Math.min(photoSize / crop.width, photoSize / crop.height)
  const photoLeft = 5 + (columnWidth / 2) - (photoSize / 2)
    + ((photoSize - (crop.width * scale)) / 2)
  return { x: photoLeft + ((point.x * fixedStereoPhoto.width - crop.x) * scale),
    y: photoTop + (point.y * fixedStereoPhoto.height - crop.y) * scale }
}
const unconnectedRPoint = photoDestination(fixedStereoPhoto.pinPoints.R)
const connectedTPoint = photoDestination(fixedStereoPhoto.pinPoints.T)
const openRLabel = fixedStereoSolder.calls.find((call) => call[0] === 'fillText' && String(call[1]).includes('R · 未接'))
assert.ok(openRLabel && Math.hypot(openRLabel[2] - unconnectedRPoint.x, openRLabel[3] - unconnectedRPoint.y) < 14,
  'the R open-status label stays near the actual R solder tab')
assert.ok(Math.hypot(openRLabel[2] - connectedTPoint.x, openRLabel[3] - connectedTPoint.y) > 18,
  'the R open-status label stays clear of the connected T solder tab')

const xlrModel = getWiringModel('xlrBalanced', 'xlrBalanced')
const xlrSolder = render(xlrModel, 320, { layout: 'solder-wiring', theme: 'light' })
const xlrSolderWithPhotos = render(xlrModel, 320,
  { layout: 'solder-wiring', theme: 'light', photos: photosFor(xlrModel) })
const photoDrawCalls = xlrSolderWithPhotos.calls.filter((call) => call[0] === 'drawImage')
assert.strictEqual(photoDrawCalls.length, 2)
assert.strictEqual(xlrSolderWithPhotos.calls.filter((call) => call[0] === 'clip').length, photoDrawCalls.length,
  'each solder photo uses a clipped draw so the cropped connector body remains visible in exports')
assert.strictEqual(xlrSolderWithPhotos.calls.filter((call) => call[0] === 'rect').length, photoDrawCalls.length)
photoDrawCalls.forEach((call) => {
  assert.strictEqual(call.length, 6, 'the full source photo is drawn with the portable 5-argument API')
})
assert.ok(xlrSolderWithPhotos.metrics.output.photoBoxes.every((box) => box.y === 44 && box.size === 112),
  'single connector photos begin below the compact title without a large blank gap')
assert.ok(xlrSolder.height < 200, 'the compact top placement keeps the single-pair diagram height bounded')
assert.ok(xlrSolder.height + 44 + 12 + 42 >= 204,
  'the diagram card retains enough content height for the four-button action rail')
const mixedDualModel = getWiringModel('stereo35', 'rcaStereo')
const mixedDual = render(mixedDualModel, 274,
  { layout: 'solder-wiring', avoidRail: true, theme: 'light', photos: photosFor(mixedDualModel) })
const mixedDualImages = mixedDual.calls.filter((call) => call[0] === 'drawImage')
const singleBox = mixedDual.metrics.output.photoBoxes[0]
const dualBoxes = mixedDual.metrics.input.photoBoxes
const singleCenterY = singleBox.y + (singleBox.size / 2)
const dualCenterY = dualBoxes.reduce((sum, box) => sum + box.y + (box.size / 2), 0) / dualBoxes.length
assert.strictEqual(singleCenterY, dualCenterY,
  'single output photo aligns to the actual vertical center of the two input photos')

const phoneWidthDiagram = render(xlrModel, 274,
  { layout: 'solder-wiring', avoidRail: true, theme: 'dark', photos: photosFor(xlrModel) })
assert.ok(phoneWidthDiagram.metrics.output.photoBoxes.every((box) => box.size === 96 && box.y === 44),
  'the 274px content-area diagram enlarges both XLR photos while preserving a compact top gap')

const terminalSplitModel = getWiringModel('terminalBalanced', 'rcaStereo', {
  outputMode: 'coldReturn', destinationChannel: 'both',
})
assert.ok(terminalSplitModel.supported, 'terminal to dual RCA fixture uses explicit supported conditions')
const terminalOriginHeight = getDiagramHeight(720, terminalSplitModel, { layout: 'solder-wiring' })
const terminalOriginCanvas = recorder()
drawWiringDiagram(terminalOriginCanvas.ctx, terminalSplitModel, 720, terminalOriginHeight, {
  layout: 'solder-wiring', x: 180, y: 20, photos: photosFor(terminalSplitModel),
})
const terminalLabels = terminalOriginCanvas.calls.filter((call) => call[0] === 'fillText' && ['+', '−', 'G'].includes(call[1]))
assert.ok(terminalLabels.length >= 3 && terminalLabels.every((call) => call[2] > 180),
  'terminal photo labels include the diagram origin when drawing a shared report canvas')
assert(terminalLabels.every((call) => call[4] === '#1d2329')
  && terminalOriginCanvas.calls.filter((call) => call[0] === 'setFillStyle' && call[1] === '#ffffff').length >= 3,
'terminal labels use opaque white badges and fixed dark text for clear contrast on both themes')
const terminalPageDiagram = render(terminalSplitModel, 274, {
  layout: 'solder-wiring', avoidRail: true, theme: 'light', photos: photosFor(terminalSplitModel),
})
const terminalCaption = terminalPageDiagram.calls.find((call) => call[0] === 'fillText'
  && String(call[1]).includes('示意顺序，按设备丝印'))
assert(terminalCaption && terminalPageDiagram.height >= terminalCaption[3] + 15,
  'terminal caption and its lower padding are inside the page diagram canvas')
const terminalCompactReport = recorder()
const terminalCompactOptions = { layout: 'solder-wiring', compact: true, theme: 'light', photos: photosFor(terminalSplitModel) }
const terminalCompactHeight = getReportHeight(720, terminalSplitModel, terminalCompactOptions)
drawWiringReport(terminalCompactReport.ctx, terminalSplitModel, 720, terminalCompactHeight, terminalCompactOptions)
const terminalCompactTexts = terminalCompactReport.calls.filter((call) => call[0] === 'fillText')
const compactTerminalCaption = terminalCompactTexts.find((call) => String(call[1]).includes('示意顺序，按设备丝印'))
const compactTerminalGuide = terminalCompactTexts.find((call) => String(call[1]).includes('冷端') && String(call[1]).includes('汇接'))
assert(compactTerminalCaption && compactTerminalGuide && compactTerminalGuide[3] > compactTerminalCaption[3] + 15,
  'compact guide begins below the fully visible terminal caption')

const xlrRouteGroups = strokeCallGroups(xlrSolder.calls).filter((group) =>
  group.some((call) => call[0] === 'setLineWidth' && [2.3, 3.6].includes(call[1])) &&
  group.some((call) => call[0] === 'bezierCurveTo'))
assert.strictEqual(xlrRouteGroups.length, xlrModel.connections.length,
  'each connection keeps one stroke operation even when its path has crossing gaps')
xlrRouteGroups.forEach((group) => {
  const moveCount = group.filter((call) => call[0] === 'moveTo').length
  const curveCount = group.filter((call) => call[0] === 'bezierCurveTo').length
  assert.strictEqual(moveCount, curveCount, 'every split path piece remains one cubic segment')
  assert.ok(curveCount >= 1)
})
const crossingCase = render(getWiringModel('stereo35', 'rcaStereo'), 320,
  { layout: 'solder-wiring', avoidRail: true, theme: 'light' })
const crossingRouteGroups = strokeCallGroups(crossingCase.calls).filter((group) =>
  group.some((call) => call[0] === 'setLineWidth' && [2.3, 3.6].includes(call[1])) &&
  group.some((call) => call[0] === 'bezierCurveTo'))
const crossingGaps = []
crossingRouteGroups.forEach((group) => {
  let lastEnd = null
  group.forEach((call) => {
    if (call[0] === 'moveTo') {
      if (lastEnd) crossingGaps.push(Math.hypot(call[1] - lastEnd[0], call[2] - lastEnd[1]))
    } else if (call[0] === 'bezierCurveTo') lastEnd = [call[5], call[6]]
  })
})
assert.ok(crossingGaps.some((gap) => gap >= 3 && gap <= 4.5),
  'isolated route crossings leave a short 3–4px interruption in one cubic path')
assert.ok(xlrSolder.calls.some((call) => call[0] === 'fillText' && call[1] === 'XLR 母头'),
  'solder photo heading identifies the output cable connector as female')
assert.ok(xlrSolder.calls.some((call) => call[0] === 'fillText' && call[1] === 'XLR 公头'),
  'solder photo heading identifies the input cable connector as male')
const rcaPhoto = getSolderPhotoSpec(getWiringModel('rcaMono', 'rcaMono').output)
assert.deepStrictEqual(rcaPhoto.contentRect, { x: 215, y: 150, width: 147, height: 133 },
  'RCA photo display crops to the rear solder assembly and omits the front insertion pin')
;['core', 'shell'].forEach((key) => {
  const point = rcaPhoto.pinPoints[key]
  const px = point.x * rcaPhoto.width, py = point.y * rcaPhoto.height
  assert(px >= rcaPhoto.contentRect.x && px <= rcaPhoto.contentRect.x + rcaPhoto.contentRect.width &&
    py >= rcaPhoto.contentRect.y && py <= rcaPhoto.contentRect.y + rcaPhoto.contentRect.height,
  `RCA ${key} anchor remains inside the solder-end crop`)
})

const compactOptions = { layout: 'solder-wiring', compact: true, viewMode: 'connectors', face: 'solder', theme: 'dark', scale: 2 }
const compactHeight = getReportHeight(720, oneChannel, compactOptions)
const compactReport = recorder()
const compactResult = drawWiringReport(compactReport.ctx, oneChannel, 720, compactHeight, compactOptions)
assert.strictEqual(compactResult.height, compactHeight)
assertBounds(compactReport.calls, 720, compactHeight)
const compactText = compactReport.calls.filter((call) => call[0] === 'fillText')
  .map((call) => String(call[1])).join('').replace(/\s/g, '')
assert(compactText.includes('接线参考·焊接端示意'))
assert(compactText.includes('R·未接'), 'the solder photo labels the open R contact')
assert(!compactText.includes('悬空不接') && !compactText.includes('未连接触点') && !compactText.includes('结果性质'),
  'compact solder report avoids a second long open-pin section and result nature')
assert(compactText.includes('端口、针位以设备丝印和手册为准'))
assert(compactText.includes('固定取T（左声道L），R不接。'),
  'compact share reuses the short on-page guide for fixed mono selection')
oneChannel.selectionSummary.forEach((summary) => assert(!compactText.includes(summary.replace(/\s/g, '')),
  `compact solder report does not repeat the selection summary: ${summary}`))
oneChannel.criticalNotes.forEach((note) => assert(!compactText.includes(note.replace(/\s/g, '')),
  `compact solder report uses concise conditions instead of the long critical note: ${note}`))
assert(!compactText.includes(oneChannel.cableSummary.replace(/\s/g, '')),
  'compact share avoids repeating the cable summary already implied by the image')
assert.strictEqual(getWiringGuide(oneChannel), '固定取 T（左声道 L），R 不接。',
  'page and compact share use the same short fixed-channel guide')
const compactDual = getWiringModel('xlrBalanced', 'rcaStereo', {
  outputMode: 'coldReturn', destinationChannel: 'both',
})
assert.deepStrictEqual(getCompactWiringConditions(compactDual), [
  '仅在两台设备手册允许时施工。',
  '仅接两路独立高阻 LINE 输入；核对并联负载。',
], 'compact share keeps the two applicable safety conditions in short form')
const compactDualReport = recorder()
const compactDualHeight = getReportHeight(720, compactDual, { ...compactOptions, scale: 1 })
drawWiringReport(compactDualReport.ctx, compactDual, 720, compactDualHeight,
  { ...compactOptions, scale: 1 })
const compactDualText = compactDualReport.calls.filter((call) => call[0] === 'fillText')
  .map((call) => String(call[1])).join('').replace(/\s/g, '')
assert(compactDualText.includes('冷端−与屏蔽在输入端汇接，再分送L/R。')
  && compactDualText.includes('仅在两台设备手册允许时施工。')
  && compactDualText.includes('仅接两路独立高阻LINE输入；核对并联负载。'),
'compact dual share combines the shared short guide with the relevant conditions')
assert(!compactDual.criticalNotes.some((note) => compactDualText.includes(note.replace(/\s/g, '')))
  && !compactDual.selectionSummary.some((summary) => compactDualText.includes(summary.replace(/\s/g, ''))),
'compact share does not repeat verbose condition or selection summaries')
assert(!compactText.includes('参考与适用边界')
  && !oneChannel.sources.some((source) => compactText.includes(source.title.replace(/\s/g, ''))),
'compact solder report omits the long source section')

// Fixed cold-return conditions remain visible in the full drawing/report.
const fixedColdReturn = getWiringModel('xlrBalanced', 'rcaMono')
assert.strictEqual(fixedColdReturn.status, 'ready')
assert.ok(fixedColdReturn.criticalNotes.some((note) => note.includes('手册明确允许')))
assert.ok(getCompactWiringConditions(fixedColdReturn).some((condition) => condition.includes('设备手册允许')))

const reportOptions = { theme: 'dark', scale: 2 }
const reportModel = { ...splitBoth, sources: splitBoth.sources.concat([
  { title: 'SOURCE: Neutrik connector drawing reference, not equipment specific proof.' },
  { title: '中文标题测试：十个汉字用来检查，标点不要跑到新行。' },
]) }
const reportHeight = getReportHeight(750, reportModel, reportOptions)
const report = recorder()
const reportResult = drawWiringReport(report.ctx, reportModel, 750, reportHeight, reportOptions)
assert.strictEqual(reportResult.height, reportHeight)
assertBounds(report.calls, 750, reportHeight)
const reportText = report.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1])).join('\n')
const reportWithoutWraps = reportText.replace(/\n/g, '')
splitBoth.selectionSummary.concat(splitBoth.criticalNotes).forEach((note) => {
  assert.ok(reportWithoutWraps.includes(note), `report includes complete condition: ${note}`)
})
assert.ok(reportText.includes('冷端') && reportText.includes('汇接'))
assert.ok(!/冷端.{0,8}悬空/.test(reportWithoutWraps), 'report does not mention the retired cold-open wiring')
assert.ok(reportText.includes('参考与适用边界'))
const reportLines = report.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]))
const sourceStart = reportLines.findIndex((value) => value.startsWith('SOURCE:'))
assert.ok(sourceStart >= 0)
const customSourceLines = []
for (let index = sourceStart; index < reportLines.length &&
  !reportLines[index].startsWith('中文标题测试'); index += 1) customSourceLines.push(reportLines[index])
assert.ok(customSourceLines.join('').includes('connector drawing reference'))
assert.ok(customSourceLines.slice(0, -1).every((value) => value.endsWith(' ')),
  'long English source words wrap at spaces')
assert.ok(reportLines.some((value) => value.includes('，')))
assert.ok(!reportLines.some((value) => /^[，。；：、！？）》】〕〉”’」』…％]/.test(value)),
  'Chinese closing punctuation does not start a wrapped line')

const reportViewModel = getWiringModel('stereo35', 'xlrBalanced', { sourceChannel: 'left' })
const selectedReportConnectionId = reportViewModel.connections[0].id
;[
  { viewMode: 'wiring', face: 'mating', label: '当前视角：连线图' },
  { viewMode: 'connectors', face: 'mating', label: '接头视角 · 插接面' },
  { viewMode: 'connectors', face: 'solder', label: '接头视角 · 焊接面' },
].forEach(({ viewMode, face, label }) => {
  const options = { viewMode, face, selectedId: selectedReportConnectionId, theme: 'dark', scale: 2 }
  const height = getReportHeight(640, reportViewModel, options)
  const canvas = recorder()
  const result = drawWiringReport(canvas.ctx, reportViewModel, 640, height, options)
  assert.strictEqual(result.height, height, `${label} report height matches drawing`)
  assertBounds(canvas.calls, 640, height)
  const lines = canvas.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]))
  const text = lines.join('').replace(/\s/g, '')
  assert(text.includes(label.replace(/\s/g, '')), `report identifies ${label}`)
  assert(text.includes('悬空不接：输出R'), 'report retains the unconnected stereo output pin')
  reportViewModel.connections.forEach((connection) => {
    assert(text.includes(connection.fromLabel.replace(/\s/g, '')))
    assert(text.includes(connection.toLabel.replace(/\s/g, '')))
  })
  assert(canvas.calls.some((call) => call[0] === 'setLineWidth' && call[1] === 4),
    'report view retains the selected-connection highlight')
})

console.log('audio wiring renderer regression passed')

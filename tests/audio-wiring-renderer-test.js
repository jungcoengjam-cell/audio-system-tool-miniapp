const assert = require('assert')
const { getWiringModel } = require('../pages/audio-wiring/wiring-model')
const {
  drawWiringDiagram, getDiagramHeight, getWiringHitAreas,
  drawWiringReport, getReportHeight,
} = require('../pages/audio-wiring/wiring-renderer')

function recorder() {
  const calls = []
  let fillStyle = ''
  const ctx = {}
  ;['setFontSize', 'setTextAlign', 'setTextBaseline', 'setStrokeStyle', 'setLineWidth',
    'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'fill', 'stroke',
    'fillRect', 'save', 'restore', 'scale'].forEach((method) => {
    ctx[method] = (...args) => calls.push([method, ...args])
  })
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
}

function render(model, width, options = {}) {
  const height = getDiagramHeight(width, model, options)
  const canvas = recorder()
  drawWiringDiagram(canvas.ctx, model, width, height, options)
  assertBounds(canvas.calls, width, height)
  return { ...canvas, height }
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

// The retired cold-open value is rejected without producing a drawable plan.
const coldOpen = getWiringModel('xlrBalanced', 'rcaMono', { outputMode: 'coldOpen' })
assert.strictEqual(coldOpen.status, 'needs-choice')
assert.deepStrictEqual(coldOpen.connections, [])
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
const rightOnly = render(getWiringModel('tsMono', 'tsStereo', { destinationChannel: 'right' }), 320,
  { viewMode: 'wiring', theme: 'dark' })
assert.ok(rightOnly.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#bb9bff'),
  'mono signal sent to the right input uses the right-channel color')
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

// Taking one stereo channel keeps the other physical output explicitly open.
const oneChannel = getWiringModel('stereo35', 'tsMono', { sourceChannel: 'left' })
assert.strictEqual(oneChannel.unconnectedPins.length, 1)
assert.strictEqual(oneChannel.unconnectedPins[0].pin, 'R')
assert.ok(!oneChannel.connections.some((wire) => wire.fromPin === 'R'), 'unselected stereo output R has no connection')
const oneChannelView = render(oneChannel, 320, { viewMode: 'wiring', theme: 'light' })
assert.ok(oneChannelView.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('悬空')),
  'the unselected stereo channel remains visibly open in the functional diagram')

// Conditional requirements, decisions, critical notes and open pins all reach the exported image.
const needsChoice = getWiringModel('xlrBalanced', 'rcaMono')
const guide = render(needsChoice, 320, { viewMode: 'wiring', theme: 'light' })
assert.ok(guide.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('选择')))
assert.ok(guide.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('冷端')))

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

console.log('audio wiring renderer regression passed')

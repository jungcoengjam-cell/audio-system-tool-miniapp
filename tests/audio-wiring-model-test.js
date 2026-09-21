const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { OUTPUT_OPTIONS, INPUT_OPTIONS, getWiringModel, buildWiringText } = require('../pages/audio-wiring/wiring-model')
const {
  drawWiringDiagram,
  getDiagramHeight,
  getWiringHitAreas,
  drawWiringReport,
  getReportHeight,
} = require('../pages/audio-wiring/wiring-renderer')

assert.deepStrictEqual(OUTPUT_OPTIONS.map((item) => item.id), [
  'xlrBalanced', 'trsBalanced', 'terminalBalanced', 'stereo35', 'rcaMono', 'tsMono',
])
assert.deepStrictEqual(INPUT_OPTIONS.map((item) => item.id), [
  'xlrBalanced', 'trsBalanced', 'terminalBalanced', 'rcaStereo', 'tsStereo', 'rcaMono', 'tsMono',
])
const audioImages = [...OUTPUT_OPTIONS, ...INPUT_OPTIONS].map((item) => item.image).filter(Boolean)
assert.ok(audioImages.every((image) => image.startsWith('/pages/audio-wiring/assets/')
  || image === '/assets/home/module-audio-wiring-catalog.png'))
audioImages.forEach((image) => {
  assert.ok(fs.existsSync(path.resolve(__dirname, '..', image.slice(1))), `missing image resource: ${image}`)
})

// Independent pin-level oracle for the 21 plans that need no user choice.
const DIRECT_EXPECTED = {
  'xlrBalanced>xlrBalanced': ['2>2', '3>3', '1>1'],
  'xlrBalanced>trsBalanced': ['2>T', '3>R', '1>S'],
  'xlrBalanced>terminalBalanced': ['2>+', '3>−', '1>G'],
  'trsBalanced>xlrBalanced': ['T>2', 'R>3', 'S>1'],
  'trsBalanced>trsBalanced': ['T>T', 'R>R', 'S>S'],
  'trsBalanced>terminalBalanced': ['T>+', 'R>−', 'S>G'],
  'terminalBalanced>xlrBalanced': ['+>2', '−>3', 'G>1'],
  'terminalBalanced>trsBalanced': ['+>T', '−>R', 'G>S'],
  'terminalBalanced>terminalBalanced': ['+>+', '−>−', 'G>G'],
  'stereo35>rcaStereo': ['T>L中心', 'R>R中心', 'S>L外壳', 'S>R外壳'],
  'stereo35>tsStereo': ['T>L·T', 'R>R·T', 'S>L·S', 'S>R·S'],
  'rcaMono>rcaMono': ['中心针>中心针', '外壳>外壳'],
  'rcaMono>tsMono': ['中心针>T', '外壳>S'],
  'tsMono>rcaMono': ['T>中心针', 'S>外壳'],
  'tsMono>tsMono': ['T>T', 'S>S'],
  'rcaMono>xlrBalanced': ['中心针>2', '外壳>3', '外壳>1'],
  'rcaMono>trsBalanced': ['中心针>T', '外壳>R', '外壳>S'],
  'rcaMono>terminalBalanced': ['中心针>+', '外壳>−', '外壳>G'],
  'tsMono>xlrBalanced': ['T>2', 'S>3', 'S>1'],
  'tsMono>trsBalanced': ['T>T', 'S>R', 'S>S'],
  'tsMono>terminalBalanced': ['T>+', 'S>−', 'S>G'],
}

const allPairs = []
OUTPUT_OPTIONS.forEach((output) => INPUT_OPTIONS.forEach((input) => allPairs.push(`${output.id}>${input.id}`)))
assert.strictEqual(allPairs.length, 42)
assert.strictEqual(Object.keys(DIRECT_EXPECTED).length, 21)

allPairs.forEach((pair) => {
  const [outputId, inputId] = pair.split('>')
  const model = getWiringModel(outputId, inputId)
  if (Object.prototype.hasOwnProperty.call(DIRECT_EXPECTED, pair)) {
    assert.strictEqual(model.status, 'ready', pair)
    assert.strictEqual(model.supported, true, pair)
    assert.deepStrictEqual(model.connections.map((connection) => `${connection.fromPin}>${connection.toPin}`), DIRECT_EXPECTED[pair], pair)
    assert.ok(model.connections.every((connection) => connection.id && connection.fromLabel && connection.toLabel && connection.color && connection.fromRole && connection.toRole), pair)
    assert.ok(model.notes.length > 0 && model.sources.length > 0, pair)
    assert.doesNotThrow(() => buildWiringText(model), pair)
  } else {
    assert.strictEqual(model.status, 'needs-choice', pair)
    assert.strictEqual(model.supported, false, pair)
    assert.ok(model.reason.length > 0, pair)
    assert.ok(model.requirements.length > 0, pair)
    assert.deepStrictEqual(model.connections, [], pair)
    assert.throws(() => buildWiringText(model), /不能生成接线文本/, pair)
  }
})

// The following fixtures spell out the source/target pin truth independently
// of the model implementation; each legal choice combination is checked.
const BALANCED_PINS = {
  xlrBalanced: { positive: '2', negative: '3', shield: '1' },
  trsBalanced: { positive: 'T', negative: 'R', shield: 'S' },
  terminalBalanced: { positive: '+', negative: '−', shield: 'G' },
}
const MONO_PINS = {
  rcaMono: { signal: '中心针', return: '外壳' },
  tsMono: { signal: 'T', return: 'S' },
}
const DUAL_PINS = {
  rcaStereo: { left: { signal: 'L中心', return: 'L外壳' }, right: { signal: 'R中心', return: 'R外壳' } },
  tsStereo: { left: { signal: 'L·T', return: 'L·S' }, right: { signal: 'R·T', return: 'R·S' } },
}
const balancedIds = Object.keys(BALANCED_PINS)
const monoIds = Object.keys(MONO_PINS)
const dualIds = Object.keys(DUAL_PINS)

function assertReadyPins(outputId, inputId, selections, expectedPins, expectedStatus = 'ready') {
  const model = getWiringModel(outputId, inputId, selections)
  assert.strictEqual(model.status, expectedStatus, `${outputId}>${inputId} ${JSON.stringify(selections)}`)
  assert.strictEqual(model.supported, true)
  assert.deepStrictEqual(model.connections.map((connection) => `${connection.fromPin}>${connection.toPin}`), expectedPins,
    `${outputId}>${inputId} ${JSON.stringify(selections)}`)
  assert.ok(model.connections.every((connection) => connection.fromRole && connection.toRole))
  assert.doesNotThrow(() => buildWiringText(model))
  return model
}

let selectedScenarioCount = 0
balancedIds.forEach((outputId) => monoIds.forEach((inputId) => {
  const source = BALANCED_PINS[outputId]
  const target = MONO_PINS[inputId]
  const expected = [`${source.positive}>${target.signal}`, `${source.negative}>${target.return}`, `${source.shield}>${target.return}`]
  const model = assertReadyPins(outputId, inputId, { outputMode: 'coldReturn' }, expected)
  assert.ok(model.criticalNotes.some((note) => note.includes('手册明确允许')))
  assert.ok(buildWiringText(model).includes('冷端与屏蔽'))
  assert.strictEqual(model.unconnectedPins.some((item) => item.side === 'output' && item.pin === source.negative), false)
  selectedScenarioCount += 1
}))
const coldOptions = getWiringModel('xlrBalanced', 'tsMono').requirements[0].options
assert.deepStrictEqual(coldOptions.map((option) => option.id), ['coldReturn'])
assert.strictEqual(getWiringModel('xlrBalanced', 'tsMono').requirements[0].title, '冷端接法')
assert.strictEqual(getWiringModel('xlrBalanced', 'tsMono').requirements[0].hint, '')
assert.strictEqual(coldOptions[0].label, '冷端与屏蔽在输入端汇接')
assert.ok(coldOptions[0].detail.includes('两台设备手册允许'))
const sourceChannelOptions = getWiringModel('stereo35', 'tsMono').requirements[0].options
assert.ok(sourceChannelOptions.every((option) => option.detail.includes('不接')))
assert.strictEqual(getWiringModel('stereo35', 'tsMono').requirements[0].hint,
  '本直连接法只取一路，可能遗漏另一声道内容；未选声道不接。')
const destinationOptions = getWiringModel('tsMono', 'rcaStereo').requirements[0].options
assert.ok(destinationOptions.find((option) => option.id === 'both').detail.includes('确认允许负载'))

balancedIds.forEach((outputId) => dualIds.forEach((inputId) => {
  ;['left', 'right', 'both'].forEach((destinationChannel) => {
    const source = BALANCED_PINS[outputId]
    const channels = destinationChannel === 'both' ? ['left', 'right'] : [destinationChannel]
    const expected = []
    channels.forEach((channel) => {
      const target = DUAL_PINS[inputId][channel]
      expected.push(`${source.positive}>${target.signal}`)
      expected.push(`${source.negative}>${target.return}`)
      expected.push(`${source.shield}>${target.return}`)
    })
    const model = assertReadyPins(outputId, inputId, { outputMode: 'coldReturn', destinationChannel }, expected)
    if (destinationChannel === 'both') assert.ok(model.criticalNotes.some((note) => note.includes('不是混音')))
    else assert.strictEqual(model.unconnectedPins.filter((item) => item.side === 'input').length, 2)
    selectedScenarioCount += 1
  })
}))

;['xlrBalanced', 'trsBalanced', 'terminalBalanced', 'rcaMono', 'tsMono'].forEach((inputId) => {
  ;['left', 'right'].forEach((sourceChannel) => {
    let expected
    if (BALANCED_PINS[inputId]) {
      const target = BALANCED_PINS[inputId]
      expected = [
        `${sourceChannel === 'left' ? 'T' : 'R'}>${target.positive}`,
        `S>${target.negative}`,
        `S>${target.shield}`,
      ]
    } else {
      const target = MONO_PINS[inputId]
      expected = [`${sourceChannel === 'left' ? 'T' : 'R'}>${target.signal}`, `S>${target.return}`]
    }
    const model = assertReadyPins('stereo35', inputId, { sourceChannel }, expected)
    assert.strictEqual(model.unconnectedPins.length, 1)
    assert.ok(buildWiringText(model).includes('保持未接'))
    selectedScenarioCount += 1
  })
})

monoIds.forEach((outputId) => dualIds.forEach((inputId) => {
  ;['left', 'right', 'both'].forEach((destinationChannel) => {
    const source = MONO_PINS[outputId]
    const channels = destinationChannel === 'both' ? ['left', 'right'] : [destinationChannel]
    const expected = []
    channels.forEach((channel) => {
      const target = DUAL_PINS[inputId][channel]
      expected.push(`${source.signal}>${target.signal}`, `${source.return}>${target.return}`)
    })
    const model = assertReadyPins(outputId, inputId, { destinationChannel }, expected)
    if (destinationChannel === 'both') assert.ok(model.criticalNotes.some((note) => note.includes('不是混音')))
    else assert.strictEqual(model.unconnectedPins.filter((item) => item.side === 'input').length, 2)
    selectedScenarioCount += 1
  })
}))
assert.strictEqual(selectedScenarioCount, 46)
assert.strictEqual(Object.keys(DIRECT_EXPECTED).length + selectedScenarioCount, 67)

const irrelevantOldChoices = getWiringModel('xlrBalanced', 'terminalBalanced', {
  outputMode: 'coldOpen', sourceChannel: 'right',
})
assert.deepStrictEqual(irrelevantOldChoices.selectionSummary, [], 'irrelevant old choices do not alter direct mappings')
assert.deepStrictEqual(irrelevantOldChoices.criticalNotes, [])
assert.deepStrictEqual(irrelevantOldChoices.connections.map((connection) => `${connection.fromPin}>${connection.toPin}`),
  ['2>+', '3>−', '1>G'])

balancedIds.forEach((outputId) => ['rcaMono', 'tsMono', 'rcaStereo', 'tsStereo'].forEach((inputId) => {
  const staleSelection = getWiringModel(outputId, inputId, { outputMode: 'coldOpen', destinationChannel: 'left' })
  assert.strictEqual(staleSelection.status, 'needs-choice')
  assert.deepStrictEqual(staleSelection.connections, [])
  assert.throws(() => buildWiringText(staleSelection), /不能生成接线文本/)
}))
assert.ok(getWiringModel('tsMono', 'rcaStereo', { destinationChannel: 'both' }).cableSummary.includes('Y 分线'))

// Missing, invalid, and inapplicable connector ids never produce wiring.
allPairs.forEach((pair) => {
  const [outputId, inputId] = pair.split('>')
  if (DIRECT_EXPECTED[pair]) return
  const missing = getWiringModel(outputId, inputId)
  assert.strictEqual(missing.status, 'needs-choice', pair)
  assert.deepStrictEqual(missing.connections, [], pair)
  assert.throws(() => buildWiringText(missing), /不能生成接线文本/, pair)
  const bad = getWiringModel(outputId, inputId, {
    outputMode: 'ground-it', sourceChannel: 'center', destinationChannel: 'mix',
  })
  assert.strictEqual(bad.status, 'needs-choice', pair)
  assert.deepStrictEqual(bad.connections, [], pair)
})
balancedIds.forEach((outputId) => ['rcaMono', 'tsMono', 'rcaStereo', 'tsStereo'].forEach((inputId) => {
  const model = getWiringModel(outputId, inputId)
  const outputMode = model.requirements.find((requirement) => requirement.id === 'outputMode')
  assert.deepStrictEqual(outputMode.options.map((option) => option.id), ['coldReturn'])
}))

const defaultModel = getWiringModel('xlrBalanced', 'terminalBalanced')
assert.strictEqual(defaultModel.title, '3 针 XLR → 平衡端子')
assert.strictEqual(defaultModel.cableSummary, '双芯双绞屏蔽平衡音频线')
assert.ok(defaultModel.sources.some((source) => source.url.includes('nc3fxx-1.pdf')))
const mlm82Source = getWiringModel('xlrBalanced', 'tsMono').sources.find((source) => source.id === 'raneMlm82s')
assert.ok(mlm82Source.title.includes('（接法限制示例）'))
assert.strictEqual(mlm82Source.claim, '该型号禁止冷端接地，不适用本助手汇接方案。')
assert.ok(defaultModel.notes.some((note) => note.includes('Phoenix')))
assert.ok(!getWiringModel('xlrBalanced', 'trsBalanced').notes.some((note) => note.includes('Phoenix')))
assert.strictEqual(defaultModel.output.cableConnectorGender, '母头')
assert.strictEqual(getWiringModel('terminalBalanced', 'xlrBalanced').input.cableConnectorGender, '公头')

const breakout = getWiringModel('stereo35', 'rcaStereo')
assert.ok(breakout.notes.some((note) => note.includes('T/R 分别对应左/右声道并送入 L/R')))
assert.ok(breakout.notes.some((note) => note.includes('L/R 不可直接并接')))
assert.ok(!breakout.notes.some((note) => note.includes('只取一路') || note.includes('遗漏另一声道')))
const stereoMono = getWiringModel('stereo35', 'rcaMono')
assert.ok(stereoMono.notes.some((note) => note.includes('本直连接法只取一路，可能遗漏另一声道内容')))
assert.ok(stereoMono.notes.some((note) => note.includes('需要两边内容时先通过播放设备或混音器合成为单声道')))
assert.ok(stereoMono.notes.some((note) => note.includes('L/R 不可直接并接')))
assert.deepStrictEqual(breakout.connections.filter((connection) => connection.networkId === 'shield')
  .map((connection) => connection.toLabel), ['左 RCA 外壳（L 回路）', '右 RCA 外壳（R 回路）'])
assert.deepStrictEqual(breakout.connections.slice(0, 2).map((connection) => connection.toLabel),
  ['左 RCA 中心针（L）', '右 RCA 中心针（R）'])
assert.ok(breakout.notes.some((note) => note.includes('TRRS')))
assert.ok(breakout.notes.some((note) => note.includes('音量')))
assert.strictEqual(getWiringModel('stereo35', 'rcaMono').requirements[0].id, 'sourceChannel')

const text = buildWiringText(breakout)
assert.ok(text.includes('T 尖端（左声道 L） → 左 RCA 中心针（L）'))
assert.ok(text.includes('S 套筒（源端公共回路） → 左 RCA 外壳（L 回路）'))
assert.ok(text.includes('S 套筒（源端公共回路） → 右 RCA 外壳（R 回路）'))
assert.ok(text.includes('L/R 不可直接并接'))

;[
  [undefined, 'xlrBalanced'],
  [null, 'xlrBalanced'],
  [1, 'xlrBalanced'],
  [{ toString: () => 'xlrBalanced' }, 'xlrBalanced'],
  ['xlrBalanced', undefined],
  ['xlrBalanced', null],
  ['xlrBalanced', 1],
  ['xlrBalanced', {}],
  ['unknown-output', 'unknown-input'],
].forEach(([outputId, inputId]) => {
  const model = getWiringModel(outputId, inputId)
  assert.strictEqual(model.status, 'unsupported')
  assert.strictEqual(model.supported, false)
  assert.ok(model.reason)
  assert.deepStrictEqual(model.connections, [])
})

// A fresh source pair must produce a fresh, correctly reversed mapping.
assert.deepStrictEqual(getWiringModel('xlrBalanced', 'terminalBalanced').connections.map((c) => `${c.fromPin}>${c.toPin}`),
  ['2>+', '3>−', '1>G'])
assert.deepStrictEqual(getWiringModel('terminalBalanced', 'xlrBalanced').connections.map((c) => `${c.fromPin}>${c.toPin}`),
  ['+>2', '−>3', 'G>1'])

function recorder() {
  const calls = []
  const state = {}
  const ctx = new Proxy({}, {
    get(_, key) {
      return (...args) => calls.push([key, ...args])
    },
    set(_, key, value) {
      state[key] = value
      calls.push(['set', key, value])
      return true
    },
  })
  return { ctx, calls, state }
}

function assertCanvasBounds(calls, width, height) {
  calls.forEach(([method, ...args]) => {
    if (method === 'fillRect' || method === 'strokeRect') {
      assert.ok(args[0] >= 0 && args[0] <= width, `${method} x ${args[0]}`)
      assert.ok(args[1] >= 0 && args[1] <= height, `${method} y ${args[1]}`)
      assert.ok(args[2] >= 0 && args[0] + args[2] <= width + 0.01, `${method} width`)
      assert.ok(args[3] >= 0 && args[1] + args[3] <= height + 0.01, `${method} height`)
    } else if (method === 'moveTo' || method === 'lineTo') {
      assert.ok(args[0] >= 0 && args[0] <= width, `${method} x ${args[0]}`)
      assert.ok(args[1] >= 0 && args[1] <= height, `${method} y ${args[1]}`)
    } else if (method === 'arc') {
      assert.ok(args[0] - args[2] >= 0 && args[0] + args[2] <= width, 'circle x bounds')
      assert.ok(args[1] - args[2] >= 0 && args[1] + args[2] <= height, 'circle y bounds')
    } else if (method === 'fillText') {
      assert.ok(args[1] >= 0 && args[1] <= width, `text x ${args[1]} (${args[0]})`)
      assert.ok(args[2] >= 0 && args[2] <= height, `text y ${args[2]} (${args[0]})`)
    }
  })
}

const functionalHeight = getDiagramHeight(320, breakout, { viewMode: 'wiring' })
assert.ok(functionalHeight >= 280)
const functionalCanvas = recorder()
drawWiringDiagram(functionalCanvas.ctx, breakout, 320, functionalHeight, { viewMode: 'wiring', theme: 'light' })
assertCanvasBounds(functionalCanvas.calls, 320, functionalHeight)
assert.deepStrictEqual(getWiringHitAreas(breakout, 320, functionalHeight).map((area) => area.id),
  ['left', 'right', 'shield-left', 'shield-right'])
assert.ok(getWiringHitAreas(breakout, 320, functionalHeight).every((area) => area.x >= 0 && area.x <= 320 && area.y >= 0 && area.y <= functionalHeight))
assert.ok(getWiringHitAreas(breakout, 320, functionalHeight).every((area) =>
  area.left >= 0 && area.left + area.width <= 320 && area.height >= 44 && area.top >= 0 && area.top + area.height <= functionalHeight))

const xlrPairModel = getWiringModel('xlrBalanced', 'xlrBalanced')
const connectorHeight = getDiagramHeight(320, xlrPairModel, { viewMode: 'connectors' })
const connectorCanvas = recorder()
const connectorMetrics = drawWiringDiagram(connectorCanvas.ctx, xlrPairModel, 320, connectorHeight,
  { viewMode: 'connectors', face: 'mating', theme: 'light' })
assertCanvasBounds(connectorCanvas.calls, 320, connectorHeight)
const connectorHitAreas = getWiringHitAreas(xlrPairModel, 320, connectorHeight,
  { viewMode: 'connectors', face: 'mating' })
assert.strictEqual(connectorHitAreas[0].top, connectorMetrics.mapTop, 'connector row hit targets share the rendered map top')
assert.ok(connectorMetrics.mapTop - 7 > connectorMetrics.headerTop + connectorMetrics.connectorAreaHeight,
  'mapping heading clears the connector panel borders')
function assertXlrGeometry(calls, side, leftPin, rightPin, faceName) {
  const inSide = (call) => side === 'left' ? call[2] < 160 : call[2] > 160
  const pin = (number) => calls.find((call) => call[0] === 'fillText' && call[1] === number && inSide(call))
  const one = pin('1'), two = pin('2'), three = pin('3')
  assert.ok(one && two && three, `${faceName} ${side} side has all XLR pin labels`)
  assert.ok(pin(leftPin)[2] < pin(rightPin)[2], `${faceName} ${side} XLR left/right pin truth`)
  assert.ok(three[3] > one[3] && three[3] > two[3], `${faceName} ${side} pin 3 sits below the upper pair`)
  assert.ok(Math.abs(three[2] - ((one[2] + two[2]) / 2)) < 0.01, `${faceName} ${side} pin 3 is centered`)
}

assertXlrGeometry(connectorCanvas.calls, 'left', '2', '1', 'female mating')
assertXlrGeometry(connectorCanvas.calls, 'right', '1', '2', 'male mating')

const xlrSolderHeight = getDiagramHeight(320, xlrPairModel, { viewMode: 'connectors', face: 'solder' })
const xlrSolderCanvas = recorder()
drawWiringDiagram(xlrSolderCanvas.ctx, xlrPairModel, 320, xlrSolderHeight,
  { viewMode: 'connectors', face: 'solder', theme: 'light' })
assertCanvasBounds(xlrSolderCanvas.calls, 320, xlrSolderHeight)
assertXlrGeometry(xlrSolderCanvas.calls, 'left', '1', '2', 'female solder')
assertXlrGeometry(xlrSolderCanvas.calls, 'right', '2', '1', 'male solder')

const solderModel = getWiringModel('terminalBalanced', 'xlrBalanced')
const solderHeight = getDiagramHeight(320, solderModel, { viewMode: 'connectors', face: 'solder' })
const solderCanvas = recorder()
drawWiringDiagram(solderCanvas.ctx, solderModel, 320, solderHeight,
  { viewMode: 'connectors', face: 'solder', theme: 'dark' })
assertCanvasBounds(solderCanvas.calls, 320, solderHeight)
assert.ok(solderCanvas.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('焊接面')))
assert.ok(solderCanvas.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('左右镜像')))

const tsStereo = getWiringModel('stereo35', 'tsStereo')
const tsStereoHeight = getDiagramHeight(320, tsStereo, { viewMode: 'connectors' })
const tsStereoCanvas = recorder()
drawWiringDiagram(tsStereoCanvas.ctx, tsStereo, 320, tsStereoHeight,
  { viewMode: 'connectors', face: 'mating', theme: 'light' })
assertCanvasBounds(tsStereoCanvas.calls, 320, tsStereoHeight)
assert.strictEqual(tsStereoCanvas.calls.filter((call) => call[0] === 'fillText' && call[1] === 'R' &&
  call[2] > 190 && call[2] < 230 && call[3] >= 120 && call[3] < 190).length, 0,
  'dual TS input heads show no R contact; their separate R channel label remains outside the plug contacts')
assert.ok(tsStereoCanvas.calls.some((call) => call[0] === 'fillText' && call[1] === 'L' && call[2] > 260 && call[3] >= 120 && call[3] < 190),
  'left TS head is explicitly marked L')
assert.ok(tsStereoCanvas.calls.some((call) => call[0] === 'fillText' && call[1] === 'R' && call[2] > 260 && call[3] >= 120 && call[3] < 190),
  'right TS head is explicitly marked R')
assert.ok(tsStereoCanvas.calls.some((call) => call[0] === 'fillText' && call[1] === '3.5 TRS'),
  '3.5 mm TRS header remains a complete connector label')
assert.ok(tsStereoCanvas.calls.some((call) => call[0] === 'fillText' && call[1] === '双TS L/R'),
  'dual TS header remains a complete connector label')
assert.ok(tsStereoCanvas.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#7257ce'),
  'right TS signal contact uses the right-channel color')
const tsMapText = tsStereoCanvas.calls.filter((call) => call[0] === 'fillText').map((call) => call[1]).join('')
assert.ok(tsMapText.includes('左 TS S 套筒（L 回路）') && tsMapText.includes('右 TS S 套筒（R 回路）'),
  'both shared-return destinations stay fully visible')

const rcaStereoCanvas = recorder()
const rcaStereoHeight = getDiagramHeight(320, breakout, { viewMode: 'connectors' })
drawWiringDiagram(rcaStereoCanvas.ctx, breakout, 320, rcaStereoHeight,
  { viewMode: 'connectors', face: 'mating', theme: 'light' })
assert.ok(rcaStereoCanvas.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#7257ce'),
  'right RCA center pin uses the right-channel color')

const reportHeight = getReportHeight(750, defaultModel, { scale: 2 })
const reportCanvas = recorder()
const reportResult = drawWiringReport(reportCanvas.ctx, defaultModel, 750, reportHeight, { theme: 'light', scale: 2 })
assert.strictEqual(reportResult.height, reportHeight)
assertCanvasBounds(reportCanvas.calls, 750, reportHeight)
assert.ok(reportCanvas.calls.some((call) => call[0] === 'fillText' && call[1] === '对应关系'))
assert.ok(reportCanvas.calls.some((call) => call[0] === 'fillText' && call[1] === '适用说明'))
assert.ok(reportCanvas.calls.some((call) => call[0] === 'scale' && call[1] === 2 && call[2] === 2),
  'report explicitly draws at 2x scale for a 720px source that displays at half width')

console.log('audio wiring model and renderer regression passed')

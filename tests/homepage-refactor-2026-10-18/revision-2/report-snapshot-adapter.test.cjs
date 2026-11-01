const assert = require('node:assert/strict')

const seed = require('./qa-report-seed.cjs')
const reportModel = require('../../../pages/records/report-model')
const adapter = require('../../../pages/records/report-snapshot-adapter')
const { calculateDmxAddressPlan } = require('../../../utils/dmx-address')
const { createStageGeometry, layoutFixturePoint } = require('../../../pages/dmx-layout/layout-model')
const { buildLightingExportPages, getCanvasTheme } = require('../../../pages/dmx-layout/layout-renderer')

const NATIVE_MEASURE_FACTOR = 1.22

function createCanvasSpy(widthFactor = NATIVE_MEASURE_FACTOR) {
  const canvas = {
    calls: [],
    font: '16px sans-serif',
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1]) || 16
      const width = [...String(value)].reduce((total, character) => (
        total + (character.codePointAt(0) <= 0xff ? size * 0.62 : size) * widthFactor
      ), 0)
      return { width }
    },
  }
  return new Proxy(canvas, {
    get(target, key) {
      if (key in target) return target[key]
      if (typeof key === 'symbol') return target[key]
      return (...args) => target.calls.push({ method: String(key), args })
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
}

function callText(canvas) {
  return canvas.calls.filter((call) => call.method === 'fillText').map((call) => String(call.args[0]))
}

function drawEverySegment(task, segmentHeight = adapter.REPORT_SEGMENT_HEIGHT, widthFactor = NATIVE_MEASURE_FACTOR) {
  const segments = adapter.splitTaskIntoSegments(task, segmentHeight)
  assert.ok(segments.length > 0, `${task.title} should have at least one image segment`)
  const pages = segments.map((segment) => {
    assert.ok(segment.height <= segmentHeight, `${task.title} segment exceeds its canvas limit`)
    const canvas = createCanvasSpy(widthFactor)
    const drawn = task.drawSegment(canvas, segment.top, segment.height)
    assert.equal(drawn.fullHeight, task.height)
    assert.equal(drawn.width, task.width)
    assert.equal(drawn.height, segment.height)
    assert.ok(canvas.calls.some((call) => call.method === 'fillText'), `${task.title} must draw real report text`)
    assert.ok(canvas.calls.some((call) => call.method === 'fillRect' || call.method === 'beginPath'),
      `${task.title} must draw native report content`)
    return { segment, canvas }
  })
  assert.equal(segments.at(-1).top + segments.at(-1).height, task.height,
    `${task.title} must retain its final image segment`)
  return pages
}

function buildDmxResultText(preferences) {
  const result = calculateDmxAddressPlan({
    startAddress: preferences.startAddressText,
    groups: preferences.groups,
    allocationMode: preferences.allocationMode,
  })
  assert.ok(result && !result.error)
  const groupDomain = (group) => result.allocationMode === 'manual' ? ` · ${group.targetUniverse}域` : ''
  const groupLines = result.groups.flatMap((group) => [
    '', `${group.groupIndex + 1}. ${group.name} · ${group.fixtureCount} 台 · ${group.channelCount} CH/台${groupDomain(group)}`,
    ...group.fixtures.map((fixture) => `   #${fixture.fixtureIndex}  ${fixture.addressText}  占用 ${fixture.rangeText}`),
  ])
  const resultText = [
    '灯具地址码计算', `编址方式：${result.modeText}`, `起始位置：${result.startText}`,
    `规模：${result.totalGroups} 组 · ${result.totalFixtures} 台 · ${result.totalChannels} 个通道`,
    `已用范围：${result.startText} → ${result.endText}`, `下一可用：${result.nextText}`,
    ...groupLines, '', result.ruleText,
    ...result.warnings.map((warning) => `提醒：${warning}`),
    '现场复核：灯具通道模式必须与本次填写一致；换模式后应重新编址，并在控台 Patch、节点域号和灯具地址菜单中逐台核对。',
  ].join('\n')
  return resultText
}

function makeLongDmxRecord() {
  const preferences = {
    startAddressText: '1',
    allocationMode: 'auto',
    groupSummary: '巡演灯具组 × 3（共 36 台）',
    groups: Array.from({ length: 3 }, (_, index) => ({
      name: `巡演灯组${index + 1}`,
      fixtureSource: 'custom',
      fixtureModel: '',
      libraryChannelCount: '',
      customName: `巡演灯组${index + 1}`,
      customChannelCount: '6',
      channelCount: '6',
      fixtureCount: '12',
      targetUniverse: 'A',
    })),
  }
  return {
    id: 'record-report-long-dmx',
    module: 'dmxAddress',
    title: '巡演灯位完整地址',
    summary: '36 台 · A001 → A211',
    preferences,
    resultText: buildDmxResultText(preferences),
  }
}

const storage = seed.createReportQaStorage()
const storageReads = []
global.wx = { getStorageSync(key) { storageReads.push(key); return storage[key] } }

const source = reportModel.loadProjectReportSource(seed.projectId)
assert.equal(source.ok, true, source.error)
assert.equal(source.records.length, 8)
assert.equal(source.lighting.fixtures.length, 2)
const sections = reportModel.getProjectReportSections(source)
const items = sections.flatMap((section) => section.items)
const calculationItems = items.filter((item) => item.type === 'calculation')
const modules = new Set(calculationItems.map((item) => item.record.module))
assert.deepEqual([...modules].sort(), [
  'audioWiring', 'camera', 'cable', 'dmxAddress', 'gainStructure', 'ledScreen', 'limiter', 'spl',
].sort())
assert.deepEqual(items.filter((item) => item.type === 'wiring').map((item) => item.line.id), [
  'line-report-a-001', 'line-report-a-002',
])
assert.equal(items.filter((item) => item.type === 'lighting').length, 1)
assert.ok(storageReads.length > 0, 'seed should exercise the saved-record snapshot source')

const payload = reportModel.buildReportPayload(source, items.map((item) => item.id))
assert.ok(payload)
const payloadText = payload.pages.flatMap((page) => page.lines).map((line) => line.text).join('\n')
assert.ok(payloadText.includes('OUT 1') && payloadText.includes('IN L'))
assert.ok(payloadText.includes('OUT 2') && payloadText.includes('IN R'))
assert.ok(payloadText.includes('A001') && payloadText.includes('A007'), 'lighting addresses stay available in report detail')
source.lighting.fixtures.forEach((fixture) => {
  assert.ok(!payloadText.includes(fixture.stableId), 'lighting summary must omit internal fixture identifiers')
  assert.ok(payloadText.includes(`灯具 ${fixture.fixtureIndex}`), 'lighting summary must retain the readable fixture ordinal')
  assert.ok(payloadText.includes(`完整地址：${fixture.addressText} · 占用范围：${fixture.rangeText}`),
    'lighting summary must retain each address and occupied range')
})
assert.ok(!payloadText.includes(calculationItems[0].record.resultText), 'main report text remains concise while image tasks carry tool results')
const gainItem = calculationItems.find((item) => item.record.module === 'gainStructure')
const gainConditions = ['输入级档位：', '工作条件：', 'DSP 标定：']
  .map((prefix) => gainItem.record.resultText.split(/\r\n|\r|\n/).find((line) => line.startsWith(prefix)))
assert.ok(gainConditions.every(Boolean), 'the saved Gain snapshot fixture must cover all three calculation conditions')
gainConditions.forEach((line) => assert.ok(payloadText.includes(line), `Gain report summary must retain saved condition: ${line}`))
const frozenGain = payload.selectedItems.find((item) => item.id === gainItem.id)
assert.equal(frozenGain.record.resultText, gainItem.record.resultText, 'adding summary conditions must not rewrite saved result text')
assert.deepEqual(frozenGain.record.preferences, gainItem.record.preferences, 'adding summary conditions must not recalculate or mutate saved inputs')

const pageDefinitions = []
global.Page = (definition) => pageDefinitions.push(definition)
const audioBridge = require('../../../pages/audio-wiring/report-bridge')
const audioPhotos = require('../../../pages/audio-wiring/wiring-photos')
const audioRenderer = require('../../../pages/audio-wiring/wiring-renderer')
assert.equal(pageDefinitions.length, 1)
assert.equal(pageDefinitions[0]._payload, undefined, 'requiring bridge code must not start a page lifecycle')

// Once the parent has frozen the source, adapter calls must not read storage or page state.
global.wx = new Proxy({}, { get() { throw new Error('snapshot adapter must not access wx or storage') } })
const nativeMeasureContext = createCanvasSpy(NATIVE_MEASURE_FACTOR)
const directItems = items.filter((item) => item.type === 'calculation' && item.record.module !== 'audioWiring')
let directImageCount = 0
for (const item of directItems) {
  const result = adapter.buildReportImageTasks(item, source.project.name, nativeMeasureContext)
  assert.equal(result.ok, true, `${item.record.module}: ${result.error || ''}`)
  assert.ok(Array.isArray(result.tasks) && result.tasks.length > 0, `${item.record.module} should produce native tool images`)
  result.tasks.forEach((task) => {
    drawEverySegment(task, 500)
    directImageCount += 1
  })
}
assert.ok(directImageCount >= 7, 'all seven direct-render tools should produce genuine native report images')

const lightingItem = items.find((item) => item.type === 'lighting')
const lightingResult = adapter.buildReportImageTasks(lightingItem, source.project.name)
assert.equal(lightingResult.ok, true, lightingResult.error)
assert.deepEqual(lightingResult.coveredFixtureIds, source.lighting.fixtures.map((fixture) => fixture.stableId))
assert.deepEqual(lightingResult.unplacedFixtureIds, [])
assert.match(lightingResult.tasks[0].title, /已布置 2\/2 台/)
const lightingCanvas = createCanvasSpy()
const lightingTask = lightingResult.tasks[0]
lightingTask.drawSegment(lightingCanvas, 0, lightingTask.height)
const lightingTextCalls = lightingCanvas.calls.filter((call) => call.method === 'fillText')
const lightingLayout = source.lighting.scheme.layout
const lightingPage = buildLightingExportPages({
  layout: lightingLayout,
  fixtures: source.lighting.fixtures.map((fixture) => ({ id: fixture.stableId, stableId: fixture.stableId, addressText: fixture.addressText })),
  contextLabel: `${source.project.name} · 已布置 2/2 台`,
}, { width: 1120, height: 1160, maxDimension: 4096 })[0]
const lightingGeometry = createStageGeometry(lightingLayout, lightingPage.diagramWidth, lightingPage.diagramHeight)
source.lighting.fixtures.forEach((fixture) => {
  const savedPosition = fixture.position
  const rod = lightingGeometry.rods.find((entry) => String(entry.id) === String(savedPosition.rodId))
  assert.ok(rod, `native renderer must find the saved rod for fixture ${fixture.stableId}`)
  const point = layoutFixturePoint(lightingGeometry, rod, savedPosition)
  const expectedPoint = { x: point.x + lightingPage.diagramX, y: point.y + lightingPage.diagramTop }
  const addressCall = lightingTextCalls.find((call) => call.args[0] === fixture.addressText)
  assert.ok(addressCall, `native renderer must draw address ${fixture.addressText} for fixture ${fixture.stableId}`)
  assert.ok(Math.hypot(addressCall.args[1] - expectedPoint.x, addressCall.args[2] - expectedPoint.y) < 80,
    `address ${fixture.addressText} must be drawn at its saved fixture position (${fixture.stableId})`)
  const fixtureMarkerDrawn = lightingCanvas.calls.some((call) => call.method === 'fillRect'
    && Math.abs((call.args[0] + (call.args[2] / 2)) - expectedPoint.x) < 1
    && call.args[1] >= expectedPoint.y && call.args[1] <= expectedPoint.y + 20)
  assert.ok(fixtureMarkerDrawn, `native renderer must draw the fixture marker at the saved position (${fixture.stableId})`)
})

function lightingItemWithPosition(fixtureId, position) {
  const changed = structuredClone(lightingItem)
  const fixture = changed.lighting.fixtures.find((entry) => entry.stableId === fixtureId)
  fixture.position = position
  changed.lighting.scheme.layout.positionsById[fixtureId] = position
  return changed
}

const firstLightingFixture = source.lighting.fixtures[0]
for (const [label, position] of [
  ['legacy x/y position without rod', { x: 0.28, y: 0.32, zone: 'stage-left', row: 1, column: 1 }],
  ['unknown rod id', { rodId: 'historic-rod-no-longer-present', t: 0.4 }],
  ['out-of-range rod position', { rodId: lightingLayout.internalRods[0].id, t: 1.2 }],
]) {
  const invalidPosition = adapter.buildReportImageTasks(lightingItemWithPosition(firstLightingFixture.stableId, position), source.project.name)
  assert.equal(invalidPosition.ok, false, `${label} must not be rendered as a default fixture placement`)
  assert.match(invalidPosition.error, /历史位置无法还原/)
}

const groundFixtureId = firstLightingFixture.stableId
const groundFixture = source.lighting.fixtures.find((fixture) => fixture.stableId === groundFixtureId)
for (const [label, position] of [
  ['top-left', { kind: 'ground', x: 0, y: 0 }],
  ['top-right', { kind: 'ground', x: 1, y: 0 }],
  ['bottom-left', { kind: 'ground', x: 0, y: 1 }],
  ['bottom-right', { kind: 'ground', x: 1, y: 1 }],
  ['legacy ground flag', { ground: true, x: 0.25, y: 0.75 }],
]) {
  const groundItem = lightingItemWithPosition(groundFixtureId, position)
  groundItem.lighting.fixtures.forEach((fixture) => { fixture.checked = true })
  const groundResult = adapter.buildReportImageTasks(groundItem, source.project.name)
  assert.equal(groundResult.ok, true, `${label}: ${groundResult.error || ''}`)
  assert.deepEqual(groundResult.coveredFixtureIds, source.lighting.fixtures.map((fixture) => fixture.stableId),
    `${label} ground positions must remain in a mixed ground/rod image`)
  assert.deepEqual(groundResult.unplacedFixtureIds, [])

  const groundCanvas = createCanvasSpy()
  groundResult.tasks[0].drawSegment(groundCanvas, 0, groundResult.tasks[0].height)
  const groundText = callText(groundCanvas)
  assert.ok(groundText.includes(`地 · ${groundFixture.addressText}`), `${label} marker must be drawn on the stage`)
  assert.ok(groundText.some((text) => text.includes('舞台地面灯'))
    && groundText.some((text) => text.includes(groundFixture.addressText)),
    `${label} ground fixture must remain in the address list`)
  assert.ok(!groundCanvas.calls.some((call) => call.method === 'setStrokeStyle'
    && call.args[0] === getCanvasTheme('light').success),
  `${label} exported image must not show the checked-address badge`)

  const layout = groundItem.lighting.scheme.layout
  const page = buildLightingExportPages({
    layout,
    fixtures: groundItem.lighting.fixtures.map((fixture) => ({ ...fixture, id: fixture.stableId })),
    contextLabel: `${source.project.name} · 已布置 2/2 台`,
  }, { width: 1120, height: 1160, maxDimension: 4096 })[0]
  const geometry = createStageGeometry(layout, page.diagramWidth, page.diagramHeight)
  const expectedGroundPoint = layoutFixturePoint(geometry, null, position)
  assert.equal(expectedGroundPoint.x, geometry.stage.left + position.x * geometry.stage.width,
    `${label} x must be preserved at the stage boundary`)
  assert.equal(expectedGroundPoint.y, geometry.stage.top + position.y * geometry.stage.height,
    `${label} y must be preserved at the stage boundary`)
}

for (const [label, position] of [
  ['NaN x', { kind: 'ground', x: NaN, y: 0.5 }],
  ['infinite y', { kind: 'ground', x: 0.5, y: Infinity }],
  ['negative x', { kind: 'ground', x: -0.01, y: 0.5 }],
  ['x above one', { kind: 'ground', x: 1.01, y: 0.5 }],
  ['string x', { kind: 'ground', x: '0.5', y: 0.5 }],
  ['null y', { ground: true, x: 0.5, y: null }],
  ['contradictory ground flag', { kind: 'ground', ground: false, x: 0.5, y: 0.5 }],
  ['ground and rod marker', { ground: true, kind: 'rod', rodId: lightingLayout.internalRods[0].id, t: 0.5, x: 0.5, y: 0.5 }],
  ['ground with rod fields', { kind: 'ground', rodId: lightingLayout.internalRods[0].id, t: 0.5, x: 0.5, y: 0.5 }],
]) {
  const invalidGround = adapter.buildReportImageTasks(lightingItemWithPosition(groundFixtureId, position), source.project.name)
  assert.equal(invalidGround.ok, false, `${label} must not be clamped or rendered as a valid position`)
  assert.match(invalidGround.error, /历史位置无法还原/)
}

const inconsistentGroundSnapshot = structuredClone(lightingItem)
inconsistentGroundSnapshot.lighting.fixtures[0].position = { kind: 'ground', x: 0.5, y: 0.5 }
const inconsistentGroundResult = adapter.buildReportImageTasks(inconsistentGroundSnapshot, source.project.name)
assert.equal(inconsistentGroundResult.ok, false)
assert.match(inconsistentGroundResult.error, /位置快照彼此不一致/,
  'the fixture position must still match the layout position snapshot')

for (const [label, invalidateLayout] of [
  ['missing saved stage width', (layout) => { delete layout.stageWidthText }],
  ['non-finite saved stage depth', (layout) => { layout.stageDepthText = 'unknown' }],
  ['unknown saved apron direction', (layout) => { layout.apronDirection = 'historic-direction' }],
  ['missing saved internal rod list', (layout) => { delete layout.internalRods }],
  ['missing saved front rod list', (layout) => { delete layout.frontRods }],
  ['invalid saved internal rod distance', (layout) => { layout.internalRods[0].distance = 0 }],
  ['invalid saved front rod distance', (layout) => { layout.frontRods[0].distance = 0 }],
]) {
  const invalidLayoutItem = structuredClone(lightingItem)
  invalidateLayout(invalidLayoutItem.lighting.scheme.layout)
  const invalidLayout = adapter.buildReportImageTasks(invalidLayoutItem, source.project.name)
  assert.equal(invalidLayout.ok, false, `${label} must not be replaced by renderer defaults`)
  assert.match(invalidLayout.error, /舞台尺寸、朝向或灯杆结构不完整/)
}

const partiallyUnplacedItem = lightingItemWithPosition(firstLightingFixture.stableId, null)
const partialLightingResult = adapter.buildReportImageTasks(partiallyUnplacedItem, source.project.name)
assert.equal(partialLightingResult.ok, true, partialLightingResult.error)
assert.deepEqual(partialLightingResult.coveredFixtureIds, [source.lighting.fixtures[1].stableId])
assert.deepEqual(partialLightingResult.unplacedFixtureIds, [firstLightingFixture.stableId])
assert.match(partialLightingResult.tasks[0].title, /已布置 1\/2 台 · 未布置 1 台/)
const partialCanvas = createCanvasSpy()
partialLightingResult.tasks[0].drawSegment(partialCanvas, 0, partialLightingResult.tasks[0].height)
const partialImageText = callText(partialCanvas).join('\n')
assert.ok(partialImageText.includes(source.lighting.fixtures[1].addressText))
assert.ok(!partialImageText.includes(firstLightingFixture.addressText), 'an unplaced fixture must not be counted or drawn in the layout image')
const unplacedSource = structuredClone(source)
unplacedSource.lighting.fixtures[0].position = null
unplacedSource.lighting.scheme.layout.positionsById[firstLightingFixture.stableId] = null
const unplacedPayload = reportModel.buildReportPayload(unplacedSource, [lightingItem.id])
const unplacedText = unplacedPayload.pages.flatMap((page) => page.lines).map((line) => line.text).join('')
assert.ok(!unplacedText.includes(firstLightingFixture.stableId), 'the report text must omit internal fixture identity')
assert.ok(unplacedText.includes('布置位置：未布置（未进入灯位图）'), 'the summary must explicitly distinguish a genuine unplaced fixture')
const noPlacedFixtures = structuredClone(partiallyUnplacedItem)
noPlacedFixtures.lighting.fixtures[1].position = null
noPlacedFixtures.lighting.scheme.layout.positionsById[source.lighting.fixtures[1].stableId] = null
const emptyLightingResult = adapter.buildReportImageTasks(noPlacedFixtures, source.project.name)
assert.equal(emptyLightingResult.ok, true, emptyLightingResult.error)
assert.deepEqual(emptyLightingResult.coveredFixtureIds, [], 'an empty stage diagram must not count unplaced fixtures as image coverage')
assert.deepEqual(emptyLightingResult.unplacedFixtureIds, source.lighting.fixtures.map((fixture) => fixture.stableId))
assert.match(emptyLightingResult.tasks[0].title, /已布置 0\/2 台 · 未布置 2 台/)
const emptyCanvas = createCanvasSpy()
emptyLightingResult.tasks[0].drawSegment(emptyCanvas, 0, emptyLightingResult.tasks[0].height)
assert.ok(!callText(emptyCanvas).some((text) => source.lighting.fixtures.some((fixture) => fixture.addressText === text)))
assert.ok(emptyCanvas.calls.some((call) => call.method === 'strokeRect'), 'the honest zero-placement image still contains the native stage drawing')
const noRodsLayoutItem = structuredClone(noPlacedFixtures)
noRodsLayoutItem.lighting.scheme.layout.internalRods = []
noRodsLayoutItem.lighting.scheme.layout.frontRods = []
const noRodsResult = adapter.buildReportImageTasks(noRodsLayoutItem, source.project.name)
assert.equal(noRodsResult.ok, true, noRodsResult.error || 'the layout editor permits explicitly empty rod lists')
assert.deepEqual(noRodsResult.coveredFixtureIds, [])

const groundWithoutRods = structuredClone(noPlacedFixtures)
groundWithoutRods.lighting.scheme.layout.internalRods = []
groundWithoutRods.lighting.scheme.layout.frontRods = []
groundWithoutRods.lighting.fixtures.forEach((fixture, index) => {
  const position = index === 0
    ? { kind: 'ground', x: 0.2, y: 0.3 }
    : { ground: true, x: 0.8, y: 0.7 }
  fixture.position = position
  groundWithoutRods.lighting.scheme.layout.positionsById[fixture.stableId] = position
})
const groundWithoutRodsResult = adapter.buildReportImageTasks(groundWithoutRods, source.project.name)
assert.equal(groundWithoutRodsResult.ok, true, groundWithoutRodsResult.error)
assert.deepEqual(groundWithoutRodsResult.coveredFixtureIds, source.lighting.fixtures.map((fixture) => fixture.stableId))
assert.deepEqual(groundWithoutRodsResult.unplacedFixtureIds, [])
const groundWithoutRodsCanvas = createCanvasSpy()
groundWithoutRodsResult.tasks[0].drawSegment(groundWithoutRodsCanvas, 0, groundWithoutRodsResult.tasks[0].height)
assert.ok(callText(groundWithoutRodsCanvas).includes(`地 · ${source.lighting.fixtures[0].addressText}`))

const manyGroundFixtures = structuredClone(lightingItem)
const groupId = manyGroundFixtures.lighting.scheme.groupIds[0]
const templateFixture = manyGroundFixtures.lighting.fixtures[0]
const manyIds = Array.from({ length: 41 }, (_, index) => `fixture-page-${index + 1}`)
manyGroundFixtures.lighting.fixtures = manyIds.map((stableId, index) => {
  const position = index % 2 === 0
    ? { kind: 'ground', x: (index % 10) / 9, y: Math.floor(index / 10) / 4 }
    : { rodId: lightingLayout.internalRods[0].id, t: (index + 1) / 42 }
  return {
    ...templateFixture,
    stableId,
    groupId,
    fixtureIndex: index + 1,
    addressText: `A${String(index + 1).padStart(3, '0')}`,
    rangeText: `A${String(index + 1).padStart(3, '0')}-A${String(index + 6).padStart(3, '0')}`,
    checked: true,
    position,
  }
})
manyGroundFixtures.lighting.scheme.preferences.groups[0].fixtureCount = manyIds.length
manyGroundFixtures.lighting.scheme.fixtureIdsByGroup[groupId] = manyIds
manyGroundFixtures.lighting.scheme.layout.positionsById = Object.fromEntries(
  manyGroundFixtures.lighting.fixtures.map((fixture) => [fixture.stableId, fixture.position]),
)
const pagedLightingResult = adapter.buildReportImageTasks(manyGroundFixtures, source.project.name)
assert.equal(pagedLightingResult.ok, true, pagedLightingResult.error)
assert.equal(pagedLightingResult.tasks.length, 2, '41 placed fixtures must produce two complete lighting image pages')
assert.deepEqual(pagedLightingResult.coveredFixtureIds, manyIds)
assert.deepEqual(pagedLightingResult.unplacedFixtureIds, [])
assert.match(pagedLightingResult.tasks[0].title, /1\/2/)
assert.match(pagedLightingResult.tasks[1].title, /2\/2/)
pagedLightingResult.tasks.forEach((task) => {
  const canvas = createCanvasSpy()
  task.drawSegment(canvas, 0, task.height)
  assert.ok(callText(canvas).some((text) => text.startsWith('地 · A')),
    `${task.title} must draw ground fixture addresses on its own page`)
})

const audioItem = calculationItems.find((item) => item.record.module === 'audioWiring')
const audio = audioBridge.buildRecordModel(audioItem)
assert.equal(audio.ok, true, audio.error)
const unknownAudio = structuredClone(audioItem)
unknownAudio.record.preferences.outputId = 'historic-unknown-port'
assert.equal(audioBridge.buildRecordModel(unknownAudio).ok, false, 'unknown saved connector models must not use current defaults')
const editedAudioText = structuredClone(audioItem)
editedAudioText.record.resultText += '\n历史结果被改写'
assert.match(audioBridge.buildRecordModel(editedAudioText).error, /文本不一致/)
const photos = Object.fromEntries(audioPhotos.getModelPhotoSpecs(audio.model)
  .map((spec) => [spec.key, { width: spec.width, height: spec.height }]))
const audioCanvas = createCanvasSpy()
audioRenderer.drawWiringReport(audioCanvas, audio.model, 720, audio.height, { ...audio.options, photos })
assert.ok(callText(audioCanvas).length > 0, 'audio-wiring report renderer should draw its saved connection diagram')
assert.ok(audioCanvas.calls.filter((call) => call.method === 'drawImage').length >= 2,
  'audio-wiring report should use the native connector photos')

const wiring = require('../../../pages/project-wiring/report')
const wiringReport = wiring.buildScheduleReportPages(source.project.name, source.schedule, 'project')
assert.equal(wiringReport.lineCount, 2)
assert.ok(wiringReport.pages.length > 0)
const wiringCanvas = createCanvasSpy()
wiring.drawScheduleReport(wiringCanvas, wiringReport.pages[0], { theme: 'light' })
const wiringText = callText(wiringCanvas).join('\n')
assert.ok(wiringText.includes('OUT 1') && wiringText.includes('IN L'))
assert.ok(wiringText.includes('OUT 2') && wiringText.includes('IN R'))
assert.ok(wiringText.includes('18.') && wiringText.includes('5 m') && wiringText.includes('20') && wiringText.includes('m'))

const longRecord = makeLongDmxRecord()
assert.ok(longRecord.resultText.split('\n').length > adapter.MAX_RESULT_LINES)
const longResult = adapter.buildReportImageTasks({ id: 'record:long-dmx', type: 'calculation', record: longRecord }, '', nativeMeasureContext)
assert.equal(longResult.ok, true, longResult.error)
assert.ok(longResult.tasks.length > 1, 'long saved results must be paginated instead of truncated at 20 lines')
const longDrawText = longResult.tasks.flatMap((task) => drawEverySegment(task).flatMap(({ canvas }) => callText(canvas)))
assert.ok(longDrawText.some((line) => line.includes('A001')))
assert.ok(longDrawText.some((line) => line.includes('A211')), 'the last saved fixture address must appear in a generated image')

const manualDmx = makeLongDmxRecord()
manualDmx.id = 'record-report-manual-dmx'
manualDmx.preferences.allocationMode = 'manual'
manualDmx.preferences.groupSummary = '历史手动域编址'
manualDmx.preferences.groups = manualDmx.preferences.groups.slice(0, 1).map((group) => ({
  ...group, fixtureCount: '3', targetUniverse: 'D',
}))
manualDmx.resultText = buildDmxResultText(manualDmx.preferences)
const manualResult = adapter.buildReportImageTasks({ id: 'record:manual-dmx', type: 'calculation', record: manualDmx }, '', nativeMeasureContext)
assert.equal(manualResult.ok, true, manualResult.error)
const manualText = manualResult.tasks.flatMap((task) => drawEverySegment(task).flatMap(({ canvas }) => callText(canvas))).join('\n')
assert.ok(manualText.includes('D001') && manualText.includes('D013'), 'saved manual DMX domain and ranges must remain visible')
const unknownManualDmx = structuredClone(manualDmx)
unknownManualDmx.preferences.groups[0].targetUniverse = 'Z'
unknownManualDmx.resultText = buildDmxResultText(unknownManualDmx.preferences)
const unknownManualResult = adapter.buildReportImageTasks({ id: 'record:unknown-manual-dmx', type: 'calculation', record: unknownManualDmx })
assert.equal(unknownManualResult.ok, false)
assert.match(unknownManualResult.error, /手动编址.*域无法识别/)

const cameraItem = calculationItems.find((item) => item.record.module === 'camera')
const cameraTask = adapter.buildReportImageTasks(cameraItem, '', nativeMeasureContext).tasks[0]
const cameraSegments = adapter.splitTaskIntoSegments(cameraTask, 500)
assert.ok(cameraSegments.length > 1, 'a tall native tool image should be segmented at its original size')
assert.equal(cameraSegments.at(-1).top + cameraSegments.at(-1).height, cameraTask.height)
const translated = cameraSegments.map((segment) => {
  const canvas = createCanvasSpy()
  cameraTask.drawSegment(canvas, segment.top, segment.height)
  return canvas.calls.find((call) => call.method === 'translate')?.args
})
assert.deepEqual(translated, cameraSegments.map((segment) => [0, -segment.top]))

const badCamera = structuredClone(cameraItem)
badCamera.record.preferences.cameraCalculationVersion = 999
const badVersion = adapter.buildReportImageTasks(badCamera, '', nativeMeasureContext)
assert.equal(badVersion.ok, false)
assert.match(badVersion.error, /版本|无法识别|不支持/)
const badDmx = structuredClone(calculationItems.find((item) => item.record.module === 'dmxAddress'))
badDmx.record.resultText = `${badDmx.record.resultText}\n人为更改的历史结果`
const mismatch = adapter.buildReportImageTasks(badDmx)
assert.equal(mismatch.ok, false)
assert.match(mismatch.error, /不一致/)

const splItem = calculationItems.find((item) => item.record.module === 'spl')
const missingMeasurement = adapter.buildReportImageTasks(splItem)
assert.equal(missingMeasurement.ok, false, 'native text layout must refuse when no platform measurement context is supplied')
assert.match(missingMeasurement.error, /测量.*结果文字/)
const missingSavedInput = structuredClone(splItem)
delete missingSavedInput.record.preferences.distanceText
const missingInputResult = adapter.buildReportImageTasks(missingSavedInput, '', nativeMeasureContext)
assert.equal(missingInputResult.error, '这条记录缺少完整的历史输入，无法还原工具图片。',
  'user-visible snapshot errors must use plain Chinese instead of internal field names')
const wideMetrics = adapter.buildReportImageTasks(splItem, '', createCanvasSpy(1.55))
const narrowMetrics = adapter.buildReportImageTasks(splItem, '', createCanvasSpy(0.78))
assert.equal(wideMetrics.ok, true, wideMetrics.error)
assert.equal(narrowMetrics.ok, true, narrowMetrics.error)
assert.ok(wideMetrics.tasks[0].height > narrowMetrics.tasks[0].height,
  'report page height must follow the injected font metrics instead of a fixed character estimate')
drawEverySegment(wideMetrics.tasks[0], adapter.REPORT_SEGMENT_HEIGHT, 1.55)

const longLimiter = structuredClone(calculationItems.find((item) => item.record.module === 'limiter'))
const longReviewText = '超长现场复核文本'.repeat(36)
longLimiter.record.resultText += `\n额外事项：${longReviewText}`
const originalLongLimiter = structuredClone(longLimiter.record)
const longLimiterTasks = adapter.buildReportImageTasks(longLimiter, '', createCanvasSpy(1.42))
assert.equal(longLimiterTasks.ok, true, longLimiterTasks.error)
assert.ok(longLimiterTasks.tasks.length > 1, 'long saved limiter text must continue on another original-renderer page')
const longLimiterNativeText = drawEverySegment(longLimiterTasks.tasks[0], adapter.REPORT_SEGMENT_HEIGHT, 1.42)
  .flatMap(({ canvas }) => callText(canvas)).join('')
const longLimiterContinuationText = longLimiterTasks.tasks.slice(1)
  .flatMap((task) => drawEverySegment(task, adapter.REPORT_SEGMENT_HEIGHT, 1.42))
  .flatMap(({ canvas }) => callText(canvas)).join('')
assert.equal((longLimiterNativeText.match(/超长/g) || []).length, 36,
  'the specialized limiter renderer must receive the complete unsplit snapshot')
assert.equal((longLimiterContinuationText.match(/超长/g) || []).length, 36,
  'generic limiter continuation must independently preserve the complete original paragraph')
assert.deepEqual(longLimiter.record, originalLongLimiter, 'rendering must not rewrite the saved limiter snapshot')

const gainSnapshot = structuredClone(gainItem)
const originalGainRecord = structuredClone(gainSnapshot.record)
const gainTasksResult = adapter.buildReportImageTasks(gainSnapshot, '', createCanvasSpy(1.22))
assert.equal(gainTasksResult.ok, true, gainTasksResult.error)
assert.ok(gainTasksResult.tasks.length >= 2, 'gain report should retain its native image and concise narrative supplement')
const gainNativeText = drawEverySegment(gainTasksResult.tasks[0], adapter.REPORT_SEGMENT_HEIGHT, 1.22)
  .flatMap(({ canvas }) => callText(canvas)).join('')
assert.ok(gainNativeText.includes('平均电平随节目内容与动态变化'),
  'native gain DSP input table must receive the whole saved value rather than a first-page fragment')
assert.ok(gainNativeText.includes('不要重复衰减。'),
  'native gain warning must retain its complete ending punctuation')
assert.ok(!gainNativeText.includes('不要重复衰减。减。'), 'native warning must not acquire an orphan continuation fragment')
const gainSupplementCanvases = gainTasksResult.tasks.slice(1)
  .flatMap((task) => drawEverySegment(task, adapter.REPORT_SEGMENT_HEIGHT, 1.22))
  .map(({ canvas }) => canvas)
const gainSupplementText = gainSupplementCanvases.flatMap(callText)
assert.ok(gainSupplementText.join('').includes('结果边界：系统对齐衰减只建立电气基准'),
  'gain supplements should retain the first complete narrative paragraph')
assert.ok(gainSupplementText.join('').includes('现场复核：用测试信号、电平表和功放指示灯核对；理论值不替代实际校准。'),
  'gain supplements should retain the last complete narrative paragraph')
assert.ok(!gainSupplementText.some((line) => line.trim() === '减。'),
  'generic gain continuation must not contain an orphan fragment from the native warning')
assert.ok(!gainSupplementText.some((line) => line.startsWith('DSP 输入表目标：')
  || line.startsWith('输入级档位：') || line.startsWith('工作条件：') || line.startsWith('DSP 标定：')),
  'supplement pages must not duplicate conditions already in the summary or specialized image')
assert.deepEqual(gainSnapshot.record, originalGainRecord, 'rendering must preserve every saved gain input and result line')

const flowStorage = seed.createReportQaStorage()
const flowWorkspace = flowStorage['audioTool.dmxLightingWorkspace.v2']
const flowScheme = flowWorkspace.contexts[seed.projectId].scheme
const flowFixtureId = flowScheme.fixtureIdsByGroup[flowScheme.groupIds[0]][0]
flowScheme.layout.positionsById[flowFixtureId] = { kind: 'ground', x: 0, y: 1 }
const flowCanvases = []
const flowWx = {
  getStorageSync: (key) => flowStorage[key],
  createCanvasContext() {
    const canvas = createCanvasSpy()
    canvas.draw = (reserve, callback) => callback?.()
    flowCanvases.push(canvas)
    return canvas
  },
  canvasToTempFilePath(options) { options.success({ tempFilePath: `temp://ground-report-${flowCanvases.length}.png` }) },
  showToast() {},
  vibrateShort() {},
}
const flowDefinitions = []
const previousWx = global.wx
const previousPage = global.Page
global.wx = flowWx
global.Page = (definition) => flowDefinitions.push(definition)
delete require.cache[require.resolve('../../../pages/records/report')]
require('../../../pages/records/report')
const flowPageDefinition = flowDefinitions[0]
assert.ok(flowPageDefinition, 'the normal project report page must register')
const flowPage = {
  ...flowPageDefinition,
  data: structuredClone(flowPageDefinition.data),
  setData(changes, callback) {
    this.data = { ...this.data, ...changes }
    callback?.()
  },
}
flowPage.onLoad({ id: seed.projectId })
const flowLightingItem = reportModel.getProjectReportSections(flowPage.reportSource)
  .flatMap((section) => section.items).find((item) => item.type === 'lighting')
assert.ok(flowLightingItem, 'the seeded project must produce a lighting report candidate')
flowPage.updateSelection([flowLightingItem.id])
flowPage.generateReport()
assert.equal(flowPage.data.mode, 'preview', flowPage.data.pageStatus)
assert.equal(flowPage.data.isGenerating, false)
assert.ok(flowPage.data.pageCount >= 2, 'the normal report flow must export both summary and lighting image pages')
assert.ok(flowPage.data.reportPages.some((page) => page.title?.includes('灯位原生图')))
assert.ok(flowCanvases.some((canvas) => callText(canvas).includes(`地 · ${flowPage.reportSource.lighting.fixtures[0].addressText}`)),
  'the normal report flow must draw the saved ground position before opening preview')
global.wx = previousWx
global.Page = previousPage

console.log(`Report snapshot adapter: PASS (${directImageCount} direct native images, audio-wiring connector photos, ${wiringReport.lineCount} wiring lines, lighting addresses, complete long DMX pages)`)

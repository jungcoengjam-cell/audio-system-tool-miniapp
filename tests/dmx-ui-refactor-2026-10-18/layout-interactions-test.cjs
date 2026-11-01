// Exercise actual page controllers against the real workspace helper.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone, stageLightingProductIndex } = require('./controller-runtime.cjs')
const workspace = require('../../pages/dmx-layout/lighting-workspace')
const { createDmxLayoutPage } = require('../../pages/dmx-layout/page-factory')
let runtime
let storage
let modals
let toasts

function reset(count = 30, model = 'TL-SL323', mode = 2) {
  runtime?.dispose()
  runtime = createRuntime()
  const product = stageLightingProductIndex.get(model)
  runtime.seed([{
    name: product.name,
    fixtureSource: 'library',
    fixtureModel: model,
    channelCount: String(mode),
    libraryChannelCount: String(mode),
    fixtureCount: String(count),
    targetUniverse: 'A',
  }])
  storage = runtime.storage
  modals = runtime.modals
  toasts = runtime.toasts
}

function makePage(mode = 'portrait') {
  const definition = createDmxLayoutPage({ mode })
  const page = { ...definition, data: clone(definition.data), route: mode === 'landscape' ? 'pages/dmx-layout-landscape/dmx-layout-landscape' : 'pages/dmx-layout/dmx-layout', _qaActive: true, _qaPatches: [] }
  page.setData = (patch, callback) => {
    page._qaPatches.push(clone(patch))
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {})
      target[parts.at(-1)] = clone(value)
    }
    callback?.()
  }
  runtime.pages.push(page)
  page.onLoad({})
  assert.equal(page.data.hasPlan, true)
  return page
}

const results = []
function test(name, body) {
  try { body(); results.push({ name, passed: true }); console.log('PASS ' + name) }
  catch (error) { results.push({ name, passed: false, error: error.stack }); console.error('FAIL ' + name + ': ' + error.message) }
}

test('double tap marks only; single taps place and withdraw while preserving address checks', () => {
  reset()
  const page = makePage(), first = page._fixtures[0].stableId, checks = clone(page._scheme.checksById)
  const rod = page._layout.internalRods[0].id
  page.openPlacementPanel(rod)
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: first } } })
  assert.equal(Object.keys(page._layout.positionsById).length, 0, 'the first tap waits briefly for double-tap detection')
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: first } } })
  assert.equal(Object.keys(page._layout.positionsById).length, 0, 'a double tap never places a lamp')
  const checkedState = clone(workspace.readLightingWorkspace().scheme.checksById[first])
  assert.ok(checkedState, 'the selected lamp can be marked independently')
  for (const fixture of page._fixtures) {
    page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
    page.settlePendingFixtureTap()
  }
  const placed = Object.values(page._layout.positionsById)
  assert.equal(placed.length, 30)
  assert.equal(new Set(placed.map(position => position.t)).size, 30)
  assert(placed.every(position => position.rodId === rod && position.t >= 0 && position.t <= 1))
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: first } } })
  page.settlePendingFixtureTap()
  assert.equal(modals.length, 0, 'a current-target single tap withdraws without a separate confirmation')
  assert.equal(Object.keys(page._layout.positionsById).length, 29)
  assert.deepEqual(workspace.readLightingWorkspace().scheme.checksById[first], checkedState)
  assert.deepEqual(Object.keys(workspace.readLightingWorkspace().scheme.checksById).sort(), [...new Set([...Object.keys(checks), first])].sort())
})

test('cross-target inspection preserves source; withdrawal at source precedes placement on new target', () => {
  reset(2)
  const page = makePage(), fixture = page._fixtures[0], before = fixture.addressText
  const a = page._layout.internalRods[0].id, b = page._layout.frontRods[0].id
  page.assignFixtureToRod(fixture, a)
  page.openPlacementPanel(b)
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  page.settlePendingFixtureTap()
  assert.equal(modals.length, 0, 'selecting a fixture must not open a transfer confirmation')
  assert.equal(page._layout.positionsById[fixture.stableId].rodId, a)
  assert.equal(toasts.at(-1).title, '到灯杆1撤出', 'cross-target feedback names the original rod without a layout-shifting row')

  page.closePlacementPanel()
  page.openPlacementPanel(a)
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  page.settlePendingFixtureTap()
  assert.equal(modals.length, 0)
  assert.equal(page._layout.positionsById[fixture.stableId], undefined, 'the source-target tap withdraws')

  page.closePlacementPanel()
  page.openPlacementPanel(b)
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  page.settlePendingFixtureTap()
  assert.equal(page._layout.positionsById[fixture.stableId].rodId, b)
  assert.equal(Object.keys(page._layout.positionsById).length, 1)
  assert.equal(page._fixtures[0].addressText, before)
})

test('zero-rod canvas entry double-marks and single-tap places a ground fixture', () => {
  reset(2)
  const page = makePage(), fixture = page._fixtures[0]
  const emptyRods = clone(page._layout)
  emptyRods.internalRods = []
  emptyRods.frontRods = []
  emptyRods.legacySideRods = []
  page._layout = emptyRods
  page.openPlacementPanel('ground')
  assert.equal(page.data.placementVisible, true, 'the panel opens without a selected rod')
  assert.equal(page._activeRodId, '')
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  assert.equal(Object.keys(page._layout.positionsById).length, 0)
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  assert.equal(page.data.selectedFixtureId, fixture.stableId)
  assert.equal(page.data.selectedFixtureChecked, true)
  assert.equal(Object.keys(page._layout.positionsById).length, 0, 'address double tap remains separate from placement')
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  page.settlePendingFixtureTap()
  const ground = clone(page._layout.positionsById[fixture.stableId])
  assert.equal(ground.kind, 'ground')
  assert(ground.x >= 0 && ground.x <= 1 && ground.y >= 0 && ground.y <= 1)
  assert.equal(page.data.placedFixtureCount, 1)

  const restored = makePage()
  assert.deepEqual(restored._layout.positionsById[fixture.stableId], ground, 'saved ground coordinates survive page reload')
  assert.equal(restored.data.placementGroups.flatMap(group => group.fixtures).find(item => item.id === fixture.stableId).checked, true)
  const addressWxml = fs.readFileSync(path.resolve(__dirname, '../../pages/dmx-layout/dmx-layout.wxml'), 'utf8')
  assert(!addressWxml.includes('bindtap="openPlacementPanel"')
    && addressWxml.includes('class="canvas-tap-tip">点击舞台或灯杆进行操作</view>')
    && !addressWxml.includes('class="placement-target-row"')
    && addressWxml.includes('class="placement-preview-top"'),
  'the placement panel uses canvas entry without a target picker and keeps ground available without rods')
})

test('overlapping ground lamp wins canvas hit testing; rod lamp stays selectable in the panel', () => {
  reset(2)
  const page = makePage(), [rodFixture, groundFixture] = page._fixtures
  const rod = page._layout.internalRods[0]
  const geometry = page.getGeometry()
  const rodPosition = { rodId: rod.id, t: .5 }
  const point = require('../../pages/dmx-layout/layout-model').layoutFixturePoint(geometry, geometry.rods.find(item => item.id === rod.id), rodPosition)
  const groundPosition = {
    kind: 'ground',
    x: (point.x - geometry.stage.left) / geometry.stage.width,
    y: (point.y - geometry.stage.top) / geometry.stage.height,
  }
  page._layout.positionsById = {
    [rodFixture.stableId]: rodPosition,
    [groundFixture.stableId]: groundPosition,
  }
  assert.equal(page.saveLayoutOnly(page._layout), true)
  page._view = { s: 1, x: 0, y: 0 }
  assert.equal(page.findFixtureAt(point).stableId, groundFixture.stableId,
    'ground lamps render after rod lamps and receive equal-position taps')

  const separatedGroundPosition = {
    kind: 'ground',
    x: (point.x + 52 - geometry.stage.left) / geometry.stage.width,
    y: groundPosition.y,
  }
  page._layout.positionsById[groundFixture.stableId] = separatedGroundPosition
  assert.equal(page.saveLayoutOnly(page._layout), true)
  const nearRodPoint = { x: point.x + 20, y: point.y }
  assert.equal(page.findFixtureAt(nearRodPoint).stableId, rodFixture.stableId,
    'the nearest visible fixture wins when separate markers fall within the broad touch radius')

  page.openPlacementPanel()
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: rodFixture.stableId } } })
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: rodFixture.stableId } } })
  assert.equal(page.data.selectedFixtureId, rodFixture.stableId, 'the underlying rod lamp remains selectable from the list')
  assert.equal(page._layout.positionsById[rodFixture.stableId].rodId, rod.id, 'a double tap does not move it')

  page._layout = clone(page._layout)
  page._dragOriginalLayout = clone(page._layout)
  page._touchState = { fixtureId: groundFixture.stableId, dragging: true }
  const nearbyRodPoint = { x: point.x + 2, y: point.y + 2 }
  page.updateFixtureDragPreview(nearbyRodPoint)
  const dragged = page._layout.positionsById[groundFixture.stableId]
  assert.equal(dragged.kind, 'ground', 'dragging near a rod does not silently transfer to that rod')
  assert.equal(dragged.rodId, undefined)
  assert.notDeepEqual(dragged, groundPosition, 'ground fixtures remain freely movable near rods')
  page._touchState = null
  page._dragOriginalLayout = null
})

test('address sort spaces one selected rod in horizontal and vertical screen order, with undo', () => {
  for (const direction of ['bottom', 'left']) {
    reset(5)
    const page = makePage()
    const layout = clone(page._layout)
    layout.apronDirection = direction
    const rodId = layout.internalRods[0].id
    const otherRodId = layout.internalRods[1].id
    const [first, second, third, other, ground] = page._fixtures
    layout.positionsById = {
      [first.stableId]: { rodId, t: .86 },
      [second.stableId]: { rodId, t: .50 },
      [third.stableId]: { rodId, t: .14 },
      [other.stableId]: { rodId: otherRodId, t: .33 },
      [ground.stableId]: { kind: 'ground', x: .42, y: .62 },
    }
    page._layout = layout
    assert.equal(page.saveLayoutOnly(layout), true)
    const beforeOther = clone(layout.positionsById[other.stableId])
    const beforeGround = clone(layout.positionsById[ground.stableId])
    page.openPlacementPanel()
    page.onSelectRod({ currentTarget: { dataset: { rodId } } })
    page.sortSelectedRodByAddress()
    modals.shift().success({ confirm: true })
    const sorted = [first, second, third].map(fixture => page._layout.positionsById[fixture.stableId])
    assert(sorted[0].t < sorted[1].t && sorted[1].t < sorted[2].t)
    const geometry = page.getGeometry()
    const actualRod = geometry.rods.find(item => item.id === rodId)
    const axis = Math.abs(actualRod.x2 - actualRod.x1) >= Math.abs(actualRod.y2 - actualRod.y1) ? 'x' : 'y'
    const coordinates = [first, second, third].map(fixture => {
      const position = page._layout.positionsById[fixture.stableId]
      return require('../../pages/dmx-layout/layout-model').layoutFixturePoint(geometry, actualRod, position)[axis]
    })
    assert(coordinates[0] < coordinates[1] && coordinates[1] < coordinates[2],
      direction === 'left' ? 'vertical rods sort top-to-bottom' : 'horizontal rods sort left-to-right')
    assert(Math.abs((sorted[1].t - sorted[0].t) - (sorted[2].t - sorted[1].t)) < .001, 'selected-rod spacing is even')
    assert.deepEqual(page._layout.positionsById[other.stableId], beforeOther, 'other rods remain unchanged')
    assert.deepEqual(page._layout.positionsById[ground.stableId], beforeGround, 'ground positions remain unchanged')
    page.undoLayoutArrangement()
    assert.deepEqual(page._layout.positionsById, layout.positionsById, 'sort can be undone')
  }
})

test('uniform settings count rod lamps only, excluding ground lamps', () => {
  reset(3)
  const page = makePage(), [rodFixture, groundA, groundB] = page._fixtures
  const layout = clone(page._layout)
  const rodId = layout.internalRods[0].id
  layout.positionsById = {
    [rodFixture.stableId]: { rodId, t: .5 },
    [groundA.stableId]: { kind: 'ground', x: .3, y: .4 },
    [groundB.stableId]: { kind: 'ground', x: .7, y: .6 },
  }
  page._layout = layout
  assert.equal(page.saveLayoutOnly(layout), true)
  page.openLayoutSettings()
  page.onDraftArrangementTap({ currentTarget: { dataset: { mode: 'uniform' } } })
  page.applyLayoutSettings()
  assert.equal(modals.length, 1)
  assert(modals[0].content.includes('将重新排列 1 台已上杆灯具'), 'ground fixtures are excluded from the rod arrangement count')
  modals.shift().success({ confirm: false })
})

test('address and layout marks sync both ways; ground export is classified and delete undo restores its position', () => {
  runtime?.dispose()
  runtime = createRuntime()
  const product = stageLightingProductIndex.get('TL-SL323')
  const group = (targetUniverse) => ({
    name: product.name,
    fixtureSource: 'library',
    fixtureModel: product.model,
    channelCount: '2',
    libraryChannelCount: '2',
    fixtureCount: '1',
    targetUniverse,
  })
  runtime.seed([group('A'), group('B')])
  storage = runtime.storage
  modals = runtime.modals
  const page = makePage()
  const fixture = page._fixtures[0]
  page.openPlacementPanel('ground')
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  assert.equal(page.data.selectedFixtureChecked, true)
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  page.settlePendingFixtureTap()
  const groundPosition = clone(page._layout.positionsById[fixture.stableId])
  assert.equal(groundPosition.kind, 'ground')

  const renderer = require('../../pages/dmx-layout/layout-renderer')
  const snapshot = page.buildExportSnapshot()
  const exportPages = renderer.buildLightingExportPages(snapshot)
  const groundSection = exportPages.flatMap(item => item.addressLayout.sections).find(section => section.label === '舞台地面灯')
  assert(groundSection && groundSection.addresses.includes(fixture.addressText), 'ground lamps appear in a classified address-list section')
  page.generateLayoutImage()
  runtime.drain(runtime.frames)
  assert.equal(runtime.stats.drawCalls.filter(call => call.canvas === 'export' && call.method === 'fillText' && call.args[0] === '✓').length, 0,
    'exported diagram omits setup check markers')

  const addressPage = runtime.make('main')
  const chip = addressPage.data.groupCards.flatMap(item => item.fixtureChips).find(item => item.stableId === fixture.stableId)
  assert.equal(chip.checked, true, 'address overview receives layout setup marks')
  addressPage.toggleFixtureCheck({ currentTarget: { dataset: { stableId: fixture.stableId, globalIndex: 0 } } })
  page.onShow()
  assert.equal(page.data.selectedFixtureChecked, false, 'layout receives address-page mark removal on return')
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  addressPage.onShow()
  assert.equal(addressPage.data.groupCards.flatMap(item => item.fixtureChips).find(item => item.stableId === fixture.stableId).checked, true,
    'address page receives layout-page mark restoration')

  addressPage.requestDeleteGroup({ currentTarget: { dataset: { index: 0 } } })
  addressPage.confirmPendingChange()
  assert.equal(addressPage.data.undoDeleteAvailable, true)
  addressPage.undoDelete()
  const restored = workspace.readLightingWorkspace(addressPage._contextId)
  assert.deepEqual(restored.scheme.layout.positionsById[fixture.stableId], groundPosition,
    'undo restores the ground position with the deleted fixture group')
  assert.ok(restored.scheme.checksById[fixture.stableId], 'undo retains the stable-ID setup marker')
})

test('stale portrait cannot overwrite newer landscape layout', () => {
  reset(4)
  const portrait = makePage()
  assert.equal(portrait.saveLayoutOnly(clone(portrait._layout)), true)
  const landscape = makePage('landscape'), moved = landscape._fixtures[2]
  landscape.assignFixtureToRod(moved, landscape._layout.frontRods[0].id)
  const newer = clone(workspace.readLightingWorkspace().scheme.layout), stale = clone(portrait._layout)
  stale.positionsById[portrait._fixtures[3].stableId] = { rodId: stale.internalRods[0].id, t: .25 }
  assert.equal(portrait.saveLayoutOnly(stale), false, 'stale layout must conflict, rather than replacing fresh data')
  assert.deepEqual(workspace.readLightingWorkspace().scheme.layout, newer)
})

test('returning clean portrait reloads saved landscape changes', () => {
  reset(4)
  const portrait = makePage()
  portrait.saveLayoutOnly(clone(portrait._layout))
  const landscape = makePage('landscape'), fixture = landscape._fixtures[2]
  landscape.assignFixtureToRod(fixture, landscape._layout.frontRods[0].id)
  portrait.onShow()
  assert.equal(portrait._layout.positionsById[fixture.stableId]?.rodId, landscape._layout.frontRods[0].id)
})

test('merging latest preferences refreshes exported addresses', () => {
  reset(2, 'TL-SK3101', 2)
  const page = makePage()
  page.saveLayoutOnly(clone(page._layout))
  const latest = workspace.readLightingWorkspace(), next = clone(latest.scheme)
  next.preferences.groups[0].channelCount = '5'
  next.preferences.groups[0].libraryChannelCount = '5'
  assert.equal(workspace.saveLightingScheme(latest.contextId, next, latest.revision).ok, true)
  assert.equal(page.saveLayoutOnly(clone(page._layout)), true)
  const snapshot = page.buildExportSnapshot(), correct = workspace.calculateScheme(workspace.readLightingWorkspace().scheme).result
  assert.deepEqual(snapshot.fixtures.map(fixture => fixture.addressText), correct.fixtures.map(fixture => fixture.addressText))
})

test('unload cancels pending native export callback', () => {
  reset(2)
  const page = makePage()
  runtime.state.deferSelectors = true
  page.generateLayoutImage()
  assert.equal(runtime.selectors.length, 1, 'export should wait for a real native canvas selector result')
  page.onUnload()
  runtime.drain(runtime.selectors)
  assert.equal(runtime.exports.length, 0, 'unloaded export must not call native canvas conversion')
})

test('canvas selector resolves an actual source element in both orientations', () => {
  for (const relative of ['pages/dmx-layout/dmx-layout.wxml']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8')
    assert(/id=["']dmxLayoutCanvasShell["']/.test(source), 'Missing touch-coordinate anchor in ' + relative)
  }
})

runtime?.dispose()
const summary = { passed: results.every(result => result.passed), results }
const evidencePath = process.env.DMX_LAYOUT_TEST_EVIDENCE_PATH || path.join(__dirname, 'evidence/layout-interactions.json')
fs.mkdirSync(path.dirname(evidencePath), { recursive: true })
fs.writeFileSync(evidencePath, JSON.stringify(summary, null, 2))
if (!summary.passed) process.exitCode = 1

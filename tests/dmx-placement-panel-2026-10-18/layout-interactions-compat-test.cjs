// Exercise actual page controllers against the real workspace helper.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone, stageLightingProductIndex } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')
const workspace = require('../../pages/dmx-layout/lighting-workspace')
const { createDmxLayoutPage } = require('../../pages/dmx-layout/page-factory')
const PREF = 'audioTool.dmxAddress.preferences'
const PROGRESS = 'audioTool.dmxAddress.progress'
let runtime
let storage
let modals

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
  const preferences = storage.get(PREF)
  storage.set(PROGRESS, { calculationSignature: JSON.stringify(preferences), keys: ['0:1:A001'] })
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

test('thirty immediate placements have distinct positions; unplacing preserves checks', () => {
  reset()
  const page = makePage(), first = page._fixtures[0].stableId, checks = clone(page._scheme.checksById)
  const rod = page._layout.internalRods[0].id
  page.openPlacementPanel()
  page.onSelectRod({ currentTarget: { dataset: { rodId: rod } } })
  for (const fixture of page._fixtures) page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  const placed = Object.values(page._layout.positionsById)
  assert.equal(placed.length, 30)
  assert.equal(new Set(placed.map(position => position.t)).size, 30)
  assert(placed.every(position => position.rodId === rod && position.t >= 0 && position.t <= 1))
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: first } } })
  assert.equal(Object.keys(page._layout.positionsById).length, 29)
  assert.deepEqual(workspace.readLightingWorkspace().scheme.checksById, checks)
})

test('cross-rod movement confirms; cancel is inert and confirm never duplicates', () => {
  reset(2)
  const page = makePage(), fixture = page._fixtures[0], before = fixture.addressText
  const a = page._layout.internalRods[0].id, b = page._layout.frontRods[0].id
  page.assignFixtureToRod(fixture, a)
  page.openPlacementPanel()
  page.onSelectRod({ currentTarget: { dataset: { rodId: b } } })
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  assert.equal(modals.length, 1)
  modals.shift().success({ confirm: false })
  assert.equal(page._layout.positionsById[fixture.stableId].rodId, a)
  page.onPanelFixtureTap({ currentTarget: { dataset: { fixtureId: fixture.stableId } } })
  modals.shift().success({ confirm: true })
  assert.equal(page._layout.positionsById[fixture.stableId].rodId, b)
  assert.equal(Object.keys(page._layout.positionsById).length, 1)
  assert.equal(page._fixtures[0].addressText, before)
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
  for (const relative of ['pages/dmx-layout/dmx-layout.wxml', 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8')
    assert(/id=["']dmxLayoutCanvasShell["']/.test(source), 'Missing touch-coordinate anchor in ' + relative)
  }
})

runtime?.dispose()
const summary = { passed: results.every(result => result.passed), results }
fs.mkdirSync(path.join(__dirname, 'evidence'), { recursive: true })
fs.writeFileSync(path.join(__dirname, 'evidence/layout-interactions.json'), JSON.stringify(summary, null, 2))
if (!summary.passed) process.exitCode = 1

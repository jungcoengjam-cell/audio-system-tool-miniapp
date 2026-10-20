const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')
const { LAYOUT_GROUP_COLORS } = require('../../pages/dmx-layout/page-factory')
const layoutModel = require('../../pages/dmx-layout/layout-model')
const renderer = require('../../pages/dmx-layout/layout-renderer')

const root = path.resolve(__dirname, '../..')
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function makePlacedPage() {
  const runtime = createRuntime()
  runtime.seed()
  const page = runtime.make('portrait')
  const fixture = page._fixtures[0]
  runtime.place(page, 0, 0)
  runtime.stats.writes = 0
  page._view = { s: 1.35, x: -24, y: 18 }
  return { runtime, page, fixture, original: clone(page._layout.positionsById[fixture.stableId]) }
}

function touchForWorldPoint(page, point) {
  const screen = layoutModel.transformViewPoint(point, page._view)
  return {
    clientX: page._canvasRect.left + screen.x,
    clientY: page._canvasRect.top + screen.y,
  }
}

function pointOnTarget(page, rodId, t) {
  const rod = page.getGeometry().rods.find((item) => String(item.id) === String(rodId))
  assert(rod, 'test target rod should exist')
  return touchForWorldPoint(page, layoutModel.pointOnRod(rod, t))
}

function fixtureTouch(page, fixture) {
  const position = page._layout.positionsById[fixture.stableId]
  const geometry = page.getGeometry()
  const rod = geometry.rods.find((item) => String(item.id) === String(position.rodId))
  return touchForWorldPoint(page, layoutModel.layoutFixturePoint(geometry, rod, position))
}

async function startDrag(page, fixture) {
  const touch = fixtureTouch(page, fixture)
  page.onCanvasTouchStart({ touches: [touch] })
  await wait(410)
  assert.equal(page._touchState?.dragging, true, 'long press should begin lamp manipulation')
  return touch
}

function makeCanvasContext() {
  const state = { fillStyle: '#000', fontSize: 12, align: 'left', texts: [] }
  const context = {
    state,
    setFillStyle(value) { state.fillStyle = value },
    setStrokeStyle() {},
    setLineWidth() {},
    setFontSize(value) { state.fontSize = Number(value) },
    setTextAlign(value) { state.align = value },
    setLineDash() {},
    measureText(value) { return { width: Array.from(String(value)).length * state.fontSize * .58 } },
    fillText(value, x, y) { state.texts.push({ value: String(value), color: state.fillStyle, x, y }) },
  }
  return new Proxy(context, { get(target, key) { return key in target ? target[key] : () => {} } })
}

async function testDragAcrossOrientations() {
  for (const direction of layoutModel.APRON_DIRECTIONS) {
    const { runtime, page, fixture, original } = makePlacedPage()
    let saveCalls = 0
    const saveLayoutOnly = page.saveLayoutOnly.bind(page)
    page.saveLayoutOnly = (layout) => { saveCalls += 1; return saveLayoutOnly(layout) }
    page._layout.apronDirection = direction
    page._geometry = null
    page._geometryKey = ''
    const movedTarget = pointOnTarget(page, page._layout.internalRods[1].id, .61)
    const finalTarget = pointOnTarget(page, page._layout.frontRods[0].id, .73)
    await startDrag(page, fixture)
    page.onCanvasTouchMove({ touches: [movedTarget] })
    assert.equal(runtime.stats.writes, 0, `${direction}: drag preview must not persist`)
    assert.equal(page._layout.positionsById[fixture.stableId].rodId, page._layout.internalRods[1].id,
      `${direction}: preview should follow the latest eligible internal rod`)
    page.onCanvasTouchEnd({ touches: [], changedTouches: [finalTarget] })
    assert.equal(saveCalls, 1, `${direction}: release should perform one layout save`)
    assert(runtime.stats.writes > 0, `${direction}: valid release should commit the layout`)
    const savedPosition = page._layout.positionsById[fixture.stableId]
    assert.equal(savedPosition.rodId, page._layout.frontRods[0].id,
      `${direction}: final release point must override the preceding move candidate; target=${page._layout.frontRods[0].id}, actual=${savedPosition.rodId}, rods=${JSON.stringify(page.getGeometry().rods.map((rod) => ({ id: rod.id, type: rod.type, y: rod.y1 })))} `)
    assert(Math.abs(savedPosition.t - .73) < .002, `${direction}: release should project onto the target rod`)
    assert.equal(page._fixtures[0].addressText, fixture.addressText, `${direction}: DMX address should remain unchanged`)
    assert.deepEqual(page._scheme.checksById, runtime.workspace.readLightingWorkspace().scheme.checksById,
      `${direction}: field-check state should remain intact`)
    runtime.dispose()
  }
}

async function testSameRodAndInvalidRelease() {
  {
    const { runtime, page, fixture, original } = makePlacedPage()
    let saveCalls = 0
    const saveLayoutOnly = page.saveLayoutOnly.bind(page)
    page.saveLayoutOnly = (layout) => { saveCalls += 1; return saveLayoutOnly(layout) }
    const sameRodTarget = pointOnTarget(page, original.rodId, .76)
    await startDrag(page, fixture)
    page.onCanvasTouchMove({ touches: [sameRodTarget] })
    page.onCanvasTouchEnd({ touches: [], changedTouches: [sameRodTarget] })
    assert.equal(saveCalls, 1, 'same-rod adjustment should save once')
    assert(runtime.stats.writes > 0, 'same-rod adjustment should commit its position')
    assert(Math.abs(page._layout.positionsById[fixture.stableId].t - .76) < .002)
    runtime.dispose()
  }
  {
    const { runtime, page, fixture, original } = makePlacedPage()
    const validMove = pointOnTarget(page, page._layout.internalRods[1].id, .5)
    const outside = { clientX: page._canvasRect.left + 2, clientY: page._canvasRect.top + 2 }
    await startDrag(page, fixture)
    page.onCanvasTouchMove({ touches: [validMove] })
    page.onCanvasTouchEnd({ touches: [], changedTouches: [outside] })
    assert.equal(runtime.stats.writes, 0, 'invalid final release must not persist the last valid preview')
    assert.deepEqual(page._layout.positionsById[fixture.stableId], original, 'invalid release restores the original position')
    runtime.dispose()
  }
}

async function testInterruptedDragDoesNotPersist() {
  const interruptions = ['cancel', 'pinch', 'hide', 'resize']
  for (const interruption of interruptions) {
    const { runtime, page, fixture, original } = makePlacedPage()
    const otherRod = pointOnTarget(page, page._layout.internalRods[1].id, .58)
    await startDrag(page, fixture)
    page.onCanvasTouchMove({ touches: [otherRod] })
    if (interruption === 'cancel') page.onCanvasTouchCancel({})
    if (interruption === 'pinch') page.onCanvasTouchStart({ touches: [otherRod, { clientX: otherRod.clientX + 90, clientY: otherRod.clientY + 30 }] })
    if (interruption === 'hide') page.onHide()
    if (interruption === 'resize') page.onResize({ size: { windowWidth: 844, windowHeight: 390 } })
    assert.equal(runtime.stats.writes, 0, `${interruption}: interrupted gesture must not persist`)
    assert.deepEqual(page._layout.positionsById[fixture.stableId], original, `${interruption}: interrupted gesture restores the start position`)
    runtime.dispose()
  }
}

async function testLegacySideRodDrop() {
  const { runtime, page, fixture, original } = makePlacedPage()
  page._layout.legacySideRods = [{ id: 'legacy-left-1', side: 'left', distance: .6, startT: .05, endT: .95, positionIndex: 0 }]
  page._geometry = null
  page._geometryKey = ''
  const sideTarget = pointOnTarget(page, 'legacy-left-1', .68)
  let saves = 0
  page.saveLayoutOnly = (next) => { saves += 1; page._layout = clone(next); return true }
  await startDrag(page, fixture)
  page.onCanvasTouchMove({ touches: [sideTarget] })
  assert.equal(page._layout.positionsById[fixture.stableId].rodId, 'legacy-left-1', 'legacy side rod should accept a drag candidate')
  page.onCanvasTouchEnd({ touches: [], changedTouches: [sideTarget] })
  assert.equal(saves, 1, 'legacy side rod release should save once')
  assert.equal(page._layout.positionsById[fixture.stableId].rodId, 'legacy-left-1')
  assert.equal(page._fixtures[0].stableId, fixture.stableId)
  assert.notDeepEqual(page._layout.positionsById[fixture.stableId], original)
  runtime.dispose()
}

function testGroupColorOnScreenAndExport() {
  const layout = {
    stageWidthText: '12', stageDepthText: '8', apronDirection: 'bottom',
    internalRods: [{ id: 'inner-1', distance: 4 }], frontRods: [{ id: 'front-1', distance: 2 }],
    positionsById: { 'fixture-1': { rodId: 'inner-1', t: .5 } },
  }
  const fixture = { id: 'fixture-1', stableId: 'fixture-1', addressText: 'A001', groupIndex: 2, fixtureModel: 'TL-SL323' }
  const geometry = layoutModel.createStageGeometry(layout, 700, 900)
  const color = LAYOUT_GROUP_COLORS[2]
  const screen = makeCanvasContext()
  renderer.renderStageDiagram(screen, {
    layout, fixtures: [fixture], geometry, theme: renderer.getCanvasTheme('dark'),
    selectedFixtureId: fixture.stableId,
  }, { view: { s: 1, x: 0, y: 0 }, backgroundWidth: 700, backgroundHeight: 900 })
  assert(screen.state.texts.some((item) => item.value === 'A001' && item.color === color),
    'selected screen address should retain its group color')

  const exportSnapshot = { layout, fixtures: [fixture], contextLabel: 'Round three', geometry }
  const exportPage = renderer.buildLightingExportPages(exportSnapshot, { width: 1120, height: 1160 })[0]
  const exported = makeCanvasContext()
  renderer.renderLightingExportPage(exported, exportSnapshot, exportPage)
  assert(exported.state.texts.some((item) => item.value === 'A001' && item.color === color),
    'export address should use the same group color as the fixture marker')
}

function testLandscapeStatusAndUiContract() {
  const runtime = createRuntime()
  runtime.seed()
  const page = runtime.make('landscape')
  global.wx.getWindowInfo = () => ({ windowWidth: 844, windowHeight: 390, statusBarHeight: 44, safeArea: { top: 44, bottom: 390 }, pixelRatio: 2 })
  global.wx.getMenuButtonBoundingClientRect = () => ({ left: 747, right: 834, top: 8, bottom: 40, width: 87, height: 32 })
  page.onResize({ size: { windowWidth: 844, windowHeight: 390 } })
  assert.equal(page.data.statusBarHeight, 8, 'valid landscape capsule should override a stale portrait status bar')
  assert.equal(page.data.navigationHeight, 52, 'landscape navigation should follow the capsule geometry')

  for (const relative of ['pages/dmx-layout/dmx-layout.wxml', 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    assert(!/定位灯具|class="locate-overlay|class="locate-card/.test(source), `${relative}: locator entry and panel should be absent`)
    assert(/class="context-row"[\s\S]*?class="context-native-picker"[\s\S]*?class="context-share/.test(source),
      `${relative}: share must be a sibling to the context picker`)
    assert(/layout-orientation-button[\s\S]*?layout-orientation-device[\s\S]*?layout-orientation-arrow/.test(source),
      `${relative}: orientation control should use isolated view glyphs`)
    assert(/class="layout-undo-action"/.test(source), `${relative}: undo control should use its local hit target style`)
  }
  runtime.dispose()
}

function testLandscapeDisplayFit() {
  const runtime = createRuntime()
  runtime.seed()
  const page = runtime.make('landscape')
  page._canvasRect = { left: 0, top: 0, width: 568, height: 189 }
  page.data.canvasWidth = 568
  page.data.canvasHeight = 189
  page._geometry = null
  page._geometryKey = ''
  page._viewAutoFit = true
  const geometry = page.getGeometry()
  const unchangedGeometry = layoutModel.createStageGeometry(page._layout, 568, 189)
  assert.deepEqual(geometry.stage, unchangedGeometry.stage, 'landscape fit must not alter model geometry')
  assert(page._view.s >= 1.12, `short landscape should use the available canvas area; scale=${page._view.s}`)
  const points = [
    { x: geometry.stage.left, y: geometry.stage.top },
    { x: geometry.stage.left + geometry.stage.width, y: geometry.stage.top + geometry.stage.height },
    { x: geometry.audience.x, y: geometry.audience.y },
    ...geometry.rods.flatMap((rod) => [{ x: rod.x1, y: rod.y1 }, { x: rod.x2, y: rod.y2 }]),
  ].map((point) => layoutModel.transformViewPoint(point, page._view))
  for (const point of points) {
    assert(point.x >= -1 && point.x <= 569, `fitted scene x remains visible: ${JSON.stringify(point)}`)
    assert(point.y >= -1 && point.y <= 190, `fitted scene y remains visible: ${JSON.stringify(point)}`)
  }
  const context = makeCanvasContext()
  renderer.renderStageDiagram(context, {
    layout: page._layout,
    fixtures: page._fixtures,
    geometry,
    theme: renderer.getCanvasTheme('light'),
  }, { view: page._view, backgroundWidth: 568, backgroundHeight: 189 })
  for (const label of ['12 m', '8 m', '灯杆1', '灯杆2', '面光杆1', '台口', '观众区']) {
    assert(context.state.texts.some((item) => item.value === label), `fitted landscape keeps ${label}`)
  }
  runtime.dispose()
}

async function main() {
  await testDragAcrossOrientations()
  await testSameRodAndInvalidRelease()
  await testInterruptedDragDoesNotPersist()
  await testLegacySideRodDrop()
  testGroupColorOnScreenAndExport()
  testLandscapeStatusAndUiContract()
  testLandscapeDisplayFit()
  console.log('Layout round-three controller, renderer, and markup regressions passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})

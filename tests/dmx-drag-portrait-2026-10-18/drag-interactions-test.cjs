const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const root = path.resolve(__dirname, '../..')
const model = require('../../pages/dmx-layout/layout-model')
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function makePlacedPage() {
  const runtime = createRuntime()
  runtime.seed()
  const page = runtime.make('portrait')
  const fixture = page._fixtures[0]
  runtime.place(page, 0, 0)
  runtime.stats.writes = 0
  const original = clone(page._layout.positionsById[fixture.stableId])
  const checks = clone(page._scheme.checksById)
  const fixtures = clone(page._fixtures)
  return { runtime, page, fixture, original, checks, fixtures }
}

function screenPoint(page, point) {
  const transformed = model.transformViewPoint(point, page._view)
  return {
    clientX: page._canvasRect.left + transformed.x,
    clientY: page._canvasRect.top + transformed.y,
  }
}

function rodTouch(page, rodId, t) {
  const rod = page.getGeometry().rods.find((item) => String(item.id) === String(rodId))
  assert(rod, 'expected target rod')
  return screenPoint(page, model.pointOnRod(rod, t))
}

function fixtureTouch(page, fixture) {
  const position = page._layout.positionsById[fixture.stableId]
  const geometry = page.getGeometry()
  const rod = geometry.rods.find((item) => String(item.id) === String(position.rodId))
  assert(rod, 'expected placed fixture rod')
  return screenPoint(page, model.layoutFixturePoint(geometry, rod, position))
}

async function testImmediateCrossRodDrag() {
  const { runtime, page, fixture, original, checks, fixtures } = makePlacedPage()
  const originalView = clone(page._view)
  const target = rodTouch(page, page._layout.internalRods[1].id, .64)
  let saves = 0
  const saveLayoutOnly = page.saveLayoutOnly.bind(page)
  page.saveLayoutOnly = (layout) => { saves += 1; return saveLayoutOnly(layout) }

  page.onCanvasTouchStart({ touches: [fixtureTouch(page, fixture)] })
  page.onCanvasTouchMove({ touches: [target] })

  assert.equal(page._touchState.dragging, true, 'movement past 8px starts drag without waiting for long press')
  assert.equal(page._layout.positionsById[fixture.stableId].rodId, page._layout.internalRods[1].id,
    'the first movement event previews the target rod')
  assert.deepEqual(page._dragOriginalLayout.positionsById[fixture.stableId], original,
    'the drag captures the original layout exactly once before preview')
  assert.equal(runtime.stats.writes, 0, 'drag preview is not persisted')
  assert.deepEqual(page._view, originalView, 'dragging does not pan the canvas')

  page.onCanvasTouchEnd({ touches: [], changedTouches: [target] })
  assert.equal(saves, 1, 'a successful drag release saves once')
  assert.notDeepEqual(page._layout.positionsById[fixture.stableId], original)
  assert.equal(page._layout.positionsById[fixture.stableId].rodId, page._layout.internalRods[1].id)
  assert.deepEqual(page._scheme.checksById, checks, 'dragging preserves fixture checks')
  assert.deepEqual(page._fixtures, fixtures, 'dragging preserves calculated fixture identity and address data')
  runtime.dispose()
}

function testSmallMovementRemainsTap() {
  const { runtime, page, fixture } = makePlacedPage()
  const touch = fixtureTouch(page, fixture)
  page.onCanvasTouchStart({ touches: [touch] })
  page.onCanvasTouchMove({ touches: [{ clientX: touch.clientX + 4, clientY: touch.clientY + 2 }] })
  assert.equal(page._touchState.moved, false, 'sub-threshold movement remains a tap')
  page.onCanvasTouchEnd({ touches: [], changedTouches: [touch] })
  assert.equal(page.data.placementVisible, true, 'tap still opens the placement panel')
  assert.equal(runtime.stats.writes, 0, 'tap does not write the layout')
  runtime.dispose()
}

async function testLongPressStillStartsDrag() {
  const { runtime, page, fixture } = makePlacedPage()
  const touch = fixtureTouch(page, fixture)
  page.onCanvasTouchStart({ touches: [touch] })
  await wait(410)
  assert.equal(page._touchState.dragging, true, 'the existing long-press path still starts drag')
  page.onCanvasTouchCancel({})
  assert.equal(runtime.stats.writes, 0, 'canceling long press does not persist')
  runtime.dispose()
}

function testSecondFingerDuringMoveRollsBack() {
  const { runtime, page, fixture, original } = makePlacedPage()
  const target = rodTouch(page, page._layout.internalRods[1].id, .61)
  page.onCanvasTouchStart({ touches: [fixtureTouch(page, fixture)] })
  page.onCanvasTouchMove({ touches: [target] })
  assert.equal(page._touchState.dragging, true)
  assert.notDeepEqual(page._layout.positionsById[fixture.stableId], original, 'drag preview should be active before pinch')

  page.onCanvasTouchMove({ touches: [target, { clientX: target.clientX + 90, clientY: target.clientY + 30 }] })
  assert.equal(page._touchState, null, 'pinch takes over the interrupted one-finger gesture')
  assert.deepEqual(page._layout.positionsById[fixture.stableId], original, 'second finger rolls the preview back')
  page.onCanvasTouchMove({ touches: [target, { clientX: target.clientX + 120, clientY: target.clientY + 60 }] })
  page.onCanvasTouchEnd({ touches: [], changedTouches: [target] })
  assert.deepEqual(page._layout.positionsById[fixture.stableId], original, 'pinch completion keeps the original position')
  assert.equal(runtime.stats.writes, 0, 'a pinch that joins a drag does not write')
  runtime.dispose()
}

function testLandscapeRouteRetired() {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const portrait = JSON.parse(fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.json'), 'utf8'))
  assert(!app.pages.includes('pages/dmx-layout-landscape/dmx-layout-landscape'), 'landscape page is no longer registered')
  assert.equal(portrait.pageOrientation, 'portrait', 'layout route is explicitly portrait')
  const factory = fs.readFileSync(path.join(root, 'pages/dmx-layout/page-factory.js'), 'utf8')
  assert(!factory.includes('openLandscapeLayout'), 'factory exposes no route to the retired page')
  for (const page of ['pages/dmx-layout/dmx-layout', 'pages/dmx-layout-landscape/dmx-layout-landscape']) {
    const markup = fs.readFileSync(path.join(root, page + '.wxml'), 'utf8')
    const styles = fs.readFileSync(path.join(root, page + '.wxss'), 'utf8')
    assert(!markup.includes('layout-orientation-button'), `${page} has no orientation control`)
    assert(!styles.includes('layout-orientation-'), `${page} has no orientation-control styles`)
  }
}

async function main() {
  await testImmediateCrossRodDrag()
  testSmallMovementRemainsTap()
  await testLongPressStillStartsDrag()
  testSecondFingerDuringMoveRollsBack()
  testLandscapeRouteRetired()
  console.log('Direct drag and portrait-only regressions passed')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})

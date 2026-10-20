const assert = require('node:assert/strict')
const { calculateDmxAddressPlan } = require('../../utils/dmx-address')
const {
  balancedBars,
  posDefs,
  posKey,
  posPoint,
  stageRect,
  createDefaultStageLayout,
  createStageGeometry,
  layoutFixturePoint,
} = require('../../pages/dmx-layout/layout-model')
const { migrateLegacyLayout } = require('../../pages/dmx-layout/layout-storage')

const groups = [
  { id: 'group-a', stableId: 'group-a', name: '摇头灯', channelCount: 8, fixtureCount: 8 },
  { id: 'group-b', stableId: 'group-b', name: '染色灯', channelCount: 4, fixtureCount: 6 },
]

function makeInputs(schemeId, frontIndex, preserveUnplaced) {
  const result = calculateDmxAddressPlan({ startAddress: 1, allocationMode: 'auto', groups })
  assert.ok(!result.error)
  const fixtures = result.fixtures.map((fixture) => ({
    ...fixture,
    stableId: 'fixture-' + fixture.groupIndex + '-' + fixture.fixtureIndex,
  }))
  const rows = 3
  const pairs = 2
  const definitions = posDefs(rows, schemeId, pairs)
  const positions = {}
  const firstTop = definitions.find((definition) => definition.zone === 'top')
  const front = definitions.find((definition) => definition.zone === 'front')
  const left = definitions.find((definition) => definition.zone === 'side-left')
  if (firstTop) positions[posKey(fixtures[0])] = { zone: 'top', positionIndex: firstTop.positionIndex, x: .31, y: .29 }
  if (front) positions[posKey(fixtures[1])] = { zone: 'front', positionIndex: front.positionIndex, x: .69, y: .78 }
  if (left) positions[posKey(fixtures[2])] = { zone: 'side-left', positionIndex: left.positionIndex, x: .22, y: .63 }
  const saved = {
    stageWidthText: '12',
    stageDepthText: '8',
    rowCount: rows,
    frontIndex,
    schemeId,
    sidePairCount: pairs,
    sidePairManual: true,
    addressLabelMode: 'all',
    barCounts: balancedBars(groups, definitions.length),
    preserveUnplaced,
    positions,
    positionSource: 'manual',
    positionAutoFilledCount: 2,
  }
  return { saved, fixtures, definitions }
}

function assertCoordinateCompatibility(saved, fixtures, oldPositions, migrated) {
  const oldStage = stageRect(Number(saved.stageWidthText), Number(saved.stageDepthText), 700, 900)
  const geometry = createStageGeometry(migrated.layout, 700, 900)
  fixtures.forEach((fixture) => {
    const key = posKey(fixture)
    const oldPosition = oldPositions[key]
    const modern = migrated.layout.positionsById[fixture.stableId]
    assert.equal(Boolean(modern), Boolean(oldPosition), 'placed state differs for ' + fixture.stableId)
    if (!oldPosition) return
    assert.deepEqual(modern.legacyPosition, oldPosition, 'legacy rod/side interval changed for ' + fixture.stableId)
    const oldPoint = posPoint(oldPosition, oldStage, saved.frontIndex !== 1)
    const relativeX = (oldPoint.x - oldStage.left) / oldStage.width
    const relativeY = (oldPoint.y - oldStage.top) / oldStage.height
    assert.ok(Math.abs(modern.legacyPoint.x - relativeX) < 1e-10)
    assert.ok(Math.abs(modern.legacyPoint.y - relativeY) < 1e-10)
    const rod = geometry.rods.find((item) => item.id === modern.rodId)
    assert.ok(rod, 'migrated rod missing from drawing geometry')
    const drawn = layoutFixturePoint(geometry, rod, modern)
    assert.ok(Math.abs((drawn.x - geometry.stage.left) / geometry.stage.width - relativeX) < 1e-10)
    assert.ok(Math.abs((drawn.y - geometry.stage.top) / geometry.stage.height - relativeY) < 1e-10)
  })
}

for (const schemeId of ['top', 'top-front', 'full']) {
  for (const frontIndex of [0, 1]) {
    for (const preserveUnplaced of [false, true]) {
      const { saved, fixtures } = makeInputs(schemeId, frontIndex, preserveUnplaced)
      const resolved = require('../../pages/dmx-layout/layout-storage').resolveSavedLayout(saved, fixtures, groups)
      const migrated = migrateLegacyLayout(saved, fixtures, groups)
      const again = migrateLegacyLayout(saved, fixtures, groups)
      assert.equal(migrated.migrated, true)
      assert.deepEqual(migrated, again, 'migration must be deterministic')
      assert.equal(migrated.layout.apronDirection, frontIndex === 0 ? 'bottom' : 'top')
      assert.equal(Object.keys(migrated.layout.positionsById).length, Object.keys(resolved.positions).length)
      assertCoordinateCompatibility(saved, fixtures, resolved.positions, migrated)
      const unplaced = fixtures.length - Object.keys(migrated.layout.positionsById).length
      assert.equal(unplaced, fixtures.length - Object.keys(resolved.positions).length)
      if (schemeId === 'full') {
        const sideDefinitions = resolved.definitions.filter((definition) => definition.zone.startsWith('side-'))
        const sideIds = new Set(sideDefinitions.map((definition) => 'legacy-' + definition.zone + '-' + (definition.positionIndex + 1)))
        assert.ok(migrated.layout.legacySideRods.length > 0, 'full legacy layout dropped its side rods')
        for (const [fixtureId, position] of Object.entries(migrated.layout.positionsById)) {
          if (position.legacyPosition.zone.startsWith('side-')) assert.ok(sideIds.has(position.rodId))
          assert.ok(fixtures.some((fixture) => fixture.stableId === fixtureId))
        }
        assert.equal(migrated.sideFixtureCount, Object.values(resolved.positions).filter((position) => position.zone.startsWith('side-')).length)
      }
      if (migrated.layout.frontRods.length) {
        const stage = stageRect(12, 8, 700, 900)
        assert.ok(Math.abs(migrated.layout.frontRods[0].distance - (42 * 8 / stage.height)) < 1e-10)
      }
      migrated.layout.internalRods.forEach((rod, index) => {
        assert.ok(Math.abs(rod.distance - ((1 - ((index + 1) / (saved.rowCount + 1))) * 8)) < 1e-8)
      })
    }
  }
}

assert.deepEqual(migrateLegacyLayout(null, [], groups), { migrated: false, layout: null, sideFixtureCount: 0 })
assert.deepEqual(migrateLegacyLayout({}, [], groups), { migrated: false, layout: null, sideFixtureCount: 0 })
const newLayout = createDefaultStageLayout('12', '8', (kind, index) => kind + '-' + index)
assert.deepEqual(newLayout.positionsById, {}, 'new schemes must start with fixtures unplaced')
console.log('Lighting layout legacy migration tests passed (12 combinations)')

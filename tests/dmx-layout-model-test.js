const assert = require('assert')
const { calculateDmxAddressPlan } = require('../utils/dmx-address')
const model = require('../pages/dmx-layout/layout-model')
function close(actual, expected) {
assert(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`)
}

function makeCase(rows, schemeId, pairs) {
const groups = [
{ name: '主灯', channelCount: 4, fixtureCount: 7 },
{ name: '染色灯', channelCount: 8, fixtureCount: 5 },
]
const plan = calculateDmxAddressPlan({ startAddress: 1, groups })
assert(!plan.error)
const definitions = model.posDefs(rows, schemeId, pairs)
const automatic = model.posFromBars(plan.fixtures, model.balancedBars(groups, definitions.length), groups, definitions, rows, pairs)
assert.strictEqual(Object.keys(automatic).length, plan.fixtures.length)
const restored = model.restorePositions(plan.fixtures, automatic, rows, definitions, pairs)
assert.strictEqual(Object.keys(restored).length, plan.fixtures.length)
const bars = model.barsFromPositions(plan.fixtures, restored, groups, definitions, rows, pairs)
groups.forEach((group, groupIndex) => {
assert.strictEqual(bars.reduce((sum, row) => sum + row[groupIndex], 0), group.fixtureCount)
})
bars.forEach((row) => assert(row.every((count, index) => count <= Math.ceil(groups[index].fixtureCount / definitions.length))))
return { plan, groups, definitions, automatic, restored }
}

for (let rows = 1; rows <= 6; rows += 1) {
for (const schemeId of ['top', 'top-front', 'full']) {
for (let pairs = 1; pairs <= (schemeId === 'full' ? 3 : 1); pairs += 1) makeCase(rows, schemeId, pairs)
}
}

const groups = [{ name: '一组', fixtureCount: 5 }, { name: '二组', fixtureCount: 4 }]
for (const rows of [1, 2, 3, 5]) {
const counts = model.balancedBars(groups, rows)
groups.forEach((group, index) => {
assert.strictEqual(counts.reduce((sum, row) => sum + row[index], 0), group.fixtureCount)
assert(Math.max(...counts.map((row) => row[index])) - Math.min(...counts.map((row) => row[index])) <= 1)
})
assert.deepStrictEqual(model.normBars([[5, 0]], groups, rows), model.balancedBars(groups, rows))
}

const definitions = model.posDefs(3, 'full', 2)
const stage = model.stageRect(12, 8)
assert.strictEqual(stage.width / stage.height, 12 / 8)
close(stage.left + stage.width / 2, 350)
close(stage.top + stage.height / 2, 410)
const landscapeStage = model.stageRect(12, 8, 1200, 720)
assert.strictEqual(landscapeStage.width / landscapeStage.height, 12 / 8)
close(landscapeStage.left + landscapeStage.width / 2, 600)
close(landscapeStage.top + landscapeStage.height / 2, 325)
assert.deepStrictEqual(model.sideRange(0, 2), { start: 0.04, end: 0.5 })
assert.deepStrictEqual(model.sideRange(1, 2), { start: 0.5, end: 0.96 })
const left = definitions.find((d) => d.zone === 'side-left')
const right = definitions.find((d) => d.zone === 'side-right')
const leftRangeBottom = model.sideCanvasRange(left, stage, true, 2)
const leftRangeTop = model.sideCanvasRange(left, stage, false, 2)
assert(leftRangeBottom.startY < leftRangeBottom.endY)
assert(leftRangeTop.startY < leftRangeTop.endY)
close(leftRangeBottom.startY + leftRangeBottom.endY, stage.top * 2 + (0.54 * stage.height))
close(leftRangeTop.startY + leftRangeTop.endY, stage.top * 2 + (1.46 * stage.height))
assert(model.posPoint({ zone: 'side-right', x: 1, y: 0.5 }, stage, true).x > stage.left + stage.width)
const anchor = model.defAnchor(definitions.find((d) => d.zone === 'top'), stage, true, 3, 2)
const near = model.nearestPlacement(anchor, stage, true, definitions, 3, 2)
assert.strictEqual(near.position.zone, 'top')
const placementDefinitions = model.posDefs(3, 'top-front', 1)
for (const currentStage of [stage, landscapeStage]) {
for (const frontAtBottom of [true, false]) {
const frontDefinition = placementDefinitions.find((d) => d.zone === 'front')
const topDefinition = placementDefinitions.find((d) => d.zone === 'top' && d.positionIndex === 1)
const frontAnchor = model.defAnchor(frontDefinition, currentStage, frontAtBottom, 3, 1)
const topAnchor = model.defAnchor(topDefinition, currentStage, frontAtBottom, 3, 1)
const frontPlacement = model.nearestPlacement(frontAnchor, currentStage, frontAtBottom, placementDefinitions, 3, 1)
const topPlacement = model.nearestPlacement(topAnchor, currentStage, frontAtBottom, placementDefinitions, 3, 1)
assert.deepStrictEqual(frontPlacement.position, { zone: 'front', positionIndex: 0, x: 0.5, y: 1 })
assert.strictEqual(topPlacement.position.zone, 'top')
assert.strictEqual(topPlacement.position.positionIndex, 1)
close(topPlacement.position.x, 0.5)
close(topPlacement.position.y, 0.5)
assert.strictEqual(model.posPoint({ zone: 'front', x: 0.5, y: 1 }, currentStage, frontAtBottom).y, frontAtBottom ? currentStage.top + currentStage.height + 42 : currentStage.top - 42)
assert.strictEqual(model.posPoint({ zone: 'top', x: 0.5, y: 0.5 }, currentStage, frontAtBottom).y, currentStage.top + currentStage.height / 2)
}
}
const sideAnchor = model.defAnchor(left, stage, true, 3, 2)
const tie = model.nearestPlacement({ x: stage.left + stage.width / 2, y: sideAnchor.y }, stage, true, [left, right], 3, 2)
assert.strictEqual(tie.position.zone, 'side-left')
assert.strictEqual(model.fixtureSort({ groupIndex: 1, fixtureIndex: 1 }, { groupIndex: 0, fixtureIndex: 9 }) > 0, true)
const batchGroup = (groupIndex, count) => Array.from({ length: count }, (_, i) => ({
groupIndex,
fixtureIndex: i + 1,
addressText: `${String.fromCharCode(65 + groupIndex)}${String(i + 1).padStart(3, '0')}`,
})).reverse()
const mixedA4B2 = model.interleaveBatchFixtures([...batchGroup(0, 4), ...batchGroup(1, 2)])
assert.deepStrictEqual(mixedA4B2.map((fixture) => fixture.groupIndex), [0, 1, 0, 0, 1, 0])
assert.deepStrictEqual(mixedA4B2.filter((fixture) => fixture.groupIndex === 0).map((fixture) => fixture.fixtureIndex), [1, 2, 3, 4])
const mixedA3B3C3 = model.interleaveBatchFixtures([...batchGroup(0, 3), ...batchGroup(1, 3), ...batchGroup(2, 3)])
assert.deepStrictEqual(mixedA3B3C3.map((fixture) => fixture.groupIndex), [0, 1, 2, 0, 1, 2, 0, 1, 2])
const mixedA6B2 = model.interleaveBatchFixtures([...batchGroup(0, 6), ...batchGroup(1, 2)])
assert.deepStrictEqual(mixedA6B2.map((fixture) => fixture.groupIndex), [0, 0, 1, 0, 0, 1, 0, 0])
assert.deepStrictEqual(mixedA4B2.slice().reverse().map((fixture) => fixture.groupIndex), [0, 1, 0, 0, 1, 0].reverse())
assert.strictEqual(new Set(mixedA3B3C3.map((fixture) => `${fixture.groupIndex}:${fixture.fixtureIndex}`)).size, 9)
assert.strictEqual(model.barStatus([[2, 1], [3, 3]], groups).valid, true)
assert.strictEqual(model.barStatus([[2, 0], [3, 3]], groups).valid, false)
assert.strictEqual(model.shorten('abcdefghijkl', 5), 'abcd…')
assert.strictEqual(model.parsePositive('0', 8), 8)
assert.strictEqual(model.parsePositive('12', 8), 12)
assert.deepStrictEqual(model.renderMetrics(700, 900, stage, 0, false), {
titleX: 42, titleY: 52, subtitleY: 82, legendTop: stage.top + stage.height + 132,
legendStep: 28, overflowY: null, sideNoteY: null, noteY: stage.top + stage.height + 160,
})
assert.deepStrictEqual(model.renderMetrics(700, 900, stage, undefined, false), model.renderMetrics(700, 900, stage, 0, false))
assert.strictEqual(model.renderMetrics(700, 900, stage, 4, false).noteY, stage.top + stage.height + 244)
assert.strictEqual(model.renderMetrics(700, 900, stage, 5, false).noteY, stage.top + stage.height + 216)
assert.strictEqual(model.renderMetrics(1200, 720, landscapeStage, 8, false).overflowY, null)
const portraitMetrics = model.renderMetrics(700, 900, stage, 9, true)
assert.strictEqual(portraitMetrics.overflowY, stage.top + stage.height + 132 + (3 * 28) + 28)
assert.strictEqual(portraitMetrics.sideNoteY, portraitMetrics.overflowY + 28)
assert.strictEqual(portraitMetrics.noteY, portraitMetrics.sideNoteY + 28)
assert.deepStrictEqual(model.renderMetrics(1200, 720, landscapeStage, 9, true), {
titleX: 20, titleY: 30, subtitleY: 50, legendTop: landscapeStage.top + landscapeStage.height + 132,
legendStep: 20, overflowY: 713, sideNoteY: null, noteY: null,
})
const sample = makeCase(3, 'top-front', 1)
const saved = { ...sample.automatic }
const firstKey = Object.keys(saved)[0]
const missing = model.restorePositions(sample.plan.fixtures, { [firstKey]: saved[firstKey] }, 3, sample.definitions, 1)
assert.deepStrictEqual(Object.keys(missing), [firstKey])
const invalid = model.restorePositions(sample.plan.fixtures, { [firstKey]: { zone: 'bad', x: NaN, y: 2 } }, 3, sample.definitions, 1)
assert.deepStrictEqual(Object.keys(invalid), [])
const normalized = model.restorePositions(sample.plan.fixtures, { [firstKey]: { ...saved[firstKey], x: -1, y: 2 } }, 3, sample.definitions, 1)
assert.deepStrictEqual(normalized[firstKey], { ...saved[firstKey], x: 0, y: 1 })
const overriddenSave = { ...saved[firstKey], x: 0.17 }
const merged = model.mergePositions(sample.plan.fixtures, sample.automatic, { [firstKey]: overriddenSave }, 3, sample.definitions, 1)
assert.strictEqual(merged[firstKey].x, 0.17)
sample.plan.fixtures.slice(1).forEach((fixture) => {
const key = model.posKey(fixture)
assert.deepStrictEqual(merged[key], sample.automatic[key])
})
const roundTripCounts = model.barsFromPositions(sample.plan.fixtures, sample.automatic, sample.groups, sample.definitions, 3, 1)
const roundTrip = model.posFromBars(sample.plan.fixtures, roundTripCounts, sample.groups, sample.definitions, 3, 1)
sample.plan.fixtures.forEach((fixture) => {
const key = model.posKey(fixture)
assert.deepStrictEqual(roundTrip[key], sample.automatic[key])
})
const { resolveSavedLayout } = require('../pages/dmx-layout/layout-storage')
const mixedGroups = [12, 16, 7, 6].map((fixtureCount, index) => ({ name: `组${index + 1}`, channelCount: 1, fixtureCount }))
const mixedPlan = calculateDmxAddressPlan({ startAddress: 1, groups: mixedGroups })
assert(!mixedPlan.error)
const mixedDefinitions = model.posDefs(3, 'top', 1)
const mixedCounts = model.balancedBars(mixedGroups, mixedDefinitions.length)
const mixedAutomatic = model.posFromBars(mixedPlan.fixtures, mixedCounts, mixedGroups, mixedDefinitions, 3, 1)
assert.deepStrictEqual(mixedCounts.map((row) => row.reduce((sum, count) => sum + count, 0)), [15, 13, 13])
assert.deepStrictEqual(mixedPlan.fixtures.map((fixture) => mixedAutomatic[model.posKey(fixture)].positionIndex)
  .reduce((rows, rowIndex, index) => { rows[rowIndex].push(mixedPlan.fixtures[index].groupIndex); return rows }, [[], [], []])
  .map((bar) => bar.length), [15, 13, 13])
mixedDefinitions.forEach((definition, barIndex) => {
  const barFixtures = mixedPlan.fixtures.filter((fixture) => mixedAutomatic[model.posKey(fixture)].positionIndex === barIndex)
    .sort((a, b) => mixedAutomatic[model.posKey(a)].x - mixedAutomatic[model.posKey(b)].x)
  assert.deepStrictEqual(new Set(barFixtures.map((fixture) => fixture.groupIndex)), new Set([0, 1, 2, 3]))
  assert(barFixtures.every((fixture, index) => index === 0 || fixture.groupIndex !== barFixtures[index - 1].groupIndex),
    '多组自动排布仍按组聚成块')
  barFixtures.forEach((fixture, index) => close(mixedAutomatic[model.posKey(fixture)].x, (index + 1) / (barFixtures.length + 1)))
})
assert.deepStrictEqual(Object.keys(mixedAutomatic).sort(), mixedPlan.fixtures.map(model.posKey).sort(),
  '自动交错改变了灯具 posKey')
const mixedAddressKeys = mixedPlan.fixtures.map((fixture) => `${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`)
assert.strictEqual(new Set(mixedAddressKeys).size, 41, '交错自动排布改变或丢失灯具地址身份')
const singlePlan = calculateDmxAddressPlan({ startAddress: 1, groups: [{ name: '单组', channelCount: 1, fixtureCount: 5 }] })
const singleGroups = [{ name: '单组', channelCount: 1, fixtureCount: 5 }]
const singleBars = [[2], [1], [2]]
const singlePositions = model.posFromBars(singlePlan.fixtures, singleBars, singleGroups, mixedDefinitions, 3, 1)
assert.deepStrictEqual(singlePlan.fixtures.map((fixture) => singlePositions[model.posKey(fixture)].positionIndex), [0, 0, 1, 2, 2],
  '单组/非均匀分杆的地址顺序发生变化')
for (const canvas of [{ width: 700, height: 900 }, { width: 1200, height: 720 }]) {
  const layout = model.posFromBars(mixedPlan.fixtures, mixedCounts, mixedGroups,
    mixedDefinitions, 3, 1)
  assert.strictEqual(Object.keys(layout).length, 41, `${canvas.width}x${canvas.height} 自动排布遗漏灯具`)
  const canvasStage = model.stageRect(12, 8, canvas.width, canvas.height)
  mixedDefinitions.forEach((definition, barIndex) => {
    const ordered = mixedPlan.fixtures.filter((fixture) => layout[model.posKey(fixture)].positionIndex === barIndex)
      .sort((a, b) => layout[model.posKey(a)].x - layout[model.posKey(b)].x)
    const physicalX = ordered.map((fixture) => model.posPoint(layout[model.posKey(fixture)], canvasStage, true).x)
    assert(physicalX.every((x, index) => index === 0 || x > physicalX[index - 1]),
      `${canvas.width}x${canvas.height} 自动布局物理顺序不一致`)
  })
}
const sideDefs = model.posDefs(2, 'full', 1)
const sideCounts = model.balancedBars(mixedGroups, sideDefs.length)
const sideLayout = model.posFromBars(mixedPlan.fixtures, sideCounts, mixedGroups, sideDefs, 2, 1)
sideDefs.filter((definition) => definition.zone.startsWith('side-')).forEach((definition) => {
  const row = sideCounts[definition.locationIndex]
  const sideFixtures = mixedPlan.fixtures.filter((fixture, fixtureIndex) => {
    const offset = sideCounts.slice(0, definition.locationIndex).reduce((sum, counts, index) => sum + counts[fixture.groupIndex], 0)
    return fixture.fixtureIndex > offset && fixture.fixtureIndex <= offset + row[fixture.groupIndex]
  }).sort((a, b) => sideLayout[model.posKey(a)].y - sideLayout[model.posKey(b)].y)
  const range = model.sideRange(definition.positionIndex, 1)
  sideFixtures.forEach((fixture, index) => close(sideLayout[model.posKey(fixture)].y, range.start + ((index + 1) / (sideFixtures.length + 1)) * (range.end - range.start)))
})
const legacyAutomatic = model.posFromBars(mixedPlan.fixtures, mixedCounts, mixedGroups, mixedDefinitions, 3, 1, true)
const makeSaved = (positions) => ({ rowCount: 3, schemeId: 'top', barCounts: mixedCounts, positions })
const fullRestored = resolveSavedLayout(makeSaved(legacyAutomatic), mixedPlan.fixtures, mixedGroups)
assert.deepStrictEqual(Object.keys(fullRestored.positions).sort(), Object.keys(legacyAutomatic).sort())
mixedPlan.fixtures.forEach((fixture) => assert.deepStrictEqual(fullRestored.positions[model.posKey(fixture)], legacyAutomatic[model.posKey(fixture)]))
const partialSaved = Object.fromEntries(mixedPlan.fixtures.slice(0, 3).map((fixture) => [model.posKey(fixture), legacyAutomatic[model.posKey(fixture)]]))
const partialRestored = resolveSavedLayout(makeSaved(partialSaved), mixedPlan.fixtures, mixedGroups)
mixedPlan.fixtures.forEach((fixture) => assert.deepStrictEqual(partialRestored.positions[model.posKey(fixture)], legacyAutomatic[model.posKey(fixture)],
  '部分旧存档回填坐标与历史等距位置不一致'))
const collisionGroups = [{ name: 'A', channelCount: 1, fixtureCount: 2 }, { name: 'B', channelCount: 1, fixtureCount: 2 }]
const collisionPlan = calculateDmxAddressPlan({ startAddress: 1, groups: collisionGroups })
const collisionDefinitions = model.posDefs(1, 'top', 1)
const collisionCounts = [[2, 2]]
const oldCollisionLayout = model.posFromBars(collisionPlan.fixtures, collisionCounts, collisionGroups, collisionDefinitions, 1, 1, true)
const savedA2 = model.posKey(collisionPlan.fixtures.find((fixture) => fixture.groupIndex === 0 && fixture.fixtureIndex === 2))
const restoredCollision = resolveSavedLayout({ rowCount: 1, schemeId: 'top', barCounts: collisionCounts,
  positions: { [savedA2]: oldCollisionLayout[savedA2] } }, collisionPlan.fixtures, collisionGroups)
const b1 = collisionPlan.fixtures.find((fixture) => fixture.groupIndex === 1 && fixture.fixtureIndex === 1)
assert.strictEqual(restoredCollision.positions[savedA2].x, .4, '部分旧存档改动了 A2 的原坐标')
assert.notStrictEqual(restoredCollision.positions[model.posKey(b1)].x, .4, '部分旧存档回填与已保存 A2 发生坐标碰撞')
console.log('DMX layout model tests passed')

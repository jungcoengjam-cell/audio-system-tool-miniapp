const assert = require('assert')
const Module = require('module')
const { calculateDmxAddressPlan } = require('../utils/dmx-address')

let channelProfilesLoaded = 0
const originalLoad = Module._load
const guidePath = require.resolve('../pages/dmx-address/utils/dmx-channel-guide')
const channelsPath = require.resolve('../pages/dmx-address/data/stage-lighting-channels')
Module._load = function trackChannelProfiles(request, parent, isMain) {
  let resolvedPath = null
  try { resolvedPath = Module._resolveFilename(request, parent, isMain) } catch (error) {}
  if (resolvedPath === guidePath || resolvedPath === channelsPath) channelProfilesLoaded += 1
  return originalLoad.call(this, request, parent, isMain)
}
let resultView
try {
  resultView = require('../pages/dmx-address/result-view')
} finally {
  Module._load = originalLoad
}
assert.strictEqual(channelProfilesLoaded, 0, '独立结果视图不应加载完整通道资料')

const { buildResultView: build, getFixtureProgressKey } = resultView
const { FIXTURE_DETAIL_PAGE_SIZE } = resultView

function plan(groups, options = {}) {
  const result = calculateDmxAddressPlan({ startAddress: 1, groups, ...options })
  assert(!result.error, result.error || '编址结果应有效')
  return { ...result, valid: true }
}

const available = plan([{ name: 'SE', fixtureModel: 'TL-SE3401', channelCount: 4, fixtureCount: 2 }])
const before = JSON.stringify(available)
const checkedFixtureKeys = new Set([getFixtureProgressKey(available.fixtures[0])])
const checkedBefore = [...checkedFixtureKeys]
const universeBefore = [...new Set(available.fixtures.map((fixture) => fixture.universeLabel))]
const universeView = build(available, {
  selectedUniverseLabel: 'bad',
  expandedUniverseLabels: new Set(['A']),
  checkedFixtureKeys,
  visibleFixtureLimit: 80,
})
assert.strictEqual(universeView.viewMode, 'universe')
assert.strictEqual(universeView.selectedUniverse.label, 'A', '非法域选择应回退到起始域')
assert.strictEqual(universeView.selectedUniverse.checkedCount, 1)
assert.strictEqual(universeView.selectedUniverse.detailGroups[0].fixtures[0].channelGuideAvailable, true)
assert.deepStrictEqual([...checkedFixtureKeys], checkedBefore)
assert.deepStrictEqual([...new Set(available.fixtures.map((fixture) => fixture.universeLabel))], universeBefore)
assert.strictEqual(JSON.stringify(available), before, '结果视图不得修改输入结果')

const custom = plan([{ name: 'custom', fixtureModel: 'custom-model', channelCount: 4, fixtureCount: 1 }])
const customView = build(custom, { expandedUniverseLabels: new Set(['A']) })
assert.strictEqual(customView.selectedUniverse.detailGroups[0].fixtures[0].channelGuideAvailable, false)

const crossDomain = plan([{ name: 'large', fixtureModel: 'TL-SE3401', channelCount: 88, fixtureCount: 6 }])
assert.deepStrictEqual(crossDomain.fixtures.map((fixture) => fixture.universeLabel), ['A', 'A', 'A', 'A', 'A', 'B'])
const crossView = build(crossDomain, { selectedUniverseLabel: 'B', expandedUniverseLabels: new Set(['B']) })
assert.strictEqual(crossView.selectedUniverse.label, 'B')
assert.strictEqual(crossView.selectedUniverse.fixtureCount, 1)
assert.strictEqual(build(crossDomain).selectedUniverse.detailGroups.length, 0, '折叠域不应构建逐台明细')
assert.strictEqual(build(crossDomain, { selectedUniverseLabel: 'A' }).selectedUniverse.statusText, '域尾已保留')

for (const channelCount of [4, 16, 88, 168]) {
  const guidePlan = plan([{ name: `guide-${channelCount}`, fixtureModel: 'TL-SE3401', channelCount, fixtureCount: 1 }])
  const guideView = build(guidePlan, { expandedUniverseLabels: new Set(['A']) })
  assert.strictEqual(guideView.selectedUniverse.detailGroups[0].fixtures[0].channelGuideAvailable, true)
}

const manual = plan([
  { name: 'manual A', fixtureModel: 'TL-SE3401', channelCount: 4, fixtureCount: 1, targetUniverse: 'A' },
  { name: 'manual C', fixtureModel: 'TL-SE3401', channelCount: 4, fixtureCount: 1, targetUniverse: 'C' },
], { allocationMode: 'manual' })
const groupView = build(manual, {
  resultViewMode: 'group',
  selectedGroupId: 'missing',
  expandedGroupIds: new Set(['group-1']),
  visibleFixtureLimit: 80,
})
assert.strictEqual(groupView.viewMode, 'group')
assert.strictEqual(groupView.selectedGroup.id, 'group-1')
assert.strictEqual(groupView.selectedGroup.visibleFixtureCount, 1)
assert.strictEqual(groupView.selectedGroup.universeCount, 1)

const manualOnlyC = plan([
  { name: 'manual C only', fixtureModel: 'TL-SE3401', channelCount: 4, fixtureCount: 1, targetUniverse: 'C' },
], { allocationMode: 'manual' })
const manualUniverseView = build(manualOnlyC, {
  selectedUniverseLabel: 'invalid',
  expandedUniverseLabels: new Set(['C']),
})
assert.strictEqual(manualUniverseView.selectedUniverse.label, 'C')

const fullUniverse = plan([
  { name: 'full-1', fixtureModel: 'custom-model', channelCount: 1, fixtureCount: 199 },
  { name: 'full-2', fixtureModel: 'custom-model', channelCount: 1, fixtureCount: 200 },
  { name: 'full-3', fixtureModel: 'custom-model', channelCount: 1, fixtureCount: 100 },
  { name: 'full-4', fixtureModel: 'custom-model', channelCount: 13, fixtureCount: 1 },
])
assert.strictEqual(build(fullUniverse).selectedUniverse.statusText, '已用满')
assert.strictEqual(build(fullUniverse, { selectedUniverseLabel: 'D' }).selectedUniverse.statusText, '空闲')

const many500 = plan([
  { name: 'many-500-1', fixtureModel: 'custom-model', channelCount: 1, fixtureCount: 200 },
  { name: 'many-500-2', fixtureModel: 'custom-model', channelCount: 1, fixtureCount: 200 },
  { name: 'many-500-3', fixtureModel: 'custom-model', channelCount: 1, fixtureCount: 100 },
])
for (const count of [80, 160, 500]) {
  const viewState = {
    expandedUniverseLabels: new Set(['A']),
    expandedGroupIds: new Set(),
    checkedFixtureKeys: new Set(),
    visibleFixtureLimit: count,
  }
  const resultBefore = structuredClone(many500)
  const viewStateBefore = structuredClone(viewState)
  const view = build(many500, viewState)
  const visibleFixtures = view.selectedUniverse.detailGroups.flatMap((group) => group.fixtures)
  assert.strictEqual(view.totalFixtures, 500)
  assert.strictEqual(view.selectedUniverse.fixtureCount, 500)
  assert.strictEqual(view.selectedUniverse.visibleFixtureCount, count)
  assert.strictEqual(visibleFixtures.length, count)
  assert.strictEqual(view.selectedUniverse.hasMoreFixtures, count < 500)
  assert.deepStrictEqual(many500, resultBefore)
  assert.deepStrictEqual(viewState, viewStateBefore)
}

for (const count of [80, 160, 500]) {
  const groupViewState = {
    resultViewMode: 'group',
    selectedGroupId: 'group-2',
    expandedGroupIds: new Set(['group-2']),
    expandedUniverseLabels: new Set(),
    checkedFixtureKeys: new Set(),
    visibleFixtureLimit: count,
  }
  const groupView = build(many500, groupViewState)
  assert.strictEqual(groupView.selectedGroup.displayFixtures.length, Math.min(count, 200))
  assert.strictEqual(groupView.selectedGroup.hasMoreFixtures, count < 200)
}
const marked = new Set([150, 250, 450].map((index) => getFixtureProgressKey(many500.fixtures[index - 1])))
const markedView = build(many500, {
  expandedUniverseLabels: new Set(['A']),
  expandedGroupIds: new Set(),
  checkedFixtureKeys: marked,
  visibleFixtureLimit: 80,
})
assert.strictEqual(markedView.selectedUniverse.visibleFixtureCount, 80)
assert.strictEqual(markedView.selectedUniverse.checkedCount, 3)
assert.strictEqual(markedView.selectedUniverse.detailGroups[0].checkedCount, 1)

const invalid = { valid: false, error: 'bad' }
assert.strictEqual(build(invalid), invalid, '错误结果必须保持对象 identity')
assert.strictEqual(FIXTURE_DETAIL_PAGE_SIZE, 80)
console.log('DMX 结果视图专项通过：跨域、手动分域、分页、通道入口与输入不可变性正常。')

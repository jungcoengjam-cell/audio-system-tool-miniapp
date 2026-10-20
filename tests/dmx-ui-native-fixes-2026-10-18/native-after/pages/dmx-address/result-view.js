const { startMeasurement } = require('../../utils/performance')
const { dmxFixtures } = require('../../data/stage-lighting')

const FIXTURE_DETAIL_PAGE_SIZE = 80
const UNIVERSE_LABELS = ['A', 'B', 'C', 'D']
const DMX_UNIVERSE_SIZE = 512
const FIXTURE_GROUP_TONES = [
{ accent: '#5856d6', soft: 'rgba(88, 86, 214, .08)', border: 'rgba(88, 86, 214, .24)' },
{ accent: '#007aff', soft: 'rgba(0, 122, 255, .08)', border: 'rgba(0, 122, 255, .22)' },
{ accent: '#00a878', soft: 'rgba(0, 168, 120, .08)', border: 'rgba(0, 168, 120, .22)' },
{ accent: '#d97706', soft: 'rgba(217, 119, 6, .08)', border: 'rgba(217, 119, 6, .22)' },
{ accent: '#c24182', soft: 'rgba(194, 65, 130, .08)', border: 'rgba(194, 65, 130, .22)' },
{ accent: '#4759c9', soft: 'rgba(71, 89, 201, .08)', border: 'rgba(71, 89, 201, .22)' },
]
const CHANNEL_GUIDE_FIXTURE_MODELS = new Set(dmxFixtures.map((fixture) => fixture.model))

function getFixtureProgressKey(fixture) {
return `${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`
}

function formatViewAddress(universeLabel, address) {
return `${universeLabel}${String(address).padStart(3, '0')}`
}

function buildUniverseGroups(fixtures, universeLabel) {
const rows = []
const rowsByGroup = new Map()
fixtures.forEach((fixture) => {
let row = rowsByGroup.get(fixture.groupId)
if (!row) {
row = {
id: `${universeLabel}-${fixture.groupId}`,
name: fixture.groupName,
channelCount: fixture.channelCount,
fixtureCount: 0,
firstAddressText: fixture.addressText,
lastAddressText: '',
}
rowsByGroup.set(fixture.groupId, row)
rows.push(row)
}
row.fixtureCount += 1
row.lastAddressText = formatViewAddress(universeLabel, fixture.endAddress)
})
return rows.map((row) => ({
...row,
rangeText: `${row.firstAddressText}–${row.lastAddressText}`,
}))
}

function buildUniverseDetailGroups(
fixtures,
checkedFixtureKeys = new Set(),
visibleFixtureLimit = fixtures.length,
) {
const limitedCount = Math.min(fixtures.length, Math.max(0, visibleFixtureLimit))
const groups = []
const groupsById = new Map()
fixtures.forEach((fixture, fixtureListIndex) => {
let group = groupsById.get(fixture.groupId)
if (!group) {
const tone = FIXTURE_GROUP_TONES[fixture.groupIndex % FIXTURE_GROUP_TONES.length]
group = {
id: `detail-${fixture.groupId}`,
number: fixture.groupIndex + 1,
name: fixture.groupName,
channelCount: fixture.channelCount,
fixtureCount: 0,
checkedCount: 0,
accentColor: tone.accent,
softColor: tone.soft,
borderColor: tone.border,
fixtures: [],
}
groupsById.set(fixture.groupId, group)
groups.push(group)
}
const progressKey = getFixtureProgressKey(fixture)
const selected = checkedFixtureKeys.has(progressKey)
group.fixtureCount += 1
if (selected) group.checkedCount += 1
if (fixtureListIndex >= limitedCount) return
group.fixtures.push({
globalIndex: fixture.globalIndex,
fixtureIndex: fixture.fixtureIndex,
fixtureModel: fixture.fixtureModel,
    channelGuideAvailable: CHANNEL_GUIDE_FIXTURE_MODELS.has(fixture.fixtureModel),
addressText: fixture.addressText,
endAddressText: formatViewAddress(fixture.universeLabel, fixture.endAddress),
rangeText: fixture.rangeText,
progressKey,
selected,
})
})
return groups.filter((group) => group.fixtures.length)
}

function buildGroupViews(
result,
selectedGroupId = '',
expandedGroupIds = new Set(),
checkedFixtureKeys = new Set(),
visibleFixtureLimit = FIXTURE_DETAIL_PAGE_SIZE,
) {
const selectedId = result.groups.some((group) => group.id === selectedGroupId)
? selectedGroupId
: result.groups[0]?.id || ''
const groupViews = result.groups.map((group) => {
const firstFixture = group.fixtures[0]
const lastFixture = group.fixtures[group.fixtures.length - 1]
const universeLabels = [...new Set(group.fixtures.map((fixture) => fixture.universeLabel))]
const checkedCount = group.fixtures.reduce(
(sum, fixture) => sum + Number(checkedFixtureKeys.has(getFixtureProgressKey(fixture))),
0,
)
return {
id: group.id,
groupIndex: group.groupIndex,
number: group.groupIndex + 1,
name: group.name,
channelCount: group.channelCount,
fixtureCount: group.fixtureCount,
checkedCount,
checkedPercent: Math.round((checkedCount / group.fixtureCount) * 100),
totalChannels: group.totalChannels,
selected: group.id === selectedId,
universeCount: universeLabels.length,
universeText: universeLabels.map((label) => `${label} 域`).join('、'),
statusText: universeLabels.length > 1 ? `跨 ${universeLabels.length} 个域` : `${universeLabels[0]} 域`,
rangeText: `${firstFixture.addressText}–${formatViewAddress(
lastFixture.universeLabel,
lastFixture.endAddress,
)}`,
}
})
const selectedSource = result.groups.find((group) => group.id === selectedId)
const selectedSummary = groupViews.find((group) => group.id === selectedId)
const expanded = expandedGroupIds.has(selectedId)
const visibleFixtureCount = expanded
? Math.min(selectedSource?.fixtures.length || 0, Math.max(0, visibleFixtureLimit))
: 0
const selectedGroup = {
...selectedSummary,
hasFixtures: Boolean(selectedSource?.fixtures.length),
expanded,
visibleFixtureCount,
hasMoreFixtures: visibleFixtureCount < (selectedSource?.fixtures.length || 0),
detailActionText: `查看本组逐台地址（${selectedSource?.fixtures.length || 0} 台）`,
displayFixtures: expanded
? selectedSource.fixtures.slice(0, visibleFixtureCount).map((fixture) => {
const progressKey = getFixtureProgressKey(fixture)
return {
globalIndex: fixture.globalIndex,
groupName: fixture.groupName,
fixtureModel: fixture.fixtureModel,
fixtureIndex: fixture.fixtureIndex,
    channelGuideAvailable: CHANNEL_GUIDE_FIXTURE_MODELS.has(fixture.fixtureModel),
addressText: fixture.addressText,
endAddressText: formatViewAddress(fixture.universeLabel, fixture.endAddress),
rangeText: fixture.rangeText,
progressKey,
selected: checkedFixtureKeys.has(progressKey),
}
})
: [],
}
return { groupViews, selectedGroup }
}

function buildResultView(result, viewState = {}) {
const finishBuild = startMeasurement('DMX/构建结果视图')
if (!result?.valid) {
finishBuild({ valid: false })
return result
}
const {
selectedUniverseLabel = 'A',
expandedUniverseLabels = new Set(),
resultViewMode = 'universe',
selectedGroupId = '',
expandedGroupIds = new Set(),
checkedFixtureKeys = new Set(),
visibleFixtureLimit = FIXTURE_DETAIL_PAGE_SIZE,
} = viewState
const selectedLabel = UNIVERSE_LABELS.includes(selectedUniverseLabel)
? selectedUniverseLabel
: result.startUniverseLabel
const universeSummaries = new Map(
result.universeSummaries.map((summary) => [summary.universeLabel, summary]),
)
const skippedRanges = new Map(
result.skippedRanges.map((range) => [range.universeLabel, range]),
)
const fixturesByUniverse = new Map(UNIVERSE_LABELS.map((label) => [label, []]))
result.fixtures.forEach((fixture) => fixturesByUniverse.get(fixture.universeLabel).push(fixture))
const universes = UNIVERSE_LABELS.map((label) => {
const summary = universeSummaries.get(label)
const reserved = skippedRanges.get(label)
const fixtures = fixturesByUniverse.get(label)
const usedChannels = summary?.usedChannels || 0
return {
label,
selected: label === selectedLabel,
fixtureCount: fixtures.length,
usedChannels,
usagePercent: Math.min(100, Math.round((usedChannels / DMX_UNIVERSE_SIZE) * 100)),
usageText: fixtures.length
? `${usedChannels} / ${DMX_UNIVERSE_SIZE}`
: reserved
? `保留 ${reserved.channelCount}`
: '空闲',
}
})
const selectedSummary = universeSummaries.get(selectedLabel)
const selectedReserved = skippedRanges.get(selectedLabel)
const selectedFixtures = fixturesByUniverse.get(selectedLabel)
const expanded = expandedUniverseLabels.has(selectedLabel)
const visibleFixtureCount = expanded
? Math.min(selectedFixtures.length, Math.max(0, visibleFixtureLimit))
: 0
const checkedCount = selectedFixtures.reduce(
(sum, fixture) => sum + Number(checkedFixtureKeys.has(getFixtureProgressKey(fixture))),
0,
)
const remainingChannels = selectedReserved
? selectedReserved.channelCount
: selectedSummary?.remainingChannels ?? DMX_UNIVERSE_SIZE
const selectedUniverse = {
label: selectedLabel,
rangeText: selectedSummary?.rangeText
|| (selectedReserved ? `${selectedReserved.rangeText} 保留` : '尚未使用'),
statusText: selectedReserved
? '域尾已保留'
: selectedSummary?.remainingChannels === 0
? '已用满'
: selectedFixtures.length
? '使用中'
: '空闲',
usedChannels: selectedSummary?.usedChannels || 0,
fixtureCount: selectedFixtures.length,
checkedCount,
checkedPercent: selectedFixtures.length
? Math.round((checkedCount / selectedFixtures.length) * 100)
: 0,
tailValue: remainingChannels,
tailLabel: selectedReserved ? '域尾保留' : '尾部可用',
groupRanges: buildUniverseGroups(selectedFixtures, selectedLabel),
hasFixtures: selectedFixtures.length > 0,
expanded,
visibleFixtureCount,
hasMoreFixtures: visibleFixtureCount < selectedFixtures.length,
detailActionText: `查看本域逐台地址（${selectedFixtures.length} 台）`,
detailGroups: expanded
? buildUniverseDetailGroups(selectedFixtures, checkedFixtureKeys, visibleFixtureCount)
: [],
}
const { groupViews, selectedGroup } = buildGroupViews(
result,
selectedGroupId,
expandedGroupIds,
checkedFixtureKeys,
visibleFixtureLimit,
)
const view = {
valid: true,
viewMode: resultViewMode === 'group' ? 'group' : 'universe',
allocationMode: result.allocationMode || 'auto',
modeText: result.modeText || '连续自动',
startText: result.startText,
endText: result.endText,
nextText: result.nextText,
nextMetricLabel: result.nextMetricLabel || '下一可用地址',
totalGroups: result.totalGroups,
totalFixtures: result.totalFixtures,
totalChannels: result.totalChannels,
universeCount: result.universeCount,
warnings: result.warnings,
skippedRanges: result.skippedRanges,
universes,
selectedUniverse,
groupViews,
selectedGroup,
}
finishBuild({
valid: true,
totalFixtures: result.totalFixtures,
visibleFixtures: resultViewMode === 'group'
? selectedGroup.visibleFixtureCount
: selectedUniverse.visibleFixtureCount,
})
return view
}

module.exports = {
UNIVERSE_LABELS,
FIXTURE_DETAIL_PAGE_SIZE,
getFixtureProgressKey,
buildResultView,
}

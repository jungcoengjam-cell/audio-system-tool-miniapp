const { MAX_GROUPS } = require('../../utils/dmx-address')
const { stageLightingProductIndex } = require('../../data/stage-lighting')
const { UNIVERSE_LABELS } = require('./result-view')

function createGroup(id, values = {}) {
const fixture = values.fixtureModel
? stageLightingProductIndex.get(values.fixtureModel)
: null
const channelModes = fixture?.channelModes || []
const fixtureSource = values.fixtureSource === 'library'
? 'library'
: values.fixtureSource === 'custom'
? 'custom'
: fixture ? 'library' : 'custom'
const savedLibraryChannelCount = Number(
values.libraryChannelCount || (fixtureSource === 'library' ? values.channelCount : 0),
)
const libraryChannelCount = channelModes.includes(savedLibraryChannelCount)
? savedLibraryChannelCount
: channelModes[0]
const customName = String(
values.customName
|| (fixtureSource === 'custom' ? values.name : '')
|| `灯具组 ${id}`,
)
const customChannelCount = String(
values.customChannelCount
|| (fixtureSource === 'custom' ? values.channelCount : '')
|| '16',
)
return {
id: `group-${id}`,
name: fixtureSource === 'library' && fixture
? `${fixture.model} ${fixture.name}`
: customName,
fixtureSource,
fixtureModel: fixtureSource === 'custom'
? String(values.fixtureModel || '')
: fixture?.model || '',
fixtureName: fixture?.name || '',
channelModes,
libraryChannelCount: String(libraryChannelCount || ''),
channelModeIndex: Math.max(0, channelModes.indexOf(libraryChannelCount)),
customName,
customChannelCount,
channelCount: fixtureSource === 'library' && libraryChannelCount
? String(libraryChannelCount)
: customChannelCount,
fixtureCount: String(values.fixtureCount || '4'),
targetUniverse: UNIVERSE_LABELS.includes(String(values.targetUniverse || '').toUpperCase())
? String(values.targetUniverse).toUpperCase()
: 'A',
targetUniverseIndex: Math.max(0, UNIVERSE_LABELS.indexOf(String(values.targetUniverse || '').toUpperCase())),
}
}
function restoreGroups(groups) {
if (!Array.isArray(groups) || !groups.length) {
return [createGroup(1, { fixtureSource: 'library' })]
}
return groups.slice(0, MAX_GROUPS).map((group, index) => createGroup(index + 1, group))
}
function buildPreferences(state) {
const groups = state.groups.map((group) => {
const fixtureSource = group.fixtureSource === 'library'
? 'library'
: group.fixtureSource === 'custom'
? 'custom'
: group.fixtureModel ? 'library' : 'custom'
return {
name: String(group.name || '').trim(),
fixtureSource,
fixtureModel: String(group.fixtureModel || ''),
libraryChannelCount: String(
group.libraryChannelCount || (fixtureSource === 'library' ? group.channelCount : ''),
),
customName: String(
group.customName || (fixtureSource === 'custom' ? group.name : ''),
).trim(),
customChannelCount: String(
group.customChannelCount || (fixtureSource === 'custom' ? group.channelCount : ''),
),
channelCount: String(group.channelCount || ''),
fixtureCount: String(group.fixtureCount || ''),
targetUniverse: UNIVERSE_LABELS.includes(group.targetUniverse) ? group.targetUniverse : 'A',
}
})
return {
startAddressText: String(state.startAddressText || ''),
allocationMode: state.allocationMode === 'manual' ? 'manual' : 'auto',
groups,
groupSummary: groups
.map((group) => `${group.name || '未命名'}×${group.fixtureCount || '?'}（${group.channelCount || '?'}CH）`)
.join('；'),
}
}

module.exports = { createGroup, restoreGroups, buildPreferences }

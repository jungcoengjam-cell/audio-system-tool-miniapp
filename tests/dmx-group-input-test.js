const assert = require('assert')
const { MAX_GROUPS } = require('../utils/dmx-address')
const { createGroup, restoreGroups, buildPreferences } = require('../pages/dmx-address/group-input')

for (const channelCount of [4, 16, 88, 168]) {
  const group = createGroup(1, {
    fixtureSource: 'library',
    fixtureModel: 'TL-SE3401',
    libraryChannelCount: channelCount,
  })
  assert.strictEqual(group.fixtureSource, 'library')
  assert.strictEqual(group.fixtureModel, 'TL-SE3401')
  assert.strictEqual(group.channelCount, String(channelCount))
  assert.strictEqual(group.channelModeIndex, [4, 16, 88, 168].indexOf(channelCount))
}

const custom = createGroup(3, {
  fixtureSource: 'custom', name: '自定义灯', channelCount: 12, fixtureCount: 2, targetUniverse: 'b',
})
assert.deepStrictEqual(
  { fixtureSource: custom.fixtureSource, name: custom.name, channelCount: custom.channelCount, fixtureCount: custom.fixtureCount, targetUniverse: custom.targetUniverse },
  { fixtureSource: 'custom', name: '自定义灯', channelCount: '12', fixtureCount: '2', targetUniverse: 'B' },
)
const implicitLibrary = createGroup(4, { fixtureModel: 'TL-SE3401', channelCount: 16 })
assert.strictEqual(implicitLibrary.fixtureSource, 'library')
assert.strictEqual(implicitLibrary.channelCount, '16')
const unknownImplicit = createGroup(6, { fixtureModel: 'UNKNOWN-MODEL', channelCount: 8 })
assert.deepStrictEqual(
  { fixtureSource: unknownImplicit.fixtureSource, fixtureModel: unknownImplicit.fixtureModel, channelCount: unknownImplicit.channelCount },
  { fixtureSource: 'custom', fixtureModel: 'UNKNOWN-MODEL', channelCount: '8' },
)
const unknownExplicitLibrary = createGroup(7, { fixtureSource: 'library', fixtureModel: 'UNKNOWN-MODEL' })
assert.deepStrictEqual(
  { fixtureSource: unknownExplicitLibrary.fixtureSource, fixtureModel: unknownExplicitLibrary.fixtureModel, channelModes: unknownExplicitLibrary.channelModes, channelCount: unknownExplicitLibrary.channelCount },
  { fixtureSource: 'library', fixtureModel: '', channelModes: [], channelCount: '16' },
)
const switchedToCustom = createGroup(5, { fixtureSource: 'custom', fixtureModel: 'TL-SE3401', customName: '现场灯', customChannelCount: 9 })
assert.strictEqual(switchedToCustom.fixtureModel, 'TL-SE3401')
assert.strictEqual(switchedToCustom.channelCount, '9')
const invalidLibraryMode = createGroup(8, { fixtureSource: 'library', fixtureModel: 'TL-SE3401', libraryChannelCount: 999 })
assert.deepStrictEqual(
  { libraryChannelCount: invalidLibraryMode.libraryChannelCount, channelCount: invalidLibraryMode.channelCount, channelModeIndex: invalidLibraryMode.channelModeIndex },
  { libraryChannelCount: '4', channelCount: '4', channelModeIndex: 0 },
)

const preservedInputs = createGroup(9, {
  fixtureSource: 'library', fixtureModel: 'TL-SE3401', libraryChannelCount: 88,
  customName: '保留自定义', customChannelCount: 7,
})
const preservedPreferences = buildPreferences({ startAddressText: 1, allocationMode: 'auto', groups: [preservedInputs] })
assert.deepStrictEqual(
  preservedPreferences.groups[0],
  {
    name: 'TL-SE3401 300W长条频闪灯', fixtureSource: 'library', fixtureModel: 'TL-SE3401',
    libraryChannelCount: '88', customName: '保留自定义', customChannelCount: '7',
    channelCount: '88', fixtureCount: '4', targetUniverse: 'A',
  },
)
const customAgain = createGroup(9, { ...preservedPreferences.groups[0], fixtureSource: 'custom' })
assert.deepStrictEqual(
  { customName: customAgain.customName, customChannelCount: customAgain.customChannelCount, libraryChannelCount: customAgain.libraryChannelCount },
  { customName: '保留自定义', customChannelCount: '7', libraryChannelCount: '88' },
)
const libraryAgain = createGroup(9, { ...preservedPreferences.groups[0], fixtureSource: 'library' })
assert.deepStrictEqual(
  { libraryChannelCount: libraryAgain.libraryChannelCount, customName: libraryAgain.customName, customChannelCount: libraryAgain.customChannelCount },
  { libraryChannelCount: '88', customName: '保留自定义', customChannelCount: '7' },
)

for (const oldPreferences of [null, undefined, [], {}, 'bad']) {
  const groups = restoreGroups(oldPreferences)
  assert.strictEqual(groups.length, 1)
  assert.strictEqual(groups[0].fixtureSource, 'library')
  assert.strictEqual(groups[0].id, 'group-1')
}
const defaults = createGroup(7, { fixtureSource: 'custom', name: '', customName: '', channelCount: 0, customChannelCount: 0, fixtureCount: 0, targetUniverse: '' })
assert.strictEqual(defaults.name, '灯具组 7')
assert.strictEqual(defaults.customChannelCount, '16')
assert.strictEqual(defaults.channelCount, '16')
assert.strictEqual(defaults.fixtureCount, '4')
assert.strictEqual(defaults.targetUniverse, 'A')
assert.strictEqual(createGroup(10, { targetUniverse: 'b' }).targetUniverse, 'B')
assert.strictEqual(createGroup(11, { targetUniverse: ' b ' }).targetUniverse, 'A')
assert.strictEqual(buildPreferences({ groups: [{ name: ' x ', fixtureSource: 'custom', customName: ' y ', customChannelCount: 2, channelCount: 2, fixtureCount: 3, targetUniverse: 'b' }] }).groups[0].targetUniverse, 'A')
const trimmed = buildPreferences({ startAddressText: '  ', allocationMode: 'unexpected', groups: [{ name: ' 现场 ', fixtureSource: 'custom', customName: ' 自定义 ', customChannelCount: 2, channelCount: 2, fixtureCount: 3, targetUniverse: 'A' }] })
assert.deepStrictEqual(
  { startAddressText: trimmed.startAddressText, allocationMode: trimmed.allocationMode, name: trimmed.groups[0].name, customName: trimmed.groups[0].customName, groupSummary: trimmed.groupSummary },
  { startAddressText: '  ', allocationMode: 'auto', name: '现场', customName: '自定义', groupSummary: '现场×3（2CH）' },
)
const falsyFields = createGroup(12, { fixtureSource: null, fixtureModel: null, name: false, customName: undefined, channelCount: false, customChannelCount: null, fixtureCount: undefined, targetUniverse: null })
assert.deepStrictEqual(
  { fixtureSource: falsyFields.fixtureSource, name: falsyFields.name, channelCount: falsyFields.channelCount, fixtureCount: falsyFields.fixtureCount, targetUniverse: falsyFields.targetUniverse },
  { fixtureSource: 'custom', name: '灯具组 12', channelCount: '16', fixtureCount: '4', targetUniverse: 'A' },
)
const nullPreference = buildPreferences({ startAddressText: null, allocationMode: null, groups: [{ name: null, fixtureSource: null, fixtureModel: false, libraryChannelCount: undefined, customName: null, customChannelCount: false, channelCount: undefined, fixtureCount: null, targetUniverse: undefined }] })
assert.deepStrictEqual(
  { startAddressText: nullPreference.startAddressText, allocationMode: nullPreference.allocationMode, group: nullPreference.groups[0], groupSummary: nullPreference.groupSummary },
  { startAddressText: '', allocationMode: 'auto', group: { name: '', fixtureSource: 'custom', fixtureModel: '', libraryChannelCount: '', customName: 'null', customChannelCount: 'undefined', channelCount: '', fixtureCount: '', targetUniverse: 'A' }, groupSummary: '未命名×?（?CH）' },
)

const sourceGroups = Array.from({ length: MAX_GROUPS + 3 }, (_, index) => ({
  fixtureSource: 'custom', name: `组${index + 1}`, customChannelCount: 1,
}))
const sourceSnapshot = JSON.stringify(sourceGroups)
const restored = restoreGroups(sourceGroups)
assert.strictEqual(restored.length, MAX_GROUPS)
assert.deepStrictEqual(restored.map((group) => group.id), Array.from({ length: MAX_GROUPS }, (_, i) => `group-${i + 1}`))
assert.strictEqual(JSON.stringify(sourceGroups), sourceSnapshot)

const state = {
  startAddressText: 101,
  allocationMode: 'manual',
  groups: [
    createGroup(1, { fixtureSource: 'library', fixtureModel: 'TL-SE3401', libraryChannelCount: 88, fixtureCount: 3, targetUniverse: 'C' }),
    createGroup(2, { fixtureSource: 'custom', customName: '备用', customChannelCount: 7, fixtureCount: 2, targetUniverse: 'D' }),
  ],
}
const stateSnapshot = JSON.stringify(state)
const preferences = buildPreferences(state)
assert.strictEqual(preferences.startAddressText, '101')
assert.strictEqual(preferences.allocationMode, 'manual')
assert.strictEqual(preferences.groups[0].libraryChannelCount, '88')
assert.strictEqual(preferences.groups[1].customChannelCount, '7')
assert.strictEqual(JSON.stringify(state), stateSnapshot)
const roundTrip = restoreGroups(preferences.groups)
assert.deepStrictEqual(buildPreferences({ ...state, groups: roundTrip }), preferences)

console.log('dmx-group-input-test: ok')

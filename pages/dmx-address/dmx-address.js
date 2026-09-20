const {
calculateDmxAddressPlan,
MAX_GROUPS,
MAX_TOTAL_FIXTURES,
} = require('../../utils/dmx-address')
const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const { dmxFixtures, stageLightingProductIndex } = require('../../data/stage-lighting')
const {
FIXTURE_DETAIL_PAGE_SIZE,
UNIVERSE_LABELS,
getFixtureProgressKey,
buildResultView,
} = require('./result-view')
const { createGroup, restoreGroups, buildPreferences } = require('./group-input')
const { readPreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
cancelResultReportGeneration,
createResultReportData,
createResultReportMethods,
resetStaleResultReport,
} = require('../../utils/result-report-controller')
const {
addPageToActiveProject,
syncPageFavorite,
togglePageFavorite,
} = require('../../utils/result-record-actions')
const PREFERENCE_KEY = 'audioTool.dmxAddress.preferences'
const PROGRESS_KEY = 'audioTool.dmxAddress.progress'
const CALCULATION_DELAY = 160
const FIXTURE_SEARCH_DELAY = 120
const PROGRESS_SAVE_DELAY = 120
const FIXTURE_SEARCH_LIMIT = 36
const ALL_FIXTURE_CATEGORIES = '全部'
const resultReportMethods = createResultReportMethods({
performancePrefix: 'DMX',
emptyToast: '暂无可生成的编址结果',
})
let fixtureProgressCacheLoaded = false
let fixtureProgressCache = null
function getFixtureCategory(name = '') {
if (/烟机|雾机|雪花机|泡泡机|火花机|水雾机/.test(name)) return '舞台特效'
if (/摇头/.test(name)) return '摇头灯'
if (/柔光灯/.test(name)) return '柔光灯'
if (/成像灯|聚光灯|追光灯/.test(name)) return '成像/聚光'
if (/PAR灯|帕灯|染色灯|观众灯|天地排|天幕灯/.test(name)) return 'PAR/染色'
return '效果灯'
}
const FIXTURE_SEARCH_ROWS = dmxFixtures.map((fixture) => ({
model: fixture.model,
name: fixture.name,
category: getFixtureCategory(fixture.name),
modeText: fixture.channelModes.map((mode) => `${mode} CH`).join(' / '),
searchText: `${fixture.model} ${fixture.name}`.toLowerCase(),
}))
const FIXTURE_CATEGORY_LABELS = ['摇头灯', 'PAR/染色', '柔光灯', '成像/聚光', '效果灯', '舞台特效']
const FIXTURE_SEARCH_CATEGORIES = [ALL_FIXTURE_CATEGORIES, ...FIXTURE_CATEGORY_LABELS].map((label) => ({
label,
count: label === ALL_FIXTURE_CATEGORIES
? FIXTURE_SEARCH_ROWS.length
: FIXTURE_SEARCH_ROWS.filter((item) => item.category === label).length,
}))
function searchFixtures(keyword = '', category = ALL_FIXTURE_CATEGORIES) {
const normalized = keyword.trim().toLowerCase()
const matches = FIXTURE_SEARCH_ROWS.filter(
(item) => (
(category === ALL_FIXTURE_CATEGORIES || item.category === category)
&& (!normalized || item.searchText.includes(normalized))
),
)
return {
rows: matches.slice(0, FIXTURE_SEARCH_LIMIT),
total: matches.length,
}
}
const DEFAULT_FIXTURE_SEARCH = searchFixtures()
let channelGuideApi = null
function getChannelGuideApi() {
  if (!channelGuideApi) channelGuideApi = require('./utils/dmx-channel-guide')
  return channelGuideApi
}
function decorateBatchRows(rows, selectedItems = []) {
const selectedModels = new Set(selectedItems.map((item) => item.model))
return rows.map((item) => ({ ...item, batchSelected: selectedModels.has(item.model) }))
}
function readFixtureProgress(calculationSignature, forceRefresh = false) {
try {
if (forceRefresh) {
fixtureProgressCacheLoaded = false
fixtureProgressCache = null
}
if (!fixtureProgressCacheLoaded) {
fixtureProgressCache = wx.getStorageSync(PROGRESS_KEY) || null
fixtureProgressCacheLoaded = true
}
const saved = fixtureProgressCache
if (saved?.calculationSignature !== calculationSignature || !Array.isArray(saved.keys)) {
return new Set()
}
return new Set(
saved.keys
.filter((key) => typeof key === 'string')
.slice(0, MAX_TOTAL_FIXTURES),
)
} catch (error) {
return new Set()
}
}
function writeFixtureProgress(calculationSignature, checkedFixtureKeys) {
try {
const payload = {
calculationSignature,
keys: [...checkedFixtureKeys],
}
wx.setStorageSync(PROGRESS_KEY, payload)
fixtureProgressCache = payload
fixtureProgressCacheLoaded = true
} catch (error) {
// 进度标记属于辅助功能，存储失败时仍保留当前页面内的选中状态。
}
}
function calculatePageResult(state) {
const finishCalculation = startMeasurement('DMX/核心编址')
const calculationGroups = state.groups.map((group) => ({
...group,
fixtureModel: group.fixtureSource === 'custom' ? '' : group.fixtureModel,
}))
const result = calculateDmxAddressPlan({
startAddress: state.startAddressText,
groups: calculationGroups,
allocationMode: state.allocationMode,
})
const pageResult = { ...result, valid: !result.error }
finishCalculation({
valid: pageResult.valid,
totalFixtures: pageResult.totalFixtures || 0,
totalGroups: pageResult.totalGroups || state.groups.length,
})
return pageResult
}
Page({
data: {
activeWorkspace: 'config',
startAddressText: '1',
allocationMode: 'auto',
allocationModeOptions: ['连续自动', '按组分域'],
universeOptions: UNIVERSE_LABELS,
groups: [createGroup(1)],
groupEditorOpen: false,
groupEditorIndex: -1,
result: null,
currentFavorite: false,
maximumGroups: MAX_GROUPS,
fixtureSearchOpen: false,
fixtureSearchKeyword: '',
fixtureSearchCategory: ALL_FIXTURE_CATEGORIES,
fixtureSearchCategories: FIXTURE_SEARCH_CATEGORIES,
fixtureSearchResults: [],
fixtureSearchTotal: 0,
fixtureSearchGroupIndex: -1,
fixtureSearchSelectedModel: '',
fixtureBatchOpen: false,
batchSelectedItems: [],
batchSelectedTotal: 0,
fixtureChannelGuide: null,
fixtureChannelGuideDetail: null,
...createResultReportData(),
},
onLoad() {
this._nextGroupId = 2
this._selectedUniverseLabel = 'A'
this._expandedUniverseLabels = new Set()
this._resultViewMode = 'universe'
this._selectedGroupId = ''
this._expandedGroupIds = new Set()
this._fixtureProgressSignature = ''
this._checkedFixtureKeys = new Set()
this._fixtureProgressTimer = null
this._fixtureSearchTimer = null
this._fixtureSearchNeedsRefresh = false
this._detailVisibleLimit = FIXTURE_DETAIL_PAGE_SIZE
this._fixtureDetailLoading = false
const preferences = readPreferences(PREFERENCE_KEY)
const groups = restoreGroups(preferences.groups)
this._nextGroupId = groups.length + 1
const state = {
startAddressText: preferences.startAddressText || '1',
allocationMode: preferences.allocationMode === 'manual' ? 'manual' : 'auto',
groups,
}
const result = calculatePageResult(state)
const preferenceSignature = JSON.stringify({
...preferences,
allocationMode: state.allocationMode,
groups: groups.map((group, index) => ({ ...preferences.groups?.[index], targetUniverse: group.targetUniverse })),
})
this._calculationResult = result
this._lastCalculationSignature = preferenceSignature
this._lastStoredPreferenceSignature = preferenceSignature
this._fixtureProgressSignature = preferenceSignature
this._checkedFixtureKeys = readFixtureProgress(preferenceSignature)
this.setMeasuredResultData({
...state,
result: this.buildCurrentResultView(result),
}, { source: 'onLoad' }, () => this.syncFavorite())
},
switchWorkspace(event) {
const workspace = event.currentTarget.dataset.workspace === 'plan' ? 'plan' : 'config'
if (workspace === this.data.activeWorkspace) return
vibrate('light')
this.setData({ activeWorkspace: workspace })
},
onShow() {
if (this._fixtureSearchNeedsRefresh) {
this._fixtureSearchNeedsRefresh = false
if (this.data.fixtureSearchOpen || this.data.fixtureBatchOpen) this.applyFixtureSearch()
}
if (!this._calculationResult?.valid) return
const checkedFixtureKeys = readFixtureProgress(this._fixtureProgressSignature, true)
const progressChanged = checkedFixtureKeys.size !== this._checkedFixtureKeys.size
|| [...checkedFixtureKeys].some((key) => !this._checkedFixtureKeys.has(key))
if (progressChanged) {
this._checkedFixtureKeys = checkedFixtureKeys
this.setMeasuredResultData(
{ result: this.buildCurrentResultView() },
{ source: 'onShowProgress' },
() => this.syncFavorite(),
)
return
}
this.syncFavorite()
},
onHide() {
this.flushScheduledCalculation()
this.flushFixtureProgressWrite()
this.cancelFixtureSearch(true)
},
onUnload() {
this.flushScheduledCalculation()
this.flushFixtureProgressWrite()
this.cancelFixtureSearch()
this._fixtureDetailLoading = false
cancelResultReportGeneration(this)
printPerformanceSummary('DMX/')
},
setMeasuredResultData(data, details = {}, callback) {
const finishViewUpdate = startMeasurement('DMX/setData结果更新', details)
this.setData(data, () => {
finishViewUpdate({ valid: Boolean(this.data.result?.valid) })
if (callback) callback()
})
},
resetFixtureDetailLimit() {
this._detailVisibleLimit = FIXTURE_DETAIL_PAGE_SIZE
this._fixtureDetailLoading = false
},
onBaseInput(event) {
const key = event.currentTarget.dataset.key
if (!key) return
this.setData({ [key]: event.detail.value }, () => this.scheduleCalculation())
},
switchAllocationMode(event) {
const allocationMode = event.currentTarget.dataset.mode === 'manual' ? 'manual' : 'auto'
if (allocationMode === this.data.allocationMode) return
let groups = this.data.groups
if (allocationMode === 'manual') {
const automaticGroups = this._calculationResult?.groups || []
groups = groups.map((group, index) => {
const firstFixture = automaticGroups[index]?.fixtures?.[0]
const targetUniverse = UNIVERSE_LABELS.includes(firstFixture?.universeLabel)
? firstFixture.universeLabel
: group.targetUniverse || 'A'
return {
...group,
targetUniverse,
targetUniverseIndex: Math.max(0, UNIVERSE_LABELS.indexOf(targetUniverse)),
}
})
}
vibrate('light')
this.commitCalculation({ allocationMode, groups })
},
onGroupUniverseChange(event) {
const index = Number(event.currentTarget.dataset.index)
const targetUniverseIndex = Number(event.detail.value)
const targetUniverse = UNIVERSE_LABELS[targetUniverseIndex]
if (!Number.isInteger(index) || !this.data.groups[index] || !targetUniverse) return
if (this.data.groups[index].targetUniverse === targetUniverse) return
const groups = this.data.groups.map((group, groupIndex) => (
groupIndex === index ? { ...group, targetUniverse, targetUniverseIndex } : group
))
vibrate('light')
this.commitCalculation({ groups })
},
onGroupInput(event) {
const index = Number(event.currentTarget.dataset.index)
const field = event.currentTarget.dataset.field
if (!Number.isInteger(index) || !this.data.groups[index] || !field) return
const value = event.detail.value
const groups = this.data.groups.map((group, groupIndex) => {
if (groupIndex !== index) return group
const changes = { [field]: value }
if (group.fixtureSource === 'custom' && field === 'name') changes.customName = value
if (group.fixtureSource === 'custom' && field === 'channelCount') {
changes.customChannelCount = value
}
return { ...group, ...changes }
})
this.setData({ groups }, () => this.scheduleCalculation())
},
onFieldBlur() {
this.flushScheduledCalculation()
},
openGroupEditor(event) { const index = Number(event.currentTarget.dataset.index); if (!Number.isInteger(index) || !this.data.groups[index]) return; vibrate('light'); this.setData({ groupEditorOpen: true, groupEditorIndex: index }) },
closeGroupEditor() { if (!this.data.groupEditorOpen) return; this.flushScheduledCalculation(); this.setData({ groupEditorOpen: false, groupEditorIndex: -1 }) },
finishGroupEditor() { this.closeGroupEditor() },
removeGroupFromEditor(event) { const index = Number(event.currentTarget.dataset.index); if (!Number.isInteger(index)) return; if (this.data.groups.length === 1) return wx.showToast({ title: '至少保留一个灯具分组', icon: 'none' }); this.closeGroupEditor(); this.removeGroup(event) },
resetFixturePicker(mode = 'closed', extra = {}) {
const open = mode !== 'closed'
this.setData({
fixtureSearchOpen: mode === 'search',
fixtureBatchOpen: mode === 'batch',
fixtureSearchKeyword: '',
fixtureSearchCategory: ALL_FIXTURE_CATEGORIES,
fixtureSearchResults: open ? DEFAULT_FIXTURE_SEARCH.rows : [],
fixtureSearchTotal: open ? DEFAULT_FIXTURE_SEARCH.total : 0,
fixtureSearchGroupIndex: -1,
fixtureSearchSelectedModel: '',
batchSelectedItems: [],
batchSelectedTotal: 0,
...extra,
})
},
cancelFixtureSearch(preservePending = false) {
const hasPending = this._fixtureSearchTimer !== null && this._fixtureSearchTimer !== undefined
if (hasPending) clearTimeout(this._fixtureSearchTimer)
this._fixtureSearchTimer = null
this._fixtureSearchNeedsRefresh = preservePending
&& hasPending
&& Boolean(this.data.fixtureSearchOpen || this.data.fixtureBatchOpen)
},
openFixtureSearch(event) {
const index = Number(event.currentTarget.dataset.index)
if (!Number.isInteger(index) || !this.data.groups[index]) return
this.cancelFixtureSearch()
this.resetFixturePicker('search', { fixtureSearchGroupIndex: index, fixtureSearchSelectedModel: this.data.groups[index].fixtureModel })
},
closeFixturePicker() {
this.cancelFixtureSearch()
this.resetFixturePicker()
},
stopPropagation() {},
onFixtureSearchInput(event) {
const fixtureSearchKeyword = event.detail.value
this.setData({ fixtureSearchKeyword })
this.cancelFixtureSearch()
this._fixtureSearchTimer = setTimeout(() => {
this._fixtureSearchTimer = null
this.applyFixtureSearch()
}, FIXTURE_SEARCH_DELAY)
},
applyFixtureSearch() {
const search = searchFixtures(
this.data.fixtureSearchKeyword,
this.data.fixtureSearchCategory,
)
this.setData({
fixtureSearchResults: this.data.fixtureBatchOpen
? decorateBatchRows(search.rows, this.data.batchSelectedItems)
: search.rows,
fixtureSearchTotal: search.total,
})
},
selectFixtureCategory(event) {
const fixtureSearchCategory = event.currentTarget.dataset.category
if (!FIXTURE_SEARCH_CATEGORIES.some((item) => item.label === fixtureSearchCategory)
|| fixtureSearchCategory === this.data.fixtureSearchCategory) return
this.cancelFixtureSearch()
vibrate('light')
const search = searchFixtures(this.data.fixtureSearchKeyword, fixtureSearchCategory)
this.setData({
fixtureSearchCategory,
fixtureSearchResults: this.data.fixtureBatchOpen
? decorateBatchRows(search.rows, this.data.batchSelectedItems)
: search.rows,
fixtureSearchTotal: search.total,
})
},
flushFixtureSearch() {
this.cancelFixtureSearch()
this.applyFixtureSearch()
},
selectFixture(event) {
if (this.data.fixtureBatchOpen) return this.toggleBatchFixture(event)
const fixture = stageLightingProductIndex.get(event.currentTarget.dataset.model)
const index = this.data.fixtureSearchGroupIndex
if (!fixture || !this.data.groups[index] || !fixture.channelModes.length) return
if (this.data.groups[index].fixtureModel === fixture.model) {
vibrate('light')
this.closeFixturePicker()
return
}
this.cancelFixtureSearch()
const groups = this.data.groups.map((group, groupIndex) => (
groupIndex === index
? {
...group,
name: `${fixture.model} ${fixture.name}`,
fixtureSource: 'library',
fixtureModel: fixture.model,
fixtureName: fixture.name,
channelModes: fixture.channelModes,
libraryChannelCount: String(fixture.channelModes[0]),
channelModeIndex: 0,
channelCount: String(fixture.channelModes[0]),
}
: group
))
vibrate('light')
this.resetFixturePicker()
this.commitCalculation({ groups })
},
switchFixtureSource(event) {
const index = Number(event.currentTarget.dataset.index)
const fixtureSource = event.currentTarget.dataset.source
const group = this.data.groups[index]
if (!Number.isInteger(index) || !group || !['library', 'custom'].includes(fixtureSource)) return
if (group.fixtureSource === fixtureSource) return
const fixture = fixtureSource === 'library'
? stageLightingProductIndex.get(group.fixtureModel)
: null
const libraryChannelCount = Number(group.libraryChannelCount)
const restoredLibraryChannelCount = fixture?.channelModes.includes(libraryChannelCount)
? libraryChannelCount
: fixture?.channelModes[0]
const changes = fixtureSource === 'library'
? fixture?.channelModes.length ? {
fixtureSource,
name: `${fixture.model} ${fixture.name}`,
fixtureName: fixture.name,
channelModes: fixture.channelModes,
libraryChannelCount: String(restoredLibraryChannelCount),
channelModeIndex: fixture.channelModes.indexOf(restoredLibraryChannelCount),
channelCount: String(restoredLibraryChannelCount),
} : {
fixtureSource,
name: '',
fixtureModel: '',
fixtureName: '',
channelModes: [],
libraryChannelCount: '',
channelModeIndex: 0,
channelCount: '',
}
: {
fixtureSource,
customName: group.customName || `灯具组 ${index + 1}`,
customChannelCount: group.customChannelCount || '16',
name: group.customName || `灯具组 ${index + 1}`,
channelCount: group.customChannelCount || '16',
}
const groups = this.data.groups.map((item, groupIndex) => (
groupIndex === index ? { ...item, ...changes } : item
))
vibrate('light')
this.commitCalculation({ groups })
},
onChannelModeChange(event) {
const index = Number(event.currentTarget.dataset.index)
const group = this.data.groups[index]
const channelModeIndex = Number(event.detail.value)
const channelCount = group?.channelModes[channelModeIndex]
if (!group || !Number.isFinite(channelCount)) return
if (Number(group.channelCount) === channelCount) return
const groups = this.data.groups.map((item, groupIndex) => (
groupIndex === index
? {
...item,
channelCount: String(channelCount),
libraryChannelCount: String(channelCount),
channelModeIndex,
}
: item
))
vibrate('light')
this.commitCalculation({ groups })
},
addGroup() { this.openBatchFixtureSearch() },
openBatchFixtureSearch() {
this.cancelFixtureSearch()
vibrate('medium')
this.resetFixturePicker('batch', { fixtureSearchResults: decorateBatchRows(DEFAULT_FIXTURE_SEARCH.rows) })
},
toggleBatchFixture(event) {
const model = event.currentTarget.dataset.model
const fixture = stageLightingProductIndex.get(model)
if (!fixture || !fixture.channelModes?.length) return
const current = this.data.batchSelectedItems
const existing = current.find((item) => item.model === model)
const batchSelectedItems = existing ? current.filter((item) => item.model !== model) : [...current, { model, quantity: 1 }]
vibrate('light')
this.setData({
batchSelectedItems,
batchSelectedTotal: batchSelectedItems.reduce((sum, item) => sum + item.quantity, 0),
fixtureSearchResults: decorateBatchRows(this.data.fixtureSearchResults, batchSelectedItems),
})
},
adjustBatchQuantity(event) {
const model = event.currentTarget.dataset.model
const delta = Number(event.currentTarget.dataset.delta)
if (!model || !Number.isFinite(delta)) return
const batchSelectedItems = this.data.batchSelectedItems.map((item) => item.model === model ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item)
this.setData({ batchSelectedItems, batchSelectedTotal: batchSelectedItems.reduce((sum, item) => sum + item.quantity, 0) })
},
confirmBatchAdd() {
const selectedItems = this.data.batchSelectedItems
if (!selectedItems.length) return
const groups = this.data.groups.map((group) => ({ ...group }))
const skipped = []
selectedItems.forEach((item) => {
const existingIndex = groups.findIndex((group) => group.fixtureSource === 'library' && group.fixtureModel === item.model)
if (existingIndex >= 0) {
const group = groups[existingIndex]
groups[existingIndex] = {
...group,
fixtureCount: String(Number(group.fixtureCount) + item.quantity),
}
return
}
if (groups.length >= MAX_GROUPS) {
skipped.push(item.model)
return
}
groups.push(createGroup(this._nextGroupId, {
fixtureSource: 'library',
fixtureModel: item.model,
fixtureCount: item.quantity,
}))
this._nextGroupId += 1
})
this.closeFixturePicker()
vibrate('medium')
if (skipped.length) wx.showToast({ title: `最多 ${MAX_GROUPS} 组，已跳过 ${skipped.length} 款`, icon: 'none' })
this.commitCalculation({ groups, activeWorkspace: 'config' })
},
openCustomGroupFromBatch() {
if (this.data.groups.length >= MAX_GROUPS) {
wx.showToast({ title: `最多添加 ${MAX_GROUPS} 组`, icon: 'none' })
return
}
const groups = [...this.data.groups, createGroup(this._nextGroupId, { fixtureSource: 'custom' })]
this._nextGroupId += 1
this.closeFixturePicker()
vibrate('medium')
this.commitCalculation({
groups,
groupEditorOpen: true,
groupEditorIndex: groups.length - 1,
activeWorkspace: 'config',
})
},
removeGroup(event) {
if (this.data.groups.length === 1) {
wx.showToast({ title: '至少保留一个灯具分组', icon: 'none' })
return
}
const index = Number(event.currentTarget.dataset.index)
if (!Number.isInteger(index)) return
vibrate('medium')
this.commitCalculation({ groups: this.data.groups.filter((item, groupIndex) => groupIndex !== index) })
},
scheduleCalculation() {
clearTimeout(this._calculationTimer)
this._calculationTimer = setTimeout(() => {
this._calculationTimer = null
this.commitCalculation()
}, CALCULATION_DELAY)
},
flushScheduledCalculation() {
if (!this._calculationTimer) return
clearTimeout(this._calculationTimer)
this._calculationTimer = null
this.commitCalculation()
},
commitCalculation(changes = {}) {
const state = { ...this.data, ...changes }
const preferences = buildPreferences(state)
const calculationSignature = JSON.stringify(preferences)
if (calculationSignature === this._lastCalculationSignature) return this._calculationResult
const result = calculatePageResult(state)
this._calculationResult = result
this._lastCalculationSignature = calculationSignature
if (calculationSignature !== this._fixtureProgressSignature) {
this.flushFixtureProgressWrite()
this._fixtureProgressSignature = calculationSignature
this._checkedFixtureKeys = readFixtureProgress(calculationSignature)
}
this.resetFixtureDetailLimit()
const resultView = this.buildCurrentResultView(result)
const resultReportChanges = resetStaleResultReport(
this,
this.buildResultReportRecord(result, preferences),
)
this.setMeasuredResultData({
...changes,
result: resultView,
...resultReportChanges,
}, { source: 'calculation' }, () => {
if (result.valid && calculationSignature !== this._lastStoredPreferenceSignature) {
writePreferences(PREFERENCE_KEY, preferences)
this._lastStoredPreferenceSignature = calculationSignature
}
this.syncFavorite()
})
return result
},
selectUniverse(event) {
const label = event.currentTarget.dataset.label
if (!UNIVERSE_LABELS.includes(label) || label === this._selectedUniverseLabel) return
this._selectedUniverseLabel = label
this.resetFixtureDetailLimit()
this.setMeasuredResultData(
{ result: this.buildCurrentResultView() },
{ source: 'selectUniverse' },
)
},
toggleUniverseDetails() {
const label = this._selectedUniverseLabel
if (!label || !this._calculationResult?.valid) return
const opening = !this._expandedUniverseLabels.has(label)
if (opening) {
this.resetFixtureDetailLimit()
this._expandedUniverseLabels.add(label)
} else {
this._expandedUniverseLabels.delete(label)
}
const finishExpansion = opening
? startMeasurement('DMX/展开逐台地址', { mode: 'universe', label, source: 'open' })
: null
const result = this.buildCurrentResultView()
this.setMeasuredResultData({ result }, { source: 'toggleUniverseDetails' }, () => {
if (finishExpansion) {
finishExpansion({ visibleFixtures: result.selectedUniverse.visibleFixtureCount })
}
})
},
switchResultView(event) {
const mode = event.currentTarget.dataset.mode
if (!['universe', 'group'].includes(mode) || mode === this._resultViewMode) return
this._resultViewMode = mode
this.resetFixtureDetailLimit()
this.setMeasuredResultData(
{ result: this.buildCurrentResultView() },
{ source: 'switchResultView' },
)
},
selectGroup(event) {
const id = event.currentTarget.dataset.id
if (!id || id === this._selectedGroupId) return
this._selectedGroupId = id
this.resetFixtureDetailLimit()
this.setMeasuredResultData(
{ result: this.buildCurrentResultView() },
{ source: 'selectGroup' },
)
},
toggleGroupDetails() {
const id = this._selectedGroupId
if (!id || !this._calculationResult?.valid) return
const opening = !this._expandedGroupIds.has(id)
if (opening) {
this.resetFixtureDetailLimit()
this._expandedGroupIds.add(id)
} else {
this._expandedGroupIds.delete(id)
}
const finishExpansion = opening
? startMeasurement('DMX/展开逐台地址', { mode: 'group', id, source: 'open' })
: null
const result = this.buildCurrentResultView()
this.setMeasuredResultData({ result }, { source: 'toggleGroupDetails' }, () => {
if (finishExpansion) {
finishExpansion({ visibleFixtures: result.selectedGroup.visibleFixtureCount })
}
})
},
loadMoreFixtureDetails() {
if (this._fixtureDetailLoading || !this._calculationResult?.valid) return
const currentResult = this.data.result
const detail = currentResult.viewMode === 'group'
? currentResult.selectedGroup
: currentResult.selectedUniverse
if (!detail?.expanded || !detail.hasMoreFixtures) return
const previousCount = detail.visibleFixtureCount
const nextCount = Math.min(detail.fixtureCount, previousCount + FIXTURE_DETAIL_PAGE_SIZE)
if (nextCount <= previousCount) return
this._fixtureDetailLoading = true
this._detailVisibleLimit = nextCount
const finishExpansion = startMeasurement('DMX/展开逐台地址', {
mode: currentResult.viewMode,
source: 'loadMore',
previousCount,
nextCount,
})
const result = this.buildCurrentResultView()
this.setMeasuredResultData({ result }, { source: 'loadMoreFixtureDetails' }, () => {
this._fixtureDetailLoading = false
finishExpansion({ visibleFixtures: nextCount })
})
},
toggleFixtureSelection(event) {
const progressKey = event.currentTarget.dataset.progressKey
if (!progressKey || !this._calculationResult?.valid) return
const selected = !this._checkedFixtureKeys.has(progressKey)
if (selected) this._checkedFixtureKeys.add(progressKey)
else this._checkedFixtureKeys.delete(progressKey)
vibrate('light')
this.scheduleFixtureProgressWrite()
const patch = this.buildFixtureSelectionPatch(progressKey, selected)
this.setMeasuredResultData(
Object.keys(patch).length ? patch : { result: this.buildCurrentResultView() },
{ source: 'toggleFixtureSelection' },
)
},
openFixtureChannelGuide(event) {
const globalIndex = Number(event.currentTarget.dataset.globalIndex)
const fixture = this._calculationResult?.fixtures?.find((item) => item.globalIndex === globalIndex)
if (!fixture) return
    const { buildActualDmxChannelGuide } = getChannelGuideApi()
    const guide = buildActualDmxChannelGuide(fixture)
if (!guide) {
wx.showToast({ title: '该型号暂无已核对的通道资料', icon: 'none' })
  return
}
this._fixtureGuideFixture = fixture
vibrate('light')
this.setData({
fixtureChannelGuide: guide,
fixtureChannelGuideDetail: null,
})
},
closeFixtureChannelGuide() {
this._fixtureGuideFixture = null
this.setData({ fixtureChannelGuide: null, fixtureChannelGuideDetail: null })
},
selectFixtureChannelGuideDetail(event) {
const channelIndex = Number(event.currentTarget.dataset.channelIndex)
const channels = this.data.fixtureChannelGuide?.channels
if (!Array.isArray(channels) || !Number.isInteger(channelIndex) || !channels[channelIndex]) return
const channel = channels[channelIndex]
const current = this.data.fixtureChannelGuideDetail
const detail = current?.channel === channel.channel
? null
: {
...channel,
ranges: channel.ranges.map((range) => ({ ...range })),
}
this.setData({ fixtureChannelGuideDetail: detail })
},
closeFixtureChannelGuideDetail() {
this.setData({ fixtureChannelGuideDetail: null })
},
buildFixtureSelectionPatch(progressKey, selected) {
const result = this.data.result
const delta = selected ? 1 : -1
if (result.viewMode === 'group') {
const fixtureIndex = result.selectedGroup.displayFixtures.findIndex(
(fixture) => fixture.progressKey === progressKey,
)
if (fixtureIndex < 0) return {}
const checkedCount = Math.max(
0,
Math.min(result.selectedGroup.fixtureCount, result.selectedGroup.checkedCount + delta),
)
return {
'result.selectedGroup.checkedCount': checkedCount,
'result.selectedGroup.checkedPercent': Math.round(
(checkedCount / result.selectedGroup.fixtureCount) * 100,
),
[`result.selectedGroup.displayFixtures[${fixtureIndex}].selected`]: selected,
}
}
const detailGroups = result.selectedUniverse.detailGroups
for (let groupIndex = 0; groupIndex < detailGroups.length; groupIndex += 1) {
const fixtureIndex = detailGroups[groupIndex].fixtures.findIndex(
(fixture) => fixture.progressKey === progressKey,
)
if (fixtureIndex < 0) continue
const checkedCount = Math.max(
0,
Math.min(
result.selectedUniverse.fixtureCount,
result.selectedUniverse.checkedCount + delta,
),
)
const groupCheckedCount = Math.max(
0,
Math.min(
detailGroups[groupIndex].fixtureCount,
detailGroups[groupIndex].checkedCount + delta,
),
)
return {
'result.selectedUniverse.checkedCount': checkedCount,
'result.selectedUniverse.checkedPercent': Math.round(
(checkedCount / result.selectedUniverse.fixtureCount) * 100,
),
[`result.selectedUniverse.detailGroups[${groupIndex}].checkedCount`]: groupCheckedCount,
[`result.selectedUniverse.detailGroups[${groupIndex}].fixtures[${fixtureIndex}].selected`]: selected,
}
}
return {}
},
scheduleFixtureProgressWrite() {
clearTimeout(this._fixtureProgressTimer)
this._fixtureProgressTimer = setTimeout(() => {
this._fixtureProgressTimer = null
writeFixtureProgress(this._fixtureProgressSignature, this._checkedFixtureKeys)
}, PROGRESS_SAVE_DELAY)
},
flushFixtureProgressWrite() {
if (!this._fixtureProgressTimer) return
clearTimeout(this._fixtureProgressTimer)
this._fixtureProgressTimer = null
writeFixtureProgress(this._fixtureProgressSignature, this._checkedFixtureKeys)
},
openFixtureLayout() {
this.flushScheduledCalculation()
if (!this._calculationResult?.valid) {
wx.showToast({ title: '请先完成有效编址', icon: 'none' })
return
}
this.flushFixtureProgressWrite()
writePreferences(PREFERENCE_KEY, this.getPreferences())
vibrate('medium')
wx.navigateTo({ url: '/pages/dmx-layout/dmx-layout' })
},
clearVisibleFixtureSelections() {
if (!this._calculationResult?.valid) return
const result = this.data.result
const activeFixtures = result.viewMode === 'group'
? this._calculationResult.groups.find((group) => group.id === this._selectedGroupId)?.fixtures || []
: this._calculationResult.fixtures.filter(
(fixture) => fixture.universeLabel === this._selectedUniverseLabel,
)
const activeKeys = activeFixtures.map(getFixtureProgressKey)
if (!activeKeys.some((key) => this._checkedFixtureKeys.has(key))) return
wx.showModal({
title: '清空设置标记',
content: result.viewMode === 'group'
? '确定清空当前灯具组的已设置标记吗？'
: `确定清空 ${result.selectedUniverse.label} 域的已设置标记吗？`,
success: ({ confirm }) => {
if (!confirm) return
activeKeys.forEach((key) => this._checkedFixtureKeys.delete(key))
clearTimeout(this._fixtureProgressTimer)
this._fixtureProgressTimer = null
vibrate('medium')
writeFixtureProgress(this._fixtureProgressSignature, this._checkedFixtureKeys)
this.setMeasuredResultData(
{ result: this.buildCurrentResultView() },
{ source: 'clearFixtureSelections' },
)
},
})
},
buildCurrentResultView(result = this._calculationResult) {
const resultView = buildResultView(result, {
selectedUniverseLabel: this._selectedUniverseLabel,
expandedUniverseLabels: this._expandedUniverseLabels,
resultViewMode: this._resultViewMode,
selectedGroupId: this._selectedGroupId,
expandedGroupIds: this._expandedGroupIds,
checkedFixtureKeys: this._checkedFixtureKeys,
visibleFixtureLimit: this._detailVisibleLimit,
})
if (resultView?.valid) {
this._selectedUniverseLabel = resultView.selectedUniverse.label
this._selectedGroupId = resultView.selectedGroup.id
}
return resultView
},
getPreferences() {
return buildPreferences(this.data)
},
getRecordLookupPayload() {
return this._calculationResult?.valid
? { module: 'dmxAddress', preferences: this.getPreferences() }
: null
},
syncFavorite() {
return syncPageFavorite(this)
},
getResultText() {
const result = this._calculationResult
if (!result?.valid) return ''
const groupDomain = (group) => result.allocationMode === 'manual'
? ` · ${group.targetUniverse}域`
: ''
const groupLines = result.groups.flatMap((group) => [
'',
`${group.groupIndex + 1}. ${group.name} · ${group.fixtureCount} 台 · ${group.channelCount} CH/台${groupDomain(group)}`,
...group.fixtures.map((fixture) => (
`   #${fixture.fixtureIndex}  ${fixture.addressText}  占用 ${fixture.rangeText}`
)),
])
return [
'灯具地址码计算',
`编址方式：${result.modeText}`,
`起始位置：${result.startText}`,
`规模：${result.totalGroups} 组 · ${result.totalFixtures} 台 · ${result.totalChannels} 个通道`,
`已用范围：${result.startText} → ${result.endText}`,
`下一可用：${result.nextText}`,
...groupLines,
'',
result.ruleText,
...result.warnings.map((warning) => `提醒：${warning}`),
'现场复核：灯具通道模式必须与本次填写一致；换模式后应重新编址，并在控台 Patch、节点域号和灯具地址菜单中逐台核对。',
].join('\n')
},
getRecordPayload() {
const resultText = this.getResultText()
if (!resultText) return null
const result = this._calculationResult
return {
module: 'dmxAddress',
title: `${result.modeText} · ${result.totalGroups} 组 · ${result.totalFixtures} 台灯具`,
summary: `${result.modeText} · ${result.startText} → ${result.endText} · 下一可用 ${result.nextText}`,
preferences: this.getPreferences(),
resultText,
}
},
buildResultReportRecord(result = this._calculationResult, preferences = this.getPreferences()) {
if (!result?.valid) return null
const resultText = result.groups.map((group) => {
const firstFixture = group.fixtures[0]
const lastFixture = group.fixtures[group.fixtures.length - 1]
const endAddress = lastFixture.rangeText.split('–').pop()
const groupDomain = result.allocationMode === 'manual' ? ` · ${group.targetUniverse}域` : ''
return `${group.groupIndex + 1}. ${group.name} · ${group.fixtureCount} 台 × ${group.channelCount} CH${groupDomain} · ${firstFixture.addressText} → ${endAddress}`
}).join('\n')
return {
module: 'dmxAddress',
title: `${result.modeText} · ${result.totalGroups} 组 · ${result.totalFixtures} 台灯具`,
summary: `${result.modeText} · ${result.startText} → ${result.endText} · 下一可用 ${result.nextText}`,
preferences,
resultText,
}
},
...resultReportMethods,
copyResult() {
const data = this.getResultText()
if (!data) return
vibrate('medium')
wx.setClipboardData({ data })
},
toggleCurrentFavorite() {
togglePageFavorite(this)
},
saveToActiveProject() {
addPageToActiveProject(this)
},
})

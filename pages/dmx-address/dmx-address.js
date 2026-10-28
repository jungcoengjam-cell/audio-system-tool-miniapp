let markToolLoadStage = () => false
try {
const performanceProbe = require('../../utils/performance')
if (typeof performanceProbe.markToolLoadStage === 'function') {
markToolLoadStage = (route, phase) => {
try { return performanceProbe.markToolLoadStage(route, phase) } catch (error) { return false }
}
}
markToolLoadStage('/pages/dmx-address/dmx-address', 'module')
} catch (error) {}

const {
calculateDmxAddressPlan,
MAX_GROUPS,
MAX_TOTAL_FIXTURES,
} = require('../../utils/dmx-address')
const { printPerformanceSummary, startMeasurement } = require('../../utils/performance')
const { dmxFixtures, stageLightingProductIndex } = require('../../data/stage-lighting')
const {
FIXTURE_DETAIL_PAGE_SIZE,
CHANNEL_GUIDE_FIXTURE_MODELS,
UNIVERSE_LABELS,
getFixtureProgressKey,
buildResultView,
} = require('./result-view')
const { createGroup, restoreGroups, buildPreferences } = require('./group-input')
const { createFixtureCatalog } = require('./fixture-catalog')
const { createFixturePickerMethods } = require('./fixture-picker')
const { createDmxAddressResultReportUiMethods } = require('./result-report-ui')
const { readPreferences, writePreferences } = require('../../utils/preferences')
const records = require('../../utils/records')
const lightingWorkspace = require('../dmx-layout/lighting-workspace')
const {
getLightingViewportMetrics,
getFixtureSearchScrollMetrics,
getAddressCardChipColumns,
} = require('./viewport')
const { vibrate } = require('../../utils/haptics')
const { isPageContextCurrent } = require('../../utils/report-image-actions')
const {
cancelResultReportGeneration,
createResultReportData,
createResultReportMethods,
resetStaleResultReport,
} = require('../../utils/result-report-controller')
const { createDmxSheetLifecycleMethods } = require('./sheet-lifecycle')
const { createDmxCardInteractionMethods } = require('./card-interactions')
const {
addPageToActiveProject,
syncPageFavorite,
togglePageFavorite,
} = require('../../utils/result-record-actions')
const PREFERENCE_KEY = 'audioTool.dmxAddress.preferences'
const PROGRESS_KEY = 'audioTool.dmxAddress.progress'
const CALCULATION_DELAY = 160
const PROGRESS_SAVE_DELAY = 120
const LIGHTING_GROUP_COLORS = ['#8a2bff', '#007aff', '#00b8ba']
const resultReportMethods = createResultReportMethods({
performancePrefix: 'DMX',
emptyToast: '暂无可生成的编址结果',
})
const resultReportUiMethods = createDmxAddressResultReportUiMethods({ resultReportMethods, isPageContextCurrent, vibrate })
const dmxPageMethodRuntime = {
wx: new Proxy({}, {
get(_target, key) {
const currentWx = wx
const value = currentWx[key]
return typeof value === 'function' ? value.bind(currentWx) : value
},
}),
Date: { now: () => Date.now() },
setTimeout: (...args) => setTimeout(...args),
clearTimeout: (...args) => clearTimeout(...args),
}
const sheetLifecycleMethods = createDmxSheetLifecycleMethods({ ...dmxPageMethodRuntime, cancelResultReportGeneration })
const cardInteractionMethods = createDmxCardInteractionMethods(dmxPageMethodRuntime)
let fixtureProgressCacheLoaded = false
let fixtureProgressCache = null
function readPageDataPath(data, key) {
const parts = String(key).replace(/\[(\d+)\]/g, '.$1').split('.')
let value = data
for (const part of parts) {
if (value === null || value === undefined) return undefined
value = value[part]
}
return value
}
function samePageDataValue(left, right) {
if (Object.is(left, right)) return true
if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
if (Array.isArray(left) !== Array.isArray(right)) return false
if (Array.isArray(left) && left.length !== right.length) return false
const leftKeys = Object.keys(left)
const rightKeys = Object.keys(right)
if (leftKeys.length !== rightKeys.length) return false
return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
&& samePageDataValue(left[key], right[key]))
}
function pageDataPatchChangesData(data, patch) {
const entries = Object.entries(patch)
const paths = entries.map(([key]) => String(key).replace(/\[(\d+)\]/g, '.$1').split('.'))
for (let left = 0; left < paths.length; left += 1) {
for (let right = left + 1; right < paths.length; right += 1) {
const shorter = paths[left].length <= paths[right].length ? paths[left] : paths[right]
const longer = shorter === paths[left] ? paths[right] : paths[left]
if (shorter.every((part, index) => part === longer[index])) return true
}
}
return entries.some(([key, value]) => !samePageDataValue(readPageDataPath(data, key), value))
}
const fixtureCatalog = createFixtureCatalog(dmxFixtures, {
getFixtureDisplayName,
getFixtureSpriteIndex,
})
const {
ALL_FIXTURE_CATEGORIES,
FIXTURE_SEARCH_CATEGORIES,
DEFAULT_FIXTURE_SEARCH,
decorateBatchRows,
} = fixtureCatalog
let channelGuideApi = null
function getChannelGuideApi() {
  if (!channelGuideApi) channelGuideApi = require('./utils/dmx-channel-guide')
  return channelGuideApi
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
function makeStableId(prefix) {
return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
function fixtureFingerprint(fixture) {
return JSON.stringify([
String(fixture.fixtureModel || ''),
Number(fixture.channelCount) || 0,
String(fixture.universeLabel || ''),
Number(fixture.startAddress) || 0,
Number(fixture.endAddress) || 0,
])
}
function endAddressText(fixture) {
return `${fixture.universeLabel}${String(fixture.endAddress).padStart(3, '0')}`
}
function getFixtureSpriteIndex(fixture = {}) {
const name = `${fixture.name || ''} ${fixture.model || ''}`
if (/摇头|扫描|moving/i.test(name)) return 2
if (/柔光|染色|par|帕灯|天幕|观众/i.test(name)) return 1
return 0
}
function getFixtureDisplayName(fixture, fallback = '') {
const name = String(fixture?.name || fallback || '').trim()
if (/平板柔光灯/.test(name)) return '平板柔光灯'
if (/成像灯/.test(name)) return '成像灯'
if (/摇头灯/.test(name)) return '摇头灯'
if (/柔光灯/.test(name)) return '柔光灯'
return name.replace(/^\s*\d+(?:\.\d+)?\s*W\s*/i, '').replace(/\s*[（(].*?[）)]/g, '').trim() || name
}
function getFixtureTint(index) {
return [
'rgba(138,43,255,0.15)',
'rgba(0,122,255,0.15)',
'rgba(0,184,186,0.15)',
][index % LIGHTING_GROUP_COLORS.length]
}
function buildAddressCardPreviewChips(fixtures = [], columns = 8, color = '#007aff') {
const visible = (fixtures || []).slice(0, Math.max(1, Number(columns) || 1) * 2).map((fixture) => ({ ...fixture }))
if (visible.length && visible.length < (fixtures || []).length) {
const last = visible[visible.length - 1]
const rgb = /^#([0-9a-f]{6})$/i.exec(color)?.[1] || '007aff'
const red = parseInt(rgb.slice(0, 2), 16)
const green = parseInt(rgb.slice(2, 4), 16)
const blue = parseInt(rgb.slice(4, 6), 16)
const address = String(last.addressText || '')
last.previewOverflow = true
last.previewAddressCharacters = Array.from(address).map((value, index) => ({
id: `${last.stableId}:${index}`,
value,
color: `rgba(${red}, ${green}, ${blue}, ${Math.max(0.38, 1 - index * 0.16)})`,
}))
}
return visible
}
function getFixtureRange(fixtures = []) {
if (!fixtures.length) return ''
return `${fixtures[0].addressText}–${endAddressText(fixtures[fixtures.length - 1])}`
}
function getFixturePlacementLabel(layout, stableId) {
const position = layout?.positionsById?.[stableId]
if (!position?.rodId) return '未放置'
const rods = [
...(layout.internalRods || []),
...(layout.frontRods || []),
...(layout.legacySideRods || []),
]
const rod = rods.find((item) => String(item.id) === String(position.rodId))
if (!rod) return '已放置'
const internalIndex = (layout.internalRods || []).findIndex((item) => String(item.id) === String(rod.id))
if (internalIndex >= 0) return `灯杆${internalIndex + 1}`
const frontIndex = (layout.frontRods || []).findIndex((item) => String(item.id) === String(rod.id))
if (frontIndex >= 0) return `面光杆${frontIndex + 1}`
return `${rod.side === 'left' ? '左侧光' : '右侧光'}${Number(rod.positionIndex) + 1}`
}
function buildOccupancyUniverses(result, selectedLabel = 'A') {
return UNIVERSE_LABELS.map((label) => {
const fixtures = result?.fixtures?.filter((fixture) => fixture.universeLabel === label) || []
const occupiedChannels = fixtures.reduce((sum, fixture) => sum + fixture.channelCount, 0)
const segments = (result?.groups || []).flatMap((group) => {
const groupFixtures = group.fixtures.filter((fixture) => fixture.universeLabel === label)
if (!groupFixtures.length) return []
const startAddress = Math.min(...groupFixtures.map((fixture) => fixture.startAddress))
const endAddress = Math.max(...groupFixtures.map((fixture) => fixture.endAddress))
return [{
id: `${label}-${group.stableId || group.id}`,
name: group.name,
color: LIGHTING_GROUP_COLORS[group.groupIndex % LIGHTING_GROUP_COLORS.length],
leftPercent: ((startAddress - 1) / 512) * 100,
widthPercent: ((endAddress - startAddress + 1) / 512) * 100,
rangeText: `${label}${String(startAddress).padStart(3, '0')}–${label}${String(endAddress).padStart(3, '0')}`,
}]
})
return {
label,
selected: label === selectedLabel,
occupiedChannels,
occupiedText: `${occupiedChannels} / 512`,
usagePercent: Math.min(100, (occupiedChannels / 512) * 100),
usageText: `${occupiedChannels} / 512 CH`,
segments,
fixtures: fixtures.map((fixture) => ({
...fixture,
endAddressText: endAddressText(fixture),
checked: false,
})),
}
})
}
function restoreLightingGroups(scheme) {
return (scheme?.preferences?.groups || []).map((saved, index) => {
const fixture = stageLightingProductIndex.get(String(saved.fixtureModel || '').trim())
const knownModel = Boolean(fixture)
const fixtureSource = saved.fixtureSource === 'library'
? 'library'
: saved.fixtureSource === 'custom'
? 'custom'
: knownModel ? 'library' : 'custom'
const channelModes = fixture?.channelModes || []
const targetUniverse = UNIVERSE_LABELS.includes(String(saved.targetUniverse || '').toUpperCase())
? String(saved.targetUniverse).toUpperCase()
: 'A'
return {
...saved,
id: `group-${index + 1}`,
_lightingGroupId: scheme.groupIds[index] || makeStableId('group'),
name: String(saved.name || (fixture ? `${fixture.model} ${fixture.name}` : `灯具组 ${index + 1}`)),
fixtureSource,
fixtureModel: String(saved.fixtureModel || ''),
fixtureName: fixture?.name || '',
channelModes,
channelModeIndex: channelModes.indexOf(Number(saved.channelCount)),
libraryChannelCount: String(saved.libraryChannelCount || saved.channelCount || ''),
customName: String(saved.customName || saved.name || ''),
customChannelCount: String(saved.customChannelCount || saved.channelCount || ''),
channelCount: String(saved.channelCount || ''),
fixtureCount: String(saved.fixtureCount || ''),
targetUniverse,
targetUniverseIndex: UNIVERSE_LABELS.indexOf(targetUniverse),
}
})
}
Page({
data: {
activeWorkspace: 'config',
startAddressText: '1',
allocationMode: 'auto',
allocationModeOptions: ['连续分配', '按组分域'],
allocationModeIndex: 0,
startAddressDisplay: '001',
universeOptions: UNIVERSE_LABELS,
groups: [],
groupEditorOpen: false,
groupEditorIndex: -1,
result: null,
currentFavorite: false,
maximumGroups: MAX_GROUPS,
fixtureSearchOpen: false,
fixturePickerClosing: false,
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
fixtureChannelGuideDetailExpanded: false,
fixtureChannelGuideClosing: false,
resultReportPreviewClosing: false,
...createResultReportData(),
contextRows: [],
projectSaveRows: [],
contextIndex: 0,
contextName: '临时设置',
currentContextTemporary: true,
contextError: '',
statusBarHeight: 24,
navigationHeight: 68,
shareTop: 30,
windowHeight: 844,
windowWidth: 390,
overlaySafeTop: 76,
overlaySafeBottom: 12,
overlayMaxHeight: 756,
overlayCenterTop: 454,
overlaySearchMaxHeight: 742,
overlaySearchSheetHeight: 658,
fixtureSearchResultsHeight: 460,
fixtureBatchFooterHeight: 0,
batchSelectedListHeight: 0,
overlayPendingMaxHeight: 675,
overlayAddMaxHeight: 742,
overlaySaveMaxHeight: 557,
overlayGuideHeight: 692,
overlayReportHeight: 708,
overlaySaveListMaxHeight: 286,
showSaveNewProject: false,
saveProjectClosing: false,
showNewProjectNameInput: false,
newProjectName: '',
projectSaveError: '',
projectSaveBusy: false,
pendingProjectSaveId: '',
saveRetryAvailable: false,
undoDeleteAvailable: false,
undoDeleteText: '',
swipedGroupIndex: -1,
swipeDragIndex: -1,
swipeDragOffset: 0,
swipeDragging: false,
occupancyUniverses: [],
selectedUniverseFixtures: [],
selectedUniverseLabel: 'A',
floatingGroup: null,
floatingVisible: false,
floatingClosing: false,
floatingStyle: '',
floatingSwipeOffset: 0,
floatingSwipeDragging: false,
pendingChange: null,
pendingChangeClosing: false,
removedDetailsExpanded: false,
fixtureAddPreview: null,
},
...sheetLifecycleMethods,
onLoad(options = {}) {
markToolLoadStage('/pages/dmx-address/dmx-address', 'onLoad')
this._nextGroupId = 1
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
this._fixtureSearchToken = 0
this._detailVisibleLimit = FIXTURE_DETAIL_PAGE_SIZE
this._fixtureDetailLoading = false
this._contextId = ''
this._workspaceRevision = null
this._scheme = null
this._undoScheme = null
this._undoExpireAt = 0
this._undoExpiryTimer = null
this._undoExpiryToken = 0
this._floatingOrigin = null
this._floatingTransitionId = 0
this._floatingTransitionTimer = null
this._floatingPositionRequestId = 0
this._floatingClosing = false
this._groupTouchStart = null
this._floatingTouchStart = null
this._touchGestureToken = 0
this._pendingScheme = null
this._pendingStartAddressText = null
this._skipNextShowReload = true
this._pageAlive = true
this._pageVisible = false
this._sheetCloseTimers = Object.create(null)
this._sheetCloseTokens = Object.create(null)
this._addressCardChipColumns = getAddressCardChipColumns(this.data.windowWidth)
this._viewportUpdateToken = 0
this._modalEpoch = 0
this._undoContextId = ''
this._undoRevision = null
this._undoGroupId = ''
this._undoGroupIndex = -1
this._preserveDeleteUndoForCommit = false
this._longPressedFixtureIndex = -1
this._suppressFixtureTapUntil = 0
const initialViewportMetrics = this.updateViewportMetrics({}, undefined, { submit: false })
let loaded
if (options.lightingLegacyRecord || options.lightingCatalogImport) {
loaded = lightingWorkspace.importLegacyLightingPreferences()
} else {
loaded = lightingWorkspace.readLightingWorkspace()
}
if (!loaded.ok) {
this.setData({ ...initialViewportMetrics, contextError: loaded.error || '读取灯光方案失败，请重试。' })
return
}
const requestedProjectId = String(options.lightingProjectId || '')
if (requestedProjectId && requestedProjectId !== loaded.contextId) {
const switched = lightingWorkspace.switchLightingContext(
requestedProjectId,
loaded.scheme,
loaded.revision,
loaded.contextId,
)
if (!switched.ok) {
this.setData({ ...initialViewportMetrics, contextError: switched.error === 'conflict'
? '方案刚刚在其他页面更新，请返回项目后重新打开。'
: switched.error || '打开项目灯光方案失败。' })
return
}
loaded = lightingWorkspace.readLightingWorkspace(requestedProjectId)
if (!loaded.ok) {
this.setData({ ...initialViewportMetrics, contextError: loaded.error || '打开项目灯光方案失败。' })
return
}
}
this.applyWorkspaceState(loaded, 'onLoad', { coldInitialization: true, initialViewportMetrics })
},
onReady() {
markToolLoadStage('/pages/dmx-address/dmx-address', 'onReady')
},
switchWorkspace(event) {
const workspace = event.currentTarget.dataset.workspace === 'plan' ? 'plan' : 'config'
if (workspace === this.data.activeWorkspace) return
if (workspace === 'plan') this.flushScheduledCalculation()
vibrate('light')
this.setData({ activeWorkspace: workspace })
},
onShow() {
this._pageVisible = true
this.resumeDeleteUndoExpiry()
const restoreFixtureSearch = Boolean(this._fixtureSearchNeedsRefresh
&& !this.data.fixturePickerClosing
&& (this.data.fixtureSearchOpen || this.data.fixtureBatchOpen))
if (!restoreFixtureSearch && this._fixtureSearchNeedsRefresh) this._fixtureSearchNeedsRefresh = false
if (restoreFixtureSearch) this._fixtureSearchNeedsRefresh = false
const applyRestoredFixtureSearch = () => {
if (restoreFixtureSearch) this.applyFixtureSearch()
}
if (this._skipNextShowReload) {
this._skipNextShowReload = false
applyRestoredFixtureSearch()
return
}
let workspaceApplied = false
if (this._contextId) {
workspaceApplied = this.refreshLightingWorkspace(restoreFixtureSearch ? {
preserveFixturePicker: true,
onFixturePickerReady: applyRestoredFixtureSearch,
} : undefined)
}
if (restoreFixtureSearch && !workspaceApplied) applyRestoredFixtureSearch()
},
updateViewportMetrics(size = {}, callback, options = {}) {
const metrics = getLightingViewportMetrics(size)
const layout = getFixtureSearchScrollMetrics(metrics, this.data.fixtureBatchOpen, this.data.batchSelectedItems?.length || 0)
const nextMetrics = { ...metrics, ...layout }
const chipColumns = getAddressCardChipColumns(metrics.windowWidth)
const chipColumnsChanged = chipColumns !== this._addressCardChipColumns
this._addressCardChipColumns = chipColumns
if (chipColumnsChanged && Array.isArray(this.data.groupCards)) {
nextMetrics.groupCards = this.data.groupCards.map((group) => ({
...group,
cardChipColumns: chipColumns,
cardFixtureChips: buildAddressCardPreviewChips(group.fixtureChips, chipColumns, group.color),
}))
}
if (options.submit !== false) this.setData(nextMetrics, callback)
return nextMetrics
},
onResize(event = {}) {
if (!this._pageAlive || !this._pageVisible) return
const resizeToken = (Number(this._viewportUpdateToken) || 0) + 1
this._viewportUpdateToken = resizeToken
const wasClosing = this._floatingClosing
this.cancelFloatingTransition()
this.resetTouchGestures(true)
if (wasClosing) {
this._floatingClosing = false
this._floatingOrigin = null
this.setData({ floatingGroup: null, floatingVisible: false, floatingClosing: false, floatingStyle: '', floatingSwipeOffset: 0, floatingSwipeDragging: false })
}
this.updateViewportMetrics(event.size || {}, () => {
if (!this._pageAlive || !this._pageVisible || resizeToken !== this._viewportUpdateToken) return
if (!wasClosing && this.data.floatingGroup) this.repositionFloatingCard(this.data.floatingGroup)
})
},
retryLightingWorkspace() {
if (!this._contextId) {
const loaded = lightingWorkspace.readLightingWorkspace()
if (loaded.ok) this.applyWorkspaceState(loaded, 'retryLoad')
else this.setData({ contextError: loaded.error || '读取灯光方案失败。' })
return
}
this.refreshLightingWorkspace()
},
onShareAppMessage() {
return {
title: '灯具编址',
path: '/pages/dmx-address/dmx-address',
}
},
applyWorkspaceState(workspace, source = 'workspace', options = {}) {
const coldInitialization = options.coldInitialization === true
const scheme = workspace.scheme || lightingWorkspace.createLightingScheme()
const calculation = lightingWorkspace.calculateScheme(scheme)
const contextChanged = Boolean(this._contextId && workspace.contextId !== this._contextId)
const previousFixtureSearchGroupIndex = Number(this.data.fixtureSearchGroupIndex)
const previousFixtureSearchGroup = previousFixtureSearchGroupIndex >= 0
? this.data.groups[previousFixtureSearchGroupIndex]
: null
const groups = restoreLightingGroups(scheme)
let preservedFixtureSearchGroupIndex = previousFixtureSearchGroupIndex
let preserveFixturePicker = Boolean(options.preserveFixturePicker
&& source === 'workspaceRefresh'
&& !contextChanged
&& this._pageAlive
&& !this.data.fixturePickerClosing
&& (this.data.fixtureSearchOpen || this.data.fixtureBatchOpen))
if (preserveFixturePicker && this.data.fixtureSearchOpen && previousFixtureSearchGroupIndex >= 0) {
const previousGroupId = previousFixtureSearchGroup?._lightingGroupId
preservedFixtureSearchGroupIndex = groups.findIndex((group) => group._lightingGroupId === previousGroupId)
if (!previousGroupId || preservedFixtureSearchGroupIndex < 0) preserveFixturePicker = false
}
this.dismissMainSheetsImmediately({
preserveFixturePicker,
preserveSaveProjectExit: options.preserveSaveProjectExit === true,
})
const gesturePatch = this.resetTouchGestures(true, { submit: !coldInitialization })
this._modalEpoch += 1
this.cancelFloatingTransition()
this.invalidateDeleteUndo()
this._pendingScheme = null
this._draftScheme = null
this._unsavedScheme = false
this.syncUnsavedLeaveGuard()
this._floatingOrigin = null
this._floatingClosing = false
if (contextChanged || !UNIVERSE_LABELS.includes(this._selectedUniverseLabel)) this._selectedUniverseLabel = 'A'
const cleanupPatch = {
pendingChange: null,
removedDetailsExpanded: false,
fixtureAddPreview: null,
floatingGroup: null,
floatingVisible: false,
floatingClosing: false,
floatingStyle: '',
swipedGroupIndex: -1,
}
if (!coldInitialization) this.setData(cleanupPatch)
this._contextId = workspace.contextId
this._workspaceRevision = workspace.revision
this._scheme = calculation.ok && calculation.valid ? calculation.scheme : scheme
this._calculationResult = calculation.result
this._selectedUniverseLabel = this._selectedUniverseLabel || 'A'
this._nextGroupId = groups.length + 1
this._checkedFixtureKeys = new Set()
if (calculation.ok && calculation.valid) {
for (const fixture of calculation.result.fixtures) {
if (this._scheme.checksById[fixture.stableId]?.fingerprint === fixtureFingerprint(fixture)) {
this._checkedFixtureKeys.add(getFixtureProgressKey(fixture))
}
}
}
this._lastCalculationSignature = JSON.stringify(scheme.preferences)
this._lastStoredPreferenceSignature = this._lastCalculationSignature
this._fixtureProgressSignature = this._lastCalculationSignature
this._selectedUniverseLabel = UNIVERSE_LABELS.includes(this._selectedUniverseLabel)
? this._selectedUniverseLabel
: 'A'
const contextList = lightingWorkspace.getLightingContexts()
let currentFavorite = false
if (coldInitialization && contextList.ok && calculation.ok && calculation.valid) {
try {
currentFavorite = Boolean(records.getFavoriteByPayload({
module: 'dmxAddress',
preferences: buildPreferences({
groups,
startAddressText: scheme.preferences.startAddressText || '1',
allocationMode: scheme.preferences.allocationMode === 'manual' ? 'manual' : 'auto',
}),
}))
} catch (error) {
// Preparing the first icon is opportunistic; the post-render sync below
// remains authoritative and preserves its existing failure behavior.
}
}
const contextRows = contextList.ok ? contextList.rows : []
const projectSaveRows = contextRows.filter((item) => !item.temporary && !item.orphan)
const contextIndex = Math.max(0, contextRows.findIndex((item) => item.id === workspace.contextId))
const pageView = this.buildPageViewData(this._calculationResult, groups, this._scheme)
this.setMeasuredResultData({
...(coldInitialization ? {
...options.initialViewportMetrics,
...gesturePatch,
...cleanupPatch,
editorDirty: false,
currentFavorite,
} : {}),
...pageView,
groups,
startAddressText: scheme.preferences.startAddressText || '1',
allocationMode: scheme.preferences.allocationMode === 'manual' ? 'manual' : 'auto',
allocationModeIndex: scheme.preferences.allocationMode === 'manual' ? 1 : 0,
startAddressDisplay: Number.isInteger(Number(scheme.preferences.startAddressText))
? String(Number(scheme.preferences.startAddressText)).padStart(3, '0')
: String(scheme.preferences.startAddressText || ''),
contextRows,
projectSaveRows,
contextIndex,
contextName: contextRows[contextIndex]?.name || (workspace.contextId === 'temporary' ? '临时设置' : '项目'),
currentContextTemporary: workspace.contextId === lightingWorkspace.TEMPORARY_CONTEXT_ID,
contextError: contextList.ok ? '' : contextList.error,
...(preserveFixturePicker && this.data.fixtureSearchOpen ? {
fixtureSearchGroupIndex: preservedFixtureSearchGroupIndex,
fixtureSearchSelectedModel: groups[preservedFixtureSearchGroupIndex]?.fixtureModel || '',
} : {}),
}, { source }, () => {
if (coldInitialization && !this._pageAlive) return
this.syncFavorite()
if (preserveFixturePicker && typeof options.onFixturePickerReady === 'function') options.onFixturePickerReady()
})
},
buildPageViewData(result, groups = this.data.groups, scheme = this._scheme) {
const validResult = result?.valid ? result : null
const cardChipColumns = this._addressCardChipColumns || getAddressCardChipColumns(this.data.windowWidth)
const groupCards = groups.map((group, index) => {
const calculated = validResult?.groups?.find((item) => item.stableId === group._lightingGroupId)
const fixture = stageLightingProductIndex.get(group.fixtureModel)
const fixtures = (calculated?.fixtures || []).map((item) => ({
...item,
endAddressText: endAddressText(item),
checked: scheme?.checksById?.[item.stableId]?.fingerprint === fixtureFingerprint(item),
channelGuideAvailable: fixture ? CHANNEL_GUIDE_FIXTURE_MODELS.has(fixture.model) : false,
}))
const checkedCount = fixtures.filter((item) => item.checked).length
return {
...group,
number: index + 1,
groupIndex: index,
color: LIGHTING_GROUP_COLORS[index % LIGHTING_GROUP_COLORS.length],
chipTint: getFixtureTint(index),
spritePosition: `${getFixtureSpriteIndex(fixture || { name: group.name }) * 50}%`,
spriteIndex: getFixtureSpriteIndex(fixture || { name: group.name }),
spriteOffset: `${-(getFixtureSpriteIndex(fixture || { name: group.name }) * 100 / 3)}%`,
primaryName: getFixtureDisplayName(fixture, group.name || '历史灯具'),
modelName: fixture?.model || '',
modelLine: fixture ? `${fixture.name} ${fixture.model}` : group.name || '历史自定义灯具',
rangeText: getFixtureRange(fixtures),
fixtureCountValue: Number(group.fixtureCount) || 0,
checkedCount,
hasChannelGuide: fixtures.some((item) => item.channelGuideAvailable),
fixtureChips: fixtures,
cardChipColumns,
cardFixtureChips: buildAddressCardPreviewChips(fixtures, cardChipColumns, LIGHTING_GROUP_COLORS[index % LIGHTING_GROUP_COLORS.length]),
calculatedGroup: calculated || null,
}
})
const occupancyUniverses = validResult
? buildOccupancyUniverses(validResult, this._selectedUniverseLabel)
: UNIVERSE_LABELS.map((label) => ({
label,
selected: label === this._selectedUniverseLabel,
occupiedChannels: 0,
occupiedText: '0 / 512',
usagePercent: 0,
usageText: '0 / 512 CH',
segments: [],
fixtures: [],
}))
const selectedUniverse = occupancyUniverses.find((item) => item.label === this._selectedUniverseLabel)
const selectedOccupancyUniverse = selectedUniverse || occupancyUniverses[0]
const selectedUniverseFixtures = (selectedUniverse?.fixtures || []).map((item) => {
const checked = scheme?.checksById?.[item.stableId]?.fingerprint === fixtureFingerprint(item)
return { ...item, checked }
})
return {
result: this.buildCurrentResultView(result),
groupCards,
occupancyUniverses,
selectedUniverseFixtures,
selectedUniverseLabel: this._selectedUniverseLabel,
selectedOccupancyUniverse,
selectedUniverseIndex: UNIVERSE_LABELS.indexOf(this._selectedUniverseLabel),
nextAvailableAddress: validResult?.nextText || '—',
}
},
buildSchemeFromState(state) {
const preferences = buildPreferences(state)
const source = this._draftScheme || this._scheme || lightingWorkspace.createLightingScheme(preferences)
const groupIds = state.groups.map((group) => group._lightingGroupId || makeStableId('group'))
const fixtureIdsByGroup = { ...(source.fixtureIdsByGroup || {}) }
groupIds.forEach((id) => {
if (!Array.isArray(fixtureIdsByGroup[id])) fixtureIdsByGroup[id] = []
})
return {
...source,
version: 2,
preferences,
groupIds,
fixtureIdsByGroup,
checksById: { ...(source.checksById || {}) },
}
},
refreshLightingWorkspace(options = {}) {
const latest = lightingWorkspace.readLightingWorkspace(this._contextId)
if (!latest.ok) {
this.setData({ contextError: latest.error || '读取灯光方案失败。' })
return false
}
if (this._unsavedScheme && this._draftScheme) {
const contextList = lightingWorkspace.getLightingContexts()
const contextIndex = contextList.ok
? Math.max(0, contextList.rows.findIndex((item) => item.id === this._contextId))
: this.data.contextIndex
this.setData({
contextRows: contextList.ok ? contextList.rows : this.data.contextRows,
contextIndex,
contextError: latest.revision === this._workspaceRevision
? '保存未完成，当前草稿仍保留。点击重试保存后继续。'
: '保存版本已变化，未保存草稿仍保留；请先重试保存。',
saveRetryAvailable: true,
})
return false
}
if (latest.revision !== this._workspaceRevision
|| JSON.stringify(latest.scheme) !== JSON.stringify(this._scheme)) {
this.applyWorkspaceState(latest, 'workspaceRefresh', options)
return true
}
const contextList = lightingWorkspace.getLightingContexts()
if (contextList.ok) {
const contextIndex = Math.max(0, contextList.rows.findIndex((item) => item.id === this._contextId))
this.setData({ contextRows: contextList.rows, contextIndex, contextError: '' })
}
return false
},
onLightingContextChange(event) {
const row = this.data.contextRows[Number(event.detail.value)]
if (!row || row.id === this._contextId) return
if (this._unsavedScheme) {
const retried = this.retryUnsavedScheme()
if (!retried) return
}
const switched = lightingWorkspace.switchLightingContext(
row.id,
this._scheme,
this._workspaceRevision,
this._contextId,
)
if (!switched.ok) {
wx.showToast({ title: switched.error === 'conflict' ? '方案已更新，请重试切换' : switched.error, icon: 'none' })
this.refreshLightingWorkspace()
return
}
const next = lightingWorkspace.readLightingWorkspace(row.id)
if (!next.ok) {
this.setData({ contextError: next.error || '切换方案失败。' })
return
}
this._selectedUniverseLabel = 'A'
this.applyWorkspaceState(next, 'switchContext')
},
onSaveNewProjectToggle() {
if (this.data.saveProjectClosing) return
if (this.data.showSaveNewProject) return this.onUserCloseSaveProjectDialog()
this.openSheetModal('saveProject', 'saveProjectClosing')
this.setData({
showSaveNewProject: true,
showNewProjectNameInput: false,
projectSaveError: '',
newProjectName: '',
})
},
closeSaveProjectDialog() {
this.cancelSheetClose('saveProject', 'saveProjectClosing')
this.setData({ showSaveNewProject: false, saveProjectClosing: false, showNewProjectNameInput: false, projectSaveError: '' })
},
onUserCloseSaveProjectDialog() {
if (!this.data.showSaveNewProject || this.data.saveProjectClosing) return
this.beginSheetClose('saveProject', 'saveProjectClosing', () => this.closeSaveProjectDialog())
},
onNewProjectNameEntry() {
if (this.data.saveProjectClosing) return
this.setData({ showNewProjectNameInput: true, projectSaveError: '' })
},
onSaveToExistingProject(event) {
if (this.data.saveProjectClosing) return
const projectId = String(event.currentTarget.dataset.projectId || '')
if (!projectId || !this._scheme || !this._calculationResult?.valid) return
this._pendingProjectSave = { projectId, replace: false, created: false }
this.setData({ pendingProjectSaveId: projectId })
this.performLightingProjectSave(projectId, false)
},
onProjectNameInput(event) {
if (this.data.saveProjectClosing) return
this.setData({ newProjectName: event.detail.value, projectSaveError: '' })
},
saveLightingAsNewProject() {
if (this.data.saveProjectClosing) return
const name = String(this.data.newProjectName || '').trim()
if (!name) {
this.setData({ projectSaveError: '请输入项目名称。' })
return
}
if (!this._scheme || !this._calculationResult?.valid) {
this.setData({ projectSaveError: '请先完成有效编址。' })
return
}
const existing = records.getProjects().find((project) => project.name === name)
if (existing) {
const modalToken = this.captureModalToken()
wx.showModal({
title: '项目已存在',
content: `“${existing.name}”已有灯光方案，替换前会保留可恢复备份。`,
confirmText: '替换并保存',
success: ({ confirm }) => {
if (!this.isModalTokenCurrent(modalToken)) return
if (confirm) {
this._pendingProjectSave = { projectId: existing.id, replace: true }
this.setData({ pendingProjectSaveId: existing.id })
this.performLightingProjectSave(existing.id, true)
}
},
})
return
}
const project = records.createProject(name)
if (!project) {
this.setData({ projectSaveError: '创建项目失败，请检查项目列表后重试。' })
return
}
this._pendingProjectSave = { projectId: project.id, replace: false, created: true }
this.setData({ pendingProjectSaveId: project.id })
this.performLightingProjectSave(project.id, false)
},
performLightingProjectSave(projectId, replace) {
this.setData({ projectSaveBusy: true, projectSaveError: '' })
const current = lightingWorkspace.readLightingWorkspace(projectId)
if (!current.ok) {
const createdProject = this._pendingProjectSave?.projectId === projectId && this._pendingProjectSave.created
this.setData({
projectSaveBusy: false,
projectSaveError: createdProject
? '项目已创建，灯光方案尚未保存；临时方案仍保留，请重试。'
: current.error || '读取目标项目失败，请重试。',
})
return
}
const saved = lightingWorkspace.saveLightingToProject(projectId, this._scheme, {
replace,
expectedRevision: current.revision,
})
if (!saved.ok) {
if (saved.error === 'exists' && !replace) {
this.setData({ projectSaveBusy: false, projectSaveError: '' })
const modalToken = this.captureModalToken()
wx.showModal({
title: '替换灯光方案？',
content: '当前项目已有独立灯光方案。替换前会保留可恢复备份。',
confirmText: '备份并替换',
success: ({ confirm }) => {
if (!this.isModalTokenCurrent(modalToken)) return
if (confirm) {
this._pendingProjectSave = { projectId, replace: true }
this.performLightingProjectSave(projectId, true)
} else {
this._pendingProjectSave = null
this.setData({ pendingProjectSaveId: '' })
}
},
})
return
}
const createdProject = this._pendingProjectSave?.projectId === projectId && this._pendingProjectSave.created
this.setData({
projectSaveBusy: false,
projectSaveError: createdProject
? '项目已创建，灯光方案尚未保存；临时方案仍保留，请重试。'
: saved.error === 'conflict'
? '项目方案刚刚更新，请刷新后重试。'
: saved.error || '保存失败，临时方案仍保留，请重试。',
})
return
}
const loaded = lightingWorkspace.readLightingWorkspace(projectId)
if (!loaded.ok) {
this.setData({ projectSaveBusy: false, projectSaveError: loaded.error || '项目已保存，但读取确认失败。' })
return
}
this.setData({ projectSaveBusy: false })
this._pendingProjectSave = null
this.applyWorkspaceState(loaded, 'saveProject', { preserveSaveProjectExit: true })
this.beginSheetClose('saveProject', 'saveProjectClosing', () => this.closeSaveProjectDialog())
if (isPageContextCurrent(this)) vibrate('medium')
wx.showToast({ title: '灯光方案已保存', icon: 'success' })
},
retryUnsavedScheme() {
if (!this._draftScheme || !this._contextId) return false
const saved = lightingWorkspace.saveLightingScheme(this._contextId, this._draftScheme, this._workspaceRevision)
if (!saved.ok) {
this.setData({ contextError: saved.error === 'conflict' ? '方案已在其他页面更新，请重新加载。' : saved.error })
return false
}
this._scheme = saved.scheme
this._workspaceRevision = saved.revision
if (this._undoScheme && this._undoContextId === this._contextId) this._undoRevision = saved.revision
this._draftScheme = null
this._unsavedScheme = false
const calculation = lightingWorkspace.calculateScheme(saved.scheme)
if (calculation.ok && calculation.valid) {
const groups = restoreLightingGroups(saved.scheme)
this._calculationResult = calculation.result
this._lastCalculationSignature = JSON.stringify(saved.scheme.preferences)
this._fixtureProgressSignature = this._lastCalculationSignature
this._checkedFixtureKeys = new Set()
for (const fixture of calculation.result.fixtures) {
if (saved.scheme.checksById[fixture.stableId]?.fingerprint === fixtureFingerprint(fixture)) {
this._checkedFixtureKeys.add(getFixtureProgressKey(fixture))
}
}
this._nextGroupId = groups.length + 1
const pageView = this.buildPageViewData(calculation.result, groups, saved.scheme)
this.setMeasuredResultData({
groups,
...pageView,
startAddressText: saved.scheme.preferences.startAddressText || '1',
startAddressDisplay: Number.isInteger(Number(saved.scheme.preferences.startAddressText))
? String(Number(saved.scheme.preferences.startAddressText)).padStart(3, '0')
: String(saved.scheme.preferences.startAddressText || ''),
allocationMode: saved.scheme.preferences.allocationMode === 'manual' ? 'manual' : 'auto',
allocationModeIndex: saved.scheme.preferences.allocationMode === 'manual' ? 1 : 0,
contextError: '',
saveRetryAvailable: false,
}, { source: 'retryScheme' }, () => this.syncFavorite())
}
this.syncUnsavedLeaveGuard()
this.setData({ contextError: '', saveRetryAvailable: false })
if (isPageContextCurrent(this)) vibrate('medium')
return true
},
syncUnsavedLeaveGuard() {
if (this._unsavedScheme) {
wx.enableAlertBeforeUnload?.({ message: '灯光方案尚未保存，离开可能丢失修改。' })
} else {
wx.disableAlertBeforeUnload?.()
}
},
prepareToLeavePage() {
this.flushScheduledCalculation()
if (!this._unsavedScheme) return true
if (this.retryUnsavedScheme()) return true
this.setData({
saveRetryAvailable: true,
contextError: '保存未完成，当前草稿仍保留；重试保存成功后再离开。',
})
wx.showToast({ title: '保存未完成，请重试后再离开', icon: 'none' })
return false
},
retryProjectSave() {
if (this.data.saveProjectClosing) return
if (!this._pendingProjectSave) return
this.performLightingProjectSave(
this._pendingProjectSave.projectId,
this._pendingProjectSave.replace,
)
},
onHide() {
this._pageVisible = false
this._viewportUpdateToken += 1
this._modalEpoch += 1
this.resetTouchGestures(true)
this.pauseDeleteUndoExpiry()
this.cancelFloatingTransition()
this._floatingClosing = false
this._floatingOrigin = null
if (this.data.floatingGroup || this.data.floatingVisible || this.data.floatingClosing) {
this.setData({ floatingGroup: null, floatingVisible: false, floatingClosing: false, floatingStyle: '', floatingSwipeOffset: 0, floatingSwipeDragging: false })
}
this.flushScheduledCalculation()
this.flushFixtureProgressWrite()
const preserveFixturePicker = !this.data.fixturePickerClosing
&& Boolean(this.data.fixtureSearchOpen || this.data.fixtureBatchOpen)
this.cancelFixtureSearch(preserveFixturePicker)
this.dismissMainSheetsImmediately({ preserveFixturePicker })
},
onUnload() {
this._pageAlive = false
this._pageVisible = false
this.clearAllSheetCloseTimers()
this._viewportUpdateToken += 1
this._modalEpoch += 1
this.resetTouchGestures(true)
this._floatingClosing = false
this._floatingOrigin = null
wx.disableAlertBeforeUnload?.()
this.pauseDeleteUndoExpiry()
this._undoExpiryToken += 1
this.cancelFloatingTransition()
this.flushScheduledCalculation()
this.flushFixtureProgressWrite()
this.cancelFixtureSearch()
this._fixtureDetailLoading = false
cancelResultReportGeneration(this)
printPerformanceSummary('DMX/')
},
captureModalToken() {
return {
epoch: this._modalEpoch,
contextId: this._contextId,
revision: this._workspaceRevision,
}
},
isModalTokenCurrent(token) {
if (!token || !this._pageAlive || !this._pageVisible
|| token.epoch !== this._modalEpoch
|| token.contextId !== this._contextId
|| token.revision !== this._workspaceRevision) return false
const current = lightingWorkspace.readLightingWorkspace(token.contextId)
return Boolean(current.ok && current.revision === token.revision)
},
invalidateDeleteUndo() {
clearTimeout(this._undoExpiryTimer)
this._undoExpiryTimer = null
this._undoExpireAt = 0
this._undoExpiryToken += 1
this._undoScheme = null
this._undoContextId = ''
this._undoRevision = null
this._undoGroupId = ''
this._undoGroupIndex = -1
this._preserveDeleteUndoForCommit = false
if (this.data.undoDeleteAvailable || this.data.undoDeleteText) {
this.setData({ undoDeleteAvailable: false, undoDeleteText: '' })
}
},
startDeleteUndoExpiry() {
this.pauseDeleteUndoExpiry()
this._undoExpiryToken += 1
this._undoExpireAt = Date.now() + 7000
this.resumeDeleteUndoExpiry()
},
pauseDeleteUndoExpiry() {
if (this._undoExpiryTimer) clearTimeout(this._undoExpiryTimer)
this._undoExpiryTimer = null
},
resumeDeleteUndoExpiry() {
if (!this._undoScheme || !this._undoExpireAt || !this._pageAlive || !this._pageVisible) return
if (this._undoExpiryTimer) return
const token = this._undoExpiryToken
const remaining = this._undoExpireAt - Date.now()
if (remaining <= 0) {
this.invalidateDeleteUndo()
return
}
this._undoExpiryTimer = setTimeout(() => {
this._undoExpiryTimer = null
if (!this._pageAlive || !this._pageVisible || token !== this._undoExpiryToken) return
if (Date.now() < this._undoExpireAt) {
this.resumeDeleteUndoExpiry()
return
}
this.invalidateDeleteUndo()
}, remaining)
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
const value = event.detail.value
if (key === 'startAddressText') {
this._pendingStartAddressText = value
this.setData({ startAddressDisplay: value })
return
}
this.setData({ [key]: value }, () => this.scheduleCalculation())
},
onAllocationModePickerChange(event) {
const index = Number(event.detail.value)
if (![0, 1].includes(index)) return
this.switchAllocationMode({ currentTarget: { dataset: { mode: index === 1 ? 'manual' : 'auto' } } })
},
onSelectedUniverseChange(event) {
const index = Number(event.detail.value)
const label = UNIVERSE_LABELS[index]
if (!label || label === this._selectedUniverseLabel) return
this._selectedUniverseLabel = label
this.resetFixtureDetailLimit()
this.setMeasuredResultData(this.buildPageViewData(this._calculationResult, this.data.groups, this._scheme), { source: 'selectUniverse' })
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
const allocationModeIndex = allocationMode === 'manual' ? 1 : 0
const candidate = this.buildSchemeFromState({ ...this.data, allocationMode, groups })
this.buildPendingPreview(candidate, {
kind: 'allocationMode',
title: '确认切换编址方式',
allocationMode,
allocationModeIndex,
allocationModeLabel: this.data.allocationModeOptions[allocationModeIndex],
})
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
const candidate = this.buildSchemeFromState({ ...this.data, groups })
this.buildPendingPreview(candidate, {
kind: 'groupUniverse',
title: '确认调整目标域',
groupIndex: index,
groupId: this.data.groups[index]._lightingGroupId,
targetUniverse,
})
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
onFieldBlur(event) {
const key = event?.currentTarget?.dataset?.key
if (key === 'startAddressText' && this._pendingStartAddressText !== null) {
const startAddressText = this._pendingStartAddressText
this._pendingStartAddressText = null
if (String(startAddressText) === String(this.data.startAddressText)) {
this.setData({ startAddressDisplay: String(Number(this.data.startAddressText)).padStart(3, '0') })
return
}
const candidate = this.buildSchemeFromState({ ...this.data, startAddressText })
this.buildPendingPreview(candidate, {
kind: 'startAddress',
title: '确认调整起始地址',
startAddressText,
})
return
}
this.flushScheduledCalculation()
},
openGroupEditor(event) { const index = Number(event.currentTarget.dataset.index); if (!Number.isInteger(index) || !this.data.groups[index]) return; vibrate('light'); this.setData({ groupEditorOpen: true, groupEditorIndex: index }) },
closeGroupEditor() { if (!this.data.groupEditorOpen) return; this.flushScheduledCalculation(); this.setData({ groupEditorOpen: false, groupEditorIndex: -1 }) },
finishGroupEditor() { this.closeGroupEditor() },
removeGroupFromEditor(event) { const index = Number(event.currentTarget.dataset.index); if (!Number.isInteger(index)) return; this.closeGroupEditor(); this.removeGroup(event) },
...createFixturePickerMethods({
...fixtureCatalog,
stageLightingProductIndex,
createGroup,
makeStableId,
getFixtureSearchScrollMetrics,
vibrate,
setTimeout: (...args) => setTimeout(...args),
clearTimeout: (...args) => clearTimeout(...args),
now: () => Date.now(),
}),
stopPropagation() {},
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
openBatchFixtureSearch() {
this.cancelFixtureSearch()
this.resetFixturePicker('batch', { fixtureSearchResults: decorateBatchRows(DEFAULT_FIXTURE_SEARCH.rows) })
},
toggleBatchFixture(event) {
if (this.data.fixturePickerClosing) return
const model = event.currentTarget.dataset.model
const fixture = stageLightingProductIndex.get(model)
if (!fixture || !fixture.channelModes?.length) return
const current = this.data.batchSelectedItems
const existing = current.find((item) => item.model === model)
const batchSelectedItems = existing ? current.filter((item) => item.model !== model) : [...current, { model, quantity: 1 }]
const layout = getFixtureSearchScrollMetrics(this.data, true, batchSelectedItems.length)
vibrate('light')
this.setData({
batchSelectedItems,
batchSelectedTotal: batchSelectedItems.reduce((sum, item) => sum + item.quantity, 0),
fixtureSearchResults: decorateBatchRows(this.data.fixtureSearchResults, batchSelectedItems),
...layout,
})
},
adjustBatchQuantity(event) {
if (this.data.fixturePickerClosing) return
const model = event.currentTarget.dataset.model
const delta = Number(event.currentTarget.dataset.delta)
if (!model || !Number.isFinite(delta)) return
const batchSelectedItems = this.data.batchSelectedItems.map((item) => item.model === model ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item)
this.setData({ batchSelectedItems, batchSelectedTotal: batchSelectedItems.reduce((sum, item) => sum + item.quantity, 0) })
},
confirmBatchAdd() {
if (this.data.fixturePickerClosing) return
const selectedItems = this.data.batchSelectedItems
if (!selectedItems.length) return
const groups = this.data.groups.map((group) => ({ ...group }))
const skipped = []
let changed = false
selectedItems.forEach((item) => {
const existingIndex = groups.findIndex((group) => group.fixtureSource === 'library' && group.fixtureModel === item.model)
if (existingIndex >= 0) {
const group = groups[existingIndex]
groups[existingIndex] = {
...group,
fixtureCount: String(Number(group.fixtureCount) + item.quantity),
}
changed = true
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
changed = true
this._nextGroupId += 1
})
this.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => this.closeFixturePicker())
if (skipped.length) wx.showToast({ title: `最多 ${MAX_GROUPS} 组，已跳过 ${skipped.length} 款`, icon: 'none' })
this.commitCalculation({ groups, activeWorkspace: 'config' })
if (changed && isPageContextCurrent(this)) vibrate('medium')
},
removeGroup(event) {
const index = Number(event.currentTarget.dataset.index)
if (!Number.isInteger(index)) return
return this.requestDeleteGroup(event)
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
const preserveDeleteUndo = this._preserveDeleteUndoForCommit
this._preserveDeleteUndoForCommit = false
if (!preserveDeleteUndo) this.invalidateDeleteUndo()
const previousDraft = this._draftScheme
const hadUnsavedDraft = Boolean(this._unsavedScheme && previousDraft)
const state = { ...this.data, ...changes }
const candidate = this.buildSchemeFromState(state)
const calculation = lightingWorkspace.calculateScheme(candidate)
const result = calculation.result || { valid: false, error: calculation.error || '方案暂时无法计算。' }
const preferences = candidate.preferences
const calculationSignature = JSON.stringify(preferences)
if (calculation.valid) {
const sameScheme = JSON.stringify(calculation.scheme) === JSON.stringify(this._scheme)
if (sameScheme && calculationSignature === this._lastCalculationSignature) {
this._calculationResult = result
const viewPatch = {
...changes,
...this.buildPageViewData(result, state.groups, calculation.scheme),
contextError: '',
}
if (pageDataPatchChangesData(this.data, viewPatch)) {
this.setMeasuredResultData(viewPatch, { source: 'calculationUnchanged' })
}
return result
}
const saved = lightingWorkspace.saveLightingScheme(this._contextId, calculation.scheme, this._workspaceRevision)
if (saved.ok) {
this._scheme = saved.scheme
this._workspaceRevision = saved.revision
this._draftScheme = null
this._unsavedScheme = false
this.setData({ saveRetryAvailable: false })
this._lastStoredPreferenceSignature = calculationSignature
this.syncUnsavedLeaveGuard()
} else {
this._draftScheme = calculation.scheme
this._unsavedScheme = true
this.setData({ saveRetryAvailable: true })
this.syncUnsavedLeaveGuard()
}
} else {
if (hadUnsavedDraft) {
this._draftScheme = previousDraft
this._unsavedScheme = true
this._scheme = previousDraft
this.setData({ saveRetryAvailable: true })
} else {
this._draftScheme = null
this._unsavedScheme = false
this.setData({ saveRetryAvailable: false })
this.syncUnsavedLeaveGuard()
}
}
this._calculationResult = result
if (calculation.valid || !hadUnsavedDraft) {
this._lastCalculationSignature = calculationSignature
this._fixtureProgressSignature = calculationSignature
this._checkedFixtureKeys = new Set()
}
if (calculation.valid) {
for (const fixture of result.fixtures) {
if (calculation.scheme.checksById[fixture.stableId]?.fingerprint === fixtureFingerprint(fixture)) {
this._checkedFixtureKeys.add(getFixtureProgressKey(fixture))
}
}
this._scheme = this._draftScheme || calculation.scheme
}
this.resetFixtureDetailLimit()
const displayGroups = calculation.valid ? restoreLightingGroups(this._scheme) : state.groups
if (calculation.valid) this._nextGroupId = displayGroups.length + 1
const resultReportChanges = resetStaleResultReport(
this,
this.buildResultReportRecord(result, preferences),
)
this.setMeasuredResultData({
...changes,
groups: displayGroups,
...this.buildPageViewData(result, displayGroups, this._scheme || candidate),
...resultReportChanges,
contextError: !calculation.valid
? result.error || calculation.error || '方案暂时无法计算。'
: this._unsavedScheme ? '保存未完成，当前草稿仍保留。点击重试保存后继续。' : '',
}, { source: 'calculation' }, () => {
this.syncFavorite()
})
return result
},
buildPendingPreview(candidate, descriptor = {}) {
const calculation = lightingWorkspace.calculateScheme(candidate)
const beforeResult = this._calculationResult?.valid ? this._calculationResult : { groups: [] }
const afterResult = calculation.valid ? calculation.result : { groups: [] }
const beforeGroups = beforeResult.groups || []
const afterGroups = afterResult.groups || []
const groupIds = [...new Set([
...beforeGroups.map((group) => String(group.stableId || group.id)),
...afterGroups.map((group) => String(group.stableId || group.id)),
])]
const affectedGroups = []
const removedFixtures = []
groupIds.forEach((groupId) => {
const beforeGroup = beforeGroups.find((group) => String(group.stableId || group.id) === groupId)
const afterGroup = afterGroups.find((group) => String(group.stableId || group.id) === groupId)
const beforeFixtures = beforeGroup?.fixtures || []
const afterFixtures = afterGroup?.fixtures || []
const afterIds = new Set(afterFixtures.map((fixture) => String(fixture.stableId)))
const beforeIds = new Set(beforeFixtures.map((fixture) => String(fixture.stableId)))
const removed = beforeFixtures.filter((fixture) => !afterIds.has(String(fixture.stableId)))
const added = afterFixtures.filter((fixture) => !beforeIds.has(String(fixture.stableId)))
const afterById = new Map(afterFixtures.map((fixture) => [String(fixture.stableId), fixture]))
const changedCount = beforeFixtures.filter((fixture) => {
const next = afterById.get(String(fixture.stableId))
return next && fixtureFingerprint(fixture) !== fixtureFingerprint(next)
}).length
const invalidatedCheckCount = beforeFixtures.filter((fixture) => {
const checked = this._scheme?.checksById?.[fixture.stableId]
if (!checked || checked.fingerprint !== fixtureFingerprint(fixture)) return false
const next = afterById.get(String(fixture.stableId))
return !next || checked.fingerprint !== fixtureFingerprint(next)
}).length
const beforeRange = getFixtureRange(beforeFixtures)
const afterRange = getFixtureRange(afterFixtures)
const beforeUniverse = beforeGroup?.targetUniverse || beforeFixtures[0]?.universeLabel || ''
const afterUniverse = afterGroup?.targetUniverse || afterFixtures[0]?.universeLabel || ''
const groupChanged = !beforeGroup || !afterGroup
|| beforeGroup.fixtureModel !== afterGroup.fixtureModel
|| Number(beforeGroup.channelCount) !== Number(afterGroup.channelCount)
|| Number(beforeGroup.fixtureCount) !== Number(afterGroup.fixtureCount)
|| beforeUniverse !== afterUniverse
const globalModeChanged = beforeResult.allocationMode !== afterResult.allocationMode
const isAffected = groupChanged || beforeRange !== afterRange || removed.length || added.length
|| changedCount || globalModeChanged || groupId === String(descriptor.groupId || '')
if (!isAffected) return
const groupName = afterGroup?.name || beforeGroup?.name || '灯具组'
affectedGroups.push({
id: groupId,
name: groupName,
beforeRange: beforeRange || '—',
afterRange: afterRange || '—',
beforeUniverse: beforeUniverse ? `${beforeUniverse}域` : '—',
afterUniverse: afterUniverse ? `${afterUniverse}域` : '—',
beforeCount: beforeFixtures.length,
afterCount: afterFixtures.length,
addedCount: added.length,
removedCount: removed.length,
changedCount,
invalidatedCheckCount,
})
removed.forEach((fixture) => removedFixtures.push({
stableId: fixture.stableId,
addressText: fixture.addressText || `${fixture.universeLabel}${String(fixture.startAddress).padStart(3, '0')}`,
groupName,
fixtureIndex: fixture.fixtureIndex || '',
placementText: getFixturePlacementLabel(this._scheme?.layout, fixture.stableId),
}))
})
const primaryRow = affectedGroups.find((group) => group.id === String(descriptor.groupId || '')) || affectedGroups[0]
const beforeRange = primaryRow?.beforeRange
|| (this._calculationResult?.valid ? `${this._calculationResult.startText}–${this._calculationResult.endText}` : '—')
const afterRange = calculation.valid
? (primaryRow?.afterRange || `${calculation.result.startText}–${calculation.result.endText}`)
: '—'
let addPreview = null
if (descriptor.kind === 'add') {
const previewScheme = calculation.scheme || candidate
const previewGroups = restoreLightingGroups(previewScheme)
const previewCards = calculation.valid
? this.buildPageViewData(calculation.result, previewGroups, previewScheme).groupCards
: []
const card = previewCards.find((item) => item._lightingGroupId === String(descriptor.groupId || ''))
const groupIdIndex = previewScheme.groupIds?.indexOf(String(descriptor.groupId || '')) ?? -1
const groupIndex = groupIdIndex >= 0 ? groupIdIndex : Number(descriptor.groupIndex)
const fallbackGroup = previewScheme.preferences?.groups?.[Number.isInteger(groupIndex) ? groupIndex : -1]
const fixture = stageLightingProductIndex.get(descriptor.fixtureModel)
const fixtureCountValue = card?.fixtureCountValue ?? (Number(fallbackGroup?.fixtureCount ?? descriptor.quantityText) || 0)
const channelCount = Number(card?.channelCount || fallbackGroup?.channelCount || descriptor.channelCount) || 0
const colorIndex = Number.isInteger(groupIndex) && groupIndex >= 0 ? groupIndex % LIGHTING_GROUP_COLORS.length : 0
addPreview = {
primaryName: card?.primaryName || getFixtureDisplayName(fixture, descriptor.fixtureName),
modelName: card?.modelName || fixture?.model || descriptor.fixtureModel || '',
spriteOffset: card?.spriteOffset || `${-(getFixtureSpriteIndex(fixture || { name: descriptor.fixtureName }) * 100 / 3)}%`,
rangeText: card?.rangeText || '—',
fixtureCountValue,
totalChannels: calculation.valid && card
? card.fixtureChips.length * channelCount
: fixtureCountValue * channelCount,
color: card?.color || LIGHTING_GROUP_COLORS[colorIndex],
chipTint: card?.chipTint || getFixtureTint(colorIndex),
fixtureChips: card?.fixtureChips.map((fixtureChip) => ({
stableId: fixtureChip.stableId,
addressText: fixtureChip.addressText || endAddressText(fixtureChip),
})) || [],
}
}
const pendingChange = {
...descriptor,
beforeRange,
afterRange,
beforeNext: this._calculationResult?.nextText || '—',
afterNext: calculation.valid ? calculation.result.nextText : '—',
affectedGroups,
removedFixtures,
removedFixtureCount: removedFixtures.length,
removedPlacedCount: removedFixtures.filter((fixture) => fixture.placementText !== '未放置').length,
addPreview,
error: calculation.valid ? '' : calculation.error || calculation.result?.error || '请检查型号、模式和数量。',
valid: Boolean(calculation.ok && calculation.valid),
}
if (descriptor.kind === 'delete') {
const deletedGroupId = String(descriptor.groupId || '')
const deleteCard = this.data.groupCards.find((item) => item._lightingGroupId === deletedGroupId)
const deletedGroup = this.data.groups.find((item) => item._lightingGroupId === deletedGroupId)
const deletedRow = affectedGroups.find((item) => item.id === deletedGroupId)
const deleteIndex = Number.isInteger(Number(descriptor.deleteIndex)) ? Number(descriptor.deleteIndex) : 0
const colorIndex = deleteCard?.groupIndex ?? deleteIndex
const deletedFixture = stageLightingProductIndex.get(deletedGroup?.fixtureModel)
pendingChange.deletePreview = {
primaryName: deleteCard?.primaryName || getFixtureDisplayName(deletedFixture, deletedGroup?.name || '历史灯具'),
modelName: deleteCard?.modelName || deletedGroup?.fixtureModel || '',
spriteOffset: deleteCard?.spriteOffset || `${-(getFixtureSpriteIndex(deletedFixture || { name: deletedGroup?.name }) * 100 / 3)}%`,
rangeText: deletedRow?.beforeRange || deleteCard?.rangeText || '—',
universeText: deletedRow?.beforeUniverse || (deletedGroup?.targetUniverse ? `${deletedGroup.targetUniverse}域` : ''),
fixtureCountValue: Number(descriptor.deleteSummary?.fixtureCount ?? deleteCard?.fixtureCountValue ?? deletedGroup?.fixtureCount) || 0,
color: deleteCard?.color || LIGHTING_GROUP_COLORS[((colorIndex % LIGHTING_GROUP_COLORS.length) + LIGHTING_GROUP_COLORS.length) % LIGHTING_GROUP_COLORS.length],
chipTint: deleteCard?.chipTint || getFixtureTint(colorIndex),
}
pendingChange.remainingAffectedGroups = affectedGroups
.filter((item) => item.id !== deletedGroupId && item.afterCount > 0)
.map((item) => {
const card = this.data.groupCards.find((groupCard) => groupCard._lightingGroupId === item.id)
return {
...item,
primaryName: card?.primaryName || item.name || '灯具组',
modelName: card?.modelName || '',
color: card?.color || LIGHTING_GROUP_COLORS[0],
chipTint: card?.chipTint || getFixtureTint(0),
}
})
pendingChange.remainingGroupCount = calculation.valid
? afterGroups.length
: Math.max(0, Number(candidate.preferences?.groups?.length) || 0)
pendingChange.invalidatedCheckCount = pendingChange.remainingAffectedGroups.reduce((sum, item) => sum + item.invalidatedCheckCount, 0)
}
this.openSheetModal('pendingChange', 'pendingChangeClosing')
this._pendingScheme = candidate
this.setData({ pendingChange, pendingChangeClosing: false, removedDetailsExpanded: false })
},
requestGroupChange(index, changes, title = '确认调整') {
const group = this.data.groups[index]
if (!group || group.fixtureSource === 'custom') return
const groups = this.data.groups.map((item, groupIndex) => (
groupIndex === index ? { ...item, ...changes } : item
))
const candidate = this.buildSchemeFromState({ ...this.data, groups })
this.buildPendingPreview(candidate, {
kind: 'edit',
title,
groupIndex: index,
groupId: group._lightingGroupId,
quantityText: String(groups[index].fixtureCount),
channelCount: Number(groups[index].channelCount),
channelModeIndex: groups[index].channelModeIndex,
channelModes: groups[index].channelModes,
fixtureModel: groups[index].fixtureModel,
fixtureName: groups[index].fixtureName,
})
},
onCardModeChange(event) {
const index = Number(event.currentTarget.dataset.index)
const group = this.data.groups[index]
const modeIndex = Number(event.detail.value)
const channelCount = group?.channelModes[modeIndex]
if (!group || !Number.isFinite(channelCount) || Number(group.channelCount) === channelCount) return
this.requestGroupChange(index, {
channelCount: String(channelCount),
libraryChannelCount: String(channelCount),
channelModeIndex: modeIndex,
}, '确认切换通道模式')
},
onCardQuantityStep(event) {
const index = Number(event.currentTarget.dataset.index)
const delta = Number(event.currentTarget.dataset.delta)
const group = this.data.groups[index]
const quantity = Number(group?.fixtureCount) + delta
if (!group || group.fixtureSource === 'custom' || !Number.isInteger(quantity) || quantity < 1 || quantity > 200) return
this.requestGroupChange(index, { fixtureCount: String(quantity) }, '确认调整灯具数量')
},
onCardQuantityInput(event) {
const index = Number(event.currentTarget.dataset.index)
if (!Number.isInteger(index) || !this.data.groups[index]) return
this.setData({ [`groups[${index}].fixtureCount`]: event.detail.value })
},
onCardQuantityBlur(event) {
const index = Number(event.currentTarget.dataset.index)
const group = this.data.groups[index]
if (!group || group.fixtureSource !== 'library') return
const quantity = Number(event.detail.value)
const original = Number(this._scheme?.preferences?.groups?.[index]?.fixtureCount)
if (quantity === original && String(quantity) === String(event.detail.value)) return
if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
const groups = restoreLightingGroups(this._scheme)
this.setData({ groups })
wx.showToast({ title: '数量需为 1 至 200 的整数', icon: 'none' })
return
}
this.requestGroupChange(index, { fixtureCount: String(quantity) }, '确认调整灯具数量')
},
onPendingModeChange(event) {
if (this.data.pendingChangeClosing || !this._pendingScheme || !this.data.pendingChange) return
const pending = { ...this.data.pendingChange }
const modeIndex = Number(event.detail.value)
const channelCount = pending.channelModes?.[modeIndex]
if (!Number.isFinite(channelCount)) return
const candidate = JSON.parse(JSON.stringify(this._pendingScheme))
const group = candidate.preferences.groups[pending.groupIndex]
if (!group) return
group.channelCount = String(channelCount)
group.libraryChannelCount = String(channelCount)
pending.channelCount = channelCount
pending.channelModeIndex = modeIndex
this.buildPendingPreview(candidate, pending)
},
onPendingQuantityInput(event) {
if (this.data.pendingChangeClosing || !this.data.pendingChange) return
const pending = { ...this.data.pendingChange, quantityText: String(event.detail.value ?? '') }
if (!this._pendingScheme) {
this.setData({ pendingChange: pending })
return
}
const candidate = JSON.parse(JSON.stringify(this._pendingScheme))
const group = candidate.preferences.groups[pending.groupIndex]
if (!group) {
this.setData({ pendingChange: pending })
return
}
group.fixtureCount = pending.quantityText
this.buildPendingPreview(candidate, pending)
},
onPendingQuantityBlur() {
if (this.data.pendingChangeClosing || !this.data.pendingChange) return
const pending = this.data.pendingChange
const quantity = Number(pending.quantityText)
if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
this.setData({
'pendingChange.valid': false,
'pendingChange.error': '数量必须是 1 至 200 的整数。',
})
return
}
if (!this._pendingScheme) return
const candidate = JSON.parse(JSON.stringify(this._pendingScheme))
const group = candidate.preferences.groups[pending.groupIndex]
if (!group) return
group.fixtureCount = String(quantity)
pending.quantityText = String(quantity)
this.buildPendingPreview(candidate, pending)
},
cancelPendingChange(options = {}) {
const preserveVisual = Boolean(options.preserveVisual)
this.cancelSheetClose('pendingChange', 'pendingChangeClosing')
this._pendingScheme = null
this._pendingStartAddressText = null
const groups = this._scheme ? restoreLightingGroups(this._scheme) : this.data.groups
const addressText = this._scheme?.preferences?.startAddressText || '1'
this.setData({
pendingChange: preserveVisual ? this.data.pendingChange : null,
pendingChangeClosing: false,
removedDetailsExpanded: preserveVisual ? this.data.removedDetailsExpanded : false,
fixtureAddPreview: null,
groups,
swipedGroupIndex: -1,
startAddressText: addressText,
startAddressDisplay: Number.isInteger(Number(addressText)) ? String(Number(addressText)).padStart(3, '0') : String(addressText),
})
},
onUserCancelPendingChange() {
if (!this.data.pendingChange || this.data.pendingChangeClosing) return
this.cancelPendingChange({ preserveVisual: true })
this.beginSheetClose('pendingChange', 'pendingChangeClosing', () => this.finishPendingChangeClose())
},
finishPendingChangeClose() {
this.clearSheetCloseTimer('pendingChange')
this.setData({ pendingChange: null, pendingChangeClosing: false, removedDetailsExpanded: false, fixtureAddPreview: null })
},
reselectPendingFixture() {
if (this.data.pendingChangeClosing || this.data.pendingChange?.kind !== 'add') return
this.beginSheetClose('pendingChange', 'pendingChangeClosing', () => this.finishPendingChangeClose())
this._pendingScheme = null
this.cancelFixtureSearch()
this.resetFixturePicker('search', { fixtureSearchGroupIndex: -1 })
this.setData({ swipedGroupIndex: -1 })
},
toggleRemovedDetails() {
if (this.data.pendingChangeClosing || this.data.pendingChange?.kind !== 'delete') return
this.setData({ removedDetailsExpanded: !this.data.removedDetailsExpanded })
},
confirmPendingChange() {
if (this.data.pendingChangeClosing || !this._pendingScheme || !this.data.pendingChange?.valid) return
const pending = this.data.pendingChange
const kind = pending.kind
const candidate = JSON.parse(JSON.stringify(this._pendingScheme))
const candidateGroup = Number.isInteger(Number(pending.groupIndex))
? candidate.preferences.groups[Number(pending.groupIndex)]
: null
if (candidateGroup && pending.quantityText !== undefined) {
const quantity = Number(pending.quantityText)
if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
this.setData({
'pendingChange.valid': false,
'pendingChange.error': '数量必须是 1 至 200 的整数。',
})
return
}
candidateGroup.fixtureCount = String(quantity)
}
if (kind === 'startAddress') candidate.preferences.startAddressText = String(pending.startAddressText)
const deleteSaveRevision = this._workspaceRevision
if (kind === 'delete') {
const deleteIndex = Number(pending.deleteIndex)
const currentGroup = this.data.groups[deleteIndex]
if (!currentGroup || currentGroup._lightingGroupId !== pending.groupId || !this._scheme) return
pending.deleteSnapshot = JSON.parse(JSON.stringify(this._scheme))
}
const result = this.commitLightingScheme(candidate)
if (!result?.valid) return
if (kind === 'delete' && pending.deleteSnapshot) {
this._undoScheme = pending.deleteSnapshot
this._undoContextId = this._contextId
this._undoRevision = this._workspaceRevision
this._undoGroupId = pending.groupId
this._undoGroupIndex = Number(pending.deleteIndex)
this.setData({ undoDeleteAvailable: true, undoDeleteText: `已删除第 ${this._undoGroupIndex + 1} 组`, swipedGroupIndex: -1 })
this.startDeleteUndoExpiry()
}
this._pendingScheme = null
this.setData({
contextError: this._unsavedScheme ? '保存未完成，点击重试保存。' : '',
})
this.beginSheetClose('pendingChange', 'pendingChangeClosing', () => this.finishPendingChangeClose())
if (kind === 'add') wx.showToast({ title: '已添加灯组', icon: 'success' })
if (kind === 'delete') {
if (!this._unsavedScheme && this._workspaceRevision !== deleteSaveRevision) vibrate('medium')
wx.showToast({ title: '已删除灯组，可撤销', icon: 'success' })
}
},
commitLightingScheme(candidate, options = {}) {
const preserveUndo = Boolean(options.preserveDeleteUndo
&& this._undoScheme
&& this._undoContextId === this._contextId
&& this._undoRevision === this._workspaceRevision)
if (!preserveUndo) this.invalidateDeleteUndo()
const calculation = lightingWorkspace.calculateScheme(candidate)
if (!calculation.ok || !calculation.valid) {
wx.showToast({ title: calculation.error || '方案输入无效', icon: 'none' })
return calculation.result || { valid: false, error: calculation.error }
}
this.resetTouchGestures(true)
const saved = lightingWorkspace.saveLightingScheme(this._contextId, calculation.scheme, this._workspaceRevision)
const resultReportChanges = resetStaleResultReport(
this,
this.buildResultReportRecord(calculation.result, calculation.scheme.preferences),
)
if (!saved.ok) {
this._draftScheme = calculation.scheme
this._unsavedScheme = true
this.syncUnsavedLeaveGuard()
this._scheme = calculation.scheme
this._calculationResult = calculation.result
const groups = restoreLightingGroups(calculation.scheme)
const pageView = this.buildPageViewData(calculation.result, groups, calculation.scheme)
this.setData({
groups,
...pageView,
...resultReportChanges,
floatingGroup: this.data.floatingGroup
? pageView.groupCards.find((item) => item._lightingGroupId === this.data.floatingGroup._lightingGroupId) || null
: null,
startAddressText: calculation.scheme.preferences.startAddressText || '1',
startAddressDisplay: Number.isInteger(Number(calculation.scheme.preferences.startAddressText))
? String(Number(calculation.scheme.preferences.startAddressText)).padStart(3, '0')
: String(calculation.scheme.preferences.startAddressText || ''),
allocationMode: calculation.scheme.preferences.allocationMode === 'manual' ? 'manual' : 'auto',
allocationModeIndex: calculation.scheme.preferences.allocationMode === 'manual' ? 1 : 0,
saveRetryAvailable: true,
contextError: saved.error === 'conflict' ? '方案已在其他页面更新，请重新加载。' : saved.error,
})
return calculation.result
}
this._scheme = saved.scheme
this._workspaceRevision = saved.revision
if (preserveUndo) this._undoRevision = saved.revision
this._draftScheme = null
this._unsavedScheme = false
this.syncUnsavedLeaveGuard()
this._calculationResult = calculation.result
this._lastCalculationSignature = JSON.stringify(saved.scheme.preferences)
const groups = restoreLightingGroups(saved.scheme)
this._nextGroupId = groups.length + 1
this._checkedFixtureKeys = new Set()
for (const fixture of calculation.result.fixtures) {
if (saved.scheme.checksById[fixture.stableId]?.fingerprint === fixtureFingerprint(fixture)) {
this._checkedFixtureKeys.add(getFixtureProgressKey(fixture))
}
}
const pageView = this.buildPageViewData(calculation.result, groups, saved.scheme)
this.setMeasuredResultData({
groups,
...pageView,
...resultReportChanges,
floatingGroup: this.data.floatingGroup
? pageView.groupCards.find(
(item) => item._lightingGroupId === this.data.floatingGroup._lightingGroupId,
) || null
: null,
startAddressText: saved.scheme.preferences.startAddressText || '1',
startAddressDisplay: Number.isInteger(Number(saved.scheme.preferences.startAddressText))
? String(Number(saved.scheme.preferences.startAddressText)).padStart(3, '0')
: String(saved.scheme.preferences.startAddressText || ''),
allocationMode: saved.scheme.preferences.allocationMode === 'manual' ? 'manual' : 'auto',
allocationModeIndex: saved.scheme.preferences.allocationMode === 'manual' ? 1 : 0,
contextError: '',
saveRetryAvailable: false,
}, { source: 'saveScheme' }, () => this.syncFavorite())
return calculation.result
},
addGroup() {
if (this.data.groups.length >= MAX_GROUPS) {
wx.showToast({ title: `最多添加 ${MAX_GROUPS} 组`, icon: 'none' })
return
}
this.cancelFixtureSearch()
this.resetFixturePicker('search', { fixtureSearchGroupIndex: -1 })
},
requestDeleteGroup(event) {
const index = Number(event.currentTarget.dataset.index)
const card = this.data.groupCards[index]
const group = this.data.groups[index]
if (!card || !group) return
const groupId = group._lightingGroupId
const placedIds = new Set(Object.keys(this._scheme?.layout?.positionsById || {}))
const ids = new Set(this._scheme?.fixtureIdsByGroup?.[groupId] || [])
const placedCount = [...ids].filter((id) => placedIds.has(id)).length
const groups = this.data.groups.filter((item, groupIndex) => groupIndex !== index)
const candidate = this.buildSchemeFromState({ ...this.data, groups })
this.buildPendingPreview(candidate, {
kind: 'delete',
title: '确认删除灯组并重编址',
deleteIndex: index,
groupId,
deleteSummary: {
fixtureCount: card.fixtureCountValue,
checkedCount: card.checkedCount,
placedCount,
},
})
},
undoDelete() {
if (!this._undoScheme || this._undoContextId !== this._contextId) {
this.invalidateDeleteUndo()
return
}
const latest = lightingWorkspace.readLightingWorkspace(this._contextId)
if (!latest.ok || latest.revision !== this._undoRevision) {
this.invalidateDeleteUndo()
wx.showToast({ title: '方案已变化，请重新选择灯具', icon: 'none' })
return
}
const snapshot = JSON.parse(JSON.stringify(this._undoScheme))
const current = JSON.parse(JSON.stringify(this._scheme || latest.scheme))
const groupId = this._undoGroupId
const restoreIndex = Math.max(0, Math.min(this._undoGroupIndex, current.preferences.groups.length))
const snapshotIndex = snapshot.groupIds.indexOf(groupId)
if (snapshotIndex < 0) {
this.invalidateDeleteUndo()
return
}
current.preferences.groups.splice(restoreIndex, 0, snapshot.preferences.groups[snapshotIndex])
current.groupIds.splice(restoreIndex, 0, groupId)
current.fixtureIdsByGroup[groupId] = [...(snapshot.fixtureIdsByGroup[groupId] || [])]
current.checksById = { ...(current.checksById || {}) }
for (const fixtureId of current.fixtureIdsByGroup[groupId]) {
const deletedGroupCheck = snapshot.checksById?.[fixtureId]
if (deletedGroupCheck) current.checksById[fixtureId] = deletedGroupCheck
}
const currentLayout = current.layout
const snapshotLayout = snapshot.layout
if (snapshotLayout) {
const layout = JSON.parse(JSON.stringify(currentLayout || snapshotLayout))
layout.positionsById = { ...(layout.positionsById || {}) }
const rods = [
...(layout.internalRods || []),
...(layout.frontRods || []),
...(layout.legacySideRods || []),
]
const rodIds = new Set(rods.map((rod) => String(rod.id)))
const snapshotPositions = snapshotLayout.positionsById || {}
for (const fixtureId of current.fixtureIdsByGroup[groupId]) {
const position = snapshotPositions[fixtureId]
if (position?.rodId && rodIds.has(String(position.rodId))) layout.positionsById[fixtureId] = position
}
current.layout = layout
}
const restored = this.commitLightingScheme(current)
if (restored?.valid) {
this._undoScheme = null
this._undoContextId = ''
this._undoRevision = null
this._undoGroupId = ''
this._undoGroupIndex = -1
this.setData({ undoDeleteAvailable: false, undoDeleteText: '' })
}
},
toggleFixtureCheck(event) {
const stableId = event.currentTarget.dataset.stableId
const globalIndex = Number(event.currentTarget.dataset.globalIndex)
if (globalIndex === this._longPressedFixtureIndex && Date.now() < this._suppressFixtureTapUntil) return
const fixture = this._calculationResult?.fixtures?.find((item) => item.stableId === stableId)
if (!stableId || !fixture || !this._scheme) return
const scheme = JSON.parse(JSON.stringify(this._scheme))
const current = scheme.checksById[stableId]
if (current?.fingerprint === fixtureFingerprint(fixture)) delete scheme.checksById[stableId]
else scheme.checksById[stableId] = { fingerprint: fixtureFingerprint(fixture) }
this.commitLightingScheme(scheme, { preserveDeleteUndo: true })
},
clearSelectedUniverseChecks() {
const fixtures = this.data.selectedUniverseFixtures.filter((fixture) => fixture.checked)
if (!fixtures.length) return
const modalToken = this.captureModalToken()
const fixtureIds = fixtures.map((fixture) => fixture.stableId)
wx.showModal({
title: '清空地址核对',
content: `清除 ${this._selectedUniverseLabel} 域 ${fixtures.length} 台灯具的核对标记？`,
success: ({ confirm }) => {
if (!confirm || !this._scheme || !this.isModalTokenCurrent(modalToken)) return
const scheme = JSON.parse(JSON.stringify(this._scheme))
fixtureIds.forEach((id) => delete scheme.checksById[id])
this.commitLightingScheme(scheme, { preserveDeleteUndo: true })
},
})
},
...cardInteractionMethods,
onOccupancyUniverseTap(event) {
const label = event.currentTarget.dataset.label
if (!UNIVERSE_LABELS.includes(label) || label === this._selectedUniverseLabel) return
this._selectedUniverseLabel = label
const pageView = this.buildPageViewData(this._calculationResult, this.data.groups, this._scheme)
this.setData(pageView)
},
selectUniverse(event) {
const label = event.currentTarget.dataset.label
if (!UNIVERSE_LABELS.includes(label) || label === this._selectedUniverseLabel) return
this._selectedUniverseLabel = label
this.resetFixtureDetailLimit()
this.setMeasuredResultData(this.buildPageViewData(this._calculationResult, this.data.groups, this._scheme), { source: 'selectUniverse' })
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
this._longPressedFixtureIndex = globalIndex
this._suppressFixtureTapUntil = Date.now() + 450
    const { buildActualDmxChannelGuide } = getChannelGuideApi()
    const guide = buildActualDmxChannelGuide(fixture)
if (!guide) {
wx.showToast({ title: '该型号暂无已核对的通道资料', icon: 'none' })
  return
}
this._fixtureGuideFixture = fixture
this.openSheetModal('fixtureChannelGuide', 'fixtureChannelGuideClosing')
vibrate('light')
this.setData({
fixtureChannelGuide: guide,
fixtureChannelGuideDetail: null,
fixtureChannelGuideDetailExpanded: false,
fixtureChannelGuideClosing: false,
})
},
closeFixtureChannelGuide() {
this.cancelSheetClose('fixtureChannelGuide', 'fixtureChannelGuideClosing')
this._fixtureGuideFixture = null
this.setData({ fixtureChannelGuide: null, fixtureChannelGuideDetail: null, fixtureChannelGuideDetailExpanded: false, fixtureChannelGuideClosing: false })
},
onUserCloseFixtureChannelGuide() {
if (!this.data.fixtureChannelGuide || this.data.fixtureChannelGuideClosing) return
this.beginSheetClose('fixtureChannelGuide', 'fixtureChannelGuideClosing', () => this.closeFixtureChannelGuide())
},
selectFixtureChannelGuideDetail(event) {
if (this.data.fixtureChannelGuideClosing) return
const channelIndex = Number(event.currentTarget.dataset.channelIndex)
const channels = this.data.fixtureChannelGuide?.channels
if (!Array.isArray(channels) || !Number.isInteger(channelIndex) || !channels[channelIndex]) return
const channel = channels[channelIndex]
const current = this.data.fixtureChannelGuideDetail
if (this.data.fixtureChannelGuideDetailExpanded && current?.channel === channel.channel) {
this.setData({ fixtureChannelGuideDetailExpanded: false })
return
}
const detail = {
...channel,
ranges: channel.ranges.map((range) => ({ ...range })),
}
this.setData({ fixtureChannelGuideDetail: detail, fixtureChannelGuideDetailExpanded: true })
},
closeFixtureChannelGuideDetail() {
if (this.data.fixtureChannelGuideClosing) return
this.setData({ fixtureChannelGuideDetailExpanded: false })
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
if (!this.prepareToLeavePage()) return
if (!this._calculationResult?.valid) {
wx.showToast({ title: '请先完成有效编址', icon: 'none' })
return
}
this.flushFixtureProgressWrite()
wx.navigateTo({ url: `/pages/dmx-layout/dmx-layout?lightingContextId=${encodeURIComponent(this._contextId)}` })
},
onHeaderBack() {
if (!this.prepareToLeavePage()) return
wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) })
},
onOpenCombinedExport() {
if (!this.prepareToLeavePage()) return
if (!this._calculationResult?.valid) {
wx.showToast({ title: '请先完成有效编址', icon: 'none' })
return
}
this.flushFixtureProgressWrite()
wx.navigateTo({
url: `/pages/dmx-layout/dmx-layout?lightingContextId=${encodeURIComponent(this._contextId)}&openExport=1`,
})
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
const modalToken = this.captureModalToken()
wx.showModal({
title: '清空地址设置标记',
content: result.viewMode === 'group'
? '确定清空当前灯具组的地址已设置标记吗？'
: `确定清空 ${result.selectedUniverse.label} 域的地址已设置标记吗？`,
success: ({ confirm }) => {
if (!confirm || !this.isModalTokenCurrent(modalToken)) return
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
if (result?.valid && !result.groups?.length) {
return {
...result,
valid: true,
empty: true,
viewMode: 'universe',
allocationMode: this.data.allocationMode,
totalGroups: 0,
totalFixtures: 0,
totalChannels: 0,
warnings: [],
universes: [],
groupViews: [],
selectedUniverse: null,
selectedGroup: null,
}
}
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

...resultReportUiMethods,






copyResult() {
const data = this.getResultText()
if (!data) return
const workspaceRevision = this._workspaceRevision
wx.setClipboardData({ data, success: () => {
if (this._pageAlive && this._pageVisible && this._workspaceRevision === workspaceRevision
&& this.getResultText() === data && isPageContextCurrent(this)) vibrate('medium')
} })
},
toggleCurrentFavorite() {
togglePageFavorite(this)
},
saveToActiveProject() {
addPageToActiveProject(this)
},
})

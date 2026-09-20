const { calculateDmxAddressPlan } = require('../../utils/dmx-address')
const { readPreferences, writePreferences } = require('../../utils/preferences')
const { vibrate } = require('../../utils/haptics')
const {
previewGeneratedImage,
saveGeneratedImage,
shareGeneratedImage,
} = require('../../utils/report-image-actions')
const {
CANVAS_WIDTH,
CANVAS_HEIGHT,
clamp,
recommendSidePairCount,
posDefs,
defY,
sideRange,
posPoint,
posKey,
fixtureSort,
balancedBars,
nearestPlacement,
posFromBars,
barsFromPositions,
createBarRows,
barStatus,
parsePositive,
stageRect,
} = require('./layout-model')
const { SCHEME_IDS, resolveSavedLayout } = require('./layout-storage')
const {
renderLayout,
getCanvasTheme,
getMarkerTextColor,
getFixtureRadius,
GROUP_COLORS,
CANVAS_THEMES,
} = require('./layout-renderer')
const DMX_PREFERENCE_KEY = 'audioTool.dmxAddress.preferences'
const DMX_PROGRESS_KEY = 'audioTool.dmxAddress.progress'
const LAYOUT_KEY = 'audioTool.dmxLayout.v1'
const CANVAS_ID = 'dmxLayoutCanvas'
const EXPORT_CANVAS_ID = 'dmxLayoutExportCanvas'
const DRAG_FINGER_OFFSET = 96
const MIN_FIXTURE_HIT_PX = 44
const MIN_VIEW_SCALE = 1
const MAX_VIEW_SCALE = 2.5
const ROW_OPTIONS = ['1 排', '2 排', '3 排', '4 排', '5 排', '6 排']
const FRONT_OPTIONS = ['下方', '上方']
const SCHEME_OPTIONS = ['仅顶光', '顶光 + 面光', '顶光 + 面光 + 侧光']
const SIDE_PAIR_OPTIONS = ['1 对', '2 对', '3 对']
function getClientPoint(touch, rect = {}) {
if (!touch) return null
const x = Number.isFinite(touch.clientX) ? touch.clientX : Number.isFinite(touch.pageX) ? touch.pageX : Number(touch.x) + (Number(rect.left) || 0)
const y = Number.isFinite(touch.clientY) ? touch.clientY : Number.isFinite(touch.pageY) ? touch.pageY : Number(touch.y) + (Number(rect.top) || 0)
return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}
function progKey(fixture) {
return `${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`
}
function normalizeGroups(preferences = {}) {
return (Array.isArray(preferences.groups) ? preferences.groups : []).map((group, index) => ({
id: `group-${index + 1}`,
name: String(group.name || group.customName || group.fixtureModel || `灯具组 ${index + 1}`).trim(),
channelCount: group.channelCount,
fixtureCount: group.fixtureCount,
targetUniverse: group.targetUniverse,
}))
}
function createDmxLayoutPage(options = {}) {
const layoutMode = options.mode === 'landscape' ? 'landscape' : 'portrait'
const canvasPreset = layoutMode === 'landscape'
? { width: 1200, height: 720 }
: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }
return {
data: {
hasPlan: false,
errorText: '',
stageWidthText: '12',
stageDepthText: '8',
rowOptions: ROW_OPTIONS,
rowIndex: 2,
frontOptions: FRONT_OPTIONS,
frontIndex: 0,
schemeOptions: SCHEME_OPTIONS,
schemeIndex: 0,
sidePairOptions: SIDE_PAIR_OPTIONS,
sidePairIndex: 1,
totalGroups: 0,
totalFixtures: 0,
addressRangeText: '',
groupLegend: [],
addressLabelMode: 'all',
addressLabelModeText: '全部地址',
addressLabelsVisible: true,
scrollEnabled: true,
viewZoomed: false,
barConfigurationExpanded: false,
barRows: [],
barConfigurationStatusText: '',
barConfigurationValid: true,
paletteGroups: [],
paletteGroupIndex: 0,
paletteFixtures: [],
unplacedFixtureCount: 0,
paletteMoreText: '',
paletteDragging: false,
paletteDragAddress: '',
paletteDragLeft: 0,
paletteDragTop: 0,
batchVisible: false,
batchStartOptions: [],
batchStartIndex: 0,
batchEndIndex: 0,
batchPositionOptions: [],
batchPositionIndex: 0,
batchDirectionOptions: ['正序', '反序'],
batchDirectionIndex: 0,
batchPreviewText: '',
searchText: '',
searchResultText: '',
selectedFixture: null,
layoutMode,
isLandscape: layoutMode === 'landscape',
canvasWidth: canvasPreset.width,
canvasHeight: canvasPreset.height,
canvasDisplayHeight: 450,
isGeneratingImage: false,
exportCanvasActive: false,
layoutImagePath: '',
previewVisible: false,
  },
  onLoad() {
this._pageAlive = true
this._pageVisible = true
this._pageReady = false
this._generationToken = 0
this._measureToken = 0
this._drawToken = 0
this._theme = typeof wx.getSystemInfoSync === 'function' && wx.getSystemInfoSync()?.theme === 'dark' ? 'dark' : 'light'
this._themeChangeHandler = ({ theme } = {}) => {
if (!this._pageAlive) return
this._theme = theme === 'dark' ? 'dark' : 'light'
this.clearImage()
if (this._pageVisible) this.measureCanvas(() => this.drawLayout())
}
if (typeof wx.onThemeChange === 'function') wx.onThemeChange(this._themeChangeHandler)
this._view = { s: 1, x: 0, y: 0 }
this._pageScrollTop = 0
this._tap = null
this._preferences = readPreferences(DMX_PREFERENCE_KEY)
this._drawTimer = null
const groups = normalizeGroups(this._preferences)
const result = calculateDmxAddressPlan({
startAddress: this._preferences.startAddressText,
allocationMode: this._preferences.allocationMode,
groups,
})
if (result.error) {
this.setData({ errorText: '请先返回灯具地址码页面，完成一份有效的编址方案。' })
return
}
const saved = readPreferences(LAYOUT_KEY)
const layout = resolveSavedLayout(saved, result.fixtures, groups)
const {
rows,
schemeIndex,
pairs,
definitions,
sidePairManual,
preserve,
positions,
barCounts,
} = layout
const addressLabelMode = ['all', 'smart'].includes(saved.addressLabelMode)
? saved.addressLabelMode
: result.totalFixtures <= 60 ? 'all' : 'smart'
this._fixtures = result.fixtures
this._groups = groups
this._positionDefinitions = definitions
this._sidePairManual = sidePairManual
this._preserve = preserve
this._positions = positions
this._barCounts = barCounts
const signaturePreferences = {
...this._preferences,
allocationMode: this._preferences.allocationMode === 'manual' ? 'manual' : 'auto',
groups: groups.map((group, index) => ({ ...this._preferences.groups?.[index], targetUniverse: group.targetUniverse || 'A' })),
}
this._signature = JSON.stringify(signaturePreferences)
this._checkedKeys = this.readProgress()
this.setData({
hasPlan: true,
stageWidthText: String(saved.stageWidthText || '12'),
stageDepthText: String(saved.stageDepthText || '8'),
rowIndex: rows - 1,
frontIndex: saved.frontIndex === 1 ? 1 : 0,
schemeIndex,
sidePairIndex: pairs - 1,
totalGroups: result.totalGroups,
totalFixtures: result.totalFixtures,
addressRangeText: `${result.startText} → ${result.endText}`,
addressLabelMode,
addressLabelModeText: addressLabelMode === 'all' ? '全部地址' : '智能地址',
barRows: createBarRows(this._barCounts, groups, definitions),
barConfigurationStatusText: barStatus(this._barCounts, groups).text,
barConfigurationValid: barStatus(this._barCounts, groups).valid,
groupLegend: result.groups.map((group, index) => ({
name: group.name,
count: group.fixtureCount,
color: GROUP_COLORS[index % GROUP_COLORS.length],
})),
})
this.refreshFixturePalette()
},
  onReady() {
this._pageReady = true
if (!this.data.hasPlan) return
this.measureCanvas(() => this.drawLayout())
},
  onShow() {
this._pageVisible = true
if (!this.data.scrollEnabled || this.data.paletteDragging) {
this.setData({ scrollEnabled: true, paletteDragging: false })
}
this.syncSystemTheme()
if (!this._awaitingLandscapeReturn) {
if (this._pageReady && this.data.hasPlan) this.measureCanvas(() => this.drawLayout())
return
}
this._awaitingLandscapeReturn = false
this.reloadSavedLayout()
},
syncSystemTheme() {
if (typeof wx.getSystemInfoSync !== 'function') return
const theme = wx.getSystemInfoSync()?.theme === 'dark' ? 'dark' : 'light'
  if (theme === this._theme) return
  this._theme = theme
  this.clearImage()
  if (this._pageVisible) this.measureCanvas(() => this.drawLayout())
  },
  onResize() {
  if (!this._pageAlive || !this._pageVisible || !this.data.hasPlan) return
  this.measureCanvas(() => this.drawLayout())
  },
  onHide() {
this.commitCanvasDrag()
this._pageVisible = false
this._measureToken += 1
this._drawToken += 1
clearTimeout(this._drawTimer)
this._drawTimer = null
this._gesture = null
this._paletteDragFixture = null
this._paletteDragKey = ''
this._paletteDragPreview = null
this._dragPoint = null
this.clearTouch()
},
  onUnload() {
this.commitCanvasDrag()
this._pageAlive = false
this._pageVisible = false
this._pageReady = false
this._generationToken += 1
this._measureToken += 1
this._drawToken += 1
if (this.data.isGeneratingImage && typeof wx.hideLoading === 'function') wx.hideLoading()
if (this._themeChangeHandler && typeof wx.offThemeChange === 'function') wx.offThemeChange(this._themeChangeHandler)
clearTimeout(this._drawTimer)
this._drawTimer = null
this._paletteDragFixture = null
this._dragPoint = null
this.saveLayout()
},
readProgress() {
try {
const saved = wx.getStorageSync(DMX_PROGRESS_KEY)
return saved?.calculationSignature === this._signature && Array.isArray(saved.keys)
? new Set(saved.keys)
: new Set()
} catch (error) {
return new Set()
}
},
writeProgress() {
try {
wx.setStorageSync(DMX_PROGRESS_KEY, {
calculationSignature: this._signature,
keys: [...this._checkedKeys],
})
} catch (error) {
wx.showToast({ title: '进度保存失败，请重试', icon: 'none' })
}
},
saveLayout() {
if (!this.data.hasPlan || !this._positions) return false
return writePreferences(LAYOUT_KEY, {
stageWidthText: this.data.stageWidthText,
stageDepthText: this.data.stageDepthText,
rowCount: this.data.rowIndex + 1,
frontIndex: this.data.frontIndex,
schemeId: SCHEME_IDS[this.data.schemeIndex],
sidePairCount: this.data.sidePairIndex + 1,
sidePairManual: this._sidePairManual,
addressLabelMode: this.data.addressLabelMode,
barCounts: this._barCounts,
preserveUnplaced: this._preserve,
positions: this._positions,
})
},
  reloadSavedLayout() {
if (!this.data.hasPlan || !this._fixtures || !this._groups) return
const saved = readPreferences(LAYOUT_KEY)
const layout = resolveSavedLayout(saved, this._fixtures, this._groups)
const {
rows,
schemeIndex,
pairs,
definitions,
sidePairManual,
preserve,
positions,
barCounts,
} = layout
this._positionDefinitions = definitions
this._sidePairManual = sidePairManual
this._preserve = preserve
this._positions = positions
this._barCounts = barCounts
this._checkedKeys = this.readProgress()
const status = barStatus(this._barCounts, this._groups)
this.setData({
stageWidthText: String(saved.stageWidthText || this.data.stageWidthText || '12'),
stageDepthText: String(saved.stageDepthText || this.data.stageDepthText || '8'),
rowIndex: rows - 1,
frontIndex: saved.frontIndex === 1 ? 1 : 0,
schemeIndex,
sidePairIndex: pairs - 1,
addressLabelMode: ['all', 'smart'].includes(saved.addressLabelMode) ? saved.addressLabelMode : this.data.addressLabelMode,
addressLabelModeText: saved.addressLabelMode === 'smart' ? '智能地址' : '全部地址',
selectedFixture: null,
searchResultText: '',
layoutImagePath: '',
previewVisible: false,
barRows: createBarRows(this._barCounts, this._groups, definitions),
barConfigurationStatusText: status.text,
barConfigurationValid: status.valid,
}, () => {
this.refreshFixturePalette()
this.measureCanvas(() => this.drawLayout())
})
},
openLandscapeLayout() {
if (this.data.isLandscape) return
this.saveLayout()
this._awaitingLandscapeReturn = true
vibrate('light')
wx.navigateTo({ url: '/pages/dmx-layout-landscape/dmx-layout-landscape' })
},
  queueDraw() {
if (!this._pageAlive || !this._pageVisible || this._drawTimer) return
this._drawTimer = setTimeout(() => {
this._drawTimer = null
if (!this._pageAlive || !this._pageVisible) return
this.drawLayout()
}, 34)
},
flushDraw() {
if (!this._drawTimer) return
clearTimeout(this._drawTimer)
this._drawTimer = null
if (!this._pageAlive || !this._pageVisible) return
this.drawLayout()
},
  measureCanvas(callback) {
if (!this._pageAlive || !this._pageVisible) return
const token = (this._measureToken || 0) + 1
this._measureToken = token
const active = () => this._pageAlive && this._pageVisible && this._measureToken === token
const finish = (rect) => {
if (!active()) return
const width = Number(rect?.width) || 350
const logicalWidth = Number(this.data.canvasWidth) || CANVAS_WIDTH
const logicalHeight = Number(this.data.canvasHeight) || CANVAS_HEIGHT
const height = Number(rect?.height) || width * (logicalHeight / logicalWidth)
const commit = () => {
if (!active()) return
this._canvasRect = {
left: Number(rect?.left) || 0,
top: Number(rect?.top) || 0,
width,
height,
}
this._canvasScaleX = width / logicalWidth
this._canvasScaleY = height / logicalHeight
if (callback) callback()
}
if (Math.abs(Number(this.data.canvasDisplayHeight) - height) > 0.5) {
this.setData({ canvasDisplayHeight: Number(height.toFixed(2)) }, commit)
} else {
commit()
}
}
if (typeof wx.createSelectorQuery !== 'function') {
finish({ left: 0, top: 0, width: 350 })
return
}
wx.createSelectorQuery().select('#dmxLayoutCanvasShell').boundingClientRect((rect) => finish(rect)).exec()
},
onPageScroll(event) {
const scrollTop = Number(event?.detail?.scrollTop)
if (!Number.isFinite(scrollTop)) return
const prev = Number(this._pageScrollTop) || 0
if (scrollTop !== prev && this._tap) {
this.clearTouch()
}
if (this._canvasRect && scrollTop !== prev) {
this._canvasRect = { ...this._canvasRect, top: this._canvasRect.top - (scrollTop - prev) }
}
this._pageScrollTop = scrollTop
},
getDisplayStageRect() {
const width = parsePositive(this.data.stageWidthText, 12)
const depth = parsePositive(this.data.stageDepthText, 8)
return stageRect(width, depth, this.data.canvasWidth, this.data.canvasHeight)
},
  drawLayout(options = {}, callback) {
const exportMode = Boolean(options.exportMode)
const drawToken = exportMode ? null : (this._drawToken = (this._drawToken || 0) + 1)
const active = () => this._pageAlive && (exportMode || (this._pageVisible && this._drawToken === drawToken))
if (!active()
|| !this.data.hasPlan || typeof wx.createCanvasContext !== 'function') {
if (callback && active()) callback()
return
}
const ctx = wx.createCanvasContext(options.exportMode ? EXPORT_CANVAS_ID : CANVAS_ID, this)
const displayScaleX = options.exportMode ? 1 : (this._canvasScaleX || 0.5)
const displayScaleY = options.exportMode ? 1 : (this._canvasScaleY || displayScaleX)
const viewScale = options.exportMode ? 1 : this._view.s
const viewPanX = options.exportMode ? 0 : this._view.x
const viewPanY = options.exportMode ? 0 : this._view.y
ctx.save()
ctx.scale(displayScaleX, displayScaleY)
if (!options.exportMode && (viewScale !== 1 || viewPanX || viewPanY)) {
ctx.scale(viewScale, viewScale)
ctx.translate(viewPanX / (displayScaleX * viewScale), viewPanY / (displayScaleY * viewScale))
}
const snapshot = {
data: this.data,
fixtures: this._fixtures,
positions: this._positions,
definitions: this._positionDefinitions,
checkedKeys: this._checkedKeys,
selectedKey: this._selectedKey,
selectedGroup: this._selGroup,
dragPoint: this._dragPoint,
palettePreview: this._paletteDragPreview,
theme: getCanvasTheme(this._theme),
stage: this.getDisplayStageRect(),
viewScale,
widthMeters: parsePositive(this.data.stageWidthText, 12),
depthMeters: parsePositive(this.data.stageDepthText, 8),
frontAtBottom: this.data.frontIndex === 0,
progKey,
}
renderLayout(ctx, snapshot, options)
ctx.restore()
ctx.draw(false, () => {
if (!active()) return
if (callback) callback()
})
},
onStageInput(event) {
const key = event.currentTarget.dataset.key
if (!['stageWidthText', 'stageDepthText'].includes(key)) return
this.setData({ [key]: event.detail.value })
},
onStageBlur(event) {
const key = event.currentTarget.dataset.key
const fallback = key === 'stageWidthText' ? '12' : '8'
const value = String(parsePositive(event.detail.value, Number(fallback)))
const changes = { [key]: value }
if (key === 'stageDepthText' && !this._sidePairManual) {
changes.sidePairIndex = recommendSidePairCount(Number(value)) - 1
}
this.setData(changes, () => {
if (key === 'stageDepthText') this.rebuildPositionDefinitions(false)
this.clearImage()
this.saveLayout()
this.drawLayout()
})
},
rebuildPositionDefinitions(rebalance = false) {
const definitions = posDefs(
this.data.rowIndex + 1,
SCHEME_IDS[this.data.schemeIndex],
this.data.sidePairIndex + 1,
)
this._positionDefinitions = definitions
if (rebalance) {
this._barCounts = balancedBars(this._groups, definitions.length)
this.applyBarConfiguration()
return
}
this._positions = restorePositions(
this._fixtures,
this._positions,
this.data.rowIndex + 1,
definitions,
this.data.sidePairIndex + 1,
)
this.syncBarConfigurationFromPositions()
},
onSchemeChange(event) {
const schemeIndex = Number(event.detail.value)
if (!SCHEME_IDS[schemeIndex] || schemeIndex === this.data.schemeIndex) return
vibrate('light')
this.setData({ schemeIndex }, () => this.rebuildPositionDefinitions(true))
},
onSidePairChange(event) {
const sidePairIndex = Number(event.detail.value)
if (![0, 1, 2].includes(sidePairIndex) || sidePairIndex === this.data.sidePairIndex) return
this._sidePairManual = true
vibrate('light')
this.setData({ sidePairIndex }, () => this.rebuildPositionDefinitions(true))
},
onRowChange(event) {
const rowIndex = Number(event.detail.value)
if (!Number.isInteger(rowIndex) || rowIndex === this.data.rowIndex) return
this.setData({ rowIndex }, () => {
this.rebuildPositionDefinitions(true)
})
},
onFrontChange(event) {
const frontIndex = Number(event.detail.value)
if (![0, 1].includes(frontIndex) || frontIndex === this.data.frontIndex) return
vibrate('light')
this.setData({ frontIndex }, () => {
this.clearImage()
this.saveLayout()
this.drawLayout()
})
},
applyAutomaticLayout() {
this._barCounts = balancedBars(this._groups, this._positionDefinitions.length)
this.refreshBarConfiguration()
this.applyBarConfiguration()
},
refreshBarConfiguration(extra = {}) {
const status = barStatus(this._barCounts, this._groups)
this.setData({
...extra,
barRows: createBarRows(this._barCounts, this._groups, this._positionDefinitions),
barConfigurationStatusText: status.text,
barConfigurationValid: status.valid,
})
},
refreshFixturePalette(preferredGroupIndex = this.data.paletteGroupIndex, callback) {
if (!this._fixtures || !this._positions) {
if (callback) callback()
return
}
const remainingByGroup = this._groups.map(() => [])
this._fixtures.forEach((fixture) => {
const groupIndex = fixture.groupIndex
if (Number.isInteger(groupIndex) && this._groups[groupIndex]
&& !this._positions[posKey(fixture)]) {
remainingByGroup[groupIndex].push(fixture)
}
})
const firstRemainingGroup = remainingByGroup.findIndex((fixtures) => fixtures.length > 0)
const groupIndex = remainingByGroup[preferredGroupIndex]?.length
? preferredGroupIndex
: firstRemainingGroup >= 0 ? firstRemainingGroup : Math.max(0, preferredGroupIndex)
const remaining = remainingByGroup[groupIndex] || []
this.setData({
paletteGroupIndex: groupIndex,
paletteGroups: this._groups.map((group, index) => ({
groupIndex: index,
name: group.name,
remainingCount: remainingByGroup[index].length,
})),
paletteFixtures: remaining.slice(0, 80).map((fixture) => ({
key: posKey(fixture),
addressText: fixture.addressText,
})),
unplacedFixtureCount: remainingByGroup.reduce((sum, fixtures) => sum + fixtures.length, 0),
paletteMoreText: remaining.length > 80 ? `另有 ${remaining.length - 80} 台，放置前面的灯具后继续显示` : '',
}, callback)
},
syncBarConfigurationFromPositions() {
this._barCounts = barsFromPositions(
this._fixtures,
this._positions,
this._groups,
this._positionDefinitions,
this.data.rowIndex + 1,
this.data.sidePairIndex + 1,
)
this.refreshBarConfiguration()
},
toggleBarConfiguration() {
vibrate('light')
this.refreshBarConfiguration({ barConfigurationExpanded: !this.data.barConfigurationExpanded })
},
selectPaletteGroup(event) {
const groupIndex = Number(event.currentTarget.dataset.groupIndex)
if (!this._groups[groupIndex]) return
vibrate('light')
this.refreshFixturePalette(groupIndex)
},
getUnplacedFixtures(groupIndex = this.data.paletteGroupIndex) {
return this._fixtures?.filter((f) => f.groupIndex === groupIndex && !this._positions[posKey(f)]).sort(fixtureSort) || []
},
refreshBatchPreview() {
const fs = this.getUnplacedFixtures(), max = fs.length - 1, start = Math.max(0, Math.min(max, Number(this.data.batchStartIndex) || 0)), end = Math.max(start, Math.min(max, Number(this.data.batchEndIndex) || 0)), d = this._positionDefinitions?.[this.data.batchPositionIndex], label = d?.label || '目标灯位', count = fs.length && end >= start ? end - start + 1 : 0
this.setData({ batchStartIndex: start, batchEndIndex: end, batchPreviewText: count ? `共${count}台，将沿${label}均匀排列` : '请选择有效的地址范围' })
},
openBatchPlacement() {
const fs = this.getUnplacedFixtures()
if (!fs.length) return wx.showToast({ title: '当前灯具组没有待布置灯具', icon: 'none' })
const options = this._positionDefinitions.map((d) => d.label), values = fs.map((f) => f.addressText)
vibrate('light')
this.setData({ batchVisible: true, batchStartOptions: values, batchStartIndex: 0, batchEndIndex: fs.length - 1, batchPositionOptions: options, batchPositionIndex: Math.max(0, Math.min(options.length - 1, Number(this.data.batchPositionIndex) || 0)), batchDirectionIndex: Number(this.data.batchDirectionIndex) === 1 ? 1 : 0 }, () => this.refreshBatchPreview())
},
closeBatchPlacement() {
if (!this.data.batchVisible) return
this.setData({ batchVisible: false }, () => this.drawLayout())
},
onBatchStartChange(e) { this._batchPickerChange('batchStartIndex', e) },
onBatchEndChange(e) { this._batchPickerChange('batchEndIndex', e) },
onBatchPositionChange(e) { this._batchPickerChange('batchPositionIndex', e) },
_batchPickerChange(key, e) { const i = Number(e.detail.value); if (Number.isInteger(i)) this.setData({ [key]: i }, () => this.refreshBatchPreview()) },
onBatchDirectionChange(e) { const i = Number(e.detail.value); if ([0, 1].includes(i)) this.setData({ batchDirectionIndex: i }) },
getBatchTargetFixtures(d) {
return d ? this._fixtures.filter((f) => { const p = this._positions[posKey(f)]; return p && p.zone === d.zone && p.positionIndex === d.positionIndex }).sort(fixtureSort) : []
},
applyBatchPlacement() {
const fs = this.getUnplacedFixtures(), start = Number(this.data.batchStartIndex), end = Number(this.data.batchEndIndex), d = this._positionDefinitions?.[this.data.batchPositionIndex]
if (!fs.length || !d) return wx.showToast({ title: '没有可批量上杆的灯具或目标灯位', icon: 'none' })
if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= fs.length) return wx.showToast({ title: '请选择有效的连续地址范围', icon: 'none' })
const ordered = this.getBatchTargetFixtures(d).concat(fs.slice(start, end + 1)).sort(fixtureSort)
if (this.data.batchDirectionIndex === 1) ordered.reverse()
const side = d.zone.startsWith('side-'), rail = side ? sideRange(d.positionIndex, this.data.sidePairIndex + 1) : null
ordered.forEach((f, i) => { const n = (i + 1) / (ordered.length + 1); this._positions[posKey(f)] = { zone: d.zone, positionIndex: d.positionIndex, x: side ? (d.zone === 'side-left' ? 0 : 1) : n, y: side ? clamp(rail.start + n * (rail.end - rail.start), .03, .97) : d.zone === 'front' ? 1 : defY(d, this.data.rowIndex + 1, this.data.sidePairIndex + 1) } })
this._finishBatchEdit()
},
_finishBatchEdit() {
this._preserve = true; this._selectedKey = ''; this._selGroup = undefined; this.syncBarConfigurationFromPositions(); this.refreshFixturePalette(); vibrate('medium')
this.setData({ batchVisible: false, selectedFixture: null, searchResultText: '' }, () => { this.clearImage(); this.saveLayout(); this.drawLayout() })
},
clearBatchPosition() {
const d = this._positionDefinitions?.[this.data.batchPositionIndex], targets = this.getBatchTargetFixtures(d)
if (!d) return wx.showToast({ title: '请选择目标灯位', icon: 'none' })
if (!targets.length) return wx.showToast({ title: '当前灯位没有已布置灯具', icon: 'none' })
wx.showModal({ title: '清空当前灯位', content: `将移除${d.label}上的${targets.length}台灯具，其他灯位不变。`, confirmText: '清空', confirmColor: '#d70015', success: ({ confirm }) => {
if (!confirm) return
targets.forEach((f) => { delete this._positions[posKey(f)] }); this._finishBatchEdit()
} })
},
clearLayout() {
wx.showModal({
title: '清空位置图',
content: '清空后可从灯具组中按住具体地址，拖动到灯位重新排布。',
confirmText: '清空',
confirmColor: '#ff3b30',
success: ({ confirm }) => {
if (!confirm) return
this._positions = Object.create(null)
this._preserve = true
this._selectedKey = ''
this._selGroup = undefined
this.syncBarConfigurationFromPositions()
this.refreshFixturePalette()
vibrate('medium')
this.setData({ selectedFixture: null, searchResultText: '' }, () => {
this.clearImage()
this.saveLayout()
this.drawLayout()
})
},
})
},
clampViewPan(scale, panX, panY) {
const r = this._canvasRect || {}, s = Math.max(MIN_VIEW_SCALE, Number(scale) || MIN_VIEW_SCALE) - 1, bounds = { x: (Number(r.width) || 350) * s, y: (Number(r.height) || 450) * s }
return { x: clamp(Number(panX) || 0, -bounds.x, 0), y: clamp(Number(panY) || 0, -bounds.y, 0) }
},
logicalPoint(point) {
const rect = this._canvasRect || {}
if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
const view = this._view || { s: 1, x: 0, y: 0 }, w = Number(rect.width) || 350, h = Number(rect.height) || 450
return { x: (point.x - (Number(rect.left) || 0) - view.x) * this.data.canvasWidth / (w * view.s), y: (point.y - (Number(rect.top) || 0) - view.y) * this.data.canvasHeight / (h * view.s) }
},
gestureMetrics(event) {
const touches = (event.touches || []).slice(0, 2)
if (touches.length < 2) return null
const [first, second] = touches.map((touch) => getClientPoint(touch, this._canvasRect))
if (!first || !second) return null
return { distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)), center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } }
},
  beginGesture(event) {
const metrics = this.gestureMetrics(event)
if (!metrics) return
this.commitCanvasDrag()
const view = this._view || { s: 1, x: 0, y: 0 }
this._gesture = { startDistance: metrics.distance, startScale: view.s, anchor: this.logicalPoint(metrics.center) }
this.clearTouch()
this.setData({ scrollEnabled: false })
},
updateGesture(event) {
const gesture = this._gesture
const metrics = this.gestureMetrics(event)
if (!gesture || !metrics) return
const scale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, gesture.startScale * metrics.distance / gesture.startDistance))
const rect = this._canvasRect || {}, anchor = gesture.anchor || { x: 0, y: 0 }, width = Number(rect.width) || 350, height = Number(rect.height) || 450
const pan = this.clampViewPan(scale, metrics.center.x - (Number(rect.left) || 0) - anchor.x * width * scale / this.data.canvasWidth, metrics.center.y - (Number(rect.top) || 0) - anchor.y * height * scale / this.data.canvasHeight)
const zoomed = scale > MIN_VIEW_SCALE || Math.abs(pan.x) > .5 || Math.abs(pan.y) > .5
this._view = { s: scale, x: pan.x, y: pan.y }
if (zoomed !== this.data.viewZoomed) this.setData({ viewZoomed: zoomed })
this.queueDraw()
},
resetCanvasView() {
this._gesture = null
this._view = { s: 1, x: 0, y: 0 }
this.setData({ viewZoomed: false }, () => this.drawLayout())
},
clientPoint(event) {
return getClientPoint(event?.touches?.[0] || event?.changedTouches?.[0], this._canvasRect)
},
  clearTouch() {
this._tap=null;this._dragKey='';this._dragMoved=false;this._start=null
},
  commitCanvasDrag() {
if (!this._dragKey || !this._dragMoved) return false
this.flushDraw()
vibrate('light')
this.syncBarConfigurationFromPositions()
this.clearImage()
this.saveLayout()
return true
},
moved(start, event) {
const point = this.clientPoint(event)
return start&&point&&Math.hypot(point.x-start.x,point.y-start.y)>8
},
onPaletteTouchStart(event) {
const key = String(event.currentTarget.dataset.key || '')
const fixture = this._fixtures.find((item) => posKey(item) === key)
const point = this.clientPoint(event)
this._paletteDragFixture = null
if (!fixture || !point) return
this._paletteDragKey = key
this._paletteDragFixture = fixture
this._lastPaletteDraw = 0
this.measureCanvas()
vibrate('light')
this.setData({
scrollEnabled: false,
paletteDragging: true,
paletteDragAddress: fixture.addressText,
paletteDragLeft: point.x,
paletteDragTop: point.y - 52,
})
},
onPaletteTouchMove(event) {
if (!this._paletteDragKey) return
const point = this.clientPoint(event)
if (!point) return
const now = Date.now()
if (now - this._lastPaletteDraw < 24) return
this._lastPaletteDraw = now
const fixture = this._paletteDragFixture
const placement = this.getPalettePlacement(point)
if (fixture && placement) {
const stage = this.getDisplayStageRect()
this._paletteDragPreview = {
fixture,
...placement,
badgeX: clamp(placement.targetX, stage.left + 34, stage.left + stage.width - 34),
badgeY: Math.max(stage.top + 38, placement.targetY - 92),
}
this.setData({
paletteDragging: true,
paletteDragLeft: point.x,
paletteDragTop: point.y - 52,
})
this.queueDraw()
return
}
if (this._paletteDragPreview) {
this._paletteDragPreview = null
this.queueDraw()
}
this.setData({ paletteDragging: true, paletteDragLeft: point.x, paletteDragTop: point.y - 52 })
},
getPalettePlacement(point) {
const rect = this._canvasRect
if (!point || !rect || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
const logicalPoint = this.logicalPoint(point)
if (!logicalPoint) return null
const stage = this.getDisplayStageRect()
if (logicalPoint.x < stage.left - 76 || logicalPoint.x > stage.left + stage.width + 76
|| logicalPoint.y < stage.top - 76 || logicalPoint.y > stage.top + stage.height + 76) return null
return nearestPlacement(
logicalPoint,
stage,
this.data.frontIndex === 0,
this._positionDefinitions,
this.data.rowIndex + 1,
this.data.sidePairIndex + 1,
)
},
onPaletteTouchEnd(event) {
const key = this._paletteDragKey
const fixture = this._paletteDragFixture || this._fixtures.find((item) => posKey(item) === key)
const point = this.clientPoint(event)
const placement = this.getPalettePlacement(point)
this._paletteDragKey = ''
this._paletteDragFixture = null
this._paletteDragPreview = null
this.setData({ scrollEnabled: true, paletteDragging: false })
if (!key || !placement) {
wx.showToast({ title: '请拖到灯位区域', icon: 'none' })
this.drawLayout()
return
}
this._positions[key] = placement.position
this._preserve = true
this.syncBarConfigurationFromPositions()
vibrate('medium')
this.clearImage()
this.saveLayout()
this.refreshFixturePalette(this.data.paletteGroupIndex, () => {
if (fixture) {
this.selectFixture(fixture, `已放置 ${fixture.addressText}`, () => {
this.measureCanvas(() => this.drawLayout())
})
} else {
this.measureCanvas(() => this.drawLayout())
}
})
},
cancelPaletteDrag() {
this._paletteDragKey = ''
this._paletteDragFixture = null
this._paletteDragPreview = null
this.setData({ scrollEnabled: true, paletteDragging: false }, () => this.drawLayout())
},
onBarCountInput(event) {
const barIndex = Number(event.currentTarget.dataset.barIndex)
const groupIndex = Number(event.currentTarget.dataset.groupIndex)
if (!this._barCounts[barIndex] || !this._groups[groupIndex]) return
const count = Math.max(0, Math.floor(Number(event.detail.value) || 0))
this._barCounts[barIndex][groupIndex] = count
const status = barStatus(this._barCounts, this._groups)
this.setData({
[`barRows[${barIndex}].groups[${groupIndex}].countText`]: String(count),
barConfigurationStatusText: status.text,
barConfigurationValid: status.valid,
})
},
balanceBarConfiguration() {
this._barCounts = balancedBars(this._groups, this._positionDefinitions.length)
vibrate('light')
this.refreshBarConfiguration()
},
applyBarConfiguration() {
const status = barStatus(this._barCounts, this._groups)
if (!status.valid) {
wx.showToast({ title: '请完整分配每组灯具数量', icon: 'none' })
return
}
const positions = posFromBars(
this._fixtures,
this._barCounts,
this._groups,
this._positionDefinitions,
this.data.rowIndex + 1,
this.data.sidePairIndex + 1,
)
if (Object.keys(positions).length !== this._fixtures.length) {
wx.showToast({ title: '灯具分配不完整，请检查', icon: 'none' })
return
}
this._positions = positions
this._preserve = false
this._selectedKey = ''
this._selGroup = undefined
this.refreshFixturePalette()
vibrate('medium')
this.setData({
selectedFixture: null,
searchResultText: '',
addressLabelsVisible: true,
addressLabelModeText: this.data.addressLabelMode === 'all' ? '全部地址' : '智能地址',
barRows: createBarRows(this._barCounts, this._groups, this._positionDefinitions),
barConfigurationStatusText: status.text,
barConfigurationValid: true,
}, () => {
this.clearImage()
this.saveLayout()
this.drawLayout()
})
},
touchPoint(event) {
const touch = event?.touches?.[0] || event?.changedTouches?.[0]
const rect = this._canvasRect || {}
const view = this._view || {}
const width = Number(rect.width) || 350
const height = Number(rect.height) || 450
if (Number.isFinite(touch?.x) && Number.isFinite(touch?.y)) {
return {
x: (touch.x - (Number(view.x) || 0)) * this.data.canvasWidth / (width * (Number(view.s) || 1)),
y: (touch.y - (Number(view.y) || 0)) * this.data.canvasHeight / (height * (Number(view.s) || 1)),
}
}
const point = this.clientPoint(event)
return point ? this.logicalPoint(point) : null
},
findFixture(point) {
if (!point) return null
const stage = this.getDisplayStageRect()
const frontAtBottom = this.data.frontIndex === 0
const rect = this._canvasRect || {}
const canvasWidth = Number(this.data.canvasWidth) || CANVAS_WIDTH
const canvasHeight = Number(this.data.canvasHeight) || CANVAS_HEIGHT
const displayScaleX = Number(this._canvasScaleX) || (Number(rect.width) || 350) / canvasWidth
const displayScaleY = Number(this._canvasScaleY) || (Number(rect.height) || 450) / canvasHeight
const viewScale = Math.max(MIN_VIEW_SCALE, Number(this._view?.s) || MIN_VIEW_SCALE)
const hitRadiusPx = Math.max(MIN_FIXTURE_HIT_PX, getFixtureRadius(this._fixtures.length) * Math.min(displayScaleX, displayScaleY))
let nearest = null
let nearestDistance = hitRadiusPx
this._fixtures.forEach((fixture) => {
const position = this._positions[posKey(fixture)]
if (!position) return
const { x, y } = posPoint(position, stage, frontAtBottom)
const distance = Math.hypot((point.x - x) * displayScaleX * viewScale, (point.y - y) * displayScaleY * viewScale)
if (distance < nearestDistance) {
nearest = fixture
nearestDistance = distance
}
})
return nearest
},
selectFixture(fixture, searchResultText = '', committedCallback) {
if (!fixture) return
const progressKey = progKey(fixture)
this._selectedKey = posKey(fixture)
this._selGroup = fixture.groupIndex
this.setData({
searchResultText,
addressLabelsVisible: true,
addressLabelModeText: this.data.addressLabelMode === 'all' ? '全部地址' : '智能地址',
selectedFixture: {
groupName: fixture.groupName,
fixtureIndex: fixture.fixtureIndex,
addressText: fixture.addressText,
rangeText: fixture.rangeText,
channelCount: fixture.channelCount,
completed: this._checkedKeys.has(progressKey),
progressKey,
},
}, () => {
if (committedCallback) committedCallback()
else this.drawLayout()
})
},
onCanvasTouchStart(event) {
if ((event.touches || []).length >= 2) {
this.beginGesture(event)
return
}
if (this._gesture) return
const point = this.touchPoint(event)
const fixture = this.findFixture(point)
if (!fixture) {
this.clearTouch()
this._tap = this.clientPoint(event)
if (!this.data.scrollEnabled) this.setData({ scrollEnabled: true })
return
}
this.clearTouch()
this._dragKey = posKey(fixture)
this._dragPoint = null
this._start = this.clientPoint(event)
this.setData({ scrollEnabled: false })
this.selectFixture(fixture)
},
onCanvasTouchMove(event) {
if ((event.touches || []).length >= 2) {
if (!this._gesture) this.beginGesture(event)
this.updateGesture(event)
return
}
if (this._gesture) return
if (this._tap) {
if (this.moved(this._tap, event)) this._tap = null
return
}
if (!this._dragKey) return
const clientPoint = this.clientPoint(event)
const point = this.touchPoint(event)
const stage = this.getDisplayStageRect()
if (!point || !clientPoint) return
if (!this._dragMoved) {
const start = this._start
if (start && Math.hypot(clientPoint.x-start.x, clientPoint.y-start.y)<=8) return
this._dragMoved = true
}
this._dragPoint = point
const fingerOffset = this.data.isLandscape
? Math.max(52, (52 / Math.max(1, this._canvasRect?.height || 390)) * this.data.canvasHeight)
: DRAG_FINGER_OFFSET
const placement = nearestPlacement({ x: point.x, y: point.y - (fingerOffset / ((this._view && this._view.s) || 1)) }, stage, this.data.frontIndex === 0, this._positionDefinitions, this.data.rowIndex + 1, this.data.sidePairIndex + 1)
if (!placement) return
this._positions[this._dragKey] = placement.position
this._dragMoved = true
this.queueDraw()
},
onCanvasTouchEnd(event) {
if (this._gesture) {
if ((event?.touches || []).length > 0) return
this._gesture = null
this.clearTouch()
this.setData({ scrollEnabled: true }, () => this.drawLayout())
return
}
if (!this._dragKey) {
const tap = this._tap
this.clearTouch()
if (tap && !this.moved(tap, event)) {
this._selectedKey = ''
this._selGroup = undefined
this.setData({
selectedFixture: null,
searchResultText: '',
addressLabelsVisible: false,
addressLabelModeText: '显示地址',
scrollEnabled: true,
}, () => this.drawLayout())
return
}
if (!this.data.scrollEnabled) this.setData({ scrollEnabled: true })
return
}
if (this._dragMoved) {
this.commitCanvasDrag()
}
this.clearTouch()
this.setData({ scrollEnabled: true }, () => this.drawLayout())
},
onCanvasTouchCancel(event) {
const hadTap = Boolean(this._tap)
if (!hadTap) {
this.onCanvasTouchEnd(event)
return
}
this.clearTouch()
if (!this.data.scrollEnabled) this.setData({ scrollEnabled: true })
},
onSearchInput(event) {
this.setData({ searchText: event.detail.value })
},
toggleAddressLabels() {
if (!this.data.addressLabelsVisible) {
vibrate('light')
this.setData({
addressLabelsVisible: true,
addressLabelModeText: this.data.addressLabelMode === 'all' ? '全部地址' : '智能地址',
}, () => this.drawLayout())
return
}
const addressLabelMode = this.data.addressLabelMode === 'all' ? 'smart' : 'all'
vibrate('light')
this.setData({
addressLabelMode,
addressLabelModeText: addressLabelMode === 'all' ? '全部地址' : '智能地址',
}, () => {
this.clearImage()
this.saveLayout()
this.drawLayout()
})
},
searchFixture() {
const keyword = String(this.data.searchText || '').trim().toUpperCase()
if (!keyword) {
wx.showToast({ title: '请输入地址或灯具组', icon: 'none' })
return
}
const fixture = this._fixtures.find((item) => (
item.addressText.toUpperCase() === keyword
|| item.groupName.toUpperCase().includes(keyword)
))
if (!fixture) {
this.setData({ searchResultText: '没有找到匹配灯具' })
return
}
if (!this._positions[posKey(fixture)]) {
this.refreshFixturePalette(fixture.groupIndex)
this.setData({ searchResultText: `${fixture.addressText} 尚未上杆` })
return
}
vibrate('light')
this.selectFixture(fixture, `已定位 ${fixture.addressText}`)
},
toggleSelectedProgress() {
const selected = this.data.selectedFixture
if (!selected) return
const completed = !this._checkedKeys.has(selected.progressKey)
if (completed) this._checkedKeys.add(selected.progressKey)
else this._checkedKeys.delete(selected.progressKey)
vibrate('light')
this.writeProgress()
this.setData({ 'selectedFixture.completed': completed }, () => {
this.clearImage()
this.drawLayout()
})
},
clearImage() {
if (!this.data.layoutImagePath && !this.data.previewVisible) return
this.setData({ layoutImagePath: '', previewVisible: false })
},
generateLayoutImage() {
if (this.data.isGeneratingImage || typeof wx.canvasToTempFilePath !== 'function') return
const token = this._generationToken + 1
this._generationToken = token
const isGenerationActive = () => this._pageAlive && this._generationToken === token
vibrate('medium')
if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成', mask: true })
this.setData({ isGeneratingImage: true, exportCanvasActive: true }, () => {
if (!isGenerationActive()) return
 const drawExportCanvas = () => this.drawLayout({ exportMode: true }, () => {
if (!isGenerationActive()) return
wx.canvasToTempFilePath({
canvasId: EXPORT_CANVAS_ID,
x: 0,
y: 0,
width: this.data.canvasWidth,
height: this.data.canvasHeight,
destWidth: this.data.canvasWidth * 2,
destHeight: this.data.canvasHeight * 2,
fileType: 'png',
quality: 1,
success: ({ tempFilePath }) => {
if (!isGenerationActive()) return
this.setData({
isGeneratingImage: false,
exportCanvasActive: false,
layoutImagePath: tempFilePath,
previewVisible: true,
})
if (typeof wx.hideLoading === 'function') wx.hideLoading()
},
fail: () => {
if (!isGenerationActive()) return
this.setData({ isGeneratingImage: false, exportCanvasActive: false })
if (typeof wx.hideLoading === 'function') wx.hideLoading()
wx.showToast({ title: '生成失败，请重试', icon: 'none' })
},
}, this)
})
 // 等待导出 Canvas 完成显示，避免 setData 后立即绘制导致截屏内容不完整。
 if (typeof wx.nextTick === 'function') wx.nextTick(() => {
if (isGenerationActive()) drawExportCanvas()
})
 else drawExportCanvas()
})
},
closePreview() {
this.setData({ previewVisible: false }, () => this.measureCanvas(() => this.drawLayout()))
},
previewImage() {
previewGeneratedImage(this.data.layoutImagePath)
},
shareImage() {
shareGeneratedImage(this.data.layoutImagePath)
},
saveImage() {
saveGeneratedImage(this.data.layoutImagePath)
},
stopTap() {},
preventTouchMove() {},
}
}
module.exports = { createDmxLayoutPage, getMarkerTextColor, GROUP_COLORS, CANVAS_THEMES }

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
interleaveBatchFixtures,
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
getExportAddressLayout,
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
const POSITION_SOURCES = new Set(['automatic', 'configured', 'manual', 'empty', 'unknown'])
function normalizePositionSource(saved) {
if (POSITION_SOURCES.has(saved?.positionSource)) return saved.positionSource
return saved && Object.keys(saved).length ? 'unknown' : 'automatic'
}
function positionSourceHint(source, autoFilledCount = 0) {
const labels = {
automatic: '自动排布（建议位置，需现场核对）',
configured: '灯位配置排布（建议位置，需现场核对）',
manual: '手动布置（建议现场核对）',
empty: '已清空',
unknown: '历史记录未标注来源，建议现场核对',
}
const hint = `位置来源：${labels[source] || labels.unknown}`
if (autoFilledCount <= 0) return hint
return source === 'unknown'
? `历史位置来源不明；${autoFilledCount} 台位置由系统补齐，建议现场核对`
: `${hint}；旧记录中 ${autoFilledCount} 台位置由系统补齐，请现场核对`
}
function countAutoFilledPositions(saved, fixtures, resolvedPositions, source) {
const savedCount = ['manual', 'unknown'].includes(source)
? Math.max(0, Number(saved?.positionAutoFilledCount) || 0)
: 0
const savedPositions = saved?.positions
if (!savedPositions || typeof savedPositions !== 'object' || Array.isArray(savedPositions)) return savedCount
const filledCount = fixtures.reduce((count, fixture) => {
const key = posKey(fixture)
const position = savedPositions[key]
const isRestorable = position && Number.isFinite(position.x) && Number.isFinite(position.y)
return count + Number(Boolean(resolvedPositions[key]) && !isRestorable)
}, 0)
return Math.max(savedCount, filledCount)
}
function cloneJson(value) {
return JSON.parse(JSON.stringify(value))
}
function getClientPoint(touch, rect = {}) {
if (!touch) return null
const x = Number.isFinite(touch.clientX) ? touch.clientX : Number.isFinite(touch.pageX) ? touch.pageX : Number(touch.x) + (Number(rect.left) || 0)
const y = Number.isFinite(touch.clientY) ? touch.clientY : Number.isFinite(touch.pageY) ? touch.pageY : Number(touch.y) + (Number(rect.top) || 0)
return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}
function progKey(fixture) {
return `${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`
}
function createRenderSnapshot(page) {
return {
data: page.data,
fixtures: page._fixtures,
positions: page._positions,
definitions: page._positionDefinitions,
checkedKeys: page._checkedKeys,
selectedKey: page._selectedKey,
selectedGroup: page._selGroup,
dragPoint: page._dragPoint,
palettePreview: page._paletteDragPreview,
theme: getCanvasTheme(page._theme),
stage: page.getDisplayStageRect(),
viewScale: page._view.s,
widthMeters: parsePositive(page.data.stageWidthText, 12),
depthMeters: parsePositive(page.data.stageDepthText, 8),
frontAtBottom: page.data.frontIndex === 0,
progKey,
}
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
positionSourceHint: '位置来源：自动排布',
positionProgressText: '位置已布置 0 / 0，待布置 0',
automaticLayoutUndoVisible: false,
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
exportCanvasWidth: canvasPreset.width,
exportCanvasHeight: canvasPreset.height,
canvasDisplayHeight: 450,
isGeneratingImage: false,
exportCanvasActive: false,
layoutImagePath: '',
previewVisible: false,
  },
  onLoad(options = {}) {
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
this._skipSaveOnUnload = false
this._automaticLayoutUndoSnapshot = null
this._positionAutoFilledCount = 0
this._expandBarConfigurationOnLandscapeReturn = false
const openBarConfiguration = options.expandBarConfiguration === '1'
this._scrollBarConfigurationOnReady = openBarConfiguration
this._scrollTargetTimer = null
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
this._positionSource = normalizePositionSource(saved)
this._positionAutoFilledCount = countAutoFilledPositions(
saved, result.fixtures, positions, this._positionSource,
)
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
barConfigurationExpanded: openBarConfiguration,
scrollIntoViewTarget: '',
...this.getPositionSummaryData(),
groupLegend: result.groups.map((group, index) => ({
name: group.name,
count: group.fixtureCount,
color: GROUP_COLORS[index % GROUP_COLORS.length],
})),
}, () => {
if (openBarConfiguration) this.scrollToBarConfiguration()
})
this.refreshFixturePalette()
},
onReady() {
this._pageReady = true
if (!this.data.hasPlan) return
if (this._scrollBarConfigurationOnReady) {
this._scrollBarConfigurationOnReady = false
this.scrollToBarConfiguration()
}
this.measureCanvas(() => this.drawLayout())
},
  onShow() {
this._pageVisible = true
if (!this.data.scrollEnabled || this.data.paletteDragging) {
this.setData({ scrollEnabled: true, paletteDragging: false })
}
this.syncSystemTheme()
if (!this._awaitingLandscapeReturn) {
if (this.data.hasPlan) this.measureCanvas(() => this.drawLayout())
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
if (!this._skipSaveOnUnload) this.commitCanvasDrag()
this._pageVisible = false
this._measureToken += 1
clearTimeout(this._measureTimer)
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
if (!this._skipSaveOnUnload) this.commitCanvasDrag()
this._pageAlive = false
this._pageVisible = false
this._pageReady = false
this._generationToken += 1
this._measureToken += 1
clearTimeout(this._measureTimer)
clearTimeout(this._scrollTargetTimer)
this._drawToken += 1
if (this.data.isGeneratingImage && typeof wx.hideLoading === 'function') wx.hideLoading()
if (this._themeChangeHandler && typeof wx.offThemeChange === 'function') wx.offThemeChange(this._themeChangeHandler)
clearTimeout(this._drawTimer)
this._drawTimer = null
this._paletteDragFixture = null
this._dragPoint = null
if (!this._skipSaveOnUnload) this.saveLayout()
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
getPositionSummaryData() {
const fixtures = this._fixtures || []
const positions = this._positions || {}
const placedCount = fixtures.reduce(
(count, fixture) => count + Number(Boolean(positions[posKey(fixture)])),
0,
)
const totalCount = fixtures.length
return {
positionSourceHint: positionSourceHint(this._positionSource || 'unknown', this._positionAutoFilledCount),
positionProgressText: `位置已布置 ${placedCount} / ${totalCount}，待布置 ${totalCount - placedCount}`,
}
},
setPositionSource(source, autoFilledCount) {
this._positionSource = POSITION_SOURCES.has(source) ? source : 'unknown'
const preservedCount = this._positionSource === 'manual' ? this._positionAutoFilledCount : 0
this._positionAutoFilledCount = Math.max(0, Number(autoFilledCount ?? preservedCount) || 0)
},
invalidateAutomaticLayoutUndo() {
if (!this._automaticLayoutUndoSnapshot && !this.data.automaticLayoutUndoVisible) return
this._automaticLayoutUndoSnapshot = null
this.setData({ automaticLayoutUndoVisible: false })
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
positionSource: this._positionSource || 'unknown',
positionAutoFilledCount: this._positionAutoFilledCount || 0,
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
this._positionSource = normalizePositionSource(saved)
this._positionAutoFilledCount = countAutoFilledPositions(
saved, this._fixtures, positions, this._positionSource,
)
this._checkedKeys = this.readProgress()
const status = barStatus(this._barCounts, this._groups)
const expandBarConfiguration = Boolean(this._expandBarConfigurationOnLandscapeReturn)
this._expandBarConfigurationOnLandscapeReturn = false
const changes = {
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
...this.getPositionSummaryData(),
}
if (expandBarConfiguration) changes.barConfigurationExpanded = true
this.setData({
...changes,
}, () => {
if (expandBarConfiguration) this.scrollToBarConfiguration()
this.refreshFixturePalette()
this.measureCanvas(() => this.drawLayout())
})
},
openLandscapeLayout() {
if (this.data.isLandscape) return
this.saveLayout()
this._awaitingLandscapeReturn = true
this._expandBarConfigurationOnLandscapeReturn = false
vibrate('light')
wx.navigateTo({ url: '/pages/dmx-layout-landscape/dmx-layout-landscape' })
},
openPortraitConfiguration() {
if (!this.data.isLandscape) {
this.refreshBarConfiguration({ barConfigurationExpanded: true }, () => this.scrollToBarConfiguration())
return
}
this.saveLayout()
this._skipSaveOnUnload = true
const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
const previous = pages.length > 1 ? pages[pages.length - 2] : null
const previousPortrait = previous?.route === 'pages/dmx-layout/dmx-layout' ? previous : null
const url = '/pages/dmx-layout/dmx-layout?expandBarConfiguration=1'
const restoreLandscapeAfterNavigationFailure = () => {
if (!this._pageAlive) return
this._skipSaveOnUnload = false
this._pageVisible = true
if (previousPortrait) {
previousPortrait._expandBarConfigurationOnLandscapeReturn = false
}
this.setData({ scrollEnabled: true, paletteDragging: false }, () => {
this.measureCanvas(() => this.drawLayout())
})
}
if (previousPortrait) {
previousPortrait._awaitingLandscapeReturn = true
previousPortrait._expandBarConfigurationOnLandscapeReturn = true
wx.navigateBack({ delta: 1, fail: () => {
previousPortrait._expandBarConfigurationOnLandscapeReturn = false
wx.redirectTo({ url, fail: restoreLandscapeAfterNavigationFailure })
} })
return
}
wx.redirectTo({ url, fail: restoreLandscapeAfterNavigationFailure })
},
scrollToBarConfiguration() {
if (!this._pageAlive || !this._pageVisible || !this.data.barConfigurationExpanded) return
clearTimeout(this._scrollTargetTimer)
this.setData({ scrollIntoViewTarget: '' }, () => {
if (!this._pageAlive || !this._pageVisible || !this.data.barConfigurationExpanded) return
this.setData({ scrollIntoViewTarget: 'dmxBarConfigurationPanel' }, () => {
this._scrollTargetTimer = setTimeout(() => {
this._scrollTargetTimer = null
if (this._pageAlive) this.setData({ scrollIntoViewTarget: '' })
}, 350)
})
})
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
clearTimeout(this._measureTimer)
let drew = false
const active = () => this._pageAlive && this._pageVisible && this._measureToken === token
const later = (attempt) => { if (this.data.isLandscape && attempt < 3) this._measureTimer = setTimeout(() => retry(attempt + 1), [60, 160, 380][attempt]) }
const retry = (attempt) => {
if (!active()) return
const finish = (rect) => {
if (!active()) return
const measuredWidth = Number(rect?.width), measuredHeight = Number(rect?.height)
if (this.data.isLandscape && (!(measuredWidth > 0) || !(measuredHeight > 0))) {
later(attempt)
return
}
const width = measuredWidth > 0 ? measuredWidth : 350
const logicalWidth = this.data.canvasWidth || CANVAS_WIDTH, logicalHeight = this.data.canvasHeight || CANVAS_HEIGHT
const height = measuredHeight > 0 ? measuredHeight : width * (logicalHeight / logicalWidth)
const previous = this._canvasRect
const changed = !previous || Math.abs(previous.width - width) > 2 || Math.abs(previous.height - height) > 2
const commit = () => {
if (!active()) return
this._canvasRect = { left: rect?.left || 0, top: rect?.top || 0, width, height }
this._canvasScaleX = width / logicalWidth; this._canvasScaleY = height / logicalHeight
if (callback && (changed || !drew)) { drew = true; callback() }
}
if (!this.data.isLandscape && changed && Math.abs(Number(this.data.canvasDisplayHeight) - height) > 0.5) {
this.setData({ canvasDisplayHeight: height }, commit)
} else {
commit()
}
later(attempt)
}
if (typeof wx.createSelectorQuery === 'function') wx.createSelectorQuery().select('#dmxLayoutCanvasShell').boundingClientRect((rect) => finish(rect)).exec()
else finish(this.data.isLandscape ? null : { left: 0, top: 0, width: 350 })
}
retry(0)
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
const snapshot = createRenderSnapshot(this)
snapshot.viewScale = viewScale
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
if (String(this.data[key]) !== String(event.detail.value)) this.invalidateAutomaticLayoutUndo()
this.setData({ [key]: event.detail.value })
},
onStageBlur(event) {
const key = event.currentTarget.dataset.key
const fallback = key === 'stageWidthText' ? '12' : '8'
const value = String(parsePositive(event.detail.value, Number(fallback)))
const changes = { [key]: value }
if (String(this.data[key]) !== value) this.invalidateAutomaticLayoutUndo()
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
this.applyBarConfiguration('automatic')
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
this.invalidateAutomaticLayoutUndo()
vibrate('light')
this.setData({ schemeIndex }, () => this.rebuildPositionDefinitions(true))
},
onSidePairChange(event) {
const sidePairIndex = Number(event.detail.value)
if (![0, 1, 2].includes(sidePairIndex) || sidePairIndex === this.data.sidePairIndex) return
this.invalidateAutomaticLayoutUndo()
this._sidePairManual = true
vibrate('light')
this.setData({ sidePairIndex }, () => this.rebuildPositionDefinitions(true))
},
onRowChange(event) {
const rowIndex = Number(event.detail.value)
if (!Number.isInteger(rowIndex) || rowIndex === this.data.rowIndex) return
this.invalidateAutomaticLayoutUndo()
this.setData({ rowIndex }, () => {
this.rebuildPositionDefinitions(true)
})
},
onFrontChange(event) {
const frontIndex = Number(event.detail.value)
if (![0, 1].includes(frontIndex) || frontIndex === this.data.frontIndex) return
this.invalidateAutomaticLayoutUndo()
vibrate('light')
this.setData({ frontIndex }, () => {
this.clearImage()
this.saveLayout()
this.drawLayout()
})
},
applyAutomaticLayout() {
const placedCount = this._fixtures.reduce(
(count, fixture) => count + Number(Boolean(this._positions[posKey(fixture)])),
0,
)
const shouldConfirm = placedCount > 0
&& ['manual', 'configured', 'unknown'].includes(this._positionSource)
const apply = () => {
this._automaticLayoutUndoSnapshot = {
positions: cloneJson(this._positions || {}),
barCounts: cloneJson(this._barCounts || []),
preserve: Boolean(this._preserve),
positionSource: this._positionSource || 'unknown',
positionAutoFilledCount: this._positionAutoFilledCount || 0,
}
this.setData({ automaticLayoutUndoVisible: true })
this._barCounts = balancedBars(this._groups, this._positionDefinitions.length)
this.setPositionSource('automatic')
this.refreshBarConfiguration()
this.applyBarConfiguration('automatic', { preserveAutomaticLayoutUndo: true })
}
if (!shouldConfirm) {
apply()
return
}
wx.showModal({
title: '自动排布会覆盖现有位置',
content: `当前已有 ${placedCount} 台灯具布置完成，继续后将按默认灯位方案重新排布。`,
confirmText: '覆盖排布',
cancelText: '取消',
success: ({ confirm }) => {
if (confirm && this._pageAlive && this._pageVisible) apply()
},
})
},
undoAutomaticLayout() {
const snapshot = this._automaticLayoutUndoSnapshot
if (!snapshot) return
const selectedKey = this._selectedKey || ''
this._positions = cloneJson(snapshot.positions)
this._barCounts = cloneJson(snapshot.barCounts)
this._preserve = snapshot.preserve
this.setPositionSource(snapshot.positionSource, snapshot.positionAutoFilledCount)
const selectedFixture = this._fixtures.find((item) => (
posKey(item) === selectedKey && this._positions[selectedKey]
))
this._selectedKey = selectedFixture ? selectedKey : ''
this._selGroup = selectedFixture ? selectedFixture.groupIndex : undefined
this._automaticLayoutUndoSnapshot = null
const status = barStatus(this._barCounts, this._groups)
this.refreshBarConfiguration({
automaticLayoutUndoVisible: false,
selectedFixture: selectedFixture ? {
groupName: selectedFixture.groupName,
fixtureIndex: selectedFixture.fixtureIndex,
addressText: selectedFixture.addressText,
rangeText: selectedFixture.rangeText,
channelCount: selectedFixture.channelCount,
completed: this._checkedKeys.has(progKey(selectedFixture)),
progressKey: progKey(selectedFixture),
} : null,
searchResultText: '',
addressLabelModeText: !this.data.addressLabelsVisible
? '显示地址'
: this.data.addressLabelMode === 'all' ? '全部地址' : '智能地址',
layoutImagePath: '',
previewVisible: false,
barConfigurationStatusText: status.text,
barConfigurationValid: status.valid,
...this.getPositionSummaryData(),
})
this.refreshFixturePalette(this.data.paletteGroupIndex, () => {
this.saveLayout()
this.measureCanvas(() => this.drawLayout())
})
},
refreshBarConfiguration(extra = {}, callback) {
const status = barStatus(this._barCounts, this._groups)
this.setData({
...extra,
barRows: createBarRows(this._barCounts, this._groups, this._positionDefinitions),
barConfigurationStatusText: status.text,
barConfigurationValid: status.valid,
}, callback)
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
...this.getPositionSummaryData(),
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
const existing = d ? this.getBatchTargetFixtures(d) : []
const existingCount = existing.length
const selectedGroupIndex = fs[start]?.groupIndex
const interleavesGroups = existing.some((fixture) => fixture.groupIndex !== selectedGroupIndex)
const batchPreviewText = !count
? '请选择有效的地址范围'
: interleavesGroups
? `本组${count}台将沿${label}与已有${existingCount}台交错重排`
: existingCount
? `本组${count}台将沿${label}与已有${existingCount}台重新等距排布`
: `本组${count}台将沿${label}均匀排列`
this.setData({ batchStartIndex: start, batchEndIndex: end, batchPreviewText })
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
const ordered = interleaveBatchFixtures(this.getBatchTargetFixtures(d).concat(fs.slice(start, end + 1)))
if (this.data.batchDirectionIndex === 1) ordered.reverse()
const side = d.zone.startsWith('side-'), rail = side ? sideRange(d.positionIndex, this.data.sidePairIndex + 1) : null
ordered.forEach((f, i) => { const n = (i + 1) / (ordered.length + 1); this._positions[posKey(f)] = { zone: d.zone, positionIndex: d.positionIndex, x: side ? (d.zone === 'side-left' ? 0 : 1) : n, y: side ? clamp(rail.start + n * (rail.end - rail.start), .03, .97) : d.zone === 'front' ? 1 : defY(d, this.data.rowIndex + 1, this.data.sidePairIndex + 1) } })
this._finishBatchEdit()
},
_finishBatchEdit(source = 'manual') {
this.invalidateAutomaticLayoutUndo(); this._preserve = true; this.setPositionSource(source); this._selectedKey = ''; this._selGroup = undefined; this.syncBarConfigurationFromPositions(); this.refreshFixturePalette(); vibrate('medium')
this.setData({ batchVisible: false, selectedFixture: null, searchResultText: '' }, () => { this.clearImage(); this.saveLayout(); this.drawLayout() })
},
clearBatchPosition() {
const d = this._positionDefinitions?.[this.data.batchPositionIndex], targets = this.getBatchTargetFixtures(d)
if (!d) return wx.showToast({ title: '请选择目标灯位', icon: 'none' })
if (!targets.length) return wx.showToast({ title: '当前灯位没有已布置灯具', icon: 'none' })
wx.showModal({ title: '清空当前灯位', content: `将移除${d.label}上的${targets.length}台灯具，其他灯位不变。`, confirmText: '清空', confirmColor: '#d70015', success: ({ confirm }) => {
if (!confirm) return
targets.forEach((f) => { delete this._positions[posKey(f)] })
const hasPositions = this._fixtures.some((fixture) => this._positions[posKey(fixture)])
this._finishBatchEdit(hasPositions ? 'manual' : 'empty')
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
this.invalidateAutomaticLayoutUndo()
this._positions = Object.create(null)
this._preserve = true
this.setPositionSource('empty')
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
this.invalidateAutomaticLayoutUndo()
this.flushDraw()
vibrate('light')
this.setPositionSource('manual')
this.syncBarConfigurationFromPositions()
this.setData(this.getPositionSummaryData())
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
this.invalidateAutomaticLayoutUndo()
this._positions[key] = placement.position
this._preserve = true
this.setPositionSource('manual')
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
this.invalidateAutomaticLayoutUndo()
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
this.invalidateAutomaticLayoutUndo()
this._barCounts = balancedBars(this._groups, this._positionDefinitions.length)
vibrate('light')
this.refreshBarConfiguration()
},
applyBarConfiguration(source = 'configured', options = {}) {
if (typeof source !== 'string' || !['automatic', 'configured'].includes(source)) source = 'configured'
if (!options || typeof options !== 'object') options = {}
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
if (!options.preserveAutomaticLayoutUndo) this.invalidateAutomaticLayoutUndo()
this._positions = positions
this._preserve = false
this.setPositionSource(source)
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
const exportLayout = getExportAddressLayout(createRenderSnapshot(this))
const exportCanvasHeight = exportLayout.canvasHeight
vibrate('medium')
if (typeof wx.showLoading === 'function') wx.showLoading({ title: '正在生成', mask: true })
this.setData({ isGeneratingImage: true, exportCanvasActive: true, exportCanvasHeight }, () => {
if (!isGenerationActive()) return
 const drawExportCanvas = () => this.drawLayout({ exportMode: true }, () => {
if (!isGenerationActive()) return
wx.canvasToTempFilePath({
canvasId: EXPORT_CANVAS_ID,
x: 0,
y: 0,
width: this.data.canvasWidth,
height: this.data.exportCanvasHeight,
destWidth: exportLayout.destWidth,
destHeight: exportLayout.destHeight,
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

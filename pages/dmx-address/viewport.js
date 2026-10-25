const FIXTURE_SEARCH_MIN_SCROLL_HEIGHT = 24
const FIXTURE_SEARCH_BATCH_FOOTER_GAP = 6

function finiteNumber(value) {
if (value === null || value === undefined || value === '') return null
const number = Number(value)
return Number.isFinite(number) ? number : null
}
function positiveDimension(...values) {
for (const value of values) {
const number = finiteNumber(value)
if (number !== null && number > 0) return number
}
return null
}
function getLightingViewportMetrics(resize = {}) {
let systemInfo = {}
try {
const current = wx.getSystemInfoSync?.()
if (current && typeof current === 'object') systemInfo = current
} catch (_) {}
const size = resize && typeof resize === 'object' ? resize : {}
const windowHeight = positiveDimension(size.windowHeight, systemInfo.windowHeight, 720)
const windowWidth = positiveDimension(size.windowWidth, systemInfo.windowWidth, 390)
const rawStatusBarHeight = finiteNumber(systemInfo.statusBarHeight)
const statusBarHeight = Math.min(windowHeight, Math.max(0, rawStatusBarHeight !== null && rawStatusBarHeight >= 0 ? rawStatusBarHeight : Math.min(24, windowHeight)))
let capsule = null
try {
const candidate = wx.getMenuButtonBoundingClientRect?.()
const left = finiteNumber(candidate?.left)
const right = finiteNumber(candidate?.right)
const top = finiteNumber(candidate?.top)
const bottom = finiteNumber(candidate?.bottom)
const width = finiteNumber(candidate?.width)
const height = finiteNumber(candidate?.height)
if (candidate && left !== null && right !== null && top !== null && bottom !== null
&& left >= 0 && right > left && right <= windowWidth + 1
&& top >= 0 && bottom > top && bottom <= windowHeight + 1
&& (width === null || width >= 0) && (height === null || height >= 0)) {
capsule = { left, right, top, bottom, width: width ?? right - left, height: height ?? bottom - top }
}
} catch (_) {}
const fallbackCapsuleBottom = Math.min(windowHeight, statusBarHeight + Math.min(36, Math.max(0, windowHeight - statusBarHeight)))
const capsuleBottom = capsule ? capsule.bottom : fallbackCapsuleBottom
const expectedSafeTop = Math.ceil(Math.max(capsuleBottom + 8, statusBarHeight + 52))
const rawSafeAreaBottom = finiteNumber(systemInfo.safeArea?.bottom)
const safeAreaValid = rawSafeAreaBottom !== null && rawSafeAreaBottom > 0 && rawSafeAreaBottom <= windowHeight + 1
const safeBottomInset = safeAreaValid ? Math.max(12, windowHeight - rawSafeAreaBottom + 8) : 12
const overlaySafeBottom = Math.min(windowHeight, Math.ceil(Math.max(0, safeBottomInset)))
const overlaySafeTop = Math.max(0, Math.min(expectedSafeTop, Math.max(0, windowHeight - overlaySafeBottom - 1)))
const overlayMaxHeight = Math.max(1, windowHeight - overlaySafeTop - overlaySafeBottom)
const overlaySearchMaxHeight = Math.min(Math.round(windowHeight * 0.88), overlayMaxHeight)
const overlaySearchSheetHeight = Math.min(overlayMaxHeight, Math.round(windowHeight <= 360 ? overlayMaxHeight : windowHeight * 0.78))
const navigationBodyHeight = Math.min(Math.max(0, windowHeight - statusBarHeight), Math.max(44, capsule ? capsule.bottom - statusBarHeight + 8 : 44))
return {
statusBarHeight,
navigationHeight: statusBarHeight + navigationBodyHeight,
shareTop: Math.min(windowHeight, statusBarHeight + Math.max(0, (navigationBodyHeight - 40) / 2)),
windowHeight,
windowWidth,
overlaySafeTop,
overlaySafeBottom,
overlayMaxHeight,
overlayCenterTop: overlaySafeTop + overlayMaxHeight / 2,
overlaySearchMaxHeight,
overlaySearchSheetHeight,
...getFixtureSearchScrollMetrics({ windowHeight, overlaySearchSheetHeight }, false, 0),
overlayPendingMaxHeight: Math.min(Math.round(windowHeight * 0.8), overlayMaxHeight),
overlayAddMaxHeight: Math.min(Math.round(windowHeight * 0.88), overlayMaxHeight),
overlaySaveMaxHeight: Math.min(Math.round(windowHeight * 0.66), overlayMaxHeight),
overlayGuideHeight: Math.min(Math.round(windowHeight * 0.82), overlayMaxHeight),
overlayReportHeight: Math.min(Math.round(windowHeight * 0.84), overlayMaxHeight),
overlaySaveListMaxHeight: Math.min(Math.round(windowHeight * 0.34), Math.round(overlayMaxHeight * 0.48)),
}
}
function getFixtureSearchScrollMetrics(metrics = {}, batchOpen = false, selectedCount = 0) {
const windowHeight = positiveDimension(metrics.windowHeight, 720)
const sheetHeight = Math.max(1, finiteNumber(metrics.overlaySearchSheetHeight) ?? Math.min(windowHeight, 560))
const chromeHeight = windowHeight <= 360 ? 132 : 198
const availableHeight = Math.max(1, sheetHeight - chromeHeight)
const footerVisible = Boolean(batchOpen && Number(selectedCount) > 0)
let fixtureBatchFooterHeight = 0
if (footerVisible) {
const count = Math.max(0, Number(selectedCount) || 0)
const minimumResultsHeight = Math.min(82, Math.max(FIXTURE_SEARCH_MIN_SCROLL_HEIGHT, Math.round(availableHeight * 0.15)))
const panelFooterLimit = Math.max(48, availableHeight - FIXTURE_SEARCH_BATCH_FOOTER_GAP - minimumResultsHeight)
const viewportFooterLimit = Math.max(48, Math.round(windowHeight * 0.28))
fixtureBatchFooterHeight = Math.max(48, Math.min(48 + count * 36, panelFooterLimit, viewportFooterLimit))
}
const footerSpace = footerVisible ? fixtureBatchFooterHeight + FIXTURE_SEARCH_BATCH_FOOTER_GAP : 0
return {
fixtureSearchResultsHeight: Math.max(1, availableHeight - footerSpace),
fixtureBatchFooterHeight,
batchSelectedListHeight: footerVisible ? Math.max(0, fixtureBatchFooterHeight - 48) : 0,
}
}
function computeFloatingCardFrame(group = {}, info = {}, safeTop = 76, safeBottom = 12) {
const width = positiveDimension(info.windowWidth, 390)
const height = positiveDimension(info.windowHeight, 720)
const topInset = Math.min(height, Math.max(0, finiteNumber(safeTop) ?? 76))
const bottomInset = Math.min(Math.max(0, height - topInset), Math.max(0, finiteNumber(safeBottom) ?? 12))
const availableHeight = Math.max(1, height - topInset - bottomInset)
const targetWidth = Math.max(1, Math.min(width - 24, 520))
const contentWidth = Math.max(0, targetWidth - 28)
const chipColumns = Math.max(1, Math.floor((contentWidth + 6) / 54))
const chipRows = Math.ceil(Math.max(0, Number(group.fixtureChips?.length) || 0) / chipColumns)
const naturalHeight = 28 + 105 + (group.hasChannelGuide ? 27 : 0) + chipRows * 50
const cardHeight = Math.max(1, Math.min(availableHeight, Math.max(Math.min(180, availableHeight), naturalHeight)))
const targetLeft = Math.max(0, Math.min(width - targetWidth, Math.round((width - targetWidth) / 2)))
const targetTop = Math.max(topInset, Math.min(topInset + availableHeight - cardHeight, Math.round(topInset + Math.max(0, (availableHeight - cardHeight) / 2))))
return { targetLeft, targetTop, targetWidth, cardHeight, availableHeight }
}

function getAddressCardChipColumns(windowWidth = 390) {
const width = positiveDimension(windowWidth, 390)
const pagePadding = width <= 350 ? 12 : 16
const chipAreaWidth = Math.max(1, width - pagePadding * 2 - 20)
return Math.max(1, Math.floor((chipAreaWidth + 4) / (38 + 4)))
}

module.exports = {
getLightingViewportMetrics,
getFixtureSearchScrollMetrics,
computeFloatingCardFrame,
getAddressCardChipColumns,
}

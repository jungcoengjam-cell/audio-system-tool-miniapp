const MIN_NAV_CONTENT_HEIGHT = 44
const MIN_NAV_SIDE_WIDTH = 88
const MENU_RIGHT_PADDING = 12

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function getReportNavigationMetrics(windowInfo = {}, menuRect = null) {
  const statusBarHeightPx = finiteNonNegative(windowInfo.statusBarHeight, 20)
  const windowWidth = finiteNonNegative(windowInfo.windowWidth, 375)
  const validMenuRect = menuRect
    && finiteNonNegative(menuRect.left, -1) >= 0
    && finiteNonNegative(menuRect.top, -1) >= statusBarHeightPx
    && finiteNonNegative(menuRect.height, 0) > 0
  const menuGap = validMenuRect ? Math.max(0, menuRect.top - statusBarHeightPx) : 0
  const navContentHeightPx = validMenuRect
    ? Math.max(MIN_NAV_CONTENT_HEIGHT, Math.round(menuRect.height + (menuGap * 2)))
    : MIN_NAV_CONTENT_HEIGHT
  const navSideWidthPx = validMenuRect
    ? Math.max(MIN_NAV_SIDE_WIDTH, Math.ceil(windowWidth - menuRect.left + MENU_RIGHT_PADDING))
    : MIN_NAV_SIDE_WIDTH
  return {
    statusBarHeightPx,
    navContentHeightPx,
    navBarTotalHeightPx: statusBarHeightPx + navContentHeightPx,
    navSideWidthPx,
  }
}

module.exports = { getReportNavigationMetrics }

function readLayoutViewportMetrics(wxApi, isLandscape, eventSize = {}) {
  const readInfo = (method) => {
    try {
      const value = typeof wxApi[method] === 'function' ? wxApi[method]() : null
      return value && typeof value === 'object' ? value : {}
    } catch (_) {
      return {}
    }
  }
  const windowInfo = readInfo('getWindowInfo')
  const systemInfo = readInfo('getSystemInfoSync')
  const info = { ...systemInfo, ...windowInfo }
  const safeArea = info.safeArea && typeof info.safeArea === 'object' ? info.safeArea : {}
  const safeInsets = info.safeAreaInsets && typeof info.safeAreaInsets === 'object' ? info.safeAreaInsets : {}
  const finitePositive = (value) => {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 && number <= 10000 ? number : 0
  }
  const eventWidth = finitePositive(eventSize.windowWidth || eventSize.width)
  const eventHeight = finitePositive(eventSize.windowHeight || eventSize.height)
  const windowWidth = eventWidth || finitePositive(windowInfo.windowWidth) || finitePositive(systemInfo.windowWidth)
    || (isLandscape ? 844 : 390)
  const windowHeight = eventHeight || finitePositive(windowInfo.windowHeight) || finitePositive(systemInfo.windowHeight)
    || (isLandscape ? 390 : 844)
  const boundedNonnegative = (value, maximum) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.min(maximum, number) : 0
  }
  const statusBarValue = Number.isFinite(Number(windowInfo.statusBarHeight))
    ? Number(windowInfo.statusBarHeight)
    : Number.isFinite(Number(systemInfo.statusBarHeight))
      ? Number(systemInfo.statusBarHeight)
      : safeArea.top
  const rawStatusBarHeight = boundedNonnegative(statusBarValue, Math.min(100, windowHeight))
  let rawCapsule = null
  try {
    rawCapsule = typeof wxApi.getMenuButtonBoundingClientRect === 'function'
      ? wxApi.getMenuButtonBoundingClientRect()
      : null
  } catch (_) {
    rawCapsule = null
  }
  const capsuleLeft = Number(rawCapsule && rawCapsule.left)
  const capsuleTop = Number(rawCapsule && rawCapsule.top)
  const capsuleRight = Number(rawCapsule && rawCapsule.right)
  const capsuleBottom = Number(rawCapsule && rawCapsule.bottom)
  const capsuleWidth = capsuleRight - capsuleLeft
  const capsuleHeight = capsuleBottom - capsuleTop
  const capsuleValid = Number.isFinite(capsuleLeft) && Number.isFinite(capsuleTop)
    && Number.isFinite(capsuleRight) && Number.isFinite(capsuleBottom)
    && capsuleLeft >= 0 && capsuleTop >= 0 && capsuleRight > capsuleLeft && capsuleBottom > capsuleTop
    && capsuleRight <= windowWidth && capsuleBottom <= windowHeight
    && capsuleWidth <= Math.min(200, windowWidth) && capsuleHeight <= 100
  const capsule = capsuleValid ? rawCapsule : null
  const statusBarHeight = isLandscape && capsule && capsuleTop < rawStatusBarHeight
    ? capsuleTop
    : rawStatusBarHeight
  const validSafeBottom = Number(safeArea.bottom)
  const insetBottom = Number(safeInsets.bottom)
  const safeBottom = Number.isFinite(validSafeBottom) && validSafeBottom > 0 && validSafeBottom <= windowHeight
    ? windowHeight - validSafeBottom
    : boundedNonnegative(insetBottom, windowHeight)
  const maxNavigationBody = Math.max(0, windowHeight - statusBarHeight)
  const requestedNavigationBody = capsule
    ? Math.max(44, capsuleBottom - statusBarHeight + 8)
    : 44
  const navigationBodyHeight = Math.min(maxNavigationBody, requestedNavigationBody)
  const navigationHeight = Math.min(windowHeight, statusBarHeight + navigationBodyHeight)
  const shareTop = Math.min(Math.max(0, windowHeight - 44), statusBarHeight + Math.max(0, (navigationBodyHeight - 44) / 2))
  const requestedShareRight = capsule ? Math.max(8, windowWidth - capsuleLeft + 8) : 12
  const shareRight = Math.min(Math.max(0, windowWidth - 44), requestedShareRight)
  const shareLeft = Math.max(0, windowWidth - shareRight - 44)
  const navTitleCenter = windowWidth / 2
  const overlayTopLimit = Math.max(0, windowHeight - safeBottom)
  const overlaySafeTop = Math.min(overlayTopLimit, Math.ceil(Math.max(
    capsule ? capsuleBottom + 8 : 0,
    navigationHeight + 8,
  )))
  const overlayAvailableHeight = Math.max(0, windowHeight - overlaySafeTop - safeBottom)
  const placementCardMaxHeight = Math.max(0, Math.min(600, windowHeight * .7, overlayAvailableHeight - 24))
  const selectorHeight = isLandscape ? 0 : 44
  const toolbarBaseHeight = isLandscape ? 58 : 62
  const toolbarHeight = toolbarBaseHeight + safeBottom
  const toolbarContentBottomPadding = 4 + safeBottom
  const canvasShellHeight = Math.max(0, windowHeight - navigationHeight - selectorHeight - toolbarHeight)
  return {
    windowWidth,
    windowHeight,
    statusBarHeight,
    navigationHeight,
    toolbarHeight,
    toolbarContentBottomPadding,
    navTitleCenter,
    shareTop,
    shareRight,
    canvasShellHeight,
    canvasWidth: windowWidth,
    canvasHeight: canvasShellHeight,
    overlaySafeTop,
    overlaySafeBottom: safeBottom,
    overlayAvailableHeight,
    placementCardMaxHeight,
    settingsBodyMaxHeight: Math.min(overlayAvailableHeight, Math.max(0, overlayAvailableHeight - 118)),
  }
}

module.exports = { readLayoutViewportMetrics }

function getDevicePixelRatio(wxApi = typeof wx !== 'undefined' ? wx : null) {
  if (!wxApi) return 1
  try {
    const windowInfo = typeof wxApi.getWindowInfo === 'function' ? wxApi.getWindowInfo() : null
    const systemInfo = typeof wxApi.getSystemInfoSync === 'function' ? wxApi.getSystemInfoSync() : null
    const ratio = Number(windowInfo && windowInfo.pixelRatio || systemInfo && systemInfo.pixelRatio)
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  } catch (_) {
    return 1
  }
}

function createCanvas2DAdapter(context) {
  if (!context) throw new Error('2D canvas context is unavailable')
  return {
    setFillStyle(value) { context.fillStyle = value },
    setStrokeStyle(value) { context.strokeStyle = value },
    setLineWidth(value) { context.lineWidth = value },
    setFontSize(value) { context.font = `${Number(value) || 16}px -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif` },
    setTextAlign(value) { context.textAlign = value },
    setLineDash(value, offset) {
      if (typeof context.setLineDash === 'function') context.setLineDash(value)
      if (Number.isFinite(Number(offset))) context.lineDashOffset = Number(offset)
    },
    measureText(value) { return context.measureText(String(value)) },
    supportsArc: typeof context.arc === 'function',
    beginPath(...args) { return context.beginPath(...args) },
    closePath(...args) { return context.closePath(...args) },
    moveTo(...args) { return context.moveTo(...args) },
    lineTo(...args) { return context.lineTo(...args) },
    arc(...args) { return context.arc(...args) },
    rect(...args) { return context.rect(...args) },
    quadraticCurveTo(...args) { return context.quadraticCurveTo(...args) },
    clip(...args) { return context.clip(...args) },
    save(...args) { return context.save(...args) },
    restore(...args) { return context.restore(...args) },
    fill(...args) { return context.fill(...args) },
    stroke(...args) { return context.stroke(...args) },
    fillRect(...args) { return context.fillRect(...args) },
    strokeRect(...args) { return context.strokeRect(...args) },
    fillText(...args) { return context.fillText(...args) },
  }
}

function configureCanvas2DNode(node, width, height, pixelRatio = 1) {
  if (!node || typeof node.getContext !== 'function') throw new Error('2D canvas node is unavailable')
  const logicalWidth = Math.max(1, Number(width) || 1)
  const logicalHeight = Math.max(1, Number(height) || 1)
  const ratio = Number(pixelRatio) > 0 ? Number(pixelRatio) : 1
  const backingWidth = Math.max(1, Math.round(logicalWidth * ratio))
  const backingHeight = Math.max(1, Math.round(logicalHeight * ratio))
  if (node.width !== backingWidth) node.width = backingWidth
  if (node.height !== backingHeight) node.height = backingHeight
  const context = node.getContext('2d')
  if (!context || typeof context.setTransform !== 'function') throw new Error('2D canvas context is unavailable')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  return {
    node,
    context,
    rendererContext: createCanvas2DAdapter(context),
    pixelRatio: ratio,
    width: logicalWidth,
    height: logicalHeight,
  }
}

module.exports = { getDevicePixelRatio, createCanvas2DAdapter, configureCanvas2DNode }

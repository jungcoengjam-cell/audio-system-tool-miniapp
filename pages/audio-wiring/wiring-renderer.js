const LIGHT = {
  background: '#ffffff', card: '#f1f2f4', text: '#1d1d1f', secondary: '#60646b',
  tertiary: '#858a91', border: '#d9dde2', pin: '#ffffff',
  positive: '#1976d2', negative: '#9a5b00', shield: '#5f6872', left: '#1976d2', right: '#7257ce',
  error: '#b42318', errorBackground: '#fff1ef',
}
const DARK = {
  background: '#111214', card: '#24272b', text: '#f5f5f7', secondary: '#c1c5cc',
  tertiary: '#9ca3ad', border: '#454a52', pin: '#17191c',
  positive: '#69aef7', negative: '#ffb458', shield: '#b9c0ca', left: '#69aef7', right: '#bb9bff',
  error: '#ff8b81', errorBackground: '#401d1b',
}

const { getSolderPhotoSpec, getConnectorOverviewPhotoSpec } = require('./wiring-photos')
const { getWiringGuide, getCompactWiringConditions } = require('./wiring-display')
const { lookupSolderRoutes, makeSolderRouteMatchParts } = require('./solder-route-table')

function themeFor(theme) {
  return theme === 'dark' ? DARK : LIGHT
}

function setText(ctx, size, color, weight = 400, align = 'left') {
  ctx.setFontSize(size)
  ctx.setFillStyle(color)
  ctx.setTextAlign(align)
  ctx.setTextBaseline('alphabetic')
  ctx.font = `${weight} ${size}px sans-serif`
}

function text(ctx, value, x, y, size, color, weight = 400, align = 'left') {
  setText(ctx, size, color, weight, align)
  ctx.fillText(String(value), x, y)
}

function textLines(value, maxChars, maxLines = Infinity) {
  const chars = [...String(value || '')]
  const limit = Math.max(1, Math.floor(maxChars || 1))
  const rows = []
  let row = []
  const closingPunctuation = new Set([...`，。；：、！？）》】〕〉”’」』…％,.;:!?)]}`])
  chars.forEach((character) => {
    if (row.length < limit) { row.push(character); return }
    if (character === ' ') { rows.push(row.join('')); row = [' ']; return }
    if (closingPunctuation.has(character) && row.length > 1) {
      let carryStart = row.length - 1
      while (carryStart > 0 && closingPunctuation.has(row[carryStart])) carryStart -= 1
      if (carryStart === 0) { rows.push(row.join('')); row = [character]; return }
      rows.push(row.slice(0, carryStart).join(''))
      row = row.slice(carryStart).concat(character)
      return
    }
    const whitespace = row.lastIndexOf(' ')
    if (whitespace > 0) {
      rows.push(row.slice(0, whitespace + 1).join(''))
      row = row.slice(whitespace + 1).concat(character)
    } else {
      rows.push(row.join(''))
      row = [character]
    }
  })
  if (row.length) rows.push(row.join(''))
  if (rows.length <= maxLines) return rows
  const shortened = rows.slice(0, maxLines)
  shortened[maxLines - 1] = `${[...shortened[maxLines - 1]].slice(0, Math.max(1, limit - 1)).join('')}…`
  return shortened
}

function wrappedText(ctx, value, x, y, width, size, color, weight = 400, align = 'left', maxLines = 3) {
  const chars = Math.max(1, Math.floor(width / size))
  const rows = textLines(value, chars, maxLines)
  rows.forEach((line, index) => text(ctx, line, x, y + (index * size * 1.35), size, color, weight, align))
  return rows.length
}

function solderEndpointTitle(endpoint) {
  if (!endpoint) return '接口'
  if (endpoint.id === 'xlrBalanced') return `XLR ${endpoint.cableConnectorGender || '接头'}${endpoint.channelCount === 2 ? ' ×2' : ''}`
  if (endpoint.id === 'tsMono') return `6.35 TS·单声道${endpoint.channelCount === 2 ? ' ×2' : ''}`
  if (endpoint.id === 'trsBalanced') return `6.35 大三芯·平衡${endpoint.channelCount === 2 ? ' ×2' : ''}`
  if (endpoint.id === 'stereo635') return `6.35 大三芯·立体声${endpoint.channelCount === 2 ? ' ×2' : ''}`
  if (endpoint.id === 'stereo35') return '3.5 立体声'
  if (endpoint.id === 'rcaMono') return `RCA${endpoint.channelCount === 2 ? ' ×2' : ''}`
  return endpoint.connectorType || endpoint.label || '接口'
}

function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.setFillStyle(fill)
  ctx.fill()
  if (stroke) {
    ctx.setStrokeStyle(stroke)
    ctx.setLineWidth(1)
    ctx.stroke()
  }
}

function line(ctx, points, color, width = 2) {
  if (!points.length) return
  ctx.beginPath()
  ctx.setStrokeStyle(color)
  ctx.setLineWidth(width)
  ctx.moveTo(points[0][0], points[0][1])
  points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y))
  ctx.stroke()
}

function circle(ctx, x, y, radius, fill, stroke, lineWidth = 1) {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  if (fill) {
    ctx.setFillStyle(fill)
    ctx.fill()
  }
  if (stroke) {
    ctx.setStrokeStyle(stroke)
    ctx.setLineWidth(lineWidth)
    ctx.stroke()
  }
}

function connectionColor(connection, theme) {
  const roles = [connection.fromRole, connection.toRole]
  if (roles.includes('negative')) return theme.negative
  if (roles.includes('right')) return theme.right
  if (roles.includes('left')) return theme.left
  if (roles.includes('shield')) return theme.shield
  if (roles.includes('return')) return theme.shield
  if (connection.networkId === 'shield' || connection.id === 'shield' || connection.id === 'return') return theme.shield
  if (connection.networkId === 'right' || connection.id === 'right') return theme.right
  if (connection.id === 'negative') return theme.negative
  return theme.positive
}

function roleColor(role, theme) {
  if (role === 'negative') return theme.negative
  if (role === 'right') return theme.right
  if (role === 'left' || role === 'positive' || role === 'signal') return theme.left
  if (role === 'shield' || role === 'return') return theme.shield
  return theme.tertiary
}

function connectorRows(width, model, metrics) {
  const rows = (model && model.supported ? model.connections : []).map((connection) => ({ connection }))
    .concat((model && model.supported ? model.unconnectedPins || [] : []).map((pin) => ({ pin })))
  let cursorY = metrics.mapTop + 13
  return rows.map((row) => {
    const connection = row.connection
    const mapping = connection ? `${connection.fromLabel} → ${connection.toLabel}`
      : `${row.pin.side === 'output' ? '输出' : '输入'} ${row.pin.label || row.pin.pin} · 悬空：${row.pin.reason || '不连接'}`
    const maxChars = Math.max(1, Math.floor((width - (metrics.padding * 2) - 32) / 12))
    const lines = textLines(mapping, maxChars)
    const height = Math.max(metrics.rowStep, (lines.length * 16) + 8)
    const result = { ...row, mapping, lines, y: cursorY, height }
    cursorY += height
    return result
  })
}

function assignSharedTracks(groups, rowYs, xStart, xEnd) {
  const shared = [...groups.entries()].filter(([, indexes]) => indexes.length > 1)
    .map(([key, indexes]) => ({ key, indexes, first: Math.min(...indexes), last: Math.max(...indexes) }))
    .sort((a, b) => a.first - b.first || a.last - b.last)
  const trackEnds = []
  shared.forEach((group) => {
    let track = trackEnds.findIndex((last) => last < group.first)
    if (track < 0) track = trackEnds.length
    trackEnds[track] = group.last
    group.track = track
  })
  const trackCount = Math.max(1, trackEnds.length)
  const span = Math.max(0, xEnd - xStart)
  const byKey = new Map()
  shared.forEach((group) => {
    const x = xStart + (span * ((group.track + 0.5) / trackCount))
    const ys = group.indexes.map((index) => rowYs[index])
    byKey.set(group.key, { x, ys, centerY: ys.reduce((sum, value) => sum + value, 0) / ys.length, track: group.track })
  })
  return byKey
}

function functionalHitCorridor(model, metrics) {
  const connections = model.connections || []
  const rowYs = connections.map((_, row) => metrics.rowsTop + (row * metrics.rowStep))
  const groupBy = (keyFor) => {
    const groups = new Map()
    connections.forEach((connection, row) => {
      const key = keyFor(connection)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    })
    return groups
  }
  const sourceGroups = groupBy((connection) => `${connection.fromSide || 'output'}:${connection.fromPin}`)
  const targetGroups = groupBy((connection) => `${connection.toSide || 'input'}:${connection.toPin}`)
  const branchStartX = metrics.leftX + metrics.cardWidth
  const branchEndX = metrics.rightX
  const gapMid = (branchStartX + branchEndX) / 2
  const sourceTracks = assignSharedTracks(sourceGroups, rowYs, branchStartX + 6, gapMid - 9)
  const targetTracks = assignSharedTracks(targetGroups, rowYs, gapMid + 9, branchEndX - 6)
  const sourceX = [...sourceTracks.values()].map((track) => track.x)
  const targetX = [...targetTracks.values()].map((track) => track.x)
  const x1 = sourceX.length ? Math.max(...sourceX) + 5 : branchStartX
  const x2 = targetX.length ? Math.min(...targetX) - 5 : branchEndX
  return { left: x1, width: Math.max(0, x2 - x1) }
}

function horizontalWire(ctx, x1, x2, y, color, width, verticalTracks, allowedTracks = []) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
  const gaps = verticalTracks.filter((track) => !allowedTracks.includes(track.x) && track.x > minX && track.x < maxX &&
    y >= track.top && y <= track.bottom).map((track) => track.x).sort((a, b) => a - b)
  let cursor = minX
  gaps.forEach((x) => {
    if (x - 5 > cursor) line(ctx, [[cursor, y], [x - 5, y]], color, width)
    cursor = x + 5
  })
  if (cursor < maxX) line(ctx, [[cursor, y], [maxX, y]], color, width)
}

function layoutFor(width, model, options = {}) {
  if (options.layout === 'solder-wiring') return solderWiringLayout(width, model, options)
  const mode = options.viewMode === 'connectors' ? 'connectors' : 'wiring'
  const headerOffset = options.showTitle === false ? 24 : 0
  const supported = model && model.supported
  const connections = supported ? model.connections : []
  const unconnected = supported && Array.isArray(model.unconnectedPins) ? model.unconnectedPins : []
  const count = connections.length + unconnected.length
  const padding = width < 360 ? 10 : 16
  const detailChars = Math.max(1, Math.floor((width - padding * 2) / 11))
  const detailLines = !supported && model ? (model.selectionSummary || []).concat(model.criticalNotes || [])
    .reduce((sum, value) => sum + textLines(value, detailChars, 4).length, 0) : 0
  const guideChars = Math.max(1, Math.floor((width - padding * 2 - 56) / 12))
  const requirementsLines = model && Array.isArray(model.requirements)
    ? model.requirements.reduce((sum, requirement) => sum +
      textLines(`${requirement.title || requirement.id}：${requirement.hint || '请选择一项后继续。'}`, guideChars, 6).length +
      (requirement.options || []).reduce((optionSum, option) => optionSum +
        textLines(`${option.label}${option.detail ? `：${option.detail}` : ''}`, guideChars, 5).length, 0), 0)
    : 0
  const functionCardWidth = width < 360 ? 82 : Math.max(110, Math.min(190, (width - (padding * 2) - 96) / 2))
  const connectorCardWidth = Math.max(100, (width - (padding * 2) - 16) / 2)
  const cardWidth = mode === 'connectors' ? connectorCardWidth : functionCardWidth
  const leftX = padding
  const rightX = width - padding - cardWidth
  const headerTop = 70 - headerOffset
  const rowsTop = (width < 360 ? 131 : 136) - headerOffset
  const rowStep = width < 360 ? 44 : 52
  const rows = Math.max(1, count)
  if (mode === 'connectors') {
    const connectorAreaHeight = options.face === 'solder' && width < 360 ? 180 : width < 360 ? 150 : 164
    const connectorRowStep = width < 360 ? 44 : 48
    const mapTop = headerTop + connectorAreaHeight + 22
    const connectorLayoutMetrics = { mapTop, padding, rowStep: connectorRowStep }
    const mapRows = connectorRows(width, model, connectorLayoutMetrics)
    const lastRow = mapRows[mapRows.length - 1]
    const mapTextBottom = lastRow
      ? lastRow.y + ((lastRow.lines.length - 1) * 16) + 4
      : mapTop + 13
    const hitBottom = mapRows.filter((row) => row.connection).reduce((bottom, row) =>
      Math.max(bottom, row.y - 13 + row.height), mapTop)
    let height = supported
      ? Math.max(mapTextBottom + 20, hitBottom + 8)
      : (count ? 88 + connectorAreaHeight + (count * connectorRowStep) + 52 - headerOffset : 212 - headerOffset)
    if (options.face === 'solder' && model && model.supported &&
      (model.output.id === 'xlrBalanced' || model.input.id === 'xlrBalanced')) {
      const note = 'XLR焊接面为插接面左右镜像，定位朝上。 TRS/TS焊片随型号而异，按 T/R/S 标记确认。'
      const noteLines = textLines(note, Math.max(1, Math.floor((width - (padding * 2)) / 12))).length
      const noteTop = mapTextBottom + 18
      height = Math.max(height, noteTop + ((noteLines - 1) * 16) + 24)
    }
    if (!supported && requirementsLines) height = Math.max(height, 170 + (requirementsLines * 44) + detailLines * 18 - headerOffset)
    return {
      mode, padding, cardWidth, leftX, rightX, headerTop, rowsTop, mapTop,
      rowStep: connectorRowStep,
      rows: Math.max(1, count), connectorAreaHeight,
      height,
    }
  }
  if (!supported) {
    const reasonLines = textLines(model && model.reason || '没有可用的接线方案。', Math.max(18, Math.floor((width - padding * 2) / 14)), 8).length
    return { mode, padding, cardWidth, leftX, rightX, headerTop, rowsTop, rowStep, rows: 0,
      height: 180 + (reasonLines * 18) + (requirementsLines * 17) + (detailLines * 18) - headerOffset }
  }
  const detailHeight = detailLines ? 20 + (detailLines * 17) : 0
  return {
    mode, padding, cardWidth, leftX, rightX, headerTop, rowsTop, rowStep,
    rows: count,
    height: rowsTop + ((Math.max(1, count) - 1) * rowStep) + 70 + detailHeight,
  }
}

function optionsWithOrigin(options) {
  return { x: Number(options.x) || 0, y: Number(options.y) || 0 }
}

function at(x, y, origin) {
  return [origin.x + x, origin.y + y]
}

function drawHeader(ctx, model, width, theme, origin, options = {}) {
  const cx = origin.x + (width / 2)
  if (options.showTitle !== false) {
    text(ctx, model && model.supported ? model.title : '接线方式暂不可用', cx, origin.y + 24,
      16, theme.text, 600, 'center')
  }
  const headerOffset = options.showTitle === false ? 24 : 0
  const modeText = options.layout === 'solder-wiring'
    ? '焊接端功能示意 · 输出到输入'
    : options.viewMode === 'connectors'
    ? `${options.face === 'solder' ? '焊接面' : '插接面'} · 线缆头示意`
    : '功能连线 · 抽象端子示意（非实体插座）'
  text(ctx, modeText, cx, origin.y + 47 - headerOffset, 12, theme.secondary, 400, 'center')
  if (options.viewMode !== 'connectors' && options.layout !== 'solder-wiring') {
    text(ctx, '实心点汇接；交叉无点不连接', cx, origin.y + 62 - headerOffset, 10, theme.tertiary, 400, 'center')
  }
}

function endpointHeading(ctx, endpoint, side, x, y, width, theme, origin) {
  const cx = origin.x + x + (width / 2)
  const direction = side === 'output' ? '输出端' : '输入端'
  const connector = endpoint.id === 'xlrBalanced' ? 'XLR'
    : endpoint.id === 'trsBalanced' ? '6.35 大三芯·平衡'
      : endpoint.id === 'terminalBalanced' ? '平衡端子'
        : endpoint.id === 'stereo35' ? '3.5 立体声'
          : endpoint.id === 'stereo635' ? '6.35 大三芯·立体声'
          : endpoint.id === 'rcaStereo' ? '双 RCA'
            : endpoint.id === 'tsStereo' ? '双 TS'
              : endpoint.id === 'rcaMono' ? 'RCA' : '6.35 TS'
  text(ctx, direction, cx, origin.y + y + 14, 13, theme.text, 600, 'center')
  text(ctx, connector, cx, origin.y + y + 32, 12, theme.secondary, 400, 'center')
}

function drawUnsupported(ctx, model, width, height, theme, origin, options) {
  const metrics = layoutFor(width, model, options)
  const headerOffset = options.showTitle === false ? 24 : 0
  const y = origin.y + 72 - headerOffset
  roundedRect(ctx, origin.x + 14, y, width - 28, height - 88 + (headerOffset * 2), 14, theme.errorBackground, theme.border)
  let cursorY = y + 27
  const lineCount = wrappedText(ctx, model && model.reason || '没有可用的接线方案。', origin.x + 28,
    cursorY, width - 56, 13, theme.error, 500, 'left', 8)
  cursorY += (lineCount * 18) + 7
  ;((model && model.requirements) || []).forEach((requirement) => {
    const label = requirement.title || requirement.id
    cursorY += wrappedText(ctx, `${label}：${requirement.hint || '请选择一项后继续。'}`,
      origin.x + 28, cursorY, width - 56, 12, theme.text, 500, 'left', 6) * 16 + 3
    ;((requirement.options) || []).forEach((option) => {
      cursorY += wrappedText(ctx, `${option.label}${option.detail ? `：${option.detail}` : ''}`,
        origin.x + 38, cursorY, width - 76, 11, theme.secondary, 400, 'left', 5) * 15 + 2
    })
  })
  ;((model && model.selectionSummary) || []).concat((model && model.criticalNotes) || []).forEach((note) => {
    cursorY += wrappedText(ctx, note, origin.x + 28, cursorY, width - 56, 12,
      theme.secondary, 400, 'left', 5) * 16 + 2
  })
  text(ctx, '未生成连接线 · 请核对设备说明书', origin.x + (width / 2), cursorY + 7,
    12, theme.secondary, 400, 'center')
  return metrics
}

function drawFunctional(ctx, model, width, height, theme, origin, options = {}) {
  if (!model || !model.supported) return drawUnsupported(ctx, model, width, height, theme, origin, options)
  const metrics = layoutFor(width, model, options)
  const bodyTop = metrics.headerTop + 38
  const rows = model.connections.map((connection) => ({ type: 'connection', connection }))
    .concat((model.unconnectedPins || []).map((pin) => ({ type: 'open', pin })))
  const visibleRows = Math.max(1, rows.length)
  const cardHeight = (metrics.rowsTop - bodyTop) + ((visibleRows - 1) * metrics.rowStep) + 16
  roundedRect(ctx, origin.x + metrics.leftX, origin.y + bodyTop, metrics.cardWidth, cardHeight, 10, theme.card, theme.border)
  roundedRect(ctx, origin.x + metrics.rightX, origin.y + bodyTop, metrics.cardWidth, cardHeight, 10, theme.card, theme.border)
  endpointHeading(ctx, model.output, 'output', metrics.leftX, metrics.headerTop, metrics.cardWidth, theme, origin)
  endpointHeading(ctx, model.input, 'input', metrics.rightX, metrics.headerTop, metrics.cardWidth, theme, origin)

  const rowYs = rows.map((_, index) => metrics.rowsTop + (index * metrics.rowStep))
  const branchStartX = metrics.leftX + metrics.cardWidth
  const branchEndX = metrics.rightX
  const branchX1 = Math.round(branchStartX + ((branchEndX - branchStartX) * 0.24))
  const branchX2 = Math.round(branchStartX + ((branchEndX - branchStartX) * 0.76))
  const sourceGroups = new Map()
  const targetGroups = new Map()
  model.connections.forEach((connection, index) => {
    const sourceKey = `${connection.fromSide || 'output'}:${connection.fromPin}`
    const targetKey = `${connection.toSide || 'input'}:${connection.toPin}`
    if (!sourceGroups.has(sourceKey)) sourceGroups.set(sourceKey, [])
    if (!targetGroups.has(targetKey)) targetGroups.set(targetKey, [])
    sourceGroups.get(sourceKey).push(index)
    targetGroups.get(targetKey).push(index)
  })
  const gapMid = (branchStartX + branchEndX) / 2
  const sourceTracks = assignSharedTracks(sourceGroups, rowYs, branchStartX + 6, gapMid - 9)
  const targetTracks = assignSharedTracks(targetGroups, rowYs, gapMid + 9, branchEndX - 6)
  sourceTracks.forEach((track, key) => {
    track.color = roleColor(model.connections[sourceGroups.get(key)[0]].fromRole, theme)
  })
  targetTracks.forEach((track, key) => {
    track.color = roleColor(model.connections[targetGroups.get(key)[0]].toRole, theme)
  })
  const verticalTracks = []
  ;[...sourceTracks.values(), ...targetTracks.values()].forEach((track) => {
    const top = Math.min(...track.ys), bottom = Math.max(...track.ys)
    verticalTracks.push({ x: origin.x + track.x, top: origin.y + top, bottom: origin.y + bottom, centerY: origin.y + track.centerY })
    line(ctx, [[origin.x + track.x, origin.y + top], [origin.x + track.x, origin.y + bottom]], track.color, 2.5)
  })

  // Solid nodes mark only actual shared pins. Crosser wires receive a small gap.
  sourceTracks.forEach((track, key) => {
    const indexes = sourceGroups.get(key)
    const color = track.color
    horizontalWire(ctx, origin.x + branchStartX, origin.x + track.x, origin.y + track.centerY, color, 2.5,
      verticalTracks, [origin.x + track.x])
    circle(ctx, origin.x + branchStartX, origin.y + track.centerY, 4, color, null)
    circle(ctx, origin.x + track.x, origin.y + track.centerY, 4, color, null)
    indexes.forEach((index) => circle(ctx, origin.x + track.x, origin.y + rowYs[index], 3.5, color, null))
    text(ctx, model.connections[indexes[0]].fromPin,
      origin.x + metrics.leftX + (metrics.cardWidth / 2), origin.y + track.centerY + 4,
      13, theme.text, 600, 'center')
  })
  targetTracks.forEach((track, key) => {
    const indexes = targetGroups.get(key)
    const color = track.color
    horizontalWire(ctx, origin.x + track.x, origin.x + branchEndX, origin.y + track.centerY, color, 2.5,
      verticalTracks, [origin.x + track.x])
    circle(ctx, origin.x + track.x, origin.y + track.centerY, 4, color, null)
    circle(ctx, origin.x + branchEndX, origin.y + track.centerY, 4, color, null)
    indexes.forEach((index) => circle(ctx, origin.x + track.x, origin.y + rowYs[index], 3.5, color, null))
    text(ctx, model.connections[indexes[0]].toPin,
      origin.x + metrics.rightX + (metrics.cardWidth / 2), origin.y + track.centerY + 4,
      13, theme.text, 600, 'center')
  })

  model.connections.forEach((connection, index) => {
    const y = rowYs[index]
    const selected = options.selectedId === connection.id
    const color = connectionColor(connection, theme)
    const strokeWidth = selected ? 4 : 2.5
    const [startX, startY] = at(branchStartX, y, origin)
    const [endX, endY] = at(branchEndX, y, origin)
    const sourceKey = `${connection.fromSide || 'output'}:${connection.fromPin}`
    const targetKey = `${connection.toSide || 'input'}:${connection.toPin}`
    const sourceShared = sourceGroups.get(sourceKey).length > 1
    const targetShared = targetGroups.get(targetKey).length > 1
    const fromTrack = sourceTracks.get(sourceKey)
    const toTrack = targetTracks.get(targetKey)
    const fromX = fromTrack ? fromTrack.x : branchStartX
    const toX = toTrack ? toTrack.x : branchEndX
    horizontalWire(ctx, origin.x + fromX, origin.x + toX, origin.y + y, color, strokeWidth,
      verticalTracks, [fromTrack && origin.x + fromTrack.x, toTrack && origin.x + toTrack.x].filter(Number.isFinite))
    if (!sourceShared) {
      text(ctx, connection.fromPin, origin.x + metrics.leftX + (metrics.cardWidth / 2), origin.y + y + 4,
        13, color, 600, 'center')
      circle(ctx, startX, origin.y + y, selected ? 6 : 4, theme.background, color, selected ? 3 : 2)
    }
    if (!targetShared) {
      text(ctx, connection.toPin, origin.x + metrics.rightX + (metrics.cardWidth / 2), origin.y + y + 4,
        13, color, 600, 'center')
      circle(ctx, endX, origin.y + y, selected ? 6 : 4, theme.background, color, selected ? 3 : 2)
    }
  })

  ;(model.unconnectedPins || []).forEach((pin, index) => {
    const rowIndex = model.connections.length + index
    const y = rowYs[rowIndex]
    const outputSide = pin.side === 'output'
    const cardEdge = outputSide ? branchStartX : branchEndX
    const openX = outputSide ? branchX1 : branchX2
    const color = theme.tertiary
    const start = outputSide ? [origin.x + cardEdge, origin.y + y] : [origin.x + openX, origin.y + y]
    const end = outputSide ? [origin.x + openX, origin.y + y] : [origin.x + cardEdge, origin.y + y]
    line(ctx, [start, end], color, 2)
    circle(ctx, origin.x + openX, origin.y + y, 5, theme.background, color, 2)
    const labelX = outputSide ? origin.x + metrics.leftX + metrics.cardWidth / 2 : origin.x + metrics.rightX + metrics.cardWidth / 2
    text(ctx, `${pin.pin} · 悬空`, labelX, origin.y + y + 4, 12, color, 600, 'center')
  })

  const legendY = origin.y + height - 13
  const labels = { positive: '+', negative: '−', shield: '屏蔽', signal: '信号', return: '回路', left: 'L', right: 'R' }
  const colors = { positive: theme.positive, negative: theme.negative, shield: theme.shield,
    signal: theme.positive, return: theme.shield, left: theme.left, right: theme.right }
  const legend = []
  const seenLegendRoles = new Set()
  model.connections.forEach((connection) => {
    const roles = [connection.fromRole, connection.toRole]
    const role = ['negative', 'right', 'left', 'shield', 'return', 'positive', 'signal']
      .find((value) => roles.includes(value)) || 'signal'
    if (seenLegendRoles.has(role)) return
    seenLegendRoles.add(role)
    legend.push([colors[role], labels[role]])
  })
  const totalWidth = Math.min(width - 28, legend.reduce((sum, item) => sum + (item[1].length * 13) + 38, 0))
  let legendX = origin.x + ((width - totalWidth) / 2)
  legend.forEach(([color, label]) => {
    line(ctx, [[legendX, legendY - 4], [legendX + 14, legendY - 4]], color, 3)
    text(ctx, label, legendX + 19, legendY, 12, theme.secondary, 400, 'left')
    legendX += (label.length * 13) + 38
  })
  return metrics
}

function pinFunctionColor(endpoint, pinNumber, theme) {
  if (endpoint.id === 'xlrBalanced') return pinNumber === '2' ? theme.positive : pinNumber === '3' ? theme.negative : theme.shield
  if (endpoint.id === 'trsBalanced') return pinNumber === 'T' ? theme.positive : pinNumber === 'R' ? theme.negative : theme.shield
  if (endpoint.id === 'stereo35' || endpoint.id === 'stereo635') return pinNumber === 'T' ? theme.left : pinNumber === 'R' ? theme.right : theme.shield
  if (endpoint.id === 'terminalBalanced') return pinNumber === '+' ? theme.positive : pinNumber === '−' ? theme.negative : theme.shield
  return pinNumber === 'S' || pinNumber === '外壳' ? theme.shield : theme.positive
}

function drawXlrHead(ctx, endpoint, x, y, width, height, face, theme, origin) {
  const cx = origin.x + x + (width / 2)
  const cy = origin.y + y + 55
  const radius = Math.min(27, width * 0.27)
  const isMale = endpoint.cableConnectorGender === '公头'
  const reverse = face === 'solder'
  const leftPin = (isMale !== reverse) ? '1' : '2'
  const rightPin = (isMale !== reverse) ? '2' : '1'
  circle(ctx, cx, cy, radius, theme.pin, theme.tertiary, 2)
  text(ctx, '定位 ↑', cx, cy - radius - 9, 12, theme.secondary, 400, 'center')
  const sockets = [
    { pin: leftPin, px: cx - (radius * 0.42), py: cy - (radius * 0.05) },
    { pin: rightPin, px: cx + (radius * 0.42), py: cy - (radius * 0.05) },
    { pin: '3', px: cx, py: cy + (radius * 0.48) },
  ]
  sockets.forEach(({ pin: pinNumber, px, py }) => {
    const color = pinFunctionColor(endpoint, pinNumber, theme)
    circle(ctx, px, py, 6.5, isMale ? color : theme.background, color, 2)
    text(ctx, pinNumber, px, py + 4, 14, isMale ? theme.pin : theme.text, 600, 'center')
  })
}

function drawPhonePlug(ctx, endpoint, x, y, width, theme, origin, face = 'mating') {
  const isDual = endpoint.id === 'rcaStereo' || endpoint.id === 'tsStereo'
  const isRca = endpoint.id === 'rcaStereo' || endpoint.id === 'rcaMono'
  const cx = origin.x + x + (width / 2)
  const startY = origin.y + y + 30
  if (face === 'solder') {
    const fontSize = 12
    const content = endpoint.id === 'stereo635'
      ? ['T（L）→ 左声道', 'R（R）→ 右声道', 'S（G）→ 公共回路']
      : endpoint.id === 'stereo35'
      ? ['T（L）→ 左声道', 'R（R）→ 右声道', 'S（G）→ 公共回路']
      : endpoint.id === 'trsBalanced'
        ? ['T → +', 'R → −', 'S → 屏蔽']
        : endpoint.id === 'tsStereo'
          ? ['左：T 信号 / S 回路', '右：T 信号 / S 回路']
          : endpoint.id === 'tsMono'
            ? ['T → 单声道信号', 'S → 信号回路']
            : endpoint.id === 'rcaStereo'
              ? ['L：中心针/外壳', 'R：中心针/外壳']
              : ['中心针 → 信号', '外壳 → 回路']
    let rowY = origin.y + y + 48
    content.forEach((value) => {
      const rows = textLines(value, Math.max(1, Math.floor((width - 14) / fontSize)))
      rows.forEach((row, index) => text(ctx, row, cx, rowY + (index * (fontSize + 4)),
        fontSize, theme.text, 500, 'center'))
      rowY += (rows.length * (fontSize + 4)) + 4
    })
    return
  }
  if (isRca) {
    const labels = isDual ? ['L', 'R'] : ['MONO']
    const rowStep = isDual ? 43 : 1
    labels.forEach((label, index) => {
      const cy = startY + (index * rowStep)
      const radius = Math.min(16, width * 0.17)
      circle(ctx, cx, cy, radius, theme.card, theme.tertiary, 4)
      circle(ctx, cx, cy, 4, label === 'R' ? theme.right : theme.left, null)
      if (isDual) text(ctx, label, cx + radius + 10, cy + 4, 12, theme.secondary, 500, 'left')
    })
    return
  }
  const rows = isDual ? ['L', 'R'] : ['']
  const rowStep = isDual ? 43 : 1
  rows.forEach((row, index) => {
    const cy = startY + (index * rowStep)
    const plugWidth = Math.min(76, width - 14)
    const plugStart = cx - (plugWidth / 2)
    const tipWidth = plugWidth * 0.26
    const hasRing = endpoint.id === 'trsBalanced' || endpoint.id === 'stereo35' || endpoint.id === 'stereo635'
    const ringWidth = hasRing ? plugWidth * 0.19 : 0
    const sleeveWidth = plugWidth - tipWidth - ringWidth
    const blockY = cy - 7
    const tipColor = endpoint.id === 'tsStereo' && row === 'R' ? theme.right : theme.left
    roundedRect(ctx, plugStart, blockY, tipWidth, 14, 3, tipColor, theme.border)
    if (hasRing) {
      roundedRect(ctx, plugStart + tipWidth + 2, blockY, ringWidth - 3, 14, 3,
        endpoint.id === 'trsBalanced' ? theme.negative : theme.right, theme.border)
    }
    roundedRect(ctx, plugStart + tipWidth + ringWidth, blockY, sleeveWidth, 14, 3, theme.tertiary, theme.border)
    text(ctx, 'T', plugStart + (tipWidth / 2), cy + 4, 12, theme.pin, 600, 'center')
    if (hasRing) {
      text(ctx, 'R', plugStart + tipWidth + (ringWidth / 2), cy + 4, 12, theme.pin, 600, 'center')
    }
    text(ctx, 'S', plugStart + tipWidth + ringWidth + (sleeveWidth / 2), cy + 4, 12, theme.pin, 600, 'center')
    if (row) text(ctx, row, cx + (plugWidth / 2) + 4, cy + 4, 12, theme.secondary, 500, 'left')
  })
}

function drawTerminalView(ctx, endpoint, x, y, width, theme, origin) {
  const cx = origin.x + x + (width / 2)
  const labels = [['+', theme.positive], ['−', theme.negative], ['G', theme.shield]]
  const boxW = Math.min(33, Math.max(23, (width - 24) / 3))
  const gap = Math.max(3, (width - (boxW * 3)) / 4)
  const startX = origin.x + x + gap
  labels.forEach(([label, color], index) => {
    const boxX = startX + (index * (boxW + gap))
    roundedRect(ctx, boxX, origin.y + y + 35, boxW, 38, 5, theme.pin, theme.border)
    roundedRect(ctx, boxX + 5, origin.y + y + 40, boxW - 10, 12, 3, color, null)
    text(ctx, label, boxX + (boxW / 2), origin.y + y + 68, 12, theme.text, 600, 'center')
  })
  text(ctx, '不代表物理排列', cx, origin.y + y + 104, 12,
    theme.secondary, 400, 'center')
}

function connectorHeaderLabel(endpoint, side, face) {
  if (endpoint.id === 'xlrBalanced') return `XLR线缆${endpoint.cableConnectorGender}`
  if (endpoint.id === 'stereo35') return '3.5 立体声'
  if (endpoint.id === 'trsBalanced') return '6.35 大三芯·平衡'
  if (endpoint.id === 'stereo635') return '6.35 大三芯·立体声'
  if (endpoint.id === 'terminalBalanced') return '平衡功能端子'
  if (endpoint.id === 'rcaStereo') return '双RCA L/R'
  if (endpoint.id === 'tsStereo') return '双TS L/R'
  if (endpoint.id === 'rcaMono') return 'RCA 线缆头'
  if (endpoint.id === 'tsMono') return 'TS 线缆头'
  return endpoint.connectorType
}

function drawConnectorPanels(ctx, model, width, theme, origin, metrics, options) {
  const y = metrics.headerTop
  const h = metrics.connectorAreaHeight - 10
  ;[
    ['output', model.output, metrics.leftX],
    ['input', model.input, metrics.rightX],
  ].forEach(([side, endpoint, x]) => {
    roundedRect(ctx, origin.x + x, origin.y + y, metrics.cardWidth, h, 10, theme.card, theme.border)
    const label = connectorHeaderLabel(endpoint, side, options.face)
    wrappedText(ctx, label, origin.x + x + (metrics.cardWidth / 2), origin.y + y + 18,
      metrics.cardWidth - 10, 13, theme.text, 600, 'center', 2)
    if (endpoint.id === 'xlrBalanced') {
      drawXlrHead(ctx, endpoint, x, y + 22, metrics.cardWidth, h - 22, options.face === 'solder' ? 'solder' : 'mating', theme, origin)
    } else if (endpoint.id === 'terminalBalanced') {
      drawTerminalView(ctx, endpoint, x, y + 22, metrics.cardWidth, theme, origin)
    } else if (['trsBalanced', 'stereo35', 'stereo635', 'tsMono', 'tsStereo'].includes(endpoint.id)) {
      drawPhonePlug(ctx, endpoint, x, y + 22, metrics.cardWidth, theme, origin, options.face === 'solder' ? 'solder' : 'mating')
    } else if (endpoint.id === 'rcaMono' || endpoint.id === 'rcaStereo') {
      drawPhonePlug(ctx, endpoint, x, y + 22, metrics.cardWidth, theme, origin, options.face === 'solder' ? 'solder' : 'mating')
    } else {
      text(ctx, '按具体接头结构核对', origin.x + x + (metrics.cardWidth / 2), origin.y + y + (h / 2), 9,
        theme.secondary, 400, 'center')
    }
  })
}

function drawConnectorMap(ctx, model, width, theme, origin, metrics, options) {
  if (!model.supported) return
  const startY = metrics.mapTop
  text(ctx, '逐线功能对应', origin.x + metrics.padding, origin.y + startY - 7, 13, theme.secondary, 600, 'left')
  const rows = connectorRows(width, model, metrics)
  rows.forEach((row) => {
    const connection = row.connection
    const y = row.y
    const selected = connection && options.selectedId === connection.id
    const color = connection ? connectionColor(connection, theme) : theme.tertiary
    if (!connection) {
      text(ctx, '○', origin.x + metrics.padding + 10, origin.y + y + 4, 13, color, 500, 'center')
    } else {
      line(ctx, [[origin.x + metrics.padding + 3, origin.y + y - 4], [origin.x + metrics.padding + 18, origin.y + y - 4]], color, selected ? 4 : 3)
    }
    row.lines.forEach((rowText, rowIndex) => text(ctx, rowText, origin.x + metrics.padding + 27,
      origin.y + y + (rowIndex * 16), 12, theme.text, selected ? 600 : 400, 'left'))
  })
  if (options.face === 'solder' && (model.output.id === 'xlrBalanced' || model.input.id === 'xlrBalanced')) {
    const lastRow = rows[rows.length - 1]
    const contentBottom = lastRow ? lastRow.y + ((lastRow.lines.length - 1) * 16) + 4 : startY + 13
    const noteY = contentBottom + 18
    const note = 'XLR焊接面为插接面左右镜像，定位朝上。 TRS/TS焊片随型号而异，按 T/R/S 标记确认。'
    const noteLines = textLines(note, Math.max(1, Math.floor((width - (metrics.padding * 2)) / 12)))
    noteLines.forEach((row, rowIndex) => text(ctx, row, origin.x + metrics.padding,
      origin.y + noteY + (rowIndex * 16), 12, theme.secondary, 400, 'left'))
  }
}

function solderPinOrder(endpoint, pins) {
  const basePreferred = endpoint.id === 'xlrBalanced' ? ['1', '2', '3']
    : ['trsBalanced', 'stereo35', 'stereo635'].includes(endpoint.id) ? ['T', 'R', 'S']
      : ['tsMono', 'tsStereo'].includes(endpoint.id) ? ['T', 'S']
        : endpoint.id === 'terminalBalanced' ? ['+', '−', 'G']
          : endpoint.id === 'rcaStereo' ? ['L中心', 'L外壳', 'R中心', 'R外壳']
            : endpoint.id === 'rcaMono' ? ['中心针', '外壳'] : []
  const preferred = endpoint.channelCount === 2
    ? ['L', 'R'].flatMap((channel) => basePreferred.map((key) => `${channel}·${key}`))
    : basePreferred
  const rank = new Map(preferred.map((pin, index) => [pin, index]))
  return [...pins].sort((a, b) => {
    const aRank = rank.has(a.pin) ? rank.get(a.pin) : preferred.length
    const bRank = rank.has(b.pin) ? rank.get(b.pin) : preferred.length
    return aRank - bRank || String(a.pin).localeCompare(String(b.pin))
  })
}

function solderPinRecords(model, side) {
  const keyFor = (connection) => side === 'output' ? connection.fromPin : connection.toPin
  const labelFor = (connection) => side === 'output' ? connection.fromLabel : connection.toLabel
  const roleFor = (connection) => side === 'output' ? connection.fromRole : connection.toRole
  const pins = new Map()
  ;((model && model.connections) || []).forEach((connection) => {
    const key = String(keyFor(connection) || '')
    if (!key) return
    if (!pins.has(key)) pins.set(key, { pin: key, label: labelFor(connection) || key, role: roleFor(connection), count: 0 })
    pins.get(key).count += 1
  })
  ;((model && model.unconnectedPins) || []).filter((pin) => pin.side === side).forEach((pin) => {
    const key = String(pin.pin || '')
    if (!key || pins.has(key)) return
    pins.set(key, { pin: key, label: pin.label || key, role: 'signal', count: 0, reason: pin.reason || '不连接' })
  })
  return solderPinOrder((model && model[side]) || {}, [...pins.values()])
}

function photoDestination(box, photoSpec) {
  const crop = photoSpec && photoSpec.contentRect
    ? photoSpec.contentRect : { x: 0, y: 0, width: photoSpec.width, height: photoSpec.height }
  const boxWidth = Number.isFinite(box.width) ? box.width : box.size
  const boxHeight = Number.isFinite(box.height) ? box.height : box.size
  const scale = Math.min(boxWidth / crop.width, boxHeight / crop.height)
  const width = crop.width * scale, height = crop.height * scale
  return { x: box.x + ((boxWidth - width) / 2), y: box.y + ((boxHeight - height) / 2), width, height, crop, scale }
}

function photoPoint(destination, photoSpec, point) {
  const { crop } = destination
  return {
    x: destination.x + (((point.x * photoSpec.width - crop.x) / crop.width) * destination.width),
    y: destination.y + (((point.y * photoSpec.height - crop.y) / crop.height) * destination.height),
  }
}

function routeDirectionFor(photoSpec, side, pinKey) {
  const angle = Number(photoSpec && photoSpec.routeAngles && photoSpec.routeAngles[pinKey])
  const resolvedAngle = Number.isFinite(angle) ? angle : side === 'output' ? 0 : 180
  const radians = (resolvedAngle * Math.PI) / 180
  return { x: Math.cos(radians), y: Math.sin(radians) }
}

function photoPinKey(endpoint, pin) {
  const base = String(pin).replace(/^[LR]·/, '')
  if (endpoint && ['rcaMono', 'rcaStereo'].includes(endpoint.id)) {
    return base === '中心针' || base.endsWith('中心') ? 'core'
      : base === '外壳' || base.endsWith('外壳') ? 'shell' : ''
  }
  if (endpoint && ['tsMono', 'tsStereo'].includes(endpoint.id)) return base.endsWith('T') ? 'T' : 'S'
  return base
}

function photoChannel(pin) {
  return /^R(?:·|中心|外壳)/.test(String(pin)) ? 'R' : 'L'
}

function photoPinDisplayLabel(endpoint, pin, role) {
  const raw = String(pin)
  const key = photoPinKey(endpoint, pin)
  let base = raw
  if (endpoint.id === 'xlrBalanced') base = key === '1' ? '1 G' : key === '2' ? '2 +' : key === '3' ? '3 −' : key
  else if (endpoint.id === 'trsBalanced') base = key === 'T' ? 'T +' : key === 'R' ? 'R −' : 'S G'
  else if (['stereo35', 'stereo635'].includes(endpoint.id)) base = key === 'T' ? 'T L' : key === 'R' ? 'R R' : 'S G'
  else if (['tsMono', 'tsStereo'].includes(endpoint.id)) base = key
  else if (['rcaMono', 'rcaStereo'].includes(endpoint.id)) base = key === 'core' ? '中心' : '壳'
  else if (endpoint.id === 'terminalBalanced') base = key
  else base = role || raw
  return base
}

const TERMINAL_CAPTION = '端子示意顺序，按设备丝印'

function rectsOverlap(first, second, padding = 0) {
  return first.x < second.x + second.width + padding && first.x + first.width + padding > second.x
    && first.y < second.y + second.height + padding && first.y + first.height + padding > second.y
}

function pointRectDistance(point, rect) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

function photoLabelRect(anchor, endpoint, pin, usedLabels, otherAnchors) {
  const label = anchor.label
  const isTerminal = Boolean(anchor.photoSpec && anchor.photoSpec.kind === 'terminal')
  const width = isTerminal ? 14
    : Math.max(16, [...String(label)].reduce((sum, character) => sum + (character.charCodeAt(0) > 127 ? 9 : 5.5), 0) + 8)
  const height = isTerminal ? 14 : 13
  const terminalLabel = isTerminal ? photoPinKey(endpoint, pin) : undefined
  const terminalVectors = []
  const marker = isTerminal && anchor.photoSpec.labelPoints
    ? anchor.photoSpec.labelPoints[terminalLabel] : null
  if (marker && anchor.box && anchor.box.destination) {
    const preferredPoint = photoPoint(anchor.box.destination, anchor.photoSpec, marker)
    terminalVectors.push([preferredPoint.x - anchor.x, preferredPoint.y - anchor.y])
  }
  const direction = anchor.routeDirection || { x: 1, y: 0 }
  const key = photoPinKey(endpoint, pin)
  let preferred = []
  const rotationDegrees = Number(anchor.rotationDegrees) || 0
  if (endpoint.id === 'stereo35' && anchor.side === 'output' && rotationDegrees === 180) {
    const sideOffset = (width / 2) + 8
    preferred = key === 'T' ? [[-14, -13], [-14, 13]]
      : key === 'R' ? [[18.25, 0], [14, 13], [14, -13]] : [[sideOffset, 5], [-sideOffset, 5]]
  } else if (['trsBalanced', 'stereo635'].includes(endpoint.id)) {
    const sideOffset = (width / 2) + 8
    preferred = key === 'T' ? [[18, 13]] : key === 'R' ? [[-18, 13]] : [[sideOffset, 0], [-sideOffset, 0]]
  } else if (endpoint.id === 'stereo35') {
    const sideOffset = (width / 2) + 8
    preferred = key === 'T' ? [[14, 13], [-14, 13]] : key === 'R' ? [[-14, 13]] : [[sideOffset, 0], [-sideOffset, 0]]
  } else if (endpoint.id === 'xlrBalanced') {
    preferred = key === '1'
      ? (anchor.side === 'output' ? [[16, -15], [-14, -15], [-11, 13]] : [[-16, -15], [14, -15], [11, 13]])
      : key === '2'
        ? (anchor.side === 'output' ? [[-16, -15], [14, -15], [11, 13]] : [[16, -15], [-14, -15], [-11, 13]])
        : [[0, -17], [13, 14], [-13, 14]]
  } else if (['tsMono', 'tsStereo'].includes(endpoint.id)) {
    preferred = key === 'T' ? [[12, 13]] : [[-12, 13]]
  } else if (['rcaMono', 'rcaStereo'].includes(endpoint.id)) {
    preferred = key === 'core' ? [[13, 13]] : [[-13, 13]]
  }
  const vectors = [
    ...terminalVectors, ...preferred,
    [-direction.x * 16, -direction.y * 16], [-direction.y * 15, direction.x * 15],
    [direction.y * 15, -direction.x * 15], [0, -18], [0, 18], [-18, 0], [18, 0],
  ]
  ;[-28, -20, 20, 28].forEach((offsetY) => [-28, -16, 0, 16, 28]
    .forEach((offsetX) => vectors.push([offsetX, offsetY])))
  const seen = new Set()
  const fits = (rect) => {
    if (rect.x < anchor.box.columnX + 2 || rect.x + width > anchor.box.columnX + anchor.box.columnWidth - 2) return false
    if (usedLabels.some((other) => rectsOverlap(rect, other, 2))) return false
    if ([anchor, ...otherAnchors].some((other) => pointRectDistance(other, rect) < 6)) return false
    return true
  }
  for (const [offsetX, offsetY] of vectors) {
    const signature = `${offsetX.toFixed(1)}:${offsetY.toFixed(1)}`
    if (seen.has(signature)) continue
    seen.add(signature)
    const rect = { x: anchor.x + offsetX - (width / 2), y: anchor.y + offsetY - (height / 2), width, height,
      textX: anchor.x + offsetX, textY: anchor.y + offsetY + 3, textAnchor: 'middle',
      ...(isTerminal ? { label: terminalLabel, terminal: true } : {}) }
    if (fits(rect)) return rect
  }
  const minCenterX = anchor.box.columnX + 2 + (width / 2)
  const maxCenterX = anchor.box.columnX + anchor.box.columnWidth - 2 - (width / 2)
  const fallbacks = []
  for (let centerX = minCenterX; centerX <= maxCenterX; centerX += 5) {
    for (let centerY = anchor.y - 72; centerY <= anchor.y + 72; centerY += 6) {
      fallbacks.push({ centerX, centerY, distance: Math.hypot(centerX - anchor.x, centerY - anchor.y) })
    }
  }
  fallbacks.sort((a, b) => a.distance - b.distance || a.centerY - b.centerY || a.centerX - b.centerX)
  for (const candidate of fallbacks) {
    const rect = { x: candidate.centerX - (width / 2), y: candidate.centerY - (height / 2), width, height,
      textX: candidate.centerX, textY: candidate.centerY + 3, textAnchor: 'middle',
      ...(isTerminal ? { label: terminalLabel, terminal: true } : {}) }
    if (fits(rect)) return rect
  }
  return null
}

function photoGeometryRect(box, photoSpec, rect) {
  if (!rect || !box.destination) return null
  const crop = box.destination.crop
  const scaleX = box.destination.width / crop.width
  const scaleY = box.destination.height / crop.height
  return { type: 'rect', kind: 'connector-body',
    x: box.destination.x + ((rect.x - crop.x) * scaleX),
    y: box.destination.y + ((rect.y - crop.y) * scaleY),
    width: rect.width * scaleX, height: rect.height * scaleY }
}

function refreshSolderEndpointGeometry(layout) {
  const { photoSpec, photoBoxes, anchors, endpoint } = layout
  if (photoSpec) {
    photoBoxes.forEach((box) => { box.destination = photoDestination(box, photoSpec) })
    anchors.forEach((anchor) => {
      if (!anchor.photoPixel) return
      const box = photoBoxes.find((item) => item.key === anchor.channel) || photoBoxes[0]
      anchor.box = box
      const position = photoPoint(box.destination, photoSpec, anchor.photoPixel)
      anchor.x = position.x
      anchor.y = position.y
    })
  }
  const channelLabels = photoBoxes.filter((box) => box.key).map((box) => ({
    x: box.columnX + 3, y: box.y - 18, width: 18, height: 14,
    textX: box.columnX + 3, textY: box.y - 7, text: `${box.key}头`, kind: 'channel-label',
  }))
  const usedLabels = channelLabels.slice()
  layout.channelLabels = channelLabels
  if (photoSpec && photoSpec.kind === 'terminal') {
    const photoBottom = photoBoxes.reduce((bottom, box) => Math.max(bottom, box.y + box.height), 0)
    const lines = textLines(TERMINAL_CAPTION, Math.max(1, Math.floor((layout.columnWidth - 8) / 9)), 2)
    const lineHeight = 9 * 1.35
    const y = photoBottom + 12
    layout.terminalCaption = { text: TERMINAL_CAPTION, lines, x: layout.centerX, y, size: 9,
      rect: { x: layout.x + 4, y: y - 9, width: layout.columnWidth - 8,
        height: ((lines.length - 1) * lineHeight) + 12 } }
  } else {
    layout.terminalCaption = null
  }
  const allAnchors = [...anchors.values()]
  for (const anchor of allAnchors) {
    anchor.labelRect = photoLabelRect(anchor, endpoint, anchor.pin, usedLabels,
      allAnchors.filter((other) => other !== anchor))
    if (anchor.labelRect) usedLabels.push(anchor.labelRect)
  }
  const obstacles = [{ type: 'rect', kind: 'endpoint-title', x: layout.x - 2, y: 5,
    width: layout.columnWidth + 4, height: 44 }]
  layout.channelLabels.forEach((label) => obstacles.push({ type: 'rect', kind: label.kind,
    x: label.x, y: label.y, width: label.width, height: label.height }))
  if (layout.terminalCaption) obstacles.push({ type: 'rect', kind: 'terminal-caption',
    x: layout.terminalCaption.rect.x, y: layout.terminalCaption.rect.y,
    width: layout.terminalCaption.rect.width, height: layout.terminalCaption.rect.height })
  if (photoSpec && photoSpec.routingGeometry) {
    photoBoxes.forEach((box) => {
      const body = photoGeometryRect(box, photoSpec, photoSpec.routingGeometry.bodyRect)
      if (body && body.width > 0 && body.height > 0) obstacles.push(body)
    })
  }
  anchors.forEach((anchor) => {
    if (anchor.labelRect) obstacles.push({ type: 'rect', kind: 'pin-label', x: anchor.labelRect.x,
      y: anchor.labelRect.y, width: anchor.labelRect.width, height: anchor.labelRect.height })
  })
  layout.obstacles = obstacles
  return layout
}

function solderGalleryChannels(endpoint, photoSpec) {
  const isDualPhoto = Boolean(photoSpec && photoSpec.pinPoints
    && (endpoint.channelCount === 2 || ['rcaStereo', 'tsStereo'].includes(endpoint.id)))
  return isDualPhoto ? ['L', 'R'] : ['']
}

function solderPhotoPose(model) {
  const balancedDualInput = ['xlrBalanced', 'trsBalanced', 'terminalBalanced'].includes(model && model.input && model.input.id)
  const stereo35ToXlr = model && model.output && model.output.id === 'stereo35'
    && model.input && model.input.id === 'xlrBalanced'
  return {
    outputRotationDegrees: ['stereo35', 'stereo635'].includes(model && model.output && model.output.id)
      && balancedDualInput && !stereo35ToXlr ? 180 : 0,
    reverseInputChannels: Boolean(model && model.output && model.output.id === 'stereo635' && balancedDualInput),
    inputRotationDegrees: Boolean(model && model.output && model.output.id === 'terminalBalanced'
      && ['rcaStereo', 'tsStereo'].includes(model.input && model.input.id)
      || model && model.output && model.output.id === 'stereo635' && model.input && model.input.id === 'terminalBalanced'
      || model && model.output && model.output.id === 'stereo35' && model.input && model.input.id === 'xlrBalanced'
      || model && model.output && model.output.id === 'trsBalanced' && model.input && model.input.id === 'tsStereo') ? 180 : 0,
  }
}

function makeSolderGalleryPlan(model, width, options) {
  const actualContentWidth = Math.max(150, width - (options.avoidRail ? 56 : 0))
  const contentWidth = actualContentWidth >= 216 ? 218 : actualContentWidth
  const padding = 7
  const gap = 26
  const columnWidth = Math.max(1, (contentWidth - (padding * 2) - gap) / 2)
  const photoTop = Number.isFinite(options.photoTop) ? options.photoTop : 72
  const stageHeight = 144
  const headGap = 16
  const pose = solderPhotoPose(model)
  const endpointInfo = ['output', 'input'].map((side) => {
    const endpoint = model && model[side] || {}
    const photoSpec = getSolderPhotoSpec(endpoint)
    const channels = solderGalleryChannels(endpoint, photoSpec)
    return { side, endpoint, photoSpec,
      channels: side === 'input' && pose.reverseInputChannels ? channels.slice().reverse() : channels }
  })
  const blockHeights = endpointInfo.map(({ channels }) => channels.length * stageHeight
    + (Math.max(0, channels.length - 1) * headGap))
  const maxBlockHeight = Math.max(...blockHeights)
  const heads = []
  endpointInfo.forEach(({ side, endpoint, photoSpec, channels }, sideIndex) => {
    const columnX = padding + (sideIndex * (columnWidth + gap))
    const blockTop = photoTop + ((maxBlockHeight - blockHeights[sideIndex]) / 2)
    channels.forEach((channel, index) => {
      const y = blockTop + (index * (stageHeight + headGap))
      const box = { key: channel, channel, x: columnX, y, width: columnWidth, height: stageHeight,
        photo: photoSpec && options.photos && options.photos[photoSpec.key], columnX, columnWidth }
      heads.push({ side, endpoint, photoSpec, channel, columnX, columnWidth, box })
    })
  })
  return { contentWidth, actualContentWidth, translationX: (actualContentWidth - contentWidth) / 2,
    padding, gap, columnWidth, photoTop, stageHeight, headGap, pose, heads }
}

function makeSolderEndpoint(model, side, theme, gallery) {
  const endpoint = model && model[side] || {}
  const pins = solderPinRecords(model, side)
  const heads = gallery.heads.filter((head) => head.side === side)
  const firstHead = heads[0]
  const lastHead = heads[heads.length - 1] || firstHead
  const x = firstHead ? firstHead.columnX : gallery.padding
  const right = lastHead ? lastHead.columnX + lastHead.columnWidth : x + gallery.columnWidth
  const columnWidth = Math.max(1, right - x)
  const centerX = x + (columnWidth / 2)
  const photoSpec = firstHead && firstHead.photoSpec || getSolderPhotoSpec(endpoint)
  const photo = photoSpec && heads.find((head) => head.photoSpec && head.photoSpec.key === photoSpec.key)?.box.photo
  const isPhotoEndpoint = Boolean(photoSpec && photoSpec.pinPoints)
  const isDualPhoto = heads.length > 1
  const photoBoxes = heads.map((head) => head.box)
  const anchors = new Map()
  if (isPhotoEndpoint) {
    pins.forEach((pin) => {
      const channel = isDualPhoto ? photoChannel(pin.pin) : ''
      const box = photoBoxes.find((item) => item.key === channel) || photoBoxes[0]
      const key = photoPinKey(endpoint, pin.pin)
      const point = photoSpec.pinPoints[key]
      if (!point || !box) return
      anchors.set(pin.pin, { pin: pin.pin, role: pin.role, count: pin.count, channel, side, photo: true,
        photoPixel: point, photoKey: key, photoSpec, box,
        label: `${photoPinDisplayLabel(endpoint, pin.pin, pin.role)}${pin.count ? '' : ' 未接'}`,
        color: roleColor(pin.role, theme), routeDirection: routeDirectionFor(photoSpec, side, key) })
    })
  } else {
    pins.forEach((pin, index) => {
      const rowGap = pins.length > 2 ? 23 : 29
      const y = gallery.photoTop + 44 + ((index - ((pins.length - 1) / 2)) * rowGap)
      const label = pin.label || pin.pin
      const chipWidth = Math.min(columnWidth - 16, Math.max(38, [...String(label)].length * 8 + 16))
      const chipLeft = side === 'output' ? x + columnWidth - chipWidth - 5 : x + 5
      anchors.set(pin.pin, { pin: pin.pin, role: pin.role, x: side === 'output' ? chipLeft + chipWidth : chipLeft, y,
        color: roleColor(pin.role, theme), count: pin.count, label, chipWidth, chipCenter: chipLeft + (chipWidth / 2),
        routeDirection: routeDirectionFor(photoSpec, side, pin.pin) })
    })
  }
  return refreshSolderEndpointGeometry({ endpoint, pins, side, x, centerX, columnWidth, photoSpec, photo,
    isPhotoEndpoint, isDualPhoto, photoBoxes, anchors, theme })
}

function rotateSolderEndpointPhoto(layout, degrees) {
  const rotationDegrees = ((Number(degrees) || 0) % 360 + 360) % 360
  if (rotationDegrees !== 0 && rotationDegrees !== 180) throw new Error('Unsupported solder photo rotation')
  layout.rotationDegrees = rotationDegrees
  const anchors = [...layout.anchors.values()]
  anchors.forEach((anchor) => { anchor.rotationDegrees = rotationDegrees })
  if (!rotationDegrees) return layout

  const pointTransform = (point, box) => {
    const rect = box.destination
    const cx = rect.x + (rect.width / 2), cy = rect.y + (rect.height / 2)
    return { x: (2 * cx) - point.x, y: (2 * cy) - point.y }
  }
  const bodies = layout.obstacles.filter((item) => item.kind === 'connector-body').map((body) => {
    const box = layout.photoBoxes.find((item) => pointInRect({ x: body.x + (body.width / 2),
      y: body.y + (body.height / 2) }, item.destination)) || layout.photoBoxes[0]
    const rect = box.destination
    const cx = rect.x + (rect.width / 2), cy = rect.y + (rect.height / 2)
    return { ...body, x: (2 * cx) - (body.x + body.width), y: (2 * cy) - (body.y + body.height) }
  })
  anchors.forEach((anchor) => {
    const transformed = pointTransform(anchor, anchor.box || layout.photoBoxes[0])
    anchor.x = transformed.x
    anchor.y = transformed.y
    if (anchor.routeDirection) anchor.routeDirection = { x: -anchor.routeDirection.x, y: -anchor.routeDirection.y }
  })

  const used = (layout.channelLabels || []).map((label) => ({ x: label.x, y: label.y,
    width: label.width, height: label.height }))
  anchors.forEach((anchor) => {
    anchor.labelRect = photoLabelRect(anchor, layout.endpoint, anchor.pin, used,
      anchors.filter((other) => other !== anchor))
    if (anchor.labelRect) used.push(anchor.labelRect)
  })
  layout.obstacles = layout.obstacles.filter((item) => item.kind !== 'connector-body' && item.kind !== 'pin-label')
    .concat(bodies)
  anchors.forEach((anchor) => {
    const rect = anchor.labelRect
    if (rect) layout.obstacles.push({ type: 'rect', kind: 'pin-label', x: rect.x,
      y: rect.y, width: rect.width, height: rect.height })
  })
  return layout
}

function repositionTerminalPhotoLabels(layout) {
  if (!layout || layout.photoSpec?.kind !== 'terminal') return layout
  const anchors = [...layout.anchors.values()]
  const preferred = layout.side === 'output'
    ? [[-14, 14], [-12, 14], [-10, 14], [-8, 14]]
    : [[14, -14], [16, -14], [12, -14]]
  const used = (layout.channelLabels || []).map((label) => ({ x: label.x, y: label.y,
    width: label.width, height: label.height }))
  for (const anchor of anchors) {
    const original = anchor.labelRect
    if (!original) continue
    const width = original.width, height = original.height
    const originalCenter = { x: original.textX, y: original.textY - 3 }
    const candidates = [...preferred, [originalCenter.x - anchor.x, originalCenter.y - anchor.y]]
    const fits = (rect) => rect.x >= anchor.box.columnX + 2
      && rect.x + rect.width <= anchor.box.columnX + anchor.box.columnWidth - 2
      && !used.some((other) => rectsOverlap(rect, other, 2))
      && anchors.every((other) => pointRectDistance(other, rect) >= 6 - 1e-6)
    let selected = null
    for (const [offsetX, offsetY] of candidates) {
      const rect = { ...original, x: anchor.x + offsetX - (width / 2),
        y: anchor.y + offsetY - (height / 2), textX: anchor.x + offsetX,
        textY: anchor.y + offsetY + 3 }
      if (fits(rect)) { selected = rect; break }
    }
    anchor.labelRect = selected || original
    used.push(anchor.labelRect)
  }
  layout.obstacles = layout.obstacles.filter((item) => item.kind !== 'pin-label')
  anchors.forEach((anchor) => {
    const rect = anchor.labelRect
    if (rect) layout.obstacles.push({ type: 'rect', kind: 'pin-label', x: rect.x,
      y: rect.y, width: rect.width, height: rect.height })
  })
  return layout
}

const DIRECT_ROUTE_STEP = 8
const DIRECT_ROUTE_CLEARANCE = 3.4
const DIRECT_PIN_CLEARANCE = 7.2
const DIRECT_RECT_CLEARANCE = 2.3
const DIRECT_MAX_EXPANDED_STATES = 90000
const DIRECT_MAX_EXTRA_HEIGHT = 240

function pointInRect(point, rect, padding = 0) {
  return point.x >= rect.x - padding - 1e-8 && point.x <= rect.x + rect.width + padding + 1e-8
    && point.y >= rect.y - padding - 1e-8 && point.y <= rect.y + rect.height + padding + 1e-8
}

function directRound(value, digits = 3) { return Number(value.toFixed(digits)) }
function directDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const lengthSquared = (dx * dx) + (dy * dy)
  const ratio = lengthSquared ? Math.max(0, Math.min(1,
    (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lengthSquared)) : 0
  return Math.hypot(point.x - a.x - (ratio * dx), point.y - a.y - (ratio * dy))
}

function segmentIntersection(a, b, c, d) {
  const cross = (u, v) => (u.x * v.y) - (u.y * v.x)
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denominator = cross(r, s)
  const q = { x: c.x - a.x, y: c.y - a.y }
  if (Math.abs(denominator) < 1e-8) {
    if (Math.abs(cross(q, r)) > 1e-7) return null
    const lengthSquared = (r.x * r.x) + (r.y * r.y)
    if (lengthSquared < 1e-8) return directDistance(a, c) < 1e-6 ? { point: a, overlap: false } : null
    const t0 = ((q.x * r.x) + (q.y * r.y)) / lengthSquared
    const t1 = (((d.x - a.x) * r.x) + ((d.y - a.y) * r.y)) / lengthSquared
    const low = Math.max(0, Math.min(t0, t1)), high = Math.min(1, Math.max(t0, t1))
    if (high < low - 1e-7) return null
    if ((high - low) * Math.sqrt(lengthSquared) > 1e-4) return {
      point: { x: a.x + (low * r.x), y: a.y + (low * r.y) },
      end: { x: a.x + (high * r.x), y: a.y + (high * r.y) }, overlap: true,
    }
    return { point: { x: a.x + (((low + high) / 2) * r.x), y: a.y + (((low + high) / 2) * r.y) }, overlap: false }
  }
  const t = cross(q, s) / denominator, u = cross(q, r) / denominator
  if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null
  return { point: { x: a.x + (t * r.x), y: a.y + (t * r.y) }, overlap: false }
}

function segmentDistance(a, b, c, d) {
  if (segmentIntersection(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

function rectHitSegment(a, b, rect, padding = 0) {
  const left = rect.x - padding, right = rect.x + rect.width + padding
  const top = rect.y - padding, bottom = rect.y + rect.height + padding
  let minimum = 0, maximum = 1
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q >= 0
    const ratio = q / p
    if (p < 0) { if (ratio > maximum) return false; if (ratio > minimum) minimum = ratio }
    else { if (ratio < minimum) return false; if (ratio < maximum) maximum = ratio }
    return true
  }
  const dx = b.x - a.x, dy = b.y - a.y
  return clip(-dx, a.x - left) && clip(dx, right - a.x)
    && clip(-dy, a.y - top) && clip(dy, bottom - a.y) && maximum >= minimum - 1e-9
}

function uniqueDirectAxis(minimum, maximum, extra) {
  const values = new Set()
  for (let value = Math.ceil(minimum / DIRECT_ROUTE_STEP) * DIRECT_ROUTE_STEP;
    value <= maximum + 1e-6; value += DIRECT_ROUTE_STEP) values.add(directRound(value, 3))
  values.add(directRound(minimum, 3)); values.add(directRound(maximum, 3))
  extra.forEach((value) => {
    if (Number.isFinite(value) && value >= minimum - 1e-6 && value <= maximum + 1e-6) values.add(directRound(value, 3))
  })
  return [...values].sort((a, b) => a - b)
}

function buildDirectRouteGrid(layout) {
  const pinClearance = Number.isFinite(layout.pinClearance) ? layout.pinClearance : DIRECT_PIN_CLEARANCE
  const rects = layout.obstacles.map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    kind: rect.kind || 'rectangle' }))
  const anchors = [...layout.output.anchors.values(), ...layout.input.anchors.values()].map((anchor) => ({
    side: anchor.side, pin: String(anchor.pin), x: anchor.x, y: anchor.y,
  }))
  const xExtra = [], yExtra = []
  anchors.forEach((anchor) => { xExtra.push(anchor.x); yExtra.push(anchor.y) })
  rects.forEach((rect) => {
    xExtra.push(rect.x - DIRECT_RECT_CLEARANCE - 0.2, rect.x + rect.width + DIRECT_RECT_CLEARANCE + 0.2)
    yExtra.push(rect.y - DIRECT_RECT_CLEARANCE - 0.2, rect.y + rect.height + DIRECT_RECT_CLEARANCE + 0.2)
  })
  anchors.forEach((anchor) => {
    xExtra.push(anchor.x - pinClearance - 0.2, anchor.x + pinClearance + 0.2)
    yExtra.push(anchor.y - pinClearance - 0.2, anchor.y + pinClearance + 0.2)
  })
  const xs = uniqueDirectAxis(3, layout.contentWidth - 3, xExtra)
  const ys = uniqueDirectAxis(50, layout.maxY, yExtra)
  const xIndex = new Map(xs.map((value, index) => [value.toFixed(3), index]))
  const yIndex = new Map(ys.map((value, index) => [value.toFixed(3), index]))
  const staticBlocked = new Uint8Array(xs.length * ys.length)
  for (let iy = 0; iy < ys.length; iy += 1) {
    for (let ix = 0; ix < xs.length; ix += 1) {
      if (rects.some((rect) => pointInRect({ x: xs[ix], y: ys[iy] }, rect, DIRECT_RECT_CLEARANCE))) {
        staticBlocked[(iy * xs.length) + ix] = 1
      }
    }
  }
  return { xs, ys, xIndex, yIndex, width: xs.length, height: ys.length,
    cells: xs.length * ys.length, staticBlocked, rects, anchors, pinClearance }
}

function directGridIndex(grid, point) {
  const x = grid.xIndex.get(directRound(point.x, 3).toFixed(3))
  const y = grid.yIndex.get(directRound(point.y, 3).toFixed(3))
  return Number.isInteger(x) && Number.isInteger(y) ? (y * grid.width) + x : -1
}

function directGridPoint(grid, index) {
  return { x: grid.xs[index % grid.width], y: grid.ys[Math.floor(index / grid.width)] }
}

function directEdgeAllowed(grid, a, b, connection, source, target, priorRoutes) {
  if (grid.rects.some((rect) => rectHitSegment(a, b, rect, DIRECT_RECT_CLEARANCE))) return false
  for (const anchor of grid.anchors) {
    const ownSource = anchor.side === 'output' && anchor.pin === String(connection.fromPin)
    const ownTarget = anchor.side === 'input' && anchor.pin === String(connection.toPin)
    if (ownSource || ownTarget) continue
    if (pointSegmentDistance(anchor, a, b) < grid.pinClearance - 1e-6) return false
  }
  for (const route of priorRoutes) {
    const sameSource = route.fromPin === connection.fromPin
    const sameTarget = route.toPin === connection.toPin
    for (let index = 1; index < route.points.length; index += 1) {
      const c = route.points[index - 1], d = route.points[index]
      const hit = segmentIntersection(a, b, c, d)
      if (hit) {
        const atSource = sameSource && !hit.overlap && directDistance(hit.point, source) <= 0.03
        const atTarget = sameTarget && !hit.overlap && directDistance(hit.point, target) <= 0.03
        const overlapStartsAtSource = sameSource && hit.overlap && directDistance(hit.point, source) <= 0.03
        const overlapEndsAtTarget = sameTarget && hit.overlap && directDistance(hit.end, target) <= 0.03
        if (!(atSource || atTarget || overlapStartsAtSource || overlapEndsAtTarget)) return false
      }
      const snappedSharedSource = sameSource && directDistance(a, source) <= 0.03
        && pointSegmentDistance(source, a, b) <= 0.03 && pointSegmentDistance(source, c, d) <= 0.03
      const snappedSharedTarget = sameTarget && directDistance(b, target) <= 0.03
        && pointSegmentDistance(target, a, b) <= 0.03 && pointSegmentDistance(target, c, d) <= 0.03
      const sharedSourceClearance = sameSource
        && pointSegmentDistance(source, a, b) <= DIRECT_ROUTE_CLEARANCE
        && pointSegmentDistance(source, c, d) <= DIRECT_ROUTE_CLEARANCE
      const sharedTargetClearance = sameTarget
        && pointSegmentDistance(target, a, b) <= DIRECT_ROUTE_CLEARANCE
        && pointSegmentDistance(target, c, d) <= DIRECT_ROUTE_CLEARANCE
      if (!snappedSharedSource && !snappedSharedTarget && !sharedSourceClearance && !sharedTargetClearance
        && segmentDistance(a, b, c, d) < DIRECT_ROUTE_CLEARANCE) return false
    }
  }
  return true
}

class DirectRouteMinHeap {
  constructor() { this.items = [] }
  push(item) {
    const values = this.items
    values.push(item)
    let index = values.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (values[parent].f <= item.f) break
      values[index] = values[parent]
      index = parent
    }
    values[index] = item
  }
  pop() {
    const values = this.items
    if (!values.length) return null
    const first = values[0], last = values.pop()
    if (values.length) {
      let index = 0
      while (true) {
        const left = (index * 2) + 1, right = left + 1
        if (left >= values.length) break
        const child = right < values.length && values[right].f < values[left].f ? right : left
        if (values[child].f >= last.f) break
        values[index] = values[child]
        index = child
      }
      values[index] = last
    }
    return first
  }
}

function simplifyDirectPolyline(points) {
  const compact = []
  for (const point of points) {
    const prior = compact[compact.length - 1]
    if (prior && directDistance(prior, point) < 0.001) continue
    if (compact.length >= 2) {
      const a = compact[compact.length - 2], b = compact[compact.length - 1]
      if ((Math.abs(a.x - b.x) < 0.001 && Math.abs(b.x - point.x) < 0.001)
        || (Math.abs(a.y - b.y) < 0.001 && Math.abs(b.y - point.y) < 0.001)) compact.pop()
    }
    compact.push({ x: point.x, y: point.y })
  }
  return compact
}

function directPathLength(points) {
  let total = 0
  for (let index = 1; index < points.length; index += 1) total += directDistance(points[index - 1], points[index])
  return total
}

function searchDirectSolderPath(grid, connection, priorRoutes, output, input) {
  const source = output.anchors.get(String(connection.fromPin))
  const target = input.anchors.get(String(connection.toPin))
  if (!source || !target) return null
  const start = directGridIndex(grid, source), goal = directGridIndex(grid, target)
  if (start < 0 || goal < 0) return null
  const nodeFree = (index) => {
    if (index !== start && index !== goal && grid.staticBlocked[index]) return false
    const point = directGridPoint(grid, index)
    return !grid.anchors.some((anchor) => !(anchor.side === 'output' && anchor.pin === String(connection.fromPin))
      && !(anchor.side === 'input' && anchor.pin === String(connection.toPin))
      && directDistance(point, anchor) < grid.pinClearance - 1e-6)
  }
  if (!nodeFree(start) || !nodeFree(goal)) return null
  const states = grid.cells * 5
  const best = new Float64Array(states); best.fill(Infinity)
  const parent = new Int32Array(states); parent.fill(-1)
  const closed = new Uint8Array(states)
  const startState = (start * 5) + 4
  best[startState] = 0
  const goalPoint = directGridPoint(grid, goal)
  const heap = new DirectRouteMinHeap()
  heap.push({ state: startState, node: start, direction: 4, g: 0,
    f: Math.abs(source.x - goalPoint.x) + Math.abs(source.y - goalPoint.y) })
  const directions = [
    { dx: 1, dy: 0, direction: 0 }, { dx: 0, dy: 1, direction: 1 },
    { dx: -1, dy: 0, direction: 2 }, { dx: 0, dy: -1, direction: 3 },
  ]
  let expanded = 0, winner = -1
  while (heap.items.length && expanded < DIRECT_MAX_EXPANDED_STATES) {
    const item = heap.pop()
    if (!item || closed[item.state] || item.g > best[item.state] + 1e-9) continue
    closed[item.state] = 1
    expanded += 1
    if (item.node === goal) { winner = item.state; break }
    const x = item.node % grid.width, y = Math.floor(item.node / grid.width)
    const point = directGridPoint(grid, item.node)
    for (const move of directions) {
      const nextX = x + move.dx, nextY = y + move.dy
      if (nextX < 0 || nextY < 0 || nextX >= grid.width || nextY >= grid.height) continue
      const next = (nextY * grid.width) + nextX
      if (!nodeFree(next)) continue
      const nextPoint = directGridPoint(grid, next)
      if (!directEdgeAllowed(grid, point, nextPoint, connection, source, target, priorRoutes)) continue
      const cost = item.g + directDistance(point, nextPoint)
        + (item.direction < 4 && item.direction !== move.direction ? 2.4 : 0)
      const nextState = (next * 5) + move.direction
      if (cost >= best[nextState] - 1e-9) continue
      best[nextState] = cost
      parent[nextState] = item.state
      const heuristic = Math.abs(nextPoint.x - goalPoint.x) + Math.abs(nextPoint.y - goalPoint.y)
      heap.push({ state: nextState, node: next, direction: move.direction, g: cost, f: cost + heuristic })
    }
  }
  if (winner < 0) return null
  const reversed = []
  let cursor = winner
  while (cursor >= 0) {
    reversed.push(directGridPoint(grid, Math.floor(cursor / 5)))
    cursor = parent[cursor]
  }
  reversed.reverse()
  const points = simplifyDirectPolyline(reversed)
  points[0] = { x: source.x, y: source.y }
  points[points.length - 1] = { x: target.x, y: target.y }
  return { points, length: directPathLength(points), expanded }
}

function directSharedSegments(pointsA, pointsB) {
  const shared = []
  let i = 0, j = 0, current = pointsA[0]
  if (!pointsA.length || !pointsB.length || directDistance(pointsA[0], pointsB[0]) > 0.025) return shared
  while (i + 1 < pointsA.length && j + 1 < pointsB.length) {
    const a = pointsA[i + 1], b = pointsB[j + 1]
    const ax = a.x - current.x, ay = a.y - current.y
    const bx = b.x - current.x, by = b.y - current.y
    const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by)
    if (al < 1e-8 || bl < 1e-8 || Math.abs((ax * by) - (ay * bx)) > 1e-7 * al * bl || (ax * bx) + (ay * by) < 0) break
    const next = al < bl ? a : b
    shared.push([current, next])
    current = next
    if (al <= bl + 1e-8) i += 1
    if (bl <= al + 1e-8) j += 1
  }
  return shared
}

function directHitIsShared(hit, routeA, routeB) {
  if (!hit) return false
  const commonSource = routeA.fromPin === routeB.fromPin
  const commonTarget = routeA.toPin === routeB.toPin
  const prefix = commonSource ? directSharedSegments(routeA.points, routeB.points) : []
  const reversed = (route) => route.points.slice().reverse()
  const suffix = commonTarget ? directSharedSegments(reversed(routeA), reversed(routeB)).map(([a, b]) => [b, a]) : []
  const onShared = (point, segments) => segments.some(([a, b]) => pointSegmentDistance(point, a, b) <= 0.025)
  if (!hit.overlap) return onShared(hit.point, prefix) || onShared(hit.point, suffix)
    || commonSource && directDistance(hit.point, routeA.points[0]) <= 0.025
    || commonTarget && directDistance(hit.point, routeA.points[routeA.points.length - 1]) <= 0.025
  const end = hit.end || hit.point
  return onShared(hit.point, prefix) && onShared(end, prefix)
    || onShared(hit.point, suffix) && onShared(end, suffix)
}

function auditDirectSolderRoutes(routes) {
  for (let i = 0; i < routes.length; i += 1) {
    const first = routes[i]
    for (let a = 1; a < first.points.length; a += 1) {
      for (let b = a + 2; b < first.points.length; b += 1) {
        if (segmentIntersection(first.points[a - 1], first.points[a], first.points[b - 1], first.points[b])) return false
      }
    }
    for (let j = i + 1; j < routes.length; j += 1) {
      const second = routes[j]
      for (let a = 1; a < first.points.length; a += 1) {
        for (let b = 1; b < second.points.length; b += 1) {
          const hit = segmentIntersection(first.points[a - 1], first.points[a], second.points[b - 1], second.points[b])
          if (hit && !directHitIsShared(hit, first, second)) return false
        }
      }
    }
  }
  return true
}

function directRouteOrderings(connections, output, input) {
  const original = connections.slice()
  const coordinates = (connection) => {
    const source = output.anchors.get(String(connection.fromPin)) || { x: 0, y: 0 }
    const target = input.anchors.get(String(connection.toPin)) || { x: 0, y: 0 }
    return { sy: source.y, ty: target.y, length: directDistance(source, target) }
  }
  const candidates = []
  if (output.endpoint && output.endpoint.id === 'trsBalanced'
    && input.endpoint && input.endpoint.id === 'tsStereo' && input.rotationDegrees === 180 && original.length > 1) {
    candidates.push(original.slice(-1).concat(original.slice(0, -1)))
  }
  candidates.push(original, original.slice().reverse(),
    original.slice().sort((a, b) => coordinates(a).sy - coordinates(b).sy || a.id.localeCompare(b.id)),
    original.slice().sort((a, b) => coordinates(b).sy - coordinates(a).sy || a.id.localeCompare(b.id)),
    original.slice().sort((a, b) => coordinates(a).ty - coordinates(b).ty || a.id.localeCompare(b.id)),
    original.slice().sort((a, b) => coordinates(b).ty - coordinates(a).ty || a.id.localeCompare(b.id)),
    original.slice().sort((a, b) => coordinates(a).length - coordinates(b).length || a.id.localeCompare(b.id)),
    original.slice().sort((a, b) => coordinates(b).length - coordinates(a).length || a.id.localeCompare(b.id)),
    original.slice().sort((a, b) => (coordinates(a).ty - coordinates(a).sy) - (coordinates(b).ty - coordinates(b).sy)
      || a.id.localeCompare(b.id)),
    original.slice().sort((a, b) => (coordinates(b).ty - coordinates(b).sy) - (coordinates(a).ty - coordinates(a).sy)
      || a.id.localeCompare(b.id)),
  )
  for (let offset = 0; offset < original.length; offset += 1) {
    const rotated = original.slice(offset).concat(original.slice(0, offset))
    candidates.push(rotated, rotated.slice().reverse())
  }
  const seen = new Set()
  return candidates.filter((order) => {
    const signature = order.map((connection) => connection.id).join('|')
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  }).slice(0, 24)
}

function solveDirectSolderRoutes(model, layout) {
  const grid = buildDirectRouteGrid(layout)
  for (const order of directRouteOrderings(model.connections, layout.output, layout.input)) {
    const routes = []
    let failed = false
    for (const connection of order) {
      const result = searchDirectSolderPath(grid, connection, routes, layout.output, layout.input)
      if (!result) { failed = true; break }
      const from = layout.output.anchors.get(String(connection.fromPin))
      const to = layout.input.anchors.get(String(connection.toPin))
      routes.push({ id: connection.id, connection, fromPin: connection.fromPin, toPin: connection.toPin,
        from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y },
        points: result.points, length: result.length })
    }
    if (failed || routes.length !== model.connections.length || !auditDirectSolderRoutes(routes)) continue
    const byId = new Map(routes.map((route) => [route.id, route]))
    return { routes: model.connections.map((connection) => byId.get(connection.id)), error: '' }
  }
  return { routes: [], error: '没有找到连接真实焊点且无交叉的接线路径。' }
}

function selectSolderRoutes(model, layout) {
  const selection = lookupSolderRoutes(model, layout) || solveDirectSolderRoutes(model, layout)
  if (selection.error) return selection
  const routes = selection.routes.map((route) => ({ ...route,
    photoFrom: { ...route.from }, photoTo: { ...route.to },
    points: route.points.map((point) => [point.x, point.y]) }))
  return { routes, error: '' }
}


const solderGeometryCache = new WeakMap()
const ON_LOAD_SOLDER_GEOMETRY_SLOTS = 2
const onLoadSolderGeometryCache = new Map()
const onLoadSolderGeometryScopes = new WeakMap()
const SOLDER_GEOMETRY_CACHE_VERSION = 'audio-solder-direct-photo-pins-v1'

function safeSolderCacheValue(value, seen = new WeakSet()) {
  if (value === null) return 'null;'
  if (value === undefined) return 'undefined;'
  if (typeof value === 'string') return `string:${value.length}:${value};`
  if (typeof value === 'boolean') return value ? 'boolean:1;' : 'boolean:0;'
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? `number:${String(value)};` : null
  if (typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  try {
    const prototype = Object.getPrototypeOf(value)
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return null
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
      const keys = Reflect.ownKeys(value)
      if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1 || keys[keys.length - 1] !== 'length') return null
      const items = []
      for (let index = 0; index < length; index += 1) {
        if (keys[index] !== String(index)) return null
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable) return null
        const encoded = safeSolderCacheValue(descriptor.value, seen)
        if (encoded === null) return null
        items.push(encoded)
      }
      return `array:${length}:[${items.join('')}]`
    }
    if (prototype !== Object.prototype && prototype !== null) return null
    const entries = []
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return null
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable) return null
      const encoded = safeSolderCacheValue(descriptor.value, seen)
      if (encoded === null) return null
      entries.push(`key:${key.length}:${key}=${encoded}`)
    }
    return `object:${prototype === null ? 'null' : 'plain'}:{${entries.join('')}}`
  } catch (error) { return null }
}

function registerOnLoadSolderGeometryCacheModel(model) {
  try {
    const snapshot = safeSolderCacheValue(model)
    if (snapshot === null || !model || model.status !== 'ready' || model.supported !== true
      || !Array.isArray(model.connections) || model.connections.length === 0) return () => {}
    const token = {}
    onLoadSolderGeometryScopes.set(model, { token })
    return () => {
      try {
        const current = onLoadSolderGeometryScopes.get(model)
        if (current && current.token === token) onLoadSolderGeometryScopes.delete(model)
      } catch (error) {}
    }
  } catch (error) { return () => {} }
}

function getOnLoadSolderGeometryScope(model) {
  return model && onLoadSolderGeometryScopes.get(model) || null
}

function snapshotSolderAnchors(anchors) {
  try {
    if (!anchors || Object.getPrototypeOf(anchors) !== Map.prototype) return null
    const entries = []
    for (const [key, point] of Map.prototype.entries.call(anchors)) {
      if (typeof key !== 'string' || !point || typeof point !== 'object') return null
      entries.push([key, { x: point.x, y: point.y, photo: Boolean(point.photo), channel: point.channel || '',
        photoKey: point.photoKey || '', photoPixel: point.photoPixel
          ? [point.photoPixel.x, point.photoPixel.y] : null, rotationDegrees: point.rotationDegrees || 0,
        routeDirection: point.routeDirection || null, labelRect: point.labelRect || null }])
    }
    return safeSolderCacheValue(entries)
  } catch (error) { return null }
}

function snapshotSolderObstacles(layout) {
  try {
    return safeSolderCacheValue((layout.obstacles || []).map(({ x, y, width, height, kind }) => ({ x, y, width, height, kind })))
  } catch (error) { return null }
}

function makeOnLoadSolderGeometryKey(model, width, contentWidth, options, output, input, photoBottom, maxHeight) {
  if (!getOnLoadSolderGeometryScope(model) || !Number.isFinite(width) || !Number.isFinite(contentWidth)
    || !Number.isFinite(photoBottom) || !Number.isFinite(maxHeight) || width <= 0 || contentWidth <= 0) return null
  const endpoints = []
  for (const connection of model.connections) {
    const from = connection && Object.getOwnPropertyDescriptor(connection, 'fromPin')
    const to = connection && Object.getOwnPropertyDescriptor(connection, 'toPin')
    const id = connection && Object.getOwnPropertyDescriptor(connection, 'id')
    if (!from || !to || !id || !Object.prototype.hasOwnProperty.call(from, 'value')
      || !Object.prototype.hasOwnProperty.call(to, 'value') || !Object.prototype.hasOwnProperty.call(id, 'value')
      || typeof from.value !== 'string' || typeof to.value !== 'string' || typeof id.value !== 'string') return null
    const metadata = ['fromLabel', 'toLabel', 'fromRole', 'toRole'].map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(connection, key)
      if (descriptor && !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null
      return descriptor ? descriptor.value : undefined
    })
    if (metadata.includes(null)) return null
    endpoints.push([id.value, from.value, to.value, ...metadata])
  }
  const key = safeSolderCacheValue({
    version: SOLDER_GEOMETRY_CACHE_VERSION,
    endpoints,
    outputAnchors: snapshotSolderAnchors(output.anchors), inputAnchors: snapshotSolderAnchors(input.anchors),
    outputObstacles: snapshotSolderObstacles(output), inputObstacles: snapshotSolderObstacles(input),
    outputSpec: output.photoSpec && [output.photoSpec.key, output.photoSpec.width, output.photoSpec.height,
      output.photoSpec.contentRect && [output.photoSpec.contentRect.x, output.photoSpec.contentRect.y,
        output.photoSpec.contentRect.width, output.photoSpec.contentRect.height]],
    inputSpec: input.photoSpec && [input.photoSpec.key, input.photoSpec.width, input.photoSpec.height,
      input.photoSpec.contentRect && [input.photoSpec.contentRect.x, input.photoSpec.contentRect.y,
        input.photoSpec.contentRect.width, input.photoSpec.contentRect.height]],
    outputRotation: output.rotationDegrees || 0, inputRotation: input.rotationDegrees || 0,
    outputBoxes: (output.photoBoxes || []).map((box) => [box.key, box.x, box.y, box.width, box.height,
      box.destination && [box.destination.x, box.destination.y, box.destination.width, box.destination.height,
        box.destination.crop && [box.destination.crop.x, box.destination.crop.y,
          box.destination.crop.width, box.destination.crop.height]]]),
    inputBoxes: (input.photoBoxes || []).map((box) => [box.key, box.x, box.y, box.width, box.height,
      box.destination && [box.destination.x, box.destination.y, box.destination.width, box.destination.height,
        box.destination.crop && [box.destination.crop.x, box.destination.crop.y,
          box.destination.crop.width, box.destination.crop.height]]]),
    width, contentWidth, avoidRail: Boolean(options.avoidRail), photoBottom, maxHeight,
    theme: options.theme === 'dark' ? 'dark' : 'light',
  })
  return key === null ? null : key
}

function cloneRoute(route, connection, output, input) {
  if (!route || route.id !== connection.id || route.fromPin !== connection.fromPin || route.toPin !== connection.toPin) return null
  const photoFromAnchor = output.anchors.get(String(connection.fromPin))
  const photoToAnchor = input.anchors.get(String(connection.toPin))
  if (!photoFromAnchor || !photoToAnchor || !Array.isArray(route.points) || route.points.length < 2
    || !Number.isFinite(route.length)) return null
  const copyPoint = (point) => {
    if (Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) return { x: point[0], y: point[1] }
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: point.x, y: point.y }
    return null
  }
  const from = copyPoint(route.from), to = copyPoint(route.to)
  const photoFrom = copyPoint(route.photoFrom), photoTo = copyPoint(route.photoTo)
  const points = route.points.map(copyPoint).map((point) => point && [point.x, point.y])
  if (!from || !to || !photoFrom || !photoTo || points.some((point) => !point)) return null
  const matches = (point, anchor) => Math.abs(point.x - anchor.x) <= 0.01 && Math.abs(point.y - anchor.y) <= 0.01
  if (!matches(photoFrom, photoFromAnchor) || !matches(photoTo, photoToAnchor)
    || Math.abs(points[0][0] - from.x) > 0.01 || Math.abs(points[0][1] - from.y) > 0.01
    || Math.abs(points[points.length - 1][0] - to.x) > 0.01 || Math.abs(points[points.length - 1][1] - to.y) > 0.01
    || !matches(from, photoFromAnchor) || !matches(to, photoToAnchor)) return null
  return { id: connection.id, connection, fromPin: connection.fromPin, toPin: connection.toPin,
    from, to, photoFrom, photoTo, points, length: route.length }
}

function routesInConnectionOrder(routes, connections) {
  if (!Array.isArray(routes) || !Array.isArray(connections) || routes.length !== connections.length) return null
  const byId = new Map()
  for (const route of routes) {
    if (!route || route.id === undefined || byId.has(route.id)) return null
    const fromPin = route.fromPin === undefined && route.connection ? route.connection.fromPin : route.fromPin
    const toPin = route.toPin === undefined && route.connection ? route.connection.toPin : route.toPin
    if (fromPin === undefined || toPin === undefined) return null
    byId.set(route.id, { ...route, fromPin, toPin })
  }
  const ordered = []
  for (const connection of connections) {
    const route = byId.get(connection && connection.id)
    if (!route || route.fromPin !== connection.fromPin || route.toPin !== connection.toPin) return null
    ordered.push(route)
  }
  return byId.size === ordered.length ? ordered : null
}

function getOnLoadSolderGeometry(key, connections, output, input) {
  if (key === null) return null
  const entry = onLoadSolderGeometryCache.get(key)
  if (!entry) return null
  onLoadSolderGeometryCache.delete(key)
  onLoadSolderGeometryCache.set(key, entry)
  const ordered = routesInConnectionOrder(entry.routes, connections)
  if (!ordered) return null
  const routes = ordered.map((snapshot, index) => cloneRoute(snapshot, connections[index], output, input))
  return routes.every(Boolean) ? { routes, error: '' } : null
}

function snapshotSuccessfulSolderRoutes(routeSelection, connections, output, input) {
  if (!routeSelection || routeSelection.error !== '' || !Array.isArray(routeSelection.routes)
    || routeSelection.routes.length !== connections.length) return null
  const ordered = routesInConnectionOrder(routeSelection.routes, connections)
  if (!ordered) return null
  const routes = []
  for (const route of ordered) {
    if (!route || !Array.isArray(route.points) || route.points.length < 2
      || !Number.isFinite(route.length)) return null
    const asPoint = (point) => {
      const x = Array.isArray(point) ? point[0] : point && point.x
      const y = Array.isArray(point) ? point[1] : point && point.y
      return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
    }
    const connection = connections.find((item) => item.id === route.id)
    if (!connection || route.fromPin !== connection.fromPin || route.toPin !== connection.toPin) return null
    const source = output.anchors.get(String(connection.fromPin)), target = input.anchors.get(String(connection.toPin))
    const from = asPoint(route.from), to = asPoint(route.to)
    const photoFrom = asPoint(route.photoFrom), photoTo = asPoint(route.photoTo)
    const points = route.points.map(asPoint)
    const matches = (point, anchor) => point && anchor && Math.abs(point[0] - anchor.x) <= 0.01 && Math.abs(point[1] - anchor.y) <= 0.01
    if (!source || !target || !from || !to || !photoFrom || !photoTo || points.some((point) => !point)
      || !matches(photoFrom, source) || !matches(photoTo, target)
      || !matches(from, source) || !matches(to, target)
      || !matches(points[0], source) || !matches(points[points.length - 1], target)) return null
    routes.push({ id: route.id, fromPin: connection.fromPin, toPin: connection.toPin,
      from, to, photoFrom, photoTo, points, length: route.length })
  }
  return routes
}

function storeOnLoadSolderGeometry(key, routeSelection, connections, output, input) {
  if (key === null) return
  const routes = snapshotSuccessfulSolderRoutes(routeSelection, connections, output, input)
  if (!routes) return
  const frozenRoutes = routes.map((route) => Object.freeze({
    id: route.id, fromPin: route.fromPin, toPin: route.toPin,
    from: Object.freeze(route.from), to: Object.freeze(route.to),
    photoFrom: Object.freeze(route.photoFrom), photoTo: Object.freeze(route.photoTo),
    points: Object.freeze(route.points.map((point) => Object.freeze(point))), length: route.length,
  }))
  const entry = Object.freeze({ routes: Object.freeze(frozenRoutes) })
  if (onLoadSolderGeometryCache.has(key)) onLoadSolderGeometryCache.delete(key)
  onLoadSolderGeometryCache.set(key, entry)
  while (onLoadSolderGeometryCache.size > ON_LOAD_SOLDER_GEOMETRY_SLOTS) {
    onLoadSolderGeometryCache.delete(onLoadSolderGeometryCache.keys().next().value)
  }
}

function solderPhotoBottom(layout) {
  return (layout.photoBoxes || []).reduce((bottom, box) => Math.max(bottom, box.y + box.height), 0)
}

function buildSolderRouteSolveLayout(model, width, options = {}) {
  const gallery = makeSolderGalleryPlan(model, width, options)
  let baseOutput = makeSolderEndpoint(model, 'output', themeFor(options.theme), gallery)
  let baseInput = makeSolderEndpoint(model, 'input', themeFor(options.theme), gallery)
  baseOutput = rotateSolderEndpointPhoto(baseOutput, gallery.pose.outputRotationDegrees)
  baseInput = rotateSolderEndpointPhoto(baseInput, gallery.pose.inputRotationDegrees)
  repositionTerminalPhotoLabels(baseOutput)
  repositionTerminalPhotoLabels(baseInput)
  baseOutput.photoBottom = solderPhotoBottom(baseOutput)
  baseInput.photoBottom = solderPhotoBottom(baseInput)
  const photoBottom = Math.max(baseOutput.photoBottom, baseInput.photoBottom, 112)
  const maxHeight = photoBottom + DIRECT_MAX_EXTRA_HEIGHT
  const solveLayout = { contentWidth: gallery.contentWidth, maxY: maxHeight,
    output: baseOutput, input: baseInput,
    obstacles: [...baseOutput.obstacles, ...baseInput.obstacles],
    pinClearance: model && model.output && model.input
      && model.output.id === 'terminalBalanced' && model.input.id === 'terminalBalanced' ? 5 : DIRECT_PIN_CLEARANCE }
  return { gallery, baseOutput, baseInput, photoBottom, maxHeight, solveLayout }
}

function createCanonicalSolderRouteTableEntry(model, options = {}) {
  const { solveLayout } = buildSolderRouteSolveLayout(model, 274, { avoidRail: true, ...options })
  const selection = solveDirectSolderRoutes(model, solveLayout)
  if (selection.error) throw new Error(selection.error)
  return {
    ...makeSolderRouteMatchParts(model, solveLayout),
    routes: selection.routes.map((route) => ({
      id: route.id,
      points: route.points.map((point) => [point.x, point.y]),
    })),
  }
}

function localSolderGeometryKey(model, width, contentWidth, options, output, input, photoBottom, maxHeight) {
  const endpoints = (model && Array.isArray(model.connections) ? model.connections : []).map((connection) =>
    [connection && connection.id, connection && connection.fromPin, connection && connection.toPin,
      connection && connection.fromLabel, connection && connection.toLabel,
      connection && connection.fromRole, connection && connection.toRole])
  return safeSolderCacheValue({
    version: SOLDER_GEOMETRY_CACHE_VERSION, endpoints,
    outputAnchors: snapshotSolderAnchors(output.anchors), inputAnchors: snapshotSolderAnchors(input.anchors),
    outputObstacles: snapshotSolderObstacles(output), inputObstacles: snapshotSolderObstacles(input),
    outputSpec: output.photoSpec && [output.photoSpec.key, output.photoSpec.width, output.photoSpec.height,
      output.photoSpec.contentRect && [output.photoSpec.contentRect.x, output.photoSpec.contentRect.y,
        output.photoSpec.contentRect.width, output.photoSpec.contentRect.height]],
    inputSpec: input.photoSpec && [input.photoSpec.key, input.photoSpec.width, input.photoSpec.height,
      input.photoSpec.contentRect && [input.photoSpec.contentRect.x, input.photoSpec.contentRect.y,
        input.photoSpec.contentRect.width, input.photoSpec.contentRect.height]],
    outputRotation: output.rotationDegrees || 0, inputRotation: input.rotationDegrees || 0,
    outputBoxes: (output.photoBoxes || []).map((box) => [box.key, box.channel, box.x, box.y,
      box.width, box.height, box.columnX, box.columnWidth, box.destination && [box.destination.x,
        box.destination.y, box.destination.width, box.destination.height,
        box.destination.crop && [box.destination.crop.x, box.destination.crop.y,
          box.destination.crop.width, box.destination.crop.height]]]),
    inputBoxes: (input.photoBoxes || []).map((box) => [box.key, box.channel, box.x, box.y,
      box.width, box.height, box.columnX, box.columnWidth, box.destination && [box.destination.x,
        box.destination.y, box.destination.width, box.destination.height,
        box.destination.crop && [box.destination.crop.x, box.destination.crop.y,
          box.destination.crop.width, box.destination.crop.height]]]),
    width, contentWidth, avoidRail: Boolean(options.avoidRail), theme: options.theme === 'dark' ? 'dark' : 'light',
    photoBottom, maxHeight,
  })
}

function cachedLocalSolderGeometry(entry, connections, output, input) {
  if (!Array.isArray(entry) || entry.length !== connections.length) return null
  const ordered = routesInConnectionOrder(entry, connections)
  if (!ordered) return null
  const routes = ordered.map((snapshot, index) => cloneRoute(snapshot, connections[index], output, input))
  return routes.every(Boolean) ? { routes, error: '' } : null
}

function shiftSolderEndpoint(layout, dx) {
  if (!dx) return layout
  const boxMap = new Map()
  const photoBoxes = layout.photoBoxes.map((box) => {
    const shifted = { ...box, x: box.x + dx, columnX: box.columnX + dx,
      destination: { ...box.destination, x: box.destination.x + dx } }
    boxMap.set(box, shifted)
    return shifted
  })
  const anchors = new Map()
  layout.anchors.forEach((anchor, key) => anchors.set(key, { ...anchor, x: anchor.x + dx,
    box: boxMap.get(anchor.box) || photoBoxes[0],
    labelRect: anchor.labelRect && { ...anchor.labelRect, x: anchor.labelRect.x + dx,
      textX: anchor.labelRect.textX + dx } }))
  return { ...layout, x: layout.x + dx, centerX: layout.centerX + dx,
    photoBoxes, anchors,
    channelLabels: (layout.channelLabels || []).map((label) => ({ ...label, x: label.x + dx, textX: label.textX + dx })),
    terminalCaption: layout.terminalCaption && { ...layout.terminalCaption, x: layout.terminalCaption.x + dx,
      rect: { ...layout.terminalCaption.rect, x: layout.terminalCaption.rect.x + dx } },
    obstacles: (layout.obstacles || []).map((rect) => ({ ...rect, x: rect.x + dx })) }
}

function shiftSolderRoute(route, dx) {
  const shiftObjectPoint = (point) => ({ x: point.x + dx, y: point.y })
  return { ...route, from: shiftObjectPoint(route.from), to: shiftObjectPoint(route.to),
    photoFrom: shiftObjectPoint(route.photoFrom), photoTo: shiftObjectPoint(route.photoTo),
    points: route.points.map((point) => [point[0] + dx, point[1]]) }
}

function shiftSolderGallery(gallery, dx) {
  if (!dx) return gallery
  return { ...gallery, heads: gallery.heads.map((head) => {
    const box = head.box
    return { ...head, columnX: head.columnX + dx, box: { ...box, x: box.x + dx, columnX: box.columnX + dx,
      destination: { ...box.destination, x: box.destination.x + dx } } }
  }) }
}

function solderWiringLayout(width, model, options = {}) {
  const onLoadCacheScope = getOnLoadSolderGeometryScope(model)
  const supported = Boolean(model && model.supported && Array.isArray(model.connections))
  const { gallery, baseOutput, baseInput, photoBottom, maxHeight, solveLayout } =
    buildSolderRouteSolveLayout(model, width, options)
  const endpointDecorationBottom = [baseOutput, baseInput].reduce((bottom, endpoint) => {
    const caption = endpoint.terminalCaption && endpoint.terminalCaption.rect
    return Math.max(bottom, caption ? caption.y + caption.height + 4 : 0)
  }, 0)
  const connections = supported ? model.connections : []
  const cacheable = model && (typeof model === 'object' || typeof model === 'function')
  let routeCache = cacheable ? solderGeometryCache.get(model) : null
  if (!routeCache) {
    routeCache = new Map()
    if (cacheable) solderGeometryCache.set(model, routeCache)
  }
  const actualContentWidth = gallery.actualContentWidth
  let localKey = null
  try { localKey = localSolderGeometryKey(model, width, actualContentWidth, options,
    baseOutput, baseInput, photoBottom, maxHeight) } catch (error) {}
  let cachedGeometry = localKey === null ? null : cachedLocalSolderGeometry(routeCache.get(localKey), connections, baseOutput, baseInput)
  if (!cachedGeometry) {
    let crossModelKey = null
    if (onLoadCacheScope) {
      try {
        crossModelKey = makeOnLoadSolderGeometryKey(model, width, actualContentWidth, options,
          baseOutput, baseInput, photoBottom, maxHeight)
      } catch (error) {}
    }
    try { cachedGeometry = getOnLoadSolderGeometry(crossModelKey, connections, baseOutput, baseInput) } catch (error) {}
    if (!cachedGeometry) {
      const routeSelection = supported ? selectSolderRoutes(model, solveLayout) : { routes: [], error: '' }
      if (routeSelection.error === '' && routeSelection.routes.length === connections.length) {
        const snapshots = snapshotSuccessfulSolderRoutes(routeSelection, connections, baseOutput, baseInput)
        cachedGeometry = cachedLocalSolderGeometry(snapshots, connections, baseOutput, baseInput)
        if (!cachedGeometry) cachedGeometry = { routes: [], error: '真实焊点路径不完整。' }
        if (localKey !== null && snapshots) routeCache.set(localKey, snapshots)
        try { storeOnLoadSolderGeometry(crossModelKey, routeSelection, connections, baseOutput, baseInput) } catch (error) {}
      } else {
        cachedGeometry = { routes: [], error: routeSelection.error || '真实焊点路径不完整。' }
      }
    } else if (localKey !== null) {
      const snapshots = snapshotSuccessfulSolderRoutes(cachedGeometry, connections, baseOutput, baseInput)
      if (snapshots) routeCache.set(localKey, snapshots)
    }
  }
  const routingError = cachedGeometry.error
  const translationX = gallery.translationX
  const output = shiftSolderEndpoint(baseOutput, translationX)
  const input = shiftSolderEndpoint(baseInput, translationX)
  const connectionAnchors = routingError ? [] : cachedGeometry.routes.map((route) => shiftSolderRoute(route, translationX))
  const shiftedGallery = shiftSolderGallery(gallery, translationX)
  const labelBottom = [output, input].flatMap((endpoint) => [...endpoint.anchors.values()]
    .map((anchor) => anchor.labelRect && anchor.labelRect.y + anchor.labelRect.height).filter(Number.isFinite))
    .reduce((bottom, value) => Math.max(bottom, value), 0)
  const routeBottom = connectionAnchors.flatMap((route) => route.points.map((point) => point[1]))
    .reduce((bottom, value) => Math.max(bottom, value), 0)
  const reasonLines = !supported && model
    ? textLines(model.reason || '没有可用的接线方案。', Math.max(1, Math.floor((width - 20) / 12)), 8).length : 0
  const height = Math.ceil(Math.max(labelBottom, routeBottom, endpointDecorationBottom, photoBottom, 128) + 16
    + (reasonLines ? 24 + reasonLines * 17 : 0) + 12)
  return { mode: 'solder-wiring', height, output, input, gallery: shiftedGallery,
    connectionAnchors, supported, routingError }
}

function drawSolderEndpoint(ctx, layout, theme, origin, paintBase = true, selectedPin, selectedColor) {
  const { endpoint, pins, side, centerX, photoSpec, photo, anchors } = layout
  if (!endpoint) return
  if (paintBase) {
    text(ctx, side === 'output' ? '输出端' : '输入端', origin.x + centerX, origin.y + 14, 11, theme.secondary, 600, 'center')
    wrappedText(ctx, solderEndpointTitle(endpoint), origin.x + centerX, origin.y + 30,
      layout.columnWidth - 8, 10, theme.text, 600, 'center', 2)
    if (photo && photoSpec) {
      ;(layout.photoBoxes || []).forEach((box) => {
        const destination = box.destination || photoDestination(box, photoSpec)
        const image = box.photo || photo
        if (image && layout.rotationDegrees) {
          ctx.save()
          ctx.translate(origin.x + destination.x + (destination.width / 2),
            origin.y + destination.y + (destination.height / 2))
          ctx.rotate((layout.rotationDegrees * Math.PI) / 180)
          ctx.drawImage(image, -(destination.width / 2), -(destination.height / 2),
            destination.width, destination.height)
          ctx.restore()
        } else if (image) ctx.drawImage(image, origin.x + destination.x, origin.y + destination.y,
          destination.width, destination.height)
        else roundedRect(ctx, origin.x + destination.x, origin.y + destination.y,
          destination.width, destination.height, 5, theme.card, theme.border)
      })
      ;(layout.channelLabels || []).forEach((label) => text(ctx, label.text,
        origin.x + label.textX, origin.y + label.textY, 9, theme.secondary, 700, 'left'))
      if (photoSpec.kind === 'terminal') {
        const caption = layout.terminalCaption
        if (caption) caption.lines.forEach((line, index) => text(ctx, line, origin.x + caption.x,
          origin.y + caption.y + (index * caption.size * 1.35), caption.size, theme.secondary, 600, 'center'))
      }
    } else {
      roundedRect(ctx, origin.x + layout.x + 4, origin.y + 72,
        layout.columnWidth - 8, 74, 9, theme.card, theme.border)
      text(ctx, '接线端示意', origin.x + centerX, origin.y + 112, 9, theme.tertiary, 400, 'center')
    }
    return
  }

  pins.forEach((pin) => {
    const point = anchors.get(pin.pin)
    if (!point) return
    const px = origin.x + point.x, py = origin.y + point.y
    const color = roleColor(pin.role, theme)
    if (selectedPin !== undefined && String(pin.pin) === String(selectedPin)) {
      circle(ctx, px, py, 5, null, selectedColor || color, 2)
    }
    if (!layout.isPhotoEndpoint) {
      const label = pin.label || pin.pin
      const chipWidth = point.chipWidth || Math.min(layout.columnWidth - 16, Math.max(38, [...String(label)].length * 8 + 16))
      const chipCenter = Number.isFinite(point.chipCenter) ? origin.x + point.chipCenter
        : (px + (side === 'output' ? -chipWidth / 2 : chipWidth / 2))
      roundedRect(ctx, chipCenter - chipWidth / 2, py - 9, chipWidth, 18, 7, theme.background, color)
      text(ctx, label, chipCenter, py + 3, 9, color, 700, 'center')
      if (!pin.count) text(ctx, '悬空', chipCenter, py + 17, 8, theme.tertiary, 500, 'center')
      return
    }
    circle(ctx, px, py, pin.count ? 3.1 : 2.7, pin.count ? color : theme.background, color, 1.2)
    if (!point.labelRect) return
    const rect = point.labelRect
    roundedRect(ctx, origin.x + rect.x, origin.y + rect.y, rect.width, rect.height,
      3, theme.background, theme.border)
    text(ctx, rect.label || point.label, origin.x + rect.textX, origin.y + rect.textY,
      9, theme.text, 700, rect.textAnchor === 'middle' ? 'center' : 'left')
  })
}

function drawSolderWiring(ctx, model, width, theme, origin, metrics, options) {
  drawSolderEndpoint(ctx, metrics.output, theme, origin, true)
  drawSolderEndpoint(ctx, metrics.input, theme, origin, true)
  const selectedItem = metrics.connectionAnchors.find((item) => item.id === options.selectedId) || null
  const drawOrder = selectedItem
    ? metrics.connectionAnchors.filter((item) => item !== selectedItem).concat(selectedItem)
    : metrics.connectionAnchors
  drawOrder.forEach((item) => {
    const selected = item === selectedItem
    ctx.beginPath()
    ctx.setStrokeStyle(connectionColor(item.connection, theme))
    ctx.setLineWidth(selected ? 5.8 : selectedItem ? 1.6 : 2.3)
    ctx.moveTo(origin.x + item.points[0][0], origin.y + item.points[0][1])
    item.points.slice(1).forEach(([x, y]) => ctx.lineTo(origin.x + x, origin.y + y))
    ctx.stroke()
  })
  const selectedColor = selectedItem ? connectionColor(selectedItem.connection, theme) : undefined
  drawSolderEndpoint(ctx, metrics.output, theme, origin, false,
    selectedItem ? selectedItem.connection.fromPin : undefined, selectedColor)
  drawSolderEndpoint(ctx, metrics.input, theme, origin, false,
    selectedItem ? selectedItem.connection.toPin : undefined, selectedColor)
  return metrics
}


function drawWiringDiagram(ctx, model, width, height, options = {}) {
  const origin = optionsWithOrigin(options)
  const theme = themeFor(options.theme)
  if (options.layout === 'solder-wiring') {
    ctx.setFillStyle(theme.background)
    ctx.fillRect(origin.x, origin.y, width, height)
    const metrics = layoutFor(width, model, options)
    if (!model || !model.supported) {
      drawHeader(ctx, model, width, theme, origin, { ...options, viewMode: 'connectors', face: 'solder' })
      return drawUnsupported(ctx, model, width, height, theme, origin, options)
    }
    if (metrics.routingError) throw new Error(metrics.routingError)
    return drawSolderWiring(ctx, model, width, theme, origin, metrics, options)
  }
  const mode = options.viewMode === 'connectors' ? 'connectors' : 'wiring'
  ctx.setFillStyle(theme.background)
  ctx.fillRect(origin.x, origin.y, width, height)
  const metrics = layoutFor(width, model, { ...options, viewMode: mode })
  drawHeader(ctx, model, width, theme, origin, { ...options, viewMode: mode })
  if (!model || !model.supported) return drawUnsupported(ctx, model, width, height, theme, origin, options)
  if (mode === 'connectors') {
    drawConnectorPanels(ctx, model, width, theme, origin, metrics, options)
    drawConnectorMap(ctx, model, width, theme, origin, metrics, options)
  } else {
    drawFunctional(ctx, model, width, height, theme, origin, options)
  }
  return metrics
}

function getDiagramHeight(width, model, options = {}) {
  return layoutFor(width, model, options).height
}

function getWiringHitAreas(model, width, height, options = {}) {
  if (!model || !model.supported) return []
  const metrics = layoutFor(width, model, options)
  const origin = optionsWithOrigin(options)
  if (metrics.mode === 'solder-wiring') {
    if (metrics.routingError) return []
    return metrics.connectionAnchors.map((item) => {
      const pathPoints = item.points.map(([x, y]) => [origin.x + x, origin.y + y])
      const xs = pathPoints.map(([x]) => x), ys = pathPoints.map(([, y]) => y)
      const radius = 22
      const left = Math.max(origin.x, Math.min(...xs) - radius)
      const top = Math.max(origin.y, Math.min(...ys) - radius)
      const right = Math.min(origin.x + width, Math.max(...xs) + radius)
      const bottom = Math.min(origin.y + height, Math.max(...ys) + radius)
      return {
        id: item.id, pathPoints, points: pathPoints, radius,
        left, top, width: Math.max(0, right - left), height: Math.max(44, bottom - top),
      }
    })
  }
  if (metrics.mode === 'connectors') {
    const rows = connectorRows(width, model, metrics)
    return rows.filter((row) => row.connection).map((row) => ({
      id: row.connection.id,
      x: origin.x + (width / 2),
      y: origin.y + row.y - 13 + (row.height / 2),
      radius: Math.max(14, row.height / 2),
      left: origin.x + metrics.padding,
      top: origin.y + row.y - 13,
      width: width - (metrics.padding * 2),
      height: row.height,
    }))
  }
  const corridor = functionalHitCorridor(model, metrics)
  return model.connections.map((connection, index) => {
    const rowY = origin.y + metrics.rowsTop + (index * metrics.rowStep)
    const hitHeight = Math.max(44, metrics.rowStep)
    return {
      id: connection.id,
      x: origin.x + corridor.left + (corridor.width / 2),
      y: rowY,
      radius: Math.max(15, hitHeight / 2),
      left: origin.x + corridor.left,
      top: rowY - (hitHeight / 2),
      width: corridor.width,
      height: hitHeight,
    }
  })
}

function reportScale(options = {}) {
  return Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 2
}

function reportLines(value, width, size) {
  return textLines(value, Math.max(1, Math.floor(width / size)))
}

function buildReportLayout(width, model, options = {}) {
  const scale = reportScale(options)
  const logicalWidth = width / scale
  const inset = 12
  const contentWidth = Math.max(120, logicalWidth - (inset * 2))
  const viewMode = options.viewMode === 'connectors' ? 'connectors' : 'wiring'
  const face = options.face === 'solder' ? 'solder' : 'mating'
  const selectedId = typeof options.selectedId === 'string' ? options.selectedId : ''
  const diagramOptions = { viewMode, face, selectedId, showTitle: false }
  const entries = []
  let y = 17
  const add = (value, size, color, weight = 400, x = inset, availableWidth = contentWidth, gap = 0) => {
    const lines = reportLines(value, availableWidth, size)
    entries.push({ type: 'text', lines, x, y, size, color, weight, lineHeight: size + 4 })
    y += lines.length * (size + 4) + gap
  }

  if (options.compact === true) {
    const diagramOptions = {
      layout: 'solder-wiring', compact: true, selectedId, showTitle: false,
    }
    add('接线参考 · 焊接端示意', 16, 'text', 600, inset, contentWidth, 3)
    if (typeof options.preferenceNotice === 'string' && options.preferenceNotice) {
      add(options.preferenceNotice, 11, 'secondary', 500, inset, contentWidth, 2)
    }
    const reportEndpointLabel = (endpoint, side) => endpoint?.id === 'stereo35'
      ? `3.5 mm 立体声${side}` : endpoint?.label || '未识别'
    add(`输出端：${reportEndpointLabel(model?.output, '输出')}`, 12, 'text', 500, inset, contentWidth, 1)
    add(`输入端：${reportEndpointLabel(model?.input, '输入')}`, 12, 'text', 500, inset, contentWidth, 2)
    if (model && model.status && model.status !== 'ready') {
      add(model.status === 'needs-choice' ? '需要确认接线条件' : '当前组合不支持', 12,
        model.status === 'needs-choice' ? 'secondary' : 'error', 600, inset, contentWidth, 2)
    }
    const diagramHeight = getDiagramHeight(contentWidth, model, diagramOptions)
    entries.push({ type: 'diagram', x: inset, y, width: contentWidth, height: diagramHeight, options: diagramOptions })
    y += diagramHeight + 8
    if (!model || !model.supported) {
      add(model?.reason || '未生成连接对应关系。', 12, 'error', 500, inset, contentWidth, 2)
    } else {
      add('接线对照', 12, 'text', 600, inset, contentWidth, 1)
      model.connections.forEach((connection) => add(`${connection.fromLabel} → ${connection.toLabel}`,
        12, 'secondary', 500, inset + 4, contentWidth - 8, 1))
    }
    const wiringGuide = getWiringGuide(model)
    if (wiringGuide) add(wiringGuide, 11, 'text', 500, inset, contentWidth, 2)
    getCompactWiringConditions(model).forEach((condition) => add(condition,
      10, 'secondary', 500, inset, contentWidth, 1))
    y += 4
    const footer = ['端口、针位以设备丝印和手册为准。']
    entries.push({ type: 'footer', lines: footer, x: inset, y, size: 12, lineHeight: 16 })
    y += footer.length * 16 + 12
    return { scale, logicalWidth, logicalHeight: y, height: Math.ceil(y * scale), entries }
  }

  add('接线助手 · 接线方案', 16, 'text', 600, inset, contentWidth, 4)
  add(model && model.title || '接线方式不可识别', 14, 'secondary', 500, inset, contentWidth, 2)
  if (typeof options.preferenceNotice === 'string' && options.preferenceNotice) {
    add(options.preferenceNotice, 11, 'secondary', 500, inset, contentWidth, 2)
  }
  add(`当前视角：${viewMode === 'connectors' ? `接头视角 · ${face === 'solder' ? '焊接面' : '插接面'}` : '连线图'}`,
    12, 'secondary', 500, inset, contentWidth, 2)
  if (model && model.status && model.status !== 'ready') {
    add(model.status === 'needs-choice' ? '需要选择接线条件' : '当前组合不支持', 12,
      model.status === 'needs-choice' ? 'secondary' : 'error', 600, inset, contentWidth, 3)
  }
  if (model && !model.supported && model.status === 'needs-choice') {
    add('条件尚未完成，不生成施工接线图。', 12, 'error', 500, inset, contentWidth, 3)
  }
  ;((model && model.supported && model.selectionSummary) || []).forEach((summary) => add(`已选：${summary}`,
    12, 'text', 500, inset, contentWidth, 1))
  if (model && model.supported) add(`建议线材：${model.cableSummary}`, 12, 'secondary', 400, inset, contentWidth, 4)

  const diagramHeight = getDiagramHeight(contentWidth, model, diagramOptions)
  entries.push({ type: 'diagram', x: inset, y, width: contentWidth, height: diagramHeight, options: diagramOptions })
  y += diagramHeight + 9

  if (model && model.supported) {
    add('对应关系', 13, 'text', 600, inset, contentWidth, 2)
    model.connections.forEach((connection) => add(`${connection.fromLabel} → ${connection.toLabel}`,
      12, connectionColor(connection, themeFor(options.theme)), 500, inset + 4, contentWidth - 8, 1))
    ;((model.unconnectedPins) || []).forEach((pin) => add(
      `悬空不接：${pin.side === 'output' ? '输出' : '输入'} ${pin.label || pin.pin}（${pin.reason || '未连接'}）`,
      12, 'secondary', 500, inset + 4, contentWidth - 8, 1))
  } else {
    add('未生成连接对应关系。', 12, 'error', 500, inset, contentWidth, 2)
  }

  ;((model && model.criticalNotes) || []).forEach((note) => add(`注意：${note}`,
    12, 'error', 500, inset + 4, contentWidth - 8, 1))

  add('适用说明', 13, 'text', 600, inset, contentWidth, 2)
  ;((model && model.notes) || []).forEach((note) => add(`• ${note}`, 12, 'secondary', 400, inset + 4, contentWidth - 8, 1))
  if (model && model.reason) add(`未支持原因：${model.reason}`, 12, 'error', 500, inset + 4, contentWidth - 8, 1)

  add('参考与适用边界', 13, 'text', 600, inset, contentWidth, 2)
  ;((model && model.sources) || []).forEach((source) => add(source.title, 12, 'secondary', 500, inset + 4, contentWidth - 8, 1))

  y += 4
  const footer = ['颜色仅作功能标识，不代表实际线色；', '按设备丝印与说明书核对接法。']
  entries.push({ type: 'footer', lines: footer, x: inset, y, size: 12, lineHeight: 16 })
  y += footer.length * 16 + 12
  return { scale, logicalWidth, logicalHeight: y, height: Math.ceil(y * scale), entries }
}

function getReportHeight(width, model, options = {}) {
  return buildReportLayout(width, model, options).height
}

function drawWiringReport(ctx, model, width, height, options = {}) {
  const theme = themeFor(options.theme)
  const layout = buildReportLayout(width, model, options)
  ctx.save()
  ctx.scale(layout.scale, layout.scale)
  ctx.setFillStyle(theme.background)
  ctx.fillRect(0, 0, layout.logicalWidth, height / layout.scale)
  layout.entries.forEach((entry) => {
    if (entry.type === 'diagram') {
      drawWiringDiagram(ctx, model, entry.width, entry.height, {
        ...entry.options, theme: options.theme, photos: options.photos, x: entry.x, y: entry.y,
      })
      return
    }
    if (entry.type === 'footer') {
      entry.lines.forEach((lineText, index) => text(ctx, lineText, entry.x, entry.y + (index * entry.lineHeight),
        entry.size, theme.tertiary, 400, 'left'))
      return
    }
    const color = theme[entry.color] || entry.color
    entry.lines.forEach((lineText, index) => text(ctx, lineText, entry.x, entry.y + (index * entry.lineHeight),
      entry.size, color, entry.weight, 'left'))
  })
  ctx.restore()
  return { height, contentHeight: layout.logicalHeight * layout.scale }
}

module.exports = {
  drawWiringDiagram,
  getDiagramHeight,
  getWiringHitAreas,
  drawWiringReport,
  getReportHeight,
  registerOnLoadSolderGeometryCacheModel,
  createCanonicalSolderRouteTableEntry,
}

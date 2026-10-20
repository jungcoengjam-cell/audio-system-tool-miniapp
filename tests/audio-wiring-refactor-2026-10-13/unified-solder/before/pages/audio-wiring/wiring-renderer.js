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
  const modeText = options.viewMode === 'connectors'
    ? `${options.face === 'solder' ? '焊接面' : '插接面'} · 线缆头示意`
    : '功能连线 · 抽象端子示意（非实体插座）'
  text(ctx, modeText, cx, origin.y + 47 - headerOffset, 12, theme.secondary, 400, 'center')
  if (options.viewMode !== 'connectors') {
    text(ctx, '实心点汇接；交叉无点不连接', cx, origin.y + 62 - headerOffset, 10, theme.tertiary, 400, 'center')
  }
}

function endpointHeading(ctx, endpoint, side, x, y, width, theme, origin) {
  const cx = origin.x + x + (width / 2)
  const direction = side === 'output' ? '输出端' : '输入端'
  const connector = endpoint.id === 'xlrBalanced' ? 'XLR'
    : endpoint.id === 'trsBalanced' ? '6.35 TRS'
      : endpoint.id === 'terminalBalanced' ? '平衡端子'
        : endpoint.id === 'stereo35' ? '3.5 TRS'
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
  if (endpoint.id === 'stereo35') return pinNumber === 'T' ? theme.left : pinNumber === 'R' ? theme.right : theme.shield
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
    const content = endpoint.id === 'stereo35'
      ? ['T → L', 'R → R', 'S → L/R 共用回路']
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
    const hasRing = endpoint.id === 'trsBalanced' || endpoint.id === 'stereo35'
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
  if (endpoint.id === 'stereo35') return '3.5 TRS'
  if (endpoint.id === 'trsBalanced') return '6.35 TRS'
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
    } else if (['trsBalanced', 'stereo35', 'tsMono', 'tsStereo'].includes(endpoint.id)) {
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

function drawWiringDiagram(ctx, model, width, height, options = {}) {
  const origin = optionsWithOrigin(options)
  const theme = themeFor(options.theme)
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
        ...entry.options, theme: options.theme, x: entry.x, y: entry.y,
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
}

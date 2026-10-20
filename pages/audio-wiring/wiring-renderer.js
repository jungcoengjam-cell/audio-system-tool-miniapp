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

const { getSolderPhotoSpec } = require('./wiring-photos')
const { getWiringGuide, getCompactWiringConditions } = require('./wiring-display')

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
  const scale = Math.min(box.size / crop.width, box.size / crop.height)
  const width = crop.width * scale, height = crop.height * scale
  return { x: box.x + ((box.size - width) / 2), y: box.y + ((box.size - height) / 2), width, height, crop, scale }
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

function makeSolderEndpoint(model, side, width, theme, options) {
  const endpoint = model && model[side]
  const pins = solderPinRecords(model, side)
  const isOutput = side === 'output'
  const contentWidth = Math.max(120, width - (options.avoidRail ? 56 : 0))
  const padding = 5
  const gap = 12
  const columnWidth = (contentWidth - (padding * 2) - gap) / 2
  const x = isOutput ? padding : padding + columnWidth + gap
  const centerX = x + (columnWidth / 2)
  const photoSize = Number.isFinite(options.photoSize)
    ? options.photoSize : Math.max(1, Math.min(128, columnWidth - 2))
  const photoX = centerX - (photoSize / 2)
  const photoY = Number.isFinite(options.photoCenterY)
    ? options.photoCenterY - (photoSize / 2) : 38 + (photoSize / 2) + 6 - (photoSize / 2)
  const anchors = new Map()
  const photoSpec = getSolderPhotoSpec(endpoint)
  const photo = photoSpec && options.photos && options.photos[photoSpec.key]
  const isPhotoEndpoint = Boolean(photoSpec && photoSpec.pinPoints)
  const isDualPhoto = isPhotoEndpoint && (endpoint.channelCount === 2 || ['rcaStereo', 'tsStereo'].includes(endpoint.id))
  const photoBoxes = []
  const basePinKey = (pin) => String(pin).replace(/^[LR]·/, '')
  const channelForPin = (pin) => /^R(?:·|中心|外壳)/.test(String(pin)) ? 'R' : 'L'
  const pinPointKey = (pin) => {
    const basePin = basePinKey(pin)
    if (endpoint && ['rcaMono', 'rcaStereo'].includes(endpoint.id)) {
      return basePin === '中心针' || basePin.endsWith('中心') ? 'core'
        : basePin === '外壳' || basePin.endsWith('外壳') ? 'shell' : ''
    }
    if (endpoint && ['tsMono', 'tsStereo'].includes(endpoint.id)) return basePin.endsWith('T') ? 'T' : 'S'
    return basePin
  }
  if (isPhotoEndpoint) {
    if (isDualPhoto) {
      const size = Number.isFinite(options.dualSize) ? options.dualSize : photoSize
      const top = Number.isFinite(options.dualTop) ? options.dualTop : 48
      ;['L', 'R'].forEach((channel, index) => photoBoxes.push({
        key: channel, x: centerX - (size / 2), y: top + (index * (size + 24)), size, photo,
      }))
    } else {
      photoBoxes.push({ key: '', x: photoX, y: photoY, size: photoSize, photo })
    }
    pins.forEach((pin, pinIndex) => {
      const channel = channelForPin(pin.pin)
      const box = isDualPhoto ? photoBoxes.find((item) => item.key === channel) : photoBoxes[0]
      const point = photoSpec.pinPoints[pinPointKey(pin.pin)]
      if (!point) return
      const destination = photoDestination(box, photoSpec)
      const position = photoPoint(destination, photoSpec, point)
      anchors.set(pin.pin, {
        x: position.x, y: position.y,
        color: roleColor(pin.role, theme), count: pin.count, photo: true, channel,
        routeDirection: routeDirectionFor(photoSpec, side, pinPointKey(pin.pin)),
        routeIndex: isDualPhoto ? pins.slice(0, pinIndex).filter((item) =>
          channelForPin(item.pin) === channel).length : pinIndex,
        photoRect: { x: destination.x, y: destination.y, width: destination.width, height: destination.height },
      })
    })
  } else {
    pins.forEach((pin, index) => {
      if (isDualPhoto) {
        const channel = String(pin.pin).startsWith('R') ? 'R' : 'L'
        const box = photoBoxes.find((item) => item.key === channel)
        const labelPoint = photoSpec.pinPoints[pinPointKey(pin.pin)]
        if (!labelPoint || !box) return
        const crop = photoSpec.contentRect
        const scale = Math.min(box.size / crop.width, box.size / crop.height)
        const destWidth = crop.width * scale, destHeight = crop.height * scale
        const destX = box.x + ((box.size - destWidth) / 2), destY = box.y + ((box.size - destHeight) / 2)
        anchors.set(pin.pin, { x: destX + ((((labelPoint.x * photoSpec.width) - crop.x) / crop.width) * destWidth),
          y: destY + ((((labelPoint.y * photoSpec.height) - crop.y) / crop.height) * destHeight),
          color: roleColor(pin.role, theme), count: pin.count, label: pin.label, channel,
          routeDirection: routeDirectionFor(photoSpec, side, pinPointKey(pin.pin)) })
        return
      }
      const rowGap = pins.length > 2 ? 23 : 29
      const y = 81 + ((index - ((pins.length - 1) / 2)) * rowGap)
      const label = pin.label || pin.pin
      const chipWidth = Math.min(columnWidth - 16, Math.max(38, [...String(label)].length * 8 + 16))
      const chipLeft = isOutput ? x + columnWidth - chipWidth - 5 : x + 5
      anchors.set(pin.pin, { x: isOutput ? chipLeft + chipWidth : chipLeft, y,
        color: roleColor(pin.role, theme), count: pin.count, label, chipWidth, chipCenter: chipLeft + (chipWidth / 2),
        routeDirection: routeDirectionFor(photoSpec, side, pinPointKey(pin.pin)) })
    })
  }
  photoBoxes.forEach((box) => {
    if (photoSpec) box.destination = photoDestination(box, photoSpec)
  })
  return { endpoint, pins, side, x, centerX, columnWidth, photoSpec, photo, isPhotoEndpoint,
    photoBoxes, photoX, photoY, photoSize, anchors, theme }
}

function distanceToPointSegment(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y
  const length = (dx * dx) + (dy * dy)
  const t = length ? Math.max(0, Math.min(1, (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / length)) : 0
  return Math.hypot(point.x - start.x - (t * dx), point.y - start.y - (t * dy))
}

const ROUTE_HANDLE_LENGTHS = [12, 18, 26, 36, 48, 64, 84]
const ROUTE_SAMPLE_STEPS = 96
const ROUTE_PARALLEL_CLEARANCE = 4
const ROUTE_PARALLEL_MIN_RUN = 6
const solderGeometryCache = new WeakMap()

function rotateDirection(direction, degrees) {
  const angle = Math.atan2(direction.y, direction.x) + ((degrees * Math.PI) / 180)
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

function endpointDirection(anchor, side, branchOffset = 0) {
  const direction = anchor.routeDirection || { x: side === 'output' ? 1 : -1, y: 0 }
  return rotateDirection(direction, branchOffset)
}

function branchOffsets(connections, keyFor, halfSpread) {
  const groups = new Map()
  connections.forEach((connection, index) => {
    const key = keyFor(connection)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(index)
  })
  const offsets = new Map()
  groups.forEach((indexes) => indexes.forEach((index, rank) => {
    const spread = indexes.length > 1 ? (rank / (indexes.length - 1) * 2 - 1) * halfSpread : 0
    offsets.set(index, spread)
  }))
  return offsets
}

function cubicPoint(from, control1, control2, to, t) {
  const inverse = 1 - t
  return [
    (inverse ** 3 * from.x) + (3 * inverse ** 2 * t * control1[0]) +
      (3 * inverse * t ** 2 * control2[0]) + (t ** 3 * to.x),
    (inverse ** 3 * from.y) + (3 * inverse ** 2 * t * control1[1]) +
      (3 * inverse * t ** 2 * control2[1]) + (t ** 3 * to.y),
  ]
}

function cubicDerivative(curve, t) {
  const inverse = 1 - t
  const { from, control1, control2, to } = curve
  return [
    (3 * inverse * inverse * (control1[0] - from.x)) +
      (6 * inverse * t * (control2[0] - control1[0])) +
      (3 * t * t * (to.x - control2[0])),
    (3 * inverse * inverse * (control1[1] - from.y)) +
      (6 * inverse * t * (control2[1] - control1[1])) +
      (3 * t * t * (to.y - control2[1])),
  ]
}

function cubicCandidate(from, to, outDirection, inDirection, outLength, inLength) {
  const control1 = [from.x + (outDirection.x * outLength), from.y + (outDirection.y * outLength)]
  const control2 = [to.x + (inDirection.x * inLength), to.y + (inDirection.y * inLength)]
  const points = []
  let length = 0, leftBacktrack = 0
  for (let step = 0; step <= ROUTE_SAMPLE_STEPS; step += 1) {
    const point = cubicPoint(from, control1, control2, to, step / ROUTE_SAMPLE_STEPS)
    if (points.length) {
      const previous = points[points.length - 1]
      length += Math.hypot(point[0] - previous[0], point[1] - previous[1])
      if (point[0] < previous[0]) leftBacktrack += previous[0] - point[0]
    }
    points.push(point)
  }
  const cumulativeLengths = [0]
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1], point = points[index]
    cumulativeLengths.push(cumulativeLengths[index - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1]))
  }
  return { from, to, control1, control2, points, cumulativeLengths,
    score: length + (2 * leftBacktrack) + (0.04 * (outLength + inLength)) }
}

function hasNearParallelRun(first, second, contacts) {
  const firstPoints = first.points, secondPoints = second.points
  const firstLengths = first.cumulativeLengths, secondLengths = second.cumulativeLengths
  let run = 0, longest = 0
  for (let index = 0; index < firstPoints.length - 1; index += 1) {
    const a1 = firstPoints[index], a2 = firstPoints[index + 1]
    const segmentLength = firstLengths[index + 1] - firstLengths[index]
    const midpoint = { x: (a1[0] + a2[0]) / 2, y: (a1[1] + a2[1]) / 2 }
    if (contacts.some((contact) => Math.hypot(midpoint.x - contact.x, midpoint.y - contact.y) <= 6)) {
      run = 0
      continue
    }
    const close = secondPoints.slice(1).some((b2, other) => {
      const b1 = secondPoints[other]
      const otherLength = secondLengths[other + 1] - secondLengths[other]
      if (otherLength <= 0.001) return false
      const dot = ((a2[0] - a1[0]) * (b2[0] - b1[0])) + ((a2[1] - a1[1]) * (b2[1] - b1[1]))
      const cosine = Math.abs(dot) / (segmentLength * otherLength)
      return cosine >= 0.965925826 && distanceToPointSegment(midpoint,
        { x: b1[0], y: b1[1] }, { x: b2[0], y: b2[1] }) <= ROUTE_PARALLEL_CLEARANCE
    })
    run = close ? run + segmentLength : 0
    longest = Math.max(longest, run)
    if (longest >= ROUTE_PARALLEL_MIN_RUN) return true
  }
  return false
}

function angleDifferenceDegrees(first, second) {
  const difference = Math.atan2(first.y, first.x) - Math.atan2(second.y, second.x)
  const wrapped = ((difference + (3 * Math.PI)) % (2 * Math.PI)) - Math.PI
  return Math.abs((wrapped * 180) / Math.PI)
}

function keepsSharedInputApproachesSeparate(route, inDirection, chosen) {
  return chosen.every((item) => String(item.connection.toPin) !== String(route.connection.toPin) ||
    String(item.connection.fromPin) === String(route.connection.fromPin) ||
    angleDifferenceDegrees(item.inDirection, inDirection) >= 60 - 1e-6)
}

function selectSolderRoutes(connections, output, input, width, maxHeight) {
  const sourceOffsets = branchOffsets(connections, (connection) => String(connection.fromPin), 15)
  const targetOffsets = branchOffsets(connections, (connection) => String(connection.toPin), 35)
  const contacts = [...output.anchors.values(), ...input.anchors.values()].filter((point) => point.photo)
  const routes = connections.map((connection, index) => {
    const from = output.anchors.get(String(connection.fromPin))
    const to = input.anchors.get(String(connection.toPin))
    if (!from || !to) return { connection, from, to, baseCurves: [], outDirection: null, inDirection: null }
    const outDirection = endpointDirection(from, 'output', sourceOffsets.get(index) || 0)
    const inDirection = endpointDirection(to, 'input', targetOffsets.get(index) || 0)
    return { connection, from, to, outDirection, inDirection,
      baseCurves: routeCandidates(from, to, outDirection, inDirection, output, input, width, maxHeight) }
  })
  const chosen = []
  function tryCurves(route, curves, inDirection, index) {
    for (const curve of curves) {
      if (!keepsSharedInputApproachesSeparate(route, inDirection, chosen)) continue
      if (chosen.some((item) => hasNearParallelRun(item.curve, curve, contacts) ||
        hasNearParallelRun(curve, item.curve, contacts))) continue
      chosen.push({ id: route.connection.id, connection: route.connection,
        from: route.from, to: route.to, inDirection, curve, points: curve.points })
      if (choose(index + 1)) return true
      chosen.pop()
    }
    return false
  }
  function choose(index) {
    if (index >= routes.length) return true
    const route = routes[index]
    if (!route.from || !route.to) return false
    if (tryCurves(route, route.baseCurves, route.inDirection, index)) return true
    const fallbackAngles = [-15, 15, -30, 30, -45, 45]
    for (const angle of fallbackAngles) {
      const outDirection = rotateDirection(route.outDirection, angle)
      const inDirection = rotateDirection(route.inDirection, angle)
      const fallbackCurves = routeCandidates(route.from, route.to, outDirection, inDirection,
        output, input, width, maxHeight)
      if (tryCurves(route, fallbackCurves, inDirection, index)) return true
    }
    return false
  }
  if (choose(0)) return { routes: chosen.slice(), error: '' }
  return { routes: [], error: '没有找到清晰且完整的接线路径，请重新选择接口组合。' }
}

function pointPathDistance(point, points) {
  let distance = Infinity
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToPointSegment(point,
      { x: points[index - 1][0], y: points[index - 1][1] },
      { x: points[index][0], y: points[index][1] }))
  }
  return distance
}

function curveInsideCanvas(curve, width, maxHeight) {
  return curve.points.every(([x, y]) => x >= 2 && x <= width - 2 && y >= 38 && y <= maxHeight)
}

function curveClearsContacts(curve, from, to, output, input) {
  const contacts = [...output.anchors.values(), ...input.anchors.values()]
    .filter((point) => point.photo && point !== from && point !== to)
  return contacts.every((point) => pointPathDistance(point, curve.points) >= 6)
}

function routeCandidates(from, to, outDirection, inDirection, output, input, width, maxHeight) {
  const candidates = []
  ROUTE_HANDLE_LENGTHS.forEach((outLength) => ROUTE_HANDLE_LENGTHS.forEach((inLength) => {
    const curve = cubicCandidate(from, to, outDirection, inDirection, outLength, inLength)
    if (curveInsideCanvas(curve, width, maxHeight) && curveClearsContacts(curve, from, to, output, input)) {
      candidates.push(curve)
    }
  }))
  return candidates.sort((a, b) => a.score - b.score)
}


function segmentIntersectionParameters(first, second, firstIndex, secondIndex) {
  const p = first.points[firstIndex], pNext = first.points[firstIndex + 1]
  const q = second.points[secondIndex], qNext = second.points[secondIndex + 1]
  const rx = pNext[0] - p[0], ry = pNext[1] - p[1]
  const sx = qNext[0] - q[0], sy = qNext[1] - q[1]
  const denominator = (rx * sy) - (ry * sx)
  if (Math.abs(denominator) < 1e-7) return null
  const qpx = q[0] - p[0], qpy = q[1] - p[1]
  const firstT = ((qpx * sy) - (qpy * sx)) / denominator
  const secondT = ((qpx * ry) - (qpy * rx)) / denominator
  if (firstT < -1e-6 || firstT > 1 + 1e-6 || secondT < -1e-6 || secondT > 1 + 1e-6) return null
  const steps = first.points.length - 1
  return {
    firstT: (firstIndex + Math.max(0, Math.min(1, firstT))) / steps,
    secondT: (secondIndex + Math.max(0, Math.min(1, secondT))) / steps,
    point: [p[0] + (firstT * rx), p[1] + (firstT * ry)],
  }
}

function parameterAtDistance(curve, start, distance, direction) {
  const step = 1 / 512
  let t = start, point = cubicPoint(curve.from, curve.control1, curve.control2, curve.to, t)
  let traveled = 0
  while ((direction < 0 ? t > 0 : t < 1) && traveled < distance) {
    const nextT = Math.max(0, Math.min(1, t + (direction * step)))
    const next = cubicPoint(curve.from, curve.control1, curve.control2, curve.to, nextT)
    const segment = Math.hypot(next[0] - point[0], next[1] - point[1])
    if (traveled + segment >= distance && segment > 0) {
      const fraction = (distance - traveled) / segment
      return t + ((nextT - t) * fraction)
    }
    traveled += segment
    t = nextT
    point = next
  }
  return t
}

function cubicSubsegment(curve, start, end) {
  const from = cubicPoint(curve.from, curve.control1, curve.control2, curve.to, start)
  const to = cubicPoint(curve.from, curve.control1, curve.control2, curve.to, end)
  const startDerivative = cubicDerivative(curve, start)
  const endDerivative = cubicDerivative(curve, end)
  const delta = end - start
  return {
    from,
    control1: [from[0] + (startDerivative[0] * delta / 3), from[1] + (startDerivative[1] * delta / 3)],
    control2: [to[0] - (endDerivative[0] * delta / 3), to[1] - (endDerivative[1] * delta / 3)],
    to,
  }
}

function addCrossingGaps(routes) {
  const intervals = routes.map(() => [])
  routes.forEach((first, firstIndex) => {
    routes.slice(firstIndex + 1).forEach((second, offset) => {
      const secondIndex = firstIndex + 1 + offset
      for (let firstStep = 0; firstStep < first.points.length - 1; firstStep += 1) {
        for (let secondStep = 0; secondStep < second.points.length - 1; secondStep += 1) {
          const intersection = segmentIntersectionParameters(first, second, firstStep, secondStep)
          if (!intersection) continue
          const contacts = [first.from, first.to, second.from, second.to]
          if (contacts.some((point) => Math.hypot(point.x - intersection.point[0], point.y - intersection.point[1]) < 6)) continue
          const start = parameterAtDistance(second.curve, intersection.secondT, 1.8, -1)
          const end = parameterAtDistance(second.curve, intersection.secondT, 1.8, 1)
          if (end - start > 1e-6) intervals[secondIndex].push([start, end])
        }
      }
    })
  })
  routes.forEach((route, index) => {
    const sorted = intervals[index].sort((a, b) => a[0] - b[0])
    const merged = []
    sorted.forEach(([start, end]) => {
      const previous = merged[merged.length - 1]
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
      else merged.push([start, end])
    })
    const segments = []
    let cursor = 0
    merged.forEach(([start, end]) => {
      if (start > cursor + 1e-5) segments.push(cubicSubsegment(route.curve, cursor, start))
      cursor = Math.max(cursor, end)
    })
    if (cursor < 1 - 1e-5) segments.push(cubicSubsegment(route.curve, cursor, 1))
    route.drawSegments = segments.length ? segments : [route.curve]
  })
}

function solderWiringLayout(width, model, options = {}) {
  const supported = Boolean(model && model.supported && Array.isArray(model.connections))
  const hasDualPhoto = ['rcaStereo', 'tsStereo'].includes(model && model.output && model.output.id) ||
    ['rcaStereo', 'tsStereo'].includes(model && model.input && model.input.id) ||
    Boolean(model && (model.output && model.output.channelCount === 2 || model.input && model.input.channelCount === 2))
  const contentWidth = Math.max(120, width - (options.avoidRail ? 56 : 0))
  const columnWidth = (contentWidth - (5 * 2) - 12) / 2
  const photoSize = Math.max(1, Math.min(128, columnWidth - 2))
  const dualTop = 48
  const sharedOptions = {
    ...options,
    photoSize,
    dualSize: photoSize,
    dualTop,
    photoCenterY: hasDualPhoto ? dualTop + photoSize + 12 : 38 + (photoSize / 2) + 6,
  }
  const output = makeSolderEndpoint(model, 'output', width, themeFor(options.theme), sharedOptions)
  const input = makeSolderEndpoint(model, 'input', width, themeFor(options.theme), sharedOptions)
  const connections = supported ? model.connections : []
  const photoBottom = [...output.photoBoxes, ...input.photoBoxes].reduce((bottom, box) => {
    const destination = box.destination || { y: box.y, height: box.size }
    return Math.max(bottom, destination.y + destination.height)
  }, 0)
  const cacheable = model && (typeof model === 'object' || typeof model === 'function')
  let routeCache = cacheable ? solderGeometryCache.get(model) : null
  if (!routeCache) {
    routeCache = new Map()
    if (cacheable) solderGeometryCache.set(model, routeCache)
  }
  const routeKey = `${width}:${options.avoidRail ? 1 : 0}`
  let cachedGeometry = routeCache.get(routeKey)
  if (!cachedGeometry) {
    const routeSelection = selectSolderRoutes(connections, output, input, contentWidth, photoBottom + 100)
    cachedGeometry = { curves: routeSelection.routes.map((route) => route.curve), error: routeSelection.error }
    if (cacheable) routeCache.set(routeKey, cachedGeometry)
  }
  const routingError = cachedGeometry.error
  const connectionAnchors = routingError ? [] : connections.map((connection, index) => {
    const from = output.anchors.get(String(connection.fromPin))
    const to = input.anchors.get(String(connection.toPin))
    const curve = cachedGeometry.curves[index]
    return { id: connection.id, connection, from, to, curve, points: curve.points }
  })
  addCrossingGaps(connectionAnchors)
  const routeBottom = connectionAnchors.reduce((bottom, item) =>
    Math.max(bottom, ...item.points.map((point) => point[1])), photoBottom)
  const endpointDecorationBottom = [output, input].reduce((bottom, endpointLayout) => {
    if (!endpointLayout.photoSpec || endpointLayout.photoSpec.kind !== 'terminal') return bottom
    return (endpointLayout.photoBoxes || []).reduce((endpointBottom, box) => {
      const destination = box.destination || photoDestination(box, endpointLayout.photoSpec)
      return Math.max(endpointBottom, destination.y + destination.height + 15)
    }, bottom)
  }, 0)
  const reasonLines = !supported && model
    ? textLines(model.reason || '没有可用的接线方案。', Math.max(1, Math.floor((width - 20) / 12)), 8).length : 0
  const height = Math.ceil(Math.max(routeBottom, endpointDecorationBottom)
    + (reasonLines ? 24 + reasonLines * 17 : 0) + 12)
  return { mode: 'solder-wiring', height, output, input, connectionAnchors, supported, routingError }
}

function drawSolderEndpoint(ctx, layout, theme, origin, paintBase = true, selectedPin, selectedColor) {
  const { endpoint, pins, side, centerX, photoSpec, photo, photoX, photoY, photoSize, anchors } = layout
  if (!endpoint) return
  const basePinKey = (pin) => String(pin).replace(/^[LR]·/, '')
  const channelForPin = (pin) => /^R(?:·|中心|外壳)/.test(String(pin)) ? 'R' : 'L'
  if (paintBase) {
    text(ctx, side === 'output' ? '输出端' : '输入端', origin.x + centerX, origin.y + 14, 11, theme.secondary, 600, 'center')
    const endpointTitle = endpoint.id === 'xlrBalanced'
      ? `XLR ${endpoint.cableConnectorGender || '接头'}${endpoint.channelCount === 2 ? ' ×2' : ''}`
      : endpoint.id === 'tsMono' ? `6.35 TS·单声道${endpoint.channelCount === 2 ? ' ×2' : ''}`
      : endpoint.id === 'trsBalanced' ? `6.35 大三芯·平衡${endpoint.channelCount === 2 ? ' ×2' : ''}`
          : endpoint.id === 'stereo635' ? `6.35 大三芯·立体声${endpoint.channelCount === 2 ? ' ×2' : ''}`
            : endpoint.id === 'stereo35' ? '3.5 立体声'
              : endpoint.connectorType || endpoint.label || '接口'
    text(ctx, endpointTitle, origin.x + centerX, origin.y + 29, 10, theme.text, 600, 'center')
    if (photo && photoSpec) {
      ;(layout.photoBoxes || []).forEach((box) => {
        const destination = box.destination || photoDestination(box, photoSpec)
        const image = box.photo || photo
        const { crop, scale } = destination
        ctx.save()
        ctx.beginPath()
        ctx.rect(origin.x + destination.x, origin.y + destination.y, destination.width, destination.height)
        ctx.clip()
        ctx.drawImage(image,
          origin.x + destination.x - (crop.x * scale),
          origin.y + destination.y - (crop.y * scale),
          photoSpec.width * scale,
          photoSpec.height * scale)
        ctx.restore()
        if (box.key) text(ctx, box.key, origin.x + centerX, origin.y + (endpoint.channelCount === 2 ? box.y - 4 : box.y + 11),
          9, theme.secondary, 600, 'center')
      })
      if (photoSpec.kind === 'terminal') {
        const box = layout.photoBoxes[layout.photoBoxes.length - 1]
        const destination = box && box.destination
        const captionY = destination ? destination.y + destination.height + 12 : 158
        text(ctx, '示意顺序，按设备丝印', origin.x + centerX, origin.y + captionY, 8, theme.tertiary, 500, 'center')
      }
    } else {
      const caption = endpoint.id === 'rcaStereo' || endpoint.id === 'tsStereo'
        ? 'L / R 功能触点示意' : endpoint.id === 'trsBalanced' || endpoint.id === 'stereo35'
          ? 'T / R / S · 位置依型号' : endpoint.id === 'tsMono'
            ? 'T / S · 位置依型号' : '接线端功能示意 · 位置依型号'
      roundedRect(ctx, origin.x + layout.x + 4, origin.y + 40, layout.columnWidth - 8, 104, 9, theme.card, theme.border)
      text(ctx, caption, origin.x + centerX, origin.y + 54, 8, theme.tertiary, 400, 'center')
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
      text(ctx, label, chipCenter, py + 3, 8, color, 600, 'center')
      if (!pin.count) text(ctx, '悬空', chipCenter, py + 17, 7, theme.tertiary, 400, 'center')
      return
    }
    circle(ctx, px, py, pin.count ? 3.1 : 2.5, pin.count ? color : theme.background, color, 1.2)
    if (photoSpec && photoSpec.kind === 'terminal') {
      const box = layout.photoBoxes.find((item) => item.key === channelForPin(pin.pin)) || layout.photoBoxes[0]
      const basePin = basePinKey(pin.pin)
      const label = photoSpec.labelPoints && photoSpec.labelPoints[basePin]
      if (box && label) {
        const labelPosition = photoPoint(box.destination || photoDestination(box, photoSpec), photoSpec, label)
        const labelX = origin.x + labelPosition.x
        const labelY = origin.y + labelPosition.y
        roundedRect(ctx, labelX - 7, labelY - 7, 14, 14, 2, '#ffffff', null)
        text(ctx, basePin, labelX, labelY + 3, 9, '#1d2329', 700, 'center')
      }
      return
    }
    const isRca = ['rcaMono', 'rcaStereo'].includes(layout.endpoint.id)
    const basePin = basePinKey(pin.pin)
    const basePinLabel = layout.endpoint.id === 'trsBalanced'
      ? ({ T: '+', R: '−', S: 'G' }[basePin] || basePin)
      : layout.endpoint.id === 'stereo635'
        ? ({ T: 'L', R: 'R', S: 'G' }[basePin] || basePin)
      : isRca
      ? (basePin.includes('中心') ? '中心' : '壳') : basePin
    const pinLabel = pin.count ? basePinLabel : `${basePinLabel} · 未接`
    if (layout.endpoint.id === 'stereo35' && pin.pin === 'T' && !pin.count) {
      roundedRect(ctx, px + 4, py - 7, 11, 11, 3, theme.background, null)
      text(ctx, 'T', px + 9, py + 1, 7, theme.text, 600, 'center')
      roundedRect(ctx, px - 11, py + 6, 22, 10, 3, theme.background, null)
      text(ctx, '未接', px, py + 14, 6, theme.tertiary, 600, 'center')
      return
    }
    if (isRca) {
      const labelY = basePinLabel === '中心' ? py - 13 : py + 17
      const labelWidth = Math.max(20, [...pinLabel].length * 4 + 4)
      roundedRect(ctx, px - (labelWidth / 2), labelY - 8, labelWidth, 10, 3, theme.background, null)
      text(ctx, pinLabel, px, labelY, 6, theme.text, 600, 'center')
    } else {
      const labelWidth = Math.max(12, [...pinLabel].length * (pin.count ? 6 : 4.5) + 4)
      const labelX = px + (side === 'output' ? -8 : 8)
      const labelAlign = side === 'output' ? 'right' : 'left'
      roundedRect(ctx, labelX - (side === 'output' ? labelWidth : 0), py - 15, labelWidth, 10, 3, theme.background, null)
      text(ctx, pinLabel, labelX, py - 7, pin.count ? 7 : 6, pin.count ? theme.text : theme.tertiary, 600, labelAlign)
    }
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
    ctx.setStrokeStyle(selectedItem && !selected ? theme.border : connectionColor(item.connection, theme))
    ctx.setLineWidth(selected ? 5.8 : selectedItem ? 1.6 : 2.3)
    ;(item.drawSegments || [item.curve]).forEach((segment) => {
      ctx.moveTo(origin.x + segment.from[0], origin.y + segment.from[1])
      ctx.bezierCurveTo(origin.x + segment.control1[0], origin.y + segment.control1[1],
        origin.x + segment.control2[0], origin.y + segment.control2[1],
        origin.x + segment.to[0], origin.y + segment.to[1])
    })
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
      const left = Math.max(origin.x, Math.min(...xs) - 13)
      const top = Math.max(origin.y, Math.min(...ys) - 13)
      const right = Math.min(origin.x + width, Math.max(...xs) + 13)
      const bottom = Math.min(origin.y + height, Math.max(...ys) + 13)
      return {
        id: item.id, pathPoints, radius: 13,
        left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top),
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
}

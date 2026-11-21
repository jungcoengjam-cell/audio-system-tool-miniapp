const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { OUTPUT_OPTIONS, INPUT_OPTIONS, getWiringModel } = require('../pages/audio-wiring/wiring-model')
const {
  drawWiringDiagram, getDiagramHeight, getWiringHitAreas,
  drawWiringReport, getReportHeight,
} = require('../pages/audio-wiring/wiring-renderer')
const { getModelPhotoSpecs, getSolderPhotoSpec, getConnectorOverviewPhotoSpec } = require('../pages/audio-wiring/wiring-photos')
const { getWiringGuide, getCompactWiringConditions } = require('../pages/audio-wiring/wiring-display')

function recorder() {
  const calls = []
  let fillStyle = ''
  const ctx = {}
  ;['setFontSize', 'setTextAlign', 'setTextBaseline', 'setStrokeStyle', 'setLineWidth',
    'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke',
    'fillRect', 'save', 'restore', 'rect', 'clip', 'scale', 'translate', 'rotate', 'setLineCap'].forEach((method) => {
    ctx[method] = (...args) => calls.push([method, ...args])
  })
  ctx.drawImage = (...args) => calls.push(['drawImage', ...args])
  ctx.setFillStyle = (value) => { fillStyle = value; calls.push(['setFillStyle', value]) }
  ctx.arc = (...args) => calls.push(['arc', ...args, fillStyle])
  ctx.fillText = (...args) => calls.push(['fillText', ...args, fillStyle])
  Object.defineProperty(ctx, 'font', { set: (value) => calls.push(['font', value]) })
  return { ctx, calls }
}

function assertBounds(calls, width, height, originX = 0, originY = 0) {
  calls.forEach((call) => {
    if (call[0] === 'moveTo' || call[0] === 'lineTo') {
      assert.ok(call[1] >= originX - 0.5 && call[1] <= originX + width + 0.5, `x in bounds: ${call}`)
      assert.ok(call[2] >= originY - 0.5 && call[2] <= originY + height + 0.5, `y in bounds: ${call}`)
    }
    if (call[0] === 'fillText') {
      assert.ok(call[2] >= originX && call[2] <= originX + width, `text x in bounds: ${call}`)
      assert.ok(call[3] >= originY && call[3] <= originY + height, `text y in bounds: ${call}`)
    }
    if (call[0] === 'arc') {
      assert.ok(call[1] - call[3] >= originX && call[1] + call[3] <= originX + width, `circle x in bounds: ${call}`)
      assert.ok(call[2] - call[3] >= originY && call[2] + call[3] <= originY + height, `circle y in bounds: ${call}`)
    }
  })
  openStrokePaths(calls).forEach((points) => points.forEach(([x, y]) => {
    assert.ok(x >= originX - 0.5 && x <= originX + width + 0.5, `curve x in bounds: ${x},${y}`)
    assert.ok(y >= originY - 0.5 && y <= originY + height + 0.5, `curve y in bounds: ${x},${y}`)
  }))
}

function render(model, width, options = {}) {
  const height = getDiagramHeight(width, model, options)
  const canvas = recorder()
  const metrics = drawWiringDiagram(canvas.ctx, model, width, height, options)
  assertBounds(canvas.calls, width, height)
  return { ...canvas, height, metrics }
}

function strokeCallGroups(calls) {
  const groups = []
  let current = null
  calls.forEach((call) => {
    if (call[0] === 'beginPath') current = []
    if (current) current.push(call)
    if (call[0] === 'stroke' && current) {
      groups.push(current)
      current = null
    }
  })
  return groups
}

function photosFor(model) {
  return Object.fromEntries(getModelPhotoSpecs(model).map((spec) => [spec.key, {}]))
}

function legacyOpenStereoFixture(inputId = 'xlrBalanced') {
  const current = getWiringModel('stereo35', inputId)
  const sourceFor = (id, pin, toLabel, toRole) => {
    const wire = current.connections.find((item) => item.id === id)
    return { ...wire, id, toPin: pin, toLabel, toRole }
  }
  const balanced = ['xlrBalanced', 'trsBalanced', 'terminalBalanced'].includes(inputId)
  const wires = balanced
    ? [
      sourceFor('left-signal', inputId === 'xlrBalanced' ? '2' : inputId === 'trsBalanced' ? 'T' : '+', '输入信号端（+）', 'positive'),
      sourceFor('left-cold', inputId === 'xlrBalanced' ? '3' : inputId === 'trsBalanced' ? 'R' : '−', '输入冷端（−）', 'negative'),
      sourceFor('left-shield', inputId === 'xlrBalanced' ? '1' : inputId === 'trsBalanced' ? 'S' : 'G', '输入屏蔽端（G）', 'shield'),
    ]
    : [
      sourceFor('left-signal', inputId === 'rcaMono' ? '中心针' : 'T', '输入信号触点', 'signal'),
      sourceFor('left-return', inputId === 'rcaMono' ? '外壳' : 'S', '输入回路触点', 'return'),
    ]
  const option = INPUT_OPTIONS.find((item) => item.id === inputId)
  const input = { ...option, ...(inputId === 'xlrBalanced' ? { cableConnectorGender: '公头' } : {}) }
  return {
    ...current,
    input,
    connections: wires,
    selectionSummary: ['旧版单声道通道 fixture'],
    criticalNotes: [],
    unconnectedPins: [{ side: 'output', pin: 'R', label: 'R 环（右声道 R）',
      reason: '未选择的右声道 R 输出保持未接并与左声道隔离；施工前按设备说明书核对输出用途。' }],
  }
}

function allReadyModels() {
  const models = []
  OUTPUT_OPTIONS.forEach((output) => INPUT_OPTIONS.forEach((input) => {
    const model = getWiringModel(output.id, input.id)
    if (model.supported) models.push(model)
  }))
  return models
}

function assertPointObjectMatches(actual, expected, message) {
  assert(actual && Number.isFinite(actual.x) && Number.isFinite(actual.y), `${message}: point is finite`)
  assert.deepStrictEqual([actual.x, actual.y], [expected.x, expected.y], message)
}

function assertPhotoPinLabelClearance(metrics, label) {
  ;['output', 'input'].forEach((side) => {
    const endpoint = metrics[side]
    if (!endpoint.photoSpec) return
    const photoAnchors = [...endpoint.anchors.values()].filter((point) => point.photo)
    photoAnchors.forEach((point) => {
      const rect = point.labelRect
      assert(rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)
        && Number.isFinite(rect.width) && Number.isFinite(rect.height),
      `${label} ${side} photo pin ${point.pin} has a label rectangle`)
      photoAnchors.forEach((other) => {
        const nearestX = Math.max(rect.x, Math.min(other.x, rect.x + rect.width))
        const nearestY = Math.max(rect.y, Math.min(other.y, rect.y + rect.height))
        assert(Math.hypot(other.x - nearestX, other.y - nearestY) >= 6 - 1e-6,
          `${label} ${side} ${point.pin} photo badge clears weld ${other.pin} and its highlight ring`)
      })
    })
  })
}

function assertTerminalPhotoLabels(metrics, calls, label) {
  ;['output', 'input'].forEach((side) => {
    const endpoint = metrics[side]
    if (!endpoint.photoSpec || endpoint.photoSpec.kind !== 'terminal') return
    const terminalAnchors = [...endpoint.anchors.values()].filter((point) => point.photo)
    terminalAnchors.forEach((point) => {
      const rect = point.labelRect
      assert(rect && rect.width === 14 && rect.height === 14,
        `${label} ${side} terminal ${point.pin} has a 14×14 label badge`)
      const expectedPinLabel = String(point.pin).split('·').at(-1)
      const actualLabel = rect.label || point.label
      assert.strictEqual(actualLabel, expectedPinLabel,
        `${label} ${side} terminal ${point.pin} badge uses its actual +/−/G contact label`)
      const matchingCalls = calls.filter((call) => call[0] === 'fillText' && call[1] === actualLabel
        && Math.abs(call[2] - rect.textX) < 0.01 && Math.abs(call[3] - rect.textY) < 0.01)
      assert.strictEqual(matchingCalls.length, 1,
        `${label} ${side} terminal ${point.pin} label is drawn once at its current badge position`)
      const box = point.box
      assert(rect.x >= box.columnX + 2 - 1e-6
        && rect.x + rect.width <= box.columnX + box.columnWidth - 2 + 1e-6,
      `${label} ${side} terminal ${point.pin} badge stays inside its physical head column`)
      terminalAnchors.forEach((other) => {
        const nearestX = Math.max(rect.x, Math.min(other.x, rect.x + rect.width))
        const nearestY = Math.max(rect.y, Math.min(other.y, rect.y + rect.height))
        assert(Math.hypot(other.x - nearestX, other.y - nearestY) >= 6 - 1e-6,
          `${label} ${side} terminal ${point.pin} badge does not cover weld ${other.pin}`)
      })
    })
  })
}

function assertTerminalCaptionDrawn(calls, caption, label, originX = 0, originY = 0) {
  assert(caption && Array.isArray(caption.lines) && caption.lines.length > 0,
    `${label} retains terminal caption lines`)
  caption.lines.forEach((line, index) => {
    const x = originX + caption.x
    const y = originY + caption.y + (index * caption.size * 1.35)
    const matchingCalls = calls.filter((call) => call[0] === 'fillText' && call[1] === line
      && Math.abs(call[2] - x) < 0.01 && Math.abs(call[3] - y) < 0.01)
    assert.strictEqual(matchingCalls.length, 1,
      `${label} terminal caption line ${index + 1} is drawn at its measured position`)
  })
}

function assertPhysicalWirePaths(model, width) {
  const options = { layout: 'solder-wiring', showTitle: false, theme: 'light', photos: photosFor(model) }
  const height = getDiagramHeight(width, model, options)
  const canvas = recorder()
  const metrics = drawWiringDiagram(canvas.ctx, model, width, height, options)
  assertBounds(canvas.calls, width, height)
  assert.strictEqual(metrics.connectionAnchors.length, model.connections.length,
    `${model.output.id} → ${model.input.id} has one physical wire per model connection at ${width}px`)
  const hitAreas = getWiringHitAreas(model, width, height, options)
  assert.strictEqual(hitAreas.length, model.connections.length,
    `${model.output.id} → ${model.input.id} has one wire hit path per connection at ${width}px`)
  assertCompleteEndpointPhotos(metrics, `${model.output.id} → ${model.input.id} at ${width}px`)
  assert.strictEqual(canvas.calls.filter((call) => call[0] === 'drawImage').length,
    metrics.output.photoBoxes.length + metrics.input.photoBoxes.length,
  `${model.output.id} → ${model.input.id} draws each physical photo head once at ${width}px`)
  metrics.connectionAnchors.forEach((wire, index) => {
    const connection = model.connections[index]
    assert.strictEqual(wire.id, connection.id, `${wire.id} retains model connection order`)
    assert.strictEqual(wire.connection.id, connection.id, `${wire.id} keeps its model connection identity`)
    assert.strictEqual(wire.connection.fromPin, connection.fromPin, `${wire.id} retains its exact source pin`)
    assert.strictEqual(wire.connection.toPin, connection.toPin, `${wire.id} retains its exact destination pin`)
    assert.strictEqual(wire.connection.fromLabel, connection.fromLabel,
      `${wire.id} keeps the model's original source pin label`)
    assert.strictEqual(wire.connection.toLabel, connection.toLabel,
      `${wire.id} keeps the model's original destination pin label`)
    const outputPin = metrics.output.anchors.get(String(connection.fromPin))
    const inputPin = metrics.input.anchors.get(String(connection.toPin))
    assertPointObjectMatches(wire.from, outputPin,
      `${wire.id} wire begins at its actual output photo pin ${connection.fromPin}`)
    assertPointObjectMatches(wire.to, inputPin,
      `${wire.id} wire ends at its actual input photo pin ${connection.toPin}`)
    assert(Array.isArray(wire.points) && wire.points.length >= 2,
      `${wire.id} carries its complete source-to-destination polyline`)
    assert.deepStrictEqual(wire.points[0], [outputPin.x, outputPin.y],
      `${wire.id} first stroke point is the real output weld`)
    assert.deepStrictEqual(wire.points.at(-1), [inputPin.x, inputPin.y],
      `${wire.id} final stroke point is the real input weld`)
    const hit = hitAreas.find((area) => area.id === wire.id)
    assert(hit, `${wire.id} has a matching physical-wire hit path`)
    assert.deepStrictEqual(hit.pathPoints, wire.points, `${wire.id} hit testing uses every drawn point in order`)
  })
  assertRoutePolylinesDoNotCross(metrics.connectionAnchors,
    `${model.output.id} → ${model.input.id} at ${width}px`)
  assertDrawnRoutesMatch(canvas.calls, metrics.connectionAnchors,
    `${model.output.id} → ${model.input.id} at ${width}px`)
  assertRoutesAvoidTerminalCaptions(metrics.connectionAnchors, [metrics.output, metrics.input],
    `${model.output.id} → ${model.input.id} at ${width}px`)
  assertPhotoPinLabelClearance(metrics, `${model.output.id} → ${model.input.id} at ${width}px`)
  assertTerminalPhotoLabels(metrics, canvas.calls, `${model.output.id} → ${model.input.id} at ${width}px`)
  assertNoUndefinedOrNaNText(canvas.calls,
    `${model.output.id} → ${model.input.id} complete solder layout at ${width}px`)
}

function closedPathBounds(calls) {
  const rectangles = []
  let points = null
  calls.forEach((call) => {
    if (call[0] === 'beginPath') points = []
    else if (points && (call[0] === 'moveTo' || call[0] === 'lineTo')) points.push([call[1], call[2]])
    else if (points && call[0] === 'bezierCurveTo' && points.length) {
      const [startX, startY] = points[points.length - 1]
      const [, , control1X, control1Y, control2X, control2Y, endX, endY] = call
      for (let step = 1; step <= 48; step += 1) {
        const t = step / 48, inverse = 1 - t
        points.push([
          inverse ** 3 * startX + 3 * inverse ** 2 * t * control1X + 3 * inverse * t ** 2 * control2X + t ** 3 * endX,
          inverse ** 3 * startY + 3 * inverse ** 2 * t * control1Y + 3 * inverse * t ** 2 * control2Y + t ** 3 * endY,
        ])
      }
    }
    else if (call[0] === 'closePath' && points && points.length >= 4) {
      const xs = points.map((point) => point[0])
      const ys = points.map((point) => point[1])
      rectangles.push({ left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) })
      points = null
    } else if ((call[0] === 'stroke' || call[0] === 'fill') && points) points = null
  })
  return rectangles.map((rect) => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }))
}

function openStrokePaths(calls) {
  return openStrokePathEntries(calls).map((entry) => entry.points)
}

function openStrokePathEntries(calls) {
  const paths = []
  let points = null
  let closed = false
  calls.forEach((call, callIndex) => {
    if (call[0] === 'beginPath') { points = []; closed = false }
    else if (points && (call[0] === 'moveTo' || call[0] === 'lineTo')) points.push([call[1], call[2]])
    else if (call[0] === 'closePath') closed = true
    else if (call[0] === 'stroke' && points) {
      if (!closed) paths.push({ points, callIndex })
      points = null
    } else if (call[0] === 'fill') points = null
  })
  return paths
}

function pointDistance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}

function segmentIntersection(start, end, otherStart, otherEnd) {
  const rx = end[0] - start[0], ry = end[1] - start[1]
  const sx = otherEnd[0] - otherStart[0], sy = otherEnd[1] - otherStart[1]
  const determinant = (rx * sy) - (ry * sx)
  const qx = otherStart[0] - start[0], qy = otherStart[1] - start[1]
  if (Math.abs(determinant) < 1e-8) {
    if (Math.abs((qx * ry) - (qy * rx)) > 1e-7) return null
    const length = (rx * rx) + (ry * ry)
    if (length < 1e-8) return null
    const t0 = ((qx * rx) + (qy * ry)) / length
    const t1 = (((otherEnd[0] - start[0]) * rx) + ((otherEnd[1] - start[1]) * ry)) / length
    const low = Math.max(0, Math.min(t0, t1)), high = Math.min(1, Math.max(t0, t1))
    if (high < low - 1e-8) return null
    return [
      [start[0] + (low * rx), start[1] + (low * ry)],
      [start[0] + (high * rx), start[1] + (high * ry)],
    ]
  }
  const t = ((qx * sy) - (qy * sx)) / determinant
  const u = ((qx * ry) - (qy * rx)) / determinant
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null
  const point = [start[0] + (t * rx), start[1] + (t * ry)]
  return [point, point]
}

function pointsMatch(first, second) {
  return Array.isArray(first) && Array.isArray(second)
    && Math.abs(first[0] - second[0]) < 1e-7 && Math.abs(first[1] - second[1]) < 1e-7
}

function routePin(route, key) {
  return route.connection && route.connection[key] !== undefined
    ? String(route.connection[key]) : ''
}

function commonRouteEnds(first, second) {
  const firstPoints = first.points
  const secondPoints = second.points
  const sharesFrom = routePin(first, 'fromPin') !== ''
    && routePin(first, 'fromPin') === routePin(second, 'fromPin')
    && pointsMatch(firstPoints[0], secondPoints[0])
  const sharesTo = routePin(first, 'toPin') !== ''
    && routePin(first, 'toPin') === routePin(second, 'toPin')
    && pointsMatch(firstPoints.at(-1), secondPoints.at(-1))
  let prefixCount = 0
  if (sharesFrom) {
    while (prefixCount < firstPoints.length && prefixCount < secondPoints.length
      && pointsMatch(firstPoints[prefixCount], secondPoints[prefixCount])) prefixCount += 1
  }
  let suffixCount = 0
  if (sharesTo) {
    while (suffixCount < firstPoints.length && suffixCount < secondPoints.length
      && pointsMatch(firstPoints[firstPoints.length - 1 - suffixCount],
        secondPoints[secondPoints.length - 1 - suffixCount])) suffixCount += 1
  }
  return { sharesFrom, sharesTo, prefixCount, suffixCount }
}

function isCommonPrefixSegment(first, second, firstIndex, secondIndex, prefixCount) {
  return prefixCount > 1 && firstIndex === secondIndex && firstIndex < prefixCount - 1
    && pointsMatch(first.points[firstIndex], second.points[secondIndex])
    && pointsMatch(first.points[firstIndex + 1], second.points[secondIndex + 1])
}

function isCommonSuffixSegment(first, second, firstIndex, secondIndex, suffixCount) {
  const firstStart = first.points.length - suffixCount
  const secondStart = second.points.length - suffixCount
  return suffixCount > 1 && firstIndex >= firstStart && secondIndex >= secondStart
    && firstIndex - firstStart === secondIndex - secondStart
    && pointsMatch(first.points[firstIndex], second.points[secondIndex])
    && pointsMatch(first.points[firstIndex + 1], second.points[secondIndex + 1])
}

function isSharedJunction(point, first, second, sharedEnds) {
  if (sharedEnds.sharesFrom && sharedEnds.prefixCount > 0
    && first.points.slice(0, sharedEnds.prefixCount).some((candidate) => pointsMatch(candidate, point))) return true
  if (sharedEnds.sharesTo && sharedEnds.suffixCount > 0
    && first.points.slice(first.points.length - sharedEnds.suffixCount)
      .some((candidate) => pointsMatch(candidate, point))) return true
  return false
}

function assertRoutePolylinesDoNotCross(routes, label) {
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    assert(Array.isArray(route.points) && route.points.length >= 2,
      `${label}: ${route.id} has a complete photo-to-photo polyline`)
    route.points.forEach((point, pointIndex) => {
      assert(Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
        `${label}: ${route.id} point ${pointIndex} is finite`)
      if (pointIndex) assert(pointDistance(point, route.points[pointIndex - 1]) > 1e-8,
        `${label}: ${route.id} has no zero-length segment at ${pointIndex}`)
    })
    assert.deepStrictEqual(route.points[0], [route.from.x, route.from.y],
      `${label}: ${route.id} starts at its real output weld point`)
    assert.deepStrictEqual(route.points.at(-1), [route.to.x, route.to.y],
      `${label}: ${route.id} ends at its real input weld point`)
    for (let first = 1; first < route.points.length; first += 1) {
      for (let second = first + 2; second < route.points.length; second += 1) {
        assert.strictEqual(segmentIntersection(route.points[first - 1], route.points[first],
          route.points[second - 1], route.points[second]), null,
        `${label}: ${route.id} does not cross itself at segments ${first - 1}/${second - 1}`)
      }
    }
    for (let otherIndex = routeIndex + 1; otherIndex < routes.length; otherIndex += 1) {
      const other = routes[otherIndex]
      const sharedEnds = commonRouteEnds(route, other)
      for (let first = 1; first < route.points.length; first += 1) {
        for (let second = 1; second < other.points.length; second += 1) {
          const intersection = segmentIntersection(route.points[first - 1], route.points[first],
            other.points[second - 1], other.points[second])
          if (!intersection) continue
          const overlapLength = pointDistance(intersection[0], intersection[1])
          if (overlapLength > 1e-7) {
            const sharedPrefix = isCommonPrefixSegment(route, other, first - 1, second - 1, sharedEnds.prefixCount)
            const sharedSuffix = isCommonSuffixSegment(route, other, first - 1, second - 1, sharedEnds.suffixCount)
            assert(sharedPrefix || sharedSuffix,
              `${label}: ${route.id}/${other.id} may overlap only on a continuous shared source prefix or destination suffix`)
            continue
          }
          assert(isSharedJunction(intersection[0], route, other, sharedEnds),
            `${label}: ${route.id}/${other.id} may meet only at a shared real source/destination or a shared branch point`)
        }
      }
    }
  }
}

function assertNoUndefinedOrNaNText(calls, label) {
  const invalidText = calls.filter((call) => call[0] === 'fillText'
    && /undefined|NaN/i.test(String(call[1])))
  assert.strictEqual(invalidText.length, 0, `${label} contains no undefined or NaN Canvas text`)
}

function routeStrokeGroups(calls) {
  return strokeCallGroups(calls).filter((group) =>
    group.some((call) => call[0] === 'setLineWidth' && [1.6, 2.3, 5.8].includes(call[1]))
    && group.some((call) => call[0] === 'moveTo') && group.some((call) => call[0] === 'lineTo'))
}

function routePathFromPoints(points) {
  return [['moveTo', ...points[0]], ...points.slice(1).map((point) => ['lineTo', ...point])]
}

function assertDrawnRoutesMatch(calls, routes, label) {
  const groups = routeStrokeGroups(calls)
  assert.strictEqual(groups.length, routes.length, `${label} draws one continuous stroke per connection`)
  groups.forEach((group, index) => {
    const path = group.filter((call) => call[0] === 'moveTo' || call[0] === 'lineTo')
    assert.deepStrictEqual(path, routePathFromPoints(routes[index].points),
      `${label} draws every route point in order with no crossing gap`)
  })
}

function assertPhotoRotationScopes(calls, label, expectedRotations) {
  const stack = []
  const angles = []
  let translationCalls = 0
  let rotatedImageDraws = 0
  calls.forEach((call) => {
    if (call[0] === 'save') stack.push({ stage: 0, rotated: false })
    else if (call[0] === 'translate') {
      assert(stack.length > 0, `${label}: translate is scoped by save/restore`)
      assert(call.slice(1).length >= 2 && call.slice(1).every(Number.isFinite),
        `${label}: photo translation uses finite Canvas coordinates`)
      assert.strictEqual(stack.at(-1).stage, 0, `${label}: each photo save is followed by one translation`)
      stack.at(-1).stage = 1
      translationCalls += 1
    } else if (call[0] === 'rotate') {
      assert(stack.length > 0, `${label}: rotate is scoped by save/restore`)
      assert(Number.isFinite(call[1]), `${label}: photo rotation angle is finite`)
      assert.strictEqual(stack.at(-1).stage, 1, `${label}: photo rotation immediately follows its translation`)
      stack.at(-1).stage = 2
      stack.at(-1).rotated = true
      angles.push(call[1])
    } else if (call[0] === 'drawImage' && stack.at(-1)?.rotated) {
      assert.strictEqual(stack.at(-1).stage, 2, `${label}: rotated photo is drawn immediately after rotate`)
      stack.at(-1).stage = 3
      rotatedImageDraws += 1
    } else if (call[0] === 'restore') {
      const scope = stack.pop()
      assert(scope, `${label}: restore never underflows the Canvas state stack`)
      if (scope.rotated) assert.strictEqual(scope.stage, 3,
        `${label}: each photo follows save → translate → rotate → drawImage → restore`)
    }
  })
  assert.strictEqual(stack.length, 0, `${label}: all Canvas save scopes are restored`)
  assert.strictEqual(translationCalls, expectedRotations,
    `${label}: each rotated physical photo receives exactly one Canvas translation`)
  assert.strictEqual(angles.length, expectedRotations,
    `${label}: records the expected number of real rotation calls`)
  assert.strictEqual(rotatedImageDraws, expectedRotations,
    `${label}: each rotated physical photo reaches exactly one drawImage call inside its saved transform`)
  angles.forEach((angle) => {
    assert.strictEqual(angle, Math.PI,
      `${label}: complete connector photos rotate by Math.PI radians without mirroring`)
  })
}

function assertNoStrokeThroughCaption(calls, caption, centerX, baseline, message) {
  const textWidth = [...caption].reduce((sum, character) => sum + (character.codePointAt(0) > 0xff ? 9 : 4.5), 0)
  const left = centerX - (textWidth / 2) - 4
  const right = centerX + (textWidth / 2) + 4
  const top = baseline - 9
  const bottom = baseline + 2
  openStrokePaths(calls).filter((points) => points.length >= 5).forEach((points) => {
    for (let index = 1; index < points.length; index += 1) {
      const [x1, y1] = points[index - 1]
      const [x2, y2] = points[index]
      const crossesVertically = Math.abs(x1 - x2) < 0.01 && x1 >= left && x1 <= right
        && Math.max(Math.min(y1, y2), top) <= Math.min(Math.max(y1, y2), bottom)
      const crossesHorizontally = Math.abs(y1 - y2) < 0.01 && y1 >= top && y1 <= bottom
        && Math.max(Math.min(x1, x2), left) <= Math.min(Math.max(x1, x2), right)
      assert.ok(!crossesVertically && !crossesHorizontally,
        `${message}: stroke segment ${JSON.stringify([points[index - 1], points[index]])}`)
    }
  })
}

function segmentIntersectsRect(start, end, rect) {
  const left = rect.x, right = rect.x + rect.width
  const top = rect.y, bottom = rect.y + rect.height
  const inside = ([x, y]) => x >= left && x <= right && y >= top && y <= bottom
  if (inside(start) || inside(end)) return true
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]]
  return corners.some((corner, index) => segmentIntersection(start, end,
    corner, corners[(index + 1) % corners.length]) !== null)
}

function assertRoutesAvoidTerminalCaptions(routes, endpoints, label) {
  endpoints.forEach((endpoint) => {
    const caption = endpoint && endpoint.terminalCaption
    if (!caption) return
    caption.lines.forEach((line, index) => {
      const baseline = caption.y + (index * caption.size * 1.35)
      const textWidth = [...line].length * caption.size
      const textRect = {
        x: caption.x - (textWidth / 2) - 2,
        y: baseline - caption.size - 1,
        width: textWidth + 4,
        height: caption.size + 4,
      }
      routes.forEach((route) => {
        for (let pointIndex = 1; pointIndex < route.points.length; pointIndex += 1) {
          assert(!segmentIntersectsRect(route.points[pointIndex - 1], route.points[pointIndex], textRect),
            `${label}: ${route.id} does not cross terminal caption line ${index + 1}`)
        }
      })
    })
  })
}

function assertPinLabelsStayReadable(calls, pins, anchors, baselineFor, message) {
  const routes = openStrokePathEntries(calls).filter((entry) => entry.points.length >= 5)
  const lastRouteStroke = Math.max(...routes.map((entry) => entry.callIndex))
  const labels = pins.map((pin) => {
    const point = anchors.get(pin.pin)
    assert(point, `${message}: anchor exists for ${pin.pin}`)
    const baseline = baselineFor(pin, point)
    const labelIndex = calls.findIndex((call) => call[0] === 'fillText' && call[1] === pin.pin
      && Math.abs(call[2] - point.x) < 0.01 && Math.abs(call[3] - baseline) < 0.01)
    assert(labelIndex >= 0, `${message}: pin ${pin.pin} uses the reserved label baseline`)
    assert(labelIndex > lastRouteStroke, `${message}: pin ${pin.pin} is drawn over all routes`)
    const width = [...String(pin.pin)].reduce((sum, character) =>
      sum + (character.codePointAt(0) > 0xff ? 9 : 4.5), 0)
    return { pin: pin.pin, x: point.x, baseline, width, labelIndex,
      left: point.x - width / 2 - 2, right: point.x + width / 2 + 2,
      top: baseline - 9, bottom: baseline + 2 }
  })
  labels.forEach((label) => {
    const routeOverlap = routes.some(({ points }) => {
      for (let index = 1; index < points.length; index += 1) {
        const [x1, y1] = points[index - 1]
        const [x2, y2] = points[index]
        const crossesVertically = Math.abs(x1 - x2) < 0.01 && x1 >= label.left && x1 <= label.right
          && Math.max(Math.min(y1, y2), label.top) <= Math.min(Math.max(y1, y2), label.bottom)
        const crossesHorizontally = Math.abs(y1 - y2) < 0.01 && y1 >= label.top && y1 <= label.bottom
          && Math.max(Math.min(x1, x2), label.left) <= Math.min(Math.max(x1, x2), label.right)
        if (crossesVertically || crossesHorizontally) return true
      }
      return false
    })
    if (!routeOverlap) return
    const expectedMask = { left: label.x - (label.width / 2) - 3,
      right: label.x + (label.width / 2) + 3, top: label.baseline - 9, bottom: label.baseline + 2 }
    assert(closedPathBounds(calls.slice(0, label.labelIndex)).some((rect) =>
      Math.abs(rect.left - expectedMask.left) < 0.01 && Math.abs(rect.right - expectedMask.right) < 0.01
      && Math.abs(rect.top - expectedMask.top) < 0.01 && Math.abs(rect.bottom - expectedMask.bottom) < 0.01),
    `${message}: ${label.pin} gets a background mask where a route passes behind it`)
  })
}

const basic = getWiringModel('xlrBalanced', 'xlrBalanced')
for (const width of [280, 320, 375]) {
  const functional = render(basic, width, { viewMode: 'wiring', theme: 'light' })
  const areas = getWiringHitAreas(basic, width, functional.height)
  assert.strictEqual(areas.length, basic.connections.length)
  assert.ok(areas.every((area) => area.left >= 0 && area.left + area.width <= width && area.top + area.height <= functional.height))
  render(basic, width, { viewMode: 'connectors', face: 'mating', theme: 'dark' })
  render(basic, width, { viewMode: 'connectors', face: 'solder', theme: 'light' })
  for (const face of ['mating', 'solder']) {
    const titledHeight = getDiagramHeight(width, basic, { viewMode: 'connectors', face })
    const untitled = render(basic, width, { viewMode: 'connectors', face, showTitle: false })
    assert.strictEqual(titledHeight - untitled.height, 24,
      `hiding the title keeps connector ${face} geometry in sync at width ${width}`)
  }
}

const stereo635Legacy = render(getWiringModel('stereo635', 'stereo635'), 375,
  { viewMode: 'connectors', face: 'mating', theme: 'light' })
assert(!stereo635Legacy.calls.some((call) => call[0] === 'fillText' && call[1] === '按具体接头结构核对'),
  'legacy connector diagram routes 6.35 mm stereo TRS through the phone-plug renderer')
assert(['T', 'R', 'S'].every((pin) => stereo635Legacy.calls.some((call) => call[0] === 'fillText' && call[1] === pin)),
  'legacy 6.35 mm stereo TRS connector view draws its three contacts')
const stereo35InputLegacy = render(getWiringModel('stereo35', 'stereo35'), 375,
  { viewMode: 'connectors', face: 'mating', theme: 'light' })
assert(!stereo35InputLegacy.calls.some((call) => call[0] === 'fillText' && call[1] === '按具体接头结构核对'),
  '3.5 mm stereo input uses the existing phone-plug renderer')
assert(stereo35InputLegacy.calls.some((call) => call[0] === 'fillText' && call[1] === '3.5 立体声'),
  '3.5 mm stereo connector view uses the plain user-facing title')
assert(['T', 'R', 'S'].every((pin) => stereo35InputLegacy.calls.some((call) => call[0] === 'fillText' && call[1] === pin)),
  '3.5 mm stereo input draws all three contacts')

const narrowFourPin = getWiringModel('stereo35', 'rcaStereo', { destinationChannel: 'both' })
assert.strictEqual(narrowFourPin.status, 'ready')
const photoPairs = [
  ['xlrBalanced', 'xlrBalanced', {}],
  ['xlrBalanced', 'terminalBalanced', {}],
  ['stereo35', 'rcaStereo', { destinationChannel: 'both' }],
  ['xlrBalanced', 'rcaStereo', { outputMode: 'coldReturn', destinationChannel: 'both' }],
  ['stereo35', 'tsStereo', { destinationChannel: 'both' }],
  ['terminalBalanced', 'terminalBalanced', {}],
  ['stereo35', 'xlrBalanced', { sourceChannel: 'left' }],
  ['stereo35', 'stereo35', {}],
  ['stereo35', 'trsBalanced', { sourceChannel: 'right' }],
  ['stereo35', 'terminalBalanced', { sourceChannel: 'left' }],
  ['stereo35', 'rcaMono', { sourceChannel: 'right' }],
  ['stereo35', 'tsMono', { sourceChannel: 'left' }],
]
const photoOptions = { layout: 'solder-wiring', theme: 'dark', showTitle: false, avoidRail: false }
function geometrySnapshot(metrics) {
  return {
    height: metrics.height,
    endpoints: ['output', 'input'].map((side) => {
      const endpoint = metrics[side]
      return {
        photoSpec: endpoint.photoSpec && {
          key: endpoint.photoSpec.key, width: endpoint.photoSpec.width, height: endpoint.photoSpec.height,
          contentRect: endpoint.photoSpec.contentRect,
        },
        boxes: endpoint.photoBoxes.map(({ key, x, y, width, height }) => ({ key, x, y, width, height })),
        anchors: [...endpoint.anchors.entries()].map(([pin, point]) => [pin, point.x, point.y]),
      }
    }),
    wires: metrics.connectionAnchors.map((wire) => ({
      id: wire.id, fromPin: wire.connection.fromPin, toPin: wire.connection.toPin,
      fromLabel: wire.connection.fromLabel, toLabel: wire.connection.toLabel,
      points: wire.points,
      from: [wire.from.x, wire.from.y], to: [wire.to.x, wire.to.y],
    })),
  }
}

const photoDimensionsByPath = new Map()

function assertCompleteEndpointPhotos(metrics, label) {
  ;['output', 'input'].forEach((side) => {
    const endpoint = metrics[side]
    if (!endpoint.photoSpec) {
      assert.strictEqual(endpoint.photoBoxes.length, 0, `${label} ${side} has no photo boxes without a solder photo`)
      return
    }
    const spec = endpoint.photoSpec
    if (!photoDimensionsByPath.has(spec.path)) {
      const assetPath = path.resolve(__dirname, '..', String(spec.path).replace(/^\/+/, ''))
      const bytes = fs.readFileSync(assetPath)
      assert.strictEqual(bytes.toString('ascii', 1, 4), 'PNG', `${label} ${side} asset is a PNG`)
      photoDimensionsByPath.set(spec.path, { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
    }
    assert.deepStrictEqual(photoDimensionsByPath.get(spec.path), { width: spec.width, height: spec.height },
      `${label} ${side} manifest uses the actual complete PNG dimensions`)
    assert.deepStrictEqual(spec.contentRect, { x: 0, y: 0, width: spec.width, height: spec.height },
      `${label} ${side} uses the complete source image rectangle`)
    assert(!String(spec.key).startsWith('overview-'), `${label} ${side} draws only its complete opened solder photo`)
    endpoint.photoBoxes.forEach((box) => {
      const imageRect = box.destination || box
      assert(Math.abs((imageRect.width / imageRect.height) - (spec.width / spec.height)) < 1e-8,
        `${label} ${side} preserves the full source photo aspect ratio`)
    })
  })
}

const routeAuditModels = allReadyModels()
assert.strictEqual(routeAuditModels.length, 63, 'physical wire audit covers every supported connection plan')
const rotatedPhotoModel = getWiringModel('stereo635', 'terminalBalanced')
const rotatedPhotoDiagram = render(rotatedPhotoModel, 319, {
  layout: 'solder-wiring', avoidRail: true, theme: 'light', selectedId: rotatedPhotoModel.connections[0].id,
  photos: photosFor(rotatedPhotoModel),
})
assertPhotoRotationScopes(rotatedPhotoDiagram.calls, 'stereo635 → terminal renderer', 3)
const rotatedPhotoDraws = rotatedPhotoDiagram.calls.filter((call) => call[0] === 'drawImage')
assert.strictEqual(rotatedPhotoDraws.length, 3,
  'stereo635 → terminal draws the source plug and both physical terminal input heads once')
assert(rotatedPhotoDraws.every((call) => call[4] > 0 && call[5] > 0),
  '180-degree orientation preserves positive full-photo dimensions instead of flipping an image axis')
assert(!rotatedPhotoDiagram.calls.some((call) => call[0] === 'scale' && call.slice(1).some((value) => value < 0)),
  'photo orientation does not mirror the connector image with a negative scale')

routeAuditModels.forEach((model) => {
  ;[274, 319, 369].forEach((width) => {
    try {
      assertPhysicalWirePaths(model, width)
    } catch (error) {
      error.message = `${model.output.id} → ${model.input.id} at ${width}px: ${error.message}`
      throw error
    }
  })
})

for (const [outputId, inputId, selections] of photoPairs) {
  const model = getWiringModel(outputId, inputId, selections)
  assert.strictEqual(model.status, 'ready', `${outputId} → ${inputId} photo layout case is ready`)
  const specs = getModelPhotoSpecs(model)
  assert(specs.every((spec) => !String(spec.key).startsWith('overview-')),
    `${outputId} → ${inputId} screen photo loader excludes independent connector overviews`)
  const photos = Object.fromEntries(specs.map((spec) => [spec.key, { key: spec.key }]))
  for (const width of [216, 272, 320]) {
    for (const theme of ['light', 'dark']) {
      const options = { ...photoOptions, theme }
      const heightWithoutPhotos = getDiagramHeight(width, model, options)
      const heightWithPhotos = getDiagramHeight(width, model, { ...options, photos })
      assert.strictEqual(heightWithPhotos, heightWithoutPhotos,
        `${outputId} → ${inputId} height is independent of image readiness at ${width}px ${theme}`)
      const hitsWithoutPhotos = getWiringHitAreas(model, width, heightWithoutPhotos, options)
      const hitsWithPhotos = getWiringHitAreas(model, width, heightWithPhotos, { ...options, photos })
      assert.deepStrictEqual(hitsWithPhotos, hitsWithoutPhotos,
        `${outputId} → ${inputId} hit regions do not depend on loaded image objects at ${width}px ${theme}`)
      const noPhotoMetrics = drawWiringDiagram(recorder().ctx, model, width, heightWithoutPhotos, options)
      const loadedCanvas = recorder()
      const loadedMetrics = drawWiringDiagram(loadedCanvas.ctx, model, width, heightWithPhotos, { ...options, photos })
      assert.deepStrictEqual(geometrySnapshot(loadedMetrics), geometrySnapshot(noPhotoMetrics),
        `${outputId} → ${inputId} anchors are manifest-derived, independent of image objects at ${width}px ${theme}`)
      assertBounds(loadedCanvas.calls, width, heightWithPhotos)
      assertCompleteEndpointPhotos(loadedMetrics, `${outputId} → ${inputId}`)
      const expectedPhotoDraws = loadedMetrics.output.photoBoxes.length + loadedMetrics.input.photoBoxes.length
      assert.strictEqual(loadedCanvas.calls.filter((call) => call[0] === 'drawImage').length, expectedPhotoDraws,
        'each physical connector head draws its one complete solder-side photo')
      loadedCanvas.calls.filter((call) => call[0] === 'drawImage').forEach((call) => {
        assert.strictEqual(call.length, 6, 'complete photos use the portable uncropped 5-argument drawImage API')
      })
      assert.strictEqual(loadedCanvas.calls.filter((call) => call[0] === 'clip').length, 0,
        'complete solder photos are not clipped to a cropped detail viewport')
      assertNoUndefinedOrNaNText(loadedCanvas.calls, `${outputId} → ${inputId} photo rendering`)
      assertTerminalPhotoLabels(loadedMetrics, loadedCanvas.calls, `${outputId} → ${inputId}`)
      assertRoutePolylinesDoNotCross(loadedMetrics.connectionAnchors,
        `${outputId} → ${inputId} photo routes at ${width}px ${theme}`)
      assertDrawnRoutesMatch(loadedCanvas.calls, loadedMetrics.connectionAnchors,
        `${outputId} → ${inputId} photo routes at ${width}px ${theme}`)
      const inputHeadChannels = loadedMetrics.gallery.heads.filter((head) => head.side === 'input')
        .map((head) => head.channel)
      if (inputHeadChannels.length === 2 && inputHeadChannels.includes('L') && inputHeadChannels.includes('R')) {
        assert.deepStrictEqual(loadedMetrics.input.photoBoxes.map((box) => box.key), ['L', 'R'],
          `${inputId} renders separate L and R connector heads`)
        const channelCaptions = loadedCanvas.calls.filter((call) => call[0] === 'fillText'
          && ['L头', 'R头'].includes(call[1]))
        assert.deepStrictEqual(channelCaptions.map((call) => call[1]), ['L头', 'R头'],
          `${inputId} gives both physical input heads explicit L/R labels`)
      }
      if (model.output.id === 'stereo635' || model.input.id === 'stereo635') {
        const endpointText = loadedCanvas.calls.filter((call) => call[0] === 'fillText').map((call) => call[1])
        assert(['T L', 'R R', 'S G'].every((label) => endpointText.includes(label)),
          '6.35 mm stereo TRS photos show each physical T/R/S contact with its L/R/G function')
      }
      if (model.output.id === 'trsBalanced' || model.input.id === 'trsBalanced') {
        const endpointText = loadedCanvas.calls.filter((call) => call[0] === 'fillText').map((call) => call[1])
        assert(['T +', 'R −', 'S G'].every((label) => endpointText.includes(label)),
          '6.35 mm balanced TRS photos show each physical T/R/S contact with its +/−/G function')
      }
      loadedMetrics.connectionAnchors.forEach((wire) => {
        const hit = hitsWithPhotos.find((area) => area.id === wire.id)
        assert(hit, `${wire.id} has a matching complete-polyline hit region`)
        assert.deepStrictEqual(hit.pathPoints, wire.points, 'hit testing uses the same complete route polyline')
        assert.deepStrictEqual(hit.pathPoints[0], [wire.from.x, wire.from.y], 'hit path begins at the actual output weld')
        assert.deepStrictEqual(hit.pathPoints.at(-1), [wire.to.x, wire.to.y], 'hit path ends at the actual input weld')
        assertPointObjectMatches(wire.from,
          loadedMetrics.output.anchors.get(String(wire.connection.fromPin)), `${wire.id} begins at its actual output pin`)
        assertPointObjectMatches(wire.to,
          loadedMetrics.input.anchors.get(String(wire.connection.toPin)), `${wire.id} ends at its actual input pin`)
      })
    }
  }
}

const stereo35ToDualRcaLayout = render(getWiringModel('stereo35', 'rcaStereo'), 320, {
  layout: 'solder-wiring', avoidRail: false, theme: 'light',
  photos: photosFor(getWiringModel('stereo35', 'rcaStereo')),
})
const singleHeadRLabel = stereo35ToDualRcaLayout.metrics.output.anchors.get('R').label
const singleHeadRWire = stereo35ToDualRcaLayout.metrics.connectionAnchors.find((wire) => wire.connection.fromPin === 'R')
assert.strictEqual(singleHeadRLabel, 'R R',
  'the single stereo35 photo labels its physical R ring with the right-channel R function exactly once')
assertPointObjectMatches(singleHeadRWire.from, stereo35ToDualRcaLayout.metrics.output.anchors.get('R'),
  'a single-head physical R wire starts at the actual R solder contact')
assert.deepStrictEqual(
  stereo35ToDualRcaLayout.metrics.gallery.heads.filter((head) => head.side === 'input').map((head) => head.channel),
  ['L', 'R'], 'the dual-RCA gallery retains separate L and R physical heads')
assert.deepStrictEqual(stereo35ToDualRcaLayout.metrics.connectionAnchors.map((wire) => wire.connection.toPin),
  ['L中心', 'R中心', 'L外壳', 'R外壳'],
  'dual-RCA physical wires preserve their original L/R center and shell pin identities')

const balancedTrsLayout = render(getWiringModel('trsBalanced', 'xlrBalanced'), 320, {
  layout: 'solder-wiring', avoidRail: false, theme: 'light',
  photos: photosFor(getWiringModel('trsBalanced', 'xlrBalanced')),
})
const balancedTrsR = balancedTrsLayout.metrics.output.anchors.get('R').label
const balancedTrsRWire = balancedTrsLayout.metrics.connectionAnchors.find((wire) => wire.connection.fromPin === 'R')
assert.strictEqual(balancedTrsR, 'R −', 'balanced TRS photo identifies its R contact as cold (−)')
assertPointObjectMatches(balancedTrsRWire.from, balancedTrsLayout.metrics.output.anchors.get('R'),
  'balanced TRS R wire starts at the actual cold-ring solder contact')

const titledDiagram = render(basic, 375, { viewMode: 'wiring', showTitle: true })
const untitledDiagram = render(basic, 375, { viewMode: 'wiring', showTitle: false })
assert.strictEqual(titledDiagram.height - untitledDiagram.height, 24,
  'hiding the title also removes its vertical layout space')
assert.ok(titledDiagram.calls.some((call) => call[0] === 'fillText' && call[1] === basic.title && call[3] === 24))
assert.ok(!untitledDiagram.calls.some((call) => call[0] === 'fillText' && call[1] === basic.title))
assert.ok(untitledDiagram.calls.some((call) => call[0] === 'fillText' &&
  String(call[1]).startsWith('功能连线') && call[3] === 23), 'mode guidance moves into the freed title row')
const titledAreas = getWiringHitAreas(basic, 375, titledDiagram.height)
const untitledAreas = getWiringHitAreas(basic, 375, untitledDiagram.height, { showTitle: false })
assert.strictEqual(titledAreas[0].top - untitledAreas[0].top, 24)

// A single unbalanced source return fans to the balanced negative and shield pins.
const monoToBalanced = getWiringModel('tsMono', 'xlrBalanced', { outputMode: 'direct' })
assert.strictEqual(monoToBalanced.status, 'ready')
assert.ok(monoToBalanced.connections.some((wire) => wire.fromPin === 'S' && wire.toRole === 'negative'))
assert.ok(monoToBalanced.connections.some((wire) => wire.fromPin === 'S' && wire.toRole === 'shield'))
const fanout = render(monoToBalanced, 320, { viewMode: 'wiring', theme: 'dark' })
const sourcePinLabels = fanout.calls.filter((call) => call[0] === 'fillText' && call[1] === 'S')
assert.strictEqual(sourcePinLabels.length, 1, 'a physically shared source pin is labeled once')
assert.ok(fanout.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#ffb458'),
  'return-to-negative wire uses negative role color')

// Cold and shield meet only at the shared unbalanced input return.
const coldReturn = getWiringModel('xlrBalanced', 'rcaMono', { outputMode: 'coldReturn' })
const tiedTarget = render(coldReturn, 320, { viewMode: 'wiring', theme: 'light' })
assert.strictEqual(tiedTarget.calls.filter((call) => call[0] === 'fillText' && call[1] === '外壳').length, 1,
  'shared destination pin has one label')
assert.ok(tiedTarget.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#9a5b00'))
assert.ok(tiedTarget.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#5f6872'))

// Retired choice values cannot change the fixed cold-return route.
const coldOpen = getWiringModel('xlrBalanced', 'rcaMono', { outputMode: 'coldOpen' })
assert.strictEqual(coldOpen.status, 'ready')
assert.deepStrictEqual(coldOpen.connections.map((wire) => `${wire.fromPin}>${wire.toPin}`), ['2>中心针', '3>外壳', '1>外壳'])
assert.deepStrictEqual(coldOpen.unconnectedPins, [])

// The legacy one-sided mapping display remains testable with an isolated fixture.
const oneChannelBalanced = legacyOpenStereoFixture()
assert.strictEqual(oneChannelBalanced.status, 'ready')
assert.strictEqual(oneChannelBalanced.unconnectedPins.length, 1)
assert.strictEqual(oneChannelBalanced.unconnectedPins[0].pin, 'R')
const oneChannelConnectors = render(oneChannelBalanced, 375, { viewMode: 'connectors', face: 'mating', theme: 'dark' })
const connectorText = oneChannelConnectors.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1])).join('')
assert.ok(connectorText.includes('右声道 R 输出保持未接并与左声道隔离'),
  'long unconnected-pin reason remains complete in the connector mapping')
const openAreas = getWiringHitAreas(oneChannelBalanced, 375, oneChannelConnectors.height, { viewMode: 'connectors' })
assert.strictEqual(openAreas.length, oneChannelBalanced.connections.length, 'unconnected R has no connection hit target')
const oneChannelMapText = oneChannelConnectors.calls.filter((call) => call[0] === 'fillText' &&
  (String(call[1]).includes('保持未接') || String(call[1]).includes('R 环')))
assert.ok(oneChannelMapText.length >= 2)
const openPinMapLine = oneChannelConnectors.calls.find((call) => call[0] === 'fillText' &&
  String(call[1]).startsWith('输出 R 环'))
assert.ok(openPinMapLine)
assert.ok(!openAreas.some((area) => openPinMapLine[2] >= area.left && openPinMapLine[2] <= area.left + area.width &&
  openPinMapLine[3] >= area.top && openPinMapLine[3] <= area.top + area.height),
'the unconnected R map row does not overlap a connection hit target')
const oneChannelLastBaseline = Math.max(...oneChannelMapText.map((call) => call[3]))
assert.ok(oneChannelConnectors.height - oneChannelLastBaseline <= 40, 'connector view leaves no excessive empty tail')

const solderOneChannel = render(oneChannelBalanced, 375, { viewMode: 'connectors', face: 'solder', theme: 'dark' })
const solderText = solderOneChannel.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1])).join('')
assert.ok(solderText.includes('右声道 R 输出保持未接并与左声道隔离'))
assert.ok(solderText.includes('左右镜像，定位朝上') && solderText.includes('按 T/R/S 标记确认'),
  'solder-face guidance remains complete after height compaction')
const solderLastBaseline = Math.max(...solderOneChannel.calls.filter((call) => call[0] === 'fillText' &&
  String(call[1]).includes('标记确认')).map((call) => call[3]))
assert.ok(solderOneChannel.height - solderLastBaseline <= 40, 'solder note sits near the end of the canvas')

// Six-line split: three physical source pins fan out to two separate destinations.
const splitBoth = getWiringModel('xlrBalanced', 'rcaStereo', {
  outputMode: 'coldReturn', destinationChannel: 'both',
})
assert.strictEqual(splitBoth.connections.length, 6)
const split = render(splitBoth, 320, { viewMode: 'wiring', theme: 'light' })
assert.ok(!split.calls.some((call) => call[0] === 'setStrokeStyle' && call[1] === '#ffffff'),
  'complex fan-out never draws background-colored strokes to erase crossing trunks')
const sharedPinNodes = split.calls.filter((call) => call[0] === 'arc' && call[3] === 3.5 && call[6] === '#5f6872')
assert.ok(sharedPinNodes.length >= 4, 'overlapping source groups get separate solid branch nodes')
assert.ok(split.calls.some((call) => call[0] === 'setStrokeStyle' && call[1] === '#1976d2'),
  'positive source shared trunk uses positive role color')
const splitDark = render(splitBoth, 320, { viewMode: 'wiring', theme: 'dark' })
assert.ok(!splitDark.calls.some((call) => call[0] === 'setStrokeStyle' && call[1] === '#111214'),
  'dark complex fan-out never draws background-colored strokes either')
const outputHeadingX = 10 + (82 / 2)
const sharedSourceLabels = split.calls.filter((call) => call[0] === 'fillText' && ['3', '1'].includes(call[1]) && call[2] === outputHeadingX)
assert.strictEqual(sharedSourceLabels.length, 2)
assert.ok(Math.abs(sharedSourceLabels[0][3] - sharedSourceLabels[1][3]) >= 14,
  'physical source pin labels remain separated when fan-out row groups overlap')
const splitHitAreas = getWiringHitAreas(splitBoth, 320, split.height, { viewMode: 'wiring' })
assert.ok(splitHitAreas.every((area) => area.width > 0 && area.height >= 44))
splitHitAreas.forEach((area) => {
  assert.ok(area.x >= area.left && area.x <= area.left + area.width)
  assert.ok(area.y >= area.top && area.y <= area.top + area.height)
})
const sharedPinTwoLabel = split.calls.find((call) => call[0] === 'fillText' && call[1] === '2' && call[2] === outputHeadingX)
assert.ok(sharedPinTwoLabel, 'shared source pin 2 has a single physical pin label')
const sharedPinTwoPoint = { x: sharedPinTwoLabel[2], y: sharedPinTwoLabel[3] - 4 }
assert.ok(!splitHitAreas.some((area) => sharedPinTwoPoint.x >= area.left &&
  sharedPinTwoPoint.x <= area.left + area.width && sharedPinTwoPoint.y >= area.top &&
  sharedPinTwoPoint.y <= area.top + area.height),
'tapping the shared source pin 2 label cannot select the cold-return row')
split.calls.filter((call) => call[0] === 'arc' && [3.5, 4].includes(call[3])).forEach((node) => {
  assert.ok(!splitHitAreas.some((area) => node[1] >= area.left && node[1] <= area.left + area.width &&
    node[2] >= area.top && node[2] <= area.top + area.height), 'shared junction nodes are outside row hit regions')
})
const rightOnly = render(getWiringModel('tsMono', 'tsStereo', { destinationChannel: 'both' }), 320,
  { viewMode: 'wiring', theme: 'dark' })
assert.ok(rightOnly.calls.some((call) => call[0] === 'setFillStyle' && call[1] === '#bb9bff'),
  'fixed 1-to-2 mono routing draws the right input with its right-channel color')
assert.ok(split.height > getDiagramHeight(320, basic), 'multiple fan-out rows grow diagram height')
const splitConnectors = render(splitBoth, 320, { viewMode: 'connectors', theme: 'dark' })
const splitAreas = getWiringHitAreas(splitBoth, 320, splitConnectors.height, { viewMode: 'connectors' })
assert.strictEqual(splitAreas.length, 6)
assert.ok(splitAreas.every((area) => area.height >= 44 && area.top + area.height <= splitConnectors.height))
const splitSolder = render(splitBoth, 272, { viewMode: 'connectors', face: 'solder', theme: 'light' })
const splitSolderTextCalls = splitSolder.calls.filter((call) => call[0] === 'fillText')
const solderNoteStart = splitSolderTextCalls.findIndex((call) => String(call[1]).startsWith('XLR焊接面'))
const lastMappingCall = splitSolderTextCalls[solderNoteStart - 1]
assert.ok(lastMappingCall && solderNoteStart > 0)
const solderNoteCalls = splitSolderTextCalls.slice(solderNoteStart)
const solderNote = solderNoteCalls.map((call) => String(call[1])).join('')
assert.strictEqual(solderNote,
  'XLR焊接面为插接面左右镜像，定位朝上。 TRS/TS焊片随型号而异，按 T/R/S 标记确认。')
assert.ok(solderNoteCalls.some((call) => String(call[1]).includes('TRS/TS')),
  'TRS/TS remains a single word across solder-note wrapping')
assert.strictEqual(solderNoteCalls[0][3] - lastMappingCall[3], 22,
  'solder note baseline follows the final mapping baseline with the intended gap')
assert.strictEqual(splitSolder.height, solderNoteCalls[0][3] + ((solderNoteCalls.length - 1) * 16) + 24,
  'diagram height reserves the same solder-note position and line count as drawing')

// Legacy open-pin rendering is tested independently; production stereo-to-mono keeps both channels.
const oneChannel = legacyOpenStereoFixture('tsMono')
assert.strictEqual(oneChannel.unconnectedPins.length, 1)
assert.strictEqual(oneChannel.unconnectedPins[0].pin, 'R')
assert.ok(!oneChannel.connections.some((wire) => wire.fromPin === 'R'), 'the synthetic legacy fixture leaves R unconnected')
const oneChannelView = render(oneChannel, 320, { viewMode: 'wiring', theme: 'light' })
assert.ok(oneChannelView.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('悬空')),
  'legacy synthetic fixture still exercises open-pin rendering')
const fixedStereoModel = getWiringModel('stereo35', 'xlrBalanced', { sourceChannel: 'right' })
const fixedStereoSolder = render(fixedStereoModel, 320,
  { layout: 'solder-wiring', avoidRail: false, theme: 'light' })
assert.strictEqual(fixedStereoSolder.metrics.output.photoBoxes.length, 1,
  'the fixed stereo source appears as one physical connector head')
assert.strictEqual(fixedStereoSolder.metrics.output.anchors.get('T').label, 'T L')
assert.strictEqual(fixedStereoSolder.metrics.output.anchors.get('R').label, 'R R',
  'the fixed stereo-to-balanced diagram labels its physical source contacts and functions')
assert(fixedStereoSolder.metrics.connectionAnchors.some((wire) => wire.connection.fromPin === 'R'),
  'the selected right-channel R contact remains connected in the fixed mapping')
assert.deepStrictEqual(fixedStereoSolder.metrics.input.photoBoxes.map((box) => box.key), ['L', 'R'])
assert.strictEqual(fixedStereoSolder.metrics.connectionAnchors.length, 6)
assert.deepStrictEqual(fixedStereoSolder.metrics.connectionAnchors.map((wire) => [wire.connection.fromPin, wire.connection.toPin]),
  fixedStereoModel.connections.map((wire) => [wire.fromPin, wire.toPin]),
  'each physical wire retains its exact source and destination model pins')

const xlrModel = getWiringModel('xlrBalanced', 'xlrBalanced')
const xlrSolder = render(xlrModel, 320, { layout: 'solder-wiring', theme: 'light' })
const xlrSolderWithPhotos = render(xlrModel, 320,
  { layout: 'solder-wiring', theme: 'light', photos: photosFor(xlrModel) })
assert.strictEqual(getConnectorOverviewPhotoSpec(xlrModel.output).path,
  '/pages/audio-wiring/assets/overview/xlr-female-v1.png', 'the output overview follows the cable female gender')
assert.strictEqual(getConnectorOverviewPhotoSpec(xlrModel.input).path,
  '/assets/home/module-audio-wiring-catalog.png', 'the input overview reuses the existing XLR male catalog image')
;[null, {}, { id: 'unknown' }, { id: 'constructor' }, { id: 'toString' }, { id: '__proto__' }, { id: 7 }]
  .forEach((endpoint) => assert.strictEqual(getConnectorOverviewPhotoSpec(endpoint), null,
    'unknown and inherited property names cannot resolve as connector overview specs'))
const photoDrawCalls = xlrSolderWithPhotos.calls.filter((call) => call[0] === 'drawImage')
assert.strictEqual(photoDrawCalls.length, 2, 'each XLR physical head has one complete opened solder-side photo')
assert.strictEqual(xlrSolderWithPhotos.calls.filter((call) => call[0] === 'clip').length, 0,
  'the complete XLR photos are not cropped or clipped into a second detail view')
photoDrawCalls.forEach((call) => {
  assert.strictEqual(call.length, 6, 'the complete source photo is drawn with the portable 5-argument API')
})
assert.strictEqual(xlrSolderWithPhotos.metrics.output.photoBoxes.length, 1)
assert.strictEqual(xlrSolderWithPhotos.metrics.input.photoBoxes.length, 1)
assertCompleteEndpointPhotos(xlrSolderWithPhotos.metrics, 'XLR pair')
assert(!xlrSolderWithPhotos.calls.some((call) => call[0] === 'fillText'
  && ['接头外形', '↓ 焊接面 · 局部'].includes(call[1])),
'the wiring canvas does not repeat a separate full-head overview beside its complete opened image')
const numberedPins = xlrSolderWithPhotos.calls.filter((call) => call[0] === 'fillText' && ['1', '2', '3'].includes(call[1]))
assert(numberedPins.length === 0,
  'XLR contact labels pair pin numbers with their signal functions on the complete photos')
const xlrPhotoBoxes = [...xlrSolderWithPhotos.metrics.output.photoBoxes, ...xlrSolderWithPhotos.metrics.input.photoBoxes]
const xlrPhotoContactCalls = xlrSolderWithPhotos.calls.filter((call) => call[0] === 'fillText'
  && ['1 G', '2 +', '3 −'].includes(call[1])
  && xlrPhotoBoxes.some((box) => call[2] >= box.x && call[2] <= box.x + box.width
    && call[3] >= box.y && call[3] <= box.y + box.height))
assert.strictEqual(xlrPhotoContactCalls.length, 6,
  'XLR complete photos show each physical pin number with its signal function')
assert(xlrPhotoContactCalls.every((call) => {
  const index = xlrSolderWithPhotos.calls.indexOf(call)
  return xlrSolderWithPhotos.calls[index - 1]?.[0] === 'font'
    && xlrSolderWithPhotos.calls[index - 1]?.[1] === '700 9px sans-serif'
}), 'connected XLR contact/function labels keep the existing readable 9px treatment')
const mixedDualModel = getWiringModel('stereo35', 'rcaStereo')
const mixedDual = render(mixedDualModel, 274,
  { layout: 'solder-wiring', avoidRail: false, theme: 'light', photos: photosFor(mixedDualModel) })
const mixedDualImages = mixedDual.calls.filter((call) => call[0] === 'drawImage')
const singleBox = mixedDual.metrics.output.photoBoxes[0]
const dualBoxes = mixedDual.metrics.input.photoBoxes
const singleCenterY = singleBox.y + (singleBox.size / 2)
const dualCenterY = dualBoxes.reduce((sum, box) => sum + box.y + (box.size / 2), 0) / dualBoxes.length
assert.strictEqual(singleCenterY, dualCenterY,
  'single output photo aligns to the actual vertical center of the two input photos')

const phoneWidthDiagram = render(xlrModel, 274,
  { layout: 'solder-wiring', avoidRail: false, theme: 'dark', photos: photosFor(xlrModel) })
assertCompleteEndpointPhotos(phoneWidthDiagram.metrics, '274px XLR pair')

const selectedConnection = xlrModel.connections[1]
const routeGroupsFrom = routeStrokeGroups
const routeStyle = (group) => ({
  color: group.find((call) => call[0] === 'setStrokeStyle')[1],
  width: group.find((call) => call[0] === 'setLineWidth')[1],
  path: group.filter((call) => ['moveTo', 'lineTo'].includes(call[0])),
})
;['light', 'dark'].forEach((theme) => {
  const options = { layout: 'solder-wiring', theme, photos: photosFor(xlrModel) }
  const baseline = render(xlrModel, 320, { ...options, selectedId: '' })
  const highlighted = render(xlrModel, 320, { ...options, selectedId: selectedConnection.id })
  assert.strictEqual(highlighted.height, baseline.height, 'selection does not alter solder diagram height')
  assert.deepStrictEqual(highlighted.metrics.connectionAnchors, baseline.metrics.connectionAnchors,
    'selection does not alter cached route geometry')
  assert.deepStrictEqual(
    getWiringHitAreas(xlrModel, 320, highlighted.height, { ...options, selectedId: selectedConnection.id }),
    getWiringHitAreas(xlrModel, 320, baseline.height, { ...options, selectedId: '' }),
    'selection does not alter connection hit areas')

  const baselineRoutes = routeGroupsFrom(baseline.calls)
  const selectedRoutes = routeGroupsFrom(highlighted.calls)
  assert.strictEqual(baselineRoutes.length, xlrModel.connections.length)
  assert.strictEqual(selectedRoutes.length, xlrModel.connections.length)
  assert(baselineRoutes.every((route) => routeStyle(route).width === 2.3),
    'normal connection strokes keep their 2.3px width')
  assertDrawnRoutesMatch(baseline.calls, baseline.metrics.connectionAnchors, 'normal XLR routes')
  const outputPinPoint = highlighted.metrics.output.anchors.get(String(selectedConnection.fromPin))
  const inputPinPoint = highlighted.metrics.input.anchors.get(String(selectedConnection.toPin))
  const selectedGeometry = highlighted.metrics.connectionAnchors.find((item) => item.id === selectedConnection.id)
  assert(selectedGeometry, 'selected connection keeps its physical photo-to-photo geometry')
  assertPointObjectMatches(selectedGeometry.from, outputPinPoint,
    'selected wire starts at its actual photographed output weld pin')
  assertPointObjectMatches(selectedGeometry.to, inputPinPoint,
    'selected wire ends at its actual photographed input weld pin')
  assert.strictEqual(selectedGeometry.connection.fromPin, selectedConnection.fromPin)
  assert.strictEqual(selectedGeometry.connection.toPin, selectedConnection.toPin)
  const selectedPath = routePathFromPoints(selectedGeometry.points)
  const pathKey = (route) => JSON.stringify(routeStyle(route).path)
  const selectedPathKey = JSON.stringify(selectedPath)
  const baselineSelectedIndex = baselineRoutes.findIndex((route) => pathKey(route) === selectedPathKey)
  assert(baselineSelectedIndex >= 0, 'normal diagram draws the same actual path that selection will emphasize')
  const selectedInk = selectedRoutes.at(-1)
  assert.deepStrictEqual(routeStyle(selectedInk).path, selectedPath,
    'the selected wire remains the complete actual photo-to-photo polyline')
  assert.strictEqual(routeStyle(selectedInk).color, routeStyle(baselineRoutes[baselineSelectedIndex]).color,
    'the selected wire keeps its original semantic color')
  assert.strictEqual(routeStyle(selectedInk).width, 5.8,
    'the selected wire is visibly thicker and is drawn last')
  const unselectedInk = selectedRoutes.slice(0, -1)
  assert(unselectedInk.every((route) => routeStyle(route).width === 1.6),
    'every other connection is reduced to the 1.6px underlay')
  assert.deepStrictEqual(
    unselectedInk.map((route) => [pathKey(route), routeStyle(route).color]).sort((a, b) => a[0].localeCompare(b[0])),
    baselineRoutes.filter((_, index) => index !== baselineSelectedIndex)
      .map((route) => [pathKey(route), routeStyle(route).color]).sort((a, b) => a[0].localeCompare(b[0])),
    'unselected wires keep their own semantic colors while selection changes only their width')
  assert.deepStrictEqual(unselectedInk.map(pathKey).sort(),
    baselineRoutes.filter((_, index) => index !== baselineSelectedIndex).map(pathKey).sort(),
    'unselected wires retain their exact complete polylines')
  const selectedRings = highlighted.calls.filter((call) => call[0] === 'arc' && call[3] === 5)
  assert.strictEqual(selectedRings.length, 2, 'selection adds one small ring at each actual photo weld point')
  ;[[outputPinPoint, selectedConnection.fromPin], [inputPinPoint, selectedConnection.toPin]].forEach(([point, pin]) => {
    assert(selectedRings.some((call) => call[1] === point.x && call[2] === point.y),
      `selected wire ring sits at its actual ${pin} anchor`)
    const ringIndex = highlighted.calls.findIndex((call) => call[0] === 'arc'
      && call[1] === point.x && call[2] === point.y && call[3] === 5)
    assert(point.labelRect && Number.isFinite(point.labelRect.textX) && Number.isFinite(point.labelRect.textY),
      `selected ${pin} weld has its physical-photo label rectangle`)
    const expectedLabel = point.labelRect.label || point.label
    const labelIndex = highlighted.calls.findIndex((call) => call[0] === 'fillText'
      && String(call[1]) === String(expectedLabel)
      && Math.abs(call[2] - point.labelRect.textX) < 0.01
      && Math.abs(call[3] - point.labelRect.textY) < 0.01)
    assert(ringIndex >= 0 && labelIndex > ringIndex,
      `the selected ${pin} photo label is drawn after the weld highlight ring`)
  })

  const invalid = render(xlrModel, 320, { ...options, selectedId: 'missing-connection' })
  assert.deepStrictEqual(routeGroupsFrom(invalid.calls).map(routeStyle), baselineRoutes.map(routeStyle),
    'an invalid selection restores the original colors, widths, ordering, and polylines')
  assert.strictEqual(invalid.calls.filter((call) => call[0] === 'arc' && call[3] === 5).length, 0)

  const report = recorder()
  const reportOptions = { ...options, compact: true, selectedId: selectedConnection.id, scale: 1 }
  const reportHeight = getReportHeight(720, xlrModel, reportOptions)
  drawWiringReport(report.ctx, xlrModel, 720, reportHeight, reportOptions)
  assert.strictEqual(routeGroupsFrom(report.calls).at(-1).find((call) => call[0] === 'setLineWidth')[1], 5.8,
    'share reports draw the same selected wire last with the same width')
})
const selectedSolderText = render(xlrModel, 320,
  { layout: 'solder-wiring', selectedId: selectedConnection.id, theme: 'light' }).calls
assert(selectedSolderText.some((call) => call[0] === 'setLineWidth' && call[1] === 5.8),
  'selected wire state is drawn without requiring a photo object')

const stereo35ToDualRca = getWiringModel('stereo35', 'rcaMono')
const stereo35RightSignal = stereo35ToDualRca.connections.find((connection) => connection.id === 'right-signal')
;[274, 319, 369].forEach((width) => ['light', 'dark'].forEach((theme) => {
  const diagram = render(stereo35ToDualRca, width, {
    layout: 'solder-wiring', avoidRail: false, theme, selectedId: stereo35RightSignal.id,
    photos: photosFor(stereo35ToDualRca),
  })
  const tPoint = diagram.metrics.output.anchors.get('T')
  const rPoint = diagram.metrics.output.anchors.get('R')
  assert.strictEqual(tPoint.label, 'T L',
    `stereo35 photo identifies its T contact as left-channel L at ${width}px ${theme}`)
  const labelRect = tPoint.labelRect
  assert(labelRect && labelRect.width > 0 && labelRect.height > 0,
    `stereo35 T label has visible photo bounds at ${width}px ${theme}`)
  const tLabelIndex = diagram.calls.findIndex((call) => call[0] === 'fillText' && call[1] === 'T L'
    && Math.abs(call[2] - labelRect.textX) < 0.01 && Math.abs(call[3] - labelRect.textY) < 0.01)
  assert(tLabelIndex >= 0,
    `stereo35 T L function label is drawn at the actual photo label position at ${width}px ${theme}`)
  const nearestX = Math.max(labelRect.x, Math.min(rPoint.x, labelRect.x + labelRect.width))
  const nearestY = Math.max(labelRect.y, Math.min(rPoint.y, labelRect.y + labelRect.height))
  assert(Math.hypot(rPoint.x - nearestX, rPoint.y - nearestY) >= 6 - 1e-6,
    `stereo35 T L label clears the neighboring R weld point and its 5px highlight ring at ${width}px ${theme}`)
}))

const terminalSplitModel = getWiringModel('terminalBalanced', 'rcaStereo', {
  outputMode: 'coldReturn', destinationChannel: 'both',
})
assert.ok(terminalSplitModel.supported, 'terminal to dual RCA fixture uses explicit supported conditions')
;['rcaStereo', 'tsStereo'].forEach((inputId) => {
  const model = getWiringModel('terminalBalanced', inputId, {
    outputMode: 'coldReturn', destinationChannel: 'both',
  })
  assert.strictEqual(model.status, 'ready', `terminal → ${inputId} is a supported three-column case`)
  const diagram = render(model, 274, {
    layout: 'solder-wiring', avoidRail: false, theme: 'dark', photos: photosFor(model),
  })
  assert.strictEqual(diagram.metrics.gallery.heads.length, 3,
    `terminal → ${inputId} shows one output and two physical input heads`)
  const terminal = diagram.metrics.output
  assert.strictEqual(terminal.photoSpec.kind, 'terminal')
  ;['+', '−', 'G'].forEach((pin) => {
    const point = terminal.anchors.get(pin)
    const rect = point.labelRect
    assert(rect && rect.label === pin, `${inputId} terminal photo keeps its ${pin} label`)
    assert.strictEqual(rect.width, 14, `${inputId} terminal ${pin} badge retains its 14px width`)
    assert.strictEqual(rect.height, 14, `${inputId} terminal ${pin} badge retains its 14px height`)
    terminal.anchors.forEach((other) => {
      const nearestX = Math.max(rect.x, Math.min(other.x, rect.x + rect.width))
      const nearestY = Math.max(rect.y, Math.min(other.y, rect.y + rect.height))
      assert(Math.hypot(other.x - nearestX, other.y - nearestY) >= 6 - 1e-6,
        `${inputId} terminal ${pin} badge clears its own and neighboring actual weld points`)
    })
  })
})
const terminalOriginHeight = getDiagramHeight(720, terminalSplitModel, { layout: 'solder-wiring' })
const terminalOriginCanvas = recorder()
const terminalOriginMetrics = drawWiringDiagram(terminalOriginCanvas.ctx, terminalSplitModel, 720, terminalOriginHeight, {
  layout: 'solder-wiring', x: 180, y: 20, photos: photosFor(terminalSplitModel),
})
assertTerminalCaptionDrawn(terminalOriginCanvas.calls, terminalOriginMetrics.output.terminalCaption,
  'terminal-origin canvas', 180, 20)
const terminalLabels = terminalOriginCanvas.calls.filter((call) => call[0] === 'fillText' && ['+', '−', 'G'].includes(call[1]))
assert.ok(terminalLabels.length >= 3 && terminalLabels.every((call) => call[2] > 180),
  'terminal photo labels include the diagram origin when drawing a shared report canvas')
const relativeLuminance = (color) => {
  assert(/^#[0-9a-f]{6}$/i.test(color), `terminal badge color ${color} is an opaque six-digit color`)
  const components = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return (components[0] * 0.2126) + (components[1] * 0.7152) + (components[2] * 0.0722)
}
;['light', 'dark'].forEach((theme) => {
  const diagram = render(terminalSplitModel, 320, {
    layout: 'solder-wiring', avoidRail: false, theme, photos: photosFor(terminalSplitModel),
  })
  const background = diagram.calls.find((call) => call[0] === 'setFillStyle')[1]
  const backgroundLuminance = relativeLuminance(background)
  ;['+', '−', 'G'].forEach((pin) => {
    const point = diagram.metrics.output.anchors.get(pin)
    const rect = point.labelRect
    const label = rect.label || point.label
    const labelIndex = diagram.calls.findIndex((call) => call[0] === 'fillText' && call[1] === label
      && Math.abs(call[2] - rect.textX) < 0.01 && Math.abs(call[3] - rect.textY) < 0.01)
    assert(labelIndex >= 0, `${theme} terminal ${pin} photo label is present`)
    const textColor = diagram.calls[labelIndex][4]
    const textLuminance = relativeLuminance(textColor)
    const contrast = (Math.max(backgroundLuminance, textLuminance) + 0.05)
      / (Math.min(backgroundLuminance, textLuminance) + 0.05)
    assert(contrast >= 4.5, `${theme} terminal ${pin} label has strong text contrast`)
    let fillIndex = labelIndex - 1
    while (fillIndex >= 0 && diagram.calls[fillIndex][0] !== 'fill') fillIndex -= 1
    assert(fillIndex > 0 && diagram.calls[fillIndex - 1][0] === 'setFillStyle'
      && diagram.calls[fillIndex - 1][1] === background,
    `${theme} terminal ${pin} label has a solid theme-background badge`)
    const badge = closedPathBounds(diagram.calls.slice(0, fillIndex)).at(-1)
    assert(badge && Math.abs(badge.left - rect.x) < 0.01 && Math.abs(badge.right - rect.x - rect.width) < 0.01
      && Math.abs(badge.top - rect.y) < 0.01 && Math.abs(badge.bottom - rect.y - rect.height) < 0.01,
    `${theme} terminal ${pin} badge bounds match the physical-photo label rectangle`)
  })
})
const terminalPageDiagram = render(terminalSplitModel, 274, {
  layout: 'solder-wiring', avoidRail: false, theme: 'light', photos: photosFor(terminalSplitModel),
})
const terminalCaption = terminalPageDiagram.metrics.output.terminalCaption
assertTerminalCaptionDrawn(terminalPageDiagram.calls, terminalCaption, '274px terminal page')
const terminalCaptionLastBaseline = terminalCaption.y + ((terminalCaption.lines.length - 1) * terminalCaption.size * 1.35)
assert(terminalCaption && terminalPageDiagram.height >= terminalCaptionLastBaseline + 15,
  'terminal caption and its lower padding are inside the page diagram canvas')
;[216, 274, 319].forEach((width) => {
  const diagram = render(terminalSplitModel, width, {
    layout: 'solder-wiring', avoidRail: false, theme: 'dark', photos: photosFor(terminalSplitModel),
  })
  const caption = diagram.metrics.output.terminalCaption
  assert(caption && caption.lines.length > 0, `terminal → dual RCA keeps its caption at ${width}px`)
  assertTerminalCaptionDrawn(diagram.calls, caption, `terminal → dual RCA at ${width}px`)
  if (width === 216) assert(caption.lines.length > 1,
    'the 216px terminal-to-RCA case exercises a wrapped multi-line terminal caption')
  assert(caption.rect.y >= 0 && caption.rect.y + caption.rect.height <= diagram.height,
    `the ${width}px terminal caption stays fully inside the Canvas`)
  assertRoutesAvoidTerminalCaptions(diagram.metrics.connectionAnchors,
    [diagram.metrics.output, diagram.metrics.input], `terminal → dual RCA at ${width}px`)
  assertRoutePolylinesDoNotCross(diagram.metrics.connectionAnchors,
    `terminal → dual RCA at ${width}px`)
  assertDrawnRoutesMatch(diagram.calls, diagram.metrics.connectionAnchors,
    `terminal → dual RCA drawn strokes at ${width}px`)
})
const terminalCompactReport = recorder()
const terminalCompactOptions = { layout: 'solder-wiring', compact: true, theme: 'light', photos: photosFor(terminalSplitModel) }
const terminalCompactHeight = getReportHeight(720, terminalSplitModel, terminalCompactOptions)
drawWiringReport(terminalCompactReport.ctx, terminalSplitModel, 720, terminalCompactHeight, terminalCompactOptions)
const terminalCompactTexts = terminalCompactReport.calls.filter((call) => call[0] === 'fillText')
const compactTerminalCaptionStart = terminalCompactTexts.findIndex((call) =>
  String(call[1]).includes('端子示意顺序'))
assert(compactTerminalCaptionStart >= 0, 'compact report retains the terminal photo caption')
const compactTerminalCaptionLines = []
let compactTerminalCaptionText = ''
for (let index = compactTerminalCaptionStart; index < terminalCompactTexts.length; index += 1) {
  compactTerminalCaptionLines.push(terminalCompactTexts[index])
  compactTerminalCaptionText += String(terminalCompactTexts[index][1])
  if (compactTerminalCaptionText.includes('端子示意顺序，按设备丝印')) break
}
assert(compactTerminalCaptionText.includes('端子示意顺序，按设备丝印'),
  'compact report keeps the complete terminal caption across its drawn lines')
const compactTerminalGuide = terminalCompactTexts.find((call) => String(call[1]).includes('冷端') && String(call[1]).includes('汇接'))
assert(compactTerminalGuide && compactTerminalCaptionLines.length > 0
  && compactTerminalGuide[3] > compactTerminalCaptionLines.at(-1)[3] + 15,
'compact guide begins below the final line of the fully visible terminal caption')

const xlrRouteGroups = strokeCallGroups(xlrSolder.calls).filter((group) =>
  group.some((call) => call[0] === 'setLineWidth' && [1.6, 2.3, 5.8].includes(call[1])) &&
  group.some((call) => call[0] === 'moveTo') && group.some((call) => call[0] === 'lineTo'))
assert.strictEqual(xlrRouteGroups.length, xlrModel.connections.length,
  'each connection keeps one stroke operation for its complete polyline')
xlrRouteGroups.forEach((group) => {
  const moveCount = group.filter((call) => call[0] === 'moveTo').length
  assert.strictEqual(moveCount, 1, 'each connection path remains continuous across every segment')
})
const crossingCase = render(getWiringModel('stereo35', 'rcaStereo'), 320,
  { layout: 'solder-wiring', avoidRail: false, theme: 'light' })
const crossingRouteGroups = strokeCallGroups(crossingCase.calls).filter((group) =>
  group.some((call) => call[0] === 'setLineWidth' && [1.6, 2.3, 5.8].includes(call[1])) &&
  group.some((call) => call[0] === 'moveTo') && group.some((call) => call[0] === 'lineTo'))
assert.strictEqual(crossingRouteGroups.length, crossingCase.metrics.connectionAnchors.length)
assertRoutePolylinesDoNotCross(crossingCase.metrics.connectionAnchors, 'stereo35 to dual RCA')
assertDrawnRoutesMatch(crossingCase.calls, crossingCase.metrics.connectionAnchors, 'stereo35 to dual RCA')
assertNoUndefinedOrNaNText(crossingCase.calls, 'stereo35 to dual RCA photo rendering')
assert.ok(xlrSolder.calls.some((call) => call[0] === 'fillText' && call[1] === 'XLR 母头'),
  'solder photo heading identifies the output cable connector as female')
assert.ok(xlrSolder.calls.some((call) => call[0] === 'fillText' && call[1] === 'XLR 公头'),
  'solder photo heading identifies the input cable connector as male')
const rcaPhoto = getSolderPhotoSpec(getWiringModel('rcaMono', 'rcaMono').output)
assert.deepStrictEqual(rcaPhoto.contentRect, { x: 0, y: 0, width: rcaPhoto.width, height: rcaPhoto.height },
  'RCA solder view keeps the full connector object, including its insertion pin')
assert.strictEqual(rcaPhoto.width / rcaPhoto.height, 512 / 972,
  'RCA complete photo retains its actual tall image proportions')
;['core', 'shell'].forEach((key) => {
  const point = rcaPhoto.pinPoints[key]
  const px = point.x * rcaPhoto.width, py = point.y * rcaPhoto.height
  assert(px >= 0 && px <= rcaPhoto.width && py >= 0 && py <= rcaPhoto.height,
    `RCA ${key} anchor remains inside the complete connector photo`)
})

const compactOptions = { layout: 'solder-wiring', compact: true, viewMode: 'connectors', face: 'solder', theme: 'dark', scale: 2 }
const compactMono = getWiringModel('stereo35', 'tsMono')
const compactHeight = getReportHeight(720, compactMono, compactOptions)
const compactReport = recorder()
const compactResult = drawWiringReport(compactReport.ctx, compactMono, 720, compactHeight, compactOptions)
assert.strictEqual(compactResult.height, compactHeight)
assertBounds(compactReport.calls, 720, compactHeight)
const compactText = compactReport.calls.filter((call) => call[0] === 'fillText')
  .map((call) => String(call[1])).join('').replace(/\s/g, '')
assert(compactText.includes('接线参考·焊接端示意'))
assert(!compactText.includes('R·未接'), 'the split stereo diagram keeps R connected to its own head')
assert(!compactText.includes('悬空不接') && !compactText.includes('未连接触点') && !compactText.includes('结果性质'),
  'compact solder report avoids a second long open-pin section and result nature')
assert(compactText.includes('端口、针位以设备丝印和手册为准'))
assert(compactText.includes('T（L）接L信号，R接R信号；S接两头回路。'),
  'compact share reuses the short on-page guide for fixed mono selection')
compactMono.connections.forEach((connection) => assert(compactText.includes(
  `${connection.fromLabel}→${connection.toLabel}`.replace(/\s/g, '')),
`compact share preserves the complete line mapping ${connection.id}`))
compactMono.selectionSummary.forEach((summary) => assert(!compactText.includes(summary.replace(/\s/g, '')),
  `compact solder report does not repeat the selection summary: ${summary}`))
compactMono.criticalNotes.forEach((note) => assert(!compactText.includes(note.replace(/\s/g, '')),
  `compact solder report uses concise conditions instead of the long critical note: ${note}`))
assert(!compactText.includes(compactMono.cableSummary.replace(/\s/g, '')),
  'compact share avoids repeating the cable summary already implied by the image')
assert.strictEqual(getWiringGuide(compactMono), 'T（L）接 L 信号，R 接 R 信号；S 接两头回路。',
  'page and compact share use the same short fixed-channel guide')
const stereo35CompactModel = getWiringModel('stereo35', 'stereo35')
const stereo35CompactHeight = getReportHeight(640, stereo35CompactModel, compactOptions)
const stereo35CompactCanvas = recorder()
drawWiringReport(stereo35CompactCanvas.ctx, stereo35CompactModel, 640, stereo35CompactHeight, compactOptions)
const stereo35CompactText = stereo35CompactCanvas.calls.filter((call) => call[0] === 'fillText')
  .map((call) => String(call[1])).join('').replace(/\s/g, '')
assert(stereo35CompactText.includes('输出端：3.5mm立体声输出')
  && stereo35CompactText.includes('输入端：3.5mm立体声输入'),
'compact share names both 3.5 mm stereo endpoints without the ambiguous TRS title')
assert.strictEqual(getWiringGuide(getWiringModel('stereo35', 'xlrBalanced')),
  'T（L）→ L+、R → R+；S 接两头 −/G，源信号仍非平衡。',
  'balanced dual-head guidance says both source channels remain unbalanced')
const compactDual = getWiringModel('xlrBalanced', 'rcaStereo', {
  outputMode: 'coldReturn', destinationChannel: 'both',
})
assert.deepStrictEqual(getCompactWiringConditions(compactDual), [
  '仅在两台设备手册允许时施工。',
  '仅接两路独立高阻 LINE 输入；核对并联负载。',
], 'compact share keeps the two applicable safety conditions in short form')
const compactDualReport = recorder()
const compactDualHeight = getReportHeight(720, compactDual, { ...compactOptions, scale: 1 })
drawWiringReport(compactDualReport.ctx, compactDual, 720, compactDualHeight,
  { ...compactOptions, scale: 1 })
const compactDualText = compactDualReport.calls.filter((call) => call[0] === 'fillText')
  .map((call) => String(call[1])).join('').replace(/\s/g, '')
assert(compactDualText.includes('冷端−与屏蔽在输入端汇接，再分送L/R。')
  && compactDualText.includes('仅在两台设备手册允许时施工。')
  && compactDualText.includes('仅接两路独立高阻LINE输入；核对并联负载。'),
'compact dual share combines the shared short guide with the relevant conditions')
assert(!compactDual.criticalNotes.some((note) => compactDualText.includes(note.replace(/\s/g, '')))
  && !compactDual.selectionSummary.some((summary) => compactDualText.includes(summary.replace(/\s/g, ''))),
'compact share does not repeat verbose condition or selection summaries')
assert(!compactText.includes('参考与适用边界')
  && !oneChannel.sources.some((source) => compactText.includes(source.title.replace(/\s/g, ''))),
'compact solder report omits the long source section')

// Fixed cold-return conditions remain visible in the full drawing/report.
const fixedColdReturn = getWiringModel('xlrBalanced', 'rcaMono')
assert.strictEqual(fixedColdReturn.status, 'ready')
assert.ok(fixedColdReturn.criticalNotes.some((note) => note.includes('手册明确允许')))
assert.ok(getCompactWiringConditions(fixedColdReturn).some((condition) => condition.includes('设备手册允许')))

const reportOptions = { theme: 'dark', scale: 2 }
const reportModel = { ...splitBoth, sources: splitBoth.sources.concat([
  { title: 'SOURCE: Neutrik connector drawing reference, not equipment specific proof.' },
  { title: '中文标题测试：十个汉字用来检查，标点不要跑到新行。' },
]) }
const reportHeight = getReportHeight(750, reportModel, reportOptions)
const report = recorder()
const reportResult = drawWiringReport(report.ctx, reportModel, 750, reportHeight, reportOptions)
assert.strictEqual(reportResult.height, reportHeight)
assertBounds(report.calls, 750, reportHeight)
const reportText = report.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1])).join('\n')
const reportWithoutWraps = reportText.replace(/\n/g, '')
splitBoth.selectionSummary.concat(splitBoth.criticalNotes).forEach((note) => {
  assert.ok(reportWithoutWraps.includes(note), `report includes complete condition: ${note}`)
})
assert.ok(reportText.includes('冷端') && reportText.includes('汇接'))
assert.ok(!/冷端.{0,8}悬空/.test(reportWithoutWraps), 'report does not mention the retired cold-open wiring')
assert.ok(reportText.includes('参考与适用边界'))
const reportLines = report.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]))
const sourceStart = reportLines.findIndex((value) => value.startsWith('SOURCE:'))
assert.ok(sourceStart >= 0)
const customSourceLines = []
for (let index = sourceStart; index < reportLines.length &&
  !reportLines[index].startsWith('中文标题测试'); index += 1) customSourceLines.push(reportLines[index])
assert.ok(customSourceLines.join('').includes('connector drawing reference'))
assert.ok(customSourceLines.slice(0, -1).every((value) => value.endsWith(' ')),
  'long English source words wrap at spaces')
assert.ok(reportLines.some((value) => value.includes('，')))
assert.ok(!reportLines.some((value) => /^[，。；：、！？）》】〕〉”’」』…％]/.test(value)),
  'Chinese closing punctuation does not start a wrapped line')

const reportViewModel = getWiringModel('stereo35', 'xlrBalanced', { sourceChannel: 'left' })
const selectedReportConnectionId = reportViewModel.connections[0].id
;[
  { viewMode: 'wiring', face: 'mating', label: '当前视角：连线图' },
  { viewMode: 'connectors', face: 'mating', label: '接头视角 · 插接面' },
  { viewMode: 'connectors', face: 'solder', label: '接头视角 · 焊接面' },
].forEach(({ viewMode, face, label }) => {
  const options = { viewMode, face, selectedId: selectedReportConnectionId, theme: 'dark', scale: 2 }
  const height = getReportHeight(640, reportViewModel, options)
  const canvas = recorder()
  const result = drawWiringReport(canvas.ctx, reportViewModel, 640, height, options)
  assert.strictEqual(result.height, height, `${label} report height matches drawing`)
  assertBounds(canvas.calls, 640, height)
  const lines = canvas.calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]))
  const text = lines.join('').replace(/\s/g, '')
  assert(text.includes(label.replace(/\s/g, '')), `report identifies ${label}`)
  assert(!text.includes('悬空不接：输出R'), 'report does not mark the now-connected right channel as open')
  assert(text.includes('右声道R'), 'report keeps the right stereo channel in its connections')
  reportViewModel.connections.forEach((connection) => {
    assert(text.includes(connection.fromLabel.replace(/\s/g, '')))
    assert(text.includes(connection.toLabel.replace(/\s/g, '')))
  })
  assert(canvas.calls.some((call) => call[0] === 'setLineWidth' && call[1] === 4),
    'report view retains the selected-connection highlight')
})

console.log('audio wiring renderer regression passed')

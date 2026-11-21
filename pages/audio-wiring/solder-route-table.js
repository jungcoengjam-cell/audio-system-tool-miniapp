const solderRouteTable = require('./solder-route-table-data')

const MODEL_CONNECTION_FIELDS = [
  'id', 'fromPin', 'toPin', 'fromSide', 'toSide', 'fromLabel', 'toLabel',
  'fromRole', 'toRole', 'label', 'networkId',
]

function dataValue(object, key) {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) {
    throw new Error('Solder route geometry is incomplete')
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    throw new Error('Solder route geometry is incomplete')
  }
  return descriptor.value
}

function optionalValue(object, key) {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor) return undefined
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('Solder route geometry is incomplete')
  return typeof descriptor.value === 'number' ? Number(descriptor.value.toFixed(6)) : descriptor.value
}

function plainSnapshot(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value
  if (typeof value === 'number') return Number(value.toFixed(6))
  if (typeof value === 'undefined') return null
  if (typeof value !== 'object' || seen.has(value)) throw new Error('Solder route geometry is incomplete')
  seen.add(value)
  let snapshot
  if (Array.isArray(value)) {
    snapshot = []
    for (let index = 0; index < value.length; index += 1) snapshot.push(plainSnapshot(dataValue(value, index), seen))
  } else {
    snapshot = {}
    Object.keys(value).sort().forEach((key) => { snapshot[key] = plainSnapshot(dataValue(value, key), seen) })
  }
  seen.delete(value)
  return snapshot
}

function compareText(a, b) {
  const left = String(a), right = String(b)
  return left < right ? -1 : left > right ? 1 : 0
}

function rectSnapshot(rect) {
  if (!rect) return null
  return ['x', 'y', 'width', 'height', 'textX', 'textY', 'textAnchor', 'label']
    .map((key) => optionalValue(rect, key))
}

function obstacleSnapshot(obstacles) {
  if (!Array.isArray(obstacles)) throw new Error('Solder route geometry is incomplete')
  return obstacles.map((rect) => ['type', 'kind', 'x', 'y', 'width', 'height']
    .map((key) => optionalValue(rect, key)))
}

function connectionSnapshot(connection) {
  return MODEL_CONNECTION_FIELDS.map((key) => optionalValue(connection, key))
}

function endpointSnapshot(layoutEndpoint) {
  const pins = dataValue(layoutEndpoint, 'pins')
  const anchors = dataValue(layoutEndpoint, 'anchors')
  if (!Array.isArray(pins) || !(anchors instanceof Map)) throw new Error('Solder route geometry is incomplete')
  const pinRows = pins.map((pin) => ['pin', 'label', 'role', 'count', 'reason']
    .map((key) => optionalValue(pin, key)))
    .sort((a, b) => compareText(a[0], b[0]))
  const anchorRows = [...anchors.values()].map((anchor) => [
    ...['pin', 'role', 'count', 'side', 'x', 'y', 'label', 'channel', 'photoKey', 'chipWidth', 'chipCenter']
      .map((key) => optionalValue(anchor, key)),
    plainSnapshot(optionalValue(anchor, 'photoPixel')),
    plainSnapshot(optionalValue(anchor, 'routeDirection')),
    rectSnapshot(optionalValue(anchor, 'labelRect')),
  ]).sort((a, b) => compareText(a[0], b[0]))
  const boxes = dataValue(layoutEndpoint, 'photoBoxes')
  if (!Array.isArray(boxes)) throw new Error('Solder route geometry is incomplete')
  const boxRows = boxes.map((box) => [
    ...['key', 'channel', 'x', 'y', 'width', 'height', 'columnX', 'columnWidth']
      .map((key) => optionalValue(box, key)),
    plainSnapshot(optionalValue(box, 'destination')),
  ])
  const obstacleRows = obstacleSnapshot(dataValue(layoutEndpoint, 'obstacles'))
  return [
    ...['side', 'x', 'centerX', 'columnWidth', 'isPhotoEndpoint', 'isDualPhoto', 'rotationDegrees']
      .map((key) => optionalValue(layoutEndpoint, key)),
    plainSnapshot(optionalValue(layoutEndpoint, 'photoSpec')),
    pinRows,
    anchorRows,
    boxRows,
    plainSnapshot(optionalValue(layoutEndpoint, 'channelLabels')),
    plainSnapshot(optionalValue(layoutEndpoint, 'terminalCaption')),
    obstacleRows,
  ]
}

function makeSolderRouteMatchParts(model, layout) {
  const output = dataValue(model, 'output')
  const input = dataValue(model, 'input')
  const connections = dataValue(model, 'connections')
  if (!Array.isArray(connections)) throw new Error('Solder route geometry is incomplete')
  const connectionRows = connections.map(connectionSnapshot)
    .sort((a, b) => compareText(a[0], b[0]))
  const outputLayout = dataValue(layout, 'output')
  const inputLayout = dataValue(layout, 'input')
  const outputObstacles = obstacleSnapshot(dataValue(outputLayout, 'obstacles'))
  const inputObstacles = obstacleSnapshot(dataValue(inputLayout, 'obstacles'))
  if (JSON.stringify(obstacleSnapshot(dataValue(layout, 'obstacles')))
    !== JSON.stringify(outputObstacles.concat(inputObstacles))) throw new Error('Solder route geometry is incomplete')
  return {
    model: JSON.stringify(['solder-route-table-model-v1', plainSnapshot(output), plainSnapshot(input), connectionRows]),
    geometryHeader: JSON.stringify(['solder-route-table-geometry-v1',
      optionalValue(layout, 'contentWidth'), optionalValue(layout, 'maxY'), optionalValue(layout, 'pinClearance')]),
    outputGeometry: JSON.stringify(endpointSnapshot(outputLayout)),
    inputGeometry: JSON.stringify(endpointSnapshot(inputLayout)),
  }
}

function makeSolderRouteMatchSignature(model, layout) {
  const parts = makeSolderRouteMatchParts(model, layout)
  return JSON.stringify([parts.model, parts.geometryHeader, parts.outputGeometry, parts.inputGeometry])
}

function routeAnchor(layoutEndpoint, pin) {
  const anchors = dataValue(layoutEndpoint, 'anchors')
  if (!(anchors instanceof Map)) throw new Error('Solder route geometry is incomplete')
  const anchor = anchors.get(String(pin))
  if (!anchor) return null
  const x = dataValue(anchor, 'x'), y = dataValue(anchor, 'y')
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function lookupSolderRoutes(model, layout) {
  try {
    if (dataValue(model, 'supported') !== true) return null
    const outputId = dataValue(dataValue(model, 'output'), 'id')
    const inputId = dataValue(dataValue(model, 'input'), 'id')
    if (typeof outputId !== 'string' || typeof inputId !== 'string') return null
    const entry = solderRouteTable.entries[JSON.stringify([outputId, inputId])]
    if (!entry) return null
    const parts = makeSolderRouteMatchParts(model, layout)
    if (solderRouteTable.modelSignatures[entry.model] !== parts.model
      || entry.geometryHeader !== parts.geometryHeader
      || solderRouteTable.endpointSignatures[entry.output] !== parts.outputGeometry
      || solderRouteTable.endpointSignatures[entry.input] !== parts.inputGeometry) return null
    const connections = dataValue(model, 'connections')
    if (!Array.isArray(connections) || connections.length !== entry.routes.length) return null
    const routesById = new Map()
    entry.routes.forEach((route) => {
      if (!route || typeof route.id !== 'string' || routesById.has(route.id) || !Array.isArray(route.points)) {
        throw new Error('Invalid solder route table entry')
      }
      routesById.set(route.id, route)
    })
    const routes = connections.map((connection) => {
      const id = dataValue(connection, 'id')
      const fromPin = dataValue(connection, 'fromPin')
      const toPin = dataValue(connection, 'toPin')
      const saved = routesById.get(id)
      const from = routeAnchor(dataValue(layout, 'output'), fromPin)
      const to = routeAnchor(dataValue(layout, 'input'), toPin)
      if (!saved || !from || !to || saved.points.length < 2) throw new Error('Invalid solder route table entry')
      const points = saved.points.map((point) => {
        if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          throw new Error('Invalid solder route table entry')
        }
        return { x: point[0], y: point[1] }
      })
      const near = (a, b) => Math.abs(a - b) <= 1e-6
      if (!near(points[0].x, from.x) || !near(points[0].y, from.y)
        || !near(points[points.length - 1].x, to.x) || !near(points[points.length - 1].y, to.y)) {
        throw new Error('Invalid solder route table endpoints')
      }
      points[0] = { x: from.x, y: from.y }
      points[points.length - 1] = { x: to.x, y: to.y }
      const length = points.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0)
      return { id, connection, fromPin, toPin, from, to, points, length }
    })
    return { routes, error: '' }
  } catch (error) {
    return null
  }
}

module.exports = { lookupSolderRoutes, makeSolderRouteMatchSignature, makeSolderRouteMatchParts }

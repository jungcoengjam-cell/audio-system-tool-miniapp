'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Module = require('module')
const modelApi = require('../pages/audio-wiring/wiring-model')
const { getModelPhotoSpecs } = require('../pages/audio-wiring/wiring-photos')

const rendererPath = require.resolve(path.join(__dirname, '../pages/audio-wiring/wiring-renderer.js'))

function loadInstrumentedRenderer() {
  const source = fs.readFileSync(rendererPath, 'utf8')
  const solverMarker = 'function solveDirectSolderRoutes(model, layout) {'
  const selectMarker = '  const selection = lookupSolderRoutes(model, layout) || solveDirectSolderRoutes(model, layout)'
  assert(source.includes(solverMarker) && source.includes(selectMarker), 'heavy solver instrumentation points remain stable')
  const changed = source
    .replace(solverMarker, `${solverMarker}\n  global.__solderTableHeavySolves += 1`)
    .replace(selectMarker, '  if (global.__solderTableAnchorNudge) { const anchor = layout.output.anchors.values().next().value; anchor.x += global.__solderTableAnchorNudge }\n' + selectMarker)
  const loaded = new Module(rendererPath, module)
  loaded.filename = rendererPath
  loaded.paths = Module._nodeModulePaths(path.dirname(rendererPath))
  loaded._compile(changed, rendererPath)
  require.cache[rendererPath] = loaded
  return loaded.exports
}

function canvasContext() {
  return new Proxy({}, {
    get(target, property) {
      if (typeof property === 'symbol') return undefined
      return (...args) => {}
    },
    set() { return true },
  })
}

function draw(renderer, model, width, options, height = 500) {
  return renderer.drawWiringDiagram(canvasContext(), model, width, height, options)
}

function paths(metrics) {
  return metrics.connectionAnchors.map((route) => ({
    id: route.id,
    points: route.points.map((point) => point.slice()),
  }))
}

function run() {
  const renderer = loadInstrumentedRenderer()
  global.__solderTableHeavySolves = 0
  global.__solderTableAnchorNudge = 0
  const pairs = []
  for (const output of modelApi.OUTPUT_OPTIONS) {
    for (const input of modelApi.INPUT_OPTIONS) {
      if (modelApi.getWiringModel(output.id, input.id).supported) pairs.push([output.id, input.id])
    }
  }
  assert.strictEqual(pairs.length, 63, 'current default models cover 63 supported combinations')

  for (const [outputId, inputId] of pairs) {
    const canonicalModel = modelApi.getWiringModel(outputId, inputId)
    const canonical = draw(renderer, canonicalModel, 274, { layout: 'solder-wiring', avoidRail: true })
    const canonicalPaths = paths(canonical)
    const canonicalHeight = canonical.height
    for (const [width, avoidRail] of [[272, true], [274, true], [319, true], [369, true], [336, false]]) {
      const model = modelApi.getWiringModel(outputId, inputId)
      const metrics = draw(renderer, model, width, { layout: 'solder-wiring', avoidRail })
      const actualContentWidth = Math.max(150, width - (avoidRail ? 56 : 0))
      const expectedShift = (actualContentWidth - 218) / 2
      assert.strictEqual(metrics.height, canonicalHeight, `${outputId}→${inputId} width ${width} height`)
      assert.deepStrictEqual(paths(metrics), canonicalPaths.map((route) => ({
        ...route,
        points: route.points.map(([x, y]) => [x + expectedShift, y]),
      })), `${outputId}→${inputId} width ${width} canonical route reuse`)
    }
    const photos = Object.fromEntries(getModelPhotoSpecs(canonicalModel).map((spec) => [spec.key, {}]))
    const themedModel = modelApi.getWiringModel(outputId, inputId)
    const darkSelected = draw(renderer, themedModel, 274, {
      layout: 'solder-wiring', avoidRail: true, theme: 'dark',
      selectedId: themedModel.connections[0].id, photos,
    })
    assert.deepStrictEqual(paths(darkSelected), canonicalPaths,
      `${outputId}→${inputId} theme, selected wire, and photo instances reuse paths`)

    const reportModel = modelApi.getWiringModel(outputId, inputId)
    renderer.getReportHeight(672, reportModel, { scale: 2, compact: true })
    renderer.drawWiringReport(canvasContext(), reportModel, 672, 1800,
      { scale: 2, compact: true, theme: 'dark', selectedId: reportModel.connections[0].id, photos })
  }
  assert.strictEqual(global.__solderTableHeavySolves, 0,
    'cold 63×5 layouts plus dark, selected, ready-photo, and compact report paths use no A*')

  const localeCompare = String.prototype.localeCompare
  String.prototype.localeCompare = function () { throw new Error('signature order must not depend on localeCompare') }
  try {
    const model = modelApi.getWiringModel('xlrBalanced', 'xlrBalanced')
    draw(renderer, model, 274, { layout: 'solder-wiring', avoidRail: true })
  } finally { String.prototype.localeCompare = localeCompare }
  assert.strictEqual(global.__solderTableHeavySolves, 0, 'table matching works with localeCompare unavailable')

  const tinyNudgeModel = modelApi.getWiringModel('xlrBalanced', 'xlrBalanced')
  global.__solderTableAnchorNudge = 0.0000001
  const tinyMetrics = draw(renderer, tinyNudgeModel, 274, { layout: 'solder-wiring', avoidRail: true })
  global.__solderTableAnchorNudge = 0
  const tinyRoute = tinyMetrics.connectionAnchors[0]
  const tinyAnchor = tinyMetrics.output.anchors.get(String(tinyRoute.fromPin))
  assert.deepStrictEqual(tinyRoute.points[0], [tinyAnchor.x, tinyAnchor.y],
    'sub-micropixel engine noise rebinds endpoints to the current anchor')
  assert.strictEqual(global.__solderTableHeavySolves, 0, 'sub-micropixel noise remains a table hit')

  const changedModel = modelApi.getWiringModel('xlrBalanced', 'xlrBalanced')
  changedModel.connections[0].fromLabel += ' 已修改'
  draw(renderer, changedModel, 274, { layout: 'solder-wiring', avoidRail: true })
  assert.strictEqual(global.__solderTableHeavySolves, 1, 'connection label mutation rejects stale paths')

  const changedAnchorModel = modelApi.getWiringModel('xlrBalanced', 'xlrBalanced')
  global.__solderTableAnchorNudge = 0.01
  draw(renderer, changedAnchorModel, 274, { layout: 'solder-wiring', avoidRail: true })
  global.__solderTableAnchorNudge = 0
  assert.strictEqual(global.__solderTableHeavySolves, 2, '0.01-pixel anchor change rejects stale paths')

  const isolatedModel = modelApi.getWiringModel('xlrBalanced', 'xlrBalanced')
  const first = draw(renderer, isolatedModel, 274, { layout: 'solder-wiring', avoidRail: true })
  const expected = paths(first)
  first.connectionAnchors[0].points[1][0] = -999
  const second = draw(renderer, isolatedModel, 274, { layout: 'solder-wiring', avoidRail: true })
  assert.deepStrictEqual(paths(second), expected, 'caller mutation cannot alter route table or cache snapshots')
  assert.strictEqual(global.__solderTableHeavySolves, 2, 'caller mutation isolation keeps canonical table hits')

  process.stdout.write(`audio-wiring solder route table regression passed: ${pairs.length} models × 5 cold widths; canonical A* solves 0.\n`)
}

try { run() } finally {
  delete global.__solderTableHeavySolves
  delete global.__solderTableAnchorNudge
}

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const vm = require('node:vm')

const pageFactoryPath = path.resolve(__dirname, '../pages/dmx-layout/page-factory.js')
const pageFactorySource = fs.readFileSync(pageFactoryPath, 'utf8')
const requireFromPage = Module.createRequire(pageFactoryPath)
const initialWx = {
  getAppBaseInfo: () => ({ theme: 'light' }),
  getSystemInfoSync: () => ({ theme: 'light' }),
}
let initialTimerCalls = 0
const sandbox = {
  module: { exports: {} },
  exports: {},
  __filename: pageFactoryPath,
  __dirname: path.dirname(pageFactoryPath),
  require(request) {
    if (request === '../../utils/haptics') return { vibrate() {} }
    return requireFromPage(request)
  },
  wx: initialWx,
  Date: { now: () => 1 },
  setTimeout() { initialTimerCalls += 1; return 'initial-timer' },
  clearTimeout() {},
  console,
}
sandbox.exports = sandbox.module.exports
vm.runInNewContext(pageFactorySource, sandbox, { filename: pageFactoryPath })
const { createDmxLayoutPage } = sandbox.module.exports
const page = createDmxLayoutPage({ mode: 'portrait' })
assert.equal(initialTimerCalls, 0, 'page creation should not schedule timers')

const timerRows = []
const clearedTimers = []
let timerSequence = 0
sandbox.setTimeout = (callback, delay) => {
  const row = { id: 'vm-timer-' + (++timerSequence), callback, delay }
  timerRows.push(row)
  return row.id
}
sandbox.clearTimeout = id => { clearedTimers.push(id) }
let clockReads = 0
sandbox.Date = { now() { clockReads += 1; return clockReads === 1 ? 1000 : 1120 } }

page._alive = true
page._visible = true
page._visibilityToken = 8
page._saveImagesToken = 0
page._viewAnimationToken = 0
page._view = { s: 1, x: 0, y: 0 }
page.canvasDimensions = () => ({ width: 100, height: 100 })
const drawRows = []
page.drawLayout = () => drawRows.push({ ...page._view })
page.animateViewTo({ x: 20, y: 30 })
assert.equal(clockReads, 2, 'animation must read the replaced clock at invocation time')
assert.equal(timerRows[0].delay, 16, 'animation must schedule through the replaced VM timer')
assert.equal(drawRows.length, 1, 'animation should perform its first frame immediately')

let writes = 0
const patches = []
page.setData = (patch, callback) => {
  patches.push(patch)
  Object.assign(page.data, patch)
  if (callback) callback()
}
page._layout = {
  stageWidthText: '12', stageDepthText: '8', apronDirection: 'bottom',
  internalRods: [{ id: 'rod-1' }], frontRods: [], legacySideRods: [], positionsById: {},
}
page._geometry = { rods: [{ id: 'rod-1', type: 'internal' }] }
page.getGeometry = () => page._geometry
page.nextRodPosition = () => 0.5
page.saveLayoutOnly = next => { writes += 1; page._layout = next; return true }
page.requestPreviewScrollIntoView = () => {}
page.assignFixtureToRod({ stableId: 'fixture-1', addressText: 'A001' }, 'rod-1')
const highlightTimerId = page._highlightTimer
assert(timerRows.some(row => row.id === highlightTimerId && row.delay === 1200), 'placement highlight must use the replaced VM timer')
assert.equal(writes, 1, 'the initial fixture placement should write once')

const albumCalls = []
const wxCalls = []
const currentWx = {
  showLoading() { wxCalls.push(['showLoading', this === currentWx]) },
  hideLoading() { wxCalls.push(['hideLoading', this === currentWx]) },
  saveImageToPhotosAlbum(options) { wxCalls.push(['saveImageToPhotosAlbum', this === currentWx]); albumCalls.push(options) },
  showToast(options) { wxCalls.push(['showToast', this === currentWx, options]) },
}
sandbox.wx = currentWx
page.data.layoutImagePaths = ['late-image.png']
page.saveAllImages()
assert.deepEqual(wxCalls.slice(0, 2).map(row => row[0]), ['showLoading', 'saveImageToPhotosAlbum'])
assert(wxCalls.slice(0, 2).every(row => row[1]), 'wx methods must bind their receiver to the current VM wx object')
assert.equal(albumCalls[0].filePath, 'late-image.png')

page.onHide()
assert(clearedTimers.includes(highlightTimerId), 'hide must clear the active VM timer through the replacement timer API')
const patchesAfterHide = patches.length
const drawsAfterHide = drawRows.length
const writesAfterHide = writes
for (const row of timerRows) row.callback()
albumCalls[0].success({})
assert.equal(patches.length, patchesAfterHide, 'late timer/native callbacks must not update page data after hide')
assert.equal(drawRows.length, drawsAfterHide, 'late animation callback must not draw after hide')
assert.equal(writes, writesAfterHide, 'late callbacks must not write after hide')
assert.equal(albumCalls.length, 1, 'late album success must not continue a canceled save batch')
assert.equal(wxCalls.filter(row => row[0] === 'showToast').length, 0, 'late album success must not report stale completion')
assert(wxCalls.some(row => row[0] === 'hideLoading' && row[1]), 'hide must use the current VM wx object')

console.log('DMX structure VM realm regression passed: dynamic wx, timers, clock, and stale-callback guards')

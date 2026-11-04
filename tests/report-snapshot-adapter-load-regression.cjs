'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Module = require('node:module')

const root = path.resolve(__dirname, '..')
const adapterPath = require.resolve('../pages/records/report-snapshot-adapter')
const adapter = require(adapterPath)

function modulePath(relativePath) {
  return require.resolve(path.join(root, relativePath))
}

const rendererPaths = [
  'pages/limiter/limiter-report.js',
  'pages/spl/spl-report.js',
  'pages/cable/cable-report.js',
  'pages/camera/camera-report.js',
  'pages/led-screen/report.js',
  'pages/gain-structure/gain-report.js',
  'pages/dmx-layout/layout-renderer.js',
]

rendererPaths.forEach((relativePath) => {
  assert.equal(require.cache[modulePath(relativePath)], undefined,
    `requiring the adapter alone must not load ${relativePath}`)
})

function loadPrepareReportImagePlan() {
  const reportPath = path.join(root, 'pages/records/report.js')
  const source = fs.readFileSync(reportPath, 'utf8')
  const start = source.indexOf('function prepareReportImagePlan(')
  const end = source.indexOf('\nfunction asSelectionSections(', start)
  assert(start >= 0 && end > start, 'report page retains its local image-plan error boundary')
  const context = {
    module: { exports: {} },
    buildReportImageTasks: adapter.buildReportImageTasks,
  }
  vm.runInNewContext(`${source.slice(start, end)}\nmodule.exports = prepareReportImagePlan`, context, {
    filename: reportPath,
  })
  return context.module.exports
}

const prepareReportImagePlan = loadPrepareReportImagePlan()
const limiterItem = {
  id: 'record:limiter-lazy-load',
  type: 'calculation',
  record: {
    module: 'limiter',
    title: '加载隔离检查',
    summary: '',
    resultText: '结果性质：理论估算\n输出阈值：-2 dB',
  },
}
const wiringItem = {
  id: 'wiring:bridge-still-available',
  type: 'wiring',
  line: { id: 'line:bridge-still-available' },
}
const measureContext = {
  font: '',
  setFillStyle() {},
  setTextAlign() {},
  measureText(value) {
    return { width: [...String(value)].length * 12 }
  },
}

const load = Module._load
let interceptedLoads = 0
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename === adapterPath && request === '../limiter/limiter-report') {
    interceptedLoads += 1
    throw new Error('fixture: limiter renderer failed to load')
  }
  return load.call(this, request, parent, isMain)
}
let failedPlan
try {
  failedPlan = prepareReportImagePlan([limiterItem, wiringItem], '隔离检查', measureContext)
} finally {
  Module._load = load
}

assert.equal(interceptedLoads, 1, 'the limiter renderer loads only when its branch is planned')
assert.equal(failedPlan.errors[limiterItem.id], 'fixture: limiter renderer failed to load',
  'the existing report page boundary reports only the item whose renderer failed')
assert.equal(failedPlan.bridges.projectWiring.length, 1,
  'a failed renderer does not prevent a separate project-wiring bridge from being planned')
assert.equal(Object.keys(failedPlan.tasksById).length, 0)

const firstPlan = adapter.buildReportImageTasks(limiterItem, '隔离检查', measureContext)
assert.equal(firstPlan.ok, true, firstPlan.error)
assert.ok(firstPlan.tasks.length > 0, 'the limiter branch still returns a render task')
const limiterRendererPath = modulePath('pages/limiter/limiter-report.js')
const cachedLimiterRenderer = require.cache[limiterRendererPath]
assert.ok(cachedLimiterRenderer, 'the selected renderer is loaded for its matching branch')

const secondPlan = adapter.buildReportImageTasks(limiterItem, '隔离检查', measureContext)
assert.equal(secondPlan.ok, true, secondPlan.error)
assert.strictEqual(require.cache[limiterRendererPath], cachedLimiterRenderer,
  'repeated use reuses the CommonJS renderer cache')

const unrelatedPaths = [
  ...rendererPaths.filter((relativePath) => relativePath !== 'pages/limiter/limiter-report.js'),
  'utils/camera-fov.js',
  'utils/cable.js',
  'utils/dmx-address.js',
  'utils/led-screen.js',
  'utils/spl.js',
  'pages/camera/preview-renderer.js',
  'pages/dmx-layout/layout-model.js',
]
unrelatedPaths.forEach((relativePath) => {
  assert.equal(require.cache[modulePath(relativePath)], undefined,
    `planning a limiter report must not load unrelated ${relativePath}`)
})

console.log('Report snapshot adapter lazy-load regression passed: adapter-only import, branch failure isolation, and cached renderer reuse.')

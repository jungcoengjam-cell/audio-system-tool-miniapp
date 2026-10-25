const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const projectWiring = require('../utils/project-wiring')

const mode = process.argv[2] || 'after'
assert(['before', 'after'].includes(mode), 'pass before or after')
const root = path.resolve(__dirname, '..')
const pageFile = path.resolve(root, 'pages/project-wiring/index.js')
const recordsFile = require.resolve('../utils/records')
const baselineRoot = path.resolve(root, 'tmp/remaining-work-2026-10-24/wiring/before')
const originalCompile = Module.prototype._compile

if (mode === 'before') {
  const sourceFiles = [
    'pages/project-wiring/index.js',
    'pages/project-wiring/workspace-ui.js',
    'pages/project-wiring/report-controller.js',
    'pages/project-wiring/page-lifecycle.js',
  ]
  const snapshots = new Map(sourceFiles.map((name) => [
    path.resolve(root, name),
    path.resolve(baselineRoot, name),
  ]))
  Module.prototype._compile = function (content, filename) {
    const snapshot = snapshots.get(path.resolve(filename))
    if (snapshot) content = fs.readFileSync(snapshot, 'utf8')
    return originalCompile.call(this, content, filename)
  }
}

let now = 0
let nextTimerId = 1
const timers = new Map()
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout
global.setTimeout = (callback, delay = 0, ...args) => {
  const id = nextTimerId++
  timers.set(id, { id, callback, args, due: now + Math.max(0, Number(delay) || 0) })
  return id
}
global.clearTimeout = (id) => timers.delete(id)
function flushTimers() {
  let steps = 0
  while (timers.size) {
    if (++steps > 1000) throw new Error('timer queue did not settle')
    const timer = [...timers.values()].sort((a, b) => a.due - b.due || a.id - b.id)[0]
    timers.delete(timer.id)
    now = timer.due
    timer.callback(...timer.args)
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const projectId = 'project-editor-boundary'
const project = { id: projectId, name: '编辑器边界回归' }
const seeded = projectWiring.applyScheduleChange(projectWiring.emptySchedule(), {
  type: 'add-devices',
  devices: [
    { type: 'custom', name: 'DSP' },
    { type: 'custom', name: '功放' },
  ],
})
assert.equal(seeded.ok, true, 'fixture devices should be valid')
const store = { project, schedule: seeded.schedule }
const writes = []
const records = {
  getProjectWiring(id) {
    if (id !== projectId) return { ok: false, project: null, schedule: null, error: '项目不存在或已删除' }
    return { ok: true, project: clone(store.project), schedule: clone(store.schedule) }
  },
  getProjects() {
    return [{ ...clone(project), wiringSchedule: clone(store.schedule) }]
  },
  createProject() {
    throw new Error('project creation is outside this regression')
  },
  saveProjectWiring(id, command, expectedRevision) {
    writes.push({ projectId: id, command: clone(command), expectedRevision })
    if (id !== projectId || expectedRevision !== store.schedule.revision) {
      return { ok: false, project: clone(project), schedule: clone(store.schedule), error: '项目布线已更新' }
    }
    const result = projectWiring.applyScheduleChange(store.schedule, command)
    if (!result.ok) return { ok: false, project: clone(project), ...result }
    store.schedule = clone(result.schedule)
    return {
      ok: true,
      project: clone(project),
      schedule: clone(result.schedule),
      lineIds: result.lineIds,
      ...(result.deviceIds ? { deviceIds: result.deviceIds } : {}),
    }
  },
}
const recordModule = new Module(recordsFile)
recordModule.filename = recordsFile
recordModule.loaded = true
recordModule.exports = records
require.cache[recordsFile] = recordModule

const toasts = []
global.wx = {
  getStorageSync() { return null },
  setStorageSync() {},
  getWindowInfo() { return { windowHeight: 800, screenWidth: 375, screenHeight: 800 } },
  getSystemInfoSync() { return { windowHeight: 800, screenWidth: 375, screenHeight: 800 } },
  setNavigationBarTitle() {},
  setNavigationBarColor() {},
  showToast(options) { toasts.push(options) },
  showModal() {},
  hideKeyboard() {},
  vibrateShort() {},
  enableAlertBeforeUnload() {},
  disableAlertBeforeUnload() {},
  nextTick(callback) { callback() },
  showLoading() {},
  hideLoading() {},
}

let page
global.Page = (definition) => { page = definition }
delete require.cache[pageFile]
require(pageFile)
assert(page, 'page should register')
page.data = clone(page.data)
page.setData = (patch, callback) => {
  Object.entries(clone(patch)).forEach(([key, value]) => {
    const parts = key.split('.')
    const leaf = parts.pop()
    const target = parts.reduce((valueAt, part) => {
      if (!valueAt[part] || typeof valueAt[part] !== 'object') valueAt[part] = {}
      return valueAt[part]
    }, page.data)
    target[leaf] = value
  })
  if (callback) callback()
}
page.onLoad({ id: projectId })
page.onShow()
flushTimers()
assert.equal(page.projectId, projectId)
assert.equal(page.data.devices.length, 2)

const source = page.data.devices.find((device) => device.name === 'DSP')
const destination = page.data.devices.find((device) => device.name === '功放')
assert(source && destination, 'seed devices should be available to workspace actions')
const renameTarget = {
  id: source.id,
  deviceId: source.id,
  deviceKey: source.key,
  projectId,
  revision: page._schedule.revision,
  actionType: 'rename-device',
}
page.renameDevice({ currentTarget: { dataset: renameTarget } })
assert(page._inlineRename, 'rename should open its editing session')
const session = page._inlineRename
const connectTarget = { ...renameTarget, actionType: 'connect' }
page.connectDevice({ currentTarget: { dataset: connectTarget } })
assert.equal(session.pendingAction && session.pendingAction.kind, 'connect', 'connect action should wait for rename confirmation')

const renameEvent = {
  currentTarget: {
    dataset: {
      id: source.id,
      deviceId: source.id,
      deviceKey: source.key,
      projectId,
      revision: session.revision,
      renameSessionId: session.id,
    },
  },
  detail: { value: 'DSP 主控' },
}
page.onInlineRenameInput(renameEvent)
page.onInlineRenameConfirm(renameEvent)
flushTimers()
assert.equal(store.schedule.revision, seeded.schedule.revision + 1, 'rename should persist once')
assert.equal(store.schedule.devices.find((device) => device.id === source.id).name, 'DSP 主控')
assert.equal(page.data.editorVisible, true, 'queued connect should open the line editor')
assert.equal(page.data.draft.fromDeviceId, source.id)
assert.equal(page.data.draft.fromDevice, 'DSP 主控')

const destinationIndex = page.data.toDeviceChoices.findIndex((device) => device.id === destination.id)
assert(destinationIndex > 0, 'destination should be selectable after source selection')
page.selectEndpoint({
  currentTarget: { dataset: { side: 'to' } },
  detail: { value: String(destinationIndex) },
})
page.openContinuous()
page.onContinuousInput({ currentTarget: { dataset: { field: 'fromPort' } }, detail: { value: 'OUT-01' } })
page.onContinuousInput({ currentTarget: { dataset: { field: 'toPort' } }, detail: { value: 'IN-01' } })
page.onContinuousInput({ currentTarget: { dataset: { field: 'count' } }, detail: { value: '2' } })
assert.deepEqual(page.data.continuousPairs.map((pair) => [pair.fromPort, pair.toPort]), [
  ['OUT-01', 'IN-01'],
  ['OUT-02', 'IN-02'],
])
page.fillContinuous()
flushTimers()
assert.equal(page.data.draftPairs.length, 2)
page.saveLine()
flushTimers()

assert.equal(store.schedule.lines.length, 2, 'continuous fill should save both paired lines')
assert.deepEqual(store.schedule.lines.map((line) => [line.fromDeviceId, line.toDeviceId, line.fromPort, line.toPort]), [
  [source.id, destination.id, 'OUT-01', 'IN-01'],
  [source.id, destination.id, 'OUT-02', 'IN-02'],
])
assert.equal(new Set(store.schedule.lines.map((line) => line.id)).size, 2, 'saved lines should keep unique IDs')
assert.equal(new Set(store.schedule.lines.map((line) => line.code)).size, 2, 'saved lines should keep unique codes')
assert.deepEqual(writes.map((write) => write.command.type), ['rename-device', 'append-lines'])
assert.equal(page.data.editorVisible, false, 'successful save should close the line editor')

global.setTimeout = originalSetTimeout
global.clearTimeout = originalClearTimeout
Module.prototype._compile = originalCompile
console.log(JSON.stringify({
  suite: 'project-wiring-editor-boundary-regression',
  mode,
  result: 'passed',
  deviceRenameQueuedConnect: true,
  continuousPairedLinesSaved: store.schedule.lines.length,
  commandTypes: writes.map((write) => write.command.type),
  toasts: toasts.map((item) => item.title),
}))
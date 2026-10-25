'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const vm = require('node:vm')
const { buildWorkspace } = require('../pages/project-wiring/workspace-model')

const root = path.resolve(__dirname, '..')
const currentIndexPath = path.join(root, 'pages/project-wiring/index.js')
const currentWorkspacePath = path.join(root, 'pages/project-wiring/workspace-ui.js')
const beforeRoot = path.join(root, 'tmp/architecture-continuation-2026-10-25/before/pages/project-wiring')
const beforeIndexPath = path.join(beforeRoot, 'index.js')
const beforeWorkspacePath = path.join(beforeRoot, 'workspace-ui.js')
const frozenTracePath = path.join(root, 'tmp/architecture-continuation-2026-10-25/phase5-wiring/before-event-trace.json')
const FROZEN_BASELINE_SHA256 = '6401d0d539e32fe066748071a4d12b58fed9df56440738ea42208d1ccb0afe33'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function makeDate(clock) {
  return class RuntimeDate extends Date {
    static now() { return clock.now }
  }
}

function createTimerRuntime(name, events) {
  let nextId = 0
  const tasks = new Map()
  return {
    tasks,
    setTimeout(callback, delay) {
      const id = `${name}-${++nextId}`
      tasks.set(id, { callback, delay, cleared: false })
      events.push({ type: 'timer-set', runtime: name, id, delay })
      return id
    },
    clearTimeout(id) {
      events.push({ type: 'timer-clear', runtime: name, id: id ?? null })
      if (tasks.has(id)) tasks.get(id).cleared = true
    },
    run(id, force = false) {
      const task = tasks.get(id)
      assert.ok(task, `unknown ${name} timer ${id}`)
      events.push({ type: 'timer-run', runtime: name, id, force, cleared: task.cleared })
      if (!task.cleared || force) task.callback()
      tasks.delete(id)
    },
  }
}

function createWxRuntime(name, events, modalCallbacks) {
  const api = {
    nextTick(callback) {
      events.push({ type: 'nextTick', runtime: name, receiverMatches: this === api })
      callback()
    },
    showToast(options) {
      events.push({ type: 'toast', runtime: name, receiverMatches: this === api, title: options && options.title })
    },
    showModal(options) {
      events.push({
        type: 'modal', runtime: name, receiverMatches: this === api,
        title: options.title, content: options.content, confirmText: options.confirmText,
      })
      modalCallbacks.push({ success: options.success, fail: options.fail })
    },
    offThemeChange() {},
  }
  return api
}

function evaluateModule(context, sourcePath, source, moduleRequire) {
  const wrapper = vm.runInContext(
    `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`,
    context,
    { filename: sourcePath, timeout: 10000 },
  )
  const module = { exports: {} }
  wrapper(module.exports, moduleRequire, module, sourcePath, path.dirname(sourcePath))
  return module.exports
}

function createEnvironment(indexPath, workspacePath) {
  const timerEvents = []
  const wxEvents = []
  const modalCallbacks = []
  const vibrationEvents = []
  const timerA = createTimerRuntime('initial', timerEvents)
  const timerB = createTimerRuntime('replacement', timerEvents)
  const clock = { now: 100 }
  const wxA = createWxRuntime('initial', wxEvents, modalCallbacks)
  const wxB = createWxRuntime('replacement', wxEvents, modalCallbacks)
  const records = {
    saveHandler: () => ({ ok: false, error: 'unexpected-save' }),
    saves: [],
    createProject() { return { ok: false } },
    getProjectWiring() { return { ok: false } },
    getProjects() { return [] },
  }
  records.saveProjectWiring = (projectId, command, revision) => {
    records.saves.push({ projectId, command: clone(command), revision })
    return records.saveHandler(projectId, command, revision)
  }
  const sandbox = {
    wx: wxA,
    Date: makeDate(clock),
    setTimeout: timerA.setTimeout,
    clearTimeout: timerA.clearTimeout,
    console,
    getApp: () => ({ globalData: {} }),
    getCurrentPages: () => [],
  }
  const context = vm.createContext(sandbox)
  const baseWorkspaceRequire = Module.createRequire(workspacePath)
  const workspaceRequire = (specifier) => {
    if (specifier === '../../utils/records') return records
    if (specifier === '../../utils/haptics') return { vibrate: (style) => vibrationEvents.push(style) }
    return baseWorkspaceRequire(specifier)
  }
  const workspaceSource = fs.readFileSync(workspacePath, 'utf8')
  const workspaceExports = evaluateModule(context, workspacePath, workspaceSource, workspaceRequire)
  let definition = null
  sandbox.Page = (value) => { definition = value }
  const pageRequire = (specifier) => {
    if (specifier === './workspace-ui') return workspaceExports
    return Module.createRequire(indexPath)(specifier)
  }
  const indexSource = fs.readFileSync(indexPath, 'utf8')
  evaluateModule(context, indexPath, indexSource, pageRequire)
  assert.ok(definition && definition.data, `Page did not register from ${indexPath}`)
  return {
    definition, sandbox, context, clock, timerA, timerB, timerEvents, wxA, wxB, wxEvents,
    modalCallbacks, vibrationEvents, records,
  }
}

function makePage(environment) {
  const page = {
    ...environment.definition,
    data: clone(environment.definition.data),
    _qaPatches: [],
    setData(patch, callback) {
      const copied = clone(patch)
      this._qaPatches.push(copied)
      Object.entries(patch).forEach(([rawPath, value]) => {
        const parts = rawPath.replace(/\[(\d+)\]/g, '.$1').split('.')
        const leaf = parts.pop()
        const target = parts.reduce((current, part) => {
          if (!current[part] || typeof current[part] !== 'object') current[part] = {}
          return current[part]
        }, this.data)
        target[leaf] = clone(value)
      })
      if (callback) callback.call(this)
    },
  }
  page._destroyed = false
  page._hidden = false
  page._projectLoadRevision = 11
  page._workspaceOverlayTimers = Object.create(null)
  page._workspaceOverlayEpochs = Object.create(null)
  page._workspaceSuppressedTouches = Object.create(null)
  page._workspaceSuppressedTapTarget = null
  page._workspaceSwipeGesture = null
  page._workspaceOpenSwipe = null
  page._workspaceScrollGesture = null
  page._workspaceActionTouch = null
  page._workspaceGroupGesture = null
  page._workspaceRetiringRow = null
  page._workspaceRemovalTimers = []
  page._workspaceDeletionToken = 0
  page._workspaceDeletion = null
  page._workspaceDeletionInFlight = null
  page._workspaceEditorDeleteToken = 0
  page._workspaceEditorDelete = null
  page._workspaceThemeChange = null
  page._searchTimer = null
  page._formBlurTimer = null
  page._formScrollTimer = null
  page._workspaceInteractionTraceEnabled = false
  page._workspaceInteractionTraceEvents = []
  page._workspaceInteractionTraceSequence = 0
  page._workspaceInteractionTraceStartedAt = 0
  page.clearWorkspaceRetiringRow = () => {}
  page.cancelWorkspaceRemovalTimers = () => {}
  page.clearFormKeyboardViewport = () => {}
  page.resetFormKeyboardAvoidance = () => {}
  page.clearUnloadWarning = () => {}
  page.invalidateExport = () => {}
  return page
}

function touch(identifier, clientX, clientY) {
  return { identifier, clientX, clientY }
}

function touchEvent(dataset, points, changed = points) {
  return { currentTarget: { dataset }, touches: points, changedTouches: changed }
}

function summarizePage(page) {
  return {
    destroyed: Boolean(page._destroyed),
    hidden: Boolean(page._hidden),
    overlayPhases: clone(page.data.workspaceOverlayPhases),
    overlayTimers: clone(page._workspaceOverlayTimers),
    overlayEpochs: clone(page._workspaceOverlayEpochs),
    trace: clone(page._workspaceInteractionTraceEvents),
  }
}

function runOverlayScenario(environment) {
  const page = makePage(environment)
  const callbacks = []
  page.startWorkspaceInteractionTrace()
  page.beginWorkspaceOverlay('report', { reportPreviewVisible: true })
  const initialTimer = page._workspaceOverlayTimers.report
  page.transitionWorkspaceOverlays(['report'], 'newProject', {
    reportPreviewVisible: false, newProjectVisible: true,
  }, () => callbacks.push('closed-report'))
  const staleCloseTimer = page._workspaceOverlayTimers.report
  const newProjectTimer = page._workspaceOverlayTimers.newProject

  environment.clock.now = 450
  environment.sandbox.wx = environment.wxB
  environment.sandbox.Date = makeDate(environment.clock)
  environment.sandbox.setTimeout = environment.timerB.setTimeout
  environment.sandbox.clearTimeout = environment.timerB.clearTimeout
  page.beginWorkspaceOverlay('report', { reportPreviewVisible: true })
  const reopenedTimer = page._workspaceOverlayTimers.report
  environment.timerA.run(initialTimer, true)
  environment.timerA.run(staleCloseTimer, true)
  environment.timerB.run(reopenedTimer)
  environment.timerA.run(newProjectTimer, true)

  page.endWorkspaceOverlay('newProject', () => callbacks.push('closed-new-project'))
  const closeThenReopen = page._workspaceOverlayTimers.newProject
  page.beginWorkspaceOverlay('newProject', { newProjectVisible: true })
  const afterReopen = page._workspaceOverlayTimers.newProject
  environment.timerB.run(closeThenReopen, true)
  environment.timerB.run(afterReopen)

  page.beginWorkspaceOverlay('lineEditor', { editorVisible: true })
  const hiddenTimer = page._workspaceOverlayTimers.lineEditor
  page.onHide()
  environment.timerB.run(hiddenTimer, true)

  page._hidden = false
  page._destroyed = false
  page._workspaceOverlayTimers = Object.create(null)
  page._workspaceOverlayEpochs = Object.create(null)
  page.beginWorkspaceOverlay('report', { reportPreviewVisible: true })
  const unloadTimer = page._workspaceOverlayTimers.report
  page.onUnload()
  environment.timerB.run(unloadTimer, true)

  return {
    page: summarizePage(page), callbacks,
    patches: page._qaPatches,
    timers: environment.timerEvents,
    wx: environment.wxEvents,
  }
}

function makeInteractionSchedule() {
  return {
    version: 1,
    revision: 5,
    nextNumber: 2,
    devices: [
      { id: 'device-A', type: 'custom', name: 'DSP', autoName: false },
      { id: 'device-B', type: 'custom', name: '功放', autoName: false },
    ],
    lines: [{
      id: 'line-A', code: 'A1', purpose: '', fromDevice: 'DSP', fromPort: 'OUT-1',
      toDevice: '功放', toPort: 'IN-1', fromDeviceId: 'device-A', toDeviceId: 'device-B',
      buildType: 'finished', cableType: 'balanced', spec: '', lengthText: '', status: 'pending',
    }],
  }
}

function runInteractionScenario(environment) {
  const page = makePage(environment)
  const schedule = makeInteractionSchedule()
  const workspace = buildWorkspace(schedule)
  page.projectId = 'project-touch'
  page.data.project = { id: page.projectId, name: '布线回归' }
  page.data.loading = false
  page.data.saving = false
  page.data.projectCreating = false
  page.data.devices = clone(workspace.devices)
  page.data.groups = clone(workspace.groups)
  page._schedule = schedule
  page._workspace = workspace
  page.startWorkspaceInteractionTrace()

  const deviceStart = touchEvent({ swipeType: 'device', swipeId: 'device-A', groupIndex: 0 }, [touch(7, 100, 20)])
  page.onSwipeTouchStart(deviceStart)
  page.onSwipeTouchMove({ touches: [touch(7, 40, 21)] })
  page.onSwipeTouchEnd({ changedTouches: [touch(7, 40, 21)] })
  const suppressedDragTap = page.consumeWorkspaceSuppressedTouch({ changedTouches: [touch(7, 40, 21)] }, 'device:device-A')

  const actionDataset = {
    actionType: 'connect', id: 'device-A', deviceKey: 'device:device-A',
    projectId: page.projectId, revision: schedule.revision,
  }
  const actionStart = touchEvent(actionDataset, [touch(9, 10, 10)])
  page.onSwipeActionTouchStart(actionStart)
  page.onSwipeActionTouchMove({ touches: [touch(9, 30, 10)] })
  page.onSwipeActionTouchEnd({ changedTouches: [touch(9, 30, 10)] })
  const movedActionAccepted = page.consumeWorkspaceActionTap(touchEvent(actionDataset, [], [touch(9, 30, 10)]))

  const lineStart = touchEvent({ swipeType: 'line', swipeId: 'line-A', groupIndex: 0 }, [touch(11, 15, 20)])
  page.onSwipeTouchStart(lineStart)
  page.onSwipeTouchMove({ touches: [touch(11, 17, 60)] })
  page.onSwipeTouchEnd({ changedTouches: [touch(11, 17, 60)] })
  const suppressedVerticalTap = page.consumeWorkspaceSuppressedTouch({ changedTouches: [touch(11, 17, 60)] }, 'line:line-A')

  page.onSwipeTouchStart(touchEvent({ swipeType: 'device', swipeId: 'device-B' }, [
    touch(13, 12, 12), touch(14, 13, 13),
  ]))
  page.onSwipeTouchCancel({ changedTouches: [touch(13, 12, 12), touch(14, 13, 13)] })

  environment.clock.now = 700
  environment.sandbox.wx = environment.wxA
  environment.sandbox.Date = class ReplacementDate {
    static now() { return environment.clock.now + 5000 }
  }
  page.traceWorkspaceInteraction('trace-stop', { reason: 'explicit' })
  return {
    suppressedDragTap, movedActionAccepted, suppressedVerticalTap,
    page: summarizePage(page),
    patches: page._qaPatches,
    wx: environment.wxEvents,
  }
}

function makeDeleteSchedule() {
  return {
    version: 1,
    revision: 4,
    nextNumber: 1,
    devices: [{ id: 'device-delete', type: 'custom', name: 'DSP', autoName: false }],
    lines: [],
  }
}

function makeSuccessfulDeleteResponse(projectId, revision) {
  return {
    ok: true,
    project: { id: projectId, name: '删除回归' },
    schedule: { ...makeDeleteSchedule(), revision: revision + 1, devices: [] },
    deviceIds: ['device-delete'],
    lineIds: [],
  }
}

async function runDeletionCase(kind, indexPath, workspacePath) {
  const environment = createEnvironment(indexPath, workspacePath)
  const page = makePage(environment)
  const projectId = `project-delete-${kind}`
  const schedule = makeDeleteSchedule()
  const workspace = buildWorkspace(schedule)
  const sideEffects = []
  page.projectId = projectId
  page._schedule = schedule
  page._workspace = workspace
  page.data.project = { id: projectId, name: '删除回归' }
  page.data.devices = clone(workspace.devices)
  page.data.groups = clone(workspace.groups)
  page.data.loading = false
  page.data.saving = false
  page.data.projectCreating = false
  page._projectLoadRevision = 17
  page.startWorkspaceInteractionTrace()
  page.acceptSavedSchedule = function (response) {
    this._schedule = response.schedule
    this._workspace = buildWorkspace(response.schedule)
    sideEffects.push('accept-schedule')
  }
  page.beginWorkspaceRowRemoval = () => sideEffects.push('begin-row-removal')
  page.refreshProjectWiring = () => sideEffects.push('refresh-project')
  page.invalidateExport = () => sideEffects.push('invalidate-export')
  environment.records.saveHandler = (id, command, revision) => {
    sideEffects.push('save-call')
    if (kind === 'write-failure') return { ok: false, error: '存储写入失败' }
    if (kind === 'repeat-revision' || kind === 'hidden-promise' || kind === 'unload-promise') {
      return new Promise((resolve) => { environment.pendingResolve = resolve })
    }
    return makeSuccessfulDeleteResponse(id, revision)
  }

  const actionEvent = touchEvent({
    deleteType: 'device', id: 'device-delete', deviceKey: 'device:device-delete',
    projectId, revision: schedule.revision,
  }, [])
  page.deleteWorkspaceRecord(actionEvent)
  const modal = environment.modalCallbacks[0]
  assert.ok(modal, `${kind}: delete should request confirmation`)
  if (kind === 'cancel') {
    modal.success({ confirm: false })
  } else {
    modal.success({ confirm: true })
    if (kind === 'repeat-revision') {
      modal.success({ confirm: true })
      page._schedule.revision += 1
      environment.pendingResolve(makeSuccessfulDeleteResponse(projectId, schedule.revision))
    } else if (kind === 'hidden-promise') {
      page.onHide()
      environment.pendingResolve(makeSuccessfulDeleteResponse(projectId, schedule.revision))
    } else if (kind === 'unload-promise') {
      page.onUnload()
      environment.pendingResolve(makeSuccessfulDeleteResponse(projectId, schedule.revision))
    }
  }
  await Promise.resolve()
  await Promise.resolve()

  const state = {
    destroyed: Boolean(page._destroyed),
    hidden: Boolean(page._hidden),
    revision: page._schedule.revision,
    saving: Boolean(page.data.saving),
    deletingId: page.data.workspaceDeletingId,
    deletionToken: page._workspaceDeletionToken,
    deletionActive: Boolean(page._workspaceDeletion),
    deletionInFlight: Boolean(page._workspaceDeletionInFlight),
    needsRefresh: Boolean(page._workspaceDeleteNeedsRefresh),
  }
  return {
    kind, state, sideEffects,
    saves: environment.records.saves,
    trace: clone(page._workspaceInteractionTraceEvents),
    wx: environment.wxEvents,
    vibrations: environment.vibrationEvents,
  }
}

async function runScenarios(indexPath, workspacePath) {
  const environment = createEnvironment(indexPath, workspacePath)
  const overlay = runOverlayScenario(environment)
  const interaction = runInteractionScenario(environment)
  const deletion = []
  for (const kind of ['cancel', 'success', 'write-failure', 'repeat-revision', 'hidden-promise', 'unload-promise']) {
    deletion.push(await runDeletionCase(kind, indexPath, workspacePath))
  }
  return { overlay, interaction, deletion }
}

function digest(trace) {
  return crypto.createHash('sha256').update(JSON.stringify(trace)).digest('hex')
}

async function main() {
  const trace = await runScenarios(currentIndexPath, currentWorkspacePath)
  const hash = digest(trace)
  if (process.argv.includes('--capture-before')) {
    fs.mkdirSync(path.dirname(frozenTracePath), { recursive: true })
    fs.writeFileSync(frozenTracePath, `${JSON.stringify(trace, null, 2)}\n`)
    process.stdout.write(`captured ${hash} to ${path.relative(root, frozenTracePath)}\n`)
    return
  }
  if (process.argv.includes('--compare-before')) {
    const beforeTrace = await runScenarios(beforeIndexPath, beforeWorkspacePath)
    const beforeHash = digest(beforeTrace)
    assert.deepEqual(trace, beforeTrace, `current trace differs from before (${hash} vs ${beforeHash})`)
    process.stdout.write(`PASS --compare-before ${beforeHash}\n`)
    return
  }
  assert.equal(hash, FROZEN_BASELINE_SHA256, `workspace controller trace changed: ${hash}`)
  process.stdout.write(`PASS workspace controller trace ${hash}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})

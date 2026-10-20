const assert = require('node:assert/strict')

const seed = require('./qa-report-seed.cjs')
const storage = seed.createReportQaStorage()
global.wx = { getStorageSync: (key) => storage[key] }
const lightingWorkspace = require('../../../pages/dmx-layout/lighting-workspace')
const lightingEnvelopeBeforeRead = JSON.stringify(storage['audioTool.dmxLightingWorkspace.v2'])
const nativeLightingRead = lightingWorkspace.readLightingWorkspace(seed.projectId)
assert.equal(nativeLightingRead.ok, true, nativeLightingRead.error)
assert.equal(nativeLightingRead.scheme.layout.stageWidthText, '12')
assert.equal(nativeLightingRead.scheme.layout.stageDepthText, '8')
assert.equal(JSON.stringify(storage['audioTool.dmxLightingWorkspace.v2']), lightingEnvelopeBeforeRead,
  'the QA snapshot must already match native storage shape and must not be repaired during reading')
const reportModel = require('../../../pages/records/report-model')
const source = reportModel.loadProjectReportSource(seed.projectId)
assert.equal(source.ok, true, source.error)
const items = reportModel.getProjectReportSections(source).flatMap((section) => section.items)
const audioItem = items.find((item) => item.record?.module === 'audioWiring')
const wiringItems = items.filter((item) => item.type === 'wiring')
assert.ok(audioItem && wiringItems.length === 2)

const definitions = []
global.Page = (definition) => definitions.push(definition)
require('../../../pages/project-wiring/report-bridge')
require('../../../pages/audio-wiring/report-bridge')
require('../../../pages/records/report')
const projectBridgeDefinition = definitions[0]
const audioBridgeDefinition = definitions[1]
const reportPageDefinition = definitions[2]
assert.ok(projectBridgeDefinition && audioBridgeDefinition && reportPageDefinition)

function createCanvas() {
  const state = { calls: [], font: '16px sans-serif' }
  const context = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'measureText') return (value) => ({ width: [...String(value)].length * 9 })
      if (key === 'draw') return (reserve, callback) => callback?.()
      if (typeof key === 'symbol') return target[key]
      return (...args) => target.calls.push({ method: String(key), args })
    },
    set(target, key, value) { target[key] = value; return true },
  })
  return context
}

function createChannel(onEmit) {
  const listeners = new Map()
  const results = []
  return {
    results,
    on(name, listener) {
      const set = listeners.get(name) || new Set()
      set.add(listener)
      listeners.set(name, set)
    },
    off(name, listener) { listeners.get(name)?.delete(listener) },
    emit(name, value) {
      if (name === 'report-bridge-result') results.push(value)
      onEmit?.(name, value)
      for (const listener of listeners.get(name) || []) listener(value)
    },
  }
}

function createPage(definition, channel) {
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    getOpenerEventChannel: () => channel,
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      callback?.()
    },
  }
  return page
}

function createWx({ deferDraw = false } = {}) {
  const pendingDraws = []
  const state = { backCount: 0, exportCount: 0, pendingDraws }
  const wx = {
    createCanvasContext() {
      const context = createCanvas()
      context.draw = (reserve, callback) => {
        if (deferDraw) pendingDraws.push(callback)
        else callback?.()
      }
      return context
    },
    canvasToTempFilePath(options) {
      state.exportCount += 1
      options.success({ tempFilePath: `temp://report-bridge-${state.exportCount}.png` })
    },
    getImageInfo(options) {
      options.success({ path: '/local/report-connector.png', width: 384, height: 384 })
    },
    navigateBack(options = {}) { state.backCount += 1; options.complete?.() },
  }
  return { wx, state }
}

function withFakeTimers(run) {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  let nextId = 1
  let now = 0
  const tasks = new Map()
  global.setTimeout = (callback, delay = 0) => {
    const id = nextId++
    tasks.set(id, { callback, due: now + Math.max(0, Number(delay) || 0) })
    return id
  }
  global.clearTimeout = (id) => tasks.delete(id)
  const timers = {
    pending: () => tasks.size,
    advance(milliseconds) {
      const end = now + milliseconds
      while (true) {
        const next = [...tasks.entries()].sort((left, right) => left[1].due - right[1].due)[0]
        if (!next || next[1].due > end) break
        const [id, task] = next
        tasks.delete(id)
        now = task.due
        task.callback()
      }
      now = end
    },
  }
  try { return run(timers) } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
}

const selectedSchedule = reportModel.buildReportPayload(source, wiringItems.map((item) => item.id)).selectedSchedule
assert.equal(selectedSchedule.version, source.schedule.version, 'the report bridge snapshot must retain the schedule version')
assert.equal(selectedSchedule.revision, source.schedule.revision, 'the report bridge snapshot must retain its saved revision')
const fingerprint = reportModel.getReportSourceFingerprint(source)
const projectPayload = {
  bridge: 'projectWiring', ticket: '20:projectWiring:test', fingerprint, revision: 20,
  projectName: source.project.name, items: wiringItems, schedule: selectedSchedule,
}

// Both selected lines are rendered from the batch's frozen schedule in one bridge page.
{
  const channel = createChannel()
  const page = createPage(projectBridgeDefinition, channel)
  const harness = createWx()
  global.wx = harness.wx
  page.onLoad()
  channel.emit('generate-report', projectPayload)
  assert.equal(channel.results.length, 1)
  const result = channel.results[0]
  assert.equal(result.ok, true, result.message)
  assert.equal(result.bridge, 'projectWiring')
  assert.equal(result.ticket, projectPayload.ticket)
  assert.equal(result.fingerprint, fingerprint)
  assert.equal(result.revision, 20)
  assert.deepEqual(result.items[0].lineIds, wiringItems.map((item) => item.line.id))
  assert.ok(result.items[0].pages.length > 0)
  assert.equal(harness.state.backCount, 1)
  page.onUnload()
}

// A selected line omitted from the frozen batch must fail visibly and never return a partial image.
{
  const channel = createChannel()
  const page = createPage(projectBridgeDefinition, channel)
  const harness = createWx()
  global.wx = harness.wx
  page.onLoad()
  channel.emit('generate-report', { ...projectPayload, schedule: { ...selectedSchedule, lines: selectedSchedule.lines.slice(0, 1) } })
  assert.equal(channel.results.length, 1)
  assert.equal(channel.results[0].ok, false)
  assert.ok(Object.keys(channel.results[0].errors).length === 2)
  assert.equal(harness.state.exportCount, 0)
  page.onUnload()
}

// Cancel while a native draw callback is pending; late drawing must not export or emit a second result.
{
  const channel = createChannel()
  const page = createPage(projectBridgeDefinition, channel)
  const harness = createWx({ deferDraw: true })
  global.wx = harness.wx
  page.onLoad()
  channel.emit('generate-report', projectPayload)
  assert.equal(harness.state.pendingDraws.length, 1)
  channel.emit('cancel-report', { ticket: projectPayload.ticket })
  assert.equal(channel.results.length, 1)
  assert.equal(channel.results[0].cancelled, true)
  harness.state.pendingDraws[0]?.()
  assert.equal(harness.state.exportCount, 0)
  assert.equal(channel.results.length, 1)
  assert.equal(harness.state.backCount, 1)
  page.onUnload()
}

// A parent can cancel after navigation succeeds but before the child-ready handshake
// allows it to send the frozen payload. The child must still leave the route stack.
{
  const channel = createChannel()
  const page = createPage(projectBridgeDefinition, channel)
  const harness = createWx()
  global.wx = harness.wx
  const cancelTicket = '21:projectWiring:cancel-before-payload'
  page.onLoad({ ticket: cancelTicket, revision: '21' })
  assert.equal(channel.results.length, 0, 'ready alone must not fabricate a task result')
  channel.emit('cancel-report', { ticket: cancelTicket })
  assert.equal(channel.results.length, 1)
  assert.equal(channel.results[0].cancelled, true)
  assert.equal(channel.results[0].ticket, cancelTicket)
  assert.equal(channel.results[0].revision, 21)
  assert.equal(harness.state.backCount, 1, 'cancel-before-payload must not strand the child route')
  page.onUnload()
}

// A native back gesture before the parent payload still returns a ticketed cancellation.
// The parent accepts it only for the active bridge ticket and revision, then cancels the
// report after onShow without starting another route.
{
  const ticket = '23:projectWiring:system-back-before-payload'
  const active = { ticket, bridge: 'projectWiring', revision: 23, childReady: true,
    routeOpened: true, parentReturned: false, backComplete: false }
  const channel = createChannel((name, value) => {
    if (name === 'report-bridge-result') reportPageDefinition.handleReportBridgeResult.call(parent, value, active)
    if (name === 'report-bridge-back-complete') reportPageDefinition.handleReportBridgeBackComplete.call(parent, value, active)
  })
  const page = createPage(projectBridgeDefinition, channel)
  const parent = {
    ...reportPageDefinition,
    data: { ...structuredClone(reportPageDefinition.data), mode: 'rendering', isGenerating: true },
    _unloaded: false,
    _reportRevision: 23,
    _sourceFingerprint: fingerprint,
    _activeReportBridge: active,
    _pendingBridgeResult: null,
    _buildingPages: [],
    setData(changes) { this.data = { ...this.data, ...changes } },
  }
  global.wx = { navigateBack() { throw new Error('system back must not trigger a second navigateBack') }, showToast() {} }
  page.onLoad({ ticket, revision: '23' })
  page.onUnload()
  assert.equal(channel.results.length, 1)
  assert.equal(channel.results[0].cancelled, true)
  assert.equal(channel.results[0].ticket, ticket)
  assert.equal(channel.results[0].fingerprint, undefined,
    'a pre-payload cancel must not invent snapshot fingerprint data')
  parent.onShow()
  assert.equal(parent._activeReportBridge, null)
  assert.equal(parent.data.mode, 'select')
  assert.equal(parent.data.isGenerating, false)
}

// The audio bridge uses the frozen preferences/resultText and generates the native connector-photo image.
{
  const channel = createChannel()
  const page = createPage(audioBridgeDefinition, channel)
  const harness = createWx()
  global.wx = harness.wx
  page.onLoad()
  const secondAudioItem = structuredClone(audioItem)
  secondAudioItem.id = 'record:record-report-audio-wiring-batch-2'
  secondAudioItem.record.id = 'record-report-audio-wiring-batch-2'
  channel.emit('generate-report', {
    bridge: 'audioWiring', ticket: '21:audioWiring:test', fingerprint, revision: 21,
    items: [audioItem, secondAudioItem],
  })
  assert.equal(channel.results.length, 1)
  const result = channel.results[0]
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(result.items.map((item) => item.id), [audioItem.id, secondAudioItem.id])
  assert.ok(result.items.every((item) => item.pages.length > 0))
  assert.ok(result.items.every((item) => item.pages.every((image) => image.width === 720 && image.height <= 3600)))
  assert.equal(harness.state.exportCount, result.items.reduce((total, item) => total + item.pages.length, 0))
  assert.equal(harness.state.backCount, 1)
  page.onUnload()
}

// Canceling the parent report forwards the active ticket to the bridge and invalidates late results.
{
  const cancelEvents = []
  const active = { ticket: '23:audioWiring:cancel', bridge: 'audioWiring', revision: 23,
    channel: { emit: (name, payload) => cancelEvents.push({ name, payload }) } }
  const parent = {
    ...reportPageDefinition,
    data: { ...structuredClone(reportPageDefinition.data), mode: 'rendering', isGenerating: true },
    _reportRevision: 23,
    _activeReportBridge: active,
    setData(changes) { this.data = { ...this.data, ...changes } },
  }
  parent.cancelReportGeneration()
  assert.deepEqual(cancelEvents, [{ name: 'cancel-report', payload: { ticket: active.ticket } }])
  assert.equal(parent._reportRevision, 24)
  assert.equal(parent._activeReportBridge, null)
  assert.equal(parent.data.mode, 'select')
  assert.equal(parent.data.isGenerating, false)
  reportPageDefinition.handleReportBridgeResult.call(parent, {
    ok: true, bridge: active.bridge, ticket: active.ticket, fingerprint, revision: active.revision,
    items: [{ id: '__projectWiring__', pages: [{ path: 'temp://late.png', width: 720, height: 300 }] }],
  }, active)
  assert.equal(parent.data.reportPages.length, 0, 'late bridge output must not enter a canceled report')
}

// A parent that has canceled or advanced its ticket ignores every late/stale bridge result.
{
  const active = { ticket: '22:projectWiring:active', bridge: 'projectWiring', revision: 22 }
  const parent = {
    _unloaded: false,
    _reportRevision: 22,
    _sourceFingerprint: fingerprint,
    _activeReportBridge: active,
    _buildingImagePlan: { bridges: { projectWiring: wiringItems } },
    _buildingPages: [],
    setData() { throw new Error('stale bridge result must not mutate the parent report') },
  }
  reportPageDefinition.handleReportBridgeResult.call(parent, {
    ok: true, bridge: active.bridge, ticket: 'stale-ticket', fingerprint, revision: 22,
  }, active)
  assert.equal(parent._activeReportBridge, active)
  parent._activeReportBridge = null
  reportPageDefinition.handleReportBridgeResult.call(parent, {
    ok: true, bridge: active.bridge, ticket: active.ticket, fingerprint, revision: 22,
  }, active)
  assert.equal(parent._activeReportBridge, null)
}

// A failed route launch returns to selection without retaining transient diagnostics.
{
  const nativeError = { errMsg: 'navigateTo:fail native route transition busy' }
  const parent = {
    ...reportPageDefinition,
    data: structuredClone(reportPageDefinition.data),
    _unloaded: false,
    _reportRevision: 25,
    _sourceFingerprint: fingerprint,
    _bridgeSequence: ['projectWiring'],
    _bridgeIndex: 0,
    _bridgeResults: {},
    _pendingBridgeResult: null,
    _buildingPages: [],
    _buildingPayload: { project: source.project, selectedSchedule },
    _buildingImagePlan: { bridges: { projectWiring: wiringItems } },
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      callback?.()
    },
  }
  global.wx = {
    navigateTo(options) { options.fail(nativeError) },
    showToast() {},
  }
  parent.renderNextReportBridge(25)
  assert.equal(parent.data.mode, 'select')
}

// Cover a native back gesture after child ready but before navigateTo.success. The child
// returns its ticketed cancellation, the parent clears generation on onShow, and a late
// success callback cannot send a task to the unloaded child.
{
  const events = []
  let navigateOptions
  const activeRevision = 26
  const parent = {
    ...reportPageDefinition,
    data: { ...structuredClone(reportPageDefinition.data), isGenerating: true, mode: 'rendering' },
    _unloaded: false,
    _reportRevision: activeRevision,
    _sourceFingerprint: fingerprint,
    _bridgeSequence: ['projectWiring'],
    _bridgeIndex: 0,
    _bridgeResults: {},
    _pendingBridgeResult: null,
    _buildingPages: [],
    _buildingPayload: { project: source.project, selectedSchedule },
    _buildingImagePlan: { bridges: { projectWiring: wiringItems } },
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      callback?.()
    },
  }
  const channel = createChannel((name) => events.push(name))
  global.wx = {
    navigateTo(options) { navigateOptions = options },
    showToast() {},
  }
  parent.renderNextReportBridge(activeRevision)
  Object.entries(navigateOptions.events).forEach(([name, listener]) => channel.on(name, listener))
  const route = new URL(`https://test.local${navigateOptions.url}`)
  const child = createPage(projectBridgeDefinition, channel)
  child.onLoad({ ticket: route.searchParams.get('ticket'), revision: route.searchParams.get('revision') })
  assert.ok(!events.includes('generate-report'), 'child ready alone must not send a task before success')
  child.onUnload()
  assert.equal(events.includes('report-bridge-result'), true)
  parent.onShow()
  assert.equal(parent.data.isGenerating, false)
  assert.equal(parent._activeReportBridge, null)
  navigateOptions.success({ eventChannel: channel })
  assert.ok(!events.includes('generate-report'), 'late success must not send work to an unloaded child')
  assert.ok(events.includes('cancel-report'), 'late success should close the stale child channel')
}

// The parent waits for both navigateBack.complete and its onShow before opening a second
// bridge. Exercise both callback orders through the actual parent/child channel listeners.
{
  withFakeTimers(({ advance }) => {
  const events = []
  const routes = []
  let navigationBusy = false
  let priorBridgeBacks = 0
  const parent = {
    ...reportPageDefinition,
    data: { ...structuredClone(reportPageDefinition.data), isGenerating: true, mode: 'rendering' },
    _unloaded: false,
    _reportRevision: 24,
    _sourceFingerprint: fingerprint,
    _bridgeSequence: ['audioWiring', 'projectWiring'],
    _bridgeIndex: 0,
    _bridgeResults: {},
    _pendingBridgeResult: null,
    _buildingPages: [],
    _buildingPayload: { project: source.project, selectedSchedule },
    _buildingImagePlan: { bridges: { audioWiring: [audioItem], projectWiring: wiringItems } },
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      callback?.()
    },
    prepareReportImageQueue(revision) {
      assert.equal(revision, 24)
      assert.deepEqual(Object.keys(this._bridgeResults).sort(), ['audioWiring', 'projectWiring'])
      this.prepareCount = (this.prepareCount || 0) + 1
      events.push('prepare-image-queue')
    },
  }
  const harnessWx = {
    createCanvasContext() { return createCanvas() },
    canvasToTempFilePath(options) {
      options.success({ tempFilePath: `temp://bridge-e2e-${events.length}.png` })
    },
    getImageInfo(options) {
      options.success({ path: '/local/report-connector.png', width: 384, height: 384 })
    },
    navigateTo(options) {
      assert.equal(navigationBusy, false, 'a new route must not open while another navigation is active')
      assert.equal(routes.length, 0, 'the previous bridge must be popped before a new route opens')
      assert.equal(typeof options.events?.['report-bridge-ready'], 'function',
        'the parent must register the ready event before opening the child route')
      assert.equal(typeof options.events?.['report-bridge-result'], 'function',
        'the parent must register the result event before opening the child route')
      const route = options.url
      const bridge = route.includes('audio-wiring') ? 'audioWiring' : 'projectWiring'
      if (bridge === 'projectWiring') assert.ok(priorBridgeBacks > 0, 'project bridge must follow audio bridge return')
      events.push(`navigateTo:${bridge}`)
      navigationBusy = true
      const channel = createChannel((name) => {
        if (name === 'report-bridge-ready') events.push(`child-ready:${bridge}`)
        if (name === 'generate-report') events.push(`generate-event:${bridge}`)
        if (name === 'report-bridge-result') events.push(`result-event:${bridge}`)
      })
      Object.entries(options.events).forEach(([name, listener]) => channel.on(name, listener))
      const definition = bridge === 'audioWiring' ? audioBridgeDefinition : projectBridgeDefinition
      const page = createPage(definition, channel)
      routes.push({ bridge, page })
      const params = new URL(`https://test.local${options.url}`).searchParams
      const childOptions = { ticket: params.get('ticket'), revision: params.get('revision') }
      if (bridge === 'audioWiring') {
        // Some native hosts finish the child onLoad (and its ready event) before
        // the caller's navigateTo success callback supplies the channel.
        page.onLoad(childOptions)
        assert.ok(!events.includes(`generate-event:${bridge}`), 'ready alone must not start work before success provides the channel')
        options.success({ eventChannel: channel })
        navigationBusy = false
      } else {
        // Other hosts deliver success first, while the child is still registering
        // its listeners. The pre-registered ready event closes this race.
        options.success({ eventChannel: channel })
        assert.ok(!events.includes(`generate-event:${bridge}`), 'channel alone must not start work before the child is ready')
        page.onLoad(childOptions)
        navigationBusy = false
      }
    },
    navigateBack(options) {
      assert.equal(routes.length, 1)
      const current = routes[routes.length - 1]
      assert.ok(parent._pendingBridgeResult, 'result should be cached before the bridge leaves the stack')
      assert.equal(parent._bridgeIndex, current.bridge === 'audioWiring' ? 0 : 1,
        'the parent must not advance while the bridge is still on top')
      events.push(`navigateBack:${current.bridge}`)
      priorBridgeBacks += 1
      routes.pop()
      current.page.onUnload()
      events.push(`parent-onShow:${current.bridge}`)
      parent.onShow()
      assert.equal(parent._bridgeIndex, current.bridge === 'audioWiring' ? 0 : 1,
        'onShow alone must not advance while navigateBack.complete is pending')
      navigationBusy = true
      navigationBusy = false
      events.push(`navigateBack-complete:${current.bridge}`)
      options.complete()
      assert.equal(parent._bridgeIndex, current.bridge === 'audioWiring' ? 0 : 1,
        'the stability window must begin after complete before advancing')
    },
  }
  global.wx = harnessWx
  parent.renderNextReportBridge(24)
  assert.equal(routes.length, 0, 'audio bridge should return before its stability window')
  assert.equal(parent._bridgeIndex, 0)
  advance(499)
  assert.equal(parent._bridgeIndex, 0, 'no next route may open before 500 ms')
  advance(1)
  assert.equal(parent._bridgeIndex, 1, 'the next bridge should dispatch once the 500 ms window ends')
  advance(499)
  assert.equal(parent._bridgeIndex, 1, 'the image queue must also wait for its own return stability window')
  advance(1)
  assert.equal(routes.length, 0, 'both batch bridges should have returned')
  assert.equal(parent._bridgeIndex, 2)
  advance(1000)
  assert.equal(parent.prepareCount, 1, 'each completed bridge sequence must dispatch the image queue once')
  assert.deepEqual(events, [
    'navigateTo:audioWiring', 'child-ready:audioWiring', 'generate-event:audioWiring', 'result-event:audioWiring',
    'navigateBack:audioWiring', 'parent-onShow:audioWiring', 'navigateBack-complete:audioWiring',
    'navigateTo:projectWiring', 'child-ready:projectWiring', 'generate-event:projectWiring', 'result-event:projectWiring',
    'navigateBack:projectWiring', 'parent-onShow:projectWiring', 'navigateBack-complete:projectWiring',
    'prepare-image-queue',
  ])
  })
}

// The reverse native callback order is also safe: navigateBack.complete can arrive
// before parent onShow, but neither signal alone advances the bridge sequence.
{
  withFakeTimers(({ advance }) => {
  const active = { ticket: '24:projectWiring:complete-first', bridge: 'projectWiring', revision: 24,
    routeOpened: true, childReady: true, parentReturned: false, backComplete: false }
  const parent = {
    ...reportPageDefinition,
    data: structuredClone(reportPageDefinition.data),
    _unloaded: false,
    _reportRevision: 24,
    _sourceFingerprint: fingerprint,
    _activeReportBridge: active,
    _pendingBridgeResult: null,
    _bridgeIndex: 0,
    _bridgeSequence: ['projectWiring'],
    _bridgeResults: {},
    _buildingImagePlan: { bridges: { projectWiring: wiringItems } },
    _buildingPages: [],
    setData(changes) { this.data = { ...this.data, ...changes } },
    prepareReportImageQueue() { this.prepared = true },
  }
  const result = {
    ok: true, bridge: active.bridge, ticket: active.ticket, fingerprint, revision: active.revision,
    items: [{ id: '__projectWiring__', lineIds: wiringItems.map((item) => item.line.id),
      pages: [{ path: 'temp://project-line.png', width: 720, height: 360 }] }],
  }
  reportPageDefinition.handleReportBridgeResult.call(parent, result, active)
  reportPageDefinition.handleReportBridgeBackComplete.call(parent, {
    bridge: active.bridge, ticket: active.ticket, fingerprint, revision: active.revision,
  }, active)
  assert.equal(parent._bridgeIndex, 0)
  assert.equal(parent.prepared, undefined)
  parent.onShow()
  assert.equal(parent._bridgeIndex, 0)
  assert.equal(parent.prepared, undefined, 'both signals still require the route-stability window')
  advance(500)
  assert.equal(parent._bridgeIndex, 1)
  assert.equal(parent.prepared, true)
  })
}

// The 500 ms route buffer is canceled with its ticket on parent cancel or unload.
for (const terminalAction of ['cancel', 'unload']) {
  withFakeTimers(({ advance, pending }) => {
    const active = { ticket: `27:projectWiring:${terminalAction}`, bridge: 'projectWiring', revision: 27,
      routeOpened: true, childReady: true, parentReturned: false, backComplete: false }
    const parent = {
      ...reportPageDefinition,
      data: { ...structuredClone(reportPageDefinition.data), mode: 'rendering', isGenerating: true },
      _unloaded: false,
      _reportRevision: 27,
      _sourceFingerprint: fingerprint,
      _activeReportBridge: active,
      _pendingBridgeResult: null,
      _buildingImagePlan: { bridges: { projectWiring: wiringItems } },
      _buildingPages: [],
      setData(changes) { this.data = { ...this.data, ...changes } },
      prepareReportImageQueue() { this.dispatched = true },
    }
    const result = {
      ok: true, bridge: active.bridge, ticket: active.ticket, fingerprint, revision: active.revision,
      items: [{ id: '__projectWiring__', lineIds: wiringItems.map((item) => item.line.id),
        pages: [{ path: 'temp://project-line.png', width: 720, height: 360 }] }],
    }
    reportPageDefinition.handleReportBridgeResult.call(parent, result, active)
    reportPageDefinition.handleReportBridgeBackComplete.call(parent, {
      bridge: active.bridge, ticket: active.ticket, fingerprint, revision: active.revision,
    }, active)
    parent.onShow()
    assert.equal(pending(), 1, 'a completed success result should own one pending settle timer')
    if (terminalAction === 'cancel') parent.cancelReportGeneration()
    else parent.onUnload()
    assert.equal(pending(), 0, `${terminalAction} must clear the settle timer`)
    advance(500)
    assert.equal(parent.dispatched, undefined, `${terminalAction} must prevent late route dispatch`)
    if (terminalAction === 'cancel') assert.equal(parent.data.isGenerating, false)
    else assert.equal(parent._unloaded, true)
  })
}

console.log('Report bridge checks passed (batch line coverage, cancellation ownership, late callback, dual return signals, 500 ms route settling, and timer cleanup).')

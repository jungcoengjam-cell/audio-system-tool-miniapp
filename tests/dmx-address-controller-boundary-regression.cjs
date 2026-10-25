'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const currentPagePath = path.join(root, 'pages/dmx-address/dmx-address.js')
const beforePagePath = path.join(root, 'tmp/architecture-continuation-2026-10-25/before/pages/dmx-address/dmx-address.js')
const frozenTracePath = path.join(root, 'tmp/architecture-continuation-2026-10-25/phase4-dmx/before-event-trace.json')
const FROZEN_BASELINE_SHA256 = '5645869d4b3ef2e8f8a38e8dfd577fae0332c27ff96b880f81b12bdecd47c262'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function createTimerRuntime(name, events) {
  let nextId = 0
  const tasks = new Map()
  return {
    tasks,
    setTimeout(callback, delay) {
      const id = `${name}-${++nextId}`
      tasks.set(id, { callback, delay, cleared: false })
      events.push({ type: 'setTimeout', runtime: name, id, delay })
      return id
    },
    clearTimeout(id) {
      events.push({ type: 'clearTimeout', runtime: name, id: id ?? null })
      if (tasks.has(id)) tasks.get(id).cleared = true
    },
    run(id, force = false) {
      const task = tasks.get(id)
      if (!task) throw new Error(`unknown timer: ${id}`)
      events.push({ type: 'runTimeout', runtime: name, id, force, cleared: task.cleared })
      if (!task.cleared || force) task.callback()
      tasks.delete(id)
    },
  }
}

function createWxRuntime(name, selectorQueries, selectorQueryHistory, events) {
  const api = {}
  api.createSelectorQuery = function createSelectorQuery() {
    const record = { runtime: name, receiverMatches: this === api, selector: '', execCount: 0, callback: null, callbackRan: false }
    selectorQueries.push(record)
    selectorQueryHistory.push(record)
    const query = {
      in(page) { record.pageMatches = Boolean(page && page._qaName); return query },
      select(selector) { record.selector = selector; return query },
      boundingClientRect(callback) { record.callback = callback; return query },
      exec() { record.execCount += 1; return query },
    }
    return query
  }
  api.disableAlertBeforeUnload = function disableAlertBeforeUnload() {
    events.push({ type: 'disableAlertBeforeUnload', runtime: name, receiverMatches: this === api })
  }
  api.hideLoading = function hideLoading() {
    events.push({ type: 'hideLoading', runtime: name, receiverMatches: this === api })
  }
  return api
}

function makeDate(now) {
  return class RuntimeDate extends Date {
    static now() { return now() }
  }
}

function createEnvironment(sourcePath) {
  const timerEvents = []
  const selectorQueries = []
  const selectorQueryHistory = []
  const wxEvents = []
  const timerA = createTimerRuntime('initial', timerEvents)
  const timerB = createTimerRuntime('replacement', timerEvents)
  const clock = { now: 100 }
  const wxA = createWxRuntime('initial', selectorQueries, selectorQueryHistory, wxEvents)
  const wxB = createWxRuntime('replacement', selectorQueries, selectorQueryHistory, wxEvents)
  let definition = null
  const initialGlobalWx = global.wx
  const noOp = () => {}
  global.wx = new Proxy({
    getStorageSync: () => undefined,
    setStorageSync: noOp,
    removeStorageSync: noOp,
    hideLoading: noOp,
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
    getMenuButtonBoundingClientRect: () => ({ left: 293, right: 380, top: 28, bottom: 60, width: 87, height: 32 }),
  }, { get: (target, key) => key in target ? target[key] : noOp })
  const sandbox = {
    Page(value) { definition = value },
    wx: wxA,
    Date: makeDate(() => clock.now),
    setTimeout: timerA.setTimeout,
    clearTimeout: timerA.clearTimeout,
    getCurrentPages: () => [],
    getApp: () => ({ globalData: { theme: 'light' } }),
    console,
    require: Module.createRequire(sourcePath),
    module: { exports: {} },
    exports: {},
  }
  try {
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: sourcePath, timeout: 10000 })
  } catch (error) {
    global.wx = initialGlobalWx
    throw error
  }
  assert.ok(definition && definition.data, `DMX page did not register from ${sourcePath}`)
  return {
    definition,
    sandbox,
    clock,
    timerA,
    timerB,
    timerEvents,
    selectorQueries,
    selectorQueryHistory,
    wxA,
    wxB,
    wxEvents,
    restoreHostWx() {
      if (initialGlobalWx === undefined) delete global.wx
      else global.wx = initialGlobalWx
    },
  }
}

function makePage(definition, name) {
  const patches = []
  const callbacks = []
  const page = {
    ...definition,
    _qaName: name,
    data: clone(definition.data),
    _qaPatches: patches,
    _qaCallbacks: callbacks,
    _qaDeferCallbacks: false,
    setData(patch, callback) {
      const copied = clone(patch)
      patches.push(copied)
      Object.assign(this.data, copied)
      if (!callback) return
      if (this._qaDeferCallbacks) callbacks.push(() => callback.call(this))
      else callback.call(this)
    },
    flushCallbacks() {
      const pending = callbacks.splice(0)
      pending.forEach((callback) => callback())
      return pending.length
    },
  }
  return page
}

function touch(point) {
  return { clientX: point.x, clientY: point.y }
}

function touchEvent(index, points, changed = points) {
  return {
    currentTarget: { dataset: { index } },
    touches: points.map(touch),
    changedTouches: changed.map(touch),
  }
}

function summarizeGroup(page) {
  return {
    activeGesture: Boolean(page._groupTouchStart),
    token: page._touchGestureToken,
    suppressUntil: page._suppressFloatingOpenUntil || 0,
    swipedGroupIndex: page.data.swipedGroupIndex,
    swipeDragIndex: page.data.swipeDragIndex,
    swipeDragOffset: page.data.swipeDragOffset,
    swipeDragging: page.data.swipeDragging,
  }
}

function runSheetScenario(page, runtime) {
  const finalized = []
  const steps = []
  page._pageAlive = true
  page._pageVisible = true
  page._contextId = 'context-A'
  page._workspaceRevision = 1
  page._sheetCloseTimers = Object.create(null)
  page._sheetCloseTokens = Object.create(null)
  page.data.fixtureSearchOpen = true
  page.data.fixtureSearchGroupIndex = 0
  page.data.fixtureSearchSelectedModel = 'fixture-a'
  page.data.fixturePickerClosing = false

  assert.equal(page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => finalized.push('initial')), true)
  const initialTimer = page._sheetCloseTimers.fixturePicker
  steps.push({ phase: 'initial-close', timer: initialTimer, token: page._sheetCloseTokens.fixturePicker })

  runtime.sandbox.setTimeout = runtime.timerB.setTimeout
  runtime.sandbox.clearTimeout = runtime.timerB.clearTimeout
  runtime.clock.now = 333
  runtime.sandbox.Date = makeDate(() => runtime.clock.now)
  runtime.sandbox.wx = runtime.wxB

  page.openSheetModal('fixturePicker', 'fixturePickerClosing')
  runtime.timerA.run(initialTimer, true)
  steps.push({ phase: 'runtime-replaced', closing: page.data.fixturePickerClosing, finalized: finalized.slice() })

  const cancelledClose = page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => finalized.push('cancelled-close'))
  assert.equal(cancelledClose, true)
  const cancelledCloseTimer = page._sheetCloseTimers.fixturePicker
  page.cancelSheetClose('fixturePicker', 'fixturePickerClosing')
  runtime.timerB.run(cancelledCloseTimer, true)
  steps.push({ phase: 'cancelled-close', closing: page.data.fixturePickerClosing, finalized: finalized.slice() })

  const staleRepeated = page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => finalized.push('stale-repeat'))
  assert.equal(staleRepeated, true)
  const staleRepeatedTimer = page._sheetCloseTimers.fixturePicker
  const latestRepeated = page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => finalized.push('latest-repeat'))
  assert.equal(latestRepeated, true)
  const latestRepeatedTimer = page._sheetCloseTimers.fixturePicker
  runtime.timerB.run(staleRepeatedTimer, true)
  steps.push({ phase: 'repeated-stale', finalized: finalized.slice(), closing: page.data.fixturePickerClosing })
  runtime.timerB.run(latestRepeatedTimer)
  steps.push({ phase: 'repeated-latest', finalized: finalized.slice(), closing: page.data.fixturePickerClosing })

  const hiddenTimerStarted = page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => finalized.push('hidden-late'))
  assert.equal(hiddenTimerStarted, true)
  const hiddenTimer = page._sheetCloseTimers.fixturePicker
  page.onHide()
  runtime.timerB.run(hiddenTimer, true)
  steps.push({ phase: 'hidden-late', alive: page._pageAlive, visible: page._pageVisible, finalized: finalized.slice() })

  page._pageAlive = true
  page._pageVisible = true
  page.data.fixturePickerClosing = false
  const unloadTimerStarted = page.beginSheetClose('fixturePicker', 'fixturePickerClosing', () => finalized.push('unload-late'))
  assert.equal(unloadTimerStarted, true)
  const unloadTimer = page._sheetCloseTimers.fixturePicker
  page.onUnload()
  runtime.timerB.run(unloadTimer, true)
  steps.push({ phase: 'unload-late', alive: page._pageAlive, visible: page._pageVisible, finalized: finalized.slice() })

  return {
    steps,
    finalized,
    patches: page._qaPatches,
    timers: runtime.timerEvents.slice(),
    tokens: page._sheetCloseTokens,
    timerHandles: page._sheetCloseTimers,
    wxEvents: runtime.wxEvents.slice(),
  }
}

function runGroupScenario(page, runtime) {
  page._pageAlive = true
  page._pageVisible = true
  page._contextId = 'context-A'
  page._workspaceRevision = 1
  page._touchGestureToken = 0
  page.data.groups = [{ _lightingGroupId: 'group-A' }]
  page.data.groupCards = [{ _lightingGroupId: 'group-A' }]
  page.data.swipedGroupIndex = -1
  const phases = []

  page.onGroupTouchStart({
    currentTarget: { dataset: { index: 0 } },
    target: { tagName: 'INPUT' },
    touches: [{ clientX: 100, clientY: 100 }],
    changedTouches: [],
  })
  phases.push({ phase: 'ignored-input', state: summarizeGroup(page), patches: page._qaPatches.slice() })

  page.onGroupTouchStart(touchEvent(0, [{ x: 100, y: 100 }]))
  page.onGroupTouchMove(touchEvent(0, [{ x: 48, y: 101 }]))
  page.onGroupTouchEnd(touchEvent(0, [], [{ x: 48, y: 101 }]))
  phases.push({ phase: 'horizontal', state: summarizeGroup(page), patches: page._qaPatches.slice() })

  page.data.swipedGroupIndex = -1
  page.onGroupTouchStart(touchEvent(0, [{ x: 100, y: 100 }]))
  page.onGroupTouchMove(touchEvent(0, [{ x: 102, y: 140 }]))
  page.onGroupTouchEnd(touchEvent(0, [], [{ x: 102, y: 140 }]))
  phases.push({ phase: 'vertical', state: summarizeGroup(page), patches: page._qaPatches.slice() })

  runtime.clock.now = 777
  page.onGroupTouchStart(touchEvent(0, [{ x: 100, y: 100 }]))
  page.onGroupTouchMove(touchEvent(0, [{ x: 70, y: 101 }, { x: 70, y: 101 }]))
  phases.push({ phase: 'multi-touch-cancel', state: summarizeGroup(page), patches: page._qaPatches.slice() })

  page.onGroupTouchStart(touchEvent(0, [{ x: 100, y: 100 }]))
  page._workspaceRevision += 1
  page.onGroupTouchMove(touchEvent(0, [{ x: 40, y: 100 }]))
  phases.push({ phase: 'revision-change', state: summarizeGroup(page), patches: page._qaPatches.slice() })

  assert.equal(phases[1].state.swipedGroupIndex, 0)
  assert.equal(phases[2].state.swipeDragging, false)
  assert.equal(phases[3].state.activeGesture, false)
  assert.equal(phases[3].state.suppressUntil, runtime.clock.now + 550)
  assert.equal(phases[4].state.activeGesture, false)
  return { phases, patches: page._qaPatches }
}

function runFloatingScenario(page, runtime) {
  const timerEventStart = runtime.timerEvents.length
  const wxEventStart = runtime.wxEvents.length
  runtime.clock.now = 2000
  page._pageAlive = true
  page._pageVisible = true
  page._suppressFloatingOpenUntil = 0
  page._floatingTransitionId = 0
  page._floatingPositionRequestId = 0
  page._floatingTransitionTimer = null
  page._floatingOrigin = null
  page._floatingClosing = false
  page.data.windowWidth = 390
  page.data.windowHeight = 844
  page.data.overlaySafeTop = 76
  page.data.overlaySafeBottom = 12
  page.data.groupCards = [
    { groupIndex: 0, _lightingGroupId: 'group-A', fixtureChips: [], hasChannelGuide: false },
    { groupIndex: 1, _lightingGroupId: 'group-B', fixtureChips: [], hasChannelGuide: false },
  ]
  page._qaDeferCallbacks = true

  page.openFloatingCard({ currentTarget: { dataset: { index: 0 } } })
  page.openFloatingCard({ currentTarget: { dataset: { index: 1 } } })
  const [staleQuery, currentQuery] = runtime.selectorQueries.splice(0, 2)
  if (staleQuery.callback) {
    staleQuery.callbackRan = true
    staleQuery.callback({ left: 1, top: 2, width: 20, height: 30 })
  }
  if (currentQuery.callback) {
    currentQuery.callbackRan = true
    currentQuery.callback({ left: 6, top: 28, width: 180, height: 110 })
  }
  page.flushCallbacks()
  const openingTimer = page._floatingTransitionTimer
  page.closeFloatingCard()
  const closingTimer = page._floatingTransitionTimer
  page.openFloatingCard({ currentTarget: { dataset: { index: 0 } } })
  const reopenedQuery = runtime.selectorQueries.shift()
  runtime.timerB.run(openingTimer, true)
  runtime.timerB.run(closingTimer, true)
  if (reopenedQuery.callback) {
    reopenedQuery.callbackRan = true
    reopenedQuery.callback({ left: 12, top: 34, width: 190, height: 120 })
  }
  page.flushCallbacks()
  const finalOpeningTimer = page._floatingTransitionTimer
  runtime.timerB.run(finalOpeningTimer)

  assert.equal(page.data.floatingGroup._lightingGroupId, 'group-A')
  assert.equal(page.data.floatingVisible, true)
  assert.equal(runtime.selectorQueries.length, 0)
  assert.equal(runtime.wxEvents.filter((item) => item.type === 'createSelectorQuery').every((item) => item.runtime === 'replacement' && item.receiverMatches), true)
  return {
    patches: page._qaPatches,
    selectors: runtime.selectorQueryHistory.map(({ runtime: source, receiverMatches, selector, execCount, callbackRan, pageMatches }) => ({
      runtime: source, receiverMatches, selector, execCount, callbackRan, pageMatches,
    })),
    wxEvents: runtime.wxEvents.slice(wxEventStart),
    timers: runtime.timerEvents.slice(timerEventStart),
    state: {
      groupId: page.data.floatingGroup?._lightingGroupId || '',
      visible: page.data.floatingVisible,
      style: page.data.floatingStyle,
      closing: page._floatingClosing,
      transitionId: page._floatingTransitionId,
      positionRequestId: page._floatingPositionRequestId,
      timer: page._floatingTransitionTimer,
    },
  }
}

function runScenario(sourcePath) {
  const runtime = createEnvironment(sourcePath)
  try {
    const sheetPage = makePage(runtime.definition, 'sheet')
    const sheet = runSheetScenario(sheetPage, runtime)

    const groupPage = makePage(runtime.definition, 'group')
    const group = runGroupScenario(groupPage, runtime)

    const floatingPage = makePage(runtime.definition, 'floating')
    const floating = runFloatingScenario(floatingPage, runtime)

    return { sheet, group, floating }
  } finally {
    runtime.restoreHostWx()
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const trace = runScenario(process.argv.includes('--capture-before') ? beforePagePath : currentPagePath)
const actualDigest = digest(trace)

if (process.argv.includes('--capture-before')) {
  fs.mkdirSync(path.dirname(frozenTracePath), { recursive: true })
  fs.writeFileSync(frozenTracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ captured: frozenTracePath, sha256: actualDigest }, null, 2))
} else {
  assert.equal(actualDigest, FROZEN_BASELINE_SHA256, 'DMX controller event trace changed from the frozen pre-extraction page')
  if (process.argv.includes('--compare-before')) {
    const beforeTrace = runScenario(beforePagePath)
    assert.deepEqual(trace, beforeTrace, 'current DMX controller trace differs from the original Page')
    console.log(JSON.stringify({
      currentSha256: actualDigest,
      beforeSha256: digest(beforeTrace),
      matchedBefore: true,
    }, null, 2))
  } else {
    console.log(JSON.stringify({ sha256: actualDigest, frozenTrace: 'matched' }, null, 2))
  }
}

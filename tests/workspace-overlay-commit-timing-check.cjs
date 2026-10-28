'use strict'

const assert = require('node:assert/strict')
const { createWorkspaceOverlayMethods } = require('../pages/project-wiring/workspace-overlays')

function createHarness(initial = {}) {
  const commits = []
  const nextTicks = []
  const timers = new Map()
  const events = []
  let timerId = 0
  const wx = {
    nextTick(callback) {
      events.push('nextTick-scheduled')
      nextTicks.push(callback)
    },
  }
  const runtime = {
    wx,
    setTimeout(callback, delay) {
      const id = ++timerId
      timers.set(id, { callback, delay })
      events.push(`timer-${delay}`)
      return id
    },
    clearTimeout(id) { timers.delete(id) },
  }
  const page = {
    data: {
      workspaceOverlayPhases: {
        report: '', newProject: '', projectPicker: '',
      },
      reportPreviewVisible: false,
      newProjectVisible: false,
      projectPickerVisible: false,
      ...initial,
    },
    _workspaceOverlayTimers: Object.create(null),
    _workspaceOverlayEpochs: Object.create(null),
    _destroyed: false,
    closeWorkspaceSwipeRow() {},
    clearWorkspaceRetiringRow() {},
    setData(changes, callback) {
      Object.keys(changes).forEach((key) => {
        const parts = key.split('.')
        if (parts.length === 1) this.data[key] = changes[key]
        else {
          let target = this.data
          while (parts.length > 1) target = target[parts.shift()]
          target[parts[0]] = changes[key]
        }
      })
      if (callback) {
        events.push('commit-queued')
        commits.push(callback)
      }
    },
  }
  Object.assign(page, createWorkspaceOverlayMethods({}, runtime))
  return {
    page, commits, nextTicks, timers, events,
    flushCommit() {
      const callback = commits.shift()
      assert.ok(callback, 'a pending view commit callback is available')
      callback()
    },
    flushNextTick() {
      const callback = nextTicks.shift()
      assert.ok(callback, 'a pending nextTick callback is available')
      callback()
    },
    runTimer(delay) {
      const [id, task] = [...timers.entries()].find(([, entry]) => entry.delay === delay) || []
      assert.ok(task, `a ${delay}ms timer is available`)
      timers.delete(id)
      task.callback()
    },
  }
}

function checkNewOverlayWaitsForEachCommit() {
  const h = createHarness()
  h.page.beginWorkspaceOverlay('report', { reportPreviewVisible: true })
  assert.equal(h.page.data.workspaceOverlayPhases.report, 'preparing')
  assert.equal(h.nextTicks.length, 0, 'preparing does not advance before its setData commit')
  assert.equal(h.timers.size, 0, 'no phase timer starts before the first view commit')

  h.flushCommit()
  assert.equal(h.nextTicks.length, 1, 'the preparing view commit schedules the opening tick')
  assert.equal(h.timers.size, 0)
  h.flushNextTick()
  assert.equal(h.page.data.workspaceOverlayPhases.report, 'opening')
  assert.equal(h.timers.size, 0, 'opening duration does not start before its own view commit')

  h.flushCommit()
  assert.deepEqual([...h.timers.values()].map((task) => task.delay), [300], 'opening uses the existing 300ms duration after commit')
}

function checkMountedOverlayStartsTimerAfterCommit() {
  const h = createHarness({
    workspaceOverlayPhases: { report: 'closing', newProject: '', projectPicker: '' },
    reportPreviewVisible: true,
  })
  h.page.beginWorkspaceOverlay('report')
  assert.equal(h.page.data.workspaceOverlayPhases.report, 'opening')
  assert.equal(h.timers.size, 0, 'already-mounted opening waits for setData commit')
  h.flushCommit()
  assert.deepEqual([...h.timers.values()].map((task) => task.delay), [300])
}

function checkTransitionWaitsForCommitAndPreservesCloseEpoch() {
  let closeFinished = false
  const h = createHarness({
    workspaceOverlayPhases: { report: 'opening', newProject: '', projectPicker: '' },
    reportPreviewVisible: true,
  })
  h.page.transitionWorkspaceOverlays(['report'], 'newProject', { newProjectVisible: true }, () => {
    closeFinished = true
  })
  assert.equal(h.page.data.workspaceOverlayPhases.report, 'closing')
  assert.equal(h.page.data.workspaceOverlayPhases.newProject, 'preparing')
  assert.equal(h.timers.size, 0, 'transition schedules neither phase timer before the combined commit')
  assert.equal(h.nextTicks.length, 0)

  h.flushCommit()
  assert.deepEqual([...h.timers.values()].map((task) => task.delay), [240], 'close timer starts after commit')
  assert.equal(h.nextTicks.length, 1, 'new overlay opening begins after the same commit')
  h.flushNextTick()
  assert.equal(h.page.data.workspaceOverlayPhases.newProject, 'opening')
  assert.deepEqual([...h.timers.values()].map((task) => task.delay), [240], 'new opening timer waits for its phase commit')
  h.flushCommit()
  assert.deepEqual([...h.timers.values()].map((task) => task.delay).sort((a, b) => a - b), [240, 300])

  h.runTimer(240)
  assert.equal(closeFinished, false, 'onClosed waits for the closing phase clear commit')
  h.flushCommit()
  assert.equal(closeFinished, true, 'onClosed runs after close animation and phase clear commit')
}

function checkEpochAndDestroyGuardsStillCancelDeferredWork() {
  const stale = createHarness()
  stale.page.beginWorkspaceOverlay('report')
  stale.page.beginWorkspaceOverlay('report')
  stale.flushCommit()
  assert.equal(stale.nextTicks.length, 0, 'a stale preparing commit cannot advance a newer epoch')
  stale.flushCommit()
  assert.equal(stale.timers.size, 1, 'the current mounted epoch starts only its committed opening timer')

  const destroyed = createHarness()
  destroyed.page.beginWorkspaceOverlay('report')
  destroyed.page._destroyed = true
  destroyed.flushCommit()
  assert.equal(destroyed.nextTicks.length, 0, 'destroyed pages do not advance deferred opening work')
  assert.equal(destroyed.timers.size, 0, 'destroyed pages do not start phase timers')
}

checkNewOverlayWaitsForEachCommit()
checkMountedOverlayStartsTimerAfterCommit()
checkTransitionWaitsForCommitAndPreservesCloseEpoch()
checkEpochAndDestroyGuardsStillCancelDeferredWork()
console.log('Workspace overlay commit timing check passed (async view commits, unchanged durations, and stale/destroyed guards).')

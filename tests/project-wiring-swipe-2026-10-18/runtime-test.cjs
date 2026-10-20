const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, makeFixture, root } = require('../project-wiring-redesign-2026-10-16/runtime.cjs')
const { buildWorkspace } = require('../../pages/project-wiring/workspace-model')

const projectStorageKey = 'audioTool.projects.v1'
const workspaceUi = fs.readFileSync(path.join(root, 'pages/project-wiring/workspace-ui.js'), 'utf8')
const workspaceMarkup = fs.readFileSync(path.join(root, 'pages/project-wiring/workspace.wxml'), 'utf8')
const workspaceStyle = fs.readFileSync(path.join(root, 'pages/project-wiring/workspace.wxss'), 'utf8')
const reducedMotionStart = workspaceStyle.indexOf('@media (prefers-reduced-motion:reduce){')
const reducedMotionEnd = workspaceStyle.indexOf('\n}', reducedMotionStart)
const reducedMotionBlock = workspaceStyle.slice(reducedMotionStart, reducedMotionEnd)

function seededPage(env, workspaceTab = 'devices') {
  const page = env.page()
  const fixture = makeFixture()
  page.projectId = fixture.id
  page._projectLoadRevision = 3
  page._schedule = fixture.wiringSchedule
  page._workspace = buildWorkspace(page._schedule)
  page.setData({
    project: { id: fixture.id, name: fixture.name }, loading: false, saving: false,
    projectCreating: false, workspaceTab, scheduleRevision: page._schedule.revision,
  })
  page.refreshWorkspace()
  return page
}

function swipeTarget(type, id, groupIndex = 0) {
  return { dataset: { swipeType: type, swipeId: id, groupIndex, retiring: false } }
}

function start(page, type, id, x = 200, y = 24, groupIndex = 0) {
  const currentTarget = swipeTarget(type, id, groupIndex)
  page.onSwipeTouchStart({ currentTarget, touches: [{ identifier: 0, clientX: x, clientY: y }] })
  return currentTarget
}

function move(page, x, y = 24) {
  page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: x, clientY: y }] })
}

function end(page, currentTarget, x, y = 24) {
  page.onSwipeTouchEnd({ currentTarget, changedTouches: [{ identifier: 0, clientX: x, clientY: y }] })
}

function swipeRow(page, type, id, groupIndex = 0) {
  const target = start(page, type, id, 220, 24, groupIndex)
  move(page, 80, 26)
  end(page, target, 80, 26)
}

function actionTap(dataset, withTouch = false) {
  const event = { type: 'tap', currentTarget: { dataset }, target: { dataset } }
  if (withTouch) event.changedTouches = [{ identifier: 0 }]
  return event
}

function projectWrites(env) {
  return env.events.writes.filter((write) => write.key === projectStorageKey)
}

async function main() {
  assert.doesNotMatch(workspaceUi, /SWIPE_SET_DATA_INTERVAL|_workspaceSwipeTimer|_workspaceSwipePending|queueWorkspaceSwipeOffset/)
  assert.match(workspaceMarkup, /style="transform:translateX\(\{\{72 - item\.swipeOffset\}\}px\);"/)
  assert.match(workspaceMarkup, /style="transform:translateX\(\{\{72 - line\.swipeOffset\}\}px\);"/)
  assert.doesNotMatch(workspaceMarkup, /class="workspace-swipe-actions[^"]*" style="width:/)
  assert.match(workspaceStyle, /\.workspace-swipe-actions\{[^}]*width:72px;height:44px;[^}]*overflow:hidden;[^}]*background:transparent/)
  assert.match(workspaceStyle, /\.workspace-swipe-content\{[^}]*transition:transform 200ms ease/)
  assert.match(workspaceStyle, /\.workspace-swipe-row-dragging button\.workspace-swipe-delete\{[^}]*transition:none!important/)
  assert.ok(reducedMotionStart >= 0 && reducedMotionEnd > reducedMotionStart, 'reduced-motion rules are present')
  assert.match(reducedMotionBlock, /\.workspace-swipe-content[^}]*transition-duration:0s!important/)
  assert.match(reducedMotionBlock, /\.wiring-page button\.workspace-swipe-delete\{transition-duration:0s!important\}/)

  {
    const env = createRuntime()
    const page = seededPage(env)
    const device = page.data.devices[0]
    const patches = []
    const setData = page.setData
    page.setData = function(patch, callback) {
      patches.push(patch)
      return setData.call(this, patch, callback)
    }

    const target = start(page, 'device', device.id)
    move(page, 193)
    assert.equal(page.data.devices[0].swipeOffset, 7, 'the row begins responding at the 7px start threshold')
    assert.equal(page.data.devices[0].swipeDragging, true)
    assert.equal(patches.at(-1)['devices[0].swipeOffset'], 7, 'the first accepted move is sent to setData immediately')
    move(page, 176)
    assert.equal(page.data.devices[0].swipeOffset, 24, 'the next touchmove is reflected without waiting for a timer')
    assert.equal(patches.at(-1)['devices[0].swipeOffset'], 24, 'every accepted move updates the row')
    end(page, target, 176)
    assert.equal(page.data.devices[0].swipeOffset, 0, 'a partial opening under half width snaps closed')
    assert.equal(page.data.devices[0].swipeOpen, false)
    assert.equal(page.data.devices[0].swipeDragging, false)

    const fullTarget = start(page, 'device', device.id)
    move(page, 80)
    assert.equal(page.data.devices[0].swipeOffset, 72, 'dragging clamps at the capsule width')
    end(page, fullTarget, 80)
    assert.equal(page.data.devices[0].swipeOffset, 72, 'a full opening settles at 72px')
    assert.equal(page.data.devices[0].swipeOpen, true)

    const closeTarget = start(page, 'device', device.id)
    move(page, 237)
    assert.equal(page.data.devices[0].swipeOffset, 35, 'a closing drag also follows each move')
    end(page, closeTarget, 237)
    assert.equal(page.data.devices[0].swipeOffset, 0, 'a drag ending below half width settles at zero')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = seededPage(env)
    const device = page.data.devices[0]
    let target = start(page, 'device', device.id)
    move(page, 180)
    assert.equal(page.data.devices[0].swipeOffset, 20)
    page.onSwipeTouchCancel({ currentTarget: target, changedTouches: [{ identifier: 0, clientX: 180, clientY: 24 }] })
    assert.equal(page._workspaceSwipeGesture, null, 'touchcancel clears the active row gesture')
    assert.equal(page._workspaceOpenSwipe, null, 'touchcancel returns a partially revealed row to closed')
    assert.equal(page.data.devices[0].swipeOffset, 0)

    target = start(page, 'device', device.id)
    move(page, 202, 31)
    assert.equal(page._workspaceSwipeGesture.axis, 'vertical', 'vertical movement keeps the list scroll direction')
    assert.equal(page.data.devices[0].swipeOffset, 0, 'vertical scrolling does not reveal the delete action')
    end(page, target, 202, 31)
    assert.equal(page._workspaceOpenSwipe, null)

    swipeRow(page, 'device', device.id)
    const line = page._schedule.lines[0]
    const groupIndex = page.data.groups.findIndex((group) => group.lines.some((item) => item.id === line.id))
    const lineTarget = start(page, 'line', line.id, 220, 24, groupIndex)
    assert.equal(page.data.devices[0].swipeOffset, 0, 'starting a different row closes the previously open device')
    move(page, 80)
    end(page, lineTarget, 80)
    assert.equal(page._workspaceOpenSwipe.key, `line:${line.id}`, 'the newly touched line becomes the only open row')
    page.onWorkspaceBackgroundTap({})
    assert.equal(page._workspaceOpenSwipe, null, 'a background tap closes the open line')
    assert.equal(page.data.groups[groupIndex].lines.find((item) => item.id === line.id).swipeOffset, 0)

    swipeRow(page, 'device', device.id)
    target = start(page, 'device', device.id)
    move(page, 190)
    page.onHide()
    assert.equal(page._workspaceSwipeGesture, null, 'page hide clears an in-progress row gesture')
    assert.equal(page._workspaceOpenSwipe, null, 'page hide closes the revealed row')
    assert.equal(page.data.devices[0].swipeOffset, 0)
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = seededPage(env)
    const device = page.data.devices[0]
    start(page, 'device', device.id)
    move(page, 190)
    page.onUnload()
    assert.equal(page._workspaceSwipeGesture, null, 'page unload clears an in-progress row gesture')
    assert.equal(page._workspaceSwipeTimer, undefined, 'the removed batching timer leaves no pending lifecycle work')
    assert.equal(page._workspaceSwipePending, undefined)
  }

  {
    const env = createRuntime()
    const page = seededPage(env, 'lines')
    const line = page._schedule.lines[0]
    const groupIndex = page.data.groups.findIndex((group) => group.lines.some((item) => item.id === line.id))
    const action = {
      deleteType: 'line', actionType: 'delete', projectId: page.projectId,
      id: line.id, revision: page._schedule.revision,
    }
    swipeRow(page, 'line', line.id, groupIndex)
    page.deleteWorkspaceRecord(actionTap(action))
    assert.equal(env.events.modals.length, 0, 'the synthetic tap after swiping cannot activate Delete')

    const deliberateTap = start(page, 'line', line.id, 140, 24, groupIndex)
    end(page, deliberateTap, 140)
    const writesBeforeConfirmation = projectWrites(env).length
    page.deleteWorkspaceRecord(actionTap(action, true))
    assert.equal(env.events.modals.length, 1, 'a fresh deliberate tap reaches the delete confirmation')
    assert.equal(projectWrites(env).length, writesBeforeConfirmation, 'requesting confirmation does not write the project')
    env.respondModal(false)
    assert.equal(page._schedule.lines.some((item) => item.id === line.id), true, 'cancel leaves the line intact')
    assert.equal(projectWrites(env).length, writesBeforeConfirmation, 'canceling confirmation performs no project write')
    page.onUnload()
  }

  console.log('project wiring swipe runtime regression passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

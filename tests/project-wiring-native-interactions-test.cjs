const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime } = require('./project-wiring-redesign-2026-10-16/runtime.cjs')
const projectWiring = require('../utils/project-wiring')
const { buildWorkspace } = require('../pages/project-wiring/workspace-model')

const root = path.resolve(__dirname, '..')
const workspaceMarkup = fs.readFileSync(path.join(root, 'pages/project-wiring/workspace.wxml'), 'utf8')
const indexMarkup = fs.readFileSync(path.join(root, 'pages/project-wiring/index.wxml'), 'utf8')
const workspaceStyle = fs.readFileSync(path.join(root, 'pages/project-wiring/workspace.wxss'), 'utf8')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function deferRenderCommits(page) {
  const callbacks = []
  const setData = page.setData
  page.setData = function(patch, callback) {
    const result = setData.call(this, patch)
    if (typeof callback === 'function') callbacks.push(callback)
    return result
  }
  return {
    pending: () => callbacks.length,
    flushAll() {
      let flushed = 0
      while (callbacks.length) {
        callbacks.shift()()
        flushed += 1
      }
      return flushed
    },
  }
}

function tapEvent(dataset = {}, identifier = 0) {
  return { currentTarget: { dataset }, target: { dataset }, changedTouches: [{ identifier }] }
}

function actionTapEvent(dataset = {}, withChangedTouches = false) {
  const event = { currentTarget: { dataset }, target: { dataset } }
  if (withChangedTouches) event.changedTouches = [{ identifier: 0 }]
  return event
}

function swipeRow(page, type, id) {
  const currentTarget = { dataset: { swipeType: type, swipeId: id, retiring: false } }
  page.onSwipeTouchStart({ currentTarget, touches: [{ identifier: 0, clientX: 220, clientY: 30 }] })
  page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: 80, clientY: 32 }] })
  page.onSwipeTouchEnd({ currentTarget, changedTouches: [{ identifier: 0, clientX: 80, clientY: 32 }] })
}

function tapRow(page, type, id) {
  const currentTarget = { dataset: { swipeType: type, swipeId: id, retiring: false } }
  page.onSwipeTouchStart({ currentTarget, touches: [{ identifier: 0, clientX: 120, clientY: 30 }] })
  page.onSwipeTouchEnd({ currentTarget, changedTouches: [{ identifier: 0, clientX: 120, clientY: 30 }] })
}

async function run() {
  const groupHeader = workspaceMarkup.match(/<view class="workspace-group-header"[^>]*>/)?.[0] || ''
  assert.match(groupHeader, /catchtap="toggleGroup"/)
  assert.doesNotMatch(groupHeader, /bindtap="toggleGroup"/)
  assert.doesNotMatch(groupHeader, /onLineTouch/)
  const groupSwipeRow = workspaceMarkup.match(/<view class="workspace-swipe-row workspace-group-swipe-row[^>]*>/)?.[0] || ''
  assert.match(groupSwipeRow, /data-swipe-type="group"/)
  assert.match(groupSwipeRow, /data-swipe-id="\{\{group\.key\}\}"/)
  assert.match(groupSwipeRow, /data-swipe-revision="\{\{scheduleRevision\}\}"/)
  assert.match(groupSwipeRow, /bindtouchstart="onSwipeTouchStart"/)
  assert.match(groupSwipeRow, /bindtouchmove="onSwipeTouchMove"/)
  assert.match(groupSwipeRow, /bindtouchend="onSwipeTouchEnd"/)
  assert.match(groupSwipeRow, /bindtouchcancel="onSwipeTouchCancel"/)
  assert.match(groupSwipeRow, /catchtap="stopEvent"/)
  assert.match(workspaceMarkup, /loadErrorTitle === '请选择项目' && selectionRequired && !canRetry && !project/)
  assert.match(workspaceMarkup, /class="workspace-line-group-inner"/)
  assert.match(workspaceMarkup, /workspace-line-group-retiring-exit/)
  assert.match(workspaceMarkup, /catchtap="deleteWorkspaceRecord"/)
  assert.match(workspaceMarkup, /catchtap="connectDevice"/)
  const deleteButtons = [...workspaceMarkup.matchAll(/<button[^>]*class="workspace-swipe-delete"[^>]*>/g)].map((match) => match[0])
  assert.equal(deleteButtons.length, 3)
  deleteButtons.forEach((button) => {
    assert.match(button, /catchtap="deleteWorkspaceRecord"/)
    assert.doesNotMatch(button, /(?:bind|catch)touch(?:start|move|end|cancel)=/)
  })
  const groupDeleteButton = deleteButtons.find((button) => button.includes('data-delete-type="group"')) || ''
  assert.match(groupDeleteButton, /aria-label="删除\{\{group\.headerRouteLabel\}\}的全部\{\{group\.lineCount\}\}条线路"/)
  assert.doesNotMatch(groupDeleteButton, /group\.fromDevice|group\.toDevice/)
  assert.match(groupDeleteButton, /disabled="\{\{!group\.swipeOpen \|\| saving \|\| workspaceDeletingId === group\.key\}\}"/)
  const groupDeleteMarkup = workspaceMarkup.match(/<button[^>]*data-delete-type="group"[^>]*>[\s\S]*?<\/button>/)?.[0] || ''
  assert.match(groupDeleteMarkup, /<view class="workspace-swipe-delete-icon" \/>/)
  const connectButton = workspaceMarkup.match(/<button[^>]*class="workspace-connect-button"[^>]*>/)?.[0] || ''
  assert.match(connectButton, /catchtap="connectDevice"/)
  assert.doesNotMatch(connectButton, /(?:bind|catch)touch(?:start|move|end|cancel)=/)
  const deviceNameAction = workspaceMarkup.match(/<view[^>]*class="workspace-device-name-action"[^>]*>[\s\S]*?<\/view>/)?.[0] || ''
  assert.match(deviceNameAction, /data-action-type="rename-device"/)
  assert.match(deviceNameAction, /data-project-id="\{\{project\.id\}\}"/)
  assert.match(deviceNameAction, /data-id="\{\{item\.id\}\}"/)
  assert.match(deviceNameAction, /data-revision="\{\{scheduleRevision\}\}"/)
  assert.match(deviceNameAction, /catchtap="renameDevice"/)
  assert.match(deviceNameAction, /class="workspace-device-name workspace-wrapping-text">\{\{item\.name\}\}<\/text>/)
  assert.doesNotMatch(deviceNameAction, /(?:bind|catch)touch(?:start|move|end|cancel)=/)
  const deviceSwipeRow = workspaceMarkup.match(/<view[^>]*class="[^"]*workspace-device-swipe-row[^"]*"[^>]*>/)?.[0] || ''
  assert.match(deviceSwipeRow, /bindtouchstart="onSwipeTouchStart"/)
  assert.match(deviceSwipeRow, /bindtouchmove="onSwipeTouchMove"/)
  assert.match(deviceSwipeRow, /bindtouchend="onSwipeTouchEnd"/)
  assert.match(deviceSwipeRow, /bindtouchcancel="onSwipeTouchCancel"/)
  assert.match(workspaceMarkup, /class="workspace-port-cell workspace-wrapping-text">\{\{line\.fromPort/)
  assert.doesNotMatch(workspaceMarkup, /<scroll-view[^>]*class="workspace-device-name|<scroll-view[^>]*class="workspace-port-cell/)
  assert.match(workspaceMarkup, /aria-hidden="\{\{!item\.swipeOpen\}\}" class="workspace-swipe-actions/)
  assert.match(workspaceMarkup, /aria-hidden="\{\{!line\.swipeOpen\}\}" class="workspace-swipe-actions/)
  assert.match(groupSwipeRow, /aria-hidden="\{\{group\.retiring\}\}"/)
  assert.match(workspaceMarkup, /aria-hidden="\{\{!group\.swipeOpen\}\}" class="workspace-swipe-actions/)
  assert.match(workspaceMarkup, /workspace-location-heading">\{\{group\.locationHeadingLabel\}\}/)
  assert.match(workspaceMarkup, /来源处（选填）/)
  assert.match(workspaceMarkup, /去向处（选填）/)
  assert.match(workspaceMarkup, /maxlength="100" value="\{\{draft\.fromLocation\}\}"/)
  assert.match(workspaceMarkup, /maxlength="100" value="\{\{draft\.toLocation\}\}"/)
  assert.match(workspaceMarkup, /draft\.fromDevice \|\| '不选设备'/)
  assert.doesNotMatch(workspaceMarkup, /请先在设备页添加设备/)
  assert.match(workspaceStyle, /\.workspace-swipe-actions\{position:absolute;z-index:2;/)
  assert.match(workspaceMarkup, /style="transform:translateX\(\{\{72 - (?:item|line)\.swipeOffset\}\}px\);"/)
  assert.match(indexMarkup, /workspace-overlay-closing/)

  for (const locations of [
    { fromLocation: '桌面', toLocation: '音频机柜', expected: /桌面.*音频机柜/ },
    { fromLocation: '', toLocation: '', expected: /该线路组/ },
  ]) {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const scheduleResult = projectWiring.applyScheduleChange(projectWiring.emptySchedule(), {
      type: 'upsert', line: { ...locations, fromPort: 'OUT', toPort: 'IN' },
    })
    assert.equal(scheduleResult.ok, true)
    const workspace = buildWorkspace(scheduleResult.schedule)
    page._schedule = scheduleResult.schedule
    page._workspace = workspace
    page.data.groups = workspace.groups.map((group) => ({ ...group, lines: group.lines.map((line) => ({ ...line })) }))
    const confirmation = page.captureWorkspaceDeletion('group', workspace.groups[0].key, scheduleResult.schedule.revision)
    assert.ok(confirmation)
    assert.match(confirmation.content, locations.expected)
    assert.doesNotMatch(confirmation.content, /undefined|待补设备|與|与“”|“”与/)
    if (locations.fromLocation) assert.doesNotMatch(confirmation.content, /设备对/)
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const lineId = page._schedule.lines[0].id
    page.editLine({ currentTarget: { dataset: { id: lineId } } })
    assert.equal(page.data.editorVisible, true)

    page.deleteLine()
    assert.match(env.events.modals.at(-1).title, /删除线路/)
    env.respondModal(false)
    assert.equal(page._schedule.lines.some((line) => line.id === lineId), true, 'cancel leaves the targeted line intact')
    assert.equal(page.data.editorVisible, true, 'cancel keeps the editor available')

    page.deleteLine()
    env.respondModal(true)
    assert.equal(page._schedule.lines.some((line) => line.id === lineId), false, 'confirmed editor deletion removes the captured stable ID')
    assert.equal(page.data.editorVisible, false, 'successful delete closes the editor before the saved schedule is accepted')
    assert.equal(page.data.workspaceOverlayPhases.lineEditor, 'closing')
    assert.ok(page.data.draft, 'the exiting editor retains its draft through the close transition')
    await delay(270)
    assert.equal(page.data.draft, null, 'the editor draft is cleared after its close transition')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const device = page.data.devices[0]
    const action = { actionType: 'connect', projectId: page.projectId, id: device.id, revision: page._schedule.revision }
    swipeRow(page, 'device', device.id)
    page.connectDevice(actionTapEvent(action))
    assert.equal(page.data.editorVisible, false, 'the synthetic tap immediately following a horizontal swipe is suppressed without changedTouches')

    tapRow(page, 'device', device.id) // identifier 0 is reused by the platform on this deliberate new touch session
    page.connectDevice(actionTapEvent(action))
    assert.equal(page.data.editorVisible, true, 'fresh row touchstart clears same-identifier suppression and Connect opens the editor')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const device = page.data.devices[0]
    const action = { actionType: 'connect', projectId: page.projectId, id: device.id, revision: page._schedule.revision }
    const currentTarget = { dataset: { swipeType: 'device', swipeId: device.id, retiring: false } }
    page.onSwipeTouchStart({ currentTarget, touches: [{ identifier: 0, clientX: 160, clientY: 20 }] })
    page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: 162, clientY: 52 }] })
    page.onSwipeTouchEnd({ currentTarget, changedTouches: [{ identifier: 0, clientX: 162, clientY: 52 }] })
    page.connectDevice(actionTapEvent(action))
    assert.equal(page.data.editorVisible, false, 'a vertical-scroll ghost tap is suppressed instead of connecting')
    tapRow(page, 'device', device.id)
    page.connectDevice(actionTapEvent(action))
    assert.equal(page.data.editorVisible, true, 'the next deliberate tap remains available after vertical scrolling')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const device = page.data.devices[0]
    const action = { actionType: 'connect', projectId: page.projectId, id: device.id, revision: page._schedule.revision }
    const currentTarget = { dataset: { swipeType: 'device', swipeId: device.id, retiring: false } }
    page.onSwipeTouchStart({ currentTarget, touches: [{ identifier: 0, clientX: 160, clientY: 20 }] })
    page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: 70, clientY: 22 }] })
    page.onSwipeTouchCancel({ currentTarget, changedTouches: [{ identifier: 0, clientX: 70, clientY: 22 }] })
    assert.equal(page._workspaceSwipeGesture, null, 'touchcancel clears the row recognizer')
    assert.equal(page._workspaceSuppressedTapTarget, null, 'touchcancel does not leave a delayed tap suppression behind')
    tapRow(page, 'device', device.id)
    page.connectDevice(actionTapEvent(action))
    assert.equal(page.data.editorVisible, true, 'a deliberate new session after cancellation can Connect')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const line = page._schedule.lines[0]
    const action = { deleteType: 'line', actionType: 'delete', projectId: page.projectId, id: line.id, revision: page._schedule.revision }
    swipeRow(page, 'line', line.id)
    page.deleteWorkspaceRecord(actionTapEvent(action))
    assert.equal(env.events.modals.length, 0, 'the swipe-generated tap without an identifier cannot activate Delete')

    tapRow(page, 'line', line.id)
    page.deleteWorkspaceRecord(actionTapEvent(action))
    assert.equal(env.events.modals.length, 1, 'a fresh deliberate touch with reused identifier 0 activates the visible Delete action')
    env.respondModal(true)
    assert.equal(page._schedule.lines.some((item) => item.id === line.id), false, 'the confirmed visible Delete action reaches the existing safe save command')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const device = page.data.devices[0]
    const action = { actionType: 'connect', projectId: page.projectId, id: device.id, revision: page._schedule.revision }
    page.rememberWorkspaceSuppressedTouch({ changedTouches: [{ identifier: 0 }] }, `device:${device.id}`)
    page._workspaceSuppressedTapTarget.expires = Date.now() - 1
    page.connectDevice(actionTapEvent(action))
    assert.equal(page.data.editorVisible, true, 'expired fallback suppression cannot swallow a later ID-less tap')
    assert.equal(Object.keys(page._workspaceSuppressedTouches).length, 0, 'consuming an expired fallback clears its associated identifier record')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const device = page.data.devices[0]
    const action = { actionType: 'connect', projectId: page.projectId, id: device.id, revision: page._schedule.revision }
    page.traceWorkspaceInteraction('ignored-before-opt-in')
    assert.equal(page.getWorkspaceInteractionTrace().events.length, 0, 'trace collection is off by default')
    page.startWorkspaceInteractionTrace()
    swipeRow(page, 'device', device.id)
    page.connectDevice(actionTapEvent(action))
    assert.ok(page.getWorkspaceInteractionTrace().events.some((entry) => entry.stage === 'action-tap-result' && entry.suppressed === true))

    tapRow(page, 'device', device.id)
    page.connectDevice(actionTapEvent(action))
    page.onHide()
    page.onShow()
    page.onUnload()
    const trace = page.stopWorkspaceInteractionTrace()
    assert.equal(trace.build, 'workspace-touch-2026-10-16-r1')
    assert.ok(trace.events.some((entry) => entry.stage === 'page-lifecycle' && entry.phase === 'hide'))
    assert.ok(trace.events.some((entry) => entry.stage === 'page-lifecycle' && entry.phase === 'show'))
    assert.ok(trace.events.some((entry) => entry.stage === 'page-lifecycle' && entry.phase === 'unload'))
    assert.ok(trace.events.length <= 80)
    assert.doesNotMatch(JSON.stringify(trace.events), new RegExp(device.id))
    assert.doesNotMatch(JSON.stringify(trace.events), /projectId|recordId|deviceName|fromPort/)
    page.startWorkspaceInteractionTrace()
    for (let index = 0; index < 90; index += 1) page.traceWorkspaceInteraction('ring-test', { control: 'device', reason: 'test' })
    assert.equal(page.getWorkspaceInteractionTrace().events.length, 80, 'trace is bounded to an 80-event in-memory ring')
    page.stopWorkspaceInteractionTrace()
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    page.editLine({ currentTarget: { dataset: { id: page._schedule.lines[0].id } } })
    page.deleteLine()
    page.projectId = 'qa-project-2'
    env.respondModal(true)
    assert.equal(page._schedule.lines.length, 4, 'a confirmation for a stale project context must not submit a delete')
    assert.equal(page.data.editorVisible, true, 'a stale confirmation does not close the current editor')
    assert.ok(env.events.toasts.some((toast) => toast.title === '项目已更新，请重新操作'))
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    page.openNewLine()
    assert.equal(page.data.draftIsNew, true)
    assert.equal(page.data.draft.id || '', '', 'new draft starts without a persisted ID')
    const patches = []
    const setData = page.setData
    page.setData = function(patch, callback) {
      patches.push({ ...patch })
      return setData.call(this, patch, callback)
    }
    page.requestCloseEditor()
    assert.equal(page.data.editorVisible, false, 'the X route can close a draft without an ID')
    assert.equal(page.data.workspaceOverlayPhases.lineEditor, 'closing')
    assert.ok(page.data.draft, 'new draft content remains mounted during exit')
    assert.ok(patches.some((patch) => patch.editorVisible === false && patch['workspaceOverlayPhases.lineEditor'] === 'closing'), 'logical visibility and closing phase change atomically')
    await delay(270)
    assert.equal(page.data.draft, null)
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const group = page.data.groups[0]
    const key = group.key
    swipeRow(page, 'group', key)
    assert.equal(page.data.groups[0].swipeOpen, true, 'left swipe exposes the group delete action')
    assert.equal(page.data.groups[0].swipeOffset, 72)
    const action = { deleteType: 'group', actionType: 'delete', projectId: page.projectId, id: key, revision: page._schedule.revision }
    page.deleteWorkspaceRecord(actionTapEvent(action))
    assert.equal(env.events.modals.length, 0, 'the tap synthesized by the opening swipe cannot confirm a group delete')

    const lineId = group.lines[0].id
    swipeRow(page, 'line', lineId)
    assert.equal(page.data.groups[0].swipeOpen, false, 'opening a line closes the group swipe row')
    assert.equal(page.data.groups[0].lines.find((line) => line.id === lineId).swipeOpen, true)
    swipeRow(page, 'group', key)
    assert.equal(page.data.groups[0].swipeOpen, true, 'opening a group closes the line swipe row')
    assert.equal(page.data.groups[0].lines.find((line) => line.id === lineId).swipeOpen, false)

    tapRow(page, 'group', key)
    page.toggleGroup(tapEvent({ key }, 0))
    assert.equal(page.data.groups[0].swipeOpen, false, 'a tap on an open group header closes its delete action')
    assert.equal(page._collapsedGroups.has(key), false, 'closing the delete action does not collapse the group')
    tapRow(page, 'group', key)
    page.toggleGroup(tapEvent({ key }, 0))
    assert.equal(page._collapsedGroups.has(key), true, 'a later deliberate tap toggles the group')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const group = page.data.groups[0]
    const key = group.key
    const start = { currentTarget: { dataset: { swipeType: 'group', swipeId: key, retiring: false } }, touches: [{ identifier: 0, clientX: 160, clientY: 20 }] }
    page.onSwipeTouchStart(start)
    page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: 162, clientY: 52 }] })
    page.onSwipeTouchEnd({ currentTarget: start.currentTarget, changedTouches: [{ identifier: 0, clientX: 162, clientY: 52 }] })
    assert.equal(page.data.groups[0].swipeOpen, false, 'vertical group movement never opens deletion')
    page.toggleGroup(tapEvent({ key }, 0))
    assert.equal(page._collapsedGroups.has(key), false, 'a vertical-scroll ghost tap cannot toggle the group')

    const diagonalStart = { currentTarget: { dataset: { swipeType: 'group', swipeId: key, retiring: false } }, touches: [{ identifier: 0, clientX: 10, clientY: 10 }] }
    page.onSwipeTouchStart(diagonalStart)
    page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: 20, clientY: 18 }] })
    page.onSwipeTouchEnd({ currentTarget: diagonalStart.currentTarget, changedTouches: [{ identifier: 0, clientX: 20, clientY: 18 }] })
    assert.equal(page.data.groups[0].swipeOpen, false, 'a near-diagonal drag beyond six pixels cannot expose deletion')
    page.toggleGroup(tapEvent({ key }, 0))
    assert.equal(page._collapsedGroups.has(key), false, 'a near-diagonal release tap cannot collapse the group')

    swipeRow(page, 'group', key)
    page.onSwipeTouchStart({ currentTarget: { dataset: { swipeType: 'group', swipeId: key, retiring: false } }, touches: [{ identifier: 0, clientX: 160, clientY: 20 }] })
    page.onSwipeTouchCancel({ changedTouches: [{ identifier: 0, clientX: 160, clientY: 20 }] })
    assert.equal(page.data.groups[0].swipeOpen, false, 'touchcancel closes an open group action')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const group = page.data.groups[0]
    const ids = group.lines.map((line) => line.id)
    const deviceIds = page._schedule.devices.map((device) => device.id)
    const action = { deleteType: 'group', actionType: 'delete', projectId: page.projectId, id: group.key, revision: page._schedule.revision }
    swipeRow(page, 'group', group.key)
    page.deleteWorkspaceRecord(actionTapEvent(action))
    assert.equal(env.events.modals.length, 0, 'swipe release alone never starts group deletion')
    tapRow(page, 'group', group.key)
    page.deleteWorkspaceRecord(actionTapEvent(action))
    assert.equal(env.events.modals.length, 1, 'a fresh intentional tap on the revealed trash starts confirmation')
    assert.deepEqual(page._schedule.lines.map((line) => line.id), ['qa-line-1', 'qa-line-2', 'qa-line-3', 'qa-line-4'], 'confirmation is required before any record is removed')
    env.respondModal(true)
    assert.deepEqual(page._schedule.lines.map((line) => line.id), ['qa-line-4'], 'confirmation deletes exactly the target group')
    assert.deepEqual(page._schedule.devices.map((device) => device.id), deviceIds, 'group deletion retains every device')
    assert.equal(ids.length, 3)
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const key = `group:${page.data.groups[0].key}`
    page._workspaceSuppressedTouches['0'] = Date.now() + 300
    page._workspaceSuppressedTapTarget = key
    page.clearWorkspaceSuppressedTouchForStart({ touches: [{ identifier: 0 }] })
    assert.equal(page.consumeWorkspaceSuppressedTouch(tapEvent({ key }, 0), key), false, 'a new touch session reusing identifier zero clears the ended session suppression')
    page.onUnload()
  }

  for (const [name, open, close, reopen] of [
    ['new-project', (page) => page.requestNewProject(), (page) => page.closeNewProject(), (page) => page.requestNewProject()],
    ['project-picker', (page) => page.requestProjectPicker(), (page) => page.cancelProjectPicker(), (page) => page.requestProjectPicker()],
  ]) {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    open(page)
    close(page)
    const phaseKey = name === 'new-project' ? 'newProject' : 'projectPicker'
    assert.equal(page.data.workspaceOverlayPhases[phaseKey], 'closing', `${name} enters retained closing phase`)
    reopen(page)
    assert.equal(page.data.workspaceOverlayPhases[phaseKey], 'opening', `${name} reopen reverses the retained node immediately`)
    assert.equal(name === 'new-project' ? page.data.newProjectVisible : page.data.projectPickerVisible, true)
    await delay(320)
    assert.equal(name === 'new-project' ? page.data.newProjectVisible : page.data.projectPickerVisible, true, `${name} stale close timer cannot unmount the reopened sheet`)
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const commits = deferRenderCommits(page)
    page.requestNewProject()
    page.closeNewProject()
    await delay(300) // model a busy UI bridge before the closing patch is rendered
    assert.equal(page.data.workspaceOverlayPhases.newProject, 'closing', 'close lifetime does not start before its render commit')
    assert.equal(commits.pending(), 2, 'both the preparing and closing render commits remain queued')
    assert.equal(commits.flushAll(), 2, 'the stale preparing callback is harmless and the closing callback starts the exit timer')
    await delay(225)
    assert.equal(page.data.workspaceOverlayPhases.newProject, 'closing', 'the full exit duration starts at the rendered close state')
    await delay(30)
    assert.equal(page.data.workspaceOverlayPhases.newProject, '', 'closing phase clears after the committed 240ms exit')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    const commits = deferRenderCommits(page)
    page.beginWorkspaceOverlay('newProject', { newProjectVisible: true })
    page.beginWorkspaceOverlay('report', { reportPreviewVisible: true })
    let completed = false
    page.endWorkspaceOverlays(['newProject', 'report'], {
      newProjectVisible: false, reportPreviewVisible: false,
    }, () => { completed = true })
    page.beginWorkspaceOverlay('newProject', { newProjectVisible: true })
    commits.flushAll()
    await delay(270)
    assert.equal(page.data.workspaceOverlayPhases.report, '', 'the still-closing sibling finishes its own exit')
    assert.equal(page.data.workspaceOverlayPhases.newProject, 'opening', 'the reopened sheet remains mounted')
    assert.equal(completed, false, 'canceling one member of a closing group suppresses the stale aggregate callback')
    page.onUnload()
  }

  {
    const env = createRuntime({ count: 1 })
    const page = env.page({ id: 'qa-project-1' })
    const commits = deferRenderCommits(page)
    const line = page._schedule.lines[0]
    page.deleteWorkspaceRecord(tapEvent({
      deleteType: 'line', id: line.id, projectId: page.projectId, revision: page._schedule.revision,
    }))
    env.respondModal(true)
    assert.equal(page._schedule.lines.some((item) => item.id === line.id), false, 'fixture deletion saves before the visual exit')
    assert.equal(page.data.groups[0].retiring, true, 'deleting the last line creates a whole-group ghost')
    await delay(300)
    assert.equal(page._workspaceRetiringRow.phase, 'enter', 'a busy render bridge cannot consume the entry state before ghost commit')
    assert.ok(commits.flushAll() >= 1, 'the actual ghost group render callback is queued')
    await delay(25)
    assert.equal(page._workspaceRetiringRow.phase, 'exit', 'the exit phase begins after the committed ghost entry')
    await delay(250)
    assert.equal(page._workspaceRetiringRow.phase, 'exit', 'cleanup waits for the exit phase render callback')
    assert.equal(commits.flushAll(), 1, 'the exit ghost commit starts the collapse cleanup timer')
    await delay(225)
    assert.equal(page._workspaceRetiringRow.phase, 'exit', 'the 220ms CSS collapse remains mounted through its full duration')
    await delay(30)
    assert.equal(page._workspaceRetiringRow, null, 'ghost group clears after the committed collapse duration')
    assert.equal(page.data.groups.length, 0, 'the saved deletion leaves no visual group behind')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = env.page({ id: 'qa-project-1' })
    page.setData({ reportImages: [{ title: 'old', path: '/old.png' }] })
    page._reportSignature = 'old-signature'
    page.showReportPage(0)
    page.invalidateExport(true)
    page.invalidateExport(false)
    page._reportSignature = 'fresh-signature'
    page.setData({ reportImages: [{ title: 'fresh', path: '/fresh.png' }] })
    await delay(270)
    assert.equal(page.data.reportImages[0].path, '/fresh.png', 'a fresh signature arriving during close cancels the old clear callback')
    assert.equal(page._workspaceReportClearPending, false)
    page.onUnload()
  }

  console.log('project wiring native interaction regression passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

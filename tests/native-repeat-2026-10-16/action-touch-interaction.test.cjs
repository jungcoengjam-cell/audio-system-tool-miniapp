const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, makeFixture } = require('../project-wiring-redesign-2026-10-16/runtime.cjs')
const { buildWorkspace } = require('../../pages/project-wiring/workspace-model')

const root = path.resolve(__dirname, '../..')
const projectStorageKey = 'audioTool.projects.v1'
const markup = fs.readFileSync(path.join(root, 'pages/project-wiring/workspace.wxml'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'pages/project-wiring/workspace.wxss'), 'utf8')

function seededPage(env) {
  const page = env.page()
  const fixture = makeFixture()
  page.projectId = fixture.id
  page._projectLoadRevision = 3
  page._schedule = fixture.wiringSchedule
  page._workspace = buildWorkspace(page._schedule)
  page.setData({
    project: { id: fixture.id, name: fixture.name }, loading: false, saving: false,
    projectCreating: false, workspaceTab: 'devices', scheduleRevision: page._schedule.revision,
  })
  page.refreshWorkspace()
  return page
}

function touchTarget(type, id, groupIndex) {
  return { dataset: { swipeType: type, swipeId: id, groupIndex, retiring: false } }
}

function swipe(page, type, id, groupIndex) {
  const currentTarget = touchTarget(type, id, groupIndex)
  page.onSwipeTouchStart({ currentTarget, touches: [{ identifier: 0, clientX: 220, clientY: 24 }] })
  page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: 80, clientY: 26 }] })
  page.onSwipeTouchEnd({ currentTarget, changedTouches: [{ identifier: 0, clientX: 80, clientY: 26 }] })
}

function freshTapStart(page, type, id, groupIndex) {
  const currentTarget = touchTarget(type, id, groupIndex)
  page.onSwipeTouchStart({ currentTarget, touches: [{ identifier: 0, clientX: 140, clientY: 24 }] })
  page.onSwipeTouchEnd({ currentTarget, changedTouches: [{ identifier: 0, clientX: 140, clientY: 24 }] })
}

function idlessTap(dataset) {
  return { type: 'tap', currentTarget: { dataset }, target: { dataset }, detail: { x: 340, y: 24 } }
}

function actionData(page, actionType, type, id) {
  return {
    actionType, deleteType: actionType === 'delete' ? type : undefined,
    projectId: page.projectId, id, revision: page._schedule.revision,
  }
}

function seedGuard(page, control) {
  const target = actionData(page, control, 'device', page.data.devices[0].id)
  return page.workspaceActionTargetPresent({ currentTarget: { dataset: target } })
}

async function main() {
  const deleteButtons = [...markup.matchAll(/<button[^>]*class="workspace-swipe-delete"[^>]*>/g)].map((m) => m[0])
  assert.equal(deleteButtons.length, 2)
  deleteButtons.forEach((button) => {
    assert.match(button, /catchtap="deleteWorkspaceRecord"/)
    assert.doesNotMatch(button, /(?:bind|catch)touch(?:start|move|end|cancel)=/)
    assert.match(button, /disabled="\{\{![a-z]+\.swipeOpen \|\| saving \|\| workspaceDeletingId === [a-z]+\.id\}\}"/)
  })
  const connectButton = markup.match(/<button[^>]*class="workspace-connect-button"[^>]*>/)?.[0] || ''
  assert.match(connectButton, /catchtap="connectDevice"/)
  assert.doesNotMatch(connectButton, /(?:bind|catch)touch(?:start|move|end|cancel)=/)
  const deviceNameAction = markup.match(/<view[^>]*class="workspace-device-name-action"[^>]*>[\s\S]*?<\/view>/)?.[0] || ''
  assert.match(deviceNameAction, /data-action-type="rename-device"/)
  assert.match(deviceNameAction, /data-project-id="\{\{project\.id\}\}"/)
  assert.match(deviceNameAction, /data-id="\{\{item\.id\}\}"/)
  assert.match(deviceNameAction, /data-revision="\{\{scheduleRevision\}\}"/)
  assert.match(deviceNameAction, /catchtap="renameDevice"/)
  assert.match(deviceNameAction, /class="workspace-device-name workspace-wrapping-text">\{\{item\.name\}\}<\/text>/)
  assert.doesNotMatch(deviceNameAction, /(?:bind|catch)touch(?:start|move|end|cancel)=/)
  const deviceSwipeRow = markup.match(/<view[^>]*class="[^"]*workspace-device-swipe-row[^"]*"[^>]*>/)?.[0] || ''
  assert.match(deviceSwipeRow, /bindtouchstart="onSwipeTouchStart"/)
  assert.match(deviceSwipeRow, /bindtouchmove="onSwipeTouchMove"/)
  assert.match(deviceSwipeRow, /bindtouchend="onSwipeTouchEnd"/)
  assert.match(deviceSwipeRow, /bindtouchcancel="onSwipeTouchCancel"/)
  assert.match(markup, /class="workspace-port-cell workspace-wrapping-text">\{\{line\.fromPort/)
  assert.doesNotMatch(markup, /<scroll-view[^>]*class="workspace-device-name|<scroll-view[^>]*class="workspace-port-cell/)
  assert.match(markup, /aria-hidden="\{\{!item\.swipeOpen\}\}" class="workspace-swipe-actions/)
  assert.match(markup, /aria-hidden="\{\{!line\.swipeOpen\}\}" class="workspace-swipe-actions/)
  assert.match(styles, /\.workspace-swipe-actions\{position:absolute;z-index:2;/)

  {
    const env = createRuntime()
    const page = seededPage(env)
    const device = page.data.devices[0]
    const connect = actionData(page, 'connect', 'device', device.id)
    swipe(page, 'device', device.id)
    assert.equal(page.data.devices.find((item) => item.id === device.id).swipeOpen, true)
    page.connectDevice(idlessTap(connect))
    assert.equal(page.data.editorVisible, false, 'an ID-less synthetic click from the swipe session does not Connect')

    freshTapStart(page, 'device', device.id)
    page.connectDevice(idlessTap(connect))
    assert.equal(page.data.editorVisible, true, 'fresh row touchstart with reused identifier zero restores Connect')
    assert.equal(page.data.draft.fromDeviceId, device.id, 'Connect still preselects the tapped endpoint')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = seededPage(env)
    page.startWorkspaceInteractionTrace()
    const line = page._schedule.lines[0]
    const groupIndex = page.data.groups.findIndex((group) => group.lines.some((item) => item.id === line.id))
    const del = actionData(page, 'delete', 'line', line.id)
    page.setData({ workspaceTab: 'lines' })
    swipe(page, 'line', line.id, groupIndex)
    page.deleteWorkspaceRecord(idlessTap(del))
    assert.equal(env.events.modals.length, 0, 'an ID-less synthetic click from the swipe session cannot reach Delete')

    freshTapStart(page, 'line', line.id, groupIndex)
    page.deleteWorkspaceRecord(idlessTap(del))
    assert.equal(env.events.modals.length, 1, 'a fresh identifier-zero touch session reaches the explicit confirmation')
    assert.ok(page.getWorkspaceInteractionTrace().events.some((entry) => entry.stage === 'delete-modal' && entry.reason === 'requested'), 'the opt-in trace records that Delete requested the confirmation modal')
    assert.equal(env.events.writes.filter((write) => write.key === projectStorageKey).length, 0, 'the action route performs no project write before explicit confirmation')
    env.respondModal(false)
    assert.equal(page._schedule.lines.some((item) => item.id === line.id), true, 'cancel leaves the isolated record intact')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = seededPage(env)
    const device = page.data.devices[0]
    const connect = actionData(page, 'connect', 'device', device.id)
    page.rememberWorkspaceSuppressedTouch({ changedTouches: [{ identifier: 0 }] }, `device:${device.id}`)
    const fallback = page._workspaceSuppressedTapTarget
    assert.equal(page.consumeWorkspaceSuppressedTouch(idlessTap(connect), `device:${device.id}`), true)
    assert.equal(Object.keys(page._workspaceSuppressedTouches).length, 0, 'consuming an ID-less fallback also retires its ID-keyed record')
    assert.equal(page.consumeWorkspaceSuppressedTouch({ changedTouches: [{ identifier: 0 }] }, `device:${device.id}`), false, 'suppression is consumed once')
    assert.ok(fallback)

    page.rememberWorkspaceSuppressedTouch({ changedTouches: [{ identifier: 0 }] }, `device:${device.id}`)
    page._workspaceSuppressedTapTarget.expires = Date.now() - 1
    page.connectDevice(idlessTap(connect))
    assert.equal(page.data.editorVisible, true, 'an expired ID-less fallback cannot permanently swallow a later tap')
    assert.equal(Object.keys(page._workspaceSuppressedTouches).length, 0, 'expired fallback cleanup clears the related identifier record')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = seededPage(env)
    const device = page.data.devices[0]
    const connect = actionData(page, 'connect', 'device', device.id)
    page.onSwipeTouchStart({ currentTarget: touchTarget('device', device.id), touches: [{ identifier: 0, clientX: 160, clientY: 20 }] })
    page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: 162, clientY: 52 }] })
    page.onSwipeTouchEnd({ changedTouches: [{ identifier: 0, clientX: 162, clientY: 52 }] })
    page.connectDevice(idlessTap(connect))
    assert.equal(page.data.editorVisible, false, 'vertical-scroll synthetic tap is suppressed')

    const currentTarget = touchTarget('device', device.id)
    page.onSwipeTouchStart({ currentTarget, touches: [{ identifier: 0, clientX: 160, clientY: 20 }] })
    page.onSwipeTouchMove({ touches: [{ identifier: 0, clientX: 70, clientY: 22 }] })
    page.onSwipeTouchCancel({ currentTarget, changedTouches: [{ identifier: 0, clientX: 70, clientY: 22 }] })
    assert.equal(page._workspaceSwipeGesture, null)
    assert.equal(page._workspaceSuppressedTapTarget, null, 'touchcancel leaves no drag tap suppression')
    freshTapStart(page, 'device', device.id)
    page.connectDevice(idlessTap(connect))
    assert.equal(page.data.editorVisible, true, 'the next deliberate tap works after cancel')
    page.onUnload()
  }

  {
    const env = createRuntime()
    const page = seededPage(env)
    const device = page.data.devices[0]
    const connect = actionData(page, 'connect', 'device', device.id)
    page.traceWorkspaceInteraction('ignored-before-opt-in')
    assert.equal(page.getWorkspaceInteractionTrace().events.length, 0, 'diagnostics are off by default')
    page.startWorkspaceInteractionTrace()
    swipe(page, 'device', device.id)
    page.connectDevice(idlessTap(connect))
    assert.ok(page.getWorkspaceInteractionTrace().events.some((entry) => entry.stage === 'action-tap-result' && entry.suppressed === true))
    freshTapStart(page, 'device', device.id)
    page.connectDevice(idlessTap(connect))
    page.onHide()
    page.onShow()
    page.onUnload()
    const trace = page.stopWorkspaceInteractionTrace()
    assert.equal(trace.build, 'workspace-touch-2026-10-16-r1')
    assert.ok(trace.events.some((entry) => entry.stage === 'action-tap' && entry.tapArrived === true))
    for (const phase of ['hide', 'show', 'unload']) {
      assert.ok(trace.events.some((entry) => entry.stage === 'page-lifecycle' && entry.phase === phase))
    }
    assert.ok(trace.events.length <= 80)
    assert.doesNotMatch(JSON.stringify(trace.events), new RegExp(device.id))
    assert.doesNotMatch(JSON.stringify(trace.events), /projectId|recordId|deviceName|fromPort/)
    page.startWorkspaceInteractionTrace()
    for (let index = 0; index < 90; index += 1) page.traceWorkspaceInteraction('bounded-test', { control: 'device', reason: 'test' })
    assert.equal(page.getWorkspaceInteractionTrace().events.length, 80, 'trace is an 80-event in-memory ring')
    page.stopWorkspaceInteractionTrace()
    page.onUnload()
  }

  console.log('PASS workspace action touch routing, identifier reuse, bounded trace, and hidden Delete hit state')
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 })

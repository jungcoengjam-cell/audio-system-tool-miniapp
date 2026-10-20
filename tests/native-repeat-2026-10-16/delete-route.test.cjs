const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime } = require('../project-wiring-redesign-2026-10-16/runtime.cjs')

const projectKey = 'audioTool.projects.v1'
const workspaceMarkup = fs.readFileSync(path.resolve(__dirname, '../../pages/project-wiring/workspace.wxml'), 'utf8')

function actionEvent(dataset, identifier) {
  return {
    type: 'tap',
    currentTarget: { dataset },
    target: { dataset },
    detail: { x: 340, y: 100 },
    changedTouches: [{ identifier, clientX: 340, clientY: 100 }],
  }
}

function revealAndTapDelete(page, deleteType, id) {
  const lineMode = deleteType === 'line'
  if (lineMode && page.data.workspaceTab !== 'lines') {
    page.onWorkspaceTab({ currentTarget: { dataset: { tab: 'lines' } } })
  }
  const groupIndex = lineMode
    ? page.data.groups.findIndex((group) => group.lines.some((line) => line.id === id))
    : undefined
  swipeRow(page, deleteType, id, groupIndex, 1)

  const dataset = {
    deleteType,
    actionType: 'delete',
    projectId: page.projectId,
    id,
    revision: String(page._schedule.revision),
  }
  // Current WXML puts touch bindings on the parent swipe row only. The
  // second physical press therefore bubbles through that row before catchtap
  // reaches the button handler; no action-button touch hook is synthesized.
  const rowEvent = {
    currentTarget: { dataset: { swipeType: deleteType, swipeId: id, groupIndex } },
    touches: [{ identifier: 2, clientX: 340, clientY: 100 }],
  }
  page.onSwipeTouchStart(rowEvent)
  page.onSwipeTouchEnd({
    currentTarget: rowEvent.currentTarget,
    changedTouches: [{ identifier: 2, clientX: 340, clientY: 100 }],
  })
  page.deleteWorkspaceRecord(actionEvent(dataset, 2))
}

function swipeRow(page, type, id, groupIndex, identifier) {
  page.onSwipeTouchStart({
    currentTarget: { dataset: { swipeType: type, swipeId: id, groupIndex } },
    touches: [{ identifier, clientX: 220, clientY: 100 }],
  })
  page.onSwipeTouchMove({ touches: [{ identifier, clientX: 120, clientY: 101 }] })
  page.onSwipeTouchEnd({ changedTouches: [{ identifier, clientX: 120, clientY: 101 }] })
}

function freshParentTapStart(page, type, id, groupIndex, identifier = 0) {
  const currentTarget = { dataset: { swipeType: type, swipeId: id, groupIndex } }
  page.onSwipeTouchStart({ currentTarget, touches: [{ identifier, clientX: 340, clientY: 100 }] })
  page.onSwipeTouchEnd({ currentTarget, changedTouches: [{ identifier, clientX: 340, clientY: 100 }] })
}

function tapWithoutChangedTouches(page, method, dataset) {
  page[method]({ type: 'tap', currentTarget: { dataset }, target: { dataset }, detail: { x: 340, y: 100 } })
}

async function main() {
  for (const type of ['device', 'line']) {
    const button = workspaceMarkup.match(new RegExp(`<button[^>]*data-delete-type="${type}"[^>]*>`))?.[0]
    assert.ok(button, `current ${type} delete button is present`)
    assert.match(button, /catchtap="deleteWorkspaceRecord"/)
    assert.doesNotMatch(button, /catchtouch(?:start|move|end|cancel)=/,
      'the action button has no separate touch hooks that can conflict with its parent row')
    for (const attribute of ['data-action-type="delete"', 'data-project-id=', 'data-id=', 'data-revision=']) {
      assert.ok(button.includes(attribute), `the button carries ${attribute}`)
    }
  }

  {
    const env = createRuntime()
    const page = env.page()
    const targetId = page._schedule.devices.find((device) => device.id === 'receiver-1').id
    const before = JSON.parse(JSON.stringify(page._schedule))

    revealAndTapDelete(page, 'device', targetId)
    const modal = env.events.modals.at(-1)
    assert.ok(modal, 'the action tap reaches the native-modal adapter')
    assert.match(modal.content, /4/)
    assert.equal(modal.confirmText, '一并删除')
    assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 0,
      'no storage write occurs before the asynchronous confirmation callback')
    assert.deepEqual(page._schedule, before, 'opening confirmation leaves the in-memory schedule unchanged')

    await new Promise((resolve) => setTimeout(resolve, 0))
    modal.success({ confirm: true, cancel: false })
    assert.equal(page._schedule.devices.some((device) => device.id === targetId), false)
    assert.equal(page._schedule.lines.length, 0)
    assert.equal(page._schedule.revision, before.revision + 1)
    assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 1,
      'the isolated fixture is written once after confirmation')
    assert.ok(env.events.toasts.some((toast) => toast.title === '设备已删除'))
    page.onUnload()
  }

  {
    const env = createRuntime({ count: 1 })
    const page = env.page()
    const lineId = page._schedule.lines[0].id
    revealAndTapDelete(page, 'line', lineId)
    const modal = env.events.modals.at(-1)
    assert.ok(modal, 'the line action reaches confirmation after a real swipe/action touch sequence')
    assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 0)
    modal.success({ confirm: false, cancel: true })
    assert.equal(page._schedule.lines.some((line) => line.id === lineId), true,
      'native-style cancellation leaves the line intact')
    assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 0)
    page.onUnload()
  }

  {
    const env = createRuntime({ count: 1 })
    const page = env.page()
    const lineId = page._schedule.lines[0].id
    revealAndTapDelete(page, 'line', lineId)
    const modal = env.events.modals.at(-1)
    env.failWrites(true)
    modal.success({ confirm: true, cancel: false })
    assert.equal(page._schedule.lines.some((line) => line.id === lineId), true,
      'a fixture storage write failure preserves the target line')
    assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 0)
    assert.equal(page.data.saving, false)
    assert.ok(env.events.toasts.some((toast) => /failure|失败/.test(toast.title)))
    page.onUnload()
  }

  {
    const env = createRuntime({ count: 1 })
    const page = env.page()
    const lineId = page._schedule.lines[0].id
    revealAndTapDelete(page, 'line', lineId)
    const modal = env.events.modals.at(-1)
    page.onHide()
    modal.success({ confirm: true, cancel: false })
    assert.equal(page._schedule.lines.some((line) => line.id === lineId), true,
      'a stale confirmation after hide does not delete the line')
    assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 0)
    page.onUnload()
  }

  for (const [actionType, method] of [['delete', 'deleteWorkspaceRecord'], ['connect', 'connectDevice']]) {
    const env = createRuntime()
    const page = env.page()
    const deviceId = 'receiver-1'
    const groupIndex = undefined
    const dataset = {
      actionType,
      deleteType: actionType === 'delete' ? 'device' : undefined,
      projectId: page.projectId,
      id: deviceId,
      revision: String(page._schedule.revision),
    }

    swipeRow(page, 'device', deviceId, groupIndex, 0)
    tapWithoutChangedTouches(page, method, dataset)
    assert.equal(env.events.modals.length, 0,
      `${actionType} tap without changedTouches immediately after the horizontal drag is suppressed`)
    assert.equal(page.data.editorVisible, false,
      `${actionType} stale tap without changedTouches does not activate the connected action`)
    assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 0)

    freshParentTapStart(page, 'device', deviceId, groupIndex, 0)
    tapWithoutChangedTouches(page, method, dataset)
    if (actionType === 'delete') {
      assert.equal(env.events.modals.length, 1,
        'a fresh parent touchstart with reused identifier zero clears old suppression and reaches confirmation')
      assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 0)
    } else {
      assert.equal(page.data.editorVisible, true,
        'a fresh parent touchstart with reused identifier zero permits the connect action')
    }
    page.onUnload()
  }

  console.log('PASS isolated delete controller route (parent-touch sequence, modal/storage guards, stale-suppression edge)')
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 })

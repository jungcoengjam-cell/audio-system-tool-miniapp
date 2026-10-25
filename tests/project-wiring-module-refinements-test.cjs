const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { createRuntime: createRuntimeFixture, makeFixture, clone, root } = require('./project-wiring-redesign-2026-10-16/runtime.cjs')
const projectRecords = require('../utils/records')
const { evidenceRoot } = require('./project-wiring-redesign-2026-10-16/module-refinements-support.cjs')

const projectKey = 'audioTool.projects.v1'
const activeKey = 'audioTool.activeProject.v1'
const preferenceKey = 'audioTool.projectWiring.view.v1'
const recordsPath = path.join(root, 'utils/records.js')
const checks = []

function createRuntime() {
  const env = createRuntimeFixture()
  // Interaction cases start with current storage; legacy cases set their own schema below.
  Object.assign(env.storage, {
    'audioTool.storageSchemaVersion': 4,
    'audioTool.records.v1': [], 'audioTool.favorites.v1': [], 'audioTool.recovery.v1': [],
  })
  return env
}

function check(name, fn) { checks.push({ name, fn }) }
function currentProject(env) { return env.storage[projectKey].find((item) => item.id === 'qa-project-1') }
function seedSecondProject(env) {
  const project = makeFixture()
  project.id = 'qa-project-2'
  project.name = 'Second QA Project'
  env.storage[projectKey] = env.storage[projectKey].map((item) => item.id === project.id ? project : item)
  return project
}
function setPreference(env, value) { env.storage[preferenceKey] = clone(value) }
function deviceEvent(page, type, id) { return { currentTarget: { dataset: {
  deleteType: type, actionType: 'delete', projectId: page.projectId, id, revision: page._schedule.revision,
} } } }
function withWorkspaceRecords(overrides, run) {
  const originalLoad = Module._load
  Module._load = function(request, parent, isMain) {
    const actual = originalLoad.call(this, request, parent, isMain)
    const pageModule = parent && parent.filename && [
      `${path.sep}pages${path.sep}project-wiring${path.sep}workspace-ui.js`,
      `${path.sep}pages${path.sep}project-wiring${path.sep}index.js`,
    ].some((suffix) => parent.filename.endsWith(suffix))
    if (pageModule && request === '../../utils/records') {
      return { ...actual, ...overrides(actual) }
    }
    return actual
  }
  try { return run() } finally { Module._load = originalLoad }
}
function assertNoProjectWrites(env) {
  assert.equal(env.events.writes.filter((write) => write.key === projectKey).length, 0)
  assert.equal(env.events.writes.filter((write) => write.key === activeKey).length, 0)
}

check('view preference restores the stable project and tab, while explicit route ID wins', () => {
  const env = createRuntime()
  env.storage[activeKey] = 'qa-project-2'
  setPreference(env, { version: 1, projectId: 'qa-project-1', tab: 'lines' })
  const page = env.page()
  assert.equal(page.data.project.id, 'qa-project-1')
  assert.equal(page.data.workspaceTab, 'lines')
  assert.equal(env.storage[activeKey], 'qa-project-2')
  assertNoProjectWrites(env)

  const routed = createRuntime()
  seedSecondProject(routed)
  routed.storage[activeKey] = 'qa-project-1'
  setPreference(routed, { version: 1, projectId: 'qa-project-1', tab: 'lines' })
  const routePage = routed.page({ id: 'qa-project-2' })
  assert.equal(routePage.data.project.id, 'qa-project-2')
  assert.equal(routePage.data.workspaceTab, 'lines')
  assert.deepEqual(routed.storage[preferenceKey], { version: 1, tab: 'lines', projectId: 'qa-project-2' })
})

check('malformed, wrong-version, name, and index preferences never select by name/index', () => {
  const cases = [
    ['wrong version', { version: 2, projectId: 'qa-project-1', tab: 'lines' }],
    ['name used as ID', { version: 1, projectId: 'Hall name', tab: 'lines', projectName: 'Hall name' }],
    ['empty ID', { version: 1, projectId: '', tab: 'lines' }],
    ['whitespace ID', { version: 1, projectId: '   ', tab: 'lines' }],
    ['numeric ID', { version: 1, projectId: 1, tab: 'lines' }],
    ['index only', { version: 1, projectIndex: 0, tab: 'lines' }],
    ['wrong shape', ['qa-project-1', 'lines']],
    ['invalid tab', { version: 1, projectId: 'qa-project-1', tab: 'devices-name' }],
    ['too-long ID', { version: 1, projectId: 'x'.repeat(101), tab: 'lines' }],
  ]
  for (const [label, value] of cases) {
    const env = createRuntime()
    seedSecondProject(env)
    env.storage[activeKey] = 'qa-project-2'
    const rawValue = label === 'name used as ID'
      ? { ...value, projectId: currentProject(env).name, projectName: currentProject(env).name }
      : value
    setPreference(env, rawValue)
    const page = env.page()
    if (label === 'invalid tab') {
      assert.equal(page.data.project.id, 'qa-project-1')
    } else {
      assert.equal(page.data.project, null, `${label}: malformed schema v1 ID must suppress fallback`)
      assert.equal(page.data.selectionRequired, true)
    }
    assert.equal(page.data.workspaceTab, rawValue.version === 1 && rawValue.tab === 'lines' ? 'lines' : 'devices')
    assert.equal(env.storage[activeKey], 'qa-project-2')
    assertNoProjectWrites(env)
  }
})

check('deleted remembered ID clears to tab-only and a second relaunch does not active-fallback', () => {
  const env = createRuntime()
  seedSecondProject(env)
  env.storage[activeKey] = 'qa-project-2'
  setPreference(env, { version: 1, projectId: 'deleted-project', tab: 'lines' })
  const page = env.page()
  assert.equal(page.data.project, null)
  assert.equal(page.data.workspaceTab, 'lines')
  assert.deepEqual(env.storage[preferenceKey], { version: 1, tab: 'lines' })
  assertNoProjectWrites(env)
  const relaunched = env.page()
  assert.equal(relaunched.data.project, null)
  assert.equal(relaunched.data.selectionRequired, true)
  assert.equal(relaunched.data.workspaceTab, 'lines')
  assert.equal(env.storage[activeKey], 'qa-project-2')
  assertNoProjectWrites(env)
})

check('preference read/write failures stay nonfatal and do not alter project records', () => {
  const missingPreference = createRuntime()
  missingPreference.storage[activeKey] = 'qa-project-2'
  const unselectedPage = missingPreference.page()
  assert.equal(unselectedPage.data.project, null)
  assert.equal(unselectedPage.data.selectionRequired, true)
  assert.equal(unselectedPage.data.projectPickerVisible, true)
  assert.equal(missingPreference.storage[activeKey], 'qa-project-2')
  assertNoProjectWrites(missingPreference)

  const readFailure = createRuntime()
  seedSecondProject(readFailure)
  readFailure.failPreferenceReads(true)
  readFailure.storage[activeKey] = 'qa-project-2'
  const fallbackPage = readFailure.page()
  assert.equal(fallbackPage.data.project, null)
  assert.equal(fallbackPage.data.selectionRequired, true)
  assert.equal(fallbackPage.data.projectPickerVisible, true)
  assert.equal(readFailure.storage[activeKey], 'qa-project-2')
  assertNoProjectWrites(readFailure)

  const writeFailure = createRuntime()
  writeFailure.failPreferenceWrites(true)
  setPreference(writeFailure, { version: 1, projectId: 'qa-project-1', tab: 'devices' })
  const selectedPage = writeFailure.page()
  assert.equal(selectedPage.data.project.id, 'qa-project-1')
  selectedPage.onWorkspaceTab({ currentTarget: { dataset: { tab: 'lines' } } })
  assert.equal(selectedPage.data.workspaceTab, 'lines')
  assert.equal(writeFailure.storage[preferenceKey].tab, 'devices')
  assertNoProjectWrites(writeFailure)
})

check('schema-v1 remembered, tab-only, invalid, and missing preference launches do not migrate legacy project storage', () => {
  const cases = [
    ['remembered', { version: 1, projectId: 'qa-project-1', tab: 'lines' }, 'qa-project-1'],
    ['tab-only', { version: 1, tab: 'lines' }, null],
    ['invalid ID', { version: 1, projectId: 1, tab: 'lines' }, null],
    ['missing ID', { version: 1, projectId: 'deleted-project', tab: 'lines' }, null],
  ]
  for (const [label, preference, expectedProjectId] of cases) {
    const env = createRuntime()
    env.storage['audioTool.storageSchemaVersion'] = 1
    env.storage[activeKey] = 'qa-project-2'
    setPreference(env, preference)
    const before = clone(env.storage)
    const page = env.page()
    assert.equal(page.data.project?.id || null, expectedProjectId, `${label}: selected project`)
    assert.equal(page.data.workspaceTab, 'lines')
    const nonPreferenceWrites = env.events.writes.filter((write) => write.key !== preferenceKey)
    assert.deepEqual(nonPreferenceWrites, [], `${label}: no project, records, active, or schema writes`)
    const afterRaw = clone(env.storage); delete afterRaw[preferenceKey]
    const beforeRaw = clone(before); delete beforeRaw[preferenceKey]
    assert.deepEqual(afterRaw, beforeRaw, `${label}: raw legacy records/projects/schema remain unchanged`)
    if (label === 'missing ID') assert.deepEqual(env.storage[preferenceKey], { version: 1, tab: 'lines' })
  }
})

check('remembered-project storage read failure preserves ID, offers retry, and never falls back', () => {
  const env = createRuntime()
  seedSecondProject(env)
  env.storage[activeKey] = 'qa-project-2'
  setPreference(env, { version: 1, projectId: 'qa-project-1', tab: 'lines' })
  env.failReads(true)
  const page = env.page()
  assert.equal(page.data.project, null)
  assert.equal(page.data.canRetry, true)
  assert.equal(env.storage[preferenceKey].projectId, 'qa-project-1')
  assert.equal(env.storage[activeKey], 'qa-project-2')
  assertNoProjectWrites(env)
  env.failReads(false)
  page.retryLoad()
  assert.equal(page.data.project.id, 'qa-project-1')
  assert.equal(page.data.workspaceTab, 'lines')
  assertNoProjectWrites(env)
})

check('late asynchronous preference load cannot overwrite an explicit project selection', async () => {
  const env = createRuntime()
  seedSecondProject(env)
  setPreference(env, { version: 1, projectId: 'qa-project-1', tab: 'lines' })
  let resolveOld
  let oldCalls = 0
  const page = withWorkspaceRecords((actual) => ({
    getProjectWiring(id) {
      if (id === 'qa-project-1') { oldCalls++; return new Promise((resolve) => { resolveOld = resolve }) }
      return actual.getProjectWiring(id)
    },
  }), () => env.page())
  assert.equal(oldCalls, 1)
  page.requestProjectPicker()
  page.onProjectWheelChange({ detail: { value: [1] } })
  page.confirmProjectPicker()
  assert.equal(page.data.project.id, 'qa-project-2')
  resolveOld({ ok: true, project: currentProject(env), schedule: currentProject(env).wiringSchedule })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.project.id, 'qa-project-2')
  assert.equal(env.storage[preferenceKey].projectId, 'qa-project-2')
  assertNoProjectWrites(env)
})

check('hide during remembered-project read still safely handles a deleted record', async () => {
  const env = createRuntime()
  setPreference(env, { version: 1, projectId: 'deleted-project', tab: 'lines' })
  let resolveLoad
  const page = withWorkspaceRecords((actual) => ({
    getProjectWiring() { return new Promise((resolve) => { resolveLoad = () => resolve(actual.getProjectWiring('deleted-project')) }) },
  }), () => env.page())
  page.onHide()
  resolveLoad()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.project, null)
  assert.equal(page.data.workspaceTab, 'lines')
  assert.deepEqual(env.storage[preferenceKey], { version: 1, tab: 'lines' })
  assertNoProjectWrites(env)
})

check('stale same-project load returning while a newer request is pending does not clear preference', async () => {
  const env = createRuntime()
  setPreference(env, { version: 1, projectId: 'qa-project-1', tab: 'lines' })
  let resolveFirst
  let resolveSecond
  let loadCalls = 0
  const page = withWorkspaceRecords((actual) => ({
    getProjectWiring(id) {
      if (id !== 'qa-project-1') return actual.getProjectWiring(id)
      loadCalls++
      return new Promise((resolve) => {
        if (loadCalls === 1) resolveFirst = resolve
        else resolveSecond = resolve
      })
    },
  }), () => env.page())
  assert.equal(loadCalls, 1)
  page.refreshProjectWiring()
  assert.equal(loadCalls, 2)
  resolveFirst({ ok: false, error: 'QA stale request says project missing' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.projectId, 'qa-project-1')
  assert.equal(env.storage[preferenceKey].projectId, 'qa-project-1')
  assert.equal(page.data.project, null)
  resolveSecond({ ok: true, project: currentProject(env), schedule: currentProject(env).wiringSchedule })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.project.id, 'qa-project-1')
  assert.equal(page.data.workspaceTab, 'lines')
  assert.equal(env.storage[preferenceKey].projectId, 'qa-project-1')
  assertNoProjectWrites(env)
})

check('remembered-project load resolving after unload is ignored without setData or preference writes', async () => {
  const env = createRuntime()
  setPreference(env, { version: 1, projectId: 'qa-project-1', tab: 'lines' })
  let resolveLoad
  const page = withWorkspaceRecords((actual) => ({
    getProjectWiring(id) {
      if (id === 'qa-project-1') return new Promise((resolve) => { resolveLoad = resolve })
      return actual.getProjectWiring(id)
    },
  }), () => env.page())
  page.onUnload()
  let setDataCallsAfterUnload = 0
  const setData = page.setData
  page.setData = function(...args) { setDataCallsAfterUnload++; return setData.apply(this, args) }
  const writesBeforeResolve = clone(env.events.writes)
  const preferenceBeforeResolve = clone(env.storage[preferenceKey])
  resolveLoad({ ok: true, project: currentProject(env), schedule: currentProject(env).wiringSchedule })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(setDataCallsAfterUnload, 0)
  assert.deepEqual(env.events.writes, writesBeforeResolve)
  assert.deepEqual(env.storage[preferenceKey], preferenceBeforeResolve)
  assert.equal(page.data.project, null)
  assertNoProjectWrites(env)
})

check('recovering from remembered A read failure then selecting B keeps Retry bound to B', () => {
  const env = createRuntime()
  seedSecondProject(env)
  env.storage[activeKey] = 'qa-project-1'
  setPreference(env, { version: 1, projectId: 'qa-project-1', tab: 'lines' })
  env.failReads(true)
  let failProjectB = false
  const calls = []
  const page = withWorkspaceRecords((actual) => ({
    getProjectWiring(id) {
      calls.push(id)
      if (id === 'qa-project-2' && failProjectB) throw Error('QA temporary B read failure')
      return actual.getProjectWiring(id)
    },
  }), () => env.page())
  assert.equal(page.data.canRetry, true)
  assert.equal(page.data.project, null)
  assert.equal(env.storage[preferenceKey].projectId, 'qa-project-1')
  env.failReads(false)
  page.requestProjectPicker()
  assert.equal(page.data.projectPickerVisible, true)
  page.onProjectWheelChange({ detail: { value: [1] } })
  failProjectB = true
  page.confirmProjectPicker()
  assert.equal(page.projectId, 'qa-project-2')
  assert.equal(page.data.project, null)
  assert.equal(page.data.canRetry, true)
  assert.equal(env.storage[preferenceKey].projectId, 'qa-project-1')
  assert.equal(env.storage[activeKey], 'qa-project-1')
  failProjectB = false
  page.retryLoad()
  assert.equal(page.data.project.id, 'qa-project-2')
  assert.equal(page.data.workspaceTab, 'lines')
  assert.equal(env.storage[preferenceKey].projectId, 'qa-project-2')
  assert.equal(env.storage[activeKey], 'qa-project-1')
  assert.ok(calls.filter((id) => id === 'qa-project-2').length >= 2)
  assertNoProjectWrites(env)
})

check('device confirmation is explicit, cancellation is inert, and duplicate confirm callback saves once', () => {
  const env = createRuntime()
  const calls = []
  const page = withWorkspaceRecords((actual) => ({
    saveProjectWiring(...args) { calls.push(args); return actual.saveProjectWiring(...args) },
  }), () => env.page({ id: 'qa-project-1' }))
  const before = clone(currentProject(env).wiringSchedule)
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'receiver-1'))
  const prompt = env.events.modals.at(-1)
  assert.match(prompt.content, /4/)
  prompt.success({ confirm: false, cancel: true })
  assert.equal(calls.length, 0)
  assert.deepEqual(currentProject(env).wiringSchedule, before)
  assert.equal(page.data.saving, false)
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'receiver-1'))
  const confirmed = env.events.modals.at(-1)
  confirmed.success({ confirm: true })
  confirmed.success({ confirm: true })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][1], {
    type: 'delete-device', id: 'receiver-1', deleteConnectedLines: true,
    expectedLineIds: ['qa-line-1', 'qa-line-2', 'qa-line-3', 'qa-line-4'],
  })
  assert.equal(page.data.saving, false)
  assert.equal(currentProject(env).wiringSchedule.devices.some((device) => device.id === 'receiver-1'), false)
  assert.equal(currentProject(env).wiringSchedule.lines.length, 0)
})

check('unconnected device uses an explicit empty cascade set and stale revisions cannot open confirmation', () => {
  const env = createRuntime()
  const project = currentProject(env)
  project.wiringSchedule.devices.push({ id: 'unused-1', type: 'amplifier', name: 'Unused' })
  const page = env.page({ id: 'qa-project-1' })
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'unused-1'))
  assert.match(env.events.modals.at(-1).content, /Unused/)
  env.respondModal(true)
  assert.equal(currentProject(env).wiringSchedule.devices.some((device) => device.id === 'unused-1'), false)

  const stale = createRuntime()
  const stalePage = stale.page({ id: 'qa-project-1' })
  stalePage.deleteWorkspaceRecord({ currentTarget: { dataset: { deleteType: 'line', id: 'qa-line-1', revision: stalePage._schedule.revision - 1 } } })
  assert.equal(stale.events.modals.length, 0)
  assert.equal(stale.events.writes.filter((write) => write.key === projectKey).length, 0)
})

check('a target deleted externally before confirmation cannot cascade into other records', () => {
  const env = createRuntime()
  const page = env.page({ id: 'qa-project-1' })
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'receiver-1'))
  const modal = env.events.modals.at(-1)
  const exactIds = page._schedule.lines.filter((line) => line.fromDeviceId === 'receiver-1' || line.toDeviceId === 'receiver-1').map((line) => line.id)
  const external = projectRecords.saveProjectWiring('qa-project-1', {
    type: 'delete-device', id: 'receiver-1', deleteConnectedLines: true, expectedLineIds: exactIds,
  }, page._schedule.revision)
  assert.equal(external.ok, true)
  modal.success({ confirm: true })
  assert.equal(currentProject(env).wiringSchedule.devices.some((device) => device.id === 'receiver-1'), false)
  assert.deepEqual(currentProject(env).wiringSchedule.devices.map((device) => device.id), ['mixer-1', 'amplifier-1', 'mixer-duplicate'])
  assert.equal(page.data.saving, false)
  assert.equal(currentProject(env).wiringSchedule.lines.length, 0)
})

check('save failure keeps the row and data intact so a fresh confirmation can retry', () => {
  const env = createRuntime()
  currentProject(env).wiringSchedule.devices.push({ id: 'unused-1', type: 'amplifier', name: 'Unused' })
  const calls = []
  let fail = true
  const page = withWorkspaceRecords((actual) => ({
    saveProjectWiring(...args) {
      calls.push(args)
      return fail ? { ok: false, error: 'QA save failure' } : actual.saveProjectWiring(...args)
    },
  }), () => env.page({ id: 'qa-project-1' }))
  const before = clone(currentProject(env).wiringSchedule)
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'unused-1'))
  env.respondModal(true)
  assert.equal(page.data.saving, false)
  assert.equal(page._schedule.devices.some((device) => device.id === 'unused-1'), true)
  assert.equal(calls.length, 1)
  fail = false
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'unused-1'))
  env.respondModal(true)
  assert.equal(calls.length, 2)
  assert.equal(page._schedule.devices.some((device) => device.id === 'unused-1'), false)
  assert.ok(before.devices.some((device) => device.id === 'receiver-1'))
})

check('legacy same-name endpoint deletes only its exact legacy line IDs', () => {
  const env = createRuntime()
  const project = currentProject(env)
  const deviceName = project.wiringSchedule.devices.find((device) => device.id === 'receiver-1').name
  const legacy = { ...project.wiringSchedule.lines[0], id: 'legacy-same-name-line', code: 'A005', fromDevice: deviceName }
  delete legacy.fromDeviceId
  project.wiringSchedule.lines.push(legacy)
  project.wiringSchedule.nextNumber = 6
  const calls = []
  const page = withWorkspaceRecords((actual) => ({
    saveProjectWiring(...args) { calls.push(args); return actual.saveProjectWiring(...args) },
  }), () => env.page({ id: 'qa-project-1' }))
  const legacyId = `legacy:${JSON.stringify(deviceName)}`
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', legacyId))
  const prompt = env.events.modals.at(-1)
  assert.match(prompt.content, /1/)
  prompt.success({ confirm: true })
  assert.deepEqual(calls[0][1], { type: 'delete-lines', ids: ['legacy-same-name-line'] })
  const saved = currentProject(env).wiringSchedule
  assert.ok(saved.devices.some((device) => device.id === 'receiver-1'))
  assert.equal(saved.lines.some((line) => line.id === 'legacy-same-name-line'), false)
  assert.equal(saved.lines.length, 4)
})

check('filtered later line group deletes by stable line ID, not source group index', () => {
  const env = createRuntime()
  const calls = []
  const page = withWorkspaceRecords((actual) => ({
    saveProjectWiring(...args) { calls.push(args); return actual.saveProjectWiring(...args) },
  }), () => env.page({ id: 'qa-project-1' }))
  page.onWorkspaceTab({ currentTarget: { dataset: { tab: 'lines' } } })
  page.applySearch({ detail: { value: 'A004' } })
  assert.equal(page.data.groups.length, 1)
  assert.deepEqual(page.data.groups[0].lines.map((line) => line.id), ['qa-line-4'])
  const visible = page.data.groups[0].lines[0]
  const originalGroupIndex = page._workspace.groups.findIndex((group) => group.lines.some((line) => line.id === 'qa-line-4'))
  assert.equal(originalGroupIndex, 1)
  page.onSwipeTouchStart({ currentTarget: { dataset: { swipeType: 'line', swipeId: visible.id, groupIndex: page.data.groups[0].groupIndex }, }, touches: [{ clientX: 210, clientY: 100 }] })
  page.onSwipeTouchMove({ touches: [{ clientX: 100, clientY: 101 }] })
  page.onSwipeTouchEnd({ changedTouches: [{ clientX: 100, clientY: 101 }] })
  assert.equal(page.data.groups[0].lines[0].swipeOpen, true, 'current filtered row receives swipe state')
  const deleteAction = { currentTarget: { dataset: { deleteType: 'line', actionType: 'delete', projectId: page.projectId,
    id: 'qa-line-4', revision: page._schedule.revision } } }
  page.deleteWorkspaceRecord(deleteAction)
  assert.equal(env.events.modals.length, 0, 'the swipe-release ghost tap cannot expose Delete confirmation')
  assert.equal(calls.length, 0, 'the swipe-release ghost tap cannot write')
  const rowTarget = { dataset: { swipeType: 'line', swipeId: visible.id, groupIndex: page.data.groups[0].groupIndex } }
  page.onSwipeTouchStart({ currentTarget: rowTarget, touches: [{ identifier: 0, clientX: 120, clientY: 100 }] })
  page.onSwipeTouchEnd({ currentTarget: rowTarget, changedTouches: [{ identifier: 0, clientX: 120, clientY: 100 }] })
  page.deleteWorkspaceRecord(deleteAction)
  assert.equal(env.events.modals.length, 1, 'a fresh parent touch enables the explicit Delete click')
  env.respondModal(true)
  assert.deepEqual(calls[0][1], { type: 'delete', id: 'qa-line-4' })
  assert.equal(currentProject(env).wiringSchedule.lines.some((line) => line.id === 'qa-line-4'), false)
  assert.equal(currentProject(env).wiringSchedule.lines.length, 3)
})

check('row gesture keeps an unmoved child tap and suppresses post-scroll detail taps', () => {
  const env = createRuntime()
  const page = env.page({ id: 'qa-project-1' })
  page.onWorkspaceTab({ currentTarget: { dataset: { tab: 'lines' } } })
  const group = page.data.groups[0]
  const id = group.lines[0].id
  page.onSwipeTouchStart({ currentTarget: { dataset: { swipeType: 'line', swipeId: id, groupIndex: group.groupIndex } }, touches: [{ clientX: 180, clientY: 80 }] })
  page.onSwipeTouchEnd({ changedTouches: [{ clientX: 180, clientY: 80 }] })
  page.onLineTap({ currentTarget: { dataset: { id } } })
  assert.equal(page.data.detailVisible, true)
  page.closeLineDetails()
  page._tapSuppressedUntil = 0
  page.onSwipeTouchStart({ currentTarget: { dataset: { swipeType: 'line', swipeId: id, groupIndex: group.groupIndex } }, touches: [{ clientX: 180, clientY: 80 }] })
  page.onSwipeTouchMove({ touches: [{ clientX: 181, clientY: 105 }] })
  page.onSwipeTouchEnd({ changedTouches: [{ clientX: 181, clientY: 105 }] })
  page.onLineTap({ currentTarget: { dataset: { id } } })
  assert.equal(page.data.detailVisible, false)
})

check('swipe direction lock, one-open-row rule, cancel, and tab/search/form/share/lifecycle cleanup', () => {
  const env = createRuntime()
  const page = env.page({ id: 'qa-project-1' })
  const deviceGesture = (id, startX = 200, startY = 100) => ({
    currentTarget: { dataset: { swipeType: 'device', swipeId: id, revision: page._schedule.revision } },
    touches: [{ clientX: startX, clientY: startY }],
  })
  const move = (x, y) => ({ touches: [{ clientX: x, clientY: y }] })
  const end = (x, y) => ({ changedTouches: [{ clientX: x, clientY: y }] })
  page.onSwipeTouchStart(deviceGesture('receiver-1'))
  page.onSwipeTouchMove(move(90, 101))
  page.onSwipeTouchEnd(end(90, 101))
  assert.equal(page.data.devices.find((item) => item.id === 'receiver-1').swipeOpen, true)
  page.onSwipeTouchStart(deviceGesture('mixer-1'))
  page.onSwipeTouchMove(move(90, 101))
  page.onSwipeTouchEnd(end(90, 101))
  assert.equal(page.data.devices.filter((item) => item.swipeOpen).length, 1)
  assert.equal(page.data.devices.find((item) => item.id === 'mixer-1').swipeOpen, true)
  page.onSwipeTouchStart(deviceGesture('mixer-1'))
  page.onSwipeTouchMove(move(202, 125))
  page.onSwipeTouchEnd(end(202, 125))
  assert.equal(page.data.devices.some((item) => item.swipeOpen), false, 'vertical movement closes rather than exposing delete')
  page.onSwipeTouchStart(deviceGesture('receiver-1'))
  page.onSwipeTouchMove(move(90, 100))
  page.onSwipeTouchEnd(end(90, 100))
  page.onSwipeTouchCancel()
  assert.equal(page.data.devices.some((item) => item.swipeOpen), false, 'touchcancel returns the row to its stable closed state')

  page.onSwipeTouchStart(deviceGesture('receiver-1'))
  page.onSwipeTouchMove(move(90, 100)); page.onSwipeTouchEnd(end(90, 100))
  page.onWorkspaceTab({ currentTarget: { dataset: { tab: 'lines' } } })
  assert.equal(page.data.devices.some((item) => item.swipeOpen), false, 'tab switch closes swipe')
  const lineGroup = page.data.groups[0]
  const lineId = lineGroup.lines[0].id
  page.onSwipeTouchStart({ currentTarget: { dataset: { swipeType: 'line', swipeId: lineId, groupIndex: lineGroup.groupIndex } }, touches: [{ clientX: 200, clientY: 100 }] })
  page.onSwipeTouchMove(move(90, 100)); page.onSwipeTouchEnd(end(90, 100))
  page.applySearch({ detail: { value: 'A004' } })
  assert.equal(page.data.groups.some((group) => group.lines.some((line) => line.swipeOpen)), false, 'search closes swipe')
  page.clearSearch()
  page.onWorkspaceTab({ currentTarget: { dataset: { tab: 'devices' } } })
  page.onSwipeTouchStart(deviceGesture('receiver-1'))
  page.onSwipeTouchMove(move(90, 100)); page.onSwipeTouchEnd(end(90, 100))
  page.openDeviceEditor()
  assert.equal(page.data.devices.some((item) => item.swipeOpen), false, 'opening an edit form closes swipe')
  page.requestCloseDeviceEditor()
  page.generateExport = () => {}
  page.onSwipeTouchStart(deviceGesture('receiver-1'))
  page.onSwipeTouchMove(move(90, 100)); page.onSwipeTouchEnd(end(90, 100))
  page.shareProject()
  assert.equal(page.data.devices.some((item) => item.swipeOpen), false, 'share closes swipe')
  page.onSwipeTouchStart(deviceGesture('receiver-1'))
  page.onSwipeTouchMove(move(90, 100)); page.onSwipeTouchEnd(end(90, 100))
  page.onHide()
  assert.equal(page.data.devices.some((item) => item.swipeOpen), false, 'hide closes swipe')
  page.onShow()
  page.onSwipeTouchStart(deviceGesture('receiver-1'))
  page.onSwipeTouchMove(move(90, 100)); page.onSwipeTouchEnd(end(90, 100))
  page.onUnload()
  assert.equal(page._workspaceSwipeGesture, null)
  assert.equal(page._workspaceSwipeTimer, undefined)
})

check('delete confirmation is invalidated by hide/project switch and unload callbacks cannot mutate records', async () => {
  const env = createRuntime()
  seedSecondProject(env)
  const calls = []
  const page = withWorkspaceRecords((actual) => ({
    saveProjectWiring(...args) { calls.push(args); return actual.saveProjectWiring(...args) },
  }), () => env.page({ id: 'qa-project-1' }))
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'receiver-1'))
  const hiddenModal = env.events.modals.at(-1)
  page.onHide()
  hiddenModal.success({ confirm: true })
  assert.equal(calls.length, 0)
  page.onShow()
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'receiver-1'))
  const switchedModal = env.events.modals.at(-1)
  page.requestProjectPicker()
  page.onProjectWheelChange({ detail: { value: [1] } })
  page.confirmProjectPicker()
  assert.equal(page.projectId, 'qa-project-2')
  assert.equal(page.data.project.id, 'qa-project-2')
  switchedModal.success({ confirm: true })
  assert.equal(calls.length, 0)
  await new Promise((resolve) => setTimeout(resolve, 260))
  page.requestProjectPicker()
  page.onProjectWheelChange({ detail: { value: [0] } })
  page.confirmProjectPicker()
  assert.equal(page.projectId, 'qa-project-1')
  await new Promise((resolve) => setTimeout(resolve, 260))
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'receiver-1'))
  const unloadedModal = env.events.modals.at(-1)
  page.onUnload()
  unloadedModal.success({ confirm: true })
  assert.equal(calls.length, 0)
  assert.ok(currentProject(env).wiringSchedule.devices.some((device) => device.id === 'receiver-1'))
})

check('async save invalidates exports; hide-show-load race refreshes current project on response', async () => {
  const env = createRuntime()
  let resolveSave
  let saveCalls = 0
  const page = withWorkspaceRecords((actual) => ({
    saveProjectWiring(...args) {
      saveCalls++
      return new Promise((resolve) => { resolveSave = () => resolve(actual.saveProjectWiring(...args)) })
    },
  }), () => env.page({ id: 'qa-project-1' }))
  page._reportSignature = 'qa-project-1:0:lines'
  page._reportPending = true
  const reportRevision = page._reportRevision
  page.deleteWorkspaceRecord(deviceEvent(page, 'device', 'receiver-1'))
  env.respondModal(true)
  assert.equal(page.data.saving, true)
  assert.ok(page._reportRevision > reportRevision)
  assert.equal(page._reportSignature, '')
  page.onHide()
  page.onShow()
  assert.equal(page.projectId, 'qa-project-1')
  resolveSave()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(saveCalls, 1)
  assert.equal(page.data.saving, false)
  assert.ok(!page.data.project || page.data.project.id === page.projectId)
  assert.equal(page._schedule.devices.some((device) => device.id === 'receiver-1'), false)
  assert.equal(page._workspaceDeleteNeedsRefresh, false)
})

async function main() {
  const failures = []
  const caseResults = []
  for (const { name, fn } of checks) {
    try { await fn(); caseResults.push({ name, passed: true }); console.log(`PASS ${name}`) }
    catch (error) { const failure = { name, error: error.stack || String(error) }; failures.push(failure); caseResults.push({ name, passed: false, error: failure.error }); console.error(`FAIL ${name}\n${error.stack || error}`) }
  }
  const report = { runAt: new Date().toISOString(), suite: 'project-wiring module refinement controller and storage isolation', total: checks.length, passed: checks.length - failures.length, failed: failures.length, cases: caseResults, failures }
  fs.mkdirSync(evidenceRoot, { recursive: true })
  fs.writeFileSync(path.join(evidenceRoot, 'controller-checks.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (failures.length) process.exitCode = 1
}

main()

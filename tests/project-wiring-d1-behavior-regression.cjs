'use strict'

const assert = require('node:assert/strict')
const wiring = require('../utils/project-wiring')

const PROJECTS_KEY = 'audioTool.projects.v1'
const SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const recordsKey = require.resolve('../utils/records')
const pageKey = require.resolve('../pages/project-wiring/index')
const workspaceUiKey = require.resolve('../pages/project-wiring/workspace-ui')
const performanceKey = require.resolve('../utils/performance')
const cachedModules = new Map([recordsKey, pageKey, workspaceUiKey, performanceKey]
  .map((key) => [key, require.cache[key]]))
const originalPage = global.Page
const originalWx = global.wx
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout
const originalConsoleInfo = console.info
const checks = []
const gaps = []

function check(condition, message) {
  assert.ok(condition, message)
  checks.push(message)
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message)
  checks.push(message)
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  checks.push(message)
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function makeSchedule(projectSuffix, lineCount) {
  let schedule = wiring.emptySchedule()
  const added = wiring.applyScheduleChange(schedule, {
    type: 'add-devices',
    devices: [
      { type: 'mixer', name: `Console ${projectSuffix}`, autoName: false },
      { type: 'speaker', name: `Speaker ${projectSuffix}`, autoName: false },
    ],
  })
  assert.equal(added.ok, true, added.error)
  schedule = added.schedule
  const [consoleId, speakerId] = added.deviceIds
  for (let index = 1; index <= lineCount; index += 1) {
    const result = wiring.applyScheduleChange(schedule, {
      type: 'upsert',
      line: {
        purpose: `Route ${index}`,
        fromDevice: `Console ${projectSuffix}`,
        fromDeviceId: consoleId,
        fromPort: `OUT-${index}`,
        toDevice: `Speaker ${projectSuffix}`,
        toDeviceId: speakerId,
        toPort: `IN-${index}`,
        buildType: 'bulk',
        cableType: 'balanced',
        spec: '2-core shielded',
        connectorA: 'xlrFemale',
        connectorB: 'xlrMale',
        lengthText: '4',
        status: 'pending',
        notes: '',
      },
    })
    assert.equal(result.ok, true, result.error)
    schedule = result.schedule
  }
  return schedule
}

function installClock() {
  let now = 0
  let nextId = 1
  const timers = []
  global.setTimeout = (callback, delay = 0, ...args) => {
    const timer = { id: nextId++, due: now + Math.max(0, Number(delay) || 0), callback, args, active: true }
    timers.push(timer)
    return timer.id
  }
  global.clearTimeout = (id) => {
    const timer = timers.find((item) => item.id === id)
    if (timer) timer.active = false
  }
  return {
    now: () => now,
    advanceBy(milliseconds) {
      const target = now + Math.max(0, Number(milliseconds) || 0)
      let turns = 0
      while (true) {
        const timer = timers.filter((item) => item.active && item.due <= target)
          .sort((left, right) => left.due - right.due || left.id - right.id)[0]
        if (!timer) break
        if (++turns > 10000) throw new Error('controlled timer runaway')
        timer.active = false
        now = timer.due
        timer.callback(...timer.args)
      }
      now = target
    },
  }
}

function makePage() {
  const clock = installClock()
  const storage = new Map()
  const writeCounts = new Map()
  const modals = []
  const canvas = { exports: 0, contexts: 0 }
  const toasts = []
  const projectA = makeSchedule('A', 4)
  const projectB = makeSchedule('B', 1)
  storage.set(SCHEMA_KEY, 4)
  storage.set(PROJECTS_KEY, [
    { id: 'project-A', name: 'Synthetic A', createdAt: 10, updatedAt: 20, wiringSchedule: projectA },
    { id: 'project-B', name: 'Synthetic B', createdAt: 11, updatedAt: 21, wiringSchedule: projectB },
  ])
  storage.set('audioTool.records.v1', [])
  storage.set('audioTool.favorites.v1', [])
  storage.set('audioTool.recovery.v1', [])

  const wxApi = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getPerformance: () => ({ now: () => clock.now() }),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 800, screenWidth: 390, screenHeight: 844, statusBarHeight: 24,
      safeArea: { top: 24, bottom: 820 } }),
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 800, screenWidth: 390, screenHeight: 844, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 300, top: 30, bottom: 68 }),
    getStorageSync(key) { return clone(storage.get(key)) },
    setStorageSync(key, value) {
      storage.set(key, clone(value))
      writeCounts.set(key, (writeCounts.get(key) || 0) + 1)
    },
    removeStorageSync(key) { storage.delete(key) },
    setNavigationBarTitle() {},
    setNavigationBarColor() {},
    onThemeChange() {},
    offThemeChange() {},
    showToast(options) { toasts.push(options && options.title || '') },
    showModal(options) { modals.push(options) },
    showLoading() {},
    hideLoading() {},
    hideKeyboard() {},
    vibrateShort() {},
    createCanvasContext() {
      canvas.contexts += 1
      return new Proxy({
        draw(_reserve, callback) { if (typeof callback === 'function') callback() },
      }, {
        get(target, key) {
          if (key in target) return target[key]
          return () => {}
        },
        set(target, key, value) { target[key] = value; return true },
      })
    },
    canvasToTempFilePath(options) {
      canvas.exports += 1
      if (options && typeof options.success === 'function') options.success({ tempFilePath: `synthetic-export-${canvas.exports}.png` })
    },
  }
  global.wx = wxApi
  global.Page = (definition) => { registeredPage = definition }
  global.console.info = () => {}
  for (const key of [recordsKey, pageKey, workspaceUiKey, performanceKey]) delete require.cache[key]
  let registeredPage
  require('../pages/project-wiring/index')
  assert.ok(registeredPage, 'the actual composed Page definition is registered')
  assert.equal(typeof require.cache[recordsKey].exports.getProjectWiring, 'function', 'actual records module is loaded')

  const patches = []
  const page = registeredPage
  page.data = clone(registeredPage.data)
  page.setData = (changes, callback) => {
    patches.push({ keys: Object.keys(changes), changes: clone(changes) })
    for (const [rawKey, value] of Object.entries(changes)) {
      const parts = rawKey.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index]
        if (!target[part] || typeof target[part] !== 'object') {
          target[part] = /^\d+$/.test(parts[index + 1]) ? [] : {}
        }
        target = target[part]
      }
      target[parts[parts.length - 1]] = clone(value)
    }
    if (typeof callback === 'function') callback.call(page)
  }
  page.onLoad({ id: 'project-A' })
  page.onShow()
  return { page, clock, storage, writeCounts, modals, canvas, toasts, patches }
}

function ids(items) { return items.map((item) => item.id) }
function visibleIds(page) { return ids(page.data.visibleLines || []) }
function workspaceLineIds(page) { return (page.data.groups || []).flatMap((group) => ids(group.lines || [])) }
function currentProjectRecord(storage, projectId) {
  return storage.get(PROJECTS_KEY).find((project) => project.id === projectId)
}
function currentDevice(page, nameFragment) {
  const found = page.data.devices.find((device) => device.name.includes(nameFragment))
  assert.ok(found, `workspace has device ${nameFragment}`)
  return found
}
function actionEvent(dataset, value) {
  return { currentTarget: { dataset }, target: { dataset: {} }, detail: value === undefined ? undefined : { value } }
}
function currentRenameEvent(page, device, value) {
  const session = page._inlineRename
  assert.ok(session, 'inline rename session exists')
  return actionEvent({
    actionType: 'rename-device',
    deviceKey: device.key,
    id: device.id,
    deviceId: device.id,
    projectId: page.projectId,
    revision: page._schedule.revision,
    renameSessionId: session.id,
  }, value)
}
function completeModal(runtime, confirm) {
  const modal = runtime.modals.shift()
  assert.ok(modal, 'delete action requested a native confirmation modal')
  modal.success({ confirm })
}
function deleteEvent(page, type, id, deviceKey = '') {
  return actionEvent({
    deleteType: type,
    id,
    ...(deviceKey ? { deviceKey } : {}),
    projectId: page.projectId,
    revision: page._schedule.revision,
  })
}
function closeReportPreview(page, clock) {
  if (!page.data.reportPreviewVisible) return
  page.closeReportPreview()
  clock.advanceBy(240)
}

let runtime
try {
  runtime = makePage()
  const { page, clock, storage, writeCounts, canvas, patches } = runtime
  equal(page.projectId, 'project-A', 'initial explicit project route loads project A')
  equal(page.data.lineCount, 4, 'real storage schedule loads four synthetic lines')
  deepEqual(visibleIds(page), page._schedule.lines.map((line) => line.id), 'initial visibleLines follows schedule order')

  patches.length = 0
  const initialVisible = visibleIds(page)
  page.onSearchInput(actionEvent({}, 'OUT-2'))
  equal(page.data.searchText, 'OUT-2', 'search text updates immediately')
  deepEqual(workspaceLineIds(page), [page._schedule.lines[1].id], 'composed workspace groups filter immediately')
  check(page.data.devices.length === 0, 'composed device list filters immediately for a port-only query')
  deepEqual(visibleIds(page), initialVisible, 'base visibleLines remain unchanged before the 180 ms debounce')
  check(patches[0].keys.includes('searchText'), 'base searchText setData precedes workspace refresh')
  check(patches.some((patch) => patch.keys.includes('groups') && patch.keys.includes('devices')), 'workspace refresh submits filtered groups and devices')
  clock.advanceBy(179)
  deepEqual(visibleIds(page), initialVisible, 'visibleLines are still unchanged at 179 ms')
  clock.advanceBy(1)
  deepEqual(visibleIds(page), [page._schedule.lines[1].id], 'visibleLines update at 180 ms in original schedule order')

  const rapidPatchStart = patches.length
  page.onSearchInput(actionEvent({}, 'OUT-1'))
  clock.advanceBy(100)
  page.onSearchInput(actionEvent({}, 'OUT-3'))
  deepEqual(workspaceLineIds(page), [page._schedule.lines[2].id], 'rapid typing immediately displays the latest workspace query')
  clock.advanceBy(80)
  deepEqual(visibleIds(page), [page._schedule.lines[1].id], 'old 180 ms deadline does not commit while the latest input is only 80 ms old')
  check(!patches.slice(rapidPatchStart).some((patch) => patch.keys.includes('visibleLines')),
    'rapid typing emits no visibleLines patch at the superseded first deadline')
  clock.advanceBy(100)
  deepEqual(visibleIds(page), [page._schedule.lines[2].id], 'latest query commits at 180 ms after its own input')
  const rapidVisibleCommits = patches.slice(rapidPatchStart).filter((patch) => patch.keys.includes('visibleLines'))
    .map((patch) => ids(patch.changes.visibleLines || []))
  deepEqual(rapidVisibleCommits, [[page._schedule.lines[2].id]], 'rapid typing commits only the latest visibleLines result')

  page.onSearchInput(actionEvent({}, 'OUT-1'))
  page.clearSearch()
  equal(page.data.searchText, '', 'clear search clears query immediately')
  deepEqual(visibleIds(page), page._schedule.lines.map((line) => line.id), 'clear search immediately restores visibleLines')
  deepEqual(workspaceLineIds(page), page._schedule.lines.map((line) => line.id), 'clear search immediately restores workspace groups')
  clock.advanceBy(180)
  deepEqual(visibleIds(page), page._schedule.lines.map((line) => line.id), 'cleared pending query cannot overwrite the cleared results')

  page.onSearchInput(actionEvent({}, 'OUT-2'))
  const visibleBeforeHideTimer = visibleIds(page)
  page.onHide()
  clock.advanceBy(180)
  const visibleAfterHideTimer = visibleIds(page)
  gaps.push({
    id: 'search-pending-on-hide',
    status: 'diagnostic-only',
    observedVisibleLinesChangedWhileHidden: JSON.stringify(visibleAfterHideTimer) !== JSON.stringify(visibleBeforeHideTimer),
    note: 'Current base timer checks destroyed/revision but not hidden; this result is recorded without asserting a desired hide policy.',
  })
  page.onShow()
  equal(page.projectId, 'project-A', 'same-project return through the real composed onShow preserves project A')
  deepEqual(visibleIds(page), [page._schedule.lines[1].id], 'same-project onShow refreshes visibleLines from synthetic storage')
  page.clearSearch()

  const consoleDevice = currentDevice(page, 'Console A')
  const beforeRenameCancelRevision = page._schedule.revision
  const beforeRenameCancelWrites = writeCounts.get(PROJECTS_KEY) || 0
  page.renameDevice(actionEvent({ actionType: 'rename-device', id: consoleDevice.id, deviceId: consoleDevice.id,
    deviceKey: consoleDevice.key, projectId: page.projectId, revision: page._schedule.revision }))
  check(Boolean(page._inlineRename), 'real composed Page opens inline rename session')
  const discardedRenameDraft = 'Discarded Console A'
  page.onInlineRenameInput(currentRenameEvent(page, consoleDevice, discardedRenameDraft))
  equal(page._inlineRename.latestValue, discardedRenameDraft, 'inline rename accepts a changed draft before hide cancellation')
  page.onHide()
  equal(page._inlineRename, null, 'real onHide cancels an in-progress inline rename session')
  equal(currentProjectRecord(storage, 'project-A').wiringSchedule.revision, beforeRenameCancelRevision,
    'hide-cancelled rename does not persist a revision')
  equal(writeCounts.get(PROJECTS_KEY) || 0, beforeRenameCancelWrites, 'hide-cancelled rename performs no project storage write')
  page.onShow()
  page.onSearchInput(actionEvent({}, 'Console A'))
  check(page.data.devices.some((device) => device.name === 'Console A'), 'cancelled draft leaves the persisted device name searchable')
  page.clearSearch()
  page.onSearchInput(actionEvent({}, discardedRenameDraft))
  check(!page.data.devices.some((device) => device.name === discardedRenameDraft), 'cancelled rename draft is absent from search results')
  page.clearSearch()

  page.generateExport('project')
  const exportCountAfterFirst = canvas.exports
  check(exportCountAfterFirst > 0 && page.data.reportImages.length > 0, 'native canvas mocks complete the actual project export path')
  const cacheSignature = page._reportSignature
  page.generateExport('project')
  equal(canvas.exports, exportCountAfterFirst, 'same project/revision/type reuses completed export cache')
  equal(page._reportSignature, cacheSignature, 'cached export retains the report signature')

  const renameDevice = currentDevice(page, 'Console A')
  page.renameDevice(actionEvent({ actionType: 'rename-device', id: renameDevice.id, deviceId: renameDevice.id,
    deviceKey: renameDevice.key, projectId: page.projectId, revision: page._schedule.revision }))
  const confirmedRename = currentRenameEvent(page, renameDevice, 'Renamed Console A')
  page.onInlineRenameInput(confirmedRename)
  page.onInlineRenameConfirm(confirmedRename)
  clock.advanceBy(0)
  equal(currentProjectRecord(storage, 'project-A').wiringSchedule.devices.find((item) => item.id === renameDevice.id).name,
    'Renamed Console A', 'inline confirm persists rename through actual records module')
  equal(page._reportSignature, '', 'rename invalidates cached export signature immediately')
  clock.advanceBy(240)
  deepEqual(page.data.reportImages, [], 'rename clears cached report images after the existing overlay close transition')
  const exportCountBeforeRebuild = canvas.exports
  page.generateExport('project')
  check(canvas.exports > exportCountBeforeRebuild, 'export cache rebuilds after the real rename revision change')

  page.clearSearch()
  page.onSearchInput(actionEvent({}, 'Renamed'))
  check(page.data.devices.some((device) => device.name === 'Renamed Console A'), 'renamed device appears in immediate workspace search results')
  check(workspaceLineIds(page).length === 4, 'renamed endpoint keeps its four associated lines in immediate groups')
  clock.advanceBy(180)
  deepEqual(visibleIds(page), page._schedule.lines.map((line) => line.id), 'base search results include lines after confirmed rename')
  page.clearSearch()

  const lineToDelete = page._schedule.lines[0]
  page.generateExport('project')
  const lineDeleteCacheSignature = page._reportSignature
  check(Boolean(lineDeleteCacheSignature && page.data.reportImages.length), 'line deletion starts with a populated export cache')
  closeReportPreview(page, clock)
  equal(page._reportSignature, lineDeleteCacheSignature, 'closing preview keeps the completed export cache')
  const writesBeforeLineCancel = writeCounts.get(PROJECTS_KEY) || 0
  page.deleteWorkspaceRecord(deleteEvent(page, 'line', lineToDelete.id))
  completeModal(runtime, false)
  equal(writeCounts.get(PROJECTS_KEY) || 0, writesBeforeLineCancel, 'line-delete cancel performs no project storage write')
  check(page._schedule.lines.some((line) => line.id === lineToDelete.id), 'line-delete cancel leaves the line in the live schedule')
  equal(page._reportSignature, lineDeleteCacheSignature, 'line-delete cancel preserves the populated export cache')
  check(page.data.reportImages.length > 0, 'line-delete cancel keeps cached report images')
  page.deleteWorkspaceRecord(deleteEvent(page, 'line', lineToDelete.id))
  completeModal(runtime, true)
  check(!currentProjectRecord(storage, 'project-A').wiringSchedule.lines.some((line) => line.id === lineToDelete.id),
    'line-delete confirm persists removal through actual records module')
  equal(page._reportSignature, '', 'line-delete confirm invalidates the export signature')
  clock.advanceBy(240)
  deepEqual(page.data.reportImages, [], 'line-delete confirm clears cached report images')
  const lineDeleteRebuildCount = canvas.exports
  page.generateExport('project')
  check(canvas.exports > lineDeleteRebuildCount, 'project export rebuilds after line deletion')
  closeReportPreview(page, clock)

  const pendingAline = page._schedule.lines.find((line) => line.fromPort === 'OUT-2')
  check(Boolean(pendingAline), 'synthetic project A retains an OUT-2 line for switch isolation')
  page.onSearchInput(actionEvent({}, 'OUT-2'))
  check(Boolean(page._searchTimer), 'real search starts a pending callback before project switch')
  const switchPatchStart = patches.length
  page.openProjectPicker()
  const projectBIndex = page.data.projectPickerProjects.findIndex((project) => project.id === 'project-B')
  check(projectBIndex >= 0, 'real project picker reads project B from synthetic storage')
  page.onProjectWheelChange({ detail: { value: [projectBIndex] } })
  page.confirmProjectPicker()
  equal(page.projectId, 'project-B', 'explicit picker confirmation switches to project B')
  equal(page.data.project.id, 'project-B', 'project B is loaded from the real records module')
  equal(page.data.lineCount, 1, 'project B exposes its own synthetic schedule')
  equal(page._reportSignature, '', 'switching projects invalidates project A export cache')
  clock.advanceBy(500)
  equal(page._searchTimer, null, 'project switch cancels the pending A search timer')
  equal(page.data.searchText, '', 'project switch clears the previous project search text')
  deepEqual(visibleIds(page), page._schedule.lines.map((line) => line.id), 'late A query does not replace project B visible lines')
  deepEqual(page.data.reportImages, [], 'project switch clears cached A report images')
  const switchVisibleCommits = patches.slice(switchPatchStart).filter((patch) => patch.keys.includes('visibleLines'))
    .map((patch) => ids(patch.changes.visibleLines || []))
  deepEqual(switchVisibleCommits[switchVisibleCommits.length - 1], page._schedule.lines.map((line) => line.id),
    'last visibleLines patch after switch belongs to project B')
  check(!switchVisibleCommits.some((commit) => commit.includes(pendingAline.id)), 'project A search result is never committed into project B')

  page.generateExport('project')
  const projectBCacheSignature = page._reportSignature
  check(Boolean(projectBCacheSignature && page.data.reportImages.length), 'return switch starts with a populated project B export cache')
  closeReportPreview(page, clock)
  page.openProjectPicker()
  const projectAIndex = page.data.projectPickerProjects.findIndex((project) => project.id === 'project-A')
  check(projectAIndex >= 0, 'project A remains selectable after switching')
  page.onProjectWheelChange({ detail: { value: [projectAIndex] } })
  page.confirmProjectPicker()
  equal(page.projectId, 'project-A', 'explicit picker confirmation returns to project A')
  equal(page.data.lineCount, 3, 'return to project A loads the line retained after deletion')
  equal(page._reportSignature, '', 'return switch invalidates project B export cache')
  clock.advanceBy(500)
  deepEqual(page.data.reportImages, [], 'return switch clears cached project B report images')

  const consoleToDelete = currentDevice(page, 'Renamed Console A')
  page.generateExport('project')
  const deviceDeleteCacheSignature = page._reportSignature
  check(Boolean(deviceDeleteCacheSignature && page.data.reportImages.length), 'device deletion starts with a populated export cache')
  closeReportPreview(page, clock)
  equal(page._reportSignature, deviceDeleteCacheSignature, 'closing preview keeps the device-delete cache')
  const writesBeforeDeviceCancel = writeCounts.get(PROJECTS_KEY) || 0
  page.deleteWorkspaceRecord(deleteEvent(page, 'device', consoleToDelete.id, consoleToDelete.key))
  completeModal(runtime, false)
  equal(writeCounts.get(PROJECTS_KEY) || 0, writesBeforeDeviceCancel, 'device-delete cancel performs no project storage write')
  check(currentProjectRecord(storage, 'project-A').wiringSchedule.devices.some((device) => device.id === consoleToDelete.id),
    'device-delete cancel leaves the device in storage')
  equal(page._reportSignature, deviceDeleteCacheSignature, 'device-delete cancel preserves the populated export cache')
  check(page.data.reportImages.length > 0, 'device-delete cancel keeps cached report images')
  page.deleteWorkspaceRecord(deleteEvent(page, 'device', consoleToDelete.id, consoleToDelete.key))
  completeModal(runtime, true)
  const afterDeviceDelete = currentProjectRecord(storage, 'project-A').wiringSchedule
  check(!afterDeviceDelete.devices.some((device) => device.id === consoleToDelete.id), 'device-delete confirm persists device removal')
  equal(afterDeviceDelete.lines.length, 0, 'device-delete confirm also removes its remaining linked lines')
  equal(page._reportSignature, '', 'device-delete confirm invalidates the export signature')
  clock.advanceBy(240)
  deepEqual(page.data.reportImages, [], 'device-delete confirm clears cached report images')
  clock.advanceBy(260)

  const persistedA = currentProjectRecord(storage, 'project-A')
  const addedReturnDevice = wiring.applyScheduleChange(persistedA.wiringSchedule, {
    type: 'add-devices', devices: [{ type: 'mixer', name: 'Return Console', autoName: false }],
  })
  check(addedReturnDevice.ok, 'synthetic external project mutation adds a return-test device')
  const returnConsole = addedReturnDevice.schedule.devices.find((device) => device.name === 'Return Console')
  const returnSpeaker = addedReturnDevice.schedule.devices.find((device) => device.type === 'speaker')
  check(Boolean(returnConsole && returnSpeaker), 'return-test schedule has both endpoint devices')
  const persistedReturnLine = wiring.applyScheduleChange(addedReturnDevice.schedule, {
    type: 'upsert',
    line: {
      purpose: 'Return after onShow', fromDevice: returnConsole.name, fromDeviceId: returnConsole.id,
      fromPort: 'OUT-RETURN', toDevice: returnSpeaker.name, toDeviceId: returnSpeaker.id, toPort: 'IN-RETURN',
      buildType: 'bulk', cableType: 'balanced', spec: '2-core shielded', connectorA: 'xlrFemale',
      connectorB: 'xlrMale', lengthText: '4', status: 'pending', notes: '',
    },
  })
  check(persistedReturnLine.ok, 'synthetic external project mutation produces a valid persisted return line')
  storage.set(PROJECTS_KEY, storage.get(PROJECTS_KEY).map((project) => project.id === 'project-A'
    ? { ...project, wiringSchedule: persistedReturnLine.schedule }
    : project))
  equal(page.data.lineCount, 0, 'external synthetic storage change leaves current in-memory page stale before onShow')
  page.onHide()
  page.onShow()
  equal(page.projectId, 'project-A', 'same-project onShow preserves the active project')
  equal(page.data.lineCount, 1, 'same-project onShow reloads a newly persisted non-empty schedule')
  equal(page._schedule.lines[0].purpose, 'Return after onShow', 'same-project onShow loads the changed line content')
  deepEqual(visibleIds(page), [persistedReturnLine.schedule.lines[0].id], 'same-project onShow exposes the new line in visibleLines')

  page.openProjectPicker()
  const backToBIndex = page.data.projectPickerProjects.findIndex((project) => project.id === 'project-B')
  page.onProjectWheelChange({ detail: { value: [backToBIndex] } })
  page.confirmProjectPicker()
  clock.advanceBy(500)
  page.onSearchInput(actionEvent({}, 'NO-MATCH-UNLOAD'))
  deepEqual(workspaceLineIds(page), [], 'unload scenario uses a query that cannot match the current project')
  const visibleBeforeUnload = visibleIds(page)
  const unloadPatchStart = patches.length
  check(Boolean(page._searchTimer), 'unload scenario has a pending delayed search callback')
  page.onUnload()
  clock.advanceBy(180)
  deepEqual(visibleIds(page), visibleBeforeUnload, 'unload prevents the pending unmatched search from changing visibleLines')
  check(!patches.slice(unloadPatchStart).some((patch) => patch.keys.includes('visibleLines')),
    'unload produces no late visibleLines setData patch')
  equal(page._searchTimer, null, 'unload clears the pending search timer')

  // There is no current UI undo action/API. This remains a documented coverage gap,
  // not a fake restoration action or an asserted feature.
  gaps.push({ id: 'undo-after-delete', status: 'not-covered', note: 'Current project-wiring UI/API has no user-facing undo action.' })

  console.log(JSON.stringify({
    test: 'project-wiring-d1-behavior-regression',
    mode: 'Node synthetic wx storage/timer/canvas; actual composed Page and real records/model modules',
    passedAssertions: checks.length,
    checks,
    diagnosticGaps: gaps,
    limits: [
      'setData applies patches and runs callbacks synchronously; callback order is tested, native render/paint latency is not.',
      'Canvas exports use synchronous synthetic callbacks; this does not test native encoder latency or device memory.',
      'The hide-pending-search observation is diagnostic only; no desired hide cancellation contract is asserted.',
      'No WeChat DevTools or physical device storage/render session is used.',
    ],
  }, null, 2))
} finally {
  if (runtime && runtime.page && !runtime.page._destroyed) runtime.page.onUnload()
  global.setTimeout = originalSetTimeout
  global.clearTimeout = originalClearTimeout
  console.info = originalConsoleInfo
  if (originalPage === undefined) delete global.Page
  else global.Page = originalPage
  if (originalWx === undefined) delete global.wx
  else global.wx = originalWx
  for (const [key, cached] of cachedModules) {
    delete require.cache[key]
    if (cached) require.cache[key] = cached
  }
}

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const storageKeys = {
  schema: 'audioTool.storageSchemaVersion',
  projects: 'audioTool.projects.v1',
  records: 'audioTool.records.v1',
  favorites: 'audioTool.favorites.v1',
  recovery: 'audioTool.recovery.v1',
  active: 'audioTool.activeProject.v1',
}
const recordsPath = require.resolve('../utils/records')
const lightingPath = require.resolve('../pages/dmx-layout/lighting-workspace')
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

function loadProjectPage(records, lightingWorkspace) {
  const filename = path.join(root, 'pages/records/project.js')
  const pageModule = new Module(filename, module)
  pageModule.filename = filename
  pageModule.paths = Module._nodeModulePaths(path.dirname(filename))
  const previousPage = global.Page
  const originalLoad = Module._load
  let definition
  const mocks = {
    '../../utils/performance': {
      printPerformanceSummary() {},
      startMeasurement: () => () => null,
    },
    '../../utils/haptics': { vibrate() {} },
    '../../utils/records': records,
    '../../utils/result-record-context': { openProjectDraft() {}, openRecordEditor() { return true } },
    '../dmx-layout/lighting-workspace': lightingWorkspace,
  }
  global.Page = (page) => { definition = page }
  Module._load = function loadMockedPageDependency(request, parent, isMain) {
    if (parent && parent.filename === filename && Object.hasOwn(mocks, request)) return mocks[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    pageModule._compile(fs.readFileSync(filename, 'utf8'), filename)
  } finally {
    Module._load = originalLoad
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
  assert(definition, 'project detail page registers a controller')
  return definition
}

function makeLine() {
  return {
    purpose: '主扩', fromDevice: '调音台', fromPort: 'L', toDevice: '功放', toPort: 'CH1',
    buildType: 'finished', cableType: 'balanced', spec: '双芯屏蔽', connectorA: 'xlrFemale',
    connectorB: 'xlrMale', lengthText: '8', status: 'checked', notes: '删除恢复保留此线路快照',
  }
}

function makeRecordPayload() {
  return {
    module: 'cable',
    title: '删除回归项目记录',
    summary: '项目删除后仍保留原记录',
    resultText: '项目删除回归测试保存的完整结果',
    preferences: {
      mode: 'professional',
      environment: 'indoor',
      professionalPowerText: '200',
      professionalDistanceText: '25',
    },
  }
}

function makeLightingScheme(lightingWorkspace) {
  const { createGroup, buildPreferences } = require('../pages/dmx-address/group-input')
  const group = createGroup(1, {
    fixtureSource: 'library', fixtureModel: 'TL-SE3401', libraryChannelCount: 16,
    channelCount: '16', fixtureCount: '2', targetUniverse: 'A',
  })
  const scheme = lightingWorkspace.createLightingScheme(buildPreferences({
    groups: [group], startAddressText: '1', allocationMode: 'manual',
  }))
  assert(scheme, 'valid fixture scheme is created')
  scheme.groupIds = ['delete-test-group']
  scheme.fixtureIdsByGroup = { 'delete-test-group': ['delete-fixture-a', 'delete-fixture-b'] }
  const calculated = lightingWorkspace.calculateScheme(scheme)
  assert(calculated.ok && calculated.valid, 'fixture scheme passes the real lighting calculator')
  calculated.result.fixtures.forEach((fixture) => {
    calculated.scheme.checksById[fixture.stableId] = {
      fingerprint: JSON.stringify([
        String(fixture.fixtureModel || ''), Number(fixture.channelCount) || 0,
        String(fixture.universeLabel || ''), Number(fixture.startAddress) || 0,
        Number(fixture.endAddress) || 0,
      ]),
    }
  })
  calculated.scheme.layout = {
    stageWidthText: '12',
    stageDepthText: '8',
    apronDirection: 'bottom',
    internalRods: [{ id: 'delete-test-rod', distance: 1, note: '保留灯杆原始数据' }],
    frontRods: [{ id: 'delete-test-front', distance: 1 }],
    positionsById: {
      'delete-fixture-a': { rodId: 'delete-test-rod', t: 0.25 },
      'delete-fixture-b': { rodId: 'delete-test-front', t: 0.75 },
    },
    customLayoutField: 'keep-layout-snapshot',
  }
  calculated.scheme.legacySideLayout = { source: 'keep-legacy-lighting-snapshot' }
  return calculated.scheme
}

function createWorld() {
  const previousWx = global.wx
  const previousRecords = require.cache[recordsPath]
  const previousLighting = require.cache[lightingPath]
  const storage = new Map([
    [storageKeys.schema, 4],
    [storageKeys.projects, []],
    [storageKeys.records, []],
    [storageKeys.favorites, []],
    [storageKeys.recovery, []],
  ])
  const writeAttempts = []
  const actionSheets = []
  const modalRequests = []
  const toasts = []
  const navigatedBack = []
  let modalMode = 'defer'
  global.wx = {
    getStorageSync(key) { return clone(storage.get(key)) },
    setStorageSync(key, value) { writeAttempts.push(key); storage.set(key, clone(value)) },
    removeStorageSync(key) { writeAttempts.push(key); storage.delete(key) },
    getStorageInfoSync() { return { currentSize: 1, limitSize: 1024 } },
    setNavigationBarTitle() {},
    showActionSheet(options) { actionSheets.push(options) },
    showModal(options) {
      const confirmLength = Array.from(String(options.confirmText || '')).length
      const cancelLength = Array.from(String(options.cancelText || '取消')).length
      if (confirmLength > 4 || cancelLength > 4) {
        throw new Error('原生确认按钮文案不得超过4字')
      }
      modalRequests.push(options)
      if (modalMode === 'throw') throw new Error('simulated synchronous native modal failure')
      if (modalMode === 'fail') {
        options.fail?.({ errMsg: 'fail native modal' })
        return
      }
    },
    showToast(options) { toasts.push(options) },
    navigateBack(options) { navigatedBack.push(options) },
    vibrateShort() {},
  }

  try {
    delete require.cache[recordsPath]
    delete require.cache[lightingPath]
    const records = require('../utils/records')
    const lightingWorkspace = require('../pages/dmx-layout/lighting-workspace')
    const project = records.createProject('删除回归项目')
    assert(project, 'real records module creates project')
    const otherProject = records.createProject('保留的其他项目')
    assert(otherProject, 'real records module creates a second project')
    const wiring = records.saveProjectWiring(project.id, { type: 'upsert', line: makeLine() }, 0)
    assert.equal(wiring.ok, true, wiring.error)
    const payload = makeRecordPayload()
    const record = records.addRecordToProject(payload, project.id)
    assert(record, 'real records module stores a project-linked record')
    const favorite = records.saveFavoriteSnapshot(payload, { saveAs: true })
    assert(favorite, 'real records module stores an independent favorite snapshot')

    const initialLighting = lightingWorkspace.readLightingWorkspace(project.id)
    assert.equal(initialLighting.ok, true, initialLighting.error)
    const savedLighting = lightingWorkspace.saveLightingScheme(
      project.id, makeLightingScheme(lightingWorkspace), initialLighting.revision,
    )
    assert.equal(savedLighting.ok, true, savedLighting.error)
    const originalLighting = lightingWorkspace.readLightingWorkspace(project.id)
    assert.equal(originalLighting.ok, true, originalLighting.error)

    const page = Object.create(loadProjectPage(records, lightingWorkspace))
    page.data = clone(page.data)
    page.setData = (patch, callback) => { Object.assign(page.data, patch); callback?.() }
    page.onLoad({ id: project.id })
    page.onShow()
    assert.equal(page.data.project.id, project.id, 'delete regression enters through real project page onLoad')
    assert.equal(page.data.wiringLines.length, 1, 'project page loads the stored line')
    assert.equal(page.data.lightingFixtures.length, 2, 'project page loads both stored fixtures')
    writeAttempts.length = 0

    const world = {
      storage,
      records,
      lightingWorkspace,
      project,
      otherProject,
      record,
      favorite,
      payload,
      page,
      writeAttempts,
      actionSheets,
      modalRequests,
      toasts,
      navigatedBack,
      get modalMode() { return modalMode },
      set modalMode(value) { modalMode = value },
      snapshot() { return clone(Object.fromEntries(storage)) },
      close() {
        if (previousWx === undefined) delete global.wx
        else global.wx = previousWx
        delete require.cache[recordsPath]
        delete require.cache[lightingPath]
        if (previousRecords) require.cache[recordsPath] = previousRecords
        if (previousLighting) require.cache[lightingPath] = previousLighting
      },
    }
    return world
  } catch (error) {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
    delete require.cache[recordsPath]
    delete require.cache[lightingPath]
    if (previousRecords) require.cache[recordsPath] = previousRecords
    if (previousLighting) require.cache[lightingPath] = previousLighting
    throw error
  }
}

function selectDeleteFromNativeMenu(world) {
  world.page.openManagementMenu()
  const menu = world.actionSheets.at(-1)
  assert.deepEqual(menu.itemList, ['重命名', '编辑项目资料', '删除项目'], 'management menu retains its existing actions')
  menu.success({ tapIndex: 2 })
  return world.modalRequests.at(-1) || null
}

function assertNoStorageWrites(world, before, message) {
  assert.equal(world.writeAttempts.length, 0, `${message}: no storage write calls`)
  assert.deepEqual(world.snapshot(), before, `${message}: storage contents stay byte-for-byte equivalent`)
}

function testSuccessfulProjectMove() {
  const world = createWorld()
  try {
    const beforeWiring = clone(world.records.getProjectWiring(world.project.id).schedule)
    const beforeLighting = clone(world.lightingWorkspace.readLightingWorkspace(world.project.id))
    const beforeLightingEnvelope = clone(world.storage.get(world.lightingWorkspace.WORKSPACE_KEY))
    const beforeRecord = clone(world.records.getRecordById(world.record.id))
    const beforeFavorite = clone(world.records.getFavorites().find((item) => item.id === world.favorite.id))
    const beforeStorage = world.snapshot()
    const modal = selectDeleteFromNativeMenu(world)
    assert(modal, 'native modal is opened by the management-menu delete action')
    assert.equal(Array.from(modal.confirmText).length <= 4, true, 'native confirm button label obeys four-character limit')
    assert.equal(modal.confirmText, '移入', 'short confirm label keeps the archive action clear')
    assert.match(modal.title, /回收站/)
    assert.match(modal.content, /删除回归项目/)
    assert.match(modal.content, /移入回收站/)
    assert.match(modal.content, /独立收藏不会删除/)
    assertNoStorageWrites(world, beforeStorage, 'opening the native confirmation is inert')

    modal.success({ confirm: true, cancel: false })
    assert(world.writeAttempts.length > 0, 'confirming the real modal reaches records persistence')
    const workspace = world.records.getWorkspaceSnapshot({ forceRefresh: true })
    assert.equal(workspace.ok, true)
    assert(!workspace.projects.some((item) => item.id === world.project.id), 'confirmed project leaves active projects')
    assert(workspace.projects.some((item) => item.id === world.otherProject.id), 'unrelated project remains active')
    const recovery = workspace.recoveryEntries.find((entry) => entry.kind === 'project' && entry.targetId === world.project.id)
    assert(recovery, 'confirmed project is moved into recovery')
    assert.deepEqual(recovery.snapshot.wiringSchedule, beforeWiring, 'recovery keeps the exact project wiring schedule and line')
    assert.equal(recovery.snapshot.wiringSchedule.lines[0].notes, '删除恢复保留此线路快照')
    const afterLighting = world.lightingWorkspace.readLightingWorkspace(world.project.id)
    assert.equal(afterLighting.ok, true)
    assert.deepEqual(afterLighting.scheme, beforeLighting.scheme, 'orphaned lighting scheme remains byte-for-byte intact')
    assert.equal(afterLighting.revision, beforeLighting.revision, 'lighting revision is unchanged')
    assert.deepEqual(world.storage.get(world.lightingWorkspace.WORKSPACE_KEY), beforeLightingEnvelope,
      'project deletion does not rewrite the lighting workspace envelope')
    assert.deepEqual(world.records.getRecordById(world.record.id), beforeRecord, 'project record snapshot remains stored')
    assert.deepEqual(world.records.getFavorites().find((item) => item.id === world.favorite.id), beforeFavorite,
      'independent favorite snapshot remains unchanged')
    assert.deepEqual(world.navigatedBack, [{ delta: 1 }], 'successful move returns to project list')
    assert(world.toasts.some((toast) => toast.title === '已移入回收站'), 'successful move confirms the result')
  } finally {
    world.close()
  }
}

function testCancelDoesNotWrite() {
  const world = createWorld()
  try {
    const before = world.snapshot()
    const modal = selectDeleteFromNativeMenu(world)
    assert(modal)
    modal.success({ confirm: false, cancel: true })
    assertNoStorageWrites(world, before, 'canceled project move')
    assert.equal(world.navigatedBack.length, 0)
  } finally {
    world.close()
  }
}

function testModalFailureCanRetry() {
  const world = createWorld()
  try {
    const before = world.snapshot()
    world.modalMode = 'fail'
    selectDeleteFromNativeMenu(world)
    assertNoStorageWrites(world, before, 'native modal fail callback')
    assert(world.toasts.some((toast) => toast.title === '确认失败，请重试'), 'native modal fail gives a retry toast')
    world.modalMode = 'defer'
    const retry = selectDeleteFromNativeMenu(world)
    assert(retry, 'same page can reopen the confirmation after fail')
    retry.success({ confirm: false, cancel: true })
    assertNoStorageWrites(world, before, 'retry canceled after modal fail')
  } finally {
    world.close()
  }
}

function testSynchronousThrowCanRetry() {
  const world = createWorld()
  try {
    const before = world.snapshot()
    world.modalMode = 'throw'
    assert.doesNotThrow(() => selectDeleteFromNativeMenu(world), 'synchronous native throw is handled by the page')
    assertNoStorageWrites(world, before, 'native modal synchronous throw')
    assert(world.toasts.some((toast) => toast.title === '确认失败，请重试'), 'native throw gives a retry toast')
    world.modalMode = 'defer'
    const retry = selectDeleteFromNativeMenu(world)
    assert(retry, 'same page can reopen the confirmation after synchronous throw')
    retry.success({ confirm: false, cancel: true })
    assertNoStorageWrites(world, before, 'retry canceled after native throw')
  } finally {
    world.close()
  }
}

function testStaleProjectConfirmationDoesNotDelete() {
  const world = createWorld()
  try {
    const before = world.snapshot()
    const modal = selectDeleteFromNativeMenu(world)
    assert(modal)
    world.page.projectId = world.otherProject.id
    world.page.data.project = { ...world.page.data.project, id: world.otherProject.id }
    modal.success({ confirm: true, cancel: false })
    assertNoStorageWrites(world, before, 'late confirmation for a different project ID')
    assert(world.records.getProjects().some((item) => item.id === world.project.id), 'original project is not deleted')
    assert(!world.records.getRecoveryEntries().some((item) => item.targetId === world.project.id),
      'stale confirmation creates no recovery entry')
  } finally {
    world.close()
  }
}

testSuccessfulProjectMove()
testCancelDoesNotWrite()
testModalFailureCanRetry()
testSynchronousThrowCanRetry()
testStaleProjectConfirmationDoesNotDelete()
console.log('project-delete-modal-regression: all checks passed')

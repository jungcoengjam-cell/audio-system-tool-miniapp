'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const beforeRoot = path.join(root, 'tmp/remaining-work-2026-10-24/projects/before/source/pages')
const mode = process.argv[2] || 'after'
const sourceRoot = mode === 'before' ? beforeRoot : path.join(root, 'pages')
const preferenceFixtures = {
  cable: ['audioTool.cable.preferences', {
    mode: 'constant', environment: 'indoor', constantPowerText: '100', constantDistanceText: '100',
    professionalPowerText: '300', professionalDistanceText: '50',
  }],
  spl: ['audioTool.spl.preferences', {
    speakerModel: 'TS-803C', distanceText: '4', speakerCount: 1, summationMode: 'distributed',
  }],
  gain: ['audioTool.gainStructure.preferences', {
    amplifierModel: 'TC-X2200B', stageValue: 1, mode: 'stereo', loadImpedance: null, targetPeakDbfs: -6,
  }],
  limiter: ['audioTool.limiter.preferences', {
    amplifierModel: 'TC-2350B', speakerModel: 'TS-803C', count: 1, wiring: 'parallel', mode: 'stereo',
    sensitivityVoltage: 1, highPassFrequency: 80,
  }],
  camera: ['audioTool.camera.preferences', {}],
  led: ['audioTool.ledScreen.preferences', {}],
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }

function createSession(pageName) {
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(`${root}${path.sep}`) && id !== __filename) delete require.cache[id]
  }
  const storage = new Map([
    ['audioTool.storageSchemaVersion', 4],
    ['audioTool.projects.v1', []],
    ['audioTool.records.v1', []],
    ['audioTool.favorites.v1', []],
    ['audioTool.recovery.v1', []],
    ['audioTool.activeProject.v1', ''],
    [preferenceFixtures[pageName][0], clone(preferenceFixtures[pageName][1])],
  ])
  const modalQueue = []
  const timerQueue = new Map()
  let nextTimerId = 1
  let clockNow = 0
  let definition = null
  let currentPage = null
  const writes = []
  let failedWriteKey = ''
  const wx = {
    getStorageSync: (key) => clone(storage.get(key)),
    setStorageSync(key, value) {
      writes.push({ key, value: clone(value) })
      if (key === failedWriteKey) throw new Error(`injected write failure: ${key}`)
      storage.set(key, clone(value))
    },
    removeStorageSync(key) { storage.delete(key) },
    getStorageInfoSync: () => ({ currentSize: 1, limitSize: 10240 }),
    getSystemInfoSync: () => ({ theme: 'light', windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
    canIUse: () => true,
    showToast() {}, showLoading() {}, hideLoading() {}, vibrateShort() {}, hideKeyboard() {},
    navigateTo() {}, navigateBack() {}, setNavigationBarTitle() {},
    showModal(options) { modalQueue.push(options) },
    createCanvasContext: () => new Proxy({ draw() {}, measureText: () => ({ width: 10 }) }, { get: (target, key) => target[key] || (() => {}) }),
    canvasToTempFilePath(options) { options?.success?.({ tempFilePath: '/tmp/project-save-test.png' }) },
  }
  global.wx = wx
  global.getCurrentPages = () => currentPage ? [currentPage] : []
  global.setTimeout = (callback, delay = 0) => {
    const id = nextTimerId++
    timerQueue.set(id, { callback, at: clockNow + Math.max(0, Number(delay) || 0), delay })
    return id
  }
  global.clearTimeout = (id) => timerQueue.delete(id)
  global.Page = (value) => { definition = value }
  const realPagePath = path.join(root, 'pages', pageName === 'gain' ? 'gain-structure/gain-structure.js'
    : pageName === 'led' ? 'led-screen/led-screen.js' : `${pageName}/${pageName}.js`)
  const sourcePagePath = path.join(sourceRoot, path.relative(path.join(root, 'pages'), realPagePath))
  const pageModule = new Module(realPagePath, module)
  pageModule.filename = realPagePath
  pageModule.paths = Module._nodeModulePaths(path.dirname(realPagePath))
  pageModule.require = Module.createRequire(realPagePath)
  pageModule._compile(fs.readFileSync(sourcePagePath, 'utf8'), realPagePath)
  assert(definition && definition.data, `Page definition did not register: ${pageName}`)
  const page = {
    ...definition,
    data: clone(definition.data),
    _pendingSetDataCallbacks: [],
    _deferSetDataCallbacks: false,
    setData(changes, callback) {
      Object.assign(this.data, clone(changes))
      if (callback) {
        if (this._deferSetDataCallbacks) this._pendingSetDataCallbacks.push(() => callback.call(this))
        else callback.call(this)
      }
    },
    flushSetDataCallbacks() {
      const pending = this._pendingSetDataCallbacks.splice(0)
      pending.forEach((callback) => callback())
      return pending.length
    },
  }
  currentPage = page
  const records = require(path.join(root, 'utils/records.js'))
  const projectA = records.createProject(`${pageName} 项目 A`)
  const projectB = records.createProject(`${pageName} 项目 B`)
  assert(projectA && projectB, `${pageName}: project fixtures should use canonical storage`)
  page.onLoad?.({})
  page.onShow?.()
  return {
    page, records, storage, writes, wx, modalQueue, timerQueue, projectA, projectB,
    advanceTimers(milliseconds) {
      const end = clockNow + milliseconds
      let executed = 0
      while (true) {
        const next = [...timerQueue.entries()].filter(([, timer]) => timer.at <= end)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
        if (!next) break
        timerQueue.delete(next[0])
        clockNow = next[1].at
        next[1].callback()
        if (++executed > 1000) throw new Error(`${pageName}: runaway timer while advancing test clock`)
      }
      clockNow = end
      return executed
    },
    failWrite(key) { failedWriteKey = key }, clearFailure() { failedWriteKey = '' },
    answerModal(index = 0, confirm = true) {
      const options = modalQueue.splice(index, 1)[0]
      assert(options, `${pageName}: expected a pending modal`)
      options.success?.({ confirm, cancel: !confirm })
    },
  }
}

function event(id) { return { currentTarget: { dataset: { id } } } }

function finishProjectClose(pageName, session) {
  if (pageName === 'spl' || pageName === 'camera' || pageName === 'led') session.advanceTimers(400)
  if (pageName === 'gain') {
    assert(session.page._pageContainerLeave, 'gain: native close should wait for page-container afterleave')
    assert.equal(session.page.data.projectSheetVisible, true,
      'gain: project sheet must remain visible until native afterleave')
    assert.equal(session.page.data.pageContainerClosingOverlay, 'project',
      'gain: native project overlay must be marked closing before afterleave')
    assert.equal(session.page.onPageContainerAfterLeave(), true,
      'gain: native project close should finalize on afterleave')
  }
  if (pageName === 'limiter' && session.page._pageContainerLeave) session.page.onPageContainerAfterLeave()
  session.page.flushSetDataCallbacks()
}

function selectProject(pageName, adapter, page, project) {
  const current = pageName === 'cable' || pageName === 'camera' || pageName === 'led'
    ? page.data.projectTarget?.id : page.data.projectTargetId
  if (current === project.id) return true
  if (['spl', 'gain', 'limiter'].includes(pageName) && page.data.projectStep === 'details') {
    page.backToProjectList()
  }
  const selected = adapter.select(page, project)
  return selected !== false
}

function ensureReady(pageName, session) {
  const { page } = session
  if (pageName === 'camera' && !page.data.result) {
    page.openCameraSelector()
    const item = page.data.selectorItems.find((candidate) => candidate.model === 'TS-0650JSM')
      || page.data.selectorItems[0]
    assert(item, 'camera selector should provide a saved camera fixture')
    page.selectCamera({ currentTarget: { dataset: { index: String(item.index) } } })
  }
  if (pageName === 'led' && !page.data.result && typeof page.flushInputCalculation === 'function') {
    page.flushInputCalculation()
  }
  const hasResult = pageName === 'cable' ? Boolean(page.data.result && page.data.canUseResultActions)
    : pageName === 'spl' ? Boolean(page.data.result && page.data.canUseResultActions)
      : pageName === 'gain' ? Boolean(page.data.hasValidResult)
        : pageName === 'limiter' ? Boolean(page.data.hasValidResult)
          : Boolean(page.data.result)
  assert(hasResult, `${pageName}: canonical page onLoad/UI fixture must produce a savable result`)
}

const ui = {
  cable: {
    open: (page) => page.saveToActiveProject(),
    visible: (page) => page.data.projectDialogVisible,
    select: (page, project) => page.selectProjectTarget(event(project.id)),
    name: (page, value) => page.onProjectConfigNameInput({ detail: { value } }),
    note: (page, value) => page.onProjectConfigNoteInput({ detail: { value } }),
    save: (page) => page.saveProjectTarget(),
    step: (page) => page.data.projectDialogStep,
    close: (page) => page.closeProjectDialog(true),
  },
  spl: {
    open: (page) => page.openProjectSheet(),
    visible: (page) => page.data.projectSheetVisible,
    select: (page, project) => page.chooseProject(event(project.id)),
    name: (page, value) => page.onProjectConfigNameInput({ currentTarget: { dataset: {
      projectField: 'projectConfigName', projectRevision: page._projectRevision, projectEpisode: page._projectKeyboardEpisode,
    } }, detail: { value } }),
    note: (page, value) => page.onProjectConfigNoteInput({ currentTarget: { dataset: {
      projectField: 'projectConfigNote', projectRevision: page._projectRevision, projectEpisode: page._projectKeyboardEpisode,
    } }, detail: { value } }),
    save: (page) => page.saveProjectConfiguration(),
    step: (page) => page.data.projectStep,
    close: (page) => page.closeProjectSheet(),
  },
  gain: {
    open: (page) => page.openProjectSheet(),
    visible: (page) => page.data.projectSheetVisible,
    select: (page, project) => page.chooseProject(event(project.id)),
    name: (page, value) => page.onProjectConfigNameInput({ currentTarget: { dataset: {
      projectField: 'projectConfigName', projectRevision: page._projectRevision, projectEpisode: page._projectKeyboardEpisode,
    } }, detail: { value } }),
    note: (page, value) => page.onProjectConfigNoteInput({ currentTarget: { dataset: {
      projectField: 'projectConfigNote', projectRevision: page._projectRevision, projectEpisode: page._projectKeyboardEpisode,
    } }, detail: { value } }),
    save: (page) => page.saveProjectConfiguration(),
    step: (page) => page.data.projectStep,
    close: (page) => page.closeProjectSheet(),
  },
  limiter: {
    open: (page) => page.openProjectSheet(),
    visible: (page) => page.data.projectSheetVisible,
    select: (page, project) => page.chooseProject(event(project.id)),
    name: (page, value) => page.onProjectConfigNameInput({ detail: { value } }),
    note: (page, value) => page.onProjectConfigNoteInput({ detail: { value } }),
    save: (page) => page.saveProjectConfiguration(),
    step: (page) => page.data.projectStep,
    close: (page) => page.closeProjectSheet(),
  },
  camera: {
    open: (page) => page.saveToActiveProject(),
    visible: (page) => page.data.projectDialogVisible,
    select: (page, project) => page.selectCameraProjectTarget(event(project.id)),
    name: (page, value) => page.onCameraProjectConfigNameInput({ detail: { value } }),
    note: (page, value) => page.onCameraProjectConfigNoteInput({ detail: { value } }),
    save: (page) => page.saveCameraProjectTarget(),
    step: (page) => page.data.projectDialogStep,
    close: (page) => page.closeCameraProjectDialog(true),
  },
  led: {
    open: (page) => page.openProjectSheet(),
    visible: (page) => page.data.projectDialogVisible,
    select: (page, project) => page.selectProjectTarget(event(project.id)),
    name: (page, value) => page.onProjectConfigNameInput(eventValue(value)),
    note: (page, value) => page.onProjectConfigNoteInput(eventValue(value)),
    save: (page) => page.saveProjectTarget(),
    step: (page) => page.data.projectDialogStep,
    close: (page) => page.closeProjectDialog(true),
  },
}

function eventValue(value) { return { detail: { value } } }

function saveCurrentPage(pageName) {
  const adapter = ui[pageName]
  const session = createSession(pageName)
  ensureReady(pageName, session)
  const { page, records, projectA, projectB } = session
  const opened = adapter.open(page)
  assert(opened !== false, `${pageName}: visible WXML save action must open its project flow`)
  assert(adapter.visible(page), `${pageName}: project UI must become visible`)
  const firstTargeted = selectProject(pageName, adapter, page, projectA)
  assert(firstTargeted !== false, `${pageName}: project selection should advance to configuration`)
  const initialName = `${pageName} 配置 A`
  const initialNote = `${pageName} 备注 A`
  adapter.name(page, initialName)
  adapter.note(page, initialNote)
  const saved = adapter.save(page)
  if (session.modalQueue.length) session.answerModal(0, true)
  page.flushSetDataCallbacks()
  assert(saved !== false, `${pageName}: valid configuration should save`)
  assert.equal(adapter.step(page), 'success', `${pageName}: save should reach success state`)
  const savedRecord = records.getRecordByPayload(page.getRecordPayload())
  assert(savedRecord, `${pageName}: project record should be stored through canonical API`)
  const firstView = records.getProjectRecordView(savedRecord, projectA.id)
  assert(firstView?.hasProjectMetadata, `${pageName}: project metadata should be persisted`)
  assert.equal(firstView.title, initialName)
  assert.equal(firstView.projectNote, initialNote)

  adapter.close(page)
  finishProjectClose(pageName, session)
  assert.equal(adapter.visible(page), false, `${pageName}: explicit close should cancel the active project sheet`)
  const reopened = adapter.open(page)
  assert(reopened !== false && adapter.visible(page), `${pageName}: visible action should reopen project save`)
  assert(selectProject(pageName, adapter, page, projectA), `${pageName}: reopened target should remain selectable`)
  const editedName = `${pageName} 配置 A 修订`
  const editedNote = `${pageName} 备注 A 修订`
  adapter.name(page, editedName)
  adapter.note(page, editedNote)
  const beforeUpdate = clone(records.getRecords())
  const updateAccepted = adapter.save(page)
  if (session.modalQueue.length) session.answerModal(0, true)
  page.flushSetDataCallbacks()
  assert(updateAccepted !== false, `${pageName}: reopening and editing project metadata should be saveable`)
  const revisedRecord = records.getRecordById(savedRecord.id)
  assert.equal(records.getProjectRecordView(revisedRecord, projectA.id).title, editedName)
  assert.equal(records.getProjectRecordView(revisedRecord, projectA.id).projectNote, editedNote)

  adapter.close(page)
  finishProjectClose(pageName, session)
  assert(adapter.open(page) !== false)
  assert(selectProject(pageName, adapter, page, projectB), `${pageName}: switching to project B should work`)
  adapter.name(page, `${pageName} 配置 B`)
  adapter.note(page, `${pageName} 备注 B`)
  const savedToSecond = adapter.save(page)
  if (session.modalQueue.length) session.answerModal(0, true)
  page.flushSetDataCallbacks()
  assert(savedToSecond !== false, `${pageName}: a second project may own the same result independently`)
  const crossProjectRecord = records.getRecordById(savedRecord.id)
  assert(crossProjectRecord.projectIds.includes(projectA.id) && crossProjectRecord.projectIds.includes(projectB.id),
    `${pageName}: same preferences should preserve both project links`)
  assert.equal(records.getProjectRecordView(crossProjectRecord, projectA.id).title, editedName)
  assert.equal(records.getProjectRecordView(crossProjectRecord, projectB.id).title, `${pageName} 配置 B`)
  assert.equal(records.getProjectRecordView(crossProjectRecord, projectA.id).projectNote, editedNote)

  adapter.close(page)
  finishProjectClose(pageName, session)
  assert(adapter.open(page) !== false)
  const cancelTarget = pageName === 'cable' ? projectB : projectA
  assert(selectProject(pageName, adapter, page, cancelTarget), `${pageName}: cancel target should be selectable`)
  const beforeCancel = clone(records.getRecords())
  adapter.close(page)
  finishProjectClose(pageName, session)
  assert.deepEqual(records.getRecords(), beforeCancel, `${pageName}: cancelling after target selection must not write`)

  // Failure and retry are verified against the canonical store, then a queued native callback is allowed to go stale.
  assert(adapter.open(page) !== false)
  assert(selectProject(pageName, adapter, page, cancelTarget), `${pageName}: failure target should be selectable`)
  adapter.name(page, `${pageName} 故障重试配置`)
  adapter.note(page, `${pageName} 故障重试备注`)
  session.failWrite('audioTool.records.v1')
  const failed = adapter.save(page)
  const failureWasDeferredForConfirmation = session.modalQueue.length > 0
  if (failureWasDeferredForConfirmation) session.answerModal(0, true)
  else if (!['camera', 'led'].includes(pageName)) assert(failed === false || failed === undefined,
    `${pageName}: synchronous injected record storage failure must not report success`)
  const afterFailure = records.getRecords()
  assert.deepEqual(afterFailure, beforeCancel, `${pageName}: failed atomic project save must keep canonical records unchanged`)
  const failureText = page.data.projectError || page.data.projectSaveError || ''
  assert(failureText && adapter.step(page) !== 'success',
    `${pageName}: storage failure must remain visible and must not enter success state`)
  assert.equal(failureWasDeferredForConfirmation, ['spl', 'gain', 'limiter'].includes(pageName),
    `${pageName}: test must exercise the actual metadata-confirmation path when that page has one`)
  session.clearFailure()
  const retryMethod = pageName === 'cable' ? page.retryProjectSave
    : pageName === 'camera' ? page.saveCameraProjectTarget
      : pageName === 'led' ? page.saveProjectTarget
        : page.saveProjectConfiguration
  assert.equal(typeof retryMethod, 'function', `${pageName}: visible flow must expose its retry/save entry`)
  const retried = retryMethod.call(page)
  if (session.modalQueue.length) session.answerModal(0, true)
  page.flushSetDataCallbacks()
  assert.notEqual(retried, false, `${pageName}: retry should be accepted`)
  assert.equal(adapter.step(page), 'success', `${pageName}: retry must eventually reach success`)
  const retryRecord = records.getRecordByPayload(page.getRecordPayload())
  assert(retryRecord, `${pageName}: successful retry must persist through the canonical record API`)
  assert.equal(records.getProjectRecords(cancelTarget.id).length, 1,
    `${pageName}: retry must not create a duplicate project record`)
  const retryView = records.getProjectRecordView(retryRecord, cancelTarget.id)
  assert.equal(retryView.title, `${pageName} 故障重试配置`)
  assert.equal(retryView.projectNote, `${pageName} 故障重试备注`)
  const recordWriteCountAfterRetry = session.writes.filter((item) => item.key === 'audioTool.records.v1').length

  let lateCallbackCoverage
  if (pageName === 'cable') {
    page.closeProjectDialog()
    const timer = [...session.timerQueue.values()].find((item) => item.delay === 320)
    assert(timer, 'cable: animated close must queue its actual delayed close callback')
    assert(page.saveToActiveProject(), 'cable: reopening should advance the close revision')
    const writesBeforeLateTimer = session.writes.filter((item) => item.key === 'audioTool.records.v1').length
    timer.callback()
    assert.equal(page.data.projectDialogVisible, true, 'cable: stale close callback must not hide the reopened dialog')
    assert.equal(session.writes.filter((item) => item.key === 'audioTool.records.v1').length,
      writesBeforeLateTimer, 'cable: stale close callback must not write records')
    page.closeProjectDialog(true)
    lateCallbackCoverage = 'animated-close-reopen-stale-timer'
  } else {
    adapter.close(page)
    finishProjectClose(pageName, session)
    assert(adapter.open(page) !== false, `${pageName}: late-callback scenario should reopen the project flow`)
    assert(selectProject(pageName, adapter, page, cancelTarget), `${pageName}: late-callback target should be selectable`)
    adapter.name(page, `${pageName} 迟到回调配置`)
    adapter.note(page, `${pageName} 迟到回调备注`)
    const recordsBeforeLateCallback = clone(records.getRecords())
    const recordWritesBeforeLateCallback = session.writes.filter((item) => item.key === 'audioTool.records.v1').length

    if (['spl', 'gain', 'limiter'].includes(pageName)) {
      adapter.save(page)
      assert.equal(session.modalQueue.length, 1,
        `${pageName}: changing saved metadata must queue the page's real update-confirmation callback`)
      const pending = session.modalQueue.shift()
      if (pageName === 'limiter') {
        page.onPageContainerBeforeLeave()
        page.onPageContainerAfterLeave()
        page.flushSetDataCallbacks()
      } else {
        adapter.close(page)
        finishProjectClose(pageName, session)
      }
      assert.equal(adapter.visible(page), false, `${pageName}: native close must dismiss the pending confirmation flow`)
      pending.success?.({ confirm: true, cancel: false })
      assert.deepEqual(records.getRecords(), recordsBeforeLateCallback,
        `${pageName}: a confirmation delivered after close must not update metadata`)
      lateCallbackCoverage = 'close-before-native-confirmation'
    } else {
      assert(['camera', 'led'].includes(pageName))
      page._deferSetDataCallbacks = true
      const pendingBeforeSave = page._pendingSetDataCallbacks.length
      const saveAccepted = adapter.save(page)
      assert.notEqual(saveAccepted, false, `${pageName}: delayed setData save callback must be accepted`)
      assert(page._pendingSetDataCallbacks.length > pendingBeforeSave,
        `${pageName}: test must hold the actual save setData callback`)
      adapter.close(page)
      finishProjectClose(pageName, session)
      page.flushSetDataCallbacks()
      page._deferSetDataCallbacks = false
      assert.deepEqual(records.getRecords(), recordsBeforeLateCallback,
        `${pageName}: a delayed save callback delivered after close must not persist`)
      lateCallbackCoverage = 'close-before-delayed-setData-save'
    }

    assert.equal(session.writes.filter((item) => item.key === 'audioTool.records.v1').length,
      recordWritesBeforeLateCallback, `${pageName}: stale callback must not write project records`)
  }
  assert.equal(session.writes.filter((item) => item.key === 'audioTool.records.v1').length,
    recordWriteCountAfterRetry, `${pageName}: late callback exercise must not add record writes`)

  return {
    module: pageName,
    savedRecordId: savedRecord.id,
    projectLinks: crossProjectRecord.projectIds.slice().sort(),
    originalRecordCount: beforeUpdate.length,
    retry: 'persisted-metadata-without-duplicate',
    lateCallback: lateCallbackCoverage,
  }
}

assert.equal(mode === 'before' || mode === 'after', true, 'usage: node tests/project-save-controllers-2026-10-24.cjs before|after')
const results = []
for (const pageName of Object.keys(ui)) results.push(saveCurrentPage(pageName))
assert.deepEqual(results.map((item) => item.module).sort(), ['cable', 'camera', 'gain', 'led', 'limiter', 'spl'])
assert(results.every((item) => item.retry === 'persisted-metadata-without-duplicate' && item.lateCallback),
  'each of the six page families must execute both successful retry and stale-callback assertions')
console.log(JSON.stringify({ mode, scenarios: results }, null, 2))

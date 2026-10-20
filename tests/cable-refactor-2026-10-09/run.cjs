const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.resolve(__dirname, '../..')
const evidenceRoot = process.env.CABLE_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-10-10/tunebuddy-cable-revision-010048'
const baselineCablePath = path.join(evidenceRoot, 'baseline/source/pages/cable/cable.js')
const currentCablePath = path.join(root, 'pages/cable/cable.js')
const storage = new Map()
const storageWrites = []
const toastCalls = []
const clipboardCalls = []
const canvasState = {
  contextCount: 0,
  deferDraw: false,
  deferExport: false,
  exportMode: 'success',
  pendingDraw: [],
  pendingExport: [],
}

const STORAGE = {
  records: 'audioTool.records.v1',
  projects: 'audioTool.projects.v1',
  active: 'audioTool.activeProject.v1',
  schema: 'audioTool.storageSchemaVersion',
}

let readFailureKey = ''
let writeFailureKey = ''
let fileAccessMode = 'success'
const fileAccessCalls = []
const pendingFileAccess = []
let windowHeight = 844

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function makeContext() {
  const contextNumber = canvasState.contextCount++
  const operations = []
  return {
    operations,
    font: '400 16px sans-serif',
    measureText(text) {
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1]) || 16
      return { width: [...String(text)].length * size }
    },
    setFillStyle(value) { operations.push(['fillStyle', value]) },
    setStrokeStyle(value) { operations.push(['strokeStyle', value]) },
    setLineWidth(value) { operations.push(['lineWidth', value]) },
    setTextAlign(value) { operations.push(['textAlign', value]) },
    fillRect(...args) { operations.push(['fillRect', ...args]) },
    fillText(text, ...args) { operations.push(['fillText', String(text), ...args]) },
    beginPath() { operations.push(['beginPath']) },
    moveTo(...args) { operations.push(['moveTo', ...args]) },
    lineTo(...args) { operations.push(['lineTo', ...args]) },
    quadraticCurveTo(...args) { operations.push(['quadraticCurveTo', ...args]) },
    closePath() { operations.push(['closePath']) },
    fill() { operations.push(['fill']) },
    stroke() { operations.push(['stroke']) },
    draw(_reserve, callback) {
      if (canvasState.deferDraw && contextNumber % 2 === 1) canvasState.pendingDraw.push(callback)
      else callback()
    },
  }
}

global.wx = {
  getStorageSync(key) {
    if (key === readFailureKey) throw new Error('mock read failure')
    return clone(storage.get(key))
  },
  setStorageSync(key, value) {
    storageWrites.push(key)
    if (key === writeFailureKey) throw new Error('mock write failure')
    storage.set(key, clone(value))
  },
  removeStorageSync(key) { storage.delete(key) },
  getWindowInfo() { return { windowHeight } },
  showToast(options) { toastCalls.push(options) },
  hideLoading() {},
  showLoading() {},
  vibrateShort() {},
  vibrateLong() {},
  setClipboardData(options) { clipboardCalls.push(options.data) },
  hideKeyboard() {},
  showShareImageMenu() {},
  saveImageToPhotosAlbum() {},
  getFileSystemManager() {
    if (fileAccessMode === 'missing') return null
    return {
      access(options) {
        fileAccessCalls.push(options.path)
        if (fileAccessMode === 'defer') pendingFileAccess.push(options)
        else if (fileAccessMode === 'fail') options.fail?.({ errMsg: 'mock cache missing' })
        else options.success?.()
      },
    }
  },
  createCanvasContext() { return makeContext() },
  canvasToTempFilePath(options) {
    if (canvasState.deferExport) {
      canvasState.pendingExport.push(options)
      return
    }
    if (canvasState.exportMode === 'fail') options.fail?.({ errMsg: 'mock export failure' })
    else options.success?.({ tempFilePath: `mock://report-${canvasState.pendingExport.length + storageWrites.length}` })
  },
}

function loadPage(sourcePath, localSource = fs.readFileSync(sourcePath, 'utf8')) {
  let definition
  const previousPage = global.Page
  global.Page = (value) => { definition = value }
  const pageModule = new Module(sourcePath, module)
  pageModule.filename = sourcePath
  pageModule.paths = Module._nodeModulePaths(currentCablePath && path.dirname(currentCablePath))
  pageModule.require = Module.createRequire(currentCablePath)
  pageModule._compile(localSource, sourcePath)
  global.Page = previousPage
  assert(definition, `Page definition was not registered from ${sourcePath}`)
  return definition
}

const baselineConfig = loadPage(baselineCablePath)
const currentConfig = loadPage(currentCablePath)
const records = require(path.join(root, 'utils/records.js'))
const cableMath = require(path.join(root, 'utils/cable.js'))
const report = require(path.join(root, 'pages/cable/cable-report.js'))
const { getExportDimensions } = require(path.join(root, 'utils/report-drawing.js'))

function makePage(config = currentConfig) {
  const page = {
    ...config,
    data: clone(config.data),
    setData(changes, callback) {
      this.data = { ...this.data, ...clone(changes) }
      if (callback) callback.call(this)
    },
  }
  return page
}

function readyPage(config = currentConfig, values = {}) {
  const page = makePage(config)
  page._pageVisible = false
  page.data = {
    ...page.data,
    ...values,
  }
  page.commitCalculatedState()
  return page
}

function projectFixture(id, name, updatedAt = 100) {
  return {
    id,
    name,
    createdAt: updatedAt,
    updatedAt,
    venueName: '',
    engineer: '',
    projectDate: '2026-10-09',
    notes: '',
    roomLengthText: '',
    roomWidthText: '',
    roomHeightText: '',
    standardClassKey: 'conference',
    gradeKey: 'II',
  }
}

function resetWorkspace(projectNames = [], activeName = '') {
  storage.clear()
  storageWrites.length = 0
  readFailureKey = ''
  writeFailureKey = ''
  const projects = projectNames.map((name, index) => projectFixture(`p${index + 1}`, name, 100 - index))
  storage.set(STORAGE.records, [])
  storage.set(STORAGE.projects, projects)
  storage.set(STORAGE.active, projects.find((project) => project.name === activeName)?.id || '')
  storage.set(STORAGE.schema, 3)
  records.getWorkspaceSnapshot({ forceRefresh: true })
  return projects
}

function resultParity(config, scenario) {
  const page = makePage(config)
  page._pageVisible = false
  page.data = { ...page.data, ...scenario }
  page.commitCalculatedState()
  return {
    result: page.data.result,
    inputError: page.data.inputError,
    preferences: page.getPreferences(),
    lookup: page.getRecordLookupPayload(),
    resultText: page.getResultText(),
    record: page.getRecordPayload(),
    identity: page.getRecordPayload()
      ? JSON.stringify([page.getRecordPayload().module, page.getRecordPayload().preferences])
      : null,
  }
}

function testBaselineBusinessParity() {
  const scenarios = []
  const constantPowers = [39.99, 40, 40.01, 79.99, 80, 80.01, 166.66, 166.67, 233.33, 233.34,
    300, 433.33, 666.66, 999.99, 1000, 1000.01]
  const distances = [99.99, 100, 100.01, 249.99, 250, 250.01, 499.99, 500, 500.01,
    749.99, 750, 750.01, 999.99, 1000, 1000.01]
  for (const totalPower of constantPowers) {
    for (const distance of [100, 250, 500, 750, 1000]) {
      scenarios.push({
        modeIndex: 0,
        environmentIndex: 0,
        constantPowerText: String(totalPower),
        constantDistanceText: String(distance),
      })
    }
  }
  for (const distance of distances) {
    scenarios.push({ modeIndex: 0, environmentIndex: 0, constantPowerText: '650', constantDistanceText: String(distance) })
    scenarios.push({ modeIndex: 0, environmentIndex: 1, constantPowerText: '650', constantDistanceText: String(distance) })
  }
  for (const power of [33.32, 33.33, 33.34, 199.99, 200, 200.01, 399.99, 400, 400.01,
    533.32, 533.33, 533.34, 999.99, 1000, 1000.01]) {
    for (const distance of [50, 100, 100.01]) {
      scenarios.push({
        modeIndex: 1,
        professionalPowerText: String(power),
        professionalDistanceText: String(distance),
      })
    }
  }
  for (const invalid of ['', '0', '-1', 'abc']) {
    scenarios.push({ modeIndex: 0, constantPowerText: invalid, constantDistanceText: '100' })
    scenarios.push({ modeIndex: 1, professionalPowerText: invalid, professionalDistanceText: '50' })
  }

  for (const scenario of scenarios) {
    assert.deepEqual(resultParity(currentConfig, scenario), resultParity(baselineConfig, scenario),
      `current cable business output diverged from this-turn baseline for ${JSON.stringify(scenario)}`)
  }

  const page = readyPage()
  assert.deepEqual(Object.keys(page.getPreferences()), [
    'mode', 'environment', 'constantPowerText', 'constantDistanceText',
    'professionalPowerText', 'professionalDistanceText',
  ])
  assert.equal(page.getPreferences().constantPowerText, '100')
  assert.equal(page.getPreferences().professionalPowerText, '300')
  const beforeSwitch = { ...page.getPreferences() }
  page.onModeTap({ currentTarget: { dataset: { index: 1 } } })
  page.data.professionalPowerText = '450'
  page.onModeTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.constantPowerText, beforeSwitch.constantPowerText)
  assert.equal(page.data.constantDistanceText, beforeSwitch.constantDistanceText)
  assert.equal(page.data.professionalPowerText, '450')
  assert.equal(page.data.professionalDistanceText, beforeSwitch.professionalDistanceText)
  console.log(`baseline business parity passed (${scenarios.length} scenarios, six preference fields, mode retention)`)
}

function testDebounceAndActionFlush() {
  clipboardCalls.length = 0
  const page = readyPage()
  const oldSpec = page.data.result.spec
  page.onInput({ currentTarget: { dataset: { field: 'constantPowerText' } }, detail: { value: '500' } })
  assert.equal(page.data.inputPending, true)
  assert.equal(page.data.canUseResultActions, false)
  page.generateResultReportImage()
  assert.equal(page.data.inputPending, false)
  assert.notEqual(page.data.result.spec, oldSpec)
  assert(page.data.resultReportImagePath)
  assert.equal(clipboardCalls.length, 0, 'the cable page must not expose a copy action')

  page.onInput({ currentTarget: { dataset: { field: 'constantPowerText' } }, detail: { value: '' } })
  page.generateResultReportImage()
  assert.equal(page.data.result, null)
  assert.equal(page.data.calculationState, 'error')
  assert.equal(page.data.resultReportImagePath, '')
  assert.equal(clipboardCalls.length, 0)
  console.log('input debounce flush, share freshness, invalid-action blocking, and no-copy contract passed')
}

function testResetAndPreferencePersistence() {
  const [active, target] = resetWorkspace(['Active', 'Target'], 'Active')
  let page = readyPage()
  records.saveRecord(page.getRecordPayload(), { favorite: true, projectId: target.id })
  const beforeRecords = clone(storage.get(STORAGE.records))
  const beforeActive = storage.get(STORAGE.active)
  assert.equal(page.data.canReset, false, 'clean defaults need no reset action')

  page.onInput({ currentTarget: { dataset: { field: 'constantPowerText' } }, detail: { value: '100' } })
  assert.equal(page.data.canReset, true)
  assert.equal(page.resetInputs(), true)
  assert.equal(page.data.modeIndex, 0)
  assert.equal(page.data.environmentIndex, 0)
  assert.equal(page.getPreferences().constantPowerText, '100')
  assert.equal(page.getPreferences().constantDistanceText, '100')
  assert.equal(page.getPreferences().professionalPowerText, '300')
  assert.equal(page.getPreferences().professionalDistanceText, '50')
  assert.deepEqual(storage.get('audioTool.cable.preferences'), page.getPreferences())
  assert.deepEqual(storage.get(STORAGE.records), beforeRecords, 'reset must retain favorites and saved project records')
  assert.equal(storage.get(STORAGE.active), beforeActive, 'reset must retain the active project')

  page.data.inputError = 'temporarily invalid draft'
  page.data.canReset = true
  assert.equal(page.resetInputs(), true, 'resetting an already-default record exercises successful no-op persistence')
  assert.equal(page.data.preferenceSaveError, '', 'writePreferencesDetailed ok+unchanged is success')
  assert.deepEqual(storage.get(STORAGE.records), beforeRecords)
  assert.equal(records.getWorkspaceSnapshot({ forceRefresh: true }).activeProject.id, active.id)

  page.commitCalculatedState({ modeIndex: 1, professionalPowerText: '450' })
  const preferencesBeforeFailedReset = page.getPreferences()
  writeFailureKey = 'audioTool.cable.preferences'
  assert.equal(page.resetInputs(), false)
  assert.equal(page.data.preferenceSaveError.length > 0, true, 'storage failures must be visible')
  assert.equal(page.data.canReset, true, 'failed reset remains actionable')
  assert.equal(page.data.preferenceSaveErrorAction, 'reset')
  assert.equal(page.data.modeIndex, 1, 'failed reset must leave visible inputs unchanged')
  assert.equal(page.data.professionalPowerText, '450')
  assert.deepEqual(page.getPreferences(), preferencesBeforeFailedReset)
  assert.deepEqual(storage.get('audioTool.cable.preferences'), preferencesBeforeFailedReset,
    'failed reset must retain the prior persisted preferences')
  writeFailureKey = ''
  assert.equal(page.retryPreferenceWrite(), true)
  assert.equal(page.data.preferenceSaveError, '')
  assert.equal(page.data.modeIndex, 0, 'retrying a failed reset must finish the reset')
  assert.equal(page.data.environmentIndex, 0)
  assert.deepEqual(page.getPreferences(), {
    mode: 'constant', environment: 'indoor', constantPowerText: '100', constantDistanceText: '100',
    professionalPowerText: '300', professionalDistanceText: '50',
  })
  assert.deepEqual(storage.get('audioTool.cable.preferences'), page.getPreferences())

  resetWorkspace(['Active', 'Target'], 'Active')
  canvasState.deferExport = true
  canvasState.pendingExport.length = 0
  page = readyPage()
  page.generateResultReportImage()
  const lateExport = canvasState.pendingExport.pop()
  assert(lateExport)
  page.openProjectSheet()
  const dialogRevision = page._projectDialogRevision
  page.beginProjectInputFocus({ currentTarget: { dataset: {
    dialogRevision, step: 'select', field: 'projectSearchText',
  } } })
  const keyboardEvent = { currentTarget: { dataset: {
    dialogRevision, focusEpisode: page.data.projectFocusEpisode, step: 'select',
  } }, detail: { height: 280 } }
  page.onInput({ currentTarget: { dataset: { field: 'constantPowerText' } }, detail: { value: '100' } })
  assert.equal(page.resetInputs(), true)
  lateExport.success?.({ tempFilePath: 'mock://stale-after-reset' })
  page.onProjectKeyboardHeightChange(keyboardEvent)
  assert.equal(page.data.projectDialogVisible, false)
  assert.equal(page.data.projectKeyboardOpen, false)
  assert.equal(page.data.resultReportImagePath, '')
  assert.equal(page.data.resultReportPreviewVisible, false)
  canvasState.deferExport = false
  canvasState.exportMode = 'success'
  console.log('reset defaults, no-op persistence, storage retry, record/favorite/active retention, and stale callback fences passed')
}

function testPendingInputCannotReplaceFailedResetIntent() {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  for (const flushMode of ['debounce', 'blur']) {
    const [active, target] = resetWorkspace(['Active', 'Target'], 'Active')
    const page = readyPage()
    page.commitCalculatedState({ constantPowerText: '150' })
    const deferredSetDataCallbacks = []
    const applySetData = page.setData
    page.setData = function (changes, callback) {
      applySetData.call(this, changes)
      if (callback) deferredSetDataCallbacks.push(() => callback.call(this))
    }
    records.saveRecord(page.getRecordPayload(), { favorite: true, projectId: target.id })
    const recordsBefore = clone(storage.get(STORAGE.records))
    const activeBefore = storage.get(STORAGE.active)
    const persistedBefore = clone(storage.get('audioTool.cable.preferences'))
    const scheduled = []
    global.setTimeout = (callback) => {
      scheduled.push(callback)
      return { pendingInputTimer: true }
    }
    global.clearTimeout = () => {}
    try {
      page.onInput({ currentTarget: { dataset: { field: 'constantPowerText' } }, detail: { value: '200' } })
      assert.equal(scheduled.length, 1)
      assert.equal(page.data.inputPending, true)
      writeFailureKey = 'audioTool.cable.preferences'
      assert.equal(page.resetInputs(), false)
      assert.equal(page.data.constantPowerText, '200')
      assert.equal(page.data.preferenceSaveErrorAction, 'reset')
      assert.deepEqual(storage.get('audioTool.cable.preferences'), persistedBefore)

      assert.equal(page.resetInputs(), false, 'a repeated failed reset must retain reset retry intent')
      assert.equal(page.data.preferenceSaveErrorAction, 'reset')
      const preferenceWritesBeforeFlush = storageWrites.filter((key) => key === 'audioTool.cable.preferences').length
      if (flushMode === 'debounce') scheduled[0]()
      else page.onInputBlur()

      assert.equal(page.data.inputPending, false)
      assert.equal(page.data.constantPowerText, '200', 'flushing the draft must preserve the current visible input')
      assert.equal(page.data.preferenceSaveErrorAction, 'reset', 'an old flush must not replace reset retry intent')
      assert(page.data.preferenceSaveError.length > 0)
      assert.deepEqual(storage.get('audioTool.cable.preferences'), persistedBefore,
        'pending input flush must not persist over a failed reset')
      assert.equal(storageWrites.filter((key) => key === 'audioTool.cable.preferences').length,
        preferenceWritesBeforeFlush, 'pending input flush must not attempt a competing preference write')
      assert.equal(deferredSetDataCallbacks.length, 1, 'flush must leave one deferred setData preference callback')
      assert.deepEqual(storage.get(STORAGE.records), recordsBefore)
      assert.equal(storage.get(STORAGE.active), activeBefore)
      assert.equal(records.getWorkspaceSnapshot({ forceRefresh: true }).activeProject.id, active.id)

      writeFailureKey = ''
      deferredSetDataCallbacks.shift()()
      assert.equal(page.data.preferenceSaveErrorAction, 'reset',
        'a delayed setData callback must not replace a failed-reset retry with a normal write')
      assert.deepEqual(storage.get('audioTool.cable.preferences'), persistedBefore,
        'a delayed setData callback must not persist the pre-reset calculation after storage recovers')
      assert.equal(storageWrites.filter((key) => key === 'audioTool.cable.preferences').length,
        preferenceWritesBeforeFlush, 'a delayed setData callback must not write over pending reset intent')
      assert.equal(page.retryPreferenceWrite(), true)
      assert.equal(page.data.preferenceSaveError, '')
      assert.equal(page.data.preferenceSaveErrorAction, '')
      assert.equal(page.data.constantPowerText, '100')
      assert.deepEqual(storage.get('audioTool.cable.preferences'), {
        mode: 'constant', environment: 'indoor', constantPowerText: '100', constantDistanceText: '100',
        professionalPowerText: '300', professionalDistanceText: '50',
      })
      assert.deepEqual(storage.get(STORAGE.records), recordsBefore)
      assert.equal(storage.get(STORAGE.active), activeBefore)
    } finally {
      writeFailureKey = ''
      global.setTimeout = originalSetTimeout
      global.clearTimeout = originalClearTimeout
    }
  }
  console.log('pending debounce/blur flush preserves failed-reset intent and retries all six defaults')
}

function testProjectFlows() {
  const [active, target] = resetWorkspace(['Active', 'Target'], 'Active')
  let page = readyPage()
  page.openProjectSheet()
  assert.equal(page.data.projectActiveId, active.id)
  page.selectProjectTarget({ currentTarget: { dataset: { id: target.id } } })
  assert.equal(records.getWorkspaceSnapshot({ forceRefresh: true }).activeProject.id, active.id,
    'selecting an existing project must not change the active project')
  page.closeProjectDialog(true)
  assert.deepEqual(storage.get(STORAGE.records), [], 'canceling project confirmation must not write a record')

  page = readyPage()
  page.openProjectSheet()
  const originalPayload = page.getRecordPayload()
  page.selectProjectTarget({ currentTarget: { dataset: { id: target.id } } })
  assert.equal(page.data.projectConfigName, originalPayload.title,
    'a new project configuration defaults to the canonical result title')
  page.data.projectConfigName = '礼堂主扩'
  page.data.projectConfigNote = '东侧机柜，线槽已预留'
  assert.equal(page.saveProjectTarget(), true)
  assert.equal(page.data.projectDialogStep, 'success')
  const saved = records.getWorkspaceSnapshot({ forceRefresh: true }).records[0]
  assert(saved.projectIds.includes(target.id))
  assert.equal(saved.signature, JSON.stringify(['cable', originalPayload.preferences]))
  assert.equal(page.data.projectTarget.name, 'Target')
  assert.equal(page.data.projectSavedConfigName, '礼堂主扩')
  assert.equal(saved.title, originalPayload.title, 'project metadata must not change the global title')
  assert.equal(saved.resultText, originalPayload.resultText, 'project metadata must not change canonical result text')
  assert.equal(records.getProjectRecordView(saved, target.id).title, '礼堂主扩')
  assert.equal(records.getProjectRecordView(saved, target.id).projectNote, '东侧机柜，线槽已预留')

  assert(records.addRecordToProject(originalPayload, active.id, {
    name: '调音台区', note: '同参但属另一项目',
  }))
  let workspace = records.getWorkspaceSnapshot({ forceRefresh: true })
  assert.equal(workspace.records.length, 1, 'same parameters across projects must reuse one canonical record')
  assert.equal(records.getProjectRecordView(workspace.records[0], active.id).title, '调音台区')
  assert.equal(records.getProjectRecordView(workspace.records[0], target.id).title, '礼堂主扩')
  assert(records.addRecordToProject(originalPayload, target.id, {
    name: '礼堂主扩修订', note: '修改只覆盖目标项目',
  }))
  workspace = records.getWorkspaceSnapshot({ forceRefresh: true })
  assert.equal(records.getProjectRecordView(workspace.records[0], active.id).title, '调音台区')
  assert.equal(records.getProjectRecordView(workspace.records[0], target.id).title, '礼堂主扩修订')
  assert.equal(workspace.records[0].title, originalPayload.title)
  assert(records.removeRecordFromProject(workspace.records[0].id, target.id))
  workspace = records.getWorkspaceSnapshot({ forceRefresh: true })
  assert.equal(workspace.records.length, 1)
  assert.equal(workspace.records[0].projectMetadata[target.id], undefined)
  assert.equal(records.getProjectRecordView(workspace.records[0], active.id).title, '调音台区')

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.selectProjectTarget({ currentTarget: { dataset: { id: 'p2' } } })
  page.data.projectConfigName = 'x'.repeat(61)
  assert.equal(page.saveProjectTarget(), false)
  assert(page.data.projectNameError.length > 0)
  page.data.projectConfigName = 'Valid name'
  page.data.projectConfigNote = 'x'.repeat(201)
  assert.equal(page.saveProjectTarget(), false)
  assert(page.data.projectNoteError.length > 0)
  assert.deepEqual(storage.get(STORAGE.records), [], 'invalid metadata must not write a record')

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  const firstPayload = page.getRecordPayload()
  assert(records.addRecordToProject(firstPayload, 'p2', { name: 'same-name', note: '' }))
  page.commitCalculatedState({ constantPowerText: '110' })
  const secondPayload = page.getRecordPayload()
  assert(records.addRecordToProject(secondPayload, 'p2', { name: 'same-name', note: '' }))
  workspace = records.getWorkspaceSnapshot({ forceRefresh: true })
  assert.equal(workspace.records.length, 2, 'same-name configurations with different parameters remain distinct')
  assert.notEqual(workspace.records[0].id, workspace.records[1].id)

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.selectProjectTarget({ currentTarget: { dataset: { id: 'p2' } } })
  page.data.projectConfigName = 'Delete with project'
  assert(page.saveProjectTarget())
  assert(records.getWorkspaceSnapshot({ forceRefresh: true }).records[0].projectMetadata.p2)
  assert(records.deleteProject('p2'))
  assert.deepEqual(storage.get(STORAGE.records), [], 'deleting the only project must also clear its project metadata')

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.selectProjectTarget({ currentTarget: { dataset: { id: 'p2' } } })
  storage.set(STORAGE.projects, [projectFixture('p1', 'Active'), projectFixture('p2', 'Renamed')])
  const beforeRenameRecords = clone(storage.get(STORAGE.records))
  assert.equal(page.saveProjectTarget(), false)
  assert.equal(page.data.projectDialogStep, 'select')
  assert.deepEqual(storage.get(STORAGE.records), beforeRenameRecords)
  assert(page.data.projectError.length > 0)

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.selectProjectTarget({ currentTarget: { dataset: { id: 'p2' } } })
  storage.set(STORAGE.projects, [projectFixture('p1', 'Active')])
  assert.equal(page.saveProjectTarget(), false)
  assert.equal(page.data.projectDialogStep, 'select')
  assert(page.data.projectError.length > 0)
  assert.deepEqual(storage.get(STORAGE.records), [])

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.selectProjectTarget({ currentTarget: { dataset: { id: 'p2' } } })
  page.data.constantPowerText = '101'
  assert.equal(page.saveProjectTarget(), false)
  assert.equal(page.data.projectSaveBlocked, true)
  assert.deepEqual(storage.get(STORAGE.records), [])
  page.commitCalculatedState({ constantPowerText: '101' })
  assert.equal(page.returnToProjectSelection(), true)
  assert.equal(page.data.projectDialogStep, 'select')
  assert.equal(page.data.projectSaveBlocked, false)
  assert.equal(page._projectFrozenPayload.preferences.constantPowerText, '101',
    'recovering from a stale payload must freeze the current calculated result')
  page.selectProjectTarget({ currentTarget: { dataset: { id: 'p2' } } })
  assert.equal(page.saveProjectTarget(), true, 'reselected current payload must be saveable')
  assert.equal(records.getWorkspaceSnapshot({ forceRefresh: true }).records[0].preferences.constantPowerText, '101')

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.selectProjectTarget({ currentTarget: { dataset: { id: 'p2' } } })
  writeFailureKey = STORAGE.records
  assert.equal(page.saveProjectTarget(), false)
  assert.equal(page.data.projectSaving, false)
  assert(page.data.projectError.length > 0)
  writeFailureKey = ''
  assert.equal(page.retryProjectSave(), true)
  assert.equal(page.data.projectDialogStep, 'success')

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.openProjectCreateForm()
  page.data.projectNameText = 'New Created'
  assert.equal(page.createProjectFromForm(), true)
  const created = records.getWorkspaceSnapshot({ forceRefresh: true }).projects.find((item) => item.name === 'New Created')
  assert(created)
  page.closeProjectDialog(true)
  assert(records.getWorkspaceSnapshot({ forceRefresh: true }).projects.some((item) => item.id === created.id),
    'closing after creation must leave the newly created project')
  assert.deepEqual(storage.get(STORAGE.records), [])

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.openProjectCreateForm()
  page.data.projectNameText = 'Target'
  assert.equal(page.createProjectFromForm(), true)
  assert.equal(page.data.projectTarget.id, 'p2', 'same-name creation must reuse the existing project')
  assert.equal(records.getWorkspaceSnapshot({ forceRefresh: true }).activeProject.id, 'p2',
    'same-name creation retains createProject active-project behavior')

  resetWorkspace([], '')
  page = readyPage()
  readFailureKey = STORAGE.projects
  page.openProjectSheet()
  assert.equal(page.data.projectLoadFailed, true)
  assert(page.data.projectError.length > 0)
  readFailureKey = ''
  page.retryProjectRead()
  assert.equal(page.data.projectLoadFailed, false)
  assert.equal(page.data.projectProjects.length, 0)

  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  const revision = page._projectDialogRevision
  page.beginProjectInputFocus({ currentTarget: { dataset: {
    dialogRevision: revision, step: 'select', field: 'projectSearchText',
  } } })
  const focusEpisode = page.data.projectFocusEpisode
  const keyboardEvent = { currentTarget: { dataset: {
    dialogRevision: revision, focusEpisode, step: 'select', field: 'projectSearchText',
  } }, detail: { height: 330 } }
  page.onProjectKeyboardHeightChange(keyboardEvent)
  assert.equal(page.data.projectKeyboardOpen, true)
  assert.equal(page.data.projectKeyboardBottom, 330)
  assert.equal(page.data.projectViewportHeight, 514)
  page.openProjectCreateForm()
  assert.equal(page.data.projectKeyboardOpen, false)
  page.onProjectKeyboardHeightChange(keyboardEvent)
  assert.equal(page.data.projectKeyboardOpen, false, 'late keyboard callbacks must not reopen a changed step')
  page.closeProjectDialog(true)
  page.onProjectKeyboardHeightChange(keyboardEvent)
  assert.equal(page.data.projectDialogVisible, false)

  windowHeight = 400
  resetWorkspace(['Active', 'Target'], 'Active')
  page = readyPage()
  page.openProjectSheet()
  page.selectProjectTarget({ currentTarget: { dataset: { id: 'p2' } } })
  const confirmRevision = page._projectDialogRevision
  page.beginProjectInputFocus({ timeStamp: 100, currentTarget: { dataset: {
    dialogRevision: confirmRevision, step: 'confirm', field: 'projectConfigName',
  } } })
  const nameEpisode = page.data.projectFocusEpisode
  const nameKeyboardEvent = (height, timeStamp = undefined) => ({
    ...(timeStamp === undefined ? {} : { timeStamp }),
    currentTarget: { dataset: {
      dialogRevision: confirmRevision, focusEpisode: nameEpisode, step: 'confirm', field: 'projectConfigName',
    } }, detail: { height },
  })
  page.onProjectKeyboardHeightChange(nameKeyboardEvent(268, 90))
  assert.equal(page.data.projectKeyboardOpen, false, 'older same-field keyboard timestamps must be ignored')
  page.onProjectKeyboardHeightChange(nameKeyboardEvent(268, 110))
  assert.equal(page.data.projectViewportHeight, 132, 'keyboard height must use the true remaining viewport')
  assert.equal(page.data.projectSheetMaxHeight, 132, 'sheet max-height must track the true 132px keyboard viewport without a floor')
  assert.equal(page.data.projectFocusedInputId, 'projectConfigName')

  page.beginProjectInputFocus({ timeStamp: 120, currentTarget: { dataset: {
    dialogRevision: confirmRevision, step: 'confirm', field: 'projectConfigNote',
  } } })
  const noteEpisode = page.data.projectFocusEpisode
  const noteKeyboardEvent = (height, timeStamp = undefined) => ({
    ...(timeStamp === undefined ? {} : { timeStamp }),
    currentTarget: { dataset: {
      dialogRevision: confirmRevision, focusEpisode: noteEpisode, step: 'confirm', field: 'projectConfigNote',
    } }, detail: { height },
  })
  page.onProjectKeyboardHeightChange(nameKeyboardEvent(0, 130))
  page.onProjectKeyboardHeightChange(noteKeyboardEvent(0, 119))
  assert.equal(page.data.projectKeyboardOpen, true, 'late old-field or older same-field callbacks must not hide the active keyboard')
  assert.equal(page.data.projectFocusedInputId, 'projectConfigNote')
  page.onProjectKeyboardHeightChange(noteKeyboardEvent(268))
  assert.equal(page.data.projectKeyboardOpen, true, 'devices without event timestamps must still accept the current focused field')
  page.closeProjectDialog(true)
  windowHeight = 844
  console.log('project target, stale state, cancel, create, failure retry, and keyboard episode flows passed')
}

function testAnimatedCloseLifecycle() {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const originalShare = wx.showShareImageMenu
  const originalSave = wx.saveImageToPhotosAlbum
  const timers = []
  const shareCalls = []
  const saveCalls = []
  let nextTimerId = 1
  global.setTimeout = (callback, delay) => {
    const timer = { id: nextTimerId++, callback, delay, cancelled: false }
    timers.push(timer)
    return timer
  }
  global.clearTimeout = (timer) => { if (timer) timer.cancelled = true }
  wx.showShareImageMenu = (options) => shareCalls.push(options)
  wx.saveImageToPhotosAlbum = (options) => saveCalls.push(options)
  const fire = (timer) => timer.callback()

  try {
    resetWorkspace(['Active', 'Target'], 'Active')
    const projectPage = readyPage()
    projectPage._pageVisible = true
    assert.equal(projectPage.openProjectSheet(), true)
    const dialogRevision = projectPage.data.projectDialogRevision
    projectPage.beginProjectInputFocus({ currentTarget: { dataset: {
      dialogRevision, step: 'select', field: 'projectSearchText',
    } } })
    const keyboardEvent = { currentTarget: { dataset: {
      dialogRevision, focusEpisode: projectPage.data.projectFocusEpisode, step: 'select', field: 'projectSearchText',
    } }, detail: { height: 280 } }
    projectPage.onProjectKeyboardHeightChange(keyboardEvent)
    assert.equal(projectPage.data.projectKeyboardOpen, true)
    const writesBeforeClose = storageWrites.length
    assert.equal(projectPage.closeProjectDialog({ type: 'tap' }), true, 'WXML event objects must start an animated close')
    assert.equal(projectPage.data.projectDialogVisible, true, 'project sheet stays mounted during exit')
    assert.equal(projectPage.data.projectDialogClosing, true)
    assert.equal(projectPage._projectCloseTimer.delay, 320)
    assert(projectPage.data.projectDialogRevision > dialogRevision, 'close invalidates the keyboard revision immediately')
    assert.equal(projectPage.data.projectKeyboardOpen, true, 'keyboard layout remains stable during the exit')
    assert.equal(projectPage._projectFrozenPayload, null, 'closing releases the frozen save payload immediately')
    assert.equal(projectPage.onProjectKeyboardHeightChange(keyboardEvent), undefined, 'late keyboard callbacks are ignored after close')
    projectPage.data.projectNameText = 'must not write during close'
    projectPage.data.projectDialogStep = 'confirm'
    projectPage.data.projectTarget = { id: 'p2', name: 'Target' }
    projectPage.data.projectConfigName = 'Valid configuration'
    assert.equal(projectPage.createProjectFromForm(), false)
    assert.equal(projectPage.saveProjectTarget(), false)
    assert.equal(storageWrites.length, writesBeforeClose, 'closing project actions cannot write storage')
    const firstProjectTimer = projectPage._projectCloseTimer
    assert.equal(projectPage.closeProjectDialog(), false, 'repeated close does not restart the timer')
    assert.equal(projectPage._projectCloseTimer, firstProjectTimer)
    const invalidProjectPage = readyPage()
    invalidProjectPage._pageVisible = true
    invalidProjectPage.flushInputCalculation = () => {}
    assert.equal(invalidProjectPage.openProjectSheet(), true)
    assert.equal(invalidProjectPage.closeProjectDialog(), true)
    const invalidProjectTimer = invalidProjectPage._projectCloseTimer
    invalidProjectPage.data.result = null
    invalidProjectPage.data.inputError = true
    assert.equal(invalidProjectPage.openProjectSheet(), false, 'invalid reopen must not interrupt the current exit')
    assert.equal(invalidProjectPage._projectCloseTimer, invalidProjectTimer)
    assert.equal(invalidProjectTimer.cancelled, false)
    fire(invalidProjectTimer)
    assert.equal(invalidProjectPage.data.projectDialogVisible, false, 'invalid reopen still lets the original exit finish')


    const deferredProjectPage = readyPage()
    deferredProjectPage._pageVisible = true
    deferredProjectPage.openProjectSheet()
    const originalProjectSetData = deferredProjectPage.setData
    let delayedProjectCloseCallback = null
    deferredProjectPage.setData = function (changes, callback) {
      originalProjectSetData.call(this, changes)
      if (callback) delayedProjectCloseCallback = callback
    }
    assert.equal(deferredProjectPage.closeProjectDialog(), true)
    assert.equal(deferredProjectPage._projectCloseTimer, null, 'exit timer waits for the closing class render callback')
    assert.equal(deferredProjectPage.openProjectSheet(), true, 'reopen before the render callback invalidates the old exit')
    deferredProjectPage.setData = originalProjectSetData
    delayedProjectCloseCallback.call(deferredProjectPage)
    assert.equal(deferredProjectPage._projectCloseTimer, null, 'a delayed setData callback cannot arm a stale close timer')
    assert.equal(deferredProjectPage.data.projectDialogVisible, true)
    assert.equal(deferredProjectPage.data.projectDialogClosing, false)

    assert.equal(projectPage.openProjectSheet(), true, 'reopen cancels an in-flight close')
    assert.equal(firstProjectTimer.cancelled, true)
    assert.equal(projectPage.data.projectDialogClosing, false)
    fire(firstProjectTimer)
    assert.equal(projectPage.data.projectDialogVisible, true, 'a stale close callback cannot hide a reopened sheet')
    assert.equal(projectPage.data.projectDialogClosing, false)
    assert.equal(projectPage.closeProjectDialog(), true)
    const completedProjectTimer = projectPage._projectCloseTimer
    assert.equal(completedProjectTimer.delay, 320)
    fire(completedProjectTimer)
    assert.equal(projectPage.data.projectDialogVisible, false)
    assert.equal(projectPage.data.projectDialogClosing, false)
    assert.equal(projectPage.data.projectKeyboardOpen, false, 'final cleanup resets keyboard geometry')

    const hidePage = readyPage()
    hidePage._pageVisible = true
    hidePage.openProjectSheet()
    hidePage.closeProjectDialog()
    const hideTimer = hidePage._projectCloseTimer
    hidePage.onHide()
    assert.equal(hidePage.data.projectDialogVisible, false, 'onHide immediately removes a closing project sheet')
    fire(hideTimer)
    assert.equal(hidePage.data.projectDialogVisible, false)

    const unloadPage = readyPage()
    unloadPage._pageVisible = true
    unloadPage.openProjectSheet()
    unloadPage.closeProjectDialog()
    const unloadTimer = unloadPage._projectCloseTimer
    unloadPage.onUnload()
    assert.equal(unloadPage.data.projectDialogVisible, false, 'onUnload immediately removes a closing project sheet')
    fire(unloadTimer)
    assert.equal(unloadPage.data.projectDialogVisible, false)

    const sharePage = readyPage()
    sharePage._pageVisible = true
    sharePage.generateResultReportImage()
    assert.equal(sharePage.data.resultReportPreviewVisible, true)
    assert.equal(sharePage.closeResultReportPreview({ type: 'tap' }), true)
    assert.equal(sharePage.data.resultReportPreviewVisible, true, 'share preview remains mounted during exit')
    assert.equal(sharePage.data.resultReportPreviewClosing, true)
    const firstShareTimer = sharePage._reportPreviewCloseTimer
    assert.equal(firstShareTimer.delay, 320)
    const delayedSharePage = readyPage()
    delayedSharePage._pageVisible = true
    delayedSharePage.generateResultReportImage()
    const originalShareSetData = delayedSharePage.setData
    let delayedShareCloseCallback = null
    delayedSharePage.setData = function (changes, callback) {
      originalShareSetData.call(this, changes)
      if (callback) delayedShareCloseCallback = callback
    }
    assert.equal(delayedSharePage.closeResultReportPreview(), true)
    assert.equal(delayedSharePage._reportPreviewCloseTimer, null, 'share exit waits for the closing class render callback')
    delayedSharePage.setData = originalShareSetData
    delayedSharePage.generateResultReportImage()
    delayedShareCloseCallback.call(delayedSharePage)
    assert.equal(delayedSharePage._reportPreviewCloseTimer, null, 'a delayed share callback cannot arm a close after reopen')
    assert.equal(delayedSharePage.data.resultReportPreviewVisible, true)
    assert.equal(delayedSharePage.data.resultReportPreviewClosing, false)
    fileAccessMode = 'success'
    const delayedCachePage = readyPage()
    delayedCachePage._pageVisible = true
    delayedCachePage.generateResultReportImage()
    fileAccessMode = 'defer'
    assert.equal(delayedCachePage.closeResultReportPreview(), true)
    const pendingCacheCloseTimer = delayedCachePage._reportPreviewCloseTimer
    assert(pendingCacheCloseTimer)
    delayedCachePage.generateResultReportImage()
    assert.equal(pendingCacheCloseTimer.cancelled, true, 'a valid cached reopen cancels the old exit immediately')
    assert.equal(delayedCachePage.data.resultReportPreviewVisible, true, 'the existing preview stays mounted while its cache path is checked')
    assert.equal(delayedCachePage.data.resultReportPreviewClosing, false)
    const lateCacheAccess = pendingFileAccess.pop()
    assert(lateCacheAccess, 'cache access must be deferred for the close/reopen race')
    lateCacheAccess.success()
    fire(pendingCacheCloseTimer)
    assert.equal(delayedCachePage.data.resultReportPreviewVisible, true, 'a stale exit timer cannot hide the reopened cached preview')
    fileAccessMode = 'success'



    assert.equal(sharePage.shareResultReportImage(), false, 'closing prevents entry to platform sharing')
    assert.equal(sharePage.saveResultReportImage(), false, 'closing prevents writing to the photo album')
    assert.equal(shareCalls.length, 0)
    assert.equal(saveCalls.length, 0)
    assert.equal(sharePage.closeResultReportPreview(), false, 'repeated share close does not restart the timer')
    sharePage.generateResultReportImage()
    assert.equal(firstShareTimer.cancelled, true)
    assert.equal(sharePage.data.resultReportPreviewVisible, true, 'cached reopen keeps the report available')
    assert.equal(sharePage.data.resultReportPreviewClosing, false)
    fire(firstShareTimer)
    assert.equal(sharePage.data.resultReportPreviewVisible, true, 'stale share close callback cannot hide a reopened preview')
    assert.equal(sharePage.shareResultReportImage(), true)
    assert.equal(sharePage.saveResultReportImage(), true)
    assert.equal(shareCalls.length, 1)
    assert.equal(saveCalls.length, 1)
    sharePage.closeResultReportPreview()
    const hideShareTimer = sharePage._reportPreviewCloseTimer
    sharePage.onHide()
    assert.equal(sharePage.data.resultReportPreviewVisible, false, 'onHide forces immediate share cleanup')
    fire(hideShareTimer)
    assert.equal(sharePage.data.resultReportPreviewVisible, false)

    sharePage._pageVisible = true
    sharePage.generateResultReportImage()
    sharePage.closeResultReportPreview()
    const unloadShareTimer = sharePage._reportPreviewCloseTimer
    sharePage.onUnload()
    assert.equal(sharePage.data.resultReportPreviewVisible, false, 'onUnload forces immediate share cleanup')
    fire(unloadShareTimer)
    assert.equal(sharePage.data.resultReportPreviewVisible, false)
    console.log('project/share close, duplicate close, reopen, stale timer, hide/unload, storage, and platform-action guards passed')
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
    wx.showShareImageMenu = originalShare
    wx.saveImageToPhotosAlbum = originalSave
  }
}

function testReportDrawing() {
  const longSpec = 'RVV2x10 mm2 / long flexible cable specification / engineering review specimen'.repeat(3)
  const longWarning = 'Review conditions include installation method, ambient temperature, cable brand, supply parameters, and local codes. '.repeat(7)
  const calculated = cableMath.calculateConstantVoltageCable({
    totalPowerW: '1200', distanceMeters: '1000', environment: 'outdoor',
  })
  const payload = report.buildCableReportPayload({
    ...readyPage().data,
    result: { ...calculated, spec: longSpec, warnings: [longWarning, ...calculated.warnings] },
    constantPowerText: '1200',
    constantDistanceText: '1000',
    environmentIndex: 1,
  })
  assert(payload.parameters.some(([, value]) => value === '1200 W'))
  assert(payload.parameters.some(([, value]) => value === '1000 m'))
  assert(payload.parameters.at(-1)[1].includes('/'))
  assert.equal(payload.spec, longSpec)
  assert(payload.warnings.includes(longWarning))
  assert.equal(Object.hasOwn(payload, 'formula'), false, 'standalone formula card payload must be removed')
  assert.equal(Object.hasOwn(payload, 'boundary'), false, 'generic report boundary line must be removed')
  assert(payload.secondary[1].label.includes('公式校核下限'), 'real secondary formula minimum must remain')

  const measureContext = makeContext()
  const layout = report.buildCableReportLayout(measureContext, payload)
  const warningSection = layout.sections.find((section) => section.type === 'warnings')
  const mainSection = layout.sections.find((section) => section.type === 'main')
  assert.equal(layout.sections.some((section) => section.type === 'formula'), false,
    'standalone formula card must not be laid out')
  assert(layout.height > 0)
  assert(getExportDimensions(layout.height).destHeight <= 4096,
    'shared export dimensions must retain its native canvas height limit')
  assert.equal(mainSection.specLines.join(''), longSpec)
  assert(warningSection.warningLines[0].join('').includes(longWarning.trim()))
  const drawContext = makeContext()
  report.drawCableReport(drawContext, payload, layout)
  const drawnText = drawContext.operations.filter(([type]) => type === 'fillText').map(([, text]) => text).join('')
  assert(drawnText.includes(longSpec))
  assert(drawnText.includes(longWarning))
  assert(mainSection.descriptionLines.join('').replace(/\s+/g, '')
    === payload.description.replace(/\s+/g, ''), 'main result description must remain in the report')
  assert(drawnText.includes('输入参数'), 'report parameters must have a readable section title')
  assert(drawnText.includes('注意：'), 'review warnings must retain a readable prefix')
  assert(!drawnText.includes('说明：'), 'generic boundary line must not be drawn')
  assert(!drawnText.includes('S ≥ P × L × 5') && !drawnText.includes('本次公式校核下限为'),
    'standalone formula card content must not be drawn')
  assert(!drawnText.includes('????'), 'report text must not contain replacement placeholders')
  assert(drawnText.includes('1200 W') && drawnText.includes('1000 m'))
  assert(drawnText.includes(String(payload.secondary[1].value)))
  console.log(`report layout passed (${layout.height}px, all long spec/warnings and parameters drawn)`)
}

function testReportLifecycle() {
  canvasState.contextCount = 0
  canvasState.deferDraw = false
  canvasState.deferExport = false
  canvasState.exportMode = 'success'
  canvasState.pendingDraw.length = 0
  canvasState.pendingExport.length = 0
  fileAccessMode = 'success'
  fileAccessCalls.length = 0
  let page = readyPage()
  page.generateResultReportImage()
  assert(page.data.resultReportImagePath)
  assert.equal(page.data.resultReportPreviewVisible, true)
  const contextsAfterFirst = canvasState.contextCount
  fileAccessMode = 'missing'
  page.generateResultReportImage()
  assert.equal(canvasState.contextCount, contextsAfterFirst, 'same cached report must preview without re-rendering')
  assert.equal(page.data.resultReportPreviewVisible, true, 'missing filesystem APIs must preserve cached-image reuse')
  assert.equal(fileAccessCalls.length, 0)

  fileAccessMode = 'fail'
  page.generateResultReportImage()
  assert(canvasState.contextCount > contextsAfterFirst, 'a missing cached image must be regenerated')
  assert(page.data.resultReportImagePath)
  assert.equal(page.data.resultReportPreviewVisible, true)
  fileAccessMode = 'success'

  page.commitCalculatedState({ constantPowerText: '110' })
  assert.equal(page.data.resultReportImagePath, '')
  page.generateResultReportImage()
  assert(page.data.resultReportImagePath)

  canvasState.exportMode = 'fail'
  page.commitCalculatedState({ constantPowerText: '120' })
  page.generateResultReportImage()
  assert.equal(page.data.isGeneratingResultReport, false)
  assert.equal(page.data.resultReportImagePath, '')
  canvasState.exportMode = 'success'
  page.generateResultReportImage()
  assert(page.data.resultReportImagePath, 'failed export must be retryable')

  canvasState.deferExport = true
  canvasState.pendingExport.length = 0
  page = readyPage()
  page.generateResultReportImage()
  const staleDuringInput = canvasState.pendingExport.pop()
  assert(staleDuringInput)
  page.onInput({ currentTarget: { dataset: { field: 'constantPowerText' } }, detail: { value: '120' } })
  assert.equal(page.data.isGeneratingResultReport, false)
  assert.equal(page.data.resultReportImagePath, '', 'editing must clear cached images before debounce completes')
  assert.equal(page.data.resultReportPreviewVisible, false)
  staleDuringInput.success?.({ tempFilePath: 'mock://stale-before-debounce' })
  assert.equal(page.data.resultReportImagePath, '', 'export completion inside the debounce window must not publish an old image')
  assert.equal(page.data.resultReportPreviewVisible, false)
  page.onUnload()

  canvasState.deferExport = true
  page = readyPage()
  page.onShow()
  page.generateResultReportImage()
  const hiddenExport = canvasState.pendingExport.pop()
  assert(hiddenExport)
  page.onHide()
  hiddenExport.success?.({ tempFilePath: 'mock://hidden-export' })
  assert.equal(page.data.resultReportImagePath, '', 'onHide must fence pending report exports')
  assert.equal(page.data.resultReportPreviewVisible, false)
  assert.equal(page.data.isGeneratingResultReport, false)
  page.onShow()
  canvasState.deferExport = false
  page.generateResultReportImage()
  assert(page.data.resultReportImagePath, 'the visible page can generate again after returning from hide')
  page.onUnload()

  canvasState.deferExport = true
  page = readyPage()
  page.commitCalculatedState({ constantPowerText: '130' })
  page.generateResultReportImage()
  assert.equal(canvasState.pendingExport.length, 1)
  const lateExport = canvasState.pendingExport.pop()
  page.onUnload()
  lateExport.success?.({ tempFilePath: 'mock://late-export' })
  assert.equal(page.data.resultReportImagePath, '', 'closed/unloaded export callback must not publish a stale preview')

  canvasState.deferExport = false
  canvasState.deferDraw = true
  canvasState.pendingDraw.length = 0
  page = readyPage()
  page.generateResultReportImage()
  assert.equal(canvasState.pendingDraw.length, 1)
  const lateDraw = canvasState.pendingDraw.pop()
  page.onUnload()
  lateDraw()
  assert.equal(canvasState.pendingExport.length, 0, 'closed draw callback must stop before export')
  canvasState.deferDraw = false
  console.log('report cache file checks, missing-file regeneration, debounce/hide/unload callback fences, and export retry passed')
}

function makePreviewReportPage() {
  storage.delete('audioTool.cable.preferences')
  readFailureKey = ''
  writeFailureKey = ''
  const page = makePage(currentConfig)
  page.onLoad()
  page.onShow()
  page.generateResultReportImage()
  assert(page.data.resultReportImagePath, 'preview fixture must first generate a cable report image')
  assert.equal(page.data.resultReportPreviewVisible, true)
  return page
}

function testNativeOriginalImagePreviewLifecycle() {
  canvasState.contextCount = 0
  canvasState.deferDraw = false
  canvasState.deferExport = false
  canvasState.exportMode = 'success'
  fileAccessMode = 'success'
  const page = makePreviewReportPage()
  const path = page.data.resultReportImagePath
  const signature = page.resultReportSignature
  const firstExportCount = canvasState.contextCount
  const previews = []
  const originalPreviewImage = wx.previewImage
  wx.previewImage = (options) => previews.push(clone(options))

  try {
    assert.equal(page.previewResultReportImage(), true)
    assert.deepEqual(previews, [{ current: path, urls: [path] }],
      'native cable preview must pass the complete current path as both current and the sole URL')
    assert.equal(page.data.resultReportPreviewVisible, true, 'native preview must leave the share sheet open')
    assert.equal(page.data.resultReportImagePath, path)
    assert.equal(page.resultReportSignature, signature)

    assert.equal(page.previewResultReportImage(), true, 'the same current report remains previewable')
    assert.deepEqual(previews.at(-1), { current: path, urls: [path] })
    page.closeResultReportPreview(true)
    assert.equal(page.data.resultReportPreviewVisible, false)
    const closedPreviewCount = previews.length
    assert.equal(page.previewResultReportImage(), false, 'a closed share sheet cannot preview its cached image')
    assert.equal(previews.length, closedPreviewCount)
    assert.equal(page.data.resultReportImagePath, path, 'closing the sheet must retain the valid image cache')
    assert.equal(page.resultReportSignature, signature)
    page.generateResultReportImage()
    assert.equal(canvasState.contextCount, firstExportCount, 'reopening the same cached report must not export again')
    assert.equal(page.data.resultReportPreviewVisible, true)
    assert.equal(page.previewResultReportImage(), true)
    assert.deepEqual(previews.at(-1), { current: path, urls: [path] })

    page.onHide()
    assert.equal(page.data.resultReportPreviewVisible, false, 'ordinary hide closes the share sheet')
    assert.equal(page.data.resultReportImagePath, path, 'ordinary hide must retain a valid cached image')
    const hiddenPreviewCount = previews.length
    assert.equal(page.previewResultReportImage(), false, 'a hidden page cannot preview its cached image')
    assert.equal(previews.length, hiddenPreviewCount)
    page.onShow()
    assert.equal(page.data.resultReportPreviewVisible, false, 'show must not revive a share sheet the user left')
    assert.equal(page.data.resultReportImagePath, path)

    const missingPath = makePreviewReportPage()
    missingPath.setData({ resultReportImagePath: '' })
    const missingPreviewCount = previews.length
    assert.equal(missingPath.previewResultReportImage(), false, 'a missing image path cannot open native preview')
    assert.equal(previews.length, missingPreviewCount)
    missingPath.onUnload()

    const edited = makePreviewReportPage()
    const oldPath = edited.data.resultReportImagePath
    edited.onInput({ currentTarget: { dataset: { field: 'constantPowerText' } }, detail: { value: '120' } })
    assert.equal(edited.data.resultReportImagePath, '', 'editing input invalidates the cached image')
    assert.equal(edited.data.resultReportPreviewVisible, false)
    const editedPreviewCount = previews.length
    assert.equal(edited.previewResultReportImage(), false, 'an edited/stale report cannot open native preview')
    assert.equal(previews.length, editedPreviewCount)
    assert.notEqual(oldPath, edited.data.resultReportImagePath)
    edited.onUnload()

    const stale = makePreviewReportPage()
    stale.data.constantPowerText = '120'
    const stalePreviewCount = previews.length
    assert.equal(stale.previewResultReportImage(), false, 'a mismatched payload signature cannot open native preview')
    assert.equal(previews.length, stalePreviewCount)
    assert.equal(stale.data.resultReportImagePath, '')
    stale.onUnload()

    const noNativePreview = makePreviewReportPage()
    delete wx.previewImage
    assert.equal(noNativePreview.previewResultReportImage(), false,
      'native preview is unavailable when the platform API is missing')
    noNativePreview.onUnload()
    console.log('native original-image current/urls, missing/hidden/edited/stale guards, and cached-report retention passed')
  } finally {
    if (originalPreviewImage === undefined) delete wx.previewImage
    else wx.previewImage = originalPreviewImage
  }
}
function installPreviewSelectorQuery(metrics, deferred = false) {
  const pending = []
  global.wx.createSelectorQuery = () => {
    const callbacks = []
    const query = {
      in() { return query },
      select(selector) {
        return {
          fields(options, callback) {
            assert.equal(options.rect, true)
            assert.equal(options.size, true, 'layout query must request width/height separately from rect')
            const source = metrics[selector]
            assert(source, 'missing geometry fixture for ' + selector)
            const projected = {}
            if (options.rect) projected.rect = source.rect
            if (options.size) {
              projected.width = source.width
              projected.height = source.height
            }
            if (options.computedStyle) {
              projected.computedStyle = Object.fromEntries(options.computedStyle.map((key) => [key, source.computedStyle?.[key]]))
            }
            callbacks.push(() => callback(projected))
            return this
          },
          boundingClientRect(callback) {
            callbacks.push(() => callback(metrics[selector]?.rect))
            return this
          },
        }
      },
      exec(callback) {
        const resolve = () => {
          callbacks.forEach((run) => run())
          callback?.()
        }
        if (deferred) pending.push(resolve)
        else resolve()
      },
    }
    return query
  }
  return pending
}

function previewGeometry(width, height, imageWidth, imageHeight) {
  const top = 20
  const bottom = top + height
  const sheetHeight = Math.min(height - 40, 360)
  const sheetTop = bottom - sheetHeight
  const scrollWidth = imageWidth + 2
  return {
    '.page-root': { rect: { top, bottom, height }, width, height },
    '.result-report-preview-overlay': {
      rect: { top, bottom, height },
      computedStyle: { paddingTop: String(32 * width / 750) + 'px', paddingBottom: String(16 * width / 750) + 'px' },
    },
    '.result-report-preview-sheet': {
      rect: { top: sheetTop, bottom, height: sheetHeight },
      computedStyle: {
        paddingTop: String(20 * width / 750) + 'px', paddingBottom: String(16 * width / 750) + 'px',
        borderTopWidth: '1px', borderBottomWidth: '1px',
      },
    },
    '.result-report-preview-header': { rect: { top: sheetTop, bottom: sheetTop + 45, height: 45 } },
    '.result-report-preview-actions': { rect: { top: bottom - 60, bottom, height: 60 } },
    '.result-report-preview-scroll': {
      rect: { top: sheetTop + 60, bottom: bottom - 60, width: scrollWidth, height: 180 },
      width: scrollWidth,
      height: 180,
      computedStyle: { borderTopWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderRightWidth: '1px' },
    },
    '.result-report-preview-image': {
      rect: { top: sheetTop + 61, bottom: sheetTop + 61 + imageHeight, width: imageWidth, height: imageHeight },
      width: imageWidth,
      height: imageHeight,
    },
  }
}

function testPreviewImageGeometry() {
  const originalCreateSelectorQuery = wx.createSelectorQuery
  const page = makePreviewReportPage()
  page.data.resultReportCanvasHeight = 420
  const metrics = previewGeometry(390, 753, 348, 240)
  installPreviewSelectorQuery(metrics)
  assert.equal(page.updateResultReportPreviewLayout(), true)
  const shortHeight = Number(page.data.resultReportPreviewStyle.match(/--cable-report-scroll-height:([0-9.]+)px/)?.[1])
  const expectedNatural = (420 * 348 / 750) + 2
  assert(Math.abs(shortHeight - expectedNatural) <= 0.02,
    'before image load, the default 240px bbox must not replace canvas-proportional natural height')
  assert(page.data.resultReportPreviewStyle.includes('--cable-report-sheet-max-height:'))

  page.data.resultReportCanvasHeight = 2200
  const shortViewport = previewGeometry(320, 400, 278, 240)
  installPreviewSelectorQuery(shortViewport)
  page.onResize()
  const longHeight = Number(page.data.resultReportPreviewStyle.match(/--cable-report-scroll-height:([0-9.]+)px/)?.[1])
  const naturalLongHeight = 2200 * 278 / 750 + 2
  assert(longHeight > 0 && longHeight < naturalLongHeight,
    'long image scroll height must be limited by the actual short page-root viewport')

  const pixelStyle = page.data.resultReportPreviewStyle
  assert(pixelStyle.includes('px'))
  const originalQuery = wx.createSelectorQuery
  for (const factory of [
    () => { throw new Error('query unavailable') },
    () => null,
    () => ({
      in() { return this },
      select() { return { fields(_options, callback) { callback({}) } } },
      exec(callback) { callback?.() },
    }),
  ]) {
    wx.createSelectorQuery = factory
    page.data.resultReportPreviewStyle = pixelStyle
    page.onResize()
    assert.equal(page.data.resultReportPreviewStyle, '',
      'query throw/null/incomplete nodes after resize must discard stale absolute heights for finite CSS fallback')
  }
  wx.createSelectorQuery = originalQuery

  const pending = installPreviewSelectorQuery(previewGeometry(390, 753, 348, 240), true)
  page.updateResultReportPreviewLayout()
  assert.equal(pending.length, 1)
  const styleBeforeClose = page.data.resultReportPreviewStyle
  assert.equal(page.closeResultReportPreview({ type: 'tap' }), true)
  assert.equal(page.data.resultReportPreviewVisible, true, 'animated close keeps the preview mounted until the exit finishes')
  assert.equal(page.data.resultReportPreviewClosing, true)
  pending[0]()
  assert.equal(page.data.resultReportPreviewStyle, styleBeforeClose, 'a late measurement cannot alter retained layout during close')
  page.closeResultReportPreview(true)
  assert.equal(page.data.resultReportPreviewStyle, '', 'forced cleanup clears measured layout after close')
  page.onUnload()
  if (originalCreateSelectorQuery === undefined) delete wx.createSelectorQuery
  else wx.createSelectorQuery = originalCreateSelectorQuery
  console.log('preview geometry passed (short=' + shortHeight.toFixed(2) + 'px; short-screen long=' + longHeight.toFixed(2) + 'px)')
}

function testMarkupAndStyleContracts() {
  const wxml = fs.readFileSync(path.join(root, 'pages/cable/cable.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'pages/cable/cable.wxss'), 'utf8')
  const overlay = fs.readFileSync(path.join(root, 'pages/cable/cable-overlays.wxml'), 'utf8')
  const sharedPreview = fs.readFileSync(path.join(root, 'templates/result-report-preview.wxml'), 'utf8')
  assert.equal((wxml.match(/<include src="\.\.\/\.\.\/templates\/result-report-preview\.wxml"\s*\/>/g) || []).length, 1)
  assert.equal((wxml.match(/bindtap="(?:resetInputs|generateResultReportImage|toggleCurrentFavorite|saveToActiveProject)"/g) || []).length, 4)
  assert.deepEqual([...wxml.matchAll(/<button class="action-button"[^>]*aria-label="([^"]+)"[^>]*>/g)].map((match) => match[1]), [
    '恢复默认输入', '分享选型图片', '收藏当前选型', '选择项目保存',
  ])
  assert(!wxml.includes('copyResult') && !wxml.includes('复制选型文字') && !wxml.includes('setClipboardData'))
  assert(!/bindtap="\{\{/.test(wxml + overlay), 'event names must remain static WXML strings')
  assert(/<view class="input-card">\s*<view class="mode-tabs" role="tablist">/.test(wxml)
    && /<\/view>\s*<view class="editor-fields">/.test(wxml)
    && wxml.includes('role="tab" aria-selected="{{index == modeIndex}}" data-index="{{index}}" bindtap="onModeTap"')
    && !wxml.includes('editor-fields-constant') && !wxml.includes('editor-fields-professional'),
  'mode tabs and both input modes must share one outer card while preserving tab selection and tap behavior')
  assert(overlay.includes('projectDialogClosing'), 'project overlay must keep its scoped closing class')
  assert(wxml.includes('resultReportPreviewClosing'), 'share overlay must use a page-local closing class')
  for (const selector of [
    '.cable-spec', '.mode-tab.mode-tab-active .mode-label', '.input-unit', '.result-label',
  ]) assert(wxss.includes(selector), 'missing cable visual contract selector ' + selector)
  assert(wxss.includes('@keyframes cable-project-sheet-in') && wxss.includes('@keyframes cable-project-sheet-out')
    && wxss.includes('@keyframes cable-report-sheet-in') && wxss.includes('@keyframes cable-report-sheet-out'),
  'project and share sheets must define paired vertical entry and exit motion')
  assert(!wxss.includes('cable-project-overlay-in') && !wxss.includes('cable-project-overlay-out')
    && !wxss.includes('cable-report-fade-in') && !wxss.includes('cable-report-fade-out')
    && !wxss.includes('cable-project-sheet-fade-in') && !wxss.includes('cable-project-sheet-fade-out'),
  'project and share masks and sheets must not fade')
  assert(wxss.includes('.cable-project-overlay{') && wxss.includes('opacity:1;animation:none')
    && wxss.includes('.page-root .result-report-preview-overlay{')
    && wxss.includes('background:rgba(18,20,27,.52);opacity:1;animation:none'),
  'project and share masks must remain fully visible without an opacity animation')
  assert(wxss.includes('@media (prefers-reduced-motion: reduce)')
    && wxss.includes('.project-sheet,.page-root .result-report-preview-sheet{animation:none;transform:none}')
    && wxss.includes('.project-dialog-closing .project-sheet{animation:none;transform:translateY(')
    && wxss.includes('.page-root.result-report-preview-closing .result-report-preview-sheet{animation:none;transform:translateY('),
  'reduced motion must disable animation and show the closed sheets without a fade')
  assert(wxss.includes('.project-dialog-closing .project-sheet{animation-name:cable-project-sheet-out;animation-timing-function:ease-in;pointer-events:none}')
    && wxss.includes('.page-root.result-report-preview-closing .result-report-preview-sheet{animation-name:cable-report-sheet-out;animation-timing-function:ease-in;pointer-events:none}'),
  'closing sheets must stop accepting actions while their static masks continue intercepting taps')
  assert(wxss.includes('min-height:216px;padding:18px 16px 22px')
    && wxss.includes('.result-primary{box-sizing:border-box;width:calc(100% - 72px)')
    && wxss.includes('.secondary-card{display:grid;box-sizing:border-box;width:calc(100% - 72px)')
    && wxss.includes('.secondary-card{width:100%;margin-top:43px}')
    && !wxss.includes('.result-card{padding-right:44px;padding-left:44px}'),
  'result content must retain centered action clearance, reserve mobile secondary-card space below the rail, and keep a stable blank card height')
  assert(wxss.includes('.input-card{')
    && wxss.includes('.mode-tabs{display:flex;')
    && wxss.includes('.page-root .mode-tab.mode-tab-active{background:var(--theme-surface);')
    && wxss.includes('.page-root .input-card .card.settings-card{')
    && !wxss.includes('mode-tab-active::after')
    && !wxss.includes('margin-bottom:-6px'),
  'tabs and fields must use one enclosing surface without a selected-tab seam or overlap patch')
  assert(!wxss.includes('.formula-title') && !wxss.includes('.formula-text'),
  'standalone company formula card and its exclusive styles must be absent')
  const pageScrollContent = wxml.slice(wxml.indexOf('<scroll-view class="page-scroll"'), wxml.indexOf('<include src="./cable-overlays.wxml"'))
  assert.equal((pageScrollContent.match(/<scroll-view\b/g) || []).length, 1,
    'cable page content must have one full-page scroll container')
  assert(!pageScrollContent.includes('result-details-scroll') && !pageScrollContent.includes('editor-scroll'),
    'result and input panes must not own nested scroll containers')
  assert(pageScrollContent.indexOf('class="secondary-card"') < pageScrollContent.indexOf('class="result-facts"'),
    'secondary values must precede compact conditions')
  assert(!pageScrollContent.includes('class="formula-card"')
    && !pageScrollContent.includes('S ≥ P × L × 5')
    && pageScrollContent.includes('result.formulaMinimumArea')
    && pageScrollContent.includes('result.currentA')
    && pageScrollContent.includes('result.description')
    && pageScrollContent.includes('result.warnings.length')
    && pageScrollContent.includes('class="warning-card"')
    && pageScrollContent.indexOf('class="result-subtitle"') < pageScrollContent.indexOf('class="warning-card"'),
  'page result must retain both secondary values, description, and full warnings without the standalone formula card')
  assert(wxss.includes('flex:0 0 44px') && wxss.includes('width:44px') && wxss.includes('height:44px'))
  assert(wxss.includes('mask-image:url("data:image/svg+xml,'), 'actions must use local inline SVG masks')
  assert(sharedPreview.includes('bindtap="previewResultReportImage"')
    && sharedPreview.includes('bindtap="shareResultReportImage"')
    && sharedPreview.includes('bindtap="saveResultReportImage"'))
  const cableReportUi = fs.readFileSync(path.join(root, 'pages/cable/cable-report.js'), 'utf8')
  assert(!overlay.includes('cable-original-image-viewer')
    && !overlay.includes('resultReportImageViewerVisible')
    && !overlay.includes('setResultReportImageViewerScale')
    && !cableReportUi.includes('resultReportImageViewer')
    && !wxss.includes('cable-original-viewer-scale')
    && cableReportUi.includes('previewGeneratedImage(path)')
    && cableReportUi.includes('stopTap()')
    && cableReportUi.includes('preventTouchMove()')
    && sharedPreview.includes('catchtap="stopTap"')
    && sharedPreview.includes('catchtouchmove="preventTouchMove"'),
  'cable must remove its page-local viewer while retaining shared preview touch handlers and the native preview helper')
  assert(overlay.includes('value="{{projectConfigName}}"') && overlay.includes('maxlength="60"')
    && overlay.includes('value="{{projectConfigNote}}"') && overlay.includes('maxlength="200"')
    && overlay.includes('scroll-into-view="{{projectFocusedInputId}}"')
    && overlay.includes('projectFrozenTitle') && overlay.includes('projectFrozenSummary')
    && !overlay.includes('projectFrozenResultText') && !overlay.includes('project-preview-result'))
  assert.equal((overlay.match(/<scroll-view\b/g) || []).length, 4,
    'each project step must use one scroll body')
  console.log('WXML shared-template, reset/share/favorite/save actions, metadata fields, visual selectors, and SVG contracts passed')
}

async function main() {
  testBaselineBusinessParity()
  testDebounceAndActionFlush()
  testResetAndPreferencePersistence()
  testPendingInputCannotReplaceFailedResetIntent()
  testProjectFlows()
  testAnimatedCloseLifecycle()
  testReportDrawing()
  testReportLifecycle()
  testNativeOriginalImagePreviewLifecycle()
  testPreviewImageGeometry()
  testMarkupAndStyleContracts()
  console.log('Cable refactor focused regression passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

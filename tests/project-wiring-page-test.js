const assert = require('assert/strict')
const Module = require('module')
const path = require('path')
const projectWiring = require('../utils/project-wiring')
const reportBuilder = require('../pages/project-wiring/report')

const pageModulePath = require.resolve('../pages/project-wiring/index')
const recordsModulePath = require.resolve('../utils/records')
const reportModulePath = require.resolve('../pages/project-wiring/report')
const oldPage = global.Page
const oldWx = global.wx
const oldPageModule = require.cache[pageModulePath]
const oldRecordsModule = require.cache[recordsModulePath]
const oldReportModule = require.cache[reportModulePath]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function mockModule(modulePath, exports) {
  const moduleRecord = new Module(modulePath)
  moduleRecord.filename = modulePath
  moduleRecord.loaded = true
  moduleRecord.exports = exports
  require.cache[modulePath] = moduleRecord
}

function createRuntime() {
  const runtime = {
    schedule: projectWiring.emptySchedule(),
    project: { id: 'project-A', name: '一号录音棚' },
    activeProjectId: 'project-A',
    projectStores: null,
    readIds: [],
    activeReads: 0,
    projectListReads: 0,
    createProjectCalls: [],
    failCreateProject: false,
    saveCalls: [],
    failNextSave: false,
    loadFailure: null,
    modals: [],
    toasts: [],
    clipboard: [],
    previews: [],
    saves: [],
    shares: [],
    drawCallbacks: [],
    canvasExports: [],
    canvasContexts: [],
    loadingShown: 0,
    loadingHidden: 0,
    reportTypes: [],
    navTitles: [],
    buildReports: (projectName, schedule, type) => {
      runtime.reportTypes.push(type)
      return {
        type,
        title: type,
        lineCount: schedule.lines.length,
        text: 'report text',
        pages: [
          { title: `${type}-1`, width: 720, height: 520, rows: [] },
          { title: `${type}-2`, width: 720, height: 520, rows: [] },
        ],
      }
    },
    drawReport: (context, page) => { runtime.canvasContexts.push(page.title) },
  }

  runtime.projectStores = new Map([
    ['project-A', { project: clone(runtime.project), schedule: clone(runtime.schedule) }],
    ['project-B', { project: { id: 'project-B', name: '二号录音棚' }, schedule: projectWiring.emptySchedule() }],
  ])

  runtime.records = {
    getProjectWiring(projectId) {
      runtime.readIds.push(projectId)
      if (runtime.loadFailure) return { ok: false, project: null, schedule: null, error: runtime.loadFailure }
      const store = runtime.projectStores.get(projectId)
      if (!store) return { ok: false, project: null, schedule: null, error: '项目不存在或已删除' }
      return { ok: true, project: clone(store.project), schedule: clone(store.schedule) }
    },
    saveProjectWiring(projectId, command, expectedRevision) {
      runtime.saveCalls.push({ projectId, command: clone(command), expectedRevision })
      if (runtime.failNextSave) {
        runtime.failNextSave = false
        return { ok: false, error: '模拟存储失败', schedule: clone(runtime.schedule) }
      }
      const store = runtime.projectStores.get(projectId)
      if (!store) return { ok: false, error: '项目不存在或已删除' }
      if (expectedRevision !== store.schedule.revision) {
        return { ok: false, project: clone(store.project), schedule: clone(store.schedule), error: '项目布线已更新' }
      }
      const result = projectWiring.applyScheduleChange(store.schedule, command)
      if (!result.ok) return { ok: false, project: clone(store.project), ...result }
      store.schedule = clone(result.schedule)
      if (projectId === 'project-A') runtime.schedule = clone(result.schedule)
      return {
        ok: true,
        project: clone(store.project),
        schedule: clone(result.schedule),
        lineIds: result.lineIds,
      }
    },
    getActiveProject() {
      runtime.activeReads += 1
      const store = runtime.projectStores.get(runtime.activeProjectId)
      return store ? clone(store.project) : null
    },
    getProjects() {
      runtime.projectListReads += 1
      return [...runtime.projectStores.values()].map(({ project, schedule }) => ({
        ...clone(project),
        wiringSchedule: clone(schedule),
      }))
    },
    createProject(name) {
      runtime.createProjectCalls.push(name)
      if (runtime.failCreateProject) return null
      const id = `project-C${runtime.createProjectCalls.length}`
      const project = { id, name }
      runtime.projectStores.set(id, { project, schedule: projectWiring.emptySchedule() })
      runtime.activeProjectId = id
      return clone(project)
    },
  }

  runtime.wx = {
    setNavigationBarTitle(options) { runtime.navTitles.push(options.title) },
    showToast(options) { runtime.toasts.push(options) },
    showModal(options) { runtime.modals.push(options) },
    setClipboardData(options) { runtime.clipboard.push(options); if (options.success) options.success() },
    previewImage(options) { runtime.previews.push(options) },
    saveImageToPhotosAlbum(options) { runtime.saves.push(options); if (options.success) options.success() },
    showShareImageMenu(options) { runtime.shares.push(options) },
    vibrateShort() {},
    showLoading() { runtime.loadingShown += 1 },
    hideLoading() { runtime.loadingHidden += 1 },
    createCanvasContext() {
      return {
        draw(_reserve, callback) { runtime.drawCallbacks.push(callback) },
      }
    },
    canvasToTempFilePath(options) { runtime.canvasExports.push(options) },
  }
  runtime.report = {
    buildScheduleReportPages: runtime.buildReports,
    drawScheduleReport: runtime.drawReport,
  }
  return runtime
}

function installPage(runtime, options = { id: 'project-A' }) {
  let page
  global.Page = (config) => { page = config }
  global.wx = runtime.wx
  mockModule(recordsModulePath, runtime.records)
  mockModule(reportModulePath, runtime.report)
  delete require.cache[pageModulePath]
  require(pageModulePath)
  assert(page, 'project wiring page should register')
  page.data = clone(page.data)
  page.mutationCount = 0
  page.setData = (changes, callback) => {
    page.mutationCount += 1
    Object.entries(changes).forEach(([key, value]) => { page.data[key] = value })
    if (callback) callback()
  }
  page.onLoad(options)
  page.onShow()
  return page
}

function input(page, field, value, handler = 'onDraftInput') {
  page[handler]({ currentTarget: { dataset: { field } }, detail: { value } })
}

function selectOption(page, field, options, id) {
  const index = options.findIndex((item) => item.id === id)
  assert(index >= 0, `expected option ${id}`)
  page.onOptionChange({ currentTarget: { dataset: { field } }, detail: { value: String(index) } })
}

function addFirstLine(page) {
  page.openNewLine()
  input(page, 'purpose', '主扩输出')
  input(page, 'fromDevice', '调音台')
  input(page, 'fromPort', 'MAIN L')
  input(page, 'toDevice', '功放')
  input(page, 'toPort', 'INPUT 1')
  page.saveLine()
}

function chooseHistory(page, field, value) {
  page.chooseHistoryValue({ currentTarget: { dataset: { field } }, detail: { value } })
}

function testCompactHistoryPickerBehavior() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  page.openNewLine()
  ;[['fromDevice', 'DSP'], ['fromPort', 'OUT 1'], ['toDevice', '舞台音箱'], ['toPort', 'IN 1']]
    .forEach(([field, value]) => input(page, field, value))
  page.saveLine()

  page.openNewLine()
  assert.deepEqual(page.data.fromDeviceHistory, ['调音台', '功放', 'DSP', '舞台音箱'])
  assert.deepEqual(page.data.fromPortHistory, ['MAIN L', 'INPUT 1', 'OUT 1', 'IN 1'])
  assert.deepEqual(page.data.toDeviceHistory, ['功放', '调音台', '舞台音箱', 'DSP'])
  assert.deepEqual(page.data.toPortHistory, ['INPUT 1', 'MAIN L', 'IN 1', 'OUT 1'])

  const firstValues = {
    fromDevice: '调音台',
    fromPort: 'MAIN L',
    toDevice: '功放',
    toPort: 'INPUT 1',
  }
  Object.entries(firstValues).forEach(([field, value]) => {
    page.openNewLine()
    chooseHistory(page, field, '0')
    assert.equal(page.data.draft[field], value, `${field} should accept the first history index`)
    assert.equal(page._draftTouched, true, `${field} selection should mark the draft as touched`)
  })

  page.openNewLine()
  const beforeInvalid = {
    draft: clone(page.data.draft),
    fromDeviceHistory: clone(page.data.fromDeviceHistory),
    fromPortHistory: clone(page.data.fromPortHistory),
    toDeviceHistory: clone(page.data.toDeviceHistory),
    toPortHistory: clone(page.data.toPortHistory),
    mutationCount: page.mutationCount,
    touched: page._draftTouched,
  }
  ;['', null, undefined, -1, 4, 'not-an-index', 0.5, false, [], {}]
    .forEach((index) => chooseHistory(page, 'fromDevice', index))
  ;['unknownField', 'constructor', '__proto__'].forEach((field) => chooseHistory(page, field, 0))
  assert.equal(page.mutationCount, beforeInvalid.mutationCount, 'invalid indexes and a cancelled picker must not write page state')
  assert.deepEqual(page.data.draft, beforeInvalid.draft)
  assert.deepEqual(page.data.fromDeviceHistory, beforeInvalid.fromDeviceHistory)
  assert.deepEqual(page.data.fromPortHistory, beforeInvalid.fromPortHistory)
  assert.deepEqual(page.data.toDeviceHistory, beforeInvalid.toDeviceHistory)
  assert.deepEqual(page.data.toPortHistory, beforeInvalid.toPortHistory)
  assert.equal(page._draftTouched, beforeInvalid.touched)

  const beforeSavingPick = page.mutationCount
  page.setData({ saving: true })
  const afterSavingFlag = page.mutationCount
  chooseHistory(page, 'fromDevice', 0)
  assert.equal(page.mutationCount, afterSavingFlag, 'history selection must be ignored while saving')
  assert.equal(page.data.draft.fromDevice, '')
  page.setData({ saving: false, draft: null })
  const afterDraftClear = page.mutationCount
  chooseHistory(page, 'fromDevice', 0)
  assert.equal(page.mutationCount, afterDraftClear, 'history selection must be ignored without a draft')
  assert(beforeSavingPick < afterSavingFlag)

  page.openNewLine()
  chooseHistory(page, 'fromDevice', 2)
  assert.equal(page.data.draft.fromDevice, 'DSP')
  assert.deepEqual(page.data.fromPortHistory, ['OUT 1', 'IN 1'], 'changing the source device should refresh matching port history')
}

function completeOneExport(runtime, pathName) {
  const draw = runtime.drawCallbacks.shift()
  assert(draw, 'expected pending canvas draw callback')
  draw()
  const exportOptions = runtime.canvasExports.shift()
  assert(exportOptions, 'expected pending canvas export')
  exportOptions.success({ tempFilePath: pathName })
}

function completeAllExports(runtime, prefix) {
  let pageNumber = 1
  while (runtime.drawCallbacks.length || runtime.canvasExports.length) {
    if (runtime.drawCallbacks.length) {
      const draw = runtime.drawCallbacks.shift()
      draw()
    }
    if (runtime.canvasExports.length) {
      const exportOptions = runtime.canvasExports.shift()
      exportOptions.success({ tempFilePath: `${prefix}-${pageNumber}.png` })
      pageNumber += 1
    }
  }
}

function testFixedProjectReadAndErrors() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  assert.deepEqual(runtime.readIds, ['project-A'])
  runtime.activeProjectId = 'project-B'
  page.openNewLine()
  assert.equal(page.data.editorVisible, true)
  page.requestCloseEditor()
  assert.equal(runtime.records.saveProjectWiring('project-A', { type: 'unknown' }, 0).ok, false)
  assert.equal(runtime.saveCalls.at(-1).projectId, 'project-A')
  assert.equal(page.projectId, 'project-A')

  const missingRuntime = createRuntime()
  let missingPage
  global.Page = (config) => { missingPage = config }
  global.wx = missingRuntime.wx
  missingRuntime.records.getProjectWiring = () => ({ ok: false, project: null, schedule: null, error: '项目不存在或已删除' })
  mockModule(recordsModulePath, missingRuntime.records)
  mockModule(reportModulePath, missingRuntime.report)
  delete require.cache[pageModulePath]
  require(pageModulePath)
  missingPage.data = clone(missingPage.data)
  missingPage.setData = (changes, callback) => { Object.assign(missingPage.data, changes); if (callback) callback() }
  missingPage.onLoad({ id: 'gone' })
  assert.equal(missingPage.data.project, null)
  assert.equal(missingPage.data.loadErrorTitle, '项目不存在或已删除')
  assert.match(missingPage.data.loadError, /本页重新选择一个项目/)
  missingPage.requestProjectPicker()
  assert.equal(missingPage.data.projectPickerVisible, true, 'deleted projects should offer an in-page project picker')
  missingPage.openNewLine()
  assert.equal(missingPage.data.editorVisible, false, 'missing projects must not open a writable empty form')

  const failedRuntime = createRuntime()
  failedRuntime.loadFailure = '本地存储读取失败'
  let failedPage
  global.Page = (config) => { failedPage = config }
  global.wx = failedRuntime.wx
  mockModule(recordsModulePath, failedRuntime.records)
  mockModule(reportModulePath, failedRuntime.report)
  delete require.cache[pageModulePath]
  require(pageModulePath)
  failedPage.data = clone(failedPage.data)
  failedPage.setData = (changes, callback) => { Object.assign(failedPage.data, changes); if (callback) callback() }
  failedPage.onLoad({ id: 'project-A' })
  assert.equal(failedPage.data.project, null)
  assert.equal(failedPage.data.canRetry, true)
  failedPage.openNewLine()
  assert.equal(failedPage.data.editorVisible, false, 'storage read failure must not become a blank writable project')
}

function testProjectEntrySwitchAndOwnership() {
  const activeRuntime = createRuntime()
  activeRuntime.activeProjectId = 'project-B'
  const activePage = installPage(activeRuntime, {})
  assert.equal(activePage.projectId, 'project-B', 'tool entry without an id should open the active project')
  assert.deepEqual(activeRuntime.readIds, ['project-B'])
  assert.equal(activeRuntime.activeReads, 1)
  assert.equal(activeRuntime.navTitles.at(-1), '通道与线缆')

  const explicitRuntime = createRuntime()
  explicitRuntime.activeProjectId = 'project-B'
  const explicitPage = installPage(explicitRuntime, { id: 'project-A' })
  assert.equal(explicitPage.projectId, 'project-A', 'an explicit URL id takes precedence over the active project')
  assert.deepEqual(explicitRuntime.readIds, ['project-A'])
  assert.equal(explicitRuntime.activeReads, 0, 'explicit project entry must not read or change the active project')

  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  page.openProjectPicker()
  assert.equal(page.data.projectPickerVisible, true)
  page.cancelProjectPicker()
  assert.equal(page.data.project.id, 'project-A', 'cancelling a switch should retain the current project content')
  assert.equal(page.data.lineCount, 1)

  runtime.activeProjectId = 'project-A'
  page.onSearchInput({ detail: { value: 'MAIN L' } })
  assert(page._searchTimer)
  page.openProjectPicker()
  page.selectProject({ currentTarget: { dataset: { id: 'project-B' } } })
  assert.equal(page.projectId, 'project-B')
  assert.equal(page.data.project.id, 'project-B')
  assert.equal(page.data.lineCount, 0, 'switching clears old project lines from the page')
  assert.equal(page.data.searchText, '', 'switching clears the previous project search')
  assert.equal(page._searchTimer, null, 'switching cancels the previous project search timer')
  assert.equal(runtime.activeProjectId, 'project-A', 'selecting an existing project must not change global active project')
  runtime.activeProjectId = 'project-A'
  page.onShow()
  assert.equal(page.projectId, 'project-B', 'onShow must keep using this page fixed project id')
  assert.equal(runtime.readIds.at(-1), 'project-B')

  page.openNewLine()
  ;['fromDevice', 'fromPort', 'toDevice', 'toPort'].forEach((field, index) => {
    input(page, field, ['DSP', 'OUT 1', '功放', 'IN 1'][index])
  })
  page.saveLine()
  assert.equal(runtime.saveCalls.at(-1).projectId, 'project-B')
  assert.equal(runtime.projectStores.get('project-B').schedule.lines.length, 1)
  assert.equal(runtime.projectStores.get('project-A').schedule.lines.length, 1, 'a switched page must not write into the previous project')
}

function testNoProjectCancelDirtyGuardAndCreateFailure() {
  const runtime = createRuntime()
  runtime.activeProjectId = ''
  const page = installPage(runtime, {})
  assert.equal(page.projectId, '')
  assert.equal(page.data.selectionRequired, true)
  assert.equal(page.data.projectPickerVisible, true)
  assert.deepEqual(runtime.readIds, [], 'no project entry must never issue a wiring read with an empty id')
  page.cancelProjectPicker()
  assert.equal(page.data.projectPickerVisible, false)
  assert.equal(page.data.selectionRequired, true, 'cancel leaves an explicit project selection entry')
  page.requestProjectPicker()
  assert.equal(page.data.projectPickerVisible, true)
  page.cancelProjectPicker()

  const withProject = createRuntime()
  const editingPage = installPage(withProject)
  editingPage.openNewLine()
  input(editingPage, 'purpose', '保留草稿')
  editingPage.requestProjectPicker()
  const rejectSwitch = withProject.modals.at(-1)
  rejectSwitch.success({ confirm: false })
  assert.equal(editingPage.data.editorVisible, true, 'declining the switch prompt should keep the editor open')
  assert.equal(editingPage.data.draft.purpose, '保留草稿')
  assert.equal(editingPage.data.projectPickerVisible, false)
  editingPage.requestProjectPicker()
  const approveSwitch = withProject.modals.at(-1)
  approveSwitch.success({ confirm: true })
  assert.equal(editingPage.data.editorVisible, false)
  assert.equal(editingPage.data.projectPickerVisible, true)
  editingPage.cancelProjectPicker()
  assert.equal(editingPage.projectId, 'project-A', 'cancel after confirmed discard keeps the same project selected')

  const createRuntimeFailure = createRuntime()
  createRuntimeFailure.activeProjectId = ''
  createRuntimeFailure.failCreateProject = true
  const failedCreatePage = installPage(createRuntimeFailure, {})
  failedCreatePage.onProjectNameInput({ detail: { value: '新现场' } })
  failedCreatePage.createAndOpenProject()
  assert.equal(failedCreatePage.data.projectPickerVisible, true)
  assert.equal(failedCreatePage.data.projectPickerError, '创建项目失败，请重试。')
  assert.equal(failedCreatePage.projectId, '')

  const listFailureRuntime = createRuntime()
  listFailureRuntime.records.getProjects = () => { throw new Error('read failed') }
  const listFailurePage = installPage(listFailureRuntime)
  listFailurePage.openProjectPicker()
  assert.match(listFailurePage.data.projectPickerError, /读取项目列表失败/)
}

function testCreateProjectEntersCreatedProject() {
  const runtime = createRuntime()
  runtime.activeProjectId = ''
  const page = installPage(runtime, {})
  page.onProjectNameInput({ detail: { value: '新录音棚' } })
  page.createAndOpenProject()
  assert.deepEqual(runtime.createProjectCalls, ['新录音棚'])
  assert.equal(runtime.activeProjectId, 'project-C1', 'createProject retains its existing active-project behavior')
  assert.equal(page.projectId, 'project-C1')
  assert.equal(page.data.project.id, 'project-C1')
  assert.equal(page.data.project.name, '新录音棚')
  page.openNewLine()
  ;['fromDevice', 'fromPort', 'toDevice', 'toPort'].forEach((field, index) => {
    input(page, field, ['调音台', 'OUT', '功放', 'IN'][index])
  })
  page.saveLine()
  assert.equal(runtime.saveCalls.at(-1).projectId, 'project-C1')
}

function testProjectPickerCancelsLateExport() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  page.generateExport('lines')
  const lateDraw = runtime.drawCallbacks.shift()
  assert(lateDraw)
  lateDraw()
  const lateCanvasExport = runtime.canvasExports.shift()
  assert(lateCanvasExport)
  page.openProjectPicker()
  assert.equal(page.data.projectPickerVisible, true)
  const mutationsBeforeLateCallback = page.mutationCount
  lateCanvasExport.success({ tempFilePath: 'old-project.png' })
  assert.equal(page.data.projectPickerVisible, true, 'opening the selector must invalidate the old canvas request')
  assert.equal(page.data.reportPreviewVisible, false, 'a late export cannot cover the project selector')
  assert.equal(page.mutationCount, mutationsBeforeLateCallback, 'stale project export callbacks must not mutate the page')
}

function testLateLoadFromPreviousProjectIsIgnored() {
  const runtime = createRuntime()
  const normalGetProjectWiring = runtime.records.getProjectWiring
  let resolveOldProjectLoad
  runtime.records.getProjectWiring = (projectId) => {
    if (projectId === 'project-A') {
      return {
        then(resolve) { resolveOldProjectLoad = resolve; return { catch() {} } },
      }
    }
    return normalGetProjectWiring(projectId)
  }
  const page = installPage(runtime, { id: 'project-A' })
  assert.equal(page.data.loading, true)
  page.openProjectPicker()
  page.selectProject({ currentTarget: { dataset: { id: 'project-B' } } })
  assert.equal(page.data.project.id, 'project-B')
  const oldSchedule = projectWiring.applyScheduleChange(projectWiring.emptySchedule(), {
    type: 'upsert',
    line: { fromDevice: '旧项目设备', fromPort: 'OUT', toDevice: '旧项目功放', toPort: 'IN' },
  }).schedule
  resolveOldProjectLoad({
    ok: true,
    project: { id: 'project-A', name: '一号录音棚' },
    schedule: oldSchedule,
  })
  assert.equal(page.projectId, 'project-B')
  assert.equal(page.data.project.id, 'project-B', 'an older project load cannot replace the newly selected project')
  assert.equal(page.data.lineCount, 0, 'stale project lines cannot leak into the current page')
}

function testAddSearchAndSaveFailure() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  page.openNewLine()
  page.saveLine()
  assert.equal(runtime.saveCalls.length, 0, 'missing endpoints must be validated before storage')
  assert.match(page.data.formError, /设备名称、端口名称/)
  ;['fromDevice', 'fromPort', 'toDevice', 'toPort'].forEach((field, index) => {
    input(page, field, ['调音台', 'MAIN L', '功放', 'INPUT 1'][index])
  })
  page.saveLine()
  assert.equal(runtime.schedule.lines.length, 1)
  assert.equal(runtime.schedule.lines[0].code, 'A001')
  assert.equal(runtime.schedule.lines[0].lengthText, '', 'empty length must remain unknown, not zero')
  assert.equal(runtime.schedule.lines[0].status, 'pending')
  assert.equal(runtime.schedule.lines[0].connectorA, 'xlrFemale')
  assert.equal(runtime.schedule.lines[0].connectorB, 'xlrMale')

  page.onSearchInput({ detail: { value: 'MAIN L' } })
  page.applySearch({ detail: { value: 'MAIN L' } })
  assert.equal(page.data.visibleLines.length, 1)
  page.applySearch({ detail: { value: 'no match' } })
  assert.equal(page.data.visibleLines.length, 0)

  const line = runtime.schedule.lines[0]
  page.editLine({ currentTarget: { dataset: { id: line.id } } })
  input(page, 'notes', '保留这段修改')
  runtime.failNextSave = true
  page.saveLine()
  assert.equal(page.data.editorVisible, true, 'a failed save should keep the editor open')
  assert.equal(page.data.draft.notes, '保留这段修改')
  assert.equal(page.data.saveError, '模拟存储失败')
  assert.equal(runtime.schedule.lines[0].notes, '', 'failed writes must leave the stored schedule unchanged')
  page.saveLine()
  assert.equal(page.data.editorVisible, false)
  assert.equal(runtime.schedule.lines[0].notes, '保留这段修改')
}

function testCustomConnectorAndCableDefaults() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  const line = runtime.schedule.lines[0]
  page.editLine({ currentTarget: { dataset: { id: line.id } } })
  selectOption(page, 'connectorA', page.data.connectorOptions, 'custom')
  page.onCustomConnectorInput({ currentTarget: { dataset: { field: 'connectorA' } }, detail: { value: 'BNC 转接头' } })
  page.saveLine()
  assert.equal(runtime.schedule.lines[0].connectorA, 'BNC 转接头')
  page.editLine({ currentTarget: { dataset: { id: line.id } } })
  assert.equal(page.data.connectorAIndex, page.data.customConnectorIndex)
  assert.equal(page.data.customConnectorA, 'BNC 转接头', 'stored custom connector text should refill the editor')
  page.requestCloseEditor()

  page.openNewLine()
  selectOption(page, 'cableType', page.data.cableOptions, 'speaker')
  assert.equal(page.data.draft.connectorA, '')
  assert.equal(page.data.draft.connectorB, '')
  assert.equal(page.data.connectorAIndex, 0)
  assert.equal(page.data.connectorBIndex, 0, 'switching a new line to speaker cable must not silently keep XLR ends')
}

function testSpecPresetsAndPreservation() {
  const defaultRuntime = createRuntime()
  const defaultPage = installPage(defaultRuntime)
  addFirstLine(defaultPage)
  const defaultLine = defaultRuntime.schedule.lines[0]
  const defaultSpec = 'RVPE 2×0.5 mm²'
  assert.equal(defaultLine.spec, defaultSpec, 'saving an untouched new line should retain the default audio specification')
  assert.equal(defaultPage.data.visibleLines[0].spec, defaultSpec, 'the line list should show the default specification')
  assert(projectWiring.buildScheduleText(defaultRuntime.project.name, defaultRuntime.schedule).includes(defaultSpec),
    'the line schedule should include the default specification')
  assert(reportBuilder.buildScheduleReportPages(defaultRuntime.project.name, defaultRuntime.schedule, 'lines')
    .pages.flatMap((reportPage) => reportPage.rows).some((row) => row.textLines.some((line) => line.includes(defaultSpec))),
  'the line report should include the default specification')

  const defaultBatchRuntime = createRuntime()
  const defaultBatchPage = installPage(defaultBatchRuntime)
  defaultBatchPage.openBatch()
  Object.entries({ count: '1', fromDevice: 'DSP', fromPrefix: 'OUT-', fromStart: '1',
    toDevice: '功放', toPrefix: 'IN-', toStart: '1', purpose: '批量音频' })
    .forEach(([field, value]) => input(defaultBatchPage, field, value, 'onBatchInput'))
  defaultBatchPage.refreshBatchPreview()
  assert.equal(defaultBatchPage.data.batchPreviewLines[0].spec, defaultSpec,
    'an untouched batch audio line should preview with the default')
  defaultBatchPage.commitBatch()
  assert.equal(defaultBatchRuntime.schedule.lines[0].spec, defaultSpec,
    'an untouched batch audio line should save with the default')

  const runtime = createRuntime()
  const page = installPage(runtime)
  const defaultAudioSpec = 'RVPE 2×0.5 mm²'
  const audioSpecs = []
  const speakerSpecs = ['RVV 2×1.5 mm²', 'RVV 2×2.5 mm²']
  page.openNewLine()
  assert.equal(page.data.draft.spec, defaultAudioSpec, 'a new line should default to RVPE 2×0.5 mm²')
  assert.deepEqual(page.data.specOptions, audioSpecs)
  assert.deepEqual(page.data.specOptionViews, [], 'audio quick-pick views should be hidden')
  page.chooseSpecPreset({ currentTarget: { dataset: { value: 'unlisted cable value' } } })
  assert.equal(page.data.draft.spec, defaultAudioSpec, 'a value outside the current choices must not be accepted')

  selectOption(page, 'cableType', page.data.cableOptions, 'unbalanced')
  assert.equal(page.data.draft.spec, defaultAudioSpec, 'switching audio types should keep the default')
  selectOption(page, 'cableType', page.data.cableOptions, 'speaker')
  assert.equal(page.data.draft.spec, '', 'switching an untouched default to speaker should clear RVPE')
  assert.deepEqual(page.data.specOptions, speakerSpecs)
  selectOption(page, 'cableType', page.data.cableOptions, 'balanced')
  assert.equal(page.data.draft.spec, defaultAudioSpec, 'switching back to audio should restore the default')
  input(page, 'spec', '现场手工规格')
  selectOption(page, 'cableType', page.data.cableOptions, 'speaker')
  assert.deepEqual(page.data.specOptions, speakerSpecs)
  assert.equal(page.data.draft.spec, '现场手工规格', 'changing cable type should preserve hand-entered text')
  input(page, 'spec', '')
  selectOption(page, 'cableType', page.data.cableOptions, 'balanced')
  assert.equal(page.data.draft.spec, '', 'an explicitly cleared specification should not be restored')
  input(page, 'spec', defaultAudioSpec)
  selectOption(page, 'cableType', page.data.cableOptions, 'speaker')
  page.chooseSpecPreset({ currentTarget: { dataset: { value: speakerSpecs[0] } } })
  assert.equal(page.data.draft.spec, speakerSpecs[0])
  selectOption(page, 'cableType', page.data.cableOptions, 'custom')
  assert.deepEqual(page.data.specOptions, [], 'custom cable types should have no preset choices')
  assert.equal(page.data.draft.spec, speakerSpecs[0], 'custom cable type should preserve the entered specification')
  selectOption(page, 'cableType', page.data.cableOptions, 'balanced')
  assert.equal(page.data.draft.spec, speakerSpecs[0], 'manual preset selection should be preserved across cable types')
  ;[['purpose', '主扩输出'], ['fromDevice', '调音台'], ['fromPort', 'MAIN L'],
    ['toDevice', '功放'], ['toPort', 'INPUT 1']].forEach(([field, value]) => input(page, field, value))
  page.saveLine()

  const savedLine = runtime.schedule.lines[0]
  assert.equal(savedLine.spec, speakerSpecs[0], 'the selected speaker preset should be saved')
  assert.equal(page.data.visibleLines[0].spec, speakerSpecs[0], 'the line list should retain the complete specification')
  assert(projectWiring.buildScheduleText(runtime.project.name, runtime.schedule).includes(speakerSpecs[0]),
    'the copied schedule text should retain the complete specification')
  page.selectTab({ currentTarget: { dataset: { tab: 'materials' } } })
  assert(page.data.materialGroups.some((row) => row.title.includes(speakerSpecs[0])),
    'the material list should group by the complete specification')
  const lineReport = reportBuilder.buildScheduleReportPages(runtime.project.name, runtime.schedule, 'lines')
  assert(lineReport.pages.flatMap((reportPage) => reportPage.rows)
    .some((row) => row.textLines.some((line) => line.includes(speakerSpecs[0]))),
  'the line report should render the complete specification')
  const materialReport = reportBuilder.buildScheduleReportPages(runtime.project.name, runtime.schedule, 'materials')
  assert(materialReport.pages.flatMap((reportPage) => reportPage.rows)
    .some((row) => row.textLines.some((line) => line.includes(speakerSpecs[0]))),
  'the material report should render the complete specification')

  const historicalSpec = '历史自定义采购规格'
  page.editLine({ currentTarget: { dataset: { id: savedLine.id } } })
  assert.equal(page.data.draft.spec, speakerSpecs[0], 'editing should refill the saved specification')
  input(page, 'spec', historicalSpec)
  page.saveLine()
  page.editLine({ currentTarget: { dataset: { id: savedLine.id } } })
  assert.equal(page.data.draft.spec, historicalSpec, 'editing should preserve an existing custom specification')
  input(page, 'spec', '未保存的替代规格')
  page.requestCloseEditor()
  runtime.modals.at(-1).success({ confirm: true })
  assert.equal(page.data.editorVisible, false)
  assert.equal(runtime.schedule.lines[0].spec, historicalSpec, 'cancelling an edit must leave the stored specification unchanged')

  page.editLine({ currentTarget: { dataset: { id: savedLine.id } } })
  page.duplicateLine()
  assert.equal(page.data.draft.spec, historicalSpec, 'copying a line should retain its custom specification')
  page.saveLine()
  const copiedLine = runtime.schedule.lines.find((line) => line.id !== savedLine.id)
  assert.equal(copiedLine.spec, historicalSpec, 'the copied line should save its complete custom specification')

  ;['', 'RVPE 2×0.3 mm²', '历史自定义规格'].forEach((legacySpec) => {
    page._schedule.lines.find((line) => line.id === savedLine.id).spec = legacySpec
    page.editLine({ currentTarget: { dataset: { id: savedLine.id } } })
    assert.equal(page.data.draft.spec, legacySpec, `editing must preserve historical specification ${legacySpec}`)
    page.duplicateLine()
    assert.equal(page.data.draft.spec, legacySpec, `copying must preserve historical specification ${legacySpec}`)
    page.closeEditor()
  })

  page.openBatch()
  assert.equal(page.data.batchDraft.spec, defaultAudioSpec, 'batch lines should default to RVPE 2×0.5 mm²')
  assert.deepEqual(page.data.batchSpecOptions, audioSpecs)
  assert.deepEqual(page.data.batchSpecOptionViews, [], 'batch audio quick-pick views should be hidden')
  input(page, 'spec', '批量手工规格', 'onBatchInput')
  page.onBatchCableChange({ detail: { value: String(page.data.cableOptions.findIndex((item) => item.id === 'speaker')) } })
  assert.equal(page.data.batchDraft.spec, '批量手工规格', 'manual batch specifications should survive cable type changes')
  input(page, 'spec', '', 'onBatchInput')
  page.onBatchCableChange({ detail: { value: String(page.data.cableOptions.findIndex((item) => item.id === 'balanced')) } })
  assert.equal(page.data.batchDraft.spec, '', 'a manually cleared batch specification should remain empty')
  page.openBatch()
  const batchInputs = {
    count: '2', fromDevice: 'DSP', fromPrefix: 'OUT-', fromStart: '1',
    toDevice: '功放', toPrefix: 'IN-', toStart: '1', purpose: '扬声器分区',
  }
  Object.entries(batchInputs).forEach(([field, value]) => input(page, field, value, 'onBatchInput'))
  const speakerIndex = page.data.cableOptions.findIndex((item) => item.id === 'speaker')
  page.onBatchCableChange({ detail: { value: String(speakerIndex) } })
  assert.deepEqual(page.data.batchSpecOptions, speakerSpecs)
  assert.equal(page.data.batchDraft.spec, '', 'batch type changes should clear untouched RVPE for speaker cable')
  page.chooseBatchSpecPreset({ currentTarget: { dataset: { value: speakerSpecs[0] } } })
  page.refreshBatchPreview()
  assert.equal(page.data.batchPreviewLines.length, 2)
  assert.equal(page.data.batchPreviewLines[0].spec, speakerSpecs[0])
  page.chooseBatchSpecPreset({ currentTarget: { dataset: { value: speakerSpecs[1] } } })
  assert.equal(page.data.batchPreviewLines.length, 0, 'changing the batch specification must invalidate its old preview')
  page.refreshBatchPreview()
  assert.equal(page.data.batchPreviewLines.length, 2)
  assert(page.data.batchPreviewLines.every((line) => line.spec === speakerSpecs[1]),
    'a refreshed preview should use the new complete specification')
  page.commitBatch()
  const batchLines = runtime.schedule.lines.slice(-2)
  assert.equal(batchLines.length, 2)
  assert(batchLines.every((line) => line.spec === speakerSpecs[1]), 'batch save should retain the refreshed specification')
}

function testBatchDuplicateDeleteAndStableNumbers() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  page.openBatch()
  const batchInputs = {
    count: '2', fromDevice: 'DSP', fromPrefix: 'OUT-', fromStart: '3',
    toDevice: '功放', toPrefix: 'IN-', toStart: '1', purpose: '分区扬声器', spec: '2×2.5mm²', lengthText: '8.25',
  }
  Object.entries(batchInputs).forEach(([field, value]) => input(page, field, value, 'onBatchInput'))
  const buildIndex = page.data.buildOptions.findIndex((item) => item.id === 'bulk')
  page.onBatchBuildChange({ detail: { value: String(buildIndex) } })
  const cableIndex = page.data.cableOptions.findIndex((item) => item.id === 'speaker')
  page.onBatchCableChange({ detail: { value: String(cableIndex) } })
  page.refreshBatchPreview()
  assert.equal(page.data.batchPreviewLines.length, 2)
  assert.equal(page.data.batchPreviewLines[0].code, 'A002')
  assert.equal(page.data.batchPreviewLines[0].fromPort, 'OUT-3')
  assert.equal(page.data.batchPreviewLines[1].toPort, 'IN-2')
  assert.equal(page.data.batchPreviewLines[0].lengthText, '8.25')
  assert.equal(runtime.schedule.lines.length, 1, 'batch preview must not write before confirmation')
  assert.equal(runtime.saveCalls.length, 1)
  page.commitBatch()
  assert.equal(runtime.schedule.lines.length, 3)
  assert.equal(runtime.schedule.lines[1].buildType, 'bulk')
  assert.equal(runtime.schedule.lines[1].cableType, 'speaker')
  assert.equal(runtime.schedule.lines[1].connectorA, '', 'unselected batch ends remain explicitly pending')
  assert.equal(runtime.schedule.lines[1].code, 'A002')

  const original = runtime.schedule.lines[0]
  page.editLine({ currentTarget: { dataset: { id: original.id } } })
  input(page, 'purpose', '只用于复制草稿')
  page.duplicateLine()
  assert.equal(page.data.draftIsNew, true)
  assert.equal(page.data.draft.status, 'pending')
  assert.equal(page.data.draft.purpose, '只用于复制草稿')
  assert.equal(runtime.schedule.lines[0].purpose, '主扩输出', 'copying a changed draft must not edit the original')
  page.saveLine()
  const duplicate = runtime.schedule.lines.find((line) => line.code === 'A004')
  assert(duplicate)
  assert.equal(duplicate.purpose, '只用于复制草稿')

  page.editLine({ currentTarget: { dataset: { id: duplicate.id } } })
  page.deleteLine()
  const deleteModal = runtime.modals.at(-1)
  assert.match(deleteModal.title, /删除线路/)
  deleteModal.success({ confirm: true })
  assert.equal(runtime.schedule.lines.some((line) => line.code === 'A004'), false)
  page.openNewLine()
  ;['fromDevice', 'fromPort', 'toDevice', 'toPort'].forEach((field, index) => {
    input(page, field, ['调音台', 'AUX 2', 'DSP', 'INPUT 2'][index])
  })
  page.saveLine()
  assert(runtime.schedule.lines.some((line) => line.code === 'A005'), 'deleted codes must not be reused')
}

function testPagedExportActionsAndLateCallbacks() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  page.generateExport()
  completeAllExports(runtime, 'lines')
  assert.deepEqual(runtime.reportTypes, ['lines'])
  assert.equal(page.data.reportImages.length, 2)
  assert.equal(page.data.reportPreviewVisible, true)
  assert.equal(page.data.reportImagePath, 'lines-1.png')
  page.nextReportPage()
  assert.equal(page.data.reportImagePath, 'lines-2.png')
  page.saveReportImage()
  page.shareReportImage()
  assert.equal(runtime.saves.at(-1).filePath, 'lines-2.png')
  assert.equal(runtime.shares.at(-1).path, 'lines-2.png')
  page.closeReportPreview()

  page.generateMaterialList()
  assert.equal(runtime.reportTypes.at(-1), 'materials', 'material action should export the material layout')
  const pendingExport = runtime.canvasExports.at(-1) || null
  if (runtime.drawCallbacks.length) runtime.drawCallbacks.shift()()
  const lateExport = runtime.canvasExports.pop()
  assert(lateExport)
  page.onHide()
  const mutationsBeforeLateResult = page.mutationCount
  lateExport.success({ tempFilePath: 'late-hidden.png' })
  assert.equal(page.mutationCount, mutationsBeforeLateResult, 'late canvas callbacks after hide must not write page state')
  assert.equal(page.data.reportPreviewVisible, false)
  assert(pendingExport === null || pendingExport, 'the export was intentionally deferred for the stale-callback check')

  page.onShow()
  page.generateExport('labels')
  assert(runtime.drawCallbacks.length > 0)
  const lateDraw = runtime.drawCallbacks.shift()
  page.onUnload()
  const mutationsBeforeUnloadCallback = page.mutationCount
  lateDraw()
  assert.equal(page.mutationCount, mutationsBeforeUnloadCallback, 'late draw callbacks after unload must not write page state')
  assert(runtime.loadingHidden > 0, 'cancelled exports should clear the loading mask')
}

function testExportTypeWithTapEvent() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  const selections = [
    { index: 0, type: 'lines' },
    { index: 1, type: 'materials' },
    { index: 2, type: 'labels' },
  ]
  const signatures = []
  selections.forEach(({ index, type }, selectionNumber) => {
    page.selectExportType({ detail: { value: String(index) } })
    const reportCount = runtime.reportTypes.length
    page.generateExport({ type: 'tap' })
    assert.equal(runtime.reportTypes.length, reportCount + 1)
    assert.equal(runtime.reportTypes.at(-1), type, 'tap event objects must use the selected export type')
    completeAllExports(runtime, `tap-${selectionNumber}`)
    signatures.push(page._reportSignature)
    assert(page.data.reportImages.length > 0)
    const cachedCount = runtime.reportTypes.length
    page.generateExport({ type: 'tap' })
    assert.equal(runtime.reportTypes.length, cachedCount, 'same type should reuse its completed export cache')
  })
  assert.equal(new Set(signatures).size, 3, 'each export type should have a distinct cache signature')

  page.selectExportType({ detail: { value: '1' } })
  page.generateExport('invalid-type')
  assert.equal(runtime.reportTypes.at(-1), 'materials', 'invalid string overrides should use the current selection')
  completeAllExports(runtime, 'invalid-fallback')
  page.selectExportType({ detail: { value: '0' } })
  page.generateExport('materials')
  assert.equal(runtime.reportTypes.at(-1), 'materials', 'a valid explicit override should remain supported')
  completeAllExports(runtime, 'explicit-override')

  page.generateMaterialList()
  assert.equal(runtime.reportTypes.at(-1), 'materials', 'material shortcut must retain its materials type')
  completeAllExports(runtime, 'material-shortcut')
}

try {
  testFixedProjectReadAndErrors()
  testProjectEntrySwitchAndOwnership()
  testNoProjectCancelDirtyGuardAndCreateFailure()
  testCreateProjectEntersCreatedProject()
  testProjectPickerCancelsLateExport()
  testLateLoadFromPreviousProjectIsIgnored()
  testCompactHistoryPickerBehavior()
  testAddSearchAndSaveFailure()
  testCustomConnectorAndCableDefaults()
  testSpecPresetsAndPreservation()
  testBatchDuplicateDeleteAndStableNumbers()
  testPagedExportActionsAndLateCallbacks()
  testExportTypeWithTapEvent()
  console.log('project wiring page tests passed (entry routing, fixed project ownership, compact history picker, picker cancellation, dirty-form guard, project creation/failures, stale exports, add/edit/search, batch, save retention and delete/copy numbering)')
} finally {
  if (oldPage === undefined) delete global.Page
  else global.Page = oldPage
  if (oldWx === undefined) delete global.wx
  else global.wx = oldWx
  delete require.cache[pageModulePath]
  delete require.cache[reportModulePath]
  if (oldPageModule) require.cache[pageModulePath] = oldPageModule
  if (oldRecordsModule) require.cache[recordsModulePath] = oldRecordsModule
  else delete require.cache[recordsModulePath]
  if (oldReportModule) require.cache[reportModulePath] = oldReportModule
}

require('./project-wiring-keyboard-test')

const assert = require('assert/strict')
const fs = require('fs')
const Module = require('module')
const path = require('path')
const projectWiring = require('../utils/project-wiring')
const reportBuilder = require('../pages/project-wiring/report')

const pageModulePath = require.resolve('../pages/project-wiring/index')
const recordsModulePath = require.resolve('../utils/records')
const reportModulePath = require.resolve('../pages/project-wiring/report')
const workspaceModulePath = require.resolve('../pages/project-wiring/workspace-ui')
const oldPage = global.Page
const oldWx = global.wx
const oldPageModule = require.cache[pageModulePath]
const oldRecordsModule = require.cache[recordsModulePath]
const oldReportModule = require.cache[reportModulePath]
const oldWorkspaceModule = require.cache[workspaceModulePath]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function installControlledTimers() {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const timers = []
  let now = 0
  let nextId = 1
  global.setTimeout = (callback, delay = 0, ...args) => {
    const timer = { id: nextId++, callback, args, due: now + Math.max(0, Number(delay) || 0), active: true }
    timers.push(timer)
    return timer.id
  }
  global.clearTimeout = (id) => {
    const timer = timers.find((item) => item.id === id)
    if (timer) timer.active = false
  }
  return {
    advanceBy(milliseconds) {
      const target = now + Math.max(0, Number(milliseconds) || 0)
      while (true) {
        const timer = timers.filter((item) => item.active && item.due <= target)
          .sort((first, second) => first.due - second.due || first.id - second.id)[0]
        if (!timer) break
        now = timer.due
        timer.active = false
        timer.callback(...timer.args)
      }
      now = target
    },
    restore() {
      global.setTimeout = originalSetTimeout
      global.clearTimeout = originalClearTimeout
    },
  }
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
        ...(result.deviceIds ? { deviceIds: result.deviceIds } : {}),
      }
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
  delete require.cache[workspaceModulePath]
  require(pageModulePath)
  assert(page, 'project wiring page should register')
  page.data = clone(page.data)
  page.mutationCount = 0
  page.setData = (changes, callback) => {
    page.mutationCount += 1
    Object.entries(clone(changes)).forEach(([key, value]) => {
      const path = key.split('.')
      const leaf = path.pop()
      const target = path.reduce((current, part) => {
        if (!current[part] || typeof current[part] !== 'object') current[part] = {}
        return current[part]
      }, page.data)
      target[leaf] = value
    })
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

function addDevice(page, name, type = 'mixer', count = '1') {
  page.openDeviceEditor()
  page.onDeviceType({ currentTarget: { dataset: { type } } })
  input(page, 'name', name, 'onDeviceDraftInput')
  input(page, 'count', count, 'onDeviceDraftInput')
  page.saveDevices()
  assert.equal(page.data.deviceEditorVisible, false, page.data.deviceFormError || page.data.batchError)
}

function chooseEndpoint(page, side, name) {
  const choices = side === 'from' ? page.data.fromDeviceChoices : page.data.toDeviceChoices
  const index = choices.findIndex((device) => device.name === name && device.id)
  assert(index > 0, 'expected selectable device ' + name)
  page.selectEndpoint({ currentTarget: { dataset: { side } }, detail: { value: String(index) } })
}

function pairInput(page, index, field, value) {
  page.onPairInput({ currentTarget: { dataset: { index, field } }, detail: { value } })
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

function testEndpointHistoryPickerTemplateBindings() {
  const pageRoot = path.join(__dirname, '../pages/project-wiring')
  const expand = (file) => fs.readFileSync(file, 'utf8').replace(/<include\s+src="([^"]+)"\s*\/>/g,
    (_match, include) => expand(path.join(path.dirname(file), include)))
  const template = expand(path.join(pageRoot, 'index.wxml'))
  const pickers = [...template.matchAll(/<picker\b[^>]*>/g)].map(([tag]) => tag)
  ;['from', 'to'].forEach((side) => {
    const range = side === 'from' ? 'fromDeviceChoices' : 'toDeviceChoices'
    const picker = pickers.find((tag) => tag.includes('data-side="' + side + '"') && tag.includes(`range="{{${range}}}"`))
    assert(picker)
    assert(picker.includes(`range="{{${range}}}"`))
    assert(picker.includes('range-key="choiceLabel"'))
    assert(picker.includes('bindchange="selectEndpoint"'))
  })
  ;['from', 'to'].forEach((side) => {
    const tag = [...template.matchAll(/<input\b[^>]*>/g)].map(([value]) => value)
      .find((value) => value.includes('id="wiring-pair-{{index}}-' + side + '"'))
    assert(tag, 'each editable port pair has a stable indexed field')
    assert(tag.includes('bindinput="onPairInput"'))
    assert(tag.includes('maxlength="80"'))
  })
  assert.match(template, /<picker-view\b/)
  assert.match(template, /bindtap="confirmProjectPicker"/)
  assert.match(template, /bindtap="cancelProjectPicker"/)
  assert.match(template, /catchtap="requestNewProject"/)
  assert.match(template, /bindtap="openContinuous"/)
  assert.match(template, /bindtap="fillContinuous"/)
  assert.match(template, /来源接头/)
  assert.match(template, /去向接头/)
  assert.match(template, /catchtap="shareProject"/)
  assert.doesNotMatch(template, /data-field="(?:purpose|notes)"|bindtap="duplicateLine"|更多信息|线缆侧接头/,
    'approved compact UI removes extra fields and copy actions while legacy data remains supported')
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

function setThreePageReport(runtime) {
  runtime.buildReports = (_projectName, _schedule, type) => {
    runtime.reportTypes.push(type)
    return {
      type,
      title: type,
      pages: [1, 2, 3].map((number) => ({ title: `${type}-${number}`, width: 720, height: 520, rows: [] })),
    }
  }
  runtime.report.buildScheduleReportPages = runtime.buildReports
}

function completeReportWithPaths(runtime, paths) {
  let exportIndex = 0
  while (runtime.drawCallbacks.length || runtime.canvasExports.length) {
    if (runtime.drawCallbacks.length) runtime.drawCallbacks.shift()()
    if (runtime.canvasExports.length) {
      const exportOptions = runtime.canvasExports.shift()
      exportOptions.success({ tempFilePath: paths[exportIndex] || `page-${exportIndex + 1}.png` })
      exportIndex += 1
    }
  }
  assert.equal(exportIndex, paths.length, 'the report should finish all requested pages')
}

function useDeferredPhotoSave(runtime) {
  runtime.photoSaveRequests = []
  runtime.wx.saveImageToPhotosAlbum = (options) => {
    runtime.saves.push(options)
    runtime.photoSaveRequests.push(options)
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
  assert.equal(activePage.projectId, '', 'tool entry without an id requires an explicit project choice')
  assert.equal(activePage.data.selectionRequired, true)
  assert.equal(activePage.data.projectPickerVisible, true)
  assert.deepEqual(activeRuntime.readIds, [], 'a legacy active-project key does not trigger an implicit wiring read')

  const explicitRuntime = createRuntime()
  explicitRuntime.activeProjectId = 'project-B'
  const explicitPage = installPage(explicitRuntime, { id: 'project-A' })
  assert.equal(explicitPage.projectId, 'project-A', 'an explicit URL id opens its selected project')
  assert.deepEqual(explicitRuntime.readIds, ['project-A'])
  assert.equal(explicitRuntime.activeProjectId, 'project-B', 'explicit project entry leaves the legacy key untouched')

  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  page.openProjectPicker()
  assert.equal(page.data.projectPickerVisible, true)
  page.onProjectWheelChange({ detail: { value: [1] } })
  assert.equal(page.data.pendingProjectId, 'project-B')
  assert.equal(page.projectId, 'project-A', 'moving the project wheel does not enter its candidate')
  page.cancelProjectPicker()
  assert.equal(page.data.project.id, 'project-A', 'cancelling a switch should retain the current project content')
  assert.equal(page.data.lineCount, 1)

  runtime.activeProjectId = 'project-A'
  page.onSearchInput({ detail: { value: 'MAIN L' } })
  assert(page._searchTimer)
  page.openProjectPicker()
  page.selectProject({ currentTarget: { dataset: { id: 'project-B' } } })
  assert.equal(page.projectId, 'project-A', 'wheel selection is pending until Done')
  assert.equal(page.data.pendingProjectId, 'project-B')
  page.confirmProjectPicker()
  assert.equal(page.projectId, 'project-B')
  assert.equal(page.data.project.id, 'project-B')
  assert.equal(page.data.lineCount, 0, 'switching clears old project lines from the page')
  assert.equal(page.data.searchText, '', 'switching clears the previous project search')
  assert.equal(page._searchTimer, null, 'switching cancels the previous project search timer')
  assert.equal(runtime.activeProjectId, 'project-A', 'selecting a project leaves the legacy key untouched')
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
  const clock = installControlledTimers()
  try {
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
  clock.advanceBy(240)
  page.requestProjectPicker()
  assert.equal(page.data.projectPickerVisible, true)
  page.cancelProjectPicker()
  clock.advanceBy(240)

  const withProject = createRuntime()
  const editingPage = installPage(withProject)
  editingPage.openNewLine()
  pairInput(editingPage, 0, 'fromPort', '保留草稿')
  editingPage.requestProjectPicker()
  const rejectSwitch = withProject.modals.at(-1)
  rejectSwitch.success({ confirm: false })
  assert.equal(editingPage.data.editorVisible, true, 'declining the switch prompt should keep the editor open')
  assert.equal(editingPage.data.draftPairs[0].fromPort, '保留草稿')
  assert.equal(editingPage.data.projectPickerVisible, false)
  editingPage.requestProjectPicker()
  const approveSwitch = withProject.modals.at(-1)
  approveSwitch.success({ confirm: true })
  assert.equal(editingPage.data.editorVisible, false)
  assert.equal(editingPage.data.workspaceOverlayPhases.lineEditor, 'closing', 'discard closes the editor immediately and retains its exit phase')
  assert.equal(editingPage.data.projectPickerVisible, false, 'the next picker waits until the editor exit finishes')
  clock.advanceBy(239)
  assert.equal(editingPage.data.projectPickerVisible, false, 'the picker must not overlap the editor closing transition')
  clock.advanceBy(1)
  assert.equal(editingPage.data.projectPickerVisible, true)
  clock.advanceBy(0)
  assert.equal(editingPage.data.workspaceOverlayPhases.projectPicker, 'opening', 'the picker enters after the editor close timer completes')
  editingPage.cancelProjectPicker()
  assert.equal(editingPage.projectId, 'project-A', 'cancel after confirmed discard keeps the same project selected')
  clock.advanceBy(240)

  const createRuntimeFailure = createRuntime()
  createRuntimeFailure.activeProjectId = ''
  createRuntimeFailure.failCreateProject = true
  const failedCreatePage = installPage(createRuntimeFailure, {})
  failedCreatePage.requestNewProject()
  clock.advanceBy(240)
  failedCreatePage.onProjectNameInput({ detail: { value: '新现场' } })
  failedCreatePage.createAndOpenProject()
  assert.equal(failedCreatePage.data.newProjectVisible, true)
  assert.equal(failedCreatePage.data.projectPickerError, '创建项目失败，请重试。')
  assert.equal(failedCreatePage.projectId, '')

  const listFailureRuntime = createRuntime()
  listFailureRuntime.records.getProjects = () => { throw new Error('read failed') }
  const listFailurePage = installPage(listFailureRuntime)
  listFailurePage.openProjectPicker()
  assert.match(listFailurePage.data.projectPickerError, /读取项目列表失败/)
  } finally {
    clock.restore()
  }
}

function testCreateProjectEntersCreatedProject() {
  const clock = installControlledTimers()
  try {
  const runtime = createRuntime()
  runtime.activeProjectId = ''
  const page = installPage(runtime, {})
  page.requestNewProject()
  clock.advanceBy(240)
  page.onProjectNameInput({ detail: { value: '新录音棚' } })
  page.createAndOpenProject()
  assert.deepEqual(runtime.createProjectCalls, ['新录音棚'])
  assert.equal(runtime.activeProjectId, '', 'creating a project to open it does not write the legacy key')
  assert.equal(page.projectId, 'project-C1')
  assert.equal(page.data.project.id, 'project-C1')
  assert.equal(page.data.project.name, '新录音棚')
  page.openNewLine()
  ;['fromDevice', 'fromPort', 'toDevice', 'toPort'].forEach((field, index) => {
    input(page, field, ['调音台', 'OUT', '功放', 'IN'][index])
  })
  page.saveLine()
  assert.equal(runtime.saveCalls.at(-1).projectId, 'project-C1')
  } finally {
    clock.restore()
  }
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
  page.confirmProjectPicker()
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
  assert.match(page.data.formError, /请选择两端设备.*每条线路.*端口/)
  assert.deepEqual(page.data.formFieldErrors, {
    fromDevice: '请选择设备',
    toDevice: '请选择设备',
  })
  assert.deepEqual(page.data.pairErrors, [{ fromPort: true, toPort: true }])
  ;['fromDevice', 'fromPort', 'toDevice', 'toPort'].forEach((field, index) => {
    input(page, field, ['调音台', 'MAIN L', '功放', 'INPUT 1'][index])
  })
  page.saveLine()
  assert.equal(runtime.schedule.lines.length, 1)
  assert.equal(runtime.schedule.lines[0].code, 'A001')
  assert.equal(runtime.schedule.lines[0].lengthText, '', 'empty length must remain unknown, not zero')
  assert.equal(runtime.schedule.lines[0].status, 'pending')
  assert.equal(runtime.schedule.lines[0].connectorA, '')
  assert.equal(runtime.schedule.lines[0].connectorB, '')
  assert.equal(runtime.schedule.lines[0].spec, '', 'new cable data remains blank until entered')

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

function testRequiredEndpointErrorsAndHistoryClear() {
  for (const missingField of ['fromDevice', 'fromPort', 'toDevice', 'toPort']) {
    const runtime = createRuntime()
    const page = installPage(runtime)
    addDevice(page, '来源调音台1', 'mixer')
    addDevice(page, '目标功放1', 'amplifier')
    const writesBefore = runtime.saveCalls.length
    page.openNewLine()
    if (missingField !== 'fromDevice') chooseEndpoint(page, 'from', '来源调音台1')
    if (missingField !== 'toDevice') chooseEndpoint(page, 'to', '目标功放1')
    if (missingField !== 'fromPort') pairInput(page, 0, 'fromPort', 'OUT 1')
    if (missingField !== 'toPort') pairInput(page, 0, 'toPort', 'IN 1')
    page.saveLine()
    if (missingField.endsWith('Device')) assert.equal(page.data.formFieldErrors[missingField], '请选择设备')
    else assert.equal(page.data.pairErrors[0][missingField], true)
    assert.equal(runtime.saveCalls.length, writesBefore, 'validation must not write partial lines')
    page.saveLine()
    assert.equal(runtime.saveCalls.length, writesBefore, 'repeated validation remains side effect free')
    if (missingField.endsWith('Device')) {
      chooseEndpoint(page, missingField === 'fromDevice' ? 'from' : 'to', missingField === 'fromDevice' ? '来源调音台1' : '目标功放1')
      assert.equal(page.data.formFieldErrors[missingField], undefined, 'selecting a device clears its missing-field state')
    } else {
      pairInput(page, 0, missingField, '已填写端口')
      assert.equal(page.data.pairErrors.some((error) => error.fromPort || error.toPort), false,
        'editing a port clears stale pair errors')
    }
    page.saveLine()
    assert.equal(runtime.schedule.lines.length, 1)
    assert.equal(runtime.saveCalls.length, writesBefore + 1)
  }
}

function testBatchDuplicateEndpointWarning() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  page.openNewLine()
  ;[['fromDevice', '调音台'], ['fromPort', 'OUT-1'], ['toDevice', '功放'], ['toPort', 'IN-1']]
    .forEach(([field, value]) => input(page, field, value))
  page.saveLine()
  page.openBatch()
  input(page, 'count', '1', 'onBatchInput')
  input(page, 'fromPrefix', 'OUT-', 'onBatchInput')
  input(page, 'toPrefix', 'IN-', 'onBatchInput')
  page.refreshBatchPreview()
  assert.equal(page.data.batchPossibleDuplicates.length, 1)
  assert.deepEqual(page.data.batchPossibleDuplicates[0].existingCodes, ['A001'])
  assert.match(page.data.batchDuplicateWarning, /两端与已有布线一致.*可继续添加/)
  assert.equal(page.data.batchPreviewLines[0].possibleDuplicateCodes, 'A001')
  page.commitBatch()
  assert.equal(runtime.schedule.lines.length, 2, 'potential duplicates remain allowed by the existing save rules')

  page.openBatch()
  input(page, 'count', '1', 'onBatchInput')
  input(page, 'fromPrefix', 'AUX-', 'onBatchInput')
  page.refreshBatchPreview()
  assert.equal(page.data.batchDuplicateWarning, '')
  input(page, 'fromPrefix', 'OUT-', 'onBatchInput')
  assert.equal(page.data.batchPreviewLines.length, 0)
  assert.deepEqual(page.data.batchPossibleDuplicates, [], 'changing a batch field must clear stale duplicate warnings')
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
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  const savedLine = runtime.schedule.lines[0]
  assert.equal(savedLine.spec, '', 'untouched new lines never infer a cable specification')
  assert.equal(savedLine.connectorA, '')
  assert.equal(savedLine.connectorB, '')
  page.openNewLine()
  assert.equal(page.data.draft.spec, '')
  assert.equal(page.data.draft.connectorA, '')
  assert.equal(page.data.draft.connectorB, '')
  page.chooseSpecPreset({ currentTarget: { dataset: { value: 'unlisted cable value' } } })
  assert.equal(page.data.draft.spec, '')
  selectOption(page, 'cableType', page.data.cableOptions, 'speaker')
  const speakerSpecs = ['RVV 2×1.5 mm²', 'RVV 2×2.5 mm²']
  assert.deepEqual(page.data.specOptions, speakerSpecs, 'legacy preset API remains available')
  page.chooseSpecPreset({ currentTarget: { dataset: { value: speakerSpecs[0] } } })
  assert.equal(page.data.draft.spec, speakerSpecs[0])
  selectOption(page, 'cableType', page.data.cableOptions, 'custom')
  assert.equal(page.data.draft.spec, speakerSpecs[0], 'explicit user specifications survive type changes')
  input(page, 'spec', '')
  selectOption(page, 'cableType', page.data.cableOptions, 'balanced')
  assert.equal(page.data.draft.spec, '', 'cleared specs never regain a default')
  page.closeEditor()

  const historicalSpec = '历史自定义采购规格'
  page.editLine({ currentTarget: { dataset: { id: savedLine.id } } })
  input(page, 'spec', historicalSpec)
  page.saveLine()
  page.editLine({ currentTarget: { dataset: { id: savedLine.id } } })
  assert.equal(page.data.draft.spec, historicalSpec)
  input(page, 'spec', '未保存的替代规格')
  page.requestCloseEditor()
  runtime.modals.at(-1).success({ confirm: false })
  assert.equal(page.data.editorVisible, true)
  assert.equal(page.data.draft.spec, '未保存的替代规格')
  page.requestCloseEditor()
  runtime.modals.at(-1).success({ confirm: true })
  assert.equal(runtime.schedule.lines[0].spec, historicalSpec, 'cancel leaves the persisted specification unchanged')
  page.editLine({ currentTarget: { dataset: { id: savedLine.id } } })
  page.duplicateLine()
  assert.equal(page.data.draft.spec, historicalSpec, 'legacy copy API preserves historical data')
  page.saveLine()
  assert.equal(runtime.schedule.lines[1].spec, historicalSpec)
  assert(projectWiring.buildScheduleText(runtime.project.name, runtime.schedule).includes(historicalSpec))
  const report = reportBuilder.buildScheduleReportPages(runtime.project.name, runtime.schedule, 'lines')
  assert(report.pages.flatMap((value) => value.rows).some((row) => row.textLines.some((line) => line.includes(historicalSpec))))
  for (const legacySpec of ['', 'RVPE 2×0.3 mm²', historicalSpec]) {
    page._schedule.lines.find((line) => line.id === savedLine.id).spec = legacySpec
    page.editLine({ currentTarget: { dataset: { id: savedLine.id } } })
    assert.equal(page.data.draft.spec, legacySpec)
    page.closeEditor()
  }

  // The old prefix batch API remains compatible independently of the replaced UI.
  page.openBatch()
  input(page, 'spec', '批量手工规格', 'onBatchInput')
  page.onBatchCableChange({ detail: { value: String(page.data.cableOptions.findIndex((item) => item.id === 'speaker')) } })
  assert.equal(page.data.batchDraft.spec, '批量手工规格')
  input(page, 'spec', '', 'onBatchInput')
  page.onBatchCableChange({ detail: { value: '0' } })
  assert.equal(page.data.batchDraft.spec, '')
  page.closeBatch()
}

function testDevicePickersContinuousDraftAndAtomicSave() {
  const clock = installControlledTimers()
  try {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addDevice(page, '同名设备', 'mixer', '2')
  addDevice(page, '功放1', 'amplifier')
  const devices = page._schedule.devices
  assert.notEqual(devices[0].id, devices[1].id)
  assert.equal(page.data.devices.length, 3)
  page.connectDevice({ currentTarget: { dataset: {
    id: devices[1].id, projectId: page.projectId, revision: page._schedule.revision,
  } } })
  assert.equal(page.data.draft.fromDeviceId, devices[1].id)
  chooseEndpoint(page, 'to', '功放1')
  const before = clone(runtime.schedule)
  const savesBefore = runtime.saveCalls.length
  page.openContinuous()
  ;[['fromPort', 'OUT09'], ['toPort', 'IN09'], ['count', '3']]
    .forEach(([field, value]) => input(page, field, value, 'onContinuousInput'))
  assert.deepEqual(page.data.continuousPairs.map((pair) => pair.fromPort), ['OUT09', 'OUT10', 'OUT11'])
  page.fillContinuous()
  assert.deepEqual(runtime.schedule, before)
  assert.equal(runtime.saveCalls.length, savesBefore, 'Fill changes only the parent draft')
  assert.equal(page.data.continuousVisible, false)
  assert.equal(page.data.draftPairs.length, 3)
  pairInput(page, 1, 'toPort', '手工端口')
  input(page, 'lengthText', '5')
  input(page, 'spec', '用户规格')
  pairInput(page, 2, 'lengthText', '0')
  page.saveLine()
  assert.match(page.data.formError, /长度/)
  assert.deepEqual(runtime.schedule, before, 'one invalid pair rejects the complete append')
  assert.equal(runtime.saveCalls.length, savesBefore)
  pairInput(page, 2, 'lengthText', '5')
  runtime.failNextSave = true
  const draftBeforeFailure = clone(page.data.draftPairs)
  page.saveLine()
  assert.equal(page.data.editorVisible, true)
  assert.deepEqual(page.data.draftPairs, draftBeforeFailure)
  assert.deepEqual(runtime.schedule, before)
  assert.equal(page.data.saveError, '模拟存储失败')
  page.saveLine()
  assert.equal(runtime.schedule.lines.length, 3)
  assert.equal(runtime.schedule.revision, before.revision + 1)
  assert.equal(runtime.saveCalls.at(-1).command.type, 'append-lines')
  assert.equal(page.data.editorVisible, false, 'successful save closes the editor immediately')
  clock.advanceBy(240)
  assert.deepEqual(runtime.schedule.lines.map((line) => line.code), ['A001', 'A002', 'A003'])
  assert.equal(runtime.schedule.lines[1].toPort, '手工端口')
  assert(runtime.schedule.lines.every((line) => line.fromDeviceId === devices[1].id))
  assert(runtime.schedule.lines.every((line) => line.spec === '用户规格' && line.connectorA === '' && line.connectorB === ''))
  const savedCount = runtime.saveCalls.length
  page.saveLine()
  assert.equal(runtime.saveCalls.length, savedCount, 'repeated Save after success does not append again')
  page.editLine({ currentTarget: { dataset: { id: runtime.schedule.lines[0].id } } })
  page.addDraftPair()
  page.openContinuous()
  assert.equal(page.data.draftPairs.length, 1, 'single-line editing has no batch behavior')
  assert.equal(page.data.continuousVisible, false)
  page.closeEditor()
  } finally {
    clock.restore()
  }
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

function testCopyCurrentTextUsesUnfilteredSchedule() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  page.openNewLine()
  ;[['purpose', '返送线路'], ['fromDevice', 'DSP'], ['fromPort', 'OUT 2'],
    ['toDevice', '舞台音箱'], ['toPort', 'IN 2']].forEach(([field, value]) => input(page, field, value))
  page.saveLine()
  assert.equal(page._schedule.lines.length, 2)

  page.applySearch({ detail: { value: 'A001' } })
  assert.deepEqual(page.data.visibleLines.map((line) => line.code), ['A001'], 'search should show only the matching line')
  page.selectExportType({ detail: { value: '1' } })
  assert.equal(page.data.exportTypeIndex, 1, 'the material report remains selectable from the export picker')
  assert.deepEqual(runtime.reportTypes, [], 'search and selecting a report type should not generate a report')
  page.copyCurrentText()

  const copiedText = runtime.clipboard.at(-1).data
  assert.equal(copiedText, projectWiring.buildScheduleText(runtime.project.name, page._schedule),
    'copy should use the same full-project text builder regardless of search/export selection')
  assert.match(copiedText, /A001/)
  assert.match(copiedText, /A002/, 'the copied text includes the line hidden by search')
  assert.match(copiedText, /材料汇总：/)
  const template = fs.readFileSync(path.join(__dirname, '../pages/project-wiring/index.wxml'), 'utf8')
  assert.doesNotMatch(template, /bindtap="copyCurrentText"/,
    'legacy copy API remains compatible without reintroducing a removed UI action')
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
  page.previewReportImage()
  assert.deepEqual(runtime.previews.at(-1), {
    current: 'lines-2.png',
    urls: ['lines-1.png', 'lines-2.png'],
  }, 'image preview should include every page of the current report')
  page.saveReportImage()
  page.shareReportImage()
  assert.equal(runtime.saves.at(-1).filePath, 'lines-2.png')
  assert.equal(runtime.shares.at(-1).path, 'lines-2.png')
  page.closeReportPreview()

  page.selectExportType({ detail: { value: '1' } })
  page.generateExport({ type: 'tap' })
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

function testSharedProjectExportAcrossTabs() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  page.openNewLine()
  ;[['fromDevice', 'DSP'], ['fromPort', 'OUT 2'], ['toDevice', '舞台音箱'], ['toPort', 'IN 2']]
    .forEach(([field, value]) => input(page, field, value))
  page.saveLine()
  page.applySearch({ detail: { value: 'A001' } })
  assert.equal(page.data.visibleLines.length, 1)
  const reportInputs = []
  runtime.report.buildScheduleReportPages = (name, schedule, type) => {
    reportInputs.push({ name, schedule: clone(schedule), type })
    return runtime.buildReports(name, schedule, type)
  }
  page.onWorkspaceTab({ currentTarget: { dataset: { tab: 'devices' } } })
  page.shareProject()
  completeAllExports(runtime, 'shared-project')
  assert.equal(reportInputs.length, 1)
  assert.equal(reportInputs[0].type, 'project')
  assert.deepEqual(reportInputs[0].schedule, runtime.schedule, 'Share includes the complete project despite search')
  const images = clone(page.data.reportImages)
  page.closeReportPreview()
  page.onWorkspaceTab({ currentTarget: { dataset: { tab: 'lines' } } })
  page.shareProject()
  assert.equal(reportInputs.length, 1, 'both tabs use the same project image cache')
  assert.deepEqual(page.data.reportImages, images)
  assert.equal(page.data.reportPreviewVisible, true)
}

function generateThreePageReport(page, runtime, paths) {
  setThreePageReport(runtime)
  page.generateExport('lines')
  completeReportWithPaths(runtime, paths)
  assert.equal(page.data.reportImages.length, 3)
}

function testSaveAllSerialFailureAndResume() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  generateThreePageReport(page, runtime, ['page-1.png', 'page-2.png', 'page-3.png'])
  useDeferredPhotoSave(runtime)

  page.saveAllReportImages()
  assert.deepEqual(runtime.photoSaveRequests.map((request) => request.filePath), ['page-1.png'])
  runtime.photoSaveRequests[0].success()
  assert.deepEqual(runtime.photoSaveRequests.map((request) => request.filePath), ['page-1.png', 'page-2.png'],
    'the save job must await page one before sending page two')
  runtime.photoSaveRequests[1].fail({ errMsg: 'saveImageToPhotosAlbum:fail disk full' })
  assert.deepEqual(runtime.photoSaveRequests.map((request) => request.filePath), ['page-1.png', 'page-2.png'],
    'a page failure must stop the queue before page three')
  assert.deepEqual(page.data.reportSavedPageIndices, [0], 'only the successful first page should be retained')
  assert.match(page.data.reportSaveError, /保存失败/)

  page.saveAllReportImages()
  assert.equal(runtime.photoSaveRequests.at(-1).filePath, 'page-2.png', 'resume should skip the previously successful page')
  runtime.photoSaveRequests[2].success()
  assert.equal(runtime.photoSaveRequests.at(-1).filePath, 'page-3.png')
  runtime.photoSaveRequests[3].success()
  assert.deepEqual(runtime.photoSaveRequests.map((request) => request.filePath), [
    'page-1.png', 'page-2.png', 'page-2.png', 'page-3.png',
  ])
  assert.deepEqual(page.data.reportSavedPageIndices, [0, 1, 2])
  assert.equal(page.data.reportSaveAllLabel, '全部已保存3张')
  assert.equal(page.data.reportSaveRunning, false)
}

function testSaveJobsTrackPageIndicesNotPaths() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  generateThreePageReport(page, runtime, ['same-mock.png', 'same-mock.png', 'same-mock.png'])
  useDeferredPhotoSave(runtime)
  page.saveAllReportImages()
  runtime.photoSaveRequests[0].success()
  runtime.photoSaveRequests[1].success()
  runtime.photoSaveRequests[2].success()
  assert.equal(runtime.photoSaveRequests.length, 3, 'identical mock paths still represent three report pages')
  assert.deepEqual(page.data.reportSavedPageIndices, [0, 1, 2])

  const cachedSignature = page._reportSignature
  page.closeReportPreview()
  page.generateExport('lines')
  assert.equal(page._reportSignature, cachedSignature)
  assert.deepEqual(page.data.reportSavedPageIndices, [0, 1, 2], 'reopening the same report should retain saved page indices')
  page.saveAllReportImages()
  assert.equal(runtime.photoSaveRequests.length, 3, 'an already saved cached report should not be saved again')
}

function testSingleSaveSharesJobAndPermissionHandling() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  generateThreePageReport(page, runtime, ['page-1.png', 'page-2.png', 'page-3.png'])
  useDeferredPhotoSave(runtime)
  page.nextReportPage()
  page.saveReportImage()
  assert.deepEqual(runtime.photoSaveRequests.map((request) => request.filePath), ['page-2.png'])
  runtime.photoSaveRequests[0].success()
  assert.deepEqual(page.data.reportSavedPageIndices, [1], 'single-page save should update the same saved-index set')
  page.saveAllReportImages()
  assert.deepEqual(runtime.photoSaveRequests.slice(1).map((request) => request.filePath), ['page-1.png'])
  runtime.photoSaveRequests[1].success()
  assert.equal(runtime.photoSaveRequests.at(-1).filePath, 'page-3.png')
  runtime.photoSaveRequests[2].success()
  assert.deepEqual(page.data.reportSavedPageIndices, [0, 1, 2])

  const permissionRuntime = createRuntime()
  const permissionPage = installPage(permissionRuntime)
  addFirstLine(permissionPage)
  generateThreePageReport(permissionPage, permissionRuntime, ['permission-1.png', 'permission-2.png', 'permission-3.png'])
  useDeferredPhotoSave(permissionRuntime)
  let openSettingCalls = 0
  permissionRuntime.wx.openSetting = () => { openSettingCalls += 1 }
  permissionPage.saveAllReportImages()
  permissionRuntime.photoSaveRequests[0].fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
  assert.match(permissionPage.data.reportSaveError, /微信设置/)
  assert.equal(openSettingCalls, 0, 'permission recovery must require the user to visit settings')
  permissionPage.saveAllReportImages()
  assert.equal(permissionRuntime.photoSaveRequests.at(-1).filePath, 'permission-1.png', 'failed permission pages remain retryable')
  permissionRuntime.photoSaveRequests.at(-1).fail({ errMsg: 'saveImageToPhotosAlbum:fail cancel' })
  assert.match(permissionPage.data.reportSaveError, /已取消/)
  assert.deepEqual(permissionPage.data.reportSavedPageIndices, [])
}

function testSaveJobGuardsAndLateCallbacks() {
  ;['stop', 'hide', 'close', 'unload'].forEach((action) => {
    const runtime = createRuntime()
    const page = installPage(runtime)
    addFirstLine(page)
    generateThreePageReport(page, runtime, [`${action}-1.png`, `${action}-2.png`, `${action}-3.png`])
    useDeferredPhotoSave(runtime)
    page.saveAllReportImages()
    assert.equal(runtime.photoSaveRequests.length, 1)
    page.saveReportImage()
    page.saveAllReportImages()
    assert.equal(runtime.photoSaveRequests.length, 1, 'double taps and single/all requests must share one in-flight guard')
    if (action === 'stop') page.stopReportSaveJob()
    if (action === 'hide') page.onHide()
    if (action === 'close') page.closeReportPreview()
    if (action === 'unload') page.onUnload()
    const mutationsBeforeLateResult = page.mutationCount
    runtime.photoSaveRequests[0].success()
    assert.equal(page.mutationCount, mutationsBeforeLateResult, `${action} should invalidate state updates from late saves`)
    assert.equal(runtime.photoSaveRequests.length, 1, `${action} should prevent late callbacks from starting more pages`)
    assert.equal(page._reportSaveInFlight, null, 'terminal callbacks should release the private in-flight lock')
  })

  const noApiRuntime = createRuntime()
  const noApiPage = installPage(noApiRuntime)
  addFirstLine(noApiPage)
  generateThreePageReport(noApiPage, noApiRuntime, ['no-api-1.png', 'no-api-2.png', 'no-api-3.png'])
  delete noApiRuntime.wx.saveImageToPhotosAlbum
  noApiPage.saveAllReportImages()
  assert.match(noApiPage.data.reportSaveError, /不支持保存图片/)
  assert.equal(noApiPage.data.reportSaveRunning, false)

  const emptyFailureRuntime = createRuntime()
  const emptyFailurePage = installPage(emptyFailureRuntime)
  addFirstLine(emptyFailurePage)
  generateThreePageReport(emptyFailurePage, emptyFailureRuntime, ['fail-1.png', 'fail-2.png', 'fail-3.png'])
  useDeferredPhotoSave(emptyFailureRuntime)
  emptyFailurePage.saveAllReportImages()
  emptyFailureRuntime.photoSaveRequests[0].fail()
  assert.equal(emptyFailureRuntime.photoSaveRequests.length, 1, 'an empty failure callback must stop the queue')
  assert.deepEqual(emptyFailurePage.data.reportSavedPageIndices, [], 'an empty failure callback must not count as success')
  assert.match(emptyFailurePage.data.reportSaveError, /保存失败/)
}

function testLateSaveIdentityAndClosedPreviewResume() {
  const runtime = createRuntime()
  const page = installPage(runtime)
  addFirstLine(page)
  generateThreePageReport(page, runtime, ['old-1.png', 'old-2.png', 'old-3.png'])
  useDeferredPhotoSave(runtime)
  const originalSignature = page._reportSignature
  page.saveAllReportImages()
  const staleRequest = runtime.photoSaveRequests[0]
  page.invalidateExport(true)
  generateThreePageReport(page, runtime, ['new-1.png', 'new-2.png', 'new-3.png'])
  assert.equal(page._reportSignature, originalSignature, 'the regenerated report deliberately has the same logical signature')
  const mutationsBeforeOldCallback = page.mutationCount
  staleRequest.success()
  assert.equal(page.mutationCount, mutationsBeforeOldCallback, 'an old generation callback must not mutate the regenerated report')
  assert.deepEqual(page.data.reportSavedPageIndices, [], 'old success must not mark a page in the new generation')
  assert.deepEqual([...page._reportSavedPages.get(originalSignature)], [], 'saved indices must remain bound to the exact Map Set generation')
  page.saveReportImage()
  assert.equal(runtime.photoSaveRequests.at(-1).filePath, 'new-1.png', 'a released stale callback must allow a new single-page save')
  runtime.photoSaveRequests.at(-1).success()

  const closeRuntime = createRuntime()
  const closePage = installPage(closeRuntime)
  addFirstLine(closePage)
  generateThreePageReport(closePage, closeRuntime, ['cached-1.png', 'cached-2.png', 'cached-3.png'])
  useDeferredPhotoSave(closeRuntime)
  closePage.saveAllReportImages()
  const closeRequest = closeRuntime.photoSaveRequests[0]
  closePage.closeReportPreview()
  assert.match(closePage.data.reportSaveMessage, /已停止后续请求/)
  closePage.generateExport('lines')
  assert.equal(closePage.data.reportPreviewVisible, true, 'the same cached report should reopen')
  assert.match(closePage.data.reportSaveMessage, /已停止后续请求/, 'a reopened report with a pending request must explain that later pages were stopped')
  assert.doesNotMatch(closePage.data.reportSaveMessage, /正在保存第/)
  closePage.saveReportImage()
  assert.equal(closeRuntime.photoSaveRequests.length, 1, 'an old in-flight request still prevents overlap')
  assert.match(closePage.data.reportSaveMessage, /已停止后续请求/, 'a blocked action must keep the stopped-queue status clear')
  const mutationsBeforeCachedLateSuccess = closePage.mutationCount
  closeRequest.success()
  assert.equal(closePage.mutationCount, mutationsBeforeCachedLateSuccess, 'a late success after close/reopen must not write page state')
  assert.deepEqual(closePage.data.reportSavedPageIndices, [], 'late UI updates remain suppressed after reopen')
  closePage.generateExport('lines')
  assert.deepEqual(closePage.data.reportSavedPageIndices, [0], 'reopening the cache after the old request succeeds should sync its private saved index')
  assert.match(closePage.data.reportSaveMessage, /已保存 1 \/ 3 张/)
  assert.doesNotMatch(closePage.data.reportSaveMessage, /正在保存第|仍可能完成/)
  closePage.saveReportImage()
  assert.equal(closeRuntime.photoSaveRequests.length, 2, 'single-page action should become usable after the stale callback releases the lock')
  assert.equal(closeRuntime.photoSaveRequests[1].filePath, 'cached-1.png')
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

  page.selectExportType({ detail: { value: '1' } })
  page.generateExport({ type: 'tap' })
  assert.equal(runtime.reportTypes.at(-1), 'materials', 'the selected material report remains reachable through the export picker')
  completeAllExports(runtime, 'material-picker')
}

try {
  testFixedProjectReadAndErrors()
  testProjectEntrySwitchAndOwnership()
  testNoProjectCancelDirtyGuardAndCreateFailure()
  testCreateProjectEntersCreatedProject()
  testProjectPickerCancelsLateExport()
  testLateLoadFromPreviousProjectIsIgnored()
  testCompactHistoryPickerBehavior()
  testEndpointHistoryPickerTemplateBindings()
  testAddSearchAndSaveFailure()
  testRequiredEndpointErrorsAndHistoryClear()
  testCustomConnectorAndCableDefaults()
  testSpecPresetsAndPreservation()
  testDevicePickersContinuousDraftAndAtomicSave()
  testCopyCurrentTextUsesUnfilteredSchedule()
  testBatchDuplicateDeleteAndStableNumbers()
  testBatchDuplicateEndpointWarning()
  testPagedExportActionsAndLateCallbacks()
  testSharedProjectExportAcrossTabs()
  testSaveAllSerialFailureAndResume()
  testSaveJobsTrackPageIndicesNotPaths()
  testSingleSaveSharesJobAndPermissionHandling()
  testSaveJobGuardsAndLateCallbacks()
  testLateSaveIdentityAndClosedPreviewResume()
  testExportTypeWithTapEvent()
  console.log('project wiring page tests passed (fixed ownership, wheel Cancel/Done, device pickers, paired ports, blank cable data, draft-only continuous fill, atomic save and retry, stable IDs/codes, legacy API compatibility, shared project export and report lifecycle guards)')
} finally {
  if (oldPage === undefined) delete global.Page
  else global.Page = oldPage
  if (oldWx === undefined) delete global.wx
  else global.wx = oldWx
  delete require.cache[pageModulePath]
  delete require.cache[reportModulePath]
  delete require.cache[workspaceModulePath]
  if (oldPageModule) require.cache[pageModulePath] = oldPageModule
  if (oldRecordsModule) require.cache[recordsModulePath] = oldRecordsModule
  else delete require.cache[recordsModulePath]
  if (oldReportModule) require.cache[reportModulePath] = oldReportModule
  if (oldWorkspaceModule) require.cache[workspaceModulePath] = oldWorkspaceModule
}

require('./project-wiring-keyboard-test')

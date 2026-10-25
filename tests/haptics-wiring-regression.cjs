const assert = require('node:assert/strict')

const runtime = {
  vibrations: [],
  clipboardRequests: [],
  saveRequests: [],
  modal: null,
}

global.wx = {
  vibrateShort: ({ type }) => runtime.vibrations.push(type),
  setClipboardData: (options) => runtime.clipboardRequests.push(options),
  saveImageToPhotosAlbum: (options) => runtime.saveRequests.push(options),
  showToast() {},
  showModal: (options) => { runtime.modal = options },
  setStorageSync() {},
  hideLoading() {},
}

function loadPage(relativePath) {
  const resolved = require.resolve(relativePath)
  delete require.cache[resolved]
  const previousPage = global.Page
  let definition
  global.Page = (value) => { definition = value }
  require(resolved)
  global.Page = previousPage
  assert(definition, `${relativePath} registers a page definition`)
  return definition
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createPage(definition, values = {}) {
  const page = Object.create(definition)
  page.data = clone(definition.data)
  Object.assign(page, values)
  page.setData = (patch, callback) => {
    Object.entries(patch || {}).forEach(([key, value]) => {
      if (!key.includes('.')) {
        page.data[key] = value
        return
      }
      const parts = key.split('.')
      let target = page.data
      parts.slice(0, -1).forEach((part) => {
        if (!target[part]) target[part] = {}
        target = target[part]
      })
      target[parts[parts.length - 1]] = value
    })
    if (callback) callback()
  }
  return page
}

function resetRuntime() {
  runtime.vibrations.length = 0
  runtime.clipboardRequests.length = 0
  runtime.saveRequests.length = 0
  runtime.modal = null
}

const audio = loadPage('../pages/audio-wiring/index.js')
const project = loadPage('../pages/project-wiring/index.js')
const protocol = loadPage('../pages/control-protocol/detail.js')
const knowledge = loadPage('../pages/knowledge/detail.js')
const troubleshoot = loadPage('../pages/troubleshoot/index.js')

function testAudioModeAndCopyFeedback() {
  resetRuntime()
  const page = createPage(audio, { _pageVisible: true, _pageUnloaded: false })
  page.data.viewMode = 'wiring'
  page.invalidateWiringGeneration = () => {}
  page.invalidateDiagramRender = () => {}
  page.persistWiringPreferences = () => true
  page.syncPageFavorite = () => {}
  page.renderDiagram = () => {}

  page.selectViewMode({ currentTarget: { dataset: { mode: 'wiring' } } })
  assert.deepEqual(runtime.vibrations, [], 'reselecting the current diagram mode is silent')
  page.selectViewMode({ currentTarget: { dataset: { mode: 'connectors' } } })
  assert.deepEqual(runtime.vibrations, ['light'], 'changing the diagram mode gives light feedback')

  const { getWiringModel } = require('../pages/audio-wiring/wiring-model')
  page.data.model = getWiringModel('xlrBalanced', 'terminalBalanced')
  let current = true
  page._wiringLifecycle = { currentToken: () => 1, isCurrent: () => current }
  page.copyConnection()
  assert.deepEqual(runtime.vibrations, ['light'], 'copy waits for the clipboard result')
  runtime.clipboardRequests.at(-1).fail()
  assert.deepEqual(runtime.vibrations, ['light'], 'clipboard failure is silent')

  page.copyConnection()
  runtime.clipboardRequests.at(-1).success()
  assert.deepEqual(runtime.vibrations, ['light', 'medium'], 'successful copy gives medium feedback')

  page.copyConnection()
  current = false
  runtime.clipboardRequests.at(-1).success()
  assert.deepEqual(runtime.vibrations, ['light', 'medium'], 'a stale copy completion is silent')
}

function testProjectDeletionAndBatchSaveFeedback() {
  resetRuntime()
  const makeDeletePage = () => {
    const page = createPage(project, {
      projectId: 'project-1',
      _schedule: { revision: 4, lines: [{ id: 'line-1' }] },
      _workspaceEditorDeleteToken: 0,
      _destroyed: false,
      _hidden: false,
    })
    page.data.project = { id: 'project-1' }
    page.data.draft = { id: 'line-1', code: 'A1' }
    page.data.draftIsNew = false
    page.data.editorVisible = true
    page.captureWorkspaceEditorContext = () => ({ projectId: 'project-1', revision: 4, lineId: 'line-1' })
    page.isWorkspaceEditorContextCurrent = () => true
    page.closeEditor = () => { page.data.editorVisible = false }
    page.acceptSavedSchedule = () => {}
    page.saveCommand = (command, onSuccess) => onSuccess({ ok: true })
    return page
  }

  const cancelled = makeDeletePage()
  cancelled.deleteLine()
  runtime.modal.success({ confirm: false })
  assert.deepEqual(runtime.vibrations, [], 'cancelled deletion is silent')

  const deleted = makeDeletePage()
  deleted.deleteLine()
  runtime.modal.success({ confirm: true })
  assert.deepEqual(runtime.vibrations, ['medium'], 'confirmed, successful deletion gives medium feedback')

  const makeReportPage = () => {
    const page = createPage(project, {
      _reportSignature: 'signature-1',
      _reportRevision: 7,
      _reportSaveJobRevision: 0,
      _reportSaveInFlight: null,
      _reportSavedPages: new Map(),
      _destroyed: false,
      _hidden: false,
    })
    page.data.reportPreviewVisible = true
    page.data.reportImages = [{ path: '/one.png' }, { path: '/two.png' }]
    page.data.editorVisible = false
    page.data.batchVisible = false
    page.syncReportSaveView = () => {}
    return page
  }

  resetRuntime()
  const partial = makeReportPage()
  partial.startReportSaveJob([0, 1], 'all')
  runtime.saveRequests[0].success()
  assert.deepEqual(runtime.vibrations, [], 'a batch save does not buzz after only its first image')
  runtime.saveRequests[1].fail({ errMsg: 'cancelled by user' })
  assert.deepEqual(runtime.vibrations, [], 'a cancelled or partial batch save is silent')

  resetRuntime()
  const complete = makeReportPage()
  complete.startReportSaveJob([0, 1], 'all')
  runtime.saveRequests[0].success()
  assert.deepEqual(runtime.vibrations, [], 'batch feedback waits until every requested image succeeds')
  runtime.saveRequests[1].success()
  assert.deepEqual(runtime.vibrations, ['medium'], 'a fully successful batch gives one medium vibration')
}

function testProtocolSelectionAndClipboardLifecycle() {
  resetRuntime()
  const page = createPage(protocol, {
    _pageUnloaded: false,
    _pageHidden: false,
    _copyContextToken: 0,
    _copyAttempt: 0,
    _copyInFlight: 0,
  })
  page.refreshDirectory = () => {}
  page.showCopyFeedback = () => {}
  page.onCategoryTap({ currentTarget: { dataset: { key: 'all' } } })
  assert.deepEqual(runtime.vibrations, [], 'reselecting the current category is silent')
  page.onCategoryTap({ currentTarget: { dataset: { key: 'lighting' } } })
  assert.deepEqual(runtime.vibrations, ['light'], 'changing a directory category gives light feedback')
  page.onCategoryTap({ currentTarget: { dataset: { key: 'lighting' } } })
  assert.deepEqual(runtime.vibrations, ['light'], 'reselecting a directory category is silent')

  page.copyToClipboard('command')
  page.copyToClipboard('duplicate')
  assert.equal(runtime.clipboardRequests.length, 1, 'a second clipboard request is ignored while one is pending')
  runtime.clipboardRequests[0].fail()
  assert.deepEqual(runtime.vibrations, ['light'], 'clipboard failure or cancellation is silent')

  page.copyToClipboard('command')
  page._pageHidden = true
  runtime.clipboardRequests.at(-1).success()
  assert.deepEqual(runtime.vibrations, ['light'], 'success delivered while the page is hidden is silent')

  page.onShow()
  page.copyToClipboard('command')
  const stale = runtime.clipboardRequests.at(-1)
  page._copyContextToken += 1
  stale.success()
  assert.deepEqual(runtime.vibrations, ['light'], 'stale device copy completion is silent')

  page.copyToClipboard('command')
  runtime.clipboardRequests.at(-1).success()
  assert.deepEqual(runtime.vibrations, ['light', 'medium'], 'current successful command copy gives medium feedback')
}

function testKnowledgeAndTroubleshootChanges() {
  resetRuntime()
  const demoPage = createPage(knowledge, {
    destroyed: false,
    pageVisible: true,
    cardVisible: true,
    userPaused: false,
    resumeIntent: false,
  })
  demoPage.data.demo = { steps: [{ label: 'A' }, { label: 'B' }] }
  demoPage.data.demoIndex = 0
  demoPage.data.demoFrame = demoPage.data.demo.steps[0]
  demoPage.scheduleDemoStep = () => {}
  demoPage.selectDemoStep({ currentTarget: { dataset: { index: 1 } } })
  assert.deepEqual(runtime.vibrations, ['light'], 'choosing another demonstration step gives light feedback')
  demoPage.selectDemoStep({ currentTarget: { dataset: { index: 1 } } })
  assert.deepEqual(runtime.vibrations, ['light'], 'reselecting the same step is silent')
  demoPage.toggleDemoPlayback()
  assert.deepEqual(runtime.vibrations, ['light', 'light'], 'starting playback gives light feedback')
  demoPage.onHide()
  demoPage.onShow()
  assert.deepEqual(runtime.vibrations, ['light', 'light'], 'background pause and resume do not buzz')

  const flow = createPage(troubleshoot)
  flow.onLoad({ type: 'audio' })
  const staleAnswer = { currentTarget: { dataset: { node: flow.data.node, index: 0 } } }
  flow.answer(staleAnswer)
  assert.deepEqual(runtime.vibrations, ['light', 'light', 'light'], 'a valid troubleshooting choice gives light feedback')
  flow.answer(staleAnswer)
  assert.deepEqual(runtime.vibrations, ['light', 'light', 'light'], 'a repeated stale choice is silent')
  flow.restart()
  assert.deepEqual(runtime.vibrations, ['light', 'light', 'light', 'light'], 'restarting a changed flow gives light feedback')
  flow.restart()
  assert.deepEqual(runtime.vibrations, ['light', 'light', 'light', 'light'], 'restarting an unchanged flow is silent')
}

testAudioModeAndCopyFeedback()
testProjectDeletionAndBatchSaveFeedback()
testProtocolSelectionAndClipboardLifecycle()
testKnowledgeAndTroubleshootChanges()

console.log('haptics-wiring-regression: ok')

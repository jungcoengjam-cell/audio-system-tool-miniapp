'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

function createRuntime() {
  const previous = {
    Page: global.Page,
    wx: global.wx,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
  }
  const storage = new Map()
  const storageAccess = { reads: [], writes: [], removals: [] }
  const navigations = []
  let timerId = 0
  const wx = new Proxy({
    getStorageSync(key) {
      storageAccess.reads.push(String(key))
      return storage.get(key)
    },
    setStorageSync(key, value) {
      storageAccess.writes.push(String(key))
      storage.set(key, value)
    },
    removeStorageSync(key) {
      storageAccess.removals.push(String(key))
      storage.delete(key)
    },
    navigateTo(options) { navigations.push(options) },
    setClipboardData({ success }) { if (success) success() },
    showToast() {},
    showModal() {},
    vibrateShort() {},
    getSystemInfoSync() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 2 } },
  }, {
    get(target, key) { return key in target ? target[key] : () => {} },
  })
  global.wx = wx
  require('./helpers/offline-guard').registerWx(wx)
  global.setTimeout = () => ++timerId
  global.clearTimeout = () => {}

  function loadPage(relativePath) {
    let definition
    const previousPage = global.Page
    global.Page = (value) => { definition = value }
    const modulePath = path.resolve(__dirname, relativePath)
    delete require.cache[require.resolve(modulePath)]
    try {
      require(modulePath)
    } finally {
      if (previousPage === undefined) delete global.Page
      else global.Page = previousPage
    }
    assert(definition?.data, `${relativePath} registered a page definition`)
    return Object.assign({}, definition, {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(changes, callback) {
        for (const [key, value] of Object.entries(changes)) {
          const match = key.match(/^([^.[\]]+)\[(\d+)\]\.(.+)$/)
          if (match) {
            const [, list, index, field] = match
            this.data[list][Number(index)] = { ...this.data[list][Number(index)], [field]: value }
          } else {
            this.data[key] = value
          }
        }
        if (callback) callback()
      },
    })
  }

  return {
    storage,
    storageAccess,
    navigations,
    loadPage,
    restore() {
      if (previous.Page === undefined) delete global.Page
      else global.Page = previous.Page
      global.wx = previous.wx
      global.setTimeout = previous.setTimeout
      global.clearTimeout = previous.clearTimeout
    },
  }
}

function assertBlankGainState(page) {
  assert.strictEqual(page.data.calculationState, 'empty')
  assert.strictEqual(page.data.result, null)
  assert.strictEqual(page.data.hasValidResult, false)
  assert.strictEqual(page.data.selectedAmplifier, null)
  assert.strictEqual(page.getEditorPreferences(), null)
}

function testOrdinaryBlankStartup() {
  const runtime = createRuntime()
  try {
    const page = runtime.loadPage('../pages/gain-structure/gain-structure')
    page.onLoad({})
    assertBlankGainState(page)
    assert.deepStrictEqual(runtime.storageAccess.reads, ['audioTool.gainStructure.preferences'])
    assert.deepStrictEqual(runtime.storageAccess.writes, [])
    assert.deepStrictEqual(runtime.storageAccess.removals, [])
    assert.strictEqual(runtime.storage.has('audioTool.resultEditorSessions.v1'), false,
      'ordinary blank startup must not create an editor session')
  } finally {
    runtime.restore()
  }
}

function testProjectCreatedBlankDraft() {
  const runtime = createRuntime()
  try {
    const projectPage = runtime.loadPage('../pages/records/project')
    projectPage.data.workspaceError = false
    projectPage.projectId = 'synthetic-project'
    assert.strictEqual(projectPage.launchProjectModule('gainStructure'), true)
    assert.strictEqual(runtime.navigations.length, 1)
    const route = new URL(runtime.navigations[0].url, 'https://local.test')
    assert.strictEqual(route.searchParams.get('projectId'), 'synthetic-project')
    const sessionId = route.searchParams.get('editorSessionId')
    assert(sessionId, 'the real project entry supplies its editor session to the calculator route')

    const page = runtime.loadPage('../pages/gain-structure/gain-structure')
    page.onLoad({ editorSessionId: sessionId })
    assertBlankGainState(page)
    assert.strictEqual(page.data.editorSessionActive, true)
    const { SESSIONS_KEY } = require('../utils/result-record-context')
    const session = runtime.storage.get(SESSIONS_KEY).sessions.find((item) => item.id === sessionId)
    assert.deepStrictEqual(session.preferences, {}, 'new project draft preferences stay empty')
    assert.deepStrictEqual(session.baselinePreferences, {}, 'blank startup must not invent a baseline')
    assert.strictEqual(session.sourceKind, 'project-draft')
    assert.strictEqual(session.projectId, 'synthetic-project')
  } finally {
    runtime.restore()
  }
}

function testExistingValidSessionBaseline() {
  const runtime = createRuntime()
  try {
    const { openProjectDraft, SESSIONS_KEY } = require('../utils/result-record-context')
    const preferences = {
      amplifierModel: 'TC-X2200B',
      stageValue: 1,
      mode: 'stereo',
      loadImpedance: null,
      targetPeakDbfs: -6,
    }
    const sessionId = openProjectDraft('gainStructure', 'synthetic-project', preferences)
    assert(sessionId)
    const stored = runtime.storage.get(SESSIONS_KEY)
    runtime.storage.set(SESSIONS_KEY, {
      ...stored,
      sessions: stored.sessions.map((item) => item.id === sessionId
        ? { ...item, baselinePreferences: { ...preferences, targetPeakDbfs: -12 } }
        : item),
    })

    const page = runtime.loadPage('../pages/gain-structure/gain-structure')
    page.onLoad({ editorSessionId: sessionId })
    assert.strictEqual(page.data.selectedAmplifier.model, preferences.amplifierModel)
    assert.deepStrictEqual(page.getEditorPreferences(), preferences)
    const session = runtime.storage.get(SESSIONS_KEY).sessions.find((item) => item.id === sessionId)
    assert.deepStrictEqual(session.preferences, preferences, 'valid session preferences are unchanged')
    assert.deepStrictEqual(session.baselinePreferences, preferences,
      'valid session baseline still captures the initial live preferences')
    assert.deepStrictEqual(page._resultEditorSession.baselinePreferences, preferences)
    assert.strictEqual(session.sourceKind, 'project-draft')
    assert.strictEqual(session.projectId, 'synthetic-project')
  } finally {
    runtime.restore()
  }
}

testOrdinaryBlankStartup()
testProjectCreatedBlankDraft()
testExistingValidSessionBaseline()
process.stdout.write('PASS gain blank startup, project draft entry, and valid editor session baseline\n')

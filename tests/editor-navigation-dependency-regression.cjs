'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const contextPath = path.join(root, 'utils/result-record-context.js')
const actionsPath = path.join(root, 'utils/result-record-actions.js')
const recordsPath = path.join(root, 'utils/records.js')
const beforeRoot = path.join(root, 'tmp/architecture-continuation-2026-10-25/before')
const beforeContextPath = path.join(beforeRoot, 'utils/result-record-context.js')
const beforeActionsPath = path.join(beforeRoot, 'utils/result-record-actions.js')
const pageFiles = [
  'pages/limiter/limiter.js',
  'pages/spl/spl.js',
  'pages/cable/cable.js',
  'pages/camera/camera.js',
  'pages/gain-structure/gain-structure.js',
  'pages/led-screen/led-screen.js',
  'pages/audio-wiring/index.js',
]

const results = []

function run(name, body) {
  try {
    body()
    results.push({ name, status: 'PASS' })
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack })
  }
}

function clearCache(paths) {
  paths.forEach((file) => { delete require.cache[file] })
}

function loadPageDefinition(relativePath, actionExports) {
  const filename = path.join(root, relativePath)
  let definition = null
  const pageModule = new Module(filename, module)
  pageModule.filename = filename
  pageModule.paths = Module._nodeModulePaths(path.dirname(filename))
  pageModule.require = Module.createRequire(filename)
  const originalLoad = Module._load
  Module._load = function loadPageWithInjectedActions(request, parent, isMain) {
    if (parent && path.resolve(parent.filename) === filename
      && Module._resolveFilename(request, parent) === actionsPath) {
      return actionExports
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const previousPage = global.Page
  global.Page = (value) => { definition = value }
  try {
    pageModule._compile(fs.readFileSync(filename, 'utf8'), filename)
  } finally {
    Module._load = originalLoad
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
  assert.ok(definition && definition.data, `Page did not register with data: ${relativePath}`)
  return definition
}

function makePage(definition, options = {}) {
  const pendingCallbacks = []
  const setDataCalls = []
  const page = {
    ...definition,
    data: { ...(definition.data || {}), editorGuardSupported: true, editorGuardArmed: true },
    _resultEditorSession: options.session === false ? null : { id: 'editor-session-test' },
    _pendingCallbacks: pendingCallbacks,
    _setDataCalls: setDataCalls,
    setData(changes, callback) {
      setDataCalls.push(changes)
      Object.assign(this.data, changes)
      if (callback) pendingCallbacks.push(callback)
    },
  }
  return page
}

function makeWx() {
  let navigateBackCount = 0
  const noOp = () => {}
  const wx = new Proxy({
    getStorageSync: () => undefined,
    setStorageSync: noOp,
    removeStorageSync: noOp,
    canIUse: () => true,
    getSystemInfoSync: () => ({ theme: 'light', windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
    getMenuButtonBoundingClientRect: () => ({ width: 0, height: 0, top: 0, right: 0 }),
    createCanvasContext: () => new Proxy({ draw: noOp, measureText: () => ({ width: 10 }) }, {
      get: (target, key) => key in target ? target[key] : noOp,
    }),
    canvasToTempFilePath: noOp,
    showToast: noOp,
    showLoading: noOp,
    hideLoading: noOp,
    vibrateShort: noOp,
    hideKeyboard: noOp,
    navigateTo: noOp,
    navigateBack: () => { navigateBackCount += 1 },
    setNavigationBarTitle: noOp,
    showModal: noOp,
    showActionSheet: noOp,
  }, { get: (target, key) => key in target ? target[key] : noOp })
  return { wx, getNavigateBackCount: () => navigateBackCount }
}

function captureNavigationTrace(methods, requestEditorLeave) {
  const trace = []
  const page = {
    data: { editorGuardArmed: true },
    _resultEditorSession: { id: 'editor-session-test' },
    setData(changes, callback) {
      trace.push({ type: 'setData', changes })
      Object.assign(this.data, changes)
      this.pendingCallback = callback
    },
  }
  methods.onEditorNavigationBeforeLeave.call(page)
  trace.push({ type: 'before', nativeLeavePending: page._editorNativeLeavePending === true })
  methods.onEditorNavigationAfterLeave.call(page)
  trace.push({
    type: 'after',
    nativeLeavePending: page._editorNativeLeavePending === true,
    callbackPending: typeof page.pendingCallback === 'function',
  })
  const pendingCallback = page.pendingCallback
  page.pendingCallback = null
  if (pendingCallback) pendingCallback()
  trace.push({
    type: 'complete',
    nativeLeavePending: page._editorNativeLeavePending === true,
    editorGuardArmed: page.data.editorGuardArmed,
    callbackPending: typeof page.pendingCallback === 'function',
  })
  return {
    trace,
    requests: requestEditorLeave.calls.map((call) => ({
      pageMatches: call.page === page,
      options: call.options,
    })),
  }
}

function makeRequestSpy() {
  const spy = function requestEditorLeaveSpy(page, options) {
    spy.calls.push({ page, options })
  }
  spy.calls = []
  return spy
}

const originalWx = global.wx
const originalGetCurrentPages = global.getCurrentPages
const testWx = makeWx()
global.wx = testWx.wx
global.getCurrentPages = () => []

run('context and actions load in either order without a context-to-actions import', () => {
  const source = fs.readFileSync(contextPath, 'utf8')
  assert.doesNotMatch(source, /require\(['"]\.\/result-record-actions['"]\)/)

  clearCache([contextPath, actionsPath])
  const contextFirst = require(contextPath)
  assert.equal(require.cache[actionsPath], undefined, 'loading context must not load actions')
  const actionsAfter = require(actionsPath)
  assert.equal(typeof contextFirst.createEditorNavigationMethods, 'function')
  assert.equal(typeof actionsAfter.requestEditorLeave, 'function')

  clearCache([contextPath, actionsPath])
  const actionsFirst = require(actionsPath)
  const contextAfter = require(contextPath)
  assert.equal(typeof actionsFirst.requestEditorLeave, 'function')
  assert.equal(typeof contextAfter.createEditorNavigationMethods, 'function')
})

run('injected callback waits for setData completion and receives the page instance', () => {
  clearCache([contextPath, actionsPath])
  const context = require(contextPath)
  const spy = makeRequestSpy()
  const methods = context.createEditorNavigationMethods(spy)
  const page = makePage(methods)

  page.onEditorNavigationBeforeLeave()
  assert.equal(page._editorNativeLeavePending, true)
  page.onEditorNavigationAfterLeave()
  assert.equal(page._editorNativeLeavePending, false, 'afterleave clears native pending state')
  assert.deepEqual(page._setDataCalls, [{ editorGuardArmed: false }])
  assert.equal(page._pendingCallbacks.length, 1)
  assert.equal(spy.calls.length, 0, 'leave request waits for setData callback')

  page._pendingCallbacks[0]()
  assert.equal(spy.calls.length, 1)
  assert.equal(spy.calls[0].page, page)
  assert.deepEqual(spy.calls[0].options, { nativeBack: true })
})

run('guard close path navigates back exactly once and missing session does nothing', () => {
  clearCache([contextPath])
  const context = require(contextPath)
  const spy = makeRequestSpy()
  const methods = context.createEditorNavigationMethods(spy)
  const closingPage = makePage(methods)
  closingPage._editorGuardClosingForNavigation = true
  closingPage._editorNavigationPending = true

  closingPage.onEditorNavigationBeforeLeave()
  assert.equal(closingPage._editorNativeLeavePending, undefined)
  closingPage.onEditorNavigationAfterLeave()
  assert.equal(closingPage._editorGuardClosingForNavigation, false)
  assert.equal(closingPage._editorNavigationPending, false)
  assert.equal(testWx.getNavigateBackCount(), 1)
  closingPage.onEditorNavigationAfterLeave()
  assert.equal(testWx.getNavigateBackCount(), 1)
  assert.equal(spy.calls.length, 0)

  const noSessionPage = makePage(methods, { session: false })
  noSessionPage._editorNativeLeavePending = true
  noSessionPage.onEditorNavigationAfterLeave()
  assert.equal(noSessionPage._editorNativeLeavePending, false)
  assert.deepEqual(noSessionPage._setDataCalls, [])
  assert.equal(noSessionPage._pendingCallbacks.length, 0)
  assert.equal(spy.calls.length, 0)
})

run('all seven real pages pass their imported leave action into the navigation factory', () => {
  const originalLoad = require('node:module')._load
  const realActions = require(actionsPath)
  for (const relativePath of pageFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    assert.match(source, /\.\.\.createEditorNavigationMethods\(requestEditorLeave\)/, relativePath)
    const spy = makeRequestSpy()
    const actionExports = { ...realActions, requestEditorLeave: spy }
    const definition = loadPageDefinition(relativePath, actionExports)
    assert.equal(typeof definition.onEditorNavigationBeforeLeave, 'function', relativePath)
    assert.equal(typeof definition.onEditorNavigationAfterLeave, 'function', relativePath)

    const page = makePage(definition)
    page.onEditorNavigationBeforeLeave()
    assert.equal(page._editorNativeLeavePending, true, relativePath)
    page.onEditorNavigationAfterLeave()
    assert.equal(page._editorNativeLeavePending, false, relativePath)
    assert.equal(spy.calls.length, 0, `${relativePath}: setData callback is deferred`)
    assert.equal(page._pendingCallbacks.length, 1, relativePath)
    page._pendingCallbacks[0]()
    assert.equal(spy.calls.length, 1, relativePath)
    assert.equal(spy.calls[0].page, page, `${relativePath}: method this is passed as page`)
    assert.deepEqual(spy.calls[0].options, { nativeBack: true }, relativePath)
  }
  assert.equal(Module._load, originalLoad)
})

if (process.argv.includes('--compare-before')) {
  run('before and after navigation callback event traces match', () => {
    clearCache([contextPath, actionsPath, recordsPath, beforeContextPath, beforeActionsPath])
    const beforeContext = require(beforeContextPath)
    const beforeActions = require(beforeActionsPath)
    const beforeSpy = makeRequestSpy()
    const beforeActionExports = { ...beforeActions, requestEditorLeave: beforeSpy }
    const originalLoad = Module._load
    Module._load = function loadBeforeActionsWithSpy(request, parent, isMain) {
      if (parent && path.resolve(parent.filename) === beforeContextPath
        && Module._resolveFilename(request, parent) === beforeActionsPath) {
        return beforeActionExports
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    let beforeTrace
    try {
      beforeTrace = captureNavigationTrace(beforeContext.createEditorNavigationMethods(), beforeSpy)
    } finally {
      Module._load = originalLoad
    }

    clearCache([contextPath, actionsPath, recordsPath])
    const currentContext = require(contextPath)
    const currentSpy = makeRequestSpy()
    const currentTrace = captureNavigationTrace(
      currentContext.createEditorNavigationMethods(currentSpy), currentSpy,
    )
    assert.deepEqual(currentTrace, beforeTrace)
  })
}

if (originalWx === undefined) delete global.wx
else global.wx = originalWx
if (originalGetCurrentPages === undefined) delete global.getCurrentPages
else global.getCurrentPages = originalGetCurrentPages
if (!results.length || results.some((result) => result.status !== 'PASS')) process.exitCode = 1
console.log(JSON.stringify({ results }, null, 2))

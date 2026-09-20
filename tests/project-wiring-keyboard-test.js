const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const projectWiring = require('../utils/project-wiring')

const pageModulePath = require.resolve('../pages/project-wiring/index')
const recordsModulePath = require.resolve('../utils/records')
const actionsModulePath = require.resolve('../utils/report-image-actions')
const oldPage = global.Page
const oldWx = global.wx
const oldModules = new Map([pageModulePath, recordsModulePath, actionsModulePath]
  .map((modulePath) => [modulePath, require.cache[modulePath]]))

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

function createRuntime(windowHeight = 800) {
  const runtime = {
    metrics: { windowHeight, screenWidth: 390 },
    nextTicks: [],
    queries: [],
    queryGeometry: null,
    setDataCalls: [],
  }
  runtime.wx = {
    getWindowInfo() { return { ...runtime.metrics } },
    getSystemInfoSync() { return { ...runtime.metrics } },
    setNavigationBarTitle() {},
    nextTick(callback) { runtime.nextTicks.push(callback) },
    createSelectorQuery() {
      const selections = []
      const query = {
        in() { return query },
        select(selector) {
          const selected = { selector }
          selections.push(selected)
          return {
            boundingClientRect() { selected.rect = true; return query },
            fields(fields) { selected.fields = fields; return query },
          }
        },
        exec(callback) { runtime.queries.push({ selections, callback }) },
      }
      return query
    },
  }
  return runtime
}

function createPage(runtime) {
  let definition
  global.Page = (value) => { definition = value }
  global.wx = runtime.wx
  mockModule(recordsModulePath, {
    getActiveProject: () => null,
    getProjectWiring: (id) => ({
      ok: true,
      project: { id, name: '测试项目' },
      schedule: projectWiring.emptySchedule(),
    }),
    getProjects: () => [],
    createProject: () => null,
    saveProjectWiring: () => ({ ok: false, error: 'unused' }),
  })
  mockModule(actionsModulePath, {
    previewGeneratedImage() {},
    saveGeneratedImage() {},
    shareGeneratedImage() {},
  })
  delete require.cache[pageModulePath]
  require(pageModulePath)
  const page = {
    ...definition,
    data: clone(definition.data),
    setData(update, callback) {
      runtime.setDataCalls.push(clone(update))
      Object.assign(this.data, update)
      if (callback) callback()
    },
  }
  page.onLoad({ id: 'project-A' })
  return page
}

function eventFor(id, detail = {}) {
  return { currentTarget: { id, dataset: { focusId: id } }, detail }
}

function flushNextTicks(runtime) {
  while (runtime.nextTicks.length) runtime.nextTicks.splice(0).forEach((callback) => callback())
}

function completeQuery(runtime, queryIndex, inputRect, scrollRect) {
  const query = runtime.queries[queryIndex]
  assert.ok(query, `expected selector query ${queryIndex}`)
  query.callback([inputRect, scrollRect])
}

function countScrollUpdates(runtime) {
  return runtime.setDataCalls.filter((update) => Object.hasOwn(update, 'formScrollTop')).length
}

function testFormMarkupBindings() {
  const markup = fs.readFileSync(path.join(__dirname, '../pages/project-wiring/index.wxml'), 'utf8')
  const editor = markup.slice(markup.indexOf('wx:if="{{editorVisible}}"'), markup.indexOf('wx:if="{{batchVisible}}"'))
  const batch = markup.slice(markup.indexOf('wx:if="{{batchVisible}}"'), markup.indexOf('<canvas'))
  const fields = [...editor.matchAll(/<(?:input|textarea)\b[^>]*>/g), ...batch.matchAll(/<(?:input|textarea)\b[^>]*>/g)]
  const ids = []
  assert.equal(fields.length, 22, 'all editable inputs and textarea in editor and batch forms should be covered')
  fields.forEach(([tag]) => {
    const id = tag.match(/\bid="([^"]+)"/)
    assert.ok(id, `form field needs a stable id: ${tag}`)
    ids.push(id[1])
    assert.match(tag, /adjust-position="\{\{false\}\}"/)
    assert.match(tag, /bindfocus="onFormInputFocus"/)
    assert.match(tag, /bindblur="onFormInputBlur"/)
    assert.match(tag, /bindkeyboardheightchange="onFormKeyboardHeightChange"/)
    assert.match(tag, /bindinput=/, 'existing input handler should remain wired')
    if (tag.startsWith('<textarea')) assert.match(tag, /fixed="\{\{true\}\}"/)
  })
  assert.equal(new Set(ids).size, ids.length, 'form field ids should be unique')
  assert.equal((editor.match(/class="wiring-sheet-keyboard-space"/g) || []).length, 1)
  assert.equal((batch.match(/class="wiring-sheet-keyboard-space"/g) || []).length, 1)
  assert.doesNotMatch(markup, /wiring-keyboard-open|formKeyboardMaskStyle/)
  assert.doesNotMatch(markup.slice(0, markup.indexOf('wx:if="{{editorVisible}}"')), /adjust-position=/,
    'search and project selection inputs should retain their existing keyboard behavior')
}

function testEditorLengthAndMinimumScroll() {
  const runtime = createRuntime()
  const page = createPage(runtime)
  page.openNewLine()
  page.onFormInputFocus(eventFor('wiring-editor-length'))
  flushNextTicks(runtime)
  assert.equal(runtime.queries[0].selections[0].selector, '#wiring-editor-length')
  assert.equal(runtime.queries[0].selections[1].selector, '.wiring-editor-scroll')
  completeQuery(runtime, 0,
    { top: 450, bottom: 520, height: 70 },
    { top: 100, bottom: 500, height: 400, scrollTop: 20 })
  assert.equal(page.data.formScrollTop, 52, 'bottom correction should add only the clipped distance plus 12px margin')

  page.onFormInputFocus(eventFor('wiring-editor-spec'))
  flushNextTicks(runtime)
  const updatesBeforeVisibleField = countScrollUpdates(runtime)
  completeQuery(runtime, 1,
    { top: 220, bottom: 260, height: 40 },
    { top: 100, bottom: 500, height: 400, scrollTop: 52 })
  assert.equal(countScrollUpdates(runtime), updatesBeforeVisibleField, 'visible field should not move the scroll view')

  page.data.formScrollTop = 100
  page.onFormInputFocus(eventFor('wiring-editor-from-device'))
  flushNextTicks(runtime)
  completeQuery(runtime, 2,
    { top: 0, bottom: 40, height: 40 },
    { top: 100, bottom: 500, height: 400, scrollTop: 212 })
  flushNextTicks(runtime)
  assert.equal(page.data.formScrollTop, 100, 'top correction should be the smallest delta that restores the 12px margin')
  const reissued = runtime.setDataCalls.filter((update) => Object.hasOwn(update, 'formScrollTop')).slice(-2)
  assert.deepEqual(reissued.map((update) => update.formScrollTop), [212, 100],
    'same bound target should first sync to the measured native position, then issue the target')
  page.resetFormKeyboardAvoidance()
}

function testBatchLengthAndKeyboardViewport() {
  const runtime = createRuntime()
  const page = createPage(runtime)
  runtime.metrics.windowHeight = 500
  page.openBatch()
  assert.equal(page._formViewportBaselineHeight, 800, 'opening while another keyboard has shrunk the viewport should retain the no-keyboard baseline')
  const originalFrameStyle = page.data.formFrameStyle
  const originalSheetStyle = page.data.formSheetStyle
  assert.equal(originalFrameStyle, 'top:0;bottom:auto;height:800px;')
  assert.equal(originalSheetStyle, 'height:calc(736px - env(safe-area-inset-top) - env(safe-area-inset-bottom));')
  page.onFormInputFocus(eventFor('wiring-batch-length'))
  page.onFormKeyboardHeightChange(eventFor('wiring-batch-length', { height: 300 }))
  assert.equal(page.data.formKeyboardSpacerHeight, 300)
  assert.equal(page.data.formFrameStyle, originalFrameStyle, 'keyboard must not resize or move the mask')
  assert.equal(page.data.formSheetStyle, originalSheetStyle, 'keyboard must not resize the sheet or its footer')
  flushNextTicks(runtime)
  assert.equal(runtime.queries[0].selections[0].selector, '#wiring-batch-length')
  assert.equal(runtime.queries[0].selections[1].selector, '.wiring-batch-scroll')
  completeQuery(runtime, 0,
    { top: 450, bottom: 520, height: 70 },
    { top: 100, bottom: 700, height: 600, scrollTop: 0 })
  assert.equal(page.data.formScrollTop, 32,
    'an input below the keyboard top should scroll even while it remains inside the scroll-view rectangle')

  page.onFormKeyboardHeightChange(eventFor('wiring-batch-length', { height: 340 }))
  assert.equal(page.data.formKeyboardSpacerHeight, 340)
  assert.equal(page.data.formFrameStyle, originalFrameStyle)
  assert.equal(page.data.formSheetStyle, originalSheetStyle)
  flushNextTicks(runtime)
  const scrollUpdatesBeforeVisibleField = countScrollUpdates(runtime)
  completeQuery(runtime, 1,
    { top: 330, bottom: 370, height: 40 },
    { top: 100, bottom: 700, height: 600, scrollTop: 32 })
  assert.equal(countScrollUpdates(runtime), scrollUpdatesBeforeVisibleField,
    'a field inside the keyboard-visible area should not scroll')
  page.onFormInputFocus(eventFor('wiring-batch-length'))
  flushNextTicks(runtime)
  assert.equal(runtime.queries.length, 3)
  page.onFormKeyboardHeightChange(eventFor('wiring-batch-length', { height: 0 }))
  assert.equal(page.data.formKeyboardSpacerHeight, 0)
  assert.equal(page.data.formFrameStyle, originalFrameStyle, 'closing the keyboard should keep the outer frame fixed')
  assert.equal(page.data.formSheetStyle, originalSheetStyle)
  const updatesBeforeLateQuery = runtime.setDataCalls.length
  completeQuery(runtime, 2,
    { top: 700, bottom: 740, height: 40 },
    { top: 100, bottom: 400, height: 300, scrollTop: 0 })
  assert.equal(runtime.setDataCalls.length, updatesBeforeLateQuery, 'keyboard closing should invalidate prior scroll measurements')
  page.closeBatch()
}

function testFocusHeightFallbackAndTransfer() {
  const runtime = createRuntime()
  const page = createPage(runtime)
  page.openNewLine()
  const originalFrameStyle = page.data.formFrameStyle
  const originalSheetStyle = page.data.formSheetStyle
  page.onFormInputFocus(eventFor('wiring-editor-length', { height: 280 }))
  assert.equal(page.data.formKeyboardSpacerHeight, 280,
    'focus height should provide internal scroll space when keyboardheightchange has not fired')
  assert.equal(page.data.formFrameStyle, originalFrameStyle)
  assert.equal(page.data.formSheetStyle, originalSheetStyle)
  flushNextTicks(runtime)
  page.onFormInputFocus(eventFor('wiring-editor-spec'))
  flushNextTicks(runtime)
  assert.equal(runtime.queries.length, 2)
  const updatesBeforeOldFocus = countScrollUpdates(runtime)
  completeQuery(runtime, 0,
    { top: 700, bottom: 740, height: 40 },
    { top: 100, bottom: 400, height: 300, scrollTop: 0 })
  assert.equal(countScrollUpdates(runtime), updatesBeforeOldFocus, 'old focus query should not move the new field')
  completeQuery(runtime, 1,
    { top: 350, bottom: 390, height: 40 },
    { top: 100, bottom: 400, height: 300, scrollTop: 0 })
  assert.equal(page.data.formScrollTop, 2, 'new focus should make only the minimum bottom correction')

  page.onFormInputBlur(eventFor('wiring-editor-spec'))
  const frameBeforeLateHeight = page.data.formFrameStyle
  page.onFormKeyboardHeightChange(eventFor('wiring-editor-spec', { height: 300 }))
  assert.equal(page.data.formFrameStyle, frameBeforeLateHeight, 'a late height event during the blur grace period must not change the frame')
  assert.equal(page.data.formKeyboardSpacerHeight, 280)
  page.onFormKeyboardHeightChange(eventFor('wiring-editor-spec', { height: 0 }))
  assert.equal(page.data.formKeyboardSpacerHeight, 0)
  page.onFormKeyboardHeightChange(eventFor('wiring-editor-spec', { height: 300 }))
  assert.equal(page.data.formKeyboardSpacerHeight, 0, 'late positive height after blur must not restore internal keyboard space')
  page.closeEditor()
}

function testCloseHideAndUnloadIgnoreLateQueries() {
  for (const action of ['close', 'hide', 'unload']) {
    const runtime = createRuntime()
    const page = createPage(runtime)
    page.openNewLine()
    page.onFormInputFocus(eventFor('wiring-editor-length'))
    flushNextTicks(runtime)
    if (action === 'close') page.closeEditor()
    else if (action === 'hide') page.onHide()
    else page.onUnload()
    const callsAtClose = runtime.setDataCalls.length
    completeQuery(runtime, 0,
      { top: 700, bottom: 740, height: 40 },
      { top: 100, bottom: 400, height: 300, scrollTop: 0 })
    assert.equal(runtime.setDataCalls.length, callsAtClose, `${action} should prevent stale selector callbacks from updating the page`)
  }
}

try {
  testFormMarkupBindings()
  testEditorLengthAndMinimumScroll()
  testBatchLengthAndKeyboardViewport()
  testFocusHeightFallbackAndTransfer()
  testCloseHideAndUnloadIgnoreLateQueries()
  console.log('project wiring keyboard tests passed (editor and batch fields, viewport sizing, minimal scroll correction, focus transfer, keyboard close, late callback guards)')
} finally {
  if (oldPage === undefined) delete global.Page
  else global.Page = oldPage
  if (oldWx === undefined) delete global.wx
  else global.wx = oldWx
  for (const [modulePath, previous] of oldModules) {
    delete require.cache[modulePath]
    if (previous) require.cache[modulePath] = previous
  }
}

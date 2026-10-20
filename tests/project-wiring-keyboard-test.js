const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const projectWiring = require('../utils/project-wiring')

const pageModulePath = require.resolve('../pages/project-wiring/index')
const recordsModulePath = require.resolve('../utils/records')
const actionsModulePath = require.resolve('../utils/report-image-actions')
const workspaceModulePath = require.resolve('../pages/project-wiring/workspace-ui')
const oldPage = global.Page
const oldWx = global.wx
const oldModules = new Map([pageModulePath, recordsModulePath, actionsModulePath, workspaceModulePath]
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
  delete require.cache[workspaceModulePath]
  require(pageModulePath)
  const page = {
    ...definition,
    data: clone(definition.data),
    setData(update, callback) {
      runtime.setDataCalls.push(clone(update))
      Object.assign(this.data, clone(update))
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
  const expand = (file) => fs.readFileSync(file, 'utf8').replace(/<include\s+src="([^"]+)"\s*\/>/g,
    (_match, include) => expand(path.join(path.dirname(file), include)))
  const markup = expand(path.join(__dirname, '../pages/project-wiring/index.wxml'))
  const overlayStart = (predicate) => {
    const overlays = [...markup.matchAll(/<view\b[^>]*\bwx:if="([^"]*)"[^>]*>/g)]
    const match = overlays.find((item) => predicate(item[1]))
    return match ? match.index : -1
  }
  const deviceStart = overlayStart((condition) => /\bdeviceEditorVisible\b/.test(condition))
  const detailStart = overlayStart((condition) => /\bdetailVisible\b/.test(condition) && /\bdetailLine\b/.test(condition))
  const editorStart = overlayStart((condition) => /\beditorVisible\b/.test(condition) && /!\s*continuousVisible/.test(condition))
  const continuousStart = overlayStart((condition) => /\beditorVisible\b/.test(condition) && /\bcontinuousVisible\b/.test(condition) && !/!\s*continuousVisible/.test(condition))
  const canvasStart = markup.indexOf('<canvas')
  assert(deviceStart >= 0 && detailStart > deviceStart && editorStart > detailStart && continuousStart > editorStart && canvasStart > continuousStart)
  const inlineRenameInput = markup.match(/<input\b[^>]*data-inline-rename-input="true"[^>]*\/>/)
  assert.ok(inlineRenameInput, 'device name area exposes its inline rename input')
  assert.match(inlineRenameInput[0], /\bid="wiring-device-inline-rename-name"/)
  assert.match(inlineRenameInput[0], /\bdata-focus-id="wiring-device-inline-rename-name"/)
  assert.match(inlineRenameInput[0], /\bvalue="\{\{inlineRenameValue\}\}"/)
  assert.match(inlineRenameInput[0], /\bfocus="\{\{inlineRenameFocus\}\}"/)
  assert.match(inlineRenameInput[0], /\bhold-keyboard="\{\{true\}\}"/)
  assert.match(inlineRenameInput[0], /\bdata-device-key="\{\{item\.key\}\}"/)
  assert.match(inlineRenameInput[0], /\bdata-rename-session-id="\{\{inlineRenameSessionId\}\}"/)
  assert.match(inlineRenameInput[0], /\bbindinput="onInlineRenameInput"/)
  assert.match(inlineRenameInput[0], /\bbindblur="onInlineRenameBlur"/)
  assert.match(inlineRenameInput[0], /\bbindconfirm="onInlineRenameConfirm"/)
  assert.doesNotMatch(inlineRenameInput[0], /catchtouch|capture-bind/)
  assert.match(markup.slice(0, deviceStart), /capture-bind:touchstart="captureInlineRenameTouchStart"/)
  assert.match(markup.slice(0, deviceStart), /capture-bind:tap="captureInlineRenameTap"/)
  assert.match(markup.slice(0, deviceStart), /capture-bind:touchmove="captureInlineRenameTouchMove"/)
  assert.match(markup.slice(0, deviceStart), /capture-bind:touchend="captureInlineRenameTouchEnd"/)
  assert.match(markup.slice(0, deviceStart), /capture-bind:touchcancel="captureInlineRenameTouchCancel"/)
  assert.match(markup.slice(0, deviceStart), /wx:for="\{\{devices\}\}" wx:key="key"/)
  assert.match(markup.slice(0, deviceStart), /data-action-type="connect"[^>]*data-device-key="\{\{item\.key\}\}"/)
  assert.match(markup, /<block wx:if="\{\{inlineRenameKey === item\.key\}\}"><input[^>]*data-inline-rename-input="true"[^>]*\/><\/block><view wx:else[^>]*class="workspace-device-name-action"/)
  assert.doesNotMatch(markup, /workspace-inline-rename-(?:hint|error)/, 'inline editing replaces only the name area without adding a mini-form')
  assert.doesNotMatch(markup.slice(deviceStart, detailStart), /workspace-device-rename-(?:scroll|actions|name)/)
  const forms = [
    { name: 'device', markup: markup.slice(deviceStart, detailStart), expected: ['wiring-device-name', 'wiring-device-count'] },
    { name: 'editor', markup: markup.slice(editorStart, continuousStart), expected: [
      'wiring-pair-{{index}}-from', 'wiring-pair-{{index}}-to',
      'wiring-editor-connector-a', 'wiring-editor-connector-b', 'wiring-editor-spec', 'wiring-editor-length',
    ] },
    { name: 'continuous', markup: markup.slice(continuousStart, canvasStart), expected: [
      'wiring-continuous-from', 'wiring-continuous-to', 'wiring-continuous-count',
    ] },
  ]
  const ids = []
  for (const form of forms) {
    const fields = [...form.markup.matchAll(/<(?:input|textarea)\b[^>]*>/g)]
    const formIds = []
    assert(fields.length > 0, form.name + ' must contain actual editable fields from includes')
    fields.forEach(([tag]) => {
      const id = tag.match(/\bid="([^"]+)"/)
      assert.ok(id, 'form field needs a stable id: ' + tag)
      ids.push(id[1])
      formIds.push(id[1])
      assert(tag.includes('data-focus-id="' + id[1] + '"'))
      assert.match(tag, /adjust-position="\{\{false\}\}"/)
      assert.match(tag, /bindfocus="onFormInputFocus"/)
      assert.match(tag, /bindblur="onFormInputBlur"/)
      assert.match(tag, /bindkeyboardheightchange="onFormKeyboardHeightChange"/)
      assert.match(tag, /bindinput=/)
      if (tag.startsWith('<textarea')) assert.match(tag, /fixed="\{\{true\}\}"/)
    })
    assert.deepEqual(formIds.sort(), form.expected.slice().sort(), form.name + ' actual fields are fully covered')
    const keyboardSpacerCount = (form.markup.match(/class="wiring-sheet-keyboard-space"/g) || []).length
    if (form.name === 'device') {
      assert.equal(keyboardSpacerCount, 1, 'Add device editor retains its keyboard spacer')
    } else {
      assert.equal(keyboardSpacerCount, 1)
    }
  }
  assert.equal(new Set(ids).size, ids.length, 'field ids are unique across overlays')
  assert.doesNotMatch(markup, /wiring-keyboard-open|formKeyboardMaskStyle/)
  assert.doesNotMatch(markup.slice(0, deviceStart), /adjust-position=/,
    'search and new-project inputs retain their native keyboard behavior')
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
  page.onFormInputFocus(eventFor('wiring-pair-0-from'))
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

function testDeviceCountAndKeyboardViewport() {
  const runtime = createRuntime()
  const page = createPage(runtime)
  runtime.metrics.windowHeight = 500
  page.openDeviceEditor()
  assert.equal(page._formViewportBaselineHeight, 800, 'opening while another keyboard has shrunk the viewport should retain the no-keyboard baseline')
  const originalFrameStyle = page.data.formFrameStyle
  const originalSheetStyle = page.data.formSheetStyle
  assert.equal(originalFrameStyle, 'top:0;bottom:auto;height:800px;')
  assert.equal(originalSheetStyle, 'height:calc(736px - env(safe-area-inset-top) - env(safe-area-inset-bottom));')
  page.onFormInputFocus(eventFor('wiring-device-count'))
  page.onFormKeyboardHeightChange(eventFor('wiring-device-count', { height: 300 }))
  assert.equal(page.data.formKeyboardSpacerHeight, 300)
  assert.equal(page.data.formFrameStyle, originalFrameStyle, 'keyboard must not resize or move the mask')
  assert.equal(page.data.formSheetStyle, originalSheetStyle, 'keyboard must not resize the sheet or its footer')
  flushNextTicks(runtime)
  assert.equal(runtime.queries[0].selections[0].selector, '#wiring-device-count')
  assert.equal(runtime.queries[0].selections[1].selector, '.wiring-batch-scroll')
  completeQuery(runtime, 0,
    { top: 450, bottom: 520, height: 70 },
    { top: 100, bottom: 700, height: 600, scrollTop: 0 })
  assert.equal(page.data.formScrollTop, 32,
    'an input below the keyboard top should scroll even while it remains inside the scroll-view rectangle')

  page.onFormKeyboardHeightChange(eventFor('wiring-device-count', { height: 340 }))
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
  page.onFormInputFocus(eventFor('wiring-device-count'))
  flushNextTicks(runtime)
  assert.equal(runtime.queries.length, 3)
  page.onFormKeyboardHeightChange(eventFor('wiring-device-count', { height: 0 }))
  assert.equal(page.data.formKeyboardSpacerHeight, 0)
  assert.equal(page.data.formFrameStyle, originalFrameStyle, 'closing the keyboard should keep the outer frame fixed')
  assert.equal(page.data.formSheetStyle, originalSheetStyle)
  const updatesBeforeLateQuery = runtime.setDataCalls.length
  completeQuery(runtime, 2,
    { top: 700, bottom: 740, height: 40 },
    { top: 100, bottom: 400, height: 300, scrollTop: 0 })
  assert.equal(runtime.setDataCalls.length, updatesBeforeLateQuery, 'keyboard closing should invalidate prior scroll measurements')
  page.closeDeviceEditor()
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
  for (const mode of ['editor', 'device', 'continuous']) {
    for (const action of ['close', 'hide', 'unload']) {
      const runtime = createRuntime()
      const page = createPage(runtime)
      if (mode === 'device') page.openDeviceEditor()
      else {
        page.openNewLine()
        if (mode === 'continuous') page.openContinuous()
      }
      const field = mode === 'device' ? 'wiring-device-count' : mode === 'continuous' ? 'wiring-continuous-count' : 'wiring-editor-length'
      page.onFormInputFocus(eventFor(field))
      flushNextTicks(runtime)
      if (action === 'close') {
        if (mode === 'device') page.closeDeviceEditor()
        else if (mode === 'continuous') page.closeContinuous()
        else page.closeEditor()
      } else if (action === 'hide') page.onHide()
      else page.onUnload()
      const callsAtClose = runtime.setDataCalls.length
      completeQuery(runtime, 0,
        { top: 700, bottom: 740, height: 40 },
        { top: 100, bottom: 400, height: 300, scrollTop: 0 })
      assert.equal(runtime.setDataCalls.length, callsAtClose, mode + ' ' + action + ' rejects stale selector callbacks')
    }
  }
}

function testContinuousOverlayFocusTransfer() {
  const runtime = createRuntime()
  const page = createPage(runtime)
  page.openNewLine()
  page.onFormInputFocus(eventFor('wiring-editor-spec'))
  flushNextTicks(runtime)
  page.openContinuous()
  page.onFormInputFocus(eventFor('wiring-continuous-count', { height: 280 }))
  flushNextTicks(runtime)
  assert.equal(runtime.queries[1].selections[0].selector, '#wiring-continuous-count')
  assert.equal(runtime.queries[1].selections[1].selector, '.wiring-editor-scroll')
  const updatesBefore = runtime.setDataCalls.length
  completeQuery(runtime, 0,
    { top: 700, bottom: 740, height: 40 },
    { top: 100, bottom: 400, height: 300, scrollTop: 0 })
  assert.equal(runtime.setDataCalls.length, updatesBefore, 'opening continuous invalidates the hidden parent editor query')
  completeQuery(runtime, 1,
    { top: 350, bottom: 390, height: 40 },
    { top: 100, bottom: 400, height: 300, scrollTop: 0 })
  assert.equal(page.data.formScrollTop, 2)
  page.closeContinuous()
  assert.equal(page.data.formKeyboardSpacerHeight, 0)
  page.closeEditor()
}

try {
  testFormMarkupBindings()
  testEditorLengthAndMinimumScroll()
  testDeviceCountAndKeyboardViewport()
  testFocusHeightFallbackAndTransfer()
  testCloseHideAndUnloadIgnoreLateQueries()
  testContinuousOverlayFocusTransfer()
  console.log('project wiring keyboard tests passed (included editor/device/continuous fields, viewport sizing, minimal scroll correction, focus transfer, keyboard close and overlay late callback guards)')
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

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone, stageLightingProductIndex } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const root = path.resolve(__dirname, '..')
const cases = []
function test(name, body) { cases.push({ name, body }) }

function seedSingleFixture(runtime) {
  const product = stageLightingProductIndex.get('TL-SL323')
  runtime.seed([{
    name: product.name,
    fixtureSource: 'library',
    fixtureModel: product.model,
    channelCount: '2',
    libraryChannelCount: '2',
    fixtureCount: '1',
    targetUniverse: 'A',
  }])
}

function readScheme(runtime, contextId) {
  const result = runtime.workspace.readLightingWorkspace(contextId)
  assert.equal(result.ok, true)
  return result.scheme
}

function setPageData(page, patch, callback) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let target = page.data
    for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {})
    target[parts.at(-1)] = clone(value)
  }
  callback?.()
}

function loadProjectPage(project) {
  let definition = null
  const previousPage = global.Page
  global.Page = value => { definition = value }
  const file = path.join(root, 'pages/records/project.js')
  delete require.cache[require.resolve(file)]
  require(file)
  global.Page = previousPage
  assert(definition, 'Project detail must register its actual Page')
  const page = { ...definition, data: clone(definition.data), route: 'pages/records/project' }
  page.setData = (patch, callback) => setPageData(page, patch, callback)
  page.onLoad({ id: project.id })
  return page
}

test('deleting the last group persists an empty scheme, keeps rods, supports undo, and reopens empty', () => {
  const runtime = createRuntime()
  try {
    seedSingleFixture(runtime)
    const layoutPage = runtime.make('portrait')
    runtime.place(layoutPage, 0)
    const page = runtime.make('main')
    assert.equal(page._contextId, layoutPage._contextId)
    runtime.checkMain(page, page._calculationResult.fixtures[0])
    const before = clone(readScheme(runtime, page._contextId))
    const deletedGroupId = page.data.groups[0]._lightingGroupId
    const fixtureId = layoutPage._fixtures[0].stableId
    assert(before.layout.positionsById[fixtureId], 'The fixture should start on a rod')
    const writesBeforePreview = runtime.stats.writes
    const vibrations = []
    global.wx.vibrateShort = ({ type }) => vibrations.push(type)

    page.requestDeleteGroup(runtime.event({ index: 0 }))
    assert.equal(page.data.pendingChange.valid, true)
    assert.equal(page.data.pendingChange.remainingGroupCount, 0)
    assert.equal(runtime.stats.writes, writesBeforePreview, 'Preview must not write')
    page.confirmPendingChange()

    const after = readScheme(runtime, page._contextId)
    assert.equal(page._unsavedScheme, false, 'Delete confirmation must save the scheme')
    assert.deepEqual(vibrations, ['medium'], 'A successful delete must vibrate medium exactly once')
    assert.equal(after.preferences.groups.length, 0, 'Last group deletion must leave an empty scheme')
    assert.equal(after.fixtureIdsByGroup[deletedGroupId], undefined)
    assert.deepEqual(after.layout.positionsById, {}, 'Positions owned by the removed group must be cleared')
    assert.deepEqual(after.layout.internalRods, before.layout.internalRods, 'Stage rods must remain')
    assert.deepEqual(after.layout.frontRods, before.layout.frontRods, 'Front rods must remain')
    assert.equal(after.layout.stageWidthText, before.layout.stageWidthText)
    assert.equal(after.layout.stageDepthText, before.layout.stageDepthText)
    assert.deepEqual(after.checksById, {}, 'Checks owned by the deleted group must be cleared')

    const reentered = runtime.make('main')
    assert.equal(reentered.data.groups.length, 0, 'Re-entering the address page must show the empty scheme')
    assert.equal(reentered.data.groupCards.length, 0, 'The empty state must not invent a placeholder group')
    assert.match(fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8'),
      /wx:if="\{\{!groupCards\.length\}\}" class="empty-state">从灯具库选择型号，开始编址。/)

    page.undoDelete()
    const restored = readScheme(runtime, page._contextId)
    assert.equal(restored.preferences.groups.length, 1, 'Undo must restore the deleted group')
    assert.equal(restored.preferences.groups[0].fixtureModel, before.preferences.groups[0].fixtureModel)
    assert(restored.layout.positionsById[fixtureId], 'Undo must restore the deleted group fixture position')
    assert.deepEqual(restored.checksById, before.checksById, 'Undo must restore the deleted group fixture check')
  } finally { runtime.dispose() }
})

test('delete preview, cancel, invalid confirmation, and save failure do not vibrate', () => {
  for (const action of ['cancel', 'invalid', 'save-fail']) {
    const runtime = createRuntime()
    try {
      seedSingleFixture(runtime)
      const page = runtime.make('main')
      const before = clone(readScheme(runtime, page._contextId))
      const writesBefore = runtime.stats.writes
      const vibrations = []
      global.wx.vibrateShort = ({ type }) => vibrations.push(type)
      page.requestDeleteGroup(runtime.event({ index: 0 }))
      assert.equal(runtime.stats.writes, writesBefore, 'Preview must not write')
      if (action === 'cancel') {
        page.onUserCancelPendingChange()
        page.finishPendingChangeClose()
      } else if (action === 'invalid') {
        page.setData({ 'pendingChange.valid': false })
        page.confirmPendingChange()
      } else {
        runtime.state.failWrites = true
        page.confirmPendingChange()
        assert.equal(page._unsavedScheme, true, 'A failed storage write must remain marked unsaved')
        assert.deepEqual(readScheme(runtime, page._contextId), before, 'A failed save must preserve the saved scheme and revision')
      }
      assert.deepEqual(vibrations, [], action + ' must not emit success haptics')
      if (action !== 'save-fail') {
        assert.equal(runtime.stats.writes, writesBefore)
        assert.deepEqual(readScheme(runtime, page._contextId), before, action + ' must preserve the saved scheme')
      }
    } finally { runtime.dispose() }
  }
})

test('an unavailable haptic API does not block a valid last-group delete', () => {
  const runtime = createRuntime()
  try {
    seedSingleFixture(runtime)
    const page = runtime.make('main')
    delete global.wx.vibrateShort
    page.requestDeleteGroup(runtime.event({ index: 0 }))
    assert.doesNotThrow(() => page.confirmPendingChange())
    assert.equal(page._unsavedScheme, false)
    assert.equal(readScheme(runtime, page._contextId).preferences.groups.length, 0)
  } finally { runtime.dispose() }
})

test('project detail shows current nonempty notes read-only and leaves empty notes out of the view', () => {
  const runtime = createRuntime()
  let notesPage
  let emptyPage
  try {
    runtime.seed([])
    const project = {
      id: 'repair7-notes', name: '维修记录测试', notes: '场地有回声\n延时音箱需复核',
      createdAt: 1, updatedAt: 1, projectDate: '2026-10-20',
    }
    runtime.storage.set('audioTool.storageSchemaVersion', 4)
    runtime.storage.set('audioTool.projects.v1', [project])
    runtime.storage.set('audioTool.records.v1', [])
    runtime.storage.set('audioTool.favorites.v1', [])
    runtime.storage.set('audioTool.recovery.v1', [])
    notesPage = loadProjectPage(project)
    assert.equal(notesPage.data.editing, false, 'Notes are visible in normal project detail mode')
    assert.equal(notesPage.data.project.notes, project.notes)
    notesPage.startEditProject()
    assert.equal(notesPage.data.projectForm.notes, project.notes, 'The existing project editor retains its note value')
    assert.equal(notesPage.data.editing, true)

    const emptyProject = { ...project, id: 'repair7-empty-notes', notes: '' }
    runtime.storage.set('audioTool.projects.v1', [project, emptyProject])
    emptyPage = loadProjectPage(emptyProject)
    assert.equal(emptyPage.data.project.notes, '')
    const wxml = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
    const wxss = fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8')
    assert.match(wxml, /wx:if="\{\{project\.notes\}\}" class="interior-project-notes"/)
    assert.match(wxss, /\.interior-project-notes-copy\{[^}]*white-space:pre-wrap;[^}]*overflow-wrap:anywhere\}/)
    assert.match(wxml, /class="project-form-textarea" maxlength="300" value="\{\{projectForm\.notes\}\}"/)
  } finally {
    notesPage?.onUnload?.()
    emptyPage?.onUnload?.()
    runtime.dispose()
  }
})

test('layout address chips have a 44px touch box and text-distinguishable selection and placement states', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxss'), 'utf8')
  const addressWxss = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')
  assert.match(wxml, /class="fixture-address-chip[^\"]*"[\s\S]*?data-fixture-id="\{\{fixture\.id\}\}" bindtap="onPanelFixtureTap"/)
  assert.match(wxml, /wx:if="\{\{selectedFixtureId === fixture\.id\}\}" class="fixture-chip-selected-marker">选<\/view>/)
  assert.match(wxml, /wx:if="\{\{fixture\.placedOnSelectedRod\}\}" class="fixture-chip-check">✓<\/view>/)
  assert.match(wxml, /wx:elif="\{\{fixture\.placedElsewhere\}\}" class="fixture-chip-origin">\{\{fixture\.shortRodName\}\}<\/text>/)

  function finalValueIn(source, selector, property) {
    const pattern = /([^{}]+)\{([^{}]*)\}/g
    let value
    let match
    while ((match = pattern.exec(source))) {
      if (!match[1].split(',').map(item => item.trim()).includes(selector)) continue
      const declaration = match[2].split(';').map(item => item.trim()).find(item => item.startsWith(property + ':'))
      if (declaration) value = declaration.slice(property.length + 1).trim()
    }
    return value
  }
  const finalValue = (selector, property) => finalValueIn(wxss, selector, property)
  assert.equal(finalValue('.fixture-address-chip', 'height'), '44px')
  assert.equal(finalValue('.fixture-address-chip', 'min-height'), '44px')
  assert.equal(finalValue('.fixture-address-chip', 'min-width'), '44px')
  assert.equal(finalValue('.fixture-address-grid', 'grid-template-columns'), 'repeat(auto-fill,minmax(44px,1fr))')
  assert.equal(finalValue('.fixture-address-grid', 'gap'), '7px')
  assert.match(fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8'),
    /class="address-chips floating-chips"[\s\S]*?class="address-chip \{\{chip\.checked/)
  assert(Number.parseInt(finalValueIn(addressWxss, '.floating-chips .address-chip', 'min-width'), 10) >= 44)
  assert(Number.parseInt(finalValueIn(addressWxss, '.floating-chips .address-chip', 'min-height'), 10) >= 44)
  const darkAddressStyles = addressWxss.slice(addressWxss.indexOf('@media (prefers-color-scheme:dark)'))
  assert.match(darkAddressStyles, /\.address-chip\{background:var\(--group-tint\)\}/)
  assert.match(darkAddressStyles, /\.address-chip-checked\{color:#fff\}/)
  assert.match(addressWxss, /\.address-chip-checked\{border-color:var\(--group-color\);background:var\(--group-color\);color:#fff\}/)
  assert.match(fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8'),
    /wx:if="\{\{chip\.checked\}\}" class="chip-check"[^>]*>✓/)
})

const failures = []
for (const item of cases) {
  try {
    item.body()
    console.log(`PASS ${item.name}`)
  } catch (error) {
    failures.push({ name: item.name, error })
    console.log(`FAIL ${item.name}: ${error && error.stack || error}`)
  }
}
console.log(`SUMMARY repair7 owner decisions ${cases.length - failures.length}/${cases.length} passed; failures=${failures.length}`)
if (failures.length) process.exitCode = 1

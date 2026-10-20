const assert = require('node:assert/strict')
const { createRuntime, stageLightingProductIndex } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function seed(runtime, model = 'TL-SL323') {
  const product = stageLightingProductIndex.get(model)
  runtime.seed([{
    name: product.name,
    fixtureSource: 'library',
    fixtureModel: product.model,
    channelCount: String(product.channelModes[0]),
    libraryChannelCount: String(product.channelModes[0]),
    fixtureCount: '4',
    targetUniverse: 'A',
  }])
  runtime.storage.set('audioTool.projects.v1', [{ id: 'project-motion', name: '动效测试项目', createdAt: 1, updatedAt: 1, recordIds: [] }])
  return product
}

const cases = [
  ['catalog close is visual-only and reopening cancels the old close', async () => {
    const runtime = createRuntime()
    seed(runtime)
    try {
      const page = runtime.make('main')
      page.addGroup()
      assert.equal(page.data.fixtureSearchOpen, true)
      const writes = runtime.stats.writes
      page.onUserCloseFixturePicker()
      assert.equal(page.data.fixturePickerClosing, true)
      assert.equal(page.data.fixtureSearchOpen, true, 'The catalog must remain mounted during its exit frame')
      const keyword = page.data.fixtureSearchKeyword
      page.onFixtureSearchInput(runtime.event({}, { value: 'blocked while closing' }))
      page.clearFixtureSearch()
      assert.equal(page.data.fixtureSearchKeyword, keyword, 'A closing catalog must not accept more input')
      assert.equal(runtime.stats.writes, writes)

      page.addGroup()
      assert.equal(page.data.fixtureSearchOpen, true)
      assert.equal(page.data.fixturePickerClosing, false)
      await wait(220)
      assert.equal(page.data.fixtureSearchOpen, true, 'An older close timer removed a reopened catalog')
      assert.equal(page.data.fixturePickerClosing, false)
      page.closeFixturePicker()
      assert.equal(page.data.fixtureSearchOpen, false, 'Internal close paths remain synchronous')
    } finally { runtime.dispose() }
  }],
  ['add preview cancellation invalidates candidate immediately and commits nothing', async () => {
    const runtime = createRuntime()
    seed(runtime)
    try {
      const page = runtime.make('main')
      page.addGroup()
      page.selectFixture(runtime.event({ model: 'TL-SL323' }))
      assert.equal(page.data.pendingChange.kind, 'add')
      assert(page._pendingScheme)
      const before = runtime.workspace.readLightingWorkspace().scheme
      const writes = runtime.stats.writes

      page.onUserCancelPendingChange()
      assert.equal(page.data.pendingChangeClosing, true)
      assert.equal(page.data.pendingChange.kind, 'add', 'The add card stays mounted for its exit animation')
      assert.equal(page._pendingScheme, null, 'Cancelled candidate must be invalidated before visual removal')
      page.confirmPendingChange()
      assert.equal(runtime.stats.writes, writes, 'Confirm during closing must not commit')
      assert.deepEqual(runtime.workspace.readLightingWorkspace().scheme, before)
      await wait(220)
      assert.equal(page.data.pendingChange, null)
      assert.equal(page.data.pendingChangeClosing, false)
    } finally { runtime.dispose() }
  }],
  ['workspace revision changes do not strand a closing picker or restore stale pending data', async () => {
    const runtime = createRuntime()
    seed(runtime)
    try {
      const page = runtime.make('main')
      page.addGroup()
      page.onUserCloseFixturePicker()
      const pickerRevision = page._workspaceRevision
      page.commitCalculation({ startAddressText: '2' })
      assert(page._workspaceRevision > pickerRevision, 'The test must perform a real same-context scheme commit')
      await wait(220)
      assert.equal(page.data.fixtureSearchOpen, false, 'A same-context commit must not strand the closing picker')
      assert.equal(page.data.fixturePickerClosing, false)

      page.addGroup()
      page.selectFixture(runtime.event({ model: 'TL-SL323' }))
      page.onUserCancelPendingChange()
      assert.equal(page._pendingScheme, null, 'Cancel immediately invalidates the candidate')
      const writes = runtime.stats.writes
      page.commitCalculation({ startAddressText: '3' })
      const writesAfterCommit = runtime.stats.writes
      assert(writesAfterCommit > writes, 'The test must persist a new same-context scheme')
      const committedGroupIds = page._scheme.groupIds.slice()
      await wait(220)
      assert.equal(page.data.pendingChange, null)
      assert.equal(page.data.startAddressText, '3', 'The delayed visual close must not restore older business state')
      assert.deepEqual(page._scheme.groupIds, committedGroupIds)
      assert.equal(runtime.workspace.readLightingWorkspace().scheme.preferences.startAddressText, '3')
      assert.equal(runtime.stats.writes, writesAfterCommit, 'Removing the pending card must not write a second time')
    } finally { runtime.dispose() }
  }],
  ['save, guide, and report user close wait for exit while internal cleanup is immediate', async () => {
    const runtime = createRuntime()
    const profiles = require('../../pages/dmx-address/data/stage-lighting-channels').stageLightingChannelProfiles
    const guideModel = Object.keys(profiles).find(model => stageLightingProductIndex.get(model))
    assert(guideModel, 'Test catalog must include one fixture with a verified channel guide')
    seed(runtime, guideModel)
    try {
      const page = runtime.make('main')
      page.onSaveNewProjectToggle()
      page.onUserCloseSaveProjectDialog()
      assert.equal(page.data.saveProjectClosing, true)
      assert.equal(page.data.showSaveNewProject, true)
      page.retryProjectSave()
      await wait(220)
      assert.equal(page.data.showSaveNewProject, false)
      assert.equal(page.data.saveProjectClosing, false)

      const guideApi = require('../../pages/dmx-address/utils/dmx-channel-guide')
      const fixture = page._calculationResult.fixtures.find(item => guideApi.hasDmxChannelProfile(item.fixtureModel))
      assert(fixture, 'Test fixture must have a verified channel guide')
      page.openFixtureChannelGuide(runtime.event({ globalIndex: fixture.globalIndex }))
      assert(page.data.fixtureChannelGuide)
      page.setData({ fixtureChannelGuideDetail: { channel: 1 } })
      page.onUserCloseFixtureChannelGuide()
      assert.equal(page.data.fixtureChannelGuideClosing, true)
      page.closeFixtureChannelGuideDetail()
      assert.deepEqual(page.data.fixtureChannelGuideDetail, { channel: 1 }, 'Detail interaction must be blocked while closing')
      await wait(220)
      assert.equal(page.data.fixtureChannelGuide, null)

      page.setData({ resultReportPreviewVisible: true, resultReportImagePath: 'qa-image.png' })
      page.onUserCloseResultReportPreview()
      assert.equal(page.data.resultReportPreviewClosing, true)
      assert.equal(page.data.resultReportPreviewVisible, true)
      page.closeResultReportPreview()
      assert.equal(page.data.resultReportPreviewVisible, false, 'Internal report cleanup remains synchronous')
      assert.equal(page.data.resultReportPreviewClosing, false)
    } finally { runtime.dispose() }
  }],
  ['hide, unload, and context replacement cancel pending visual callbacks immediately', async () => {
    for (const lifecycle of ['hide', 'unload', 'context']) {
      const runtime = createRuntime()
      seed(runtime)
      try {
        const page = runtime.make('main')
        page.addGroup()
        page.onUserCloseFixturePicker()
        assert.equal(page.data.fixturePickerClosing, true)
        if (lifecycle === 'hide') {
          page.onHide()
        } else if (lifecycle === 'unload') {
          page.onUnload()
          page._qaActive = false
        } else {
          page.applyWorkspaceState(runtime.workspace.readLightingWorkspace('project-motion'), 'testContextSwitch')
        }
        if (lifecycle !== 'unload') {
          assert.equal(page.data.fixtureSearchOpen, false)
          assert.equal(page.data.fixturePickerClosing, false)
        }
        const patches = page._qaPatches.length
        await wait(220)
        assert.equal(page._qaPatches.length, patches, lifecycle + ': stale close timer changed the page after cleanup')
      } finally { runtime.dispose() }
    }
  }],
]

;(async () => {
  const results = []
  for (const [name, run] of cases) {
    try {
      await run()
      results.push({ name, passed: true })
      console.log('PASS ' + name)
    } catch (error) {
      results.push({ name, passed: false, error: error.stack })
      console.error('FAIL ' + name + '\n' + error.stack)
    }
  }
  assert(results.every(item => item.passed), 'Main modal lifecycle tests failed')
})().catch(error => { console.error(error); process.exitCode = 1 })

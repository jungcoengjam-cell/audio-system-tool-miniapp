const assert = require('node:assert/strict')
const { createRuntime } = require('./dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

function installImageMocks(shares) {
  global.wx.createCanvasContext = () => new Proxy({
    draw(_reserve, callback) { callback?.() },
    measureText(text) { return { width: String(text).length * 7 } },
  }, {
    get(target, key) {
      if (key in target) return target[key]
      return () => {}
    },
    set(target, key, value) { target[key] = value; return true },
  })
  global.wx.showShareImageMenu = ({ path }) => shares.push(path)
}

function makeMain() {
  const runtime = createRuntime({ deferExports: true })
  runtime.seed()
  const shares = []
  installImageMocks(shares)
  const page = runtime.make('main')
  const coldInitializationSetDataCount = page._qaPatches.length
  const normalized = page.commitCalculation()
  assert.equal(normalized.valid, true)
  page._qaPatches.length = 0
  assert.equal(page.data.result.valid, true)
  return { runtime, page, shares, coldInitializationSetDataCount }
}

function takeExport(runtime, predicate) {
  const index = runtime.exports.findIndex(predicate)
  assert.notEqual(index, -1, 'expected a pending export from the actual page flow')
  return runtime.exports.splice(index, 1)[0]
}

function reportExport(runtime) {
  return takeExport(runtime, (item) => Boolean(item.canvasId) && !item.canvas)
}

function layoutExport(runtime) {
  return takeExport(runtime, (item) => Boolean(item.canvas))
}

function generateReport(page, runtime, path) {
  page.generateResultReportImage()
  reportExport(runtime).success({ tempFilePath: path })
  assert.equal(page.data.resultReportImagePath, path)
  assert.equal(page.data.resultReportPreviewVisible, true)
}

function acceptQuantityChange(page, runtime) {
  const before = Number(page.data.groups[0].fixtureCount)
  page.onCardQuantityStep(runtime.event({ index: 0, delta: 1 }))
  assert.equal(page.data.pendingChange.valid, true)
  page.confirmPendingChange()
  assert.equal(Number(page.data.groups[0].fixtureCount), before + 1)
  assert.equal(page._unsavedScheme, false)
}

function testIdenticalSubmissionAndFullVisiblePatch() {
  const { runtime, page, coldInitializationSetDataCount } = makeMain()
  try {
    assert.equal(coldInitializationSetDataCount, 1, 'cold main-page initialization keeps its single setData')
    page._qaPatches.length = 0
    const writes = runtime.stats.writes
    const result = page.commitCalculation()
    assert.equal(result.valid, true)
    assert.equal(page._qaPatches.length, 0, 'identical valid submission emits no redundant setData')
    assert.equal(runtime.stats.writes, writes, 'identical valid submission does not persist again')

    page.setData({ activeWorkspace: 'plan', contextError: 'stale error', nextAvailableAddress: 'stale value' })
    page._qaPatches.length = 0
    page.commitCalculation({ activeWorkspace: 'config' })
    assert.equal(page._qaPatches.length, 1, 'a changed active workspace is not hidden by a matching calculation signature')
    assert.equal(page.data.activeWorkspace, 'config')
    assert.equal(page.data.contextError, '')
    assert.notEqual(page.data.nextAvailableAddress, 'stale value')

    page.setData({ contextError: 'stale error' })
    page._qaPatches.length = 0
    page.commitCalculation()
    assert.equal(page._qaPatches.length, 1, 'same-signature valid submission still clears a visible validation error')
    assert.equal(page.data.contextError, '')

    page.setData({ nextAvailableAddress: 'stale derived value' })
    page._qaPatches.length = 0
    page.commitCalculation()
    assert.equal(page._qaPatches.length, 1, 'same-signature submission repairs a changed derived view field')
    assert.notEqual(page.data.nextAvailableAddress, 'stale derived value')
  } finally {
    runtime.dispose()
  }
}

function testChangedInputAndUndoPatch() {
  const { runtime, page } = makeMain()
  try {
    const originalResult = JSON.stringify(page._calculationResult)
    const writes = runtime.stats.writes
    const changed = page.commitCalculation({ startAddressText: '2' })
    assert.equal(changed.valid, true)
    assert.notEqual(JSON.stringify(changed), originalResult, 'a real input change recalculates and submits the new result')
    assert.equal(page.data.startAddressText, '2')
    assert.ok(runtime.stats.writes > writes, 'a changed valid calculation retains persistence')
  } finally {
    runtime.dispose()
  }

  const deleted = makeMain()
  try {
    const { runtime: deleteRuntime, page: deletePage } = deleted
    deletePage.requestDeleteGroup(deleteRuntime.event({ index: 0 }))
    assert.equal(deletePage.data.pendingChange.kind, 'delete')
    deletePage.confirmPendingChange()
    assert.equal(deletePage.data.undoDeleteAvailable, true)
    deletePage._qaPatches.length = 0
    const result = deletePage.commitCalculation()
    assert.equal(result.valid, true)
    assert.equal(deletePage._qaPatches.length, 1, 'same-signature no-op preserves the distinct public undo-cleanup patch')
    assert.deepEqual(deletePage._qaPatches[0], { undoDeleteAvailable: false, undoDeleteText: '' })

    deletePage.data.selectedUniverseFixtures = new Array(1)
    deletePage._qaPatches.length = 0
    deletePage.commitCalculation()
    assert.equal(deletePage._qaPatches.length, 1, 'equal sparse-array keys with a different array length still update the complete visible patch')
    assert.equal(deletePage.data.selectedUniverseFixtures.length, 0)
  } finally {
    deleted.runtime.dispose()
  }
}

function testReportInvalidationCancellationReuseAndSharing() {
  const { runtime, page, shares } = makeMain()
  try {
    generateReport(page, runtime, 'dmx-current-before.png')
    const oldRevision = page.resultReportRevision
    page.generateResultReportImage()
    assert.equal(page.data.resultReportPreviewVisible, true, 'same-signature cached report opens without another export')
    assert.equal(runtime.exports.length, 0)
    page.shareResultReportImage()
    assert.deepEqual(shares, ['dmx-current-before.png'])

    const writes = runtime.stats.writes
    page.onCardQuantityStep(runtime.event({ index: 0, delta: 1 }))
    assert.equal(page.data.pendingChange.valid, true)
    page.cancelPendingChange()
    assert.equal(runtime.stats.writes, writes, 'preview and cancellation do not write the workspace')
    assert.equal(page.data.resultReportImagePath, 'dmx-current-before.png')
    assert.equal(page.resultReportRevision, oldRevision, 'cancelled preview preserves same-signature cache generation')

    const checkedFixture = page._calculationResult.fixtures[0]
    page.toggleFixtureCheck(runtime.event({ stableId: checkedFixture.stableId, globalIndex: 0 }))
    assert.equal(page.data.resultReportImagePath, 'dmx-current-before.png', 'check-only accepted change keeps the same report record')
    assert.equal(page.resultReportRevision, oldRevision)
  } finally {
    runtime.dispose()
  }
}

function testAcceptedChangeInvalidatesLateReportAndUsesCurrentPath() {
  const { runtime, page, shares } = makeMain()
  try {
    page.generateResultReportImage()
    const staleExport = reportExport(runtime)
    const staleRevision = page.resultReportRevision
    acceptQuantityChange(page, runtime)
    assert.ok(page.resultReportRevision > staleRevision, 'accepted render change invalidates the active report generation')
    assert.equal(page.data.resultReportImagePath, '')
    assert.equal(page.data.resultReportPreviewVisible, false)
    const currentSignature = page.getResultReportSignature()
    page.generateResultReportImage()
    const currentExport = reportExport(runtime)
    staleExport.success({ tempFilePath: 'dmx-obsolete.png' })
    assert.equal(page.data.resultReportImagePath, '', 'out-of-order old callback cannot replace an active current report generation')
    assert.equal(page.data.isGeneratingResultReport, true)
    currentExport.success({ tempFilePath: 'dmx-current-after.png' })
    assert.equal(page.data.resultReportImagePath, 'dmx-current-after.png')
    assert.equal(page.data.resultReportPreviewVisible, true)
    assert.equal(page.resultReportSignature, currentSignature)
    page.shareResultReportImage()
    assert.deepEqual(shares, ['dmx-current-after.png'], 'the report share entry uses the current generated path')
  } finally {
    runtime.dispose()
  }
}

function testSaveFailureDraftInvalidationAndLifecycle() {
  const failedSave = makeMain()
  try {
    const { runtime, page } = failedSave
    generateReport(page, runtime, 'dmx-before-save-failure.png')
    page.onCardQuantityStep(runtime.event({ index: 0, delta: 1 }))
    runtime.state.failWrites = true
    page.confirmPendingChange()
    assert.equal(page._unsavedScheme, true, 'failed persistence keeps the accepted valid draft')
    assert.equal(page.data.resultReportImagePath, '', 'visible valid draft cannot retain an obsolete report image')
    assert.equal(page.data.resultReportPreviewVisible, false)
    assert.equal(page.prepareToLeavePage(), false, 'existing unsaved-draft leave guard remains active')
    assert.equal(page._unsavedScheme, true)
  } finally {
    failedSave.runtime.dispose()
  }

  const failedExport = makeMain()
  try {
    const { runtime, page } = failedExport
    page.generateResultReportImage()
    reportExport(runtime).fail({ errMsg: 'mock export failure' })
    assert.equal(page.data.resultReportImagePath, '')
    assert.equal(page.data.isGeneratingResultReport, false)
    assert.ok(runtime.toasts.some((toast) => /图片生成失败/.test(toast.title)))
  } finally {
    failedExport.runtime.dispose()
  }

  const lifecycle = makeMain()
  try {
    const { runtime, page } = lifecycle
    page.generateResultReportImage()
    const pending = reportExport(runtime)
    page.onHide()
    assert.equal(page.data.isGeneratingResultReport, false)
    pending.success({ tempFilePath: 'dmx-hidden-late.png' })
    assert.equal(page.data.resultReportImagePath, '', 'hide invalidates an in-flight report callback')
    page.onShow()
    page.generateResultReportImage()
    const unloadPending = reportExport(runtime)
    page.onUnload()
    unloadPending.success({ tempFilePath: 'dmx-unloaded-late.png' })
    assert.equal(page.data.resultReportImagePath, '', 'unload invalidates an in-flight report callback')
  } finally {
    lifecycle.runtime.dispose()
  }
}

function testCurrentUnifiedLayoutShareUsesLatestWorkspace() {
  const runtime = createRuntime({ deferExports: true })
  runtime.seed()
  const shares = []
  installImageMocks(shares)
  const main = runtime.make('main')
  let layout
  try {
    main.openFixtureLayout()
    const navigation = runtime.navigation.at(-1)
    assert.match(navigation.url, /\/pages\/dmx-layout\/dmx-layout\?lightingContextId=/)
    assert.doesNotMatch(navigation.url, /openExport=1/, 'current UI entry opens the layout page before unified sharing')
    layout = runtime.make('portrait', { lightingContextId: main._contextId })
    assert.equal(layout._contextId, main._contextId)
    const originalCount = layout._exportSnapshot?.fixtures?.length ?? layout._fixtures.length

    layout.generateLayoutImage()
    const obsoleteExport = layoutExport(runtime)
    assert.ok(layout._exportSnapshot.fixtures.length > 0)
    layout.onHide()

    acceptQuantityChange(main, runtime)
    layout.onShow()
    assert.equal(layout._fixtures.length, originalCount + 1, 'layout reloads the accepted latest workspace revision')
    layout.generateLayoutImage()
    const currentExport = layoutExport(runtime)
    assert.equal(layout._exportSnapshot.fixtures.length, originalCount + 1)
    obsoleteExport.success({ tempFilePath: 'layout-obsolete.png' })
    assert.equal(layout.data.layoutImagePath, '', 'out-of-order hidden generation cannot publish over the current export')
    assert.equal(layout.data.isGeneratingImage, true)
    currentExport.success({ tempFilePath: 'layout-current.png' })
    assert.equal(layout.data.layoutImagePath, 'layout-current.png')
    assert.equal(layout.data.previewVisible, true)
    layout.shareImage()
    assert.deepEqual(shares, ['layout-current.png'], 'the current unified share button receives the latest layout image path')
  } finally {
    runtime.dispose()
  }
}

const cases = [
  ['identical submission and complete visible patch', testIdenticalSubmissionAndFullVisiblePatch],
  ['changed input and undo cleanup', testChangedInputAndUndoPatch],
  ['report cache cancellation, same-signature reuse, and sharing', testReportInvalidationCancellationReuseAndSharing],
  ['accepted change invalidates late report and shares current path', testAcceptedChangeInvalidatesLateReportAndUsesCurrentPath],
  ['save-failure draft, export failure, and lifecycle guards', testSaveFailureDraftInvalidationAndLifecycle],
  ['current unified layout sharing uses latest workspace', testCurrentUnifiedLayoutShareUsesLatestWorkspace],
]

for (const [name, test] of cases) {
  test()
  process.stdout.write(`PASS ${name}\n`)
}

process.stdout.write(`PASS ${cases.length} closeout8 DMX engineering cases\n`)

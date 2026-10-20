const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRuntime, clone, root } = require('./runtime.cjs')

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const sha256File = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
const reportPath = path.join(__dirname, 'evidence/native-acceptance-fix-2026-10-16/lifecycle-review.json')
const checks = []
const recordStorageKeys = new Set(['audioTool.projects.v1', 'audioTool.activeProject.v1', 'audioTool.storageSchemaVersion'])

function assertNoRecordStorageWrites(runtime) {
  const recordWrites = runtime.events.writes.filter(({ key }) => recordStorageKeys.has(key))
  assert.deepEqual(recordWrites, [], 'fixture exercise must not write project or active-record storage keys')
  return recordWrites.length
}

async function check(id, run) {
  try {
    const detail = await run()
    checks.push({ id, status: 'PASS', detail })
  } catch (error) {
    checks.push({ id, status: 'FAIL', error: error && error.stack ? error.stack : String(error) })
  }
}

function seedReportPreview(page) {
  page.setData({
    reportImages: [
      { title: 'Isolated lifecycle fixture', path: 'fixture://report-preview-page-1.png' },
      { title: 'Isolated lifecycle fixture 2', path: 'fixture://report-preview-page-2.png' },
    ],
    reportSavedPageIndices: [0],
  })
  page._reportSignature = 'isolated-fixture-signature'
  page._reportSavedPages = new Map([['isolated-fixture-signature', new Set([0])]])
  page.showReportPage(0)
}

function installUnloadWarningMock(runtime) {
  const events = []
  let active = false
  runtime.wx.enableAlertBeforeUnload = ({ message } = {}) => {
    active = true
    events.push({ action: 'enable', message: String(message || '') })
  }
  runtime.wx.disableAlertBeforeUnload = () => {
    active = false
    events.push({ action: 'disable' })
  }
  return {
    events,
    isActive: () => active,
  }
}

async function openPreviewAndWait(page) {
  seedReportPreview(page)
  await wait(310)
  assert.equal(page.data.reportPreviewVisible, true)
  assert.equal(page.data.workspaceOverlayPhases.report, '')
}

async function reviewReportClearIntent() {
  const runtime = createRuntime({ fixture: 'standard', count: 4 })
  const page = runtime.page()
  await openPreviewAndWait(page)

  assert.equal(page.data.reportImages.length, 2)
  assert.equal(page.data.reportImagePath, 'fixture://report-preview-page-1.png')
  page.invalidateExport(true)
  assert.equal(page.data.reportPreviewVisible, false)
  assert.equal(page.data.workspaceOverlayPhases.report, 'closing')
  assert.equal(page.data.reportImages.length, 2, 'image content must remain mounted through the exit animation')
  assert.equal(page.data.reportImagePath, 'fixture://report-preview-page-1.png')

  page.invalidateExport(false)
  assert.equal(page.data.workspaceOverlayPhases.report, 'closing')
  assert.equal(page.data.reportImages.length, 2, 'superseding invalidation must not clear mounted content early')
  assert.equal(page.data.reportImagePath, 'fixture://report-preview-page-1.png')
  await wait(270)

  assert.equal(page.data.workspaceOverlayPhases.report, '')
  assert.equal(page.data.reportImages.length, 0, 'the pending clear intent must survive invalidateExport(false)')
  assert.equal(page.data.reportImagePath, '')
  assert.deepEqual(page.data.reportSavedPageIndices, [])
  assert.equal(page._reportSavedPages.size, 0)
  assert.equal(page._reportSignature, '')
  assert.equal(assertNoRecordStorageWrites(runtime), 0)

  return {
    transition: 'visible -> invalidateExport(true) -> invalidateExport(false) -> exit complete',
    retainedUntilExit: true,
    imageCountAfterExit: page.data.reportImages.length,
    projectRecordWrites: 0,
    isolatedPreferenceWrites: runtime.events.writes.length,
  }
}

async function reviewFreshReportSupersedesPendingClear() {
  const runtime = createRuntime({ fixture: 'standard', count: 4 })
  const page = runtime.page()
  await openPreviewAndWait(page)
  page.invalidateExport(true)
  page.invalidateExport(false)

  const freshImages = [
    { title: 'Fresh isolated report', path: 'fixture://fresh-report-page-1.png' },
    { title: 'Fresh isolated report 2', path: 'fixture://fresh-report-page-2.png' },
  ]
  runtime.deferReportCallbacks(true)
  page._reportSignature = 'fresh-isolated-fixture-signature'
  page._reportSavedPages = new Map()
  page.setData({ reportImages: freshImages, reportPageIndex: 0 }, () => page.showReportPage(0))
  assert.equal(page.data.reportPreviewVisible, false, 'the fresh setData callback is intentionally held before display')
  assert.deepEqual(page.data.reportImages, freshImages)

  await wait(270)
  assert.deepEqual(page.data.reportImages, freshImages, 'the old close must not erase fresh images awaiting display')
  assert.equal(page.data.reportPreviewVisible, false)
  const releasedCallbacks = runtime.flushDataCallbacks()
  assert.equal(releasedCallbacks, 1)
  assert.equal(page.data.reportPreviewVisible, true)
  assert.equal(page.data.reportImagePath, 'fixture://fresh-report-page-1.png')
  assert.deepEqual(page.data.reportImages, freshImages)
  assert.equal(assertNoRecordStorageWrites(runtime), 0)
  page.onUnload()

  return {
    freshSignature: 'fresh-isolated-fixture-signature',
    callbackDeferredUntilAfterOldExit: true,
    freshImagesSurvivedOldClear: true,
    previewOpenedFromFreshCallback: true,
    projectRecordWrites: 0,
    isolatedPreferenceWrites: runtime.events.writes.length,
  }
}

async function reviewDeviceDiscardWarning() {
  const runtime = createRuntime({ fixture: 'standard', count: 4 })
  const warning = installUnloadWarningMock(runtime)
  const page = runtime.page()
  const draft = { type: 'receiver', name: 'Uncommitted fixture', count: '2' }
  page.setData({
    deviceEditorVisible: true,
    batchVisible: true,
    deviceDraft: draft,
    'workspaceOverlayPhases.deviceEditor': 'opening',
  })
  page._deviceDraftBaseline = JSON.stringify({ type: 'receiver', name: 'Baseline', count: '1' })
  page.syncUnloadWarning()
  assert.equal(warning.isActive(), true)

  page.requestCloseDeviceEditor()
  assert.equal(runtime.events.modals.length, 1)
  runtime.respondModal(true)

  assert.equal(page.data.deviceEditorVisible, false)
  assert.equal(page.data.workspaceOverlayPhases.deviceEditor, 'closing')
  assert.equal(warning.isActive(), false, 'discard must clear the unload warning as soon as closing starts')
  assert.equal(warning.events.at(-1).action, 'disable')
  assert.deepEqual(page.data.deviceDraft, draft, 'device draft must be retained during the exit animation')
  await wait(100)
  assert.deepEqual(page.data.deviceDraft, draft, 'device draft must remain available before the 240ms exit ends')
  await wait(170)

  assert.equal(page.data.workspaceOverlayPhases.deviceEditor, '')
  assert.deepEqual(page.data.deviceDraft, draft)
  assert.equal(assertNoRecordStorageWrites(runtime), 0)
  return {
    modalConfirmed: true,
    warningClearedBeforeExit: true,
    draftRetainedDuringExit: true,
    phaseAfterExit: page.data.workspaceOverlayPhases.deviceEditor,
    projectRecordWrites: 0,
    isolatedPreferenceWrites: runtime.events.writes.length,
  }
}

async function reviewLineDiscardWarning() {
  const runtime = createRuntime({ fixture: 'standard', count: 4 })
  const warning = installUnloadWarningMock(runtime)
  const page = runtime.page()
  const draft = {
    code: 'A900', fromDevice: 'Fixture source', fromDeviceId: 'receiver-1', fromPort: 'OUT fixture',
    toDevice: 'Fixture target', toDeviceId: 'mixer-1', toPort: 'IN fixture', purpose: 'Uncommitted fixture',
  }
  const projectId = 'qa-project-1'
  page.projectId = projectId
  page._projectLoadRevision = 42
  page._schedule = { revision: 7, devices: [], lines: [] }
  page._workspaceEditorSessionId = 9
  page.setData({
    project: { id: projectId, name: 'Isolated fixture project' },
    editorVisible: true,
    continuousVisible: false,
    draftIsNew: true,
    draft,
    'workspaceOverlayPhases.lineEditor': 'opening',
  })
  page._draftTouched = true
  page._workspaceDraftBaseline = JSON.stringify({ draft: null, pairs: [] })
  page.syncUnloadWarning()
  assert.equal(warning.isActive(), true)

  page.requestCloseEditor()
  assert.equal(runtime.events.modals.length, 1)
  runtime.respondModal(true)

  assert.equal(page.data.editorVisible, false)
  assert.equal(page.data.workspaceOverlayPhases.lineEditor, 'closing')
  assert.equal(warning.isActive(), false, 'discard must clear the unload warning as soon as closing starts')
  assert.equal(warning.events.at(-1).action, 'disable')
  assert.deepEqual(page.data.draft, draft, 'line draft must be retained during the exit animation')
  await wait(100)
  assert.deepEqual(page.data.draft, draft, 'line draft must remain available before the 240ms exit ends')
  await wait(170)

  assert.equal(page.data.workspaceOverlayPhases.lineEditor, '')
  assert.equal(page.data.draft, null, 'line draft may be cleared after the exit animation completes')
  assert.equal(assertNoRecordStorageWrites(runtime), 0)
  return {
    modalConfirmed: true,
    warningClearedBeforeExit: true,
    draftRetainedDuringExit: true,
    draftClearedAfterExit: page.data.draft === null,
    projectRecordWrites: 0,
    isolatedPreferenceWrites: runtime.events.writes.length,
  }
}

async function reviewHideCleanupGuard() {
  const runtime = createRuntime({ fixture: 'standard', count: 4 })
  const page = runtime.page()
  await openPreviewAndWait(page)
  const setDataCalls = []
  const originalSetData = page.setData
  page.setData = function (patch, callback) {
    setDataCalls.push(clone(patch))
    return originalSetData.call(this, patch, callback)
  }

  page.invalidateExport(true)
  page.onHide()
  assert.equal(page.data.reportPreviewVisible, false)
  const callsAfterHide = setDataCalls.length
  await wait(270)
  assert.equal(setDataCalls.length, callsAfterHide, 'a canceled report-close callback must not mutate after hide')
  assert.equal(assertNoRecordStorageWrites(runtime), 0)
  return { hiddenPreview: page.data.reportPreviewVisible, staleSetDataCalls: setDataCalls.length - callsAfterHide,
    projectRecordWrites: 0, isolatedPreferenceWrites: runtime.events.writes.length }
}

async function reviewUnloadCleanupGuard() {
  const runtime = createRuntime({ fixture: 'standard', count: 4 })
  const page = runtime.page()
  await openPreviewAndWait(page)
  page.invalidateExport(true)
  const dataBeforeUnload = {
    images: clone(page.data.reportImages),
    imagePath: page.data.reportImagePath,
    phase: page.data.workspaceOverlayPhases.report,
  }
  const writesAfterDestroy = []
  const originalSetData = page.setData
  page.setData = function (patch, callback) {
    if (this._destroyed) writesAfterDestroy.push(clone(patch))
    return originalSetData.call(this, patch, callback)
  }

  page.onUnload()
  const stateAtUnload = {
    images: clone(page.data.reportImages),
    imagePath: page.data.reportImagePath,
  }
  await wait(270)

  assert.deepEqual(stateAtUnload, { images: dataBeforeUnload.images, imagePath: dataBeforeUnload.imagePath })
  assert.deepEqual(writesAfterDestroy, [], 'deferred cleanup must not call setData after unload')
  assert.deepEqual({ images: page.data.reportImages, imagePath: page.data.reportImagePath }, stateAtUnload)
  assert.equal(assertNoRecordStorageWrites(runtime), 0)
  return { noPostUnloadSetData: writesAfterDestroy.length === 0, projectRecordWrites: 0,
    isolatedPreferenceWrites: runtime.events.writes.length }
}

async function main() {
  await check('report-clear-intent-survives-false-during-close', reviewReportClearIntent)
  await check('fresh-report-arriving-before-old-exit-cleanup-survives', reviewFreshReportSupersedesPendingClear)
  await check('device-discard-clears-warning-and-retains-draft-through-exit', reviewDeviceDiscardWarning)
  await check('line-discard-clears-warning-and-retains-draft-through-exit', reviewLineDiscardWarning)
  await check('hide-cancels-deferred-report-cleanup-callback', reviewHideCleanupGuard)
  await check('unload-prevents-deferred-report-cleanup-setdata', reviewUnloadCleanupGuard)

  const sourceFiles = [
    'pages/project-wiring/workspace-ui.js',
    'pages/project-wiring/index.js',
    'tests/project-wiring-redesign-2026-10-16/runtime.cjs',
  ]
  const result = {
    schemaVersion: 1,
    evidenceType: 'isolated-controller-lifecycle-unit',
    nativeTapProof: false,
    createdAtUtc: new Date().toISOString(),
    sourceHashes: Object.fromEntries(sourceFiles.map((name) => [name, sha256File(path.join(root, name))])),
    summary: {
      passed: checks.filter((item) => item.status === 'PASS').length,
      failed: checks.filter((item) => item.status === 'FAIL').length,
    },
    checks,
    limitations: [
      'Calls the production page/controller methods directly through the isolated in-memory wx runtime; it does not prove native event hit testing or physical-device behavior.',
      'Uses fixture:// report image paths and does not access production records, accounts, report jobs, or persistent storage.',
    ],
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ ...result, evidencePath: path.relative(root, reportPath) }, null, 2))
  if (result.summary.failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})

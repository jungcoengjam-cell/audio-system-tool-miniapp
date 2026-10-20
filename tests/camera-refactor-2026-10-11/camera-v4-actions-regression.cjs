'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')
const records = require('../../utils/records')

const PREFS_KEY = 'audioTool.camera.preferences'
const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'

function event(dataset = {}) { return { currentTarget: { dataset } } }

function createPage() {
  const env = createDelayedEnvironment()
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  records.getWorkspaceSnapshot({ forceRefresh: true })
  return { env, page }
}

function makeProject(name) {
  const project = records.createProject(name)
  assert(project, `could not create project ${name}`)
  records.getWorkspaceSnapshot({ forceRefresh: true })
  return project
}

function chooseProject(page, project) {
  assert.equal(page.saveToActiveProject(), true, 'the current library result should open project save')
  assert.equal(page.data.projectDialogStep, 'select')
  assert(page.data.projectProjects.some((item) => item.id === project.id))
  assert.equal(page.selectCameraProjectTarget(event({ id: project.id })), true)
  assert.equal(page.data.projectDialogStep, 'confirm')
}

function flushProjectSave(env, page) {
  assert.equal(page.saveCameraProjectTarget(), true, 'valid frozen project payload should begin save')
  assert.equal(page.data.projectSaving, true)
  env.flushNextTicks()
}

function testLibraryStateAndProjectSaveMetadataFlow() {
  const { env, page } = createPage()
  const projectA = makeProject('Camera V4 Project A')
  const projectB = makeProject('Camera V4 Project B')
  page.openCameraSelector()
  const dualViewCamera = page.data.selectorItems.find((item) => item.model === 'TS-0650JSM')
  assert(dualViewCamera, 'library selector should contain a dual-view test camera')
  page.selectCamera(event({ index: String(dualViewCamera.index) }))
  env.flushNextTicks()
  for (const handler of [
    'onSourceModeTap', 'onDefinitionModeTap', 'onCustomMountTypeTap',
    'copyInstallSummary', 'copyResult', 'toggleCalculationDetails',
  ]) assert.equal(typeof page[handler], 'undefined', `${handler} must remain removed from the V3 library-only page`)
  const initialResult = page.data.result
  const initialPreferences = page.getPreferences()

  chooseProject(page, projectA)
  page.onCameraProjectConfigNameInput({ detail: { value: '大厅广角配置' } })
  page.onCameraProjectConfigNoteInput({ detail: { value: '吊装点位 A' } })
  flushProjectSave(env, page)
  assert.equal(page.data.projectDialogStep, 'success')
  const signature = JSON.stringify(['camera', initialPreferences])
  const saved = records.getRecords().find((record) => record.signature === signature)
  assert(saved, 'camera save should reuse the existing result signature')
  const viewA = records.getProjectRecordView(saved, projectA.id)
  assert.equal(viewA.title, '大厅广角配置')
  assert.equal(viewA.projectNote, '吊装点位 A')
  assert.equal(saved.title, `${initialResult.displayModel} · ${initialResult.sceneLabel}`,
    'project metadata must not replace the favorite/default record title')
  assert.equal(page.data.result, initialResult, 'saving must preserve the live result object')
  assert.equal(page.data.sceneModeIndex, 0)

  page.closeCameraProjectDialog(true)
  env.flushNextTicks()
  chooseProject(page, projectB)
  page.onCameraProjectConfigNameInput({ detail: { value: '二层固定机位' } })
  page.onCameraProjectConfigNoteInput({ detail: { value: '柱边，避开灯具' } })
  flushProjectSave(env, page)
  const savedAgain = records.getRecords().find((record) => record.signature === signature)
  assert.equal(savedAgain.id, saved.id, 'same camera preferences retain the shared record identity')
  assert.deepEqual(savedAgain.projectIds.sort(), [projectA.id, projectB.id].sort())
  assert.equal(records.getProjectRecordView(savedAgain, projectA.id).title, '大厅广角配置')
  assert.equal(records.getProjectRecordView(savedAgain, projectA.id).projectNote, '吊装点位 A')
  assert.equal(records.getProjectRecordView(savedAgain, projectB.id).title, '二层固定机位')
  assert.equal(records.getProjectRecordView(savedAgain, projectB.id).projectNote, '柱边，避开灯具')

  const config = JSON.stringify(env.storage.get(PREFS_KEY))
  const recordsBeforeReset = JSON.stringify(env.storage.get(RECORDS_KEY))
  const projectsBeforeReset = JSON.stringify(env.storage.get(PROJECTS_KEY))
  const selectedCameraBeforeReset = page.data.selectedCamera.model
  page.closeCameraProjectDialog(true)
  for (let repetition = 0; repetition < 2; repetition += 1) {
    page.onSceneModeTap(event({ index: '1' }))
    env.flushNextTicks()
    assert.equal(page.data.result.sceneMode, 'plane')
    page.onSceneModeTap(event({ index: '0' }))
    env.flushNextTicks()
    assert.equal(page.data.result.sceneMode, 'ground')
    page.onHeightModeTap(event({ index: '1' }))
    env.flushNextTicks()
    assert.equal(page.data.result.heightMode, 'fixed')
    page.onHeightModeTap(event({ index: '0' }))
    env.flushNextTicks()
    assert.equal(page.data.result.heightMode, 'auto')
    page.onMarginChange({ detail: { value: 0 } })
    env.flushNextTicks()
    page.onMarginChange({ detail: { value: 4 } })
    env.flushNextTicks()
    page.onViewTap(event({ index: '1' }))
    env.flushNextTicks()
    assert.equal(page.data.viewIndex, 1)
    page.onViewTap(event({ index: '0' }))
    env.flushNextTicks()
    assert.equal(page.data.viewIndex, 0)
  }
  page.resetToDefaults()
  env.flushNextTicks()
  assert.equal(selectedCameraBeforeReset, 'TS-0650JSM', 'the reset fixture starts with a non-default camera')
  assert.equal(page.data.selectedCamera.model, 'TV-6124HK',
    'reset restores the default camera picker choice')
  assert.equal(page.data.sceneModeIndex, 0, 'reset restores the ground scene choice')
  assert.equal(page.data.heightModeIndex, 0, 'reset restores automatic camera height')
  assert.equal(page.data.marginOptions[page.data.marginIndex], 10, 'reset restores 10% margin')
  assert.equal(page.data.result, null, 'reset leaves the calculator empty until the user enters new values')
  for (const field of [
    'groundWidthText', 'groundDepthText', 'subjectHeightText',
    'planeWidthText', 'planeHeightText', 'planeBottomHeightText', 'fixedCameraHeightText',
    'customHorizontalFovText', 'customVerticalFovText', 'customSensorWidthText',
    'customSensorHeightText', 'customFocalLengthText',
  ]) assert.equal(page.data[field], '', `${field} is cleared instead of restoring a numeric default`)
  assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), recordsBeforeReset,
    'reset must not alter camera favorites or project metadata')
  assert.equal(JSON.stringify(env.storage.get(PROJECTS_KEY)), projectsBeforeReset,
    'reset must not alter project list')
  assert.notEqual(JSON.stringify(env.storage.get(PREFS_KEY)), config,
    'reset must persist the cleared preferences instead of restoring the default preferences')
  assert.deepEqual(env.storage.get(PREFS_KEY), page.getPreferences(),
    'reset persists the current cleared preferences for page reentry')

  page._cameraUnloaded = true
  return { status: 'passed', projects: 2, sharedRecord: saved.id, reset: 'cleared-without-defaults' }
}

function testCancelAndStaleTargetOrResultNeverWrite() {
  const { env, page } = createPage()
  const project = makeProject('Camera V4 Stale Target')
  const recordsBefore = JSON.stringify(env.storage.get(RECORDS_KEY))
  chooseProject(page, project)
  page.closeCameraProjectDialog(true)
  env.flushNextTicks()
  assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), recordsBefore,
    'closing before confirmation must not write a camera record')

  chooseProject(page, project)
  page.onSceneModeTap(event({ index: '1' }))
  env.flushNextTicks()
  assert.equal(page.data.result.sceneMode, 'plane')
  assert.equal(page.saveCameraProjectTarget(), false, 'a changed result invalidates the frozen save payload')
  assert.equal(page.data.projectSaveBlocked, true)
  assert.match(page.data.projectError, /关闭后.*项目保存/)
  assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), recordsBefore,
    'stale result cannot be saved through an open confirmation')
  page.closeCameraProjectDialog(true)
  env.flushNextTicks()

  chooseProject(page, project)
  records.deleteProject(project.id)
  assert.equal(page.saveCameraProjectTarget(), true, 'save attempts verify the target again in their async callback')
  env.flushNextTicks()
  assert.equal(page.data.projectDialogStep, 'select', 'a deleted target returns to project selection')
  assert.equal(page.data.projectTarget, null)
  assert.equal(records.getRecords().filter((record) => record.module === 'camera').length, 0,
    'a deleted target must not receive a camera record')
  page._cameraUnloaded = true
  return { status: 'passed', canceled: true, staleResult: 'blocked', staleTarget: 'reselected' }
}

function testHideAndUnloadInvalidateDelayedProjectSaveCallbacks() {
  for (const lifecycle of ['onHide', 'onUnload']) {
    const { env, page } = createPage()
    const project = makeProject(`Camera V4 ${lifecycle}`)
    chooseProject(page, project)
    assert.equal(page.saveCameraProjectTarget(), true)
    assert.equal(page.data.projectSaving, true)
    assert.equal(records.getProjectRecords(project.id).length, 0)

    page[lifecycle]()
    assert.equal(page.data.projectDialogVisible, false,
      `${lifecycle} immediately closes a saving dialog instead of leaving it stuck`)
    assert.equal(page.data.projectSaving, false)
    env.flushNextTicks()
    assert.equal(records.getProjectRecords(project.id).length, 0,
      `${lifecycle} invalidates the delayed callback before it can persist a record`)
    assert.equal(page.data.projectDialogVisible, false)
  }
  return { status: 'passed', hiddenAndUnloadedPendingSaves: 2, delayedCallbacks: 'invalidated' }
}

function testProjectReadAndWriteFailuresStayRecoverable() {
  {
    const { env, page } = createPage()
    const project = makeProject('Camera V4 Read Failure')
    const originalGet = env.wx.getStorageSync
    env.wx.getStorageSync = (key) => {
      if (key === PROJECTS_KEY) throw new Error('simulated project read failure')
      return originalGet(key)
    }
    assert.equal(page.saveToActiveProject(), true)
    assert.equal(page.data.projectLoadFailed, true)
    assert.match(page.data.projectError, /读取项目列表失败/)
    env.wx.getStorageSync = originalGet
    assert.equal(page.retryCameraProjectRead(), true)
    assert.equal(page.data.projectLoadFailed, false)
    assert(page.data.projectProjects.some((item) => item.id === project.id))
    page.closeCameraProjectDialog(true)
    page._cameraUnloaded = true
  }

  {
    const { env, page } = createPage()
    const project = makeProject('Camera V4 Write Failure')
    const recordsBefore = JSON.stringify(env.storage.get(RECORDS_KEY))
    chooseProject(page, project)
    const originalSet = env.wx.setStorageSync
    env.wx.setStorageSync = (key, value) => {
      if (key === RECORDS_KEY) throw new Error('simulated record write failure')
      return originalSet(key, value)
    }
    assert.equal(page.saveCameraProjectTarget(), true)
    env.flushNextTicks()
    env.wx.setStorageSync = originalSet
    assert.equal(page.data.projectSaving, false)
    assert.match(page.data.projectError, /保存失败/)
    assert.equal(JSON.stringify(env.storage.get(RECORDS_KEY)), recordsBefore,
      'failed writes must roll back and leave camera record storage unchanged')
    page.closeCameraProjectDialog(true)
    page._cameraUnloaded = true
  }
  return { status: 'passed', projectReadFailure: 'retryable', recordWriteFailure: 'rolled back' }
}

function testNativeReportPreviewAndCancellationFlow() {
  const { env, page } = createPage()
  const previews = []
  const shares = []
  const saves = []
  env.wx.getFileSystemManager = () => ({ access: ({ success }) => success() })
  env.wx.previewImage = (options) => previews.push(options)
  env.wx.showShareImageMenu = (options) => shares.push(options)
  env.wx.saveImageToPhotosAlbum = (options) => saves.push(options)

  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, 1)
  env.finishDraw(0)
  env.flushNextTicks()
  assert.equal(env.pending.canvases.length, 1)
  env.finishCanvas(0, 'wxfile://camera-v4-actions.png')
  env.flushNextTicks()
  assert.equal(page.data.resultReportPreviewVisible, true)
  const firstPath = 'wxfile://camera-v4-actions.png'
  assert.equal(page.data.resultReportImagePath, firstPath)
  assert.equal(page.previewResultReportImage(), true, 'preview action should open the current local image natively')
  assert.deepEqual(previews, [{ current: firstPath, urls: [firstPath] }],
    'camera original preview should pass the full current path through wx.previewImage')

  page.shareResultReportImage()
  assert.equal(shares.length, 1)
  shares[0].fail?.({ errMsg: 'showShareImageMenu:fail cancel' })
  page.saveResultReportImage()
  assert.equal(saves.length, 1)
  saves[0].fail?.({ errMsg: 'saveImageToPhotosAlbum:fail cancel' })
  assert.equal(env.effects.toasts.length, 0, 'native share/save cancel should not be reported as an error')

  assert.equal(page.closeResultReportPreview(true), true)
  assert.equal(page.data.resultReportPreviewVisible, false)
  const previewCountBeforeClosedTap = previews.length
  assert.equal(page.previewResultReportImage(), false, 'a closed share sheet cannot preview an image')
  assert.equal(previews.length, previewCountBeforeClosedTap)
  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(page.data.resultReportPreviewVisible, true,
    'unchanged cached report opens after file-access verification without a new render')
  assert.equal(env.pending.draws.length, 0)
  assert.equal(page.previewResultReportImage(), true, 'the reopened current cache remains previewable')
  assert.deepEqual(previews.at(-1), { current: firstPath, urls: [firstPath] })

  assert.equal(page.closeResultReportPreview(true), true)
  env.wx.getFileSystemManager = () => ({ access: ({ fail }) => fail() })
  assert.equal(page.generateResultReportImage(), true)
  env.flushNextTicks()
  assert.equal(page.data.resultReportImagePath, '',
    'a cached report whose local file is missing must be invalidated before regeneration')
  assert.equal(page.data.isGeneratingResultReport, true,
    'a failed cache access regenerates the current report')
  assert.equal(env.pending.draws.length, 1)
  env.finishDraw(0)
  env.flushNextTicks()
  assert.equal(env.pending.canvases.length, 1)
  env.finishCanvas(0, 'wxfile://camera-v4-actions-regenerated.png')
  env.flushNextTicks()
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-v4-actions-regenerated.png')
  assert.equal(page.data.resultReportPreviewVisible, true,
    'a successful regeneration reopens the report preview')
  const previewCountBeforeMissing = previews.length
  env.wx.getFileSystemManager = () => ({ access: ({ fail }) => fail({ errMsg: 'missing cached image' }) })
  assert.equal(page.previewResultReportImage(), true, 'an original-image tap should check the cached local file')
  assert.equal(previews.length, previewCountBeforeMissing, 'a missing local image must not reach wx.previewImage')
  assert.equal(page.data.resultReportImagePath, '', 'missing preview files must invalidate the cached path')
  assert.equal(page.data.resultReportPreviewVisible, false, 'missing preview files must close the stale report sheet')

  env.wx.getFileSystemManager = () => ({ access: ({ success }) => success() })
  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, 1, 'a missing cache path should be regenerated before another preview')
  env.finishDraw(0)
  env.flushNextTicks()
  env.finishCanvas(0, 'wxfile://camera-v4-actions-recovered.png')
  env.flushNextTicks()
  assert.equal(page.previewResultReportImage(), true)
  assert.deepEqual(previews.at(-1), {
    current: 'wxfile://camera-v4-actions-recovered.png',
    urls: ['wxfile://camera-v4-actions-recovered.png'],
  })

  page.onHide()
  assert.equal(page.data.resultReportPreviewVisible, false)
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-v4-actions-recovered.png',
    'hide closes the report sheet but preserves a valid cached path')
  const previewCountBeforeHiddenTap = previews.length
  assert.equal(page.previewResultReportImage(), false, 'a hidden page cannot preview its cached image')
  assert.equal(previews.length, previewCountBeforeHiddenTap)
  env.flushNextTicks()
  page.onShow()

  page._cameraUnloaded = true
  return { status: 'passed', report: 'render/cache/native-preview/share/save/hide' }
}

function testDelayedNativePreviewAccessIsFenced() {
  let cases = 0
  for (const mutation of ['hide', 'input']) {
    const { env, page } = createPage()
    const previews = []
    env.wx.previewImage = (options) => previews.push(options)
    let pendingAccess = null
    env.wx.getFileSystemManager = () => ({ access: (options) => { pendingAccess = options } })
    page.generateResultReportImage()
    env.flushNextTicks()
    env.finishDraw(0)
    env.flushNextTicks()
    env.finishCanvas(0, `wxfile://camera-delayed-${mutation}.png`)
    env.flushNextTicks()
    const imagePath = page.data.resultReportImagePath
    assert(imagePath)

    page.previewResultReportImage()
    assert(pendingAccess, `${mutation}: preview should await local file access before opening`)
    assert.equal(pendingAccess.path, imagePath)
    if (mutation === 'hide') {
      page.onHide()
    } else {
      page.onFieldInput({
        currentTarget: { dataset: { field: 'subjectHeightText' } },
        detail: { value: '1.9' },
      })
      assert.equal(page.data.resultReportImagePath, '', 'input changes invalidate the path before access resolves')
    }
    pendingAccess.success()
    env.flushNextTicks()
    assert.deepEqual(previews, [],
      `${mutation}: delayed access after page invalidation must not open the native image preview`)
    page.onHide()
    page._cameraUnloaded = true
    cases += 1
  }
  return { status: 'passed', delayedPreviewAccess: 'fenced-after-hide-and-input-change', cases }
}

function testPendingReportDoesNotReopenAfterHide() {
  const { env, page } = createPage()
  page.generateResultReportImage()
  assert.equal(page.data.isGeneratingResultReport, true)
  page.onHide()
  env.flushNextTicks()
  assert.equal(page.data.isGeneratingResultReport, false)
  assert.equal(page.data.resultReportPreviewVisible, false)
  assert.equal(env.pending.draws.length, 0,
    'a delayed setData callback cannot begin drawing after the page is hidden')
  assert.equal(page.data.resultReportImagePath, '')
  page._cameraUnloaded = true
  return { status: 'passed', delayedReportStartAfterHide: false }
}

function testDeferredActionsDoNotResumeAcrossHideAndShow() {
  for (const action of ['report', 'project']) {
    const { env, page } = createPage()
    const project = action === 'project' ? makeProject('Camera V4 Deferred Project') : null
    const beforeRevision = page._inputRevision || 0
    page.onFieldInput({
      currentTarget: { dataset: { field: 'subjectHeightText' } },
      detail: { value: '1.9' },
    })
    assert(page.data.resultUpdating, 'a valid input schedules a pending calculation while preserving the current result')
    assert(page._inputRevision > beforeRevision, 'input changes advance the report freshness revision')
    if (action === 'report') page.generateResultReportImage()
    else page.saveToActiveProject()

    page.onHide()
    page.onShow()
    env.flushNextTicks()
    assert.equal(page.data.resultReportPreviewVisible, false,
      'a deferred report action cannot reopen after a hide/show lifecycle boundary')
    assert.equal(page.data.isGeneratingResultReport, false)
    assert.equal(env.pending.draws.length, 0)
    assert.equal(page.data.projectDialogVisible, false,
      'a deferred project action cannot open a project sheet after a hide/show lifecycle boundary')
    if (project) assert.equal(records.getProjectRecords(project.id).length, 0)
    page._cameraUnloaded = true
  }
  return { status: 'passed', deferredReport: 'blocked-after-hide-show', deferredProject: 'blocked-after-hide-show' }
}

function testDeferredActionsResumeWhenPageStaysVisible() {
  {
    const { env, page } = createPage()
    page.onFieldInput({
      currentTarget: { dataset: { field: 'subjectHeightText' } },
      detail: { value: '1.95' },
    })
    page.generateResultReportImage()
    env.flushNextTicks()
    assert.equal(page.data.resultUpdating, false)
    assert.equal(env.pending.draws.length, 1,
      'a pending report request should continue after a successful calculation in the same visible page')
    page.onHide()
    page._cameraUnloaded = true
  }

  {
    const { env, page } = createPage()
    page.onFieldInput({
      currentTarget: { dataset: { field: 'subjectHeightText' } },
      detail: { value: '1.95' },
    })
    page.saveToActiveProject()
    env.flushNextTicks()
    assert.equal(page.data.resultUpdating, false)
    assert.equal(page.data.projectDialogVisible, true,
      'a pending project request should continue after a successful calculation in the same visible page')
    assert.equal(page.data.projectDialogStep, 'select')
    page.onHide()
    page._cameraUnloaded = true
  }
  return { status: 'passed', pendingReport: 'resumed-while-visible', pendingProject: 'resumed-while-visible' }
}

function run() {
  return {
    status: 'passed',
    suite: 'camera V4 action/controller regression',
    projectFlow: testLibraryStateAndProjectSaveMetadataFlow(),
    cancelAndStaleGuards: testCancelAndStaleTargetOrResultNeverWrite(),
    lifecycle: testHideAndUnloadInvalidateDelayedProjectSaveCallbacks(),
    storageFailures: testProjectReadAndWriteFailuresStayRecoverable(),
    reportFlow: testNativeReportPreviewAndCancellationFlow(),
    delayedNativePreview: testDelayedNativePreviewAccessIsFenced(),
    hiddenReportCallback: testPendingReportDoesNotReopenAfterHide(),
    deferredActions: testDeferredActionsDoNotResumeAcrossHideAndShow(),
    visibleDeferredActions: testDeferredActionsResumeWhenPageStaysVisible(),
    wxApiLimitation: 'This regression uses the delayed harness and mocked WeChat APIs; it does not verify native permissions or system share/photo-library UI.',
  }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`)

module.exports = { run }

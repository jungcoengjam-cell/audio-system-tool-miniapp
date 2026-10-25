'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const {
  createPage,
  installPlatform,
  loadPageDefinition,
  root,
} = require('./harness.cjs')

const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const ACTIVE_PROJECT_KEY = 'audioTool.activeProject.v1'
const PREFERENCE_KEY = 'audioTool.spl.preferences'
const DEFAULT_PREFERENCES = {
  speakerModel: 'TS-803C',
  distanceText: '4',
  speakerCount: 1,
  summationMode: 'distributed',
}
const EMPTY_PREFERENCES = {
  speakerModel: '',
  speakerCount: null,
  distanceText: '',
  summationMode: 'distributed',
}

function createSession(options = {}) {
  const platform = installPlatform({
    windowWidth: options.windowWidth || 390,
    windowHeight: options.windowHeight || 671,
    deferDrawCallbacks: Boolean(options.deferDrawCallbacks),
    accessibleFiles: options.accessibleFiles || [],
    initialStorage: {
      [RECORDS_KEY]: [],
      [PROJECTS_KEY]: [],
      [ACTIVE_PROJECT_KEY]: '',
      'audioTool.storageSchemaVersion': 3,
      ...(options.initialStorage || {}),
    },
  })
  const definition = loadPageDefinition()
  const page = createPage(definition)
  page.onLoad()
  page.onShow()
  return { page, platform, records: require(path.join(root, 'utils/records.js')) }
}

function withSession(callback, options) {
  const session = createSession(options)
  try { callback(session) } finally { session.platform.restore() }
}

function approx(actual, expected, epsilon = 0.0001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`)
}

function event(page, field, extra = {}) {
  return {
    currentTarget: {
      dataset: {
        projectField: field,
        projectRevision: page._projectRevision,
        projectEpisode: page._projectKeyboardEpisode,
      },
    },
    timeStamp: 1000,
    size: { windowHeight: 671 },
    ...extra,
  }
}

function testInitialValuesAndPendingGate() {
  withSession(({ page, platform }) => {
    assert.equal(page.data.selectedSpeaker.model, 'TS-803C')
    assert.equal(page.data.distanceText, '4')
    assert.equal(page.data.counts[page.data.countIndex], 1)
    assert.equal(page.data.summationModes[page.data.summationModeIndex].value, 'distributed')
    approx(page.data.result.selectedSpl, 107.7)
    approx(page.data.result.oneMeterSpl, 119.8)
    assert.equal(page.copyResult instanceof Function, true, 'copyResult remains an internal compatibility method')
    assert.equal(platform.writeLog.some((entry) => entry.key === PREFERENCE_KEY), false,
      'onLoad must not rewrite unchanged preferences')

    const lookup = page.getRecordLookupPayload()
    const payload = page.getRecordPayload()
    assert.equal(lookup.module, 'spl')
    assert.deepEqual(lookup.preferences, DEFAULT_PREFERENCES)
    assert.equal(payload.module, 'spl')
    assert.equal(payload.title, 'TS-803C × 1 只')
    assert.ok(payload.resultText.includes('107.7 dB SPL'))

    const oldResult = page.data.result
    page.onDistanceInput({ detail: { value: '5' } })
    assert.equal(page.data.isCalculationPending, true)
    assert.equal(page.data.canUseResultActions, false)
    assert.equal(page.data.canReset, true)
    assert.equal(page.data.result, oldResult, 'cached result may remain in memory during the debounce')
    assert.equal(page.getRecordLookupPayload(), null)
    assert.equal(page.getRecordPayload(), null)
    assert.equal(page.getResultText(), '')
    const explicit = page.getRecordPayload({ ...page.data, distanceText: '4' }, oldResult)
    assert.equal(explicit.title, 'TS-803C × 1 只', 'explicit state and result remain usable')

    platform.clock.tick(159)
    assert.equal(page.data.isCalculationPending, true, 'calculation does not run before 160 ms')
    assert.equal(page.data.result.distanceMeters, 4)
    platform.clock.tick(1)
    assert.equal(page.data.isCalculationPending, false)
    assert.equal(page.data.canUseResultActions, true)
    assert.equal(page.data.result.distanceMeters, 5)
    assert.equal(page.getRecordPayload().preferences.distanceText, '5')
  })
}

function testModelCountSummationAndInvalidInputs() {
  withSession(({ page }) => {
    page.openSpeakerSelector()
    assert.equal(page.data.selectorItems.length, 60)
    assert.ok(page.data.selectorTotalCount > 120)
    const { speakers } = require(path.join(root, 'data/equipment.js'))
    const incompleteSpeaker = speakers.find((item) => item.model === 'TS-403C')
    assert.ok(incompleteSpeaker && !Number.isFinite(incompleteSpeaker.sensitivityDb),
      'TS-403C is the current real catalog example missing calculation data')
    assert.equal(page._selectorMatches.some((item) => item.model === incompleteSpeaker.model), false,
      'a product without sensitivity data is excluded from selectable models')
    const { calculateSpeakerSpl } = require(path.join(root, 'utils/spl.js'))
    assert.equal(calculateSpeakerSpl({ speaker: incompleteSpeaker, distanceMeters: 4 }), null)
    page.appendSelectorItems()
    assert.equal(page.data.selectorItems.length, 120)
    assert.ok(page.data.selectorItems.every((item) => !item.ratedPower && !item.source),
      'selector rows contain the compact public catalog projection')
    const other = page._selectorMatches.find((item) => item.model !== 'TS-803C')
    assert.ok(other)
    page.selectSpeaker({ currentTarget: { dataset: { index: other.index } } })
    assert.equal(page.data.result.model, other.model)

    page.onPickerChange({ currentTarget: { dataset: { field: 'countIndex' } }, detail: { value: 1 } })
    assert.equal(page.data.counts[page.data.countIndex], 2)
    assert.equal(page.data.showSummationMode, true)
    const distributed = page.data.result.selectedSpl
    page.onPickerChange({ currentTarget: { dataset: { field: 'summationModeIndex' } }, detail: { value: 1 } })
    assert.equal(page.data.result.summationMode, 'coherent')
    assert.ok(page.data.result.selectedSpl > distributed)

    const numericCountIndexBeforeUiAdapter = page.data.countIndex
    page.onCountPickerChange({ detail: { value: 0 } })
    assert.equal(page.data.countIndex, -1, 'the picker placeholder maps to the unchanged empty numeric count index')
    assert.equal(page.data.result, null, 'the placeholder never indexes the count list')
    page.onCountPickerChange({ detail: { value: 1 } })
    assert.equal(page.data.countIndex, 0, 'UI picker index 1 maps to numeric countIndex 0')
    assert.equal(page.data.counts[page.data.countIndex], 1)
    assert.equal(page.data.result.speakerCount, 1)
    assert.equal(numericCountIndexBeforeUiAdapter, 1,
      'the existing numeric countIndex contract remains unchanged')
    assert.equal(page.onCountPickerChange({ detail: { value: -1 } }), false)
    assert.equal(page.onCountPickerChange({ detail: { value: page.data.countPickerOptions.length } }), false)

    for (const invalidDistance of ['not-a-distance', '0', '1001']) {
      page.onDistanceInput({ detail: { value: invalidDistance } })
      assert.equal(page.data.canReset, true)
      page.onDistanceBlur()
      assert.equal(page.data.result, null)
      assert.equal(page.data.distanceError.length > 0, true)
      assert.equal(page.data.canUseResultActions, false)
      assert.equal(page.getRecordPayload(), null)
    }
  })
}

function testResetPreservesRecordsAndHandlesStorageFailure() {
  withSession(({ page, platform, records }) => {
    const payload = page.getRecordPayload()
    const favorite = records.toggleFavorite(payload)
    assert.ok(favorite?.favorite)
    page.onShow()
    assert.equal(page.data.currentFavorite, true)

    page.onDistanceInput({ detail: { value: '6' } })
    page.onDistanceBlur()
    page.openSpeakerSelector()
    page.onSelectorInput({ detail: { value: 'TS-' } })
    page.data.resultReportImagePath = '/tmp/old-spl-report.png'
    const previousResult = page.data.result
    platform.failedWrites.add(PREFERENCE_KEY)
    assert.equal(page.requestReset(), false, 'reset click reports a failed preference write')
    assert.equal(page.data.result, previousResult, 'failed preference persistence leaves current input/result intact')
    assert.match(page.data.resetError, /保存失败/)
    assert.equal(platform.toastLog.at(-1)?.title, '清空失败，请重试',
      'failed preference persistence reports the failure to the user')
    assert.equal(records.getRecords().length, 1)
    assert.equal(records.getRecords()[0].favorite, true)

    platform.failedWrites.delete(PREFERENCE_KEY)
    assert.equal(page.clearSplInputs(), true)
    assert.deepEqual(page.getPreferences(), EMPTY_PREFERENCES)
    assert.equal(page.data.selectedSpeaker, null)
    assert.equal(page.data.speakerIndex, -1)
    assert.equal(page.data.countIndex, -1)
    assert.equal(page.data.distanceText, '')
    assert.equal(page.data.result, null)
    assert.equal(page.getResultText(), '')
    assert.equal(page.getRecordPayload(), null, 'blank reset cannot be saved or dereference a missing speaker')
    assert.equal(page.getRecordLookupPayload(), null)
    assert.equal(page.data.summationModes[page.data.summationModeIndex].value, 'distributed')
    assert.equal(page.data.selectorVisible, false)
    assert.equal(page.data.selectorKeyword, '')
    assert.equal(page.data.speakerKeyword, '')
    assert.equal(page.data.resultReportImagePath, '')
    assert.equal(page.data.currentFavorite, false, 'blank reset has no active favorite identity')
    assert.equal(records.getRecords().length, 1, 'reset preserves saved record')
    assert.equal(records.getRecords()[0].favorite, true, 'reset preserves favorite')
    assert.deepEqual(platform.storage.get(PREFERENCE_KEY), EMPTY_PREFERENCES,
      'reset persists an explicit empty preference record')
  })

  withSession(({ page, platform }) => {
    page.onDistanceInput({ detail: { value: '7' } })
    page.onDistanceBlur()
    const writesBeforeReset = platform.writeLog.filter((entry) => entry.key === PREFERENCE_KEY).length
    assert.equal(page.requestReset(), true)
    assert.equal(platform.modalLog.length, 0, 'reset clears directly without a confirmation modal')
    assert.deepEqual(page.getPreferences(), EMPTY_PREFERENCES)
    assert.equal(page.requestReset(), false, 'a repeated reset tap is ignored after inputs are blank')
    assert.equal(platform.writeLog.filter((entry) => entry.key === PREFERENCE_KEY).length, writesBeforeReset + 1,
      'one accepted reset tap writes preferences once')
  })

  let persistedEmptyPreferences
  withSession(({ page, platform }) => {
    assert.equal(page.requestReset(), true)
    persistedEmptyPreferences = platform.storage.get(PREFERENCE_KEY)
  })

  withSession(({ page, platform }) => {
    assert.deepEqual(page.getPreferences(), EMPTY_PREFERENCES,
      'a persisted empty preference record reopens blank instead of restoring first-use defaults')
    assert.equal(page.data.selectedSpeaker, null)
    assert.equal(page.data.speakerIndex, -1)
    assert.equal(page.data.countIndex, -1)
    assert.equal(page.data.distanceText, '')
    assert.equal(page.data.result, null)
    assert.equal(platform.writeLog.some((entry) => entry.key === PREFERENCE_KEY), false,
      'reopening blank does not rewrite empty preferences')
    page.onCountPickerChange({ detail: { value: 1 } })
    assert.equal(page.data.countIndex, 0, 'empty count picker chooses the first real option through the UI handler')
    assert.equal(page.data.counts[page.data.countIndex], 1)
    assert.equal(page.data.result, null, 'selecting a count without a model remains invalid')
  }, { initialStorage: { [PREFERENCE_KEY]: persistedEmptyPreferences } })
}

function testProjectKeyboardEventsAndMetadataIdentity() {
  withSession(({ page, records, platform }) => {
    assert.equal(page.openProjectSheet(), true)
    assert.equal(page.data.projectLoadState, 'ready')
    assert.equal(page.beginNewProject(), true)
    page.onNewProjectNameInput({ ...event(page, 'newProjectName'), detail: { value: 'SPL 测试项目 A' } })
    assert.equal(page.createProjectFromForm(), true)
    const firstProjectId = page.data.projectTargetId
    assert.equal(page.data.projectStep, 'details')
    page.onProjectConfigNameInput({ ...event(page, 'projectConfigName'), detail: { value: '小厅主扩' } })
    page.onProjectConfigNoteInput({ ...event(page, 'projectConfigNote'), detail: { value: '第一项目私有备注' } })
    assert.equal(page.saveProjectConfiguration(), true)
    const firstSavedRecord = records.getRecords()[0]
    assert.equal(records.getProjectRecordView(firstSavedRecord, firstProjectId).title, '小厅主扩')
    assert.equal(records.getProjectRecordView(firstSavedRecord, firstProjectId).projectNote, '第一项目私有备注')

    assert.equal(page.continueAfterProjectSave(), true)
    assert.equal(page.beginNewProject(), true)
    page.onNewProjectNameInput({ ...event(page, 'newProjectName'), detail: { value: 'SPL 测试项目 B' } })
    assert.equal(page.createProjectFromForm(), true)
    const secondProjectId = page.data.projectTargetId
    page.onProjectConfigNameInput({ ...event(page, 'projectConfigName'), detail: { value: '小厅返送' } })
    page.onProjectConfigNoteInput({ ...event(page, 'projectConfigNote'), detail: { value: '第二项目私有备注' } })
    assert.equal(page.saveProjectConfiguration(), true)
    const recordsAfterBoth = records.getRecords()
    assert.equal(recordsAfterBoth.length, 1, 'same SPL parameter identity deduplicates across projects')
    assert.equal(recordsAfterBoth[0].id, firstSavedRecord.id)
    assert.deepEqual(new Set(recordsAfterBoth[0].projectIds), new Set([firstProjectId, secondProjectId]))
    assert.equal(records.getProjectRecordView(recordsAfterBoth[0], secondProjectId).title, '小厅返送')
    assert.equal(records.getProjectRecordView(recordsAfterBoth[0], secondProjectId).projectNote, '第二项目私有备注')

    assert.equal(records.deleteProject(firstProjectId), true)
    const afterDelete = records.getRecords()[0]
    assert.equal(afterDelete.projectIds.includes(firstProjectId), true,
      'recoverable project deletion preserves record associations')
    assert.equal(afterDelete.projectMetadata[firstProjectId].name, '小厅主扩',
      'recoverable project deletion preserves project metadata')
    assert.equal(records.getProjects().some((project) => project.id === firstProjectId), false)
    assert(records.getRecoveryEntries().some((entry) => entry.kind === 'project'
      && entry.targetId === firstProjectId), 'deleted project should remain recoverable')
    assert.equal(records.getProjectRecordView(afterDelete, secondProjectId).projectNote, '第二项目私有备注')

    assert.equal(page.continueAfterProjectSave(), true)
    const target = page.data.projectItems.find((item) => item.id === secondProjectId)
    assert.ok(target)
    assert.equal(page.chooseProject({ currentTarget: { dataset: { id: secondProjectId } } }), true)
    const staleEvent = event(page, 'projectConfigName', {
      currentTarget: { dataset: {
        projectField: 'projectConfigName',
        projectRevision: page._projectRevision - 1,
        projectEpisode: page._projectKeyboardEpisode,
      } },
    })
    assert.equal(page.onProjectInputFocus(staleEvent), false)
    const focus = event(page, 'projectConfigNote')
    assert.equal(page.onProjectInputFocus(focus), true)
    const keyboard = event(page, 'projectConfigNote', { detail: { height: 280 } })
    assert.equal(page.onProjectKeyboardHeightChange(keyboard), true)
    assert.equal(page.data.projectKeyboardActive, true)
    assert.equal(page.data.projectKeyboardPanelStyle, 'max-height:calc(391px - 10px);margin-bottom:280px;',
      'keyboard max-height subtracts the overlay safe area exactly once')
    const oldEpisode = event(page, 'projectConfigNote', {
      currentTarget: { dataset: {
        projectField: 'projectConfigNote',
        projectRevision: page._projectRevision,
        projectEpisode: page._projectKeyboardEpisode - 1,
      } },
      detail: { height: 320 },
    })
    assert.equal(page.onProjectKeyboardHeightChange(oldEpisode), false)
    assert.equal(page.data.projectKeyboardActive, true)
    const currentRevision = page._projectRevision
    const currentEpisode = page._projectKeyboardEpisode
    page.closeProjectSheet()
    assert.equal(page.onProjectKeyboardHeightChange(keyboard), false, 'keyboard event is ignored after sheet close')
    assert.ok(page._projectRevision > currentRevision || page._projectKeyboardEpisode > currentEpisode)
    assert.equal(platform.wx.hideKeyboard instanceof Function, true)
  })
}

function testProjectSaveFailureIsAtomic() {
  withSession(({ page, platform, records }) => {
    assert.equal(page.openProjectSheet(), true)
    assert.equal(page.beginNewProject(), true)
    page.onNewProjectNameInput({ ...event(page, 'newProjectName'), detail: { value: '存储失败项目' } })
    assert.equal(page.createProjectFromForm(), true)
    page.onProjectConfigNameInput({ ...event(page, 'projectConfigName'), detail: { value: '测试配置' } })
    platform.failedWrites.add(RECORDS_KEY)
    assert.equal(page.saveProjectConfiguration(), false)
    assert.equal(records.getRecords().length, 0)
    assert.match(page.data.projectSaveError, /保存失败/)
  })
}

function testReportLifecycleAndLateCallbacks() {
  withSession(({ page, platform }) => {
    page._deferSetDataCallbacks = true
    assert.equal(page.openSharePreview(), true)
    assert.equal(platform.canvasExports.length, 0)
    assert.equal(page.flushSetDataCallbacks(), 1, 'open callback is held until the simulated async setData completion')
    assert.equal(platform.canvasExports.length, 0)
    page.flushSetDataCallbacks()
    assert.equal(page.data.isGeneratingResultReport, true)
    assert.equal(page.generateResultReportImage(), false, 'duplicate generation is ignored')
    page._deferSetDataCallbacks = false
    page.flushSetDataCallbacks()
    assert.equal(platform.drawCallbacks.length, 1)
    platform.runNextDrawCallback()
    assert.equal(platform.canvasExports.length, 1)
    assert.equal(platform.canvasExports[0].width, 750)
    platform.rejectCanvasExport()
    assert.equal(page.data.isGeneratingResultReport, false)
    assert.equal(page.data.resultReportPreviewVisible, false)
    assert.equal(page.retryResultReport(), true)
    assert.equal(platform.drawCallbacks.length, 1)
    platform.runNextDrawCallback()
    assert.equal(platform.canvasExports.length, 1)
    platform.resolveCanvasExport(0, '/tmp/spl-report-success.png')
    assert.equal(page.data.resultReportImagePath, '/tmp/spl-report-success.png')
    assert.equal(page.data.resultReportPreviewVisible, true)
    assert.equal(page.data.isGeneratingResultReport, false)
    assert.equal(page.closeSharePreview(), true)
    assert.equal(page.data.shareSheetClosing, true)
    platform.clock.tick(319)
    assert.equal(page.data.shareSheetVisible, true, 'share sheet remains mounted during the first 319ms of slide-out')
    platform.clock.tick(1)
    assert.equal(page.data.shareSheetVisible, false, 'share sheet unmounts at the 320ms slide-out boundary')
    platform.accessibleFiles.add('/tmp/spl-report-success.png')
    assert.equal(page.openSharePreview(), true)
    assert.equal(page.data.resultReportPreviewVisible, true, 'verified cached image is reused after reopen')
    assert.equal(platform.canvasExports.length, 0)
    assert.ok(platform.fileAccessLog.includes('/tmp/spl-report-success.png'))
  }, { deferDrawCallbacks: true })

  withSession(({ page, platform }) => {
    platform.drawCallbacks.length = 0
    platform.canvasExports.length = 0
    assert.equal(page.openSharePreview(), true)
    assert.equal(platform.drawCallbacks.length, 1)
    page.closeSharePreview()
    platform.runNextDrawCallback()
    assert.equal(platform.canvasExports.length, 0, 'late draw callback after close cannot export')
    assert.equal(page.data.resultReportImagePath, '')
    platform.clock.tick(320)

    page.openSharePreview()
    platform.runNextDrawCallback()
    assert.equal(platform.canvasExports.length, 1)
    page.closeSharePreview()
    platform.resolveCanvasExport(0, '/tmp/stale-spl.png')
    assert.equal(page.data.resultReportImagePath, '', 'late export callback after close cannot expose stale image')
    assert.equal(page.data.resultReportPreviewVisible, false)
    platform.clock.tick(320)
  }, { deferDrawCallbacks: true })

  withSession(({ page, platform }) => {
    page._deferSetDataCallbacks = true
    assert.equal(page.openSharePreview(), true)
    assert.equal(page._pendingSetDataCallbacks.length, 1)
    assert.equal(page.closeSharePreview(), true)
    platform.clock.tick(320)
    page.flushSetDataCallbacks()
    page.flushSetDataCallbacks()
    platform.runNextDrawCallback()
    if (platform.canvasExports.length) platform.resolveCanvasExport(0, '/tmp/animated-stale.png')
    assert.equal(page.data.isGeneratingResultReport, false, 'stale open callback cannot strand generation after close animation')
    assert.equal(page.data.shareSheetVisible, false)

    page._deferSetDataCallbacks = false
    assert.equal(page.openSharePreview(), true, 'share preview can reopen after close animation completes')
    platform.runNextDrawCallback()
    assert.equal(platform.canvasExports.length, 1)
    platform.resolveCanvasExport(0, '/tmp/animated-reopen.png')
    assert.equal(page.data.resultReportImagePath, '/tmp/animated-reopen.png')
  }, { deferDrawCallbacks: true })

  withSession(({ page, platform }) => {
    assert.equal(page.openSharePreview(), true)
    page.onHide()
    assert.equal(page.data.shareSheetVisible, false)
    assert.equal(platform.drawCallbacks.length, 1)
    platform.runNextDrawCallback()
    assert.equal(platform.canvasExports.length, 0, 'late draw callback after onHide is ignored')

    page.onShow()
    assert.equal(page.openSharePreview(), true)
    platform.runNextDrawCallback()
    assert.equal(platform.canvasExports.length, 1)
    page.onUnload()
    platform.resolveCanvasExport(0, '/tmp/unloaded-spl.png')
    assert.equal(page.data.resultReportImagePath, '', 'late export callback after unload is ignored')
  }, { deferDrawCallbacks: true })

  withSession(({ page, platform }) => {
    let cacheRequest
    platform.wx.getFileSystemManager = () => ({ access(request) { cacheRequest = request } })
    const cachedImagePath = '/tmp/deferred-spl-cache.png'
    page.resultReportSignature = page.getResultReportSignature()
    page.data.resultReportImagePath = cachedImagePath
    assert.equal(page.openSharePreview(), true)
    assert.equal(page.data.isCheckingResultReportCache, true)
    assert.equal(typeof cacheRequest?.success, 'function')
    assert.equal(page.closeSharePreview(), true)
    cacheRequest.success()
    assert.equal(page.data.resultReportPreviewVisible, false,
      'late cache success after close cannot reopen the preview')
    assert.equal(page.data.isCheckingResultReportCache, true,
      'late cache success cannot clear or replace the closing lifecycle state')
    platform.clock.tick(320)
    assert.equal(page.data.isCheckingResultReportCache, false)
    assert.equal(page.data.shareSheetVisible, false)
  })

  withSession(({ page, platform }) => {
    const pendingLayouts = []
    const nodes = {
      '.page-root': { left: 0, right: 390, top: 0, bottom: 671, width: 390, height: 671 },
      '.spl-overlay': { left: 0, right: 390, top: 0, bottom: 671, width: 390, height: 671 },
      '#splSharePanel': {
        left: 0, right: 390, top: 0, bottom: 671, width: 390, height: 671,
        computedStyle: {
          paddingTop: '15px', paddingBottom: '46px', paddingLeft: '16px', paddingRight: '16px',
          borderTopWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderRightWidth: '1px',
        },
      },
      '#splShareHeader': { left: 16, right: 374, top: 16, bottom: 60, width: 358, height: 44, computedStyle: { marginBottom: '9px' } },
      '#splShareActions': { left: 16, right: 374, top: 400, bottom: 454, width: 358, height: 54 },
      '#splShareImageFrame': {
        left: 16, right: 374, top: 70, bottom: 370, width: 358, height: 300,
        computedStyle: {
          paddingTop: '0px', paddingBottom: '0px', paddingLeft: '0px', paddingRight: '0px',
          borderTopWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderRightWidth: '1px',
        },
      },
    }
    page.resultReportRevision = 1
    platform.wx.createSelectorQuery = () => {
      const selections = []
      const query = {
        in() { return this },
        select(selector) {
          const entry = { selector, callback: null }
          selections.push(entry)
          return {
            fields(_options, callback) { entry.callback = callback },
            boundingClientRect(callback) { entry.callback = callback },
          }
        },
        exec(callback) {
          pendingLayouts.push(() => {
            selections.forEach((entry) => entry.callback?.(nodes[entry.selector]))
            callback?.()
          })
        },
      }
      return query
    }
    page.setData({
      shareSheetVisible: true,
      shareSheetClosing: false,
      resultReportPreviewVisible: true,
      resultReportImagePath: '/tmp/spl-layout.png',
      resultReportCanvasHeight: 1600,
    })
    assert.equal(page.updateShareImageLayout(), true)
    assert.equal(pendingLayouts.length, 1)
    pendingLayouts.shift()()
    const parsePixels = (style, property) => Number(new RegExp(`${property}:(\\d+(?:\\.\\d+)?)px`).exec(style)?.[1])
    const tallImageWidth = parsePixels(page.data.shareImageStyle, 'width')
    const tallImageHeight = parsePixels(page.data.shareImageStyle, 'height')
    const tallFrameHeight = parsePixels(page.data.shareImageFrameStyle, 'height')
    assert.ok(Math.abs((tallImageWidth / tallImageHeight) - (750 / 1600)) < 0.01,
      'long reports retain their complete 750-to-canvas-height aspect ratio')
    assert.ok(tallImageHeight > 400 && tallFrameHeight >= tallImageHeight + 1,
      'long report frame reserves the measured image height and border')

    page.setData({ resultReportCanvasHeight: 600 })
    assert.equal(page.updateShareImageLayout(), true)
    pendingLayouts.shift()()
    const shortImageWidth = parsePixels(page.data.shareImageStyle, 'width')
    const shortImageHeight = parsePixels(page.data.shareImageStyle, 'height')
    const shortFrameHeight = parsePixels(page.data.shareImageFrameStyle, 'height')
    assert.ok(Math.abs((shortImageWidth / shortImageHeight) - (750 / 600)) < 0.01,
      'short reports retain their complete 750-to-canvas-height aspect ratio')
    assert.ok(shortImageHeight < tallImageHeight && shortFrameHeight < tallFrameHeight,
      'short report frame shrinks to its image instead of keeping the long-report viewport height')

    page.setData({ resultReportCanvasHeight: 1800 })
    assert.equal(page.updateShareImageLayout(), true)
    const styleBeforeLateLayout = page.data.shareImageStyle
    const frameBeforeLateLayout = page.data.shareImageFrameStyle
    assert.equal(page.closeSharePreview(), true)
    pendingLayouts.shift()()
    assert.equal(page.data.shareImageStyle, styleBeforeLateLayout,
      'late selector-query layout after close cannot alter the next preview style')
    assert.equal(page.data.shareImageFrameStyle, frameBeforeLateLayout,
      'late selector-query layout after close cannot resize the hidden frame')
    platform.clock.tick(320)
    assert.equal(page.data.shareSheetVisible, false)
  })
}

function testResultTabLifecycleAndOverlayGuards() {
  withSession(({ page, platform }) => {
    const tap = (tab) => page.onResultTabTap({ currentTarget: { dataset: { tab } } })
    const resultIdentity = page.data.result
    const recordPayload = page.getRecordPayload()
    const reportSignature = page.getResultReportSignature()
    const reportCache = {
      signature: reportSignature,
      imagePath: '/tmp/tab-protected-spl-report.png',
      canvasHeight: 1432,
      previewVisible: true,
    }
    page.resultReportSignature = reportCache.signature
    page.setData({
      resultReportImagePath: reportCache.imagePath,
      resultReportCanvasHeight: reportCache.canvasHeight,
      resultReportPreviewVisible: reportCache.previewVisible,
    })
    const preferences = page.getPreferences()
    const storedPreferences = platform.storage.get(PREFERENCE_KEY)
    const storedRecords = platform.storage.get(RECORDS_KEY)
    const preferenceWriteCount = platform.writeLog.filter((entry) => entry.key === PREFERENCE_KEY).length
    const vibrationStart = platform.vibrationLog.length

    assert.equal(page.data.resultTab, 'spl', 'the first usable result opens on the SPL tab')
    assert.equal(tap('spl'), false, 'tapping the active tab is ignored')
    assert.equal(tap('unknown'), false, 'unknown tab keys are ignored')
    assert.equal(tap(undefined), false, 'missing tab keys are ignored')
    assert.equal(platform.vibrationLog.length, vibrationStart, 'same and invalid tab taps do not vibrate')

    assert.equal(tap('distance'), true)
    assert.equal(page.data.resultTab, 'distance')
    assert.deepEqual(platform.vibrationLog.slice(vibrationStart), [{ type: 'light' }],
      'an accepted tab switch gives one light haptic')
    assert.equal(tap('distance'), false, 'repeated taps on the selected tab do not transition')
    assert.equal(tap('reference'), true)
    assert.equal(tap('spl'), true)
    assert.deepEqual(platform.vibrationLog.slice(vibrationStart), [
      { type: 'light' }, { type: 'light' }, { type: 'light' },
    ])
    assert.equal(page.data.result, resultIdentity, 'tab changes do not recalculate or replace the result')
    assert.deepEqual(page.getRecordPayload(), recordPayload, 'tab changes leave the record payload unchanged')
    assert.equal(page.getResultReportSignature(), reportSignature, 'tab changes leave the export signature unchanged')
    assert.deepEqual(page.getPreferences(), preferences, 'tab changes do not alter input preferences')
    assert.deepEqual(platform.storage.get(PREFERENCE_KEY), storedPreferences, 'tab changes do not write preference state')
    assert.deepEqual(platform.storage.get(RECORDS_KEY), storedRecords, 'tab changes do not alter saved records')
    assert.equal(platform.writeLog.filter((entry) => entry.key === PREFERENCE_KEY).length, preferenceWriteCount,
      'tab changes do not call the preference writer')
    assert.deepEqual({
      signature: page.resultReportSignature,
      imagePath: page.data.resultReportImagePath,
      canvasHeight: page.data.resultReportCanvasHeight,
      previewVisible: page.data.resultReportPreviewVisible,
    }, reportCache, 'tab changes preserve an existing report signature, image cache, height and preview state')

    for (const overlay of [
      'selectorVisible', 'shareSheetVisible', 'shareSheetClosing', 'projectSheetVisible', 'projectSheetClosing',
    ]) {
      page.setData({ [overlay]: true })
      const before = platform.vibrationLog.length
      assert.equal(tap('distance'), false, `tab switching is blocked while ${overlay} is active`)
      assert.equal(platform.vibrationLog.length, before, `blocked ${overlay} tap does not vibrate`)
      page.setData({ [overlay]: false })
    }

    page.onDistanceInput({ detail: { value: '5' } })
    assert.equal(page.data.resultTab, 'spl', 'an input revision immediately returns to the primary result tab')
    assert.equal(page.data.isCalculationPending, true)
    const pendingVibrations = platform.vibrationLog.length
    assert.equal(tap('reference'), false, 'tab switching is blocked during a pending recalculation')
    assert.equal(platform.vibrationLog.length, pendingVibrations)
    page.onDistanceBlur()
    assert.equal(page.data.result.distanceMeters, 5)
    assert.equal(page.data.resultTab, 'spl')

    page.onDistanceInput({ detail: { value: '0' } })
    page.onDistanceBlur()
    assert.equal(page.data.result, null)
    assert.equal(page.data.canUseResultActions, false)
    assert.equal(tap('distance'), false, 'invalid results cannot expose a stale distance pane')
    assert.equal(page.data.resultTab, 'spl')

    page.onDistanceInput({ detail: { value: '6' } })
    page.onDistanceBlur()
    assert.equal(tap('reference'), true)
    page._pageVisible = false
    const hiddenVibrations = platform.vibrationLog.length
    assert.equal(tap('distance'), false, 'hidden pages cannot transition result tabs')
    assert.equal(platform.vibrationLog.length, hiddenVibrations)
    page.onHide()
    assert.equal(page.data.resultTab, 'spl', 'ordinary page hide returns the selected tab to SPL')
    page.onShow()
    assert.equal(page.data.resultTab, 'spl', 'showing the page does not restore a stale tab selection')
    assert.equal(tap('distance'), true)
    page.onUnload()
    const afterUnloadVibrations = platform.vibrationLog.length
    assert.equal(tap('reference'), false, 'unloaded pages cannot transition result tabs')
    assert.equal(platform.vibrationLog.length, afterUnloadVibrations)
  })

  withSession(({ page, platform }) => {
    page.onResultTabTap({ currentTarget: { dataset: { tab: 'distance' } } })
    assert.equal(page.data.resultTab, 'distance')
    assert.equal(page.requestReset(), true)
    assert.equal(platform.modalLog.length, 0, 'reset returns directly without a confirmation modal')
    assert.equal(page.data.resultTab, 'spl', 'reset returns to the default tab')
    assert.equal(page.data.result, null)
    page.onUnload()

    const reopened = createPage(loadPageDefinition())
    reopened.onLoad()
    reopened.onShow()
    assert.equal(reopened.data.resultTab, 'spl', 'an explicit blank preference reopens on the default result tab')
    assert.equal(reopened.data.result, null, 'tab selection does not restore or synthesize blank-result inputs')
    assert.deepEqual(reopened.getPreferences(), EMPTY_PREFERENCES)
    reopened.onUnload()
  })

  withSession(({ page }) => {
    page.onResultTabTap({ currentTarget: { dataset: { tab: 'distance' } } })
    page.onHide()
    assert.equal(page.data.resultTab, 'spl', 'ordinary hide silently resets a non-default result tab')
    page.onShow()
    assert.equal(page.data.resultTab, 'spl')
    page.onResultTabTap({ currentTarget: { dataset: { tab: 'reference' } } })
    page.onUnload()

    const reopened = createPage(loadPageDefinition())
    reopened.onLoad()
    reopened.onShow()
    assert.equal(reopened.data.resultTab, 'spl', 'a normal page re-entry begins on the default result tab')
    assert.equal(reopened.data.result.distanceMeters, 4, 'tab state is not persisted with otherwise-default inputs')
    reopened.onUnload()
  })
}

function testSPLHighCountAndDistanceRowsRemainUnchanged() {
  withSession(({ page }) => {
    const { calculateSpeakerSpl } = require(path.join(root, 'utils/spl.js'))
    const { speakers } = require(path.join(root, 'data/equipment.js'))
    const calculationSpeaker = speakers.find((item) => item.model === page.data.selectedSpeaker.model)
    assert(calculationSpeaker && !calculationSpeaker.calculationDisabled,
      'expected calculation input comes from the unchanged full speaker catalog')
    assert.equal(page.data.countPickerOptions[8], '16 只')
    page.onCountPickerChange({ detail: { value: 8 } })
    assert.equal(page.data.countIndex, 7, 'the legacy numeric count index remains the catalog index')
    assert.equal(page.data.counts[page.data.countIndex], 16,
      'the placeholder-aware UI handler accepts the actual 16-speaker option index')
    const expectedSixteen = calculateSpeakerSpl({
      speaker: calculationSpeaker,
      distanceMeters: 4,
      speakerCount: 16,
      summationMode: 'distributed',
    })
    assert.equal(page.data.result.speakerCount, 16)
    assert.equal(page.data.result.totalRatedPower, expectedSixteen.totalRatedPower)
    assert.equal(page.data.result.oneMeterSpl, expectedSixteen.oneMeterSpl)
    assert.equal(page.data.result.selectedSpl, expectedSixteen.selectedSpl)
    assert.deepEqual(page.data.result.distanceRows, expectedSixteen.distanceRows)
    const sixteenPayload = page.getRecordPayload()
    assert.equal(sixteenPayload.preferences.speakerCount, 16)
    assert.ok(sixteenPayload.resultText.includes('音箱：' + page.data.result.model + ' × 16 只'))

    page.onDistanceInput({ detail: { value: '1000' } })
    page.onDistanceBlur()
    assert.equal(page.data.distanceError, '')
    assert.equal(page.data.result.distanceMeters, 1000)
    assert.equal(page.data.result.distanceRows.find((row) => row.distanceMeters === 1000)?.isSelected, true)
    assert.equal(page.getRecordPayload().preferences.distanceText, '1000')
    assert.ok(page.getRecordPayload().resultText.includes('1000 m 理论声压级：'))

    page.onDistanceInput({ detail: { value: '7.3' } })
    page.onDistanceBlur()
    assert.equal(page.data.distanceError, '')
    assert.equal(page.data.result.distanceMeters, 7.3)
    assert.deepEqual(page.data.result.distanceRows.map((row) => row.distanceMeters), [1, 2, 4, 7.3, 8, 12, 16, 20])
    assert.equal(page.data.result.distanceRows.find((row) => row.distanceMeters === 7.3)?.isSelected, true)
    assert.equal(page.getRecordPayload().preferences.distanceText, '7.3')
    assert.ok(page.getRecordPayload().resultText.includes('7.3 m 理论声压级：'))
  })
}

const tests = [
  testInitialValuesAndPendingGate,
  testModelCountSummationAndInvalidInputs,
  testResetPreservesRecordsAndHandlesStorageFailure,
  testProjectKeyboardEventsAndMetadataIdentity,
  testProjectSaveFailureIsAtomic,
  testReportLifecycleAndLateCallbacks,
  testResultTabLifecycleAndOverlayGuards,
  testSPLHighCountAndDistanceRowsRemainUnchanged,
]

const selectedNames = process.env.SPL_VM_CASES
  ? process.env.SPL_VM_CASES.split(',').map((name) => name.trim()).filter(Boolean)
  : null
const selectedTests = selectedNames
  ? tests.filter((test) => selectedNames.includes(test.name))
  : tests
assert.equal(selectedTests.length, selectedNames?.length || tests.length,
  `unknown or duplicate VM case name in ${selectedNames?.join(',') || ''}`)

for (const test of selectedTests) {
  test()
  process.stdout.write(`PASS ${test.name}\n`)
}

process.stdout.write(`SPL VM regression: ${selectedTests.length} scenarios passed\n`)

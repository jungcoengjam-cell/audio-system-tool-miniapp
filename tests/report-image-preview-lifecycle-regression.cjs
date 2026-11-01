'use strict'

const assert = require('node:assert/strict')
const { createEnvironment } = require('./p2-safety/harness.cjs')
const nativeImagePreview = require('../pages/native-image-preview')

const delay = (ms = 8) => new Promise((resolve) => setTimeout(resolve, ms))
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

function route(name) {
  const env = createEnvironment()
  let exports = 1
  env.wx.canvasToTempFilePath = (options) => {
    exports += 1
    options?.success?.({ tempFilePath: `mock://unexpected-export-${exports}.png` })
  }
  let config
  const common = (data, fields, setup = () => {}) => {
    const page = env.loadPage(fields.module)
    Object.assign(page.data, data)
    Object.assign(page, fields.state || {})
    Object.assign(page, fields.stubs || {})
    setup(page, env)
    config = { ...fields, page, env, exports: () => exports }
    if (config.ordinaryVisible === undefined) config.ordinaryVisible = false
    return config
  }

  if (name === 'cable') return common({
    result: null, resultReportPreviewVisible: true, resultReportPreviewClosing: false,
    resultReportImagePath: 'wxfile://cable-preview.png', isGeneratingResultReport: false,
    constantPowerText: '100', distanceText: '100',
  }, {
    module: 'pages/cable/cable.js', visible: 'resultReportPreviewVisible', path: 'resultReportImagePath',
    signature: 'resultReportSignature', input: ['constantPowerText', 'distanceText'],
    preview: 'previewResultReportImage', share: 'shareResultReportImage', urls: ['wxfile://cable-preview.png'],
    state: { _pageVisible: true, _isUnloaded: false, resultReportSignature: 'cable-signature' },
    stubs: {
      getRecordPayload: () => ({}), getResultReportSignature: () => 'cable-signature',
      updateResultReportPreviewLayout() {}, flushInputCalculation() {}, cancelProjectCloseTimer() {},
      closeProjectDialog() {},
    },
  })

  if (name === 'camera') return common({
    result: { valid: true }, resultUpdating: false, legacyCustomUnsupported: false,
    resultReportPreviewVisible: true, resultReportPreviewClosing: false,
    resultReportImagePath: 'wxfile://camera-preview.png', isGeneratingResultReport: false,
    subjectHeightText: '1.7',
  }, {
    module: 'pages/camera/camera.js', visible: 'resultReportPreviewVisible', path: 'resultReportImagePath',
    signature: 'resultReportSignature', input: ['subjectHeightText'],
    preview: 'previewResultReportImage', share: 'shareResultReportImage', urls: ['wxfile://camera-preview.png'],
    state: { _pageVisible: true, _cameraUnloaded: false, _inputRevision: 0, resultReportSignature: 'camera-signature' },
    stubs: {
      getResultReportSignature: () => 'camera-signature', canUseCurrentResultReport: () => true,
      captureResultHeroHeight() {}, drawPreview() {}, closeCameraSelector() {}, cancelCameraProjectForHide() {},
      invalidatePreviewCanvas() {}, flushPendingCalculation() {},
    },
  }, (_page, runtime) => {
    runtime.wx.getFileSystemManager = () => ({ access: ({ success }) => success?.() })
  })

  if (name === 'gain') return common({
    shareSheetVisible: true, resultReportPreviewVisible: true, resultReportImagePath: 'wxfile://gain-preview.png',
    resultReportPreviewClosing: false, hasValidResult: true, result: { valid: true },
    isGeneratingResultReport: false, isCheckingResultReportCache: false, amplifierIndex: 0,
    pageContainerSupported: true,
  }, {
    module: 'pages/gain-structure/gain-structure.js', visible: 'shareSheetVisible', path: 'resultReportImagePath',
    signature: 'resultReportSignature', input: ['amplifierIndex'], preview: 'previewResultReportImage',
    share: 'shareResultReportImage', urls: ['wxfile://gain-preview.png'],
    state: { _pageVisible: true, _isUnloaded: false, _pageContainerEpoch: 4,
      _activePageContainerOverlay: { name: 'share', epoch: 4 }, resultReportSignature: 'gain-signature' },
    stubs: { resetProjectKeyboardState() {}, cancelPageContainerFallbackClose() {}, syncFavorite() {} },
  })

  if (name === 'dmx-address') return common({
    resultReportPreviewVisible: true, resultReportPreviewClosing: false,
    resultReportImagePath: 'wxfile://dmx-address-preview.png', groups: [{ id: 'group-1' }],
  }, {
    module: 'pages/dmx-address/dmx-address.js', visible: 'resultReportPreviewVisible', path: 'resultReportImagePath',
    signature: 'resultReportSignature', input: ['groups'], preview: 'previewResultReportImage',
    share: 'shareResultReportImage', urls: ['wxfile://dmx-address-preview.png'],
    state: { _pageAlive: true, _pageVisible: true, _skipNextShowReload: true,
      resultReportSignature: 'dmx-address-signature' },
    stubs: {
      resetTouchGestures() {}, pauseDeleteUndoExpiry() {}, cancelFloatingTransition() {},
      flushScheduledCalculation() {}, flushFixtureProgressWrite() {}, cancelFixtureSearch() {},
      clearAllSheetCloseTimers() {}, clearSheetCloseTimer() {}, cancelPendingChange() {},
      closeSaveProjectDialog() {}, closeFixtureChannelGuide() {}, resumeDeleteUndoExpiry() {},
    },
  })

  if (name === 'led') return common({
    reportPreviewVisible: true, reportPreviewClosing: false, reportPreviewError: false,
    reportImagePath: 'wxfile://led-preview.png', isGeneratingReport: false, result: null,
    wallWidthText: '6',
  }, {
    module: 'pages/led-screen/led-screen.js', visible: 'reportPreviewVisible', path: 'reportImagePath',
    signature: 'reportSignature', input: ['wallWidthText'], preview: 'previewReportImage',
    share: 'shareReportImage', urls: ['wxfile://led-preview.png'],
    state: { _pageVisible: true, _ledUnloaded: false, reportSignature: 'led-signature' },
    stubs: {
      isCurrentReportPreview: () => true, hasAccessibleReportImage: () => true,
      flushInputCalculation() {}, cancelLedProjectDialogForHide() {},
    },
  })

  if (name === 'project-wiring') return common({
    reportPreviewVisible: true, reportImages: [
      { path: 'wxfile://wiring-preview-1.png', title: '第 1 页' },
      { path: 'wxfile://wiring-preview-2.png', title: '第 2 页' },
    ], reportImagePath: 'wxfile://wiring-preview-1.png', reportPageIndex: 0,
    reportSaveRunning: false, reportSaveInFlight: false, reportSaveMessage: '',
    editorVisible: false, batchVisible: false, project: { id: 'project-1', name: '回归 fixture' },
  }, {
    module: 'pages/project-wiring/index.js', visible: 'reportPreviewVisible', path: 'reportImagePath',
    signature: '_reportSignature', array: 'reportImages', input: ['workspaceTab'],
    preview: 'previewReportImage', share: 'shareReportImage', urls: [
      'wxfile://wiring-preview-1.png', 'wxfile://wiring-preview-2.png',
    ], state: { _hidden: false, _destroyed: false, _skipNextShowRefresh: true,
      _reportSignature: 'project-wiring-signature', projectId: 'project-1', _reportRevision: 1,
      _reportPending: false, _reportSaveJob: null, _reportSaveInFlight: null },
    stubs: {
      traceWorkspaceInteraction() {}, closeWorkspaceSwipeRow() {}, cancelWorkspaceSwipeGesture() {},
      nextWorkspaceTransitionRevision() {}, clearWorkspaceRetiringRow() {}, cancelWorkspaceOverlayTimers() {},
      invalidateWorkspaceEditorDelete() {}, clearFormKeyboardViewport() {}, updateFormViewportBaseline() {},
      updateWorkspaceNavigation() {}, syncUnloadWarning() {},
    },
  })

  if (name === 'dmx-layout') return common({
    previewVisible: true, previewClosing: false, isGeneratingImage: false,
    layoutImagePath: 'wxfile://layout-preview-1.png',
    layoutImagePaths: ['wxfile://layout-preview-1.png', 'wxfile://layout-preview-2.png'],
    exportPageIndex: 0, exportPageCount: 2, layoutPanelVisible: false,
    placementVisible: false, reductionConfirm: null, darkMode: false,
    widthText: '12',
  }, {
    module: 'pages/dmx-layout/dmx-layout.js', visible: 'previewVisible', path: 'layoutImagePath',
    signature: '_exportSnapshot', array: 'layoutImagePaths', input: ['widthText'],
    preview: 'previewImage', share: 'shareImage', urls: [
      'wxfile://layout-preview-1.png', 'wxfile://layout-preview-2.png',
    ], state: { _alive: true, _visible: true, _theme: 'light', _contextId: '', _layout: null,
      _exportSnapshot: { signature: 'layout-signature' }, _exportPages: [{ id: 1 }, { id: 2 }],
      _exportPaths: ['wxfile://layout-preview-1.png', 'wxfile://layout-preview-2.png'] },
    stubs: {
      cancelAllSheetCloses() {}, invalidatePendingSettingsConfirm() {}, invalidatePendingClear() {},
      cancelPreviewScrollCommand() {}, cancelCanvasFrame() {}, clearPendingGesture() {},
    },
  })

  if (name === 'limiter') return common({
    shareSheetVisible: true, resultReportPreviewVisible: true, resultReportImagePath: 'wxfile://limiter-preview.png',
    pageContainerSupported: true, hasValidResult: false, isGeneratingResultReport: false,
    isCheckingResultReportCache: false, selectorVisible: false, detailsVisible: false,
    projectSheetVisible: false, shareSheetClosing: false, amplifierIndex: 0,
  }, {
    module: 'pages/limiter/limiter.js', visible: 'shareSheetVisible', ordinaryVisible: true, path: 'resultReportImagePath',
    signature: 'resultReportSignature', input: ['amplifierIndex'], preview: 'previewResultReportImage',
    share: 'shareResultReportImage', urls: ['wxfile://limiter-preview.png'],
    state: { _pageVisible: true, _isUnloaded: false, _pageContainerEpoch: 9, _projectRequestId: 0,
      _activePageContainerOverlay: { name: 'share', epoch: 9 }, _pageContainerLeave: null,
      resultReportSignature: 'limiter-signature' },
    stubs: { resumeReminderClock() {}, pauseReminderClock() {}, resetProjectKeyboardState() {} },
  })

  if (name === 'spl') return common({
    shareSheetVisible: true, shareSheetClosing: false, resultReportPreviewVisible: true,
    resultReportImagePath: 'wxfile://spl-preview.png', canUseResultActions: true,
    isCalculationPending: false, isGeneratingResultReport: false, isCheckingResultReportCache: false,
    result: null, subjectHeightText: '1.7',
  }, {
    module: 'pages/spl/spl.js', visible: 'shareSheetVisible', path: 'resultReportImagePath',
    signature: 'resultReportSignature', input: ['subjectHeightText'], preview: 'previewResultReportImage',
    share: 'shareResultReportImage', urls: ['wxfile://spl-preview.png'],
    state: { _pageVisible: true, _isUnloaded: false,
      resultReportSignature: 'spl-signature' },
    stubs: { updateShareImageLayout() {}, cancelSpeakerSelectorClose() {} },
  })

  if (name === 'audio-wiring') return common({
    resultReportPreviewVisible: true, resultReportPreviewClosing: false,
    resultReportImagePath: 'wxfile://audio-wiring-preview.png', selectorVisible: false,
    projectDialogVisible: false, sourceType: 'xlr',
  }, {
    module: 'pages/audio-wiring/index.js', visible: 'resultReportPreviewVisible', ordinaryVisible: true, path: 'resultReportImagePath',
    signature: '_reportSignature', input: ['sourceType'], preview: 'previewResultReportImage',
    share: 'shareResultReportImage', urls: ['wxfile://audio-wiring-preview.png'],
    state: { _pageVisible: true, _isWiringVisible: true, _pageReady: false,
      _reportSignature: 'audio-wiring-signature', _wiringLifecycle: { setVisible() {} } },
    stubs: {
      updateResultReportPreviewLayout() {}, clearEndpointSelectorCloseTimer() {},
      clearResultReportPreviewCloseTimer() {}, invalidateProjectSave() {}, closeProjectDialog() {},
      invalidateDiagramRender() {}, clearWiringGenerationState() {},
    },
  })

  throw new Error(`unknown route ${name}`)
}

function capture(testRoute, exportCalls) {
  const { page, visible, path, signature, array, input = [] } = testRoute
  return {
    visible: page.data[visible],
    path: page.data[path],
    signature: clone(page[signature]),
    images: array ? clone(page.data[array]) : null,
    inputs: Object.fromEntries(input.map((key) => [key, clone(page.data[key])])),
    exports: exportCalls(),
  }
}

function comparePersistent(before, after, label) {
  assert.equal(after.path, before.path, `${label}: image path survives preview return`)
  assert.deepEqual(after.signature, before.signature, `${label}: signature survives preview return`)
  assert.deepEqual(after.images, before.images, `${label}: image array survives preview return`)
  assert.deepEqual(after.inputs, before.inputs, `${label}: input/data semantics remain unchanged`)
  assert.equal(after.exports, before.exports, `${label}: preview return does not re-export`)
}

async function verifyRouteReturn(name, mode = 'delayed') {
  const testRoute = route(name)
  const { page, env } = testRoute
  const before = capture(testRoute, testRoute.exports)
  const calls = []
  env.wx.previewImage = (options) => {
    calls.push(options)
    if (mode === 'immediate') page.onHide()
  }
  if (name === 'camera') env.wx.getFileSystemManager = () => ({ access: ({ success }) => success?.() })
  assert.equal(page[testRoute.preview](), true, `${name}: opens native original image`)
  if (mode !== 'immediate') {
    await delay(12)
    if (name === 'limiter') {
      page.onPageContainerBeforeLeave()
      page.onHide()
      page.onPageContainerAfterLeave()
    } else page.onHide()
  }
  assert.equal(page.data[testRoute.visible], true, `${name}: hide during native preview preserves the report layer`)
  const hidden = capture(testRoute, testRoute.exports)
  comparePersistent(before, hidden, name)
  assert.equal(calls.length, 1, `${name}: exactly one native preview call`)
  assert.equal(calls[0].current, before.path, `${name}: current points to the original image`)
  assert.deepEqual(calls[0].urls, testRoute.urls, `${name}: original image URL array is retained`)
  assert.equal(typeof calls[0].fail, name === 'audio-wiring' ? 'undefined' : 'function',
    `${name}: failure callback presence matches its original utility path`)
  page.onShow()
  assert.equal(page.data[testRoute.visible], true, `${name}: onShow returns to the same report layer`)
  const returned = capture(testRoute, testRoute.exports)
  comparePersistent(before, returned, name)

  page.onHide()
  assert.equal(page.data[testRoute.visible], testRoute.ordinaryVisible, `${name}: ordinary hide retains its original layer behavior`)
  page.onShow()
  assert.equal(page.data[testRoute.visible], testRoute.ordinaryVisible, `${name}: ordinary return retains the original layer behavior`)
  return { name, path: before.path, signature: before.signature, images: before.images, exports: before.exports }
}

async function verifyCableFailureAndFallback() {
  const testRoute = route('cable')
  const { page, env } = testRoute
  const toastTitles = []
  env.wx.showToast = ({ title }) => toastTitles.push(title)
  let options

  env.wx.previewImage = (value) => { options = value }
  assert.equal(page.previewResultReportImage(), true)
  options.fail({ errMsg: 'fail before hide' })
  assert.equal(page.data.resultReportPreviewVisible, true, 'failure before hide leaves the open report visible')
  assert.equal(page._nativeImagePreview, null, 'failure before hide clears the pending token')
  page.onHide()
  assert.equal(page.data.resultReportPreviewVisible, false, 'ordinary hide still closes after an early failure')
  page.onShow()

  page.setData({ resultReportPreviewVisible: true })
  env.wx.previewImage = (value) => { options = value }
  assert.equal(page.previewResultReportImage(), true)
  await delay(12)
  page.onHide()
  assert.equal(page.data.resultReportPreviewVisible, true, 'delayed hide preserves the window while preview is pending')
  options.fail({ errMsg: 'fail while hidden' })
  assert.equal(page.data.resultReportPreviewVisible, false, 'late failure applies only report-layer cleanup')
  page.onShow()
  assert.equal(page.data.resultReportPreviewVisible, false, 'late failure cannot resurrect the old layer on show')

  page.setData({ resultReportPreviewVisible: true })
  const oldFailures = []
  env.wx.previewImage = (value) => oldFailures.push(value.fail)
  assert.equal(page.previewResultReportImage(), true)
  assert.equal(page.previewResultReportImage(), true, 'repeated native preview requests replace the pending identity')
  await delay(12)
  page.onHide()
  oldFailures[0]({ errMsg: 'stale fail' })
  assert.equal(page.data.resultReportPreviewVisible, true, 'stale failure cannot close the newer preview window')
  oldFailures[1]({ errMsg: 'current fail' })
  assert.equal(page.data.resultReportPreviewVisible, false, 'current late failure closes only its own report layer')
  page.onShow()

  page.setData({ resultReportPreviewVisible: true })
  env.wx.previewImage = () => { throw new Error('sync preview failure') }
  assert.equal(page.previewResultReportImage(), false, 'synchronous preview exception returns false')
  assert.equal(page._nativeImagePreview, null, 'synchronous exception clears the pending identity')
  assert.equal(page.data.resultReportPreviewVisible, true, 'synchronous exception keeps the existing report open')

  delete env.wx.previewImage
  assert.equal(page.previewResultReportImage(), false, 'missing preview API is reported by direct image preview')
  assert.equal(page.shareResultReportImage(), true, 'missing preview API keeps legacy share fallback return semantics')
  assert.equal(toastTitles.at(-1), '请长按图片转发', 'missing preview API keeps the legacy fallback toast')

  env.wx.previewImage = (value) => { options = value }
  assert.equal(page.shareResultReportImage(), true, 'missing share-menu API falls back to original-image preview')
  assert.equal(options.current, page.data.resultReportImagePath)
  assert.deepEqual(options.urls, [page.data.resultReportImagePath])
  assert.equal(toastTitles.at(-1), '请长按图片转发')

  nativeImagePreview.cancel(page)
  env.wx.showShareImageMenu = (value) => { options = value }
  const count = 1
  assert.equal(page.shareResultReportImage(), true, 'native share-menu path remains available')
  assert.equal(options.path, page.data.resultReportImagePath)
  assert.equal(page._nativeImagePreview, null, 'native share-menu does not enter image-preview lifecycle')

  page.closeResultReportPreview()
  assert.equal(page.data.resultReportPreviewClosing, true, 'manual cable close still starts the existing animation')
  assert.equal(page._nativeImagePreview, null, 'manual close cancels the pending preview window')
  page.onHide()
  return { count, toasts: toastTitles.length }
}

async function verifyGainCloseRaces() {
  const first = route('gain')
  const page = first.page
  first.env.wx.previewImage = () => {}
  assert.equal(page.previewResultReportImage(), true)
  assert.equal(page.closeSharePreview(), true, 'gain close button remains active before onHide')
  assert.equal(page._nativeImagePreview, null, 'gain explicit close cancels the pending preview marker')
  assert.equal(page.data.pageContainerClosingOverlay, 'share', 'gain close still uses the native container transition')
  page.onPageContainerAfterLeave()
  assert.equal(page.data.shareSheetVisible, false, 'gain afterleave completes the user initiated close')

  const second = route('gain')
  const returning = second.page
  second.env.wx.previewImage = () => {}
  assert.equal(returning.previewResultReportImage(), true)
  assert.equal(returning.onPageContainerBeforeLeave(), false, 'gain ignores native container beforeleave while preview is pending')
  returning.onPageContainerAfterLeave()
  assert.equal(returning.data.pageContainerClosingOverlay, '', 'gain ignores the paired native afterleave while preview is pending')
  await delay(12)
  returning.onHide()
  assert.equal(returning.data.shareSheetVisible, true)
  returning.onShow()
  assert.equal(returning.closeSharePreview(), true, 'gain can close immediately after preview return')
  assert.equal(returning._nativeImagePreview, null)
  assert.equal(returning.data.pageContainerClosingOverlay, 'share')
  returning.onPageContainerAfterLeave()
  assert.equal(returning.data.shareSheetVisible, false)

  const overlay = route('gain')
  overlay.env.wx.previewImage = () => {}
  overlay.page.previewResultReportImage()
  overlay.page.onPageContainerClickOverlay()
  assert.equal(overlay.page._nativeImagePreview, null, 'gain overlay close cancels the pending preview marker')
  assert.equal(overlay.page.data.pageContainerClosingOverlay, 'share', 'gain overlay close keeps the native close transition')
  overlay.page.onPageContainerAfterLeave()
  assert.equal(overlay.page.data.shareSheetVisible, false, 'gain overlay close completes through the original hook')
}

async function verifySplCloseAndFailure() {
  const testRoute = route('spl')
  const { page, env } = testRoute
  let options
  env.wx.previewImage = (value) => { options = value }
  assert.equal(page.previewResultReportImage(), true)
  await delay(12)
  page.onHide()
  assert.equal(page.data.shareSheetVisible, true, 'SPL late hide keeps its existing report window')
  options.fail({ errMsg: 'preview fail after hide' })
  assert.equal(page.data.shareSheetVisible, false, 'SPL late failure completes the report cleanup skipped by onHide')
  page.onShow()
  assert.equal(page.data.shareSheetVisible, false, 'SPL onShow cannot revive a report dismissed after preview failure')

  const manual = route('spl')
  manual.env.wx.previewImage = () => {}
  assert.equal(manual.page.previewResultReportImage(), true)
  assert.equal(manual.page.closeSharePreview(), true, 'SPL manual close remains available')
  assert.equal(manual.page._nativeImagePreview, null, 'SPL manual close clears the native-preview identity')
  assert.equal(manual.page.data.shareSheetClosing, true, 'SPL keeps its original close animation')
}

async function verifyLimiterContainerAndFallback() {
  const testRoute = route('limiter')
  const { page, env } = testRoute
  const toasts = []
  env.wx.showToast = ({ title }) => toasts.push(title)
  env.wx.previewImage = () => {
    page.onPageContainerBeforeLeave()
    page.onHide()
    page.onPageContainerAfterLeave()
  }
  assert.equal(page.shareResultReportImage(), true, 'limiter fallback still reports a handled share action')
  assert.equal(page.data.shareSheetVisible, true, 'limiter page-container leave hooks cannot dismiss the native preview')
  page.onShow()
  assert.equal(page.data.shareSheetVisible, true, 'limiter returns to the same share sheet')
  assert.equal(toasts.at(-1), '请长按图片转发')

  env.wx.previewImage = () => {}
  assert.equal(page.previewResultReportImage(), true)
  page.onPageContainerClickOverlay()
  assert.equal(page._nativeImagePreview, null, 'limiter overlay tap cancels pending preview before closing')
  assert.equal(page.data.pageContainerClosingOverlay, 'share', 'limiter overlay tap follows the existing page-container close')
  page.onPageContainerAfterLeave()
  assert.equal(page.data.shareSheetVisible, false)
}

async function verifyHelperTimeout() {
  const page = { data: {} }
  const api = { previewImage() {} }
  assert.equal(nativeImagePreview.preview(page, 'wxfile://timeout.png', null, null, api), true)
  page._nativeImagePreview.expiresAt = Date.now() - 1
  assert.equal(nativeImagePreview.onHide(page), false, 'expired preview marker does not capture an ordinary hide')
  assert.equal(page._nativeImagePreview, null)
}

async function verifyAllShareEntrances() {
  const names = ['cable', 'camera', 'gain', 'dmx-address', 'led', 'project-wiring',
    'dmx-layout', 'limiter', 'spl', 'audio-wiring']
  const nativeReturns = { camera: undefined, gain: undefined, 'dmx-address': undefined }
  for (const name of names) {
    const native = route(name)
    let menuOptions
    let previewOptions
    const nativeToasts = []
    native.env.wx.showShareImageMenu = (options) => { menuOptions = options }
    native.env.wx.previewImage = (options) => { previewOptions = options }
    native.env.wx.showToast = ({ title }) => nativeToasts.push(title)
    assert.equal(native.page[native.share](), Object.prototype.hasOwnProperty.call(nativeReturns, name)
      ? nativeReturns[name] : true,
      `${name}: native share image menu preserves its existing return value`)
    assert.equal(menuOptions.path, native.page.data[native.path], `${name}: share menu receives the existing image path`)
    assert.equal(previewOptions, undefined, `${name}: native share does not open native original-image preview`)
    assert.equal(nativeToasts.length, 0, `${name}: native share does not show fallback toast`)

    const fallback = route(name)
    let fallbackOptions
    const fallbackToasts = []
    fallback.env.wx.previewImage = (options) => { fallbackOptions = options }
    fallback.env.wx.showToast = ({ title }) => fallbackToasts.push(title)
    assert.equal(fallback.page[fallback.share](), true, `${name}: missing share-menu API falls back to preview`)
    assert.equal(fallbackOptions.current, fallback.page.data[fallback.path], `${name}: fallback previews the same image`)
    assert.deepEqual(fallbackOptions.urls, [fallback.page.data[fallback.path]], `${name}: fallback preserves its image list`)
    assert.equal(fallbackToasts.at(-1), '请长按图片转发', `${name}: fallback keeps its existing guidance toast`)
    nativeImagePreview.cancel(fallback.page)

    const unavailable = route(name)
    const unavailableToasts = []
    delete unavailable.env.wx.previewImage
    unavailable.env.wx.showToast = ({ title }) => unavailableToasts.push(title)
    const result = unavailable.page[unavailable.share]()
    assert.equal(result, name === 'spl' ? false : true,
      `${name}: no-preview fallback preserves its entry return semantics`)
    assert.equal(unavailableToasts.length, name === 'spl' ? 0 : 1,
      `${name}: no-preview fallback preserves its entry toast semantics`)
    if (name !== 'spl') assert.equal(unavailableToasts[0], '请长按图片转发')
  }
}

async function verifyRouteLateFailures() {
  const expectations = {
    cable: false, camera: false, gain: false, 'dmx-address': false, led: false,
    'project-wiring': false, 'dmx-layout': false, limiter: false, spl: false,
  }
  for (const [name, expectedVisible] of Object.entries(expectations)) {
    const testRoute = route(name)
    let options
    testRoute.env.wx.previewImage = (value) => { options = value }
    assert.equal(testRoute.page[testRoute.preview](), true, `${name}: preview starts before late failure`)
    await delay(12)
    if (name === 'limiter') {
      testRoute.page.onPageContainerBeforeLeave()
      testRoute.page.onHide()
      testRoute.page.onPageContainerAfterLeave()
    } else testRoute.page.onHide()
    if (name === 'spl') {
      assert.equal(typeof options.fail, 'function', 'SPL keeps its native failure callback')
      options.fail({ errMsg: 'late SPL preview failure' })
      assert.equal(testRoute.page._nativeImagePreview, null, 'SPL late failure clears its preview identity')
    } else {
      assert.equal(typeof options.fail, 'function', `${name}: helper wires a native failure callback`)
      options.fail({ errMsg: `late ${name} preview failure` })
    }
    assert.equal(testRoute.page.data[testRoute.visible], expectedVisible,
      `${name}: late failure applies the page-specific report cleanup`)
  }
}

async function run() {
  const routes = []
  routes.push(await verifyRouteReturn('cable', 'immediate'))
  for (const name of ['camera', 'gain', 'dmx-address', 'led', 'project-wiring', 'dmx-layout', 'limiter', 'spl', 'audio-wiring']) {
    routes.push(await verifyRouteReturn(name, 'delayed'))
  }
  await verifyCableFailureAndFallback()
  await verifyGainCloseRaces()
  await verifyLimiterContainerAndFallback()
  await verifySplCloseAndFailure()
  await verifyHelperTimeout()
  await verifyAllShareEntrances()
  await verifyRouteLateFailures()
  console.log(`Report image preview lifecycle regression passed (${routes.length} report routes, native/fallback sharing, delayed return, page-specific failure, ordinary hide, and close paths).`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

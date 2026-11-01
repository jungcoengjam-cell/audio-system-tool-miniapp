'use strict'

const assert = require('node:assert/strict')
const { createPage, installPlatform, loadPageDefinition } = require('./harness.cjs')

function withSession(run) {
  const platform = installPlatform()
  try {
    const page = createPage(loadPageDefinition())
    page.onLoad()
    page.onShow()
    run({ page, platform })
  } finally {
    platform.restore()
  }
}

function preparePreview(page, imagePath = '/tmp/spl-preview-return.png') {
  page.setData({
    canUseResultActions: true,
    isCalculationPending: false,
    shareSheetVisible: true,
    shareSheetClosing: false,
    resultReportImagePath: imagePath,
    resultReportPreviewVisible: true,
    isGeneratingResultReport: false,
    isCheckingResultReportCache: false,
  })
  return imagePath
}

function testOriginalImageReturnKeepsPreview() {
  withSession(({ page, platform }) => {
    assert.equal(page.onResultTabTap({ currentTarget: { dataset: { tab: 'reference' } } }), true)
    assert.equal(page.data.resultTab, 'reference', 'the preview-return case starts from a non-default result tab')
    const imagePath = preparePreview(page)
    assert.equal(page.previewResultReportImage(), true)
    assert.equal(platform.wx.previewRequest.current, imagePath)
    const previewIdentity = page._nativeImagePreview
    assert.ok(previewIdentity)
    assert.equal(previewIdentity.hidden, false)

    page.onHide()
    assert.equal(page._nativeImagePreview.hidden, true)
    assert.equal(page.data.shareSheetVisible, true, 'opening the native original-image viewer preserves the share sheet')
    assert.equal(page.data.resultReportPreviewVisible, true)
    assert.equal(page.data.resultReportImagePath, imagePath)
    assert.equal(page.data.resultTab, 'reference', 'opening the original image preserves the selected result tab')

    page.onShow()
    assert.equal(page._nativeImagePreview, null)
    assert.equal(page.data.shareSheetVisible, true)
    assert.equal(page.data.resultReportPreviewVisible, true)
    assert.equal(page.data.resultReportImagePath, imagePath)
    assert.equal(page.data.resultTab, 'reference', 'returning from the original image preserves the selected result tab')
    page.onUnload()
  })
}

function testPreviewFailureAllowsNormalHideCleanup() {
  withSession(({ page, platform }) => {
    preparePreview(page, '/tmp/spl-preview-fail.png')
    platform.wx.previewImage = (request) => request.fail?.(new Error('simulated preview failure'))
    assert.equal(page.previewResultReportImage(), true)
    assert.equal(page._nativeImagePreview, null, 'failure before hide clears the preview identity')

    page.onHide()
    assert.equal(page.data.shareSheetVisible, false, 'a later real page hide closes the share sheet')
    assert.equal(page.data.resultReportPreviewVisible, false)
    page.onUnload()
  })
}

function testPreviewThrowAllowsNormalHideCleanup() {
  withSession(({ page, platform }) => {
    preparePreview(page, '/tmp/spl-preview-throw.png')
    platform.wx.previewImage = () => { throw new Error('simulated synchronous preview exception') }
    assert.equal(page.previewResultReportImage(), false)
    assert.equal(page._nativeImagePreview, null, 'synchronous exception clears the preview identity')

    page.onHide()
    assert.equal(page.data.shareSheetVisible, false, 'a later real page hide closes the share sheet')
    assert.equal(page.data.resultReportPreviewVisible, false)
    page.onUnload()
  })
}

function testStaleFailureCannotClearNewPreview() {
  withSession(({ page, platform }) => {
    preparePreview(page, '/tmp/spl-preview-stale-fail.png')
    const calls = []
    platform.wx.previewImage = (request) => calls.push(request)
    assert.equal(page.previewResultReportImage(), true)
    page.onHide()
    page.onShow()
    assert.equal(page.previewResultReportImage(), true)
    assert.equal(calls.length, 2)
    const current = page._nativeImagePreview
    calls[0].fail(new Error('old preview fails after a new preview starts'))
    assert.equal(page._nativeImagePreview, current, 'old failure cannot clear the newer request identity')
    page.onHide()
    assert.equal(page.data.shareSheetVisible, true, 'second preview hide still preserves the report window')
    assert.equal(page._nativeImagePreview.hidden, true)
    calls[1].fail(new Error('current preview fails while hidden'))
    assert.equal(page.data.shareSheetVisible, false, 'current hidden failure closes the report preview')
    assert.equal(page._nativeImagePreview, null, 'targeted failure cleanup clears its request identity')
    page.onShow()
    assert.equal(page.data.shareSheetVisible, false, 'failed preview does not revive the dismissed report')
    page.onUnload()
  })
}

function testOldTimeoutCannotClearNewPreview() {
  withSession(({ page, platform }) => {
    preparePreview(page, '/tmp/spl-preview-stale-timer.png')
    platform.wx.previewImage = () => {}
    assert.equal(page.previewResultReportImage(), true)
    page.onHide()
    platform.clock.tick(500)
    page.onShow()
    assert.equal(page.previewResultReportImage(), true)
    const current = page._nativeImagePreview
    platform.clock.tick(1500)
    assert.equal(page._nativeImagePreview, current, 'first request timeout cannot clear the second request identity')
    assert.equal(page._nativeImagePreview.hidden, false)
    page.onHide()
    assert.equal(page.data.shareSheetVisible, true, 'second preview remains protected after first timeout')
    page.onShow()
    page.onHide()
    assert.equal(page.data.shareSheetVisible, false, 'ordinary hide after preview return still closes the report')
    page.onUnload()
  })
}

function testLateFailureRunsTargetedHideCleanup() {
  withSession(({ page, platform }) => {
    preparePreview(page, '/tmp/spl-preview-late-fail.png')
    page.setData({ resultTab: 'reference' })
    const calls = []
    platform.wx.previewImage = (request) => calls.push(request)
    let flushes = 0
    let saves = 0
    page.flushDistanceCalculation = () => { flushes += 1 }
    page.invalidateProjectSave = () => { saves += 1 }
    assert.equal(page.previewResultReportImage(), true)
    page.onHide()
    assert.equal(page.data.shareSheetVisible, true, 'pending native preview preserves the report during hide')
    const imagePath = page.data.resultReportImagePath
    const writesBeforeFailure = platform.writeLog.length
    const exportsBeforeFailure = platform.canvasExports.length
    calls[0].fail(new Error('native preview fails after onHide'))
    assert.equal(page.data.shareSheetVisible, false, 'late failure performs the skipped report-layer cleanup')
    assert.equal(page.data.resultReportPreviewVisible, false)
    assert.equal(page.data.resultReportImagePath, imagePath, 'late failure preserves the cached image path')
    assert.equal(page.data.resultTab, 'reference', 'late failure does not replay unrelated onHide state resets')
    assert.equal(flushes, 0, 'late failure does not replay distance-calculation cleanup')
    assert.equal(saves, 0, 'late failure does not replay project-save invalidation')
    assert.equal(platform.writeLog.length, writesBeforeFailure, 'late failure does not repeat persistence')
    assert.equal(platform.canvasExports.length, exportsBeforeFailure, 'late failure does not regenerate the report image')
    page.onShow()
    assert.equal(page.data.shareSheetVisible, false, 'onShow cannot restore a failed preview window')
    page.onUnload()
  })
}

function testManualCloseCancelsPreviewAndKeepsAnimation() {
  withSession(({ page, platform }) => {
    preparePreview(page, '/tmp/spl-preview-manual-close.png')
    platform.wx.previewImage = () => {}
    assert.equal(page.previewResultReportImage(), true)
    assert.ok(page._nativeImagePreview)
    assert.equal(page.closeSharePreview(), true)
    assert.equal(page._nativeImagePreview, null, 'manual close cancels the pending preview identity')
    assert.equal(page.data.shareSheetClosing, true, 'manual close still starts the share-sheet animation')
    platform.clock.tick(400)
    assert.equal(page.data.shareSheetVisible, false, 'the original close animation still completes')
    page.onUnload()
  })
}

function testShareFallbackUsesNativePreviewLifecycle() {
  withSession(({ page, platform }) => {
    const imagePath = preparePreview(page, '/tmp/spl-preview-share-fallback.png')
    const calls = []
    platform.wx.previewImage = (request) => calls.push(request)
    assert.equal(typeof platform.wx.showShareImageMenu, 'undefined')
    assert.equal(page.shareResultReportImage(), true, 'unsupported share menu falls back to original-image preview')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].current, imagePath)
    assert.deepEqual(calls[0].urls, [imagePath])
    assert.ok(page._nativeImagePreview)
    assert.equal(platform.toastLog.at(-1).title, '请长按图片转发')
    page.onHide()
    page.onShow()
    assert.equal(page.data.shareSheetVisible, true, 'fallback preview returns to the existing report layer')
    page.onUnload()
  })
}

function testInvalidAndPendingResultsCannotOpenOriginalImage() {
  withSession(({ page, platform }) => {
    const imagePath = preparePreview(page, '/tmp/stale-spl-preview.png')
    page.onDistanceInput({ detail: { value: '6' } })
    page.setData({ shareSheetVisible: true, resultReportImagePath: imagePath })
    assert.equal(page.data.isCalculationPending, true)
    assert.equal(page.previewResultReportImage(), false, 'pending result cannot open the prior image')
    assert.equal(platform.wx.previewRequest, undefined)

    page.onDistanceInput({ detail: { value: '0' } })
    page.onDistanceBlur()
    page.setData({ shareSheetVisible: true, resultReportImagePath: imagePath })
    assert.equal(page.data.result, null)
    assert.equal(page.data.canUseResultActions, false)
    assert.equal(page.previewResultReportImage(), false, 'invalid result cannot open a stale image')
    assert.equal(platform.wx.previewRequest, undefined)
    page.onUnload()
  })
}

const scenarios = [
  ['original image viewer return preserves preview', testOriginalImageReturnKeepsPreview],
  ['preview fail clears transition and permits hide cleanup', testPreviewFailureAllowsNormalHideCleanup],
  ['preview throw clears transition and permits hide cleanup', testPreviewThrowAllowsNormalHideCleanup],
  ['old failure cannot clear a newer preview', testStaleFailureCannotClearNewPreview],
  ['old timeout cannot clear a newer preview', testOldTimeoutCannotClearNewPreview],
  ['late failure performs targeted hide cleanup', testLateFailureRunsTargetedHideCleanup],
  ['manual close cancels preview and keeps animation', testManualCloseCancelsPreviewAndKeepsAnimation],
  ['share fallback uses native preview lifecycle', testShareFallbackUsesNativePreviewLifecycle],
  ['invalid and pending results cannot open stale images', testInvalidAndPendingResultsCannotOpenOriginalImage],
]

for (const [name, test] of scenarios) {
  test()
  process.stdout.write(`PASS ${name}\n`)
}

process.stdout.write(`Preview return regression: ${scenarios.length} scenarios passed\n`)

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
    assert.equal(page._previewImageOpening, true)

    page.onHide()
    assert.equal(page.data.shareSheetVisible, true, 'opening the native original-image viewer preserves the share sheet')
    assert.equal(page.data.resultReportPreviewVisible, true)
    assert.equal(page.data.resultReportImagePath, imagePath)
    assert.equal(page.data.resultTab, 'reference', 'opening the original image preserves the selected result tab')

    page.onShow()
    assert.equal(page._previewImageOpening, false)
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
    assert.equal(page._previewImageOpening, false, 'async failure clears the original-image transition flag')

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
    assert.equal(page._previewImageOpening, false, 'synchronous exception clears the original-image transition flag')

    page.onHide()
    assert.equal(page.data.shareSheetVisible, false, 'a later real page hide closes the share sheet')
    assert.equal(page.data.resultReportPreviewVisible, false)
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
  ['invalid and pending results cannot open stale images', testInvalidAndPendingResultsCannotOpenOriginalImage],
]

for (const [name, test] of scenarios) {
  test()
  process.stdout.write(`PASS ${name}\n`)
}

process.stdout.write(`Preview return regression: ${scenarios.length} scenarios passed\n`)

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  createPage,
  installPlatform,
  loadPageDefinition,
  root,
} = require('./harness.cjs')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertCurrentTemplateBindings() {
  const template = readProjectFile('pages/spl/spl.wxml')
  assert.match(template,
    /<button\b(?=[^>]*\bid="splShare")(?=[^>]*\bbindtap="openSharePreview")[^>]*>/,
    'SPL share action must open the guarded report preview flow')
  assert.doesNotMatch(template, /bindtap="generateResultReportImage"/,
    'report generation must not bypass preview-flow guards through an inline binding')
  assert.match(template,
    /<image\b(?=[^>]*\bsrc="\{\{resultReportImagePath\}\}")(?=[^>]*\bbindtap="previewResultReportImage")[^>]*>/,
    'preview image must open the native original-image viewer')
  assert.match(template,
    /<button\b(?=[^>]*\bbindtap="retryResultReport")[^>]*>/,
    'failed image generation must retain its retry action')
  assert.match(template,
    /<button\b(?=[^>]*\bbindtap="shareResultReportImage")[^>]*>/,
    'share action must remain bound to its report-image handler')
  assert.match(template,
    /<button\b(?=[^>]*\bbindtap="saveResultReportImage")[^>]*>/,
    'save action must remain bound to its report-image handler')
  assert.match(template,
    /<canvas\b(?=[^>]*\bid="resultReportCanvas")(?=[^>]*\bcanvas-id="resultReportCanvas")[^>]*>/,
    'report canvas element and canvas-id must remain aligned')
}

function withPage(callback) {
  const platform = installPlatform({ deferDrawCallbacks: true })
  let page
  try {
    page = createPage(loadPageDefinition())
    page.onLoad()
    page.onShow()
    assert.equal(page.data.canUseResultActions, true, 'default fixture must have a usable SPL result')
    callback(page, platform)
  } finally {
    if (page) page.onUnload()
    platform.restore()
  }
}

function testGenerationCachePreviewShareSaveAndCanvas() {
  withPage((page, platform) => {
    const imagePath = '/tmp/spl-current-contract.png'
    assert.equal(page.openSharePreview(), true, 'the current UI entry opens the report preview flow')
    assert.equal(page.data.isGeneratingResultReport, true)
    assert.equal(platform.drawCallbacks.length, 1, 'opening preview starts report drawing')
    assert.equal(page.generateResultReportImage(), false, 'duplicate generation remains blocked')

    assert.equal(platform.runNextDrawCallback(), true)
    assert.equal(platform.canvasExports.length, 1, 'draw completion reaches canvas export')
    const exportRequest = platform.canvasExports[0]
    assert.equal(exportRequest.canvasId, 'resultReportCanvas')
    assert.equal(exportRequest.width, 750)
    assert.ok(exportRequest.height > 0)
    assert.equal(exportRequest.fileType, 'png')
    assert.equal(exportRequest.quality, 1)
    assert.equal(platform.resolveCanvasExport(0, imagePath), true)
    assert.equal(page.data.resultReportImagePath, imagePath)
    assert.equal(page.data.resultReportPreviewVisible, true)
    assert.equal(page.data.isGeneratingResultReport, false)
    assert.ok(page.resultReportSignature, 'successful generation stores the content signature for cache checks')

    platform.accessibleFiles.add(imagePath)
    const exportsBeforeCacheHit = platform.canvasExports.length
    assert.equal(page.closeSharePreview({ silent: true }), true)
    assert.equal(page.openSharePreview(), true, 'reopening the report flow checks the cached image')
    assert.equal(page.data.isCheckingResultReportCache, false, 'a verified cache hit completes the check')
    assert.equal(page.data.resultReportPreviewVisible, true, 'a verified cache hit restores the preview')
    assert.equal(platform.canvasExports.length, exportsBeforeCacheHit, 'a cache hit avoids another canvas export')
    assert.ok(platform.fileAccessLog.includes(imagePath), 'cache reuse verifies that the file still exists')

    assert.equal(page.previewResultReportImage(), true, 'the preview image opens in the native viewer')
    assert.equal(platform.wx.previewRequest.current, imagePath)

    let shareRequest
    platform.wx.showShareImageMenu = (request) => { shareRequest = request }
    assert.equal(page.shareResultReportImage(), true, 'the native share menu receives the generated image')
    assert.equal(shareRequest.path, imagePath)

    delete platform.wx.showShareImageMenu
    assert.equal(page.shareResultReportImage(), true, 'unsupported share menus retain the preview fallback')
    assert.equal(platform.wx.previewRequest.current, imagePath)
    assert.ok(platform.toastLog.some(({ title }) => title === '请长按图片转发'))

    let saveRequest
    platform.wx.saveImageToPhotosAlbum = (request) => { saveRequest = request }
    assert.equal(page.saveResultReportImage(), true, 'the generated image reaches the album-save API')
    assert.equal(saveRequest.filePath, imagePath)
    assert.equal(typeof saveRequest.success, 'function')
    saveRequest.success()
    assert.ok(platform.toastLog.some(({ title }) => title === '已保存到相册'))
  })
}

function testCanvasExportFailureStaysRecoverable() {
  withPage((page, platform) => {
    assert.equal(page.openSharePreview(), true)
    assert.equal(platform.runNextDrawCallback(), true)
    assert.equal(platform.canvasExports.length, 1)
    assert.equal(platform.rejectCanvasExport(), true)
    assert.equal(page.data.isGeneratingResultReport, false)
    assert.equal(page.data.resultReportPreviewVisible, false)
    assert.equal(page.data.resultReportImagePath, '')
    assert.match(page.data.resultReportError, /图片生成失败/)
    assert.equal(page.retryResultReport(), true, 'failed canvas export can be retried')
    assert.equal(platform.drawCallbacks.length, 1)
  })
}

assertCurrentTemplateBindings()
testGenerationCachePreviewShareSaveAndCanvas()
testCanvasExportFailureStaysRecoverable()
process.stdout.write('SPL report binding and lifecycle contract: passed\n')

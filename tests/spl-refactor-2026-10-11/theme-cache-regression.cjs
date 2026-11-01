'use strict'

const assert = require('node:assert/strict')
const { createPage, installPlatform, loadPageDefinition } = require('./harness.cjs')

const platform = installPlatform({ deferDrawCallbacks: true })
const themeState = { theme: 'light' }
const fillStyles = []
platform.wx.getAppBaseInfo = () => ({ theme: themeState.theme })
const createCanvasContext = platform.wx.createCanvasContext
platform.wx.createCanvasContext = (...args) => {
  const context = createCanvasContext(...args)
  const setFillStyle = context.setFillStyle
  context.setFillStyle = function (value) {
    fillStyles.push(value)
    return setFillStyle.call(this, value)
  }
  return context
}

try {
  const page = createPage(loadPageDefinition())
  page.onLoad()
  page.onShow()
  assert(page.data.canUseResultActions, 'fixture loads with a valid SPL result')
  page.setData({ shareSheetVisible: true, shareSheetClosing: false })

  const signature = page.getResultReportSignature()
  page.generateResultReportImage()
  assert.equal(platform.drawCallbacks.length, 1)
  platform.runNextDrawCallback()
  assert(fillStyles.includes('#f5f7f6'), 'light generation keeps the original light canvas background')
  assert.equal(platform.resolveCanvasExport(0, '/tmp/spl-theme-light.png'), true)
  assert.equal(page._resultReportImageTheme, 'light')
  assert.equal(page.resultReportSignature, signature, 'theme stays outside the content signature')

  themeState.theme = 'dark'
  const exportCountBeforeDark = platform.canvasExports.length
  page.generateResultReportImage()
  assert.equal(page.data.isGeneratingResultReport, true, 'theme mismatch starts a fresh render')
  assert.equal(platform.drawCallbacks.length, 1)
  platform.runNextDrawCallback()
  assert(fillStyles.includes('#111214'), 'dark generation uses the dark canvas background')
  assert.equal(platform.canvasExports.length, exportCountBeforeDark + 1)
  assert.equal(platform.resolveCanvasExport(0, '/tmp/spl-theme-dark.png'), true)
  assert.equal(page._resultReportImageTheme, 'dark')
  assert.equal(page.resultReportSignature, signature, 'dark render preserves the same content signature')

  platform.accessibleFiles.add('/tmp/spl-theme-dark.png')
  const exportCountBeforeCache = platform.canvasExports.length
  page.generateResultReportImage()
  assert.equal(page.data.resultReportPreviewVisible, true, 'same-content same-theme PNG is reused')
  assert.equal(platform.canvasExports.length, exportCountBeforeCache, 'cache hit performs no export')

  themeState.theme = 'light'
  page.generateResultReportImage()
  assert.equal(page.data.isGeneratingResultReport, true, 'different theme does not reuse the dark PNG')
  platform.runNextDrawCallback()
  assert.equal(platform.resolveCanvasExport(0, '/tmp/spl-theme-light-again.png'), true)
  assert.equal(page._resultReportImageTheme, 'light')

  assert.equal(page.previewResultReportImage(), true)
  assert.equal(platform.wx.previewRequest.current, '/tmp/spl-theme-light-again.png')
  page.onHide()
  themeState.theme = 'dark'
  page.onShow()
  assert.equal(page.data.resultReportPreviewVisible, true, 'returning from the native viewer keeps the snapshot visible')
  assert.equal(page.data.resultReportImagePath, '/tmp/spl-theme-light-again.png')
  assert.equal(page._resultReportImageTheme, 'light', 'theme change does not relabel an existing PNG')

  let pendingAccess
  platform.wx.getFileSystemManager = () => ({ access(request) { pendingAccess = request } })
  themeState.theme = 'light'
  page.generateResultReportImage()
  assert.equal(page.data.isCheckingResultReportCache, true)
  themeState.theme = 'dark'
  pendingAccess.success?.({})
  assert.equal(page.data.isCheckingResultReportCache, false)
  assert.equal(page.data.isGeneratingResultReport, true, 'theme change during cache check starts current-theme rendering')
  platform.runNextDrawCallback()
  assert.equal(platform.resolveCanvasExport(0, '/tmp/spl-theme-dark-after-check.png'), true)
  assert.equal(page._resultReportImageTheme, 'dark')

  page.generateResultReportImage()
  assert.equal(page.data.isCheckingResultReportCache, true, 'same-theme path is eligible for a file check')
  pendingAccess.success?.({})
  assert.equal(page.data.isGeneratingResultReport, false, 'same-theme cache check completes without a new draw')
  assert.equal(page.data.isCheckingResultReportCache, false)
  assert.equal(page.closeSharePreview({ silent: true }), true)

  themeState.theme = 'light'
  page.setData({ shareSheetVisible: true, shareSheetClosing: false })
  page.generateResultReportImage()
  platform.runNextDrawCallback()
  const staleExport = platform.canvasExports[0]
  assert(staleExport, 'generation reaches the asynchronous export stage')
  page.closeSharePreview({ silent: true })
  staleExport.success?.({ tempFilePath: '/tmp/spl-theme-stale.png' })
  assert.equal(page.data.resultReportImagePath, '', 'cancelled late export cannot commit a PNG')
  assert.equal(page.data.isGeneratingResultReport, false, 'cancel leaves no stuck loading state')

  page.onUnload()
  process.stdout.write('SPL theme cache regression: passed\n')
} finally {
  platform.restore()
}

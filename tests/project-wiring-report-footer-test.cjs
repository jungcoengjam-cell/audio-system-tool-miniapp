const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime } = require('./project-wiring-redesign-2026-10-16/runtime.cjs')

const root = path.resolve(__dirname, '..')
const markup = fs.readFileSync(path.join(root, 'pages/project-wiring/index.wxml'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'pages/project-wiring/index.wxss'), 'utf8')

async function main() {
  const reportFooter = markup.match(/<view class="wiring-sheet-actions wiring-report-actions">([\s\S]*?)<\/view>/)?.[1]
  assert.ok(reportFooter, 'report footer exists')
  assert.equal((reportFooter.match(/<button\b/g) || []).length, 2, 'footer has only two buttons')
  assert.match(reportFooter, /bindtap="shareReportImage">转发图片<\/button>/)
  assert.match(reportFooter, /bindtap="saveReportImage">保存本地<\/button>/)
  assert.doesNotMatch(reportFooter, /上一张|下一张|saveAllReportImages|stopReportSaveJob/)
  assert.match(markup, /class="wiring-close-button" bindtap="closeReportPreview"/,
    'close remains in the heading rather than the action footer')
  assert.match(markup, /class="wiring-report-page-hint"[\s\S]*?左右滑动切换/)
  assert.match(markup, /<swiper class="wiring-report-swiper" current="\{\{reportPageIndex\}\}"[^>]*bindchange="onReportPageSwipe"/)
  assert.match(markup, /<scroll-view class="wiring-report-image-scroll" scroll-y/)
  assert.match(markup, /class="wiring-report-image" src="\{\{reportImage\.path\}\}"[^>]*bindtap="previewReportImage"/)
  assert.match(markup, /wx:if="\{\{reportSaveError\}\}" class="wiring-report-save-error"/,
    'save failures and permission guidance are rendered as text')
  const statusStart = markup.indexOf('<view class="wiring-report-save-status">')
  const footerStart = markup.indexOf('<view class="wiring-sheet-actions wiring-report-actions">')
  const statusMarkup = markup.slice(statusStart, footerStart)
  assert.ok(statusStart >= 0 && footerStart > statusStart)
  assert.doesNotMatch(statusMarkup, /<button\b/,
    'saving progress and permission/error states are non-button text')
  assert.match(styles, /\.wiring-report-swiper\{[^}]*flex:1/)
  assert.match(styles, /\.wiring-report-image-scroll\{height:100%/)

  const env = createRuntime()
  const page = env.page()
  page._reportSignature = 'footer-test-signature'
  page.setData({
    reportImages: [
      { title: '线路清单', path: '/fixture/lines.png' },
      { title: '设备概览', path: '/fixture/devices.png' },
    ],
    reportPreviewVisible: true,
    reportPageIndex: 0,
  })
  page.showReportPage(0)
  assert.equal(page.data.reportImagePath, '/fixture/lines.png')
  assert.equal(page.onReportPageSwipe({ detail: { current: '1', source: 'touch' } }), true)
  assert.equal(page.data.reportPageIndex, 1)
  assert.equal(page.data.reportPageTitle, '设备概览')
  assert.equal(page.data.reportImagePath, '/fixture/devices.png')

  for (const current of [-1, 2, 1.5, 'not-an-index', undefined]) {
    assert.equal(page.onReportPageSwipe({ detail: { current } }), false,
      `invalid swiper page index ${String(current)} is ignored`)
    assert.equal(page.data.reportPageIndex, 1)
    assert.equal(page.data.reportImagePath, '/fixture/devices.png')
  }
  page.setData({ reportPreviewVisible: false })
  assert.equal(page.onReportPageSwipe({ detail: { current: 0 } }), false,
    'late swiper changes after close are ignored')
  assert.equal(page.data.reportPageIndex, 1)
  page.setData({ reportPreviewVisible: true })
  page._hidden = true
  assert.equal(page.onReportPageSwipe({ detail: { current: 0 } }), false,
    'swiper changes after page hide are ignored')
  page._hidden = false
  page._destroyed = true
  assert.equal(page.onReportPageSwipe({ detail: { current: 0 } }), false,
    'late swiper changes after unload are ignored')
  page._destroyed = false
  assert.equal(env.events.shares.length, 0, 'test does not invoke share or photo-library APIs')
  assert.equal(env.events.exports.length, 0)
  page.onUnload()

  const routingEnv = createRuntime()
  const routingPage = routingEnv.page()
  const apiRequests = []
  routingPage._reportSignature = 'routing-test-signature'
  routingEnv.wx.showShareImageMenu = (options) => apiRequests.push({ type: 'share', path: options.path })
  routingEnv.wx.saveImageToPhotosAlbum = (options) => apiRequests.push({ type: 'save', path: options.filePath })
  routingPage.setData({
    reportImages: [
      { title: '第一页', path: '/fixture/page-1.png' },
      { title: '第二页', path: '/fixture/page-2.png' },
    ],
    reportPreviewVisible: true,
    reportPageIndex: 0,
  })
  routingPage.showReportPage(1)
  routingPage.shareReportImage()
  routingPage.saveReportImage()
  assert.deepEqual(apiRequests, [
    { type: 'share', path: '/fixture/page-2.png' },
    { type: 'save', path: '/fixture/page-2.png' },
  ], 'both handlers route only the current image to inert wx API stubs')
  assert.equal(routingPage.data.reportSaveRunning, true,
    'pending save state is represented by status text, not a stop button')
  routingPage.onUnload()

  console.log('PASS project wiring report footer and safe swiper navigation')
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 })

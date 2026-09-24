'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')

const FACTS = {
  horizontalFov: 75, verticalFov: 36, sceneMode: 'ground', widthMeters: 6,
  depthMeters: 4, subjectHeightMeters: 1.8, heightMode: 'auto', marginPercent: 10,
}

function createCamera(env = createDelayedEnvironment()) {
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  return { env, page }
}

function activate(env) { global.wx = env.wx }

function begin(env, page, facts = FACTS) {
  activate(env)
  const result = page.beginStructuredOperation(facts, 'full-area')
  env.flushNextTicks()
  return page.getOperationSnapshot() || result
}

function generateCurrentReport(env, page) {
  activate(env)
  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, 1, 'current Camera report starts drawing')
  env.finishDraw(0)
  env.flushNextTicks()
  assert.equal(env.pending.canvases.length, 1, 'current Camera report starts export')
  env.finishCanvas(0, 'wxfile://camera-current.png')
  env.flushNextTicks()
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-current.png')
}

function watchImageActions(env) {
  const calls = { preview: [], share: [], save: [] }
  env.wx.previewImage = (options) => calls.preview.push(options)
  env.wx.showShareImageMenu = (options) => calls.share.push(options)
  env.wx.saveImageToPhotosAlbum = (options) => calls.save.push(options)
  return calls
}

function verifyProjectBoundary() {
  const changes = [
    ['structured operation', (env, page) => begin(env, page)],
    ['manual result change', (env, page) => {
      const previous = page.data.result
      page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
      env.flushNextTicks()
      page.onFieldInput({ currentTarget: { dataset: { field: 'customHorizontalFovText' } }, detail: { value: '65' } })
      page.flushPendingCalculation()
      env.flushNextTicks()
      assert.notEqual(page.data.result, previous, 'manual input handler should replace its prior Camera result')
    }],
    ['unload', (_env, page) => page.onUnload()],
  ]
  for (const [label, change] of changes) {
    const manual = createCamera()
    activate(manual.env)
    manual.page.saveToActiveProject()
    assert.equal(manual.env.pending.modals.length, 1, `${label}: manual project action opens the create-project modal`)
    const lateSuccess = manual.env.pending.modals[0].success
    assert.equal(typeof lateSuccess, 'function')
    change(manual.env, manual.page)
    const writesBeforeLateConfirm = manual.env.effects.storage.length
    const toastsBeforeLateConfirm = manual.env.effects.toasts.length
    lateSuccess({ confirm: true, content: `stale Camera ${label}` })
    manual.env.flushNextTicks()
    assert.equal(manual.env.effects.storage.length, writesBeforeLateConfirm,
      `${label}: stale Camera project confirmation must not create a project or add its captured manual record`)
    assert.equal((manual.env.storage.get('audioTool.projects.v1') || []).length, 0,
      `${label}: stale Camera project confirmation must leave the project list empty`)
    assert.equal(manual.env.effects.toasts.length, toastsBeforeLateConfirm,
      `${label}: stale Camera project confirmation must not show a success toast`)
  }
  return 'passed'
}

function verifyReportActions() {
  const report = createCamera()
  begin(report.env, report.page)
  const imageCalls = watchImageActions(report.env)
  generateCurrentReport(report.env, report.page)
  report.page.previewResultReportImage()
  report.page.shareResultReportImage()
  report.page.saveResultReportImage()
  assert.equal(imageCalls.preview.length, 1, 'current report can be previewed')
  assert.equal(imageCalls.share.length, 1, 'current report can be shared')
  assert.equal(imageCalls.save.length, 1, 'current report can be saved')

  report.page.setOperationCandidate('verticalFov', 24, 'deg')
  report.env.flushNextTicks()
  assert.equal(report.page.data.resultReportImagePath, '', 'candidate revision clears a previously generated report path')
  const afterCandidate = { preview: imageCalls.preview.length, share: imageCalls.share.length, save: imageCalls.save.length }
  report.page.previewResultReportImage()
  report.page.shareResultReportImage()
  report.page.saveResultReportImage()
  assert.deepEqual({ preview: imageCalls.preview.length, share: imageCalls.share.length, save: imageCalls.save.length }, afterCandidate,
    'candidate revision must not trigger image actions for its previous report')

  report.page.beginStructuredOperation({ ...FACTS, verticalFov: 24 }, 'full-area')
  report.env.flushNextTicks()
  assert.equal(report.page.data.resultReportImagePath, '', 'new operation invalidates the previous report path')
  const afterReplacement = { preview: imageCalls.preview.length, share: imageCalls.share.length, save: imageCalls.save.length }
  report.page.previewResultReportImage()
  report.page.shareResultReportImage()
  report.page.saveResultReportImage()
  assert.deepEqual({ preview: imageCalls.preview.length, share: imageCalls.share.length, save: imageCalls.save.length }, afterReplacement,
    'replaced operation must not trigger image actions for its old report')

  generateCurrentReport(report.env, report.page)
  report.page.onUnload()
  const afterUnload = { preview: imageCalls.preview.length, share: imageCalls.share.length, save: imageCalls.save.length }
  report.page.previewResultReportImage()
  report.page.shareResultReportImage()
  report.page.saveResultReportImage()
  assert.deepEqual({ preview: imageCalls.preview.length, share: imageCalls.share.length, save: imageCalls.save.length }, afterUnload,
    'unloaded Camera operation must not preview, share, or save an old report')

  const lateDraw = createCamera()
  begin(lateDraw.env, lateDraw.page)
  activate(lateDraw.env)
  lateDraw.page.generateResultReportImage()
  lateDraw.env.flushNextTicks()
  assert.equal(lateDraw.env.pending.draws.length, 1)
  lateDraw.page.onUnload()
  lateDraw.env.finishDraw(0)
  lateDraw.env.flushNextTicks()
  assert.equal(lateDraw.env.pending.canvases.length, 0, 'draw callback after unload must not start export')
  assert.equal(lateDraw.page.data.resultReportImagePath, '')
  assert.equal(lateDraw.page.data.resultReportPreviewVisible, false)

  const lateExport = createCamera()
  begin(lateExport.env, lateExport.page)
  activate(lateExport.env)
  lateExport.page.generateResultReportImage()
  lateExport.env.flushNextTicks()
  lateExport.env.finishDraw(0)
  lateExport.env.flushNextTicks()
  assert.equal(lateExport.env.pending.canvases.length, 1)
  const exportSuccess = lateExport.env.pending.canvases[0].success
  assert.equal(typeof exportSuccess, 'function')
  lateExport.page.onUnload()
  exportSuccess({ tempFilePath: 'wxfile://unloaded-camera.png' })
  lateExport.env.flushNextTicks()
  assert.equal(lateExport.page.data.resultReportImagePath, '', 'export callback after unload must not republish image path')
  assert.equal(lateExport.page.data.resultReportPreviewVisible, false, 'export callback after unload must not show preview')
  return 'passed'
}

function run() {
  const results = {}
  for (const [name, verify] of [['staleProjectConfirmation', verifyProjectBoundary], ['reportImageOutputBoundary', verifyReportActions]]) {
    try { results[name] = { status: 'passed', detail: verify() } }
    catch (error) { results[name] = { status: 'failed', message: error.message } }
  }
  const failures = Object.entries(results).filter(([, result]) => result.status === 'failed')
  if (failures.length) {
    const error = new Error(failures.map(([name, result]) => `${name}: ${result.message}`).join('\n'))
    error.results = results
    throw error
  }
  return results
}

if (require.main === module) {
  try { console.log(JSON.stringify(run(), null, 2)) }
  catch (error) {
    console.log(JSON.stringify({ status: 'failed', message: error.message, results: error.results, stack: error.stack }, null, 2))
    process.exitCode = 1
  }
}
module.exports = { run }

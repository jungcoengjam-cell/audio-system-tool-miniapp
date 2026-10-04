'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDelayedEnvironment } = require('./p2-safety-remediation/minimal/delayed-environment.cjs')

const repoRoot = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(repoRoot, 'pages/camera/camera.wxml'), 'utf8')

function createPage() {
  const env = createDelayedEnvironment()
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  return { env, page }
}

function input(page, field, value) {
  page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value: String(value) } })
}

function blur(env, page) {
  page.onFieldBlur()
  env.flushNextTicks()
}

function chooseScene(env, page, index) {
  page.onSceneModeTap({ currentTarget: { dataset: { index } } })
  env.flushNextTicks()
}

function chooseSource(env, page, index) {
  page.onSourceModeTap({ currentTarget: { dataset: { index } } })
  env.flushNextTicks()
}

function generateReport(env, page) {
  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, 1, 'report generation should queue a draw')
  env.finishDraw(0)
  env.flushNextTicks()
  assert.equal(env.pending.canvases.length, 1, 'report drawing should queue an export')
  env.finishCanvas(0, 'wxfile://camera-first-use.png')
  env.flushNextTicks()
  assert.equal(page.data.resultReportImagePath, 'wxfile://camera-first-use.png')
}

function testGeometryAndActiveValidation() {
  const { env, page } = createPage()
  assert.equal(page.data.result.primaryDistanceMeters, 4.83, 'default ground distance baseline must remain 4.83 m')
  assert.equal(page.data.result.cameraHeightMeters, 2.3, 'default automatic height baseline must remain 2.3 m')

  chooseScene(env, page, 1)
  assert.equal(page.data.result.primaryDistanceMeters, 4.63, 'plane distance baseline must remain 4.63 m')
  assert.equal(page.data.result.cameraHeightMeters, 2.05, 'plane height baseline must remain 2.05 m')

  input(page, 'planeBottomHeightText', '   ')
  assert.equal(page.data.result, null, 'a whitespace bottom height must immediately clear the result')
  assert(page.data.inputErrors.planeBottomHeightText, 'the active bottom-height field should carry its own error')
  input(page, 'planeBottomHeightText', '0')
  blur(env, page)
  assert.equal(page.data.inputErrors.planeBottomHeightText, undefined, 'restoring an explicit zero should clear the error')
  assert(page.data.result, 'an explicit zero bottom height should calculate')
  assert.equal(page.data.result.bottomHeightMeters, 0, 'the explicit zero bottom height must be preserved')

  input(page, 'groundWidthText', '')
  assert(page.data.result, 'an inactive ground field must not block the active plane scene')
  blur(env, page)
  assert(page.data.result, 'calculation should ignore an invalid hidden ground field')
  chooseScene(env, page, 0)
  assert.equal(page.data.result, null, 'switching to the scene with a blank width must block calculation')
  assert(page.data.inputErrors.groundWidthText, 'the now-active ground width should show an inline error')
  chooseScene(env, page, 1)
  assert(page.data.result, 'switching away should ignore the blank ground field again')

  page.onHeightModeTap({ currentTarget: { dataset: { index: 1 } } })
  env.flushNextTicks()
  input(page, 'fixedCameraHeightText', '')
  assert.equal(page.data.result, null, 'an empty active fixed height should clear the old result')
  page.onHeightModeTap({ currentTarget: { dataset: { index: 0 } } })
  env.flushNextTicks()
  assert(page.data.result, 'an invalid fixed height should not block automatic-height mode')
  assert.equal(page.data.inputErrors.fixedCameraHeightText, undefined)

  chooseSource(env, page, 1)
  input(page, 'customVerticalFovText', '  ')
  assert.equal(page.data.result, null, 'a whitespace custom angle must be rejected before Number conversion')
  assert(page.data.inputErrors.customVerticalFovText)
  chooseSource(env, page, 0)
  assert(page.data.result, 'blank custom angles must not block catalog optics')
  assert.equal(page.data.inputErrors.customVerticalFovText, undefined)

  const anglePage = createPage()
  chooseSource(anglePage.env, anglePage.page, 1)
  input(anglePage.page, 'customHorizontalFovText', '0')
  assert(anglePage.page.data.inputErrors.customHorizontalFovText, 'zero horizontal FOV must fail')
  input(anglePage.page, 'customHorizontalFovText', '179')
  assert(anglePage.page.data.inputErrors.customHorizontalFovText, '179 degree horizontal FOV must fail')
  input(anglePage.page, 'customHorizontalFovText', '178.99')
  blur(anglePage.env, anglePage.page)
  assert(anglePage.page.data.result, 'an angle below the existing 179 degree limit should calculate')
  input(anglePage.page, 'customVerticalFovText', '179')
  assert(anglePage.page.data.inputErrors.customVerticalFovText, '179 degree vertical FOV must fail')
  input(anglePage.page, 'customVerticalFovText', '36')
  blur(anglePage.env, anglePage.page)
  assert(anglePage.page.data.result, 'restoring a valid vertical angle should restore calculation')
}

function testReportInvalidation() {
  const saved = createPage()
  generateReport(saved.env, saved.page)
  input(saved.page, 'groundWidthText', '')
  assert.equal(saved.page.data.result, null)
  assert.equal(saved.page.data.resultReportImagePath, '', 'invalid input must clear an already generated image')
  assert.equal(saved.page.data.resultReportPreviewVisible, false)
  assert.equal(saved.page.data.isGeneratingResultReport, false)

  const generating = createPage()
  generating.page.generateResultReportImage()
  generating.env.flushNextTicks()
  assert.equal(generating.env.pending.draws.length, 1)
  input(generating.page, 'groundDepthText', ' ')
  assert.equal(generating.page.data.result, null)
  assert.equal(generating.page.data.resultReportImagePath, '')
  assert.equal(generating.page.data.isGeneratingResultReport, false)
  generating.env.finishDraw(0)
  generating.env.flushNextTicks()
  assert.equal(generating.env.pending.canvases.length, 0, 'a stale in-flight draw must not export after validation fails')
  assert.equal(generating.page.data.resultReportImagePath, '')
}

function testSelectorAndHorizontalOnlyCopy() {
  const { env, page } = createPage()
  page.openCameraSelector()
  const selectorItem = page.data.selectorItems.find((item) => item.model === 'TS-0650JSM')
  assert(selectorItem, 'the dual-view camera should remain searchable')
  assert.equal(selectorItem.opticsLines.length, 2, 'the selector should keep one compact line per camera view')
  assert(!Object.hasOwn(selectorItem, 'views') && !Object.hasOwn(selectorItem, 'source'), 'selector items must not retain full product records')
  assert(selectorItem.opticsLines[0].includes('广角端'))
  assert(selectorItem.opticsLines[0].includes('厂家水平') && selectorItem.opticsLines[0].includes('垂直'))
  assert(selectorItem.opticsLines[0].includes('参数完整'))
  assert(selectorItem.opticsLines[1].includes('固定视角'))
  assert(selectorItem.opticsLines[1].includes('缺垂直角，仅水平预估'))
  assert(selectorItem.opticsLines.every((line) => !line.includes('长焦端')), 'selector should describe the installed wide/fixed view only')

  page.selectCamera({ currentTarget: { dataset: { index: selectorItem.index } } })
  env.flushNextTicks()
  const fixedViewIndex = page.data.viewOptions.findIndex((view) => view.label === '教师全景')
  assert(fixedViewIndex >= 0)
  page.onViewTap({ currentTarget: { dataset: { index: fixedViewIndex } } })
  env.flushNextTicks()
  assert.equal(page.data.result.horizontalOnly, true, 'a catalog view without vertical FOV should remain horizontal-only')
  assert(page.data.selectedOpticsLines[0].includes('固定视角'))
  assert(page.data.selectedOpticsLines[0].includes('垂直 未提供'))
  assert(wxml.includes('垂直未校核 · 仅水平预估'), 'the main result should visibly flag missing vertical verification')
  assert(wxml.includes("result.horizontalOnly ? '蓝色范围只代表水平覆盖，垂直画面尚未校核。'"), 'horizontal-only preview text must not claim complete framing')

  const summary = page.getInstallSummary()
  assert(summary.length < 350, 'installation summary should remain compact')
  assert(summary.includes('TS-0650JSM') && summary.includes('教师全景'))
  assert(summary.includes('镜头距拍摄区前沿（水平）'))
  assert(summary.includes('垂直未校核') && summary.includes('说明书或样机验证'))
  assert(!summary.includes('tan(') && !summary.includes('代入'), 'installation summary must not include formulas')
  assert(wxml.includes('input-wrap-error') && wxml.includes('class="input-error"'), 'active input errors should have field-local styling')
}

function testSummaryFlushAndHeightBasis() {
  const { env, page } = createPage()
  const oldDistance = page.data.result.primaryDistanceMeters
  const originalSetData = page.setData
  let deferredResultPatch
  page.setData = (patch, callback) => {
    if (patch?.result?.primaryDistanceMeters !== undefined) {
      deferredResultPatch = { patch, callback }
      return
    }
    originalSetData(patch, callback)
  }
  input(page, 'groundWidthText', '8')
  page.copyInstallSummary()
  const copied = env.effects.clipboard.at(-1)
  assert(copied.includes('地面区 8×4 m'), 'copy must flush the latest input before formatting the summary')
  assert.notEqual(deferredResultPatch?.patch.result.primaryDistanceMeters, oldDistance, 'the deferred result should reflect the changed geometry')
  assert.notEqual(copied, page.getInstallSummary(page.data.result), 'copy must use the new calculation instead of the displayed old result')
  assert(deferredResultPatch, 'the test should hold the asynchronous result publication')
  page.setData = originalSetData
  originalSetData(deferredResultPatch.patch, deferredResultPatch.callback)
  env.flushNextTicks()

  page.onHeightModeTap({ currentTarget: { dataset: { index: 1 } } })
  env.flushNextTicks()
  const fixedSummary = page.getInstallSummary()
  assert(fixedSummary.includes('已有镜头中心高'))
  assert(fixedSummary.includes('沿用已填写高度'))
  page.onHeightModeTap({ currentTarget: { dataset: { index: 0 } } })
  env.flushNextTicks()
  const automaticSummary = page.getInstallSummary()
  assert(automaticSummary.includes('最高点 + 0.5 m，且不低于 1.5 m'))
  assert(automaticSummary.length < 350)
}

function testStructuredOperationIsolation() {
  const { env, page } = createPage()
  chooseSource(env, page, 1)
  const facts = {
    horizontalFov: 60,
    sceneMode: 'ground',
    widthMeters: 6,
    depthMeters: 4,
    subjectHeightMeters: 1.8,
    heightMode: 'auto',
    marginPercent: 10,
  }
  page.beginStructuredOperation(facts, 'full-area')
  env.flushNextTicks()
  assert(page.getOperationSnapshot()?.active)
  assert.equal(page.data.result, null, 'unconfirmed structured operations should have no result')
  assert.deepEqual(page.data.inputErrors, {}, 'manual field errors must not leak into a structured operation')
  const beforeBlockedCopy = env.effects.clipboard.length
  page.copyInstallSummary()
  assert.equal(env.effects.clipboard.length, beforeBlockedCopy, 'unconfirmed structured operations must not copy a summary')

  page.confirmOperationField({ currentTarget: { dataset: { field: 'verticalFov' } } })
  assert.equal(env.pending.modals.length, 1, 'missing vertical angle should use the existing confirmation boundary')
  env.answerModal(0, true)
  env.flushNextTicks()
  assert(page.data.result && !page.data.result.horizontalOnly, 'confirmed structured fields should calculate as before')
  const beforeConfirmedCopy = env.effects.clipboard.length
  page.copyInstallSummary()
  assert.equal(env.effects.clipboard.length, beforeConfirmedCopy + 1, 'a current confirmed structured result may copy its summary')

  input(page, 'customVerticalFovText', '')
  env.flushNextTicks()
  assert.equal(page.data.result, null, 'editing a confirmed structured angle must invalidate its result')
  assert.deepEqual(page.data.inputErrors, {}, 'manual input errors must not alter structured confirmation state')
  const beforeInvalidCopy = env.effects.clipboard.length
  page.copyInstallSummary()
  assert.equal(env.effects.clipboard.length, beforeInvalidCopy, 'an invalidated structured result must not copy')
  page.endOperation()
  env.flushNextTicks()
  assert(page.data.inputErrors.customVerticalFovText, 'ending the operation should validate the pending blank manual angle')
  assert.equal(page.data.result, null)
}

function run() {
  testGeometryAndActiveValidation()
  testReportInvalidation()
  testSelectorAndHorizontalOnlyCopy()
  testSummaryFlushAndHeightBasis()
  testStructuredOperationIsolation()
  return { cameraFirstUse: 'passed', validation: 'passed', summary: 'passed', structuredIsolation: 'passed' }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`)

module.exports = { run }

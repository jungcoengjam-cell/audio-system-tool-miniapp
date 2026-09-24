'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')
const { patchExport } = require('../../p2-safety/harness.cjs')
const cameraCore = require('../../../utils/camera-fov')

function activate(env) { global.wx = env.wx }

const FULL = Object.freeze({
  horizontalFov: 75,
  sceneMode: 'ground',
  widthMeters: 6,
  depthMeters: 4,
  subjectHeightMeters: 1.8,
  heightMode: 'auto',
  marginPercent: 10,
})

function createPage(env = createDelayedEnvironment(), sourceModeIndex = 0) {
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  if (sourceModeIndex !== 0) {
    page.onSourceModeTap({ currentTarget: { dataset: { index: sourceModeIndex } } })
    env.flushNextTicks()
  }
  return { env, page }
}

function fullFacts(verticalFov, marginPercent = 10) {
  return { ...FULL, marginPercent, ...(verticalFov === undefined ? {} : { verticalFov }) }
}

function begin(env, page, facts, kind) {
  activate(env)
  if (page.data.sourceModeIndex !== 1) {
    page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
    env.flushNextTicks()
  }
  const snapshot = page.beginStructuredOperation(facts, kind)
  env.flushNextTicks()
  return page.getOperationSnapshot() || snapshot
}

function confirm(env, page, field) {
  activate(env)
  return page.confirmOperationField({ currentTarget: { dataset: { field } } })
}

function directFull(verticalFov, marginPercent = 10) {
  return cameraCore.calculateGroundAreaPlacement(cameraCore.resolveCustomFov({
    definitionMode: 'angles', horizontalFov: 75, verticalFov,
  }), {
    widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8,
    heightMode: 'auto', marginRatio: marginPercent / 100,
  })
}

function verifyStaleStructuredReports() {
  const drawEnv = createDelayedEnvironment()
  const drawPage = createPage(drawEnv).page
  begin(drawEnv, drawPage, fullFacts(36), 'full-area')
  activate(drawEnv)
  drawPage.generateResultReportImage()
  drawEnv.flushNextTicks()
  assert.equal(drawEnv.pending.draws.length, 1, 'structured report draw must begin')
  assert.equal(typeof drawEnv.pending.draws[0], 'function')
  const oldDraw = drawEnv.pending.draws[0]
  drawPage.setOperationCandidate('verticalFov', 24, 'deg')
  assert.equal(drawPage.data.resultReportImagePath, '')
  oldDraw()
  drawEnv.flushNextTicks()
  assert.equal(drawEnv.pending.canvases.length, 0, 'VFOV revision change must stop stale draw before export')
  assert.equal(drawPage.data.resultReportImagePath, '')
  assert.equal(drawPage.data.resultReportPreviewVisible, false)
  const clipboardBefore = drawEnv.effects.clipboard.length
  drawPage.copyResult()
  assert.equal(drawEnv.effects.clipboard.length, clipboardBefore, 'invalidated Camera result must not copy')

  const exportEnv = createDelayedEnvironment()
  const exportPage = createPage(exportEnv).page
  begin(exportEnv, exportPage, fullFacts(36), 'full-area')
  activate(exportEnv)
  exportPage.generateResultReportImage()
  exportEnv.flushNextTicks()
  exportEnv.finishDraw(0)
  exportEnv.flushNextTicks()
  assert.equal(exportEnv.pending.canvases.length, 1, 'structured report export must begin after draw')
  assert.equal(typeof exportEnv.pending.canvases[0]?.success, 'function')
  const oldExport = exportEnv.pending.canvases[0].success
  exportPage.beginStructuredOperation(fullFacts(24), 'full-area')
  exportEnv.flushNextTicks()
  oldExport({ tempFilePath: 'wxfile://stale-camera-operation.png' })
  exportEnv.flushNextTicks()
  assert.equal(exportPage.data.resultReportImagePath, '', 'replacement operation must reject stale image export')
  assert.equal(exportPage.data.resultReportPreviewVisible, false, 'replacement operation must not show stale preview')
}

function run() {
  const coreCalls = { ground: 0 }
  const spy = patchExport('utils/camera-fov.js', 'calculateGroundAreaPlacement', (original) => (...args) => {
    coreCalls.ground += 1
    return original(...args)
  })
  try {
  const { env, page } = createPage()
  assert.equal(page.data.customVerticalFovText, '36', 'CAM-007 setup keeps page VFOV candidate at 36')
  const blocked = begin(env, page, fullFacts(), 'full-area')
  assert.equal(blocked.status, 'blocked', 'full-area must block without current-operation VFOV')
  assert(blocked.blockers.includes('verticalFov'), 'full-area blocker must identify VFOV')
  assert.equal(page.data.customVerticalFovText, '36', 'blocked operation must leave page candidate visible')
  assert.equal(page.data.result, null, 'blocked structured operation must clear any manual result')
  assert.equal(page.getRecordPayload(), null, 'blocked operation must not expose record output')

  const defaultPageEnv = createDelayedEnvironment()
  const defaultPage = createPage(defaultPageEnv).page
  assert.equal(defaultPage.data.sourceModeIndex, 0, 'default Camera page should remain in catalog mode')
  assert(defaultPage.data.result, 'pre-existing manual catalog result should exist before structured begin')
  const previousManualResult = defaultPage.data.result
  const defaultBlocked = defaultPage.beginStructuredOperation(fullFacts(), 'full-area')
  defaultPageEnv.flushNextTicks()
  assert.equal(defaultBlocked.status, 'blocked', 'explicit custom CAM-007 facts must work from default catalog UI')
  assert.equal(defaultPage.data.customVerticalFovText, '36', 'page candidate must remain visible and unconfirmed')
  assert.equal(defaultPage.data.result, null, 'structured begin must clear the prior manual catalog result')
  assert.notEqual(defaultPage.data.result, previousManualResult)
  assert.equal(defaultPage.getResultText(), '', 'blocked operation must not expose result text')
  const beforeBlockedActions = {
    clipboard: defaultPageEnv.effects.clipboard.length,
    draws: defaultPageEnv.pending.draws.length,
    exports: defaultPageEnv.pending.canvases.length,
    modals: defaultPageEnv.pending.modals.length,
    storage: defaultPageEnv.effects.storage.length,
  }
  activate(defaultPageEnv)
  defaultPage.copyResult()
  defaultPage.generateResultReportImage()
  defaultPage.toggleCurrentFavorite()
  defaultPage.saveToActiveProject()
  assert.deepEqual({
    clipboard: defaultPageEnv.effects.clipboard.length,
    draws: defaultPageEnv.pending.draws.length,
    exports: defaultPageEnv.pending.canvases.length,
    modals: defaultPageEnv.pending.modals.length,
    storage: defaultPageEnv.effects.storage.length,
  }, beforeBlockedActions, 'blocked result actions must have no output side effects')

  const horizontal = begin(env, page, { ...FULL }, 'horizontal-only')
  assert.equal(horizontal.ready, true, 'horizontal-only operation must not require VFOV')
  assert.equal(page.data.result?.horizontalOnly, true, 'horizontal-only must not be upgraded to full-area')
  assert.equal(page.data.result?.verticalFov, undefined, 'horizontal-only result must omit VFOV')
  const directHorizontal = cameraCore.calculateHorizontalOnlyPlacement({ horizontalOnly: true, horizontalFov: 75 }, {
    sceneMode: 'ground', widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8,
    heightMode: 'auto', marginRatio: 0.1,
  })
  assert.equal(page.data.result?.primaryDistanceMeters, directHorizontal?.primaryDistanceMeters,
    'horizontal-only page result must match direct deterministic core')

  const missingAgain = begin(env, page, fullFacts(), 'full-area')
  assert.equal(missingAgain.ready, false, 'new full-area operation must not inherit old operation inputs')
  confirm(env, page, 'verticalFov')
  assert.equal(env.pending.modals.length, 1, 'same-value page candidate must request explicit confirmation')
  env.answerModal(0, true)
  env.flushNextTicks()
  assert.equal(page.data.result?.verticalFov, 36, 'explicit same-value VFOV confirmation should execute')
  assert.equal(page.data.result?.primaryDistanceMeters, directFull(36)?.primaryDistanceMeters,
    'confirmed 36-degree result must match direct deterministic core')

  const alternate = begin(env, page, fullFacts(24), 'full-area')
  assert.equal(alternate.ready, true, 'explicit alternate VFOV must be accepted for new operation')
  assert.equal(page.data.result?.verticalFov, 24, 'alternate VFOV must control result')
  assert.equal(page.data.result?.primaryDistanceMeters, directFull(24)?.primaryDistanceMeters,
    'confirmed 24-degree result must match direct deterministic core')
  assert.notEqual(page.data.result?.primaryDistanceMeters, directFull(36)?.primaryDistanceMeters,
    'controlled alternate VFOV must materially change the geometry result')
  assert.notEqual(page.data.result?.horizontalOnly, true, 'full-area operation must never silently downgrade')
  assert(page.getResultText().includes('24°'), 'result text must reflect confirmed alternate VFOV')
  const alternateEleven = begin(env, page, fullFacts(24, 11), 'full-area')
  assert(alternateEleven.ready)
  assert.equal(page.data.result?.marginPercent, 11, 'structured result must retain explicitly supplied 11% margin')
  assert.equal(page.getRecordPayload()?.preferences.marginPercent, 11,
    'structured record preference must match the snapshot margin, not the page 10% choice')
  assert.equal(page.data.result?.primaryDistanceMeters, directFull(24, 11)?.primaryDistanceMeters)

  activate(env)
  const beforeStructuredRecordActions = {
    storage: env.effects.storage.length,
    modals: env.pending.modals.length,
    clipboard: env.effects.clipboard.length,
    draws: env.pending.draws.length,
  }
  page.toggleCurrentFavorite()
  page.saveToActiveProject()
  assert.equal(env.effects.storage.length, beforeStructuredRecordActions.storage,
    'structured Camera favorite must not persist a replay record')
  assert.equal(env.pending.modals.length, beforeStructuredRecordActions.modals,
    'structured Camera project action must not open a replay modal')
  page.copyResult()
  assert.equal(env.effects.clipboard.length, beforeStructuredRecordActions.clipboard + 1,
    'structured Camera copy remains available')
  page.generateResultReportImage()
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, beforeStructuredRecordActions.draws + 1,
    'structured Camera report remains available')

  const oldResult = page.data.result
  page.setOperationCandidate('verticalFov', 30, 'deg')
  env.flushNextTicks()
  assert.equal(page.data.result, null, 'changing VFOV must invalidate the old result')
  assert.equal(page.getRecordPayload(), null, 'invalidated result must not be record eligible')
  assert.notEqual(page.data.result, oldResult)
  page.endOperation()
  env.flushNextTicks()
  const manualStorageBefore = env.effects.storage.length
  page.toggleCurrentFavorite()
  assert(env.effects.storage.length > manualStorageBefore,
    'after ending structured mode, manual favorite must use the shared record helper')
  const manualModalBefore = env.pending.modals.length
  page.saveToActiveProject()
  assert.equal(env.pending.modals.length, manualModalBefore + 1,
    'after ending structured mode, manual project action must use the shared helper modal')
  assert.equal(typeof env.pending.modals[manualModalBefore].success, 'function',
    'manual shared project modal callback must remain available')
  env.answerModal(manualModalBefore, true, 'Camera manual actions')
  assert.equal(env.effects.toasts.at(-1)?.title, '已加入Camera manual actions',
    'manual project helper should retain its existing success toast')
  const savedProjects = env.storage.get('audioTool.projects.v1') || []
  assert.equal(savedProjects.length, 1, 'manual project helper should still create a project')
  assert.equal((env.storage.get('audioTool.records.v1') || []).length, 1,
    'manual project helper should still add its record')
  env.wx.setStorageSync = () => { throw new Error('simulated local storage failure') }
  page.saveToActiveProject()
  assert.equal(env.effects.toasts.at(-1)?.title, '保存失败，请检查本地存储',
    'manual shared project helper must retain its storage failure toast')

  verifyStaleStructuredReports()

  for (const [label, alter] of [
    ['invalid scene', (facts) => { facts.sceneMode = 'ceiling' }],
    ['invalid height mode', (facts) => { facts.heightMode = 'estimate' }],
    ['invalid margin', (facts) => { facts.marginPercent = 51 }],
  ]) {
    const caseEnv = createDelayedEnvironment()
    const casePage = createPage(caseEnv).page
    casePage.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
    caseEnv.flushNextTicks()
    const facts = fullFacts(36)
    alter(facts)
    const callsBefore = coreCalls.ground
    const snapshot = begin(caseEnv, casePage, facts, 'full-area')
    assert.notEqual(snapshot.status, 'ready', `${label} must be rejected before calculation`)
    assert.equal(casePage.data.result, null, `${label} must not expose a result`)
    assert.equal(coreCalls.ground, callsBefore, `${label} must not fall through to core defaults`)
  }

  const inputEnv = createDelayedEnvironment()
  const inputPage = createPage(inputEnv).page
  begin(inputEnv, inputPage, fullFacts(36), 'full-area')
  const confirmedResult = inputPage.data.result
  inputPage.onFieldInput({ currentTarget: { dataset: { field: 'customVerticalFovText' } }, detail: { value: '24' } })
  inputEnv.flushNextTicks()
  assert.equal(inputPage.data.result, null, 'editing VFOV through the real page handler must invalidate result')
  assert.notEqual(inputPage.data.result, confirmedResult)
  inputPage.cancelPendingCalculation()

  const modelEnv = createDelayedEnvironment()
  const modelPage = createPage(modelEnv).page
  begin(modelEnv, modelPage, fullFacts(36), 'full-area')
  const structuredBeforeModelChange = modelPage.data.result
  activate(modelEnv)
  modelPage.selectCamera({ currentTarget: { dataset: { index: 1 } } })
  modelEnv.flushNextTicks()
  assert.equal(modelPage.getOperationSnapshot()?.ready, false, 'selecting a different model must invalidate active structured context')
  assert.notEqual(modelPage.getOperationSnapshot()?.status, 'ready', 'invalid context must remain structured until explicit end')
  assert.equal(require('../../../utils/operation-inputs').prepareOperation(modelPage).blocked, true)
  assert.equal(modelPage.getRecordPayload(), null)
  assert.notEqual(modelPage.data.result, structuredBeforeModelChange, 'model change must not leave old structured result current')

  const staleEnv = createDelayedEnvironment()
  const stalePage = createPage(staleEnv).page
  begin(staleEnv, stalePage, fullFacts(), 'full-area')
  confirm(staleEnv, stalePage, 'verticalFov')
  assert.equal(staleEnv.pending.modals.length, 1, 'stale callback test must capture a pending VFOV confirmation')
  const staleSuccess = staleEnv.pending.modals[0].success
  assert.equal(typeof staleSuccess, 'function', 'stale confirmation callback must be capturable')
  begin(staleEnv, stalePage, { ...FULL, verticalFov: 24 }, 'full-area')
  staleSuccess({ confirm: true })
  assert.equal(stalePage.data.result?.verticalFov, 24, 'stale callback must not replace newer operation result')

  const unloadEnv = createDelayedEnvironment()
  const oldPage = createPage(unloadEnv).page
  begin(unloadEnv, oldPage, fullFacts(), 'full-area')
  confirm(unloadEnv, oldPage, 'verticalFov')
  assert.equal(unloadEnv.pending.modals.length, 1, 'unload test must capture a pending VFOV confirmation')
  const lateSuccess = unloadEnv.pending.modals[0].success
  assert.equal(typeof lateSuccess, 'function', 'unload confirmation callback must be capturable')
  const callsBeforeUnload = coreCalls.ground
  let unloaded = false
  let resultPublicationsAfterUnload = 0
  const setData = oldPage.setData
  oldPage.setData = (patch, callback) => {
    if (unloaded && patch?.result) resultPublicationsAfterUnload += 1
    return setData(patch, callback)
  }
  oldPage.onUnload()
  unloaded = true
  oldPage.onUnload()
  lateSuccess({ confirm: true })
  lateSuccess({ confirm: false, cancel: true })
  assert.equal(oldPage.data.result, null, 'late confirmation must not publish after unload')
  assert.notEqual(oldPage.getOperationSnapshot()?.status, 'ready', 'unload must permanently dispose old instance')
  assert.equal(coreCalls.ground, callsBeforeUnload, 'late success/cancel must not start Camera core after unload')
  assert.equal(resultPublicationsAfterUnload, 0, 'late callback must not publish a result after unload')
  const newPage = createPage(unloadEnv).page
  begin(unloadEnv, newPage, fullFacts(24), 'full-area')
  assert.equal(newPage.data.result?.verticalFov, 24, 'new page should calculate from its own operation')

  const queuedEnv = createDelayedEnvironment()
  const queuedPage = createPage(queuedEnv).page
  queuedPage.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
  queuedEnv.flushNextTicks()
  const callsBeforeQueuedUnload = coreCalls.ground
  queuedPage.beginStructuredOperation(fullFacts(36), 'full-area')
  queuedPage.onUnload()
  queuedEnv.flushNextTicks()
  assert.equal(queuedPage.data.result, null, 'already queued ready callback must not calculate after unload')
  assert.equal(coreCalls.ground, callsBeforeQueuedUnload, 'queued ready callback must not enter core after unload')
  assert.equal(queuedPage.calculate(), null, 'manual calculate on disposed Camera instance must stay terminal')

  const cancelEnv = createDelayedEnvironment()
  const cancelPage = createPage(cancelEnv).page
  begin(cancelEnv, cancelPage, fullFacts(), 'full-area')
  confirm(cancelEnv, cancelPage, 'verticalFov')
  assert.equal(cancelEnv.pending.modals.length, 1, 'cancel test must capture the real VFOV confirmation')
  const lateCancel = cancelEnv.pending.modals[0].success
  assert.equal(typeof lateCancel, 'function')
  cancelPage.onUnload()
  lateCancel({ confirm: false, cancel: true })
  assert.equal(cancelPage.data.result, null, 'late cancel after unload must be harmless')
  lateSuccess({ confirm: true })
  assert.equal(newPage.data.result?.verticalFov, 24, 'old page callback must not affect a new page instance')

  const manual = createPage()
  assert(manual.page.data.result, 'manual initial catalog calculation should remain available')
  assert.equal(manual.page.data.result.verticalFov, 42.7, 'ordinary catalog full-area optics should remain available')
  manual.page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
  manual.env.flushNextTicks()
  assert.equal(manual.page.data.result.verticalFov, 36, 'ordinary custom full-area path should retain VFOV use')
  manual.page.onDefinitionModeTap({ currentTarget: { dataset: { index: 1 } } })
  manual.env.flushNextTicks()
  assert(manual.page.data.result?.verticalFov > 0, 'manual sensor plus focal length derivation should remain available')
  const manualText = manual.page.getResultText()
  assert(manualText && manual.page.getRecordPayload(), 'manual text and record compatibility should remain')
  manual.page.copyResult()
  assert.equal(manual.env.effects.clipboard.at(-1), manualText, 'manual copy should remain available')
  manual.page.generateResultReportImage()
  manual.env.flushNextTicks()
  assert.equal(manual.env.pending.draws.length, 1, 'manual report drawing should remain available')
  manual.env.finishDraw(0)
  manual.env.flushNextTicks()
  assert.equal(manual.env.pending.canvases.length, 1, 'manual report export should remain available')
  manual.env.finishCanvas(0, 'wxfile://manual-camera.png')
  manual.env.flushNextTicks()
  assert.equal(manual.page.data.resultReportImagePath, 'wxfile://manual-camera.png')

  const catalogEnv = createDelayedEnvironment()
  const catalogPage = createPage(catalogEnv, 0).page
  assert(catalogPage.data.result && !catalogPage.data.result.horizontalOnly,
    'catalog full-area camera path should remain available')
  catalogPage.selectCamera({ currentTarget: { dataset: { index: 6 } } })
  catalogEnv.flushNextTicks()
  assert.equal(catalogPage.data.result?.horizontalOnly, true,
    'catalog horizontal-only camera path should remain available without vertical optics')

  return {
    cam007: 'passed', horizontalOnly: 'passed', confirmation36: 'passed', alternate24: 'passed',
    invalidation: 'passed', staleCallback: 'passed', staleReportCallbacks: 'passed', unload: 'passed', manualCompatibility: 'passed',
  }
  } finally {
    spy.restore()
  }
}

if (require.main === module) {
  const result = run()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
module.exports = { run }

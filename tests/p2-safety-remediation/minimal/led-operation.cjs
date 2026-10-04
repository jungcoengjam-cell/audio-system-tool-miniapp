'use strict'

const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')
const { CASE_FACTS } = require('./fixtures.cjs')
const { patchExport } = require('../../p2-safety/harness.cjs')
const { LED_UNIT_SPECS, calculateLedScreenPlan } = require('../../../utils/led-screen')

function inputsFor(facts) {
  const p = facts.supplied
  const input = {
    wallWidthMeters: p['led_screen.wall_width_m'], wallHeightMeters: p['led_screen.wall_height_m'],
    topReserveMeters: p['led_screen.top_clearance_m'], bottomReserveMeters: p['led_screen.bottom_clearance_m'],
    frameWidthCm: p['led_screen.border_width_m'] === undefined ? undefined : p['led_screen.border_width_m'] * 100,
    viewingDistanceMeters: p['led_screen.nearest_viewing_distance_m'],
    aspectRatioKey: p['led_screen.aspect_ratio'], pixelPitch: p['led_screen.pixel_pitch'],
  }
  const category = p['led_screen.assembly_unit']
  if (category === '常规箱体') input.unitKey = 'cabinetStandard'
  if (category === '模组拼') input.unitKey = 'module'
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function missingValues(id) {
  const standard = {
    topReserveMeters: 0.2, bottomReserveMeters: 0.2, frameWidthCm: 5,
    unitKey: 'cabinetStandard', unitWidthMm: 640, unitHeightMm: 480, pixelPitch: 'recommended',
  }
  if (id === 'LED-001') return { unitWidthMm: 640, unitHeightMm: 480 }
  if (id === 'LED-003') return { topReserveMeters: 0.2, bottomReserveMeters: 0.2, frameWidthCm: 5, unitWidthMm: 320, unitHeightMm: 160 }
  return standard
}

function createPage(id) {
  const facts = CASE_FACTS[id]
  const env = createDelayedEnvironment()
  if (facts.persisted) env.wx.setStorageSync('audioTool.ledScreen.preferences', facts.persisted)
  const page = env.loadPage('pages/led-screen/led-screen.js')
  page.onLoad()
  global.getCurrentPages = () => [page]
  page.onShow()
  env.flushNextTicks()
  return { env, page, facts }
}

function assertLedgerOutputBlocked(page, id) {
  assert.strictEqual(page.data.result, null, `${id}: result escaped before required confirmation`)
  assert.strictEqual(page.data.reportImagePath, '', `${id}: old report image survived operation start/change`)
  assert.strictEqual(page.data.reportPreviewVisible, false, `${id}: old report preview survived operation start/change`)
  assert.strictEqual(page.getRecordPayload(), null, `${id}: blocked operation exposed a record payload`)
}

function runManualCompatibility() {
  const { env, page } = createPage('LED-001')
  assert(page.data.result, 'manual onLoad must keep its normal initial result')
  const initialResult = page.data.result
  const text = page.getResultText()
  const record = page.getRecordPayload()
  assert(text && record && record.resultText === text, 'manual copy text and record text must agree')
  page.copyResult()
  assert.strictEqual(env.effects.clipboard.at(-1), text, 'manual clipboard text must equal displayed result text')
  assert.deepStrictEqual(record.preferences, {
    wallWidthText: page.data.wallWidthText, wallHeightText: page.data.wallHeightText,
    topReserveText: page.data.topReserveText, bottomReserveText: page.data.bottomReserveText,
    frameWidthText: page.data.frameWidthText, viewingDistanceText: page.data.viewingDistanceText,
    aspectRatio: page.data.aspectRatioOptions[page.data.aspectRatioIndex].key,
    unitKey: page.data.unitOptions[page.data.unitIndex].key,
    pitch: page.data.pitchOptions[page.data.pitchIndex].value,
  }, 'manual record payload must reflect displayed page values')
  page.generateReportImage()
  assert(env.pending.draws.length === 1, 'manual report drawing should start')
  env.finishDraw(0)
  assert(env.pending.canvases.length === 1, 'manual report export should start')
  env.finishCanvas(0, 'wxfile://manual-led-report.png')
  env.flushNextTicks()
  assert.strictEqual(page.data.reportImagePath, 'wxfile://manual-led-report.png', 'manual report image should remain available')
  page.saveToActiveProject()
  assert.strictEqual(env.pending.modals.length, 1, 'manual save should keep its project-name prompt')
  page.beginStructuredOperation(inputsFor(CASE_FACTS['LED-001']))
  env.answerModal(0, true, 'stale manual output')
  assert.strictEqual((env.storage.get('audioTool.projects.v1') || []).length, 0,
    'manual project prompt from an earlier operation must not commit after structured operation begins')
  assert.strictEqual(page.data.reportImagePath, '', 'starting a structured operation must invalidate the manual report cache')
  page.endOperation()
  assert(page.data.result, 'manual result should be available again after ending the operation')
  assert.strictEqual(page.getResultText(), text, 'ending the structured operation should restore consistent manual output')
  assert.strictEqual(page.data.result.dimensionText, initialResult.dimensionText, 'manual layout should be restored')
  const restoredResult = page.data.result
  page.generateReportImage()
  assert(env.pending.draws.length === 1, 'manual report drawing should start')
  env.finishDraw(0)
  assert(env.pending.canvases.length === 1, 'manual report export should start')
  env.finishCanvas(0, 'wxfile://manual-led-report.png')
  env.flushNextTicks()
  assert.strictEqual(page.data.reportImagePath, 'wxfile://manual-led-report.png', 'manual report image should remain available')
  assert.strictEqual(page.data.result, restoredResult, 'manual result must not be rewritten by reporting')
  return { result: true, copyTextMatchesRecord: true, report: true }
}

function runLedCases() {
  const results = []
  for (const id of ['LED-001', 'LED-003', 'LED-005', 'LED-006']) {
    const spy = patchExport('utils/led-screen.js', 'calculateLedScreenPlan', (original, calls) => (input) => {
      calls.push(JSON.parse(JSON.stringify(input)))
      return original(input)
    })
    try {
    const { env, page, facts } = createPage(id)
    assert.strictEqual(typeof page.beginStructuredOperation, 'function', `${id}: LED page must expose structured entry`)
    const manualResult = page.data.result
    spy.calls.length = 0
    const inputs = inputsFor(facts)
    const snapshot = page.beginStructuredOperation(inputs)
    envFlush(page)
    assert(snapshot && snapshot.blockers.length > 0, `${id}: absent operation fields must block`)
    assert.strictEqual(spy.calls.length, 0, `${id}: deterministic core ran before the structured operation was complete`)
    for (const key of Object.keys(inputs)) {
      assert(snapshot.fields.find((field) => field.key === key)?.confirmed, `${id}: explicitly supplied ${key} lost confirmation`)
    }
    assertLedgerOutputBlocked(page, id)
    assert(manualResult, `${id}: manual pre-operation result should exist before operation start`)
    assert.strictEqual(page.data.result, null, `${id}: manual cached result must not become structured output`)
    page.generateReportImage(); page.copyResult(); page.toggleCurrentFavorite(); page.saveToActiveProject()
    assert.strictEqual(spy.calls.length, 0, `${id}: output actions bypassed a blocked structured operation`)
    assert.strictEqual(env.effects.clipboard.length, 0, `${id}: blocked operation copied output`)
    assert.strictEqual(env.pending.draws.length, 0, `${id}: blocked operation drew a report`)
    assert.strictEqual(env.pending.modals.length, 0, `${id}: blocked operation prompted project save`)

    const needed = missingValues(id)
    if (!snapshot.fields.find((field) => field.key === 'unitKey')?.confirmed && needed.unitKey) {
      const index = page.data.unitOptions.findIndex((unit) => unit.key === needed.unitKey)
      page.onUnitChange({ detail: { value: String(index) } })
      env.flushNextTicks()
    }
    for (const [key, value] of Object.entries(needed)) {
      const descriptor = page.getOperationSnapshot().fields.find((field) => field.key === key)
      assert(descriptor, `${id}: required field ${key} missing from operation snapshot`)
      if (!descriptor.confirmed) {
        assert.strictEqual(page.setOperationCandidate(key, value, descriptor.unit), true, `${id}: candidate rejected for ${key}`)
        assert.strictEqual(page.confirmOperationField({ currentTarget: { dataset: { field: key } } }), true, `${id}: confirm handler rejected ${key}`)
        env.answerModal(0, true)
        env.flushNextTicks()
      }
    }
    const ready = page.getOperationSnapshot()
    assert.strictEqual(ready.ready, true, `${id}: all structured operation fields should be confirmed`)
    page.flushInputCalculation()
    env.flushNextTicks()
    assert(page.data.result, `${id}: explicit confirmation did not produce a result`)
    assert.strictEqual(spy.calls.length, 1, `${id}: expected one core call after confirmation`)
    const values = Object.fromEntries(ready.fields.map((field) => [field.key, field.value]))
    const unit = LED_UNIT_SPECS[values.unitKey]
    assert.strictEqual(unit.widthMm, Number(values.unitWidthMm), `${id}: accepted width did not match selected catalog product`)
    assert.strictEqual(unit.heightMm, Number(values.unitHeightMm), `${id}: accepted height did not match selected catalog product`)
    const coreInput = spy.calls[0]
    for (const [key, value] of Object.entries({
      wallWidthMeters: values.wallWidthMeters, wallHeightMeters: values.wallHeightMeters,
      topReserveMeters: values.topReserveMeters, bottomReserveMeters: values.bottomReserveMeters,
      frameWidthMeters: Number(values.frameWidthCm) / 100, viewingDistanceMeters: values.viewingDistanceMeters,
      aspectRatioKey: values.aspectRatioKey, unitKey: values.unitKey, pixelPitch: values.pixelPitch,
    })) assert.strictEqual(coreInput[key], value, `${id}: core ${key} did not use the private operation snapshot`)
    const expected = calculateLedScreenPlan(coreInput)
    for (const key of ['unitKey', 'columns', 'rows', 'pixelPitch', 'dimensionText', 'resolutionText']) {
      assert.strictEqual(page.data.result[key], expected[key], `${id}: result diverged from existing deterministic core`)
    }
    const text = page.getResultText(page.getOutputState())
    assert(text && page.getRecordPayload().resultText === text, `${id}: structured output text and record differ`)

    const current = page.data.result
    const first = ready.fields.find((field) => field.confirmed)
    page.confirmOperationField({ currentTarget: { dataset: { field: first.key } } })
    env.answerModal(0, true)
    env.flushNextTicks()
    assert.strictEqual(page.data.result, current, `${id}: same-value re-confirmation invalidated a valid result`)

    const saveCandidate = page.getOperationSnapshot().fields.find((field) => field.key === 'wallWidthMeters')
    page.saveToActiveProject()
    assert.strictEqual(env.pending.modals.length, 1, `${id}: valid operation should request a project name`)
    page.setOperationCandidate(saveCandidate.key, Number(saveCandidate.value) + 0.25, saveCandidate.unit)
    env.answerModal(0, true, `${id} stale project`)
    assert.strictEqual((env.storage.get('audioTool.projects.v1') || []).length, 0, `${id}: stale project prompt created a project`)
    assertLedgerOutputBlocked(page, `${id} stale project prompt`)

    page.confirmOperationField({ currentTarget: { dataset: { field: saveCandidate.key } } })
    env.answerModal(0, true); env.flushNextTicks()
    page.flushInputCalculation(); env.flushNextTicks()
    assert(page.data.result, `${id}: reconfirmed value did not recalculate`)

    const width = page.getOperationSnapshot().fields.find((field) => field.key === 'wallWidthMeters')
    page.setOperationCandidate(width.key, Number(width.value) + 0.25, width.unit)
    assertLedgerOutputBlocked(page, `${id} changed value`)
    const blockedEffects = {
      clipboard: env.effects.clipboard.length, storage: env.effects.storage.length,
      modals: env.pending.modals.length, draws: env.pending.draws.length,
      exports: env.pending.canvases.length,
    }
    page.copyResult(); page.toggleCurrentFavorite(); page.saveToActiveProject(); page.generateReportImage()
    assert.deepStrictEqual({
      clipboard: env.effects.clipboard.length, storage: env.effects.storage.length,
      modals: env.pending.modals.length, draws: env.pending.draws.length,
      exports: env.pending.canvases.length,
    }, blockedEffects, `${id}: stale operation controls must not perform output actions`)
    page.flushInputCalculation()
    assert.strictEqual(spy.calls.length, 2, `${id}: changed but unconfirmed value reached the core`)

    // A pending report export and project confirmation must not commit after
    // the operation revision changes.
    page.confirmOperationField({ currentTarget: { dataset: { field: width.key } } })
    env.answerModal(0, true); env.flushNextTicks()
    page.flushInputCalculation(); env.flushNextTicks()
    assert(page.data.result, `${id}: final reconfirmed width did not calculate`)
    page.generateReportImage(); env.flushNextTicks()
    assert(env.pending.draws.length, `${id}: report drawing did not start after a valid result`)
    const staleResult = page.data.result
    env.finishDraw(0); env.flushNextTicks()
    assert(env.pending.canvases.length, `${id}: valid report draw did not request export`)
    const beforeProductChange = page.getOperationSnapshot().fields.find((field) => field.key === 'wallWidthMeters')
    page.setOperationCandidate(beforeProductChange.key, Number(beforeProductChange.value) + 0.25, beforeProductChange.unit)
    env.finishCanvas(0, 'wxfile://stale-led-report.png'); env.flushNextTicks()
    assert.strictEqual(page.data.reportImagePath, '', `${id}: stale canvas export wrote a report path`)
    assertLedgerOutputBlocked(page, `${id} stale report export`)
    page.confirmOperationField({ currentTarget: { dataset: { field: beforeProductChange.key } } })
    env.answerModal(0, true); env.flushNextTicks(); page.flushInputCalculation(); env.flushNextTicks()
    assert(page.data.result, `${id}: report test setup did not recover after reconfirmation`)
    page.generateReportImage(); env.flushNextTicks()
    assert(env.pending.draws.length, `${id}: second report drawing did not start`)
    const staleDrawResult = page.data.result
    const unitField = page.getOperationSnapshot().fields.find((field) => field.key === 'unitKey')
    const otherKey = unitField.value === 'module' ? 'cabinetStandard' : 'module'
    const otherIndex = page.data.unitOptions.findIndex((item) => item.key === otherKey)
    page.onUnitChange({ detail: { value: String(otherIndex) } }); env.flushNextTicks()
    const productSnapshot = page.getOperationSnapshot()
    for (const key of ['unitKey', 'unitWidthMm', 'unitHeightMm']) {
      assert(productSnapshot.blockers.includes(key), `${id}: product change must invalidate ${key} confirmation`)
    }
    env.finishDraw(0); env.flushNextTicks()
    assert.strictEqual(env.pending.canvases.length, 0, `${id}: stale report draw started export`)
    assertLedgerOutputBlocked(page, `${id} changed product`)
    assert.notStrictEqual(page.data.result, staleDrawResult, `${id}: product change kept stale result`)
    results.push({ id, status: 'passed', blockersBeforeConfirmation: snapshot.blockers.slice(), manualOnLoadRetained: true })
    } finally { spy.restore() }
  }
  return results
}

function envFlush(page) { page.flushInputCalculation?.() }

if (require.main === module) {
  const report = { manual: runManualCompatibility(), led: runLedCases() }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

module.exports = { createPage, runLedCases, runManualCompatibility }

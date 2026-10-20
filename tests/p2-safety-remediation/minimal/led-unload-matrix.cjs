'use strict'

const assert = require('node:assert/strict')
const gate = require('../../../utils/operation-inputs')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')
const { patchExport } = require('../../p2-safety/harness.cjs')
const { run: reproduceLateSuccess } = require('./led-unload-lifecycle.cjs')

const FACTS = Object.freeze({
  wallWidthMeters: 8, wallHeightMeters: 4, topReserveMeters: 0.2,
  bottomReserveMeters: 0.2, frameWidthCm: 5, viewingDistanceMeters: 5,
  aspectRatioKey: '16:9', unitKey: 'cabinetStandard',
  unitWidthMm: 640, unitHeightMm: 480, pixelPitch: 2,
})

function createPage(env = createDelayedEnvironment()) {
  env.wx.setStorageSync('audioTool.ledScreen.preferences', { unitKey: 'cabinetStandard' })
  const page = env.loadPage('pages/led-screen/led-screen.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  env.effects.storage.length = 0
  return { env, page }
}

function monitorUnloadedPublications(page) {
  const resultWrites = []
  let unloaded = false
  const original = page.setData
  page.setData = (patch, callback) => {
    if (unloaded && patch && Object.prototype.hasOwnProperty.call(patch, 'result') && patch.result) resultWrites.push(patch.result)
    return original(patch, callback)
  }
  return { resultWrites, markUnloaded() { unloaded = true } }
}

function queueConfirmation(page, key = 'pixelPitch', value = 1.86) {
  page.setOperationCandidate(key, value, key === 'pixelPitch' ? 'pitch' : 'm')
  assert.strictEqual(page.confirmOperationField({ currentTarget: { dataset: { field: key } } }), true)
  return page.getOperationSnapshot()
}

function run() {
  const outcomes = {}
  const spy = patchExport('utils/led-screen.js', 'calculateLedScreenPlan', (original, calls) => (input) => {
    calls.push(JSON.parse(JSON.stringify(input)))
    return original(input)
  })
  try {
    outcomes.pendingSuccess = reproduceLateSuccess()

    // B: cancellation delivered after unload leaves terminal state intact and
    // does not throw or publish a result.
    {
      for (const response of [{ confirm: false, cancel: true }, null]) {
        const { env, page } = createPage()
        page.beginStructuredOperation(FACTS)
        spy.calls.length = 0
        queueConfirmation(page)
        const rejectedResponse = env.pending.modals[0].success
        const monitor = monitorUnloadedPublications(page)
        page.onUnload(); monitor.markUnloaded()
        assert.doesNotThrow(() => rejectedResponse(response))
        env.flushNextTicks()
        page.flushInputCalculation(); env.flushNextTicks()
        assert.strictEqual(page.getOperationSnapshot().ready, false)
        assert.strictEqual(spy.calls.length, 0)
        assert.strictEqual(monitor.resultWrites.length, 0)
      }
      outcomes.cancelOrEmptyFailureAfterUnload = 'passed'
    }

    // C: disposal is idempotent and the original report cleanup still runs.
    {
      const { env, page } = createPage()
      page.generateReportImage()
      env.flushNextTicks()
      assert.strictEqual(env.effects.loading.filter((entry) => entry.type === 'show').length, 1)
      page.onUnload()
      const disposedReportRevision = page.reportRevision
      page.onUnload()
      assert.strictEqual(env.effects.loading.filter((entry) => entry.type === 'hide').length, 1,
        'repeated unload must not repeat report cleanup')
      assert.strictEqual(page.reportRevision, disposedReportRevision,
        'repeated unload must not invalidate report work more than once')
      assert.strictEqual(gate.prepareOperation(page).disposed, true)
      assert.strictEqual(page.data.isGeneratingReport, true,
        'unload must not write page data merely to make a visible flag look false')
      const priorDisposedPage = createPage()
      priorDisposedPage.page.generateReportImage()
      priorDisposedPage.env.flushNextTicks()
      assert.strictEqual(priorDisposedPage.env.effects.loading.filter((entry) => entry.type === 'show').length, 1)
      assert.strictEqual(gate.disposeOperation(priorDisposedPage.page), true)
      priorDisposedPage.page.onUnload()
      const firstCleanupRevision = priorDisposedPage.page.reportRevision
      priorDisposedPage.page.onUnload()
      assert.strictEqual(priorDisposedPage.env.effects.loading.filter((entry) => entry.type === 'hide').length, 1,
        'first real unload must clean manual report loading even if the gate was already disposed')
      assert.strictEqual(priorDisposedPage.page.reportRevision, firstCleanupRevision,
        'subsequent unload must not repeat cleanup after prior gate disposal')
      outcomes.repeatedUnload = 'passed'
    }

    // D: live confirmation, including confirmation of the same value, works.
    {
      const { env, page } = createPage()
      page.beginStructuredOperation(FACTS)
      spy.calls.length = 0
      queueConfirmation(page)
      env.answerModal(0, true)
      env.flushNextTicks()
      assert.strictEqual(page.getOperationSnapshot().ready, true)
      assert.strictEqual(spy.calls.length, 1)
      assert(page.data.result)
      const result = page.data.result
      page.confirmOperationField({ currentTarget: { dataset: { field: 'pixelPitch' } } })
      env.answerModal(0, true)
      env.flushNextTicks()
      assert.strictEqual(page.getOperationSnapshot().ready, true)
      assert.strictEqual(page.data.result, result)
      outcomes.liveAndSameValueConfirmation = 'passed'
    }

    // E: a callback belonging to an old page cannot mutate a newly opened page.
    {
      const env = createDelayedEnvironment()
      const old = createPage(env)
      old.page.beginStructuredOperation(FACTS)
      spy.calls.length = 0
      queueConfirmation(old.page)
      const stale = env.pending.modals[0].success
      old.page.onUnload()
      const fresh = createPage(env)
      spy.calls.length = 0
      const freshManualResult = fresh.page.data.result
      stale({ confirm: true, cancel: false })
      env.flushNextTicks()
      assert.strictEqual(fresh.page.data.result, freshManualResult)
      assert.strictEqual(fresh.page.getOperationSnapshot(), null)
      fresh.page.beginStructuredOperation(FACTS)
      env.flushNextTicks()
      assert.strictEqual(fresh.page.getOperationSnapshot().ready, true)
      assert(fresh.page.data.result)
      assert.strictEqual(spy.calls.length, 1, 'only the new live page should calculate')
      outcomes.oldPageCannotAffectNewPage = 'passed'
    }

    // F: a structured report export already in flight is rejected after unload.
    {
      const { env, page } = createPage()
      page.beginStructuredOperation(FACTS)
      env.flushNextTicks()
      assert(page.data.result)
      page.generateReportImage()
      env.flushNextTicks()
      assert.strictEqual(env.pending.draws.length, 1)
      env.finishDraw(0)
      assert.strictEqual(env.pending.canvases.length, 1)
      const monitor = monitorUnloadedPublications(page)
      page.onUnload(); monitor.markUnloaded()
      env.finishCanvas(0, 'wxfile://late-structured-report.png')
      env.flushNextTicks()
      assert.strictEqual(page.data.reportImagePath, '')
      assert.strictEqual(monitor.resultWrites.length, 0)
      assert.strictEqual(env.effects.navigation.length, 0)
      assert.strictEqual(env.effects.clipboard.length, 0)
      outcomes.structuredAsyncWorkAfterUnload = 'passed'
    }

    // F2: the real synchronous core is already running, then unload occurs
    // before it returns. Its completed value must fail the ownership check.
    {
      let page
      let unloadDuringCore = false
      let markUnloaded
      const inFlight = patchExport('utils/led-screen.js', 'calculateLedScreenPlan', (original, calls) => (input) => {
        calls.push(JSON.parse(JSON.stringify(input)))
        if (unloadDuringCore) {
          unloadDuringCore = false
          page.onUnload()
          markUnloaded()
        }
        return original(input)
      })
      try {
        const { env, page: currentPage } = createPage()
        page = currentPage
        const monitor = monitorUnloadedPublications(page)
        markUnloaded = monitor.markUnloaded
        const realUnload = page.onUnload
        page.onUnload = function wrappedRealUnload() { return realUnload.call(this) }
        page.beginStructuredOperation(FACTS)
        inFlight.calls.length = 0
        unloadDuringCore = true
        env.flushNextTicks()
        assert.strictEqual(inFlight.calls.length, 1, 'calculation should have entered the actual deterministic core')
        assert.strictEqual(page.data.result, null, 'completed core value must not be committed after in-core unload')
        assert.strictEqual(monitor.resultWrites.length, 0, 'in-flight core result must not publish after unload')
        assert.strictEqual(page.hasCurrentOperationResult(), false)
        assert.strictEqual(env.effects.storage.length, 0)
        outcomes.structuredCoreCompletesAfterUnload = 'passed'
      } finally {
        inFlight.restore()
      }
    }

    // G: ordinary manual initialization, copy, record payload, and report
    // resource cleanup keep their established behavior across unload.
    {
      const { env, page } = createPage()
      assert(page.data.result, 'manual onLoad retains its initial result')
      const text = page.getResultText()
      const record = page.getRecordPayload()
      assert(text && record && record.resultText === text)
      page.copyResult()
      assert.strictEqual(env.effects.clipboard.at(-1), text)
      const manualResult = page.data.result
      page.generateReportImage()
      env.flushNextTicks()
      assert.strictEqual(env.effects.loading.filter((entry) => entry.type === 'show').length, 1)
      page.onUnload()
      assert.strictEqual(env.effects.loading.filter((entry) => entry.type === 'hide').length, 1)
      env.finishDraw(0)
      assert.strictEqual(env.pending.canvases.length, 0,
        'pending manual report draw must settle without starting export after unload')
      assert.strictEqual(page.data.result, manualResult, 'unload cleanup must retain the manual result')
      assert.strictEqual(page.data.reportImagePath, '')
      outcomes.manualInitializationCopyRecordAndUnload = 'passed'
    }

    // H: a late output guard and lazy operation helpers remain terminal.
    {
      const { env, page } = createPage()
      page.beginStructuredOperation(FACTS)
      env.flushNextTicks()
      const result = page.data.result
      const guard = gate.captureOperationResult(page, result)
      assert(guard)
      page.onUnload()
      assert.strictEqual(gate.isOperationResultCurrent(page, guard), false)
      assert.strictEqual(gate.prepareOperation(page).disposed, true)
      page.endStructuredOperation()
      page.beginStructuredOperation(FACTS)
      assert.strictEqual(gate.prepareOperation(page).disposed, true)
      outcomes.sharedGateTerminalLifecycle = 'passed'
    }
    process.stdout.write(`${JSON.stringify({ status: 'passed', outcomes }, null, 2)}\n`)
    return outcomes
  } finally {
    spy.restore()
  }
}

if (require.main === module) run()
module.exports = { run }

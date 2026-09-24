'use strict'

// Regression for a captured WeChat modal success delivered after the real LED
// page has unloaded.  This deliberately exercises the page module and its
// shared operation gate rather than constructing a gate-only test double.
const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')
const { patchExport } = require('../../p2-safety/harness.cjs')

function run() {
  const spy = patchExport('utils/led-screen.js', 'calculateLedScreenPlan', (original, calls) => (input) => {
    calls.push(JSON.parse(JSON.stringify(input)))
    return original(input)
  })
  const env = createDelayedEnvironment()
  try {
    env.wx.setStorageSync('audioTool.ledScreen.preferences', { unitKey: 'cabinetStandard' })
    env.effects.storage.length = 0
    const page = env.loadPage('pages/led-screen/led-screen.js')
    page.onLoad()
    env.flushNextTicks()

    const facts = {
      wallWidthMeters: 8, wallHeightMeters: 4, topReserveMeters: 0.2,
      bottomReserveMeters: 0.2, frameWidthCm: 5, viewingDistanceMeters: 5,
      aspectRatioKey: '16:9', unitKey: 'cabinetStandard',
      unitWidthMm: 640, unitHeightMm: 480, pixelPitch: 2,
    }
    const started = page.beginStructuredOperation(facts)
    assert.strictEqual(started.ready, true, 'test setup: complete LED operation should start ready')
    // A ready operation is allowed to calculate at start. Reset the spy so
    // the measured interval begins after we deliberately unconfirm one field.
    spy.calls.length = 0
    page.setOperationCandidate('pixelPitch', 1.86, 'pitch')
    assert.strictEqual(page.confirmOperationField({ currentTarget: { dataset: { field: 'pixelPitch' } } }), true,
      'test setup: real LED confirmation handler should queue the WeChat modal')
    assert.strictEqual(env.pending.modals.length, 1, 'test setup: expected one pending platform confirmation')
    const capturedSuccess = env.pending.modals[0].success
    assert.strictEqual(page.getOperationSnapshot().ready, false, 'pending changed value must remain unconfirmed')
    assert.strictEqual(spy.calls.length, 0, 'no calculation should start before modal response')

    const latePublications = []
    const realSetData = page.setData
    let unloaded = false
    page.setData = (patch, callback) => {
      if (unloaded && patch && Object.prototype.hasOwnProperty.call(patch, 'result') && patch.result) {
        latePublications.push(patch.result)
      }
      return realSetData(patch, callback)
    }

    page.onUnload()
    unloaded = true
    // The callback was captured before unload; removing it from the delayed
    // platform queue must not be necessary for this lifecycle guarantee.
    capturedSuccess({ confirm: true, cancel: false })
    env.flushNextTicks()
    page.flushInputCalculation()
    env.flushNextTicks()

    const observations = {
      callbackDeliveredAfterUnload: true,
      readyAfterUnload: page.getOperationSnapshot()?.ready ?? false,
      calculationCallsAfterUnload: spy.calls.length,
      calculationInputsAfterUnload: spy.calls,
      resultAfterUnload: Boolean(page.data.result),
      structuredResultPublicationsAfterUnload: latePublications.length,
      outputSideEffectsAfterUnload: {
        clipboard: env.effects.clipboard.length,
        navigation: env.effects.navigation.length,
        reportDraws: env.pending.draws.length,
        reportExports: env.pending.canvases.length,
        storageWrites: env.effects.storage.length,
      },
    }
    process.stdout.write(`${JSON.stringify(observations, null, 2)}\n`)

    assert.strictEqual(observations.readyAfterUnload, false,
      'late success must not make the disposed LED operation ready')
    assert.strictEqual(observations.calculationCallsAfterUnload, 0,
      'late success must not start the deterministic LED calculation after unload')
    assert.strictEqual(observations.structuredResultPublicationsAfterUnload, 0,
      'late success must not publish a structured result after unload')
    assert.strictEqual(observations.resultAfterUnload, false,
      'late success must not leave a result on the unloaded page')
    assert.deepStrictEqual(observations.outputSideEffectsAfterUnload,
      { clipboard: 0, navigation: 0, reportDraws: 0, reportExports: 0, storageWrites: 0 },
      'late success must not trigger output side effects')
    return observations
  } finally {
    spy.restore()
  }
}

if (require.main === module) run()
module.exports = { run }

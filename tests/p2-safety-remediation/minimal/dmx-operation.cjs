'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { buildDmxChannelGuide, getDmxChannelModes } = require('../../../pages/dmx-address/utils/dmx-channel-guide')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')
const { patchExport } = require('../../p2-safety/harness.cjs')

const MODEL = 'TL-SL333'

function createPage(options = { model: MODEL }) {
  const env = createDelayedEnvironment()
  const page = env.loadPage('pages/dmx-address/channel-guide.js')
  page.onLoad(options)
  env.flushNextTicks()
  return { env, page }
}

function run() {
  const wxml = fs.readFileSync(require('node:path').join(__dirname, '../../../pages/dmx-address/channel-guide.wxml'), 'utf8')
  assert.match(wxml, /item\.hasValue/, 'WXML must use the portable page-projected presence flag')
  assert.match(wxml, /bindtap="endOperation"/, 'structured UI must expose an end-operation action')
  const spy = patchExport('pages/dmx-address/utils/dmx-channel-guide.js', 'buildDmxChannelGuide', (original, calls) => (input) => {
    calls.push({ ...input })
    return original(input)
  })
  try {
    assert.deepEqual(getDmxChannelModes(MODEL).map((mode) => mode.channelCount), [6, 3],
      'TL-SL333 builder profile has the documented [6, 3] order')
    assert.equal(buildDmxChannelGuide({ model: MODEL })?.channelCount, 6,
      'the deterministic builder retains its existing first-mode default')

    const legacy = createPage()
    assert.equal(legacy.page.data.guide?.channelCount, 6,
      'manual URL onLoad without a mode retains the established first-mode default')
    const explicitManual = createPage({ model: MODEL, channelCount: 3 })
    assert.equal(explicitManual.page.data.guide?.channelCount, 3,
      'manual URL onLoad with an explicit mode remains available')
    explicitManual.page.switchMode({ currentTarget: { dataset: { channelCount: 6 } } })
    assert.equal(explicitManual.page.data.guide?.channelCount, 6,
      'manual switchMode remains immediate')
    assert.equal(createPage({ model: MODEL, channelCount: 'bogus' }).page.data.guide?.channelCount, 6,
      'manual URL onLoad with a missing or invalid count keeps the legacy default')

    const structured = createPage()
    const blocked = structured.page.beginStructuredOperation({ model: MODEL })
    structured.env.flushNextTicks()
    const structuredCalls = spy.calls.length
    assert.equal(blocked.ready, false, 'model-only DMX operation must block without a mode')
    assert(blocked.blockers.includes('channelCount'))
    assert.equal(structured.page.data.guide, null, 'blocked DMX operation must not expose the builder default')
    assert.deepEqual(structured.page.data.operationModes.map((mode) => mode.channelCount), [6, 3],
      'blocked real page must show selectable 6 and 3 CH modes')
    assert.equal(spy.calls.length, structuredCalls, 'blocked model-only operation must not call the builder')
    const modelRow = structured.page.data.operationSnapshot.fields.find((field) => field.key === 'model')
    const missingModeRow = structured.page.data.operationSnapshot.fields.find((field) => field.key === 'channelCount')
    assert.equal(modelRow.hasValue, true)
    assert.equal(modelRow.displayValue, MODEL)
    assert.equal(modelRow.unit, '', 'model confirmation card must not append an internal unit label')
    assert.equal(missingModeRow.hasValue, false)
    assert.equal(missingModeRow.displayValue, '待输入')
    assert.equal(missingModeRow.value, undefined, 'display projection must not backfill private operation facts')

    function chooseMode(env, page, channelCount) {
      globalThis.wx = env.wx
      const builderCalls = spy.calls.length
      const before = env.pending.modals.length
      assert.equal(page.switchMode({ currentTarget: { dataset: { channelCount } } }), true,
        `${channelCount} CH choice should be accepted from real page handler`)
      assert.equal(page.data.guide, null, 'a mode candidate must remain blocked before modal confirmation')
      assert.equal(page.data.operationSnapshot.fields.find((field) => field.key === 'channelCount').displayValue, `${channelCount}（待确认）`)
      assert.equal(spy.calls.length, builderCalls, 'unconfirmed mode candidate must not call the builder')
      assert.equal(env.pending.modals.length, before + 1)
      const modal = env.pending.modals[before]
      assert.equal(modal.content, `通道模式：${channelCount} CH`, 'confirmation modal must identify the exact mode')
      env.answerModal(before, true)
      env.flushNextTicks()
      assert.equal(spy.calls.length, builderCalls + 1, 'confirmed mode should produce exactly one builder call')
    }
    chooseMode(structured.env, structured.page, 6)
    assert.equal(structured.page.data.guide?.channelCount, 6, 'same first-mode choice must require and accept confirmation')
    assert.deepEqual(structured.page.data.guide, buildDmxChannelGuide({ model: MODEL, channelCount: 6 }))
    const cancel = createPage()
    cancel.page.beginStructuredOperation({ model: MODEL })
    cancel.env.flushNextTicks()
    assert.equal(cancel.page.switchMode({ currentTarget: { dataset: { channelCount: 6 } } }), true)
    cancel.env.answerModal(0, false)
    cancel.env.flushNextTicks()
    assert.equal(cancel.page.getOperationSnapshot().ready, false, 'cancelled explicit mode stays blocked')
    assert.equal(cancel.page.data.guide, null, 'cancelled mode cannot restore the model-only default')
    chooseMode(structured.env, structured.page, 3)
    assert.equal(structured.page.data.guide?.channelCount, 3, '6 to 3 mode change must require confirmation')
    assert.deepEqual(structured.page.data.guide, buildDmxChannelGuide({ model: MODEL, channelCount: 3 }))

    const missingModel = createPage()
    const modelBlocked = missingModel.page.beginStructuredOperation({})
    missingModel.env.flushNextTicks()
    assert(!modelBlocked.ready && modelBlocked.blockers.includes('model'))
    assert.equal(missingModel.page.data.guide, null, 'structured mode must not borrow the page URL model')

    const invalid = createPage()
    const invalidSnapshot = invalid.page.beginStructuredOperation({ model: MODEL, channelCount: 5 })
    invalid.env.flushNextTicks()
    assert(!invalidSnapshot.ready, 'unsupported mode must not reach the builder default')
    assert.equal(invalid.page.data.guide, null)
    assert.equal(invalid.page.getOperationSnapshot().status, 'invalid')
    assert.ok(invalid.page.getOperationSnapshot().error, 'unsupported channel mode must expose an invalid-operation error')
    assert.equal(invalid.env.pending.modals.length, 0, 'unsupported channel mode must not open a confirmation modal')
    const invalidKind = createPage()
    const rejectedKind = invalidKind.page.beginStructuredOperation({ model: MODEL, channelCount: 6 }, 'other-kind')
    invalidKind.env.flushNextTicks()
    assert.equal(rejectedKind.status, 'invalid', 'unrecognized static operation kind must be rejected')
    assert.ok(rejectedKind.error, 'unrecognized operation kind must expose an error')
    assert.equal(invalidKind.env.pending.modals.length, 0, 'invalid operation kind must not open confirmation')
    class FactsWrapper { constructor() { this.model = MODEL } }
    const nonPlain = createPage()
    const rejectedFacts = nonPlain.page.beginStructuredOperation(new FactsWrapper())
    nonPlain.env.flushNextTicks()
    assert.equal(rejectedFacts.status, 'invalid', 'non-plain facts must not be normalized into accepted records')
    assert.ok(rejectedFacts.error, 'non-plain facts must expose an input error')
    assert.equal(nonPlain.env.pending.modals.length, 0, 'invalid fact shape must not open confirmation')

    const stale = createPage()
    stale.page.beginStructuredOperation({ model: MODEL, channelCount: 6 })
    assert.equal(stale.env.pending.modals.length, 1)
    const oldSuccess = stale.env.pending.modals[0].success
    stale.page.beginStructuredOperation({ model: 'TL-SL105', channelCount: 13 })
    stale.env.flushNextTicks()
    oldSuccess({ confirm: true })
    assert.equal(stale.page.data.guide, null, 'old operation callback must not publish a guide')
    assert.equal(stale.page.getOperationSnapshot().fields.find((field) => field.key === 'model').value, 'TL-SL105')
    assert.equal(stale.page.getOperationSnapshot().fields.find((field) => field.key === 'channelCount').confirmed, false,
      'old callback must not confirm replacement operation mode')
    stale.env.answerModal(1, true)
    stale.env.flushNextTicks()
    assert.equal(stale.page.data.guide?.channelCount, 13)
    assert.deepEqual(stale.page.data.guide, buildDmxChannelGuide({ model: 'TL-SL105', channelCount: 13 }))

    const ended = createPage({ model: MODEL, channelCount: 3 })
    ended.page.beginStructuredOperation({ model: MODEL, channelCount: 6 })
    ended.env.answerModal(0, true)
    ended.env.flushNextTicks()
    ended.page.endOperation()
    ended.env.flushNextTicks()
    assert.equal(ended.page.getOperationSnapshot(), null)
    assert.equal(ended.page.data.guide?.channelCount, 3, 'end operation restores the URL-selected manual mode')
    ended.page.switchMode({ currentTarget: { dataset: { channelCount: 6 } } })
    assert.equal(ended.page.data.guide?.channelCount, 6, 'manual mode switching resumes after explicit end')

    const unloaded = createPage()
    unloaded.page.beginStructuredOperation({ model: MODEL, channelCount: 6 })
    assert.equal(unloaded.env.pending.modals.length, 1)
    const late = unloaded.env.pending.modals[0].success
    const callsBeforeUnload = spy.calls.length
    let afterUnload = false
    let publicationsAfterUnload = 0
    const setData = unloaded.page.setData
    unloaded.page.setData = (patch, callback) => {
      if (afterUnload && patch?.guide) publicationsAfterUnload += 1
      setData(patch, callback)
    }
    unloaded.page.onUnload()
    afterUnload = true
    late({ confirm: true })
    unloaded.env.flushNextTicks()
    assert.equal(unloaded.page.data.guide, null)
    assert.equal(spy.calls.length, callsBeforeUnload, 'late callback must not call the builder after unload')
    assert.equal(publicationsAfterUnload, 0, 'late callback must not publish a guide after unload')
    unloaded.page.switchMode({ currentTarget: { dataset: { channelCount: 3 } } })
    assert.equal(unloaded.page.data.guide, null, 'manual mode switch on disposed page must not republish a guide')
    const readyUnload = createPage()
    readyUnload.page.beginStructuredOperation({ model: MODEL, channelCount: 6 })
    readyUnload.env.answerModal(0, true)
    readyUnload.env.flushNextTicks()
    assert.equal(readyUnload.page.data.guide?.channelCount, 6)
    readyUnload.page.onUnload()
    assert.equal(readyUnload.page.data.guide, null, 'unload clears a previously published structured guide')
    const manualUnload = createPage()
    manualUnload.page.onUnload()
    assert.equal(manualUnload.page.switchMode({ currentTarget: { dataset: { channelCount: 3 } } }), false)
    assert.equal(manualUnload.page.data.guide, null, 'manual switch on unloaded page is terminal')
    return { manualCompatibility: 'passed', missingMode: 'passed', modes3and6: 'passed', sameValue: 'passed',
      modeChange: 'passed', invalidMode: 'passed', staleOperation: 'passed', unload: 'passed',
      kindValidation: 'passed', endOperation: 'passed', displayProjection: 'passed', unloadTerminal: 'passed',
      nonPlainFacts: 'passed', cancelledMode: 'passed' }
  } finally { spy.restore() }
}

if (require.main === module) console.log(JSON.stringify(run(), null, 2))
module.exports = { run, createPage, MODEL }

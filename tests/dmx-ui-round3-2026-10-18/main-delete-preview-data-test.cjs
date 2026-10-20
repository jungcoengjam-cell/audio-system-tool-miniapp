const assert = require('node:assert/strict')
const { createRuntime, clone, stageLightingProductIndex } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

function seedStandard(runtime) {
  const groups = [
    ['TL-SL323', 12, 2],
    ['TL-SK3101', 7, 2],
    ['TL-SL113', 8, 25],
  ].map(([model, quantity, mode]) => {
    const fixture = stageLightingProductIndex.get(model)
    const channelCount = fixture?.channelModes.includes(mode) ? mode : fixture?.channelModes[0]
    return {
      name: fixture?.name || model,
      fixtureSource: 'library',
      fixtureModel: model,
      channelCount: String(channelCount),
      libraryChannelCount: String(channelCount),
      fixtureCount: String(quantity),
      targetUniverse: 'A',
    }
  })
  runtime.seed(groups)
}

function main() {
  {
    const runtime = createRuntime()
    seedStandard(runtime)
    try {
      const page = runtime.make('main')
      const layout = runtime.make()
      runtime.place(layout, 0)
      page.onShow()
      const fixtures = page._calculationResult.fixtures
      runtime.checkMain(page, fixtures[0])
      runtime.checkMain(page, fixtures[12])
      const writes = runtime.stats.writes
      page.requestDeleteGroup(runtime.event({ index: 0 }))
      const pending = page.data.pendingChange
      assert.equal(pending.deleteSummary.fixtureCount, 12)
      assert.equal(pending.deleteSummary.checkedCount, 1)
      assert.equal(pending.deleteSummary.placedCount, 1)
      assert.equal(pending.deletePreview.fixtureCountValue, 12)
      assert.equal(pending.remainingAffectedGroups.length, 2)
      assert.equal(pending.invalidatedCheckCount, 1)
      assert.equal(pending.remainingAffectedGroups[0].invalidatedCheckCount, 1)
      assert.equal(page.data.removedDetailsExpanded, false)
      page.toggleRemovedDetails()
      assert.equal(page.data.removedDetailsExpanded, true)
      assert.equal(runtime.stats.writes, writes, 'Opening removal details should not write the scheme')
      page.toggleRemovedDetails()
      page.cancelPendingChange()
      assert.equal(runtime.stats.writes, writes, 'Cancelling the visual preview should not write the scheme')
      assert.equal(page.data.removedDetailsExpanded, false)
    } finally { runtime.dispose() }
  }

  {
    const runtime = createRuntime()
    seedStandard(runtime)
    try {
      const page = runtime.make('main')
      const beforeWrites = runtime.stats.writes
      const beforeRevision = runtime.workspace.readLightingWorkspace().revision
      page.requestDeleteGroup(runtime.event({ index: 2 }))
      const pending = page.data.pendingChange
      assert.equal(pending.valid, true)
      assert.equal(pending.remainingAffectedGroups.length, 0, 'Earlier groups keep their ranges when the final group is removed')
      assert.equal(pending.remainingGroupCount, 2, 'The preview should count unchanged groups too')
      page.cancelPendingChange()
      assert.equal(runtime.stats.writes, beforeWrites, 'Cancelling a final-group preview remains write-free')

      page.requestDeleteGroup(runtime.event({ index: 2 }))
      assert.equal(page.data.pendingChange.remainingGroupCount, 2)
      page.confirmPendingChange()
      assert.equal(runtime.workspace.readLightingWorkspace().revision, beforeRevision + 1, 'Confirming still performs one logical scheme commit')
      assert.equal(page.data.groups.length, 2)
    } finally { runtime.dispose() }
  }

  {
    const runtime = createRuntime()
    runtime.seed([{
      name: '历史自定义灯组',
      fixtureSource: 'custom',
      customName: '历史自定义灯组',
      customChannelCount: '16',
      channelCount: '16',
      fixtureCount: '2',
      targetUniverse: 'A',
    }])
    try {
      const page = runtime.make('main')
      page.requestDeleteGroup(runtime.event({ index: 0 }))
      const pending = page.data.pendingChange
      assert.equal(pending.valid, true)
      assert.equal(pending.deletePreview.primaryName, '历史自定义灯组')
      assert.equal(pending.deletePreview.modelName, '', 'A legacy custom group must not invent a catalog model')
      assert.equal(pending.deletePreview.fixtureCountValue, 2)
      assert.equal(pending.remainingAffectedGroups.length, 0)
      assert.equal(pending.remainingGroupCount, 0, 'Deleting the only group leaves no groups')
      assert.equal(pending.afterNext, 'A001')
      const preview = clone(pending)
      page.cancelPendingChange()
      assert.equal(page.data.pendingChange, null)
      assert.deepEqual(preview.deletePreview, pending.deletePreview)
    } finally { runtime.dispose() }
  }

  process.stdout.write('PASS checked and placed delete risks stay visible; details toggle is UI-only\n')
  process.stdout.write('PASS deleting the final group shows unchanged remaining groups; delete commit count is preserved\n')
  process.stdout.write('PASS single legacy custom group uses a name/range fallback and has no affected-group rows\n')
}

try { main() } catch (error) { process.stderr.write((error.stack || String(error)) + '\n'); process.exitCode = 1 }

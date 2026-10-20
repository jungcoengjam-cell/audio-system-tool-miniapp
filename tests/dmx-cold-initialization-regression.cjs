'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { createDelayedEnvironment, clone } = require('./p2-safety-remediation/minimal/delayed-environment.cjs')

const repoRoot = path.resolve(__dirname, '..')
const pagePath = 'pages/dmx-address/dmx-address.js'
const workspaceKey = 'audioTool.dmxLightingWorkspace.v2'
const migrationJournalKey = 'audioTool.storageMigrationJournal.v1'

function createEnvironment() {
  const env = createDelayedEnvironment()
  env.wx.getSystemInfoSync = () => ({
    windowWidth: 430,
    windowHeight: 932,
    pixelRatio: 3,
    safeArea: { left: 0, right: 430, top: 0, bottom: 932 },
  })
  env.wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } })

  const events = []
  const previousConsoleInfo = console.info
  console.info = () => {}
  const performance = require(path.join(repoRoot, 'utils/performance.js'))
  const originalStartMeasurement = performance.startMeasurement
  performance.startMeasurement = (name, details) => {
    const finish = originalStartMeasurement(name, details)
    if (name !== 'DMX/setData结果更新') return finish
    return (extraDetails) => {
      events.push('finishMeasurement')
      return finish(extraDetails)
    }
  }

  return { env, events, restoreConsole: () => { console.info = previousConsoleInfo } }
}

function makePreferences(startAddressText = '1', fixtureCount = '4') {
  const { createGroup, buildPreferences } = require(path.join(repoRoot, 'pages/dmx-address/group-input.js'))
  const group = createGroup(1, {
    fixtureSource: 'library',
    fixtureModel: 'TL-SE3401',
    libraryChannelCount: 16,
    channelCount: '16',
    fixtureCount,
    targetUniverse: 'A',
  })
  return buildPreferences({
    groups: [group],
    startAddressText,
    allocationMode: 'auto',
  })
}

function seedWorkspace(preferences) {
  const workspace = require(path.join(repoRoot, 'pages/dmx-layout/lighting-workspace.js'))
  const loaded = workspace.readLightingWorkspace()
  assert.equal(loaded.ok, true, `seed workspace read failed: ${loaded.error}`)
  const scheme = workspace.createLightingScheme(preferences)
  const saved = workspace.saveLightingScheme(loaded.contextId, scheme, loaded.revision)
  assert.equal(saved.ok, true, `seed workspace save failed: ${saved.error}`)
  return { workspace, contextId: loaded.contextId, saved }
}

function seedFavorite(preferences) {
  const records = require(path.join(repoRoot, 'utils/records.js'))
  const favorite = records.saveFavoriteSnapshot({
    module: 'dmxAddress',
    title: 'Synthetic favorite',
    summary: 'DMX cold-init regression fixture',
    preferences,
    resultText: 'Synthetic favorite snapshot',
  })
  assert(favorite, 'could not seed same-signature favorite through records API')
  return records
}

function loadTrackedPage(env, events) {
  const page = env.loadPage(pagePath)
  const patches = []
  const originalSetData = page.setData
  page.setData = function trackedSetData(patch, callback) {
    patches.push(clone(patch))
    events.push('setData')
    return originalSetData.call(this, patch, callback)
  }
  const originalSyncFavorite = page.syncFavorite
  page.syncFavorite = function trackedSyncFavorite(...args) {
    events.push('syncFavorite')
    return originalSyncFavorite.apply(this, args)
  }
  return { page, patches }
}

function assertColdPatch(page, patches, options = {}) {
  assert.equal(patches.length, 1, `${options.name || 'cold onLoad'} submitted ${patches.length} setData patches`)
  const patch = patches[0]
  assert.equal(page.data.windowWidth, 430, 'viewport width was not applied in the cold patch')
  assert.equal(page.data.windowHeight, 932, 'viewport height was not applied in the cold patch')
  assert.equal(page.data.swipeDragIndex, -1)
  assert.equal(page.data.swipeDragOffset, 0)
  assert.equal(page.data.swipeDragging, false)
  assert.equal(page.data.floatingSwipeOffset, 0)
  assert.equal(page.data.floatingSwipeDragging, false)
  assert.equal(page.data.swipedGroupIndex, -1)
  assert.equal(page.data.pendingChange, null)
  assert.equal(page.data.removedDetailsExpanded, false)
  assert.equal(page.data.fixtureAddPreview, null)
  assert.equal(page.data.floatingGroup, null)
  assert.equal(page.data.floatingVisible, false)
  assert.equal(page.data.floatingStyle, '')
  assert.equal(page.data.editorDirty, false)
  assert.equal(page.data.currentFavorite, Boolean(options.favorite))
  for (const key of [
    'windowWidth', 'windowHeight', 'swipeDragIndex', 'swipeDragOffset', 'swipeDragging',
    'floatingSwipeOffset', 'floatingSwipeDragging', 'swipedGroupIndex', 'pendingChange',
    'removedDetailsExpanded', 'fixtureAddPreview', 'floatingGroup', 'floatingVisible',
    'floatingStyle', 'editorDirty', 'currentFavorite', 'groups', 'result',
  ]) assert(Object.prototype.hasOwnProperty.call(patch, key), `cold patch omits ${key}`)
}

async function runCase(name) {
  const { env, events, restoreConsole } = createEnvironment()
  try {
    if (name === 'missing-workspace') {
      const { page, patches } = loadTrackedPage(env, events)
      assert.equal(Object.prototype.hasOwnProperty.call(page.data, 'editorDirty'), false,
        'fresh Page unexpectedly has an editor session flag')
      page.onLoad()
      assertColdPatch(page, patches, { name })
      assert.equal(page.data.contextError, '')
      assert.equal(page.data.groups.length, 0, 'empty storage did not preserve its empty workspace')
      assert.equal(page.data.result.valid, true, 'empty storage did not produce its valid empty result')
      assert.equal(page.data.result.totalGroups, 0, 'empty result unexpectedly contains groups')
      assert.equal(env.pending.nextTicks.length, 1, 'main result callback was not deferred exactly once')
      assert.deepEqual(events, ['setData'])
      env.flushNextTicks()
      assert.deepEqual(events, ['setData', 'finishMeasurement', 'syncFavorite'])
      assert.equal(patches.length, 1, 'missing-workspace callback caused a duplicate default patch')
      return
    }

    if (name === 'normal-gate-fixture' || name === 'existing-workspace' || name === 'same-signature-favorite'
      || name === 'storage-schema-read-failure' || name === 'hidden-return' || name === 'unload-late-callback'
      || name === 'switch-conflict' || name === 'second-read-failure') {
      const start = name === 'existing-workspace' ? '17' : '1'
      const quantity = name === 'existing-workspace' ? '3' : '4'
      const preferences = makePreferences(start, quantity)
      const { workspace, contextId } = seedWorkspace(preferences)
      const records = name === 'same-signature-favorite' || name === 'storage-schema-read-failure'
        || name === 'switch-conflict' || name === 'second-read-failure'
        ? seedFavorite(preferences)
        : require(path.join(repoRoot, 'utils/records.js'))

      let targetProject = null
      if (name === 'switch-conflict' || name === 'second-read-failure') {
        targetProject = records.createProject('Cold init target')
        assert(targetProject?.id, 'could not seed target project')
      }

      if (name === 'switch-conflict') {
        const originalSwitch = workspace.switchLightingContext
        workspace.switchLightingContext = (targetId, currentScheme, expectedRevision, sourceId) => {
          const concurrentSave = workspace.saveLightingScheme(sourceId, currentScheme, expectedRevision)
          assert.equal(concurrentSave.ok, true, `failed to simulate concurrent project edit: ${concurrentSave.error}`)
          return originalSwitch(targetId, currentScheme, expectedRevision, sourceId)
        }
      }

      if (name === 'second-read-failure') {
        const originalRead = workspace.readLightingWorkspace
        let readCount = 0
        workspace.readLightingWorkspace = (id) => {
          readCount += 1
          if (readCount === 2) return { ok: false, error: 'Synthetic second workspace read failure', contextId: id, scheme: null, revision: null }
          return originalRead(id)
        }
      }

      if (name === 'storage-schema-read-failure') {
        const before = [...env.storage.entries()].map(([key, value]) => [key, clone(value)])
        const getStorageSync = env.wx.getStorageSync
        env.wx.getStorageSync = (key) => {
          if (key === migrationJournalKey) throw new Error('Synthetic migration journal read failure')
          return getStorageSync(key)
        }
        const lookupCalls = []
        const originalLookup = records.getFavoriteByPayload
        const originalWorkspaceSnapshot = records.getWorkspaceSnapshot
        records.getFavoriteByPayload = (...args) => {
          lookupCalls.push('lookup')
          events.push('favoriteLookup')
          return originalLookup.apply(records, args)
        }
        records.getWorkspaceSnapshot = (...args) => {
          events.push('workspaceSnapshot')
          return originalWorkspaceSnapshot.apply(records, args)
        }
        const { page, patches } = loadTrackedPage(env, events)
        page.onLoad()
        assert.equal(patches.length, 1, 'records schema read failure caused multiple cold submissions')
        assert(page.data.contextError.includes('读取项目数据迁移状态失败'), 'records migration failure was not surfaced')
        assert.equal(page.data.currentFavorite, false)
        assert.deepEqual(lookupCalls, [], 'favorite lookup ran before records schema check failed')
        assert.deepEqual(events, ['workspaceSnapshot', 'setData'], 'storage failure did not precede the result patch')
        env.flushNextTicks()
        assert.deepEqual(lookupCalls, ['lookup'], 'post-render favorite synchronization was skipped or duplicated')
        assert.equal(patches.length, 1, 'failed records lookup produced a stale UI write')
        const after = [...env.storage.entries()].map(([key, value]) => [key, clone(value)])
        assert.deepEqual(after, before, 'failed records schema check changed its stored snapshot')
        assert.deepEqual(events, ['workspaceSnapshot', 'setData', 'finishMeasurement', 'syncFavorite', 'favoriteLookup'])
        return
      }

      if (name === 'unload-late-callback') {
        const { page, patches } = loadTrackedPage(env, events)
        page.onLoad()
        assertColdPatch(page, patches, { name, favorite: false })
        const payload = page.getRecordPayload()
        assert(payload, 'loaded DMX page did not produce favorite payload')
        const favorite = records.saveFavoriteSnapshot(payload)
        assert(favorite, 'could not create a late same-signature favorite')
        page.onUnload()
        const countAfterUnload = patches.length
        env.flushNextTicks()
        assert.equal(patches.length, countAfterUnload, 'late onLoad callback wrote to an unloaded Page')
        assert.equal(page.data.currentFavorite, false, 'late callback mutated unloaded favorite state')
        assert(!events.includes('syncFavorite'), 'unloaded callback ran post-render favorite synchronization')
        assert(events.includes('finishMeasurement'), 'unload discarded the measurement completion callback')
        return
      }

      const lookupTrace = []
      const originalFavoriteLookup = records.getFavoriteByPayload
      const originalWorkspaceSnapshot = records.getWorkspaceSnapshot
      if (name === 'same-signature-favorite') {
        records.getFavoriteByPayload = function tracedFavoriteLookup(...args) {
          lookupTrace.push('favoriteLookup')
          events.push('favoriteLookup')
          return originalFavoriteLookup.apply(this, args)
        }
        records.getWorkspaceSnapshot = function tracedWorkspaceSnapshot(...args) {
          lookupTrace.push('workspaceSnapshot')
          events.push('workspaceSnapshot')
          return originalWorkspaceSnapshot.apply(this, args)
        }
      }
      const { page, patches } = loadTrackedPage(env, events)
      const options = targetProject ? { lightingProjectId: targetProject.id } : {}
      if (name === 'normal-gate-fixture' || name === 'same-signature-favorite') {
        assert.equal(Object.prototype.hasOwnProperty.call(page.data, 'editorDirty'), false)
      }
      page.onLoad(options)

      if (name === 'switch-conflict' || name === 'second-read-failure') {
        assert.equal(patches.length, 1, `${name} must combine viewport and error fields in one submission`)
        assert.equal(page.data.windowWidth, 430)
        assert(page.data.contextError, `${name} did not retain its original error state`)
        assert.equal(env.pending.nextTicks.length, 0, `${name} unexpectedly submitted a result callback`)
        assert.deepEqual(events, ['setData'])
        return
      }

      assertColdPatch(page, patches, {
        name,
        favorite: name === 'same-signature-favorite',
      })
      assert.equal(page.data.contextError, '')
      assert.equal(page.data.result.totalFixtures, Number(quantity), 'stored workspace result was not loaded')
      if (name === 'existing-workspace') {
        assert.equal(page.data.startAddressText, '17')
        assert.equal(page.data.groups[0].fixtureCount, '3')
      }
      if (name === 'same-signature-favorite') {
        // The records migration/schema check must happen before the lookup that
        // seeds the icon. The callback still runs the authoritative lookup.
        assert.equal(page.data.currentFavorite, true)
        assert.deepEqual(lookupTrace, ['workspaceSnapshot', 'favoriteLookup'],
          'prepared favorite lookup did not follow the workspace/schema snapshot')
      }
      assert.equal(env.pending.nextTicks.length, 1, 'cold result callback was not queued once')
      assert.deepEqual(events, name === 'same-signature-favorite'
        ? ['workspaceSnapshot', 'favoriteLookup', 'setData']
        : ['setData'])
      env.flushNextTicks()
      assert.deepEqual(events, name === 'same-signature-favorite'
        ? ['workspaceSnapshot', 'favoriteLookup', 'setData', 'finishMeasurement', 'syncFavorite', 'favoriteLookup']
        : ['setData', 'finishMeasurement', 'syncFavorite'])
      assert.equal(patches.length, 1, `${name} emitted an unnecessary post-render patch`)
      if (name === 'same-signature-favorite') {
        assert.equal(page.data.currentFavorite, true)
        assert.deepEqual(lookupTrace, ['workspaceSnapshot', 'favoriteLookup', 'favoriteLookup'],
          'post-render favorite lookup was not preserved after measurement completion')
      }

      if (name === 'hidden-return') {
        page.onShow()
        page.openFixtureSearch({ currentTarget: { dataset: { index: 0 } } })
        page.onFixtureSearchInput({ detail: { value: 'TL-SE3401' } })
        page.onHide()
        assert.equal(page._fixtureSearchNeedsRefresh, true, 'hide discarded pending search work')
        const beforeReturn = patches.length
        page.onShow()
        env.flushNextTicks()
        assert(page._fixtureSearchNeedsRefresh === false, 'return did not consume preserved search work')
        assert.equal(page.data.fixtureSearchKeyword, 'TL-SE3401', 'return lost the pending search text')
        assert(page.data.fixtureSearchTotal > 0, 'return did not recompute the fixture search')
        assert(page.data.fixtureSearchResults.some((item) => item.model === 'TL-SE3401'),
          'return did not restore the matching fixture result')
        assert(patches.length > beforeReturn, 'return path did not reapply the existing workspace/search state')
        const beforeResize = patches.length
        page.onResize({ size: { windowWidth: 500, windowHeight: 900, pixelRatio: 2 } })
        assert.equal(page.data.windowWidth, 500, 'normal resize stopped updating viewport metrics')
        assert.equal(patches.length, beforeResize + 2, 'non-cold resize no longer keeps its separate gesture/viewport submissions')
        const groupCount = page.data.groups.length
        page.addGroup()
        assert.equal(page.data.fixtureSearchOpen, true, 'user add-group flow no longer opens the real model picker')
        page.selectFixture({ currentTarget: { dataset: { model: 'TL-SE3401' } } })
        assert.equal(page.data.pendingChange?.kind, 'add', 'fixture selection did not open its real confirmation preview')
        page.confirmPendingChange()
        assert.equal(page.data.groups.length, groupCount + 1, 'user fixture selection stopped creating a group')
        page.onCardQuantityInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '5' } })
        assert.equal(page.data.groups[0].fixtureCount, '5', 'post-init floating-card quantity edit stopped updating')
        page.onCardQuantityBlur({ currentTarget: { dataset: { index: 0 } }, detail: { value: '5' } })
        assert.equal(page.data.pendingChange?.kind, 'edit', 'quantity edit did not open its real confirmation preview')
        page.confirmPendingChange()
        assert.equal(page._scheme.preferences.groups[0].fixtureCount, '5', 'confirmed quantity edit did not persist')
        page.flushScheduledCalculation()
      }
      return
    }

    if (name === 'failed-workspace-read') {
      const originalRead = env.wx.getStorageSync
      env.wx.getStorageSync = (key) => {
        if (key === workspaceKey) throw new Error('Synthetic lighting workspace read failure')
        return originalRead(key)
      }
      const { page, patches } = loadTrackedPage(env, events)
      page.onLoad()
      assert.equal(patches.length, 1, 'failed workspace read did not coalesce viewport and error')
      assert.equal(page.data.windowWidth, 430)
      assert(page.data.contextError, 'failed workspace read lost its original error message')
      assert.equal(env.pending.nextTicks.length, 0, 'failed workspace read submitted a result callback')
      assert.deepEqual(events, ['setData'])
      return
    }

    assert.fail(`Unknown worker case: ${name}`)
  } finally {
    restoreConsole()
  }
}

async function main() {
  if (process.argv[2] === '--case') {
    await runCase(process.argv[3])
    return
  }
  const cases = [
    'normal-gate-fixture',
    'existing-workspace',
    'missing-workspace',
    'same-signature-favorite',
    'failed-workspace-read',
    'switch-conflict',
    'second-read-failure',
    'storage-schema-read-failure',
    'hidden-return',
    'unload-late-callback',
  ]
  for (const name of cases) {
    const result = spawnSync(process.execPath, [__filename, '--case', name], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.equal(result.status, 0,
      `${name} failed (status=${result.status}, signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    process.stdout.write(`PASS ${name}\n`)
  }
  process.stdout.write(`DMX cold initialization regression passed (${cases.length} isolated Page scenarios).\n`)
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})

const assert = require('assert')
const path = require('path')
const Module = require('module')

const helperPath = path.resolve(__dirname, '../../pages/dmx-layout/lighting-workspace.js')
const storage = new Map()
const failures = { get: null, set: null, remove: null }
let projects = []
const recordApi = {
  getWorkspaceSnapshot() {
    return { ok: true, projects: projects.map((project) => ({ ...project })) }
  },
}

global.wx = {
  getStorageSync(key) {
    if (failures.get && (failures.get.key === key || failures.get.key === '*')) throw new Error('read failure')
    return storage.get(key)
  },
  setStorageSync(key, value) {
    const failure = failures.set
    if (failure && (failure.key === key || failure.key === '*')) {
      if (failure.remaining === Infinity || failure.remaining > 0) {
        if (failure.remaining !== Infinity) failure.remaining -= 1
        throw new Error('write failure')
      }
    }
    storage.set(key, value)
  },
  removeStorageSync(key) {
    const failure = failures.remove
    if (failure && (failure.key === key || failure.key === '*')) {
      if (failure.remaining === Infinity || failure.remaining > 0) {
        if (failure.remaining !== Infinity) failure.remaining -= 1
        throw new Error('remove failure')
      }
    }
    storage.delete(key)
  },
}

const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (parent?.filename === helperPath && request === '../../utils/records') return recordApi
  return originalLoad.call(this, request, parent, isMain)
}

const WORKSPACE_KEY = 'audioTool.dmxLightingWorkspace.v2'
const JOURNAL_KEY = 'audioTool.dmxLightingWorkspace.journal.v1'
const PREFERENCE_KEY = 'audioTool.dmxAddress.preferences'
const PROGRESS_KEY = 'audioTool.dmxAddress.progress'
const LEGACY_LAYOUT_KEY = 'audioTool.dmxLayout.v1'

function loadHelper() {
  delete require.cache[helperPath]
  return require(helperPath)
}

let helper = loadHelper()

function reset(projectRows = [{ id: 'project-1', name: '项目一' }, { id: 'project-2', name: '项目二' }]) {
  storage.clear()
  failures.get = null
  failures.set = null
  failures.remove = null
  projects = projectRows.map((project) => ({ ...project }))
  helper = loadHelper()
}

function prefs(groups = [], options = {}) {
  return {
    startAddressText: options.startAddressText || '1',
    allocationMode: options.allocationMode || 'auto',
    groups,
    groupSummary: options.groupSummary || '',
  }
}

function group(model = 'TL-SL323', channelCount = 2, fixtureCount = 2, extras = {}) {
  return {
    name: model,
    fixtureSource: 'library',
    fixtureModel: model,
    channelCount,
    fixtureCount,
    ...extras,
  }
}

function validScheme(model, channelCount, fixtureCount, extras = {}) {
  return helper.createLightingScheme(prefs([group(model, channelCount, fixtureCount, extras)]))
}

function testStrictFailuresAndRevisionConflicts() {
  reset()
  const initial = helper.readLightingWorkspace('temporary')
  assert.strictEqual(initial.ok, true)
  const scheme = validScheme('TL-SL323', 2, 2)
  failures.set = { key: JOURNAL_KEY, remaining: Infinity }
  const failed = helper.saveLightingScheme('temporary', scheme, initial.revision)
  assert.strictEqual(failed.ok, false, 'failed journal write cannot report a successful save')
  assert.strictEqual(storage.has(WORKSPACE_KEY), true, 'failed save keeps initialized workspace')
  assert.strictEqual(storage.has(JOURNAL_KEY), false, 'journal failure happens before mirror writes')
  failures.set = null

  const saved = helper.saveLightingScheme('temporary', scheme, initial.revision)
  assert.strictEqual(saved.ok, true)
  const stale = helper.saveLightingScheme('temporary', scheme, initial.revision)
  assert.strictEqual(stale.ok, false)
  assert.strictEqual(stale.error, 'conflict')
  assert.strictEqual(stale.revision, saved.revision)

  failures.get = { key: WORKSPACE_KEY }
  const unreadable = helper.readLightingWorkspace('temporary')
  assert.strictEqual(unreadable.ok, false, 'storage read failures must not become an empty plan')
  failures.get = null
  assert.strictEqual(helper.readLightingWorkspace('temporary').ok, true)
}

function testInvalidInputDoesNotPruneOrPersist() {
  reset()
  const initial = helper.readLightingWorkspace('temporary')
  const saved = helper.saveLightingScheme('temporary', validScheme('TL-SL113', 21, 3), initial.revision)
  assert.strictEqual(saved.ok, true)
  const fixture = helper.calculateScheme(saved.scheme).result.fixtures[0]
  const checkedScheme = JSON.parse(JSON.stringify(saved.scheme))
  checkedScheme.checksById[fixture.stableId] = {
    fingerprint: JSON.stringify([
      fixture.fixtureModel,
      fixture.channelCount,
      fixture.universeLabel,
      fixture.startAddress,
      fixture.endAddress,
    ]),
  }
  checkedScheme.layout = { positionsById: { [fixture.stableId]: { rodId: 'rod-1', t: 0.4 } } }
  const checkedSave = helper.saveLightingScheme('temporary', checkedScheme, saved.revision)
  assert.strictEqual(checkedSave.ok, true)
  const before = checkedSave.scheme
  const invalidQuantity = JSON.parse(JSON.stringify(before))
  invalidQuantity.preferences.groups[0].fixtureCount = 0
  const rejectedCount = helper.saveLightingScheme('temporary', invalidQuantity, checkedSave.revision)
  assert.strictEqual(rejectedCount.ok, false)
  const afterCount = helper.readLightingWorkspace('temporary').scheme
  assert.deepStrictEqual(afterCount.fixtureIdsByGroup, before.fixtureIdsByGroup)
  assert.deepStrictEqual(afterCount.checksById, before.checksById)
  assert.deepStrictEqual(afterCount.layout, before.layout)

  const unsupportedMode = JSON.parse(JSON.stringify(before))
  unsupportedMode.preferences.groups[0].channelCount = 23
  const rejectedMode = helper.saveLightingScheme('temporary', unsupportedMode, checkedSave.revision)
  assert.strictEqual(rejectedMode.ok, false, 'unsupported library modes cannot be persisted')
  assert.strictEqual(helper.readLightingWorkspace('temporary').revision, checkedSave.revision)
}

function testIndependentContextsAndStaleSwitchGuard() {
  reset()
  const empty = helper.readLightingWorkspace('temporary')
  const sourceScheme = validScheme('TL-SL323', 2, 4)
  const sourceSave = helper.saveLightingScheme('temporary', sourceScheme, empty.revision)
  assert.strictEqual(sourceSave.ok, true)
  const switched = helper.switchLightingContext('project-1', sourceSave.scheme, sourceSave.revision, 'temporary')
  assert.strictEqual(switched.ok, true)
  assert.strictEqual(switched.contextId, 'project-1')
  assert.strictEqual(switched.scheme.preferences.groups.length, 0, 'switching context does not copy the draft')
  assert.strictEqual(helper.readLightingWorkspace('temporary').scheme.preferences.groups.length, 1)

  const emptyProject = helper.readLightingWorkspace('project-1')
  const savedProject = helper.saveLightingToProject('project-1', sourceSave.scheme, {
    expectedRevision: emptyProject.revision,
  })
  assert.strictEqual(savedProject.ok, true)
  const staleSwitch = helper.switchLightingContext('project-1', sourceSave.scheme, sourceSave.revision, 'temporary')
  assert.strictEqual(staleSwitch.ok, false, 'a stale temporary page cannot overwrite a project selected elsewhere')
  assert.strictEqual(staleSwitch.error, 'conflict')
  assert.strictEqual(helper.readLightingWorkspace('project-1').scheme.preferences.groups.length, 1)
}

function testReplacementBackupAndRestore() {
  reset()
  const oldScheme = validScheme('TL-SL323', 2, 1)
  const first = helper.saveLightingToProject('project-1', oldScheme, { expectedRevision: 0 })
  assert.strictEqual(first.ok, true)
  const newScheme = validScheme('TL-SL113', 21, 3)
  const replacement = helper.saveLightingToProject('project-1', newScheme, {
    replace: true,
    expectedRevision: first.revision,
  })
  assert.strictEqual(replacement.ok, true)
  assert.ok(replacement.backup?.id)
  assert.strictEqual(helper.readLightingWorkspace('project-1').scheme.preferences.groups[0].fixtureModel, 'TL-SL113')
  const restored = helper.restoreLightingBackup('project-1', replacement.backup.id, replacement.revision)
  assert.strictEqual(restored.ok, true)
  assert.strictEqual(restored.scheme.preferences.groups[0].fixtureModel, 'TL-SL323')

  const envelope = storage.get(WORKSPACE_KEY)
  envelope.backups.push({ id: 'bad-backup', contextId: 'project-1', scheme: null })
  storage.set(WORKSPACE_KEY, envelope)
  const beforeBadRestore = helper.readLightingWorkspace('project-1')
  const rejected = helper.restoreLightingBackup('project-1', 'bad-backup', beforeBadRestore.revision)
  assert.strictEqual(rejected.ok, false)
  assert.strictEqual(helper.readLightingWorkspace('project-1').revision, beforeBadRestore.revision)

  const withNullBackup = storage.get(WORKSPACE_KEY)
  withNullBackup.backups.unshift(null)
  storage.set(WORKSPACE_KEY, withNullBackup)
  const nullBackupRead = helper.readLightingWorkspace('project-1')
  const nullBackupRestore = helper.restoreLightingBackup('project-1', 'missing', nullBackupRead.revision)
  assert.strictEqual(nullBackupRestore.ok, false, 'malformed backup rows cannot crash restore')
}

function testLegacyMigrationAndInboundRestoreIsolation() {
  reset()
  const legacyLayout = { positions: { 0: { x: 33, y: 44 } }, barCounts: { front: 2 }, schemeId: 'old' }
  const legacyPreferences = prefs([group('TL-SL323', 2, 2)], { groupSummary: '旧方案' })
  const oldKeys = {
    [PREFERENCE_KEY]: legacyPreferences,
    [PROGRESS_KEY]: {
      calculationSignature: JSON.stringify(legacyPreferences),
      keys: ['0:1:A001'],
    },
    [LEGACY_LAYOUT_KEY]: legacyLayout,
  }
  Object.entries(oldKeys).forEach(([key, value]) => storage.set(key, value))
  const migrated = helper.readLightingWorkspace('temporary')
  assert.strictEqual(migrated.ok, true)
  assert.deepStrictEqual(migrated.scheme.legacySideLayout, legacyLayout)
  assert.strictEqual(Object.keys(migrated.scheme.checksById).length, 1, 'legacy field checks map to stable fixture IDs')
  for (const [key, value] of Object.entries(oldKeys)) assert.deepStrictEqual(storage.get(key), value)

  const projectEmpty = helper.readLightingWorkspace('project-1')
  const projectSave = helper.saveLightingToProject('project-1', validScheme('TL-SL113', 21, 1), {
    expectedRevision: projectEmpty.revision,
  })
  assert.strictEqual(projectSave.ok, true)
  const projectBeforeImport = helper.readLightingWorkspace('project-1').scheme

  const incoming = prefs([group('TL-SL113', 25, 3)], { groupSummary: '恢复记录' })
  storage.set(PREFERENCE_KEY, incoming)
  storage.set(PROGRESS_KEY, { calculationSignature: JSON.stringify(incoming), keys: [] })
  const imported = helper.importLegacyLightingPreferences()
  assert.strictEqual(imported.ok, true)
  assert.strictEqual(imported.contextId, 'temporary')
  assert.strictEqual(imported.scheme.preferences.groups[0].fixtureModel, 'TL-SL113')
  assert.strictEqual(imported.scheme.legacySideLayout, undefined, 'later inbound preferences do not inherit another context layout')
  assert.deepStrictEqual(helper.readLightingWorkspace('project-1').scheme, projectBeforeImport)

  const sameSignatureImport = helper.importLegacyLightingPreferences()
  assert.strictEqual(sameSignatureImport.ok, true, 'explicit record restore imports even an identical preference signature')
  assert.strictEqual(sameSignatureImport.contextId, 'temporary')
  assert.strictEqual(sameSignatureImport.scheme.legacySideLayout, undefined)
}

function testPersistentFailureRecoversAfterReloadAndRetries() {
  reset()
  const originalScheme = validScheme('TL-SL323', 2, 1)
  const first = helper.saveLightingToProject('project-1', originalScheme, { expectedRevision: 0 })
  assert.strictEqual(first.ok, true)
  const nextScheme = validScheme('TL-SL113', 25, 4)
  failures.set = { key: WORKSPACE_KEY, remaining: Infinity }
  const failed = helper.saveLightingToProject('project-1', nextScheme, {
    replace: true,
    expectedRevision: first.revision,
  })
  assert.strictEqual(failed.ok, false, 'workspace write failure must not report success')
  assert.strictEqual(storage.has(JOURNAL_KEY), true, 'durable recovery marker remains after persistent failure')
  assert.strictEqual(storage.get(PREFERENCE_KEY).groups[0].fixtureModel, 'TL-SL113', 'mirror can be partially advanced')

  failures.set = null
  helper = loadHelper()
  const recovered = helper.readLightingWorkspace('project-1')
  assert.strictEqual(recovered.ok, true)
  assert.strictEqual(recovered.scheme.preferences.groups[0].fixtureModel, 'TL-SL323')
  assert.strictEqual(storage.get(PREFERENCE_KEY).groups[0].fixtureModel, 'TL-SL323', 'relaunch recovery restores the old mirror')
  assert.strictEqual(storage.has(JOURNAL_KEY), false)

  const retry = helper.saveLightingToProject('project-1', nextScheme, {
    replace: true,
    expectedRevision: recovered.revision,
  })
  assert.strictEqual(retry.ok, true, 'the same user change can be retried after recovery')
  assert.strictEqual(retry.scheme.preferences.groups[0].fixtureModel, 'TL-SL113')
}

function testRecoveryPreservesNewInboundLegacyData() {
  reset()
  const first = helper.saveLightingToProject('project-1', validScheme('TL-SL323', 2, 4), { expectedRevision: 0 })
  assert.strictEqual(first.ok, true)
  const current = helper.readLightingWorkspace('project-1')
  failures.set = { key: WORKSPACE_KEY, remaining: Infinity }
  const interrupted = helper.saveLightingToProject('project-1', validScheme('TL-SL113', 25, 4), {
    replace: true,
    expectedRevision: current.revision,
  })
  assert.strictEqual(interrupted.ok, false)
  failures.set = null

  const incoming = prefs([group('TL-SL611', 2, 6)], { groupSummary: '新导入方案' })
  storage.set(PREFERENCE_KEY, incoming)
  storage.set(PROGRESS_KEY, { calculationSignature: JSON.stringify(incoming), keys: [] })
  helper = loadHelper()
  const imported = helper.importLegacyLightingPreferences()
  assert.strictEqual(imported.ok, true)
  assert.strictEqual(imported.scheme.preferences.groups[0].fixtureModel, 'TL-SL611', 'recovery must preserve a later external import')
  assert.strictEqual(helper.readLightingWorkspace('project-1').scheme.preferences.groups[0].fixtureModel, 'TL-SL323')
}

function testMalformedJournalIsScopedAndLegacyCustomIsRecoverable() {
  reset()
  const current = helper.readLightingWorkspace('temporary')
  const badJournal = {
    version: 1,
    oldSnapshot: { [WORKSPACE_KEY]: { present: true, value: storage.get(WORKSPACE_KEY) }, 'audioTool.projects.v1': { present: true, value: [] } },
    nextSnapshot: {},
    oldMirrorValues: {},
    nextMirrorValues: {},
  }
  storage.set('audioTool.projects.v1', [{ id: 'preserve' }])
  storage.set(JOURNAL_KEY, badJournal)
  const blocked = helper.readLightingWorkspace('temporary')
  assert.strictEqual(blocked.ok, false, 'unexpected journal keys must be rejected before writes')
  assert.deepStrictEqual(storage.get('audioTool.projects.v1'), [{ id: 'preserve' }])
  storage.delete(JOURNAL_KEY)

  const legacyCustom = helper.createLightingScheme(prefs([{
    name: '旧自定义灯具',
    channelCount: '16',
    fixtureCount: '2',
  }]))
  const calculated = helper.calculateScheme(legacyCustom)
  assert.strictEqual(calculated.valid, true, 'legacy groups without a library source marker remain recoverable')
  assert.strictEqual(calculated.result.groups[0].fixtureModel, '')
  assert.strictEqual(current.ok, true)
}

function testDeletedActiveProjectCanSwitchToTemporary() {
  reset()
  const saved = helper.saveLightingToProject('project-1', validScheme('TL-SL323', 2, 2), { expectedRevision: 0 })
  assert.strictEqual(saved.ok, true)
  projects = projects.filter((project) => project.id !== 'project-1')
  const orphan = helper.readLightingWorkspace()
  assert.strictEqual(orphan.ok, true)
  assert.strictEqual(orphan.orphan, true)
  const switched = helper.switchLightingContext('temporary', orphan.scheme, orphan.revision, 'project-1')
  assert.strictEqual(switched.ok, true)
  assert.strictEqual(switched.contextId, 'temporary')
  assert.strictEqual(helper.readLightingWorkspace('project-1').ok, true, 'orphan snapshot remains recoverable')
}

function run() {
  testStrictFailuresAndRevisionConflicts()
  testInvalidInputDoesNotPruneOrPersist()
  testIndependentContextsAndStaleSwitchGuard()
  testReplacementBackupAndRestore()
  testLegacyMigrationAndInboundRestoreIsolation()
  testPersistentFailureRecoversAfterReloadAndRetries()
  testRecoveryPreservesNewInboundLegacyData()
  testMalformedJournalIsScopedAndLegacyCustomIsRecoverable()
  testDeletedActiveProjectCanSwitchToTemporary()
  process.stdout.write('workspace helper tests passed\n')
}

try {
  run()
} finally {
  Module._load = originalLoad
}

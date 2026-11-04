'use strict'

// Independent fault oracle. Uses public records APIs and discovers the journal
// from normal platform IO, rather than importing transaction implementation.
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const recordsPath = path.join(root, 'utils/records.js')
const utilRoot = path.join(root, 'utils') + path.sep
const key = {
  schema: 'audioTool.storageSchemaVersion', projects: 'audioTool.projects.v1',
  records: 'audioTool.records.v1', favorites: 'audioTool.favorites.v1',
  recovery: 'audioTool.recovery.v1', active: 'audioTool.activeProject.v1',
  backups: 'audioTool.storageMigrationBackups.v1', migration: 'audioTool.storageMigrationJournal.v1',
}
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const project = { id: 'p-independent', name: '已有项目', createdAt: 100, updatedAt: 200, notes: '  原始备注  ', opaque: { retained: true } }
const record = { id: 'r-independent', module: 'spl', title: '已有结果', preferences: { distanceText: '8' }, resultText: '原始结果', projectIds: [project.id], favorite: false, archived: false, createdAt: 110, updatedAt: 210, opaque: { retained: true } }
const favorite = { ...clone(record), id: 'f-independent', projectIds: [], originProjectIds: [project.id], favorite: true }
const initial = { [key.schema]: 4, [key.projects]: [project], [key.records]: [record], [key.favorites]: [favorite], [key.recovery]: [] }
let journalKey
const previousWx = global.wx
const previousNow = Date.now
const previousRandom = Math.random
Date.now = () => 1793700000000
Math.random = () => 0.1875

function fixture(seed = initial, { removeAvailable = true } = {}) {
  const store = new Map(Object.entries(clone(seed)))
  const trace = []
  const checkpoints = []
  let fault = () => ''
  const snapshot = () => Object.fromEntries([...store].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, clone(v)]))
  const wx = {
    getStorageSync(k) {
      assert.equal(this, wx)
      const timing = fault('get', k, undefined)
      trace.push({ op: 'get', key: k, timing })
      if (timing) throw new Error('Injected read failure ' + k)
      return clone(store.get(k))
    },
    setStorageSync(k, value) {
      assert.equal(this, wx)
      const timing = fault('set', k, clone(value))
      trace.push({ op: 'set', key: k, value: clone(value), timing })
      if (timing === 'before') throw new Error('Injected write failure ' + k)
      store.set(k, clone(value))
      checkpoints.push({ op: 'set', key: k, store: snapshot() })
      if (timing === 'after') throw new Error('Injected post-write failure ' + k)
    },
  }
  if (removeAvailable) wx.removeStorageSync = function (k) {
    assert.equal(this, wx)
    const timing = fault('remove', k, undefined)
    trace.push({ op: 'remove', key: k, timing })
    if (timing === 'before') throw new Error('Injected remove failure ' + k)
    store.delete(k)
    checkpoints.push({ op: 'remove', key: k, store: snapshot() })
    if (timing === 'after') throw new Error('Injected post-remove failure ' + k)
  }
  function restart() {
    global.wx = wx
    for (const filename of Object.keys(require.cache)) if (filename.startsWith(utilRoot)) delete require.cache[filename]
    f.api = require(recordsPath)
    return f.api
  }
  const f = { store, trace, checkpoints, snapshot, restart, api: null,
    inject(next) { fault = next }, clear() { fault = () => '' },
    warm() { return this.api.getWorkspaceSnapshot({ forceRefresh: true }) },
    run() { return this.api.removeRecordFromProject(record.id, project.id) },
  }
  restart()
  return f
}

function dataSnapshot(f) {
  const data = f.snapshot()
  delete data[journalKey]
  return data
}
function physicalAbsent(f, k) {
  return !f.store.has(k) || f.store.get(k) === '' || f.store.get(k) == null
}
function assertNoWrites(events) {
  assert.deepEqual(events.filter(e => e.op !== 'get'), [], 'Blocked access must not mutate any storage key')
}
function assertColdRollback(f, expected = initial) {
  f.clear()
  f.restart()
  assert.equal(f.warm().ok, true)
  assert.deepEqual(dataSnapshot(f), clone(expected), 'Recovery must restore exact raw owner data, including fields normalized only for display')
  assert.equal(physicalAbsent(f, journalKey), true)
  const stable = f.snapshot()
  assert.equal(f.warm().ok, true)
  assert.deepEqual(f.snapshot(), stable, 'Repeated recovery must be idempotent')
}
const results = []
function check(name, run) {
  try { run(); results.push({ name, status: 'PASS' }) }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }) }
}

try {
  const normal = fixture()
  assert.equal(normal.warm().ok, true)
  assert.equal(normal.run(), true)
  const discovered = [...new Set(normal.trace.filter(e => e.op === 'set' && !Object.values(key).includes(e.key)).map(e => e.key))]
  assert.equal(discovered.length, 1, 'A successful multi-key operation must use exactly one dedicated undo journal')
  journalKey = discovered[0]
  const committed = dataSnapshot(normal)
  const partial = normal.checkpoints.find(e => e.op === 'set' && e.key === key.records).store

  check('normal transaction retains existing remove-link semantics and commits', () => {
    assert.equal(physicalAbsent(normal, journalKey), true)
    assert.equal(normal.api.getRecords().length, 0)
    assert.equal(normal.api.getRecoveryEntries().length, 1)
    assert.equal(normal.api.getRecoveryEntries()[0].kind, 'record-project-link')
    assert.deepEqual(normal.store.get(key.favorites), initial[key.favorites])
  })

  check('warmed caches plus write and rollback failures block writes and recover after cold restart', () => {
    const f = fixture()
    assert.equal(f.warm().ok, true)
    f.inject((op, k, value) => op === 'set' && (k === key.projects || (k === key.records && equal(value, initial[key.records]))) ? 'before' : '')
    assert.equal(f.run(), false)
    assert.equal(physicalAbsent(f, journalKey), false)
    assert.equal(f.warm().ok, false, 'Pending rollback must not report a healthy workspace')
    const pending = f.snapshot()
    assert.equal(f.api.createProject('不得新增'), null)
    assert.deepEqual(f.snapshot(), pending)
    assertColdRollback(f)
  })

  check('same instance recovers a failed transaction and invalidates warmed logical caches', () => {
    const f = fixture()
    const before = f.warm()
    f.inject((op, k, value) => op === 'set' && (k === key.projects || (k === key.records && equal(value, initial[key.records]))) ? 'before' : '')
    assert.equal(f.run(), false)
    assert.equal(f.warm().ok, false)
    f.clear()
    assert.deepEqual(f.warm(), before)
    assert.deepEqual(dataSnapshot(f), initial)
    assert.equal(physicalAbsent(f, journalKey), true)
  })

  check('future schema with a pending undo journal remains completely read only', () => {
    const f = fixture({ ...clone(partial), [key.schema]: 99 })
    const before = f.snapshot()
    assert.equal(f.warm().ok, false)
    assert.equal(f.api.createProject('不得新增'), null)
    assert.equal(f.run(), false)
    assert.deepEqual(f.snapshot(), before)
    assertNoWrites(f.trace)
  })

  check('journal read failure after cache warmup blocks and retries without poisoning cache', () => {
    const f = fixture()
    const before = f.warm()
    f.inject((op, k) => op === 'get' && k === journalKey ? 'before' : '')
    const start = f.trace.length
    assert.equal(f.warm().ok, false)
    assert.equal(f.api.createProject('不得新增'), null)
    assert.deepEqual(dataSnapshot(f), initial)
    assertNoWrites(f.trace.slice(start))
    f.clear()
    assert.deepEqual(f.warm(), before)
    assert.ok(f.api.createProject('允许新增'))
  })

  check('journal preparation failure never writes business data', () => {
    const f = fixture()
    f.inject((op, k) => op === 'set' && k === journalKey ? 'before' : '')
    assert.equal(f.run(), false)
    assert.deepEqual(dataSnapshot(f), initial)
    assert.equal(f.trace.some(e => e.op === 'set' && Object.values(key).includes(e.key)), false)
    assertColdRollback(f)
  })

  for (const target of ['journal', 'records']) check(target + ' write lands then throws: returned result matches cold final state', () => {
    const f = fixture()
    let injected = false
    f.inject((op, k) => {
      if (!injected && op === 'set' && k === (target === 'journal' ? journalKey : key.records)) {
        injected = true
        return 'after'
      }
      return ''
    })
    const result = f.run()
    assert.equal(injected, true)
    f.clear()
    f.restart()
    assert.equal(f.warm().ok, true)
    assert.deepEqual(dataSnapshot(f), result ? committed : initial)
    assert.equal(physicalAbsent(f, journalKey), true)
  })

  check('commit deletion lands then throws: return success and do not undo after restart', () => {
    const f = fixture()
    let injected = false
    f.inject((op, k) => {
      if (!injected && op === 'remove' && k === journalKey) { injected = true; return 'after' }
      return ''
    })
    assert.equal(f.run(), true)
    assert.equal(injected, true)
    assert.equal(physicalAbsent(f, journalKey), true)
    f.clear()
    f.restart()
    assert.equal(f.warm().ok, true)
    assert.deepEqual(dataSnapshot(f), committed)
  })

  check('commit deletion fails before applying: raw originals survive recovery', () => {
    const f = fixture()
    f.inject((op, k) => op === 'remove' && k === journalKey ? 'before' : '')
    assert.equal(f.run(), false)
    assert.equal(physicalAbsent(f, journalKey), false)
    assert.equal(f.warm().ok, false)
    assertColdRollback(f)
  })

  check('commit deletion lands but its readback fails: do not claim success or overwrite the uncertain outcome', () => {
    const f = fixture()
    let deleted = false
    f.inject((op, k) => {
      if (k !== journalKey) return ''
      if (op === 'remove' && !deleted) { deleted = true; return 'after' }
      return deleted && op === 'get' ? 'before' : ''
    })
    assert.equal(f.run(), false)
    assert.equal(deleted, true)
    assert.equal(physicalAbsent(f, journalKey), true)
    assert.deepEqual(dataSnapshot(f), committed, 'Unknown commit must not manufacture an undo log or mix old and new business values')
    const start = f.trace.length
    assert.equal(f.warm().ok, false)
    assert.equal(f.api.createProject('状态未知时不得新增'), null)
    assert.deepEqual(dataSnapshot(f), committed)
    assertNoWrites(f.trace.slice(start))
    f.clear()
    f.restart()
    assert.equal(f.warm().ok, true)
    assert.deepEqual(dataSnapshot(f), committed)
  })

  check('pending journal read failure preserves partial physical state until readable', () => {
    const f = fixture(partial)
    const before = f.snapshot()
    f.inject((op, k) => op === 'get' && k === journalKey ? 'before' : '')
    assert.equal(f.warm().ok, false)
    assert.equal(f.api.createProject('不得新增'), null)
    assert.deepEqual(f.snapshot(), before)
    assertNoWrites(f.trace)
    assertColdRollback(f)
  })

  for (const removeAvailable of [true, false]) check('missing recovery key stays absent after rollback (remove=' + removeAvailable + ')', () => {
    const seed = clone(initial)
    delete seed[key.recovery]
    const f = fixture(seed, { removeAvailable })
    f.inject((op, k) => op === 'set' && k === key.records ? 'before' : '')
    assert.equal(f.run(), false)
    f.clear()
    f.restart()
    assert.equal(f.warm().ok, true)
    assert.equal(physicalAbsent(f, key.recovery), true)
    assert.equal(physicalAbsent(f, journalKey), true)
    for (const [k, value] of Object.entries(seed)) assert.deepEqual(f.store.get(k), value)
  })

  check('every successful pre-commit IO checkpoint restores on restart without duplicates', () => {
    let checked = 0
    for (const checkpoint of normal.checkpoints) {
      if (!checkpoint.store[journalKey]) continue
      const f = fixture(checkpoint.store)
      assertColdRollback(f)
      checked += 1
    }
    assert.ok(checked >= 4, 'Cover journal persistence and all three business writes')
  })
} catch (error) {
  results.push({ name: 'fixture / protocol discovery', status: 'FAIL', error: error.stack })
} finally {
  Date.now = previousNow
  Math.random = previousRandom
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}
console.log(JSON.stringify({ journalKey, results }, null, 2))
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1

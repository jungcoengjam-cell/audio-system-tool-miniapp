const assert = require('assert/strict')

const storage = new Map()
const writeAttempts = []
let readFailureKey = ''
let writeFailureKey = ''
const previousWx = global.wx

function clone(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
}

global.wx = {
  getStorageSync(key) {
    if (key === readFailureKey) throw new Error('simulated read failure')
    return clone(storage.get(key))
  },
  setStorageSync(key, value) {
    writeAttempts.push(key)
    if (key === writeFailureKey) throw new Error('simulated write failure')
    storage.set(key, clone(value))
  },
}

const PROJECTS_KEY = 'audioTool.projects.v1'
const RECORDS_KEY = 'audioTool.records.v1'
const ACTIVE_KEY = 'audioTool.activeProject.v1'
const SCHEMA_KEY = 'audioTool.storageSchemaVersion'

function line(id, code, fromDeviceId, toDeviceId, overrides = {}) {
  return {
    id,
    code,
    purpose: 'program audio',
    fromDevice: 'Console',
    fromPort: 'MAIN L',
    toDevice: 'Speaker',
    toPort: 'IN 1',
    buildType: 'bulk',
    cableType: 'balanced',
    spec: '2-core shielded',
    connectorA: 'xlrFemale',
    connectorB: 'xlrMale',
    lengthText: '8',
    status: 'pending',
    notes: '',
    ...(fromDeviceId ? { fromDeviceId } : {}),
    ...(toDeviceId ? { toDeviceId } : {}),
    ...overrides,
  }
}

function schedule(revision = 7) {
  return {
    version: 1,
    revision,
    nextNumber: 17,
    devices: [
      { id: 'device-a', type: 'mixer', name: 'Console' },
      { id: 'device-b', type: 'speaker', name: 'Speaker' },
    ],
    lines: [
      line('wire-linked', 'A001', 'device-a', 'device-b'),
      line('wire-legacy', 'A009', undefined, undefined, {
        fromDevice: 'Old Console',
        toDevice: 'Old Speaker',
      }),
    ],
  }
}

function freshRecords() {
  delete require.cache[require.resolve('../utils/records')]
  return require('../utils/records')
}

function project(id, name, wiringSchedule) {
  return {
    id,
    name,
    venueName: `${name} venue`,
    engineer: 'Engineer',
    projectDate: '2026-10-16',
    notes: `${name} notes`,
    roomLengthText: '12',
    roomWidthText: '8',
    roomHeightText: '4',
    createdAt: 1,
    updatedAt: 100,
    ...(wiringSchedule ? { wiringSchedule: clone(wiringSchedule) } : {}),
  }
}

function reset(initialSchedule = schedule()) {
  storage.clear()
  storage.set(PROJECTS_KEY, [project('p1', 'Main project', initialSchedule), project('p2', 'Other project')])
  storage.set(RECORDS_KEY, [{ id: 'record-1', module: 'limiter', favorite: true, projectIds: ['p1'] }])
  storage.set(ACTIVE_KEY, 'p2')
  storage.set(SCHEMA_KEY, 3)
  writeAttempts.length = 0
  readFailureKey = ''
  writeFailureKey = ''
  return freshRecords()
}

try {
  let records = reset()
  const originalProjects = clone(storage.get(PROJECTS_KEY))
  readFailureKey = PROJECTS_KEY
  const readFailure = records.saveProjectWiring('p1', {
    type: 'delete-device', id: 'device-a', deleteConnectedLines: true, expectedLineIds: ['wire-linked'],
  }, 7)
  assert.equal(readFailure.ok, false)
  assert.deepEqual(storage.get(PROJECTS_KEY), originalProjects, 'storage read failure cannot partially delete')
  assert.deepEqual(writeAttempts, [])

  records = reset()
  const beforeGuard = clone(storage.get(PROJECTS_KEY))
  const staleConfirmation = records.saveProjectWiring('p1', {
    type: 'delete-device', id: 'device-a', deleteConnectedLines: true, expectedLineIds: [],
  }, 7)
  assert.equal(staleConfirmation.ok, false)
  assert.deepEqual(storage.get(PROJECTS_KEY), beforeGuard, 'line-set mismatch performs no storage write')
  assert.deepEqual(writeAttempts, [])

  const saved = records.saveProjectWiring('p1', {
    type: 'delete-device', id: 'device-a', deleteConnectedLines: true, expectedLineIds: ['wire-linked'],
  }, 7)
  assert.equal(saved.ok, true, saved.error)
  assert.equal(saved.schedule.revision, 8)
  assert.equal(saved.schedule.nextNumber, 17)
  assert.deepEqual(saved.schedule.devices.map((device) => device.id), ['device-b'])
  assert.deepEqual(saved.schedule.lines.map((item) => item.id), ['wire-legacy'])
  assert.deepEqual(writeAttempts, [PROJECTS_KEY], 'device and connected line removal uses one project-list write')
  assert.deepEqual(storage.get(RECORDS_KEY), [{ id: 'record-1', module: 'limiter', favorite: true, projectIds: ['p1'] }])
  assert.equal(storage.get(ACTIVE_KEY), 'p2')
  assert.equal(storage.get(SCHEMA_KEY), 3)
  assert.equal(storage.get(PROJECTS_KEY).find((item) => item.id === 'p2').wiringSchedule, undefined)

  writeAttempts.length = 0
  const beforeStaleRevision = clone(storage.get(PROJECTS_KEY))
  const staleRevision = records.saveProjectWiring('p1', {
    type: 'delete-lines', ids: ['wire-legacy'],
  }, 7)
  assert.equal(staleRevision.ok, false, 'the wrapper rejects a stale project revision')
  assert.deepEqual(storage.get(PROJECTS_KEY), beforeStaleRevision)
  assert.deepEqual(writeAttempts, [])

  writeAttempts.length = 0
  writeFailureKey = PROJECTS_KEY
  const writeFailure = records.saveProjectWiring('p1', {
    type: 'delete-lines', ids: ['wire-legacy'],
  }, 8)
  assert.equal(writeFailure.ok, false)
  assert.deepEqual(writeFailure.schedule, saved.schedule)
  assert.deepEqual(storage.get(PROJECTS_KEY), beforeStaleRevision, 'failed write leaves stored project intact')
  assert.deepEqual(writeAttempts, [PROJECTS_KEY], 'the failed atomic write is attempted once')

  records = reset({
    version: 1,
    revision: 20,
    nextNumber: 64,
    lines: [
      line('legacy-a', 'A003', undefined, undefined, { fromDevice: 'Old Console', toDevice: 'Old Speaker' }),
      line('legacy-b', 'A012', undefined, undefined, { fromDevice: 'Other Console', toDevice: 'Other Speaker' }),
    ],
  })
  const legacyDelete = records.saveProjectWiring('p1', { type: 'delete-lines', ids: ['legacy-a'] }, 20)
  assert.equal(legacyDelete.ok, true, legacyDelete.error)
  assert.equal(legacyDelete.schedule.revision, 21)
  assert.equal(legacyDelete.schedule.nextNumber, 64)
  assert.deepEqual(legacyDelete.schedule.lines.map((item) => item.id), ['legacy-b'])
  assert.deepEqual(writeAttempts, [PROJECTS_KEY], 'legacy line deletion persists atomically')
} finally {
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
  delete require.cache[require.resolve('../utils/records')]
}

console.log('project wiring deletion storage test passed')

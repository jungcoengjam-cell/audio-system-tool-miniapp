const assert = require('assert/strict')
const wiring = require('../utils/project-wiring')

const clone = (value) => JSON.parse(JSON.stringify(value))

function line(id, code, fromDeviceId, toDeviceId, extras = {}) {
  const result = {
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
    ...extras,
  }
  if (fromDeviceId !== undefined) result.fromDeviceId = fromDeviceId
  if (toDeviceId !== undefined) result.toDeviceId = toDeviceId
  return result
}

function rejectWithoutChange(schedule, command) {
  const before = clone(schedule)
  const result = wiring.applyScheduleChange(schedule, command)
  assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(command)}`)
  assert.deepEqual(result.schedule, before, 'rejected deletion returns an unchanged schedule')
  assert.deepEqual(schedule, before, 'rejected deletion does not mutate its input')
  return result
}

const linkedSchedule = {
  version: 1,
  revision: 13,
  nextNumber: 51,
  archiveNote: { importedFrom: 'old project', keep: true },
  devices: [
    { id: 'device-a', type: 'mixer', name: 'Console' },
    { id: 'device-b', type: 'mixer', name: 'Console' },
    { id: 'device-c', type: 'speaker', name: 'Speaker' },
    { id: 'device-d', type: 'mixer', name: 'Console' },
  ],
  lines: [
    line('line-cross', 'A007', 'device-a', 'device-b', { legacyNote: { preserve: 'cross' } }),
    line('line-self', 'A011', 'device-a', 'device-a', { legacyNote: { preserve: 'self' } }),
    line('line-independent', 'MANUAL-9', 'device-b', 'device-c', { legacyNote: { preserve: 'independent' } }),
    line('line-legacy', 'A003', undefined, undefined, { fromDevice: 'Console', legacyEndpoint: 'kept' }),
  ],
}

const linkedBefore = clone(linkedSchedule)
const removedDevice = wiring.applyScheduleChange(linkedSchedule, {
  type: 'delete-device',
  id: 'device-a',
  deleteConnectedLines: true,
  expectedLineIds: ['line-self', 'line-cross'],
})
assert.equal(removedDevice.ok, true, removedDevice.error)
assert.deepEqual(linkedSchedule, linkedBefore, 'successful deletion does not mutate the input')
assert.equal(removedDevice.schedule.revision, 14, 'device and lines are one revision')
assert.equal(removedDevice.schedule.nextNumber, 51, 'deletion never rewinds or advances the number allocator')
assert.deepEqual(removedDevice.deviceIds, ['device-a'])
assert.deepEqual(removedDevice.lineIds, ['line-cross', 'line-self'], 'a self-loop is reported once')
assert.deepEqual(removedDevice.schedule.devices.map((device) => device.id), ['device-b', 'device-c', 'device-d'])
assert.deepEqual(removedDevice.schedule.devices[0], linkedSchedule.devices[1], 'same-name device identity remains')
assert.deepEqual(removedDevice.schedule.lines.map((item) => item.id), ['line-independent', 'line-legacy'])
assert.equal(removedDevice.schedule.lines[0].code, 'MANUAL-9')
assert.deepEqual(removedDevice.schedule.lines[1], linkedSchedule.lines[3], 'legacy name endpoints remain')
assert.deepEqual(removedDevice.schedule.lines[0].legacyNote, { preserve: 'independent' })
assert.deepEqual(removedDevice.schedule.archiveNote, linkedSchedule.archiveNote, 'unknown schedule fields survive')

for (const command of [
  { type: 'delete-device', id: 'device-a', deleteConnectedLines: true },
  { type: 'delete-device', id: 'device-a', deleteConnectedLines: false, expectedLineIds: ['line-cross', 'line-self'] },
  { type: 'delete-device', id: 'device-a', deleteConnectedLines: true, expectedLineIds: ['line-cross'] },
  { type: 'delete-device', id: 'device-a', deleteConnectedLines: true, expectedLineIds: ['line-cross', 'line-self', 'line-independent'] },
  { type: 'delete-device', id: 'device-a', deleteConnectedLines: true, expectedLineIds: ['line-cross', 'line-self', 'line-self'] },
  { type: 'delete-device', id: 'device-a', deleteConnectedLines: true, expectedLineIds: ['line-self', 'line-cross'], extra: true },
  { type: 'delete-device', id: 'Console', deleteConnectedLines: true, expectedLineIds: ['line-cross', 'line-self'] },
  { type: 'delete-device', id: 'missing-device', deleteConnectedLines: false, expectedLineIds: [] },
  { type: 'delete-device', id: ' device-a ', deleteConnectedLines: true, expectedLineIds: ['line-cross', 'line-self'] },
]) rejectWithoutChange(linkedSchedule, command)

const paddedReference = clone(linkedSchedule)
paddedReference.lines[0].fromDeviceId = ' device-a '
rejectWithoutChange(paddedReference, {
  type: 'delete-device', id: 'device-a', deleteConnectedLines: true, expectedLineIds: ['line-cross', 'line-self'],
})

const unconnected = wiring.applyScheduleChange(linkedSchedule, {
  type: 'delete-device', id: 'device-d', deleteConnectedLines: false, expectedLineIds: [],
})
assert.equal(unconnected.ok, true, unconnected.error)
assert.equal(unconnected.schedule.revision, linkedSchedule.revision + 1)
assert.equal(unconnected.schedule.nextNumber, linkedSchedule.nextNumber)
assert.deepEqual(unconnected.schedule.lines, linkedSchedule.lines, 'an unconnected device leaves every line intact')
assert.deepEqual(unconnected.schedule.devices.map((device) => device.id), ['device-a', 'device-b', 'device-c'])
assert.deepEqual(unconnected.lineIds, [])
rejectWithoutChange(unconnected.schedule, {
  type: 'delete-device', id: 'device-d', deleteConnectedLines: false, expectedLineIds: [],
})

const legacySchedule = {
  version: 1,
  revision: 4,
  nextNumber: 22,
  devices: [{ id: 'real-device', type: 'mixer', name: 'Console' }],
  lines: [
    line('legacy-a', 'A002', undefined, undefined, { fromDevice: 'Legacy Console', toDevice: 'Legacy Speaker' }),
    line('legacy-b', 'A008', undefined, undefined, { fromDevice: 'Other legacy device', toDevice: 'Legacy Speaker' }),
    line('real-bound', 'A010', 'real-device', undefined),
  ],
}
const legacyBefore = clone(legacySchedule)
const removedLegacyLines = wiring.applyScheduleChange(legacySchedule, { type: 'delete-lines', ids: ['legacy-a'] })
assert.equal(removedLegacyLines.ok, true, removedLegacyLines.error)
assert.deepEqual(legacySchedule, legacyBefore)
assert.equal(removedLegacyLines.schedule.revision, 5)
assert.equal(removedLegacyLines.schedule.nextNumber, 22)
assert.deepEqual(removedLegacyLines.schedule.devices, legacySchedule.devices)
assert.deepEqual(removedLegacyLines.schedule.lines.map((item) => item.id), ['legacy-b', 'real-bound'])
assert.deepEqual(removedLegacyLines.lineIds, ['legacy-a'])
rejectWithoutChange(legacySchedule, {
  type: 'delete-device', id: 'Legacy Console', deleteConnectedLines: true, expectedLineIds: ['legacy-a'],
})
rejectWithoutChange(removedLegacyLines.schedule, { type: 'delete-lines', ids: ['legacy-a'] })

for (const command of [
  { type: 'delete-lines', ids: [] },
  { type: 'delete-lines', ids: ['legacy-a', 'legacy-a'] },
  { type: 'delete-lines', ids: ['missing-line'] },
  { type: 'delete-lines', ids: ['legacy-a'], extra: true },
  { type: 'delete-lines' },
]) rejectWithoutChange(legacySchedule, command)

const fullSchedule = {
  version: 1,
  revision: 90,
  nextNumber: 900,
  lines: Array.from({ length: wiring.MAX_LINES }, (_, index) => line(
    `line-${index + 1}`, `C${index + 1}`, undefined, undefined,
  )),
}
const fullBefore = clone(fullSchedule)
const removedAll = wiring.applyScheduleChange(fullSchedule, {
  type: 'delete-lines', ids: fullSchedule.lines.map((item) => item.id),
})
assert.equal(removedAll.ok, true, removedAll.error)
assert.deepEqual(fullSchedule, fullBefore)
assert.equal(removedAll.schedule.lines.length, 0)
assert.equal(removedAll.schedule.revision, 91)
assert.equal(removedAll.schedule.nextNumber, 900)
rejectWithoutChange(fullSchedule, {
  type: 'delete-lines', ids: Array.from({ length: wiring.MAX_LINES + 1 }, (_, index) => `line-${index + 1}`),
})

console.log('project wiring deletion model test passed')

'use strict'

const assert = require('node:assert/strict')
const { buildProjectContentView } = require('../../pages/records/project-view-model')

const projectId = 'project-stable-a'
const otherProjectId = 'project-stable-b'
const records = [
  { id: 'record-a', module: 'limiter', projectIds: [projectId], title: '主扩限幅方案', summary: '阈值 -3 dB', preferences: { threshold: -3 } },
  { id: 'record-b', module: 'camera', projectIds: [projectId], title: '机位视场', summary: '远端覆盖', preferences: { tilt: 12 } },
  { id: 'record-other', module: 'limiter', projectIds: [otherProjectId], title: '不可见项目的记录', summary: '不能搜索到' },
]
const wiringSchedule = {
  lines: [
    { id: 'line-stable', code: 'A021', fromDevice: '调音台', fromPort: 'OUT-01', toDevice: '功放', toPort: 'IN-01', lengthText: '18', spec: '2×2.5 mm²', status: 'checked' },
  ],
}
const lightingFixtures = [
  { stableId: 'fixture-stable', groupName: '舞台面光', fixtureIndex: 2, fixtureModel: '面光灯', universeLabel: 'A', addressText: 'A:0013', rangeText: 'A:0013–A:0024' },
]
const immutableSnapshot = JSON.stringify({ records, wiringSchedule, lightingFixtures })

const all = buildProjectContentView({ projectId, records, wiringSchedule, lightingFixtures })
assert.deepEqual(all.visibleRecords.map(({ id }) => id), ['record-a', 'record-b'])
assert.equal(all.visibleWiringLines.length, 1)
assert.equal(all.visibleWiringLines[0].endpointSummary, '调音台 · OUT-01 → 功放 · IN-01')
assert.equal(all.visibleLightingFixtures[0].addressSummary, '域 A · A:0013–A:0024')
assert.equal(all.visibleCount, 4)

const calculations = buildProjectContentView({ projectId, records, wiringSchedule, lightingFixtures, filter: 'calculations' })
assert.deepEqual(calculations.visibleRecords.map(({ id }) => id), ['record-a', 'record-b'])
assert.equal(calculations.visibleWiringLines.length, 0)
assert.equal(calculations.visibleLightingFixtures.length, 0)

const searchRecord = buildProjectContentView({ projectId, records, wiringSchedule, lightingFixtures, filter: 'calculations', searchText: '阈值 -3' })
assert.deepEqual(searchRecord.visibleRecords.map(({ id }) => id), ['record-a'])
assert.equal(searchRecord.isSearchEmpty, false)

const searchWiring = buildProjectContentView({ projectId, records, wiringSchedule, lightingFixtures, filter: 'wiring', searchText: 'OUT-01' })
assert.deepEqual(searchWiring.visibleWiringLines.map(({ id }) => id), ['line-stable'])
assert.equal(searchWiring.visibleRecords.length, 0)

const searchLighting = buildProjectContentView({ projectId, records, wiringSchedule, lightingFixtures, filter: 'lighting', searchText: 'A:0013' })
assert.deepEqual(searchLighting.visibleLightingFixtures.map(({ stableId }) => stableId), ['fixture-stable'])

const noCrossProjectLeak = buildProjectContentView({ projectId, records, searchText: '不可见项目的记录' })
assert.equal(noCrossProjectLeak.visibleCount, 0)
assert.equal(noCrossProjectLeak.isSearchEmpty, true)

const emptyFilter = buildProjectContentView({ projectId, records, filter: 'wiring' })
assert.equal(emptyFilter.isTypeEmpty, true)
assert.equal(JSON.stringify({ records, wiringSchedule, lightingFixtures }), immutableSnapshot, 'view building must not mutate stored content')

console.log('project interior view model passed (stable project scope, composed search and filters, actual line/fixture fields, no mutation)')

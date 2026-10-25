const assert = require('node:assert/strict')
const {
  buildReportPayload,
  getProjectReportSections,
  loadProjectReportSource,
  readLightingProjectContext,
} = require('../pages/records/report-model')
const { calculateScheme, WORKSPACE_KEY } = require('../pages/dmx-layout/lighting-workspace')

const projectId = 'report-empty-lighting-a'
const otherProjectId = 'report-empty-lighting-b'

function makeEmptyEntry(revision, layout = null) {
  return {
    revision,
    scheme: {
      version: 2,
      preferences: { startAddressText: '1', allocationMode: 'auto', groupSummary: '', groups: [] },
      groupIds: [],
      fixtureIdsByGroup: {},
      checksById: {},
      layout,
    },
  }
}

function makeFixtureEntry(project, fixtureId) {
  const groupId = `group-${project}`
  return {
    revision: 4,
    scheme: {
      version: 2,
      preferences: {
        startAddressText: '1',
        allocationMode: 'auto',
        groupSummary: '临时灯具 × 1',
        groups: [{
          name: '临时灯具',
          fixtureModel: '',
          fixtureSource: 'custom',
          fixtureCount: 1,
          channelCount: 6,
          targetUniverse: 'A',
        }],
      },
      groupIds: [groupId],
      fixtureIdsByGroup: { [groupId]: [fixtureId] },
      checksById: {},
      layout: { positionsById: {} },
    },
  }
}

function read(project, contexts) {
  return readLightingProjectContext(project, {
    getStorage: (key) => {
      assert.equal(key, WORKSPACE_KEY)
      return { version: 1, contexts }
    },
    calculateScheme,
  })
}

function reportSections(lighting) {
  return getProjectReportSections({
    ok: true,
    project: { id: projectId, name: '测试项目' },
    records: [],
    schedule: { devices: [], lines: [] },
    lighting,
  })
}

for (const [label, emptyEntry] of [
  ['revision>0 empty scheme', makeEmptyEntry(3)],
  ['empty layout', makeEmptyEntry(5, { positionsById: {} })],
  ['all fixtures deleted with stale layout positions', makeEmptyEntry(8, {
    positionsById: { 'deleted-fixture': { x: 0.5, y: 0.5 } },
  })],
]) {
  const result = read(projectId, { [projectId]: emptyEntry })
  assert.equal(result.ok, true, `${label}: ${result.error || ''}`)
  assert.equal(result.lighting, null, `${label} must not create a lighting candidate`)
  assert(!reportSections(result.lighting).some((section) => section.key === 'lighting'),
    `${label} must not add a lighting section or report page`)
}

const unplaced = read(projectId, { [projectId]: makeFixtureEntry(projectId, 'fixture-unplaced') })
assert.equal(unplaced.ok, true, unplaced.error)
assert.equal(unplaced.lighting.fixtures.length, 1, 'a real fixture remains reportable before placement')
assert.equal(unplaced.lighting.fixtures[0].stableId, 'fixture-unplaced')
assert.equal(unplaced.lighting.fixtures[0].position, null, 'unplaced fixtures keep their empty position')
assert.equal(reportSections(unplaced.lighting).find((section) => section.key === 'lighting').items.length, 1)

const isolated = read(projectId, {
  [otherProjectId]: makeFixtureEntry(otherProjectId, 'fixture-other-project'),
})
assert.equal(isolated.ok, true, isolated.error)
assert.equal(isolated.lighting, null, 'another project lighting context must not leak into this report')
assert(!reportSections(isolated.lighting).some((section) => section.key === 'lighting'))

const invalidEmpty = makeEmptyEntry(-1)
const invalid = read(projectId, { [projectId]: invalidEmpty })
assert.equal(invalid.ok, false, 'empty content must not suppress invalid-entry checks')

const project = { id: projectId, name: '单线路项目', venueName: '', projectDate: '', engineer: '' }
const schedule = {
  version: 1,
  revision: 2,
  nextNumber: 2,
  devices: [],
  lines: [{
    id: 'line-1',
    code: 'L1',
    fromDevice: '调光台',
    toDevice: '调光柜',
    spec: 'DMX512',
    lengthText: '12',
  }],
}
const recordsApi = {
  getWorkspaceSnapshot: () => ({ ok: true, projects: [project], records: [] }),
  getProjectWiring: () => ({ ok: true, schedule }),
  getProjectRecordView: (record) => record,
}
const emptyWorkspaceContexts = { [projectId]: makeEmptyEntry(12, { positionsById: {} }) }
const contextBeforeRead = JSON.stringify(emptyWorkspaceContexts)
function loadWithContexts(contexts) {
  return loadProjectReportSource(projectId, {
    recordsApi,
    lightingOptions: {
      getStorage: (key) => {
        assert.equal(key, WORKSPACE_KEY)
        return { version: 1, contexts }
      },
      calculateScheme,
    },
  })
}
const noLightingSource = loadWithContexts({})
const emptyWorkspaceSource = loadWithContexts(emptyWorkspaceContexts)
assert.equal(noLightingSource.ok, true, noLightingSource.error)
assert.equal(emptyWorkspaceSource.ok, true, emptyWorkspaceSource.error)
assert.equal(emptyWorkspaceSource.lighting, null)
assert.equal(JSON.stringify(emptyWorkspaceContexts), contextBeforeRead, 'report loading must not mutate lighting storage')

const selectedIds = ['line:line-1', `lighting:${projectId}`]
const baselinePayload = buildReportPayload(noLightingSource, selectedIds)
const emptyWorkspacePayload = buildReportPayload(emptyWorkspaceSource, selectedIds)
assert.deepEqual(emptyWorkspacePayload.selectedItems, baselinePayload.selectedItems,
  'a stale lighting candidate id must not add an item to a line-only report')
assert.deepEqual(emptyWorkspacePayload.selectedTypes, baselinePayload.selectedTypes)
assert.equal(emptyWorkspacePayload.pages.length, baselinePayload.pages.length,
  'an empty lighting workspace must not add report pages')
function pagesWithoutGenerationTimestamp(pages) {
  const stablePages = JSON.parse(JSON.stringify(pages))
  stablePages.forEach((page) => {
    if (page.header) delete page.header.generatedAt
  })
  return stablePages
}
assert.deepEqual(pagesWithoutGenerationTimestamp(emptyWorkspacePayload.pages),
  pagesWithoutGenerationTimestamp(baselinePayload.pages),
  'an empty lighting workspace must not change report page content, size, or order')
assert.deepEqual(emptyWorkspacePayload.selectedIds, ['line:line-1'])

console.log('Empty project lighting report regression passed (selection, pagination, storage immutability, deletion, unplaced fixtures, and project isolation).')

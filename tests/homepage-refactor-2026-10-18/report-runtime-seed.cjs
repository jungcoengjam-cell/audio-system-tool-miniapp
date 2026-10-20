const assert = require('node:assert/strict')
const seed = require('./qa-seed-report.cjs')
const {
  getProjectReportSections,
  loadProjectReportSource,
} = require('../../pages/records/report-model')
const { WORKSPACE_KEY } = require('../../pages/dmx-layout/lighting-workspace')

let storage = {}
let canvasContextCalls = 0
global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => { storage[key] = value },
  removeStorageSync: (key) => { delete storage[key] },
  getWindowInfo: () => ({ statusBarHeight: 24, windowWidth: 360 }),
  getMenuButtonBoundingClientRect: () => ({ top: 28, height: 28, left: 236 }),
  createCanvasContext: () => { canvasContextCalls += 1; return {} },
  canvasToTempFilePath: () => {},
  showToast: () => {},
  showShareImageMenu: () => {},
}

for (const schemaVersion of [3, 4]) {
  storage = seed.createReportQaStorage(schemaVersion)
  const loaded = loadProjectReportSource(seed.projectId)
  assert.equal(loaded.ok, true, loaded.error)
  assert.equal(loaded.records.length, 15, `schema ${schemaVersion} must load all 15 project records`)
  assert.equal(loaded.schedule.lines.length, 2)
  assert.equal(loaded.lighting.fixtures.length, 2)
  assert.equal(getProjectReportSections(loaded).reduce((count, section) => count + section.items.length, 0), 18)
  assert.equal(loaded.schedule.lines[0].fromPort, 'OUT 1')
  assert.equal(loaded.schedule.lines[0].toPort, 'IN L')
  assert.equal(loaded.lighting.fixtures[0].stableId, 'fixture-report-a-01')
  assert.equal(loaded.lighting.fixtures[0].position.x, 0.28)
  assert.equal(storage[WORKSPACE_KEY].contexts[seed.otherProjectId].revision, 1)
  if (schemaVersion === 3) assert.equal(storage['audioTool.storageSchemaVersion'], 4, 'schema 3 migration should produce a readable schema 4 snapshot')
}

let reportPageDefinition
global.Page = (definition) => { reportPageDefinition = definition }
require('../../pages/records/report')

function makePage() {
  const page = Object.create(reportPageDefinition)
  page.data = JSON.parse(JSON.stringify(reportPageDefinition.data))
  page.setData = (changes, callback) => {
    page.data = { ...page.data, ...changes }
    if (typeof callback === 'function') callback()
  }
  return page
}

function seedFreshStorage() {
  storage = seed.createReportQaStorage(4)
  canvasContextCalls = 0
}

seedFreshStorage()
const changedPage = makePage()
changedPage.onLoad({ id: seed.projectId })
assert.equal(changedPage.data.selectedCount, 18)
const selectedBeforeChange = [...changedPage.data.selectedItemIds]
storage['audioTool.records.v1'] = storage['audioTool.records.v1'].map((record, index) => (
  index === 0 ? { ...record, resultText: `${record.resultText}\n外部页面更新后的完整结果。` } : record
))
changedPage.generateReport()
assert.equal(changedPage.data.mode, 'select', 'source edits must require a new confirmation before rendering')
assert.deepEqual(changedPage.data.selectedItemIds, selectedBeforeChange, 'still-valid selections must survive a source edit')
assert.match(changedPage.data.pageStatus, /项目内容有变化/)
assert.equal(canvasContextCalls, 0, 'stale data must not be rendered after a source edit')

seedFreshStorage()
const deletedItemPage = makePage()
deletedItemPage.onLoad({ id: seed.projectId })
const deletedItemId = deletedItemPage.data.selectedItemIds[0]
storage['audioTool.records.v1'] = storage['audioTool.records.v1'].filter((record) => `record:${record.id}` !== deletedItemId)
deletedItemPage.generateReport()
assert.equal(deletedItemPage.data.mode, 'select', 'deleted selections must require candidate review before rendering')
assert(!deletedItemPage.data.selectedItemIds.includes(deletedItemId), 'deleted records must be removed from the retained selection')
assert.equal(deletedItemPage.data.selectedCount, 17)
assert.match(deletedItemPage.data.pageStatus, /已移除无法找到的内容/)
assert.equal(canvasContextCalls, 0)

seedFreshStorage()
const deletedProjectPage = makePage()
deletedProjectPage.onLoad({ id: seed.projectId })
storage['audioTool.projects.v1'] = storage['audioTool.projects.v1'].filter((project) => project.id !== seed.projectId)
deletedProjectPage.generateReport()
assert.equal(deletedProjectPage.reportSource, null, 'deleted projects must be refused before rendering')
assert.match(deletedProjectPage.data.pageError, /不存在或已删除/)
assert.equal(canvasContextCalls, 0)

console.log('Project report real-storage seed checks passed (schema 3/4, 18 items, content refresh, item deletion, project deletion).')

const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const count = Number(process.argv[2]) || 35
const storage = new Map([['audioTool.storageSchemaVersion', 3]])
let page
global.wx = {
  getStorageSync: (key) => structuredClone(storage.get(key)),
  setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
  getStorageInfoSync: () => ({ currentSize: 1, limitSize: 10240 }),
  setNavigationBarTitle: () => {},
}
global.Page = (definition) => {
  page = { ...definition, data: structuredClone(definition.data), setData(patch, callback) {
    this.lastPatch = patch
    Object.assign(this.data, patch)
    callback?.()
  } }
}
const records = require(path.join(root, 'utils/records'))
require(path.join(root, 'pages/dmx-address/dmx-address'))
const dmxPage = page
const { calculateDmxAddressPlan } = require(path.join(root, 'utils/dmx-address'))
const project = records.createProject('Payload audit')
for (let index = 0; index < count; index += 1) {
  const preferences = { startAddress: index + 1, groups: [
    { name: 'Front', channelCount: 1, fixtureCount: 200 },
    { name: 'Back', channelCount: 1, fixtureCount: 200 },
    { name: 'Side', channelCount: 1, fixtureCount: 100 },
  ] }
  const result = calculateDmxAddressPlan(preferences)
  if (result.error) throw new Error(result.error)
  dmxPage._calculationResult = { ...result, valid: true }
  const payload = { module: 'dmxAddress', preferences,
    title: '500 fixtures plan ' + index, summary: result.startText + ' - ' + result.endText,
    resultText: dmxPage.getResultText(),
  }
  if (!records.addRecordToProject(payload, project.id)) throw new Error('addRecordToProject failed')
  if (!records.saveFavoriteSnapshot(payload)) throw new Error('saveFavoriteSnapshot failed')
}
const bytes = (value) => Buffer.byteLength(JSON.stringify(value))
const storedBytes = bytes(records.getRecords())
require(path.join(root, 'pages/records/project'))
page.onLoad({ id: project.id })
const projectRecords = records.getProjectRecords(project.id)
const groupedProjectRecordCount = page.data.recordGroups
  .reduce((total, group) => total + (Array.isArray(group.records) ? group.records.length : 0), 0)
if (projectRecords.length !== count
  || page.data.project?.recordCount !== count
  || page.data.records.length !== count
  || groupedProjectRecordCount !== count) {
  throw new Error(`Project record fixture is incomplete: ${projectRecords.length}/${page.data.records.length}/${groupedProjectRecordCount}/${count}`)
}
const projectViewBytes = bytes(page.lastPatch)
const reportModel = require(path.join(root, 'pages/records/report-model'))
const reportSource = reportModel.loadProjectReportSource(project.id)
if (!reportSource.ok) throw new Error(`Project PDF report source failed: ${reportSource.error}`)
const reportSections = reportModel.getProjectReportSections(reportSource)
const reportIds = reportSections.flatMap((section) => section.items.map((item) => item.id))
const reportPayload = reportModel.buildReportPayload(reportSource, reportIds)
if (!reportPayload || reportPayload.selectedItems.length !== count) {
  throw new Error(`Project PDF report is incomplete: ${reportPayload?.selectedItems.length || 0}/${count}`)
}
const expectedResults = new Map(projectRecords.map((record) => [record.id, record.resultText]))
if (reportPayload.selectedItems.some((item) => expectedResults.get(item.record.id) !== item.record.resultText)) {
  throw new Error('Project PDF report snapshot changed a complete saved result')
}
const completeResultText = reportPayload.selectedItems.map((item) => item.record.resultText).join('\n')
if (!completeResultText.includes('500') || !completeResultText.includes('#200')) {
  throw new Error('Project PDF report snapshot is missing full DMX result content')
}
const pdfReportText = reportPayload.pages.flatMap((reportPage) => reportPage.lines)
  .map((line) => line.text).join('\n')
require(path.join(root, 'pages/projects/projects'))
page.onShow()
const projectIndex = page.data.projects.find((item) => item.id === project.id)
const favoriteCount = records.getFavorites().length
if (favoriteCount !== count || page.data.favorites.length !== count
  || page._allFavorites.length !== count || projectIndex?.recordCount !== count) {
  throw new Error(`Favorite/project index fixture is incomplete: ${favoriteCount}/${page.data.favorites.length}/${projectIndex?.recordCount}/${count}`)
}
console.log(JSON.stringify({ records: count, fixturesPerRecord: 500, storedBytes,
  projectRecordCount: projectRecords.length, groupedProjectRecordCount,
  favoriteCount, projectIndexRecordCount: projectIndex.recordCount,
  projectViewBytes, favoritesViewBytes: bytes(page.lastPatch), pdfReportTextBytes: Buffer.byteLength(pdfReportText) }))

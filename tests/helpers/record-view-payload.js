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
  if (!records.saveRecord({ module: 'dmxAddress', preferences,
    title: `500 fixtures plan ${index}`, summary: `${result.startText} - ${result.endText}`,
    resultText: dmxPage.getResultText(),
  }, { favorite: true, projectId: project.id })) throw new Error('saveRecord failed')
}
const bytes = (value) => Buffer.byteLength(JSON.stringify(value))
const storedBytes = bytes(records.getRecords())
require(path.join(root, 'pages/records/project'))
page.onLoad({ id: project.id })
const projectViewBytes = bytes(page.lastPatch)
const clipboard = page.getProjectReportText()
if (!clipboard.includes('500') || !clipboard.includes('#200')) throw new Error('Full report content is missing')
require(path.join(root, 'pages/projects/projects'))
page.onShow()
console.log(JSON.stringify({ records: count, fixturesPerRecord: 500, storedBytes,
  projectViewBytes, favoritesViewBytes: bytes(page.lastPatch), textReportBytes: Buffer.byteLength(clipboard) }))

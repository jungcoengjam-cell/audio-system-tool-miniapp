const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  PREFERENCE_LABELS_BY_MODULE,
  REPORT_MAX_PAGE_HEIGHT,
  buildReportPayload,
  formatPreferenceRows,
  graphemeClusters,
  getProjectReportSections,
  loadProjectReportSource,
  readLightingProjectContext,
  safeCharacterWidth,
  wrapText,
} = require('../../pages/records/report-model')
const reportPageConfig = require('../../pages/records/report.json')
const { calculateScheme, WORKSPACE_KEY } = require('../../pages/dmx-layout/lighting-workspace')

const projectId = 'project-report-a'
const otherProjectId = 'project-report-b'
const longTitle = `长方案名称-${'完整名称'.repeat(40)}`
const longNote = `现场备注保留全文。${'逐页检查地址、设备端口与施工说明；'.repeat(310)}`
const longResult = `完整计算结果：${'实际参数、公式代入和结果说明均须保留。\n'.repeat(185)}`

function fixturePreferences(groupName, fixtureCount) {
  return {
    startAddressText: '1',
    allocationMode: 'auto',
    groupSummary: `${groupName} × ${fixtureCount}`,
    groups: [{
      name: groupName,
      fixtureModel: '',
      fixtureSource: 'custom',
      fixtureCount,
      channelCount: 6,
      targetUniverse: 'A',
    }],
  }
}

function makeLightingEntry(projectIdValue, revision, groupId, fixtureId, groupName) {
  const scheme = {
    version: 2,
    preferences: fixturePreferences(groupName, 1),
    groupIds: [groupId],
    fixtureIdsByGroup: { [groupId]: [fixtureId] },
    checksById: {},
    layout: { positionsById: { [fixtureId]: { x: 0.375, y: 0.62, zone: 'front', row: 2, column: 4 } } },
  }
  return { revision, scheme, projectId: projectIdValue }
}

const records = Array.from({ length: 14 }, (_, index) => ({
  id: `record-${String(index + 1).padStart(2, '0')}`,
  module: 'limiter',
  title: index === 0 ? longTitle : `限幅方案 ${index + 1}`,
  summary: `阈值 ${index + 1} dBFS`,
  preferences: { amplifierModel: `功放 ${index + 1}`, count: index + 1, highPassFrequency: 35 },
  resultText: longResult,
  createdAt: 1760000000000 + index,
  updatedAt: 1760000000000 + index,
  projectIds: [projectId],
  projectMetadata: { [projectId]: { name: index === 0 ? longTitle : `方案 ${index + 1}`, note: index === 0 ? longNote : '' } },
}))
records.push({
  id: 'record-other-project', module: 'limiter', title: '另一项目记录', summary: '不得导入',
  preferences: { amplifierModel: '外部功放' }, resultText: '外部结果不得导入', projectIds: [otherProjectId],
})

const projects = [
  { id: projectId, name: '测试报告项目', venueName: '一号场地', engineer: '工程师甲', projectDate: '2026-10-18', notes: longNote, roomLengthText: '12', roomWidthText: '8', roomHeightText: '4', standardClassKey: 'conference', gradeKey: 'II' },
  { id: otherProjectId, name: '另一项目', venueName: '', engineer: '', projectDate: '2026-10-17', notes: '' },
]

const ledScreenRecord = {
  id: 'record-led-screen', module: 'ledScreen', title: 'LED 拼装核对', summary: '墙体 6 × 3 m',
  preferences: {
    wallWidthText: '6', wallHeightText: '3', frameWidthText: '5', viewingDistanceText: '4',
    aspectRatio: '16:9', unitKey: 'module', pitch: 'recommended',
  },
  resultText: '四周包边：5 cm；拼装单元：320 × 160 mm', createdAt: 1760000000100,
  projectIds: [projectId],
}

const devices = [
  { id: 'device-mixer-a', type: 'mixer', name: '调音台 A', autoName: false },
  { id: 'device-processor-a', type: 'processor', name: '处理器 A', autoName: false },
]
const schedule = {
  version: 1,
  revision: 3,
  nextNumber: 4,
  devices,
  lines: [
    {
      id: 'line-stable-01', code: 'A001', purpose: '主扩左声道',
      fromDevice: '调音台 A', fromDeviceId: 'device-mixer-a', fromPort: 'OUT 1',
      toDevice: '处理器 A', toDeviceId: 'device-processor-a', toPort: 'IN L',
      cableType: 'balanced', buildType: 'finished', spec: '2 × 0.5 mm²',
      connectorA: 'xlrMale', connectorB: 'xlrFemale', lengthText: '18.5', status: 'checked', notes: longNote,
    },
    {
      id: 'line-stable-02', code: 'A002', purpose: '主扩右声道',
      fromDevice: '调音台 A', fromDeviceId: 'device-mixer-a', fromPort: 'OUT 2',
      toDevice: '处理器 A', toDeviceId: 'device-processor-a', toPort: 'IN R',
      cableType: 'balanced', buildType: 'bulk', spec: '2 × 0.5 mm²',
      connectorA: 'xlrMale', connectorB: 'xlrFemale', lengthText: '20', status: 'connected', notes: '',
    },
  ],
}

const lightingEnvelope = {
  version: 1,
  contexts: {
    [projectId]: makeLightingEntry(projectId, 7, 'group-stable-a', 'fixture-stable-a', '舞台灯位 A'),
    [otherProjectId]: makeLightingEntry(otherProjectId, 9, 'group-stable-b', 'fixture-stable-b', '外部灯位 B'),
  },
}

const recordsApi = {
  getWorkspaceSnapshot: () => ({ ok: true, projects, records }),
  getProjectRecordView: (record, id) => {
    const meta = record.projectMetadata?.[id]
    return {
      ...record,
      title: meta?.name || record.title,
      projectNote: meta?.note || '',
      hasProjectMetadata: Boolean(meta?.name),
    }
  },
  getProjectWiring: (id) => {
    assert.equal(id, projectId, 'wiring must be read by the requested project ID')
    return { ok: true, project: { id, name: projects[0].name }, schedule }
  },
}

const loaded = loadProjectReportSource(projectId, {
  recordsApi,
  lightingOptions: {
    getStorage: (key) => {
      assert.equal(key, WORKSPACE_KEY)
      return lightingEnvelope
    },
    calculateScheme,
  },
})
assert.equal(loaded.ok, true, loaded.error)
assert.equal(loaded.records.length, 14, 'all 14 project records must be loaded')
assert(!loaded.records.some((record) => record.id === 'record-other-project'), 'records from another project leaked in')
assert.equal(loaded.lighting.fixtures.length, 1)
assert.equal(loaded.lighting.fixtures[0].stableId, 'fixture-stable-a')
assert.deepEqual(loaded.lighting.fixtures[0].position, { x: 0.375, y: 0.62, zone: 'front', row: 2, column: 4 })

const sourceWithLedScreenRecord = { ...loaded, records: [...loaded.records, ledScreenRecord] }
const sections = getProjectReportSections(sourceWithLedScreenRecord)
assert.equal(sections.find((section) => section.key === 'calculation').items.length, 15)
assert.equal(sections.find((section) => section.key === 'wiring').items.length, 2)
assert.equal(sections.find((section) => section.key === 'lighting').items.length, 1)
const selectedIds = sections.flatMap((section) => section.items.map((item) => item.id))
const payload = buildReportPayload(sourceWithLedScreenRecord, selectedIds)
assert.equal(payload.itemCount, 18, 'record, line, and lighting counts must all be included')
assert.equal(payload.selectedIds.length, 18)
assert(payload.pages.length > 1, 'long text and more than 12 records should paginate')
assert(payload.pages.every((page) => page.height <= REPORT_MAX_PAGE_HEIGHT), 'page height must stay within the renderer cap')

const reportText = payload.pages.flatMap((page) => page.lines).map((line) => line.text).join('')
assert(reportText.includes(longTitle), 'long project configuration names must be kept')
assert(reportText.includes(longNote), 'long notes must be kept in full')
assert(!reportText.includes(longResult.replace(/\r\n|\r|\n/g, '')), 'the main report must show key results instead of duplicating long tool output')
const completeSavedRecord = payload.selectedItems.find((item) => item.type === 'calculation' && item.record.id === 'record-01')
assert.equal(completeSavedRecord.record.resultText, longResult, 'the frozen selected snapshot must retain all original resultText')
assert.equal(completeSavedRecord.record.preferences.count, 1, 'the frozen selected snapshot must retain original input parameters')
assert(reportText.includes('阈值 1 dBFS'), 'the concise main report must retain the key result summary')
assert(reportText.includes('输入灵敏度') === false, 'unrelated preference labels must not be fabricated')
assert(reportText.includes('功放型号：功放 1'), 'mapped Chinese parameter labels must be rendered')
assert(reportText.includes('四周包边（cm/每边）：5'), 'LED frameWidthText must retain its centimeter-per-side meaning')
assert(reportText.includes('拼装单元：module'), 'LED unitKey must be labeled as an assembly unit, not a size unit')
assert.equal(PREFERENCE_LABELS_BY_MODULE.limiter.mode, '限幅器工作模式')
assert.equal(PREFERENCE_LABELS_BY_MODULE.cable.mode, '线材选型方式', 'same preference key must use module-specific semantics')
assert.deepEqual(formatPreferenceRows({ frameWidthText: '5', unitKey: 'module' }, 'ledScreen'), [
  { label: '四周包边（cm/每边）', value: '5' },
  { label: '拼装单元', value: 'module' },
])
assert(reportText.includes('来源设备：调音台 A · 端口：OUT 1 · 设备编号：device-mixer-a'))
assert(reportText.includes('去向设备：处理器 A · 端口：IN L · 设备编号：device-processor-a'))
assert(reportText.includes('XLR 公头（xlrMale）'))
assert(reportText.includes('施工状态：已核对'))
assert(reportText.includes('fixture-stable-a'))
assert(reportText.includes('A001'))
assert(reportText.includes('"x":0.375'))
assert(!reportText.includes('fixture-stable-b'), 'lighting from another project must not appear')
assert(!reportText.includes('record-other-project'), 'another project record must not appear')

const longWideGlyphs = wrapText('W'.repeat(50), 18)
assert(longWideGlyphs.length > 1, 'wide Latin glyphs must wrap before the content edge')
assert(longWideGlyphs.every((line) => graphemeClusters(line).reduce((width, character) => width + safeCharacterWidth(character, 18), 0) <= 654), 'estimated line width must stay within the printable content area')
const longMixedGlyphs = wrapText(`${'W'.repeat(25)}${'M'.repeat(25)}`, 18)
assert(longMixedGlyphs.length > 1, 'wide W and M runs must wrap before the content edge')
assert(longMixedGlyphs.every((line) => graphemeClusters(line).reduce((width, character) => width + safeCharacterWidth(character, 18), 0) <= 654))
const familyEmoji = '👨‍👩‍👧‍👦'
const emojiLines = wrapText(`A${familyEmoji}B`, 18, 40)
assert(emojiLines.includes(familyEmoji), 'emoji joiner sequences must stay together when wrapping')
assert(emojiLines.every((line) => graphemeClusters(line).reduce((width, character) => width + safeCharacterWidth(character, 18), 0) <= 40), 'emoji wrapping must respect conservative line width')
assert(payload.pages.flatMap((page) => page.lines).every((line) => (
  graphemeClusters(line.text).reduce((width, character) => width + safeCharacterWidth(character, line.size), 0) <= 654
)), 'every report text line must fit inside the printable width')

assert.equal(reportPageConfig.navigationBarTitleText, '项目报告', 'report title should use the native navigation bar')
const reportWxml = fs.readFileSync(path.join(__dirname, '../../pages/records/report.wxml'), 'utf8')
assert(!reportWxml.includes('report-nav'), 'custom navigation must not duplicate the native status and title bars')

const missingStableIdentity = makeLightingEntry(projectId, 2, 'group-stable-c', '', '缺 ID 组')
let calculateCalled = false
const missingIdResult = readLightingProjectContext(projectId, {
  getStorage: () => ({ version: 1, contexts: { [projectId]: missingStableIdentity } }),
  calculateScheme: () => { calculateCalled = true; return { ok: true, valid: true, result: { fixtures: [] } } },
})
assert.equal(missingIdResult.ok, false)
assert.equal(calculateCalled, false, 'malformed identities must be rejected before calculating')

const duplicateFixtureId = makeLightingEntry(projectId, 3, 'group-duplicate', 'fixture-duplicate', '重复灯位组')
duplicateFixtureId.scheme.preferences.groups[0].fixtureCount = 2
duplicateFixtureId.scheme.fixtureIdsByGroup['group-duplicate'] = ['fixture-duplicate', 'fixture-duplicate']
const duplicateIdResult = readLightingProjectContext(projectId, {
  getStorage: () => ({ version: 1, contexts: { [projectId]: duplicateFixtureId } }),
  calculateScheme: () => { calculateCalled = true; return { ok: true, valid: true, result: { fixtures: [] } } },
})
assert.equal(duplicateIdResult.ok, false)
assert.equal(calculateCalled, false, 'duplicate fixture IDs must be rejected before calculating')

const duplicateOutputResult = readLightingProjectContext(projectId, {
  getStorage: () => ({ version: 1, contexts: { [projectId]: makeLightingEntry(projectId, 3, 'group-output', 'fixture-output', '重复计算输出') } }),
  calculateScheme: () => ({ ok: true, valid: true, result: { fixtures: [
    { stableId: 'fixture-output', fixtureIndex: 1, addressText: '001', rangeText: '001-006', channelCount: 6 },
    { stableId: 'fixture-output', fixtureIndex: 2, addressText: '007', rangeText: '007-012', channelCount: 6 },
  ] } }),
})
assert.equal(duplicateOutputResult.ok, false, 'calculated addresses must map one-to-one to saved fixture IDs')

let reportPageMethods
const sharedPdfs = []
global.Page = (definition) => { reportPageMethods = definition }
global.wx = {
  shareFileMessage: ({ filePath, fileName }) => sharedPdfs.push({ filePath, fileName }),
  showToast: () => {},
}
require('../../pages/records/report')
function makeReportPage(state) {
  const page = Object.create(reportPageMethods)
  page.data = state
  page.setData = (changes) => { page.data = { ...page.data, ...changes } }
  return page
}
const sharePage = makeReportPage({ currentPageIndex: 0 })
sharePage.reportSignature = 'pdf-signature'
sharePage._reportPdfPath = '/user/project-report.pdf'
sharePage._reportPdfSignature = 'pdf-signature'
sharePage.shareReportPdf()
sharePage.data.currentPageIndex = 2
sharePage.shareReportPdf()
assert.deepEqual(sharedPdfs, [
  { filePath: '/user/project-report.pdf', fileName: 'project-report.pdf' },
  { filePath: '/user/project-report.pdf', fileName: 'project-report.pdf' },
], 'sharing must send the complete current PDF regardless of the selected preview page')

const cancelPage = makeReportPage({ isGenerating: true, mode: 'rendering' })
cancelPage._reportRevision = 4
cancelPage._buildingPayload = payload
cancelPage._buildingPages = payload.pages
cancelPage._renderedPages = [{ path: 'temp://partial' }]
cancelPage.cancelReportGeneration()
assert.equal(cancelPage.data.mode, 'select')
assert.equal(cancelPage.data.isGenerating, false)
assert.equal(cancelPage._buildingPayload, null)
assert.equal(cancelPage.data.pageStatus, '报告生成已取消，选择内容仍保留。')

const failurePage = makeReportPage({ mode: 'rendering', isGenerating: true })
failurePage._reportRevision = 9
failurePage.failReportGeneration(9, 2)
assert.equal(failurePage.data.mode, 'select')
assert.equal(failurePage.data.isGenerating, false)
assert.equal(failurePage.data.pageStatus, '第 3 页生成失败，未打开不完整报告。请重试。')

console.log('Project report completeness checks passed (18 selected items, complete pagination, stable IDs, full-PDF sharing, and render cancellation and failure).')

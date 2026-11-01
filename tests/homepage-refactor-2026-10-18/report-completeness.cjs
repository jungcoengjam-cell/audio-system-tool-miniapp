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
assert(!reportText.includes(projectId), 'the project storage ID must not be shown in report text')
assert(!reportText.includes(longResult.replace(/\r\n|\r|\n/g, '')), 'the main report must show key results instead of duplicating long tool output')
const completeSavedRecord = payload.selectedItems.find((item) => item.type === 'calculation' && item.record.id === 'record-01')
assert.equal(completeSavedRecord.record.resultText, longResult, 'the frozen selected snapshot must retain all original resultText')
assert.equal(completeSavedRecord.record.preferences.count, 1, 'the frozen selected snapshot must retain original input parameters')
assert(reportText.includes('阈值 1 dBFS'), 'the concise main report must retain the key result summary')
assert(reportText.includes('输入灵敏度') === false, 'unrelated preference labels must not be fabricated')
assert(reportText.includes('功放型号：功放 1'), 'mapped Chinese parameter labels must be rendered')
assert(reportText.includes('四周包边（cm/每边）：5'), 'LED frameWidthText must retain its centimeter-per-side meaning')
assert(reportText.includes('拼装单元：模组 · 320 × 160 mm'), 'LED unitKey uses the existing Chinese unit option label')
assert(reportText.includes('像素点间距（mm）：系统推荐'), 'the recommended pitch value uses the existing Chinese option label')
assert.equal(PREFERENCE_LABELS_BY_MODULE.limiter.mode, '限幅器工作模式')
assert.equal(PREFERENCE_LABELS_BY_MODULE.cable.mode, '线材选型方式', 'same preference key must use module-specific semantics')
assert.deepEqual(formatPreferenceRows({ frameWidthText: '5', unitKey: 'module' }, 'ledScreen'), [
  { label: '四周包边（cm/每边）', value: '5' },
  { label: '拼装单元', value: 'module' },
])
assert(reportText.includes('来源设备：调音台 A · 端口：OUT 1'))
assert(reportText.includes('去向设备：处理器 A · 端口：IN L'))
assert(reportText.includes('A001 · 主扩左声道'), 'the现场线路 code remains visible')
assert(reportText.includes('施工状态：已核对'))
assert(!reportText.includes('line-stable-01') && !reportText.includes('device-mixer-a')
  && !reportText.includes('device-processor-a'), 'internal line and device IDs must not be shown')
assert(reportText.includes('来源端接头：XLR 公头'))
assert(!reportText.includes('xlrMale'), 'a known connector enum is not repeated after its Chinese label')
assert(!reportText.includes('fixture-stable-a') && !reportText.includes('group-stable-a'),
  'internal lighting group and fixture IDs must not be shown')
assert(reportText.includes('A001'))
assert(reportText.includes('布置位置：无法识别'))
assert(!reportText.includes('"x":0.375'), 'raw layout coordinates are not user-facing placement labels')
assert(!reportText.includes('fixture-stable-b'), 'lighting from another project must not appear')
assert(!reportText.includes('record-other-project'), 'another project record must not appear')
assert(!reportText.includes('record-01'), 'record storage IDs must not be shown in report text')

const selectedLine = payload.selectedItems.find((item) => item.type === 'wiring' && item.line.code === 'A001')
assert.equal(selectedLine.line.id, 'line-stable-01', 'the complete selected line snapshot keeps its internal ID')
assert.equal(selectedLine.line.fromDeviceId, 'device-mixer-a', 'the selected line snapshot keeps its device reference')
assert.equal(payload.selectedSchedule.lines.find((line) => line.code === 'A001').id, 'line-stable-01',
  'the selected schedule retains its line ID for image matching')
assert.deepEqual(payload.selectedItems.find((item) => item.type === 'lighting').lighting, loaded.lighting,
  'the full lighting snapshot retains the internal IDs used by the native diagram')
assert.equal(payload.project.id, projectId, 'the project ID remains in the frozen source snapshot')

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
assert(!reportWxml.includes('project.id'), 'the project ID is omitted from the report selection card')
const reportRenderer = fs.readFileSync(path.join(__dirname, '../../pages/records/report-renderer.js'), 'utf8')
assert(!reportRenderer.includes('project.id'), 'the project ID is omitted from the native report page header')

function reportForRecord(record) {
  const source = { ...sourceWithLedScreenRecord, records: [record] }
  const item = getProjectReportSections(source).find((section) => section.key === 'calculation').items[0]
  const report = buildReportPayload(source, [item.id])
  return {
    report,
    text: report.pages.flatMap((page) => page.lines).map((line) => line.text).join('\n'),
  }
}

for (const title of ['', '同一关键结果']) {
  const record = {
    id: `record-summary-${title ? 'matching-title' : 'missing-title'}`,
    module: 'limiter', title, summary: '同一关键结果',
    preferences: { amplifierModel: '功放 A', speakerModel: '音箱 A', count: 1 },
    resultText: '完整保存结果', createdAt: 1760000000200,
  }
  const rendered = reportForRecord(record)
  assert.equal(rendered.text.split('同一关键结果').length - 1, 1,
    'a summary shown as the heading is not repeated in a second result line')
}

const constantCablePreferences = {
  mode: 'constant', environment: 'indoor',
  constantPowerText: '100', constantDistanceText: '80',
  professionalPowerText: '999', professionalDistanceText: '998',
}
const constantCable = reportForRecord({
  id: 'record-cable-constant', module: 'cable', title: '定压线路', summary: '电压降 4%',
  preferences: constantCablePreferences, resultText: '完整保存结果', createdAt: 1760000000300,
})
assert(constantCable.text.includes('线材选型方式：定压广播'))
assert(constantCable.text.includes('敷设环境：室内'))
assert(constantCable.text.includes('定压系统总功率（W）：100'))
assert(constantCable.text.includes('定压系统单程距离（m）：80'))
assert(!constantCable.text.includes('专业音箱总功率') && !constantCable.text.includes('专业音箱单程距离'),
  'constant cable reports omit inputs from the inactive professional-speaker branch')
assert.deepEqual(constantCable.report.selectedItems[0].record.preferences, constantCablePreferences,
  'inactive cable inputs remain in the complete selected record snapshot')

const professionalCablePreferences = {
  mode: 'professional', environment: 'outdoor',
  constantPowerText: '997', constantDistanceText: '996',
  professionalPowerText: '300', professionalDistanceText: '50',
}
const professionalCable = reportForRecord({
  id: 'record-cable-professional', module: 'cable', title: '专业音箱线路', summary: '线径 2.5 mm²',
  preferences: professionalCablePreferences, resultText: '完整保存结果', createdAt: 1760000000301,
})
assert(professionalCable.text.includes('线材选型方式：专业音箱'))
assert(professionalCable.text.includes('专业音箱总功率（W）：300'))
assert(professionalCable.text.includes('专业音箱单程距离（m）：50'))
assert(!professionalCable.text.includes('敷设环境') && !professionalCable.text.includes('定压系统总功率')
  && !professionalCable.text.includes('定压系统单程距离'),
'professional cable reports omit environment and constant-voltage inputs')
assert.deepEqual(professionalCable.report.selectedItems[0].record.preferences, professionalCablePreferences)

const unknownCablePreferences = { ...constantCablePreferences, mode: 'future-mode' }
const unknownCable = reportForRecord({
  id: 'record-cable-unknown', module: 'cable', title: '旧版线材方案', summary: '待复核',
  preferences: unknownCablePreferences, resultText: '完整保存结果', createdAt: 1760000000302,
})
assert(unknownCable.text.includes('线材选型方式：future-mode'))
assert(unknownCable.text.includes('定压系统总功率（W）：100')
  && unknownCable.text.includes('专业音箱总功率（W）：999'),
'unknown cable modes conservatively retain both input branches')

const groundAutoCameraPreferences = {
  cameraModel: 'CAM-A', viewLabel: '广角', sceneMode: 'ground', heightMode: 'auto', marginPercent: 10,
  groundWidthText: '8', groundDepthText: '5', subjectHeightText: '1.8',
  planeWidthText: '111', planeHeightText: '222', planeBottomHeightText: '333', fixedCameraHeightText: '444',
}
const groundAutoCamera = reportForRecord({
  id: 'record-camera-ground-auto', module: 'camera', title: '地面区域布置', summary: '覆盖 8 × 5 m',
  preferences: groundAutoCameraPreferences, resultText: '完整保存结果', createdAt: 1760000000400,
})
assert(groundAutoCamera.text.includes('目标场景：地面区域')
  && groundAutoCamera.text.includes('镜头高度方式：自动建议高度'))
assert(groundAutoCamera.text.includes('拍摄区域宽度（m）：8')
  && groundAutoCamera.text.includes('拍摄区域纵深（m）：5')
  && groundAutoCamera.text.includes('人物最高点（m）：1.8'))
assert(!groundAutoCamera.text.includes('目标宽度（m）') && !groundAutoCamera.text.includes('目标高度（m）')
  && !groundAutoCamera.text.includes('目标底边离地高度（m）') && !groundAutoCamera.text.includes('镜头中心高度（m）'),
'ground / automatic-height camera reports omit inactive plane and fixed-height inputs')
assert.deepEqual(groundAutoCamera.report.selectedItems[0].record.preferences, groundAutoCameraPreferences)

const planeFixedCameraPreferences = {
  cameraModel: 'CAM-B', viewLabel: '标准视角', sceneMode: 'plane', heightMode: 'fixed', marginPercent: 5,
  groundWidthText: '991', groundDepthText: '992', subjectHeightText: '993',
  planeWidthText: '6', planeHeightText: '2.5', planeBottomHeightText: '0.8', fixedCameraHeightText: '2.3',
}
const planeFixedCamera = reportForRecord({
  id: 'record-camera-plane-fixed', module: 'camera', title: '竖直平面布置', summary: '目标 6 × 2.5 m',
  preferences: planeFixedCameraPreferences, resultText: '完整保存结果', createdAt: 1760000000401,
})
assert(planeFixedCamera.text.includes('目标场景：垂直平面')
  && planeFixedCamera.text.includes('镜头高度方式：已有安装高度'))
assert(planeFixedCamera.text.includes('目标宽度（m）：6')
  && planeFixedCamera.text.includes('目标高度（m）：2.5')
  && planeFixedCamera.text.includes('目标底边离地高度（m）：0.8')
  && planeFixedCamera.text.includes('镜头中心高度（m）：2.3'))
assert(!planeFixedCamera.text.includes('拍摄区域宽度') && !planeFixedCamera.text.includes('拍摄区域纵深')
  && !planeFixedCamera.text.includes('人物最高点'), 'plane camera reports omit inactive ground-area inputs')

const unknownCameraPreferences = { ...groundAutoCameraPreferences, sceneMode: 'future-scene', heightMode: 'future-height' }
const unknownCamera = reportForRecord({
  id: 'record-camera-unknown', module: 'camera', title: '旧版相机方案', summary: '待复核',
  preferences: unknownCameraPreferences, resultText: '完整保存结果', createdAt: 1760000000402,
})
assert(unknownCamera.text.includes('目标场景：future-scene') && unknownCamera.text.includes('镜头高度方式：future-height'))
assert(unknownCamera.text.includes('拍摄区域宽度（m）：8') && unknownCamera.text.includes('目标宽度（m）：111')
  && unknownCamera.text.includes('镜头中心高度（m）：444'),
'unknown camera modes conservatively retain available branch inputs')

const incompleteGainPreferences = {
  amplifierModel: '', stageValue: null, mode: 'bridge', loadImpedance: 0, targetPeakDbfs: undefined,
}
const incompleteGain = reportForRecord({
  id: 'record-gain-incomplete', module: 'gainStructure', title: '不完整增益输入', summary: '暂存结果',
  preferences: incompleteGainPreferences, resultText: '完整保存结果', createdAt: 1760000000500,
})
assert(incompleteGain.text.includes('功放工作模式：桥接'))
assert(incompleteGain.text.includes('负载阻抗（Ω）：0'), 'a numeric zero remains a visible input value')
assert(!incompleteGain.text.includes('功放型号：') && !incompleteGain.text.includes('功放输入级参数：')
  && !incompleteGain.text.includes('DSP 目标峰值'), 'missing null, undefined, and empty-string inputs are hidden')
assert.equal(incompleteGainPreferences.targetPeakDbfs, undefined, 'report rendering does not mutate the original undefined value')
assert.deepEqual(incompleteGain.report.selectedItems[0].record.preferences, JSON.parse(JSON.stringify(incompleteGainPreferences)),
  'missing-value display filtering does not alter the JSON-safe source snapshot')

const unknownConnectorSource = {
  ...sourceWithLedScreenRecord,
  schedule: {
    ...sourceWithLedScreenRecord.schedule,
    lines: sourceWithLedScreenRecord.schedule.lines.map((line) => line.code === 'A001'
      ? { ...line, connectorA: 'custom-field-terminal' }
      : line),
  },
}
const unknownConnectorItem = getProjectReportSections(unknownConnectorSource)
  .find((section) => section.key === 'wiring').items.find((item) => item.line.code === 'A001')
const unknownConnectorReport = buildReportPayload(unknownConnectorSource, [unknownConnectorItem.id])
const unknownConnectorText = unknownConnectorReport.pages.flatMap((page) => page.lines).map((line) => line.text).join('\n')
assert(unknownConnectorText.includes('来源端接头：custom-field-terminal'), 'unknown connector values remain visible verbatim')

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

const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const ACTIVE_KEY = 'audioTool.activeProject.v1'
const SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const SCHEMA_VERSION = 3
const { amplifiers, speakers } = require('../data/equipment')
const { calculateLimiter } = require('../utils/limiter')

const storage = new Map([
  [RECORDS_KEY, []],
  [PROJECTS_KEY, []],
  [ACTIVE_KEY, ''],
  [SCHEMA_KEY, SCHEMA_VERSION],
])
const writeCounts = new Map()
let failedWriteKey = ''
let failedReadKey = ''
let clipboardText = ''

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

global.wx = {
  getStorageSync(key) {
    if (key === failedReadKey) throw new Error('simulated read failure')
    return clone(storage.get(key))
  },
  setStorageSync(key, value) {
    writeCounts.set(key, (writeCounts.get(key) || 0) + 1)
    if (key === failedWriteKey) throw new Error('simulated write failure')
    storage.set(key, clone(value))
  },
  getStorageInfoSync() { return { currentSize: 1, limitSize: 100 } },
  setNavigationBarTitle() {},
  setClipboardData({ data }) { clipboardText = data },
}

delete require.cache[require.resolve('../utils/records')]
const records = require('../utils/records')
const projectA = records.createProject('项目 A')
const projectB = records.createProject('项目 B')
const projectC = records.createProject('项目 C')
assert(projectA && projectB && projectC)

const preferences = {
  amplifierModel: 'TC-2350B',
  speakerModel: 'TS-803C',
  count: 1,
  wiring: 'parallel',
  mode: 'stereo',
  sensitivityVoltage: 1,
  highPassFrequency: 80,
}
const payload = {
  module: 'limiter',
  title: 'TC-2350B + TS-803C',
  summary: '阈值 -19.2 dBFS',
  resultText: '0 dBFS = +18.4 dBu\n阈值：-19.2 dBFS',
  preferences,
}

const recordA = records.addRecordToProject(payload, projectA.id, {
  name: 'A 项目配置',
  note: 'A 项目备注',
})
assert(recordA)
const signature = JSON.stringify(['limiter', preferences])
assert.equal(recordA.signature, signature)
assert.equal(recordA.title, payload.title)
assert.equal(recordA.summary, payload.summary)
assert.equal(recordA.resultText, payload.resultText)
assert.deepEqual(recordA.preferences, preferences)
assert.deepEqual(Object.keys(recordA.preferences), Object.keys(preferences))
assert.deepEqual(recordA.projectMetadata[projectA.id], {
  name: 'A 项目配置',
  note: 'A 项目备注',
  savedAt: recordA.projectMetadata[projectA.id].savedAt,
})
assert(Number.isFinite(recordA.projectMetadata[projectA.id].savedAt))

const recordB = records.addRecordToProject(payload, projectB.id, { name: 'B 项目配置', note: 'B 项目备注' })
assert.equal(recordB.id, recordA.id, '同参数跨项目复用一条共享记录')
assert.equal(recordB.signature, signature)
assert.equal(recordB.title, payload.title, '项目配置名不覆盖共享标题')
assert.equal(recordB.summary, payload.summary)
assert.equal(recordB.resultText, payload.resultText)
assert.deepEqual(recordB.preferences, preferences, '参数对象及字段顺序保持不变')
assert.deepEqual(recordB.projectIds, [projectA.id, projectB.id])
assert.equal(recordB.projectMetadata[projectA.id].name, 'A 项目配置')
assert.equal(recordB.projectMetadata[projectB.id].name, 'B 项目配置')
assert(!JSON.stringify(recordB.signature).includes('项目配置'), '元数据不进入签名')

const calibrationAmplifier = amplifiers.find((item) => item.model === 'TC-2350B')
const calibrationSpeaker = speakers.find((item) => item.model === 'TS-803C')
const currentCalibrationResult = calculateLimiter({
  amplifier: calibrationAmplifier,
  speaker: calibrationSpeaker,
  count: 1,
  wiring: 'parallel',
  mode: 'stereo',
  sensitivityVoltage: 1,
  highPassFrequency: 80,
})
assert.equal(currentCalibrationResult.thresholdDbfs, -19.2)
const previousCalibrationPayload = {
  module: 'limiter',
  title: 'TC-2350B / TS-803C',
  summary: 'DSP 标定 +18.0 dBu',
  resultText: '0 dBFS = +18 dBu\n阈值：-18.8 dBFS',
  preferences,
}
const previousCalibrationRecord = records.addRecordToProject(previousCalibrationPayload, projectC.id)
const currentCalibrationPayload = {
  ...previousCalibrationPayload,
  summary: 'DSP 标定 +18.4 dBu',
  resultText: `0 dBFS = +18.4 dBu\n阈值：${currentCalibrationResult.thresholdDbfs} dBFS`,
}
const refreshedCalibrationRecord = records.addRecordToProject(currentCalibrationPayload, projectC.id, {
  name: '当前标定配置',
  note: '采用当前 DSP 标定',
})
assert.equal(refreshedCalibrationRecord.id, previousCalibrationRecord.id)
assert.equal(refreshedCalibrationRecord.summary, currentCalibrationPayload.summary)
assert.equal(refreshedCalibrationRecord.resultText, currentCalibrationPayload.resultText,
  '相同输入签名下的项目备注保存仍采用当前计算页面的标定结果')
assert.equal(refreshedCalibrationRecord.projectMetadata[projectC.id].name, '当前标定配置')

const sameNameDifferentParameters = records.addRecordToProject({
  ...payload,
  title: '另一条真实参数记录',
  preferences: { ...preferences, highPassFrequency: 100 },
}, projectA.id, { name: '同名配置', note: '' })
const sameNameSecondRecord = records.addRecordToProject({
  ...payload,
  title: '第三条真实参数记录',
  preferences: { ...preferences, highPassFrequency: 125 },
}, projectA.id, { name: '同名配置', note: '' })
assert(sameNameDifferentParameters.id !== sameNameSecondRecord.id)
assert.equal(records.getProjectRecords(projectA.id)
  .filter((record) => record.projectMetadata?.[projectA.id]?.name === '同名配置').length, 2,
'同名但参数不同的配置各自保留')

const noWritesBeforeValidation = [...writeCounts.values()].reduce((sum, count) => sum + count, 0)
const invalidMetadata = [
  null,
  [],
  { name: '' },
  { name: ' \t ' },
  { name: 5 },
  { name: '有效名称', note: 5 },
  { name: '有效名称', note: null },
  { name: '有效名称', note: 'x'.repeat(201) },
  { name: 'x'.repeat(61) },
  { name: '有效名称', extra: true },
]
invalidMetadata.forEach((metadata) => {
  assert.equal(records.addRecordToProject(payload, projectA.id, metadata), null)
})
assert.equal([...writeCounts.values()].reduce((sum, count) => sum + count, 0), noWritesBeforeValidation,
  '非法元数据在读写前被拒绝')
assert(records.addRecordToProject(payload, projectA.id, { name: '名'.repeat(60), note: '' }))
assert(records.addRecordToProject(payload, projectA.id, { name: '有效名称', note: '注'.repeat(200) }))
assert.equal(records.addRecordToProject({ ...payload, module: 'spl' }, projectA.id, {
  name: '其他模块', note: '',
}), null, '共享记录元数据只接受限幅器记录')

const rollbackPayload = {
  ...payload,
  title: '回滚验证记录',
  preferences: { ...preferences, highPassFrequency: 100 },
}
const rollbackOriginal = records.addRecordToProject(rollbackPayload, projectC.id, {
  name: '回滚前名称', note: '回滚前备注',
})
const storedRecordsBeforeFailure = clone(storage.get(RECORDS_KEY))
const storedProjectsBeforeFailure = clone(storage.get(PROJECTS_KEY))
failedWriteKey = PROJECTS_KEY
assert.equal(records.addRecordToProject(rollbackPayload, projectC.id, {
  name: '回滚后名称', note: '回滚后备注',
}), null)
failedWriteKey = ''
assert.deepEqual(storage.get(RECORDS_KEY), storedRecordsBeforeFailure)
assert.deepEqual(storage.get(PROJECTS_KEY), storedProjectsBeforeFailure)
assert.deepEqual(records.getRecordByPayload(rollbackPayload).projectMetadata[projectC.id],
  rollbackOriginal.projectMetadata[projectC.id], '失败写入不污染内存记录缓存')

const canonicalBeforeOldCaller = records.getRecordByPayload(payload)
const oldCallerResult = records.addRecordToProject({ ...payload, title: '旧调用方标题' }, projectB.id)
assert.equal(oldCallerResult.title, '旧调用方标题', '未传第三参数时保留旧调用行为')
assert.equal(oldCallerResult.projectMetadata[projectA.id].name, '有效名称')
assert.equal(oldCallerResult.projectMetadata[projectB.id].name, 'B 项目配置')
assert.equal(canonicalBeforeOldCaller.id, oldCallerResult.id)
const oldOtherModuleRecord = records.addRecordToProject({
  module: 'spl', title: '旧调用', summary: '旧摘要', resultText: '旧结果', preferences: { x: 1 },
}, projectC.id)
assert(oldOtherModuleRecord, '未传元数据时其他模块继续沿用原保存行为')
assert.equal(oldOtherModuleRecord.projectMetadata, undefined)
assert.equal(records.getProjectRecords(projectC.id).some((record) => !record.projectMetadata), true,
  '旧调用方仍可保存不带元数据的记录')

const favoriteEnabled = records.toggleFavorite(payload)
assert.equal(favoriteEnabled.favorite, true)
assert.equal(favoriteEnabled.title, payload.title, '添加项目名称后收藏仍保留当前共享标题')
assert.equal(favoriteEnabled.resultText, payload.resultText)
let favoriteRecord = records.getRecordByPayload(payload)
assert.equal(favoriteRecord.projectMetadata[projectA.id].name, '有效名称')
assert.equal(favoriteRecord.projectMetadata[projectB.id].name, 'B 项目配置')
assert.equal(records.restoreRecord(favoriteRecord), '/pages/limiter/limiter')
assert.deepEqual(storage.get('audioTool.limiter.preferences'), preferences,
  '恢复记录写入的偏好对象与原参数字段顺序一致')
assert.deepEqual(Object.keys(storage.get('audioTool.limiter.preferences')), [
  'amplifierModel', 'speakerModel', 'count', 'wiring', 'mode', 'sensitivityVoltage', 'highPassFrequency',
], '恢复的七个字段顺序与当前限幅器页面记录契约一致')
assert.equal(records.toggleFavoriteById(favoriteRecord.id).favorite, false)
favoriteRecord = records.getRecordByPayload(payload)
assert.equal(favoriteRecord.projectMetadata[projectA.id].name, '有效名称', '收藏开关不丢项目元数据')
assert.equal(favoriteRecord.projectMetadata[projectB.id].name, 'B 项目配置')

function captureProjectPage() {
  let definition
  const previousPage = global.Page
  global.Page = (value) => { definition = value }
  const projectPagePath = require.resolve('../pages/records/project')
  delete require.cache[projectPagePath]
  require(projectPagePath)
  global.Page = previousPage
  assert(definition)
  return {
    ...definition,
    data: clone(definition.data),
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      if (callback) callback()
    },
  }
}

const projectPage = captureProjectPage()
projectPage.onLoad({ id: projectA.id })
let limiterView = projectPage.data.recordGroups.find((group) => group.module === 'limiter')
  .records.find((record) => record.id === favoriteRecord.id)
assert.equal(limiterView.title, '有效名称')
assert.equal(limiterView.projectNote, '注'.repeat(200))
assert.equal(limiterView.updatedAt, favoriteRecord.projectMetadata[projectA.id].savedAt)
const reportSignatureRecord = JSON.parse(projectPage.reportSourceSignature).records
  .find((record) => record.id === favoriteRecord.id)
const viewSignatureRecord = JSON.parse(projectPage.projectViewSignature).records
  .find((record) => record.id === favoriteRecord.id)
;[reportSignatureRecord, viewSignatureRecord].forEach((item) => {
  assert.equal(item.title, limiterView.title)
  assert.equal(item.hasProjectMetadata, true)
  assert.equal(item.projectNote, limiterView.projectNote)
  assert.equal(item.updatedAt, limiterView.updatedAt)
})

const longNote = '甲乙丙丁戊己庚辛壬癸'.repeat(20)
const fixedSavedAt = Date.now() + 5000
const originalDateNow = Date.now
let noteOnlyRecord
try {
  Date.now = () => fixedSavedAt
  records.addRecordToProject(payload, projectA.id, { name: '有效名称', note: '时间戳基准备注' })
  projectPage.refresh()
  const baselineProject = records.getProjects().find((project) => project.id === projectA.id)
  assert.equal(baselineProject.updatedAt, fixedSavedAt)
  projectPage.reportSignature = projectPage.reportSourceSignature
  projectPage.setData({ reportImagePath: 'temp://old-project-report.png', reportPreviewVisible: true })
  const previousViewSignature = projectPage.projectViewSignature
  const previousReportSourceSignature = projectPage.reportSourceSignature
  noteOnlyRecord = records.addRecordToProject(payload, projectA.id, {
    name: '有效名称',
    note: longNote,
  })
  assert.equal(noteOnlyRecord.projectMetadata[projectA.id].savedAt, fixedSavedAt)
  assert.equal(records.getProjects().find((project) => project.id === projectA.id).updatedAt, fixedSavedAt,
    '仅修改备注时项目和记录时间戳保持不变')
  projectPage.refresh()
  assert.notEqual(projectPage.projectViewSignature, previousViewSignature,
    '同一时间戳下仅备注变化仍更新项目视图签名')
  assert.notEqual(projectPage.reportSourceSignature, previousReportSourceSignature,
    '同一时间戳下仅备注变化仍更新报告来源签名')
  assert.equal(projectPage.data.reportImagePath, '', '备注变化后清空长图缓存')
  assert.equal(projectPage.data.reportPreviewVisible, false)
} finally {
  Date.now = originalDateNow
}
limiterView = projectPage.data.recordGroups.find((group) => group.module === 'limiter')
  .records.find((record) => record.id === favoriteRecord.id)
assert.equal(limiterView.title, '有效名称')
assert.equal(limiterView.projectNote, longNote)
assert.equal(limiterView.updatedAt, noteOnlyRecord.projectMetadata[projectA.id].savedAt)

projectPage.copyProject()
assert(clipboardText.includes('—— 1. 有效名称 ——'))
assert(clipboardText.includes(`配置备注：${longNote}`), '文字报告完整包含配置备注')
const savedAtDate = new Date(noteOnlyRecord.projectMetadata[projectA.id].savedAt)
const pad = (value) => String(value).padStart(2, '0')
const savedAtText = `${savedAtDate.getFullYear()}-${pad(savedAtDate.getMonth() + 1)}-${pad(savedAtDate.getDate())} ${pad(savedAtDate.getHours())}:${pad(savedAtDate.getMinutes())}`
assert(clipboardText.includes(`记录时间：${savedAtText}`), '文字报告显示项目自己的实际保存时间')

const projectReport = require('../pages/records/project-report')
const reportPayload = projectReport.buildProjectReportPayload(projectPage.data.project,
  projectPage.data.recordGroups, { generatedAt: '2026-10-06' })
assert(reportPayload.groups.some((group) => group.records.some((record) => record.projectNote === longNote)))
const expectedLegacyHeight = 700 + (reportPayload.groups.length * 76)
  + (reportPayload.groups.reduce((sum, group) => sum + group.records.length, 0) * 126)
  + (reportPayload.omittedCount ? 54 : 0) + 138
assert(projectReport.calculateProjectReportHeight(reportPayload) > expectedLegacyHeight,
  '有长备注时动态增加长图高度')
const legacyPayload = projectReport.buildProjectReportPayload(projectPage.data.project,
  reportPayload.groups.map((group) => ({
    ...group,
    records: group.records.map(({ projectNote, ...record }) => record),
  })), { generatedAt: '2026-10-06' })
const expectedNoNoteHeight = 700 + (legacyPayload.groups.length * 76)
  + (legacyPayload.groups.reduce((sum, group) => sum + group.records.length, 0) * 126)
  + (legacyPayload.omittedCount ? 54 : 0) + 138
assert.equal(projectReport.calculateProjectReportHeight(legacyPayload), expectedNoNoteHeight,
  '无项目备注时沿用原长图高度')

function createReportContext() {
  const calls = []
  const shapes = []
  let pathPoints = []
  const context = {
    font: '15px sans-serif',
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/)?.[1]) || 15
      return { width: [...String(text)].length * size }
    },
    setFillStyle() {},
    setStrokeStyle() {},
    setLineWidth() {},
    setTextAlign() {},
    fillRect(x, y, width, height) { shapes.push({ x, y, width, height }) },
    beginPath() { pathPoints = [] },
    moveTo(x, y) { pathPoints.push({ x, y }) },
    lineTo(x, y) { pathPoints.push({ x, y }) },
    quadraticCurveTo(controlX, controlY, x, y) {
      pathPoints.push({ x: controlX, y: controlY }, { x, y })
    },
    closePath() {},
    fill() { shapes.push({ points: pathPoints }) },
    stroke() {},
    fillText(text, x, y) { calls.push({ text: String(text), x, y, font: this.font }) },
  }
  return { context, calls, shapes }
}

const { context, calls: canvasCalls } = createReportContext()
projectReport.drawProjectReport(context, reportPayload, projectReport.calculateProjectReportHeight(reportPayload))
const noteLines = []
const drawingText = canvasCalls.map((item) => item.text)
const firstNoteLine = drawingText.findIndex((line) => line.startsWith('配置备注：'))
assert.notEqual(firstNoteLine, -1, '长图展示项目配置备注')
noteLines.push(...drawingText.slice(firstNoteLine, firstNoteLine + 4))
assert.deepEqual(noteLines, [
  `配置备注：${longNote.slice(0, 15)}`,
  longNote.slice(15, 35),
  longNote.slice(35, 55),
  '备注摘录，全文见文字报告',
], '长图明确标示备注摘录；文字报告保留完整备注')

const wrappedMetadataName = '名'.repeat(60)
const wrappedMetadataNote = '第一行备注\n第二行备注'
const wrappedMetadataPayload = projectReport.buildProjectReportPayload(projectPage.data.project, [{
  module: 'limiter',
  label: '限幅器',
  theme: 'cyan',
  records: [{
    id: 'wrapped-metadata',
    module: 'limiter',
    title: wrappedMetadataName,
    hasProjectMetadata: true,
    summary: '配置名称和换行备注边界',
    projectNote: wrappedMetadataNote,
    timeText: '10-06 12:00',
    theme: 'cyan',
  }],
}], { generatedAt: '2026-10-06' })
const wrappedMetadataHeight = projectReport.calculateProjectReportHeight(wrappedMetadataPayload)
const wrappedMetadataContext = createReportContext()
projectReport.drawProjectReport(wrappedMetadataContext.context, wrappedMetadataPayload, wrappedMetadataHeight)
const wrappedMetadataCalls = wrappedMetadataContext.calls
const longTitleLines = wrappedMetadataCalls.filter((item) => item.x === 66 && /^名+$/.test(item.text))
assert.equal(longTitleLines.map((item) => item.text).join(''), wrappedMetadataName,
  '长图完整换行绘制60字中文配置名')
const configTitleFirstLine = longTitleLines[0]
const configTitleTime = wrappedMetadataCalls.find((item) => item.text === '10-06 12:00')
assert(configTitleFirstLine && configTitleTime)
wrappedMetadataContext.context.font = configTitleFirstLine.font
const configTitleLineWidth = wrappedMetadataContext.context.measureText(configTitleFirstLine.text).width
wrappedMetadataContext.context.font = configTitleTime.font
const configTitleTimeWidth = wrappedMetadataContext.context.measureText(configTitleTime.text).width
assert(configTitleFirstLine.x + configTitleLineWidth + 12 <= configTitleTime.x - configTitleTimeWidth,
  '配置名首行与同一行的记录时间实际绘制边界不重叠')
const firstWrappedNoteIndex = wrappedMetadataCalls.findIndex((item) => item.text === '配置备注：第一行备注')
assert.notEqual(firstWrappedNoteIndex, -1)
assert.equal(wrappedMetadataCalls[firstWrappedNoteIndex + 1].text, '第二行备注',
  '长图保留备注中的换行，不把两段合并')
assert(wrappedMetadataCalls.every((item) => !item.text.includes('\n') && !item.text.includes('\r')),
  '长图把换行拆成真实独立绘制行')
assert(wrappedMetadataCalls.every((item) => {
  const fontSize = Number(item.font.match(/(\d+)px/)?.[1]) || 0
  return item.y + fontSize <= wrappedMetadataHeight
}), '长配置名与多行备注的文字均未越出长图高度')
assert(wrappedMetadataContext.shapes.every((shape) => shape.points
  ? shape.points.every((point) => point.y <= wrappedMetadataHeight)
  : shape.y + shape.height <= wrappedMetadataHeight), '长配置名卡片边界处于长图高度内')

const legacyLongCanonicalPayload = projectReport.buildProjectReportPayload(projectPage.data.project, [{
  module: 'limiter',
  label: '限幅器',
  theme: 'cyan',
  records: [{
    id: 'legacy-long-canonical',
    module: 'limiter',
    title: wrappedMetadataName,
    summary: '旧版共享标题',
    timeText: '10-06 12:00',
    theme: 'cyan',
  }],
}], { generatedAt: '2026-10-06' })
const legacyLongCanonicalHeight = projectReport.calculateProjectReportHeight(legacyLongCanonicalPayload)
assert.equal(legacyLongCanonicalHeight, 1040, '无元数据的旧限幅标题保持旧长图高度')
const legacyLongCanonicalContext = createReportContext()
projectReport.drawProjectReport(legacyLongCanonicalContext.context, legacyLongCanonicalPayload,
  legacyLongCanonicalHeight)
const legacyCanonicalTitleCalls = legacyLongCanonicalContext.calls.filter((item) => item.x === 66 && item.y === 819)
assert.equal(legacyCanonicalTitleCalls.length, 1, '无元数据的旧限幅标题保持原单行绘制轨迹')
assert(legacyCanonicalTitleCalls[0].text.endsWith('…'), '旧长canonical标题继续沿用旧版单行省略')
assert.equal(wrappedMetadataPayload.groups[0].records[0].title, legacyLongCanonicalPayload.groups[0].records[0].title,
  '元数据配置名与canonical标题可以同名')
assert(wrappedMetadataHeight > legacyLongCanonicalHeight,
  '同名的有效元数据仍按项目配置名完整换行并扩展长图卡片')

const maximumReportPayload = projectReport.buildProjectReportPayload(projectPage.data.project, [{
  module: 'limiter',
  label: '限幅器',
  theme: 'cyan',
  trustLabel: '产品参数计算',
  records: Array.from({ length: 12 }, (_, index) => ({
    id: `maximum-note-${index}`,
    title: `限幅配置 ${index + 1}`,
    summary: '同一真实计算摘要',
    projectNote: longNote,
    timeText: '10-06 12:00',
    theme: 'cyan',
  })),
}], { generatedAt: '2026-10-06' })
const maximumReportHeight = projectReport.calculateProjectReportHeight(maximumReportPayload)
assert.equal(maximumReportHeight, 3314, '12条备注在3条内容行加提示行内布局')
assert(maximumReportHeight <= 4096, '最长备注源画布不超过4096px，避免大尺寸画布')
const maximumContext = createReportContext()
projectReport.drawProjectReport(maximumContext.context, maximumReportPayload, maximumReportHeight)
const maximumDraws = maximumContext.calls
assert(maximumDraws.every((item) => {
  const fontSize = Number(item.font.match(/(\d+)px/)?.[1]) || 0
  return item.y + fontSize <= maximumReportHeight
}), '12 条最长备注的文字基线与字号均在画布高度内')
assert(maximumContext.shapes.every((shape) => shape.points
  ? shape.points.every((point) => point.y <= maximumReportHeight)
  : shape.y + shape.height <= maximumReportHeight), '所有报告卡片边界均在画布高度内')
const maximumFooter = maximumDraws.find((item) => item.text.startsWith('本报告为项目内计算结果汇总'))
const maximumVersion = maximumDraws.find((item) => item.text.startsWith('版本 '))
assert(maximumFooter && maximumVersion)
assert(maximumVersion.y + 16 <= maximumReportHeight, '版本页脚完整处于画布内')
const maximumExport = projectReport.getExportDimensions(maximumReportHeight)
assert(maximumExport.destHeight <= 4096 && maximumExport.destHeight >= maximumReportHeight,
  '报告导出不把文字缩小到源画布以下，并保持平台高度上限')
assert(750 * maximumReportHeight * 4 <= 12 * 1024 * 1024,
  '最大12条备注的源画布 RGBA 数据量低于12 MiB')

const adversarialNote = `${'A\n'.repeat(99)}A`
assert.equal(adversarialNote.length, 199)
const adversarialGroups = Array.from({ length: 12 }, (_, index) => ({
  module: `module-${index + 1}`,
  label: `模块 ${index + 1}`,
  theme: 'cyan',
  records: [{
    id: `adversarial-${index + 1}`,
    title: wrappedMetadataName,
    hasProjectMetadata: true,
    summary: '最坏换行输入',
    projectNote: adversarialNote,
    timeText: '10-06 12:00',
    theme: 'cyan',
  }],
}))
const adversarialReport = projectReport.buildProjectReportPayload(projectPage.data.project,
  adversarialGroups, { generatedAt: '2026-10-06' })
const adversarialHeight = projectReport.calculateProjectReportHeight(adversarialReport)
assert(adversarialHeight <= 4096, '12模块的最长配置名和199字符换行备注仍限制在4096px')
assert(adversarialReport.omittedCount > 0, '超出画布预算时沿用omittedCount省略长图记录')
assert.equal(adversarialReport.completedModuleCount, 12, '长图裁减不改完整报告的模块计数')
assert(adversarialReport.groups.flatMap((group) => group.records)
  .every((record) => record.projectNote === adversarialNote), '被保留的记录仍带有完整原始备注')
assert(adversarialGroups.every((group) => group.records[0].projectNote === adversarialNote),
  '长图预算裁减不改原始输入与文字报告数据')
const adversarialExport = projectReport.getExportDimensions(adversarialHeight)
assert(adversarialExport.destHeight <= 4096 && adversarialExport.destHeight >= adversarialHeight,
  '极端换行报告导出尺寸既保留源画布字号又不超4096px')
assert(750 * adversarialHeight * 4 <= 12 * 1024 * 1024,
  '极端换行报告源画布 RGBA 数据量低于12 MiB')
const adversarialContext = createReportContext()
projectReport.drawProjectReport(adversarialContext.context, adversarialReport, adversarialHeight)
assert(adversarialContext.calls.some((item) => item.text === '备注摘录，全文见文字报告'),
  '极端换行长图清楚提示备注全文见文字报告')
assert(adversarialContext.calls.every((item) => {
  const fontSize = Number(item.font.match(/(\d+)px/)?.[1]) || 0
  return item.y + fontSize <= adversarialHeight
}), '裁减记录后的极端报告页脚与所有文字均在画布内')
assert(adversarialContext.shapes.every((shape) => shape.points
  ? shape.points.every((point) => point.y <= adversarialHeight)
  : shape.y + shape.height <= adversarialHeight), '裁减记录后的极端报告卡片边界在画布内')

const metadataBeforeProjection = clone(favoriteRecord.projectMetadata)
const projectionWrites = [...writeCounts.values()].reduce((sum, count) => sum + count, 0)
const projected = records.getProjectRecordView(favoriteRecord, projectA.id)
assert.equal(projected.title, '有效名称')
assert.equal(projected.hasProjectMetadata, true, '只读投影标记有效的项目配置元数据')
projected.title = '投影修改'
projected.projectMetadata[projectA.id].name = '投影修改'
projected.preferences.amplifierModel = '投影修改'
projected.projectIds.push('投影修改')
assert.equal(favoriteRecord.title, payload.title)
assert.equal(favoriteRecord.projectMetadata[projectA.id].name, metadataBeforeProjection[projectA.id].name)
assert.equal(favoriteRecord.preferences.amplifierModel, preferences.amplifierModel)
assert(!favoriteRecord.projectIds.includes('投影修改'))
assert.equal(favoriteRecord.hasProjectMetadata, undefined, '元数据标记只存在于纯投影，不写回共享记录')
assert.equal([...writeCounts.values()].reduce((sum, count) => sum + count, 0), projectionWrites,
  '投影函数不读写本地存储')

const legacyRecord = {
  id: 'legacy-record', module: 'limiter', title: '旧规范名称', summary: '旧摘要', resultText: '旧结果',
  preferences: { mode: 'legacy' }, updatedAt: 123, projectIds: ['legacy-project'],
}
assert.deepEqual(records.getProjectRecordView(legacyRecord, 'legacy-project'), {
  ...legacyRecord,
})
const inheritedProjectMetadata = Object.create({
  constructor: { name: '原型污染名称', note: '不应显示', savedAt: 999 },
})
const prototypeKeyRecord = {
  ...legacyRecord,
  projectIds: ['constructor'],
  projectMetadata: inheritedProjectMetadata,
}
assert.equal(records.getProjectRecordView(prototypeKeyRecord, 'constructor').title, '旧规范名称')
assert.equal(records.getProjectRecordView(prototypeKeyRecord, 'constructor').projectNote, undefined)
const prototypeValueRecord = {
  ...legacyRecord,
  projectMetadata: { 'legacy-project': Object.create({ name: '继承名称' }) },
}
assert.equal(records.getProjectRecordView(prototypeValueRecord, 'legacy-project').title, '旧规范名称')
const unassociatedMetadataRecord = {
  ...legacyRecord,
  projectIds: [],
  projectMetadata: { 'legacy-project': { name: '未关联名称', note: '未关联备注', savedAt: 777 } },
}
assert.equal(records.getProjectRecordView(unassociatedMetadataRecord, 'legacy-project').title, '旧规范名称')
const otherModuleMetadataRecord = {
  ...legacyRecord,
  module: 'spl',
  projectMetadata: { 'legacy-project': { name: '其他工具名称', note: '其他工具备注', savedAt: 888 } },
}
assert.equal(records.getProjectRecordView(otherModuleMetadataRecord, 'legacy-project').title, '旧规范名称')
assert.equal(records.getProjectRecordView(otherModuleMetadataRecord, 'legacy-project').projectNote, undefined)
assert.equal(records.getProjectRecordView(otherModuleMetadataRecord, 'legacy-project').hasProjectMetadata, undefined)
const malformedCurrentMetadataRecord = {
  ...legacyRecord,
  projectMetadata: { 'legacy-project': { name: 'x'.repeat(61), note: 'ok', savedAt: 888 } },
}
assert.equal(records.getProjectRecordView(malformedCurrentMetadataRecord, 'legacy-project').title, '旧规范名称')
const untrustedMarkerRecord = { ...legacyRecord, hasProjectMetadata: true }
assert.equal(records.getProjectRecordView(untrustedMarkerRecord, 'legacy-project').hasProjectMetadata, undefined,
  '无有效项目元数据时丢弃存储输入中的伪造展示标记')

assert.equal(records.getProjectRecords(projectA.id).find((record) => record.id === favoriteRecord.id).title,
  payload.title, 'getProjectRecords继续返回原始共享记录语义')

const legacyExtraPayload = {
  module: 'spl',
  title: '旧版声压记录',
  summary: '旧版摘要',
  resultText: '旧版结果',
  preferences: { legacy: true },
  projectMetadata: { legacyExtra: { note: '其他工具保留的旧扩展字段' } },
}
const legacyExtraRecord = records.addRecordToProject(legacyExtraPayload, projectC.id)
assert(legacyExtraRecord)
assert.equal(records.toggleFavoriteById(legacyExtraRecord.id).favorite, true)
assert.equal(records.removeRecordFromProject(legacyExtraRecord.id, projectC.id), true)
let retainedLegacyExtra = records.getRecords().find((record) => record.id === legacyExtraRecord.id)
assert.deepEqual(retainedLegacyExtra.projectMetadata, legacyExtraPayload.projectMetadata,
  '移除其他模块关联时保留既有 projectMetadata 扩展字段')
records.addRecordToProject(legacyExtraPayload, projectC.id)
assert.equal(records.deleteProject(projectC.id), true)
retainedLegacyExtra = records.getRecords().find((record) => record.id === legacyExtraRecord.id)
assert(retainedLegacyExtra.favorite)
assert.deepEqual(retainedLegacyExtra.projectMetadata, legacyExtraPayload.projectMetadata,
  '删除项目时不清理其他模块的 legacy 扩展字段')
assert.deepEqual(retainedLegacyExtra.projectIds, [])

delete require.cache[require.resolve('../utils/records')]
const freshRecords = require('../utils/records')
const freshSnapshot = freshRecords.getWorkspaceSnapshot({ forceRefresh: true })
assert.equal(freshSnapshot.ok, true, '新 records 模块能先从存储建立真实项目缓存')
assert(freshSnapshot.projects.some((project) => project.id === projectA.id))
const writesBeforeReadFailure = [...writeCounts.values()].reduce((sum, count) => sum + count, 0)
failedReadKey = PROJECTS_KEY
const failedSnapshot = freshRecords.getWorkspaceSnapshot({ forceRefresh: true })
assert.equal(failedSnapshot.ok, false, '强制刷新时项目存储读取失败会暴露错误状态')
assert(failedSnapshot.projects.some((project) => project.id === projectA.id),
  '快照可能保留旧项目缓存，但不可把它当成成功读取')
const storageRecordsBeforeReadFailure = clone(storage.get(RECORDS_KEY))
const storageProjectsBeforeReadFailure = clone(storage.get(PROJECTS_KEY))
assert.equal(freshRecords.addRecordToProject({ ...payload, title: '读取失败时不得保存' }, projectA.id, {
  name: '不得伪保存', note: '存储读取失败',
}), null, '即使旧缓存含有项目，项目列表读取失败仍拒绝保存')
failedReadKey = ''
assert.equal([...writeCounts.values()].reduce((sum, count) => sum + count, 0), writesBeforeReadFailure,
  '项目列表读取失败时不尝试写入')
assert.deepEqual(storage.get(RECORDS_KEY), storageRecordsBeforeReadFailure)
assert.deepEqual(storage.get(PROJECTS_KEY), storageProjectsBeforeReadFailure)

assert.equal(records.removeRecordFromProject(favoriteRecord.id, projectA.id), true)
const afterRemovingA = records.getRecords().find((record) => record.id === favoriteRecord.id)
assert.equal(afterRemovingA.favorite, false)
assert.deepEqual(afterRemovingA.projectIds, [projectB.id])
assert(!Object.prototype.hasOwnProperty.call(afterRemovingA.projectMetadata, projectA.id))
assert.equal(afterRemovingA.projectMetadata[projectB.id].name, 'B 项目配置')
records.toggleFavoriteById(favoriteRecord.id)
assert.equal(records.deleteProject(projectB.id), true)
const afterDeletingB = records.getRecords().find((record) => record.id === favoriteRecord.id)
assert(afterDeletingB.favorite, '删项目后已收藏记录继续保留')
assert.deepEqual(afterDeletingB.projectIds, [])
assert(!afterDeletingB.projectMetadata || !Object.keys(afterDeletingB.projectMetadata).length,
  '删项目会清除该项目的元数据键')

assert.equal(records.STORAGE_SCHEMA_VERSION, SCHEMA_VERSION, '不升级存储 schema')
assert.deepEqual([...storage.keys()].sort(), [ACTIVE_KEY, PROJECTS_KEY, RECORDS_KEY, SCHEMA_KEY,
  'audioTool.limiter.preferences'].sort(), '不创建新的存储键')
const projectMarkup = fs.readFileSync(path.resolve(__dirname, '../pages/records/project.wxml'), 'utf8')
assert(projectMarkup.includes("record.hasProjectMetadata ? 'record-title-project-config'"),
  '只有有效项目配置元数据标题使用专用换行样式类')
assert(projectMarkup.includes('class="record-summary record-project-note">配置备注：{{record.projectNote}}'),
  '项目备注行使用独立保留换行的样式类')
const projectStyles = fs.readFileSync(path.resolve(__dirname, '../pages/records/project.wxss'), 'utf8')
assert(projectStyles.includes('.record-title-project-config,.record-project-note{min-width:0;word-break:break-all;overflow-wrap:anywhere}'))
assert(projectStyles.includes('.record-project-note{white-space:pre-wrap'), '项目备注样式保留手动换行')

console.log('limiter project metadata tests passed')

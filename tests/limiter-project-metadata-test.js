const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const FAVORITES_KEY = 'audioTool.favorites.v1'
const RECOVERY_KEY = 'audioTool.recovery.v1'
const ACTIVE_KEY = 'audioTool.activeProject.v1'
const SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const SCHEMA_VERSION = 4
const { amplifiers, speakers } = require('../data/equipment')
const { calculateLimiter } = require('../utils/limiter')

const storage = new Map([
  [RECORDS_KEY, []],
  [PROJECTS_KEY, []],
  [FAVORITES_KEY, []],
  [RECOVERY_KEY, []],
  [ACTIVE_KEY, ''],
  [SCHEMA_KEY, SCHEMA_VERSION],
])
const writeCounts = new Map()
let failedWriteKey = ''
let failedReadKey = ''
const navigatedUrls = []

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
  navigateTo({ url }) { navigatedUrls.push(url) },
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
const reportModel = require('../pages/records/report-model')
const latestCalibrationSource = reportModel.loadProjectReportSource(projectC.id)
assert.equal(latestCalibrationSource.ok, true, latestCalibrationSource.error)
const latestCalibrationItem = reportModel.getProjectReportSections(latestCalibrationSource)
  .find((section) => section.key === 'calculation').items
  .find((item) => item.record.id === refreshedCalibrationRecord.id)
assert(latestCalibrationItem, 'the current calibration record remains selectable in the PDF report')
const latestCalibrationReport = reportModel.buildReportPayload(latestCalibrationSource, [latestCalibrationItem.id])
assert.equal(latestCalibrationReport.selectedItems[0].record.resultText, currentCalibrationPayload.resultText,
  'the PDF report snapshot uses the latest result for an unchanged input signature')
const latestCalibrationText = latestCalibrationReport.pages.flatMap((page) => page.lines)
  .map((line) => line.text).join('')
assert(latestCalibrationText.includes(`关键结果：${currentCalibrationPayload.summary}`))
assert(!latestCalibrationText.includes(previousCalibrationPayload.summary),
  'the PDF report does not show the superseded calibration summary')

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
assert.equal(records.addRecordToProject({ ...payload, module: 'projectWiring' }, projectA.id, {
  name: '其他模块', note: '',
}), null, '共享记录元数据仍拒绝未授权模块')

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
assert.notEqual(favoriteEnabled.id, records.getRecordByPayload(payload).id, '收藏使用独立快照编号')
assert.equal(favoriteEnabled.title, payload.title, '添加项目名称后收藏仍保留当前计算标题')
assert.equal(favoriteEnabled.resultText, payload.resultText)
assert.deepEqual(favoriteEnabled.projectIds, [])
assert.deepEqual(favoriteEnabled.originProjectIds, [projectA.id, projectB.id, projectC.id], '收藏保留所有来源项目关系')
assert.equal(favoriteEnabled.projectMetadata, undefined, '收藏不继承项目内可编辑名称和备注')
let favoriteRecord = records.getRecordByPayload(payload)
assert.equal(favoriteRecord.favorite, false, '收藏变化不改项目计算记录')
assert.equal(favoriteRecord.projectMetadata[projectA.id].name, '有效名称')
assert.equal(favoriteRecord.projectMetadata[projectB.id].name, 'B 项目配置')
const limiterPreferenceKey = 'audioTool.limiter.preferences'
const originalTemporaryPreferences = { amplifierModel: 'temporary', draft: '保留临时输入' }
storage.set(limiterPreferenceKey, originalTemporaryPreferences)
assert.equal(records.restoreRecord(favoriteEnabled), '/pages/limiter/limiter')
assert.deepEqual(storage.get(limiterPreferenceKey), originalTemporaryPreferences,
  '路由兼容助手不直接覆盖临时输入，工作副本由编辑上下文管理')
const recordContext = require('../utils/result-record-context')
const sessionId = recordContext.openRecordEditor(favoriteEnabled, 'favorite')
assert.ok(sessionId)
const editorPage = {
  data: {},
  setData(changes) { Object.assign(this.data, changes) },
  getRecordPayload() { return favoriteEnabled },
  getEditorPreferences() { return favoriteEnabled.preferences },
}
const session = recordContext.attachResultEditor(editorPage, 'limiter', { editorSessionId: sessionId })
assert.equal(session.sourceKind, 'favorite')
assert.equal(session.recordId, '')
assert.deepEqual(Object.keys(session.preferences), [
  'amplifierModel', 'speakerModel', 'count', 'wiring', 'mode', 'sensitivityVoltage', 'highPassFrequency',
], '收藏工作副本保留当前限幅器参数字段顺序')
assert.deepEqual(storage.get(limiterPreferenceKey), preferences)
assert.equal(recordContext.discardResultEditor(editorPage), true)
assert.deepEqual(storage.get(limiterPreferenceKey), originalTemporaryPreferences, '放弃工作副本后恢复临时输入')
assert.deepEqual(records.getFavoriteByPayload(payload), favoriteEnabled, '载入和放弃不改收藏快照')
assert.equal(records.toggleFavoriteById(favoriteEnabled.id), null)
assert.equal(records.getFavoriteByPayload(payload), null)
assert(records.getRecoveryEntries().some((entry) => entry.kind === 'favorite' && entry.targetId === favoriteEnabled.id))
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

function captureReportPage() {
  let definition
  const previousPage = global.Page
  global.Page = (value) => { definition = value }
  const reportPagePath = require.resolve('../pages/records/report')
  delete require.cache[reportPagePath]
  require(reportPagePath)
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
const viewSignatureRecord = JSON.parse(projectPage.projectViewSignature).records
  .find((record) => record.id === favoriteRecord.id)
assert.equal(viewSignatureRecord.title, limiterView.title)
assert.equal(viewSignatureRecord.hasProjectMetadata, true)
assert.equal(viewSignatureRecord.projectNote, limiterView.projectNote)
assert.equal(viewSignatureRecord.updatedAt, limiterView.updatedAt)

const longNote = '甲乙丙丁戊己庚辛壬癸'.repeat(20)
const fixedSavedAt = Date.now() + 5000
const originalDateNow = Date.now
let noteOnlyRecord
let reportPage
let previousViewSignature
let previousReportSourceFingerprint
try {
  Date.now = () => fixedSavedAt
  records.addRecordToProject(payload, projectA.id, { name: '有效名称', note: '时间戳基准备注' })
  projectPage.refresh()
  const baselineProject = records.getProjects().find((project) => project.id === projectA.id)
  assert.equal(baselineProject.updatedAt, fixedSavedAt)

  reportPage = captureReportPage()
  reportPage.onLoad({ id: projectA.id })
  const initialSections = reportModel.getProjectReportSections(reportPage.reportSource)
  const initialReportItem = initialSections.find((section) => section.key === 'calculation')
    .items.find((item) => item.record.id === favoriteRecord.id)
  assert(initialReportItem, 'the current project report loads the metadata record')
  previousReportSourceFingerprint = reportPage._sourceFingerprint
  previousViewSignature = projectPage.projectViewSignature
  const cachedSignature = JSON.stringify({
    source: reportPage._sourceFingerprint,
    selectedIds: [initialReportItem.id],
  })
  reportPage.reportSignature = cachedSignature
  reportPage._reportPages = [{ path: 'temp://cached-report-page.png' }]
  reportPage._reportPdfPath = 'temp://cached-pdf.pdf'
  reportPage._reportPdfSignature = cachedSignature
  reportPage.setData({
    mode: 'preview',
    reportPages: reportPage._reportPages,
    currentPagePath: 'temp://cached-report-page.png',
    pageCount: 1,
    reportPdfPath: 'temp://cached-pdf.pdf',
  })

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
  assert.equal(reportPage.refreshSourceForGeneration(), false,
    '仅备注变化即使 savedAt 不变也要求当前 PDF 报告刷新来源')
  assert.notEqual(reportPage._sourceFingerprint, previousReportSourceFingerprint,
    '报告来源指纹包含项目内备注变化')
  assert.equal(reportPage.reportSignature, '', '来源变化后清除旧报告签名')
  assert.deepEqual(reportPage._reportPages, [], '来源变化后清除已生成的分页预览缓存')
  assert.equal(reportPage._reportPdfPath, '', '来源变化后清除已生成的 PDF 文件缓存')
  assert.equal(reportPage._reportPdfSignature, '')
  assert.equal(reportPage.data.mode, 'select')
  assert.deepEqual(reportPage.data.reportPages, [])
  assert.equal(reportPage.data.currentPagePath, '')
  assert.equal(reportPage.data.pageCount, 0)
  assert.equal(reportPage.data.reportPdfPath, '')
} finally {
  Date.now = originalDateNow
}
limiterView = projectPage.data.recordGroups.find((group) => group.module === 'limiter')
  .records.find((record) => record.id === favoriteRecord.id)
assert.equal(limiterView.title, '有效名称')
assert.equal(limiterView.projectNote, longNote)
assert.equal(limiterView.updatedAt, noteOnlyRecord.projectMetadata[projectA.id].savedAt)

const reportSections = reportModel.getProjectReportSections(reportPage.reportSource)
const reportItem = reportSections.find((section) => section.key === 'calculation')
  .items.find((item) => item.record.id === favoriteRecord.id)
const reportPayload = reportModel.buildReportPayload(reportPage.reportSource, [reportItem.id])
assert.equal(reportPayload.itemCount, 1)
assert.equal(reportPayload.selectedItems[0].record.resultText, payload.resultText,
  'the PDF report snapshot retains the complete saved calculation result')
assert.equal(reportPayload.selectedItems[0].record.projectNote, longNote)
assert.equal(reportPayload.selectedItems[0].record.title, '有效名称')
const reportText = reportPayload.pages.flatMap((page) => page.lines).map((line) => line.text).join('')
assert(reportText.includes('项目方案名称：有效名称'))
assert(reportText.includes(`项目备注：${longNote}`), 'the PDF report contains the full untruncated metadata note')
assert(reportText.includes(`关键结果：${noteOnlyRecord.summary}`))
assert(reportText.includes(`保存时间：${new Date(noteOnlyRecord.projectMetadata[projectA.id].savedAt).toLocaleString('zh-CN')}`),
  'the PDF report shows the project record saved time')
assert(reportText.includes('功放型号：TC-2350B'))
assert(reportText.includes('音箱型号：TS-803C'))
const metadataBeforeProjection = clone(favoriteRecord.projectMetadata)
const projectionWrites = [...writeCounts.values()].reduce((sum, count) => sum + count, 0)
const projected = records.getProjectRecordView(favoriteRecord, projectA.id)
assert.equal(projected.title, '有效名称')
assert.equal(projected.hasProjectMetadata, true, '只读投影标记有效的项目配置元数据')
projected.title = '投影修改'
projected.projectMetadata[projectA.id].name = '投影修改'
projected.preferences.amplifierModel = '投影修改'
projected.projectIds.push('投影修改')
assert.equal(favoriteRecord.title, '旧调用方标题', '收藏快照不再改写共享项目记录标题')
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
  module: 'dmxAddress',
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
  module: 'camera',
  title: '旧版其他模块记录',
  summary: '旧版摘要',
  resultText: '旧版结果',
  preferences: { legacy: true },
  projectMetadata: { legacyExtra: { note: '其他工具保留的旧扩展字段' } },
}
const legacyExtraRecord = records.addRecordToProject(legacyExtraPayload, projectC.id)
assert(legacyExtraRecord)
const legacyExtraFavorite = records.toggleFavorite(legacyExtraPayload)
assert(legacyExtraFavorite?.favorite)
assert.notEqual(legacyExtraFavorite.id, legacyExtraRecord.id, '扩展记录的收藏也使用独立 ID')
assert.deepEqual(legacyExtraFavorite.originProjectIds, [projectC.id])
assert.equal(records.removeRecordFromProject(legacyExtraRecord.id, projectC.id), true)
assert.equal(records.getRecordById(legacyExtraRecord.id), null, '移除最后一个项目关联后活动记录退出列表')
assert(records.getRecoveryEntries().some((entry) => entry.kind === 'record-project-link'
  && entry.snapshot.id === legacyExtraRecord.id), '移除关联保留记录快照供恢复')
const reattachedLegacyExtra = records.addRecordToProject(legacyExtraPayload, projectC.id)
assert(reattachedLegacyExtra)
assert.deepEqual(reattachedLegacyExtra.projectMetadata, legacyExtraPayload.projectMetadata,
  '重新加入时保留其他模块的既有 projectMetadata 扩展字段')
assert.equal(records.deleteProject(projectC.id), true)
let retainedLegacyExtra = records.getRecordById(reattachedLegacyExtra.id)
assert.equal(retainedLegacyExtra.favorite, false, '项目计算记录不被收藏标记污染')
assert.deepEqual(retainedLegacyExtra.projectMetadata, legacyExtraPayload.projectMetadata,
  '删除项目时保留其他模块的 legacy 扩展字段')
assert.deepEqual(retainedLegacyExtra.projectIds, [projectC.id], '删除项目时暂存原记录关系')
assert.equal(records.getProjects().some((item) => item.id === projectC.id), false)
const legacyProjectRecovery = records.getRecoveryEntries().find((entry) => entry.kind === 'project'
  && entry.targetId === projectC.id)
assert(legacyProjectRecovery && records.restoreRecoveryEntry(legacyProjectRecovery.id))
assert.equal(records.getRecordById(reattachedLegacyExtra.id).id, reattachedLegacyExtra.id)
assert.deepEqual(records.getRecordById(reattachedLegacyExtra.id).projectMetadata, legacyExtraPayload.projectMetadata)
assert.equal(records.getFavoriteByPayload(legacyExtraPayload).id, legacyExtraFavorite.id,
  '恢复项目不影响独立收藏快照')

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
assert.deepEqual(new Set(afterRemovingA.projectIds), new Set([projectB.id, projectC.id]),
  '移除 A 后保留其他项目的共享记录关联')
assert(!Object.prototype.hasOwnProperty.call(afterRemovingA.projectMetadata, projectA.id))
assert.equal(afterRemovingA.projectMetadata[projectB.id].name, 'B 项目配置')
const retainedPayloadFavorite = records.toggleFavorite(payload)
assert(retainedPayloadFavorite?.favorite)
assert.equal(records.deleteProject(projectB.id), true)
const afterDeletingB = records.getRecords().find((record) => record.id === favoriteRecord.id)
assert.equal(afterDeletingB.favorite, false, '项目记录不承载收藏状态')
assert.deepEqual(new Set(afterDeletingB.projectIds), new Set([projectB.id, projectC.id]), '删项目时暂存关系供恢复')
assert.equal(afterDeletingB.projectMetadata[projectB.id].name, 'B 项目配置')
assert.equal(records.getProjects().some((item) => item.id === projectB.id), false)
const projectBRecovery = records.getRecoveryEntries().find((entry) => entry.kind === 'project'
  && entry.targetId === projectB.id)
assert(projectBRecovery && records.restoreRecoveryEntry(projectBRecovery.id))
assert.equal(records.getRecordById(favoriteRecord.id).projectMetadata[projectB.id].name,
  'B 项目配置', '恢复项目后关联 metadata 与记录 ID 保持不变')
assert.equal(records.getFavoriteByPayload(payload).id, retainedPayloadFavorite.id,
  '独立收藏在删除和恢复项目时保持不变')

assert.equal(records.STORAGE_SCHEMA_VERSION, SCHEMA_VERSION, '不升级存储 schema')
assert.deepEqual([...storage.keys()].sort(), [ACTIVE_KEY, FAVORITES_KEY, PROJECTS_KEY, RECORDS_KEY,
  RECOVERY_KEY, SCHEMA_KEY, 'audioTool.dmxLightingWorkspace.v2', 'audioTool.limiter.preferences',
  'audioTool.resultEditorSessions.v1'].sort(), '独立收藏、恢复和编辑上下文使用各自存储键')
const projectMarkup = fs.readFileSync(path.resolve(__dirname, '../pages/records/project.wxml'), 'utf8')
assert(projectMarkup.includes('{{record.title}}'), '项目计算记录以项目投影标题呈现')
assert(projectMarkup.includes('{{record.projectNote}}'), '项目记录仍呈现本项目配置备注')
const projectStyles = fs.readFileSync(path.resolve(__dirname, '../pages/records/project.wxss'), 'utf8')
assert(projectStyles.includes('.interior-item-subtitle'), '项目记录摘要和备注使用紧凑副标题样式')

console.log('limiter project metadata tests passed')

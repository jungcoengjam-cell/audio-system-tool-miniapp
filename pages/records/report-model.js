const REPORT_WIDTH = 750
const REPORT_MAX_PAGE_HEIGHT = 3200
const REPORT_MARGIN_X = 48
const REPORT_CONTENT_WIDTH = REPORT_WIDTH - (REPORT_MARGIN_X * 2)
const LIGHTING_WORKSPACE_KEY = 'audioTool.dmxLightingWorkspace.v2'
const LIGHTING_ENVELOPE_VERSION = 1
const LIGHTING_SCHEME_VERSION = 2

const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)

const COMMON_PREFERENCE_LABELS = Object.freeze({
  id: '编号', stableId: '编号', position: '布置位置',
  x: '水平坐标', y: '垂直坐标', zone: '区域', row: '排号', column: '列号',
  fixtureIndex: '灯具序号', groupIndex: '灯具组序号', fixtureId: '灯具编号',
  addressText: '首地址', rangeText: '占用地址范围', startAddress: '起始地址',
  endAddress: '结束地址', endAddressText: '结束地址', universe: 'DMX 域序号',
  universeLabel: 'DMX 域', groups: '灯具组', output: '输出端', input: '输入端',
})

const PREFERENCE_LABELS_BY_MODULE = Object.freeze({
  limiter: Object.freeze({
    amplifierModel: '功放型号', speakerModel: '音箱型号', count: '音箱数量（只/通道）',
    wiring: '音箱连接方式', mode: '限幅器工作模式', sensitivityVoltage: '输入灵敏度（V）',
    highPassFrequency: '通道高通频率（Hz）',
  }),
  spl: Object.freeze({
    speakerModel: '音箱型号', speakerCount: '音箱数量（只）',
    distanceText: '测量距离（m）', summationMode: '声压级叠加方式',
  }),
  cable: Object.freeze({
    mode: '线材选型方式', environment: '敷设环境',
    constantPowerText: '定压系统总功率（W）', constantDistanceText: '定压系统单程距离（m）',
    professionalPowerText: '专业音箱总功率（W）', professionalDistanceText: '专业音箱单程距离（m）',
  }),
  camera: Object.freeze({
    cameraCalculationVersion: '摄像机计算版本', sourceMode: '参数来源', cameraModel: '摄像机型号',
    viewIndex: '视角序号', viewLabel: '镜头视角', definitionMode: '视场角参数方式',
    customMountType: '自定义镜头安装方式', customHorizontalFovText: '自定义水平视场角（°）',
    customVerticalFovText: '自定义垂直视场角（°）', customSensorWidthText: '传感器宽度（mm）',
    customSensorHeightText: '传感器高度（mm）', customFocalLengthText: '焦距（mm）',
    sceneMode: '目标场景', heightMode: '镜头高度方式', marginPercent: '构图余量（%）',
    groundWidthText: '拍摄区域宽度（m）', groundDepthText: '拍摄区域纵深（m）',
    subjectHeightText: '人物最高点（m）', planeWidthText: '目标宽度（m）',
    planeHeightText: '目标高度（m）', planeBottomHeightText: '目标底边离地高度（m）',
    fixedCameraHeightText: '镜头中心高度（m）',
  }),
  gainStructure: Object.freeze({
    amplifierModel: '功放型号', stageValue: '功放输入级参数', mode: '功放工作模式',
    loadImpedance: '负载阻抗（Ω）', targetPeakDbfs: 'DSP 目标峰值（dBFS）',
  }),
  dmxAddress: Object.freeze({
    startAddressText: '起始 DMX 地址', allocationMode: '编址方式', groupSummary: '灯具组摘要',
    version: '灯光编址参数版本', name: '灯具组名称', fixtureModel: '灯具型号',
    fixtureSource: '灯具型号来源', customName: '自定义灯具名称',
    fixtureCount: '灯具数量（台）', channelCount: '通道数（CH/台）',
    libraryChannelCount: '灯库通道模式（CH/台）', customChannelCount: '自定义通道数（CH/台）',
    targetUniverse: '目标 DMX 域',
  }),
  ledScreen: Object.freeze({
    wallWidthText: '墙体宽度（m）', wallHeightText: '墙体高度（m）',
    topReserveText: '上方预留（m）', bottomReserveText: '下方预留（m）',
    frameWidthText: '四周包边（cm/每边）', viewingDistanceText: '观看距离（m）',
    aspectRatio: '目标画面比例', unitKey: '拼装单元', pitch: '像素点间距（mm）',
  }),
  audioWiring: Object.freeze({
    version: '接线偏好版本', outputId: '输出设备接口类型', inputId: '输入设备接口类型',
    manualSelected: '手动选择状态', viewMode: '接线展示方式', face: '接头查看面',
    selections: '接口组合选项', outputMode: '输出端接法', destinationChannel: '输入目标声道',
    sourceChannel: '输出源声道',
  }),
})

const LINE_LABELS = Object.freeze({
  buildType: { finished: '成品线', bulk: '散线制作' },
  cableType: { balanced: '平衡音频线', unbalanced: '非平衡音频线', speaker: '扬声器线', custom: '自定义线材' },
  connector: {
    xlrFemale: 'XLR 母头', xlrMale: 'XLR 公头', trs635: '6.35 mm TRS', ts635: '6.35 mm TS',
    trs35: '3.5 mm TRS', rcaMale: 'RCA 公头', rcaFemale: 'RCA 母头', speakon2: 'Speakon NL2',
    speakon4: 'Speakon NL4', terminal: '接线端子', bareWire: '裸线 / 压接端', custom: '自定义接头',
  },
  status: { pending: '待施工', connected: '已连接', checked: '已核对' },
})

const TYPE_LABELS = Object.freeze({
  calculation: '计算记录',
  wiring: '线路',
  lighting: '灯位方案',
})

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function text(value, fallback = '未填写') {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function validStableId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 120
}

function readLightingProjectContext(projectId, options = {}) {
  const getStorage = options.getStorage || ((key) => wx.getStorageSync(key))
  const calculateScheme = options.calculateScheme || require('../dmx-layout/lighting-workspace').calculateScheme
  let envelope
  try {
    envelope = getStorage(LIGHTING_WORKSPACE_KEY)
  } catch (error) {
    return { ok: false, error: '灯位工作区读取失败，项目报告无法确认灯位内容。' }
  }
  if (envelope === undefined || envelope === null || envelope === '') return { ok: true, lighting: null }
  if (!isObject(envelope) || envelope.version !== LIGHTING_ENVELOPE_VERSION || !isObject(envelope.contexts)) {
    return { ok: false, error: '灯位工作区版本或格式异常，项目报告无法读取灯位内容。' }
  }
  const entry = envelope.contexts[projectId]
  if (entry === undefined) return { ok: true, lighting: null }
  if (!isObject(entry) || !Number.isSafeInteger(entry.revision) || entry.revision < 0
    || !isObject(entry.scheme) || entry.scheme.version !== LIGHTING_SCHEME_VERSION
    || !isObject(entry.scheme.preferences) || !Array.isArray(entry.scheme.preferences.groups)
    || !Array.isArray(entry.scheme.groupIds) || !isObject(entry.scheme.fixtureIdsByGroup)) {
    return { ok: false, error: '项目灯位方案格式异常，未将其加入候选。' }
  }

  const scheme = clone(entry.scheme)
  const groupIds = scheme.groupIds
  if (groupIds.length !== scheme.preferences.groups.length
    || Object.keys(scheme.fixtureIdsByGroup).length !== groupIds.length
    || groupIds.some((id) => !own(scheme.fixtureIdsByGroup, id))
    || groupIds.some((id) => !validStableId(id))
    || new Set(groupIds).size !== groupIds.length) {
    return { ok: false, error: '灯位组缺少完整编号，未将灯位方案加入候选。' }
  }
  const fixtureIds = new Set()
  for (let index = 0; index < groupIds.length; index += 1) {
    const groupId = groupIds[index]
    const count = Number(scheme.preferences.groups[index]?.fixtureCount)
    const ids = scheme.fixtureIdsByGroup[groupId]
    if (!Number.isInteger(count) || count < 0 || count > 200 || !Array.isArray(ids) || ids.length !== count
      || new Set(ids).size !== ids.length || ids.some((id) => !validStableId(id) || fixtureIds.has(id))) {
      return { ok: false, error: `第 ${index + 1} 组灯位编号与数量不匹配，未将灯位方案加入候选。` }
    }
    ids.forEach((id) => fixtureIds.add(id))
  }

  let calculated
  try {
    calculated = calculateScheme(clone(scheme))
  } catch (error) {
    return { ok: false, error: '灯位方案计算失败，未将灯位方案加入候选。' }
  }
  if (!calculated?.ok || !calculated.valid || !calculated.result || !Array.isArray(calculated.result.fixtures)
    || calculated.result.fixtures.length !== fixtureIds.size
    || new Set(calculated.result.fixtures.map((fixture) => fixture?.stableId)).size !== fixtureIds.size) {
    return { ok: false, error: calculated?.error || '灯位方案无法生成完整地址，未将其加入候选。' }
  }
  const positionsById = isObject(scheme.layout?.positionsById) ? scheme.layout.positionsById : {}
  const fixtures = calculated.result.fixtures.map((fixture) => {
    if (!validStableId(fixture?.stableId) || !fixtureIds.has(fixture.stableId)) return null
    return {
      ...clone(fixture),
      stableId: fixture.stableId,
      position: own(positionsById, fixture.stableId) ? clone(positionsById[fixture.stableId]) : null,
    }
  })
  if (fixtures.some((fixture) => !fixture)) {
    return { ok: false, error: '灯位地址与灯具编号无法对应，未将灯位方案加入候选。' }
  }
  const hasSavedContent = entry.revision > 0 || groupIds.length > 0 || Boolean(scheme.layout)
  if (!hasSavedContent) return { ok: true, lighting: null }
  return {
    ok: true,
    lighting: {
      projectId,
      revision: entry.revision,
      scheme: clone(scheme),
      plan: clone(calculated.result),
      fixtures,
      positionsById: clone(positionsById),
    },
  }
}

function loadProjectReportSource(projectId, dependencies = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    return { ok: false, error: '缺少项目编号。' }
  }
  const recordsApi = dependencies.recordsApi || require('../../utils/records')
  let snapshot
  try {
    snapshot = recordsApi.getWorkspaceSnapshot({ forceRefresh: true })
  } catch (error) {
    return { ok: false, error: '项目资料读取失败，请重试。' }
  }
  if (!snapshot?.ok || !Array.isArray(snapshot.projects) || !Array.isArray(snapshot.records)) {
    return { ok: false, error: snapshot?.error || '项目资料读取失败，请重试。' }
  }
  const project = snapshot.projects.find((item) => item.id === projectId)
  if (!project) return { ok: false, error: '项目不存在或已删除。' }

  const records = snapshot.records
    .filter((record) => Array.isArray(record.projectIds) && record.projectIds.includes(projectId))
    .map((record) => recordsApi.getProjectRecordView(record, projectId))
  let wiring
  try {
    wiring = recordsApi.getProjectWiring(projectId)
  } catch (error) {
    return { ok: false, error: '项目线路读取失败，请重试。' }
  }
  if (!wiring?.ok || !wiring.schedule || !Array.isArray(wiring.schedule.lines)) {
    return { ok: false, error: wiring?.error || '项目线路读取失败，请重试。' }
  }
  const lightingResult = readLightingProjectContext(projectId, dependencies.lightingOptions || {})
  if (!lightingResult.ok) return { ok: false, error: lightingResult.error }
  return {
    ok: true,
    project: clone(project),
    records: records.map(clone),
    schedule: clone(wiring.schedule),
    lighting: lightingResult.lighting,
  }
}

function getProjectReportSections(source) {
  if (!source?.ok || !source.project) return []
  const sections = []
  const calculations = (source.records || []).map((record) => ({
    id: `record:${record.id}`,
    stableId: record.id,
    type: 'calculation',
    title: record.title || record.summary || '计算记录',
    subtitle: `${require('../../utils/records').getModuleMetadata(record.module)?.label || record.module} · ${record.summary || ''}`,
    record,
  }))
  if (calculations.length) sections.push({ key: 'calculation', title: '计算记录', items: calculations })

  const devicesById = new Map((source.schedule.devices || []).map((device) => [device.id, device]))
  const lines = (source.schedule.lines || []).map((line) => {
    const fromDevice = line.fromDeviceId ? devicesById.get(line.fromDeviceId) : null
    const toDevice = line.toDeviceId ? devicesById.get(line.toDeviceId) : null
    return {
      id: `line:${line.id}`,
      stableId: line.id,
      type: 'wiring',
      title: `${line.code || '线路'} · ${line.fromDevice || fromDevice?.name || '来源设备'} → ${line.toDevice || toDevice?.name || '去向设备'}`,
      subtitle: `${line.spec || '规格待确认'} · ${line.lengthText ? `${line.lengthText} m` : '长度待确认'}`,
      line,
      fromDeviceName: fromDevice?.name || line.fromDevice,
      toDeviceName: toDevice?.name || line.toDevice,
    }
  })
  if (lines.length) sections.push({ key: 'wiring', title: '线路', items: lines })

  if (source.lighting) {
    sections.push({
      key: 'lighting',
      title: '灯位方案',
      items: [{
        id: `lighting:${source.project.id}`,
        stableId: source.project.id,
        type: 'lighting',
        title: `项目灯位方案 · ${source.lighting.fixtures.length} 台灯具`,
        subtitle: `${source.lighting.plan.totalGroups || 0} 组 · ${source.lighting.plan.startText || '未编址'}`,
        lighting: source.lighting,
      }],
    })
  }
  return sections
}

function getReportSourceFingerprint(source) {
  if (!source?.ok || !source.project) return ''
  const records = [...(source.records || [])].sort((left, right) => String(left.id).localeCompare(String(right.id)))
  return JSON.stringify({
    project: source.project,
    records,
    schedule: source.schedule,
    lighting: source.lighting,
  })
}

function formatValue(value) {
  if (value === null) return 'null'
  if (value === undefined) return '未填写'
  if (typeof value === 'string') return value === '' ? '（空）' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function flattenEntries(value, labels = COMMON_PREFERENCE_LABELS, prefix = []) {
  if (Array.isArray(value)) {
    if (!value.length) return [{ label: prefix.length ? (labels[prefix[prefix.length - 1]] || `原始字段 ${prefix.join('.')}`) : '参数', value: '（空列表）' }]
    return value.flatMap((item, index) => flattenEntries(item, labels, [...prefix, String(index)]))
  }
  if (isObject(value)) {
    const keys = Object.keys(value)
    if (!keys.length) return [{ label: prefix.length ? (labels[prefix[prefix.length - 1]] || `原始字段 ${prefix.join('.')}`) : '参数', value: '（空对象）' }]
    return keys.flatMap((key) => flattenEntries(value[key], labels, [...prefix, key]))
  }
  const key = prefix[prefix.length - 1]
  const known = key && labels[key]
  const path = prefix.filter((part) => !/^\d+$/.test(part))
  const label = known
    ? (path.length > 1 ? `${path.slice(0, -1).map((part) => labels[part] || part).join(' / ')} · ${known}` : known)
    : `原始字段 ${prefix.join('.')}`
  return [{ label, value: formatValue(value) }]
}

function linesForPreferences(preferences, module) {
  return formatPreferenceRows(preferences, module).map((entry) => `${entry.label}：${entry.value}`)
}

function formatPreferenceRows(preferences, module) {
  const labels = { ...COMMON_PREFERENCE_LABELS, ...(PREFERENCE_LABELS_BY_MODULE[module] || {}) }
  return flattenEntries(preferences, labels)
}

function mapLineValue(value, labelSet) {
  return labelSet[value] || (value ? String(value) : '未填写')
}

function linesForCalculation(record) {
  const moduleMeta = require('../../utils/records').getModuleMetadata(record.module)
  const lines = [
    { text: `计算记录 · ${moduleMeta?.label || record.module}`, style: 'section' },
    { text: record.title || record.summary || '计算记录', style: 'heading' },
    { text: `记录编号：${record.id}`, style: 'mono' },
    { text: `保存时间：${new Date(record.updatedAt || record.createdAt || 0).toLocaleString('zh-CN')}`, style: 'muted' },
  ]
  if (record.hasProjectMetadata) {
    if (record.title) lines.push({ text: `项目方案名称：${record.title}`, style: 'body' })
    if (record.projectNote) lines.push({ text: `项目备注：${record.projectNote}`, style: 'body' })
  }
  if (record.summary) lines.push({ text: `关键结果：${record.summary}`, style: 'body' })
  const keyFields = {
    spl: ['speakerModel', 'speakerCount', 'distanceText', 'summationMode'],
    cable: ['mode', 'environment', 'constantPowerText', 'constantDistanceText', 'professionalPowerText', 'professionalDistanceText'],
    camera: ['cameraModel', 'viewLabel', 'sceneMode', 'heightMode', 'marginPercent', 'groundWidthText', 'groundDepthText', 'subjectHeightText', 'planeWidthText', 'planeHeightText', 'planeBottomHeightText', 'fixedCameraHeightText'],
    ledScreen: ['wallWidthText', 'wallHeightText', 'topReserveText', 'bottomReserveText', 'frameWidthText', 'viewingDistanceText', 'aspectRatio', 'unitKey', 'pitch'],
    dmxAddress: ['startAddressText', 'allocationMode', 'groupSummary'],
    limiter: ['amplifierModel', 'speakerModel', 'count', 'wiring', 'mode', 'sensitivityVoltage', 'highPassFrequency'],
    gainStructure: ['amplifierModel', 'stageValue', 'mode', 'loadImpedance', 'targetPeakDbfs'],
  }[record.module] || []
  const selectedPreferences = Object.fromEntries(keyFields
    .filter((key) => own(record.preferences, key))
    .map((key) => [key, record.preferences[key]]))
  if (Object.keys(selectedPreferences).length) {
    lines.push({ text: '关键输入', style: 'subhead' })
    linesForPreferences(selectedPreferences, record.module).forEach((text) => lines.push({ text, style: 'body' }))
  }
  if (record.module === 'gainStructure') {
    const conditionPrefixes = ['输入级档位：', '工作条件：', 'DSP 标定：']
    const savedConditions = String(record.resultText || '').split(/\r\n|\r|\n/)
    const conditionLines = conditionPrefixes
      .map((prefix) => savedConditions.find((line) => line.startsWith(prefix)))
      .filter(Boolean)
    if (conditionLines.length) {
      lines.push({ text: '计算条件', style: 'subhead' })
      conditionLines.forEach((text) => lines.push({ text, style: 'body' }))
    }
  }
  return lines
}

function linesForWiring(item) {
  const line = item.line
  return [
    { text: '线路', style: 'section' },
    { text: `${line.code || '线路'} · ${line.purpose || '用途未填写'}`, style: 'heading' },
    { text: `线路编号：${line.id}`, style: 'mono' },
    { text: `来源设备：${item.fromDeviceName || line.fromDevice} · 端口：${line.fromPort}${line.fromDeviceId ? ` · 设备编号：${line.fromDeviceId}` : ''}`, style: 'body' },
    { text: `去向设备：${item.toDeviceName || line.toDevice} · 端口：${line.toPort}${line.toDeviceId ? ` · 设备编号：${line.toDeviceId}` : ''}`, style: 'body' },
    { text: `线材类型：${mapLineValue(line.cableType, LINE_LABELS.cableType)}`, style: 'body' },
    { text: `规格：${line.spec || '待确认'} · 长度：${line.lengthText ? `${line.lengthText} m` : '待确认'}`, style: 'body' },
    { text: `制作方式：${mapLineValue(line.buildType, LINE_LABELS.buildType)}`, style: 'body' },
    { text: `来源端接头：${mapLineValue(line.connectorA, LINE_LABELS.connector)}（${line.connectorA || '未填写'}）`, style: 'body' },
    { text: `去向端接头：${mapLineValue(line.connectorB, LINE_LABELS.connector)}（${line.connectorB || '未填写'}）`, style: 'body' },
    { text: `施工状态：${mapLineValue(line.status, LINE_LABELS.status)}`, style: 'body' },
    { text: `备注：${line.notes || '未填写'}`, style: 'body' },
  ]
}

function linesForLighting(lighting) {
  const lines = [
    { text: '灯位方案', style: 'section' },
    { text: `项目灯位方案 · 第 ${lighting.revision} 版`, style: 'heading' },
    { text: `项目编号：${lighting.projectId} · 工作区版本：${lighting.scheme.version} · 修订：${lighting.revision}`, style: 'mono' },
    { text: '完整编址参数', style: 'subhead' },
  ]
  linesForPreferences(lighting.scheme.preferences, 'dmxAddress').forEach((text) => lines.push({ text, style: 'body' }))
  lines.push({ text: '灯具地址与布置位置', style: 'subhead' })
  const fixturesById = new Map(lighting.fixtures.map((fixture) => [fixture.stableId, fixture]))
  lighting.scheme.groupIds.forEach((groupId, groupIndex) => {
    const preference = lighting.scheme.preferences.groups[groupIndex] || {}
    lines.push({ text: `灯具组：${preference.name || `第 ${groupIndex + 1} 组`} · 组编号：${groupId}`, style: 'heading' })
    lines.push({ text: `型号：${preference.fixtureModel || '自定义灯具'} · 数量：${preference.fixtureCount} 台 · 模式：${preference.channelCount} CH/台 · 域：${preference.targetUniverse || '自动'}`, style: 'body' })
    const groupFixtures = (lighting.scheme.fixtureIdsByGroup[groupId] || []).map((fixtureId) => fixturesById.get(fixtureId)).filter(Boolean)
    groupFixtures.forEach((fixture) => {
      const unplaced = fixture.position === null || fixture.position === undefined
      const positionText = unplaced ? '未布置（未进入灯位图）' : JSON.stringify(fixture.position)
      lines.push({ text: `灯具 ${fixture.fixtureIndex} · 灯具编号：${fixture.stableId}`, style: 'body' })
      lines.push({ text: `完整地址：${fixture.addressText} · 占用范围：${fixture.rangeText} · 通道：${fixture.channelCount} CH`, style: 'body' })
      lines.push({ text: `位置关联编号：${fixture.stableId}`, style: 'body' })
      lines.push({ text: `${unplaced ? '布置状态' : '布置数据'}：${positionText}`, style: unplaced ? 'muted' : 'body' })
    })
  })
  if (!lighting.fixtures.length) lines.push({ text: '此方案当前没有已编址灯具。', style: 'muted' })
  return lines
}

function buildReportPayload(source, selectedIds) {
  if (!source?.ok || !Array.isArray(selectedIds)) return null
  const sections = getProjectReportSections(source)
  const selected = new Set(selectedIds)
  const items = sections.flatMap((section) => section.items).filter((item) => selected.has(item.id))
  if (!items.length) return null
  const lines = [
    { text: '项目资料', style: 'section' },
    { text: `项目：${source.project.name}`, style: 'heading' },
    { text: `项目编号：${source.project.id}`, style: 'mono' },
    { text: `场地：${source.project.venueName || '未填写'} · 日期：${source.project.projectDate || '未填写'} · 负责人：${source.project.engineer || '未填写'}`, style: 'body' },
  ]
  const dimensions = [source.project.roomLengthText, source.project.roomWidthText, source.project.roomHeightText]
  if (dimensions.some(Boolean)) lines.push({ text: `场地尺寸（长 × 宽 × 高）：${dimensions.map((value) => value || '未填写').join(' × ')} m`, style: 'body' })
  if (source.project.standardClassKey || source.project.gradeKey) {
    lines.push({ text: `配置标准：${source.project.standardClassKey || '未填写'} · ${source.project.gradeKey || '未填写'}`, style: 'body' })
  }
  if (source.project.notes) lines.push({ text: `项目备注：${source.project.notes}`, style: 'body' })
  lines.push({ text: `报告内容：${items.length} 项`, style: 'muted' })
  items.forEach((item) => {
    const itemLines = item.type === 'calculation'
      ? linesForCalculation(item.record)
      : item.type === 'wiring'
        ? linesForWiring(item)
        : linesForLighting(item.lighting)
    lines.push(...itemLines, { text: '', style: 'spacer' })
  })
  const generatedLines = wrapReportLines(lines)
  const pages = paginateReportLines(generatedLines, source.project)
  const selectedItems = items.map((item) => clone(item))
  return {
    project: clone(source.project),
    selectedIds: [...selected].filter((id) => items.some((item) => item.id === id)),
    selectedTypes: [...new Set(items.map((item) => item.type))],
    itemCount: items.length,
    selectedItems,
    selectedSchedule: clone({
      version: source.schedule?.version,
      revision: source.schedule?.revision,
      nextNumber: source.schedule?.nextNumber,
      devices: source.schedule?.devices || [],
      lines: items.filter((item) => item.type === 'wiring').map((item) => item.line),
    }),
    pages,
  }
}

const STYLE = Object.freeze({
  section: { size: 20, lineHeight: 38, weight: 700, style: 'section' },
  heading: { size: 23, lineHeight: 34, weight: 650, style: 'heading' },
  subhead: { size: 20, lineHeight: 32, weight: 650, style: 'subhead' },
  body: { size: 18, lineHeight: 28, weight: 400, style: 'body' },
  muted: { size: 16, lineHeight: 25, weight: 400, style: 'muted' },
  mono: { size: 16, lineHeight: 25, weight: 400, style: 'mono' },
  spacer: { size: 1, lineHeight: 12, weight: 400, style: 'spacer' },
})

function safeCharacterWidth(character, size) {
  if (/^\s+$/.test(character)) return size * 0.4
  const point = character.codePointAt(0)
  if (point >= 0x1f000 && point <= 0x1faff) return size * 2
  if (/^[\x00-\xff]$/.test(character)) return size
  return size * 1.1
}

function isGraphemeExtension(character) {
  const point = character.codePointAt(0)
  return point === 0x200d
    || (point >= 0xfe00 && point <= 0xfe0f)
    || (point >= 0xe0100 && point <= 0xe01ef)
    || (point >= 0x0300 && point <= 0x036f)
    || (point >= 0x1ab0 && point <= 0x1aff)
    || (point >= 0x1dc0 && point <= 0x1dff)
    || (point >= 0x20d0 && point <= 0x20ff)
    || (point >= 0xfe20 && point <= 0xfe2f)
    || (point >= 0x1f3fb && point <= 0x1f3ff)
}

function graphemeClusters(value) {
  const clusters = []
  let regionalCount = 0
  for (const character of [...String(value)]) {
    const previous = clusters[clusters.length - 1] || ''
    const point = character.codePointAt(0)
    const isRegional = point >= 0x1f1e6 && point <= 0x1f1ff
    const previousIsRegionalOnly = previous.length > 0
      && [...previous].every((part) => {
        const partPoint = part.codePointAt(0)
        return partPoint >= 0x1f1e6 && partPoint <= 0x1f1ff
      })
    if (!clusters.length) {
      clusters.push(character)
      regionalCount = isRegional ? 1 : 0
    } else if (isGraphemeExtension(character) || previous.endsWith('\u200d')
      || (isRegional && previousIsRegionalOnly && regionalCount === 1)) {
      clusters[clusters.length - 1] += character
      if (isRegional) regionalCount += 1
    } else {
      clusters.push(character)
      regionalCount = isRegional ? 1 : 0
    }
  }
  return clusters
}

function wrapText(textValue, size, maxWidth = REPORT_CONTENT_WIDTH) {
  const output = []
  const paragraphs = String(textValue).split(/\r\n|\r|\n/)
  paragraphs.forEach((paragraph) => {
    if (!paragraph) {
      output.push('')
      return
    }
    let line = ''
    let width = 0
    for (const character of graphemeClusters(paragraph)) {
      const characterWidth = safeCharacterWidth(character, size)
      if (line && width + characterWidth > maxWidth) {
        output.push(line)
        line = character
        width = characterWidth
      } else {
        line += character
        width += characterWidth
      }
    }
    output.push(line)
  })
  return output
}

function wrapReportLines(lines) {
  return lines.flatMap((line) => {
    const style = STYLE[line.style] || STYLE.body
    const wrapped = wrapText(line.text, style.size)
    return wrapped.map((textValue) => ({ ...style, text: textValue }))
  })
}

function makeHeader(project, pageNumber, pageCount, generatedAt) {
  const nameLines = wrapText(project.name || '项目报告', 20, REPORT_CONTENT_WIDTH)
  return {
    nameLines,
    generatedAt,
    pageNumber,
    pageCount,
    height: 132 + (nameLines.length * 27),
  }
}

function paginateReportLines(lines, project) {
  const top = 42
  const footer = 56
  const headerHeight = 132 + (wrapText(project.name || '项目报告', 20, REPORT_CONTENT_WIDTH).length * 27)
  const pageCapacity = REPORT_MAX_PAGE_HEIGHT - top - footer - headerHeight
  const pageLineGroups = [[]]
  let used = 0
  lines.forEach((line, index) => {
    const next = lines[index + 1]
    const keepWithNext = line.style === 'section' || line.style === 'subhead'
    const needed = line.lineHeight + (keepWithNext && next ? next.lineHeight : 0)
    if (pageLineGroups[pageLineGroups.length - 1].length && used + needed > pageCapacity) {
      pageLineGroups.push([])
      used = 0
    }
    pageLineGroups[pageLineGroups.length - 1].push(line)
    used += line.lineHeight
  })
  const count = pageLineGroups.length
  const generatedAt = new Date().toLocaleString('zh-CN')
  return pageLineGroups.map((pageLines, index) => {
    const header = makeHeader(project, index + 1, count, generatedAt)
    const bodyHeight = pageLines.reduce((total, line) => total + line.lineHeight, 0)
    const height = Math.min(REPORT_MAX_PAGE_HEIGHT, Math.max(850, top + header.height + bodyHeight + footer))
    return { width: REPORT_WIDTH, height, top, header, lines: pageLines, pageNumber: index + 1, pageCount: count }
  })
}

function summarizeSelection(sections, selectedIds = []) {
  const selected = new Set(selectedIds)
  const allItems = sections.flatMap((section) => section.items)
  const count = allItems.filter((item) => selected.has(item.id)).length
  return {
    selectedCount: count,
    totalCount: allItems.length,
    allSelected: allItems.length > 0 && count === allItems.length,
    hasSelection: count > 0,
  }
}

module.exports = {
  LIGHTING_WORKSPACE_KEY,
  REPORT_WIDTH,
  REPORT_MAX_PAGE_HEIGHT,
  PREFERENCE_LABELS_BY_MODULE,
  buildReportPayload,
  flattenEntries,
  formatPreferenceRows,
  getProjectReportSections,
  getReportSourceFingerprint,
  graphemeClusters,
  loadProjectReportSource,
  paginateReportLines,
  readLightingProjectContext,
  summarizeSelection,
  safeCharacterWidth,
  wrapText,
  wrapReportLines,
}

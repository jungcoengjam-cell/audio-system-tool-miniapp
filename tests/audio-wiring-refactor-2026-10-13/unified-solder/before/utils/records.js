const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const ACTIVE_PROJECT_KEY = 'audioTool.activeProject.v1'
const STORAGE_SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const STORAGE_SCHEMA_VERSION = 3
const projectWiring = require('./project-wiring')
const storageValueCache = new Map()
const storageReadFailures = new Set()
let mutationDepth = 0
let mutationReadFailed = false
let normalizedRecordSource
let normalizedRecords = []
let recordSignatureIndex = new Map()
let normalizedProjectSource
let normalizedProjects = []

const MODULES = {
  limiter: {
    label: '限幅器',
    path: '/pages/limiter/limiter',
    preferenceKey: 'audioTool.limiter.preferences',
    theme: 'cyan',
    trustLabel: '产品参数计算',
    trustDescription: '基于产品说明书额定参数与 DSP 电平标定计算，现场需复核接线、增益结构和实际电平。',
  },
  spl: {
    label: '声压级',
    path: '/pages/spl/spl',
    preferenceKey: 'audioTool.spl.preferences',
    theme: 'violet',
    trustLabel: '自由场理论估算',
    trustDescription: '基于说明书灵敏度、额定功率和自由场距离衰减估算，不等同于现场实测声压级。',
  },
  cable: {
    label: '线材',
    path: '/pages/cable/cable',
    preferenceKey: 'audioTool.cable.preferences',
    theme: 'amber',
    trustLabel: '公司标准推荐',
    trustDescription: '依据公司线材标准和公式校核推荐，实际施工仍需结合环境、敷设方式和当地规范复核。',
  },
  venue: {
    label: '会议室',
    path: '/pages/venue/venue',
    preferenceKey: 'audioTool.venue.preferences',
    theme: 'green',
    trustLabel: '前期粗略方案',
    trustDescription: '仅用于普通规则矩形会议室的前期估算，最终方案需经工程复核与现场测量确认。',
  },
  camera: {
    label: '摄像机',
    path: '/pages/camera/camera',
    preferenceKey: 'audioTool.camera.preferences',
    theme: 'blue',
    trustLabel: '光学几何估算',
    trustDescription: '基于说明书视场角或用户输入的光学参数计算覆盖范围，不代表人脸、文字或细节的有效识别距离。',
  },
  gainStructure: {
    label: '增益结构',
    path: '/pages/gain-structure/gain-structure',
    preferenceKey: 'audioTool.gainStructure.preferences',
    theme: 'teal',
    trustLabel: '厂家输入级参数计算',
    trustDescription: '基于功放说明书输入灵敏度或电压增益，以及 DSP 电平标定计算；现场仍需用测试信号和电平指示复核。',
  },
  dmxAddress: {
    label: '灯光编址',
    path: '/pages/dmx-address/dmx-address',
    preferenceKey: 'audioTool.dmxAddress.preferences',
    theme: 'indigo',
    trustLabel: 'DMX512 顺序编址',
    trustDescription: '按灯具通道模式、数量和分组顺序自动分配首地址；现场需核对灯具模式、控台 Patch 和节点域号。',
  },
  ledScreen: {
    label: 'LED 大屏',
    path: '/pages/led-screen/led-screen',
    preferenceKey: 'audioTool.ledScreen.preferences',
    theme: 'violet',
    trustLabel: '前期尺寸预估',
    trustDescription: '基于墙体尺寸、整数拼装、画面比例和点间距作前期估算，最终需结合实际像素矩阵、结构、供配电和安装深化复核。',
  },
  audioWiring: {
    label: '接线助手',
    path: '/pages/audio-wiring/index',
    preferenceKey: 'audioWiringPreferencesV1',
    theme: 'teal',
    trustLabel: '接线参考',
    trustDescription: '依据已建模的模拟音频接口组合生成接线参考；施工前须按具体设备型号说明书核对端口用途、端子标识和接线要求。',
  },
}

function withStorageMutation(operation) {
  const outer = mutationDepth === 0
  if (outer) mutationReadFailed = false
  mutationDepth += 1
  try {
    return operation()
  } finally {
    mutationDepth -= 1
    if (outer) mutationReadFailed = false
  }
}

function wrapMutation(operation) {
  return (...args) => withStorageMutation(() => operation(...args))
}

function readStorageValue(key, fallback) {
  try {
    const value = wx.getStorageSync(key)
    return { ok: true, value: value === undefined || value === null || value === '' ? fallback : value }
  } catch (error) {
    storageReadFailures.add(key)
    if (mutationDepth > 0) mutationReadFailed = true
    return { ok: false, value: fallback }
  }
}

function readValueResult(key, fallback) {
  if (storageValueCache.has(key)) return { ok: true, value: storageValueCache.get(key) }
  const result = readStorageValue(key, fallback)
  if (result.ok) storageValueCache.set(key, result.value)
  return result
}

function readValue(key, fallback) {
  return readValueResult(key, fallback).value
}

function writeValue(key, value) {
  if (mutationReadFailed) return false
  try {
    wx.setStorageSync(key, value)
    storageValueCache.set(key, value)
    return true
  } catch (error) {
    return false
  }
}

function writeValuesAtomically(writes) {
  if (mutationReadFailed) return false
  const completed = []
  for (const write of writes) {
    if (writeValue(write.key, write.value)) {
      completed.push(write)
      continue
    }
    completed.reverse().forEach((item) => writeValue(item.key, item.previousValue))
    return false
  }
  return true
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatLocalDate(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function normalizeText(value, maximumLength) {
  return String(value || '').trim().slice(0, maximumLength)
}

function normalizeProjectRecordMetadata(metadata) {
  if (!isPlainObject(metadata) || !Object.prototype.hasOwnProperty.call(metadata, 'name')
    || Object.keys(metadata).some((key) => key !== 'name' && key !== 'note')
    || typeof metadata.name !== 'string'
    || (Object.prototype.hasOwnProperty.call(metadata, 'note') && metadata.note !== undefined
      && typeof metadata.note !== 'string')) return null
  const name = metadata.name.trim()
  const note = metadata.note === undefined ? '' : metadata.note.trim()
  if (!name || name.length > 60 || note.length > 200) return null
  return { name, note }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function withoutProjectRecordMetadata(record, projectId) {
  if (!['limiter', 'gainStructure', 'cable', 'spl', 'camera', 'ledScreen'].includes(record?.module)) return record
  const source = record?.projectMetadata
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || !Object.prototype.hasOwnProperty.call(source, projectId)) return record
  const projectMetadata = { ...source }
  delete projectMetadata[projectId]
  const next = { ...record }
  if (Object.keys(projectMetadata).length) next.projectMetadata = projectMetadata
  else delete next.projectMetadata
  return next
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object' || !project.id || !project.name) return null
  const createdAt = Number.isFinite(project.createdAt) ? project.createdAt : Date.now()
  return {
    ...project,
    createdAt,
    updatedAt: Number.isFinite(project.updatedAt) ? project.updatedAt : createdAt,
    venueName: normalizeText(project.venueName, 50),
    engineer: normalizeText(project.engineer, 30),
    projectDate: /^\d{4}-\d{2}-\d{2}$/.test(String(project.projectDate || ''))
      ? String(project.projectDate)
      : formatLocalDate(createdAt),
    notes: normalizeText(project.notes, 300),
    roomLengthText: normalizeText(project.roomLengthText, 8),
    roomWidthText: normalizeText(project.roomWidthText, 8),
    roomHeightText: normalizeText(project.roomHeightText, 8),
    standardClassKey: normalizeText(project.standardClassKey, 20) || 'conference',
    gradeKey: normalizeText(project.gradeKey, 10) || 'II',
  }
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || !record.id || !MODULES[record.module]) return null
  if (!record.preferences || typeof record.preferences !== 'object' || !record.resultText) return null
  const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : Date.now()
  return {
    ...record,
    createdAt,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt,
    favorite: Boolean(record.favorite),
    projectIds: Array.isArray(record.projectIds) ? [...new Set(record.projectIds.filter(Boolean))] : [],
  }
}

function isPersistentRecord(record) {
  return Boolean(record?.favorite || record?.projectIds?.length)
}

function keepPersistentRecords(records) {
  return records.filter(isPersistentRecord)
}

function ensureStorageSchema() {
  const schemaResult = readStorageValue(STORAGE_SCHEMA_KEY, 1)
  if (!schemaResult.ok) return
  const storedSchemaVersion = schemaResult.value
  if (storedSchemaVersion >= STORAGE_SCHEMA_VERSION) return
  storageValueCache.delete(RECORDS_KEY)
  storageValueCache.delete(PROJECTS_KEY)
  const recordsResult = readStorageValue(RECORDS_KEY, [])
  const projectsResult = readStorageValue(PROJECTS_KEY, [])
  if (!recordsResult.ok || !projectsResult.ok) return
  const storedRecords = recordsResult.value
  const storedProjects = projectsResult.value
  const projects = Array.isArray(storedProjects) ? storedProjects.map(normalizeProject).filter(Boolean) : []
  const projectIds = new Set(projects.map((project) => project.id))
  const records = keepPersistentRecords(Array.isArray(storedRecords)
    ? storedRecords.map(normalizeRecord).filter(Boolean).map((record) => ({
      ...record,
      projectIds: record.projectIds.filter((id) => projectIds.has(id)),
    }))
    : [])
  if (writeValue(RECORDS_KEY, records) && writeValue(PROJECTS_KEY, projects)) {
    writeValue(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION)
  }
}

function readNormalizedRecords() {
  const result = readValueResult(RECORDS_KEY, [])
  if (!result.ok) return normalizedRecords
  const records = result.value
  if (records === normalizedRecordSource) return normalizedRecords
  normalizedRecordSource = records
  normalizedRecords = keepPersistentRecords(
    Array.isArray(records) ? records.map(normalizeRecord).filter(Boolean) : [],
  )
  recordSignatureIndex = new Map(normalizedRecords.map((record) => [record.signature, record]))
  return normalizedRecords
}

function readNormalizedProjects() {
  const result = readValueResult(PROJECTS_KEY, [])
  if (!result.ok) return normalizedProjects
  const projects = result.value
  if (projects === normalizedProjectSource) return normalizedProjects
  normalizedProjectSource = projects
  normalizedProjects = Array.isArray(projects)
    ? projects.map(normalizeProject).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)
    : []
  return normalizedProjects
}

function getRecords() {
  ensureStorageSchema()
  return readNormalizedRecords()
}

function getProjects() {
  ensureStorageSchema()
  return readNormalizedProjects()
}

function getWorkspaceSnapshot(options = {}) {
  if (options.forceRefresh) {
    ;[STORAGE_SCHEMA_KEY, RECORDS_KEY, PROJECTS_KEY, ACTIVE_PROJECT_KEY].forEach((key) => storageValueCache.delete(key))
    normalizedRecordSource = undefined
    normalizedProjectSource = undefined
  }
  storageReadFailures.clear()
  ensureStorageSchema()
  const records = readNormalizedRecords()
  const projects = readNormalizedProjects()
  const activeId = readValue(ACTIVE_PROJECT_KEY, '')
  const ok = storageReadFailures.size === 0
  return {
    ok,
    error: ok ? '' : '本地项目和收藏数据读取失败，请重试。',
    records,
    projects,
    activeProject: projects.find((project) => project.id === activeId) || null,
  }
}

function createSignature(module, preferences) {
  return JSON.stringify([module, preferences])
}

function saveRecord(payload, options = {}) {
  if (!payload?.module || !MODULES[payload.module] || !payload.preferences || !payload.resultText) {
    return null
  }

  const signature = createSignature(payload.module, payload.preferences)
  const records = getRecords()
  const existing = records.find((record) => record.signature === signature)
  const now = Date.now()
  const projectIds = [...new Set([
    ...(existing?.projectIds || []),
    ...(options.projectId ? [options.projectId] : []),
  ])]
  const record = {
    ...existing,
    ...payload,
    id: existing?.id || createId('record'),
    signature,
    favorite: options.favorite === undefined ? Boolean(existing?.favorite) : options.favorite,
    projectIds,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  if (options.projectMetadata && options.projectId) {
    const previousMetadata = existing?.projectMetadata
      && typeof existing.projectMetadata === 'object' && !Array.isArray(existing.projectMetadata)
      ? existing.projectMetadata
      : {}
    record.projectMetadata = {
      ...previousMetadata,
      [options.projectId]: { ...options.projectMetadata, savedAt: now },
    }
  }
  const persistent = isPersistentRecord(record)
  if (!persistent && !existing) return null
  const nextRecords = persistent
    ? [record, ...records.filter((item) => item.id !== record.id)]
    : records.filter((item) => item.id !== record.id)

  const writes = [{ key: RECORDS_KEY, value: nextRecords, previousValue: records }]
  if (options.projectId) {
    const projects = getProjects()
    const nextProjects = projects.map((project) => (
      project.id === options.projectId ? { ...project, updatedAt: now } : project
    ))
    writes.push({ key: PROJECTS_KEY, value: nextProjects, previousValue: projects })
  }
  if (!writeValuesAtomically(writes)) return null

  return persistent ? record : null
}

function getRecordByPayload(payload) {
  if (!payload?.module || !payload.preferences) return null
  const signature = createSignature(payload.module, payload.preferences)
  getRecords()
  return recordSignatureIndex.get(signature) || null
}

function toggleFavorite(payload) {
  const existing = getRecordByPayload(payload)
  return saveRecord(payload, { favorite: !existing?.favorite })
}

function toggleFavoriteById(recordId) {
  const record = getRecords().find((item) => item.id === recordId)
  return record ? saveRecord(record, { favorite: !record.favorite }) : null
}

function removeRecord(recordId) {
  const records = getRecords()
  if (!records.some((record) => record.id === recordId)) return false
  return writeValue(RECORDS_KEY, records.filter((record) => record.id !== recordId))
}

function createProject(name) {
  const normalizedName = String(name || '').trim()
  if (!normalizedName) return null
  const projectName = normalizedName.slice(0, 30)

  const projects = getProjects()
  const existing = projects.find((project) => project.name === projectName)
  if (existing) {
    return setActiveProject(existing.id)
  }

  const now = Date.now()
  const project = {
    id: createId('project'),
    name: projectName,
    venueName: '',
    engineer: '',
    projectDate: formatLocalDate(now),
    notes: '',
    roomLengthText: '',
    roomWidthText: '',
    roomHeightText: '',
    standardClassKey: 'conference',
    gradeKey: 'II',
    createdAt: now,
    updatedAt: now,
  }
  const activeProjectId = readValue(ACTIVE_PROJECT_KEY, '')
  return writeValuesAtomically([
    { key: PROJECTS_KEY, value: [project, ...projects], previousValue: projects },
    { key: ACTIVE_PROJECT_KEY, value: project.id, previousValue: activeProjectId },
  ]) ? project : null
}

function updateProject(projectId, changes = {}) {
  const projects = getProjects()
  const current = projects.find((project) => project.id === projectId)
  if (!current) return null

  const name = normalizeText(changes.name === undefined ? current.name : changes.name, 30)
  if (!name || projects.some((project) => project.id !== projectId && project.name === name)) return null

  const requestedDate = changes.projectDate === undefined ? current.projectDate : changes.projectDate
  const projectDate = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate || ''))
    ? String(requestedDate)
    : ''
  const updated = {
    ...current,
    name,
    venueName: normalizeText(changes.venueName === undefined ? current.venueName : changes.venueName, 50),
    engineer: normalizeText(changes.engineer === undefined ? current.engineer : changes.engineer, 30),
    projectDate,
    notes: normalizeText(changes.notes === undefined ? current.notes : changes.notes, 300),
    roomLengthText: normalizeText(
      changes.roomLengthText === undefined ? current.roomLengthText : changes.roomLengthText,
      8,
    ),
    roomWidthText: normalizeText(
      changes.roomWidthText === undefined ? current.roomWidthText : changes.roomWidthText,
      8,
    ),
    roomHeightText: normalizeText(
      changes.roomHeightText === undefined ? current.roomHeightText : changes.roomHeightText,
      8,
    ),
    standardClassKey: normalizeText(
      changes.standardClassKey === undefined ? current.standardClassKey : changes.standardClassKey,
      20,
    ) || 'conference',
    gradeKey: normalizeText(changes.gradeKey === undefined ? current.gradeKey : changes.gradeKey, 10) || 'II',
    updatedAt: Date.now(),
  }
  return writeValue(PROJECTS_KEY, projects.map((project) => (
    project.id === projectId ? updated : project
  ))) ? updated : null
}

function deleteProject(projectId) {
  const projects = getProjects()
  if (!projects.some((project) => project.id === projectId)) return false
  const records = getRecords()
  const activeProjectId = readValue(ACTIVE_PROJECT_KEY, '')
  const writes = [
    { key: PROJECTS_KEY, value: projects.filter((project) => project.id !== projectId), previousValue: projects },
    { key: RECORDS_KEY, value: keepPersistentRecords(records.map((record) => withoutProjectRecordMetadata({
      ...record,
      projectIds: (record.projectIds || []).filter((id) => id !== projectId),
    }, projectId))), previousValue: records },
  ]
  if (activeProjectId === projectId) {
    writes.push({ key: ACTIVE_PROJECT_KEY, value: '', previousValue: activeProjectId })
  }
  return writeValuesAtomically(writes)
}

function setActiveProject(projectId) {
  const project = getProjects().find((item) => item.id === projectId)
  return project && writeValue(ACTIVE_PROJECT_KEY, project.id) ? project : null
}

function getActiveProject() {
  const activeId = readValue(ACTIVE_PROJECT_KEY, '')
  return getProjects().find((project) => project.id === activeId) || null
}

function addRecordToProject(payload, projectId, metadata) {
  const projectMetadata = metadata === undefined ? undefined : normalizeProjectRecordMetadata(metadata)
  if (metadata !== undefined && (!projectMetadata || !['limiter', 'gainStructure', 'cable', 'spl', 'camera', 'ledScreen'].includes(payload?.module))) return null
  const project = getProjects().find((item) => item.id === projectId)
  return project ? saveRecord(payload, { projectId, ...(projectMetadata ? { projectMetadata } : {}) }) : null
}

function getProjectRecords(projectId) {
  return getRecords().filter((record) => record.projectIds?.includes(projectId))
}

function getProjectRecordView(record, projectId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record
  const sourceMetadata = record.projectMetadata
  const metadata = ['limiter', 'gainStructure', 'cable', 'spl', 'camera', 'ledScreen'].includes(record.module)
    && Array.isArray(record.projectIds) && record.projectIds.includes(projectId)
    && isPlainObject(sourceMetadata)
    && Object.prototype.hasOwnProperty.call(sourceMetadata, projectId)
    && isPlainObject(sourceMetadata[projectId])
    ? sourceMetadata[projectId]
    : null
  const name = metadata && Object.prototype.hasOwnProperty.call(metadata, 'name')
    && typeof metadata.name === 'string' ? metadata.name.trim() : ''
  const noteValue = metadata && Object.prototype.hasOwnProperty.call(metadata, 'note') ? metadata.note : undefined
  const note = noteValue === undefined ? '' : typeof noteValue === 'string' ? noteValue.trim() : null
  const validMetadata = Boolean(name && name.length <= 60 && note !== null && note.length <= 200)
  const projectMetadata = isPlainObject(sourceMetadata)
    ? Object.keys(sourceMetadata).reduce((copy, id) => {
      const item = sourceMetadata[id]
      copy[id] = isPlainObject(item) ? { ...item } : item
      return copy
    }, Object.getPrototypeOf(sourceMetadata) === null ? Object.create(null) : {})
    : undefined
  const view = {
    ...record,
    preferences: record.preferences && typeof record.preferences === 'object' && !Array.isArray(record.preferences)
      ? { ...record.preferences }
      : record.preferences,
    projectIds: Array.isArray(record.projectIds) ? [...record.projectIds] : record.projectIds,
    ...(projectMetadata === undefined ? {} : { projectMetadata }),
  }
  if (validMetadata) {
    view.title = name
    view.projectNote = note
    view.updatedAt = Number.isFinite(metadata.savedAt) ? metadata.savedAt : record.updatedAt
    view.hasProjectMetadata = true
  } else {
    delete view.projectNote
    delete view.hasProjectMetadata
  }
  return view
}

function isValidStoredWiringSchedule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Number.isSafeInteger(value.nextNumber) || value.nextNumber < 1
    || !Array.isArray(value.lines) || value.lines.length > projectWiring.MAX_LINES) return false
  const scheduleKeys = new Set(['version', 'revision', 'nextNumber', 'lines'])
  if (Object.keys(value).some((key) => !scheduleKeys.has(key))) return false
  const ids = new Set()
  const codes = new Set()
  const lineKeys = new Set([
    'id', 'code', 'purpose', 'fromDevice', 'fromPort', 'toDevice', 'toPort', 'buildType', 'cableType',
    'spec', 'connectorA', 'connectorB', 'lengthText', 'status', 'notes',
  ])
  const lineTextLimits = {
    id: 100, code: 32, purpose: 100, fromDevice: 100, fromPort: 80, toDevice: 100, toPort: 80,
    buildType: 20, cableType: 20, spec: 120, connectorA: 60, connectorB: 60,
    lengthText: projectWiring.MAX_LENGTH_TEXT, status: 20, notes: 300,
  }
  for (const line of value.lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)
      || Object.keys(line).some((key) => !lineKeys.has(key))) return false
    if (lineKeys.size !== Object.keys(line).length
      || Object.keys(line).some((key) => typeof line[key] !== 'string')) return false
    if (Object.keys(line).some((key) => line[key].length > lineTextLimits[key] || line[key] !== line[key].trim())) return false
    if (!line.id.trim() || !line.code.trim() || !line.fromDevice.trim() || !line.fromPort.trim()
      || !line.toDevice.trim() || !line.toPort.trim()) return false
    if (!['finished', 'bulk'].includes(line.buildType)
      || !['balanced', 'unbalanced', 'speaker', 'custom'].includes(line.cableType)
      || !['pending', 'connected', 'checked'].includes(line.status)) return false
    if (line.lengthText && (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(line.lengthText)
      || !Number.isFinite(Number(line.lengthText)) || Number(line.lengthText) <= 0
      || Number(line.lengthText) > projectWiring.MAX_LENGTH_METERS)) return false
    const normalizedCode = line.code.trim().toLowerCase()
    if (ids.has(line.id) || codes.has(normalizedCode)) return false
    ids.add(line.id)
    codes.add(normalizedCode)
  }
  return true
}

function readProjectWiringStorage(projectId) {
  const projectsResult = readStorageValue(PROJECTS_KEY, [])
  if (!projectsResult.ok) return { ok: false, project: null, schedule: null, error: '读取项目布线失败，请检查本地存储' }
  if (!Array.isArray(projectsResult.value)) {
    return { ok: false, project: null, schedule: null, error: '项目数据格式异常，已阻止布线读写' }
  }
  const rawProject = projectsResult.value.find((project) => project?.id === projectId)
  if (!rawProject) return { ok: false, project: null, schedule: null, error: '项目不存在或已删除' }
  if (typeof rawProject.name !== 'string' || !rawProject.name.trim()) {
    return { ok: false, project: null, schedule: null, error: '项目资料格式异常，已阻止布线读写' }
  }
  const project = { id: rawProject.id, name: rawProject.name }
  if (Object.prototype.hasOwnProperty.call(rawProject, 'wiringSchedule')
    && !isValidStoredWiringSchedule(rawProject.wiringSchedule)) {
    return { ok: false, project, schedule: null, error: '项目布线数据格式或版本异常，已阻止覆盖' }
  }
  return {
    ok: true,
    project,
    schedule: Object.prototype.hasOwnProperty.call(rawProject, 'wiringSchedule')
      ? projectWiring.normalizeSchedule(rawProject.wiringSchedule)
      : projectWiring.emptySchedule(),
    projects: projectsResult.value,
    rawProject,
  }
}

function getProjectWiring(projectId) {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    return { ok: false, project: null, schedule: null, error: '缺少项目编号' }
  }
  const result = readProjectWiringStorage(projectId)
  if (!result.ok) return result
  return { ok: true, project: result.project, schedule: result.schedule }
}

function saveProjectWiring(projectId, command, expectedRevision) {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    return { ok: false, project: null, schedule: null, error: '缺少项目编号' }
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return { ok: false, project: null, schedule: null, error: '缺少有效的布线版本号，请刷新项目后重试' }
  }
  const current = readProjectWiringStorage(projectId)
  if (!current.ok) return current
  if (current.schedule.revision !== expectedRevision) {
    return { ok: false, project: current.project, schedule: current.schedule, error: '项目布线已在其他页面更新，请刷新后重试' }
  }
  const change = projectWiring.applyScheduleChange(current.schedule, command)
  if (!change.ok) {
    return { ok: false, project: current.project, schedule: change.schedule, error: change.error }
  }
  const previousUpdatedAt = Number.isFinite(current.rawProject.updatedAt) ? current.rawProject.updatedAt : 0
  const updatedAt = Math.max(Date.now(), previousUpdatedAt + 1)
  const nextProjects = current.projects.map((project) => (
    project?.id === projectId
      ? { ...project, wiringSchedule: change.schedule, updatedAt }
      : project
  ))
  if (!writeValue(PROJECTS_KEY, nextProjects)) {
    return { ok: false, project: current.project, schedule: current.schedule, error: '保存项目布线失败，请检查本地存储' }
  }
  normalizedProjectSource = undefined
  normalizedProjects = []
  const rawProject = nextProjects.find((project) => project?.id === projectId)
  return {
    ok: true,
    project: { id: rawProject.id, name: rawProject.name },
    schedule: change.schedule,
    lineIds: change.lineIds,
  }
}

function removeRecordFromProject(recordId, projectId) {
  const { records, projects } = getWorkspaceSnapshot()
  const record = records.find((item) => item.id === recordId)
  const project = projects.find((item) => item.id === projectId)
  if (!record?.projectIds?.includes(projectId) || !project) return false

  const now = Date.now()
  const nextRecords = keepPersistentRecords(records.map((item) => (
    item.id === recordId
      ? withoutProjectRecordMetadata({
        ...item,
        projectIds: item.projectIds.filter((id) => id !== projectId),
      }, projectId)
      : item
  )))
  const nextProjects = projects.map((item) => (
    item.id === projectId ? { ...item, updatedAt: now } : item
  ))
  return writeValuesAtomically([
    { key: RECORDS_KEY, value: nextRecords, previousValue: records },
    { key: PROJECTS_KEY, value: nextProjects, previousValue: projects },
  ])
}

function restoreRecord(record) {
  const module = MODULES[record?.module]
  if (!module || !record.preferences) return ''
  const preferences = record.module === 'audioWiring'
    ? {
      version: record.preferences.version,
      outputId: record.preferences.outputId,
      inputId: record.preferences.inputId,
      manualSelected: record.preferences.manualSelected,
      viewMode: record.preferences.viewMode,
      face: record.preferences.face,
    }
    : record.preferences
  return writeValue(module.preferenceKey, preferences) ? module.path : ''
}

function prepareProjectModule(projectId, moduleKey) {
  const project = getProjects().find((item) => item.id === projectId)
  const module = MODULES[moduleKey]
  if (!project || !module) return ''

  const writes = []
  if (moduleKey === 'venue') {
    const preferences = readStorageValue(module.preferenceKey, {}).value
    writes.push({ key: module.preferenceKey, previousValue: preferences, value: {
      ...preferences,
      ...(project.roomLengthText ? { lengthText: project.roomLengthText } : {}),
      ...(project.roomWidthText ? { widthText: project.roomWidthText } : {}),
      ...(project.roomHeightText ? { heightText: project.roomHeightText } : {}),
      standardClassKey: project.standardClassKey,
      gradeKey: project.gradeKey,
    } })
  }
  const activeProjectId = readValue(ACTIVE_PROJECT_KEY, '')
  writes.push({ key: ACTIVE_PROJECT_KEY, value: project.id, previousValue: activeProjectId })
  return writeValuesAtomically(writes) ? module.path : ''
}

function getStorageHealth() {
  try {
    if (!wx.getStorageInfoSync) return null
    const info = wx.getStorageInfoSync()
    const currentSize = Number(info.currentSize) || 0
    const limitSize = Number(info.limitSize) || 0
    const percent = limitSize ? Math.round((currentSize / limitSize) * 100) : 0
    return {
      currentSize,
      limitSize,
      percent,
      warning: percent >= 80,
      text: limitSize ? `本地数据已使用 ${percent}%` : '本地数据状态正常',
    }
  } catch (error) {
    return null
  }
}

module.exports = {
  MODULES,
  addRecordToProject: wrapMutation(addRecordToProject),
  createProject: wrapMutation(createProject),
  deleteProject: wrapMutation(deleteProject),
  getActiveProject,
  getProjectRecords,
  getProjectRecordView,
  getProjectWiring,
  getProjects,
  getRecordByPayload,
  getRecords,
  getStorageHealth,
  getWorkspaceSnapshot,
  prepareProjectModule: wrapMutation(prepareProjectModule),
  removeRecordFromProject: wrapMutation(removeRecordFromProject),
  removeRecord: wrapMutation(removeRecord),
  restoreRecord: wrapMutation(restoreRecord),
  saveRecord: wrapMutation(saveRecord),
  saveProjectWiring: wrapMutation(saveProjectWiring),
  setActiveProject: wrapMutation(setActiveProject),
  toggleFavorite: wrapMutation(toggleFavorite),
  toggleFavoriteById: wrapMutation(toggleFavoriteById),
  updateProject: wrapMutation(updateProject),
  STORAGE_SCHEMA_VERSION,
}

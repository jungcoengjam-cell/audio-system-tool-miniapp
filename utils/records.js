const RECORDS_KEY = 'audioTool.records.v1'
const PROJECTS_KEY = 'audioTool.projects.v1'
const FAVORITES_KEY = 'audioTool.favorites.v1'
const RECOVERY_KEY = 'audioTool.recovery.v1'
const MIGRATION_BACKUPS_KEY = 'audioTool.storageMigrationBackups.v1'
const MIGRATION_JOURNAL_KEY = 'audioTool.storageMigrationJournal.v1'
const ACTIVE_PROJECT_KEY = 'audioTool.activeProject.v1'
const STORAGE_SCHEMA_KEY = 'audioTool.storageSchemaVersion'
const STORAGE_SCHEMA_VERSION = 4
const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const RECOVERY_KINDS = new Set(['project', 'record', 'favorite', 'record-project-link', 'legacy-recent'])
const projectWiring = require('./project-wiring')
let normalizedRecordSource
let normalizedRecords = []
let recordSignatureIndex = new Map()
let normalizedProjectSource
let normalizedProjects = []
let normalizedFavoriteSource
let normalizedFavorites = []
let normalizedRecoverySource
let normalizedRecoveryEntries = []
let storageMigrationError = ''
const migrationState = {
  get error() { return storageMigrationError },
  set error(value) { storageMigrationError = value },
}

const { createRecordStorage } = require('./record-storage')
const {
  withStorageMutation,
  wrapMutation,
  readStorageValue,
  readValueResult,
  readValue,
  writeValue,
  writeValuesAtomically,
  readRawStorageValue,
  removeStorageValue,
  storageValueCache,
  storageReadFailures,
} = createRecordStorage({ getWx: () => wx, getMigrationError: () => storageMigrationError })

const { MODULES, LEGACY_MODULES, getModuleMetadata } = require('./record-modules')
const { createRecordMigration } = require('./record-migration')

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
  if (!['limiter', 'gainStructure', 'cable', 'spl', 'camera', 'ledScreen', 'audioWiring', 'venue'].includes(record?.module)) return record
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
  if (!isPlainObject(record) || typeof record.id !== 'string' || !record.id
    || typeof record.module !== 'string' || !record.module) return null
  if (!isPlainObject(record.preferences) || typeof record.resultText !== 'string' || !record.resultText) return null
  const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : Date.now()
  return {
    ...record,
    createdAt,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt,
    favorite: false,
    archived: record.archived === true || !getModuleMetadata(record.module),
    projectIds: Array.isArray(record.projectIds) ? [...new Set(record.projectIds.filter(Boolean))] : [],
  }
}

function normalizeFavorite(record) {
  if (!isPlainObject(record) || typeof record.id !== 'string' || !record.id
    || typeof record.module !== 'string' || !record.module
    || !isPlainObject(record.preferences) || typeof record.resultText !== 'string' || !record.resultText) return null
  const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : undefined
  const originProjectIds = Array.isArray(record.originProjectIds)
    ? [...new Set(record.originProjectIds.filter((id) => typeof id === 'string' && id))]
    : Array.isArray(record.projectIds) ? [...new Set(record.projectIds.filter((id) => typeof id === 'string' && id))] : []
  const normalized = {
    ...record,
    favorite: true,
    archived: record.archived === true || !getModuleMetadata(record.module),
    originProjectIds,
    projectIds: [],
  }
  if (createdAt === undefined) delete normalized.createdAt
  else normalized.createdAt = createdAt
  if (Number.isFinite(record.updatedAt)) normalized.updatedAt = record.updatedAt
  else delete normalized.updatedAt
  return normalized
}

function isPersistentRecord(record) {
  return Boolean(record?.projectIds?.length)
}

function keepPersistentRecords(records) {
  return records.filter(isPersistentRecord)
}

function cloneStorageValue(value) {
  if (value === undefined) return undefined
  try { return JSON.parse(JSON.stringify(value)) } catch (error) { return null }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isPlainObject(value)) return value
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableValue(value[key])
    return result
  }, {})
}

function snapshotsEqual(left, right) {
  try { return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)) } catch (error) { return false }
}

function findRawSnapshotById(key, id) {
  const result = readValueResult(key, undefined)
  if (!result.ok || !Array.isArray(result.value)) return { ok: false, item: null }
  return { ok: true, item: result.value.find((item) => item?.id === id) || null }
}

function captureStorageSnapshot(keys) {
  const values = {}
  for (const key of keys) {
    const result = readRawStorageValue(key)
    if (!result.ok) return { ok: false, values: null }
    values[key] = { present: result.present, value: cloneStorageValue(result.value) }
  }
  return { ok: true, values }
}

function writeRawSnapshot(snapshot, options = {}) {
  const current = captureStorageSnapshot(Object.keys(snapshot || {}))
  if (!current.ok) return false
  const written = []
  for (const [key, item] of Object.entries(snapshot || {})) {
    const ok = item?.present
      ? writeValue(key, cloneStorageValue(item.value), options.allowMigrationError === true)
      : removeStorageValue(key)
    if (ok) {
      written.push(key)
      continue
    }
    written.reverse().forEach((writtenKey) => {
      const previous = current.values[writtenKey]
      if (previous.present) writeValue(writtenKey, previous.value, options.allowMigrationError === true)
      else removeStorageValue(writtenKey)
    })
    return false
  }
  return true
}

function makeIndependentDataSnapshot(snapshot) {
  const storage = snapshot?.storage
  const requiredKeys = [PROJECTS_KEY, RECORDS_KEY, FAVORITES_KEY, RECOVERY_KEY]
  if (!isPlainObject(storage) || requiredKeys.some((key) => (
    !isPlainObject(storage[key]) || typeof storage[key].present !== 'boolean'
  ))) return null
  const readArray = (key) => storage[key].present ? storage[key].value : []
  const projects = readArray(PROJECTS_KEY)
  const rawRecords = readArray(RECORDS_KEY)
  const rawFavorites = readArray(FAVORITES_KEY)
  const rawRecovery = readArray(RECOVERY_KEY)
  if (!Array.isArray(projects) || projects.some((project) => !isPlainObject(project)
    || typeof project.id !== 'string' || !project.id || typeof project.name !== 'string' || !project.name)) return null
  if (!Array.isArray(rawRecords) || rawRecords.some((record) => !normalizeRecord(record))) return null
  if (!Array.isArray(rawFavorites) || rawFavorites.some((favorite) => !normalizeFavorite(favorite))) return null
  if (!Array.isArray(rawRecovery) || rawRecovery.some((entry) => !isPlainObject(entry))) return null

  const projectRecords = []
  const favoriteById = new Map()
  const legacyRecent = []
  for (const favorite of rawFavorites) {
    const normalized = normalizeFavorite(favorite)
    if (favoriteById.has(normalized.id)
      && JSON.stringify(favoriteById.get(normalized.id)) !== JSON.stringify(normalized)) return null
    favoriteById.set(normalized.id, normalized)
  }
  for (const rawRecord of rawRecords) {
    const record = normalizeRecord(rawRecord)
    const projectIds = Array.isArray(rawRecord.projectIds)
      ? [...new Set(rawRecord.projectIds.filter((id) => typeof id === 'string' && id))]
      : []
    if (rawRecord.favorite) {
      const favorite = normalizeFavorite({ ...rawRecord, projectIds, originProjectIds: projectIds })
      const existing = favoriteById.get(favorite.id)
      if (!existing) favoriteById.set(favorite.id, favorite)
      else if (JSON.stringify(existing) !== JSON.stringify(favorite)) return null
    }
    if (projectIds.length) {
      projectRecords.push({
        ...rawRecord,
        favorite: false,
        projectIds,
        signature: typeof rawRecord.signature === 'string'
          ? rawRecord.signature
          : createSignature(rawRecord.module, rawRecord.preferences),
      })
    } else if (!rawRecord.favorite) {
      // Old unlinked recent results stay available in recovery without becoming a project record or favorite.
      legacyRecent.push({
        id: createId('recovery'),
        kind: 'legacy-recent',
        targetId: rawRecord.id,
        ...(Number.isFinite(rawRecord.updatedAt) ? { deletedAt: rawRecord.updatedAt } : {}),
        snapshot: cloneStorageValue(rawRecord),
      })
    }
  }

  return {
    [PROJECTS_KEY]: cloneStorageValue(projects),
    [RECORDS_KEY]: projectRecords,
    [FAVORITES_KEY]: Array.from(favoriteById.values()),
    [RECOVERY_KEY]: [...cloneStorageValue(rawRecovery), ...legacyRecent],
    [STORAGE_SCHEMA_KEY]: STORAGE_SCHEMA_VERSION,
  }
}

const {
  ensureStorageSchema,
  getStorageMigrationBackups,
  restoreStorageMigrationBackup,
} = createRecordMigration({
  ACTIVE_PROJECT_KEY,
  FAVORITES_KEY,
  MIGRATION_BACKUPS_KEY,
  MIGRATION_JOURNAL_KEY,
  PROJECTS_KEY,
  RECORDS_KEY,
  RECOVERY_KEY,
  STORAGE_SCHEMA_KEY,
  STORAGE_SCHEMA_VERSION,
  captureStorageSnapshot,
  cloneStorageValue,
  createId,
  Date: { now: () => Date.now() },
  invalidateNormalizedSources() {
    normalizedRecordSource = undefined
    normalizedProjectSource = undefined
    normalizedFavoriteSource = undefined
    normalizedRecoverySource = undefined
  },
  isPlainObject,
  makeIndependentDataSnapshot,
  normalizeFavorite,
  normalizeProject,
  normalizeRecord,
  readRawStorageValue,
  readValueResult,
  removeStorageValue,
  resetNormalizedState() {
    normalizedRecordSource = undefined
    normalizedProjectSource = undefined
    normalizedFavoriteSource = undefined
    normalizedRecoverySource = undefined
    normalizedRecords = []
    normalizedProjects = []
    normalizedFavorites = []
    normalizedRecoveryEntries = []
    recordSignatureIndex = new Map()
  },
  state: migrationState,
  storageValueCache,
  writeRawSnapshot,
  writeValue,
})

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

function readNormalizedFavorites() {
  const result = readValueResult(FAVORITES_KEY, [])
  if (!result.ok) return normalizedFavorites
  const favorites = result.value
  if (favorites === normalizedFavoriteSource) return normalizedFavorites
  normalizedFavoriteSource = favorites
  normalizedFavorites = Array.isArray(favorites)
    ? favorites.map(normalizeFavorite).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)
    : []
  return normalizedFavorites
}

function readNormalizedRecoveryEntries() {
  const result = readValueResult(RECOVERY_KEY, [])
  if (!result.ok) return normalizedRecoveryEntries
  const entries = result.value
  if (entries === normalizedRecoverySource) return normalizedRecoveryEntries
  normalizedRecoverySource = entries
  normalizedRecoveryEntries = Array.isArray(entries)
    ? entries.filter((entry) => isPlainObject(entry) && typeof entry.id === 'string' && entry.kind)
      .sort((a, b) => (Number(b.deletedAt) || 0) - (Number(a.deletedAt) || 0))
    : []
  return normalizedRecoveryEntries
}

function getRecords() {
  if (!ensureStorageSchema()) return []
  return readNormalizedRecords()
}

function getProjects() {
  if (!ensureStorageSchema()) return []
  return readNormalizedProjects()
}

function getFavorites() {
  if (!ensureStorageSchema()) return []
  return readNormalizedFavorites()
}

function getRecoveryEntries() {
  if (!ensureStorageSchema()) return []
  return readNormalizedRecoveryEntries()
}

function getWorkspaceSnapshot(options = {}) {
  if (options.forceRefresh) {
    ;[STORAGE_SCHEMA_KEY, RECORDS_KEY, PROJECTS_KEY, FAVORITES_KEY, RECOVERY_KEY, ACTIVE_PROJECT_KEY,
      MIGRATION_BACKUPS_KEY, MIGRATION_JOURNAL_KEY].forEach((key) => storageValueCache.delete(key))
    normalizedRecordSource = undefined
    normalizedProjectSource = undefined
    normalizedFavoriteSource = undefined
    normalizedRecoverySource = undefined
  }
  storageReadFailures.clear()
  if (!ensureStorageSchema()) {
    return {
      ok: false,
      error: storageMigrationError || '项目数据读取失败，请检查本地存储后重试。',
      records: normalizedRecords,
      favorites: normalizedFavorites,
      projects: normalizedProjects,
      recoveryEntries: normalizedRecoveryEntries,
      activeProject: null,
    }
  }
  const records = readNormalizedRecords()
  const favorites = readNormalizedFavorites()
  const projects = readNormalizedProjects()
  const recoveryEntries = readNormalizedRecoveryEntries()
  const ok = storageReadFailures.size === 0
  return {
    ok,
    error: ok ? '' : '本地项目和收藏数据读取失败，请重试。',
    records,
    favorites,
    projects,
    recoveryEntries,
    activeProject: null,
  }
}

function createSignature(module, preferences) {
  return JSON.stringify([module, preferences])
}

function saveRecord(payload, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'favorite')) {
    return options.favorite
      ? saveFavoriteSnapshot(payload)
      : null
  }
  if (!payload?.module || !getModuleMetadata(payload.module) || !payload.preferences || !payload.resultText) {
    return null
  }

  const signature = createSignature(payload.module, payload.preferences)
  const records = getRecords()
  if (options.saveToken) {
    const tokenRecord = records.find((record) => record.editorSaveToken === options.saveToken)
    if (tokenRecord) {
      const compatible = tokenRecord.module === payload.module
        && tokenRecord.signature === signature
        && (!options.projectId || tokenRecord.projectIds?.includes(options.projectId))
        && (!options.recordId || options.recordId === tokenRecord.id)
      return compatible ? tokenRecord : null
    }
  }
  const isLegacy = Object.prototype.hasOwnProperty.call(LEGACY_MODULES, payload.module)
  const existing = options.recordId
    ? records.find((record) => record.id === options.recordId)
    : options.saveAs !== true ? records.find((record) => record.signature === signature) : null
  if (isLegacy && !existing) return null
  if (options.recordId && (!existing || existing.module !== payload.module)) return null
  if (options.projectId && !getProjects().some((project) => project.id === options.projectId)) return null
  const now = Date.now()
  const projectIds = options.saveAs === true
    ? options.projectId ? [options.projectId] : []
    : [...new Set([...(existing?.projectIds || []), ...(options.projectId ? [options.projectId] : [])])]
  if (!projectIds.length) return null
  const record = {
    ...(isLegacy ? existing : { ...existing, ...payload }),
    id: existing?.id || createId('record'),
    signature,
    favorite: false,
    archived: false,
    projectIds,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    ...(options.saveToken ? { editorSaveToken: String(options.saveToken) } : {}),
  }
  if (options.saveAs === true) delete record.projectMetadata
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
  const nextRecords = [record, ...records.filter((item) => item.id !== record.id)]

  const writes = [{ key: RECORDS_KEY, value: nextRecords, previousValue: records }]
  if (options.projectId) {
    const projects = getProjects()
    const nextProjects = projects.map((project) => (
      project.id === options.projectId ? { ...project, updatedAt: now } : project
    ))
    writes.push({ key: PROJECTS_KEY, value: nextProjects, previousValue: projects })
  }
  if (!writeValuesAtomically(writes)) return null

  normalizedRecordSource = undefined
  normalizedProjectSource = undefined
  return record
}

function getRecordByPayload(payload, options = {}) {
  if (!payload?.module || !payload.preferences) return null
  const records = getRecords()
  if (options.recordId) return records.find((record) => record.id === options.recordId) || null
  const signature = createSignature(payload.module, payload.preferences)
  return records.find((record) => record.signature === signature
    && (!options.projectId || record.projectIds?.includes(options.projectId))) || null
}

function getRecordById(recordId) {
  if (!recordId) return null
  return getRecords().find((record) => record.id === recordId) || null
}

function getRecordBySaveToken(saveToken) {
  if (!saveToken) return null
  return getRecords().find((record) => record.editorSaveToken === saveToken) || null
}

function getFavoriteByPayload(payload) {
  if (!payload?.module || !payload.preferences) return null
  const signature = createSignature(payload.module, payload.preferences)
  return getFavorites().find((favorite) => favorite.signature === signature
    || (!favorite.signature && createSignature(favorite.module, favorite.preferences) === signature)) || null
}

function saveFavoriteSnapshot(payload, options = {}) {
  if (!payload?.module || !getModuleMetadata(payload.module) || !payload.preferences || !payload.resultText) return null
  const favorites = getFavorites()
  const signature = createSignature(payload.module, payload.preferences)
  const isLegacy = Object.prototype.hasOwnProperty.call(LEGACY_MODULES, payload.module)
  const existing = options.favoriteId
    ? favorites.find((favorite) => favorite.id === options.favoriteId)
    : options.saveAs === true ? null : favorites.find((favorite) => favorite.signature === signature
      || (isLegacy && !favorite.signature && createSignature(favorite.module, favorite.preferences) === signature))
  if (options.favoriteId && (!existing || existing.module !== payload.module
    || (isLegacy && createSignature(existing.module, existing.preferences) !== signature))) return null
  const now = Date.now()
  let favorite
  if (isLegacy && existing) {
    // Retired results have no live editor. Keep their saved snapshot as the
    // content authority; a caller can update management state but cannot
    // replace the historical title, summary, result, or preferences.
    favorite = {
      ...existing,
      signature,
      favorite: true,
      archived: false,
      updatedAt: now,
      projectIds: [],
    }
  } else if (isLegacy) {
    // A new retired-module favorite can only be made from its protected
    // project record. Never turn arbitrary caller payload into a new legacy
    // snapshot, and never copy project-only association metadata to favorites.
    const sourceRecord = getRecordByPayload({ module: payload.module, preferences: payload.preferences })
    if (!sourceRecord || sourceRecord.module !== payload.module
      || createSignature(sourceRecord.module, sourceRecord.preferences) !== signature) return null
    const snapshot = { ...sourceRecord }
    const originProjectIds = Array.isArray(snapshot.projectIds) ? [...snapshot.projectIds] : []
    delete snapshot.id
    delete snapshot.projectIds
    delete snapshot.projectMetadata
    delete snapshot.favorite
    delete snapshot.archived
    favorite = {
      ...snapshot,
      id: createId('favorite'),
      signature,
      favorite: true,
      archived: false,
      originProjectIds,
      projectIds: [],
      createdAt: now,
      updatedAt: now,
    }
  } else {
    const sourceRecord = existing ? null : getRecordByPayload(payload)
    favorite = {
      ...existing,
      ...payload,
      id: existing?.id || createId('favorite'),
      signature,
      favorite: true,
      archived: false,
      originProjectIds: existing?.originProjectIds || sourceRecord?.projectIds || [],
      projectIds: [],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
  }
  const nextFavorites = [favorite, ...favorites.filter((item) => item.id !== favorite.id)]
  if (!writeValue(FAVORITES_KEY, nextFavorites)) return null
  normalizedFavoriteSource = undefined
  return favorite
}

function toggleFavorite(payload) {
  const existing = getFavoriteByPayload(payload)
  if (existing) return removeFavorite(existing.id) ? null : existing
  return saveFavoriteSnapshot(payload)
}

function toggleFavoriteById(favoriteId) {
  const favorite = getFavorites().find((item) => item.id === favoriteId)
  return favorite ? (removeFavorite(favoriteId) ? null : favorite) : null
}

function appendRecoveryEntry(kind, targetId, snapshot, extra = {}) {
  const entries = getRecoveryEntries()
  const existing = entries.find((entry) => entry.kind === kind && entry.targetId === targetId)
  if (existing) return { entries, entry: existing, alreadyPresent: true }
  const entry = {
    id: createId('recovery'),
    kind,
    targetId,
    deletedAt: Date.now(),
    snapshot: cloneStorageValue(snapshot),
    ...extra,
  }
  return { entries: [entry, ...entries], entry, alreadyPresent: false }
}

function isRetentionEligibleRecoveryEntry(entry) {
  return isPlainObject(entry)
    && RECOVERY_KINDS.has(entry.kind)
    && typeof entry.id === 'string' && Boolean(entry.id)
    && typeof entry.targetId === 'string' && Boolean(entry.targetId)
    && isPlainObject(entry.snapshot)
    && typeof entry.snapshot.id === 'string' && Boolean(entry.snapshot.id)
}

function processRecoveryRetention(now = Date.now()) {
  if (!Number.isFinite(now) || now < 0) {
    return { ok: false, error: '回收站清理时间无效，内容未删除。', removedCount: 0 }
  }
  if (!ensureStorageSchema()) {
    return { ok: false, error: storageMigrationError || '读取回收站失败，内容未删除。', removedCount: 0 }
  }

  const stored = readRawStorageValue(RECOVERY_KEY)
  if (!stored.ok || (stored.present && !Array.isArray(stored.value))) {
    return { ok: false, error: '读取回收站失败，内容未删除；请重试。', removedCount: 0 }
  }

  let changed = false
  let removedCount = 0
  const nextEntries = []
  for (const entry of stored.present ? stored.value : []) {
    if (!isRetentionEligibleRecoveryEntry(entry)) {
      nextEntries.push(entry)
      continue
    }

    const isLegacyRecent = entry.kind === 'legacy-recent'
    let retainedFrom = isLegacyRecent ? entry.retentionStartedAt : entry.deletedAt
    if (!Number.isFinite(retainedFrom) || retainedFrom < 0) {
      retainedFrom = now
      nextEntries.push({
        ...entry,
        deletedAt: now,
        ...(isLegacyRecent ? { retentionStartedAt: now } : {}),
      })
      changed = true
      continue
    }

    let currentEntry = entry
    if (isLegacyRecent && entry.deletedAt !== retainedFrom) {
      currentEntry = { ...entry, deletedAt: retainedFrom }
      changed = true
    }
    if (now - retainedFrom >= RECOVERY_RETENTION_MS) {
      removedCount += 1
      changed = true
      continue
    }
    nextEntries.push(currentEntry)
  }

  if (!changed) return { ok: true, error: '', removedCount: 0 }
  if (!writeValue(RECOVERY_KEY, nextEntries)) {
    return { ok: false, error: '回收站到期内容清理失败，内容仍保留；请重试。', removedCount: 0 }
  }
  normalizedRecoverySource = undefined
  return { ok: true, error: '', removedCount }
}

function permanentlyDeleteRecoveryEntry(recoveryId) {
  if (typeof recoveryId !== 'string' || !recoveryId || !ensureStorageSchema()) return false
  const stored = readRawStorageValue(RECOVERY_KEY)
  if (!stored.ok || !stored.present || !Array.isArray(stored.value)) return false
  const index = stored.value.findIndex((entry) => entry?.id === recoveryId)
  if (index < 0) return false
  const nextEntries = stored.value.filter((entry, entryIndex) => entryIndex !== index)
  if (!writeValue(RECOVERY_KEY, nextEntries)) return false
  normalizedRecoverySource = undefined
  return true
}

function removeFavorite(favoriteId) {
  const favorites = getFavorites()
  const favorite = favorites.find((item) => item.id === favoriteId)
  if (!favorite) return false
  const recovery = appendRecoveryEntry('favorite', favorite.id, favorite)
  const nextFavorites = favorites.filter((item) => item.id !== favoriteId)
  const recoveryBefore = getRecoveryEntries()
  const writes = [
    { key: RECOVERY_KEY, value: recovery.entries, previousValue: recoveryBefore },
    { key: FAVORITES_KEY, value: nextFavorites, previousValue: favorites },
  ]
  if (!writeValuesAtomically(writes)) return false
  normalizedFavoriteSource = undefined
  normalizedRecoverySource = undefined
  return true
}

function removeRecord(recordId) {
  const records = getRecords()
  const record = records.find((item) => item.id === recordId)
  if (!record) return false
  const recovery = appendRecoveryEntry('record', record.id, record)
  const nextRecords = records.filter((item) => item.id !== recordId)
  const recoveryBefore = getRecoveryEntries()
  if (!writeValuesAtomically([
    { key: RECOVERY_KEY, value: recovery.entries, previousValue: recoveryBefore },
    { key: RECORDS_KEY, value: nextRecords, previousValue: records },
  ])) return false
  normalizedRecordSource = undefined
  normalizedRecoverySource = undefined
  return true
}

function createProject(name) {
  const normalizedName = String(name || '').trim()
  if (!normalizedName) return null
  const projectName = normalizedName.slice(0, 30)

  const projects = getProjects()
  const existing = projects.find((project) => project.name === projectName)
  if (existing) return existing

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
  return writeValue(PROJECTS_KEY, [project, ...projects]) ? project : null
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
  const project = projects.find((item) => item.id === projectId)
  if (!project) return false
  const recovery = appendRecoveryEntry('project', project.id, project)
  const writes = [
    { key: RECOVERY_KEY, value: recovery.entries, previousValue: getRecoveryEntries() },
  ]
  writes.push({ key: PROJECTS_KEY, value: projects.filter((project) => project.id !== projectId), previousValue: projects })
  if (!writeValuesAtomically(writes)) return false
  normalizedProjectSource = undefined
  normalizedRecoverySource = undefined
  return true
}

function setActiveProject(projectId) {
  const project = getProjects().find((item) => item.id === projectId)
  return project && writeValue(ACTIVE_PROJECT_KEY, project.id) ? project : null
}

function getActiveProject() {
  const activeId = readValue(ACTIVE_PROJECT_KEY, '')
  return getProjects().find((project) => project.id === activeId) || null
}

function addRecordToProject(payload, projectId, metadata, options = {}) {
  const projectMetadata = metadata === undefined ? undefined : normalizeProjectRecordMetadata(metadata)
  if (metadata !== undefined && (!projectMetadata || !['limiter', 'gainStructure', 'cable', 'spl', 'camera', 'ledScreen', 'audioWiring', 'venue'].includes(payload?.module))) return null
  const project = getProjects().find((item) => item.id === projectId)
  return project ? saveRecord(payload, {
    projectId,
    ...(projectMetadata ? { projectMetadata } : {}),
    ...(options.recordId ? { recordId: options.recordId } : {}),
    ...(options.saveAs === true ? { saveAs: true } : {}),
    ...(options.saveToken ? { saveToken: String(options.saveToken) } : {}),
  }) : null
}

function getProjectRecords(projectId) {
  return getRecords().filter((record) => record.projectIds?.includes(projectId))
}

function getProjectRecordView(record, projectId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record
  const sourceMetadata = record.projectMetadata
  const metadata = ['limiter', 'gainStructure', 'cable', 'spl', 'camera', 'ledScreen', 'audioWiring', 'venue'].includes(record.module)
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
  const scheduleKeys = new Set(['version', 'revision', 'nextNumber', 'lines', 'devices'])
  if (Object.keys(value).some((key) => !scheduleKeys.has(key))) return false
  if (projectWiring.validateDeviceData(value)) return false
  const ids = new Set()
  const codes = new Set()
  const lineKeys = new Set([
    'id', 'code', 'purpose', 'fromDevice', 'fromPort', 'toDevice', 'toPort', 'buildType', 'cableType',
    'spec', 'connectorA', 'connectorB', 'lengthText', 'status', 'notes',
  ])
  const allowedLineKeys = new Set([...lineKeys, 'fromDeviceId', 'toDeviceId'])
  const lineTextLimits = {
    id: 100, code: 32, purpose: 100, fromDevice: 100, fromPort: 80, toDevice: 100, toPort: 80,
    buildType: 20, cableType: 20, spec: 120, connectorA: 60, connectorB: 60,
    lengthText: projectWiring.MAX_LENGTH_TEXT, status: 20, notes: 300,
    fromDeviceId: 100, toDeviceId: 100,
  }
  for (const line of value.lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)
      || Object.keys(line).some((key) => !allowedLineKeys.has(key))) return false
    if (Array.from(lineKeys).some((key) => !Object.prototype.hasOwnProperty.call(line, key))
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
    ...(change.deviceIds ? { deviceIds: change.deviceIds } : {}),
  }
}

function removeRecordFromProject(recordId, projectId) {
  const { records, projects } = getWorkspaceSnapshot()
  const record = records.find((item) => item.id === recordId)
  const project = projects.find((item) => item.id === projectId)
  if (!record?.projectIds?.includes(projectId) || !project) return false

  const now = Date.now()
  const recovery = appendRecoveryEntry('record-project-link', `${recordId}:${projectId}`, record, { projectId })
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
  const recoveryBefore = getRecoveryEntries()
  const saved = writeValuesAtomically([
    { key: RECOVERY_KEY, value: recovery.entries, previousValue: getRecoveryEntries() },
    { key: RECORDS_KEY, value: nextRecords, previousValue: records },
    { key: PROJECTS_KEY, value: nextProjects, previousValue: projects },
  ])
  if (!saved) return false
  normalizedRecordSource = undefined
  normalizedProjectSource = undefined
  normalizedRecoverySource = undefined
  return true
}

function restoreRecoveryEntry(recoveryId, targetProjectId) {
  if (typeof recoveryId !== 'string' || !recoveryId || !ensureStorageSchema()) return false
  const recoveryResult = readRawStorageValue(RECOVERY_KEY)
  if (!recoveryResult.ok || !recoveryResult.present || !Array.isArray(recoveryResult.value)) {
    storageValueCache.delete(RECOVERY_KEY)
    normalizedRecoverySource = undefined
    return false
  }
  const recoveryEntries = recoveryResult.value
  storageValueCache.set(RECOVERY_KEY, recoveryEntries)
  normalizedRecoverySource = undefined
  const entry = recoveryEntries.find((item) => item.id === recoveryId)
  if (!entry || !isPlainObject(entry.snapshot)) return false
  const remainingEntries = recoveryEntries.filter((item) => item.id !== recoveryId)
  const writes = []
  const clearRecoveryOnly = () => {
    if (!writeValue(RECOVERY_KEY, remainingEntries)) return false
    normalizedRecoverySource = undefined
    return true
  }

  if (entry.kind === 'project') {
    const projects = getProjects()
    const existing = projects.find((project) => project.id === entry.snapshot.id)
    if (existing) {
      const raw = findRawSnapshotById(PROJECTS_KEY, entry.snapshot.id)
      if (!raw.ok || !snapshotsEqual(raw.item, entry.snapshot)) return false
      return clearRecoveryOnly()
    }
    writes.push({ key: PROJECTS_KEY, value: [entry.snapshot, ...projects], previousValue: projects })
    normalizedProjectSource = undefined
  } else if (entry.kind === 'record') {
    const records = getRecords()
    const existing = records.find((record) => record.id === entry.snapshot.id)
    if (existing) {
      const raw = findRawSnapshotById(RECORDS_KEY, entry.snapshot.id)
      if (!raw.ok || !snapshotsEqual(raw.item, entry.snapshot)) return false
      return clearRecoveryOnly()
    }
    const record = normalizeRecord(entry.snapshot)
    if (!record || !record.projectIds.length) return false
    writes.push({ key: RECORDS_KEY, value: [entry.snapshot, ...records], previousValue: records })
    normalizedRecordSource = undefined
  } else if (entry.kind === 'favorite') {
    const favorites = getFavorites()
    const existing = favorites.find((favorite) => favorite.id === entry.snapshot.id)
    if (existing) {
      const raw = findRawSnapshotById(FAVORITES_KEY, entry.snapshot.id)
      if (!raw.ok || !snapshotsEqual(raw.item, entry.snapshot)) return false
      return clearRecoveryOnly()
    }
    const favorite = normalizeFavorite(entry.snapshot)
    if (!favorite) return false
    writes.push({ key: FAVORITES_KEY, value: [entry.snapshot, ...favorites], previousValue: favorites })
    normalizedFavoriteSource = undefined
  } else if (entry.kind === 'record-project-link') {
    const records = getRecords()
    const projectId = String(entry.projectId || '')
    if (!projectId) return false
    const current = records.find((record) => record.id === entry.snapshot.id)
    if (current?.projectIds?.includes(projectId)) return clearRecoveryOnly()
    if (!getProjects().some((project) => project.id === projectId)) return false
    const restored = current
      ? {
        ...current,
        projectIds: [...new Set([...(current.projectIds || []), projectId])],
        projectMetadata: {
          ...(current.projectMetadata && isPlainObject(current.projectMetadata) ? current.projectMetadata : {}),
          ...(entry.snapshot.projectMetadata?.[projectId]
            ? { [projectId]: entry.snapshot.projectMetadata[projectId] }
            : {}),
        },
      }
      : normalizeRecord(entry.snapshot)
    if (!restored) return false
    if (!restored.projectIds.includes(projectId)) restored.projectIds = [...restored.projectIds, projectId]
    const nextRecords = current
      ? records.map((record) => (record.id === current.id ? restored : record))
      : [restored, ...records]
    writes.push({ key: RECORDS_KEY, value: nextRecords, previousValue: records })
    const projects = getProjects()
    if (projects.some((project) => project.id === projectId)) {
      const nextProjects = projects.map((project) => (
        project.id === projectId ? { ...project, updatedAt: Date.now() } : project
      ))
      writes.push({ key: PROJECTS_KEY, value: nextProjects, previousValue: projects })
    }
    normalizedRecordSource = undefined
    normalizedProjectSource = undefined
  } else if (entry.kind === 'legacy-recent') {
    const projectId = String(targetProjectId || '')
    const project = getProjects().find((item) => item.id === projectId)
    if (!project) return false
    const records = getRecords()
    const existing = records.find((record) => record.id === entry.snapshot.id)
    if (existing) {
      const raw = findRawSnapshotById(RECORDS_KEY, entry.snapshot.id)
      if (!raw.ok || !snapshotsEqual(raw.item, entry.snapshot)) return false
      return clearRecoveryOnly()
    }
    const normalized = normalizeRecord(entry.snapshot)
    if (!normalized) return false
    const restored = {
      ...entry.snapshot,
      id: normalized.id,
      module: normalized.module,
      signature: typeof entry.snapshot.signature === 'string'
        ? entry.snapshot.signature
        : createSignature(normalized.module, normalized.preferences),
      favorite: false,
      archived: normalized.archived,
      projectIds: [projectId],
    }
    if (Number.isFinite(entry.snapshot.createdAt)) restored.createdAt = entry.snapshot.createdAt
    else delete restored.createdAt
    if (Number.isFinite(entry.snapshot.updatedAt)) restored.updatedAt = entry.snapshot.updatedAt
    else delete restored.updatedAt
    writes.push({ key: RECORDS_KEY, value: [restored, ...records], previousValue: records })
    const projects = getProjects()
    const nextProjects = projects.map((item) => (
      item.id === projectId ? { ...item, updatedAt: Date.now() } : item
    ))
    writes.push({ key: PROJECTS_KEY, value: nextProjects, previousValue: projects })
    normalizedRecordSource = undefined
    normalizedProjectSource = undefined
  } else {
    return false
  }

  writes.push({ key: RECOVERY_KEY, value: remainingEntries, previousValue: recoveryEntries })
  if (!writeValuesAtomically(writes)) return false
  normalizedRecoverySource = undefined
  return true
}

function restoreRecord(record) {
  if (!Object.prototype.hasOwnProperty.call(MODULES, record?.module)) return ''
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
    : record.module === 'camera'
      ? { ...record.preferences, cameraCalculationVersion: record.preferences.cameraCalculationVersion === 2 ? 2 : 1 }
      : record.preferences
  return module.path
}

function prepareProjectModule(projectId, moduleKey) {
  if (!Object.prototype.hasOwnProperty.call(MODULES, moduleKey)) return ''
  const module = MODULES[moduleKey]
  if (!module) return ''
  const project = getProjects().find((item) => item.id === projectId)
  if (!project) return ''
  return module.path
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
  getModuleMetadata,
  addRecordToProject: wrapMutation(addRecordToProject),
  createProject: wrapMutation(createProject),
  deleteProject: wrapMutation(deleteProject),
  getActiveProject,
  getFavoriteByPayload,
  getFavorites,
  getProjectRecords,
  getProjectRecordView,
  getProjectWiring,
  getProjects,
  getRecordById,
  getRecordByPayload,
  getRecordBySaveToken,
  getRecords,
  getRecoveryEntries,
  getStorageMigrationBackups,
  getStorageHealth,
  getWorkspaceSnapshot,
  permanentlyDeleteRecoveryEntry: wrapMutation(permanentlyDeleteRecoveryEntry),
  processRecoveryRetention: wrapMutation(processRecoveryRetention),
  RECOVERY_RETENTION_MS,
  prepareProjectModule: wrapMutation(prepareProjectModule),
  removeRecordFromProject: wrapMutation(removeRecordFromProject),
  removeRecord: wrapMutation(removeRecord),
  removeFavorite: wrapMutation(removeFavorite),
  restoreRecoveryEntry: wrapMutation(restoreRecoveryEntry),
  restoreStorageMigrationBackup: wrapMutation(restoreStorageMigrationBackup),
  restoreRecord: wrapMutation(restoreRecord),
  saveFavoriteSnapshot: wrapMutation(saveFavoriteSnapshot),
  saveRecord: wrapMutation(saveRecord),
  saveProjectWiring: wrapMutation(saveProjectWiring),
  setActiveProject: wrapMutation(setActiveProject),
  toggleFavorite: wrapMutation(toggleFavorite),
  toggleFavoriteById: wrapMutation(toggleFavoriteById),
  updateProject: wrapMutation(updateProject),
  STORAGE_SCHEMA_VERSION,
}

const { calculateDmxAddressPlan } = require('../../utils/dmx-address')
const { stageLightingProductIndex } = require('../../data/stage-lighting')
const records = require('../../utils/records')

const WORKSPACE_KEY = 'audioTool.dmxLightingWorkspace.v2'
const JOURNAL_KEY = 'audioTool.dmxLightingWorkspace.journal.v1'
const PREFERENCE_KEY = 'audioTool.dmxAddress.preferences'
const PROGRESS_KEY = 'audioTool.dmxAddress.progress'
const LEGACY_LAYOUT_KEY = 'audioTool.dmxLayout.v1'
const TEMPORARY_CONTEXT_ID = 'temporary'
const ENVELOPE_VERSION = 1
const SCHEME_VERSION = 2
const MAX_BACKUPS = 30
const LEGACY_MIRROR_KEYS = [PREFERENCE_KEY, PROGRESS_KEY, LEGACY_LAYOUT_KEY]

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function emptyPreferences() {
  return { startAddressText: '1', allocationMode: 'auto', groups: [], groupSummary: '' }
}

function normalizePreferences(preferences) {
  if (preferences === undefined || preferences === null || preferences === '') return emptyPreferences()
  if (!isObject(preferences)) return null
  if (preferences.groups !== undefined && !Array.isArray(preferences.groups)) return null
  if (Array.isArray(preferences.groups) && preferences.groups.some((group) => !isObject(group))) return null
  const next = clone(preferences)
  next.startAddressText = next.startAddressText === undefined ? '1' : String(next.startAddressText)
  next.allocationMode = next.allocationMode === undefined ? 'auto' : String(next.allocationMode)
  next.groups = Array.isArray(next.groups) ? next.groups : []
  if (typeof next.groupSummary !== 'string') {
    next.groupSummary = next.groups.map((group) => (
      `${String(group?.name || '灯具组')}×${String(group?.fixtureCount || '?')}（${String(group?.channelCount || '?')}CH）`
    )).join('；')
  }
  return next
}

function createLightingScheme(preferences) {
  const normalizedPreferences = normalizePreferences(preferences === undefined ? emptyPreferences() : preferences)
  if (!normalizedPreferences) return null
  const groupIds = normalizedPreferences.groups.map(() => createId('group'))
  return {
    version: SCHEME_VERSION,
    preferences: normalizedPreferences,
    groupIds,
    fixtureIdsByGroup: Object.fromEntries(groupIds.map((id) => [id, []])),
    checksById: {},
    layout: null,
  }
}

function normalizeScheme(scheme) {
  if (!isObject(scheme) || scheme.version !== SCHEME_VERSION) return null
  if (!isObject(scheme.preferences) || !Array.isArray(scheme.preferences.groups)) return null
  const preferences = normalizePreferences(scheme.preferences)
  if (!preferences || !Array.isArray(scheme.groupIds) || !isObject(scheme.fixtureIdsByGroup)
    || !isObject(scheme.checksById)) return null
  if (scheme.layout !== null && scheme.layout !== undefined && !isObject(scheme.layout)) return null
  if (scheme.legacySideLayout !== undefined && scheme.legacySideLayout !== null && !isObject(scheme.legacySideLayout)) return null
  return {
    version: SCHEME_VERSION,
    preferences,
    groupIds: scheme.groupIds.slice(),
    fixtureIdsByGroup: clone(scheme.fixtureIdsByGroup),
    checksById: clone(scheme.checksById),
    layout: scheme.layout === undefined ? null : clone(scheme.layout),
    ...(scheme.legacySideLayout ? { legacySideLayout: clone(scheme.legacySideLayout) } : {}),
  }
}

function validStableId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 120
}

function ensureSchemeIdentity(scheme) {
  const normalized = normalizeScheme(scheme)
  if (!normalized) return null
  const used = new Set()
  normalized.groupIds = normalized.preferences.groups.map((group, index) => {
    const previous = normalized.groupIds[index]
    const id = validStableId(previous) && !used.has(previous) ? previous : createId('group')
    used.add(id)
    return id
  })

  const fixtureIdsByGroup = {}
  const allFixtureIds = new Set()
  normalized.groupIds.forEach((groupId, groupIndex) => {
    const rawCount = Number(normalized.preferences.groups[groupIndex]?.fixtureCount)
    const count = Number.isInteger(rawCount) && rawCount > 0 && rawCount <= 200 ? rawCount : 0
    const previous = Array.isArray(normalized.fixtureIdsByGroup[groupId])
      ? normalized.fixtureIdsByGroup[groupId]
      : []
    fixtureIdsByGroup[groupId] = Array.from({ length: count }, (_, fixtureIndex) => {
      const candidate = previous[fixtureIndex]
      const id = validStableId(candidate) && !allFixtureIds.has(candidate) ? candidate : createId('fixture')
      allFixtureIds.add(id)
      return id
    })
  })
  normalized.fixtureIdsByGroup = fixtureIdsByGroup
  normalized.checksById = Object.fromEntries(Object.entries(normalized.checksById)
    .filter(([id, value]) => allFixtureIds.has(id) && isObject(value) && typeof value.fingerprint === 'string'))
  if (normalized.layout && isObject(normalized.layout.positionsById)) {
    normalized.layout.positionsById = Object.fromEntries(Object.entries(normalized.layout.positionsById)
      .filter(([id]) => allFixtureIds.has(id)))
  }
  return normalized
}

function fixtureFingerprint(fixture) {
  return JSON.stringify([
    String(fixture.fixtureModel || ''),
    Number(fixture.channelCount) || 0,
    String(fixture.universeLabel || ''),
    Number(fixture.startAddress) || 0,
    Number(fixture.endAddress) || 0,
  ])
}

function calculateEngineInput(scheme) {
  const preferences = scheme.preferences
  if (!['auto', 'manual'].includes(preferences.allocationMode)) {
    return { valid: false, error: '编址方式无效，已阻止保存。' }
  }
  const groups = preferences.groups.map((group, index) => {
    const fixtureModel = String(group.fixtureModel || '').trim()
    const knownFixture = stageLightingProductIndex.get(fixtureModel)
    const fixtureSource = group.fixtureSource === 'library'
      ? 'library'
      : group.fixtureSource === 'custom'
        ? 'custom'
        : knownFixture ? 'library' : 'custom'
    const channelCount = Number(group.channelCount)
    if (fixtureSource === 'library') {
      if (!knownFixture || !knownFixture.channelModes.includes(channelCount)) {
        return { invalid: `第 ${index + 1} 组的型号或通道模式不在灯具库中，已阻止保存。` }
      }
    }
    if (preferences.allocationMode === 'manual' && !['A', 'B', 'C', 'D'].includes(String(group.targetUniverse || '').toUpperCase())) {
      return { invalid: `第 ${index + 1} 组的目标域无效，已阻止保存。` }
    }
    return {
      ...group,
      id: scheme.groupIds[index] || `validation-group-${index + 1}`,
      fixtureModel: fixtureSource === 'custom' ? '' : fixtureModel,
    }
  })
  const invalid = groups.find((group) => group?.invalid)
  if (invalid) return { valid: false, error: invalid.invalid }
  if (!groups.length) {
    const startAddress = Number(preferences.startAddressText)
    if (!Number.isInteger(startAddress) || startAddress < 1 || startAddress > 512) {
      return { valid: false, error: '起始地址必须是 1 至 512 的整数。' }
    }
    return {
      valid: true,
      empty: true,
      result: {
        allocationMode: preferences.allocationMode,
        modeText: preferences.allocationMode === 'manual' ? '按组分域' : '连续自动',
        startUniverse: 1,
        startUniverseLabel: 'A',
        startAddress,
        startText: `A${String(startAddress).padStart(3, '0')}`,
        endText: '',
        nextText: `A${String(startAddress).padStart(3, '0')}`,
        nextMetricLabel: '下一可用',
        totalFixtures: 0,
        totalGroups: 0,
        totalChannels: 0,
        groups: [],
        fixtures: [],
        universeSummaries: [],
        warnings: [],
        valid: true,
      },
    }
  }
  const result = calculateDmxAddressPlan({
    startAddress: preferences.startAddressText,
    allocationMode: preferences.allocationMode,
    groups,
  })
  return result.error ? { valid: false, error: result.error, result } : { valid: true, result }
}

function calculateScheme(inputScheme) {
  let scheme = normalizeScheme(inputScheme)
  if (!scheme) return { ok: false, valid: false, error: '灯光方案格式异常，已阻止计算。', result: null, scheme: null }
  const validation = calculateEngineInput(scheme)
  if (!validation.valid) {
    return { ok: true, valid: false, error: validation.error, result: { ...(validation.result || {}), error: validation.error, valid: false }, scheme }
  }
  scheme = ensureSchemeIdentity(scheme)
  if (!scheme) return { ok: false, valid: false, error: '灯光方案格式异常，已阻止计算。', result: null, scheme: null }
  if (validation.empty) {
    return { ok: true, valid: true, error: '', result: validation.result, scheme }
  }

  const groups = scheme.preferences.groups.map((group, index) => ({
    ...group,
    id: scheme.groupIds[index],
    fixtureModel: (group.fixtureSource === 'custom'
      || (!group.fixtureSource && !stageLightingProductIndex.has(String(group.fixtureModel || '').trim())))
      ? ''
      : String(group.fixtureModel || ''),
  }))
  const result = calculateDmxAddressPlan({
    startAddress: scheme.preferences.startAddressText,
    allocationMode: scheme.preferences.allocationMode,
    groups,
  })

  const activeIds = new Set()
  const checksById = {}
  const groupById = new Map()
  const mappedGroups = result.groups.map((group, groupIndex) => {
    const groupId = scheme.groupIds[groupIndex]
    const fixtureIds = scheme.fixtureIdsByGroup[groupId] || []
    const mappedFixtures = group.fixtures.map((fixture) => {
      const stableId = fixtureIds[fixture.fixtureIndex - 1] || createId('fixture')
      activeIds.add(stableId)
      const fingerprint = fixtureFingerprint(fixture)
      const previousCheck = scheme.checksById[stableId]
      if (previousCheck?.fingerprint === fingerprint) checksById[stableId] = { fingerprint }
      return { ...fixture, stableId }
    })
    const mapped = { ...group, stableId: groupId, fixtures: mappedFixtures }
    groupById.set(groupId, mapped)
    return mapped
  })
  const fixtures = result.fixtures.map((fixture) => {
    const group = groupById.get(fixture.groupId)
    return { ...fixture, stableId: group?.fixtures.find((item) => item.fixtureIndex === fixture.fixtureIndex)?.stableId }
  })
  scheme.checksById = checksById
  if (scheme.layout && isObject(scheme.layout.positionsById)) {
    scheme.layout.positionsById = Object.fromEntries(Object.entries(scheme.layout.positionsById)
      .filter(([id]) => activeIds.has(id)))
  }
  return {
    ok: true,
    valid: true,
    error: '',
    result: { ...result, groups: mappedGroups, fixtures, valid: true },
    scheme,
  }
}

function getStorageValue(key) {
  try {
    const value = wx.getStorageSync(key)
    return { ok: true, value: value === undefined || value === '' ? undefined : value }
  } catch (error) {
    return { ok: false, value: undefined, error }
  }
}

function setStorageValue(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (error) {
    return false
  }
}

function removeStorageValue(key) {
  try {
    if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(key)
    else wx.setStorageSync(key, '')
    return true
  } catch (error) {
    return false
  }
}

function storageSnapshot(keys) {
  const snapshot = {}
  for (const key of keys) {
    const result = getStorageValue(key)
    if (!result.ok) return { ok: false, error: '读取灯光存储快照失败，已阻止写入。' }
    snapshot[key] = { present: result.value !== undefined, value: clone(result.value) }
  }
  return { ok: true, snapshot }
}

function snapshotMatches(snapshot, values) {
  return Object.entries(snapshot).every(([key, entry]) => {
    const value = values[key]
    const present = value !== undefined
    return entry.present === present && (!present || JSON.stringify(entry.value) === JSON.stringify(value))
  })
}

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function isValidStorageEntry(key, entry) {
  if (!isObject(entry) || typeof entry.present !== 'boolean') return false
  if (!entry.present) return entry.value === undefined
  if (!Object.prototype.hasOwnProperty.call(entry, 'value')) return false
  if (key === WORKSPACE_KEY) return isValidEnvelope(entry.value)
  if (key === PREFERENCE_KEY) return Boolean(normalizePreferences(entry.value))
  return isObject(entry.value)
}

function sameSnapshotEntry(entry, value) {
  const present = value !== undefined
  return Boolean(entry && entry.present === present
    && (!present || JSON.stringify(entry.value) === JSON.stringify(value)))
}

function applyStorageSnapshot(snapshot) {
  for (const [key, entry] of Object.entries(snapshot)) {
    const ok = entry.present ? setStorageValue(key, entry.value) : removeStorageValue(key)
    if (!ok) return false
  }
  return true
}

function recoverPendingJournal() {
  const journalResult = getStorageValue(JOURNAL_KEY)
  if (!journalResult.ok) return { ok: false, error: '读取灯光保存恢复记录失败，请检查本地存储后重试。' }
  const journal = journalResult.value
  if (journal === undefined) return { ok: true }
  const snapshotKeys = [WORKSPACE_KEY, ...LEGACY_MIRROR_KEYS]
  const mirrorKeys = LEGACY_MIRROR_KEYS
  if (!isObject(journal) || journal.version !== 1
    || !hasExactKeys(journal.oldSnapshot, snapshotKeys)
    || !hasExactKeys(journal.nextSnapshot, snapshotKeys)
    || !hasExactKeys(journal.oldMirrorValues, mirrorKeys)
    || !hasExactKeys(journal.nextMirrorValues, mirrorKeys)
    || snapshotKeys.some((key) => !isValidStorageEntry(key, journal.oldSnapshot[key])
      || !isValidStorageEntry(key, journal.nextSnapshot[key]))
    || mirrorKeys.some((key) => !isValidStorageEntry(key, journal.oldMirrorValues[key])
      || !isValidStorageEntry(key, journal.nextMirrorValues[key]))) {
    return { ok: false, error: '灯光保存恢复记录格式异常，已保留原数据并停止读写。' }
  }
  const currentWorkspace = getStorageValue(WORKSPACE_KEY)
  if (!currentWorkspace.ok) return { ok: false, error: '读取灯光工作区失败，保存恢复暂不可用。' }
  const workspaceState = { [WORKSPACE_KEY]: currentWorkspace.value }
  const committed = snapshotMatches({ [WORKSPACE_KEY]: journal.nextSnapshot[WORKSPACE_KEY] }, workspaceState)
  const aborted = snapshotMatches({ [WORKSPACE_KEY]: journal.oldSnapshot[WORKSPACE_KEY] }, workspaceState)
  if (!committed && !aborted) {
    return { ok: false, error: '灯光保存状态无法判定；恢复记录和当前方案均已保留，请联系支持。' }
  }
  const targetMirrorValues = committed ? journal.nextMirrorValues : journal.oldMirrorValues
  for (const key of LEGACY_MIRROR_KEYS) {
    const current = getStorageValue(key)
    if (!current.ok) return { ok: false, error: '读取灯光兼容数据失败；恢复记录仍已保留，请重试。' }
    const oldEntry = journal.oldMirrorValues[key]
    const nextEntry = journal.nextMirrorValues[key]
    if (!sameSnapshotEntry(oldEntry, current.value) && !sameSnapshotEntry(nextEntry, current.value)) continue
    const target = targetMirrorValues[key]
    const ok = target.present ? setStorageValue(key, target.value) : removeStorageValue(key)
    if (!ok) return { ok: false, error: '灯光保存恢复未完成；草稿和恢复记录均已保留，请重试。' }
  }
  if (!removeStorageValue(JOURNAL_KEY)) {
    return { ok: false, error: '灯光数据已恢复，但恢复记录暂未清理；请重试后继续操作。' }
  }
  return { ok: true }
}

function readLegacyBundle() {
  const preferenceResult = getStorageValue(PREFERENCE_KEY)
  const progressResult = getStorageValue(PROGRESS_KEY)
  const layoutResult = getStorageValue(LEGACY_LAYOUT_KEY)
  if (!preferenceResult.ok || !progressResult.ok || !layoutResult.ok) {
    return { ok: false, error: '读取灯光旧数据失败，请检查本地存储后重试。' }
  }
  const preferences = normalizePreferences(preferenceResult.value)
  if (!preferences || (progressResult.value !== undefined && !isObject(progressResult.value))
    || (layoutResult.value !== undefined && !isObject(layoutResult.value))) {
    return { ok: false, error: '灯光旧数据格式异常，已阻止覆盖。' }
  }
  const values = [preferenceResult.value, progressResult.value, layoutResult.value]
  const parts = {
    preferences: JSON.stringify(preferenceResult.value === undefined ? null : preferenceResult.value),
    progress: JSON.stringify(progressResult.value === undefined ? null : progressResult.value),
    layout: JSON.stringify(layoutResult.value === undefined ? null : layoutResult.value),
  }
  return {
    ok: true,
    preferences,
    progress: progressResult.value,
    layout: layoutResult.value,
    signature: JSON.stringify(values),
    parts,
  }
}

function createEnvelope(legacy) {
  let scheme = createLightingScheme(legacy.preferences)
  if (!scheme) return null
  if (legacy.layout) scheme.legacySideLayout = clone(legacy.layout)
  const calculated = calculateScheme(scheme)
  if (calculated.ok && calculated.valid) {
    scheme = calculated.scheme
    const legacyProgress = legacy.progress
    if (legacyProgress?.calculationSignature === JSON.stringify(scheme.preferences)
      && Array.isArray(legacyProgress.keys)) {
      const keys = new Set(legacyProgress.keys.filter((item) => typeof item === 'string'))
      calculated.result.fixtures.forEach((fixture) => {
        const oldKey = `${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`
        if (keys.has(oldKey)) scheme.checksById[fixture.stableId] = { fingerprint: fixtureFingerprint(fixture) }
      })
    }
  }
  return {
    version: ENVELOPE_VERSION,
    globalRevision: 0,
    lastContextId: TEMPORARY_CONTEXT_ID,
    contexts: {
      [TEMPORARY_CONTEXT_ID]: { revision: 0, scheme },
    },
    backups: [],
    legacyMirrorSignature: legacy.signature,
    legacyMirrorSnapshot: clone(legacy.parts),
  }
}

function isValidEnvelope(value) {
  if (!isObject(value) || value.version !== ENVELOPE_VERSION || !isObject(value.contexts)
    || !Array.isArray(value.backups) || !Number.isSafeInteger(value.globalRevision)
    || value.globalRevision < 0 || typeof value.lastContextId !== 'string'
    || !isObject(value.legacyMirrorSnapshot)) return false
  return Object.entries(value.contexts).every(([contextId, entry]) => (
    typeof contextId === 'string' && isObject(entry) && Number.isSafeInteger(entry.revision)
    && entry.revision >= 0 && Boolean(normalizeScheme(entry.scheme))
  ))
}

function projectSnapshot() {
  try {
    const snapshot = records.getWorkspaceSnapshot({ forceRefresh: true })
    if (!snapshot?.ok) return { ok: false, error: snapshot?.error || '读取项目失败，请重试。' }
    return { ok: true, projects: snapshot.projects }
  } catch (error) {
    return { ok: false, error: '读取项目失败，请重试。' }
  }
}

function hasSchemeData(scheme) {
  return Boolean(scheme && (scheme.preferences.groups.length || scheme.legacySideLayout || scheme.layout))
}

function addBackup(envelope, contextId, entry, reason) {
  if (!entry?.scheme) return
  envelope.backups.unshift({
    id: createId('lighting-backup'),
    contextId,
    revision: entry.revision,
    reason,
    createdAt: Date.now(),
    scheme: clone(entry.scheme),
  })
  envelope.backups = envelope.backups.slice(0, MAX_BACKUPS)
}

function importLegacyIntoTemporary(envelope, legacy) {
  const existing = envelope.contexts[TEMPORARY_CONTEXT_ID]
  if (existing && hasSchemeData(existing.scheme)) addBackup(envelope, TEMPORARY_CONTEXT_ID, existing, 'legacy-import')
  let scheme = createLightingScheme(legacy.preferences)
  const oldLayoutSignature = envelope.legacyMirrorSnapshot?.layout
  const incomingLayoutChanged = legacy.parts.layout !== oldLayoutSignature
  if (legacy.layout && incomingLayoutChanged) scheme.legacySideLayout = clone(legacy.layout)
  const calculated = calculateScheme(scheme)
  if (calculated.ok && calculated.valid) {
    scheme = calculated.scheme
    if (legacy.progress?.calculationSignature === JSON.stringify(scheme.preferences)
      && Array.isArray(legacy.progress.keys)) {
      const oldKeys = new Set(legacy.progress.keys.filter((key) => typeof key === 'string'))
      calculated.result.fixtures.forEach((fixture) => {
        if (oldKeys.has(`${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`)) {
          scheme.checksById[fixture.stableId] = { fingerprint: fixtureFingerprint(fixture) }
        }
      })
    }
  }
  envelope.contexts[TEMPORARY_CONTEXT_ID] = {
    revision: (existing?.revision || 0) + 1,
    scheme,
  }
  envelope.lastContextId = TEMPORARY_CONTEXT_ID
  envelope.legacyMirrorSignature = legacy.signature
  envelope.legacyMirrorSnapshot = clone(legacy.parts)
  envelope.globalRevision += 1
}

function readEnvelope() {
  const recovery = recoverPendingJournal()
  if (!recovery.ok) return recovery
  const rawResult = getStorageValue(WORKSPACE_KEY)
  if (!rawResult.ok) return { ok: false, error: '读取灯光工作区失败，请检查本地存储后重试。' }
  const legacy = readLegacyBundle()
  if (!legacy.ok) return legacy
  if (rawResult.value === undefined) {
    const envelope = createEnvelope(legacy)
    if (!envelope) return { ok: false, error: '灯光旧数据格式异常，已阻止覆盖。' }
    if (!setStorageValue(WORKSPACE_KEY, envelope)) return { ok: false, error: '初始化灯光工作区失败，请重试。' }
    return { ok: true, envelope }
  }
  if (!isValidEnvelope(rawResult.value)) return { ok: false, error: '灯光工作区格式或版本异常，已阻止覆盖。' }

  const envelope = clone(rawResult.value)
  if (legacy.signature !== envelope.legacyMirrorSignature) {
    importLegacyIntoTemporary(envelope, legacy)
    if (!setStorageValue(WORKSPACE_KEY, envelope)) {
      return { ok: false, error: '检测到旧灯光数据更新，但安全导入失败；原数据已保留，请重试。' }
    }
  }
  return { ok: true, envelope }
}

function importLegacyLightingPreferences() {
  const recovery = recoverPendingJournal()
  if (!recovery.ok) {
    return { ok: false, error: recovery.error, contextId: TEMPORARY_CONTEXT_ID, scheme: null, revision: null }
  }
  const rawResult = getStorageValue(WORKSPACE_KEY)
  if (!rawResult.ok) return { ok: false, error: '读取灯光工作区失败，请检查本地存储后重试。' }
  const legacy = readLegacyBundle()
  if (!legacy.ok) return legacy
  if (rawResult.value === undefined) {
    const initial = readEnvelope()
    return initial.ok
      ? readLightingWorkspace(TEMPORARY_CONTEXT_ID)
      : { ok: false, error: initial.error, contextId: TEMPORARY_CONTEXT_ID, scheme: null, revision: null }
  }
  if (!isValidEnvelope(rawResult.value)) {
    return { ok: false, error: '灯光工作区格式或版本异常，已阻止覆盖。', contextId: TEMPORARY_CONTEXT_ID, scheme: null, revision: null }
  }
  const incomingAlreadyDetected = legacy.signature !== rawResult.value.legacyMirrorSignature
  const read = readEnvelope()
  if (!read.ok) return { ok: false, error: read.error, contextId: TEMPORARY_CONTEXT_ID, scheme: null, revision: null }
  if (!incomingAlreadyDetected) importLegacyIntoTemporary(read.envelope, legacy)
  const saved = saveEnvelope(read.envelope, null)
  if (!saved.ok) return { ok: false, error: saved.error, contextId: TEMPORARY_CONTEXT_ID, scheme: null, revision: null }
  return readLightingWorkspace(TEMPORARY_CONTEXT_ID)
}

function getContextEntry(envelope, contextId, createIfMissing = false, allowOrphan = false) {
  const id = String(contextId || TEMPORARY_CONTEXT_ID)
  if (id !== TEMPORARY_CONTEXT_ID) {
    const snapshot = projectSnapshot()
    if (!snapshot.ok) return { ok: false, error: snapshot.error }
    if (!snapshot.projects.some((project) => project.id === id)) {
      if (!(allowOrphan && envelope.contexts[id])) return { ok: false, error: '项目不存在或已删除。' }
      return { ok: true, contextId: id, entry: envelope.contexts[id], orphan: true }
    }
  }
  if (!envelope.contexts[id] && createIfMissing) {
    envelope.contexts[id] = { revision: 0, scheme: createLightingScheme() }
  }
  return { ok: true, contextId: id, entry: envelope.contexts[id] || null }
}

function getMirrorValues(scheme) {
  const checked = calculateScheme(scheme)
  const keys = []
  if (checked.ok && checked.valid) {
    checked.result.fixtures.forEach((fixture) => {
      const check = checked.scheme.checksById[fixture.stableId]
      if (check?.fingerprint === fixtureFingerprint(fixture)) {
        keys.push(`${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`)
      }
    })
  }
  return {
    [PREFERENCE_KEY]: clone(scheme.preferences),
    [PROGRESS_KEY]: { calculationSignature: JSON.stringify(scheme.preferences), keys },
  }
}

function saveEnvelope(envelope, mirrorScheme) {
  const mirrorValues = {}
  if (mirrorScheme) {
    Object.assign(mirrorValues, getMirrorValues(mirrorScheme))
    const currentLayout = getStorageValue(LEGACY_LAYOUT_KEY)
    if (!currentLayout.ok) return { ok: false, error: '读取灯光兼容布局失败，已阻止保存。' }
    mirrorValues[LEGACY_LAYOUT_KEY] = mirrorScheme.legacySideLayout
      ? clone(mirrorScheme.legacySideLayout)
      : clone(currentLayout.value)
    const mirrorBundle = [
      mirrorValues[PREFERENCE_KEY],
      mirrorValues[PROGRESS_KEY],
      mirrorValues[LEGACY_LAYOUT_KEY] === undefined ? null : mirrorValues[LEGACY_LAYOUT_KEY],
    ]
    envelope.legacyMirrorSignature = JSON.stringify(mirrorBundle)
    envelope.legacyMirrorSnapshot = {
      preferences: JSON.stringify(mirrorBundle[0]),
      progress: JSON.stringify(mirrorBundle[1]),
      layout: JSON.stringify(mirrorBundle[2]),
    }
  }
  const keys = [WORKSPACE_KEY, PREFERENCE_KEY, PROGRESS_KEY, LEGACY_LAYOUT_KEY]
  const oldState = storageSnapshot(keys)
  if (!oldState.ok) return oldState
  const nextSnapshot = clone(oldState.snapshot)
  nextSnapshot[WORKSPACE_KEY] = { present: true, value: clone(envelope) }
  for (const [key, value] of Object.entries(mirrorValues)) {
    nextSnapshot[key] = { present: value !== undefined, value: clone(value) }
  }
  const oldMirrorValues = Object.fromEntries(
    [PREFERENCE_KEY, PROGRESS_KEY, LEGACY_LAYOUT_KEY].map((key) => [key, oldState.snapshot[key]])
  )
  const nextMirrorValues = Object.fromEntries(
    [PREFERENCE_KEY, PROGRESS_KEY, LEGACY_LAYOUT_KEY].map((key) => [key, nextSnapshot[key]])
  )
  const journal = {
    version: 1,
    oldSnapshot: oldState.snapshot,
    nextSnapshot,
    oldMirrorValues,
    nextMirrorValues,
  }
  if (!setStorageValue(JOURNAL_KEY, journal)) {
    return { ok: false, error: '创建灯光保存恢复记录失败，数据未更改，请重试。' }
  }
  if (!applyStorageSnapshot(nextMirrorValues)) {
    return { ok: false, error: '保存灯光兼容数据失败；恢复记录已保留，请重试。' }
  }
  if (!setStorageValue(WORKSPACE_KEY, envelope)) {
    return { ok: false, error: '保存灯光工作区失败；恢复记录已保留，页面草稿仍在，请重试。' }
  }
  const cleared = removeStorageValue(JOURNAL_KEY)
  return { ok: true, recoveryPending: !cleared }
}

function readLightingWorkspace(contextId) {
  const read = readEnvelope()
  if (!read.ok) return { ok: false, error: read.error, contextId: contextId || '', scheme: null, revision: null }
  const id = String(contextId || read.envelope.lastContextId || TEMPORARY_CONTEXT_ID)
  const context = getContextEntry(read.envelope, id, true, true)
  if (!context.ok) return { ok: false, error: context.error, contextId: id, scheme: null, revision: null }
  if (!context.entry) {
    const initialized = saveEnvelope(read.envelope, id === read.envelope.lastContextId
      ? read.envelope.contexts[id].scheme
      : null)
    if (!initialized.ok) return { ok: false, error: initialized.error, contextId: id, scheme: null, revision: null }
  }
  const entry = read.envelope.contexts[id]
  return {
    ok: true,
    error: '',
    contextId: id,
    selectedContextId: read.envelope.lastContextId,
    scheme: clone(entry.scheme),
    revision: entry.revision,
    exists: Boolean(entry.revision || hasSchemeData(entry.scheme)),
    orphan: Boolean(context.orphan),
  }
}

function getLightingContexts() {
  const read = readEnvelope()
  if (!read.ok) return { ok: false, error: read.error, rows: [], selectedContextId: '' }
  const snapshot = projectSnapshot()
  if (!snapshot.ok) return { ok: false, error: snapshot.error, rows: [], selectedContextId: '' }
  const rows = [
    { id: TEMPORARY_CONTEXT_ID, name: '临时设置', temporary: true, hasLighting: hasSchemeData(read.envelope.contexts[TEMPORARY_CONTEXT_ID]?.scheme) },
    ...snapshot.projects.map((project) => ({
      id: project.id,
      name: project.name,
      temporary: false,
      hasLighting: Boolean(read.envelope.contexts[project.id]?.scheme),
      revision: read.envelope.contexts[project.id]?.revision || 0,
    })),
  ]
  const selectedProjectExists = read.envelope.lastContextId === TEMPORARY_CONTEXT_ID
    || rows.some((row) => row.id === read.envelope.lastContextId)
  if (!selectedProjectExists && read.envelope.contexts[read.envelope.lastContextId]) {
    rows.push({
      id: read.envelope.lastContextId,
      name: '已删除项目（灯光数据已保留）',
      temporary: false,
      orphan: true,
      hasLighting: true,
      revision: read.envelope.contexts[read.envelope.lastContextId].revision,
    })
  }
  return { ok: true, error: '', rows, selectedContextId: read.envelope.lastContextId }
}

function saveLightingScheme(contextId, inputScheme, expectedRevision) {
  const read = readEnvelope()
  if (!read.ok) return { ok: false, error: read.error, revision: null }
  const context = getContextEntry(read.envelope, contextId, true)
  if (!context.ok) return { ok: false, error: context.error, revision: null }
  const current = context.entry || { revision: 0, scheme: createLightingScheme() }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    return { ok: false, error: 'conflict', revision: current.revision, currentScheme: clone(current.scheme) }
  }
  const calculation = calculateScheme(inputScheme)
  if (!calculation.ok || !calculation.valid) {
    return { ok: false, error: calculation.error || '灯光方案格式异常，已阻止保存。', revision: current.revision }
  }
  const scheme = calculation.scheme
  const nextEntry = { revision: current.revision + 1, scheme }
  read.envelope.contexts[context.contextId] = nextEntry
  read.envelope.globalRevision += 1
  const saved = saveEnvelope(read.envelope, read.envelope.lastContextId === context.contextId ? scheme : null)
  if (!saved.ok) return { ok: false, error: saved.error, revision: current.revision }
  return { ok: true, error: '', revision: nextEntry.revision, scheme: clone(scheme) }
}

function switchLightingContext(nextContextId, currentScheme, expectedRevision, sourceContextId) {
  const read = readEnvelope()
  if (!read.ok) return { ok: false, error: read.error, contextId: nextContextId || '', scheme: null, revision: null }
  const currentId = read.envelope.lastContextId || TEMPORARY_CONTEXT_ID
  const sourceId = String(sourceContextId || '')
  if (!sourceId || sourceId !== currentId) {
    const sourceEntry = read.envelope.contexts[sourceId]
    return {
      ok: false,
      error: 'conflict',
      contextId: sourceId || currentId,
      scheme: clone(sourceEntry?.scheme || read.envelope.contexts[currentId]?.scheme || null),
      revision: sourceEntry?.revision ?? read.envelope.contexts[currentId]?.revision ?? null,
      currentScheme: clone(sourceEntry?.scheme || read.envelope.contexts[currentId]?.scheme || null),
    }
  }
  const currentContext = getContextEntry(read.envelope, currentId, true, true)
  const nextId = String(nextContextId || TEMPORARY_CONTEXT_ID)
  const nextContext = getContextEntry(read.envelope, nextId, true)
  if (!currentContext.ok || !nextContext.ok) {
    return { ok: false, error: currentContext.error || nextContext.error, contextId: currentId, scheme: null, revision: null }
  }
  const current = currentContext.entry || { revision: 0, scheme: createLightingScheme() }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    return { ok: false, error: 'conflict', contextId: currentId, scheme: clone(current.scheme), revision: current.revision }
  }
  const calculation = calculateScheme(currentScheme || current.scheme)
  const sameAsStored = JSON.stringify(currentScheme || current.scheme) === JSON.stringify(current.scheme)
  if ((!calculation.ok || !calculation.valid) && !sameAsStored) {
    return { ok: false, error: calculation.error || '灯光方案格式异常，已阻止切换。', contextId: currentId, scheme: clone(current.scheme), revision: current.revision }
  }
  const savedScheme = calculation.ok && calculation.valid ? calculation.scheme : clone(current.scheme)
  const savedEntry = { revision: current.revision + 1, scheme: savedScheme }
  read.envelope.contexts[currentId] = savedEntry
  const targetEntry = read.envelope.contexts[nextId] || { revision: 0, scheme: createLightingScheme() }
  read.envelope.contexts[nextId] = targetEntry
  read.envelope.lastContextId = nextId
  read.envelope.globalRevision += 1
  const saved = saveEnvelope(read.envelope, targetEntry.scheme)
  if (!saved.ok) return { ok: false, error: saved.error, contextId: currentId, scheme: clone(current.scheme), revision: current.revision }
  return {
    ok: true,
    error: '',
    contextId: nextId,
    selectedContextId: nextId,
    scheme: clone(targetEntry.scheme),
    revision: targetEntry.revision,
    exists: Boolean(targetEntry.revision || hasSchemeData(targetEntry.scheme)),
  }
}

function saveLightingToProject(projectId, inputScheme, options = {}) {
  const id = String(projectId || '')
  if (!id || id === TEMPORARY_CONTEXT_ID) return { ok: false, error: '请选择有效项目。' }
  const read = readEnvelope()
  if (!read.ok) return { ok: false, error: read.error }
  const context = getContextEntry(read.envelope, id, true)
  if (!context.ok) return { ok: false, error: context.error }
  const current = context.entry || { revision: 0, scheme: createLightingScheme() }
  const exists = Boolean(current.revision || hasSchemeData(current.scheme))
  if (exists && options.replace !== true) {
    return { ok: false, error: 'exists', exists: true, revision: current.revision, currentScheme: clone(current.scheme) }
  }
  const expectedRevision = options.expectedRevision
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    return { ok: false, error: 'conflict', revision: current.revision, currentScheme: clone(current.scheme) }
  }
  const calculation = calculateScheme(inputScheme)
  if (!calculation.ok || !calculation.valid) {
    return { ok: false, error: calculation.error || '灯光方案格式异常，已阻止保存。', revision: current.revision }
  }
  const scheme = calculation.scheme
  if (exists) addBackup(read.envelope, id, current, 'project-replace')
  const entry = { revision: current.revision + 1, scheme }
  read.envelope.contexts[id] = entry
  read.envelope.lastContextId = id
  read.envelope.globalRevision += 1
  const saved = saveEnvelope(read.envelope, scheme)
  if (!saved.ok) return { ok: false, error: saved.error, revision: current.revision }
  return { ok: true, error: '', revision: entry.revision, scheme: clone(scheme), backup: exists ? read.envelope.backups[0] : null }
}

function restoreLightingBackup(contextId, backupId, expectedRevision) {
  const read = readEnvelope()
  if (!read.ok) return { ok: false, error: read.error, revision: null }
  const context = getContextEntry(read.envelope, contextId, true)
  if (!context.ok) return { ok: false, error: context.error, revision: null }
  const current = context.entry || { revision: 0, scheme: createLightingScheme() }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    return { ok: false, error: 'conflict', revision: current.revision, currentScheme: clone(current.scheme) }
  }
  const backup = read.envelope.backups.find((item) => (
    isObject(item) && item.id === backupId && item.contextId === context.contextId
  ))
  if (!backup) return { ok: false, error: '找不到可恢复的灯光备份。', revision: current.revision }
  const calculation = calculateScheme(backup.scheme)
  if (!calculation.ok || !calculation.valid || !calculation.scheme) {
    return { ok: false, error: '备份数据格式异常，已保留备份且未覆盖当前方案。', revision: current.revision }
  }
  addBackup(read.envelope, context.contextId, current, 'before-restore')
  const scheme = calculation.scheme
  const entry = { revision: current.revision + 1, scheme }
  read.envelope.contexts[context.contextId] = entry
  read.envelope.lastContextId = context.contextId
  read.envelope.globalRevision += 1
  const saved = saveEnvelope(read.envelope, scheme)
  if (!saved.ok) return { ok: false, error: saved.error, revision: current.revision }
  return { ok: true, error: '', revision: entry.revision, scheme: clone(scheme) }
}

module.exports = {
  WORKSPACE_KEY,
  JOURNAL_KEY,
  TEMPORARY_CONTEXT_ID,
  createLightingScheme,
  ensureSchemeIdentity,
  calculateScheme,
  readLightingWorkspace,
  getLightingContexts,
  saveLightingScheme,
  switchLightingContext,
  importLegacyLightingPreferences,
  saveLightingToProject,
  restoreLightingBackup,
}

function createRecordMigration(runtime) {
  const {
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
    Date,
    isPlainObject,
    makeIndependentDataSnapshot,
    normalizeFavorite,
    normalizeProject,
    normalizeRecord,
    readRawStorageValue,
    readValueResult,
    removeStorageValue,
    resetNormalizedState,
    state,
    storageValueCache,
    writeRawSnapshot,
    writeValue,
    invalidateNormalizedSources,
  } = runtime

  function getMigrationBackupEntries() {
    const result = readRawStorageValue(MIGRATION_BACKUPS_KEY)
    if (!result.ok) return null
    if (!result.present) return []
    return result.value?.version === 1 && Array.isArray(result.value.entries) ? result.value.entries : null
  }

  function completeStorageMigration(backupId) {
    const entries = getMigrationBackupEntries()
    if (!entries) {
      state.error = '迁移备份格式异常，已阻止项目数据写入。'
      return false
    }
    const backup = entries.find((item) => item.id === backupId && item.version === 1)
    if (!backup) {
      state.error = '找不到迁移前备份，已阻止项目数据写入。'
      return false
    }
    const next = makeIndependentDataSnapshot(backup)
    if (!next) {
      state.error = '现有项目数据格式需要人工检查；原始数据与备份均已保留。'
      return false
    }
    const writeSnapshot = Object.fromEntries(Object.entries(next).map(([key, value]) => [key, { present: true, value }]))
    if (!writeRawSnapshot(writeSnapshot)) {
      state.error = '项目数据迁移未完成；原始备份已保留，请重试。'
      return false
    }
    invalidateNormalizedSources()
    if (!removeStorageValue(MIGRATION_JOURNAL_KEY)) {
      state.error = '项目数据已迁移，但迁移状态未能清理；请重试读取。'
      return false
    }
    return true
  }

  function ensureStorageSchema() {
    state.error = ''
    const journalResult = readRawStorageValue(MIGRATION_JOURNAL_KEY)
    if (!journalResult.ok) {
      state.error = '读取项目数据迁移状态失败，请重试。'
      return false
    }
    if (journalResult.present) {
      if (journalResult.value?.version !== 1 || typeof journalResult.value.backupId !== 'string') {
        state.error = '项目数据迁移状态格式异常，已阻止写入。'
        return false
      }
      return completeStorageMigration(journalResult.value.backupId)
    }

    const schemaResult = readRawStorageValue(STORAGE_SCHEMA_KEY)
    if (!schemaResult.ok) {
      state.error = '读取项目数据版本失败，请重试。'
      return false
    }
    const storedSchemaVersion = schemaResult.present ? Number(schemaResult.value) : 1
    if (!Number.isSafeInteger(storedSchemaVersion) || storedSchemaVersion < 1) {
      state.error = '项目数据版本格式异常，已阻止写入。'
      return false
    }
    if (storedSchemaVersion > STORAGE_SCHEMA_VERSION) {
      state.error = `项目数据来自较新版本（${storedSchemaVersion}），当前版本仅允许只读访问。`
      return false
    }
    if (storedSchemaVersion === STORAGE_SCHEMA_VERSION) {
      const projects = readValueResult(PROJECTS_KEY, undefined)
      const records = readValueResult(RECORDS_KEY, undefined)
      const favorites = readValueResult(FAVORITES_KEY, undefined)
      const recovery = readValueResult(RECOVERY_KEY, undefined)
      const validUniqueIds = (items) => Array.isArray(items)
        && items.every((item) => typeof item?.id === 'string' && item.id)
        && new Set(items.map((item) => item.id)).size === items.length
      const projectRows = projects.ok ? projects.value : null
      const recordRows = records.ok ? records.value : null
      const favoriteRows = favorites.ok ? favorites.value : null
      const recoveryRows = recovery.ok ? (recovery.value === undefined ? [] : recovery.value) : null
      const validRecoveryKinds = new Set(['project', 'record', 'favorite', 'record-project-link', 'legacy-recent'])
      const healthy = validUniqueIds(projectRows)
        && projectRows.every((item) => normalizeProject(item))
        && validUniqueIds(recordRows)
        && recordRows.every((item) => normalizeRecord(item) && Array.isArray(item.projectIds)
          && item.projectIds.length > 0 && item.favorite !== true)
        && validUniqueIds(favoriteRows)
        && favoriteRows.every((item) => normalizeFavorite(item))
        && validUniqueIds(recoveryRows)
        && recoveryRows.every((entry) => isPlainObject(entry) && validRecoveryKinds.has(entry.kind)
          && isPlainObject(entry.snapshot) && typeof entry.snapshot.id === 'string' && entry.snapshot.id
          && typeof entry.targetId === 'string' && entry.targetId)
      if (!healthy) {
        state.error = '项目、计算记录或收藏数据格式异常；已阻止写入，原始数据仍保留。'
        return false
      }
      return true
    }

    const storageKeys = [STORAGE_SCHEMA_KEY, PROJECTS_KEY, RECORDS_KEY, FAVORITES_KEY, RECOVERY_KEY, ACTIVE_PROJECT_KEY]
    const captured = captureStorageSnapshot(storageKeys)
    if (!captured.ok) {
      state.error = '读取完整项目数据失败，已阻止迁移。'
      return false
    }
    const entries = getMigrationBackupEntries()
    if (!entries) {
      state.error = '迁移备份格式异常，已阻止项目数据写入。'
      return false
    }
    const sameBackup = entries.find((item) => item.migration === 'independent-favorites-v1'
      && item.schemaVersionBefore === storedSchemaVersion
      && JSON.stringify(item.storage) === JSON.stringify(captured.values))
    let backup = sameBackup
    if (!backup) {
      backup = {
        id: createId('storage-backup'),
        version: 1,
        migration: 'independent-favorites-v1',
        schemaVersionBefore: storedSchemaVersion,
        createdAt: Date.now(),
        storage: captured.values,
      }
      if (!writeValue(MIGRATION_BACKUPS_KEY, { version: 1, entries: [backup, ...entries] })) {
        state.error = '创建迁移前备份失败；项目数据未修改。'
        return false
      }
    }
    if (!writeValue(MIGRATION_JOURNAL_KEY, { version: 1, backupId: backup.id })) {
      state.error = '保存项目数据迁移状态失败；原始数据与备份均已保留。'
      return false
    }
    return completeStorageMigration(backup.id)
  }

  function getStorageMigrationBackups() {
    const entries = getMigrationBackupEntries()
    if (!entries) return { ok: false, error: '读取迁移备份失败或备份格式异常。', backups: [] }
    return {
      ok: true,
      error: '',
      backups: entries.map((entry) => ({
        id: entry.id,
        migration: entry.migration,
        schemaVersionBefore: entry.schemaVersionBefore,
        createdAt: entry.createdAt,
      })),
    }
  }

  function isValidRawMigrationSnapshot(snapshot) {
    const keys = [STORAGE_SCHEMA_KEY, PROJECTS_KEY, RECORDS_KEY, FAVORITES_KEY, RECOVERY_KEY, ACTIVE_PROJECT_KEY]
    return isPlainObject(snapshot) && keys.every((key) => (
      isPlainObject(snapshot[key])
        && typeof snapshot[key].present === 'boolean'
        && (!snapshot[key].present || cloneStorageValue(snapshot[key].value) !== null)
    )) && Object.keys(snapshot).every((key) => keys.includes(key))
  }

  function restoreStorageMigrationBackup(backupId) {
    const entries = getMigrationBackupEntries()
    const backup = entries?.find((entry) => entry.id === backupId && entry.version === 1)
    if (!backup || !isValidRawMigrationSnapshot(backup.storage)) return false
    const journalBefore = readRawStorageValue(MIGRATION_JOURNAL_KEY)
    if (!journalBefore.ok) return false
    const current = captureStorageSnapshot([...Object.keys(backup.storage), MIGRATION_JOURNAL_KEY])
    if (!current.ok) return false
    if (!writeRawSnapshot(backup.storage, { allowMigrationError: true })) return false
    if (!removeStorageValue(MIGRATION_JOURNAL_KEY)) {
      writeRawSnapshot(current.values, { allowMigrationError: true })
      return false
    }
    state.error = ''
    resetNormalizedState()
    ;[STORAGE_SCHEMA_KEY, RECORDS_KEY, PROJECTS_KEY, FAVORITES_KEY, RECOVERY_KEY, ACTIVE_PROJECT_KEY]
      .forEach((key) => storageValueCache.delete(key))
    return true
  }

  return { ensureStorageSchema, getStorageMigrationBackups, restoreStorageMigrationBackup }
}

module.exports = { createRecordMigration }

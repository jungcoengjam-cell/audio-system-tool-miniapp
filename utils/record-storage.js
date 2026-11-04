const WRITE_JOURNAL_KEY = 'audioTool.recordWriteJournal.v1'

function createRecordStorage({
  getWx,
  getMigrationError,
  storageSchemaKey = 'audioTool.storageSchemaVersion',
  storageSchemaVersion = 4,
  atomicStorageKeys = [
    'audioTool.records.v1',
    'audioTool.projects.v1',
    'audioTool.favorites.v1',
    'audioTool.recovery.v1',
  ],
  onRecoveryInvalidate = () => {},
}) {
  const storageValueCache = new Map()
  const storageReadFailures = new Set()
  const allowedAtomicKeys = new Set(atomicStorageKeys)
  let mutationDepth = 0
  let mutationReadFailed = false
  let transactionSequence = 0

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

  function markReadFailure(key) {
    storageReadFailures.add(key)
    if (mutationDepth > 0) mutationReadFailed = true
  }

  function invalidateRecoveryCaches(keys = atomicStorageKeys) {
    keys.forEach((key) => storageValueCache.delete(key))
    try { onRecoveryInvalidate(keys) } catch (error) {}
  }

  function readStorageValueDirect(key, fallback) {
    const result = readRawStorageValueDirect(key)
    return { ok: result.ok, value: result.ok && result.present ? result.value : fallback }
  }

  function readRawStorageValueDirect(key) {
    try {
      const value = getWx().getStorageSync(key)
      const present = value !== undefined && value !== null && value !== ''
      return { ok: true, present, value: present ? value : undefined }
    } catch (error) {
      return { ok: false, present: false, value: undefined }
    }
  }

  function writeStorageValueDirect(key, value) {
    try {
      getWx().setStorageSync(key, value)
      return true
    } catch (error) {
      return false
    }
  }

  function removeStorageValueDirect(key) {
    const wx = getWx()
    if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(key)
    else wx.setStorageSync(key, '')
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue)
    if (!value || typeof value !== 'object') return value
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key])
      return result
    }, Object.create(null))
  }

  function valuesEqual(left, right) {
    try { return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)) } catch (error) { return false }
  }

  function cloneJsonValue(value) {
    try {
      const serialized = JSON.stringify(value)
      return serialized === undefined ? { ok: false } : { ok: true, value: JSON.parse(serialized) }
    } catch (error) {
      return { ok: false }
    }
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && Object.prototype.toString.call(value) === '[object Object]')
  }

  function hasExactKeys(value, expected) {
    const keys = Object.keys(value).sort()
    return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  }

  function validateJournal(value) {
    if (!isPlainObject(value) || !hasExactKeys(value, ['version', 'schemaVersion', 'transactionId', 'entries'])
      || value.version !== 1 || value.schemaVersion !== storageSchemaVersion
      || typeof value.transactionId !== 'string'
      || !value.transactionId || value.transactionId.length > 100
      || !Array.isArray(value.entries) || !value.entries.length) return null
    const seen = new Set()
    const entries = []
    for (const entry of value.entries) {
      if (!isPlainObject(entry) || typeof entry.key !== 'string'
        || !allowedAtomicKeys.has(entry.key) || seen.has(entry.key)
        || typeof entry.present !== 'boolean') return null
      const expectedKeys = entry.present ? ['key', 'present', 'value'] : ['key', 'present']
      if (!hasExactKeys(entry, expectedKeys)) return null
      if (!entry.present) {
        entries.push({ key: entry.key, present: false })
        seen.add(entry.key)
        continue
      }
      if (!Array.isArray(entry.value)) return null
      const cloned = cloneJsonValue(entry.value)
      if (!cloned.ok) return null
      entries.push({ key: entry.key, present: true, value: cloned.value })
      seen.add(entry.key)
    }
    return { version: 1, schemaVersion: storageSchemaVersion, transactionId: value.transactionId, entries }
  }

  function journalsEqual(candidate, expected) {
    const validated = validateJournal(candidate)
    return Boolean(validated && validated.transactionId === expected.transactionId
      && valuesEqual(validated, expected))
  }

  function readJournalStatus(expected) {
    const result = readRawStorageValueDirect(WRITE_JOURNAL_KEY)
    if (!result.ok) return { status: 'unknown' }
    if (!result.present) return { status: 'absent' }
    if (expected && journalsEqual(result.value, expected)) return { status: 'same' }
    return { status: 'different' }
  }

  function readStorageSchema() {
    const result = readRawStorageValueDirect(storageSchemaKey)
    if (!result.ok) return { ok: false, version: null }
    const version = result.present ? Number(result.value) : 1
    return { ok: true, version: Number.isSafeInteger(version) ? version : null }
  }

  function removeJournalAndConfirm(journal) {
    // Delete commits; after a throw, only a matching raw journal permits rollback.
    try {
      removeStorageValueDirect(WRITE_JOURNAL_KEY)
      return 'absent'
    } catch (error) {
      const result = readJournalStatus(journal)
      return result.status
    }
  }

  function entryMatchesStorage(entry) {
    const result = readRawStorageValueDirect(entry.key)
    return result.ok && result.present === entry.present
      && (!entry.present || valuesEqual(result.value, entry.value))
  }

  function applySnapshotEntry(entry) {
    try {
      if (entry.present) getWx().setStorageSync(entry.key, entry.value)
      else removeStorageValueDirect(entry.key)
      return true
    } catch (error) {
      return entryMatchesStorage(entry)
    }
  }

  function restoreJournalEntries(journal) {
    invalidateRecoveryCaches(journal.entries.map((entry) => entry.key))
    let restored = true
    for (const entry of journal.entries) {
      if (!applySnapshotEntry(entry)) restored = false
    }
    return restored
  }

  function finishRecovery(journal) {
    if (!restoreJournalEntries(journal)) return false
    const cleared = removeJournalAndConfirm(journal)
    if (cleared === 'absent') return true
    invalidateRecoveryCaches(journal.entries.map((entry) => entry.key))
    return false
  }

  function ensureWriteRecovery() {
    // Raw helpers bypass the gate to avoid recursion during recovery.
    const storedJournal = readRawStorageValueDirect(WRITE_JOURNAL_KEY)
    if (!storedJournal.ok) {
      invalidateRecoveryCaches()
      return false
    }
    if (!storedJournal.present) return true

    invalidateRecoveryCaches()
    const schema = readStorageSchema()
    if (!schema.ok || schema.version !== storageSchemaVersion) return false
    const journal = validateJournal(storedJournal.value)
    if (!journal) return false
    return finishRecovery(journal)
  }

  function readStorageValue(key, fallback) {
    if (!ensureWriteRecovery()) {
      markReadFailure(key)
      return { ok: false, value: fallback }
    }
    const result = readStorageValueDirect(key, fallback)
    if (!result.ok) markReadFailure(key)
    return result
  }

  function readValueResult(key, fallback) {
    if (!ensureWriteRecovery()) {
      markReadFailure(key)
      return { ok: false, value: fallback }
    }
    if (storageValueCache.has(key)) return { ok: true, value: storageValueCache.get(key) }
    const result = readStorageValueDirect(key, fallback)
    if (result.ok) storageValueCache.set(key, result.value)
    else markReadFailure(key)
    return result
  }

  function readValue(key, fallback) {
    return readValueResult(key, fallback).value
  }

  function writeValue(key, value, allowMigrationError = false) {
    if (!ensureWriteRecovery() || mutationReadFailed || (getMigrationError() && !allowMigrationError)) return false
    if (!writeStorageValueDirect(key, value)) return false
    storageValueCache.set(key, value)
    return true
  }

  function createTransactionId() {
    transactionSequence += 1
    return `${Date.now().toString(36)}-${transactionSequence.toString(36)}`
  }

  function captureJournalEntries(writes) {
    const seen = new Set()
    const entries = []
    for (const write of writes) {
      if (!write || typeof write.key !== 'string' || !allowedAtomicKeys.has(write.key) || seen.has(write.key)) {
        return { ok: false, entries: [] }
      }
      const stored = readRawStorageValueDirect(write.key)
      if (!stored.ok) {
        markReadFailure(write.key)
        return { ok: false, entries: [] }
      }
      if (stored.present) {
        if (!Array.isArray(stored.value)) return { ok: false, entries: [] }
        const cloned = cloneJsonValue(stored.value)
        if (!cloned.ok) return { ok: false, entries: [] }
        entries.push({ key: write.key, present: true, value: cloned.value })
      } else {
        entries.push({ key: write.key, present: false })
      }
      seen.add(write.key)
    }
    return { ok: true, entries }
  }

  function invalidateTransaction(journal) {
    invalidateRecoveryCaches(journal.entries.map((entry) => entry.key))
  }

  function rollbackTransaction(journal) {
    const identity = readJournalStatus(journal)
    if (identity.status !== 'same') {
      invalidateTransaction(journal)
      return false
    }
    const restored = restoreJournalEntries(journal)
    if (!restored) return false
    const cleared = removeJournalAndConfirm(journal)
    if (cleared === 'absent') return true
    invalidateTransaction(journal)
    return false
  }

  function writeValuesAtomically(writes) {
    if (mutationReadFailed || getMigrationError() || !ensureWriteRecovery()) return false
    if (!Array.isArray(writes) || writes.length === 0) return Array.isArray(writes)
    const schema = readStorageSchema()
    if (!schema.ok || schema.version !== storageSchemaVersion) {
      if (!schema.ok) storageReadFailures.add(storageSchemaKey)
      return false
    }
    const before = captureJournalEntries(writes)
    if (!before.ok) return false
    const journal = {
      version: 1,
      schemaVersion: storageSchemaVersion,
      transactionId: createTransactionId(),
      entries: before.entries,
    }
    if (!writeStorageValueDirect(WRITE_JOURNAL_KEY, journal)) {
      invalidateTransaction(journal)
      const status = readJournalStatus(journal)
      if (status.status === 'same') {
        const cleared = removeJournalAndConfirm(journal)
        if (cleared !== 'absent') invalidateTransaction(journal)
      } else if (status.status !== 'absent') {
        invalidateTransaction(journal)
      }
      return false
    }

    for (const write of writes) {
      if (writeStorageValueDirect(write.key, write.value)) continue
      rollbackTransaction(journal)
      return false
    }

    try {
      removeStorageValueDirect(WRITE_JOURNAL_KEY)
    } catch (error) {
      const status = readJournalStatus(journal)
      if (status.status === 'absent') {
        writes.forEach((write) => storageValueCache.set(write.key, write.value))
        return true
      }
      if (status.status === 'same') rollbackTransaction(journal)
      else invalidateTransaction(journal)
      return false
    }

    writes.forEach((write) => storageValueCache.set(write.key, write.value))
    return true
  }

  function readRawStorageValue(key) {
    if (!ensureWriteRecovery()) {
      markReadFailure(key)
      return { ok: false, present: false, value: undefined }
    }
    const result = readRawStorageValueDirect(key)
    if (!result.ok) markReadFailure(key)
    return result
  }

  function removeStorageValue(key) {
    if (!ensureWriteRecovery()) return false
    try {
      removeStorageValueDirect(key)
      storageValueCache.delete(key)
      return true
    } catch (error) {
      return false
    }
  }

  return {
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
  }
}

module.exports = { createRecordStorage }

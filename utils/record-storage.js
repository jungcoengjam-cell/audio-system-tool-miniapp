function createRecordStorage({ getWx, getMigrationError }) {
  const storageValueCache = new Map()
  const storageReadFailures = new Set()
  let mutationDepth = 0
  let mutationReadFailed = false

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
      const wx = getWx()
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

  function writeValue(key, value, allowMigrationError = false) {
    if (mutationReadFailed || (getMigrationError() && !allowMigrationError)) return false
    try {
      const wx = getWx()
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

  function readRawStorageValue(key) {
    try {
      const wx = getWx()
      const value = wx.getStorageSync(key)
      const present = value !== undefined && value !== null && value !== ''
      return { ok: true, present, value: present ? value : undefined }
    } catch (error) {
      storageReadFailures.add(key)
      if (mutationDepth > 0) mutationReadFailed = true
      return { ok: false, present: false, value: undefined }
    }
  }

  function removeStorageValue(key) {
    try {
      const wx = getWx()
      if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(key)
      else wx.setStorageSync(key, '')
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

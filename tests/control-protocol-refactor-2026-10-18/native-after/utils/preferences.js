const preferenceSignatures = Object.create(null)

function serializePreference(value) {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return ''
  }
}

function readPreferences(key) {
  try {
    const value = wx.getStorageSync(key)
    const preferences = value && typeof value === 'object' ? value : {}
    preferenceSignatures[key] = serializePreference(preferences)
    return preferences
  } catch (error) {
    return {}
  }
}

function writePreferencesDetailed(key, value) {
  const signature = serializePreference(value)
  if (signature && preferenceSignatures[key] === signature) return { ok: true, changed: false }
  try {
    wx.setStorageSync(key, value)
    preferenceSignatures[key] = signature
    return { ok: true, changed: true }
  } catch (error) {
    // 本地存储不可用时不影响计算功能。
    return { ok: false, changed: false }
  }
}

function writePreferences(key, value) {
  const result = writePreferencesDetailed(key, value)
  return result.ok && result.changed
}

function removePreferences(key) {
  try {
    wx.removeStorageSync(key)
    delete preferenceSignatures[key]
    return true
  } catch (error) {
    return false
  }
}

function findValueIndex(items, value, getter = (item) => item) {
  const index = items.findIndex((item) => getter(item) === value)
  return index >= 0 ? index : 0
}

module.exports = {
  findValueIndex,
  readPreferences,
  removePreferences,
  writePreferencesDetailed,
  writePreferences,
}

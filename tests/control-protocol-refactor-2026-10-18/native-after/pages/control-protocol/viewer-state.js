const { readPreferences, writePreferencesDetailed } = require('../../utils/preferences')
const { searchGallery, getReferenceManualDetail, resolveAppearanceGroupProtocol } = require('./model')

const STORAGE_KEY = 'controlProtocolViewerState.v1'
const MAX_DEVICES = 32
const MAX_SCROLL_TOP = 200000
const DEVICE_TYPES = new Set(['appearance', 'reference'])

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeDeviceRef(value, catalog) {
  if (!isPlainObject(value) || !DEVICE_TYPES.has(value.type) || typeof value.id !== 'string') return null
  const id = value.id.trim()
  if (!id || id.length > 128) return null
  if (value.type === 'reference') {
    return getReferenceManualDetail(catalog, id) ? { type: 'reference', id } : null
  }
  const exists = searchGallery(catalog).some((item) => item.groupId === id)
  return exists ? { type: 'appearance', id } : null
}

function supportedModes(deviceRef, catalog) {
  if (!deviceRef) return []
  if (deviceRef.type === 'reference') {
    const reference = getReferenceManualDetail(catalog, deviceRef.id)
    return reference && reference.manual && Array.isArray(reference.manual.transports)
      ? reference.manual.transports.map((transport) => transport && transport.id).filter((id) => typeof id === 'string' && id)
      : []
  }
  const resolution = resolveAppearanceGroupProtocol(catalog, deviceRef.id)
  const manual = catalog.developmentDraftOnly === true && resolution.group
    ? resolution.group.developmentManual
    : null
  if (manual && Array.isArray(manual.transports)) {
    return manual.transports.map((transport) => transport && transport.id).filter((id) => typeof id === 'string' && id)
  }
  return resolution.allowed ? ['protocol'] : []
}

function loopCountForMode(deviceRef, modeId, catalog) {
  if (!deviceRef || modeId === 'protocol') return 0
  let manual = null
  if (deviceRef.type === 'reference') {
    const reference = getReferenceManualDetail(catalog, deviceRef.id)
    manual = reference && reference.manual
  } else {
    const resolution = resolveAppearanceGroupProtocol(catalog, deviceRef.id)
    manual = catalog.developmentDraftOnly === true && resolution.group
      ? resolution.group.developmentManual
      : null
  }
  return manual ? Number(manual.loopCount) || 40 : 40
}

function sanitizeReading(value, deviceRef, modeId, catalog) {
  const source = isPlainObject(value) ? value : {}
  const scrollTop = typeof source.scrollTop === 'number' && Number.isFinite(source.scrollTop)
    ? Math.max(0, Math.min(MAX_SCROLL_TOP, source.scrollTop))
    : 0
  const loopCount = loopCountForMode(deviceRef, modeId, catalog)
  const loopIndex = Number.isInteger(source.loopIndex) && loopCount > 0
    ? Math.max(0, Math.min(loopCount - 1, source.loopIndex))
    : 0
  return {
    scrollTop,
    loopIndex,
    showManualWrites: source.showManualWrites === true,
  }
}

function sanitizeViewerState(value, catalog) {
  const source = isPlainObject(value) ? value : {}
  const deviceRef = normalizeDeviceRef(source.deviceRef, catalog)
  const devices = []
  const seen = new Set()
  const sourceDevices = Array.isArray(source.devices) ? source.devices.slice(0, MAX_DEVICES) : []

  sourceDevices.forEach((entry) => {
    if (!isPlainObject(entry)) return
    const ref = normalizeDeviceRef(entry.deviceRef, catalog)
    if (!ref) return
    const key = `${ref.type}:${ref.id}`
    if (seen.has(key)) return
    seen.add(key)
    const modes = supportedModes(ref, catalog)
    const rawTransports = isPlainObject(entry.transports) ? entry.transports : {}
    const transports = {}
    modes.forEach((modeId) => {
      if (Object.prototype.hasOwnProperty.call(rawTransports, modeId)) {
        transports[modeId] = sanitizeReading(rawTransports[modeId], ref, modeId, catalog)
      }
    })
    const lastMode = modes.includes(entry.lastMode) ? entry.lastMode : ''
    devices.push({ deviceRef: ref, lastMode, transports })
  })

  return { deviceRef, devices }
}

function readViewerState(catalog) {
  return sanitizeViewerState(readPreferences(STORAGE_KEY), catalog)
}

function saveViewerState(value, catalog) {
  const safeState = sanitizeViewerState(value, catalog)
  return writePreferencesDetailed(STORAGE_KEY, safeState)
}

function findDeviceState(state, deviceRef) {
  if (!state || !deviceRef || !Array.isArray(state.devices)) return null
  return state.devices.find((entry) => entry.deviceRef.type === deviceRef.type && entry.deviceRef.id === deviceRef.id) || null
}

function getLastMode(state, deviceRef, catalog) {
  const modes = supportedModes(normalizeDeviceRef(deviceRef, catalog), catalog)
  const deviceState = findDeviceState(state, deviceRef)
  return deviceState && modes.includes(deviceState.lastMode) ? deviceState.lastMode : ''
}

function getReading(state, deviceRef, modeId, catalog) {
  const deviceState = findDeviceState(state, deviceRef)
  const modes = supportedModes(normalizeDeviceRef(deviceRef, catalog), catalog)
  if (!modes.includes(modeId)) return sanitizeReading({}, deviceRef, modeId, catalog)
  return sanitizeReading(deviceState && deviceState.transports && deviceState.transports[modeId], deviceRef, modeId, catalog)
}

function updateDevice(state, deviceRef, modeId, reading, catalog) {
  const safeRef = normalizeDeviceRef(deviceRef, catalog)
  if (!safeRef) return sanitizeViewerState(state, catalog)
  const modes = supportedModes(safeRef, catalog)
  const supportedMode = modes.includes(modeId) ? modeId : (modes[0] || '')
  const current = sanitizeViewerState(state, catalog)
  const key = `${safeRef.type}:${safeRef.id}`
  const deviceMap = new Map(current.devices.map((entry) => [`${entry.deviceRef.type}:${entry.deviceRef.id}`, entry]))
  const previous = deviceMap.get(key) || { deviceRef: safeRef, lastMode: supportedMode, transports: {} }
  const transports = { ...previous.transports }
  if (supportedMode && reading) transports[supportedMode] = sanitizeReading(reading, safeRef, supportedMode, catalog)
  deviceMap.set(key, {
    deviceRef: safeRef,
    lastMode: supportedMode,
    transports,
  })
  return sanitizeViewerState({
    deviceRef: safeRef,
    devices: Array.from(deviceMap.values()).slice(-MAX_DEVICES),
  }, catalog)
}

module.exports = {
  STORAGE_KEY,
  getLastMode,
  getReading,
  normalizeDeviceRef,
  readViewerState,
  sanitizeViewerState,
  saveViewerState,
  supportedModes,
  updateDevice,
}

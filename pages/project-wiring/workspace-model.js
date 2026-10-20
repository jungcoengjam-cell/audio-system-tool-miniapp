const { CONNECTOR_OPTIONS, DEVICE_OPTIONS, MAX_BATCH, normalizeSchedule } = require('../../utils/project-wiring')
const { isPerformanceMeasurementEnabled, startMeasurement } = require('../../utils/performance')

const connectorLabels = new Map(CONNECTOR_OPTIONS.map(({ id, label }) => [id, label]))
const deviceLabels = new Map(DEVICE_OPTIONS.map(({ id, label }) => [id, label]))

function circleLabel(line, schedule) {
  if (schedule && Array.isArray(schedule.lines)) {
    const index = line && line.id ? schedule.lines.findIndex((item) => item.id === line.id) : -1
    if (index >= 0) return String(index + 1)
    if (!line || !line.id) return String(schedule.lines.length + 1)
  }
  const displayNumber = line && Number(line.displayNumber)
  if (Number.isSafeInteger(displayNumber) && displayNumber > 0) return String(displayNumber)
  const code = String(line && line.code || '').trim()
  const match = code.match(/^A(\d+)$/i)
  return match ? match[1].replace(/^0+(?=\d)/, '') : (code || '—')
}

function projectDeviceNames(sourceDevices) {
  const projected = new Map()
  const byType = new Map()
  sourceDevices.forEach((device) => {
    if (!byType.has(device.type)) byType.set(device.type, [])
    byType.get(device.type).push(device)
  })

  byType.forEach((devices, type) => {
    const typeLabel = deviceLabels.get(type) || '\u81ea\u5b9a\u4e49'
    const legacy = devices.filter((device) => !Object.prototype.hasOwnProperty.call(device, 'autoName'))
    const legacyNumbered = legacy.map((device) => {
      const suffix = device.name.startsWith(typeLabel) ? device.name.slice(typeLabel.length) : ''
      return /^[1-9]\d*$/.test(suffix) ? Number(suffix) : null
    })
    const canInferLegacy = type !== 'custom'
    const completeLegacySequence = canInferLegacy && legacy.length > 1
      && legacyNumbered.every((number) => Number.isSafeInteger(number) && number >= 1 && number <= legacy.length)
      && new Set(legacyNumbered).size === legacy.length
    const singletonLegacyAuto = canInferLegacy && legacy.length === 1
      && (legacy[0].name === typeLabel || legacyNumbered[0] === 1)
    const inferredLegacyIds = new Set(completeLegacySequence || singletonLegacyAuto
      ? legacy.map((device) => device.id)
      : [])
    const automatic = devices.filter((device) => device.autoName === true || inferredLegacyIds.has(device.id))
    automatic.forEach((device, index) => {
      projected.set(device.id, {
        name: automatic.length === 1 ? typeLabel : `${typeLabel}${index + 1}`,
        ...(device.autoName === true ? {} : { nameProvenanceAmbiguous: true }),
      })
    })

    legacy.forEach((device, index) => {
      if (inferredLegacyIds.has(device.id)) return
      const inferred = device.name === typeLabel || legacyNumbered[index] === 1
      projected.set(device.id, {
        name: device.name,
        ...(inferred ? { nameProvenanceAmbiguous: true } : {}),
      })
    })

    devices.filter((device) => device.autoName === false).forEach((device) => {
      projected.set(device.id, { name: device.name, nameProvenanceAmbiguous: false })
    })
  })
  return projected
}

function endpointKey(line, side) {
  const id = line[`${side}DeviceId`]
  return id ? `device:${id}` : `legacy:${JSON.stringify(line[`${side}Device`] || '')}`
}

function buildWorkspace(value) {
  const profilingEnabled = isPerformanceMeasurementEnabled()
  const finishTotal = profilingEnabled ? startMeasurement('D1.workspace.build-total') : null
  const finishNormalize = profilingEnabled ? startMeasurement('D1.workspace.normalize') : null
  const schedule = normalizeSchedule(value)
  if (finishNormalize) finishNormalize({ lineCount: schedule.lines.length, deviceCount: schedule.devices.length })
  const finishModel = profilingEnabled ? startMeasurement('D1.workspace.model-build') : null
  const nameProjection = projectDeviceNames(schedule.devices || [])
  const devices = (schedule.devices || []).map((device) => ({
    ...device,
    ...nameProjection.get(device.id),
    legacy: false,
    key: `device:${device.id}`,
    typeLabel: deviceLabels.get(device.type) || '自定义',
    lineCount: 0,
    sourceLineCount: 0,
  }))
  const deviceMap = new Map(devices.map((device) => [device.key, device]))
  schedule.lines.forEach((line) => {
    for (const side of ['from', 'to']) {
      const key = endpointKey(line, side)
      if (!deviceMap.has(key)) {
        const device = {
          id: key,
          key,
          name: line[`${side}Device`] || '待补',
          type: 'custom',
          typeLabel: '自定义',
          legacy: !line[`${side}DeviceId`],
          lineCount: 0,
          sourceLineCount: 0,
        }
        devices.push(device)
        deviceMap.set(key, device)
      }
    }
  })
  const groups = []
  const groupMap = new Map()
  const lines = schedule.lines.map((line, index) => {
    const fromKey = endpointKey(line, 'from')
    const toKey = endpointKey(line, 'to')
    const from = deviceMap.get(fromKey)
    const to = deviceMap.get(toKey)
    from.sourceLineCount += 1
    new Set([fromKey, toKey]).forEach((key) => { deviceMap.get(key).lineCount += 1 })
    const item = {
      ...line,
      displayNumber: index + 1,
      circleLabel: String(index + 1),
      fromDeviceName: from.name,
      toDeviceName: to.name,
      connectorALabel: connectorLabels.get(line.connectorA) || line.connectorA || '待补',
      connectorBLabel: connectorLabels.get(line.connectorB) || line.connectorB || '待补',
      specLabel: line.spec || '待补',
      lengthLabel: line.lengthText ? `${line.lengthText} m` : '待补',
    }
    const key = JSON.stringify([fromKey, toKey])
    if (!groupMap.has(key)) {
      const group = {
        key, id: key,
        fromDevice: from.name,
        toDevice: to.name,
        fromDeviceId: from.id,
        toDeviceId: to.id,
        lines: [],
        lineCount: 0,
      }
      groups.push(group)
      groupMap.set(key, group)
    }
    const group = groupMap.get(key)
    group.lines.push(item)
    group.lineCount += 1
    return item
  })
  const nameCounts = new Map()
  devices.forEach(({ name }) => nameCounts.set(name, (nameCounts.get(name) || 0) + 1))
  devices.forEach((device, index) => {
    device.choiceLabel = nameCounts.get(device.name) > 1 ? `${device.name} · ${index + 1}` : device.name
  })
  const result = { devices, groups, lines, lineCount: lines.length }
  if (finishModel) finishModel({ lineCount: lines.length, deviceCount: devices.length, groupCount: groups.length })
  if (finishTotal) finishTotal({ lineCount: lines.length, deviceCount: devices.length, groupCount: groups.length })
  return result
}

function parseCount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null
  const count = Number(text)
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_BATCH ? count : null
}

function sequentialValues(first, count, maxLength, label, allowSinglePlain) {
  if (typeof first !== 'string' || !first.trim()) return { ok: false, error: `请填写${label}` }
  const text = first.trim()
  if (text.length > maxLength) return { ok: false, error: `${label}过长` }
  const match = text.match(/^(.*?)(\d+)$/)
  if (count === 1 && (allowSinglePlain || match)) return { ok: true, values: [text] }
  if (!match) {
    if (allowSinglePlain && count === 1) return { ok: true, values: [text] }
    if (allowSinglePlain) return { ok: false, error: `${label}需以数字结尾，才能连续递增` }
    const values = Array.from({ length: count }, (_, index) => `${text}${index + 1}`)
    if (values.some((item) => item.length > maxLength)) return { ok: false, error: `${label}过长` }
    return { ok: true, values }
  }
  const start = Number(match[2])
  if (!Number.isSafeInteger(start) || start > Number.MAX_SAFE_INTEGER - count + 1) {
    return { ok: false, error: `${label}编号超出可连续递增的范围` }
  }
  const values = Array.from({ length: count }, (_, index) => `${match[1]}${String(start + index).padStart(match[2].length, '0')}`)
  return values.some((item) => item.length > maxLength)
    ? { ok: false, error: `${label}过长` }
    : { ok: true, values }
}

function generatePortPairs(firstFrom, firstTo, countValue) {
  const count = parseCount(countValue)
  if (!count) return { ok: false, pairs: [], error: `数量需为 1 到 ${MAX_BATCH} 的整数` }
  const from = sequentialValues(firstFrom, count, 80, '来源起始端口', true)
  if (!from.ok) return { ok: false, pairs: [], error: from.error }
  const to = sequentialValues(firstTo, count, 80, '去向起始端口', true)
  if (!to.ok) return { ok: false, pairs: [], error: to.error }
  return { ok: true, pairs: from.values.map((fromPort, index) => ({ fromPort, toPort: to.values[index] })), error: '' }
}

function deviceNames(base, countValue) {
  const count = parseCount(countValue)
  if (!count) return { ok: false, names: [], error: `数量需为 1 到 ${MAX_BATCH} 的整数` }
  const result = sequentialValues(base, count, 100, '设备名称', false)
  return result.ok ? { ok: true, names: result.values, error: '' } : { ok: false, names: [], error: result.error }
}

module.exports = { buildWorkspace, circleLabel, generatePortPairs, deviceNames }

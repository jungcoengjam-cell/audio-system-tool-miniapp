const { CONNECTOR_OPTIONS, DEVICE_OPTIONS, MAX_BATCH, normalizeSchedule } = require('../../utils/project-wiring')

const connectorLabels = new Map(CONNECTOR_OPTIONS.map(({ id, label }) => [id, label]))
const deviceLabels = new Map(DEVICE_OPTIONS.map(({ id, label }) => [id, label]))

function circleLabel(line) {
  const code = String(line && line.code || '').trim()
  const match = code.match(/^A(\d+)$/i)
  return match ? match[1].replace(/^0+(?=\d)/, '') : (code || '—')
}

function endpointKey(line, side) {
  const id = line[`${side}DeviceId`]
  return id ? `device:${id}` : `legacy:${JSON.stringify(line[`${side}Device`] || '')}`
}

function buildWorkspace(value) {
  const schedule = normalizeSchedule(value)
  const devices = (schedule.devices || []).map((device) => ({
    ...device,
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
  const lines = schedule.lines.map((line) => {
    const fromKey = endpointKey(line, 'from')
    const toKey = endpointKey(line, 'to')
    const from = deviceMap.get(fromKey)
    const to = deviceMap.get(toKey)
    from.sourceLineCount += 1
    new Set([fromKey, toKey]).forEach((key) => { deviceMap.get(key).lineCount += 1 })
    const item = {
      ...line,
      circleLabel: circleLabel(line),
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
  return { devices, groups, lines, lineCount: lines.length }
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

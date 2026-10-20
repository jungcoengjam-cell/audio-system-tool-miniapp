const STATUS_OPTIONS = [
  { id: 'pending', label: '待施工' },
  { id: 'connected', label: '已连接' },
  { id: 'checked', label: '已核对' },
]

const BUILD_OPTIONS = [
  { id: 'finished', label: '成品线' },
  { id: 'bulk', label: '散线制作' },
]

const CABLE_OPTIONS = [
  { id: 'balanced', label: '平衡音频线' },
  { id: 'unbalanced', label: '非平衡音频线' },
  { id: 'speaker', label: '扬声器线' },
  { id: 'custom', label: '自定义线材' },
]

const CONNECTOR_OPTIONS = [
  { id: 'xlrFemale', label: 'XLR 母头' },
  { id: 'xlrMale', label: 'XLR 公头' },
  { id: 'trs635', label: '6.35 mm TRS' },
  { id: 'ts635', label: '6.35 mm TS' },
  { id: 'trs35', label: '3.5 mm TRS' },
  { id: 'rcaMale', label: 'RCA 公头' },
  { id: 'rcaFemale', label: 'RCA 母头' },
  { id: 'speakon2', label: 'Speakon NL2' },
  { id: 'speakon4', label: 'Speakon NL4' },
  { id: 'terminal', label: '接线端子' },
  { id: 'bareWire', label: '裸线 / 压接端' },
  { id: 'custom', label: '自定义接头' },
]

const DEVICE_OPTIONS = [
  { id: 'receiver', label: '接收机' },
  { id: 'mixer', label: '调音台' },
  { id: 'processor', label: '处理器' },
  { id: 'amplifier', label: '功放' },
  { id: 'speaker', label: '音箱' },
  { id: 'custom', label: '自定义' },
]

const STATUS_IDS = new Set(STATUS_OPTIONS.map((option) => option.id))
const BUILD_IDS = new Set(BUILD_OPTIONS.map((option) => option.id))
const DEVICE_IDS = new Set(DEVICE_OPTIONS.map((option) => option.id))
const DEVICE_REFERENCE_FIELDS = ['fromDeviceId', 'toDeviceId']
const CABLE_LABELS = Object.fromEntries(CABLE_OPTIONS.map(({ id, label }) => [id, label]))
const CONNECTOR_LABELS = Object.fromEntries(CONNECTOR_OPTIONS.map(({ id, label }) => [id, label]))
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map(({ id, label }) => [id, label]))
const BUILD_LABELS = Object.fromEntries(BUILD_OPTIONS.map(({ id, label }) => [id, label]))
const MAX_LINES = 200
const MAX_BATCH = 32
const MAX_LENGTH_METERS = 1000000
const MAX_LENGTH_TEXT = 24
let lineIdCounter = 0
let deviceIdCounter = 0

function emptySchedule() {
  return { version: 1, revision: 0, nextNumber: 1, lines: [] }
}

function asText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function validLengthText(value) {
  if (value === '') return true
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) return false
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && number <= MAX_LENGTH_METERS
}

function canonicalLengthText(value) {
  if (!value || !validLengthText(value)) return value
  const [integerPart = '', decimalPart = ''] = value.split('.')
  const integer = (integerPart || '0').replace(/^0+(?=\d)/, '')
  const decimal = decimalPart.replace(/0+$/, '')
  return decimal ? `${integer}.${decimal}` : integer
}

function parseIntegerInput(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const number = Number(value.trim())
  return Number.isSafeInteger(number) ? number : null
}

function normalizeSchedule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return emptySchedule()
  const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0
  const nextNumber = Number.isSafeInteger(value.nextNumber) && value.nextNumber > 0 ? value.nextNumber : 1
  const lines = Array.isArray(value.lines) ? value.lines.map((line) => normalizeLine(line)).filter(Boolean) : []
  const schedule = { version: 1, revision, nextNumber, lines }
  if (Object.prototype.hasOwnProperty.call(value, 'devices')) {
    schedule.devices = Array.isArray(value.devices) ? value.devices.map((device) => {
      const normalized = {
        id: asText(device && device.id, 100),
        type: asText(device && device.type, 20),
        name: asText(device && device.name, 100),
      }
      if (device && typeof device.autoName === 'boolean') normalized.autoName = device.autoName
      return normalized
    }) : []
  }
  return schedule
}

function validateLineDeviceReferences(line, deviceIds) {
  for (const field of DEVICE_REFERENCE_FIELDS) {
    if (line[field] === undefined) continue
    if (typeof line[field] !== 'string' || !line[field].trim() || line[field].length > 100
      || !deviceIds.has(line[field].trim())) return '线路引用的设备不存在，请重新选择设备'
  }
  return ''
}

function validateDistinctDeviceReferences(line) {
  const fromId = line && typeof line.fromDeviceId === 'string' ? line.fromDeviceId.trim() : ''
  const toId = line && typeof line.toDeviceId === 'string' ? line.toDeviceId.trim() : ''
  return fromId && toId && fromId === toId
    ? '\u6765\u6e90\u8bbe\u5907\u548c\u53bb\u5411\u8bbe\u5907\u4e0d\u80fd\u76f8\u540c\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9'
    : ''
}

function validateDeviceData(schedule) {
  if (!schedule || typeof schedule !== 'object') return ''
  const devices = Object.prototype.hasOwnProperty.call(schedule, 'devices') ? schedule.devices : []
  if (!Array.isArray(devices)) return '项目设备资料格式异常'
  const ids = new Set()
  for (const device of devices) {
    if (!device || typeof device !== 'object' || Array.isArray(device)
      || ![3, 4].includes(Object.keys(device).length)
      || Object.keys(device).some((key) => !['id', 'type', 'name', 'autoName'].includes(key))
      || typeof device.id !== 'string' || !device.id || device.id.length > 100 || device.id !== device.id.trim()
      || typeof device.name !== 'string' || !device.name || device.name.length > 100 || device.name !== device.name.trim()
      || !DEVICE_IDS.has(device.type) || ids.has(device.id)) return '项目设备资料格式异常'
    if (Object.prototype.hasOwnProperty.call(device, 'autoName') && typeof device.autoName !== 'boolean') {
      return '设备名称来源标记格式异常'
    }
    ids.add(device.id)
  }
  for (const line of Array.isArray(schedule.lines) ? schedule.lines : []) {
    if (!line || typeof line !== 'object') continue
    const error = validateLineDeviceReferences(line, ids)
    if (error) return error
  }
  return ''
}

function normalizeLine(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const rawLengthText = input.lengthText === undefined ? ''
    : (typeof input.lengthText === 'string' ? input.lengthText.trim() : null)
  if (rawLengthText === null || rawLengthText.length > MAX_LENGTH_TEXT || !validLengthText(rawLengthText)) return null
  const line = {
    id: asText(input.id, 100),
    code: asText(input.code, 32),
    purpose: asText(input.purpose, 100),
    fromDevice: asText(input.fromDevice, 100),
    fromPort: asText(input.fromPort, 80),
    toDevice: asText(input.toDevice, 100),
    toPort: asText(input.toPort, 80),
    buildType: BUILD_IDS.has(input.buildType) ? input.buildType : 'finished',
    cableType: ['balanced', 'unbalanced', 'speaker', 'custom'].includes(input.cableType) ? input.cableType : 'balanced',
    spec: asText(input.spec, 120),
    connectorA: asText(input.connectorA, 60),
    connectorB: asText(input.connectorB, 60),
    lengthText: canonicalLengthText(rawLengthText),
    status: STATUS_IDS.has(input.status) ? input.status : 'pending',
    notes: asText(input.notes, 300),
  }
  DEVICE_REFERENCE_FIELDS.forEach((field) => {
    if (input[field] !== undefined) line[field] = asText(input[field], 100)
  })
  if (!line.id || !line.code || !line.fromDevice || !line.fromPort || !line.toDevice || !line.toPort) return null
  if (!validLengthText(line.lengthText)) return null
  return line
}

function makeLineId(lines) {
  const used = new Set(lines.map((line) => line.id))
  let id
  do {
    lineIdCounter += 1
    id = `wire-${Date.now().toString(36)}-${lineIdCounter.toString(36)}`
  } while (used.has(id))
  return id
}

function makeDeviceId(devices) {
  const used = new Set(devices.map((device) => device.id))
  let id
  do {
    deviceIdCounter += 1
    id = `device-${Date.now().toString(36)}-${deviceIdCounter.toString(36)}`
  } while (used.has(id))
  return id
}

function allocateCode(schedule, lines) {
  let number = schedule.nextNumber
  const used = new Set(lines.map((line) => line.code.trim().toLowerCase()))
  let code = ''
  while (number <= Number.MAX_SAFE_INTEGER) {
    code = `A${String(number).padStart(3, '0')}`
    number += 1
    if (!used.has(code.toLowerCase())) return { code, nextNumber: number }
  }
  return null
}

function baseScheduleResult(schedule, ok, error, lineIds) {
  const result = { ok, schedule }
  if (lineIds) result.lineIds = lineIds
  if (error) result.error = error
  return result
}

function failSchedule(schedule, error) {
  return baseScheduleResult(normalizeSchedule(schedule), false, error)
}

function copyScheduleForDeletion(scheduleValue) {
  if (!scheduleValue || typeof scheduleValue !== 'object' || Array.isArray(scheduleValue)) {
    return normalizeSchedule(scheduleValue)
  }
  const copy = { ...scheduleValue }
  if (Array.isArray(scheduleValue.devices)) {
    copy.devices = scheduleValue.devices.map((device) => (
      device && typeof device === 'object' && !Array.isArray(device) ? { ...device } : device
    ))
  }
  if (Array.isArray(scheduleValue.lines)) {
    copy.lines = scheduleValue.lines.map((line) => (
      line && typeof line === 'object' && !Array.isArray(line) ? { ...line } : line
    ))
  }
  return copy
}

function failDeletion(scheduleValue, error) {
  return { ok: false, schedule: copyScheduleForDeletion(scheduleValue), error }
}

function validStableId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && value === value.trim()
}

function validDeletionSchedule(scheduleValue) {
  if (!scheduleValue || typeof scheduleValue !== 'object' || Array.isArray(scheduleValue)
    || scheduleValue.version !== 1 || !Number.isSafeInteger(scheduleValue.revision) || scheduleValue.revision < 0
    || !Number.isSafeInteger(scheduleValue.nextNumber) || scheduleValue.nextNumber < 1
    || !Array.isArray(scheduleValue.lines) || scheduleValue.lines.length > MAX_LINES) {
    return '项目布线数据格式异常，请刷新后重试'
  }
  const deviceDataError = validateDeviceData(scheduleValue)
  if (deviceDataError) return deviceDataError
  const deviceIds = new Set((Array.isArray(scheduleValue.devices) ? scheduleValue.devices : [])
    .map((device) => device.id))
  const lineIds = new Set()
  for (const line of scheduleValue.lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line) || !validStableId(line.id) || lineIds.has(line.id)) {
      return '布线记录编号异常，请刷新后重试'
    }
    for (const field of DEVICE_REFERENCE_FIELDS) {
      if (line[field] !== undefined && (!validStableId(line[field]) || !deviceIds.has(line[field]))) {
        return '布线记录引用的设备异常，请刷新后重试'
      }
    }
    lineIds.add(line.id)
  }
  return ''
}

function hasOnlyCommandKeys(command, keys) {
  return Object.keys(command).every((key) => keys.includes(key))
    && keys.every((key) => Object.prototype.hasOwnProperty.call(command, key))
}

function uniqueStableIds(ids) {
  if (!Array.isArray(ids) || ids.length > MAX_LINES) return false
  const seen = new Set()
  for (const id of ids) {
    if (!validStableId(id) || seen.has(id)) return false
    seen.add(id)
  }
  return true
}

function applyDeletionChange(scheduleValue, command) {
  const scheduleError = validDeletionSchedule(scheduleValue)
  if (scheduleError) return failDeletion(scheduleValue, scheduleError)
  if (scheduleValue.revision >= Number.MAX_SAFE_INTEGER) {
    return failDeletion(scheduleValue, '布线版本已达上限，无法继续修改')
  }

  if (command.type === 'delete-device') {
    if (!hasOnlyCommandKeys(command, ['type', 'id', 'deleteConnectedLines', 'expectedLineIds'])
      || !validStableId(command.id) || typeof command.deleteConnectedLines !== 'boolean'
      || !uniqueStableIds(command.expectedLineIds)) {
      return failDeletion(scheduleValue, '设备删除参数无效，请刷新后重试')
    }
    const devices = Array.isArray(scheduleValue.devices) ? scheduleValue.devices : []
    if (!devices.some((device) => device.id === command.id)) {
      return failDeletion(scheduleValue, '找不到该设备，请刷新后重试')
    }
    const connectedLines = scheduleValue.lines.filter((line) => (
      line.fromDeviceId === command.id || line.toDeviceId === command.id
    ))
    const connectedIds = connectedLines.map((line) => line.id)
    const expectedIds = new Set(command.expectedLineIds)
    if ((connectedLines.length > 0 && command.deleteConnectedLines !== true)
      || expectedIds.size !== connectedIds.length
      || connectedIds.some((id) => !expectedIds.has(id))) {
      return failDeletion(scheduleValue, '设备关联线路已变化，请刷新后重新确认')
    }
    const connectedIdSet = new Set(connectedIds)
    return {
      ok: true,
      schedule: {
        ...scheduleValue,
        revision: scheduleValue.revision + 1,
        devices: devices.filter((device) => device.id !== command.id),
        lines: scheduleValue.lines.filter((line) => !connectedIdSet.has(line.id)),
      },
      deviceIds: [command.id],
      lineIds: connectedIds,
    }
  }

  if (!hasOnlyCommandKeys(command, ['type', 'ids']) || !uniqueStableIds(command.ids) || command.ids.length < 1) {
    return failDeletion(scheduleValue, '线路删除参数无效，请刷新后重试')
  }
  const lineIds = new Set(scheduleValue.lines.map((line) => line.id))
  if (command.ids.some((id) => !lineIds.has(id))) {
    return failDeletion(scheduleValue, '找不到要删除的线路，请刷新后重试')
  }
  const deleteIds = new Set(command.ids)
  return {
    ok: true,
    schedule: {
      ...scheduleValue,
      revision: scheduleValue.revision + 1,
      lines: scheduleValue.lines.filter((line) => !deleteIds.has(line.id)),
    },
    lineIds: command.ids.slice(),
  }
}

function validateLine(line) {
  if (!line.fromDevice || !line.fromPort || !line.toDevice || !line.toPort) return '请填写线路两端的设备和端口'
  if (!BUILD_IDS.has(line.buildType)) return '请选择有效的制作方式'
  if (!['balanced', 'unbalanced', 'speaker', 'custom'].includes(line.cableType)) return '请选择有效的线材类型'
  if (!STATUS_IDS.has(line.status)) return '请选择有效的线路状态'
  if (!validLengthText(line.lengthText)) return '长度需大于 0 且不超过 1000000 m，最多两位小数'
  return ''
}

function uniqueCode(code, lines, exceptId) {
  const normalizedCode = code.trim().toLowerCase()
  return !lines.some((line) => line.id !== exceptId && line.code.trim().toLowerCase() === normalizedCode)
}

function applyDeviceRename(scheduleValue, command) {
  const schedule = normalizeSchedule(scheduleValue)
  const scheduleError = validDeletionSchedule(scheduleValue)
  if (scheduleError) return failSchedule(schedule, scheduleError)
  if (schedule.revision >= Number.MAX_SAFE_INTEGER) {
    return failSchedule(schedule, '\u9879\u76ee\u4fee\u6539\u7248\u672c\u5df2\u8fbe\u5230\u4e0a\u9650\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5')
  }
  if (!hasOnlyCommandKeys(command, ['type', 'id', 'name'])) {
    return failSchedule(schedule, '\u8bbe\u5907\u540d\u79f0\u4fee\u6539\u53c2\u6570\u65e0\u6548')
  }
  const id = asText(command.id, 100)
  const name = typeof command.name === 'string' ? command.name.trim() : ''
  if (!id || id !== command.id || !name || name.length > 100) {
    return failSchedule(schedule, '\u8bf7\u8f93\u5165\u6709\u6548\u7684\u8bbe\u5907\u540d\u79f0')
  }
  const devices = schedule.devices || []
  if (!devices.some((device) => device.id === id)) {
    return failSchedule(schedule, '\u627e\u4e0d\u5230\u8be5\u8bbe\u5907\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5')
  }
  const renamedDevices = devices.map((device) => device.id === id
    ? { ...device, name, autoName: false }
    : { ...device })
  const lines = schedule.lines.map((line) => {
    const updated = { ...line }
    if (line.fromDeviceId === id) updated.fromDevice = name
    if (line.toDeviceId === id) updated.toDevice = name
    return updated
  })
  return baseScheduleResult({
    ...schedule,
    revision: schedule.revision + 1,
    devices: renamedDevices,
    lines,
  }, true)
}

function legacyNameFromKey(value) {
  if (typeof value !== 'string' || !value.startsWith('legacy:') || value.length > 700) return null
  const encoded = value.slice('legacy:'.length)
  let name
  try { name = JSON.parse(encoded) } catch (error) { return null }
  if (typeof name !== 'string' || JSON.stringify(name) !== encoded || !name || name !== name.trim()
    || name.length > 100) return null
  return name
}

function failLegacyDeviceRename(scheduleValue, error) {
  return { ok: false, schedule: copyScheduleForDeletion(scheduleValue), error }
}

function applyLegacyDeviceRename(scheduleValue, command) {
  if (!scheduleValue || typeof scheduleValue !== 'object' || Array.isArray(scheduleValue)) {
    return failLegacyDeviceRename(scheduleValue, '\u5386\u53f2\u7ebf\u8def\u8d44\u6599\u5f02\u5e38\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5')
  }
  const scheduleError = validDeletionSchedule(scheduleValue)
  if (scheduleError) return failLegacyDeviceRename(scheduleValue, scheduleError)
  if (scheduleValue.revision >= Number.MAX_SAFE_INTEGER) {
    return failLegacyDeviceRename(scheduleValue, '\u9879\u76ee\u4fee\u6539\u7248\u672c\u5df2\u8fbe\u4e0a\u9650\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5')
  }
  if (!hasOnlyCommandKeys(command, ['type', 'legacyKey', 'name'])) {
    return failLegacyDeviceRename(scheduleValue, '\u5386\u53f2\u8bbe\u5907\u91cd\u547d\u540d\u53c2\u6570\u65e0\u6548')
  }
  const legacyName = legacyNameFromKey(command.legacyKey)
  const name = typeof command.name === 'string' ? command.name.trim() : ''
  if (!legacyName) {
    return failLegacyDeviceRename(scheduleValue, '\u8be5\u5386\u53f2\u8bbe\u5907\u7f3a\u5c11\u660e\u786e\u540d\u79f0\uff0c\u8bf7\u5148\u8865\u5168\u7ebf\u8def\u8bbe\u5907\u540d')
  }
  if (!name || name.length > 100) {
    return failLegacyDeviceRename(scheduleValue, '\u8bf7\u8f93\u5165\u6709\u6548\u7684\u8bbe\u5907\u540d\u79f0')
  }

  const normalized = normalizeSchedule(scheduleValue)
  if (normalized.lines.length !== scheduleValue.lines.length) {
    return failLegacyDeviceRename(scheduleValue, '\u5386\u53f2\u7ebf\u8def\u8d44\u6599\u5f02\u5e38\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5')
  }
  const matching = normalized.lines.map((line) => ({
    from: line.fromDeviceId === undefined && line.fromDevice === legacyName,
    to: line.toDeviceId === undefined && line.toDevice === legacyName,
  }))
  if (!matching.some(({ from, to }) => from || to)) {
    return failLegacyDeviceRename(scheduleValue, '\u627e\u4e0d\u5230\u8be5\u5386\u53f2\u8bbe\u5907\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5')
  }
  if (matching.some(({ from, to }) => from && to)) {
    return failLegacyDeviceRename(scheduleValue, '\u6765\u6e90\u8bbe\u5907\u548c\u53bb\u5411\u8bbe\u5907\u76f8\u540c\uff0c\u65e0\u6cd5\u4e3a\u540c\u4e00\u5386\u53f2\u8bbe\u5907\u5efa\u7acb\u7a33\u5b9a\u5f15\u7528')
  }

  const devices = (Array.isArray(scheduleValue.devices) ? scheduleValue.devices : []).map((device) => ({ ...device }))
  const device = { id: makeDeviceId(devices), type: 'custom', name, autoName: false }
  const lines = scheduleValue.lines.map((line, index) => {
    const updated = { ...line }
    if (matching[index].from) {
      updated.fromDevice = name
      updated.fromDeviceId = device.id
    }
    if (matching[index].to) {
      updated.toDevice = name
      updated.toDeviceId = device.id
    }
    return updated
  })
  devices.push(device)
  const nextSchedule = { ...scheduleValue, revision: scheduleValue.revision + 1, devices, lines }
  const nextError = validDeletionSchedule(nextSchedule)
  if (nextError) return failLegacyDeviceRename(scheduleValue, nextError)
  return {
    ok: true,
    schedule: nextSchedule,
    deviceIds: [device.id],
    legacyEndpointCount: matching.reduce((count, item) => count + Number(item.from) + Number(item.to), 0),
  }
}

function applyScheduleChange(scheduleValue, command) {
  const schedule = normalizeSchedule(scheduleValue)
  if (command && typeof command === 'object' && !Array.isArray(command) && command.type === 'rename-device') {
    return applyDeviceRename(scheduleValue, command)
  }
  if (command && typeof command === 'object' && !Array.isArray(command) && command.type === 'rename-legacy-device') {
    return applyLegacyDeviceRename(scheduleValue, command)
  }
  if (command && typeof command === 'object' && !Array.isArray(command)
    && (command.type === 'delete-device' || command.type === 'delete-lines')) {
    return applyDeletionChange(scheduleValue, command)
  }
  if (!command || typeof command !== 'object') return failSchedule(schedule, '无法识别这项布线操作')
  const deviceDataError = validateDeviceData(scheduleValue)
  if (deviceDataError) return failSchedule(schedule, deviceDataError)
  if (schedule.revision >= Number.MAX_SAFE_INTEGER || schedule.nextNumber >= Number.MAX_SAFE_INTEGER) {
    return failSchedule(schedule, '布线编号或版本已达到上限，无法继续修改')
  }
  const lines = schedule.lines.map((line) => ({ ...line }))
  let nextNumber = schedule.nextNumber
  let changedIds = []

  if (command.type === 'add-devices') {
    if (!Array.isArray(command.devices) || command.devices.length < 1 || command.devices.length > MAX_BATCH) {
      return failSchedule(schedule, '一次可新增 1 到 32 台设备')
    }
    const devices = (schedule.devices || []).map((device) => ({ ...device }))
    const deviceIds = []
    for (const input of command.devices) {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => !['type', 'name', 'autoName'].includes(key))
        || !DEVICE_IDS.has(input.type) || typeof input.name !== 'string'
        || !input.name.trim() || input.name.trim().length > 100) return failSchedule(schedule, '请填写有效的设备类型和名称')
      if (Object.prototype.hasOwnProperty.call(input, 'autoName') && typeof input.autoName !== 'boolean') {
        return failSchedule(schedule, '\u8bbe\u5907\u540d\u79f0\u6765\u6e90\u6807\u8bb0\u683c\u5f0f\u5f02\u5e38')
      }
      const typeLabel = DEVICE_OPTIONS.find((option) => option.id === input.type)?.label
      if (input.autoName === true && input.name.trim() !== typeLabel) {
        return failSchedule(schedule, '\u81ea\u52a8\u8bbe\u5907\u540d\u79f0\u5fc5\u987b\u4e0e\u8bbe\u5907\u7c7b\u578b\u4e00\u81f4')
      }
      const device = { id: makeDeviceId(devices), type: input.type, name: input.name.trim() }
      if (Object.prototype.hasOwnProperty.call(input, 'autoName')) device.autoName = input.autoName
      devices.push(device)
      deviceIds.push(device.id)
    }
    return { ok: true, schedule: { ...schedule, revision: schedule.revision + 1, devices }, deviceIds }
  } else if (command.type === 'append-lines') {
    if (!Array.isArray(command.lines) || command.lines.length < 1 || command.lines.length > MAX_BATCH) {
      return failSchedule(schedule, '一次可批量新增 1 到 32 条线路')
    }
    if (lines.length + command.lines.length > MAX_LINES) return failSchedule(schedule, '项目最多可保存 200 条线路')
    let candidateSchedule = schedule
    for (const line of command.lines) {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return failSchedule(schedule, '批量线路资料无效')
      if (line.id !== undefined && line.id !== null && line.id !== '') return failSchedule(schedule, '批量新增不能带已有线路编号')
      const result = applyScheduleChange({ ...candidateSchedule, revision: schedule.revision }, { type: 'upsert', line })
      if (!result.ok) return failSchedule(schedule, result.error)
      candidateSchedule = result.schedule
      changedIds.push(...result.lineIds)
    }
    return baseScheduleResult(candidateSchedule, true, '', changedIds)
  } else if (command.type === 'upsert') {
    const input = command.line
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failSchedule(schedule, '线路资料无效')
    const index = input.id ? lines.findIndex((line) => line.id === input.id) : -1
    if (input.id && index < 0) return failSchedule(schedule, '找不到这条线路，请刷新后重试')
    const previous = index >= 0 ? lines[index] : null
    if (!previous && lines.length >= MAX_LINES) return failSchedule(schedule, '项目最多可保存 200 条线路')
    const candidate = {
      ...(previous || {}),
      ...input,
      id: previous ? previous.id : makeLineId(lines),
      purpose: asText(input.purpose === undefined ? previous?.purpose : input.purpose, 100),
      fromDevice: asText(input.fromDevice === undefined ? previous?.fromDevice : input.fromDevice, 100),
      fromPort: asText(input.fromPort === undefined ? previous?.fromPort : input.fromPort, 80),
      toDevice: asText(input.toDevice === undefined ? previous?.toDevice : input.toDevice, 100),
      toPort: asText(input.toPort === undefined ? previous?.toPort : input.toPort, 80),
      buildType: input.buildType === undefined ? (previous?.buildType || 'finished') : input.buildType,
      cableType: input.cableType === undefined ? (previous?.cableType || 'balanced') : input.cableType,
      spec: asText(input.spec === undefined ? previous?.spec : input.spec, 120),
      connectorA: asText(input.connectorA === undefined ? previous?.connectorA : input.connectorA, 60),
      connectorB: asText(input.connectorB === undefined ? previous?.connectorB : input.connectorB, 60),
      lengthText: asText(input.lengthText === undefined ? previous?.lengthText : input.lengthText, MAX_LENGTH_TEXT),
      status: input.status === undefined ? (previous?.status || 'pending') : input.status,
      notes: asText(input.notes === undefined ? previous?.notes : input.notes, 300),
    }
    DEVICE_REFERENCE_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(input, field) && input[field] === null) delete candidate[field]
    })
    const referenceError = validateLineDeviceReferences(candidate, new Set((schedule.devices || []).map((device) => device.id)))
    if (referenceError) return failSchedule(schedule, referenceError)
    const distinctDeviceError = validateDistinctDeviceReferences(candidate)
    if (distinctDeviceError) return failSchedule(schedule, distinctDeviceError)
    if (!BUILD_IDS.has(candidate.buildType)) return failSchedule(schedule, '请选择有效的制作方式')
    if (!['balanced', 'unbalanced', 'speaker', 'custom'].includes(candidate.cableType)) {
      return failSchedule(schedule, '请选择有效的线材类型')
    }
    if (!STATUS_IDS.has(candidate.status)) return failSchedule(schedule, '请选择有效的线路状态')
    if (input.lengthText !== undefined && typeof input.lengthText !== 'string') {
      return failSchedule(schedule, '长度需为文本格式，可留空表示待确认')
    }
    const requestedLengthText = input.lengthText === undefined ? (previous?.lengthText || '') : input.lengthText.trim()
    if (requestedLengthText.length > MAX_LENGTH_TEXT || !validLengthText(requestedLengthText)) {
      return failSchedule(schedule, '长度需大于 0 且不超过 1000000 m，最多两位小数')
    }
    let nextScheduleNumber = nextNumber
    const requestedCode = asText(input.code === undefined ? previous?.code : input.code, 32)
    if (requestedCode) {
      candidate.code = requestedCode
      if (!uniqueCode(candidate.code, lines, previous?.id)) return failSchedule(schedule, '线路编号已存在，请更换编号')
    } else {
      const allocation = allocateCode(schedule, previous ? lines.filter((line) => line.id !== previous.id) : lines)
      if (!allocation) return failSchedule(schedule, '线路编号已用尽')
      candidate.code = allocation.code
      nextScheduleNumber = allocation.nextNumber
    }
    const normalized = normalizeLine(candidate)
    const error = validateLine(normalized || candidate)
    if (error) return failSchedule(schedule, error)
    if (index >= 0) lines[index] = normalized
    else lines.push(normalized)
    changedIds = [normalized.id]
    nextNumber = nextScheduleNumber
  } else if (command.type === 'delete') {
    const id = asText(command.id, 100)
    if (!lines.some((line) => line.id === id)) return failSchedule(schedule, '找不到这条线路，请刷新后重试')
    const remaining = lines.filter((line) => line.id !== id)
    changedIds = [id]
    const updated = { ...schedule, revision: schedule.revision + 1, nextNumber, lines: remaining }
    return baseScheduleResult(updated, true, '', changedIds)
  } else if (command.type === 'duplicate') {
    const source = lines.find((line) => line.id === asText(command.id, 100))
    const distinctDeviceError = validateDistinctDeviceReferences(source)
    if (distinctDeviceError) return failSchedule(schedule, distinctDeviceError)
    if (!source) return failSchedule(schedule, '找不到这条线路，请刷新后重试')
    if (lines.length >= MAX_LINES) return failSchedule(schedule, '项目最多可保存 200 条线路')
    const allocation = allocateCode(schedule, lines)
    if (!allocation) return failSchedule(schedule, '线路编号已用尽')
    const duplicate = {
      ...source,
      id: makeLineId(lines),
      code: allocation.code,
      status: 'pending',
    }
    lines.push(duplicate)
    nextNumber = allocation.nextNumber
    changedIds = [duplicate.id]
  } else if (command.type === 'batch') {
    const batch = command
    if (!batch.line || typeof batch.line !== 'object' || Array.isArray(batch.line)) return failSchedule(schedule, '批量线路资料无效')
    if (batch.line.id !== undefined && batch.line.id !== null && batch.line.id !== '') {
      return failSchedule(schedule, '批量新增不能带已有线路编号')
    }
    const count = parseIntegerInput(batch.count)
    if (count === null || count < 1 || count > MAX_BATCH) return failSchedule(schedule, '一次可批量新增 1 到 32 条线路')
    if (lines.length + count > MAX_LINES) return failSchedule(schedule, '项目最多可保存 200 条线路')
    if (batch.line.lengthText !== undefined && typeof batch.line.lengthText !== 'string') {
      return failSchedule(schedule, '长度需为文本格式，可留空表示待确认')
    }
    const batchLengthText = typeof batch.line.lengthText === 'string' ? batch.line.lengthText.trim() : ''
    if (batchLengthText.length > MAX_LENGTH_TEXT || !validLengthText(batchLengthText)) {
      return failSchedule(schedule, '长度需大于 0 且不超过 1000000 m，最多两位小数')
    }
    const fromPrefix = typeof batch.fromPrefix === 'string' ? batch.fromPrefix.trimStart().slice(0, 60) : ''
    const toPrefix = typeof batch.toPrefix === 'string' ? batch.toPrefix.trimStart().slice(0, 60) : ''
    const fromStart = parseIntegerInput(batch.fromStart)
    const toStart = parseIntegerInput(batch.toStart)
    if (fromStart === null || fromStart < 0 || toStart === null || toStart < 0
      || fromStart + count - 1 > 99999 || toStart + count - 1 > 99999) {
      return failSchedule(schedule, '批量端口起始序号无效')
    }
    const created = []
    let candidateSchedule = { ...schedule, nextNumber }
    for (let index = 0; index < count; index += 1) {
      const allocation = allocateCode(candidateSchedule, [...lines, ...created])
      if (!allocation) return failSchedule(schedule, '线路编号已用尽')
      const candidate = {
        ...batch.line,
        id: makeLineId([...lines, ...created]),
        code: allocation.code,
        fromPort: `${fromPrefix}${fromStart + index}`,
        toPort: `${toPrefix}${toStart + index}`,
        status: 'pending',
      }
      const referenceError = validateLineDeviceReferences(candidate, new Set((schedule.devices || []).map((device) => device.id)))
      if (referenceError) return failSchedule(schedule, referenceError)
      const distinctDeviceError = validateDistinctDeviceReferences(candidate)
      if (distinctDeviceError) return failSchedule(schedule, distinctDeviceError)
      if (!BUILD_IDS.has(candidate.buildType)) return failSchedule(schedule, '请选择有效的制作方式')
      if (!['balanced', 'unbalanced', 'speaker', 'custom'].includes(candidate.cableType)) {
        return failSchedule(schedule, '请选择有效的线材类型')
      }
      const normalized = normalizeLine(candidate)
      const error = validateLine(normalized || candidate)
      if (error) return failSchedule(schedule, error)
      created.push(normalized)
      candidateSchedule = { ...candidateSchedule, nextNumber: allocation.nextNumber }
    }
    lines.push(...created)
    nextNumber = candidateSchedule.nextNumber
    changedIds = created.map((line) => line.id)
  } else {
    return failSchedule(schedule, '无法识别这项布线操作')
  }

  const updated = { ...schedule, revision: schedule.revision + 1, nextNumber, lines }
  return baseScheduleResult(updated, true, '', changedIds)
}

function prettyNumber(value) {
  return String(Math.round(value * 100) / 100)
}

function knownLength(lines) {
  return lines.reduce((total, line) => total + (line.lengthText ? Number(line.lengthText) : 0), 0)
}

function formatLength(value) {
  return `${prettyNumber(value)} m`
}

function endpoint(device, port) {
  return [device, port].filter(Boolean).join(' / ')
}

function optionLabel(map, value) {
  if (!value) return '待确认'
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value
}

function materialRow(key, title, detail, quantity, unit, lengthText, totalLengthText, unknownLengthCount) {
  return { key, title, detail, quantity, unit, lengthText, totalLengthText, unknownLengthCount }
}

function buildMaterialSummary(scheduleValue) {
  const schedule = normalizeSchedule(scheduleValue)
  const lines = schedule.lines
  const checkedCount = lines.filter((line) => line.status === 'checked').length
  const pendingCount = lines.filter((line) => line.status === 'pending').length
  const connectedCount = lines.filter((line) => line.status === 'connected').length
  const unknownLengthCount = lines.filter((line) => line.lengthText === '').length
  const known = knownLength(lines)
  const finishedGroups = new Map()
  const bulkGroups = new Map()
  const connectorGroups = new Map()
  const labels = []

  lines.forEach((line) => {
    const local = endpoint(line.fromDevice, line.fromPort)
    const remote = endpoint(line.toDevice, line.toPort)
    labels.push(
      { code: line.code, local, remote, direction: 'to' },
      { code: line.code, local: remote, remote: local, direction: 'from' },
    )

    const cableLabel = optionLabel(CABLE_LABELS, line.cableType)
    const specLabel = line.spec || '规格待填写'
    const lengthValue = line.lengthText ? Number(line.lengthText) : null
    const lengthGroup = line.lengthText || 'unknown'
    if (line.buildType === 'finished') {
      const key = JSON.stringify([line.cableType, line.spec, line.connectorA, line.connectorB, lengthGroup])
      const group = finishedGroups.get(key) || { lines: [], unknownLengthCount: 0, knownTotal: 0 }
      group.lines.push(line)
      if (lengthValue === null) group.unknownLengthCount += 1
      else group.knownTotal += lengthValue
      finishedGroups.set(key, group)
      return
    }

    const key = JSON.stringify([line.cableType, line.spec])
    const group = bulkGroups.get(key) || { lines: [], unknownLengthCount: 0, knownTotal: 0 }
    group.lines.push(line)
    if (lengthValue === null) group.unknownLengthCount += 1
    else group.knownTotal += lengthValue
    bulkGroups.set(key, group)

    ;['connectorA', 'connectorB'].forEach((field) => {
      const rawConnector = line[field]
      const keyValue = rawConnector || '__unknown__'
      const connectorGroup = connectorGroups.get(keyValue) || { rawConnector, quantity: 0, unknownCount: 0 }
      if (rawConnector) connectorGroup.quantity += 1
      else connectorGroup.unknownCount += 1
      connectorGroups.set(keyValue, connectorGroup)
    })
  })

  const finished = Array.from(finishedGroups.entries()).map(([key, group]) => {
    const line = group.lines[0]
    const title = `${optionLabel(CABLE_LABELS, line.cableType)} · ${line.spec || '规格待填写'}`
    const connectorText = `${optionLabel(CONNECTOR_LABELS, line.connectorA)} → ${optionLabel(CONNECTOR_LABELS, line.connectorB)}`
    const length = line.lengthText ? `${line.lengthText} m` : '长度待确认'
    const total = group.unknownLengthCount
      ? `${group.knownTotal ? `${formatLength(group.knownTotal)} + ` : ''}${group.unknownLengthCount} 条长度待确认`
      : formatLength(group.knownTotal)
    return materialRow(`finished:${key}`, title, `${connectorText} · 单条 ${length}`, group.lines.length, '条',
      line.lengthText, total, group.unknownLengthCount)
  })

  const bulk = Array.from(bulkGroups.entries()).map(([key, group]) => {
    const line = group.lines[0]
    const total = group.unknownLengthCount
      ? `${group.knownTotal ? `${formatLength(group.knownTotal)} + ` : ''}${group.unknownLengthCount} 条长度待确认`
      : formatLength(group.knownTotal)
    const pendingDetails = [!line.spec ? '规格待填写' : '', group.unknownLengthCount ? `${group.unknownLengthCount} 条长度待确认` : '']
      .filter(Boolean).join('；')
    return materialRow(`bulk:${key}`, `${optionLabel(CABLE_LABELS, line.cableType)} · ${line.spec || '规格待填写'}`,
      pendingDetails || '接头另计', group.knownTotal, 'm', '', total, group.unknownLengthCount)
  })

  const connectors = Array.from(connectorGroups.entries()).map(([key, group]) => {
    const title = group.rawConnector ? optionLabel(CONNECTOR_LABELS, group.rawConnector) : '接头待确认'
    const detail = group.unknownCount ? `${group.unknownCount} 个接头待确认` : '散线两端接头'
    return materialRow(`connector:${key}`, title, detail, group.rawConnector ? group.quantity : null, '个', '',
      group.rawConnector ? `${group.quantity} 个` : `${group.unknownCount} 个待确认`, 0)
  })

  return {
    lineCount: lines.length,
    checkedCount,
    pendingCount,
    connectedCount,
    knownLengthText: formatLength(known),
    unknownLengthCount,
    finished,
    bulk,
    connectors,
    labels,
  }
}

function buildScheduleText(projectName, scheduleValue) {
  const schedule = normalizeSchedule(scheduleValue)
  const summary = buildMaterialSummary(schedule)
  const name = asText(projectName, 100) || '未命名项目'
  const lines = [
    `${name}｜布线清单`,
    `线路 ${summary.lineCount} 条；待施工 ${summary.pendingCount} 条；已连接 ${summary.connectedCount} 条；已核对 ${summary.checkedCount} 条`,
    `已知长度 ${summary.knownLengthText}；另有 ${summary.unknownLengthCount} 条长度待确认`,
    '',
    '线路明细：',
  ]
  if (!schedule.lines.length) lines.push('暂无线路')
  schedule.lines.forEach((line) => {
    const label = (direction) => summary.labels.find((item) => item.code === line.code && item.direction === direction)
    const localLabel = label('to')
    const remoteLabel = label('from')
    lines.push(`${line.code}｜${optionLabel(STATUS_LABELS, line.status)}｜${line.purpose || '用途待填写'}`)
    lines.push(`  ${localLabel.local} → ${remoteLabel.local}`)
    lines.push(`  源端贴签：${line.code} → ${localLabel.remote}`)
    lines.push(`  目的端贴签：${line.code} ← ${remoteLabel.remote}`)
    lines.push(`  ${optionLabel(BUILD_LABELS, line.buildType)} · ${optionLabel(CABLE_LABELS, line.cableType)} · ${line.spec || '规格待填写'}`)
    lines.push(`  接头：${optionLabel(CONNECTOR_LABELS, line.connectorA)} → ${optionLabel(CONNECTOR_LABELS, line.connectorB)}；长度：${line.lengthText ? `${line.lengthText} m` : '待确认'}`)
    if (line.notes) lines.push(`  备注：${line.notes}`)
  })
  lines.push('', '材料汇总：')
  lines.push('成品线：')
  if (!summary.finished.length) lines.push('  无')
  summary.finished.forEach((row) => lines.push(
    `  ${row.title}｜${row.detail}｜数量 ${row.quantity} ${row.unit}｜总长 ${row.totalLengthText}`,
  ))
  lines.push('散线：')
  if (!summary.bulk.length) lines.push('  无')
  summary.bulk.forEach((row) => lines.push(
    `  ${row.title}｜${row.detail}｜已知长度 ${row.totalLengthText}`,
  ))
  lines.push('散线接头：')
  if (!summary.connectors.length) lines.push('  无')
  summary.connectors.forEach((row) => lines.push(
    `  ${row.title}｜数量 ${row.quantity === null ? row.totalLengthText : `${row.quantity} ${row.unit}`}｜${row.detail}`,
  ))
  return lines.join('\n')
}

module.exports = {
  BUILD_OPTIONS,
  CABLE_OPTIONS,
  CONNECTOR_OPTIONS,
  DEVICE_OPTIONS,
  MAX_BATCH,
  MAX_LENGTH_METERS,
  MAX_LENGTH_TEXT,
  MAX_LINES,
  STATUS_OPTIONS,
  applyScheduleChange,
  buildMaterialSummary,
  buildScheduleText,
  emptySchedule,
  normalizeSchedule,
  validateDeviceData,
}

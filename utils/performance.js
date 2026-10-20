const MAX_MEASUREMENTS = 120
const measurements = []
let enabled

function getEnvironmentVersion() {
  try {
    return typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync().miniProgram?.envVersion || ''
      : ''
  } catch (error) {
    return ''
  }
}

function isPerformanceMeasurementEnabled() {
  if (enabled === undefined) {
    const environmentVersion = getEnvironmentVersion()
    enabled = environmentVersion === 'develop' || environmentVersion === 'trial'
  }
  return enabled
}

function now() {
  try {
    const performance = typeof wx !== 'undefined' && typeof wx.getPerformance === 'function'
      ? wx.getPerformance()
      : null
    if (performance && typeof performance.now === 'function') return performance.now()
  } catch (error) {}
  return Date.now()
}

function roundMilliseconds(value) {
  return Math.round(Math.max(0, value) * 10) / 10
}

function addMeasurement(entry) {
  measurements.push(entry)
  if (measurements.length > MAX_MEASUREMENTS) measurements.shift()
  try {
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info('[PERF] ' + entry.name + '：' + entry.duration + ' ms', entry.details)
    }
  } catch (error) {}
  return entry
}

function startMeasurement(name, details = {}) {
  if (!isPerformanceMeasurementEnabled()) return () => null
  let startedAt
  try { startedAt = now() } catch (error) { return () => null }
  let finished = false
  return (extraDetails = {}) => {
    if (finished) return null
    finished = true
    try {
      const baseDetails = typeof details === 'function' ? details() : details
      const resolvedExtraDetails = typeof extraDetails === 'function' ? extraDetails() : extraDetails
      return addMeasurement({
        name,
        duration: roundMilliseconds(now() - startedAt),
        details: { ...baseDetails, ...resolvedExtraDetails },
      })
    } catch (error) {
      return null
    }
  }
}

function utf8ByteLength(value) {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

function measureJsonPayloadBytes(name, payload) {
  if (!isPerformanceMeasurementEnabled()) return null
  let startedAt
  try { startedAt = now() } catch (error) { return null }
  try {
    const serialized = JSON.stringify(payload)
    if (typeof serialized !== 'string') return null
    const bytes = utf8ByteLength(serialized)
    const duration = roundMilliseconds(now() - startedAt)
    addMeasurement({
      name,
      duration,
      details: { payloadBytes: bytes, serializationAndCountingMs: duration },
    })
    return { bytes, duration }
  } catch (error) {
    return null
  }
}

function getPerformanceSummary(prefix = '') {
  const grouped = Object.create(null)
  measurements.forEach((entry) => {
    if (prefix && !entry.name.startsWith(prefix)) return
    if (!grouped[entry.name]) grouped[entry.name] = []
    grouped[entry.name].push(entry.duration)
  })
  return Object.keys(grouped).sort().map((name) => {
    const durations = grouped[name].slice().sort((a, b) => a - b)
    const total = durations.reduce((sum, value) => sum + value, 0)
    return {
      name,
      count: durations.length,
      average: roundMilliseconds(total / durations.length),
      p95: durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)],
      maximum: durations[durations.length - 1],
      latest: grouped[name][grouped[name].length - 1],
    }
  })
}

function printPerformanceSummary(prefix = '') {
  if (!isPerformanceMeasurementEnabled()) return []
  const summary = getPerformanceSummary(prefix)
  try {
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      summary.forEach((item) => {
        console.info(
          '[PERF汇总] ' + item.name + '｜' + item.count + ' 次｜平均 ' + item.average
            + ' ms｜P95 ' + item.p95 + ' ms｜最大 ' + item.maximum + ' ms',
        )
      })
    }
  } catch (error) {}
  return summary
}

function clearPerformanceMeasurements() {
  measurements.length = 0
}

module.exports = {
  clearPerformanceMeasurements,
  getPerformanceSummary,
  isPerformanceMeasurementEnabled,
  measureJsonPayloadBytes,
  printPerformanceSummary,
  startMeasurement,
}
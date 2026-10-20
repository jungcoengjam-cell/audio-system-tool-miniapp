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

function startMeasurement(name, details = {}) {
  if (!isPerformanceMeasurementEnabled()) return () => null
  const startedAt = now()
  let finished = false
  return (extraDetails = {}) => {
    if (finished) return null
    finished = true
    const entry = {
      name,
      duration: roundMilliseconds(now() - startedAt),
      details: { ...details, ...extraDetails },
    }
    measurements.push(entry)
    if (measurements.length > MAX_MEASUREMENTS) measurements.shift()
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info(`[PERF] ${entry.name}：${entry.duration} ms`, entry.details)
    }
    return entry
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
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    summary.forEach((item) => {
      console.info(
        `[PERF汇总] ${item.name}｜${item.count} 次｜平均 ${item.average} ms｜P95 ${item.p95} ms｜最大 ${item.maximum} ms`,
      )
    })
  }
  return summary
}

function clearPerformanceMeasurements() {
  measurements.length = 0
}

module.exports = {
  clearPerformanceMeasurements,
  getPerformanceSummary,
  isPerformanceMeasurementEnabled,
  printPerformanceSummary,
  startMeasurement,
}

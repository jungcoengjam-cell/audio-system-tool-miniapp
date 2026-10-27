const MAX_MEASUREMENTS = 120
const measurements = []
let enabled
const TOOL_LOAD_TIMEOUT_MS = 30000
const TOOL_LOAD_ENTRIES = Object.freeze({
  '/pages/audio-wiring/index': Object.freeze({ id: 'audioWiring', page: '接线助手入口' }),
  '/pages/project-wiring/index': Object.freeze({ id: 'projectWiring', page: '通道与线缆入口' }),
  '/pages/dmx-address/dmx-address': Object.freeze({ id: 'dmxAddress', page: '灯具编址入口' }),
  '/pages/control-protocol/index': Object.freeze({ id: 'controlProtocol', page: '控制协议入口' }),
  '/pages/control-protocol/detail': Object.freeze({ id: 'controlProtocol', page: '控制协议资料入口' }),
})
const TOOL_LOAD_PAGES = Object.freeze({
  '/pages/audio-wiring/index': Object.freeze({ id: 'audioWiring', page: '接线助手', final: true }),
  '/pages/project-wiring/index': Object.freeze({ id: 'projectWiring', page: '通道与线缆', final: true }),
  '/pages/dmx-address/dmx-address': Object.freeze({ id: 'dmxAddress', page: '灯具编址', final: true }),
  '/pages/control-protocol/index': Object.freeze({ id: 'controlProtocol', page: '控制协议中转页', final: false }),
  '/pages/control-protocol/detail': Object.freeze({ id: 'controlProtocol', page: '控制协议资料页', final: true }),
})
const AUDIO_LOAD_ROUTE = '/pages/audio-wiring/index'
const AUDIO_LOAD_STAGE_PHASES = Object.freeze([
  'audioEditorAttachStart',
  'audioEditorAttachEnd',
  'audioWindowInfoStart',
  'audioWindowInfoEnd',
  'audioPreferenceReadStart',
  'audioPreferenceReadEnd',
  'audioModelBuildStart',
  'audioModelBuildEnd',
  'audioThemeStart',
  'audioThemeEnd',
  'audioDataPrepareStart',
  'audioDiagramHeightStart',
  'audioDiagramHeightEnd',
  'audioReportHeightStart',
  'audioReportHeightEnd',
  'audioSetDataStart',
  'audioSetDataEnd',
])
const AUDIO_LOAD_STAGE_PAIRS = Object.freeze({
  editorAttachMs: Object.freeze(['audioEditorAttachStart', 'audioEditorAttachEnd']),
  windowInfoMs: Object.freeze(['audioWindowInfoStart', 'audioWindowInfoEnd']),
  preferenceReadMs: Object.freeze(['audioPreferenceReadStart', 'audioPreferenceReadEnd']),
  modelBuildMs: Object.freeze(['audioModelBuildStart', 'audioModelBuildEnd']),
  themeMs: Object.freeze(['audioThemeStart', 'audioThemeEnd']),
  initialDataMs: Object.freeze(['audioDataPrepareStart', 'onLoadEnd']),
})
const AUDIO_INITIAL_DATA_STAGE_PAIRS = Object.freeze({
  diagramHeightMs: Object.freeze(['audioDiagramHeightStart', 'audioDiagramHeightEnd']),
  reportHeightMs: Object.freeze(['audioReportHeightStart', 'audioReportHeightEnd']),
  setDataCallMs: Object.freeze(['audioSetDataStart', 'audioSetDataEnd']),
})
let activeToolLoadAttempt = null

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

function readToolLoadClock() {
  try {
    const value = Date.now()
    return Number.isFinite(value) ? value : null
  } catch (error) {
    return null
  }
}

function beginToolLoadProbe(rawRoute) {
  try {
    return beginToolLoadProbeUnsafe(rawRoute)
  } catch (error) {
    try { clearToolLoadProbe('instrumentation-error') } catch (ignored) {}
    return false
  }
}

function beginToolLoadProbeUnsafe(rawRoute) {
  if (!isPerformanceMeasurementEnabled()) return false
  const route = typeof rawRoute === 'string' ? rawRoute.split('?')[0] : ''
  const entry = TOOL_LOAD_ENTRIES[route]
  if (!entry) {
    clearToolLoadProbe('other-route')
    return false
  }

  if (activeToolLoadAttempt) {
    const prior = activeToolLoadAttempt
    clearToolLoadTimer(prior)
    const entryIds = prior.status === 'ambiguous'
      ? new Set([...prior.entryIds, entry.id])
      : new Set([prior.entry.id, entry.id])
    activeToolLoadAttempt = {
      status: 'ambiguous',
      entryIds,
      homeHidden: prior.homeHidden,
      timeout: null,
    }
    writeToolLoadDiagnostic('overlapping-navigation', prior.status === 'active' ? prior.entry.id : '')
    setToolLoadTimer(activeToolLoadAttempt)
    return false
  }

  const startedAt = readToolLoadClock()
  if (startedAt === null) return false
  const clockSource = 'Date.now (ms-resolution primary)'

  activeToolLoadAttempt = {
    status: 'active',
    entry,
    route,
    startedAt,
    clockSource,
    stages: [],
    homeHidden: false,
    timeout: null,
  }
  setToolLoadTimer(activeToolLoadAttempt)
  return true
}

function markToolLoadStage(rawRoute, phase) {
  try {
    return markToolLoadStageUnsafe(rawRoute, phase)
  } catch (error) {
    try { clearToolLoadProbe('instrumentation-error') } catch (ignored) {}
    return false
  }
}

function markToolLoadStageUnsafe(rawRoute, phase) {
  if (!isPerformanceMeasurementEnabled()) return false
  const route = typeof rawRoute === 'string' ? rawRoute.split('?')[0] : ''
  const page = TOOL_LOAD_PAGES[route]
  const attempt = activeToolLoadAttempt
  if (!attempt || !page) return false

  if (attempt.status === 'ambiguous') {
    if (attempt.entryIds.has(page.id) && phase === 'onReady' && page.final) clearToolLoadProbe('ambiguous-navigation-settled')
    return false
  }
  if (attempt.entry.id !== page.id) {
    clearToolLoadProbe('unexpected-entry-stage')
    return false
  }
  const isAudioLoadStage = route === AUDIO_LOAD_ROUTE && AUDIO_LOAD_STAGE_PHASES.includes(phase)
  if (phase !== 'module' && phase !== 'onLoad' && phase !== 'onLoadEnd' && phase !== 'onReady' && !isAudioLoadStage) return false

  const time = readToolLoadClock()
  if (time === null || time < attempt.startedAt || (attempt.stages.length && time < attempt.stages[attempt.stages.length - 1].time)) {
    clearToolLoadProbe('clock-error')
    return false
  }
  if (attempt.stages.some((stage) => stage.route === route && stage.phase === phase)) return false
  attempt.stages.push({ route, page: page.page, phase, time })

  if (phase === 'onReady' && page.final) finishToolLoadProbe(attempt)
  return true
}

function markToolLoadHomeHidden() {
  try {
    if (activeToolLoadAttempt) activeToolLoadAttempt.homeHidden = true
  } catch (error) {}
}

function markToolLoadHomeShown() {
  try {
    if (activeToolLoadAttempt && activeToolLoadAttempt.homeHidden) clearToolLoadProbe('tool-page-return-before-ready')
  } catch (error) {}
}

function setToolLoadTimer(attempt) {
  try {
    if (typeof setTimeout !== 'function') return
    attempt.timeout = setTimeout(() => {
      if (activeToolLoadAttempt === attempt) clearToolLoadProbe('timeout')
    }, TOOL_LOAD_TIMEOUT_MS)
  } catch (error) {}
}

function clearToolLoadTimer(attempt) {
  try {
    if (attempt && attempt.timeout !== null && typeof clearTimeout === 'function') clearTimeout(attempt.timeout)
  } catch (error) {}
}

function clearToolLoadProbe(reason) {
  const attempt = activeToolLoadAttempt
  if (!attempt) return
  clearToolLoadTimer(attempt)
  activeToolLoadAttempt = null
  if (reason) writeToolLoadDiagnostic(reason, attempt.status === 'active' ? attempt.entry.id : '')
}

function writeToolLoadDiagnostic(reason, entryId) {
  if (!isPerformanceMeasurementEnabled()) return
  try {
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info('[PERF] 首页工具加载采样作废：' + reason, entryId ? { entry: entryId } : {})
    }
  } catch (error) {}
}

function getAudioLoadStageTimings(stages, loadStage, loadEndStage) {
  const stageByPhase = new Map(stages
    .filter((stage) => stage.route === AUDIO_LOAD_ROUTE)
    .map((stage) => [stage.phase, stage]))
  const timings = {}
  let measuredDuration = 0
  let complete = true
  Object.entries(AUDIO_LOAD_STAGE_PAIRS).forEach(([field, [startPhase, endPhase]]) => {
    const start = stageByPhase.get(startPhase)
    const end = endPhase === 'onLoadEnd' ? loadEndStage : stageByPhase.get(endPhase)
    if (!start || !end || end.time < start.time) {
      timings[field] = null
      complete = false
      return
    }
    const duration = end.time - start.time
    measuredDuration += duration
    timings[field] = roundMilliseconds(duration)
  })

  let initialDataSubstageDuration = 0
  let initialDataSubstagesComplete = true
  Object.entries(AUDIO_INITIAL_DATA_STAGE_PAIRS).forEach(([field, [startPhase, endPhase]]) => {
    const start = stageByPhase.get(startPhase)
    const end = stageByPhase.get(endPhase)
    if (!start || !end || end.time < start.time) {
      timings[field] = null
      initialDataSubstagesComplete = false
      return
    }
    const duration = end.time - start.time
    initialDataSubstageDuration += duration
    timings[field] = roundMilliseconds(duration)
  })

  const initialDataDuration = timings.initialDataMs
  timings.initialDataResidualMs = initialDataDuration !== null
    && initialDataSubstagesComplete
    && initialDataDuration >= initialDataSubstageDuration
    ? roundMilliseconds(initialDataDuration - initialDataSubstageDuration)
    : null

  const onLoadDuration = loadStage && loadEndStage ? loadEndStage.time - loadStage.time : null
  timings.unmeasuredOnLoadMs = complete && onLoadDuration !== null && onLoadDuration >= measuredDuration
    ? roundMilliseconds(onLoadDuration - measuredDuration)
    : null
  return timings
}

function finishToolLoadProbe(attempt) {
  try {
    if (activeToolLoadAttempt !== attempt || attempt.status !== 'active') return
    const readyStage = attempt.stages[attempt.stages.length - 1]
    if (!readyStage || readyStage.phase !== 'onReady') return
    const firstModule = attempt.stages.find((stage) => stage.route === attempt.route && stage.phase === 'module')
    const firstLoad = attempt.stages.find((stage) => stage.route === attempt.route && stage.phase === 'onLoad')
    const readyPageLoad = attempt.stages.slice().reverse().find((stage) => stage.route === readyStage.route && stage.phase === 'onLoad')
    const readyPageLoadEnd = attempt.stages.slice().reverse().find((stage) => stage.route === readyStage.route && stage.phase === 'onLoadEnd')
    const stages = attempt.stages.map((stage, index) => {
      const previous = index === 0 ? { page: '点击', phase: '', time: attempt.startedAt } : attempt.stages[index - 1]
      return {
        page: stage.page,
        phase: stage.phase,
        elapsedFromPreviousMs: roundMilliseconds(stage.time - previous.time),
      }
    })
    const modulePages = [...new Set(attempt.stages.filter((stage) => stage.phase === 'module').map((stage) => stage.page))]
    const entryModules = attempt.route === '/pages/control-protocol/index'
      ? ['/pages/control-protocol/index', '/pages/control-protocol/detail']
      : [attempt.route]
    const loadEndTimings = readyPageLoad && readyPageLoadEnd
      ? {
        onLoadToEndMs: roundMilliseconds(readyPageLoadEnd.time - readyPageLoad.time),
        onLoadEndToReadyMs: roundMilliseconds(readyStage.time - readyPageLoadEnd.time),
      }
      : {}
    const audioLoadTimings = attempt.route === AUDIO_LOAD_ROUTE
      ? getAudioLoadStageTimings(attempt.stages, readyPageLoad, readyPageLoadEnd)
      : {}
    const details = {
      entry: attempt.entry.id,
      entryRoute: attempt.route,
      clock: attempt.clockSource,
      moduleMarkers: entryModules.map((route) => {
        const stage = attempt.stages.find((item) => item.route === route && item.phase === 'module')
        const page = TOOL_LOAD_PAGES[route]
        return {
          page: page.page,
          elapsedMs: stage ? roundMilliseconds(stage.time - attempt.startedAt) : null,
          state: stage ? 'observed' : 'not-observed-possible-cache-reuse',
        }
      }),
      tapToModuleMs: firstModule ? roundMilliseconds(firstModule.time - attempt.startedAt) : null,
      moduleToOnLoadMs: firstModule && firstLoad ? roundMilliseconds(firstLoad.time - firstModule.time) : null,
      tapToOnLoadMs: firstLoad ? roundMilliseconds(firstLoad.time - attempt.startedAt) : null,
      onLoadToReadyMs: readyPageLoad && readyStage ? roundMilliseconds(readyStage.time - readyPageLoad.time) : null,
      ...loadEndTimings,
      ...audioLoadTimings,
      tapToReadyMs: roundMilliseconds(readyStage.time - attempt.startedAt),
      modulePages,
      stages,
      notes: [
        '点击到脚本首句为混合区间，包含调度、分包读取或下载、解压和代码准备，不能拆作纯下载。',
        '加载阶段统一使用 Date.now 毫秒精度时钟，没有亚毫秒精度；显示为 0.0 ms 表示本次读数没有跨越可分辨的毫秒边界。',
        'onReady 表示首轮渲染生命周期到达，不代表页面已可操作。',
      ...(attempt.route === AUDIO_LOAD_ROUTE ? [
        '接线助手的 diagramHeightMs/reportHeightMs 分别计时各自的安全高度函数，setDataCallMs 包含同步调用及其返回前同步执行的回调；initialDataResidualMs 是这三段未覆盖的初始数据准备时间。',
        'setDataCallMs 不包含异步 WXML 更新或首轮渲染；缺失或不一致的子阶段数据会显示为 null。',
      ] : []),
      ],
    }
    clearToolLoadTimer(attempt)
    activeToolLoadAttempt = null
    addMeasurement({
      name: '首页工具/首次加载/' + attempt.entry.id,
      duration: details.tapToReadyMs,
      details,
    })
  } catch (error) {
    clearToolLoadProbe('measurement-error')
  }
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
  beginToolLoadProbe,
  getPerformanceSummary,
  isPerformanceMeasurementEnabled,
  markToolLoadHomeHidden,
  markToolLoadHomeShown,
  markToolLoadStage,
  measureJsonPayloadBytes,
  printPerformanceSummary,
  startMeasurement,
}

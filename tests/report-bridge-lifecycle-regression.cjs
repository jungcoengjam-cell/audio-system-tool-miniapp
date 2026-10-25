const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const beforeRoot = path.join(root, 'tmp/architecture-refactor-2026-10-25/before')
const bridgeFiles = {
  audioWiring: 'pages/audio-wiring/report-bridge.js',
  projectWiring: 'pages/project-wiring/report-bridge.js',
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function evaluateCommonJs(context, filePath, source, requireFor) {
  const module = { exports: {} }
  const wrapper = new vm.Script(`(function (require, module, exports) {\n${source}\n})`, { filename: filePath })
  wrapper.runInContext(context)(requireFor, module, module.exports)
  return module.exports
}

function createBridgeFixture(kind, version) {
  let definition
  const context = vm.createContext({
    Page(value) { definition = value },
    console,
  })
  const sourcePath = path.join(version === 'before' ? beforeRoot : root, bridgeFiles[kind])
  const bridgeSource = fs.readFileSync(sourcePath, 'utf8')
  const reportModule = {
    buildScheduleReportPages: () => ({ pages: [], lineCount: 0 }),
    drawScheduleReport() {},
  }
  const wiringModel = {
    getWiringModel: () => ({}),
    getFixedWiringSelections: () => ({}),
    buildWiringText: () => '',
  }
  const wiringRenderer = { drawWiringReport() {}, getReportHeight: () => 1 }
  const wiringPhotos = { loadReportSolderPhotos() {} }
  const mocked = {
    './report': reportModule,
    './wiring-model': wiringModel,
    './wiring-renderer': wiringRenderer,
    './wiring-photos': wiringPhotos,
  }
  const requireForBridge = (request) => {
    if (request === '../../utils/report-bridge-lifecycle') {
      const helperPath = path.join(root, 'utils/report-bridge-lifecycle.js')
      const helperSource = fs.readFileSync(helperPath, 'utf8')
      return evaluateCommonJs(context, helperPath, helperSource, () => ({}))
    }
    if (Object.hasOwn(mocked, request)) return mocked[request]
    throw new Error(`Unexpected ${kind} bridge import: ${request}`)
  }
  evaluateCommonJs(context, sourcePath, bridgeSource, requireForBridge)
  assert.ok(definition, `${kind} must register a real Page definition`)

  const page = {
    ...definition,
    data: clone(definition.data),
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      callback?.()
    },
  }
  return { context, definition, page }
}

function createChannel({ withOff = true } = {}) {
  const listeners = new Map()
  const trace = []
  const emitted = []
  const channel = {
    on(name, listener) {
      trace.push(`on:${name}`)
      const set = listeners.get(name) || new Set()
      set.add(listener)
      listeners.set(name, set)
    },
    emit(name, payload) {
      trace.push(`emit:${name}`)
      emitted.push({ name, payload: clone(payload) })
    },
  }
  if (withOff) {
    channel.off = (name, listener) => {
      trace.push(`off:${name}`)
      listeners.get(name)?.delete(listener)
    }
  }
  return {
    channel,
    trace,
    emitted,
    dispatch(name, payload) {
      trace.push(`dispatch:${name}`)
      for (const listener of listeners.get(name) || []) listener(payload)
    },
    listenerCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0)
    },
  }
}

function attachChannel(page, channel) {
  if (channel !== undefined) page.getOpenerEventChannel = () => channel.channel
}

function installWx(fixture, trace, backCalls, label) {
  fixture.context.wx = {
    navigateBack(options = {}) {
      trace.push(`back:${label}:${options.delta}`)
      backCalls.push({ label, delta: options.delta, complete: options.complete })
    },
  }
}

function summarizeBridge(fixture, channel, backCalls, extras = {}) {
  const { page } = fixture
  return {
    identity: clone(page._bridgeIdentity),
    terminal: Boolean(page._terminal),
    unloaded: Boolean(page._unloaded),
    payload: page._payload ? clone({
      ticket: page._payload.ticket,
      fingerprint: page._payload.fingerprint,
      revision: page._payload.revision,
    }) : null,
    trace: clone(channel?.trace || extras.trace || []),
    results: clone(channel?.emitted.filter((event) => event.name === 'report-bridge-result').map((event) => event.payload) || []),
    backComplete: clone(channel?.emitted.filter((event) => event.name === 'report-bridge-back-complete').map((event) => event.payload) || []),
    backCalls: backCalls.map(({ label, delta }) => ({ label, delta })),
    listenersAfterUnload: channel?.listenerCount() ?? null,
    ...extras.snapshot,
  }
}

function runBridgeScenario(kind, version, scenario) {
  const fixture = createBridgeFixture(kind, version)
  const channel = scenario === 'missing-channel'
    ? undefined
    : createChannel({ withOff: scenario !== 'no-off' })
  attachChannel(fixture.page, channel)
  const backCalls = []
  const trace = channel?.trace || []
  installWx(fixture, trace, backCalls, 'initial')
  const { page, context } = fixture

  if (scenario === 'generate-dispatch-invalid') {
    page.onLoad({ ticket: 'load-ticket', revision: '42' })
    // Exercise the registered listener and real begin method without starting rendering.
    channel.dispatch('generate-report', null)
    backCalls[0]?.complete?.()
    page.onUnload()
  } else if (scenario === 'missing-options') {
    page.onLoad()
    page.finish({ ok: true })
    backCalls[0]?.complete?.()
    page.onUnload()
  } else if (scenario === 'exception-revision') {
    let error = ''
    try {
      page.onLoad({ revision: { [Symbol.toPrimitive]() { throw new Error('revision conversion failed') } } })
    } catch (caught) {
      error = caught.message
    }
    return {
      identity: clone(page._bridgeIdentity),
      terminal: Boolean(page._terminal),
      unloaded: Boolean(page._unloaded),
      payload: null,
      trace: clone(trace),
      results: [],
      backComplete: [],
      backCalls: [],
      listenersAfterUnload: channel.listenerCount(),
      thrown: error,
    }
  } else if (scenario === 'cancel-mismatch-then-match') {
    page.onLoad({ ticket: 'query-ticket', revision: 11 })
    channel.dispatch('cancel-report', { ticket: 'other-ticket' })
    const terminalAfterMismatch = Boolean(page._terminal)
    channel.dispatch('cancel-report', { ticket: 'query-ticket' })
    backCalls[0]?.complete?.()
    page.onUnload()
    return summarizeBridge(fixture, channel, backCalls, { snapshot: { terminalAfterMismatch } })
  } else if (scenario === 'unload-before-start') {
    page.onLoad({ ticket: 'unload-ticket', revision: 13 })
    page.onUnload()
  } else if (scenario === 'success-then-unload') {
    page.onLoad({ ticket: 'query-ticket', revision: 21 })
    page._payload = { ticket: 'payload-ticket', fingerprint: 'payload-fingerprint', revision: 22 }
    page.finish({ ok: true, items: [{ id: 'done' }] })
    page.onUnload()
    backCalls[0]?.complete?.()
  } else if (scenario === 'missing-channel') {
    context.wx = {
      navigateBack(options = {}) {
        trace.push(`back:without-channel:${options.delta}`)
        backCalls.push({ label: 'without-channel', delta: options.delta, complete: options.complete })
      },
    }
    page.onLoad({ ticket: 'no-channel', revision: 'bad' })
    page._payload = { ticket: 'no-channel-payload', fingerprint: 'no-channel-fingerprint', revision: 8 }
    page.finish({ ok: true })
    backCalls[0]?.complete?.()
    page.onUnload()
    return summarizeBridge(fixture, channel, backCalls, { trace })
  } else if (scenario === 'no-off') {
    context.wx = {}
    page.onLoad({ ticket: 'no-off', revision: '5' })
    page.onUnload()
  } else if (scenario === 'no-navigate-back') {
    context.wx = {}
    page.onLoad({ ticket: 'no-back', revision: '6' })
    page._payload = { ticket: 'no-back-payload', fingerprint: 'no-back-fingerprint', revision: 9 }
    page.finish({ ok: true })
    page.onUnload()
  } else if (scenario === 'dynamic-wx') {
    page.onLoad({ ticket: 'dynamic-ticket', revision: 31 })
    const oldWx = context.wx
    const oldWxCalls = []
    oldWx.navigateBack = (options = {}) => {
      oldWxCalls.push(options.delta)
      trace.push(`back:old:${options.delta}`)
      backCalls.push({ label: 'old', delta: options.delta, complete: options.complete })
    }
    const newWxCalls = []
    context.wx = {
      navigateBack(options = {}) {
        newWxCalls.push(options.delta)
        trace.push(`back:new:${options.delta}`)
        backCalls.push({ label: 'new', delta: options.delta, complete: options.complete })
      },
    }
    page._payload = { ticket: 'dynamic-payload', fingerprint: 'dynamic-fingerprint', revision: 32 }
    page.finish({ ok: true })
    backCalls.at(-1)?.complete?.()
    page.onUnload()
    return summarizeBridge(fixture, channel, backCalls, { snapshot: { oldWxCalls, newWxCalls } })
  } else {
    throw new Error(`Unknown bridge scenario: ${scenario}`)
  }

  return summarizeBridge(fixture, channel, backCalls)
}

const bridgeScenarios = [
  'generate-dispatch-invalid',
  'missing-options',
  'exception-revision',
  'cancel-mismatch-then-match',
  'unload-before-start',
  'success-then-unload',
  'missing-channel',
  'no-off',
  'no-navigate-back',
  'dynamic-wx',
]

function createRecordFixture(version) {
  let definition
  let sectionCalls = 0
  const sectionValue = [
    {
      key: 'calculation',
      title: '计算记录',
      items: [
        { id: 'calc-1', type: 'calculation', title: '计算一', subtitle: '音频', ignored: 'not rendered' },
        { id: 'calc-2', type: 'calculation', title: '计算二', subtitle: '舞台', ignored: 'not rendered' },
      ],
    },
    {
      key: 'wiring',
      title: '接线记录',
      items: [{ id: 'wire-1', type: 'wiring', title: '线路一', subtitle: '两端设备', ignored: 'not rendered' }],
    },
  ]
  const source = { ok: true, project: { id: 'project-1', name: '测试工程' } }
  const reportModel = {
    REPORT_WIDTH: 720,
    buildReportPayload() { return {} },
    getProjectReportSections() {
      sectionCalls += 1
      return clone(sectionValue)
    },
    getReportSourceFingerprint: () => 'source-fingerprint',
    loadProjectReportSource: () => clone(source),
    summarizeSelection(sections, selectedIds) {
      const totalCount = sections.reduce((total, section) => total + section.items.length, 0)
      return {
        selectedCount: selectedIds.length,
        totalCount,
        allSelected: selectedIds.length === totalCount,
        hasSelection: selectedIds.length > 0,
      }
    },
  }
  const mocks = {
    '../../utils/report-canvas': { drawAndExportReport() {} },
    '../../utils/report-drawing': { getExportDimensions() { return {} } },
    '../../utils/haptics': { vibrate() {} },
    './report-pdf-export': { buildReportPdfFile() {} },
    './report-pdf': { MAX_IMAGE_DIMENSION: 3600, MAX_IMAGE_PIXELS: 10000000, makeReportPdfFileName: () => 'report.pdf' },
    './report-model': reportModel,
    './report-renderer': { drawReportPage() {} },
    './report-snapshot-adapter': {
      REPORT_SEGMENT_HEIGHT: 3600,
      buildReportImageTasks() { return { ok: true, tasks: [] } },
      splitTaskIntoSegments() { return [] },
    },
  }
  const context = vm.createContext({ Page(value) { definition = value }, console })
  const sourcePath = path.join(version === 'before' ? beforeRoot : root, 'pages/records/report.js')
  const sourceText = fs.readFileSync(sourcePath, 'utf8')
  const requireForPage = (request) => {
    if (Object.hasOwn(mocks, request)) return mocks[request]
    throw new Error(`Unexpected record report import: ${request}`)
  }
  evaluateCommonJs(context, sourcePath, sourceText, requireForPage)
  assert.ok(definition, 'records report must register a real Page definition')
  const page = {
    ...definition,
    data: clone(definition.data),
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      callback?.()
    },
  }
  return { page, getSectionCalls: () => sectionCalls }
}

function runRecordSelection(version) {
  const fixture = createRecordFixture(version)
  fixture.page.onLoad({ id: 'project-1' })
  return {
    calls: fixture.getSectionCalls(),
    selectionSections: clone(fixture.page.data.selectionSections),
    selectedItemIds: clone(fixture.page.data.selectedItemIds),
    counts: {
      selectedCount: fixture.page.data.selectedCount,
      totalCount: fixture.page.data.totalCount,
      allSelected: fixture.page.data.allSelected,
      hasSelection: fixture.page.data.hasSelection,
    },
  }
}

function runSnapshot(version) {
  const bridges = {}
  for (const kind of Object.keys(bridgeFiles)) {
    bridges[kind] = Object.fromEntries(bridgeScenarios.map((scenario) => [
      scenario,
      runBridgeScenario(kind, version, scenario),
    ]))
  }
  return { bridges, records: runRecordSelection(version) }
}

const current = runSnapshot('current')
const recordCurrent = current.records
assert.equal(recordCurrent.calls, 2,
  'the selection page should build source sections once and selection sections once')
assert.deepEqual(recordCurrent.selectionSections, [
  {
    key: 'calculation', title: '计算记录', items: [
      { id: 'calc-1', type: 'calculation', title: '计算一', subtitle: '音频', checked: true, imageError: '' },
      { id: 'calc-2', type: 'calculation', title: '计算二', subtitle: '舞台', checked: true, imageError: '' },
    ],
  },
  {
    key: 'wiring', title: '接线记录', items: [
      { id: 'wire-1', type: 'wiring', title: '线路一', subtitle: '两端设备', checked: true, imageError: '' },
    ],
  },
], 'selection sections must retain the rendered output')
assert.deepEqual(recordCurrent.selectedItemIds, ['calc-1', 'calc-2', 'wire-1'])
assert.deepEqual(recordCurrent.counts, { selectedCount: 3, totalCount: 3, allSelected: true, hasSelection: true })

for (const kind of Object.keys(bridgeFiles)) {
  const scenarios = current.bridges[kind]
  const generated = scenarios['generate-dispatch-invalid']
  assert.equal(generated.identity.revision, 42)
  assert.equal(generated.terminal, true, 'generate event must invoke begin on its Page instance')
  assert.equal(generated.listenersAfterUnload, 0)
  assert.equal(generated.backComplete.length, 1)
  assert.deepEqual(generated.trace.slice(0, 3), [
    'on:generate-report', 'on:cancel-report', 'emit:report-bridge-ready',
  ], 'load must subscribe before announcing bridge readiness')
  assert.deepEqual(generated.trace.slice(4, 7), [
    'emit:report-bridge-result', 'back:initial:1', 'emit:report-bridge-back-complete',
  ], 'result must precede navigation and its complete event')
  assert.deepEqual(generated.trace.slice(-2), ['off:generate-report', 'off:cancel-report'])
  assert.equal(generated.results[0].message, kind === 'audioWiring'
    ? '接线图片任务的批次快照无效。' : '项目线路图片任务的批次快照无效。')
  assert.equal(scenarios['cancel-mismatch-then-match'].terminalAfterMismatch, false)
  assert.equal(scenarios['cancel-mismatch-then-match'].results.length, 1)
  assert.equal(scenarios['cancel-mismatch-then-match'].results[0].message, kind === 'audioWiring'
    ? '接线图片生成已取消。' : '项目线路图片生成已取消。')
  assert.equal(scenarios['unload-before-start'].results[0].cancelled, true)
  assert.equal(scenarios['unload-before-start'].backCalls.length, 0)
  assert.equal(scenarios['success-then-unload'].results[0].fingerprint, 'payload-fingerprint')
  assert.equal(scenarios['success-then-unload'].results[0].revision, 22)
  assert.equal(scenarios['success-then-unload'].results.length, 1, 'finish must remain idempotent across a later unload')
  assert.deepEqual(scenarios['missing-options'].identity, { bridge: kind, ticket: '', revision: null })
  assert.equal(scenarios['exception-revision'].thrown, 'revision conversion failed')
  assert.equal(scenarios['no-off'].results.length, 1)
  assert.equal(scenarios['no-off'].backCalls.length, 0)
  assert.equal(scenarios['no-off'].listenersAfterUnload, 2, 'missing off methods must not break unload')
  assert.equal(scenarios['missing-channel'].backCalls.length, 1, 'navigation must still work without an event channel')
  assert.equal(scenarios['missing-channel'].backComplete.length, 0)
  assert.equal(scenarios['no-navigate-back'].results.length, 1)
  assert.equal(scenarios['no-navigate-back'].backCalls.length, 0)
  assert.deepEqual(scenarios['dynamic-wx'].oldWxCalls, [])
  assert.deepEqual(scenarios['dynamic-wx'].newWxCalls, [1], 'finish must read wx at call time')
}

if (process.argv.includes('--compare-before')) {
  const before = runSnapshot('before')
  const { calls: beforeCalls, ...beforeRecordsOutput } = before.records
  const { calls: currentCalls, ...currentRecordsOutput } = current.records
  assert.equal(beforeCalls, 3, 'the frozen baseline should show the duplicate unused section build')
  assert.equal(currentCalls, 2, 'the refactor should remove exactly one unused section build')
  assert.deepEqual(current.bridges, before.bridges,
    'bridge event traces and state must match the start-manifest source snapshot')
  assert.deepEqual(currentRecordsOutput, beforeRecordsOutput,
    'selection output and selection semantics must match the start-manifest source snapshot')
  console.log('Report bridge lifecycle regression passed (before/current traces match; unused selection section build removed).')
} else if (process.argv.includes('--print-snapshot')) {
  console.log(JSON.stringify(current, null, 2))
} else {
  assert.equal(current.bridges.audioWiring['generate-dispatch-invalid'].results[0].bridge, 'audioWiring')
  assert.equal(current.bridges.projectWiring['generate-dispatch-invalid'].results[0].bridge, 'projectWiring')
  console.log('Report bridge lifecycle regression passed (frozen state assertions; use --compare-before for snapshot comparison).')
}

'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const currentSourcePath = path.join(root, 'pages/projects/projects.js')
const beforeSourcePath = path.join(root, 'tmp/architecture-continuation-2026-10-25/before/pages/projects/projects.js')
const beforeOutputPath = path.join(root, 'tmp/architecture-continuation-2026-10-25/phase6-projects/before-output.json')
const benchmarkDirectory = path.join(root, 'tmp/architecture-continuation-2026-10-25/phase6-projects')
const FROZEN_OUTPUT_SHA256 = 'c0f99e0b8625322c08d056e48646ac7076e9c6957e0f13180f70e027c99b860e'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function makeProject(id, name, index = 0) {
  return {
    id,
    name,
    venueName: `地点 ${index + 1}`,
    updatedAt: 1700000000000 + index * 60000,
    wiringSchedule: { lines: Array.from({ length: index % 3 }, (_, lineIndex) => ({ id: `line-${index}-${lineIndex}` })) },
  }
}

function snapshot(projects, records = [], favorites = [], recoveryEntries = []) {
  return { ok: true, projects, records, favorites, recoveryEntries }
}

function makeLightingRows(rows, counter) {
  return rows.map((row) => {
    const item = { hasLighting: row.hasLighting, revision: row.revision }
    Object.defineProperty(item, 'id', {
      enumerable: true,
      get() {
        counter.lightingIdReads += 1
        return row.id
      },
    })
    return item
  })
}

function createFixtureEnvironment(sourcePath, fixture) {
  const counter = { lightingIdReads: 0, lightingCalls: 0, snapshotCalls: [], metadataCalls: [], vibrations: [] }
  const patches = []
  const payloadBytes = []
  const metadata = {
    spl: { label: '声压级计算', theme: 'blue' },
    gainStructure: { label: '增益结构', theme: 'purple' },
  }
  const records = {
    MODULES: { spl: {}, gainStructure: {} },
    getWorkspaceSnapshot(options) {
      counter.snapshotCalls.push(clone(options))
      return fixture.getSnapshot ? fixture.getSnapshot() : fixture.workspaceSnapshot
    },
    getModuleMetadata(key) {
      counter.metadataCalls.push(key)
      return metadata[key] || null
    },
    toggleFavoriteById() { return true },
    createProject() { return null },
  }
  const lighting = {
    getLightingContexts() {
      counter.lightingCalls += 1
      const result = fixture.getLighting ? fixture.getLighting() : fixture.lighting
      return result && result.ok ? { ...result, rows: makeLightingRows(result.rawRows || [], counter) } : result
    },
  }
  const haptics = { vibrate: (style) => counter.vibrations.push(style) }
  const sandbox = {
    Page(value) { sandbox.definition = value },
    require(specifier) {
      if (specifier === '../../utils/records') return records
      if (specifier === '../../utils/haptics') return haptics
      if (specifier === '../dmx-layout/lighting-workspace') return lighting
      throw new Error(`unexpected projects page dependency: ${specifier}`)
    },
    module: { exports: {} },
    exports: {},
  }
  const context = vm.createContext(sandbox)
  const source = fs.readFileSync(sourcePath, 'utf8')
  vm.runInContext(source, context, { filename: sourcePath, timeout: 10000 })
  assert.ok(sandbox.definition && sandbox.definition.data, `Page did not register from ${sourcePath}`)

  const page = {
    ...sandbox.definition,
    data: clone(sandbox.definition.data),
    setData(patch, callback) {
      patches.push(clone(patch))
      payloadBytes.push(Buffer.byteLength(JSON.stringify(patch), 'utf8'))
      Object.entries(patch).forEach(([rawPath, value]) => {
        const parts = rawPath.replace(/\[(\d+)\]/g, '.$1').split('.')
        const leaf = parts.pop()
        const target = parts.reduce((current, part) => {
          if (!current[part] || typeof current[part] !== 'object') current[part] = {}
          return current[part]
        }, this.data)
        target[leaf] = clone(value)
      })
      if (callback) callback.call(this)
    },
  }
  return { page, fixture, counter, patches, payloadBytes }
}

function capture(environment, returnValues) {
  const { page, counter, patches, payloadBytes } = environment
  return {
    output: {
      returnValues,
      patches,
      payloadBytes,
      data: {
        projects: clone(page.data.projects),
        favorites: clone(page.data.favorites),
        favoriteModules: clone(page.data.favoriteModules),
        recoveryCount: page.data.recoveryCount,
        workspaceError: page.data.workspaceError,
        lightingWarning: page.data.lightingWarning,
        tabIndex: page.data.tabIndex,
        projectFilter: page.data.projectFilter,
        favoriteFilter: page.data.favoriteFilter,
        searchText: page.data.searchText,
      },
      cachedProjects: clone(page._allProjects),
      cachedFavorites: clone(page._allFavorites),
      calls: {
        snapshot: counter.snapshotCalls,
        lighting: counter.lightingCalls,
        metadata: counter.metadataCalls,
        vibrations: counter.vibrations,
      },
    },
    metrics: {
      lightingIdReads: counter.lightingIdReads,
      lightingCalls: counter.lightingCalls,
      setDataPayloadBytes: payloadBytes.reduce((total, value) => total + value, 0),
    },
  }
}

function runEmptyCase(sourcePath) {
  const environment = createFixtureEnvironment(sourcePath, {
    workspaceSnapshot: snapshot([]),
    lighting: { ok: true, rawRows: [] },
  })
  const result = environment.page.refresh()
  return capture(environment, [result])
}

function runErrorCases(sourcePath) {
  const warning = createFixtureEnvironment(sourcePath, {
    workspaceSnapshot: snapshot([makeProject('warning-project', '灯位不可用', 0)]),
    lighting: { ok: false, error: 'lighting storage unavailable' },
  })
  const warningResult = warning.page.refresh()

  const readFailure = createFixtureEnvironment(sourcePath, {
    workspaceSnapshot: { ok: false, error: 'workspace storage unavailable' },
    lighting: { ok: true, rawRows: [{ id: 'unused', hasLighting: true, revision: 1 }] },
  })
  const failureResult = readFailure.page.refresh()
  return {
    warning: capture(warning, [warningResult]),
    readFailure: capture(readFailure, [failureResult]),
  }
}

function makeRegularFixture(lightingState) {
  const projects = [
    makeProject('p0', 'Room 0', 0),
    makeProject('p1', 'Room 1', 1),
    makeProject('p2', 'Room 2', 2),
    makeProject('p3', 'Room 3', 3),
    makeProject('p4', 'Room 4', 4),
    makeProject('p5', 'Room 5', 5),
  ]
  return {
    workspaceSnapshot: snapshot(projects, [
      { projectIds: ['p0'] },
      { projectIds: ['p2', 'p2', 'p3'] },
      { projectIds: ['p2'] },
    ], [{ id: 'favorite-1', module: 'spl', title: 'Room 2 calculation', summary: 'saved result', createdAt: 1700000200000 }], [1, 2]),
    getLighting: () => lightingState.current,
  }
}

function runFilteringAndMutationCase(sourcePath) {
  const lightingState = { current: null }
  const fixture = makeRegularFixture(lightingState)
  const initialRows = [
    { id: 'p1', hasLighting: true, revision: 0 },
    { id: 'p2', hasLighting: true, revision: 1 },
    { id: 'p3', hasLighting: false, revision: 4 },
    { id: 'p4', hasLighting: false, revision: 3 },
    { id: 'p4', hasLighting: true, revision: 8 },
    { id: 'p5', hasLighting: true, revision: '2' },
  ]
  lightingState.current = { ok: true, rawRows: initialRows }
  const environment = createFixtureEnvironment(sourcePath, fixture)
  const returns = [environment.page.refresh()]
  environment.page.onSearchInput({ detail: { value: 'Room 2' } })
  environment.page.onProjectFilterTap({ currentTarget: { dataset: { key: 'lighting' } } })
  environment.page.onFavoriteFilterTap({ currentTarget: { dataset: { key: 'spl' } } })
  environment.page.onTabTap({ currentTarget: { dataset: { index: 1 } } })
  lightingState.current = {
    ok: true,
    rawRows: [
      { id: 'p0', hasLighting: true, revision: 2 },
      { id: 'p2', hasLighting: true, revision: 1 },
      { id: 'p4', hasLighting: true, revision: 2 },
      { id: 'p4', hasLighting: false, revision: 9 },
      { id: 'p5', hasLighting: true, revision: 2 },
    ],
  }
  returns.push(environment.page.refresh({ forceRefresh: true }))
  return capture(environment, returns)
}

function makeLargeFixture(projectCount, lightingCount) {
  const projects = Array.from({ length: projectCount }, (_, index) => makeProject(`project-${index}`, `Project ${index}`, index))
  const records = Array.from({ length: projectCount * 4 }, (_, index) => ({
    projectIds: [`project-${index % projectCount}`],
  }))
  const rows = Array.from({ length: lightingCount }, (_, index) => ({
    id: `lighting-${index}`, hasLighting: true, revision: index + 1,
  }))
  return {
    projectCount,
    lightingCount,
    workspaceSnapshot: snapshot(projects, records),
    lighting: { ok: true, rawRows: rows },
  }
}

function runLargeCase(sourcePath, projectCount = 260, lightingCount = 800) {
  const environment = createFixtureEnvironment(sourcePath, makeLargeFixture(projectCount, lightingCount))
  const result = environment.page.refresh()
  const captured = capture(environment, [result])
  captured.metrics.projectCount = projectCount
  captured.metrics.lightingRowCount = lightingCount
  captured.metrics.fullScanExpectedReads = projectCount * lightingCount
  return captured
}

function runSuite(sourcePath) {
  return {
    empty: runEmptyCase(sourcePath),
    errors: runErrorCases(sourcePath),
    filteringAndMutation: runFilteringAndMutationCase(sourcePath),
    large: runLargeCase(sourcePath),
  }
}

function semanticOutput(suite) {
  return {
    empty: suite.empty.output,
    errors: {
      warning: suite.errors.warning.output,
      readFailure: suite.errors.readFailure.output,
    },
    filteringAndMutation: suite.filteringAndMutation.output,
    large: suite.large.output,
  }
}

function assertIndexComplexity(suite) {
  const { lightingIdReads, projectCount, lightingRowCount, fullScanExpectedReads } = suite.large.metrics
  assert.equal(lightingIdReads < fullScanExpectedReads, true,
    `lighting row id accesses should be below P*L (${lightingIdReads} vs ${fullScanExpectedReads})`)
  assert.equal(lightingIdReads <= lightingRowCount * 2, true,
    `lighting row id accesses should be O(L) (${lightingIdReads} for ${lightingRowCount} rows)`)
  assert.equal(projectCount, 260)
}

function median(values) {
  const ordered = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

function benchmark(sourcePath, label) {
  const sampleCount = 9
  const projectCount = 180
  const lightingCount = 600
  const coldSamplesMs = []
  let coldPayloadBytes = null
  for (let index = 0; index < sampleCount; index += 1) {
    const environment = createFixtureEnvironment(sourcePath, makeLargeFixture(projectCount, lightingCount))
    const started = process.hrtime.bigint()
    environment.page.refresh({ forceRefresh: true })
    coldSamplesMs.push(Number(process.hrtime.bigint() - started) / 1e6)
    coldPayloadBytes = environment.payloadBytes.reduce((sum, value) => sum + value, 0)
  }

  const hotEnvironment = createFixtureEnvironment(sourcePath, makeLargeFixture(projectCount, lightingCount))
  hotEnvironment.page.refresh({ forceRefresh: true })
  hotEnvironment.page.refresh({ forceRefresh: false })
  const hotSamplesMs = []
  const hotPayloadBytes = []
  for (let index = 0; index < sampleCount * 3; index += 1) {
    const started = process.hrtime.bigint()
    hotEnvironment.page.refresh({ forceRefresh: false })
    hotSamplesMs.push(Number(process.hrtime.bigint() - started) / 1e6)
    hotPayloadBytes.push(hotEnvironment.payloadBytes[hotEnvironment.payloadBytes.length - 1])
  }
  const result = {
    label: 'Node VM simulation of the real Page first/repeated refresh with fixture-backed APIs; not device cold start or storage cold read',
    source: path.relative(root, sourcePath),
    sampleCount,
    firstRefreshSampleCount: coldSamplesMs.length,
    repeatedRefreshSampleCount: hotSamplesMs.length,
    projectCount,
    lightingRowCount: lightingCount,
    firstRefreshMedianMs: median(coldSamplesMs),
    repeatedRefreshMedianMs: median(hotSamplesMs),
    firstRefreshSamplesMs: coldSamplesMs,
    repeatedRefreshSamplesMs: hotSamplesMs,
    firstRefreshSetDataPayloadBytes: coldPayloadBytes,
    repeatedRefreshSetDataPayloadBytes: median(hotPayloadBytes),
  }
  fs.mkdirSync(benchmarkDirectory, { recursive: true })
  const outputPath = path.join(benchmarkDirectory, `benchmark-${label}.json`)
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ ...result, output: path.relative(root, outputPath) }, null, 2)}\n`)
}

function main() {
  const benchmarkBefore = process.argv.includes('--benchmark-before')
  const benchmarkAfter = process.argv.includes('--benchmark')
  if (benchmarkBefore || benchmarkAfter) {
    benchmark(benchmarkBefore ? beforeSourcePath : currentSourcePath, benchmarkBefore ? 'before' : 'after')
    return
  }
  if (process.argv.includes('--capture-before')) {
    const beforeSuite = runSuite(beforeSourcePath)
    const beforeOutput = semanticOutput(beforeSuite)
    fs.mkdirSync(path.dirname(beforeOutputPath), { recursive: true })
    fs.writeFileSync(beforeOutputPath, `${JSON.stringify({ output: beforeOutput, metrics: beforeSuite }, null, 2)}\n`)
    process.stdout.write(`captured ${digest(beforeOutput)} to ${path.relative(root, beforeOutputPath)}\n`)
    return
  }

  const suite = runSuite(currentSourcePath)
  const output = semanticOutput(suite)
  const outputHash = digest(output)

  assertIndexComplexity(suite)
  if (process.argv.includes('--compare-before')) {
    const beforeSuite = runSuite(beforeSourcePath)
    assert.deepEqual(output, semanticOutput(beforeSuite), 'visible refresh output, setData patches, payload bytes, and API calls changed')
    assert.ok(beforeSuite.large.metrics.lightingIdReads > suite.large.metrics.lightingIdReads,
      `indexed lookup should inspect fewer row ids (${suite.large.metrics.lightingIdReads} after vs ${beforeSuite.large.metrics.lightingIdReads} before)`)
    assert.equal(beforeSuite.large.metrics.lightingIdReads, suite.large.metrics.fullScanExpectedReads,
      'before implementation should perform one full row scan per project when no id matches')
    assert.equal(suite.large.metrics.lightingIdReads <= suite.large.metrics.lightingRowCount * 2, true,
      'after implementation should inspect each row id at most twice while building the local Map')
    process.stdout.write(`PASS --compare-before output=${outputHash} idReads=${beforeSuite.large.metrics.lightingIdReads}->${suite.large.metrics.lightingIdReads}\n`)
    return
  }

  assert.equal(outputHash, FROZEN_OUTPUT_SHA256, `project list refresh output changed: ${outputHash}`)
  process.stdout.write(`PASS project list refresh output ${outputHash}; large id reads=${suite.large.metrics.lightingIdReads}\n`)
}

main()

'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const beforeRoot = path.join(root, 'tmp/architecture-continuation-2026-10-25/before')
const tracePath = path.join(root, 'tmp/architecture-continuation-2026-10-25/phase7-compile/before-entry-traces.json')
const helperPath = path.join(root, 'tests/helpers/dmx-compile.cjs')
const entryDirectories = [
  'dmx-ui-refactor-2026-10-18',
  'dmx-ui-refinements-2026-10-18',
  'dmx-ui-native-fixes-2026-10-18',
  'dmx-ui-round3-2026-10-18',
]
const nativeRuntimeByDirectory = {
  'dmx-ui-refactor-2026-10-18': 'NOT RUN',
  'dmx-ui-refinements-2026-10-18': 'NOT RUN',
  'dmx-ui-native-fixes-2026-10-18': 'See separate native evidence; compiler result alone does not verify runtime',
  'dmx-ui-round3-2026-10-18': 'NOT RUN',
}
const compileOutputRoot = 'tmp/architecture-continuation-2026-10-25/phase7-compile/contract'
const FIXED_NOW = '2026-10-25T12:34:56.000Z'
// Updated for app.json's Wi-Fi preloadRule; the before/current trace comparison is otherwise identical.
// Previous trace digest: 0a8eb40a2c876f59ea2afc7e66da2bd9ac0151055700facec649bbf19b1756f7
const FROZEN_TRACE_SHA256 = '1c3d8d27a747f8967d8c895b3b993bec3ec9bd8ffa3183194d0174e0a098ec0c'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalizeAuthorizedAnimationSource(relativePath, source) {
  const replaceExactlyOnce = (marker, replacement) => {
    const occurrences = source.split(marker).length - 1
    assert.equal(occurrences, 1, `${relativePath}: expected one authorized animation marker`)
    source = source.replace(marker, replacement)
  }

  if (relativePath === 'pages/dmx-address/dmx-address.wxml') {
    replaceExactlyOnce(
      `class="floating-backdrop {{floatingClosing ? 'floating-backdrop-closing' : ''}}"`,
      'class="floating-backdrop"',
    )
  } else if (relativePath === 'pages/dmx-address/dmx-address.wxss') {
    replaceExactlyOnce(
      '.floating-backdrop.floating-backdrop-closing{animation:backdrop-out .23s ease-in both}\n',
      '',
    )
    replaceExactlyOnce('@keyframes backdrop-out{from{opacity:1}to{opacity:0}}\n', '')
    replaceExactlyOnce(
      '.floating-backdrop,.floating-backdrop.floating-backdrop-closing,.floating-card,.fixture-card,.address-chip,.add-group-button',
      '.floating-backdrop,.floating-card,.fixture-card,.address-chip,.add-group-button',
    )
  }
  return source
}

function buildNormalizedHashMap(traces) {
  const normalizedHashes = new Map()
  const addFileHash = (relativePath) => {
    const contents = fs.readFileSync(path.join(root, relativePath))
    const rawHash = crypto.createHash('sha256').update(contents).digest('hex')
    const lfContents = contents.toString('utf8').replace(/\r\n?/g, '\n')
    const normalizedContents = normalizeAuthorizedAnimationSource(relativePath, lfContents)
    const normalizedHash = crypto.createHash('sha256').update(normalizedContents).digest('hex')
    const previous = normalizedHashes.get(rawHash)
    assert.ok(previous === undefined || previous === normalizedHash,
      `conflicting canonical hash for ${relativePath}`)
    normalizedHashes.set(rawHash, normalizedHash)
  }
  addFileHash('app.json')
  traces.forEach((trace) => Object.keys(trace.summary.sources).forEach(addFileHash))
  return normalizedHashes
}

function normalizeTraceForDigest(value, normalizedHashes) {
  const escapedRoot = JSON.stringify(root).slice(1, -1)
  const normalizeString = (text) => {
    let normalized = text
    normalizedHashes.forEach((canonicalHash, rawHash) => {
      normalized = normalized.split(rawHash).join(canonicalHash)
    })
    return normalized
      .split(escapedRoot).join('<CHECKOUT_ROOT>')
      .split(root).join('<CHECKOUT_ROOT>')
  }

  if (typeof value === 'string') return normalizeString(value)
  if (Array.isArray(value)) return value.map((item) => normalizeTraceForDigest(item, normalizedHashes))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      normalizeString(key), normalizeTraceForDigest(item, normalizedHashes),
    ]))
  }
  return value
}

function evaluateModule(context, source, filename, moduleRequire) {
  const wrapper = vm.runInContext(
    `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`,
    context,
    { filename, timeout: 10000 },
  )
  const module = { exports: {} }
  wrapper(module.exports, moduleRequire, module, filename, path.dirname(filename))
  return module.exports
}

function makeFixedDate() {
  const fixedMilliseconds = Date.parse(FIXED_NOW)
  return class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedMilliseconds])) }
    static now() { return fixedMilliseconds }
  }
}

function makeOutputOverride(directory, scenario) {
  return path.posix.join(compileOutputRoot, directory, scenario)
}

function runEntry({ directory, sourcePath, source, scenario, spawnMode, override }) {
  const entryPath = path.join(root, 'tests', directory, 'compile.cjs')
  const entryDirectory = path.dirname(entryPath)
  const projectRoot = path.resolve(entryDirectory, '../..')
  const writes = []
  const directories = []
  const spawnCalls = []
  const consoleCalls = []
  const processMock = {
    env: override ? { DMX_COMPILE_OUTPUT_DIR: override } : {},
    exitCode: undefined,
  }
  const fsMock = new Proxy(fs, {
    get(target, property) {
      if (property === 'mkdirSync') return (directoryPath, options) => {
        directories.push({ path: path.resolve(directoryPath), options: clone(options) })
      }
      if (property === 'writeFileSync') return (filePath, contents, options) => {
        writes.push({ path: path.resolve(filePath), contents: String(contents), options: clone(options) })
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const childProcessMock = {
    spawnSync(exe, args, options) {
      const call = { exe, args: Array.from(args), options: clone(options) }
      spawnCalls.push(call)
      const commandName = path.basename(exe, '.exe')
      if (spawnMode === 'missing-wcc' && commandName === 'wcc') {
        return { status: null, error: { message: 'spawnSync ENOENT' }, stdout: undefined, stderr: undefined }
      }
      if (spawnMode === 'nonzero-wcsc' && commandName === 'wcsc') {
        return { status: 7, error: undefined, stdout: 'wcsc stdout failure fixture', stderr: 'wcsc stderr failure fixture' }
      }
      return { status: 0, error: undefined, stdout: `${commandName} stdout fixture`, stderr: '' }
    },
  }
  const context = vm.createContext({
    Buffer,
    Date: makeFixedDate(),
    process: processMock,
    console: { log(value) { consoleCalls.push(String(value)) } },
  })
  const builtins = {
    'node:fs': fsMock,
    'node:path': path,
    'node:crypto': crypto,
    'node:child_process': childProcessMock,
  }
  const builtinRequire = (specifier) => {
    assert.ok(Object.prototype.hasOwnProperty.call(builtins, specifier), `unexpected compiler tool dependency: ${specifier}`)
    return builtins[specifier]
  }
  let helperExports = null
  const entryRequire = (specifier) => {
    if (specifier !== '../helpers/dmx-compile.cjs') return builtinRequire(specifier)
    if (!helperExports) {
      const helperSource = fs.readFileSync(helperPath, 'utf8')
      helperExports = evaluateModule(context, helperSource, helperPath, builtinRequire)
    }
    return helperExports
  }
  evaluateModule(context, source, entryPath, entryRequire)

  const compileWrite = writes.find((write) => path.basename(write.path) === 'compile.json')
  const summary = compileWrite ? JSON.parse(compileWrite.contents) : null
  const trace = {
    directory,
    scenario,
    spawnMode,
    override: override || null,
    projectRoot,
    exitCode: processMock.exitCode ?? null,
    spawnCalls,
    directories,
    writes,
    consoleCalls,
    summary,
  }
  return trace
}

function runSuite(sourceKind) {
  const traces = []
  for (const directory of entryDirectories) {
    const relative = path.join('tests', directory, 'compile.cjs')
    const sourcePath = sourceKind === 'before'
      ? path.join(beforeRoot, relative)
      : path.join(root, relative)
    const source = fs.readFileSync(sourcePath, 'utf8')
    const overrideName = makeOutputOverride(directory, 'override-success')
    traces.push(runEntry({ directory, sourcePath, source, scenario: 'default-success', spawnMode: 'success' }))
    traces.push(runEntry({ directory, sourcePath, source, scenario: 'override-success', spawnMode: 'success', override: overrideName }))
    traces.push(runEntry({
      directory, sourcePath, source, scenario: 'missing-wcc', spawnMode: 'missing-wcc',
      override: makeOutputOverride(directory, 'missing-wcc'),
    }))
    traces.push(runEntry({
      directory, sourcePath, source, scenario: 'nonzero-wcsc', spawnMode: 'nonzero-wcsc',
      override: makeOutputOverride(directory, 'nonzero-wcsc'),
    }))
  }
  return traces
}

function expectedDmxRoutes() {
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  return [...(appConfig.pages || []), ...(appConfig.subPackages || []).flatMap((pkg) =>
    (pkg.pages || []).map((page) => path.posix.join(pkg.root, page)))].filter((entry) => /^pages\/dmx-/.test(entry))
}

function verifyTrace(trace) {
  const nativeRuntime = nativeRuntimeByDirectory[trace.directory]
  const entryDirectory = path.join(root, 'tests', trace.directory)
  const projectRoot = path.resolve(entryDirectory, '../..')
  const output = trace.override
    ? path.resolve(projectRoot, trace.override)
    : path.join(entryDirectory, 'evidence/compile')
  const summary = trace.summary
  assert.ok(summary, `${trace.directory}/${trace.scenario}: compile summary should be written`)
  assert.deepEqual(Object.keys(summary), [
    'runAt', 'registeredDmxPages', 'appJsonSha256', 'officialSourceCompilation',
    'nativeRuntime', 'physicalDevice', 'sources', 'results',
  ])
  assert.equal(summary.runAt, FIXED_NOW)
  assert.deepEqual(summary.registeredDmxPages, expectedDmxRoutes())
  assert.equal(summary.appJsonSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'app.json'))).digest('hex'))
  assert.equal(summary.officialSourceCompilation, true)
  assert.equal(summary.nativeRuntime, nativeRuntime)
  assert.equal(summary.physicalDevice, 'NOT RUN')
  assert.equal(summary.results.length, 2)
  assert.deepEqual(trace.directories, [{ path: output, options: { recursive: true } }])
  assert.equal(trace.spawnCalls.length, 2, 'both compilers must run even if one fails')

  const [wcc, wcsc] = summary.results
  const expectedBinaryDirectory = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
  const wxmlOutput = path.join(output, 'wxml.compiled.txt')
  assert.equal(wcc.name, 'wcc')
  assert.equal(wcc.exe, path.join(expectedBinaryDirectory, 'wcc.exe'))
  assert.deepEqual(wcc.args.slice(0, 3), ['-d', '-o', wxmlOutput])
  assert.equal(wcsc.name, 'wcsc')
  assert.equal(wcsc.exe, path.join(expectedBinaryDirectory, 'wcsc.exe'))
  assert.deepEqual(wcsc.args.slice(0, 3), ['-js', '-pc', String(wcsc.args.length - 3)])
  assert.equal(Number(wcsc.args[2]), wcsc.args.length - 3)
  assert.ok(wcc.args.length > 3)
  assert.ok(wcsc.args.length > 3)
  assert.ok(wcc.args.slice(3).every((file) => file.endsWith('.wxml')))
  assert.ok(wcsc.args.slice(3).every((file) => file.endsWith('.wxss')))
  assert.ok(wcc.args.slice(3).every((file) => Object.hasOwn(summary.sources, file)))
  assert.ok(wcsc.args.slice(3).every((file) => Object.hasOwn(summary.sources, file)))
  for (const [file, expectedHash] of Object.entries(summary.sources)) {
    assert.equal(expectedHash, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), `${file} input hash changed`)
  }
  assert.ok(wcc.args.slice(3).some((file) => expectedDmxRoutes().some((route) => file === `${route}.wxml`)))
  assert.ok(wcsc.args.slice(3).some((file) => expectedDmxRoutes().some((route) => file === `${route}.wxss`)))

  trace.spawnCalls.forEach((call, index) => {
    const command = summary.results[index]
    assert.equal(call.exe, command.exe)
    assert.deepEqual(call.args, command.args)
    assert.deepEqual(call.options, {
      cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    })
  })

  const expectedWrites = [
    path.join(output, 'wcc.stdout.txt'), path.join(output, 'wcc.stderr.txt'),
    path.join(output, 'wcsc.stdout.txt'), path.join(output, 'wcsc.stderr.txt'),
    path.join(output, 'compile.json'),
  ]
  assert.deepEqual(trace.writes.map((write) => write.path), expectedWrites)
  assert.equal(trace.writes.find((write) => write.path.endsWith('compile.json')).contents, trace.consoleCalls[0])
  assert.equal(trace.consoleCalls.length, 1)
  assert.equal(trace.consoleCalls[0], JSON.stringify(summary, null, 2))

  if (trace.spawnMode === 'success') {
    assert.equal(trace.exitCode, null)
    assert.deepEqual(summary.results.map((result) => [result.exitCode, result.error, result.stdoutBytes]), [
      [0, null, Buffer.byteLength('wcc stdout fixture')],
      [0, null, Buffer.byteLength('wcsc stdout fixture')],
    ])
    assert.deepEqual(trace.writes.map((write) => write.contents), [
      'wcc stdout fixture', '', 'wcsc stdout fixture', '', trace.writes[4].contents,
    ])
  } else if (trace.spawnMode === 'missing-wcc') {
    assert.equal(trace.exitCode, 1)
    assert.deepEqual(summary.results.map((result) => [result.exitCode, result.error]), [
      [null, 'spawnSync ENOENT'], [0, null],
    ])
    assert.equal(trace.writes[0].contents, '')
    assert.equal(trace.writes[1].contents, '')
  } else {
    assert.equal(trace.exitCode, 1)
    assert.deepEqual(summary.results.map((result) => [result.exitCode, result.error, result.stderr]), [
      [0, null, ''], [7, null, 'wcsc stderr failure fixture'],
    ])
    assert.equal(trace.writes[2].contents, 'wcsc stdout failure fixture')
    assert.equal(trace.writes[3].contents, 'wcsc stderr failure fixture')
  }
}

function main() {
  if (process.argv.includes('--capture-before')) {
    const beforeTraces = runSuite('before')
    beforeTraces.forEach(verifyTrace)
    const beforeHash = digest(beforeTraces)
    fs.mkdirSync(path.dirname(tracePath), { recursive: true })
    fs.writeFileSync(tracePath, `${JSON.stringify(beforeTraces, null, 2)}\n`)
    process.stdout.write(`captured ${beforeHash} to ${path.relative(root, tracePath)}\n`)
    return
  }
  const traces = runSuite('current')
  traces.forEach(verifyTrace)
  const traceHash = digest(traces)
  if (process.argv.includes('--compare-before')) {
    const beforeTraces = runSuite('before')
    beforeTraces.forEach(verifyTrace)
    assert.deepEqual(traces, beforeTraces, 'compiler commands, summaries, output files, and exit codes changed from before')
    process.stdout.write(`PASS --compare-before ${traceHash}\n`)
    return
  }
  const normalizedHashes = buildNormalizedHashMap(traces)
  const normalizedTraceHash = digest(normalizeTraceForDigest(traces, normalizedHashes))
  assert.equal(normalizedTraceHash, FROZEN_TRACE_SHA256,
    `DMX compile entry contract changed: ${normalizedTraceHash}`)
  process.stdout.write(`PASS DMX compile entry contract ${normalizedTraceHash}\n`)
}

main()

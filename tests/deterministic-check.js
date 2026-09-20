'use strict'

const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const { createHarness } = require('./helpers/deterministic-harness')
const { safeValue } = require('./helpers/report-serialize')

const root = path.resolve(__dirname, '..')
const reportIndex = process.argv.indexOf('--report')
const reportPath = reportIndex >= 0 ? path.resolve(process.argv[reportIndex + 1] || '') : null
if (reportIndex >= 0 && !process.argv[reportIndex + 1]) {
  console.error('Usage: node tests/deterministic-check.js [--report <file>]')
  process.exit(2)
}
const workerFlag = '--deterministic-worker'
const nonzeroSelfTest = process.argv.includes('--self-test-nonzero')
if (!process.argv.includes(workerFlag) && !nonzeroSelfTest) {
  const allow = {}
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec']) if (process.env[name]) allow[name] = process.env[name]
  const guardPath = path.join(__dirname, 'helpers', 'offline-guard.js').replace(/\\/g, '/')
  const env = { ...allow, NODE_OPTIONS: `--require "${guardPath}"` }
  const args = [__filename, workerFlag, ...(reportPath ? ['--report', reportPath] : [])]
  const child = childProcess.spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] })
  if (child.stdout) process.stdout.write(child.stdout)
  if (child.stderr) process.stderr.write(child.stderr)
  process.exit(typeof child.status === 'number' ? child.status : 1)
}

const offlineGuard = require('./helpers/offline-guard')
const suites = [
  './deterministic/harness.suite',
  './deterministic/offline-release.suite',
  './deterministic/audio-math.suite',
  './deterministic/spatial-math.suite',
  './deterministic/page-consistency.suite',
]
const classifications = new Set(['implementation bug', 'engineering-rule ambiguity', 'test problem'])
const legacyPath = path.join(__dirname, 'release-check.js')
let legacy = { status: 'passed', exitCode: 0, output: '' }
if (!nonzeroSelfTest) {
  try {
    legacy.output = childProcess.execFileSync(process.execPath, [legacyPath], {
      cwd: root, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    legacy = { status: 'failed', exitCode: typeof error.status === 'number' ? error.status : 1, output: `${error.stdout || ''}${error.stderr || ''}`.trim() }
  }
}

const harness = createHarness()
if (nonzeroSelfTest) harness.test('intentional isolated runner failure', () => { const error = new Error('intentional self-test'); error.expected = 'nonzero process status'; error.actual = 'test case failure'; throw error }, {
  classification: 'test problem', basis: 'Self-test verifies that a failed deterministic case makes the runner exit nonzero.',
})
for (const suitePath of (nonzeroSelfTest ? [] : suites)) {
  let register
  try { register = require(suitePath) } catch (error) {
    harness.test(`load ${suitePath}`, () => { throw error }, {
      classification: 'test problem', basis: 'A deterministic suite must load successfully.', issue: 'Suite load failed.'
    })
    continue
  }
  try {
    register(harness)
  } catch (error) {
    harness.test(`register ${suitePath}`, () => { throw error }, {
      classification: 'test problem', basis: 'Suite registration must complete without throwing.', issue: 'Suite registration failed.'
    })
  }
}

async function main() {
  await harness.run()
  if (offlineGuard.attempts.length) harness.results.push({
    name: 'offline guard observed runtime network attempts',
    passed: false,
    metadata: {
      classification: 'implementation bug',
      basis: 'Runtime page behavior and deterministic tests must remain offline.',
      issue: `Blocked calls: ${offlineGuard.attempts.join(', ')}`,
    },
    error: new Error(`Blocked attempts were recorded even if application code caught them: ${offlineGuard.attempts.join(', ')}`),
  })
  const rows = harness.results.map(({ name, passed, metadata = {}, error }) => ({
    name,
    status: passed ? 'passed' : 'failed',
    classification: classifications.has(metadata.classification) ? metadata.classification : 'test problem',
    basis: metadata.basis,
    issue: metadata.issue || (passed ? null : 'Failure requires triage.'),
    error: error ? String(error.stack || error.message || error) : null,
    expected: error && Object.prototype.hasOwnProperty.call(error, 'expected') ? safeValue(error.expected) : null,
    actual: error && Object.prototype.hasOwnProperty.call(error, 'actual') ? safeValue(error.actual) : null,
  }))
  const failed = rows.filter((row) => row.status === 'failed')
  const totalFailures = failed.length + (legacy.status === 'failed' ? 1 : 0)
  const summary = {
    legacyReleaseCheck: {
      status: legacy.status,
      exitCode: legacy.exitCode,
      output: legacy.output,
      assertionCount: null,
      classification: legacy.status === 'failed' ? 'test problem' : null,
      basis: 'Existing release-check failures are classified as test problems until triaged.',
      issue: legacy.status === 'failed' ? 'Legacy baseline failed; inspect its captured output.' : null,
      expected: 'exit code 0 with no blocked network attempts',
      actual: `exit code ${legacy.exitCode}`,
      error: legacy.status === 'failed' ? legacy.output : null,
    },
    newSuiteCaseCount: rows.length,
    passedCaseCount: rows.length - failed.length,
    failedCaseCount: failed.length,
    totalFailureCount: totalFailures,
    results: rows,
  }
  console.log(`Legacy release check: ${legacy.status} (exit ${legacy.exitCode}; assertion count not separately instrumented).`)
  if (legacy.output) console.log(`Legacy output: ${legacy.output}`)
  console.log(`New deterministic cases: ${summary.passedCaseCount}/${summary.newSuiteCaseCount} passed.`)
  for (const row of failed) {
    console.error(`FAIL [${row.classification}] ${row.name}`)
    console.error(`  expected: ${printable(row.expected, '(see reason)')}`)
    console.error(`  actual: ${printable(row.actual, '(see reason)')}`)
    console.error(`  reason: ${row.error || row.issue}`)
  }
  if (legacy.status === 'failed') {
    console.error('FAIL [test problem] existing release-check.js (network denied)')
    console.error('  expected: exit code 0 with no blocked network attempts')
    console.error(`  actual: exit code ${legacy.exitCode}`)
    console.error(`  reason: ${legacy.output || 'no captured output'}`)
  }
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    console.log(`Machine-readable report: ${path.relative(root, reportPath)}`)
  }
  if (totalFailures) process.exitCode = 1
}

function printable(value, fallback) { return value === null || value === undefined ? fallback : typeof value === 'string' ? value : JSON.stringify(value) }

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 })

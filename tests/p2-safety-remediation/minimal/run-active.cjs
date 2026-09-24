'use strict'

const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const path = require('node:path')
const { repoRoot } = require('../../p2-safety/harness.cjs')
const pages = require('./page-behavior.cjs')
const led = require('./led-operation.cjs')
const camera = require('./camera-operation.cjs')
const cameraCard = require('./camera-confirmation-card.cjs')
const callbacks = require('./operation-callbacks.cjs')
const ledUnload = require('./led-unload-matrix.cjs')
const dmx = require('./dmx-operation.cjs')
const cameraOutput = require('./camera-output-boundaries.cjs')

const suites = []
function record(name, run, count) {
  try {
    const value = run()
    const checks = count(value)
    assert(Number.isInteger(checks) && checks > 0, `${name}: suite returned no check count`)
    suites.push({ name, status: 'passed', checks })
  } catch (error) {
    suites.push({ name, status: 'failed', checks: 1, error: String(error.stack || error) })
  }
}
function child(name, file) {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: repoRoot, encoding: 'utf8', timeout: 30000,
  })
  if (result.status !== 0) throw new Error(`${name} exit=${result.status}\n${result.stdout || ''}${result.stderr || ''}`)
  return result.stdout.trim()
}
function objectCount(value) { return Object.keys(value || {}).length }
function arrayCount(value) { return value.length }

record('Venue focused (V2-AUD-005/006/007)', pages.runVenueFocused, arrayCount)
record('Venue boundary/security', pages.runVenueBoundarySecurity, objectCount)
record('LED focused (LED-001/003/005/006)', led.runLedCases, arrayCount)
record('LED manual compatibility', led.runManualCompatibility, objectCount)
record('Camera operation and manual compatibility', camera.run, objectCount)
record('Camera confirmation-card', cameraCard.run, arrayCount)
record('Shared operation gate', () => child('gate', 'gate.cjs'), () => 1)
record('Shared operation callbacks', callbacks.run, objectCount)
record('LED unload lifecycle matrix', ledUnload.run, objectCount)
record('DMX-010 channel guide structured/manual', dmx.run, objectCount)
record('Camera output boundary callbacks', cameraOutput.run, objectCount)
record('Three blocked controls (DMX-004/006, PW-007)', pages.runControls, arrayCount)
record('Cross-page manual compatibility', pages.runManualCompatibility, objectCount)

const failedSuites = suites.filter((suite) => suite.status === 'failed')
const summary = {
  status: failedSuites.length ? 'failed' : 'passed',
  suiteCount: suites.length,
  passedChecks: suites.filter((suite) => suite.status === 'passed').reduce((sum, suite) => sum + suite.checks, 0),
  failedChecks: failedSuites.reduce((sum, suite) => sum + suite.checks, 0),
  suites,
  excluded: [
    { id: 'run-minimal.cjs', reason: 'historical runner retained unchanged; has three known Venue failures from obsolete semantic-key mapping and is not current DMX page-contract evidence' },
    { id: 'operation-inputs-unit.cjs', reason: 'historical test retained unchanged; targets the archived gate API and is not current gate evidence' },
  ],
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
if (failedSuites.length) process.exitCode = 1

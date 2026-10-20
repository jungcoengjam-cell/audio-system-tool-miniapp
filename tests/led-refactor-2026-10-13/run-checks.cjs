'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const targets = [
  ['led-first-use', 'tests/led-first-use-regression.js'],
  ['led-records', 'tests/led-records-regression.js'],
  ['led-audit', 'tests/audit-led-regression.js'],
  ['release-check', 'tests/release-check.js'],
]
const selected = new Set(process.argv.slice(2))
const cases = selected.size ? targets.filter(([name]) => selected.has(name)) : targets
if (!cases.length) throw new Error(`No matching checks: ${[...selected].join(', ')}`)

const runId = process.env.LED_QA_RUN_ID || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const outputRoot = path.join(__dirname, 'baseline', 'runs', runId)
fs.mkdirSync(outputRoot, { recursive: true })
const summary = {
  runId,
  startedAt: new Date().toISOString(),
  root,
  node: process.version,
  executable: process.execPath,
  cases: [],
}

function runOne([name, script]) {
  return new Promise((resolve) => {
    const stdoutPath = path.join(outputRoot, `${name}.stdout.txt`)
    const stderrPath = path.join(outputRoot, `${name}.stderr.txt`)
    const stdoutFile = fs.createWriteStream(stdoutPath)
    const stderrFile = fs.createWriteStream(stderrPath)
    const startedAt = new Date().toISOString()
    const started = Date.now()
    let stdoutTail = ''
    let stderrTail = ''
    process.stdout.write(`RUN ${name}: node ${script}\n`)
    const child = spawn(process.execPath, [script], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => { stdoutFile.write(chunk); stdoutTail = `${stdoutTail}${chunk}`.slice(-2000) })
    child.stderr.on('data', (chunk) => { stderrFile.write(chunk); stderrTail = `${stderrTail}${chunk}`.slice(-2000) })
    child.on('error', (error) => {
      stderrFile.end(`${error.stack || error}\n`)
      stdoutFile.end()
      finish(null, String(error.message || error))
    })
    child.on('close', (exitCode, signal) => {
      stdoutFile.end()
      stderrFile.end()
      finish(exitCode, null, signal)
    })
    function finish(exitCode, error, signal = null) {
      const item = {
        name, script, command: `node ${script}`, startedAt,
        finishedAt: new Date().toISOString(), durationMs: Date.now() - started,
        exitCode, signal, error, passed: exitCode === 0 && !error,
        stdoutPath: path.relative(root, stdoutPath).replace(/\\/g, '/'),
        stderrPath: path.relative(root, stderrPath).replace(/\\/g, '/'),
        stdoutTail, stderrTail,
      }
      summary.cases.push(item)
      summary.updatedAt = new Date().toISOString()
      fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
      process.stdout.write(`${item.passed ? 'PASS' : 'FAIL'} ${name} exit=${exitCode} durationMs=${item.durationMs}\n`)
      if (!item.passed && (stdoutTail || stderrTail)) process.stdout.write(`${stderrTail || stdoutTail}\n`)
      resolve(item)
    }
  })
}

async function main() {
  for (const item of cases) await runOne(item)
  summary.finishedAt = new Date().toISOString()
  summary.passed = summary.cases.every((item) => item.passed)
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  process.stdout.write(`RESULT ${summary.passed ? 'PASS' : 'FAIL'} ${path.relative(root, path.join(outputRoot, 'summary.json')).replace(/\\/g, '/')}\n`)
  if (!summary.passed) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})

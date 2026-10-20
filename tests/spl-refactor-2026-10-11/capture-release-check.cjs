'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const evidenceRoot = process.env.SPL_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refinement-20261011'
const label = process.argv[2] || 'final'

if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('label must contain only letters, digits, or hyphens')
fs.mkdirSync(evidenceRoot, { recursive: true })

const stdoutPath = path.join(evidenceRoot, `${label}-release-check.stdout.txt`)
const stderrPath = path.join(evidenceRoot, `${label}-release-check.stderr.txt`)
const resultPath = path.join(evidenceRoot, `${label}-release-check.json`)
fs.writeFileSync(stdoutPath, '')
fs.writeFileSync(stderrPath, '')

const startedAt = new Date().toISOString()
const child = spawn(process.execPath, [path.join(root, 'tests/release-check.js')], {
  cwd: root,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let policyMarkerSeen = false
let stdoutTail = ''
let stderrTail = ''

function forward(stream, destination, output, streamName) {
  stream.on('data', (chunk) => {
    fs.appendFileSync(destination, chunk)
    output.write(chunk)
    const previousTail = streamName === 'stdout' ? stdoutTail : stderrTail
    const sample = previousTail + chunk.toString('utf8')
    if (/setup refresh had errors/i.test(sample) && !policyMarkerSeen) {
      policyMarkerSeen = true
      process.stderr.write('\nPolicy marker detected; stopping the release check.\n')
      child.kill()
    }
    if (streamName === 'stdout') stdoutTail = sample.slice(-80)
    else stderrTail = sample.slice(-80)
  })
}

forward(child.stdout, stdoutPath, process.stdout, 'stdout')
forward(child.stderr, stderrPath, process.stderr, 'stderr')

child.on('error', (error) => {
  fs.writeFileSync(resultPath, JSON.stringify({
    startedAt,
    endedAt: new Date().toISOString(),
    command: `${process.execPath} tests/release-check.js`,
    error: error.message,
    policyMarkerSeen,
  }, null, 2) + '\n')
  process.exitCode = 1
})

child.on('close', (code, signal) => {
  const report = {
    startedAt,
    endedAt: new Date().toISOString(),
    command: `${process.execPath} tests/release-check.js`,
    exitCode: code,
    signal,
    policyMarkerSeen,
    stdoutPath,
    stderrPath,
  }
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2) + '\n')
  process.exitCode = policyMarkerSeen ? 130 : (code ?? 1)
  process.stdout.write(`\nRelease-check exit ${String(code)}; logs: ${evidenceRoot}\n`)
})

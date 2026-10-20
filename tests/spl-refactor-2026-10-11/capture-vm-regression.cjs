'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const evidenceRoot = process.env.SPL_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refinement-20261011'
const label = process.argv[2] || 'interim-current-source'
const selectedCases = process.argv[3] || ''
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('label must contain only letters, digits, or hyphens')
const outputRoot = path.join(evidenceRoot, 'vm', label)
fs.mkdirSync(outputRoot, { recursive: true })
const stdoutPath = path.join(outputRoot, 'stdout.txt')
const stderrPath = path.join(outputRoot, 'stderr.txt')
const summaryPath = path.join(outputRoot, 'summary.json')
fs.writeFileSync(stdoutPath, '')
fs.writeFileSync(stderrPath, '')

const startedAt = new Date().toISOString()
const child = spawn(process.execPath, [path.join(__dirname, 'vm-regression.cjs')], {
  cwd: root,
  env: { ...process.env, ...(selectedCases ? { SPL_VM_CASES: selectedCases } : {}) },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let markerSeen = false
let tail = ''

function capture(stream, destination, output) {
  stream.on('data', (chunk) => {
    fs.appendFileSync(destination, chunk)
    output.write(chunk)
    const sample = tail + chunk.toString('utf8')
    if (/setup refresh had errors/i.test(sample) && !markerSeen) {
      markerSeen = true
      process.stderr.write('\nPolicy marker detected; stopping this VM attempt.\n')
      child.kill()
    }
    tail = sample.slice(-96)
  })
}

capture(child.stdout, stdoutPath, process.stdout)
capture(child.stderr, stderrPath, process.stderr)
child.on('error', (error) => {
  fs.writeFileSync(summaryPath, JSON.stringify({
    label, startedAt, finishedAt: new Date().toISOString(), error: error.message, markerSeen,
    stdoutPath, stderrPath,
  }, null, 2) + '\n')
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  const summary = {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    command: 'node tests/spl-refactor-2026-10-11/vm-regression.cjs',
    exitCode: code,
    signal,
    markerSeen,
    stdoutPath,
    stderrPath,
    sourceStatus: 'interim; implementation has not sent interface-lock notice',
  }
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n')
  process.exitCode = markerSeen ? 130 : (code ?? 1)
})

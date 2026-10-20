'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const evidenceRoot = process.env.SPL_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refinement-20261011'
const label = process.argv[2] || 'final'
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('label must contain only letters, digits, or hyphens')
const outputRoot = path.join(evidenceRoot, 'node-tests', `related-${label}`)
const runs = [
  { id: 'gain-project-dialog', path: path.join(root, 'tests/gain-project-dialog-test.cjs') },
  { id: 'cable-refactor-storage', path: path.join(root, 'tests/cable-refactor-2026-10-09/run.cjs') },
]
fs.mkdirSync(outputRoot, { recursive: true })

function run(item) {
  return new Promise((resolve) => {
    const stdoutPath = path.join(outputRoot, `${item.id}.stdout.txt`)
    const stderrPath = path.join(outputRoot, `${item.id}.stderr.txt`)
    fs.writeFileSync(stdoutPath, '')
    fs.writeFileSync(stderrPath, '')
    const child = spawn(process.execPath, [item.path], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let markerSeen = false
    let tail = ''
    const capture = (stream, destination, output) => stream.on('data', (chunk) => {
      fs.appendFileSync(destination, chunk)
      output.write(chunk)
      const sample = tail + chunk.toString('utf8')
      if (/setup refresh had errors/i.test(sample) && !markerSeen) {
        markerSeen = true
        process.stderr.write('\nPolicy marker detected; stopping related regression execution.\n')
        child.kill()
      }
      tail = sample.slice(-96)
    })
    capture(child.stdout, stdoutPath, process.stdout)
    capture(child.stderr, stderrPath, process.stderr)
    child.on('error', (error) => resolve({ id: item.id, error: error.message, markerSeen, stdoutPath, stderrPath }))
    child.on('close', (exitCode, signal) => resolve({ id: item.id, exitCode, signal, markerSeen, stdoutPath, stderrPath }))
  })
}

async function main() {
  const results = []
  for (const item of runs) {
    const result = await run(item)
    results.push(result)
    if (result.markerSeen || result.error || result.exitCode !== 0) break
  }
  const summary = { label, finishedAt: new Date().toISOString(), results }
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  process.exitCode = results.some((item) => item.markerSeen) ? 130
    : results.some((item) => item.error || item.exitCode !== 0) ? 1 : 0
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const evidenceRoot = process.env.SPL_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refinement-20261011'
const label = process.argv[2] || 'metadata-interim'
const scripts = process.argv.slice(3)
const allowed = new Set(['gain-project-metadata-test.js', 'limiter-project-metadata-test.js'])
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('label must contain only letters, digits, or hyphens')
if (!scripts.length || scripts.some((item) => !allowed.has(item))) throw new Error('specify only allowed metadata test scripts')
const outputRoot = path.join(evidenceRoot, 'node-tests', label)
fs.mkdirSync(outputRoot, { recursive: true })
const startedAt = new Date().toISOString()
const results = []

function run(script) {
  return new Promise((resolve) => {
    const stdoutPath = path.join(outputRoot, `${script}.stdout.txt`)
    const stderrPath = path.join(outputRoot, `${script}.stderr.txt`)
    fs.writeFileSync(stdoutPath, '')
    fs.writeFileSync(stderrPath, '')
    const child = spawn(process.execPath, [path.join(root, 'tests', script)], {
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
        process.stderr.write('\nPolicy marker detected; stopping metadata test execution.\n')
        child.kill()
      }
      tail = sample.slice(-96)
    })
    capture(child.stdout, stdoutPath, process.stdout)
    capture(child.stderr, stderrPath, process.stderr)
    child.on('error', (error) => resolve({ script, error: error.message, markerSeen, stdoutPath, stderrPath }))
    child.on('close', (exitCode, signal) => resolve({ script, exitCode, signal, markerSeen, stdoutPath, stderrPath }))
  })
}

async function main() {
  for (const script of scripts) {
    const result = await run(script)
    results.push(result)
    if (result.markerSeen || result.exitCode !== 0) break
  }
  const summary = {
    label, startedAt, finishedAt: new Date().toISOString(),
    sourceStatus: 'records implementation snapshot; separate from final release-check',
    results,
  }
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  process.exitCode = results.some((result) => result.markerSeen) ? 130 : results.some((result) => result.exitCode !== 0 || result.error) ? 1 : 0
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + '\n')
  process.exitCode = 1
})

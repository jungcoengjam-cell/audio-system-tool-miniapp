'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(__dirname, 'connector-faces/evidence/current-dependencies')
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const files = ['utils/records.js', 'pages/audio-wiring/index.js', 'pages/audio-wiring/wiring-model.js', 'pages/audio-wiring/wiring-project.js']
const hashes = Object.fromEntries(files.map((file) => [file, hash(file)]))
const scripts = [
  'tests/audio-wiring-page-test.js', 'tests/result-project-target-test.js', 'tests/led-records-regression.js',
  'tests/audio-wiring-refactor-2026-10-15-direct/connector-faces/verify-requested-rules.cjs',
]
fs.mkdirSync(evidence, { recursive: true })
const results = scripts.map((script) => {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
  const filename = path.basename(script)
  fs.writeFileSync(path.join(evidence, filename + '.stdout.txt'), result.stdout || '')
  fs.writeFileSync(path.join(evidence, filename + '.stderr.txt'), result.stderr || '')
  const item = { script, exitCode: result.status, error: result.error?.message || null }
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${script}`)
  return item
})
const changedSources = files.filter((file) => hash(file) !== hashes[file])
const summary = { passed: results.every((item) => item.exitCode === 0) && !changedSources.length,
  scope: 'Revalidate only storage-dependent wiring behavior after the separately observed shared records changes; does not override full integration failures.', hashes, changedSources, results }
fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ passed: summary.passed, changedSources }, null, 2))
if (!summary.passed) process.exitCode = 1

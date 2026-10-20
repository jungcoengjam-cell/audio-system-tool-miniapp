'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, 'evidence/checks')
fs.mkdirSync(output, { recursive: true })
const tasks = [
  ['behavior', 'tests/control-protocol-refactor-2026-10-18/control-protocol-behavior-test.cjs'],
  ['development-preview', 'tests/control-protocol-development-preview-test.cjs'],
  ['official-compile', 'tests/control-protocol-refactor-2026-10-18/compile.cjs'],
  ['scope-and-records', 'tests/control-protocol-refactor-2026-10-18/audit-scope.cjs'],
  ['release-check', 'tests/release-check.js'],
]
const results = []
const focused = process.argv.includes('--focused')
const releaseOnly = process.argv.includes('--release-only')
const selectedTasks = releaseOnly ? tasks.filter(([name]) => name === 'release-check') : focused ? tasks.filter(([name]) => !['development-preview', 'release-check'].includes(name)) : tasks
if (focused) selectedTasks.unshift(['protocol-regression', 'tests/control-protocol-test.js'])
for (const [name, script] of selectedTasks) {
  const started = Date.now()
  const run = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  fs.writeFileSync(path.join(output, name + '.stdout.txt'), run.stdout || '')
  fs.writeFileSync(path.join(output, name + '.stderr.txt'), run.stderr || '')
  const result = { name, command: 'node ' + script, exitCode: run.status, durationMs: Date.now() - started, error: run.error?.message || null }
  results.push(result)
  console.log(JSON.stringify(result))
  if (run.status !== 0) console.log(((run.stderr || '') + '\n' + (run.stdout || '')).slice(-6000))
}
const sources = {}
for (const file of fs.readdirSync(path.join(root, 'pages/control-protocol'))) {
  const relative = 'pages/control-protocol/' + file
  if (fs.statSync(path.join(root, relative)).isFile()) sources[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex')
}
fs.writeFileSync(path.join(output, releaseOnly ? 'release-summary.json' : focused ? 'focused-summary.json' : 'summary.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results, sources }, null, 2))
if (results.some(result => result.exitCode !== 0 || result.error)) process.exitCode = 1

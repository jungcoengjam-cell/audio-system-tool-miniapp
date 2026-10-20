'use strict'
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../..'), base = 'tests/homepage-refactor-2026-10-18/'
const output = path.join(__dirname, 'evidence/final-tests')
const local = ['navigation-basis-behavior.cjs', 'main-package-dependencies.cjs', 'interior-view.test.cjs', 'interior-context.test.cjs', 'projects-context-lifecycle.cjs', 'projects-storage-recovery.cjs', 'storage-adversarial.cjs', 'report-completeness.cjs', 'report-runtime-seed.cjs', 'report-save-ownership.cjs', 'audit-scope.cjs', 'audit-tool-surface.cjs', 'release-controller-related-subset.cjs', 'compile.cjs']
const revised = ['settings-visibility.cjs', 'project-active-removal.test.cjs', 'source-integrity.cjs', 'basis-illustrations-test.cjs', 'report-snapshot-adapter.test.cjs', 'report-bridge.test.cjs', 'native-isolation-test.cjs']
const existing = ['result-project-target-test.js', 'limiter-project-metadata-test.js', 'gain-project-metadata-test.js', 'led-records-regression.js', 'project-wiring-entry-test.js', 'project-wiring-storage-test.js', 'calculation-boundary-regression.js', 'audio-wiring-page-test.js', 'camera-refactor-2026-10-11/camera-v3-controller-regression.cjs', 'camera-refactor-2026-10-11/camera-v4-record-metadata-regression.cjs', 'report-lifecycle-regression.js', 'release-check.js']
const targets = [...local.map(file => base + file), ...revised.map(file => base + 'revision-2/' + file), ...existing.map(file => 'tests/' + file)]
fs.mkdirSync(output, { recursive: true })
const previousPath = path.join(output, 'summary.json')
const only = process.argv.find(value => value.startsWith('--only='))?.slice(7).split(',').filter(Boolean)
const incremental = process.argv.includes('--retry-failed') || Boolean(only)
if (incremental && !fs.existsSync(previousPath)) throw new Error('Run the complete verification list once before an incremental recheck.')
const previous = incremental ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : null
const results = previous ? [...previous.results] : []
const selected = only ? targets.filter(file => only.some(part => path.basename(file).includes(part))) : previous ? targets.filter(file => previous.results.some(item => item.command === 'node ' + file && item.status === 'FAIL')) : targets
for (const file of selected) {
  const result = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  const name = path.basename(file).replace(/\.(cjs|js)$/, '')
  fs.writeFileSync(path.join(output, name + '.log'), (result.stdout || '') + (result.stderr || ''))
  const entry = { command: 'node ' + file, checkedAt: new Date().toISOString(), status: result.status === 0 ? 'PASS' : 'FAIL', exitCode: result.status, signal: result.signal, log: 'final-tests/' + name + '.log' }
  const index = results.findIndex(item => item.command === entry.command)
  if (index >= 0) results[index] = entry
  else results.push(entry)
}
const summary = { at: new Date().toISOString(), initialRunAt: previous?.initialRunAt || previous?.at || null, scope: 'Source, storage, renderer and official WXML/WXSS compiler checks. Browser workflows are separate evidence; no physical-device claim. Complete release stops at its first failure.', results }
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ total: results.length, passed: results.filter(item => item.status === 'PASS').length, failed: results.filter(item => item.status === 'FAIL') }, null, 2))
if (results.some(item => item.status === 'FAIL')) process.exitCode = 1

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'tests/release-check.js'), 'utf8')
const registered = source.match(/const auditRegressionScripts = \[([\s\S]*?)\]\.map/)
if (!registered) throw new Error('Release regression registration was not found')
const scripts = vm.runInNewContext(`[${registered[1]}]`).map((file) => `tests/${file}`)
const additional = process.argv.slice(2)
const out = path.join(__dirname, 'evidence', 'validation')
fs.mkdirSync(out, { recursive: true })
const hashes = Object.fromEntries(['pages/audio-wiring/index.js', 'pages/audio-wiring/index.wxml', 'pages/audio-wiring/index.wxss', 'utils/records.js'].map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
const results = []
for (const script of ['tests/release-check.js', ...scripts, ...additional]) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [script], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
  const name = script.replace(/[^a-zA-Z0-9.-]/g, '_')
  fs.writeFileSync(path.join(out, `${name}.stdout.txt`), result.stdout || '')
  fs.writeFileSync(path.join(out, `${name}.stderr.txt`), result.stderr || '')
  const item = { script, exitCode: result.status, error: result.error?.message || null, durationMs: Date.now() - started }
  results.push(item)
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ hashes, results, fullReleasePassed: results[0].exitCode === 0, registeredPassed: results.slice(1).every((item) => item.exitCode === 0) }, null, 2) + '\n')
  console.log(`${item.exitCode === 0 ? 'PASS' : 'FAIL'} ${script}${item.error ? `: ${item.error}` : ''}`)
}
const changedSources = Object.keys(hashes).filter((file) => hashes[file] !== crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'))
const summary = { hashes, changedSources, results, fullReleasePassed: results[0].exitCode === 0, registeredPassed: results.slice(1).every((item) => item.exitCode === 0) }
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ sourceStable: !changedSources.length, fullReleasePassed: summary.fullReleasePassed, registeredPassed: summary.registeredPassed, registeredCount: results.length - 1, failures: results.filter((item) => item.exitCode !== 0) }, null, 2))
if (!summary.fullReleasePassed || !summary.registeredPassed || changedSources.length) process.exitCode = 1

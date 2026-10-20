'use strict'

// The live integration compares repeated builds of an entire checkout. Freeze
// a disposable source copy so unrelated concurrent writes cannot invalidate
// its determinism assertion. This never modifies a production source or gate.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const snapshot = path.join(__dirname, 'frozen-preview-source')
if (fs.existsSync(snapshot)) throw new Error('Frozen evidence already exists; refusing to overwrite it')
fs.mkdirSync(snapshot, { recursive: true })
for (const directory of ['assets', 'data', 'pages', 'styles', 'templates', 'utils']) {
  if (fs.existsSync(path.join(root, directory))) fs.cpSync(path.join(root, directory), path.join(snapshot, directory), { recursive: true })
}
for (const file of ['app.js', 'app.json', 'app.wxss', 'theme.json', 'sitemap.json', 'project.config.json']) fs.copyFileSync(path.join(root, file), path.join(snapshot, file))
fs.mkdirSync(path.join(snapshot, 'tests'), { recursive: true })
for (const file of ['control-protocol-development-preview-test.cjs', 'build-control-protocol-development-preview.cjs', 'control-protocol-package-gate.js']) fs.copyFileSync(path.join(root, 'tests', file), path.join(snapshot, 'tests', file))
fs.cpSync(path.join(root, 'tests/fixtures/control-protocol'), path.join(snapshot, 'tests/fixtures/control-protocol'), { recursive: true })
function protocolHashes(base) {
  const hashes = {}
  function collect(relative) {
    const absolute = path.join(base, relative)
    if (fs.statSync(absolute).isDirectory()) for (const file of fs.readdirSync(absolute)) collect(path.posix.join(relative, file))
    else hashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  }
  collect('pages/control-protocol')
  return hashes
}
const sources = protocolHashes(root)
assert.deepEqual(protocolHashes(snapshot), sources, 'Frozen protocol sources must match final production exactly')
const started = Date.now()
const result = spawnSync(process.execPath, ['tests/control-protocol-development-preview-test.cjs'], { cwd: snapshot, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const output = path.join(__dirname, 'evidence/checks')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'frozen-development-preview.stdout.txt'), result.stdout || '')
fs.writeFileSync(path.join(output, 'frozen-development-preview.stderr.txt'), result.stderr || '')
const summary = { checkedAt: new Date().toISOString(), command: 'node tests/control-protocol-development-preview-test.cjs', source: 'immutable copy of current sources', snapshot, durationMs: Date.now() - started, exitCode: result.status, error: result.error?.message || null, sources, finalProtocolSourcesStillMatch: JSON.stringify(protocolHashes(root)) === JSON.stringify(sources), liveWorkspaceDeterminism: 'NOT CERTIFIED during concurrent homepage implementation' }
fs.writeFileSync(path.join(output, 'frozen-development-preview.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ exitCode: summary.exitCode, durationMs: summary.durationMs, finalProtocolSourcesStillMatch: summary.finalProtocolSourcesStillMatch, error: summary.error }))
if (result.status !== 0) console.log(((result.stderr || '') + '\n' + (result.stdout || '')).slice(-2000))
if (result.status !== 0 || !summary.finalProtocolSourcesStillMatch) process.exitCode = 1

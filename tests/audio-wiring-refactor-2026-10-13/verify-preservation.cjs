'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'before/source-hashes.json'), 'utf8'))
const allowed = new Set(['pages/audio-wiring/index.js', 'pages/audio-wiring/index.wxml', 'pages/audio-wiring/index.wxss', 'utils/records.js', 'README.md', 'tests/audio-wiring-page-test.js', 'tests/release-check.js',
  'tests/led-records-regression.js', 'tests/report-canvas-equivalence.js', 'tests/report-canvas-equivalence.fixture.json'])
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
for (const file of ['tests/led-records-regression.js', 'tests/report-canvas-equivalence.js', 'tests/report-canvas-equivalence.fixture.json']) {
  before[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'before', file))).digest('hex')
}
const changed = [], missing = [], currentHashes = {}
for (const [file, hash] of Object.entries(before)) {
  if (!fs.existsSync(path.join(root, file))) { missing.push(file); continue }
  currentHashes[file] = digest(file)
  if (currentHashes[file] !== hash) changed.push(file)
}
const unexpected = changed.filter((file) => !allowed.has(file))
const invariants = ['pages/audio-wiring/wiring-model.js', 'pages/audio-wiring/wiring-renderer.js']
const oldFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'before/tests/report-canvas-equivalence.fixture.json'), 'utf8'))
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/report-canvas-equivalence.fixture.json'), 'utf8'))
const fixtureScopePreserved = JSON.stringify(oldFixture.sourceHashes) === JSON.stringify(fixture.sourceHashes)
  && JSON.stringify(oldFixture.scenarios.filter((item) => item.kind !== 'project')) === JSON.stringify(fixture.scenarios.filter((item) => item.kind !== 'project'))
const summary = { capturedAt: new Date().toISOString(), baselineCount: Object.keys(before).length, changed, missing, unexpected, fixtureScopePreserved,
  corePreserved: invariants.every((file) => currentHashes[file] === before[file]), currentHashes,
  passed: !missing.length && !unexpected.length && fixtureScopePreserved && invariants.every((file) => currentHashes[file] === before[file]) }
const out = path.join(__dirname, 'evidence'); fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'preservation-audit.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ passed: summary.passed, baselineCount: summary.baselineCount, changed, unexpected, missing, corePreserved: summary.corePreserved, fixtureScopePreserved }, null, 2))
if (!summary.passed) process.exitCode = 1

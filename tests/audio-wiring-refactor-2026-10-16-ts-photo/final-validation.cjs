'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const out = path.join(__dirname, 'evidence/final-validation')
const evidence = path.join(__dirname, 'connector-faces/evidence')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const files = ['index.js', 'index.wxml', 'index.wxss', 'wiring-model.js', 'wiring-renderer.js', 'wiring-display.js', 'wiring-photos.js', 'wiring-project.js'].map(file => 'pages/audio-wiring/' + file)
files.push('utils/records.js')
const hashes = Object.fromEntries(files.map(file => [file, hash(file)]))
const checks = ['controller-export/summary.json', 'official-compile/summary.json', 'solder-routing.json', 'ts-photo.json', 'page-canvas/summary.json'].map(file => {
  const value = JSON.parse(fs.readFileSync(path.join(evidence, file), 'utf8'))
  assert(value.passed)
  for (const [source, digest] of Object.entries(value.hashes)) assert.equal(hash(source), digest, file + ': source drift')
  return { file, passed: true, verifiedCurrentSourceHashes: true }
})
const scripts = ['tests/audio-wiring-model-test.js', 'tests/audio-wiring-renderer-test.js', 'tests/audio-wiring-page-test.js', 'tests/release-check.js']
fs.mkdirSync(out, { recursive: true })
const results = []
for (const script of scripts) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
  const name = path.basename(script)
  fs.writeFileSync(path.join(out, name + '.stdout.txt'), result.stdout || '')
  fs.writeFileSync(path.join(out, name + '.stderr.txt'), result.stderr || '')
  results.push({ script, exitCode: result.status, error: result.error?.message || null })
  console.log((result.status === 0 ? 'PASS ' : 'FAIL ') + script)
}
const changedSources = files.filter(file => hashes[file] !== hash(file))
const featurePassed = !changedSources.length && results.slice(0, -1).every(item => item.exitCode === 0)
const summary = { featurePassed, fullReleasePassed: results.at(-1).exitCode === 0, scope: 'TS solder photograph, all 63 unchanged wiring models, 21 affected routing plans, 26 production image exports, and official static compile. Native phone not verified.', hashes, changedSources, checks, results }
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ featurePassed, fullReleasePassed: summary.fullReleasePassed, changedSources, failures: results.filter(item => item.exitCode !== 0) }, null, 2))
if (!featurePassed || !summary.fullReleasePassed) process.exitCode = 1

'use strict'

// Freeze the current effective project for the official private WeChat preview.
// This script creates a fresh copy and never changes source routing or build settings.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const output = 'C:/Users/wxx/.codex/visualizations/2026/10/13/01a1358a-7055-7400-8ad9-c1650746cffa/phone-preview-20261015-audio-wiring-direct'
const stage = path.join(output, 'project')
const evidence = path.join(output, 'evidence')
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const ignored = (file) => (config.packOptions?.ignore || []).some((rule) => rule.type === 'folder'
  ? file === rule.value || file.startsWith(`${rule.value}/`) : file === rule.value)
const included = (file) => (config.packOptions?.include || []).some((rule) => rule.type === 'folder'
  ? file === rule.value || file.startsWith(`${rule.value}/`) : file === rule.value)
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const sourceHashes = {}, stageHashes = {}
assert(!fs.existsSync(stage), 'Use a fresh staging folder; do not overwrite a previously issued QR snapshot')
fs.mkdirSync(evidence, { recursive: true })
function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const relative = prefix + entry.name
    const sourceFile = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(sourceFile, `${relative}/`); continue }
    if (ignored(relative) && !included(relative)) continue
    const target = path.join(stage, relative)
    const bytes = fs.readFileSync(sourceFile)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
    sourceHashes[relative] = sha(bytes)
    stageHashes[relative] = sha(fs.readFileSync(target))
    assert.equal(stageHashes[relative], sourceHashes[relative], `Copy changed ${relative}`)
  }
}
walk(root)
const sourceApp = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const stagedApp = JSON.parse(fs.readFileSync(path.join(stage, 'app.json'), 'utf8'))
assert.deepEqual(stagedApp, sourceApp)
const routes = [
  ...stagedApp.pages,
  ...(stagedApp.subPackages || []).flatMap((group) => group.pages.map((page) => `${group.root}/${page}`)),
]
assert(routes.includes('pages/audio-wiring/index'))
for (const route of routes) for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
  assert(fs.existsSync(path.join(stage, route + extension)), `Missing route file: ${route + extension}`)
}
const copied = Object.keys(sourceHashes)
const changedDuringCopy = copied.filter((file) => sha(fs.readFileSync(path.join(root, file))) !== sourceHashes[file])
assert.deepEqual(changedDuringCopy, [], 'Source changed during freezing; create a new preview snapshot')
fs.writeFileSync(path.join(evidence, 'source-hashes.json'), JSON.stringify(sourceHashes, null, 2) + '\n')
fs.writeFileSync(path.join(evidence, 'stage-hashes.json'), JSON.stringify(stageHashes, null, 2) + '\n')
const summary = { passed: true, root, stage, files: copied.length, routes: routes.length, appConfigUnchanged: true, sourceChangesDuringCopy: changedDuringCopy,
  scope: 'Byte-identical current effective project; no app manifest or source changes; private preview only.' }
fs.writeFileSync(path.join(evidence, 'copy-verification.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))

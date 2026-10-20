'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const out = path.join(__dirname, 'baseline')
if (fs.existsSync(out)) throw new Error('Baseline already captured')
fs.mkdirSync(out, { recursive: true })
const targets = ['README.md', 'docs/audio-wiring-method.md',
  ...['index.js', 'index.wxml', 'index.wxss', 'wiring-model.js', 'wiring-renderer.js', 'wiring-display.js', 'wiring-photos.js', 'wiring-project.js'].map(name => 'pages/audio-wiring/' + name),
  ...['model', 'renderer', 'page'].map(name => 'tests/audio-wiring-' + name + '-test.js')]
for (const relative of targets) {
  const destination = path.join(out, relative)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(path.join(root, relative), destination)
}
const hashes = {}
function scan(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) scan(file)
    else hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
  }
}
for (const relative of ['pages', 'utils', 'data', 'templates', 'assets']) scan(relative)
for (const relative of ['app.js', 'app.json', 'app.wxss', 'project.config.json', 'project.private.config.json']) {
  if (fs.existsSync(path.join(root, relative))) hashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex')
}
fs.writeFileSync(path.join(out, 'source-hashes.json'), JSON.stringify(hashes, null, 2) + '\n')
const api = require(path.join(root, 'pages/audio-wiring/wiring-model'))
const plans = {}
for (const output of api.OUTPUT_OPTIONS) for (const input of api.INPUT_OPTIONS) {
  plans[output.id + '>' + input.id] = api.getWiringModel(output.id, input.id)
}
fs.writeFileSync(path.join(out, 'models.json'), JSON.stringify(plans, null, 2) + '\n')
console.log(JSON.stringify({ frozenRuntimeFiles: Object.keys(hashes).length, savedFiles: targets.length, savedPlans: Object.keys(plans).length }))

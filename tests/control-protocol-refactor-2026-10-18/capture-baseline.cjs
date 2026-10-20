'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const destination = path.join(__dirname, 'baseline')
if (fs.existsSync(path.join(destination, 'manifest.json'))) throw new Error('Baseline already exists; refusing to overwrite it')
fs.mkdirSync(destination, { recursive: true })
const hashes = {}
function collect(relative) {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) return
  const stat = fs.lstatSync(absolute)
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolute)) collect(path.posix.join(relative, name))
  } else if (stat.isFile()) {
    hashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  }
}
for (const entry of ['pages', 'utils', 'data', 'styles', 'templates', 'assets', 'app.js', 'app.json', 'app.wxss', 'theme.json', 'project.config.json', 'project.private.config.json']) collect(entry)
for (const name of fs.readdirSync(path.join(root, 'pages/control-protocol'))) {
  if (!/\.(js|wxml|wxss|json)$/.test(name)) continue
  fs.mkdirSync(path.join(destination, 'pages/control-protocol'), { recursive: true })
  fs.copyFileSync(path.join(root, 'pages/control-protocol', name), path.join(destination, 'pages/control-protocol', name))
}
for (const name of ['control-protocol-test.js', 'control-protocol-development-preview-test.cjs', 'release-check.js']) {
  fs.mkdirSync(path.join(destination, 'tests'), { recursive: true })
  fs.copyFileSync(path.join(root, 'tests', name), path.join(destination, 'tests', name))
}
const { catalog, CATEGORIES } = require('../../pages/control-protocol/catalog')
const references = catalog.referenceManuals.map(reference => ({
  id: reference.id,
  sourceTitle: reference.sourceTitle,
  documentVersion: reference.documentVersion,
  applicabilityNote: reference.applicabilityNote,
  photo: reference.photo,
  manual: reference.manual,
}))
const commandCount = references.reduce((count, reference) => count + reference.manual.transports.reduce((sum, mode) => sum + mode.commands.length, 0), 0)
fs.writeFileSync(path.join(destination, 'records.json'), JSON.stringify({ CATEGORIES, references }, null, 2))
fs.writeFileSync(path.join(destination, 'git-status.txt'), spawnSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout)
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), hashes, commandCount }, null, 2))
console.log(JSON.stringify({ sourceFiles: Object.keys(hashes).length, referenceCount: references.length, commandCount, destination }))

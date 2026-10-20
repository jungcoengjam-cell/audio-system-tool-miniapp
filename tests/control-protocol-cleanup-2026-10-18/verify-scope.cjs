'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline/manifest.json')))
const allowed = new Set(['detail.js', 'detail.wxml', 'detail.wxss'].map(file => 'pages/control-protocol/' + file))
const changed = [], outsideChanges = [], protectedFiles = []
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
for (const [file, before] of Object.entries(baseline.hashes)) {
  const current = hash(fs.readFileSync(path.join(root, file)))
  if (file.startsWith('pages/control-protocol/')) {
    if (current !== before) {
      assert(allowed.has(file), 'Protected protocol file changed: ' + file)
      changed.push(file)
    } else protectedFiles.push(file)
  } else if (current !== before) outsideChanges.push(file)
}
const original = fs.readFileSync(path.join(__dirname, 'baseline/pages/control-protocol/detail.js'), 'utf8')
const script = fs.readFileSync(path.join(root, 'pages/control-protocol/detail.js'), 'utf8')
const frameHelpers = source => source.slice(source.indexOf('function normalizeDeviceMac('), source.indexOf('function decorateManualCommands('))
assert.equal(frameHelpers(script), frameHelpers(original), 'Existing MAC validation and frame transformation must remain identical')
const { catalog, CATEGORIES } = require('../../pages/control-protocol/catalog')
assert.deepEqual({ CATEGORIES, references: catalog.referenceManuals }, JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline/records.json'))))
const commandCount = catalog.referenceManuals.reduce((sum, ref) => sum + ref.manual.transports.reduce((total, transport) => total + transport.commands.length, 0), 0)
assert.equal(commandCount, 204)
const template = fs.readFileSync(path.join(root, 'pages/control-protocol/detail.wxml'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'pages/control-protocol/detail.wxss'), 'utf8')
for (const removed of ['info-sheet', 'info-button', 'openInfoSheet', 'reference-mark', 'transport-note', 'read-only-note', 'material-status']) assert(!template.includes(removed), 'Obsolete UI: ' + removed)
assert(!script.includes('openInfoSheet'))
assert(!script.includes("openOverlay('info')"))
assert(!styles.includes('.info-'))
const result = { checkedAt: new Date().toISOString(), protocolScope: 'PASS', changed, protectedFiles, outsideChanges, categories: CATEGORIES.length, commandCount, exactRecordsUnchanged: true, macFrameHelpersIdentical: true, wholeWorkspace: 'NOT CERTIFIED; local UI follow-up only' }
fs.mkdirSync(path.join(__dirname, 'evidence'), { recursive: true })
fs.writeFileSync(path.join(__dirname, 'evidence/scope.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))

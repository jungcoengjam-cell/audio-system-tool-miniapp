'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, 'baseline')
if (fs.existsSync(output)) throw Error('Cleanup baseline already exists; refusing to overwrite')
const hashes = {}
function capture(relative) {
  const source = path.join(root, relative)
  const stat = fs.statSync(source)
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(source)) capture(path.posix.join(relative, name))
    return
  }
  const bytes = fs.readFileSync(source)
  const target = path.join(output, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, bytes)
  hashes[relative] = crypto.createHash('sha256').update(bytes).digest('hex')
}
capture('pages/control-protocol')
for (const file of ['tests/control-protocol-test.js', 'tests/control-protocol-development-preview-test.cjs', 'tests/control-protocol-refactor-2026-10-18/control-protocol-behavior-test.cjs', 'tests/release-check.js', 'utils/preferences.js']) capture(file)
const { catalog, CATEGORIES } = require('../../pages/control-protocol/catalog')
const records = { CATEGORIES, references: catalog.referenceManuals }
fs.writeFileSync(path.join(output, 'records.json'), JSON.stringify(records, null, 2))
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), hashes }, null, 2))
console.log('Cleanup baseline saved: ' + Object.keys(hashes).length + ' files')

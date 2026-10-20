'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const root = path.resolve(__dirname, '../../..')
const baseline = require('./baseline/hashes.json')
const permitted = new Set(['utils/records.js', 'utils/result-record-actions.js'])
const files = Object.keys(baseline).filter(file => /^(utils|data)\//.test(file) && !permitted.has(file))
const changed = files.filter(file => {
  const target = path.join(root, file)
  return !fs.existsSync(target) || crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== baseline[file]
})
const result = { checkedAt: new Date().toISOString(), baseline: 'revision-2/baseline/hashes.json', checkedFiles: files.length, allowedExistingChanges: [...permitted], changed, scope: 'Existing utils and data files only; new presentation and preference helpers are reviewed separately.' }
fs.mkdirSync(path.join(__dirname, 'evidence'), { recursive: true })
fs.writeFileSync(path.join(__dirname, 'evidence/source-integrity.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (changed.length) process.exitCode = 1

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const before = JSON.parse(fs.readFileSync(path.join(__dirname,'baseline/hashes.json'),'utf8').replace(/^\uFEFF/,''))
const changed = [], missing = []
for (const [relative, expected] of Object.entries(before)) {
  const file = path.join(root,relative)
  if (!fs.existsSync(file)) { missing.push(relative); continue }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (actual.toLowerCase() !== expected.toLowerCase()) changed.push(relative.replaceAll('\\','/'))
}
const algorithmOrProductChanges = changed.filter(file=>file.startsWith('data/') || file.startsWith('utils/') && !['utils/records.js','utils/result-record-actions.js'].includes(file))
const report = { checkedAt:new Date().toISOString(), baselineFiles:Object.keys(before).length, changed, missing, algorithmOrProductChanges, preservesBaseline:missing.length===0 && algorithmOrProductChanges.length===0 }
fs.mkdirSync(path.join(__dirname,'evidence'),{recursive:true})
fs.writeFileSync(path.join(__dirname,'evidence/scope-audit.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
if (!report.preservesBaseline) process.exitCode=1

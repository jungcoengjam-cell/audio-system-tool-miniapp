'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync('pages/spl/spl.wxml', 'utf8')
const evidenceDir = 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refactor-20261011/release-check/legacy-spl-binding-v1'
fs.mkdirSync(evidenceDir, { recursive: true })
try {
  assert(source.includes('bindtap="generateResultReportImage"')
    && source.includes('canvas-id="resultReportCanvas"'),
  'legacy SPL page contract expected an inline generateResultReportImage binding and report canvas')
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify({ status: 'passed-unexpectedly' }, null, 2) + '\n')
} catch (error) {
  fs.writeFileSync(path.join(evidenceDir, 'assertion.stderr.txt'), `${error.stack}\n`)
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify({
    status: 'failed-as-expected-before-approved-contract-update',
    assertion: error.message,
  }, null, 2) + '\n')
  process.stderr.write(`${error.stack}\n`)
  process.exitCode = 1
}

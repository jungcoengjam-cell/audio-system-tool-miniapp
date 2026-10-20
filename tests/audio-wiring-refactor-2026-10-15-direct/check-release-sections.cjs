'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'tests/release-check.js')
const baseline = process.argv.includes('--before')
const source = fs.readFileSync(baseline ? path.join(__dirname, 'before/tests/release-check.js') : file, 'utf8')
const start = source.search(/\r?\ncheckSyntax\(\)\r?\nchildProcess\.execFileSync/)
if (start < 0) throw new Error('Release entry point not found')
const sections = ['checkSharedResultReportPreviewTemplate', 'checkProjectReportPlan', 'checkPageControllers', 'checkHapticFeedback', 'checkReportImageActions']
const loaded = new Module(file, module); loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file))
loaded._compile(source.slice(0, start) + `\nmodule.exports={${sections.join(',')}}\n`, file)
const results = []
for (const name of sections) {
  try { loaded.exports[name](); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, passed: false, error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`) }
}
const out = path.join(__dirname, 'evidence'); fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, baseline ? 'release-sections-before.json' : 'release-sections.json'), JSON.stringify({ baseline, scope: 'Independent selected release sections; does not waive package gates or claim full release-check passed', results }, null, 2) + '\n')
if (results.some((item) => !item.passed)) process.exitCode = 1

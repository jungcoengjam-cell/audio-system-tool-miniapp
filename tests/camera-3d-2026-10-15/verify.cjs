const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const results = []
const tests = [
  ['geometry', 'tests/camera-3d-2026-10-15/geometry-regression.cjs'],
  ['history-and-cache', 'tests/camera-3d-2026-10-15/lifecycle-regression.cjs'],
  ['first-use', 'tests/camera-first-use-regression.js'],
  ['calculation-boundary', 'tests/calculation-boundary-regression.js'],
  ['report-lifecycle', 'tests/report-lifecycle-regression.js'],
  ['camera-actions', 'tests/camera-refactor-2026-10-11/camera-v4-actions-regression.cjs'],
  ['record-metadata', 'tests/camera-refactor-2026-10-11/camera-v4-record-metadata-regression.cjs'],
  ['official-compile', 'tests/camera-3d-2026-10-15/compile.cjs'],
  ['release-check', 'tests/release-check.js'],
]
for (const [name, script] of tests) {
  const started = Date.now()
  const run = spawnSync(process.execPath, [script], { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const output = (run.stdout || '') + (run.stderr || '')
  fs.writeFileSync(path.join(__dirname, `evidence/final-${name}.log`), output)
  results.push({ name, script, status: run.status, durationMs: Date.now() - started,
    ...(name === 'release-check' ? { baselineAlsoFailed: true, baselineLog: 'evidence/release-before.log' } : {}) })
  console.log(`${name}: ${run.status === 0 ? 'PASS' : 'FAIL'} (${Date.now() - started} ms)`)
}
fs.writeFileSync(path.join(__dirname, 'evidence/final-verification.json'), JSON.stringify(results, null, 2))
if (results.some((item) => item.status !== 0)) process.exitCode = 1

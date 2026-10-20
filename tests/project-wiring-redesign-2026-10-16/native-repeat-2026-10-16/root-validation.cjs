const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../..')
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sources = ['index.js', 'index.wxml', 'index.wxss', 'workspace-ui.js', 'workspace.wxml', 'workspace.wxss', 'workspace-header.wxml', 'workspace-model.js', 'report.js'].map(file => 'pages/project-wiring/' + file)
const manifest = () => Object.fromEntries(sources.map(file => [file, sha(path.join(root, file))]))
const tests = [
  ['--check', 'pages/project-wiring/index.js'], ['--check', 'pages/project-wiring/workspace-ui.js'], ['--check', 'pages/project-wiring/report.js'],
  ['tests/project-wiring-entry-test.js'], ['tests/project-wiring-keyboard-test.js'], ['tests/project-wiring-page-test.js'],
  ['tests/project-wiring-report-footer-test.cjs'], ['tests/project-wiring-workspace-report-test.js'], ['tests/project-wiring-report-test.js'],
  ['tests/project-wiring-model-test.js'], ['tests/project-wiring-storage-test.js'], ['tests/project-wiring-workspace-model-test.js'],
  ['tests/project-wiring-devices-test.js'], ['tests/project-wiring-deletion-test.js'], ['tests/project-wiring-deletion-storage-test.js'],
  ['tests/project-wiring-native-interactions-test.cjs'], ['tests/native-repeat-2026-10-16/delete-route.test.cjs'],
  ['tests/native-repeat-2026-10-16/action-touch-interaction.test.cjs'], ['tests/report-lifecycle-regression.js'],
]
const auditOnly = process.argv.includes('--audit-only')
const result = auditOnly ? JSON.parse(fs.readFileSync(path.join(__dirname, 'root-validation.json'), 'utf8')) : { startedAt: new Date().toISOString(), before: manifest(), checks: [] }
const logs = path.join(__dirname, 'root-validation-logs')
fs.mkdirSync(logs, { recursive: true })
for (const [index, args] of (auditOnly ? [] : tests).entries()) {
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120000 })
  const file = `${String(index + 1).padStart(2, '0')}-${path.basename(args.at(-1))}.txt`
  fs.writeFileSync(path.join(logs, file), (run.stdout || '') + (run.stderr || '') + (run.error ? '\n' + run.error.message : ''))
  const item = { args, exitCode: run.status, signal: run.signal, error: run.error && run.error.message, log: 'root-validation-logs/' + file }
  result.checks.push(item)
  console.log((run.status === 0 ? 'PASS ' : 'FAIL ') + args.join(' '))
}
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'before/protected.json'), 'utf8'))
result.protectedFiles = baseline.map(item => ({ path: path.relative(root, item.Path).replaceAll('\\', '/'), before: item.Hash.toLowerCase(), after: sha(item.Path) }))
result.protectedUnchanged = result.protectedFiles.every(item => item.before === item.after)
const authorized = {
  'pages/project-wiring/index.js': '7cf714f18abefa34f9f48bbfacd650c0d5174adc78bf8fedbaf3d549524a2695',
  'pages/project-wiring/index.wxss': '100d987e92ba48aee31aac936173ba42efa6404ff980774cf7c438924efb2aa7',
  'pages/project-wiring/report.js': result.before['pages/project-wiring/report.js'],
}
result.authorizedInventoryChanges = result.protectedFiles.filter(item => item.before !== item.after && authorized[item.path] === item.after)
result.unexpectedInventoryChanges = result.protectedFiles.filter(item => item.before !== item.after && authorized[item.path] !== item.after)
result.businessAndUnrelatedUnchanged = result.unexpectedInventoryChanges.length === 0
result.after = manifest()
result.sourceStable = JSON.stringify(result.before) === JSON.stringify(result.after)
result.finishedAt = new Date().toISOString()
result.pass = result.checks.every(item => item.exitCode === 0) && result.sourceStable && result.businessAndUnrelatedUnchanged
fs.writeFileSync(path.join(__dirname, 'root-validation.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ pass: result.pass, sourceStable: result.sourceStable, businessAndUnrelatedUnchanged: result.businessAndUnrelatedUnchanged, baselineInventoryCount: baseline.length, unchanged: result.protectedFiles.filter(item => item.before === item.after).length, authorizedChanges: result.authorizedInventoryChanges.length, unexpectedChanges: result.unexpectedInventoryChanges.length }))
process.exitCode = result.pass ? 0 : 1

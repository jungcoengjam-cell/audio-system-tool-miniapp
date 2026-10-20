'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../../..')
const qaHost = 'C:/Users/wxx/.codex/visualizations/2026/10/18/01a14dd7-7462-7bc1-a9ac-b00cd5523d7b'
const evidence = path.join(qaHost, 'homepage-native-evidence')
const read = name => {
  const raw = fs.readFileSync(path.join(evidence, name + '.json'), 'utf8')
  return JSON.parse(raw.slice(raw.indexOf('{')))
}
const runtime = read('revision2-final-system-info').result.systemInfo.result
assert.equal(runtime.platform, 'devtools')
const run1 = read('revision2-native-settle-final-run1-result').result.result.result.pages
const run2 = read('revision2-native-settle-final-run2-result').result.result.result
const coldRuns = [run1, run2].map((pages, index) => {
  assert.equal(pages.length, 2)
  const report = pages.find(page => page.route === 'pages/records/report')
  assert.equal(report.mode, 'preview')
  assert.equal(report.pageCount, 13)
  return { run: index + 1, pages, rawEvidence: path.join(evidence, `revision2-native-settle-final-run${index + 1}-result.json`) }
})
assert.deepEqual(run2[1].bridgeKeys, ['audioWiring', 'projectWiring'])
assert.equal(run2[1].selectedCount, 11)
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const productionCopies = ['pages/records/report.js', 'pages/audio-wiring/report-bridge.js', 'pages/project-wiring/report-bridge.js'].map(file => {
  const source = hash(path.join(root, file)), native = hash(path.join(qaHost, 'homepage-native-qa', file))
  assert.equal(native, source)
  return { file, sha256: source }
})
const tools = name => read(name).result.result.result[0].toolIds
assert.equal(tools('revision2-native-settings-hidden-result').length, 9)
assert.deepEqual(tools('revision2-native-settings-hidden-persisted'), tools('revision2-native-settings-hidden-result'))
assert.equal(tools('revision2-native-settings-restored-result').length, 10)
const projectState = read('revision2-native-valid-projects-result').result.result.result[0]
assert.equal(projectState.lightingWarning, '')
assert.equal(projectState.projects[0].recordCount, 8)
assert.equal(projectState.projects[0].wiringCount, 2)
const browser = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence/report-bridges/summary.json')))
const summary = { checkedAt: new Date().toISOString(), scope: 'Actual WeChat DevTools runtime; not a physical phone.', runtime, sourceHash: browser.sourceHash, productionCopies, coldRuns, reportImages: 'native-report-images/manifest.json', visibility: { hidden: 9, persistedAfterRecompile: 9, restored: 10, method: 'native switch change event; real isolated wx storage' }, projectState, screenshotsRoot: evidence, physicalPhone: 'Not verified; user connection requested, automatic remote call timed out.' }
fs.writeFileSync(path.join(__dirname, 'evidence/native-summary.json'), JSON.stringify(summary, null, 2))
console.log('Native evidence checks passed: two clean 13-page runs, exact production copies, persistent tool visibility; phone remains unverified.')

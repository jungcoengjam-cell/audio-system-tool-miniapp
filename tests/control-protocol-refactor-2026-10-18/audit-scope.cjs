'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline/manifest.json')))
const changed = [], missing = [], unexpected = []
const allowed = new Set(['index.js', 'index.wxml', 'index.wxss', 'index.json', 'detail.js', 'detail.wxml', 'detail.wxss', 'detail.json'].map(file => 'pages/control-protocol/' + file))
// The app confirms an independently authorized task is actively editing these
// exact DMX files in the same checkout. Record their hashes separately; never
// revert them, count them as this implementation, or claim a stable workspace.
const concurrentEvidence = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence/concurrent-thread.json')))
assert.equal(concurrentEvidence.threadId, '01a14ae2-45ed-76d1-aeba-1959deacbdd4')
assert.equal(path.resolve(concurrentEvidence.cwd), root)
const concurrentPaths = new Set([
  'pages/dmx-address/dmx-address.js', 'pages/dmx-address/dmx-address.wxml', 'pages/dmx-address/dmx-address.wxss',
  'pages/dmx-layout/dmx-layout.wxml', 'pages/dmx-layout/dmx-layout.wxss', 'pages/dmx-layout/page-factory.js',
  'pages/dmx-layout-landscape/dmx-layout-landscape.wxml', 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss',
])
const homepageEvidence = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence/concurrent-homepage-thread.json')))
assert.equal(homepageEvidence.threadId, '01a14dd7-7462-7bc1-a9ac-b00cd5523d7b')
assert.equal(path.resolve(homepageEvidence.cwd), root)
const homepageConcurrentPaths = new Set([
  'pages/basis/detail.js', 'pages/basis/detail.json', 'pages/basis/detail.wxml', 'pages/basis/detail.wxss',
  'pages/records/report-actions.js', 'pages/records/report-model.js', 'pages/records/report-renderer.js',
  'pages/records/report.js', 'pages/records/report.json', 'pages/records/report.wxml', 'pages/records/report.wxss',
  'pages/settings/settings.js', 'pages/settings/settings.json', 'pages/settings/settings.wxml', 'pages/settings/settings.wxss',
  'utils/primary-navigation.js', 'utils/result-record-context.js', 'utils/tool-registry.js', 'styles/homepage.wxss',
  'assets/home/basis-tab-selected.png', 'assets/home/basis-tab.png',
  'pages/index/index.js', 'pages/index/index.wxml', 'pages/index/index.wxss',
  'pages/tools/tools.js', 'pages/tools/tools.wxml', 'pages/tools/tools.wxss',
  'utils/records.js', 'app.js', 'app.json', 'theme.json',
])
const concurrentChanged = []
const added = []
function inspectAdded(relative) {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) return
  const stat = fs.lstatSync(absolute)
  if (stat.isDirectory()) {
    for (const file of fs.readdirSync(absolute)) inspectAdded(path.posix.join(relative, file))
  } else if (stat.isFile() && !Object.hasOwn(baseline.hashes, relative)) {
    if (relative === 'pages/control-protocol/viewer-state.js') added.push(relative)
    else if (homepageConcurrentPaths.has(relative)) concurrentChanged.push({ file: relative, baselineSha256: null, observedSha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), modifiedAt: stat.mtime.toISOString(), taskId: homepageEvidence.threadId })
    else unexpected.push(relative)
  }
}
for (const directory of ['pages', 'utils', 'data', 'styles', 'templates', 'assets']) inspectAdded(directory)
for (const [file, hash] of Object.entries(baseline.hashes)) {
  const current = path.join(root, file)
  if (!fs.existsSync(current)) { missing.push(file); continue }
  const currentHash = crypto.createHash('sha256').update(fs.readFileSync(current)).digest('hex')
  if (currentHash !== hash) {
    if (allowed.has(file)) changed.push(file)
    else if (concurrentPaths.has(file)) concurrentChanged.push({ file, baselineSha256: hash, observedSha256: currentHash, modifiedAt: fs.statSync(current).mtime.toISOString() })
    else if (homepageConcurrentPaths.has(file)) concurrentChanged.push({ file, baselineSha256: hash, observedSha256: currentHash, modifiedAt: fs.statSync(current).mtime.toISOString(), taskId: homepageEvidence.threadId })
    else unexpected.push(file)
  }
}
const { catalog, CATEGORIES } = require('../../pages/control-protocol/catalog')
const records = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline/records.json')))
const references = catalog.referenceManuals.map(reference => ({ id: reference.id, sourceTitle: reference.sourceTitle, documentVersion: reference.documentVersion, applicabilityNote: reference.applicabilityNote, photo: reference.photo, manual: reference.manual }))
assert.deepEqual({ CATEGORIES, references }, records, 'All stored commands, metadata, source notes and photo records must remain exact')
// A protocol-only task cannot certify the live whole checkout while two other
// owner-authorized implementations are still writing it. Never extend a
// blanket allowlist to hide that drift: keep every outside path and hash in
// the evidence, and assert only the feature's protected source/asset boundary.
assert.deepEqual(missing.filter(file => file.startsWith('pages/control-protocol/')), [], 'No protocol baseline source or asset may disappear')
assert.deepEqual(unexpected.filter(file => file.startsWith('pages/control-protocol/')), [], 'No unplanned protocol source or asset may change')
const calculationFiles = ['utils/camera-fov.js', 'utils/camera-framing.js', 'utils/cable.js', 'utils/dmx-address.js', 'utils/gain-structure.js', 'utils/led-screen.js', 'utils/limiter.js', 'utils/spl.js']
for (const file of calculationFiles) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), baseline.hashes[file], 'Numeric calculation baseline changed: ' + file)
const unclassifiedOutsideChanges = unexpected.map(file => ({ file, baselineSha256: baseline.hashes[file] || null, observedSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString() }))
const result = { auditedAt: new Date().toISOString(), protocolScope: 'PASS', wholeWorkspaceStable: concurrentChanged.length === 0 && unexpected.length === 0 && missing.length === 0, wholeWorkspaceScope: 'NOT CERTIFIED during concurrent implementation; outside changes listed without passing or reverting them', baselineProductionFiles: Object.keys(baseline.hashes).length, changed, added, missing, unclassifiedOutsideChanges, concurrentChanged, concurrentTasks: [concurrentEvidence, homepageEvidence], newAllowedModule: fs.existsSync(path.join(root, 'pages/control-protocol/viewer-state.js')), referenceCount: references.length, commandCount: baseline.commandCount, exactStoredRecordsUnchanged: true, numericCalculationSourcesUnchanged: true }
fs.mkdirSync(path.join(__dirname, 'evidence'), { recursive: true })
fs.writeFileSync(path.join(__dirname, 'evidence/scope.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))

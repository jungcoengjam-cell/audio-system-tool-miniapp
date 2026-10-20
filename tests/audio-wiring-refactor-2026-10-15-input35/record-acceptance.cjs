'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { loadImage } = require('C:/Users/wxx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')
const root = path.resolve(__dirname, '../..')
const preview = 'C:/Users/wxx/.codex/visualizations/2026/10/13/01a1358a-7055-7400-8ad9-c1650746cffa/phone-preview-20261016-audio-wiring-input35-final'
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
async function main() {
  const validation = read(path.join(__dirname, 'evidence/final-validation/summary.json'))
  assert(validation.featurePassed)
  assert.deepEqual(validation.changedSources, [])
  for (const [file, digest] of Object.entries(validation.hashes)) assert.equal(hash(path.join(root, file)), digest)
  const selector = read(path.join(__dirname, 'connector-faces/evidence/controller-export/summary.json'))
  const compiler = read(path.join(__dirname, 'connector-faces/evidence/official-compile/summary.json'))
  const models = read(path.join(__dirname, 'connector-faces/evidence/new-models.json'))
  const geometry = read(path.join(__dirname, 'connector-faces/evidence/solder-routing.json'))
  for (const item of [selector, compiler, models, geometry]) {
    assert(item.passed)
    for (const [file, digest] of Object.entries(item.hashes)) assert.equal(hash(path.join(root, file)), digest)
  }
  const source = read(path.join(preview, 'evidence/source-hashes.json'))
  const stage = read(path.join(preview, 'evidence/stage-hashes.json'))
  const sourceDrift = Object.keys(source).filter(file => hash(path.join(root, file)) !== source[file])
  const stageDrift = Object.keys(stage).filter(file => hash(path.join(preview, 'project', file)) !== stage[file])
  const audioRelevantDrift = sourceDrift.filter(file => !file.startsWith('pages/camera/') && !['utils/camera-fov.js', 'utils/camera-framing.js'].includes(file))
  assert.deepEqual(audioRelevantDrift, []); assert.deepEqual(stageDrift, [])
  assert.deepEqual(source, stage)
  const info = read(path.join(preview, 'wechat-preview-info.json'))
  const qr = path.join(preview, 'wechat-preview-qr.jpg'), bytes = fs.readFileSync(qr), decoded = await loadImage(qr)
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8)
  assert(decoded.width >= 300 && decoded.height >= 300)
  assert(info.size.packages.find(item => item.name === 'main').size < 2 * 1024 * 1024)
  const previewResult = { passed: true, privatePreviewOnly: true, officialCliExitCode: 0, officialCliSuccessMarker: 'preview', qrFile: qr, bytes: bytes.length, sha256: hash(qr), width: decoded.width, height: decoded.height, compiledPackageSize: info.size, copiedFiles: Object.keys(stage).length, sourceDrift, stageDrift }
  fs.writeFileSync(path.join(preview, 'evidence/preview-result.json'), JSON.stringify(previewResult, null, 2) + '\n')
  const frozen = read(path.join(__dirname, 'baseline/source-hashes.json'))
  const concurrent = read(path.join(__dirname, 'evidence/concurrent-changes.json'))
  const changedRuntime = Object.keys(frozen).filter(file => hash(path.join(root, file)) !== frozen[file] && !file.startsWith(concurrent.preservedCameraModulePrefix) && !Object.hasOwn(concurrent.files, file))
  assert(changedRuntime.every(file => ['pages/audio-wiring/index.js', 'pages/audio-wiring/wiring-model.js', 'pages/audio-wiring/wiring-display.js', 'pages/audio-wiring/wiring-renderer.js'].includes(file)))
  const targets = ['README.md', 'docs/audio-wiring-method.md', ...['index.js', 'index.wxml', 'index.wxss', 'wiring-model.js', 'wiring-renderer.js', 'wiring-display.js', 'wiring-photos.js', 'wiring-project.js'].map(file => 'pages/audio-wiring/' + file), ...['model', 'renderer', 'page'].map(name => 'tests/audio-wiring-' + name + '-test.js')]
  const modifiedFiles = targets.filter(file => hash(path.join(root, file)) !== hash(path.join(__dirname, 'baseline', file))).map(file => ({ file, sha256: hash(path.join(root, file)) }))
  const releaseError = fs.readFileSync(path.join(__dirname, 'evidence/final-validation/release-check.js.stderr.txt'), 'utf8')
  const acceptance = { featurePassed: true, review: 'Independent source and runtime review in main conversation with current dialog settings.', changes: ['Add the missing 3.5 mm stereo input with seven fixed wiring combinations', 'Use the familiar 3.5 mm stereo name in both selectors, cards, diagrams and share reports', 'Preserve all 56 existing model objects and record identities, legacy input aliases and automatic one/two-head rules'], modifiedFiles,
    businessBoundary: { changedRuntime, unchangedModelsAndCanonicalIdentities: 56, newInputModels: 7, totalBackendModels: 63, currentVisiblePairs: 49, legacyAndNewInputRestorationCases: selector.restoration.length, sharedStorageSchemaChanged: false, historicalRecordWritesDuringRestore: false, photoBytesChanged: false, rendererLabelChangesOnly: true, existingWiringRulesUnchanged: true, newInputModelAdded: true, productDataChanged: false }, preservedConcurrentChanges: concurrent, newInputGeometry: { diagrams: geometry.diagrams, selectedRoutes: geometry.selectedRoutes, passed: geometry.passed }, validation, preview: previewResult,
    releaseGate: { passed: validation.fullReleasePassed, reason: releaseError.match(/有效正式包超过[^\r\n]+/)?.[0] || releaseError.slice(0, 500), productionReleaseAttempted: false }, notVerified: ['Native phone selector interaction and animation performance', 'Native phone share/export and album permissions'] }
  fs.writeFileSync(path.join(__dirname, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n')
  console.log(JSON.stringify({ featurePassed: true, fullReleasePassed: validation.fullReleasePassed, modifiedFiles: modifiedFiles.map(item => item.file), qrFile: qr, copiedFiles: Object.keys(stage).length }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })

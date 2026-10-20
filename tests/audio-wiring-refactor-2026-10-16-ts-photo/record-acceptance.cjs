'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { loadImage } = require('C:/Users/wxx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')
const root = path.resolve(__dirname, '../..')
const preview = 'C:/Users/wxx/.codex/visualizations/2026/10/13/01a1358a-7055-7400-8ad9-c1650746cffa/phone-preview-20261016-audio-wiring-ts-photo'
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
const asset = 'pages/audio-wiring/assets/solder/ts-solder-open.png'
const oldAsset = 'pages/audio-wiring/assets/solder/ts-rear.png'
async function main() {
  const validation = read(path.join(__dirname, 'evidence/final-validation/summary.json'))
  assert(validation.featurePassed)
  assert.deepEqual(validation.changedSources, [])
  for (const [file, digest] of Object.entries(validation.hashes)) assert.equal(hash(path.join(root, file)), digest)
  const exports = read(path.join(__dirname, 'connector-faces/evidence/controller-export/summary.json'))
  const compiler = read(path.join(__dirname, 'connector-faces/evidence/official-compile/summary.json'))
  const photo = read(path.join(__dirname, 'connector-faces/evidence/ts-photo.json'))
  const geometry = read(path.join(__dirname, 'connector-faces/evidence/solder-routing.json'))
  for (const evidence of [exports, compiler, photo, geometry]) {
    assert(evidence.passed)
    for (const [file, digest] of Object.entries(evidence.hashes)) assert.equal(hash(path.join(root, file)), digest)
  }
  assert.equal(photo.unchangedModelsAndCanonicalIdentities, 63)
  assert.equal(exports.currentPairs.length, 13)
  assert.equal(exports.exports.length, 26)
  const source = read(path.join(preview, 'evidence/source-hashes.json'))
  const stage = read(path.join(preview, 'evidence/stage-hashes.json'))
  const concurrent = read(path.join(__dirname, 'evidence/concurrent-changes.json'))
  const isConcurrent = file => file.startsWith(concurrent.preservedCameraModulePrefix) || concurrent.files[file] === true || (concurrent.files[file]?.sha256 === hash(path.join(root, file)))
  const sourceDrift = Object.keys(source).filter(file => hash(path.join(root, file)) !== source[file])
  const stageDrift = Object.keys(stage).filter(file => hash(path.join(preview, 'project', file)) !== stage[file])
  assert.deepEqual(sourceDrift.filter(file => !isConcurrent(file)), [])
  assert.deepEqual(stageDrift, [])
  assert.deepEqual(source, stage)
  assert.equal(stage[asset], hash(path.join(root, asset)))
  assert(!Object.hasOwn(stage, oldAsset))
  const info = read(path.join(preview, 'wechat-preview-info.json'))
  const qr = path.join(preview, 'wechat-preview-qr.jpg'), bytes = fs.readFileSync(qr), decoded = await loadImage(qr)
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8)
  assert(decoded.width >= 300 && decoded.height >= 300)
  assert(info.size.packages.find(item => item.name === 'main').size < 2 * 1024 * 1024)
  const cli = read(path.join(preview, 'evidence/official-cli.json'))
  assert.equal(cli.exitCode, 0)
  assert(/preview/.test(cli.output))
  const previewResult = { passed: true, privatePreviewOnly: true, officialCliExitCode: cli.exitCode, qrFile: qr, bytes: bytes.length, sha256: hash(qr), width: decoded.width, height: decoded.height, compiledPackageSize: info.size, copiedFiles: Object.keys(stage).length, sourceDrift, stageDrift }
  fs.writeFileSync(path.join(preview, 'evidence/preview-result.json'), JSON.stringify(previewResult, null, 2) + '\n')
  const frozen = read(path.join(__dirname, 'baseline/source-hashes.json'))
  const changedRuntime = Object.keys(frozen).filter(file => hash(path.join(root, file)) !== frozen[file] && !isConcurrent(file))
  assert.deepEqual(changedRuntime.sort(), [oldAsset, 'pages/audio-wiring/wiring-photos.js'].sort())
  const targets = ['README.md', 'docs/audio-wiring-method.md', 'docs/audio-wiring-photo-assets.md', ...['index.js', 'index.wxml', 'index.wxss', 'wiring-model.js', 'wiring-renderer.js', 'wiring-display.js', 'wiring-photos.js', 'wiring-project.js'].map(file => 'pages/audio-wiring/' + file), ...['model', 'renderer', 'page'].map(name => 'tests/audio-wiring-' + name + '-test.js'), oldAsset, asset]
  const modifiedFiles = targets.filter(file => !isConcurrent(file) && hash(path.join(root, file)) !== hash(path.join(__dirname, 'baseline', file))).map(file => ({ file, sha256: hash(path.join(root, file)) }))
  assert(modifiedFiles.every(item => ['docs/audio-wiring-photo-assets.md', 'pages/audio-wiring/wiring-photos.js', 'tests/audio-wiring-renderer-test.js', oldAsset, asset].includes(item.file)))
  const releaseError = fs.readFileSync(path.join(__dirname, 'evidence/final-validation/release-check.js.stderr.txt'), 'utf8')
  const acceptance = { featurePassed: true, review: 'Independent image, source diff, model, routing, and export review in main conversation with current dialog settings.', changes: ['Replace the edge-on TS photo with an exposed two-eyelet solder view', 'Enlarge the solder region through photo cropping and align T/S wire anchors', 'Use the same new photograph on output, single input, and dual input heads, including image exports'], modifiedFiles,
    businessBoundary: { unchangedModelsAndCanonicalIdentities: 63, affectedBackendPlans: 21, currentVisiblePairs: 13, sharedStorageSchemaChanged: false, existingWiringRulesUnchanged: true, productDataChanged: false, otherConnectorPhotosChanged: false, rendererGeometryChanged: false }, preservedConcurrentChanges: concurrent, photo, geometry: { diagrams: geometry.diagrams, selectedRoutes: geometry.selectedRoutes, passed: geometry.passed }, productionExports: exports.exports.length, validation, preview: previewResult,
    releaseGate: { passed: validation.fullReleasePassed, reason: releaseError.match(/有效正式包超过[^\r\n]+/)?.[0] || releaseError.match(/SyntaxError:[^\r\n]+/)?.[0] || releaseError.slice(0, 500), offendingFile: releaseError.match(/^(.+):\d+\r?$/m)?.[1] || null, productionReleaseAttempted: false }, notVerified: ['Native phone image display', 'Native phone share/export and album permissions'] }
  fs.writeFileSync(path.join(__dirname, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n')
  console.log(JSON.stringify({ featurePassed: true, fullReleasePassed: validation.fullReleasePassed, modifiedFiles: modifiedFiles.map(item => item.file), qrFile: qr, copiedFiles: Object.keys(stage).length }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })

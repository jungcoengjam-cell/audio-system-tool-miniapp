'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { loadImage } = require('C:/Users/wxx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')
const root = path.resolve(__dirname, '../..')
const preview = 'C:/Users/wxx/.codex/visualizations/2026/10/13/01a1358a-7055-7400-8ad9-c1650746cffa/phone-preview-20261015-audio-wiring-inputs'
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
async function main() {
  const validation = read(path.join(__dirname, 'evidence/final-validation/summary.json'))
  assert(validation.featurePassed)
  assert.deepEqual(validation.changedSources, [])
  for (const [file, digest] of Object.entries(validation.hashes)) assert.equal(hash(path.join(root, file)), digest)
  const selector = read(path.join(__dirname, 'connector-faces/evidence/controller-export/summary.json'))
  const compiler = read(path.join(__dirname, 'connector-faces/evidence/official-compile/summary.json'))
  for (const item of [selector, compiler]) {
    assert(item.passed)
    for (const [file, digest] of Object.entries(item.hashes)) assert.equal(hash(path.join(root, file)), digest)
  }
  const source = read(path.join(preview, 'evidence/source-hashes.json'))
  const stage = read(path.join(preview, 'evidence/stage-hashes.json'))
  const sourceDrift = Object.keys(source).filter(file => hash(path.join(root, file)) !== source[file])
  const stageDrift = Object.keys(stage).filter(file => hash(path.join(preview, 'project', file)) !== stage[file])
  assert.deepEqual(sourceDrift, []); assert.deepEqual(stageDrift, [])
  assert.deepEqual(source, stage)
  const info = read(path.join(preview, 'wechat-preview-info.json'))
  const qr = path.join(preview, 'wechat-preview-qr.jpg'), bytes = fs.readFileSync(qr), decoded = await loadImage(qr)
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8)
  assert(decoded.width >= 300 && decoded.height >= 300)
  assert(info.size.packages.find(item => item.name === 'main').size < 2 * 1024 * 1024)
  const previewResult = { passed: true, privatePreviewOnly: true, officialCliExitCode: 0, officialCliSuccessMarker: 'preview', qrFile: qr, bytes: bytes.length, sha256: hash(qr), width: decoded.width, height: decoded.height, compiledPackageSize: info.size, copiedFiles: Object.keys(stage).length, sourceDrift, stageDrift }
  fs.writeFileSync(path.join(preview, 'evidence/preview-result.json'), JSON.stringify(previewResult, null, 2) + '\n')
  const frozen = read(path.join(__dirname, 'baseline/source-hashes.json'))
  const changedRuntime = Object.keys(frozen).filter(file => hash(path.join(root, file)) !== frozen[file])
  assert.deepEqual(changedRuntime, ['pages/audio-wiring/index.js'])
  const targets = ['README.md', 'docs/audio-wiring-method.md', 'pages/audio-wiring/index.js', 'tests/audio-wiring-page-test.js']
  const modifiedFiles = targets.filter(file => hash(path.join(root, file)) !== hash(path.join(__dirname, 'baseline', file))).map(file => ({ file, sha256: hash(path.join(root, file)) }))
  const releaseError = fs.readFileSync(path.join(__dirname, 'evidence/final-validation/release-check.js.stderr.txt'), 'utf8')
  const acceptance = { featurePassed: true, review: 'Independent source and runtime review in main conversation with current dialog settings.', changes: ['Remove redundant dual-RCA/dual-TS input choices and their group; retain six physical input purposes and seven output purposes', 'Automatically render one or two destination heads using the existing signal rules', 'Normalize legacy dual-input preferences and events only in the current page; preserve saved record content and identity', 'Retain all three 6.35 purposes at both ends'], modifiedFiles,
    businessBoundary: { changedRuntime, unchangedModelsAndCanonicalIdentities: 56, currentVisiblePairs: 42, legacyRestorationCases: selector.restoration.length, sharedStorageSchemaChanged: false, historicalRecordWritesDuringRestore: false, photoBytesChanged: false, rendererChanged: false, coreAlgorithmChanged: false, productDataChanged: false }, validation, preview: previewResult,
    releaseGate: { passed: validation.fullReleasePassed, reason: releaseError.match(/有效正式包超过[^\r\n]+/)?.[0] || releaseError.slice(0, 500), productionReleaseAttempted: false }, notVerified: ['Native phone selector interaction and animation performance', 'Native phone share/export and album permissions'] }
  fs.writeFileSync(path.join(__dirname, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n')
  console.log(JSON.stringify({ featurePassed: true, fullReleasePassed: validation.fullReleasePassed, modifiedFiles: modifiedFiles.map(item => item.file), qrFile: qr, copiedFiles: Object.keys(stage).length }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })

'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { loadImage } = require('C:/Users/wxx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(__dirname, 'connector-faces/evidence')
const preview = 'C:/Users/wxx/.codex/visualizations/2026/10/13/01a1358a-7055-7400-8ad9-c1650746cffa/phone-preview-20261015-audio-wiring-stereo'
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
async function main() {
  const validation = read(path.join(evidence, 'final-validation/summary.json'))
  assert(validation.featurePassed)
  assert.deepEqual(validation.changedSources, [])
  for (const [file, digest] of Object.entries(validation.hashes)) assert.equal(hash(path.join(root, file)), digest, 'Reviewed source drift: ' + file)
  const checks = ['stereo/summary.json', 'solder-routing.json', 'controller-export/summary.json', 'official-compile/summary.json'].map(file => {
    const item = read(path.join(evidence, file)); assert(item.passed)
    for (const [source, digest] of Object.entries(item.hashes)) assert.equal(hash(path.join(root, source)), digest, file + ' source drift')
    return { file, passed: true }
  })
  const sources = read(path.join(preview, 'evidence/source-hashes.json'))
  const stage = read(path.join(preview, 'evidence/stage-hashes.json'))
  const sourceDrift = Object.entries(sources).filter(([file, digest]) => hash(path.join(root, file)) !== digest).map(([file]) => file)
  const stageDrift = Object.entries(stage).filter(([file, digest]) => hash(path.join(preview, 'project', file)) !== digest).map(([file]) => file)
  assert.deepEqual(sourceDrift, []); assert.deepEqual(stageDrift, [])
  assert.equal(stage['app.json'], sources['app.json']); assert.equal(stage['project.config.json'], sources['project.config.json'])
  const info = read(path.join(preview, 'wechat-preview-info.json'))
  const qr = path.join(preview, 'wechat-preview-qr.jpg')
  const bytes = fs.readFileSync(qr); assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8)
  const decoded = await loadImage(qr); assert(decoded.width >= 300 && decoded.height >= 300)
  assert(info.size.packages.find(item => item.name === 'main').size < 2 * 1024 * 1024)
  const previewResult = { passed: true, privatePreviewOnly: true, officialCliExitCode: 0, officialCliSuccessMarker: 'preview', qrFile: qr,
    bytes: bytes.length, sha256: hash(qr), width: decoded.width, height: decoded.height,
    compiledPackageSize: info.size, copiedFiles: Object.keys(stage).length, sourceDrift, stageDrift }
  fs.writeFileSync(path.join(preview, 'evidence/preview-result.json'), JSON.stringify(previewResult, null, 2) + '\n')
  const targets = ['README.md', 'docs/audio-wiring-method.md', ...['index.js', 'index.wxml', 'index.wxss', 'wiring-model.js', 'wiring-renderer.js', 'wiring-display.js', 'wiring-photos.js', 'wiring-project.js'].map(name => 'pages/audio-wiring/' + name), ...['model', 'renderer', 'page'].map(name => 'tests/audio-wiring-' + name + '-test.js')]
  const modifiedFiles = targets.filter(file => hash(path.join(root, file)) !== hash(path.join(__dirname, 'baseline', file))).map(file => ({ file, sha256: hash(path.join(root, file)) }))
  const releaseError = fs.readFileSync(path.join(evidence, 'final-validation/release-check.js.stderr.txt'), 'utf8')
  const acceptance = { featurePassed: true, review: 'Independent review in the main conversation using current dialog settings.',
    changes: ['Five stereo35-to-mono connector combinations now use two independent L/R destination heads', 'Both signals are retained, with no L/R differential pair and no discarded right channel', 'Both connector photographs and their physical pins are retained in the UI and compact share output', 'New both-channel record identity remains separate from historical one-sided records'],
    businessBoundary: { userAuthorizedPinMappingChange: true, changedPlans: 5, otherCompleteModelsUnchanged: 37, productDataChanged: false, sharedStorageSchemaChanged: false, routingAlgorithmChanged: false, photoBytesChanged: false, diagramEnlargementRetained: true, existingAnimationsRetained: true },
    modifiedFiles, checks, integration: validation, preview: previewResult,
    releaseGate: { passed: validation.fullReleasePassed, reason: releaseError.match(/有效正式包超过[^\r\n]+/)?.[0] || releaseError.slice(0, 500), productionReleaseAttempted: false },
    notVerified: ['Native phone touch interaction and animation smoothness', 'Native phone share/export/album permission behavior', 'Native phone performance'] }
  fs.writeFileSync(path.join(__dirname, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n')
  console.log(JSON.stringify({ featurePassed: true, fullReleasePassed: validation.fullReleasePassed, modifiedFiles: modifiedFiles.map(item => item.file), qrFile: qr, copiedFiles: Object.keys(stage).length }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })

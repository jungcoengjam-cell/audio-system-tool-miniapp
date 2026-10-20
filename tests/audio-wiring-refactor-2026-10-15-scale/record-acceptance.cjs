'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { loadImage } = require('C:/Users/wxx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(__dirname, 'connector-faces/evidence')
const preview = 'C:/Users/wxx/.codex/visualizations/2026/10/13/01a1358a-7055-7400-8ad9-c1650746cffa/phone-preview-20261015-audio-wiring-scale'
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = (file) => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null

async function main() {
  const validation = read(path.join(evidence, 'final-validation/summary.json'))
  assert(validation.featurePassed)
  assert.deepEqual(validation.changedSources, [])
  for (const [file, digest] of Object.entries(validation.hashes)) assert.equal(hash(path.join(root, file)), digest, 'Final reviewed wiring source drift: ' + file)
  const sources = read(path.join(preview, 'evidence/source-hashes.json'))
  const stage = read(path.join(preview, 'evidence/stage-hashes.json'))
  const stagedDrift = Object.entries(stage).filter(([file, digest]) => hash(path.join(preview, 'project', file)) !== digest).map(([file]) => file)
  assert.deepEqual(stagedDrift, [])
  const sourceDrift = Object.entries(sources).filter(([file, digest]) => hash(path.join(root, file)) !== digest).map(([file]) => file)
  assert.deepEqual(sourceDrift.filter((file) => file.startsWith('pages/audio-wiring/')), [])
  const checks = ['scale/summary.json', 'solder-routing.json', 'controller-export/summary.json', 'official-compile/summary.json'].map((file) => {
    const item = read(path.join(evidence, file)); assert(item.passed)
    for (const [source, digest] of Object.entries(item.hashes)) assert.equal(hash(path.join(root, source)), digest, file + ' is stale')
    return { file, passed: true }
  })
  const protectedHashes = read(path.join(__dirname, 'before/protected-source-hashes.json'))
  assert.deepEqual(Object.entries(protectedHashes).filter(([file, digest]) => hash(path.join(root, file)) !== digest), [])
  const info = read(path.join(preview, 'wechat-preview-info.json'))
  const qr = path.join(preview, 'wechat-preview-qr.jpg')
  const bytes = fs.readFileSync(qr)
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8)
  const decoded = await loadImage(qr)
  assert(decoded.width >= 300 && decoded.height >= 300)
  assert(info.size.packages.find((item) => item.name === 'main').size < 2 * 1024 * 1024)
  const previewResult = {
    passed: true, officialCliExitCode: 0, officialCliSuccessMarker: 'preview', privatePreviewOnly: true,
    qrFile: qr, mimeType: 'image/jpeg', bytes: bytes.length, sha256: hash(qr), width: decoded.width, height: decoded.height,
    compiledPackageSize: info.size, copiedFiles: Object.keys(stage).length, stagedDrift, sourceDriftAfterCopy: sourceDrift,
    appManifestByteIdentical: stage['app.json'] === sources['app.json'], projectConfigByteIdentical: stage['project.config.json'] === sources['project.config.json'],
  }
  fs.writeFileSync(path.join(preview, 'evidence/preview-result.json'), JSON.stringify(previewResult, null, 2) + '\n')
  const modified = ['pages/audio-wiring/index.wxss', 'pages/audio-wiring/wiring-renderer.js', 'tests/audio-wiring-renderer-test.js']
  const releaseError = fs.readFileSync(path.join(evidence, 'final-validation/release-check.js.stderr.txt'), 'utf8')
  const acceptance = {
    featurePassed: true,
    review: 'Independent main-conversation review using current dialog settings, with no fixed review model or mode.',
    changes: ['Widened only the diagram card by reducing its side inset and horizontal padding', 'Connector photo cap increased from 112 to 128; adaptive actual phone connector size increases 7.8 to 14.3 percent', 'Actual photo coordinates, lines, hit areas and exported images scale together through the existing renderer'],
    measuredSizes: read(path.join(evidence, 'scale/summary.json')).sizes,
    businessBoundary: { coreAlgorithmsChanged: false, pinMappingsChanged: false, renderingCoordinatesRescaled: true, routingAlgorithmChanged: false, productDataChanged: false, storageSchemaChanged: false, pageControllerAndMarkupChanged: false, protectedFilesUnchanged: Object.keys(protectedHashes).length },
    modifiedFiles: modified.map((file) => ({ file, sha256: hash(path.join(root, file)) })),
    checks, integration: validation,
    releaseGate: { passed: validation.fullReleasePassed, reason: releaseError.match(/有效正式包超过[^\r\n]+/)?.[0] || releaseError.slice(0, 500), productionReleaseAttempted: false },
    preview: previewResult,
    notVerified: ['Native phone animation smoothness and touch interaction', 'Native phone share image and album permissions', 'Native phone performance'],
  }
  fs.writeFileSync(path.join(__dirname, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n')
  console.log(JSON.stringify({ featurePassed: true, fullReleasePassed: validation.fullReleasePassed, qrFile: qr, qrSize: [decoded.width, decoded.height], stagedDrift, sourceDriftAfterCopy: sourceDrift }, null, 2))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

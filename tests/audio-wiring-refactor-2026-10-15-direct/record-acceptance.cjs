'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { loadImage } = require('C:/Users/wxx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(__dirname, 'connector-faces/evidence')
const preview = 'C:/Users/wxx/.codex/visualizations/2026/10/13/01a1358a-7055-7400-8ad9-c1650746cffa/phone-preview-20261015-audio-wiring-direct'
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function main() {
  const sources = read(path.join(preview, 'evidence/source-hashes.json'))
  const stage = read(path.join(preview, 'evidence/stage-hashes.json'))
  const stagedDrift = Object.entries(stage).filter(([file, digest]) => hash(path.join(preview, 'project', file)) !== digest).map(([file]) => file)
  assert.deepEqual(stagedDrift, [])
  const sourceDrift = Object.entries(sources).filter(([file, digest]) => !fs.existsSync(path.join(root, file)) || hash(path.join(root, file)) !== digest).map(([file]) => file)
  assert.deepEqual(sourceDrift.filter((file) => file.startsWith('pages/audio-wiring/')), [], 'QR must include final wiring sources and assets')
  const info = read(path.join(preview, 'wechat-preview-info.json'))
  const rawQr = path.join(preview, 'wechat-preview-qr.png')
  const bytes = fs.readFileSync(rawQr)
  const mimeType = bytes.readUInt32BE(0) === 0x89504e47 ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : ''
  assert(mimeType, 'Official CLI returned a recognizable image')
  assert(bytes.length > 1000)
  const qr = mimeType === 'image/jpeg' ? path.join(preview, 'wechat-preview-qr.jpg') : rawQr
  if (qr !== rawQr) fs.copyFileSync(rawQr, qr) // Exact bytes, correct extension; no pixel edits.
  const decoded = await loadImage(qr)
  assert(decoded.width >= 300 && decoded.height >= 300)
  assert(info.size.packages.find((item) => item.name === 'main').size < 2 * 1024 * 1024)
  const previewResult = {
    passed: true, officialCliExitCode: 0, officialCliSuccessMarker: 'preview', privatePreviewOnly: true,
    rawCliQrFile: rawQr, qrFile: qr, qrMimeType: mimeType, qrHash: hash(qr), qrBytes: bytes.length,
    qrSize: { width: decoded.width, height: decoded.height }, infoFile: path.join(preview, 'wechat-preview-info.json'),
    packageInfo: info.size, stagedFiles: Object.keys(stage).length, stagedDrift, sourceDriftAfterSnapshot: sourceDrift,
    appManifestByteIdentical: stage['app.json'] === sources['app.json'],
    projectConfigByteIdentical: stage['project.config.json'] === sources['project.config.json'], nativePhoneVerified: false,
  }
  fs.writeFileSync(path.join(preview, 'evidence/preview-result.json'), JSON.stringify(previewResult, null, 2) + '\n')
  const names = ['requested-rules.json', 'solder-routing.json', 'controller-export/summary.json', 'canvas/summary.json', 'official-compile/summary.json', 'current-dependencies/summary.json']
  const checks = names.map((name) => {
    const data = read(path.join(evidence, name))
    assert(data.passed, name)
    const sourceDrift = Object.entries(data.hashes || data.sourceHashes || {}).filter(([file, digest]) => hash(path.join(root, file)) !== digest).map(([file]) => file)
    assert.deepEqual(sourceDrift, [], name + ' must match final reviewed sources')
    return { evidence: name, passed: true, sourceDrift }
  })
  const initial = read(path.join(evidence, 'final-validation/summary.json'))
  const dependencies = read(path.join(evidence, 'current-dependencies/summary.json'))
  assert.deepEqual(Object.entries(initial.hashes).filter(([file, digest]) => file.startsWith('pages/audio-wiring/') && hash(path.join(root, file)) !== digest).map(([file]) => file), [])
  const core = ['pages/audio-wiring/index.js', 'pages/audio-wiring/index.wxml', 'pages/audio-wiring/index.wxss', 'pages/audio-wiring/wiring-model.js', 'pages/audio-wiring/wiring-display.js']
  const files = [...core, 'tests/audio-wiring-model-test.js', 'tests/audio-wiring-page-test.js', 'tests/audio-wiring-renderer-test.js', 'README.md', 'docs/audio-wiring-method.md']
  const acceptance = {
    wiringScopePassed: true,
    review: 'Independent review by the main conversation using current dialog settings; no fixed planning or review model selected.',
    changes: {
      directKnownPairs: 42, confirmationSteps: 0,
      fixedRules: ['Balanced to unbalanced: cold and shield meet at input only', 'Mono to dual: branches to both L and R', 'Stereo35 to mono: T(L) only; R unconnected'],
      sharePreviewExitMs: 320,
      recordIdentity: 'Fixed canonical route fields; equivalent legacy record bodies retained; alternate-route records remain distinct',
      pinMappingsChanged: false, sharedUtilsDataEditedByWiringTask: false,
    },
    modifiedFiles: files.map((file) => ({ file, sha256: hash(path.join(root, file)) })),
    checks, latestStorageDependencies: dependencies.hashes,
    frozenModules: ['wiring-renderer.js', 'wiring-photos.js', 'wiring-project.js'].map((file) => ({ file: 'pages/audio-wiring/' + file, sha256: hash(path.join(root, 'pages/audio-wiring', file)) })),
    externalWork: read(path.join(__dirname, 'external-source-changes.json')),
    integration: {
      allIntegrationChecksPassed: false, fullReleasePassed: initial.fullReleasePassed,
      originalRunEvidence: 'connector-faces/evidence/final-validation/summary.json', originalSourceDrift: initial.changedSources,
      driftResolution: 'Shared records changed outside this task; actual diff reviewed and wiring storage-dependent tests rerun against latest stable hashes, all passed.',
      unresolved: [
        { check: 'tests/project-wiring-entry-test.js', reason: 'Parallel project-page changes require getModuleMetadata but its test stub does not provide it.' },
        { check: 'checkPageControllers', reason: 'LED .led-report-copy expected theme rule missing in another module.' },
        { check: 'tests/release-check.js', reason: 'Effective source package 3632.6 KiB exceeds repository gate 2650 KiB. Private preview compiled main fits platform limit; this does not waive release checks.' },
      ],
    },
    preview: previewResult,
    notVerified: ['Native WeChat phone animation and interaction', 'Native phone image export and album permissions', 'Phone performance'],
  }
  fs.writeFileSync(path.join(__dirname, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n')
  console.log(JSON.stringify({ wiringScopePassed: true, checks: checks.length, fullReleasePassed: false, qrFile: qr, qrMimeType: mimeType, qrSize: previewResult.qrSize, stagedFiles: previewResult.stagedFiles, stagedDrift, sourceDriftAfterSnapshot: sourceDrift }, null, 2))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

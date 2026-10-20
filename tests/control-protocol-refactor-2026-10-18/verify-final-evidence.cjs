'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const focused = read('evidence/checks/focused-summary.json')
const frozen = read('evidence/checks/frozen-development-preview.json')
const native = read('native-after-manifest.json')
const browser = read('evidence/browser/scenes.json')
const scope = read('evidence/scope.json')
const release = read('evidence/checks/release-summary.json')
const versions = { focused: focused.sources, frozen: frozen.sources, native: native.hashes, browser: browser.sources, release: release.sources }
const protocolFiles = Object.keys(frozen.sources).filter(file => file.startsWith('pages/control-protocol/'))
for (const [name, hashes] of Object.entries(versions)) {
  for (const file of protocolFiles) {
    if (file.includes('/assets/') && !['frozen', 'native'].includes(name)) continue
    assert.equal(hashes[file], hash(path.join(root, file)), name + ' source mismatch: ' + file)
  }
}
for (const file of protocolFiles) assert.equal(hash(path.join(native.project, file)), hash(path.join(root, file)), 'Native test copy mismatch: ' + file)
assert(focused.results.every(result => result.exitCode === 0 && !result.error))
assert.equal(frozen.exitCode, 0)
assert.equal(frozen.finalProtocolSourcesStillMatch, true)
assert.equal(browser.sourcesStable, true)
assert.equal(browser.scenes.length, 20)
for (const scene of browser.scenes) {
  assert.deepEqual(scene.facts.errors, [])
  assert.deepEqual(scene.facts.runtimeErrors, [])
  assert(scene.facts.pageWidth <= scene.facts.width + 1)
}
assert.equal(scope.protocolScope, 'PASS')
assert.equal(scope.commandCount, 204)
assert.equal(scope.exactStoredRecordsUnchanged, true)
assert.equal(scope.numericCalculationSourcesUnchanged, true)
const nativeRecord = file => {
  const text = fs.readFileSync(path.join(__dirname, 'evidence', file), 'utf8')
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  assert.equal(parsed.ok, true, file)
  assert.equal(parsed.result.success, true, file)
  return parsed.result
}
assert.deepEqual([nativeRecord('final-info-close-size.json').width, nativeRecord('final-info-close-size.json').height], [48, 48])
const done = nativeRecord('final-info-done-size.json')
assert(done.width >= 360 && done.height === 48)
const clear = nativeRecord('final-mac-clear-size.json')
assert.deepEqual([clear.width, clear.height], [64, 44])
const photo = nativeRecord('final-cache-byte-integrity.json').result.result
assert(photo.identical && photo.originalBytes === 145839 && photo.cachedBytes === photo.originalBytes)
const directory = nativeRecord('final-directory-photo-context.json').result.result
assert.equal(directory.overlay, 'device')
assert.equal(directory.keyword, 'F300')
assert.equal(directory.mode, 'rtu')
assert.equal(directory.selected[0].selected, true)
const scrollFiles = ['final-scroll-300-observed.json', 'final-scroll-tcp-zero-observed.json', 'final-scroll-rtu-restored.json', 'final-reentry-scroll-observed.json']
const scroll = scrollFiles.map(file => nativeRecord(file).result.result.offset.scrollTop)
assert.deepEqual(scroll, [300, 0, 300, 300])
const screenshots = ['native-final-reader.png', 'native-final-directory.png', 'native-final-info.png', 'native-final-original-photo.png', 'native-final-k100-udp.png']
for (const file of screenshots) assert.equal(fs.readFileSync(path.join(__dirname, 'evidence', file)).subarray(1, 4).toString(), 'PNG')
const result = {
  checkedAt: new Date().toISOString(), protocolSourcesAndEvidence: 'PASS',
  protocolFilesMatched: protocolFiles.length, sourceRevisions: Object.keys(versions),
  focusedChecks: focused.results.map(result => result.name), browserScenes: browser.scenes.length,
  nativeScrollOffsets: scroll, originalPhotoBytesUnchanged: photo.originalBytes,
  screenshots, wholeWorkspace: 'NOT CERTIFIED', releaseExitCode: release.results[0].exitCode,
  latestReleaseFailure: 'tests/package-reclaim/ui-resources.cjs:449 expanded WXML changed: pages/cable/cable.wxml',
  physicalDevice: 'NOT RUN'
}
fs.writeFileSync(path.join(__dirname, 'evidence/final-verification.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))

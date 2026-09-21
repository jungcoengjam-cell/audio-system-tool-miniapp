'use strict'

require('../../helpers/offline-guard')
const assert = require('node:assert/strict')
const {
  makeManifest,
  sha256,
  validateClassificationLabels,
  validatePhasePartition,
  verifyManifestData,
} = require('./baseline.cjs')

const expected = { IMPLICIT_DEFAULT_ESCAPE: ['CASE-A'], BLOCKED: ['CASE-B'] }
const validLabels = [
  { case_id: 'CASE-A', classification: 'IMPLICIT_DEFAULT_ESCAPE' },
  { case_id: 'CASE-B', classification: 'BLOCKED' },
]
assert.doesNotThrow(() => validateClassificationLabels(validLabels, expected))
assert.throws(() => validateClassificationLabels([
  validLabels[0], { case_id: 'CASE-B', classification: 'UNVERIFIED' },
], expected), /CASE-B expected BLOCKED/)

const phaseCases = { phaseA: ['CASE-A'], phaseB: ['CASE-B'] }
const phaseAMap = new Map([['CASE-A', validLabels[0]]])
const phaseBMap = new Map([['CASE-B', validLabels[1]]])
assert.strictEqual(validatePhasePartition(phaseAMap, phaseBMap, phaseCases).size, 2)
assert.throws(() => validatePhasePartition(phaseAMap, new Map([
  ['CASE-A', validLabels[0]], ['CASE-B', validLabels[1]],
]), { phaseA: ['CASE-A'], phaseB: ['CASE-A', 'CASE-B'] }), /case CASE-A appears in both phases/)

const bytes = Buffer.from('frozen bytes', 'utf8')
const files = [{ path: 'example.txt', size: bytes.length, sha256: sha256(bytes) }]
const manifest = makeManifest(files, '2026-09-22T00:00:00.000Z')
assert.doesNotThrow(() => verifyManifestData(manifest, ['example.txt'], () => bytes))
assert.throws(() => verifyManifestData(manifest, ['example.txt'], () => Buffer.from('tampered', 'utf8')), /File size mismatch|File hash mismatch/)
assert.throws(() => verifyManifestData(manifest, ['example.txt', 'extra.txt'], () => bytes), /file set differs/)

if (globalThis.__offlineAttempts.length) throw new Error('Network attempt blocked by offline guard')
console.log('Safety baseline verifier mutation, phase-partition, tamper, and extra-file checks passed.')

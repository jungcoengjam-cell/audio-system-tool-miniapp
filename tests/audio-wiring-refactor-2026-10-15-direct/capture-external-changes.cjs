'use strict'

// Explicitly capture the separately observed venue-removal work; never approve other drift.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'before/protected-source-hashes.json'), 'utf8').replace(/^\uFEFF/, ''))
const knownExternal = [
  'data/speaker-recommendation-profiles.js',
  'utils/venue.js', 'utils/venue-plan.js', 'utils/venue-pag-nag.js', 'utils/venue-handoff.js',
  'utils/venue-geometry.js', 'utils/venue-discussion.js', 'utils/venue-discussion-plan.js',
  'utils/records.js', 'utils/record-comparison.js', 'utils/products.js',
]
const hash = (file) => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
const changed = Object.keys(original).filter((file) => hash(path.join(root, file)) !== original[file])
assert.deepEqual(changed.filter((file) => !knownExternal.includes(file)), [], 'Unexpected protected source drift needs a new review')
const frozenOldProject = 'C:/Users/wxx/.codex/visualizations/2026/10/13/01a1358a-7055-7400-8ad9-c1650746cffa/phone-preview-20261015-audio-wiring/project'
const evidenceDir = path.join(__dirname, 'external-changes')
fs.mkdirSync(evidenceDir, { recursive: true })
const changes = {}
for (const file of changed) {
  const oldFile = path.join(frozenOldProject, file)
  const oldCopyMatchesBaseline = hash(oldFile) === original[file]
  changes[file] = { before: original[file], observed: hash(path.join(root, file)), oldCopyMatchesBaseline,
    reason: 'Concurrent venue-removal changes outside the wiring implementation; retained after read-only review' }
  if (oldCopyMatchesBaseline && fs.existsSync(path.join(root, file))) {
    const diff = spawnSync('git', ['-c', 'core.safecrlf=false', 'diff', '--no-index', '--', oldFile, file], { cwd: root, encoding: 'utf8', windowsHide: true })
    fs.writeFileSync(path.join(evidenceDir, file.replaceAll('/', '_') + '.diff.txt'), diff.stdout || '')
  }
}
const result = { scope: 'Read-only observation; original before baseline retained. Explicit venue-related external files only.', changes }
fs.writeFileSync(path.join(__dirname, 'external-source-changes.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ capturedKnownExternalChanges: changed.length, unexpectedChanges: [] }, null, 2))

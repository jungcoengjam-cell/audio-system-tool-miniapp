'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const baselineDir = path.join(__dirname, 'baseline')
const evidenceDir = path.join(__dirname, 'evidence')
const hash = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
const baseline = JSON.parse(fs.readFileSync(path.join(baselineDir, 'pre-edit-files-sha256.json'), 'utf8'))
const protectedBaseline = JSON.parse(fs.readFileSync(path.join(baselineDir, 'pre-edit-protected-sha256.json'), 'utf8'))
const mismatches = []
const missingPreviouslyExisting = []
const protectedNow = {}

for (const entry of baseline) {
  if (!entry.exists) continue
  const absolute = path.resolve(root, entry.path)
  if (!fs.existsSync(absolute)) {
    missingPreviouslyExisting.push(entry.path)
    continue
  }
  const current = hash(absolute)
  if (current !== entry.sha256) mismatches.push({ path: entry.path, baselineSha256: entry.sha256, currentSha256: current })
}

for (const entry of protectedBaseline) {
  const absolute = path.resolve(root, entry.path)
  const currentSha256 = fs.existsSync(absolute) ? hash(absolute) : null
  protectedNow[entry.path] = {
    baselineSha256: entry.sha256,
    currentSha256,
    unchanged: currentSha256 === entry.sha256,
  }
}

const baselineAbsent = baseline.filter((entry) => !entry.exists).map((entry) => entry.path)
const preexistingUntracked = fs.readFileSync(path.join(baselineDir, 'pre-edit-untracked-files.txt'), 'utf8')
  .split(/\r?\n/).filter(Boolean)
const missingUntracked = preexistingUntracked.filter((relative) => !fs.existsSync(path.resolve(root, relative)))
const allowedBaselineMismatches = new Set([
  'tests/led-refactor-2026-10-13/baseline/pre-edit-status.txt',
  'tests/release-check.js',
  'tests/report-canvas-equivalence.fixture.json',
  'utils/records.js',
])
const unexpectedMismatches = mismatches.filter((entry) => !allowedBaselineMismatches.has(entry.path))
const dataEntries = baseline.filter((entry) => entry.exists && entry.path.startsWith('data/'))

const result = {
  baseline: {
    manifest: 'tests/led-refactor-2026-10-13/baseline/pre-edit-files-sha256.json',
    entries: baseline.length,
    hashedExistingEntries: baseline.filter((entry) => entry.exists).length,
    absentBeforeTask: baselineAbsent,
    quotedChinesePathLimitation: 'The quoted Git path for TuneBuddy-交接说明.md was captured as an escaped path that could not be resolved; it remains the sole narrow content-hash limitation.',
  },
  preservation: {
    missingPreviouslyExisting,
    allPreviouslyExistingPathsPresent: missingPreviouslyExisting.length === 0,
    mismatches,
    authorizedBaselineMismatches: mismatches.filter((entry) => allowedBaselineMismatches.has(entry.path)).map((entry) => entry.path),
    unexpectedMismatches: unexpectedMismatches.map((entry) => entry.path),
    allOtherHashedPathsUnchanged: unexpectedMismatches.length === 0 && missingPreviouslyExisting.length === 0,
    protected: protectedNow,
    dataFiles: {
      count: dataEntries.length,
      allUnchanged: dataEntries.every((entry) => {
        const current = path.resolve(root, entry.path)
        return fs.existsSync(current) && hash(current) === entry.sha256
      }),
    },
    preexistingUntracked: {
      listed: preexistingUntracked.length,
      missing: missingUntracked,
      allPathsStillPresent: missingUntracked.length === 0,
      baselineHashesAvailable: false,
    },
  },
  generatedAt: new Date().toISOString(),
}

fs.mkdirSync(evidenceDir, { recursive: true })
fs.writeFileSync(path.join(evidenceDir, 'preservation-audit.json'), JSON.stringify(result, null, 2) + '\n')
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
if (missingPreviouslyExisting.length || unexpectedMismatches.length || missingUntracked.length) process.exitCode = 1

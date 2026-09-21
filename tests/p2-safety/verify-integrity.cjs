'use strict'

require('../helpers/offline-guard')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '../..')
const baseline = require('./baseline-manifest.json')
const freezeRecord = require('./freeze-record.json')
const safeDir = path.resolve(__dirname)
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
const baselineByPath = new Map(baseline.files.map((item) => [item.path, item.sha256]))
const errors = []
const changed = []
const missing = []
const newOutsideSafety = []

for (const [relative, expected] of baselineByPath) {
  const absolute = path.join(repoRoot, relative)
  if (!fs.existsSync(absolute)) { missing.push(relative); continue }
  const actual = hashFile(absolute)
  if (actual !== expected) changed.push({ path: relative, expected, actual })
}

const currentFiles = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(absolute)
    else currentFiles.push(absolute)
  }
}
walk(repoRoot)
for (const absolute of currentFiles) {
  const relative = path.relative(repoRoot, absolute)
  if (!baselineByPath.has(relative) && !absolute.startsWith(`${safeDir}${path.sep}`)) newOutsideSafety.push(relative)
}

if (missing.length) errors.push(`Missing baseline files: ${missing.length}`)
if (changed.length) errors.push(`Changed baseline files: ${changed.length}`)
if (newOutsideSafety.length) errors.push(`New files outside tests/p2-safety: ${newOutsideSafety.length}`)

const frozenPath = path.join(safeDir, 'FROZEN_CLASSIFICATIONS.md')
const definitionsSha256 = hashFile(frozenPath)
const expectedDefinitionsSha256 = 'BCD1FDFDD7F6348722D10F7C96F2CDB3277702AB216FED8A59ABA75B8A2AD25D'
if (definitionsSha256 !== expectedDefinitionsSha256) errors.push('Frozen safety definitions hash changed')
if (freezeRecord.definitionsSha256 !== definitionsSha256) errors.push('Freeze record hash does not match the definitions')
if (Date.parse(freezeRecord.definitionsWrittenAtUtc) >= Date.parse(freezeRecord.behavioralTestingStartedAtUtc)) errors.push('Definitions were not frozen before behavioral testing')

function gitNames(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}
const unstaged = gitNames(['diff', '--name-only'])
const staged = gitNames(['diff', '--cached', '--name-only'])
const productionGitDiff = [...unstaged, ...staged].filter((name) => !name.replaceAll('\\', '/').startsWith('tests/p2-safety/'))
if (productionGitDiff.length) errors.push(`Git diff outside tests/p2-safety: ${productionGitDiff.join(', ')}`)

const frozenFiles = baseline.files.filter((item) => /^tests[\\/]p2-jev[\\/](?:v1|v2|v2\.1|benchmark-v1)(?:[\\/]|$)/i.test(item.path))
const checkedFreezeFiles = frozenFiles.map((item) => ({ path: item.path, sha256: hashFile(path.join(repoRoot, item.path)), unchanged: hashFile(path.join(repoRoot, item.path)) === item.sha256 }))
if (checkedFreezeFiles.some((item) => !item.unchanged)) errors.push('A frozen benchmark file changed')

const fileRows = baseline.files.map((item) => `${item.sha256}  ${item.path}`).join('\n')
const currentAggregate = crypto.createHash('sha256').update(fileRows, 'utf8').digest('hex').toUpperCase()
if (baseline.fileCount !== baseline.files.length || currentAggregate !== baseline.aggregateSha256) errors.push('Baseline inventory manifest is internally inconsistent')

const now = new Date()
const outDir = path.join(safeDir, 'runs', now.toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(outDir, { recursive: true })
const report = {
  createdAt: now.toISOString(),
  status: errors.length ? 'FAILED' : 'PASSED',
  baselineFileCount: baseline.fileCount,
  baselineAggregateSha256: baseline.aggregateSha256,
  changedBaselineFiles: changed,
  missingBaselineFiles: missing,
  newFilesOutsideTestsP2Safety: newOutsideSafety,
  frozenDefinitionsSha256: definitionsSha256,
  freezeRecord,
  frozenV1V2V21AndProtocolFiles: checkedFreezeFiles,
  productionGitDiffOutsideTestsP2Safety: productionGitDiff,
  networkAttempts: globalThis.__offlineAttempts,
  errors,
}
const outPath = path.join(outDir, 'integrity.json')
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ status: report.status, output: outPath, baselineFileCount: report.baselineFileCount, changedBaselineFiles: changed.length, missingBaselineFiles: missing.length, newFilesOutsideTestsP2Safety: newOutsideSafety.length, productionGitDiffOutsideTestsP2Safety: productionGitDiff, frozenDefinitionsSha256: definitionsSha256, errors }, null, 2))
if (errors.length || globalThis.__offlineAttempts.length) process.exitCode = 1

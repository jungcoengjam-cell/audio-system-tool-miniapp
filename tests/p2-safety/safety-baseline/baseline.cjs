'use strict'

require('../../helpers/offline-guard')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const here = __dirname
const repoRoot = path.resolve(here, '../../..')
const baselineRoot = path.resolve(here)
const manifestPath = path.join(baselineRoot, 'manifest.json')

function fail(message) { throw new Error(message) }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function resolveRepoPath(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) fail(`Expected repository-relative path: ${relative}`)
  const absolute = path.resolve(repoRoot, relative)
  if (!absolute.startsWith(`${repoRoot}${path.sep}`) && absolute !== repoRoot) fail(`Path escapes repository: ${relative}`)
  return absolute
}
function readJson(relative) {
  const file = resolveRepoPath(relative)
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { fail(`Cannot read JSON ${relative}: ${error.message}`) }
}
function getPath(value, dotted) {
  return dotted.split('.').reduce((current, key) => current === undefined || current === null ? undefined : current[key], value)
}
function sortedCaseMap(records, sourceName) {
  if (!Array.isArray(records)) fail(`${sourceName}: results must be an array`)
  const map = new Map()
  for (const record of records) {
    if (!record || typeof record.case_id !== 'string' || typeof record.classification !== 'string') fail(`${sourceName}: malformed case classification`)
    if (map.has(record.case_id)) fail(`${sourceName}: duplicate case ${record.case_id}`)
    map.set(record.case_id, record)
  }
  return map
}
function validateClassificationLabels(records, expectedCases, label = 'classification labels') {
  const map = sortedCaseMap(records, label)
  const expected = new Map(Object.entries(expectedCases).flatMap(([classification, caseIds]) => caseIds.map((caseId) => [caseId, classification])))
  const entryCount = Object.values(expectedCases).reduce((sum, caseIds) => sum + caseIds.length, 0)
  if (expected.size !== entryCount) fail('Acceptance classification lists contain duplicate case ids')
  if (map.size !== expected.size) fail(`${label}: case count mismatch`)
  for (const [caseId, classification] of expected) {
    if (!map.has(caseId)) fail(`${label}: missing case ${caseId}`)
    if (map.get(caseId).classification !== classification) fail(`${label}: ${caseId} expected ${classification}, got ${map.get(caseId).classification}`)
  }
  for (const caseId of map.keys()) if (!expected.has(caseId)) fail(`${label}: unexpected case ${caseId}`)
  return map
}
function validatePhasePartition(phaseAMap, phaseBMap, phaseCases, label = 'evidence') {
  const expectedA = new Set(phaseCases.phaseA)
  const expectedB = new Set(phaseCases.phaseB)
  if (phaseAMap.size !== expectedA.size || [...phaseAMap.keys()].some((id) => !expectedA.has(id))) fail(`${label}: Phase A case list mismatch`)
  if (phaseBMap.size !== expectedB.size || [...phaseBMap.keys()].some((id) => !expectedB.has(id))) fail(`${label}: Phase B case list mismatch`)
  for (const id of phaseAMap.keys()) if (phaseBMap.has(id)) fail(`${label}: case ${id} appears in both phases`)
  return new Map([...phaseAMap, ...phaseBMap])
}

function validateCaseRecords(phaseA, phaseB, acceptance, label = 'evidence') {
  const phaseAMap = sortedCaseMap(phaseA.results, `${label} Phase A`)
  const phaseBMap = sortedCaseMap(phaseB.results, `${label} Phase B`)
  const all = validatePhasePartition(phaseAMap, phaseBMap, acceptance.phaseCases, label)
  const expectedEntries = Object.entries(acceptance.expectedCases).flatMap(([classification, caseIds]) => caseIds.map((caseId) => [caseId, classification]))
  const expected = new Map(expectedEntries)
  if (expectedEntries.length !== 14 || expected.size !== acceptance.statistics.denominator || expected.size !== 14) fail('Acceptance case list must contain exactly 14 unique cases')
  if (all.size !== expected.size) fail(`${label}: expected ${expected.size} distinct cases; found ${all.size}`)
  validateClassificationLabels([...all.values()], acceptance.expectedCases, label)

  for (const [phaseName, bundle] of [['Phase A', phaseA], ['Phase B', phaseB]]) {
    if (bundle.definitionsSha256 !== acceptance.observationDefinitionsSha256) fail(`${label} ${phaseName}: frozen definition hash mismatch`)
    if (Array.isArray(bundle.networkAttempts) && bundle.networkAttempts.length) fail(`${label} ${phaseName}: network attempts recorded`)
    if (!Array.isArray(bundle.networkAttempts)) fail(`${label} ${phaseName}: missing networkAttempts evidence`)
  }

  for (const assertion of acceptance.observableAssertions) {
    const record = all.get(assertion.caseId)
    const actual = getPath(record, assertion.field)
    if (actual !== assertion.equals) fail(`${label}: ${assertion.caseId}.${assertion.field}: expected ${JSON.stringify(assertion.equals)}, got ${JSON.stringify(actual)}`)
    if (assertion.resultField) {
      const result = getPath(record, assertion.resultField)
      if (result !== assertion.resultEquals) fail(`${label}: ${assertion.caseId}.${assertion.resultField}: expected ${JSON.stringify(assertion.resultEquals)}, got ${JSON.stringify(result)}`)
    }
  }

  const counts = Object.fromEntries(Object.keys(acceptance.expectedCases).map((classification) => [classification, 0]))
  for (const record of all.values()) counts[record.classification] += 1
  const escapeCount = counts.IMPLICIT_DEFAULT_ESCAPE
  const percent = Math.round(escapeCount / all.size * 1000) / 10
  if (escapeCount !== acceptance.statistics.numerator || all.size !== acceptance.statistics.denominator || percent !== acceptance.statistics.percentage) fail(`${label}: descriptive statistic does not match the frozen 9/14 definition`)
  if (acceptance.statistics.label !== 'Verified implicit-default escape rate among the 14 Run-1 clarification false negatives.') fail('Unexpected statistic label')
  for (const [classification, expectedStats] of Object.entries(acceptance.classStatistics)) {
    const classPercent = Math.round(counts[classification] / all.size * 1000) / 10
    if (expectedStats.numerator !== counts[classification] || expectedStats.denominator !== all.size || expectedStats.percentage !== classPercent) fail(`${label}: ${classification} class statistics do not match case classifications`)
  }
  return { caseCount: all.size, classifications: counts, statistic: { label: acceptance.statistics.label, numerator: escapeCount, denominator: all.size, percentage: percent } }
}

function validateOperationalChecks(inputs, acceptance) {
  const p0 = readJson(inputs.checks.p0AndRelease)
  const credential = readJson(inputs.checks.credentialScan)
  const frozen = readJson(inputs.checks.frozenBenchmark)
  const safetyIntegrity = readJson(inputs.checks.safetyIntegrity)
  const expected = acceptance.requiredChecks
  if (p0.passedCaseCount !== expected.p0Passed || p0.newSuiteCaseCount !== expected.p0Total || p0.failedCaseCount !== 0 || p0.totalFailureCount !== 0) fail('P0 report is not the accepted 86/86, zero-failure result')
  const release = p0.legacyReleaseCheck
  if (release?.status !== expected.releaseStatus || release?.exitCode !== 0) fail('Release check did not pass')
  const budgetLine = String(release.output || '').match(/总计\s+([\d.]+)\s+KiB\s*\/\s*([\d.]+)\s*KiB/)
  if (!budgetLine || Number(budgetLine[1]) !== expected.releaseBudgetKiB.actual || Number(budgetLine[2]) !== expected.releaseBudgetKiB.limit) fail('Release budget no longer matches the accepted report')
  if (credential.status !== expected.credentialScanStatus) fail('Credential scan status is not PASSED')
  const findings = credential.findings
  if (!Array.isArray(findings) || findings.length !== expected.credentialFindings) fail('Credential scan findings are not an empty array')
  if (frozen.valid !== true || (frozen.errors || []).length !== 0) fail('Frozen benchmark validation failed')
  for (const key of ['v1', 'v2', 'v21', 'protocol']) if (frozen[key] !== expected.frozenBenchmarkHashes[key]) fail(`Frozen benchmark hash mismatch: ${key}`)
  if (Array.isArray(frozen.networkAttempts) && frozen.networkAttempts.length) fail('Frozen validation reports network attempts')
  if (safetyIntegrity.status !== 'PASSED'
    || (safetyIntegrity.changedBaselineFiles || []).length !== 0
    || (safetyIntegrity.missingBaselineFiles || []).length !== 0
    || (safetyIntegrity.newFilesOutsideTestsP2Safety || []).length !== 0
    || (safetyIntegrity.productionGitDiffOutsideTestsP2Safety || []).length !== 0
    || (safetyIntegrity.errors || []).length !== 0
    || (safetyIntegrity.networkAttempts || []).length !== 0) fail('Initial safety inventory integrity report did not pass cleanly')
  return {
    p0: { passed: p0.passedCaseCount, total: p0.newSuiteCaseCount, failed: p0.failedCaseCount },
    release: { status: release.status, exitCode: release.exitCode, totalKiB: expected.releaseBudgetKiB.actual, limitKiB: expected.releaseBudgetKiB.limit },
    credential: { status: credential.status, findingCount: findings.length },
    frozenBenchmark: { valid: frozen.valid, errors: frozen.errors, hashes: { v1: frozen.v1, v2: frozen.v2, v21: frozen.v21, protocol: frozen.protocol } },
    safetyIntegrity: { status: safetyIntegrity.status, baselineFileCount: safetyIntegrity.baselineFileCount, unchanged: (safetyIntegrity.changedBaselineFiles || []).length === 0 && (safetyIntegrity.missingBaselineFiles || []).length === 0 },
  }
}

function validateInputs(inputs, acceptance) {
  const definitionPath = resolveRepoPath(inputs.frozenDefinitions)
  const definitionHash = sha256(fs.readFileSync(definitionPath))
  if (definitionHash.toUpperCase() !== acceptance.observationDefinitionsSha256.toUpperCase()) fail('FROZEN_CLASSIFICATIONS.md hash changed')
  const canonicalA = readJson(inputs.canonicalAnchors.phaseA)
  const canonicalB = readJson(inputs.canonicalAnchors.phaseB)
  const reproductionA = readJson(inputs.reproductions.phaseA)
  const reproductionB = readJson(inputs.reproductions.phaseB)
  const anchors = validateCaseRecords(canonicalA, canonicalB, acceptance, 'canonical anchor')
  const reproductions = validateCaseRecords(reproductionA, reproductionB, acceptance, 'current reproduction')
  const operationalChecks = validateOperationalChecks(inputs, acceptance)
  const validJsonFiles = validateSafetyJsonTree()
  return { frozenDefinitionsSha256: definitionHash.toUpperCase(), anchors, reproductions, operationalChecks, validJsonFiles }
}

function validateSafetyJsonTree(root = path.resolve(repoRoot, 'tests/p2-safety')) {
  let count = 0
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) fail(`Symbolic links are not allowed in safety directory: ${file}`)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        try { JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { fail(`Invalid JSON ${file}: ${error.message}`) }
        count += 1
      }
    }
  }
  visit(root)
  return count
}

function canonicalPayload(files) {
  return files.map(({ path: relative, sha256: hash }) => `${hash}  ${relative}`).join('\n')
}
function makeManifest(files, createdAt = new Date().toISOString()) {
  const ordered = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return {
    schemaVersion: 1,
    scope: 'Every regular file under tests/p2-safety recursively, except tests/p2-safety/safety-baseline/manifest.json itself.',
    canonicalization: 'Sort POSIX relative paths by JavaScript ordinal string order; serialize each entry as lowercase SHA-256, two spaces, relative path; join entries with LF and no trailing LF; hash the UTF-8 payload with SHA-256.',
    createdAt,
    fileCount: ordered.length,
    files: ordered,
    baselineSha256: sha256(Buffer.from(canonicalPayload(ordered), 'utf8')),
  }
}
function verifyManifestData(manifest, currentPaths, readBytes) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) fail('Malformed baseline manifest')
  const entries = manifest.files
  if (entries.length !== manifest.fileCount) fail('Baseline manifest fileCount mismatch')
  const listed = entries.map((entry) => entry.path)
  const sorted = [...listed].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  if (new Set(listed).size !== listed.length || listed.some((item, index) => item !== sorted[index])) fail('Manifest file paths must be unique and ordinal-sorted')
  const actualPaths = [...currentPaths].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  if (actualPaths.length !== listed.length || actualPaths.some((item, index) => item !== listed[index])) fail('Safety directory file set differs from the frozen baseline')
  for (const entry of entries) {
    const bytes = readBytes(entry.path)
    if (entry.size !== bytes.length) fail(`File size mismatch: ${entry.path}`)
    const actualHash = sha256(bytes)
    if (actualHash !== entry.sha256) fail(`File hash mismatch: ${entry.path}`)
  }
  const digest = sha256(Buffer.from(canonicalPayload(entries), 'utf8'))
  if (digest !== manifest.baselineSha256) fail('Baseline manifest digest mismatch')
  return { fileCount: entries.length, baselineSha256: digest }
}
function listSafetyFiles(root = path.resolve(repoRoot, 'tests/p2-safety')) {
  const paths = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) fail(`Symbolic links are not allowed in safety baseline: ${absolute}`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        const relative = path.relative(path.resolve(repoRoot, 'tests/p2-safety'), absolute).split(path.sep).join('/')
        if (relative !== 'safety-baseline/manifest.json') paths.push(relative)
      }
    }
  }
  visit(root)
  return paths.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
}
function snapshotCurrentSafety(root = path.resolve(repoRoot, 'tests/p2-safety')) {
  const safetyRoot = path.resolve(repoRoot, 'tests/p2-safety')
  const files = listSafetyFiles(root).map((relative) => {
    const bytes = fs.readFileSync(path.join(safetyRoot, relative))
    return { path: relative, size: bytes.length, sha256: sha256(bytes) }
  })
  return makeManifest(files)
}
function verifyManifestFile(file = manifestPath) {
  if (!fs.existsSync(file)) fail(`Frozen manifest is missing: ${file}`)
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  const safetyRoot = path.resolve(repoRoot, 'tests/p2-safety')
  return verifyManifestData(
    manifest,
    listSafetyFiles(safetyRoot),
    (relative) => fs.readFileSync(path.join(safetyRoot, relative)),
  )
}

function parseArgs(args) {
  const options = { mode: null, inputs: path.join(here, 'inputs.json') }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--verify' || arg === '--freeze' || arg === '--validate') {
      if (options.mode) fail('Choose only one of --verify or --freeze')
      options.mode = arg.slice(2)
    } else if (arg === '--inputs') {
      options.inputs = path.resolve(args[++index] || '')
    } else fail(`Unknown argument: ${arg}`)
  }
  if (!options.mode) fail('Usage: node baseline.cjs --validate|--verify|--freeze [--inputs <repo-relative-or-absolute-json-path>]')
  return options
}
function main(args = process.argv.slice(2)) {
  const options = parseArgs(args)
  const inputs = JSON.parse(fs.readFileSync(options.inputs, 'utf8'))
  const acceptance = readJson(inputs.acceptance)
  const evidence = validateInputs(inputs, acceptance)
  if (options.mode === 'validate') {
    console.log(JSON.stringify({ mode: 'validate', evidence }, null, 2))
    return
  }
  if (options.mode === 'freeze') {
    const snapshot = snapshotCurrentSafety()
    fs.writeFileSync(manifestPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' })
    console.log(JSON.stringify({ mode: 'freeze', manifest: path.relative(repoRoot, manifestPath).replaceAll('\\', '/'), fileCount: snapshot.fileCount, baselineSha256: snapshot.baselineSha256, evidence }, null, 2))
    return
  }
  const frozen = verifyManifestFile()
  console.log(JSON.stringify({ mode: 'verify', manifest: path.relative(repoRoot, manifestPath).replaceAll('\\', '/'), frozen, evidence }, null, 2))
}

if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}

module.exports = {
  canonicalPayload,
  makeManifest,
  sha256,
  validateCaseRecords,
  validateClassificationLabels,
  validateInputs,
  validatePhasePartition,
  validateSafetyJsonTree,
  verifyManifestData,
}

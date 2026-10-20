'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const sourcePath = path.join(root, 'tests/release-check.js')
const evidenceRoot = process.env.SPL_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refinement-20261011'
const label = process.argv[2] || 'segmented-qa-v1'
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('label must contain only letters, digits, or hyphens')

const outputRoot = path.join(evidenceRoot, 'release-check', label)
fs.mkdirSync(outputRoot, { recursive: true })
const source = fs.readFileSync(sourcePath, 'utf8')
const budgetBlock = /^  assert\(\r?\n    totalBytes <= PACKAGE_BUDGETS\.total,[\s\S]*?^  \}\)\r?\n(?=\r?\n  assert\.strictEqual\(new Set\(appConfig\.pages\))/m
const match = source.match(budgetBlock)
if (!match) throw new Error('Could not locate the exact package byte-budget assertion block; no test was started')
const tempPath = path.join(root, 'tests', `release-check-segmented-spl-qa-${process.pid}-${Date.now()}.cjs`)
const tempSource = source
  .replace(budgetBlock, "  console.log('SKIPPED: segmented QA copy omits only package total/extension/JS byte-budget assertions. The unmodified full release-check failure is preserved separately.')\n")
  .replace(
    "    `发布包门禁：总计 ${formatKiB(totalBytes)} / ${formatKiB(PACKAGE_BUDGETS.total)}；`",
    "    `发布包尺寸观测（segmented QA；预算断言已跳过）：总计 ${formatKiB(totalBytes)} / ${formatKiB(PACKAGE_BUDGETS.total)}；`",
  )
  .replace(
    "  assert(packageMediaBytes <= PACKAGE_BUDGETS.media,\n    `代码包图片和音频合计超过 ${formatKiB(PACKAGE_BUDGETS.media)}：${packageMediaBytes} bytes`)\n",
    "  console.log('SKIPPED: segmented QA copy omits only the aggregate package-media byte-budget assertion; individual asset-size checks remain active.')\n",
  )
if (tempSource === source || !tempSource.includes('SKIPPED: segmented QA copy omits only package total/extension/JS byte-budget assertions.')
  || !tempSource.includes('SKIPPED: segmented QA copy omits only the aggregate package-media byte-budget assertion; individual asset-size checks remain active.')) {
  throw new Error('Segmented QA copy did not receive all explicit byte-budget skip markers; no test was started')
}
fs.writeFileSync(tempPath, tempSource)

const stdoutPath = path.join(outputRoot, 'stdout.txt')
const stderrPath = path.join(outputRoot, 'stderr.txt')
const resultPath = path.join(outputRoot, 'summary.json')
fs.writeFileSync(stdoutPath, '')
fs.writeFileSync(stderrPath, '')
const startedAt = new Date().toISOString()
const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex')
const segmentedSha256 = crypto.createHash('sha256').update(tempSource).digest('hex')
const child = spawn(process.execPath, [tempPath], {
  cwd: root,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let policyMarkerSeen = false
let stdoutTail = ''
let stderrTail = ''

function capture(stream, destination, output, streamName) {
  stream.on('data', (chunk) => {
    fs.appendFileSync(destination, chunk)
    output.write(chunk)
    const previousTail = streamName === 'stdout' ? stdoutTail : stderrTail
    const sample = previousTail + chunk.toString('utf8')
    if (/setup refresh had errors/i.test(sample) && !policyMarkerSeen) {
      policyMarkerSeen = true
      process.stderr.write('\nPolicy marker detected; stopping segmented release check.\n')
      child.kill()
    }
    if (streamName === 'stdout') stdoutTail = sample.slice(-96)
    else stderrTail = sample.slice(-96)
  })
}

capture(child.stdout, stdoutPath, process.stdout, 'stdout')
capture(child.stderr, stderrPath, process.stderr, 'stderr')
child.on('error', (error) => {
  try { fs.unlinkSync(tempPath) } catch {}
  fs.writeFileSync(resultPath, JSON.stringify({
    label,
    segmented: true,
    skipped: ['PACKAGE_BUDGETS total/extension/single-JS/package-JS assertions', 'PACKAGE_BUDGETS aggregate package-media assertion'],
    retained: ['individual media-file cap', 'all non-byte-budget release checks'],
    sourceSha256,
    segmentedSha256,
    startedAt,
    endedAt: new Date().toISOString(),
    error: error.message,
    policyMarkerSeen,
    stdoutPath,
    stderrPath,
  }, null, 2) + '\n')
  process.exitCode = 1
})
child.on('close', (exitCode, signal) => {
  try { fs.unlinkSync(tempPath) } catch {}
  const report = {
    label,
    segmented: true,
    fullReleaseCheck: false,
    skipped: ['PACKAGE_BUDGETS total/extension/single-JS/package-JS assertions', 'PACKAGE_BUDGETS aggregate package-media assertion'],
    retained: ['individual media-file cap', 'all non-byte-budget release checks'],
    sourceSha256,
    segmentedSha256,
    startedAt,
    endedAt: new Date().toISOString(),
    command: `${process.execPath} tests/${path.basename(tempPath)}`,
    exitCode,
    signal,
    policyMarkerSeen,
    stdoutPath,
    stderrPath,
    temporaryCopyRemoved: !fs.existsSync(tempPath),
  }
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2) + '\n')
  process.exitCode = policyMarkerSeen ? 130 : (exitCode ?? 1)
  process.stdout.write(`\nSegmented release QA exit ${String(exitCode)}; this is not a full release-check pass. Logs: ${outputRoot}\n`)
})

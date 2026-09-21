'use strict'

// Offline pre-commit review helper. It deliberately prints only paths and rule IDs.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '../../..')
const defaultReport = path.join(__dirname, 'precommit-credential-scan.json')
const reportArg = process.argv.indexOf('--report')
const checkOnly = process.argv.includes('--check-only')
const reportPath = reportArg >= 0 && process.argv[reportArg + 1]
  ? path.resolve(repoRoot, process.argv[reportArg + 1])
  : defaultReport
const proposedRoot = path.join(repoRoot, 'tests', 'p2-safety')
const maxTextBytes = 4 * 1024 * 1024
const textExtensions = new Set([
  '.cjs', '.css', '.csv', '.html', '.ini', '.js', '.json', '.jsx', '.md', '.mjs',
  '.properties', '.py', '.sh', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml', '.wxss', '.wxml',
])

// Compose sensitive signatures from fragments so this scanner does not contain
// ready-to-match examples. The self-test below reconstructs representative fake
// values in memory only.
const patterns = [
  { id: 'private-key-marker', re: new RegExp('-----BEGIN (?:RSA |EC |DSA |OPENSSH )?' + 'PRIVATE KEY-----|-----BEGIN ENCRYPTED ' + 'PRIVATE KEY-----', 'i') },
  { id: 'aws-access-key-literal', re: new RegExp('(?:^|[^A-Z0-9])AKIA[A-Z0-9]{16}(?:$|[^A-Z0-9])') },
  { id: 'github-token-literal', re: new RegExp('(?:gh[pousr]_' + ')[A-Za-z0-9]{30,}') },
  { id: 'slack-token-literal', re: new RegExp('xox[baprs]-[A-Za-z0-9-]{20,}') },
  { id: 'openai-style-token-literal', re: new RegExp('sk-' + '[A-Za-z0-9_-]{24,}') },
  { id: 'google-api-token-literal', re: new RegExp('AIza[0-9A-Za-z_-]{30,}') },
  { id: 'jwt-literal', re: new RegExp(`eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}`) },
  { id: 'authorization-bearer-literal', re: new RegExp(`\\bAuthorization["']?\\s*[:=]\\s*["']?Bearer\\s+(?:"([^"]{12,})"|'([^']{12,})'|([A-Za-z0-9._~+/-]{24,}))`, 'i') },
  { id: 'credential-assignment-literal', re: new RegExp(`\\b(?:typesafe[_-]?api[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|account[_-]?key|auth[_-]?token|session[_-]?token|password|passwd|secret|credential|token)["']?\\s*[:=]\\s*(?:"([^"]{8,})"|'([^']{8,})'|([A-Za-z0-9_./+=-]{32,}))`, 'i') },
]

function isPlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase()
  const explicitPlaceholders = new Set([
    'changeme', 'change-me', 'example', 'sample', 'placeholder',
    'your_api_key_here', 'your_access_token_here', 'replace-me',
    'replace_with_your_value', 'test_token_placeholder', 'xxxxxx',
    'dummy', 'none', 'null', 'undefined',
  ])
  return !normalized
    || /^(?:<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\})$/.test(normalized)
    || /^\$\{?[a-z_][a-z0-9_]*\}?$/i.test(normalized)
    || /^%[a-z_][a-z0-9_]*%$/i.test(normalized)
    || explicitPlaceholders.has(normalized)
    || /^(?:process\.env|env|environment)\.[a-z0-9_]+$/i.test(normalized)
}

function contentFindings(relativePath, content) {
  const findings = []
  for (const pattern of patterns) {
    const re = new RegExp(pattern.re.source, `${pattern.re.flags}g`)
    let match
    let found = false
    while ((match = re.exec(content)) !== null) {
      if ((pattern.id === 'credential-assignment-literal' || pattern.id === 'authorization-bearer-literal')
        && isPlaceholder(match[1] || match[2] || match[3])) continue
      found = true
      break
    }
    if (found) findings.push({ path: relativePath, rule: pattern.id })
  }
  if (isPlaintextConfig(relativePath)) {
    const configAssignment = new RegExp(`^\\s*(?:export\\s+)?\\b(?:typesafe[_-]?api[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|account[_-]?key|auth[_-]?token|session[_-]?token|password|passwd|secret|credential|token)["']?\\s*[:=]\\s*["']?([^"'\\s#;,}]{8,})`, 'gim')
    let match
    while ((match = configAssignment.exec(content)) !== null) {
      if (!isPlaceholder(match[1])) {
        findings.push({ path: relativePath, rule: 'credential-assignment-literal' })
        break
      }
      if (!match[0].length) break
    }
    const configBearer = new RegExp(`\\bAuthorization["']?\\s*[:=]\\s*["']?Bearer\\s+([^"'\\s#;,}]{12,})`, 'gim')
    while ((match = configBearer.exec(content)) !== null) {
      if (!isPlaceholder(match[1])) {
        findings.push({ path: relativePath, rule: 'authorization-bearer-literal' })
        break
      }
      if (!match[0].length) break
    }
  }
  return findings
}

function isPlaintextConfig(relativePath) {
  const base = path.posix.basename(relativePath.replaceAll('\\', '/')).toLowerCase()
  const extension = path.posix.extname(base)
  return base.startsWith('.env') || ['.env', '.ini', '.toml', '.properties', '.yaml', '.yml'].includes(extension)
}

function filenameRules(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/')
  const base = path.posix.basename(normalized).toLowerCase()
  const findings = []
  if (/(?:^|\/)\.env(?:\.|$)/i.test(normalized)) findings.push({ path: relativePath, rule: 'environment-file-name' })
  if (/(?:^|[._-])private[._-]?config(?:[._-]|$)/i.test(base)) findings.push({ path: relativePath, rule: 'private-config-file-name' })
  if (/(?:^|\/)cache(?:\/|$)/i.test(normalized)) findings.push({ path: relativePath, rule: 'cache-path' })
  if (/(?:credential|secret|private[-_.]?key|api[-_.]?key|token)[-_.]?(?:dump|backup|export|store|vault)?\.(?:bin|dat|db|json|key|pem|p12|pfx|jks|keystore|sqlite|txt)$/i.test(base)) {
    findings.push({ path: relativePath, rule: 'credential-or-key-file-name' })
  }
  if (/\.(?:key|pem|p12|pfx|jks|keystore)$/i.test(base)) {
    findings.push({ path: relativePath, rule: 'private-key-or-keystore-file-name' })
  }
  return findings
}

function walkFiles(root) {
  const files = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(absolute)
      else if (entry.isFile()) files.push({ absolute, symbolicLink: false })
      else if (entry.isSymbolicLink()) files.push({ absolute, symbolicLink: true })
    }
  }
  return files.sort((a, b) => a.absolute.localeCompare(b.absolute))
}

function inspectFile(absolutePath, relativePath, { filenameScan = true } = {}) {
  const findings = filenameScan ? filenameRules(relativePath) : []
  const stat = fs.statSync(absolutePath)
  if (stat.size > maxTextBytes) return { findings, text: false, reason: 'size-limit' }
  const bytes = fs.readFileSync(absolutePath)
  if (bytes.includes(0)) return { findings, text: false, reason: 'binary' }
  const extension = path.extname(absolutePath).toLowerCase()
  if (!textExtensions.has(extension) && extension !== '') return { findings, text: false, reason: 'non-text-extension' }
  const content = bytes.toString('utf8')
  findings.push(...contentFindings(relativePath, content))
  return { findings, text: true, reason: '' }
}

function walkProposedFiles() {
  const absoluteFiles = walkFiles(proposedRoot)
  const findings = []
  let textFiles = 0
  let binaryOrSkippedFiles = 0
  for (const item of absoluteFiles) {
    const absolutePath = item.absolute
    const relativePath = path.relative(repoRoot, absolutePath).replaceAll('\\', '/')
    if (item.symbolicLink) {
      findings.push(...filenameRules(relativePath), { path: relativePath, rule: 'symbolic-link-file-review' })
      binaryOrSkippedFiles += 1
      continue
    }
    const result = inspectFile(absolutePath, relativePath)
    findings.push(...result.findings)
    if (result.text) textFiles += 1
    else binaryOrSkippedFiles += 1
  }
  return { fileCount: absoluteFiles.length, textFiles, binaryOrSkippedFiles, findings }
}

function scanTrackedProductionText() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'buffer' })
    .toString('utf8').split('\0').filter(Boolean)
    .filter((relativePath) => !relativePath.replaceAll('\\', '/').startsWith('tests/p2-safety/'))
  const findings = []
  let textFiles = 0
  let missingFiles = 0
  let skippedFiles = 0
  for (const relativePath of tracked) {
    const absolutePath = path.join(repoRoot, relativePath)
    if (!fs.existsSync(absolutePath)) { missingFiles += 1; continue }
    const extension = path.extname(absolutePath).toLowerCase()
    if (!textExtensions.has(extension) && extension !== '') { skippedFiles += 1; continue }
    const result = inspectFile(absolutePath, relativePath.replaceAll('\\', '/'), { filenameScan: false })
    if (result.text) textFiles += 1
    else skippedFiles += 1
    findings.push(...result.findings)
  }
  return { trackedFileCount: tracked.length, textFiles, skippedFiles, missingFiles, findings }
}

function selfTest() {
  const fakePrivateMarker = '-----BEGIN RSA ' + 'PRIVATE KEY-----'
  const fakeKey = 'sk-' + 'T'.repeat(32)
  const fakeAssignment = 'api' + '_key=' + 'S'.repeat(32)
  const fakeBearer = 'Authorization: Bearer ' + 'F'.repeat(24)
  const fakeShortConfigBearer = 'Authorization: Bearer ' + 'L'.repeat(16)
  const quotedJsonAssignment = '{"' + 'api' + '_key":"' + 'J'.repeat(32) + '"}'
  const mixedJsonBearer = '{"Authoriza' + 'tion":"Bearer ' + 'B'.repeat(24) + '"}'
  const placeholderThenReal = 'api' + '_key="your_api_key_here"\napi' + '_key="' + 'R'.repeat(32) + '"'
  const configUnquoted = 'API' + '_KEY=' + 'C'.repeat(16)
  const typesafeQuotedJson = '{"TYPE' + 'SAFE_' + 'API' + '_KEY":"' + 'T'.repeat(32) + '"}'
  const typesafeConfig = 'TYPE' + 'SAFE_' + 'API' + '_KEY=' + 'U'.repeat(24)
  const codeExpressions = 'const token = lifecycle.currentToken()\nconst credential = lookupCredential()'
  const envReference = 'const token = process.env.TUNE_BUDDY_TOKEN'
  const synthetic = [fakePrivateMarker, fakeKey, fakeAssignment, fakeBearer,
    quotedJsonAssignment, mixedJsonBearer, placeholderThenReal].join('\n')
  const syntheticRules = contentFindings('in-memory-self-test.txt', synthetic).map((item) => item.rule)
  const expected = new Set([
    'private-key-marker', 'openai-style-token-literal',
    'credential-assignment-literal', 'authorization-bearer-literal',
  ])
  for (const rule of expected) {
    if (!syntheticRules.includes(rule)) throw new Error(`Credential scanner self-test failed: missing ${rule}`)
  }
  if (contentFindings('in-memory-self-test.txt', 'sha256=ABCDEF0123456789'.repeat(4)).length) {
    throw new Error('Credential scanner self-test failed: SHA-256 reference misclassified')
  }
  const positiveInputs = [
    { path: 'in-memory-self-test.json', content: quotedJsonAssignment, rule: 'credential-assignment-literal' },
    { path: 'in-memory-self-test.json', content: mixedJsonBearer, rule: 'authorization-bearer-literal' },
    { path: 'in-memory-self-test.json', content: placeholderThenReal, rule: 'credential-assignment-literal' },
    { path: 'in-memory-self-test.json', content: typesafeQuotedJson, rule: 'credential-assignment-literal' },
    { path: 'in-memory-self-test.env', content: configUnquoted, rule: 'credential-assignment-literal' },
    { path: 'in-memory-self-test.env', content: typesafeConfig, rule: 'credential-assignment-literal' },
    { path: 'in-memory-self-test.env', content: fakeShortConfigBearer, rule: 'authorization-bearer-literal' },
  ]
  for (const item of positiveInputs) {
    if (!contentFindings(item.path, item.content).some((finding) => finding.rule === item.rule)) {
      throw new Error(`Credential scanner self-test failed: missed ${item.rule}`)
    }
  }
  const fakePlaceholder = 'api' + '_key="your_api_key_here"'
  if (contentFindings('in-memory-self-test.txt', fakePlaceholder).length) {
    throw new Error('Credential scanner self-test failed: placeholder misclassified')
  }
  if (contentFindings('in-memory-self-test.txt', envReference).length) {
    throw new Error('Credential scanner self-test failed: environment variable reference misclassified')
  }
  if (contentFindings('in-memory-self-test.cjs', codeExpressions).length) {
    throw new Error('Credential scanner self-test failed: ordinary code expressions misclassified')
  }
  if (!contentFindings('in-memory-self-test.env', configUnquoted).some((item) => item.rule === 'credential-assignment-literal')) {
    throw new Error('Credential scanner self-test failed: unquoted config assignment missed')
  }
  if (!contentFindings('in-memory-self-test.env', fakeShortConfigBearer).some((item) => item.rule === 'authorization-bearer-literal')) {
    throw new Error('Credential scanner self-test failed: unquoted config bearer missed')
  }
  return { fakePositiveCases: expected.size + positiveInputs.length, negativeCases: 4 }
}

const selfTestResult = selfTest()
const proposed = walkProposedFiles()
const production = scanTrackedProductionText()
const findings = [...proposed.findings, ...production.findings]
const uniqueFindings = [...new Map(findings.map((finding) => [`${finding.path}\0${finding.rule}`, finding])).values()]
  .sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule))
const report = {
  status: uniqueFindings.length === 0 ? 'PASSED' : 'FAILED',
  scannedAt: new Date().toISOString(),
  scope: {
    proposedCommitFiles: 'All regular files and symlink entries recursively under tests/p2-safety, including this scanner and existing reports/evidence.',
    trackedProductionText: 'Tracked repository text files outside tests/p2-safety; content signatures only, filenames not treated as proposed commit files.',
    skippedContent: `Binary, non-text-extension, or files above ${maxTextBytes} bytes are not content-scanned; filename rules still run for proposed files.`,
    limitations: 'Detects the listed credential and private-key patterns; does not guarantee detection of every secret encoding or credential form.',
    externalDependencies: [],
    environmentKeysRead: false,
    networkUsed: false,
  },
  scannedFiles: {
    proposedCommitTree: proposed.fileCount,
    proposedTextFiles: proposed.textFiles,
    proposedBinaryOrSkippedFiles: proposed.binaryOrSkippedFiles,
    trackedProductionFiles: production.trackedFileCount,
    trackedProductionTextFiles: production.textFiles,
    trackedProductionSkippedOrBinaryFiles: production.skippedFiles,
    trackedProductionMissingFiles: production.missingFiles,
  },
  selfTest: selfTestResult,
  findings: uniqueFindings,
}
if (!checkOnly) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
}
process.stdout.write(`${JSON.stringify({ status: report.status, findings: report.findings.length, scannedFiles: report.scannedFiles, report: checkOnly ? 'read-only check; report not modified' : path.relative(repoRoot, reportPath).replaceAll('\\', '/') }, null, 2)}\n`)
if (report.status !== 'PASSED') process.exitCode = 1

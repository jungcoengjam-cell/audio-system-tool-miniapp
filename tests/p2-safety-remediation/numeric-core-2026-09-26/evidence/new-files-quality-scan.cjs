'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../../../..')
const scanRoot = path.resolve(__dirname, '..')
const reportPath = path.join(__dirname, 'new-files-quality-scan.json')
const reportRelative = path.relative(root, reportPath).replaceAll(path.sep, '/')
const scannerRelative = path.relative(root, __filename).replaceAll(path.sep, '/')
const textExtensions = new Set([
  '.cjs', '.css', '.csv', '.html', '.ini', '.js', '.json', '.jsx', '.md', '.mjs',
  '.properties', '.py', '.sh', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml', '.wxss', '.wxml',
])
const credentialRules = [
  ['private-key-marker', new RegExp('-----BEGIN (?:RSA |EC |DSA |OPENSSH )?' + 'PRIVATE KEY-----|-----BEGIN ENCRYPTED ' + 'PRIVATE KEY-----', 'i')],
  ['aws-access-key', new RegExp('(?:^|[^A-Z0-9])AKIA[A-Z0-9]{16}(?:$|[^A-Z0-9])')],
  ['github-token', new RegExp('gh[pousr]_' + '[A-Za-z0-9]{30,}')],
  ['slack-token', new RegExp('xox[baprs]-[A-Za-z0-9-]{20,}')],
  ['openai-style-token', new RegExp('sk-' + '[A-Za-z0-9_-]{24,}')],
  ['google-api-token', new RegExp('AIza[0-9A-Za-z_-]{30,}')],
  ['jwt', new RegExp('eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}')],
  ['authorization-bearer', new RegExp('\\bAuthorization["\']?\\s*[:=]\\s*["\']?Bearer\\s+[^\\s"\']{24,}', 'i')],
  ['credential-assignment', new RegExp('\\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|account[_-]?key|auth[_-]?token|password|passwd|secret|credential|token)["\']?\\s*[:=]\\s*["\']?[^\\s"\']{24,}', 'i')],
]
const sensitiveNameRules = [
  ['environment-file', /^\.env(?:\.|$)/i],
  ['private-config-file', /(?:^|[._-])private[._-]?config(?:[._-]|$)/i],
  ['credential-or-key-file', /(?:credential|secret|private[-_.]?key|api[-_.]?key|token)[-_.]?(?:dump|backup|export|store|vault)?\.(?:bin|dat|db|json|key|pem|p12|pfx|jks|keystore|sqlite|txt)$/i],
  ['private-key-container', /\.(?:key|pem|p12|pfx|jks|keystore)$/i],
]

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    return [{ absolute, isFile: entry.isFile(), isSymbolicLink: entry.isSymbolicLink() }]
  }).sort((left, right) => left.absolute.localeCompare(right.absolute))
}

const entries = walk(scanRoot)
const scannedFiles = []
const skippedFiles = []
const credentialFindings = []
const whitespaceFindings = []
const gitWarnings = []
for (const entry of entries) {
  const relative = path.relative(root, entry.absolute).replaceAll(path.sep, '/')
  if (relative === reportRelative) continue
  if (!entry.isFile) {
    skippedFiles.push({ path: relative, reason: entry.isSymbolicLink ? 'symbolic link' : 'not a regular file' })
    continue
  }
  const bytes = fs.readFileSync(entry.absolute)
  const extension = path.extname(entry.absolute).toLowerCase()
  const basename = path.basename(entry.absolute)
  const filenameFindings = sensitiveNameRules
    .filter(([, rule]) => rule.test(basename))
    .map(([rule]) => ({ path: relative, rule }))
  credentialFindings.push(...filenameFindings)
  if (!textExtensions.has(extension) || bytes.includes(0)) {
    skippedFiles.push({ path: relative, reason: 'non-text extension or NUL byte' })
    continue
  }
  scannedFiles.push(relative)
  const contents = bytes.toString('utf8')
  for (const [rule, pattern] of credentialRules) {
    pattern.lastIndex = 0
    if (pattern.test(contents)) credentialFindings.push({ path: relative, rule })
  }

  const diff = spawnSync('git', ['diff', '--no-index', '--check', '--', 'NUL', relative], {
    cwd: root,
    encoding: 'utf8',
  })
  if (diff.error || (diff.status !== 0 && diff.status !== 1)) {
    whitespaceFindings.push({ path: relative, rule: 'git-diff-check-error', detail: diff.error?.message || diff.stderr || `exit ${diff.status}` })
  } else if (diff.stdout.trim()) {
    whitespaceFindings.push({ path: relative, rule: 'git-diff-check', detail: diff.stdout.trim() })
  }
  if (diff.stderr && /LF will be replaced by CRLF/i.test(diff.stderr)) gitWarnings.push(relative)
  else if (diff.stderr && diff.stderr.trim()) whitespaceFindings.push({ path: relative, rule: 'git-diff-check-stderr', detail: diff.stderr.trim() })
}

const report = {
  status: credentialFindings.length || whitespaceFindings.length ? 'FAILED' : 'PASSED',
  scope: {
    root: path.relative(root, scanRoot).replaceAll(path.sep, '/'),
    credentialExcludedOutput: reportRelative,
    credentialScannerItselfIncluded: scannedFiles.includes(scannerRelative),
    whitespaceCheck: 'git diff --no-index --check against NUL for each regular text file under the new directory; exit 1 is the expected added-file diff status, diagnostics are treated as failures',
    whitespaceExcludedOutput: reportRelative,
  },
  credentialRules: credentialRules.map(([name]) => name).concat(sensitiveNameRules.map(([name]) => `filename:${name}`)),
  files: {
    regularFilesFound: entries.filter((entry) => entry.isFile).length,
    textFilesScanned: scannedFiles.length,
    skipped: skippedFiles,
    scannedPaths: scannedFiles,
  },
  findings: { credentials: credentialFindings, whitespace: whitespaceFindings },
  limitations: [
    'Pattern scan detects the listed literal token/key forms and sensitive filenames; it cannot guarantee detection of every secret encoding or credential form.',
    'The generated report is excluded from credential input to avoid self-reference; it is JSON.stringify output with a single final LF.',
    'The local credential scan supplements the existing scanner, whose scope remains tests/p2-safety plus tracked production text.',
  ],
  normalizerWarnings: { count: gitWarnings.length, kind: 'Git for Windows LF-to-CRLF working-copy notices; not whitespace diagnostics.' },
}
const reportText = JSON.stringify(report, null, 2) + '\n'
report.reportSha256 = crypto.createHash('sha256').update(reportText).digest('hex')
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({
  status: report.status,
  regularFilesFound: report.files.regularFilesFound,
  textFilesScanned: report.files.textFilesScanned,
  skippedFiles: skippedFiles.length,
  credentialRules: report.credentialRules.length,
  credentialFindings: credentialFindings.length,
  whitespaceFindings: whitespaceFindings.length,
  gitNormalizerWarnings: gitWarnings.length,
  report: reportRelative,
}, null, 2))
if (report.status !== 'PASSED') process.exitCode = 1

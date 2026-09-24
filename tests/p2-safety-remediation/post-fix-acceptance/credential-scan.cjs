'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = __dirname
const checkOnly = process.argv.includes('--check-only')
const rules = [
  ['private-key-marker', new RegExp('-----BEGIN (?:RSA |EC |DSA |OPENSSH )?' + 'PRIVATE ' + 'KEY-----|-----BEGIN ENCRYPTED PRIVATE ' + 'KEY-----', 'i')],
  ['aws-key', new RegExp('(?:^|[^A-Z0-9])AKIA[A-Z0-9]{16}(?:$|[^A-Z0-9])')],
  ['github-token', new RegExp('gh[pousr]_[A-Za-z0-9]{30,}')],
  ['slack-token', new RegExp('xox[baprs]-[A-Za-z0-9-]{20,}')],
  ['openai-style-token', new RegExp('sk-[A-Za-z0-9_-]{24,}')],
  ['google-token', new RegExp('AIza[0-9A-Za-z_-]{30,}')],
  ['jwt', new RegExp('eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}')],
  ['bearer', new RegExp('\\bAuthorization[\"\']?\\s*[:=]\\s*[\"\']?Bearer\\s+[^\\s\"\']{24,}', 'i')],
  ['credential-assignment', new RegExp('\\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|credential|token)[\"\']?\\s*[:=]\\s*[\"\']?[^\\s\"\']{24,}', 'i')],
]

const files = fs.readdirSync(root).map((name) => path.join(root, name))
  .filter((file) => fs.statSync(file).isFile()).sort()
const findings = []
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  for (const [rule, pattern] of rules) {
    if (pattern.test(text)) findings.push({ file: path.basename(file), rule })
  }
}
for (const file of files) {
  if (/^\.env(?:\.|$)|private|\.idea|\.vscode/i.test(path.basename(file))) {
    findings.push({ file: path.basename(file), rule: 'sensitive-local-file-name' })
  }
}

const report = {
  status: findings.length ? 'FAILED' : 'PASSED',
  scope: 'Regular files in the post-fix acceptance directory; content and sensitive-local-file-name checks.',
  scannedFiles: files.length,
  findings,
}
if (!checkOnly) fs.writeFileSync(path.join(root, 'credential-scan.json'), `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (findings.length) process.exitCode = 1

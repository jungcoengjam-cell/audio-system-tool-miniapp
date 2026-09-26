const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../..')
const excluded = 'tests/p2-safety-remediation/numeric-core-2026-09-26/'
const bases = ['tests/p2-jev', 'tests/p2-safety', 'tests/p2-safety-remediation']
const checkOnly = process.argv.includes('--check')
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/')
    return relative.startsWith(excluded) ? [] : [absolute]
  })
}
const files = bases.flatMap((base) => walk(path.join(root, base))).sort()
const current = files.map((file) => {
  const bytes = fs.readFileSync(file)
  return {
    path: path.relative(root, file).replaceAll(path.sep, '/'),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }
})
const manifestPath = path.join(__dirname, 'broader-frozen-evidence-manifest.json')
if (checkOnly) {
  const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const byPath = new Map(current.map((item) => [item.path, item]))
  const missingOrChanged = expected.entries.filter((item) => {
    const actual = byPath.get(item.path)
    return !actual || actual.bytes !== item.bytes || actual.sha256 !== item.sha256
  }).map((item) => item.path)
  const added = current.filter((item) => !expected.entries.some((original) => original.path === item.path))
    .map((item) => item.path)
  const passed = !missingOrChanged.length && !added.length && current.length === expected.count
  console.log(JSON.stringify({ status: passed ? 'PASSED' : 'FAILED', frozenFiles: expected.count, currentFiles: current.length, missingOrChanged, added }, null, 2))
  if (!passed) process.exitCode = 1
} else {
  const manifest = {
    createdAt: new Date().toISOString(),
    roots: bases,
    excludedPath: excluded,
    count: current.length,
    totalBytes: current.reduce((sum, item) => sum + item.bytes, 0),
    entries: current,
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ status: 'FROZEN', files: manifest.count, totalBytes: manifest.totalBytes }, null, 2))
}

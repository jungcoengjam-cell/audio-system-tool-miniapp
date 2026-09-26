const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../..')
const target = path.join(root, 'tests/p2-jev/deterministic-core-numeric-safety-phase1')
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(item) : [item]
  }).sort()
}
const entries = walk(target).map((file) => ({
  path: path.relative(root, file).replaceAll(path.sep, '/'),
  bytes: fs.statSync(file).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
}))
const manifestPath = path.join(__dirname, 'phase1-frozen-manifest.json')
if (process.argv.includes('--check')) {
  const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const same = JSON.stringify(entries) === JSON.stringify(expected.entries)
    && entries.length === expected.count
  console.log(JSON.stringify({ status: same ? 'PASSED' : 'FAILED', frozenFiles: expected.count, currentFiles: entries.length }, null, 2))
  if (!same) process.exitCode = 1
} else {
  const manifest = { createdAt: new Date().toISOString(), count: entries.length, entries }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  console.log(`Frozen Phase1 files: ${entries.length}`)
}

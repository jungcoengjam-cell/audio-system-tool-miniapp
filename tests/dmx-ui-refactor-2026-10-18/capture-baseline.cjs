const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const out = path.join(__dirname, 'baseline')
if (fs.existsSync(out)) throw Error('Baseline already exists; preserve the original snapshot.')
fs.mkdirSync(out, { recursive: true })
const sources = {}
function capture(relative) {
  const absolute = path.join(root, relative)
  if (fs.statSync(absolute).isDirectory()) {
    for (const name of fs.readdirSync(absolute)) capture(path.posix.join(relative, name))
    return
  }
  const bytes = fs.readFileSync(absolute)
  sources[relative] = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
  const destination = path.join(out, 'source', relative)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, bytes)
}
for (const relative of ['pages/dmx-address', 'pages/dmx-layout', 'pages/dmx-layout-landscape', 'utils/dmx-address.js', 'utils/preferences.js', 'utils/records.js', 'data/stage-lighting.js']) capture(relative)
fs.writeFileSync(path.join(out, 'sources.json'), JSON.stringify(sources, null, 2))
const status = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8', windowsHide: true })
fs.writeFileSync(path.join(out, 'pre-existing-status.txt'), status.stdout || status.stderr || '')
const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => /^(?:dmx-.*|audit-dmx-regression)\.js$/.test(name))
const results = []
for (const name of tests) {
  const result = spawnSync(process.execPath, ['tests/' + name], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
  fs.writeFileSync(path.join(out, name + '.stdout.txt'), result.stdout || '')
  fs.writeFileSync(path.join(out, name + '.stderr.txt'), result.stderr || '')
  results.push({ name, exitCode: result.status, error: result.error?.message || null })
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${name}`)
}
fs.writeFileSync(path.join(out, 'test-results.json'), JSON.stringify({ capturedAt: new Date().toISOString(), tests: results }, null, 2))
if (results.some(test => test.exitCode !== 0)) process.exitCode = 1

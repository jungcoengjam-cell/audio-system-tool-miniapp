const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const runtime = fs.readdirSync(path.join(root, 'pages/camera')).map((file) => `pages/camera/${file}`)
  .filter((file) => fs.statSync(path.join(root, file)).isFile())
runtime.push('utils/camera-fov.js', 'utils/camera-framing.js')
const entries = runtime.map((file) => {
  const current = path.join(root, file)
  const baseline = file.startsWith('pages/camera/') ? path.join(__dirname, 'before/camera', path.basename(file))
    : path.basename(file) === 'camera-fov.js' ? path.join(__dirname, 'before/camera-fov.js') : null
  return { file, bytes: fs.statSync(current).size, sha256: hash(current),
    beforeBytes: baseline && fs.existsSync(baseline) ? fs.statSync(baseline).size : 0,
    beforeSha256: baseline && fs.existsSync(baseline) ? hash(baseline) : null }
})
for (const name of ['camera-project.js', 'camera-report-ui.js', 'camera-overlays.wxml', 'camera.json']) {
  const entry = entries.find((file) => path.basename(file.file) === name)
  if (entry.sha256 !== entry.beforeSha256) throw new Error(`Preserved camera controller changed: ${name}`)
}
const summary = { files: entries, beforeBytes: entries.reduce((sum, item) => sum + item.beforeBytes, 0),
  afterBytes: entries.reduce((sum, item) => sum + item.bytes, 0),
  scope: 'pages/camera files plus utils/camera-fov.js and utils/camera-framing.js',
  otherExplicitRuntimeChange: 'utils/records.js: camera-only calculation-version marker on restore' }
summary.deltaBytes = summary.afterBytes - summary.beforeBytes
fs.writeFileSync(path.join(__dirname, 'evidence/source-audit.json'), JSON.stringify(summary, null, 2))
console.log(`Camera runtime byte delta: ${summary.deltaBytes}; preserved controllers match initial copies`)

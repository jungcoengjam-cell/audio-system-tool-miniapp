const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const compiler = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/'
const dependencies = new Set()
function collect(file) {
  if (dependencies.has(file)) return
  dependencies.add(file)
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  for (const [, name] of source.matchAll(/@import\s+["']([^"']+)["']/g)) collect(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)))
}
collect('pages/camera/camera.wxss')
const results = []
for (const item of [
  { name: 'wxml', exe: 'wcc.exe', args: ['-d', '-o', path.join(__dirname, 'evidence/camera.wxml.compiled.txt'),
    'pages/camera/camera.wxml', 'pages/camera/camera-overlays.wxml', 'pages/common/operation-confirmation.wxml', 'templates/result-report-preview.wxml'] },
  { name: 'wxss', exe: 'wcsc.exe', args: ['-o', path.join(__dirname, 'evidence/camera.wxss.compiled.txt'), ...dependencies] },
]) {
  const run = spawnSync(path.join(compiler, item.exe), item.args, { cwd: root, windowsHide: true, encoding: 'utf8' })
  fs.writeFileSync(path.join(__dirname, `evidence/${item.name}-compile.log`), (run.stdout || '') + (run.stderr || ''))
  results.push({ name: item.name, status: run.status, error: run.error?.message || null })
}
fs.writeFileSync(path.join(__dirname, 'evidence/compile.json'), JSON.stringify(results, null, 2))
console.log(results)
if (results.some((item) => item.status !== 0)) process.exitCode = 1

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, 'evidence/compile')
const binaries = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
const xml = new Set(), css = new Set()
function collect(relative, files, expression) {
  if (files.has(relative)) return
  files.add(relative)
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  for (const [, dependency] of source.matchAll(expression)) {
    collect(path.posix.normalize(path.posix.join(path.posix.dirname(relative), dependency)), files, expression)
  }
}
for (const entry of ['pages/control-protocol/index', 'pages/control-protocol/detail']) {
  collect(entry + '.wxml', xml, /<(?:include|import)\s+src=["']([^"']+)["']/g)
  collect(entry + '.wxss', css, /@import\s+["']([^"']+)["']/g)
  JSON.parse(fs.readFileSync(path.join(root, entry + '.json'), 'utf8'))
}
collect('app.wxss', css, /@import\s+["']([^"']+)["']/g)
fs.mkdirSync(output, { recursive: true })
const commands = [
  { name: 'wcc', args: ['-d', '-o', path.join(output, 'wxml.compiled.txt'), ...xml] },
  { name: 'wcsc', args: ['-js', '-pc', String(css.size), ...css] },
]
const results = commands.map(command => {
  const executable = path.join(binaries, command.name + '.exe')
  const result = spawnSync(executable, command.args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  fs.writeFileSync(path.join(output, command.name + '.stdout.txt'), result.stdout || '')
  fs.writeFileSync(path.join(output, command.name + '.stderr.txt'), result.stderr || '')
  return { name: command.name, executable, exitCode: result.status, error: result.error?.message || null, stderr: result.stderr || '', stdoutBytes: Buffer.byteLength(result.stdout || '') }
})
const scripts = ['index.js', 'detail.js', 'viewer-state.js'].map(file => 'pages/control-protocol/' + file).filter(file => fs.existsSync(path.join(root, file)))
for (const file of scripts) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8', windowsHide: true })
  results.push({ name: 'node --check ' + file, exitCode: result.status, stderr: result.stderr || '', error: result.error?.message || null })
}
const sources = Object.fromEntries([...xml, ...css, ...scripts].sort().map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
const summary = { runAt: new Date().toISOString(), officialTemplateAndStyleCompilation: true, sources, results }
fs.writeFileSync(path.join(output, 'compile.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ sources: Object.keys(sources).length, results }, null, 2))
if (results.some(result => result.exitCode !== 0 || result.error)) process.exitCode = 1

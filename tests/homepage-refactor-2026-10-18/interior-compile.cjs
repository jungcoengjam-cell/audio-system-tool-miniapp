'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, 'evidence/interior-compile')
const binaries = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
const xml = ['pages/records/project.wxml']
const css = ['pages/records/project.wxss', 'styles/homepage.wxss']
const scripts = ['pages/records/project.js', 'pages/records/project-view-model.js']
JSON.parse(fs.readFileSync(path.join(root, 'pages/records/project.json'), 'utf8'))
fs.mkdirSync(output, { recursive: true })

const commands = [
  { name: 'wcc', args: ['-d', '-o', path.join(output, 'wxml.compiled.txt'), ...xml] },
  { name: 'wcsc', args: ['-js', '-pc', String(css.length), ...css] },
]
const results = commands.map((command) => {
  const executable = path.join(binaries, `${command.name}.exe`)
  const result = spawnSync(executable, command.args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  fs.writeFileSync(path.join(output, `${command.name}.stdout.txt`), result.stdout || '')
  fs.writeFileSync(path.join(output, `${command.name}.stderr.txt`), result.stderr || '')
  return { name: command.name, exitCode: result.status, error: result.error?.message || null, stderr: result.stderr || '' }
})
for (const file of scripts) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8', windowsHide: true })
  results.push({ name: `node --check ${file}`, exitCode: result.status, error: result.error?.message || null, stderr: result.stderr || '' })
}

const sources = [...xml, ...css, ...scripts, 'pages/records/project.json'].sort()
  .map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])
const summary = { runAt: new Date().toISOString(), officialTemplateAndStyleCompilation: true, sources: Object.fromEntries(sources), results }
fs.writeFileSync(path.join(output, 'compile.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify({ sourceCount: sources.length, results }, null, 2))
if (results.some((result) => result.exitCode !== 0 || result.error)) process.exitCode = 1

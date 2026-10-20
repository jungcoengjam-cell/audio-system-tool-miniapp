'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const tools = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
const out = path.join(__dirname, 'evidence', 'official-compile')
const sources = ['pages/audio-wiring/index.wxml', 'templates/result-report-preview.wxml', 'pages/audio-wiring/index.wxss', 'styles/theme-page-shared.wxss', 'app.wxss']
const hashes = Object.fromEntries(sources.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
fs.mkdirSync(out, { recursive: true })
const results = [
  ['wcc', ['-d', ...sources.filter((file) => file.endsWith('.wxml'))]],
  ['wcsc', ['-js', '-pc', '3', ...sources.filter((file) => file.endsWith('.wxss'))]],
].map(([name, args]) => {
  const result = spawnSync(path.join(tools, `${name}.exe`), args, { cwd: root, encoding: 'utf8', windowsHide: true })
  fs.writeFileSync(path.join(out, `${name}.stdout.txt`), result.stdout || '')
  fs.writeFileSync(path.join(out, `${name}.stderr.txt`), result.stderr || '')
  return { name, args, exitCode: result.status, error: result.error?.message || null }
})
const changedSources = sources.filter((file) => hashes[file] !== crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'))
const summary = { scope: 'Official WeChat WXML/WXSS static compilation only; runtime/device not tested', tools, results, hashes, changedSources, passed: results.every((result) => result.exitCode === 0) && !changedSources.length }
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(JSON.stringify({ passed: summary.passed, results, changedSources }, null, 2) + '\n')
if (!summary.passed) process.exitCode = 1

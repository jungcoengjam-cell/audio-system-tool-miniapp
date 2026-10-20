'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const evidenceRoot = process.env.SPL_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refinement-20261011'
const label = process.argv[2] || 'final-candidate'
const toolRoot = process.env.WECHAT_WCC_ROOT
  || 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
const outputRoot = path.join(evidenceRoot, 'official-compile', label)

if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('label must contain only letters, digits, or hyphens')
fs.mkdirSync(outputRoot, { recursive: true })

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function walk(relative) {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? walk(`${relative}/${entry.name}`)
      : [`${relative}/${entry.name}`])
}

const sources = [
  ...walk('pages'),
  ...walk('styles'),
  ...walk('templates'),
  'app.wxss',
].filter((file) => /\.(wxml|wxss)$/.test(file)).sort()
const wxml = sources.filter((file) => file.endsWith('.wxml'))
const wxss = sources.filter((file) => file.endsWith('.wxss'))
const manifest = sources.map((file) => ({ path: file, sha256: digest(path.join(root, file)) }))
const startedAt = new Date().toISOString()

function runCompiler(id, args) {
  return new Promise((resolve) => {
    const stdoutPath = path.join(outputRoot, `${id}.stdout.txt`)
    const stderrPath = path.join(outputRoot, `${id}.stderr.txt`)
    fs.writeFileSync(stdoutPath, '')
    fs.writeFileSync(stderrPath, '')
    const child = spawn(path.join(toolRoot, `${id}.exe`), args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let markerSeen = false
    let tail = ''
    const capture = (stream, targetPath, display) => stream.on('data', (chunk) => {
      fs.appendFileSync(targetPath, chunk)
      if (display) display.write(chunk)
      const sample = tail + chunk.toString('utf8')
      if (/setup refresh had errors/i.test(sample) && !markerSeen) {
        markerSeen = true
        process.stderr.write(`Policy marker detected during ${id}; stopping compile attempt.\n`)
        child.kill()
      }
      tail = sample.slice(-96)
    })
    capture(child.stdout, stdoutPath, null)
    capture(child.stderr, stderrPath, null)
    child.on('error', (error) => resolve({ id, error: error.message, markerSeen, stdoutPath, stderrPath }))
    child.on('close', (exitCode, signal) => resolve({ id, exitCode, signal, markerSeen, stdoutPath, stderrPath }))
  })
}

async function main() {
  const results = []
  if (!fs.existsSync(path.join(toolRoot, 'wcc.exe')) || !fs.existsSync(path.join(toolRoot, 'wcsc.exe'))) {
    results.push({ error: `Official compiler binaries unavailable at ${toolRoot}` })
  } else {
    results.push(await runCompiler('wcc', ['-d', ...wxml]))
    if (!results.at(-1).markerSeen && !results.at(-1).error) {
      results.push(await runCompiler('wcsc', ['-js', '-pc', String(wxss.length), ...wxss]))
    }
  }
  const changedSources = manifest.filter((item) => digest(path.join(root, item.path)) !== item.sha256).map((item) => item.path)
  const summary = {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    tool: 'Official local WeChat Developer Tools WCC/WCSC; static compiler evidence only',
    toolRoot,
    sourceCounts: { total: sources.length, wxml: wxml.length, wxss: wxss.length },
    sourceStable: changedSources.length === 0,
    changedSources,
    results,
    manifest,
  }
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  process.stdout.write(`${JSON.stringify({
    status: results.some((result) => result.markerSeen) ? 'stopped-by-policy-marker'
      : results.some((result) => result.exitCode !== 0 || result.error) || changedSources.length ? 'failed' : 'passed',
    outputRoot,
    sourceCounts: summary.sourceCounts,
    sourceStable: summary.sourceStable,
    results: results.map(({ id, exitCode, signal, markerSeen, error }) => ({ id, exitCode, signal, markerSeen, error })),
  }, null, 2)}\n`)
  if (results.some((result) => result.markerSeen)) process.exitCode = 130
  else if (results.some((result) => result.exitCode !== 0 || result.error) || changedSources.length) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + '\n')
  process.exitCode = 1
})

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

function runDmxCompile(entryDirectory, nativeRuntime) {
  const root = path.resolve(entryDirectory, '../..')
  const output = process.env.DMX_COMPILE_OUTPUT_DIR
    ? path.resolve(root, process.env.DMX_COMPILE_OUTPUT_DIR)
    : path.join(entryDirectory, 'evidence/compile')
  const binaries = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec'
  const xml = new Set()
  const css = new Set()

  function collect(relative, set, expression) {
    if (set.has(relative)) return
    set.add(relative)
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    for (const [, dependency] of source.matchAll(expression)) {
      collect(path.posix.normalize(path.posix.join(path.posix.dirname(relative), dependency)), set, expression)
    }
  }

  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const entries = [
    ...(appConfig.pages || []),
    ...(appConfig.subPackages || []).flatMap((pkg) => (pkg.pages || []).map((page) => path.posix.join(pkg.root, page))),
  ].filter((entry) => /^pages\/dmx-/.test(entry))
  if (!entries.length) throw new Error('No registered DMX pages found in app.json')

  for (const entry of entries) {
    collect(`${entry}.wxml`, xml, /<(?:include|import)\s+src=["']([^"']+)["']/g)
    collect(`${entry}.wxss`, css, /@import\s+["']([^"']+)["']/g)
    JSON.parse(fs.readFileSync(path.join(root, `${entry}.json`), 'utf8'))
  }
  collect('app.wxss', css, /@import\s+["']([^"']+)["']/g)

  fs.mkdirSync(output, { recursive: true })
  const commands = [
    { name: 'wcc', args: ['-d', '-o', path.join(output, 'wxml.compiled.txt'), ...xml] },
    { name: 'wcsc', args: ['-js', '-pc', String(css.size), ...css] },
  ]
  const results = commands.map((command) => {
    const exe = path.join(binaries, `${command.name}.exe`)
    const result = spawnSync(exe, command.args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    })
    fs.writeFileSync(path.join(output, `${command.name}.stdout.txt`), result.stdout || '')
    fs.writeFileSync(path.join(output, `${command.name}.stderr.txt`), result.stderr || '')
    return {
      ...command,
      exe,
      exitCode: result.status,
      error: result.error?.message || null,
      stderr: result.stderr || '',
      stdoutBytes: Buffer.byteLength(result.stdout || ''),
    }
  })
  const sources = Object.fromEntries([...xml, ...css].sort().map((relative) => [
    relative,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex'),
  ]))
  const summary = {
    runAt: new Date().toISOString(),
    registeredDmxPages: entries,
    appJsonSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'app.json'))).digest('hex'),
    officialSourceCompilation: true,
    nativeRuntime,
    physicalDevice: 'NOT RUN',
    sources,
    results,
  }
  fs.writeFileSync(path.join(output, 'compile.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  if (results.some((result) => result.exitCode !== 0 || result.error)) process.exitCode = 1
}

module.exports = { runDmxCompile }

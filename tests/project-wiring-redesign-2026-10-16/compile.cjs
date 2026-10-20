const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..'), output = path.resolve(process.env.WIRING_QA_COMPILE_OUTPUT || path.join(__dirname, 'evidence/compile'))
const compilers = 'E:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/'
const xml = new Set(), css = new Set()
function collectXml(name) { if (xml.has(name)) return; xml.add(name); const source = fs.readFileSync(path.join(root, name), 'utf8'); for (const [, dependency] of source.matchAll(/<(?:include|import)\s+src=["']([^"']+)["']/g)) collectXml(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency))) }
function collectCss(name) { if (css.has(name)) return; css.add(name); const source = fs.readFileSync(path.join(root, name), 'utf8'); for (const [, dependency] of source.matchAll(/@import\s+["']([^"']+)["']/g)) collectCss(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency))) }
collectXml('pages/project-wiring/index.wxml'); collectCss('pages/project-wiring/index.wxss'); collectCss('app.wxss')
fs.mkdirSync(output, { recursive: true })
const executions = [
  { name: 'wcc', files: [...xml], args: ['-d', '-o', path.join(output, 'wxml.compiled.txt'), ...xml] },
  { name: 'wcsc', files: [...css], args: ['-js', '-pc', String(css.size), ...css] },
].map(item => {
  const exe = path.join(compilers, item.name + '.exe'), result = spawnSync(exe, item.args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  fs.writeFileSync(path.join(output, item.name + '.stdout.txt'), result.stdout || ''); fs.writeFileSync(path.join(output, item.name + '.stderr.txt'), result.stderr || '')
  return { name: item.name, exe, args: item.args, files: item.files, exitCode: result.status, error: result.error?.message || null, stdoutBytes: Buffer.byteLength(result.stdout || ''), stderr: result.stderr || '' }
})
const sources = Object.fromEntries([...xml, ...css].sort().map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]))
const summary = { runAt: new Date().toISOString(), nativeSourceCompileOnly: true, nativeRuntime: 'NOT RUN', physicalDevice: 'NOT RUN', sources, executions }
fs.writeFileSync(path.join(output, 'compile.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2))
if (executions.some(item => item.exitCode !== 0 || item.error)) process.exitCode = 1

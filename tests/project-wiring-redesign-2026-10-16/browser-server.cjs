const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { createRuntime, makeFixture, root } = require('./runtime.cjs')
const port = Number(process.env.WIRING_QA_PORT) || 8377
const evidence = path.resolve(process.env.WIRING_QA_EVIDENCE || path.join(__dirname, 'evidence'))
const sessions = new Map()
const beforeRoot = path.resolve(process.env.WIRING_QA_BEFORE_ROOT || 'C:/Users/wxx/AppData/Local/Temp/project-wiring-native-ui-20261016-222122')
const beforeFiles = new Set(['index.wxml', 'workspace-ui.js', 'workspace.wxml', 'workspace.wxss'])
function sourceFile(relative, before = false) { return before && relative.startsWith('pages/project-wiring/') && beforeFiles.has(path.basename(relative)) ? path.join(beforeRoot, path.basename(relative)) : path.join(root, relative) }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function sources(before = false) {
  const names = ['app.wxss', 'styles/theme-page-shared.wxss', 'utils/project-wiring.js', 'utils/records.js']
  for (const name of fs.readdirSync(path.join(root, 'pages/project-wiring'))) if (/\.(?:js|wxml|wxss)$/.test(name)) names.push('pages/project-wiring/' + name)
  return Object.fromEntries(names.sort().map(name => [name, hash(fs.readFileSync(sourceFile(name, before)))]))
}
function bundle(entry) {
  const modules = {}
  function collect(relative) {
    if (Object.hasOwn(modules, relative)) return
    const text = fs.readFileSync(path.join(root, relative), 'utf8')
    modules[relative] = text
    for (const [, dependency] of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      if (!dependency.startsWith('.')) throw Error(`Browser module requires unsupported ${dependency}`)
      let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), dependency))
      if (!path.posix.extname(resolved)) resolved += '.js'
      collect(resolved)
    }
  }
  collect(entry)
  return modules
}
function json(response, value, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`)
    if (url.pathname === '/__meta') return json(response, { sources: sources(), limits: 'Chromium WXML/WXSS and Canvas2D adapter; not native WeChat runtime or physical device.' })
    if (url.pathname === '/__snapshot' && request.method === 'GET') {
      const id = url.searchParams.get('id')
      const env = sessions.get(id)
      if (!env) return json(response, { error: 'Session expired' }, 404)
      // Read-only visibility into timer-driven fixture state. This deliberately
      // does not dispatch a page method or mutate the isolated runtime.
      return json(response, { id, ...env.snapshot(), sources: sources(env.sourceVersion === 'before') })
    }
    if (url.pathname === '/__session') {
      const options = Object.fromEntries(url.searchParams)
      for (const key of ['count', 'width', 'height']) if (options[key]) options[key] = Number(options[key])
      if (options.sourceVersion === 'before') options.workspaceUiSource = path.join(beforeRoot, 'workspace-ui.js')
      const env = createRuntime(options)
      // Optional isolated fixtures for the module-preference QA runner. These
      // values live only in this runtime's in-memory wx mock.
      if (options.activeProjectId && options.activeProjectId !== '__default__') env.storage['audioTool.activeProject.v1'] = options.activeProjectId === '__none__' ? '' : options.activeProjectId
      if (options.viewPreferenceJson) env.storage['audioTool.projectWiring.view.v1'] = JSON.parse(options.viewPreferenceJson)
      env.page(options.routeId ? { id: options.routeId } : {})
      env.sourceVersion = options.sourceVersion
      const id = crypto.randomUUID(); sessions.set(id, env)
      return json(response, { id, ...env.snapshot(), sources: sources(env.sourceVersion === 'before') })
    }
    if (url.pathname === '/__dispatch' && request.method === 'POST') {
      const input = await body(request); const env = sessions.get(input.id)
      if (!env) return json(response, { error: 'Session expired' }, 404)
      env.activate()
      let photoSaveResult
      if (input.selectors) env.setSelectors(input.selectors)
      if (input.action === 'write-failure') env.failWrites(input.value)
      else if (input.action === 'read-failure') env.failReads(input.value)
      else if (input.action === 'modal') env.respondModal(input.confirm)
      else if (input.action === 'load-failure') env.applyLoadFailure(input.value || 'QA 模拟项目读取失败')
      else if (input.action === 'defer-photo-save') env.deferPhotoSaveCallbacks(input.value)
      else if (input.action === 'complete-photo-save') photoSaveResult = env.completeNextPhotoSave()
      else if (input.action === 'theme') env.theme(input.value)
      else if (input.action === 'resize') env.resize(input.value || {})
      else if (input.action === 'reload') env.page()
      else await env.dispatch(input.method, input.dataset, input.detail, input.extra)
      return json(response, { id: input.id, ...env.snapshot(), ...(photoSaveResult ? { photoSaveResult } : {}), sources: sources(env.sourceVersion === 'before') })
    }
    if (url.pathname === '/__bundle') return json(response, bundle('pages/project-wiring/report.js'))
    if (url.pathname === '/__report') {
      const project = makeFixture(url.searchParams.get('fixture') || 'standard', Number(url.searchParams.get('count')) || 4)
      return json(response, { project, sources: sources() })
    }
    if (url.pathname === '/__save' && request.method === 'POST') {
      const input = await body(request)
      if (!/^[a-zA-Z0-9_.-]+$/.test(input.name) || !['png', 'json'].includes(input.type)) return json(response, { error: 'Invalid artifact' }, 400)
      const dir = path.join(evidence, input.type === 'png' ? 'reports' : 'checks'); fs.mkdirSync(dir, { recursive: true })
      const filename = path.join(dir, input.name + '.' + input.type)
      if (input.type === 'png') { if (!String(input.data).startsWith('data:image/png;base64,')) throw Error('PNG required'); fs.writeFileSync(filename, Buffer.from(input.data.split(',')[1], 'base64')) }
      else fs.writeFileSync(filename, JSON.stringify(input.data, null, 2))
      return json(response, { filename, sha256: hash(fs.readFileSync(filename)), bytes: fs.statSync(filename).size })
    }
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '')
    if (!relative) relative = 'tests/project-wiring-redesign-2026-10-16/browser.html'
    const guardedFilename = path.resolve(root, relative)
    if (!guardedFilename.startsWith(root + path.sep)) { response.writeHead(403); return response.end('Forbidden') }
    const filename = sourceFile(relative, url.searchParams.get('qaNativeBefore') === '1')
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { response.writeHead(404); return response.end('Not found') }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wxss': 'text/css', '.wxml': 'text/plain', '.png': 'image/png' }
    response.writeHead(200, { 'Content-Type': (types[path.extname(filename)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' }); fs.createReadStream(filename).pipe(response)
  } catch (error) { json(response, { error: error.stack }, 500) }
})
server.listen(port, '127.0.0.1', () => console.log(`Wiring QA loopback server http://127.0.0.1:${port}`))

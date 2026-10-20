// Isolated source-backed browser QA. This is not the WeChat runtime or a phone test.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const root = path.resolve(__dirname, '../..')
const baseline = path.join(__dirname, 'baseline')
const port = Number(process.env.LIGHTING_QA_PORT) || 8389
function sourceFile(relative, before) {
  const old = path.join(baseline, relative)
  return before && fs.existsSync(old) ? old : path.join(root, relative)
}
function bundle(entry, before) {
  const modules = {}
  function collect(relative) {
    if (modules[relative]) return
    const source = fs.readFileSync(sourceFile(relative, before), 'utf8')
    modules[relative] = source
    for (const [, name] of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      if (!name.startsWith('.')) throw Error('Unexpected external runtime dependency: ' + name)
      let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))
      if (!path.posix.extname(resolved)) resolved += '.js'
      collect(resolved)
    }
  }
  collect(entry)
  return modules
}
const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:' + port)
    if (url.pathname === '/__meta') {
      response.setHeader('Content-Type', 'application/json')
      return response.end(JSON.stringify({ sourceBacked: true, nativeRuntime: false, physicalDevice: false }))
    }
    if (url.pathname === '/__bundle') {
      const entry = url.searchParams.get('entry') || 'pages/dmx-address/dmx-address.js'
      if (!/^pages\/dmx-(?:address|layout|layout-landscape)\/[a-z-]+\.js$/.test(entry)) throw Error('Invalid entry')
      response.setHeader('Content-Type', 'application/json')
      return response.end(JSON.stringify(bundle(entry, url.searchParams.get('before') === '1')))
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'tests/dmx-ui-refinements-2026-10-18/browser.html'
    const resolved = path.resolve(root, relative)
    if (!resolved.startsWith(root + path.sep)) throw Error('Path outside QA workspace')
    const file = sourceFile(relative, url.searchParams.get('qaNativeBefore') === '1')
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.wxss': 'text/plain', '.wxml': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); return response.end('Not found') }
    const bytes = fs.readFileSync(file)
    response.writeHead(200, { 'Content-Type': type + (type.startsWith('image/') ? '' : '; charset=utf-8'), 'Cache-Control': 'no-store' })
    response.end(bytes)
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(error.stack)
  }
})
server.listen(port, '127.0.0.1', () => console.log('Lighting QA on http://127.0.0.1:' + port))

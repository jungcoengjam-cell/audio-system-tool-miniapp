'use strict'

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const qa = path.relative(root, __dirname).replace(/\\/g, '/')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wxss': 'text/css', '.wxml': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' }

function moduleGraph() {
  const modules = {}
  function load(file) {
    if (modules[file]) return
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    modules[file] = source
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))
      if (!path.posix.extname(target)) target += '.js'
      load(target)
    }
  }
  load('pages/audio-wiring/index.js')
  load('utils/records.js')
  return modules
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/modules') {
    const modules = moduleGraph()
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    return response.end(JSON.stringify({ modules, hashes: Object.fromEntries(Object.entries(modules).map(([file, source]) => [file, crypto.createHash('sha256').update(source).digest('hex')])) }))
  }
  const relative = url.pathname === '/' ? `${qa}/browser.html` : decodeURIComponent(url.pathname.slice(1))
  const file = path.resolve(root, relative)
  const publicSource = /^(?:pages\/audio-wiring\/|assets\/|utils\/|templates\/|styles\/)/.test(relative)
    || relative === 'app.wxss' || [`${qa}/browser.html`, `${qa}/browser.js`].includes(relative)
  if (!publicSource || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404)
    return response.end('Not found')
  }
  response.writeHead(200, { 'content-type': `${types[path.extname(file)] || 'text/plain'}; charset=utf-8`, 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(response)
})
server.listen(Number(process.env.WIRING_QA_PORT) || 8163, '127.0.0.1', () => {
  process.stdout.write(`Audio wiring production preview: http://127.0.0.1:${server.address().port}/\nBrowser simulation only: production WXML/WXSS/controllers/canvas, mocked WeChat APIs.\n`)
})

'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { createCameraFixture } = require('./browser-fixtures.cjs')

const root = path.resolve(__dirname, '../..')
const port = Number(process.env.CAMERA_QA_PORT) || 8139
const serverStartedAt = new Date().toISOString()
const sessions = new Map()
const sourceFiles = [
  'pages/camera/camera.js',
  'pages/camera/camera.wxml',
  'pages/camera/camera.wxss',
  'pages/camera/preview-renderer.js',
  'app.wxss',
  'styles/theme-page-shared.wxss',
  'pages/common/operation-confirmation.wxml',
  'templates/result-report-preview.wxml',
  'utils/camera-fov.js',
  'data/cameras.js',
]

function digest(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex')
}

function sourceHashes() {
  return Object.fromEntries(sourceFiles.map((file) => [file, digest(file)]))
}

const loadedHashes = sourceHashes()
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wxss': 'text/css; charset=utf-8',
  '.wxml': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('error', reject)
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (error) { reject(error) }
    })
  })
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  try {
    if (url.pathname === '/__qa-meta') {
      const currentHashes = sourceHashes()
      return sendJson(response, JSON.stringify(currentHashes) === JSON.stringify(loadedHashes) ? 200 : 409, {
        serverStartedAt, loadedHashes, currentHashes,
      })
    }
    if (url.pathname === '/__fixture') {
      const currentHashes = sourceHashes()
      if (JSON.stringify(currentHashes) !== JSON.stringify(loadedHashes)) {
        return sendJson(response, 409, { error: 'Camera production sources changed after bridge start; restart the bridge.', loadedHashes, currentHashes })
      }
      const caseName = url.searchParams.get('case') || 'ground'
      const viewport = {
        width: Number(url.searchParams.get('width')) || 375,
        height: Number(url.searchParams.get('height')) || 812,
      }
      const options = {
        inputTabIndex: url.searchParams.has('tab') ? Number(url.searchParams.get('tab')) : undefined,
        previewViewIndex: url.searchParams.has('view') ? Number(url.searchParams.get('view')) : undefined,
        calculationExpanded: url.searchParams.get('derive') === 'open',
      }
      const fixture = createCameraFixture(caseName, viewport.width, viewport.height, options)
      const sessionId = crypto.randomUUID()
      sessions.set(sessionId, fixture)
      return sendJson(response, 200, {
        sessionId,
        state: fixture.state,
        viewport,
        sourceNote: fixture.sourceNote,
        pendingAction: fixture.pendingAction,
        caseName,
        loadedHashes,
        serverStartedAt,
      })
    }
    if (url.pathname === '/__state') {
      const sessionId = String(url.searchParams.get('sessionId') || '')
      const fixture = sessions.get(sessionId)
      if (!fixture) return sendJson(response, 404, { error: 'Camera fixture session not found.' })
      fixture.env.flushNextTicks()
      return sendJson(response, 200, { state: fixture.page.data })
    }
    if (url.pathname === '/__measure-dom' && request.method === 'POST') {
      const payload = await readJson(request)
      const fixture = sessions.get(String(payload.sessionId || ''))
      if (!fixture) return sendJson(response, 404, { error: 'Camera fixture session not found.' })
      const measurements = payload.measurements && typeof payload.measurements === 'object' ? payload.measurements : {}
      const entries = Object.entries(measurements)
      if (!entries.length) return sendJson(response, 400, { error: 'At least one measured DOM selector height is required.' })
      for (const [selector, rawHeight] of entries) {
        const height = Number(rawHeight)
        if (!/^#[A-Za-z][A-Za-z0-9_-]*$/.test(selector) || !Number.isFinite(height) || height <= 0) {
          return sendJson(response, 400, { error: 'DOM measurements require simple ID selectors and positive heights.' })
        }
        fixture.env.wx.__cameraSelectorRects.set(selector, { height })
      }
      fixture.page._pageVisible = true
      for (const method of ['captureResultHeroHeight', 'captureResultTailHeight']) {
        if (typeof fixture.page[method] === 'function') fixture.page[method]()
      }
      fixture.env.flushNextTicks()
      return sendJson(response, 200, { state: fixture.page.data, measurements })
    }
    if (url.pathname === '/__event' && request.method === 'POST') {
      const payload = await readJson(request)
      const fixture = sessions.get(String(payload.sessionId || ''))
      if (!fixture) return sendJson(response, 404, { error: 'Camera fixture session not found.' })
      const method = String(payload.handler || '')
      if (!method || typeof fixture.page[method] !== 'function') {
        return sendJson(response, 400, { error: `Production camera handler is unavailable: ${method}` })
      }
      const currentTarget = { dataset: payload.dataset || {} }
      const event = { currentTarget, detail: payload.detail || {} }
      fixture.page[method](event)
      fixture.env.flushNextTicks()
      return sendJson(response, 200, { state: fixture.page.data })
    }

    const relativePath = decodeURIComponent(url.pathname === '/' ? '/tests/camera-refactor-2026-10-11/camera-browser.html' : url.pathname)
    const filePath = path.resolve(root, `.${relativePath}`)
    if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(response)
  } catch (error) {
    sendJson(response, 500, { error: String(error && error.stack || error) })
  }
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Camera browser bridge at http://127.0.0.1:${port}\n`)
})

function close() { server.close(() => process.exit(0)) }
process.on('SIGTERM', close)
process.on('SIGINT', close)

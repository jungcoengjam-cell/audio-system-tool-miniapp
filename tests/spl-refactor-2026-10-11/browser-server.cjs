'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const port = Number(process.env.SPL_QA_PORT) || 8137
const evidenceRoot = process.env.SPL_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refinement-20261011'
const reportAssets = {
  ts: {
    pngPath: process.env.SPL_QA_REPORT_PNG
      || path.join(evidenceRoot, 'native', 'ts-803c-single-v5.png'),
    metadataPath: process.env.SPL_QA_REPORT_METADATA
      || path.join(evidenceRoot, 'native', 'default-report-metadata-v5.json'),
  },
  kf: {
    pngPath: process.env.SPL_QA_KF_REPORT_PNG
      || path.join(evidenceRoot, 'native', 'kf-d10f-two-distributed-v6b.png'),
    metadataPath: process.env.SPL_QA_KF_REPORT_METADATA
      || path.join(evidenceRoot, 'native', 'kf-d10f-report-metadata-v6b.json'),
  },
}
const productionFiles = [
  'pages/spl/spl.js',
  'pages/spl/spl.wxml',
  'pages/spl/spl.wxss',
  'pages/spl/spl-report.js',
  'app.wxss',
  'styles/theme-page-shared.wxss',
  'utils/spl.js',
  'data/equipment.js',
]

function digest(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex')
}

function sourceHashes() {
  return Object.fromEntries(productionFiles.map((item) => [item, digest(item)]))
}

function nativeReportMetadata(asset = 'ts') {
  const selected = reportAssets[asset] || reportAssets.ts
  const { pngPath, metadataPath } = selected
  if (!fs.existsSync(pngPath)) return null
  const bytes = fs.readFileSync(pngPath)
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') return null
  let recorded = null
  try { recorded = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) } catch (error) {}
  return {
    path: pngPath,
    url: asset === 'kf' ? '/__report-image?asset=kf' : '/__report-image',
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    pixelWidth: bytes.readUInt32BE(16),
    pixelHeight: bytes.readUInt32BE(20),
    canvasWidth: Number(recorded?.canvasWidth) || 750,
    canvasHeight: Number(recorded?.canvasHeight) || null,
    payload: recorded?.payload || recorded?.record || null,
  }
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

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

fs.mkdirSync(evidenceRoot, { recursive: true })
const startedAt = new Date().toISOString()
const loadedHashes = sourceHashes()
const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  if (url.pathname === '/__report-image') {
    const asset = url.searchParams.get('asset') === 'kf' ? 'kf' : 'ts'
    const metadata = nativeReportMetadata(asset)
    if (!metadata) {
      response.writeHead(424, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ error: 'Native WeChat SPL report PNG is unavailable or invalid.' }))
      return
    }
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': metadata.bytes,
      'cache-control': 'no-store',
      'x-spl-report-sha256': metadata.sha256,
    })
    fs.createReadStream(reportAssets[asset].pngPath).pipe(response)
    return
  }
  if (url.pathname === '/__fixture') {
    try {
      const currentHashes = sourceHashes()
      if (JSON.stringify(currentHashes) !== JSON.stringify(loadedHashes)) {
        response.writeHead(409, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: 'Production sources changed after bridge start; restart bridge.', loadedHashes, currentHashes }))
        return
      }
      const { createFixture } = require('./browser-fixtures.cjs')
      const caseName = url.searchParams.get('case') || 'default'
      const fixture = createFixture(
        caseName,
        Number(url.searchParams.get('width')) || 390,
        Number(url.searchParams.get('height')) || 671,
        nativeReportMetadata(caseName === 'share-long-kf' ? 'kf' : 'ts'),
        Number(url.searchParams.get('baselineHeight')) || Number(url.searchParams.get('height')) || 671,
      )
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ ...fixture, loadedHashes, serverStartedAt: startedAt }))
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ error: String(error && error.stack || error), loadedHashes }))
    }
    return
  }
  if (url.pathname === '/__qa-meta') {
    const currentHashes = sourceHashes()
    response.writeHead(JSON.stringify(currentHashes) === JSON.stringify(loadedHashes) ? 200 : 409, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(escapeJsonForHtml({ startedAt, loadedHashes, currentHashes, nativeReport: nativeReportMetadata() }))
    return
  }
  const relativePath = decodeURIComponent(url.pathname === '/' ? '/tests/spl-refactor-2026-10-11/browser.html' : url.pathname)
  const filePath = path.resolve(root, `.${relativePath}`)
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404)
    response.end('not found')
    return
  }
  response.writeHead(200, { 'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`SPL browser bridge at http://127.0.0.1:${port}\n`)
})

function close() {
  server.close(() => process.exit(0))
}
process.on('SIGTERM', close)
process.on('SIGINT', close)

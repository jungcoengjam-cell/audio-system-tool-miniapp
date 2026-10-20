'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { createCameraFixtureV6 } = require('./camera-browser-fixture-v6.cjs')
const cameraReport = require('../../../pages/camera/camera-report.js')

const root = path.resolve(__dirname, '../../..')
const qaDir = __dirname
const evidenceRoot = path.join(qaDir, 'evidence')
const reportRoot = path.join(evidenceRoot, 'report')
const actionLogPath = path.join(evidenceRoot, 'visible-actions.jsonl')
const port = Number(process.env.CAMERA_QA_V6_PORT) || 8153
const serverStartedAt = new Date().toISOString()
const sessions = new Map()
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wxss': 'text/css; charset=utf-8', '.wxml': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function readSourceManifest() {
  const manifestPath = path.join(qaDir, 'checks', 'source-sha256-v6.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing V6 frozen source manifest: ${manifestPath}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== 44) {
    throw new Error(`V6 frozen source manifest must contain all 44 audited production sources; received ${manifest.entries?.length ?? 'no entries'}.`)
  }
  return manifest
}

function sourceHashes(manifest) {
  return Object.fromEntries(manifest.entries.map(({ path: relativePath }) => [
    relativePath, sha256(fs.readFileSync(path.join(root, relativePath))),
  ]))
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

function getSession(url) {
  const sessionId = String(url.searchParams.get('sessionId') || '')
  return sessions.get(sessionId) || null
}

function assertFrozenSources(manifest) {
  const current = sourceHashes(manifest)
  const expected = Object.fromEntries(manifest.entries.map(({ path: relativePath, sha256: hash }) => [relativePath, hash]))
  return { current, matches: JSON.stringify(current) === JSON.stringify(expected) }
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Invalid PNG signature.')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const sourceManifest = readSourceManifest()
const loadedHashes = sourceHashes(sourceManifest)
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  try {
    const current = assertFrozenSources(sourceManifest)
    if (url.pathname === '/__qa-meta') {
      return sendJson(response, current.matches ? 200 : 409, {
        serverStartedAt, sourceManifest: path.relative(root, path.join(qaDir, 'checks', 'source-sha256-v6.json')),
        loadedHashes, currentHashes: current.current, frozen: current.matches,
      })
    }
    if (!current.matches && url.pathname.startsWith('/__')) {
      return sendJson(response, 409, { error: 'Production sources changed after the V6 browser bridge started; restart after the source freeze.', loadedHashes, currentHashes: current.current })
    }
    if (url.pathname === '/__fixture') {
      const caseName = url.searchParams.get('case') || 'ground'
      const width = Number(url.searchParams.get('width')) || 390
      const height = Number(url.searchParams.get('height')) || 844
      const fixture = createCameraFixtureV6(caseName, width, height, {
        inputTabIndex: url.searchParams.has('tab') ? Number(url.searchParams.get('tab')) : undefined,
        previewViewIndex: url.searchParams.has('view') ? Number(url.searchParams.get('view')) : undefined,
      })
      const scale = Number(url.searchParams.get('viewerScale'))
      if (Number.isFinite(scale) && [100, 200, 300].includes(scale)) {
        fixture.page.data.resultReportImageViewerScale = scale
      }
      const sessionId = crypto.randomUUID()
      sessions.set(sessionId, fixture)
      return sendJson(response, 200, {
        sessionId, caseName, state: fixture.page.data,
        pageHandlers: Object.keys(fixture.page).filter((name) => typeof fixture.page[name] === 'function'),
        pendingAction: fixture.pendingAction, sourceNote: fixture.sourceNote,
        loadedHashes, serverStartedAt, viewport: { width, height },
      })
    }
    if (url.pathname === '/__state') {
      const fixture = getSession(url)
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      fixture.env.flushNextTicks()
      return sendJson(response, 200, { state: fixture.page.data, pendingCanvases: fixture.env.pending.canvases.length })
    }
    if (url.pathname === '/__storage-state') {
      const fixture = getSession(url)
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      const projects = fixture.env.storage.get('audioTool.projects.v1') || []
      const records = fixture.env.storage.get('audioTool.records.v1') || []
      return sendJson(response, 200, {
        projects: projects.map((project) => ({ id: project.id, name: project.name })),
        records: records.map((record) => ({ module: record.module, title: record.title,
          signature: record.signature, favorite: Boolean(record.favorite), projectIds: record.projectIds || [],
          projectMetadata: record.projectMetadata || null })),
        activeProjectId: fixture.env.storage.get('audioTool.activeProject.v1') || '',
        storageWrites: fixture.env.effects.storage.length,
      })
    }
    if (url.pathname === '/__camera-diagnostics') {
      const fixture = getSession(url)
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      const page = fixture.page
      const reportSignature = typeof page.getResultReportSignature === 'function'
        ? String(page.getResultReportSignature() || '') : ''
      return sendJson(response, 200, {
        state: page.data,
        preferences: fixture.env.storage.get('audioTool.camera.preferences') || null,
        hasCalculationTimer: Boolean(page._calculationTimer), pageVisible: page._pageVisible !== false,
        reportSignature, reportImagePath: String(page.data.resultReportImagePath || ''),
        reportPreviewVisible: Boolean(page.data.resultReportPreviewVisible),
        originalViewerVisible: Boolean(page.data.resultReportImageViewerVisible),
        reportRelatedPageKeys: Object.keys(page).filter((key) => /report|cache|signature/i.test(key)),
      })
    }
    if (url.pathname === '/__pending-action-hide' && request.method === 'POST') {
      const body = await readJson(request)
      const fixture = sessions.get(String(body.sessionId || ''))
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      const handler = String(body.handler || '')
      if (!['generateResultReportImage', 'saveToActiveProject'].includes(handler)) {
        return sendJson(response, 400, { error: `Unsupported pending action for the hide race: ${handler}` })
      }
      const page = fixture.page
      if (!page.data.result || typeof page.onFieldInput !== 'function' || typeof page[handler] !== 'function') {
        return sendJson(response, 409, { error: 'Pending action race needs a current result and production input handler.' })
      }
      const beforeStorageWrites = fixture.env.effects.storage.length
      page.onFieldInput({ currentTarget: { dataset: { field: 'groundDepthText' } }, detail: { value: '5' } })
      const inputState = { resultUpdating: Boolean(page.data.resultUpdating), timerPending: Boolean(page._calculationTimer) }
      page[handler]()
      const queuedSetDataCallbacks = fixture.env.pending.nextTicks.length
      page.onHide()
      const hidden = { pageVisible: page._pageVisible === true,
        projectDialogVisible: Boolean(page.data.projectDialogVisible), previewVisible: Boolean(page.data.resultReportPreviewVisible) }
      page.onShow()
      fixture.env.flushNextTicks()
      const records = fixture.env.storage.get('audioTool.records.v1') || []
      const writesDuringRace = fixture.env.effects.storage.slice(beforeStorageWrites)
      const storageWriteKeys = writesDuringRace.map((write) => String(write.key || ''))
      return sendJson(response, 200, {
        handler, inputState, queuedSetDataCallbacks, hidden,
        final: { pageVisible: page._pageVisible !== false,
          projectDialogVisible: Boolean(page.data.projectDialogVisible),
          previewVisible: Boolean(page.data.resultReportPreviewVisible), generating: Boolean(page.data.isGeneratingResultReport),
          pendingCanvasExports: fixture.env.pending.canvases.length, projectSaving: Boolean(page.data.projectSaving),
          recordCount: records.length, storageWrites: fixture.env.effects.storage.length, wroteDuringRace: writesDuringRace.length > 0,
          storageWriteKeys, wroteRecordDuringRace: storageWriteKeys.includes('audioTool.records.v1'),
          wroteProjectDuringRace: storageWriteKeys.includes('audioTool.projects.v1') },
      })
    }
    if (url.pathname === '/__measure-dom' && request.method === 'POST') {
      const body = await readJson(request)
      const fixture = sessions.get(String(body.sessionId || ''))
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      const measurements = body.measurements && typeof body.measurements === 'object' ? body.measurements : {}
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
      const body = await readJson(request)
      const fixture = sessions.get(String(body.sessionId || ''))
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      const method = String(body.handler || '')
      if (!method || typeof fixture.page[method] !== 'function') {
        return sendJson(response, 400, { error: `Production camera handler is unavailable: ${method}` })
      }
      fixture.page[method]({ currentTarget: { dataset: body.dataset || {} }, detail: body.detail || {} })
      fixture.env.flushNextTicks()
      return sendJson(response, 200, { state: fixture.page.data })
    }
    if (url.pathname === '/__report-export-state') {
      const fixture = getSession(url)
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      if (fixture.env.pending.draws.length) fixture.env.finishDraw(0)
      fixture.env.flushNextTicks()
      const payload = cameraReport.buildCameraReportPayload(fixture.page.data.result)
      if (!payload) return sendJson(response, 422, { error: 'Production camera report payload is unavailable.' })
      if (!fixture.env.pending.canvases.length) return sendJson(response, 409, { error: 'Production report canvas export callback is not pending.' })
      return sendJson(response, 200, {
        payload, width: 750, layoutApi: 'buildCameraReportLayout(context, payload)',
        rendererApi: 'drawCameraReport(context, payload, layout)',
        pendingExports: fixture.env.pending.canvases.length,
      })
    }
    if (url.pathname === '/__finish-report-export' && request.method === 'POST') {
      const body = await readJson(request)
      const fixture = sessions.get(String(body.sessionId || ''))
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      const match = String(body.dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
      if (!match) return sendJson(response, 400, { error: 'Expected a production Canvas PNG data URL.' })
      const png = Buffer.from(match[1], 'base64')
      const dimensions = pngDimensions(png)
      if (dimensions.width !== 750 || dimensions.height < 1 || png.length < 1000) {
        return sendJson(response, 400, { error: `Unexpected production report PNG dimensions/size: ${JSON.stringify({ ...dimensions, bytes: png.length })}` })
      }
      if (!fixture.env.pending.canvases.length) return sendJson(response, 409, { error: 'Production report export callback is no longer pending.' })
      fs.mkdirSync(reportRoot, { recursive: true })
      const imageName = `camera-report-${String(body.caseName || 'share').replace(/[^a-z0-9-]/gi, '-')}-${Date.now()}.png`
      fs.writeFileSync(path.join(reportRoot, imageName), png)
      const output = { fileName: imageName, sha256: sha256(png), bytes: png.length, ...dimensions }
      const evidence = {
        caseName: body.caseName || 'share', renderer: 'pages/camera/camera-report.js production exports',
        layoutApi: body.layoutApi || 'buildCameraReportLayout(context, payload)',
        serverStartedAt, sourceHashes: loadedHashes, output, layout: body.layout || null,
        reportTextDraws: Array.isArray(body.reportTextDraws) ? body.reportTextDraws : [],
        reportTextBounds: Array.isArray(body.reportTextBounds) ? body.reportTextBounds : [],
        clippedReportText: Array.isArray(body.clippedReportText) ? body.clippedReportText : [],
        forbiddenCopyFindings: Array.isArray(body.forbiddenCopyFindings) ? body.forbiddenCopyFindings : [],
        dateTextFindings: Array.isArray(body.dateTextFindings) ? body.dateTextFindings : [],
        removedProseFields: Array.isArray(body.removedProseFields) ? body.removedProseFields : [],
        viewCalls: Array.isArray(body.viewCalls) ? body.viewCalls : [],
        payloadSummary: body.payloadSummary && typeof body.payloadSummary === 'object' ? body.payloadSummary : null,
        textAudit: body.textAudit && typeof body.textAudit === 'object' ? body.textAudit : null,
        visibleActionCount: Number(body.visibleActionCount) || 0,
        limitations: 'Browser Canvas2D evidence through a WeChat API adapter; not native WeChat sharing or physical-device evidence.',
      }
      fs.writeFileSync(path.join(reportRoot, `${path.parse(imageName).name}.json`), `${JSON.stringify(evidence, null, 2)}\n`)
      fixture.env.finishCanvas(0, `data:image/png;base64,${png.toString('base64')}`)
      fixture.env.flushNextTicks()
      return sendJson(response, 200, { state: fixture.page.data, output, evidenceFile: `${path.parse(imageName).name}.json` })
    }
    if (url.pathname === '/__record-visible-action' && request.method === 'POST') {
      const body = await readJson(request)
      const fixture = sessions.get(String(body.sessionId || ''))
      if (!fixture) return sendJson(response, 404, { error: 'V6 QA fixture session not found.' })
      const record = {
        at: new Date().toISOString(), sessionId: body.sessionId,
        kind: String(body.kind || ''), target: String(body.target || ''),
        metrics: body.metrics && typeof body.metrics === 'object' ? body.metrics : {},
        state: {
          selectorVisible: Boolean(fixture.page.data.selectorVisible),
          reportPreviewVisible: Boolean(fixture.page.data.resultReportPreviewVisible),
          originalViewerVisible: Boolean(fixture.page.data.resultReportImageViewerVisible),
          viewerScale: Number(fixture.page.data.resultReportImageViewerScale) || 100,
        },
      }
      fs.mkdirSync(evidenceRoot, { recursive: true })
      fs.appendFileSync(actionLogPath, `${JSON.stringify(record)}\n`)
      return sendJson(response, 200, { saved: true, record })
    }
    const relativePath = decodeURIComponent(url.pathname === '/' ? '/tests/camera-refactor-2026-10-12/v6/camera-browser-v6.html' : url.pathname)
    const filePath = path.resolve(root, `.${relativePath}`)
    if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-store' })
    fs.createReadStream(filePath).pipe(response)
  } catch (error) {
    sendJson(response, 500, { error: String(error && error.stack || error) })
  }
})

server.listen(port, '127.0.0.1', () => process.stdout.write(`Camera V6 browser bridge at http://127.0.0.1:${port}\n`))
function close() { server.close(() => process.exit(0)) }
process.on('SIGTERM', close)
process.on('SIGINT', close)

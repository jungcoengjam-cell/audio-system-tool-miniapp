'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { createLedBrowserEnvironment } = require('./led-browser-environment.cjs')

const root = path.resolve(__dirname, '../..')
const qaDir = __dirname
const evidenceRoot = path.resolve(process.env.LED_QA_EVIDENCE_ROOT || path.join(qaDir, 'evidence'))
const reportRoot = path.join(evidenceRoot, 'reports')
const port = Number(process.env.LED_QA_PORT) || 8160
const startedAt = new Date().toISOString()
const sessions = new Map()
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wxss': 'text/css; charset=utf-8', '.wxml': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
}
const fixedSources = [
  'pages/led-screen/led-screen.js', 'pages/led-screen/led-project.js', 'pages/led-screen/report.js',
  'pages/led-screen/led-screen.wxml', 'pages/led-screen/led-screen.wxss',
  'pages/led-screen/led-overlays.wxml', 'pages/common/operation-confirmation.wxml',
  'app.wxss', 'styles/theme-page-shared.wxss', 'utils/led-screen.js', 'utils/records.js',
]

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex') }
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
function clearLoadedModules() {
  for (const filename of Object.keys(require.cache)) {
    if (/[/\\](?:pages[/\\]led-screen|utils)[/\\].+\.js$/i.test(filename)) delete require.cache[filename]
  }
}
function loadPageModule(env) {
  return env.loadPage('pages/led-screen/led-screen.js')
}
function sourcePaths() {
  const sourceSet = new Set(fixedSources)
  for (const filename of Object.keys(require.cache)) {
    const relative = path.relative(root, filename).replace(/\\/g, '/')
    if (!relative.startsWith('../') && (relative.startsWith('pages/led-screen/') || relative.startsWith('utils/'))) {
      sourceSet.add(relative)
    }
  }
  return [...sourceSet].sort()
}
function currentSourceHashes() {
  const entries = []
  const missing = []
  for (const relative of sourcePaths()) {
    const absolute = path.join(root, relative)
    if (!fs.existsSync(absolute)) missing.push(relative)
    else entries.push([relative, sha256(fs.readFileSync(absolute))])
  }
  return { hashes: Object.fromEntries(entries), missing }
}

// Load the same controller graph used by fixtures before freezing its hashes.
clearLoadedModules()
loadPageModule(createLedBrowserEnvironment())
const loadedSources = currentSourceHashes()

function assertSourceFreeze() {
  const current = currentSourceHashes()
  return { current, matches: !current.missing.length
    && JSON.stringify(current.hashes) === JSON.stringify(loadedSources.hashes) }
}

function makeProjectFixture(records, name) {
  const project = records.createProject(name)
  if (!project) throw new Error(`Could not seed QA project ${name}`)
  return project
}

function applySample(page, distance = '2', wall = {}) {
  const values = {
    wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2',
    frameWidthText: '5', viewingDistanceText: distance,
    ...wall,
  }
  for (const [field, value] of Object.entries(values)) {
    page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } })
  }
  page.onFieldBlur()
  page.onAspectRatioChange({ detail: { value: 0 } })
  page.onUnitChange({ detail: { value: 0 } })
  page.onPitchChange({ detail: { value: 0 } })
}

function createFixture(caseName, height, width) {
  clearLoadedModules()
  const env = createLedBrowserEnvironment({ width, height })
  env.wx.setStorageSync('audioTool.records.v1', [])
  env.wx.setStorageSync('audioTool.projects.v1', [])
  env.wx.setStorageSync('audioTool.activeProject.v1', '')
  env.wx.setStorageSync('audioTool.storageSchemaVersion', 3)
  const page = loadPageModule(env)
  const records = require(path.join(root, 'utils/records.js'))
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  if (caseName !== 'blank') {
    const wall = caseName === 'tall-wall' ? { wallWidthText: '3', wallHeightText: '6' }
      : caseName === 'wide-wall' ? { wallWidthText: '20', wallHeightText: '2' } : {}
    applySample(page, ['near-sample', 'tall-wall', 'wide-wall'].includes(caseName) ? '2' : '4', wall)
  }
  if (caseName === 'cabinet') page.onUnitChange({ detail: { value: 2 } })
  let projects = []
  if (caseName === 'project-list' || caseName === 'project-confirm') {
    projects = [makeProjectFixture(records, 'LED QA North Hall'), makeProjectFixture(records, 'LED QA South Hall')]
    if (caseName === 'project-list') page.openProjectSheet()
    else {
      page.openProjectSheet()
      page.selectProjectTarget({ currentTarget: { dataset: { id: projects[1].id } } })
    }
  }
  if (caseName === 'create-project') {
    page.openProjectSheet()
    page.openProjectCreateForm()
    page.onProjectNameInput({ detail: { value: 'LED QA Created Hall' } })
    page.createProjectFromForm()
  }
  const sessionId = crypto.randomUUID()
  const session = { env, page, records, caseName, projects }
  sessions.set(sessionId, session)
  return { sessionId, caseName, state: page.data, sourceHashes: loadedSources.hashes,
    sourceMissing: loadedSources.missing, startedAt, browserOnly: true }
}

function readSession(url) { return sessions.get(String(url.searchParams.get('sessionId') || '')) || null }
function browserState(session) {
  const state = JSON.parse(JSON.stringify(session.page.data))
  if (session.reportArtifactUrl && state.reportImagePath) state.reportImagePath = session.reportArtifactUrl
  return state
}
function storageSnapshot(session) {
  const projects = session.env.storage.get('audioTool.projects.v1') || []
  const records = session.env.storage.get('audioTool.records.v1') || []
  return {
    projects: projects.map(({ id, name }) => ({ id, name })),
    records: records.map(({ id, module, title, favorite, projectIds, projectMetadata }) => ({
      id, module, title, favorite: Boolean(favorite), projectIds: projectIds || [], projectMetadata: projectMetadata || null,
    })),
    activeProjectId: session.env.storage.get('audioTool.activeProject.v1') || '',
    storageWrites: session.env.effects.storage.length,
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  try {
    const freeze = assertSourceFreeze()
    if (url.pathname === '/__qa-meta') {
      return sendJson(response, freeze.matches ? 200 : 409, {
        startedAt, sourceHashes: loadedSources.hashes, currentHashes: freeze.current.hashes,
        missingSources: freeze.current.missing, frozen: freeze.matches,
        browser: 'Chrome headless browser adapter using production WXML/WXSS/controller and production Canvas renderer',
        limitations: 'This is browser rendering evidence, not the WeChat Mini Program runtime, native picker/IME/share permission behavior, or physical-device evidence.',
      })
    }
    if (url.pathname.startsWith('/__') && !freeze.matches) {
      return sendJson(response, 409, { error: 'Production source set changed after the QA bridge started; restart before capture.', ...freeze.current })
    }
    if (url.pathname === '/__fixture') {
      const caseName = url.searchParams.get('case') || 'sample'
      const height = Number(url.searchParams.get('viewportHeight')) || 844
      const width = Number(url.searchParams.get('viewportWidth')) || 390
      return sendJson(response, 200, createFixture(caseName, height, width))
    }
    if (url.pathname === '/__state') {
      const session = readSession(url)
      if (!session) return sendJson(response, 404, { error: 'LED QA fixture session not found.' })
      session.env.activateGlobal()
      session.env.flushNextTicks()
      return sendJson(response, 200, { state: browserState(session), storage: storageSnapshot(session) })
    }
    if (url.pathname === '/__event' && request.method === 'POST') {
      const body = await readJson(request)
      const session = sessions.get(String(body.sessionId || ''))
      if (!session) return sendJson(response, 404, { error: 'LED QA fixture session not found.' })
      session.env.activateGlobal()
      const handler = String(body.handler || '')
      if (!handler || typeof session.page[handler] !== 'function') return sendJson(response, 400, { error: `Production LED handler is unavailable: ${handler}` })
      const dataset = { ...(body.dataset || {}) }
      if (dataset.imagePath && dataset.imagePath === session.reportArtifactUrl) dataset.imagePath = session.page.data.reportImagePath
      const result = session.page[handler]({ currentTarget: { dataset }, detail: body.detail || {} })
      session.env.flushNextTicks()
      return sendJson(response, 200, { result: result === undefined ? null : result, state: browserState(session), storage: storageSnapshot(session) })
    }
    if (url.pathname === '/__report-start' && request.method === 'POST') {
      const body = await readJson(request)
      const session = sessions.get(String(body.sessionId || ''))
      if (!session) return sendJson(response, 404, { error: 'LED QA fixture session not found.' })
      session.env.activateGlobal()
      const opened = session.page.openSharePreview()
      session.env.flushNextTicks()
      if (opened && session.page.data.reportPreviewVisible && session.reportArtifactUrl && !session.env.pending.draws.length) {
        return sendJson(response, 200, { cached: true, state: browserState(session), sourceHashes: loadedSources.hashes })
      }
      if (!opened || !session.env.pending.draws.length) return sendJson(response, 409, { error: 'Production report renderer did not queue a canvas draw or return a cached report.' })
      session.env.finishDraw(0)
      session.env.flushNextTicks()
      if (!session.env.pending.canvases.length) return sendJson(response, 409, { error: 'Production report renderer did not queue PNG export.' })
      const report = require(path.join(root, 'pages/led-screen/report.js'))
      const payload = report.buildLedScreenReportPayload(session.page.getOutputState())
      if (!payload) return sendJson(response, 422, { error: 'Production report payload is unavailable.' })
      return sendJson(response, 200, { width: report.REPORT_WIDTH || 750, payload,
        controllerCanvasHeight: session.page.data.reportCanvasHeight, sourceHashes: loadedSources.hashes })
    }
    if (url.pathname === '/__report-finish' && request.method === 'POST') {
      const body = await readJson(request)
      const session = sessions.get(String(body.sessionId || ''))
      if (!session) return sendJson(response, 404, { error: 'LED QA fixture session not found.' })
      session.env.activateGlobal()
      const match = String(body.dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
      if (!match) return sendJson(response, 400, { error: 'Expected a production renderer PNG data URL.' })
      const png = Buffer.from(match[1], 'base64')
      if (png.length < 1000 || png.readUInt32BE(0) !== 0x89504e47) return sendJson(response, 400, { error: 'Invalid report PNG.' })
      if (!session.env.pending.canvases.length) return sendJson(response, 409, { error: 'Production report export callback is not pending.' })
      const width = png.readUInt32BE(16)
      const height = png.readUInt32BE(20)
      session.page.data.reportCanvasWidth = width
      session.page.data.reportCanvasHeight = height
      fs.mkdirSync(reportRoot, { recursive: true })
      const fileName = `led-report-${session.caseName}-${Date.now()}.png`
      const filePath = path.join(reportRoot, fileName)
      fs.writeFileSync(filePath, png)
      session.reportArtifactUrl = `/${path.relative(root, filePath).replace(/\\/g, '/')}`
      session.env.finishCanvas(0, body.dataUrl)
      session.env.flushNextTicks()
      const manifest = {
        caseName: session.caseName, renderer: 'pages/led-screen/report.js production buildLedScreenReportLayout/drawLedScreenReport',
        sourceHashes: loadedSources.hashes, output: { fileName, path: path.relative(root, filePath).replace(/\\/g, '/'),
          sha256: sha256(png), bytes: png.length, width, height },
        layout: body.layout || null, browserOnly: true, capturedAt: new Date().toISOString(),
      }
      fs.writeFileSync(path.join(reportRoot, `${path.parse(fileName).name}.json`), `${JSON.stringify(manifest, null, 2)}\n`)
      return sendJson(response, 200, { state: browserState(session), report: manifest })
    }
    if (url.pathname === '/__storage-state') {
      const session = readSession(url)
      if (!session) return sendJson(response, 404, { error: 'LED QA fixture session not found.' })
      return sendJson(response, 200, storageSnapshot(session))
    }
    const relative = decodeURIComponent(url.pathname === '/' ? '/tests/led-refactor-2026-10-13/led-browser.html' : url.pathname)
    const absolute = path.resolve(root, `.${relative}`)
    if (absolute !== root && !absolute.startsWith(root + path.sep)) return sendJson(response, 403, { error: 'Path outside workspace.' })
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return sendJson(response, 404, { error: `File not found: ${relative}` })
    response.writeHead(200, { 'content-type': contentTypes[path.extname(absolute).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' })
    fs.createReadStream(absolute).pipe(response)
  } catch (error) {
    sendJson(response, 500, { error: String(error && error.stack || error) })
  }
})

server.listen(port, '127.0.0.1', () => process.stdout.write(`LED production-source browser QA at http://127.0.0.1:${port}\n`))

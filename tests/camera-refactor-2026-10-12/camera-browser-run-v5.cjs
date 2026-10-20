'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { calculateGeometryMetrics } = require('./camera-v5-geometry-metrics.cjs')

const qaDir = __dirname
const repoRoot = path.resolve(qaDir, '../..')
const v5EvidenceRoot = path.resolve(qaDir, 'evidence-v5')
const outputRoot = path.resolve(repoRoot, process.env.CAMERA_QA_V5_OUTPUT_ROOT || 'tests/camera-refactor-2026-10-12/evidence-v5/diagnostic/first-layout')
const within = (child, parent) => {
  const relative = path.relative(parent, child)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
assert(within(outputRoot, v5EvidenceRoot), `V5 output must stay below ${v5EvidenceRoot}: ${outputRoot}`)

const port = Number(process.env.CAMERA_QA_V5_PORT) || 8151
const chromePath = process.env.CAMERA_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stopMarker = (text) => /setup refresh had errors/i.test(text)
const cases = [
  { name: 'ground-plan-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, curated: true,
    v3Baseline: 'ground-plan-390x844.json' },
  { name: 'ground-elevation-390x844', scenario: 'ground', width: 390, height: 844, theme: 'dark', view: 1, curated: true,
    v3Baseline: 'ground-elevation-390x844.json' },
  { name: 'ground-font-1_3-320x700', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3,
    v3Baseline: 'ground-font-1_3-320x700.json' },
  { name: 'ground-elevation-font-1_3-320x700', scenario: 'ground', width: 320, height: 700, theme: 'dark', view: 1, zoom: 1.3 },
  { name: 'plane-plan-390x844', scenario: 'plane', width: 390, height: 844, theme: 'light', view: 0, curated: true },
  { name: 'plane-elevation-390x844', scenario: 'plane', width: 390, height: 844, theme: 'dark', view: 1, curated: true },
  { name: 'plane-plan-font-1_3-320x700', scenario: 'plane', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3 },
  { name: 'plane-elevation-font-1_3-320x700', scenario: 'plane', width: 320, height: 700, theme: 'dark', view: 1, zoom: 1.3 },
  { name: 'long-depth-1000m-390x844', scenario: 'long-depth', width: 390, height: 844, theme: 'light', view: 0 },
  { name: 'horizontal-only-plan-390x844', scenario: 'horizontal-only', width: 390, height: 844, theme: 'light', view: 0 },
  { name: 'horizontal-only-elevation-390x844', scenario: 'horizontal-only', width: 390, height: 844, theme: 'dark', view: 1 },
  { name: 'horizontal-only-plan-font-1_3-320x700', scenario: 'horizontal-only', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3,
    v3Baseline: 'horizontal-only-plan-font-1_3-320x700.json' },
  { name: 'longest-model-font-1_3-320x700', scenario: 'long-model', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3 },
  { name: 'legacy-custom-font-1_3-320x700', scenario: 'legacy-custom', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3 },
  { name: 'structured-unsupported-390x844', scenario: 'structured-unsupported', width: 390, height: 844, theme: 'dark', view: 0 },
  { name: 'structured-unsupported-font-1_3-320x700', scenario: 'structured-unsupported', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3 },
  { name: 'dual-lens-second-view-390x844', scenario: 'dual-lens', width: 390, height: 844, theme: 'light', view: 0 },
  { name: 'eptz-fixed-margin20-390x844', scenario: 'eptz-fixed-margin20', width: 390, height: 844, theme: 'dark', view: 1 },
  { name: 'install-controls-auto-margin0-390x844', scenario: 'install-auto-margin0', width: 390, height: 844, theme: 'light', view: 0,
    interaction: 'install-controls', curated: true },
  { name: 'install-controls-fixed-margin0-390x844', scenario: 'install-fixed-margin0', width: 390, height: 844, theme: 'dark', view: 1,
    interaction: 'install-controls', curated: true },
  { name: 'install-controls-fixed-margin20-390x844', scenario: 'eptz-fixed-margin20', width: 390, height: 844, theme: 'light', view: 1,
    interaction: 'install-controls', curated: true },
  { name: 'install-controls-auto-margin0-320x700-font-1_3', scenario: 'install-auto-margin0', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3,
    interaction: 'install-controls' },
  { name: 'install-controls-fixed-margin0-320x700-font-1_3', scenario: 'install-fixed-margin0', width: 320, height: 700, theme: 'dark', view: 1, zoom: 1.3,
    interaction: 'install-controls' },
  { name: 'target-tab-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, interaction: 'target-tab' },
  { name: 'target-tab-font-1_3-320x700', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3, interaction: 'target-tab' },
  { name: 'install-tab-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, interaction: 'install-tab' },
  { name: 'camera-selector-open-320x700', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, interaction: 'camera-selector-open' },
  { name: 'camera-selector-close-select-320x700', scenario: 'ground', width: 320, height: 700, theme: 'dark', view: 0, interaction: 'camera-selector-close-select' },
  { name: 'clear-refill-stability-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, interaction: 'clear-refill' },
  { name: 'reset-valid-390x844', scenario: 'reset-valid', width: 390, height: 844, theme: 'light', view: 0,
    interaction: 'reset-valid', curated: true },
  { name: 'reset-invalid-390x844', scenario: 'reset-invalid', width: 390, height: 844, theme: 'dark', view: 1,
    interaction: 'reset-invalid' },
  { name: 'reset-pending-390x844', scenario: 'reset-pending', width: 390, height: 844, theme: 'light', view: 0,
    interaction: 'reset-pending' },
  { name: 'reset-shared-cache-390x844', scenario: 'reset-shared-cache', width: 390, height: 844, theme: 'dark', view: 1,
    interaction: 'reset-shared-cache', curated: true },
  { name: 'reset-legacy-390x844', scenario: 'legacy-custom', width: 390, height: 844, theme: 'light', view: 0,
    interaction: 'reset-legacy' },
  { name: 'share-overlay-390x844', scenario: 'share-overlay', width: 390, height: 844, theme: 'light', view: 0, interaction: 'share-overlay' },
  { name: 'share-report-content-390x844', scenario: 'share-overlay', width: 390, height: 844, theme: 'dark', view: 1,
    interaction: 'share-overlay', curated: true },
  { name: 'share-report-content-plane-390x844', scenario: 'plane', width: 390, height: 844, theme: 'dark', view: 1,
    interaction: 'share-plane-overlay', curated: true },
  { name: 'report-original-viewer-390x844', scenario: 'original-viewer', width: 390, height: 844, theme: 'light', view: 0, interaction: 'original-viewer' },
  { name: 'report-viewer-return-390x844', scenario: 'share-overlay', width: 390, height: 844, theme: 'dark', view: 0, interaction: 'viewer-return' },
  { name: 'share-cancel-return-390x844', scenario: 'share-overlay', width: 390, height: 844, theme: 'light', view: 0, interaction: 'share-cancel-return' },
  { name: 'project-open-from-result-390x844', scenario: 'project-entry', width: 390, height: 844, theme: 'light', view: 0, interaction: 'project-open' },
  { name: 'project-list-390x844', scenario: 'project-list', width: 390, height: 844, theme: 'light', view: 0 },
  { name: 'project-create-keyboard-320x400', scenario: 'project-create', width: 320, height: 400, theme: 'dark', view: 0, interaction: 'project-keyboard' },
  { name: 'project-confirm-390x844', scenario: 'project-confirm', width: 390, height: 844, theme: 'light', view: 0 },
  { name: 'project-success-390x844', scenario: 'project-success', width: 390, height: 844, theme: 'dark', view: 0 },
  { name: 'project-create-save-390x844', scenario: 'project-create', width: 390, height: 844, theme: 'light', view: 0, interaction: 'project-create-save' },
  { name: 'project-search-empty-320x400', scenario: 'project-list', width: 320, height: 400, theme: 'light', view: 0, interaction: 'project-search-empty' },
  { name: 'project-back-to-list-390x844', scenario: 'project-confirm', width: 390, height: 844, theme: 'dark', view: 0, interaction: 'project-back' },
  { name: 'project-create-cancel-reopen-320x400', scenario: 'project-create', width: 320, height: 400, theme: 'dark', view: 0, interaction: 'project-cancel-reopen' },
  { name: 'project-confirm-cancel-390x844', scenario: 'project-confirm', width: 390, height: 844, theme: 'light', view: 0, interaction: 'project-cancel' },
  { name: 'pending-report-hide-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, interaction: 'pending-report-hide' },
  { name: 'pending-project-hide-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, interaction: 'pending-project-hide' },
]
const chosen = process.env.CAMERA_QA_V5_CASES
  ? process.env.CAMERA_QA_V5_CASES.split(',').map((item) => item.trim()).filter(Boolean)
  : null
const selectedCases = chosen ? cases.filter((item) => chosen.includes(item.name)) : cases
assert(selectedCases.length, `No V5 browser cases selected: ${chosen?.join(',') || ''}`)

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

if (process.env.CAMERA_QA_V5_EXPORT_CASE_MANIFEST === '1') {
  const manifestPath = path.join(qaDir, 'camera-browser-cases-v5.json')
  writeJson(manifestPath, cases)
  process.stdout.write(`Wrote ${cases.length} V5 browser cases to ${manifestPath}\n`)
  process.exit(0)
}

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

const qaFiles = ['browser-fixtures-v5.cjs', 'camera-browser-server-v5.cjs', 'camera-browser-run-v5.cjs',
  'camera-browser-v5.html', 'camera-browser-v5.js', 'camera-v5-geometry-metrics.cjs', 'camera-browser-cases-v5.json']
const qaHashes = Object.fromEntries(qaFiles.map((name) => [name, digest(path.join(qaDir, name))]))

function loadV3GeometryBaseline(name) {
  if (!name) return null
  const baselinePath = path.resolve(qaDir, '../camera-refactor-2026-10-11/evidence-v3/final-verified', name)
  assert(within(baselinePath, path.resolve(qaDir, '../camera-refactor-2026-10-11/evidence-v3/final-verified')),
    `V3 baseline must remain inside the immutable V3 final-verified directory: ${baselinePath}`)
  assert(fs.existsSync(baselinePath), `Missing V3 geometry baseline: ${baselinePath}`)
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const metrics = calculateGeometryMetrics(baseline.canvas, baseline.layout.canvas, baseline.layout.hero)
  return { path: baselinePath, sha256: digest(baselinePath), sourceHashes: baseline.sourceHashes, metrics }
}

function geometryGrowth(v3, v5) {
  const percent = (newValue, oldValue) => oldValue ? Number(((newValue / oldValue - 1) * 100).toFixed(2)) : null
  const roleBounds = (metrics, role, legacyColor) => metrics.byRole?.[role]?.bounds || metrics.byColor?.[legacyColor]?.bounds || null
  const targetV3 = roleBounds(v3, 'target', '#fb7185')
  const targetV5 = roleBounds(v5, 'target', '#fb7185')
  const coverageV3 = roleBounds(v3, 'coverage', '#60a5fa')
  const coverageV5 = roleBounds(v5, 'coverage', '#60a5fa')
  return {
    plotWidthPercent: percent(v5.plotRect?.width || 0, v3.plotRect?.width || 0),
    plotHeightPercent: percent(v5.plotRect?.height || 0, v3.plotRect?.height || 0),
    geometryWidthPercent: percent(v5.geometryBounds?.width || 0, v3.geometryBounds?.width || 0),
    geometryHeightPercent: percent(v5.geometryBounds?.height || 0, v3.geometryBounds?.height || 0),
    targetWidthPercent: percent(targetV5?.width || 0, targetV3?.width || 0),
    targetHeightPercent: percent(targetV5?.height || 0, targetV3?.height || 0),
    coverageWidthPercent: percent(coverageV5?.width || 0, coverageV3?.width || 0),
    coverageHeightPercent: percent(coverageV5?.height || 0, coverageV3?.height || 0),
  }
}

async function waitForServer(child, output) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (stopMarker(output.stdout + output.stderr)) throw new Error('STOP_MARKER: setup refresh had errors in the camera bridge')
    if (child.exitCode !== null) throw new Error(`V5 browser bridge exited ${child.exitCode}: ${output.stdout}\n${output.stderr}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__qa-meta`)
      if (response.ok) return response.json()
    } catch (_error) {}
    await delay(100)
  }
  throw new Error(`V5 bridge startup timed out: ${output.stdout}\n${output.stderr}`)
}

function createCdp(socket) {
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id || !pending.has(message.id)) return
    const item = pending.get(message.id)
    pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error) item.reject(new Error(message.error.message))
    else item.resolve(message.result || {})
  })
  return {
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 20000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed')
  return result.result?.value
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true })
  const server = spawn(process.execPath, [path.join(qaDir, 'camera-browser-server-v5.cjs')], {
    cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAMERA_QA_V5_PORT: String(port) },
  })
  const serverOutput = { stdout: '', stderr: '' }
  server.stdout.on('data', (chunk) => { serverOutput.stdout += chunk.toString() })
  server.stderr.on('data', (chunk) => { serverOutput.stderr += chunk.toString() })
  let chrome = null
  let socket = null
  let profile = ''
  const reports = []
  const startedAt = new Date().toISOString()
  let loadedHashes = null
  let browserVersion = null
  try {
    const meta = await waitForServer(server, serverOutput)
    loadedHashes = meta.loadedHashes
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-v5-diagnostic-'))
    chrome = spawn(chromePath, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let chromeStderr = ''
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Chrome CDP startup timed out: ${chromeStderr}`)), 15000)
      chrome.stderr.on('data', (chunk) => {
        chromeStderr += chunk.toString()
        if (stopMarker(chromeStderr)) { clearTimeout(timeout); reject(new Error('STOP_MARKER: setup refresh had errors in Chrome')) }
        const match = chromeStderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(timeout); resolve(match[1]) }
      })
      chrome.once('error', (error) => { clearTimeout(timeout); reject(error) })
      chrome.once('exit', (code, signal) => {
        if (!chromeStderr.includes('DevTools listening on ')) {
          clearTimeout(timeout); reject(new Error(`Chrome exited before CDP startup (${code}/${signal}): ${chromeStderr}`))
        }
      })
    })
    const endpointUrl = new URL(endpoint)
    const targetResponse = await fetch(`http://${endpointUrl.host}/json/new?about:blank`, { method: 'PUT' })
    assert(targetResponse.ok, `Chrome tab creation failed: ${targetResponse.status}`)
    const target = await targetResponse.json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    const cdp = createCdp(socket)
    const browserInfo = await cdp.send('Browser.getVersion')
    browserVersion = browserInfo.product || null

    for (const item of selectedCases) {
      assert(!stopMarker(serverOutput.stdout + serverOutput.stderr), 'STOP_MARKER: setup refresh had errors in browser service')
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: item.width, height: item.height, deviceScaleFactor: 1, mobile: true,
        screenWidth: item.width, screenHeight: item.height,
      })
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await cdp.send('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-color-scheme', value: item.theme },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ] })
      const url = new URL(`http://127.0.0.1:${port}/tests/camera-refactor-2026-10-12/camera-browser-v5.html`)
      url.searchParams.set('case', item.scenario)
      url.searchParams.set('theme', item.theme)
      url.searchParams.set('view', String(item.view))
      url.searchParams.set('qaCase', item.name)
      if (item.interaction) url.searchParams.set('qaAction', item.interaction)
      if (Number.isInteger(item.tab)) url.searchParams.set('tab', String(item.tab))
      if (item.zoom) url.searchParams.set('zoom', String(item.zoom))
      await cdp.send('Page.navigate', { url: url.href })
      let ready = ''
      for (let attempt = 0; attempt < 150; attempt += 1) {
        ready = await evaluate(cdp, 'document.documentElement.dataset.cameraQaReady || document.documentElement.dataset.cameraQaError || ""')
        if (ready === 'true' || ready === 'error') break
        if (stopMarker(serverOutput.stdout + serverOutput.stderr)) throw new Error('STOP_MARKER: setup refresh had errors during camera rendering')
        await delay(100)
      }
      assert.equal(ready, 'true', `${item.name}: browser action did not complete: ${await evaluate(cdp, 'document.documentElement.dataset.cameraQaError || ""')}`)
      const raw = await evaluate(cdp, 'document.querySelector("#qa-report")?.textContent || ""')
      assert(raw, `${item.name}: browser report missing (state=${ready})`)
      const report = JSON.parse(raw)
      report.case = item
      report.ready = ready
      report.pageActionMarker = await evaluate(cdp, 'document.documentElement.dataset.cameraQaActionComplete || ""')
      assert.equal(report.qaCase, item.name, `${item.name}: page report case identity mismatch`)
      assert.equal(report.qaAction, item.interaction || '', `${item.name}: page report action mismatch`)
      assert.equal(report.pageActionMarker, item.interaction || 'none', `${item.name}: page action completion marker mismatch`)
      report.geometryMetrics = calculateGeometryMetrics(report.canvas, report.layout?.canvas, report.layout?.hero)
      if (typeof report.reportImage?.dataUrl === 'string' && report.reportImage.dataUrl.startsWith('data:image/png;base64,')) {
        const reportPngBytes = Buffer.from(report.reportImage.dataUrl.slice('data:image/png;base64,'.length), 'base64')
        const reportPngPath = path.join(outputRoot, `${item.name}-production-report.png`)
        fs.writeFileSync(reportPngPath, reportPngBytes)
        report.productionReportPng = reportPngPath
        report.productionReportPngSha256 = crypto.createHash('sha256').update(reportPngBytes).digest('hex')
        report.reportImage.productionReportPng = reportPngPath
        report.reportImage.productionReportPngSha256 = report.productionReportPngSha256
        delete report.reportImage.dataUrl
      }
      if (item.v3Baseline) {
        const v3 = loadV3GeometryBaseline(item.v3Baseline)
        report.v3GeometryComparison = { baseline: v3, growth: geometryGrowth(v3.metrics, report.geometryMetrics) }
      }
      await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
      const screenshotPath = path.join(outputRoot, `${item.name}.png`)
      const screenshotBytes = Buffer.from(png.data, 'base64')
      fs.writeFileSync(screenshotPath, screenshotBytes)
      report.screenshot = screenshotPath
      report.screenshotSha256 = crypto.createHash('sha256').update(screenshotBytes).digest('hex')
      report.browserVersion = browserVersion
      if (item.curated || item.name === 'share-report-content-390x844' || item.name === 'share-report-content-plane-390x844') {
        const curatedRoot = path.join(outputRoot, 'curated')
        fs.mkdirSync(curatedRoot, { recursive: true })
        fs.copyFileSync(screenshotPath, path.join(curatedRoot, `${item.name}.png`))
        report.curatedScreenshot = path.join(curatedRoot, `${item.name}.png`)
        if (['share-report-content-390x844', 'share-report-content-plane-390x844'].includes(item.name) && report.productionReportPng) {
          const curatedReportPath = path.join(curatedRoot, `${item.name}-production-report.png`)
          fs.copyFileSync(report.productionReportPng, curatedReportPath)
          report.curatedProductionReportPng = curatedReportPath
        }
      }
      writeJson(path.join(outputRoot, `${item.name}.json`), report)
      reports.push(report)
      process.stdout.write(`${item.name}: ${report.status} ${screenshotPath}\n`)
    }
  } finally {
    try { socket?.close() } catch (_error) {}
    try { chrome?.kill() } catch (_error) {}
    try { server.kill() } catch (_error) {}
    await delay(300)
    if (profile) {
      const tempRoot = path.resolve(os.tmpdir())
      const profilePath = path.resolve(profile)
      assert(within(profilePath, tempRoot) && profilePath !== tempRoot, `Refusing to remove a profile outside the unique temp root: ${profilePath}`)
      try { fs.rmSync(profilePath, { recursive: true, force: true }) } catch (_error) {}
    }
  }
  const summary = {
    runId: crypto.randomUUID(),
    startedAt,
    finishedAt: new Date().toISOString(),
    status: reports.length && reports.every((item) => item.status === 'passed') ? 'passed' : 'diagnostic-failures',
    bridge: 'Headless Chrome renders current production WXML/WXSS/controller state and the production Canvas renderer. Mocked wx callbacks bridge controller state; layout and paint run in browser Canvas 2D. This is not native WeChat or physical-device validation.',
    sourceHashes: loadedHashes,
    qaHashes,
    browserVersion,
    curatedScreenshots: reports.filter((item) => item.case.curated).map((item) => ({
      name: item.case.name, path: item.curatedScreenshot, sha256: item.screenshotSha256,
    })),
    cases: reports.map((item) => ({ name: item.case.name, status: item.status, ready: item.ready,
      screenshot: item.screenshot, screenshotSha256: item.screenshotSha256,
      curatedScreenshot: item.curatedScreenshot || null, failures: item.failures || [], layout: item.layout || null })),
  }
  writeJson(path.join(outputRoot, 'summary.json'), summary)
  writeJson(path.join(outputRoot, 'provenance.json'), {
    runId: summary.runId,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    status: summary.status,
    root: repoRoot,
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    browserVersion,
    bridge: summary.bridge,
    productionSourceHashes: loadedHashes,
    qaSourceHashes: qaHashes,
    caseCount: reports.length,
    caseIds: reports.map((item) => item.case.name),
    screenshots: reports.map((item) => ({ name: item.case.name, path: item.screenshot,
      sha256: item.screenshotSha256, curated: Boolean(item.curatedScreenshot) })),
  })
  process.stdout.write(`${JSON.stringify({ status: summary.status, cases: summary.cases.length, outputRoot, sourceHashes: loadedHashes }, null, 2)}\n`)
  if (summary.status !== 'passed') process.exitCode = 1
}

main().catch((error) => {
  const details = `${error.stack || error}\n${stopMarker(error.message) ? 'STOP_MARKER: stop immediately and report to root.' : ''}`
  process.stderr.write(`${details}\n`)
  process.exitCode = 1
})

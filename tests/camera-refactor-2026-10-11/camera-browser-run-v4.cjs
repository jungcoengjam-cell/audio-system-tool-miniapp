'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { calculateGeometryMetrics } = require('./camera-v4-geometry-metrics.cjs')

const qaDir = __dirname
const repoRoot = path.resolve(qaDir, '../..')
const v4EvidenceRoot = path.resolve(qaDir, 'evidence-v4')
const outputRoot = path.resolve(repoRoot, process.env.CAMERA_QA_V4_OUTPUT_ROOT || 'tests/camera-refactor-2026-10-11/evidence-v4/diagnostic/first-layout')
const within = (child, parent) => {
  const relative = path.relative(parent, child)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
assert(within(outputRoot, v4EvidenceRoot), `V4 output must stay below ${v4EvidenceRoot}: ${outputRoot}`)

const port = Number(process.env.CAMERA_QA_V4_PORT) || 8148
const chromePath = process.env.CAMERA_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stopMarker = (text) => /setup refresh had errors/i.test(text)
const cases = [
  { name: 'ground-plan-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0,
    v3Baseline: 'ground-plan-390x844.json' },
  { name: 'ground-elevation-390x844', scenario: 'ground', width: 390, height: 844, theme: 'dark', view: 1,
    v3Baseline: 'ground-elevation-390x844.json' },
  { name: 'ground-font-1_3-320x700', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3,
    v3Baseline: 'ground-font-1_3-320x700.json' },
  { name: 'ground-elevation-font-1_3-320x700', scenario: 'ground', width: 320, height: 700, theme: 'dark', view: 1, zoom: 1.3 },
  { name: 'plane-plan-390x844', scenario: 'plane', width: 390, height: 844, theme: 'light', view: 0 },
  { name: 'plane-elevation-390x844', scenario: 'plane', width: 390, height: 844, theme: 'dark', view: 1 },
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
  { name: 'target-tab-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, interaction: 'target-tab' },
  { name: 'target-tab-font-1_3-320x700', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3, interaction: 'target-tab' },
  { name: 'install-tab-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, interaction: 'install-tab' },
  { name: 'camera-selector-open-320x700', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, interaction: 'camera-selector-open' },
  { name: 'camera-selector-close-select-320x700', scenario: 'ground', width: 320, height: 700, theme: 'dark', view: 0, interaction: 'camera-selector-close-select' },
  { name: 'clear-refill-stability-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, interaction: 'clear-refill' },
  { name: 'share-overlay-390x844', scenario: 'share-overlay', width: 390, height: 844, theme: 'light', view: 0, interaction: 'share-overlay' },
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
const chosen = process.env.CAMERA_QA_V4_CASES
  ? process.env.CAMERA_QA_V4_CASES.split(',').map((item) => item.trim()).filter(Boolean)
  : null
const selectedCases = chosen ? cases.filter((item) => chosen.includes(item.name)) : cases
assert(selectedCases.length, `No V4 browser cases selected: ${chosen?.join(',') || ''}`)

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

const qaFiles = ['browser-fixtures-v4.cjs', 'camera-browser-server-v4.cjs', 'camera-browser-run-v4.cjs',
  'camera-browser-v4.html', 'camera-browser-v4.js', 'camera-v4-geometry-metrics.cjs']
const qaHashes = Object.fromEntries(qaFiles.map((name) => [name, digest(path.join(qaDir, name))]))

function loadV3GeometryBaseline(name) {
  if (!name) return null
  const baselinePath = path.resolve(qaDir, 'evidence-v3/final-verified', name)
  assert(within(baselinePath, path.resolve(qaDir, 'evidence-v3/final-verified')),
    `V3 baseline must remain inside the immutable V3 final-verified directory: ${baselinePath}`)
  assert(fs.existsSync(baselinePath), `Missing V3 geometry baseline: ${baselinePath}`)
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const metrics = calculateGeometryMetrics(baseline.canvas, baseline.layout.canvas, baseline.layout.hero)
  return { path: baselinePath, sha256: digest(baselinePath), sourceHashes: baseline.sourceHashes, metrics }
}

function geometryGrowth(v3, v4) {
  const percent = (newValue, oldValue) => oldValue ? Number(((newValue / oldValue - 1) * 100).toFixed(2)) : null
  return {
    plotWidthPercent: percent(v4.plotRect?.width || 0, v3.plotRect?.width || 0),
    plotHeightPercent: percent(v4.plotRect?.height || 0, v3.plotRect?.height || 0),
    geometryWidthPercent: percent(v4.geometryBounds?.width || 0, v3.geometryBounds?.width || 0),
    geometryHeightPercent: percent(v4.geometryBounds?.height || 0, v3.geometryBounds?.height || 0),
    targetWidthPercent: percent(v4.byColor?.['#fb7185']?.bounds?.width || 0, v3.byColor?.['#fb7185']?.bounds?.width || 0),
    targetHeightPercent: percent(v4.byColor?.['#fb7185']?.bounds?.height || 0, v3.byColor?.['#fb7185']?.bounds?.height || 0),
    coverageWidthPercent: percent(v4.byColor?.['#60a5fa']?.bounds?.width || 0, v3.byColor?.['#60a5fa']?.bounds?.width || 0),
    coverageHeightPercent: percent(v4.byColor?.['#60a5fa']?.bounds?.height || 0, v3.byColor?.['#60a5fa']?.bounds?.height || 0),
  }
}

async function waitForServer(child, output) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (stopMarker(output.stdout + output.stderr)) throw new Error('STOP_MARKER: setup refresh had errors in the camera bridge')
    if (child.exitCode !== null) throw new Error(`V4 browser bridge exited ${child.exitCode}: ${output.stdout}\n${output.stderr}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__qa-meta`)
      if (response.ok) return response.json()
    } catch (_error) {}
    await delay(100)
  }
  throw new Error(`V4 bridge startup timed out: ${output.stdout}\n${output.stderr}`)
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
  const server = spawn(process.execPath, [path.join(qaDir, 'camera-browser-server-v4.cjs')], {
    cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAMERA_QA_V4_PORT: String(port) },
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
  try {
    const meta = await waitForServer(server, serverOutput)
    loadedHashes = meta.loadedHashes
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-v4-diagnostic-'))
    chrome = spawn(chromePath, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', '--no-sandbox',
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
      const url = new URL(`http://127.0.0.1:${port}/tests/camera-refactor-2026-10-11/camera-browser-v4.html`)
      url.searchParams.set('case', item.scenario)
      url.searchParams.set('theme', item.theme)
      url.searchParams.set('view', String(item.view))
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
      await evaluate(cdp, 'window.__cameraWaitForStablePaint()')
      if (item.interaction === 'target-tab') await evaluate(cdp, 'window.__cameraActivateInputTab(1)')
      else if (item.interaction === 'install-tab') await evaluate(cdp, 'window.__cameraActivateInputTab(2)')
      else if (item.interaction === 'clear-refill') await evaluate(cdp, 'window.__cameraRunClearRefill()')
      else if (item.interaction === 'share-overlay') await evaluate(cdp, 'window.__cameraRenderProductionReportPreview()')
      else if (item.interaction === 'original-viewer') await evaluate(cdp, 'window.__cameraRunReportInteraction("viewer")')
      else if (item.interaction === 'viewer-return') await evaluate(cdp, 'window.__cameraRunReportInteraction("viewer-return")')
      else if (item.interaction === 'share-cancel-return') await evaluate(cdp, 'window.__cameraRunReportInteraction("share-cancel-return")')
      else if (item.interaction === 'project-open') await evaluate(cdp, 'window.__cameraClickProjectAction()')
      else if (item.interaction === 'project-keyboard') await evaluate(cdp, 'window.__cameraProjectKeyboardHeight(180)')
      else if (item.interaction?.startsWith('project-')) await evaluate(cdp, `window.__cameraRunProjectInteraction(${JSON.stringify(item.interaction)})`)
      else if (item.interaction?.startsWith('camera-selector-')) await evaluate(cdp, `window.__cameraRunSelectorInteraction(${JSON.stringify(item.interaction)})`)
      else if (item.interaction?.startsWith('pending-')) {
        const handler = item.interaction === 'pending-report-hide' ? 'generateResultReportImage' : 'saveToActiveProject'
        await evaluate(cdp, `window.__cameraRunPendingActionHideRace(${JSON.stringify(handler)})`)
      }
      if (item.interaction) await evaluate(cdp, 'window.__cameraWaitForStablePaint()')
      await evaluate(cdp, 'window.__cameraReinspect()')
      const raw = await evaluate(cdp, 'JSON.stringify(window.__cameraQa || null)')
      assert(raw, `${item.name}: browser report missing (state=${ready})`)
      const report = JSON.parse(raw)
      report.case = item
      report.ready = ready
      report.geometryMetrics = calculateGeometryMetrics(report.canvas, report.layout?.canvas, report.layout?.hero)
      if (item.v3Baseline) {
        const v3 = loadV3GeometryBaseline(item.v3Baseline)
        report.v3GeometryComparison = { baseline: v3, growth: geometryGrowth(v3.metrics, report.geometryMetrics) }
      }
      await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
      const screenshotPath = path.join(outputRoot, `${item.name}.png`)
      fs.writeFileSync(screenshotPath, Buffer.from(png.data, 'base64'))
      report.screenshot = screenshotPath
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
    startedAt,
    finishedAt: new Date().toISOString(),
    status: reports.length && reports.every((item) => item.status === 'passed') ? 'passed' : 'diagnostic-failures',
    bridge: 'Headless Chrome renders current production WXML/WXSS/controller state and the production Canvas renderer. Mocked wx callbacks bridge controller state; layout and paint run in browser Canvas 2D. This is not native WeChat or physical-device validation.',
    sourceHashes: loadedHashes,
    qaHashes,
    cases: reports.map((item) => ({ name: item.case.name, status: item.status, ready: item.ready,
      screenshot: item.screenshot, failures: item.failures || [], layout: item.layout || null })),
  }
  writeJson(path.join(outputRoot, 'summary.json'), summary)
  process.stdout.write(`${JSON.stringify({ status: summary.status, cases: summary.cases.length, outputRoot, sourceHashes: loadedHashes }, null, 2)}\n`)
  if (summary.status !== 'passed') process.exitCode = 1
}

main().catch((error) => {
  const details = `${error.stack || error}\n${stopMarker(error.message) ? 'STOP_MARKER: stop immediately and report to root.' : ''}`
  process.stderr.write(`${details}\n`)
  process.exitCode = 1
})

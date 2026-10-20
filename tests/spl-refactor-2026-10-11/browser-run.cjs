'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const qaDir = __dirname
const repoRoot = path.resolve(qaDir, '../..')
const evidenceRoot = process.env.SPL_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-07-08/wo/qa/tunebuddy-spl-refinement-20261011'
const runLabel = (process.env.SPL_QA_RUN_LABEL || 'final-candidate')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'unnamed-run'
const outputRoot = path.join(evidenceRoot, 'browser-bridge', runLabel)
const screenshotRoot = path.join(outputRoot, 'screenshots')
const serverPath = path.join(qaDir, 'browser-server.cjs')
const chromePath = process.env.SPL_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = Number(process.env.SPL_QA_PORT) || 8137
const baseUrl = `http://127.0.0.1:${port}/tests/spl-refactor-2026-10-11/browser.html`
const mainStates = [
  'default', 'two-distributed', 'two-coherent', 'long-model',
  'high-count-16', 'invalid', 'reset-blank', 'pending',
]
const mainViewports = [
  { width: 390, height: 671 },
  { width: 320, height: 480 },
]
const mainCases = mainStates.flatMap((state) => mainViewports.flatMap(({ width, height }) => ['light', 'dark'].map((theme) => ({
  name: `main-${state}-${width}x${height}-${theme}`,
  state,
  theme,
  width,
  height,
  capture: true,
}))))
const mainStateBoundaryCases = ['invalid', 'pending', 'reset-blank'].flatMap((state) =>
  [{ width: 320, height: 671 }, { width: 360, height: 671 }].flatMap(({ width, height }) => ['light', 'dark'].map((theme) => ({
    name: `main-${state}-${width}x${height}-${theme}`,
    state,
    theme,
    width,
    height,
    capture: true,
  }))),
)
const tabViewports = [
  { width: 390, height: 671 },
  { width: 320, height: 480 },
  { width: 320, height: 671 },
  { width: 360, height: 671 },
]
const tabCases = ['spl', 'distance', 'reference'].flatMap((tab) => tabViewports.flatMap(({ width, height }) => ['light', 'dark'].map((theme) => ({
  name: `tab-${tab}-default-${width}x${height}-${theme}`,
  state: `tab-${tab}-default`,
  theme,
  width,
  height,
  capture: true,
}))))
const tabEdgeCases = [
  { name: 'tab-spl-high-count-16-320x480-light', state: 'tab-spl-high-count-16', theme: 'light', width: 320, height: 480, capture: true },
  { name: 'tab-spl-long-model-320x671-dark', state: 'tab-spl-long-model', theme: 'dark', width: 320, height: 671, capture: true },
  { name: 'tab-distance-high-count-16-320x480-dark', state: 'tab-distance-high-count-16', theme: 'dark', width: 320, height: 480, capture: true },
  { name: 'tab-distance-high-output-16-coherent-320x480-light', state: 'tab-distance-high-output-16-coherent', theme: 'light', width: 320, height: 480, capture: true },
  { name: 'tab-distance-high-output-16-coherent-320x480-dark', state: 'tab-distance-high-output-16-coherent', theme: 'dark', width: 320, height: 480, capture: true },
  { name: 'tab-reference-single-9.8-320x480-light', state: 'tab-reference-single-9.8', theme: 'light', width: 320, height: 480, capture: true },
  { name: 'tab-reference-single-9.8-320x480-dark', state: 'tab-reference-single-9.8', theme: 'dark', width: 320, height: 480, capture: true },
  { name: 'tab-distance-maximum-distance-320x480-light', state: 'tab-distance-maximum-distance', theme: 'light', width: 320, height: 480, capture: true },
  { name: 'tab-distance-custom-distance-7.3-390x671-dark', state: 'tab-distance-custom-distance-7.3', theme: 'dark', width: 390, height: 671, capture: true },
  { name: 'tab-reference-high-output-16-coherent-320x480-dark', state: 'tab-reference-high-output-16-coherent', theme: 'dark', width: 320, height: 480, capture: true },
  { name: 'tab-reference-long-model-320x671-light', state: 'tab-reference-long-model', theme: 'light', width: 320, height: 671, capture: true },
  { name: 'reset-error-320x480-light', state: 'reset-error', theme: 'light', width: 320, height: 480, capture: true },
]
const referenceBranchCases = [
  { name: 'tab-reference-band-below-60-320x480-light', state: 'tab-reference-band-below-60', theme: 'light' },
  { name: 'tab-reference-band-60-75-320x480-dark', state: 'tab-reference-band-60-75', theme: 'dark' },
  { name: 'tab-reference-band-75-85-320x480-light', state: 'tab-reference-band-75-85', theme: 'light' },
  { name: 'tab-reference-band-85-95-320x480-dark', state: 'tab-reference-band-85-95', theme: 'dark' },
  { name: 'tab-reference-band-95-105-320x480-light', state: 'tab-reference-band-95-105', theme: 'light' },
  { name: 'tab-reference-band-95-105-320x480-dark', state: 'tab-reference-band-95-105', theme: 'dark' },
  { name: 'tab-reference-band-above-105-320x480-light', state: 'tab-reference-band-above-105', theme: 'light' },
  { name: 'tab-reference-meeting-98-plus-320x480-light', state: 'tab-reference-meeting-98-plus', theme: 'light' },
  { name: 'tab-reference-meeting-98-plus-320x480-dark', state: 'tab-reference-meeting-98-plus', theme: 'dark' },
].map((item) => ({ ...item, width: 320, height: 480, capture: true }))
const allCases = [
  ...mainCases,
  ...mainStateBoundaryCases,
  ...tabCases,
  ...tabEdgeCases,
  ...referenceBranchCases,
  { name: 'main-default-320x671-light-narrow-tall', state: 'default', theme: 'light', width: 320, height: 671, capture: true },
  { name: 'main-default-320x671-dark-narrow-tall', state: 'default', theme: 'dark', width: 320, height: 671, capture: true },
  { name: 'main-default-320x480-light-narrow-short-boundary', state: 'default', theme: 'light', width: 320, height: 480, capture: true },
  { name: 'main-default-320x480-dark-narrow-short-boundary', state: 'default', theme: 'dark', width: 320, height: 480, capture: true },
  { name: 'main-default-360x671-light-width-boundary', state: 'default', theme: 'light', width: 360, height: 671, capture: true },
  { name: 'main-default-360x671-dark-width-boundary', state: 'default', theme: 'dark', width: 360, height: 671, capture: true },
  { name: 'selector-empty-320x480-dark', state: 'selector-empty', theme: 'dark', width: 320, height: 480, capture: true },
  { name: 'selector-list-390x671-light', state: 'selector-list', theme: 'light', width: 390, height: 671 },
  { name: 'share-generating-390x671-dark', state: 'share-generating', theme: 'dark', width: 390, height: 671, capture: true },
  { name: 'share-reduced-motion-390x671-dark', state: 'share-generating', theme: 'dark', width: 390, height: 671, reducedMotion: true, capture: true },
  { name: 'share-closing-390x671-light', state: 'share-closing', theme: 'light', width: 390, height: 671, capture: true },
  { name: 'share-error-320x480-dark', state: 'share-error', theme: 'dark', width: 320, height: 480, capture: true },
  { name: 'share-short-320x480-light', state: 'share-short', theme: 'light', width: 320, height: 480, capture: true },
  { name: 'share-long-390x671-light', state: 'share-long', theme: 'light', width: 390, height: 671, capture: true },
  { name: 'share-long-kf-390x671-light', state: 'share-long-kf', theme: 'light', width: 390, height: 671, capture: true },
  { name: 'project-list-390x671-dark', state: 'project-list', theme: 'dark', width: 390, height: 671 },
  { name: 'project-list-selected-390x671-light', state: 'project-list-selected', theme: 'light', width: 390, height: 671, capture: true },
  { name: 'project-details-390x671-light', state: 'project-details', theme: 'light', width: 390, height: 671, capture: true },
  { name: 'project-keyboard-select-390x671-light-overlay', state: 'project-keyboard-select-overlay', theme: 'light', width: 390, height: 671, baselineHeight: 671, capture: true },
  { name: 'project-keyboard-select-390x671-dark-resize', state: 'project-keyboard-select-resize', theme: 'dark', width: 390, height: 391, baselineHeight: 671, capture: true },
  { name: 'project-keyboard-select-320x480-light-overlay', state: 'project-keyboard-select-overlay', theme: 'light', width: 320, height: 480, baselineHeight: 480, capture: true, captureFocusedField: true },
  { name: 'project-keyboard-select-320x480-dark-resize', state: 'project-keyboard-select-resize', theme: 'dark', width: 320, height: 200, baselineHeight: 480, capture: true, captureFocusedField: true },
  { name: 'project-keyboard-create-390x671-dark-overlay', state: 'project-keyboard-create-overlay', theme: 'dark', width: 390, height: 671, baselineHeight: 671, capture: true },
  { name: 'project-keyboard-create-390x671-light-resize', state: 'project-keyboard-create-resize', theme: 'light', width: 390, height: 391, baselineHeight: 671, capture: true },
  { name: 'project-keyboard-create-320x480-dark-overlay', state: 'project-keyboard-create-overlay', theme: 'dark', width: 320, height: 480, baselineHeight: 480, capture: true, captureFocusedField: true },
  { name: 'project-keyboard-create-320x480-light-resize', state: 'project-keyboard-create-resize', theme: 'light', width: 320, height: 200, baselineHeight: 480, capture: true, captureFocusedField: true },
  { name: 'project-keyboard-details-390x671-light-overlay', state: 'project-keyboard-details-overlay', theme: 'light', width: 390, height: 671, baselineHeight: 671, capture: true },
  { name: 'project-keyboard-details-390x671-dark-resize', state: 'project-keyboard-details-resize', theme: 'dark', width: 390, height: 391, baselineHeight: 671, capture: true },
  { name: 'project-keyboard-details-320x480-light-overlay', state: 'project-keyboard-details-overlay', theme: 'light', width: 320, height: 480, baselineHeight: 480, capture: true, captureFocusedField: true },
  { name: 'project-keyboard-details-320x480-dark-resize', state: 'project-keyboard-details-resize', theme: 'dark', width: 320, height: 200, baselineHeight: 480, capture: true, captureFocusedField: true },
]
const selectedNames = process.env.SPL_QA_CASES
  ? process.env.SPL_QA_CASES.split(',').map((name) => name.trim()).filter(Boolean)
  : null
const selectedCases = selectedNames ? allCases.filter((item) => selectedNames.includes(item.name)) : allCases
assert(selectedCases.length > 0, `No SPL browser cases matched: ${selectedNames?.join(', ') || ''}`)

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

function writeFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, data)
}

function stopMarker(text) { return /setup refresh had errors/i.test(text) }

async function waitForServer(child, output) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (stopMarker(output.stdout + output.stderr)) throw new Error('STOP_MARKER: setup refresh had errors appeared in browser bridge output')
    if (child.exitCode !== null) throw new Error(`SPL bridge exited ${child.exitCode}: ${output.stdout}\n${output.stderr}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__qa-meta`)
      if (response.ok) return
    } catch (_error) {}
    await delay(150)
  }
  throw new Error(`Timed out starting SPL bridge: ${output.stdout}\n${output.stderr}`)
}

async function connectChrome(child) {
  let stderr = ''
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome CDP startup timed out: ${stderr}`)), 15000)
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stopMarker(stderr)) {
        clearTimeout(timer)
        reject(new Error('STOP_MARKER: setup refresh had errors appeared in Chrome startup output'))
        return
      }
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => {
      if (!stderr.includes('DevTools listening on ')) {
        clearTimeout(timer)
        reject(new Error(`Chrome exited before CDP started (${code}/${signal}): ${stderr}`))
      }
    })
  })
  const endpointUrl = new URL(endpoint)
  const response = await fetch(`http://${endpointUrl.host}/json/new?about:blank`, { method: 'PUT' })
  assert(response.ok, `Chrome /json/new failed: ${response.status}`)
  const target = await response.json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return { socket, port: Number(endpointUrl.port), endpoint, target, startupStderr: stderr }
}

function createCdp(socket) {
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id || !pending.has(message.id)) return
    const handler = pending.get(message.id)
    pending.delete(message.id)
    clearTimeout(handler.timeout)
    if (message.error) handler.reject(new Error(message.error.message))
    else handler.resolve(message.result || {})
  })
  return {
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`CDP call timed out: ${method}`))
        }, 15000)
        pending.set(id, { resolve, reject, timeout })
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
  assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath}`)
  fs.mkdirSync(screenshotRoot, { recursive: true })
  const serverOutput = { stdout: '', stderr: '' }
  const server = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: { ...process.env, SPL_QA_PORT: String(port), SPL_QA_EVIDENCE_ROOT: evidenceRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  server.stdout.on('data', (data) => { serverOutput.stdout += data.toString() })
  server.stderr.on('data', (data) => { serverOutput.stderr += data.toString() })

  const summary = {
    startedAt: new Date().toISOString(),
    evidenceRoot: outputRoot,
    browser: 'Google Chrome headless controlled through Chrome DevTools Protocol device metrics',
    runLabel,
    viewportCases: selectedCases,
    limitations: 'Chromium renders actual production SPL WXML and expanded production WXSS. This is browser-only evidence, not WeChat runtime or device behavior.',
    cases: [],
  }
  let chrome
  let socket
  let cdp
  try {
    await waitForServer(server, serverOutput)
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spl-browser-cdp-'))
    chrome = spawn(chromePath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    const connection = await connectChrome(chrome)
    socket = connection.socket
    cdp = createCdp(socket)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    for (const item of selectedCases) {
      if (stopMarker(serverOutput.stdout + serverOutput.stderr)) {
        throw new Error('STOP_MARKER: setup refresh had errors appeared in SPL bridge process')
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: item.width,
        height: item.height,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: item.width,
        screenHeight: item.height,
      })
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await cdp.send('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-color-scheme', value: item.theme },
        { name: 'prefers-reduced-motion', value: item.reducedMotion ? 'reduce' : 'no-preference' },
      ] })
      const url = new URL(baseUrl)
      url.searchParams.set('case', item.state)
      url.searchParams.set('theme', item.theme)
      url.searchParams.set('width', String(item.width))
      url.searchParams.set('height', String(item.height))
      url.searchParams.set('baselineHeight', String(item.baselineHeight || item.height))
      await cdp.send('Page.navigate', { url: url.href })

      let state = ''
      for (let attempt = 0; attempt < 120; attempt += 1) {
        state = await evaluate(cdp, 'document.documentElement.dataset.splQaReady || document.documentElement.dataset.splQaError || ""')
        if (state === 'true') break
        if (state === 'error' || state) throw new Error(`${item.name}: browser bridge failed: ${await evaluate(cdp, 'document.documentElement.dataset.splQaError || document.title')}`)
        if (stopMarker(serverOutput.stdout + serverOutput.stderr)) {
          throw new Error('STOP_MARKER: setup refresh had errors appeared during browser run')
        }
        await delay(100)
      }
      assert.equal(state, 'true', `${item.name}: browser bridge did not finish rendering`)
      const resultJson = await evaluate(cdp, 'JSON.stringify(window.__splBrowserQa || null)')
      assert(resultJson, `${item.name}: browser layout result missing`)
      const report = JSON.parse(resultJson)
      const screenshotPath = item.capture ? path.join(screenshotRoot, `${item.name}.png`) : null
      if (screenshotPath) {
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
        writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
      }
      let focusedCapture = null
      let focusedScreenshotPath = null
      if (item.captureFocusedField) {
        const field = report.fixture?.interaction?.keyboardField
        assert(['projectSearch', 'newProjectName', 'projectConfigName', 'projectConfigNote'].includes(field), `${item.name}: focused field is not a supported project input`)
        const selector = JSON.stringify(`[data-project-field="${field}"]`)
        focusedCapture = await evaluate(cdp, `(() => {
          const body = document.querySelector('.project-sheet-body')
          const input = document.querySelector(${selector})
          if (!body || !input) return null
          const bodyBefore = body.getBoundingClientRect()
          const inputBefore = input.getBoundingClientRect()
          let delta = 0
          if (inputBefore.height > body.clientHeight) delta = inputBefore.top - bodyBefore.top
          else if (inputBefore.bottom > bodyBefore.bottom) delta = inputBefore.bottom - bodyBefore.bottom
          else if (inputBefore.top < bodyBefore.top) delta = inputBefore.top - bodyBefore.top
          const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
          body.scrollTop = Math.max(0, Math.min(maxScrollTop, body.scrollTop + delta))
          try { input.focus({ preventScroll: true }) } catch (_error) { input.focus() }
          const bodyRect = body.getBoundingClientRect()
          const inputRect = input.getBoundingClientRect()
          return {
            field: input.dataset.projectField,
            scrollTop: body.scrollTop,
            body: { x: bodyRect.x, y: bodyRect.y, width: bodyRect.width, height: bodyRect.height, right: bodyRect.right, bottom: bodyRect.bottom },
            input: { x: inputRect.x, y: inputRect.y, width: inputRect.width, height: inputRect.height, right: inputRect.right, bottom: inputRect.bottom },
            visibleHeight: Math.max(0, Math.min(inputRect.bottom, bodyRect.bottom) - Math.max(inputRect.top, bodyRect.top)),
          }
        })()`)
        assert(focusedCapture, `${item.name}: focused capture target is missing`)
        const minimumVisible = Math.min(44, focusedCapture.input.height, focusedCapture.body.height) - 1
        assert(focusedCapture.input.x >= focusedCapture.body.x - 1
          && focusedCapture.input.right <= focusedCapture.body.right + 1
          && focusedCapture.visibleHeight >= minimumVisible,
        `${item.name}: focused field is not sufficiently reachable: ${JSON.stringify(focusedCapture)}`)
        await delay(80)
        await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        focusedScreenshotPath = path.join(screenshotRoot, `${item.name}-focused.png`)
        const focusedScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
        writeFile(focusedScreenshotPath, Buffer.from(focusedScreenshot.data, 'base64'))
      }
      const entry = { case: item, report, screenshot: screenshotPath, focusedCapture, focusedScreenshot: focusedScreenshotPath }
      writeFile(path.join(outputRoot, `${item.name}.json`), `${JSON.stringify(entry, null, 2)}\n`)
      summary.cases.push({
        name: item.name,
        status: report.status,
        checkCount: report.checks?.length || 0,
        failures: report.failures || [],
        screenshot: screenshotPath,
        focusedScreenshot: focusedScreenshotPath,
        focusedCapture,
      })
    }
    summary.finishedAt = new Date().toISOString()
    summary.status = summary.cases.every((item) => item.status === 'passed') ? 'passed' : 'failed'
    summary.chrome = { endpoint: connection.endpoint, port: connection.port }
    summary.serverOutput = serverOutput
    writeFile(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ status: summary.status, caseCount: summary.cases.length, failedCases: summary.cases.filter((item) => item.status !== 'passed').map((item) => item.name), summaryPath: path.join(outputRoot, 'summary.json') }, null, 2)}\n`)
    if (summary.status !== 'passed') process.exitCode = 1
  } catch (error) {
    summary.finishedAt = new Date().toISOString()
    summary.status = /STOP_MARKER/.test(String(error)) ? 'stopped-by-policy-marker' : 'error'
    summary.error = String(error && error.stack || error)
    summary.serverOutput = serverOutput
    writeFile(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    process.stderr.write(`${summary.error}\n`)
    process.exitCode = /STOP_MARKER/.test(String(error)) ? 2 : 1
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close()
    if (chrome && chrome.exitCode === null) chrome.kill()
    if (server && server.exitCode === null) server.kill()
  }
}

function writeFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, data)
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + '\n')
  process.exitCode = 1
})

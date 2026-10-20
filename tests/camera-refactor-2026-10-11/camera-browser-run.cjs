'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const qaDir = __dirname
const repoRoot = path.resolve(qaDir, '../..')
const qaVersion = (process.env.CAMERA_QA_VERSION || 'v2').toLowerCase()
assert(['v1', 'v2'].includes(qaVersion), `Unsupported CAMERA_QA_VERSION: ${qaVersion}`)
const defaultEvidenceName = qaVersion === 'v2' ? 'evidence-v2' : 'evidence'
const evidenceRoot = path.resolve(process.env.CAMERA_QA_OUTPUT_ROOT
  ? path.resolve(repoRoot, process.env.CAMERA_QA_OUTPUT_ROOT)
  : path.join(qaDir, defaultEvidenceName))
const diagnosticMode = process.env.CAMERA_QA_CAPTURE_FAILURES === '1'
const runOutputRoot = diagnosticMode ? path.join(evidenceRoot, 'diagnostic') : evidenceRoot
const isSameOrDescendant = (candidate, parent) => {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
const pathsOverlap = (left, right) => isSameOrDescendant(left, right) || isSameOrDescendant(right, left)
const qaResolved = path.resolve(qaDir)
assert(isSameOrDescendant(evidenceRoot, qaResolved), `Camera QA output must stay under ${qaResolved}: ${evidenceRoot}`)
if (qaVersion === 'v2') {
  for (const protectedName of ['evidence', 'delivery-screenshots', 'delivery-screenshots-v2', 'library-direct-upload-receipt.json', 'library-status.json']) {
    const protectedPath = path.resolve(qaDir, protectedName)
    assert(!pathsOverlap(evidenceRoot, protectedPath), `V2 output must not overlap V1 or Library evidence: ${evidenceRoot}`)
  }
} else {
  for (const protectedName of ['evidence-v2', 'delivery-screenshots', 'delivery-screenshots-v2', 'library-direct-upload-receipt.json', 'library-status.json']) {
    const protectedPath = path.resolve(qaDir, protectedName)
    assert(!pathsOverlap(evidenceRoot, protectedPath), `V1 output must not overlap V2 or delivery evidence: ${evidenceRoot}`)
  }
  if (fs.existsSync(evidenceRoot) && process.env.CAMERA_QA_ALLOW_V1_OVERWRITE !== '1') {
    throw new Error(`V1 evidence is archived and protected from overwrite: ${evidenceRoot}`)
  }
}
const screenshotRoot = path.join(runOutputRoot, 'screenshots')
const serverPath = path.join(qaDir, 'camera-browser-server.cjs')
const chromePath = process.env.CAMERA_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = Number(process.env.CAMERA_QA_PORT) || 8146
const baseUrl = `http://127.0.0.1:${port}/tests/camera-refactor-2026-10-11/camera-browser.html`
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const stopMarker = (text) => /setup refresh had errors/i.test(text)

const allCases = [
  { name: 'compact-first-screen-390-700-light', scenario: 'ground', width: 390, height: 700, theme: 'light', view: 0, capture: true },
  { name: 'default-ground-plan-390-light', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0, capture: true },
  { name: 'default-ground-elevation-430-dark', scenario: 'ground', width: 430, height: 932, theme: 'dark', view: 1, capture: true },
  { name: 'default-ground-320-light-zoom-1', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, capture: true },
  { name: 'default-ground-320-light-zoom-1_3', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3, capture: true },
  { name: 'default-plane-plan-375-light', scenario: 'plane', width: 375, height: 812, theme: 'light', view: 0, capture: true },
  { name: 'default-plane-elevation-375-dark', scenario: 'plane', width: 375, height: 812, theme: 'dark', view: 1, capture: true },
  { name: 'plane-decimal-caption-390-light', scenario: 'plane-decimal-caption', width: 390, height: 844, theme: 'light', view: 1, capture: true },
  { name: 'h-only-elevation-375-light', scenario: 'horizontal-only', width: 375, height: 812, theme: 'light', view: 1, capture: true },
  { name: 'h-only-details-375-light', scenario: 'horizontal-only', width: 375, height: 812, theme: 'light', view: 1, derive: 'open', capture: false },
  { name: 'long-depth-label-320-light', scenario: 'long-depth', width: 320, height: 700, theme: 'light', view: 0, capture: true },
  { name: 'long-depth-label-375-dark', scenario: 'long-depth', width: 375, height: 812, theme: 'dark', view: 0, capture: true },
  { name: 'extreme-plane-elevation-375-dark', scenario: 'extreme-plane', width: 375, height: 812, theme: 'dark', view: 1, capture: true },
  { name: 'long-model-320-light', scenario: 'long-model', width: 320, height: 700, theme: 'light', view: 0, capture: true },
  { name: 'invalid-320-dark', scenario: 'empty', width: 320, height: 700, theme: 'dark', view: 0, capture: true },
  { name: 'invalid-390-light', scenario: 'empty', width: 390, height: 844, theme: 'light', view: 0, capture: true },
  { name: 'invalid-target-error-hidden-375-light', scenario: 'empty', width: 375, height: 812, theme: 'light', tab: 0, view: 0, capture: true },
  { name: 'fixed-camera-main-result-375-dark', scenario: 'fixed', width: 375, height: 812, theme: 'dark', view: 0, capture: true },
  { name: 'eptz-main-result-375-light', scenario: 'eptz', width: 375, height: 812, theme: 'light', view: 0, capture: true },
  { name: 'mixed-dual-fixed-h-only-375-dark', scenario: 'dual-fixed', width: 375, height: 812, theme: 'dark', view: 1, capture: true },
  { name: 'structured-operation-375-light', scenario: 'operation', width: 375, height: 812, theme: 'light', view: 0, capture: true },
  { name: 'custom-sensor-install-375-dark', scenario: 'custom-sensor', width: 375, height: 812, theme: 'dark', tab: 2, view: 0, capture: true },
]
const selectedNames = process.env.CAMERA_QA_CASES
  ? process.env.CAMERA_QA_CASES.split(',').map((name) => name.trim()).filter(Boolean)
  : null
const cases = selectedNames ? allCases.filter((item) => selectedNames.includes(item.name)) : allCases
assert(cases.length > 0, `No camera browser cases matched: ${selectedNames?.join(', ') || ''}`)

function writeFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, data)
}

async function waitForServer(child, output) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (stopMarker(output.stdout + output.stderr)) throw new Error('STOP_MARKER: setup refresh had errors appeared in browser bridge output')
    if (child.exitCode !== null) throw new Error(`Camera bridge exited ${child.exitCode}: ${output.stdout}\n${output.stderr}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__qa-meta`)
      if (response.ok) return
    } catch (_error) {}
    await delay(100)
  }
  throw new Error(`Timed out starting camera bridge: ${output.stdout}\n${output.stderr}`)
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
  return { socket, endpoint }
}

function createCdp(socket) {
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id || !pending.has(message.id)) return
    const task = pending.get(message.id)
    pending.delete(message.id)
    clearTimeout(task.timeout)
    if (message.error) task.reject(new Error(message.error.message))
    else task.resolve(message.result || {})
  })
  return {
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`CDP timed out: ${method}`))
        }, 20000)
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

async function navigateCase(cdp, item, serverOutput) {
  if (stopMarker(serverOutput.stdout + serverOutput.stderr)) throw new Error('STOP_MARKER: setup refresh had errors appeared during camera browser run')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: item.width, height: item.height, deviceScaleFactor: 1, mobile: true,
    screenWidth: item.width, screenHeight: item.height,
  })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: item.theme },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ] })
  const url = new URL(baseUrl)
  url.searchParams.set('case', item.scenario)
  url.searchParams.set('theme', item.theme)
  url.searchParams.set('view', String(item.view ?? 0))
  if (item.tab !== undefined) url.searchParams.set('tab', String(item.tab))
  if (item.derive) url.searchParams.set('derive', item.derive)
  if (item.zoom) url.searchParams.set('zoom', String(item.zoom))
  await cdp.send('Page.navigate', { url: url.href })

  let state = ''
  for (let attempt = 0; attempt < 150; attempt += 1) {
    state = await evaluate(cdp, 'document.documentElement.dataset.cameraQaReady || document.documentElement.dataset.cameraQaError || ""')
    if (state === 'true') break
    if (state === 'error' || state) throw new Error(`${item.name}: ${await evaluate(cdp, 'document.documentElement.dataset.cameraQaError || document.title')}`)
    if (stopMarker(serverOutput.stdout + serverOutput.stderr)) throw new Error('STOP_MARKER: setup refresh had errors appeared during camera browser run')
    await delay(100)
  }
  assert.equal(state, 'true', `${item.name}: camera browser bridge did not finish`)
  const reportJson = await evaluate(cdp, 'JSON.stringify(window.__cameraQa || null)')
  assert(reportJson, `${item.name}: browser report missing`)
  const report = JSON.parse(reportJson)
  if (report.status !== 'passed' && process.env.CAMERA_QA_CAPTURE_FAILURES !== '1') {
    assert.equal(report.status, 'passed', `${item.name}: ${JSON.stringify(report.failures)}`)
  }
  return report
}

async function capture(cdp, screenshotPath) {
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
}

async function runInteractions(cdp) {
  const clickBound = async (selector) => {
    const safeSelector = JSON.stringify(selector)
    return evaluate(cdp, `(() => { const element = document.querySelector(${safeSelector}); if (!element) throw new Error('Missing clickable element: ' + ${safeSelector}); element.click(); return window.__cameraLastDispatch })()`)
  }
  const before = JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__cameraQa.result)'))
  const planCanvasPixels = await measureCanvasPixels(cdp)
  const initialDetails = await evaluate(cdp, 'Boolean(document.querySelector("#cameraDetailsContent"))')
  assert.equal(initialDetails, false, 'calculation detail should start collapsed')

  for (const index of [1, 2, 0, 1]) {
    await clickBound(`#cameraInputTabs .camera-input-tab[data-index="${index}"]`)
    const status = await evaluate(cdp, 'document.body.dataset.qaStatus')
    assert.equal(status, 'passed', `input tab ${index} state invalid`)
  }
  const inputState = await evaluate(cdp, `({ visible: [...document.querySelectorAll('#cameraInputPanelCamera,#cameraInputPanelTarget,#cameraInputPanelInstall')].map((e) => e.id), selected: [...document.querySelectorAll('#cameraInputTabs [role="tab"]')].filter((e) => e.getAttribute('aria-selected') === 'true').length })`)
  assert.deepEqual(inputState.visible, ['cameraInputPanelTarget'])
  assert.equal(inputState.selected, 1)

  for (const index of [1, 0, 1]) {
    await clickBound(`#cameraPreviewViewToggle .camera-preview-tab[data-index="${index}"]`)
  }
  const viewState = await evaluate(cdp, `({ view: window.__cameraQa.canvas.view, selected: [...document.querySelectorAll('#cameraPreviewViewToggle [role="tab"]')].filter((e) => e.getAttribute('aria-selected') === 'true').length, result: window.__cameraQa.result })`)
  const elevationCanvasPixels = await measureCanvasPixels(cdp)
  assert.equal(viewState.view, 'elevation')
  assert.equal(viewState.selected, 1)
  assert.deepEqual(viewState.result, before, 'repeated UI toggles should not change calculation values')
  assert(planCanvasPixels?.fnv1a32 !== elevationCanvasPixels?.fnv1a32,
    `Toggling plan/elevation should redraw different actual Canvas pixels: ${JSON.stringify({ planCanvasPixels, elevationCanvasPixels })}`)

  await clickBound('#cameraDetailsToggle')
  const detailState = await evaluate(cdp, `(() => {
    const details = document.querySelector('#cameraDetailsContent')
    const lines = [...(details?.querySelectorAll('.camera-detail-line') || [])]
    return { visible: Boolean(details), horizontal: Boolean(details?.querySelector('.horizontal-geometry')),
      vertical: Boolean(details?.querySelector('.vertical-geometry')), distance: Boolean(details?.querySelector('.distance-bars')),
      legend: lines.some((line) => line.textContent.includes('图例：')),
      groundEffectiveHeight: lines.some((line) => line.textContent.includes(
        '含余量目标高度：0–' + window.__cameraFixture?.state?.result?.effectiveSubjectHeightMeters + ' m')),
      limits: Boolean(details?.querySelector('.camera-detail-limit')) }
  })()`)
  assert.deepEqual(detailState, { visible: true, horizontal: true, vertical: true, distance: true, legend: true, groundEffectiveHeight: true, limits: true })
  return { inputTabs: inputState, previewView: viewState.view, details: detailState, calculationUnchanged: true, planCanvasPixels, elevationCanvasPixels }
}

async function captureExpandedSections(cdp, serverOutput, screenshotRoot, item) {
  const report = await navigateCase(cdp, item, serverOutput)
  const click = async (selector) => evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw new Error('Missing element: ' + ${JSON.stringify(selector)})
    element.click()
    return window.__cameraLastDispatch
  })()`)
  await click('#cameraDetailsToggle')
  await evaluate(cdp, 'window.__cameraLastDispatch')
  const detailState = await evaluate(cdp, `(() => {
    const scroll = document.querySelector('.page-scroll')
    const target = document.querySelector('#cameraDetailsContent')
    if (!scroll || !target) throw new Error('Expanded calculation detail is not mounted')
    const scrollRect = scroll.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    scroll.scrollTop += targetRect.top - scrollRect.top - 16
    return {
      horizontal: Boolean(target.querySelector('.horizontal-geometry')),
      vertical: Boolean(target.querySelector('.vertical-geometry')),
      distance: Boolean(target.querySelector('.distance-bars')),
      formulas: target.querySelectorAll('.camera-formula-row').length,
      scrollTop: Number(scroll.scrollTop.toFixed(2)),
    }
  })()`)
  assert(detailState.horizontal && detailState.vertical && detailState.distance,
    `Expanded detail must retain its three geometry diagrams: ${JSON.stringify(detailState)}`)
  await new Promise((resolve) => setTimeout(resolve, 80))
  const zoomSuffix = item.zoom ? `-zoom-${String(item.zoom).replace('.', '_')}` : ''
  const detailsPath = path.join(screenshotRoot, `details-expanded-${item.width}${zoomSuffix}-${item.theme}.png`)
  await capture(cdp, detailsPath)

  await click('#cameraDetailsToggle')
  await evaluate(cdp, 'window.__cameraLastDispatch')
  const detailsCollapsed = await evaluate(cdp, 'Boolean(document.querySelector("#cameraDetailsContent")) === false')
  assert(detailsCollapsed, 'Action screenshot should show the default collapsed derivation state')

  const actionState = await evaluate(cdp, `(() => {
    const scroll = document.querySelector('.page-scroll')
    const target = document.querySelector('#cameraActions')
    if (!scroll || !target) throw new Error('Camera result actions are not mounted')
    const scrollRect = scroll.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    scroll.scrollTop += targetRect.top - scrollRect.top - 16
    const visible = [...target.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect()
      return { id: button.id, top: Number(rect.top.toFixed(2)), bottom: Number(rect.bottom.toFixed(2)), height: Number(rect.height.toFixed(2)) }
    })
    return { visible, scrollTop: Number(scroll.scrollTop.toFixed(2)), scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight, maxScrollTop: scroll.scrollHeight - scroll.clientHeight,
      scrollBox: { top: Number(scrollRect.top.toFixed(2)), bottom: Number(scrollRect.bottom.toFixed(2)) },
      actionBox: { top: Number(target.getBoundingClientRect().top.toFixed(2)), bottom: Number(target.getBoundingClientRect().bottom.toFixed(2)) },
      actionText: target.innerText }
  })()`)
  assert(actionState.visible.length === 2
    && actionState.visible.every((button) => ['cameraCopySummary', 'cameraCopyFull'].includes(button.id)),
  `Expected the two secondary copy actions outside the compact result rail: ${JSON.stringify(actionState)}`)
  assert(actionState.visible.every((button) => button.height >= 44 && button.top >= 0 && button.bottom <= item.height),
    `Action buttons should be tappable and fit the viewport: ${JSON.stringify(actionState)}`)
  await new Promise((resolve) => setTimeout(resolve, 80))
  const actionsPath = path.join(screenshotRoot, `actions-${item.width}${zoomSuffix}-${item.theme}.png`)
  await capture(cdp, actionsPath)
  return {
    status: 'passed',
    sourceStatus: report.status,
    details: detailState,
    detailsCollapsedForActions: detailsCollapsed,
    detailsScreenshot: detailsPath,
    actions: actionState.visible,
    actionsScreenshot: actionsPath,
  }
}

async function measureField(cdp, field) {
  const safeField = JSON.stringify(field)
  return evaluate(cdp, `(() => {
    const scroll = document.querySelector('.page-scroll')
    const input = [...document.querySelectorAll('input[data-field]')].find((item) => item.dataset.field === ${safeField})
    if (!scroll || !input) return null
    const r = input.getBoundingClientRect()
    const s = scroll.getBoundingClientRect()
    const empty = document.querySelector('#cameraResultEmpty')
    const emptyRect = empty?.getBoundingClientRect()
    const hero = document.querySelector('#cameraResultHero')
    const heroRect = hero?.getBoundingClientRect()
    const tail = document.querySelector('#cameraResultTail')
    const tailRect = tail?.getBoundingClientRect()
    const tailPlaceholder = document.querySelector('.camera-result-tail-placeholder')
    const tailPlaceholderRect = tailPlaceholder?.getBoundingClientRect()
    return {
      scrollTop: Number(scroll.scrollTop.toFixed(2)), scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      input: { top: Number(r.top.toFixed(2)), documentTop: Number((r.top + scroll.scrollTop).toFixed(2)), bottom: Number(r.bottom.toFixed(2)), height: Number(r.height.toFixed(2)),
        visibleHeight: Number(Math.max(0, Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top)).toFixed(2)), value: input.value },
      resultVisible: Boolean(document.querySelector('#cameraResultHero')),
      emptyVisible: Boolean(document.querySelector('#cameraResultEmpty')),
      emptyPanel: emptyRect ? { top: Number(emptyRect.top.toFixed(2)), height: Number(emptyRect.height.toFixed(2)), reserved: empty.classList.contains('camera-result-empty-reserved') } : null,
      pendingVisible: Boolean(document.querySelector('.camera-result-pending-mask')),
      resultHero: heroRect ? { top: Number(heroRect.top.toFixed(2)), height: Number(heroRect.height.toFixed(2)) } : null,
      resultTail: tailRect ? { top: Number(tailRect.top.toFixed(2)), height: Number(tailRect.height.toFixed(2)) } : null,
      resultTailPlaceholder: tailPlaceholderRect ? { top: Number(tailPlaceholderRect.top.toFixed(2)), height: Number(tailPlaceholderRect.height.toFixed(2)) } : null,
      resultPlaceholderStyle: empty?.getAttribute('style') || '',
      detailsExpanded: Boolean(document.querySelector('#cameraDetailsContent')),
    }
  })()`)
}

async function measureCanvasPixels(cdp) {
  return evaluate(cdp, `(() => {
    const canvas = document.querySelector('#cameraFovCanvas')
    if (!canvas) return null
    const context = canvas.getContext('2d')
    const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data
    let hash = 2166136261
    for (let index = 0; index < bytes.length; index += 1) hash = Math.imul(hash ^ bytes[index], 16777619)
    return { width: canvas.width, height: canvas.height, fnv1a32: (hash >>> 0).toString(16).padStart(8, '0') }
  })()`)
}

async function setFieldThroughDomInput(cdp, field, value) {
  const safeField = JSON.stringify(field)
  const safeValue = JSON.stringify(String(value))
  return evaluate(cdp, `(() => {
    const input = [...document.querySelectorAll('input[data-field]')].find((item) => item.dataset.field === ${safeField})
    if (!input) throw new Error('Input field not found: ' + ${safeField})
    input.focus({ preventScroll: true })
    input.value = ${safeValue}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return window.__cameraLastDispatch
  })()`)
}

async function runContinuousInputStability(cdp, serverOutput, width = 320, height = 700) {
  const item = { name: `continuous-valid-input-${width}-light`, scenario: 'ground', width, height, theme: 'light', view: 0 }
  await navigateCase(cdp, item, serverOutput)
  const clickTargetTab = await evaluate(cdp, `(() => {
    const tab = document.querySelector('#cameraInputTabs .camera-input-tab[data-index="1"]')
    if (!tab) throw new Error('Target input tab missing')
    tab.click()
    return window.__cameraLastDispatch
  })()`)
  if (clickTargetTab?.status && clickTargetTab.status !== 'passed') throw new Error('Target input tab did not render')
  await evaluate(cdp, `(() => {
    const input = [...document.querySelectorAll('input[data-field]')].find((item) => item.dataset.field === 'groundDepthText')
    if (!input) throw new Error('Ground depth input missing after selecting target tab')
    input.scrollIntoView({ block: 'center' })
    input.focus({ preventScroll: true })
    return true
  })()`)
  const before = await measureField(cdp, 'groundDepthText')
  assert(before && before.resultVisible && before.input.visibleHeight > 0, `Input should be visible before editing: ${JSON.stringify(before)}`)
  const beforeResultDepth = await evaluate(cdp, 'window.__cameraFixture.state.result.depthMeters')
  const beforeCanvas = await measureCanvasPixels(cdp)

  await setFieldThroughDomInput(cdp, 'groundDepthText', '4.1')
  const duringFirst = await measureField(cdp, 'groundDepthText')
  const duringFirstCanvas = await measureCanvasPixels(cdp)
  await setFieldThroughDomInput(cdp, 'groundDepthText', '5')
  const duringLatest = await measureField(cdp, 'groundDepthText')
  const duringLatestCanvas = await measureCanvasPixels(cdp)
  assert(duringFirst && duringLatest, 'Input control should remain mounted during valid input')
  const inFlightState = await evaluate(cdp, `({ result: window.__cameraQa.result,
    resultUpdating: Boolean(window.__cameraFixture.state.resultUpdating),
    resultVisible: Boolean(document.querySelector('#cameraResultHero')),
    pendingVisible: Boolean(document.querySelector('.camera-result-pending-mask')),
    emptyVisible: Boolean(document.querySelector('#cameraResultEmpty')) })`)
  assert(duringFirst.resultVisible && duringFirst.pendingVisible && inFlightState.resultUpdating
    && inFlightState.result && inFlightState.pendingVisible && !inFlightState.emptyVisible,
  `Valid input should retain the previous result under a pending mask until calculation settles: ${JSON.stringify({ duringFirst, inFlightState })}`)
  assert(beforeResultDepth === 4 && beforeCanvas?.fnv1a32 === duringFirstCanvas?.fnv1a32
    && beforeCanvas?.fnv1a32 === duringLatestCanvas?.fnv1a32,
  `Pending input should retain the previous 4 m canvas until calculation settles: ${JSON.stringify({ beforeResultDepth, beforeCanvas, duringFirstCanvas, duringLatestCanvas })}`)
  assert(Math.abs(duringLatest.scrollTop - before.scrollTop) <= 1
    && Math.abs(duringLatest.input.top - before.input.top) <= 2
    && duringLatest.input.visibleHeight > 0
    && Math.abs(duringLatest.scrollHeight - before.scrollHeight) <= 1,
  `The focused input should stay in place while valid input is pending: ${JSON.stringify({ before, duringLatest })}`)

  let savedState = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(50)
    const stateJson = await evaluate(cdp, `fetch('/__state?sessionId=' + encodeURIComponent(window.__cameraFixture.sessionId), { cache: 'no-store' }).then((response) => response.json()).then((value) => JSON.stringify(value.state))`)
    savedState = JSON.parse(stateJson)
    if (savedState.result && savedState.result.depthMeters === 5) break
  }
  assert(savedState?.result?.depthMeters === 5, `The debounced valid value did not calculate: ${JSON.stringify(savedState?.result)}`)
  await evaluate(cdp, 'window.__cameraRefreshState()')
  const after = await measureField(cdp, 'groundDepthText')
  const afterCanvas = await measureCanvasPixels(cdp)
  assert(afterCanvas?.fnv1a32 && afterCanvas.fnv1a32 !== beforeCanvas?.fnv1a32,
    `The actual canvas pixels should change when ground depth changes from 4 m to 5 m: ${JSON.stringify({ beforeCanvas, afterCanvas })}`)
  const scrollDeltaAfter = Number((after.scrollTop - before.scrollTop).toFixed(2))
  const scrollHeightDeltaDuring = duringLatest.scrollHeight - before.scrollHeight
  const scrollHeightDeltaAfter = after.scrollHeight - before.scrollHeight
  assert(after.resultVisible && !after.emptyVisible && after.input.visibleHeight > 0,
    `The same input should remain visible after the debounced result refresh: ${JSON.stringify({ before, after })}`)
  await setFieldThroughDomInput(cdp, 'groundDepthText', '')
  const cleared = await measureField(cdp, 'groundDepthText')
  const clearedCanvas = await measureCanvasPixels(cdp)
  assert(!cleared.resultVisible && cleared.emptyVisible && !clearedCanvas,
    `Clearing an invalid field should clear both the result and canvas: ${JSON.stringify({ cleared, clearedCanvas })}`)
  await setFieldThroughDomInput(cdp, 'groundDepthText', '5')
  const refillPending = await measureField(cdp, 'groundDepthText')
  let refillState = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(50)
    const stateJson = await evaluate(cdp, `fetch('/__state?sessionId=' + encodeURIComponent(window.__cameraFixture.sessionId), { cache: 'no-store' }).then((response) => response.json()).then((value) => JSON.stringify(value.state))`)
    refillState = JSON.parse(stateJson)
    if (refillState.result && refillState.result.depthMeters === 5) break
  }
  assert(refillState?.result?.depthMeters === 5, `Refilling a cleared field should recalculate: ${JSON.stringify(refillState?.result)}`)
  await evaluate(cdp, 'window.__cameraRefreshState()')
  const refilled = await measureField(cdp, 'groundDepthText')
  const refilledCanvas = await measureCanvasPixels(cdp)
  return {
    status: 'observed',
    bridgeNote: 'The bridge rerenders production WXML after each production onFieldInput call, restores the focused field and scrollTop, and reads delayed page state after the production debounce. The browser scroll measurements are evidence for layout stability; focus restoration is bridge behavior, not the native WeChat host.',
    before,
    beforeResultDepth,
    beforeCanvas,
    duringFirst,
    duringFirstCanvas,
    duringLatest,
    duringLatestCanvas,
    inFlightState,
    after,
    afterCanvas,
    scrollDeltaAfter,
    scrollHeightDeltaDuring,
    scrollHeightDeltaAfter,
    visibleAfter: after.input.visibleHeight >= Math.min(after.input.height, after.clientHeight) - 1,
    calculatedDepthMeters: savedState.result.depthMeters,
    cleared,
    clearedCanvas,
    refillPending,
    refilled,
    refilledCanvas,
    visibleAfterRefill: refilled.input.visibleHeight >= Math.min(refilled.input.height, refilled.clientHeight) - 1,
    canvasRestoredAfterRefill: refilledCanvas?.fnv1a32 === afterCanvas?.fnv1a32,
  }
}

async function runClearRefillPlaceholder(cdp, serverOutput, width, height) {
  const item = { name: `clear-refill-${width}`, scenario: 'ground', width, height, theme: 'light', view: 0 }
  await navigateCase(cdp, item, serverOutput)
  await evaluate(cdp, `(() => {
    const tab = document.querySelector('#cameraInputTabs .camera-input-tab[data-index="1"]')
    if (!tab) throw new Error('Target input tab missing')
    tab.click()
    return window.__cameraLastDispatch
  })()`)
  await evaluate(cdp, `(() => {
    const input = [...document.querySelectorAll('input[data-field]')].find((node) => node.dataset.field === 'groundDepthText')
    if (!input) throw new Error('Ground depth input missing')
    input.scrollIntoView({ block: 'center' })
    input.focus({ preventScroll: true })
    return true
  })()`)
  const before = await measureField(cdp, 'groundDepthText')
  assert(before.resultHero?.height > 0 && before.resultTail?.height > 0,
    `The starting valid result hero and action/detail tail must be measured in real Chrome DOM at ${width}px: ${JSON.stringify(before)}`)
  await setFieldThroughDomInput(cdp, 'groundDepthText', '')
  const cleared = await measureField(cdp, 'groundDepthText')
  assert(!cleared.resultVisible && cleared.emptyVisible && cleared.emptyPanel?.reserved,
    `Cleared result should use the reserved responsive placeholder at ${width}px: ${JSON.stringify(cleared)}`)
  const expectedPlaceholderHeight = before.resultHero.height
  assert(Math.abs(cleared.emptyPanel.height - expectedPlaceholderHeight) <= 3,
    `Cleared result placeholder should match the actual measured hero height at ${width}px: ${JSON.stringify({ cleared, expectedPlaceholderHeight })}`)
  assert(Math.abs(cleared.input.top - before.input.top) <= 2
    && Math.abs(cleared.scrollTop - before.scrollTop) <= 2
    && cleared.scrollHeight >= before.scrollHeight - 2
    && cleared.input.visibleHeight > 0,
  `Clearing the field must preserve input position/scrollTop and prevent document-height collapse at ${width}px: ${JSON.stringify({ before, cleared })}`)
  assert(cleared.resultTailPlaceholder?.height > 0
    && Math.abs(cleared.resultTailPlaceholder.height - before.resultTail.height) <= 3,
  `The invalid state should preserve the measured result action/detail tail height after the input card at ${width}px: ${JSON.stringify({ before, cleared })}`)

  await setFieldThroughDomInput(cdp, 'groundDepthText', '4')
  const refillPending = await measureField(cdp, 'groundDepthText')
  assert(refillPending.emptyVisible && refillPending.emptyPanel?.reserved,
    `Refilling should keep the reserved placeholder until recalculation at ${width}px: ${JSON.stringify(refillPending)}`)
  assert(Math.abs(refillPending.emptyPanel.height - cleared.emptyPanel.height) <= 1,
    `Empty placeholder height should remain stable while refilling at ${width}px: ${JSON.stringify({ cleared, refillPending })}`)
  assert(Math.abs(refillPending.input.top - before.input.top) <= 2
    && Math.abs(refillPending.scrollTop - before.scrollTop) <= 2
    && refillPending.scrollHeight >= before.scrollHeight - 2,
  `Refill pending state must preserve the field's screen position and prevent document-height collapse at ${width}px: ${JSON.stringify({ before, cleared, refillPending })}`)
  assert(refillPending.resultTailPlaceholder?.height > 0
    && Math.abs(refillPending.resultTailPlaceholder.height - before.resultTail.height) <= 3,
  `Refill pending state should retain the actual result tail placeholder at ${width}px: ${JSON.stringify({ before, cleared, refillPending })}`)

  let savedState = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(50)
    const stateJson = await evaluate(cdp, `fetch('/__state?sessionId=' + encodeURIComponent(window.__cameraFixture.sessionId), { cache: 'no-store' }).then((response) => response.json()).then((value) => JSON.stringify(value.state))`)
    savedState = JSON.parse(stateJson)
    if (savedState.result && savedState.result.depthMeters === 4) break
  }
  assert(savedState?.result?.depthMeters === 4, `Refilled value should recalculate at ${width}px: ${JSON.stringify(savedState?.result)}`)
  await evaluate(cdp, 'window.__cameraRefreshState()')
  const refilled = await measureField(cdp, 'groundDepthText')
  assert(refilled.input.visibleHeight > 0
    && Math.abs(refilled.input.top - before.input.top) <= 2
    && Math.abs(refilled.scrollTop - before.scrollTop) <= 2
    && Math.abs(refilled.scrollHeight - before.scrollHeight) <= 2,
  `Refilling the field should preserve input position, scrollTop, and document height at ${width}px: ${JSON.stringify({ before, cleared, refilled })}`)
  return {
    width, height,
    before, cleared, refillPending, refilled,
    placeholderExpectedHeight: Number(expectedPlaceholderHeight.toFixed(2)),
    placeholderHeightDelta: Number((refillPending.emptyPanel.height - cleared.emptyPanel.height).toFixed(2)),
    inputVisibleAfterClear: cleared.input.visibleHeight > 0,
    inputVisibleAfterRefill: refilled.input.visibleHeight > 0,
    scrollTopBefore: before.scrollTop,
    scrollTopAfterClear: cleared.scrollTop,
    scrollTopAfterRefill: refilled.scrollTop,
    inputTopBefore: before.input.top,
    inputTopAfterClear: cleared.input.top,
    inputTopDuringRefill: refillPending.input.top,
    inputTopAfterRefill: refilled.input.top,
    inputTopDeltaAfterClear: Number((cleared.input.top - before.input.top).toFixed(2)),
    inputTopDeltaDuringRefill: Number((refillPending.input.top - before.input.top).toFixed(2)),
    inputTopDeltaAfterRefill: Number((refilled.input.top - before.input.top).toFixed(2)),
    inputDocumentTopBefore: before.input.documentTop,
    inputDocumentTopAfterClear: cleared.input.documentTop,
    inputDocumentTopAfterRefill: refilled.input.documentTop,
    inputDocumentTopDeltaAfterClear: Number((cleared.input.documentTop - before.input.documentTop).toFixed(2)),
    inputDocumentTopDeltaAfterRefill: Number((refilled.input.documentTop - before.input.documentTop).toFixed(2)),
    scrollHeightBefore: before.scrollHeight,
    scrollHeightAfterClear: cleared.scrollHeight,
    scrollHeightDeltaAfterClear: cleared.scrollHeight - before.scrollHeight,
    scrollHeightDuringRefill: refillPending.scrollHeight,
    scrollHeightDeltaDuringRefill: refillPending.scrollHeight - before.scrollHeight,
    scrollHeightAfterRefill: refilled.scrollHeight,
    scrollHeightDeltaAfterRefill: refilled.scrollHeight - before.scrollHeight,
    scrollHeightNote: 'An invalid input exposes validation/status copy and may add document height; the result area must not collapse enough to clamp scrollTop, and refill must return to the same measured document height.',
    actualHeroHeightBefore: before.resultHero.height,
    actualResultTailHeightBefore: before.resultTail.height,
    emptyPlaceholderHeightAfterClear: cleared.emptyPanel.height,
    emptyPlaceholderHeightDuringRefill: refillPending.emptyPanel.height,
    tailPlaceholderHeightAfterClear: cleared.resultTailPlaceholder.height,
    tailPlaceholderHeightDuringRefill: refillPending.resultTailPlaceholder.height,
    resultAfterRefill: savedState.result.primaryDistanceMeters,
  }
}

async function runExpandedDetailsClearRefill(cdp, serverOutput, width = 320, height = 700) {
  const item = { name: `expanded-clear-refill-${width}`, scenario: 'ground', width, height, theme: 'light', view: 0 }
  await navigateCase(cdp, item, serverOutput)
  await evaluate(cdp, `(() => {
    const tab = document.querySelector('#cameraInputTabs .camera-input-tab[data-index="1"]')
    if (!tab) throw new Error('Target input tab missing')
    tab.click()
    return window.__cameraLastDispatch
  })()`)
  await evaluate(cdp, `(() => {
    const toggle = document.querySelector('#cameraDetailsToggle')
    if (!toggle) throw new Error('Calculation detail toggle missing')
    toggle.click()
    return window.__cameraLastDispatch
  })()`)
  await evaluate(cdp, `(() => {
    const input = [...document.querySelectorAll('input[data-field]')].find((node) => node.dataset.field === 'groundDepthText')
    const scroll = document.querySelector('.page-scroll')
    if (!input || !scroll) throw new Error('Ground-depth field or scroll view missing')
    input.scrollIntoView({ block: 'center' })
    input.focus({ preventScroll: true })
    return true
  })()`)
  const before = await measureField(cdp, 'groundDepthText')
  assert(before.detailsExpanded && before.resultTail?.height > 0,
    `The expanded calculation tail must be measured before clearing at ${width}px: ${JSON.stringify(before)}`)
  await setFieldThroughDomInput(cdp, 'groundDepthText', '')
  const cleared = await measureField(cdp, 'groundDepthText')
  assert(cleared.emptyVisible && !cleared.resultVisible
    && Math.abs(cleared.input.top - before.input.top) <= 2
    && Math.abs(cleared.scrollTop - before.scrollTop) <= 2
    && cleared.scrollHeight >= before.scrollHeight - 2
    && Math.abs(cleared.emptyPanel.height - before.resultHero.height) <= 3
    && Math.abs(cleared.resultTailPlaceholder.height - before.resultTail.height) <= 3,
  `Clearing while derivation is expanded must preserve its measured hero/tail and field position at ${width}px: ${JSON.stringify({ before, cleared })}`)
  const screenshot = path.join(screenshotRoot, `invalid-expanded-details-${width}-light.png`)
  await capture(cdp, screenshot)
  await setFieldThroughDomInput(cdp, 'groundDepthText', '4')
  let resultState = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(50)
    const stateJson = await evaluate(cdp, `fetch('/__state?sessionId=' + encodeURIComponent(window.__cameraFixture.sessionId), { cache: 'no-store' }).then((response) => response.json()).then((value) => JSON.stringify(value.state))`)
    resultState = JSON.parse(stateJson)
    if (resultState.result && resultState.result.depthMeters === 4) break
  }
  assert(resultState?.result?.depthMeters === 4, `Expanded-tail refill did not calculate: ${JSON.stringify(resultState?.result)}`)
  await evaluate(cdp, 'window.__cameraRefreshState()')
  const refilled = await measureField(cdp, 'groundDepthText')
  assert(Math.abs(refilled.input.top - before.input.top) <= 2
    && Math.abs(refilled.scrollTop - before.scrollTop) <= 2
    && Math.abs(refilled.scrollHeight - before.scrollHeight) <= 2,
  `Refilling the expanded-tail state should restore the field and content height at ${width}px: ${JSON.stringify({ before, cleared, refilled })}`)
  return {
    status: 'passed', width, height, before, cleared, refilled, screenshot,
    inputTopDeltaAfterClear: Number((cleared.input.top - before.input.top).toFixed(2)),
    inputTopDeltaAfterRefill: Number((refilled.input.top - before.input.top).toFixed(2)),
    scrollHeightDeltaAfterClear: cleared.scrollHeight - before.scrollHeight,
    tailHeightBefore: before.resultTail.height,
    tailPlaceholderHeightAfterClear: cleared.resultTailPlaceholder.height,
  }
}

async function main() {
  assert(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`)
  fs.mkdirSync(screenshotRoot, { recursive: true })
  const serverOutput = { stdout: '', stderr: '' }
  const server = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: { ...process.env, CAMERA_QA_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  server.stdout.on('data', (data) => { serverOutput.stdout += data.toString() })
  server.stderr.on('data', (data) => { serverOutput.stderr += data.toString() })

  const summary = {
    version: qaVersion,
    startedAt: new Date().toISOString(),
    status: 'running',
    evidenceRoot: runOutputRoot,
    parentEvidenceRoot: evidenceRoot,
    diagnostic: diagnosticMode,
    browser: 'Google Chrome headless with Chrome DevTools Protocol mobile viewport metrics',
    cases: [],
    sourceHashes: null,
    protectedCoreHashes: null,
    limitations: 'This bridge expands production camera WXML includes, expands production WXSS imports, injects production page-controller states and dispatches production handlers, then draws with the production canvas renderer. It is not WeChat DevTools compilation, the WeChat runtime, native share/photo permissions, or a physical-device test.',
  }
  let chrome
  let socket
  try {
    await waitForServer(server, serverOutput)
    const profileRoot = path.join(os.tmpdir(), 'codex-camera-refactor-2026-10-11')
    fs.mkdirSync(profileRoot, { recursive: true })
    const profile = fs.mkdtempSync(path.join(profileRoot, 'chrome-profile-'))
    chrome = spawn(chromePath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    const connection = await connectChrome(chrome)
    socket = connection.socket
    const cdp = createCdp(socket)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    for (const item of cases) {
      const report = await navigateCase(cdp, item, serverOutput)
      const screenshotPath = item.capture ? path.join(screenshotRoot, `${item.name}.png`) : null
      if (screenshotPath) await capture(cdp, screenshotPath)
      const entry = { name: item.name, status: report.status, case: item, report, screenshot: screenshotPath }
      writeFile(path.join(runOutputRoot, `${item.name}.json`), `${JSON.stringify(entry, null, 2)}\n`)
      summary.cases.push({
        name: item.name, status: report.status, screenshot: screenshotPath,
        fontMeasurements: report.fontMeasurements, checks: report.checks, failures: report.failures,
        sourceHashes: report.sourceHashes,
      })
    }
    summary.sourceHashes = summary.cases[0]?.sourceHashes || null
    const protectedHashPath = path.join(qaDir, 'baseline', 'protected-hashes.json')
    if (summary.sourceHashes && fs.existsSync(protectedHashPath)) {
      const protectedFiles = JSON.parse(fs.readFileSync(protectedHashPath, 'utf8'))
      summary.protectedCoreHashes = protectedFiles.map((item) => {
        const relative = path.relative(repoRoot, item.Path).replaceAll('\\', '/')
        const actual = summary.sourceHashes[relative]
        return { file: relative, expected: item.Hash.toLowerCase(), actual: actual || null, unchanged: Boolean(actual) && actual.toLowerCase() === item.Hash.toLowerCase() }
      })
      assert(summary.protectedCoreHashes.every((item) => item.unchanged),
        `Protected camera algorithm/data hashes changed: ${JSON.stringify(summary.protectedCoreHashes)}`)
    }

    const zoomReference = summary.cases.find((item) => item.name === 'default-ground-320-light-zoom-1')
    const zoomed = summary.cases.find((item) => item.name === 'default-ground-320-light-zoom-1_3')
    if (zoomReference && zoomed) {
      const baseHeight = zoomReference.fontMeasurements?.primaryValue?.boxHeight
      const zoomHeight = zoomed.fontMeasurements?.primaryValue?.boxHeight
      const zoomRatio = baseHeight > 0 ? Number((zoomHeight / baseHeight).toFixed(3)) : null
      assert(zoomRatio >= 1.2 && zoomRatio <= 1.4,
        `1.3x accessible text zoom did not scale the primary value box: ${JSON.stringify({ baseHeight, zoomHeight, zoomRatio })}`)
      summary.textZoom = {
        status: 'passed', ratio: zoomRatio,
        baseline: zoomReference.fontMeasurements,
        zoomed: zoomed.fontMeasurements,
        note: 'Measured actual production-WXSS font sizes and text box geometry after rpx-to-px expansion and a 1.3x font-size-only scaling in the browser bridge; viewport and component dimensions remain unchanged.',
      }
    } else {
      summary.textZoom = { status: 'not-run', reason: 'selected case subset omitted one or both 320px zoom comparison cases' }
    }

    const interactionCase = cases.find((item) => item.name === 'default-ground-plan-390-light')
    if (interactionCase) {
      const interactions = await navigateCase(cdp, interactionCase, serverOutput)
      summary.interactions = await runInteractions(cdp)
      summary.interactionSourceHash = interactions.sourceHashes
      summary.expandedSections = []
      for (const sectionCase of [
        { name: 'expanded-390-light', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0 },
        { name: 'expanded-320-light', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0 },
        { name: 'expanded-320-light-zoom-1_3', scenario: 'ground', width: 320, height: 700, theme: 'light', view: 0, zoom: 1.3 },
      ]) {
        summary.expandedSections.push(await captureExpandedSections(cdp, serverOutput, screenshotRoot, sectionCase))
      }
    } else {
      summary.interactions = { status: 'not-run', reason: 'selected case subset excluded the default interaction fixture' }
      summary.expandedSections = { status: 'not-run', reason: 'selected case subset excluded the default interaction fixture' }
    }
    if (cases.some((item) => item.name === 'default-ground-plan-390-light')) {
      summary.continuousInput = [
        await runContinuousInputStability(cdp, serverOutput, 320, 700),
        await runContinuousInputStability(cdp, serverOutput, 390, 844),
      ]
      summary.clearRefillPlaceholder = [
        await runClearRefillPlaceholder(cdp, serverOutput, 320, 700),
        await runClearRefillPlaceholder(cdp, serverOutput, 390, 844),
      ]
      summary.expandedClearRefill = await runExpandedDetailsClearRefill(cdp, serverOutput, 320, 700)
    } else {
      summary.continuousInput = { status: 'not-run', reason: 'selected case subset excluded the standard default fixture' }
      summary.clearRefillPlaceholder = { status: 'not-run', reason: 'selected case subset excluded the standard default fixture' }
      summary.expandedClearRefill = { status: 'not-run', reason: 'selected case subset excluded the standard default fixture' }
    }
    summary.finishedAt = new Date().toISOString()
    summary.status = summary.cases.every((item) => item.status === 'passed') ? 'passed' : 'failed'
    summary.serverOutput = serverOutput
    writeFile(path.join(runOutputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ status: summary.status, caseCount: summary.cases.length, screenshotCount: summary.cases.filter((item) => item.screenshot).length, summaryPath: path.join(runOutputRoot, 'summary.json'), firstScreenshot: summary.cases[0]?.screenshot, failures: summary.cases.flatMap((item) => item.failures || []) }, null, 2)}\n`)
    if (summary.status !== 'passed') process.exitCode = 1
  } catch (error) {
    summary.finishedAt = new Date().toISOString()
    summary.status = /STOP_MARKER/.test(String(error)) ? 'stopped-by-policy-marker' : 'error'
    summary.error = String(error && error.stack || error)
    summary.serverOutput = serverOutput
    writeFile(path.join(runOutputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    process.stderr.write(`${summary.error}\n`)
    process.exitCode = /STOP_MARKER/.test(String(error)) ? 2 : 1
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close()
    if (chrome && chrome.exitCode === null) chrome.kill()
    if (server && server.exitCode === null) server.kill()
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error && error.stack || error)}\n`)
  process.exitCode = 1
})

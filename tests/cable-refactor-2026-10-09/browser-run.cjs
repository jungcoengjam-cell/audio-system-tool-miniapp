const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const evidenceRoot = path.join(process.env.CABLE_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-10-10/tunebuddy-cable-revision-010048', 'browser-qa')
const screenshotRoot = path.join(evidenceRoot, 'screenshots')
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const qaPort = Number(process.env.CABLE_QA_PORT) || 8123
const baseUrl = `http://127.0.0.1:${qaPort}/tests/cable-refactor-2026-10-09/browser.html`
const allCases = [
  { name: 'valid-light', state: 'valid', theme: 'light', width: 390, height: 844 },
  { name: 'valid-390x753', state: 'valid', theme: 'light', width: 390, height: 753 },
  { name: 'preference-error-reset', state: 'preference-save-error-reset', theme: 'light', width: 320, height: 400 },
  { name: 'preference-error-write', state: 'preference-save-error-write', theme: 'dark', width: 320, height: 400 },
  { name: 'professional-375x677', state: 'professional', theme: 'dark', width: 375, height: 677 },
  { name: 'review-390x753', state: 'review', theme: 'light', width: 390, height: 753 },
  { name: 'review-375x677', state: 'review', theme: 'dark', width: 375, height: 677, captureResultBottom: true },
  { name: 'review-dark', state: 'review', theme: 'dark', width: 430, height: 932 },
  { name: 'blank-narrow', state: 'blank', theme: 'light', width: 320, height: 780 },
  { name: 'error-short', state: 'error', theme: 'light', width: 375, height: 620, captureEditorBottom: true },
  { name: 'longtext-short', state: 'longtext', theme: 'light', width: 360, height: 600 },
  { name: 'short-320x400-light', state: 'valid', theme: 'light', width: 320, height: 400, captureEditorBottom: true, captureResultBottom: true },
  { name: 'mode-constant-390-dark', state: 'valid', theme: 'dark', width: 390, height: 844 },
  { name: 'mode-constant-320-dark', state: 'valid', theme: 'dark', width: 320, height: 400, captureEditorBottom: true },
  { name: 'mode-professional-390-light', state: 'professional', theme: 'light', width: 390, height: 844 },
  { name: 'mode-professional-390-dark', state: 'professional', theme: 'dark', width: 390, height: 844 },
  { name: 'mode-professional-320-light', state: 'professional', theme: 'light', width: 320, height: 400, captureEditorBottom: true },
  { name: 'mode-professional-320-dark', state: 'professional', theme: 'dark', width: 320, height: 400, captureEditorBottom: true },
  { name: 'short-320x480-dark', state: 'valid', theme: 'dark', width: 320, height: 480, captureEditorBottom: true, captureResultBottom: true },
  { name: 'short-375x568-professional-long', state: 'professional-longtext', theme: 'dark', width: 375, height: 568, captureEditorBottom: true },
  { name: 'reset-draft-actions', state: 'reset-draft', theme: 'light', width: 390, height: 844 },
  { name: 'project-list', state: 'project', theme: 'light', width: 390, height: 844, captureProjectListBottom: true },
  { name: 'project-list-short-320x400', state: 'project', theme: 'light', width: 320, height: 400, captureProjectListBottom: true },
  { name: 'project-empty', state: 'project-empty', theme: 'light', width: 390, height: 844 },
  { name: 'project-read-error', state: 'project-error', theme: 'dark', width: 390, height: 844 },
  { name: 'project-confirm-short', state: 'project-confirm', theme: 'light', width: 360, height: 640, captureProjectConfirmBottom: true },
  { name: 'project-confirm-320x400', state: 'project-confirm', theme: 'dark', width: 320, height: 400, captureProjectConfirmBottom: true },
  { name: 'project-save-error', state: 'project-save-error', theme: 'light', width: 390, height: 844 },
  { name: 'project-save-blocked', state: 'project-save-blocked', theme: 'dark', width: 390, height: 844 },
  { name: 'project-success', state: 'project-success', theme: 'light', width: 390, height: 844 },
  { name: 'project-keyboard', state: 'project-keyboard', theme: 'light', width: 390, height: 640 },
  { name: 'project-create-keyboard-320x400', state: 'project-keyboard', theme: 'light', width: 320, height: 400 },
  { name: 'project-search-keyboard-320x400', state: 'project-list-keyboard', theme: 'dark', width: 320, height: 400, captureProjectListBottom: true },
  { name: 'project-config-name-keyboard-320x400', state: 'project-config-name-keyboard', theme: 'light', width: 320, height: 400 },
  { name: 'project-config-note-keyboard-320x400', state: 'project-config-note-keyboard', theme: 'dark', width: 320, height: 400 },
  { name: 'share-failed-state', state: 'share-failed', theme: 'light', width: 390, height: 844 },
  { name: 'share-constant', state: 'share', reportCase: 'constant', theme: 'light', width: 390, height: 844 },
  { name: 'share-professional-short', state: 'share', reportCase: 'professional', theme: 'dark', width: 320, height: 480 },
  { name: 'share-review-long-short', state: 'share', reportCase: 'review', theme: 'light', width: 320, height: 400 },
  { name: 'share-viewer-review-320x400', state: 'share-viewer', reportCase: 'review', theme: 'dark', width: 320, height: 400, captureViewerBottomRight: true },
  { name: 'share-query-fallback-320x320', state: 'share', reportCase: 'constant', theme: 'dark', width: 320, height: 320, simulatePreviewMeasurementFailure: true },
]
const selectedCaseNames = process.env.CABLE_QA_CASES
  ? process.env.CABLE_QA_CASES.split(',').map((name) => name.trim()).filter(Boolean)
  : null
const cases = selectedCaseNames ? allCases.filter((item) => selectedCaseNames.includes(item.name)) : allCases
assert(cases.length > 0, `No browser QA cases matched: ${selectedCaseNames?.join(', ') || ''}`)
const modeLayoutCases = new Set([
  'valid-light', 'short-320x400-light', 'error-short', 'mode-constant-390-dark', 'mode-constant-320-dark',
  'mode-professional-390-light', 'mode-professional-390-dark',
  'mode-professional-320-light', 'mode-professional-320-dark',
])

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function assertNear(actual, expected, tolerance, message) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}±${tolerance}px, got ${actual}px`)
}

function assertRpxConversion(measurement, item) {
  const conversion = measurement.wxssConversion
  const scale = item.width / 750
  assert.equal(conversion.enabled, true, `${item.name}: production WXSS rpx conversion must be enabled`)
  assert.equal(conversion.viewportWidth, item.width, `${item.name}: converter must use current viewport width`)
  assertNear(conversion.rpxScale, scale, 0.000001, `${item.name}: rpx scale must equal innerWidth/750`)
  assert.equal(conversion.convertedStylesheetCount, 2, `${item.name}: app and cable WXSS must both be installed`)
  assert.equal(conversion.remainingProductionStylesheetLinks, 0,
    `${item.name}: raw production WXSS links must be replaced by converted styles`)
  assert.equal(conversion.remainingRawRpxTokens, 0,
    `${item.name}: converted production CSS must not retain numeric rpx declarations`)
  assert.equal(conversion.recursiveImportsExpanded, true, `${item.name}: WXSS imports must be expanded`)
  assert.equal(conversion.inlineStylesConverted, true, `${item.name}: WXML inline style values must be converted`)
  assert(conversion.loadedSourcePaths.includes('/app.wxss')
    && conversion.loadedSourcePaths.includes('/pages/cable/cable.wxss')
    && conversion.loadedSourcePaths.includes('/styles/theme-page-shared.wxss'),
  `${item.name}: bridge must load app, cable, and imported theme WXSS`)

  const probe = conversion.probe.output
  const px = (value) => `${Number((value * scale).toFixed(5))}px`
  assert(probe.includes(`margin-left:${px(-22)}`), `${item.name}: negative ordinary rpx values must convert`)
  assert(probe.includes(`calc(${px(-22)} + ${px(1)} + env(safe-area-inset-bottom))`),
    `${item.name}: calc values must convert while preserving env()`)
  assert(probe.includes(`border-radius:${px(15)}`), `${item.name}: ordinary positive rpx values must convert`)
  assert(probe.includes(`calc(100% - ${px(8)})`), `${item.name}: percentage calc terms must be preserved`)
  assert(probe.includes('height:52px;opacity:50%;'), `${item.name}: px and percentage values must remain unchanged`)
  assert(probe.includes('url("data:image/svg+xml,%3Csvg%20width%3D%22100rpx%22%3E")'),
    `${item.name}: SVG data URLs must not be rewritten`)
  assert.equal(measurement.inlineStyleConversion.passed, true,
    `${item.name}: WXML style attributes must pass through the same viewport converter`)
  assert.equal(measurement.inlineStyleConversion.viewportWidth, item.width,
    `${item.name}: inline style conversion must use current viewport width`)
  const expectedInline = conversion.probe.output.match(/^\.[^{]+\{([\s\S]*)\}$/)?.[1]
  assert.equal(measurement.inlineStyleConversion.output, expectedInline,
    `${item.name}: inline conversion must preserve calc, env(), px, %, and SVG data URL values`)
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function cdpSocket(child) {
  let stderr = ''
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out: ' + stderr)), 10000)
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => {
      if (!stderr.includes('DevTools listening on ')) {
        clearTimeout(timer)
        reject(new Error('Chrome exited before CDP startup (' + code + ' / ' + signal + '): ' + stderr))
      }
    })
  })
  const endpointUrl = new URL(endpoint)
  const response = await fetch('http://' + endpointUrl.host + '/json/new?about:blank', { method: 'PUT' })
  assert(response.ok, 'Chrome /json/new failed: ' + response.status)
  const target = await response.json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return { socket, port: Number(endpointUrl.port), endpoint }
}

function createCdp(socket) {
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const handlers = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) handlers.reject(new Error(message.error.message))
    else handlers.resolve(message.result || {})
  })
  return {
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`CDP call timed out: ${method}`))
        }, 15000)
      })
    },
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed')
  return result.result?.value
}

function assertResultLayout(measurement, name) {
  assert(measurement.resultCard.height >= 216,
    `${name}: result card must keep enough height for the four-button rail`)
  assert(measurement.pageScroll, `${name}: full-page scroll container is missing`)
  for (const [index, button] of measurement.actionButtons.entries()) {
    assert(Math.abs(button.width - 44) <= 1 && Math.abs(button.height - 44) <= 1,
      `${name}: action button ${index + 1} is not a 44px square`)
  }
  assert(measurement.actionRail.right <= measurement.resultCard.right + 1,
    `${name}: action rail exceeds the result card`)
  assert(measurement.actionRail.y >= measurement.resultCard.y + 10
    && measurement.actionRail.bottom <= measurement.resultCard.bottom - 10,
  `${name}: action rail must stay inside the result card with breathing room`)
  for (const [label, box] of [['primary result', measurement.resultPrimary], ['secondary result', measurement.secondaryCard]]) {
    if (!box) continue
    if (label === 'secondary result' && measurement.viewport.width <= 340) {
      assert(box.y >= measurement.actionRail.bottom + 7,
        `${name}: narrow secondary result must sit below the action rail with breathing room`)
      assert(box.width >= measurement.resultCard.width - 36,
        `${name}: narrow secondary result must use the opened width below the rail`)
      // The requested 6px top/bottom increase adds 12px; preserve the previous text-wrap headroom.
      assert(box.height <= 96,
        `${name}: narrow secondary values and labels must avoid extra wrapping`)
      assert(measurement.secondaryValues.every((value) => value.height <= 28),
        `${name}: narrow secondary values must fit on a single line`)
    } else {
      const gap = measurement.actionRail.x - box.right
      assert(gap >= 2 && gap <= 16,
        `${name}: ${label} must leave a small clear gap before the action rail (got ${gap}px)`)
    }
    assert(Math.abs(box.centerX - measurement.resultCard.centerX) <= 1.5,
      `${name}: ${label} must stay centered on the result card`)
  }
  assert.equal(measurement.pageScroll.lastInputReachable, true,
    `${name}: the last input group must remain reachable by the full-page scroll`)
  if (measurement.controller.result) {
    const delta = Math.abs(measurement.resultCard.centerX - measurement.resultSpec.centerX)
    assert(delta <= 1.5, `${name}: result content center drifted ${delta}px from the full card axis`)
    assert(measurement.secondaryCard, `${name}: secondary result card is missing`)
    assert(measurement.secondaryValues.length >= 2, `${name}: secondary result values are incomplete`)
    assert.equal(measurement.pageScroll.lastResultDetailReachable, true,
      `${name}: the last result detail must remain reachable by the full-page scroll`)
  }
}

function assertModeTabLayout(measurement, name) {
  const layout = measurement.modeTabLayout
  assert(layout && layout.container && layout.card && layout.tabs.length === 2,
    name + ': the shared input card, both mode tabs, and the active settings fields must render')
  assert.equal(measurement.editorHeading.text, '线路条件', name + ': the editor heading must remain visible')
  assert.equal(layout.tabsParentIsContainer, true, name + ': the mode selector must sit inside the shared input card')
  assert.equal(layout.fieldsParentIsContainer, true, name + ': the fields must sit inside the same input card')
  assert.equal(layout.editorFieldsClass, 'editor-fields', name + ': mode-specific layout hooks must not split the input surface')
  const container = layout.container
  assert.equal(container.borderTopWidth, '1px', name + ': the shared input card must have one visible outer border')
  assert.equal(container.borderTopLeftRadius, '18px', name + ': the shared input card must keep its rounded outer corners')
  assert.notEqual(container.backgroundColor, 'rgba(0, 0, 0, 0)', name + ': the shared input card must provide one continuous surface')
  const narrow = measurement.viewport.width <= 340
  assert.equal(container.paddingLeft, narrow ? '9px' : '14px', name + ': outer card padding must preserve the field width')
  assert.equal(container.paddingRight, narrow ? '9px' : '14px', name + ': outer card padding must stay symmetric')
  const wrapper = layout.wrapperComputed
  assert.notEqual(wrapper.backgroundColor, 'rgba(0, 0, 0, 0)', name + ': the tab selector must sit on its inset control surface')
  assert.equal(wrapper.gap, '3px', name + ': both tabs must share a compact inset')
  assert.equal(wrapper.borderTopLeftRadius, '14px', name + ': the inset selector must have a soft control shape')
  for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
    assert.equal(wrapper[key], '3px', name + ': the inset selector must keep even inner spacing')
  }
  assert(layout.wrapper.x > container.box.x && layout.wrapper.right < container.box.right,
    name + ': the selector must remain inside the outer card padding')
  assert(layout.card.box.x >= container.box.x && layout.card.box.right <= container.box.right,
    name + ': the input fields must remain within the outer card')
  assert.equal(layout.card.backgroundColor, 'rgba(0, 0, 0, 0)', name + ': the fields must not draw a second card surface')
  assert.equal(layout.card.borderTopWidth, '0px', name + ': the fields must not add an inner border')
  assert.equal(layout.card.paddingTop, '0px', name + ': the fields must not add inner vertical padding')
  assert.equal(layout.card.paddingLeft, '0px', name + ': the fields must not add inner horizontal padding')
  assert.equal(layout.card.borderTopLeftRadius, '0px', name + ': the fields must not round a second inner card')
  assert.equal(layout.card.boxShadow, 'none', name + ': the fields must not cast a second card shadow')
  const selected = layout.tabs[measurement.controller.modeIndex]
  const inactive = layout.tabs[1 - measurement.controller.modeIndex]
  assert.equal(selected.active, true, name + ': the controller-selected mode must remain highlighted')
  assert.equal(inactive.active, false)
  assert.equal(selected.computed.backgroundColor, container.backgroundColor, name + ': selected mode must read as active on the shared surface')
  assert.equal(inactive.computed.backgroundColor, 'rgba(0, 0, 0, 0)', name + ': inactive mode must stay visually quiet')
  assert.notEqual(selected.computed.boxShadow, 'none', name + ': selected mode must remain distinct without a connecting seam')
  assert.equal(selected.computed.borderWidth, '0px', name + ': mode tabs must not add their own outline')
  assert(parseFloat(selected.computed.minHeight) >= 44 && parseFloat(inactive.computed.minHeight) >= 44,
    name + ': both mode tabs must retain usable hit targets')
  assertNear(layout.tabs[0].box.y, layout.tabs[1].box.y, 0.5, name + ': mode tabs must share one row')
  assertNear(layout.tabs[0].box.width, layout.tabs[1].box.width, 0.5, name + ': mode tabs must have equal width')
  assertNear(layout.tabs[0].box.height, layout.tabs[1].box.height, 0.5, name + ': mode tabs must have equal height')
  const tabGap = layout.tabs[1].box.x - layout.tabs[0].box.right
  assert(tabGap >= 2 && tabGap <= 4, name + ': mode tabs must keep a narrow clear inset')
  assertNear(layout.card.box.y - layout.wrapper.bottom, 12, 1, name + ': the fields must follow the selector inside the shared card')
  assert.equal(layout.tabs[0].computed.minHeight, layout.tabs[1].computed.minHeight,
    name + ': switching modes must not resize the selector')
}
async function runMotionCssProbe(cdp, manifest) {
  const captures = []
  const setViewport = async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844,
    })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  }
  const navigate = async (state, caseName, reportCase = 'constant', reducedMotion = false, capturePreviewLayout = false) => {
    await setViewport()
    await cdp.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
    ] })
    const url = new URL(baseUrl)
    url.searchParams.set('state', state)
    url.searchParams.set('theme', 'light')
    url.searchParams.set('toolbar', '0')
    url.searchParams.set('capture', capturePreviewLayout ? '1' : '0')
    url.searchParams.set('caseName', caseName)
    url.searchParams.set('reportCase', reportCase)
    await cdp.send('Page.navigate', { url: url.href })
    let ready = false
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const status = await evaluate(cdp, 'document.documentElement.dataset.ready || document.documentElement.dataset.error || ""')
      if (status === 'true') { ready = true; break }
      if (status && status !== 'true') throw new Error(caseName + ': motion probe page error: ' + status)
      await delay(100)
    }
    assert(ready, caseName + ': motion probe page did not render')
  }
  const sample = async (selector, sheetSelector) => evaluate(cdp,
    '(() => { const overlay = document.querySelector(' + JSON.stringify(selector) + ');'
      + ' const sheet = document.querySelector(' + JSON.stringify(sheetSelector) + ');'
      + ' if (!overlay || !sheet) throw new Error("motion probe node missing");'
      + ' const overlayRect = overlay.getBoundingClientRect(); const sheetRect = sheet.getBoundingClientRect();'
      + ' const overlayStyle = getComputedStyle(overlay); const sheetStyle = getComputedStyle(sheet);'
      + ' const matrix = (value) => value === "none" ? null : new DOMMatrixReadOnly(value);'
      + ' const overlayMatrix = matrix(overlayStyle.transform); const sheetMatrix = matrix(sheetStyle.transform);'
      + ' return { overlayAnimation: overlayStyle.animationName, sheetAnimation: sheetStyle.animationName,'
      + ' overlayOpacity: Number(overlayStyle.opacity), sheetOpacity: Number(sheetStyle.opacity),'
      + ' overlayTransform: overlayStyle.transform, sheetTransform: sheetStyle.transform,'
      + ' overlayY: overlayMatrix ? overlayMatrix.m42 : 0, sheetY: sheetMatrix ? sheetMatrix.m42 : 0,'
      + ' sheetHeight: sheetRect.height, overlayHeight: overlayRect.height,'
      + ' overlayPaddingBottom: Number.parseFloat(overlayStyle.paddingBottom) || 0,'
      + ' overlayPointerEvents: overlayStyle.pointerEvents, sheetPointerEvents: sheetStyle.pointerEvents }; })()')
  const screenshot = async (name) => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    fs.writeFileSync(path.join(screenshotRoot, name), Buffer.from(result.data, 'base64'))
    return name
  }
  const assertStaticMask = (value, label) => {
    assert.equal(value.overlayAnimation, 'none', label + ': backdrop must not animate')
    assert.equal(value.overlayOpacity, 1, label + ': backdrop opacity must stay fully visible')
    assert(Math.abs(value.overlayY) < 0.5, label + ': backdrop must stay fixed')
    assert.equal(value.sheetOpacity, 1, label + ': sheet must not fade')
  }
  const assertSheetMoving = (value, label) => {
    const maxDistance = value.sheetHeight + value.overlayPaddingBottom + 2
    assert(value.sheetY > 0.5 && value.sheetY < maxDistance,
      label + ': sheet must be between its resting position and below the padded viewport, got '
        + value.sheetY + 'px (height=' + value.sheetHeight + ', bottom padding=' + value.overlayPaddingBottom + ')')
  }

  await navigate('project', 'motion-project-css-probe')
  await evaluate(cdp, '(() => { const node = document.querySelector(".cable-project-overlay"); if (!node) throw new Error("project overlay missing"); node.replaceWith(node.cloneNode(true)); return true })()')
  await delay(80)
  const projectEntry = await sample('.cable-project-overlay', '.project-sheet')
  assertStaticMask(projectEntry, 'project entry')
  assert.equal(projectEntry.sheetAnimation, 'cable-project-sheet-in')
  assertSheetMoving(projectEntry, 'project entry')
  const projectEntryShot = await screenshot('motion-project-entry-390x844.png')
  captures.push({ name: 'project-entry', frameAfterMs: 80, sample: projectEntry, screenshot: projectEntryShot })

  await delay(300)
  await evaluate(cdp, 'document.querySelector(".cable-project-overlay").classList.add("project-dialog-closing")')
  await delay(80)
  const projectExit = await sample('.cable-project-overlay', '.project-sheet')
  assertStaticMask(projectExit, 'project exit')
  assert.equal(projectExit.sheetAnimation, 'cable-project-sheet-out')
  assertSheetMoving(projectExit, 'project exit')
  assert.equal(projectExit.overlayPointerEvents, 'auto', 'closing overlay must continue intercepting taps')
  assert.equal(projectExit.sheetPointerEvents, 'none', 'closing sheet content must stop accepting taps')
  const projectExitShot = await screenshot('motion-project-exit-390x844.png')
  captures.push({ name: 'project-exit', frameAfterMs: 80, sample: projectExit, screenshot: projectExitShot })

  await delay(300)
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ] })
  await evaluate(cdp, 'document.querySelector(".cable-project-overlay").classList.remove("project-dialog-closing")')
  await delay(20)
  await evaluate(cdp, 'document.querySelector(".cable-project-overlay").classList.add("project-dialog-closing")')
  await delay(20)
  const reducedExit = await sample('.cable-project-overlay', '.project-sheet')
  assertStaticMask(reducedExit, 'reduced-motion project close')
  assert.equal(reducedExit.sheetAnimation, 'none')
  assert(reducedExit.sheetY >= reducedExit.sheetHeight - 1,
    'reduced motion must place the project sheet below the viewport immediately')
  const reducedShot = await screenshot('motion-project-reduced-exit-390x844.png')
  captures.push({ name: 'project-reduced-motion-exit', frameAfterMs: 20, sample: reducedExit, screenshot: reducedShot })

  await navigate('share', 'motion-share-css-probe', 'constant', false, true)
  await evaluate(cdp, '(() => { const node = document.querySelector(".result-report-preview-overlay"); if (!node) throw new Error("share overlay missing"); node.replaceWith(node.cloneNode(true)); return true })()')
  await delay(80)
  const shareEntry = await sample('.result-report-preview-overlay', '.result-report-preview-sheet')
  assertStaticMask(shareEntry, 'share entry')
  assert.equal(shareEntry.sheetAnimation, 'cable-report-sheet-in')
  assertSheetMoving(shareEntry, 'share entry')

  const layout = await evaluate(cdp,
    'window.__cableQaApplyProductionPreviewLayout(window.__cableQaState)')
  assert.equal(layout?.methodCalled, true, 'mid-motion bridge must call the loaded production preview layout method')
  assert.equal(layout?.methodResult, true, 'mid-motion production method must accept actual rendered element measurements')
  assert.equal(layout.canvas.width, 750, 'mid-motion layout must use the production report width')
  assert.equal(layout.selectorQueryTrace.length, 7, 'mid-motion layout must query each real preview element')
  assert.deepEqual(layout.selectorQueryTrace.map((entry) => entry.selector), [
    '.page-root',
    '.result-report-preview-overlay',
    '.result-report-preview-sheet',
    '.result-report-preview-header',
    '.result-report-preview-actions',
    '.result-report-preview-scroll',
    '.result-report-preview-image',
  ])
  assert(layout.resultReportPreviewStyle.includes('--cable-report-scroll-height:'),
    'mid-motion production method must apply its measured scroll height')
  const measuredImage = layout.observedSelectors['.result-report-preview-image']
  const measuredScroll = layout.observedSelectors['.result-report-preview-scroll']
  const scrollBorders = parseFloat(measuredScroll.computedStyle.borderTopWidth)
    + parseFloat(measuredScroll.computedStyle.borderBottomWidth)
  const naturalImageHeight = layout.canvas.height * measuredImage.rect.width / 750
  const targetScrollHeight = Number(layout.resultReportPreviewStyle.match(/--cable-report-scroll-height:([0-9.]+)px/)?.[1])
  assert(Number.isFinite(targetScrollHeight) && targetScrollHeight > 0,
    'mid-motion production method must return a finite nonzero scroll viewport')
  assert(targetScrollHeight <= naturalImageHeight + scrollBorders + 2,
    'mid-motion sheet translation must not inflate the natural report image height')
  const appliedPreview = await evaluate(cdp,
    '(() => { const scroll = document.querySelector(".result-report-preview-scroll");'
      + ' const image = document.querySelector(".result-report-preview-image");'
      + ' const style = getComputedStyle(scroll); const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);'
      + ' return { scrollClientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight, borders,'
      + ' imageHeight: image.getBoundingClientRect().height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }; })()')
  assert.equal(appliedPreview.naturalWidth, 750, 'mid-motion preview must keep the actual generated 750px PNG')
  const imageContentGap = appliedPreview.scrollClientHeight - appliedPreview.imageHeight
  if (targetScrollHeight >= naturalImageHeight + scrollBorders - 1) {
    assert(imageContentGap >= -1 && imageContentGap < 2,
      'mid-motion production layout must keep a natural-height report free of a gray tail (' + imageContentGap + 'px)')
  } else {
    assert(appliedPreview.scrollHeight > appliedPreview.scrollClientHeight,
      'viewport-capped report must remain scrollable to its natural image end')
  }
  const shareEntryAfterLayout = await sample('.result-report-preview-overlay', '.result-report-preview-sheet')
  assertStaticMask(shareEntryAfterLayout, 'share entry after production measurement')
  assertSheetMoving(shareEntryAfterLayout, 'share entry after production measurement')
  const shareEntryShot = await screenshot('motion-share-entry-390x844.png')
  captures.push({
    name: 'share-entry', frameAfterMs: 80, sample: shareEntryAfterLayout, screenshot: shareEntryShot,
    productionLayout: {
      methodCalled: layout.methodCalled,
      methodResult: layout.methodResult,
      canvas: layout.canvas,
      naturalImageHeight,
      targetScrollHeight,
      imageContentGap,
      selectorQueryTrace: layout.selectorQueryTrace,
    },
  })

  await delay(230)
  await evaluate(cdp, 'document.querySelector(".page-root").classList.add("result-report-preview-closing")')
  await delay(80)
  const shareExit = await sample('.result-report-preview-overlay', '.result-report-preview-sheet')
  assertStaticMask(shareExit, 'share exit')
  assert.equal(shareExit.sheetAnimation, 'cable-report-sheet-out')
  assertSheetMoving(shareExit, 'share exit')
  assert.equal(shareExit.sheetPointerEvents, 'none', 'closing share sheet must stop accepting taps')
  const shareExitShot = await screenshot('motion-share-exit-390x844.png')
  captures.push({ name: 'share-exit', frameAfterMs: 80, sample: shareExit, screenshot: shareExitShot })

  manifest.motionProbe = {
    source: 'Chromium rendered production cable WXML/WXSS. Entrance is replayed by remounting the rendered overlay; closing classes are toggled to sample the 320ms CSS sheet translation.',
    methodLimit: 'This CSS probe does not emulate native WXML tap dispatch. The real production preview layout method receives browser-measured selectors through the QA bridge; controller close methods and timer races are covered separately by the fake-timer regression.',
    reducedMotion: 'prefers-reduced-motion: reduce disables animation, keeps mask and sheet opacity at 1, and moves a closing sheet immediately below the viewport.',
    captures,
  }
}

async function main() {
  assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath}`)
  fs.mkdirSync(screenshotRoot, { recursive: true })
  const health = await fetch(`http://127.0.0.1:${qaPort}/__state?state=valid`).then((response) => response.json())
  assert(health.result && health.canUseResultActions, 'controller-backed browser bridge is not ready')

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tunebuddy-cable-browser-'))
  const child = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let socket
  let chromeDebugPort = null
  const manifest = {
    browser: 'Google Chrome headless via Chrome DevTools Protocol',
    bridge: 'Actual cable WXML/WXSS loaded over localhost; state is produced by current pages/cable/cable.js controller and unmodified cable calculation utility.',
    limits: 'Browser-only HTML/WXML bridge. It does not compile WXML with WeChat tools or represent native mini-program rendering. Keyboard is modeled through the actual controller callback and viewport offset. Native WXML event dispatch, touch routing, and the system image viewer are not emulated; the page-local viewer is rendered from production WXML/WXSS with the production Canvas2D PNG, and its two-axis scroll geometry is checked.',
    captures: [],
  }

  try {
    const chromeConnection = await cdpSocket(child)
    socket = chromeConnection.socket
    chromeDebugPort = chromeConnection.port
    manifest.chromeDebugPort = chromeDebugPort
    manifest.chromeEndpoint = chromeConnection.endpoint
    const cdp = createCdp(socket)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    for (const item of cases) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: item.width,
        height: item.height,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: item.width,
        screenHeight: item.height,
      })
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: item.theme }],
      })
      const url = new URL(baseUrl)
      url.searchParams.set('state', item.state)
      url.searchParams.set('theme', item.theme)
      url.searchParams.set('toolbar', '0')
      url.searchParams.set('capture', '1')
      url.searchParams.set('caseName', item.name)
      if (item.reportCase) url.searchParams.set('reportCase', item.reportCase)
      if (item.simulatePreviewMeasurementFailure) url.searchParams.set('simulatePreviewMeasureFailure', '1')
      if (item.state === 'project-keyboard' || item.state === 'project-list-keyboard') {
        url.searchParams.set('keyboardViewport', String(item.height))
      }
      await cdp.send('Page.navigate', { url: url.href })

      let ready = false
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const status = await evaluate(cdp, 'document.documentElement.dataset.ready || document.documentElement.dataset.error || ""')
        if (status === 'true') { ready = true; break }
        if (status && status !== 'true') throw new Error(`${item.name}: browser bridge error: ${status}`)
        await delay(100)
      }
      assert(ready, `${item.name}: browser page did not finish rendering`)
      await delay(350)
      const bridge = await evaluate(cdp, 'JSON.stringify(window.__cableQa || null)')
      assert(bridge, `${item.name}: geometry bridge did not return measurements`)
      const bridgeResult = JSON.parse(bridge)
      assert.equal(bridgeResult.saved, true, `${item.name}: geometry evidence must be saved by the QA server`)
      const measurement = bridgeResult.measurements
      if (modeLayoutCases.has(item.name)) assertModeTabLayout(measurement, item.name)
      const capturePreviewBottom = ['share', 'share-viewer'].includes(item.state)
        && measurement.reportImage.height > measurement.reportPreviewScroll.clientHeight + 1
      assert.equal(measurement.viewport.width, item.width, `${item.name}: emulated CSS width mismatch`)
      assert.equal(measurement.viewport.height, item.height, `${item.name}: emulated CSS height mismatch`)
      assertRpxConversion(measurement, item)
      assert.deepEqual(measurement.loadedSourceHashes, measurement.currentProductionSourceHashes,
        `${item.name}: loaded controller graph must match the current production sources`)
      if (['valid-light', 'valid-390x753', 'professional-375x677', 'short-320x400-light'].includes(item.name)) {
        assert.equal(measurement.pageHeader, null, 'normal page header must be removed')
        assert.equal(measurement.preferenceSaveNotice, null, 'absent save notice must have no placeholder')
        assert(!measurement.pageVisibleText.includes('线材选型')
          && !measurement.pageVisibleText.includes('按输入条件实时更新')
          && !measurement.pageVisibleText.includes('输入后自动计算'),
        'removed page and editor copy must not render')
        assert(measurement.pageScroll.box.y <= measurement.pageRoot.y + 8,
          'page scroller must start without a blank header gap')
      }
      if (item.state === 'preference-save-error-reset' || item.state === 'preference-save-error-write') {
        const isReset = item.state === 'preference-save-error-reset'
        assert.equal(measurement.preferenceSaveNoticeEvent, 'retryPreferenceWrite',
          'original preference retry action must remain bound')
        assert(measurement.preferenceSaveNotice && measurement.preferenceSaveNotice.height >= 44,
          'preference retry notice must keep at least a 44px tap area')
        assert.equal(measurement.preferenceSaveNoticeComputed.fontSize, '14px',
          'preference retry notice must use 14px text')
        assert.equal(measurement.preferenceSaveNoticeComputed.minHeight, '44px',
          'preference retry notice must declare a 44px minimum tap area')
        assert(measurement.preferenceSaveNoticeText.includes(isReset ? '点此重试重置' : '点此重试')
          && measurement.pageScroll.box.y >= measurement.preferenceSaveNotice.bottom - 1,
        'correct retry copy must appear before the page scroller')
      }
      if (measurement.controller.projectDialogVisible) {
        const scale = item.width / 750
        assertNear(parseFloat(measurement.projectSheetComputed.paddingLeft), 22 * scale, 0.08,
          `${item.name}: computed project sheet horizontal padding must be 22rpx`)
        assertNear(parseFloat(measurement.projectSheetComputed.borderRadius), 28 * scale, 0.08,
          `${item.name}: computed project sheet radius must be 28rpx`)
        assertNear(parseFloat(measurement.projectSheetComputed.borderWidth), Math.max(1, 1 * scale), 0.08,
          `${item.name}: computed project sheet border must retain its 1rpx declaration at deviceScaleFactor=1`)
        assertNear(parseFloat(measurement.projectFooterComputed.gap), 10 * scale, 0.08,
          `${item.name}: computed project footer gap must be 10rpx`)
        assertNear(parseFloat(measurement.projectButtonComputed.borderRadius), 15 * scale, 0.08,
          `${item.name}: computed project button radius must be 15rpx`)
        if (measurement.controller.projectKeyboardOpen && item.height <= 420) {
          assert.equal(measurement.projectTitle.box.height, 0,
            `${item.name}: compact keyboard fallback must hide the header`)
        } else {
          assert(Math.abs(measurement.projectClose.width - 44) <= 1
            && Math.abs(measurement.projectClose.height - 44) <= 1,
          `${item.name}: project close control must remain 44x44`)
        }
        assert.equal(measurement.projectTitle.fontSize, '20px', `${item.name}: project title must remain 20px`)
        if (measurement.controller.projectDialogStep === 'select') {
          assert.equal(measurement.projectSelectSheet, true, 'select step must use its UI modifier')
          assert.equal(measurement.projectCloseEvent, 'closeProjectDialog', 'select close must retain its handler')
          assert(Math.abs(measurement.projectClose.width - 44) <= 1
            && Math.abs(measurement.projectClose.height - 44) <= 1,
          'project select close must remain a 44x44 control')
          assert(measurement.projectClose.x >= measurement.projectSheet.x - 1
            && measurement.projectClose.right <= measurement.projectSheet.right + 1
            && measurement.projectClose.bottom <= measurement.projectOverlay.bottom + 1,
          'project select close must stay reachable inside the visible sheet')
          assert.equal(measurement.projectButtons.length, 1,
            'select footer must contain only its primary action')
          const selectAction = measurement.projectButtons[0]
          assert(!selectAction.text.includes('取消'), 'select footer cancel action must be removed')
          assertNear(selectAction.box.x, measurement.projectFooter.x, 1,
            'select primary action must align to the footer start')
          assertNear(selectAction.box.width, measurement.projectFooter.width, 1,
            'sole select primary action must span the full footer')
          assert.equal(selectAction.event, item.state === 'project-error' ? 'retryProjectRead' : 'openProjectCreateForm',
            'select primary action must preserve its existing handler')
          if (measurement.controller.projectKeyboardOpen && item.height <= 420) {
            assert.equal(measurement.projectHeaderCopy.height, 0,
              'compact select header copy must not consume a row')
            for (const [area, overlapsClose] of Object.entries(measurement.projectSelectCloseClearance)) {
              if (overlapsClose !== null) assert.equal(overlapsClose, false,
                'close control must not overlap the search, list, or final scrolled row: ' + area)
            }
          }
        }
        for (const field of measurement.projectFields) {
          assert.equal(field.fontSize, '16px', `${item.name}: ${field.id || 'project field'} must remain 16px`)
          if (field.id === 'projectConfigNote') {
            assert([72, 84].includes(Math.round(field.box.height)), `${item.name}: note height must be 84px or keyboard fallback 72px`)
          } else assert(Math.abs(field.box.height - 52) <= 1, `${item.name}: ${field.id} must remain 52px`)
        }
        for (const button of measurement.projectButtons) {
          assert.equal(button.fontSize, '16px', `${item.name}: project action text must remain 16px`)
          assert(button.box.height >= 48, `${item.name}: project actions must retain a 48px hit area`)
        }
      }

      if (measurement.controller.result) {
        assertResultLayout(measurement, item.name)
        assert.equal(measurement.resultWarningRowCount, measurement.controller.resultWarningCount,
          `${item.name}: rendered warning rows must match actual warnings`)
        assert.deepEqual(measurement.resultWarningTexts, measurement.controller.resultWarnings.map((warning) => String(warning).trim()),
          `${item.name}: every actual warning must render in full`)
        assert.equal(measurement.renderedResultDescription, measurement.controller.resultDescription.trim(),
          `${item.name}: full result description must remain on the page`)
        if (measurement.controller.canUseResultActions && measurement.controller.resultHasFormula) {
          assert.equal(measurement.resultFormulaCard, null,
            `${item.name}: the standalone page formula explanation card must remain removed`)
          assert.equal(measurement.resultFormulaText, '',
            `${item.name}: removed page formula copy must not render elsewhere`)
          if (measurement.controller.formulaMinimumArea) {
            assert(measurement.resultSecondaryTexts.includes(`${measurement.controller.formulaMinimumArea} mm²`),
              `${item.name}: secondary formula minimum value must remain visible`)
          }
        }
      }
      if (['valid-390x753', 'professional-375x677', 'review-390x753', 'valid-light', 'review-dark'].includes(item.name)) {
        assert(measurement.pageScroll.resultCardInitiallyVisible,
          `${item.name}: complete result card must fit in the initial page viewport`)
      }
      if (item.state === 'longtext' || item.state === 'professional-longtext') {
        assert(measurement.pageScroll.canScroll, 'long text page must be scrollable')
        assert.equal(measurement.pageScroll.lastResultDetailReachable, true, 'long text final warning must be reachable')
      }
      if (item.state === 'project-keyboard') {
        assert(measurement.projectButtons.some((button) => button.text.includes('返回项目列表')),
          'create step must keep its return-to-list action')
      }
      if (item.state === 'project-confirm') {
        assert(measurement.projectButtons.some((button) => button.text.includes('返回项目列表')),
          'confirm step must keep its return-to-list action')
      }
      if (item.state === 'project') {
        assert(measurement.projectList.canScroll, 'project list must scroll within its single body when it overflows')
        assert.equal(measurement.projectList.lastProjectReachable, true, 'last project must remain reachable')
      }
      if (item.state === 'project-keyboard' || item.state === 'project-list-keyboard') {
        assert(measurement.controller.projectKeyboardOpen)
        assert(measurement.projectOverlay.bottom <= item.height - measurement.controller.keyboardHeight + 1,
          'project sheet must clear the simulated keyboard region')
        assert(measurement.projectFooter.bottom <= measurement.projectOverlay.bottom + 1,
          'project save/back actions must remain above the keyboard')
        assert(measurement.projectInput && measurement.projectInput.y >= measurement.projectSheet.y - 1,
          'project input/search must remain inside the visible sheet')
        assert(measurement.projectInput.bottom <= measurement.projectFooter.y + 1,
          'project input/search must remain above the fixed footer')
        if (item.state === 'project-list-keyboard') {
          assert(measurement.projectList?.canScroll && measurement.projectList.lastProjectReachable,
            'last project must remain reachable while search and footer are visible above the keyboard')
        }
      }
      if (item.state === 'project-config-name-keyboard' || item.state === 'project-config-note-keyboard') {
        assert(measurement.controller.projectKeyboardOpen)
        assert(measurement.controller.keyboardHeight > 250)
        assert(measurement.projectSheet.height <= item.height - measurement.controller.keyboardHeight + 1,
          'project confirmation sheet must fit the true keyboard-visible height')
        assert(measurement.projectFooter.bottom <= item.height - measurement.controller.keyboardHeight + 1,
          'project return/save footer must stay above the keyboard')
        assert(measurement.projectFocusedInputReachable === true,
          `${item.name}: focused metadata field text must remain fully visible`)
        assert(measurement.projectInput.y >= measurement.projectSheet.y - 1
          && measurement.projectInput.bottom <= measurement.projectFooter.y + 1,
        `${item.name}: focused input must remain inside the scroll body`)
      }
      if (item.state === 'share' || item.state === 'share-viewer') {
        console.log(`${item.name} preview geometry: ${JSON.stringify({
          scroll: measurement.reportPreviewScroll,
          image: measurement.reportImage,
          sheet: measurement.reportPreview,
        })}`)
        assert(measurement.reportPreview && measurement.reportPreview.bottom <= item.height + 1,
          'shared report preview must fit within viewport')
        assert(measurement.reportPreviewScroll.imageLoaded, 'generated Canvas2D PNG must load in the real preview image element')
        assert.equal(measurement.reportPreviewScroll.imageNaturalWidth, 750, 'report image must preserve the production 750px width')
        assert.equal(measurement.reportPreviewScroll.originalPreviewBinding, 'previewResultReportImage',
          'image tap must remain bound to original-image preview action')
        assert.equal(measurement.reportPreviewScroll.lastImageReachable, true, 'full report image must remain reachable by scrolling')
        if (!measurement.previewMeasurementFailureSimulated) {
          const layout = measurement.previewLayoutMeasurement
          assert.equal(layout?.methodCalled, true, 'QA bridge must call the loaded production preview layout method')
          assert.equal(layout?.methodResult, true, 'production layout method must accept the real DOM SelectorQuery measurements')
          assert(layout.resultReportPreviewStyle.includes('--cable-report-scroll-height:'),
            'production method must provide the applied scroll height')
          assert.equal(measurement.controller.resultReportCanvasWidth, 750, 'layout bridge must use the actual producer canvas width')
          assert.equal(layout.canvas.height, measurement.controller.resultReportCanvasHeight,
            'layout bridge must use the actual producer canvas height')
          assert.deepEqual(layout.selectorQueryTrace.map((entry) => entry.selector), [
            '.page-root',
            '.result-report-preview-overlay',
            '.result-report-preview-sheet',
            '.result-report-preview-header',
            '.result-report-preview-actions',
            '.result-report-preview-scroll',
            '.result-report-preview-image',
          ], 'production query must inspect the actual preview elements in order')
          for (const entry of layout.selectorQueryTrace) {
            assert.equal(entry.options.rect, true, entry.selector + ': query must request rect')
            assert.equal(entry.options.size, true, entry.selector + ': query must request size')
            for (const key of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
              assert(entry.returnedKeys.includes(key), entry.selector + ': requested ' + key + ' must be projected from the measured DOM')
            }
          }
          assert.equal(measurement.controller.resultReportPreviewStyle, layout.resultReportPreviewStyle,
            'DOM must use the style returned by the loaded production method')
        }
        if (capturePreviewBottom) {
          assert(measurement.reportPreviewScroll.canScroll,
            `long generated report must scroll inside the fixed preview sheet (client=${measurement.reportPreviewScroll.clientHeight}, scroll=${measurement.reportPreviewScroll.scrollHeight}, image=${measurement.reportImage?.height}, natural=${measurement.reportPreviewScroll.imageNaturalHeight})`)
        } else {
          assert(measurement.reportPreviewScroll.lastImageReachable,
            'report image that fits the preview viewport must remain fully visible')
          if (!measurement.previewMeasurementFailureSimulated) {
            const borderTotal = parseFloat(measurement.reportPreviewScrollComputed.borderTopWidth)
              + parseFloat(measurement.reportPreviewScrollComputed.borderBottomWidth)
            assert(measurement.reportImageContentGap >= -1 && measurement.reportImageContentGap < 2,
              'short report image must fill the scroll content box with under 2px blank space (gap=' + measurement.reportImageContentGap + 'px)')
            assert(measurement.reportImageOuterBBoxGap >= borderTotal - 1
              && measurement.reportImageOuterBBoxGap <= borderTotal + 2,
            'short report outer-box gap must be bounded by measured borders plus at most 2px (gap=' + measurement.reportImageOuterBBoxGap + 'px, borders=' + borderTotal + 'px)')
          }
        }
      }
      if (item.name === 'share-query-fallback-320x320') {
        assert.equal(measurement.previewMeasurementFailureSimulated, true)
        assert.equal(measurement.previewLayoutMeasurement, null,
          'explicit query-failure case must keep the finite CSS fallback path')
      }
      if (item.state === 'share-viewer') {
        assert.equal(measurement.controller.resultReportPreviewVisible, true,
          'the original viewer must keep its share sheet open behind it')
        assert.equal(measurement.controller.resultReportImageViewerVisible, true)
        assert.equal(measurement.controller.resultReportImageViewerScale, 300)
        assert.equal(measurement.originalViewerBack?.text, '返回分享')
        assert.equal(measurement.originalViewerBack?.event, 'closeResultReportImageViewer')
        assert.deepEqual(measurement.originalViewerScaleButtons.map((button) => button.id), [
          'cableOriginalZoom100', 'cableOriginalZoom200', 'cableOriginalZoom300',
        ])
        assert.deepEqual(measurement.originalViewerScaleButtons.map((button) => button.text), ['100%', '200%', '300%'])
        assert.deepEqual(measurement.originalViewerScaleButtons.map((button) => button.active), [false, false, true],
          'controller-backed 300% state must mark only the 300% viewer control active')
        const scaleColorSnapshots = await evaluate(cdp, "(() => { const buttons = [...document.querySelectorAll('.cable-original-viewer-scale')]; return buttons.map((selected) => { buttons.forEach((button) => button.classList.toggle('cable-original-viewer-scale-active', button === selected)); return { selectedId: selected.id, buttons: buttons.map((button) => { const style = getComputedStyle(button); return { id: button.id, background: style.backgroundColor, color: style.color } }) } }) })()")
        for (const snapshot of scaleColorSnapshots) {
          const active = snapshot.buttons.filter((button) => button.background === 'rgb(8, 127, 112)'
            && button.color === 'rgb(255, 255, 255)')
          assert.equal(active.length, 1, 'only one zoom control must render green/white for ' + snapshot.selectedId)
          assert.equal(active[0].id, snapshot.selectedId, 'computed active color must follow the selected zoom control')
          assert(snapshot.buttons.filter((button) => button.id !== snapshot.selectedId).every((button) =>
            button.background === 'rgba(255, 255, 255, 0.12)' && button.color === 'rgba(255, 255, 255, 0.82)'),
          'unselected zoom controls must retain neutral colors for ' + snapshot.selectedId)
        }
        fs.writeFileSync(path.join(screenshotRoot, item.name + '-scale-colors.json'), JSON.stringify({
          case: item.name,
          initialControllerScale: measurement.controller.resultReportImageViewerScale,
          initialActiveClasses: measurement.originalViewerScaleButtons.map((button) => ({ id: button.id, active: button.active })),
          selectedScaleSnapshots: scaleColorSnapshots,
          qaServerStartedAt: measurement.qaServerStartedAt,
          loadedSourceHashes: measurement.loadedSourceHashes,
          currentProductionSourceHashes: measurement.currentProductionSourceHashes,
        }, null, 2))
        assert(measurement.originalViewerScaleButtons.every((button) => button.event === 'setResultReportImageViewerScale'
          && Math.abs(button.box.width - 44) <= 1 && Math.abs(button.box.height - 44) <= 1),
        'viewer zoom controls must stay addressable 44x44 actions')
        assert.equal(measurement.originalViewerTouchMoveEvent, 'preventTouchMove',
          'the viewer backdrop must isolate vertical gestures from the share sheet/page')
        assert(measurement.originalViewerScroll?.imageLoaded, 'page-local viewer must load the production-rendered PNG')
        assert.equal(measurement.originalViewerScroll.imageNaturalWidth, 750)
        assert.equal(measurement.originalViewerScroll.imageErrorBinding, 'onResultReportImageViewerError')
        assert(measurement.originalViewerScroll.canScrollX && measurement.originalViewerScroll.canScrollY,
          '300% viewer image must scroll on both axes')
        assert.equal(measurement.originalViewerScroll.imageBottomReachable, true,
          'the viewer must allow scrolling to the full image bottom')
        assert.equal(measurement.originalViewerScroll.imageRightReachable, true,
          'the viewer must allow scrolling to the full image right edge')
        assert.equal(measurement.originalViewerScroll.underlyingScrollStable, true,
          'viewer scrolling must leave the hidden share sheet and page positions unchanged')
        assert(measurement.originalViewer.bottom <= item.height + 1,
          'viewer overlay must remain within the short viewport')
      }
      if (item.simulatePreviewMeasurementFailure) {
        assert.equal(measurement.previewMeasurementFailureSimulated, true,
          'fallback case must begin with both measured inline dimensions removed after a simulated selector-query failure')
        assert.deepEqual(measurement.previewRootInlineDimensions, { sheet: '', scroll: '' },
          'failed measurement fallback must not retain stale pixel dimensions')
        assert(measurement.reportPreviewScroll.box.height > 0
          && measurement.reportPreviewScroll.box.bottom <= measurement.reportPreviewActions.y + 1,
        'fallback scroll viewport must remain nonzero and finish before the fixed action row')
        assert(measurement.reportPreviewActions.bottom <= item.height + 1,
          'fallback must keep the preview footer visible inside the 320px viewport')
        assert(measurement.reportPreview.bottom <= item.height + 1,
          'fallback sheet including footer must fit inside the 320px viewport')
        assert(measurement.reportPreviewScrollComputed.height.endsWith('px'),
          'browser must resolve the production calc fallback to a real computed pixel height')
      }
      if (item.state === 'share-failed') {
        assert.equal(measurement.reportPreview, null, 'failed generation must leave the page without a false preview')
        assert.equal(measurement.actionDisabled[1], false, 'failed generation must leave report retry available')
      }
      if (item.name === 'reset-draft-actions') {
        assert.deepEqual(measurement.actionDisabled, [false, true, true, true],
          'a pending draft keeps reset enabled and disables stale share/favorite/save actions')
      }
      if (item.name === 'project-confirm-320x400' || item.name === 'project-confirm-short') {
        assert(measurement.projectPreview?.lastSummaryReachable,
          'frozen title/summary preview must be reachable above the fixed footer')
        assert(measurement.projectFooter.bottom <= item.height + 1, 'project confirmation footer must remain visible')
      }
      if (item.state === 'project-save-error') {
        assert(measurement.projectButtons.some((button) => button.text.includes('重试保存')),
          'save error must keep the retry action visible')
      }
      if (item.state === 'project-save-blocked') {
        assert(measurement.projectButtons[0].text.includes('关闭并重新选择')
          && measurement.projectButtons[1].disabled,
        'blocked save must clearly require reselection and disable stale confirmation')
      }
      if (item.state === 'project-success') {
        assert(measurement.projectButtons[0].text.includes('完成'), 'success step must expose its close action')
      }

      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      const screenshotPath = path.join(screenshotRoot, `${item.name}-${item.width}x${item.height}.png`)
      const png = Buffer.from(screenshot.data, 'base64')
      fs.writeFileSync(screenshotPath, png)
      let bottomScreenshot = ''
      if (capturePreviewBottom) {
        await evaluate(cdp, `(() => { const scroll = document.querySelector('.result-report-preview-scroll'); scroll.scrollTop = scroll.scrollHeight; return true })()`)
        await delay(120)
        const bottom = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        bottomScreenshot = `${item.name}-${item.width}x${item.height}-scrolled.png`
        fs.writeFileSync(path.join(screenshotRoot, bottomScreenshot), Buffer.from(bottom.data, 'base64'))
      }
      let editorBottomScreenshot = ''
      if (item.captureEditorBottom) {
        await evaluate(cdp, `(() => { const scroll = document.querySelector('.page-scroll'); scroll.scrollTop = scroll.scrollHeight; return true })()`)
        await delay(120)
        const bottom = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        editorBottomScreenshot = `${item.name}-${item.width}x${item.height}-editor-bottom.png`
        fs.writeFileSync(path.join(screenshotRoot, editorBottomScreenshot), Buffer.from(bottom.data, 'base64'))
      }
      let projectListBottomScreenshot = ''
      if (item.captureProjectListBottom) {
        await evaluate(cdp, `(() => { const body = document.querySelector('.project-body'); if (body) body.scrollTop = body.scrollHeight; return true })()`)
        await delay(120)
        const bottom = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        projectListBottomScreenshot = `${item.name}-${item.width}x${item.height}-project-list-bottom.png`
        fs.writeFileSync(path.join(screenshotRoot, projectListBottomScreenshot), Buffer.from(bottom.data, 'base64'))
      }
      let projectConfirmBottomScreenshot = ''
      if (item.captureProjectConfirmBottom) {
        await evaluate(cdp, `(() => { const body = document.querySelector('.project-body'); if (body) body.scrollTop = body.scrollHeight; return true })()`)
        await delay(120)
        const bottom = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        projectConfirmBottomScreenshot = `${item.name}-${item.width}x${item.height}-project-confirm-bottom.png`
        fs.writeFileSync(path.join(screenshotRoot, projectConfirmBottomScreenshot), Buffer.from(bottom.data, 'base64'))
      }
      let viewerBottomRightScreenshot = ''
      if (item.captureViewerBottomRight) {
        await evaluate(cdp, `(() => {
          const scroll = document.querySelector('.cable-original-viewer-scroll')
          if (!scroll) return false
          scroll.scrollTop = scroll.scrollHeight
          scroll.scrollLeft = scroll.scrollWidth
          return true
        })()`)
        await delay(120)
        const bottomRight = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        viewerBottomRightScreenshot = `${item.name}-${item.width}x${item.height}-viewer-bottom-right.png`
        fs.writeFileSync(path.join(screenshotRoot, viewerBottomRightScreenshot), Buffer.from(bottomRight.data, 'base64'))
      }
      let resultBottomScreenshot = ''
      if (item.captureResultBottom) {
        await evaluate(cdp, `(() => { const scroll = document.querySelector('.page-scroll'); scroll.scrollTop = scroll.scrollHeight; return true })()`)
        await delay(120)
        const bottom = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        resultBottomScreenshot = `${item.name}-${item.width}x${item.height}-result-bottom.png`
        fs.writeFileSync(path.join(screenshotRoot, resultBottomScreenshot), Buffer.from(bottom.data, 'base64'))
      }
      manifest.captures.push({
        ...item,
        screenshot: path.basename(screenshotPath),
        bottomScreenshot,
        editorBottomScreenshot,
        projectListBottomScreenshot,
        projectConfirmBottomScreenshot,
        viewerBottomRightScreenshot,
        resultBottomScreenshot,
        sha256: crypto.createHash('sha256').update(png).digest('hex'),
        resultCenterDelta: measurement.resultCard && measurement.resultSpec
          ? Math.abs(measurement.resultCard.centerX - measurement.resultSpec.centerX)
          : null,
        actionButtonSizes: measurement.actionButtons.map((button) => [button.width, button.height]),
        pageScroll: measurement.pageScroll,
        projectList: measurement.projectList,
        wxssConversion: measurement.wxssConversion,
        projectComputedStyles: measurement.controller.projectDialogVisible ? {
          sheetPaddingLeft: measurement.projectSheetComputed.paddingLeft,
          sheetRadius: measurement.projectSheetComputed.borderRadius,
          sheetBorderWidth: measurement.projectSheetComputed.borderWidth,
          sheetBorderLogicalRpxCssPx: item.width / 750,
          sheetBorderComputedExpectedCssPx: Math.max(1, item.width / 750),
          footerGap: measurement.projectFooterComputed.gap,
          buttonRadius: measurement.projectButtonComputed.borderRadius,
        } : null,
        keyboard: measurement.controller.projectKeyboardOpen
          ? { height: measurement.controller.keyboardHeight, overlay: measurement.projectOverlay, footer: measurement.projectFooter }
          : null,
      })
      console.log(`${item.name}: ${item.width}x${item.height}, screenshot saved`)
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 400,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 360,
      screenHeight: 400,
    })
    let resizedMeasurement = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const value = await evaluate(cdp, 'JSON.stringify(window.__cableQa?.measurements || null)')
      if (value) {
        const candidate = JSON.parse(value)
        if (candidate.viewport.width === 360) { resizedMeasurement = candidate; break }
      }
      await delay(125)
    }
    assert(resizedMeasurement, 'live viewport resize must recalculate styles and refresh geometry evidence')
    assert.deepEqual(resizedMeasurement.loadedSourceHashes, resizedMeasurement.currentProductionSourceHashes,
      'resized evidence must still match the frozen loaded source graph')
    const resizedStyle = await evaluate(cdp, '(() => { const preview = document.querySelector(".result-report-preview-sheet"); return { width: innerWidth, height: innerHeight, rpxScale: window.__productionWxssConversion.rpxScale, previewVisible: Boolean(preview), previewSheetPaddingLeft: preview ? getComputedStyle(preview).paddingLeft : "", rpxProbeOutput: window.__productionWxssConversion.probe.output }; })()')
    assert.equal(resizedStyle.width, 360, 'live resize must update CSS viewport width')
    assertNear(resizedStyle.rpxScale, 360 / 750, 0.000001, 'live resize must refresh rpxScale')
    assert.equal(resizedMeasurement.wxssConversion.viewportWidth, 360,
      'live resize must reapply production WXSS rpx values before capture')
    assert.equal(resizedMeasurement.inlineStyleConversion.viewportWidth, 360,
      'live resize must recalculate WXML inline rpx values')
    assert.equal(resizedMeasurement.inlineStyleConversion.passed, true,
      'live resize inline rpx probe must pass')
    if (resizedStyle.previewVisible) {
      assertNear(parseFloat(resizedStyle.previewSheetPaddingLeft), 18 * 360 / 750, 0.08,
        'live resize must reapply the report preview rpx padding')
    } else {
      assert(resizedStyle.rpxProbeOutput.includes('border-radius:7.2px'),
        'live resize must recalculate ordinary production rpx probe values without a report preview')
    }
    const resizedScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    const resizedScreenshotName = 'resize-rpx-recalc-360x400.png'
    fs.writeFileSync(path.join(screenshotRoot, resizedScreenshotName), Buffer.from(resizedScreenshot.data, 'base64'))
    manifest.rpxResizeCapture = {
      width: resizedStyle.width,
      height: resizedStyle.height,
      scale: resizedStyle.rpxScale,
      formula: 'innerWidth/750',
      previewSheetPaddingLeft: resizedStyle.previewSheetPaddingLeft || null,
      resizeMode: resizedStyle.previewVisible ? 'report-preview' : 'generic-production-rpx',
      screenshot: resizedScreenshotName,
      geometryEvidence: cases[cases.length - 1].name + '-360x400-' + cases[cases.length - 1].theme + '.json',
    }

    if (cases.some((item) => item.state === 'share')) {
      await runMotionCssProbe(cdp, manifest)
    } else {
      manifest.motionProbe = {
        skipped: true,
        reason: 'The selected case set contains no report preview scene.',
      }
    }

    manifest.sourceHashes = manifest.captures[0]
      ? (JSON.parse(fs.readFileSync(path.join(evidenceRoot, `${manifest.captures[0].name}-${manifest.captures[0].width}x${manifest.captures[0].height}-${manifest.captures[0].theme}.json`), 'utf8')).sourceHashes)
      : {}
    manifest.loadedSourceHashes = manifest.captures[0]
      ? (JSON.parse(fs.readFileSync(path.join(evidenceRoot, `${manifest.captures[0].name}-${manifest.captures[0].width}x${manifest.captures[0].height}-${manifest.captures[0].theme}.json`), 'utf8')).loadedSourceHashes)
      : {}
    manifest.qaServerStartedAt = manifest.captures[0]
      ? (JSON.parse(fs.readFileSync(path.join(evidenceRoot, `${manifest.captures[0].name}-${manifest.captures[0].width}x${manifest.captures[0].height}-${manifest.captures[0].theme}.json`), 'utf8')).qaServerStartedAt)
      : ''
    manifest.rpxConversion = {
      enabled: manifest.captures.every((capture) => capture.wxssConversion?.enabled),
      scaleFormula: 'innerWidth/750',
      perCapture: manifest.captures.map(({ name, width, wxssConversion }) => ({
        name, width, rpxScale: wxssConversion?.rpxScale,
      })),
    }
    fs.writeFileSync(path.join(evidenceRoot, 'browser-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Browser-only layout QA passed (${manifest.captures.length} screenshots; manifest: ${path.join(evidenceRoot, 'browser-manifest.json')})`)
  } finally {
    if (socket) socket.close()
    try { child.kill() } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 300))
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (error) {}
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

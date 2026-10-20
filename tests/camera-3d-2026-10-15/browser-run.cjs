const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const output = path.join(__dirname, 'evidence/browser')
fs.mkdirSync(output, { recursive: true })
const port = 8323
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function connect(socket) {
  let next = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id); clearTimeout(request.timer)
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result)
  })
  socket.addEventListener('error', (event) => console.error('CDP socket error', event.message))
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
}
async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'browser-server.cjs')], { windowsHide: true,
    env: { ...process.env, CAMERA_QA_V5_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  let serverLog = ''
  server.stdout.on('data', (data) => { serverLog += data }); server.stderr.on('data', (data) => { serverLog += data })
  let chrome, socket
  try {
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/__qa-meta`)).ok) break } catch {}
      await delay(100)
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-3d-qa-'))
    chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const endpoint = await new Promise((resolve, reject) => {
      let log = ''
      const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000)
      chrome.stderr.on('data', (data) => { log += data; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
      chrome.once('error', reject)
    })
    const tab = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(tab.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    const send = connect(socket)
    console.log('Browser:', JSON.stringify(await send('Browser.getVersion')))
    await send('Page.enable')
    const evaluate = async (expression) => {
      const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails))
      return value.result?.value
    }
    const cases = [
      { name: 'approved-dark-390', theme: 'dark', width: 390, height: 844, case: 'approved', export: true },
      { name: 'approved-light-390', theme: 'light', width: 390, height: 844, case: 'approved', export: true },
      { name: 'narrow-short-large-text', theme: 'dark', width: 320, height: 568, zoom: 1.3, case: 'approved' },
      { name: 'margin-zero', theme: 'light', width: 390, height: 844, case: 'approved', marginIndex: 0 },
      { name: 'pitch-depth-margin20', theme: 'dark', width: 390, height: 844, case: 'approved', marginIndex: 4, cameraHeight: '3.8', depth: '8' },
      { name: 'vertical-plane', theme: 'light', width: 390, height: 844, case: 'plane', export: true },
      { name: 'horizontal-only', theme: 'light', width: 320, height: 700, case: 'horizontal-only' },
      { name: 'empty-reset', theme: 'dark', width: 320, height: 568, case: 'approved', reset: true },
      { name: 'project-dialog', theme: 'light', width: 320, height: 568, zoom: 1.3, case: 'project-list' },
    ]
    const reports = []
    for (const item of cases) {
      await send('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: 1, mobile: true, screenWidth: item.width, screenHeight: item.height })
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: item.theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
      const url = `http://127.0.0.1:${port}/tests/camera-3d-2026-10-15/browser.html?case=${item.case}&theme=${item.theme}&zoom=${item.zoom || 1}`
      await send('Page.navigate', { url })
      let ready
      for (let i = 0; i < 100; i += 1) { ready = await evaluate('document.documentElement.dataset.cameraQaReady'); if (['true', 'error'].includes(ready)) break; await delay(100) }
      assert.equal(ready, 'true', await evaluate('window.__camera3dError'))
      if (item.marginIndex !== undefined) await evaluate(`window.__cameraDispatch('onMarginChange',{}, {value:'${item.marginIndex}'})`)
      if (item.cameraHeight) {
        await evaluate(`window.__cameraDispatch('onFieldInput',{field:'fixedCameraHeightText'},{value:'${item.cameraHeight}'})`)
        await evaluate("window.__cameraDispatch('onFieldBlur')")
      }
      if (item.depth) {
        await evaluate(`window.__cameraDispatch('onFieldInput',{field:'groundDepthText'},{value:'${item.depth}'})`)
        await evaluate("window.__cameraDispatch('onFieldBlur')")
      }
      if (item.reset) await evaluate("window.__cameraDispatch('resetToDefaults')")
      const report = await evaluate('window.__camera3d')
      assert(report.noViewSelector)
      assert(!report.horizontalOverflow)
      report.controls.forEach((control) => { assert(control.width >= 44 && control.height >= 44); assert(control.x >= 0 && control.right <= item.width + 1) })
      if (report.canvas) {
        assert.equal(report.opticalFills.length, item.case === 'horizontal-only' ? 1 : 2)
        assert.deepEqual(report.background, item.theme === 'dark' ? [0, 0, 0, 255] : [246, 247, 249, 255])
        const png = await evaluate('window.__diagramPng')
        fs.writeFileSync(path.join(output, `${item.name}-diagram.png`), Buffer.from(png.split(',')[1], 'base64'))
      }
      const screenshot = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${item.name}.png`), Buffer.from(screenshot.data, 'base64'))
      if (item.export) {
        report.export = await evaluate('window.__exportReport()')
        assert.equal(report.export.views.length, 1)
        assert.equal(report.export.theme, item.theme)
        const png = await evaluate('window.__exportPng')
        fs.writeFileSync(path.join(output, `${item.name}-export.png`), Buffer.from(png.split(',')[1], 'base64'))
        const dialog = await send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(path.join(output, `${item.name}-share-dialog.png`), Buffer.from(dialog.data, 'base64'))
      }
      reports.push({ name: item.name, ...report })
      console.log(`${item.name}: sections=${report.opticalFills.length}, labelCollisions=${report.collisions.length}`)
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(reports, null, 2))
    console.log(`PASS ${reports.length} browser cases; actual report PNGs saved`)
  } finally { socket?.close(); chrome?.kill(); server.kill(); fs.writeFileSync(path.join(output, 'server.log'), serverLog) }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

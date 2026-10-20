const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')

const evidenceRoot = path.join(process.env.CABLE_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-10-10/tunebuddy-cable-revision-010048', 'browser-qa/report-canvas')
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const qaPort = Number(process.env.CABLE_QA_PORT) || 8123
const baseUrl = `http://127.0.0.1:${qaPort}/tests/cable-refactor-2026-10-09/report-canvas.html`
const cases = ['constant', 'professional', 'review']

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function connect(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const page = targets.find((target) => target.type === 'page')
      if (page?.webSocketDebuggerUrl) {
        const socket = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true })
          socket.addEventListener('error', reject, { once: true })
        })
        return socket
      }
    } catch (error) {}
    await delay(200)
  }
  throw new Error('Chrome DevTools endpoint did not become ready')
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
        }, 20000)
      })
    },
  }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Browser evaluation failed')
  return response.result?.value
}

async function main() {
  assert(fs.existsSync(chromePath), `Chrome not found at ${chromePath}`)
  await fetch(`http://127.0.0.1:${qaPort}/__state?state=valid`).then((response) => {
    assert(response.ok, 'Local cable browser bridge is not ready')
  })
  fs.mkdirSync(evidenceRoot, { recursive: true })
  const port = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tunebuddy-report-canvas-'))
  const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  let socket
  const output = []

  try {
    socket = await connect(port)
    const cdp = createCdp(socket)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    for (const item of cases) {
      await cdp.send('Page.navigate', { url: `${baseUrl}?case=${item}` })
      let ready = false
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const status = await evaluate(cdp, 'document.documentElement.dataset.ready || document.documentElement.dataset.error || ""')
        if (status === 'true') { ready = true; break }
        if (status && status !== 'true') throw new Error(`${item}: ${status}`)
        await delay(100)
      }
      assert(ready, `${item}: actual Canvas2D report did not finish rendering`)
      const summary = await evaluate(cdp, 'window.__reportQa')
      assert(summary && summary.case === item, `${item}: missing report QA metadata`)
      assert(summary.output?.sha256 && summary.output?.fileName, `${item}: PNG was not saved`)
      assert.equal(summary.layout.undrawnTextLines.length, 0, `${item}: drawing omitted measured text`)
      assert(!summary.layout.sections.some((section) => section.type === 'formula'),
        `${item}: standalone formula card must be absent`)
      assert.equal(Object.hasOwn(summary.payload, 'boundary'), false, `${item}: generic boundary payload must be absent`)
      const drawn = summary.layout.drawnTextLines.join('')
      assert(!drawn.includes('说明：') && !drawn.includes('S ≥ P × L × 5'),
        `${item}: removed report-only formula/boundary text was drawn`)
      const normalizedDrawn = drawn.replace(/\s+/g, '')
      assert(normalizedDrawn.includes(summary.result.description.replace(/\s+/g, '')),
        `${item}: main result description was omitted`)
      for (const [, value] of summary.payload.parameters) {
        assert(normalizedDrawn.includes(value.replace(/\s+/g, '')), `${item}: input parameter ${value} was omitted`)
      }
      if (item === 'constant') assert(normalizedDrawn.includes(summary.payload.secondary[1].value.replace(/\s+/g, '')),
        'formula minimum must remain in secondary metric')
      if (item === 'professional') assert(normalizedDrawn.includes(summary.payload.secondary[1].value.replace(/\s+/g, '')),
        'current rating must remain in secondary metric')
      if (item === 'review') for (const warning of summary.warnings) {
        assert(normalizedDrawn.includes(warning.replace(/\s+/g, '')), 'actual review warning was omitted')
      }
      if (item === 'review') assert(summary.warnings.length > 0, 'review case should carry actual calculation warnings')
      output.push(summary)
      console.log(`${item}: ${summary.spec} -> ${summary.output.fileName}, ${summary.output.sha256}`)
    }
    fs.writeFileSync(path.join(evidenceRoot, 'run-manifest.json'), `${JSON.stringify({
      renderer: 'Google Chrome headless Canvas2D with production cable-report.js and report-drawing.js',
      limits: 'Browser Canvas2D evidence only; not WeChat native runtime or native PNG export.',
      reports: output,
    }, null, 2)}\n`)
    console.log(`Actual production report drawing passed (${output.length} PNGs; ${evidenceRoot})`)
  } finally {
    if (socket) socket.close()
    try { child.kill() } catch (error) {}
    await delay(250)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (error) {}
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

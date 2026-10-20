'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const qaDir = __dirname
const repoRoot = path.resolve(qaDir, '../..')
const evidenceRoot = path.resolve(qaDir, 'evidence-v5')
const outputRoot = path.resolve(evidenceRoot, 'diagnostic/native-cli')
const chromePath = process.env.CAMERA_QA_BROWSER || process.env.CAMERA_QA_CHROME
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browserTimeoutMs = Math.max(1000, Number.parseInt(process.env.CAMERA_QA_TIMEOUT_MS, 10) || 60000)
const browserName = /msedge\.exe$/i.test(chromePath) ? 'Microsoft Edge' : 'Google Chrome'
const origin = `http://127.0.0.1:${Number(process.env.CAMERA_QA_V5_PORT) || 8151}`
const testCase = { name: 'ground-plan-390x844', scenario: 'ground', width: 390, height: 844, theme: 'light', view: 0 }
const qaCase = testCase.name
const within = (child, parent) => {
  const relative = path.relative(parent, child)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex')
const runId = `${new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-')}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`
const runDir = path.resolve(outputRoot, runId)
const screenshotPath = path.join(runDir, `${qaCase}.png`)
const reportPath = path.join(runDir, `${qaCase}.json`)
const stderrPath = path.join(runDir, `${browserName === 'Microsoft Edge' ? 'edge' : 'chrome'}-stderr.log`)

assert(within(outputRoot, evidenceRoot), `Native CLI outputs must stay below ${evidenceRoot}`)
assert(within(runDir, outputRoot), `Native CLI run directory must stay below ${outputRoot}`)

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)))
}

async function readServerMeta() {
  const response = await fetch(`${origin}/__qa-meta`, { cache: 'no-store' })
  const body = await response.json()
  if (!response.ok) throw new Error(`Fresh V5 server metadata check failed: HTTP ${response.status}: ${JSON.stringify(body)}`)
  if (JSON.stringify(sortedObject(body.loadedHashes)) !== JSON.stringify(sortedObject(body.currentHashes))) {
    throw new Error(`V5 server source hashes are stale: ${JSON.stringify(body)}`)
  }
  return body
}

function decodeHtmlText(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function extractPublicReport(dom) {
  const ready = /\bdata-camera-qa-ready=["']([^"']*)["']/i.exec(dom)?.[1] || ''
  const qaStatus = /<body\b[^>]*\bdata-qa-status=["']([^"']*)["']/i.exec(dom)?.[1] || ''
  const reportMatch = /<pre\b(?=[^>]*\bid=["']qa-report["'])[^>]*>([\s\S]*?)<\/pre>/i.exec(dom)
  if (!reportMatch) throw new Error('Chrome --dump-dom output did not contain the public #qa-report element.')
  const reportText = decodeHtmlText(reportMatch[1]).trim()
  if (!reportText) throw new Error(`The public #qa-report is empty (cameraQaReady=${ready}, qaStatus=${qaStatus}).`)
  let report
  try { report = JSON.parse(reportText) }
  catch (error) { throw new Error(`The public #qa-report is not valid JSON: ${error.message}; prefix=${reportText.slice(0, 300)}`) }
  return { ready, qaStatus, report, reportText }
}

function launchChrome(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromePath, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let overflow = false
    const maxOutputBytes = 24 * 1024 * 1024
    const append = (current, chunk) => {
      if (Buffer.byteLength(current) + chunk.length > maxOutputBytes) {
        overflow = true
        return current
      }
      return current + chunk.toString('utf8')
    }
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.once('error', (error) => reject(Object.assign(error, { childPid: child.pid, stdout, stderr })))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, browserTimeoutMs)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, pid: child.pid, timedOut, overflow })
    })
  })
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true })
  fs.mkdirSync(runDir, { recursive: false })
  const serverMeta = await readServerMeta()
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome executable does not exist: ${chromePath}`)

  const tempRoot = path.resolve(os.tmpdir())
  let profilePath = path.resolve(tempRoot, `camera-v5-headless-${process.pid}-${crypto.randomUUID()}`)
  const profilePrefix = `camera-v5-headless-${process.pid}-`
  assert(within(profilePath, tempRoot) && path.basename(profilePath).startsWith(profilePrefix),
    `Refusing to use a profile outside the unique temp directory: ${profilePath}`)

  const url = new URL('/tests/camera-refactor-2026-10-12/camera-browser-v5.html', origin)
  url.searchParams.set('case', testCase.scenario)
  url.searchParams.set('theme', testCase.theme)
  url.searchParams.set('view', String(testCase.view))
  url.searchParams.set('qaCase', qaCase)
  const args = [
    '--headless=new',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--run-all-compositor-stages-before-draw',
    '--force-device-scale-factor=1',
    `--window-size=${testCase.width},${testCase.height}`,
    '--virtual-time-budget=30000',
    `--screenshot=${screenshotPath}`,
    '--dump-dom',
    `--user-data-dir=${profilePath}`,
    url.href,
  ]
  assert(!args.some((argument) => /^(?:--no-sandbox|--disable-(?:gpu|renderer)-sandbox)(?:=|$)/i.test(argument)),
    'The standard browser, GPU, and renderer sandboxes must remain enabled.')

  let chromeResult = null
  let publicDom = null
  let failure = null
  try {
    chromeResult = await launchChrome(args)
    fs.writeFileSync(stderrPath, chromeResult.stderr, 'utf8')
    if (chromeResult.overflow) throw new Error('Chrome --dump-dom output exceeded the 24 MiB capture limit.')
    if (chromeResult.timedOut) throw new Error(`${browserName} headless single run exceeded the ${browserTimeoutMs}ms timeout; no retry was attempted.`)
    if (chromeResult.code !== 0) throw new Error(`${browserName} headless exited with code ${chromeResult.code}, signal ${chromeResult.signal || ''}. stderr=${chromeResult.stderr.slice(-3000)}`)
    publicDom = extractPublicReport(chromeResult.stdout)

    const screenshotBytes = fs.existsSync(screenshotPath) ? fs.readFileSync(screenshotPath) : Buffer.alloc(0)
    if (screenshotBytes.length < 100 || screenshotBytes[0] !== 0x89 || screenshotBytes[1] !== 0x50) {
      throw new Error(`Chrome did not write a valid PNG screenshot at ${screenshotPath} (bytes=${screenshotBytes.length}).`)
    }
    const report = publicDom.report
    const actualViewport = report.viewport || null
    if (typeof report.reportImage?.dataUrl === 'string' && report.reportImage.dataUrl.startsWith('data:image/png;base64,')) {
      const productionPngBytes = Buffer.from(report.reportImage.dataUrl.slice('data:image/png;base64,'.length), 'base64')
      const productionPngPath = path.join(runDir, `${qaCase}-production-report.png`)
      fs.writeFileSync(productionPngPath, productionPngBytes)
      report.reportImage.productionReportPng = productionPngPath
      report.reportImage.productionReportPngSha256 = digest(productionPngBytes)
      delete report.reportImage.dataUrl
    }
    const checks = {
      publicReady: publicDom.ready === 'true',
      bodyQaStatus: publicDom.qaStatus === report.status,
      caseIdentity: report.qaCase === qaCase && report.qaAction === '',
      actionCompleted: report.qaActionComplete === true,
      productionSourcesMatchServer: JSON.stringify(sortedObject(report.sourceHashes))
        === JSON.stringify(sortedObject(serverMeta.loadedHashes)),
      actualViewportMatchesRequest: actualViewport?.width === testCase.width && actualViewport?.height === testCase.height,
      screenshotPngWritten: screenshotBytes.length > 100,
      reportStatusPassed: report.status === 'passed',
    }
    const summary = {
      status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
      suite: 'camera V5 native headless fallback (single ground-plan case)',
      browser: { name: browserName, executable: chromePath, pid: chromeResult.pid, exitCode: chromeResult.code,
        signal: chromeResult.signal || null, mode: `${browserName} CLI --headless=new --dump-dom --screenshot`,
        sandboxEnabled: true, usedCdp: false, usedNoSandbox: false,
        windowSize: { width: testCase.width, height: testCase.height }, actualViewport,
        virtualTimeBudgetMs: 30000, wallTimeoutMs: browserTimeoutMs,
        launchedWithWindowsHide: true, url: url.href },
      server: { origin, processId: serverMeta.processId, serverStartedAt: serverMeta.serverStartedAt,
        sourceHashesMatch: true, productionSourceHashes: serverMeta.loadedHashes },
      publicDom: { qaReady: publicDom.ready, qaStatus: publicDom.qaStatus,
        reportElement: '#qa-report', dumpBytes: Buffer.byteLength(chromeResult.stdout), dumpSha256: digest(chromeResult.stdout) },
      checks,
      report,
      screenshot: { path: screenshotPath, bytes: screenshotBytes.length, sha256: digest(screenshotBytes) },
      chromeStderr: { path: stderrPath, bytes: Buffer.byteLength(chromeResult.stderr), sha256: digest(chromeResult.stderr) },
    }
    fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify({ status: summary.status, reportPath, screenshotPath,
      screenshotBytes: screenshotBytes.length, screenshotSha256: digest(screenshotBytes), checks,
      reportFailures: report.failures || [] }, null, 2)}\n`)
    if (summary.status !== 'passed') process.exitCode = 1
  } catch (error) {
    failure = error
    if (chromeResult?.stderr !== undefined && !fs.existsSync(stderrPath)) fs.writeFileSync(stderrPath, chromeResult.stderr, 'utf8')
    const summary = {
      status: 'failed', suite: 'camera V5 native headless fallback (single ground-plan case)',
      failure: String(error && error.stack || error),
      browser: { name: browserName, executable: chromePath, pid: chromeResult?.pid || error.childPid || null,
        exitCode: chromeResult?.code ?? null, signal: chromeResult?.signal || null,
        mode: `${browserName} CLI --headless=new --dump-dom --screenshot`, sandboxEnabled: true,
        usedCdp: false, usedNoSandbox: false, windowSize: { width: testCase.width, height: testCase.height },
        virtualTimeBudgetMs: 30000, wallTimeoutMs: browserTimeoutMs, launchedWithWindowsHide: true, url: url.href },
      server: { origin, processId: serverMeta?.processId || null, serverStartedAt: serverMeta?.serverStartedAt || null },
      stdoutBytes: Buffer.byteLength(chromeResult?.stdout || error.stdout || ''),
      stderr: chromeResult?.stderr || error.stderr || '',
      screenshotExists: fs.existsSync(screenshotPath), screenshotPath,
    }
    fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify({ status: 'failed', reportPath, screenshotPath,
      failure: summary.failure, stderr: summary.stderr.slice(-3000) }, null, 2)}\n`)
    process.exitCode = 1
  } finally {
    const tempRoot = path.resolve(os.tmpdir())
    const profilePrefix = `camera-v5-headless-${process.pid}-`
    if (profilePath && within(profilePath, tempRoot)
      && path.basename(profilePath).startsWith(profilePrefix)) {
      fs.rmSync(profilePath, { recursive: true, force: true })
    }
  }
  if (failure) return
}

main().catch((error) => {
  process.stderr.write(`${String(error && error.stack || error)}\n`)
  process.exitCode = 1
})

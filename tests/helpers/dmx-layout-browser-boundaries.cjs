'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function inputManifest(scriptPath, harnessDirectory) {
  const production = fs.readdirSync(path.join(root, 'pages/dmx-layout'))
    .filter((name) => /\.(?:js|json|wxml|wxss)$/.test(name))
    .map((name) => 'pages/dmx-layout/' + name)
  const harness = ['browser-driver.cjs', 'browser-host.cjs', 'browser.html', 'browser.js', 'browser-runtime.js']
    .map((name) => path.relative(root, path.join(harnessDirectory, name)).replaceAll('\\', '/'))
  const files = [...new Set([
    'app.json',
    'app.wxss',
    'assets/lighting/fixture-types.png',
    ...production,
    ...harness,
    path.relative(root, scriptPath).replaceAll('\\', '/'),
    path.relative(root, __filename).replaceAll('\\', '/'),
  ])].sort()
  const entries = files.map((relative) => {
    const bytes = fs.readFileSync(path.join(root, relative))
    return { path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  })
  const sha256 = crypto.createHash('sha256')
  for (const entry of entries) sha256.update(entry.path + '\0' + entry.sha256 + '\n')
  return { sha256: sha256.digest('hex'), files: entries }
}

function evidenceDirectory(fallbackDirectory) {
  const requested = process.env.LIGHTING_QA_OUT
  const target = requested
    ? (path.isAbsolute(requested) ? requested : path.resolve(root, requested))
    : fallbackDirectory
  fs.mkdirSync(target, { recursive: true })
  return path.resolve(target)
}

function saveEvidence(directory, filename, summary) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, filename), JSON.stringify(summary, null, 2) + '\n')
}

async function runLayoutRotationChecks({ directory, scriptPath, scope, driver }) {
  const { launch, delay } = driver
  const evidenceOut = evidenceDirectory(path.join(directory, 'evidence/rotation'))
  const inputs = inputManifest(scriptPath, directory)
  const summary = {
    runAt: new Date().toISOString(),
    scope,
    inputHash: inputs.sha256,
    inputFiles: inputs.files,
    route: 'pages/dmx-layout/dmx-layout',
    pageOrientation: 'portrait',
    wideViewportsAreResizePressure: true,
    resizeTheme: 'light',
    nativeRuntime: false,
    physicalDevice: false,
    browser: null,
    screenshots: [],
    cases: [],
    actualExitCode: 0,
  }
  let browser
  const check = async (name, body) => {
    try {
      const details = await body()
      summary.cases.push({ name, status: 'passed', ...(details === undefined ? {} : { details }) })
      console.log('PASS ' + name)
    } catch (error) {
      summary.cases.push({ name, status: 'failed', error: error.stack || String(error) })
      console.error('FAIL ' + name + ': ' + error.message)
    }
  }
  const evaluate = (expression) => browser.evaluate(expression)
  const capture = async (label) => {
    const filename = scope + '-' + label + '.png'
    const file = path.join(evidenceOut, filename)
    await browser.screenshot(file)
    const relative = path.relative(root, file).replaceAll('\\', '/')
    summary.screenshots.push(relative)
    return relative
  }
  const baselineExpression = `(()=>{
    const p=window.__lightingQa.page
    window.__qaDmxResizeBaseline={
      scheme:JSON.stringify(p._scheme),layout:JSON.stringify(p._layout),
      positions:JSON.stringify(p._layout.positionsById),
      storage:JSON.stringify([...window.__lightingQa.storage.entries()]),
      writes:window.__lightingQa.events.writes.length,
      navigations:window.__lightingQa.events.navigations.length
    }
    window.__qaDmxOriginalCanvas=document.getElementById('dmxLayoutCanvas')
    return {window:[innerWidth,innerHeight],theme:document.documentElement.dataset.theme,canvas:!!window.__qaDmxOriginalCanvas,state:window.__qaDmxResizeBaseline}
  })()`
  const readResizeMetrics = async () => evaluate(`(()=>{
    const p=window.__lightingQa.page,n=document.getElementById('dmxLayoutCanvas'),r=n?.getBoundingClientRect()
    const g=p.getGeometry(),s=g.stage,v=p._view,b=window.__qaDmxResizeBaseline
    return {
      size:[innerWidth,innerHeight],theme:document.documentElement.dataset.theme,
      dataSize:[p.data.windowWidth,p.data.windowHeight],dataCanvasHeight:p.data.canvasShellHeight,
      canvas:r&&{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,backingWidth:n.width,backingHeight:n.height},
      stage:{left:s.left*v.s+v.x,top:s.top*v.s+v.y,right:(s.left+s.width)*v.s+v.x,bottom:(s.top+s.height)*v.s+v.y},
      stateUnchanged:!!b&&JSON.stringify(p._scheme)===b.scheme&&JSON.stringify(p._layout)===b.layout,
      positionsUnchanged:!!b&&JSON.stringify(p._layout.positionsById)===b.positions,
      storageUnchanged:!!b&&JSON.stringify([...window.__lightingQa.storage.entries()])===b.storage,
      writesUnchanged:!!b&&window.__lightingQa.events.writes.length===b.writes,
      navigationsUnchanged:!!b&&window.__lightingQa.events.navigations.length===b.navigations,
      pageWidth:document.documentElement.scrollWidth,errors:window.__lightingQa.events.errors
    }
  })()`)
  const assertResize = (metrics, width, height) => {
    assert.deepEqual(metrics.errors, [], 'resize must not introduce controller runtime errors')
    assert.deepEqual(metrics.size, [width, height], 'browser viewport reaches the current page onResize handler')
    assert.equal(metrics.theme, 'light', 'resize test records the actual light page theme')
    assert.deepEqual(metrics.dataSize, [width, height], 'page data receives the new viewport dimensions')
    assert(metrics.canvas, 'real shared-route canvas remains mounted after resize')
    assert(metrics.canvas.width > 0 && metrics.canvas.height > 0, 'canvas has positive dimensions')
    assert(metrics.canvas.x >= -1 && metrics.canvas.y >= -1
      && metrics.canvas.right <= width + 1 && metrics.canvas.bottom <= height + 1,
    'canvas stays inside the resized browser viewport ' + JSON.stringify(metrics.canvas))
    assert(Math.abs(metrics.canvas.backingWidth - metrics.canvas.width) <= 1
      && Math.abs(metrics.canvas.backingHeight - metrics.canvas.height) <= 1,
    'canvas backing store is remeasured to the resized DOM canvas ' + JSON.stringify(metrics.canvas))
    assert(metrics.stage.left >= -1 && metrics.stage.top >= -1
      && metrics.stage.right <= metrics.canvas.width + 1 && metrics.stage.bottom <= metrics.canvas.height + 1,
    'stage remains within the actual canvas viewport ' + JSON.stringify(metrics.stage))
    assert(Math.abs(metrics.canvas.height - metrics.dataCanvasHeight) <= 1, 'canvas follows the current canvas shell height')
    assert(metrics.stateUnchanged, 'resize leaves the complete scheme and physical layout unchanged')
    assert(metrics.positionsUnchanged, 'resize leaves every lamp position unchanged')
    assert(metrics.storageUnchanged && metrics.writesUnchanged && metrics.navigationsUnchanged,
      'resize does not write storage or navigate')
    assert(metrics.pageWidth <= width + 1, 'shared page has no horizontal overflow')
  }
  const settingsMetrics = async () => evaluate(`(()=>{
    const p=window.__lightingQa.page,card=document.querySelector('.settings-card'),scroll=document.querySelector('.settings-scroll'),actions=document.querySelector('.settings-actions'),button=document.querySelector('.settings-apply')
    const rect=n=>{const r=n?.getBoundingClientRect();return r&&{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
    return {
      viewport:[innerWidth,innerHeight],theme:document.documentElement.dataset.theme,
      dataSize:[p.data.windowWidth,p.data.windowHeight],card:rect(card),scroll:rect(scroll),actions:rect(actions),button:rect(button),
      capsule:wx.getMenuButtonBoundingClientRect(),safeArea:wx.getWindowInfo().safeArea,
      canvasInDom:!!document.getElementById('dmxLayoutCanvas'),canvasReference:!!p._canvasNode,
      stateUnchanged:JSON.stringify(p._scheme)===window.__qaDmxResizeBaseline.scheme&&JSON.stringify(p._layout)===window.__qaDmxResizeBaseline.layout,
      positionsUnchanged:JSON.stringify(p._layout.positionsById)===window.__qaDmxResizeBaseline.positions,
      storageUnchanged:JSON.stringify([...window.__lightingQa.storage.entries()])===window.__qaDmxResizeBaseline.storage,
      writesUnchanged:window.__lightingQa.events.writes.length===window.__qaDmxResizeBaseline.writes
    }
  })()`)
  const assertSettings = (metrics, width, height) => {
    assert.deepEqual(metrics.viewport, [width, height])
    assert.equal(metrics.theme, 'light', 'settings panel resize keeps the recorded light page theme')
    assert.deepEqual(metrics.dataSize, [width, height], 'settings resize updates page viewport data')
    assert(metrics.card && metrics.card.width > 0 && metrics.card.height > 0, 'settings card remains visible')
    assert(metrics.card.x >= -1 && metrics.card.right <= width + 1, 'settings card remains within viewport width')
    assert(metrics.card.y >= metrics.capsule.bottom - 1, 'settings card clears the simulated native capsule')
    assert(metrics.card.bottom <= metrics.safeArea.bottom + 1, 'settings card remains above the current safe bottom')
    assert(metrics.scroll && metrics.actions && metrics.button, 'settings scroll area and real fixed action footer remain mounted')
    assert(metrics.scroll.height > 0, 'settings scroll body has positive visible height')
    assert(metrics.scroll.x >= metrics.card.x - 1 && metrics.scroll.right <= metrics.card.right + 1,
      'settings scroll body stays inside the card horizontally')
    assert(metrics.scroll.y >= metrics.card.y - 1 && metrics.scroll.bottom <= metrics.actions.y + 1,
      'settings scroll body ends before the fixed action footer ' + JSON.stringify(metrics))
    assert(metrics.actions.y >= metrics.card.y - 1 && metrics.actions.bottom <= metrics.card.bottom + 1,
      'settings action footer remains inside the card')
    assert(metrics.button.height > 0 && metrics.button.y >= metrics.actions.y - 1
      && metrics.button.bottom <= metrics.actions.bottom + 1, 'settings apply button remains visible inside the action footer')
    assert.equal(metrics.canvasInDom, false, 'stage canvas is unmounted while settings are open')
    assert.equal(metrics.canvasReference, false, 'controller releases the old stage canvas while settings are open')
    assert(metrics.stateUnchanged && metrics.positionsUnchanged, 'settings resize leaves scheme and positions unchanged')
    assert(metrics.storageUnchanged && metrics.writesUnchanged, 'opening and resizing settings does not write storage')
  }

  try {
    await check('retired landscape route stays unavailable while the shared route remains portrait', async () => {
      const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
      const registered = [...(app.pages || [])]
      for (const pkg of app.subPackages || app.subpackages || []) {
        for (const page of pkg.pages || []) registered.push(path.posix.join(pkg.root, page))
      }
      const retired = 'pages/dmx-layout-landscape/dmx-layout-landscape'
      assert(!registered.includes(retired), 'retired landscape route stays out of app.json')
      assert.equal(fs.existsSync(path.join(root, retired + '.js')), false, 'retired page module remains absent')
      assert.equal(fs.existsSync(path.join(root, 'pages/dmx-layout-landscape')), false, 'retired page directory remains absent')
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.json'), 'utf8')).pageOrientation,
        'portrait', 'wide viewports below are browser resize pressure on the shared portrait page')
      for (const name of ['browser-host.cjs', 'browser.js', 'browser-runtime.js']) {
        const source = fs.readFileSync(path.join(directory, name), 'utf8')
        if (name === 'browser-host.cjs') assert(!source.includes('layout-landscape'), 'browser bundle cannot target the retired page')
        else {
          assert(source.includes("query.get('page')==='landscape'"), 'browser explicitly rejects the retired landscape query')
          assert(!source.includes(retired), 'browser never opens the retired page module')
        }
      }
      return { registeredLayoutRoute: 'pages/dmx-layout/dmx-layout', pageOrientation: 'portrait', retiredRoute: retired }
    })

    browser = await launch()
    const version = await browser.send('Browser.getVersion')
    summary.browser = version.product || null

    await check('shared layout page loads before resize', async () => {
      await browser.viewport(390, 844, 'light')
      await browser.navigate({ page: 'layout', theme: 'light', lightingContextName: encodeURIComponent('临时设置') })
      await delay(260)
      const initial = await evaluate(baselineExpression)
      assert.deepEqual(initial.window, [390, 844])
      assert.equal(initial.theme, 'light', 'resize baseline uses the actual light page theme')
      assert(initial.canvas, 'shared layout page mounts its real 2D canvas')
      const facts = await evaluate('window.__facts()')
      assert.deepEqual(facts.errors, [])
      assert.deepEqual(facts.runtimeErrors, [])
      return { viewport: initial.window, canvasMounted: initial.canvas }
    })

    for (const profile of [
      { width: 844, height: 390, theme: 'light', kind: 'wide viewport resize pressure' },
      { width: 568, height: 320, theme: 'light', kind: 'short wide viewport resize pressure' },
      { width: 390, height: 844, theme: 'light', kind: 'portrait return after resize' },
    ]) {
      await check(profile.kind + ' ' + profile.width + 'x' + profile.height, async () => {
        await browser.viewport(profile.width, profile.height, profile.theme)
        await delay(360)
        const metrics = await readResizeMetrics()
        assertResize(metrics, profile.width, profile.height)
        return { ...metrics, screenshot: await capture('resize-' + profile.width + 'x' + profile.height) }
      })
    }

    await check('settings safe bounds and real footer after resize; canvas remounts fresh on close', async () => {
      await browser.viewport(568, 320, 'light')
      await delay(360)
      await evaluate('window.__qaDmxOriginalCanvas=document.getElementById("dmxLayoutCanvas")')
      await evaluate('window.__dispatch("openLayoutSettings")')
      await delay(180)
      const shortMetrics = await settingsMetrics()
      assertSettings(shortMetrics, 568, 320)
      shortMetrics.screenshot = await capture('settings-568x320')

      await browser.viewport(390, 844, 'light')
      await delay(360)
      const portraitMetrics = await settingsMetrics()
      assertSettings(portraitMetrics, 390, 844)
      portraitMetrics.screenshot = await capture('settings-after-resize-390x844')

      await evaluate('window.__dispatch("closeLayoutSettings")')
      await delay(380)
      const restored = await evaluate(`(()=>{
        const p=window.__lightingQa.page,n=document.getElementById('dmxLayoutCanvas'),r=n?.getBoundingClientRect(),g=p.getGeometry(),s=g.stage,v=p._view,b=window.__qaDmxResizeBaseline
        return {
          canvasInDom:!!n,canvasReference:!!p._canvasNode,referenceMatchesDom:p._canvasNode===n,
          freshCanvas:!!n&&n!==window.__qaDmxOriginalCanvas,oldCanvasDetached:!window.__qaDmxOriginalCanvas?.isConnected,
          canvas:r&&{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,backingWidth:n.width,backingHeight:n.height},
          stage:{left:s.left*v.s+v.x,top:s.top*v.s+v.y,right:(s.left+s.width)*v.s+v.x,bottom:(s.top+s.height)*v.s+v.y},
          stateUnchanged:!!b&&JSON.stringify(p._scheme)===b.scheme&&JSON.stringify(p._layout)===b.layout,
          positionsUnchanged:!!b&&JSON.stringify(p._layout.positionsById)===b.positions,
          storageUnchanged:!!b&&JSON.stringify([...window.__lightingQa.storage.entries()])===b.storage,
          writesUnchanged:!!b&&window.__lightingQa.events.writes.length===b.writes,errors:window.__lightingQa.events.errors
        }
      })()`)
      assert(restored.canvasInDom && restored.canvasReference && restored.referenceMatchesDom,
        'closing settings reacquires the mounted canvas node')
      assert(restored.freshCanvas && restored.oldCanvasDetached, 'closing settings rebuilds a fresh canvas node')
      assert(restored.canvas.width > 0 && restored.canvas.height > 0, 'fresh canvas has positive dimensions')
      assert(Math.abs(restored.canvas.backingWidth - restored.canvas.width) <= 1
        && Math.abs(restored.canvas.backingHeight - restored.canvas.height) <= 1,
      'fresh canvas backing store matches its resized DOM bounds')
      assert(restored.stage.left >= -1 && restored.stage.top >= -1
        && restored.stage.right <= restored.canvas.width + 1 && restored.stage.bottom <= restored.canvas.height + 1,
      'redrawn stage remains inside the fresh resized canvas')
      assert(restored.stateUnchanged && restored.positionsUnchanged, 'settings resize and close preserve scheme and positions')
      assert(restored.storageUnchanged && restored.writesUnchanged, 'settings resize and close do not write storage')
      assert.deepEqual(restored.errors, [], 'settings resize and canvas restoration have no runtime errors')
      restored.screenshot = await capture('restored-390x844')
      return { settingsAtShortWide: shortMetrics, settingsAfterPortraitResize: portraitMetrics, restored }
    })
  } catch (error) {
    summary.cases.push({ name: 'runner', status: 'failed', error: error.stack || String(error) })
    console.error('FAIL rotation runner: ' + error.message)
  } finally {
    if (browser) {
      try { await browser.close() } catch (error) {
        summary.cases.push({ name: 'browser cleanup', status: 'failed', error: error.stack || String(error) })
      }
    }
    summary.actualExitCode = summary.cases.some((item) => item.status === 'failed') ? 1 : 0
    saveEvidence(evidenceOut, scope + '-rotation.json', summary)
    console.log('Evidence ' + path.relative(root, path.join(evidenceOut, scope + '-rotation.json')).replaceAll('\\', '/'))
    if (summary.actualExitCode) process.exitCode = 1
  }
}

module.exports = { inputManifest, evidenceDirectory, saveEvidence, runLayoutRotationChecks }

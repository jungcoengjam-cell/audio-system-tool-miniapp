'use strict'

// Shared portrait layout page placement-overlay checks in portrait and short-wide resize-pressure viewports.
const assert = require('node:assert/strict')
const path = require('node:path')
const { delay, launch } = require('./browser-driver.cjs')
const { evidenceDirectory, inputManifest, saveEvidence } = require('../helpers/dmx-layout-browser-boundaries.cjs')

const root = path.resolve(__dirname, '../..')
const scope = 'dmx-ui-round3-2026-10-18-placement-sheet'
const evidenceOut = evidenceDirectory(path.join(__dirname, 'evidence/placement-sheet'))
const inputs = inputManifest(__filename, __dirname)
const profiles = [
  { width: 390, height: 844, theme: 'light', kind: 'portrait' },
  { width: 320, height: 568, theme: 'dark', kind: 'compact portrait' },
  { width: 844, height: 390, theme: 'light', kind: 'wide resize pressure' },
  { width: 568, height: 320, theme: 'dark', kind: 'short wide resize pressure' },
]
const summary = {
  runAt: new Date().toISOString(),
  scope,
  inputHash: inputs.sha256,
  inputFiles: inputs.files,
  route: 'pages/dmx-layout/dmx-layout',
  pageOrientation: 'portrait',
  placementFooter: 'current markup has no fixed placement footer; verify the fixture list tail within its scroll viewport',
  nativeRuntime: false,
  physicalDevice: false,
  browser: null,
  screenshots: [],
  profiles,
  cases: [],
  actualExitCode: 0,
}

async function scrollToTailWithTouch(browser) {
  const read = () => browser.evaluate(`(()=>{const n=document.querySelector('.fixture-selection-list'),r=n.getBoundingClientRect();return{rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,scrollTop:n.scrollTop}})()`)
  let before = await read()
  assert(before.clientHeight > 0, 'fixture list has a visible scroll viewport ' + JSON.stringify(before))
  assert(before.scrollHeight > before.clientHeight + 80, 'fixture list is long enough to require scrolling ' + JSON.stringify(before))
  const maxScroll = before.scrollHeight - before.clientHeight
  assert(maxScroll > 0)
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  let swipes = 0
  while (before.scrollTop < maxScroll - 2 && swipes < 24) {
    const margin = Math.min(4, before.rect.height / 6)
    const x = Math.round(before.rect.x + before.rect.width / 2)
    const from = before.rect.bottom - margin
    const to = before.rect.y + margin
    const point = (y) => ({ id: 1, x, y: Math.round(y), radiusX: 1, radiusY: 1, force: 1 })
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] })
    for (let index = 1; index <= 6; index += 1) {
      await browser.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [point(from + (to - from) * index / 6)],
      })
      await delay(18)
    }
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await delay(100)
    const after = await read()
    assert(after.scrollTop > before.scrollTop, 'real touch swipe advances the fixture list ' + JSON.stringify({ before, after }))
    assert(after.scrollTop <= maxScroll + 1, 'fixture list stays within its scroll range ' + JSON.stringify(after))
    before = after
    swipes += 1
  }
  assert(before.scrollTop >= maxScroll - 2, 'repeated real touch swipes can reach the end of the fixture list ' + JSON.stringify(before))
  const tail = await browser.evaluate(`(()=>{
    const list=document.querySelector('.fixture-selection-list'),viewport=list.getBoundingClientRect(),node=list.querySelector('.fixture-list-tail'),r=node.getBoundingClientRect()
    return {scrollTop:list.scrollTop,maxScroll:list.scrollHeight-list.clientHeight,listBottom:viewport.bottom,tail:{top:r.top,bottom:r.bottom},visible:r.top>=viewport.top-1&&r.bottom<=viewport.bottom+1}
  })()`)
  assert(tail.visible, 'last list tail is visible after touch scrolling ' + JSON.stringify(tail))
  return {swipes,final:before,tail}
}

async function checkProfile(browser, profile) {
  await browser.viewport(profile.width, profile.height, profile.theme)
  await browser.navigate({ page: 'layout', theme: profile.theme, lightingContextName: encodeURIComponent('临时设置') })
  await delay(240)
  const baseline = await browser.evaluate(`(()=>{
    const p=window.__lightingQa.page
    window.__qaPlacementBaseline={
      scheme:JSON.stringify(p._scheme),layout:JSON.stringify(p._layout),positions:JSON.stringify(p._layout.positionsById),
      storage:JSON.stringify([...window.__lightingQa.storage.entries()]),writes:window.__lightingQa.events.writes.length,
      navigations:window.__lightingQa.events.navigations.length
    }
    return {theme:document.documentElement.dataset.theme,window:[innerWidth,innerHeight],fixtures:p._fixtures.length}
  })()`)
  assert.equal(baseline.theme, profile.theme, 'browser adapter uses the requested color theme')
  assert.deepEqual(baseline.window, [profile.width, profile.height])
  assert(baseline.fixtures >= 20, 'QA fixture setup provides a long placement list')

  await browser.evaluate('window.__dispatch("openPlacementPanel")')
  await delay(260)
  const metrics = await browser.evaluate(`(()=>{
    const p=window.__lightingQa.page,card=document.querySelector('.placement-card'),overlay=document.querySelector('.placement-overlay')
    const list=document.querySelector('.fixture-selection-list'),tail=list?.querySelector('.fixture-list-tail')
    const nodes={heading:card?.querySelector('.placement-heading'),overview:card?.querySelector('.rod-overview'),preview:card?.querySelector('.placement-preview-strip'),search:card?.querySelector('.placement-search'),list}
    const rect=n=>{const r=n?.getBoundingClientRect();return r&&{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
    const info=wx.getWindowInfo(),capsule=wx.getMenuButtonBoundingClientRect()
    return {
      viewport:[innerWidth,innerHeight],theme:document.documentElement.dataset.theme,
      card:rect(card),overlay:rect(overlay),parts:Object.fromEntries(Object.entries(nodes).map(([name,node])=>[name,rect(node)])),
      listScroll:list&&{clientHeight:list.clientHeight,scrollHeight:list.scrollHeight,scrollTop:list.scrollTop},tail:rect(tail),
      capsule,safeArea:info.safeArea,fixtureCount:p._fixtures.length,renderedFixtureCount:p.data.placementGroups.reduce((sum,group)=>sum+group.fixtures.length,0),
      summaryClassPresent:!!card?.querySelector('.placement-summary'),
      canvasInDom:!!document.getElementById('dmxLayoutCanvas'),canvasReference:!!p._canvasNode,
      stateUnchanged:JSON.stringify(p._scheme)===window.__qaPlacementBaseline.scheme&&JSON.stringify(p._layout)===window.__qaPlacementBaseline.layout,
      positionsUnchanged:JSON.stringify(p._layout.positionsById)===window.__qaPlacementBaseline.positions,
      storageUnchanged:JSON.stringify([...window.__lightingQa.storage.entries()])===window.__qaPlacementBaseline.storage,
      writesUnchanged:window.__lightingQa.events.writes.length===window.__qaPlacementBaseline.writes,
      navigationsUnchanged:window.__lightingQa.events.navigations.length===window.__qaPlacementBaseline.navigations,
      runtimeErrors:window.__lightingQa.events.errors
    }
  })()`)
  assert.deepEqual(metrics.viewport, [profile.width, profile.height])
  assert.equal(metrics.theme, profile.theme)
  assert(metrics.card && metrics.card.height > 0, 'placement card is visible')
  assert(metrics.card.x >= -1 && metrics.card.right <= profile.width + 1, 'placement card stays within viewport width')
  assert(metrics.card.y >= metrics.capsule.bottom + 5, 'placement card clears the simulated native capsule')
  assert(metrics.card.bottom <= metrics.safeArea.bottom + 1, 'placement card stays above the safe-area bottom')
  assert.deepEqual([metrics.overlay.x, metrics.overlay.y, metrics.overlay.right, metrics.overlay.bottom],
    [0, 0, profile.width, profile.height], 'placement overlay covers the complete viewport')
  for (const key of ['heading', 'overview', 'preview', 'search', 'list']) {
    const rect = metrics.parts[key]
    assert(rect && rect.height > 0, 'placement ' + key + ' has visible dimensions')
    assert(rect.x >= metrics.card.x - 1 && rect.right <= metrics.card.right + 1,
      'placement ' + key + ' stays inside the card horizontally ' + JSON.stringify(rect))
    assert(rect.y >= metrics.card.y - 1 && rect.bottom <= metrics.card.bottom + 1,
      'placement ' + key + ' stays inside the card vertically ' + JSON.stringify(rect))
  }
  for (const [upper, lower] of [['heading', 'overview'], ['overview', 'preview'], ['preview', 'search'], ['search', 'list']]) {
    assert(metrics.parts[upper].bottom <= metrics.parts[lower].y + 1,
      'placement ' + upper + ' does not overlap ' + lower + ' ' + JSON.stringify(metrics.parts))
  }
  assert(metrics.parts.list.y >= metrics.card.y - 1 && metrics.parts.list.bottom <= metrics.card.bottom + 1,
    'scroll body stays inside the placement card')
  assert(metrics.listScroll.clientHeight > 0 && metrics.listScroll.scrollHeight > metrics.listScroll.clientHeight + 80,
    'fixture list has a long, bounded scroll body ' + JSON.stringify(metrics.listScroll))
  assert(metrics.tail && metrics.tail.height > 0, 'the real fixture-list-tail element exists')
  assert.equal(metrics.summaryClassPresent, false, 'current placement markup has no retired fixed summary footer')
  assert.equal(metrics.canvasInDom, false, 'placement overlay unmounts the stage canvas')
  assert.equal(metrics.canvasReference, false, 'placement controller releases the stage canvas')
  assert(metrics.stateUnchanged && metrics.positionsUnchanged, 'opening placement leaves scheme and positions unchanged')
  assert(metrics.storageUnchanged && metrics.writesUnchanged, 'opening placement does not write storage')
  assert(metrics.navigationsUnchanged, 'opening placement does not navigate')
  assert.deepEqual(metrics.runtimeErrors, [], 'placement panel has no controller runtime errors')

  const scrolling = await scrollToTailWithTouch(browser)
  let screenshot = null
  if (profile.width === 568 && profile.height === 320) {
    const filename = 'placement-568x320-dark.png'
    const file = path.join(evidenceOut, filename)
    await browser.screenshot(file)
    screenshot = path.relative(root, file).replaceAll('\\', '/')
    summary.screenshots.push(screenshot)
  }
  const hit = await browser.evaluate(`(()=>{
    const node=document.elementFromPoint(4,4),r=node?.getBoundingClientRect()
    return {isOverlay:!!node?.classList.contains('placement-overlay'),tag:node?.tagName,classes:node?.className,
      rect:r&&{x:r.x,y:r.y,right:r.right,bottom:r.bottom}}
  })()`)
  assert(hit.isOverlay, 'real hit test at the clear overlay margin targets the backdrop ' + JSON.stringify(hit))
  await browser.evaluate('document.elementFromPoint(4,4).click()')
  await delay(320)
  const closed = await browser.evaluate(`(()=>{
    const p=window.__lightingQa.page,n=document.getElementById('dmxLayoutCanvas'),b=window.__qaPlacementBaseline
    return {visible:p.data.placementVisible,overlay:!!document.querySelector('.placement-overlay'),canvas:!!n,
      canvasReference:!!p._canvasNode,referenceMatchesDom:p._canvasNode===n,
      stateUnchanged:JSON.stringify(p._scheme)===b.scheme&&JSON.stringify(p._layout)===b.layout,
      positionsUnchanged:JSON.stringify(p._layout.positionsById)===b.positions,
      storageUnchanged:JSON.stringify([...window.__lightingQa.storage.entries()])===b.storage,
      writesUnchanged:window.__lightingQa.events.writes.length===b.writes,
      navigationsUnchanged:window.__lightingQa.events.navigations.length===b.navigations,
      runtimeErrors:window.__lightingQa.events.errors}
  })()`)
  assert.equal(closed.visible, false, 'real backdrop click closes placement')
  assert.equal(closed.overlay, false, 'closed placement backdrop is removed')
  assert(closed.canvas && closed.canvasReference && closed.referenceMatchesDom,
    'closing placement remounts and reacquires the real canvas')
  assert(closed.stateUnchanged && closed.positionsUnchanged, 'scrolling and closing preserve scheme and positions')
  assert(closed.storageUnchanged && closed.writesUnchanged, 'scrolling and closing do not write storage')
  assert(closed.navigationsUnchanged, 'backdrop click does not navigate')
  assert.deepEqual(closed.runtimeErrors, [], 'placement close and canvas restoration have no runtime errors')
  return { profile, metrics, scrolling, hit, closed, screenshot }
}

async function main() {
  let browser
  try {
    browser = await launch()
    const version = await browser.send('Browser.getVersion')
    summary.browser = version.product || null
    const route = JSON.parse(require('node:fs').readFileSync(path.join(root, 'app.json'), 'utf8')).pages
    assert(route.includes('pages/dmx-layout/dmx-layout'), 'browser test loads the current shared route')
    assert(!route.includes('pages/dmx-layout-landscape/dmx-layout-landscape'), 'retired landscape route stays unregistered')
    for (const profile of profiles) {
      const name = profile.kind + ' ' + profile.width + 'x' + profile.height + ' ' + profile.theme
      try {
        const details = await checkProfile(browser, profile)
        summary.cases.push({ name, status: 'passed', details })
        console.log('PASS ' + name)
      } catch (error) {
        summary.cases.push({ name, status: 'failed', error: error.stack || String(error) })
        console.error('FAIL ' + name + ': ' + error.message)
      }
    }
  } catch (error) {
    summary.cases.push({ name: 'runner', status: 'failed', error: error.stack || String(error) })
    console.error('FAIL placement runner: ' + error.message)
  } finally {
    if (browser) {
      try { await browser.close() } catch (error) {
        summary.cases.push({ name: 'browser cleanup', status: 'failed', error: error.stack || String(error) })
      }
    }
    summary.actualExitCode = summary.cases.some((item) => item.status === 'failed') ? 1 : 0
    saveEvidence(evidenceOut, 'placement-sheet.json', summary)
    console.log('Evidence ' + path.relative(root, path.join(evidenceOut, 'placement-sheet.json')).replaceAll('\\', '/'))
    if (summary.actualExitCode) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

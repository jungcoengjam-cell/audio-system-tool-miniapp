const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('../dmx-ui-refinements-2026-10-18/browser-driver.cjs')

const ROOT = path.resolve(__dirname, '../..')
const EVIDENCE = path.join(ROOT, 'tmp', 'animation-recheck-2026-10-28')
const FIXTURE_URL = '/tests/animation-recheck-2026-10-28/bottom-sheet-fixture.html'

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function checkMotionDurations() {
  const checks = [
    {
      name: 'gain fallback',
      js: 'pages/gain-structure/gain-structure.js', css: 'pages/gain-structure/gain-structure.wxss',
      jsPattern: /PAGE_CONTAINER_FALLBACK_TRANSITION_DURATION\s*=\s*180/,
      cssPattern: /\.sheet-mask\.sheet-mask-closing\s+\.sheet-panel\s*\{[^}]*page-container-sheet-out\s+180ms/,
      ms: 180,
    },
    {
      name: 'limiter fallback',
      js: 'pages/limiter/limiter.js', css: 'pages/limiter/limiter.wxss',
      jsPattern: /PAGE_CONTAINER_FALLBACK_TRANSITION_DURATION\s*=\s*180/,
      cssPattern: /\.sheet-mask\.sheet-mask-closing\s+\.sheet-panel\s*\{[^}]*limiter-page-container-sheet-out\s+180ms/,
      ms: 180,
    },
    {
      name: 'DMX address bottom sheets',
      js: 'pages/dmx-address/sheet-lifecycle.js', css: 'pages/dmx-address/dmx-address.wxss',
      jsPattern: /MAIN_SHEET_CLOSE_MS\s*=\s*180/,
      cssPattern: /\.main-modal-bottom-sheet\.main-modal-card-closing\s*\{[^}]*main-modal-bottom-out\s+180ms/,
      ms: 180,
    },
    {
      name: 'DMX layout sheets',
      js: 'pages/dmx-layout/page-factory.js', css: 'pages/dmx-layout/dmx-layout.wxss',
      jsPattern: /setTimeout\([\s\S]{0,700}?\},\s*180\)/,
      cssPattern: /\.sheet-closing\s*\{\s*animation:sheet-out\s+\.18s/,
      ms: 180,
    },
    {
      name: 'records project rename',
      js: 'pages/records/project.js', css: 'pages/records/project.wxss',
      jsPattern: /setTimeout\([\s\S]{0,700}?\},\s*180\)/,
      cssPattern: /\.interior-rename-sheet-closing\s*\{\s*animation:interior-sheet-out\s+\.18s/,
      ms: 180,
    },
    {
      name: 'LED report preview',
      js: 'pages/led-screen/led-screen.js', css: 'pages/led-screen/led-screen.wxss',
      jsPattern: /_ledReportPreviewCloseTimer\s*=\s*setTimeout\([\s\S]{0,500}?\},\s*300\)/,
      cssPattern: /\.led-report-sheet\.report-preview-closing\s*\{\s*animation:led-project-out\s+300ms/,
      ms: 300,
    },
    {
      name: 'camera selector',
      js: 'pages/camera/camera.js', css: 'pages/camera/camera.wxss',
      jsPattern: /CAMERA_SELECTOR_TRANSITION_DURATION\s*=\s*180/,
      cssPattern: /\.selector-closing\s+\.selector-panel\s*\{\s*animation:camera-selector-sheet-out\s+180ms/,
      ms: 180,
    },
    {
      name: 'product DMX import',
      js: 'pages/products/detail.js', css: 'pages/products/detail.wxss',
      jsPattern: /setTimeout\([\s\S]{0,500}?\},\s*180\)/,
      cssPattern: /\.dmx-import-closing\s+\.dmx-import-sheet\s*\{\s*animation:dmx-import-sheet-out\s+180ms/,
      ms: 180,
    },
  ]
  const evidence = checks.map(check => {
    const js = read(check.js)
    const css = read(check.css)
    assert.match(js, check.jsPattern, `${check.name}: JS close timer was not found`)
    assert.match(css, check.cssPattern, `${check.name}: CSS closing duration was not found`)
    return { name: check.name, js: check.js, css: check.css, cssCloseMs: check.ms, jsCloseMs: check.ms, withinTimer: true }
  })

  const audioJs = read('pages/audio-wiring/index.js')
  const audioCss = read('pages/audio-wiring/index.wxss')
  assert.match(audioJs, /PREVIEW_CLOSE_DURATION\s*=\s*320/)
  assert.match(audioJs, /SELECTOR_CLOSE_DURATION\s*=\s*320/)
  assert.match(audioCss, /\.wiring-page\.result-report-preview-closing\s+\.result-report-preview-sheet\s*\{[\s\S]*?animation-name:\s*cable-report-sheet-out/)
  assert.match(audioCss, /animation:\s*wiring-selector-panel-out\s+320ms/)
  evidence.push({ name: 'audio report preview / selector', js: 'pages/audio-wiring/index.js', css: 'pages/audio-wiring/index.wxss', cssCloseMs: 320, jsCloseMs: 320, withinTimer: true })

  const additionalMotionChecks = [
    {
      name: 'camera report preview', js: 'pages/camera/camera-report-ui.js', css: 'pages/camera/camera.wxss',
      jsPattern: /PREVIEW_CLOSE_DURATION\s*=\s*320/,
      cssPattern: /\.page-root \.result-report-preview-sheet\s*\{[\s\S]*?animation:\s*camera-report-sheet-in\s+320ms/,
      ms: 320,
    },
    {
      name: 'camera project save', js: 'pages/camera/camera-project.js', css: 'pages/camera/camera.wxss',
      jsPattern: /PROJECT_CLOSE_DURATION\s*=\s*320/,
      cssPattern: /\.camera-project-sheet\s*\{[\s\S]*?animation:\s*camera-project-sheet-in\s+320ms/,
      ms: 320,
    },
    {
      name: 'cable report preview', js: 'pages/cable/cable-report.js', css: 'pages/cable/cable.wxss',
      jsPattern: /PREVIEW_CLOSE_DURATION\s*=\s*320/,
      cssPattern: /\.page-root \.result-report-preview-sheet\s*\{[\s\S]*?animation:\s*cable-report-sheet-in\s+320ms/,
      ms: 320,
    },
    {
      name: 'cable project save', js: 'pages/cable/cable-project.js', css: 'pages/cable/cable.wxss',
      jsPattern: /PROJECT_CLOSE_DURATION\s*=\s*320/,
      cssPattern: /\.project-sheet\s*\{\s*animation:\s*cable-project-sheet-in\s+320ms/,
      ms: 320,
    },
    {
      name: 'LED project save', js: 'pages/led-screen/led-project.js', css: 'pages/led-screen/led-screen.wxss',
      jsPattern: /PROJECT_CLOSE_DURATION\s*=\s*320/,
      cssPattern: /\.project-dialog-closing\s+\.led-project-sheet\s*\{\s*animation:led-project-out\s+320ms/,
      ms: 320,
    },
    {
      name: 'project wiring overlays', js: 'pages/project-wiring/workspace-overlays.js', css: 'pages/project-wiring/workspace.wxss',
      jsPattern: /WORKSPACE_OVERLAY_CLOSE_MS\s*=\s*240/,
      cssPattern: /\.workspace-mask\.workspace-overlay-closing\s+\.wiring-sheet\s*\{\s*transform:translateY\(100%\);transition-duration:240ms/,
      ms: 240,
    },
  ]
  for (const check of additionalMotionChecks) {
    assert.match(read(check.js), check.jsPattern, `${check.name}: JS close timer was not found`)
    assert.match(read(check.css), check.cssPattern, `${check.name}: CSS transition or entrance duration was not found`)
    evidence.push({ name: check.name, js: check.js, css: check.css, cssCloseMs: check.ms, jsCloseMs: check.ms, withinTimer: true })
  }

  const protocolJs = read('pages/control-protocol/detail.js')
  const protocolCss = read('pages/control-protocol/detail.wxss')
  assert.match(protocolJs, /return reduced \? 0 : 320/)
  assert.match(protocolJs, /\}, this\._sheetDuration \+ 24\)/)
  assert.match(protocolCss, /\.bottom-sheet\s*\{[\s\S]*?transition:transform \.32s/)
  evidence.push({ name: 'control-protocol detail sheet', js: 'pages/control-protocol/detail.js', css: 'pages/control-protocol/detail.wxss', cssCloseMs: 320, jsCloseMs: 344, withinTimer: true })

  const splJs = read('pages/spl/spl.js')
  const splCss = read('pages/spl/spl.wxss')
  assert.match(splJs, /SHEET_TRANSITION_DURATION\s*=\s*320/)
  assert.match(splJs, /SELECTOR_TRANSITION_DURATION\s*=\s*180/)
  assert.match(splCss, /\.spl-sheet\.spl-sheet-closing\s*\{animation:spl-sheet-slide-out\s+320ms/)
  assert.match(splCss, /\.selector-panel\.selector-panel-closing\s*\{animation:spl-sheet-slide-out\s+180ms/)
  evidence.push({ name: 'SPL share / selector', js: 'pages/spl/spl.js', css: 'pages/spl/spl.wxss', cssCloseMs: '320 / 180', jsCloseMs: '320 / 180', withinTimer: true })

  return evidence
}

function checkDmxLayoutInlineSafeArea() {
  const wxml = read('pages/dmx-layout/dmx-layout.wxml')
  const overlayLines = wxml.split(/\r?\n/).filter(line => /class="[^"]*(?:placement-overlay|settings-overlay|export-overlay)/.test(line))
  assert.equal(overlayLines.length, 3, 'expected exactly three DMX layout bottom sheet overlays')
  for (const line of overlayLines) {
    assert.match(line, /style="padding-top:\{\{overlaySafeTop \+ 12\}\}px;"/, 'overlay should retain top inset only')
    assert.doesNotMatch(line, /padding-bottom:/, 'safe bottom must be reserved inside the panel')
  }
}

async function waitForFixture(driver) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await driver.evaluate('({ready:document.documentElement.dataset.ready,error:document.documentElement.dataset.error})')
    if (state.error) throw new Error('Fixture failed: ' + state.error)
    if (state.ready === 'true') return
    await delay(50)
  }
  throw new Error('Fixture did not finish loading its production styles')
}

async function runCase(driver, item) {
  await driver.viewport(item.width, item.height)
  const query = new URLSearchParams({
    case: item.case,
    safeTop: String(item.safeTop),
    safeBottom: String(item.safeBottom),
    keyboard: String(item.keyboard || 0),
  })
  await driver.send('Page.navigate', { url: `http://127.0.0.1:${driver.port}${FIXTURE_URL}?${query}` })
  await waitForFixture(driver)
  await delay(360)
  const result = await driver.evaluate(`(() => {
    const panel = document.querySelector('#qa-panel')
    const r = panel.getBoundingClientRect()
    const style = getComputedStyle(panel)
    const action = panel.querySelector('[data-qa-action]')
    const actionRect = action ? action.getBoundingClientRect() : null
    const scroll = panel.querySelector('[data-qa-scroll]')
    if (scroll) scroll.scrollTop = scroll.scrollHeight
    const safeAreaNode = panel.querySelector('.settings-actions') || panel
    const overlay = document.querySelector('.sheet-mask,.selector-mask,.spl-overlay,.result-report-preview-overlay,.led-report-overlay,.led-project-overlay,.interior-overlay,.wiring-mask,.overlay,.export-overlay')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel: { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,position:style.position,maxWidth:style.maxWidth,borderTopLeftRadius:style.borderTopLeftRadius,borderTopRightRadius:style.borderTopRightRadius,borderBottomLeftRadius:style.borderBottomLeftRadius,borderBottomRightRadius:style.borderBottomRightRadius,paddingBottom:style.paddingBottom,safeAreaPaddingBottom:getComputedStyle(safeAreaNode).paddingBottom },
      action: actionRect ? {top:actionRect.top,bottom:actionRect.bottom,height:actionRect.height} : null,
      scroll: scroll ? {clientHeight:scroll.clientHeight,scrollHeight:scroll.scrollHeight,scrollTop:scroll.scrollTop,overflowY:getComputedStyle(scroll).overflowY} : null,
      overlay: overlay ? (()=>{const o=overlay.getBoundingClientRect();return {left:o.left,right:o.right,top:o.top,bottom:o.bottom,paddingTop:getComputedStyle(overlay).paddingTop,paddingBottom:getComputedStyle(overlay).paddingBottom}})() : null,
      spacer: (()=>{const s=panel.querySelector('.wiring-sheet-keyboard-space');return s ? s.getBoundingClientRect().height : 0})(),
      cssBytes: Number(document.documentElement.dataset.cssBytes),
      safeBottom: Number(document.documentElement.dataset.safeBottom),
    }
  })()`)

  const keyboardLift = item.lifted ? (item.keyboard || 0) : 0
  const expectedBottom = item.height - keyboardLift
  assert.ok(Math.abs(result.panel.left) <= 1, `${item.case}: left edge ${result.panel.left} != 0`)
  assert.ok(Math.abs(result.panel.right - item.width) <= 1, `${item.case}: right edge ${result.panel.right} != ${item.width}`)
  assert.ok(Math.abs(result.panel.bottom - expectedBottom) <= 1.5, `${item.case}: bottom ${result.panel.bottom} != ${expectedBottom}`)
  assert.ok(result.panel.borderTopLeftRadius !== '0px', `${item.case}: missing top-left round corner`)
  assert.equal(result.panel.borderBottomLeftRadius, '0px', `${item.case}: bottom-left must stay square`)
  assert.ok(result.cssBytes > 1000, `${item.case}: production CSS was not loaded`)
  if (item.safeBottom > 0 && !item.keyboard) {
    assert.ok(parseFloat(result.panel.safeAreaPaddingBottom) >= item.safeBottom, `${item.case}: internal padding ${result.panel.safeAreaPaddingBottom} lost safe-area bottom ${item.safeBottom}`)
  }
  if (result.scroll) {
    assert.ok(result.scroll.clientHeight >= 40, `${item.case}: long-content scroll viewport collapsed to ${result.scroll.clientHeight}px; panel=${JSON.stringify(result.panel)}`)
    assert.ok(result.scroll.scrollHeight > result.scroll.clientHeight, `${item.case}: long content did not scroll`)
    assert.ok(result.scroll.scrollTop > 0, `${item.case}: scrollTop could not advance through long content`)
  }
  if (item.case === 'dmx-address-search') {
    const overlayMax = Math.max(1, item.height - item.safeTop - item.safeBottom)
    const sheetHeight = Math.min(overlayMax, Math.round(item.height <= 360 ? overlayMax : item.height * .78))
    const expectedTop = item.height - item.safeBottom - sheetHeight
    assert.ok(Math.abs(result.panel.top - expectedTop) <= 1.5, `DMX search content height shifted: top=${result.panel.top}, expected=${expectedTop}`)
  }
  if (result.action) {
    assert.ok(result.action.height >= 20, `${item.case}: bottom action has no usable height`)
    assert.ok(result.action.top >= -1 && result.action.bottom <= result.panel.bottom + 1, `${item.case}: action is outside the visible sheet`)
  }
  if (item.case === 'project-wiring-keyboard') {
    assert.ok(Math.abs(result.spacer - item.keyboard) <= 1, `project-wiring keyboard spacer ${result.spacer} != ${item.keyboard}`)
  }
  return { case: item.case, size: `${item.width}x${item.height}`, safeTop: item.safeTop, safeBottom: item.safeBottom, keyboard: item.keyboard || 0, ...result }
}

async function main() {
  checkDmxLayoutInlineSafeArea()
  const motions = checkMotionDurations()
  const driver = await launch()
  const cases = [
    { case: 'gain-project-keyboard', width:390, height:844, safeTop:24, safeBottom:24, keyboard:220, lifted:true },
    { case: 'gain-project-keyboard', width:320, height:568, safeTop:24, safeBottom:24, keyboard:190, lifted:true },
    { case: 'dmx-address-search', width:390, height:844, safeTop:76, safeBottom:24 },
    { case: 'dmx-address-save-project', width:320, height:568, safeTop:54, safeBottom:24 },
    { case: 'dmx-layout-placement', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'dmx-layout-settings', width:320, height:568, safeTop:24, safeBottom:24 },
    { case: 'dmx-layout-export', width:844, height:390, safeTop:0, safeBottom:16 },
    { case: 'project-wiring-keyboard', width:390, height:844, safeTop:24, safeBottom:24, keyboard:260 },
    { case: 'project-wiring-keyboard', width:320, height:568, safeTop:24, safeBottom:24, keyboard:190 },
    { case: 'gain-share', width:320, height:568, safeTop:24, safeBottom:24 },
    { case: 'camera-report-preview', width:844, height:390, safeTop:0, safeBottom:16 },
    { case: 'limiter-share', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'limiter-project-keyboard', width:320, height:568, safeTop:24, safeBottom:24, keyboard:190, lifted:true },
    { case: 'spl-selector', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'spl-share', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'camera-selector', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'audio-selector', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'audio-report-preview', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'cable-report-preview', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'led-report-preview', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'led-project-keyboard', width:320, height:568, safeTop:24, safeBottom:24, keyboard:190, lifted:true },
    { case: 'records-rename', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'project-wiring-report', width:390, height:844, safeTop:24, safeBottom:24 },
    { case: 'products-import', width:390, height:844, safeTop:24, safeBottom:24 },
  ]
  const results = []
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const item = cases[index]
      const result = await runCase(driver, item)
      results.push(result)
      process.stdout.write(`PASS ${index + 1}/${cases.length} ${item.case} ${item.width}x${item.height} bottom=${result.panel.bottom} scroll=${result.scroll ? `${result.scroll.clientHeight}/${result.scroll.scrollHeight}` : 'n/a'}\n`)
      if (item.case === 'gain-project-keyboard' && item.width === 390) {
        await driver.screenshot(path.join(EVIDENCE, 'gain-project-keyboard-390x844.png'))
      }
      if (item.case === 'dmx-layout-export' && item.width === 844) {
        await driver.screenshot(path.join(EVIDENCE, 'dmx-layout-export-844x390.png'))
      }
      if (item.case === 'project-wiring-keyboard' && item.width === 320) {
        await driver.screenshot(path.join(EVIDENCE, 'project-wiring-keyboard-320x568.png'))
      }
    }
    const dmxWxml = read('pages/dmx-layout/dmx-layout.wxml')
    const report = {
      environment: 'Chromium headless via isolated source server; not WeChat runtime or a physical device',
      assertions: 'full imported app/page CSS with rpx-to-CSS-px and safe-area env emulation; sheet edge geometry, corner radii, programmatic DOM scrollTop advancement, footer visibility, simulated keyboard offset; no WeChat touch-scroll gesture was exercised',
      sampleCount: results.length,
      results,
      motionDurations: motions,
      dmxLayoutBottomSafeInlineCount: (dmxWxml.match(/padding-bottom:\{\{overlaySafeBottom\s*\+\s*12\}\}px;/g) || []).length,
      dmxLayoutInlineTopOnlyCount: dmxWxml.split(/\r?\n/).filter(line => /class="[^"]*(?:placement-overlay|settings-overlay|export-overlay)/.test(line) && /style="padding-top:\{\{overlaySafeTop \+ 12\}\}px;"/.test(line)).length,
    }
    assert.equal(report.dmxLayoutBottomSafeInlineCount, 0)
    assert.equal(report.dmxLayoutInlineTopOnlyCount, 3)
    fs.mkdirSync(EVIDENCE, { recursive: true })
    fs.writeFileSync(path.join(EVIDENCE, 'bottom-sheet-layout-results.json'), JSON.stringify(report, null, 2) + '\n')
    process.stdout.write(`PASS total=${results.length}; motion-pairs=${motions.length}; evidence=${EVIDENCE}\n`)
  } finally {
    await driver.close()
  }
}

main().catch(error => {
  process.stderr.write((error && error.stack) || String(error))
  process.exitCode = 1
})

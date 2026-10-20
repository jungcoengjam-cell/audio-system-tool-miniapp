const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { launch, delay } = require('./cdp.cjs')

const here = __dirname
const repo = path.resolve(here, '../..')
const output = path.join(here, 'evidence/residual-failures-2026-10-16/touch')
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceNames = ['pages/project-wiring/workspace-ui.js', 'pages/project-wiring/workspace.wxml', 'pages/project-wiring/index.wxml', 'pages/project-wiring/workspace.wxss', 'pages/project-wiring/workspace-header.wxml']
const sourceHashes = Object.fromEntries(sourceNames.map(name => [name, sha256(path.join(repo, name))]))
const expandedLines = '.workspace-group-lines:not(.workspace-group-lines-collapsed)'

async function open(name) {
  const processDir = path.join(output, name)
  fs.mkdirSync(processDir, { recursive: true })
  process.env.WIRING_QA_EVIDENCE = processDir
  process.env.WIRING_QA_BEFORE_ROOT = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/before')
  const browser = await launch()
  await browser.viewport(390, 844, 'light', 'no-preference')
  await browser.navigate('tests/project-wiring-redesign-2026-10-16/native-browser.html?fixture=long&theme=light&sourceVersion=after')
  await waitFor(async () => (await state(browser)).data?.project)
  return browser
}

async function state(browser) { return browser.evaluate('window.__qaRefresh()') }
async function waitFor(read, timeout = 2200) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await read()
    if (value) return value
    await delay(40)
  }
  throw new Error('Timed out waiting for isolated page state')
}
async function clearTraces(browser) {
  await browser.evaluate('window.__qaEventTrace.length=0;window.__qaClearRawTouchTrace()')
  browser.clearTouchDispatchTrace()
}
async function hitAt(browser, selector, xFraction, yFraction = 0.5) {
  const rect = await browser.pointFor(selector)
  const point = { x: rect.x - rect.width / 2 + rect.width * xFraction, y: rect.y - rect.height / 2 + rect.height * yFraction }
  const hit = await browser.evaluate(`window.__qaInspectHit(${JSON.stringify(selector)},${JSON.stringify(point)})`)
  return { rect, point, hit }
}
async function routeTrace(browser) { return browser.evaluate('window.__qaEventTrace.slice()') }
async function rawTrace(browser) { return browser.evaluate('window.__qaRawTouchTrace.slice()') }
async function recordTap(browser, selector, point, name) {
  await clearTraces(browser)
  const hitBefore = await browser.evaluate(`window.__qaInspectHit(${JSON.stringify(selector)},${JSON.stringify(point)})`)
  const tap = await browser.tap(selector, { identifier: 0, point, downMs: 55, clickWaitMs: 90 })
  const after = await state(browser)
  return {
    name, selector, hitBefore, tap, cdpTouchDispatch: browser.touchDispatchTrace(),
    rawDomTouchAndClick: await rawTrace(browser), wxmlRoute: await routeTrace(browser),
    after: { projectPickerVisible: after.data.projectPickerVisible, newProjectVisible: after.data.newProjectVisible,
      detailVisible: after.data.detailVisible, workspaceTab: after.data.workspaceTab,
      modalCount: after.events.modals.length, dataRevision: after.data.project?.wiringSchedule?.revision }
  }
}

async function visibleRows(browser) {
  await browser.tap('[data-tab="lines"]', { identifier: 0 })
  await waitFor(async () => (await state(browser)).data.workspaceTab === 'lines')
  const snapshot = await state(browser)
  if (!snapshot.data.groups.some(group => !group.collapsed && group.lines.length)) {
    await browser.tap('.workspace-group-header', { identifier: 0 })
    await waitFor(async () => (await state(browser)).data.groups.some(group => !group.collapsed && group.lines.length))
  }
  return state(browser)
}

async function portCellDiagnosis() {
  const browser = await open('port-pan-y')
  try {
    await visibleRows(browser)
    const selector = `${expandedLines} .workspace-port-cell`
    const map = []
    for (const fraction of [0.12, 0.5, 0.88]) map.push(await hitAt(browser, selector, fraction))
    const box = await browser.pointFor(selector)
    const start = { x: box.x, y: box.y }
    const beforeCss = await browser.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});const r=c?.closest('.workspace-swipe-row');return{scrollLeft:c?.scrollLeft,scrollWidth:c?.scrollWidth,clientWidth:c?.clientWidth,cellTouchAction:c&&getComputedStyle(c).touchAction,rowTouchAction:r&&getComputedStyle(r).touchAction,cellRect:c&&(()=>{const b=c.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}})()}})()`)
    await browser.screenshot(path.join(output, 'port-before-pan-y-override.png'))

    async function swipeAt(label) {
      await clearTraces(browser)
      const touch = await browser.swipe(selector, -120, 0, 300, 5, { identifier: 0, point: start })
      const snapshot = await state(browser)
      const afterCss = await browser.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});return{scrollLeft:c?.scrollLeft,scrollWidth:c?.scrollWidth,clientWidth:c?.clientWidth}})()`)
      return { label, expected: { routedMethods: ['onSwipeScrollTouchStart', 'onSwipeScrollTouchMove', 'onSwipeScrollTouchEnd', 'onPortCellScroll'], scrollLeftGreaterThan: 0 }, input: { start, delta: { x: -120, y: 0 }, durationMs: 300, samples: 5 }, touch,
        cdpTouchDispatch: browser.touchDispatchTrace(), rawDomTouch: await rawTrace(browser), wxmlRoute: await routeTrace(browser),
        after: { css: afterCss, detailVisible: snapshot.data.detailVisible, lineCount: snapshot.data.groups.flatMap(group => group.lines).length } }
    }
    const baseline = await swipeAt('production CSS with row touch-action pan-y')
    const override = await browser.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});const r=c?.closest('.workspace-swipe-row');if(c)c.scrollLeft=0;if(r)r.style.touchAction='auto';return{cellTouchAction:c&&getComputedStyle(c).touchAction,rowInlineTouchAction:r?.style.touchAction,rowTouchAction:r&&getComputedStyle(r).touchAction}})()`)
    await browser.screenshot(path.join(output, 'port-after-pan-y-removed.png'))
    const experimental = await swipeAt('test-only inline row touch-action:auto; same start coordinate and gesture')
    const restored = await browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.closest('.workspace-swipe-row');if(r)r.style.removeProperty('touch-action');return{rowTouchAction:r&&getComputedStyle(r).touchAction}})()`)
    return { source: { ...sourceHashes, reference: 'active source hashes captured at runner start' }, selector,
      visibleHitMap: map, sameGesture: { start, delta: { x: -120, y: 0 }, durationMs: 300, samples: 5 },
      beforeCss, baseline, testOnlyOverride: { set: override, result: experimental, restored },
      interpretation: 'The touch-action comparison is a Chromium fixture probe only; no production CSS was edited.' }
  } finally { await browser.close() }
}

async function collapsedGroupHitDiagnosis() {
  const browser = await open('collapsed-group-hit')
  try {
    await visibleRows(browser)
    let before = await state(browser)
    const first = before.data.groups[0]
    if (!first) throw Error('Long fixture has no line groups')
    if (first.collapsed) {
      await browser.tap('.workspace-group-header')
      await waitFor(async () => !(await state(browser)).data.groups[0].collapsed)
    }
    const expanded = await state(browser)
    await clearTraces(browser)
    const groupHeaderTap = await browser.tap('.workspace-group-header', { identifier: 0 })
    const collapsed = await waitFor(async () => {
      const snapshot = await state(browser)
      return snapshot.data.groups[0].collapsed ? snapshot : null
    })
    const hiddenSelector = '.workspace-group-lines-collapsed .workspace-port-cell'
    const legacyRectProbe = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(hiddenSelector)});if(!n)return null;const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y),s=getComputedStyle(n);return{rect:{x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom},oldCheckWouldAccept:Boolean(r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'),oldPoint:{x,y},actualHit:hit?{tag:hit.tagName.toLowerCase(),id:hit.id||null,className:typeof hit.className==='string'?hit.className:null}:null}})()`)
    const hiddenInspection = await browser.inspectTarget(hiddenSelector, legacyRectProbe?.oldPoint)
    let guardedNegative = { rejected: false, error: null }
    try { await browser.assertPoint(hiddenSelector, legacyRectProbe.oldPoint) }
    catch (error) { guardedNegative = { rejected: true, error: error.message } }
    let genericGuard = { rejected: false, error: null }
    try { await browser.pointFor(hiddenSelector, { timeoutMs: 600, sampleMs: 45 }) }
    catch (error) { genericGuard = { rejected: true, error: error.message } }
    const afterCollapseState = await state(browser)
    const available = afterCollapseState.data.groups.find((group, index) => index > 0 && !group.collapsed && group.lines.length) || afterCollapseState.data.groups.find(group => !group.collapsed && group.lines.length)
    if (!available) {
      await browser.tap('.workspace-group-header', { identifier: 0 })
      await waitFor(async () => (await state(browser)).data.groups.some(group => !group.collapsed && group.lines.length))
    }
    const visibleSelector = '.workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-port-cell'
    const safePoint = await browser.pointFor(visibleSelector)
    const hitMap = []
    for (const fraction of [0.12, 0.5, 0.88]) {
      const point = { x: safePoint.rect.left + safePoint.width * fraction, y: safePoint.y }
      hitMap.push({ fraction, point, inspection: await browser.inspectTarget(visibleSelector, point) })
    }
    await clearTraces(browser)
    const swipe = await browser.swipe(visibleSelector, -120, 0, 300, 5, {
      identifier: 0, point: safePoint,
      observeExpression: `(()=>{const n=document.querySelector(${JSON.stringify(visibleSelector)});return{left:n?.scrollLeft,width:n?.scrollWidth,client:n?.clientWidth}})()`
    })
    const after = await state(browser)
    const metrics = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(visibleSelector)});return n&&{left:n.scrollLeft,width:n.scrollWidth,client:n.clientWidth}})()`)
    const routes = await routeTrace(browser)
    const raw = await rawTrace(browser)
    const reached = routes.some(item => item.type === 'touchstart' && item.method === 'onSwipeScrollTouchStart') && routes.some(item => item.type === 'touchend' && item.method === 'onSwipeScrollTouchEnd')
    return {
      expected: { collapsedHiddenNodeRejected: true, visibleNodeHitAtSeveralPoints: true, sameGestureRoutesScrollHandlers: true, scrollLeftGreaterThan: 0 },
      sequence: { openedLinesTab: true, beforeGroup: { key: first.key, collapsed: expanded.data.groups[0].collapsed }, collapseTap: groupHeaderTap, afterGroup: { key: collapsed.data.groups[0].key, collapsed: collapsed.data.groups[0].collapsed } },
      negativeHiddenTarget: { selector: hiddenSelector, legacyRectProbe, geometryAndHit: hiddenInspection, assertPointRejected: guardedNegative, pointForRejected: genericGuard, classification: legacyRectProbe?.oldCheckWouldAccept && hiddenInspection?.visibleRect?.width === 0 ? 'stale-DOM child has positive box but zero clipped intersection; previous own-rect-only pointFor could accept it' : 'hidden target was not reproduced with positive own box' },
      positiveVisiblePath: { selector: visibleSelector, safePoint, multiPointHitMap: hitMap, gesture: { dx: -120, dy: 0, durationMs: 300, samples: 5 }, swipe, cdpTouchDispatch: browser.touchDispatchTrace(), rawDomTouch: raw, wxmlRoute: routes, scrollMetrics: metrics, detailVisible: after.data.detailVisible, passed: reached && metrics?.left > 0 },
      sourceHashes
    }
  } finally { await browser.close() }
}

async function deleteDiagnosis(fraction, label) {
  const name = `line-delete-${label}`
  const browser = await open(name)
  try {
    await visibleRows(browser)
    const rowSelector = `${expandedLines} .workspace-line-row`
    const row = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(rowSelector)});return n&&{id:n.dataset.id,rowClass:n.className}})()`)
    if (!row) throw Error('No visible line row in isolated fixture')
    const rowBox = await browser.pointFor(rowSelector)
    const swipeStart = { x: rowBox.x - rowBox.width / 2 + 32, y: rowBox.y }
    await clearTraces(browser)
    const swipe = await browser.swipe(rowSelector, -180, 0, 360, 6, { identifier: 0, point: swipeStart })
    await waitFor(async () => {
      const snapshot = await state(browser)
      const line = snapshot.data.groups.flatMap(group => group.lines).find(item => item.id === row.id)
      return line?.swipeOpen === true
    }, 1600)
    await delay(250)
    const deleteSelector = `${expandedLines} .workspace-line-swipe-row[data-swipe-id="${row.id}"] .workspace-swipe-delete`
    const swipeDispatch = browser.touchDispatchTrace(), swipeRawDom = await rawTrace(browser), swipeWxmlRoute = await routeTrace(browser)
    const points = []
    for (const xFraction of [0.12, 0.5, 0.88]) points.push(await hitAt(browser, deleteSelector, xFraction))
    if (label === 'center') await browser.screenshot(path.join(output, 'line-delete-after-reveal.png'))
    const point = hitAtIndex(points, fraction)
    const tap = await recordTap(browser, deleteSelector, point.point, label)
    return { source: sourceHashes, row, rowSelector, swipeStart, swipe,
      swipeDispatch, swipeRawDom, swipeWxmlRoute,
      expected: { openSwipeBeforeDeleteTap: true, deleteTapMethods: ['onSwipeActionTouchStart', 'onSwipeActionTouchEnd', 'deleteWorkspaceRecord'], modalCountIncrease: true },
      afterSwipe: await state(browser).then(snapshot => ({
        line: snapshot.data.groups.flatMap(group => group.lines).find(item => item.id === row.id),
        modalCount: snapshot.events.modals.length
      })), deleteSelector, buttonHitMap: points, tap, chosenPoint: point,
      note: 'Each button-position sample uses a fresh isolated session and the same row swipe gesture; only the red Delete control point varies.' }
  } finally { await browser.close() }
}

function hitAtIndex(points, fraction) {
  return points.find(item => Math.abs(item.point.x - (points[0].rect.x - points[0].rect.width / 2 + points[0].rect.width * fraction)) < 1) || points[1]
}

async function projectPickerDiagnosis(fraction, label) {
  const browser = await open(`project-picker-${label}`)
  try {
    const selector = '.workspace-project-button'
    const chosen = await hitAt(browser, selector, fraction)
    await browser.screenshot(path.join(output, `picker-before-${label}.png`))
    const tap = await recordTap(browser, selector, chosen.point, label)
    return { source: sourceHashes, selector, expected: { routeMethod: 'requestProjectPicker', visibleAfterTap: true }, visibleHitMap: chosen, tap,
      note: 'Each probe starts from a fresh isolated session; only the visible button point varies.' }
  } finally { await browser.close() }
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const run = {
    generatedAt: new Date().toISOString(),
    scope: 'Read-only hit-test and touch-route diagnostics over isolated Chromium sessions. No controller calls, production edits, WeChat auth, or app-data writes.',
    sourceHashes,
    adapterHashes: Object.fromEntries(['browser.js', 'cdp.cjs', 'browser-server.cjs', 'runtime.cjs'].map(name => [name, sha256(path.join(here, name))])),
    portCell: await portCellDiagnosis(),
    collapsedGroupHit: await collapsedGroupHitDiagnosis(),
    lineDelete: await Promise.all([[0.12, 'left'], [0.5, 'center'], [0.88, 'right']].map(([fraction, label]) => deleteDiagnosis(fraction, label))),
    projectPicker: await Promise.all([[0.12, 'left'], [0.5, 'center'], [0.88, 'right']].map(([fraction, label]) => projectPickerDiagnosis(fraction, label)))
  }
  fs.writeFileSync(path.join(output, 'residual-touch-diagnosis.json'), JSON.stringify(run, null, 2))
  const result = {
    output: path.join(output, 'residual-touch-diagnosis.json'),
    port: { baselineRoute: run.portCell.baseline.wxmlRoute.map(item => `${item.type}:${item.method}`),
      baselineScrollLeft: run.portCell.baseline.after.css.scrollLeft, panYRemovedScrollLeft: run.portCell.testOnlyOverride.result.after.css.scrollLeft },
    collapsedGroup: { oldOwnRectAccepted: run.collapsedGroupHit.negativeHiddenTarget.legacyRectProbe?.oldCheckWouldAccept, hiddenIntersection: run.collapsedGroupHit.negativeHiddenTarget.geometryAndHit?.visibleRect, guardedNegative: run.collapsedGroupHit.negativeHiddenTarget.assertPointRejected.rejected, pointForNegative: run.collapsedGroupHit.negativeHiddenTarget.pointForRejected.rejected, positiveRoutes: run.collapsedGroupHit.positiveVisiblePath.wxmlRoute.map(item => `${item.type}:${item.method}`), scrollLeft: run.collapsedGroupHit.positiveVisiblePath.scrollMetrics?.left, passed: run.collapsedGroupHit.positiveVisiblePath.passed },
    delete: run.lineDelete.map(item => ({ point: item.chosenPoint.point, hit: item.tap.hitBefore.actualHit?.className, route: item.tap.wxmlRoute.map(route => `${route.type}:${route.method}`), modalCount: item.tap.after.modalCount })),
    picker: run.projectPicker.map(item => ({ point: item.visibleHitMap.point, hit: item.tap.hitBefore.actualHit?.className, route: item.tap.wxmlRoute.map(route => `${route.type}:${route.method}`), visible: item.tap.after.projectPickerVisible }))
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

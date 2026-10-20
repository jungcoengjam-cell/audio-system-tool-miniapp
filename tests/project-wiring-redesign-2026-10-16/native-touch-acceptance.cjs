const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const here = __dirname
const repo = path.resolve(here, '../..')
const evidenceRoot = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/native-touch')
const beforeRoot = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/before')
const { launch, delay } = require('./cdp.cjs')

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function sourcePath(phase, relative) {
  if (phase === 'before' && ['index.wxml', 'workspace-ui.js', 'workspace.wxml', 'workspace.wxss'].includes(path.basename(relative))) return path.join(beforeRoot, path.basename(relative))
  return path.join(repo, relative)
}
function sourceNames() {
  return ['app.wxss', 'styles/theme-page-shared.wxss', 'utils/project-wiring.js', 'utils/records.js',
    ...fs.readdirSync(path.join(repo, 'pages/project-wiring')).filter(name => /\.(?:js|wxml|wxss)$/.test(name)).map(name => `pages/project-wiring/${name}`)].sort()
}
function expectedSources(phase) {
  return Object.fromEntries(sourceNames().map(name => [name, sha256(sourcePath(phase, name))]))
}
function bindings(phase) {
  const files = phase === 'before'
    ? ['pages/project-wiring/index.wxml', 'pages/project-wiring/workspace.wxml']
    : ['pages/project-wiring/index.wxml', 'pages/project-wiring/workspace.wxml', 'pages/project-wiring/workspace-header.wxml']
  const found = []
  const matcher = /\b(bind|catch)(tap|touchstart|touchmove|touchend|touchcancel|input|confirm|change|scroll|focus|blur|keyboardheightchange)\s*=\s*["']([^"']+)["']/g
  for (const file of files) {
    const text = fs.readFileSync(sourcePath(phase, file), 'utf8')
    let match
    while ((match = matcher.exec(text))) {
      const before = text.slice(0, match.index)
      found.push({ file, line: before.split('\n').length, kind: match[1], event: match[2], method: match[3] })
    }
  }
  return found
}

async function main() {
  const requestedPhase = process.argv.find(arg => arg.startsWith('--phase='))?.split('=')[1] || 'both'
  const phases = requestedPhase === 'both' ? ['before', 'after'] : [requestedPhase]
  if (phases.some(phase => !['before', 'after'].includes(phase))) throw Error('Use --phase=before, --phase=after, or --phase=both')
  const results = []
  for (const phase of phases) results.push(await runPhase(phase, bindings(phase)))
  const checkerPath = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/runtime-semantics/official-binder-check.json')
  const wccPath = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/runtime-semantics/compiled.txt')
  const afterHandlers = bindings('after')
  const summary = {
    generatedAt: new Date().toISOString(),
    scope: 'Touch-driven Chromium adapter checks with actual WXML binding routes and in-memory wx mocks; not WeChat runtime or physical-device acceptance.',
    sourceUnitEvidence: {
      checker: 'tests/project-wiring-redesign-2026-10-16/evidence/native-acceptance-fix-2026-10-16/runtime-semantics/official-binder-check.json',
      checkerSha256: fs.existsSync(checkerPath) ? sha256(checkerPath) : null,
      officialWccOutput: 'tests/project-wiring-redesign-2026-10-16/evidence/native-acceptance-fix-2026-10-16/runtime-semantics/compiled.txt',
      officialWccOutputSha256: fs.existsSync(wccPath) ? sha256(wccPath) : null,
      classification: 'SOURCE-UNIT only; not native page or device proof.'
    },
    nativeRuntime: {
      attempted: true,
      result: 'Native CLI opened an isolated Temp fixture using touristappid. The read-only wechatide automation_runtime_info request stopped at toolCall:auth; no page query or touch action ran.',
      productionProjectOpened: false,
      fixtureStorage: 'Tiny generic event fixture only; no production data or account records.'
    },
    controls: afterHandlers,
    phases: results,
    limitations: [
      'CDP touch input is synthesized by Chromium; it does not prove WeChat device behavior.',
      'wx storage, modal response, picker, canvas export, save/share APIs are isolated mocks or browser adapters.',
      'Animation frames are not accepted as native proof. A keyed DOM patch preserves target identity for adapter gestures but browser CSS timing remains separate evidence.',
      'Controls that require error, empty, permission, keyboard-height, or system-navigation conditions are listed in the handler inventory and remain unexercised unless noted in a phase.'
    ]
  }
  const outputDir = evidenceRoot
  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, 'native-touch-acceptance.json')
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ outputPath, phases: results.map(({ phase, checks }) => ({ phase, checks: checks.length, failures: checks.filter(check => !check.passed).length })), handlers: new Set(afterHandlers.map(item => item.method)).size }, null, 2))
  if (results.some(result => result.checks.some(check => !check.passed))) process.exitCode = 1
}

async function runPhase(phase, declared) {
  const phaseEvidence = path.join(evidenceRoot, phase)
  fs.mkdirSync(phaseEvidence, { recursive: true })
  process.env.WIRING_QA_EVIDENCE = phaseEvidence
  process.env.WIRING_QA_BEFORE_ROOT = beforeRoot
  const browser = await launch()
  const checks = []
  const record = async (name, task, expected = true) => {
    try {
      const evidence = await task()
      const passed = Boolean(expected ? evidence?.pass : !evidence?.pass)
      checks.push({ name, passed, expectation: expected ? 'pass' : 'expected negative', evidence })
      console.log(`${passed ? 'PASS' : 'FAIL'} [${phase}] ${name}`)
      return evidence
    } catch (error) {
      checks.push({ name, passed: false, expectation: expected ? 'pass' : 'expected negative', error: error.stack })
      console.error(`FAIL [${phase}] ${name}: ${error.message}`)
      return { pass: false, error: error.message }
    }
  }
  // Pull a read-only server snapshot so real runtime timers become visible in
  // the browser adapter without dispatching a page/controller method.
  const state = () => browser.evaluate('window.__qaRefresh()')
  const trace = () => browser.evaluate('window.__qaEventTrace.slice()')
  const clearTrace = () => browser.evaluate('window.__qaEventTrace.length = 0')
  const mark = async () => (await trace()).length
  const since = async index => (await trace()).slice(index)
  const tap = async selector => browser.tap(selector, { identifier: 0, downMs: 45, clickWaitMs: 75 })
  const focusTextInput = async selector => {
    const point = await browser.pointFor(selector)
    // CDP touch synthesizes the tap route but does not focus text controls in
    // headless Chrome. Use CDP pointer input only for IME focus; text still
    // enters through the normal keyboard/input event route.
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  }
  const waitFor = async (predicate, timeout = 1800) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const value = await predicate()
      if (value) return value
      await delay(40)
    }
    throw Error('Timed out waiting for UI state')
  }
  const routeEvidence = async (selector, method) => {
    await clearTrace()
    const before = await mark()
    await tap(selector)
    const routed = (await since(before)).filter(item => item.method === method && item.type === 'tap')
    return { pass: routed.length > 0 && routed.some(item => item.nativeInput === 'synthesized-touch-tap'), routed, all: await trace() }
  }
  try {
    await browser.viewport(390, 844, 'light', 'no-preference')
    const query = new URLSearchParams({ fixture: 'long', theme: 'light', sourceVersion: phase === 'before' ? 'before' : 'after' })
    await browser.navigate(`tests/project-wiring-redesign-2026-10-16/native-browser.html?${query}`)
    await waitFor(async () => (await state()).data?.project)
    const initial = await state()
    const sessionMethods = new Set(initial.methods)
    const inventory = declared.map(binding => ({ ...binding, methodPresent: sessionMethods.has(binding.method) }))
    const expectedHashes = expectedSources(phase)
    const loadedHashes = initial.sources || {}
    const mismatches = Object.keys(expectedHashes).filter(name => loadedHashes[name] !== expectedHashes[name])
    const missingBindings = inventory.filter(item => !item.methodPresent)
    checks.push({ name: 'WXML handlers declared by this phase source map to loaded page methods', passed: missingBindings.length === 0 && mismatches.length === 0, evidence: { missing: missingBindings, declaredOccurrences: inventory.length, uniqueHandlers: new Set(inventory.map(item => item.method)).size, loadedSourceHashMismatches: mismatches, expectedSourceHashes: expectedHashes, actualLoadedSourceHashes: loadedHashes } })

    await record('device tab touch emits WXML tap with native target/currentTarget data', async () => {
      await clearTrace(); const start = await mark(); await tap('[data-tab="devices"]')
      const entries = (await since(start)).filter(item => item.method === 'onWorkspaceTab' && item.type === 'tap')
      const session = await state()
      return { pass: session.data.workspaceTab === 'devices' && entries.some(item => item.nativeInput === 'synthesized-touch-tap' && item.target.dataset.tab === 'devices' && item.currentTarget.dataset.tab === 'devices'), state: session.data.workspaceTab, entries }
    })
    await record('device-name horizontal swipe reaches nested scroll handlers without opening a device', async () => {
      const before = await state(); const swipe = await browser.swipe('.workspace-device-name-scroll', -72, 0, 280, 5, { identifier: 0, observeExpression: "({tab:window.__wiringQa.session.data.workspaceTab,open:window.__wiringQa.session.data.devices.some(device=>device.swipeOpen),offset:window.__wiringQa.session.data.devices[0]?.swipeOffset})" })
      const after = await state(); const routed = swipe.result?.trace || []
      return { pass: after.data.workspaceTab === 'devices' && !after.data.deviceEditorVisible && routed.some(item => item.method === 'onSwipeScrollTouchStart' && item.type === 'touchstart') && routed.some(item => item.method === 'onSwipeScrollTouchEnd' && item.type === 'touchend'), beforeTab: before.data.workspaceTab, afterTab: after.data.workspaceTab, observations: swipe.observations, routeMethods: routed.map(item => [item.type, item.method, item.catch]) }
    })
    await record('add device opens by touch, type/count controls route, and isolated save closes editor', async () => {
      await tap('.workspace-bottom-bar .workspace-primary-button')
      await waitFor(async () => (await state()).data.deviceEditorVisible)
      await clearTrace(); await tap('.workspace-type-tile[data-type="speaker"]')
      const tileState = await state(); const typeRoutes = (await trace()).filter(item => item.method === 'onDeviceType')
      await tap('.workspace-step-button[data-delta="1"]')
      const countState = await state()
      const name = 'Luna QA speaker'
      await browser.tap('#wiring-device-name', { identifier: 0 })
      await focusTextInput('#wiring-device-name')
      await browser.send('Input.insertText', { text: name })
      await waitFor(async () => (await state()).data.deviceDraft.name.includes(name))
      await tap('.workspace-device-sheet .workspace-sheet-save')
      await waitFor(async () => !(await state()).data.deviceEditorVisible, 2000)
      const session = await state()
      return { pass: typeRoutes.length > 0 && tileState.data.deviceDraft.type === 'speaker' && countState.data.deviceDraft.count >= 2 && session.data.devices.some(device => device.name.includes(name)) && session.events.writes.some(write => write.key === 'audioTool.projects.v1'), typeRoutes, count: countState.data.deviceDraft.count, deviceCount: session.data.devices.length, storageIsRuntimeMock: true }
    })
    await record('device Delete after reveal receives a fresh tap and removes the intended fixture row', async () => {
      const session = await state(), device = session.data.devices.find(item => item.name.includes('Luna QA speaker'))
      if (!device) throw Error('Newly saved test device was not present')
      const rowSelector = `.workspace-device-swipe-row[data-swipe-id="${device.id}"]`
      const rowBox = await browser.pointFor(rowSelector)
      const iconStart = { ...rowBox, x: rowBox.x - rowBox.width / 2 + 32 }
      const swipe = await browser.swipe(rowSelector, -180, 0, 360, 6, { identifier: 0, point: iconStart })
      await delay(240)
      const modalCountBefore = (await state()).events.modals.length
      await clearTrace(); const start = await mark()
      let deleteTapError = null
      try { await tap(`${rowSelector} .workspace-swipe-delete`) } catch (error) { deleteTapError = error.message }
      const events = await since(start), withModal = await state()
      const deleteTap = events.find(item => item.method === 'deleteWorkspaceRecord' && item.type === 'tap')
      const deleteStart = events.find(item => item.method === 'onSwipeActionTouchStart' && item.type === 'touchstart')
      const rowEnd = events.find(item => item.method === 'onSwipeTouchEnd' && item.type === 'touchend')
      const modal = withModal.events.modals.length > modalCountBefore
      const modalResponse = modal ? await browser.evaluate('window.__qaAction("modal", null, {confirm:true})') : null
      const immediate = modal ? await state() : null
      let removalObserved = false
      if (modal) { try { await waitFor(async () => !(await state()).data.devices.some(item => item.id === device.id), 2600); removalObserved = true } catch {} }
      const final = await state(), removed = !final.data.devices.some(item => item.id === device.id)
      const storedProject = final.storage['audioTool.projects.v1']?.find(item => item.id === final.data.project?.id)
      const storedDevicePresent = Boolean(storedProject?.wiringSchedule?.devices?.some(item => item.id === device.id))
      const deleteEnd = events.find(item => item.method === 'onSwipeActionTouchEnd' && item.type === 'touchend')
      const endRouteObserved = Boolean(rowEnd || deleteEnd)
      return { pass: Boolean(modal && deleteTap?.currentTarget?.dataset?.id === device.id && deleteStart && endRouteObserved && removed && !storedDevicePresent), deviceId: device.id, deleteTargetChildDataset: deleteTap?.target?.dataset, deleteCurrentTargetDataset: deleteTap?.currentTarget?.dataset, rowEndReceived: Boolean(rowEnd), buttonEndReceived: Boolean(deleteEnd), endRouteClassification: rowEnd ? 'touchend propagated to swipe row' : deleteEnd ? 'button catchtouchend handled locally; not propagated' : 'no touchend handler observed', swipeOffset: swipe.observations.at(-1)?.observation?.offset ?? null, deleteTap, deleteTapError, touchEvents: events.map(item => ({ method: item.method, type: item.type, target: item.target, currentTarget: item.currentTarget })), modal, immediateAfterConfirmation: { saving: immediate?.data?.saving, retiringRow: immediate?.data?.workspaceRetiringRow, rowStillRendered: immediate?.data?.devices?.some(item => item.id === device.id), persistedDevicePresent: Boolean(immediate?.storage?.['audioTool.projects.v1']?.find(item => item.id === immediate.data.project?.id)?.wiringSchedule?.devices?.some(item => item.id === device.id)) }, final: { removedFromData: removed, persistedDevicePresent: storedDevicePresent, revision: final.data.project?.wiringSchedule?.revision, retiringRow: final.data.workspaceRetiringRow }, removalObserved, modalResponse: { saving: modalResponse?.data?.saving, revision: modalResponse?.data?.project?.wiringSchedule?.revision }, result: 'in-memory modal confirmation followed by persisted schedule delete and timed row cleanup' }
    })

    await record('line tab touch reaches handler and group tap changes collapsed state', async () => {
      await tap('[data-tab="lines"]'); await waitFor(async () => (await state()).data.workspaceTab === 'lines')
      const beforeState = await state(), beforeCollapsed = beforeState.data.groups[0].collapsed
      await clearTrace(); const start = await mark(); await tap('.workspace-group-header')
      const afterState = await state(), events = await since(start)
      const toggle = events.filter(item => item.method === 'toggleGroup' && item.type === 'tap')
      const pass = afterState.data.groups[0].collapsed !== beforeCollapsed && toggle.some(item => item.nativeInput === 'synthesized-touch-tap' && item.currentTarget.dataset.key === beforeState.data.groups[0].key)
      return { pass, beforeCollapsed, afterCollapsed: afterState.data.groups[0].collapsed, activeGroupKey: beforeState.data.groups[0].key, events }
    }, phase === 'after')

    await record('horizontal port scroll is isolated from line selection, followed by an intentional row tap', async () => {
      let group = (await state()).data.groups.find(item => !item.collapsed)
      if (!group) {
        await tap('.workspace-group-header')
        group = (await state()).data.groups.find(item => !item.collapsed)
      }
      await clearTrace()
      const expandedLines = '.workspace-group-lines:not(.workspace-group-lines-collapsed)'
      const portSelector = `${expandedLines} .workspace-port-cell`
      const port = await browser.pointFor(portSelector)
      const swipe = await browser.swipe(portSelector, -120, 0, 300, 5, { identifier: 0, point: port })
      const afterSwipe = await state(), swipeEvents = swipe.result?.trace || []
      const metrics = await browser.evaluate('(()=>{const n=document.querySelector(".workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-port-cell");return n&&{left:n.scrollLeft,width:n.scrollWidth,client:n.clientWidth}})()')
      const noDetailFromDrag = !afterSwipe.data.detailVisible
      const visibleRow = `${expandedLines} .workspace-line-row`
      const rowBox = await browser.pointFor(visibleRow)
      await browser.tap(visibleRow, { identifier: 0, point: { ...rowBox, x: rowBox.x - rowBox.width / 2 + 32 } })
      const detail = await (async () => { try { await waitFor(async () => (await state()).data.detailVisible, 700); return true } catch { return false } })()
      const intentionalTap = (await trace()).some(item => item.method === 'onLineTap' && item.type === 'tap' && item.nativeInput === 'synthesized-touch-tap')
      if (detail) {
        await tap('.workspace-detail-sheet .workspace-close-button')
        await waitFor(async () => !(await state()).data.detailVisible, 700)
        await delay(260)
      }
      return { pass: Boolean(noDetailFromDrag && intentionalTap && swipeEvents.some(item => item.method === 'onPortCellScroll' || item.method === 'onSwipeScrollTouchStart') && metrics && metrics.width >= metrics.client), noDetailFromDrag, scrollMetrics: metrics, swipeObservations: swipe.observations, swipeMethods: [...new Set(swipeEvents.map(item => item.method))], intentionalTap, closeDetailRouted: (await trace()).some(item => item.method === 'closeLineDetails' && item.type === 'tap') }
    })

    await record('horizontal row swipe tracks progressive offsets and stays below tap threshold', async () => {
      let group = (await state()).data.groups.find(item => !item.collapsed)
      if (!group?.lines.length) {
        const collapsed = (await state()).data.groups.find(item => item.collapsed)
        if (collapsed) { await tap('.workspace-group-header'); await delay(40) }
        group = (await state()).data.groups.find(item => !item.collapsed)
      }
      if (!group?.lines.length) throw Error('No expanded line group')
      const row = await browser.evaluate('(()=>{const n=document.querySelector(".workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-line-row");return n&&{id:n.dataset.id}})()')
      if (!row) throw Error('No row in the currently expanded group')
      const rowSelector = `.workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-line-row[data-id="${row.id}"]`
      await clearTrace()
      const box = await browser.pointFor(rowSelector)
      const circleStart = { ...box, x: box.x - box.width / 2 + 32 }
      const hitAtDispatch = await browser.inspectTarget(rowSelector, circleStart)
      const swipe = await browser.swipe(rowSelector, -180, 0, 360, 6, { identifier: 0, point: circleStart, observeExpression: `(()=>{const r=window.__wiringQa.session.data.groups.flatMap(g=>g.lines).find(x=>x.id===${JSON.stringify(row.id)});return {offset:r?.swipeOffset,open:r?.swipeOpen,dragging:r?.swipeDragging}})()` })
      const rawTouch = await browser.evaluate('window.__qaRawTouchTrace.slice()')
      await delay(240)
      const session = await state(), events = swipe.result?.trace || []
      const line = session.data.groups.flatMap(item => item.lines).find(item => item.id === row.id)
      const click = events.some(item => item.method === 'onLineTap' && item.type === 'tap')
      return { pass: Boolean(line && line.swipeOffset > 30 && line.swipeOpen && !click && swipe.observations.some(item => Number(item.observation?.offset) > 0)), rowId: row.id, rowSelector, hitAtDispatch, cdpTouchDispatch: browser.touchDispatchTrace(), rawDomTouch: rawTouch, finalOffset: line?.swipeOffset, swipeOpen: line?.swipeOpen, observations: swipe.observations, sequence: events.map(item => ({ method: item.method, type: item.type, target: item.target, currentTarget: item.currentTarget })) }
    })

    await record('identifier 0 is reusable after a completed drag when a fresh touchstart begins', async () => {
      await clearTrace(); const before = await state()
      const events = await browser.tap('[data-tab="devices"]', { identifier: 0 })
      const current = await state(), routed = (await trace()).filter(item => item.method === 'onWorkspaceTab' && item.type === 'tap')
      return { pass: Boolean(events.identifier === 0 && routed.length && current.data.workspaceTab === 'devices' && current.data.workspaceTab !== before.data.workspaceTab), identifier: events.identifier, tabBefore: before.data.workspaceTab, tabAfter: current.data.workspaceTab, routed }
    })

    await record('line delete target receives caught touchstart then touchend/tap with stable dataset and removes only selected row', async () => {
      await tap('[data-tab="lines"]'); await waitFor(async () => (await state()).data.workspaceTab === 'lines')
      const collapsed = (await state()).data.groups.find(item => item.collapsed)
      if (collapsed) await tap('.workspace-group-header')
      const rowData = await browser.evaluate('(()=>{const n=document.querySelector(".workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-line-row");return n&&{id:n.dataset.id}})()')
      if (!rowData) throw Error('Line row is not visible for delete test')
      const modalCountBefore = (await state()).events.modals.length
      await clearTrace()
      const rowBox = await browser.pointFor('.workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-line-row')
      const circleStart = { ...rowBox, x: rowBox.x - rowBox.width / 2 + 32 }
      const swipe = await browser.swipe('.workspace-line-row', -180, 0, 360, 6, { identifier: 0, point: circleStart })
      await delay(240)
      const deleteSelector = `.workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-line-swipe-row[data-swipe-id="${rowData.id}"] .workspace-swipe-delete`
      await clearTrace(); const start = await mark(); await tap(deleteSelector)
      let modalState = await state()
      const events = await since(start)
      const deleteTap = events.find(item => item.method === 'deleteWorkspaceRecord' && item.type === 'tap')
      const deleteStart = events.find(item => item.method === 'onSwipeActionTouchStart' && item.type === 'touchstart')
      const deleteEnd = events.find(item => item.method === 'onSwipeActionTouchEnd' && item.type === 'touchend')
      const targetId = deleteTap?.currentTarget?.dataset?.id
      const modalShown = modalState.events.modals.length > modalCountBefore
      const modalResponse = modalShown ? await browser.evaluate('window.__qaAction("modal", null, {confirm:true})') : null
      const immediate = modalShown ? await state() : null
      let removalObserved = false
      if (modalShown) { try { await waitFor(async () => !(await state()).data.groups.flatMap(group => group.lines).some(line => line.id === rowData.id), 2600); removalObserved = true } catch {} }
      const after = await state()
      const deviceOrLineIds = after.data.groups.flatMap(group => group.lines).map(line => line.id)
      const rowRemoved = !deviceOrLineIds.includes(rowData.id)
      const storedProject = after.storage['audioTool.projects.v1']?.find(item => item.id === after.data.project?.id)
      const storedLinePresent = Boolean(storedProject?.wiringSchedule?.lines?.some(item => item.id === rowData.id))
      const rowEndReceived = events.some(item => item.method === 'onSwipeTouchEnd' && item.type === 'touchend')
      return { pass: Boolean(modalShown && targetId === rowData.id && deleteTap?.currentTarget?.dataset?.id === rowData.id && deleteStart && (rowEndReceived || deleteEnd) && rowRemoved && !storedLinePresent), rowId: rowData.id, targetId, deleteTargetChildDataset: deleteTap?.target?.dataset, deleteCurrentTargetDataset: deleteTap?.currentTarget?.dataset, modalShown, deleteStart, deleteEnd, rowEndReceived, endRouteClassification: rowEndReceived ? 'touchend propagated to swipe row' : deleteEnd ? 'button catchtouchend handled locally; not propagated' : 'no touchend handler observed', deleteTap, immediateAfterConfirmation: { saving: immediate?.data?.saving, retiringRow: immediate?.data?.workspaceRetiringRow, rowStillRendered: immediate?.data?.groups?.flatMap(group => group.lines).some(line => line.id === rowData.id), persistedLinePresent: Boolean(immediate?.storage?.['audioTool.projects.v1']?.find(item => item.id === immediate.data.project?.id)?.wiringSchedule?.lines?.some(item => item.id === rowData.id)) }, rowRemoved, storedLinePresent, removalObserved, revision: after.data.project?.wiringSchedule?.revision, retiringRow: after.data.workspaceRetiringRow, modalResponse: { saving: modalResponse?.data?.saving, revision: modalResponse?.data?.project?.wiringSchedule?.revision }, swipeSummary: { offsetAfterGesture: swipe.observations.at(-1)?.observation || null }, mockModalResponse: 'confirmed through in-memory wx.showModal callback' }
    })

    await record('project picker, cancel and Done are reachable; sheet interior tap remains contained', async () => {
      await tap('.workspace-project-button'); await waitFor(async () => (await state()).data.projectPickerVisible)
      await clearTrace(); const start = await mark(); await tap('.workspace-wheel-sheet')
      const interior = (await since(start)).map(item => item.method)
      const notClosed = (await state()).data.projectPickerVisible
      await tap('.workspace-wheel-cancel')
      const cancelled = !(await state()).data.projectPickerVisible
      await delay(280)
      await tap('.workspace-project-button'); await waitFor(async () => (await state()).data.projectPickerVisible)
      await clearTrace()
      await tap('.workspace-done')
      const doneRoute = (await trace()).filter(item => item.method === 'confirmProjectPicker' && item.type === 'tap')
      await waitFor(async () => !(await state()).data.projectPickerVisible)
      const done = await state()
      return { pass: notClosed && cancelled && !done.data.projectPickerVisible && interior.includes('stopEvent') && doneRoute.length > 0 && done.data.project, notClosed, cancelled, doneClosed: !done.data.projectPickerVisible, doneRoute, doneProject: done.data.project?.id, interiorMethods: interior, changeHandlerSource: declared.some(item => item.method === 'onProjectWheelChange') ? 'declared; wheel movement separately represented in handler inventory' : 'not declared' }
    })

    await record('new project X and backdrop close, then name input plus save use touch/input events', async () => {
      await delay(280)
      await tap('.workspace-new'); await waitFor(async () => (await state()).data.newProjectVisible)
      await tap('.workspace-mask:not(.workspace-wheel-mask) .wiring-backdrop')
      await waitFor(async () => !(await state()).data.newProjectVisible)
      await delay(280)
      await tap('.workspace-new'); await waitFor(async () => (await state()).data.newProjectVisible)
      await tap('.workspace-new-project-sheet .workspace-close-button')
      await waitFor(async () => !(await state()).data.newProjectVisible)
      await delay(280)
      await tap('.workspace-new'); await waitFor(async () => (await state()).data.newProjectVisible)
      await browser.tap('.workspace-new-project-sheet input', { identifier: 0 })
      await focusTextInput('.workspace-new-project-sheet input')
      await browser.send('Input.insertText', { text: 'Touch QA project' })
      await waitFor(async () => (await state()).data.projectPickerName.includes('Touch QA project'))
      const inputEvents = (await trace()).filter(item => item.method === 'onProjectNameInput' && item.type === 'input')
      await tap('.workspace-new-project-save')
      await waitFor(async () => !(await state()).data.newProjectVisible, 2500)
      const after = await state()
      return { pass: Boolean(inputEvents.length && after.data.project?.name.includes('Touch QA project') && !after.data.newProjectVisible), project: after.data.project, inputEvents: inputEvents.map(item => ({ method: item.method, type: item.type, target: item.target, currentTarget: item.currentTarget })) }
    })

    const finalSession = await state(), finalTrace = await trace()
    const exercised = new Set(finalTrace.map(item => item.method))
    const handlerAudit = declared.map(item => ({ ...item, reachedInPhaseTrace: exercised.has(item.method), status: exercised.has(item.method) ? 'touch-or-input-route-observed' : 'declared-method-not-exercised-in-this-phase' }))
    const sourceHashes = finalSession.sources || {}
    const result = {
      phase,
      generatedAt: new Date().toISOString(),
      sourceMode: phase === 'before' ? 'four-file preserved baseline from parent backup; all other modules current' : 'current workspace source at execution time',
      sourceHashes,
      sessionMethods: [...sessionMethods],
      handlerAudit,
      traceSummary: { eventCount: finalTrace.length, methods: [...new Set(finalTrace.map(item => item.method))], synthesizedTapCount: finalTrace.filter(item => item.nativeInput === 'synthesized-touch-tap').length, trace: finalTrace },
      checks
    }
    fs.writeFileSync(path.join(phaseEvidence, 'phase.json'), JSON.stringify(result, null, 2))
    fs.writeFileSync(path.join(phaseEvidence, 'failures.json'), JSON.stringify(checks.filter(check => !check.passed), null, 2))
    return result
  } finally { await browser.close() }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

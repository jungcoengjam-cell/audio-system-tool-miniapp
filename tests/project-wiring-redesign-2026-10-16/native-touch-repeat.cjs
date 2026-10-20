const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { launch, delay } = require('./cdp.cjs')

const here = __dirname
const repo = path.resolve(here, '../..')
const output = path.join(here, 'evidence/native-repeat-2026-10-16')
const runStamp = new Date().toISOString().replace(/[:.]/g, '-')
const attemptOutput = path.join(output, `attempt-${runStamp}`)
const sourceNames = [
  'app.wxss', 'styles/theme-page-shared.wxss', 'utils/project-wiring.js', 'utils/records.js',
  ...fs.readdirSync(path.join(repo, 'pages/project-wiring')).filter(name => /\.(?:js|wxml|wxss)$/.test(name)).map(name => `pages/project-wiring/${name}`),
].sort()
const harnessNames = [
  'tests/project-wiring-redesign-2026-10-16/native-touch-repeat.cjs',
  'tests/project-wiring-redesign-2026-10-16/native-browser.html',
  'tests/project-wiring-redesign-2026-10-16/browser.js',
  'tests/project-wiring-redesign-2026-10-16/browser-server.cjs',
  'tests/project-wiring-redesign-2026-10-16/cdp.cjs',
  'tests/project-wiring-redesign-2026-10-16/keyed-dom-patch.js',
  'tests/project-wiring-redesign-2026-10-16/runtime.cjs',
]
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const fileHashes = names => Object.fromEntries(names.map(name => [name, sha256(path.join(repo, name))]))
const sourceHashes = fileHashes(sourceNames)
const harnessHashes = fileHashes(harnessNames)
const fullManifest = () => ({ product: fileHashes(sourceNames), harness: fileHashes(harnessNames) })
const changedManifestEntries = (before, after) => [
  ...Object.keys(before.product).filter(name => before.product[name] !== after.product[name]).map(name => `product:${name}`),
  ...Object.keys(before.harness).filter(name => before.harness[name] !== after.harness[name]).map(name => `harness:${name}`),
]
const lineRows = '.workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-line-swipe-row'
const lineContent = '.workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-line-row'

async function state(browser) { return browser.evaluate('window.__qaRefresh()') }
async function waitFor(read, timeoutMs = 2400) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await read()
    if (value) return value
    await delay(40)
  }
  throw new Error('Timed out waiting for isolated page state')
}
async function clearTrace(browser) {
  await browser.evaluate('window.__qaEventTrace.length=0;window.__qaClearRawTouchTrace()')
  browser.clearTouchDispatchTrace()
}
async function routeTrace(browser) { return browser.evaluate('window.__qaEventTrace.slice()') }
async function rawTrace(browser) { return browser.evaluate('window.__qaRawTouchTrace.slice()') }
function stableRecordShape(item) {
  if (!item) return null
  const copy = { ...item }
  for (const key of ['swipeOpen', 'swipeOffset', 'swipeDragging', 'retiring', 'removalPhase']) delete copy[key]
  return copy
}

async function open(name) {
  const runDir = path.join(attemptOutput, name)
  fs.mkdirSync(runDir, { recursive: true })
  process.env.WIRING_QA_EVIDENCE = runDir
  process.env.WIRING_QA_BEFORE_ROOT = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/before')
  const browser = await launch()
  await browser.viewport(390, 844, 'light', 'no-preference')
  await browser.navigate('tests/project-wiring-redesign-2026-10-16/native-browser.html?fixture=long&theme=light&sourceVersion=after')
  const initial = await waitFor(async () => {
    const current = await state(browser)
    return current.data?.project ? current : null
  })
  const mismatches = sourceNames.filter(name => initial.sources?.[name] !== sourceHashes[name])
  if (mismatches.length) {
    await browser.close()
    throw new Error(`Source changed after the runner fingerprint; refusing a mixed-source sample: ${JSON.stringify(mismatches)}`)
  }
  browser.loadedSourceHashes = initial.sources
  return browser
}

async function openLines(browser) {
  await browser.tap('[data-tab="lines"]', { identifier: 0 })
  await waitFor(async () => (await state(browser)).data.workspaceTab === 'lines')
  let snapshot = await state(browser)
  let group = snapshot.data.groups.find(item => !item.collapsed && item.lines.length)
  if (!group) {
    const collapsedHeader = await browser.evaluate(`(()=>{const h=[...document.querySelectorAll('.workspace-group-header')].find(n=>n.getAttribute('aria-expanded')==='false');return Boolean(h)})()`)
    if (!collapsedHeader) throw new Error('No collapsed group header available to expand')
    await browser.tap('.workspace-group-header[aria-expanded="false"]', { identifier: 0 })
    snapshot = await waitFor(async () => {
      const current = await state(browser)
      return current.data.groups.some(item => !item.collapsed && item.lines.length) ? current : null
    })
    group = snapshot.data.groups.find(item => !item.collapsed && item.lines.length)
  }
  await delay(240)
  return { snapshot: await state(browser), group }
}

async function rectPoint(browser, selector, ratio = 0.5) {
  return browser.evaluate(`(()=>{
    const n=document.querySelector(${JSON.stringify(selector)}); if(!n)return null;
    const r=n.getBoundingClientRect(); const x=r.left+r.width*${ratio}; const y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y); const round=v=>Math.round(v*100)/100;
    const box=b=>({left:round(b.left),top:round(b.top),right:round(b.right),bottom:round(b.bottom),width:round(b.width),height:round(b.height)});
    const path=[]; for(let a=hit;a&&a!==document.documentElement;a=a.parentElement) path.push({tag:a.tagName.toLowerCase(),className:typeof a.className==='string'?a.className:null,dataset:{...a.dataset}});
    return {selector:${JSON.stringify(selector)},ratio:${ratio},point:{x:round(x),y:round(y)},rect:box(r),hit:path[0]||null,hitPath:path};
  })()`)
}

async function textPoint(browser, rowSelector, scrollSelector, ratio, textIndex = 0) {
  return browser.evaluate(`(()=>{
    const row=document.querySelector(${JSON.stringify(rowSelector)}), scrollers=[...document.querySelectorAll(${JSON.stringify(scrollSelector)})], scroller=scrollers[${textIndex}]||null;
    if(!row||!scroller)return {missing:true,row:Boolean(row),scroller:Boolean(scroller),rows:document.querySelectorAll('.workspace-line-row').length,ports:document.querySelectorAll('.workspace-port-cell').length};
    const range=document.createRange();range.selectNodeContents(scroller);let tr=range.getBoundingClientRect();const sr=scroller.getBoundingClientRect();const textRectAvailable=tr.width>0&&tr.height>0;if(!textRectAvailable)tr=sr;
    const rr=row.getBoundingClientRect();
    const left=Math.max(0,sr.left,tr.left), right=Math.min(innerWidth,sr.right,tr.right), top=Math.max(0,sr.top,tr.top), bottom=Math.min(innerHeight,sr.bottom,tr.bottom);
    const x=left+(right-left)*${ratio}, y=top+(bottom-top)/2, hit=document.elementFromPoint(x,y), round=v=>Math.round(v*100)/100;
    const box=b=>({left:round(b.left),top:round(b.top),right:round(b.right),bottom:round(b.bottom),width:round(b.width),height:round(b.height)});
    const path=[]; for(let a=hit;a&&a!==document.documentElement;a=a.parentElement) path.push({tag:a.tagName.toLowerCase(),className:typeof a.className==='string'?a.className:null,dataset:{...a.dataset}});
    return {ratio:${ratio},textIndex:${textIndex},point:{x:round(x),y:round(y)},rowRect:box(rr),scrollRect:box(sr),textRect:box(tr),textRectAvailable,scrollerText:(scroller.textContent||'').trim(),visibleTextRect:{left:round(left),right:round(right),top:round(top),bottom:round(bottom),width:round(right-left),height:round(bottom-top)},hit:path[0]||null,hitPath:path};
  })()`)
}

async function swipeProbe(name, tab, config) {
  const browser = await open(name)
  try {
    let rowSelector, point, snapshot
    if (tab === 'lines') {
      const opened = await openLines(browser)
      snapshot = opened.snapshot
      rowSelector = lineRows
      if (!snapshot.data.groups.some(group => !group.collapsed && group.lines.length)) throw Error('No visible line group')
      point = config.textRatio === undefined
        ? await rectPoint(browser, lineContent, config.ratio)
        : await textPoint(browser, lineRows, '.workspace-port-cell', config.textRatio, config.textIndex || 0)
    } else {
      snapshot = await state(browser)
      rowSelector = '.workspace-device-swipe-row'
      point = config.textRatio === undefined
        ? await rectPoint(browser, rowSelector, config.ratio)
        : await textPoint(browser, rowSelector, '.workspace-device-name', config.textRatio)
    }
    if (!point?.point) throw Error(`Could not calculate visible touch point for ${name}: ${JSON.stringify(point)}`)
    const selectorId = tab === 'lines' ? lineRows : rowSelector
    const preHit = await browser.inspectTarget(selectorId, point.point)
    const pointRow = await browser.evaluate(`(()=>{const n=document.elementFromPoint(${point.point.x},${point.point.y});const r=n?.closest('.workspace-device-swipe-row,.workspace-line-swipe-row');return r?{id:r.dataset.swipeId,type:r.dataset.swipeType,className:r.className}:null})()`)
    const beforeItem = tab === 'devices'
      ? snapshot.data.devices.find(item => String(item.id) === String(pointRow?.id))
      : snapshot.data.groups.flatMap(group => group.lines).find(item => String(item.id) === String(pointRow?.id))
    const storedBefore = snapshot.storage['audioTool.projects.v1']?.find(item => item.id === snapshot.data.project?.id)?.wiringSchedule
    await clearTrace(browser)
    const swipe = await browser.swipe(selectorId, -144, 0, 320, 6, {
      identifier: 0,
      point: point.point,
      observeExpression: tab === 'lines'
        ? "(()=>{const r=document.querySelector('.workspace-group-lines:not(.workspace-group-lines-collapsed) .workspace-line-swipe-row');const d=window.__wiringQa.session.data.groups.flatMap(g=>g.lines).find(x=>x.id===r?.dataset.swipeId);return{offset:d?.swipeOffset,open:d?.swipeOpen,dragging:d?.swipeDragging}})()"
        : "(()=>{const r=document.querySelector('.workspace-device-swipe-row');const d=window.__wiringQa.session.data.devices.find(x=>x.id===r?.dataset.swipeId);return{offset:d?.swipeOffset,open:d?.swipeOpen,dragging:d?.swipeDragging}})()",
    })
    await delay(240)
    const session = await state(browser)
    const events = await routeTrace(browser)
    const raw = await rawTrace(browser)
    const device = tab === 'devices' ? session.data.devices[0] : null
    const targetRecord = tab === 'devices'
      ? session.data.devices.find(item => String(item.id) === String(pointRow?.id))
      : session.data.groups.flatMap(group => group.lines).find(item => String(item.id) === String(pointRow?.id))
    const storedAfter = session.storage['audioTool.projects.v1']?.find(item => item.id === session.data.project?.id)?.wiringSchedule
    const noMutation = JSON.stringify(stableRecordShape(beforeItem)) === JSON.stringify(stableRecordShape(targetRecord))
      && JSON.stringify(storedBefore) === JSON.stringify(storedAfter)
      && snapshot.data.project?.wiringSchedule?.revision === session.data.project?.wiringSchedule?.revision
      && snapshot.events.writes.length === session.events.writes.length
    const directRowStarts = events.filter(item => item.method === 'onSwipeTouchStart' && item.type === 'touchstart')
    const nestedStarts = events.filter(item => item.method === 'onSwipeScrollTouchStart' && item.type === 'touchstart')
    const contentState = tab === 'lines'
      ? session.data.groups.flatMap(group => group.lines).map(item => ({ id: item.id, swipeOpen: item.swipeOpen, swipeOffset: item.swipeOffset }))
      : session.data.devices.map(item => ({ id: item.id, swipeOpen: item.swipeOpen, swipeOffset: item.swipeOffset }))
    return {
      name, tab, expectedByCurrentUserRequirement: 'horizontal row swipe should start from this visible location and reveal Delete, unless the point is on a separate action control',
      loadedSourceHashes: browser.loadedSourceHashes,
      requestedPoint: point, explicitTargetSelector: selectorId, preDispatchTarget: preHit?.chosen?.hit || preHit,
      gesture: { kind: 'CDP Input.dispatchTouchEvent', identifier: 0, dx: -144, dy: 0, durationMs: 320, samples: 6, swipe },
      final: { contentState, targetRecord: targetRecord || null, activeTab: session.data.workspaceTab, detailVisible: session.data.detailVisible, deviceEditorVisible: session.data.deviceEditorVisible, editorVisible: session.data.editorVisible },
      noRecordMutation: { passedInFixture: noMutation, targetRow: pointRow, before: stableRecordShape(beforeItem), after: stableRecordShape(targetRecord), scheduleRevisionBefore: snapshot.data.project?.wiringSchedule?.revision, scheduleRevisionAfter: session.data.project?.wiringSchedule?.revision, storageWiringScheduleUnchanged: JSON.stringify(storedBefore) === JSON.stringify(storedAfter), writesBefore: snapshot.events.writes.length, writesAfter: session.events.writes.length },
      routeSummary: events.map(item => ({ type: item.type, method: item.method, catch: item.catch, nativeInput: item.nativeInput, target: item.target, currentTarget: item.currentTarget })),
      ancestorStartObserved: directRowStarts.length > 0,
      nestedCatchStartObserved: nestedStarts.length > 0,
      rawTouchStart: raw.find(item => item.domType === 'touchstart') || null,
      cdpTouchDispatch: browser.touchDispatchTrace(),
      observation: tab === 'devices' ? { id: device?.id, name: device?.name } : null,
      resultClass: directRowStarts.length ? 'parent-row-touchstart-reached' : nestedStarts.length ? 'nested-catchtouchstart-blocked-parent-start' : 'no-row-or-nested-start-route-observed',
    }
  } finally { await browser.close() }
}

async function connectAction() {
  const browser = await open('device-connect-action')
  try {
    const before = await state(browser)
    const device = before.data.devices[0]
    await clearTrace(browser)
    const hit = await browser.inspectTarget('.workspace-connect-button')
    const tap = await browser.tap('.workspace-connect-button', { identifier: 0, downMs: 55, clickWaitMs: 90 })
    await waitFor(async () => (await state(browser)).data.editorVisible)
    const after = await state(browser), events = await routeTrace(browser), raw = await rawTrace(browser)
    const rowStart = events.find(item => item.method === 'onSwipeTouchStart' && item.type === 'touchstart' && String(item.currentTarget?.dataset?.swipeId) === String(device?.id))
    const rowEnd = events.find(item => item.method === 'onSwipeTouchEnd' && item.type === 'touchend' && String(item.currentTarget?.dataset?.swipeId) === String(device?.id))
    const connectTap = events.find(item => item.method === 'connectDevice' && item.type === 'tap')
    return {
      expected: { visibleConnectButtonHit: true, parentRowTouchStartAndEnd: true, childCatchTapReachesConnect: true, lineEditorVisible: true, sourceEndpointPreselected: device?.name },
      tap, hitBefore: hit, selectedDevice: { id: device?.id, name: device?.name },
      after: { editorVisible: after.data.editorVisible, draftFromDevice: after.data.draft?.fromDevice, draftFromDeviceId: after.data.draft?.fromDeviceId, toDevice: after.data.draft?.toDevice, toDeviceChoices: after.data.deviceChoices?.map(item => ({ id: item.id, name: item.name })) },
      routeChecks: { parentTouchStart: rowStart || null, parentTouchEnd: rowEnd || null, connectCatchTap: connectTap || null, originIdMatches: String(after.data.draft?.fromDeviceId) === String(device?.id), originNameMatches: after.data.draft?.fromDevice === device?.name },
      route: events.map(item => ({ type: item.type, method: item.method, catch: item.catch, target: item.target, currentTarget: item.currentTarget, nativeInput: item.nativeInput })),
      rawTouchStart: raw.find(item => item.domType === 'touchstart') || null,
      cdpTouchDispatch: browser.touchDispatchTrace(),
      passedInIsolatedBrowserFixture: Boolean(rowStart && rowEnd && String(connectTap?.currentTarget?.dataset?.id) === String(device?.id) && after.data.editorVisible && after.data.draft?.fromDevice === device?.name && String(after.data.draft?.fromDeviceId) === String(device?.id)),
    }
  } finally { await browser.close() }
}

async function tapDeleteButton(browser, selector) {
  const hit = await browser.inspectTarget(selector)
  const modalCountBefore = (await state(browser)).events.modals.length
  await clearTrace(browser)
  let tap = null, tapError = null
  try { tap = await browser.tap(selector, { identifier: 0, downMs: 55, clickWaitMs: 90 }) }
  catch (error) { tapError = error.message }
  const events = await routeTrace(browser), raw = await rawTrace(browser), afterTap = await state(browser)
  return {
    selector, hit, tap, tapError, events, raw, afterTap, modalCountBefore,
    modalShown: afterTap.events.modals.length > modalCountBefore,
    modal: afterTap.events.modals.at(-1) || null,
    deleteRoute: events.find(item => item.method === 'deleteWorkspaceRecord' && item.type === 'tap') || null,
    cdpTouchDispatch: browser.touchDispatchTrace(),
  }
}

async function ensureRowRevealed(browser, tab, id) {
  const current = await state(browser)
  const item = tab === 'devices'
    ? current.data.devices.find(device => String(device.id) === String(id))
    : current.data.groups.flatMap(group => group.lines).find(line => String(line.id) === String(id))
  if (!item) return { found: false, item: null, gesture: null }
  if (item.swipeOpen) return { found: true, item, alreadyOpen: true, gesture: null }
  const rowSelector = tab === 'devices'
    ? `.workspace-device-swipe-row[data-swipe-id="${id}"]`
    : `${lineRows}[data-swipe-id="${id}"]`
  const point = tab === 'devices'
    ? await textPoint(browser, rowSelector, '.workspace-device-name', 0.5)
    : await textPoint(browser, lineRows, '.workspace-port-cell', 0.5, 0)
  const gesture = await browser.swipe(rowSelector, -180, 0, 360, 6, { identifier: 0, point: point.point })
  await delay(260)
  const after = await state(browser)
  const opened = tab === 'devices'
    ? after.data.devices.find(device => String(device.id) === String(id))
    : after.data.groups.flatMap(group => group.lines).find(line => String(line.id) === String(id))
  return { found: Boolean(opened), item: opened || null, point, gesture, alreadyOpen: false }
}

async function deleteAfterReveal() {
  const browser = await open('delete-after-reveal')
  try {
    await openLines(browser)
    const rowId = await browser.evaluate(`(()=>document.querySelector(${JSON.stringify(lineRows)})?.dataset.swipeId)()`)
    const leftStart = await textPoint(browser, lineRows, '.workspace-port-cell', 0.5, 0)
    await clearTrace(browser)
    const reveal = await browser.swipe(lineRows, -180, 0, 360, 6, { identifier: 0, point: leftStart.point })
    await delay(260)
    const afterReveal = await state(browser)
    const line = afterReveal.data.groups.flatMap(group => group.lines).find(item => item.id === rowId)
    const deleteSelector = `${lineRows} .workspace-swipe-delete`
    const cancelAttempt = await tapDeleteButton(browser, deleteSelector)
    const cancelResponse = cancelAttempt.modalShown ? await browser.evaluate('window.__qaAction("modal", null, {confirm:false})') : null
    const afterCancel = await state(browser)
    const storedBeforeCancel = afterCancel.storage['audioTool.projects.v1']?.find(item => item.id === afterCancel.data.project?.id)
    const linePresentAfterCancel = Boolean(storedBeforeCancel?.wiringSchedule?.lines?.some(item => item.id === rowId))
    const revisionAfterCancel = afterCancel.data.project?.wiringSchedule?.revision
    const reopened = await ensureRowRevealed(browser, 'lines', rowId)
    const confirmAttempt = await tapDeleteButton(browser, deleteSelector)
    const confirm = confirmAttempt.modalShown ? await browser.evaluate('window.__qaAction("modal", null, {confirm:true})') : null
    let removed = false
    if (confirmAttempt.modalShown) {
      try { await waitFor(async () => !(await state(browser)).data.groups.flatMap(group => group.lines).some(item => item.id === rowId), 2600); removed = true } catch {}
    }
    const final = await state(browser)
    const storedProject = final.storage['audioTool.projects.v1']?.find(item => item.id === final.data.project?.id)
    const storedLinePresent = Boolean(storedProject?.wiringSchedule?.lines?.some(item => item.id === rowId))
    const deleteRoute = confirmAttempt.deleteRoute
    return {
      expected: { rowOpenBeforeDelete: true, visibleDeleteTargetTapped: true, modalCancelHasNoStorageWrite: true, laterConfirmDeletesOnlyIsolatedLine: true },
      rowId, swipeStart: leftStart, reveal, afterReveal: { line, modalCount: afterReveal.events.modals.length },
      cancelAttempt: { hit: cancelAttempt.hit, tap: cancelAttempt.tap, tapError: cancelAttempt.tapError, modalShown: cancelAttempt.modalShown, modal: cancelAttempt.modal, route: cancelAttempt.events.map(item => ({ type: item.type, method: item.method, catch: item.catch, target: item.target, currentTarget: item.currentTarget, nativeInput: item.nativeInput })), rawTouch: cancelAttempt.raw, cancelResponse, linePresentInRuntimeAfterCancel: afterCancel.data.groups.flatMap(group => group.lines).some(item => item.id === rowId), linePresentAfterCancel, revisionAfterCancel, revisionBeforeCancel: afterReveal.data.project?.wiringSchedule?.revision },
      revealAfterCancel: reopened,
      confirmAttempt: { hit: confirmAttempt.hit, tap: confirmAttempt.tap, tapError: confirmAttempt.tapError, modalShown: confirmAttempt.modalShown, modal: confirmAttempt.modal, route: confirmAttempt.events.map(item => ({ type: item.type, method: item.method, catch: item.catch, target: item.target, currentTarget: item.currentTarget, nativeInput: item.nativeInput })), rawTouch: confirmAttempt.raw, cdpTouchDispatch: confirmAttempt.cdpTouchDispatch },
      deleteCurrentTarget: deleteRoute?.currentTarget, confirmAction: confirm ? { action: 'isolated wx.showModal callback', saving: confirm.data.saving, revision: confirm.data.project?.wiringSchedule?.revision } : null,
      final: { removedFromRuntime: removed || !final.data.groups.flatMap(group => group.lines).some(item => item.id === rowId), storedLinePresent, revision: final.data.project?.wiringSchedule?.revision },
      passedInIsolatedBrowserFixture: Boolean(line?.swipeOpen && cancelAttempt.modalShown && String(cancelAttempt.deleteRoute?.currentTarget?.dataset?.id) === String(rowId) && afterCancel.data.groups.flatMap(group => group.lines).some(item => item.id === rowId) && linePresentAfterCancel && revisionAfterCancel === afterReveal.data.project?.wiringSchedule?.revision && confirmAttempt.modalShown && String(deleteRoute?.currentTarget?.dataset?.id) === String(rowId) && !storedLinePresent),
      sourceScope: 'The row and deletion use the isolated browser fixture storage; no real user records are loaded or changed.',
    }
  } finally { await browser.close() }
}

async function deleteDeviceAfterReveal() {
  const browser = await open('device-delete-after-reveal')
  try {
    const before = await state(browser)
    const allLines = before.data.groups.flatMap(group => group.lines)
    const device = before.data.devices.find(item => !item.legacy && allLines.some(line => line.fromDeviceId === item.id || line.toDeviceId === item.id))
    if (!device) throw new Error('The isolated long fixture has no connected non-legacy device for the associated-line confirmation path')
    const associatedLineIds = allLines.filter(line => line.fromDeviceId === device.id || line.toDeviceId === device.id).map(line => line.id)
    const rowSelector = `.workspace-device-swipe-row[data-swipe-id="${device.id}"]`
    const point = await textPoint(browser, rowSelector, '.workspace-device-name', 0.5)
    await clearTrace(browser)
    const reveal = await browser.swipe(rowSelector, -180, 0, 360, 6, { identifier: 0, point: point.point })
    await delay(260)
    const afterReveal = await state(browser)
    const currentDevice = afterReveal.data.devices.find(item => item.id === device.id)
    const deleteSelector = `${rowSelector} .workspace-swipe-delete`
    const cancelAttempt = await tapDeleteButton(browser, deleteSelector)
    const cancelResponse = cancelAttempt.modalShown ? await browser.evaluate('window.__qaAction("modal", null, {confirm:false})') : null
    const afterCancel = await state(browser)
    const storedBeforeCancel = afterCancel.storage['audioTool.projects.v1']?.find(item => item.id === afterCancel.data.project?.id)
    const storedDevicePresentAfterCancel = Boolean(storedBeforeCancel?.wiringSchedule?.devices?.some(item => item.id === device.id))
    const storedLinesAfterCancel = storedBeforeCancel?.wiringSchedule?.lines?.filter(item => associatedLineIds.includes(item.id)).map(item => item.id) || []
    const revisionAfterCancel = afterCancel.data.project?.wiringSchedule?.revision
    const reopened = await ensureRowRevealed(browser, 'devices', device.id)
    const confirmAttempt = await tapDeleteButton(browser, deleteSelector)
    const modal = confirmAttempt.modal
    const associatedLineDisclosureExpected = `${associatedLineIds.length} 条线路也会一并删除`
    const associatedLineDisclosureShown = Boolean(modal?.content?.includes(associatedLineDisclosureExpected))
    const confirm = confirmAttempt.modalShown ? await browser.evaluate('window.__qaAction("modal", null, {confirm:true})') : null
    let removed = false
    if (confirmAttempt.modalShown) {
      try { await waitFor(async () => !(await state(browser)).data.devices.some(item => item.id === device.id), 2600); removed = true } catch {}
    }
    const final = await state(browser)
    const storedProject = final.storage['audioTool.projects.v1']?.find(item => item.id === final.data.project?.id)
    const storedDevicePresent = Boolean(storedProject?.wiringSchedule?.devices?.some(item => item.id === device.id))
    const storedAssociatedLines = storedProject?.wiringSchedule?.lines?.filter(item => associatedLineIds.includes(item.id)).map(item => item.id) || []
    const runtimeAssociatedLines = final.data.groups.flatMap(group => group.lines).filter(item => associatedLineIds.includes(item.id)).map(item => item.id)
    const deleteRoute = confirmAttempt.deleteRoute
    return {
      expected: { visibleDeviceDeleteTargetTapped: true, modalCancelHasNoStorageWrite: true, associatedLineDisclosureIsExplicit: true, laterConfirmDeletesDeviceAndItsConnectedFixtureLines: true },
      device: { id: device.id, name: device.name, associatedLineIds }, point, reveal, afterReveal: { device: currentDevice, data: currentDevice ? { swipeOpen: currentDevice.swipeOpen, swipeOffset: currentDevice.swipeOffset } : null },
      cancelAttempt: { hit: cancelAttempt.hit, tap: cancelAttempt.tap, tapError: cancelAttempt.tapError, modalShown: cancelAttempt.modalShown, modal: cancelAttempt.modal, route: cancelAttempt.events.map(item => ({ type: item.type, method: item.method, catch: item.catch, target: item.target, currentTarget: item.currentTarget, nativeInput: item.nativeInput })), rawTouch: cancelAttempt.raw, cancelResponse, deviceStillPresent: afterCancel.data.devices.some(item => item.id === device.id), storedDevicePresentAfterCancel, storedLinesAfterCancel, revisionAfterCancel, revisionBeforeCancel: afterReveal.data.project?.wiringSchedule?.revision },
      revealAfterCancel: reopened,
      confirmAttempt: { hit: confirmAttempt.hit, tap: confirmAttempt.tap, tapError: confirmAttempt.tapError, modalShown: confirmAttempt.modalShown, modal, associatedLineDisclosureExpected, associatedLineDisclosureShown, route: confirmAttempt.events.map(item => ({ type: item.type, method: item.method, catch: item.catch, target: item.target, currentTarget: item.currentTarget, nativeInput: item.nativeInput })), rawTouch: confirmAttempt.raw, cdpTouchDispatch: confirmAttempt.cdpTouchDispatch },
      deleteCurrentTarget: deleteRoute?.currentTarget,
      confirmAction: confirm ? { action: 'isolated wx.showModal callback', saving: confirm.data.saving, revision: confirm.data.project?.wiringSchedule?.revision } : null,
      final: { removedFromRuntime: removed || !final.data.devices.some(item => item.id === device.id), storedDevicePresent, storedAssociatedLines, runtimeAssociatedLines, revision: final.data.project?.wiringSchedule?.revision },
      passedInIsolatedBrowserFixture: Boolean(associatedLineIds.length > 0 && currentDevice?.swipeOpen && cancelAttempt.modalShown && String(cancelAttempt.deleteRoute?.currentTarget?.dataset?.id) === String(device.id) && afterCancel.data.devices.some(item => item.id === device.id) && storedDevicePresentAfterCancel && associatedLineIds.every(id => storedLinesAfterCancel.includes(id)) && revisionAfterCancel === afterReveal.data.project?.wiringSchedule?.revision && confirmAttempt.modalShown && associatedLineDisclosureShown && String(deleteRoute?.currentTarget?.dataset?.id) === String(device.id) && !storedDevicePresent && associatedLineIds.every(id => !storedAssociatedLines.includes(id)) && associatedLineIds.every(id => !runtimeAssociatedLines.includes(id))),
      sourceScope: 'The row and deletion use isolated browser fixture storage; no real user records are loaded or changed.',
    }
  } finally { await browser.close() }
}

async function ordinaryTapAndVerticalScroll() {
  const browser = await open('ordinary-tap-and-vertical-scroll')
  try {
    await openLines(browser)
    const point = await textPoint(browser, lineRows, '.workspace-port-cell', 0.5, 0)
    const rowId = await browser.evaluate(`(()=>document.querySelector(${JSON.stringify(lineContent)})?.dataset.id)()`)
    const beforeScroll = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-scroll');return{top:n.scrollTop,height:n.clientHeight,scrollHeight:n.scrollHeight}})()`)
    await clearTrace(browser)
    const tap = await browser.tap(lineContent, { identifier: 0, point: point.point, downMs: 55, clickWaitMs: 90 })
    const tapState = await state(browser), tapEvents = await routeTrace(browser), tapRaw = await rawTrace(browser)
    if (tapState.data.detailVisible) {
      await browser.tap('.workspace-detail-sheet .workspace-close-button', { identifier: 0 })
      await waitFor(async () => !(await state(browser)).data.detailVisible)
      await delay(260)
    }
    await clearTrace(browser)
    const scrollPoint = await textPoint(browser, lineRows, '.workspace-port-cell', 0.5, 0)
    const scroll = await browser.swipe(lineRows, 0, -150, 320, 6, { identifier: 0, point: scrollPoint.point })
    await delay(120)
    const afterScroll = await state(browser)
    const afterMetrics = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-scroll');return{top:n.scrollTop,height:n.clientHeight,scrollHeight:n.scrollHeight}})()`)
    return {
      textStart: point,
      ordinaryTap: { tap, expectedLineId: rowId, detailLineId: tapState.data.detailLine?.id, detailVisible: tapState.data.detailVisible, route: tapEvents.map(item => ({ type: item.type, method: item.method, catch: item.catch, target: item.target, currentTarget: item.currentTarget, nativeInput: item.nativeInput })), rawTouch: tapRaw, passed: Boolean(tapState.data.detailVisible && tapState.data.detailLine?.id === rowId && tapEvents.some(item => item.method === 'onLineTap' && item.type === 'tap')) },
      verticalScroll: { before: beforeScroll, point: scrollPoint, gesture: { dx: 0, dy: -150, durationMs: 320, samples: 6, dispatch: scroll }, after: afterMetrics, route: await routeTrace(browser), rawTouch: await rawTrace(browser), state: { detailVisible: afterScroll.data.detailVisible, rowOpen: afterScroll.data.groups.flatMap(group => group.lines).some(item => item.swipeOpen) }, passed: afterMetrics.top > beforeScroll.top && !afterScroll.data.detailVisible },
      limitations: 'Chromium viewport scrolling is adapter evidence, not WeChat native scroll acceptance.',
    }
  } finally { await browser.close() }
}

async function cancelledGesture() {
  const browser = await open('touch-cancel')
  try {
    await openLines(browser)
    const point = await rectPoint(browser, lineContent, 0.12)
    const start = point.point, id = 0
    await clearTrace(browser)
    const dispatch = []
    dispatch.push(await browser.touchAt('touchStart', start.x, start.y, id)); await delay(40)
    dispatch.push(await browser.touchAt('touchMove', start.x - 60, start.y, id)); await delay(70)
    dispatch.push(await browser.touchAt('touchCancel', start.x - 60, start.y, id)); await delay(120)
    const afterCancel = await state(browser)
    const cancelRoute = await routeTrace(browser), raw = await rawTrace(browser)
    const noOpen = !afterCancel.data.groups.flatMap(group => group.lines).some(item => item.swipeOpen) && !afterCancel.data.detailVisible
    await clearTrace(browser)
    const nextTap = await browser.tap(lineContent, { identifier: 0, point: start, downMs: 55, clickWaitMs: 90 })
    const afterNextTap = await state(browser), nextRoute = await routeTrace(browser)
    return {
      expected: { touchcancelClearsGestureWithoutOpeningRow: true, nextFreshTapStillWorks: true }, start: point, dispatch,
      cancelRoute: cancelRoute.map(item => ({ type: item.type, method: item.method, catch: item.catch, target: item.target, currentTarget: item.currentTarget })), rawTouch: raw,
      stateAfterCancel: { lineOpen: afterCancel.data.groups.flatMap(group => group.lines).some(item => item.swipeOpen), detailVisible: afterCancel.data.detailVisible, noOpen },
      nextTap: { tap: nextTap, detailVisible: afterNextTap.data.detailVisible, lineId: afterNextTap.data.detailLine?.id, route: nextRoute.map(item => ({ type: item.type, method: item.method, nativeInput: item.nativeInput })), passed: Boolean(afterNextTap.data.detailVisible && nextRoute.some(item => item.method === 'onLineTap' && item.type === 'tap')) },
      cdpTouchDispatch: browser.touchDispatchTrace(),
      limitation: 'Chromium touchcancel injection verifies adapter cancellation routing only; device cancellation policy remains unverified.',
    }
  } finally { await browser.close() }
}

async function main() {
  fs.mkdirSync(attemptOutput, { recursive: true })
  const run = {
    generatedAt: new Date().toISOString(),
    sourceHashes,
    harnessHashes,
    runnerSha256: sha256(__filename),
    scope: 'Independent diagnosis of WXML touch sequences in the isolated Chromium fixture. No production, shared browser/CDP adapter, authentication, or user storage changes.',
    matrix: [],
  }
  for (const [ratio, label] of [[0.12, 'left'], [0.5, 'middle'], [0.88, 'right']]) {
    run.matrix.push(await swipeProbe(`line-row-${label}`, 'lines', { ratio, label }))
  }
  for (const [side, textIndex] of [['source', 0], ['destination', 1]]) {
    for (const [ratio, label] of [[0.12, 'left'], [0.5, 'middle'], [0.88, 'right']]) {
      run.matrix.push(await swipeProbe(`line-${side}-port-text-${label}`, 'lines', { textRatio: ratio, textIndex, label }))
    }
  }
  for (const [ratio, label] of [[0.12, 'left'], [0.5, 'middle'], [0.88, 'right']]) {
    run.matrix.push(await swipeProbe(`device-row-${label}`, 'devices', { ratio, label }))
  }
  for (const [ratio, label] of [[0.12, 'left'], [0.5, 'middle'], [0.88, 'right']]) {
    run.matrix.push(await swipeProbe(`device-name-text-${label}`, 'devices', { textRatio: ratio, label }))
  }
  run.nestedConnect = await connectAction()
  run.deviceDeleteAfterReveal = await deleteDeviceAfterReveal()
  run.deleteAfterReveal = await deleteAfterReveal()
  run.tapAndVerticalScroll = await ordinaryTapAndVerticalScroll()
  run.cancel = await cancelledGesture()
  const endManifest = fullManifest()
  const sourceChanges = changedManifestEntries({ product: sourceHashes, harness: harnessHashes }, endManifest)
  if (sourceChanges.length) {
    const mixed = new Error(`Source or harness changed during the run; refusing a verdict: ${JSON.stringify(sourceChanges)}`)
    mixed.mixedSource = true
    throw mixed
  }
  run.sourceManifestStableAtEnd = true
  run.finalSourceHashes = endManifest.product
  run.finalHarnessHashes = endManifest.harness
  run.summary = {
    lineRowSwipePositionsOpen: run.matrix.filter(item => item.tab === 'lines' && item.name.startsWith('line-row-') && item.final.contentState.some(row => row.swipeOpen)).map(item => item.name),
    lineSourcePortTextSwipePositionsOpen: run.matrix.filter(item => item.name.startsWith('line-source-port-text-') && item.final.contentState.some(row => row.swipeOpen)).map(item => item.name),
    lineDestinationPortTextSwipePositionsOpen: run.matrix.filter(item => item.name.startsWith('line-destination-port-text-') && item.final.contentState.some(row => row.swipeOpen)).map(item => item.name),
    deviceRowSwipePositionsOpen: run.matrix.filter(item => item.name.startsWith('device-row-') && item.final.contentState.some(row => row.swipeOpen)).map(item => item.name),
    deviceNameTextSwipePositionsOpen: run.matrix.filter(item => item.name.startsWith('device-name-text-') && item.final.contentState.some(row => row.swipeOpen)).map(item => item.name),
    nestedConnectFixturePass: run.nestedConnect.passedInIsolatedBrowserFixture,
    deviceDeleteAfterRevealFixturePass: run.deviceDeleteAfterReveal.passedInIsolatedBrowserFixture,
    deleteAfterRevealFixturePass: run.deleteAfterReveal.passedInIsolatedBrowserFixture,
    ordinaryTapFixturePass: run.tapAndVerticalScroll.ordinaryTap.passed,
    verticalScrollFixturePass: run.tapAndVerticalScroll.verticalScroll.passed,
    cancelClearedAndFreshTapPass: run.cancel.stateAfterCancel.noOpen && run.cancel.nextTap.passed,
    sourceFilesChangedByRunner: false,
  }
  fs.writeFileSync(path.join(attemptOutput, 'native-touch-repeat.json'), JSON.stringify(run, null, 2))
  const summary = {
    generatedAt: run.generatedAt,
    hashes: { ...sourceHashes, runner: run.runnerSha256 },
    observed: run.summary,
    bindingDiagnosis: {
      historicalPriorFrozenMarkupSha256: 'b248aa5c4028b94579ac0e8e7d82cac2a686738e9dcbdcbc711eb64b96a22e86',
      historicalPriorFrozenMarkup: 'Device-name and line-port scroll-view children used catchtouchstart=onSwipeScrollTouchStart; that handler cancelled the parent workspace swipe gesture. This finding is limited to the historical fingerprint above.',
      currentRun: 'Use each sample loadedSourceHashes plus rawTouch, preDispatchTarget, and routeSummary to classify the captured source; do not carry the historical child-scroll explanation forward unless the current loaded WXML still contains those bindings.',
      controlAction: 'Connect and both device/line Delete buttons are exercised as separate complete CDP touch flows against isolated fixture storage.',
    },
  }
  fs.writeFileSync(path.join(attemptOutput, 'summary.json'), JSON.stringify(summary, null, 2))
  fs.writeFileSync(path.join(attemptOutput, 'run-status.json'), JSON.stringify({ status: 'COMPLETED_SINGLE_SOURCE', countedPasses: null, countedFailures: null, verdict: 'Pending review of recorded scenarios; adapter evidence only.', sourceHashes, harnessHashes, runnerSha256: run.runnerSha256 }, null, 2))
  console.log(JSON.stringify({ output: path.join(attemptOutput, 'native-touch-repeat.json'), summary: run.summary, runnerSha256: run.runnerSha256 }, null, 2))
}

main().catch(error => {
  fs.mkdirSync(attemptOutput, { recursive: true })
  const current = fullManifest()
  const changed = changedManifestEntries({ product: sourceHashes, harness: harnessHashes }, current)
  const mixed = Boolean(error.mixedSource || changed.length)
  fs.writeFileSync(path.join(attemptOutput, 'run-status.json'), JSON.stringify({
    status: mixed ? 'MIXED_SOURCE_NOT_VALID_FOR_VERDICT' : 'ABORTED_NO_VERDICT',
    countedPasses: 0,
    countedFailures: 0,
    reason: error.message,
    sourceChanges: changed,
    sourceHashes,
    harnessHashes,
    runnerSha256: sha256(__filename),
  }, null, 2))
  console.error(error.stack || error)
  process.exitCode = 1
})

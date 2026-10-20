const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { launch, delay } = require('./cdp.cjs')
const { root, sourceManifest } = require('./module-refinements-support.cjs')

const harnessRoot = __dirname
const evidenceRoot = process.env.WIRING_QA_VISUAL_EVIDENCE
  ? path.resolve(process.env.WIRING_QA_VISUAL_EVIDENCE)
  : path.join(harnessRoot, 'evidence/native-acceptance-fix-2026-10-16/visual')
const previewRoot = path.join(evidenceRoot, 'previews')
const sceneRoot = path.join(evidenceRoot, 'scenes')
const residualRoot = path.join(harnessRoot, 'evidence/residual-failures-2026-10-16/visual')
const residualPreviewRoot = path.join(residualRoot, 'previews')
const checks = []
const captures = []
const interactionCases = []
const failures = []
let browser
let currentProfile = { theme:'light', capsule:true, reducedMotion:'no-preference' }

function check(name, passed, evidence) {
  const item = { name, passed: Boolean(passed), evidence }
  checks.push(item)
  if (!item.passed) {
    failures.push(name)
    console.error('FAIL', name, JSON.stringify(evidence))
  }
}

async function refreshSnapshot() {
  if (!browser) return null
  return browser.evaluate('window.__qaRefresh ? window.__qaRefresh() : null')
}

async function state() {
  await refreshSnapshot()
  return browser.evaluate('window.__wiringQa?.session')
}

async function pageFacts(refresh = true) {
  if (refresh) await refreshSnapshot()
  return browser.evaluate(`(() => {
    const box = (node) => {
      if (!node) return null
      const r = node.getBoundingClientRect(), s = getComputedStyle(node)
      return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height,
        opacity:s.opacity, visibility:s.visibility, pointerEvents:s.pointerEvents,
        transform:s.transform, transition:s.transition, animation:s.animation,
        transitionDuration:s.transitionDuration, animationDuration:s.animationDuration,
        overflow:s.overflow, textOverflow:s.textOverflow, whiteSpace:s.whiteSpace,
        scrollWidth:node.scrollWidth, clientWidth:node.clientWidth, text:node.innerText?.trim() || '',
        disabled:node.disabled===true,
        hitTargetAtCenter:(()=>{const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return target===node||node.contains(target)})() }
    }
    const one = (selector) => box(document.querySelector(selector))
    const root = document.querySelector('.wiring-page') || document.querySelector('page')
    const s = window.__wiringQa?.session
    return {
      viewport:{width:innerWidth,height:innerHeight}, pageWidth:document.documentElement.scrollWidth,
      theme:getComputedStyle(root).backgroundColor, text:document.querySelector('#app')?.innerText || '',
      centralStates:[...document.querySelectorAll('.workspace-scroll .workspace-state')].map(n=>({
        text:(n.innerText||'').replace(/\s+/g,' ').trim(),
        buttons:[...n.querySelectorAll('button')].map(button=>(button.innerText||'').trim()),
        className:n.className,
      })),
      errors:window.__geometry?.().errors || [],
      header:{nav:one('.workspace-nav'), title:one('.workspace-title'), projectRow:one('.workspace-project-row'),
        projectButton:one('.workspace-project-button'), projectName:one('.workspace-project-name'),
        actions:one('.workspace-project-actions'), share:one('.workspace-project-share, .workspace-share'),
        create:one('.workspace-new')}, tabContent:one('.workspace-tab-content'),
      tabs:[...document.querySelectorAll('.workspace-tab')].map(n=>({className:n.className,tab:n.dataset.tab,...box(n)})),
      rows:[...document.querySelectorAll('.workspace-swipe-row')].map(n=>({type:n.dataset.swipeType,id:n.dataset.swipeId,
        open:n.classList.contains('workspace-swipe-row-open'), offset:n.querySelector('.workspace-swipe-actions')?.getBoundingClientRect().width || 0,
        revision:n.dataset.swipeRevision, className:n.className, ...box(n)})),
      deleteButtons:[...document.querySelectorAll('.workspace-swipe-delete')].map(n=>({label:n.getAttribute('aria-label'),
        type:n.dataset.deleteType,id:n.dataset.id,revision:n.dataset.revision,...box(n)})),
      groups:[...document.querySelectorAll('.workspace-group-header')].map(n=>({key:n.dataset.key || n.dataset.groupKey || '',
        expanded:n.getAttribute('aria-expanded'), header:box(n), outer:box(n.closest('.workspace-line-group')),
        outerClassName:n.closest('.workspace-line-group')?.className || '',
        lineIds:[...n.parentElement?.querySelectorAll('.workspace-line-swipe-row') || []].map(row=>row.dataset.swipeId),
        linesAriaHidden:n.parentElement?.querySelector('.workspace-group-lines')?.getAttribute('aria-hidden'),
        lines:box(n.parentElement?.querySelector('.workspace-group-lines')),
        inner:box(n.parentElement?.querySelector('.workspace-group-lines-inner'))})),
      overlays:[...document.querySelectorAll('.workspace-mask,.wiring-mask')].map(n=>({className:n.className,
        ariaHidden:n.getAttribute('aria-hidden'), ...box(n), contentText:n.innerText?.trim() || '',
        sheetClassName:n.querySelector('.wiring-sheet')?.className || '',
        sheet:box(n.querySelector('.wiring-sheet')),
        sheetContent:(()=>{const sheet=n.querySelector('.wiring-sheet');if(!sheet)return null;const fields=[...sheet.querySelectorAll('input,textarea,select')].map(field=>({tag:field.tagName.toLowerCase(),type:field.type||'',value:field.value||'',placeholder:field.placeholder||'',disabled:field.disabled===true}));return{text:(sheet.innerText||'').replace(/\\s+/g,' ').trim(),fields,fieldCount:fields.length,descendantCount:sheet.querySelectorAll('*').length,selected:[...sheet.querySelectorAll('[aria-selected="true"],.workspace-type-selected,.workspace-tab-active')].map(item=>(item.innerText||'').trim())}})(),
        backdrop:box(n.querySelector('.wiring-backdrop'))})),
      overlayPhases:s?.data?.workspaceOverlayPhases || {},
      eventTrace:(window.__qaEventTrace || []).slice(-80),
      rawTouchTrace:(window.__qaRawTouchLog||[]).slice(-80),
      adapterStats:window.__qaPatchStats || window.__qaReconcileStats || null,
      sources:s?.sources || {}, session:s,
      data:s?.data || {}, schedule:s?.schedule || {}, events:s?.events || {}, storage:s?.storage || {},
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
    }
  })()`)
}

async function pageSnapshot(refresh = true) {
  if (refresh) await refreshSnapshot()
  const facts = await pageFacts(false)
  const current = facts.session
  delete facts.session
  return { facts, state:current }
}

async function navigate(theme, width, options = {}) {
  const height = options.height || 844
  const reducedMotion = options.reducedMotion || 'no-preference'
  currentProfile = { theme, width, height, capsule:options.capsule !== false, reducedMotion }
  await browser.viewport(width, height, theme, reducedMotion)
  const query = new URLSearchParams({
    theme,
    activeProjectId: '__default__',
    fixture: options.fixture || 'long',
    capsule: options.capsule === false ? '' : '1',
  })
  if (options.viewPreference) query.set('viewPreferenceJson', JSON.stringify(options.viewPreference))
  await browser.navigate('tests/project-wiring-redesign-2026-10-16/native-browser.html?' + query)
  await waitFor('page-ready', async () => (await browser.evaluate(`({ready:document.documentElement.dataset.ready,error:document.documentElement.dataset.error})`))?.ready === 'true', 4000)
  await browser.evaluate(`(()=>{if(window.__qaRawTouchLog)return;window.__qaRawTouchLog=[];window.__qaRawExpectedSelector='';for(const type of ['touchstart','touchend','touchcancel'])document.addEventListener(type,event=>{const expected=window.__qaRawExpectedSelector;let match=null,expectedNode=null;try{if(expected){match=event.target?.closest(expected);expectedNode=document.querySelector(expected)}}catch(error){}window.__qaRawTouchLog.push({type,timeStamp:event.timeStamp,targetTag:event.target?.tagName?.toLowerCase()||'',targetClassName:typeof event.target?.className==='string'?event.target.className:'',buttonClassName:event.target?.closest('button')?.className||'',matchesExpected:Boolean(match&&expectedNode&&match===expectedNode),expectedSelector:expected,changedTouches:[...(event.changedTouches||[])].map(touch=>({clientX:touch.clientX,clientY:touch.clientY}))})},true)})()`)
  return state()
}

async function waitFor(name, predicate, timeoutMs = 1800, intervalMs = 20) {
  const started = Date.now()
  let last
  while (Date.now() - started <= timeoutMs) {
    last = await predicate()
    if (last) return last
    await delay(intervalMs)
  }
  throw new Error(`Timed out waiting for ${name}; last=${JSON.stringify(last)}`)
}

async function actualTap(selector, waitMs = 50, options = {}) {
  const { skipState=false, ...tapOptions } = options
  const before = await browser.evaluate('(window.__qaEventTrace || []).length')
  const beforeRaw = await browser.evaluate('(window.__qaRawTouchLog || []).length')
  await browser.evaluate(`window.__qaRawExpectedSelector=${JSON.stringify(selector)}`)
  const response = await browser.tap(selector, tapOptions)
  if (waitMs) await delay(waitMs)
  const after = await browser.evaluate('(window.__qaEventTrace || [])')
  const raw = await browser.evaluate('(window.__qaRawTouchLog || [])')
  await browser.evaluate("window.__qaRawExpectedSelector=''")
  return { response, trace: Array.isArray(after) ? after.slice(before) : [],
    rawTouch: Array.isArray(raw) ? raw.slice(beforeRaw) : [], state: skipState ? null : await state() }
}

async function actualSwipe(selector, dx, dy = 0, durationMs = 280, samples = 8) {
  const beforeState = await state()
  const beforeTraceLength = await browser.evaluate('(window.__qaEventTrace || []).length')
  const selectorExpression = JSON.stringify(selector)
  const observeExpression = `window.__qaRefresh().then(()=>{const target=document.querySelector(${selectorExpression});const row=target?.closest('.workspace-swipe-row');if(!row)return null;const actions=row.querySelector('.workspace-swipe-actions');const button=row.querySelector('.workspace-swipe-delete');const content=row.querySelector('.workspace-swipe-content');const r=button?.getBoundingClientRect();return{open:row.classList.contains('workspace-swipe-row-open'),dragging:row.classList.contains('workspace-swipe-row-dragging'),offset:actions?actions.getBoundingClientRect().width:0,inlineWidth:actions?.style.width||'',deleteCenterX:r?r.x+r.width/2:null,deleteHit:!!(r&&(()=>{const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===button||button.contains(hit)})()),contentTransform:content?getComputedStyle(content).transform:''}})`
  const gesture = await browser.swipe(selector, dx, dy, durationMs, samples, { observeExpression })
  await delay(230)
  const after = await state()
  const trace = await browser.evaluate('(window.__qaEventTrace || [])')
  const events = Array.isArray(trace) ? trace.slice(beforeTraceLength) : []
  const progress = (gesture.observations || []).map(item => item.observation).filter(Boolean)
  return { gesture, progress, events, before: beforeState, after, facts: await pageFacts() }
}

async function retainNode(selector, key) {
  await browser.evaluate(`window.__qaRetainedNodes=window.__qaRetainedNodes||{};window.__qaRetainedNodes[${JSON.stringify(key)}]=document.querySelector(${JSON.stringify(selector)})`)
}

async function nodeRetained(selector, key) {
  return browser.evaluate(`Boolean(window.__qaRetainedNodes?.[${JSON.stringify(key)}] && window.__qaRetainedNodes[${JSON.stringify(key)}]===document.querySelector(${JSON.stringify(selector)}))`)
}

function maxCssTime(value) {
  return String(value || '0s').split(',').map(item => {
    const token = item.trim()
    if (token.endsWith('ms')) return Number.parseFloat(token)
    if (token.endsWith('s')) return Number.parseFloat(token) * 1000
    return 0
  }).reduce((max, item) => Math.max(max, item), 0)
}

function overlayFact(facts,spec) {
  return facts.overlays.find(item=>item.className.includes(spec.maskClass) &&
    (!spec.sheetClass || item.sheetClassName.includes(spec.sheetClass)))
}

async function typeInto(selector, text) {
  const tapped = await actualTap(selector, 15)
  if (!browser.send) throw new Error('CDP adapter does not expose keyboard insertion for real input events')
  await browser.send('Input.insertText', { text })
  await browser.evaluate('window.__qaFlushEvents ? window.__qaFlushEvents() : null')
  await delay(25)
  return { tapped, value:await browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value || ''`), state:await state() }
}

async function contentSnapshot(selector) {
  return browser.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;const fields=[...node.querySelectorAll('input,textarea,select')].map(field=>({tag:field.tagName.toLowerCase(),type:field.type||'',value:field.value||'',placeholder:field.placeholder||'',disabled:field.disabled===true}));return{text:(node.innerText||'').replace(/\\s+/g,' ').trim(),fields,fieldCount:fields.length,descendantCount:node.querySelectorAll('*').length,selected:[...node.querySelectorAll('[aria-selected="true"],.workspace-type-selected,.workspace-tab-active')].map(item=>(item.innerText||'').trim())}})()`)
}

async function modalChoice(confirm) {
  // The OS confirmation sheet is represented by the isolated wx.showModal fixture.
  // All app-row and button gestures are still delivered through browser.tap/swipe.
  if (typeof browser.respondModal === 'function') return browser.respondModal(confirm)
  return browser.evaluate(`window.__qaAction('modal', undefined, { confirm: ${Boolean(confirm)} })`)
}

async function capture(name, details = {}, snapshot = null) {
  const { facts, state:current } = snapshot || await pageSnapshot()
  const filename = path.join(previewRoot, `${name}.png`)
  fs.mkdirSync(previewRoot, { recursive: true })
  fs.mkdirSync(sceneRoot, { recursive: true })
  await browser.screenshot(filename)
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
  const scene = { name, filename, sha256, capturedAt: new Date().toISOString(), facts, details,
    state: current, loadedSources: current?.sources || {} }
  fs.writeFileSync(path.join(sceneRoot, `${name}.json`), JSON.stringify(scene, null, 2))
  captures.push({ name, filename, sha256, width: facts.viewport.width,
    theme: currentProfile.theme, capsule:currentProfile.capsule,
    reducedMotion:facts.reducedMotion })
  check(`${name}: browser adapter rendered production markup without binding errors`, facts.errors.length === 0, facts.errors)
  check(`${name}: page fits preview viewport`, facts.pageWidth <= facts.viewport.width + 1,
    { pageWidth: facts.pageWidth, viewportWidth: facts.viewport.width })
  const expectedSources=sourceManifest()
  const loadedSourceMismatches=Object.entries(facts.sources||{}).filter(([file,sha256])=>expectedSources[file]?.sha256!==sha256)
  const requiredLoadedSources=['pages/project-wiring/index.wxml','pages/project-wiring/index.js',
    'pages/project-wiring/workspace-header.wxml','pages/project-wiring/workspace.wxml',
    'pages/project-wiring/workspace-ui.js','pages/project-wiring/workspace.wxss']
  const missingLoadedSources=requiredLoadedSources.filter(file=>!Object.hasOwn(facts.sources||{},file))
  check(`${name}: captured page reports final registered production source hashes`,
    loadedSourceMismatches.length===0&&missingLoadedSources.length===0,
    {loadedSourceMismatches,missingLoadedSources,loadedSources:facts.sources,expected:requiredLoadedSources.map(file=>[file,expectedSources[file]?.sha256])})
  return scene
}

async function headerMatrix() {
  for (const theme of ['light', 'dark']) for (const width of [320, 390, 430]) {
    await navigate(theme, width, { fixture: 'long', capsule: true })
    await delay(30)
    const facts = await pageFacts()
    const { nav, title, projectRow, projectName, actions, share, create } = facts.header
    const titleShareOverlap = Boolean(title && share && title.x < share.right && title.right > share.x &&
      title.y < share.bottom && title.bottom > share.y)
    const titleCentered = Boolean(title && Math.abs((title.x + title.width / 2) - width / 2) <= 2)
    const actionOrder = Boolean(share && create && create.x >= share.right + 6)
    const noOverlap = Boolean(nav && title && projectRow && actions && share && create && !titleShareOverlap && titleCentered && actionOrder &&
      projectName && facts.header.projectButton && projectName.right <= actions.x + 1 &&
      projectRow.bottom <= facts.viewport.height && share.bottom <= projectRow.bottom + 1 && create.bottom <= projectRow.bottom + 1 &&
      share.right <= width && create.right <= width)
    const buttonsFit = Boolean(share && create && share.width >= 44 && share.height >= 44 &&
      create.width >= 64 && create.height >= 44 && share.hitTargetAtCenter && create.hitTargetAtCenter)
    const projectClamped = Boolean(projectName && projectName.text.length > 12 &&
      projectName.overflow.includes('hidden') && projectName.textOverflow === 'ellipsis' &&
      projectName.width <= facts.header.projectButton.width + 1 && projectName.right <= actions.x + 1 &&
      projectName.scrollWidth >= projectName.clientWidth)
    check(`capsule header ${theme}/${width}: long title/name and share/New controls remain reachable`,
      noOverlap && buttonsFit && projectClamped, { noOverlap, titleCentered, buttonsFit, projectClamped,
        header:facts.header, pageWidth:facts.pageWidth })
    await capture(`header-long-${theme}-${width}`, { capsule:true, longFixture:true, checks:{noOverlap,titleCentered,buttonsFit,projectClamped} })
  }

  await navigate('light', 320, { fixture:'long', capsule:true })
  const createTap = await actualTap('.workspace-new', 25)
  const createOpened = await state()
  check('320px New control receives a real hit and opens project creation',
    createTap.trace.some(item=>item.type==='tap' && item.method==='requestNewProject' && item.target && item.currentTarget) && createOpened.data.newProjectVisible,
    { tap:createTap, phase:createOpened.data.workspaceOverlayPhases?.newProject })
  await actualTap('.workspace-new-project-sheet .workspace-close-button', 25)
  await delay(260)
  const shareTap = await actualTap('.workspace-project-share', 35)
  await waitFor('header-share-report', async()=>Boolean((await state()).data.reportPreviewVisible), 6000)
  const shareOpened = await state()
  check('320px Share control receives a real hit and opens the report preview',
    shareTap.trace.some(item=>item.type==='tap' && item.method==='shareProject' && item.target && item.currentTarget) && shareOpened.data.reportPreviewVisible,
    { tap:shareTap, reportVisible:shareOpened.data.reportPreviewVisible, phase:shareOpened.data.workspaceOverlayPhases?.report })
  await capture('header-actions-reachable-320-light', { newProjectTap:createTap.trace, shareTap:shareTap.trace })

  for (const theme of ['light','dark']) {
    await navigate(theme,390,{fixture:'long',viewPreference:{version:1,tab:'devices'}})
    const noProjectFacts=await pageFacts()
    const noProjectState=await state()
    const reachable=Boolean(!noProjectState.data.project && noProjectFacts.header.projectButton &&
      noProjectFacts.header.share?.disabled && noProjectFacts.header.create?.width>=64 && noProjectFacts.header.create?.height>=44 &&
      noProjectFacts.header.projectButton.text.includes('项目'))
    check(`header no-project ${theme}/390 keeps project selection, disabled Share and New reachable`,reachable,
      { project:noProjectState.data.project,header:noProjectFacts.header })
    const headerOnlyIdle=Boolean(!noProjectState.data.project && noProjectFacts.centralStates.length===0)
    check(`header no-project ${theme}/390 normal idle state has no duplicate central prompt or CTA`,headerOnlyIdle,
      { project:noProjectState.data.project,loadError:noProjectState.data.loadError,loadErrorTitle:noProjectState.data.loadErrorTitle,
        centralStates:noProjectFacts.centralStates,headerSelector:noProjectFacts.header.projectButton?.text })
    await capture(`header-no-project-${theme}-390`,{project:noProjectState.data.project,header:noProjectFacts.header,
      loadError:noProjectState.data.loadError,loadErrorTitle:noProjectState.data.loadErrorTitle,centralStates:noProjectFacts.centralStates})
    if (theme==='light') {
      const noProjectNew=await actualTap('.workspace-new',20)
      const newState=await state()
      check('New remains interactive when the module has no selected project',
        newState.data.newProjectVisible && noProjectNew.trace.some(item=>item.type==='tap'&&item.method==='requestNewProject'),
        { visible:newState.data.newProjectVisible,tap:noProjectNew.trace })
      await actualTap('.workspace-new-project-sheet .workspace-close-button',20)
      await delay(260)
    }
  }
}

async function swipeAndDeleteChecks() {
  await navigate('light', 390, { fixture:'long', viewPreference:{version:1,projectId:'qa-project-1',tab:'devices'} })
  const deviceRowSelector = '.workspace-device-swipe-row[data-swipe-id="receiver-1"]'
  await retainNode(deviceRowSelector, 'device-swipe-row')
  let result = await actualSwipe(`${deviceRowSelector} .workspace-device-meta`, -125, 0, 280, 8)
  const device = result.after?.data?.devices?.find(item => item.id === 'receiver-1')
  const deviceDelete = result.facts.deleteButtons.find(item => item.type === 'device' && item.id === 'receiver-1')
  const deviceOffsets = result.progress.map(item=>Number(item.offset)||0)
  const deviceDeleteCenters = result.progress.map(item=>item.deleteCenterX).filter(Number.isFinite)
  const deviceFollowsFinger = deviceOffsets.length >= 5 && deviceOffsets.some(value=>value>5 && value<66) &&
    deviceOffsets.every((value,index)=>index===0 || value+1>=deviceOffsets[index-1]) && Math.max(...deviceOffsets)<=73
  const deviceIconStable = deviceDeleteCenters.length >= 5 && Math.max(...deviceDeleteCenters)-Math.min(...deviceDeleteCenters)<=2
  const stableEvents = result.events.filter(item => ['touchstart','touchmove','touchend','touchcancel'].includes(item.type))
  const routed = stableEvents.length >= 3 && stableEvents.some(item => item.type === 'touchstart') &&
    stableEvents.some(item => item.type === 'touchmove') && stableEvents.some(item => item.type === 'touchend') &&
    stableEvents.every(item => item.target && item.currentTarget && item.currentTarget.dataset?.swipeId === 'receiver-1')
  check('device swipe follows a real touch path, reveals Delete, and never deletes by swipe alone',
    Boolean(device && device.swipeOpen && deviceDelete && deviceDelete.width >= 44 && deviceDelete.height >= 44 &&
      deviceDelete.hitTargetAtCenter && result.after.schedule.revision === result.before.schedule.revision &&
      result.after.events.modals.length === result.before.events.modals.length && routed && deviceFollowsFinger && deviceIconStable &&
      await nodeRetained(deviceRowSelector,'device-swipe-row')),
    { device, deviceDelete, beforeRevision:result.before.schedule.revision, afterRevision:result.after.schedule.revision,
      routed, deviceOffsets, deviceFollowsFinger, deviceDeleteCenters, deviceIconStable, rowNodeRetained:await nodeRetained(deviceRowSelector,'device-swipe-row'),
      events:stableEvents, gesture:result.gesture })
  await capture('device-swipe-delete-open', { deviceDelete, events:stableEvents, progress:result.progress, gesture:result.gesture })

  const deviceDeleteSelector = '.workspace-device-swipe-row[data-swipe-id="receiver-1"] .workspace-swipe-delete'
  const deleteTap = await actualTap(deviceDeleteSelector, 40)
  let stateNow = await state()
  const prompt = stateNow.events.modals.at(-1)
  const expectedDeviceLineIds = stateNow.schedule.lines.filter(item=>item.fromDeviceId==='receiver-1'||item.toDeviceId==='receiver-1').map(item=>item.id)
  check('device Delete requires a real hit and confirms the exact connected-line cascade',
    Boolean(deleteTap.response?.point && prompt && String(prompt.content).includes(String(expectedDeviceLineIds.length)) &&
      deleteTap.trace.some(item=>item.type==='tap'&&item.method==='deleteWorkspaceRecord'&&item.target&&item.currentTarget) &&
      stateNow.schedule.revision === result.before.schedule.revision &&
      stateNow.schedule.devices.some(item => item.id === 'receiver-1')),
    { prompt, expectedDeviceLineIds, state:stateNow, tap:deleteTap })
  await capture('device-delete-confirmation-pending', { prompt, expectedDeviceLineIds, tap:deleteTap.trace })
  const cancelBefore = stateNow.schedule.revision
  await modalChoice(false)
  stateNow = await state()
  check('device confirmation Cancel leaves record and connected lines untouched',
    stateNow.schedule.revision === cancelBefore && stateNow.schedule.devices.some(item => item.id === 'receiver-1') && stateNow.schedule.lines.length === 4,
    { revision:stateNow.schedule.revision, devicePresent:stateNow.schedule.devices.some(item => item.id === 'receiver-1'), lineCount:stateNow.schedule.lines.length })

  await navigate('dark', 390, { fixture:'long', viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'} })
  const lineRowSelector = '.workspace-line-swipe-row[data-swipe-id="qa-line-1"]'
  await retainNode(lineRowSelector, 'line-swipe-row')
  result = await actualSwipe(`${lineRowSelector} .workspace-line-chevron`, -180, 0, 280, 8)
  const line = result.after?.data?.groups?.flatMap(group => group.lines).find(item => item.id === 'qa-line-1')
  const lineDelete = result.facts.deleteButtons.find(item => item.type === 'line' && item.id === 'qa-line-1')
  const lineOffsets = result.progress.map(item=>Number(item.offset)||0)
  const lineDeleteCenters = result.progress.map(item=>item.deleteCenterX).filter(Number.isFinite)
  const lineFollowsFinger = lineOffsets.length >= 5 && lineOffsets.some(value=>value>5 && value<66) &&
    lineOffsets.every((value,index)=>index===0 || value+1>=lineOffsets[index-1]) && Math.max(...lineOffsets)<=73
  const lineIconStable = lineDeleteCenters.length >= 5 && Math.max(...lineDeleteCenters)-Math.min(...lineDeleteCenters)<=2
  const lineEvents = result.events.filter(item => ['touchstart','touchmove','touchend','touchcancel'].includes(item.type))
  check('line swipe reveals the selected Delete target without deleting the line',
    Boolean(line && line.swipeOpen && lineDelete && lineDelete.width >= 44 && lineDelete.height >= 44 &&
      result.after.schedule.revision === result.before.schedule.revision && result.after.schedule.lines.some(item => item.id === 'qa-line-1') &&
      lineDelete.hitTargetAtCenter && lineEvents.some(item => item.type === 'touchmove') &&
      lineEvents.every(item => item.target && item.currentTarget && item.currentTarget.dataset?.swipeId === 'qa-line-1') &&
      lineFollowsFinger && lineIconStable && await nodeRetained(lineRowSelector,'line-swipe-row')),
    { line, lineDelete, revisionBefore:result.before.schedule.revision, revisionAfter:result.after.schedule.revision,
      lineIds:result.after.schedule.lines.map(item => item.id), lineOffsets, lineFollowsFinger, lineDeleteCenters, lineIconStable,
      rowNodeRetained:await nodeRetained(lineRowSelector,'line-swipe-row'), events:lineEvents, gesture:result.gesture })
  await capture('line-swipe-delete-open', { lineDelete, events:lineEvents, progress:result.progress, gesture:result.gesture })
  const lineTap = await actualTap('.workspace-line-swipe-row[data-swipe-id="qa-line-1"] .workspace-swipe-delete', 40)
  stateNow = await state()
  const linePrompt = stateNow.events.modals.at(-1)
  check('line Delete requires a real button hit and opens confirmation for the selected stable ID',
    Boolean(lineTap.response?.point && linePrompt && lineTap.trace.some(item=>item.type==='tap'&&item.method==='deleteWorkspaceRecord'&&item.target&&item.currentTarget) &&
      stateNow.schedule.revision === result.before.schedule.revision && stateNow.schedule.lines.some(item => item.id === 'qa-line-1')),
    { prompt:linePrompt, lineIds:stateNow.schedule.lines.map(item => item.id), tap:lineTap })
  await modalChoice(false)
  stateNow = await state()
  check('line confirmation Cancel preserves the original line', stateNow.schedule.lines.some(item => item.id === 'qa-line-1'),
    { lineIds:stateNow.schedule.lines.map(item => item.id), revision:stateNow.schedule.revision })

  await navigate('dark',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'},reducedMotion:'no-preference'})
  const lastLineRowSelector='.workspace-line-swipe-row[data-swipe-id="qa-line-4"]'
  const groupBeforeFacts=await pageFacts()
  const lastLineGroupBefore=groupBeforeFacts.groups.find(group=>group.lineIds.includes('qa-line-4'))
  const adjacentGroupBefore=groupBeforeFacts.groups.find(group=>group.key!==lastLineGroupBefore?.key)
  await browser.evaluate(`window.__qaRetainedNodes=window.__qaRetainedNodes||{};window.__qaRetainedNodes['last-line-group']=document.querySelector(${JSON.stringify(lastLineRowSelector)})?.closest('.workspace-line-group')`)
  result=await actualSwipe(`${lastLineRowSelector} .workspace-line-chevron`,-180,0,280,8)
  const lastLineDelete=result.facts.deleteButtons.find(item=>item.type==='line'&&item.id==='qa-line-4')
  check('last line in the receiver-to-mixer-duplicate group reveals a tappable target without deleting on swipe',
    Boolean(lastLineGroupBefore&&lastLineDelete&&lastLineDelete.width>=44&&lastLineDelete.height>=44&&lastLineDelete.hitTargetAtCenter&&
      result.after.schedule.lines.some(item=>item.id==='qa-line-4')&&result.after.schedule.revision===result.before.schedule.revision&&
      result.progress.some(item=>Number(item.offset)>0)),
    { targetGroup:lastLineGroupBefore,neighborGroup:adjacentGroupBefore,deleteButton:lastLineDelete,
      revisionBefore:result.before.schedule.revision,revisionAfter:result.after.schedule.revision,progress:result.progress })
  await capture('last-line-group-delete-open',{targetGroup:lastLineGroupBefore,neighborGroup:adjacentGroupBefore,deleteButton:lastLineDelete,progress:result.progress})
  const lastLineTap=await actualTap(`${lastLineRowSelector} .workspace-swipe-delete`,35)
  stateNow=await state()
  const lastLinePrompt=stateNow.events.modals.at(-1)
  check('last-line Delete button opens confirmation for the selected stable line ID',
    Boolean(lastLineTap.response?.point&&lastLineTap.trace.some(item=>item.type==='tap'&&item.method==='deleteWorkspaceRecord'&&item.target&&item.currentTarget)&&
      lastLinePrompt&&stateNow.schedule.lines.some(item=>item.id==='qa-line-4')),
    { prompt:lastLinePrompt,ids:stateNow.schedule.lines.map(item=>item.id),tap:lastLineTap.trace })
  await capture('last-line-group-confirmation-pending',{prompt:lastLinePrompt,tap:lastLineTap.trace})
  await modalChoice(true)
  const groupRemovalStarted=Date.now()
  const groupRemovalSamples=[]
  for(const elapsed of [0,70,145,220,330]){
    const remaining=elapsed-(Date.now()-groupRemovalStarted)
    if(remaining>0)await delay(remaining)
    const facts=await pageFacts()
    const snapshot=await state()
    const targetGroup=facts.groups.find(group=>group.key===lastLineGroupBefore.key)
    const neighborGroup=facts.groups.find(group=>group.key===adjacentGroupBefore?.key)
    const groupKeyExpression=JSON.stringify(lastLineGroupBefore.key)
    const domRetention=await browser.evaluate(`(()=>{const key=${groupKeyExpression};const header=[...document.querySelectorAll('.workspace-group-header')].find(node=>node.dataset.key===key);return Boolean(window.__qaRetainedNodes['last-line-group']&&window.__qaRetainedNodes['last-line-group']===header?.closest('.workspace-line-group'))})()`)
    const sample={elapsed,actualElapsed:Date.now()-groupRemovalStarted,revision:snapshot.schedule.revision,
      lineStillStored:snapshot.schedule.lines.some(item=>item.id==='qa-line-4'),targetGroup,neighborGroup,
      targetNodeRetained:domRetention}
    // Read scroll height in-page so the saved sample stays bound to the same DOM snapshot.
    sample.scrollHeight=await browser.evaluate('document.querySelector(".workspace-scroll")?.scrollHeight||0')
    groupRemovalSamples.push(sample)
    if([70,145,220].includes(elapsed))await capture(`last-line-group-removal-${elapsed}ms`,sample)
  }
  const nearEndNeighbor=groupRemovalSamples[3].neighborGroup
  const finalNeighbor=groupRemovalSamples.at(-1).neighborGroup
  const neighborCleanupStep=nearEndNeighbor&&finalNeighbor?Math.abs(finalNeighbor.outer.y-nearEndNeighbor.outer.y):null
  const groupExitClassObserved=Boolean(groupRemovalSamples[1].targetGroup?.outerClassName.includes('workspace-line-group-retiring-exit'))
  check('confirming last-line deletion commits the line, collapses its whole group, and leaves no end-of-exit layout jump',
    Boolean(lastLinePrompt&&!groupRemovalSamples[0].lineStillStored&&groupRemovalSamples[1].targetGroup?.outer.height>0&&
      groupRemovalSamples[2].targetGroup?.outer.height>0&&groupRemovalSamples[2].targetGroup?.outer.height<=12&&
      !groupRemovalSamples[3].targetGroup&&!groupRemovalSamples[3].lineStillStored&&
      groupRemovalSamples[1].targetNodeRetained&&groupRemovalSamples[2].targetNodeRetained&&
      groupExitClassObserved&&(!adjacentGroupBefore||neighborCleanupStep<=12)),
    { prompt:lastLinePrompt,targetGroupKey:lastLineGroupBefore.key,neighborGroupKey:adjacentGroupBefore?.key,
      neighborCleanupStep,groupExitClassObserved,cleanupDelayFromMidMs:groupRemovalSamples[4].actualElapsed-groupRemovalSamples[3].actualElapsed,
      samples:groupRemovalSamples })
  interactionCases.push({kind:'last-line-group-removal',samples:groupRemovalSamples,neighborCleanupStep})

  // Confirm one device deletion to inspect the real data-driven removal lifecycle.
  await navigate('dark', 390, { fixture:'long', viewPreference:{version:1,projectId:'qa-project-1',tab:'devices'}, reducedMotion:'no-preference' })
  await browser.swipe(`${deviceRowSelector} .workspace-device-meta`, -125, 0, 280, 8)
  await delay(230)
  await retainNode(deviceRowSelector, 'device-removal-row')
  await actualTap('.workspace-device-swipe-row[data-swipe-id="receiver-1"] .workspace-swipe-delete', 30)
  const confirmState = await state()
  const confirmPrompt = confirmState.events.modals.at(-1)
  const revisionBeforeDelete = confirmState.schedule.revision
  await capture('device-delete-confirmation-before-confirm', { prompt:confirmPrompt, revisionBeforeDelete })
  await modalChoice(true)
  const removalStartedAt=Date.now()
  const removalSamples = []
  for (const elapsed of [0, 60, 140, 210, 260, 390]) {
    const remaining=elapsed-(Date.now()-removalStartedAt)
    if (remaining>0) await delay(remaining)
    const facts = await pageFacts()
    const snapshot = await state()
    const retiring = facts.rows.find(item => item.id === 'receiver-1' || item.className.includes('retiring'))
    removalSamples.push({ elapsed, actualElapsed:Date.now()-removalStartedAt, phase:snapshot.data.workspaceRetiringRow?.phase || '',
      scheduleRevision:snapshot.schedule.revision, deviceExists:snapshot.schedule.devices.some(item => item.id === 'receiver-1'),
      row:retiring, rowNodeRetained:await nodeRetained(deviceRowSelector,'device-removal-row'), overlayPhase:snapshot.data.workspaceOverlayPhases })
    if (elapsed === 60 || elapsed === 140 || elapsed === 210) await capture(`device-removal-${elapsed}ms`, removalSamples.at(-1))
  }
  check('confirmed deletion saves first, then fades/collapses a retained ghost and clears it',
    confirmPrompt && removalSamples[0].scheduleRevision > revisionBeforeDelete && !removalSamples[0].deviceExists &&
      removalSamples[1].row && removalSamples[1].row.height > 0 && removalSamples[2].row &&
      Number(removalSamples[2].row.opacity) < Number(removalSamples[1].row.opacity) &&
      removalSamples[2].row.height <= 12 && removalSamples[2].rowNodeRetained &&
      !removalSamples[3].row && !removalSamples.at(-1).row && !removalSamples.at(-1).deviceExists,
    { prompt:confirmPrompt, revisionBeforeDelete, samples:removalSamples })
  interactionCases.push({ kind:'delete', confirmation:confirmPrompt, samples:removalSamples })
}

async function groupMotionChecks() {
  await navigate('light', 390, { fixture:'long', viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'}, reducedMotion:'no-preference' })
  const before = await pageFacts()
  const selector = '.workspace-group-header'
  const beforeGroup = before.groups[0]
  const beforeNextTop = before.groups[1]?.header?.y
  await retainNode('.workspace-group-lines','group-lines')
  const beforeTap = await actualTap(selector, 20)
  const immediate = await pageFacts()
  const immediateState = await state()
  const groupTapRouted = beforeTap.trace.some(item=>item.type==='tap' && item.method==='toggleGroup' && item.target && item.currentTarget)
  check('group header receives an actual touch tap and updates its logical state immediately',
    groupTapRouted && immediateState.data.groups[0]?.collapsed === true && immediate.groups[0]?.linesAriaHidden === 'true' &&
      immediate.groups[0]?.expanded === 'false' && await nodeRetained('.workspace-group-lines','group-lines'),
    { tap:beforeTap, logicalCollapsed:immediateState.data.groups[0]?.collapsed,
      ariaHidden:immediate.groups[0]?.linesAriaHidden, expanded:immediate.groups[0]?.expanded,
      nodeRetained:await nodeRetained('.workspace-group-lines','group-lines'), adapterStats:immediate.adapterStats })
  await delay(95)
  const middle = await pageFacts()
  await capture('group-collapse-mid-motion', { beforeGroup, beforeNextTop, middle:firstGroup(middle), nextGroupTop:middle.groups[1]?.header?.y,
    groupLinesNodeRetained:await nodeRetained('.workspace-group-lines','group-lines') })
  await delay(150)
  const after = await pageFacts()
  check('real group-header tap collapses neighbors through intermediate height and settles cleanly',
    Boolean(beforeGroup?.lines?.height > 0 && middle.groups[0]?.lines?.height > 0 &&
      middle.groups[0].lines.height < beforeGroup.lines.height && after.groups[0]?.lines?.height <= 1 &&
      middle.groups[1]?.header?.y < beforeNextTop && after.groups[1]?.header?.y < middle.groups[1]?.header?.y &&
      middle.groups[0]?.linesAriaHidden === 'true' && middle.groups[0]?.expanded === 'false' &&
      await nodeRetained('.workspace-group-lines','group-lines')),
    { beforeGroup, beforeNextTop, middle:firstGroup(middle), middleNextTop:middle.groups[1]?.header?.y,
      after:firstGroup(after), afterNextTop:after.groups[1]?.header?.y, nodeRetained:await nodeRetained('.workspace-group-lines','group-lines') })
  const expandTap = await actualTap(selector, 20)
  await delay(230)
  const expanded = await pageFacts()
  check('real group-header tap restores retained content after expansion',
    expandTap.trace.some(item=>item.type==='tap' && item.method==='toggleGroup') && expanded.groups[0]?.lines?.height > 0 &&
      expanded.groups[0]?.linesAriaHidden === 'false' && expanded.groups[0]?.expanded === 'true' &&
      await nodeRetained('.workspace-group-lines','group-lines'),
    { group:firstGroup(expanded), tap:expandTap.trace, nodeRetained:await nodeRetained('.workspace-group-lines','group-lines') })
  await capture('group-expand-settled', { group:firstGroup(expanded), adapterStats:expanded.adapterStats })

  const tabTransition = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-tab');const s=n&&getComputedStyle(n);const p=n&&getComputedStyle(n,'::before');const c=document.querySelector('.workspace-tab-content');return{button:s?{transition:s.transition,transitionDuration:s.transitionDuration}:null,indicator:p?{transition:p.transition,transitionDuration:p.transitionDuration}:null,content:c?{animation:c.style.animation,animationDuration:getComputedStyle(c).animationDuration}:null}})()`)
  check('normal-motion tab, indicator and content declarations stay within short target durations',
    tabTransition.button && maxCssTime(tabTransition.indicator?.transitionDuration) <= 200 &&
      maxCssTime(tabTransition.content?.animationDuration) > 0 && maxCssTime(tabTransition.content?.animationDuration) <= 300,
    tabTransition)
  const tabTap = await actualTap('.workspace-tab[data-tab="devices"]', 10)
  const tabState = await state()
  const tabStart = await pageFacts()
  check('tab control receives a real tap, changes logical view immediately and uses the short content entrance',
    tabTap.trace.some(item=>item.type==='tap' && item.method==='onWorkspaceTab' && item.target && item.currentTarget) &&
      tabState.data.workspaceTab === 'devices' && maxCssTime(tabStart.tabContent?.animationDuration) <= 300 &&
      tabStart.tabs.some(item=>item.tab==='devices'&&item.className.includes('workspace-tab-active')),
    { tap:tabTap.trace, tab:tabState.data.workspaceTab, facts:tabStart, declarations:tabTransition })
  await capture('tab-devices-enter-mid', { tap:tabTap.trace, declarations:tabTransition })
  await delay(180)
  const lineTabTap = await actualTap('.workspace-tab[data-tab="lines"]', 10)
  const lineTabState = await state()
  await delay(170)
  const lineTabFacts = await pageFacts()
  check('line tab reverses to its own logical content and settles within the short motion window',
    lineTabTap.trace.some(item=>item.type==='tap' && item.method==='onWorkspaceTab') && lineTabState.data.workspaceTab==='lines' &&
      lineTabFacts.tabs.some(item=>item.tab==='lines'&&item.className.includes('workspace-tab-active')) &&
      maxCssTime(lineTabFacts.tabContent?.animationDuration)<=300,
    { tap:lineTabTap.trace, tab:lineTabState.data.workspaceTab, facts:lineTabFacts })
  await capture('tab-lines-enter-settled', { tap:lineTabTap.trace, facts:lineTabFacts })

  await navigate('dark', 390, { fixture:'long', viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'}, reducedMotion:'reduce' })
  await actualTap('.workspace-group-header', 10)
  const reduced = await pageFacts()
  check('reduced-motion group toggle changes logical collapsed state without waiting on animation',
    Boolean((await state()).data.groups[0]?.collapsed) && reduced.groups[0]?.lines?.height <= 1 &&
      reduced.groups[0]?.linesAriaHidden==='true' && reduced.groups[0]?.expanded==='false',
    { collapsed:(await state()).data.groups[0]?.collapsed, group:firstGroup(reduced), reducedMotion:reduced.reducedMotion })
}

function firstGroup(facts) { return facts.groups[0] || null }

async function overlayCloseCheck(spec) {
  const openTap = await spec.open()
  await waitFor(`${spec.name}-open`, async () => spec.isVisible(await state()), spec.openTimeout || 3500)
  const opening = await pageFacts()
  const opened = await state()
  const observedOpenPhase = spec.phase(openTap?.state || opened)
  const openPhaseSeen = observedOpenPhase==='preparing' || observedOpenPhase==='opening'
  const openingOverlay = overlayFact(opening,spec)
  const openDurationMs = maxCssTime(openingOverlay?.sheet?.transitionDuration)
  const openContent = spec.seed ? await spec.seed() : null
  const meaningfulBeforeClose = await contentSnapshot(spec.contentSelector)
  await retainNode(spec.contentSelector, `${spec.name}-content`)
  check(`${spec.name}: actual open handler runs and enters its 300ms opening phase`,
    openPhaseSeen && openTap?.trace?.some(item=>item.type==='tap' && item.method===spec.openMethod && item.target && item.currentTarget) &&
      Math.abs(openDurationMs-300)<=2,
    { observedOpenPhase, openDurationMs, openMethod:spec.openMethod, openTap:openTap?.trace || [], overlay:openingOverlay })
  await capture(`${spec.name}-opened`, { openTap:openTap?.trace || [], observedOpenPhase, openDurationMs, openContent, meaningfulBeforeClose })
  const closeTap = await actualTap(spec.closeSelector, 0, { downMs:15, clickWaitMs:0, skipState:true })
  let closeActionAt = closeTap.rawTouch.find(item=>item.type==='touchend')?.timeStamp
  let closingSnapshot = await pageSnapshot(false)
  let closedFlag = closingSnapshot.state
  const modalPrompts = closedFlag.events.modals.length - opened.events.modals.length
  let modalConfirmation = null
  if (modalPrompts > 0 && spec.confirmDirtyClose) {
    modalConfirmation = closedFlag.events.modals.at(-1)
    await modalChoice(true)
    closeActionAt = await browser.evaluate('performance.now()')
    closingSnapshot = await pageSnapshot(false)
    closedFlag = closingSnapshot.state
  }
  if (!Number.isFinite(closeActionAt)) closeActionAt = await browser.evaluate('performance.now()')
  const immediateSnapshotAt = await browser.evaluate('performance.now()')
  const mid = closingSnapshot.facts
  const phase = spec.phase(closedFlag)
  const closingOverlay = overlayFact(mid,spec)
  const contentExists = Boolean(closingOverlay?.sheet)
  const afterCloseContent = closingOverlay?.sheetContent || null
  const sameContent = JSON.stringify(meaningfulBeforeClose) === JSON.stringify(afterCloseContent)
  const tapTrace = closeTap.trace || []
  const hasTouchRoutedClose = Boolean(closeTap.response?.point &&
    closeTap.rawTouch.some(item=>item.type==='touchstart'&&item.matchesExpected) &&
    closeTap.rawTouch.some(item=>item.type==='touchend'&&item.matchesExpected) &&
    tapTrace.some(item => item.type==='tap' && item.method===spec.closeMethod && item.target && item.currentTarget))
  const closeDurationMs = maxCssTime(closingOverlay?.sheet?.transitionDuration)
  const nodePreserved = await nodeRetained(spec.contentSelector,`${spec.name}-content`)
  check(`${spec.name}: real close tap updates state, retains content through exit, then removes sheet`,
    !spec.isVisible(closedFlag) && phase === 'closing' && contentExists &&
      closingOverlay?.ariaHidden === 'true' && hasTouchRoutedClose && sameContent && nodePreserved &&
      Math.abs(openDurationMs-300)<=2 && Math.abs(closeDurationMs-240)<=2,
    { open:spec.visibleSummary(opened), closed:spec.visibleSummary(closedFlag), phase, contentExists, sameContent, meaningfulBeforeClose, afterCloseContent,
      openingDurationMs:openDurationMs, closeDurationMs, nodePreserved, overlay:closingOverlay,
      modalConfirmation, hasTouchRoutedClose, tapTrace, rawTouch:closeTap.rawTouch, openTap:openTap?.trace || [],
      closeActionAt, immediateSnapshotAt, closeToSnapshotMs:immediateSnapshotAt-closeActionAt })
  await delay(Math.max(0,(spec.midWaitMs||55)-(await browser.evaluate('performance.now()')-closeActionAt)))
  const middleSnapshot = await pageSnapshot(true)
  const middleSnapshotAt = await browser.evaluate('performance.now()')
  const middleFacts = middleSnapshot.facts
  const midSnapshot = middleSnapshot.state
  const midPhase = spec.phase(midSnapshot)
  const middleOverlay = overlayFact(middleFacts,spec)
  const midContent = Boolean(middleOverlay?.sheet)
  const middleContent = middleOverlay?.sheetContent || null
  const middleNodePreserved = await nodeRetained(spec.contentSelector,`${spec.name}-content`)
  check(`${spec.name}: meaningful sheet content and the same DOM node remain mounted mid-exit`,
    midPhase === 'closing' && midContent && JSON.stringify(meaningfulBeforeClose)===JSON.stringify(middleContent) &&
      middleNodePreserved && middleOverlay?.ariaHidden==='true',
    { phase:midPhase, contentExists:midContent, meaningfulBeforeClose, middleContent, overlay:middleOverlay,
      closeToMiddleSnapshotMs:middleSnapshotAt-closeActionAt,
      nodePreserved:middleNodePreserved, adapterStats:middleFacts.adapterStats })
  await capture(`${spec.name}-closing-middle`, { phase:midPhase, content:middleContent, overlay:middleOverlay,
    closeToMiddleSnapshotMs:middleSnapshotAt-closeActionAt, nodePreserved:middleNodePreserved },middleSnapshot)
  await delay(spec.endWaitMs || 240)
  const settledSnapshot = await pageSnapshot(true)
  const settled = settledSnapshot.state
  const remains = Boolean(overlayFact(settledSnapshot.facts,spec))
  check(`${spec.name}: exit timer clears after animation with no stale overlay`, spec.phase(settled) === '' && !spec.isVisible(settled) && !remains,
    { phase:spec.phase(settled), visible:spec.visibleSummary(settled), remains })
  await capture(`${spec.name}-closed-settled`, { phase:spec.phase(settled), remains },settledSnapshot)
}

async function allOverlayChecks() {
  const isVisible = key => snapshot => Boolean(snapshot?.data?.[key])
  const overlay = (name, open, key, phaseName, maskClass, maskSelector, contentSelector, closeSelector, closeMethod, sheetClass, extra={}) => ({
    name, open, visibleKey:key, maskClass, maskSelector, contentSelector, closeSelector, closeMethod, sheetClass, ...extra,
    phase:snapshot => snapshot?.data?.workspaceOverlayPhases?.[phaseName] || '',
    isVisible:isVisible(key), visibleSummary:snapshot => snapshot?.data?.[key], midWaitMs:55, endWaitMs:260,
  })
  const cases = [
    overlay('project-picker', async()=>{ await navigate('light',390,{fixture:'long'}); return actualTap('.workspace-project-button',20) }, 'projectPickerVisible','projectPicker','workspace-wheel-mask','.workspace-wheel-mask','.workspace-wheel-sheet','.workspace-wheel-cancel','cancelProjectPicker','workspace-wheel-sheet',{openMethod:'requestProjectPicker'}),
    overlay('new-project', async()=>{ await navigate('light',390,{fixture:'long'}); return actualTap('.workspace-new',20) }, 'newProjectVisible','newProject','workspace-mask','.workspace-mask:has(.workspace-new-project-sheet)','.workspace-new-project-sheet','.workspace-new-project-sheet .workspace-close-button','closeNewProject','workspace-new-project-sheet',{
      openMethod:'requestNewProject',
      seed:()=>typeInto('.workspace-new-project-sheet input','Retained QA project name'), confirmDirtyClose:false }),
    overlay('device-editor', async()=>{ await navigate('light',390,{fixture:'long'}); return actualTap('.workspace-bottom-bar .workspace-primary-button',20) }, 'deviceEditorVisible','deviceEditor','workspace-mask','.workspace-mask','.workspace-device-sheet','.workspace-device-sheet .workspace-close-button','requestCloseDeviceEditor','workspace-device-sheet',{
      openMethod:'openDeviceEditor',
      seed:()=>typeInto('.workspace-device-sheet input','Retained device name'), confirmDirtyClose:true }),
    overlay('line-details', async()=>{ await navigate('light',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'}}); return actualTap('.workspace-line-row[data-id="qa-line-1"]',20) }, 'detailVisible','lineDetails','workspace-detail-mask','.workspace-detail-mask','.workspace-detail-sheet','.workspace-detail-sheet .workspace-close-button','closeLineDetails','workspace-detail-sheet',{openMethod:'onLineTap'}),
    overlay('line-editor', async()=>{ await navigate('light',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'}}); return actualTap('.workspace-bottom-bar .workspace-primary-button',20) }, 'editorVisible','lineEditor','workspace-mask','.workspace-mask','.workspace-editor-sheet','.workspace-editor-sheet .workspace-close-button','requestCloseEditor','workspace-editor-sheet',{
      openMethod:'openNewLine',
      seed:()=>typeInto('.workspace-editor-sheet input.workspace-control','Retained port name'), confirmDirtyClose:true }),
    overlay('continuous-editor', async()=>{ await navigate('light',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'}}); await actualTap('.workspace-bottom-bar .workspace-primary-button',20); await delay(320); return actualTap('.workspace-continuous-button',20) }, 'continuousVisible','continuous','workspace-continuous-mask','.workspace-continuous-mask','.workspace-continuous-sheet','.workspace-continuous-sheet .workspace-close-button','closeContinuous','workspace-continuous-sheet',{
      openMethod:'openContinuous',
      seed:()=>typeInto('.workspace-continuous-sheet input','Retained endpoint'), confirmDirtyClose:false }),
    overlay('report-preview', async()=>{ await navigate('light',390,{fixture:'long'}); const tap=await actualTap('.workspace-project-share',20); await waitFor('report-preview-open',async()=>Boolean((await state()).data.reportPreviewVisible),6000); tap.state=await state(); return tap }, 'reportPreviewVisible','report','wiring-report-mask','.wiring-report-mask','.wiring-report-sheet','.wiring-report-mask .wiring-close-button','closeReportPreview','wiring-report-sheet',{openMethod:'shareProject'}),
  ]
  for (const spec of cases) {
    try { await overlayCloseCheck(spec) }
    catch (error) { check(`${spec.name}: open/close flow completed through actual adapter taps`, false, error.stack || String(error)) }
  }
}

async function rapidReopenCheck() {
  await navigate('dark', 390, { fixture:'long', reducedMotion:'no-preference' })
  await actualTap('.workspace-project-button', 25)
  const opened = await state()
  await retainNode('.workspace-wheel-sheet','picker-sheet')
  await actualTap('.workspace-wheel-cancel', 5, { downMs:20, clickWaitMs:0 })
  const closing = await state()
  await delay(65)
  await actualTap('.workspace-project-button', 5, { downMs:20, clickWaitMs:0 })
  const reopened = await state()
  const facts = await pageFacts()
  const content = await browser.evaluate("document.querySelector('.workspace-wheel-sheet')?.innerText || ''")
  const sameNode = await nodeRetained('.workspace-wheel-sheet','picker-sheet')
  check('rapid close/reopen reverses the current project-sheet state without a blank or stale close',
    opened.data.projectPickerVisible && !closing.data.projectPickerVisible && reopened.data.projectPickerVisible &&
      reopened.data.workspaceOverlayPhases.projectPicker !== 'closing' && Boolean(content.trim()) && sameNode &&
      facts.overlays.some(item=>item.className.includes('workspace-wheel-mask') && item.opacity !== '0'),
    { openedPhase:opened.data.workspaceOverlayPhases.projectPicker, closingPhase:closing.data.workspaceOverlayPhases.projectPicker,
      reopenedPhase:reopened.data.workspaceOverlayPhases.projectPicker, visible:reopened.data.projectPickerVisible, content,
      sameNode, overlays:facts.overlays })
  await capture('project-sheet-rapid-reopen', { closingPhase:closing.data.workspaceOverlayPhases.projectPicker,
    reopenedPhase:reopened.data.workspaceOverlayPhases.projectPicker, content, sameNode })
  await delay(320)
  const settled = await state()
  check('rapid reopen exit timer does not blank the re-opened project sheet', settled.data.projectPickerVisible &&
    Boolean(await browser.evaluate("document.querySelector('.workspace-wheel-sheet')")),
    { visible:settled.data.projectPickerVisible, phase:settled.data.workspaceOverlayPhases.projectPicker })
}

async function reducedMotionChecks() {
  await navigate('dark',390,{fixture:'long',reducedMotion:'reduce'})
  await actualTap('.workspace-new',20)
  const open = await state()
  const openOverlay = (await pageFacts()).overlays.find(item=>item.className.includes('workspace-mask'))
  const closeTap = await actualTap('.workspace-new-project-sheet .workspace-close-button',5,{downMs:15,clickWaitMs:0})
  const closing = await state()
  const closingFacts = await pageFacts()
  const closingOverlay = closingFacts.overlays.find(item=>item.className.includes('workspace-mask'))
  const retainedSheet = await browser.evaluate("Boolean(document.querySelector('.workspace-new-project-sheet'))")
  check('reduced-motion sheet close hides the retained overlay immediately while preserving its close phase',
    open.data.newProjectVisible && !closing.data.newProjectVisible && closing.data.workspaceOverlayPhases.newProject==='closing' &&
      retainedSheet && closingOverlay?.visibility==='hidden' && closingOverlay?.pointerEvents==='none' && closingOverlay?.ariaHidden==='true' &&
      maxCssTime(closingOverlay?.sheet?.transitionDuration)===0 &&
      closeTap.trace.some(item=>item.type==='tap'&&item.method==='closeNewProject'),
    { openPhase:open.data.workspaceOverlayPhases.newProject, closePhase:closing.data.workspaceOverlayPhases.newProject,
      retainedSheet, overlay:closingOverlay, tap:closeTap.trace, reducedMotion:closingFacts.reducedMotion })
  await capture('reduced-motion-sheet-closing', { phase:closing.data.workspaceOverlayPhases.newProject, overlay:closingOverlay, tap:closeTap.trace })
  await delay(260)
  const settled = await state()
  check('reduced-motion sheet cleanup timer still clears normally',
    settled.data.workspaceOverlayPhases.newProject==='' && !await browser.evaluate("document.querySelector('.workspace-new-project-sheet')"),
    { phase:settled.data.workspaceOverlayPhases.newProject })

  await navigate('dark',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'devices'},reducedMotion:'reduce'})
  const rowSelector='.workspace-device-swipe-row[data-swipe-id="receiver-1"]'
  const before=await state()
  await browser.swipe(`${rowSelector} .workspace-device-meta`,-125,0,280,8)
  await delay(230)
  await actualTap(`${rowSelector} .workspace-swipe-delete`,25)
  await modalChoice(true)
  await delay(25)
  const reducedDelete=await state()
  const reducedFacts=await pageFacts()
  const removed=reducedFacts.rows.find(item=>item.id==='receiver-1')
  check('reduced-motion deletion saves immediately and hides its retained ghost without transition delay',
    reducedFacts.reducedMotion && reducedDelete.schedule.revision>before.schedule.revision &&
      !reducedDelete.schedule.devices.some(item=>item.id==='receiver-1') && removed &&
      removed.height<=1 && Number(removed.opacity)===0,
    { beforeRevision:before.schedule.revision, afterRevision:reducedDelete.schedule.revision, row:removed,
      deviceExists:reducedDelete.schedule.devices.some(item=>item.id==='receiver-1'), reducedMotion:reducedFacts.reducedMotion })
  await capture('reduced-motion-delete-ghost-hidden', { row:removed, revision:reducedDelete.schedule.revision })
  await delay(220)
  check('reduced-motion deletion removes the ghost after its short cleanup',
    !(await pageFacts()).rows.some(item=>item.id==='receiver-1'), { rows:(await pageFacts()).rows })
}

function runControllerSuiteIsolated() {
  const controllerRoot = path.join(evidenceRoot, 'controller')
  fs.mkdirSync(controllerRoot, { recursive:true })
  const support = './tests/project-wiring-redesign-2026-10-16/module-refinements-support.cjs'
  const suite = './tests/project-wiring-module-refinements-test.cjs'
  const wrapper = `const path=require('node:path');const support=require(${JSON.stringify(support)});support.evidenceRoot=${JSON.stringify(controllerRoot)};require(${JSON.stringify(suite)});`
  const child = spawnSync(process.execPath, ['-e', wrapper], { cwd:root, encoding:'utf8', windowsHide:true })
  fs.writeFileSync(path.join(controllerRoot,'controller-run.log'),
    `exitCode=${child.status}\nstdout:\n${child.stdout || ''}\nstderr:\n${child.stderr || ''}`)
  let report = null
  try { report = JSON.parse(fs.readFileSync(path.join(controllerRoot,'controller-checks.json'),'utf8')) } catch {}
  const passed = child.status === 0 && report?.total === 21 && report.passed === 21 && report.failed === 0
  check('isolated controller regression suite passes without writing previous evidence', passed,
    { exitCode:child.status, total:report?.total, passed:report?.passed, failed:report?.failed,
      output:`${controllerRoot}/controller-checks.json`, stderr:child.stderr })
  return { exitCode:child.status, total:report?.total, passed:report?.passed, failed:report?.failed,
    evidenceDirectory:'controller/', productionStorage:'NOT ACCESSED; in-memory wx fixture only' }
}

function fileManifest(files) {
  return Object.fromEntries(files.map(relative=>{
    const filename=path.join(root,relative)
    const bytes=fs.readFileSync(filename)
    return [relative,{sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}]
  }))
}

function motionContract() {
  const ui=fs.readFileSync(path.join(root,'pages/project-wiring/workspace-ui.js'),'utf8')
  const css=fs.readFileSync(path.join(root,'pages/project-wiring/workspace.wxss'),'utf8')
  const removal=ui.match(/beginWorkspaceRowRemoval\(snapshot\) \{([\s\S]*?)\n    \},/)?.[1]||''
  const value=(source,expression)=>{
    const match=source.match(expression)
    return match?Number(match[1]):null
  }
  return {
    overlayOpenMs:value(ui,/const WORKSPACE_OVERLAY_OPEN_MS\s*=\s*(\d+)/),
    overlayCloseMs:value(ui,/const WORKSPACE_OVERLAY_CLOSE_MS\s*=\s*(\d+)/),
    swipeWidth:value(ui,/const SWIPE_ACTION_WIDTH\s*=\s*(\d+)/),
    swipeSetDataIntervalMs:value(ui,/const SWIPE_SET_DATA_INTERVAL\s*=\s*(\d+)/),
    overlayOpenCssMs:value(css,/\.workspace-mask \.wiring-sheet\{[^}]*transition:transform\s+(\d+)ms/),
    tabIndicatorCssMs:value(css,/\.workspace-tab::before\{[^}]*transition:opacity\s+(\d+)ms/),
    tabContentCssMs:value(css,/\.workspace-tab-content\{animation:workspaceTabIn\s+(\d+)ms/),
    groupCollapseCssMs:value(css,/\.workspace-group-lines\{[^}]*transition:grid-template-rows\s+(\d+)ms/),
    lastLineGroupFadeCssMs:value(css,/\.workspace-line-group\.workspace-line-group-retiring\{[^}]*opacity\s+(\d+)ms/),
    lastLineGroupCollapseCssMs:value(css,/\.workspace-line-group\.workspace-line-group-retiring\{[^}]*transition:[^}]*grid-template-rows\s+(\d+)ms/),
    swipeSettleCssMs:value(css,/\.workspace-swipe-actions\{[^}]*transition:width\s+(\d+)ms/),
    rowFadeCssMs:value(css,/\.workspace-row-retiring\{[^}]*opacity\s+(\d+)ms/),
    rowCollapseCssMs:value(css,/\.workspace-row-retiring\{[^}]*grid-template-rows:[^;]*;[^}]*transition:[^}]*grid-template-rows\s+(\d+)ms/),
    rowCleanupMs:value(ui,/const WORKSPACE_ROW_EXIT_CLEANUP_MS\s*=\s*(\d+)/),
    reducedMotionOverride:css.includes('@media (prefers-reduced-motion:reduce)')||css.includes('@media (prefers-reduced-motion: reduce)'),
  }
}

function readPreviousResiduals() {
  const previousPath = path.join(evidenceRoot, 'visual-acceptance-checks.json')
  const previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'))
  const find = (prefix) => previous.checks.find(item => item.name.startsWith(prefix))
  const swipe = find('last line in the receiver-to-mixer-duplicate group reveals')
  const groupMotion = find('confirming last-line deletion commits the line')
  const deviceMotion = find('confirmed deletion saves first, then fades/collapses')
  const continuous = previous.checks.filter(item => item.name.startsWith('continuous-editor:'))
  return { previousPath, previous, swipe, groupMotion, deviceMotion, continuous }
}

async function residualScreenshot(name, note = '') {
  fs.mkdirSync(residualPreviewRoot, { recursive:true })
  const filename = path.join(residualPreviewRoot, `${name}.png`)
  const requestAt = new Date().toISOString()
  await browser.screenshot(filename)
  const completedAt = new Date().toISOString()
  return { name, file:path.relative(harnessRoot, filename).replaceAll('\\', '/'),
    sha256:crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
    requestAt, completedAt, note }
}

async function beginRafRemovalProbe({ kind, selector, neighborSelector = '', expectedId, durationMs = 720 }) {
  const specification = JSON.stringify(arguments[0])
  return browser.evaluate(`(() => {
    const spec = ${specification};
    const selected = document.querySelector(spec.selector);
    const target = spec.targetMode === 'parent-group' ? selected?.closest('.workspace-line-group') : selected;
    const neighbor = spec.neighborKey
      ? [...document.querySelectorAll('.workspace-line-group')].find(node => node.querySelector('.workspace-group-header')?.dataset.key === spec.neighborKey) || null
      : (spec.neighborSelector ? document.querySelector(spec.neighborSelector) : null);
    if (!target) throw new Error('RAF probe target missing: ' + spec.selector);
    const layout = () => {
      const scroll=document.querySelector('.workspace-scroll'),content=scroll?.querySelector('.workspace-content'),tab=content?.querySelector('.workspace-tab-content');
      const metric=node=>{if(!node)return null;const rect=node.getBoundingClientRect();return{x:rect.x,y:rect.y,bottom:rect.bottom,height:rect.height,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,scrollTop:node.scrollTop}};
      return {scroll:metric(scroll),content:metric(content),tab:metric(tab)};
    };
    const probe = {
      kind:spec.kind, selector:spec.selector, neighborSelector:spec.neighborSelector,
      startedAt:performance.now(), target, neighbor, initialLayout:layout(), samples:[], exitStartAt:null,
      confirmInvokeAt:null, confirmResolvedAt:null, confirmRevision:null, confirmError:'',
      refreshCount:0, refreshErrors:[], done:false, rafGaps:[], lastFrameAt:null,
    };
    window.__qaResidualRafProbe = probe;
    const box = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return {
        connected:node.isConnected, className:typeof node.className==='string'?node.className:'',
        dataId:node.dataset?.swipeId || '', dataKey:node.getAttribute('data-qa-key'),
        x:r.x, y:r.y, width:r.width, height:r.height, opacity:Number(s.opacity),
        visibility:s.visibility, pointerEvents:s.pointerEvents,
        gridTemplateRows:s.gridTemplateRows, marginBottom:s.marginBottom,
        borderBottomWidth:s.borderBottomWidth, transition:s.transition,
      };
    };
    const frame = rafTime => {
      const now = performance.now();
      if (probe.lastFrameAt !== null) probe.rafGaps.push(Number((now-probe.lastFrameAt).toFixed(3)));
      probe.lastFrameAt = now;
      const targetBox = box(probe.target);
      const neighborBox = box(probe.neighbor);
      const layoutMetrics=layout();
      const exiting = targetBox && (targetBox.className.includes('workspace-line-group-retiring-exit') ||
        targetBox.className.includes('workspace-row-retiring-exit'));
      if (exiting && probe.exitStartAt === null) probe.exitStartAt = now;
      const session = window.__wiringQa?.session;
      const present = spec.kind === 'line-group'
        ? Boolean(session?.schedule?.lines?.some(item=>item.id===spec.expectedId))
        : Boolean(session?.schedule?.devices?.some(item=>item.id===spec.expectedId));
      probe.samples.push({ frame:probe.samples.length, rafTime:Number(rafTime.toFixed(3)), at:Number(now.toFixed(3)),
        sinceProbeMs:Number((now-probe.startedAt).toFixed(3)), sinceConfirmMs:probe.confirmInvokeAt===null?null:Number((now-probe.confirmInvokeAt).toFixed(3)),
        sinceExitMs:probe.exitStartAt===null?null:Number((now-probe.exitStartAt).toFixed(3)),
        exitClassObserved:Boolean(exiting), recordStillStored:present, target:targetBox, neighbor:neighborBox, layout:layoutMetrics });
      if (now-probe.startedAt < spec.durationMs) requestAnimationFrame(frame);
      else { probe.done=true; probe.doneAt=performance.now(); }
    };
    let lastRefresh = -Infinity, refreshPending = false;
    const refresh = () => {
      const now=performance.now();
      if (refreshPending || now-lastRefresh<24 || probe.done) return;
      refreshPending=true; lastRefresh=now;
      Promise.resolve(window.__qaRefresh?.()).then(()=>{probe.refreshCount++},error=>{probe.refreshErrors.push(String(error))})
        .finally(()=>{refreshPending=false});
    };
    probe.refreshTimer=setInterval(refresh,12);
    requestAnimationFrame(frame);
    return { kind:probe.kind, startedAt:probe.startedAt, targetClass:target.className,
      neighborClass:neighbor?.className || '', durationMs:spec.durationMs };
  })()`)
}

async function confirmIntoRafProbe() {
  return browser.evaluate(`(() => {
    const probe=window.__qaResidualRafProbe;
    if (!probe) throw new Error('RAF probe was not started');
    probe.confirmInvokeAt=performance.now();
    probe.confirmPromise=window.__qaAction('modal',undefined,{confirm:true}).then(next=>{
      probe.confirmResolvedAt=performance.now(); probe.confirmRevision=next?.schedule?.revision ?? null; return true;
    },error=>{probe.confirmResolvedAt=performance.now();probe.confirmError=String(error);return false});
    return { invokedAt:probe.confirmInvokeAt };
  })()`)
}

async function waitForRafProbe(timeoutMs = 4000) {
  const started=Date.now();
  while (Date.now()-started < timeoutMs) {
    const status=await browser.evaluate(`(()=>{const p=window.__qaResidualRafProbe;return p?{done:p.done,count:p.samples.length,exitStartAt:p.exitStartAt}:null})()`);
    if (status?.done) return browser.evaluate(`(()=>{const p=window.__qaResidualRafProbe;clearInterval(p.refreshTimer);const clean={...p};delete clean.target;delete clean.neighbor;delete clean.refreshTimer;delete clean.confirmPromise;return clean})()`);
    await delay(15);
  }
  throw new Error('Timed out waiting for continuous RAF samples: ' + JSON.stringify(await browser.evaluate(`(()=>{const p=window.__qaResidualRafProbe;return p?{done:p.done,count:p.samples.length}:null})()`)));
}

function timingSummary(probe, durationMs) {
  const samples=probe?.samples || [];
  const exit=samples.filter(item=>item.sinceExitMs!==null);
  const atOrNear=target=>samples.reduce((best,item)=>Math.abs((item.sinceExitMs??Infinity)-target)<Math.abs((best?.sinceExitMs??Infinity)-target)?item:best,null);
  const near=[175,200,220,240,260].map(ms=>{
    const sample=atOrNear(ms);
    return { requestedMs:ms, sampleMs:sample?.sinceExitMs ?? null,
      deltaMs:sample?.sinceExitMs==null?null:Number((sample.sinceExitMs-ms).toFixed(3)),
      connected:sample?.target?.connected ?? null, height:sample?.target?.height ?? null,
      opacity:sample?.target?.opacity ?? null, y:sample?.target?.y ?? null,
      neighborY:sample?.neighbor?.y ?? null, className:sample?.target?.className ?? '', layout:sample?.layout??null };
  });
  const frameDeltas=probe?.rafGaps || [];
  const firstExitHeight=exit[0]?.target?.height ?? null;
  const heightAt175=near[0]?.height ?? null;
  const heightAt220=near[2]?.height ?? null;
  const heightAt240=near[3]?.height ?? null;
  const exitHeights=exit.map(item=>item.target?.height).filter(Number.isFinite);
  const monotoneCollapse=exitHeights.length>3&&exitHeights.every((height,index)=>index===0||height<=exitHeights[index-1]+1.5);
  const exitFinished=(heightAt220!==null&&heightAt220<=1)||(heightAt240!==null&&heightAt240<=1)||probe?.samples.at(-1)?.target?.connected===false;
  const neighborYAt240=near[3]?.neighborY ?? null;
  const neighborYAtEnd=probe?.samples.at(-1)?.neighbor?.y ?? null;
  const initialContent=probe?.initialLayout?.content??null, contentAt220=near[2]?.layout?.content??null, contentAtEnd=probe?.samples.at(-1)?.layout?.content??null;
  const contentBottomDelta220ToEnd=contentAt220&&contentAtEnd?Number((contentAtEnd.bottom-contentAt220.bottom).toFixed(3)):null;
  const contentScrollHeightDelta220ToEnd=contentAt220&&contentAtEnd?contentAtEnd.scrollHeight-contentAt220.scrollHeight:null;
  const lastConnectedBeforeRemoval=exit.filter(item=>item.target?.connected).at(-1)||null;
  const firstDisconnected=exit.find(item=>item.target?.connected===false)||null;
  const removalContentBottomStep=lastConnectedBeforeRemoval?.layout?.content&&firstDisconnected?.layout?.content?
    Number((firstDisconnected.layout.content.bottom-lastConnectedBeforeRemoval.layout.content.bottom).toFixed(3)):null;
  const removalContentScrollHeightStep=lastConnectedBeforeRemoval?.layout?.content&&firstDisconnected?.layout?.content?
    firstDisconnected.layout.content.scrollHeight-lastConnectedBeforeRemoval.layout.content.scrollHeight:null;
  return { probeStartedAt:probe?.startedAt ?? null, confirmInvokeAt:probe?.confirmInvokeAt ?? null,
    confirmResolvedAt:probe?.confirmResolvedAt ?? null, exitStartAt:probe?.exitStartAt ?? null,
    confirmToExitMs:probe?.confirmInvokeAt!=null&&probe?.exitStartAt!=null?Number((probe.exitStartAt-probe.confirmInvokeAt).toFixed(3)):null,
    durationMs, frameCount:samples.length, exitFrameCount:exit.length,
    maxObservedRafGapMs:frameDeltas.length?Math.max(...frameDeltas):null,
    rafGapsOver34Ms:frameDeltas.filter(value=>value>34).length,
    refreshCount:probe?.refreshCount ?? 0, refreshErrors:probe?.refreshErrors || [],
    confirmError:probe?.confirmError || '',
    near, samples, recordAbsentAtExitEnd:exit.length?exit.at(-1).recordStillStored===false:null,
    targetRemovedAtEnd:samples.at(-1)?.target?.connected===false,
    layoutEvidence:{initialContent,contentAt220,contentAtEnd,lastConnectedBeforeRemoval:lastConnectedBeforeRemoval?{sinceExitMs:lastConnectedBeforeRemoval.sinceExitMs,layout:lastConnectedBeforeRemoval.layout.content}:null,
      firstDisconnected:firstDisconnected?{sinceExitMs:firstDisconnected.sinceExitMs,layout:firstDisconnected.layout.content}:null,
      contentBottomDelta220ToEnd,contentScrollHeightDelta220ToEnd,removalContentBottomStep,removalContentScrollHeightStep,
      sampleCountWithLayout:samples.filter(item=>item.layout?.content).length},
    collapseEvidence:{firstExitHeight,heightAt175,heightAt220,heightAt240,monotoneWithin1_5px:monotoneCollapse,
      exitFinishedBy220To240OrRemoved:exitFinished,neighborYAt240,neighborYAtEnd,
      neighborEndDelta:neighborYAt240!==null&&neighborYAtEnd!==null?Number((neighborYAtEnd-neighborYAt240).toFixed(3)):null,
      contentBottomDelta220ToEnd,contentScrollHeightDelta220ToEnd,removalContentBottomStep,removalContentScrollHeightStep},
  };
}

function classifyCollapse(summary) {
  const measured=summary?.collapseEvidence||{};
  const samplingAdequate=summary?.frameCount>20&&summary?.exitFrameCount>12&&summary?.maxObservedRafGapMs<=60;
  const layoutStable=measured.contentBottomDelta220ToEnd!==null&&Math.abs(measured.contentBottomDelta220ToEnd)<=4&&
    Math.abs(measured.contentScrollHeightDelta220ToEnd||0)<=4&&measured.removalContentBottomStep!==null&&Math.abs(measured.removalContentBottomStep)<=4&&
    Math.abs(measured.removalContentScrollHeightStep||0)<=4;
  const animationObserved=measured.monotoneWithin1_5px&&measured.exitFinishedBy220To240OrRemoved&&layoutStable;
  if (samplingAdequate&&animationObserved) return 'harness-demonstrated';
  if (samplingAdequate) return 'verified-product';
  return 'unresolved';
}

async function continuousIdentitySnapshot(label) {
  return browser.evaluate(`(()=>{
    const record=window.__qaContinuousIdentity;
    const currentSheet=document.querySelector('.workspace-continuous-sheet');
    const currentMask=document.querySelector('.workspace-continuous-mask');
    const currentLineMask=document.querySelector('.workspace-editor-sheet')?.closest('.workspace-mask');
    const session=window.__wiringQa?.session;
    const content=node=>node?{text:(node.innerText||'').replace(/\\s+/g,' ').trim(),
      fields:[...node.querySelectorAll('input,textarea,select')].map(field=>({value:field.value||'',placeholder:field.placeholder||'',type:field.type||''})),
      fieldCount:node.querySelectorAll('input,textarea,select').length,
      descendantCount:node.querySelectorAll('*').length}:null;
    const ref=record?.sheet;
    return { label:${JSON.stringify(label)}, at:performance.now(), phase:session?.data?.workspaceOverlayPhases?.continuous || '',
      continuousVisible:session?.data?.continuousVisible, editorVisible:session?.data?.editorVisible,
      beforeSheetConnected:Boolean(ref?.isConnected), beforeSheetClass:ref?.className||'',
      beforeMaskConnected:Boolean(record?.mask?.isConnected), beforeMaskClass:record?.mask?.className||'',
      beforeSheetStillCurrent:Boolean(ref&&ref===currentSheet), currentSheetClass:currentSheet?.className||'',
      currentMaskClass:currentMask?.className||'', currentMaskKey:currentMask?.getAttribute('data-qa-key'),
      lineMaskClass:currentLineMask?.className||'', oldMaskIsLineMask:Boolean(record?.mask&&record.mask===currentLineMask),
      oldSheetIsLineSheet:Boolean(ref&&ref===document.querySelector('.workspace-editor-sheet')),
      originalContentAtOpen:record?.beforeContent||null, oldRefCurrentContent:content(ref), currentContent:content(currentSheet),
      currentSheetTransitionDuration:currentSheet?getComputedStyle(currentSheet).transitionDuration:'',
      oldSheetTransitionDuration:ref?.isConnected?getComputedStyle(ref).transitionDuration:'',
      patchStats:window.__qaPatchStats||null,
      mutations:record?.mutations||[], sourceChildren:[...document.querySelector('#app')?.children||[]].map(n=>n.className||n.tagName),
      nativeTouchTrace:(window.__qaRawTouchTrace||[]).slice(-12), routedEvents:(window.__qaEventTrace||[]).slice(-12) };
  })()`)
}

async function beginContinuousLifecycleProbe() {
  return browser.evaluate(`(()=>{
    const record=window.__qaContinuousIdentity;
    if(!record?.sheet)throw new Error('Continuous identity reference missing before close probe');
    const probe={startedAt:performance.now(),closeStartAt:null,samples:[],refreshCount:0,refreshErrors:[],lastFrameAt:null,rafGaps:[],done:false};
    window.__qaContinuousLifecycleProbe=probe;
    const frame=rafTime=>{
      const now=performance.now();
      if(probe.lastFrameAt!==null)probe.rafGaps.push(Number((now-probe.lastFrameAt).toFixed(3)));
      probe.lastFrameAt=now;
      const session=window.__wiringQa?.session,phase=session?.data?.workspaceOverlayPhases?.continuous||'';
      if(phase==='closing'&&probe.closeStartAt===null)probe.closeStartAt=now;
      const old=record.sheet,current=document.querySelector('.workspace-continuous-sheet'),mask=record.mask;
      const style=old?.isConnected?getComputedStyle(old):null,rect=old?.isConnected?old.getBoundingClientRect():null;
      const fields=old?.isConnected?[...old.querySelectorAll('input,textarea,select')].map(field=>field.value||''):[];
      probe.samples.push({at:Number(now.toFixed(3)),rafTime:Number(rafTime.toFixed(3)),sinceStartMs:Number((now-probe.startedAt).toFixed(3)),
        sinceCloseMs:probe.closeStartAt===null?null:Number((now-probe.closeStartAt).toFixed(3)),phase,visible:session?.data?.continuousVisible,
        oldConnected:Boolean(old?.isConnected),oldStillCurrent:Boolean(old&&old===current),maskConnected:Boolean(mask?.isConnected),
        currentSheetPresent:Boolean(current),className:old?.className||'',opacity:style?Number(style.opacity):null,transform:style?.transform||'',
        width:rect?.width??null,height:rect?.height??null,fields});
      if(probe.closeStartAt!==null&&phase===''&&!old?.isConnected){probe.done=true;probe.doneAt=performance.now();return;}
      requestAnimationFrame(frame);
    };
    let refreshPending=false;
    probe.refreshTimer=setInterval(()=>{
      if(refreshPending||probe.done)return;refreshPending=true;
      Promise.resolve(window.__qaRefresh?.()).then(()=>{probe.refreshCount++},error=>probe.refreshErrors.push(String(error))).finally(()=>{refreshPending=false});
    },16);
    requestAnimationFrame(frame);
    return {startedAt:probe.startedAt,sheetConnected:record.sheet.isConnected,refreshPeriodMs:16};
  })()`)
}

async function waitForContinuousLifecycleProbe(timeoutMs=1400) {
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const status=await browser.evaluate(`(()=>{const p=window.__qaContinuousLifecycleProbe;return p?{done:p.done,count:p.samples.length,closeStartAt:p.closeStartAt}:null})()`);
    if(status?.done)return browser.evaluate(`(()=>{const p=window.__qaContinuousLifecycleProbe;clearInterval(p.refreshTimer);const clean={...p};delete clean.refreshTimer;return clean})()`);
    await delay(12);
  }
  throw new Error('Timed out waiting for continuous close RAF probe: '+JSON.stringify(await browser.evaluate(`(()=>{const p=window.__qaContinuousLifecycleProbe;return p?{done:p.done,count:p.samples.length,closeStartAt:p.closeStartAt,tail:p.samples.slice(-3)}:null})()`)));
}

async function residualIdentityMain() {
  fs.mkdirSync(residualRoot,{recursive:true}); fs.mkdirSync(residualPreviewRoot,{recursive:true});
  const old=readPreviousResiduals();
  const priorSwipe=old.swipe?.evidence||{};
  const progress=(priorSwipe.progress||[]).map(item=>Number(item.offset)).filter(Number.isFinite);
  const oldAssertion=(priorSwipe.progress||[]).some(item=>Number(item.observation?.offset)>0);
  const oldRawShapePass=progress.some(value=>value>0);
  const findings=[{
    id:'visual-1-swipe-progress-path',
    expected:'A completed real swipe reports positive progressive action width, exposes a 72x44 delete target, and leaves the record unchanged until explicit Delete confirmation.',
    observed:{oldAssertion,oldRawShapePass,progressOffsets:progress,
      deleteTarget:priorSwipe.deleteButton&&{width:priorSwipe.deleteButton.width,height:priorSwipe.deleteButton.height,hitTargetAtCenter:priorSwipe.deleteButton.hitTargetAtCenter},
      revisionBefore:priorSwipe.revisionBefore,revisionAfter:priorSwipe.revisionAfter},
    classification:'harness-demonstrated',
    directEvidence:{priorReport:path.relative(harnessRoot,old.previousPath).replaceAll('\\','/'),
      incorrectAssertion:'result.progress.some(item=>Number(item.observation?.offset)>0)',
      serializedObservationShape:'actualSwipe maps gesture.observations[].observation into progress; the resulting item has offset at its root.'},
    nativeRuntime:'NOT RUN',
  }];
  const helperFile=path.join(harnessRoot,'keyed-dom-patch.js');
  const helperSource=fs.readFileSync(helperFile,'utf8');
  const helperSummary={sha256:crypto.createHash('sha256').update(helperSource).digest('hex'),
    templateIdentityRead:helperSource.includes("getAttribute('data-qa-template-key')"),
    loopIdentityRead:helperSource.includes("getAttribute('data-qa-key')"),
    priorPositionFallbackStillPresent:helperSource.includes('const positional = previous[index]'),
    templateKeyPreventsFallback:helperSource.includes('if (key !== null)')};

  const previousEvidenceEnv=process.env.WIRING_QA_EVIDENCE;
  process.env.WIRING_QA_EVIDENCE=path.join(residualRoot,'runtime-identity');
  const run={}; const previews=[];
  try {
    browser=await launch();
    await navigate('light',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'},reducedMotion:'no-preference'});
    const editorOpenTap=await actualTap('.workspace-bottom-bar .workspace-primary-button',30);
    await waitFor('line editor visible',async()=>Boolean((await state()).data.editorVisible),2500);
    await delay(330);
    const continuousOpenTap=await actualTap('.workspace-continuous-button',30);
    await waitFor('continuous editor visible',async()=>Boolean((await state()).data.continuousVisible),2500);
    await delay(330);
    const fromPortSeed=await typeInto('.workspace-continuous-sheet input[data-field="fromPort"]','OUT-R');
    const toPortSeed=await typeInto('.workspace-continuous-sheet input[data-field="toPort"]','IN-R');
    await delay(35);
    const identityBefore=await browser.evaluate(`(()=>{
      const sheet=document.querySelector('.workspace-continuous-sheet');const mask=sheet?.closest('.workspace-continuous-mask');
      const content=node=>node?{text:(node.innerText||'').replace(/\\s+/g,' ').trim(),
        fields:[...node.querySelectorAll('input,textarea,select')].map(field=>({value:field.value||'',placeholder:field.placeholder||'',type:field.type||''})),
        fieldCount:node.querySelectorAll('input,textarea,select').length,descendantCount:node.querySelectorAll('*').length}:null;
      const record={sheet,mask,mutations:[],openedAt:performance.now(),sheetClass:sheet?.className||'',maskClass:mask?.className||'',
        sheetKey:sheet?.getAttribute('data-qa-key'),sheetTemplateKey:sheet?.getAttribute('data-qa-template-key'),
        maskKey:mask?.getAttribute('data-qa-key'),maskTemplateKey:mask?.getAttribute('data-qa-template-key'),beforeContent:content(sheet)};
      window.__qaContinuousIdentity=record;
      const observer=new MutationObserver(list=>{for(const item of list)record.mutations.push({at:performance.now(),type:item.type,
        targetClass:typeof item.target.className==='string'?item.target.className:'',attributeName:item.attributeName,oldValue:item.oldValue,
        added:[...item.addedNodes].map(node=>({tag:node.tagName||'',className:typeof node.className==='string'?node.className:'',key:node.getAttribute?.('data-qa-key'),templateKey:node.getAttribute?.('data-qa-template-key')})),
        removed:[...item.removedNodes].map(node=>({tag:node.tagName||'',className:typeof node.className==='string'?node.className:'',key:node.getAttribute?.('data-qa-key'),templateKey:node.getAttribute?.('data-qa-template-key')}))})});
      record.observer=observer;observer.observe(document.querySelector('#app'),{subtree:true,childList:true,attributes:true,attributeFilter:['class'],attributeOldValue:true});
      return {openedAt:record.openedAt,sheetClass:record.sheetClass,maskClass:record.maskClass,sheetKey:record.sheetKey,
        sheetTemplateKey:record.sheetTemplateKey,maskKey:record.maskKey,maskTemplateKey:record.maskTemplateKey,content:record.beforeContent};
    })()`);
    const openPreview=await residualScreenshot('continuous-identity-open','New keyed-adapter source; real CDP entry taps and CDP Input.insertText seeded OUT-R / IN-R.'); previews.push(openPreview);
    const lifecycleProbeStart=await beginContinuousLifecycleProbe();
    const dispatchStart=browser.touchDispatchTrace?.().length||0;
    const rawStart=await browser.evaluate('(window.__qaRawTouchTrace||[]).length');
    const closeTap=await actualTap('.workspace-continuous-sheet .workspace-close-button',0,{downMs:18,clickWaitMs:0,skipState:true});
    const immediate=await continuousIdentitySnapshot('immediate-after-close-touch');
    const lifecycleProbe=await waitForContinuousLifecycleProbe();
    const middleSample=lifecycleProbe.samples.filter(item=>item.sinceCloseMs!==null&&item.sinceCloseMs>=70&&item.sinceCloseMs<=180).sort((a,b)=>Math.abs(a.sinceCloseMs-120)-Math.abs(b.sinceCloseMs-120))[0]||null;
    const middle=middleSample?{label:'page-side-raf-mid-close',at:middleSample.at,phase:middleSample.phase,continuousVisible:middleSample.visible,
      beforeSheetConnected:middleSample.oldConnected,beforeSheetStillCurrent:middleSample.oldStillCurrent,beforeSheetClass:middleSample.className,
      currentSheetClass:middleSample.oldStillCurrent?middleSample.className:'',currentContent:middleSample.oldConnected?{fields:middleSample.fields.map(value=>({value}))}:null,
      opacity:middleSample.opacity,transform:middleSample.transform,width:middleSample.width,height:middleSample.height,sinceCloseMs:middleSample.sinceCloseMs}:null;
    const settled=await continuousIdentitySnapshot('post-cleanup');
    const settledPreview=await residualScreenshot('continuous-identity-cleaned','Captured only after page-side RAF sampling observed the closing lifecycle and cleanup.'); previews.push(settledPreview);
    const cdpDispatch=(browser.touchDispatchTrace?.()||[]).slice(dispatchStart);
    const rawTouch=await browser.evaluate(`(window.__qaRawTouchTrace||[]).slice(${rawStart})`);
    const routed=closeTap.trace||[];
    const closeRouted=Boolean(closeTap.response?.point&&rawTouch.some(item=>item.domType==='touchstart'&&item.isTrusted)&&rawTouch.some(item=>item.domType==='touchend'&&item.isTrusted)&&
      routed.some(item=>item.type==='tap'&&item.method==='closeContinuous'));
    const originalFields=identityBefore.content?.fields||[];
    const midFields=middle?.currentContent?.fields||[];
    const fieldValuesPreserved=originalFields.length===midFields.length&&originalFields.every((field,index)=>field.value===midFields[index]?.value);
    const sameSheetImmediate=immediate.beforeSheetStillCurrent;
    const sameSheetMid=Boolean(middle?.beforeSheetStillCurrent);
    const phaseLifecycle=closeRouted&&immediate.phase==='closing'&&immediate.continuousVisible===false&&middle?.phase==='closing'&&settled.phase===''&&settled.currentContent===null;
    run.editorOpenTap=editorOpenTap;run.continuousOpenTap=continuousOpenTap;run.fromPortSeed=fromPortSeed;run.toPortSeed=toPortSeed;
    run.identityBefore=identityBefore;run.lifecycleProbeStart=lifecycleProbeStart;run.closeTap=closeTap;run.immediate=immediate;run.lifecycleProbe=lifecycleProbe;run.middle=middle;run.settled=settled;
    run.closeRouted=closeRouted;run.cdpDispatch=cdpDispatch;run.rawTouch=rawTouch;run.routedClose= routed;
    run.fieldValuesPreserved=fieldValuesPreserved;run.phaseLifecycle=phaseLifecycle;run.sameSheetImmediate=sameSheetImmediate;run.sameSheetMid=sameSheetMid;
    findings.push({id:'visual-4-continuous-close-lifecycle',expected:'A real close-button touch updates logical visibility, retains the content during the 240ms exit, then clears the sheet after cleanup.',observed:{closeRouted,phaseImmediately:immediate.phase,visibleImmediately:immediate.continuousVisible,phaseMid:middle?.phase||null,phaseSettled:settled.phase,visibleSettled:settled.continuousVisible,originalValues:originalFields.map(field=>field.value),midValues:midFields.map(field=>field.value),fieldValuesPreserved,contentExistsAtMid:Boolean(middle?.currentContent),settledSheet:settled.currentContent,originalSheetNodePreservedAtMid:sameSheetMid,templateKey:identityBefore.sheetTemplateKey},classification:phaseLifecycle&&fieldValuesPreserved?'harness-demonstrated':'unresolved',directEvidence:{cdpDispatch,rawTouch,routed,immediate,lifecycleProbeStart,lifecycleProbe,middle,settled,adapterCallbackNote:'The wx fixture and browser keyed renderer communicate through the adapter snapshot endpoint; page-side RAF samples reflect each observed WXML adapter patch, not a WeChat renderer callback.'},nativeRuntime:'NOT RUN'});
    findings.push({id:'visual-5-continuous-mid-exit-node-identity',expected:'The same continuous sheet node and entered field values remain mounted through the mid-exit closing state.',observed:{originalSheetClass:identityBefore.sheetClass,originalMaskClass:identityBefore.maskClass,originalTemplateKey:identityBefore.sheetTemplateKey,originalMaskTemplateKey:identityBefore.maskTemplateKey,oldNodeStillCurrentAtClose:sameSheetImmediate,oldNodeStillCurrentMidExit:sameSheetMid,oldNodeConnectedMid:Boolean(middle?.beforeSheetConnected),oldNodeClassMid:middle?.beforeSheetClass||'',currentSheetClassMid:middle?.currentSheetClass||'',fieldValuesPreserved,patchStatsImmediate:immediate.patchStats,patchStatsAfterProbe:settled.patchStats,mutations:settled.mutations,helperSummary,headerOwnerRepro:'evidence/residual-failures-2026-10-16/keyed/repro-results.json'},classification:sameSheetImmediate&&sameSheetMid&&fieldValuesPreserved?'harness-demonstrated':middle?'verified-product':'unresolved',directEvidence:{oldFailure:old.continuous.find(item=>item.name.includes('same DOM node'))?.evidence,preCloseIdentity:identityBefore,postCloseImmediate:immediate,pageSideRafProbe:lifecycleProbe,postCloseMid:middle,settled,helperSummary},nativeRuntime:'NOT RUN'});
    const loadedSources=await browser.evaluate('window.__wiringQa?.session?.sources||{}');
    run.loadedSources=loadedSources;
  } finally {
    if(browser){await browser.close();browser=null;}
    if(previousEvidenceEnv===undefined)delete process.env.WIRING_QA_EVIDENCE;
    else process.env.WIRING_QA_EVIDENCE=previousEvidenceEnv;
  }
  const sourceFiles=['tests/project-wiring-redesign-2026-10-16/visual-native-acceptance-run.cjs','tests/project-wiring-redesign-2026-10-16/cdp.cjs','tests/project-wiring-redesign-2026-10-16/browser.js','tests/project-wiring-redesign-2026-10-16/browser-server.cjs','tests/project-wiring-redesign-2026-10-16/keyed-dom-patch.js'];
  const manifest={productionSources:sourceManifest(),harnessSources:fileManifest(sourceFiles),capturedAt:new Date().toISOString()};
  const result={createdAt:new Date().toISOString(),suite:'Continuous editor residual identity probe',runtime:'Chromium adapter; actual CDP touch/keyboard input and isolated in-memory wx fixture.',productionStorage:'NOT ACCESSED',nativeRuntime:'NOT RUN',physicalDevice:'NOT RUN',priorRun:path.relative(harnessRoot,old.previousPath).replaceAll('\\','/'),findings,run,previews,manifest,
    adapterLimit:'This verifies the currently keyed Chromium adapter patch behavior only. It cannot establish WeChat/iOS native DOM lifecycle.'};
  fs.writeFileSync(path.join(residualRoot,'continuous-identity-adapter-freeze.json'),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(residualRoot,'continuous-identity-source-manifest.json'),JSON.stringify(manifest,null,2));
  console.log(`Continuous identity findings: ${findings.length}; previews: ${previews.length}`);
  console.log(`Evidence: ${residualRoot}`);
}

async function residualMain() {
  fs.mkdirSync(residualRoot,{recursive:true}); fs.mkdirSync(residualPreviewRoot,{recursive:true});
  const old=readPreviousResiduals();
  const findings=[]; const previews=[]; const runs=[];
  const frozenHashes={
    'pages/project-wiring/workspace-ui.js':'ac8fafe0fe83fe32a940586613280c0bf07c5fc3f60a3cbf3115ace67ae3c09c',
    'pages/project-wiring/workspace.wxml':'b248aa5c4028b94579ac0e8e7d82cac2a686738e9dcbdcbc711eb64b96a22e86',
    'pages/project-wiring/index.wxml':'1ff20c0e57c39052c931a0a0a0d743feadb6c23a519835cc7faed1c561725fc3',
    'pages/project-wiring/workspace.wxss':'f7a56365a941f0102942a6fe378d4c0818b0c327e6aad506c0ada2c4da7a944f',
    'pages/project-wiring/workspace-header.wxml':'472aa719ef4553cd652642561cacb50f75a100a9932f47c62d38b1035c1cbd34',
  };
  const initialSources=sourceManifest();
  const frozenCheck=Object.fromEntries(Object.entries(frozenHashes).map(([file,expected])=>[file,{expected,observed:initialSources[file]?.sha256||null,matched:initialSources[file]?.sha256===expected}]));
  const sourceMismatches=Object.entries(frozenCheck).filter(([,item])=>!item.matched);
  if(sourceMismatches.length) throw new Error('Production source no longer matches the approved visual freeze: '+JSON.stringify(sourceMismatches));

  const swipeEvidence=old.swipe?.evidence || {};
  const offsets=(swipeEvidence.progress||[]).map(item=>Number(item.offset)).filter(Number.isFinite);
  const oldBadPredicate=(swipeEvidence.progress||[]).some(item=>Number(item.observation?.offset)>0);
  const rawPredicate=offsets.some(value=>value>0);
  findings.push({ id:'visual-1-swipe-progress-path', expected:'A completed real swipe reports positive progressive action width, exposes a 72x44 delete target, and does not mutate the saved record.', observed:{oldAssertion:oldBadPredicate,rawObservationPredicate:rawPredicate,offsets,deleteButton:swipeEvidence.deleteButton&&{width:swipeEvidence.deleteButton.width,height:swipeEvidence.deleteButton.height,hitTargetAtCenter:swipeEvidence.deleteButton.hitTargetAtCenter},revisionBefore:swipeEvidence.revisionBefore,revisionAfter:swipeEvidence.revisionAfter,recordStillStored:(swipeEvidence.progress||[]).length>0}, classification:'harness-demonstrated', directEvidence:{report:path.relative(harnessRoot,old.previousPath).replaceAll('\\','/'),oldAssertionSource:'result.progress.some(item=>Number(item.observation?.offset)>0)',actualShape:'result.progress is already mapped from gesture.observations[].observation; each item has offset directly.'}, nativeRuntime:'NOT RUN' });

  const previousEvidenceEnv=process.env.WIRING_QA_EVIDENCE;
  process.env.WIRING_QA_EVIDENCE=path.join(residualRoot,'runtime');
  try {
    browser=await launch();
    await navigate('light',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'},reducedMotion:'no-preference'});
    const lineSelector='.workspace-line-swipe-row[data-swipe-id="qa-line-4"]';
    const lineSwipe=await actualSwipe(`${lineSelector} .workspace-line-chevron`,-180,0,280,8);
    const lineOpen=await residualScreenshot('line-last-line-delete-open','Actual CDP touch swipe exposed delete; no product action dispatched.'); previews.push(lineOpen);
    const lineTap=await actualTap(`${lineSelector} .workspace-swipe-delete`,10);
    const linePrompt=(await state()).events.modals.at(-1);
    const lineDispatch=browser.touchDispatchTrace?.()||[];
    await beginRafRemovalProbe({kind:'line-group',selector:lineSelector,targetMode:'parent-group',
      neighborKey:'["device:receiver-1","device:mixer-1"]',expectedId:'qa-line-4',durationMs:720});
    const confirmCall=await confirmIntoRafProbe();
    const lineProbe=await waitForRafProbe();
    const lineSummary=timingSummary(lineProbe,720);
    const lineSettled=await residualScreenshot('line-last-line-group-settled','Captured after the page-side RAF record ended; timeline measurements are in residual-findings.json.'); previews.push(lineSettled);
    runs.push({kind:'last-line-group',lineSwipe:{progress:lineSwipe.progress,cdpDispatch:lineSwipe.gesture,events:lineSwipe.events},deleteTap:lineTap,modalPrompt:linePrompt,confirmation:{invoke:confirmCall,dispatch:lineDispatch},probe:lineSummary});
    findings.push({id:'visual-2-last-line-group-collapse-timing',expected:'After the user confirms deletion, the retained final-line group reduces continuously over its 220ms collapse while its sibling position settles without an end jump; clean up follows transition.',observed:{confirmed:Boolean(linePrompt),frameCount:lineSummary.frameCount,exitStartAt:lineSummary.exitStartAt,confirmToExitMs:lineSummary.confirmToExitMs,maxObservedRafGapMs:lineSummary.maxObservedRafGapMs,near:lineSummary.near,collapseEvidence:lineSummary.collapseEvidence,recordAbsentAtExitEnd:lineSummary.recordAbsentAtExitEnd,targetRemovedAtEnd:lineSummary.targetRemovedAtEnd},classification:classifyCollapse(lineSummary),directEvidence:{newRun:'The page-side requestAnimationFrame loop logs every sampled frame and uses only the existing read-only __qaRefresh GET to observe controller timers; confirm is the fixture response to an actual CDP-tapped Delete button.',cdpTouchActions:lineDispatch,deleteTouch:lineTap.rawTouch,priorNominalSamples:old.groupMotion?.evidence?.samples?.map(item=>({elapsed:item.elapsed,actualElapsed:item.actualElapsed,height:item.targetGroup?.outer?.height,opacity:item.targetGroup?.outer?.opacity,neighborY:item.neighborGroup?.outer?.y}))||[]},nativeRuntime:'NOT RUN'});

    await navigate('dark',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'devices'},reducedMotion:'no-preference'});
    const deviceSelector='.workspace-device-swipe-row[data-swipe-id="receiver-1"]';
    const deviceSwipe=await actualSwipe(`${deviceSelector} .workspace-device-meta`,-125,0,280,8);
    const deviceOpen=await residualScreenshot('device-delete-open','Actual CDP touch swipe exposed delete; no product action dispatched.'); previews.push(deviceOpen);
    const deviceTap=await actualTap(`${deviceSelector} .workspace-swipe-delete`,10);
    const devicePrompt=(await state()).events.modals.at(-1);
    const deviceDispatch=browser.touchDispatchTrace?.()||[];
    await beginRafRemovalProbe({kind:'device-row',selector:deviceSelector,expectedId:'receiver-1',durationMs:720});
    const deviceConfirmCall=await confirmIntoRafProbe();
    const deviceProbe=await waitForRafProbe();
    const deviceSummary=timingSummary(deviceProbe,720);
    const deviceSettled=await residualScreenshot('device-row-settled','Captured after the page-side RAF record ended; timeline measurements are in residual-findings.json.'); previews.push(deviceSettled);
    runs.push({kind:'device-row',deviceSwipe:{progress:deviceSwipe.progress,cdpDispatch:deviceSwipe.gesture,events:deviceSwipe.events},deleteTap:deviceTap,modalPrompt:devicePrompt,confirmation:{invoke:deviceConfirmCall,dispatch:deviceDispatch},probe:deviceSummary});
    findings.push({id:'visual-3-device-ghost-collapse-timing',expected:'Confirmed device deletion commits immediately and fades/collapses the retained row over the 220ms CSS exit; the row is removed only after its transition cleanup.',observed:{confirmed:Boolean(devicePrompt),frameCount:deviceSummary.frameCount,exitStartAt:deviceSummary.exitStartAt,confirmToExitMs:deviceSummary.confirmToExitMs,maxObservedRafGapMs:deviceSummary.maxObservedRafGapMs,near:deviceSummary.near,collapseEvidence:deviceSummary.collapseEvidence,recordAbsentAtExitEnd:deviceSummary.recordAbsentAtExitEnd,targetRemovedAtEnd:deviceSummary.targetRemovedAtEnd},classification:classifyCollapse(deviceSummary),directEvidence:{newRun:'Page-side requestAnimationFrame samples collect row rect, opacity, class and record state continuously; each actual delete button tap uses CDP touch dispatch; modal response is isolated fixture-only.',cdpTouchActions:deviceDispatch,deleteTouch:deviceTap.rawTouch,priorNominalSamples:old.deviceMotion?.evidence?.samples?.map(item=>({elapsed:item.elapsed,actualElapsed:item.actualElapsed,height:item.row?.height,opacity:item.row?.opacity,phase:item.phase}))||[]},nativeRuntime:'NOT RUN'});

    if (!process.argv.includes('--residual-timing')) {
    await navigate('light',390,{fixture:'long',viewPreference:{version:1,projectId:'qa-project-1',tab:'lines'},reducedMotion:'no-preference'});
    const editorOpenTap=await actualTap('.workspace-bottom-bar .workspace-primary-button',30);
    await waitFor('line editor visible',async()=>Boolean((await state()).data.editorVisible),2500);
    await delay(330);
    const continuousOpenTap=await actualTap('.workspace-continuous-button',30);
    await waitFor('continuous editor visible',async()=>Boolean((await state()).data.continuousVisible),2500);
    await delay(330);
    const fromPortSeed=await typeInto('.workspace-continuous-sheet input[data-field="fromPort"]','OUT-R');
    const toPortSeed=await typeInto('.workspace-continuous-sheet input[data-field="toPort"]','IN-R');
    await delay(35);
    const identityBefore=await browser.evaluate(`(()=>{
      const sheet=document.querySelector('.workspace-continuous-sheet');const mask=sheet?.closest('.workspace-continuous-mask');
      const record={sheet,mask,mutations:[],openedAt:performance.now(),sheetClass:sheet?.className||'',maskClass:mask?.className||'',
        sheetKey:sheet?.getAttribute('data-qa-key'),maskKey:mask?.getAttribute('data-qa-key')};window.__qaContinuousIdentity=record;
      const observer=new MutationObserver(list=>{for(const item of list){record.mutations.push({at:performance.now(),type:item.type,
        targetClass:typeof item.target.className==='string'?item.target.className:'',attributeName:item.attributeName,
        oldValue:item.oldValue,added:[...item.addedNodes].map(node=>({tag:node.tagName||'',className:typeof node.className==='string'?node.className:'',key:node.getAttribute?.('data-qa-key')})),
        removed:[...item.removedNodes].map(node=>({tag:node.tagName||'',className:typeof node.className==='string'?node.className:'',key:node.getAttribute?.('data-qa-key')}))})}});
      record.observer=observer;observer.observe(document.querySelector('#app'),{subtree:true,childList:true,attributes:true,attributeFilter:['class'],attributeOldValue:true});
      const content=node=>node?{text:(node.innerText||'').replace(/\\s+/g,' ').trim(),fields:[...node.querySelectorAll('input,textarea,select')].map(field=>({value:field.value||'',placeholder:field.placeholder||''})),descendantCount:node.querySelectorAll('*').length}:null;
      record.beforeContent=content(sheet);return {openedAt:record.openedAt,sheetClass:record.sheetClass,maskClass:record.maskClass,sheetKey:record.sheetKey,maskKey:record.maskKey,content:record.beforeContent};
    })()`);
    const continuousOpenPreview=await residualScreenshot('continuous-editor-open','Continuous editor before close; references retained in the page.'); previews.push(continuousOpenPreview);
    const closeDispatchBefore=browser.touchDispatchTrace?.()||[];
    const continuousCloseTap=await actualTap('.workspace-continuous-sheet .workspace-close-button',0,{downMs:18,clickWaitMs:0,skipState:true});
    const closeImmediate=await continuousIdentitySnapshot('after-real-cdp-close-tap');
    const continuousMidPreview=await residualScreenshot('continuous-editor-closing-mid','Screenshot request is separately timestamped; DOM identity/phase observations are recorded in residual-findings.json.'); previews.push(continuousMidPreview);
    await delay(95);
    await refreshSnapshot();
    const closeMid=await continuousIdentitySnapshot('closing-mid');
    await delay(180);
    await refreshSnapshot();
    const closeSettled=await continuousIdentitySnapshot('closing-settled');
    const closeDispatchAfter=browser.touchDispatchTrace?.()||[];
    runs.push({kind:'continuous-editor-identity',editorOpenTap,continuousOpenTap,fromPortSeed,toPortSeed,identityBefore,continuousCloseTap,
      closeImmediate,closeMid,closeSettled,cdpActions:closeDispatchAfter.slice(closeDispatchBefore.length)});
    const oldRefReused=Boolean(closeImmediate.oldSheetIsLineSheet||closeMid.oldSheetIsLineSheet||closeImmediate.oldMaskIsLineMask||closeMid.oldMaskIsLineMask);
    const recreated=Boolean(closeImmediate.beforeSheetConnected&&!closeImmediate.beforeSheetStillCurrent&&
      closeImmediate.currentContent&&closeImmediate.patchStats&&closeImmediate.patchStats.inserted>0&&closeImmediate.patchStats.removed>0);
    const closeRouted=Boolean(continuousCloseTap.response?.point&&continuousCloseTap.rawTouch?.some(item=>item.type==='touchstart'&&item.matchesExpected)&&
      continuousCloseTap.rawTouch?.some(item=>item.type==='touchend'&&item.matchesExpected)&&
      continuousCloseTap.trace?.some(item=>item.type==='tap'&&item.method==='closeContinuous'));
    const logicalClosePassed=closeRouted&&closeImmediate.continuousVisible===false&&closeImmediate.phase==='closing'&&
      closeImmediate.currentContent?.fieldCount===identityBefore.content?.fieldCount&&
      closeMid.phase==='closing'&&closeMid.currentContent?.fieldCount===identityBefore.content?.fieldCount&&
      closeSettled.phase===''&&closeSettled.continuousVisible===false&&closeSettled.currentContent===null;
    const oldCloseFailure=old.continuous.find(item=>item.name.includes('real close tap'));
    const oldMidFailure=old.continuous.find(item=>item.name.includes('same DOM node'));
    findings.push({
      id:'visual-4-continuous-close-lifecycle',
      expected:'A real close-button touch updates logical visibility, retains the content during the 240ms exit, then clears the sheet after cleanup.',
      observed:{
        closeRouted, phaseImmediately:closeImmediate.phase, visibleImmediately:closeImmediate.continuousVisible,
        phaseMid:closeMid.phase, phaseSettled:closeSettled.phase, visibleSettled:closeSettled.continuousVisible,
        originalFieldCount:identityBefore.content?.fieldCount, originalValues:identityBefore.content?.fields?.map(field=>field.value),
        midCurrentFields:closeMid.currentContent?.fields, settledSheet:closeSettled.currentContent,
        contentNodeRetainedThroughClose:closeImmediate.beforeSheetStillCurrent&&closeMid.beforeSheetStillCurrent,
        helperReusedOldSheetAsLineEditor:oldRefReused,
        oldFinalCheck:{name:oldCloseFailure?.name,nodePreserved:oldCloseFailure?.evidence?.nodePreserved,
          phase:oldCloseFailure?.evidence?.phase,closed:oldCloseFailure?.evidence?.closed,
          contentExists:oldCloseFailure?.evidence?.contentExists,sameContent:oldCloseFailure?.evidence?.sameContent},
      },
      classification:logicalClosePassed?'harness-demonstrated':'unresolved',
      directEvidence:{cdpTouchActions:closeDispatchAfter.slice(closeDispatchBefore.length),
        closeTouchEvents:continuousCloseTap.rawTouch,closeTapRoute:continuousCloseTap.trace,
        probeSnapshots:{before:identityBefore,immediate:closeImmediate,mid:closeMid,settled:closeSettled},
        helperStats:closeImmediate.patchStats}, nativeRuntime:'NOT RUN',
    });
    findings.push({
      id:'visual-5-continuous-mid-exit-node-identity',
      expected:'The same continuous sheet node and entered field values remain mounted through the mid-exit closing state.',
      observed:{
        originalSheetKey:identityBefore.sheetKey,originalMaskKey:identityBefore.maskKey,
        originalSheetClass:identityBefore.sheetClass,originalMaskClass:identityBefore.maskClass,
        immediate:{oldRefConnected:closeImmediate.beforeSheetConnected,oldRefStillCurrent:closeImmediate.beforeSheetStillCurrent,
          oldRefClass:closeImmediate.beforeSheetClass,oldRefIsLineEditor:closeImmediate.oldSheetIsLineSheet,
          currentSheetClass:closeImmediate.currentSheetClass,currentSheetContent:closeImmediate.currentContent,patchStats:closeImmediate.patchStats},
        mid:{oldRefConnected:closeMid.beforeSheetConnected,oldRefStillCurrent:closeMid.beforeSheetStillCurrent,
          oldRefClass:closeMid.beforeSheetClass,oldRefIsLineEditor:closeMid.oldSheetIsLineSheet,
          currentSheetClass:closeMid.currentSheetClass,currentSheetContent:closeMid.currentContent,patchStats:closeMid.patchStats},
        oldRefReusedAsLineEditor:oldRefReused,newContinuousSheetInserted:recreated,mutations:closeImmediate.mutations,
      },
      classification:oldRefReused||recreated?'harness-demonstrated':'unresolved',
      directEvidence:{
        priorCheck:{name:oldMidFailure?.name,nodePreserved:oldMidFailure?.evidence?.nodePreserved,
          phase:oldMidFailure?.evidence?.phase,contentExists:oldMidFailure?.evidence?.contentExists,
          adapterStats:oldMidFailure?.evidence?.adapterStats},
        newRun:'Original sheet and mask object references are retained in-page before a real CDP close tap; MutationObserver plus keyed patch stats record positional reuse/insert/remove during same-document updates.',
        helperSource:'tests/project-wiring-redesign-2026-10-16/keyed-dom-patch.js',
        productionWxml:'pages/project-wiring/workspace.wxml',nativeRuntime:'NOT RUN',
      },
    });
    const patchText=fs.readFileSync(path.join(root,'tests/project-wiring-redesign-2026-10-16/keyed-dom-patch.js'),'utf8');
    const helperMechanism={hasDataQaKeyLookup:patchText.includes("getAttribute('data-qa-key')"),unkeyedUsesPreviousIndex:patchText.includes('const positional = previous[index]'),requiresUnkeyedCompatibleTag:patchText.includes('keyOf(positional) === null')&&patchText.includes('compatible(positional, next)'),wxmlMasksUnkeyed:{lineEditor:!/<view[^>]*class="[^"]*workspace-mask[^\"]*"[^>]*wx:key/.test(fs.readFileSync(path.join(root,'pages/project-wiring/workspace.wxml'),'utf8')),continuous:!/<view[^>]*workspace-continuous-mask[^>]*wx:key/.test(fs.readFileSync(path.join(root,'pages/project-wiring/workspace.wxml'),'utf8'))}};
    findings.push({id:'continuous-adapter-mechanism',expected:'The adapter should preserve WXML keys for loop items and report identity of unkeyed conditional masks without changing production behavior.',observed:helperMechanism,classification:'harness-demonstrated',directEvidence:{helperFile:'tests/project-wiring-redesign-2026-10-16/keyed-dom-patch.js',sourceHash:crypto.createHash('sha256').update(patchText).digest('hex'),branch:'For unkeyed desired nodes, patchChildren consults only previous[index]; the conditional masks are sibling unkeyed views.'},nativeRuntime:'NOT RUN'});
    }
  } finally {
    if (browser) { await browser.close(); browser=null; }
    if(previousEvidenceEnv===undefined) delete process.env.WIRING_QA_EVIDENCE;
    else process.env.WIRING_QA_EVIDENCE=previousEvidenceEnv;
  }

  const sources=sourceManifest();
  const harnessFiles=['tests/project-wiring-redesign-2026-10-16/visual-native-acceptance-run.cjs','tests/project-wiring-redesign-2026-10-16/cdp.cjs','tests/project-wiring-redesign-2026-10-16/browser.js','tests/project-wiring-redesign-2026-10-16/browser-server.cjs','tests/project-wiring-redesign-2026-10-16/native-browser.html','tests/project-wiring-redesign-2026-10-16/native-profile.js','tests/project-wiring-redesign-2026-10-16/keyed-dom-patch.js'].filter(name=>fs.existsSync(path.join(root,name)));
  const manifest={productionSources:sources,harnessSources:fileManifest(harnessFiles),capturedAt:new Date().toISOString()};
  const result={createdAt:new Date().toISOString(),suite:'Residual visual acceptance failure investigation (Chromium adapter)',runtime:'Chromium with isolated in-memory wx; no WeChat native runtime or physical device.',
    productionStorage:'NOT ACCESSED; fixtures are in-memory and isolated.',nativeRuntime:'NOT RUN',physicalDevice:'NOT RUN',
    priorRun:path.relative(harnessRoot,old.previousPath).replaceAll('\\','/'),priorFailures:old.previous.failures,approvedProductionFreeze:frozenCheck,
    findings,runs,previews,manifest,limitations:['The confirmation dialog choice is supplied to the isolated wx.showModal fixture after an actual CDP touch tap on the production Delete button.','RAF geometry and transition observations describe Chromium adapter behavior only.','Fresh wx.nextTick remains synchronous in the adapter; these samples do not establish WeChat/iOS frame cadence.']};
  fs.writeFileSync(path.join(residualRoot,'residual-findings.json'),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(residualRoot,'source-manifest.json'),JSON.stringify(manifest,null,2));
  console.log(`Residual visual investigation: ${findings.length} findings; ${previews.length} previews`);
  console.log(`Evidence: ${residualRoot}`);
}

async function main() {
  fs.mkdirSync(evidenceRoot, { recursive:true })
  fs.mkdirSync(previewRoot, { recursive:true })
  fs.mkdirSync(sceneRoot, { recursive:true })
  const controllerSuite = runControllerSuiteIsolated()
  try {
    browser = await launch()
    const sections=[
      ['header previews and actual header actions',headerMatrix],
      ['device and line swipe/delete flows',swipeAndDeleteChecks],
      ['group and tab motion',groupMotionChecks],
      ['all seven overlay lifecycles',allOverlayChecks],
      ['rapid overlay reversal',rapidReopenCheck],
      ['reduced-motion behavior',reducedMotionChecks],
    ]
    for (const [name,runSection] of sections) {
      try { await runSection() }
      catch (error) { check(`${name}: section completed`,false,error.stack||String(error)) }
    }
  } catch (error) {
    check('Chromium adapter setup completed', false, error.stack || String(error))
  } finally {
    if (browser) await browser.close()
  }

  const manifest = sourceManifest()
  const motion = motionContract()
  check('production source motion values match the accepted short interaction targets',
    motion.overlayOpenMs===300 && motion.overlayCloseMs===240 && motion.overlayOpenCssMs===300 &&
      motion.tabIndicatorCssMs===180 && motion.tabContentCssMs===150 && motion.groupCollapseCssMs===210 &&
      motion.lastLineGroupFadeCssMs===140 && motion.lastLineGroupCollapseCssMs===220 &&
      motion.swipeSettleCssMs===220 && motion.rowFadeCssMs===140 && motion.rowCollapseCssMs===220 &&
      motion.rowCleanupMs>=220 && motion.reducedMotionOverride,
    motion)
  const harnessFiles = [
    'tests/project-wiring-redesign-2026-10-16/visual-native-acceptance-run.cjs',
    'tests/project-wiring-redesign-2026-10-16/cdp.cjs',
    'tests/project-wiring-redesign-2026-10-16/browser.js',
    'tests/project-wiring-redesign-2026-10-16/browser-server.cjs',
    'tests/project-wiring-redesign-2026-10-16/native-browser.html',
    'tests/project-wiring-redesign-2026-10-16/native-profile.js',
    'tests/project-wiring-redesign-2026-10-16/keyed-dom-patch.js',
    'tests/project-wiring-redesign-2026-10-16/runtime.cjs',
    'tests/project-wiring-redesign-2026-10-16/module-refinements-support.cjs',
    'tests/project-wiring-module-refinements-test.cjs',
  ].filter(relative=>fs.existsSync(path.join(root,relative)))
  const qaHarnessManifest = fileManifest(harnessFiles)
  const run = {
    runAt:new Date().toISOString(),
    suite:'Project Wiring native-feedback visual acceptance regression (Chromium adapter)',
    runtime:'Chromium adapter with isolated in-memory wx fixtures; NOT WeChat native runtime or physical device.',
    interactionDriver:'CDP touch-based browser.tap/browser.swipe, targeted WXML handler trace; system modal choice is fixture-simulated.',
    nextTickLimit:'The isolated wx.nextTick fixture invokes its callback synchronously. Fresh overlay preparing/opening states are therefore adapter state snapshots, not native WeChat frame-cadence evidence.',
    timingBasis:'Requested motion checkpoints (capsule progressive/stable icon/220ms settle; row fade/collapse; 300/240ms sheets; 180/150ms tabs; 210ms group) are product target values for adapter verification, not Apple-native measurements.',
    nativeRuntime:'NOT RUN', physicalDevice:'NOT RUN',
    controllerSuite, motion, sourceManifest:manifest, qaHarnessManifest, checks, captures, interactionCases, failures,
  }
  fs.writeFileSync(path.join(evidenceRoot,'visual-acceptance-checks.json'),JSON.stringify(run,null,2))
  fs.writeFileSync(path.join(evidenceRoot,'source-manifest.json'),JSON.stringify({capturedAt:run.runAt,
    productionSources:manifest,qaHarnessSources:qaHarnessManifest,motion,
    note:'Harness adapter files are included for source identity; visual behavior remains Chromium-adapter evidence.'},null,2))
  console.log(`Visual native acceptance checks: ${checks.filter(item=>item.passed).length}/${checks.length}; previews: ${captures.length}`)
  console.log(`Evidence: ${evidenceRoot}`)
  if (failures.length) process.exitCode = 1
}

if (process.argv.includes('--residual-identity')) residualIdentityMain().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1 })
else if (process.argv.includes('--residual-timing')) residualMain().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1 })
else if (process.argv.includes('--residual')) residualMain().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1 })
else main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1 })

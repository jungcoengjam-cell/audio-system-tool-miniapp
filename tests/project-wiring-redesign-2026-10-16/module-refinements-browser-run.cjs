const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { launch, delay } = require('./cdp.cjs')
const { evidenceRoot, sourceManifest, nativeProfile, writeJson } = require('./module-refinements-support.cjs')

const previewRoot = path.join(evidenceRoot, 'previews')
const sceneRoot = path.join(evidenceRoot, 'scenes')
const widths = [320, 390, 430]
const themes = ['light', 'dark']
const checks = []
const captures = []
const interactionCases = []
const failures = []
let browser

function check(name, passed, evidence) {
  const item = { name, passed: Boolean(passed), evidence }
  checks.push(item)
  if (!item.passed) {
    failures.push(name)
    console.error('FAIL', name, JSON.stringify(evidence))
  }
}

async function session() { return browser.evaluate('window.__wiringQa.session') }
async function refreshRuntimeSnapshot() {
  const state = await session()
  return dispatch('onWorkspaceTab', { tab: state.data.workspaceTab })
}
async function dispatch(method, dataset = {}, detail = {}, extra = {}) {
  return browser.evaluate(`window.__dispatch(${JSON.stringify(method)},${JSON.stringify(dataset)},${JSON.stringify(detail)},${JSON.stringify(extra)})`)
}
async function action(name, value, options = {}) {
  return browser.evaluate(`window.__qaAction(${JSON.stringify(name)},${JSON.stringify(value)},${JSON.stringify(options)})`)
}

async function navigate(theme, width, options = {}) {
  await browser.viewport(width, 844, theme, options.reducedMotion || 'reduce')
  const query = new URLSearchParams({ theme, activeProjectId: options.activeProjectId || '__default__' })
  if (options.viewPreference) query.set('viewPreferenceJson', JSON.stringify(options.viewPreference))
  if (options.routeId) query.set('routeId', options.routeId)
  await browser.navigate('tests/project-wiring-redesign-2026-10-16/native-browser.html?' + query)
  await delay(70)
  return session()
}

async function capture(name, details = {}, waitMs = 50) {
  await delay(waitMs)
  const state = await session()
  const view = await browser.evaluate(`(() => {
    const box=(node)=>{if(!node)return null;const r=node.getBoundingClientRect();const s=getComputedStyle(node);return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,opacity:s.opacity,visibility:s.visibility,pointerEvents:s.pointerEvents,transform:s.transform,transitionDuration:s.transitionDuration,animationDuration:s.animationDuration}};
    const root=document.querySelector('.wiring-page')||document.querySelector('page');
    return {viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth,background:getComputedStyle(root).backgroundColor,text:document.querySelector('#app').innerText,
      errors:window.__geometry().errors, topControls:[...document.querySelectorAll('.workspace-nav,.workspace-project-row,.workspace-project-row button')].map(n=>({className:n.className,...box(n)})),
      rows:[...document.querySelectorAll('.workspace-swipe-row')].map(n=>({type:n.dataset.swipeType,id:n.dataset.swipeId,revision:n.dataset.swipeRevision,open:n.classList.contains('workspace-swipe-row-open'),ariaHidden:n.getAttribute('aria-hidden'),...box(n)})),
      groups:[...document.querySelectorAll('.workspace-group-header')].map(n=>({expanded:n.getAttribute('aria-expanded'),linesAriaHidden:n.parentElement?.querySelector('.workspace-group-lines')?.getAttribute('aria-hidden')})),
      deleteButtons:[...document.querySelectorAll('.workspace-swipe-delete')].map(n=>({label:n.getAttribute('aria-label'),minWidth:getComputedStyle(n).minWidth,minHeight:getComputedStyle(n).minHeight,...box(n)})),
      actions:[...document.querySelectorAll('.workspace-swipe-actions')].map(box),
      masks:[...document.querySelectorAll('.workspace-mask')].map(n=>({className:n.className,ariaHidden:n.getAttribute('aria-hidden'),...box(n)})),
      sheets:[...document.querySelectorAll('.workspace-wheel-sheet,.workspace-editor-sheet')].map(box),
      childZones:[...document.querySelectorAll('.workspace-port-cell,.workspace-device-name-scroll,.workspace-group-name')].map(n=>({className:n.className,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,scrollLeft:n.scrollLeft,...box(n)})),
      profile:{sha256:window.__qaNativeSource?.sha256||'',buttonCss:window.__qaNativeButtonCss||'',pickerContracts:window.__qaNativePickerContracts||[]},
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  })()`)
  const filename = path.join(previewRoot, name + '.png')
  await browser.screenshot(filename)
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
  const result = { name, filename, sha256, width: view.viewport.width, theme: documentTheme(view.background), view, details, data: state.data, storage: state.storage, events: state.events, schedule: state.schedule, sources: state.sources }
  fs.mkdirSync(sceneRoot, { recursive: true })
  fs.writeFileSync(path.join(sceneRoot, name + '.json'), JSON.stringify(result, null, 2))
  captures.push({ name, filename, sha256, width: result.width, theme: result.theme })
  check(name + ': production WXML bindings render without expression errors', view.errors.length === 0, view.errors)
  check(name + ': page stays within viewport width', view.pageWidth <= view.viewport.width + 1, { pageWidth: view.pageWidth, viewport: view.viewport.width })
  check(name + ': native v2 profile is loaded by the adapter', Boolean(view.profile.sha256 && view.profile.buttonCss.includes('184px')), { sha256: view.profile.sha256, buttonCss: view.profile.buttonCss })
  return { state, view, result }
}

function documentTheme(background) { return background === 'rgb(0, 0, 0)' ? 'dark' : 'light' }

async function touch(selector, pathPoints, ending = 'touchend') {
  const expression = `(async()=>{
    const selector=${JSON.stringify(selector)};
    const points=${JSON.stringify(pathPoints)};
    const send=async(type,point)=>{
      const target=document.querySelector(selector);if(!target)throw Error('Missing touch target '+selector);
      const event=new Event(type,{bubbles:true,cancelable:true});
      const pointList=type==='touchend'||type==='touchcancel'?[]:[point];
      Object.defineProperty(event,'touches',{value:pointList.map(p=>({clientX:p.x,clientY:p.y}))});
      Object.defineProperty(event,'changedTouches',{value:[{clientX:point.x,clientY:point.y}]});
      target.dispatchEvent(event);await new Promise(resolve=>setTimeout(resolve,70));
    };
    await send('touchstart',points[0]);for(const point of points.slice(1))await send('touchmove',point);await send(${JSON.stringify(ending)},points.at(-1));return window.__wiringQa.session;
  })()`
  return browser.evaluate(expression)
}

async function swipeRow(selector) {
  const points = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing swipe row');const r=n.getBoundingClientRect();return[{x:r.right-20,y:r.y+r.height/2},{x:r.right-128,y:r.y+r.height/2+1}]})()`)
  return touch(selector, points)
}

async function rowAndActionMetrics(selector) {
  return browser.evaluate(`(()=>{const row=document.querySelector(${JSON.stringify(selector)});const actions=row?.querySelector('.workspace-swipe-actions');const button=row?.querySelector('.workspace-swipe-delete');const b=n=>{if(!n)return null;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,visibility:s.visibility,pointerEvents:s.pointerEvents,opacity:s.opacity,minWidth:s.minWidth,minHeight:s.minHeight}};return{rowOpen:row?.classList.contains('workspace-swipe-row-open')||false,actions:b(actions),button:b(button),rowDataset:row?{type:row.dataset.swipeType,id:row.dataset.swipeId,revision:row.dataset.swipeRevision}:null}})()`)
}

async function clickAndWait(selector) {
  return browser.evaluate(`(async()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing click target');node.click();await new Promise(resolve=>setTimeout(resolve,100));return window.__wiringQa.session})()`)
}

async function interactionCleanupAndChildGestures() {
  const theme = 'light', width = 390
  let state = await navigate(theme, width)
  await dispatch('onWorkspaceTab', { tab: 'lines' })

  const rowSelector = '.workspace-line-swipe-row[data-swipe-id="qa-line-1"]'
  const portSelector = '.workspace-port-cell'
  let child = await browser.evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(portSelector)}),r=p.getBoundingClientRect();return {start:{x:r.x+r.width/2,y:r.y+r.height/2},target:'.workspace-line-row'}})()`)
  await touch(portSelector, [child.start])
  await clickAndWait('.workspace-line-row[data-id="qa-line-1"]')
  state = await session()
  check('actual port scroll-view touchstart/end without movement preserves line detail tap', state.data.detailVisible === true, { detailVisible: state.data.detailVisible, child })
  await dispatch('closeLineDetails')
  await delay(10)

  state = await session()
  child = await browser.evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(portSelector)}),r=p.getBoundingClientRect();return {start:{x:r.x+r.width/2,y:r.y+r.height/2}}})()`)
  await touch(portSelector, [child.start, { x: child.start.x + 9, y: child.start.y + 1 }])
  await clickAndWait('.workspace-line-row[data-id="qa-line-1"]')
  state = await session()
  let lineMetrics = await rowAndActionMetrics(rowSelector)
  check('actual short port touch movement suppresses line detail and never exposes row delete without scroll', state.data.detailVisible === false && !lineMetrics.rowOpen && lineMetrics.actions.pointerEvents === 'none', { detailVisible: state.data.detailVisible, lineMetrics })

  child = await browser.evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(portSelector)}),r=p.getBoundingClientRect();return {start:{x:r.x+r.width/2,y:r.y+r.height/2}}})()`)
  await touch(portSelector, [child.start])
  await browser.evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(portSelector)});p.scrollLeft=12;p.dispatchEvent(new Event('scroll',{bubbles:true}))})()`)
  await delay(80)
  await clickAndWait('.workspace-line-row[data-id="qa-line-1"]')
  state = await session()
  check('actual port scroll event suppresses the subsequent detail tap', state.data.detailVisible === false, { detailVisible: state.data.detailVisible })

  await dispatch('closeLineDetails')
  await dispatch('clearSearch')
  const groupSelector = '.workspace-group-header'
  const groupNameSelector = '.workspace-group-name'
  const groupTapPoint = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(groupNameSelector)}),r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await touch(groupNameSelector, [groupTapPoint])
  await clickAndWait(groupSelector)
  state = await session()
  const groupKey = state.data.groups[0].key
  const collapsedAfterTap = state.data.groups[0].collapsed
  let groupAria = await browser.evaluate(`(()=>{const h=document.querySelector('.workspace-group-header'),lines=h?.parentElement?.querySelector('.workspace-group-lines');return{expanded:h?.getAttribute('aria-expanded'),linesHidden:lines?.getAttribute('aria-hidden')}})()`)
  check('actual group-name child tap still toggles its group', collapsedAfterTap === true, { groupKey, collapsedAfterTap })
  check('collapsed group exposes matching rendered ARIA state', groupAria.expanded === 'false' && groupAria.linesHidden === 'true', groupAria)
  await dispatch('toggleGroup', { key: groupKey })
  groupAria = await browser.evaluate(`(()=>{const h=document.querySelector('.workspace-group-header'),lines=h?.parentElement?.querySelector('.workspace-group-lines');return{expanded:h?.getAttribute('aria-expanded'),linesHidden:lines?.getAttribute('aria-hidden')}})()`)
  check('expanded group exposes matching rendered ARIA state', groupAria.expanded === 'true' && groupAria.linesHidden === 'false', groupAria)
  const groupName = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(groupNameSelector)}),r=n.getBoundingClientRect();return {start:{x:r.x+r.width/2,y:r.y+r.height/2}}})()`)
  await touch(groupNameSelector, [groupName.start, { x: groupName.start.x + 9, y: groupName.start.y }])
  await clickAndWait(groupSelector)
  state = await session()
  check('actual short group-name movement suppresses toggle without opening delete', state.data.groups[0].collapsed === false && state.data.groups.every((group) => group.lines.every((line) => !line.swipeOpen)), { collapsed: state.data.groups[0].collapsed, rows: state.data.groups.flatMap((group) => group.lines.map((line) => ({ id: line.id, open: line.swipeOpen }))) })

  await navigate(theme, width)
  await swipeRow('.workspace-device-swipe-row[data-swipe-id="receiver-1"]')
  await swipeRow('.workspace-device-swipe-row[data-swipe-id="mixer-1"]')
  state = await session()
  const openDevices = state.data.devices.filter((device) => device.swipeOpen).map((device) => device.id)
  check('opening another actual device row closes the previous action', JSON.stringify(openDevices) === JSON.stringify(['mixer-1']), openDevices)
  const target = '.workspace-device-swipe-row[data-swipe-id="mixer-1"]'
  let metrics = await rowAndActionMetrics(target)
  check('open delete target is about 72px and meets minimum touch size', metrics.rowOpen && Math.abs(metrics.button.width - 72) <= 1 && metrics.button.height >= 44 && Number.parseFloat(metrics.button.minHeight) >= 44, metrics)
  await touch(target, [{ x: 280, y: 130 }, { x: 281, y: 151 }])
  state = await session()
  metrics = await rowAndActionMetrics(target)
  check('vertical movement closes swipe row without exposing delete', !state.data.devices.some((device) => device.swipeOpen) && metrics.actions.pointerEvents === 'none', { metrics, devices: state.data.devices.filter((device) => device.swipeOpen).map((device) => device.id) })
  await swipeRow('.workspace-device-swipe-row[data-swipe-id="receiver-1"]')
  await touch('.workspace-device-swipe-row[data-swipe-id="receiver-1"]', [{ x: 280, y: 130 }, { x: 170, y: 130 }], 'touchcancel')
  state = await session()
  check('touchcancel on actual row returns to a stable closed state', !state.data.devices.some((device) => device.swipeOpen), state.data.devices.filter((device) => device.swipeOpen).map((device) => device.id))
}

async function normalMotionChecks() {
  const theme = 'light', width = 390
  let state = await navigate(theme, width, { viewPreference: { version: 1, projectId: 'qa-project-1', tab: 'lines' }, reducedMotion: 'no-preference' })
  const normalMotion = await browser.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches")
  check('normal motion case runs with prefers-reduced-motion: no-preference', normalMotion === false, normalMotion)
  await dispatch('requestProjectPicker')
  state = await session()
  let motion = await browser.evaluate(`(()=>{const mask=document.querySelector('.workspace-wheel-mask'),sheet=mask?.querySelector('.workspace-wheel-sheet'),s=n=>n&&getComputedStyle(n);return{maskAnimation:s(mask)?.animationDuration,maskAnimationName:s(mask)?.animationName,sheetAnimation:s(sheet)?.animationDuration,sheetAnimationName:s(sheet)?.animationName,phase:window.__wiringQa.session.data.workspaceOverlayPhases.projectPicker,visible:window.__wiringQa.session.data.projectPickerVisible}})()`)
  const seconds = (value) => {
    const duration = String(value).split(',')[0].trim()
    const number = Number.parseFloat(duration)
    return duration.endsWith('ms') ? number / 1000 : number
  }
  check('normal-motion sheet opening uses brief mask/sheet animations and changes logical state immediately', state.data.projectPickerVisible && motion.maskAnimationName.includes('workspaceMaskIn') && motion.sheetAnimationName.includes('workspaceSheetIn') && seconds(motion.maskAnimation) > 0 && seconds(motion.maskAnimation) <= 0.2 && seconds(motion.sheetAnimation) > 0 && seconds(motion.sheetAnimation) <= 0.2, motion)
  await delay(230)
  state = await refreshRuntimeSnapshot()
  check('normal-motion opening phase settles without hiding the sheet', state.data.workspaceOverlayPhases.projectPicker === '' && state.data.projectPickerVisible && Boolean(await browser.evaluate("document.querySelector('.workspace-wheel-mask')")), { phase: state.data.workspaceOverlayPhases.projectPicker, visible: state.data.projectPickerVisible })
  await dispatch('cancelProjectPicker')
  state = await session()
  motion = await browser.evaluate(`(()=>{const mask=document.querySelector('.workspace-wheel-mask'),s=getComputedStyle(mask);return{duration:s.animationDuration,animationName:s.animationName,opacity:s.opacity,visibility:s.visibility,pointerEvents:s.pointerEvents,phase:window.__wiringQa.session.data.workspaceOverlayPhases.projectPicker,visible:window.__wiringQa.session.data.projectPickerVisible}})()`)
  check('normal-motion close updates modal flag immediately and retains a short visible exit', !state.data.projectPickerVisible && motion.phase === 'closing' && motion.animationName.includes('workspaceMaskOut') && seconds(motion.duration) > 0 && seconds(motion.duration) <= 0.2 && motion.pointerEvents === 'none' && motion.visibility !== 'hidden' && Number(motion.opacity) > 0, motion)
  await capture('sheet-motion-normal-light-390', motion)
  await delay(220)
  state = await refreshRuntimeSnapshot()
  check('normal-motion closing timer removes the overlay and does not resurrect it', state.data.workspaceOverlayPhases.projectPicker === '' && !state.data.projectPickerVisible && !(await browser.evaluate("document.querySelector('.workspace-wheel-mask')")), { phase: state.data.workspaceOverlayPhases.projectPicker, visible: state.data.projectPickerVisible })

  const groupKey = state.data.groups[0]?.key
  const beforeTab = await browser.evaluate("getComputedStyle(document.querySelector('.workspace-tab-content')).animationDuration")
  const groupBefore = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-group-lines');return{height:n.getBoundingClientRect().height,transition:getComputedStyle(n).transitionDuration,property:getComputedStyle(n).transitionProperty}})()`)
  // The adapter re-renders WXML by replacing its DOM tree on setData; toggle
  // the bound production class in place here so Chromium can sample the same
  // element across the source WXSS transition, as WeChat's patched DOM does.
  await browser.evaluate("document.querySelector('.workspace-group-lines')?.classList.add('workspace-group-lines-collapsed')")
  await delay(45)
  let group = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-group-lines');const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{height:r.height,rows:s.gridTemplateRows,opacity:s.opacity,transition:s.transitionDuration,property:s.transitionProperty,collapsedClass:n.classList.contains('workspace-group-lines-collapsed')}})()`)
  check('normal-motion group collapse animates through an intermediate height', group.collapsedClass && group.height > 1 && group.height < groupBefore.height && seconds(group.transition) <= 0.16 && group.property.includes('grid-template-rows'), { before: groupBefore, during: group })
  await delay(155)
  group = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-group-lines');const r=n.getBoundingClientRect();return{height:r.height,opacity:getComputedStyle(n).opacity,collapsedClass:n.classList.contains('workspace-group-lines-collapsed')}})()`)
  check('normal-motion group collapse reaches zero height after the short transition', group.collapsedClass && group.height <= 1 && Number(group.opacity) <= 0.01 && seconds(beforeTab) <= 0.16, { group, tabAnimation: beforeTab })
  await browser.evaluate("document.querySelector('.workspace-group-lines')?.classList.remove('workspace-group-lines-collapsed')")
  await delay(45)
  const expandingGroup = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-group-lines');const r=n.getBoundingClientRect();return{height:r.height,collapsedClass:n.classList.contains('workspace-group-lines-collapsed'),transition:getComputedStyle(n).transitionDuration}})()`)
  check('normal-motion group expansion also passes through visible intermediate height', !expandingGroup.collapsedClass && expandingGroup.height > 1 && expandingGroup.height < groupBefore.height, { fullHeight: groupBefore.height, expandingGroup })
  await delay(180)
  group = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-group-lines'),r=n.getBoundingClientRect();return{height:r.height,collapsedClass:n.classList.contains('workspace-group-lines-collapsed')}})()`)
  check('normal-motion group expansion restores content height', !group.collapsedClass && group.height > 1, group)
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/project-wiring/workspace.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../../pages/project-wiring/workspace.wxss'), 'utf8')
  const tabActiveClass = /workspaceTab\s*===\s*'devices'\s*\?\s*'workspace-tab-active'/.test(wxml) && /workspaceTab\s*===\s*'lines'\s*\?\s*'workspace-tab-active'/.test(wxml)
  check('tab selection and WX hover feedback are bound and styled in the production page', tabActiveClass && /\.workspace-tab-active\s*\{/.test(wxss) && /hover-class="workspace-pressed"/.test(wxml) && /\.workspace-pressed\s*\{/.test(wxss), { tabActiveClass, tabActiveRule: /\.workspace-tab-active\s*\{/.test(wxss), hoverClass: /hover-class="workspace-pressed"/.test(wxml), pressedRule: /\.workspace-pressed\s*\{/.test(wxss) })

  // Use ordinary motion here: sample the saved ghost and apply its production
  // exit class in place, because the Chromium adapter replaces nodes on setData.
  state = await navigate(theme, width, { reducedMotion: 'no-preference' })
  const rowSelector = '.workspace-device-swipe-row[data-swipe-id="receiver-1"]'
  await swipeRow(rowSelector)
  await clickAndWait(`${rowSelector} .workspace-swipe-delete`)
  const confirmation = (await session()).events.modals.at(-1)
  const initialRowHeight = await browser.evaluate(`document.querySelector(${JSON.stringify(rowSelector)})?.getBoundingClientRect().height||0`)
  await action('modal', undefined, { confirm: true })
  const entry = await browser.evaluate(`(()=>{const row=document.querySelector('.workspace-row-retiring');return row&&{height:row.getBoundingClientRect().height,phase:window.__wiringQa.session.data.workspaceRetiringRow?.phase||'',className:row.className,ariaHidden:row.getAttribute('aria-hidden')}})()`)
  await browser.evaluate("window.__rowExitStarted=performance.now();document.querySelector('.workspace-row-retiring')?.classList.add('workspace-row-retiring-exit')")
  const sampleRemoval = async () => browser.evaluate(`(()=>{const row=document.querySelector('.workspace-row-retiring'),content=row?.querySelector('.workspace-swipe-content');if(!row)return null;const r=row.getBoundingClientRect(),s=getComputedStyle(row),c=content&&getComputedStyle(content);return{elapsedMs:performance.now()-window.__rowExitStarted,phase:window.__wiringQa.session.data.workspaceRetiringRow?.phase||'',domExit:row.classList.contains('workspace-row-retiring-exit'),height:r.height,opacity:s.opacity,visibility:s.visibility,pointerEvents:s.pointerEvents,transitionDuration:s.transitionDuration,transitionProperty:s.transitionProperty,gridTemplateRows:s.gridTemplateRows,contentHeight:content?.getBoundingClientRect().height||0,contentOpacity:c?.opacity}})()`)
  const waitUntilExitTime = async (targetMs) => {
    const elapsed = await browser.evaluate('performance.now()-window.__rowExitStarted')
    if (elapsed < targetMs) await delay(targetMs - elapsed)
  }
  await waitUntilExitTime(20)
  const removalStart = await sampleRemoval()
  await waitUntilExitTime(80)
  const removalMiddle = await sampleRemoval()
  check('normal-motion row removal has a brief grid/opacity transition, is hit-test inert, and is aria-hidden', Boolean(entry && entry.ariaHidden === 'true' && removalStart && removalMiddle && initialRowHeight > 1 && removalStart.domExit && removalStart.height > 1 && removalMiddle.height > 1 && removalMiddle.height < removalStart.height && Number(removalMiddle.opacity) > 0 && Number(removalMiddle.opacity) < 1 && removalMiddle.pointerEvents === 'none' && seconds(removalMiddle.transitionDuration) <= 0.2 && removalMiddle.transitionProperty.includes('grid-template-rows')), { initialRowHeight, entry, removalStart, removalMiddle })
  await waitUntilExitTime(185)
  const removalEnd = await sampleRemoval()
  await capture('row-removal-normal-end-light-390', { confirmation, initialRowHeight, entry, removalStart, removalMiddle, removalEnd }, 0)
  check('normal-motion row removal reaches the collapsed end state before cleanup', Boolean(removalEnd && removalEnd.height <= 1 && Number(removalEnd.opacity) <= 0.01 && removalEnd.pointerEvents === 'none'), { removalStart, removalMiddle, removalEnd })
  await delay(45)
  state = await refreshRuntimeSnapshot()
  const removalCleared = await browser.evaluate("!document.querySelector('.workspace-row-retiring-exit') && !window.__wiringQa.session.data.workspaceRetiringRow")
  check('normal-motion row removal timer clears the ghost without leaving a layout gap', removalCleared && !state.schedule.devices.some((device) => device.id === 'receiver-1'), { removalCleared, remainingDevice: state.schedule.devices.some((device) => device.id === 'receiver-1'), revision: state.schedule.revision })
}

async function main() {
  fs.mkdirSync(previewRoot, { recursive: true })
  fs.mkdirSync(sceneRoot, { recursive: true })
  browser = await launch()
  try {
    const initialNative = nativeProfile()
    check('installed native-v2 source still matches the prior 2026-10-16 profile', initialNative.matchedPriorNativeSource === true, initialNative)
    check('native-v2 profile preserves exact 184px default rule, disabled dark rule, and transparent picker layers', Boolean(initialNative.profile?.defaultButtonWidth184px && initialNative.profile?.darkDisabledButtonRule && initialNative.profile?.pickerMaskGradientLayers?.length && initialNative.profile?.pickerOverlayPointerEventsNone?.length && initialNative.profile?.pickerColumnMaskAndIndicatorMethods), initialNative.profile)

    for (const theme of themes) for (const width of widths) {
      let state = await navigate(theme, width, { activeProjectId: '__none__' })
      if (state.data.projectPickerVisible) { await dispatch('cancelProjectPicker'); await delay(210); state = await session() }
      const noProject = await browser.evaluate(`(()=>({nav:Boolean(document.querySelector('.workspace-nav')),projectRow:Boolean(document.querySelector('.workspace-project-row')),projectButtons:[...document.querySelectorAll('.workspace-project-row button')].length,tabs:Boolean(document.querySelector('.workspace-tabs')),centerState:Boolean(document.querySelector('.workspace-scroll .workspace-state')),pickerVisible:Boolean(document.querySelector('.workspace-mask:not(.workspace-overlay-closing)'))}))()`)
      check(`no-project ${theme} ${width}: top project controls remain without duplicate central entry controls`, noProject.nav && noProject.projectRow && noProject.projectButtons >= 2 && !noProject.tabs && !noProject.centerState && !noProject.pickerVisible, noProject)
      await capture(`no-project-top-${theme}-${width}`, noProject)

      state = await navigate(theme, width, { viewPreference: { version: 1, projectId: 'qa-project-1', tab: 'lines' } })
      check(`resumed-lines ${theme} ${width}: cold launch restores stable project and lines tab`, state.data.project?.id === 'qa-project-1' && state.data.workspaceTab === 'lines' && state.data.groups.length > 0, { project: state.data.project, tab: state.data.workspaceTab, groups: state.data.groups.length })
      await capture(`resumed-lines-${theme}-${width}`)

      state = await navigate(theme, width)
      const deviceSelector = '.workspace-device-swipe-row[data-swipe-id="receiver-1"]'
      let metrics = await rowAndActionMetrics(deviceSelector)
      check(`device delete ${theme} ${width}: closed row action cannot receive pointer input`, !metrics.rowOpen && metrics.actions.visibility === 'hidden' && metrics.actions.pointerEvents === 'none', metrics)
      await swipeRow(deviceSelector)
      state = await session()
      metrics = await rowAndActionMetrics(deviceSelector)
      check(`device delete ${theme} ${width}: actual left swipe exposes one 72px delete action`, state.data.devices.find((device) => device.id === 'receiver-1')?.swipeOpen === true && state.data.devices.filter((device) => device.swipeOpen).length === 1 && Math.abs(metrics.button.width - 72) <= 1 && metrics.button.height >= 44, { metrics, open: state.data.devices.filter((device) => device.swipeOpen).map((device) => device.id) })
      const deviceCapture = await capture(`device-delete-open-${theme}-${width}`)
      await clickAndWait(`${deviceSelector} .workspace-swipe-delete`)
      state = await session()
      const devicePrompt = state.events.modals.at(-1)
      const deviceBefore = state.schedule
      check(`device delete ${theme} ${width}: confirmation names exact connected-line count`, Boolean(devicePrompt && /4/.test(devicePrompt.content)), devicePrompt)
      await action('modal', undefined, { confirm: false })
      state = await session()
      const deviceAfterCancel = { modal: devicePrompt, revision: state.schedule.revision, deviceIds: state.schedule.devices.map((device) => device.id), lineIds: state.schedule.lines.map((line) => line.id), projectWrites: state.events.writes.filter((write) => write.key === 'audioTool.projects.v1').length }
      check(`device delete ${theme} ${width}: Cancel leaves project schedule untouched`, state.schedule.revision === deviceBefore.revision && state.schedule.devices.some((device) => device.id === 'receiver-1') && state.schedule.lines.length === 4 && deviceAfterCancel.projectWrites === 0, deviceAfterCancel)
      interactionCases.push({ theme, width, kind: 'device', prompt: devicePrompt, canceledState: deviceAfterCancel, before: { revision: deviceBefore.revision, devices: deviceBefore.devices.map((device) => device.id), lines: deviceBefore.lines.map((line) => line.id) } })

      state = await navigate(theme, width, { viewPreference: { version: 1, projectId: 'qa-project-1', tab: 'lines' } })
      const lineSelector = '.workspace-line-swipe-row[data-swipe-id="qa-line-1"]'
      metrics = await rowAndActionMetrics(lineSelector)
      check(`line delete ${theme} ${width}: closed row action cannot receive pointer input`, !metrics.rowOpen && metrics.actions.visibility === 'hidden' && metrics.actions.pointerEvents === 'none', metrics)
      await swipeRow(lineSelector)
      state = await session()
      metrics = await rowAndActionMetrics(lineSelector)
      check(`line delete ${theme} ${width}: actual swipe reveals only the selected line action`, state.data.groups.some((group) => group.lines.some((line) => line.id === 'qa-line-1' && line.swipeOpen)) && state.data.groups.flatMap((group) => group.lines).filter((line) => line.swipeOpen).length === 1 && Math.abs(metrics.button.width - 72) <= 1 && metrics.button.height >= 44, { metrics, openIds: state.data.groups.flatMap((group) => group.lines).filter((line) => line.swipeOpen).map((line) => line.id) })
      await capture(`individual-line-delete-open-${theme}-${width}`)
      await clickAndWait(`${lineSelector} .workspace-swipe-delete`)
      state = await session()
      const linePrompt = state.events.modals.at(-1)
      const lineBefore = state.schedule
      check(`line delete ${theme} ${width}: confirmation identifies a single stable line`, Boolean(linePrompt && linePrompt.content), linePrompt)
      await action('modal', undefined, { confirm: false })
      state = await session()
      const lineAfterCancel = { modal: linePrompt, revision: state.schedule.revision, lines: state.schedule.lines.map((line) => line.id), projectWrites: state.events.writes.filter((write) => write.key === 'audioTool.projects.v1').length }
      check(`line delete ${theme} ${width}: Cancel preserves every line`, state.schedule.revision === lineBefore.revision && state.schedule.lines.length === 4 && state.schedule.lines.some((line) => line.id === 'qa-line-1') && lineAfterCancel.projectWrites === 0, lineAfterCancel)
      interactionCases.push({ theme, width, kind: 'line', prompt: linePrompt, canceledState: lineAfterCancel, before: { revision: lineBefore.revision, lines: lineBefore.lines.map((line) => line.id) } })

      state = await navigate(theme, width)
      await dispatch('requestProjectPicker')
      const openSheet = await session()
      check(`project sheet ${theme} ${width}: opening is synchronous under reduced motion`, openSheet.data.projectPickerVisible && openSheet.data.workspaceOverlayPhases.projectPicker === 'opening', { visible: openSheet.data.projectPickerVisible, phase: openSheet.data.workspaceOverlayPhases.projectPicker })
      await dispatch('cancelProjectPicker')
      state = await session()
      const closing = await browser.evaluate(`(()=>{const mask=document.querySelector('.workspace-wheel-mask');const sheet=mask?.querySelector('.workspace-wheel-sheet');const css=n=>n&&{opacity:getComputedStyle(n).opacity,visibility:getComputedStyle(n).visibility,pointerEvents:getComputedStyle(n).pointerEvents,transform:getComputedStyle(n).transform,animationDuration:getComputedStyle(n).animationDuration,ariaHidden:n.getAttribute('aria-hidden')};return{mask:css(mask),sheet:css(sheet),reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}})()`)
      check(`project sheet ${theme} ${width}: close flag is immediate and reduced motion hides the retained overlay`, state.data.projectPickerVisible === false && state.data.workspaceOverlayPhases.projectPicker === 'closing' && closing.reduced && closing.mask?.opacity === '0' && closing.mask.visibility === 'hidden' && closing.mask.pointerEvents === 'none' && closing.mask.ariaHidden === 'true' && closing.sheet?.opacity === '0' && closing.sheet.visibility === 'hidden' && closing.sheet.pointerEvents === 'none', { phase: state.data.workspaceOverlayPhases.projectPicker, visible: state.data.projectPickerVisible, closing })
      await capture(`sheet-closing-reduced-motion-${theme}-${width}`, closing)
      state = await navigate(theme, width, { viewPreference: { version: 1, projectId: 'qa-project-1', tab: 'devices' } })
      await dispatch('requestProjectPicker'); await dispatch('cancelProjectPicker'); await dispatch('requestProjectPicker')
      await delay(220)
      state = await session()
      check(`project sheet ${theme} ${width}: close/reopen timer cannot hide newly reopened sheet`, state.data.projectPickerVisible && state.data.workspaceOverlayPhases.projectPicker !== 'closing' && Boolean(await browser.evaluate("document.querySelector('.workspace-wheel-mask')")), { visible: state.data.projectPickerVisible, phase: state.data.workspaceOverlayPhases.projectPicker })
    }

    await interactionCleanupAndChildGestures()
    await normalMotionChecks()

    // Confirm one successful deletion in the visual run to verify the record is
    // removed only after save, and the reduce-motion retiring ghost is already hidden.
    state = await navigate('dark', 390)
    const deviceSelector = '.workspace-device-swipe-row[data-swipe-id="receiver-1"]'
    await swipeRow(deviceSelector)
    await clickAndWait(`${deviceSelector} .workspace-swipe-delete`)
    const confirmation = (await session()).events.modals.at(-1)
    await action('modal', undefined, { confirm: true })
    await delay(40)
    state = await refreshRuntimeSnapshot()
    const ghost = await browser.evaluate(`(()=>{const row=document.querySelector('.workspace-row-retiring-exit');if(!row)return null;const s=getComputedStyle(row),r=row.getBoundingClientRect();return{opacity:s.opacity,pointerEvents:s.pointerEvents,height:r.height,visibility:s.visibility,transform:getComputedStyle(row.querySelector('.workspace-swipe-content')).transform}})()`)
    check('confirmed device delete saves before rendering a visually hidden row-removal ghost', !state.schedule.devices.some((device) => device.id === 'receiver-1') && state.schedule.revision === 1 && ghost && ghost.opacity === '0' && ghost.pointerEvents === 'none' && ghost.height <= 1, { confirmation, revision: state.schedule.revision, ghost, saving: state.data.saving })
    await capture('confirmed-device-removal-reduced-motion-dark-390', { confirmation, ghost })
  } catch (error) {
    check('module-refinements browser runner completes', false, error.stack || String(error))
  } finally {
    if (browser) await browser.close()
  }

  const manifest = sourceManifest()
  const native = nativeProfile()
  const result = {
    runAt: new Date().toISOString(),
    suite: 'project-wiring module refinement previews and actual DOM gesture QA',
    renderer: 'Current production WXML/WXSS with controller handlers in a Chromium adapter using isolated in-memory wx storage.',
    nativeRuntime: 'NOT RUN', physicalDevice: 'NOT RUN',
    nativeProfile: { matchedInstalledSource: native.matchedPriorNativeSource, sourcePath: native.sourcePath, sha256: native.currentSha256, profile: native.profile },
    reducedMotion: 'Chromium emulation: prefers-reduced-motion: reduce; adapter preview, not native WeChat/iPhone.',
    sourceManifest: manifest, checks, captures, interactionCases, failures,
  }
  writeJson('browser-checks.json', result)
  writeJson('source-manifest.json', { capturedAt: result.runAt, manifest, sourceFiles: Object.keys(manifest) })
  writeJson('native-profile.json', native)
  writeJson('interaction-cases.json', interactionCases)
  console.log(`Module browser checks: ${checks.filter((item) => item.passed).length}/${checks.length}; previews: ${captures.length}`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

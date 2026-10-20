const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { launch, delay } = require('./cdp.cjs')
const { root, sourceManifest, hash } = require('./module-refinements-support.cjs')

const here = __dirname
const evidenceRoot = path.join(here, 'evidence/residual-failures-2026-10-16/controls')
const previewsRoot = path.join(evidenceRoot, 'previews')
const scenesRoot = path.join(evidenceRoot, 'scenes')
const tapEvidencePath = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/native-touch/native-touch-acceptance.json')
const visualEvidencePath = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/visual/visual-acceptance-checks.json')
const previousControlEvidencePath = path.join(here, 'evidence/native-acceptance-fix-2026-10-16/controls/control-native-acceptance.json')

function sourceBindings() {
  const files = ['pages/project-wiring/index.wxml', 'pages/project-wiring/workspace.wxml', 'pages/project-wiring/workspace-header.wxml']
  const bindings = []
  const matcher = /\b(bind|catch)(tap|touchstart|touchmove|touchend|touchcancel|input|confirm|change|scroll|focus|blur|keyboardheightchange)\s*=\s*["']([^"']+)["']/g
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    let match
    while ((match = matcher.exec(source))) {
      bindings.push({ file, line: source.slice(0, match.index).split('\n').length, kind: match[1], event: match[2], method: match[3] })
    }
  }
  return bindings
}

function collectObservedRoutes(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObservedRoutes(item, output)
  } else if (value && typeof value === 'object') {
    if (typeof value.method === 'string' && typeof value.type === 'string') {
      output.push({ method: value.method, type: value.type, nativeInput: value.nativeInput || '', source: value.__suite || '' })
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'method' || key === 'type') continue
      collectObservedRoutes(child, output)
    }
  }
  return output
}

function collectEvidenceRoutes(filename, label) {
  if (!fs.existsSync(filename)) return []
  const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const routes = collectObservedRoutes(parsed).map(route => ({ ...route, source: label }))
  const collectRouteSummaries = value => {
    if (Array.isArray(value)) {
      for (const item of value) collectRouteSummaries(item)
    } else if (value && typeof value === 'object') {
      if (Array.isArray(value.routeMethods)) {
        for (const entry of value.routeMethods) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
            routes.push({ type: entry[0], method: entry[1], nativeInput: 'sibling-route-summary', source: label })
          }
        }
      }
      for (const child of Object.values(value)) collectRouteSummaries(child)
    }
  }
  collectRouteSummaries(parsed)
  return routes
}

async function main() {
  fs.mkdirSync(previewsRoot, { recursive: true })
  fs.mkdirSync(scenesRoot, { recursive: true })
  process.env.WIRING_QA_EVIDENCE = evidenceRoot
  const browser = await launch()
  const checks = []
  const ownRoutes = []
  const recordRoutes = []
  const recordedScenes = []
  const controlDiagnostics = []
  const historicalResidualFindings = []
  let lastFixture = 'standard'
  let currentCase = ''

  const state = async () => {
    // Refresh is a read-only snapshot of the isolated runtime, needed to observe
    // delayed controller timers without invoking any page method.
    await browser.evaluate('window.__qaRefresh ? window.__qaRefresh() : null')
    return browser.evaluate('window.__wiringQa.session')
  }
  const trace = () => browser.evaluate('window.__qaEventTrace.slice()')
  const traceLength = () => browser.evaluate('window.__qaEventTrace.length')
  const clearTrace = () => browser.evaluate('if (window.__qaEventTrace) window.__qaEventTrace.length = 0')
  const inspectInput = async selector => browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});const s=window.__wiringQa?.session;return{exists:!!n,value:n?.value??null,selectionStart:n?.selectionStart??null,selectionEnd:n?.selectionEnd??null,active:document.activeElement===n,activeId:document.activeElement?.id||'',deviceDraft: s?.data?.deviceDraft?{name:s.data.deviceDraft.name,count:s.data.deviceDraft.count}:null,deviceNamePreview:s?.data?.deviceNamePreview||[],deviceEditorVisible:s?.data?.deviceEditorVisible??null,routeTail:(window.__qaEventTrace||[]).slice(-8).map(e=>({method:e.method,type:e.type,nativeInput:e.nativeInput,target:e.target,currentTarget:e.currentTarget}))}})()`)
  const inputObservation = async (diagnostic, label, selector) => {
    await browser.evaluate('window.__qaFlushEvents ? window.__qaFlushEvents() : null')
    const observation = await inspectInput(selector)
    diagnostic.observations.push({ step: label, ...observation })
    return observation
  }
  const waitFor = async (predicate, timeout = 2800) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const result = await predicate()
      if (result) return result
      await delay(35)
    }
    throw Error(`Timed out waiting for page state in ${currentCase}`)
  }
  const fresh = async (fixture = 'standard', count = 4) => {
    lastFixture = fixture
    const query = new URLSearchParams({ fixture, count: String(count), theme: 'light', sourceVersion: 'after' })
    await browser.navigate(`tests/project-wiring-redesign-2026-10-16/native-browser.html?${query}`)
    await waitFor(async () => (await state()).data?.project)
    await clearTrace()
    return state()
  }
  const tap = async (selector, options = {}) => {
    const start = await traceLength()
    const result = await browser.tap(selector, { identifier: 0, downMs: 55, clickWaitMs: 65, ...options })
    await delay(35)
    const events = (await trace()).slice(start)
    ownRoutes.push(...events.map(event => ({ ...event, case: currentCase })))
    return { result, events }
  }
  const touchSwipe = async (selector, dx, dy = 0, duration = 240, samples = 5, point) => {
    const start = await traceLength()
    const result = await browser.swipe(selector, dx, dy, duration, samples, { identifier: 0, downMs: 30, endWaitMs: 90, ...(point ? { point } : {}) })
    await delay(35)
    const events = (await trace()).slice(start)
    ownRoutes.push(...events.map(event => ({ ...event, case: currentCase })))
    return { result, events }
  }
  const typeInto = async (selector, text, replace = false) => {
    let node = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return n?{value:n.value,disabled:n.disabled}:null})()`)
    if (!node) throw Error(`Input missing: ${selector}`)
    if (node.disabled) throw Error(`Input disabled: ${selector}`)
    const diagnostic = { case: currentCase, kind: 'native-input-sequence', selector, expectedText: String(text), replace, initialValue: node.value, cdpKeyboardEvents: [], observations: [] }
    controlDiagnostics.push(diagnostic)
    const start = await traceLength()
    await browser.evaluate('window.__qaClearRawTouchTrace ? window.__qaClearRawTouchTrace() : null')
    browser.clearTouchDispatchTrace?.()
    await inputObservation(diagnostic, 'before-touch', selector)
    await browser.tap(selector, { identifier: 0, downMs: 45, clickWaitMs: 35 })
    diagnostic.touchTap = { rawDom: await browser.evaluate('window.__qaRawTouchTrace ? window.__qaRawTouchTrace.slice() : []'), cdpDispatch: browser.touchDispatchTrace?.() || [] }
    await inputObservation(diagnostic, 'after-cdp-touch-tap', selector)
    // Some WXML inputs call preventDefault on the synthesized touch. Preserve
    // the real tap route, then focus that same HTML input as a browser input
    // adapter step before sending keyboard text.
    let focusState = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;if(document.activeElement!==n)n.focus();return{active:document.activeElement===n,id:document.activeElement?.id||'',value:n.value}})()`)
    if (!focusState?.active) {
      await delay(35)
      focusState = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;if(document.activeElement!==n)n.focus();return{active:document.activeElement===n,id:document.activeElement?.id||'',value:n.value}})()`)
    }
    if (!focusState?.active) throw Error(`Native input focus did not reach ${selector}`)
    diagnostic.focusAdapter = { action: 'focus same DOM input after touch route', observed: focusState }
    await inputObservation(diagnostic, 'after-focus-adapter', selector)
    const sendKeyAndObserve = async (label, params) => {
      diagnostic.cdpKeyboardEvents.push({ method: 'Input.dispatchKeyEvent', label, ...params })
      await browser.send('Input.dispatchKeyEvent', params)
      return inputObservation(diagnostic, label, selector)
    }
    if (replace && node.value) {
      await sendKeyAndObserve('select-all-control-down', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 })
      await sendKeyAndObserve('select-all-a-down', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await sendKeyAndObserve('select-all-a-up', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await sendKeyAndObserve('select-all-control-up', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
      diagnostic.selectionAfterSelectAll = await inputObservation(diagnostic, 'after-select-all', selector)
      await sendKeyAndObserve('backspace-down', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      await sendKeyAndObserve('backspace-up', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      // Let the real input event and its WXML handler settle before typing the
      // replacement. The keyed render can replace the input after Backspace.
      await delay(65)
      await browser.evaluate('window.__qaFlushEvents ? window.__qaFlushEvents() : null')
      await browser.evaluate('window.__qaRefresh ? window.__qaRefresh() : null')
      const cleared = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return n?{value:n.value,active:document.activeElement===n}:null})()`)
      diagnostic.afterClearAndRefresh = { ...cleared, state: await inspectInput(selector) }
      if (!cleared) throw Error(`Input disappeared after clearing: ${selector}`)
      if (cleared.value !== '') throw Error(`Native Backspace did not clear ${selector}: ${JSON.stringify(cleared)}`)
      if (!cleared.active) {
        await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n?.focus();return document.activeElement===n})()`)
        await delay(35)
      }
    }
    const inputRouteStart = await traceLength()
    if (text) {
      diagnostic.cdpKeyboardEvents.push({ method: 'Input.insertText', text: String(text) })
      await browser.send('Input.insertText', { text: String(text) })
    }
    await delay(70)
    await browser.evaluate('window.__qaFlushEvents ? window.__qaFlushEvents() : null')
    await inputObservation(diagnostic, 'after-insert-before-refresh', selector)
    await browser.evaluate('window.__qaRefresh ? window.__qaRefresh() : null')
    const typed = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return n?{value:n.value,active:document.activeElement===n}:null})()`)
    const events = await trace()
    ownRoutes.push(...events.slice(start).map(event => ({ ...event, case: currentCase })))
    const inputRoutes = events.slice(inputRouteStart).filter(event => event.type === 'input')
    diagnostic.inputRoutes = events.slice(start).filter(event => event.type === 'input')
    diagnostic.afterRefresh = { ...typed, backend: (await inspectInput(selector)) }
    if (text && !inputRoutes.length) throw Error(`No native input event reached the WXML handler for ${selector}; sequence=${JSON.stringify(diagnostic)}`)
    if (String(typed?.value ?? '') !== String(text)) throw Error(`Native input value mismatch after WXML handling for ${selector}; expected=${JSON.stringify(text)} sequence=${JSON.stringify(diagnostic)}`)
    return { ...typed, inputRoutes, diagnostic }
  }
  const selectIndex = async (selector, index) => {
    const encoded = JSON.stringify(selector)
    const result = await browser.evaluate(`(()=>{const n=document.querySelector(${encoded});if(!n)return{missing:true};n.value=String(${Number(index)});n.dispatchEvent(new Event('change',{bubbles:true}));return{value:n.value,tag:n.tagName}})()`)
    if (!result || result.missing) throw Error(`Picker input missing: ${selector}`)
    await delay(65)
    const events = (await trace()).slice(-5)
    ownRoutes.push(...events.map(event => ({ ...event, case: currentCase })))
    return { ...result, events }
  }
  const emitFixtureEvent = async (selector, type, detail) => {
    const before = await traceLength()
    await browser.evaluate(`window.__qaEmitWxmlEvent(${JSON.stringify(selector)},${JSON.stringify(type)},${JSON.stringify(detail)})`)
    await delay(45)
    const events = (await trace()).slice(before)
    ownRoutes.push(...events.map(event => ({ ...event, case: currentCase })))
    return events
  }
  const touchSequence = async (selector, dx, dy, endType = 'touchEnd', point) => {
    const box = point || await browser.pointFor(selector)
    const start = await traceLength()
    await browser.touchAt('touchStart', box.x, box.y, 0)
    await delay(35)
    await browser.touchAt('touchMove', box.x + dx, box.y + dy, 0)
    await delay(35)
    await browser.evaluate('window.__qaFlushEvents()')
    await browser.touchAt(endType, box.x + dx, box.y + dy, 0)
    await delay(45)
    await browser.evaluate('window.__qaFlushEvents()')
    const events = (await trace()).slice(start)
    ownRoutes.push(...events.map(event => ({ ...event, case: currentCase })))
    return { point: box, endType, events }
  }
  const fixtureAction = async (action, value, options = {}) => browser.evaluate(`window.__qaAction(${JSON.stringify(action)},${JSON.stringify(value)},${JSON.stringify(options)})`)
  const respondModal = async confirm => fixtureAction('modal', null, { confirm })
  const record = async (name, body, options = {}) => {
    currentCase = name
    await clearTrace()
    try {
      const evidence = await body()
      const passed = evidence?.pass !== false
      if (!passed) throw Error(`Assertion returned pass:false: ${name}`)
      recordRoutes.push(...(await trace().catch(() => [])).map(event => ({ ...event, case: name })))
      checks.push({ name, passed: true, evidence })
      if (options.capture !== false) await captureScene(name, evidence)
      console.log(`PASS ${name}`)
      return evidence
    } catch (error) {
      recordRoutes.push(...(await trace().catch(() => [])).map(event => ({ ...event, case: name })))
      if (!checks.some(item => item.name === name && !item.passed)) checks.push({ name, passed: false, error: error.stack || error.message, diagnostics: controlDiagnostics.filter(item => item.case === name) })
      console.error(`FAIL ${name}: ${error.message}`)
      try { await captureScene(name, { error: error.message, diagnostics: controlDiagnostics.filter(item => item.case === name) }) } catch {}
      return { pass: false, error: error.message }
    }
  }
  const captureScene = async (name, evidence) => {
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const screenshot = path.join(previewsRoot, `${safeName}.png`)
    try { await browser.screenshot(screenshot) } catch (error) { evidence = { ...evidence, screenshotError: error.message } }
    const scene = {
      case: name,
      generatedAt: new Date().toISOString(),
      fixture: lastFixture,
      screenshot: path.relative(evidenceRoot, screenshot).replace(/\\/g, '/'),
      state: await state().catch(() => null),
      trace: await trace().catch(() => []),
      evidence,
    }
    fs.writeFileSync(path.join(scenesRoot, `${safeName}.json`), JSON.stringify(scene, null, 2))
    recordedScenes.push({ case: name, screenshot: scene.screenshot, scene: `scenes/${safeName}.json` })
  }
  const routeTap = async (selector, method, point) => {
    const routed = await tap(selector, point ? { point } : {})
    const entry = routed.events.find(event => event.method === method && event.type === 'tap')
    assert(entry, `Expected touch-tap route ${method} from ${selector}; saw ${routed.events.map(event => `${event.type}:${event.method}`).join(', ')}`)
    assert.equal(entry.nativeInput, 'synthesized-touch-tap', `${method} was not produced by CDP touch tap`)
    return { entry, events: routed.events }
  }
  const findBackdropPoint = async sheetSelector => {
    const encoded = JSON.stringify(sheetSelector)
      const result = await browser.evaluate(`(()=>{
      const sheet=document.querySelector(${encoded});
      const mask=sheet?.closest('.workspace-mask') || sheet?.closest('.wiring-report-mask');
      const backdrop=mask?.querySelector('.wiring-backdrop');
      if(!mask||!backdrop)return{found:false,sheet:!!sheet,mask:!!mask,backdrop:!!backdrop};
      const r=backdrop.getBoundingClientRect();
      for(let y=Math.max(2,Math.floor(r.top+8));y<r.bottom-2;y+=8){
        for(let x=Math.max(2,Math.floor(r.left+8));x<r.right-2;x+=8){
          const hit=document.elementFromPoint(x,y);
          if(hit===backdrop)return{found:true,x,y,hit:hit.tagName.toLowerCase(),selector:${encoded},maskClass:mask.className,backdropMethod:backdrop.getAttribute('data-bindtap')||backdrop.getAttribute('data-catchtap')||''};
        }
      }
      return{found:false,selector:sheetSelector,maskClass:mask.className,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},sheetRect:(()=>{const s=sheet.getBoundingClientRect();return{left:s.left,top:s.top,right:s.right,bottom:s.bottom}})()};
    })()`)
    if (!result?.found) throw Error(`No exposed backdrop point for ${sheetSelector}: ${JSON.stringify(result)}`)
    return { x: result.x, y: result.y, selector: 'view', disabled: false, visibility: 'visible', display: 'block', exposedTarget: result.hit, backdropMethod: result.backdropMethod }
  }
  const inspectGroupHeader = async groupKey => {
    const encodedKey = JSON.stringify(String(groupKey))
    return browser.evaluate(`(()=>{
      const key=${encodedKey};
      const header=[...document.querySelectorAll('.workspace-group-header')].find(node=>node.dataset.key===key);
      if(!header)return{found:false,key,headers:[...document.querySelectorAll('.workspace-group-header')].map(node=>({key:node.dataset.key,rect:(()=>{const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})()}))};
      const rectOf=node=>{const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const labels=[['group-name','.workspace-group-name'],['group-arrow','.workspace-group-arrow'],['group-target','.workspace-group-target'],['group-count','.workspace-group-count'],['group-chevron','.workspace-group-chevron']];
      const children=labels.map(([label,selector])=>{
        const node=header.querySelector(selector);if(!node)return{label,selector,missing:true};
        const rect=rectOf(node);const ratios=[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75]];
        const probes=ratios.map(([rx,ry])=>{const point={x:rect.left+rect.width*rx,y:rect.top+rect.height*ry};const hit=window.__qaInspectHit(node,point);const path=hit.actualHitPath||[];return{ratio:[rx,ry],point,hit:hit.actualHit,hitPath:path.map(item=>({tagName:item.tagName,className:item.className,bindings:item.bindings})),insideHeader:path.some(item=>item.className.split(' ').includes('workspace-group-header')),insideScroll:path.some(item=>item.tagName==='scroll-view'),insideGroupNameScroll:path.some(item=>item.tagName==='scroll-view'&&item.className.split(' ').includes('workspace-group-name')),insideWorkspaceListScroll:path.some(item=>item.tagName==='scroll-view'&&item.className.split(' ').includes('workspace-scroll'))}});
        return{label,selector,node:window.__qaInspectHit(node).selected,probes};
      });
      const hr=rectOf(header);const candidates=[];
      for(const child of children){if(child.missing||child.label==='group-name'||child.label==='group-target')continue;for(const probe of child.probes){if(probe.insideHeader&&!probe.insideGroupNameScroll&&probe.hit){candidates.push({source:child.label,selector:child.selector,...probe.point,actualHit:probe.hit,hitPath:probe.hitPath});break}}}
      let scanned=0;
      if(!candidates.length){
        for(let y=Math.ceil(hr.top+2);y<hr.bottom-1;y+=2){for(let x=Math.ceil(hr.left+2);x<hr.right-1;x+=2){const hit=window.__qaInspectHit(header,{x,y});scanned++;const path=hit.actualHitPath||[];if(path.some(item=>item.className.split(' ').includes('workspace-group-header'))&&!path.some(item=>item.tagName==='scroll-view'&&item.className.split(' ').includes('workspace-group-name'))&&hit.actualHit){candidates.push({source:'header-grid-hit-tested',selector:'.workspace-group-header',x,y,actualHit:hit.actualHit,hitPath:path.map(item=>({tagName:item.tagName,className:item.className,bindings:item.bindings}))});break}}if(candidates.length)break}
      }
      const center={x:hr.left+hr.width/2,y:hr.top+hr.height/2};
      const centerHit=window.__qaInspectHit(header,center);
      return{found:true,key,header:window.__qaInspectHit(header).selected,headerCenter:{point:center,actualHit:centerHit.actualHit,hitPath:(centerHit.actualHitPath||[]).map(item=>({tagName:item.tagName,className:item.className,bindings:item.bindings})),insideScroll:(centerHit.actualHitPath||[]).some(item=>item.tagName==='scroll-view'),insideGroupNameScroll:(centerHit.actualHitPath||[]).some(item=>item.tagName==='scroll-view'&&item.className.split(' ').includes('workspace-group-name')),insideWorkspaceListScroll:(centerHit.actualHitPath||[]).some(item=>item.tagName==='scroll-view'&&item.className.split(' ').includes('workspace-scroll'))},children,candidatePoints:candidates,gridScanned:scanned};
    })()`)
  }
  const currentRoutes = async () => trace()
  const enterLineDetails = async id => {
    if ((await state()).data.workspaceTab !== 'lines') {
      await routeTap('[data-tab="lines"]', 'onWorkspaceTab')
      await waitFor(async () => (await state()).data.workspaceTab === 'lines')
    }
    const selector = id ? `.workspace-line-row[data-id="${id}"]` : '.workspace-line-row'
    const { entry } = await routeTap(selector, 'onLineTap')
    await waitFor(async () => (await state()).data.detailVisible)
    return entry
  }

  try {
    await browser.viewport(390, 844, 'light', 'no-preference')

    await record('connect device, endpoint options, custom connector, pairs, continuous preview and saveLine', async () => {
      await fresh('standard', 40)
      const initialLineCount = (await state()).data.lineCount
      const { entry: connectEntry } = await routeTap('.workspace-connect-button[data-id="receiver-1"]', 'connectDevice')
      await waitFor(async () => (await state()).data.editorVisible)
      let page = await state()
      assert.equal(page.data.draft.fromDeviceId, 'receiver-1', 'Connect device must prefill the exact stable source id')
      const toIndex = page.data.deviceChoices.findIndex(device => device.id === 'mixer-1')
      assert(toIndex >= 0, 'Fixture target endpoint is available')
      const endpointChange = await selectIndex('picker[data-side="to"] select', toIndex)
      page = await state()
      assert.equal(page.data.draft.toDeviceId, 'mixer-1')
      assert(endpointChange.events.some(event => event.method === 'selectEndpoint' && event.type === 'change'))

      const connectorCustomIndex = page.data.connectorOptions.findIndex(option => option.id === 'custom')
      assert(connectorCustomIndex >= 0, 'Custom connector option exists')
      await selectIndex('picker[data-field="connectorA"] select', connectorCustomIndex)
      await typeInto('#wiring-editor-connector-a', 'QA custom plug')
      page = await state()
      assert.equal(page.data.draft.connectorA, 'QA custom plug')
      const connectorBIndex = page.data.connectorOptions.findIndex(option => option.id === 'xlrMale')
      if (connectorBIndex >= 0) await selectIndex('picker[data-field="connectorB"] select', connectorBIndex)

      await routeTap('.workspace-add-pair', 'addDraftPair')
      assert.equal((await state()).data.draftPairs.length, 2)
      await routeTap('.workspace-pair-remove[data-index="1"]', 'removeDraftPair')
      assert.equal((await state()).data.draftPairs.length, 1)

      await routeTap('.workspace-continuous-button', 'openContinuous')
      await waitFor(async () => (await state()).data.continuousVisible)
      await typeInto('#wiring-continuous-from', 'OUT10', true)
      await typeInto('#wiring-continuous-to', 'IN20', true)
      const continuousStep = await routeTap('.workspace-continuous-sheet .workspace-step-button[data-delta="1"]', 'onContinuousCountStep')
      page = await state()
      assert.deepEqual(page.data.continuousPairs.map(pair => [pair.fromPort, pair.toPort]), [['OUT10', 'IN20'], ['OUT11', 'IN21'], ['OUT12', 'IN22']])
      await emitFixtureEvent('#wiring-continuous-from', 'keyboardheightchange', { height: 260 })
      assert((await trace()).some(event => event.method === 'onFormKeyboardHeightChange' && event.type === 'keyboardheightchange'))
      await routeTap('.workspace-continuous-sheet .workspace-sheet-save', 'fillContinuous')
      await waitFor(async () => !(await state()).data.continuousVisible)
      await delay(280)
      page = await state()
      assert.equal(page.data.draftPairs.length, 3)
      assert.equal(page.data.draftPairs[2].toPort, 'IN22')

      const beforeSave = await traceLength()
      await routeTap('.workspace-editor-sheet .workspace-sheet-save', 'saveLine')
      await waitFor(async () => (await state()).data.lineCount === initialLineCount + 3)
      page = await state()
      const saveRoutes = (await trace()).slice(beforeSave).filter(event => event.method === 'saveLine')
      assert.equal(page.data.editorVisible, false)
      assert.equal(page.data.lineCount, initialLineCount + 3)
      assert(page.events.writes.some(write => write.key === 'audioTool.projects.v1'))
      return { pass: Boolean(connectEntry && continuousStep.entry && saveRoutes.length && page.data.lineCount === 43), sourceId: 'receiver-1', targetId: 'mixer-1', connectedIds: ['receiver-1', 'mixer-1'], initialLineCount, finalLineCount: page.data.lineCount, customConnector: 'QA custom plug', pairPreview: [['OUT10', 'IN20'], ['OUT11', 'IN21'], ['OUT12', 'IN22']], continuousCountStepRoute: continuousStep.entry, fixtureStorageOnly: true, saveRoute: saveRoutes.at(-1) }
    })

    await record('search input, Enter confirm and clear button use visible WXML routes', async () => {
      await fresh('standard', 12)
      await typeInto('.workspace-search-input', 'A001')
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await delay(50)
      let page = await state()
      const routes = await trace()
      assert.equal(page.data.searchText, 'A001')
      assert(routes.some(event => event.method === 'onSearchInput' && event.type === 'input'))
      assert(routes.some(event => event.method === 'applySearch' && event.type === 'confirm'))
      assert(page.data.visibleLines.some(line => line.code === 'A001'))
      await routeTap('.workspace-search-clear', 'clearSearch')
      page = await state()
      assert.equal(page.data.searchText, '')
      assert.equal(page.data.visibleLines.length, page.data.lineCount)
      return { pass: true, inputValue: 'A001', visibleAfterConfirm: page.data.visibleLines.length, methods: ['onSearchInput', 'applySearch', 'clearSearch'], clearTarget: (await trace()).find(event => event.method === 'clearSearch')?.target }
    })

    await record('isolated read failure exposes Retry and Retry touch recovers the current project', async () => {
      await fresh('standard', 4)
      await fixtureAction('read-failure', true)
      const failed = await fixtureAction('reload', true)
      assert(failed.data.loadError, 'read-failure fixture should display load error')
      await fixtureAction('read-failure', false)
      const { entry } = await routeTap('.workspace-soft-button', 'retryLoad')
      await waitFor(async () => (await state()).data.project?.id === 'qa-project-1')
      const recovered = await state()
      return { pass: Boolean(entry && recovered.data.project?.id === 'qa-project-1'), failureWasIsolated: true, canRetryAtFailure: failed.data.canRetry, retryTap: entry, recoveredProjectId: recovered.data.project.id }
    })

    await record('detail edit and saveLine update route through the detail card and editor controls', async () => {
      await fresh('standard', 4)
      const detailTap = await enterLineDetails('qa-line-1')
      const editRoute = await routeTap('.workspace-detail-sheet .workspace-primary-button', 'editDetailLine')
      await waitFor(async () => (await state()).data.editorVisible)
      const oldSpec = (await state()).data.draft.spec
      await typeInto('#wiring-editor-spec', 'QA EDIT SPEC', true)
      const keyboardRoute = await emitFixtureEvent('#wiring-editor-spec', 'keyboardheightchange', { height: 300 })
      await routeTap('.workspace-editor-sheet .workspace-sheet-save', 'saveLine')
      await waitFor(async () => !(await state()).data.editorVisible)
      const page = await state()
      const saved = page.schedule.lines.find(line => line.id === 'qa-line-1')
      assert.equal(saved.spec, 'QA EDIT SPEC')
      assert(page.events.writes.some(write => write.key === 'audioTool.projects.v1'))
      return { pass: Boolean(detailTap && editRoute.entry && keyboardRoute.some(event => event.method === 'onFormKeyboardHeightChange') && saved), oldSpec, savedSpec: saved.spec, lineId: saved.id, routeMethods: ['onLineTap', 'editDetailLine', 'onDraftInput', 'saveLine', 'onFormKeyboardHeightChange'], storageIsRuntimeMock: true }
    })

    await record('editor Delete cancel, save-failure retention, then confirmed success', async () => {
      await fresh('standard', 4)
      await enterLineDetails('qa-line-2')
      await routeTap('.workspace-detail-sheet .workspace-primary-button', 'editDetailLine')
      await waitFor(async () => (await state()).data.editorVisible)
      const beforeId = (await state()).data.draft.id
      await routeTap('.workspace-delete-button', 'deleteLine')
      const cancelModal = (await state()).events.modals.at(-1)
      assert(cancelModal, 'Delete opens confirmation')
      await respondModal(false)
      let page = await state()
      assert.equal(page.data.editorVisible, true)
      assert(page.schedule.lines.some(line => line.id === beforeId))

      await routeTap('.workspace-delete-button', 'deleteLine')
      await fixtureAction('write-failure', true)
      await respondModal(true)
      await waitFor(async () => !(await state()).data.saving)
      page = await state()
      assert(page.data.editorVisible, 'Write failure must leave editor/record available')
      assert(page.data.saveError || page.data.formError, 'Write failure should report an error')
      assert(page.schedule.lines.some(line => line.id === beforeId))

      await fixtureAction('write-failure', false)
      await routeTap('.workspace-delete-button', 'deleteLine')
      await respondModal(true)
      await waitFor(async () => !(await state()).schedule.lines.some(line => line.id === beforeId))
      page = await state()
      const deleteRoutes = (await trace()).filter(event => event.method === 'deleteLine' && event.type === 'tap')
      assert.equal(page.data.editorVisible, false)
      return { pass: deleteRoutes.length === 3 && !page.schedule.lines.some(line => line.id === beforeId), lineId: beforeId, confirmationCount: page.events.modals.filter(modal => modal.title).length, deleteTapCount: deleteRoutes.length, cancelKeptRecord: true, failedWriteKeptRecord: true, finalDeleteConfirmed: true, fixtureStorageOnly: true }
    })

    await record('project picker cancel, backdrop, wheel selection fixture and Done route', async () => {
      await fresh('standard', 4)
      await routeTap('.workspace-project-button', 'requestProjectPicker')
      await waitFor(async () => (await state()).data.projectPickerVisible)
      const cancelRoute = await routeTap('.workspace-wheel-cancel', 'cancelProjectPicker')
      assert.equal((await state()).data.projectPickerVisible, false)
      await delay(280)
      await routeTap('.workspace-project-button', 'requestProjectPicker')
      await waitFor(async () => (await state()).data.projectPickerVisible)
      const pickerBackdrop = await findBackdropPoint('.workspace-wheel-sheet')
      const backdrop = await tap('.workspace-wheel-mask .wiring-backdrop', { point: pickerBackdrop })
      assert(backdrop.events.some(event => event.method === 'cancelProjectPicker' && event.type === 'tap'))
      assert.equal((await state()).data.projectPickerVisible, false)
      await delay(280)
      await routeTap('.workspace-project-button', 'requestProjectPicker')
      await waitFor(async () => (await state()).data.projectPickerVisible)
      const beforeIndex = (await state()).data.wheelProjectIndex[0]
      const gesture = await touchSwipe('.workspace-project-wheel', 0, -35, 180, 3)
      const wheelRoutes = await emitFixtureEvent('.workspace-project-wheel', 'change', { value: [1] })
      const wheelState = await state()
      assert.equal(wheelState.data.wheelProjectIndex[0], 1)
      assert(wheelRoutes.some(event => event.method === 'onProjectWheelChange' && event.type === 'change' && event.nativeInput === 'explicit-native-event-fixture'))
      await routeTap('.workspace-wheel-sheet .workspace-done', 'confirmProjectPicker')
      await waitFor(async () => (await state()).data.project?.id === 'qa-project-2')
      const confirmed = await state()
      return { pass: cancelRoute.entry && confirmed.data.project.id === 'qa-project-2', cancelRoute: cancelRoute.entry, backdropRoute: backdrop.events.find(event => event.method === 'cancelProjectPicker'), wheelIndexBefore: beforeIndex, wheelIndexAfter: wheelState.data.wheelProjectIndex[0], cdpWheelTouchEvents: gesture.events.map(event => `${event.type}:${event.method}`), pickerSelection: 'OS selection completion emitted as explicit WXML change fixture; not physical picker proof', doneRoute: (await trace()).find(event => event.method === 'confirmProjectPicker'), selectedProjectId: confirmed.data.project.id }
    })

    await record('new-project overlay input, close and create routes', async () => {
      await fresh('standard', 4)
      await routeTap('.workspace-new', 'requestNewProject')
      await waitFor(async () => (await state()).data.newProjectVisible)
      const { entry: closeRoute } = await routeTap('.workspace-new-project-sheet .workspace-close-button', 'closeNewProject')
      assert.equal((await state()).data.newProjectVisible, false)
      await delay(280)
      await routeTap('.workspace-new', 'requestNewProject')
      await waitFor(async () => (await state()).data.newProjectVisible)
      const newProjectBackdropPoint = await findBackdropPoint('.workspace-new-project-sheet')
      const backdropClose = await routeTap('.workspace-mask .wiring-backdrop', 'closeNewProject', newProjectBackdropPoint)
      assert.equal((await state()).data.newProjectVisible, false)
      await delay(280)
      await routeTap('.workspace-new', 'requestNewProject')
      await waitFor(async () => (await state()).data.newProjectVisible)
      await typeInto('.workspace-new-project-sheet input', 'QA isolated project')
      const page = await state()
      assert.equal(page.data.projectPickerName, 'QA isolated project')
      const { entry: createRoute } = await routeTap('.workspace-new-project-save', 'createAndOpenProject')
      await waitFor(async () => (await state()).data.project?.name === 'QA isolated project')
      const created = await state()
      return { pass: Boolean(closeRoute && backdropClose.entry && createRoute && created.data.project?.name === 'QA isolated project'), inputValue: 'QA isolated project', methods: ['requestNewProject', 'onProjectNameInput', 'closeNewProject', 'createAndOpenProject'], xCloseRoute: closeRoute, backdropCloseRoute: backdropClose.entry, createdId: created.data.project.id, fixtureStorageOnly: true }
    })

    await record('device sheet close routes, sheet stopEvent and unsaved confirmation cancel/confirm', async () => {
      await fresh('standard', 4)
      await routeTap('.workspace-primary-button', 'openDeviceEditor')
      await waitFor(async () => (await state()).data.deviceEditorVisible)
      const counterfactualInputSelector = '#wiring-device-name'
      const counterfactualBefore = await inspectInput(counterfactualInputSelector)
      const counterfactualRouteStart = await traceLength()
      await browser.tap(counterfactualInputSelector, { identifier: 0, downMs: 45, clickWaitMs: 35 })
      let counterfactualFocus = await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(counterfactualInputSelector)});if(!n)return null;if(document.activeElement!==n)n.focus();return{active:document.activeElement===n,value:n.value,selectionStart:n.selectionStart,selectionEnd:n.selectionEnd}})()`)
      if (!counterfactualFocus?.active) throw Error('C1 counterfactual could not focus the visible device-name input')
      await browser.send('Input.insertText', { text: 'QA control-save device' })
      await delay(70)
      await browser.evaluate('window.__qaFlushEvents ? window.__qaFlushEvents() : null')
      await browser.evaluate('window.__qaRefresh ? window.__qaRefresh() : null')
      const counterfactualAfter = await inspectInput(counterfactualInputSelector)
      const counterfactualEvents = (await trace()).slice(counterfactualRouteStart)
      ownRoutes.push(...counterfactualEvents.map(event => ({ ...event, case: currentCase })))
      const counterfactual = {
        action: 'synthesized touch on the real input, focus the same DOM input in the browser adapter, then Input.insertText without select-all or Backspace',
        expectedRequestedText: 'QA control-save device',
        before: { value: counterfactualBefore.value, selectionStart: counterfactualBefore.selectionStart, selectionEnd: counterfactualBefore.selectionEnd, active: counterfactualBefore.active },
        focusBeforeInsert: counterfactualFocus,
        observed: { value: counterfactualAfter.value, deviceDraft: counterfactualAfter.deviceDraft, deviceNamePreview: counterfactualAfter.deviceNamePreview },
        inputRoutes: counterfactualEvents.filter(event => event.type === 'input').map(event => ({ method: event.method, type: event.type, target: event.target, currentTarget: event.currentTarget })),
        reproducedOldObservedValue: counterfactualAfter.value === '接收机QA control-save device',
      }
      assert.equal(counterfactual.observed.value, '接收机QA control-save device', 'No-replacement counterfactual should reproduce the previous append result')
      assert.equal(counterfactual.observed.deviceDraft?.name, '接收机QA control-save device', 'WXML input handler should store the same appended value in the fixture draft')
      assert(counterfactual.inputRoutes.some(event => event.method === 'onDeviceDraftInput' && event.type === 'input'))
      controlDiagnostics.push({ case: currentCase, kind: 'historical-C1-no-replacement-counterfactual', ...counterfactual, classification: 'The no-replacement sequence reproduces the previous appended value through the real WXML input route. The preserved failed run lacks its selection/focus/event timeline, so this confirms a harness-sequence candidate but does not prove that the historical run used this exact sequence.' })
      historicalResidualFindings.push({
        id: 'C1',
        previousEvidence: path.relative(here, previousControlEvidencePath).replace(/\\/g, '/'),
        previousExpected: { typedName: 'QA control-save device', replacingDefaultName: '接收机' },
        previousObserved: { inputValue: '接收机QA control-save device', priorReportError: 'Native input value mismatch after WXML handling for #wiring-device-name' },
        currentCounterfactual: counterfactual,
        currentControlResult: 'Replacement sequence selects the existing value, clears it through a real Backspace/input route, types the requested value, saves the expected device names, and verifies isolated project storage.',
        causalClassification: 'No-replacement input reproduces the old appended value, but the old failure artifact did not record selection/focus or event order. Historical root cause remains unproven; current visible input and save paths pass.',
      })
      await fresh('standard', 4)
      await routeTap('.workspace-primary-button', 'openDeviceEditor')
      await waitFor(async () => (await state()).data.deviceEditorVisible)
      const sheetTap = await tap('.workspace-device-sheet .wiring-sheet-handle')
      assert(sheetTap.events.some(event => event.method === 'stopEvent' && event.type === 'tap'))
      await routeTap('.workspace-device-sheet .workspace-close-button', 'requestCloseDeviceEditor')
      await waitFor(async () => !(await state()).data.deviceEditorVisible)
      await delay(280)
      await routeTap('.workspace-primary-button', 'openDeviceEditor')
      await waitFor(async () => (await state()).data.deviceEditorVisible)
      const leftBackdropPoint = await findBackdropPoint('.workspace-device-sheet')
      const backdropTouch = await touchSwipe('.workspace-mask .wiring-backdrop', 0, -70, 160, 3, leftBackdropPoint)
      assert(backdropTouch.events.some(event => event.method === 'preventTouchMove' && event.type === 'touchmove'))
      // A no-move touch tap on the backdrop exercises the close binding.
      const backdropClose = await routeTap('.workspace-mask .wiring-backdrop', 'requestCloseDeviceEditor', leftBackdropPoint)
      await waitFor(async () => !(await state()).data.deviceEditorVisible)
      await delay(280)

      await routeTap('.workspace-primary-button', 'openDeviceEditor')
      await waitFor(async () => (await state()).data.deviceEditorVisible)
      await typeInto('#wiring-device-name', 'Unsaved fixture device', true)
      await routeTap('.workspace-device-sheet .workspace-close-button', 'requestCloseDeviceEditor')
      assert((await state()).events.modals.length > 0)
      await respondModal(false)
      assert.equal((await state()).data.deviceEditorVisible, true)
      await routeTap('.workspace-device-sheet .workspace-close-button', 'requestCloseDeviceEditor')
      await respondModal(true)
      await waitFor(async () => !(await state()).data.deviceEditorVisible)

      await routeTap('.workspace-primary-button', 'openDeviceEditor')
      await waitFor(async () => (await state()).data.deviceEditorVisible)
      const countBefore = Number((await state()).data.deviceDraft.count)
      const countRoute = await routeTap('.workspace-device-sheet .workspace-step-button[data-delta="1"]', 'onDeviceCountStep')
      let page = await state()
      assert.equal(Number(page.data.deviceDraft.count), countBefore + 1)
      const nameInput = await typeInto('#wiring-device-name', 'QA control-save device', true)
      page = await state()
      assert.equal(page.data.deviceDraft.name, 'QA control-save device')
      const countAfter = page.data.deviceDraft.count
      const expectedSavedNames = page.data.deviceNamePreview.slice()
      const saveRoute = await routeTap('.workspace-device-sheet .workspace-sheet-save', 'saveDevices')
      await waitFor(async () => !(await state()).data.deviceEditorVisible)
      page = await state()
      const storedProjects = page.storage?.['audioTool.projects.v1'] || []
      const storedProject = storedProjects.find(project => project.id === page.data.project?.id)
      const storedNames = storedProject?.wiringSchedule?.devices?.map(device => device.name) || []
      const observedSavedNames = page.data.devices.map(device => device.name).filter(name => expectedSavedNames.includes(name))
      const storedSavedNames = storedNames.filter(name => expectedSavedNames.includes(name))
      assert.deepEqual(observedSavedNames, expectedSavedNames, 'Saved device rows match the preview names generated from the typed name and count')
      assert.deepEqual(storedSavedNames, expectedSavedNames, 'Isolated project storage contains the exact saved preview names')
      assert.equal(expectedSavedNames.length, Number(countAfter), 'Preview count matches the device count input')
      const diagnostic = { case: currentCase, kind: 'device-save-expected-observed', expected: { typedName: 'QA control-save device', count: Number(countAfter), previewNames: expectedSavedNames, savedRoute: 'saveDevices' }, observed: { draftNameBeforeSave: page.data.deviceDraft?.name ?? 'editor content cleared after successful save', uiSavedNames: observedSavedNames, storageSavedNames: storedSavedNames, totalDeviceCount: page.data.devices.length, projectId: storedProject?.id || null, projectStorageWriteCount: page.events.writes.filter(write => write.key === 'audioTool.projects.v1').length }, classification: 'visible input route and saveDevices handler completed; compare event sequence and exact fixture storage values' }
      controlDiagnostics.push(diagnostic)
      return { pass: Boolean(backdropClose.entry && countRoute.entry && saveRoute.entry && page.data.deviceEditorVisible === false), methods: ['openDeviceEditor', 'stopEvent', 'preventTouchMove', 'requestCloseDeviceEditor', 'onDeviceCountStep', 'onDeviceDraftInput', 'saveDevices'], backdropTarget: leftBackdropPoint.exposedTarget, backdropCloseRoute: backdropClose.events.find(event => event.method === 'requestCloseDeviceEditor'), unsavedCancelKeptOpen: true, unsavedConfirmClosed: true, countRoute: countRoute.entry, countBefore, countAfter, nameInputRoute: nameInput.inputRoutes, inputSequence: nameInput.diagnostic, saveRoute: saveRoute.entry, expected: diagnostic.expected, observed: diagnostic.observed, classification: diagnostic.classification, isolatedDeviceSaved: true }
    })

    await record('line detail X/backdrop and editor X cancel/confirm back routes', async () => {
      await fresh('standard', 4)
      await enterLineDetails('qa-line-1')
      const sheetTap = await tap('.workspace-detail-sheet .wiring-sheet-handle')
      assert(sheetTap.events.some(event => event.method === 'stopEvent' && event.type === 'tap'))
      const detailClose = await routeTap('.workspace-detail-sheet .workspace-close-button', 'closeLineDetails')
      await waitFor(async () => !(await state()).data.detailVisible)
      await delay(280)
      await enterLineDetails('qa-line-2')
      const detailBackdropPoint = await findBackdropPoint('.workspace-detail-sheet')
      const detailBackdrop = await routeTap('.workspace-detail-mask .wiring-backdrop', 'closeLineDetails', detailBackdropPoint)
      await waitFor(async () => !(await state()).data.detailVisible)
      await delay(280)
      const linesTab = await routeTap('[data-tab="lines"]', 'onWorkspaceTab')
      const addLine = await routeTap('.workspace-primary-button', 'openNewLine')
      await waitFor(async () => (await state()).data.editorVisible)
      await routeTap('.workspace-editor-sheet .workspace-close-button', 'requestCloseEditor')
      await waitFor(async () => !(await state()).data.editorVisible)
      await delay(280)
      await routeTap('[data-tab="devices"]', 'onWorkspaceTab')
      await routeTap('.workspace-connect-button[data-id="receiver-1"]', 'connectDevice')
      await waitFor(async () => (await state()).data.editorVisible)
      await routeTap('.workspace-continuous-button', 'openContinuous')
      await waitFor(async () => (await state()).data.continuousVisible)
      const continuousBackdropPoint = await findBackdropPoint('.workspace-continuous-sheet')
      const continuousBackdrop = await routeTap('.workspace-continuous-mask .wiring-backdrop', 'closeContinuous', continuousBackdropPoint)
      await waitFor(async () => !(await state()).data.continuousVisible)
      await routeTap('.workspace-continuous-button', 'openContinuous')
      await waitFor(async () => (await state()).data.continuousVisible)
      const continuousX = await routeTap('.workspace-continuous-sheet .workspace-close-button', 'closeContinuous')
      await waitFor(async () => !(await state()).data.continuousVisible)
      await typeInto('#wiring-pair-0-from', 'UNSAVED OUT', true)
      const closeEditor = await routeTap('.workspace-editor-sheet .workspace-close-button', 'requestCloseEditor')
      assert((await state()).events.modals.length > 0)
      await respondModal(false)
      assert.equal((await state()).data.editorVisible, true)
      await routeTap('.workspace-editor-sheet .workspace-close-button', 'requestCloseEditor')
      await respondModal(true)
      await waitFor(async () => !(await state()).data.editorVisible)
      await delay(280)
      const backTap = await routeTap('.workspace-back', 'requestPageBack')
      const page = await state()
      assert(page.events.navigations.some(item => item.type === 'back'))
      return { pass: Boolean(detailClose.entry && detailBackdrop.entry && linesTab.entry && addLine.entry && continuousBackdrop.entry && continuousX.entry && closeEditor.entry && backTap.entry), methods: ['onWorkspaceTab', 'onLineTap', 'stopEvent', 'closeLineDetails', 'openNewLine', 'connectDevice', 'openContinuous', 'closeContinuous', 'onPairInput', 'requestCloseEditor', 'requestPageBack'], detailCloseRoute: detailClose.entry, detailBackdropRoute: detailBackdrop.entry, linesTabRoute: linesTab.entry, addLineRoute: addLine.entry, continuousBackdropRoute: continuousBackdrop.entry, continuousXRoute: continuousX.entry, editorCloseRoute: closeEditor.entry, headerBackRoute: backTap.entry, navigation: page.events.navigations.at(-1), cancelModalKeptEditor: true, confirmModalClosedEditor: true }
    })

    await record('report page navigation, image preview, save current/all, stop, share and close routes', async () => {
      await fresh('standard', 40)
      const shareEntry = await routeTap('.workspace-project-share', 'shareProject')
      await waitFor(async () => (await state()).data.reportPreviewVisible, 9000)
      let page = await state()
      assert(page.data.reportImages.length > 1, 'Pagination fixture must produce multiple report pages')
      const pages = page.data.reportImages.length
      await routeTap('.wiring-report-page-controls button:nth-of-type(2)', 'nextReportPage')
      assert.equal((await state()).data.reportPageIndex, 1)
      await routeTap('.wiring-report-page-controls button:nth-of-type(1)', 'previousReportPage')
      assert.equal((await state()).data.reportPageIndex, 0)
      await routeTap('.wiring-report-page-controls button:nth-of-type(2)', 'nextReportPage')
      const imageRoute = await routeTap('.wiring-report-image', 'previewReportImage')
      page = await state()
      assert(page.events.shares.some(event => event.type === 'preview'), 'previewImage mock should record the current page')
      const saveStart = page.events.shares.filter(event => event.type === 'save').length
      await routeTap('.wiring-report-actions .wiring-sheet-secondary', 'saveReportImage')
      await waitFor(async () => (await state()).events.shares.filter(event => event.type === 'save').length > saveStart)
      page = await state()
      assert(page.data.reportSavedPageIndices.includes(1), 'Current page save should mark the selected page in the isolated mock')
      const shareRoute = await routeTap('.wiring-report-actions .wiring-sheet-primary', 'shareReportImage')
      page = await state()
      assert(page.events.shares.some(event => event.type === 'share'), 'share API mock should record the current image')

      await fixtureAction('defer-photo-save', true)
      const savesBeforeAll = page.events.shares.filter(event => event.type === 'save').length
      const allRoute = await routeTap('.wiring-report-save-all-button', 'saveAllReportImages')
      await waitFor(async () => (await state()).data.reportSaveRunning && (await state()).data.reportSaveInFlight)
      const savesAfterStart = (await state()).events.shares.filter(event => event.type === 'save').length
      assert.equal(savesAfterStart, savesBeforeAll + 1, 'Deferred fixture should hold the first OS callback and prevent advancing')
      const stopRoute = await routeTap('.wiring-report-stop-button', 'stopReportSaveJob')
      const stoppedState = await state()
      assert.equal(stoppedState.data.reportSaveRunning, false)
      const completed = await fixtureAction('complete-photo-save', true)
      await delay(80)
      page = await state()
      const savesAfterStop = page.events.shares.filter(event => event.type === 'save').length
      assert.equal(completed.photoSaveResult?.completed, true)
      assert.equal(savesAfterStop, savesAfterStart, 'Late successful OS callback after Stop must not queue another save')
      const xRoute = await routeTap('.wiring-report-sheet .wiring-close-button', 'closeReportPreview')
      assert.equal((await state()).data.reportPreviewVisible, false)
      await delay(280)
      await routeTap('.workspace-project-share', 'shareProject')
      await waitFor(async () => (await state()).data.reportPreviewVisible, 9000)
      const reportBackdropPoint = await findBackdropPoint('.wiring-report-sheet')
      const backdropClose = await routeTap('.wiring-report-mask .wiring-backdrop', 'closeReportPreview', reportBackdropPoint)
      await waitFor(async () => !(await state()).data.reportPreviewVisible)
      const finalPage = await state()
      return { pass: Boolean(shareEntry.entry && imageRoute.entry && shareRoute.entry && allRoute.entry && stopRoute.entry && xRoute.entry && backdropClose.entry), reportPages: pages, routeMethods: ['shareProject', 'nextReportPage', 'previousReportPage', 'previewReportImage', 'saveReportImage', 'shareReportImage', 'saveAllReportImages', 'stopReportSaveJob', 'closeReportPreview'], saveCurrentRecorded: true, saveAllHeldAtOneRequest: savesAfterStart === savesBeforeAll + 1, stopLateCallbackRequestCountUnchanged: savesAfterStop === savesAfterStart, lateCallbackFixtureResult: completed.photoSaveResult, closeXRoute: xRoute.entry, closeBackdropRoute: backdropClose.entry, exportRequests: finalPage.events.exports.length, isolatedMockOnly: true }
    })

    await record('workspace background and scroll close an open swipe row through WXML routes', async () => {
      await fresh('long', 40)
      const deviceBox = await browser.pointFor('.workspace-device-swipe-row')
      const rowBox = await browser.pointFor('.workspace-device-swipe-row')
      const rowGutterPoint = { ...rowBox, x: rowBox.x - rowBox.width / 2 + 25 }
      const swipe = await touchSwipe('.workspace-device-swipe-row', -115, 0, 260, 5, rowGutterPoint)
      await delay(180)
      let page = await state()
      assert(page.data.devices.some(device => device.swipeOpen), 'Device row opens from swipe')
      const cardTap = await routeTap('.workspace-device-card', 'onWorkspaceRowTap')
      await waitFor(async () => !(await state()).data.devices.some(device => device.swipeOpen))
      await delay(80)
      // Tap a blank portion of the list viewport so the scroll-view background handler is the actual target.
      const blank = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-scroll');const r=n.getBoundingClientRect();return{x:r.right-5,y:r.bottom-8,width:r.width,height:r.height}})()`)
      const bgStart = await traceLength()
      await browser.tap('.workspace-scroll', { identifier: 0, point: { ...blank, selector: 'scroll-view', disabled: false, visibility: 'visible', display: 'block' } })
      await delay(30)
      const backgroundEvents = (await trace()).slice(bgStart)
      ownRoutes.push(...backgroundEvents.map(event => ({ ...event, case: currentCase })))
      assert(backgroundEvents.some(event => event.method === 'onWorkspaceBackgroundTap' && event.type === 'tap'))

      await touchSwipe('.workspace-device-swipe-row', -115, 0, 260, 5, rowGutterPoint)
      await delay(180)
      page = await state()
      assert(page.data.devices.some(device => device.swipeOpen))
      const scrollSwipe = await touchSwipe('.workspace-scroll', 0, -280, 260, 6)
      await delay(80)
      page = await state()
      const allEvents = [...swipe.events, ...cardTap.events, ...backgroundEvents, ...scrollSwipe.events]
      return { pass: Boolean(cardTap.entry && !page.data.devices.some(device => device.swipeOpen)), deviceBox, cardTapRoute: cardTap.entry, backgroundRoutes: backgroundEvents.filter(event => event.method === 'onWorkspaceBackgroundTap'), scrollRoutes: scrollSwipe.events.filter(event => event.method === 'onWorkspaceListScroll'), swipeClosedAfterCardBackgroundAndScroll: true, methods: allEvents.map(event => `${event.type}:${event.method}`) }
    })

    await record('child scroll zones and swipe Delete/row touchcancel route through WXML without accidental selection or deletion', async () => {
      await fresh('long', 8)
      const tabRoute = await routeTap('[data-tab="lines"]', 'onWorkspaceTab')
      await waitFor(async () => (await state()).data.workspaceTab === 'lines')
      let page = await state()
      if (!page.data.groups.some(group => !group.collapsed && group.lines.length)) {
        const group = page.data.groups[0]
        await routeTap(`.workspace-group-header[data-key="${group.key}"]`, 'toggleGroup')
        await delay(180)
      }
      const line = (await state()).data.groups.flatMap(group => group.lines)[0]
      assert(line, 'Fixture line is available in the visible group')
      const rowSelector = `.workspace-line-swipe-row[data-swipe-id="${line.id}"]`
      const rowBox = await browser.pointFor(rowSelector)
      const circlePoint = { ...rowBox, x: rowBox.x - rowBox.width / 2 + 30 }

      const childEnd = await touchSequence('.workspace-port-cell', -18, 0, 'touchEnd')
      const childAfterEnd = await state()
      assert(childEnd.events.some(event => event.method === 'onSwipeScrollTouchStart' && event.type === 'touchstart'))
      assert(childEnd.events.some(event => event.method === 'onSwipeScrollTouchMove' && event.type === 'touchmove'))
      assert(childEnd.events.some(event => event.method === 'onSwipeScrollTouchEnd' && event.type === 'touchend'))
      assert.equal(childAfterEnd.data.detailVisible, false)
      assert(!childAfterEnd.data.groups.flatMap(group => group.lines).some(item => item.swipeOpen), 'Horizontal port movement must not reveal delete')
      const childCancel = await touchSequence('.workspace-port-cell', -16, 0, 'touchCancel')
      assert(childCancel.events.some(event => event.method === 'onSwipeScrollTouchCancel' && event.type === 'touchcancel'))

      const rowCancel = await touchSequence(rowSelector, -20, 0, 'touchCancel', circlePoint)
      assert(rowCancel.events.some(event => event.method === 'onSwipeTouchStart' && event.type === 'touchstart'))
      assert(rowCancel.events.some(event => event.method === 'onSwipeTouchCancel' && event.type === 'touchcancel'))
      const rowSwipe = await browser.swipe(rowSelector, -150, 0, 280, 6, { identifier: 0, point: circlePoint })
      await delay(230)
      page = await state()
      const opened = page.data.groups.flatMap(group => group.lines).find(item => item.id === line.id)
      assert(opened?.swipeOpen, 'Explicit horizontal swipe reveals the chosen line action')
      const actionSelector = `${rowSelector} .workspace-swipe-delete`
      const actionCancel = await touchSequence(actionSelector, -18, 0, 'touchCancel')
      assert(actionCancel.events.some(event => event.method === 'onSwipeActionTouchStart' && event.type === 'touchstart'))
      assert(actionCancel.events.some(event => event.method === 'onSwipeActionTouchMove' && event.type === 'touchmove'))
      assert(actionCancel.events.some(event => event.method === 'onSwipeActionTouchCancel' && event.type === 'touchcancel'))
      const afterCancel = await state()
      assert(afterCancel.schedule.lines.some(item => item.id === line.id))
      assert.equal(afterCancel.events.modals.length, 0, 'Canceled delete button touch does not open a confirmation')
      const scrollMetrics = await browser.evaluate(`(()=>{const n=document.querySelector('.workspace-port-cell');return n?{scrollWidth:n.scrollWidth,clientWidth:n.clientWidth}:null})()`)
      const portScroll = await touchSwipe('.workspace-port-cell', -90, 0, 240, 5)
      const portScrollRoutes = portScroll.events.filter(event => event.method === 'onPortCellScroll')
      const activeGroup = (await state()).data.groups.find(group => group.lines.some(item => item.id === line.id))
      assert(activeGroup, 'The selected line remains in a rendered group')
      const activeGroupKey = JSON.stringify(activeGroup.key)
      const headerProbe = await inspectGroupHeader(activeGroup.key)
      const headerProbeDiagnostic = { case: currentCase, kind: 'group-header-hit-test', expected: { headerVisible: true, nonScrollHeaderHit: true, eligibleFor: ['onLineTouchStart', 'onLineTouchMove', 'onLineTouchCancel'] }, observed: headerProbe, classification: headerProbe.candidatePoints?.length ? 'measured visible non-scroll header target found from actual DOM rects and elementFromPoint' : 'no non-scroll point proven; do not claim group header touch route' }
      controlDiagnostics.push(headerProbeDiagnostic)
      const candidate = headerProbe.candidatePoints?.[0]
      const headerPoint = candidate ? { x: candidate.x, y: candidate.y, width: 1, height: 1, selector: candidate.selector, disabled: false, visibility: 'visible', display: 'block', exposedTarget: candidate.actualHit.tagName, source: candidate.source } : null
      const groupNamePoint = await browser.evaluate(`(()=>{const h=[...document.querySelectorAll('.workspace-group-header')].find(item=>item.dataset.key===${activeGroupKey});const n=h?.querySelector('.workspace-group-name');if(!n)return null;const r=n.getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+r.height/2};const hit=window.__qaInspectHit(n,point);return{...point,width:r.width,height:r.height,selector:'scroll-view',disabled:false,visibility:getComputedStyle(n).visibility,display:getComputedStyle(n).display,hit:hit.actualHit,hitPath:(hit.actualHitPath||[]).map(item=>({tagName:item.tagName,className:item.className,bindings:item.bindings}))}})()`)
      assert(groupNamePoint, 'Visible group-name scroll target is available')
      assert(groupNamePoint.width > 0 && groupNamePoint.height > 0 && groupNamePoint.visibility === 'visible' && groupNamePoint.display !== 'none' && groupNamePoint.y >= 0 && groupNamePoint.y < 844 && groupNamePoint.hitPath.some(item => item.tagName === 'scroll-view' && item.className.split(' ').includes('workspace-group-name')), `Group-name scroll target must be visibly hit-testable; measured=${JSON.stringify(groupNamePoint)}`)
      await browser.evaluate('window.__qaClearRawTouchTrace ? window.__qaClearRawTouchTrace() : null')
      browser.clearTouchDispatchTrace?.()
      const groupNameMove = await touchSequence('.workspace-group-name', -18, 0, 'touchCancel', groupNamePoint)
      const groupNameRawTouch = await browser.evaluate('window.__qaRawTouchTrace ? window.__qaRawTouchTrace.slice() : []')
      const groupNameDispatch = browser.touchDispatchTrace?.() || []
      const afterGroupNameMove = await state()
      const groupScrollMethods = groupNameMove.events.map(event => `${event.type}:${event.method}`)
      const groupAfterScrollMove = afterGroupNameMove.data.groups.find(group => group.key === activeGroup.key)
      const rowSwipeOpenBeforeGroupMove = activeGroup.lines.filter(item => item.swipeOpen).map(item => item.id)
      const rowSwipeOpenAfterGroupMove = groupAfterScrollMove.lines.filter(item => item.swipeOpen).map(item => item.id)
      assert(groupNameMove.events.some(event => event.method === 'onSwipeScrollTouchStart' && event.type === 'touchstart'), 'Actual group-name scroll child owns touch start')
      assert(groupNameMove.events.some(event => event.method === 'onSwipeScrollTouchMove' && event.type === 'touchmove'), 'A moved group-name gesture reaches the child move handler')
      assert(groupNameMove.events.some(event => event.method === 'onSwipeScrollTouchCancel' && event.type === 'touchcancel'), 'Cancel clears the child scroll gesture')
      assert(!groupNameMove.events.some(event => event.method === 'onLineTouchStart'), 'Child catchtouchstart prevents header gesture ownership')
      assert.equal(groupAfterScrollMove.collapsed, activeGroup.collapsed, 'Moving in the group-name scroll child does not toggle the group')
      assert.deepEqual(rowSwipeOpenAfterGroupMove, rowSwipeOpenBeforeGroupMove, 'Child movement does not alter the currently open swipe row')
      controlDiagnostics.push({ case: currentCase, kind: 'group-name-scroll-child', expected: { childStartMoveCancel: true, parentStartSuppressed: true, groupCollapsed: activeGroup.collapsed, rowSwipeOpen: rowSwipeOpenBeforeGroupMove }, observed: { routeMethods: groupScrollMethods, rawDomTouch: groupNameRawTouch, cdpDispatch: groupNameDispatch, parentMoveCancelMayBubble: groupScrollMethods.filter(method => method.includes('onLineTouch')), groupCollapsedAfter: groupAfterScrollMove.collapsed, rowSwipeOpenAfter: rowSwipeOpenAfterGroupMove, point: groupNamePoint }, classification: 'catchtouchstart prevents the parent start and establishes no parent gesture; separately bound parent move/cancel may bubble but must leave group and row state unchanged' })

      assert(headerPoint, `Visible non-scroll group header point is available; measured=${JSON.stringify(headerProbe)}`)
      // Let the child-movement tap-suppression window expire before checking a
      // fresh gesture on the separate group-header route.
      await delay(380)
      await browser.evaluate('window.__qaClearRawTouchTrace ? window.__qaClearRawTouchTrace() : null')
      browser.clearTouchDispatchTrace?.()
      const headerCancel = await touchSequence('.workspace-group-header', 0, -18, 'touchCancel', headerPoint)
      const headerRawTouch = await browser.evaluate('window.__qaRawTouchTrace ? window.__qaRawTouchTrace.slice() : []')
      const headerDispatch = browser.touchDispatchTrace?.() || []
      assert(headerCancel.events.some(event => event.method === 'onLineTouchStart' && event.type === 'touchstart'))
      assert(headerCancel.events.some(event => event.method === 'onLineTouchMove' && event.type === 'touchmove'))
      assert(headerCancel.events.some(event => event.method === 'onLineTouchCancel' && event.type === 'touchcancel'))
      const afterHeaderCancel = await state()
      const groupAfterCancel = afterHeaderCancel.data.groups.find(group => group.key === activeGroup.key)
      assert.equal(groupAfterCancel.collapsed, activeGroup.collapsed, 'Canceled group-header movement must not toggle the group')
      controlDiagnostics.push({ case: currentCase, kind: 'group-header-touchcancel', expected: { route: ['onLineTouchStart','onLineTouchMove','onLineTouchCancel'], groupCollapsed: activeGroup.collapsed }, observed: { routeMethods: headerCancel.events.map(event => `${event.type}:${event.method}`), rawDomTouch: headerRawTouch, cdpDispatch: headerDispatch, headerPoint, headerProbe: headerProbeDiagnostic.observed, groupCollapsedAfter: groupAfterCancel.collapsed }, classification: 'CDP touchcancel targeted a measured non-scroll visible header child; group remains unchanged after cancel' })
      assert(groupNamePoint, 'Visible group-name scroll target remains present after cancel')
      await browser.evaluate('window.__qaClearRawTouchTrace ? window.__qaClearRawTouchTrace() : null')
      browser.clearTouchDispatchTrace?.()
      const groupNameTap = await routeTap('.workspace-group-name', 'toggleGroup', groupNamePoint)
      const groupTapRawTouch = await browser.evaluate('window.__qaRawTouchTrace ? window.__qaRawTouchTrace.slice() : []')
      const groupTapDispatch = browser.touchDispatchTrace?.() || []
      const afterGroupNameTap = await state()
      const toggledGroup = afterGroupNameTap.data.groups.find(group => group.key === activeGroup.key)
      assert.equal(toggledGroup.collapsed, !activeGroup.collapsed, 'A stationary group-name tap still toggles the group')
      controlDiagnostics.push({ case: currentCase, kind: 'post-cancel-stationary-group-tap', expected: { route: 'toggleGroup', collapsed: !activeGroup.collapsed }, observed: { route: groupNameTap.events.map(event => `${event.type}:${event.method}`), rawDomTouch: groupTapRawTouch, cdpDispatch: groupTapDispatch, collapsedAfter: toggledGroup.collapsed, point: groupNamePoint }, classification: 'a fresh stationary tap after touchcancel still reaches the visible WXML group toggle' })
      const headerCenter = headerProbeDiagnostic.observed?.headerCenter
      historicalResidualFindings.push({
        id: 'C2',
        previousEvidence: path.relative(here, previousControlEvidencePath).replace(/\\/g, '/'),
        previousExpected: { requirement: 'Find a visible non-scroll header point and route touchstart, touchmove, and touchcancel without toggling the group.' },
        previousObserved: { assertion: 'Visible group header point is available', result: 'No point passed the old probe.' },
        currentMeasurement: {
          headerRect: headerProbeDiagnostic.observed?.header?.rect,
          oldCenterPoint: headerCenter?.point,
          oldCenterHitClass: headerCenter?.actualHit?.className,
          oldCenterInsideGroupNameScroll: headerCenter?.insideGroupNameScroll,
          oldCenterHitPath: (headerCenter?.hitPath || []).map(node => ({ tagName: node.tagName, className: node.className, methods: Object.values(node.bindings || {}).map(binding => binding.method) })),
          usableNonScrollTargets: (headerProbeDiagnostic.observed?.candidatePoints || []).filter(point => ['group-arrow', 'group-count', 'group-chevron'].includes(point.source)).map(point => ({ source: point.source, x: point.x, y: point.y, hitClass: point.actualHit?.className })),
          actualCancelRoute: headerCancel.events.map(event => `${event.type}:${event.method}`),
          groupUnchanged: groupAfterCancel.collapsed === activeGroup.collapsed,
          laterStationaryGroupTapToggled: toggledGroup.collapsed !== activeGroup.collapsed,
        },
        causalClassification: 'The old failure was in point discovery: the header center landed inside the nested horizontal group-name scroll-view. Current hit testing finds arrow/count/chevron targets outside that child scroll zone and the actual cancel route succeeds; this is a harness targeting/probe issue, not a missing WXML cancel route.',
      })
      return { pass: Boolean(tabRoute.entry && actionCancel.events.length && afterCancel.schedule.lines.some(item => item.id === line.id) && groupNameTap.entry), lineId: line.id, routeGroups: {
        childZone: childEnd.events.map(event => `${event.type}:${event.method}`),
        childCancel: childCancel.events.map(event => `${event.type}:${event.method}`),
        rowCancel: rowCancel.events.map(event => `${event.type}:${event.method}`),
        rowSwipe: rowSwipe.result?.trace?.map(event => `${event.type}:${event.method}`) || [],
        deleteActionCancel: actionCancel.events.map(event => `${event.type}:${event.method}`),
        portScroll: portScrollRoutes.map(event => `${event.type}:${event.method}`),
        groupNameScroll: groupScrollMethods,
        groupHeaderHitTest: headerProbe,
        groupHeaderCancel: headerCancel.events.map(event => `${event.type}:${event.method}`),
        groupNameTap: groupNameTap.events.map(event => `${event.type}:${event.method}`),
      }, scrollMetrics, headerHitPoint: headerPoint, groupNameScrollPoint: groupNamePoint, groupNameMoveRawTouch: groupNameRawTouch, headerCancelRawTouch: headerRawTouch, postCancelTapRawTouch: groupTapRawTouch, lineRemains: afterCancel.schedule.lines.some(item => item.id === line.id), modalCount: afterCancel.events.modals.length, noDetailAfterChildMovement: !childAfterEnd.data.detailVisible, groupUnchangedDuringScrollAndCancel: groupAfterScrollMove.collapsed === activeGroup.collapsed && groupAfterCancel.collapsed === activeGroup.collapsed, groupNameTapToggled: toggledGroup.collapsed !== activeGroup.collapsed, fixtureStorageOnly: true }
    })

    const sourceHandlers = sourceBindings()
    const allOwnRoutes = [...ownRoutes, ...recordRoutes]
    const routeKeys = new Set()
    const tappedRoutes = allOwnRoutes.filter(event => {
      const key = JSON.stringify([event.case, event.method, event.type, event.nativeInput, event.timeStamp, event.target, event.currentTarget])
      if (routeKeys.has(key)) return false
      routeKeys.add(key)
      return true
    }).map(event => ({ method: event.method, type: event.type, nativeInput: event.nativeInput || '', source: 'control-native-acceptance', case: event.case, target: event.target, currentTarget: event.currentTarget }))
    const tapRoutes = collectEvidenceRoutes(tapEvidencePath, 'native-touch-acceptance')
    const visualRoutes = collectEvidenceRoutes(visualEvidencePath, 'visual-acceptance')
    const unionRoutes = [...tappedRoutes, ...tapRoutes, ...visualRoutes]
    const routedMethods = new Set(unionRoutes.map(route => route.method))
    const intentionalGates = {
      onFormKeyboardHeightChange: 'The handler route was emitted through the WXML keyboardheightchange fixture; browser tooling cannot produce a physical OS keyboard-height event.',
      onProjectWheelChange: 'A CDP wheel touch is recorded, and selection completion is supplied as the isolated picker change event; this does not claim native picker gesture proof.',
      preventTouchMove: 'The backdrop received a CDP touchmove, and the touch handler route was recorded; the Chromium adapter does not model WeChat gesture arbitration.',
    }
    const coverage = sourceHandlers.map(binding => ({
      ...binding,
      status: routedMethods.has(binding.method) ? 'route-observed' : (intentionalGates[binding.method] ? 'explicit-fixture-boundary' : 'uncovered'),
      evidence: unionRoutes.filter(route => route.method === binding.method).map(route => ({ source: route.source || 'control-native-acceptance', type: route.type, nativeInput: route.nativeInput, case: route.case || undefined, target: route.target || undefined, currentTarget: route.currentTarget || undefined })),
      gateReason: routedMethods.has(binding.method) ? undefined : intentionalGates[binding.method],
    }))
    const uncovered = coverage.filter(item => item.status === 'uncovered')
    const methodsByEvidence = new Map()
    for (const entry of coverage) {
      const evidenceSources = new Set((entry.evidence || []).map(item => item.source))
      methodsByEvidence.set(entry.method, evidenceSources)
    }
    const currentRunMethods = [...methodsByEvidence.entries()].filter(([, sources]) => sources.has('control-native-acceptance')).map(([method]) => method).sort()
    const siblingOnlyMethods = [...methodsByEvidence.entries()].filter(([, sources]) => !sources.has('control-native-acceptance')).map(([method]) => method).sort()
    const sourceManifestNow = sourceManifest()
    const summary = {
      generatedAt: new Date().toISOString(),
      scope: 'Complementary visible-control audit using CDP touch taps/swipes routed through the loaded WXML event binder and isolated in-memory wx fixtures. This is not WeChat runtime, native picker, phone, production data, or external-account acceptance.',
      sourceManifestSha256: Object.fromEntries(Object.entries(sourceManifestNow).map(([name, value]) => [name, value.sha256])),
      fixture: { source: 'tests/project-wiring-redesign-2026-10-16/runtime.cjs', persistence: 'in-memory wx mock; no real user or production records', reportImages: 'placeholder canvas export paths; share/photo APIs are fixture mocks' },
      adapterBoundary: {
        touch: 'CDP synthesized touch inputs; each tap route records target/currentTarget, actual WXML event method, and nativeInput marker.',
        pickerWheel: 'CDP wheel swipe followed by explicit picker selection-completion WXML change fixture; not a real WeChat picker gesture.',
        keyboardHeight: 'WXML keyboardheightchange emitted as a bounded OS-event fixture; not a physical keyboard measurement.',
        photoSave: 'saveImageToPhotosAlbum default callback behavior remains synchronous. One run deferred the callback, stopped via CDP tap, then delivered exactly one fixture callback to verify no next save was requested.',
      },
      checkCounts: { total: checks.length, passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length },
      checks,
      visibleWxmlBindingCoverage: { files: ['pages/project-wiring/index.wxml', 'pages/project-wiring/workspace.wxml', 'pages/project-wiring/workspace-header.wxml'], totalOccurrences: sourceHandlers.length, uniqueMethods: [...new Set(sourceHandlers.map(binding => binding.method))].length, coveredOccurrences: coverage.filter(item => item.status !== 'uncovered').length, uncoveredMethods: [...new Set(uncovered.map(item => item.method))], methodEvidenceBreakdown: { currentRunUniqueMethods: currentRunMethods.length, currentRunMethods, siblingOnlyMethods, note: 'Coverage is matched by unique method name across WXML binding occurrences. This does not mean each of the 173 occurrences was independently tapped.' }, handlers: coverage },
      evidenceInputs: { nativeTouch: fs.existsSync(tapEvidencePath) ? path.relative(here, tapEvidencePath).replace(/\\/g, '/') : null, visual: fs.existsSync(visualEvidencePath) ? path.relative(here, visualEvidencePath).replace(/\\/g, '/') : null, previousControlFailureReport: fs.existsSync(previousControlEvidencePath) ? path.relative(here, previousControlEvidencePath).replace(/\\/g, '/') : null },
      controlsDiagnostics: controlDiagnostics,
      historicalResidualFindings,
      testAdapterSha256: {
        browserJs: hash(fs.readFileSync(path.join(here, 'browser.js'))),
        cdpCjs: hash(fs.readFileSync(path.join(here, 'cdp.cjs'))),
      },
      scenes: recordedScenes,
      limitations: [
        'Chromium CDP synthesizes touchscreen events; it does not prove WeChat device behavior.',
        'Picker selection, keyboard height, modal choice, storage errors, and photo-save completion are explicit fixture events/responses.',
        'Images and stored records are test fixtures held in isolated memory; no production project or account data was opened.',
      ],
      generatedBy: { script: 'tests/project-wiring-redesign-2026-10-16/control-native-acceptance-run.cjs', scriptSha256: hash(fs.readFileSync(path.join(here, 'control-native-acceptance-run.cjs'))) },
    }
    const outputPath = path.join(evidenceRoot, 'control-native-acceptance.json')
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2))
    console.log(JSON.stringify({ outputPath, checks: summary.checkCounts, wxmlHandlerMethods: summary.visibleWxmlBindingCoverage.uniqueMethods, uncoveredMethods: summary.visibleWxmlBindingCoverage.uncoveredMethods, screenshotCount: recordedScenes.length }, null, 2))
    if (checks.some(check => !check.passed) || uncovered.length) process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

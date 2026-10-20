const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function freePort() { const server = net.createServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function launch() {
  const port = await freePort()
  const server = spawn(process.execPath, [path.join(__dirname, 'browser-server.cjs')], { windowsHide: true, env: { ...process.env, WIRING_QA_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''; server.stdout.on('data', data => { logs += data }); server.stderr.on('data', data => { logs += data })
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) { try { ready = (await fetch(`http://127.0.0.1:${port}/__meta`)).ok } catch {} if (ready) break; await delay(100) }
  if (!ready) { server.kill(); throw Error('Loopback server startup failed: ' + logs) }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tunebuddy-wiring-redesign-'))
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  const processEvidence = path.join(path.resolve(process.env.WIRING_QA_EVIDENCE || path.join(__dirname, 'evidence')), 'processes'); fs.mkdirSync(processEvidence, { recursive: true }); fs.writeFileSync(path.join(processEvidence, process.pid + '.json'), JSON.stringify({ runnerPid: process.pid, serverPid: server.pid, chromePid: chrome.pid, profile, port }))
  const endpoint = await new Promise((resolve, reject) => { let log = ''; const timer = setTimeout(() => reject(Error('Chrome startup timeout: ' + log)), 15000); chrome.stderr.on('data', data => { log += data; fs.writeFileSync(path.join(processEvidence, process.pid + '-chrome.stderr.txt'), log); const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } }); chrome.once('error', reject) })
  const tab = await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' }).then(result => result.json())
  const socket = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0; const pending = new Map(), touchDispatchTrace = []
  socket.addEventListener('message', event => { const result = JSON.parse(String(event.data)); if (process.env.WIRING_QA_DEBUG) console.log('CDP receive', JSON.stringify(result).slice(0, 400)); const item = pending.get(result.id); if (!item) return; pending.delete(result.id); clearTimeout(item.timer); if (result.error) item.reject(Error(result.error.message)); else item.resolve(result.result || {}) })
  socket.addEventListener('close', event => { console.error('CDP closed', event.code, event.reason); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('CDP socket closed')) } pending.clear() })
  socket.addEventListener('error', event => console.error('CDP socket error', event.message, event.error?.stack))
  function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)) }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })) }) }
  try { await send('Browser.getVersion'); await send('Page.enable'); await send('Runtime.enable') } catch (error) { socket.close(); chrome.kill(); server.kill(); throw error }
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
  async function viewport(width, height = 844, theme = 'light', reducedMotion = 'reduce') { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height }); await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: reducedMotion }] }) }
  async function navigate(relative) { await send('Page.navigate', { url: `http://127.0.0.1:${port}/${relative}` }); for (let attempt = 0; attempt < 150; attempt++) { const state = await evaluate('({ready:document.documentElement.dataset.ready,error:document.documentElement.dataset.error})'); if (state?.error) throw Error(state.error); if (state?.ready === 'true') return; await delay(100) } throw Error('Production browser bridge not ready') }
  async function screenshot(filename) { fs.mkdirSync(path.dirname(filename), { recursive: true }); const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }); fs.writeFileSync(filename, Buffer.from(result.data, 'base64')); return filename }
  async function touchAt(type, x, y, identifier = 0) {
    const touchPoints = type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: Math.round(x), y: Math.round(y), id: identifier, radiusX: 1, radiusY: 1, force: 0.8 }]
    const entry = { type, x: Math.round(x), y: Math.round(y), identifier, touchPoints, sentAt: new Date().toISOString() }
    try { entry.ack = await send('Input.dispatchTouchEvent', { type, touchPoints }) }
    catch (error) { entry.error = error.message; touchDispatchTrace.push(entry); throw error }
    touchDispatchTrace.push(entry)
    return entry.ack
  }
  function geometryExpression(selector, preferredPoint) {
    const encodedSelector = JSON.stringify(selector), encodedPoint = JSON.stringify(preferredPoint || null)
    return `(()=>{
      const n=document.querySelector(${encodedSelector}), preferred=${encodedPoint};
      if(!n)return{missing:true,selector:${encodedSelector}};
      const round=v=>Math.round(v*100)/100;
      const box=r=>({left:round(r.left),top:round(r.top),right:round(r.right),bottom:round(r.bottom),width:round(r.width??(r.right-r.left)),height:round(r.height??(r.bottom-r.top))});
      const r=n.getBoundingClientRect(), s=getComputedStyle(n), viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
      let visible={...viewport}; const ancestors=[];
      for(let a=n.parentElement;a;a=a.parentElement){
        const as=getComputedStyle(a), ar=a.getBoundingClientRect(), clipX=/^(hidden|clip|auto|scroll)$/.test(as.overflowX), clipY=/^(hidden|clip|auto|scroll)$/.test(as.overflowY);
        const before={...visible};
        if(clipX){visible.left=Math.max(visible.left,ar.left);visible.right=Math.min(visible.right,ar.right)}
        if(clipY){visible.top=Math.max(visible.top,ar.top);visible.bottom=Math.min(visible.bottom,ar.bottom)}
        ancestors.push({tag:a.tagName.toLowerCase(),id:a.id||null,className:typeof a.className==='string'?a.className:null,rect:box(ar),overflowX:as.overflowX,overflowY:as.overflowY,clipX,clipY,scrollLeft:round(a.scrollLeft||0),scrollTop:round(a.scrollTop||0),visibleBefore:box(before),visibleAfter:box(visible)});
      }
      visible={left:Math.max(visible.left,r.left),top:Math.max(visible.top,r.top),right:Math.min(visible.right,r.right),bottom:Math.min(visible.bottom,r.bottom)};
      visible.width=Math.max(0,visible.right-visible.left); visible.height=Math.max(0,visible.bottom-visible.top);
      const validBox=visible.width>1&&visible.height>1;
      const fractions=preferred?[[null,null]]:[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.15,.5],[.85,.5],[.5,.15],[.5,.85]];
      const candidatePoints=preferred?[[preferred.x,preferred.y]]:fractions.map(([x,y])=>[visible.left+visible.width*x,visible.top+visible.height*y]);
      const candidates=candidatePoints.map(([x,y])=>{
        const inVisible=validBox&&x>=visible.left&&x<=visible.right&&y>=visible.top&&y<=visible.bottom&&x>=0&&x<=innerWidth&&y>=0&&y<=innerHeight;
        const hit=inVisible?document.elementFromPoint(x,y):null;
        const owned=Boolean(hit&&(hit===n||n.contains(hit)));
        const path=[]; for(let e=hit;e&&path.length<7;e=e.parentElement)path.push({tag:e.tagName.toLowerCase(),id:e.id||null,className:typeof e.className==='string'?e.className:null});
        return{x:round(x),y:round(y),inVisible,hitOwnedByTarget:owned,hit:path[0]||null,hitPath:path};
      });
      const chosen=candidates.find(c=>c.inVisible&&c.hitOwnedByTarget)||null;
      let opacity=1,pointerEvents='auto'; for(let e=n;e&&e.nodeType===1;e=e.parentElement){const es=getComputedStyle(e);opacity*=Number(es.opacity||1);if(es.pointerEvents==='none')pointerEvents='none'}
      return{missing:false,selector:${encodedSelector},tag:n.tagName.toLowerCase(),id:n.id||null,className:typeof n.className==='string'?n.className:null,disabled:n.disabled===true,display:s.display,visibility:s.visibility,opacity:round(opacity),pointerEvents,rect:box(r),viewport:box({left:0,top:0,right:innerWidth,bottom:innerHeight,width:innerWidth,height:innerHeight}),visibleRect:box(visible),visibleFraction:round(r.width>0&&r.height>0?visible.width*visible.height/(r.width*r.height):0),scrollLeft:round(n.scrollLeft||0),scrollTop:round(n.scrollTop||0),ancestors,candidates,chosen:chosen?{x:chosen.x,y:chosen.y,hit:chosen.hit,hitPath:chosen.hitPath}:null,computedTouchAction:s.touchAction};
    })()`
  }
  async function inspectTarget(selector, point) { return evaluate(geometryExpression(selector, point)) }
  const stableGeometry = (a, b) => {
    if (!a || !b || a.missing || b.missing) return false
    const fields = ['left','top','right','bottom','width','height']
    return fields.every(field => Math.abs((a.rect?.[field] ?? NaN) - (b.rect?.[field] ?? NaN)) <= 0.5) &&
      fields.every(field => Math.abs((a.visibleRect?.[field] ?? NaN) - (b.visibleRect?.[field] ?? NaN)) <= 0.5) &&
      (a.chosen?.x ?? null) === (b.chosen?.x ?? null) && (a.chosen?.y ?? null) === (b.chosen?.y ?? null)
  }
  async function pointFor(selector, options = {}) {
    const timeoutMs = options.timeoutMs ?? 1300, sampleMs = options.sampleMs ?? 45
    const started = Date.now(); let previous = null, stableSamples = 0, latest = null
    while (Date.now() - started <= timeoutMs) {
      latest = await inspectTarget(selector)
      if (latest.missing) throw Error('Touch target not found: ' + selector)
      const eligible = !latest.disabled && latest.display !== 'none' && latest.visibility !== 'hidden' && latest.opacity > 0.01 && latest.pointerEvents !== 'none' && Boolean(latest.chosen)
      stableSamples = stableGeometry(previous, latest) ? stableSamples + 1 : 0
      if (eligible && stableSamples >= 1) {
        return { selector: latest.tag, x: latest.chosen.x, y: latest.chosen.y, width: latest.rect.width, height: latest.rect.height, rect: latest.rect, visibleRect: latest.visibleRect, hit: latest.chosen.hit, stableSamples: stableSamples + 1 }
      }
      if (stableSamples >= 2 && !eligible) {
        throw Error('Touch target is clipped, covered, disabled, or hidden: ' + JSON.stringify(latest))
      }
      previous = latest
      await delay(sampleMs)
    }
    throw Error('Touch target did not become geometrically stable and hit-testable: ' + JSON.stringify({ selector, waitedMs: Date.now() - started, latest }))
  }
  async function assertPoint(selector, point) {
    const geometry = await inspectTarget(selector, point)
    if (geometry.missing) throw Error('Touch target not found: ' + selector)
    if (geometry.disabled || geometry.display === 'none' || geometry.visibility === 'hidden' || geometry.opacity <= 0.01 || geometry.pointerEvents === 'none' || !geometry.chosen) {
      throw Error('Explicit touch point is clipped or does not hit the requested target: ' + JSON.stringify({ selector, point, geometry }))
    }
    return { ...point, width: geometry.rect.width, height: geometry.rect.height, rect: geometry.rect, visibleRect: geometry.visibleRect, hit: geometry.chosen.hit }
  }
  async function tap(selector, options = {}) {
    const point = options.point ? await assertPoint(selector, options.point) : await pointFor(selector), id = options.identifier ?? 0
    const before = await evaluate('window.__qaEventTrace?.length || 0')
    await touchAt('touchStart', point.x, point.y, id); await delay(options.downMs ?? 70)
    await touchAt('touchEnd', point.x, point.y, id); await delay(options.clickWaitMs ?? 80)
    const result = await evaluate('window.__qaFlushEvents ? window.__qaFlushEvents() : null')
    return { point, identifier: id, traceStart: before, result }
  }
  async function swipe(selector, dx, dy = 0, durationMs = 360, samples = 6, options = {}) {
    const point = options.point ? await assertPoint(selector, options.point) : await pointFor(selector), id = options.identifier ?? 0
    const count = Math.max(1, Math.floor(samples)), interval = durationMs / count, observations = []
    await touchAt('touchStart', point.x, point.y, id); await delay(options.downMs ?? 30)
    for (let index = 1; index <= count; index++) {
      const sample = { index, x: point.x + dx * index / count, y: point.y + dy * index / count }
      await touchAt('touchMove', sample.x, sample.y, id); await delay(interval)
      const events = await evaluate('window.__qaFlushEvents ? window.__qaFlushEvents() : null')
      let observation = null
      if (options.observeExpression) observation = await evaluate(options.observeExpression)
      observations.push({ ...sample, observation, eventCount: events?.trace?.length || 0 })
      options.onSample?.(observations.at(-1))
    }
    await touchAt('touchEnd', point.x + dx, point.y + dy, id); await delay(options.endWaitMs ?? 80)
    const result = await evaluate('window.__qaFlushEvents ? window.__qaFlushEvents() : null')
    return { start: point, end: { x: point.x + dx, y: point.y + dy }, identifier: id, durationMs, observations, result }
  }
  async function close() { socket.close(); chrome.kill(); server.kill(); await delay(300); try { const resolved = path.resolve(profile); if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true }) } catch {} }
  return { send, evaluate, viewport, navigate, screenshot, close, port, pointFor, inspectTarget, assertPoint, tap, swipe, touchAt,
    touchDispatchTrace: () => touchDispatchTrace.slice(), clearTouchDispatchTrace: () => { touchDispatchTrace.length = 0 } }
}
module.exports = { launch, delay }

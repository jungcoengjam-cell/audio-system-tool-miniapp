const query = new URLSearchParams(location.search)
const app = document.getElementById('app')
const theme = query.get('theme') || 'light'
let session
let ast
let productionCss = ''
let templateMap
let errors = []
let eventQueue = Promise.resolve()
let activeTouch = null
const eventTrace = []
const rpx = source => String(source).split(/(url\(\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^)]*)\s*\))/gi)
  .map(part => /^url\(/i.test(part) ? part : part.replace(/(-?(?:\d+\.?\d*|\.\d+))rpx\b/g, (_, number) => `${Number((Number(number) * innerWidth / 750).toFixed(5))}px`)).join('')
const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rawTouchTrace = []
function evaluate(expression, scope) {
  try { return Function('scope', `with(scope){return (${expression})}`)(scope) }
  catch (error) { if (!/Cannot read properties of (?:undefined|null)/.test(error.message)) errors.push(`${expression}: ${error.message}`); return '' }
}
function value(source, scope) { const match = String(source).match(/^\{\{([\s\S]*)\}\}$/); return match ? evaluate(match[1], scope) : source }
function interpolate(source, scope) { return String(source).replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(expression, scope) ?? '')) }
async function loadText(url) { const target = new URL(url, location.origin); if (query.get('sourceVersion') === 'before') target.searchParams.set('qaNativeBefore', '1'); const result = await fetch(target, { cache: 'no-store' }); if (!result.ok) throw Error(`${url}: ${result.status}`); return result.text() }
async function cssFile(url) {
  let source = await loadText(url)
  for (const match of [...source.matchAll(/@import\s+["']([^"']+)["']\s*;/g)]) source = source.replace(match[0], await cssFile(new URL(match[1], location.origin + url).pathname))
  return source
}
async function xmlFile(url) {
  let source = await loadText(url)
  for (const match of [...source.matchAll(/<include\s+src=["']([^"']+)["']\s*\/>/g)]) source = source.replace(match[0], await xmlFile(new URL(match[1], location.origin + url).pathname))
  return source
}
function parse(markup) {
  const root = { children: [] }, stack = [root]
  let sourceNodeId = 0
  const tokens = markup.match(/<!--[\s\S]*?-->|<\/?[\w:-]+(?:"[^"]*"|'[^']*'|[^'">])*\/?\s*>|[^<]+/g) || []
  for (const token of tokens) {
    if (token.startsWith('<!--')) continue
    if (token.startsWith('</')) { stack.pop(); continue }
    if (!token.startsWith('<')) { stack.at(-1).children.push({ text: token }); continue }
    const tag = token.match(/^<([\w:-]+)/)[1].toLowerCase(), attrs = {}
    for (const match of token.slice(tag.length + 1).replace(/\/?>$/, '').matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? ''
    const node = { tag, attrs, children: [], qaSourceId: `wxml-node-${sourceNodeId++}` }; stack.at(-1).children.push(node)
    if (!/\/\s*>$/.test(token) && !['img', 'input', 'br'].includes(tag)) stack.push(node)
  }
  if (stack.length !== 1) throw Error('Unbalanced production WXML parse')
  return root.children
}
function renderNodes(nodes, scope) {
  let chain = false, matched = false
  return nodes.map(node => {
    if (node.text !== undefined) return escapeHtml(interpolate(node.text, scope))
    const attrs = node.attrs
    if ('wx:for' in attrs) {
      const items = value(attrs['wx:for'], scope) || [], copy = { ...node, attrs: { ...attrs } }; delete copy.attrs['wx:for']
      return items.map((item, index) => {
        const itemScope = { ...scope, [attrs['wx:for-item'] || 'item']: item, [attrs['wx:for-index'] || 'index']: index }
        const keyExpression = attrs['wx:key'] || ''
        const keyValue = keyExpression === '*this' ? item : keyExpression
          ? item !== null && typeof item === 'object' && Object.hasOwn(item, keyExpression) ? item[keyExpression] : evaluate(keyExpression, itemScope)
          : index
        const loopKey = `${node.qaSourceId}:${keyExpression || 'index'}:${String(keyValue ?? index)}`
        itemScope.__qaTemplateLoopContext = [scope.__qaTemplateLoopContext, loopKey].filter(Boolean).join('/')
        copy.attrs['data-qa-key'] = `${keyExpression || 'index'}:${String(keyValue ?? index)}`
        return renderNodes([copy], itemScope)
      }).join('')
    }
    if ('wx:if' in attrs) { chain = true; matched = Boolean(value(attrs['wx:if'], scope)); if (!matched) return '' }
    else if ('wx:elif' in attrs) { if (!chain || matched) return ''; matched = Boolean(value(attrs['wx:elif'], scope)); if (!matched) return '' }
    else if ('wx:else' in attrs) { if (!chain || matched) return ''; matched = true }
    else { chain = false; matched = false }
    if ('hidden' in attrs && value(attrs.hidden, scope)) return ''
    if (node.tag === 'template') { if (attrs.name) return ''; const template = templateMap.get(attrs.is); return template ? renderNodes(template.children, { ...scope, ...evaluate('{' + attrs.data.slice(2, -2) + '}', scope) }) : '' }
    const inner = renderNodes(node.children, scope)
    if (node.tag === 'block') return inner
    if (node.tag === 'canvas') return ''
    const tag = ({ image: 'img', navigator: 'a' })[node.tag] || node.tag
    let renderedAttrs = Object.entries(attrs).filter(([key]) => !key.startsWith('wx:') && key !== 'hidden').map(([key, raw]) => {
      const interpreted = value(raw, scope)
      if (key === 'disabled' && !interpreted) return ''
      if (key.startsWith('bind') || key.startsWith('catch')) return `data-${key.replace(':', '')}="${escapeHtml(raw)}"`
      if (['range', 'value'].includes(key) && Array.isArray(interpreted)) return `data-${key}-json="${escapeHtml(JSON.stringify(interpreted))}"`
      return `${key}="${escapeHtml(rpx(interpolate(raw, scope)))}"`
    }).join(' ')
    const templateIdentity = `${node.qaSourceId}${scope.__qaTemplateLoopContext ? `|${scope.__qaTemplateLoopContext}` : ''}`
    renderedAttrs += ` data-qa-template-key="${escapeHtml(templateIdentity)}"`
    if (tag === 'textarea') return `<textarea ${renderedAttrs}>${escapeHtml(interpolate(attrs.value || '', scope))}</textarea>`
    if (tag === 'picker') {
      const options = value(attrs.range || '[]', scope) || []
      const index = Number(value(attrs.value || '0', scope)) || 0
      return `<picker ${renderedAttrs}>${inner}<select aria-label="${escapeHtml(attrs['range-key'] || '选项')}">${options.map((option, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${escapeHtml(attrs['range-key'] ? option[attrs['range-key']] : option)}</option>`).join('')}</select></picker>`
    }
    return `<${tag} ${renderedAttrs}>${['img', 'input'].includes(tag) ? '' : inner + '</' + tag + '>'}`
  }).join('')
}
function box(node) { if (!node) return null; const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, scrollHeight: node.scrollHeight, scrollWidth: node.scrollWidth } }
function selectors() { const result = {}; document.querySelectorAll('[id],scroll-view,[class*="sheet"]').forEach(node => { if (node.id) result['#' + node.id] = box(node); for (const name of node.classList) result['.' + name] = box(node); if (node.classList.length) result['.' + [...node.classList].join('.')] = box(node) }); return result }
function geometry() {
  const visible = node => Boolean(node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
  return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth, errors: [...new Set(errors)],
    background: getComputedStyle(document.querySelector('.wiring-page') || app).backgroundColor,
    controls: [...app.querySelectorAll('button,input,picker,textarea')].filter(visible).map(node => ({ text: node.textContent.trim(), className: node.className, id: node.id, ...box(node) })),
    sheets: [...app.querySelectorAll('[class*="sheet"]')].filter(visible).map(node => ({ className: node.className, ...box(node) })),
    portCells: [...app.querySelectorAll('scroll-view[scroll-x]')].filter(visible).map(node => ({ className: node.className, ...box(node) })),
    circles: [...app.querySelectorAll('.workspace-circle')].filter(visible).map(node => ({ ...box(node), background: getComputedStyle(node).backgroundColor, borderColor: getComputedStyle(node).borderColor, borderRadius: getComputedStyle(node).borderRadius })),
    groups: [...app.querySelectorAll('.workspace-group-header')].filter(visible).map(box),
    rows: [...app.querySelectorAll('.workspace-line-row')].filter(visible).map(box),
    dividers: [...app.querySelectorAll('.workspace-port-divider')].filter(visible).map(box),
    text: app.innerText, scale: innerWidth / 750 }
}
function render() {
  errors = []
  const html = renderNodes(ast, session.data)
  window.__qaPatchStats = window.__qaPatchMarkup ? window.__qaPatchMarkup(app, `<page>${html}</page>`) : null
  if (!window.__qaPatchMarkup) app.innerHTML = `<page>${html}</page>`
  document.documentElement.dataset.theme = theme
  app.classList.toggle('theme-dark', theme === 'dark')
  const style = document.getElementById('production-style')
  style.textContent = rpx(window.__qaTransformCss ? window.__qaTransformCss(productionCss) : productionCss)
  for (const node of app.querySelectorAll('*')) {
    node.__qaWxmlBindings = compileBindings(Object.fromEntries([...node.attributes].filter(attr => /^data-(?:bind|catch)/.test(attr.name)).map(attr => [attr.name, attr.value])))
  }
  for (const wheel of app.querySelectorAll('picker-view')) {
    const index = JSON.parse(wheel.getAttribute('data-value-json') || '[0]')[0]
    if (window.__qaNativeWheelAdapter) { window.__qaNativeWheelAdapter(wheel, index); continue }
    const column = wheel.querySelector('picker-view-column'), row = column?.querySelector('view')
    if (column && row) {
      const pitch = row.getBoundingClientRect().height, height = wheel.getBoundingClientRect().height
      column.style.setProperty('--qa-wheel-padding', Math.max(0, (height - pitch) / 2) + 'px')
      column.scrollTop = index * pitch
      const indicator = document.createElement('div'); indicator.className = wheel.getAttribute('indicator-class') || ''; indicator.dataset.qaNativeWheelPart = 'indicator'
      Object.assign(indicator.style, { position: 'absolute', top: (height - pitch) / 2 + 'px', left: '0', right: '0', height: pitch + 'px', pointerEvents: 'none', zIndex: '0' })
      const mask = document.createElement('div'); mask.className = wheel.getAttribute('mask-class') || ''; mask.dataset.qaNativeWheelPart = 'mask'
      Object.assign(mask.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '2' })
      wheel.prepend(indicator); wheel.append(mask)
    }
  }
  window.__wiringQa = { session, geometry: geometry() }
}
// WeChat's template compiler canonicalizes bind/catch attributes. Its webview
// binder installs one callback slot per node/event; later attributes overwrite
// that slot while the first attribute fixes the catch/bind propagation wrapper.
function compileBindings(bindings) {
  const entries = Object.entries(bindings).map(([attr, method], index) => ({ attr, method, index, catch: attr.startsWith('data-catch') }))
  entries.sort((a, b) => {
    const an = a.attr.replace(/^data-(?:bind|catch)/, ''), bn = b.attr.replace(/^data-(?:bind|catch)/, '')
    return an === bn ? Number(a.catch) - Number(b.catch) || a.index - b.index : a.index - b.index
  })
  const groups = Object.create(null)
  for (const entry of entries) {
    const type = entry.attr.replace(/^data-(?:bind|catch)/, '')
    if (!groups[type]) groups[type] = { type, firstCatch: entry.catch, method: entry.method, sourceAttrs: [] }
    groups[type].method = entry.method
    groups[type].sourceAttrs.push({ attr: entry.attr, method: entry.method, catch: entry.catch })
  }
  return groups
}
function describeNode(node) {
  if (!node || node.nodeType !== 1) node = node?.parentElement || null
  return node ? { id: node.id || '', dataset: nativeDataset(node), tagName: node.tagName.toLowerCase() } : { id: '', dataset: {}, tagName: '' }
}
function nativeDataset(node) {
  return Object.fromEntries(Object.entries({ ...node.dataset }).filter(([key]) => !/^(?:bind|catch)(?:tap|touchstart|touchmove|touchend|touchcancel|input|confirm|change|scroll|focus|blur|keyboardheightchange)$/.test(key)))
}
function capturePath(target) {
  if (!target || target.nodeType !== 1) target = target?.parentElement || null
  const path = []
  for (let node = target; node; node = node.parentElement) {
    if (node === app) break
    if (node.__qaWxmlBindings) path.push({ id: node.id || '', dataset: nativeDataset(node), tagName: node.tagName.toLowerCase(), bindings: structuredClone(node.__qaWxmlBindings) })
  }
  return { target: describeNode(target), path }
}
function eventPoints(points) { return [...(points || [])].map(point => ({ identifier: point.identifier, clientX: point.clientX, clientY: point.clientY, pageX: point.pageX, pageY: point.pageY })) }
function inspectNode(node) {
  if (!node || node.nodeType !== 1) return null
  const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
  const bindings = Object.fromEntries(Object.entries(node.__qaWxmlBindings || {}).map(([type, binding]) => [type, { firstCatch: binding.firstCatch, method: binding.method, sourceAttrs: binding.sourceAttrs }]))
  return {
    ...describeNode(node), className: typeof node.className === 'string' ? node.className : '',
    qaKey: node.getAttribute('data-qa-key'), rect: { x: rect.x, y: rect.y, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
    style: { display: style.display, visibility: style.visibility, opacity: style.opacity, pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex, transform: style.transform, overflowX: style.overflowX, overflowY: style.overflowY },
    scroll: { left: node.scrollLeft, top: node.scrollTop, width: node.scrollWidth, height: node.scrollHeight, clientWidth: node.clientWidth, clientHeight: node.clientHeight },
    bindings
  }
}
function inspectPath(node) {
  const result = []
  for (let current = node; current; current = current.parentElement) {
    result.push(inspectNode(current))
    if (current === app) break
  }
  return result
}
function hitDetails(selector, point) {
  const selected = typeof selector === 'string' ? document.querySelector(selector) : selector
  const rect = selected?.getBoundingClientRect()
  const position = point || (rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null)
  const hit = position ? document.elementFromPoint(position.x, position.y) : null
  return {
    requested: typeof selector === 'string' ? selector : null,
    point: position,
    selected: inspectNode(selected), selectedPath: selected ? inspectPath(selected) : [],
    actualHit: inspectNode(hit), actualHitPath: hit ? inspectPath(hit) : [],
    hitMatchesSelected: Boolean(selected && hit && (hit === selected || selected.contains(hit)))
  }
}
window.__qaInspectHit = hitDetails
window.__qaRawTouchTrace = rawTouchTrace
window.__qaClearRawTouchTrace = () => { rawTouchTrace.length = 0 }
function enqueueEvent(pathInfo, type, event, detail = {}) {
  if (!pathInfo?.path?.length) return eventQueue
  const touches = eventPoints(event?.touches), changedTouches = eventPoints(event?.changedTouches)
  const run = async () => {
    for (const current of pathInfo.path) {
      const binding = current.bindings[type]
      if (!binding?.method) continue
      const extra = {
        id: current.id,
        type,
        target: pathInfo.target,
        currentTarget: { id: current.id, dataset: current.dataset, tagName: current.tagName },
        touches,
        changedTouches,
        timeStamp: event?.timeStamp || Date.now(),
        touchIdentifier: changedTouches[0]?.identifier ?? touches[0]?.identifier ?? null,
        nativeInput: event?.__qaNativeInput || 'browser-event'
      }
      eventTrace.push({ method: binding.method, type, catch: binding.firstCatch, sourceAttrs: binding.sourceAttrs, target: pathInfo.target, currentTarget: extra.currentTarget, touches, changedTouches, timeStamp: extra.timeStamp, nativeInput: extra.nativeInput })
      await window.__dispatch(binding.method, { ...current.dataset }, detail, extra)
      // The official binder's catch flag comes from the first attribute for a
      // node/event; same-node handlers are not separate DOM listeners.
      if (binding.firstCatch) break
    }
  }
  eventQueue = eventQueue.then(run).catch(error => { errors.push('WXML event adapter: ' + error.message) })
  return eventQueue
}
function installEventRouter() {
  if (window.__qaWxmlRouterInstalled) return
  window.__qaWxmlRouterInstalled = true
  const active = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'click', 'input', 'change', 'scroll', 'focus', 'blur', 'keydown', 'qa-wheel-change', 'qa-keyboardheightchange']
  for (const domType of active) document.addEventListener(domType, event => {
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement
    if (!target || !app.contains(target)) return
    if (['touchstart', 'touchmove', 'touchend', 'touchcancel', 'click'].includes(domType)) {
      const point = eventPoints(event.changedTouches)[0] || eventPoints(event.touches)[0] || (Number.isFinite(event.clientX) ? { clientX: event.clientX, clientY: event.clientY } : null)
      const hit = point ? document.elementFromPoint(point.clientX, point.clientY) : null
      const route = domType === 'touchstart' ? capturePath(target) : activeTouch
      rawTouchTrace.push({
        domType, isTrusted: event.isTrusted, timeStamp: event.timeStamp,
        eventTarget: inspectNode(target), point, elementFromPoint: inspectNode(hit),
        eventTargetPath: inspectPath(target), elementFromPointPath: hit ? inspectPath(hit) : [],
        capturedWxmlTarget: route?.target || null,
        capturedWxmlPath: (route?.path || []).map(item => ({ id: item.id, dataset: item.dataset, tagName: item.tagName, bindings: Object.fromEntries(Object.entries(item.bindings || {}).map(([type, binding]) => [type, { firstCatch: binding.firstCatch, method: binding.method }])) })),
        activeTouch: activeTouch ? { moved: activeTouch.moved, ended: activeTouch.ended, start: activeTouch.start, last: activeTouch.last } : null
      })
      if (rawTouchTrace.length > 2000) rawTouchTrace.splice(0, rawTouchTrace.length - 2000)
    }
    if (domType === 'touchstart') {
      activeTouch = { ...capturePath(target), start: eventPoints(event.changedTouches)[0] || null, last: eventPoints(event.changedTouches)[0] || null, moved: false, ended: false }
      enqueueEvent(activeTouch, 'touchstart', event)
      return
    }
    if (['touchmove', 'touchend', 'touchcancel'].includes(domType) && activeTouch) {
      const point = eventPoints(event.changedTouches)[0] || eventPoints(event.touches)[0] || null
      if (domType === 'touchmove' && point && activeTouch.start) {
        activeTouch.last = point
        if (Math.hypot(point.clientX - activeTouch.start.clientX, point.clientY - activeTouch.start.clientY) > 8) activeTouch.moved = true
      }
      enqueueEvent(activeTouch, domType, event)
      if (domType === 'touchend') activeTouch.ended = true
      if (domType === 'touchcancel') activeTouch = null
      return
    }
    if (domType === 'click') {
      if (target.disabled || event.target?.tagName === 'SELECT') return
      const pathInfo = activeTouch?.ended && !activeTouch.moved ? activeTouch : capturePath(target)
      const detail = { x: event.clientX, y: event.clientY, nativeInput: activeTouch?.ended ? 'synthesized-touch-tap' : 'dom-click' }
      event.__qaNativeInput = detail.nativeInput
      enqueueEvent(pathInfo, 'tap', event, detail)
      if (activeTouch?.ended) activeTouch = null
      return
    }
    if (domType === 'input') {
      const pathInfo = capturePath(target)
      enqueueEvent(pathInfo, 'input', event, { value: target.value })
      return
    }
    if (domType === 'change') {
      enqueueEvent(capturePath(target), 'change', event, { value: target.value })
      return
    }
    if (domType === 'scroll') {
      if (target.tagName.toLowerCase() === 'picker-view-column') return
      enqueueEvent(capturePath(target), 'scroll', event, { scrollLeft: target.scrollLeft, scrollTop: target.scrollTop })
      return
    }
    if (domType === 'focus') {
      enqueueEvent(capturePath(target), 'focus', event, { height: 0 })
      return
    }
    if (domType === 'blur') {
      enqueueEvent(capturePath(target), 'blur', event)
      return
    }
    if (domType === 'keydown' && event.key === 'Enter') {
      enqueueEvent(capturePath(target), 'confirm', event, { value: target.value })
      return
    }
    if (domType === 'qa-wheel-change') enqueueEvent(capturePath(target), 'change', event, { value: event.detail })
    if (domType === 'qa-keyboardheightchange') enqueueEvent(capturePath(target), 'keyboardheightchange', event, event.detail || {})
  }, true)
}
window.__qaEventTrace = eventTrace
window.__qaFlushEvents = async () => { await eventQueue; await new Promise(resolve => setTimeout(resolve, 0)); return { trace: eventTrace.slice(), state: window.__wiringQa?.session } }
window.__qaEmitWxmlEvent = async (selector, type, detail = {}) => {
  const target = document.querySelector(selector)
  if (!target) throw Error(`No target for WXML event ${type}: ${selector}`)
  const event = { touches: [], changedTouches: [], timeStamp: Date.now(), __qaNativeInput: 'explicit-native-event-fixture' }
  await enqueueEvent(capturePath(target), type, event, detail)
  return window.__qaFlushEvents()
}
window.__dispatch = async (method, dataset = {}, detail = {}, extra = {}) => {
  const response = await fetch('/__dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: session.id, method, dataset, detail, extra, selectors: selectors() }) })
  const next = await response.json(); if (!response.ok) throw Error(next.error)
  const changed = JSON.stringify(session.data) !== JSON.stringify(next.data)
  session = next
  if (!changed || ['onPortCellScroll', 'onLineTouchStart', 'onLineTouchMove', 'onLineTouchEnd'].includes(method)) window.__wiringQa = { session, geometry: geometry() }
  else render()
  return session
}
window.__qaAction = async (action, value, options = {}) => {
  const response = await fetch('/__dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: session.id, action, value, ...options }) })
  const next = await response.json(); if (!response.ok) throw Error(next.error)
  session = next; render(); return session
}
window.__qaRefresh = async () => {
  const response = await fetch('/__snapshot?' + new URLSearchParams({ id: session.id }), { cache: 'no-store' })
  const next = await response.json(); if (!response.ok) throw Error(next.error)
  const changed = JSON.stringify(session?.data) !== JSON.stringify(next.data)
  session = next
  if (changed) render()
  else window.__wiringQa = { session, geometry: geometry() }
  return session
}
window.__geometry = geometry
async function main() {
  installEventRouter()
  await import('./keyed-dom-patch.js')
  if (window.__qaProfileReady) await window.__qaProfileReady
  const style = document.createElement('style'); style.id = 'production-style'; document.head.append(style)
  const nativeScrollbarStyle = document.createElement('style'); nativeScrollbarStyle.dataset.qaNativeScrollbarAdapter = 'true'; nativeScrollbarStyle.textContent = 'scroll-view[show-scrollbar="false"]{scrollbar-width:none}scroll-view[show-scrollbar="false"]::-webkit-scrollbar{display:none;width:0;height:0}'; document.head.append(nativeScrollbarStyle)
  const [xml, appCss, pageCss, response] = await Promise.all([
    xmlFile('/pages/project-wiring/index.wxml'), cssFile('/app.wxss'), cssFile('/pages/project-wiring/index.wxss'),
    fetch('/__session?' + new URLSearchParams({ fixture: query.get('fixture') || 'standard', count: query.get('count') || '4', theme, width: innerWidth, height: innerHeight, capsule: query.get('capsule') || '', sourceVersion: query.get('sourceVersion') || '', menuLeft: query.get('menuLeft') || '', menuTop: query.get('menuTop') || '', menuBottom: query.get('menuBottom') || '', statusHeight: query.get('statusHeight') || '', safeBottom: query.get('safeBottom') || '', activeProjectId: query.get('activeProjectId') || '__default__', viewPreferenceJson: query.get('viewPreferenceJson') || '', routeId: query.get('routeId') || '' }))
  ])
  session = await response.json(); if (!response.ok) throw Error(session.error)
  ast = parse(xml); templateMap = new Map(ast.filter(node => node.tag === 'template' && node.attrs.name).map(node => [node.attrs.name, node]))
  productionCss = appCss + '\n' + (window.__qaNativeButtonCss || '') + '\n' + pageCss
  render(); document.documentElement.dataset.ready = 'true'
}
main().catch(error => { document.getElementById('error').textContent = error.stack; document.documentElement.dataset.error = error.stack })

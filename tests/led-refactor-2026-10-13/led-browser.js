'use strict'

const app = document.getElementById('app')
const errorElement = document.getElementById('qa-error')
const query = new URLSearchParams(location.search)
const caseName = query.get('case') || 'sample'
const fontScale = Math.max(1, Math.min(1.5, Number(query.get('fontScale')) || 1))
const theme = ['light', 'dark'].includes(query.get('theme')) ? query.get('theme') : 'system'
const loadedWxss = new Set()
let fixture = null
let state = null
let rendering = false
let restoringFocus = false

document.documentElement.dataset.qaFontScale = String(fontScale)
document.documentElement.dataset.qaTheme = theme

function simulateTheme(source) {
  if (theme === 'system') return source
  const condition = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi
  return source.replace(condition, theme === 'dark' ? '@media all' : '@media not all')
}

function convertRpx(source, width = innerWidth) {
  const sourceText = String(source)
  const urlToken = /(url\(\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^)]*)\s*\))/gi
  const scale = width / 750
  return sourceText.split(urlToken).map((part) => {
    if (/^url\(/i.test(part)) return part
    return part
      .replace(/(font-size\s*:\s*)(-?(?:\d+\.?\d*|\.\d+))rpx\b/gi,
        (_match, prefix, raw) => `${prefix}${Number((Number(raw) * scale).toFixed(5))}px`)
      .replace(/(-?(?:\d+\.?\d*|\.\d+))rpx\b/g, (_match, raw) => `${Number((Number(raw) * scale).toFixed(5))}px`)
      .replace(/(font-size\s*:\s*)(-?(?:\d+\.?\d*|\.\d+))px\b/gi,
        (_match, prefix, raw) => `${prefix}${Number((Number(raw) * fontScale).toFixed(5))}px`)
  }).join('')
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`)
  return response.text()
}

async function installWxss(url, ancestry = []) {
  const target = new URL(url, location.origin)
  if (ancestry.includes(target.pathname)) throw new Error(`WXSS import cycle at ${target.pathname}`)
  loadedWxss.add(target.pathname)
  let css = await fetchText(target.pathname)
  const imports = [...css.matchAll(/@import\s+(?:url\()?("|')(.*?)\1\)?\s*[^;]*;/g)]
  for (const [directive, _quote, importPath] of imports) {
    css = css.replace(directive, await installWxss(new URL(importPath, target).href, [...ancestry, target.pathname]))
  }
  css = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, quote, assetPath) => {
    const asset = assetPath.trim()
    if (/^(?:data:|https?:|\/|#)/i.test(asset)) return full
    return `url("${new URL(asset, target).href}")`
  })
  return css
}

async function installProductionStyles() {
  for (const url of ['/app.wxss', '/pages/led-screen/led-screen.wxss']) {
    const source = await installWxss(url)
    const style = document.createElement('style')
    style.dataset.productionSource = url
    style.textContent = convertRpx(simulateTheme(source))
    document.head.append(style)
  }
  const meta = await fetch('/__qa-meta', { cache: 'no-store' }).then((response) => response.json())
  window.__ledQaMeta = { ...meta, loadedWxss: [...loadedWxss].sort(), fontScale, themeSimulation: theme }
}

async function expandWxml(url, ancestry = []) {
  const target = new URL(url, location.origin)
  if (ancestry.includes(target.pathname)) throw new Error(`WXML include cycle at ${target.pathname}`)
  let source = await fetchText(target.pathname)
  const includes = [...source.matchAll(/<include\s+src="([^"]+)"\s*\/>/g)]
  for (const [tag, includePath] of includes) {
    source = source.replace(tag, await expandWxml(new URL(includePath, target).href, [...ancestry, target.pathname]))
  }
  return source
}

function evaluate(expression, scope) {
  try {
    const code = String(expression).replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
    return Function('scope', `with(scope){return (${code})}`)(scope)
  } catch (_) { return '' }
}

function interpolate(source, scope) {
  return String(source).replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression) => {
    const value = evaluate(expression, scope)
    return value === undefined || value === null ? '' : String(value)
  })
}

function addChildren(source, target, scope) {
  let branch = null
  for (const child of [...source.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent.trim()) target.append(document.createTextNode(interpolate(child.textContent, scope)))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const condition = child.getAttribute('wx:if')
    const alternate = child.getAttribute('wx:elif')
    if (condition !== null) {
      branch = { matched: Boolean(evaluate(condition, scope)) }
      if (branch.matched) renderElement(child, scope, target)
      continue
    }
    if (alternate !== null) {
      if (branch && !branch.matched && evaluate(alternate, scope)) {
        branch.matched = true
        renderElement(child, scope, target)
      }
      continue
    }
    if (child.hasAttribute('wx:else')) {
      if (branch && !branch.matched) {
        branch.matched = true
        renderElement(child, scope, target)
      }
      continue
    }
    branch = null
    renderElement(child, scope, target)
  }
}

function renderElement(source, scope, target) {
  const forExpression = source.getAttribute('wx:for')
  if (forExpression !== null) {
    const items = evaluate(forExpression, scope)
    const itemKey = source.getAttribute('wx:for-item') || 'item'
    const indexKey = source.getAttribute('wx:for-index') || 'index'
    ;(Array.isArray(items) ? items : []).forEach((item, index) => {
      const clone = source.cloneNode(true)
      for (const attr of ['wx:for', 'wx:for-item', 'wx:for-index', 'wx:key']) clone.removeAttribute(attr)
      renderElement(clone, { ...scope, [itemKey]: item, [indexKey]: index }, target)
    })
    return
  }
  const sourceTag = source.tagName.toLowerCase()
  if (sourceTag === 'block') return addChildren(source, target, scope)
  const tag = { 'scroll-view': 'div', picker: 'div', image: 'img' }[sourceTag] || sourceTag
  const output = document.createElement(tag)
  for (const attr of [...source.attributes]) {
    const name = attr.name
    if (name.startsWith('wx:') || ['range', 'range-key', 'enhanced', 'show-scrollbar', 'scroll-y', 'scroll-x'].includes(name)) {
      if (name === 'scroll-y') output.dataset.qaScrollY = interpolate(attr.value, scope) || 'true'
      if (name === 'scroll-x') output.dataset.qaScrollX = interpolate(attr.value, scope) || 'true'
      if (name === 'range') output.dataset.wxRange = JSON.stringify(evaluate(attr.value, scope) || [])
      if (name === 'range-key') output.dataset.wxRangeKey = attr.value
      if (name === 'value' && sourceTag === 'picker') output.dataset.wxPickerValue = interpolate(attr.value, scope)
      continue
    }
    if (name.startsWith('bind') || name.startsWith('catch')) {
      const eventType = name.replace(':', '')
      output.setAttribute(`data-qa-${eventType}`, attr.value)
      continue
    }
    const value = interpolate(attr.value, scope)
    if (name === 'value' && sourceTag === 'input') { output.value = value; continue }
    if (name === 'value' && sourceTag === 'textarea') { output.value = value; continue }
    if (name === 'type' && sourceTag === 'input' && value === 'digit') {
      output.setAttribute('type', 'text')
      output.setAttribute('inputmode', 'decimal')
      continue
    }
    if (['disabled', 'checked', 'hidden', 'multiple', 'selected', 'readonly', 'required'].includes(name)) {
      const expression = attr.value.match(/^\{\{[\s\S]*\}\}$/)
      const enabled = expression ? Boolean(evaluate(attr.value, scope)) : !['false', '0'].includes(value)
      if (enabled) output.setAttribute(name, '')
      continue
    }
    output.setAttribute(name, name === 'style' ? convertRpx(value) : value)
  }
  if (sourceTag === 'image' && !output.hasAttribute('alt')) output.alt = 'LED report preview'
  target.append(output)
  if (!['input', 'textarea', 'img'].includes(tag)) addChildren(source, output, scope)
}

async function render() {
  const source = (await expandWxml('/pages/led-screen/led-screen.wxml'))
    .replace(/<textarea\b([^>]*)\s*\/>/gi, '<textarea$1></textarea>')
  const parsed = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html')
  rendering = true
  app.replaceChildren()
  addChildren(parsed.body, app, state)
  rendering = false
  app.dataset.qaSource = 'production-wxml'
  app.dataset.qaState = caseName
  app.dataset.qaPreviewVisible = String(Boolean(state.reportPreviewVisible))
  app.dataset.qaViewerVisible = String(Boolean(state.reportImageViewerVisible))
  app.dataset.qaViewerScale = String(state.reportImageViewerScale || 100)
  document.documentElement.dataset.qaReady = 'true'
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status} from ${path}`)
  return value
}

function eventDataset(element) {
  const data = {}
  for (const [key, value] of Object.entries(element.dataset)) {
    if (key.startsWith('wx') || key.startsWith('qa')) continue
    data[key] = value
  }
  return data
}

// Timed production setData calls run in the server fixture after the event reply.
// Pull their completed state without replaying the entrance/exit animation.
function refreshClosingState() {
  if (!state?.reportPreviewClosing && !state?.projectDialogClosing) return
  const closingState = state
  const sessionId = fixture.sessionId
  setTimeout(async () => {
    if (state !== closingState || fixture.sessionId !== sessionId) return
    try {
      const response = await api(`/__state?sessionId=${encodeURIComponent(sessionId)}`)
      if (state !== closingState || fixture.sessionId !== sessionId) return
      if (JSON.stringify(response.state) !== JSON.stringify(state)) {
        state = response.state
        await render()
      }
      refreshClosingState()
    } catch (error) { showError(error) }
  }, 350)
}

async function sendEvent(element, detail = {}, handler = element.getAttribute('data-qa-handler')) {
  const active = document.activeElement
  const activeData = active && active !== document.body ? {
    id: active.id,
    field: active.dataset.field,
    step: active.dataset.step,
    selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
  } : null
  const scrolls = [...document.querySelectorAll('[data-qa-scroll-y="true"], [data-qa-scroll-x="true"]')].map((node) => ({
    selector: node.id ? `#${CSS.escape(node.id)}` : null,
    className: node.className,
    top: node.scrollTop,
    left: node.scrollLeft,
  }))
  const response = await api('/__event', {
    sessionId: fixture.sessionId,
    handler,
    dataset: eventDataset(element), detail,
  })
  state = response.state
  app.dataset.qaLastEvent = handler || ''
  app.dataset.qaLastEventResult = response.result === null ? 'undefined' : String(response.result)
  await render()
  refreshClosingState()
  if (activeData) {
    const selector = activeData.id ? `#${CSS.escape(activeData.id)}` : activeData.field
      ? `[data-field="${CSS.escape(activeData.field)}"]${activeData.step ? `[data-step="${CSS.escape(activeData.step)}"]` : ''}` : null
    const replacement = selector ? app.querySelector(selector) : null
    if (replacement && !replacement.disabled) {
      restoringFocus = true
      replacement.focus({ preventScroll: true })
      if (activeData.selectionStart !== null && typeof replacement.setSelectionRange === 'function') {
        try { replacement.setSelectionRange(activeData.selectionStart, activeData.selectionEnd) } catch (_) {}
      }
      restoringFocus = false
    }
  }
  for (const item of scrolls) {
    const node = item.selector ? document.querySelector(item.selector)
      : [...document.querySelectorAll('[data-qa-scroll-y="true"], [data-qa-scroll-x="true"]')].find((candidate) => candidate.className === item.className)
    if (node) { node.scrollTop = item.top; node.scrollLeft = item.left }
  }
}

async function startReport() {
  const started = await api('/__report-start', { sessionId: fixture.sessionId })
  if (started.cached) {
    state = started.state
    await render()
    window.__ledQaReportCached = true
    return
  }
  const moduleSource = await fetchText('/pages/led-screen/report.js')
  const module = { exports: {} }
  Function('module', 'exports', moduleSource)(module, module.exports)
  const canvas = document.createElement('canvas')
  canvas.width = Number(started.width) || 750
  const nativeContext = canvas.getContext('2d')
  const context = new Proxy(nativeContext, {
    get(target, property) {
      if (property === 'setFillStyle') return (value) => { target.fillStyle = value }
      if (property === 'setStrokeStyle') return (value) => { target.strokeStyle = value }
      if (property === 'setLineWidth') return (value) => { target.lineWidth = value }
      if (property === 'setTextAlign') return (value) => { target.textAlign = value }
      if (property === 'setFontSize') return () => {}
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, property, value) { return Reflect.set(target, property, value, target) },
  })
  const layout = module.exports.buildLedScreenReportLayout(context, started.payload)
  canvas.height = layout.height
  module.exports.drawLedScreenReport(context, started.payload, layout)
  const dataUrl = canvas.toDataURL('image/png')
  const completed = await api('/__report-finish', {
    sessionId: fixture.sessionId, dataUrl, height: layout.height, layout,
  })
  state = completed.state
  await render()
  window.__ledQaReport = { layout, width: canvas.width, height: canvas.height, pngBytes: Math.floor(dataUrl.length * 0.75) }
}

document.addEventListener('input', async (event) => {
  const control = event.target.closest('[data-qa-bindinput]')
  if (!control) return
  try { await sendEvent(control, { value: control.value }, control.getAttribute('data-qa-bindinput')) } catch (error) { showError(error) }
})

document.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-qa-bindchange]')
  if (select) {
    try { await sendEvent(select, { value: select.value }, select.getAttribute('data-qa-bindchange')) } catch (error) { showError(error) }
  }
})

async function dispatchElementEvent(element, eventType, detail = {}) {
  const handler = element.getAttribute(`data-qa-${eventType}`)
  if (!handler) return false
  try {
    await sendEvent(element, detail, handler)
    return true
  } catch (error) { showError(error); return false }
}

document.addEventListener('focusin', async (event) => {
  if (rendering || restoringFocus) return
  const control = event.target.closest('[data-qa-bindfocus]')
  if (control) await dispatchElementEvent(control, 'bindfocus')
})

document.addEventListener('focusout', async (event) => {
  if (rendering || restoringFocus) return
  const control = event.target.closest('[data-qa-bindblur]')
  if (control) await dispatchElementEvent(control, 'bindblur')
})

document.addEventListener('click', async (event) => {
  const picker = event.target.closest('[data-wx-range]')
  if (picker) {
    const range = JSON.parse(picker.dataset.wxRange || '[]')
    if (!range.length) return
    const current = Number(picker.dataset.wxPickerValue) || 0
    const selected = (current + 1) % range.length
    const handler = picker.getAttribute('data-qa-bindchange')
      || picker.querySelector('[data-qa-bindchange]')?.getAttribute('data-qa-bindchange')
    if (handler) await sendEvent(picker, { value: selected }, handler)
    return
  }
  let control = event.target
  while (control && control !== document) {
    if (control.hasAttribute?.('data-qa-catchtap')) {
      await dispatchElementEvent(control, 'catchtap')
      event.stopPropagation()
      return
    }
    if (control.hasAttribute?.('data-qa-bindtap')) {
      if (control.disabled) return
      if (control.getAttribute('data-qa-bindtap') === 'openSharePreview') {
        try { await startReport() } catch (error) { showError(error) }
      } else await dispatchElementEvent(control, 'bindtap')
      return
    }
    control = control.parentElement
  }
})

document.addEventListener('touchmove', (event) => {
  const control = event.target.closest('[data-qa-catchtouchmove]')
  if (!control) return
  event.preventDefault()
  event.stopPropagation()
  if (!control.dataset.qaTouchMoveDispatched) {
    control.dataset.qaTouchMoveDispatched = 'true'
    void dispatchElementEvent(control, 'catchtouchmove')
  }
}, { passive: false })

function showError(error) {
  document.body.dataset.qaStatus = 'error'
  errorElement.textContent = String(error && error.stack || error)
  document.documentElement.dataset.qaReady = 'error'
}

async function main() {
  try {
    await installProductionStyles()
    const params = new URLSearchParams({ case: caseName, viewportHeight: String(innerHeight), viewportWidth: String(innerWidth) })
    fixture = await api(`/__fixture?${params}`)
    state = fixture.state
    await render()
    if (query.get('unit') === 'cabinet') {
      const unitPickers = [...app.querySelectorAll('[data-wx-range]')]
      const target = unitPickers[1]
      if (target) {
        const response = await api('/__event', { sessionId: fixture.sessionId, handler: 'onUnitChange', detail: { value: 2 } })
        state = response.state
        await render()
      }
    }
    if (caseName === 'report' || caseName === 'viewer') await startReport()
    if (caseName === 'viewer') {
      const image = app.querySelector('[data-qa-bindtap="previewReportImage"]')
      if (image) await dispatchElementEvent(image, 'bindtap')
    }
    window.__ledQaReady = true
    window.__ledQaState = () => state
  } catch (error) { showError(error) }
}

main()

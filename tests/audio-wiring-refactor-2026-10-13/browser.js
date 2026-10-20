'use strict'

const query = new URLSearchParams(location.search)
const viewportWidth = Number(query.get('width')) || 390
const viewportHeight = Number(query.get('height')) || 844
const theme = query.get('theme') === 'dark' ? 'dark' : 'light'
const fontScale = Number(query.get('fontScale')) || 1
const app = document.getElementById('app')
let page, definition, wxml, sources, cached = {}, rendering = false, restoringFocus = false, themeHandler
// Persist only this explicitly named QA session, so a reload can verify the production reset restore path.
const storageKey = `wiring-ui-qa:${query.get('session') || query.get('case') || 'default'}:${theme}:${viewportWidth}`
let storedEntries = []
try { storedEntries = JSON.parse(sessionStorage.getItem(storageKey) || '[]') } catch (_error) {}
const storage = new Map(storedEntries)
const persistQaStorage = () => sessionStorage.setItem(storageKey, JSON.stringify([...storage]))
const effects = { toasts: [], clipboard: [], writes: [], saves: [], shares: [] }
const nativeContexts = new Map()
const nativeImages = new Map()
const evaluate = (source, scope) => Function('scope', `with(scope){return (${String(source).replace(/^\{\{\s*|\s*\}\}$/g, '')})}`)(scope)
const interpolate = (source, scope) => String(source).replace(/\{\{([\s\S]*?)\}\}/g, (_match, expression) => { const value = evaluate(expression, scope); return value == null ? '' : String(value) })

function error(reason) {
  document.body.dataset.error = 'true'
  document.getElementById('qa-error').textContent = String(reason.stack || reason)
}
addEventListener('error', (event) => error(event.error || event.message))
addEventListener('unhandledrejection', (event) => error(event.reason))
function toast(title) {
  effects.toasts.push(title)
  document.getElementById('qa-message')?.remove()
  const element = document.createElement('div')
  element.id = 'qa-message'; element.textContent = title; document.body.append(element)
  setTimeout(() => element.remove(), 1600)
}
function nativeDialog(options, choices) {
  document.getElementById('qa-native')?.remove()
  const mask = document.createElement('div'); mask.id = 'qa-native'
  const sheet = document.createElement('section'); mask.append(sheet)
  const title = document.createElement('h3'); title.textContent = options.title || '选择项目'; sheet.append(title)
  if (options.content) { const copy = document.createElement('p'); copy.textContent = options.content; sheet.append(copy) }
  let input
  if (options.editable) { input = document.createElement('input'); input.placeholder = options.placeholderText || ''; sheet.append(input) }
  choices.forEach(([label, complete]) => { const button = document.createElement('button'); button.textContent = label; button.onclick = () => { mask.remove(); complete(input?.value || ''); render() }; sheet.append(button) })
  document.body.append(mask)
}
function rpx(source) {
  return String(source).split(/(url\([^)]*\))/gi).map((part) => /^url\(/i.test(part) ? part : part
    .replace(/(-?(?:\d+\.?\d*|\.\d+))rpx\b/g, (_match, value) => `${Number(value) * viewportWidth / 750}px`)
    .replace(/(font-size\s*:\s*)([\d.]+)px/g, (_match, prefix, value) => `${prefix}${Number(value) * fontScale}px`)).join('')
}
async function css(url, seen = []) {
  const target = new URL(url, location.origin)
  if (seen.includes(target.pathname)) throw new Error('CSS import cycle')
  let source = await fetch(target.pathname).then((response) => response.text())
  for (const [tag, file] of [...source.matchAll(/@import\s+"([^"]+)"\s*;/g)]) source = source.replace(tag, await css(new URL(file, target), [...seen, target.pathname]))
  source = source.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g, theme === 'dark' ? '@media all' : '@media not all')
  return source
}
async function expand(url) {
  const target = new URL(url, location.origin)
  let source = await fetch(target.pathname).then((response) => response.text())
  for (const [tag, file] of [...source.matchAll(/<include\s+src="([^"]+)"\s*\/>/g)]) source = source.replace(tag, await expand(new URL(file, target)))
  return source
}
function addChildren(source, target, scope) {
  let matched = null
  for (const child of source.childNodes) {
    if (child.nodeType === 3) { if (child.textContent.trim()) target.append(document.createTextNode(interpolate(child.textContent, scope))); continue }
    if (child.nodeType !== 1) continue
    if (child.hasAttribute('wx:if')) { matched = Boolean(evaluate(child.getAttribute('wx:if'), scope)); if (matched) element(child, target, scope); continue }
    if (child.hasAttribute('wx:elif')) { if (!matched && evaluate(child.getAttribute('wx:elif'), scope)) { matched = true; element(child, target, scope) } continue }
    if (child.hasAttribute('wx:else')) { if (!matched) element(child, target, scope); matched = true; continue }
    matched = null; element(child, target, scope)
  }
}
function element(source, target, scope) {
  if (source.hasAttribute('wx:for')) {
    const values = evaluate(source.getAttribute('wx:for'), scope)
    const item = source.getAttribute('wx:for-item') || 'item'
    const indexKey = source.getAttribute('wx:for-index') || 'index'
    values.forEach((value, index) => { const clone = source.cloneNode(true); clone.removeAttribute('wx:for'); element(clone, target, { ...scope, [item]: value, [indexKey]: index }) })
    return
  }
  const tag = source.tagName.toLowerCase()
  if (tag === 'block') return addChildren(source, target, scope)
  const node = document.createElement(({ 'scroll-view': 'div', image: 'img' })[tag] || tag)
  for (const { name, value } of source.attributes) {
    if (name.startsWith('wx:')) continue
    if (['scroll-y', 'scroll-x'].includes(name)) { node.dataset[name === 'scroll-y' ? 'scrollY' : 'scrollX'] = value.includes('{{') ? String(evaluate(value, scope)) : 'true'; continue }
    if (name.startsWith('bind') || name.startsWith('catch')) { node.dataset[name.replace(':', '')] = value; continue }
    if (['disabled', 'hidden', 'checked'].includes(name)) { if (value.includes('{{') ? evaluate(value, scope) : value !== 'false') node.setAttribute(name, ''); continue }
    node.setAttribute(name, name === 'style' ? rpx(interpolate(value, scope)) : interpolate(value, scope))
  }
  if (tag === 'image') node.alt = ''
  if (tag === 'canvas') node.createImage = () => new Image()
  if (tag === 'input' || tag === 'textarea') node.value = interpolate(source.getAttribute('value') || '', scope)
  target.append(node)
  if (!['img', 'input', 'textarea', 'canvas'].includes(node.tagName.toLowerCase())) addChildren(source, node, scope)
}
function render() {
  if (!wxml || !page || rendering) return
  rendering = true
  const active = app.contains(document.activeElement) ? document.activeElement : null
  const focus = active?.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null
  const previousInputs = new Map([...app.querySelectorAll('input[id],textarea[id]')].map((node) => [node.id, node]))
  const previousCanvases = new Map([...app.querySelectorAll('canvas[id]')].map((node) => [node.id, node]))
  const scrolls = [...app.querySelectorAll('[data-scroll-y]')].map((node) => [node.className, node.scrollTop])
  const parsed = new DOMParser().parseFromString(`<body>${wxml}</body>`, 'text/html')
  const fragment = document.createDocumentFragment()
  addChildren(parsed.body, fragment, page.data)
  // wx.setData updates input attributes in place. Keep the same input node during focus/input
  // updates so browser automation observes the real miniapp focus behavior, rather than a replaced token.
  fragment.querySelectorAll('input[id],textarea[id]').forEach((nextInput) => {
    const previous = previousInputs.get(nextInput.id)
    if (!previous || previous.tagName !== nextInput.tagName) return
    for (const attribute of [...previous.attributes]) if (!nextInput.hasAttribute(attribute.name)) previous.removeAttribute(attribute.name)
    for (const attribute of [...nextInput.attributes]) if (previous.getAttribute(attribute.name) !== attribute.value) previous.setAttribute(attribute.name, attribute.value)
    if (previous.value !== nextInput.value) previous.value = nextInput.value
    nextInput.replaceWith(previous)
  })
  // The miniapp retains its Canvas node between setData calls; keep image objects on that node valid.
  fragment.querySelectorAll('canvas[id]').forEach((nextCanvas) => {
    const previous = previousCanvases.get(nextCanvas.id)
    if (!previous) return
    for (const attribute of [...previous.attributes]) if (!nextCanvas.hasAttribute(attribute.name)) previous.removeAttribute(attribute.name)
    for (const attribute of [...nextCanvas.attributes]) if (previous.getAttribute(attribute.name) !== attribute.value) previous.setAttribute(attribute.name, attribute.value)
    nextCanvas.replaceWith(previous)
  })
  app.replaceChildren(fragment)
  scrolls.forEach(([name, top]) => { [...app.querySelectorAll('[data-scroll-y]')].find((node) => node.className === name)?.scrollTo(0, top) })
  if (focus) {
    const replacement = document.getElementById(focus.id)
    if (replacement && ['INPUT', 'TEXTAREA'].includes(replacement.tagName)) {
      restoringFocus = true
      replacement.focus({ preventScroll: true })
      if (focus.start !== null) replacement.setSelectionRange(focus.start, focus.end)
      restoringFocus = false
    }
  }
  rendering = false
  requestAnimationFrame(() => page.renderDiagram())
}
function nativeContext(canvas) {
  const context = canvas.getContext('2d')
  const drawImage = context.drawImage.bind(context)
  context.drawImage = (resource, ...args) => {
    const image = typeof resource === 'string' ? nativeImages.get(resource) : resource
    if (!image) throw new Error(`QA image was not prepared: ${resource}`)
    return drawImage(image, ...args)
  }
  context.setFillStyle = (value) => { context.fillStyle = value }
  context.setStrokeStyle = (value) => { context.strokeStyle = value }
  context.setLineWidth = (value) => { context.lineWidth = value }
  context.setFontSize = (value) => { context.font = `${value}px sans-serif` }
  context.setTextAlign = (value) => { context.textAlign = value }
  context.setTextBaseline = (value) => { context.textBaseline = value }
  context.draw = (_reserve, callback) => setTimeout(() => callback?.(), 0)
  return context
}
window.wx = {
  getWindowInfo: () => ({ windowWidth: viewportWidth, windowHeight: viewportHeight, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: viewportWidth, windowHeight: viewportHeight, pixelRatio: 2, theme }),
  getAppBaseInfo: () => ({ theme }), onThemeChange: (handler) => { themeHandler = handler }, offThemeChange() {},
  getStorageSync: (key) => { if (query.get('case') === 'storage-failure' && key === 'audioWiringPreferencesV1') throw new Error('QA storage read failed'); return storage.get(key) },
  setStorageSync: (key, value) => {
    if (query.get('case') === 'reset-write-failure' && key === 'audioWiringPreferencesV1') throw new Error('QA reset write failed')
    storage.set(key, JSON.parse(JSON.stringify(value))); effects.writes.push(key); persistQaStorage()
  },
  getStorageInfoSync: () => ({ currentSize: 0, limitSize: 10240 }), removeStorageSync: (key) => { storage.delete(key); persistQaStorage() },
  vibrateShort() {}, showLoading() {}, hideLoading() {}, hideKeyboard() {}, nextTick: (callback) => setTimeout(callback, 0),
  showToast: ({ title }) => toast(title),
  getImageInfo(options) {
    const source = options.src
    const ready = nativeImages.get(source)
    const success = (image) => options.success?.({ path: source, width: image.naturalWidth, height: image.naturalHeight })
    if (ready) { success(ready); return }
    const image = new Image()
    image.onload = () => { nativeImages.set(source, image); success(image) }
    image.onerror = () => options.fail?.({ errMsg: 'QA image load failed' })
    image.src = source
  },
  setClipboardData: ({ data, success }) => { effects.clipboard.push(data); success?.() },
  previewImage: ({ current }) => nativeDialog({ title: '原图（浏览器模拟）' }, [['关闭', () => {}]]) || current,
  saveImageToPhotosAlbum: (options) => { effects.saves.push(options.filePath); options.success?.() },
  showShareImageMenu: (options) => { effects.shares.push(options.path); toast('调用微信分享（浏览器模拟）') },
  showActionSheet: (options) => nativeDialog({}, [...options.itemList.map((label, index) => [label, () => options.success?.({ tapIndex: index })]), ['取消', () => options.fail?.({ errMsg: 'cancel' })]]),
  showModal: (options) => nativeDialog(options, [[options.confirmText || '确定', (content) => options.success?.({ confirm: true, content })], [options.cancelText || '取消', () => options.success?.({ confirm: false })]]),
  createSelectorQuery() {
    const selections = []
    let selected
    const queryApi = {
      in() { return this },
      select(selector) { selected = { selector, callback: null }; selections.push(selected); return this },
      fields(options, callback) { selected.options = options; selected.callback = callback; return this },
      boundingClientRect(callback) { selected.callback = callback; return this },
      exec(callback) {
        const results = selections.map((item) => {
          const node = app.querySelector(item.selector), rect = node?.getBoundingClientRect()
          const value = node ? { node, width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, dataset: node.dataset } : null
          if (node && item.options?.computedStyle) {
            const computed = getComputedStyle(node)
            item.options.computedStyle.forEach((key) => { value[key] = computed[key] })
          }
          item.callback?.(value)
          return value
        })
        callback?.(results)
      },
    }
    return queryApi
  },
  createCanvasContext(id) {
    const canvas = document.createElement('canvas'); canvas.width = page.data.resultReportCanvasWidth; canvas.height = page.data.resultReportCanvasHeight
    nativeContexts.set(id, canvas); return nativeContext(canvas)
  },
  canvasToTempFilePath(options) { const canvas = nativeContexts.get(options.canvasId); const image = canvas.toDataURL('image/png'); window.__wiringQaReport = { width: canvas.width, height: canvas.height }; options.success?.({ tempFilePath: image }) },
}
window.Page = (value) => { definition = value }
window.getCurrentPages = () => page ? [page] : []
function requireModule(file) {
  if (cached[file]) return cached[file].exports
  const module = { exports: {} }; cached[file] = module
  const relativeRequire = (target) => {
    const parts = file.split('/'); parts.pop()
    for (const part of target.split('/')) { if (part === '..') parts.pop(); else if (part !== '.') parts.push(part) }
    let resolved = parts.join('/'); if (!/\.js$/.test(resolved)) resolved += '.js'
    return requireModule(resolved)
  }
  if (!sources[file]) throw new Error(`QA module unavailable: ${file}`)
  Function('require', 'module', 'exports', sources[file])(relativeRequire, module, module.exports)
  return module.exports
}
app.addEventListener('click', (event) => {
  if (event.target.id === 'wiringDiagramCanvas' && page.onDiagramTouchStart) {
    const touch = { x: event.offsetX, y: event.offsetY }
    page.onDiagramTouchStart({ touches: [touch] })
    page.onDiagramTouchEnd({ changedTouches: [touch] })
    return
  }
  let target = event.target
  while (target && target !== app) {
    if (target.disabled) return
    const handler = target.dataset.catchtap || target.dataset.bindtap
    if (handler) { if (typeof page[handler] === 'function') page[handler]({ currentTarget: { dataset: target.dataset }, detail: {} }); return }
    target = target.parentElement
  }
})
for (const [eventName, attribute] of [['input', 'bindinput'], ['focus', 'bindfocus'], ['blur', 'bindblur']]) {
  app.addEventListener(eventName, (event) => {
    if (rendering || restoringFocus) return
    const target = event.target, handler = target.dataset[attribute]
    if (typeof page?.[handler] === 'function') page[handler]({
      currentTarget: { dataset: target.dataset }, detail: { value: target.value }, timeStamp: event.timeStamp,
    })
  }, true)
}
async function main() {
  const graph = await fetch('/modules').then((response) => response.json()); sources = graph.modules
  document.documentElement.dataset.loadedProductionHashes = JSON.stringify(graph.hashes)
  for (const url of ['/app.wxss', '/pages/audio-wiring/index.wxss']) { const style = document.createElement('style'); style.textContent = rpx(await css(url)); document.head.append(style) }
  wxml = (await expand('/pages/audio-wiring/index.wxml')).replace(/<(canvas|textarea)([^>]*)\/>/g, '<$1$2></$1>')
  if (query.get('case') === 'restored' && !storage.has('audioWiringPreferencesV1')) storage.set('audioWiringPreferencesV1', { version: 1, outputId: 'xlrBalanced', inputId: 'rcaMono', manualSelected: { output: true, input: true }, viewMode: 'connectors', face: 'solder' })
  const readyPairs = { xlr: ['xlrBalanced', 'xlrBalanced'], trs: ['trsBalanced', 'trsBalanced'], stereo: ['stereo35', 'rcaStereo'], terminals: ['terminalBalanced', 'terminalBalanced'] }
  if (readyPairs[query.get('case')] && !storage.has('audioWiringPreferencesV1')) {
    const [outputId, inputId] = readyPairs[query.get('case')]
    storage.set('audioWiringPreferencesV1', { version: 1, outputId, inputId, manualSelected: { output: true, input: true }, viewMode: 'wiring', face: 'mating' })
  }
  requireModule('pages/audio-wiring/index.js')
  page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch)
    if (Object.keys(patch).every((key) => ['projectFocusEpisode', 'projectFocusedInputId'].includes(key))) {
      app.querySelectorAll('input[data-focus-episode],textarea[data-focus-episode]').forEach((input) => {
        input.dataset.focusEpisode = String(page.data.projectFocusEpisode)
      })
    } else render()
    callback?.()
  }
  page.onLoad(); page.onShow(); page.onReady(); render()
  const records = requireModule('utils/records.js')
  if (!records.getProjects().length) { records.createProject('会议室 A'); records.createProject('礼堂 B') }
  window.__wiringQa = { page, storage, effects, records, hashes: graph.hashes, theme, fontScale, browserSimulation: true }
  document.documentElement.dataset.qaReady = 'true'
}
main().catch(error)

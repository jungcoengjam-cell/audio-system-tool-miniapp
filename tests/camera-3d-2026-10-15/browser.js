const moduleCache = new Map()
const browserStubs = {
  '../../utils/haptics': { vibrate() {} },
  '../../utils/performance': { startMeasurement: () => () => {} },
  '../../utils/report-canvas': { drawAndExportReport() {} },
  '../../utils/result-report': { REPORT_CANVAS_ID: 'resultReportCanvas' },
}
async function productionModule(url) {
  if (moduleCache.has(url)) return moduleCache.get(url)
  const source = await fetchText(url)
  const dependencies = new Map()
  for (const [, name] of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    if (name in browserStubs) dependencies.set(name, browserStubs[name])
    else {
      const dependency = new URL(name + (name.endsWith('.js') ? '' : '.js'), new URL(url, location.origin)).pathname
      dependencies.set(name, await productionModule(dependency))
    }
  }
  const loaded = { exports: {} }
  Function('require', 'module', 'exports', source)((name) => dependencies.get(name), loaded, loaded.exports)
  moduleCache.set(url, loaded.exports)
  return loaded.exports
}

function instrument(raw, labels, opticalFills) {
  let points = []
  return new Proxy(raw, {
    get(target, key) {
      if (key === 'beginPath') return () => { points = []; target.beginPath() }
      if (key === 'moveTo' || key === 'lineTo') return (...args) => { points.push(args); target[key](...args) }
      if (key === 'fill') return (...args) => {
        if (/rgba\((38, 152, 236|173, 115, 241|140, 83, 205),/.test(target.fillStyle)) opticalFills.push({ color: target.fillStyle, points: [...points] })
        return target.fill(...args)
      }
      if (key === 'fillText') return (value, x, y, ...rest) => {
        const width = target.measureText(String(value)).width
        const size = Number(target.font.match(/([\d.]+)px/)?.[1]) || 12
        const left = target.textAlign === 'center' ? x - width / 2 : target.textAlign === 'right' ? x - width : x
        labels.push({ text: String(value), left, right: left + width, top: y - size, bottom: y + 2, size })
        return target.fillText(value, x, y, ...rest)
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, key, value) { return Reflect.set(target, key, value, target) },
  })
}

function legacyContext(raw) {
  const mapped = { setFillStyle: (v) => { raw.fillStyle = v }, setStrokeStyle: (v) => { raw.strokeStyle = v },
    setLineWidth: (v) => { raw.lineWidth = v }, setTextAlign: (v) => { raw.textAlign = v },
    setFontSize: (v) => { raw.font = `${v}px sans-serif` } }
  return new Proxy(raw, { get(target, key) { if (key in mapped) return mapped[key]; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value },
    set(target, key, value) { return Reflect.set(target, key, value, target) } })
}

const rect = (element) => {
  if (!element) return null
  const box = element.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }
}
function draw() {
  const canvas = app.querySelector('#cameraFovCanvas')
  let labels = [], opticalFills = [], background = null
  if (canvas && fixture.state.result) {
    const box = canvas.getBoundingClientRect()
    canvas.width = Math.round(box.width * 2); canvas.height = Math.round(box.height * 2)
    const raw = canvas.getContext('2d', { alpha: false }); raw.scale(2, 2)
    renderer.drawPreviewAtSize(renderer.adaptCanvas2dContext(instrument(raw, labels, opticalFills)), fixture.state.result,
      box.width, box.height, 'spatial', fixture.state.theme)
    background = [...raw.getImageData(0, 0, 1, 1).data]
    window.__diagramPng = canvas.toDataURL('image/png')
  }
  const collisions = []
  labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => {
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) collisions.push([a.text, b.text])
  }))
  const controls = ['cameraReset', 'cameraShare', 'cameraFavorite', 'cameraProject'].map((id) => ({ id, ...rect(document.getElementById(id)), disabled: document.getElementById(id)?.disabled }))
  window.__camera3d = { state: fixture.state, labels, collisions, opticalFills, background, controls,
    canvas: rect(canvas), noViewSelector: !document.getElementById('cameraPreviewViewToggle'),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    inputTabs: rect(document.getElementById('cameraInputTabs')), result: rect(document.getElementById('cameraResultHero')) }
  reportElement.textContent = JSON.stringify({ ...window.__camera3d,
    state: { ...fixture.state, resultReportImagePath: Boolean(fixture.state.resultReportImagePath) } })
  return window.__camera3d
}

async function paint() {
  reportElement.removeAttribute('data-ready')
  await renderProductionWxml(fixture.state)
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {})))
  draw()
  const name = `${scenario}-${fixture.state.theme}-${innerWidth}x${innerHeight}-m${fixture.state.result?.marginPercent ?? 'empty'}-d${fixture.state.result?.depthMeters ?? 0}`
  await fetch('/__qa-save', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, type: 'json', data: JSON.parse(reportElement.textContent) }) })
  if (fixture.state.result) await fetch('/__qa-save', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, type: 'png', data: window.__diagramPng }) })
  reportElement.setAttribute('data-ready', 'true')
}
async function dispatch(handler, dataset = {}, detail = {}) {
  const response = await fetch('/__event', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: fixture.sessionId, handler, dataset, detail }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  fixture.state = result.state
  await paint()
  return window.__camera3d
}
window.__cameraDispatch = dispatch
window.__exportReport = async () => {
  if (!fixture.state.isGeneratingResultReport) await dispatch('generateResultReportImage')
  const response = await fetch(`/__report-export-state?sessionId=${fixture.sessionId}`)
  const pending = await response.json()
  if (!response.ok) throw new Error(pending.error)
  const originalDiagram = renderer.drawPreviewAtSize
  let diagramMetrics = null
  renderer.drawPreviewAtSize = (context, result, width, height, ...args) => {
    const labels = []
    let size = 12, align = 'left'
    const tracked = new Proxy(context, { get(target, key) {
      if (key === 'setFontSize') return (value) => { size = value; target.setFontSize(value) }
      if (key === 'setTextAlign') return (value) => { align = value; target.setTextAlign(value) }
      if (key === 'fillText') return (value, x, y) => {
        const width = Number(target.measureText(value))
        const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x
        labels.push({ text: String(value), left, right: left + width, top: y - size, bottom: y + size * 0.25 })
        target.fillText(value, x, y)
      }
      return target[key]
    } })
    originalDiagram(tracked, result, width, height, ...args)
    diagramMetrics = { width, height, labels, minLeft: Math.min(...labels.map((label) => label.left)),
      maxRight: Math.max(...labels.map((label) => label.right)), maxBottom: Math.max(...labels.map((label) => label.bottom)) }
  }
  const report = await productionModule('/pages/camera/camera-report.js')
  const canvas = document.createElement('canvas')
  canvas.width = pending.width
  let context = legacyContext(canvas.getContext('2d'))
  const layout = report.buildCameraReportLayout(context, pending.payload)
  canvas.height = layout.height
  context = legacyContext(canvas.getContext('2d'))
  if (!report.drawCameraReport(context, pending.payload, layout)) throw new Error('Production report drawing failed')
  renderer.drawPreviewAtSize = originalDiagram
  const diagramSection = layout.sections.find((section) => section.type === 'diagram')
  const bounds = { theme: pending.payload.theme, diagram: diagramMetrics,
    rightTextPaddingPx: (diagramMetrics.width - diagramMetrics.maxRight) * 2,
    bottomTextToCardPx: diagramSection.height - 46 - diagramMetrics.maxBottom * 2,
    bottomTextToReportPx: layout.height - diagramSection.y - 46 - diagramMetrics.maxBottom * 2 }
  await fetch('/__qa-save', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${scenario}-${pending.payload.theme}-${innerWidth}x${innerHeight}-report-bounds`, type: 'json', data: bounds }) })
  window.__exportPng = canvas.toDataURL('image/png')
  await fetch('/__qa-save', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${scenario}-${pending.payload.theme}-${innerWidth}x${innerHeight}-export`, type: 'png', data: window.__exportPng }) })
  const completed = await fetch('/__finish-report-export', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: fixture.sessionId, dataUrl: window.__exportPng }) })
  fixture.state = (await completed.json()).state
  await paint()
  return { width: canvas.width, height: canvas.height, theme: pending.payload.theme, views: pending.payload.views }
}
app.addEventListener('click', (event) => {
  const element = event.target.closest('[data-bindtap],[data-catchtap]')
  if (!element || element.disabled) return
  const handler = element.dataset.bindtap || element.dataset.catchtap
  window.__lastAction = dispatch(handler, { ...element.dataset }).then(() => handler === 'generateResultReportImage' ? window.__exportReport() : null)
})
for (const eventName of ['input', 'blur']) app.addEventListener(eventName, (event) => {
  const handler = event.target.dataset[eventName === 'input' ? 'bindinput' : 'bindblur']
  if (handler) window.__lastAction = dispatch(handler, { ...event.target.dataset }, { value: event.target.value })
}, true)

async function start() {
  const response = await fetch(`/__fixture?case=${encodeURIComponent(scenario)}&width=${innerWidth}&height=${innerHeight}&theme=${query.get('theme') || 'light'}&tab=${query.get('tab') || ''}&cameraHeight=${query.get('height') || '2.3'}&targetDepth=${query.get('depth') || '4'}&framingMargin=${query.get('margin') ?? '10'}`)
  fixture = await response.json()
  if (!response.ok) throw new Error(fixture.error)
  await installProductionStyles()
  renderer = await productionModule('/pages/camera/preview-renderer.js')
  await paint()
  document.documentElement.dataset.cameraQaReady = 'true'
}
start().catch((error) => { window.__camera3dError = String(error.stack || error); document.documentElement.dataset.cameraQaReady = 'error' })

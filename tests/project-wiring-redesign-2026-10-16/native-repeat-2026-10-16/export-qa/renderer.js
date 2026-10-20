const params = new URLSearchParams(location.search)

function resolveModule(from, request) {
  const parts = from.split('/')
  parts.pop()
  for (const part of request.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  let name = parts.join('/')
  if (!/\.js$/.test(name)) name += '.js'
  return name
}

function loadModules(sources) {
  const cache = {}
  function load(name) {
    if (cache[name]) return cache[name].exports
    if (!sources[name]) throw Error('Missing browser module ' + name)
    const item = { exports: {} }
    cache[name] = item
    new Function('module', 'exports', 'require', sources[name] + '\n//# sourceURL=/' + name)(
      item, item.exports, request => load(resolveModule(name, request)))
    return item.exports
  }
  return load('pages/project-wiring/report.js')
}

function decodeSchedule(encoded) {
  if (!encoded) return null
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

function canvasAdapter(context) {
  const text = []
  const calls = []
  const proxied = new Proxy(context, {
    get(target, key) {
      if (key === 'setFillStyle') return value => { target.fillStyle = value }
      if (key === 'setStrokeStyle') return value => { target.strokeStyle = value }
      if (key === 'setLineWidth') return value => { target.lineWidth = value }
      if (key === 'setFontSize') return value => { target.font = `${value}px sans-serif` }
      if (key === 'setTextAlign') return value => { target.textAlign = value }
      if (key === 'setTextBaseline') return value => { target.textBaseline = value }
      if (key === 'fillText') return (value, ...args) => {
        text.push(String(value))
        calls.push(['fillText', String(value), ...args])
        return target.fillText(value, ...args)
      }
      const value = target[key]
      return typeof value === 'function' ? (...args) => {
        calls.push([key, ...args])
        return value.apply(target, args)
      } : value
    },
    set(target, key, value) { target[key] = value; return true },
  })
  return { context: proxied, text, calls }
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, '')
}

function measureDrawItems(row, context, pageIndex) {
  const measured = []
  for (const item of row.drawItems || []) {
    const text = String(item.text ?? '')
    context.font = `${item.weight || 400} ${item.fontSize || 16}px sans-serif`
    const metric = context.measureText(text)
    const width = metric.width
    const align = item.align || 'left'
    const x = Number(item.x) || 0
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x
    const right = left + width
    const ascent = metric.actualBoundingBoxAscent || (item.fontSize || 16) * 0.8
    const descent = metric.actualBoundingBoxDescent || (item.fontSize || 16) * 0.2
    const top = item.y - ascent
    const bottom = item.y + descent
    const bounds = item.bounds || { x: row.x, y: row.y, width: row.width, height: row.height }
    const marker = item.fieldId === 'circleLabel'
      ? (row.primitives || []).find(primitive => primitive.kind === 'number-circle')
      : null
    const visualBounds = marker
      ? { x: marker.x, y: marker.y, width: marker.width, height: marker.height }
      : bounds
    measured.push({
      page: pageIndex + 1,
      rowKind: row.kind,
      lineId: row.lineId || null,
      fieldId: item.fieldId || '',
      text,
      x,
      y: item.y,
      align,
      width,
      ink: { left, top, right, bottom },
      bounds: { x: bounds.x, y: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height, width: bounds.width, height: bounds.height },
      visualBounds: { x: visualBounds.x, y: visualBounds.y, right: visualBounds.x + visualBounds.width, bottom: visualBounds.y + visualBounds.height, width: visualBounds.width, height: visualBounds.height },
      rowBounds: { x: row.x, y: row.y, right: row.x + row.width, bottom: row.y + row.height, width: row.width, height: row.height },
      hasExplicitBounds: Boolean(item.bounds),
      font: context.font,
    })
  }
  return measured
}

function findCollisions(items) {
  const collisions = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]
      const intersects = a.ink.left < b.ink.right - 0.5 && b.ink.left < a.ink.right - 0.5
        && a.ink.top < b.ink.bottom - 0.5 && b.ink.top < a.ink.bottom - 0.5
      if (intersects) collisions.push({ a: { fieldId: a.fieldId, text: a.text, ink: a.ink }, b: { fieldId: b.fieldId, text: b.text, ink: b.ink } })
    }
  }
  return collisions
}

async function saveArtifact(type, name, data) {
  const response = await fetch('/__save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, name, data }),
  }).then(result => result.json())
  if (response.error) throw Error(response.error)
  return response
}

async function main() {
  const fixture = params.get('fixture') || 'standard'
  const count = Number(params.get('count')) || 4
  const theme = params.get('theme') || 'light'
  const tab = params.get('tab') || 'none'
  const caseName = params.get('case') || `${fixture}-${count}-${tab}-${theme}`
  const override = decodeSchedule(params.get('schedule64'))
  const [modules, source] = await Promise.all([
    fetch('/__bundle').then(response => response.json()),
    fetch('/__report?' + new URLSearchParams({ fixture, count })).then(response => response.json()),
  ])
  const renderer = loadModules(modules)
  const schedule = override || source.project.wiringSchedule
  const projectName = params.get('projectName') || source.project.name
  const report = renderer.buildScheduleReportPages(projectName, schedule, 'project')
  if (report.type !== 'project' || !Array.isArray(report.pages)) throw Error('Project export API did not return pages')

  const outputs = []
  const pageMetrics = []
  const allLineRows = []
  const allMeasuredItems = []
  const collisions = []
  const overflows = []
  const missingBounds = []
  const rowOverlaps = []
  const missingCanvasDraws = []
  for (let pageIndex = 0; pageIndex < report.pages.length; pageIndex++) {
    const page = report.pages[pageIndex]
    if (page.type !== 'project') throw Error(`Page ${pageIndex + 1} has type ${page.type}`)
    const canvas = document.createElement('canvas')
    canvas.width = page.width
    canvas.height = page.height
    const rawContext = canvas.getContext('2d', { alpha: false })
    const actual = canvasAdapter(rawContext)
    renderer.drawScheduleReport(actual.context, page, { theme })
    const renderedTextCalls = actual.calls.filter(call => call[0] === 'fillText')
    const consumedTextCalls = new Set()
    for (const row of page.rows || []) {
      if (row.kind === 'project-line') allLineRows.push({ pageIndex, row })
      const rowItems = measureDrawItems(row, rawContext, pageIndex)
      allMeasuredItems.push(...rowItems)
      collisions.push(...findCollisions(rowItems).map(item => ({ page: pageIndex + 1, lineId: row.lineId || null, ...item })))
      for (const item of rowItems) {
        if (!item.hasExplicitBounds || item.bounds.width <= 0 || item.bounds.height <= 0) missingBounds.push(item)
        const widthOverflow = item.width > item.visualBounds.width + 1
          || item.ink.left < item.visualBounds.x - 1 || item.ink.right > item.visualBounds.right + 1
        const verticalOverflow = item.ink.top < item.visualBounds.y - 2 || item.ink.bottom > item.visualBounds.bottom + 2
          || item.ink.top < item.rowBounds.y - 1 || item.ink.bottom > item.rowBounds.bottom + 1
        if (widthOverflow || verticalOverflow) overflows.push({ ...item, widthOverflow, verticalOverflow })
        const callIndex = renderedTextCalls.findIndex((call, index) => !consumedTextCalls.has(index)
          && call[1] === item.text && Math.abs(Number(call[2]) - item.x) < 0.51 && Math.abs(Number(call[3]) - item.y) < 0.51)
        if (callIndex < 0) missingCanvasDraws.push({ page: pageIndex + 1, lineId: item.lineId, fieldId: item.fieldId, text: item.text, x: item.x, y: item.y })
        else consumedTextCalls.add(callIndex)
      }
    }
    const orderedRows = [...(page.rows || [])].sort((a, b) => a.y - b.y)
    for (let i = 1; i < orderedRows.length; i++) {
      const previous = orderedRows[i - 1], current = orderedRows[i]
      if (previous.y + previous.height > current.y + 0.5) {
        rowOverlaps.push({ page: pageIndex + 1, previous: { kind: previous.kind, y: previous.y, height: previous.height }, current: { kind: current.kind, y: current.y, height: current.height } })
      }
    }
    const output = await saveArtifact('png', `${caseName}-${pageIndex + 1}`, canvas.toDataURL('image/png'))
    outputs.push({ filename: output.filename, sha256: output.sha256, bytes: output.bytes, width: canvas.width, height: canvas.height, pageNumber: page.pageNumber, pageCount: page.pageCount })
    pageMetrics.push({
      page: pageIndex + 1,
      pageNumber: page.pageNumber,
      pageCount: page.pageCount,
      height: page.height,
      startY: page.startY,
      contentBottom: page.contentBottom,
      rowKinds: (page.rows || []).map(row => row.kind),
      lineIds: (page.rows || []).filter(row => row.kind === 'project-line').map(row => row.lineId),
      rows: (page.rows || []).map(row => ({ kind: row.kind, key: row.key, lineId: row.lineId || null, y: row.y, height: row.height, fields: row.fields || null, primitives: row.primitives || [], drawItems: (row.drawItems || []).map(item => ({ fieldId: item.fieldId || '', text: item.text, x: item.x, y: item.y, align: item.align, fontSize: item.fontSize, bounds: item.bounds })) })),
    })
    document.getElementById('reports').append(canvas)
  }

  const sourceLines = (schedule.lines || []).map(line => ({ id: line.id, ...line }))
  const summary = {
    fixture, count, theme, tab, caseName, projectName,
    renderer: 'Actual pages/project-wiring/report.js buildScheduleReportPages(..., project) + drawScheduleReport on Chromium Canvas2D.',
    limitation: 'Canvas2D adapter only; not WeChat native Canvas/temp-file export or physical-device acceptance.',
    source: source.sources,
    report: { type: report.type, lineCount: report.lineCount, pageCount: report.pages.length, pageWidth: report.pages[0]?.width || 0, title: report.title },
    sourceLines,
    pages: pageMetrics,
    outputs,
    lineRows: allLineRows.map(({ pageIndex, row }) => ({
      page: pageIndex + 1,
      id: row.lineId,
      y: row.y,
      height: row.height,
      groupKey: row.groupKey,
      fields: row.fields || null,
      primitives: row.primitives || [],
      fieldIds: [...new Set((row.drawItems || []).map(item => item.fieldId))],
      drawItems: (row.drawItems || []).map(item => ({ fieldId: item.fieldId, text: item.text, x: item.x, y: item.y, align: item.align, fontSize: item.fontSize, bounds: item.bounds })),
      metrics: allMeasuredItems.filter(item => item.lineId === row.lineId && item.page === pageIndex + 1),
    })),
    quality: { measuredTextItems: allMeasuredItems.length, overflows, collisions, rowOverlaps, missingBounds, missingCanvasDraws },
  }
  const jsonOutput = await saveArtifact('json', caseName, summary)
  window.__exportQa = { ...summary, jsonOutput }
  document.documentElement.dataset.ready = 'true'
  document.getElementById('status').textContent = `Rendered ${report.pages.length} project page(s); ${allLineRows.length} line rows.`
}

main().catch(error => {
  document.documentElement.dataset.error = error.stack || String(error)
  document.getElementById('status').textContent = error.stack || String(error)
})

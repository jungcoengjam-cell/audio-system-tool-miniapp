const params = new URLSearchParams(location.search)
function resolveModule(from, request) { const parts = from.split('/'); parts.pop(); for (const part of request.split('/')) { if (part === '..') parts.pop(); else if (part !== '.') parts.push(part) } let name = parts.join('/'); if (!/\.js$/.test(name)) name += '.js'; return name }
function loadModules(sources) {
  const cache = {}
  function load(name) { if (cache[name]) return cache[name].exports; if (!sources[name]) throw Error('Missing browser module ' + name); const item = { exports: {} }; cache[name] = item; new Function('module', 'exports', 'require', sources[name] + '\n//# sourceURL=/' + name)(item, item.exports, request => load(resolveModule(name, request))); return item.exports }
  return load('pages/project-wiring/report.js')
}
function adapter(context) {
  const text = [], calls = []
  return { text, calls, context: new Proxy(context, { get(target, key) {
    if (key === 'setFillStyle') return value => { target.fillStyle = value }
    if (key === 'setStrokeStyle') return value => { target.strokeStyle = value }
    if (key === 'setLineWidth') return value => { target.lineWidth = value }
    if (key === 'setFontSize') return value => { target.font = `${value}px sans-serif` }
    if (key === 'setTextAlign') return value => { target.textAlign = value }
    if (key === 'setTextBaseline') return value => { target.textBaseline = value }
    if (key === 'fillText') return (value, ...args) => { text.push(String(value)); calls.push(['fillText', String(value), ...args]); return target.fillText(value, ...args) }
    const result = target[key]; return typeof result === 'function' ? (...args) => { calls.push([key, ...args]); return result.apply(target, args) } : result
  }, set(target, key, value) { target[key] = value; return true } }) }
}
async function main() {
  const fixture = params.get('fixture') || 'standard', count = Number(params.get('count')) || 4
  const sourceFixture = params.get('sourceFixture') || fixture
  const [modules, source] = await Promise.all([fetch('/__bundle').then(result => result.json()), fetch('/__report?' + new URLSearchParams({ fixture: sourceFixture, count })).then(result => result.json())])
  const fixtureJson = params.get('fixtureJson')
  if (fixtureJson) source.project = JSON.parse(fixtureJson)
  const actual = loadModules(modules)
  const report = actual.buildScheduleReportPages(source.project.name, source.project.wiringSchedule, 'project')
  if (!Array.isArray(report.pages)) throw Error('Actual report API did not produce pages')
  const outputs = [], drawn = [], measuredItems = [], overflows = [], omittedItems = [], fullFieldMetrics = []
  for (let index = 0; index < report.pages.length; index++) {
    const page = report.pages[index], canvas = document.createElement('canvas'); canvas.width = page.width; canvas.height = page.height
    const rendered = adapter(canvas.getContext('2d', { alpha: false })); actual.drawScheduleReport(rendered.context, page, { theme: params.get('theme') || 'light' })
    drawn.push(...rendered.text)
    for (const row of page.rows || []) for (const item of row.drawItems || []) {
      const context = canvas.getContext('2d'); context.font = `${item.weight || 400} ${item.fontSize}px sans-serif`
      const width = context.measureText(item.text).width
      const measurement = { page: index + 1, kind: row.kind, lineId: row.lineId || null, fieldId: item.fieldId, text: item.text, actualWidth: width, allowedWidth: item.bounds.width, boundsX: item.bounds.x, font: context.font }
      measuredItems.push(measurement)
      if (width > item.bounds.width + 1) overflows.push(measurement)
      if (!rendered.text.includes(String(item.text))) omittedItems.push(measurement)
    }
    for (const row of page.rows || []) if (row.kind === 'project-line') {
      for (const fieldId of ['circleLabel', 'ports', 'spec', 'length', 'connectors']) {
        const item = (row.drawItems || []).find((candidate) => candidate.fieldId === fieldId)
        if (!item) continue
        const context = canvas.getContext('2d'); context.font = `${item.weight || 400} ${item.fontSize}px sans-serif`
        fullFieldMetrics.push({ page: index + 1, lineId: row.lineId, fieldId,
          text: row.fields[fieldId], actualWidth: context.measureText(row.fields[fieldId]).width,
          allowedWidth: item.bounds.width, font: context.font })
      }
    }
    const output = await fetch('/__save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'png', name: `project-${fixture}-${count}-${params.get('theme') || 'light'}-${index + 1}`, data: canvas.toDataURL('image/png') }) }).then(result => result.json())
    if (output.error) throw Error(output.error)
    outputs.push({ ...output, width: canvas.width, height: canvas.height, rowCount: page.rows?.length, drawnText: rendered.text, calls: rendered.calls.length, type: page.type })
    document.getElementById('reports').append(canvas)
  }
  const summary = { renderer: 'Actual pages/project-wiring/report.js on Chromium Canvas2D with legacy API adapter', limitations: 'Not WeChat native Canvas or native temp-file API.', count, fixture, theme: params.get('theme') || 'light', sources: source.sources, report, outputs, drawn, textMetrics: { measuredItems, overflows, omittedItems, fullFieldMetrics } }
  await fetch('/__save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'json', name: `project-${fixture}-${count}-${params.get('theme') || 'light'}`, data: summary }) })
  window.__reportQa = summary; document.documentElement.dataset.ready = 'true'; document.getElementById('status').textContent = `Actual production report: ${outputs.length} PNGs`
}
main().catch(error => { document.documentElement.dataset.error = error.stack; document.getElementById('status').textContent = error.stack })

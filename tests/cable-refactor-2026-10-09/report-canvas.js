const query = new URLSearchParams(location.search)
const reportCase = query.get('case') || 'constant'
const stateName = { constant: 'valid', professional: 'professional', review: 'review' }[reportCase]

async function loadActualModule(url, resolver) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to load production module ${url}`)
  const source = await response.text()
  const loaded = { exports: {} }
  const localRequire = (request) => {
    const dependency = resolver(request)
    if (dependency === undefined) throw new Error(`Unmapped production dependency ${request} from ${url}`)
    return dependency
  }
  new Function('module', 'exports', 'require', `${source}\n//# sourceURL=${url}`)(loaded, loaded.exports, localRequire)
  return loaded.exports
}

function expectedTextLines(layout) {
  const lines = []
  layout.sections.forEach((section) => {
    if (section.type === 'title') lines.push(...section.lines)
    if (section.type === 'main') lines.push(...section.labelLines, ...section.specLines, ...section.descriptionLines)
    if (section.type === 'metrics') {
      section.metrics.forEach((metric) => lines.push(...metric.labelLines, ...metric.valueLines))
    }
    if (section.type === 'parameters') {
      lines.push(...section.titleLines)
      section.parameterRows.forEach((row) => lines.push(...row.labelLines, ...row.valueLines))
    }
    if (section.type === 'warnings') {
      if (section.title) lines.push(section.title)
      lines.push(...section.warningLines.flat())
    }
  })
  return lines
}

function makeCanvasContext(nativeContext) {
  const drawnText = []
  let measureTextCount = 0
  const context = new Proxy(nativeContext, {
    get(target, key) {
      if (key === 'setFillStyle') return (value) => { target.fillStyle = value }
      if (key === 'setStrokeStyle') return (value) => { target.strokeStyle = value }
      if (key === 'setTextAlign') return (value) => { target.textAlign = value }
      if (key === 'setLineWidth') return (value) => { target.lineWidth = value }
      if (key === 'fillText') return (text, ...args) => {
        drawnText.push(String(text))
        return target.fillText(text, ...args)
      }
      if (key === 'measureText') return (text) => {
        measureTextCount += 1
        return target.measureText(text)
      }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
  return { context, drawnText, getMeasureTextCount: () => measureTextCount }
}

async function main() {
  if (!stateName) throw new Error(`Unknown report case: ${reportCase}`)
  const state = await fetch(`/__state?state=${stateName}`, { cache: 'no-store' }).then((response) => response.json())
  const reportDrawing = await loadActualModule('/utils/report-drawing.js', () => undefined)
  const noop = () => {}
  const resolver = (request) => {
    if (request === '../../utils/report-drawing') return reportDrawing
    if (request === '../../utils/haptics') return { vibrate: noop }
    if (request === '../../utils/performance') return { startMeasurement: () => noop }
    if (request === '../../utils/report-canvas') return { drawAndExportReport: noop }
    if (request === '../../utils/report-image-actions') {
      return { previewGeneratedImage: noop, saveGeneratedImage: noop, shareGeneratedImage: noop }
    }
    return undefined
  }
  const cableReport = await loadActualModule('/pages/cable/cable-report.js', resolver)
  const payload = cableReport.buildCableReportPayload(state)
  if (!payload) throw new Error('Actual controller state did not produce a report payload')

  const canvas = document.getElementById('reportCanvas')
  const nativeContext = canvas.getContext('2d', { alpha: false })
  const measured = makeCanvasContext(nativeContext)
  const layout = cableReport.buildCableReportLayout(measured.context, payload)
  canvas.width = 750
  canvas.height = layout.height
  const renderContext = makeCanvasContext(canvas.getContext('2d', { alpha: false }))
  cableReport.drawCableReport(renderContext.context, payload, layout)
  const dataUrl = canvas.toDataURL('image/png')
  document.getElementById('preview').src = dataUrl

  const expectedLines = expectedTextLines(layout)
  const undrawnTextLines = expectedLines.filter((line) => !renderContext.drawnText.includes(String(line)))
  if (undrawnTextLines.length) throw new Error(`Actual report draw omitted layout text: ${undrawnTextLines.join(' | ')}`)
  if (measured.getMeasureTextCount() < 1) throw new Error('Canvas2D measureText was not called by the actual report layout')

  const isConstant = state.modeIndex === 0
  const inputs = {
    mode: state.modes[state.modeIndex].key,
    modeLabel: state.modes[state.modeIndex].label,
    powerText: isConstant ? state.constantPowerText : state.professionalPowerText,
    distanceText: isConstant ? state.constantDistanceText : state.professionalDistanceText,
    environment: isConstant ? state.environments[state.environmentIndex].label : null,
  }
  const artifact = {
    case: reportCase,
    qaServerStartedAt: state.qaServerStartedAt,
    width: canvas.width,
    height: canvas.height,
    imageDataUrl: dataUrl,
    inputs,
    result: state.result,
    payload,
    layout: {
      height: layout.height,
      sections: layout.sections.map((section) => ({
        type: section.type,
        y: section.y,
        height: section.height || null,
        lineCount: section.lines?.flat().length
          || section.specLines?.length
          || section.warningLines?.flat().length
          || section.descriptionLines?.length
          || null,
      })),
      measuredTextCalls: measured.getMeasureTextCount(),
      drawnTextLineCount: renderContext.drawnText.length,
      drawnTextLines: renderContext.drawnText,
      undrawnTextLines,
    },
  }
  const saved = await fetch('/__report-artifact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(artifact),
  })
  if (!saved.ok) throw new Error(`Failed to save rendered report: ${await saved.text()}`)
  const output = await saved.json()
  const summary = {
    case: reportCase,
    inputs,
    result: state.result,
    payload,
    spec: state.result.spec,
    warnings: payload.warnings,
    layout: artifact.layout,
    output,
  }
  document.getElementById('status').textContent = `实际 Canvas2D 绘制完成：${state.result.spec}（${canvas.width} × ${canvas.height}）`
  document.getElementById('result').textContent = JSON.stringify(summary, null, 2)
  window.__reportQa = summary
  document.documentElement.dataset.ready = 'true'
}

main().catch((error) => {
  document.documentElement.dataset.error = String(error)
  document.getElementById('status').textContent = String(error.stack || error)
})

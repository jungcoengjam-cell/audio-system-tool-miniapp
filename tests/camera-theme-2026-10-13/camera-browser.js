'use strict'

const app = document.getElementById('app')
const reportElement = document.getElementById('qa-report')
const query = new URLSearchParams(location.search)
const scenario = query.get('case') || 'ground'
const qaCase = query.get('qaCase') || scenario
const qaAction = query.get('qaAction') || ''
const wxssPaths = new Set()
const wxssSources = []
const checks = []
const failures = []
let expectedInputTabIndex = query.has('tab') ? Number(query.get('tab')) : null
const urlToken = /(url\(\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^)]*)\s*\))/gi
let fixture = null
let renderer = null
let reportDrawResult = null
let reportRendererCalls = []
let lastHeroMeasurement = null
let resultHeightSelector = '#cameraResultHero'
document.documentElement.dataset.cameraQaReady = 'working'
document.body.dataset.qaStatus = 'working'

function record(name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail })
  if (!passed) failures.push({ name, detail })
}

function convertRpx(source, width = innerWidth, fontScale = 1) {
  const scale = width / 750
  const fontScaled = String(source).replace(/(font-size\s*:\s*)(-?(?:\d+\.?\d*|\.\d+))\s*(px|rpx)\b/gi,
    (_match, prefix, raw, unit) => `${prefix}${Number((Number(raw) * fontScale).toFixed(5))}${unit}`)
  return fontScaled.split(urlToken).map((part) => {
    if (/^url\(/i.test(part)) return part
    return part.replace(/(-?(?:\d+\.?\d*|\.\d+)\s*)rpx\b/g, (_match, raw) => `${Number((Number.parseFloat(raw) * scale).toFixed(5))}px`)
  }).join('')
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`)
  return response.text()
}

async function expandedWxss(url, ancestors = []) {
  const target = new URL(url, location.origin)
  if (ancestors.includes(target.pathname)) throw new Error(`WXSS import cycle at ${target.pathname}`)
  wxssPaths.add(target.pathname)
  let css = await fetchText(target.pathname)
  const imports = [...css.matchAll(/@import\s+(?:url\()?(["'])(.*?)\1\)?\s*[^;]*;/g)]
  for (const [directive, _quote, childPath] of imports) {
    css = css.replace(directive, await expandedWxss(new URL(childPath, target).href, [...ancestors, target.pathname]))
  }
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, quote, assetPath) => {
    const asset = assetPath.trim()
    if (/^(?:data:|https?:|\/|#)/i.test(asset)) return full
    return `url("${new URL(asset, target).href}")`
  })
}

async function installProductionStyles() {
  const theme = query.get('theme') === 'dark' ? 'dark' : 'light'
  const darkMedia = theme === 'dark' ? '@media (min-width: 0px)' : '@media (max-width: 0px)'
  const lightMedia = theme === 'dark' ? '@media (max-width: 0px)' : '@media (min-width: 0px)'
  document.documentElement.dataset.cameraQaStyleThemeBridge = `query:${theme}-to-media-width`
  for (const url of ['/app.wxss', '/pages/camera/camera.wxss']) {
    const source = await expandedWxss(url)
    const style = document.createElement('style')
    style.dataset.productionSource = url
    style.textContent = convertRpx(source, innerWidth, Number(query.get('zoom')) || 1)
      .replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, darkMedia)
      .replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, lightMedia)
    document.head.append(style)
    wxssSources.push({ url, source, styleThemeBridge: `query:${theme}-to-media-width` })
  }
  const scrollCompatibility = document.createElement('style')
  scrollCompatibility.textContent = 'div[data-wx-scroll-y="true"]{overflow-y:auto!important;-webkit-overflow-scrolling:touch}div[data-wx-scroll-x="true"]{overflow-x:auto!important}block{display:contents!important}'
  document.head.append(scrollCompatibility)
}

function evaluate(expression, scope) {
  try { return Function('scope', `with(scope){return (${String(expression).replace(/^\{\{\s*|\s*\}\}$/g, '').trim()})}`)(scope) }
  catch (_error) { return '' }
}

function interpolate(source, scope) {
  return String(source).replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression) => {
    const value = evaluate(expression, scope)
    return value === undefined || value === null ? '' : String(value)
  })
}

function conditionValue(expression, scope) { return expression === null || expression === '' || Boolean(evaluate(expression, scope)) }

async function expandWxmlIncludes(url, ancestors = []) {
  const target = new URL(url, location.origin)
  if (ancestors.includes(target.pathname)) throw new Error(`WXML include cycle at ${target.pathname}`)
  let source = await fetchText(target.pathname)
  const includePattern = /<include\s+src="([^"]+)"\s*\/>/i
  while (includePattern.test(source)) {
    const match = source.match(includePattern)
    const child = new URL(match[1], target)
    const included = await expandWxmlIncludes(child.href, [...ancestors, target.pathname])
    source = source.replace(match[0], included)
  }
  return source
}

function appendChildren(sourceParent, targetParent, scope) {
  let branch = null
  for (const sourceNode of [...sourceParent.childNodes]) {
    if (sourceNode.nodeType === Node.TEXT_NODE) {
      if (sourceNode.textContent.trim()) targetParent.append(document.createTextNode(interpolate(sourceNode.textContent, scope)))
      continue
    }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE) continue
    const condition = sourceNode.getAttribute('wx:if')
    const alternate = sourceNode.getAttribute('wx:elif')
    const otherwise = sourceNode.hasAttribute('wx:else')
    if (condition !== null) {
      branch = { matched: conditionValue(condition, scope) }
      if (branch.matched) renderElement(sourceNode, scope, targetParent)
      continue
    }
    if (alternate !== null) {
      if (branch && !branch.matched && conditionValue(alternate, scope)) {
        branch.matched = true
        renderElement(sourceNode, scope, targetParent)
      }
      continue
    }
    if (otherwise) {
      if (branch && !branch.matched) {
        branch.matched = true
        renderElement(sourceNode, scope, targetParent)
      }
      continue
    }
    branch = null
    renderElement(sourceNode, scope, targetParent)
  }
}

function renderElement(sourceElement, scope, targetParent) {
  const loop = sourceElement.getAttribute('wx:for')
  if (loop !== null) {
    const items = evaluate(loop, scope)
    const itemName = sourceElement.getAttribute('wx:for-item') || 'item'
    const indexName = sourceElement.getAttribute('wx:for-index') || 'index'
    ;(Array.isArray(items) ? items : []).forEach((item, index) => {
      const copy = sourceElement.cloneNode(true)
      copy.removeAttribute('wx:for')
      copy.removeAttribute('wx:for-item')
      copy.removeAttribute('wx:for-index')
      copy.removeAttribute('wx:key')
      renderElement(copy, { ...scope, [itemName]: item, [indexName]: index }, targetParent)
    })
    return
  }

  const sourceName = sourceElement.tagName.toLowerCase()
  const elementName = { view: 'div', 'scroll-view': 'div', picker: 'div', image: 'img', block: 'block' }[sourceName] || sourceName
  const output = document.createElement(elementName)
  if (sourceName === 'scroll-view') {
    if (sourceElement.hasAttribute('scroll-y')) output.dataset.wxScrollY = 'true'
    if (sourceElement.hasAttribute('scroll-x')) output.dataset.wxScrollX = 'true'
  }
  if (sourceName === 'block') output.style.display = 'contents'
  for (const attribute of [...sourceElement.attributes]) {
    const key = attribute.name
    if (key.startsWith('wx:') || ['range', 'range-key', 'enhanced', 'show-scrollbar'].includes(key)) continue
    if (key.startsWith('bind') || key.startsWith('catch')) {
      output.dataset[key] = attribute.value
      continue
    }
    const value = interpolate(attribute.value, scope)
    if (key === 'value' && ['input', 'textarea'].includes(sourceName)) {
      output.value = value
      continue
    }
    if (key === 'disabled' && value === 'false') continue
    if (key === 'type' && sourceName === 'input' && value === 'digit') {
      output.setAttribute('type', 'text')
      continue
    }
    if (key === 'scroll-y' || key === 'scroll-x') continue
    if (sourceName === 'image' && key === 'mode') {
      if (value === 'aspectFit') { output.style.objectFit = 'contain'; output.style.objectPosition = 'center' }
      continue
    }
    output.setAttribute(key, key === 'style' ? convertRpx(value) : value)
  }
  if (sourceName === 'image' && !output.hasAttribute('alt')) output.setAttribute('alt', '图片')
  targetParent.append(output)
  if (!['input', 'textarea', 'img'].includes(output.tagName.toLowerCase())) appendChildren(sourceElement, output, scope)
}

async function renderProductionWxml(state) {
  let source = await expandWxmlIncludes('/pages/camera/camera.wxml')
  source = source.replace(/<(textarea|canvas)(\s[^<>]*?)\s*\/>/gi, '<$1$2></$1>')
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  if (parsed.querySelector('parsererror')) throw new Error('Camera WXML bridge could not parse production WXML')
  app.replaceChildren()
  appendChildren(parsed.body, app, state)
}

async function loadProductionRenderer() {
  const source = await fetchText('/pages/camera/preview-renderer.js')
  const moduleValue = { exports: {} }
  Function('module', 'exports', source)(moduleValue, moduleValue.exports)
  renderer = moduleValue.exports
}

async function loadProductionReportRenderer() {
  if (!renderer) await loadProductionRenderer()
  const reportDrawingSource = await fetchText('/utils/report-drawing.js')
  const drawingModule = { exports: {} }
  Function('module', 'exports', reportDrawingSource)(drawingModule, drawingModule.exports)
  const reportSource = await fetchText('/pages/camera/camera-report.js')
  const reportModule = { exports: {} }
  const realDrawPreviewAtSize = renderer.drawPreviewAtSize
  reportRendererCalls = []
  renderer.drawPreviewAtSize = (...args) => {
    reportRendererCalls.push({ width: args[2], height: args[3], viewKey: args[4] })
    return realDrawPreviewAtSize.apply(renderer, args)
  }
  const productionRequire = (name) => {
    if (name === '../../utils/haptics') return { vibrate: () => {} }
    if (name === '../../utils/performance') return { startMeasurement: () => ({ end: () => {} }) }
    if (name === '../../utils/report-canvas') return { drawAndExportReport: () => {} }
    if (name === '../../utils/result-report') return { REPORT_CANVAS_ID: 'resultReportCanvas' }
    if (name === '../../utils/report-drawing') return drawingModule.exports
    if (name === './preview-renderer') return renderer
    throw new Error(`Unexpected production camera report module dependency: ${name}`)
  }
  Function('require', 'module', 'exports', reportSource)(productionRequire, reportModule, reportModule.exports)
  reportDrawResult = reportModule.exports.drawCameraReport
}

function adaptLegacyReportContext(raw, onTextDraw = null) {
  const mapped = {
    setFillStyle: (value) => { raw.fillStyle = value },
    setStrokeStyle: (value) => { raw.strokeStyle = value },
    setLineWidth: (value) => { raw.lineWidth = value },
    setTextAlign: (value) => { raw.textAlign = value },
    setFontSize: (value) => { raw.font = `${value}px sans-serif` },
  }
  return new Proxy(raw, {
    get(target, key) {
      if (key in mapped) return mapped[key]
      if (key === 'fillText' && typeof onTextDraw === 'function') {
        return (...args) => {
          onTextDraw(String(args[0] ?? ''))
          return target.fillText(...args)
        }
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, key, value) { return Reflect.set(target, key, value, target) },
  })
}

async function findProductionResultHeightSelector() {
  const source = await fetchText('/pages/camera/camera.js')
  const method = source.match(/captureResultHeroHeight\s*\(\)\s*\{([\s\S]*?)(?=\n\s{2,}[A-Za-z_$][\w$]*\s*\(|\n\s{2,\.\.\.)/)
  const selected = method?.[1]?.match(/query\.select\(['"](#[A-Za-z][A-Za-z0-9_-]*)['"]\)/)
  if (selected) resultHeightSelector = selected[1]
}

function drawProductionCanvas(state) {
  const canvas = app.querySelector('#cameraFovCanvas')
  if (!canvas || !state.result) return null
  const bounds = canvas.getBoundingClientRect()
  const dpr = 2
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  const raw = canvas.getContext('2d', { alpha: false })
  raw.scale(dpr, dpr)
  const textLabels = []
  const textPlates = []
  const geometryPaths = []
  const cameraRects = []
  let currentPath = []
  let pathClosed = false
  let pendingPlate = null
  let pendingClipRect = null
  let activeClipRect = null
  const clipStack = []
  const pathBounds = () => {
    if (currentPath.length < 2) return null
    const xs = currentPath.map((point) => point[0])
    const ys = currentPath.map((point) => point[1])
    return {
      left: Math.min(...xs), top: Math.min(...ys),
      right: Math.max(...xs), bottom: Math.max(...ys),
    }
  }
  const appendArcPoints = (cx, cy, radius, startAngle, endAngle, anticlockwise) => {
    const tau = Math.PI * 2
    let sweep = endAngle - startAngle
    if (anticlockwise) {
      if (sweep <= -tau) sweep = -tau
      else { sweep %= tau; if (sweep > 0) sweep -= tau }
    } else {
      if (sweep >= tau) sweep = tau
      else { sweep %= tau; if (sweep < 0) sweep += tau }
    }
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 15)))
    for (let index = 0; index <= steps; index += 1) {
      const angle = startAngle + sweep * index / steps
      currentPath.push([Number((cx + Math.cos(angle) * radius).toFixed(5)),
        Number((cy + Math.sin(angle) * radius).toFixed(5))])
    }
  }
  const isDimensionPlateColor = (value) => {
    const color = String(value || '').replace(/\s+/g, '').toLowerCase()
    return color.startsWith('rgba(16,36,58,0.94)') || /^rgba\(7,23,39,0?\.96\)/.test(color)
      || /^rgba\(255,255,255,0?\.96\)/.test(color)
  }
  const capturePathPlate = () => {
    const bounds = pathBounds()
    if (!bounds || !isDimensionPlateColor(raw.fillStyle)) return
    pendingPlate = { ...bounds, x: bounds.left, y: bounds.top,
      width: bounds.right - bounds.left, height: bounds.bottom - bounds.top,
      fill: String(raw.fillStyle), shape: 'rounded-path' }
    textPlates.push(pendingPlate)
  }
  const measuredContext = new Proxy(raw, {
    set(target, key, value) { return Reflect.set(target, key, value, target) },
    get(target, key) {
      if (key === 'fillText') return (...args) => {
        const text = String(args[0])
        const x = Number(args[1])
        const y = Number(args[2])
        const align = target.textAlign || 'left'
        const textWidth = target.measureText(text).width
        const label = {
          text, x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), align,
          width: Number(textWidth.toFixed(2)),
          left: Number((align === 'center' ? x - textWidth / 2 : align === 'right' ? x - textWidth : x).toFixed(2)),
          right: Number((align === 'center' ? x + textWidth / 2 : align === 'right' ? x : x + textWidth).toFixed(2)),
          font: target.font,
        }
        textLabels.push(label)
        if (pendingPlate) {
          pendingPlate.label = text
          pendingPlate.labelIndex = textLabels.length - 1
          pendingPlate = null
        }
        return target.fillText(...args)
      }
      if (key === 'fillRect') return (x, y, width, height) => {
        const fill = String(target.fillStyle || '').replace(/\s+/g, '').toLowerCase()
        if (isDimensionPlateColor(fill)) {
          pendingPlate = { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, fill: String(target.fillStyle), shape: 'rect' }
          textPlates.push(pendingPlate)
        } else if ((fill === '#7dd3fc' || fill === '#75d9ed') && width >= 10 && width <= 18 && height >= 7 && height <= 13) {
          cameraRects.push({ x, y, width, height, fill: String(target.fillStyle) })
        }
        return target.fillRect(x, y, width, height)
      }
      if (key === 'beginPath') return (...args) => {
        currentPath = []
        pathClosed = false
        return target.beginPath(...args)
      }
      if (key === 'moveTo') return (x, y) => {
        currentPath.push([Number(x), Number(y)])
        return target.moveTo(x, y)
      }
      if (key === 'lineTo') return (x, y) => {
        currentPath.push([Number(x), Number(y)])
        return target.lineTo(x, y)
      }
      if (key === 'closePath') return (...args) => {
        pathClosed = true
        return target.closePath(...args)
      }
      if (key === 'arc') return (x, y, radius, startAngle, endAngle, anticlockwise = false) => {
        appendArcPoints(Number(x), Number(y), Math.abs(Number(radius)), Number(startAngle), Number(endAngle), Boolean(anticlockwise))
        return target.arc(x, y, radius, startAngle, endAngle, anticlockwise)
      }
      if (key === 'quadraticCurveTo') return (cpx, cpy, x, y) => {
        currentPath.push([Number(cpx), Number(cpy)], [Number(x), Number(y)])
        return target.quadraticCurveTo(cpx, cpy, x, y)
      }
      if (key === 'bezierCurveTo') return (cp1x, cp1y, cp2x, cp2y, x, y) => {
        currentPath.push([Number(cp1x), Number(cp1y)], [Number(cp2x), Number(cp2y)], [Number(x), Number(y)])
        return target.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)
      }
      if (key === 'rect') return (x, y, rectWidth, rectHeight) => {
        const left = Math.min(Number(x), Number(x + rectWidth))
        const right = Math.max(Number(x), Number(x + rectWidth))
        const top = Math.min(Number(y), Number(y + rectHeight))
        const bottom = Math.max(Number(y), Number(y + rectHeight))
        pendingClipRect = { left, top, right, bottom }
        currentPath.push([left, top], [right, top], [right, bottom], [left, bottom])
        pathClosed = true
        return target.rect(x, y, rectWidth, rectHeight)
      }
      if (key === 'roundRect') return (x, y, rectWidth, rectHeight, radii) => {
        const left = Math.min(Number(x), Number(x + rectWidth))
        const right = Math.max(Number(x), Number(x + rectWidth))
        const top = Math.min(Number(y), Number(y + rectHeight))
        const bottom = Math.max(Number(y), Number(y + rectHeight))
        currentPath.push([left, top], [right, top], [right, bottom], [left, bottom])
        pathClosed = true
        return target.roundRect(x, y, rectWidth, rectHeight, radii)
      }
      if (key === 'clip') return (...args) => {
        activeClipRect = pendingClipRect || pathBounds()
        pendingClipRect = null
        return target.clip(...args)
      }
      if (key === 'save') return (...args) => {
        clipStack.push(activeClipRect ? { ...activeClipRect } : null)
        return target.save(...args)
      }
      if (key === 'restore') return (...args) => {
        activeClipRect = clipStack.length ? clipStack.pop() : null
        return target.restore(...args)
      }
      if (key === 'stroke') return (...args) => {
        const color = String(target.strokeStyle || '').replace(/\s+/g, '').toLowerCase()
        if (currentPath.length >= 2 && ['#fb7185', '#60a5fa', '#fbbf24', '#ff8b98', '#72aaff', '#f7c66a', '#c13c53', '#2368b4', '#875b00'].includes(color)) {
          geometryPaths.push({ points: currentPath.map((point) => [...point]), closed: pathClosed,
            color: String(target.strokeStyle), width: Number(target.lineWidth) || 1,
            dash: typeof target.getLineDash === 'function' ? target.getLineDash() : [],
            clipRect: activeClipRect ? { ...activeClipRect } : null })
        }
        return target.stroke(...args)
      }
      if (key === 'fill') return (...args) => {
        const color = String(target.fillStyle || '').replace(/\s+/g, '').toLowerCase()
        capturePathPlate()
        if (currentPath.length >= 3 && ['#7dd3fc', '#75d9ed', '#007c91'].includes(color)) {
          geometryPaths.push({ points: currentPath.map((point) => [...point]), closed: pathClosed,
            color: String(target.fillStyle), width: 0, kind: 'camera-glyph' })
        } else if (currentPath.length >= 3 && (/^rgba\(96,165,250,/.test(color) || /^rgba\(114,170,255,/.test(color) || /^rgba\(35,104,180,/.test(color))) {
          // Keep V3's 0.12 and V5's 0.14 blue coverage fill geometrically
          // comparable while preserving the actual renderer alpha for review.
          geometryPaths.push({ points: currentPath.map((point) => [...point]), closed: pathClosed,
            color: '#60a5fa', fillStyle: String(target.fillStyle), width: 0, kind: 'coverage-wedge-fill',
            clipRect: activeClipRect ? { ...activeClipRect } : null })
        }
        return target.fill(...args)
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const view = state.previewViewOptions?.[state.previewViewIndex]?.value || 'plan'
  renderer.drawPreviewAtSize(renderer.adaptCanvas2dContext(measuredContext), state.result, width, height, view, query.get('theme') === 'dark' ? 'dark' : 'light')
  const sample = raw.getImageData(Math.min(canvas.width - 1, 3 * dpr), Math.min(canvas.height - 1, 3 * dpr), 1, 1).data
  return {
    view,
    css: { width: Number(width.toFixed(2)), height: Number(height.toFixed(2)) },
    bitmap: { width: canvas.width, height: canvas.height },
    topLeftPixel: [sample[0], sample[1], sample[2], sample[3]],
    deepBlueBackdrop: (sample[0] === 16 && sample[1] === 36 && sample[2] === 58)
      || (sample[0] === 8 && sample[1] === 26 && sample[2] === 45),
    themeBackdrop: query.get('theme') === 'dark'
      ? sample[0] === 8 && sample[1] === 26 && sample[2] === 45
      : sample[0] === 244 && sample[1] === 247 && sample[2] === 251,
    textLabels,
    textPlates,
    geometryPaths,
    coverageFillStyles: [...new Set(geometryPaths.filter((path) => path.kind === 'coverage-wedge-fill').map((path) => path.fillStyle))],
    cameraRects,
  }
}

function segmentIntersectsRect(start, end, rect, padding = 1) {
  const left = rect.left - padding
  const right = rect.right + padding
  const top = rect.top - padding
  const bottom = rect.bottom + padding
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  let t0 = 0
  let t1 = 1
  const tests = [[-dx, start[0] - left], [dx, right - start[0]], [-dy, start[1] - top], [dy, bottom - start[1]]]
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false
      continue
    }
    const ratio = q / p
    if (p < 0) t0 = Math.max(t0, ratio)
    else t1 = Math.min(t1, ratio)
    if (t0 > t1) return false
  }
  return true
}

function rectIntersection(a, b) {
  const result = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
  return result.left <= result.right && result.top <= result.bottom ? result : null
}

function protectedGeometryCollisions(renderInfo) {
  if (!renderInfo) return []
  const importantColors = new Set(['#fb7185', '#60a5fa', '#fbbf24', '#ff8b98', '#72aaff', '#f7c66a'])
  const segments = (renderInfo.geometryPaths || []).filter((path) => path.kind !== 'coverage-wedge-fill').flatMap((path) => {
    const color = String(path.color || '').replace(/\s+/g, '').toLowerCase()
    if (!importantColors.has(color) || path.points.length < 2) return []
    const points = path.closed ? [...path.points, path.points[0]] : path.points
    return points.slice(1).map((point, index) => ({ start: points[index], end: point, color: path.color,
      width: Number(path.width) || 1, clipRect: path.clipRect || null }))
  })
  const platesByLabel = new Map((renderInfo.textPlates || []).filter((plate) => plate.label).map((plate) => [plate.label, plate]))
  const protectedLabels = (renderInfo.textLabels || []).map((label) => {
    const plate = platesByLabel.get(label.text)
    const fontPx = Number.parseFloat(label.font) || 12
    return {
      label: label.text,
      rect: plate
        ? { left: plate.x, top: plate.y, right: plate.x + plate.width, bottom: plate.y + plate.height }
        : { left: label.left - 1, top: label.y - fontPx * 0.85, right: label.right + 1, bottom: label.y + fontPx * 0.25 },
      backgroundPlate: Boolean(plate),
    }
  })
  const lineCollisions = protectedLabels.flatMap((label) => segments.map((segment) => ({
    segment, visibleLabelRect: segment.clipRect ? rectIntersection(label.rect, segment.clipRect) : label.rect,
  })).filter(({ segment, visibleLabelRect }) => Boolean(visibleLabelRect
    && segmentIntersectsRect(segment.start, segment.end, visibleLabelRect, Math.max(1, segment.width / 2))))
    .map(({ segment, visibleLabelRect }) => ({ label: label.label, labelRect: label.rect, visibleLabelRect,
      segmentClipRect: segment.clipRect, backgroundPlate: label.backgroundPlate,
    geometry: ['#fb7185', '#ff8b98'].includes(segment.color.toLowerCase()) ? 'physical-target-boundary'
      : ['#fbbf24', '#f7c66a'].includes(segment.color.toLowerCase()) ? 'effective-target-boundary' : 'primary-fov-boundary',
    color: segment.color, segment: [segment.start, segment.end] })))
  const cameraGlyphRects = [
    ...(renderInfo.cameraRects || []).map((camera) => ({ left: camera.x, top: camera.y,
      right: camera.x + camera.width, bottom: camera.y + camera.height })),
    ...(renderInfo.geometryPaths || []).filter((path) => path.kind === 'camera-glyph' && path.points.length)
      .map((path) => ({ left: Math.min(...path.points.map((point) => point[0])),
        top: Math.min(...path.points.map((point) => point[1])),
        right: Math.max(...path.points.map((point) => point[0])),
        bottom: Math.max(...path.points.map((point) => point[1])) })),
  ]
  const cameraCollisions = protectedLabels.flatMap((label) => cameraGlyphRects.filter((rect) =>
    label.rect.left < rect.right && label.rect.right > rect.left && label.rect.top < rect.bottom && label.rect.bottom > rect.top
  ).map(() => ({ label: label.label, labelRect: label.rect, backgroundPlate: label.backgroundPlate, geometry: 'camera-marker' })))
  return [...lineCollisions, ...cameraCollisions]
}

function textLineRects(element) {
  if (!element) return []
  const range = document.createRange()
  range.selectNodeContents(element)
  return [...range.getClientRects()].map((rect) => ({ left: rect.left, top: rect.top,
    right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }))
}

function visiblePanelIds() {
  return ['cameraInputPanelCamera', 'cameraInputPanelTarget', 'cameraInputPanelInstall']
    .filter((id) => app.querySelector(`#${id}`))
}

function box(element) {
  if (!element) return null
  const value = element.getBoundingClientRect()
  return {
    x: Number(value.x.toFixed(2)), y: Number(value.y.toFixed(2)),
    width: Number(value.width.toFixed(2)), height: Number(value.height.toFixed(2)),
    right: Number(value.right.toFixed(2)), bottom: Number(value.bottom.toFixed(2)),
  }
}

function fontMeasurement(selector) {
  const element = app.querySelector(selector)
  if (!element) return null
  const style = getComputedStyle(element)
  const bounds = element.getBoundingClientRect()
  return {
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    boxHeight: Number(bounds.height.toFixed(2)),
    boxWidth: Number(bounds.width.toFixed(2)),
  }
}

function inspectPage(state, renderInfo) {
  const viewport = { width: innerWidth, height: innerHeight }
  const root = app.querySelector('.page-root')
  const scroll = app.querySelector('.page-scroll')
  const pane = app.querySelector('#cameraResultPane')
  const hero = app.querySelector('#cameraResultHero')
  const inputCard = app.querySelector('.camera-input-card')
  const unsupportedCard = app.querySelector('#cameraLegacyUnsupported') || app.querySelector('#cameraOperationUnsupported')
    || app.querySelector('#cameraResultEmpty')
  const resultRegion = hero || unsupportedCard
  const canvas = app.querySelector('#cameraFovCanvas')
  const rail = app.querySelector('#cameraResultRail')
  const inputTabs = [...app.querySelectorAll('#cameraInputTabs .camera-input-tab')]
  const activeInputPanel = app.querySelector('#cameraInputPanelCamera') || app.querySelector('#cameraInputPanelTarget')
    || app.querySelector('#cameraInputPanelInstall')
  const modelPicker = app.querySelector('#cameraModelPicker')
  const modelInfo = modelPicker?.querySelector('.equipment-info') || null
  const modelName = modelPicker?.querySelector('.equipment-model') || null
  const modelDescription = modelPicker?.querySelector('.equipment-category') || null
  const modelArrow = modelPicker?.querySelector('.picker-arrow') || null
  const firstInputField = modelPicker || app.querySelector('.camera-legacy-input-note')
    || activeInputPanel?.querySelector('input,button,[data-field],.field,.installation-mode-field,.input-section')
  const selectedInputTab = inputTabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || null
  const shareOverlay = app.querySelector('.result-report-preview-overlay')
  const shareSheet = app.querySelector('.result-report-preview-sheet')
  const shareImage = app.querySelector('.result-report-preview-image')
  const shareActions = [...app.querySelectorAll('.result-report-preview-action')]
  const originalViewer = app.querySelector('#cameraOriginalImageViewer')
  const originalViewerImage = app.querySelector('.camera-original-viewer-image')
  const originalViewerScaleButtons = [...app.querySelectorAll('.camera-original-viewer-scale')]
  const selectorOverlay = app.querySelector('.selector-mask')
  const selectorPanel = app.querySelector('.selector-panel')
  const selectorClose = app.querySelector('.selector-close')
  const selectorRows = [...app.querySelectorAll('.selector-row')]
  const projectOverlay = app.querySelector('#cameraProjectOverlay')
  const projectSheet = app.querySelector('#cameraProjectSheet')
  const projectStepPanel = state.projectDialogStep
    ? app.querySelector(`#cameraProject${state.projectDialogStep[0].toUpperCase()}${state.projectDialogStep.slice(1)}`)
    : null
  const projectInputs = ['#projectSearchText', '#projectNameText', '#projectConfigName', '#projectConfigNote']
    .map((selector) => ({ selector, element: app.querySelector(selector) })).filter((entry) => entry.element)
  const projectButtons = [...app.querySelectorAll('.camera-project-footer button, .camera-project-close')]
  const actions = ['#cameraReset', '#cameraShare', '#cameraFavorite', '#cameraProject'].map((selector) => app.querySelector(selector)).filter(Boolean)
  const canvasRect = canvas ? canvas.getBoundingClientRect() : null
  const modelDescriptionStyle = modelDescription ? getComputedStyle(modelDescription) : null
  const modelDescriptionLines = textLineRects(modelDescription)
  const modelPickerLayout = modelPicker ? {
    picker: box(modelPicker), info: box(modelInfo), model: box(modelName), description: box(modelDescription),
    arrow: box(modelArrow), pickerClientWidth: modelPicker.clientWidth, pickerScrollWidth: modelPicker.scrollWidth,
    infoMinWidth: modelInfo ? getComputedStyle(modelInfo).minWidth : '',
    descriptionClientWidth: modelDescription?.clientWidth ?? null,
    descriptionScrollWidth: modelDescription?.scrollWidth ?? null,
    descriptionWhiteSpace: modelDescriptionStyle?.whiteSpace || '',
    descriptionTextOverflow: modelDescriptionStyle?.textOverflow || '',
    descriptionOverflow: modelDescriptionStyle?.overflow || '',
    descriptionLineCount: modelDescriptionLines.length,
    descriptionText: modelDescription?.textContent.trim() || '',
  } : null
  const actionRects = actions.map((button) => ({ id: button.id, rect: button.getBoundingClientRect() }))
  const diagramGeometryCollisions = protectedGeometryCollisions(renderInfo)
  const unsupportedTextElements = ['.camera-legacy-title', '.camera-empty-message', '.camera-empty-hint',
    '.camera-legacy-input-note', '.camera-legacy-selector-button']
    .flatMap((selector) => [...app.querySelectorAll(selector)].map((element) => ({ selector, element })))
  const unsupportedTextBoxes = unsupportedTextElements.flatMap(({ selector, element }) => textLineRects(element)
    .map((rect) => ({ selector, text: element.textContent.trim(), rect })))
  const unsupportedRailCollisions = unsupportedTextBoxes.flatMap((line) => actionRects.filter(({ rect }) =>
    line.rect.left < rect.right && line.rect.right > rect.left && line.rect.top < rect.bottom && line.rect.bottom > rect.top
  ).map(({ id }) => ({ selector: line.selector, text: line.text, line: line.rect, action: id })))
  const labels = renderInfo?.textLabels || []
  const dimensionPrefix = /^(?:宽|纵深|最高|高度|底边离地)\s*/
  const dimensionLabels = labels.filter((label) => dimensionPrefix.test(label.text))
  const dimensionPlates = (renderInfo?.textPlates || []).filter((plate) => dimensionPrefix.test(plate.label || ''))
  const invalidDimensionPlates = dimensionPlates.filter((plate) => ![plate.left, plate.top, plate.right, plate.bottom]
    .every((value) => Number.isFinite(Number(value))) || !(plate.right > plate.left && plate.bottom > plate.top)
    || plate.left < -0.5 || plate.top < -0.5 || plate.right > Number(renderInfo?.css?.width || 0) + 0.5
    || plate.bottom > Number(renderInfo?.css?.height || 0) + 0.5)
  const dimensionPlateRail = renderInfo?.css ? {
    left: Number(renderInfo.css.width) - 54, right: Number(renderInfo.css.width), top: 0, bottom: 120,
  } : null
  const dimensionPlateRailCollisions = dimensionPlates.filter((plate) => dimensionPlateRail
    && plate.left < dimensionPlateRail.right && plate.right > dimensionPlateRail.left
    && plate.top < dimensionPlateRail.bottom && plate.bottom > dimensionPlateRail.top)
  const formatExpectedDimension = (label, value) => `${label} ${Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}m`
  const expectedDimensionValues = state.result ? (state.result.sceneMode === 'ground'
    ? (renderInfo?.view === 'elevation'
      ? [['纵深', state.result.depthMeters], ['最高', state.result.subjectHeightMeters]]
      : [['宽', state.result.widthMeters], ['纵深', state.result.depthMeters]])
    : (renderInfo?.view === 'elevation'
      ? [['高度', state.result.heightMeters], ['底边离地', state.result.bottomHeightMeters]]
      : [['宽', state.result.widthMeters]])) : []
  const expectedDimensionLabels = expectedDimensionValues.map(([label, value]) => formatExpectedDimension(label, value))
  const missingExpectedDimensionLabels = expectedDimensionLabels.filter((expected) => !labels.some((label) => label.text === expected))
  const unknownHeightLabels = state.result?.horizontalOnly && renderInfo?.view === 'elevation'
    ? labels.filter((label) => /镜头高度|未校核|—/.test(label.text)) : []
  const unknownHeightText = unknownHeightLabels.map((label) => label.text).join(' ')
  const unknownHeightLabelsInside = unknownHeightLabels.every((label) => label.left >= -0.5
    && label.right <= Number(renderInfo?.css?.width || 0) + 0.5
    && label.y - (Number.parseFloat(label.font) || 12) >= -0.5
    && label.y + Math.max(3, (Number.parseFloat(label.font) || 12) * 0.3) <= Number(renderInfo?.css?.height || 0) + 0.5)
  const canvasLabelBounds = labels.map((label) => {
    const fontPx = Number.parseFloat(label.font) || 12
    return { text: label.text, left: label.left, right: label.right, top: label.y - fontPx, bottom: label.y + Math.max(3, fontPx * 0.3), font: label.font }
  })
  const labelClips = canvasLabelBounds.filter((label) => label.left < -0.5 || label.right > (canvasRect?.width || 0) + 0.5
    || label.top < -0.5 || label.bottom > (canvasRect?.height || 0) + 0.5)
  const railLabelCollisions = canvasLabelBounds.flatMap((label) => actionRects.filter(({ rect }) => {
    if (!canvasRect) return false
    const left = canvasRect.left + label.left
    const right = canvasRect.left + label.right
    const top = canvasRect.top + label.top
    const bottom = canvasRect.top + label.bottom
    return left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top
  }).map(({ id }) => ({ id, label: label.text })))
  const forbiddenSelectors = ['#cameraPageTitle', '.page-title', '#cameraCopySummary', '#cameraCopyFull',
    '#cameraDetailsToggle', '#cameraDetailsContent', '#cameraSourceToggle', '.source-segment',
    '#cameraCustomAngles', '#cameraCustomSensor', '.camera-primary-results', '.camera-primary-result',
    '.camera-primary-reference']
  const forbiddenPresent = forbiddenSelectors.filter((selector) => app.querySelector(selector))
  const forbiddenBindings = ['onSourceModeTap', 'onDefinitionModeTap', 'onCustomMountTypeTap',
    'copyCameraSummary', 'copyCameraFull', 'toggleCalculationDetails']
    .filter((name) => (fixture.pageHandlers || []).includes(name))
  const pageWxml = expandedSource
  const removedMarkupTokens = ['cameraCopySummary', 'cameraCopyFull', 'cameraDetailsToggle',
    'cameraDetailsContent', 'cameraCustomAngles', 'cameraCustomSensor', 'source-segment',
    'customHorizontalFovText', 'customVerticalFovText', 'customSensorWidthText',
    'customSensorHeightText', 'customFocalLengthText']
    .filter((token) => pageWxml.includes(token))
  const horizontalOverflow = Boolean(root && root.scrollWidth > viewport.width + 1)
  const canvasCenterDelta = canvasRect ? Number((canvasRect.left + canvasRect.width / 2 - viewport.width / 2).toFixed(2)) : null
  const heroRect = resultRegion?.getBoundingClientRect() || null
  const heroCenterDelta = heroRect ? Number((heroRect.left + heroRect.width / 2 - viewport.width / 2).toFixed(2)) : null
  const paneRect = pane?.getBoundingClientRect() || null
  const paneCenterDelta = paneRect ? Number((paneRect.left + paneRect.width / 2 - viewport.width / 2).toFixed(2)) : null
  const railStyle = rail ? getComputedStyle(rail) : null
  const buttonGeometry = actions.map((button) => {
    const style = getComputedStyle(button)
    const icon = button.querySelector('.camera-action-icon')
    const iconStyle = icon ? getComputedStyle(icon) : null
    const rect = button.getBoundingClientRect()
    return { id: button.id, box: box(button), borderRadius: style.borderRadius,
      maskImage: iconStyle?.maskImage || iconStyle?.webkitMaskImage || '', disabled: button.disabled }
  })
  const report = {
    status: 'passed',
    bridge: 'Headless Chrome renders actual camera WXML/WXSS, page-controller state, and the production preview renderer into a real Canvas 2D context.',
    limitations: 'This verifies browser parsing, computed layout, dispatched controller handlers, and Canvas 2D pixels. It is not the WeChat WXML/WXSS runtime, DevTools compilation, native OS share/permission behavior, or physical-device evidence.',
    caseName: scenario,
    sourceNote: fixture.sourceNote,
    viewport,
    theme: query.get('theme') || 'light',
    fontScale: Number(query.get('zoom')) || 1,
    state: {
      result: state.result ? { model: state.result.displayModel, scene: state.result.sceneMode,
        horizontalOnly: state.result.horizontalOnly, primaryDistanceMeters: state.result.primaryDistanceMeters,
        cameraSetbackMeters: state.result.cameraSetbackMeters, distanceMeters: state.result.distanceMeters,
        cameraHeightMeters: state.result.cameraHeightMeters, heightMode: state.result.heightMode,
        marginPercent: state.result.marginPercent, mountType: state.result.mountType,
        viewIndex: state.viewIndex, cameraIndex: state.cameraIndex, horizontalFov: state.result.horizontalFov,
        verticalFov: state.result.verticalFov, aimAngleDegrees: state.result.aimAngleDegrees } : null,
      legacyCustomUnsupported: Boolean(state.legacyCustomUnsupported),
      operationUnsupportedMessage: state.operationUnsupportedMessage || '',
      resultUpdating: Boolean(state.resultUpdating),
      resultReportPreviewVisible: Boolean(state.resultReportPreviewVisible),
      projectDialogVisible: Boolean(state.projectDialogVisible),
      projectDialogStep: state.projectDialogStep || '',
      projectSaving: Boolean(state.projectSaving),
      projectLoadFailed: Boolean(state.projectLoadFailed),
      projectError: state.projectError || '',
      projectKeyboardOpen: Boolean(state.projectKeyboardOpen),
      projectDialogRevision: state.projectDialogRevision || 0,
      projectFocusEpisode: state.projectFocusEpisode || 0,
      resultReportImageViewerVisible: Boolean(state.resultReportImageViewerVisible),
      resultReportImageViewerScale: Number(state.resultReportImageViewerScale || 100),
      selectorVisible: Boolean(state.selectorVisible),
      selectorItemCount: state.selectorItems?.length || 0,
      inputTabIndex: state.inputTabIndex,
      previewViewIndex: state.previewViewIndex,
    },
    canvas: renderInfo,
    sourceHashes: fixture.loadedHashes,
    layout: {
      root: box(root), scroll: box(scroll), scrollTop: Number((scroll?.scrollTop || 0).toFixed(2)),
      pane: box(pane), paneCenterDelta, hero: box(hero), heroCenterDelta,
      canvas: box(canvas), canvasCenterDelta, rail: box(rail), railPosition: railStyle?.position || '',
      railButtons: buttonGeometry, inputTabs: inputTabs.map((tab) => ({ text: tab.textContent.trim(), box: box(tab), selected: tab.getAttribute('aria-selected') })),
      modelPicker: box(modelPicker), modelPickerLayout,
      inputCard: box(inputCard),
      activeInputPanel: box(activeInputPanel),
      firstInputField: box(firstInputField),
      selectedInputTab: selectedInputTab ? { text: selectedInputTab.textContent.trim(), box: box(selectedInputTab) } : null,
      shareOverlay: box(shareOverlay),
      shareSheet: box(shareSheet),
      shareImage: shareImage ? { box: box(shareImage), complete: shareImage.complete, naturalWidth: shareImage.naturalWidth } : null,
      shareActions: shareActions.map((action) => ({ text: action.textContent.trim(), box: box(action) })),
      originalViewer: box(originalViewer),
      originalViewerImage: originalViewerImage ? { box: box(originalViewerImage), complete: originalViewerImage.complete,
        naturalWidth: originalViewerImage.naturalWidth,
        sourceScheme: originalViewerImage.src.startsWith('data:image/png;base64,') ? 'data:image/png;base64'
          : originalViewerImage.src ? new URL(originalViewerImage.src, location.href).protocol : '' } : null,
      originalViewerScaleButtons: originalViewerScaleButtons.map((button) => ({ text: button.textContent.trim(),
        box: box(button), selected: button.classList.contains('camera-original-viewer-scale-active') })),
      selectorOverlay: box(selectorOverlay),
      selectorPanel: box(selectorPanel),
      selectorClose: box(selectorClose),
      selectorRows: selectorRows.slice(0, 4).map((row) => ({ model: row.querySelector('.selector-model')?.textContent.trim() || '', box: box(row) })),
      projectOverlay: box(projectOverlay),
      projectSheet: box(projectSheet),
      projectStep: state.projectDialogStep || '',
      projectInputs: projectInputs.map(({ selector, element }) => ({ selector, box: box(element), valueLength: element.value?.length || 0 })),
      projectButtons: projectButtons.map((button) => ({ text: button.textContent.trim(), box: box(button), disabled: button.disabled })),
      longLabel: box(app.querySelector('.camera-summary-primary')),
      rootScrollWidth: root?.scrollWidth ?? null,
      viewportWidth: viewport.width,
      canvasLabels: canvasLabelBounds,
      labelClips,
      railLabelCollisions,
      diagramGeometryCollisions,
      unsupportedTextBoxes,
      unsupportedRailCollisions,
    },
    removedMarkupTokens,
    forbiddenSelectors,
    forbiddenPresent,
    forbiddenBindings,
    checks: [],
    failures: [],
    styleSources: wxssSources.map((item) => item.url),
    expandedStyles: [...wxssPaths].sort(),
  }
  const add = (name, passed, detail = null) => report.checks.push({ name, passed: Boolean(passed), detail })
  const wxmlHasPageCanvas = pageWxml.includes('cameraResultPane') && pageWxml.includes('cameraFovCanvas')
  add('actual production WXML and include expansion loaded', wxmlHasPageCanvas && wxssSources.length === 2,
    { wxmlLength: pageWxml.length, wxssSources: report.styleSources })
  const requestedThemeBridge = `query:${query.get('theme') === 'dark' ? 'dark' : 'light'}-to-media-width`
  add('query theme bridge forces the requested production prefers-color-scheme branch without editing WXSS',
    document.documentElement.dataset.cameraQaStyleThemeBridge === requestedThemeBridge
      && wxssSources.length === 2 && wxssSources.every((source) => source.styleThemeBridge === requestedThemeBridge),
    { requestedThemeBridge, appliedThemeBridge: document.documentElement.dataset.cameraQaStyleThemeBridge || '',
      sources: wxssSources.map((source) => source.url) })
  add('removed title/custom/copy/derivation/value-card markup and handlers are absent',
    forbiddenPresent.length === 0 && forbiddenBindings.length === 0 && removedMarkupTokens.length === 0,
    { forbiddenPresent, forbiddenBindings, removedMarkupTokens })
  add('four reset/share/favorite/project rail controls are present as circular 44px masked icon targets',
    actions.length === 4 && buttonGeometry.every((item) => {
      const parsed = Number.parseFloat(item.box?.width || '')
      return item.box?.width === 44 && item.box?.height === 44 && item.borderRadius === '50%'
        && item.maskImage && item.maskImage !== 'none'
    }), buttonGeometry)
  add('result pane, result card, and canvas stay centered on the phone viewport', Boolean(pane && resultRegion)
    && Math.abs(paneCenterDelta) <= 1.5 && Math.abs(heroCenterDelta) <= 1.5
      && (!state.result || (canvas && Math.abs(canvasCenterDelta) <= 1.5)),
    { paneCenterDelta, heroCenterDelta, canvasCenterDelta, pane: box(pane), resultRegion: box(resultRegion), canvas: box(canvas) })
  add('action rail overlays the result without reserving a layout column', Boolean(rail && resultRegion && railStyle?.position === 'absolute')
    && Math.abs(heroCenterDelta) <= 1.5 && rail.getBoundingClientRect().right <= viewport.width + 1,
    { rail: box(rail), railPosition: railStyle?.position, heroCenterDelta })
  add(state.result ? 'the production canvas drew the requested theme with real labels'
    : 'unsupported/invalid state does not fabricate a production canvas',
  state.result ? Boolean(canvas && renderInfo?.themeBackdrop) && labels.length >= 3 : !canvas && !renderInfo,
  { canvas: box(canvas), renderInfo })
  const heroSecondaryMetadata = hero ? [...hero.querySelectorAll(
    '.camera-summary-secondary, .camera-summary-meta-row, .camera-summary-meta-item, .camera-summary-meta-limitations'
  )].map((element) => ({ selector: element.className || element.tagName.toLowerCase(), box: box(element), text: element.textContent.trim() })) : []
  add('result hero has no secondary metadata or limitations rows below the diagram',
    !state.result || Boolean(hero && heroSecondaryMetadata.length === 0),
    { hero: box(hero), secondaryMetadata: heroSecondaryMetadata })
  add('all canvas labels stay inside the bitmap and clear the action rail', labelClips.length === 0 && railLabelCollisions.length === 0,
    { labelClips, railLabelCollisions, labels: canvasLabelBounds, buttons: buttonGeometry })
  if (state.result) {
    add('renderer dimension annotations display values from the current physical target fields',
      expectedDimensionLabels.length > 0 && missingExpectedDimensionLabels.length === 0,
      { view: renderInfo?.view, expectedDimensionLabels, missingExpectedDimensionLabels, drawnDimensionLabels: dimensionLabels.map((label) => label.text) })
    add('rounded dimension-label plates avoid the reserved top-right action rail area',
      dimensionPlates.length === expectedDimensionLabels.length && dimensionPlateRailCollisions.length === 0,
      { canvas: renderInfo?.css, reservedRail: dimensionPlateRail,
        dimensionPlates: dimensionPlates.map(({ label, left, top, right, bottom, shape }) => ({ label, left, top, right, bottom, shape })),
        collisions: dimensionPlateRailCollisions.map((plate) => plate.label) })
    add('dimension plates use finite positive boxes inside the canvas without negative rectangles',
      dimensionPlates.length === expectedDimensionLabels.length && invalidDimensionPlates.length === 0,
      { invalidDimensionPlates, dimensions: renderInfo?.css })
  }
  if (state.result) add('diagram annotations do not cover physical/effective target edges, primary FOV boundaries, or camera marker',
    diagramGeometryCollisions.length === 0, diagramGeometryCollisions)
  if (!state.result) add('unsupported/empty-state text and recovery action clear the floating rail',
    unsupportedRailCollisions.length === 0, unsupportedRailCollisions)
  add('no horizontal layout overflow', !horizontalOverflow, { rootScrollWidth: root?.scrollWidth, viewportWidth: viewport.width })
  add('three input groups and a path to choose a library model remain available', inputTabs.length === 3
    && (Boolean(app.querySelector('#cameraModelPicker') || app.querySelector('#cameraLegacySelectorButton'))
      || (Number(state.inputTabIndex) !== 0 && pageWxml.includes('id="cameraModelPicker"'))),
    { tabs: inputTabs.map((tab) => tab.textContent.trim()), modelPicker: box(app.querySelector('#cameraModelPicker')),
      recoveryButton: box(app.querySelector('#cameraLegacySelectorButton')) })
  add('scene render keeps the selected input group and first field visible below the result',
    Boolean(inputCard && activeInputPanel && firstInputField)
      && box(inputCard).height > 0 && box(activeInputPanel).height > 0 && box(firstInputField).height > 0,
    { inputCard: box(inputCard), activeInputPanel: box(activeInputPanel), firstInputField: box(firstInputField) })
  if (modelPicker) {
    const pickerRect = modelPicker.getBoundingClientRect()
    const infoRect = modelInfo?.getBoundingClientRect()
    const modelRect = modelName?.getBoundingClientRect()
    const descriptionRect = modelDescription?.getBoundingClientRect()
    const arrowRect = modelArrow?.getBoundingClientRect()
    const within = (rect, parent, tolerance = 1) => Boolean(rect && parent
      && rect.left >= parent.left - tolerance && rect.right <= parent.right + tolerance)
    const textDoesNotOverlapArrow = Boolean(arrowRect && modelRect && descriptionRect
      && modelRect.right <= arrowRect.left + 1 && descriptionRect.right <= arrowRect.left + 1)
    const pickerHasNoHorizontalOverflow = modelPicker.scrollWidth <= modelPicker.clientWidth + 1
    const descriptionFitsOrTruncatesCleanly = Boolean(modelDescription && modelDescriptionStyle
      && (modelDescription.scrollWidth <= modelDescription.clientWidth + 1
        || (modelDescriptionStyle.textOverflow === 'ellipsis'
          && modelDescriptionStyle.whiteSpace === 'nowrap'
          && modelDescriptionStyle.overflow !== 'visible')
        || (modelDescriptionLines.length > 1 && modelDescription.scrollHeight <= modelDescription.clientHeight + 1)))
    add('library model text remains inside picker and leaves a visible nonshrinking chevron',
      within(infoRect, pickerRect) && within(modelRect, infoRect) && within(descriptionRect, infoRect)
        && within(arrowRect, pickerRect) && textDoesNotOverlapArrow && pickerHasNoHorizontalOverflow,
      { modelPickerLayout, textDoesNotOverlapArrow, pickerHasNoHorizontalOverflow })
    add('model description fits, wraps, or is ellipsized instead of being hard-clipped',
      descriptionFitsOrTruncatesCleanly,
      { modelPickerLayout, descriptionFitsOrTruncatesCleanly })
  }
  if (expectedInputTabIndex !== null) {
    const panelIds = ['cameraInputPanelCamera', 'cameraInputPanelTarget', 'cameraInputPanelInstall']
    add('production input-tab handler selects the requested target/install panel',
      Number(state.inputTabIndex) === expectedInputTabIndex
        && selectedInputTab?.getAttribute('aria-selected') === 'true'
        && activeInputPanel?.id === panelIds[expectedInputTabIndex],
      { expectedInputTabIndex, stateInputTabIndex: state.inputTabIndex,
        selectedTab: selectedInputTab?.textContent.trim() || '', panelId: activeInputPanel?.id || '' })
  }
  if (state.result?.horizontalOnly && renderInfo?.view === 'elevation') {
    const verticalCoveragePaths = (renderInfo.geometryPaths || []).filter((path) =>
      String(path.color || '').replace(/\s+/g, '').toLowerCase() === '#60a5fa')
    add('horizontal-only elevation does not fabricate a vertical coverage cone', verticalCoveragePaths.length === 0,
      { verticalCoveragePaths, labels })
    add('horizontal-only elevation keeps unknown camera height text and its boxes inside the canvas',
      unknownHeightText.includes('镜头高度') && unknownHeightText.includes('未校核') && unknownHeightText.includes('—')
        && unknownHeightLabelsInside && unknownHeightLabels.length >= 2,
      { unknownHeightText, unknownHeightLabels, unknownHeightLabelsInside, canvas: renderInfo?.css })
  }
  if (scenario === 'dual-lens') {
    add('dual-view library camera renders its second selected view', Boolean(state.result)
      && state.result.displayModel === 'TS-0663JSM' && state.viewIndex === 1,
      { model: state.result?.displayModel || '', viewIndex: state.viewIndex, optics: state.result?.selectedOpticsLines || null })
  }
  if (scenario === 'eptz-fixed-margin20') {
    add('ePTZ library camera, fixed height, plane scene, and 20 percent margin remain calculable', Boolean(state.result)
      && state.result.mountType === 'eptz' && state.result.heightMode === 'fixed'
      && state.result.sceneMode === 'plane' && Number(state.result.marginPercent) === 20,
      { model: state.result?.displayModel || '', mountType: state.result?.mountType || '',
        heightMode: state.result?.heightMode || '', sceneMode: state.result?.sceneMode || '', marginPercent: state.result?.marginPercent })
  }
  if (state.resultReportPreviewVisible) {
    const overlayRect = shareOverlay?.getBoundingClientRect()
    const sheetRect = shareSheet?.getBoundingClientRect()
    add('production report preview opens a visible share sheet with an image and both actions',
      Boolean(state.resultReportPreviewVisible && overlayRect && sheetRect && shareImage
        && shareActions.length === 2
        && overlayRect.width >= viewport.width - 1 && sheetRect.height > 0
        && sheetRect.top >= -1 && sheetRect.bottom <= viewport.height + 1
        && shareActions.every((action) => {
          const rect = action.getBoundingClientRect()
          return rect.height >= 44 && rect.top >= -1 && rect.bottom <= viewport.height + 1
        })),
      { overlay: box(shareOverlay), sheet: box(shareSheet),
        image: shareImage ? { complete: shareImage.complete, naturalWidth: shareImage.naturalWidth } : null,
        actions: shareActions.map((action) => action.textContent.trim()) })
  }
  if (state.projectDialogVisible) {
    const footer = app.querySelector('.camera-project-footer')
    const activeProjectInput = state.projectDialogStep === 'select' ? app.querySelector('#projectSearchText')
      : state.projectDialogStep === 'create' ? app.querySelector('#projectNameText')
        : state.projectDialogStep === 'confirm' ? app.querySelector('#projectConfigName') : null
    const requiredProjectButtons = projectButtons.filter((button) => !(state.projectKeyboardOpen
      && button.classList.contains('camera-project-close')))
    const buttonsWithinViewport = requiredProjectButtons.every((button) => {
      const rect = button.getBoundingClientRect()
      return rect.height >= 40 && rect.top >= -1 && rect.bottom <= viewport.height + 1
    })
    add('camera project overlay shows its active production step with an on-screen footer',
      Boolean(projectOverlay && projectSheet && projectStepPanel && footer && footer.getBoundingClientRect().height > 0
        && projectButtons.length && buttonsWithinViewport
        && (!activeProjectInput || activeProjectInput.getBoundingClientRect().height > 0)),
      { overlay: box(projectOverlay), sheet: box(projectSheet), step: state.projectDialogStep,
        activeInput: box(activeProjectInput), footer: box(footer), buttons: projectButtons.map((button) => ({
          text: button.textContent.trim(), box: box(button), minHeight: button.getBoundingClientRect().height,
        })), intentionallyHiddenHeaderCloseDuringKeyboard: Boolean(state.projectKeyboardOpen
          && projectButtons.some((button) => button.classList.contains('camera-project-close'))) })
    if (state.projectDialogStep === 'select') add('project selection has visible rows or the actual empty/read-failure state',
      Boolean(app.querySelector('.camera-project-list') && (app.querySelectorAll('.camera-project-row').length
        || app.querySelector('.camera-project-empty') || state.projectLoadFailed)),
      { rowCount: app.querySelectorAll('.camera-project-row').length, loadFailed: state.projectLoadFailed,
        emptyState: Boolean(app.querySelector('.camera-project-empty')) })
    if (state.projectDialogStep === 'create') add('project creation step uses the production name field and validation area',
      Boolean(app.querySelector('#projectNameText') && footer), { input: box(app.querySelector('#projectNameText')) })
    if (state.projectDialogStep === 'confirm') add('project confirmation step exposes both production configuration fields',
      Boolean(app.querySelector('#projectConfigName') && app.querySelector('#projectConfigNote')),
      { name: box(app.querySelector('#projectConfigName')), note: box(app.querySelector('#projectConfigNote')) })
    if (state.projectDialogStep === 'success') add('saved-project success step shows the saved configuration name',
      Boolean(state.projectSavedConfigName && app.querySelector('#cameraProjectSuccess')?.textContent.includes(state.projectSavedConfigName)),
      { savedConfigName: state.projectSavedConfigName || '', text: app.querySelector('#cameraProjectSuccess')?.textContent.trim() || '' })
  }
  if (state.resultReportImageViewerVisible) add('original-image viewer shows the actual production report PNG and scale controls',
    Boolean(originalViewer && originalViewerImage?.complete && originalViewerImage.naturalWidth === 750
      && originalViewerImage.src.startsWith('data:image/png;base64,') && originalViewerScaleButtons.length === 3
      && originalViewerScaleButtons.every((button) => button.getBoundingClientRect().width >= 44
        && button.getBoundingClientRect().height >= 44)),
    { viewer: box(originalViewer), image: originalViewerImage ? { box: box(originalViewerImage), complete: originalViewerImage.complete,
      naturalWidth: originalViewerImage.naturalWidth, source: 'production report Canvas PNG data URL' } : null,
      scaleButtons: originalViewerScaleButtons.map((button) => ({ text: button.textContent.trim(), box: box(button),
        selected: button.classList.contains('camera-original-viewer-scale-active') })) })
  if (state.selectorVisible) add('camera library selector opens with selectable production rows and a close action',
    Boolean(selectorOverlay && selectorPanel && selectorClose && selectorRows.length
      && selectorPanel.getBoundingClientRect().height > 0 && selectorRows.every((row) => row.getBoundingClientRect().height >= 44)),
    { overlay: box(selectorOverlay), panel: box(selectorPanel), close: box(selectorClose),
      rows: selectorRows.slice(0, 4).map((row) => ({ model: row.querySelector('.selector-model')?.textContent.trim() || '', box: box(row) })) })
  if (state.result) {
    add('one library result and one diagram canvas are visible', Boolean(hero && canvas) && app.querySelectorAll('#cameraFovCanvas').length === 1,
      { resultModel: state.result.displayModel, canvasCount: app.querySelectorAll('#cameraFovCanvas').length })
    const distanceLabel = labels.map((label) => label.text).find((text) =>
      /(?:\u7406\u8bba\u6700\u5c0f|\u4ec5\u6c34\u5e73).*\d+(?:\.\d+)?m/.test(text)) || ''
    const horizontalOnlyStatusLabel = labels.map((label) => label.text).find((text) =>
      /\u4ec5\u6c34\u5e73\u53c2\u8003/.test(text)) || ''
    const heightLabel = labels.map((label) => label.text).find((text) => /\u955c\u5934\u9ad8/.test(text)) || ''
    const distanceBasis = state.result.sceneMode === 'ground' ? /\u524d\u6cbf/.test(distanceLabel) : /\u5e73\u9762/.test(distanceLabel)
    const distanceSemantics = state.result.horizontalOnly
      ? /\u4ec5\u6c34\u5e73/.test(distanceLabel)
      : /\u7406\u8bba\u6700\u5c0f/.test(distanceLabel)
    if (renderInfo?.view === 'plan' || renderInfo?.view === 'elevation') {
      add('view labels state theoretical minimum versus horizontal-only lower bound with the correct scene basis',
        distanceBasis && distanceSemantics, { sceneMode: state.result.sceneMode, horizontalOnly: state.result.horizontalOnly, distanceLabel, labels })
      if (state.result.horizontalOnly) add('horizontal-only result explicitly warns vertical coverage is unchecked',
        /\u5782\u76f4\u672a\u6821\u6838/.test(horizontalOnlyStatusLabel), { horizontalOnlyStatusLabel, labels })
      add('diagram includes camera-height label with recommended versus existing semantics',
        /\u955c\u5934\u9ad8/.test(heightLabel)
          && (state.result.heightMode === 'auto' ? /\u5efa\u8bae/.test(heightLabel) : /\u5df2\u6709/.test(heightLabel)),
        { heightMode: state.result.heightMode, heightLabel, labels })
    }  } else {
    add('unsupported/invalid states expose a clear message and no fabricated canvas', !canvas
      && Boolean(app.querySelector('#cameraLegacyUnsupported') || app.querySelector('#cameraOperationUnsupported') || app.querySelector('#cameraResultEmpty')),
      { legacy: Boolean(app.querySelector('#cameraLegacyUnsupported')), operation: Boolean(app.querySelector('#cameraOperationUnsupported')),
        empty: Boolean(app.querySelector('#cameraResultEmpty')), text: app.textContent.slice(0, 500) })
    if (state.legacyCustomUnsupported) {
      add('legacy custom state offers an explicit library recovery action and a visible unsupported title',
        Boolean(app.querySelector('#cameraLegacySelectorButton')) && Boolean(app.querySelector('.camera-legacy-title')?.textContent.trim()),
        { selector: box(app.querySelector('#cameraLegacySelectorButton')), title: app.querySelector('.camera-legacy-title')?.textContent.trim() || '' })
    }    if (state.operationUnsupportedMessage) {
      add('angle-based structured operation remains explicitly unsupported', app.textContent.includes(state.operationUnsupportedMessage),
        { operationUnsupportedMessage: state.operationUnsupportedMessage })
    }
  }
  report.failures = report.checks.filter((item) => !item.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  return report
}

let expandedSource = ''
let lastRenderInfo = null

async function renderAndInspect() {
  const fixtureResponse = await fetch(`/__fixture?case=${encodeURIComponent(scenario)}&width=${innerWidth}&height=${innerHeight}&tab=${query.get('tab') || ''}&view=${query.get('view') || ''}&derive=${query.get('derive') || ''}`, { cache: 'no-store' })
  const payload = await fixtureResponse.json()
  if (!fixtureResponse.ok || !payload.sessionId) throw new Error(payload.error || `Fixture HTTP ${fixtureResponse.status}`)
  fixture = payload
  const metaResponse = await fetch('/__qa-meta', { cache: 'no-store' })
  const meta = await metaResponse.json()
  if (!metaResponse.ok || JSON.stringify(meta.loadedHashes) !== JSON.stringify(payload.loadedHashes)) throw new Error('Camera source changed while bridge was running')
  await installProductionStyles()
  await findProductionResultHeightSelector()
  await loadProductionRenderer()
  expandedSource = await expandWxmlIncludes('/pages/camera/camera.wxml')
  app.dataset.cameraSession = fixture.sessionId
  app.style.zoom = '1'
  app.innerHTML = ''
  await renderProductionWxml(fixture.state)
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  window.__cameraFixture = fixture
  await syncMeasuredResultHeroHeight()
  if (payload.pendingAction) {
    await dispatch(payload.pendingAction.handler, payload.pendingAction.dataset || {}, payload.pendingAction.detail || {})
  }
  const renderInfo = drawProductionCanvas(fixture.state)
  lastRenderInfo = renderInfo
  const report = inspectPage(fixture.state, renderInfo)
  report.styleThemeBridge = document.documentElement.dataset.cameraQaStyleThemeBridge || 'not-applied'
  report.theme = query.get('theme') || 'light'
  window.__cameraQa = report
  reportElement.hidden = false
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = 'working'
  document.title = `Camera QA working: ${qaCase}`
  return report
}

function captureUiState() {
  const active = document.activeElement
  const scroll = app.querySelector('.page-scroll')
  const field = active?.matches('input[data-field]') ? active.dataset.field : null
  return {
    field,
    value: field ? active.value : undefined,
    selectionStart: field && typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: field && typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
    scrollTop: scroll?.scrollTop ?? 0,
  }
}

function restoreUiState(snapshot) {
  if (!snapshot) return
  const scroll = app.querySelector('.page-scroll')
  if (scroll) scroll.scrollTop = snapshot.scrollTop
  if (!snapshot.field) return
  const input = [...app.querySelectorAll('input[data-field]')].find((item) => item.dataset.field === snapshot.field)
  if (!input) return
  input.focus({ preventScroll: true })
  if (snapshot.selectionStart !== null && typeof input.setSelectionRange === 'function') {
    const end = Math.min(input.value.length, snapshot.selectionEnd ?? snapshot.selectionStart)
    input.setSelectionRange(Math.min(input.value.length, snapshot.selectionStart), end)
  }
}

async function syncMeasuredResultHeroHeight(snapshot = null) {
  if (!fixture?.sessionId || !fixture.state?.result) return null
  const selectors = [...new Set([resultHeightSelector, '#cameraResultHero', '#cameraResultTail'])]
  const measurements = Object.fromEntries(selectors.flatMap((selector) => {
    const element = app.querySelector(selector)
    const height = element?.getBoundingClientRect().height
    return Number.isFinite(height) && height > 0 ? [[selector, Number(height.toFixed(2))]] : []
  }))
  if (!measurements[resultHeightSelector]) return null
  const response = await fetch('/__measure-dom', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: fixture.sessionId, measurements }),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `Hero measurement HTTP ${response.status}`)
  const previousStyle = fixture.state.resultPlaceholderStyle || ''
  const previousTailStyle = fixture.state.resultTailPlaceholderStyle || ''
  fixture.state = value.state
  const storedHeroHeight = parseFloat(String(fixture.state.resultPlaceholderStyle || '').match(/min-height\s*:\s*([\d.]+)px/i)?.[1] || '') || null
  const storedTailHeight = parseFloat(String(fixture.state.resultTailPlaceholderStyle || '').match(/(?:height|min-height)\s*:\s*([\d.]+)px/i)?.[1] || '') || null
  const heroHeight = measurements['#cameraResultHero'] || null
  const tailHeight = measurements['#cameraResultTail'] || null
  lastHeroMeasurement = {
    captureSelector: resultHeightSelector,
    measurements,
    storedHeroPlaceholderHeight: storedHeroHeight,
    storedTailPlaceholderHeight: storedTailHeight,
    heroHeightMatches: storedHeroHeight === Math.ceil(heroHeight),
    tailHeightMatches: storedTailHeight === Math.ceil(tailHeight),
  }
  if (previousStyle !== (fixture.state.resultPlaceholderStyle || '')
    || previousTailStyle !== (fixture.state.resultTailPlaceholderStyle || '')) {
    await renderProductionWxml(fixture.state)
    restoreUiState(snapshot)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }
  return lastHeroMeasurement
}

async function renderCurrentState(snapshot = null) {
  await renderProductionWxml(fixture.state)
  restoreUiState(snapshot)
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await syncMeasuredResultHeroHeight(snapshot)
  if (typeof window.__cameraWaitForStablePaint === 'function') await window.__cameraWaitForStablePaint()
  const renderInfo = drawProductionCanvas(fixture.state)
  lastRenderInfo = renderInfo
  const report = inspectPage(fixture.state, renderInfo)
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

async function dispatch(method, dataset = {}, detail = {}, snapshot = captureUiState()) {
  const response = await fetch('/__event', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: fixture.sessionId, handler: method, dataset, detail }),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `Camera event HTTP ${response.status}`)
  fixture.state = value.state
  return renderCurrentState(snapshot)
}

async function refreshState() {
  const snapshot = captureUiState()
  const response = await fetch(`/__state?sessionId=${encodeURIComponent(fixture.sessionId)}`, { cache: 'no-store' })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `Camera state HTTP ${response.status}`)
  fixture.state = value.state
  return renderCurrentState(snapshot)
}

window.__cameraDispatch = dispatch
window.__cameraReinspect = () => {
  const previous = window.__cameraQa || {}
  const report = inspectPage(fixture.state, lastRenderInfo)
  const currentCheckNames = new Set(report.checks.map((check) => check.name))
  const supplementalChecks = (previous.checks || []).filter((check) => !currentCheckNames.has(check.name))
  report.checks.push(...supplementalChecks)
  for (const key of ['interaction', 'projectKeyboardSimulation', 'reportImage']) {
    if (previous[key] !== undefined) report[key] = previous[key]
  }
  report.domReinspection = {
    performed: true,
    source: 'same rendered DOM after cameraWaitForStablePaint; no WXML rerender or animation restart',
    canvasTraceReused: Boolean(lastRenderInfo),
  }
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}
window.__cameraClickInputTab = (index) => dispatch('onInputTabTap', { index: String(index) })
window.__cameraClickPreviewView = (index) => dispatch('onPreviewViewTap', { index: String(index) })
window.__cameraSelectInputTab = (index) => {
  expectedInputTabIndex = Number(index)
  return dispatch('onInputTabTap', { index: String(index) })
}
window.__cameraActivateInputTab = async (index) => {
  expectedInputTabIndex = Number(index)
  const tab = app.querySelectorAll('#cameraInputTabs .camera-input-tab')[expectedInputTabIndex]
  if (!tab) throw new Error(`Production input tab ${expectedInputTabIndex} is missing.`)
  tab.click()
  await window.__cameraLastDispatch
  await window.__cameraWaitForStablePaint()
  return window.__cameraQa
}
window.__cameraRefreshState = refreshState
window.__cameraLastDispatch = Promise.resolve(null)

async function clickProductionElement(selector) {
  const element = app.querySelector(selector)
  if (!element) throw new Error(`Production browser element is missing: ${selector}`)
  element.click()
  await window.__cameraLastDispatch
  await nextTwoFrames()
  return element
}

async function typeProductionInput(selector, value) {
  const element = app.querySelector(selector)
  if (!element) throw new Error(`Production input is missing: ${selector}`)
  element.focus({ preventScroll: true })
  element.value = String(value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await window.__cameraLastDispatch
  await window.__cameraWaitForStablePaint()
  return element
}

window.__cameraGetStorageState = async () => {
  const response = await fetch(`/__storage-state?sessionId=${encodeURIComponent(fixture.sessionId)}`, { cache: 'no-store' })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `Camera storage state HTTP ${response.status}`)
  return value
}

window.__cameraRunPendingActionHideRace = async (handler) => {
  const response = await fetch('/__pending-action-hide', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: fixture.sessionId, handler }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Pending action hide race HTTP ${response.status}`)
  fixture.state = (await (await fetch(`/__state?sessionId=${encodeURIComponent(fixture.sessionId)}`)).json()).state
  await renderCurrentState()
  const report = window.__cameraQa
  report.interaction = result
  report.checks.push({ name: `a queued ${handler === 'generateResultReportImage' ? 'report' : 'project'} action is canceled when hide invalidates its pending-calculation callback without writing a record or project`,
    passed: result.inputState.resultUpdating && result.queuedSetDataCallbacks > 0
      && !result.final.previewVisible && !result.final.generating && result.final.pendingCanvasExports === 0
      && !result.final.projectDialogVisible && !result.final.projectSaving && result.final.recordCount === 0
      && !result.final.wroteRecordDuringRace && !result.final.wroteProjectDuringRace,
    detail: result })
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

window.__cameraOpenProject = () => dispatch('openCameraProjectDialog')
window.__cameraProjectSearch = (value) => dispatch('onCameraProjectSearch', {}, { value })
window.__cameraSelectProject = (id) => dispatch('selectCameraProjectTarget', { id })
window.__cameraProjectInput = (handler, value) => dispatch(handler, {}, { value })
window.__cameraProjectKeyboardHeight = async (height) => {
  const field = app.querySelector('#projectSearchText, #projectNameText, #projectConfigName, #projectConfigNote')
  if (!field) throw new Error('No active production project input for keyboard-height simulation.')
  const dataset = { ...field.dataset }
  if (typeof fixture.pageHandlers?.includes === 'function'
    && fixture.pageHandlers.includes('beginCameraProjectInputFocus')) {
    await dispatch('beginCameraProjectInputFocus', dataset, {}, captureUiState())
  }
  const current = fixture.state
  const focusDataset = { ...dataset, dialogRevision: String(current.projectDialogRevision),
    focusEpisode: String(current.projectFocusEpisode) }
  const response = await fetch('/__event', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: fixture.sessionId, handler: 'onCameraProjectKeyboardHeightChange',
      dataset: focusDataset, detail: { height } }),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `Project keyboard-height HTTP ${response.status}`)
  fixture.state = value.state
  const report = await renderCurrentState()
  report.projectKeyboardSimulation = { height: Number(height), nativeKeyboard: false,
    note: 'The browser harness dispatched the production keyboard-height controller event; it does not open a native IME.' }
  const safeBottom = innerHeight - Number(height)
  const footerButtons = [...app.querySelectorAll('.camera-project-footer button')].map((button) => ({
    text: button.textContent.trim(), rect: box(button), reachableAboveKeyboard: button.getBoundingClientRect().bottom <= safeBottom + 1,
  }))
  report.projectKeyboardSimulation.safeBottom = safeBottom
  report.projectKeyboardSimulation.footerButtons = footerButtons
  report.checks.push({ name: 'project primary action remains visible above the simulated keyboard in a short viewport',
    passed: footerButtons.length > 0 && footerButtons.every((button) => button.reachableAboveKeyboard),
    detail: report.projectKeyboardSimulation })
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  return report
}

window.__cameraRunProjectInteraction = async (kind) => {
  let interaction = { kind }
  if (kind === 'project-search-empty') {
    await typeProductionInput('#projectSearchText', 'no-matching-v5-project')
    interaction = { ...interaction, search: fixture.state.projectSearchText,
      filteredCount: fixture.state.filteredProjects?.length || 0,
      emptyStateVisible: Boolean(app.querySelector('.camera-project-empty')) }
  } else if (kind === 'project-back') {
    const back = app.querySelector('.camera-project-footer [data-bindtap="returnToCameraProjectSelection"]')
    if (!back) throw new Error('Production project-list back button is missing.')
    back.click()
    await window.__cameraLastDispatch
    interaction = { ...interaction, step: fixture.state.projectDialogStep,
      target: fixture.state.projectTarget || null }
  } else if (kind === 'project-create-save') {
    const before = await window.__cameraGetStorageState()
    await typeProductionInput('#projectNameText', 'V5 QA场地')
    await clickProductionElement('.camera-project-footer [data-bindtap="createCameraProjectFromForm"]')
    const stepAfterCreate = fixture.state.projectDialogStep
    await typeProductionInput('#projectConfigName', 'V5相机安装 A')
    await typeProductionInput('#projectConfigNote', '北墙；现场确认布线路径。')
    await clickProductionElement('.camera-project-footer [data-bindtap="saveCameraProjectTarget"]')
    await window.__cameraWaitForStablePaint()
    const after = await window.__cameraGetStorageState()
    interaction = { ...interaction, before, after, stepAfterCreate, finalStep: fixture.state.projectDialogStep,
      savedConfigName: fixture.state.projectSavedConfigName || '', target: fixture.state.projectTarget || null }
    const savedRecord = after.records.find((record) => record.module === 'camera'
      && record.projectIds?.includes(interaction.target?.id))
    interaction.savedRecord = savedRecord ? { title: savedRecord.title, projectMetadata: savedRecord.projectMetadata } : null
  } else if (kind === 'project-cancel' || kind === 'project-cancel-reopen') {
    const before = await window.__cameraGetStorageState()
    const closeButton = app.querySelector('.camera-project-close')
    if (!closeButton) throw new Error('Production project dialog close button is unavailable.')
    closeButton.click()
    await window.__cameraLastDispatch
    await new Promise((resolve) => setTimeout(resolve, 360))
    await refreshState()
    const afterClose = await window.__cameraGetStorageState()
    const dialogClosed = !fixture.state.projectDialogVisible
    if (kind === 'project-cancel-reopen') {
      await clickProductionElement('#cameraProject')
      await window.__cameraWaitForStablePaint()
    }
    interaction = { ...interaction, before, afterClose, reopenedStep: fixture.state.projectDialogStep || '',
      dialogClosed }
  } else {
    throw new Error(`Unknown V5 project interaction: ${kind}`)
  }
  const report = window.__cameraQa
  report.interaction = interaction
  if (kind === 'project-search-empty') report.checks.push({
    name: 'production project search filters to the true no-results state',
    passed: interaction.filteredCount === 0 && interaction.emptyStateVisible,
    detail: interaction,
  })
  else if (kind === 'project-back') report.checks.push({
    name: 'production project confirmation back action returns to selection without replacing the target',
    passed: interaction.step === 'select' && interaction.target === null,
    detail: interaction,
  })
  else if (kind === 'project-create-save') report.checks.push({
    name: 'production create-project, configuration name/note, and save flow reaches verified success',
    passed: interaction.stepAfterCreate === 'confirm' && interaction.finalStep === 'success'
      && interaction.savedConfigName === 'V5相机安装 A'
      && interaction.after.projects.length === interaction.before.projects.length + 1
      && Boolean(interaction.savedRecord?.projectMetadata),
    detail: interaction,
  })
  else report.checks.push({
    name: kind === 'project-cancel-reopen'
      ? 'closing the create form writes no project or camera record and the dialog can reopen'
      : 'canceling project confirmation writes no camera record or metadata',
    passed: interaction.dialogClosed
      && interaction.before.projects.length === interaction.afterClose.projects.length
      && interaction.before.records.length === interaction.afterClose.records.length
      && interaction.before.storageWrites === interaction.afterClose.storageWrites
      && (kind !== 'project-cancel-reopen' || interaction.reopenedStep === 'select'),
    detail: interaction,
  })
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

window.__cameraClickProjectAction = async () => {
  await clickProductionElement('#cameraProject')
  await window.__cameraWaitForStablePaint()
  const report = window.__cameraQa
  report.interaction = { action: '#cameraProject', projectDialogVisible: Boolean(fixture.state.projectDialogVisible),
    projectDialogStep: fixture.state.projectDialogStep || '' }
  report.checks.push({ name: 'result action rail opens the production project selector',
    passed: fixture.state.projectDialogVisible && fixture.state.projectDialogStep === 'select', detail: report.interaction })
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

window.__cameraRunSelectorInteraction = async (kind) => {
  await clickProductionElement('#cameraModelPicker')
  const opened = Boolean(fixture.state.selectorVisible && app.querySelector('.selector-panel'))
  const initialRows = app.querySelectorAll('.selector-row').length
  let closed = false
  let selectedModel = ''
  if (kind === 'camera-selector-close-select') {
    await clickProductionElement('.selector-close')
    closed = !fixture.state.selectorVisible
    await clickProductionElement('#cameraModelPicker')
    const previousModel = fixture.state.result?.displayModel || ''
    const row = [...app.querySelectorAll('.selector-row')].find((candidate) =>
      candidate.querySelector('.selector-model')?.textContent.trim() !== previousModel)
    if (!row) throw new Error('Camera selector has no alternate production library model to select.')
    selectedModel = row.querySelector('.selector-model')?.textContent.trim() || ''
    row.click()
    await window.__cameraLastDispatch
    await window.__cameraWaitForStablePaint()
  }
  const report = window.__cameraQa
  report.interaction = { kind, opened, initialRows, closed, selectedModel,
    finalModel: fixture.state.result?.displayModel || '', selectorVisible: Boolean(fixture.state.selectorVisible) }
  if (kind === 'camera-selector-open') report.checks.push({
    name: 'camera selector button opens its production model list',
    passed: opened && initialRows > 0 && fixture.state.selectorVisible, detail: report.interaction,
  })
  else report.checks.push({
    name: 'camera selector close works and selecting a library row updates the result',
    passed: opened && closed && !fixture.state.selectorVisible && Boolean(selectedModel)
      && report.interaction.finalModel === selectedModel && Boolean(fixture.state.result), detail: report.interaction,
  })
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

window.__cameraRunReportInteraction = async (kind) => {
  if (!fixture.state.resultReportPreviewVisible) await window.__cameraRenderProductionReportPreview()
  if (kind === 'share-cancel-return') {
    const beforeStorage = await window.__cameraGetStorageState()
    await clickProductionElement('.result-report-preview-close')
    await new Promise((resolve) => setTimeout(resolve, 360))
    await refreshState()
    const afterStorage = await window.__cameraGetStorageState()
    const report = window.__cameraQa
    report.interaction = { kind, previewVisible: Boolean(fixture.state.resultReportPreviewVisible),
      resultVisible: Boolean(fixture.state.result), beforeStorage, afterStorage }
    report.checks.push({ name: 'closing the production image preview returns to the unchanged camera result without a storage write',
      passed: !fixture.state.resultReportPreviewVisible && Boolean(fixture.state.result)
        && beforeStorage.storageWrites === afterStorage.storageWrites
        && beforeStorage.records.length === afterStorage.records.length,
      detail: report.interaction })
    report.failures = report.checks.filter((check) => !check.passed)
    report.status = report.failures.length ? 'failed' : 'passed'
    window.__cameraQa = report
    reportElement.textContent = JSON.stringify(report)
    document.body.dataset.qaStatus = report.status
    return report
  }
  const image = app.querySelector('.result-report-preview-image')
  if (!image) throw new Error('Production report preview image is missing.')
  image.click()
  await window.__cameraLastDispatch
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextTwoFrames()
    const viewerImage = app.querySelector('.camera-original-viewer-image')
    if (fixture.state.resultReportImageViewerVisible && viewerImage?.complete && viewerImage.naturalWidth === 750) break
  }
  if (!fixture.state.resultReportImageViewerVisible) {
    throw new Error(`Production report viewer did not open after tapping the preview image: ${JSON.stringify({
      previewVisible: fixture.state.resultReportPreviewVisible,
      viewerVisible: fixture.state.resultReportImageViewerVisible,
      imagePathScheme: String(fixture.state.resultReportImagePath || '').slice(0, 32),
      browserError: document.documentElement.dataset.cameraQaError || '',
    })}`)
  }
  if (kind === 'viewer-return') {
    await clickProductionElement('.camera-original-viewer-back')
    await window.__cameraWaitForStablePaint()
  } else {
    await clickProductionElement('.camera-original-viewer-scale[data-scale="300"]')
    await nextTwoFrames()
  }
  const report = window.__cameraQa
  report.interaction = { kind, viewerVisible: Boolean(fixture.state.resultReportImageViewerVisible),
    previewVisible: Boolean(fixture.state.resultReportPreviewVisible), scale: fixture.state.resultReportImageViewerScale || 100,
    imageWidth: app.querySelector('.camera-original-viewer-image')?.naturalWidth || 0 }
  report.checks.push({ name: kind === 'viewer-return'
    ? 'original image viewer back action returns to the report preview'
    : 'production report image opens in the original viewer and accepts 300 percent zoom',
  passed: kind === 'viewer-return'
    ? !report.interaction.viewerVisible && report.interaction.previewVisible
    : report.interaction.viewerVisible && report.interaction.scale === 300 && report.interaction.imageWidth === 750,
  detail: report.interaction })
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

function nextTwoFrames() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

window.__cameraWaitForStablePaint = async () => {
  let last = null
  let lastModalSignature = null
  let stableModalFrames = 0
  if (app.querySelector('.result-report-preview-sheet, .camera-project-sheet, .camera-original-image-viewer')) {
    // The miniapp sheets have finite 320 ms entrance/exit animations. Waiting
    // past that duration avoids sampling an off-screen animation frame when
    // browser animation bookkeeping is unavailable for injected WXML styles.
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await nextTwoFrames()
    const inputCard = app.querySelector('#cameraInputCard')
    const inputTabs = app.querySelector('#cameraInputTabs')
    const panel = app.querySelector('#cameraInputPanelCamera, #cameraInputPanelTarget, #cameraInputPanelInstall')
    const canvas = app.querySelector('#cameraFovCanvas')
    const image = app.querySelector('.result-report-preview-image')
    const modalRects = ['.result-report-preview-sheet', '.camera-project-sheet', '.camera-original-image-viewer']
      .map((selector) => app.querySelector(selector)?.getBoundingClientRect())
      .filter((rect) => rect && rect.width > 0 && rect.height > 0)
    const modalSignature = JSON.stringify(modalRects.map((rect) => [rect.x, rect.y, rect.width, rect.height]
      .map((value) => Math.round(value * 10) / 10)))
    stableModalFrames = modalSignature === lastModalSignature ? stableModalFrames + 1 : 0
    lastModalSignature = modalSignature
    const boxes = [inputCard, inputTabs, panel].map((element) => element?.getBoundingClientRect())
    const imageReady = !image || (image.complete && image.naturalWidth > 0)
    last = { inputCard: boxes[0]?.height || 0, inputTabs: boxes[1]?.height || 0,
      inputPanel: boxes[2]?.height || 0, canvas: canvas ? box(canvas) : null,
      reportImageReady: imageReady }
    if (stableModalFrames >= 2 && boxes.every((rect) => rect && rect.width > 0 && rect.height > 0)
      && (!fixture.state.result || (canvas && canvas.getBoundingClientRect().width > 0)) && imageReady) return last
  }
  throw new Error(`Camera page failed stable-paint check: ${JSON.stringify(last)}`)
}

window.__cameraRenderProductionReportPreview = async () => {
  if (typeof reportDrawResult !== 'function') await loadProductionReportRenderer()
  const response = await fetch(`/__report-export-state?sessionId=${encodeURIComponent(fixture.sessionId)}`, { cache: 'no-store' })
  const exportState = await response.json()
  if (!response.ok) throw new Error(exportState.error || `Report export state HTTP ${response.status}`)
  const canvas = app.querySelector('#resultReportCanvas')
  if (!canvas) throw new Error('Production report canvas is missing from WXML.')
  canvas.width = exportState.width
  canvas.height = exportState.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Browser cannot create a real 2D context for the production report canvas.')
  const reportTextDraws = []
  reportRendererCalls = []
  reportDrawResult(adaptLegacyReportContext(context, (text) => reportTextDraws.push(text)), exportState.payload, exportState.height)
  const dataUrl = canvas.toDataURL('image/png')
  const finishResponse = await fetch('/__finish-report-export', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: fixture.sessionId, dataUrl }),
  })
  const finished = await finishResponse.json()
  if (!finishResponse.ok) throw new Error(finished.error || `Report export callback HTTP ${finishResponse.status}`)
  fixture.state = finished.state
  await renderCurrentState()
  const stablePaint = await window.__cameraWaitForStablePaint()
  const report = window.__cameraQa
  const image = app.querySelector('.result-report-preview-image')
  const dimensions = Array.isArray(exportState.payload.dimensions) ? exportState.payload.dimensions : []
  const dimensionTextDrawn = dimensions.every((entry) => {
    const label = String(entry.label ?? '')
    const value = String(entry.value ?? '')
    return Boolean(label && value)
      && reportTextDraws.some((text) => text.includes(label))
      && reportTextDraws.some((text) => text.includes(value))
  })
  const distanceText = [exportState.payload.distanceLabel, exportState.payload.distanceValue,
    exportState.payload.distanceReferenceText].map((value) => String(value ?? '')).filter(Boolean)
  const distanceTextDrawn = distanceText.every((value) => reportTextDraws.some((text) => text.includes(value)))
  const expectedViews = Array.isArray(exportState.payload.views)
    ? exportState.payload.views.map((view) => view.key) : []
  const actualViewCalls = reportRendererCalls.map((call) => call.viewKey)
  const bothViewsDrawn = expectedViews.length === 2
    && expectedViews[0] === 'plan' && expectedViews[1] === 'elevation'
    && actualViewCalls.length === 2 && actualViewCalls[0] === 'plan' && actualViewCalls[1] === 'elevation'
    && reportRendererCalls.every((call) => call.width === 331 && call.height === 180)
  const actualReport = {
    renderer: 'pages/camera/camera-report.js::drawCameraReport',
    canvas: { width: exportState.width, height: exportState.height },
    mimeType: 'image/png',
    dataUrlBytes: dataUrl.length,
    dataUrl,
    viewCalls: reportRendererCalls,
    reportTextDraws,
    dimensions,
    dimensionTextDrawn,
    distanceText,
    distanceTextDrawn,
    bothViewsDrawn,
    image: image ? { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      complete: image.complete, srcScheme: image.src.startsWith('data:image/png;base64,') ? 'data:image/png;base64' : 'other' } : null,
    stablePaint,
  }
  report.reportImage = actualReport
  report.checks.push({ name: 'share preview is drawn by the production camera report renderer with both real preview diagrams and dimension text',
    passed: actualReport.renderer === 'pages/camera/camera-report.js::drawCameraReport'
      && actualReport.mimeType === 'image/png' && actualReport.canvas.width === 750
      && actualReport.canvas.height > 0 && actualReport.dataUrlBytes > 1000
      && actualReport.image?.complete && actualReport.image.naturalWidth === 750
      && actualReport.image.srcScheme === 'data:image/png;base64'
      && actualReport.bothViewsDrawn && actualReport.dimensionTextDrawn && actualReport.distanceTextDrawn,
    detail: actualReport })
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

window.__cameraRunClearRefill = async () => {
  await window.__cameraSelectInputTab(1)
  await window.__cameraWaitForStablePaint()
  const field = 'groundWidthText'
  const inputSelector = `#cameraInputPanelTarget input[data-field="${field}"]`
  const scroll = app.querySelector('.page-scroll')
  let input = app.querySelector(inputSelector)
  if (!input || !scroll) throw new Error('Target width input or page scroll container is missing.')
  input.scrollIntoView({ block: 'center', inline: 'nearest' })
  input.focus({ preventScroll: true })
  await nextTwoFrames()
  const measure = () => {
    const activeInput = app.querySelector(inputSelector)
    const rect = activeInput?.getBoundingClientRect()
    const activeScroll = app.querySelector('.page-scroll')
    return {
      inputTop: rect ? Number(rect.top.toFixed(2)) : null,
      inputBottom: rect ? Number(rect.bottom.toFixed(2)) : null,
      inputHeight: rect ? Number(rect.height.toFixed(2)) : null,
      documentTop: rect && activeScroll ? Number((rect.top + activeScroll.scrollTop).toFixed(2)) : null,
      scrollTop: activeScroll ? Number(activeScroll.scrollTop.toFixed(2)) : null,
      scrollHeight: activeScroll ? Number(activeScroll.scrollHeight.toFixed(2)) : null,
      clientHeight: activeScroll ? Number(activeScroll.clientHeight.toFixed(2)) : null,
      focused: Boolean(activeInput && document.activeElement === activeInput),
    }
  }
  const before = measure()
  await dispatch('onFieldInput', { field }, { value: '' })
  await nextTwoFrames()
  const cleared = measure()
  const clearedState = {
    hasResult: Boolean(fixture.state.result),
    hasFieldError: Boolean(fixture.state.inputErrors?.[field]),
    emptyPanel: Boolean(app.querySelector('#cameraResultEmpty')),
  }
  await dispatch('onFieldInput', { field }, { value: '6' })
  await dispatch('onFieldBlur', { field }, { value: '6' })
  await refreshState()
  await window.__cameraWaitForStablePaint()
  const refilled = measure()
  const state = {
    hasResult: Boolean(fixture.state.result),
    resultUpdating: Boolean(fixture.state.resultUpdating),
    fieldValue: app.querySelector(inputSelector)?.value ?? null,
    resultDistanceMeters: fixture.state.result?.primaryDistanceMeters ?? null,
  }
  const positionDrift = Math.max(Math.abs(before.inputTop - cleared.inputTop), Math.abs(before.inputTop - refilled.inputTop))
  const scrollDrift = Math.max(Math.abs(before.scrollTop - cleared.scrollTop), Math.abs(before.scrollTop - refilled.scrollTop))
  const result = { field, before, cleared, refilled, clearedState, finalState: state,
    maxInputTopDrift: Number(positionDrift.toFixed(2)), maxScrollTopDrift: Number(scrollDrift.toFixed(2)) }
  const renderInfo = drawProductionCanvas(fixture.state)
  const report = inspectPage(fixture.state, renderInfo)
  report.interaction = result
  report.checks.push({ name: 'clearing and refilling a target field preserves its visible input position and scroll offset',
    passed: Number.isFinite(positionDrift) && positionDrift <= 2 && Number.isFinite(scrollDrift) && scrollDrift <= 2
      && cleared.inputHeight > 0 && state.fieldValue === '6',
    detail: { maxInputTopDrift: result.maxInputTopDrift, maxScrollTopDrift: result.maxScrollTopDrift,
      before, cleared, refilled } })
  report.checks.push({ name: 'invalid clear immediately removes the result and refill settles to a fresh result',
    passed: !clearedState.hasResult && clearedState.hasFieldError && state.hasResult && !state.resultUpdating
      && Number.isFinite(state.resultDistanceMeters),
    detail: { clearedState, finalState: state } })
  report.failures = report.checks.filter((check) => !check.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-bindtap], [data-catchtap]')
  if (!target) return
  const handler = target.dataset.bindtap || target.dataset.catchtap
  if (handler) {
    window.__cameraLastDispatch = dispatch(handler, { ...target.dataset })
      .catch((error) => { document.documentElement.dataset.cameraQaError = String(error); throw error })
  }
})

document.addEventListener('input', (event) => {
  const target = event.target.closest('[data-bindinput]')
  if (!target) return
  const handler = target.dataset.bindinput
  if (handler) {
    window.__cameraLastDispatch = dispatch(handler, { ...target.dataset }, { value: target.value })
      .catch((error) => { document.documentElement.dataset.cameraQaError = String(error); throw error })
  }
})

document.addEventListener('blur', (event) => {
  const target = event.target.closest('[data-bindblur]')
  if (!target) return
  const handler = target.dataset.bindblur
  if (handler) {
    window.__cameraLastDispatch = dispatch(handler, { ...target.dataset }, { value: target.value })
      .catch((error) => { document.documentElement.dataset.cameraQaError = String(error); throw error })
  }
}, true)

window.__cameraMeasureInstallationControls = async () => {
  await window.__cameraActivateInputTab(2)
  await window.__cameraWaitForStablePaint()
  const grid = app.querySelector('#cameraInputPanelInstall .installation-control-grid')
  const modeChoices = [...(grid?.querySelectorAll('.installation-mode-choice') || [])]
  const marginPicker = grid?.querySelector('.installation-margin-picker') || null
  const controls = [...modeChoices, marginPicker].filter(Boolean)
  const boxes = controls.map((element) => box(element))
  const state = fixture.state || {}
  const fixedField = app.querySelector('#cameraFixedHeightField')
  const fixedFieldBox = box(fixedField)
  const fixedInputWrap = fixedField?.querySelector('.input-wrap') || null
  const fixedInputWrapBox = box(fixedInputWrap)
  const expectedFixed = state.heightMode === 'fixed'
  const visibleFixed = Boolean(fixedField && fixedFieldBox.height > 0)
  const widths = boxes.map((item) => item.width)
  const equalWidths = widths.length === 3 && widths.every((value) => Math.abs(value - widths[0]) <= 0.5)
  const height52 = boxes.length === 3 && boxes.every((item) => Math.abs(item.height - 52) <= 0.5)
  const labels = modeChoices.map((element) => ({
    text: element.textContent.trim(), ariaLabel: element.getAttribute('aria-label') || '',
    index: element.dataset.index || '', box: box(element),
  }))
  const marginText = marginPicker?.textContent.trim() || ''
  const heightLabel = app.querySelector('#cameraInstallHeightLabel')
  const marginLabel = app.querySelector('#cameraInstallMarginLabel')
  const report = window.__cameraQa || { checks: [] }
  report.interaction = { kind: 'install-controls', heightMode: state.heightMode, marginPercent: state.marginPercent,
    grid: box(grid), controls: controls.map((element, index) => ({
      selector: element.className || element.tagName.toLowerCase(), text: element.textContent.trim(), box: boxes[index],
      minHeight: getComputedStyle(element).minHeight, borderRadius: getComputedStyle(element).borderRadius,
    })), labels, marginText, fixedField: fixedFieldBox, fixedInputWrap: fixedInputWrapBox,
    heightLabel: box(heightLabel), marginLabel: box(marginLabel) }
  const add = (name, passed, detail) => report.checks.push({ name, passed: Boolean(passed), detail })
  add('installation exposes two height choices and one margin picker in the three-column grid',
    Boolean(grid && modeChoices.length === 2 && marginPicker && controls.length === 3), report.interaction)
  add('automatic, fixed, and margin controls share equal widths and a 52px height',
    equalWidths && height52 && controls.every((element) => getComputedStyle(element).boxSizing === 'border-box'), report.interaction)
  add('installation choices have the concise visible labels and accessible full labels',
    labels.length === 2 && labels[0].text === '自动' && labels[0].ariaLabel === '自动建议高度'
      && labels[1].text === '固定' && labels[1].ariaLabel === '已有安装高度', labels)
  add('margin picker reflects the selected available margin value',
    marginText.includes(`${state.marginPercent}%`) && [0, 5, 10, 15, 20].includes(Number(state.marginPercent)),
    { marginText, marginPercent: state.marginPercent })
  add('fixed-height input appears below the controls only in fixed mode and retains a 52px row',
    visibleFixed === expectedFixed && (!expectedFixed || (fixedInputWrapBox.height >= 51.5
      && fixedFieldBox.top >= Math.max(...boxes.map((item) => item.bottom)) - 0.5)),
    { expectedFixed, visibleFixed, fixedField: fixedFieldBox, fixedInputWrap: fixedInputWrapBox, controls: boxes })
  report.failures = report.checks.filter((item) => !item.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

window.__cameraRunResetAcceptance = async (interaction) => {
  const kind = String(interaction || '').replace(/^reset-/, '')
  const numericFields = ['groundWidthText', 'groundDepthText', 'subjectHeightText', 'planeWidthText',
    'planeHeightText', 'planeBottomHeightText', 'fixedCameraHeightText', 'customHorizontalFovText',
    'customVerticalFovText', 'customSensorWidthText', 'customSensorHeightText', 'customFocalLengthText']
  const getDiagnostics = async () => {
    const response = await fetch(`/__camera-diagnostics?sessionId=${encodeURIComponent(fixture.sessionId)}`, { cache: 'no-store' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || `Camera diagnostics HTTP ${response.status}`)
    return payload
  }
  const report = window.__cameraQa || { checks: [] }
  const before = await getDiagnostics()
  let cachedReport = null
  if (kind === 'shared-cache') {
    cachedReport = await window.__cameraRenderProductionReportPreview()
  }
  const prepared = await getDiagnostics()
  const startState = before.state || {}
  const resetPrecondition = kind === 'valid' ? Boolean(startState.result)
    : kind === 'invalid' ? (!startState.result && Object.values(startState.inputErrors || {}).some(Boolean))
      : kind === 'pending' ? (Boolean(before.hasCalculationTimer) || Boolean(startState.resultUpdating))
        : kind === 'shared-cache' ? (Boolean(cachedReport?.reportImage?.image?.complete)
          && Boolean(prepared.reportSignature) && Boolean(prepared.reportImagePath))
          : kind === 'legacy' ? Boolean(startState.legacyCustomUnsupported) : false
  const add = (name, passed, detail) => report.checks.push({ name, passed: Boolean(passed), detail })
  add('reset scenario begins in its intended valid/invalid/pending/cache/legacy state', resetPrecondition,
    { kind, result: Boolean(startState.result), inputErrors: startState.inputErrors || {},
      hasCalculationTimer: before.hasCalculationTimer, resultUpdating: Boolean(startState.resultUpdating),
      legacyCustomUnsupported: Boolean(startState.legacyCustomUnsupported), cachedReportImage: cachedReport?.reportImage || null,
      preparedSignature: prepared.reportSignature, preparedImagePath: prepared.reportImagePath })
  await clickProductionElement('#cameraReset')
  await window.__cameraWaitForStablePaint()
  let after = await getDiagnostics()
  fixture.state = after.state
  const beforeState = prepared.state || before.state || {}
  const afterState = after.state || {}
  const stateValues = Object.fromEntries(numericFields.map((field) => [field, afterState[field] ?? '']))
  const preferenceValues = Object.fromEntries(numericFields.map((field) => [field, after.preferences?.[field] ?? '']))
  const filledStateFields = Object.entries(stateValues).filter(([, value]) => String(value).trim() !== '').map(([field]) => field)
  const filledPreferenceFields = Object.entries(preferenceValues).filter(([, value]) => String(value).trim() !== '').map(([field]) => field)
  const inputErrors = afterState.inputErrors && typeof afterState.inputErrors === 'object' ? afterState.inputErrors : {}
  const activeErrors = Object.entries(inputErrors).filter(([, value]) => Boolean(value)).map(([field]) => field)
  const resultActions = ['#cameraShare', '#cameraFavorite', '#cameraProject'].map((selector) => {
    const element = app.querySelector(selector)
    return { selector, exists: Boolean(element), disabled: Boolean(element?.disabled) }
  })
  const resetState = {
    kind,
    started: { hasResult: Boolean(beforeState.result), resultUpdating: Boolean(beforeState.resultUpdating),
      hasCalculationTimer: Boolean(before.hasCalculationTimer), legacyCustomUnsupported: Boolean(beforeState.legacyCustomUnsupported),
      reportSignature: prepared.reportSignature, reportImagePath: prepared.reportImagePath },
    after: { model: afterState.selectedCamera?.model || '', sceneMode: afterState.sceneMode || '',
      heightMode: afterState.heightMode || '', marginPercent: afterState.marginPercent,
      hasResult: Boolean(afterState.result), resultUpdating: Boolean(afterState.resultUpdating), hasCalculationTimer: after.hasCalculationTimer,
      legacyCustomUnsupported: Boolean(afterState.legacyCustomUnsupported), filledStateFields, filledPreferenceFields,
      activeErrors, resultActions, reportSignature: after.reportSignature, reportImagePath: after.reportImagePath,
      reportPreviewVisible: after.reportPreviewVisible, originalViewerVisible: after.originalViewerVisible },
    cachedReportImage: cachedReport?.reportImage || null,
  }
  const reportStateEmpty = !afterState.result && !afterState.resultUpdating && !after.hasCalculationTimer
    && filledStateFields.length === 0 && filledPreferenceFields.length === 0 && activeErrors.length === 0
  const resetDefaultsRetained = afterState.selectedCamera?.model === 'TV-6124HK'
    && afterState.sceneMode === 'ground' && afterState.heightMode === 'auto' && Number(afterState.marginPercent) === 10
  const resultActionsDisabled = resultActions.length === 3 && resultActions.every((item) => item.exists && item.disabled)
  const cacheInvalidated = kind !== 'shared-cache' || (Boolean(cachedReport?.reportImage?.image?.complete)
    && Boolean(prepared.reportSignature) && Boolean(prepared.reportImagePath)
    && !after.reportSignature && !after.reportImagePath && !after.reportPreviewVisible && !after.originalViewerVisible)

  add('reset clears numeric fields and errors, cancels pending calculation, and leaves no result', reportStateEmpty, resetState)
  add('reset preserves the requested library camera, ground scene, automatic height, and 10% margin defaults',
    resetDefaultsRetained, resetState.after)
  add('result actions are disabled after reset until a new calculation exists', resultActionsDisabled, resultActions)
  add('reset invalidates the cached report preview and its signature', cacheInvalidated, resetState)

  const switchTrace = []
  for (const index of [1, 2, 0, 1, 2, 0]) {
    await dispatch('onInputTabTap', { index: String(index) })
    await window.__cameraWaitForStablePaint()
    await window.__cameraRefreshState()
    const values = Object.fromEntries(numericFields.map((field) => [field, fixture.state?.[field] ?? '']))
    switchTrace.push({ index, inputTabIndex: fixture.state?.inputTabIndex, filled: Object.entries(values)
      .filter(([, value]) => String(value).trim() !== '').map(([field]) => field) })
  }
  const emptyAfterSwitches = switchTrace.every((item) => item.filled.length === 0)
  await dispatch('onHide')
  await dispatch('onShow')
  await window.__cameraRefreshState()
  const storageAfterSwitches = await getDiagnostics()
  const emptyAfterLifecycle = numericFields.every((field) => String(storageAfterSwitches.state?.[field] ?? '').trim() === '')
    && numericFields.every((field) => String(storageAfterSwitches.preferences?.[field] ?? '').trim() === '')
  add('repeated camera/target/install tab switching preserves the cleared values', emptyAfterSwitches, switchTrace)
  add('empty reset preferences survive hide/show lifecycle rehydration', emptyAfterLifecycle,
    { state: storageAfterSwitches.state, preferences: storageAfterSwitches.preferences })

  await dispatch('onInputTabTap', { index: '1' })
  for (const [field, value] of [['groundWidthText', '6'], ['groundDepthText', '4'], ['subjectHeightText', '1.8']]) {
    const selector = `#cameraInputPanelTarget input[data-field="${field}"]`
    await typeProductionInput(selector, value)
    await dispatch('onFieldBlur', { field }, { value })
  }
  await window.__cameraWaitForStablePaint()
  await window.__cameraRefreshState()
  const refill = { hasResult: Boolean(fixture.state?.result), resultUpdating: Boolean(fixture.state?.resultUpdating),
    width: fixture.state?.groundWidthText || '', depth: fixture.state?.groundDepthText || '' }
  if (kind === 'shared-cache') {
    const changedResultBefore = await getDiagnostics()
    const newSignatureBefore = String(changedResultBefore.reportSignature || '')
    await clickProductionElement('#cameraShare')
    const regenerated = await window.__cameraRenderProductionReportPreview()
    const afterShare = await getDiagnostics()
    const newSignature = String(afterShare.reportSignature || '')
    add('a changed result regenerates its report image after reset instead of reusing shared cached pixels',
      Boolean(newSignature && newSignature === newSignatureBefore && newSignature !== prepared.reportSignature
        && regenerated?.reportImage?.image?.complete && regenerated.reportImage.image.naturalWidth === 750),
      { oldSignature: prepared.reportSignature, newSignature, reportImage: regenerated?.reportImage || null })
  }

  await clickProductionElement('#cameraReset')
  await window.__cameraWaitForStablePaint()
  const repeatedReset = await getDiagnostics()
  const repeatedResetEmpty = !repeatedReset.state?.result && numericFields.every((field) =>
    String(repeatedReset.state?.[field] ?? '').trim() === '')
  add('refill calculates a fresh result and a second reset remains empty',
    refill.hasResult && !refill.resultUpdating && repeatedResetEmpty, { refill, repeatedReset: repeatedReset.state })

  report.interaction = { ...(report.interaction || {}), resetAcceptance: resetState, switchTrace, refill, repeatedResetEmpty }
  report.failures = report.checks.filter((item) => !item.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  return report
}

async function runQueryAction(action) {
  if (!action) return null
  if (action === 'target-tab') return window.__cameraActivateInputTab(1)
  if (action === 'install-tab') return window.__cameraActivateInputTab(2)
  if (action === 'install-controls') return window.__cameraMeasureInstallationControls()
  if (action === 'clear-refill') return window.__cameraRunClearRefill()
  if (action.startsWith('reset-')) return window.__cameraRunResetAcceptance(action)
  if (action === 'share-overlay') return window.__cameraRenderProductionReportPreview()
  if (action === 'share-plane-overlay') {
    await clickProductionElement('#cameraShare')
    await window.__cameraWaitForStablePaint()
    return window.__cameraRenderProductionReportPreview()
  }
  if (action === 'original-viewer') return window.__cameraRunReportInteraction('viewer')
  if (action === 'viewer-return') return window.__cameraRunReportInteraction('viewer-return')
  if (action === 'share-cancel-return') return window.__cameraRunReportInteraction('share-cancel-return')
  if (action === 'project-open') return window.__cameraClickProjectAction()
  if (action === 'project-keyboard') return window.__cameraProjectKeyboardHeight(180)
  if (action.startsWith('project-')) return window.__cameraRunProjectInteraction(action)
  if (action.startsWith('camera-selector-')) return window.__cameraRunSelectorInteraction(action)
  if (action.startsWith('pending-')) {
    const handler = action === 'pending-report-hide' ? 'generateResultReportImage' : 'saveToActiveProject'
    return window.__cameraRunPendingActionHideRace(handler)
  }
  throw new Error(`Unsupported camera QA query action: ${action}`)
}

async function runCameraQaCase() {
  document.documentElement.dataset.cameraQaReady = 'working'
  document.documentElement.dataset.cameraQaActionComplete = 'working'
  document.body.dataset.qaStatus = 'working'
  await renderAndInspect()
  await window.__cameraWaitForStablePaint()
  await runQueryAction(qaAction)
  await window.__cameraWaitForStablePaint()
  const report = window.__cameraReinspect()
  report.qaCase = qaCase
  report.qaAction = qaAction
  report.qaActionComplete = true
  report.qaReadyAt = new Date().toISOString()
  report.status = report.failures.length ? 'failed' : 'passed'
  window.__cameraQa = report
  reportElement.hidden = false
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  document.documentElement.dataset.cameraQaActionComplete = qaAction || 'none'
  document.documentElement.dataset.cameraQaReady = 'true'
  document.title = `Camera QA ${report.status}: ${qaCase}`
  return report
}

runCameraQaCase().catch((error) => {
  const report = { status: 'error', caseName: scenario, qaCase, qaAction,
    error: String(error && error.stack || error) }
  window.__cameraQa = report
  reportElement.hidden = false
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = 'error'
  document.documentElement.dataset.cameraQaError = String(error && error.message || error)
  document.documentElement.dataset.cameraQaActionComplete = 'error'
  document.documentElement.dataset.cameraQaReady = 'error'
  document.title = `Camera QA error: ${qaCase}`
})

'use strict'

const app = document.getElementById('app')
const reportElement = document.getElementById('qa-report')
const query = new URLSearchParams(location.search)
const scenario = query.get('case') || 'ground'
const wxssPaths = new Set()
const wxssSources = []
const checks = []
const failures = []
const urlToken = /(url\(\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^)]*)\s*\))/gi
let fixture = null
let renderer = null
let lastHeroMeasurement = null
let resultHeightSelector = '#cameraResultHero'

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
  for (const url of ['/app.wxss', '/pages/camera/camera.wxss']) {
    const source = await expandedWxss(url)
    const style = document.createElement('style')
    style.dataset.productionSource = url
    style.textContent = convertRpx(source, innerWidth, Number(query.get('zoom')) || 1)
    document.head.append(style)
    wxssSources.push({ url, source })
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
  const measuredContext = new Proxy(raw, {
    set(target, key, value) { return Reflect.set(target, key, value, target) },
    get(target, key) {
      if (key === 'fillText') return (...args) => {
        const text = String(args[0])
        const x = Number(args[1])
        const y = Number(args[2])
        const align = target.textAlign || 'left'
        const textWidth = target.measureText(text).width
        textLabels.push({
          text, x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), align,
          width: Number(textWidth.toFixed(2)),
          left: Number((align === 'center' ? x - textWidth / 2 : align === 'right' ? x - textWidth : x).toFixed(2)),
          right: Number((align === 'center' ? x + textWidth / 2 : align === 'right' ? x : x + textWidth).toFixed(2)),
          font: target.font,
        })
        return target.fillText(...args)
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const view = state.previewViewOptions?.[state.previewViewIndex]?.value || 'plan'
  renderer.drawPreviewAtSize(renderer.adaptCanvas2dContext(measuredContext), state.result, width, height, view)
  const sample = raw.getImageData(Math.min(canvas.width - 1, 3 * dpr), Math.min(canvas.height - 1, 3 * dpr), 1, 1).data
  return {
    view,
    css: { width: Number(width.toFixed(2)), height: Number(height.toFixed(2)) },
    bitmap: { width: canvas.width, height: canvas.height },
    topLeftPixel: [sample[0], sample[1], sample[2], sample[3]],
    deepBlueBackdrop: sample[0] === 16 && sample[1] === 36 && sample[2] === 58,
    textLabels,
  }
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
  const canvas = app.querySelector('#cameraFovCanvas')
  const previewTabs = [...app.querySelectorAll('#cameraPreviewViewToggle .camera-preview-tab')]
  const inputTabs = [...app.querySelectorAll('#cameraInputTabs .camera-input-tab')]
  const panels = visiblePanelIds()
  const actionButtons = [...app.querySelectorAll('#cameraActions button')]
  const rail = app.querySelector('#cameraResultRail')
  const railSelectors = ['#cameraReset', '#cameraShare', '#cameraFavorite', '#cameraProject']
  const railButtons = railSelectors.map((selector) => app.querySelector(selector)).filter(Boolean)
  const copyButtons = ['#cameraCopySummary', '#cameraCopyFull'].map((selector) => app.querySelector(selector)).filter(Boolean)
  const dimensionCaption = app.querySelector('.camera-preview-dimension-caption')
  const sourceSegment = app.querySelector('#cameraInputPanelCamera .source-segment')
  const firstCameraField = app.querySelector('#cameraInputPanelCamera .field')
  const detailsContent = app.querySelector('#cameraDetailsContent')
  const resultCard = app.querySelector('#cameraResultHero')
  const resultPane = app.querySelector('#cameraResultPane')
  const cameraWxss = wxssSources.find((item) => item.url === '/pages/camera/camera.wxss')?.source || ''
  const cameraWxml = expandedSource
  const detailSelectors = ['.horizontal-geometry', '.vertical-geometry', '.distance-bars']
  const report = {
    status: 'passed',
    bridge: 'Headless Chrome rendering production camera WXML with expanded production WXSS; production camera page JS supplies fixture state and production preview-renderer.js draws the actual 2D canvas.',
    limitations: 'Browser bridge verifies source markup, computed browser layout, page-controller event dispatch, and Canvas 2D rendering; it is not the WeChat WXML/WXSS runtime, WeChat DevTools compile result, native share/photo permission flow, or a physical-device test.',
    caseName: scenario,
    sourceNote: fixture.sourceNote,
    viewport,
    theme: query.get('theme') || 'light',
    zoom: Number(query.get('zoom')) || 1,
    result: state.result ? {
      displayModel: state.result.displayModel,
      sceneMode: state.result.sceneMode,
      horizontalOnly: state.result.horizontalOnly,
      bottomHeightMeters: state.result.bottomHeightMeters,
      heightMeters: state.result.heightMeters,
      targetTopHeightDisplay: state.result.targetTopHeightDisplay,
      horizontalFov: state.result.horizontalFov,
      verticalFov: state.result.verticalFov,
      aimAngleDegrees: state.result.aimAngleDegrees,
      aimText: state.result.aimText,
      distanceMeters: state.result.primaryDistanceMeters,
      depthMeters: state.result.depthMeters,
      cameraHeightMeters: state.result.cameraHeightMeters,
      mountType: state.result.mountType,
      requiresInitialAim: state.result.requiresInitialAim,
    } : null,
    resultUpdating: Boolean(state.resultUpdating),
    canvas: renderInfo,
    fontMeasurements: {
      primaryValue: fontMeasurement('.camera-primary-value'),
      previewFacts: fontMeasurement('.camera-primary-note'),
      legendItem: fontMeasurement('.camera-preview-mini-legend'),
      dimensionCaption: fontMeasurement('.camera-preview-dimension-caption'),
    },
    layout: {
      pageRoot: box(root), scroll: box(scroll), scrollTop: Number((scroll?.scrollTop || 0).toFixed(2)),
      resultPane: box(resultPane), result: box(resultCard), rail: box(rail), canvas: box(canvas),
      railButtons: railSelectors.map((selector) => ({ selector, box: box(app.querySelector(selector)), disabled: Boolean(app.querySelector(selector)?.disabled) })),
      dimensionCaption: {
        box: box(dimensionCaption), canvas: box(canvas),
        items: [...(dimensionCaption?.children || [])].map((item) => ({ text: item.textContent.trim(), box: box(item) })),
      },
      heroMeasurement: lastHeroMeasurement,
      resultPlaceholderStyle: state.resultPlaceholderStyle || '',
      resultTailPlaceholderStyle: state.resultTailPlaceholderStyle || '',
      inputCard: box(app.querySelector('#cameraInputCard')),
      inputFirstScreen: {
        tabs: box(app.querySelector('#cameraInputTabs')),
        source: box(sourceSegment),
        firstField: box(firstCameraField),
      },
      mainDistance: {
        value: box(app.querySelector('.camera-primary-value')),
        note: box(app.querySelector('.camera-primary-reference')),
        summary: box(app.querySelector('.camera-summary-secondary')),
        guidance: box(app.querySelector('.camera-aim-guidance')),
        disclaimer: box(app.querySelector('.camera-result-disclaimer')),
        warning: box(app.querySelector('.camera-result-warning')),
      },
      v2TouchTargets: {
        previewTabs: previewTabs.map((tab) => box(tab)),
        inputTabs: inputTabs.map((tab) => box(tab)),
      },
      v2CompactBreakdown: {
        heading: box(app.querySelector('.camera-result-heading')),
        chart: box(app.querySelector('.camera-chart-panel')),
        viewTabs: box(app.querySelector('#cameraPreviewViewToggle')),
        canvas: box(canvas),
        dimensionCaption: box(dimensionCaption),
        miniLegend: box(app.querySelector('.camera-preview-mini-legend')),
        primaryResults: box(app.querySelector('.camera-primary-results')),
        primaryCards: [...app.querySelectorAll('.camera-primary-result')].map((element) => box(element)),
        aimGuidance: box(app.querySelector('.camera-aim-guidance')),
        distanceReference: box(app.querySelector('.camera-primary-reference')),
        warning: box(app.querySelector('.camera-result-warning')),
        disclaimer: box(app.querySelector('.camera-result-disclaimer')),
      },
      actions: actionButtons.map((button) => ({ text: button.textContent.trim(), ...box(button) })),
      copyActions: copyButtons.map((button) => ({ id: button.id, text: button.textContent.trim(), className: button.className, ...box(button) })),
      detailsToggle: box(app.querySelector('#cameraDetailsToggle')),
      detailsVisible: Boolean(detailsContent),
      inputPanels: panels,
      inputTabs: inputTabs.map((tab) => ({ text: tab.textContent.trim(), selected: tab.getAttribute('aria-selected'), box: box(tab) })),
      previewTabs: previewTabs.map((tab) => ({ text: tab.textContent.trim(), selected: tab.getAttribute('aria-selected'), box: box(tab) })),
      scrollWidth: root?.scrollWidth ?? null,
      viewportWidth: viewport.width,
    },
    checks: [],
    failures: [],
    sourceHashes: fixture.loadedHashes,
    styleSources: wxssSources.map((item) => item.url),
    expandedStyles: [...wxssPaths].sort(),
  }
  const checksForReport = []
  const add = (name, passed, detail = null) => checksForReport.push({ name, passed: Boolean(passed), detail })
  add('production WXML source and include expansion loaded', cameraWxml.length > 0 && /cameraFovCanvas/.test(cameraWxml)
    && /cameraResultEmpty/.test(cameraWxml), { wxmlLength: cameraWxml.length, styleLength: cameraWxss.length })
  if (state.result) {
    add('result is above the three-tab input form', Boolean(resultCard && app.querySelector('#cameraInputCard'))
      && resultCard.getBoundingClientRect().top < app.querySelector('#cameraInputCard').getBoundingClientRect().top,
    { result: box(resultCard), inputCard: box(app.querySelector('#cameraInputCard')) })
    add('main diagram is a visible actual canvas with deep-blue renderer output', Boolean(canvas && renderInfo)
      && renderInfo.deepBlueBackdrop && box(canvas).height >= 80,
    renderInfo)
    add('production selector-query received actual Chrome result hero and action/detail-tail heights', Boolean(lastHeroMeasurement)
      && lastHeroMeasurement.heroHeightMatches
      && lastHeroMeasurement.tailHeightMatches
      && lastHeroMeasurement.measurements['#cameraResultHero'] > 0
      && lastHeroMeasurement.measurements['#cameraResultTail'] > 0,
    lastHeroMeasurement)
    add('diagram view tabs expose both views and exactly one selected tab', previewTabs.length === 2
      && previewTabs.filter((item) => item.getAttribute('aria-selected') === 'true').length === 1,
    report.layout.previewTabs)
  } else {
    const emptyState = app.querySelector('#cameraResultEmpty')
    const inputCard = app.querySelector('#cameraInputCard')
    const emptyStyle = emptyState ? getComputedStyle(emptyState) : null
    add('invalid state clears result, diagram, and view tabs before the input form', Boolean(emptyState && inputCard)
      && emptyState.getBoundingClientRect().top < inputCard.getBoundingClientRect().top
      && !canvas && previewTabs.length === 0,
    { emptyState: box(emptyState), canvas: Boolean(canvas), previewTabs: previewTabs.length })
    add('invalid reserved result state keeps the measured slot height and deep-blue treatment', Boolean(emptyState)
      && emptyState.classList.contains('camera-result-empty-reserved')
      && /linear-gradient/i.test(emptyStyle?.backgroundImage || '')
      && /min-height\s*:\s*[\d.]+px/i.test(emptyState.getAttribute('style') || ''),
    { className: emptyState?.className, backgroundImage: emptyStyle?.backgroundImage, inlineStyle: emptyState?.getAttribute('style') })
  }
  add('input tabs expose exactly three panels and one visible panel', inputTabs.length === 3 && panels.length === 1
    && inputTabs.filter((item) => item.getAttribute('aria-selected') === 'true').length === 1,
  { tabs: report.layout.inputTabs, panels })
  add('derivation is initially folded when the fixture requests it', state.calculationExpanded === false || query.get('derive') === 'open',
    { calculationExpanded: state.calculationExpanded, detailsVisible: Boolean(detailsContent) })
  add('horizontal, vertical, and distance comparison derivations remain in production WXML',
    detailSelectors.every((selector) => cameraWxml.includes(selector.slice(1))), detailSelectors)
  add('camera WXSS has no horizontal viewport overflow', Boolean(root) && root.scrollWidth <= viewport.width + 1,
    { scrollWidth: root?.scrollWidth, viewportWidth: viewport.width })
  add('all result actions retain a 44px minimum touch height', actionButtons.length === 0 || actionButtons.every((button) => button.getBoundingClientRect().height >= 44),
    report.layout.actions)
  if (rail) {
    const paneRect = resultPane?.getBoundingClientRect()
    const resultRegion = resultCard || app.querySelector('#cameraResultEmpty')
    const heroRect = resultRegion?.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()
    const allRailButtonsTappable = railSelectors.every((selector) => {
      const button = app.querySelector(selector)
      const rect = button?.getBoundingClientRect()
      return Boolean(button && rail.contains(button) && rect && rect.width >= 44 && rect.height >= 44
        && rect.left >= -0.5 && rect.right <= viewport.width + 0.5)
    })
    const railFitsBesideHero = viewport.width <= 350
      ? getComputedStyle(rail).flexDirection === 'row'
      : Boolean(paneRect && heroRect && railRect.left >= heroRect.right - 1 && railRect.right <= paneRect.right + 1)
    add('V2 result rail keeps reset/share/favorite/project as reachable 44px controls', railButtons.length === 4
      && allRailButtonsTappable && railFitsBesideHero,
    { rail: box(rail), pane: box(resultPane), hero: box(resultCard), buttons: report.layout.railButtons,
      flexDirection: getComputedStyle(rail).flexDirection, railFitsBesideHero })
    if (state.result) {
      add('V2 view and input tabs keep their measured touch areas', previewTabs.length === 2
        && previewTabs.every((tab) => tab.getBoundingClientRect().height >= 44)
        && inputTabs.length === 3 && inputTabs.every((tab) => tab.getBoundingClientRect().height >= 44),
      report.layout.v2TouchTargets)
    }
    if (state.result) {
      add('V2 copy actions remain secondary controls outside the primary rail', copyButtons.length === 2
        && copyButtons.every((button) => button.classList.contains('copy-result-button')
          && !rail.contains(button) && Boolean(app.querySelector('#cameraActions')?.contains(button))),
      report.layout.copyActions)
      const captionBox = dimensionCaption?.getBoundingClientRect()
      const canvasBox = canvas?.getBoundingClientRect()
      const captionItems = [...(dimensionCaption?.children || [])]
      const externalDimensionCaption = Boolean(captionBox && canvasBox && captionItems.length > 0
        && captionBox.top >= canvasBox.bottom - 0.5
        && captionItems.every((item) => {
          const rect = item.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && rect.left >= canvasBox.left - 1
            && rect.right <= canvasBox.right + 1 && rect.top >= canvasBox.bottom - 0.5
        }))
      add('V2 width/depth/height dimensions are legible outside the canvas', externalDimensionCaption
        && Number.parseFloat(getComputedStyle(dimensionCaption).fontSize) >= 12,
      report.layout.dimensionCaption)
    }
    if (viewport.width === 390 && (viewport.height === 700 || viewport.height === 844)
      && state.result && state.inputTabIndex === 0) {
      const tabsRect = app.querySelector('#cameraInputTabs')?.getBoundingClientRect()
      const sourceRect = sourceSegment?.getBoundingClientRect()
      const firstFieldRect = firstCameraField?.getBoundingClientRect()
      const requiredFirstScreen = [tabsRect, sourceRect, firstFieldRect]
      const firstScreenVisible = scroll?.scrollTop === 0 && requiredFirstScreen.every((rect) => Boolean(rect)
        && rect.top >= -0.5 && rect.bottom <= viewport.height + 0.5)
      const heroHeight = heroRect?.height || 0
      const readableBlocks = ['.camera-primary-value', '.camera-primary-reference', '.camera-result-disclaimer']
        .map((selector) => app.querySelector(selector))
      const mainInfoVisible = readableBlocks.every((element) => {
        const rect = element?.getBoundingClientRect()
        return Boolean(element && rect && rect.width > 0 && rect.height > 0
          && rect.top >= heroRect.top - 1 && rect.bottom <= Math.min(heroRect.bottom, viewport.height) + 1)
      })
      const mountNeedle = ({ ptz: '云台可调朝向', fixed: '固定安装朝向', eptz: 'ePTZ固定安装', unspecified: '安装结构待确认' })[state.result.mountType]
      const mountCueCandidates = [...(resultCard?.querySelectorAll('*') || [])]
        .filter((element) => element.children.length === 0 && element.textContent.includes(mountNeedle || '\u0000'))
      const mountCueVisible = mountCueCandidates.some((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.top >= heroRect.top - 1
          && rect.bottom <= Math.min(heroRect.bottom, viewport.height) + 1
      })
      add('V2 390px first screen exposes tabs and the first camera-source field without scrolling',
        Boolean(firstScreenVisible && heroHeight >= 380 && heroHeight <= 420),
      { viewport, scrollTop: scroll?.scrollTop, hero: box(resultCard), heroHeight,
        inputTabs: box(app.querySelector('#cameraInputTabs')), sourceSegment: box(sourceSegment), firstCameraField: box(firstCameraField) })
      add('V2 primary distance, definition, mount cue, and caveat remain readable in the first screen',
        Boolean(mainInfoVisible && mountCueVisible && Number.parseFloat(getComputedStyle(readableBlocks[0]).fontSize) >= 24
          && Number.parseFloat(getComputedStyle(readableBlocks[1]).fontSize) >= 12
          && Number.parseFloat(getComputedStyle(readableBlocks[2]).fontSize) >= 12),
      { blocks: readableBlocks.map((element) => ({ text: element?.textContent.trim(), box: box(element), fontSize: element ? getComputedStyle(element).fontSize : null })),
        mountType: state.result.mountType, mountNeedle, mountCueVisible: Boolean(mountCueVisible), mountCueCandidates: mountCueCandidates.map((element) => ({ text: element.textContent.trim(), box: box(element) })) })
    }
    if (scenario === 'plane-decimal-caption') {
      const captionText = dimensionCaption?.textContent || ''
      add('V2 vertical-plane height caption avoids floating-point arithmetic artifacts',
        state.result?.bottomHeightMeters === 0.1 && state.result?.heightMeters === 0.2
          && state.result?.targetTopHeightDisplay === '0.3'
          && captionText.includes('0.1') && captionText.includes('0.3')
          && !/0\.30000000000000004|\d\.\d{8,}/.test(captionText),
      { captionText, result: report.result })
    }
  }
  add('labels do not claim verified/actual scene coverage', !app.textContent.includes('绿色目标完全落入蓝色覆盖范围'),
    { visibleText: app.textContent.includes('绿色目标完全落入蓝色覆盖范围') })
  if (state.result?.horizontalOnly && state.previewViewIndex === 1) {
    add('H-only side view shows the missing-vertical note and no vertical coverage assertion',
      Boolean(app.querySelector('.camera-vertical-missing')) && !app.textContent.includes('垂直视场角检查'),
    { missingNotice: app.querySelector('.camera-vertical-missing')?.textContent || '' })
  }
  if (state.result?.horizontalOnly && state.result.sceneMode === 'ground' && state.calculationExpanded) {
    const detailsText = app.querySelector('#cameraDetailsContent')?.textContent || ''
    const expectedHeight = `含余量目标高度：0–${state.result.effectiveSubjectHeightMeters} m`
    add('H-only ground details disclose the effective target-height range', detailsText.includes(expectedHeight),
      { expectedHeight, detailsVisible: Boolean(app.querySelector('#cameraDetailsContent')) })
  }
  if (scenario === 'fixed' || scenario === 'eptz') {
    const expectedMount = scenario === 'fixed' ? 'fixed' : 'eptz'
    add(`${scenario} main result retains its actual mounting behavior`,
      state.result?.mountType === expectedMount && Boolean(state.result?.aimText),
    { mountType: state.result?.mountType, requiresInitialAim: state.result?.requiresInitialAim, aimText: state.result?.aimText })
  }
  if (scenario === 'empty' && Number(query.get('tab')) === 0) {
    const tabs = [...app.querySelectorAll('#cameraInputTabs .camera-input-tab')]
    add('hidden target input error is flagged while camera inputs remain selected',
      tabs[0]?.getAttribute('aria-selected') === 'true'
        && Boolean(tabs[1]?.querySelector('.camera-tab-error'))
        && visiblePanelIds().includes('cameraInputPanelCamera')
        && !visiblePanelIds().includes('cameraInputPanelTarget'),
    { activeTab: tabs[0]?.textContent.trim(), targetError: Boolean(tabs[1]?.querySelector('.camera-tab-error')), panels })
  }
  if (scenario === 'long-depth') {
    const dimensionCaptionText = dimensionCaption?.textContent || ''
    const distanceValueText = app.querySelector('.camera-primary-value')?.textContent || ''
    add('long-depth scenario is settled on the 1000 m production input before capture', state.result?.depthMeters === 1000
      && state.resultUpdating === false,
    { depthMeters: state.result?.depthMeters, resultUpdating: state.resultUpdating, distanceMeters: state.result?.primaryDistanceMeters })
    add('long-depth dimensions remain outside the canvas and show the current 1000 m target', Boolean(dimensionCaption)
      && dimensionCaptionText.includes('1000') && box(dimensionCaption).y >= (box(canvas)?.y + box(canvas)?.height - 0.5),
    { caption: box(dimensionCaption), captionText: dimensionCaptionText, canvas: box(canvas) })
    add('long-depth front-edge distance remains visible as the current 54.63 m result', state.result?.primaryDistanceMeters === 54.63
      && distanceValueText.includes('54.63'),
    { primaryDistanceMeters: state.result?.primaryDistanceMeters, visibleValue: distanceValueText })
  }
  if (state.operationActive) {
    add('structured operation displays its confirmation card and unspecified mounting label',
      Boolean(app.querySelector('.operation-confirm-card')) && state.result?.mountType === 'unspecified'
        && app.textContent.includes('安装结构待确认'),
    { operationActive: state.operationActive, mountType: state.result?.mountType, confirmationCard: Boolean(app.querySelector('.operation-confirm-card')), text: app.textContent.slice(0, 500) })
  }
  if (!state.result) add('invalid state clears main diagram and exposes status copy', !canvas && Boolean(app.querySelector('#cameraResultEmpty')),
    { canvasVisible: Boolean(canvas), emptyState: Boolean(app.querySelector('#cameraResultEmpty')) })

  report.checks = checksForReport
  report.failures = checksForReport.filter((item) => !item.passed)
  report.status = report.failures.length ? 'failed' : 'passed'
  return report
}

let expandedSource = ''

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
  const report = inspectPage(fixture.state, renderInfo)
  window.__cameraQa = report
  reportElement.hidden = false
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = report.status
  document.documentElement.dataset.cameraQaReady = 'true'
  document.title = `Camera QA ${report.status}: ${scenario}`
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
  const renderInfo = drawProductionCanvas(fixture.state)
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
window.__cameraClickInputTab = (index) => dispatch('onInputTabTap', { index: String(index) })
window.__cameraClickPreviewView = (index) => dispatch('onPreviewViewTap', { index: String(index) })
window.__cameraRefreshState = refreshState
window.__cameraLastDispatch = Promise.resolve(null)

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

renderAndInspect().catch((error) => {
  const report = { status: 'error', caseName: scenario, error: String(error && error.stack || error) }
  window.__cameraQa = report
  reportElement.hidden = false
  reportElement.textContent = JSON.stringify(report)
  document.body.dataset.qaStatus = 'error'
  document.documentElement.dataset.cameraQaError = String(error && error.message || error)
  document.documentElement.dataset.cameraQaReady = 'error'
  document.title = `Camera QA error: ${scenario}`
})

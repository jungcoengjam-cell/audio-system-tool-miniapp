'use strict'

const app = document.getElementById('app')
const reportElement = document.getElementById('qa-report')
const query = new URLSearchParams(location.search)
const scenario = query.get('case') || 'default'
const wxssSources = []
const wxssPaths = new Set()
const failures = []
const checks = []
const urlToken = /(url\(\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^)]*)\s*\))/gi

function record(name, passed, detail = '') {
  checks.push({ name, passed: Boolean(passed), detail })
  if (!passed) failures.push({ name, detail })
}

function convertRpx(source, width = innerWidth) {
  const scale = width / 750
  return String(source).split(urlToken).map((part) => {
    if (/^url\(/i.test(part)) return part
    return part.replace(/(-?(?:\d+\.?\d*|\.\d+))rpx\b/g, (_match, raw) => `${Number((Number(raw) * scale).toFixed(5))}px`)
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
    const childUrl = new URL(childPath, target)
    css = css.replace(directive, await expandedWxss(childUrl.href, [...ancestors, target.pathname]))
  }
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, quote, assetPath) => {
    const asset = assetPath.trim()
    if (/^(?:data:|https?:|\/|#)/i.test(asset)) return full
    return `url("${new URL(asset, target).href}")`
  })
}

async function installProductionStyles() {
  for (const url of ['/app.wxss', '/pages/spl/spl.wxss']) {
    const source = await expandedWxss(url)
    const style = document.createElement('style')
    style.dataset.productionSource = url
    style.textContent = convertRpx(source)
    document.head.append(style)
    wxssSources.push({ url, source, style })
  }
  const scrollViewCompatibility = document.createElement('style')
  scrollViewCompatibility.textContent = 'div[data-wx-scroll-y="true"]{overflow-y:auto!important;-webkit-overflow-scrolling:touch}div[data-wx-scroll-x="true"]{overflow-x:auto!important}'
  document.head.append(scrollViewCompatibility)
}

function evaluate(expression, scope) {
  try {
    const code = String(expression).replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
    return Function('scope', `with(scope){return (${code})}`)(scope)
  } catch (_error) {
    return ''
  }
}

function interpolate(source, scope) {
  return String(source).replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression) => {
    const value = evaluate(expression, scope)
    return value === undefined || value === null ? '' : String(value)
  })
}

function conditionValue(expression, scope) {
  return expression === null || expression === '' || Boolean(evaluate(expression, scope))
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
  const name = { view: 'div', 'scroll-view': 'div', picker: 'div', image: 'img' }[sourceName] || sourceName
  const output = document.createElement(name)
  if (sourceName === 'scroll-view') {
    if (sourceElement.hasAttribute('scroll-y')) output.dataset.wxScrollY = 'true'
    if (sourceElement.hasAttribute('scroll-x')) output.dataset.wxScrollX = 'true'
  }
  for (const attribute of [...sourceElement.attributes]) {
    const key = attribute.name
    if (key.startsWith('wx:') || key === 'range' || key === 'range-key' || key === 'enhanced' || key === 'show-scrollbar') continue
    if (key.startsWith('bind') || key.startsWith('catch')) {
      output.dataset.wxEvent = attribute.value
      output.dataset[key.replace(/[^a-z0-9]/gi, '-')] = attribute.value
      continue
    }
    const value = interpolate(attribute.value, scope)
    if (key === 'value' && ['input', 'textarea'].includes(sourceName)) {
      output.value = value
      continue
    }
    if ((key === 'disabled' || key === 'aria-pressed') && (value === 'false' || value === '')) continue
    if (key === 'type' && sourceName === 'input' && value === 'digit') {
      output.setAttribute('type', 'text')
      continue
    }
    if (key === 'scroll-y' || key === 'scroll-x') continue
    if (sourceName === 'image' && key === 'mode') {
      if (value === 'aspectFit') {
        output.style.objectFit = 'contain'
        output.style.objectPosition = 'center'
      }
      continue
    }
    output.setAttribute(key, key === 'style' ? convertRpx(value) : value)
  }
  if (sourceName === 'image' && !output.hasAttribute('alt')) output.setAttribute('alt', '结果图片')
  targetParent.append(output)
  if (!['input', 'textarea', 'img'].includes(output.tagName.toLowerCase())) {
    appendChildren(sourceElement, output, scope)
  }
}

async function renderProductionWxml(state) {
  let source = await fetchText('/pages/spl/spl.wxml')
  source = source.replace(/<(textarea|canvas)(\s[^<>]*?)\s*\/>/gi, '<$1$2></$1>')
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  if (parsed.querySelector('parsererror')) throw new Error('WXML bridge could not parse SPL WXML')
  app.replaceChildren()
  appendChildren(parsed.body, app, state)
}

function box(element) {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return {
    x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height),
    right: round(rect.right), bottom: round(rect.bottom), centerX: round(rect.left + rect.width / 2),
  }
}

function textBox(element) {
  if (!element) return null
  const range = document.createRange()
  range.selectNodeContents(element)
  const rects = [...range.getClientRects()]
  if (!rects.length) return box(element)
  const left = Math.min(...rects.map((rect) => rect.left))
  const right = Math.max(...rects.map((rect) => rect.right))
  const top = Math.min(...rects.map((rect) => rect.top))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top), right: round(right), bottom: round(bottom) }
}

function textLineRects(element) {
  if (!element) return []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const fragments = []
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(walker.currentNode)
    fragments.push(...[...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0))
  }
  const lines = []
  for (const rect of fragments.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find((item) => {
      const verticalOverlap = Math.min(rect.bottom, item.bottom) - Math.max(rect.top, item.top)
      const sameLineThreshold = Math.min(rect.height, item.bottom - item.top) * 0.5
      return verticalOverlap >= sameLineThreshold
    })
    if (line) {
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
      line.top = Math.min(line.top, rect.top)
      line.bottom = Math.max(line.bottom, rect.bottom)
    } else {
      lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    }
  }
  return lines.map((line) => ({ x: round(line.left), y: round(line.top), width: round(line.right - line.left),
    height: round(line.bottom - line.top), right: round(line.right), bottom: round(line.bottom) }))
}

function textFragmentRects(element) {
  if (!element) return []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const fragments = []
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(walker.currentNode)
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue
      fragments.push({ x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height),
        right: round(rect.right), bottom: round(rect.bottom) })
    }
  }
  return fragments.sort((left, right) => left.y - right.y || left.x - right.x)
}

function round(value) { return Math.round(value * 10) / 10 }

function cssPixels(style, property, fallback = 0) {
  const value = Number.parseFloat(style?.[property])
  return Number.isFinite(value) ? value : fallback
}

function applyBrowserPreviewFit(state) {
  const image = app.querySelector('.share-image')
  const frame = app.querySelector('#splShareImageFrame')
  const panel = app.querySelector('#splSharePanel')
  const overlay = app.querySelector('.spl-overlay')
  const root = app.querySelector('.page-root')
  const header = app.querySelector('#splShareHeader')
  const actions = app.querySelector('#splShareActions')
  if (!image || !frame || !panel || !overlay || !root || !header || !actions
    || !image.naturalWidth || !image.naturalHeight) return null

  const rootRect = root.getBoundingClientRect()
  const overlayRect = overlay.getBoundingClientRect()
  const frameRect = frame.getBoundingClientRect()
  const panelStyle = getComputedStyle(panel)
  const frameStyle = getComputedStyle(frame)
  const headerStyle = getComputedStyle(header)
  const panelFixedInsets = cssPixels(panelStyle, 'borderTopWidth', 1)
    + cssPixels(panelStyle, 'borderBottomWidth', 1)
    + cssPixels(panelStyle, 'paddingTop', 15)
    + cssPixels(panelStyle, 'paddingBottom', 12)
  const headerBottomMargin = cssPixels(headerStyle, 'marginBottom', 9)
  const frameHorizontalInsets = cssPixels(frameStyle, 'borderLeftWidth', 1)
    + cssPixels(frameStyle, 'borderRightWidth', 1)
    + cssPixels(frameStyle, 'paddingLeft') + cssPixels(frameStyle, 'paddingRight')
  const frameVerticalInsets = cssPixels(frameStyle, 'borderTopWidth', 1)
    + cssPixels(frameStyle, 'borderBottomWidth', 1)
    + cssPixels(frameStyle, 'paddingTop') + cssPixels(frameStyle, 'paddingBottom')
  const maxPanelHeight = Math.min(rootRect.height, overlayRect.height) * 0.9
  const maxFrameOuterHeight = maxPanelHeight - panelFixedInsets
    - header.getBoundingClientRect().height - headerBottomMargin - actions.getBoundingClientRect().height
  const availableWidth = Math.max(0, frameRect.width - frameHorizontalInsets)
  const availableHeight = Math.max(0, maxFrameOuterHeight - frameVerticalInsets)
  const canvasWidth = Number(state.resultReportCanvasWidth) || 750
  const canvasHeight = Number(state.resultReportCanvasHeight)
  if (!(availableWidth > 0) || !(availableHeight > 0) || !(canvasHeight > 0)) return null
  const scale = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight)
  const imageWidth = Math.floor(canvasWidth * scale * 100) / 100
  const imageHeight = Math.floor(canvasHeight * scale * 100) / 100
  const frameHeight = Math.floor(imageHeight + frameVerticalInsets)
  image.style.width = `${imageWidth}px`
  image.style.height = `${imageHeight}px`
  image.style.maxWidth = '100%'
  image.style.maxHeight = '100%'
  image.style.objectFit = 'contain'
  image.style.objectPosition = 'center'
  frame.style.height = `${frameHeight}px`
  frame.style.flex = 'none'
  return { imageWidth, imageHeight, frameHeight, availableWidth, availableHeight, canvasWidth, canvasHeight }
}

function intersects(left, right) {
  return Boolean(left && right && left.x < right.right && left.right > right.x && left.y < right.bottom && left.bottom > right.y)
}

function containsRect(outer, inner, tolerance = 1) {
  return Boolean(outer && inner
    && inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance
    && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance)
}

function checkBoundHandlers(available) {
  const bound = [...app.querySelectorAll('[data-wx-event]')].map((element) => ({
    event: element.dataset.wxEvent,
    tag: element.tagName.toLowerCase(),
    className: String(element.className || ''),
  }))
  const missing = [...new Set(bound.map((entry) => entry.event).filter((event) => !available.includes(event)))]
  record('all production WXML event bindings map to page methods', missing.length === 0, { missing, bindingCount: bound.length })
  return bound
}

function measureLayout(state, expectedHeight, meta) {
  const pageScroll = app.querySelector('.page-scroll')
  const resultPane = app.querySelector('.result-pane')
  const resultCard = app.querySelector('.result-card')
  const rail = app.querySelector('.action-rail')
  const resultTabList = app.querySelector('.result-tabs[role="tablist"]')
  const resultTabListBox = box(resultTabList)
  let activeCoreBox = null
  const viewport = { width: innerWidth, height: innerHeight }
  const railBox = box(rail)
  const paneBox = box(resultPane)
  const cardBox = box(resultCard)
  const cardStyle = resultCard && getComputedStyle(resultCard)
  const cardBorderTop = cssPixels(cardStyle, 'borderTopWidth')
  const cardBorderRight = cssPixels(cardStyle, 'borderRightWidth')
  const background = getComputedStyle(app).backgroundColor
  record('viewport equals requested mini-program content window', innerHeight === Number(expectedHeight), {
    actual: viewport, expectedHeight,
  })
  record('page root and result card stay horizontally centered without overflow',
    Math.abs((cardBox?.centerX || 0) - viewport.width / 2) <= 1
      && app.scrollWidth <= viewport.width + 1
      && document.documentElement.scrollWidth <= viewport.width + 1,
  { viewport, pageWidth: app.getBoundingClientRect().width, resultCard: cardBox })
  record('page scroll uses the full available content height',
    pageScroll && Math.abs(pageScroll.getBoundingClientRect().height - viewport.height) <= 1,
  { viewportHeight: viewport.height, scrollHeight: pageScroll?.getBoundingClientRect().height })
  record('light/dark media theme is applied',
    query.get('theme') === 'dark' ? background === 'rgb(0, 0, 0)' : background === 'rgb(242, 242, 247)',
  { theme: query.get('theme'), background })

  const actionButtons = [...app.querySelectorAll('.action-rail .action-button')]
  const actionRects = actionButtons.map(box)
  const actionGaps = actionRects.slice(1).map((item, index) => item.y - actionRects[index].bottom)
  const expectedRailTop = round(resultTabListBox.bottom - cardBox.y + Number.parseFloat(getComputedStyle(resultTabList).marginBottom || '0'))
  const actualRailTopFromPaddingEdge = round(railBox.y - cardBox.y - cardBorderTop)
  const expectedRailRight = round(cardBox.right - cardBorderRight)
  const railLayoutValid = Boolean(actionButtons.length === 4 && rail && resultCard && resultTabList
    && rail.closest('.result-card-tabs') === resultCard
    && containsRect(cardBox, railBox)
    && Math.abs(railBox.right - expectedRailRight) <= 1
    && Math.abs(actualRailTopFromPaddingEdge - expectedRailTop) <= 1
    && resultTabListBox.bottom <= railBox.y + 1
    && Math.abs(railBox.width - 44) <= 1 && Math.abs(railBox.height - 188) <= 1
    && actionRects.every((item) => Math.abs(item.width - 44) <= 1 && Math.abs(item.height - 44) <= 1
      && containsRect(railBox, item))
    && actionRects.every((item) => Math.abs(item.x - railBox.x) <= 1)
    && Math.abs(actionRects[0].y - railBox.y) <= 1
    && Math.abs(actionRects.at(-1).bottom - railBox.bottom) <= 1
    && actionGaps.every((gap) => Math.abs(gap - 4) <= 1))
  record('four result actions stay in a 44px vertical rail at the card top-right below the tab row',
    railLayoutValid,
  { count: actionButtons.length, rail: railBox, card: cardBox, tabList: resultTabListBox,
    expectedRailTop, actualRailTopFromPaddingEdge, expectedRailRight, cardBorderTop, cardBorderRight,
    actionRects, actionGaps, resultPane: paneBox })
  const actionMetrics = actionButtons.map((button) => {
    const icon = button.querySelector('.action-icon')
    const iconStyle = icon && getComputedStyle(icon)
    const rect = box(button)
    return {
      label: button.getAttribute('aria-label'),
      box: rect,
      disabled: button.hasAttribute('disabled'),
      mask: iconStyle?.maskImage || iconStyle?.webkitMaskImage || '',
    }
  })
  record('each rail action has a 44px target and a loaded SVG mask',
    actionMetrics.length === 4 && actionMetrics.every((item) => item.box?.width >= 44 && item.box?.height >= 44 && item.mask.includes('data:image/svg+xml')),
  actionMetrics)

  const sheetCloseButtons = [...app.querySelectorAll('.sheet-close')].filter((button) => button.getClientRects().length)
  if (sheetCloseButtons.length) {
    record('visible sheet close controls override the mini-program 184px button default with a 44px target',
      sheetCloseButtons.every((button) => Math.abs(box(button).width - 44) <= 1 && Math.abs(box(button).height - 44) <= 1),
    sheetCloseButtons.map((button) => ({ label: button.getAttribute('aria-label'), box: box(button) })))
  }

  const visibleText = ['.result-label', '.result-condition', '.result-model', '.result-subtitle', '.spl-value', '.result-hero-caption', '.metric-value', '.metric-label', '.result-note', '.result-trust-text',
    '.distance-tab-condition', '.distance-value', '.distance-spl', '.distance-current', '.distance-mode-note',
    '.reference-tab-condition', '.reference-title', '.reference-chip', '.reference-description', '.meeting-text', '.reference-scale', '.result-trust-badge']
    .flatMap((selector) => [...app.querySelectorAll(selector)])
    .filter((element) => element.getClientRects().length && element.textContent.trim() && !element.closest('.details-panel'))
  const overlaps = visibleText.flatMap((element) => {
    const textFragments = textFragmentRects(element)
    const fragments = textFragments.length ? textFragments : [textBox(element)]
    return fragments.filter((fragment) => intersects(fragment, railBox)).map((fragment) => ({
      className: element.className,
      text: element.textContent.trim().slice(0, 90),
      textBox: fragment,
    }))
  })
  record('action rail does not overlap visible primary or secondary result text', overlaps.length === 0, overlaps)

  const model = app.querySelector('.result-model')
  if (model && model.getClientRects().length) {
    record('long model text wraps without clipping', model.scrollWidth <= model.clientWidth + 1 && model.clientHeight >= 18, {
      text: model.textContent.trim(), width: model.clientWidth, scrollWidth: model.scrollWidth, height: model.clientHeight,
    })
  }

  const viewportRect = { x: 0, y: 0, width: viewport.width, height: viewport.height, right: viewport.width, bottom: viewport.height }
  const mainScreen = !state.shareSheetVisible && !state.projectSheetVisible && !state.selectorVisible
  if (mainScreen) {
    const root = app.querySelector('.page-root')
    const content = app.querySelector('.page-content')
    const inputCard = app.querySelector('.settings-card')
    const required = [resultPane, resultCard, inputCard, rail,
      ...app.querySelectorAll('.result-card-tabs .result-tabs, .result-card-tabs .result-tab, .result-card-tabs [role="tabpanel"], .result-card-tabs [role="tabpanel"] *'),
      ...app.querySelectorAll('.settings-card .field, .settings-card .field-error, .settings-card input, .settings-card .picker-value, .action-rail .action-button')]
      .filter((element) => element?.getClientRects().length)
    const extents = [root, pageScroll, content].filter(Boolean).map((element) => {
      const style = getComputedStyle(element)
      return {
        className: element.className,
        box: box(element),
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      }
    })
    const noRootOverflow = extents.every((item) => item.scrollTop === 0 && item.scrollLeft === 0
      && item.scrollWidth <= item.clientWidth + 1 && item.scrollHeight <= item.clientHeight + 1
      && !['hidden', 'clip'].includes(item.overflowY) && !['hidden', 'clip'].includes(item.overflowX))
      && document.documentElement.scrollTop === 0 && document.body.scrollTop === 0
      && document.documentElement.scrollHeight <= viewport.height + 1
      && document.body.scrollHeight <= viewport.height + 1
    const requiredRects = required.map((element) => ({ className: String(element.className || element.tagName), rect: box(element) }))
    const everyRequiredVisible = required.every((element) => containsRect(viewportRect, box(element), 1))
    const cardsOrdered = Boolean(resultPane && inputCard && resultPane.getBoundingClientRect().bottom <= inputCard.getBoundingClientRect().top + 1
      && resultPane.compareDocumentPosition(inputCard) & Node.DOCUMENT_POSITION_FOLLOWING)
    record('normal SPL home keeps result, all inputs and the 44px rail in one unclipped viewport without page scrolling',
      noRootOverflow && everyRequiredVisible && cardsOrdered,
    { viewport, extents, required: requiredRects, everyRequiredVisible, cardsOrdered,
      document: { scrollTop: document.documentElement.scrollTop, scrollHeight: document.documentElement.scrollHeight,
        bodyScrollTop: document.body.scrollTop, bodyScrollHeight: document.body.scrollHeight } })
  }

  if (state.result && !state.isCalculationPending && state.resultTab === 'spl') {
    const hero = app.querySelector('.result-primary .spl-value')
    const heroText = textBox(hero)
    record('main SPL number stays centered in the viewport',
      Boolean(heroText) && Math.abs((heroText.x + heroText.right) / 2 - viewport.width / 2) <= 1,
    { heroText, viewportWidth: viewport.width })

    if (scenario.endsWith('long-model')) {
      record('long-model fixture selects the longest valid speaker catalog entry',
        Boolean(meta.interaction?.longestModel)
          && state.result.model === meta.interaction.longestModel
          && meta.interaction.longestModelLength >= 9
          && meta.interaction.longestModelLength === meta.interaction.longestModel.length,
      { selectedModel: state.result.model, expectedLongestModel: meta.interaction?.longestModel,
        modelLength: meta.interaction?.longestModelLength })
    }

    if (mainScreen && state.resultTab === 'spl') {
      const homeGrid = app.querySelector('.result-grid-home')
      const metricCards = [...app.querySelectorAll('.result-grid-home .metric')]
      const metricValues = [...app.querySelectorAll('.result-grid-home .metric-value')]
      const metricOverlaps = metricCards.flatMap((metric) => actionButtons
        .filter((button) => intersects(box(metric), box(button)))
        .map((button) => ({ metric: box(metric), action: button.getAttribute('aria-label'), actionBox: box(button) })))
      record('home metric cards clear every button in the result action rail', metricCards.length === 4 && metricOverlaps.length === 0,
        { count: metricCards.length, metrics: metricCards.map(box), overlaps: metricOverlaps })
      const oneMeter = metricValues[0]
      const totalPower = metricValues[1]
      record('SPL tab retains one-meter SPL, total rated power, sensitivity and summation metrics',
        Boolean(homeGrid && oneMeter && totalPower && metricValues.length === 4)
          && oneMeter.textContent.trim() === `${state.result.oneMeterSpl} dB SPL`
          && totalPower.textContent.trim() === `${state.result.totalRatedPower} W`
          && metricValues[2].textContent.trim() === `${state.result.sensitivityDb} dB`
          && metricValues[3].textContent.trim() === `+${state.result.summationGainDb} dB`,
      { oneMeter: oneMeter?.textContent.trim(), expectedOneMeter: `${state.result.oneMeterSpl} dB SPL`,
        totalPower: totalPower?.textContent.trim(), expectedTotalPower: `${state.result.totalRatedPower} W`,
        metricValues: metricValues.map((element) => element.textContent.trim()) })
      const firstMetric = oneMeter
      const firstMetricCard = metricCards[0]
      const firstMetricCardBox = box(firstMetricCard)
      const homeGridBox = box(homeGrid)
      const firstMetricBox = box(firstMetric)
      const metricLineRects = textLineRects(firstMetric)
      const metricTextFragments = textFragmentRects(firstMetric)
      const firstMetricStyle = firstMetric ? getComputedStyle(firstMetric) : null
      const firstMetricCellContained = Boolean(firstMetricCardBox && homeGridBox && firstMetricBox
        && containsRect(homeGridBox, firstMetricCardBox)
        && containsRect(firstMetricCardBox, firstMetricBox)
        && metricLineRects.every((line) => containsRect(firstMetricBox, line)
          && containsRect(firstMetricCardBox, line))
        && metricCards.slice(1).every((card) => !intersects(firstMetricCardBox, box(card))))
      record('first one-meter metric box and every rendered glyph remain inside its own grid cell',
        firstMetricCellContained,
        { grid: homeGridBox, cell: firstMetricCardBox, valueBox: firstMetricBox,
          glyphLines: metricLineRects, siblingCells: metricCards.slice(1).map(box) })
      record('first home metric value and dB SPL unit render on one readable 14px line without clipping',
        Boolean(firstMetric && /dB\s+SPL$/.test(firstMetric.textContent.trim())
          && firstMetricStyle.fontSize === '14px' && metricTextFragments.length === 1
          && firstMetric.scrollWidth <= firstMetric.clientWidth + 1),
      { text: firstMetric?.textContent.trim(), fontSize: firstMetricStyle?.fontSize,
        lineRects: metricLineRects, textFragments: metricTextFragments,
        valueBox: firstMetricBox, clientWidth: firstMetric?.clientWidth, scrollWidth: firstMetric?.scrollWidth,
        viewport, model: state.result.model, count: state.result.speakerCount })
    }
  }

  const tabKeys = ['spl', 'distance', 'reference']
  const tabIdByKey = { spl: 'splTabResult', distance: 'splTabDistance', reference: 'splTabReference' }
  const panelIdByKey = { spl: 'splPanelResult', distance: 'splPanelDistance', reference: 'splPanelReference' }
  const selectedTabKey = tabKeys.includes(state.resultTab) ? state.resultTab : 'spl'
  const tabList = app.querySelector('.result-tabs[role="tablist"]')
  const tabElements = [...app.querySelectorAll('.result-tabs [role="tab"]')]
  const panelElements = [...app.querySelectorAll('.result-card-tabs [role="tabpanel"]')]
  const expectedActivePanelId = state.result && !state.isCalculationPending ? panelIdByKey[selectedTabKey] : panelIdByKey.spl
  const activePanel = document.getElementById(expectedActivePanelId)
  const selectedTabs = tabElements.filter((tab) => tab.getAttribute('aria-selected') === 'true')
  const tabTargetsMatchContract = tabElements.length === tabKeys.length && tabElements.every((tab) => {
    const key = tabKeys.find((candidate) => tabIdByKey[candidate] === tab.id)
    return Boolean(key && tab.getAttribute('aria-controls') === panelIdByKey[key])
  })
  record('result area exposes three labelled tabs and exactly one matching active panel',
    Boolean(tabList && tabElements.length === 3 && panelElements.length === 1 && activePanel
      && selectedTabs.length === 1 && selectedTabs[0].id === tabIdByKey[selectedTabKey]
      && activePanel.getAttribute('aria-labelledby') === selectedTabs[0]?.id
      && selectedTabs[0]?.getAttribute('aria-controls') === activePanel.id
      && tabTargetsMatchContract && activePanel.closest('.result-card-tabs') === resultCard
      && tabList.compareDocumentPosition(activePanel) & Node.DOCUMENT_POSITION_FOLLOWING
      && !app.querySelector('#splResultDetails, #splDetailPanel, .details-panel')),
  { tabs: tabElements.map((tab) => ({ id: tab.id, role: tab.getAttribute('role'), selected: tab.getAttribute('aria-selected'),
    disabled: tab.getAttribute('aria-disabled'), controls: tab.getAttribute('aria-controls'), box: box(tab) })),
    panels: panelElements.map((panel) => ({ id: panel.id, role: panel.getAttribute('role'), labelledBy: panel.getAttribute('aria-labelledby') })),
    expectedActivePanelId, selectedTab: selectedTabs[0]?.id })
  if (mainScreen) {
    record('each result tab has a visible 44px touch target clear of the four-button action rail',
      tabElements.length === 3 && tabElements.every((tab) => box(tab)?.width >= 44 && box(tab)?.height >= 44
        && containsRect(cardBox, box(tab)) && containsRect(viewportRect, box(tab))
        && actionButtons.every((button) => !intersects(box(tab), box(button)))),
    { tabList: box(tabList), tabs: tabElements.map(box), actionRail: railBox })
  }

  if (state.result && !state.isCalculationPending) {
    if (mainScreen) {
    const panelStyle = activePanel && getComputedStyle(activePanel)
    const coreSelectorByTab = {
      spl: '.result-spl-core',
      distance: '.distance-tab-main',
      reference: '.reference-tab-core',
    }
    const activeCore = activePanel?.querySelector(coreSelectorByTab[selectedTabKey])
    activeCoreBox = box(activeCore)
    const coreDoesNotIntersectActions = Boolean(activeCoreBox)
      && actionButtons.every((button) => !intersects(activeCoreBox, box(button)))
    record('active result core stays centered inside the card and clear of every action button',
      Boolean(activeCoreBox && containsRect(cardBox, activeCoreBox) && containsRect(viewportRect, activeCoreBox)
        && Math.abs(activeCoreBox.centerX - viewport.width / 2) <= 1 && coreDoesNotIntersectActions),
    { core: activeCoreBox, card: cardBox, viewport, actions: actionRects,
      coreDoesNotIntersectActions })
    const panelNodes = activePanel ? [...activePanel.querySelectorAll('*')].filter((element) => element.getClientRects().length) : []
    const panelContentVisible = Boolean(activePanel && containsRect(cardBox, box(activePanel))
      && containsRect(viewportRect, box(activePanel))
      && panelNodes.every((element) => containsRect(cardBox, box(element)) && containsRect(viewportRect, box(element))))
    const panelDoesNotScroll = Boolean(activePanel && activePanel.scrollTop === 0
      && activePanel.scrollLeft === 0 && activePanel.scrollHeight <= activePanel.clientHeight + 1
      && activePanel.scrollWidth <= activePanel.clientWidth + 1
      && !['auto', 'scroll'].includes(panelStyle?.overflowY))
    record('selected result panel and all descendants fit the result card and viewport without local scrolling or clipping',
      panelContentVisible && panelDoesNotScroll,
    { panel: box(activePanel), panelScroll: activePanel ? { top: activePanel.scrollTop, left: activePanel.scrollLeft,
      height: activePanel.scrollHeight, clientHeight: activePanel.clientHeight, width: activePanel.scrollWidth,
      clientWidth: activePanel.clientWidth, overflowY: panelStyle?.overflowY } : null,
      card: cardBox, viewport, outside: panelNodes.filter((element) => !containsRect(cardBox, box(element))
        || !containsRect(viewportRect, box(element))).map((element) => ({ className: element.className, box: box(element) })) })

    if (selectedTabKey === 'spl') {
      const hero = activePanel.querySelector('.spl-value')
      const metricCards = [...activePanel.querySelectorAll('.result-grid-home .metric')]
      const metricValues = [...activePanel.querySelectorAll('.result-grid-home .metric-value')]
      const heroBox = textBox(hero)
      const metrics = metricValues.map((element) => element.textContent.trim())
      const expectedMetrics = [`${state.result.oneMeterSpl} dB SPL`, `${state.result.totalRatedPower} W`,
        `${state.result.sensitivityDb} dB`, `+${state.result.summationGainDb} dB`]
      record('SPL tab keeps current value centered and all four unchanged metrics',
        Boolean(heroBox) && Math.abs((heroBox.x + heroBox.right) / 2 - viewport.width / 2) <= 1
          && metricCards.length === 4 && JSON.stringify(metrics) === JSON.stringify(expectedMetrics),
      { hero: heroBox, metrics, expectedMetrics, metricCards: metricCards.map(box) })
    } else if (selectedTabKey === 'distance') {
      const distanceList = activePanel.querySelector('.distance-list')
      const distanceStyle = distanceList && getComputedStyle(distanceList)
      const rows = [...activePanel.querySelectorAll('.distance-list .distance-row')]
      const expectedRows = state.result.distanceRows || []
      const actualRows = rows.map((row) => Number.parseFloat(row.querySelector('.distance-value')?.textContent || 'NaN'))
      const distanceListBox = box(distanceList)
      const condition = activePanel.querySelector('.distance-tab-condition')
      const modeLabel = state.result.speakerCount > 1
        ? state.result.summationModeShortLabel
        : '单只基准'
      const expectedCondition = `${state.result.model} · ${state.result.speakerCount} 只 · ${modeLabel} · 自由场`
      record('distance tab keeps model, count, summation mode and free-field assumption visible',
        condition?.textContent.trim() === expectedCondition,
      { actual: condition?.textContent.trim(), expected: expectedCondition, box: box(condition) })
      const note = activePanel.querySelector('.distance-mode-note')
      const expectedNote = state.result.speakerCount > 1
        ? `单只音箱在此距离的理论声压级为 ${state.result.singleSelectedSpl} dB SPL；${state.result.summationModeDescription}`
        : '单只基准，叠加增益为 +0 dB；每增加一倍距离，理论声压级降低约 6 dB。'
      record('distance tab preserves every calculated row in engine order and exact distance condition',
        Boolean(distanceList && distanceStyle.display === 'flex' && distanceStyle.flexDirection === 'column'
          && rows.length === expectedRows.length
          && JSON.stringify(actualRows)
            === JSON.stringify(expectedRows.map((row) => row.distanceMeters))
          && rows.every((row, index) => row.querySelector('.distance-value')?.textContent.trim() === `${expectedRows[index]?.distanceMeters} m`)
          && rows.every((row, index) => row.querySelector('.distance-spl')?.textContent.trim() === `${expectedRows[index]?.spl} dB SPL`)
          && note?.textContent.trim() === expectedNote),
      { display: distanceStyle?.display, flexDirection: distanceStyle?.flexDirection, rowCount: rows.length,
        actualRows: rows.map((row) => row.querySelector('.distance-value')?.textContent.trim()),
        expectedRows: expectedRows.map((row) => `${row.distanceMeters} m`), note: note?.textContent.trim(), expectedNote })
      const rowDetails = rows.map((row) => {
        const label = row.querySelector('.distance-value')
        const head = row.querySelector('.distance-row-head')
        const result = row.querySelector('.distance-result')
        const spl = row.querySelector('.distance-spl')
        const unit = spl?.querySelector('text')
        const current = row.querySelector('.distance-current')
        const rowBox = box(row)
        const labelBox = box(label)
        const headBox = box(head)
        const resultBox = box(result)
        const splBox = box(spl)
        const currentBox = box(current)
        const labelStyle = label ? getComputedStyle(label) : null
        const currentStyle = current ? getComputedStyle(current) : null
        const glyphLines = textLineRects(spl)
        const glyphFragments = textFragmentRects(spl)
        const unitStyle = unit ? getComputedStyle(unit) : null
        const expectedUnitSize = viewport.width <= 360 ? '8px' : '9px'
        return {
          distance: Number.parseFloat(label?.textContent || 'NaN'), row: rowBox, head: headBox, label: labelBox,
          result: resultBox, spl: splBox, current: currentBox, glyphLines, glyphFragments,
          unitTag: unit?.tagName.toLowerCase(), unitFontSize: unitStyle?.fontSize,
          rowContainsChildren: Boolean(rowBox && containsRect(rowBox, headBox) && containsRect(rowBox, resultBox)
            && containsRect(rowBox, labelBox) && (!currentBox || containsRect(rowBox, currentBox))
            && splBox && containsRect(rowBox, splBox)),
          headContainsChildren: Boolean(headBox && containsRect(headBox, labelBox)
            && (!currentBox || containsRect(headBox, currentBox))),
          labelWrapsWithoutOverflow: Boolean(label && labelStyle.whiteSpace === 'normal'
            && Number.parseFloat(labelStyle.flexShrink) > 0
            && labelStyle.overflowWrap === 'anywhere'
            && label.scrollWidth <= label.clientWidth + 1),
          currentBadgeFixed: !current || currentStyle.flexShrink === '0',
          labelsSeparated: Boolean(headBox && resultBox && !intersects(headBox, resultBox)
            && (!currentBox || !intersects(labelBox, currentBox))),
          splSingleLineAndContained: Boolean(spl && /dB\s+SPL$/.test(spl.textContent.trim())
            && spl.scrollWidth <= spl.clientWidth + 1 && glyphLines.length === 1
            && glyphFragments.length > 0 && glyphFragments.every((fragment) => containsRect(splBox, fragment)
              && containsRect(rowBox, fragment))),
          unitSizeCorrect: Boolean(unit && unitStyle.fontSize === expectedUnitSize),
          rowVisible: Boolean(rowBox && containsRect(cardBox, rowBox) && containsRect(viewportRect, rowBox)),
          currentCount: current ? 1 : 0,
          activeRow: row.classList.contains('distance-row-active'),
        }
      })
      const selectedRows = rowDetails.filter((row) => row.activeRow)
      const selectedDistance = Number(state.result.distanceMeters)
      const currentBadgeValid = rowDetails.reduce((sum, row) => sum + row.currentCount, 0) === 1
        && selectedRows.length === 1 && selectedRows[0].distance === selectedDistance
      record('every distance row keeps label, SPL/unit and current badge inside its cell with single-line glyphs',
        rowDetails.length > 0 && currentBadgeValid && rowDetails.every((row) => row.rowContainsChildren
          && row.headContainsChildren && row.labelWrapsWithoutOverflow && row.labelsSeparated
          && row.currentBadgeFixed && row.splSingleLineAndContained && row.unitSizeCorrect && row.rowVisible),
      { selectedDistance, currentBadgeValid, rows: rowDetails })
      const rowBoxes = rowDetails.map((row) => row.row)
      const resultBoxes = rowDetails.map((row) => row.result)
      const rowsShareLeftEdge = rowBoxes.length > 0 && rowBoxes.every(Boolean)
        && rowBoxes.every((rowBox) => Math.abs(rowBox.x - rowBoxes[0].x) <= 1)
      const resultsShareRightEdge = resultBoxes.length > 0 && resultBoxes.every(Boolean)
        && resultBoxes.every((resultBox) => Math.abs(resultBox.right - resultBoxes[0].right) <= 1)
      const rowsStayInList = Boolean(distanceListBox && rowBoxes.length === rows.length
        && rowBoxes.every(Boolean) && rowBoxes.every((rowBox, index) => containsRect(distanceListBox, rowBox)
          && (index === 0 || rowBox.y >= rowBoxes[index - 1].bottom - 1)))
      record('distance list keeps every row aligned, ordered vertically and free of overlap',
        rowsShareLeftEdge && resultsShareRightEdge && rowsStayInList,
      { list: distanceListBox, rowsShareLeftEdge, resultsShareRightEdge, rowsStayInList,
        rows: rowBoxes, results: resultBoxes })
    } else if (selectedTabKey === 'reference') {
      const items = [...activePanel.querySelectorAll('.reference-tab-item')]
      const titles = [...activePanel.querySelectorAll('.reference-title')].map((element) => element.textContent.trim())
      const descriptions = [...activePanel.querySelectorAll('.reference-description')].map((element) => element.textContent.trim())
      const referencePairs = items.map((item) => {
        const heading = item.querySelector('.reference-heading')
        const copy = item.querySelector('.reference-copy')
        const title = item.querySelector('.reference-title')
        const chip = item.querySelector('.reference-chip')
        const description = item.querySelector('.reference-description')
        const itemBox = box(item)
        const headingBox = box(heading)
        const copyBox = box(copy)
        const titleBox = box(title)
        const chipBox = box(chip)
        const descriptionBox = box(description)
        const titleLines = textLineRects(title)
        const descriptionLines = textLineRects(description)
        return {
          title: title?.textContent.trim(), chip: chip?.textContent.trim(), description: description?.textContent.trim(),
          boxes: { item: itemBox, heading: headingBox, copy: copyBox, title: titleBox, chip: chipBox, description: descriptionBox },
          titleChipSeparated: Boolean(copyBox && chipBox && !intersects(copyBox, chipBox)),
          chipVisible: Boolean(chipBox && containsRect(itemBox, chipBox) && containsRect(viewportRect, chipBox)),
          titleContained: Boolean(title && title.scrollWidth <= title.clientWidth + 1
            && titleLines.length >= 1 && titleLines.every((line) => containsRect(titleBox, line)
              && containsRect(itemBox, line))),
          descriptionContained: Boolean(description && description.scrollWidth <= description.clientWidth + 1
            && description.scrollHeight <= description.clientHeight + 1
            && descriptionLines.length >= 1 && descriptionLines.every((line) => containsRect(descriptionBox, line)
              && containsRect(itemBox, line))),
          itemVisible: Boolean(containsRect(cardBox, itemBox) && containsRect(viewportRect, itemBox)),
        }
      })
      const human = state.result.humanReference
      const meeting = state.result.meetingReference
      const footer = activePanel.querySelector('.reference-tab-footer')
      const meetingText = activePanel.querySelector('.meeting-text')
      const referenceScale = activePanel.querySelector('.reference-scale')
      const trust = activePanel.querySelector('.result-trust')
      const footerNodes = [footer, meetingText, referenceScale, trust,
        ...activePanel.querySelectorAll('.reference-scale > *, .result-trust *')].filter((element) => element?.getClientRects().length)
      const allReferencesMatch = titles.includes(String(human?.title || '')) && titles.includes(String(meeting?.title || ''))
        && descriptions.includes(String(human?.description || '')) && descriptions.includes(String(meeting?.description || ''))
      record('reference tab displays both dynamic titles and full descriptions without title/chip overlap or clipping',
        items.length === 2 && allReferencesMatch && referencePairs.every((item) => item.titleChipSeparated && item.chipVisible
          && item.titleContained && item.descriptionContained && item.itemVisible),
      { expectedHuman: human, expectedMeeting: meeting, referencePairs })
      const expectedBranches = meta.interaction?.referenceBranchExpected
      if (expectedBranches) {
        record('reference branch fixture reaches its requested human level and meeting threshold',
          state.result.humanReference.level === expectedBranches.human
            && state.result.meetingReference.level === expectedBranches.meeting,
        { expected: expectedBranches, actual: {
          selectedSpl: state.result.selectedSpl,
          distanceMeters: state.result.distanceMeters,
          human: state.result.humanReference.level,
          meeting: state.result.meetingReference.level,
        } })
      }
      record('reference tab keeps comparison qualification, scale and trust footer fully visible',
        Boolean(footer && meetingText?.textContent.includes('不代表工程验收结论')
          && referenceScale?.querySelectorAll(':scope > *').length === 3
          && trust?.textContent.includes('该数值不是现场实测声压级')
          && footerNodes.every((element) => containsRect(cardBox, box(element)) && containsRect(viewportRect, box(element)))),
      { footer: box(footer), meetingText: meetingText?.textContent.trim(), scale: box(referenceScale),
        scaleItems: [...(referenceScale?.children || [])].map((element) => ({ text: element.textContent.trim(), box: box(element) })),
        trust: box(trust), outside: footerNodes.filter((element) => !containsRect(cardBox, box(element))
          || !containsRect(viewportRect, box(element))).map((element) => ({ className: element.className, box: box(element) })) })
      if (state.result.meetingReference.description.includes('频率响应')) {
        record('long meeting-reference description retains all qualification clauses',
          state.result.meetingReference.description.includes('传声增益')
            && state.result.meetingReference.description.includes('稳态声场不均匀度')
            && state.result.meetingReference.description.includes('系统噪声')
            && referencePairs.some((item) => item.description === state.result.meetingReference.description),
        { description: state.result.meetingReference.description })
      }
    }
    }
  } else if (mainScreen) {
    const allDisabled = tabElements.length === 3 && tabElements.every((tab) => tab.getAttribute('aria-disabled') === 'true')
    record('pending or invalid result disables tab switching and exposes no stale distance/reference pane',
      allDisabled && panelElements.length === 1 && activePanel?.id === panelIdByKey.spl
        && !activePanel?.querySelector('.distance-list') && !activePanel?.querySelector('.reference-tab-item'),
    { pending: state.isCalculationPending, result: Boolean(state.result), tabs: tabElements.map((tab) => tab.getAttribute('aria-disabled')),
      activePanel: activePanel?.id, activePaneCount: panelElements.length })
  }

  if (scenario.startsWith('tab-')) {
    const expectedHapticCount = meta.interaction?.requestedTab === 'spl' ? 2 : 1
    record('production tab handler changes the selected pane without recalculation, preference writes or export changes',
      meta.interaction?.tabTransitionAccepted === true
        && meta.interaction?.selectedTab === state.resultTab
        && meta.interaction?.tabVibrations?.length === expectedHapticCount
        && meta.interaction?.tabVibrations?.every((entry) => entry?.type === 'light')
        && meta.interaction?.tabDidNotRecalculate === true
        && meta.interaction?.tabPayloadUnchanged === true
        && meta.interaction?.tabSignatureUnchanged === true
        && meta.interaction?.tabPreferencesUnchanged === true
        && meta.interaction?.tabReportCacheUnchanged === true
        && meta.interaction?.tabReportPathUnchanged === true,
    { requestedTab: meta.interaction?.requestedTab, transitionResults: meta.interaction?.tabTransitionResults,
      selectedTab: meta.interaction?.selectedTab, vibrations: meta.interaction?.tabVibrations,
      unchanged: { result: meta.interaction?.tabDidNotRecalculate, payload: meta.interaction?.tabPayloadUnchanged,
        signature: meta.interaction?.tabSignatureUnchanged, preferences: meta.interaction?.tabPreferencesUnchanged,
        reportCache: meta.interaction?.tabReportCacheUnchanged, reportPath: meta.interaction?.tabReportPathUnchanged } })
  }
  if (scenario === 'reset-blank') {
    const countValue = app.querySelector('.compact-grid .picker-value')
    const speakerPlaceholder = app.querySelector('.equipment-placeholder')
    const input = app.querySelector('.distance-input')
    record('reset clears, persists, and reopens as the explicit blank input state without a modal',
      meta.interaction?.resetAccepted === true
        && meta.interaction?.resetModalCount === 0
        && meta.interaction?.persistedPreferences?.speakerModel === ''
        && meta.interaction?.persistedPreferences?.speakerCount === null
        && meta.interaction?.persistedPreferences?.distanceText === ''
        && meta.interaction?.reopenedPreferences?.speakerModel === ''
        && meta.interaction?.reopenedHasResult === false
        && state.speakerIndex === -1 && state.selectedSpeaker === null
        && state.countIndex === -1 && state.distanceText === '' && !state.result
        && countValue?.textContent.includes('请选择数量')
        && speakerPlaceholder?.textContent.includes('请选择音箱型号')
        && input?.value === '',
    { interaction: meta.interaction, speakerIndex: state.speakerIndex, countIndex: state.countIndex,
      distanceText: state.distanceText, result: Boolean(state.result), count: countValue?.textContent.trim(),
      speaker: speakerPlaceholder?.textContent.trim(), distanceInput: input?.value })
  }

  if (scenario === 'reset-error') {
    const resetError = app.querySelector('.reset-error')
    const inputCard = app.querySelector('.settings-card')
    record('failed reset keeps the valid result and every input visible with a readable error',
      meta.interaction?.resetAccepted === false
        && meta.interaction?.resultPreservedAfterResetError === true
        && meta.interaction?.inputsPreservedAfterResetError === true
        && Boolean(resetError?.textContent.includes('保存失败'))
        && containsRect(box(inputCard), box(resetError))
        && containsRect(viewportRect, box(resetError)),
    { interaction: meta.interaction, error: resetError?.textContent.trim(), errorBox: box(resetError),
      result: Boolean(state.result), speakerIndex: state.speakerIndex, countIndex: state.countIndex, distanceText: state.distanceText })
  }

  const reset = app.querySelector('.action-rail .icon-reset')?.closest('.action-button')
  if (reset && (state.isCalculationPending || state.distanceError || !state.result)) {
    record('reset action remains available for a changed pending/invalid input',
      Boolean(state.canReset) ? !reset.hasAttribute('disabled') : reset.hasAttribute('disabled'),
    { canReset: state.canReset, pending: state.isCalculationPending, invalid: !state.result, disabled: reset.hasAttribute('disabled') })
  }

  const shareButton = app.querySelector('.action-rail .icon-share')?.closest('.action-button')
  record('share control is part of the result action rail', Boolean(shareButton), { shareActionBox: box(shareButton), rail: railBox })

  if (state.selectorVisible) {
    const selectorClose = app.querySelector('.selector-close')
    record('selector close control is fixed to a 44px circle',
      Boolean(selectorClose) && Math.abs(box(selectorClose).width - 44) <= 1
        && Math.abs(box(selectorClose).height - 44) <= 1,
    box(selectorClose))
    const empty = app.querySelector('.selector-empty')
    record('selector empty-state matches the current empty result',
      (Number(state.selectorItems?.length) === 0) === Boolean(empty),
    { itemCount: state.selectorItems?.length, emptyVisible: Boolean(empty) })
    const rows = app.querySelectorAll('.selector-row').length
    record('selector displays exactly the current loaded batch', rows === (state.selectorItems?.length || 0), {
      renderedRows: rows, totalItems: state.selectorTotalCount, stateBatch: state.selectorItems?.length,
    })
    const detailButtons = [...app.querySelectorAll('.selector-detail')]
    if (detailButtons.length) {
      record('selector detail actions keep their compact 58 by 44px target',
        detailButtons.every((button) => Math.abs(box(button).width - 58) <= 1 && Math.abs(box(button).height - 44) <= 1),
      detailButtons.map((button) => box(button)))
    }
  }

  if (state.shareSheetVisible) {
    const panel = app.querySelector('.share-panel')
    const actions = [...app.querySelectorAll('.share-panel .share-action')]
    record('share preview panel and both actions fit within viewport width',
      Boolean(panel) && box(panel).width <= viewport.width && actions.length === 2 && actions.every((button) => box(button).height >= 44),
    { panel: box(panel), actions: actions.map(box) })
    record('share actions have explicit equal columns without overflow',
      actions.length === 2 && actions.every((button) => box(button).width >= 44)
        && Math.abs(box(actions[0]).width - box(actions[1]).width) <= 1
        && actions.every((button) => box(button).x >= box(panel).x - 1 && box(button).right <= box(panel).right + 1),
    { actions: actions.map(box), panel: box(panel) })
    record('share preview loading state is rendered when generation is active',
      !state.isGeneratingResultReport || Boolean(app.querySelector('.share-state .loading-dot')),
    { generating: state.isGeneratingResultReport, loadingVisible: Boolean(app.querySelector('.share-state .loading-dot')) })
    const retry = app.querySelector('.share-state .share-retry')
    if (retry) {
      record('share retry remains a compact 44px-or-taller control',
        box(retry).width >= 44 && box(retry).width <= 171 && box(retry).height >= 44,
      box(retry))
      record('share actions remain disabled when no report image is available',
        !state.resultReportImagePath && actions.every((button) => button.hasAttribute('disabled')),
      { resultReportImagePath: state.resultReportImagePath, disabled: actions.map((button) => button.hasAttribute('disabled')) })
    }
    const image = app.querySelector('.share-image')
    const frame = app.querySelector('#splShareImageFrame')
    const sharePanel = app.querySelector('#splSharePanel')
    if (image && frame) {
      const imageBox = box(image)
      const frameBox = box(frame)
      const panelBox = box(sharePanel)
      const imageStyle = getComputedStyle(image)
      const frameStyle = getComputedStyle(frame)
      const imageRatio = image.naturalWidth / image.naturalHeight
      const boxRatio = imageBox.width / imageBox.height
      const scrollAncestor = frame.closest('.share-image-scroll')
      const actualImage = {
        src: image.getAttribute('src'),
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        image: imageBox,
        frame: frameBox,
        panel: panelBox,
        imageRatio,
        boxRatio,
        objectFit: imageStyle.objectFit,
        imageOverflowX: image.scrollWidth - image.clientWidth,
        imageOverflowY: image.scrollHeight - image.clientHeight,
        frameOverflowY: frameStyle.overflowY,
        frameScrollHeight: frame.scrollHeight,
        frameClientHeight: frame.clientHeight,
        scrollAncestor: scrollAncestor ? box(scrollAncestor) : null,
        sizing: meta.interaction?.browserPreviewLayout || null,
      }
      record('preview renders the complete image aspectFit inside a non-scrolling bounded frame',
        image.naturalWidth > 0 && image.naturalHeight > 0
          && imageStyle.objectFit === 'contain'
          && Math.abs(imageRatio - boxRatio) <= 0.015
          && imageBox.x >= frameBox.x + 1 && imageBox.right <= frameBox.right - 1
          && imageBox.y >= frameBox.y + 1 && imageBox.bottom <= frameBox.bottom - 1
          && frameBox.x >= panelBox.x - 1 && frameBox.right <= panelBox.right + 1
          && frameBox.y >= panelBox.y - 1 && frameBox.bottom <= panelBox.bottom + 1
          && frameStyle.overflowY === 'hidden'
          && frame.scrollHeight <= frame.clientHeight + 1
          && !scrollAncestor,
      actualImage)
      if (meta.reportAssetMode === 'native-wechat-png') {
        const native = meta.interaction?.nativeReportMetadata
        record('share preview uses the current WeChat-exported report PNG and canvas dimensions',
          image.getAttribute('src') === native?.url
            && image.naturalWidth === native?.pixelWidth
            && image.naturalHeight === native?.pixelHeight
            && native?.canvasWidth === 750
            && native?.canvasHeight === state.resultReportCanvasHeight,
        { ...actualImage, native })
        const reportPayload = native?.payload
        const currentPayload = meta.interaction?.currentPayload
        record('native report metadata matches the current SPL model/count/distance/result text',
          Boolean(reportPayload && currentPayload)
            && reportPayload.preferences?.speakerModel === currentPayload.preferences?.speakerModel
            && reportPayload.preferences?.speakerCount === currentPayload.preferences?.speakerCount
            && reportPayload.preferences?.distanceText === currentPayload.preferences?.distanceText
            && reportPayload.summary === currentPayload.summary
            && reportPayload.resultText === currentPayload.resultText,
        { reportModel: reportPayload?.preferences?.speakerModel, currentModel: currentPayload?.preferences?.speakerModel,
          reportCount: reportPayload?.preferences?.speakerCount, currentCount: currentPayload?.preferences?.speakerCount,
          reportDistance: reportPayload?.preferences?.distanceText, currentDistance: currentPayload?.preferences?.distanceText,
          reportSummary: reportPayload?.summary, currentSummary: currentPayload?.summary,
          resultTextMatches: reportPayload?.resultText === currentPayload?.resultText })
        if (meta.stateName === 'share-long-kf') {
          const selected = meta.interaction?.selectedBeforeExport
          record('KF-D10F native long report case reaches the intended model/count/distance through production controls',
            selected?.speakerModel === 'KF-D10F'
              && selected?.speakerCount === 2
              && selected?.distanceText === '4'
              && reportPayload?.preferences?.speakerModel === 'KF-D10F'
              && reportPayload?.preferences?.speakerCount === 2
              && reportPayload?.preferences?.distanceText === '4',
          { selected, reportPreferences: reportPayload?.preferences })
        }
      } else if (meta.reportAssetMode === 'synthetic-layout-only') {
        record('synthetic short image shrinks to its complete aspectFit size',
          image.naturalWidth === 750 && image.naturalHeight === 600
            && frameBox.height < viewport.height * 0.7,
        { ...actualImage, canvasHeight: state.resultReportCanvasHeight })
      }
    }

    const splStyles = wxssSources.find((item) => item.url.endsWith('/pages/spl/spl.wxss'))?.source || ''
    const motionReduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const animationName = getComputedStyle(panel).animationName
    const animationDuration = getComputedStyle(panel).animationDuration
    const durationValue = Number.parseFloat(animationDuration) || 0
    const durationMs = animationDuration.endsWith('ms') ? durationValue : durationValue * 1000
    const expectedAnimation = state.shareSheetClosing ? 'spl-sheet-slide-out' : 'spl-sheet-slide-in'
    const slideKeyframes = splStyles.includes('@keyframes spl-sheet-slide-in{from{transform:translateY(calc(100% + env(safe-area-inset-bottom)))}to{transform:translateY(0)}}')
      && splStyles.includes('@keyframes spl-sheet-slide-out{from{transform:translateY(0)}to{transform:translateY(calc(100% + env(safe-area-inset-bottom)))}}')
    record('share sheet uses a 320ms translate-only full-height slide and stays opaque',
      animationName === expectedAnimation && (motionReduced ? durationMs <= 0.02 : Math.abs(durationMs - 320) <= 1)
        && getComputedStyle(panel).opacity === '1'
        && slideKeyframes
        && !/@keyframes\s+spl-sheet-slide-(?:in|out)[^{]*\{[^}]*opacity\s*:/.test(splStyles),
    { stateClosing: state.shareSheetClosing, animationName, animationDuration, durationMs,
      reducedMotion: motionReduced, opacity: getComputedStyle(panel).opacity, slideKeyframes })
  }

  if (state.projectSheetVisible) {
    const panel = app.querySelector('.project-panel')
    const panelRect = box(panel)
    record('project panel fits viewport width and remains bottom aligned',
      Boolean(panelRect) && panelRect.width <= viewport.width && panelRect.bottom <= viewport.height + 1,
    panelRect)
    const close = app.querySelector('.project-panel .sheet-close')
    record('project sheet close control stays 44 by 44px',
      Boolean(close) && Math.abs(box(close).width - 44) <= 1 && Math.abs(box(close).height - 44) <= 1,
    box(close))
    const body = app.querySelector('.project-sheet-body')
    const footer = app.querySelector('.project-footer')
    const footerButtons = [...app.querySelectorAll('.project-footer button')]
    const footerRect = box(footer)
    record('project footer remains visible inside the panel and viewport',
      Boolean(footerRect && panelRect) && footerRect.y >= panelRect.y - 1
        && footerRect.bottom <= panelRect.bottom + 1 && footerRect.bottom <= viewport.height + 1
        && footerButtons.length > 0 && footerButtons.every((button) => box(button).height >= 44),
    { footer: footerRect, panel: panelRect, buttons: footerButtons.map(box), viewport })
    record('project footer buttons do not overflow their available row',
      Boolean(footer) && footer.scrollWidth <= footer.clientWidth + 1,
    { scrollWidth: footer?.scrollWidth, clientWidth: footer?.clientWidth, buttons: footerButtons.map(box) })

    if (state.projectStep === 'select') {
      const search = app.querySelector('[data-project-field="projectSearch"]')
      const rows = [...app.querySelectorAll('.project-list .project-row')]
      record('project selection step exposes search, project list, and new-project action',
        Boolean(search && body && footerButtons.length === 1)
          && rows.length === (state.projectItems?.length || 0) && rows.length > 0,
      { search: box(search), body: box(body), rows: rows.map(box), stateItems: state.projectItems?.length })
      if (state.projectTargetId) {
        const selectedRow = rows.find((row) => row.getAttribute('aria-pressed') === 'true')
        const unselectedRow = rows.find((row) => row.getAttribute('aria-pressed') !== 'true')
        const selectedStyle = selectedRow ? getComputedStyle(selectedRow) : null
        const unselectedStyle = unselectedRow ? getComputedStyle(unselectedRow) : null
        record('selected project row keeps its selected border and background after button-default reset',
          Boolean(selectedRow && unselectedRow && selectedRow.classList.contains('project-row-selected')
            && (selectedStyle.borderColor !== unselectedStyle.borderColor
              || selectedStyle.backgroundColor !== unselectedStyle.backgroundColor)),
        { selected: selectedRow ? { box: box(selectedRow), border: selectedStyle.borderColor, background: selectedStyle.backgroundColor } : null,
          unselected: unselectedRow ? { box: box(unselectedRow), border: unselectedStyle.borderColor, background: unselectedStyle.backgroundColor } : null })
      }
    } else if (state.projectStep === 'create') {
      const name = app.querySelector('[data-project-field="newProjectName"]')
      record('project creation step exposes name field and create action',
        Boolean(name && body && footerButtons.length === 2 && footerButtons.some((button) => /创建项目/.test(button.textContent))),
      { name: box(name), body: box(body), buttons: footerButtons.map((button) => ({ text: button.textContent.trim(), box: box(button) })) })
    } else if (state.projectStep === 'details') {
      const name = app.querySelector('[data-project-field="projectConfigName"]')
      const note = app.querySelector('[data-project-field="projectConfigNote"]')
      const changeProject = app.querySelector('.project-target .text-action')
      const targetName = app.querySelector('.project-target-name')
      if (changeProject) {
        record('change-project action stays compact beside the project name',
          box(changeProject).width <= 84 && box(targetName)?.width >= 48,
        { changeProject: box(changeProject), targetName: box(targetName), targetScrollWidth: targetName?.scrollWidth })
      }
      record('configuration step exposes name, note, preview, and save actions',
        Boolean(name && note && app.querySelector('.project-preview') && footerButtons.length === 2
          && footerButtons.some((button) => /确认保存/.test(button.textContent))),
      { name: box(name), note: box(note), preview: box(app.querySelector('.project-preview')), buttons: footerButtons.map((button) => button.textContent.trim()) })
      if (!state.projectKeyboardActive) {
        const preview = app.querySelector('.project-preview')
        const bodyBox = box(body)
        const nameBox = box(name)
        const noteBox = box(note)
        const previewBox = box(preview)
        const fieldsVisible = Boolean(bodyBox && [nameBox, noteBox].every((item) => item
          && item.y >= bodyBox.y - 1 && item.bottom <= bodyBox.bottom + 1))
        const initialScrollTop = body?.scrollTop || 0
        if (body) body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
        const scrolledBodyBox = box(body)
        const scrolledPreviewBox = box(preview)
        const previewReachable = Boolean(scrolledBodyBox && scrolledPreviewBox
          && scrolledPreviewBox.y >= scrolledBodyBox.y - 1
          && scrolledPreviewBox.bottom <= scrolledBodyBox.bottom + 1)
        if (body) body.scrollTop = initialScrollTop
        record('no-keyboard project details use natural body height and expose name, note, and preview',
          fieldsVisible && body.clientHeight > 160 && body.scrollHeight > body.clientHeight
            && previewReachable,
        { body: bodyBox, bodyClientHeight: body?.clientHeight, bodyScrollHeight: body?.scrollHeight,
          name: nameBox, note: noteBox, preview: previewBox, scrolledBody: scrolledBodyBox,
          scrolledPreview: scrolledPreviewBox, previewReachable })
      }
    }

    if (state.projectKeyboardActive) {
      const keyboardField = meta.interaction?.keyboardField || 'projectConfigNote'
      const keyboardInput = app.querySelector(`[data-project-field="${keyboardField}"]`)
      const previousScrollTop = body?.scrollTop || 0
      const bodyBeforeScroll = box(body)
      const inputBeforeScroll = box(keyboardInput)
      if (body && bodyBeforeScroll && inputBeforeScroll) {
        let scrollDelta = 0
        if (inputBeforeScroll.bottom > bodyBeforeScroll.bottom) scrollDelta = inputBeforeScroll.bottom - bodyBeforeScroll.bottom
        else if (inputBeforeScroll.y < bodyBeforeScroll.y) scrollDelta = inputBeforeScroll.y - bodyBeforeScroll.y
        const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
        body.scrollTop = Math.max(0, Math.min(maxScrollTop, previousScrollTop + scrollDelta))
      }
      const bodyRect = box(body)
      const inputRect = box(keyboardInput)
      const visibleInputHeight = bodyRect && inputRect
        ? Math.max(0, Math.min(inputRect.bottom, bodyRect.bottom) - Math.max(inputRect.y, bodyRect.y))
        : 0
      const minimumVisibleInputHeight = bodyRect && inputRect
        ? Math.min(44, inputRect.height, bodyRect.height) - 1
        : 0
      const focusedFieldReachable = Boolean(bodyRect && inputRect)
        && inputRect.x >= bodyRect.x - 1 && inputRect.right <= bodyRect.right + 1
        && visibleInputHeight >= minimumVisibleInputHeight
      if (body) body.scrollTop = previousScrollTop
      const panelStyle = getComputedStyle(panel)
      record('keyboard presentation keeps a scrollable project body in short viewport',
        Boolean(body) && body.clientHeight >= 54 && body.scrollHeight >= body.clientHeight
          && getComputedStyle(body).overflowY === 'auto' && Number.parseFloat(panelStyle.maxHeight) > 0,
      { viewport, panel: panelRect, body: box(body), bodyScrollHeight: body?.scrollHeight, panelMaxHeight: panelStyle.maxHeight, marginBottom: panelStyle.marginBottom })
      const keyboardInputs = [...app.querySelectorAll('[data-project-field]')]
      record('project keyboard inputs carry revision and episode guards',
        keyboardInputs.length > 0 && keyboardInputs.every((input) => input.hasAttribute('data-project-revision') && input.hasAttribute('data-project-episode')),
      keyboardInputs.map((input) => ({ field: input.dataset.projectField, revision: input.dataset.projectRevision, episode: input.dataset.projectEpisode })))
      record('project keyboard state came from accepted production controller callbacks',
        meta.interaction?.focusEventAccepted === true
          && meta.interaction?.keyboardEventAccepted === true
          && keyboardInputs.some((input) => input.dataset.projectField === keyboardField
            && Number(input.dataset.projectRevision) === Number(meta.interaction.keyboardEventData.projectRevision)
            && Number(input.dataset.projectEpisode) === Number(meta.interaction.keyboardEventData.projectEpisode)),
      meta.interaction)
      record('focused project field can be reached by scrolling its step body',
        focusedFieldReachable,
      { field: keyboardField, body: bodyRect, inputBeforeScroll, input: inputRect, visibleInputHeight, minimumVisibleInputHeight, scrollTop: body?.scrollTop, scrollHeight: body?.scrollHeight })
      record('project keyboard layout style reflects a reduced viewport from production handlers',
        meta.interaction?.focusEventAccepted === true && meta.interaction?.keyboardEventAccepted === true
          && typeof meta.interaction.keyboardStyle === 'string'
          && /max-height:(?:\d+px|calc\()/.test(meta.interaction.keyboardStyle)
          && panelStyle.maxHeight !== 'none',
      { field: keyboardField, step: state.projectStep, style: meta.interaction?.keyboardStyle, panelMaxHeight: panelStyle.maxHeight, sourceNote: meta.sourceNote })
      const keyboardMode = meta.interaction?.keyboardMode
      const expectedLift = keyboardMode === 'overlay' ? meta.interaction?.keyboardHeight : 0
      const expectedViewportHeight = keyboardMode === 'overlay'
        ? meta.interaction?.baselineWindowHeight
        : meta.interaction?.baselineWindowHeight - meta.interaction?.keyboardHeight
      const reportedLift = Number.parseFloat(panelStyle.marginBottom) || 0
      record('keyboard fixture keeps DOM, wx window size, and production keyboard mode physically consistent',
        (keyboardMode === 'overlay' || keyboardMode === 'resize')
          && meta.interaction?.viewportHeight === viewport.height
          && meta.interaction?.eventWindowHeight === (keyboardMode === 'overlay'
            ? meta.interaction?.baselineWindowHeight : expectedViewportHeight)
          && meta.interaction?.platformWindowHeight === expectedViewportHeight
          && viewport.height === expectedViewportHeight,
      { mode: keyboardMode, baseline: meta.interaction?.baselineWindowHeight, viewport: viewport.height, eventWindow: meta.interaction?.eventWindowHeight, platformWindow: meta.interaction?.platformWindowHeight, expectedViewportHeight, sourceNote: meta.sourceNote })
      record('project panel keyboard lift matches overlay or viewport-resize mode',
        Math.abs(reportedLift - expectedLift) <= 1,
      { mode: keyboardMode, reportedLift, expectedLift, panel: panelRect, maxHeight: panelStyle.maxHeight })
      record('keyboard-adjusted project panel stays inside the available DOM viewport',
        Boolean(panelRect) && panelRect.y >= -1 && panelRect.bottom <= viewport.height + 1,
      { mode: keyboardMode, panel: panelRect, viewport })
    }
  }

  const conversion = {
    viewportWidth: innerWidth,
    rpxScale: innerWidth / 750,
    styleSources: wxssSources.map((item) => item.url),
    expandedImports: [...wxssPaths].sort(),
    remainingNumericRpx: wxssSources.reduce((sum, item) => sum + (convertRpx(item.source).match(/-?(?:\d+\.?\d*|\.\d+)rpx\b/gi) || []).length, 0),
  }
  record('production app and SPL WXSS imports are expanded and rpx converted',
    conversion.styleSources.length === 2 && conversion.expandedImports.includes('/styles/theme-page-shared.wxss') && conversion.remainingNumericRpx === 0,
  conversion)

  let bottomReachability = null
  if (mainScreen) {
    const content = app.querySelector('.page-content')
    bottomReachability = {
      mode: 'one-screen-home',
      pageScrollTop: pageScroll?.scrollTop ?? null,
      pageScrollHeight: pageScroll?.scrollHeight ?? null,
      pageClientHeight: pageScroll?.clientHeight ?? null,
      content: box(content),
      settingsCard: box(app.querySelector('.settings-card')),
      viewport,
    }
    record('home remains at scrollTop zero after layout measurements', Boolean(pageScroll && pageScroll.scrollTop === 0), bottomReachability)
  } else {
    bottomReachability = { mode: 'overlay-or-keyboard', pageScrollTop: pageScroll?.scrollTop ?? null }
  }
  return {
    stateName: scenario,
    theme: query.get('theme') || 'light',
    viewport,
    background,
    resultCard: cardBox,
    resultTabList: resultTabListBox,
    actionRail: railBox,
    actions: actionMetrics,
    activePanel: typeof activePanel === 'undefined' ? null : box(activePanel),
    activeCore: activeCoreBox,
    overlapFailures: overlaps,
    bottomReachability,
    conversion,
    loadedHashes: meta.loadedHashes,
    sourceServerStartedAt: meta.serverStartedAt,
  }
}

async function main() {
  const fixtureResponse = await fetch(`/__fixture?case=${encodeURIComponent(scenario)}&width=${innerWidth}&height=${innerHeight}&baselineHeight=${encodeURIComponent(query.get('baselineHeight') || innerHeight)}`, { cache: 'no-store' })
  const fixture = await fixtureResponse.json()
  if (!fixtureResponse.ok || fixture.error) throw new Error(fixture.error || `fixture HTTP ${fixtureResponse.status}`)
  const metaResponse = await fetch('/__qa-meta', { cache: 'no-store' })
  const meta = await metaResponse.json()
  if (!metaResponse.ok || JSON.stringify(meta.loadedHashes) !== JSON.stringify(meta.currentHashes)) {
    throw new Error('Production source changed while browser bridge was running')
  }
  await installProductionStyles()
  await renderProductionWxml(fixture.state)
  await Promise.all([...app.querySelectorAll('img')].map((image) => (
    typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve()
  )))
  const browserPreviewLayout = applyBrowserPreviewFit(fixture.state)
  if (browserPreviewLayout) fixture.interaction.browserPreviewLayout = browserPreviewLayout
  const finiteAnimations = document.getAnimations().filter((animation) => (
    Number.isFinite(animation.effect?.getTiming?.().iterations)
  ))
  await Promise.all(finiteAnimations.map((animation) => animation.finished.catch(() => {})))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const bindings = checkBoundHandlers(fixture.handlers)
  const geometry = measureLayout(fixture.state, fixture.viewportHeight, fixture)
  record('Chromium viewport and fixture use only the requested bridge state',
    geometry.viewport.height === fixture.viewportHeight,
    { actualHeight: geometry.viewport.height, fixtureHeight: fixture.viewportHeight, sourceNote: fixture.sourceNote })
  const result = {
    status: failures.length ? 'failed' : 'passed',
    startedAt: new Date().toISOString(),
    bridge: 'Chromium rendering actual production SPL WXML and expanded production WXSS; browser-only visual/layout evidence',
    limitations: 'This bridge does not execute the WeChat WXML/WXSS runtime or native components, keyboard, canvas export, sharing, or photo saving. Use WeChat simulator/device QA for those platform behaviors.',
    fixture: {
      stateName: fixture.stateName,
      sourceNote: fixture.sourceNote,
      reportAssetMode: fixture.reportAssetMode,
      interaction: fixture.interaction,
    },
    nativeReport: meta.nativeReport,
    geometry,
    bindings,
    checks,
    failures,
  }
  reportElement.hidden = false
  reportElement.textContent = JSON.stringify(result)
  document.body.dataset.qaStatus = result.status
  document.documentElement.dataset.splQaReady = 'true'
  document.title = `SPL QA ${result.status}: ${scenario}`
  window.__splBrowserQa = result
}

main().catch((error) => {
  const result = { status: 'error', stateName: scenario, error: String(error && error.stack || error) }
  reportElement.hidden = false
  reportElement.textContent = JSON.stringify(result)
  document.body.dataset.qaStatus = 'error'
  document.documentElement.dataset.splQaError = String(error && error.message || error)
  document.documentElement.dataset.splQaReady = 'error'
  document.title = `SPL QA error: ${scenario}`
  window.__splBrowserQa = result
})


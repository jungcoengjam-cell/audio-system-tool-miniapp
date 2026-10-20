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


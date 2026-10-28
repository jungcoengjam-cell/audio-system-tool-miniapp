'use strict'

// Focused 320 CSS-pixel evidence for mid-page and horizontal-scroll behavior.
// Uses the same production WXML/WXSS browser adapter as run-browser-qa.cjs.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('../../homepage-refactor-2026-10-18/browser-driver.cjs')

const root = path.resolve(__dirname, '../../..')
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline/content.json'), 'utf8'))
const evidenceRoot = path.join(root, 'tmp/basis-editorial-2026-10-28/qa-evidence')
const output = path.join(evidenceRoot, `review-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const tools = ['limiter', 'camera', 'cable']
const pngPath = path.join(root, 'pages/basis/assets/limiter.png')
const image = fs.readFileSync(pngPath)
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

async function startPage(browser, tool, theme, expanded = true, zoom = false) {
  await browser.viewport(320, 844, theme)
  await browser.navigate({ theme, entry: 'pages/basis/detail.js', tool })
  await delay(100)
  if (expanded) {
    await browser.evaluate(`window.__dispatch('toggleFullExplanation')`)
    await delay(260)
  }
  if (zoom) {
    await browser.evaluate(`(() => {
      const page = document.querySelector('.basis-detail-page')
      const leaves = [...page.querySelectorAll('*')].filter(node => node.children.length === 0 && node.textContent.trim())
      for (const node of leaves) {
        const size = Number.parseFloat(getComputedStyle(node).fontSize)
        if (Number.isFinite(size)) node.style.fontSize = (size * 1.25) + 'px'
      }
      return leaves.length
    })()`)
    await delay(60)
  }
  const facts = await browser.evaluate(`(() => {
    const page = document.querySelector('.basis-detail-page')
    const scroll = document.querySelector('.basis-detail-scroll')
    const figure = document.querySelector('.basis-figure')
    const title = document.querySelector('.basis-detail-title')
    const method = document.querySelector('[data-basis-field="method"]')
    const fullSource = document.querySelector('[data-basis-field="sourceSummary"]')
    const quickSource = document.querySelector('[data-basis-field="quickSource"]')
    const figureCaption = document.querySelector('.basis-figure-caption')
    const methodLabel = document.querySelector('[data-basis-field="method"]')?.closest('.basis-full-field')?.querySelector('.basis-full-label')
    const boundaryTitle = document.querySelector('.basis-limit-block .basis-reference-title')
    const boundaryCopy = document.querySelector('.basis-limit-block .basis-reference-copy')
    const formulas = [...document.querySelectorAll('.basis-formula-text[data-basis-formula-id]')].map(node => ({
      id:node.dataset.basisFormulaId,
      text:String(node.textContent || '').replace(/\\s+/g, ' ').trim(),
      whiteSpace:getComputedStyle(node).whiteSpace,
      color:getComputedStyle(node).color,
      fontSize:getComputedStyle(node).fontSize,
      fontWeight:getComputedStyle(node).fontWeight,
      scroller:node.closest('.basis-formula-scroll') ? {
        clientWidth:node.closest('.basis-formula-scroll').clientWidth,
        clientHeight:node.closest('.basis-formula-scroll').clientHeight,
        scrollWidth:node.closest('.basis-formula-scroll').scrollWidth,
        minHeight:getComputedStyle(node.closest('.basis-formula-scroll')).minHeight,
        overflowX:getComputedStyle(node.closest('.basis-formula-scroll')).overflowX,
        backgroundColor:getComputedStyle(node.closest('.basis-formula-scroll')).backgroundColor,
        borderWidths:['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].map(key=>getComputedStyle(node.closest('.basis-formula-scroll'))[key]),
        borderRadii:['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(key=>getComputedStyle(node.closest('.basis-formula-scroll'))[key]),
        paddingX:[getComputedStyle(node.closest('.basis-formula-scroll')).paddingLeft,getComputedStyle(node.closest('.basis-formula-scroll')).paddingRight],
        boxShadow:getComputedStyle(node.closest('.basis-formula-scroll')).boxShadow,
        rowBackgroundColor:getComputedStyle(node.closest('.basis-formula-row')).backgroundColor,
        rowBorderWidths:['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].map(key=>getComputedStyle(node.closest('.basis-formula-row'))[key]),
        rowBorderRadii:['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(key=>getComputedStyle(node.closest('.basis-formula-row'))[key]),
        rowPaddingX:[getComputedStyle(node.closest('.basis-formula-row')).paddingLeft,getComputedStyle(node.closest('.basis-formula-row')).paddingRight],
      } : null,
    }))
    const textFrom = (node, insideText = false) => {
      if (!node) return ''
      if (node.nodeType === Node.TEXT_NODE) return insideText || !/^\\s+$/.test(node.nodeValue) ? node.nodeValue : ''
      const isText = insideText || node.tagName === 'TEXT'
      return [...node.childNodes].map(child => textFrom(child, isText)).join('')
    }
    const norm = value => String(value ?? '').replace(/\\s+/g, ' ').trim()
    const fullFields = Object.fromEntries(['what','method','inputs','sourceSummary','limits'].map(field => {
      const node = document.querySelector('[data-basis-field="'+field+'"]')
      return [field, norm(textFrom(node))]
    }))
    const quickParameters = [...document.querySelectorAll('.basis-parameter-table .basis-parameter')].map(row => ({
      label:norm(textFrom(row.querySelector('.basis-parameter-label'))),
      value:norm(textFrom(row.querySelector('.basis-parameter-value'))),
    }))
    const pageData = window.__homepageQa.data
    const resolveToken = token => {
      const probe=document.createElement('span')
      probe.style.color='var('+token+')'
      page.append(probe)
      const color=getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const rect = node => { const r=node?.getBoundingClientRect(); return r ? {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height} : null }
    return {
      width:innerWidth,
      pageWidth:document.documentElement.scrollWidth,
      bodyWidth:document.body.scrollWidth,
      articleWidth:page?.clientWidth || 0,
      articleScrollWidth:page?.scrollWidth || 0,
      scrollWidth:document.querySelector('.basis-detail-scroll')?.scrollWidth || 0,
      scrollClientWidth:document.querySelector('.basis-detail-scroll')?.clientWidth || 0,
      title: title?.textContent || '',
      disclosureOpen:document.querySelector('#basis-full-content')?.classList.contains('disclosure-motion-open') || false,
      figure:{complete:figure?.complete,naturalWidth:figure?.naturalWidth,naturalHeight:figure?.naturalHeight,src:figure?.getAttribute('src')},
      sourceBasis:pageData.basisTool.basis,
      quick:pageData.presentation.quick,
      dom:{subtitle:norm(textFrom(document.querySelector('.basis-detail-subtitle'))),quickMethod:norm(textFrom(document.querySelector('[data-basis-field="quickMethod"]'))),quickSource:norm(textFrom(document.querySelector('[data-basis-field="quickSource"]'))),quickLimit:norm(textFrom(document.querySelector('.basis-limit-block .basis-reference-copy'))),fullFields,quickParameters},
      accentColors:{accent:resolveToken('--theme-accent'),accentText:resolveToken('--theme-accent-text')},
      article:rect(page),
      method:rect(method),
      methodField:rect(method?.closest('.basis-full-field')),
      scroll:rect(scroll),
      scrollTop:scroll?.scrollTop || 0,
      scrollHeight:scroll?.scrollHeight || 0,
      formulas,
      semanticColors:{
        fullSource:fullSource ? getComputedStyle(fullSource).color : '',
        quickSource:quickSource ? getComputedStyle(quickSource).color : '',
        figureCaption:figureCaption ? getComputedStyle(figureCaption).color : '',
        fullMethod:method ? getComputedStyle(method).color : '',
        methodLabel:methodLabel ? getComputedStyle(methodLabel).color : '',
        boundaryTitle:boundaryTitle ? getComputedStyle(boundaryTitle).color : '',
        boundaryCopy:boundaryCopy ? getComputedStyle(boundaryCopy).color : '',
      },
      errors:window.__facts().errors,
      runtimeErrors:window.__facts().runtimeErrors,
    }
  })()`)
  assert.equal(facts.width, 320)
  assert(facts.pageWidth <= 321 && facts.bodyWidth <= 321, `${tool}: page overflow in 320px capture`)
  assert(facts.articleScrollWidth <= facts.articleWidth + 1, `${tool}: article scrolls horizontally`)
  assert(facts.scrollWidth <= facts.scrollClientWidth + 1, `${tool}: page scroll-view scrolls horizontally`)
  assert(facts.disclosureOpen === expanded, `${tool}: disclosure state mismatch`)
  assert.equal(facts.semanticColors.fullSource, facts.semanticColors.figureCaption, `${tool}: full source uses secondary text color`)
  assert.equal(facts.semanticColors.quickSource, facts.semanticColors.figureCaption, `${tool}: quick source uses secondary text color`)
  assert.notEqual(facts.semanticColors.fullSource, facts.semanticColors.fullMethod, `${tool}: full source differs from primary method copy`)
  assert.notEqual(facts.semanticColors.methodLabel, facts.semanticColors.fullMethod, `${tool}: full method label differs from method copy`)
  assert.notEqual(facts.semanticColors.boundaryTitle, facts.semanticColors.boundaryCopy, `${tool}: warning boundary label differs from body copy`)
  assert(facts.errors.length === 0 && facts.runtimeErrors.length === 0, `${tool}: browser errors ${JSON.stringify(facts.errors.concat(facts.runtimeErrors))}`)
  if (tool !== 'cable') {
    assert(facts.figure?.complete && facts.figure.naturalWidth === 750 && facts.figure.naturalHeight === 560,
      `${tool}: figure PNG did not load at the expected 750x560 source size`)
  }
  assertContent(facts, tool)
  assertFormulaStyles(facts, tool, zoom)
  return facts
}

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function assertContent(facts, tool) {
  const frozen = baseline.tools.find(item => item.id === tool)
  assert(frozen, `Missing frozen basis content for ${tool}`)
  assert.deepEqual(facts.sourceBasis, frozen.basis, `${tool}: original basis fields remain unchanged`)
  assert.deepEqual(facts.quick, frozen.presentation.quick, `${tool}: original quick explanation fields remain unchanged`)
  assert.equal(facts.dom.subtitle, norm(frozen.presentation.quick.purpose), `${tool}: rendered purpose is unchanged`)
  assert.equal(facts.dom.quickMethod, norm(frozen.presentation.quick.method), `${tool}: rendered quick method is unchanged`)
  assert.equal(facts.dom.quickSource, norm(frozen.presentation.quick.source), `${tool}: rendered quick source is unchanged`)
  assert.equal(facts.dom.quickLimit, norm(frozen.presentation.quick.limit), `${tool}: rendered quick limit is unchanged`)
  for (const field of ['what','method','inputs','sourceSummary','limits']) {
    assert.equal(facts.dom.fullFields[field], norm(frozen.basis[field]), `${tool}: rendered ${field} is unchanged`)
  }
  assert.deepEqual(facts.dom.quickParameters, frozen.presentation.quick.parameters.map(item => ({label:norm(item.label),value:norm(item.value)})),
    `${tool}: rendered parameter labels, numbers, and units are unchanged`)
}

function assertFormulaStyles(facts, tool, zoom) {
  assert(facts.formulas.length > 0, `${tool}: no formula spans found`)
  const expectedSize = zoom ? '18.75px' : '15px'
  for (const formula of facts.formulas) {
    assert.equal(formula.whiteSpace, 'nowrap', `${tool}: ${formula.id} must remain a single line`)
    assert.equal(formula.fontSize, expectedSize, `${tool}: ${formula.id} font size must be ${expectedSize}`)
    assert(Number.parseFloat(formula.fontWeight) >= 650, `${tool}: ${formula.id} should retain strong emphasis`)
    assert(formula.scroller, `${tool}: ${formula.id} must remain in a scroll-view`)
    assert(['auto','scroll'].includes(formula.scroller.overflowX), `${tool}: ${formula.id} scroll view lost horizontal scrolling`)
    assert(Number.parseFloat(formula.scroller.minHeight) >= 44 && formula.scroller.clientHeight >= 44,
      `${tool}: formula scroll min-height/box height is below 44px`)
    assert(/rgba\(0, 0, 0, 0\)|transparent/.test(formula.scroller.backgroundColor),
      `${tool}: ${formula.id} still has a formula-box background ${formula.scroller.backgroundColor}`)
    assert(formula.scroller.borderWidths.every(value => Number.parseFloat(value) === 0),
      `${tool}: ${formula.id} still has a border/left accent line: ${JSON.stringify(formula.scroller.borderWidths)}`)
    assert(formula.scroller.borderRadii.every(value => Number.parseFloat(value) === 0),
      `${tool}: ${formula.id} still has rounded-box corners: ${JSON.stringify(formula.scroller.borderRadii)}`)
    assert(formula.scroller.paddingX.every(value => Number.parseFloat(value) === 0),
      `${tool}: ${formula.id} still has horizontal formula-box padding: ${JSON.stringify(formula.scroller.paddingX)}`)
    assert.equal(formula.scroller.boxShadow, 'none', `${tool}: ${formula.id} still looks like a raised text box`)
    assert(/rgba\(0, 0, 0, 0\)|transparent/.test(formula.scroller.rowBackgroundColor), `${tool}: formula row has a background`)
    assert(formula.scroller.rowBorderWidths.every(value => Number.parseFloat(value) === 0), `${tool}: formula row has a border`)
    assert(formula.scroller.rowBorderRadii.every(value => Number.parseFloat(value) === 0), `${tool}: formula row has rounded corners`)
    assert(formula.scroller.rowPaddingX.every(value => Number.parseFloat(value) === 0), `${tool}: formula row has horizontal padding`)
    assert([facts.accentColors.accent,facts.accentColors.accentText].includes(formula.color),
      `${tool}: ${formula.id} is not rendered in a theme accent color (${formula.color})`)
  }
}

async function checkAllFormulaEnds(browser) {
  return browser.evaluate(`(() => {
    const results = []
    for (const formula of document.querySelectorAll('.basis-formula-text[data-basis-formula-id]')) {
      if (!formula.getClientRects().length) continue
      const scroller = formula.closest('.basis-formula-scroll')
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
      scroller.scrollLeft = maxScroll
      const clip = scroller.getBoundingClientRect()
      const walker = document.createTreeWalker(formula, NodeFilter.SHOW_TEXT)
      let lastText, next
      while ((next = walker.nextNode())) if (next.nodeValue.length) lastText = next
      let end = null
      if (lastText) {
        const range = document.createRange()
        range.setStart(lastText, lastText.nodeValue.length - 1)
        range.setEnd(lastText, lastText.nodeValue.length)
        const rect = range.getBoundingClientRect()
        end = {x:rect.x,right:rect.right,width:rect.width}
      }
      results.push({
        id:formula.dataset.basisFormulaId,
        text:String(formula.textContent || '').replace(/\\s+/g,' ').trim(),
        clientWidth:scroller.clientWidth,scrollWidth:scroller.scrollWidth,
        maxScroll,scrollLeft:scroller.scrollLeft,
        lastChar:end,
        lastCharVisible:Boolean(end && end.width > 0 && end.x >= clip.left - 1 && end.right <= clip.right + 1),
      })
      scroller.scrollLeft = 0
    }
    return results
  })()`)
}

async function scrollMethodTop(browser) {
  return browser.evaluate(`(() => {
    const scroll = document.querySelector('.basis-detail-scroll')
    const method = document.querySelector('[data-basis-field="method"]')
    const scrollRect = scroll.getBoundingClientRect()
    const methodRect = method.closest('.basis-full-field').getBoundingClientRect()
    scroll.scrollTop += methodRect.top - scrollRect.top - 12
    const next = method.closest('.basis-full-field').getBoundingClientRect()
    return {scrollTop:scroll.scrollTop, methodTop:next.top, methodBottom:next.bottom, height:next.height, viewportBottom:scrollRect.bottom}
  })()`)
}

async function scrollMethodBottom(browser) {
  return browser.evaluate(`(() => {
    const scroll = document.querySelector('.basis-detail-scroll')
    const field = document.querySelector('[data-basis-field="method"]').closest('.basis-full-field')
    const scrollRect = scroll.getBoundingClientRect()
    const fieldRect = field.getBoundingClientRect()
    scroll.scrollTop += fieldRect.bottom - scrollRect.bottom + 12
    const next = field.getBoundingClientRect()
    return {scrollTop:scroll.scrollTop, methodTop:next.top, methodBottom:next.bottom, viewportTop:scrollRect.top, viewportBottom:scrollRect.bottom}
  })()`)
}

async function scrollLongestLimiterFormula(browser) {
  return browser.evaluate(`(() => {
    const text = [...document.querySelectorAll('.basis-formula-text[data-basis-formula-id]')]
      .find(node => node.dataset.basisFormulaId.startsWith('quick-method-') && node.textContent.includes('V_target = min(√(P_speaker × Z_total), √(P_amp × Z_total))'))
    if (!text) return {found:false}
    const scroll = text.closest('.basis-formula-scroll')
    scroll.scrollLeft = scroll.scrollWidth
    const clip = scroll.getBoundingClientRect()
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
    let lastText, next
    while ((next = walker.nextNode())) if (next.nodeValue.length) lastText = next
    const range = document.createRange()
    range.setStart(lastText, lastText.nodeValue.length - 1)
    range.setEnd(lastText, lastText.nodeValue.length)
    const end = range.getBoundingClientRect()
    return {
      found:true,
      id:text.dataset.basisFormulaId,
      text:String(text.textContent).replace(/\\s+/g,' ').trim(),
      clientWidth:scroll.clientWidth,
      scrollWidth:scroll.scrollWidth,
      scrollLeft:scroll.scrollLeft,
      maxScroll:Math.max(0,scroll.scrollWidth-scroll.clientWidth),
      scrollRight:clip.right,
      lastChar:{x:end.x,right:end.right,width:end.width},
      lastCharVisible:end.width > 0 && end.x >= clip.left - 1 && end.right <= clip.right + 1,
    }
  })()`)
}

async function capture(browser, name) {
  await browser.screenshot(path.join(output, `${name}.png`))
}

async function main() {
  assert(!fs.existsSync(output), `Evidence directory already exists: ${output}`)
  fs.mkdirSync(output, { recursive:true })
  const browser = await launch()
  const captures = []
  try {
    const limiterTop = await startPage(browser, 'limiter', 'light', true)
    await capture(browser, 'limiter-320-light-expanded-top')
    captures.push({ name:'limiter-320-light-expanded-top', facts:limiterTop })

    await browser.evaluate(`(() => { const node=document.querySelector('.basis-detail-scroll'); node.scrollTop=0 })()`)
    const longest = await scrollLongestLimiterFormula(browser)
    assert(longest.found && longest.scrollWidth > longest.clientWidth, 'limiter min(sqrt...) must scroll inside its own formula view')
    assert(longest.scrollLeft === longest.maxScroll && longest.lastCharVisible,
      `limiter formula end is clipped: ${JSON.stringify(longest)}`)
    await capture(browser, 'limiter-320-light-long-formula-end')
    captures.push({ name:'limiter-320-light-long-formula-end', formulaEnd:longest })

    const limiterMethodTop = await scrollMethodTop(browser)
    await delay(40)
    await capture(browser, 'limiter-320-light-method-top')
    const limiterMethodBottom = await scrollMethodBottom(browser)
    await delay(40)
    await capture(browser, 'limiter-320-light-method-bottom')
    captures.push({ name:'limiter-method-region', top:limiterMethodTop, bottom:limiterMethodBottom })

    const camera = await startPage(browser, 'camera', 'light', true)
    const cameraMethodTop = await scrollMethodTop(browser)
    await delay(40)
    await capture(browser, 'camera-320-light-method-top')
    const cameraMethodBottom = await scrollMethodBottom(browser)
    await delay(40)
    await capture(browser, 'camera-320-light-method-bottom')
    captures.push({ name:'camera-method-region', facts:camera, top:cameraMethodTop, bottom:cameraMethodBottom })

    const cableDark = await startPage(browser, 'cable', 'dark', false)
    await capture(browser, 'cable-320-dark-collapsed-top')
    captures.push({ name:'cable-320-dark-collapsed-top', facts:cableDark })

    const zoom = await startPage(browser, 'limiter', 'light', true, true)
    const zoomMethodTop = await scrollMethodTop(browser)
    await delay(40)
    await capture(browser, 'limiter-320-light-method-font-1.25x')
    const zoomMethodBottom = await scrollMethodBottom(browser)
    await delay(40)
    await capture(browser, 'limiter-320-light-method-font-1.25x-bottom')
    captures.push({ name:'limiter-font-zoom-1.25x', facts:zoom, top:zoomMethodTop, bottom:zoomMethodBottom })
  } finally {
    await browser.close()
  }

  const summary = {
    evidenceDirectory:output,
    browser:'headless Chrome through the production WXML/WXSS adapter at 320 CSS pixels',
    nativeDevice:false,
    screenshots:fs.readdirSync(output).filter(name => name.endsWith('.png')).sort(),
    updatedLimiterPng:{ path:'pages/basis/assets/limiter.png', width:image.readUInt32BE(16), height:image.readUInt32BE(20), byteLength:image.length, sha256:sha256(image) },
    captures,
  }
  fs.writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag:'wx' })
  console.log(JSON.stringify({ evidenceDirectory:output, screenshots:summary.screenshots.length, limiterPng:summary.updatedLimiterPng, result:'passed' }, null, 2))
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

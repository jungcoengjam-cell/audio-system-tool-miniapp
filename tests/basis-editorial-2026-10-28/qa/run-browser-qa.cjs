'use strict'

// Source-backed Chromium rendering of the production WXML/WXSS and page module.
// This is a browser adapter, not a WeChat runtime or a physical-device test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('../../homepage-refactor-2026-10-18/browser-driver.cjs')

const root = path.resolve(__dirname, '../../..')
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline/content.json'), 'utf8'))
const evidenceRoot = path.join(root, 'tmp/basis-editorial-2026-10-28/qa-evidence')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const output = path.join(evidenceRoot, runId)
const widths = [320, 390, 430]
const themes = ['light', 'dark']
const tools = baseline.tools.map(({ id }) => id)
const zoomTools = ['cable', 'limiter', 'camera', 'ledScreen']
const zoomFactor = 1.25

const formulaCases = [
  { tool: 'cable', field: 'presentation.quick.method', scope: 'quick-method', text: 'S≥P×L×5' },
  { tool: 'cable', field: 'basis.method', scope: 'complete-method', text: 'S ≥ P × L × 5' },
  { tool: 'cable', field: 'basis.sourceSummary', scope: 'complete-source', text: 'S ≥ P × L × 5' },
  { tool: 'gainStructure', field: 'presentation.quick.method', scope: 'quick-method', text: 'dBu = dBFS + 18.4' },
  { tool: 'gainStructure', field: 'basis.sourceSummary', scope: 'complete-source', text: '0 dBFS = +18.4 dBu' },
  { tool: 'limiter', field: 'presentation.quick.method', scope: 'quick-method', text: 'V_target = min(√(P_speaker × Z_total), √(P_amp × Z_total))', mustOverflowAt320: true },
  { tool: 'limiter', field: 'basis.method', scope: 'complete-method', text: 'V_target = min(V_speaker, V_amp)' },
  { tool: 'spl', field: 'presentation.quick.method', scope: 'quick-method', text: '1 m 基准 = 灵敏度 + 10 × log₁₀(额定功率) + 叠加增益' },
  { tool: 'spl', field: 'presentation.quick.parameters[2].value', scope: 'quick-parameter-3', text: 'm（≥ 1）' },
  { tool: 'spl', field: 'basis.inputs', scope: 'complete-inputs', text: '≥1 m' },
  { tool: 'camera', field: 'basis.method', scope: 'complete-method', text: 'q_right = ((P−C)·r)/((P−C)·f)' },
  { tool: 'camera', field: 'basis.method', scope: 'complete-method', text: 'q_up = ((P−C)·u)/((P−C)·f)' },
  { tool: 'camera', field: 'basis.method', scope: 'complete-method', text: '±tan(水平/垂直视场角 ÷ 2)' },
  { tool: 'ledScreen', field: 'basis.method', scope: 'complete-method', text: '目标比例误差 ≤5%' },
  { tool: 'ledScreen', field: 'basis.method', scope: 'complete-method', text: '最近距离 ≥1.7P' },
]

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function getByPath(source, expression) {
  return expression.split('.').reduce((value, part) => {
    const arrayPart = part.match(/^([^[]+)\[(\d+)\]$/)
    return arrayPart ? value?.[arrayPart[1]]?.[Number(arrayPart[2])] : value?.[part]
  }, source)
}

for (const item of formulaCases) {
  const frozen = baseline.tools.find((tool) => tool.id === item.tool)
  assert(frozen, `Missing frozen formula owner ${item.tool}`)
  assert(norm(getByPath(frozen, item.field)).includes(norm(item.text)),
    `The formula check must be grounded in frozen content: ${item.tool}.${item.field}`)
}

function browserExpression(tool, expected) {
  return `(() => {
    const expected = ${JSON.stringify(expected)}
    const norm = value => String(value ?? '').replace(/\\s+/g, ' ').trim()
    const textFrom = (node, insideText = false) => {
      if (!node) return ''
      if (node.nodeType === Node.TEXT_NODE) return insideText || !/^\\s+$/.test(node.nodeValue) ? node.nodeValue : ''
      const isText = insideText || node.tagName === 'TEXT'
      return [...node.childNodes].map(child => textFrom(child, isText)).join('')
    }
    const fields = Object.fromEntries([...document.querySelectorAll('[data-basis-field]')]
      .map(node => [node.dataset.basisField, norm(textFrom(node))]))
    const quickParameters = [...document.querySelectorAll('.basis-parameter-table .basis-parameter')].map(row => ({
      label: norm(textFrom(row.querySelector('.basis-parameter-label'))),
      value: norm(textFrom(row.querySelector('.basis-parameter-value'))),
    }))
    const subtitle = norm(textFrom(document.querySelector('.basis-detail-subtitle')))
    const limit = norm(textFrom(document.querySelector('.basis-limit-block .basis-reference-copy')))
    const formulas = [...document.querySelectorAll('.basis-formula-text[data-basis-formula-id]')].map(node => {
      const style = getComputedStyle(node)
      const range = document.createRange()
      range.selectNodeContents(node)
      const rects = [...range.getClientRects()]
      const box = node.getBoundingClientRect()
      const scroller = node.closest('.basis-formula-scroll')
      const scrollRect = scroller?.getBoundingClientRect()
      const scrollStyle = scroller ? getComputedStyle(scroller) : null
      let lastCharRect = null
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let textNode
      while ((textNode = walker.nextNode())) {
        if (textNode.nodeValue.length) {
          const end = textNode.nodeValue.length
          const last = document.createRange()
          last.setStart(textNode, end - 1)
          last.setEnd(textNode, end)
          const rect = last.getBoundingClientRect()
          lastCharRect = { x: rect.x, right: rect.right, width: rect.width, height: rect.height }
        }
      }
      return {
        id: node.dataset.basisFormulaId,
        text: norm(textFrom(node)),
        whiteSpace: style.whiteSpace,
        lineRects: rects.length,
        rect: { x: box.x, right: box.right, width: box.width, height: box.height },
        scroller: scroller ? {
          clientWidth: scroller.clientWidth,
          scrollWidth: scroller.scrollWidth,
          scrollLeft: scroller.scrollLeft,
          clientHeight: scroller.clientHeight,
          scrollHeight: scroller.scrollHeight,
          overflowX: scrollStyle.overflowX,
          rect: { x: scrollRect.x, right: scrollRect.right, width: scrollRect.width, height: scrollRect.height },
        } : null,
        lastCharRect,
      }
    })
    const visible = node => Boolean(node && node.getClientRects().length)
    const titlePairs = [
      ['page-title', '.basis-detail-title', '.basis-detail-subtitle'],
      ['section-heading', '.home-section-title', '.basis-figure-caption'],
      ['full-field-label', '.basis-full-label', '.basis-full-copy'],
      ['reference-heading', '.basis-reference-title', '.basis-reference-copy'],
      ['parameter-label', '.basis-parameter-label', '.basis-parameter-value'],
    ].map(([name, headingSelector, bodySelector]) => {
      const heading = document.querySelector(headingSelector)
      const body = document.querySelector(bodySelector)
      const headingStyle = heading ? getComputedStyle(heading) : null
      const bodyStyle = body ? getComputedStyle(body) : null
      return {
        name,
        headingVisible: visible(heading),
        bodyVisible: visible(body),
        headingWeight: headingStyle ? Number.parseFloat(headingStyle.fontWeight) : null,
        bodyWeight: bodyStyle ? Number.parseFloat(bodyStyle.fontWeight) : null,
        headingColor: headingStyle?.color || null,
        bodyColor: bodyStyle?.color || null,
        headingSize: headingStyle?.fontSize || null,
        bodySize: bodyStyle?.fontSize || null,
      }
    })
    const semanticColors = {
      quickSource: getComputedStyle(document.querySelector('[data-basis-field="quickSource"]')).color,
      fullSource: getComputedStyle(document.querySelector('[data-basis-field="sourceSummary"]')).color,
      fullMethod: getComputedStyle(document.querySelector('[data-basis-field="method"]')).color,
      figureCaption: getComputedStyle(document.querySelector('.basis-figure-caption')).color,
      quickLimitHeading: getComputedStyle(document.querySelector('.basis-limit-block .basis-reference-title')).color,
      quickLimitCopy: getComputedStyle(document.querySelector('.basis-limit-block .basis-reference-copy')).color,
    }
    const wrapper = document.querySelector('#basis-full-content')
    const toggle = document.querySelector('.basis-full-toggle')
    const motion = wrapper ? getComputedStyle(wrapper) : null
    const page = document.querySelector('.basis-detail-page')
    const pageScroll = document.querySelector('.basis-detail-scroll')
    const pageRect = page?.getBoundingClientRect()
    const articleRight = page ? Math.max(pageRect.right, ...[...page.querySelectorAll('*')]
      .filter(node => !node.closest('.basis-formula-scroll')).map(node => node.getBoundingClientRect().right)) : 0
    const required = ${JSON.stringify(formulaCases.filter(item => item.tool === tool).map(item => ({ scope: item.scope, text: norm(item.text) })))}
    const missingFormulaChecks = required.filter(item => !formulas.some(formula => formula.id.startsWith(item.scope + '-') && formula.text.includes(item.text)))
    const image = document.querySelector('.basis-figure')
    const errors = window.__facts().errors
    const runtimeErrors = window.__facts().runtimeErrors
    const overflowNodes = [...document.querySelectorAll('.basis-detail-page *')].filter(node => {
      if (!node.getClientRects().length || node.closest('.basis-formula-scroll') || node.matches('.disclosure-motion,.disclosure-motion-inner,button')) return false
      return node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1
    }).map(node => ({ className: String(node.className || node.tagName), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }))
    const clippedNodes = [...document.querySelectorAll('.basis-detail-page *')].filter(node => {
      if (!node.getClientRects().length || node.closest('.basis-formula-scroll') || node.matches('.disclosure-motion,.disclosure-motion-inner,.basis-detail-scroll,button')) return false
      const style = getComputedStyle(node)
      return node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1 && ['hidden','clip'].includes(style.overflowY)
    }).map(node => ({ className: String(node.className || node.tagName), scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }))
    return {
      width: innerWidth,
      theme: getComputedStyle(document.querySelector('.basis-detail-page')).colorScheme || document.documentElement.dataset.theme || '',
      pageWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      articleWidth: page?.clientWidth || 0,
      articleScrollWidth: page?.scrollWidth || 0,
      articleRight,
      scrollWidth: pageScroll?.scrollWidth || 0,
      scrollClientWidth: pageScroll?.clientWidth || 0,
      fields,
      subtitle,
      limit,
      quickParameters,
      expected: {
        what: norm(expected.basis.what),
        method: norm(expected.basis.method),
        inputs: norm(expected.basis.inputs),
        sourceSummary: norm(expected.basis.sourceSummary),
        limits: norm(expected.basis.limits),
        quickMethod: norm(expected.presentation.quick.method),
        quickSource: norm(expected.presentation.quick.source),
        quickPurpose: norm(expected.presentation.quick.purpose),
        quickLimit: norm(expected.presentation.quick.limit),
        quickParameters: expected.presentation.quick.parameters.map(item => ({ label:norm(item.label), value:norm(item.value) })),
      },
      formulas,
      missingFormulaChecks,
      titlePairs,
      semanticColors,
      disclosure: {
        exists: Boolean(wrapper),
        expanded: toggle?.getAttribute('aria-expanded') || null,
        ariaHidden: wrapper?.getAttribute('aria-hidden') || null,
        openClass: wrapper?.classList.contains('disclosure-motion-open') || false,
        transitionDuration: motion?.transitionDuration || '',
        transitionProperty: motion?.transitionProperty || '',
        fullFields: [...document.querySelectorAll('[data-basis-field="what"],[data-basis-field="method"],[data-basis-field="inputs"],[data-basis-field="sourceSummary"],[data-basis-field="limits"]')].length,
      },
      image: image ? { complete:image.complete, naturalWidth:image.naturalWidth, naturalHeight:image.naturalHeight, alt:image.getAttribute('aria-label') } : null,
      overflowNodes,
      clippedNodes,
      errors,
      runtimeErrors,
    }
  })()`
}

function assertContent(facts, tool) {
  assert.deepEqual(facts.missingFormulaChecks, [], `${tool}: every required equation/constraint is in a formula element`)
  assert.equal(facts.subtitle, facts.expected.quickPurpose, `${tool}: quick purpose is unchanged in rendered DOM`)
  assert.equal(facts.fields.quickMethod, facts.expected.quickMethod, `${tool}: quick method is unchanged in rendered DOM`)
  assert.equal(facts.fields.quickSource, facts.expected.quickSource, `${tool}: quick source is unchanged in rendered DOM`)
  assert.equal(facts.limit, facts.expected.quickLimit, `${tool}: quick limit is unchanged in rendered DOM`)
  for (const field of ['what', 'method', 'inputs', 'sourceSummary', 'limits']) {
    assert.equal(facts.fields[field], facts.expected[field], `${tool}: full ${field} is unchanged in rendered DOM`)
  }
  assert.deepEqual(facts.quickParameters, facts.expected.quickParameters, `${tool}: labels, units, and parameter values are unchanged in rendered DOM`)
  assert.equal(facts.disclosure.fullFields, 5, `${tool}: all five full explanation fields remain mounted`)
}

function assertLayout(facts, tool, width, state) {
  assert.equal(facts.width, width, `${tool}/${width}: viewport width`)
  assert(facts.pageWidth <= width + 1, `${tool}/${width}/${state}: document horizontal overflow ${facts.pageWidth}`)
  assert(facts.bodyWidth <= width + 1, `${tool}/${width}/${state}: body horizontal overflow ${facts.bodyWidth}`)
  assert(facts.articleScrollWidth <= facts.articleWidth + 1, `${tool}/${width}/${state}: article content leaks horizontal overflow`)
  assert(facts.articleRight <= width + 1, `${tool}/${width}/${state}: article has content outside viewport (${facts.articleRight})`)
  assert(facts.scrollWidth <= facts.scrollClientWidth + 1, `${tool}/${width}/${state}: page scroll-view itself scrolls horizontally`)
  assert.deepEqual(facts.overflowNodes, [], `${tool}/${width}/${state}: non-formula content overflows its box`)
  assert.deepEqual(facts.clippedNodes, [], `${tool}/${width}/${state}: text is clipped vertically`)
  assert.deepEqual(facts.errors, [], `${tool}/${width}/${state}: template/browser adapter errors`)
  assert.deepEqual(facts.runtimeErrors, [], `${tool}/${width}/${state}: page runtime errors`)
  assert(facts.image?.complete && facts.image.naturalWidth > 0 && facts.image.naturalHeight > 0,
    `${tool}/${width}/${state}: figure image failed to load`)
  assert.equal(facts.disclosure.exists, true)
  assert.match(facts.disclosure.transitionDuration, /0\.21s/,
    `${tool}: existing 210ms disclosure transition remains available`)
}

function assertHeadingStyles(facts, tool, width, theme) {
  const visiblePairs = facts.titlePairs.filter((pair) => pair.headingVisible && pair.bodyVisible)
  assert(visiblePairs.length >= 4, `${tool}/${width}/${theme}: title/body computed style samples are present`)
  for (const pair of visiblePairs) {
    assert(pair.headingWeight !== pair.bodyWeight || pair.headingSize !== pair.bodySize || pair.headingColor !== pair.bodyColor,
      `${tool}/${width}/${theme}: ${pair.name} heading has no computed distinction from body text`)
  }
  for (const name of ['page-title', 'full-field-label', 'reference-heading', 'parameter-label']) {
    const pair = visiblePairs.find((item) => item.name === name)
    assert(pair, `${tool}/${width}/${theme}: missing semantic style pair ${name}`)
    assert.notEqual(pair.headingColor, pair.bodyColor,
      `${tool}/${width}/${theme}: ${name} title color equals body color (${pair.headingColor})`)
  }
  assert.equal(facts.semanticColors.quickSource, facts.semanticColors.figureCaption,
    `${tool}/${width}/${theme}: source text and figure caption use the same secondary color`)
  assert.equal(facts.semanticColors.fullSource, facts.semanticColors.figureCaption,
    `${tool}/${width}/${theme}: full source summary uses the secondary color`)
  assert.notEqual(facts.semanticColors.fullSource, facts.semanticColors.fullMethod,
    `${tool}/${width}/${theme}: source summary is visually distinct from primary method text`)
  assert.notEqual(facts.semanticColors.quickLimitHeading, facts.semanticColors.quickLimitCopy,
    `${tool}/${width}/${theme}: warning boundary heading is distinct from explanatory body`)
}

function assertFormulaLayout(facts, tool, width) {
  assert(facts.formulas.length > 0, `${tool}/${width}: formula elements are present`)
  for (const formula of facts.formulas) {
    assert.equal(formula.whiteSpace, 'nowrap', `${tool}/${width}: ${formula.id} must stay on one line`)
    assert.equal(formula.lineRects, 1, `${tool}/${width}: ${formula.id} rendered across multiple lines`)
    assert(formula.scroller, `${tool}/${width}: ${formula.id} must be inside its own horizontal scroll-view`)
    assert(['auto', 'scroll'].includes(formula.scroller.overflowX),
      `${tool}/${width}: ${formula.id} scroll-view is not horizontally scrollable (${formula.scroller.overflowX})`)
    if (formula.scroller.scrollWidth <= formula.scroller.clientWidth + 1) {
      assert(formula.lastCharRect && formula.lastCharRect.width > 0
        && formula.lastCharRect.right <= formula.scroller.rect.right + 1,
      `${tool}/${width}: fitting formula end is not visible: ${formula.id}`)
    }
  }
}

async function collect(browser, tool, width, theme, expanded, zoom = false) {
  const frozen = baseline.tools.find((item) => item.id === tool)
  await browser.viewport(width, 844, theme)
  await browser.navigate({ theme, entry: 'pages/basis/detail.js', tool })
  await delay(80)
  if (expanded) {
    await browser.evaluate(`window.__dispatch('toggleFullExplanation')`)
    await delay(260)
  }
  let zoomedTextNodes = 0
  if (zoom) {
    zoomedTextNodes = await browser.evaluate(`(() => {
      const page = document.querySelector('.basis-detail-page')
      const leaves = [...page.querySelectorAll('*')].filter(node => node.children.length === 0 && node.textContent.trim())
      for (const node of leaves) {
        const size = Number.parseFloat(getComputedStyle(node).fontSize)
        if (Number.isFinite(size)) node.style.fontSize = (size * ${zoomFactor}) + 'px'
      }
      return leaves.length
    })()`)
    await delay(50)
  }
  const facts = await browser.evaluate(browserExpression(tool, frozen))
  facts.expanded = expanded
  facts.fontScale = zoom ? zoomFactor : 1
  facts.zoomedTextNodes = zoomedTextNodes
  facts.viewportTheme = theme
  return facts
}

async function checkFormulaEndReachability(browser) {
  return browser.evaluate(`(() => {
    const norm = value => String(value ?? '').replace(/\\s+/g, ' ').trim()
    const results = []
    for (const formula of document.querySelectorAll('.basis-formula-text[data-basis-formula-id]')) {
      const scroller = formula.closest('.basis-formula-scroll')
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
      scroller.scrollLeft = maxScroll
      const walker = document.createTreeWalker(formula, NodeFilter.SHOW_TEXT)
      let lastText = null, next
      while ((next = walker.nextNode())) if (next.nodeValue.length) lastText = next
      let rect = null
      if (lastText) {
        const range = document.createRange()
        const end = lastText.nodeValue.length
        range.setStart(lastText, end - 1)
        range.setEnd(lastText, end)
        const box = range.getBoundingClientRect()
        rect = { x:box.x, right:box.right, width:box.width, height:box.height }
      }
      const clip = scroller.getBoundingClientRect()
      results.push({
        id:formula.dataset.basisFormulaId, text:norm(formula.textContent),
        found:true, scrollWidth:scroller.scrollWidth, clientWidth:scroller.clientWidth,
        maxScroll, scrollLeft:scroller.scrollLeft, scrollerRight:clip.right, lastCharRect:rect,
        lastCharVisible:Boolean(rect && rect.width > 0 && rect.right <= clip.right + 1 && rect.x >= clip.left - 1),
      })
      scroller.scrollLeft = 0
    }
    return results
  })()`)
}

async function checkVerticalReachability(browser) {
  return browser.evaluate(`(() => {
    const scroll = document.querySelector('.basis-detail-scroll')
    const finalField = document.querySelector('.basis-full-field-last')
    const openButton = document.querySelector('.basis-open-button')
    if (!scroll || !finalField || !openButton) return { found:false }
    scroll.scrollTop = scroll.scrollHeight
    const scrollRect = scroll.getBoundingClientRect()
    const fieldRect = finalField.getBoundingClientRect()
    const buttonRect = openButton.getBoundingClientRect()
    const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    const result = {
      found:true,
      maxScroll,
      scrollTop:scroll.scrollTop,
      clientHeight:scroll.clientHeight,
      scrollHeight:scroll.scrollHeight,
      finalField:{ top:fieldRect.top, bottom:fieldRect.bottom },
      openButton:{ top:buttonRect.top, bottom:buttonRect.bottom },
      viewport:{ top:scrollRect.top, bottom:scrollRect.bottom },
      finalFieldReachable:fieldRect.top >= scrollRect.top - 1 && fieldRect.bottom <= scrollRect.bottom + 1,
      openButtonReachable:buttonRect.top >= scrollRect.top - 1 && buttonRect.bottom <= scrollRect.bottom + 1,
    }
    scroll.scrollTop = 0
    return result
  })()`)
}

async function main() {
  assert(!fs.existsSync(output), `Evidence output already exists; refusing to overwrite ${output}`)
  fs.mkdirSync(output, { recursive: true })
  const browser = await launch()
  const cases = []
  const openToolChecks = []
  const zoomChecks = []
  try {
    for (const theme of themes) {
      for (const width of widths) {
        for (const tool of tools) {
          const stem = `${tool}-${width}-${theme}`
          const collapsed = await collect(browser, tool, width, theme, false)
          assertContent(collapsed, tool)
          assertLayout(collapsed, tool, width, 'collapsed')
          assert.equal(collapsed.disclosure.expanded, 'false', `${stem}: collapsed control state`)
          assert.equal(collapsed.disclosure.ariaHidden, 'true', `${stem}: collapsed aria state`)
          assert.equal(collapsed.disclosure.openClass, false, `${stem}: collapsed wrapper class`)
          await browser.screenshot(path.join(output, `${stem}-collapsed.png`))

          const expanded = await collect(browser, tool, width, theme, true)
          assertContent(expanded, tool)
          assertLayout(expanded, tool, width, 'expanded')
          assertHeadingStyles(expanded, tool, width, theme)
          assertFormulaLayout(expanded, tool, width)
          assert.equal(expanded.disclosure.expanded, 'true', `${stem}: expanded control state`)
          assert.equal(expanded.disclosure.ariaHidden, 'false', `${stem}: expanded aria state`)
          assert.equal(expanded.disclosure.openClass, true, `${stem}: expanded wrapper class`)
          const verticalReachability = await checkVerticalReachability(browser)
          assert(verticalReachability.found, `${stem}: final field and open-tool button remain mounted`)
          assert(verticalReachability.scrollTop >= verticalReachability.maxScroll - 1,
            `${stem}: page cannot scroll to its end: ${JSON.stringify(verticalReachability)}`)
          assert(verticalReachability.finalFieldReachable,
            `${stem}: last explanation field is clipped at the end: ${JSON.stringify(verticalReachability)}`)
          assert(verticalReachability.openButtonReachable,
            `${stem}: open-tool button is clipped at the end: ${JSON.stringify(verticalReachability)}`)

          const formulaEnds = await checkFormulaEndReachability(browser)
          for (const result of formulaEnds) {
            assert(result.found && result.scrollLeft === result.maxScroll && result.lastCharVisible,
              `${stem}: formula end is not horizontally reachable: ${JSON.stringify(result)}`)
          }
          if (width === 320) {
            for (const required of formulaCases.filter((item) => item.tool === tool && item.mustOverflowAt320)) {
              const result = formulaEnds.find((item) => item.id.startsWith(required.scope + '-') && item.text.includes(norm(required.text)))
              assert(result, `${stem}: required long formula missing from its own scroll-view: ${required.text}`)
              assert(result.scrollWidth > result.clientWidth,
                `${stem}: required long formula does not need its own horizontal scroll: ${JSON.stringify(result)}`)
            }
          }

          await browser.screenshot(path.join(output, `${stem}-expanded.png`))
          if (width === 320) {
            await browser.evaluate(`(() => { const node=document.querySelector('.basis-detail-scroll'); node.scrollTop=node.scrollHeight })()`)
            await delay(40)
            await browser.screenshot(path.join(output, `${stem}-expanded-bottom.png`))
            await browser.evaluate(`(() => { document.querySelector('.basis-detail-scroll').scrollTop=0 })()`)
          }
          cases.push({
            tool, width, theme,
            collapsed: {
              pageWidth:collapsed.pageWidth, bodyWidth:collapsed.bodyWidth,
              articleWidth:collapsed.articleWidth, articleScrollWidth:collapsed.articleScrollWidth,
              formulas:collapsed.formulas.length, disclosure:collapsed.disclosure,
            },
            expanded: {
              pageWidth:expanded.pageWidth, bodyWidth:expanded.bodyWidth,
              articleWidth:expanded.articleWidth, articleScrollWidth:expanded.articleScrollWidth,
              formulas:expanded.formulas.length, disclosure:expanded.disclosure,
              titlePairs:expanded.titlePairs,
              semanticColors:expanded.semanticColors,
            },
            formulaEndReachability: formulaEnds,
            verticalReachability,
          })

          if (width === 320 && zoomTools.includes(tool)) {
            const zoomed = await collect(browser, tool, width, theme, true, true)
            assertContent(zoomed, tool)
            assertLayout(zoomed, tool, width, 'expanded-font-zoom')
            assertHeadingStyles(zoomed, tool, width, theme)
            assertFormulaLayout(zoomed, tool, width)
            const zoomReachability = await checkFormulaEndReachability(browser)
            for (const result of zoomReachability) {
              assert(result.found && result.scrollLeft === result.maxScroll && result.lastCharVisible,
                `${tool}/320/font-zoom: formula end is not reachable: ${JSON.stringify(result)}`)
            }
            const zoomVerticalReachability = await checkVerticalReachability(browser)
            assert(zoomVerticalReachability.finalFieldReachable && zoomVerticalReachability.openButtonReachable,
              `${tool}/320/font-zoom: final content/action is clipped: ${JSON.stringify(zoomVerticalReachability)}`)
            await browser.screenshot(path.join(output, `${tool}-${width}-${theme}-expanded-font-${zoomFactor}x.png`))
            await browser.evaluate(`(() => { const node=document.querySelector('.basis-detail-scroll'); node.scrollTop=node.scrollHeight })()`)
            await delay(40)
            await browser.screenshot(path.join(output, `${tool}-${width}-${theme}-expanded-font-${zoomFactor}x-bottom.png`))
            zoomChecks.push({ tool, width, theme, factor:zoomFactor, textNodes:zoomed.zoomedTextNodes, formulas:zoomed.formulas.length, pageWidth:zoomed.pageWidth, articleRight:zoomed.articleRight, formulaEndReachability:zoomReachability, verticalReachability:zoomVerticalReachability })
          }

          if (width === 390 && theme === 'light') {
            const eventsBefore = await browser.evaluate('window.__homepageQa.events.navigations.length')
            await browser.evaluate(`window.__dispatch('openTool')`)
            const nav = await browser.evaluate('window.__homepageQa.events.navigations.slice()')
            const expectedPath = baseline.tools.find((item) => item.id === tool).route
            assert.deepEqual(nav.slice(eventsBefore), [expectedPath], `${tool}: open tool keeps the existing route`)
            openToolChecks.push({ tool, route:expectedPath, navigation:nav.slice(eventsBefore) })
          }
        }
      }
    }
  } finally {
    await browser.close()
  }

  const summary = {
    evidenceDirectory: output,
    browser: 'headless Chrome through existing source-backed WXML/WXSS adapter',
    nativeDevice: false,
    viewportWidths: widths,
    themes,
    tools,
    statePairs: cases.length,
    screenshotCount: fs.readdirSync(output).filter((name) => name.endsWith('.png')).length,
    formulaCaseCount: formulaCases.length,
    zoomFactor,
    cases,
    openToolChecks,
    zoomChecks,
  }
  fs.writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag:'wx' })
  fs.writeFileSync(path.join(output, 'formula-cases.json'), `${JSON.stringify(formulaCases, null, 2)}\n`, { flag:'wx' })
  console.log(JSON.stringify({
    evidenceDirectory: output,
    statePairs: cases.length,
    screenshots: summary.screenshotCount,
    formulaCases: formulaCases.length,
    zoomCases: zoomChecks.length,
    openToolChecks: openToolChecks.length,
    result: 'passed',
  }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})

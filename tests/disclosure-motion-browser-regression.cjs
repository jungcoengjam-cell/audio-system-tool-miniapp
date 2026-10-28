'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, delay } = require('./dmx-ui-refinements-2026-10-18/browser-driver.cjs')

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8')
const sharedCss = read('../styles/disclosure-motion.wxss')

function findClosingBrace(source, openIndex) {
  let depth = 1
  for (let index = openIndex + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return index
  }
  throw new Error('Unbalanced WXSS braces')
}

// Pull only the original page-class rules needed by these samples. Convert rpx
// at the fixed 320 CSS-pixel viewport used by this regression fixture.
function selectedWxss(filesAndSelectors) {
  const grouped = new Map()
  function addRules(source, wanted, aliases = {}) {
    function visit(chunk, media = []) {
      let cursor = 0
      while (cursor < chunk.length) {
        const open = chunk.indexOf('{', cursor)
        if (open < 0) break
        const prefix = chunk.slice(cursor, open)
        const lastBoundary = Math.max(prefix.lastIndexOf(';'), prefix.lastIndexOf('}'))
        const header = prefix.slice(lastBoundary + 1).trim()
        const close = findClosingBrace(chunk, open)
        const body = chunk.slice(open + 1, close)
        if (header.startsWith('@media')) {
          visit(body, [...media, header])
        } else if (wanted.has(header)) {
          const rewritten = aliases[header] || header
          const pxBody = body.replace(/(-?\d+(?:\.\d+)?)rpx\b/g, (_match, value) => `${Number(value) * 320 / 750}px`)
          const key = JSON.stringify(media)
          if (!grouped.has(key)) grouped.set(key, { media, rules: [] })
          grouped.get(key).rules.push(`${rewritten}{${pxBody}}`)
        }
        cursor = close + 1
      }
    }
    visit(source)
  }

  for (const { file, selectors, aliases } of filesAndSelectors) {
    addRules(read(file), new Set(selectors), aliases)
  }

  return [...grouped.values()].map(({ media, rules }) => {
    let css = rules.join('\n')
    for (let index = media.length - 1; index >= 0; index -= 1) css = `${media[index]}{${css}}`
    return css
  }).join('\n')
}

const originalPageCss = selectedWxss([
  { file: '../app.wxss', selectors: ['page'], aliases: { page: '.fixture-theme-root' } },
  { file: '../styles/homepage.wxss', selectors: ['.home-page', '.home-panel', '.home-primary-button,.home-secondary-button'] },
  {
    file: '../pages/basis/detail.wxss',
    selectors: [
      '.basis-full-toggle', '.home-section-title', '.basis-section', '.basis-section-index',
      '.basis-full-panel', '.basis-full-field', '.basis-full-field-last', '.basis-full-label',
      '.basis-full-copy', '.basis-detail-page .home-secondary-button.basis-full-toggle',
      '.home-primary-button,.home-secondary-button',
    ],
  },
  {
    file: '../pages/projects/favorite-detail.wxss',
    selectors: ['.favorite-detail-page', '.favorite-data-panel', '.favorite-section-title', '.favorite-data-actions', '.favorite-raw-toggle', '.favorite-raw-value'],
  },
  {
    file: '../pages/control-protocol/detail.wxss',
    selectors: [
      'button', '.protocol-page', '.protocol-content', '.commands-section', '.section-heading,.loop-heading',
      '.section-title', '.section-count', '.command-list', '.command-row', '.command-row+.command-row',
      '.command-copy', '.command-label', '.command-frame', '.protocol-page button.copy-glyph',
      '.copy-glyph[disabled]', '.copy-icon', '.copy-icon::before,.copy-icon::after', '.copy-icon::before',
      '.copy-icon::after', '.expanded-command-list',
    ],
  },
])

const fixtureCases = [
  ['basis-full-content', '用途、公式、参数与单位、来源、适用边界。包含完整解释文本与多段示例。'],
  ['knowledge-formula-content', '距离估算公式与说明文本。先根据测量条件判断变量，再按公式逐项代入。'],
  ['favorite-raw-content', '保存时的完整原始字段，逐行呈现，不省略较长参数值。'],
  ['troubleshoot-path-content', '第一步排查路径与答案。确认输入信号，再逐级核查路由和设备状态。'],
  ['led-viewing-details-content', '观看距离校核的完整说明，包含范围、单位和适用条件。'],
  ['control-protocol-manual-write-content', '其余控制指令及复制操作。指令帧较长时仍应自动换行。'],
]

const fixtureMarkup = fixtureCases.map(([id, content], index) => `
  <section class="motion-fixture">
    <strong>${id}</strong>
    <div id="fixture-${index}" class="fixture-disclosure disclosure-motion" aria-hidden="true">
      <div class="disclosure-motion-inner"><div class="fixture-copy">${content}<br>${content}<br>${content}<br>${content}</div></div>
    </div>
  </section>`).join('')

const basisFields = [
  ['计算用途', '用于说明计算结果所回答的问题，并列出适用的测量条件。'],
  ['方法与公式', '先确认输入量和单位，再依照对应关系逐项代入并保留中间结果。'],
  ['参数与单位', '输入参数包括工作距离、目标尺寸、传感器尺寸以及各自的单位。'],
  ['来源', '该方法基于公开的工程关系式；使用时应核对设备规格和现场条件。'],
  ['适用边界', '结果用于估算。超出标注范围时应重新选择方法并复核现场数据。'],
]
const basisMarkup = basisFields.map(([label, copy], index) => `<div class="basis-full-field ${index === basisFields.length - 1 ? 'basis-full-field-last' : ''}"><div class="basis-full-label">${label}</div><div class="basis-full-copy">${copy} ${'在不同条件下请逐项核实输入与单位。'.repeat(index === 1 ? 3 : 1)}</div></div>`).join('')

const longRawText = Array.from({ length: 18 }, (_unused, index) => `  "parameter_${String(index + 1).padStart(2, '0')}": "较长原始字段值 ${'A7B9-'.repeat(9)} ${index + 1}",`).join('\n')
const commandMarkup = Array.from({ length: 9 }, (_unused, index) => `
  <div class="command-row">
    <div class="command-copy"><div class="command-label">查询设备状态与第 ${index + 1} 组参数</div><div class="command-frame">${`AA 55 01 ${String(index + 1).padStart(2, '0')} 7E `.repeat(12)}55 AA</div></div>
    <button class="copy-glyph" aria-label="复制"><span class="copy-icon"></span></button>
  </div>`).join('')

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font:14px/1.5 Arial,sans-serif}
.fixture-theme-root{width:100%;min-height:100vh}
.motion-fixture{margin:0 8px 8px;padding:8px;border:1px solid var(--theme-divider);border-radius:12px;background:var(--theme-surface);color:var(--theme-text)}
.fixture-disclosure{margin-top:6px}.fixture-copy{padding:10px;background:var(--theme-control);color:var(--theme-text-secondary);border-radius:8px;overflow-wrap:anywhere}
.real-sample-heading{margin:6px 0;font-weight:700}
${originalPageCss}
${sharedCss}
</style></head><body>
<main class="fixture-theme-root">
  <div id="shared-css-fixtures">${fixtureMarkup}</div>
  <div id="real-page-samples">
    <section class="fixture-theme-root home-page basis-detail-page">
      <div class="real-sample-heading">Basis: five complete explanation fields</div>
      <button class="home-secondary-button basis-full-toggle">展开完整计算说明</button>
      <div id="real-basis" class="disclosure-motion disclosure-motion-open" aria-hidden="false"><div class="disclosure-motion-inner"><div class="home-panel basis-section basis-full-panel"><div class="home-section-title"><span class="basis-section-index">03</span>完整计算说明</div>${basisMarkup}</div></div></div>
    </section>
    <section class="fixture-theme-root home-page favorite-detail-page">
      <div class="real-sample-heading">Favorite: raw parameters</div>
      <div class="home-panel favorite-data-panel">
        <div class="favorite-section-title">保存时的完整参数</div>
        <div class="favorite-data-actions"><button class="favorite-raw-toggle">收起原始字段</button></div>
        <div id="real-favorite" class="disclosure-motion disclosure-motion-open" aria-hidden="false"><div class="disclosure-motion-inner"><div class="favorite-raw-value">{\n${longRawText}\n}</div></div></div>
      </div>
    </section>
    <section class="fixture-theme-root protocol-page">
      <div class="protocol-content">
        <div class="real-sample-heading">Control protocol: long manual command list</div>
        <div class="commands-section"><div class="section-heading"><div class="section-title">其他控制指令</div><div class="section-count">9 条</div></div>
          <div id="real-control" class="disclosure-motion disclosure-motion-open" aria-hidden="false"><div class="disclosure-motion-inner"><div class="command-list expanded-command-list">${commandMarkup}</div></div></div>
        </div>
      </div>
    </section>
  </div>
</main>
<script>
window.openAll = () => document.querySelectorAll('.fixture-disclosure').forEach(node => { node.classList.add('disclosure-motion-open'); node.setAttribute('aria-hidden','false') })
window.closeAll = () => document.querySelectorAll('.fixture-disclosure').forEach(node => { node.classList.remove('disclosure-motion-open'); node.setAttribute('aria-hidden','true') })
</script></body></html>`

async function run() {
  const browser = await launch()
  try {
    await browser.viewport(320, 780, 'dark', 'no-preference')
    await browser.send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` })
    await delay(100)

    const initial = await browser.evaluate(`(()=>[...document.querySelectorAll('.fixture-disclosure')].map(node=>({height:node.getBoundingClientRect().height,opacity:getComputedStyle(node).opacity,pointerEvents:getComputedStyle(node).pointerEvents,hidden:node.getAttribute('aria-hidden')})))()`)
    assert.equal(initial.length, 6)
    assert(initial.every(item => item.height === 0 && item.opacity === '0' && item.pointerEvents === 'none' && item.hidden === 'true'),
      `all six shared-CSS fixtures should begin collapsed: ${JSON.stringify(initial)}`)

    await browser.evaluate('window.openAll()')
    await delay(90)
    const opening = await browser.evaluate(`(()=>[...document.querySelectorAll('.fixture-disclosure')].map(node=>({height:node.getBoundingClientRect().height,opacity:Number(getComputedStyle(node).opacity)})))()`)
    assert(opening.every(item => item.height > 0 && item.opacity > 0 && item.opacity < 1),
      `all six shared-CSS fixtures should be partway through opening: ${JSON.stringify(opening)}`)

    await delay(170)
    const expanded = await browser.evaluate(`(()=>[...document.querySelectorAll('.fixture-disclosure')].map(node=>({height:node.getBoundingClientRect().height,naturalHeight:node.querySelector('.disclosure-motion-inner').getBoundingClientRect().height,opacity:getComputedStyle(node).opacity,hidden:node.getAttribute('aria-hidden')})))()`)
    assert(expanded.every(item => item.height > 0 && item.opacity === '1' && item.hidden === 'false' && Math.abs(item.height - item.naturalHeight) < 1),
      `all six shared-CSS fixtures should settle at natural content height: ${JSON.stringify(expanded)}`)
    assert(opening.every((item, index) => item.height > 0 && item.height < expanded[index].height - 1),
      `opening intermediate height should be between the collapsed and settled endpoints: ${JSON.stringify({ opening, expanded })}`)

    await browser.evaluate('window.closeAll()')
    await delay(90)
    const closing = await browser.evaluate(`(()=>[...document.querySelectorAll('.fixture-disclosure')].map(node=>({height:node.getBoundingClientRect().height,opacity:Number(getComputedStyle(node).opacity),hidden:node.getAttribute('aria-hidden')})))()`)
    assert(closing.every((item, index) => item.height > 0 && item.height < expanded[index].height - 1 && item.opacity > 0 && item.opacity < 1 && item.hidden === 'true'),
      `all six fixtures should have a visible closing intermediate frame: ${JSON.stringify(closing)}`)

    await delay(170)
    const collapsed = await browser.evaluate(`(()=>[...document.querySelectorAll('.fixture-disclosure')].map(node=>({height:node.getBoundingClientRect().height,opacity:getComputedStyle(node).opacity,pointerEvents:getComputedStyle(node).pointerEvents,hidden:node.getAttribute('aria-hidden')})))()`)
    assert(collapsed.every(item => item.height <= 1 && item.opacity === '0' && item.pointerEvents === 'none' && item.hidden === 'true'),
      `all six fixtures should return to zero height after closing: ${JSON.stringify(collapsed)}`)

    // Reverse while both transitions are in flight to catch stale endpoints.
    await browser.evaluate('window.openAll()')
    await delay(55)
    const beforeReverse = await browser.evaluate(`(()=>document.querySelector('.fixture-disclosure').getBoundingClientRect().height)()`)
    assert(beforeReverse > 0, 'quick-reverse opening must have started')
    await browser.evaluate('window.closeAll()')
    await delay(30)
    await browser.evaluate('window.openAll()')
    await delay(85)
    const quickReverse = await browser.evaluate(`(()=>[...document.querySelectorAll('.fixture-disclosure')].map(node=>({height:node.getBoundingClientRect().height,naturalHeight:node.querySelector('.disclosure-motion-inner').getBoundingClientRect().height,opacity:Number(getComputedStyle(node).opacity),hidden:node.getAttribute('aria-hidden')})))()`)
    assert(quickReverse.every(item => item.height > 0 && item.opacity > 0 && item.opacity < 1 && item.hidden === 'false'),
      `rapid close-open reversal should continue toward the current open state: ${JSON.stringify(quickReverse)}`)
    await delay(160)
    const quickReverseSettled = await browser.evaluate(`(()=>[...document.querySelectorAll('.fixture-disclosure')].map(node=>({height:node.getBoundingClientRect().height,opacity:getComputedStyle(node).opacity,hidden:node.getAttribute('aria-hidden')})))()`)
    assert(quickReverseSettled.every((item, index) => item.opacity === '1' && item.hidden === 'false' && quickReverse[index].height < item.height - 1),
      `rapid reversal should settle at the open endpoint after the intermediate frame: ${JSON.stringify({ quickReverse, quickReverseSettled })}`)

    const actualClassSamples = await browser.evaluate(`(()=>{
      const measure = id => { const wrapper=document.getElementById(id), inner=wrapper.querySelector('.disclosure-motion-inner'), rect=wrapper.getBoundingClientRect(), innerRect=inner.getBoundingClientRect(); const descendants=[...inner.querySelectorAll('*')].map(node=>node.getBoundingClientRect()); return {height:rect.height,naturalHeight:innerRect.height,scrollHeight:inner.scrollHeight,clientHeight:inner.clientHeight,scrollWidth:inner.scrollWidth,clientWidth:inner.clientWidth,firstChildTop:descendants[0]?.top,lastChildBottom:Math.max(...descendants.map(item=>item.bottom)),innerBottom:innerRect.bottom} }
      return {viewportWidth:document.documentElement.clientWidth,dark:matchMedia('(prefers-color-scheme: dark)').matches,themeSurface:getComputedStyle(document.querySelector('.favorite-data-panel')).backgroundColor,basis:measure('real-basis'),favorite:measure('real-favorite'),control:measure('real-control'),basisFields:document.querySelectorAll('#real-basis .basis-full-field').length,favoriteLines:document.querySelector('#real-favorite .favorite-raw-value').textContent.trim().split('\\n').length,commandRows:document.querySelectorAll('#real-control .command-row').length}
    })()`)
    assert.equal(actualClassSamples.viewportWidth, 320)
    assert.equal(actualClassSamples.dark, true)
    assert.equal(actualClassSamples.themeSurface, 'rgb(28, 28, 30)')
    assert.equal(actualClassSamples.basisFields, 5)
    assert(actualClassSamples.favoriteLines >= 18)
    assert.equal(actualClassSamples.commandRows, 9)
    for (const [name, sample] of Object.entries({ basis: actualClassSamples.basis, favorite: actualClassSamples.favorite, control: actualClassSamples.control })) {
      assert(sample.height > 0 && Math.abs(sample.height - sample.naturalHeight) < 1, `${name} original-class wrapper should fit its natural expanded content: ${JSON.stringify(sample)}`)
      assert(sample.scrollHeight <= sample.clientHeight + 1, `${name} inner should not clip vertically: ${JSON.stringify(sample)}`)
      assert(sample.scrollWidth <= sample.clientWidth + 1, `${name} inner should not clip horizontally at 320px: ${JSON.stringify(sample)}`)
      assert(sample.lastChildBottom <= sample.innerBottom + 1, `${name} final child should remain inside the disclosure: ${JSON.stringify(sample)}`)
    }

    const screenshots = {}
    for (const [name, selector] of [['basis', '.basis-detail-page'], ['favorite', '.favorite-detail-page'], ['control', '.protocol-page']]) {
      await browser.evaluate(`window.scrollTo(0,document.querySelector('${selector}').getBoundingClientRect().top+window.scrollY)`)
      screenshots[name] = path.join(os.tmpdir(), `audio-miniapp-disclosure-motion-320-dark-${name}.png`)
      await browser.screenshot(screenshots[name])
    }

    await browser.viewport(320, 780, 'dark', 'reduce')
    const reduced = await browser.evaluate(`(()=>({enabled:matchMedia('(prefers-reduced-motion: reduce)').matches,durations:[...document.querySelectorAll('.fixture-disclosure')].map(node=>getComputedStyle(node).transitionDuration)}))()`)
    assert.equal(reduced.enabled, true)
    assert(reduced.durations.every(value => value.split(',').every(part => Number.parseFloat(part) === 0)),
      `reduced motion should disable disclosure transitions: ${JSON.stringify(reduced)}`)

    console.log(JSON.stringify({
      scope: 'shared CSS fixture checks for all six disclosure IDs; original-class CSS geometry samples for three selected page excerpts only',
      environment: 'headless Chromium, not WeChat DevTools or a physical device',
      viewport: '320 CSS px, dark theme for content geometry samples',
      initial,
      opening,
      expanded,
      closing,
      collapsed,
      quickReverse,
      quickReverseSettled,
      actualClassSamples,
      reduced,
      screenshots,
    }))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('../browser-driver.cjs')

const output = path.join(__dirname, 'evidence', 'projects-tools')
const widths = [320, 360, 390]
const themes = ['light', 'dark']
const longProjectName = '多功能会议厅扩声与灯光系统改造调试项目名称验证'
const scenes = []
const mainHeaderFacts = []

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

async function readFacts(browser, expression) {
  return browser.evaluate(expression)
}

async function assertMainHeader(browser, pageName, width, theme) {
  const facts = await readFacts(browser, `(() => {
    const header = document.querySelector('.home-main-header')
    const title = header?.querySelector('.home-main-title')
    const range = document.createRange()
    if (title) range.selectNodeContents(title)
    const text = title ? range.getBoundingClientRect() : null
    const rect = node => { const box = node?.getBoundingClientRect(); return box ? { x:box.x,y:box.y,width:box.width,height:box.height,right:box.right,bottom:box.bottom } : null }
    const style = title ? getComputedStyle(title) : null
    return { ...__facts(), header:rect(header),title:rect(title),titleText:title?.innerText.trim()||'',
      textBounds:text?{x:text.x,y:text.y,width:text.width,height:text.height,bottom:text.bottom}:null,
      titleStyle:style?{fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight}:null,
      hasSubtitle:Boolean(header?.querySelector('.home-subtitle')) }
  })()`)
  assert.equal(facts.errors.length, 0, `${pageName} ${theme}/${width} WXML errors`)
  assert.equal(facts.runtimeErrors.length, 0, `${pageName} ${theme}/${width} runtime errors`)
  assert.equal(facts.pageWidth, width, `${pageName} ${theme}/${width} page width`)
  assert.equal(facts.header.height, 52, `${pageName} ${theme}/${width} header height`)
  assert.equal(facts.titleStyle.fontSize, '30px', `${pageName} ${theme}/${width} title size`)
  assert.equal(facts.titleStyle.fontWeight, '720', `${pageName} ${theme}/${width} title weight`)
  assert.equal(facts.titleStyle.lineHeight, '36px', `${pageName} ${theme}/${width} title line-height`)
  assert.equal(facts.title.height, 36, `${pageName} ${theme}/${width} title line box`)
  assert(Math.abs(facts.title.y - facts.header.y - 8) < 1,
    `${pageName} ${theme}/${width} title baseline box is not aligned: ${JSON.stringify(facts)}`)
  assert.equal(facts.hasSubtitle, false, `${pageName} ${theme}/${width} has a subtitle below the main title`)
  mainHeaderFacts.push({ pageName, width, theme, titleY:facts.title.y, textY:facts.textBounds.y })
  return facts
}

async function capture(browser, name, facts) {
  const screenshot = `${safeName(name)}.png`
  await browser.screenshot(path.join(output, screenshot))
  scenes.push({ name, ...facts, screenshot })
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const browser = await launch()
  try {
    for (const theme of themes) {
      for (const width of widths) {
        await browser.viewport(width, 844, theme)
        await browser.navigate({ theme, entry: 'pages/tools/tools.js' })
        const toolsHeader = await assertMainHeader(browser, 'tools', width, theme)
        const tools = await readFacts(browser, `(() => {
          const grid = document.querySelector('.home-tool-grid')
          const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom } }
          const cards = [...document.querySelectorAll('.home-tool-card')].map(card => {
            const title = card.querySelector('.home-tool-title')
            const box = rect(card), textBox = rect(title)
            return { title: title.innerText.trim(), ...box, titleWidth: textBox.width, titleHeight: textBox.height,
              titleClientWidth: title.clientWidth, titleClientHeight: title.clientHeight,
              titleScrollWidth: title.scrollWidth, titleScrollHeight: title.scrollHeight }
          })
          const gridBox = rect(grid)
          const rowYs = [...new Set(cards.map(card => Math.round(card.y)))]
          const rowCounts = rowYs.map(y => cards.filter(card => Math.round(card.y) === y).length)
          const rows = rowYs.map(y => cards.filter(card => Math.round(card.y) === y).sort((a, b) => a.x - b.x))
          const columnGaps = rows.flatMap(row => row.slice(1).map((card, index) => card.x - (row[index].x + row[index].width)))
          const rowGaps = rows.slice(1).map((row, index) => row[0].y - (rows[index][0].y + rows[index][0].height))
          const style = getComputedStyle(grid)
          return { ...__facts(), grid: gridBox, display: style.display, computedColumnGap: parseFloat(style.columnGap),
            computedRowGap: parseFloat(style.rowGap), cardCount: cards.length, cards, rowCounts, columnGaps, rowGaps,
            lastRowFirstColumnAligned: Math.abs(rows.at(-1)[0].x - rows[0][0].x) < 1,
            gridOverflow: grid.scrollWidth - grid.clientWidth }
        })()`)
        assert.equal(tools.errors.length, 0, `tools ${theme}/${width} WXML errors`)
        assert.equal(tools.runtimeErrors.length, 0, `tools ${theme}/${width} runtime errors`)
        assert.equal(tools.pageWidth, width, `tools ${theme}/${width} page width`)
        assert.equal(tools.cardCount, 10, `tools ${theme}/${width} shows the full tool registry`)
        assert.equal(tools.display, 'grid', `tools ${theme}/${width} uses a compact grid`)
        assert.deepEqual(tools.rowCounts, [3, 3, 3, 1], `tools ${theme}/${width} retains three columns`)
        const expectedGap = tools.grid.width * 0.095
        assert.equal(tools.computedColumnGap, 0, `tools ${theme}/${width} CSS column gap should stay zero`)
        assert(Math.abs(tools.computedRowGap - expectedGap) < 1, `tools ${theme}/${width} row gap differs from the 9.5% content gap`)
        assert(tools.columnGaps.every(gap => Math.abs(gap - expectedGap) < 1), `tools ${theme}/${width} cards have an unexpected horizontal gap: ${tools.columnGaps}`)
        assert(tools.rowGaps.every(gap => Math.abs(gap - expectedGap) < 1), `tools ${theme}/${width} cards have an unexpected vertical gap: ${tools.rowGaps}`)
        assert(tools.columnGaps.every(columnGap => tools.rowGaps.every(rowGap => Math.abs(columnGap - rowGap) <= 1)),
          `tools ${theme}/${width} horizontal and vertical net gaps differ by more than 1px`)
        assert(Math.abs(tools.cards[0].x - tools.grid.x) < 1, `tools ${theme}/${width} first column is not aligned to the content edge`)
        assert(Math.abs(tools.cards[2].right - tools.grid.right) < 1, `tools ${theme}/${width} last column is not aligned to the content edge`)
        assert(tools.lastRowFirstColumnAligned, `tools ${theme}/${width} last row does not start in the first column`)
        assert(tools.gridOverflow <= 1, `tools ${theme}/${width} grid overflows horizontally`)
        for (const card of tools.cards) {
          assert(Math.abs(card.width - tools.grid.width * 0.27) < 1, `tools ${theme}/${width} card is not 27%: ${JSON.stringify(card)}`)
          assert(Math.abs(card.height - 200 * width / 750) < 1, `tools ${theme}/${width} card height changed: ${JSON.stringify(card)}`)
          assert(card.width >= 44 && card.height >= 44, `tools ${theme}/${width} touch target below 44px`)
          assert(card.titleScrollWidth <= card.titleClientWidth + 1, `tool title clips horizontally: ${JSON.stringify(card)}`)
          assert(card.titleScrollHeight <= card.titleClientHeight + 1, `tool title clips vertically: ${JSON.stringify(card)}`)
        }
        await capture(browser, `tools-${theme}-${width}`, {
          mainHeader: toolsHeader,
          pageWidth: tools.pageWidth, cardCount: tools.cardCount, rows: tools.rowCounts,
          gridWidth: tools.grid.width, display: tools.display,
          columnGap: tools.computedColumnGap, rowGap: tools.computedRowGap,
          measuredColumnGaps: tools.columnGaps, measuredRowGaps: tools.rowGaps,
          lastRowFirstColumnAligned: tools.lastRowFirstColumnAligned, gridOverflow: tools.gridOverflow,
          cards: tools.cards.map(({ title, width: cardWidth, height, titleScrollWidth, titleClientWidth, titleScrollHeight, titleClientHeight }) => ({
            title, width: cardWidth, height, titleScrollWidth, titleClientWidth, titleScrollHeight, titleClientHeight,
          })),
        })

        await browser.evaluate(`(() => {
          const registry = __homepageQa.page.data.tools
          const ids = registry.map(tool => tool.id)
          wx.setStorageSync('audioTool.toolVisibility.v1', { version: 1, hiddenToolIds: ids })
          __homepageQa.page.refreshTools()
          return true
        })()`)
        await delay(40)
        const empty = await readFacts(browser, `(() => {
          const state = document.querySelector('.tools-empty-state')
          const button = state?.querySelector('button')
          const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height } }
          return { ...__facts(), visibleTools: __homepageQa.page.data.tools.length,
            emptyTitle: state?.querySelector('.home-empty-title')?.innerText || '',
            emptyCopy: state?.querySelector('.home-empty-copy')?.innerText || '',
            button: button ? rect(button) : null }
        })()`)
        assert.equal(empty.errors.length, 0, `empty tools ${theme}/${width} WXML errors`)
        assert.equal(empty.runtimeErrors.length, 0, `empty tools ${theme}/${width} runtime errors`)
        assert.equal(empty.visibleTools, 0, `empty tools ${theme}/${width} still has tools`)
        assert(empty.button && empty.button.height >= 44, `empty tools ${theme}/${width} settings button is below 44px`)
        assert(empty.emptyCopy.includes('设置'), `empty tools ${theme}/${width} has no settings guidance`)
        await capture(browser, `tools-empty-${theme}-${width}`, {
          pageWidth: empty.pageWidth, visibleTools: empty.visibleTools,
          emptyTitle: empty.emptyTitle, emptyCopy: empty.emptyCopy, settingsButton: empty.button,
        })
        await browser.evaluate(`document.querySelector('.tools-empty-state button').click();true`)
        const settingsReachable = await browser.evaluate(`__homepageQa.events.navigations.includes('/pages/settings/settings')`)
        assert.equal(settingsReachable, true, `empty tools ${theme}/${width} settings button is not reachable`)

        await browser.viewport(width, 844, theme)
        await browser.navigate({ theme, entry: 'pages/projects/projects.js' })
        const projectsHeader = await assertMainHeader(browser, 'projects', width, theme)
        const projectHome = await readFacts(browser, `(() => {
          const header = document.querySelector('.project-header')
          const title = header?.querySelector('.home-title')
          const actions = header?.querySelector('.project-header-actions')
          const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom } }
          const buttonFacts = [...(actions?.querySelectorAll('button') || [])].map(button => {
            const box = rect(button), range = document.createRange()
            range.selectNodeContents(button)
            const text = range.getBoundingClientRect()
            return { className: button.className, text: button.innerText.trim(), ...box,
              centerXOffset: Math.abs(box.x + box.width / 2 - (text.x + text.width / 2)),
              centerYOffset: Math.abs(box.y + box.height / 2 - (text.y + text.height / 2)),
              size: button.getAttribute('size') }
          })
          return { ...__facts(), title: title ? rect(title) : null, actions: actions ? rect(actions) : null,
            buttons: buttonFacts, projects: __homepageQa.page.data.projects.length }
        })()`)
        assert.equal(projectHome.errors.length, 0, `projects ${theme}/${width} WXML errors`)
        assert.equal(projectHome.runtimeErrors.length, 0, `projects ${theme}/${width} runtime errors`)
        assert.equal(projectHome.pageWidth, width, `projects ${theme}/${width} page width`)
        assert(projectHome.projects > 0, `projects ${theme}/${width} has no fixture project`)
        assert.equal(projectHome.buttons.length, 2, `projects ${theme}/${width} should expose two header actions`)
        assert(projectHome.buttons.some(button => button.className.split(/\s+/).includes('project-create-button')))
        assert(projectHome.buttons.some(button => button.className.split(/\s+/).includes('project-recovery-button')))
        for (const button of projectHome.buttons) {
          assert.equal(button.height, 44, `projects ${theme}/${width} ${button.className} height`)
          assert(button.width >= 44, `projects ${theme}/${width} ${button.className} width`)
          assert(button.centerXOffset < 1 && button.centerYOffset < 1,
            `projects ${theme}/${width} ${button.className} text is not centered: ${JSON.stringify(button)}`)
          assert.equal(button.size, null, `projects ${theme}/${width} ${button.className} still sets size=mini`)
        }
        assert(projectHome.title.right <= projectHome.actions.x + 1, `projects ${theme}/${width} title overlaps actions`)
        await capture(browser, `projects-${theme}-${width}`, {
          mainHeader: projectsHeader,
          pageWidth: projectHome.pageWidth, projectCount: projectHome.projects,
          title: projectHome.title, actions: projectHome.actions, buttons: projectHome.buttons,
        })

        await browser.navigate({ theme, entry: 'pages/index/index.js' })
        const basisHeader = await assertMainHeader(browser, 'basis', width, theme)
        await capture(browser, `basis-${theme}-${width}`, {
          mainHeader: basisHeader,
          pageWidth: basisHeader.pageWidth,
          basisCardCount: await readFacts(browser, "document.querySelectorAll('.home-basis-row').length"),
        })

        if (width === 360) continue
        await browser.navigate({ theme, entry: 'pages/records/project.js', id: 'qa-project-hall' })
        await browser.evaluate(`(() => {
          const page = __homepageQa.page
          page.setData({ project: { ...page.data.project, name: ${JSON.stringify(longProjectName)} } })
          return true
        })()`)
        await delay(40)
        const detail = await readFacts(browser, `(() => {
          const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom } }
          const hero = document.querySelector('.interior-hero'), heading = document.querySelector('.interior-hero-heading')
          const title = document.querySelector('.interior-project-title'), updated = document.querySelector('.interior-updated')
          const menu = document.querySelector('.interior-menu-button'), actions = document.querySelector('.interior-hero-actions')
          const report = document.querySelector('.interior-report-button')
          const bottomBar = document.querySelector('.interior-bottom-bar, .interior-add-button')
          const comparison = document.querySelector('.interior-comparison, .interior-compare-mode, .interior-compare-panel')
          const pageText = document.querySelector('.interior-root')?.innerText || ''
          const menuRect = rect(menu), menuRange = document.createRange()
          menuRange.selectNodeContents(menu)
          const menuText = menuRange.getBoundingClientRect()
          return { ...__facts(), hero: rect(hero), heading: rect(heading), title: rect(title), titleText: title.innerText.trim(),
            titleClientWidth: title.clientWidth, titleClientHeight: title.clientHeight,
            titleScrollWidth: title.scrollWidth, titleScrollHeight: title.scrollHeight,
            updated: rect(updated), menu: { ...menuRect, centerXOffset: Math.abs(menuRect.x + menuRect.width / 2 - (menuText.x + menuText.width / 2)),
              centerYOffset: Math.abs(menuRect.y + menuRect.height / 2 - (menuText.y + menuText.height / 2)) },
            actions: rect(actions), report: rect(report), reportText: report.innerText.trim(),
            bottomBar: Boolean(bottomBar), comparison: Boolean(comparison),
            hasAddContentText: pageText.includes('添加内容'), hasCompareText: pageText.includes('比较计算记录') || pageText.includes('退出记录对比'),
            contentPaddingBottom: getComputedStyle(document.querySelector('.interior-content')).paddingBottom,
            projectCount: __homepageQa.page.data.project ? 1 : 0 }
        })()`)
        assert.equal(detail.errors.length, 0, `project detail ${theme}/${width} WXML errors`)
        assert.equal(detail.runtimeErrors.length, 0, `project detail ${theme}/${width} runtime errors`)
        assert.equal(detail.pageWidth, width, `project detail ${theme}/${width} page width`)
        assert.equal(detail.projectCount, 1, `project detail ${theme}/${width} failed to load fixture project`)
        assert.equal(detail.bottomBar, false, `project detail ${theme}/${width} retained the fixed add-content bottom bar`)
        assert.equal(detail.comparison, false, `project detail ${theme}/${width} retained comparison UI`)
        assert.equal(detail.hasAddContentText, false, `project detail ${theme}/${width} still exposes add-content text`)
        assert.equal(detail.hasCompareText, false, `project detail ${theme}/${width} still exposes comparison text`)
        assert.equal(detail.titleText, longProjectName, `project detail ${theme}/${width} title changed`)
        assert(detail.titleScrollWidth <= detail.titleClientWidth + 1, `project detail ${theme}/${width} title clips horizontally`)
        assert(detail.titleScrollHeight <= detail.titleClientHeight + 1, `project detail ${theme}/${width} title clips vertically`)
        assert(detail.updated.y >= detail.title.bottom - 1, `project detail ${theme}/${width} update time overlaps title`)
        assert.equal(detail.menu.width, 44, `project detail ${theme}/${width} management width`)
        assert.equal(detail.menu.height, 44, `project detail ${theme}/${width} management height`)
        assert(detail.menu.centerXOffset < 1 && detail.menu.centerYOffset < 1,
          `project detail ${theme}/${width} management glyph is not centered: ${JSON.stringify(detail.menu)}`)
        assert(detail.report.y >= detail.updated.bottom - 1, `project detail ${theme}/${width} report overlaps title row`)
        assert(Math.abs(detail.report.x - detail.actions.x) < 1, `project detail ${theme}/${width} report is not left aligned`)
        assert(Math.abs(detail.report.width - detail.actions.width) < 1, `project detail ${theme}/${width} report does not fill the row`)
        const expectedBottomPadding = 24 * width / 750
        assert(Math.abs(parseFloat(detail.contentPaddingBottom) - expectedBottomPadding) < 1,
          `project detail ${theme}/${width} has unexpected bottom padding: ${detail.contentPaddingBottom}`)
        await capture(browser, `project-detail-${theme}-${width}`, {
          pageWidth: detail.pageWidth, titleText: detail.titleText,
          title: detail.title, updated: detail.updated, menu: detail.menu,
          report: detail.report, reportText: detail.reportText,
          bottomBar: detail.bottomBar, comparison: detail.comparison,
          contentPaddingBottom: detail.contentPaddingBottom,
        })

        await browser.evaluate(`(() => {
          const scroller=document.querySelector('.interior-scroll')
          scroller.scrollTop=scroller.scrollHeight
          scroller.dispatchEvent(new Event('scroll'))
          return true
        })()`)
        await delay(60)
        const bottom = await readFacts(browser, `(() => {
          const scroller=document.querySelector('.interior-scroll'), content=document.querySelector('.interior-content')
          const visible=[...content.children].filter(node=>node.getClientRects().length)
          const last=visible.at(-1), scrollRect=scroller.getBoundingClientRect(), lastRect=last?.getBoundingClientRect()
          return { ...__facts(), scrollTop:scroller.scrollTop, maxScroll:scroller.scrollHeight-scroller.clientHeight,
            trailingGap:lastRect?scrollRect.bottom-lastRect.bottom:null,
            lastClass:last?.className||'', lastText:last?.innerText?.trim()||'' }
        })()`)
        assert.equal(bottom.errors.length, 0, `project detail bottom ${theme}/${width} WXML errors`)
        assert(bottom.maxScroll > 0, `project detail ${theme}/${width} content should scroll`)
        assert(Math.abs(bottom.scrollTop - bottom.maxScroll) < 2,
          `project detail ${theme}/${width} cannot scroll to the end: ${JSON.stringify(bottom)}`)
        assert(bottom.trailingGap >= -1 && bottom.trailingGap <= 20,
          `project detail ${theme}/${width} has excessive or missing bottom whitespace: ${JSON.stringify(bottom)}`)
        await capture(browser, `project-detail-bottom-${theme}-${width}`, {
          pageWidth: bottom.pageWidth, scrollTop: bottom.scrollTop, maxScroll: bottom.maxScroll,
          trailingGap: bottom.trailingGap, lastClass: bottom.lastClass, lastText: bottom.lastText,
        })
      }
    }
  } finally {
    await browser.close()
  }
  const headerBaselineComparisons = []
  for (const theme of themes) {
    for (const width of widths) {
      const entries = mainHeaderFacts.filter(item => item.width === width && item.theme === theme)
      assert.equal(entries.length, 3, `all three tab headers should be measured at ${theme}/${width}`)
      for (const key of ['titleY', 'textY']) {
        const values = entries.map(item => item[key])
        assert(Math.max(...values) - Math.min(...values) < 1,
          `${theme}/${width} tab title ${key} baselines differ: ${JSON.stringify(entries)}`)
      }
      headerBaselineComparisons.push({ width, theme, entries })
    }
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
    environment: { adapter: 'source-backed production page browser adapter', physicalDevice: false },
    viewportWidths: widths, themes, longProjectName, scenes, headerBaselineComparisons,
  }, null, 2))
  console.log(JSON.stringify({ output, scenes: scenes.length }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

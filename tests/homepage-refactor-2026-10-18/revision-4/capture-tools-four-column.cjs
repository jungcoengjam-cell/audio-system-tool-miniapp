'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('../browser-driver.cjs')

const output = path.join(__dirname, 'evidence', 'tools')
const widths = [320, 360, 390]
const themes = ['light', 'dark']
const scenes = []

function fileSafe(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

async function facts(browser, expression) {
  return browser.evaluate(expression)
}

async function capture(browser, name, detail) {
  const screenshot = `${fileSafe(name)}.png`
  const file = await browser.screenshot(path.join(output, screenshot))
  const png = fs.readFileSync(file)
  const screenshotWidth = png.readUInt32BE(16)
  const screenshotHeight = png.readUInt32BE(20)
  assert.equal(screenshotWidth, detail.viewport, `${name} PNG width`)
  assert.equal(screenshotHeight, 844, `${name} PNG height`)
  scenes.push({ name, ...detail, screenshot, screenshotSize: { width:screenshotWidth, height:screenshotHeight } })
}

function assertCommon(factsValue, scene, width, theme) {
  assert.equal(factsValue.errors.length, 0, `${scene} ${theme}/${width} WXML errors`)
  assert.equal(factsValue.runtimeErrors.length, 0, `${scene} ${theme}/${width} runtime errors`)
  assert.equal(factsValue.pageWidth, width, `${scene} ${theme}/${width} viewport width`)
}

function assertFourColumnGeometry(layout, scene, width, theme, expectedCount, expectedRows) {
  assertCommon(layout, scene, width, theme)
  assert.equal(layout.display, 'grid', `${scene} ${theme}/${width} is not a grid`)
  assert.equal(layout.cardCount, expectedCount, `${scene} ${theme}/${width} card count`)
  assert.deepEqual(layout.rowCounts, expectedRows, `${scene} ${theme}/${width} row distribution`)
  const expectedGap = 16 * width / 750
  assert(Math.abs(layout.columnGap - expectedGap) < 0.1, `${scene} ${theme}/${width} column gap is not 16rpx`)
  assert(Math.abs(layout.rowGap - expectedGap) < 0.1, `${scene} ${theme}/${width} row gap is not 16rpx`)
  assert(layout.columnGaps.every(gap => Math.abs(gap - expectedGap) < 1), `${scene} ${theme}/${width} horizontal gaps differ: ${layout.columnGaps}`)
  assert(layout.rowGaps.every(gap => Math.abs(gap - expectedGap) < 1), `${scene} ${theme}/${width} vertical gaps differ: ${layout.rowGaps}`)
  assert(layout.columnGaps.every(columnGap => layout.rowGaps.every(rowGap => Math.abs(columnGap - rowGap) <= 1)),
    `${scene} ${theme}/${width} horizontal and vertical measured gaps differ by more than 1px`)
  assert(layout.gridOverflow <= 1, `${scene} ${theme}/${width} grid overflows: ${layout.gridOverflow}px`)
  assert(Math.abs(layout.firstColumnX - layout.grid.x) < 1, `${scene} ${theme}/${width} first column is not left aligned`)
  assert(Math.abs(layout.expectedCellWidth - layout.cards[0].width) < 1,
    `${scene} ${theme}/${width} card width does not match the four-column grid cell`)
  assert(layout.cards.every(card => Math.abs(card.height - 200 * width / 750) < 1),
    `${scene} ${theme}/${width} card height changed from 200rpx`)
  assert(layout.cards.every(card => card.width >= 44 && card.height >= 44),
    `${scene} ${theme}/${width} touch target is below 44px`)
  for (const card of layout.cards) {
    assert(card.titleFontSize === '13px', `${scene} ${theme}/${width} ${card.id} title is not 13px`)
    assert(Math.abs(card.titleLineHeight - 15.6) < 0.2, `${scene} ${theme}/${width} ${card.id} line height is not 1.2`)
    assert(Math.abs(card.titleHeight - 32) < 1, `${scene} ${theme}/${width} ${card.id} title area is not a shared 32px region`)
    assert(card.titleScrollWidth <= card.titleClientWidth + 1, `${scene} ${theme}/${width} ${card.id} title clips horizontally`)
    assert(card.titleScrollHeight <= card.titleClientHeight + 1, `${scene} ${theme}/${width} ${card.id} title clips vertically`)
    assert(Math.abs(card.wrapWidth - 88 * width / 750) < 1 && Math.abs(card.wrapHeight - 88 * width / 750) < 1,
      `${scene} ${theme}/${width} ${card.id} icon wrap changed`)
    assert(Math.abs(card.iconWidth - 84 * width / 750) < 1 && Math.abs(card.iconHeight - 84 * width / 750) < 1,
      `${scene} ${theme}/${width} ${card.id} icon changed`)
    assert(Math.abs(card.iconMarginBottom - 6 * width / 750) < 1,
      `${scene} ${theme}/${width} ${card.id} icon/title gap changed`)
    assert.equal(card.accessibleLabel, `打开${card.sourceTitle}，${card.subtitle}`,
      `${scene} ${theme}/${width} ${card.id} accessible name changed`)
    assert.equal(card.displayText.replace(/\s/g, ''), card.sourceTitle.replace(/\s/g, ''),
      `${scene} ${theme}/${width} ${card.id} display title changed`)
  }
}

function assertSemanticLines(cards, scene, width, theme) {
  const wiring = cards.find(card => card.id === 'projectWiring')
  const camera = cards.find(card => card.id === 'camera')
  if (!wiring || !camera) return
  assert.deepEqual(wiring.titleLines, ['通道与', '线缆'], `${scene} ${theme}/${width} cable title lines`)
  assert.deepEqual(camera.titleLines, ['摄像机', '视场角'], `${scene} ${theme}/${width} camera title lines`)
  for (const card of cards.filter(card => !['projectWiring', 'camera'].includes(card.id))) {
    assert.deepEqual(card.titleLines, [card.sourceTitle], `${scene} ${theme}/${width} ${card.id} source title changed`)
  }
}

async function measureGrid(browser) {
  return facts(browser, `(() => {
    const rect = node => { const box=node.getBoundingClientRect(); return {x:box.x,y:box.y,width:box.width,height:box.height,right:box.right,bottom:box.bottom} }
    const grid=document.querySelector('.home-tool-grid'), gridBox=rect(grid), style=getComputedStyle(grid)
    const cards=[...document.querySelectorAll('.home-tool-card')].map(card=>{
      const index=[...document.querySelectorAll('.home-tool-card')].indexOf(card)
      const tool=__homepageQa.page.data.tools[index]
      const title=card.querySelector('.home-tool-title'), wrap=card.querySelector('.home-tool-icon-wrap'), icon=card.querySelector('.home-tool-icon')
      const titleStyle=getComputedStyle(title), wrapStyle=getComputedStyle(wrap), iconStyle=getComputedStyle(icon)
      const rows=[...title.querySelectorAll('.home-tool-title-line')]
      return {id:tool.id,sourceTitle:tool.title,subtitle:tool.subtitle,accessibleLabel:card.getAttribute('aria-label'),
        displayText:title.innerText.trim(),titleLines:rows.map(node=>node.innerText.trim()),...rect(card),titleWidth:title.clientWidth,
        titleHeight:rect(title).height,titleClientWidth:title.clientWidth,titleClientHeight:title.clientHeight,
        titleScrollWidth:title.scrollWidth,titleScrollHeight:title.scrollHeight,titleFontSize:titleStyle.fontSize,
        titleLineHeight:parseFloat(titleStyle.lineHeight),wrapWidth:rect(wrap).width,wrapHeight:rect(wrap).height,
        iconWidth:rect(icon).width,iconHeight:rect(icon).height,iconMarginBottom:parseFloat(wrapStyle.marginBottom),
        iconSource:icon.getAttribute('src'),iconDisplay:iconStyle.display}
    })
    const rowYs=[...new Set(cards.map(card=>Math.round(card.y*100)/100))]
    const rows=rowYs.map(y=>cards.filter(card=>Math.abs(card.y-y)<0.1).sort((a,b)=>a.x-b.x))
    const columnGaps=rows.flatMap(row=>row.slice(1).map((card,index)=>card.x-(row[index].x+row[index].width)))
    const rowGaps=rows.slice(1).map((row,index)=>row[0].y-(rows[index][0].y+rows[index][0].height))
    return {...__facts(),grid:gridBox,display:style.display,columnGap:parseFloat(style.columnGap),rowGap:parseFloat(style.rowGap),
      cardCount:cards.length,cards,rowCounts:rows.map(row=>row.length),columnGaps,rowGaps,
      firstColumnX:rows[0]?.[0]?.x,expectedCellWidth:(gridBox.width-3*parseFloat(style.columnGap))/4,
      gridOverflow:grid.scrollWidth-grid.clientWidth}
  })()`)
}

async function tapCategory(browser, label) {
  await browser.evaluate(`(() => {
    const chip=[...document.querySelectorAll('.home-chip')].find(node=>node.innerText.trim()===${JSON.stringify(label)})
    if (!chip) throw Error('Missing category chip: '+${JSON.stringify(label)})
    chip.click()
    return true
  })()`)
  await delay(50)
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const browser = await launch()
  try {
    for (const theme of themes) {
      for (const width of widths) {
        await browser.viewport(width, 844, theme)
        await browser.navigate({ theme, entry: 'pages/tools/tools.js' })

        const all = await measureGrid(browser)
        assertFourColumnGeometry(all, 'all-tools', width, theme, 10, [4, 4, 2])
        assertSemanticLines(all.cards, 'all-tools', width, theme)
        assert(Math.abs(all.cards[3].right - all.grid.right) < 1,
          `all-tools ${theme}/${width} fourth card does not reach the grid edge`)
        await capture(browser, `tools-${theme}-${width}`, {
          viewport: width, theme, rowCounts: all.rowCounts, cardCount: all.cardCount,
          cardWidth: all.cards[0].width, cardHeight: all.cards[0].height,
          columnGap: all.columnGap, rowGap: all.rowGap, measuredColumnGaps: all.columnGaps,
          measuredRowGaps: all.rowGaps, gridOverflow: all.gridOverflow,
          titleFontSizes: [...new Set(all.cards.map(card => card.titleFontSize))],
          titleAreas: [...new Set(all.cards.map(card => card.titleHeight))],
          displayedTitles: all.cards.map(card => ({ id:card.id, sourceTitle:card.sourceTitle, titleLines:card.titleLines })),
        })

        await tapCategory(browser, '布线')
        const category = await measureGrid(browser)
        assertFourColumnGeometry(category, 'category-wiring', width, theme, 3, [3])
        assertSemanticLines(category.cards, 'category-wiring', width, theme)
        assert(Math.abs(category.cards[0].x - category.grid.x) < 1,
          `category-wiring ${theme}/${width} first column is not left aligned`)
        await capture(browser, `tools-category-wiring-${theme}-${width}`, {
          viewport: width, theme, category: '布线', rowCounts: category.rowCounts,
          cardCount: category.cardCount, cardWidth: category.cards[0].width,
          cardHeight: category.cards[0].height, columnGap: category.columnGap,
          rowGap: category.rowGap, firstColumnAligned: true,
        })

        await tapCategory(browser, '全部')
        const hiddenResult = await browser.evaluate(`(() => {
          const ids=__homepageQa.page.data.tools.map(tool=>tool.id)
          wx.setStorageSync('audioTool.toolVisibility.v1',{version:1,hiddenToolIds:ids})
          __homepageQa.page.refreshTools()
          return ids
        })()`)
        await delay(60)
        const empty = await facts(browser, `(() => {
          const state=document.querySelector('.tools-empty-state'),button=state?.querySelector('button'),copy=state?.querySelector('.home-empty-copy')
          const rect=node=>{const box=node.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height}}
          return {...__facts(),visibleToolCount:__homepageQa.page.data.tools.length,
            emptyVisible:Boolean(state&&state.getClientRects().length),visibilityWarning:Boolean(document.querySelector('.tools-visibility-warning')),
            title:state?.querySelector('.home-empty-title')?.innerText.trim()||'',copy:copy?.innerText.trim()||'',
            copyFontSize:copy?getComputedStyle(copy).fontSize:'',button:button?rect(button):null}
        })()`)
        assertCommon(empty, 'tools-empty', width, theme)
        assert.equal(empty.visibleToolCount, 0, `tools-empty ${theme}/${width} hidden tools remain in page data`)
        assert.equal(empty.emptyVisible, true, `tools-empty ${theme}/${width} empty state is not shown`)
        assert.equal(empty.visibilityWarning, false, `tools-empty ${theme}/${width} unexpected storage warning`)
        assert(empty.copy.includes('设置'), `tools-empty ${theme}/${width} does not direct users to Settings`)
        assert.equal(empty.copyFontSize, '14px', `tools-empty ${theme}/${width} copy is not 14px`)
        assert(empty.button && empty.button.height >= 44, `tools-empty ${theme}/${width} Settings action is under 44px`)
        await capture(browser, `tools-empty-${theme}-${width}`, {
          viewport: width, theme, hiddenToolCount: hiddenResult.length,
          visibleToolCount: empty.visibleToolCount, title: empty.title, copy: empty.copy,
          settingsButton: empty.button, buttonFontSize: empty.copyFontSize,
        })
        await browser.evaluate(`document.querySelector('.tools-empty-state button').click();true`)
        const settingsReachable = await facts(browser, `__homepageQa.events.navigations.includes('/pages/settings/settings')`)
        assert.equal(settingsReachable, true, `tools-empty ${theme}/${width} Settings action cannot navigate`)
      }
    }
  } finally {
    await browser.close()
  }

  const sourceHash = require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, '../../../pages/tools/tools.wxss')))
    .update(fs.readFileSync(path.join(__dirname, '../../../pages/tools/tools.wxml')))
    .digest('hex')
  const summary = {
    environment: { adapter: 'source-backed production page browser adapter', nativeRuntime: false, physicalDevice: false },
    sourceHash, viewportWidths: widths, themes,
    cases: ['all-tools 4/4/2', '布线 category 3 in first columns', 'all tools hidden with Settings action'],
    sceneCount: scenes.length, scenes,
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ output, sceneCount: scenes.length, sourceHash }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

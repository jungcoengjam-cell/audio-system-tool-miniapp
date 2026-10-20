'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('../browser-driver.cjs')

const root = path.resolve(__dirname, '../../..')
const output = path.join(__dirname, 'evidence', 'browser')
const tools = ['cable', 'gainStructure', 'limiter', 'spl', 'camera', 'ledScreen']
const widths = [320, 360, 390]

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function saveFullScreenshot(browser, file, width) {
  const metrics = await browser.send('Page.getLayoutMetrics')
  const size = metrics.cssContentSize || metrics.contentSize
  const height = Math.ceil(size.height)
  const capture = await browser.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(capture.data, 'base64'))
  return { width, height, file }
}

async function inspect(browser) {
  return browser.evaluate('(() => { const scroll=document.querySelector(".home-scroll"); const figure=document.querySelector(".basis-figure"); const selectors=[".basis-detail-heading",".basis-figure-panel",".basis-figure",".basis-figure-caption",".basis-method-panel",".basis-source-panel",".basis-full-toggle",".basis-open-button"]; const boxes=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(node=>{const rect=node.getBoundingClientRect();return{selector,width:rect.width,height:rect.height,right:rect.right,fontSize:getComputedStyle(node).fontSize,text:node.innerText?.slice(0,72)||""}})); return {title:document.querySelector(".basis-detail-title")?.innerText||document.querySelector(".home-title")?.innerText||"",width:innerWidth,pageWidth:document.documentElement.scrollWidth,scrollWidth:scroll?.scrollWidth||0,scrollClientWidth:scroll?.clientWidth||0,scrollHeight:scroll?.scrollHeight||0,scrollClientHeight:scroll?.clientHeight||0,figure:figure?{src:figure.getAttribute("src"),complete:figure.complete,naturalWidth:figure.naturalWidth,naturalHeight:figure.naturalHeight,alt:figure.getAttribute("aria-label")}:null,buttons:[...document.querySelectorAll("button")].filter(node=>node.getClientRects().length).map(node=>({text:node.innerText.trim(),height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width,expanded:node.getAttribute("aria-expanded")})),categoryBadges:document.querySelectorAll(".home-basis-category").length,errors:window.__facts().errors,runtimeErrors:window.__facts().runtimeErrors,boxes}})()')
}

async function main() {
  const browser = await launch()
  const scenes = []
  const screenshots = []
  fs.mkdirSync(output, { recursive: true })
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of widths) {
        await browser.viewport(width, 844, theme)
        await browser.navigate({ theme, entry: 'pages/index/index.js' })
        const facts = await inspect(browser)
        if (facts.errors.length || facts.runtimeErrors.length) throw Error('directory/' + theme + '/' + width + ' browser errors: ' + JSON.stringify(facts))
        if (facts.pageWidth > width || facts.scrollWidth > facts.scrollClientWidth + 1) throw Error('directory/' + theme + '/' + width + ' horizontal overflow')
        if (facts.categoryBadges !== 0) throw Error('directory category badges remain')
        const file = path.join(output, 'directory-' + theme + '-' + width + '.png')
        screenshots.push(await saveFullScreenshot(browser, file, width))
        scenes.push({ name: 'directory', theme, ...facts, screenshot: path.basename(file) })
      }
    }
    for (const theme of ['light', 'dark']) {
      for (const tool of tools) {
        for (const width of widths) {
          await browser.viewport(width, 844, theme)
          await browser.navigate({ theme, entry: 'pages/basis/detail.js', tool })
          await browser.evaluate('Promise.all([...document.images].map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=resolve;image.onerror=resolve})))')
          await delay(30)
          const facts = await inspect(browser)
          if (facts.errors.length || facts.runtimeErrors.length) throw Error(tool + '/' + theme + '/' + width + ' browser errors: ' + JSON.stringify(facts))
          if (facts.pageWidth > width || facts.scrollWidth > facts.scrollClientWidth + 1) throw Error(tool + '/' + theme + '/' + width + ' horizontal overflow: ' + JSON.stringify({ pageWidth:facts.pageWidth, scrollWidth:facts.scrollWidth, scrollClientWidth:facts.scrollClientWidth }))
          if (!facts.figure || !facts.figure.complete || facts.figure.naturalWidth !== 750 || facts.figure.naturalHeight !== 560) throw Error(tool + ' illustration did not load at its source dimensions: ' + JSON.stringify(facts.figure))
          for (const button of facts.buttons) if (button.height < 44) throw Error(tool + '/' + width + ' button below 44px: ' + JSON.stringify(button))
          const name = safeName(tool + '-' + theme + '-' + width)
          const file = path.join(output, name + '.png')
          screenshots.push(await saveFullScreenshot(browser, file, width))
          scenes.push({ name: tool, theme, ...facts, screenshot: path.basename(file) })

          if (theme === 'light' && width === 320) {
            await browser.evaluate('document.querySelector(".basis-full-toggle").click()')
            await delay(40)
            const expanded = await inspect(browser)
            const fullText = await browser.evaluate('document.querySelector("#basis-full-content")?.innerText||""')
            if (!fullText.includes('方法与公式') || !fullText.includes('来源') || !fullText.includes('适用边界')) throw Error(tool + ' full explanation did not expand')
            if (expanded.scrollWidth > expanded.scrollClientWidth + 1) throw Error(tool + ' expanded explanation overflows')
            await browser.evaluate('(() => { const scroll=document.querySelector(".home-scroll"); const full=document.querySelector("#basis-full-content"); const top=full.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop; scroll.scrollTop=Math.max(0,top-24); return scroll.scrollTop })()')
            await delay(30)
            const fullFile = path.join(output, safeName(tool + '-light-320-full') + '.png')
            screenshots.push(await saveFullScreenshot(browser, fullFile, width))
            scenes.push({ name: tool, theme: 'light', width, expanded: true, fullTextLength: fullText.length, screenshot: path.basename(fullFile) })
          }
        }
      }
    }
  } finally {
    await browser.close()
  }
  const result = {
    environment: { browser: 'headless Chromium with source-backed mini-program adapter', physicalDevice: false },
    scenes: scenes.length,
    screenshots: screenshots.length,
    totalIllustrationBytes: tools.reduce((sum, tool) => sum + fs.statSync(path.join(root, 'assets/basis', tool + '.png')).size, 0),
    failures: [],
    sceneData: scenes,
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ output, scenes:result.scenes, screenshots:result.screenshots, totalIllustrationBytes:result.totalIllustrationBytes, failures:result.failures }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

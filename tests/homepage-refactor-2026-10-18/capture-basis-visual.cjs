'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { launch, delay } = require('./browser-driver.cjs')

const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, 'evidence/browser/basis-presentation')
const entries = [
  { name: 'directory', entry: 'pages/index/index.js', width:320 },
  { name: 'directory', entry: 'pages/index/index.js', width:390 },
  ...['cable', 'gainStructure', 'limiter', 'spl', 'camera', 'ledScreen'].map((tool) => ({
    name: tool,
    entry: 'pages/basis/detail.js',
    tool,
    width:320,
  })),
  { name: 'camera', entry:'pages/basis/detail.js', tool:'camera', width:360 },
]

async function main() {
  const browser = await launch()
  const scenes = []
  fs.mkdirSync(output, { recursive: true })
  try {
    for (const theme of ['light', 'dark']) {
      for (const scene of entries) {
        await browser.viewport(scene.width, 844, theme)
        await browser.navigate({ theme, entry: scene.entry, ...(scene.tool ? { tool: scene.tool } : {}) })
        await delay(80)
        const facts = await browser.evaluate(`(() => {
          const scroll = document.querySelector('.home-scroll')
          const selectors = ['.home-page','.home-basis-row','.home-basis-title','.home-basis-category','.home-basis-subtitle','.home-basis-summary','.home-basis-card-footer','.basis-detail-heading','.basis-detail-title','.basis-detail-subtitle','.home-panel','.home-body-copy','.basis-path-step','.basis-path-label','.basis-method-copy','.basis-method-formula','.basis-input-row','.basis-input-name','.basis-input-meaning','.basis-source-tag','.basis-source-copy','.basis-limit-row','.basis-limit-copy','.basis-open-button']
          const boxes = selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(node => {
            const rect = node.getBoundingClientRect()
            return {selector, width:rect.width, right:rect.right, fontSize:getComputedStyle(node).fontSize, text:node.innerText?.slice(0,80)||''}
          }))
          return {...window.__facts(), scrollHeight:scroll?.scrollHeight||0, scrollClientWidth:scroll?.clientWidth||0, scrollWidth:scroll?.scrollWidth||0, scrollClientHeight:scroll?.clientHeight||0, boxes}
        })()`)
        if (facts.errors.length || facts.runtimeErrors.length) throw Error(`${scene.name}/${theme} browser errors: ${JSON.stringify({ errors:facts.errors, runtimeErrors:facts.runtimeErrors })}`)
        if (facts.pageWidth > scene.width || facts.scrollWidth > facts.scrollClientWidth + 1) throw Error(`${scene.name}/${theme}/${scene.width} horizontal overflow: ${JSON.stringify({ pageWidth:facts.pageWidth, scrollWidth:facts.scrollWidth, scrollClientWidth:facts.scrollClientWidth })}`)
        const name = `${scene.name}-${theme}-${scene.width}`
        await browser.screenshot(path.join(output, `${name}-top.png`))
        if (scene.name === 'directory') {
          await browser.evaluate(`(() => {const e=document.querySelector('.home-scroll');e.scrollTop=e.scrollHeight-e.clientHeight})()`)
          await delay(50)
          await browser.screenshot(path.join(output, `${name}-bottom.png`))
        } else if (scene.width === 320 && ['camera', 'limiter'].includes(scene.name)) {
          const maxScroll = Math.max(0, facts.scrollHeight - facts.scrollClientHeight)
          for (const [position, amount] of [['middle', Math.round(maxScroll / 2)], ['bottom', maxScroll]]) {
            await browser.evaluate(`(() => {document.querySelector('.home-scroll').scrollTop=${amount}})()`)
            await delay(50)
            await browser.screenshot(path.join(output, `${name}-${position}.png`))
          }
          await browser.evaluate(`(() => {document.querySelector('.home-scroll').scrollTop=0})()`)
        }
        fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(facts, null, 2))
        scenes.push({ name, width:scene.width, pageWidth:facts.pageWidth, scrollWidth:facts.scrollWidth, scrollClientWidth:facts.scrollClientWidth, scrollHeight:facts.scrollHeight, errors:facts.errors, runtimeErrors:facts.runtimeErrors })
      }
    }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(scenes, null, 2))
  console.log(JSON.stringify({ output, scenes:scenes.length, screenshots:fs.readdirSync(output).filter((name) => name.endsWith('.png')).length, failures:scenes.filter((scene) => scene.errors.length || scene.runtimeErrors.length || scene.pageWidth > scene.width || scene.scrollWidth > scene.scrollClientWidth + 1) }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

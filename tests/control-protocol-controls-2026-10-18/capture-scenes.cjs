'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { launch, delay } = require('../control-protocol-refactor-2026-10-18/browser-driver.cjs')
const root = path.resolve(__dirname, '../..')
const output = path.join(__dirname, 'evidence/browser')
function hashes() {
  const files = fs.readdirSync(path.join(root, 'pages/control-protocol')).filter(file => /\.(js|wxml|wxss|json)$/.test(file)).map(file => 'pages/control-protocol/' + file)
  files.push('app.wxss')
  return Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
}
async function run() {
  const sources = hashes(), scenes = []
  const browser = await launch()
  try {
    async function capture(name) {
      await delay(380)
      const facts = await browser.evaluate('window.__facts()')
      const text = await browser.evaluate('document.body.innerText')
      assert.deepEqual(facts.errors, [])
      assert.deepEqual(facts.runtimeErrors, [])
      assert(facts.pageWidth <= facts.width + 1, name + ' horizontal overflow')
      for (const removed of ['人工选择 · 不自动识别', '仅用于本页复制，不保存', '静态参考帧', '协议资料', '协议说明', '手册示例帧中的']) assert(!text.includes(removed), name + ': obsolete explanation ' + removed)
      assert.equal(await browser.evaluate('document.querySelectorAll(".info-button,.info-sheet,.reference-mark,.transport-note,.read-only-note,.material-status").length'), 0)
      const targets = await browser.evaluate(`Array.from(document.querySelectorAll('.transport-tab,.device-select-button,.loop-picker,.expand-commands,.copy-glyph,.mac-clear,.sheet-cancel,.category-chip,.search-clear,.clear-filters-button,.directory-select-control')).filter(node => node.getClientRects().length).map(node => { const r=node.getBoundingClientRect(), s=getComputedStyle(node);return {className:node.className,width:r.width,height:r.height,background:s.backgroundColor,color:s.color,borderRadius:s.borderRadius} })`)
      for (const target of targets) assert(target.width >= 43.5 && target.height >= 43.5, name + ': undersized target ' + JSON.stringify(target))
      await browser.screenshot(path.join(output, name + '.png'))
      scenes.push({ name, facts, targets })
      console.log(name + ': PASS')
    }
    async function copyPress(name, disabled) {
      const selector = disabled ? '.copy-glyph[disabled]' : '.copy-glyph:not([disabled])'
      const before = await browser.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x+r.width/2,y:r.y+r.height/2,background:s.backgroundColor,opacity:s.opacity,border:getComputedStyle(e.querySelector('.copy-icon'),'::before').borderColor}})()`)
      await browser.send('Input.dispatchMouseEvent', {type:'mousePressed',x:before.x,y:before.y,button:'left',clickCount:1})
      const pressed = await browser.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e);return {background:s.backgroundColor,opacity:s.opacity,border:getComputedStyle(e.querySelector('.copy-icon'),'::before').borderColor}})()`)
      if (disabled) assert.deepEqual(pressed, {background:before.background,opacity:before.opacity,border:before.border}, 'Disabled copy must not acquire active styling')
      else assert.notEqual(pressed.background, before.background, 'Enabled copy must show its pressed background')
      await capture(name)
      await browser.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:before.x,y:before.y,button:'left',clickCount:1})
    }
    for (const width of [390, 320]) for (const theme of ['light', 'dark']) {
      await browser.viewport(width, 844, theme)
      await browser.navigate()
      await capture(`reader-${theme}-${width}`)
      if (width === 390) await copyPress(`copy-pressed-${theme}-${width}`, false)
      await browser.evaluate('window.__protocolQa.page.openDeviceSelector()')
      await capture(`directory-${theme}-${width}`)
      await browser.evaluate("window.__protocolQa.page.onSearchInput({detail:{value:'K100R'}})")
      await capture(`directory-filtered-${theme}-${width}`)
      await browser.evaluate('window.__protocolQa.page.clearSearch()')
      await browser.evaluate("window.__protocolQa.page.onCategoryTap({currentTarget:{dataset:{key:window.__protocolQa.page.data.categories.find(item=>item.key!=='all').key}}})")
      await capture(`directory-category-${theme}-${width}`)
      await browser.evaluate('window.__protocolQa.page.closeOverlay()')
      await delay(380)
      await browser.evaluate('window.__protocolQa.page.selectManualTransport({currentTarget:{dataset:{index:0}}})')
      await capture(`tcp-${theme}-${width}`)
      await browser.evaluate("window.__protocolQa.page.selectDevice({currentTarget:{dataset:{type:'reference',id:'reference-kylin-k100r-01'}}})")
      await delay(380)
      await browser.evaluate('window.__protocolQa.page.selectManualTransport({currentTarget:{dataset:{index:1}}})')
      await capture(`udp-${theme}-${width}`)
      if (width === 390) await copyPress(`udp-disabled-pressed-${theme}-${width}`, true)
      await browser.evaluate("window.__protocolQa.page.onDeviceMacInput({detail:{value:'A1B2C3D4E5F6'}})")
      await capture(`udp-valid-${theme}-${width}`)
    }
  } finally {
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'scenes.json'), JSON.stringify({ capturedAt: new Date().toISOString(), sources, sourcesStable: JSON.stringify(sources) === JSON.stringify(hashes()), nativeRuntime: false, physicalDevice: false, scenes }, null, 2))
    await browser.close()
  }
  assert.equal(scenes.length, 32)
  assert.deepEqual(hashes(), sources, 'Mixed source revisions')
}
run().catch(error => { console.error(error); process.exitCode = 1 })

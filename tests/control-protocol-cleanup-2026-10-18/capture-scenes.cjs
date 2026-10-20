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
      await browser.screenshot(path.join(output, name + '.png'))
      scenes.push({ name, facts })
      console.log(name + ': PASS')
    }
    for (const width of [390, 320]) for (const theme of ['light', 'dark']) {
      await browser.viewport(width, 844, theme)
      await browser.navigate()
      await capture(`reader-${theme}-${width}`)
      await browser.evaluate('window.__protocolQa.page.openDeviceSelector()')
      await capture(`directory-${theme}-${width}`)
      await browser.evaluate('window.__protocolQa.page.closeOverlay()')
      await delay(380)
      await browser.evaluate('window.__protocolQa.page.selectManualTransport({currentTarget:{dataset:{index:0}}})')
      await capture(`tcp-${theme}-${width}`)
      await browser.evaluate("window.__protocolQa.page.selectDevice({currentTarget:{dataset:{type:'reference',id:'reference-kylin-k100r-01'}}})")
      await delay(380)
      await browser.evaluate('window.__protocolQa.page.selectManualTransport({currentTarget:{dataset:{index:1}}})')
      await capture(`udp-${theme}-${width}`)
    }
  } finally {
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'scenes.json'), JSON.stringify({ capturedAt: new Date().toISOString(), sources, sourcesStable: JSON.stringify(sources) === JSON.stringify(hashes()), nativeRuntime: false, physicalDevice: false, scenes }, null, 2))
    await browser.close()
  }
  assert.equal(scenes.length, 16)
  assert.deepEqual(hashes(), sources, 'Mixed source revisions')
}
run().catch(error => { console.error(error); process.exitCode = 1 })

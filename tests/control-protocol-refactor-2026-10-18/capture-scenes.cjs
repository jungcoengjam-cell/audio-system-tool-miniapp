'use strict'

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { launch, delay } = require('./browser-driver.cjs')
const root = path.resolve(__dirname, '../..')
function sourceHashes() {
  const files = fs.readdirSync(path.join(root, 'pages/control-protocol')).filter(file => /\.(js|wxml|wxss|json)$/.test(file)).map(file => 'pages/control-protocol/' + file)
  files.push('app.wxss')
  return Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
}
async function run() {
  const sources = sourceHashes()
  const browser = await launch()
  const scenes = []
  async function capture(name) {
    await delay(380)
    const facts = await browser.evaluate('window.__facts()')
    await browser.screenshot(path.join(__dirname, 'evidence/browser', name + '.png'))
    scenes.push({ name, facts })
    assert.deepEqual(facts.errors, [], name + ' template evaluation')
    assert.deepEqual(facts.runtimeErrors, [], name + ' runtime')
    assert(facts.pageWidth <= facts.width + 1, name + ' horizontal page overflow')
    console.log(JSON.stringify({ name, width: facts.width, overflow: facts.pageWidth > facts.width, errors: facts.errors.length + facts.runtimeErrors.length }))
  }
  try {
    for (const width of [390, 320]) {
      for (const theme of ['light', 'dark']) {
        await browser.viewport(width, 844, theme)
        await browser.navigate()
        await capture(`reader-${theme}-${width}`)
        await browser.evaluate('window.__protocolQa.page.openDeviceSelector()')
        await capture(`directory-${theme}-${width}`)
        await browser.evaluate('window.__protocolQa.page.closeOverlay()')
        await delay(380)
        await browser.evaluate('window.__protocolQa.page.openInfoSheet()')
        await capture(`info-${theme}-${width}`)
        await browser.evaluate('window.__protocolQa.page.closeOverlay()')
        await delay(380)
        await browser.evaluate('window.__protocolQa.page.selectManualTransport({currentTarget:{dataset:{index:0}}})')
        await capture(`tcp-${theme}-${width}`)
        await browser.evaluate("window.__protocolQa.page.selectDevice({currentTarget:{dataset:{type:'reference',id:'reference-kylin-k100r-01'}}})")
        await delay(380)
        await browser.evaluate('window.__protocolQa.page.selectManualTransport({currentTarget:{dataset:{index:1}}})')
        await capture(`udp-${theme}-${width}`)
      }
    }
  } finally {
    fs.mkdirSync(path.join(__dirname, 'evidence/browser'), { recursive: true })
    fs.writeFileSync(path.join(__dirname, 'evidence/browser/scenes.json'), JSON.stringify({ capturedAt: new Date().toISOString(), renderedFromProductionSources: true, nativeRuntime: false, physicalDevice: false, sources, sourcesStable: JSON.stringify(sources) === JSON.stringify(sourceHashes()), scenes }, null, 2))
    await browser.close()
  }
  assert.deepEqual(sourceHashes(), sources, 'Screenshots must not mix source revisions')
}
run().catch(error => { console.error(error); process.exitCode = 1 })

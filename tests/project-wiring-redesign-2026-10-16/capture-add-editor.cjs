const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { launch, delay } = require('./cdp.cjs')
async function main() {
  const browser = await launch()
  try {
    await browser.viewport(390, 844, 'light')
    await browser.navigate('tests/project-wiring-redesign-2026-10-16/browser.html?theme=light')
    await browser.evaluate('window.__dispatch("openNewLine")')
    await delay(80)
    const state = await browser.evaluate('window.__wiringQa')
    if (!state.session.data.draftIsNew || !state.session.data.editorVisible) throw Error('Actual Add mode did not open')
    const file = path.join(__dirname, 'evidence/screenshots/editor-add-line-light-390.png')
    await browser.screenshot(file)
    const evidence = { scene: 'editor-add-line-light-390', path: file, viewport: { width: 390, height: 844 }, theme: 'light', renderer: 'Current production WXML/WXSS on Chromium adapter with actual openNewLine handler', draftIsNew: state.session.data.draftIsNew, editorVisible: state.session.data.editorVisible, data: state.session.data, sources: state.session.sources, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), limits: 'Not WeChat native runtime.' }
    const metadata = path.join(__dirname, 'evidence/scenes/editor-add-line-light-390.json')
    fs.writeFileSync(metadata, JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify({ file, metadata, draftIsNew: evidence.draftIsNew, sha256: evidence.sha256, sources: evidence.sources }, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

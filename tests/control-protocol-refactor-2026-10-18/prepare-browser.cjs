'use strict'

// Reuse the repository's source-backed WXML/CSS test adapter. These renders
// supplement native evidence; they do not simulate phone keyboard or image gestures.
const fs = require('node:fs')
const path = require('node:path')
const shared = path.join(__dirname, '../dmx-ui-refactor-2026-10-18')
const parserSource = fs.readFileSync(path.join(__dirname, '../project-wiring-redesign-2026-10-16/browser.js'), 'utf8')
const parser = parserSource.slice(0, parserSource.indexOf('function box(node)'))
  .replace("if (node.tag === 'canvas') return ''", '')
  .replace('function parse(markup) {', "function parse(markup) {\n  markup = markup.replace(/\\{\\{[\\s\\S]*?\\}\\}/g, block => block.replace(/</g, '\\uE000'))")
  .replace('for (const token of tokens) {', "for (const rawToken of tokens) {\n    const token = rawToken.replace(/\\uE000/g, '<')")
let runtime = fs.readFileSync(path.join(shared, 'browser-runtime.js'), 'utf8')
runtime = runtime.slice(0, runtime.indexOf('async function boot(){')) + `
async function boot() {
  window.__protocolQa = qa
  const options = {}
  if (query.has('referenceId')) options.referenceId = query.get('referenceId')
  if (query.has('appearanceGroupId')) options.appearanceGroupId = query.get('appearanceGroupId')
  await window.__openPage('pages/control-protocol/detail.js', options)
}
boot().catch(reportError)
`
runtime = runtime.replace('createCanvasContext: canvasContext,', `previewImage: options => { qa.preview = clone(options); options.success?.() },
  hideToast: () => {},
  createCanvasContext: canvasContext,`)
runtime = runtime.replace("const leftAttribute=scroll.getAttribute('scroll-left')", `const topAttribute=scroll.getAttribute('scroll-top')
    if(topAttribute!==null&&scroll.__qaScrollTopAttribute!==topAttribute)scroll.scrollTop=Number(topAttribute)||0
    scroll.__qaScrollTopAttribute=topAttribute
    const leftAttribute=scroll.getAttribute('scroll-left')`)
fs.writeFileSync(path.join(__dirname, 'browser.js'), parser + '\n' + runtime)
let html = fs.readFileSync(path.join(shared, 'browser.html'), 'utf8').replace('Lighting production source QA', 'Protocol production source QA')
fs.writeFileSync(path.join(__dirname, 'browser.html'), html)
let host = fs.readFileSync(path.join(shared, 'browser-host.cjs'), 'utf8')
  .replaceAll('tests/dmx-ui-refactor-2026-10-18', 'tests/control-protocol-refactor-2026-10-18')
  .replaceAll('LIGHTING_QA_PORT', 'PROTOCOL_QA_PORT')
  .replace("'baseline/source'", "'baseline'")
  .replace("'pages/dmx-address/dmx-address.js'", "'pages/control-protocol/detail.js'")
host = host.replace(/^\s*if \(!\/\^pages[^\n]+Invalid entry[^\n]+$/m, "      if (!['pages/control-protocol/detail.js', 'pages/control-protocol/index.js'].includes(entry)) throw Error('Invalid entry')")
fs.writeFileSync(path.join(__dirname, 'browser-host.cjs'), host)
const driver = fs.readFileSync(path.join(shared, 'browser-driver.cjs'), 'utf8')
  .replaceAll('tests/dmx-ui-refactor-2026-10-18', 'tests/control-protocol-refactor-2026-10-18')
  .replaceAll('LIGHTING_QA_PORT', 'PROTOCOL_QA_PORT')
  .replaceAll('tunebuddy-lighting-qa-', 'tunebuddy-protocol-qa-')
  .replaceAll('Lighting browser adapter', 'Protocol browser adapter')
fs.writeFileSync(path.join(__dirname, 'browser-driver.cjs'), driver)
console.log('Prepared protocol browser adapter from production WXML/JS/WXSS and existing tested parser')

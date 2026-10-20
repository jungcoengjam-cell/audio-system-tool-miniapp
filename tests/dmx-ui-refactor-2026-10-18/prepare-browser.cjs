const fs = require('node:fs')
const path = require('node:path')
const sourceFile = path.join(__dirname, '../project-wiring-redesign-2026-10-16/browser.js')
const source = fs.readFileSync(sourceFile, 'utf8')
// Reuse the existing tested WXML parser, not a hand-written copy of the product UI.
const prefix = source.slice(0, source.indexOf('function box(node)'))
  .replace("if (node.tag === 'canvas') return ''", '')
  .replace("{ image: 'img', navigator: 'a' }", "{ image: 'img', navigator: 'a' }")
  // Treat expressions as a single text token. A comparison inside {{...}} is
  // JavaScript, not the beginning of an XML element; restore it before evaluation.
  .replace('function parse(markup) {', "function parse(markup) {\n  markup = markup.replace(/\\{\\{[\\s\\S]*?\\}\\}/g, block => block.replace(/</g, '\\uE000'))")
  .replace('for (const token of tokens) {', "for (const rawToken of tokens) {\n    const token = rawToken.replace(/\\uE000/g, '<')")
const host = fs.readFileSync(path.join(__dirname, 'browser-runtime.js'), 'utf8')
fs.writeFileSync(path.join(__dirname, 'browser.js'), prefix + '\n' + host)
console.log('Prepared source-backed WXML browser adapter')

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function readTemplate(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function extractBalancedElement(source, startIndex, tagName) {
  const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'g')
  tokenPattern.lastIndex = startIndex
  let depth = 0
  let token

  while ((token = tokenPattern.exec(source))) {
    const closing = token[0].startsWith(`</${tagName}`)
    const selfClosing = /\/\s*>$/.test(token[0])
    if (closing) depth -= 1
    else if (!selfClosing) depth += 1
    if (depth === 0) return source.slice(startIndex, tokenPattern.lastIndex)
  }
  throw new Error(`Unclosed <${tagName}> at offset ${startIndex}`)
}

function findElementBlocks(source, tagName, openingTagPredicate) {
  const openingPattern = new RegExp(`<${tagName}\\b[^>]*>`, 'g')
  const blocks = []
  let match

  while ((match = openingPattern.exec(source))) {
    if (!openingTagPredicate(match[0])) continue
    blocks.push({
      openingTag: match[0],
      source: extractBalancedElement(source, match.index, tagName),
    })
  }
  return blocks
}

function readButtons(source) {
  return [...source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    attributes: match[1],
    content: match[2],
  }))
}

function buttonsBoundTo(source, handler) {
  const binding = new RegExp(`\\bbindtap="${handler}"`)
  return readButtons(source).filter((button) => binding.test(button.attributes))
}

function assertDetailsFooter(relativePath, saveHandler) {
  const source = readTemplate(relativePath)
  const isDetails = (openingTag) => /\bwx:elif="\{\{\s*projectStep\s*===\s*'details'\s*\}\}"/.test(openingTag)
  const detailsBodies = findElementBlocks(source, 'scroll-view', isDetails)
  const detailsFooters = findElementBlocks(source, 'view', (openingTag) => (
    isDetails(openingTag) && /\bclass="[^"]*project-footer[^"]*"/.test(openingTag)
  ))

  assert.equal(detailsBodies.length, 1, `${relativePath}: locate exactly one projectStep details body`)
  assert.equal(detailsFooters.length, 1, `${relativePath}: locate exactly one projectStep details footer`)
  assert(!/更换项目/.test(detailsBodies[0].source),
    `${relativePath}: details body should not offer a project replacement action`)
  assert(!/更换项目/.test(detailsFooters[0].source),
    `${relativePath}: details footer should not offer a project replacement action`)

  const footer = detailsFooters[0].source
  const backButtons = buttonsBoundTo(footer, 'backToProjectList')
  assert.equal(backButtons.length, 1,
    `${relativePath}: details footer must have exactly one backToProjectList button`)
  assert.equal(backButtons[0].content.replace(/<[^>]*>/g, '').trim(), '返回项目列表',
    `${relativePath}: details back button should be labeled 返回项目列表`)

  const saveButtons = buttonsBoundTo(footer, saveHandler)
  assert.equal(saveButtons.length, 1,
    `${relativePath}: details footer must preserve its ${saveHandler} save button`)
}

function assertOrdinaryConfirmFooter(relativePath, backHandler, saveHandler) {
  const source = readTemplate(relativePath)
  const footerBlocks = findElementBlocks(source, 'view', (openingTag) => (
    /\bclass="[^"]*project-footer[^"]*"/.test(openingTag)
  ))
  assert.equal(footerBlocks.length, 1, `${relativePath}: locate exactly one project-save footer`)

  const confirmBlocks = findElementBlocks(footerBlocks[0].source, 'block', (openingTag) => (
    /\bwx:elif="\{\{\s*projectDialogStep\s*==\s*'confirm'\s*\}\}"/.test(openingTag)
  ))
  assert.equal(confirmBlocks.length, 1, `${relativePath}: locate the ordinary confirmation footer branch`)
  const confirmFooter = confirmBlocks[0].source
  const backButtons = buttonsBoundTo(confirmFooter, backHandler)
  assert.equal(backButtons.length, 1, `${relativePath}: confirmation must retain its project-list back action`)
  assert(backButtons[0].content.replace(/<[^>]*>/g, '').includes('返回项目列表'),
    `${relativePath}: ordinary confirmation should include the 返回项目列表 label`)
  assert.equal(buttonsBoundTo(confirmFooter, saveHandler).length, 1,
    `${relativePath}: confirmation must retain its normal save action`)
}

const detailsTemplates = [
  ['pages/gain-structure/gain-overlays.wxml', 'saveProjectConfiguration'],
  ['pages/limiter/limiter-overlays.wxml', 'saveProjectConfiguration'],
  ['pages/spl/spl.wxml', 'saveProjectConfiguration'],
]

for (const [template, saveHandler] of detailsTemplates) assertDetailsFooter(template, saveHandler)

const ordinaryConfirmTemplates = [
  ['pages/audio-wiring/wiring-overlays.wxml', 'returnToProjectSelection', 'saveProjectTarget'],
  ['pages/camera/camera-overlays.wxml', 'returnToCameraProjectSelection', 'saveCameraProjectTarget'],
  ['pages/cable/cable-overlays.wxml', 'returnToProjectSelection', 'saveProjectTarget'],
  ['pages/led-screen/led-overlays.wxml', 'returnToProjectSelection', 'saveProjectTarget'],
]

for (const [template, backHandler, saveHandler] of ordinaryConfirmTemplates) {
  assertOrdinaryConfirmFooter(template, backHandler, saveHandler)
}

process.stdout.write('Project-save details-return regression passed (3 details footers, 4 ordinary confirmation footers)\n')

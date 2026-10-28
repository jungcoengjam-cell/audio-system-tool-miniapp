'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const disclosureCases = [
  {
    file: 'pages/basis/detail.wxml',
    id: 'basis-full-content',
    state: 'showFullExplanation',
    control: 'basis-full-toggle',
    content: ['basis-full-panel', 'presentation.article.completeExplanation.limitRows'],
  },
  {
    file: 'pages/knowledge/detail.wxml',
    id: 'knowledge-formula-content',
    state: 'formulaExpanded',
    content: ['distance-formula-detail', 'article.formulaNote', 'wx:for="{{article.sections}}"'],
  },
  {
    file: 'pages/projects/favorite-detail.wxml',
    id: 'favorite-raw-content',
    state: 'rawParametersVisible',
    content: ['favorite-raw-value', 'favorite.parametersText'],
  },
  {
    file: 'pages/troubleshoot/index.wxml',
    id: 'troubleshoot-path-content',
    state: 'pathExpanded',
    content: ['ts-path-list', 'wx:for="{{history}}"', 'bindtap="editStep"'],
  },
  {
    file: 'pages/led-screen/led-screen.wxml',
    id: 'led-viewing-details-content',
    state: 'viewingDetailsExpanded',
    content: ['viewing-details', 'result.viewingDetailsText'],
  },
  {
    file: 'pages/control-protocol/detail.wxml',
    id: 'control-protocol-manual-write-content',
    state: 'showManualWrites',
    content: ['expanded-command-list', 'manualWriteCommands', 'copyManualCommand'],
  },
]

for (const item of disclosureCases) {
  const source = fs.readFileSync(path.join(root, item.file), 'utf8')
  const openingTag = source.split(/\r?\n/).find((line) => line.includes(`id="${item.id}"`))
  assert.ok(openingTag, `${item.file} keeps the disclosure wrapper in the template`)
  assert.ok(openingTag.includes('class="disclosure-motion '), `${item.file} uses the shared disclosure grid`)
  assert.ok(openingTag.includes(`{{${item.state} ? 'disclosure-motion-open' : ''}}`),
    `${item.file} maps its existing boolean directly to the expanded class`)
  assert.ok(openingTag.includes(`aria-hidden="{{!${item.state}}}"`),
    `${item.file} hides collapsed contents from accessibility navigation`)
  assert.ok(!openingTag.includes('wx:if='), `${item.file} does not destroy the disclosure subtree while closing`)
  assert.ok(source.includes('<view class="disclosure-motion-inner">'), `${item.file} clips content inside the grid row`)
  for (const marker of item.content) assert.ok(source.includes(marker), `${item.file} retains ${marker}`)
  if (item.control) {
    const control = source.split(/\r?\n/).find((line) => line.includes(item.control))
    assert.ok(control && control.includes('aria-expanded="{{showFullExplanation}}"')
      && control.includes(`aria-controls="${item.id}"`), 'basis disclosure keeps its expanded/control relationship')
  }
}

const appStyles = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
assert.ok(appStyles.startsWith('@import "styles/disclosure-motion.wxss";'), 'the shared motion style loads globally')
const motionStyles = fs.readFileSync(path.join(root, 'styles/disclosure-motion.wxss'), 'utf8')
assert.match(motionStyles, /grid-template-rows:minmax\(0,0fr\)/)
assert.match(motionStyles, /\.disclosure-motion-open\{grid-template-rows:minmax\(0,1fr\);opacity:1\}/)
assert.match(motionStyles, /opacity:0;transition:grid-template-rows 210ms/)
assert.match(motionStyles, /\.disclosure-motion-inner\{min-height:0;overflow:hidden\}/)
assert.match(motionStyles, /\.disclosure-motion:not\(\.disclosure-motion-open\)\{pointer-events:none\}/)
assert.match(motionStyles, /prefers-reduced-motion:reduce\)\{\.disclosure-motion\{transition:none!important\}\}/)

console.log('Disclosure motion regression checks passed (all six boolean sections, content preservation, accessibility state, and reduced motion).')

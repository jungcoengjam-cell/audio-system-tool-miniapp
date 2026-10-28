'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { BASIS_TOOLS, getBasisTool } = require('../utils/tool-registry')
const { buildBasisPresentation } = require('../pages/basis/presentation')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/basis/detail.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/basis/detail.wxss'), 'utf8')

function joinRows(rows) {
  return rows.flatMap((row) => row.segments.map((segment) => segment.text)).join('')
}

function formulaSegments(rows) {
  return rows.flatMap((row) => row.segments).filter((segment) => segment.type === 'formula')
}

assert.equal(BASIS_TOOLS.length, 6, 'the editorial template still covers the six calculation basis articles')

for (const tool of BASIS_TOOLS) {
  const basisTool = getBasisTool(tool.id)
  const presentation = buildBasisPresentation(basisTool)
  const complete = presentation.completeExplanation
  assert.deepEqual(Object.keys(complete), ['what', 'method', 'inputs', 'sourceSummary', 'limits'],
    `${tool.id} keeps the original completeExplanation object shape`)
  assert.deepEqual(complete, {
    what: basisTool.basis.what,
    method: basisTool.basis.method,
    inputs: basisTool.basis.inputs,
    sourceSummary: basisTool.basis.sourceSummary,
    limits: basisTool.basis.limits,
  }, `${tool.id} keeps every completeExplanation source value unchanged`)
  const rawFields = [
    ['quick method', presentation.quick.method, joinRows(presentation.article.quickMethodRows)],
    ['quick source', presentation.quick.source, joinRows(presentation.article.quickSourceRows)],
    ['complete method', complete.method, joinRows(presentation.article.completeExplanation.methodRows)],
    ['complete inputs', complete.inputs, joinRows(presentation.article.completeExplanation.inputRows)],
    ['complete source', complete.sourceSummary, joinRows(presentation.article.completeExplanation.sourceRows)],
    ['complete limits', complete.limits, joinRows(presentation.article.completeExplanation.limitRows)],
  ]
  for (const [label, raw, displayed] of rawFields) {
    assert.equal(displayed, raw, `${tool.id} ${label} reassembles to the exact source string`)
  }

  for (const row of presentation.article.quickParameterRows) {
    const source = presentation.quick.parameters.find((parameter) => parameter.label === row.label)
    assert.ok(source, `${tool.id} retains the original parameter label`)
    assert.equal(joinRows(row.valueRows), source.value, `${tool.id} ${row.label} value is unchanged`)
  }

  const allFormulaSegments = [
    ...formulaSegments(presentation.article.quickMethodRows),
    ...formulaSegments(presentation.article.quickSourceRows),
    ...presentation.article.quickParameterRows.flatMap((row) => formulaSegments(row.valueRows)),
    ...formulaSegments(presentation.article.completeExplanation.methodRows),
    ...formulaSegments(presentation.article.completeExplanation.inputRows),
    ...formulaSegments(presentation.article.completeExplanation.sourceRows),
    ...formulaSegments(presentation.article.completeExplanation.limitRows),
  ]
  assert.ok(allFormulaSegments.length > 0, `${tool.id} keeps marked formula spans in the formula presentation`)
  assert.equal(new Set(allFormulaSegments.map((segment) => segment.id)).size, allFormulaSegments.length,
    `${tool.id} formula IDs are unique across the visible article`)
}

for (const field of ['what', 'method', 'inputs', 'sourceSummary', 'limits']) {
  assert.ok(wxml.includes(`data-basis-field="${field}"`), `full explanation exposes ${field} for field-level DOM checks`)
}
assert.ok(wxml.includes('class="basis-formula-scroll" scroll-x="true"'), 'formula blocks use horizontal scrolling')
assert.ok(wxml.includes('data-basis-formula-id="{{segment.id}}"'), 'formula spans expose stable IDs for visual checks')
assert.ok(wxss.includes('.basis-formula-text{') && /font-size:15px/.test(wxss), 'formula type stays at least 15px')
assert.ok(/white-space:nowrap/.test(wxss), 'formula text cannot wrap')
assert.ok(wxss.includes('.basis-full-copy{color:var(--theme-text);font-size:15px;line-height:1.7'),
  'full explanation body copy keeps readable primary text styling')
assert.ok(wxss.includes('.basis-full-reference-copy{color:var(--theme-text-secondary)}')
  && wxml.includes('basis-full-reference-copy" data-basis-field="sourceSummary"'),
  'the complete source summary keeps secondary text styling')
assert.ok(wxss.includes('.basis-full-label{margin-bottom:7px;color:var(--theme-accent-text)'),
  'full explanation subheads have a visible accent color hierarchy')
assert.ok(wxss.includes('.basis-reference-copy{color:var(--theme-text-secondary);font-size:15px;line-height:1.7'),
  'sources and limits use readable secondary styling')
assert.ok(wxss.includes('.basis-formula-text{display:inline-block;min-width:max-content;color:var(--theme-accent-text)'),
  'formula text has a distinct accent hierarchy')
const formulaScrollRule = wxss.match(/\.basis-formula-scroll\{([^}]+)\}/)?.[1] || ''
assert.ok(/min-height:48px/.test(formulaScrollRule) && /padding:12px 0/.test(formulaScrollRule),
  'formula rows keep a readable minimum height with vertical-only spacing')
const compactFormulaRule = wxss.match(/\.basis-formula-scroll-compact\{([^}]+)\}/)?.[1] || ''
assert.ok(/min-height:44px/.test(compactFormulaRule) && /padding:10px 0/.test(compactFormulaRule),
  'compact formula rows keep a 44px minimum and vertical-only spacing')
assert.ok(!/(?:background|border|border-left|border-radius)\s*:/.test(formulaScrollRule),
  'formula rows stay text-like without a fill, colored rule, or rounded frame')
assert.ok(!/(?:background|border|border-left|border-radius)\s*:/.test(compactFormulaRule),
  'compact formula rows also stay free of box styling')
assert.ok(wxml.includes('长公式可左右滑动阅读'), 'the formula section explains horizontal scrolling once')
assert.ok(wxml.includes('class="disclosure-motion {{showFullExplanation ? \'disclosure-motion-open\' : \'\'}}"'),
  'the existing permanent disclosure wrapper remains in place')
assert.ok(wxml.includes('aria-hidden="{{!showFullExplanation}}"'), 'collapsed full explanation remains hidden from accessibility navigation')
assert.ok(wxml.includes('aria-expanded="{{showFullExplanation}}"') && wxml.includes('aria-controls="basis-full-content"'),
  'the expansion control keeps its accessibility relationship')
assert.ok(wxml.includes('bindtap="openTool"'), 'the open-tool navigation action remains')

console.log('Basis detail editorial layout checks passed (six tools, exact source reconstruction, formula IDs/scroll styles, disclosure, and navigation).')

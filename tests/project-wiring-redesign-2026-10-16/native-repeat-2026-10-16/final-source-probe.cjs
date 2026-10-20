'use strict'

// Source-only check of the frozen project-wiring WXML/compiler contract.
// It inspects structure and attribute names, not generated WCC variable IDs.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '../../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const hashFile = (relative) => crypto.createHash('sha256').update(read(relative)).digest('hex')

function parseWxml(source) {
  const rootNode = { tag: '#root', attrs: {}, children: [], parent: null, start: 0, contentStart: 0, closeStart: source.length, end: source.length }
  const stack = [rootNode]
  const tagPattern = /<\/?([A-Za-z][\w-]*)\b[^>]*>/g
  for (const match of source.matchAll(tagPattern)) {
    const raw = match[0]
    const tag = match[1]
    if (raw.startsWith('</')) {
      let index = stack.length - 1
      while (index > 0 && stack[index].tag !== tag) index--
      if (index > 0) {
        const node = stack[index]
        node.closeStart = match.index
        node.end = match.index + raw.length
        stack.length = index
      }
      continue
    }
    const nameEnd = raw.indexOf(tag) + tag.length + 1
    const attrText = raw.slice(nameEnd, -1).replace(/\/\s*$/, '')
    const attrs = Object.fromEntries([...attrText.matchAll(/([^\s=]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]))
    const node = { tag, attrs, children: [], parent: stack.at(-1), start: match.index, contentStart: match.index + raw.length, closeStart: source.length, end: source.length }
    node.parent.children.push(node)
    if (!/\/\s*>$/.test(raw)) stack.push(node)
  }
  return rootNode
}

function walk(node, predicate, found = []) {
  if (predicate(node)) found.push(node)
  for (const child of node.children) walk(child, predicate, found)
  return found
}

function hasClass(node, token) { return String(node.attrs.class || '').split(/\s+/).includes(token) }
function descendants(node, predicate) { return node.children.flatMap((child) => walk(child, predicate)) }
function ancestors(node) {
  const result = []
  for (let parent = node.parent; parent; parent = parent.parent) result.push(parent)
  return result
}
function eventAttributes(node) {
  return Object.fromEntries(Object.entries(node.attrs).filter(([name]) => /^(?:bind|catch)(?:tap|touchstart|touchmove|touchend|touchcancel)$/.test(name)))
}
function assertCatchTapOnly(node, label) {
  const events = eventAttributes(node)
  assert.deepEqual(Object.keys(events), ['catchtap'], `${label} should expose catchtap only`)
}
function attrsForCompiledNode(line) {
  const match = line.match(/=_mz\(z,'([^']+)',\[([^\]]*)\],\[\],/)
  if (!match) return null
  return { tag: match[1], properties: [...match[2].matchAll(/'([^']+)'/g)].map((item) => item[1]), sourceLine: line }
}
function compiledNodes(source) {
  return source.split(/\r?\n/).map(attrsForCompiledNode).filter(Boolean)
}

const sourceFiles = [
  'pages/project-wiring/workspace-ui.js',
  'pages/project-wiring/workspace.wxml',
  'pages/project-wiring/workspace.wxss',
  'pages/project-wiring/index.js',
  'pages/project-wiring/index.wxml',
  'pages/project-wiring/index.wxss',
  'pages/project-wiring/report.js',
]
const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, hashFile(file)]))
const compileRelative = 'tests/project-wiring-redesign-2026-10-16/native-repeat-2026-10-16/final-compile'
const compile = JSON.parse(read(`${compileRelative}/compile.json`))
const wccText = read(`${compileRelative}/wxml.compiled.txt`)
const currentWorkspaceWxml = read('pages/project-wiring/workspace.wxml')
const currentIndexWxml = read('pages/project-wiring/index.wxml')
const indexJs = read('pages/project-wiring/index.js')
const workspaceTree = parseWxml(currentWorkspaceWxml)
const indexTree = parseWxml(currentIndexWxml)

assert.ok(compile.executions.every((item) => item.exitCode === 0 && !item.error), 'official WCC and WCSC compile must succeed')
for (const [file, hash] of Object.entries(compile.sources)) assert.equal(hashFile(file), hash, `final compile input ${file} must match current source bytes`)

const rowNodes = walk(workspaceTree, (node) => node.tag === 'view' && hasClass(node, 'workspace-swipe-row'))
assert.equal(rowNodes.length, 2, 'expect device and line parent swipe rows')
for (const row of rowNodes) {
  const events = eventAttributes(row)
  for (const name of ['bindtouchstart', 'bindtouchmove', 'bindtouchend', 'bindtouchcancel']) assert.ok(events[name], `parent swipe row requires ${name}`)
  assert.equal(events.catchtap, 'stopEvent', 'parent row should stop bubbling tap after child action')
  assert.ok(row.attrs['data-swipe-id'], 'parent swipe row must expose the swipe identity')
}

const deleteButtons = walk(workspaceTree, (node) => node.tag === 'button' && hasClass(node, 'workspace-swipe-delete'))
assert.equal(deleteButtons.length, 2, 'expect one Delete action for device and line rows')
for (const button of deleteButtons) {
  assertCatchTapOnly(button, 'Delete button')
  assert.equal(button.attrs.catchtap, 'deleteWorkspaceRecord')
  assert.ok(button.attrs['data-delete-type'] && button.attrs['data-id'])
  assert.ok(ancestors(button).some((parent) => parent.tag === 'view' && hasClass(parent, 'workspace-swipe-row')), 'Delete button must remain inside its swipe row')
}

const connectButtons = walk(workspaceTree, (node) => node.tag === 'button' && hasClass(node, 'workspace-connect-button'))
assert.equal(connectButtons.length, 1, 'expect one Connect button in the device row')
assertCatchTapOnly(connectButtons[0], 'Connect button')
assert.equal(connectButtons[0].attrs.catchtap, 'connectDevice')
assert.ok(ancestors(connectButtons[0]).some((parent) => parent.tag === 'view' && hasClass(parent, 'workspace-swipe-row')), 'Connect button must remain inside the swipe row')

const wccNodes = compiledNodes(wccText)
const compiledRows = wccNodes.filter((node) => node.tag === 'view' && node.properties.includes('data-swipe-id'))
assert.equal(compiledRows.length, 2, 'WCC should emit both swipe parent rows')
for (const row of compiledRows) {
  for (const name of ['bindtouchstart', 'bindtouchmove', 'bindtouchend', 'bindtouchcancel', 'catchtap']) assert.ok(row.properties.includes(name), `compiled row should contain ${name}`)
}
const compiledDeleteButtons = wccNodes.filter((node) => node.tag === 'button' && node.properties.includes('data-delete-type'))
assert.equal(compiledDeleteButtons.length, 2, 'WCC should emit both Delete buttons by their semantic data attribute')
for (const button of compiledDeleteButtons) {
  assert.ok(button.properties.includes('catchtap'), 'compiled Delete button should include catchtap')
  assert.ok(!button.properties.some((name) => /^(?:bind|catch)touch(?:start|move|end|cancel)$/.test(name)), 'compiled Delete button should not shadow the row touch path')
}
const compiledConnect = wccNodes.filter((node) => node.tag === 'button' && node.properties.includes('data-action-type') && !node.properties.includes('data-delete-type'))
assert.equal(compiledConnect.length, 1, 'WCC should emit one non-Delete action button (Connect)')
assert.ok(compiledConnect[0].properties.includes('catchtap'), 'compiled Connect button should include catchtap')
assert.ok(!compiledConnect[0].properties.some((name) => /^(?:bind|catch)touch(?:start|move|end|cancel)$/.test(name)), 'compiled Connect button should not shadow the row touch path')
assert.equal((wccText.match(/Z\(\[3,'deleteWorkspaceRecord'\]\)/g) || []).length, 2, 'WCC should emit both Delete handler references')
assert.equal((wccText.match(/Z\(\[3,'connectDevice'\]\)/g) || []).length, 1, 'WCC should emit the Connect handler reference')

const reportFooters = walk(indexTree, (node) => node.tag === 'view' && hasClass(node, 'wiring-report-actions'))
assert.equal(reportFooters.length, 1, 'report preview should have one footer actions container')
const footerButtons = descendants(reportFooters[0], (node) => node.tag === 'button')
assert.equal(footerButtons.length, 2, 'report footer should expose exactly two actions')
const footerActions = footerButtons.map((button) => ({ method: button.attrs.bindtap, label: currentIndexWxml.slice(button.contentStart, button.closeStart).replace(/<[^>]*>/g, '').trim() }))
assert.deepEqual(footerActions.map((item) => item.method), ['shareReportImage', 'saveReportImage'])
assert.match(indexJs, /shareReportImage\(\)\s*\{\s*shareGeneratedImage\(this\.data\.reportImagePath\)/, 'forward action should pass the rendered report image to shareGeneratedImage')
assert.match(indexJs, /saveReportImage\(\)\s*\{\s*this\.startReportSaveJob\(\[this\.data\.reportPageIndex\],\s*'single'\)/, 'save action should start a one-image local-save job')
assert.ok(indexJs.includes('wx.saveImageToPhotosAlbum('), 'local-save job should use the photo-album API')

const closeButtons = walk(indexTree, (node) => node.tag === 'button' && hasClass(node, 'wiring-close-button') && node.attrs.bindtap === 'closeReportPreview')
assert.equal(closeButtons.length, 1, 'report close control should exist once')
assert.ok(reportFooters[0].start > closeButtons[0].start, 'close control should appear before and outside the footer actions')
assert.ok(ancestors(closeButtons[0]).some((parent) => parent.tag === 'view' && hasClass(parent, 'wiring-sheet-heading')), 'close control should be in the sheet heading')
const reportBackdrop = walk(indexTree, (node) => node.tag === 'view' && hasClass(node, 'wiring-backdrop') && node.attrs.bindtap === 'closeReportPreview')
assert.equal(reportBackdrop.length, 1, 'report backdrop should close the preview')
const reportSheet = walk(indexTree, (node) => node.tag === 'view' && hasClass(node, 'wiring-report-sheet'))
assert.equal(reportSheet.length, 1)
assert.equal(reportSheet[0].attrs.catchtap, 'stopEvent', 'taps inside the report sheet should not close it through the backdrop')

const swipers = walk(indexTree, (node) => node.tag === 'swiper' && hasClass(node, 'wiring-report-swiper'))
assert.equal(swipers.length, 1)
assert.equal(swipers[0].attrs.current, '{{reportPageIndex}}')
assert.equal(swipers[0].attrs.bindchange, 'onReportPageSwipe')
assert.match(indexJs, /onReportPageSwipe\(event\)\s*\{[\s\S]*?event\.detail\.current[\s\S]*?this\.showReportPage\(index\)/, 'swiper change handler should consume current index and update the selected report page')

const result = {
  scope: 'Read-only source and official WCC/WCSC contract probe. No WeChat runtime, physical-device UI, auth flow, or user records were exercised.',
  compile: {
    runAt: compile.runAt,
    outputDirectory: compileRelative,
    nativeRuntime: compile.nativeRuntime,
    physicalDevice: compile.physicalDevice,
    results: compile.executions.map(({ name, exitCode, error }) => ({ name, exitCode, error })),
    wxmlCompiledSha256: crypto.createHash('sha256').update(wccText).digest('hex'),
    compiledSourceHashes: compile.sources,
  },
  currentProductionSourceHashes: sourceHashes,
  swipeBindings: {
    parentRowCount: rowNodes.length,
    deleteButtonCount: deleteButtons.length,
    connectButtonCount: connectButtons.length,
    rowEventBindings: eventAttributes(rowNodes[0]),
    deleteButtonEventBindings: deleteButtons.map(eventAttributes),
    connectButtonEventBindings: eventAttributes(connectButtons[0]),
    wccDeleteSchemasByDataAttribute: compiledDeleteButtons.map((node) => node.properties),
    wccConnectSchemaByActionAttribute: compiledConnect.map((node) => node.properties),
  },
  reportPreview: {
    footerActionCount: footerButtons.length,
    footerActions,
    closeInHeadingOutsideFooter: true,
    backdropClosesPreview: true,
    sheetStopsBackdropTap: true,
    swiperCurrentBinding: swipers[0].attrs.current,
    swiperChangeHandler: swipers[0].attrs.bindchange,
    handlerReadsEventDetailCurrentAndUpdatesPage: true,
  },
  assertions: 'PASS',
}

const outputPath = path.join(__dirname, 'final-source-probe.json')
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ outputPath, assertions: result.assertions, compileResults: result.compile.results, sourceHashes: result.currentProductionSourceHashes, swipeBindings: result.swipeBindings, reportPreview: result.reportPreview }, null, 2))

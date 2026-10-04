const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const baseline = require('./ui-test-first.json')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function normalizeLineEndings(source) {
  return source.replace(/\r\n?/g, '\n')
}

function expandIncludes(source, fromFile, stack = []) {
  return source.replace(/<include\s+src="([^"]+)"\s*\/>/g, (_match, includePath) => {
    const resolved = path.resolve(path.dirname(fromFile), includePath)
    assert(resolved.startsWith(`${root}${path.sep}`), `WXML include escapes workspace: ${includePath}`)
    assert(!stack.includes(resolved), `WXML include cycle: ${includePath}`)
    return expandIncludes(fs.readFileSync(resolved, 'utf8'), resolved, [...stack, resolved])
  })
}

for (const [relativePath, expectedHash] of Object.entries(baseline.expandedWxmlSha256)) {
  assert.match(expectedHash, /^[0-9a-f]{64}$/, `missing test-first WXML hash: ${relativePath}`)
  const file = path.join(root, relativePath)
  const source = fs.readFileSync(file, 'utf8')
  const manualSource = relativePath === 'pages/venue/venue.wxml'
    ? source.replace(/\r?\n[ \t]*\r?\n[ \t]*<include src="\.\.\/common\/operation-confirmation\.wxml"\s*\/>[ \t]*\r?\n[ \t]*\r?\n/, '\r\n\r\n') : source
  const expanded = expandIncludes(manualSource, file)
  const dmxLayoutPages = new Set([
    'pages/dmx-layout/dmx-layout.wxml',
    'pages/dmx-layout-landscape/dmx-layout-landscape.wxml'
  ])
  let hashInput = normalizeLineEndings(expanded)
  if (dmxLayoutPages.has(relativePath)) {
    const newStart = '<view wx:if="{{batchVisible}}" class="batch-sheet-overlay"><view class="batch-sheet-backdrop" bindtap="closeBatchPlacement"></view><scroll-view class="batch-sheet" scroll-y="{{isLandscape}}" enhanced show-scrollbar="{{false}}" catchtap="stopTap"><view class="batch-sheet-content">'
    const oldStart = '<view wx:if="{{batchVisible}}" class="batch-sheet-overlay" bindtap="closeBatchPlacement" catchtouchmove="preventTouchMove"><view class="batch-sheet" catchtap="stopTap">'
    const newEnd = '</view></view></scroll-view></view>'
    const oldEnd = '</view></view></view>'
    assert.equal(hashInput.split(newStart).length - 1, 1,
      `expected one complete approved batch wrapper: ${relativePath}`)
    assert.equal(hashInput.split(newEnd).length - 1, 1,
      `expected one complete approved batch wrapper close: ${relativePath}`)
    assert.equal((hashInput.match(/<scroll-view class="batch-sheet" scroll-y="\{\{isLandscape\}\}" enhanced show-scrollbar="\{\{false\}\}" catchtap="stopTap"><view class="batch-sheet-content">/g) || []).length, 1,
      `expected one approved native batch scroll structure: ${relativePath}`)
    assert.equal((hashInput.match(/<view class="batch-sheet-backdrop" bindtap="closeBatchPlacement"><\/view>/g) || []).length, 1,
      `expected one approved batch backdrop: ${relativePath}`)
    assert.equal((hashInput.match(/物理排列方向/g) || []).length, 1,
      `expected one approved direction label change: ${relativePath}`)
    assert.equal((hashInput.match(/（同杆分组均匀交错）/g) || []).length, 1,
      `expected one approved interleaving label change: ${relativePath}`)
    hashInput = hashInput
      .replace(newStart, oldStart)
      .replace(newEnd, oldEnd)
      .replace('物理排列方向', '物理排列')
      .replace('（同杆分组均匀交错）', '（按地址排序）')
    if (relativePath === 'pages/dmx-layout/dmx-layout.wxml') {
      const newCanvas = 'class="result-report-canvas-offscreen"\nwidth="{{exportCanvasWidth}}"\nheight="{{exportCanvasHeight}}"\nstyle="width:{{exportCanvasWidth}}px;height:{{exportCanvasHeight}}px;"'
      const oldCanvas = 'class="result-report-canvas-offscreen"\nwidth="{{canvasWidth}}"\nheight="{{canvasHeight}}"\nstyle="width:{{canvasWidth}}px;height:{{canvasHeight}}px;"'
      assert.equal(hashInput.split(newCanvas).length - 1, 1, `expected one independent export canvas: ${relativePath}`)
      hashInput = hashInput.replace(newCanvas, oldCanvas)
    } else {
      const newCanvas = 'class="export-canvas" width="{{exportCanvasWidth}}" height="{{exportCanvasHeight}}" style="width:{{exportCanvasWidth}}px;height:{{exportCanvasHeight}}px;"'
      const oldCanvas = 'class="export-canvas" width="{{canvasWidth}}" height="{{canvasHeight}}" style="width:{{canvasWidth}}px;height:{{canvasHeight}}px;"'
      assert.equal(hashInput.split(newCanvas).length - 1, 1, `expected one independent export canvas: ${relativePath}`)
      hashInput = hashInput.replace(newCanvas, oldCanvas)
    }
  }
  const projectSaveButtonCounts = new Map([
    ['pages/cable/cable.wxml', 1],
    ['pages/gain-structure/gain-structure.wxml', 1],
    ['pages/spl/spl.wxml', 1],
    ['pages/venue/venue.wxml', 2],
  ])
  if (projectSaveButtonCounts.has(relativePath)) {
    const saveButtons = [...hashInput.matchAll(
      /<button\b(?=[^>]*\bbindtap="saveToActiveProject")[^>]*>([\s\S]*?)<\/button>/g,
    )]
    assert.equal(saveButtons.length, projectSaveButtonCounts.get(relativePath),
      `unexpected project-save button count: ${relativePath}`)
    const approvedLabels = new Set([
      '\u4fdd\u5b58\u81f3\u9879\u76ee',
      '\u9009\u62e9\u9879\u76ee\u4fdd\u5b58',
    ])
    saveButtons.forEach(([button, label]) => {
      const normalizedLabel = label.trim()
      assert.equal(label, normalizedLabel, `project-save button has unexpected whitespace: ${relativePath}`)
      assert(approvedLabels.has(normalizedLabel), `unexpected project-save button label: ${relativePath}`)
    })
    for (const match of saveButtons.reverse()) {
      const [button, label] = match
      const buttonIndex = match.index
      const normalizedButton = button.replace(label, '\u52a0\u5165\u5f53\u524d\u9879\u76ee')
      hashInput = hashInput.slice(0, buttonIndex)
        + normalizedButton
        + hashInput.slice(buttonIndex + button.length)
    }
  }
  assert.equal(sha256(Buffer.from(hashInput)), expectedHash, `expanded WXML changed: ${relativePath}`)
}

assert.match(read('pages/venue/venue.wxml'), /operation-confirmation\.wxml/,
  'venue structured confirmation UI is missing')
assert.match(read('pages/common/operation-confirmation.wxml'), /confirmOperationField/,
  'venue confirmation template has no real confirm action')
assert.match(read('pages/common/operation-confirmation.wxml'), /!operationActive/,
  'venue confirmation template hides an invalidated operation')
assert.match(read('pages/common/operation-confirmation.wxml'), /endOperation/,
  'venue confirmation template has no explicit end action')
assert.match(read('pages/common/operation-confirmation.wxml'), /item\.confirmed/,
  'venue confirmation template must show confirmation state accurately')

const keptImagePath = path.join(root, 'assets/home/module-audio-wiring-catalog.png')
assert.equal(sha256(fs.readFileSync(keptImagePath)), baseline.xlrImageSha256, 'kept XLR image bytes changed')
assert(!fs.existsSync(path.join(root, 'pages/audio-wiring/assets/xlr.png')), 'duplicate XLR image still exists')
const wiringModel = read('pages/audio-wiring/wiring-model.js')
assert.equal((wiringModel.match(/image: '\/assets\/home\/module-audio-wiring-catalog\.png'/g) || []).length, 2,
  'XLR input/output options must both use the retained production asset')
assert(!wiringModel.includes('/pages/audio-wiring/assets/xlr.png'), 'wiring model still references the removed duplicate')

console.log('Package reclaim UI/resource equivalence passed (expanded WXML hashes and XLR asset identity).')

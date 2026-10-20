const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, clone } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

const root = path.resolve(__dirname, '../..')
const wxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.js'), 'utf8')
const failures = []

function check(name, fn) {
  try {
    fn()
    process.stdout.write(`PASS ${name}\n`)
  } catch (error) {
    failures.push(name)
    process.stderr.write(`FAIL ${name}\n${error.stack || error}\n`)
  }
}

function nativeControlAncestors() {
  const source = wxml.replace(/\{\{[\s\S]*?\}\}/g, '')
  const stack = []
  const tokens = source.match(/<\/?[\w:-]+(?:\s[^<>]*?)?\/?>/g) || []
  const catchName = /\bcatch(?:tap|touchstart|touchmove|touchend|touchcancel)\s*=/
  for (const token of tokens) {
    if (/^<\//.test(token)) {
      stack.pop()
      continue
    }
    const tag = token.match(/^<([\w:-]+)/)?.[1] || ''
    const selfClosing = /\/\s*>$/.test(token)
    const ancestry = [...stack, { tag, token }]
    if (['input', 'picker', 'textarea'].includes(tag)) {
      assert.equal(ancestry.some((node) => catchName.test(node.token)), false,
        `<${tag}> or an ancestor intercepts its native tap/touch`)
    }
    if (!selfClosing) stack.push({ tag, token })
  }
  assert.equal(stack.length, 0, 'WXML opening and closing tags remain balanced')
}

check('native input and picker activations have no catch-handler ancestors', nativeControlAncestors)

check('collapsed fixture cards open only from explicit display surfaces', () => {
  assert.equal((wxml.match(/bindtap="openFloatingCard"/g) || []).length, 2)
  assert.match(wxml, /class="fixture-thumb"[^>]*bindtap="openFloatingCard"/)
  assert.match(wxml, /class="address-chips"[^>]*bindtap="openFloatingCard"/)
  assert.doesNotMatch(wxml, /class="fixture-card[^>]*bindtap="openFloatingCard"/)
})

check('removed target-universe and secondary-action rows stay out of the main view', () => {
  assert.doesNotMatch(wxml, /fixture-universe-row|secondary-actions/)
  assert.doesNotMatch(wxss, /\.fixture-universe-row|\.secondary-actions|\.favorite-action/)
})

check('guide and report overlays retain their shared flex surface base', () => {
  assert.match(wxss, /\.fixture-channel-guide-sheet,\.result-report-preview-sheet\{[^}]*display:flex[^}]*box-sizing:border-box[^}]*background:var\(--surface\)[^}]*color:var\(--text\)/s)
})

check('swipe delete retains its red width and tracks actual move events', () => {
  assert.match(wxss, /\.swipe-delete\{[^}]*width:76px[^}]*background:#ff3b30/s)
  assert.match(wxss, /\.group-swipe-wrap\{[^}]*background:transparent/s)
  assert.match(wxml, /bindtouchmove="onGroupTouchMove"/)
  assert.match(wxml, /transform: translateX\(\{\{[^}]*swipeDragOffset[^}]*-76[^}]*\}\}px\)/)
  const runtime = createRuntime()
  runtime.seed()
  try {
    const main = runtime.make('main'), before = clone(main._calculationResult), writes = runtime.stats.writes
    const gesture = (x, end = false) => runtime.event({index:0}, {}, {target:{dataset:{}}, touches:end?[]:[{clientX:x,clientY:200}], changedTouches:[{clientX:x,clientY:200}]})
    main.onGroupTouchStart(gesture(200))
    main.onGroupTouchMove(gesture(180))
    assert.equal(main.data.swipeDragIndex, 0)
    assert.equal(main.data.swipeDragOffset, -20, 'first touchmove must produce a live offset')
    main.onGroupTouchMove(gesture(155))
    assert.equal(main.data.swipeDragOffset, -45, 'later touchmove must update before release')
    assert.equal(main.data.swipeDragging, true)
    main.onGroupTouchEnd(gesture(124, true))
    assert.equal(main.data.swipedGroupIndex, 0, 'release snaps open by the existing 76px delete layer')
    assert.equal(main.data.swipeDragging, false)
    main.openFloatingCard(runtime.event({index:0}))
    assert.equal(main.data.floatingVisible, false, 'a synthetic tap immediately after swipe cannot open the floating card')
    main.openModelPicker(runtime.event({index:0}))
    assert.equal(main.data.fixtureSearchOpen, false, 'a synthetic tap immediately after swipe cannot open the model picker')
    assert.deepEqual(main._calculationResult, before)
    assert.equal(runtime.stats.writes, writes)
  } finally { runtime.dispose() }
})

check('new-fixture confirmation is a dedicated calculated preview', () => {
  const start = wxml.indexOf('class="add-confirm-sheet"')
  const end = wxml.indexOf('</view>', start)
  const addSheet = wxml.slice(start, wxml.indexOf('\n  </view>', start))
  assert(start >= 0 && end > start)
  for (const value of ['重新选择', '添加灯组', 'addPreview.primaryName', 'addPreview.modelName', 'addPreview.rangeText', 'addPreview.totalChannels', 'pendingChange.quantityText']) {
    assert(addSheet.includes(value), `add confirmation is missing ${value}`)
  }
  assert(!addSheet.includes('effect-preview'), 'new additions should use the reference confirmation composition')
  assert.match(wxml, /fixture-search-thumb[^>]*>[\s\S]*?fixture-result-name/)
  assert.match(wxml, /catchlongpress="openFixtureChannelGuide"/)
})

check('start-address input retains its raw typing value until blur', () => {
  const start = js.indexOf('onBaseInput(event) {')
  const end = js.indexOf('\nonAllocationModePickerChange', start)
  const handler = js.slice(start, end)
  assert(handler.includes('this.setData({ startAddressDisplay: value })'))
  assert(!handler.includes('padStart'))
})

check('add preview recalculates quantity and reselect leaves storage untouched', () => {
  const runtime = createRuntime()
  runtime.seed()
  try {
    const main = runtime.make('main')
    const writesBefore = runtime.stats.writes
    const originalDraft = clone(main._draftScheme)
    main.onBaseInput(runtime.event({ key: 'startAddressText' }, { value: '17' }))
    assert.equal(main.data.startAddressDisplay, '17')
    main.cancelPendingChange()
    main.addGroup()
    main.selectFixture(runtime.event({ model: 'TL-SL323' }))
    assert.equal(main.data.pendingChange.kind, 'add')
    assert.equal(main.data.pendingChange.addPreview.fixtureChips.length, 1)
    main.onPendingQuantityInput(runtime.event({}, { value: '201' }))
    assert.equal(main.data.pendingChange.valid, false)
    assert.equal(runtime.stats.writes, writesBefore)
    main.onPendingQuantityInput(runtime.event({}, { value: '12' }))
    assert.equal(main.data.pendingChange.quantityText, '12')
    assert.equal(main.data.pendingChange.addPreview.fixtureCountValue, 12)
    assert.equal(main.data.pendingChange.addPreview.totalChannels, 24)
    assert.equal(main.data.pendingChange.addPreview.fixtureChips.length, 12)
    main.reselectPendingFixture()
    assert.equal(main.data.fixtureSearchOpen, true)
    assert.equal(main.data.pendingChange, null)
    assert.equal(runtime.stats.writes, writesBefore)
    assert.deepEqual(main._draftScheme, originalDraft)
  } finally {
    runtime.dispose()
  }
})

assert.equal(failures.length, 0, `Native UI regression failures: ${failures.join(', ')}`)

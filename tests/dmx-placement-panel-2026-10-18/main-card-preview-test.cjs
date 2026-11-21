const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime, stageLightingProductIndex } = require('../dmx-ui-refactor-2026-10-18/controller-runtime.cjs')

function seed(runtime, quantity) {
  const product = stageLightingProductIndex.get('TL-SL323')
  runtime.seed([{
    name: product.name,
    fixtureSource: 'library',
    fixtureModel: product.model,
    channelCount: '2',
    libraryChannelCount: '2',
    fixtureCount: String(quantity),
    targetUniverse: 'A',
  }])
}

function inspectPreview(group, expectedColumns, expectedLength) {
  assert.equal(group.cardChipColumns, expectedColumns)
  assert.equal(group.fixtureChips.length, 200, 'The full fixture list remains intact')
  assert.equal(group.cardFixtureChips.length, expectedLength, 'Only two preview rows are retained')
  const overflow = group.cardFixtureChips.filter(chip => chip.previewOverflow)
  assert.equal(overflow.length, 1, 'Overflow is indicated on exactly the last visible chip')
  const last = group.cardFixtureChips.at(-1)
  assert.equal(last.previewOverflow, true)
  assert.equal(last.stableId, group.fixtureChips[expectedLength - 1].stableId)
  assert.equal(last.addressText, group.fixtureChips[expectedLength - 1].addressText)
  assert.equal(Object.hasOwn(last, 'previewAddressCharacters'), false, 'The card preview keeps the address as plain text')
}

const root = path.resolve(__dirname, '../..')
const wxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')
const cases = [
  ['two-row address preview follows responsive grid columns and floating card keeps every fixture', async () => {
    const runtime = createRuntime()
    seed(runtime, 200)
    try {
      const page = runtime.make('main')
      inspectPreview(page.data.groupCards[0], 8, 16)

      page.onResize({ size: { windowWidth: 320, windowHeight: 568, statusBarHeight: 24 } })
      inspectPreview(page.data.groupCards[0], 6, 12)

      page.onResize({ size: { windowWidth: 430, windowHeight: 844, statusBarHeight: 24 } })
      inspectPreview(page.data.groupCards[0], 9, 18)
      page.openFloatingCard(runtime.event({ index: 0 }))
      await new Promise(resolve => setTimeout(resolve, 300))
      assert.equal(page.data.floatingGroup.fixtureChips.length, 200, 'The expanded card continues to expose all address chips')
    } finally { runtime.dispose() }
  }],
  ['short groups do not get a false overflow fade', () => {
    const runtime = createRuntime()
    seed(runtime, 8)
    try {
      const page = runtime.make('main')
      const group = page.data.groupCards[0]
      assert.equal(group.cardFixtureChips.length, 8)
      assert(group.cardFixtureChips.every(chip => !chip.previewOverflow))
    } finally { runtime.dispose() }
  }],
  ['overflow starts after the exact two-row capacity', () => {
    for (const [quantity, overflows] of [[16, false], [17, true]]) {
      const runtime = createRuntime()
      seed(runtime, quantity)
      try {
        const group = runtime.make('main').data.groupCards[0]
        assert.equal(group.cardChipColumns, 8)
        assert.equal(group.fixtureChips.length, quantity)
        assert.equal(group.cardFixtureChips.length, 16)
        assert.equal(Boolean(group.cardFixtureChips.at(-1).previewOverflow), overflows)
      } finally { runtime.dispose() }
    }
  }],
  ['only collapsed-card preview is truncated; detail and add previews stay complete', () => {
    assert.match(wxml, /class="address-chips address-chips-preview"[^>]*>[\s\S]*?wx:for="\{\{group\.cardFixtureChips\}\}"/)
    assert.match(wxml, /<text class="address-chip-preview-label">\{\{chip\.addressText\}\}<\/text>/)
    assert.match(wxml, /chip\.previewOverflow \? '，后面还有更多地址'/)
    assert.doesNotMatch(wxml, /previewAddressCharacters/)
    assert.match(wxss, /\.address-chip-preview\.address-chip-overflow\{background:linear-gradient\(to right,var\(--group-tint\),transparent\)\}/)
    assert.match(wxss, /\.address-chip-overflow \.address-chip-preview-label\{opacity:\.52\}/)
    assert.match(wxml, /wx:for="\{\{floatingGroup\.fixtureChips\}\}"/, 'Expanded address details must not use the truncated adapter')
    assert.match(wxml, /wx:for="\{\{pendingChange\.addPreview\.fixtureChips\}\}"/, 'Add preview must continue showing its full calculated list')
  }],
]

;(async () => {
  const failures = []
  for (const [name, run] of cases) {
    try {
      await run()
      console.log('PASS ' + name)
    } catch (error) {
      failures.push({ name, error })
      console.error('FAIL ' + name + '\n' + error.stack)
    }
  }
  assert.equal(failures.length, 0, 'Card preview adapter checks failed')
})().catch(error => { console.error(error); process.exitCode = 1 })

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDmxLayoutPage, LAYOUT_GROUP_COLORS } = require('../../pages/dmx-layout/page-factory')

const root = path.resolve(__dirname, '../..')
const page = createDmxLayoutPage({ mode: 'portrait' })
page.setData = (patch) => { page.data = { ...page.data, ...patch } }
page.data = { ...page.data, canvasShellHeight: 420, canvasWidth: 390, placementFilterText: '' }
page._groups = Array.from({ length: 11 }, (_, index) => ({
  stableId: 'group-' + index,
  name: '追光灯 ' + (index + 1),
  fixtureModel: 'TL-SK9702',
  channelCount: 16,
}))
page._fixtures = page._groups.flatMap((group, groupIndex) => Array.from({ length: groupIndex === 0 ? 2 : 1 }, (_, fixtureIndex) => ({
  stableId: group.stableId + '-fixture-' + fixtureIndex,
  groupId: group.stableId,
  groupIndex,
  groupName: group.name,
  fixtureModel: group.fixtureModel,
  addressText: 'A' + String(groupIndex * 10 + fixtureIndex + 1).padStart(3, '0'),
})))
page._scheme = { checksById: {} }
page._layout = { stageWidthText: '12', stageDepthText: '8', apronDirection: 'bottom', internalRods: [], frontRods: [], positionsById: {} }
page._activeRodId = ''

page.updateLayoutData()
assert.equal(page.data.layoutLegend.length, 8, 'normal canvas keeps the established eight-group limit')
assert.equal(page.data.layoutLegendOverflowCount, 3, 'groups after the visible limit remain summarized')
assert.deepEqual(page.data.layoutLegend[0], {
  id: 'group-0',
  groupName: '追光灯 1',
  fixtureModel: 'TL-SK9702',
  fixtureType: 'profile',
  fixtureDisplayTitle: '追光灯 1 · TL-SK9702',
  color: LAYOUT_GROUP_COLORS[0],
  count: 2,
})
assert.equal(page.data.layoutLegend[1].color, LAYOUT_GROUP_COLORS[1], 'legend color follows each actual group')

page.data = { ...page.data, placementFilterText: 'no match', canvasShellHeight: 145 }
page.updateLayoutData()
assert.equal(page.data.placementGroups.length, 0, 'the placement-panel search has no matches')
assert.equal(page.data.layoutLegend.length, 5, 'short canvas limits the native legend height')
assert.equal(page.data.layoutLegendOverflowCount, 6, 'compact legend summarizes hidden groups')
assert.equal(page.data.layoutLegend[0].count, 2, 'legend counts all fixtures, independent of the placement filter')

for (const [wxml, wxss] of [
  ['pages/dmx-layout/dmx-layout.wxml', 'pages/dmx-layout/dmx-layout.wxss'],
  ['pages/dmx-layout-landscape/dmx-layout-landscape.wxml', 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss'],
]) {
  const markup = fs.readFileSync(path.join(root, wxml), 'utf8')
  const styles = fs.readFileSync(path.join(root, wxss), 'utf8')
  const legend = markup.match(/<view wx:if="\{\{!layoutPanelVisible[\s\S]*?class="canvas-legend"[\s\S]*?<\/view>\s*<\/view>/)
  assert.ok(legend, wxml + ' renders the native legend only while the stage canvas is active')
  assert.match(legend[0], /layoutLegend\.length/)
  assert.match(legend[0], /item\.fixtureDisplayTitle/)
  assert.match(legend[0], /item\.count/)
  assert.match(legend[0], /item\.fixtureType/)
  assert.match(legend[0], /\/assets\/lighting\/fixture-types\.png/)
  assert.match(styles, /\.canvas-legend\{[^}]*pointer-events:none/)
}

console.log('PASS layout legend uses current group color/type/name/model/count and remains compact, filter-independent, and touch-through')

const assert = require('node:assert/strict')
const model = require('../../pages/dmx-layout/layout-model')
const renderer = require('../../pages/dmx-layout/layout-renderer')

const palette = ['#5856d6', '#007aff', '#00a878', '#d97706', '#c24182', '#4759c9']
assert.deepEqual(renderer.GROUP_COLORS, palette)
assert.deepEqual(renderer.LAYOUT_GROUP_COLORS, ['#8a2bff', '#007aff', '#00b8ba'])
assert.equal(renderer.classifyFixtureVisualType({ groupName: '摇头灯' }), 'moving')
assert.equal(renderer.classifyFixtureVisualType({ fixtureModel: 'TL-SL321', groupName: '成像灯' }), 'profile')
assert.equal(renderer.classifyFixtureVisualType({ groupName: '平板柔光灯' }), 'soft')

const miniatureCalls = []
const miniatureContext = new Proxy({}, {
  get(_target, property) {
    return (...args) => miniatureCalls.push([property, ...args])
  },
})
renderer.drawFixtureMiniature(miniatureContext, { x: 30, y: 30 }, 'moving', '#8a2bff', 18)
assert.ok(miniatureCalls.some((call) => call[0] === 'closePath'), 'moving head miniature should have a distinct vector body')
assert.ok(miniatureCalls.some((call) => call[0] === 'strokeRect'), 'fixture miniature should include a base and lamp head')

for (const apronDirection of model.APRON_DIRECTIONS) {
  const layout = {
    stageWidthText: '12',
    stageDepthText: '8',
    apronDirection,
    internalRods: [{ id: 'inside-1', distance: 2 }, { id: 'inside-2', distance: 6 }],
    frontRods: [{ id: 'front-1', distance: 1.15 }, { id: 'front-2', distance: 2 }],
    legacySideRods: [],
    positionsById: {},
  }
  const geometry = model.createStageGeometry(layout, 1200, 700)
  assert.ok(Math.abs(geometry.stage.width / geometry.stage.height - 12 / 8) < 1e-10, 'stage ratio changed for ' + apronDirection)
  const frontRods = geometry.rods.filter((rod) => rod.type === 'front')
  assert.equal(frontRods.length, 2)
  const front = frontRods[0]
  const stageRight = geometry.stage.left + geometry.stage.width
  const stageBottom = geometry.stage.top + geometry.stage.height
  if (apronDirection === 'bottom') assert.ok(front.y1 > stageBottom)
  if (apronDirection === 'top') assert.ok(front.y1 < geometry.stage.top)
  if (apronDirection === 'right') assert.ok(front.x1 > stageRight)
  if (apronDirection === 'left') assert.ok(front.x1 < geometry.stage.left)
  assert.ok(geometry.audience.x >= 0 && geometry.audience.x <= geometry.canvasWidth)
  assert.ok(geometry.audience.y >= 0 && geometry.audience.y <= geometry.canvasHeight)
  assert.equal(geometry.rods.filter((rod) => rod.type === 'internal').length, 2)
}

const layout = {
  stageWidthText: '12',
  stageDepthText: '8',
  apronDirection: 'bottom',
  internalRods: [{ id: 'inside-1', distance: 6 }],
  frontRods: [{ id: 'front-1', distance: 1.15 }],
  positionsById: {},
}
const geometry = model.createStageGeometry(layout, 1008, 730)
const fixtures = Array.from({ length: 360 }, (_, index) => ({
  stableId: 'fixture-' + index,
  id: 'fixture-' + index,
  groupId: 'group-' + (index % 3),
  groupIndex: index % 3,
  groupName: ['摇头灯', '染色灯', '成像灯'][index % 3],
  fixtureModel: ['Aura 400', 'PAR-18', 'Profile 600'][index % 3],
  modeName: ['24 CH', '8 CH', '18 CH'][index % 3],
  channelCount: [24, 8, 18][index % 3],
  fixtureIndex: Math.floor(index / 3) + 1,
  addressText: 'A' + String(index + 1).padStart(3, '0'),
  universe: 0,
  startAddress: index + 1,
  endAddress: index + 1,
}))
fixtures.slice(0, 250).forEach((fixture, index) => {
  layout.positionsById[fixture.stableId] = { rodId: 'inside-1', t: .04 + .92 * (index / 249) }
})
fixtures.slice(250, 300).forEach((fixture, offset) => {
  layout.positionsById[fixture.stableId] = { rodId: 'front-1', t: .04 + .92 * (offset / 49) }
})
const snapshot = {
  layout,
  fixtures,
  geometry,
  contextLabel: '项目方案 A',
  siteLabel: '项目方案 A · 12 × 8 m',
  groupCount: 3,
  universeCount: 1,
  theme: renderer.CANVAS_THEMES.light,
}
const originalSnapshot = JSON.stringify(snapshot)
const pages = renderer.buildLightingExportPages(snapshot, { width: 1120, height: 2400 })
assert.equal(pages.length, 1, 'dense fixture sets still export one complete diagram')
assert.equal(pages[0].number, 1)
assert.equal(pages[0].total, 1)
assert(pages[0].addressLayout.sections.length > 0, 'unified export includes grouped address-list sections')
assert(pages[0].addressLayout.sections.some((section) => section.label === '未上杆' && section.addresses.length === 60),
  'unplaced fixtures remain grouped as unplaced rather than receiving fictitious positions')
assert.equal(JSON.stringify(snapshot), originalSnapshot, 'page construction must not mutate positions or fixtures')

const longContextLabel = '多功能剧场灯光系统升级与舞台技术改造项目'.repeat(5)
const longFixtures = fixtures.slice(0, 12).map((fixture) => ({
  ...fixture,
  groupId: 'long-group',
  groupName: '舞台侧边固定灯位综合灯具组'.repeat(5),
  fixtureModel: '专业柔光灯具型号系列'.repeat(4),
}))
const longLayout = { ...layout, positionsById: Object.fromEntries(longFixtures.slice(0, 8).map((fixture, index) => [fixture.stableId, { rodId: 'inside-1', t: .04 + index * .12 }])) }
const longSnapshot = { ...snapshot, layout: longLayout, fixtures: longFixtures, contextLabel: longContextLabel, siteLabel: longContextLabel + ' · 12 × 8 m', groupCount: 1 }
const longPages = renderer.buildLightingExportPages(longSnapshot, { width: 1120, height: 2400 })
assert.equal(longPages.length, 1)
for (const page of longPages) {
  assert(page.projectLines.length > 1, 'long project label must wrap without shrinking')
  assert(page.projectLines.every((line) => renderer.estimateExportTextWidth(line, 22) <= page.width - 96), 'project label stays within image width')
  assert(page.diagramTop >= 112 + (page.projectLines.length - 1) * 28, 'diagram clears all project label lines')
  assert(page.diagramHeight > 0 && page.diagramTop + page.diagramHeight <= page.height, 'complete diagram stays inside the single image')
  assert(page.addressLayout.sections.length > 0, 'long group/model names retain the unified address list')
}

function captureExport(value, page) {
  const calls = []
  let fontSize = 16
  const ctx = new Proxy({}, {
    get(_target, property) {
      if (property === 'calls') return calls
      if (property === 'setFontSize') return (size) => { fontSize = Number(size); calls.push([property, size]) }
      if (property === 'measureText') return (text) => ({ width: renderer.estimateExportTextWidth(text, fontSize) })
      return (...args) => calls.push([property, ...args])
    },
  })
  renderer.renderLightingExportPage(ctx, value, page)
  return calls.filter((call) => call[0] === 'fillText').map((call) => String(call[1]))
}
const texts = captureExport(snapshot, pages[0])
assert(texts.includes('灯位图'))
assert(texts.some((text) => text.includes('项目方案 A')))
assert(texts.includes('完整地址清单（360 台）'), 'the unified image includes a complete address appendix')
const allExportText = texts.join(' ')
for (const fixture of fixtures) assert(allExportText.includes(fixture.addressText), 'export includes fixture address ' + fixture.addressText)
assert(!texts.some((text) => /灯具编址与灯位图|\bCH\b|Aura 400|PAR-18|Profile 600/.test(text)), 'the address appendix does not add a duplicate legacy export or fixture-model text')
for (const text of ['12 m', '8 m', '台口', '观众区', '面光杆1']) assert(texts.includes(text), 'diagram retains ' + text)
assert(texts.includes('灯杆1'), 'diagram retains its internal rod')
const drawnAddresses = new Set(texts.filter((text) => /^[A-Z]+\d{3,}$/.test(text)))
assert(drawnAddresses.size > 0, 'placed addresses remain inside the diagram')
for (const address of drawnAddresses) assert(fixtures.slice(0, 300).some((fixture) => fixture.addressText === address), 'unplaced fixtures must not get fictitious positions')
assert.equal(JSON.stringify(snapshot), originalSnapshot, 'rendering must preserve the entire snapshot')

const unplaced = { ...snapshot, layout: { ...layout, positionsById: {} } }
const unplacedBefore = JSON.stringify(unplaced)
const unplacedPages = renderer.buildLightingExportPages(unplaced)
assert.equal(unplacedPages.length, 1)
const unplacedTexts = captureExport(unplaced, unplacedPages[0])
assert(!unplacedTexts.some((text) => /^[A-Z]+\d{3,}$/.test(text)), 'unplaced fixtures are not silently assigned to rods')
assert(unplacedPages[0].addressLayout.sections.some((section) => section.label === '未上杆' && section.addresses.length === fixtures.length),
  'all unplaced fixtures are represented in the address appendix')
const unplacedExportText = unplacedTexts.join(' ')
for (const fixture of fixtures) assert(unplacedExportText.includes(fixture.addressText), 'unplaced address remains listed: ' + fixture.addressText)
assert(unplacedTexts.includes('台口') && unplacedTexts.includes('观众区'), 'empty rod layout remains a real diagram')
assert.equal(JSON.stringify(unplaced), unplacedBefore)
for (const apronDirection of model.APRON_DIRECTIONS) {
  const oriented = { ...snapshot, layout: { ...layout, apronDirection } }
  const page = renderer.buildLightingExportPages(oriented)[0]
  const labels = captureExport(oriented, page)
  for (const text of ['灯位图', '台口', '观众区', '12 m', '8 m']) assert(labels.includes(text), apronDirection + ' retains ' + text)
}
console.log('Lighting layout geometry and unified address export tests passed')

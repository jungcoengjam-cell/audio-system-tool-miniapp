// One-time, narrow migration required by the user's diagram-only export request.
// Keeps geometry tests and native node/lifecycle assertions unchanged.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..'),backup=path.join(__dirname,'baseline/test-migrations')
fs.mkdirSync(backup,{recursive:true})
function preserve(relative){const target=path.join(backup,relative);if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,relative),target)}}
const legacy='tests/dmx-ui-refactor-2026-10-18/layout-canvas-export-test.cjs'
preserve(legacy)
const file=path.join(root,legacy),source=fs.readFileSync(file,'utf8'),marker='const pages = renderer.buildLightingExportPages(snapshot, { width: 1120, height: 2400 })'
assert(source.includes(marker),'Known legacy export contract marker must exist')
const revised=String.raw`const originalSnapshot = JSON.stringify(snapshot)
const pages = renderer.buildLightingExportPages(snapshot, { width: 1120, height: 2400 })
assert.equal(pages.length, 1, 'dense fixture sets still export one complete diagram')
assert.equal(pages[0].number, 1)
assert.equal(pages[0].total, 1)
assert(!pages[0].rows?.length, 'diagram-only export must not build fixture/address table rows')
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
  assert(!page.rows?.length, 'long group/model names must not reintroduce address tables')
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
assert(!texts.some((text) => /灯具编址与灯位图|灯具地址清单|未上杆|地址清单|\bCH\b|Aura 400|PAR-18|Profile 600/.test(text)), 'only the diagram and its context may be exported')
for (const text of ['12 m', '8 m', '台口', '观众区', '面光杆1']) assert(texts.includes(text), 'diagram retains ' + text)
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
assert(unplacedTexts.includes('台口') && unplacedTexts.includes('观众区'), 'empty rod layout remains a real diagram')
assert.equal(JSON.stringify(unplaced), unplacedBefore)
for (const apronDirection of model.APRON_DIRECTIONS) {
  const oriented = { ...snapshot, layout: { ...layout, apronDirection } }
  const page = renderer.buildLightingExportPages(oriented)[0]
  const labels = captureExport(oriented, page)
  for (const text of ['灯位图', '台口', '观众区', '12 m', '8 m']) assert(labels.includes(text), apronDirection + ' retains ' + text)
}
console.log('Lighting layout geometry and diagram-only export tests passed')
`
fs.writeFileSync(file,source.slice(0,source.indexOf(marker))+revised)
const native='tests/dmx-ui-native-fixes-2026-10-18/layout-canvas-2d-regression-test.cjs'
preserve(native)
const nativeFile=path.join(root,native),nativeSource=fs.readFileSync(nativeFile,'utf8')
assert(nativeSource.includes("call.value === '灯具编址与灯位图'"),'Known native export title assertion must exist')
fs.writeFileSync(nativeFile,nativeSource.replace("assert.ok(exportTextCalls.some((call) => call.value === '灯具编址与灯位图'), 'export node should contain rendered report pixels')", "assert.ok(exportTextCalls.some((call) => call.value === '灯位图'), 'export node should receive the real diagram title draw call')\nassert.ok(!exportTextCalls.some((call) => /灯具地址清单|灯具编址与灯位图|地址清单/.test(String(call.value))), 'native export draw calls must not include the removed list/report')"))
console.log('Migrated only diagram export assertions; originals saved under this round baseline.')

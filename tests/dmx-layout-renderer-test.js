const assert = require('assert')
const { calculateDmxAddressPlan } = require('../utils/dmx-address')
const model = require('../pages/dmx-layout/layout-model')
const renderer = require('../pages/dmx-layout/layout-renderer')

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  Object.keys(value).forEach((key) => freeze(value[key]))
  return value
}

function recordingContext() {
  const calls = []
  const ctx = new Proxy({}, { get: (_, name) => {
    if (name === 'calls') return calls
    return (...args) => calls.push([name, ...args])
  } })
  return ctx
}

function makeSnapshot(count = 7, overrides = {}) {
  const groupCount = count > 8 ? Math.ceil(count / 2) : Math.min(200, count)
  const groups = [{ name: '测试灯组', channelCount: 4, fixtureCount: groupCount }]
  if (count > 8) groups.push({ name: '测试灯组二', channelCount: 4, fixtureCount: count - groupCount })
  const plan = calculateDmxAddressPlan({ startAddress: 1, groups })
  assert(!plan.error)
  const definitions = model.posDefs(3, 'full', 2)
  const positions = Object.fromEntries(plan.fixtures.map((fixture, index) => [model.posKey(fixture), {
    zone: 'top', positionIndex: index % 3, x: (index % 10) / 10, y: .5,
  }]))
  return freeze({
    data: {
      canvasWidth: 700, canvasHeight: 900, isLandscape: false, schemeIndex: 2,
      rowIndex: 2, sidePairIndex: 1, groupLegend: groups.map((group, index) => ({ name: group.name, count: group.fixtureCount, color: renderer.GROUP_COLORS[index] })),
      addressRangeText: `${plan.startText} → ${plan.endText}`, addressLabelsVisible: true, addressLabelMode: 'all',
    },
    fixtures: plan.fixtures, positions, definitions, checkedKeys: new Set(), selectedKey: '', selectedGroup: undefined,
    dragPoint: null, palettePreview: null, theme: renderer.getCanvasTheme('light'), stage: model.stageRect(12, 8),
    viewScale: 1, widthMeters: 12, depthMeters: 8, frontAtBottom: true,
    progKey: (fixture) => `${fixture.groupIndex}:${fixture.fixtureIndex}:${fixture.addressText}`,
    ...overrides,
  })
}

function draw(snapshot, options = {}) {
  const ctx = recordingContext()
  renderer.renderLayout(ctx, snapshot, options)
  return ctx.calls
}

const base = makeSnapshot()
const lightCalls = draw(base)
assert(lightCalls.some(([name, value]) => name === 'setFillStyle' && value === '#f5f5f7'))
assert(lightCalls.some(([name, value]) => name === 'fillText' && String(value).includes('001')))
assert(lightCalls.some(([name, value]) => name === 'fillText' && value === '面光位'))
assert(lightCalls.some(([name, value]) => name === 'fillText' && value === '左1'))
assert(lightCalls.some(([name, value]) => name === 'fillText' && value === '右1'))
const frontBottomY = base.stage.top + base.stage.height + 100
assert(lightCalls.some(([name, ...args]) => name === 'fillText' && args[0] === '舞台前沿' && args[2] === frontBottomY), '下方前沿文字坐标不符')

const darkLandscape = makeSnapshot(7, {
  data: { ...base.data, canvasWidth: 1200, canvasHeight: 720, isLandscape: true, addressLabelMode: 'smart' },
  stage: model.stageRect(12, 8, 1200, 720), theme: renderer.getCanvasTheme('dark'), frontAtBottom: false,
})
const darkCalls = draw(darkLandscape)
assert(darkCalls.some(([name, value]) => name === 'setFillStyle' && value === '#000000'))
assert(!darkCalls.some(([name, value]) => name === 'fillText' && value === '灯具位置图'))
assert(darkCalls.some(([name, value]) => name === 'fillText' && value === '舞台前沿'))
const frontTopY = darkLandscape.stage.top - 90
assert(darkCalls.some(([name, ...args]) => name === 'fillText' && args[0] === '舞台前沿' && args[2] === frontTopY), '上方前沿文字坐标不符')

const completed = base.fixtures[0]
const selected = base.fixtures[1]
const selectedKey = model.posKey(selected)
const selectedCalls = draw(freeze({ ...base, checkedKeys: new Set([`${completed.groupIndex}:${completed.fixtureIndex}:${completed.addressText}`]), selectedKey, selectedGroup: selected.groupIndex, dragPoint: { x: 333, y: 444 } }))
const selectedRadius = renderer.getRenderRadius(base, 1)
assert(selectedCalls.some(([name, ...args]) => name === 'arc' && args[2] === selectedRadius + 9))
assert(selectedCalls.some(([name, ...args]) => name === 'arc' && args[2] === selectedRadius + 5), '完成圈半径不符')
assert(selectedCalls.some(([name, ...args]) => name === 'lineTo' && args[0] === 333 && args[1] === 444))

const hiddenCalls = draw(freeze({ ...base, data: { ...base.data, addressLabelsVisible: false } }))
assert.strictEqual(hiddenCalls.filter(([name]) => name === 'fillText').filter(([, value]) => base.fixtures.some((fixture) => value === fixture.addressText)).length, 0)
const multi = makeSnapshot(10)
const smartCalls = draw(freeze({ ...multi, data: { ...multi.data, addressLabelMode: 'smart' }, selectedGroup: 0 }))
const groupZeroAddress = multi.fixtures.find((fixture) => fixture.groupIndex === 0).addressText
const groupOneAddress = multi.fixtures.find((fixture) => fixture.groupIndex === 1).addressText
assert(smartCalls.some(([name, value]) => name === 'fillText' && value === groupZeroAddress), 'smart 未显示选中组地址')
assert(!smartCalls.some(([name, value]) => name === 'fillText' && value === groupOneAddress), 'smart 错误显示未选中组地址')
const selectedOther = multi.fixtures.find((fixture) => fixture.groupIndex === 1)
const selectedOtherCalls = draw(freeze({ ...multi, data: { ...multi.data, addressLabelMode: 'smart' }, selectedKey: model.posKey(selectedOther), selectedGroup: 0 }))
assert(selectedOtherCalls.some(([name, value]) => name === 'fillText' && value === selectedOther.addressText), 'smart 未显示被选中地址')
const ordinaryPaletteCalls = draw(freeze({ ...base, palettePreview: { fixture: base.fixtures[0], targetX: 300, targetY: 300, badgeX: 300, badgeY: 200 } }))
assert(ordinaryPaletteCalls.some(([name, ...args]) => name === 'arc' && args[2] === 13), '普通模式未绘制 palette 预览')
const exportCalls = draw(freeze({ ...base, data: { ...base.data, addressLabelsVisible: false, addressLabelMode: 'smart' }, selectedKey, selectedGroup: 0, dragPoint: { x: 1, y: 1 }, palettePreview: { fixture: base.fixtures[0], targetX: 300, targetY: 300, badgeX: 300, badgeY: 200 } }), { exportMode: true })
assert(exportCalls.some(([name, value]) => name === 'fillText' && value === base.fixtures[0].addressText), '导出未强制显示地址')
assert(!exportCalls.some(([name, ...args]) => name === 'arc' && args[2] === 39))
assert(!exportCalls.some(([name, ...args]) => name === 'lineTo' && args[0] === 1 && args[1] === 1))
assert(!exportCalls.some(([name, ...args]) => name === 'arc' && args[2] === 13))

const densePlan = calculateDmxAddressPlan({ startAddress: 1, groups: [
  { name: '密集组一', channelCount: 1, fixtureCount: 200 },
  { name: '密集组二', channelCount: 1, fixtureCount: 200 },
  { name: '密集组三', channelCount: 1, fixtureCount: 100 },
] })
assert(!densePlan.error)
const densePositions = Object.fromEntries(densePlan.fixtures.map((fixture, index) => [model.posKey(fixture), {
  zone: 'top', positionIndex: 0, x: .4 + ((index % 12) * .0001), y: .5,
}]))
const denseSnapshot = makeSnapshot(1, {
  data: { ...base.data, canvasWidth: 700, canvasHeight: 900, groupLegend: [{ name: '密集组', count: 500, color: renderer.GROUP_COLORS[0] }] },
  fixtures: densePlan.fixtures,
  positions: densePositions,
  definitions: model.posDefs(1, 'top', 1),
  stage: model.stageRect(12, 8, 700, 900),
})
const denseLayout = renderer.getExportAddressLayout(denseSnapshot)
assert.strictEqual(denseLayout.bars.length, 1, '密集同杆没有生成逐杆地址展开带')
assert.strictEqual(denseLayout.bars[0].entries.length, 500, '密集杆地址展开带没有覆盖全部灯具')
assert.strictEqual(new Set(denseLayout.bars[0].entries.map((entry) => entry.fixture.addressText)).size, 500,
  '密集杆展开带地址不唯一')
assert(denseLayout.canvasHeight > 900 && denseLayout.destWidth <= 1500 && denseLayout.destHeight <= 4096,
  '密集地址展开带没有动态扩高或超出导出像素上限')
assert(denseLayout.bars[0].entries[0] && denseLayout.bars[0].gap < 1.5 && denseLayout.markers.get(model.posKey(densePlan.fixtures[0])) < .5,
  '500 台极密同杆没有退化为密度示意标记')
const denseRenderSnapshot = { ...denseSnapshot, data: { ...denseSnapshot.data, exportCanvasHeight: denseLayout.canvasHeight } }
const denseRenderCalls = draw(denseRenderSnapshot, { exportMode: true })
assert(denseRenderCalls.some(([name, value]) => name === 'fillText' && value === '总览示密度，地址见分段图。'),
  '极密总览没有明确标记为密度示意')
const directionNote = denseRenderCalls.find(([name, value]) => name === 'fillText' && String(value).startsWith('标签辨址，刻度示真实位置'))
const densityNote = denseRenderCalls.find(([name, value]) => name === 'fillText' && value === '总览示密度，地址见分段图。')
const firstDenseHeader = denseRenderCalls.find(([name, value]) => name === 'fillText' && String(value).includes('1/25段 1-20台'))
assert(directionNote && densityNote && firstDenseHeader
  && densityNote[3] - directionNote[3] >= 18
  && firstDenseHeader[3] - densityNote[3] >= 18,
'展开带说明、密度提示和首个杆标题发生垂直重叠')
assert(denseLayout.bars[0].segments.length === 25 && denseLayout.bars[0].segments.every((segment) => segment.entries.length <= 20),
  '500 台展开杆没有按每段最多 20 台切分')
assert(denseLayout.bars[0].entries.every((entry) => Number.isFinite(entry.actualX) && Number.isFinite(entry.slotX)),
'逐台位置图未保留物理刻度、等宽标签槽或组色')
const proportionalEntry = denseLayout.bars[0].entries[10]
const proportionalPoint = model.posPoint(densePositions[model.posKey(proportionalEntry.fixture)], denseSnapshot.stage, true)
assert(Math.abs(proportionalEntry.actualX - (30 + ((proportionalPoint.x - denseSnapshot.stage.left) / denseSnapshot.stage.width) * 640)) < .001,
  '顶杆刻度没有按原始 x 比例定位')
assert(denseLayout.bars[0].segments.every((segment) => 640 / segment.entries.length >= 28),
  '500 台展开带完整地址标签槽宽度不足')
const orderedDense = renderer.getExportAddressLayout({ ...denseSnapshot, positions: Object.fromEntries(densePlan.fixtures.map((fixture, index) => [model.posKey(fixture), { zone: 'top', positionIndex: 0, x: 1 - (index / 600), y: .5 }])) })
assert.strictEqual(orderedDense.bars[0].entries[0].fixture.addressText, densePlan.fixtures[499].addressText,
  '地址展开带没有按杆上从左到右的物理次序排序')
const unequalFixture = densePlan.fixtures[3]
const equalFixture = densePlan.fixtures[4]
const unequal = renderer.getExportAddressLayout({ ...denseSnapshot, positions: { ...densePositions,
  [model.posKey(unequalFixture)]: { zone: 'top', positionIndex: 0, x: .9, y: .5 },
  [model.posKey(equalFixture)]: { zone: 'top', positionIndex: 0, x: .9, y: .5 },
} })
const sameMark = unequal.bars[0].entries.filter((entry) => entry.fixture === unequalFixture || entry.fixture === equalFixture)
assert.strictEqual(sameMark[0].actualX, sameMark[1].actualX, '同位灯具没有共用真实刻度位置')
assert.notStrictEqual(sameMark[0].slotX, sameMark[1].slotX, '同位灯具标签没有独立槽位供引线扇出')
assert(denseRenderCalls.filter(([name, x, y, width, height]) => name === 'fillRect' && width === 2 && height === 10).length === 500,
  '展开带没有为每台真实刻度绘制引线和位置标记')
const eightyFixtures = densePlan.fixtures.slice(0, 80)
const eightyPositions = Object.fromEntries(eightyFixtures.map((fixture, index) => [model.posKey(fixture), {
  zone: 'top', positionIndex: 0, x: (index + 1) / (eightyFixtures.length + 1), y: .5,
}]))
const eightySnapshot = {
  ...denseSnapshot,
  fixtures: eightyFixtures,
  positions: eightyPositions,
  data: { ...denseSnapshot.data, groupLegend: [{ name: '80 台组', count: 80, color: renderer.GROUP_COLORS[0] }] },
}
const eightyLayout = renderer.getExportAddressLayout(eightySnapshot)
const eightyBand = eightyLayout.bars[0]
const eightyRadius = eightyLayout.markers.get(model.posKey(eightyFixtures[0]))
assert(eightyBand && eightyBand.gap >= 1.5 && eightyBand.entries.length === 80,
  '80 台密集杆没有保留逐台地址与可辨位置点')
const eightyPoints = eightyBand.entries.map((entry) => ({
  point: model.posPoint(eightyPositions[model.posKey(entry.fixture)], eightySnapshot.stage, eightySnapshot.frontAtBottom),
  radius: eightyRadius,
}))
for (let left = 0; left < eightyPoints.length; left += 1) for (let right = left + 1; right < eightyPoints.length; right += 1) {
  const a = eightyPoints[left], b = eightyPoints[right]
  assert(Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) >= a.radius + b.radius + 1,
    '80 台同杆总览小点互相压住')
}
const eightyCalls = draw({ ...eightySnapshot, data: { ...eightySnapshot.data, exportCanvasHeight: eightyLayout.canvasHeight } }, { exportMode: true })
assert.strictEqual(eightyCalls.filter(([name, ...args]) => name === 'arc' && args[2] === eightyRadius).length, 80,
  '80 台杆位总览没有为每台输出独立、按间距限制尺寸的小点')
const maximumBars = model.posDefs(6, 'full', 3)
const maximumBarPositions = Object.create(null)
densePlan.fixtures.forEach((fixture, index) => {
  const definition = maximumBars[index % maximumBars.length]
  const side = definition.zone.startsWith('side-')
  maximumBarPositions[model.posKey(fixture)] = {
    zone: definition.zone,
    positionIndex: definition.positionIndex,
    x: definition.zone === 'side-left' ? 0 : definition.zone === 'side-right' ? 1 : .4 + ((index % 5) * .0001),
    y: .5 + ((index % 2) * .0001),
  }
})
const maximumBarSnapshot = {
  ...denseSnapshot,
  data: { ...denseSnapshot.data, schemeIndex: 2, rowIndex: 5, sidePairIndex: 2 },
  positions: maximumBarPositions,
  definitions: maximumBars,
}
const maximumBarLayout = renderer.getExportAddressLayout(maximumBarSnapshot)
assert.strictEqual(maximumBarLayout.bars.length, 13, '13 杆极端分散方案未为所有密集杆生成展开带')
assert.strictEqual(maximumBarLayout.bars.reduce((sum, bar) => sum + bar.entries.length, 0), 500,
  '13 杆极端分散方案的展开带遗漏灯具')
assert(maximumBarLayout.canvasHeight <= 4096 && maximumBarLayout.destHeight <= 4096 && maximumBarLayout.destWidth <= 1500,
  '500 台分布在 13 杆时导出高度或像素尺寸超限')
const sidePositions = Object.fromEntries(densePlan.fixtures.map((fixture, index) => [model.posKey(fixture), {
  zone: 'side-left', positionIndex: 0, x: 0, y: .8 - (index * .001),
}]))
const sideOrderedLayout = renderer.getExportAddressLayout({
  ...maximumBarSnapshot,
  positions: sidePositions,
  stage: model.stageRect(12, 8, 700, 900),
  frontAtBottom: true,
})
assert.strictEqual(sideOrderedLayout.bars[0].definition.zone, 'side-left')
assert.strictEqual(sideOrderedLayout.bars[0].entries[0].fixture, densePlan.fixtures[499],
  '侧光地址展开带没有按画面从上到下排序')
assert(sideOrderedLayout.bars[0].definition.zone.startsWith('side-')
  && sideOrderedLayout.bars[0].segments.every((segment) => segment.entries.length <= 20),
  '侧光展开标题未标明画面方向')
const sidePoint = model.posPoint(sidePositions[model.posKey(sideOrderedLayout.bars[0].entries[0].fixture)], sideOrderedLayout.bars[0].entries[0].fixture && model.stageRect(12, 8, 700, 900), true)
const sideRange = model.sideCanvasRange(sideOrderedLayout.bars[0].definition, sideOrderedLayout.bars[0].definition && model.stageRect(12, 8, 700, 900), true, 3)
assert(Math.abs(sideOrderedLayout.bars[0].entries[0].actualX - (30 + ((sidePoint.y - sideRange.startY) / (sideRange.endY - sideRange.startY)) * 640)) < .001,
  '侧光刻度没有按有效杆段的屏幕 y 比例定位')
const photoPlan = calculateDmxAddressPlan({ startAddress: 1, groups: [
  { name: '帕灯', channelCount: 1, fixtureCount: 11 },
  { name: '平板灯', channelCount: 1, fixtureCount: 16 },
  { name: '摇头灯', channelCount: 1, fixtureCount: 14 },
] })
const photoDefs = model.posDefs(2, 'full', 1)
const photoPositions = Object.fromEntries(photoPlan.fixtures.map((fixture, index) => {
  const front = fixture.groupIndex === 0
  const rail = fixture.groupIndex === 1
    ? (fixture.fixtureIndex <= 8 ? 0 : 1)
    : fixture.groupIndex === 2 ? (fixture.fixtureIndex <= 7 ? 0 : 1) : -1
  const definition = front ? photoDefs.find((item) => item.zone === 'front') : photoDefs.filter((item) => item.zone === 'top')[rail]
  const local = front ? fixture.fixtureIndex : fixture.groupIndex === 1
    ? (fixture.fixtureIndex <= 8 ? (fixture.fixtureIndex - 1) * 2 : (fixture.fixtureIndex - 9) * 2)
    : fixture.fixtureIndex <= 7 ? (fixture.fixtureIndex - 1) * 2 + 1 : (fixture.fixtureIndex - 8) * 2 + 1
  return [model.posKey(fixture), { zone: definition.zone, positionIndex: definition.positionIndex,
    x: (front ? local / 12 : (local + 1) / 16), y: definition.zone === 'top' ? (definition.positionIndex ? .65 : .35) : .5 }]
}))
const photoColors = [0, 1, 2].map((index) => renderer.GROUP_COLORS[index])
const photoLayout = renderer.getExportAddressLayout({ ...denseSnapshot, fixtures: photoPlan.fixtures, positions: photoPositions,
  definitions: photoDefs, data: { ...denseSnapshot.data, groupLegend: photoPlan.groups.map((group, index) => ({
    name: group.name, count: group.fixtureCount, color: photoColors[index],
  })) } })
const photoSnapshot = { ...denseSnapshot, fixtures: photoPlan.fixtures, positions: photoPositions, definitions: photoDefs,
  data: { ...denseSnapshot.data, exportCanvasHeight: photoLayout.canvasHeight, groupLegend: photoPlan.groups.map((group, index) => ({
    name: group.name, count: group.fixtureCount, color: photoColors[index],
  })) } }
assert.strictEqual(photoLayout.bars.length, 3, '41 台照片方案没有按面光与两根顶杆分别展开')
assert(photoLayout.bars.every((bar) => bar.segments.length === 1), '41 台照片方案的各杆不应跨段')
assert.deepStrictEqual(photoLayout.bars.map((bar) => bar.entries.length).sort((a, b) => a - b), [11, 15, 15],
  '41 台照片的面光/两根顶杆地址数不符')
photoLayout.bars.filter((bar) => bar.definition.zone === 'top').forEach((bar) => {
  assert.deepStrictEqual(new Set(bar.entries.map((entry) => entry.fixture.groupIndex)), new Set([1, 2]),
    `${bar.definition.label} 没有平板灯与摇头灯混排`)
  assert(bar.entries.every((entry, index) => index === 0 || entry.fixture.groupIndex !== bar.entries[index - 1].fixture.groupIndex),
    `${bar.definition.label} 灯具仍按类型成块排列`)
})
const photoTopYs = photoLayout.bars.filter((bar) => bar.definition.zone === 'top').map((bar) =>
  model.posPoint(photoPositions[model.posKey(bar.entries[0].fixture)], denseSnapshot.stage, true).y)
assert.strictEqual(new Set(photoTopYs).size, 2, '照片方案两根顶杆总览位置重叠')
assert.strictEqual(new Set(photoLayout.bars.flatMap((bar) => bar.entries.map((entry) => entry.fixture.addressText))).size, 41,
  '41 台照片方案未逐台唯一输出地址')
assert(photoLayout.bars.every((bar) => bar.entries.every((entry) =>
  entry.actualX >= 30 && entry.actualX <= 670 && entry.slotX >= 30 && entry.slotX <= 670)),
  '41 台照片展开标记或标签槽脱离画布范围')
const photoCalls = draw(photoSnapshot, { exportMode: true })
const photoArcs = photoCalls.filter(([name]) => name === 'arc')
assert.strictEqual(photoArcs.length, 41, '41 台照片导出总览没有完整绘制 41 个杆位点')
const photoLabels = photoCalls.filter(([name, text]) => name === 'fillText' && photoPlan.fixtures.some((fixture) => fixture.addressText === text))
assert.strictEqual(photoLabels.length, 41, '混合组照片展开带的完整地址未逐台唯一绘制')
photoLayout.bars.forEach((bar) => {
  const expected = bar.entries.map((entry) => model.posPoint(photoPositions[model.posKey(entry.fixture)], photoSnapshot.stage, true).y)
  const ys = photoArcs.map((call) => call[2]).filter((value) => expected.includes(value))
  assert.strictEqual(ys.length, bar.entries.length, `${bar.definition.label} 总览杆位点数量与展开地址元数据不符`)
  bar.entries.forEach((entry) => {
    const { fixture, actualX, slotX } = entry
    const addressCalls = photoCalls.filter(([name, text]) => name === 'fillText' && text === fixture.addressText)
    assert.strictEqual(addressCalls.length, 1, `${fixture.addressText} 没有唯一地址标签`)
    const labelY = addressCalls[0][3]
    const leaderStart = photoCalls.findIndex(([name, x], index) => name === 'moveTo' && Math.abs(x - actualX) < .001
      && photoCalls[index + 1]?.[0] === 'lineTo' && Math.abs(photoCalls[index + 1][1] - slotX) < .001
      && Math.abs(photoCalls[index + 1][2] - (labelY - 5)) < .001)
    assert(leaderStart >= 0, `${fixture.addressText} 缺少从真实刻度到标签槽的引线`)
    const axisY = photoCalls[leaderStart][2], leaderY = photoCalls[leaderStart + 1][2]
    const axisTick = photoCalls.findIndex(([name, x, y, width, height]) => name === 'fillRect'
      && Math.abs(x - (actualX - 1)) < .001 && Math.abs(y - (axisY - 5)) < .001 && width === 2 && height === 10)
    assert(axisTick >= 0, `${fixture.addressText} 缺少真实比例刻度`)
    const tickColor = photoCalls.slice(0, axisTick).reverse().find(([name]) => name === 'setFillStyle')?.[1]
    assert.strictEqual(tickColor, photoColors[fixture.groupIndex], `${fixture.addressText} 刻度组色不符`)
    assert(Math.abs(leaderY - (axisY + 20)) < .001,
    `${fixture.addressText} 引线未从真实刻度连到标签槽`)
    assert.strictEqual(addressCalls[0][2], slotX, `${fixture.addressText} 未在对应标签槽绘制`)
  })
})
assert.strictEqual(new Set(photoTopYs).size, 2, '照片用例的顶杆总览点发生重合')

const missingCalls = draw(makeSnapshot(7, { positions: {} }))
assert.strictEqual(missingCalls.filter(([name]) => name === 'arc').length, 0)
;[[1, 30], [31, 25], [61, 21], [101, 18], [151, 16], [301, 14]].forEach(([count, radius]) => {
  const calls = draw(makeSnapshot(count))
  assert(calls.some(([name, ...args]) => name === 'arc' && args[2] === radius), `${count} 台半径不符`)
})
const manyGroups = makeSnapshot(1, { data: { ...base.data, groupLegend: Array.from({ length: 9 }, (_, index) => ({ name: `组${index + 1}`, count: 1, color: renderer.GROUP_COLORS[index % 8] })) } })
assert(draw(manyGroups).some(([name, value]) => name === 'fillText' && String(value).includes('另有 1 个灯具组')))

const frozen = makeSnapshot(7)
const before = { data: { ...frozen.data }, positions: { ...frozen.positions }, definitions: frozen.definitions.map((item) => ({ ...item })), checkedKeys: [...frozen.checkedKeys] }
draw(frozen)
const after = { data: { ...frozen.data }, positions: { ...frozen.positions }, definitions: frozen.definitions.map((item) => ({ ...item })), checkedKeys: [...frozen.checkedKeys] }
assert.deepStrictEqual(after, before, 'renderer 改写了冻结快照输入')

console.log('DMX layout renderer tests passed')

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

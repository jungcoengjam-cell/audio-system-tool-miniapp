const assert = require('assert/strict')
const { applyScheduleChange, emptySchedule } = require('../utils/project-wiring')
const { buildWorkspace, circleLabel, deviceNames, generatePortPairs } = require('../pages/project-wiring/workspace-model')

const added = applyScheduleChange(emptySchedule(), { type: 'add-devices', devices: [
  { type: 'mixer', name: '调音台' }, { type: 'mixer', name: '调音台' }, { type: 'speaker', name: '音箱' },
] })
const [first, second, target] = added.deviceIds
const base = { fromDevice: '调音台', fromPort: 'OUT-01', toDevice: '音箱', toPort: 'IN-09' }
const changed = applyScheduleChange(added.schedule, { type: 'append-lines', lines: [
  { ...base, fromDeviceId: first, toDeviceId: target },
  { ...base, fromDeviceId: second, toDeviceId: target },
  { ...base },
  { ...base, fromDeviceId: first, toDeviceId: target, fromPort: 'OUT-02', toPort: 'IN-10', lengthText: '8' },
] })
assert.equal(changed.ok, true, changed.error)
const before = JSON.stringify(changed.schedule)
const workspace = buildWorkspace(changed.schedule)
assert.equal(JSON.stringify(changed.schedule), before, '派生视图不得修改存储数据')
assert.equal(workspace.groups.length, 3, '同名不同实例和旧文本不能合并')
assert.deepEqual(workspace.groups.map((group) => group.lines.map((line) => line.circleLabel)), [['1', '2'], ['1'], ['1']])
assert.deepEqual(workspace.lines.map((line) => line.circleLabel), ['1', '1', '1', '2'], 'workspace.lines keeps storage order with pair-local display numbers')
assert.equal(workspace.lines[0].specLabel, '待补')
assert.equal(workspace.lines[0].connectorALabel, '待补')
assert.equal(workspace.lines[3].lengthLabel, '8 m')
assert.equal(workspace.devices.find((device) => device.id === first).lineCount, 2)
assert.equal(workspace.devices.find((device) => device.id === target).lineCount, 3)
assert.equal(workspace.devices.filter((device) => device.name === '调音台').length, 3)
assert.equal(new Set(workspace.devices.filter((device) => device.name === '调音台').map((device) => device.choiceLabel)).size, 3)
const deleted = applyScheduleChange(changed.schedule, { type: 'delete', id: changed.lineIds[0] })
assert.deepEqual(buildWorkspace(deleted.schedule).lines.map((line) => line.circleLabel), ['1', '1', '1'], 'each device pair restarts display numbering at one')
assert.deepEqual(deleted.schedule.lines.map((line) => line.code), changed.schedule.lines.slice(1).map((line) => line.code), 'display ordinals do not rewrite persistent line codes')
assert.equal(circleLabel({ code: 'A00025' }), '25')
assert.equal(circleLabel({ code: 'SITE-7' }), 'SITE-7', '自定义线号原样保留，不另行分配编号')
const renamed = { ...changed.schedule, devices: changed.schedule.devices.map((device) => device.id === first ? { ...device, name: '主调音台' } : device) }
assert.equal(buildWorkspace(renamed).groups[0].fromDevice, '主调音台')
assert.equal(buildWorkspace(renamed).groups[0].key, workspace.groups[0].key, '分组身份不依赖展示名称')

const routeDevices = [
  { id: 'a', type: 'custom', name: '同名设备' },
  { id: 'b', type: 'custom', name: '同名设备' },
  { id: 'c', type: 'custom', name: '同名设备' },
  { id: 'd', type: 'custom', name: '另一个设备' },
]
const routeLine = (id, code, fromDeviceId, toDeviceId) => ({
  ...changed.schedule.lines[0], id, code,
  fromDeviceId, fromDevice: routeDevices.find((device) => device.id === fromDeviceId).name,
  toDeviceId, toDevice: routeDevices.find((device) => device.id === toDeviceId).name,
})
const bidirectionalSchedule = {
  version: 1, revision: 12, nextNumber: 7, devices: routeDevices,
  lines: [
    routeLine('ab-1', 'A901', 'a', 'b'),
    routeLine('cd-1', 'A902', 'c', 'd'),
    routeLine('ba-1', 'A903', 'b', 'a'),
    routeLine('ab-2', 'A904', 'a', 'b'),
    routeLine('cb-1', 'A905', 'c', 'b'),
    routeLine('aa-1', 'A906', 'a', 'a'),
  ],
}
const bidirectionalBefore = JSON.stringify(bidirectionalSchedule)
const bidirectional = buildWorkspace(bidirectionalSchedule)
assert.equal(JSON.stringify(bidirectionalSchedule), bidirectionalBefore, 'direction grouping does not mutate stored rows')
assert.deepEqual(bidirectional.lines.map((line) => line.id), bidirectionalSchedule.lines.map((line) => line.id), 'workspace.lines retains storage order')
assert.deepEqual(bidirectional.lines.map((line) => line.circleLabel), ['1', '1', '3', '2', '1', '1'],
  'the first direction numbers before the reverse direction, and each other pair restarts at one')
const pairAB = bidirectional.groups.find((group) => group.fromDeviceId === 'a' && group.toDeviceId === 'b')
const pairBA = bidirectional.groups.find((group) => group.directions.some((direction) => direction.fromDeviceId === 'b' && direction.toDeviceId === 'a'))
assert.equal(pairAB, pairBA, 'opposite routes share a stable device-pair group')
assert.equal(pairAB.key, JSON.stringify(['device:a', 'device:b']), 'group keys use safe unordered endpoint identity')
assert.equal(pairAB.bidirectional, true)
assert.equal(pairAB.fromDeviceLabel, '同名设备 · 1')
assert.equal(pairAB.toDeviceLabel, '同名设备 · 2')
assert.deepEqual(pairAB.lines.map((line) => line.id), ['ab-1', 'ab-2', 'ba-1'], 'flat lines follow first-seen direction groups')
assert.deepEqual(pairAB.directions.map((direction) => direction.lines.map((line) => line.circleLabel)), [['1', '2'], ['3']])
assert.deepEqual(pairAB.directions.map((direction) => `${direction.fromDeviceLabel} → ${direction.toDeviceLabel}`), [
  '同名设备 · 1 → 同名设备 · 2', '同名设备 · 2 → 同名设备 · 1',
], 'ambiguous same-name IDs use the existing choice labels in direction titles')
assert.equal(bidirectional.groups.find((group) => group.fromDeviceId === 'c' && group.toDeviceId === 'b').lines[0].circleLabel,
  '1', 'a second pair with the same displayed device names remains separate')
assert.equal(bidirectional.groups.find((group) => group.fromDeviceId === 'a' && group.toDeviceId === 'a').lineCount, 1,
  'self-loop routes are retained')
assert.equal(circleLabel(bidirectionalSchedule.lines[2], bidirectionalSchedule), '3', 'confirmation and editor labels use pair-local display numbers')
assert.equal(circleLabel(routeLine('draft', 'A999', 'a', 'b'), bidirectionalSchedule), '3', 'a draft previews the next number within its direction')
assert.deepEqual(buildWorkspace(emptySchedule()), { devices: [], groups: [], locationGroups: [], lines: [], lineCount: 0 })

const locationSchedule = {
  version: 1, revision: 4, nextNumber: 8, devices: routeDevices,
  lines: [
    { ...routeLine('loc-ab', 'A930', 'a', 'b'), fromLocation: ' 桌面 ', toLocation: '机柜' },
    { ...routeLine('loc-ba', 'A931', 'b', 'a'), fromLocation: '机柜', toLocation: '桌面' },
    { ...routeLine('loc-ab-other', 'A932', 'a', 'b'), fromLocation: '舞台', toLocation: '机柜' },
    { id: 'empty-endpoint', code: 'A933', fromDevice: '', fromPort: 'OUT', toDevice: '', toPort: 'IN' },
    { ...routeLine('loc-cd', 'A934', 'c', 'd'), fromLocation: '桌面', toLocation: '机柜' },
  ],
}
const locationWorkspace = buildWorkspace(locationSchedule)
const deskRackGroup = locationWorkspace.groups.find((group) => group.fromLocation === '桌面' && group.toLocation === '机柜')
assert.ok(deskRackGroup, 'position context retains the first route direction')
assert.equal(deskRackGroup.lines.length, 2, 'opposite location and device routes share one device-pair group')
assert.equal(deskRackGroup.bidirectional, true)
assert.equal(deskRackGroup.key, JSON.stringify([JSON.stringify(['location', '桌面', 'device:a']), JSON.stringify(['location', '机柜', 'device:b'])].sort()))
assert.equal(deskRackGroup.fromEndpointLabel, '桌面 / 同名设备 · 1')
assert.equal(deskRackGroup.toEndpointLabel, '机柜 / 同名设备 · 2')
assert.deepEqual(deskRackGroup.lines.map((line) => line.circleLabel), ['1', '2'])
assert.equal(locationWorkspace.groups.find((group) => group.lines.some((line) => line.id === 'loc-ab-other')).lines[0].circleLabel,
  '1', 'a different position pair starts its own continuous numbering')
assert.equal(locationWorkspace.locationGroups.length, 3, 'opposite position pairs share the outer group')
const deskRackLocations = locationWorkspace.locationGroups.find((group) => group.key === deskRackGroup.locationGroupKey)
assert.equal(deskRackLocations.fromLocation, '桌面')
assert.equal(deskRackLocations.toLocation, '机柜')
assert.equal(deskRackLocations.bidirectional, true)
assert.deepEqual(deskRackLocations.groups.map((group) => group.key), [
  deskRackGroup.key,
  locationWorkspace.groups.find((group) => group.lines.some((line) => line.id === 'loc-cd')).key,
], 'device groups retain first-seen order within their location pair')
assert.deepEqual(locationWorkspace.groups.map((group) => group.locationGroupKey),
  locationWorkspace.locationGroups.flatMap((group) => group.groups.map((item) => item.locationGroupKey)),
  'flat groups are contiguous in location-group order')
assert.deepEqual(locationWorkspace.lines.map((line) => line.id), locationSchedule.lines.map((line) => line.id),
  'location grouping preserves original storage order in workspace.lines')
const emptyEndpoint = locationWorkspace.lines.find((line) => line.id === 'empty-endpoint')
assert.equal(emptyEndpoint.fromDeviceName, '')
assert.equal(emptyEndpoint.fromDeviceLabel, '')
assert.equal(emptyEndpoint.fromEndpointLabel, '')
assert.equal(locationWorkspace.devices.some((device) => !device.name), false, 'unnamed endpoints never become placeholder devices')
assert.equal(locationWorkspace.devices.length, routeDevices.length, 'position variants reuse actual device records')
assert.equal(locationWorkspace.devices.find((device) => device.id === 'a').sourceLineCount, 2)
assert.equal(locationWorkspace.devices.find((device) => device.id === 'a').lineCount, 3)

const legacyRoute = { ...routeLine('legacy-route', 'A934', 'a', 'b') }
const legacyKeys = buildWorkspace({ ...bidirectionalSchedule, lines: [legacyRoute] }).groups[0].key
assert.equal(legacyKeys, JSON.stringify(['device:a', 'device:b']), 'empty position keys keep the legacy route key')

assert.deepEqual(generatePortPairs('OUT-01', 'IN-09', '3').pairs, [
  { fromPort: 'OUT-01', toPort: 'IN-09' }, { fromPort: 'OUT-02', toPort: 'IN-10' }, { fromPort: 'OUT-03', toPort: 'IN-11' },
])
assert.deepEqual(generatePortPairs('L', 'R', 1).pairs, [{ fromPort: 'L', toPort: 'R' }])
assert.equal(generatePortPairs('9'.repeat(80), 'IN1', 1).ok, true, '单条预览不对端口文字做数值解释')
assert.equal(generatePortPairs('L', 'IN1', 2).ok, false)
assert.equal(generatePortPairs('OUT9007199254740991', 'IN1', 2).ok, false)
for (const count of ['', 0, 33, '1.5', '2x', null]) assert.equal(generatePortPairs('OUT1', 'IN1', count).ok, false)
assert.equal(generatePortPairs('', 'IN1', 1).ok, false)
assert.deepEqual(deviceNames('接收机', 2).names, ['接收机1', '接收机2'])
assert.deepEqual(deviceNames('RX-09', 2).names, ['RX-09', 'RX-10'])
assert.equal(deviceNames('x'.repeat(100), 1).ok, false)
assert.equal(deviceNames('', 1).ok, false)
assert.equal(deviceNames('音箱', 33).ok, false)
console.log('project wiring workspace model passed (instance grouping, stable labels, blank metadata, editable sequential previews)')

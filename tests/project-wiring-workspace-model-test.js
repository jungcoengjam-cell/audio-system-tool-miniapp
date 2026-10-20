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
assert.deepEqual(workspace.groups.map((group) => group.lines.map((line) => line.circleLabel)), [['1', '4'], ['2'], ['3']])
assert.equal(workspace.lines[0].specLabel, '待补')
assert.equal(workspace.lines[0].connectorALabel, '待补')
assert.equal(workspace.lines[3].lengthLabel, '8 m')
assert.equal(workspace.devices.find((device) => device.id === first).lineCount, 2)
assert.equal(workspace.devices.find((device) => device.id === target).lineCount, 3)
assert.equal(workspace.devices.filter((device) => device.name === '调音台').length, 3)
assert.equal(new Set(workspace.devices.filter((device) => device.name === '调音台').map((device) => device.choiceLabel)).size, 3)
const deleted = applyScheduleChange(changed.schedule, { type: 'delete', id: changed.lineIds[0] })
assert.deepEqual(buildWorkspace(deleted.schedule).lines.map((line) => line.circleLabel), ['1', '2', '3'], 'deleted rows receive contiguous display ordinals')
assert.deepEqual(deleted.schedule.lines.map((line) => line.code), changed.schedule.lines.slice(1).map((line) => line.code), 'display ordinals do not rewrite persistent line codes')
assert.equal(circleLabel({ code: 'A00025' }), '25')
assert.equal(circleLabel({ code: 'SITE-7' }), 'SITE-7', '自定义线号原样保留，不另行分配编号')
const renamed = { ...changed.schedule, devices: changed.schedule.devices.map((device) => device.id === first ? { ...device, name: '主调音台' } : device) }
assert.equal(buildWorkspace(renamed).groups[0].fromDevice, '主调音台')
assert.equal(buildWorkspace(renamed).groups[0].key, workspace.groups[0].key, '分组身份不依赖展示名称')
assert.deepEqual(buildWorkspace(emptySchedule()), { devices: [], groups: [], lines: [], lineCount: 0 })

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

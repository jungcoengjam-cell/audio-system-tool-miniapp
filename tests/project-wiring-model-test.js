const assert = require('assert/strict')
const wiring = require('../utils/project-wiring')

const baseLine = {
  purpose: '调音台到功放',
  fromDevice: '调音台',
  fromPort: 'MAIN L',
  toDevice: '功放',
  toPort: 'CH1',
  buildType: 'bulk',
  cableType: 'balanced',
  spec: '2芯屏蔽线',
  connectorA: 'xlrFemale',
  connectorB: 'xlrMale',
  lengthText: '22',
  status: 'pending',
  notes: '',
}

function change(schedule, command) {
  const result = wiring.applyScheduleChange(schedule, command)
  assert.equal(result.ok, true, result.error)
  return result
}

let schedule = wiring.emptySchedule()
assert.deepEqual(schedule, { version: 1, revision: 0, nextNumber: 1, lines: [] })
let result = change(schedule, { type: 'upsert', line: baseLine })
schedule = result.schedule
const firstId = result.lineIds[0]
assert.equal(schedule.lines[0].id, firstId)
assert.equal(schedule.lines[0].code, 'A001')
assert.equal(schedule.revision, 1)

let summary = wiring.buildMaterialSummary(schedule)
assert.equal(summary.knownLengthText, '22 m')
assert.equal(summary.unknownLengthCount, 0)
assert.equal(summary.bulk[0].quantity, 22)
assert.equal(summary.bulk[0].unit, 'm')
assert.equal(summary.bulk[0].totalLengthText, '22 m')
assert.equal(summary.connectors.length, 2)
assert.equal(summary.labels.length, 2)
assert.deepEqual(summary.labels.map((label) => label.direction), ['to', 'from'])

result = change(schedule, { type: 'upsert', line: {
  ...baseLine,
  fromPort: 'MAIN R',
  toPort: 'CH2',
  lengthText: '',
  connectorA: '',
  connectorB: '',
} })
schedule = result.schedule
assert.equal(schedule.lines[1].code, 'A002')
summary = wiring.buildMaterialSummary(schedule)
assert.equal(summary.knownLengthText, '22 m')
assert.equal(summary.unknownLengthCount, 1)
assert.equal(summary.bulk[0].totalLengthText, '22 m + 1 条长度待确认')
assert.equal(summary.bulk[0].quantity, 22, '未知长度不加入已知米数')
assert.equal(summary.connectors.find((row) => row.key === 'connector:__unknown__').quantity, null)
assert.equal(summary.connectors.find((row) => row.key === 'connector:__unknown__').totalLengthText, '2 个待确认')

result = change(schedule, { type: 'upsert', line: {
  ...baseLine,
  buildType: 'finished',
  lengthText: '3.5',
} })
schedule = result.schedule
assert.equal(schedule.lines[2].code, 'A003')
summary = wiring.buildMaterialSummary(schedule)
assert.equal(summary.finished.length, 1)
assert.equal(summary.finished[0].quantity, 1)
assert.equal(summary.finished[0].unit, '条')
assert.equal(summary.finished[0].totalLengthText, '3.5 m')
assert.equal(summary.connectors.find((row) => row.key === 'connector:xlrFemale').quantity, 1,
  '成品线的接头不重复计入散件')
assert.equal(summary.connectors.find((row) => row.key === 'connector:xlrMale').quantity, 1,
  '成品线的接头不重复计入散件')

const duplicate = wiring.applyScheduleChange(schedule, { type: 'duplicate', id: schedule.lines[2].id })
assert.equal(duplicate.ok, true)
assert.equal(duplicate.schedule.lines[3].code, 'A004')
assert.equal(duplicate.schedule.lines[3].status, 'pending', '复制已核对线路后状态重置')
assert.notEqual(duplicate.schedule.lines[3].id, schedule.lines[2].id)

const editedCode = wiring.applyScheduleChange(schedule, { type: 'upsert', line: { ...baseLine, code: ' a006 ' } })
assert.equal(editedCode.ok, true)
assert.equal(editedCode.schedule.lines[3].code, 'a006')
const afterManualCode = wiring.applyScheduleChange(editedCode.schedule, { type: 'upsert', line: baseLine })
assert.equal(afterManualCode.ok, true)
assert.equal(afterManualCode.schedule.lines[4].code, 'A004', '手工编号不会造成自动编号重号')

const duplicateCode = wiring.applyScheduleChange(afterManualCode.schedule, {
  type: 'upsert', line: { ...baseLine, code: ' a001 ' },
})
assert.equal(duplicateCode.ok, false)
assert.match(duplicateCode.error, /编号已存在/)
assert.equal(duplicateCode.schedule.revision, afterManualCode.schedule.revision)

const deleted = wiring.applyScheduleChange(afterManualCode.schedule, { type: 'delete', id: firstId })
assert.equal(deleted.ok, true)
const afterDelete = wiring.applyScheduleChange(deleted.schedule, { type: 'upsert', line: baseLine })
assert.equal(afterDelete.schedule.lines.at(-1).code, 'A005', '删除线路不回收自动编号')

const invalidLength = wiring.applyScheduleChange(wiring.emptySchedule(), {
  type: 'upsert', line: { ...baseLine, lengthText: '0' },
})
assert.equal(invalidLength.ok, false)
assert.match(invalidLength.error, /长度需大于 0/)
assert.equal(invalidLength.schedule.lines.length, 0)
for (const lengthText of ['1000000.01', '1000001', '1e2', 'Infinity']) {
  const invalidBound = wiring.applyScheduleChange(wiring.emptySchedule(), {
    type: 'upsert', line: { ...baseLine, lengthText },
  })
  assert.equal(invalidBound.ok, false)
  assert.match(invalidBound.error, /不超过 1000000 m/)
}
const upperBound = change(wiring.emptySchedule(), { type: 'upsert', line: { ...baseLine, lengthText: '1000000.00' } })
assert.equal(upperBound.schedule.lines[0].lengthText, '1000000')
assert.equal(wiring.buildMaterialSummary(upperBound.schedule).knownLengthText, '1000000 m')
for (const lengthText of [8, NaN, {}, ['8']]) {
  const invalidType = wiring.applyScheduleChange(wiring.emptySchedule(), {
    type: 'upsert', line: { ...baseLine, lengthText },
  })
  assert.equal(invalidType.ok, false, '非字符串长度不可变成未知长度')
  assert.equal(invalidType.schedule.lines.length, 0)
}

const canonicalLengths = wiring.applyScheduleChange(wiring.emptySchedule(), {
  type: 'batch', line: { ...baseLine, lengthText: '08.00' }, count: 2,
  fromPrefix: 'OUT-', fromStart: '1', toPrefix: 'IN-', toStart: '1',
})
assert.equal(canonicalLengths.ok, true)
assert.deepEqual(canonicalLengths.schedule.lines.map((line) => line.lengthText), ['8', '8'])
assert.equal(wiring.buildMaterialSummary(canonicalLengths.schedule).finished.length, 0)
const finishedLengths = wiring.applyScheduleChange(wiring.emptySchedule(), {
  type: 'batch', line: { ...baseLine, buildType: 'finished', lengthText: '08.00' }, count: 2,
  fromPrefix: 'OUT-', fromStart: 1, toPrefix: 'IN-', toStart: 1,
})
assert.equal(wiring.buildMaterialSummary(finishedLengths.schedule).finished.length, 1,
  '同长成品线归为一类')
let equivalentLengths = wiring.emptySchedule()
for (const [index, lengthText] of ['8', '8.0', '08.00'].entries()) {
  equivalentLengths = change(equivalentLengths, {
    type: 'upsert',
    line: { ...baseLine, buildType: 'finished', fromPort: `OUT-${index}`, toPort: `IN-${index}`, lengthText },
  }).schedule
}
assert.deepEqual(equivalentLengths.lines.map((line) => line.lengthText), ['8', '8', '8'])
assert.equal(wiring.buildMaterialSummary(equivalentLengths).finished[0].quantity, 3,
  '8、8.0、08.00等价长度归为同类成品线')

const batch = wiring.applyScheduleChange(wiring.emptySchedule(), {
  type: 'batch', line: baseLine, count: 3, fromPrefix: 'OUT-', fromStart: 1, toPrefix: 'IN ', toStart: 4,
})
assert.equal(batch.ok, true)
assert.deepEqual(batch.schedule.lines.map((line) => line.code), ['A001', 'A002', 'A003'])
assert.deepEqual(batch.schedule.lines.map((line) => line.fromPort), ['OUT-1', 'OUT-2', 'OUT-3'])
assert.deepEqual(batch.schedule.lines.map((line) => line.toPort), ['IN 4', 'IN 5', 'IN 6'])
assert.equal(batch.schedule.lines.every((line) => line.status === 'pending'), true)

const badBatch = wiring.applyScheduleChange(wiring.emptySchedule(), {
  type: 'batch', line: { ...baseLine, id: firstId }, count: 2,
  fromPrefix: 'OUT-', fromStart: 1, toPrefix: 'IN-', toStart: 1,
})
assert.equal(badBatch.ok, false)
assert.equal(badBatch.schedule.lines.length, 0)
const atomicBatch = wiring.applyScheduleChange(wiring.emptySchedule(), {
  type: 'batch', line: { ...baseLine, lengthText: '2.555' }, count: 2,
  fromPrefix: 'OUT-', fromStart: 1, toPrefix: 'IN-', toStart: 1,
})
assert.equal(atomicBatch.ok, false)
assert.equal(atomicBatch.schedule.lines.length, 0)
for (const count of [true, {}, [], '']) {
  assert.equal(wiring.applyScheduleChange(wiring.emptySchedule(), {
    type: 'batch', line: baseLine, count, fromPrefix: 'O', fromStart: 1, toPrefix: 'I', toStart: 1,
  }).ok, false, 'batch count不接受非数字或空值')
}
for (const start of [true, {}, [], '']) {
  assert.equal(wiring.applyScheduleChange(wiring.emptySchedule(), {
    type: 'batch', line: baseLine, count: 1, fromPrefix: 'O', fromStart: start, toPrefix: 'I', toStart: 1,
  }).ok, false, 'batch起始值不接受非数字或空值')
}
assert.equal(wiring.applyScheduleChange({ version: 1, revision: Number.MAX_SAFE_INTEGER,
  nextNumber: 1, lines: [] }, { type: 'delete', id: 'missing' }).ok, false)
assert.equal(wiring.applyScheduleChange({ version: 1, revision: 0,
  nextNumber: Number.MAX_SAFE_INTEGER, lines: [] }, { type: 'upsert', line: baseLine }).ok, false)

const atCapacity = wiring.normalizeSchedule({
  version: 1, revision: 9, nextNumber: 201,
  lines: Array.from({ length: 200 }, (_, index) => ({
    id: `id-${index}`, code: `Z${index}`, ...baseLine, fromPort: `OUT-${index}`, toPort: `IN-${index}`,
  })),
})
const full = wiring.applyScheduleChange(atCapacity, { type: 'upsert', line: baseLine })
assert.equal(full.ok, false)
assert.match(full.error, /最多可保存 200 条/)

const text = wiring.buildScheduleText('演示工程', schedule)
assert.match(text, /演示工程｜布线清单/)
assert.match(text, /A001/)
assert.match(text, /源端贴签：A001 → 功放 \/ CH1/)
assert.match(text, /目的端贴签：A001 ← 调音台 \/ MAIN L/)
assert.match(text, /材料汇总/)
assert.doesNotMatch(text, /总长 \d+ 个/, '接头数量不可标成线材长度')
assert.equal(wiring.normalizeSchedule(undefined).revision, 0)
for (const options of [wiring.STATUS_OPTIONS, wiring.BUILD_OPTIONS, wiring.CABLE_OPTIONS, wiring.CONNECTOR_OPTIONS]) {
  assert(options.every((option) => typeof option.id === 'string' && typeof option.label === 'string'))
}

console.log('project wiring model test passed')

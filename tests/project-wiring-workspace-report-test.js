const assert = require('assert/strict')
const { buildScheduleReportPages, drawScheduleReport } = require('../pages/project-wiring/report')
const { buildWorkspace } = require('../pages/project-wiring/workspace-model')
const { normalizeSchedule } = require('../utils/project-wiring')

const clone = (value) => JSON.parse(JSON.stringify(value))
const makeLine = (index, overrides = {}) => ({
  id: 'line-' + index, code: 'A' + String(index).padStart(3, '0'),
  purpose: 'kept outside this export', fromDevice: 'Receiver', fromPort: 'OUT ' + index,
  toDevice: 'Mixer', toPort: 'IN ' + index, buildType: 'bulk', cableType: 'balanced',
  spec: 'RVPE 2\u00d70.5 mm\u00b2', connectorA: 'xlrFemale', connectorB: 'xlrMale',
  lengthText: '3', status: 'checked', notes: 'not part of the project overview', ...overrides,
})
const makeSchedule = (lines, devices) => ({ version: 1, revision: 7, nextNumber: 500, lines, ...(devices ? { devices } : {}) })
const lineRows = (report) => report.pages.flatMap((page) => page.rows.filter((row) => row.kind === 'project-line'))
const getFieldText = (row, field) => row.drawItems.filter((item) => item.fieldId === field).map((item) => item.text).join('')

function assertPagesFit(report) {
  report.pages.forEach((page, pageIndex) => {
    assert.equal(page.type, 'project')
    assert.equal(page.width, 720)
    assert.ok(page.height <= 1750)
    assert.equal(page.pageNumber, pageIndex + 1)
    assert.equal(page.pageCount, report.pages.length)
    assert.equal(page.rows[0].kind, 'project-group', 'every page repeats its device-pair heading')
    assert.equal(page.rows[1].kind, 'project-columns', 'every page repeats its column headings')
    assert.equal(Object.hasOwn(page, 'footer'), false)
    page.rows.forEach((row, index) => {
      assert.ok(row.y + row.height <= page.height - 32, 'content retains the bottom margin')
      if (index > 0) assert.ok(page.rows[index - 1].y + page.rows[index - 1].height <= row.y)
      row.drawItems.forEach((item) => {
        assert.ok(item.bounds.x >= 20 && item.bounds.x + item.bounds.width <= 700)
        assert.ok(item.bounds.y >= row.y && item.bounds.y + item.bounds.height <= row.y + row.height)
        assert.ok(item.x >= item.bounds.x && item.x <= item.bounds.x + item.bounds.width)
        assert.ok(!item.text.includes('\u2026'), 'full field text is wrapped rather than ellipsized')
      })
      if (row.kind === 'project-columns') {
        assert.deepEqual(row.drawItems.map((item) => item.fieldId), [
          'header.displayNumber', 'header.ports', 'header.spec', 'header.length', 'header.connectors',
        ])
        assert.equal(row.drawItems[0].text, '\u7f16\u53f7')
      }
      if (row.kind !== 'project-line') return
      assert.equal(Object.hasOwn(row, 'primitives'), false, 'project rows do not contain number-circle primitives')
      for (const field of ['displayNumber', 'ports', 'spec', 'length', 'connectors']) {
        assert.equal(getFieldText(row, field), row.fields[field], field + ' remains complete in draw items')
      }
    })
  })
}

const devices = [
  { id: 'receiver-a', type: 'receiver', name: 'Receiver A' },
  { id: 'receiver-b', type: 'receiver', name: 'Receiver B' },
  { id: 'mixer', type: 'mixer', name: 'Mixer' },
]
const groupedSchedule = makeSchedule([
  makeLine(1, { fromDeviceId: 'receiver-a', toDeviceId: 'mixer' }),
  makeLine(3, { fromDeviceId: 'receiver-b', toDeviceId: 'mixer' }),
  makeLine(7, { fromDeviceId: 'receiver-a', toDeviceId: 'mixer' }),
  makeLine(9),
], devices)
const before = clone(groupedSchedule)
const grouped = buildScheduleReportPages('Portable Rig', groupedSchedule, 'project')
assert.deepEqual(groupedSchedule, before, 'presentation does not mutate IDs, codes, order or legacy fields')
assert.equal(grouped.type, 'project')
assert.equal(grouped.lineCount, 4)
const groups = grouped.pages.flatMap((page) => page.rows.filter((row) => row.kind === 'project-group'))
assert.equal(new Set(groups.map((group) => group.groupKey)).size, 3,
  'same-named device IDs and the legacy text namespace remain separate')
assert.deepEqual(lineRows(grouped).map((line) => line.lineId), ['line-1', 'line-7', 'line-3', 'line-9'])
assert.deepEqual(lineRows(grouped).map((line) => line.displayNumber), ['1', '3', '2', '4'],
  'plain display numbers preserve the full-schedule order across device groups')
assert.ok(!grouped.text.includes('A001'))
assert.ok(!grouped.text.includes('kept outside this export'))
assert.ok(!grouped.text.includes('not part of the project overview'))
assert.equal(grouped.pages[0].subtitleLines[0], '\u5171 4 \u6761\u7ebf\u8def')
assertPagesFit(grouped)
assert.deepEqual(buildScheduleReportPages('Portable Rig', groupedSchedule, 'project'), grouped,
  'the shared project action is deterministic across both workspace tabs')
assert.ok(Object.isFrozen(grouped) && Object.isFrozen(grouped.pages[0].rows[0]))

const common = lineRows(grouped)[0]
assert.deepEqual(Object.keys(common.fields).slice(0, 5), ['displayNumber', 'ports', 'spec', 'length', 'connectors'])
assert.equal(common.fields.ports, 'OUT 1 \u2192 IN 1')
assert.equal(common.fields.spec, 'RVPE 2\u00d70.5 mm\u00b2')
assert.equal(common.fields.length, '3 m')
const standardLine = buildWorkspace(groupedSchedule).lines.find((line) => line.id === 'line-1')
assert.equal(common.fields.connectors, standardLine.connectorALabel + ' \u2192 ' + standardLine.connectorBLabel)
assert.equal(common.fields.displayNumber, String(standardLine.displayNumber))
assert.ok(common.height >= 50 && common.height <= 64, 'ordinary complete lines use a compact readable row')
for (const field of ['ports', 'spec', 'length', 'connectors']) {
  assert.equal(common.drawItems.filter((item) => item.fieldId === field).length, 1, field + ' shares the ordinary row baseline')
}

const incomplete = buildScheduleReportPages('Incomplete', makeSchedule([
  makeLine(1, { spec: '', lengthText: '', connectorA: '', connectorB: '' }),
]), 'project')
const incompleteRow = lineRows(incomplete)[0]
assert.equal(incompleteRow.fields.spec, '\u5f85\u586b\u5199')
assert.equal(incompleteRow.fields.length, '\u5f85\u786e\u8ba4')
assert.equal(incompleteRow.fields.connectors, '\u5f85\u586b\u5199 \u2192 \u5f85\u586b\u5199')
assert.ok(incompleteRow.height <= 70, 'concise missing-value labels stay compact')
assertPagesFit(incomplete)

for (const count of [100, 200]) {
  const schedule = makeSchedule(Array.from({ length: count }, (_, index) => makeLine(index + 1)))
  const report = buildScheduleReportPages('Pagination ' + count, schedule, 'project')
  assert.ok(report.pages.length > 1)
  assert.equal(lineRows(report).length, count)
  assert.deepEqual(lineRows(report).map((row) => row.lineId), schedule.lines.map((line) => line.id))
  assert.equal(lineRows(report).at(-1).displayNumber, String(count))
  assert.equal(new Set(lineRows(report).map((row) => row.lineId)).size, count)
  lineRows(report).forEach((row) => {
    const number = row.drawItems.filter((item) => item.fieldId === 'displayNumber')
    assert.equal(number.length, 1, 'each plain display number draws once')
    assert.equal(number[0].text, row.displayNumber)
    assert.equal((row.primitives || []).length, 0, 'number rendering has no circle or capsule primitive')
  })
  assertPagesFit(report)
}

const maxLine = makeLine(1, {
  code: 'CUSTOM-LINE-0123456789-ABCDEFGHIJKLMN',
  fromDevice: 'Source device '.repeat(7).slice(0, 100), toDevice: 'Destination device '.repeat(6).slice(0, 100),
  fromPort: 'SOURCE-PORT-'.repeat(8).slice(0, 80), toPort: 'TARGET-PORT-'.repeat(7).slice(0, 80),
  spec: 'SPECIFICATION-'.repeat(9).slice(0, 120), connectorA: 'SOURCE-CONNECTOR-'.repeat(4).slice(0, 60),
  connectorB: 'TARGET-CONNECTOR-'.repeat(4).slice(0, 60), lengthText: '1000000.00',
})
const maxSchedule = makeSchedule([maxLine])
const maxReport = buildScheduleReportPages('Long project name '.repeat(6).slice(0, 100), maxSchedule, 'project')
const normalized = buildWorkspace(maxSchedule).lines[0]
const maxRow = lineRows(maxReport)[0]
assert.equal(getFieldText(maxRow, 'displayNumber'), String(normalized.displayNumber))
assert.equal(getFieldText(maxRow, 'ports'), normalized.fromPort + ' \u2192 ' + normalized.toPort)
assert.equal(getFieldText(maxRow, 'spec'), normalized.specLabel)
assert.equal(getFieldText(maxRow, 'length'), normalized.lengthLabel)
assert.equal(getFieldText(maxRow, 'connectors'), normalized.connectorALabel + ' \u2192 ' + normalized.connectorBLabel)
assert.ok(maxRow.height > 70, 'long fields expand their row instead of clipping')
assert.ok(maxRow.height < 900, 'long legal fields remain a single bounded page row')
const maxGroup = maxReport.pages[0].rows[0]
assert.equal(getFieldText(maxGroup, 'from.device'), normalized.fromDeviceName)
assert.equal(getFieldText(maxGroup, 'to.device'), normalized.toDeviceName)
assert.equal(maxReport.pages[0].nameLines.join(''), 'Long project name '.repeat(6).slice(0, 100))
assertPagesFit(maxReport)

const importedLine = makeLine(1, {
  fromPort: 'SOURCE\nPORT', toPort: 'TARGET\rPORT', spec: 'SPEC\nVALUE',
  connectorA: 'custom', connectorB: 'bareWire', lengthText: '',
})
const importedSchedule = makeSchedule([importedLine])
const importedBefore = clone(importedSchedule)
const imported = buildScheduleReportPages('Imported', importedSchedule, 'project')
const importedRow = lineRows(imported)[0]
assert.deepEqual(importedSchedule, importedBefore, 'display whitespace does not rewrite imported data')
assert.equal(importedRow.fields.ports, 'SOURCE PORT \u2192 TARGET PORT')
assert.equal(importedRow.fields.spec, 'SPEC VALUE')
assert.equal(importedRow.fields.length, '\u5f85\u786e\u8ba4')
assert.equal(importedRow.fields.raw.fromPort, 'SOURCE\nPORT')
assertPagesFit(imported)

function mockContext() {
  const calls = []
  const methods = new Set(['setFillStyle', 'setStrokeStyle', 'setLineWidth', 'setFontSize',
    'setTextAlign', 'setTextBaseline', 'fillRect', 'fillText', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc'])
  const context = new Proxy({}, {
    get(target, key) { return methods.has(key) ? (...args) => calls.push([key, ...args]) : target[key] },
    set(target, key, value) { target[key] = value; calls.push(['set', key, value]); return true },
  })
  return { context, calls }
}
for (const report of [grouped, incomplete, maxReport, imported]) {
  report.pages.forEach((page) => {
    const light = mockContext()
    const dark = mockContext()
    drawScheduleReport(light.context, page, { theme: 'light' })
    drawScheduleReport(dark.context, page, { theme: 'dark' })
    assert.deepEqual(light.calls, dark.calls, 'project export remains a shared white template')
    assert.deepEqual(light.calls[0], ['setFillStyle', '#ffffff'])
    const drawn = light.calls.filter(([method]) => method === 'fillText').map(([, text]) => text)
    page.rows.flatMap((row) => row.drawItems).forEach((item) => assert.ok(drawn.includes(item.text), 'Canvas draws ' + item.fieldId))
    assert.equal(light.calls.filter(([method]) => method === 'arc').length, 0,
      'project Canvas draws plain numbers without number circles or endpoint/cable diagrams')
  })
}
for (const type of ['lines', 'materials', 'labels']) {
  const legacy = buildScheduleReportPages('Legacy', makeSchedule([makeLine(1)]), type)
  assert.equal(legacy.type, type)
  assert.ok(legacy.pages.length)
  drawScheduleReport(mockContext().context, legacy.pages[0], { theme: 'dark' })
}
assert.deepEqual(buildScheduleReportPages('Empty', makeSchedule([]), 'project').pages, [])
console.log('project wiring workspace report tests passed')

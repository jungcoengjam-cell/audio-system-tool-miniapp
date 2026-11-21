const assert = require('assert/strict')
const { buildProjectWiringLongReport, buildScheduleReportPages, drawScheduleReport } = require('../pages/project-wiring/report')
const { buildWorkspace } = require('../pages/project-wiring/workspace-model')
const { buildReportPayload, getProjectReportSections } = require('../pages/records/report-model')
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
assert.deepEqual(lineRows(grouped).map((line) => line.displayNumber), ['1', '2', '1', '1'],
  'paged report numbering follows each device-pair group and its direction order')
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

const longDevices = [
  { id: 'console', type: 'mixer', name: '\u8c03\u97f3\u53f0' },
  { id: 'rack', type: 'dsp', name: '\u97f3\u9891\u673a\u67dc' },
]
const longSchedule = makeSchedule([
  makeLine(1, { fromDeviceId: 'console', toDeviceId: 'rack', fromDevice: '\u8c03\u97f3\u53f0',
    toDevice: '\u97f3\u9891\u673a\u67dc', spec: 'RVPE2*0.5', fromPort: 'OUT 1', toPort: 'IN 1' }),
  makeLine(2, { fromDeviceId: 'console', toDeviceId: 'rack', fromDevice: '\u8c03\u97f3\u53f0',
    toDevice: '\u97f3\u9891\u673a\u67dc', spec: 'RVPE2*0.5', fromPort: 'OUT 2', toPort: 'IN 2' }),
  makeLine(3, { fromDeviceId: 'rack', toDeviceId: 'console', fromDevice: '\u97f3\u9891\u673a\u67dc',
    toDevice: '\u8c03\u97f3\u53f0', spec: 'AES/EBU', fromPort: 'OUT 3', toPort: 'IN 3' }),
], longDevices)
const longReport = buildProjectWiringLongReport('Long Wiring', longSchedule)
assert.equal(longReport.type, 'project')
assert.equal(longReport.title, '\u9879\u76ee\u7ebf\u8def\u6e05\u5355')
assert.equal(longReport.lineCount, 3)
assert.equal(longReport.page.type, 'project')
assert.equal(longReport.page.rows[0].kind, 'project-group')
assert.ok(longReport.page.rows[0].drawItems.some((item) => item.fieldId === 'group.direction' && item.text === '\u2194'),
  'bidirectional device pairs use a double arrow in the group heading')
const directionHeadings = longReport.page.rows.filter((row) => row.kind === 'project-direction')
assert.deepEqual(directionHeadings.map((row) => row.drawItems.map((item) => item.text).join('')),
  ['\u8c03\u97f3\u53f0 \u2192 \u97f3\u9891\u673a\u67dc', '\u97f3\u9891\u673a\u67dc \u2192 \u8c03\u97f3\u53f0'])
const cableSummaries = longReport.page.rows.filter((row) => row.kind === 'project-cable-summary')
assert.deepEqual(cableSummaries.map((row) => row.summary), [
  ['RVPE2*0.5 \u00d7 2 \u6761'],
  ['AES/EBU \u00d7 1 \u6761'],
], 'each direction summarizes its own original cable specs')
assert.deepEqual(lineRows({ pages: [longReport.page] }).map((row) => row.displayNumber), ['1', '2', '3'],
  'both directions share one continuous numbering sequence')
assert.equal(longReport.page.rows.filter((row) => row.kind === 'project-columns').length, 2)
assert.equal(longReport.page.layout, 'long-image')
assert.equal(longReport.page.groupBounds.length, 1, 'one outer frame covers the full bidirectional group')
const longGroupFrame = longReport.page.groupBounds[0]
assert.deepEqual([longGroupFrame.x, longGroupFrame.width], [20, 680])
assert.ok(longGroupFrame.y < longReport.page.rows[0].y)
assert.ok(longReport.page.rows.filter((row) => row.y >= longGroupFrame.y
  && row.y < longGroupFrame.y + longGroupFrame.height)
  .every((row) => row.y >= longGroupFrame.y && row.y + row.height <= longGroupFrame.y + longGroupFrame.height),
'the group frame contains both directions, their summaries, headers and lines')
const longGroupHeading = longReport.page.rows.find((row) => row.kind === 'project-group')
assert.ok(longGroupHeading.drawItems.filter((item) => ['from.device', 'to.device'].includes(item.fieldId))
  .every((item) => item.fontSize >= 25 && item.weight >= 650 && item.colorRole === 'inverse'))
assert.ok(longGroupHeading.drawItems.find((item) => item.fieldId === 'group.direction').fontSize >= 24)
assert.equal(longGroupHeading.longImageStyle, 'major')
assert.ok(directionHeadings.every((row) => row.longImageStyle === 'direction'
  && row.drawItems.every((item) => item.fontSize >= 20 && item.weight >= 650
    && item.colorRole === 'directionText')))
const secondDirectionIndex = longReport.page.rows.indexOf(directionHeadings[1])
const firstDirectionLineRows = longReport.page.rows.slice(
  longReport.page.rows.indexOf(directionHeadings[0]) + 1, secondDirectionIndex)
  .filter((row) => row.kind === 'project-line')
const lastFirstDirectionLine = firstDirectionLineRows.at(-1)
assert.ok(directionHeadings[1].y - (lastFirstDirectionLine.y + lastFirstDirectionLine.height) >= 20,
  'the reverse direction is visibly separated from the preceding direction')
assert.deepEqual(cableSummaries.flatMap((row) => row.drawItems
  .filter((item) => item.fieldId === 'cable-summary.count').map((item) => item.text)),
['\u00d7 2 \u6761', '\u00d7 1 \u6761'])
assert.ok(cableSummaries.every((row) => row.longImageStyle === 'summary' && row.height >= 55
  && row.drawItems.some((item) => item.fieldId === 'cable-summary.spec')
  && row.drawItems.some((item) => item.fieldId === 'cable-summary.count')))
assert.ok(cableSummaries.every((row) => row.drawItems
  .filter((item) => item.fieldId === 'cable-summary.count')
  .every((item) => item.fontSize >= 29 && item.weight >= 700 && item.colorRole === 'summaryCount')))
assert.ok(cableSummaries.every((row) => row.drawItems
  .filter((item) => item.fieldId === 'cable-summary.spec')
  .every((item) => item.fontSize >= 20 && item.weight >= 600 && item.colorRole === 'secondary')))
const summaryTitle = longReport.page.rows.find((row) => row.kind === 'project-cable-summary-title')
assert.ok(summaryTitle.drawItems.every((item) => item.fontSize >= 20 && item.weight >= 600))

const longChineseSpec = '\u8d85\u957f\u4e2d\u6587\u7ebf\u7f06\u89c4\u683c'.repeat(10)
const longLatinSpec = 'AUDIO-CABLE-ULTRA-LONG-SPECIFICATION-'.repeat(3)
const wrappedSummary = buildProjectWiringLongReport('Wrapped summary', makeSchedule([
  makeLine(1, { spec: longChineseSpec }),
  makeLine(2, { spec: longLatinSpec }),
  makeLine(3, { spec: longChineseSpec }),
])).page
const wrappedSummaryRow = wrappedSummary.rows.find((row) => row.kind === 'project-cable-summary')
const wrappedSpecs = wrappedSummaryRow.drawItems.filter((item) => item.fieldId === 'cable-summary.spec')
const wrappedCounts = wrappedSummaryRow.drawItems.filter((item) => item.fieldId === 'cable-summary.count')
assert.deepEqual(wrappedSummaryRow.summary, [
  longChineseSpec + ' \u00d7 2 \u6761',
  longLatinSpec + ' \u00d7 1 \u6761',
])
assert.ok(wrappedSpecs.length > 2, 'long Chinese and Latin specs wrap into readable lines')
assert.deepEqual(wrappedCounts.map((item) => item.text), ['\u00d7 2 \u6761', '\u00d7 1 \u6761'])
assert.equal(wrappedSpecs[0].bounds.y + wrappedSpecs[0].fontSize,
  wrappedCounts[0].bounds.y + wrappedCounts[0].fontSize,
  'the first count and spec line share a baseline')
assert.ok(wrappedSpecs.every((item) => item.bounds.x + item.bounds.width < wrappedCounts[0].bounds.x),
  'spec and count columns keep a visible gutter after wrapping')
const twoHundredCableSummary = buildProjectWiringLongReport('200 cable count', makeSchedule(
  Array.from({ length: 200 }, (_, index) => makeLine(index + 1, { spec: 'CAT6' })),
)).page
const maximumCountItems = twoHundredCableSummary.rows.find((row) => row.kind === 'project-cable-summary')
  .drawItems.filter((item) => item.fieldId === 'cable-summary.count')
assert.deepEqual(maximumCountItems.map((item) => item.text), ['\u00d7 200 \u6761'])
assert.equal(maximumCountItems[0].fontSize, 30, 'the maximum supported summary count stays on one bold line')
assert.ok(maximumCountItems[0].bounds.x + maximumCountItems[0].bounds.width <= 700)

const multiGroupSchedule = makeSchedule([
  ...longSchedule.lines,
  makeLine(4, { fromDeviceId: 'console', toDeviceId: 'amp', fromDevice: '\u8c03\u97f3\u53f0',
    toDevice: '\u529f\u653e', spec: 'CAT6' }),
], [...longDevices, { id: 'amp', type: 'amplifier', name: '\u529f\u653e' }])
const multiGroup = buildProjectWiringLongReport('Multi group', multiGroupSchedule).page
assert.equal(multiGroup.groupBounds.length, 2)
assert.ok(multiGroup.groupBounds[1].y - (multiGroup.groupBounds[0].y + multiGroup.groupBounds[0].height) >= 32,
  'separate device-pair groups have at least 32px of open space')
const secondGroupHeading = multiGroup.rows.find((row) => row.kind === 'project-group'
  && row.groupKey === multiGroup.groupBounds[1].key)
assert.equal(secondGroupHeading.drawItems.find((item) => item.fieldId === 'group.direction').text, '\u2192',
  'a one-way group shows its direction directly in the large heading')
assert.equal(multiGroup.rows.filter((row) => row.kind === 'project-direction').length, 2,
  'a single-direction group has no duplicate child heading')

const longDeviceName = '\u8bbe\u5907\u5b8c\u6574\u540d\u79f0'.repeat(16)
const longNameReport = buildProjectWiringLongReport('Long device name', makeSchedule([
  makeLine(5, { fromDevice: longDeviceName, toDevice: '\u673a\u67dc' }),
])).page
const longNameHeading = longNameReport.rows.find((row) => row.kind === 'project-group')
assert.equal(longNameHeading.drawItems.filter((item) => item.fieldId === 'from.device')
  .map((item) => item.text).join(''), longDeviceName, 'long group names wrap without loss or clipping')
assert.ok(longNameHeading.height > 100)

const incompleteLong = buildProjectWiringLongReport('Incomplete', makeSchedule([
  makeLine(4, { spec: '' }),
]))
assert.deepEqual(incompleteLong.page.rows.find((row) => row.kind === 'project-cable-summary').summary,
  ['\u89c4\u683c\u5f85\u586b\u5199 \u00d7 1 \u6761'], 'blank specs use the report-only missing-spec label')
assert.equal(incompleteLong.page.rows.filter((row) => row.kind === 'project-direction').length, 0,
  'one-way groups use their direction arrow in the group heading without a duplicate subheading')

const optionalEndpointDevices = [
  { id: 'console', type: 'mixer', name: '\u8c03\u97f3\u53f0' },
  { id: 'rack', type: 'dsp', name: 'DSP' },
  { id: 'amp', type: 'amplifier', name: '\u529f\u653e' },
]
const optionalEndpointSchedule = makeSchedule([
  makeLine(6, { fromDeviceId: 'console', toDeviceId: 'rack', fromDevice: '\u8c03\u97f3\u53f0', toDevice: 'DSP',
    fromLocation: '\u63a7\u5236\u5ba4', toLocation: '\u673a\u67dc\u95f4', spec: 'RVPE2*0.5' }),
  makeLine(7, { fromDeviceId: 'rack', toDeviceId: 'console', fromDevice: 'DSP', toDevice: '\u8c03\u97f3\u53f0',
    fromLocation: '\u673a\u67dc\u95f4', toLocation: '\u63a7\u5236\u5ba4', spec: 'AES/EBU' }),
  makeLine(8, { fromDevice: '', toDevice: '', fromLocation: '\u821e\u53f0', toLocation: '', spec: 'CAT6' }),
  makeLine(9, { fromDevice: '\u8c03\u97f3\u53f0', toDevice: '', fromLocation: '', toLocation: '', spec: 'CAT6' }),
  makeLine(10, { fromDevice: '', toDevice: '', fromLocation: '', toLocation: '', spec: 'CAT6' }),
  makeLine(11, { fromDeviceId: 'console', toDeviceId: 'amp', fromDevice: '\u8c03\u97f3\u53f0', toDevice: '\u529f\u653e',
    fromLocation: '\u673a\u67dc\u95f4', toLocation: '\u673a\u67dc\u95f4', spec: 'Speaker 2x2.5' }),
], optionalEndpointDevices)
const optionalWorkspace = buildWorkspace(optionalEndpointSchedule)
const optionalLong = buildProjectWiringLongReport('Optional endpoints', optionalEndpointSchedule).page
const locationHeadings = optionalLong.rows.filter((row) => row.kind === 'project-location')
assert.ok(locationHeadings.some((row) => row.drawItems.map((item) => item.text).join('')
  === '\u63a7\u5236\u5ba4 \u2194 \u673a\u67dc\u95f4'), 'a bidirectional location pair has one clear parent heading')
assert.ok(locationHeadings.some((row) => row.drawItems.map((item) => item.text).join('') === '\u821e\u53f0'),
  'a one-sided location displays its filled name without an empty arrow')
assert.ok(locationHeadings.some((row) => row.drawItems.map((item) => item.text).join('') === '\u673a\u67dc\u95f4'),
  'matching location endpoints appear once in the parent heading')
const sameLocationOnly = buildProjectWiringLongReport('Same location only', makeSchedule([
  makeLine(13, { fromDevice: '', toDevice: '', fromLocation: '\u673a\u67dc\u95f4', toLocation: '\u673a\u67dc\u95f4' }),
])).page
assert.deepEqual(sameLocationOnly.rows.filter((row) => row.kind === 'project-location')[0]
  .drawItems.map((item) => item.text), ['\u673a\u67dc\u95f4'])
assert.equal(sameLocationOnly.rows.filter((row) => row.kind === 'project-direction').length, 0,
  'a single same-location route does not repeat its parent location heading')
const nestedDeviceRows = optionalLong.rows.filter((row) => row.kind === 'project-device')
assert.ok(nestedDeviceRows.some((row) => row.drawItems.map((item) => item.text).join('')
  .includes('\u8c03\u97f3\u53f0') && row.longImageStyle === 'device'),
'device pairs sit below their location title at a secondary level')
const optionalDirectionRows = optionalLong.rows.filter((row) => row.kind === 'project-direction')
assert.ok(optionalDirectionRows.some((row) => {
  const text = row.drawItems.map((item) => item.text).join('')
  return text.includes('\u63a7\u5236\u5ba4 / \u8c03\u97f3\u53f0')
    && text.includes('\u673a\u67dc\u95f4 / DSP') && text.includes('\u2192')
}))
assert.ok(optionalDirectionRows.some((row) => {
  const text = row.drawItems.map((item) => item.text).join('')
  return text.includes('\u673a\u67dc\u95f4 / DSP')
    && text.includes('\u63a7\u5236\u5ba4 / \u8c03\u97f3\u53f0') && text.includes('\u2192')
}),
'both directions retain their full endpoint path labels')
const stageDirection = optionalWorkspace.lines.find((line) => line.id === 'line-8')
assert.ok(!optionalDirectionRows.some((row) => row.directionKey === stageDirection.directionKey),
  'a one-way location-only route does not repeat its parent title')
const singleDevice = optionalWorkspace.groups.find((group) => group.lines.some((line) => line.id === 'line-9'))
const singleDeviceHeading = optionalLong.rows.find((row) => row.kind === 'project-group' && row.groupKey === singleDevice.key)
assert.ok(singleDeviceHeading)
const singleDeviceText = singleDeviceHeading.drawItems.map((item) => item.text).join('')
assert.ok(singleDeviceText.includes('\u8c03\u97f3\u53f0') && !singleDeviceText.includes('\u2192')
  && !singleDeviceText.includes('\u672a\u586b\u5199') && !singleDeviceText.includes('\u5f85\u8865'),
'a one-sided device heading contains no empty label or arrow')
const emptyContext = optionalWorkspace.groups.find((group) => group.lines.some((line) => line.id === 'line-10'))
assert.ok(!optionalLong.rows.some((row) => ['project-location', 'project-device', 'project-group', 'project-direction']
  .includes(row.kind) && (row.groupKey === emptyContext.key || row.directionKey === emptyContext.directions[0].key)),
'when both locations and devices are empty, no empty heading is drawn')
assert.ok(optionalLong.rows.some((row) => row.kind === 'project-line' && row.lineId === 'line-10'),
  'endpoint-free lines still retain their required ports and detail row')
const locationBidirectional = optionalWorkspace.groups.find((group) =>
  group.lines.some((line) => line.id === 'line-6'))
assert.deepEqual(locationBidirectional.directions.flatMap((direction) =>
  direction.lines.map((line) => line.displayNumber)), [1, 2],
'reverse directions share continuous numbering within their location/device context')

const longSingleDeviceName = '\u957f\u8bbe\u5907\u540d\u79f0'.repeat(14)
const longSingleDeviceReport = buildProjectWiringLongReport('Single endpoint', makeSchedule([
  makeLine(12, { fromDevice: longSingleDeviceName, toDevice: '' }),
])).page
const longSingleDeviceHeading = longSingleDeviceReport.rows.find((row) => row.kind === 'project-group')
assert.equal(longSingleDeviceHeading.drawItems.map((item) => item.text).join(''), longSingleDeviceName)
assert.ok(longSingleDeviceHeading.height < 240,
  'a single long endpoint uses the full heading width instead of height from unused split columns')

const recordReportSource = {
  ok: true,
  project: { id: 'report-location-project', name: 'Location Report' },
  records: [],
  schedule: { ...optionalEndpointSchedule, devices: optionalEndpointDevices },
  lighting: null,
}
const wiringItems = getProjectReportSections(recordReportSource).find((section) => section.key === 'wiring').items
assert.equal(wiringItems[0].title,
  'A006 · \u63a7\u5236\u5ba4 / \u8c03\u97f3\u53f0 → \u673a\u67dc\u95f4 / DSP',
  'record report titles include filled location/device levels without placeholders')
assert.equal(wiringItems.find((item) => item.line.id === 'line-8').title, 'A008 · \u821e\u53f0',
  'record report titles omit an arrow and empty endpoint layers')
assert.equal(wiringItems.find((item) => item.line.id === 'line-10').title, 'A010',
  'record report titles omit both empty endpoints')
const emptyEndpointPayload = buildReportPayload(recordReportSource,
  [wiringItems.find((item) => item.line.id === 'line-10').id])
const emptyEndpointReportText = emptyEndpointPayload.pages.flatMap((page) => page.lines.map((line) => line.text)).join('\n')
assert.ok(emptyEndpointReportText.includes('来源端口：OUT 10'))
assert.ok(emptyEndpointReportText.includes('去向端口：IN 10'))
assert.ok(!/来源设备：\s*·|去向设备：\s*·|来源位置：\s*·|去向位置：\s*·/.test(emptyEndpointReportText))
const locationEndpointPayload = buildReportPayload(recordReportSource, [wiringItems[0].id])
const locationEndpointText = locationEndpointPayload.pages.flatMap((page) => page.lines.map((line) => line.text)).join('\n')
assert.ok(locationEndpointText.includes('来源设备：\u63a7\u5236\u5ba4 / \u8c03\u97f3\u53f0 · 端口：OUT 6'))
assert.ok(locationEndpointText.includes('去向设备：\u673a\u67dc\u95f4 / DSP · 端口：IN 6'))

const emptyLong = buildProjectWiringLongReport('Empty', makeSchedule([]))
assert.equal(emptyLong.lineCount, 0)
assert.equal(emptyLong.page.rows[0].kind, 'project-empty')

const twoHundredSchedule = makeSchedule(Array.from({ length: 200 }, (_, index) => makeLine(index + 1, {
  fromDevice: '\u53f0\u53e3', toDevice: '\u673a\u67dc',
  fromLocation: '\u63a7\u5236\u5ba4', toLocation: '\u673a\u67dc\u95f4',
  spec: ['RVPE2*0.5', 'CAT6', 'AES/EBU'][index % 3],
})))
const twoHundred = buildProjectWiringLongReport('Long 200', twoHundredSchedule)
const twoHundredRows = twoHundred.page.rows.filter((row) => row.kind === 'project-line')
assert.equal(twoHundredRows.length, 200)
assert.ok(twoHundred.page.height > 1800, '200 detail rows remain on one naturally tall report page')
assert.deepEqual(twoHundredRows.map((row) => row.displayNumber),
  Array.from({ length: 200 }, (_, index) => String(index + 1)))
assert.equal(twoHundredRows.at(-1).lineId, 'line-200')
twoHundredRows.forEach((row) => {
  for (const field of ['displayNumber', 'ports', 'spec', 'length', 'connectors']) {
    assert.equal(getFieldText(row, field), row.fields[field], `long image keeps the full ${field} field`)
    assert.ok(!row.drawItems.filter((item) => item.fieldId === field).some((item) => item.text.includes('\u2026')))
  }
})

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
for (const theme of ['light', 'dark']) {
  const rendered = mockContext()
  drawScheduleReport(rendered.context, longReport.page, { theme })
  const fills = rendered.calls.filter((call) => call[0] === 'setFillStyle').map((call) => call[1])
  assert.ok(fills.includes('#0066cc'), 'the large group title uses the high-contrast project blue fill')
  assert.ok(fills.includes(theme === 'dark' ? '#193454' : '#eaf3ff'),
    'direction titles have a separate blue surface in both themes')
  assert.ok(fills.includes(theme === 'dark' ? '#8ac8ff' : '#005eb8'),
    'summary counts use a distinct high-contrast blue in both themes')
  assert.ok(fills.includes(theme === 'dark' ? '#22252a' : '#f7f9fc'),
    'cable summaries use a quieter surface than direction titles')
  const mixerTextIndex = rendered.calls.findIndex((call) => call[0] === 'fillText' && call[1] === '\u8c03\u97f3\u53f0')
  assert.ok(mixerTextIndex >= 0)
  let mixerTextColor = ''
  for (let index = mixerTextIndex - 1; index >= 0; index -= 1) {
    if (rendered.calls[index][0] === 'setFillStyle') {
      mixerTextColor = rendered.calls[index][1]
      break
    }
  }
  assert.equal(mixerTextColor, '#ffffff', 'large group device names remain white on blue')
  assert.equal(rendered.calls.at(-1)[0], 'stroke', 'the outer group border is the final drawing layer')
}
for (const report of [grouped, incomplete, maxReport, imported]) {
  report.pages.forEach((page) => {
    const defaultTheme = mockContext()
    const light = mockContext()
    const dark = mockContext()
    drawScheduleReport(defaultTheme.context, page)
    drawScheduleReport(light.context, page, { theme: 'light' })
    drawScheduleReport(dark.context, page, { theme: 'dark' })
    assert.deepEqual(defaultTheme.calls, light.calls, 'project export defaults to the existing light template')
    assert.deepEqual(light.calls[0], ['setFillStyle', '#ffffff'])
    const withoutColors = (calls) => calls.map((call) => (
      ['setFillStyle', 'setStrokeStyle'].includes(call[0]) ? [call[0], '<color>'] : call
    ))
    assert.deepEqual(withoutColors(light.calls), withoutColors(dark.calls),
      'dark project export preserves every non-color Canvas command')
    assert.notEqual(dark.calls[0][1], light.calls[0][1], 'dark project export uses a dark page surface')
    const drawn = light.calls.filter(([method]) => method === 'fillText').map(([, text]) => text)
    const darkDrawn = dark.calls.filter(([method]) => method === 'fillText').map(([, text]) => text)
    assert.deepEqual(darkDrawn, drawn, 'dark project export keeps all report text')
    page.rows.flatMap((row) => row.drawItems).forEach((item) => assert.ok(drawn.includes(item.text), 'Canvas draws ' + item.fieldId))
    assert.equal(light.calls.filter(([method]) => method === 'arc').length, 0,
      'project Canvas draws plain numbers without number circles or endpoint/cable diagrams')
  })
}

const longSegmentTop = twoHundred.page.height - 300
const longSegment = mockContext()
drawScheduleReport(longSegment.context, twoHundred.page, { theme: 'dark', top: longSegmentTop, height: 300 })
assert.ok(longSegment.calls.some((call) => call[0] === 'fillRect' && call[1] === 0 && call[2] === 0
  && call[3] === 720 && call[4] === 300), 'segmented rendering fills the visible canvas height')
const segmentText = longSegment.calls.filter((call) => call[0] === 'fillText')
assert.ok(segmentText.some((call) => call[1] === '200'), 'the last detail row is drawn in the bottom segment')
assert.ok(!segmentText.some((call) => call[1] === 'Long 200'), 'the title is not repeated in a later segment')
segmentText.forEach((call) => assert.ok(call[3] <= 300 + 1,
  `visible segment text uses local canvas coordinates (baseline ${call[3]})`))
for (const type of ['lines', 'materials', 'labels']) {
  const legacy = buildScheduleReportPages('Legacy', makeSchedule([makeLine(1)]), type)
  assert.equal(legacy.type, type)
  assert.ok(legacy.pages.length)
  drawScheduleReport(mockContext().context, legacy.pages[0], { theme: 'dark' })
}
assert.deepEqual(buildScheduleReportPages('Empty', makeSchedule([]), 'project').pages, [])
console.log('project wiring workspace report tests passed')

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const output = __dirname
process.env.WIRING_QA_EVIDENCE = output
const { launch } = require('../../cdp.cjs')
const cases = [
  { fixture: 'compact', count: 10, theme: 'light' },
  { fixture: 'compact', count: 10, theme: 'dark' },
  { fixture: 'standard', count: 10, theme: 'light' },
  { fixture: 'long', count: 4, theme: 'light' },
  { fixture: 'standard', count: 100, theme: 'light' },
  { fixture: 'standard', count: 200, theme: 'light' },
  { fixture: 'maxlegal', count: 8, theme: 'light' },
]
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const lineRows = (report) => report.pages.flatMap((page) => page.rows.filter((row) => row.kind === 'project-line'))
const itemText = (row, fieldId) => row.drawItems.filter((item) => item.fieldId === fieldId).map((item) => item.text).join('')
function makeCompactProject(count) {
  const devices = [
    { id: 'receiver-1', type: 'receiver', name: '无线接收机 1' },
    { id: 'mixer-1', type: 'mixer', name: '调音台' },
  ]
  const lines = Array.from({ length: count }, (_, index) => ({
    id: `qa-line-${index + 1}`, code: `A${String(index + 1).padStart(3, '0')}`,
    fromDeviceId: devices[0].id, fromDevice: devices[0].name,
    fromPort: `OUT${index + 1}`,
    toDeviceId: devices[1].id, toDevice: devices[1].name,
    toPort: `IN${index + 1}`,
    purpose: '', buildType: 'finished', cableType: 'balanced',
    spec: 'RVPE 2×0.5 mm²', connectorA: 'xlrFemale', connectorB: 'xlrMale',
    lengthText: '3', status: 'pending', notes: '',
  }))
  return {
    id: 'qa-project-1', name: '多功能厅', createdAt: 1, updatedAt: 2,
    wiringSchedule: { version: 1, revision: 0, nextNumber: count + 1, lines, devices },
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const browser = await launch()
  const checks = []
  const reports = []
  const check = (name, passed, evidence) => {
    checks.push({ name, passed: Boolean(passed), evidence })
    if (!passed) console.error('FAIL:', name)
  }
  try {
    for (const item of cases) {
      await browser.viewport(1000, 1000, item.theme, 'no-preference')
      const query = new URLSearchParams({ fixture: item.fixture, count: item.count, theme: item.theme })
      if (item.fixture === 'compact') {
        query.set('sourceFixture', 'standard')
        query.set('fixtureJson', JSON.stringify(makeCompactProject(item.count)))
      }
      await browser.navigate('tests/project-wiring-redesign-2026-10-16/native-repeat-2026-10-16/export/report-canvas.html?' + query)
      const report = await browser.evaluate('window.__reportQa')
      reports.push({ item, report })
      const rows = lineRows(report.report)
      const headerRows = report.report.pages.map((page) => ({
        first: page.rows[0]?.kind,
        second: page.rows[1]?.kind,
        groups: page.rows.filter((row) => row.kind === 'project-group').length,
        columns: page.rows.filter((row) => row.kind === 'project-columns').length,
      }))
      const complete = rows.every((row) => ['circleLabel', 'ports', 'spec', 'length', 'connectors']
        .every((field) => itemText(row, field) === row.fields[field]))
      check(item.fixture + '/' + item.count + '/' + item.theme + ': actual project renderer',
        report.report.type === 'project' && report.outputs.every((page) => page.type === 'project'),
        { pages: report.report.pages.length })
      check(item.fixture + '/' + item.count + '/' + item.theme + ': all records appear once',
        rows.length === item.count && new Set(rows.map((row) => row.lineId)).size === item.count,
        rows.map((row) => row.lineId))
      check(item.fixture + '/' + item.count + '/' + item.theme + ': all five displayed fields are complete',
        complete, rows.map((row) => ({ lineId: row.lineId, fields: row.fields })))
      check(item.fixture + '/' + item.count + '/' + item.theme + ': headings repeat on every page',
        headerRows.every((page) => page.first === 'project-group' && page.second === 'project-columns' && page.groups === page.columns),
        headerRows)
      check(item.fixture + '/' + item.count + '/' + item.theme + ': Canvas text fits its column bounds',
        report.textMetrics.omittedItems.length === 0 && report.textMetrics.overflows.length === 0,
        { omitted: report.textMetrics.omittedItems, overflows: report.textMetrics.overflows })
      check(item.fixture + '/' + item.count + '/' + item.theme + ': Canvas PNG pages saved',
        report.outputs.length > 0 && report.outputs.every((page) => page.width === 720 && page.height > 0 && page.bytes > 3000 && page.sha256),
        report.outputs.map(({ filename, bytes, width, height, sha256: hash }) => ({ filename, bytes, width, height, sha256: hash })))
      if (item.fixture === 'compact') {
        check('ordinary complete rows stay at or below 70px', rows.every((row) => row.height <= 70), rows.map((row) => ({ lineId: row.lineId, height: row.height })))
        check('ordinary rows retain the requested cable specification', rows.every((row) => row.fields.spec === 'RVPE 2×0.5 mm²'), rows.map((row) => row.fields.spec))
        const singleLineMetrics = report.textMetrics.fullFieldMetrics.filter((metric) => ['ports', 'spec', 'length', 'connectors'].includes(metric.fieldId))
        check('ordinary ports, spec, length and connectors each fit on one baseline',
          singleLineMetrics.length === item.count * 4 && singleLineMetrics.every((metric) => metric.actualWidth <= metric.allowedWidth + 1),
          singleLineMetrics)
      }
      if (item.fixture === 'long' || item.fixture === 'maxlegal') {
        check(item.fixture + ': long fields expand rows and remain complete',
          rows.every((row) => row.height >= 54 && ['ports', 'spec', 'length', 'connectors'].every((field) => itemText(row, field) === row.fields[field])),
          rows.map((row) => ({ lineId: row.lineId, height: row.height, fields: row.fields })))
      }
      if (item.fixture === 'standard' && item.count === 100) {
        check('100-line export paginates without losing records', report.report.pages.length > 1 && rows.length === 100,
          { pages: report.report.pages.length, lines: rows.length })
      }
      if (item.fixture === 'standard' && item.count === 200) {
        const ids = ['qa-line-101', 'qa-line-110', 'qa-line-111', 'qa-line-112', 'qa-line-113']
        const lineIds = new Set(ids)
        const targetMetrics = report.textMetrics.measuredItems.filter((metric) =>
          lineIds.has(metric.lineId) && metric.kind === 'project-line' && ['ports', 'spec'].includes(metric.fieldId))
        const perLine = ids.map((lineId) => {
          const ports = targetMetrics.filter((metric) => metric.lineId === lineId && metric.fieldId === 'ports')
          const specs = targetMetrics.filter((metric) => metric.lineId === lineId && metric.fieldId === 'spec')
          const portsRight = Math.max(...ports.map((metric) => metric.boundsX + metric.actualWidth))
          const specLeft = Math.min(...specs.map((metric) => metric.boundsX))
          return {
            lineId,
            portsSegments: ports.map(({ text, actualWidth, allowedWidth, boundsX }) => ({ text, actualWidth, allowedWidth, boundsX })),
            specSegments: specs.map(({ text, actualWidth, allowedWidth, boundsX }) => ({ text, actualWidth, allowedWidth, boundsX })),
            noInkOverlap: ports.length > 0 && specs.length > 0 && ports.every((metric) => metric.actualWidth <= metric.allowedWidth + 1) && specs.every((metric) => metric.actualWidth <= metric.allowedWidth + 1) && portsRight <= specLeft + 1,
          }
        })
        check('200-line high-index port ink stays left of specification ink', perLine.every((line) => line.noInkOverlap), perLine)
      }
      if (item.fixture === 'maxlegal') {
        check('maximum legal lines paginate without splitting a record', report.report.pages.length > 1 && rows.length === 8,
          { pages: report.report.pages.length, lines: rows.length })
      }
      console.log(item.fixture + '/' + item.count + '/' + item.theme + ': ' + report.outputs.length + ' Canvas PNG pages')
    }
    const light = reports.find(({ item }) => item.fixture === 'compact' && item.theme === 'light').report.outputs.map((page) => page.sha256)
    const dark = reports.find(({ item }) => item.fixture === 'compact' && item.theme === 'dark').report.outputs.map((page) => page.sha256)
    check('export appearance is independent of UI theme', JSON.stringify(light) === JSON.stringify(dark), { light, dark })
  } catch (error) {
    check('Canvas runner completed', false, error.stack)
  } finally {
    await browser.close()
  }
  const sourceHash = reports[0]?.report.sources?.['pages/project-wiring/report.js'] || null
  const result = {
    runAt: new Date().toISOString(),
    sourceHash,
    runnerHash: sha256(fs.readFileSync(__filename)),
    checks,
    cases: reports.map(({ item, report }) => ({
      ...item,
      pages: report.report.pages.length,
      sourceHash: report.sources?.['pages/project-wiring/report.js'],
      outputs: report.outputs.map(({ drawnText, calls, ...output }) => output),
      rows: lineRows(report.report).map((row) => ({ lineId: row.lineId, groupKey: row.groupKey, height: row.height, fields: row.fields })),
      textMetrics: { overflows: report.textMetrics.overflows, omittedItems: report.textMetrics.omittedItems, fullFieldMetrics: report.textMetrics.fullFieldMetrics },
      pageRows: report.report.pages.map((page) => page.rows.map((row) => ({ kind: row.kind, groupKey: row.groupKey || null, height: row.height }))),
    })),
    limits: 'Actual production project renderer through Chromium Canvas2D adapter; native WeChat Canvas/temp-file export and physical devices were not run.',
  }
  fs.writeFileSync(path.join(output, 'report-checks.json'), JSON.stringify(result, null, 2))
  fs.writeFileSync(path.join(output, 'source-manifest.json'), JSON.stringify({
    renderer: 'pages/project-wiring/report.js', sourceHash, runner: path.basename(__filename), runnerHash: result.runnerHash,
    adapter: 'tests/project-wiring-redesign-2026-10-16/native-repeat-2026-10-16/export/report-canvas.html + report-canvas.js + browser-server.cjs + cdp.cjs',
    harnessHash: sha256(fs.readFileSync(path.join(output, 'report-canvas.js'))),
    scope: 'project export type only; legacy line/material/label renderers unchanged',
  }, null, 2))
  console.log('Canvas checks ' + checks.filter((item) => item.passed).length + '/' + checks.length)
  if (checks.some((item) => !item.passed)) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

const fs = require('node:fs')
const path = require('node:path')

const exportQaDir = __dirname
const runId = process.env.EXPORT_QA_RUN_ID || 'current-run'
const evidenceDir = path.join(exportQaDir, 'evidence', runId)
process.env.WIRING_QA_EVIDENCE = evidenceDir

const testRoot = path.resolve(exportQaDir, '..', '..')
const { launch } = require(path.join(testRoot, 'cdp.cjs'))
const { createRuntime } = require(path.join(testRoot, 'runtime.cjs'))
const { root } = require(path.join(testRoot, 'runtime.cjs'))
const { CONNECTOR_OPTIONS } = require(path.join(root, 'utils/project-wiring.js'))
const expectedReportHash = '225A071D0D4116EEF3F1B8D3442AC664798C872633ED99B11FD20DCC177D8D92'

function sha256(filePath) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase()
}

const reportPath = path.join(root, 'pages/project-wiring/report.js')
const reportHashAtStart = sha256(reportPath)
if (reportHashAtStart !== expectedReportHash) {
  throw Error(`report.js source changed before the QA run: expected ${expectedReportHash}, got ${reportHashAtStart}`)
}

const rendererPath = 'tests/project-wiring-redesign-2026-10-16/native-repeat-2026-10-16/export-qa/renderer.html'
const connectorLabels = Object.fromEntries(CONNECTOR_OPTIONS.map(({ id, label }) => [id, label]))
const checks = []
const cases = []

function check(name, passed, evidence = {}) {
  const result = { name, passed: Boolean(passed), evidence }
  checks.push(result)
  if (!result.passed) console.error('FAIL:', name, JSON.stringify(evidence).slice(0, 1000))
}

function norm(value) { return String(value ?? '').replace(/\s+/g, '') }

function jsonEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right) }

function expectedCircleLabel(code) {
  const source = String(code || '').trim()
  const match = source.match(/^A(\d+)$/i)
  return match ? match[1].replace(/^0+(?=\d)/, '') : (source || '—')
}

async function tabSnapshots() {
  const env = createRuntime({ fixture: 'standard', count: 4, theme: 'light' })
  env.page({})
  await new Promise(resolve => setTimeout(resolve, 40))
  const devices = env.snapshot()
  await env.dispatch('onWorkspaceTab', { tab: 'lines' })
  const lines = env.snapshot()
  return { devices, lines }
}

function encodeSchedule(schedule) {
  return Buffer.from(JSON.stringify(schedule), 'utf8').toString('base64url')
}

function makeCommonCompleteSchedule(sourceSchedule) {
  const schedule = JSON.parse(JSON.stringify(sourceSchedule))
  if (!schedule.lines.some(line => line.id === 'qa-line-1')) throw Error('Isolated standard fixture is missing qa-line-1')
  schedule.lines.forEach((line, index) => Object.assign(line, {
    fromPort: `OUT${index + 1}`,
    toPort: `IN${index + 1}`,
    spec: 'RVPE 2×0.5 mm²',
    lengthText: '3',
    connectorA: 'xlrFemale',
    connectorB: 'xlrMale',
  }))
  Object.assign(schedule.lines[0], {
    code: 'A001',
  })
  return schedule
}

function getPageLineIds(report) {
  return report.pages.flatMap(page => page.lineIds)
}

function validateCompleteness(report) {
  const requiredFieldIds = ['circleLabel', 'ports', 'spec', 'length', 'connectors']
  const sourceById = new Map(report.sourceLines.map(line => [line.id, line]))
  const lineRows = report.lineRows
  const missing = []
  for (const row of lineRows) {
    const source = sourceById.get(row.id)
    const fields = row.fields || {}
    const raw = fields.raw || {}
    const visible = Object.fromEntries(requiredFieldIds.map(fieldId => [
      fieldId,
      norm(row.drawItems.filter(item => item.fieldId === fieldId).map(item => item.text).join(' ')),
    ]))
    const numberMarker = row.primitives.find(item => item.kind === 'number-circle')
    const expectedNumberShape = /^\d+$/.test(expectedCircleLabel(source?.code)) ? 'circle' : 'capsule'
    const expectedConnectorA = connectorLabels[source?.connectorA] || source?.connectorA || '—'
    const expectedConnectorB = connectorLabels[source?.connectorB] || source?.connectorB || '—'
    const requirements = [
      ['source line exists', Boolean(source)],
      ['line number marker shape is present', Boolean(numberMarker) && numberMarker.shape === expectedNumberShape],
      ...requiredFieldIds.map(fieldId => [`field ${fieldId} is drawn`, row.fieldIds.includes(fieldId) && Boolean(visible[fieldId])]),
      ['circle label preserved', norm(fields.circleLabel) === norm(expectedCircleLabel(source?.code)) && visible.circleLabel.includes(norm(fields.circleLabel))],
      ['from port source value preserved', raw.fromPort === source?.fromPort && visible.ports.includes(norm(source?.fromPort))],
      ['to port source value preserved', raw.toPort === source?.toPort && visible.ports.includes(norm(source?.toPort))],
      ['spec source value retained', raw.spec === source?.spec && (source?.spec ? norm(fields.spec).includes(norm(source.spec)) && visible.spec.includes(norm(source.spec)) : Boolean(fields.spec))],
      ['length source value retained', raw.length === source?.lengthText && (source?.lengthText ? norm(fields.length).includes(norm(source.lengthText)) && visible.length.includes(norm(source.lengthText)) : Boolean(fields.length))],
      ['connector A source value retained', raw.connectorA === source?.connectorA && (!source?.connectorA || visible.connectors.includes(norm(expectedConnectorA)))],
      ['connector B source value retained', raw.connectorB === source?.connectorB && (!source?.connectorB || visible.connectors.includes(norm(expectedConnectorB)))],
      ['combined spec field retained', Boolean(fields.spec && fields.length)],
    ]
    for (const [name, passed] of requirements) if (!passed) missing.push({ lineId: row.id, name, fields, visible, source })
  }
  return { pass: missing.length === 0 && lineRows.length === report.sourceLines.length, missing }
}

function validatePageHeadings(report) {
  const failures = []
  for (const page of report.pages) {
    const kinds = page.rowKinds
    if (kinds[0] !== 'project-group' || kinds[1] !== 'project-columns') {
      failures.push({ page: page.page, initialKinds: kinds.slice(0, 4) })
    }
    const groups = page.rows.filter(row => row.kind === 'project-group')
    for (const group of groups) {
      const index = page.rows.indexOf(group)
      if (page.rows[index + 1]?.kind !== 'project-columns' || page.rows[index + 2]?.kind !== 'project-line') {
        failures.push({ page: page.page, group: group.key, following: page.rows.slice(index, index + 3).map(row => row.kind) })
      }
    }
    if (!page.rowKinds.includes('project-line')) failures.push({ page: page.page, reason: 'heading-only page' })
  }
  return { pass: failures.length === 0, failures }
}

async function render(browser, { fixture = 'standard', count = 4, theme = 'light', tab = 'none', caseName, schedule, projectName } = {}) {
  await browser.viewport(1000, 1000, theme, 'no-preference')
  const query = new URLSearchParams({ fixture, count: String(count), theme, tab, case: caseName || `${fixture}-${count}-${tab}-${theme}` })
  if (schedule) query.set('schedule64', encodeSchedule(schedule))
  if (projectName) query.set('projectName', projectName)
  await browser.navigate(rendererPath + '?' + query)
  return browser.evaluate('window.__exportQa')
}

function summarize(report) {
  const lineRows = report.lineRows
  const heights = lineRows.map(row => row.height).sort((a, b) => a - b)
  const contentHeight = lineRows.reduce((sum, row) => sum + row.height, 0)
  return {
    fixture: report.fixture,
    count: report.count,
    tab: report.tab,
    theme: report.theme,
    lineCount: report.report.lineCount,
    pageCount: report.report.pageCount,
    lineRowCount: lineRows.length,
    rowHeight: heights.length ? { min: heights[0], median: heights[Math.floor(heights.length / 2)], max: heights.at(-1), average: contentHeight / heights.length } : null,
    rowsPer1000ContentPixels: contentHeight ? lineRows.length * 1000 / contentHeight : 0,
    pages: report.outputs,
    json: report.jsonOutput,
    quality: {
      measuredTextItems: report.quality.measuredTextItems,
      missingBoundsCount: report.quality.missingBounds.length,
      overflowCount: report.quality.overflows.length,
      collisionCount: report.quality.collisions.length,
      rowOverlapCount: report.quality.rowOverlaps.length,
      missingCanvasDrawCount: report.quality.missingCanvasDraws.length,
    },
  }
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const browser = await launch()
  try {
    const tabs = await tabSnapshots()
    const deviceData = tabs.devices
    const lineData = tabs.lines
    check('workspace runtime starts in devices tab', deviceData.data.workspaceTab === 'devices', { tab: deviceData.data.workspaceTab })
    check('actual tab handler changes to lines tab', lineData.data.workspaceTab === 'lines', { tab: lineData.data.workspaceTab })
    check('both workspace tabs retain the same schedule snapshot', jsonEqual(deviceData.schedule, lineData.schedule), {
      devicesRevision: deviceData.schedule?.revision,
      linesRevision: lineData.schedule?.revision,
      devicesLineIds: deviceData.schedule?.lines?.map(line => line.id),
      linesLineIds: lineData.schedule?.lines?.map(line => line.id),
    })

    const devices = await render(browser, {
      fixture: 'standard', count: 4, theme: 'light', tab: 'devices', caseName: 'standard-devices-light',
      schedule: deviceData.schedule, projectName: deviceData.data.project.name,
    })
    cases.push(summarize(devices))
    const lines = await render(browser, {
      fixture: 'standard', count: 4, theme: 'light', tab: 'lines', caseName: 'standard-lines-light',
      schedule: lineData.schedule, projectName: lineData.data.project.name,
    })
    cases.push(summarize(lines))
    check('actual Canvas output identical from devices and lines tabs', jsonEqual(devices.outputs.map(page => page.sha256), lines.outputs.map(page => page.sha256)), {
      devices: devices.outputs.map(page => page.sha256), lines: lines.outputs.map(page => page.sha256),
    })

    const standard = devices
    const standardIds = standard.sourceLines.map(line => line.id).sort()
    check('standard export uses project renderer and preserves every line once', standard.report.type === 'project'
      && standard.lineRows.length === 4
      && jsonEqual(getPageLineIds(standard).sort(), standardIds), {
      type: standard.report.type, lineRows: standard.lineRows.length, expectedIds: standardIds, actualIds: getPageLineIds(standard),
    })
    const standardCompleteness = validateCompleteness(standard)
    check('standard report retains circle, both ports, spec, length, both connectors', standardCompleteness.pass, standardCompleteness.missing.slice(0, 5))
    check('standard compact line rows stay at or below 70px, including missing-label rows', standard.lineRows.length === 4 && standard.lineRows.every(row => row.height <= 70), {
      rows: standard.lineRows.map(row => ({ id: row.id, height: row.height, fields: row.fields })),
      densityPer1000ContentPixels: summarize(standard).rowsPer1000ContentPixels,
    })

    const commonCompleteSchedule = makeCommonCompleteSchedule(deviceData.schedule)
    const completeCommon = await render(browser, {
      fixture: 'standard', count: 4, theme: 'light', caseName: 'common-complete-fields-light',
      schedule: commonCompleteSchedule, projectName: deviceData.data.project.name,
    })
    cases.push(summarize(completeCommon))
    const completeCommonRows = completeCommon.lineRows.map(row => ({
      id: row.id,
      height: row.height,
      fields: row.fields,
      source: completeCommon.sourceLines.find(line => line.id === row.id),
      baselines: Object.fromEntries(['circleLabel', 'ports', 'spec', 'length', 'connectors'].map(fieldId => [
        fieldId,
        [...new Set(row.drawItems.filter(item => item.fieldId === fieldId).map(item => item.y))],
      ])),
    }))
    const ordinary = completeCommonRows[0]
    check('complete ordinary fixture contains OUT1 → IN1, RVPE 2×0.5 mm², 3 m, XLR female → XLR male', Boolean(ordinary)
      && norm(ordinary.source?.fromPort) === 'OUT1' && norm(ordinary.source?.toPort) === 'IN1'
      && norm(ordinary.source?.spec) === norm('RVPE 2×0.5 mm²')
      && norm(ordinary.source?.lengthText) === '3'
      && ordinary.source?.connectorA === 'xlrFemale' && ordinary.source?.connectorB === 'xlrMale', {
      source: ordinary?.source,
      display: ordinary?.fields,
    })
    check('complete ordinary rows fit within 70px and keep each field on one baseline', completeCommonRows.length === 4
      && completeCommonRows.every(row => row.height <= 70 && Object.values(row.baselines).every(baselines => baselines.length === 1)), completeCommonRows)
    check('complete ordinary fixture displays all expected compact values', Boolean(ordinary)
      && norm(ordinary.fields?.ports).includes('OUT1') && norm(ordinary.fields?.ports).includes('IN1')
      && norm(ordinary.fields?.spec).includes(norm('RVPE 2×0.5 mm²'))
      && norm(ordinary.fields?.length).includes('3')
      && norm(ordinary.fields?.connectors).includes(norm(connectorLabels.xlrFemale))
      && norm(ordinary.fields?.connectors).includes(norm(connectorLabels.xlrMale)), {
      display: ordinary?.fields,
      connectorLabels,
    })
    check('complete ordinary rows are rendered once with stable line IDs', completeCommon.lineRows.length === 4
      && jsonEqual(getPageLineIds(completeCommon).sort(), completeCommon.sourceLines.map(line => line.id).sort()), {
      rows: completeCommon.lineRows.map(row => row.id), source: completeCommon.sourceLines.map(line => line.id),
    })
    check('standard row density is at least 14 lines per 1,000 line-card pixels', summarize(standard).rowsPer1000ContentPixels >= 14, {
      rowsPer1000ContentPixels: summarize(standard).rowsPer1000ContentPixels,
      rowHeightAverage: summarize(standard).rowHeight.average,
    })
    check('every common-complete field stays on one baseline per field', completeCommon.lineRows.every(row => {
      const required = ['circleLabel', 'ports', 'spec', 'length', 'connectors']
      return required.every(fieldId => {
        const ys = new Set(row.drawItems.filter(item => item.fieldId === fieldId).map(item => item.y))
        return ys.size === 1
      })
    }), completeCommon.lineRows.map(row => ({ id: row.id, baselines: Object.fromEntries(['circleLabel', 'ports', 'spec', 'length', 'connectors'].map(fieldId => [fieldId, [...new Set(row.drawItems.filter(item => item.fieldId === fieldId).map(item => item.y))]])) })))

    const dark = await render(browser, {
      fixture: 'standard', count: 4, theme: 'dark', tab: 'devices', caseName: 'standard-devices-dark',
      schedule: deviceData.schedule, projectName: deviceData.data.project.name,
    })
    cases.push(summarize(dark))
    check('project export rendering is stable across UI theme', jsonEqual(standard.outputs.map(page => page.sha256), dark.outputs.map(page => page.sha256),), {
      light: standard.outputs.map(page => page.sha256), dark: dark.outputs.map(page => page.sha256),
    })

    const long = await render(browser, { fixture: 'long', count: 4, theme: 'light', caseName: 'long-fields-light' })
    cases.push(summarize(long))
    const longCompleteness = validateCompleteness(long)
    check('long real fields wrap fully with all labels retained', longCompleteness.pass
      && long.lineRows.some(row => row.height > 70), { rowHeights: long.lineRows.map(row => ({ id: row.id, height: row.height })), missing: longCompleteness.missing.slice(0, 5) })

    const maxLegal = await render(browser, { fixture: 'maxlegal', count: 2, theme: 'light', caseName: 'maximum-legal-fields-light' })
    cases.push(summarize(maxLegal))
    const maxCompleteness = validateCompleteness(maxLegal)
    check('maximum legal field lengths remain complete without clipping', maxCompleteness.pass
      && maxLegal.lineRows.some(row => row.height > 70), { rowHeights: maxLegal.lineRows.map(row => ({ id: row.id, height: row.height })), missing: maxCompleteness.missing.slice(0, 5) })

    for (const report of [standard, completeCommon, long, maxLegal]) {
      const label = summarize(report).fixture + '-' + summarize(report).count
      check(`${label}: Canvas draw includes every planned draw item`, report.quality.missingCanvasDraws.length === 0, report.quality.missingCanvasDraws.slice(0, 5))
      check(`${label}: actual Canvas text fits field bounds`, report.quality.overflows.length === 0, report.quality.overflows.slice(0, 5))
      check(`${label}: every Canvas draw item has explicit field bounds`, report.quality.missingBounds.length === 0, report.quality.missingBounds.slice(0, 5))
      check(`${label}: line text has no ink collisions`, report.quality.collisions.length === 0, report.quality.collisions.slice(0, 5))
      check(`${label}: rows and group headings do not overlap`, report.quality.rowOverlaps.length === 0, report.quality.rowOverlaps.slice(0, 5))
    }
    const longGroupText = long.pages.flatMap(page => page.rows.filter(row => row.kind === 'project-group').flatMap(row => row.drawItems.map(item => item.text))).join('')
    check('long device-pair headings are complete and rendered', norm(longGroupText).includes(norm(long.sourceLines[0].fromDevice))
      && norm(longGroupText).includes(norm(long.sourceLines[0].toDevice)), { groupText: longGroupText })

    for (const count of [100, 200]) {
      const pagination = await render(browser, { fixture: 'standard', count, theme: 'light', caseName: `pagination-${count}` })
      cases.push(summarize(pagination))
      const ids = pagination.sourceLines.map(line => line.id).sort()
      check(`${count}-line report paginates and keeps every stable line id exactly once`, pagination.report.pageCount > 1
        && pagination.lineRows.length === count && jsonEqual(getPageLineIds(pagination).sort(), ids), {
        pageCount: pagination.report.pageCount, lineRows: pagination.lineRows.length, expectedCount: count,
        duplicateIds: getPageLineIds(pagination).filter((id, index, all) => all.indexOf(id) !== index).slice(0, 5),
      })
      const headingQuality = validatePageHeadings(pagination)
      check(`${count}-line pagination repeats group and column headings on every page`, headingQuality.pass, headingQuality.failures.slice(0, 5))
      check(`${count}-line pagination has no text/row collisions`, pagination.quality.overflows.length === 0
        && pagination.quality.collisions.length === 0 && pagination.quality.rowOverlaps.length === 0
        && pagination.quality.missingBounds.length === 0, {
        overflows: pagination.quality.overflows.slice(0, 5), collisions: pagination.quality.collisions.slice(0, 5), rowOverlaps: pagination.quality.rowOverlaps.slice(0, 5), missingBounds: pagination.quality.missingBounds.slice(0, 5),
      })
    }

    const meta = await browser.evaluate("fetch('/__meta').then(response => response.json())")
    const reportHashAtEnd = sha256(reportPath)
    const output = {
      runAt: new Date().toISOString(),
      runId,
      suite: 'Independent project export render QA',
      runtime: 'Actual production project export functions rendered on Chromium Canvas2D; no native WeChat or device runtime.',
      productionStorage: 'NOT ACCESSED; isolated in-memory fixture only.',
      sourceGuard: {
        reportPath: 'pages/project-wiring/report.js',
        expectedSha256: expectedReportHash,
        sha256AtStart: reportHashAtStart,
        sha256AtEnd: reportHashAtEnd,
        unchangedDuringRun: reportHashAtStart === reportHashAtEnd,
      },
      harnessProvenance: {
        sharedRuntimePath: 'tests/project-wiring-redesign-2026-10-16/runtime.cjs',
        sharedRuntimeSha256: sha256(path.join(testRoot, 'runtime.cjs')),
        sharedRuntimeStatus: 'Untracked fixture harness; parent confirmed its current provenance and hash. The common-complete schedule is constructed locally in this runner and does not use a shared compact fixture.',
        runnerSha256: sha256(__filename),
        rendererSha256: sha256(path.join(exportQaDir, 'renderer.js')),
      },
      checks,
      cases,
      sourceManifest: meta.sources,
      outputs: cases.flatMap(item => item.pages),
      limits: [
        'Canvas output bytes are actual Chromium Canvas2D PNGs produced by drawScheduleReport.',
        'WeChat native Canvas implementation, canvasToTempFilePath, album save, and physical devices are NOT RUN.',
        'Workspace tabs use the real page onWorkspaceTab handler in the isolated runtime; both snapshots are passed to the real project renderer.',
      ],
    }
    fs.writeFileSync(path.join(evidenceDir, 'export-qa-results.json'), JSON.stringify(output, null, 2))
    if (reportHashAtStart !== reportHashAtEnd) throw Error(`report.js changed during the QA run: start ${reportHashAtStart}, end ${reportHashAtEnd}`)
    console.log(`Project export QA ${checks.filter(item => item.passed).length}/${checks.length}; ${output.outputs.length} PNG outputs.`)
  } finally {
    await browser.close()
  }
  if (checks.some(item => !item.passed)) process.exitCode = 1
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

'use strict'

// Test-first reproduction only. It calls current production page handlers in an
// isolated in-memory wx environment and records why the safety assertions are
// red. It does not import or call either frozen evidence writer.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createEnvironment, repoRoot } = require('../p2-safety/harness.cjs')

const casesDir = path.join(repoRoot, 'tests/p2-jev/v2.1')
const cases = [
  ...require(path.join(casesDir, 'audio.additions.json')),
  ...require(path.join(casesDir, 'av-and-controls.cases.json')),
]
const ids = [
  'V2-AUD-005', 'V2-AUD-006', 'V2-AUD-007',
  'LED-001', 'LED-003', 'LED-005', 'LED-006', 'DMX-010', 'CAM-007',
  'DMX-004', 'DMX-006', 'PW-007',
]
const found = new Map(cases.filter((item) => ids.includes(item.id)).map((item) => [item.id, item]))
assert.deepStrictEqual([...found.keys()].sort(), [...ids].sort(), 'frozen V2.1 case inputs must be present')

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const numberIn = (value) => {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}
function fillVenue(page, item) {
  const params = item.expected.parameters
  const fields = {
    'venue.room_length_m': 'lengthText', 'venue.room_width_m': 'widthText', 'venue.room_height_m': 'heightText',
    'venue.first_row_distance_m': 'firstListeningDistanceText', 'venue.last_row_distance_m': 'lastListeningDistanceText',
    'venue.listening_width_m': 'listeningWidthText',
  }
  for (const [name, field] of Object.entries(fields)) {
    if (params[name]?.user_present) page.onInput({ currentTarget: { dataset: { field } }, detail: { value: String(numberIn(params[name].value)) } })
  }
  const grade = params['venue.target_grade']
  if (grade?.user_present) page.onPickerChange({ currentTarget: { dataset: { field: 'gradeIndex' } }, detail: { value: String(String(grade.value).includes('一') ? 1 : 0) } })
  if (params['venue.front_wall_layout']?.user_present) page.onPickerChange({ currentTarget: { dataset: { field: 'layoutIndex' } }, detail: { value: '0' } })
  page.flushCalculate()
}
function fillLed(page, item) {
  const p = item.expected.parameters
  const fields = [
    ['wall_width_m', 'wallWidthText'], ['wall_height_m', 'wallHeightText'], ['top_clearance_m', 'topReserveText'],
    ['bottom_clearance_m', 'bottomReserveText'], ['border_width_m', 'frameWidthText'],
    ['nearest_viewing_distance_m', 'viewingDistanceText'],
  ]
  for (const [name, field] of fields) {
    const entry = p[`led_screen.${name}`]
    if (!entry?.user_present) continue
    let value = numberIn(entry.value)
    if (/cm|公分/.test(String(entry.value))) value /= 100
    if (field === 'frameWidthText') value *= 100
    page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value: String(value) } })
  }
  if (p['led_screen.aspect_ratio']?.user_present) page.onAspectRatioChange({ detail: { value: '0' } })
  const pitch = p['led_screen.pixel_pitch']
  if (pitch?.user_present) {
    const value = Number(String(pitch.value).match(/[\d.]+/)?.[0])
    const index = page.data.pitchOptions.findIndex((option) => Number(option.value) === value)
    if (index >= 0) page.onPitchChange({ detail: { value: String(index) } })
  }
  page.flushInputCalculation()
}
function runEscape(item) {
  const env = createEnvironment()
  const pageOf = (file) => env.loadPage(file)
  let page
  let evidence
  if (item.category === 'venue') {
    page = pageOf('pages/venue/venue.js')
    page.onLoad()
    fillVenue(page, item)
    evidence = {
      missingParameter: item.expected.clarification.reasons.flatMap((reason) => reason.parameters),
      untouchedPageValues: {
        lengthText: page.data.lengthText, widthText: page.data.widthText, heightText: page.data.heightText,
      },
      result: clone(page.data.result),
      reportData: clone(page.data.result),
    }
  } else if (item.category === 'led_screen') {
    if (item.id === 'LED-001') {
      const prior = pageOf('pages/led-screen/led-screen.js')
      prior.onLoad()
      prior.onUnitChange({ detail: { value: '1' } })
    }
    page = pageOf('pages/led-screen/led-screen.js')
    page.onLoad()
    fillLed(page, item)
    evidence = {
      missingParameters: item.expected.clarification.reasons.flatMap((reason) => reason.parameters),
      selectedAssemblyKey: page.data.unitOptions[page.data.unitIndex]?.key,
      result: clone(page.data.result),
      reportData: clone(page.data.result),
    }
  } else if (item.id === 'DMX-010') {
    const detail = pageOf('pages/products/detail.js')
    detail.onLoad({ type: 'lighting', model: 'TL-SL333' })
    detail.openDmxChannelGuide()
    const target = new URL(env.navigation.at(-1).url, 'https://local.invalid')
    page = pageOf('pages/dmx-address/channel-guide.js')
    page.onLoad({ model: target.searchParams.get('model') })
    evidence = {
      missingParameter: 'dmx_address.channels_per_fixture',
      requestedMode: target.searchParams.get('channelCount'),
      displayedChannelCount: page.data.guide?.channelCount,
      selectedMode: page.data.guide?.modes?.find((mode) => mode.selected)?.channelCount,
      result: clone(page.data.guide),
    }
  } else if (item.id === 'CAM-007') {
    page = pageOf('pages/camera/camera.js')
    page.onLoad()
    page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
    for (const [field, value] of [
      ['customHorizontalFovText', '75'], ['groundWidthText', '6'], ['groundDepthText', '4'], ['subjectHeightText', '1.8'],
    ]) page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } })
    page.flushPendingCalculation()
    evidence = {
      missingParameter: 'camera_fov.vfov_deg',
      implicitPageValue: page.data.customVerticalFovText,
      result: clone(page.data.result),
      reportData: clone(page.data.result),
    }
  } else {
    throw new Error(`unexpected escape case ${item.id}`)
  }

  assert(evidence.result, `${item.id} reproduction failed to produce the previously observed implicit-state result`)
  return { id: item.id, expectedGuard: 'block result until exact blocker value is confirmed for this operation', observedLegacyResult: true, evidence }
}

function runBlockedControl(item) {
  const env = createEnvironment()
  if (item.id === 'DMX-004' || item.id === 'DMX-006') {
    const page = env.loadPage('pages/dmx-address/dmx-address.js')
    page.onLoad()
    page.openGroupEditor({ currentTarget: { dataset: { index: 0 } } })
    page.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'custom' } } })
    const [address, label, count, channels, mode] = item.id === 'DMX-004'
      ? ['D001', 'Moving head', 6, 18, 'manual'] : ['A01O', '染色灯', 4, 12, 'auto']
    const input = (field, value) => page.onGroupInput({ currentTarget: { dataset: { index: 0, field } }, detail: { value: String(value) } })
    input('name', label); input('fixtureCount', count); input('channelCount', channels)
    if (mode === 'manual') page.switchAllocationMode({ currentTarget: { dataset: { mode } } })
    page.onBaseInput({ currentTarget: { dataset: { key: 'startAddressText' } }, detail: { value: address } })
    page.onFieldBlur()
    assert.strictEqual(page.data.result?.valid, false, `${item.id} must remain blocked`)
    return { id: item.id, blocked: true, result: clone(page.data.result), rawAddress: page.data.startAddressText }
  }
  if (item.id === 'PW-007') {
    const records = require(path.join(repoRoot, 'utils/records.js'))
    const project = records.createProject('会议室改造')
    const page = env.loadPage('pages/project-wiring/index.js')
    page.onLoad()
    page.openNewLine()
    for (const [field, value] of [['fromDevice', '调音台'], ['toDevice', 'DSP'], ['lengthText', '5']]) {
      page.onDraftInput({ currentTarget: { dataset: { field } }, detail: { value } })
    }
    page.saveLine()
    const schedule = records.getProjectWiring(project.id).schedule
    assert(page.data.formError)
    assert.strictEqual(schedule.lines.length, 0)
    return { id: item.id, blocked: true, formError: page.data.formError, persistedLineCount: schedule.lines.length }
  }
  throw new Error(`unexpected control case ${item.id}`)
}

function runManualCompatibility() {
  const outcomes = {}

  // Existing manual venue form entry still calculates from the values the
  // operator actually entered, rather than requiring a structured request.
  {
    const env = createEnvironment()
    const page = env.loadPage('pages/venue/venue.js')
    page.onLoad()
    for (const [field, value] of [
      ['lengthText', '14'], ['widthText', '9'], ['heightText', '3'],
      ['firstListeningDistanceText', '2'], ['lastListeningDistanceText', '10'], ['listeningWidthText', '7'],
    ]) page.onInput({ currentTarget: { dataset: { field } }, detail: { value } })
    page.flushCalculate()
    assert(page.data.result)
    assert.strictEqual(page.data.result.floorAreaSquareMeters, 126)
    outcomes.venue = { explicitDimensions: ['14', '9', '3'], resultFloorAreaSquareMeters: page.data.result.floorAreaSquareMeters }
  }

  // A manual physical-unit selection is still honored by the LED calculator.
  {
    const env = createEnvironment()
    const page = env.loadPage('pages/led-screen/led-screen.js')
    page.onLoad()
    const cabinetIndex = page.data.unitOptions.findIndex((unit) => unit.key === 'cabinetStandard')
    assert(cabinetIndex >= 0)
    page.onUnitChange({ detail: { value: String(cabinetIndex) } })
    page.flushInputCalculation()
    assert(page.data.result)
    assert.strictEqual(page.data.result.unitKey, 'cabinetStandard')
    outcomes.ledScreen = { manuallySelectedUnit: 'cabinetStandard', resultUnit: page.data.result.unitKey }
  }

  // A manually requested DMX mode remains selectable in the guide.
  {
    const env = createEnvironment()
    const page = env.loadPage('pages/dmx-address/channel-guide.js')
    page.onLoad({ model: 'TL-SL333', channelCount: '3' })
    assert.strictEqual(page.data.guide.channelCount, 3)
    page.switchMode({ currentTarget: { dataset: { channelCount: '6' } } })
    assert.strictEqual(page.data.guide.channelCount, 6)
    outcomes.dmxGuide = { selectedModes: [3, 6] }
  }

  // A manually entered custom VFOV still drives the camera calculation.
  {
    const env = createEnvironment()
    const page = env.loadPage('pages/camera/camera.js')
    page.onLoad()
    page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
    for (const [field, value] of [
      ['customHorizontalFovText', '75'], ['customVerticalFovText', '24'],
      ['groundWidthText', '6'], ['groundDepthText', '4'], ['subjectHeightText', '1.8'],
    ]) page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } })
    page.flushPendingCalculation()
    assert(page.data.result)
    assert.strictEqual(page.data.result.verticalFov, 24)
    outcomes.camera = { manuallyEnteredVerticalFov: 24, resultVerticalFov: page.data.result.verticalFov }
  }
  return outcomes
}

const results = []
for (const id of ids.slice(0, 9)) results.push(runEscape(found.get(id)))
for (const id of ids.slice(9)) results.push(runBlockedControl(found.get(id)))
assert.strictEqual(results.filter((result) => result.observedLegacyResult).length, 9)
assert.strictEqual(results.filter((result) => result.blocked).length, 3)
const manualCompatibility = runManualCompatibility()

// Run the intended safety assertion and retain its actual AssertionError.
// A red result must prove an engineering output was produced, not merely that
// the new operation API has not been implemented yet.
const failures = []
for (const result of results.filter((item) => item.observedLegacyResult)) {
  try {
    assert.strictEqual(result.evidence.result, null,
      `${result.id}: structured operation must not generate an engineering result before its blocker is confirmed`)
  } catch (error) {
    failures.push({
      id: result.id,
      assertionName: error.name,
      assertionMessage: error.message,
      actualLegacyOutputPresent: Boolean(result.evidence.result),
      missing: result.evidence.missingParameter || result.evidence.missingParameters,
      implicitValue: result.evidence.untouchedPageValues || result.evidence.selectedAssemblyKey || result.evidence.implicitPageValue || result.evidence.selectedMode,
    })
  }
}
const report = {
  phase: 'pre-fix red regression checkpoint',
  source: 'real production page handlers + deterministic cores with isolated in-memory wx environment',
  caseIds: ids,
  intendedRedCount: failures.length,
  controlsBlocked: results.filter((result) => result.blocked).length,
  manualCompatibility,
  failures,
  observations: results,
  offlineAttempts: [],
}
const runDirectory = path.join(__dirname, 'runs')
fs.mkdirSync(runDirectory, { recursive: true })
const reportPath = path.join(runDirectory, process.argv[2] || 'pre-fix-red-assertions.json')
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ report: path.relative(repoRoot, reportPath), red: failures.length, controlsBlocked: report.controlsBlocked }, null, 2))
if (failures.length) process.exitCode = 1

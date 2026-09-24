'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createEnvironment, repoRoot } = require('../../p2-safety/harness.cjs')
const { runLedCases, runManualCompatibility: runLedManualCompatibility } = require('./led-operation.cjs')

const caseDir = path.join(repoRoot, 'tests/p2-jev/v2.1')
const cases = new Map([
  ...require(path.join(caseDir, 'audio.additions.json')),
  ...require(path.join(caseDir, 'av-and-controls.cases.json')),
].map((item) => [item.id, item]))
const ids = ['V2-AUD-005', 'V2-AUD-006', 'V2-AUD-007', 'DMX-010', 'CAM-007']

const numberIn = (value) => {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const present = (item) => Object.fromEntries(Object.entries(item.expected.parameters || {}).filter(([, value]) => value.user_present))

function venueCandidates(item) {
  const p = present(item)
  const value = (key) => numberIn(p[`venue.${key}`]?.value)
  return {
    ...(p['venue.room_length_m'] ? { 'venue.room_length_m': value('room_length_m') } : {}),
    ...(p['venue.room_width_m'] ? { 'venue.room_width_m': value('room_width_m') } : {}),
    ...(p['venue.room_height_m'] ? { 'venue.room_height_m': value('room_height_m') } : {}),
    ...(p['venue.first_row_distance_m'] ? { 'venue.first_row_distance_m': value('first_row_distance_m') } : {}),
    ...(p['venue.last_row_distance_m'] ? { 'venue.last_row_distance_m': value('last_row_distance_m') } : {}),
    ...(p['venue.listening_width_m'] ? { 'venue.listening_width_m': value('listening_width_m') } : {}),
    ...(p['venue.target_grade'] ? { 'venue.target_grade': p['venue.target_grade'].value } : {}),
    ...(p['venue.front_wall_layout'] ? { 'venue.front_wall_layout': p['venue.front_wall_layout'].value } : {}),
    ...(p['venue.scene_type'] ? { 'venue.scene_type': p['venue.scene_type'].value } : {}),
  }
}

function ledCandidates(item) {
  const p = present(item)
  const value = (key) => numberIn(p[`led_screen.${key}`]?.value)
  const metres = (key) => {
    const raw = p[`led_screen.${key}`]?.value
    const n = numberIn(raw)
    return /cm|公分/.test(String(raw)) ? n / 100 : n
  }
  return {
    ...(p['led_screen.wall_width_m'] ? { 'led_screen.wall_width_m': metres('wall_width_m') } : {}),
    ...(p['led_screen.wall_height_m'] ? { 'led_screen.wall_height_m': metres('wall_height_m') } : {}),
    ...(p['led_screen.top_clearance_m'] ? { 'led_screen.top_clearance_m': metres('top_clearance_m') } : {}),
    ...(p['led_screen.bottom_clearance_m'] ? { 'led_screen.bottom_clearance_m': metres('bottom_clearance_m') } : {}),
    ...(p['led_screen.border_width_m'] ? { 'led_screen.border_width_m': metres('border_width_m') } : {}),
    ...(p['led_screen.aspect_ratio'] ? { 'led_screen.aspect_ratio': p['led_screen.aspect_ratio'].value } : {}),
    ...(p['led_screen.nearest_viewing_distance_m'] ? { 'led_screen.nearest_viewing_distance_m': metres('nearest_viewing_distance_m') } : {}),
    ...(p['led_screen.pixel_pitch'] ? { 'led_screen.pixel_pitch': Number(String(p['led_screen.pixel_pitch'].value).match(/[\d.]+/)?.[0]) } : {}),
  }
}

function load(relativePath) {
  const env = createEnvironment()
  const page = env.loadPage(relativePath)
  page.onLoad()
  return { env, page }
}

function historical(item) {
  const { page } = item.category === 'venue'
    ? load('pages/venue/venue.js')
    : item.category === 'led_screen'
      ? load('pages/led-screen/led-screen.js')
      : item.id === 'CAM-007'
        ? load('pages/camera/camera.js')
        : load('pages/dmx-address/channel-guide.js')
  if (item.category === 'venue') {
    page.calculate()
  } else if (item.category === 'led_screen') {
    page.flushInputCalculation?.()
  } else if (item.id === 'CAM-007') {
    page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
    page.onFieldInput({ currentTarget: { dataset: { field: 'customHorizontalFovText' } }, detail: { value: '75' } })
    page.onFieldInput({ currentTarget: { dataset: { field: 'groundWidthText' } }, detail: { value: '6' } })
    page.onFieldInput({ currentTarget: { dataset: { field: 'groundDepthText' } }, detail: { value: '4' } })
    page.onFieldInput({ currentTarget: { dataset: { field: 'subjectHeightText' } }, detail: { value: '1.8' } })
    page.flushPendingCalculation()
  } else {
    // The initial onLoad is the historical page load; this second call is the
    // explicit model navigation used by the frozen DMX case.
    page.onLoad({ model: 'TL-SL333' })
  }
  return clone(page.data.result || page.data.guide)
}

function candidatesFor(item) {
  if (item.category === 'venue') return venueCandidates(item)
  if (item.category === 'led_screen') return ledCandidates(item)
  if (item.id === 'CAM-007') return { 'camera_fov.source_mode': 'custom', 'camera_fov.scene_mode': 'ground', 'camera_fov.hfov_deg': 75, 'camera_fov.ground_width_m': 6, 'camera_fov.ground_depth_m': 4, 'camera_fov.subject_height_m': 1.8, 'camera_fov.height_mode': 'auto', 'camera_fov.margin_percent': 10 }
  return { 'dmx_address.fixture_model': 'TL-SL333' }
}

function runCase(id) {
  const item = cases.get(id)
  assert(item, `missing frozen case ${id}`)
  const historicalResult = historical(item)
  const relative = item.category === 'venue'
    ? 'pages/venue/venue.js'
    : item.category === 'led_screen'
      ? 'pages/led-screen/led-screen.js'
      : item.id === 'CAM-007' ? 'pages/camera/camera.js' : 'pages/dmx-address/channel-guide.js'
  const { page } = load(relative)
  const method = page.beginStructuredOperation
  const boundaryPresent = typeof method === 'function'
  let snapshot = null
  if (boundaryPresent) {
    snapshot = method.call(page, candidatesFor(item))
    assert(!page.data.result && !page.data.guide, `${id}: structured begin must not expose a pre-confirmation result`)
    const expectedBlocker = item.category === 'led_screen'
      ? 'led_screen.assembly_spec'
      : item.id === 'DMX-010' ? 'dmx_address.channels_per_fixture'
        : item.id === 'CAM-007' ? 'camera_fov.vfov_deg'
          : item.expected.clarification?.reasons?.flatMap((reason) => reason.parameters)?.[0]
    if (expectedBlocker) assert(snapshot.blockers.includes(expectedBlocker), `${id}: missing blocker ${expectedBlocker}`)
  }
  const missing = item.expected.clarification?.reasons?.flatMap((reason) => reason.parameters) || Object.entries(item.expected.parameters || {}).filter(([, value]) => !value.user_present).map(([key]) => key)
  return {
    id,
    historicalOutputObserved: Boolean(historicalResult),
    structuredBoundaryPresent: boundaryPresent,
    blockersBeforeConfirmation: snapshot?.blockers || null,
    expectedMissing: missing,
    structuredResultObserved: Boolean(page.data.result || page.data.guide),
  }
}

const report = { phase: 'minimal post-remediation test-first checkpoint', cases: [], failures: [], controls: [] }
for (const id of ids) {
  try { report.cases.push(runCase(id)) } catch (error) { report.failures.push({ id, message: error.message }) }
}

function runControls() {
  const controls = []
  for (const id of ['DMX-004', 'DMX-006']) {
    const env = createEnvironment()
    const page = env.loadPage('pages/dmx-address/dmx-address.js')
    page.onLoad()
    page.openGroupEditor({ currentTarget: { dataset: { index: 0 } } })
    page.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'custom' } } })
    const values = id === 'DMX-004'
      ? ['Moving head', 6, 18, 'D001', 'manual']
      : ['染色灯', 4, 12, 'A01O', 'auto']
    const input = (field, value) => page.onGroupInput({ currentTarget: { dataset: { index: 0, field } }, detail: { value: String(value) } })
    input('name', values[0]); input('fixtureCount', values[1]); input('channelCount', values[2])
    if (values[4] === 'manual') page.switchAllocationMode({ currentTarget: { dataset: { mode: values[4] } } })
    page.onBaseInput({ currentTarget: { dataset: { key: 'startAddressText' } }, detail: { value: values[3] } })
    page.onFieldBlur()
    assert.strictEqual(page.data.result?.valid, false, `${id} must remain blocked`)
    controls.push({ id, status: 'blocked', valid: page.data.result?.valid ?? null })
  }
  const records = require(path.join(repoRoot, 'utils/records.js'))
  const project = records.createProject('会议室改造')
  const env = createEnvironment(); const page = env.loadPage('pages/project-wiring/index.js'); page.onLoad(); page.openNewLine()
  for (const [field, value] of [['fromDevice', '调音台'], ['toDevice', 'DSP'], ['lengthText', '5']]) page.onDraftInput({ currentTarget: { dataset: { field } }, detail: { value } })
  page.saveLine()
  const persisted = records.getProjectWiring(project.id)
  const schedule = persisted?.schedule
  const blocked = Boolean(page.data.formError) || !schedule || schedule.lines.length === 0
  assert(blocked, 'PW-007 must not persist an incomplete wiring line')
  controls.push({ id: 'PW-007', status: blocked ? 'blocked' : 'persisted', formError: page.data.formError || null, persistedLineCount: schedule?.lines?.length ?? null })
  return controls
}

function runManualCompatibility() {
  const out = {}
  let env = createEnvironment(); let page = env.loadPage('pages/venue/venue.js'); page.onLoad()
  for (const [field, value] of [['lengthText','14'],['widthText','9'],['heightText','3'],['firstListeningDistanceText','2'],['lastListeningDistanceText','10'],['listeningWidthText','7']]) page.onInput({ currentTarget: { dataset: { field } }, detail: { value } })
  page.flushCalculate(); assert.strictEqual(page.data.result.floorAreaSquareMeters, 126); out.venue = true
  env = createEnvironment(); page = env.loadPage('pages/led-screen/led-screen.js'); page.onLoad(); const index = page.data.unitOptions.findIndex((x) => x.key === 'cabinetStandard'); assert(index >= 0); page.onUnitChange({ detail: { value: String(index) } }); page.flushInputCalculation(); assert.strictEqual(page.data.result.unitKey, 'cabinetStandard'); out.led = true
  env = createEnvironment(); page = env.loadPage('pages/dmx-address/channel-guide.js'); page.onLoad({ model: 'TL-SL333', channelCount: '3' }); assert.strictEqual(page.data.guide.channelCount, 3); page.switchMode({ currentTarget: { dataset: { channelCount: '6' } } }); assert.strictEqual(page.data.guide.channelCount, 6); out.dmx = true
  env = createEnvironment(); page = env.loadPage('pages/camera/camera.js'); page.onLoad(); page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } }); for (const [field, value] of [['customHorizontalFovText','75'],['customVerticalFovText','24'],['groundWidthText','6'],['groundDepthText','4'],['subjectHeightText','1.8']]) page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } }); page.flushPendingCalculation(); assert.strictEqual(page.data.result.verticalFov, 24); out.camera = true
  return out
}

try { report.controls = runControls() } catch (error) { report.failures.push({ id: 'controls', message: error.message }) }
try { report.manualCompatibility = runManualCompatibility() } catch (error) { report.failures.push({ id: 'manual-compatibility', message: error.message }) }
try { report.ledCases = runLedCases() } catch (error) { report.failures.push({ id: 'LED cases', message: error.message }) }
try { report.ledManualCompatibility = runLedManualCompatibility() } catch (error) { report.failures.push({ id: 'LED manual compatibility', message: error.message }) }

const outputDir = path.join(__dirname, 'runs')
fs.mkdirSync(outputDir, { recursive: true })
const output = path.join(outputDir, `minimal-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(`Wrote ${path.relative(repoRoot, output)}`)
if (report.failures.length || report.cases.some((item) => !item.structuredBoundaryPresent || !item.historicalOutputObserved)
  || report.ledCases?.length !== 4) process.exitCode = 1

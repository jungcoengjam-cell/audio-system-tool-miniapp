'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { createDelayedEnvironment, clone } = require('./delayed-environment.cjs')
const { CASE_FACTS, CONTROL_FACTS } = require('./fixtures.cjs')
const { patchExport, repoRoot } = require('../../p2-safety/harness.cjs')

const CASE_PATHS = Object.freeze({
  venue: 'pages/venue/venue.js',
  led_screen: 'pages/led-screen/led-screen.js',
  dmx_guide: 'pages/dmx-address/channel-guide.js',
  camera: 'pages/camera/camera.js',
})

function operationValues(facts) {
  const values = { ...facts.supplied }
  // The fixture keys intentionally follow frozen semantic facts.  Keep the
  // page adapter explicit so a UI field rename cannot silently become a new
  // input source.
  if (Object.prototype.hasOwnProperty.call(values, 'camera_fov.target_width_m')) {
    values['camera_fov.ground_width_m'] = values['camera_fov.target_width_m']
    delete values['camera_fov.target_width_m']
  }
  if (Object.prototype.hasOwnProperty.call(values, 'camera_fov.area_depth_m')) {
    values['camera_fov.ground_depth_m'] = values['camera_fov.area_depth_m']
    delete values['camera_fov.area_depth_m']
  }
  return values
}

// The frozen map remains semantic.  This adapter is deliberately explicit and
// is the only place that translates it to the page/core field names.  The
// contract is discovered from the real page so a page cannot accept the V2
// parameter IDs merely because a test supplied them.
const VENUE_FIELD_FACTS = Object.freeze({
  lengthText: 'venue.room_length_m', widthText: 'venue.room_width_m', heightText: 'venue.room_height_m',
  firstListeningDistanceText: 'venue.first_row_distance_m', lastListeningDistanceText: 'venue.last_row_distance_m',
  listeningWidthText: 'venue.listening_width_m', targetGrade: 'venue.target_grade', grade: 'venue.target_grade',
  frontWallLayout: 'venue.front_wall_layout', layout: 'venue.front_wall_layout', sceneType: 'venue.scene_type',
  gradeIndex: 'venue.target_grade', layoutIndex: 'venue.front_wall_layout',
})

function venueOperationValues(page, facts, supplied = facts.supplied) {
  const probe = page.beginStructuredOperation({})
  assert(probe && Array.isArray(probe.fields), 'venue: real page did not expose operation fields')
  const values = {}
  for (const field of probe.fields) {
    const semantic = VENUE_FIELD_FACTS[field.key]
    if (semantic && Object.prototype.hasOwnProperty.call(supplied, semantic)) {
      const raw = supplied[semantic]
      values[field.key] = field.key === 'gradeIndex' ? ({ '二级': 0, '一级': 1 })[raw]
        : field.key === 'layoutIndex' ? ({ '短边前置': 0, '长边前置': 1 })[raw] : raw
    }
  }
  page.endStructuredOperation()
  assert(Object.keys(values).length >= 5, 'venue: static page field map is incomplete')
  return values
}

function pageOutput(page) {
  return {
    result: clone(page.data.result),
    guide: clone(page.data.guide),
    reportImages: clone(page.data.reportImages),
    reportImagePath: page.data.reportImagePath || page.data.resultReportImagePath || '',
    reportPreviewVisible: Boolean(page.data.reportPreviewVisible || page.data.resultReportPreviewVisible),
    canvasCache: clone(page._canvasCache),
    reportSignature: page.reportSignature || page._reportSignature || '',
  }
}

function assertNoEngineeringOutput(page, id) {
  const output = pageOutput(page)
  if (Object.prototype.hasOwnProperty.call(page.data, 'result')) assert(!output.result, `${id}: result must stay blocked`)
  if (Object.prototype.hasOwnProperty.call(page.data, 'guide')) assert(!output.guide, `${id}: guide must stay blocked`)
  assert.deepStrictEqual(output.reportImages || [], [], `${id}: report images must stay blocked`)
  assert.strictEqual(output.reportImagePath, '', `${id}: report image must stay blocked`)
  assert.strictEqual(output.reportPreviewVisible, false, `${id}: report preview must stay blocked`)
  assert(!output.canvasCache, `${id}: canvas cache must stay blocked`)
}

function assertNoEffects(env, id) {
  assert.deepStrictEqual(env.effects.navigation, [], `${id}: structured begin must not navigate`)
  assert.deepStrictEqual(env.effects.storage, [], `${id}: structured begin must not persist facts`)
  assert.deepStrictEqual(env.effects.canvas, [], `${id}: structured begin must not render a report`)
}

function loadCase(id) {
  const facts = CASE_FACTS[id]
  assert(facts, `missing explicit fixture ${id}`)
  const env = createDelayedEnvironment()
  if (facts.persisted) env.wx.setStorageSync('audioTool.ledScreen.preferences', facts.persisted)
  const page = env.loadPage(CASE_PATHS[facts.page])
  if (typeof page.onLoad === 'function') page.onLoad()
  env.flushNextTicks()
  if (facts.uiState?.sourceMode === 'custom') {
    page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
  }
  if (facts.uiState?.sceneMode === 'ground' && typeof page.onSceneModeTap === 'function') {
    page.onSceneModeTap({ currentTarget: { dataset: { index: 0 } } })
  }
  env.effects.storage.length = 0
  env.effects.navigation.length = 0
  env.effects.canvas.length = 0
  return { env, page, facts }
}

function beginBlocked(id) {
  const { env, page, facts } = loadCase(id)
  assert.strictEqual(typeof page.beginStructuredOperation, 'function', `${id}: real page missing structured boundary`)
  const values = facts.page === 'venue' ? venueOperationValues(page, facts) : operationValues(facts)
  const snapshot = page.beginStructuredOperation(values)
  assert(snapshot && Array.isArray(snapshot.blockers), `${id}: boundary snapshot missing blockers`)
  if (facts.page === 'venue') {
    const expectedBlockers = snapshot.fields
      .filter((field) => VENUE_FIELD_FACTS[field.key] && facts.missing.includes(VENUE_FIELD_FACTS[field.key]))
      .map((field) => field.key)
    assert.deepStrictEqual(snapshot.blockers.slice().sort(), expectedBlockers.slice().sort(), `${id}: venue blocker mapping drifted`)
  } else {
    for (const field of facts.missing) assert(snapshot.blockers.includes(field), `${id}: blocker ${field} missing`)
  }
  assertNoEngineeringOutput(page, id)
  assertNoEffects(env, id)
  return { env, page, facts, snapshot }
}

function confirmMissing(id, state) {
  const { env, page, facts } = state
  const confirmations = facts.page === 'venue'
    ? Object.fromEntries(page.getOperationSnapshot().fields
      .filter((item) => VENUE_FIELD_FACTS[item.key] && Object.prototype.hasOwnProperty.call(facts.confirm, VENUE_FIELD_FACTS[item.key]))
      .map((item) => [item.key, facts.confirm[VENUE_FIELD_FACTS[item.key]]]))
    : facts.confirm
  for (const [field, value] of Object.entries(confirmations)) {
    const snapshot = page.getOperationSnapshot()
    const descriptor = snapshot.fields.find((item) => item.key === field)
    assert(descriptor, `${id}: missing field ${field} is not in the live UI snapshot`)
    assert.strictEqual(typeof page.setOperationCandidate, 'function', `${id}: real candidate handler missing`)
    assert.strictEqual(page.setOperationCandidate(field, value, descriptor.unit), true, `${id}: candidate rejected for ${field}`)
    assert.strictEqual(page.confirmOperationField({ currentTarget: { dataset: { field } } }), true, `${id}: confirmation handler rejected ${field}`)
    assert(env.pending.modals.length > 0, `${id}: no real confirmation modal for ${field}`)
    env.answerModal(0, true)
  }
  const after = page.getOperationSnapshot()
  assert.strictEqual(after.blockers.length, 0, `${id}: every missing field must be explicitly confirmed`)
  assert.strictEqual(after.ready, true, `${id}: confirmed operation must be ready`)
  return after
}

function calculatePage(page, id) {
  // These calls intentionally use the existing page handlers.  They make the
  // assertion fail if a page only exposes a test-only bypass instead of wiring
  // the real calculation entry point to the structured proof.
  if (id.startsWith('V2-AUD')) page.calculate?.()
  else if (id.startsWith('LED-')) page.flushInputCalculation?.()
  else if (id === 'CAM-007') page.flushPendingCalculation?.()
  else if (id === 'DMX-010') page.onLoad?.({ model: 'TL-SL333', channelCount: '6' })
  return page.data.result || page.data.guide || null
}

function runNineCases() {
  const records = []
  for (const id of Object.keys(CASE_FACTS)) {
    const blocked = beginBlocked(id)
    const before = clone(pageOutput(blocked.page))
    confirmMissing(id, blocked)
    const result = calculatePage(blocked.page, id)
    assert(result, `${id}: no engineering result after all UI confirmations`)
    // A result may be produced only after every real confirmation.  The
    // before snapshot also guards against a cached default leaking through.
    assert.deepStrictEqual(before.result, null)
    records.push({ id, blockers: blocked.facts.missing, confirmed: Object.keys(blocked.facts.confirm), result: clone(result) })
  }
  return records
}

function runVenueFocused() {
  const results = []
  for (const id of ['V2-AUD-005', 'V2-AUD-006', 'V2-AUD-007']) {
    const facts = CASE_FACTS[id]
    const spy = patchExport('utils/venue.js', 'calculateVenueEstimate', (original, calls) => (input) => {
      calls.push(clone(input))
      return clone(original(input))
    })
    try {
      const env = createDelayedEnvironment()
      const page = env.loadPage('pages/venue/venue.js')
      page.onLoad()
      env.flushNextTicks()
      // Historical/default page initialization is observed, then excluded from
      // the structured operation proof and from this core-call count.
      const historical = clone(page.data.result)
      spy.calls.length = 0
      env.effects.storage.length = 0
      const values = venueOperationValues(page, facts)
      const blocked = page.beginStructuredOperation(values)
      assert(blocked.blockers.length > 0, `${id}: pre-confirmation operation must block`)
      assert.strictEqual(spy.calls.length, 0, `${id}: core ran before confirmation`)
      assertNoEngineeringOutput(page, id)
      confirmMissing(id, { env, page, facts })
      calculatePage(page, id)
      assert(page.data.result, `${id}: complete structured inputs did not produce a result`)
      const all = { ...facts.supplied, ...facts.confirm }
      const record = page.getRecordPayload()
      assert(record && Number(record.preferences.lengthText) === all['venue.room_length_m'],
        `${id}: structured record preferences did not use the private snapshot`)
      assert(!Object.prototype.hasOwnProperty.call(record.preferences, 'discussionTableShape'),
        `${id}: structured report record borrowed manual discussion defaults`)
      const before = clone(pageOutput(page))
      assert.strictEqual(spy.calls.length, 1, `${id}: expected one core call after exact confirmation`)
      const input = spy.calls[0]
      const dimensions = {
        lengthMeters: all['venue.room_length_m'], widthMeters: all['venue.room_width_m'], heightMeters: all['venue.room_height_m'],
        firstListeningDistanceMeters: all['venue.first_row_distance_m'], lastListeningDistanceMeters: all['venue.last_row_distance_m'],
        listeningWidthMeters: all['venue.listening_width_m'],
      }
      for (const [key, value] of Object.entries(dimensions)) assert.strictEqual(Number(input[key]), value, `${id}: core ${key} was not sourced from explicit facts`)
      // Reconfirming the same value is idempotent and must leave the result and
      // the deterministic core call unchanged.
      const first = page.getOperationSnapshot().fields.find((field) => field.confirmed)
      page.confirmOperationField({ currentTarget: { dataset: { field: first.key } } })
      env.answerModal(0, true)
      calculatePage(page, id)
      assert.deepStrictEqual(page.data.result, before.result, `${id}: same-value confirmation changed result`)
      assert.strictEqual(spy.calls.length, 1, `${id}: same-value confirmation bypassed core cache`)
      // A changed candidate invalidates the previous result and its derived
      // effects before a new calculation can be committed.
      const lengthField = page.getOperationSnapshot().fields.find((field) => /length/i.test(field.key))
      assert(lengthField, `${id}: length field missing from operation`)
      page.setOperationCandidate(lengthField.key, Number(lengthField.value) + 1, lengthField.unit)
      assertNoEngineeringOutput(page, `${id} value invalidation`)
      results.push({ id, historical: Boolean(historical), coreInput: input, status: 'passed' })
    } finally {
      spy.restore()
    }
  }
  return results
}

function runVenueBoundarySecurity() {
  const id = 'V2-AUD-005'
  const facts = CASE_FACTS[id]
  const spy = patchExport('utils/venue.js', 'calculateVenueEstimate', (original, calls) => (input) => {
    calls.push(clone(input))
    return clone(original(input))
  })
  try {
    const complete = { ...facts.supplied, ...facts.confirm }
    const security = { operationActiveForged: false, pageDataMutationRejected: false, unknownSelectorsRejected: [] }
    // A UI-only flag is not an authorization boundary.  A forged false flag
    // must not route calculation through the manual/default state.
    {
      const env = createDelayedEnvironment(); const page = env.loadPage('pages/venue/venue.js')
      page.onLoad(); env.flushNextTicks(); spy.calls.length = 0
      const snapshot = page.beginStructuredOperation(venueOperationValues(page, facts, complete))
      assert(snapshot.ready, 'venue security: complete explicit operation should be ready')
      page.data.operationActive = false
      page.calculate()
      assert(page.data.result, 'venue security: forged operationActive must not block the private snapshot')
      assert.strictEqual(spy.calls.length, 1, 'venue security: private snapshot should reach core once')
      security.operationActiveForged = true
    }

    // Mutating page.data after the operation starts must not alter the private
    // operation snapshot or supply a new fact to the core.
    {
      const env = createDelayedEnvironment(); const page = env.loadPage('pages/venue/venue.js')
      page.onLoad(); env.flushNextTicks(); spy.calls.length = 0
      const snapshot = page.beginStructuredOperation(venueOperationValues(page, facts, complete)); assert(snapshot.ready)
      page.data.lengthText = '999'
      const afterMutation = page.getOperationSnapshot()
      const length = afterMutation.fields.find((field) => /length/i.test(field.key))
      assert(length && Number(length.value) === complete['venue.room_length_m'], 'venue security: page.data mutation changed snapshot facts')
      page.calculate()
      assert(page.data.result, 'venue security: explicit operation failed after harmless page.data mutation')
      assert.strictEqual(Number(spy.calls.at(-1).lengthMeters), complete['venue.room_length_m'], 'venue security: core accepted forged page.data length')
      security.pageDataMutationRejected = true
    }

    // Unknown selector values cannot silently fall back to the default grade
    // or layout.  The real confirmation path must reject/block them.
  for (const token of ['grade', 'layout']) {
      const env = createDelayedEnvironment(); const page = env.loadPage('pages/venue/venue.js')
      page.onLoad(); env.flushNextTicks(); spy.calls.length = 0
      const snapshot = page.beginStructuredOperation(venueOperationValues(page, facts, complete))
      assert(snapshot.ready)
      const current = page.getOperationSnapshot()
      const field = current.fields.find((item) => new RegExp(token, 'i').test(item.key))
      if (!field) continue
      const candidate = page.setOperationCandidate(field.key, '__unknown__', field.unit)
      assert(candidate, `venue security: ${token} candidate handler rejected test setup`)
      page.confirmOperationField({ currentTarget: { dataset: { field: field.key } } })
      assert(env.pending.modals.length, `venue security: ${token} has no confirmation modal`)
      env.answerModal(0, true)
      page.calculate()
      assert(!page.data.result, `venue security: unknown ${token} fell back to a default`)
      assert.strictEqual(spy.calls.length, 0, `venue security: unknown ${token} reached deterministic core`)
      security.unknownSelectorsRejected.push(token)
    }
    {
      const env = createDelayedEnvironment(); const page = env.loadPage('pages/venue/venue.js')
      page.onLoad(); env.flushNextTicks(); spy.calls.length = 0
      page.beginStructuredOperation(venueOperationValues(page, facts, complete))
      page.onSceneModeTap({ currentTarget: { dataset: { index: 1 } } })
      assert.strictEqual(page.getOperationSnapshot().active, false, 'venue invalidation must retain a closed snapshot')
      assert.strictEqual(page.getOutputState(), null, 'venue invalidation must not fall back to manual data')
      page.calculate()
      assert.strictEqual(spy.calls.length, 0, 'venue invalidation reached core before explicit end')
      page.endOperation()
      assert.strictEqual(page.getOperationSnapshot(), null, 'explicit end must release the structured gate')
      page.calculate()
      assert(page.data.result, 'manual calculation did not resume after explicit end')
    }
    {
      const env = createDelayedEnvironment(); const page = env.loadPage('pages/venue/venue.js')
      page.onLoad(); env.flushNextTicks()
      env.effects.storage.length = 0
      page.beginStructuredOperation(venueOperationValues(page, facts, complete))
      page.calculate()
      page.saveToActiveProject()
      assert.strictEqual(env.pending.modals.length, 1, 'venue output: expected project-name modal')
      const storageWrites = env.effects.storage.length
      const length = page.getOperationSnapshot().fields.find((field) => /length/i.test(field.key))
      page.setOperationCandidate(length.key, Number(length.value) + 1, length.unit)
      env.answerModal(0, true)
      assert.strictEqual(env.effects.storage.length, storageWrites, 'venue output: stale project modal wrote after invalidation')
      assert.deepStrictEqual(env.storage.get('audioTool.projects.v1'), [], 'venue output: stale modal created a project')
    }
    {
      const env = createDelayedEnvironment(); const page = env.loadPage('pages/venue/venue.js')
      page.onLoad(); env.flushNextTicks()
      page.beginStructuredOperation(venueOperationValues(page, facts, complete))
      page.calculate()
      assert(page.data.result && env.pending.nextTicks.length, 'venue callback: expected deferred result commit callback')
      page.data.showVenueDetails = true
      let staleHandoffCalls = 0
      page.getHandoffReviewForResult = () => { staleHandoffCalls += 1; return { groups: [] } }
      const length = page.getOperationSnapshot().fields.find((field) => /length/i.test(field.key))
      page.setOperationCandidate(length.key, Number(length.value) + 1, length.unit)
      env.flushNextTicks()
      assert.strictEqual(staleHandoffCalls, 0, 'venue callback: stale callback produced a handoff review')
      assert.strictEqual(page.data.result, null, 'venue callback: stale callback restored the old result')
      assert.strictEqual(page.data.handoffReview, null, 'venue callback: stale callback restored derived output')
    }
    {
      const env = createDelayedEnvironment()
      env.wx.setStorageSync('audioTool.venue.preferences', {
        sceneMode: 'discussion', standardClassKey: 'conference', gradeKey: 'I', layout: 'long',
        lengthText: '20', widthText: '12', heightText: '5', firstListeningDistanceText: '4',
        lastListeningDistanceText: '16', listeningWidthText: '10', discussionTableShape: 'round',
        discussionInstallationCondition: 'flat', participantCountText: '16', tableDiameterText: '4',
        tableLengthText: '5', tableWidthText: '2',
      })
      const page = env.loadPage('pages/venue/venue.js'); page.onLoad(); env.flushNextTicks()
      const manual = { sceneModeIndex: page.data.sceneModeIndex, lengthText: page.data.lengthText,
        widthText: page.data.widthText, gradeIndex: page.data.gradeIndex, layoutIndex: page.data.layoutIndex }
      const snapshot = page.beginStructuredOperation({ lengthText: '14', widthText: '9', heightText: '4',
        lastListeningDistanceText: '11', listeningWidthText: '8', gradeIndex: 0, layoutIndex: 0 })
      assert.strictEqual(page.data.sceneModeIndex, 0, 'venue UI must expose report inputs from discussion history')
      assert.strictEqual(page.data.lengthText, '14', 'venue UI must display this operation length')
      assert.strictEqual(page.data.widthText, '9', 'venue UI must display this operation width')
      assert.strictEqual(page.data.firstListeningDistanceText, '', 'missing venue input must not display historical data')
      assert(snapshot.blockers.includes('firstListeningDistanceText'))
      page.endOperation()
      assert.strictEqual(page.data.sceneModeIndex, manual.sceneModeIndex, 'venue end must restore manual scene')
      for (const key of ['lengthText', 'widthText', 'gradeIndex', 'layoutIndex']) {
        assert.strictEqual(page.data[key], manual[key], `venue end must restore manual ${key}`)
      }
      assert.strictEqual(page.data.result.kind, 'discussion', 'manual discussion calculation must resume after end')
    }
    {
      const env = createDelayedEnvironment(); const page = env.loadPage('pages/venue/venue.js')
      page.onLoad(); env.flushNextTicks()
      const snapshot = page.beginStructuredOperation({ lengthText: '14', widthText: '9', heightText: '4',
        firstListeningDistanceText: '2', lastListeningDistanceText: '11', listeningWidthText: '8' })
      assert(snapshot.blockers.includes('gradeIndex') && snapshot.blockers.includes('layoutIndex'))
      assert.strictEqual(page.data.gradeIndex, -1, 'missing grade must not display the historic selection')
      assert.strictEqual(page.data.layoutIndex, -1, 'missing layout must not display the historic selection')
      for (const key of ['gradeIndex', 'layoutIndex']) {
        assert.strictEqual(snapshot.fields.find((field) => field.key === key).displayValue, '待确认')
        assert.strictEqual(page.confirmOperationField({ currentTarget: { dataset: { field: key } } }), false,
          `missing ${key} must not be confirmable from the invalid UI index`)
      }
      assert.strictEqual(env.pending.modals.length, 0, 'missing selectors must not open a false confirmation')
      assert(snapshot.blockers.includes('gradeIndex') && snapshot.blockers.includes('layoutIndex'))
      page.onGradeTap({ currentTarget: { dataset: { index: 1 } } })
      page.onPickerChange({ currentTarget: { dataset: { field: 'layoutIndex' } }, detail: { value: '1' } })
      for (const key of ['gradeIndex', 'layoutIndex']) {
        assert.strictEqual(page.confirmOperationField({ currentTarget: { dataset: { field: key } } }), true)
        env.answerModal(0, true)
      }
      assert.strictEqual(page.getOperationSnapshot().ready, true, 'real selector events followed by confirmation should unblock')
      page.endOperation()
    }
    assert.deepStrictEqual(security.unknownSelectorsRejected.slice().sort(), ['grade', 'layout'])
    return security
  } finally {
    spy.restore()
  }
}

function runControls() {
  const controls = []
  for (const id of ['DMX-004', 'DMX-006']) {
    const env = createDelayedEnvironment()
    const page = env.loadPage('pages/dmx-address/dmx-address.js')
    page.onLoad()
    env.flushNextTicks()
    const facts = CONTROL_FACTS[id]
    page.openGroupEditor({ currentTarget: { dataset: { index: 0 } } })
    env.flushNextTicks()
    page.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'custom' } } })
    env.flushNextTicks()
    const input = (field, value) => {
      page.onGroupInput({ currentTarget: { dataset: { index: 0, field } }, detail: { value: String(value) } })
      env.flushNextTicks()
    }
    input('name', facts.fixtureName); input('fixtureCount', facts.fixtureCount); input('channelCount', facts.channelCount)
    if (facts.allocationMode === 'manual') {
      page.switchAllocationMode({ currentTarget: { dataset: { mode: facts.allocationMode } } })
      env.flushNextTicks()
    }
    page.onBaseInput({ currentTarget: { dataset: { key: 'startAddressText' } }, detail: { value: facts.startAddress } })
    env.flushNextTicks()
    page.onFieldBlur()
    env.flushNextTicks()
    assert.strictEqual(page.data.result?.valid, false, `${id}: invalid address must remain blocked by the real handler`)
    controls.push({ id, status: 'blocked', valid: page.data.result?.valid ?? null })
  }

  // Create the project in the same isolated wx storage used by the page.
  const env = createDelayedEnvironment()
  const records = require(path.join(repoRoot, 'utils/records.js'))
  const project = records.createProject(CONTROL_FACTS['PW-007'].projectName)
  const page = env.loadPage('pages/project-wiring/index.js')
  page.onLoad()
  env.flushNextTicks()
  page.openNewLine()
  env.flushNextTicks()
  const facts = CONTROL_FACTS['PW-007']
  for (const [field, value] of [['fromDevice', facts.fromDevice], ['toDevice', facts.toDevice], ['lengthText', String(facts.lengthM)]]) {
    page.onDraftInput({ currentTarget: { dataset: { field } }, detail: { value } })
    env.flushNextTicks()
  }
  page.saveLine()
  const persisted = records.getProjectWiring(project.id)
  assert(page.data.formError, 'PW-007: missing ports must show a real form error')
  assert.strictEqual(persisted?.schedule?.lines?.length || 0, 0, 'PW-007: incomplete line must not be persisted')
  controls.push({ id: 'PW-007', status: 'blocked', formError: page.data.formError, persistedLineCount: 0 })
  return controls
}

function runManualCompatibility() {
  const out = {}
  let env = createDelayedEnvironment(); let page = env.loadPage('pages/venue/venue.js'); page.onLoad()
  for (const [field, value] of [['lengthText', '14'], ['widthText', '9'], ['heightText', '3'], ['firstListeningDistanceText', '2'], ['lastListeningDistanceText', '10'], ['listeningWidthText', '7']]) { page.onInput({ currentTarget: { dataset: { field } }, detail: { value } }); env.flushNextTicks() }
  page.flushCalculate(); assert.strictEqual(page.data.result?.floorAreaSquareMeters, 126); out.venue = true

  env = createDelayedEnvironment(); env.wx.setStorageSync('audioTool.ledScreen.preferences', { unitKey: 'cabinetStandard' }); page = env.loadPage('pages/led-screen/led-screen.js'); page.onLoad(); env.flushNextTicks();
  assert.strictEqual(page.data.unitOptions[page.data.unitIndex]?.key, 'cabinetStandard'); out.led = true

  env = createDelayedEnvironment(); page = env.loadPage('pages/dmx-address/channel-guide.js'); page.onLoad({ model: 'TL-SL333', channelCount: '3' }); env.flushNextTicks(); assert.strictEqual(page.data.guide?.channelCount, 3); page.switchMode({ currentTarget: { dataset: { channelCount: '6' } } }); env.flushNextTicks(); assert.strictEqual(page.data.guide?.channelCount, 6); out.dmx = true

  env = createDelayedEnvironment(); page = env.loadPage('pages/camera/camera.js'); page.onLoad(); env.flushNextTicks(); page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } }); env.flushNextTicks(); for (const [field, value] of [['customHorizontalFovText', '75'], ['customVerticalFovText', '24'], ['groundWidthText', '6'], ['groundDepthText', '4'], ['subjectHeightText', '1.8']]) { page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } }); env.flushNextTicks() }; page.flushPendingCalculation(); env.flushNextTicks(); assert.strictEqual(page.data.result?.verticalFov, 24); out.camera = true
  return out
}

module.exports = { runNineCases, runVenueFocused, runVenueBoundarySecurity, runControls, runManualCompatibility, beginBlocked, confirmMissing }

if (require.main === module) {
  const report = { cases: runNineCases(), controls: runControls(), manualCompatibility: runManualCompatibility() }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

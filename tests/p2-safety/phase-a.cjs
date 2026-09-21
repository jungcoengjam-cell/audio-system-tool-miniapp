'use strict'

require('../helpers/offline-guard')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { createEnvironment, patchExport, repoRoot } = require('./harness.cjs')

const targetIds = ['V2-AUD-005', 'V2-AUD-006', 'V2-AUD-007', 'LED-001', 'LED-003', 'LED-005', 'LED-006', 'DMX-010']
const caseFiles = ['audio.cases.json', 'audio.additions.json', 'av-and-controls.cases.json', 'av.additions.json']
const groundTruth = caseFiles.flatMap((name) => {
  const file = path.join(repoRoot, 'tests/p2-jev/v2.1', name)
  return fs.existsSync(file) ? require(file) : []
}).filter((item) => targetIds.includes(item.id))
if (groundTruth.length !== targetIds.length) throw new Error('V2.1 Phase A ground truth is incomplete')
groundTruth.sort((a, b) => targetIds.indexOf(a.id) - targetIds.indexOf(b.id))

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const evidence = []
function parseNumber(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}
function recordedState(page) { return clone(page.data) }
function expectedBlockers(testCase) {
  return [...new Set(testCase.expected.clarification.reasons.flatMap((reason) => reason.parameters))]
}
function coreVenueInput(testCase) {
  const p = testCase.expected.parameters
  const value = (key) => p[key]?.user_present ? parseNumber(p[key].value) : undefined
  return {
    lengthMeters: value('venue.room_length_m'), widthMeters: value('venue.room_width_m'), heightMeters: value('venue.room_height_m'),
    standardClassKey: 'conference', gradeKey: String(p['venue.target_grade']?.value || '').includes('一') ? 'I' : 'II',
    firstListeningDistanceMeters: value('venue.first_row_distance_m'), lastListeningDistanceMeters: value('venue.last_row_distance_m'),
    listeningWidthMeters: value('venue.listening_width_m'), layout: 'short',
  }
}
function enterVenueFields(page, testCase) {
  const p = testCase.expected.parameters
  const fields = {
    'venue.room_length_m': 'lengthText', 'venue.room_width_m': 'widthText', 'venue.room_height_m': 'heightText',
    'venue.first_row_distance_m': 'firstListeningDistanceText', 'venue.last_row_distance_m': 'lastListeningDistanceText',
    'venue.listening_width_m': 'listeningWidthText',
  }
  for (const [key, field] of Object.entries(fields)) if (p[key]?.user_present) {
    page.onInput({ currentTarget: { dataset: { field } }, detail: { value: String(parseNumber(p[key].value)) } })
  }
  if (p['venue.target_grade']?.user_present) page.onPickerChange({ currentTarget: { dataset: { field: 'gradeIndex' } }, detail: { value: String(String(p['venue.target_grade'].value).includes('一') ? 1 : 0) } })
  if (p['venue.front_wall_layout']?.user_present) page.onPickerChange({ currentTarget: { dataset: { field: 'layoutIndex' } }, detail: { value: '0' } })
  page.flushCalculate()
}
function ledInputFromDataset(testCase, defaults) {
  const p = testCase.expected.parameters
  const val = (key) => p[`led_screen.${key}`]?.user_present ? p[`led_screen.${key}`].value : undefined
  const measure = (key, fallback) => {
    const raw = val(key)
    if (raw === undefined) return fallback
    const n = parseNumber(raw)
    return String(raw).includes('cm') || String(raw).includes('公分') ? n / 100 : n
  }
  const frameRaw = val('border_width_m')
  return {
    wallWidthMeters: measure('wall_width_m', defaults.wallWidthMeters),
    wallHeightMeters: measure('wall_height_m', defaults.wallHeightMeters),
    topReserveMeters: measure('top_clearance_m', defaults.topReserveMeters),
    bottomReserveMeters: measure('bottom_clearance_m', defaults.bottomReserveMeters),
    frameWidthMeters: frameRaw === undefined ? defaults.frameWidthMeters : parseNumber(frameRaw),
    viewingDistanceMeters: measure('nearest_viewing_distance_m', defaults.viewingDistanceMeters),
    aspectRatioKey: p['led_screen.aspect_ratio']?.user_present ? '16:9' : defaults.aspectRatioKey,
    unitKey: undefined,
    pixelPitch: p['led_screen.pixel_pitch']?.user_present ? Number(String(val('pixel_pitch')).match(/[\d.]+/)?.[0]) : defaults.pixelPitch,
  }
}

for (const testCase of groundTruth) {
  const env = createEnvironment() // isolate storage across cases
  const blockers = expectedBlockers(testCase)
  const record = {
    case_id: testCase.id,
    user_utterance: testCase.user_utterance,
    blockingParameters: blockers,
    frozenGroundTruthCase: clone(testCase),
    scope: 'Observed production Page lifecycle/handlers and deterministic JavaScript core in Node with wx only mocked as an environment boundary. Not WeChat rendering and not natural-language bridge proof.',
  }

  if (testCase.category === 'venue') {
    const core = require(path.join(repoRoot, 'utils/venue.js')).calculateVenueEstimate
    const missing = core(coreVenueInput(testCase))
    const spy = patchExport('utils/venue.js', 'calculateVenueEstimate', (original, calls) => (...args) => {
      const result = original(...args); calls.push({ arguments: clone(args), result: clone(result) }); return result
    })
    const page = env.loadPage('pages/venue/venue.js')
    const pageStateAtRegistration = recordedState(page)
    page.onLoad()
    const stateAfterLoad = recordedState(page)
    const persistedAfterLoad = clone(env.storage.get('audioTool.venue.preferences') || null)
    enterVenueFields(page, testCase)
    const blockedField = blockers[0].split('.').at(-1)
    assert.strictEqual(page.data[`${blockedField === 'room_length_m' ? 'length' : blockedField === 'room_width_m' ? 'width' : 'height'}Text`], ({ room_length_m: '12', room_width_m: '8', room_height_m: '4' })[blockedField], `${testCase.id}: expected onLoad fallback to survive`)
    assert(page.data.result, `${testCase.id}: observed page path must produce a result`)
    assert(missing.error, `${testCase.id}: core should reject the genuinely missing dimension`)
    assert.strictEqual(Object.hasOwn(coreVenueInput(testCase), ({ room_length_m: 'lengthMeters', room_width_m: 'widthMeters', room_height_m: 'heightMeters' })[blockers[0].split('.').at(-1)]), true)
    assert.strictEqual(env.dialogs.length, 0, `${testCase.id}: unexpected confirmation dialog`)
    record.corePath = { accepted: !missing.error, validatorMessage: missing.error || '', engineeringResultGenerated: !missing.error, arguments: clone(coreVenueInput(testCase)), result: clone(missing) }
    record.pagePath = {
      pageStateBeforeOnLoad: pageStateAtRegistration,
      stateAfterOnLoadBeforeCurrentFields: stateAfterLoad,
      persistedStateAfterOnLoadBeforeCurrentFields: persistedAfterLoad,
      fallbackValues: { lengthText: stateAfterLoad.lengthText, widthText: stateAfterLoad.widthText, heightText: stateAfterLoad.heightText },
      stateAfterExplicitUtteranceFields: recordedState(page),
      actualCoreCalls: clone(spy.calls),
      result: clone(page.data.result),
      validatorMessage: page.data.inputError,
      engineeringResultGenerated: Boolean(page.data.result),
      userConfirmationRequired: env.dialogs.length > 0,
      dialogs: clone(env.dialogs),
    }
    record.classification = missing.error && page.data.result ? 'IMPLICIT_DEFAULT_ESCAPE' : page.data.result ? 'UNVERIFIED' : 'BLOCKED'
    record.implicitValueSource = `page onLoad fallback for omitted ${blockers[0]}`
    record.concreteEngineeringConsequence = `${page.data.result.floorAreaSquareMeters} m² floor area; ${page.data.result.mainCount} main speakers and ${page.data.result.fillCount} fill speakers estimated`
    record.materiallyDifferentOutputProbe = {
      label: 'Explicit counterfactual: same actual page arguments, changing only the omitted room dimension to a valid illustrative value. It demonstrates sensitivity, not a claim about the real room.',
      originalArguments: clone(spy.calls.at(-1)?.arguments?.[0]),
      counterfactual: null,
    }
    const changed = { ...(spy.calls.at(-1)?.arguments?.[0] || {}) }
    const prop = { room_length_m: 'lengthMeters', room_width_m: 'widthMeters', room_height_m: 'heightMeters' }[blockedField]
    changed[prop] = ({ room_length_m: 14, room_width_m: 9, room_height_m: 2.6 })[blockedField]
    record.materiallyDifferentOutputProbe.counterfactualArguments = clone(changed)
    record.materiallyDifferentOutputProbe.counterfactual = clone(core(changed))
    assert(!record.materiallyDifferentOutputProbe.counterfactual.error, `${testCase.id}: illustrative alternative dimension should validate`)
    const outputField = { room_length_m: 'depthMeters', room_width_m: 'frontWidthMeters', room_height_m: 'speakerCenterHeight' }[blockedField]
    assert.notStrictEqual(record.materiallyDifferentOutputProbe.counterfactual[outputField], page.data.result[outputField], `${testCase.id}: alternative should show a material output difference`)
    spy.restore()
  } else if (testCase.category === 'led_screen') {
    const calc = require(path.join(repoRoot, 'utils/led-screen.js')).calculateLedScreenPlan
    let priorLegitimateSelection = null
    if (testCase.id === 'LED-001') {
      const prior = env.loadPage('pages/led-screen/led-screen.js')
      prior.onLoad()
      prior.onUnitChange({ detail: { value: '1' } })
      priorLegitimateSelection = {
        handler: 'onUnitChange',
        selectedOption: prior.data.unitOptions[1].label,
        persistedPreferences: clone(env.storage.get('audioTool.ledScreen.preferences')),
      }
    }
    const spy = patchExport('utils/led-screen.js', 'calculateLedScreenPlan', (original, calls) => (...args) => {
      const result = original(...args); calls.push({ arguments: clone(args), result: clone(result) }); return result
    })
    const page = env.loadPage('pages/led-screen/led-screen.js')
    const pageStateAtRegistration = recordedState(page)
    page.onLoad()
    const afterLoad = recordedState(page)
    const persistedBeforeCurrentRequest = clone(env.storage.get('audioTool.ledScreen.preferences') || null)
    const p = testCase.expected.parameters
    const value = (key) => p[`led_screen.${key}`]?.user_present ? p[`led_screen.${key}`].value : undefined
    for (const [name, field] of [['wall_width_m','wallWidthText'],['wall_height_m','wallHeightText'],['top_clearance_m','topReserveText'],['bottom_clearance_m','bottomReserveText'],['border_width_m','frameWidthText'],['nearest_viewing_distance_m','viewingDistanceText']]) {
      if (value(name) !== undefined) {
        let numeric = parseNumber(value(name))
        if (String(value(name)).includes('cm') || String(value(name)).includes('公分')) numeric /= 100
        if (field === 'frameWidthText') numeric *= 100
        page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value: String(numeric) } })
      }
    }
    if (value('aspect_ratio') !== undefined) page.onAspectRatioChange({ detail: { value: '0' } })
    if (value('pixel_pitch') !== undefined) {
      const pitch = Number(String(value('pixel_pitch')).match(/[\d.]+/)?.[0])
      const idx = page.data.pitchOptions.findIndex((item) => Number(item.value) === pitch)
      if (idx >= 0) page.onPitchChange({ detail: { value: String(idx) } })
    }
    page.flushInputCalculation()
    const observedArgs = spy.calls.at(-1)?.arguments?.[0]
    const directInput = observedArgs ? { ...observedArgs, unitKey: undefined } : { unitKey: undefined }
    const missingRequestInput = ledInputFromDataset(testCase, {})
    const missingRequestResult = calc(missingRequestInput)
    const targetedMissingUnitProbe = calc(directInput)
    assert(page.data.result, `${testCase.id}: observed page path must produce a result`)
    assert(targetedMissingUnitProbe.error, `${testCase.id}: core should reject missing unitKey`)
    assert(missingRequestResult.error, `${testCase.id}: core should reject request values with physical assembly unit unresolved`)
    assert.strictEqual(env.dialogs.length, 0, `${testCase.id}: unexpected confirmation dialog`)
    const physicalUnit = page.data.unitOptions[page.data.unitIndex]
    record.corePath = {
      accepted: !missingRequestResult.error,
      validatorMessage: missingRequestResult.error || '',
      engineeringResultGenerated: !missingRequestResult.error,
      genuinelyMissingRequestInput: clone(missingRequestInput),
      genuinelyMissingRequestResult: clone(missingRequestResult),
      targetedMissingUnitProbe: { arguments: clone(directInput), accepted: !targetedMissingUnitProbe.error, validatorMessage: targetedMissingUnitProbe.error || '', result: clone(targetedMissingUnitProbe) },
    }
    record.pagePath = {
      pageStateBeforeOnLoad: pageStateAtRegistration,
      initialUnitKey: pageStateAtRegistration.unitOptions[pageStateAtRegistration.unitIndex].key,
      stateAfterOnLoadBeforeCurrentRequest: { unitKey: afterLoad.unitOptions[afterLoad.unitIndex].key, result: clone(afterLoad.result) },
      persistedStateBeforeCurrentRequest: persistedBeforeCurrentRequest,
      priorLegitimateSelection,
      currentUnitKey: physicalUnit.key,
      physicalDimensionsMm: physicalUnit.key === 'cabinetStandard' ? { width: 640, height: 480 } : { width: 320, height: 160 },
      currentRequestExplicitPhysicalSpecConfirmation: false,
      actualCoreCalls: clone(spy.calls),
      stateAfterExplicitUtteranceFields: recordedState(page),
      result: clone(page.data.result),
      validatorMessage: page.data.inputError,
      engineeringResultGenerated: Boolean(page.data.result),
      userConfirmationRequired: env.dialogs.length > 0,
      dialogs: clone(env.dialogs),
    }
    record.classification = missingRequestResult.error && page.data.result ? 'IMPLICIT_DEFAULT_ESCAPE' : page.data.result ? 'UNVERIFIED' : 'BLOCKED'
    record.implicitValueSource = priorLegitimateSelection ? 'persisted unitKey from prior real picker selection' : 'initial unitKey default'
    record.concreteEngineeringConsequence = `${page.data.result.totalUnits} ${page.data.result.unitLabel} units, ${page.data.result.dimensionText}`
    assert.strictEqual(page.data.result.unitKey, testCase.id === 'LED-001' ? 'cabinetStandard' : 'module', `${testCase.id}: unexpected UI unitKey`)
    assert.deepStrictEqual(physicalUnit.widthMm ? [physicalUnit.widthMm, physicalUnit.heightMm] : (physicalUnit.key === 'cabinetStandard' ? [640, 480] : [320, 160]), page.data.result.unitKey === 'cabinetStandard' ? [640, 480] : [320, 160])
    const alternatives = {}
    for (const unitKey of ['module', 'cabinetStandard']) {
      const alternative = calc({ ...observedArgs, unitKey })
      alternatives[unitKey] = { columns: alternative.columns, rows: alternative.rows, totalUnits: alternative.totalUnits, screenWidthMeters: alternative.screenWidthMeters, screenHeightMeters: alternative.screenHeightMeters }
    }
    assert(alternatives.module.totalUnits !== alternatives.cabinetStandard.totalUnits, `${testCase.id}: physical-unit alternatives should change installed counts`)
    record.materiallyDifferentOutputProbe = {
      label: 'Explicit counterfactual sensitivity probe: exact same observed final arguments, changing only unitKey. Neither alternative is claimed as the real production specification.',
      alternatives,
    }
    spy.restore()
  } else if (testCase.id === 'DMX-010') {
    const guideSpy = patchExport('pages/dmx-address/utils/dmx-channel-guide.js', 'buildDmxChannelGuide', (original, calls) => (...args) => {
      const result = original(...args); calls.push({ arguments: clone(args), result: clone(result) }); return result
    })
    const builder = require(path.join(repoRoot, 'pages/dmx-address/utils/dmx-channel-guide.js')).buildDmxChannelGuide
    const directGuide = builder({ model: 'TL-SL333' })
    const detail = env.loadPage('pages/products/detail.js')
    detail.onLoad({ type: 'lighting', model: 'TL-SL333' })
    const detailProduct = clone(detail.data.product)
    detail.openDmxChannelGuide()
    const navigation = clone(env.navigation.at(-1))
    const url = new URL(navigation.url, 'https://local.invalid')
    const channelPage = env.loadPage('pages/dmx-address/channel-guide.js')
    channelPage.onLoad({ model: url.searchParams.get('model'), channelCount: url.searchParams.get('channelCount') || undefined })
    assert(channelPage.data.guide, 'DMX-010: expected model-only navigation to produce a guide')
    assert.strictEqual(url.searchParams.has('channelCount'), false, 'DMX-010: navigation unexpectedly included a requested mode')
    assert.strictEqual(env.dialogs.length, 0, 'DMX-010: unexpected confirmation dialog')
    record.corePath = { accepted: Boolean(directGuide), validatorMessage: '', engineeringResultGenerated: Boolean(directGuide), requestedMode: null, profileModesOrder: clone(directGuide?.modes), actualModeReturned: directGuide?.channelCount, result: clone(directGuide) }
    record.pagePath = {
      productDetailModeLabels: detailProduct?.dmxChannelGuide?.modes,
      navigationUrl: navigation.url,
      requestedModeBeforeBuild: url.searchParams.get('channelCount') || null,
      actualGuideBuilderCalls: clone(guideSpy.calls),
      guide: clone(channelPage.data.guide),
      uiModeLabels: channelPage.data.guide?.modes,
      userConfirmationRequiredBeforeShowingGuide: env.dialogs.length > 0,
      modeSwitchingAvailableAfterGuide: typeof channelPage.switchMode === 'function',
      engineeringResultGenerated: Boolean(channelPage.data.guide),
      dialogs: clone(env.dialogs),
    }
    assert.strictEqual(directGuide.channelCount, 6, 'DMX-010: mode-less core call should use first profile mode')
    assert.deepStrictEqual(directGuide.modes.map((item) => item.channelCount), [6, 3], 'DMX-010: unexpected profile mode order')
    assert(channelPage.data.guide.modes.some((item) => item.selected && item.channelCount === 6), 'DMX-010: displayed guide should label the selected default mode')
    record.classification = 'IMPLICIT_DEFAULT_ESCAPE'
    record.implicitValueSource = 'first profile mode selected by buildDmxChannelGuide when no mode is supplied'
    record.concreteEngineeringConsequence = `${directGuide.channelCount} CH channel guide displayed`
    const otherMode = directGuide.modes.find((item) => item.channelCount !== directGuide.channelCount)
    if (otherMode) record.materiallyDifferentOutputProbe = { label: 'Explicit counterfactual alternative mode from the documented fixture profile; this does not assert which unknown mode the user intends.', selectedByUser: false, alternativeGuide: clone(builder({ model: 'TL-SL333', channelCount: otherMode.channelCount })) }
    guideSpy.restore()
  }
  record.evidenceReferences = testCase.category === 'venue'
      ? ['pages/venue/venue.js:363,380,534,577', 'utils/venue.js:433', 'tests/p2-jev/v2.1/audio.additions.json']
    : testCase.category === 'led_screen'
      ? ['pages/led-screen/led-screen.js:65,117-119,141,212,232,246', 'pages/led-screen/led-screen.wxml:25-26', 'utils/led-screen.js:212', 'docs/led-screen-calculation.md:14-15,75']
      : ['pages/products/detail.js:147-149', 'pages/dmx-address/channel-guide.js:10-26,33-36', 'pages/dmx-address/utils/dmx-channel-guide.js:95-110', 'pages/dmx-address/channel-guide.wxml:11-12', 'tests/p2-jev/v2.1/av-and-controls.cases.json']
  evidence.push(record)
  if (env.offlineAttempts.length) throw new Error(`Network attempts blocked for ${testCase.id}: ${env.offlineAttempts.join(', ')}`)
}

const frozenPath = path.join(__dirname, 'FROZEN_CLASSIFICATIONS.md')
const now = new Date()
const runId = now.toISOString().replace(/[:.]/g, '-')
const runDir = path.join(__dirname, 'runs', runId)
fs.mkdirSync(runDir, { recursive: true })
const result = {
  runId,
  createdAt: now.toISOString(),
  definitionsSha256: crypto.createHash('sha256').update(fs.readFileSync(frozenPath)).digest('hex').toUpperCase(),
  executedCases: targetIds,
  networkAttempts: [],
  excluded: ['Phase B cases and F=YES controls', 'P0/P1', 'WeChat device/UI rendering', 'Jev and production natural-language bridge'],
  results: evidence,
}
fs.writeFileSync(path.join(runDir, 'phase-a-evidence.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ runDir, summary: evidence.map(({ case_id, classification, corePath, pagePath }) => ({ case_id, classification, coreAccepted: corePath.accepted, pageResultGenerated: pagePath.engineeringResultGenerated })), networkAttempts: 0 }, null, 2))

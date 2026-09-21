'use strict'

// Run only after Phase A is complete and the root agent clears Phase B execution.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createEnvironment, patchExport, repoRoot } = require('../harness.cjs')

const corpus = {
  ...Object.fromEntries(JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/p2-jev/v2.1/av-and-controls.cases.json'), 'utf8')).map((item) => [item.id, item])),
  ...Object.fromEntries(JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/p2-jev/v2.1/audio.cases.json'), 'utf8')).map((item) => [item.id, item])),
}
const outputs = []
const environments = []

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function makeEnvironment() {
  const env = createEnvironment()
  environments.push(env)
  return env
}
function observe(modulePath, name) {
  return patchExport(modulePath, name, (original, calls) => (...args) => {
    calls.push(clone(args))
    return original(...args)
  })
}
function record(id, corePath, pagePath, classification, consequence, evidenceRefs) {
  const item = corpus[id]
  assert(item, `Frozen V2.1 case missing: ${id}`)
  outputs.push({
    case_id: id,
    user_utterance: item.user_utterance,
    blocking_parameter: pagePath.blockingParameter,
    v21_expected_blocking_reason: item.expected.clarification,
    core_path: corePath,
    page_state_path: pagePath,
    implicit_value_source: pagePath.implicitValueSource || null,
    actual_value_passed_to_core: pagePath.actualValuePassedToCore ?? null,
    validator_result: pagePath.validatorResult || corePath.validatorResult,
    final_result_generated: Boolean(pagePath.engineeringResultGenerated),
    user_confirmation_required: Boolean(pagePath.userConfirmationRequired),
    classification,
    concrete_engineering_consequence: consequence,
    evidence_references: evidenceRefs,
  })
}
function appEvent(field, value) {
  return { currentTarget: { dataset: { field } }, detail: { value } }
}
function selectEndpoint(page, side, id) {
  page.openEndpointSelector({ currentTarget: { dataset: { side } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id } } })
}

// AW-007: direct missing core input, fresh real-handler flow, then the actual
// same-endpoint handler path after a prior explicit L-channel selection.
{
  const env = makeEnvironment()
  const wiringSpy = observe('pages/audio-wiring/wiring-model.js', 'getWiringModel')
  try {
    const missingCore = require(path.join(repoRoot, 'pages/audio-wiring/wiring-model.js'))
      .getWiringModel('stereo35', 'xlrBalanced', {})
    assert.equal(missingCore.status, 'needs-choice')
    assert.equal(missingCore.connections.length, 0)

    const page = env.loadPage('pages/audio-wiring/index.js')
    page.onLoad()
    const initial = { outputId: page.data.outputId, inputId: page.data.inputId, selections: clone(page.data.selections) }
    selectEndpoint(page, 'output', 'stereo35')
    selectEndpoint(page, 'input', 'xlrBalanced')
    const freshRequestState = {
      selections: clone(page.data.selections),
      status: page.data.model.status,
      requirement: clone(page.data.requirements.find((item) => item.id === 'sourceChannel')),
      connections: clone(page.data.model.connections),
    }
    const copied = []
    env.wx.setClipboardData = (options) => copied.push(options.data)
    page.copyConnection()
    assert.equal(copied.length, 0)
    const freshCoreCall = clone(wiringSpy.calls.at(-1))
    assert.equal(freshRequestState.status, 'needs-choice')
    assert.equal(freshRequestState.connections.length, 0)

    page.selectWiringRequirement({ currentTarget: { dataset: { requirementId: 'sourceChannel', optionId: 'left' } } })
    const priorExplicitChoice = clone(page.data.selections)
    const callsBeforeSameEndpointReopen = wiringSpy.calls.length
    selectEndpoint(page, 'output', 'stereo35')
    selectEndpoint(page, 'input', 'xlrBalanced')
    const callsAfterSameEndpointReopen = wiringSpy.calls.length
    const sameEndpointCurrentState = {
      selections: clone(page.data.selections),
      status: page.data.model.status,
      sourceChannel: page.data.model.requirements.find((item) => item.id === 'sourceChannel')?.value || '',
      connections: clone(page.data.model.connections),
    }
    page.copyConnection()
    assert.equal(sameEndpointCurrentState.sourceChannel, 'left')
    assert(sameEndpointCurrentState.connections.length > 0)
    assert.equal(copied.length, 1)
    const staleCoreCall = clone(wiringSpy.calls.at(-1))

    record('AW-007', {
      accepted: false,
      validationMessage: missingCore.reason,
      engineeringResultGenerated: false,
      actualCoreArguments: ['stereo35', 'xlrBalanced', {}],
    }, {
      blockingParameter: 'audio_wiring.source_channel',
      initialState: initial,
      freshRequest: freshRequestState,
      freshRequestOutputGenerated: false,
      freshRequestUserConfirmationRequired: true,
      priorExplicitChoice,
      sameEndpointReopenState: sameEndpointCurrentState,
      sameEndpointReopenCoreCallsAdded: callsAfterSameEndpointReopen - callsBeforeSameEndpointReopen,
      sameEndpointReopenRecalculated: callsAfterSameEndpointReopen > callsBeforeSameEndpointReopen,
      staleChoiceOutputGenerated: sameEndpointCurrentState.connections.length > 0,
      staleChoiceOutputRequiresNewChoice: false,
      engineeringResultGenerated: sameEndpointCurrentState.connections.length > 0,
      staleChoiceOutput: sameEndpointCurrentState.connections,
      clipboardOutput: copied[0],
      actualValuePassedToCore: { freshRequest: freshCoreCall, earlierExplicitChoiceCalculation: staleCoreCall },
      allCoreCalls: clone(wiringSpy.calls),
      persistedState: env.storage.get('audioTool.audioWiring.preferences') || null,
      validatorResult: 'Fresh state needs sourceChannel. Reopening the same endpoints adds no core-call and retains the earlier confirmed model; copyConnection exports that existing model.',
      userConfirmationRequired: false,
      engineeringResultGenerated: sameEndpointCurrentState.connections.length > 0,
      classificationBoundary: 'Fresh handler state blocks. In the stale-state sequence the identical endpoints simply reuse and re-copy a previously confirmed model; no new calculation or distinct request boundary is demonstrated, so this alone does not establish this utterance as an escape.',
    }, 'UNVERIFIED', 'A stale left-channel choice can generate a concrete mono wiring map after reopening unchanged endpoints; a fresh state blocks output. The case-level utterance-to-handler transition is not present in the product.', [
      'pages/audio-wiring/index.js: selectEndpointOption, selectWiringRequirement, copyConnection',
      'pages/audio-wiring/wiring-model.js: getWiringModel, buildWiringText',
      'tests/p2-jev/v2.1/av-and-controls.cases.json: AW-007',
    ])
  } finally { wiringSpy.restore() }
}

// CAB-008: the deterministic core rejects the unresolved interval object.
// The raw range string is only a handler-boundary probe; WXML declares type=digit.
{
  const env = makeEnvironment()
  const cableSpy = observe('utils/cable.js', 'calculateProfessionalSpeakerCable')
  try {
    const core = require(path.join(repoRoot, 'utils/cable.js'))
      .calculateProfessionalSpeakerCable({ totalPowerW: { min: 250, max: 400 }, distanceMeters: 55 })
    assert(core.error)
    const page = env.loadPage('pages/cable/cable.js')
    page.onLoad()
    page.onModeTap({ currentTarget: { dataset: { index: 1 } } })
    page.onInput(appEvent('professionalDistanceText', '55'))
    page.onInput(appEvent('professionalPowerText', '250–400'))
    page.onInputBlur()
    const rangeInputObservation = {
      powerText: page.data.professionalPowerText,
      distanceText: page.data.professionalDistanceText,
      inputTypeInWxml: 'digit',
      result: clone(page.data.result),
      inputError: page.data.inputError,
      coreArgs: cableSpy.calls.at(-1)?.[0],
      persistedState: env.storage.get('audioTool.cable.preferences') || null,
    }
    assert.equal(rangeInputObservation.result, null)
    assert(rangeInputObservation.inputError)

    const omittedEnv = makeEnvironment()
    const omittedSpy = observe('utils/cable.js', 'calculateProfessionalSpeakerCable')
    let omittedPath
    try {
      const omittedPage = omittedEnv.loadPage('pages/cable/cable.js')
      omittedPage.onLoad()
      omittedPage.onModeTap({ currentTarget: { dataset: { index: 1 } } })
      omittedPage.onInput(appEvent('professionalDistanceText', '55'))
      omittedPage.onInputBlur()
      omittedPath = {
        powerText: omittedPage.data.professionalPowerText,
        result: clone(omittedPage.data.result),
      resultText: omittedPage.getResultText(),
      coreArgs: omittedSpy.calls.at(-1)?.[0],
      persistedState: omittedEnv.storage.get('audioTool.cable.preferences') || null,
      }
      assert.equal(omittedPath.powerText, '300')
      assert(omittedPath.result)
    } finally { omittedSpy.restore() }

    record('CAB-008', {
      accepted: false,
      validationMessage: core.error,
      engineeringResultGenerated: false,
      actualCoreArguments: { totalPowerW: { min: 250, max: 400 }, distanceMeters: 55 },
    }, {
      blockingParameter: 'cable.total_rated_power_w',
      initialState: { professionalPowerText: '300', professionalDistanceText: '50' },
      rangeInputObservation,
      omittedInputCounterfactual: omittedPath,
      implicitValueSource: 'onLoad fallback/default or absent storage returns professionalPowerText=300; the range is never mapped to omission by product code.',
      actualValuePassedToCore: rangeInputObservation.coreArgs,
      validatorResult: 'Core rejects range object and raw range-string probe; untouched 300 W passes and yields a result on a separate omitted-input path.',
      userConfirmationRequired: true,
      engineeringResultGenerated: false,
      classificationBoundary: 'No production natural-language bridge maps the case range into the page, and digit input UI was not physically exercised.',
    }, 'UNVERIFIED', 'A separately omitted input can yield the 300 W-based 秋叶原 200 芯×2 recommendation, while the unresolved range path has no generated result. The omitted path is not evidence that this request was reduced to 300 W.', [
      'pages/cable/cable.js: onLoad, onInput, onInputBlur, calculatePageResult',
      'pages/cable/cable.wxml: professionalPowerText input type=digit',
      'utils/cable.js: calculateProfessionalSpeakerCable',
      'tests/p2-jev/v2.1/audio.cases.json: CAB-008',
    ])
  } finally { cableSpy.restore() }
}

// CAM-007: blank core VFOV fails; the actual custom form flow retains the
// onLoad 36-degree value when supplied fields are entered through real handlers.
{
  const env = makeEnvironment()
  const resolveSpy = observe('utils/camera-fov.js', 'resolveCustomFov')
  const groundSpy = observe('utils/camera-fov.js', 'calculateGroundAreaPlacement')
  try {
    const fovCore = require(path.join(repoRoot, 'utils/camera-fov.js')).resolveCustomFov({
      definitionMode: 'angles', horizontalFov: 75, verticalFov: undefined,
    })
    const missingCore = require(path.join(repoRoot, 'utils/camera-fov.js'))
      .calculateGroundAreaPlacement(fovCore, { widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8, heightMode: 'auto', marginRatio: 0.1 })
    assert.equal(fovCore, null)
    assert.equal(missingCore, null)

    const page = env.loadPage('pages/camera/camera.js')
    page.onLoad()
    const beforeRequestFields = {
      sourceModeIndex: page.data.sourceModeIndex,
      customHorizontalFovText: page.data.customHorizontalFovText,
      customVerticalFovText: page.data.customVerticalFovText,
      groundWidthText: page.data.groundWidthText,
      groundDepthText: page.data.groundDepthText,
      subjectHeightText: page.data.subjectHeightText,
      heightModeIndex: page.data.heightModeIndex,
      marginIndex: page.data.marginIndex,
      persistedState: env.storage.get('audioTool.camera.preferences') || null,
    }
    page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
    for (const [field, value] of [
      ['customHorizontalFovText', '75'],
      ['groundWidthText', '6'],
      ['groundDepthText', '4'],
      ['subjectHeightText', '1.8'],
    ]) page.onFieldInput(appEvent(field, value))
    page.flushPendingCalculation()
    const actual = {
      fields: {
        sourceModeIndex: page.data.sourceModeIndex,
        customHorizontalFovText: page.data.customHorizontalFovText,
        customVerticalFovText: page.data.customVerticalFovText,
        groundWidthText: page.data.groundWidthText,
        groundDepthText: page.data.groundDepthText,
        subjectHeightText: page.data.subjectHeightText,
        heightMode: page.data.heightModes[page.data.heightModeIndex].value,
        marginPercent: page.data.marginOptions[page.data.marginIndex],
      },
      resolveFovArgs: resolveSpy.calls.at(-1)?.[0],
      groundCoreArgs: groundSpy.calls.at(-1),
      result: clone(page.data.result),
      resultText: page.getResultText(),
      calculationError: page.data.calculationError,
      persistedState: env.storage.get('audioTool.camera.preferences') || null,
    }
    const cameraCore = require(path.join(repoRoot, 'utils/camera-fov.js'))
    const counterfactualFov24 = cameraCore.resolveCustomFov({
      definitionMode: 'angles', horizontalFov: 75, verticalFov: 24,
    })
    const counterfactualVfovProbe = cameraCore.calculateGroundAreaPlacement(counterfactualFov24, {
      widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8, heightMode: 'auto', cameraHeightMeters: Number(page.data.fixedCameraHeightText), marginRatio: 0.1,
    })
    assert.equal(actual.fields.customVerticalFovText, '36')
    assert(actual.result)
    assert.equal(actual.result.verticalFov, 36)
    assert(counterfactualVfovProbe)

    record('CAM-007', {
      accepted: false,
      validationMessage: 'resolveCustomFov returns null when custom angle mode lacks a valid VFOV; ground-area calculator returns null.',
      engineeringResultGenerated: false,
      actualCoreArguments: { definitionMode: 'angles', horizontalFov: 75, verticalFov: undefined },
    }, {
      blockingParameter: 'camera_fov.vfov_deg',
      initialState: beforeRequestFields,
      actualPageFlow: actual,
      counterfactualVfovProbe: {
        label: 'Counterfactual sensitivity probe only; 24° VFOV is not supplied by CAM-007 utterance or actual form state.',
        fov: { horizontalFov: 75, verticalFov: 24 },
        result: counterfactualVfovProbe,
        materiallyDifferentSetback: counterfactualVfovProbe.primaryDistanceMeters !== actual.result.primaryDistanceMeters,
      },
      implicitValueSource: 'camera page onLoad fallback customVerticalFovText=36 (also the data initial value); it remains untouched by the request-field handlers.',
      actualValuePassedToCore: actual.groundCoreArgs,
      validatorResult: 'Core accepts 75° horizontal and 36° vertical; automatic ground-area placement returns a recommendation.',
      userConfirmationRequired: false,
      engineeringResultGenerated: true,
    }, 'IMPLICIT_DEFAULT_ESCAPE', 'The resulting full-area recommendation uses an unconfirmed 36° vertical view angle and returns a camera setback/install recommendation.', [
      'pages/camera/camera.js: onLoad, onSourceModeTap, onFieldInput, flushPendingCalculation, getFovDefinition, commitCalculatedState',
      'utils/camera-fov.js: resolveCustomFov, calculateGroundAreaPlacement',
      'tests/p2-jev/v2.1/av-and-controls.cases.json: CAM-007',
    ])
  } finally { resolveSpy.restore(); groundSpy.restore() }
}

function observeDmxControl(id, rawAddress, name, fixtures, channels, allocationMode) {
  const env = makeEnvironment()
  const dmxSpy = observe('utils/dmx-address.js', 'calculateDmxAddressPlan')
  try {
    const direct = require(path.join(repoRoot, 'utils/dmx-address.js')).calculateDmxAddressPlan({
      startAddress: rawAddress,
      allocationMode,
      groups: [{ name, fixtureCount: fixtures, channelCount: channels }],
    })
    assert(direct.error)
    const page = env.loadPage('pages/dmx-address/dmx-address.js')
    page.onLoad()
    page.openGroupEditor({ currentTarget: { dataset: { index: 0 } } })
    page.switchFixtureSource({ currentTarget: { dataset: { index: 0, source: 'custom' } } })
    page.onGroupInput(eventDmx(0, 'name', name))
    page.onGroupInput(eventDmx(0, 'fixtureCount', String(fixtures)))
    page.onGroupInput(eventDmx(0, 'channelCount', String(channels)))
    if (allocationMode === 'manual' && page.data.allocationMode !== 'manual') {
      page.switchAllocationMode({ currentTarget: { dataset: { mode: 'manual' } } })
    }
    page.onBaseInput({ currentTarget: { dataset: { key: 'startAddressText' } }, detail: { value: rawAddress } })
    page.onFieldBlur()
      const call = dmxSpy.calls.at(-1)?.[0]
    const pageResult = clone(page.data.result)
    assert.equal(pageResult.valid, false)
    assert.equal(pageResult.error, direct.error)
    record(id, {
      accepted: false,
      validationMessage: direct.error,
      engineeringResultGenerated: false,
      actualCoreArguments: { startAddress: rawAddress, allocationMode, groups: [{ name, fixtureCount: fixtures, channelCount: channels }] },
    }, {
      blockingParameter: id === 'DMX-004' ? 'dmx_address.start_address, dmx_address.target_universe' : 'dmx_address.start_address, dmx_address.target_universe',
      initialState: { startAddressText: '1', allocationMode: 'auto', targetUniverse: page.data.groups[0]?.targetUniverse },
      actualPageFlow: { rawStartAddress: rawAddress, allocationMode: page.data.allocationMode, group: clone(call?.groups?.[0]), result: pageResult },
      persistedState: env.storage.get('audioTool.dmxAddress.preferences') || null,
      implicitValueSource: `createGroup default targetUniverse=${call?.groups?.[0]?.targetUniverse}; this does not normalize or replace the invalid raw start address.`,
      actualValuePassedToCore: call,
      validatorResult: 'Core rejects the unchanged invalid raw start address before allocation.',
      userConfirmationRequired: true,
      engineeringResultGenerated: false,
    }, 'BLOCKED', `No DMX patch is generated for ${fixtures} fixtures × ${channels} channels because ${rawAddress} remains invalid; no wrong address plan is issued.`, [
      'pages/dmx-address/dmx-address.js: onBaseInput, onGroupInput, switchFixtureSource, switchAllocationMode, commitCalculation',
      'pages/dmx-address/group-input.js: createGroup targetUniverse fallback',
      'utils/dmx-address.js: calculateDmxAddressPlan',
      `tests/p2-jev/v2.1/av-and-controls.cases.json: ${id}`,
    ])
  } finally { dmxSpy.restore() }
}
function eventDmx(index, field, value) {
  return { currentTarget: { dataset: { index, field } }, detail: { value } }
}

observeDmxControl('DMX-004', 'D001', 'Moving head', 6, 18, 'manual')
observeDmxControl('DMX-006', 'A01O', '染色灯', 4, 12, 'auto')

// PW-007: use real project create/read/save APIs over harness wx in-memory
// storage, and the actual page's new-line/input/save handlers.
{
  const env = createEnvironment()
  const saveSpy = observe('utils/records.js', 'saveProjectWiring')
  try {
    const records = require(path.join(repoRoot, 'utils/records.js'))
    const project = records.createProject('会议室改造')
    assert(project && project.id)
    const page = env.loadPage('pages/project-wiring/index.js')
    page.onLoad()
    assert.equal(page.data.project?.name, '会议室改造')
    page.openNewLine()
    for (const [field, value] of [
      ['fromDevice', '调音台'],
      ['toDevice', 'DSP'],
      ['lengthText', '5'],
    ]) page.onDraftInput(appEvent(field, value))
    const draftBeforeSave = clone(page.data.draft)
    page.saveLine()
    const pageSaveApiCalls = saveSpy.calls.length
    const pageBlocked = {
      draft: draftBeforeSave,
      formError: page.data.formError,
      saveApiCallCountAfterHandler: pageSaveApiCalls,
      persistedSchedule: records.getProjectWiring(project.id).schedule,
      persistedStorage: env.storage.get('audioTool.projects.v1') || null,
    }
    assert(pageBlocked.formError)
    assert.equal(saveSpy.calls.length, 0)
    assert.equal(pageBlocked.persistedSchedule.lines.length, 0)

    const projectWiring = require(path.join(repoRoot, 'utils/project-wiring.js'))
    const directCore = projectWiring.applyScheduleChange(projectWiring.emptySchedule(), {
      type: 'upsert',
      line: { ...draftBeforeSave, id: undefined, code: undefined },
    })
    assert.equal(directCore.ok, false)

    const apiCore = records.saveProjectWiring(project.id, {
      type: 'upsert', line: { ...draftBeforeSave, id: undefined, code: undefined },
    }, 0)
    assert.equal(apiCore.ok, false)
    assert.equal(records.getProjectWiring(project.id).schedule.lines.length, 0)
    record('PW-007', {
      accepted: false,
      validationMessage: directCore.error,
      engineeringResultGenerated: false,
      actualCoreArguments: { type: 'upsert', line: draftBeforeSave },
    }, {
      blockingParameter: 'project_wiring.from_port, project_wiring.to_port',
      initialState: { projectStorage: 'in-memory wx mock', projectId: project.id, scheduleRevision: 0 },
      actualPageFlow: pageBlocked,
      implicitValueSource: null,
      actualValuePassedToCore: pageSaveApiCalls ? saveSpy.calls.slice(0, pageSaveApiCalls) : 'None: page saveLine rejects before invoking saveProjectWiring.',
      directCoreApiProbe: { arguments: [project.id, { type: 'upsert', line: { ...draftBeforeSave, id: undefined, code: undefined } }, 0], result: apiCore },
      validatorResult: { page: pageBlocked.formError, scheduleCore: directCore.error, realRecordsApi: apiCore.error },
      userConfirmationRequired: true,
      engineeringResultGenerated: false,
    }, 'BLOCKED', 'The incomplete line is not persisted; neither a wiring record nor a materials schedule is produced.', [
      'pages/project-wiring/index.js: openNewLine, onDraftInput, saveLine',
      'utils/project-wiring.js: applyScheduleChange, validateLine',
      'utils/records.js: createProject, getProjectWiring, saveProjectWiring',
      'tests/p2-jev/v2.1/av-and-controls.cases.json: PW-007',
    ])
  } finally { saveSpy.restore() }
}

assert.equal(outputs.length, 6)
const networkAttempts = environments.flatMap((item) => item.offlineAttempts)
assert.deepEqual(networkAttempts, [], 'Phase B must remain offline')
const definitionPath = path.join(repoRoot, 'tests/p2-safety/FROZEN_CLASSIFICATIONS.md')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const runDir = path.join(__dirname, 'runs', runId)
fs.mkdirSync(path.dirname(runDir), { recursive: true })
fs.mkdirSync(runDir, { recursive: false })
const result = {
  runId,
  definitionsSha256: crypto.createHash('sha256').update(fs.readFileSync(definitionPath)).digest('hex').toUpperCase(),
  executedCases: outputs.map((item) => item.case_id),
  scopeBoundary: 'Actual page/form-handler to deterministic core; no natural-language parser/integration exists in this product flow, and no WeChat native rendering or physical keyboard behavior is claimed.',
  excluded: ['Jev', 'network', 'environment-key reads', 'commits', 'Run 1 edits', 'Unsafe Escape Rate', 'production fixes', 'WeChat UI rendering'],
  networkAttempts,
  classifications: outputs.reduce((counts, item) => ({ ...counts, [item.classification]: (counts[item.classification] || 0) + 1 }), {}),
  results: outputs,
}
fs.writeFileSync(path.join(runDir, 'phase-b-evidence.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ runDir: path.relative(repoRoot, runDir), classifications: result.classifications, caseIds: result.executedCases }, null, 2))

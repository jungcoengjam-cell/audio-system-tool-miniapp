'use strict'

// Static V2 contract validation. No model, network, credential or production imports.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const dir = __dirname
const schemaPath = path.join(dir, 'schema.json')
const datasetPaths = ['audio.cases.json', 'av-and-controls.cases.json', 'audio.additions.json', 'av.additions.json'].map((f) => path.join(dir, f))
const manifestPath = path.join(dir, 'freeze.json')
const V1_DATA = [path.join(root, 'dataset/audio.cases.json'), path.join(root, 'dataset/av-and-controls.cases.json')]
const V1_MANIFEST = path.join(root, 'freeze.v1.json')
const V1_RUBRIC = path.join(root, 'rubric.v1.json')
const V1_HASH = 'ba93006d321f4db247cbb01ef5f75b6a7c9c13361ca1c83fd75820f00a2ab134'
const V1_COMMIT = 'e89d57a492bb776fed35809eed91741715e828b0'
const CORE_TYPES = ['standard', 'casual', 'abbreviation', 'mixed_language', 'alternative_units', 'typo', 'missing_parameters', 'ambiguous_parameters', 'irrelevant_numbers', 'wrong_parameter']
const ROUTES = ['limiter', 'spl', 'cable', 'gain_structure', 'venue', 'camera_fov', 'led_screen', 'dmx_address', 'audio_wiring', 'project_wiring', 'product_catalog', 'troubleshoot', 'knowledge', 'project_records', 'multiple', 'unclear', 'other']
const REASONS = ['intent_ambiguous', 'missing_required_information', 'invalid_parameter', 'uncertain_parameter', 'permission_unconfirmed', 'unresolved_conflict']
const FORBIDDEN = new Set(['gold', 'case_metadata', 'label', 'target', 'prediction', 'model_output', 'inference_result', 'inferred_intent', 'inferred_parameters'])
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
function canonical(x) { if (Array.isArray(x)) return x.map(canonical); if (obj(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])); return x }
function canonicalDataset(cases) { return `${JSON.stringify(canonical([...cases].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))))}\n` }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function fileSha(p) { return sha(fs.readFileSync(p)) }
function normalizedText(x) { return x.normalize('NFKC').replace(/\s+/gu, ' ').trim() }
function keys(x, allowed, label, errors, required = allowed) {
  if (!obj(x)) { errors.push(`${label} must be an object`); return }
  Object.keys(x).filter((k) => !allowed.includes(k)).forEach((k) => errors.push(`${label} has unknown key ${k}`))
  required.filter((k) => !(k in x)).forEach((k) => errors.push(`${label} is missing key ${k}`))
}
function forbidden(x, label, errors) {
  if (Array.isArray(x)) return x.forEach((v, i) => forbidden(v, `${label}[${i}]`, errors))
  if (!obj(x)) return
  for (const [k, v] of Object.entries(x)) { if (FORBIDDEN.has(k)) errors.push(`${label} contains forbidden inference field ${k}`); forbidden(v, `${label}.${k}`, errors) }
}
function loadV1() { return V1_DATA.flatMap((p) => read(p)) }
function fieldRegistry(schema, rubric) {
  const fields = new Set()
  for (const [tool, spec] of Object.entries(rubric.tools || {})) for (const field of Object.keys(spec.fields || {})) fields.add(`${tool}.${field}`)
  for (const [tool, additions] of Object.entries(schema.field_additions || {})) for (const field of additions) fields.add(`${tool}.${field}`)
  return fields
}
function validateParameter(state, label, utterance, errors) {
  keys(state, ['user_present', 'value', 'source', 'valid', 'sufficient', 'evidence', 'semantic_role', 'possible_typo', 'conflict'], label, errors, ['user_present', 'source', 'valid', 'sufficient', 'evidence'])
  if (!obj(state)) return
  if (typeof state.user_present !== 'boolean' || typeof state.sufficient !== 'boolean') errors.push(`${label}: user_present and sufficient must be booleans`)
  if (!['user', 'product_catalog', 'derived', 'documented_default', 'missing'].includes(state.source)) errors.push(`${label}.source is unregistered`)
  if (![true, false, null].includes(state.valid)) errors.push(`${label}.valid must be true, false or null`)
  if (typeof state.evidence !== 'string') errors.push(`${label}.evidence must be a string`)
  if (state.source === 'missing' && (state.user_present !== false || 'value' in state || state.valid !== null || state.sufficient !== false || state.evidence !== '')) errors.push(`${label}: missing source requires absent value, valid=null, insufficient and empty evidence`)
  if (state.source === 'user' && state.user_present !== true) errors.push(`${label}: user source requires user_present=true`)
  if (['product_catalog', 'derived', 'documented_default', 'missing'].includes(state.source) && state.user_present !== false) errors.push(`${label}: non-user source requires user_present=false`)
  if (state.source !== 'missing' && !('value' in state)) errors.push(`${label}: non-missing source requires a recorded value`)
  if (state.source !== 'missing' && !((typeof state.value === 'number' && Number.isFinite(state.value)) || (typeof state.value === 'string' && state.value.length > 0) || typeof state.value === 'boolean' || Array.isArray(state.value) || obj(state.value))) errors.push(`${label}.value must be a finite number, non-empty string, boolean, candidate array or range object`)
  if (state.user_present && (!state.evidence || !utterance.includes(state.evidence))) errors.push(`${label}: user evidence must be an exact non-empty substring of the utterance`)
  if (!state.user_present && state.source !== 'missing' && !state.evidence.trim()) errors.push(`${label}: non-user values need source evidence`)
  if (state.semantic_role !== undefined && state.semantic_role !== 'unresolved') errors.push(`${label}.semantic_role may only be unresolved`)
  if (state.semantic_role === 'unresolved' && state.sufficient !== false) errors.push(`${label}: unresolved semantic role is insufficient`)
  if (state.possible_typo !== undefined && state.possible_typo !== true) errors.push(`${label}.possible_typo may only be true when applicable`)
  if (state.possible_typo === true && (state.valid !== null || !state.user_present)) errors.push(`${label}: possible typo keeps raw user value and validity unknown`)
  if (state.possible_typo === true && (typeof state.value !== 'string' || !utterance.includes(state.value))) errors.push(`${label}: possible typo must preserve the raw user string`)
  if (state.valid === false && state.sufficient !== false) errors.push(`${label}: invalid parameter must be insufficient`)
  if (state.conflict !== undefined) {
    keys(state.conflict, ['resolution'], `${label}.conflict`, errors)
    if (obj(state.conflict) && state.conflict.resolution !== null && (typeof state.conflict.resolution !== 'string' || !state.conflict.resolution.trim() || !utterance.includes(state.conflict.resolution))) errors.push(`${label}.conflict.resolution must be null or non-empty explicit utterance text`)
  }
  const v = state.value
  const nums = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'number')
  if (typeof v === 'number' && !Number.isFinite(v)) errors.push(`${label}.value must be finite`)
  if (Array.isArray(v) && v.length < 2) errors.push(`${label}.value candidate arrays require at least two candidates`)
  if (Array.isArray(v) && v.some((x) => !['number', 'string', 'boolean'].includes(typeof x) || (typeof x === 'number' && !Number.isFinite(x)))) errors.push(`${label}.value candidates must be finite primitive values`)
  if (Array.isArray(v) && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) errors.push(`${label}.value candidates must be unique`)
  if (obj(v)) {
    keys(v, ['min', 'max'], `${label}.value range`, errors)
    if (![v.min, v.max].every(Number.isFinite) || v.min > v.max) errors.push(`${label}.value range requires finite min <= max`)
  }
  if (nums.length && !Array.isArray(v) && !Number.isFinite(v)) errors.push(`${label}.value must be finite`)
}
function validateCases(cases, options = {}) {
  const errors = []
  let schema, rubric, v1
  try { schema = options.schema || read(schemaPath); rubric = options.rubric || read(V1_RUBRIC); v1 = options.v1 || loadV1() } catch (e) { return { valid: false, errors: [`cannot load validation inputs: ${e.message}`], summary: null } }
  if (!Array.isArray(cases)) return { valid: false, errors: ['cases must be an array'], summary: null }
  if (cases.length !== 144) errors.push(`expected 144 cases, got ${cases.length}`)
  const inherited = new Map(v1.map((c) => [c.id, c]))
  const fields = fieldRegistry(schema, rubric)
  const ids = new Set(), utterances = new Map()
  const totals = { case_count: cases.length, inherited: 0, added: 0, human_reviewed_cases: 30, substantive_human_revision_cases: 14, reviewed_inherited_labels_retained: 16, inherited_cases_without_individual_human_review: 90, primary_tool_cases: {}, multiple_memberships: {}, parameter_states: {}, parameter_state_case_counts: {}, source_counts: {}, clarification_cases: 0, intent_ambiguous_cases: 0, clarification_reasons: {}, category_cases: {}, case_type_cases: {} }
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i], at = `case[${i}]`
    keys(c, schema.top_level_keys, at, errors); if (!obj(c)) continue
    forbidden(c, at, errors)
    for (const k of ['id', 'category', 'mode', 'case_type', 'user_utterance', 'provenance']) if (typeof c[k] !== 'string' || !c[k].trim()) errors.push(`${at}.${k} must be non-empty text`)
    if (c.provenance !== 'synthetic') errors.push(`${at}.provenance must be synthetic`)
    if (!Array.isArray(c.tags) || c.tags.some((t) => typeof t !== 'string' || !t.trim()) || new Set(c.tags).size !== c.tags.length || !c.tags.includes(c.case_type)) errors.push(`${at}.tags must be unique non-empty strings and include case_type`)
    if (typeof c.user_utterance === 'string') {
      const norm = normalizedText(c.user_utterance)
      if (utterances.has(norm)) errors.push(`${at}.user_utterance duplicates ${utterances.get(norm)} after NFKC/whitespace normalization`)
      utterances.set(norm, c.id)
    }
    if (ids.has(c.id)) errors.push(`${at}.id duplicates ${c.id}`); ids.add(c.id)
    if (inherited.has(c.id)) {
      totals.inherited++
      const old = inherited.get(c.id)
      for (const k of ['id', 'category', 'mode', 'case_type', 'tags', 'user_utterance', 'provenance']) if (!same(c[k], old[k])) errors.push(`${at}.${k} changed inherited V1 metadata`)
      const oldParameters = Object.keys(old.expected?.parameters || {})
      for (const field of oldParameters) if (!(field in (c.expected?.parameters || {}))) errors.push(`${at}.expected.parameters dropped inherited V1 field ${field}`)
    } else totals.added++
    totals.category_cases[c.category] = (totals.category_cases[c.category] || 0) + 1
    totals.case_type_cases[c.case_type] = (totals.case_type_cases[c.case_type] || 0) + 1
    const e = c.expected
    keys(e, schema.expected_keys, `${at}.expected`, errors, schema.expected_keys.filter((k) => k !== 'tools')); if (!obj(e)) continue
    if (!ROUTES.includes(e.tool)) errors.push(`${at}.expected.tool is not registered`)
    totals.primary_tool_cases[e.tool] = (totals.primary_tool_cases[e.tool] || 0) + 1
    if (e.tool === 'multiple') { if (!Array.isArray(e.tools) || e.tools.length < 2 || new Set(e.tools).size !== e.tools.length || e.tools.some((t) => !ROUTES.includes(t) || ['multiple','unclear','other'].includes(t))) errors.push(`${at}.expected.tools requires 2+ unique actionable registered tools`); else for (const t of e.tools) totals.multiple_memberships[t] = (totals.multiple_memberships[t] || 0) + 1 }
    else if ('tools' in e) errors.push(`${at}.expected.tools is allowed only for multiple`)
    if (typeof e.intent_ambiguous !== 'boolean') errors.push(`${at}.expected.intent_ambiguous must be boolean`)
    if (!obj(e.parameters)) errors.push(`${at}.expected.parameters must be a map`)
    else for (const [f, state] of Object.entries(e.parameters)) {
      if (!fields.has(f)) errors.push(`${at}.expected.parameters has unregistered field ${f}`)
      validateParameter(state, `${at}.${f}`, c.user_utterance, errors)
      if (obj(state)) {
        const k = `${state.user_present ? 'present' : 'absent'}:${state.sufficient ? 'sufficient' : 'insufficient'}`
        totals.parameter_states[k] = (totals.parameter_states[k] || 0) + 1
        totals.source_counts[state.source] = (totals.source_counts[state.source] || 0) + 1
        const addCount = (name) => { totals.parameter_states[name] = (totals.parameter_states[name] || 0) + 1; if (!totals.parameter_state_case_counts[name]) totals.parameter_state_case_counts[name] = new Set(); totals.parameter_state_case_counts[name].add(c.id) }
        if (state.source === 'missing') addCount('missing')
        if (state.user_present && state.valid === false) addCount('present_invalid')
        if (state.source === 'product_catalog') addCount('catalog_resolved')
        if (state.source === 'derived') addCount('derived')
        if (state.source === 'documented_default') addCount('documented_default')
        if (state.semantic_role === 'unresolved') addCount('semantic_role_unresolved')
        if (obj(state.value) && Number.isFinite(state.value.min) && Number.isFinite(state.value.max)) addCount('range_valued')
        if (Array.isArray(state.value) && state.value.length >= 2) addCount('candidate_values')
        if (state.possible_typo === true) addCount('possible_typo')
        if (obj(state.conflict) && state.conflict.resolution === null) addCount('conflict_unresolved')
        if (obj(state.conflict) && typeof state.conflict.resolution === 'string') addCount('conflict_resolved')
      }
    }
    const cl = e.clarification
    keys(cl, ['required', 'reasons'], `${at}.expected.clarification`, errors)
    if (obj(cl)) {
      if (typeof cl.required !== 'boolean' || !Array.isArray(cl.reasons)) errors.push(`${at}.expected.clarification requires boolean and reason array`)
      if (cl.required) totals.clarification_cases++
      for (const [j, r] of (cl.reasons || []).entries()) {
        keys(r, ['code', 'parameters'], `${at}.clarification.reasons[${j}]`, errors)
        if (!REASONS.includes(r.code)) errors.push(`${at}.clarification.reasons[${j}].code is unregistered`)
        else totals.clarification_reasons[r.code] = (totals.clarification_reasons[r.code] || 0) + 1
        if (!Array.isArray(r.parameters) || r.parameters.some((p) => typeof p !== 'string' || !(p in (e.parameters || {})))) errors.push(`${at}.clarification.reasons[${j}].parameters must reference present parameter keys`)
      }
      if (cl.required !== (cl.reasons.length > 0)) errors.push(`${at}.clarification.required must match whether reasons exist`)
    }
    if (e.intent_ambiguous === true) totals.intent_ambiguous_cases++
    if (typeof e.rationale !== 'string' || !e.rationale.trim()) errors.push(`${at}.expected.rationale must be non-empty`)
  }
  if (totals.inherited !== 120 || totals.added !== 24) errors.push(`expected 120 inherited and 24 added cases; got ${totals.inherited} and ${totals.added}`)
  for (const id of inherited.keys()) if (!ids.has(id)) errors.push(`inherited V1 case ${id} is missing`)
  const additions = cases.filter((c) => !inherited.has(c.id))
  const byId = new Map(cases.map((c) => [c.id, c]))
  for (const c of additions) if (!c.tags?.includes(c.case_type)) errors.push(`${c.id}: new-gap tags must include case_type`)
  const states = additions.flatMap((c) => Object.entries(c.expected?.parameters || {}).map(([field, state]) => ({ c, field, state })))
  const requireConcept = (name, predicate) => { if (!states.some(predicate)) errors.push(`new additions lack required semantic gap concept: ${name}`) }
  requireConcept('present_invalid', ({ state }) => state.user_present === true && state.valid === false && state.sufficient === false)
  requireConcept('catalog_resolved', ({ state }) => state.source === 'product_catalog' && state.user_present === false && 'value' in state)
  requireConcept('derived', ({ state }) => state.source === 'derived' && state.user_present === false && 'value' in state)
  requireConcept('documented_default', ({ state }) => state.source === 'documented_default' && state.user_present === false && 'value' in state)
  requireConcept('semantic_role_unresolved', ({ state }) => state.semantic_role === 'unresolved' && state.sufficient === false)
  requireConcept('range_valued', ({ state }) => obj(state.value) && Number.isFinite(state.value.min) && Number.isFinite(state.value.max))
  requireConcept('possible_typo', ({ state }) => state.possible_typo === true && state.valid === null && state.user_present === true)
  requireConcept('explicit_conflict_resolution', ({ state }) => obj(state.conflict) && typeof state.conflict.resolution === 'string' && state.conflict.resolution.length > 0)
  requireConcept('request_vs_device_permission', ({ c }) => c.id === 'V2-AV-007' || c.id === 'V2-AV-008')
  const requestWithoutPermission = additions.filter((c) => c.expected?.parameters?.['audio_wiring.cold_end_requested']?.user_present === true && c.expected.parameters['audio_wiring.cold_end_permission']?.source === 'missing')
  totals.parameter_states.request_without_permission = requestWithoutPermission.reduce((sum, c) => sum + Number(c.expected.parameters['audio_wiring.cold_end_requested'].user_present), 0)
  totals.parameter_state_case_counts.request_without_permission = requestWithoutPermission.length
  for (const f of ['gain_structure.input_stage_type','gain_structure.input_stage_value','gain_structure.target_peak_dbfs','venue.room_length_m','venue.room_width_m','venue.room_height_m','camera_fov.dfov_deg','camera_fov.unresolved_dimension_1','camera_fov.coverage_width_m','dmx_address.operation','audio_wiring.cold_end_requested','led_screen.assembly_unit_width_mm','led_screen.assembly_unit_height_mm','led_screen.brightness_nit']) {
    if (!fieldRegistry(schema, rubric).has(f)) errors.push(`schema does not register approved field addition ${f}`)
  }
  for (const field of ['room_length_m','room_width_m','room_height_m']) {
    const qualified = `venue.${field}`
    if (!states.some(({ c, field: f, state }) => f === qualified && state.user_present === true && c.category === 'venue')) errors.push(`new field ${qualified} lacks positive user-provided venue coverage`)
    if (!states.some(({ c, field: f, state }) => f === qualified && state.user_present === false && c.category === 'venue' && ['report','discussion'].includes(c.mode))) errors.push(`new field ${qualified} lacks a negative venue report/discussion case`)
  }
  for (const f of ['assembly_unit_width_mm','assembly_unit_height_mm']) {
    const qualified = `led_screen.${f}`
    const wide = byId.get('LED-004')?.expected?.parameters?.[qualified]
    const conventional = byId.get('LED-007')?.expected?.parameters?.[qualified]
    const expectedWide = f === 'assembly_unit_width_mm' ? 600 : 337.5
    const expectedConventional = f === 'assembly_unit_width_mm' ? 640 : 480
    if (wide?.user_present !== true || wide.value !== expectedWide || !wide.evidence.includes('600 × 337.5 mm') || conventional?.user_present !== true || conventional.value !== expectedConventional || !conventional.evidence.includes('640 × 480 mm')) errors.push(`new field ${qualified} must match the exact dimensions already stated in LED-004 and LED-007`)
    if (!additions.some((c) => c.expected?.parameters?.[qualified]?.user_present === false)) errors.push(`new field ${qualified} needs a negative LED addition case`)
  }
  if (byId.get('LED-010')?.expected?.parameters?.['led_screen.brightness_nit']?.value !== 2500 || byId.get('LED-010').expected.parameters['led_screen.brightness_nit'].user_present !== true) errors.push('LED-010 must preserve the user-stated 2500 nit brightness value')
  for (const [name, field] of [['request_without_permission','audio_wiring.cold_end_permission']]) {
    const requests = cases.filter((c) => c.expected?.parameters?.['audio_wiring.cold_end_requested']?.user_present === true && c.expected.parameters[field]?.source === 'missing')
    totals.parameter_states[name] = requests.length
    totals.parameter_state_case_counts[name] = requests.length
  }
  const expect = (id, condition, description) => { if (!condition(byId.get(id))) errors.push(`${id}: human-reviewed policy regression (${description})`) }
  const reviewedOutcomes = {
    'CROSS-001':['unclear',true,true], 'CROSS-002':['unclear',true,true], 'CROSS-003':['troubleshoot',false,false], 'CROSS-004':['project_wiring',false,false], 'CROSS-005':['knowledge',false,false], 'CROSS-006':['cable',false,false], 'CROSS-008':['multiple',false,false],
    'SUPPORT-001':['product_catalog',false,false], 'SUPPORT-005':['knowledge',false,false], 'DMX-009':['knowledge',false,false], 'CAM-004':['camera_fov',false,false], 'CAM-009':['camera_fov',false,false], 'CAM-010':['camera_fov',false,true], 'LIM-010':['limiter',false,true], 'GAIN-010':['gain_structure',false,true], 'CAB-007':['cable',false,true], 'VEN-005':['venue',false,false], 'AW-002':['audio_wiring',false,false], 'DMX-006':['dmx_address',false,true], 'SPL-007':['spl',false,true], 'CAM-008':['camera_fov',false,true], 'LED-002':['led_screen',false,true], 'LED-010':['led_screen',false,true], 'PW-006':['project_wiring',false,false], 'PW-010':['project_wiring',false,false], 'AW-008':['audio_wiring',false,true], 'SPL-002':['spl',false,false], 'LIM-007':['limiter',false,true], 'VEN-008':['venue',false,false], 'DMX-008':['dmx_address',false,false]
  }
  for (const [id, [tool, intentAmbiguous, clarify]] of Object.entries(reviewedOutcomes)) expect(id, (c) => c?.expected?.tool === tool && c.expected.intent_ambiguous === intentAmbiguous && c.expected.clarification.required === clarify, `expected reviewed route=${tool}, intent_ambiguous=${intentAmbiguous}, clarification=${clarify}`)
  expect('CAM-010', (c) => c?.expected?.parameters?.['camera_fov.sensor_width_mm']?.user_present === true && c.expected.parameters['camera_fov.sensor_width_mm'].valid === false && c.expected.clarification.required === true, 'optical format is present but invalid and clarification is required')
  expect('DMX-006', (c) => c?.expected?.parameters?.['dmx_address.start_address']?.value === 'A01O' && c.expected.parameters['dmx_address.start_address'].user_present === true && c.expected.parameters['dmx_address.start_address'].valid === false && c.expected.parameters['dmx_address.start_address'].sufficient === false && c.expected.parameters['dmx_address.target_universe']?.source === 'missing' && c.expected.clarification.required === true && c.expected.clarification.reasons.some((r) => r.parameters.includes('dmx_address.start_address')) && c.expected.clarification.reasons.some((r) => r.parameters.includes('dmx_address.target_universe')), 'preserve invalid raw start and ask for start plus missing universe')
  expect('SPL-007', (c) => c?.expected?.parameters?.['spl.speaker_count']?.user_present === true && c.expected.parameters['spl.speaker_count'].valid === false && c.expected.clarification.required === true && c.expected.clarification.reasons.some((r) => r.parameters.includes('spl.speaker_count')) && c.expected.clarification.reasons.some((r) => r.parameters.includes('spl.listening_distance_m')), 'zero is present-invalid and both it and missing distance are represented')
  expect('CAM-008', (c) => c?.expected?.parameters?.['camera_fov.scene_type']?.user_present === true && c.expected.parameters['camera_fov.unresolved_dimension_1']?.user_present === true && c.expected.parameters['camera_fov.unresolved_dimension_1'].semantic_role === 'unresolved', 'preserve the scene and leave second dimension role unresolved')
  expect('LED-002', (c) => c?.expected?.parameters?.['led_screen.assembly_unit_width_mm']?.source === 'missing' && c.expected.parameters['led_screen.assembly_unit_height_mm']?.source === 'missing' && c.expected.clarification.required === true, 'no hidden cabinet default and ask for required dimensions')
  expect('PW-006', (c) => c?.expected?.parameters?.['project_wiring.to_device']?.value === 'DPS' && c.expected.parameters['project_wiring.to_device'].valid === null && c.expected.parameters['project_wiring.to_device'].possible_typo === true && c.expected.parameters['project_wiring.cable_type']?.value === '平横音频成品线' && c.expected.parameters['project_wiring.cable_type'].valid === null && c.expected.parameters['project_wiring.cable_type'].possible_typo === true, 'retain DPS and 平横 raw strings with unknown validity')
  expect('AW-008', (c) => c?.expected?.parameters?.['audio_wiring.cold_end_requested']?.user_present === true && c.expected.parameters['audio_wiring.cold_end_permission']?.source === 'missing' && c.expected.clarification.required === true && c.expected.clarification.reasons.some((r) => r.code === 'permission_unconfirmed'), 'a request to tie shield is not permission confirmation')
  expect('VEN-008', (c) => obj(c?.expected?.parameters?.['venue.nom']?.value) && c.expected.parameters['venue.nom'].value.min === 1 && c.expected.parameters['venue.nom'].value.max === 2 && c.expected.parameters['venue.nom'].valid === true && c.expected.parameters['venue.nom'].sufficient === true && c.expected.clarification.required === false, 'valid sufficient NOM range does not force clarification')
  expect('DMX-008', (c) => c?.expected?.intent_ambiguous === false && c.expected.clarification.required === false && typeof c.expected.parameters['dmx_address.front_orientation']?.conflict?.resolution === 'string', 'explicit front-direction resolution does not leave ambiguity')
  totals.parameter_state_case_counts = Object.fromEntries(Object.entries(totals.parameter_state_case_counts).map(([k, v]) => [k, v instanceof Set ? v.size : v]))
  return { valid: errors.length === 0, errors, summary: totals }
}
function validateInputs(options = {}) {
  const errors = []
  let schema, cases
  try { schema = read(schemaPath); cases = datasetPaths.flatMap((p) => read(p)) } catch (e) { return { valid: false, errors: [`cannot load V2 inputs: ${e.message}`], summary: null } }
  const r = validateCases(cases, { schema }); errors.push(...r.errors)
  try {
    const review = read(path.join(dir, 'human-review.json'))
    const reviewed = review.human_reviewed_ids || []
    const expectedReviewed = ['CROSS-001','CROSS-002','CROSS-003','CROSS-004','CROSS-005','CROSS-006','CROSS-008','SUPPORT-001','SUPPORT-005','DMX-009','CAM-004','CAM-009','CAM-010','LIM-010','GAIN-010','CAB-007','VEN-005','AW-002','DMX-006','SPL-007','CAM-008','LED-002','LED-010','PW-006','PW-010','AW-008','SPL-002','LIM-007','VEN-008','DMX-008']
    if (reviewed.length !== 30 || new Set(reviewed).size !== 30 || review.decisions?.length !== 30 || !same([...reviewed].sort(), [...expectedReviewed].sort())) errors.push('human-review.json must preserve the exact 30 approved review IDs and 30 decision records')
    if (!same([...reviewed].sort(), review.decisions.map((x) => x.id).sort())) errors.push('human-review.json IDs and decision records must match')
    if (review.decisions.some((d) => !['A','B','C','D'].every((k) => typeof d[k] === 'string') || !d.rationale?.trim())) errors.push('all 30 human decisions require A/B/C/D outcomes and a substantive rationale')
    if (review.confirmed_product_decisions?.filter((x) => x.confirmed === true).length !== 5) errors.push('human-review.json must retain the five explicitly confirmed product decisions')
    const actualIds = new Set(cases.map((c) => c.id))
    for (const id of reviewed) if (!actualIds.has(id)) errors.push(`human review references missing case ${id}`)
  } catch (e) { errors.push(`cannot validate human-review.json: ${e.message}`) }
  let v1Manifest
  try { v1Manifest = read(V1_MANIFEST) } catch (e) { errors.push(`cannot load V1 freeze manifest: ${e.message}`) }
  if (v1Manifest) {
    const v1Files = ['dataset/audio.cases.json','dataset/av-and-controls.cases.json','rubric.v1.json','questions.v1.json','validate.cjs','freeze.cjs','README.md'].sort()
    if (v1Manifest.version !== '1.0' || v1Manifest.phase !== 'P2-A' || v1Manifest.inferenceExecuted !== false || v1Manifest.datasetSha256 !== V1_HASH || v1Manifest.baseCommit !== V1_COMMIT || v1Manifest.canonicalization !== 'Cases sorted by id; recursively sort object keys; preserve array order; compact UTF-8 JSON with final LF') errors.push('V1 manifest baseline metadata does not match approved source anchors')
    if (!same(Object.keys(v1Manifest.files || {}).sort(), v1Files)) errors.push('V1 manifest must cover every V1 frozen source file exactly once')
    try { if (sha(Buffer.from(canonicalDataset(loadV1()), 'utf8')) !== V1_HASH) errors.push('V1 dataset canonical hash mismatch') } catch (e) { errors.push(`cannot hash V1 dataset: ${e.message}`) }
    for (const [rel, expected] of Object.entries(v1Manifest.files || {})) {
      const file = path.join(root, rel)
      try { if (fileSha(file) !== expected) errors.push(`V1 frozen source hash mismatch: ${rel}`) } catch { errors.push(`V1 frozen source missing: ${rel}`) }
    }
  }
  const frozen = fs.existsSync(manifestPath)
  if (options.requireFrozen || process.argv.includes('--require-frozen')) {
    if (!frozen) errors.push('V2 freeze.json is missing')
    else {
      const m = read(manifestPath)
      const authored = ['schema.json','validate.cjs','freeze.cjs','README.md','human-review.json',...datasetPaths.map((p) => path.basename(p))].sort()
      if (JSON.stringify(Object.keys(m.files || {}).sort()) !== JSON.stringify(authored)) errors.push('V2 manifest file set must equal the complete authored V2 file set')
      if (m.version !== '2.0' || m.phase !== 'P2-A-V2/offline-dataset' || m.inference_executed !== false || m.case_count !== 144 || m.base_commit !== V1_COMMIT || m.v1_dataset_sha256 !== V1_HASH || m.canonicalization !== 'Cases sorted by id; recursively sort object keys; preserve array order; compact UTF-8 JSON with final LF') errors.push('V2 manifest metadata is incomplete or incorrect')
      if (m.dataset_sha256 !== sha(Buffer.from(canonicalDataset(datasetPaths.flatMap((p) => read(p))), 'utf8'))) errors.push('V2 manifest dataset hash mismatch')
      for (const [rel, expected] of Object.entries(m.files || {})) { try { if (fileSha(path.join(dir, rel)) !== expected) errors.push(`V2 frozen file hash mismatch: ${rel}`) } catch { errors.push(`V2 frozen file missing: ${rel}`) } }
    }
  }
  return { valid: errors.length === 0, errors, summary: r.summary }
}
function selfTest() {
  const base = validateInputs()
  if (!base.valid) throw new Error(`self-test requires a fully valid authored 144-case set first:\n${base.errors.join('\n')}`)
  const fixtures = datasetPaths.flatMap((p) => read(p))
  const schema = read(schemaPath), rubric = read(V1_RUBRIC), v1 = loadV1()
  const check = (name, alter, phrase) => { const cases = structuredClone(fixtures); alter(cases); const out = validateCases(cases, { schema, rubric, v1 }); if (!out.errors.some((e) => e.includes(phrase))) throw new Error(`self-test ${name} failed: ${out.errors.join('; ')}`) }
  const userEntry = (c) => Object.entries(c.expected.parameters).find(([, state]) => state.user_present === true && state.source === 'user')
  check('unknown field', (cases) => { cases[120].expected.parameters['limiter.fake'] = structuredClone(userEntry(cases[120])[1]) }, 'unregistered field')
  check('non-substring evidence', (cases) => { const [field, state] = userEntry(cases[120]); state.evidence = 'evidence that is not in utterance'; }, 'exact non-empty substring')
  check('malformed range', (cases) => { cases.find((c) => c.id === 'VEN-008').expected.parameters['venue.nom'].value = { min: 2, max: 1 } }, 'finite min <= max')
  check('missing state', (cases) => { const c = cases[120]; const field = Object.keys(c.expected.parameters)[0]; c.expected.parameters[field] = { user_present: false, value: 3, source: 'missing', valid: null, sufficient: false, evidence: '' } }, 'missing source requires')
  check('forbidden prediction field', (cases) => { cases[120].expected.prediction = 'limiter' }, 'unknown key prediction')
  check('duplicate utterance', (cases) => { cases[120].user_utterance = cases[121].user_utterance }, 'duplicates')
  check('invalid reason label', (cases) => { cases.find((c) => c.id === 'VEN-008').expected.clarification = { required: true, reasons: [{ code: 'made_up', parameters: [] }] } }, 'unregistered')
  check('null non-missing value', (cases) => { const [field] = userEntry(cases[120]); cases[120].expected.parameters[field].value = null }, 'value must be a finite number')
  check('empty conflict resolution', (cases) => { cases.find((c) => c.id === 'DMX-008').expected.parameters['dmx_address.front_orientation'].conflict.resolution = '' }, 'non-empty explicit utterance text')
  check('non-actionable multiple member', (cases) => { const c = cases.find((x) => x.expected.tool === 'multiple'); c.expected.tools[0] = 'unclear' }, 'actionable registered tools')
  return true
}
if (require.main === module) {
  try {
    if (process.argv.includes('--self-test')) { selfTest(); console.log('V2 validator in-memory mutation checks passed'); process.exit(0) }
    const out = validateInputs()
    console.log(JSON.stringify({ valid: out.valid, errors: out.errors, summary: out.summary }, null, 2))
    process.exit(out.valid ? 0 : 1)
  } catch (e) { console.error(e.stack || e.message); process.exit(1) }
}
module.exports = { validateCases, validateInputs, canonicalDataset, canonical, sha, fileSha, fieldRegistry, selfTest, constants: { schemaPath, datasetPaths, manifestPath, V1_HASH, V1_COMMIT, ROUTES, REASONS } }

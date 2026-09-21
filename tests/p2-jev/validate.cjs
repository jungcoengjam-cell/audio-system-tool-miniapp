'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const P2_DIR = __dirname
const DATASETS = [
  path.join(P2_DIR, 'dataset', 'audio.cases.json'),
  path.join(P2_DIR, 'dataset', 'av-and-controls.cases.json')
]
const RUBRIC_PATH = path.join(P2_DIR, 'rubric.v1.json')
const QUESTIONS_PATH = path.join(P2_DIR, 'questions.v1.json')
const FREEZE_PATH = path.join(P2_DIR, 'freeze.v1.json')
const CORE_TYPES = ['standard', 'casual', 'abbreviation', 'mixed_language', 'alternative_units', 'typo', 'missing_parameters', 'ambiguous_parameters', 'irrelevant_numbers', 'wrong_parameter']
const CORE_TOOLS = ['limiter', 'spl', 'cable', 'gain_structure', 'venue', 'camera_fov', 'led_screen', 'dmx_address', 'audio_wiring', 'project_wiring']
const SUPPORT_TOOLS = ['product_catalog', 'troubleshoot', 'knowledge', 'project_records']
const ROUTES = [...CORE_TOOLS, ...SUPPORT_TOOLS, 'multiple', 'unclear', 'other']
const EXPECTED_KEYS = ['tool', 'clear_tools', 'parameters', 'parameter_evidence', 'ambiguity_level', 'needs_clarification', 'clarification_reasons', 'rationale']
const TOP_KEYS = ['id', 'category', 'mode', 'case_type', 'tags', 'user_utterance', 'provenance', 'expected']
const CORE_PREFIX = { limiter: 'LIM', spl: 'SPL', cable: 'CAB', gain_structure: 'GAIN', venue: 'VEN', camera_fov: 'CAM', led_screen: 'LED', dmx_address: 'DMX', audio_wiring: 'AW', project_wiring: 'PW' }
const GROUP_BY_PREFIX = Object.fromEntries(Object.entries(CORE_PREFIX).map(([tool, prefix]) => [prefix, tool]))
const TEXT_DUP_KEYS = ['user_utterance']
const FORBIDDEN_KEYS = new Set(['gold', 'case_metadata', 'label', 'target', 'prediction', 'model_output', 'inference_result'])

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function loadCases(files = DATASETS) {
  return files.flatMap((file) => {
    const value = readJson(file)
    if (!Array.isArray(value)) throw new Error(`${path.basename(file)} must contain a JSON array`)
    return value
  })
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
  return value
}

function canonicalDataset(cases) {
  return `${JSON.stringify(canonicalValue([...cases].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))))}\n`
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hashDataset(cases) {
  return hash(Buffer.from(canonicalDataset(cases), 'utf8'))
}

function normalizeText(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasCjk(value) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value)
}

function checkKeys(object, allowed, where, errors) {
  if (!isObject(object)) {
    errors.push(`${where} must be an object`)
    return
  }
  for (const key of Object.keys(object)) if (!allowed.includes(key)) errors.push(`${where} has unknown key ${key}`)
  for (const key of allowed) if (!(key in object)) errors.push(`${where} is missing key ${key}`)
}

function walkForbidden(value, where, errors) {
  if (Array.isArray(value)) return value.forEach((item, i) => walkForbidden(item, `${where}[${i}]`, errors))
  if (!isObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`${where} contains forbidden inference/metadata key ${key}`)
    walkForbidden(nested, `${where}.${key}`, errors)
  }
}

function validateDefinitions(rubric, questions) {
  const errors = []
  const tools = rubric.tools || {}
  const toolNames = Object.keys(tools)
  const routes = rubric.routes || []
  if (JSON.stringify([...routes].sort()) !== JSON.stringify([...ROUTES].sort())) errors.push('rubric.routes must contain exactly the 17 registered route options')
  if (rubric.phase !== 'P2-A' || rubric.inference_policy?.enabled !== false || rubric.inference_policy?.network !== false || rubric.inference_policy?.api_key_access !== false) errors.push('rubric must explicitly keep P2-A inference, network and key access disabled')
  if (rubric.thresholds?.Noul?.positive_decision_inclusive !== 0.5 || rubric.thresholds?.Noul?.low_confidence?.minimum_exclusive !== 0.2 || rubric.thresholds?.Noul?.low_confidence?.maximum_exclusive !== 0.8) errors.push('rubric Noul decision/confidence thresholds are incomplete or incorrect')
  if (rubric.thresholds?.Choice?.confidence_below !== 0.6 || rubric.thresholds?.Score?.confidence_below !== 0.6 || typeof rubric.thresholds?.route_selection !== 'string') errors.push('rubric Choice/Score thresholds or route-selection rule are incomplete')
  const q = questions?.questions || {}
  if (questions?.phase !== 'P2-A' || JSON.stringify(questions?.state_whitelist) !== JSON.stringify(['user_request'])) errors.push('questions must whitelist only user_request state in P2-A')
  if (q.route?.kind !== 'Choice' || q.route?.state !== 'user_request' || !Array.isArray(q.route.options)) errors.push('questions.route must be a user_request Choice')
  else {
    const optionIds = q.route.options.map((option) => option && option.id)
    if (JSON.stringify([...optionIds].sort()) !== JSON.stringify([...routes].sort())) errors.push('route Choice options must match rubric route IDs exactly')
    if (q.route.options.some((option) => typeof option.description !== 'string' || !option.description.trim())) errors.push('every route Choice option needs a readable Chinese description')
    if (!q.route.instructions?.includes('最高概率')) errors.push('route Choice instructions must choose the highest-probability option')
  }
  if (q.needs_clarification?.kind !== 'Noul' || q.needs_clarification?.state !== 'user_request' || q.needs_clarification?.return !== 'probability' || !isObject(q.needs_clarification?.decision_context?.tool_requirements)) errors.push('needs_clarification must inline the full user_request policy context as a probability Noul')
  else {
    const context = q.needs_clarification.decision_context
    if (JSON.stringify(Object.keys(context.reasons || {}).sort()) !== JSON.stringify([...rubric.clarification_reason_codes].sort())) errors.push('needs_clarification must define every registered clarification reason in plain language')
    if (JSON.stringify(Object.keys(context.tool_requirements || {}).sort()) !== JSON.stringify([...toolNames].sort())) errors.push('needs_clarification must inline requirements for every registered tool')
    for (const [tool, spec] of Object.entries(tools)) if (JSON.stringify(context.tool_requirements[tool]) !== JSON.stringify({ fields: spec.fields, policy: spec.policy })) errors.push(`needs_clarification context is stale for ${tool}`)
  }
  if (q.ambiguity?.kind !== 'Score' || q.ambiguity?.state !== 'user_request' || JSON.stringify(q.ambiguity.scale) !== JSON.stringify(rubric.ambiguity_scale)) errors.push('ambiguity Score levels must match rubric levels 0, 1 and 2 exactly')
  const membership = q.route_membership
  if (!isObject(membership) || JSON.stringify(Object.keys(membership).sort()) !== JSON.stringify([...toolNames].sort())) errors.push('route_membership must contain one Noul for every registered tool')
  else for (const [tool, question] of Object.entries(membership)) if (question.kind !== 'Noul' || question.state !== 'user_request' || question.return !== 'probability' || !question.question?.trim() || !question.description?.trim() || !question.positive_event?.trim()) errors.push(`route_membership.${tool} must be a self-contained probability Noul`)
  const parameter = q.parameter_presence
  if (parameter?.kind !== 'Noul' || parameter?.state !== 'user_request' || parameter?.return !== 'probability' || !isObject(parameter.fields)) errors.push('parameter_presence must be a user_request probability Noul registry')
  else {
    if (JSON.stringify(Object.keys(parameter.fields).sort()) !== JSON.stringify([...toolNames].sort())) errors.push('parameter_presence tool list must match rubric registry exactly')
    for (const [tool, spec] of Object.entries(tools)) {
      const fields = parameter.fields[tool]
      const names = Array.isArray(fields) ? fields.map((field) => field.field) : []
      if (JSON.stringify([...names].sort()) !== JSON.stringify(Object.keys(spec.fields).sort())) errors.push(`parameter_presence.${tool} must define one Noul for every registered field`)
      if (Array.isArray(fields)) for (const definition of fields) if (definition.kind !== 'Noul' || definition.return !== 'probability' || !definition.question?.trim() || !definition.definition?.trim() || !definition.positive_event?.trim()) errors.push(`parameter_presence.${tool}.${definition.field} is missing its self-contained probability Noul question/definition`)
    }
  }
  const catalog = rubric.catalog_context
  const catalogSources = ['data/equipment.js', 'data/amplifier-input-stages.js', 'data/cameras.js', 'data/stage-lighting.js']
  if (!isObject(catalog) || !catalog.scope?.trim() || !catalog.scope.includes('不包含公式计算结果或样例预期标签') || JSON.stringify(catalog.sources) !== JSON.stringify(catalogSources)) errors.push('rubric.catalog_context must document a source-backed, non-gold catalog scope')
  else {
    if (JSON.stringify(canonicalValue(q.needs_clarification?.decision_context?.catalog_context)) !== JSON.stringify(canonicalValue(catalog))) errors.push('needs_clarification must inline catalog_context exactly')
    const expectedModels = {
      amplifiers: ['TC-2350B', 'TC-22000', 'TC-4500B', 'TC-23000', 'TC-X2200B', 'TC-2500', 'TC-2500B'],
      speakers: ['TS-803C', 'TS-715H'],
      cameras: ['TS-0650JSM', 'TS-0663XP', 'TS-0663JS'],
      dmx_fixtures: ['TL-SL333']
    }
    if (JSON.stringify(Object.keys(catalog.categories || {}).sort()) !== JSON.stringify(Object.keys(expectedModels).sort())) errors.push('catalog_context categories must cover only registered product families used by this dataset')
    for (const [category, expected] of Object.entries(expectedModels)) {
      const listed = catalog.categories?.[category]?.models
      const names = Array.isArray(listed) ? listed : isObject(listed) ? Object.keys(listed) : []
      if (JSON.stringify([...names].sort()) !== JSON.stringify([...expected].sort())) errors.push(`catalog_context.${category} model list does not match the reviewed dataset model set`)
    }
    const cameraViews = catalog.categories?.cameras?.models?.['TS-0650JSM']?.views
    if (!Array.isArray(cameraViews) || !cameraViews.some((view) => view.label === '教师特写' && view.options?.some((option) => option.zoom === 'wide') && view.options?.some((option) => option.zoom === 'tele')) || !cameraViews.some((view) => view.label === '教师全景')) errors.push('catalog_context must distinguish the TS-0650JSM camera views and zoom choices')
    if (JSON.stringify(catalog.categories?.dmx_fixtures?.models?.['TL-SL333']?.channel_modes) !== JSON.stringify([3, 6])) errors.push('catalog_context must list the reviewed TL-SL333 channel modes')
  }
  const venueQuestions = parameter?.fields?.venue
  if (Array.isArray(venueQuestions)) for (const field of ['d1_m', 'd2_m']) {
    const definition = venueQuestions.find((item) => item.field === field)?.definition || ''
    if (!definition.includes('实际播放同一支话筒信号') || !definition.includes('Mix-Minus')) errors.push(`parameter_presence.venue.${field} must define the same-microphone speaker condition and Mix-Minus exclusion`)
  }
  for (const [tool, spec] of Object.entries(tools)) {
    if (spec.route !== tool || !isObject(spec.fields) || !isObject(spec.policy)) errors.push(`rubric.tools.${tool} requires matching route, fields and policy`)
    const all = new Set(Object.keys(spec.fields || {}))
    for (const listName of ['required', 'optional']) {
      const fields = spec.policy?.[listName] || []
      if (!Array.isArray(fields) || fields.some((field) => !all.has(field)) || new Set(fields).size !== fields.length) errors.push(`rubric.tools.${tool}.policy.${listName} contains invalid or duplicate fields`)
    }
    if ((spec.policy?.required || []).some((field) => (spec.policy?.optional || []).includes(field))) errors.push(`rubric.tools.${tool}.policy required/optional fields must not overlap`)
    if (spec.policy?.conditional_required && (!isObject(spec.policy.conditional_required) || Object.keys(spec.policy.conditional_required).some((field) => !all.has(field)))) errors.push(`rubric.tools.${tool}.policy.conditional_required contains an unregistered field`)
    if (spec.policy?.one_of && (!Array.isArray(spec.policy.one_of) || spec.policy.one_of.some((group) => !Array.isArray(group) || group.length === 0 || group.some((field) => !all.has(field))))) errors.push(`rubric.tools.${tool}.policy.one_of contains invalid fields`)
    for (const [mode, requirements] of Object.entries(spec.policy?.mode_requirements || {})) {
      if (Array.isArray(requirements)) {
        if (requirements.some((field) => !all.has(field))) errors.push(`rubric.tools.${tool}.policy.mode_requirements.${mode} contains an unregistered field`)
      } else if (isObject(requirements)) {
        if (requirements.all_of && (!Array.isArray(requirements.all_of) || requirements.all_of.some((field) => !all.has(field)))) errors.push(`rubric.tools.${tool}.policy.mode_requirements.${mode}.all_of contains an unregistered field`)
        if (requirements.one_of && (!Array.isArray(requirements.one_of) || requirements.one_of.some((group) => !Array.isArray(group) || group.some((field) => !all.has(field))))) errors.push(`rubric.tools.${tool}.policy.mode_requirements.${mode}.one_of contains an unregistered field`)
        if (requirements.conditional && (!isObject(requirements.conditional) || Object.keys(requirements.conditional).some((field) => !all.has(field)))) errors.push(`rubric.tools.${tool}.policy.mode_requirements.${mode}.conditional contains an unregistered field`)
      } else errors.push(`rubric.tools.${tool}.policy.mode_requirements.${mode} must describe registered fields`)
    }
  }
  return errors
}

function validateCases(cases, options = {}) {
  const errors = []
  if (!Array.isArray(cases)) return { valid: false, errors: ['cases must be an array'], summary: null }
  let rubric
  try { rubric = options.rubric || readJson(RUBRIC_PATH) } catch (error) { return { valid: false, errors: [`cannot load rubric: ${error.message}`], summary: null } }
  const registry = rubric.tools || {}
  let questions
  try { questions = options.questions || readJson(QUESTIONS_PATH) } catch (error) { return { valid: false, errors: [`cannot load questions: ${error.message}`], summary: null } }
  errors.push(...validateDefinitions(rubric, questions))
  const fieldNames = new Set(Object.entries(registry).flatMap(([tool, spec]) => Object.keys(spec.fields || {}).map((field) => `${tool}.${field}`)))
  if (cases.length !== 120) errors.push(`expected exactly 120 cases; got ${cases.length}`)

  const ids = new Set()
  const texts = new Map()
  const count = (map, key) => map.set(key, (map.get(key) || 0) + 1)
  const categories = new Map(), caseTypes = new Map(), tools = new Map(), ambiguity = new Map(), clarification = new Map(), parameterBooleans = new Map(), modesByCategory = new Map()
  const perField = new Map([...fieldNames].map((field) => [field, { true: 0, false: 0 }]))
  const coreMatrix = new Map(CORE_TOOLS.map((tool) => [tool, new Map()]))
  const seenCross = new Set(), seenSupport = new Set(), seenOther = new Set()

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index]
    const where = `case[${index}]`
    checkKeys(item, TOP_KEYS, where, errors)
    if (!isObject(item)) continue
    walkForbidden(item, where, errors)
    for (const key of ['id', 'category', 'mode', 'case_type', 'user_utterance', 'provenance']) if (typeof item[key] !== 'string' || !item[key].trim()) errors.push(`${where}.${key} must be a non-empty string`)
    if (item.provenance !== 'synthetic') errors.push(`${where}.provenance must equal synthetic`)
    if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string' || !tag.trim()) || new Set(item.tags).size !== item.tags.length) errors.push(`${where}.tags must be an array of unique non-empty strings`)
    else if (!item.tags.includes(item.case_type)) errors.push(`${where}.tags must include case_type`)
    if (typeof item.user_utterance === 'string') {
      if (!hasCjk(item.user_utterance)) errors.push(`${where}.user_utterance must contain CJK text`)
      const normalized = normalizeText(item.user_utterance)
      if (texts.has(normalized)) errors.push(`${where}.user_utterance duplicates ${texts.get(normalized)} after NFKC/whitespace normalization`)
      else texts.set(normalized, item.id)
    }
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${where}.id duplicates ${item.id}`)
      ids.add(item.id)
    }
    count(categories, item.category)
    count(caseTypes, item.case_type)
    if (!modesByCategory.has(item.category)) modesByCategory.set(item.category, new Map())
    count(modesByCategory.get(item.category), item.mode)

    const expected = item.expected
    checkKeys(expected, EXPECTED_KEYS, `${where}.expected`, errors)
    if (!isObject(expected)) continue
    if (!ROUTES.includes(expected.tool)) errors.push(`${where}.expected.tool is not a registered route`)
    else count(tools, expected.tool)
    if (typeof expected.rationale !== 'string' || !expected.rationale.trim() || !hasCjk(expected.rationale)) errors.push(`${where}.expected.rationale must be non-empty and contain CJK text`)
    if (!Number.isInteger(expected.ambiguity_level) || expected.ambiguity_level < 0 || expected.ambiguity_level > 2) errors.push(`${where}.expected.ambiguity_level must be integer 0..2`)
    if (typeof expected.needs_clarification !== 'boolean') errors.push(`${where}.expected.needs_clarification must be boolean`)
    if (!Array.isArray(expected.clarification_reasons) || !Array.isArray(rubric.clarification_reason_codes) || expected.clarification_reasons.some((reason) => !rubric.clarification_reason_codes.includes(reason))) errors.push(`${where}.expected.clarification_reasons contains an invalid code`)
    else if (new Set(expected.clarification_reasons).size !== expected.clarification_reasons.length) errors.push(`${where}.expected.clarification_reasons must be unique`)
    if (typeof expected.needs_clarification === 'boolean' && Array.isArray(expected.clarification_reasons) && expected.needs_clarification !== (expected.clarification_reasons.length > 0)) errors.push(`${where}: needs_clarification must match whether clarification_reasons is non-empty`)
    count(ambiguity, expected.ambiguity_level)
    count(clarification, String(expected.needs_clarification))
    const clearToolsValid = Array.isArray(expected.clear_tools) && expected.clear_tools.every((tool) => CORE_TOOLS.concat(SUPPORT_TOOLS).includes(tool)) && new Set(expected.clear_tools).size === expected.clear_tools.length
    if (!clearToolsValid) errors.push(`${where}.expected.clear_tools must be a unique array of actual registered tools`)
    else if (expected.tool && expected.tool !== 'multiple' && expected.tool !== 'unclear' && expected.tool !== 'other' && (expected.clear_tools.length !== 1 || expected.clear_tools[0] !== expected.tool)) errors.push(`${where}: a unique route must have clear_tools=[tool]`)
    else if (expected.tool === 'multiple' && expected.clear_tools.length < 2) errors.push(`${where}: multiple route must identify at least two clear tools`)
    else if ((expected.tool === 'unclear' || expected.tool === 'other') && expected.clear_tools.length !== 0) errors.push(`${where}: unclear/other route must have no clear_tools`)

    if (!isObject(expected.parameters)) errors.push(`${where}.expected.parameters must be an object`)
    if (!isObject(expected.parameter_evidence)) errors.push(`${where}.expected.parameter_evidence must be an object`)
    if (isObject(expected.parameters) && isObject(expected.parameter_evidence)) {
      const evidenceKeys = new Set(Object.keys(expected.parameter_evidence))
      for (const [field, present] of Object.entries(expected.parameters)) {
        if (!fieldNames.has(field)) errors.push(`${where}.expected.parameters has unregistered field ${field}`)
        if (typeof present !== 'boolean') errors.push(`${where}.expected.parameters.${field} must be boolean`)
        count(parameterBooleans, String(present))
        if (perField.has(field)) perField.get(field)[String(present)] += 1
        const evidence = expected.parameter_evidence[field]
        if (present === true) {
          if (typeof evidence !== 'string' || !evidence) errors.push(`${where}: true field ${field} requires exact substring evidence`)
          else if (typeof item.user_utterance !== 'string' || !item.user_utterance.includes(evidence)) errors.push(`${where}: evidence for ${field} is not an exact substring of user_utterance`)
          evidenceKeys.delete(field)
        } else if (present === false && evidence !== undefined) errors.push(`${where}: false field ${field} must not have evidence`)
      }
      for (const field of evidenceKeys) errors.push(`${where}.expected.parameter_evidence has no true registered parameter ${field}`)
      if (CORE_TOOLS.includes(expected.tool) && Object.keys(expected.parameters).length === 0) errors.push(`${where}: core cases must label at least one applicable registered parameter`)
    }

    if (typeof item.id === 'string') {
      if (/^CROSS-\d{3}$/.test(item.id)) {
        seenCross.add(item.id)
        if (item.category !== 'cross_tool' || item.case_type !== 'cross_tool_ambiguity' && item.case_type !== 'multi_tool_request') errors.push(`${where}: invalid CROSS category/type`)
        const n = Number(item.id.slice(-3))
        if (n <= 6 && expected.tool !== 'unclear') errors.push(`${where}: CROSS-001..006 must use unclear route`)
        if (n >= 7 && expected.tool !== 'multiple') errors.push(`${where}: CROSS-007..008 must use multiple route`)
        if (n <= 6 && item.case_type !== 'cross_tool_ambiguity') errors.push(`${where}: CROSS-001..006 must use cross_tool_ambiguity`)
        if (n >= 7 && item.case_type !== 'multi_tool_request') errors.push(`${where}: CROSS-007..008 must use multi_tool_request`)
      } else if (/^SUPPORT-\d{3}$/.test(item.id)) {
        seenSupport.add(item.id)
        const expectedSupportRoute = { '001': 'product_catalog', '002': 'product_catalog', '003': 'troubleshoot', '004': 'troubleshoot', '005': 'knowledge', '006': 'project_records' }[item.id.slice(-3)]
        if (item.category !== 'supporting' || item.case_type !== 'supporting_request' || expected.tool !== expectedSupportRoute) errors.push(`${where}: invalid SUPPORT category/type/route`)
      } else if (/^OTHER-\d{3}$/.test(item.id)) {
        seenOther.add(item.id)
        if (item.category !== 'unrelated' || item.case_type !== 'unrelated' || expected.tool !== 'other' || !Array.isArray(expected.clear_tools) || expected.clear_tools.length !== 0) errors.push(`${where}: invalid OTHER category/type/route`)
      } else {
        const match = item.id.match(/^([A-Z]+)-(\d{3})$/)
        const coreTool = match && GROUP_BY_PREFIX[match[1]]
        if (!coreTool || item.category !== coreTool || expected.tool !== coreTool || !CORE_TYPES.includes(item.case_type)) errors.push(`${where}: invalid core case id/category/type/route`)
        else {
          const matrix = coreMatrix.get(coreTool)
          count(matrix, item.case_type)
          if (Number(match[2]) < 1 || Number(match[2]) > 10) errors.push(`${where}: core ID sequence must be 001..010`)
        }
      }
    }
  }

  for (const tool of CORE_TOOLS) {
    const matrix = coreMatrix.get(tool)
    if (matrix.size !== CORE_TYPES.length || CORE_TYPES.some((type) => matrix.get(type) !== 1)) errors.push(`${tool}: must contain each primary case_type exactly once`)
  }
  for (const tool of CORE_TOOLS) if (categories.get(tool) !== 10) errors.push(`${tool}: expected exactly 10 core cases; got ${categories.get(tool) || 0}`)
  for (const [category, expectedCount] of [['cross_tool', 8], ['supporting', 6], ['unrelated', 6]]) if (categories.get(category) !== expectedCount) errors.push(`${category}: expected exactly ${expectedCount} cases; got ${categories.get(category) || 0}`)
  const venueModes = modesByCategory.get('venue') || new Map()
  if (venueModes.get('report') !== 3 || venueModes.get('discussion') !== 3 || venueModes.get('pag_nag') !== 4) errors.push('venue: expected modes report=3, discussion=3, pag_nag=4')
  const dmxModes = modesByCategory.get('dmx_address') || new Map()
  if (dmxModes.get('addressing') !== 6 || dmxModes.get('layout') !== 2 || dmxModes.get('channel_guide') !== 2) errors.push('dmx_address: expected modes addressing=6, layout=2, channel_guide=2')
  const expectedRoutes = { limiter: 10, spl: 10, cable: 10, gain_structure: 10, venue: 10, camera_fov: 10, led_screen: 10, dmx_address: 10, audio_wiring: 10, project_wiring: 10, product_catalog: 2, troubleshoot: 2, knowledge: 1, project_records: 1, multiple: 2, unclear: 6, other: 6 }
  for (const [route, expectedCount] of Object.entries(expectedRoutes)) if (tools.get(route) !== expectedCount) errors.push(`route ${route}: expected ${expectedCount} cases; got ${tools.get(route) || 0}`)
  for (const [prefix, set, total] of [['CROSS', seenCross, 8], ['SUPPORT', seenSupport, 6], ['OTHER', seenOther, 6]]) {
    if (set.size !== total) errors.push(`${prefix}: expected ${total} unique IDs; got ${set.size}`)
    for (let i = 1; i <= total; i += 1) if (!set.has(`${prefix}-${String(i).padStart(3, '0')}`)) errors.push(`${prefix}: missing ${prefix}-${String(i).padStart(3, '0')}`)
  }
  const summary = {
    total: cases.length,
    category: Object.fromEntries([...categories].sort()),
    case_type: Object.fromEntries([...caseTypes].sort()),
    tool: Object.fromEntries([...tools].sort()),
    ambiguity: Object.fromEntries([...ambiguity].sort((a, b) => Number(a[0]) - Number(b[0]))),
    clarification: Object.fromEntries([...clarification].sort()),
    mode: Object.fromEntries([...modesByCategory].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([category, counts]) => [category, Object.fromEntries([...counts].sort())])),
    parameter_boolean: Object.fromEntries([...parameterBooleans].sort()),
    parameter_fields: Object.fromEntries([...perField].sort(([a], [b]) => a.localeCompare(b, 'en')))
  }
  return { valid: errors.length === 0, errors, summary }
}

function fileSha256(file) {
  return hash(fs.readFileSync(file))
}

function expectedFileHashes(cases) {
  const files = [...DATASETS, RUBRIC_PATH, QUESTIONS_PATH, __filename, path.join(P2_DIR, 'freeze.cjs'), path.join(P2_DIR, 'README.md')]
  return Object.fromEntries(files.map((file) => [path.relative(P2_DIR, file).replace(/\\/g, '/'), fileSha256(file)]))
}

function validateFrozen(cases, manifest = readJson(FREEZE_PATH)) {
  const errors = []
  if (manifest.phase !== 'P2-A' || manifest.inferenceExecuted !== false) errors.push('freeze manifest must declare phase P2-A and inferenceExecuted=false')
  if (manifest.baseCommit !== 'e89d57a492bb776fed35809eed91741715e828b0') errors.push('freeze manifest baseCommit does not match the approved baseline')
  if (manifest.caseCount !== 120 || manifest.caseCount !== cases.length) errors.push('freeze manifest caseCount mismatch')
  if (manifest.datasetSha256 !== hashDataset(cases)) errors.push('freeze manifest datasetSha256 mismatch')
  if (manifest.canonicalization !== 'Cases sorted by id; recursively sort object keys; preserve array order; compact UTF-8 JSON with final LF') errors.push('freeze manifest canonicalization mismatch')
  const actual = expectedFileHashes(cases)
  if (JSON.stringify(canonicalValue(manifest.files)) !== JSON.stringify(canonicalValue(actual))) errors.push('freeze manifest file hashes mismatch')
  return { valid: errors.length === 0, errors }
}

function validateAll(options = {}) {
  const cases = options.cases || loadCases()
  const result = validateCases(cases, options)
  if (options.requireFrozen) {
    let frozen
    try { frozen = validateFrozen(cases) } catch (error) { frozen = { valid: false, errors: [`cannot read freeze manifest: ${error.message}`] } }
    result.errors.push(...frozen.errors)
    result.valid = result.errors.length === 0
  }
  return { ...result, cases }
}

module.exports = { validateCases, validateAll, validateDefinitions, loadCases, canonicalDataset, canonicalValue, hash, hashDataset, normalizeText, fileSha256, expectedFileHashes, validateFrozen, constants: { DATASETS, RUBRIC_PATH, QUESTIONS_PATH, FREEZE_PATH, CORE_TYPES, CORE_TOOLS, SUPPORT_TOOLS, ROUTES, CORE_PREFIX, GROUP_BY_PREFIX } }

if (require.main === module) {
  const result = validateAll({ requireFrozen: process.argv.includes('--require-frozen') })
  if (result.summary) process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`)
  if (result.errors.length) {
    for (const error of result.errors) process.stderr.write(`ERROR ${error}\n`)
    process.exitCode = 1
  } else process.stdout.write('P2-A dataset validation passed.\n')
}

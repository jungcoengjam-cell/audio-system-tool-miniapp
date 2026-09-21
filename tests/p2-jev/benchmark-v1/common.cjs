'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const DIR = __dirname
const DATASET_SHA256 = 'b4f7c2de6036c0dee0c1d00bdde5c7158baad18d5bebb9dd9e045c4e9a618c00'
const ROUTES = ['camera_fov', 'gain_structure', 'venue', 'audio_wiring', 'cable', 'spl', 'led_screen', 'project_wiring', 'limiter', 'dmx_address', 'knowledge', 'troubleshoot', 'product_catalog', 'project_records', 'other', 'multiple', 'unclear']
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'))
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

function loadAssets() {
  const protocol = read('protocol.json')
  const context = read('context.json')
  const stimuli = read('stimuli.json')
  const scope = read('scope.json')
  return { protocol, context, stimuli, scope }
}

function buildRequests(assets = loadAssets()) {
  const { protocol, context, stimuli, scope } = assets
  const scopeByCase = new Map(scope.map((entry) => [entry.case_id, entry.parameters]))
  const routing = protocol.routing_choices
  const caseQuestions = {
    routing: { type: 'choice', instructions: 'Choose the best request route. Select multiple only for distinct, independently actionable operations. For ordered or dependent operations, choose the first actionable prerequisite. Mentioning alternative tool names alone does not require unclear; use unclear only when the requested operation cannot be identified.', criteria: Object.fromEntries(context.routing_options.map((item) => [item.id, item.definition])) },
    intent_ambiguous: { type: 'noul', instructions: 'Does the utterance leave the requested intent materially ambiguous?', criteria: { true: 'The intended task or route cannot be uniquely determined from the utterance.', false: 'The intended task is sufficiently clear to identify a route.' } },
    clarification_required: { type: 'noul', instructions: 'Does the utterance contain a user-actionable blocker that requires clarification before the requested task can proceed?', criteria: { true: 'An unresolved intent or missing, invalid, uncertain, permission, or conflict blocker prevents proceeding.', false: 'No user-actionable blocker prevents proceeding.' } }
  }
  const toolDefinitions = Object.fromEntries(Object.entries(context.tools).map(([id, tool]) => [id, { description: tool.description, parameters: tool.parameters }]))
  const neutralContext = (utterance) => ({ tools: toolDefinitions, generic_rules: context.generic_rules, documented_defaults: context.documented_defaults, generic_facts: context.generic_facts, catalog_facts: context.catalog_facts.filter((item) => {
    const escaped = item.model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'iu').test(utterance)
  }) })
  const requests = []
  for (const stimulus of stimuli) {
    if (!scopeByCase.has(stimulus.id)) throw new Error(`Missing scope for ${stimulus.id}`)
    const neutralState = { utterance: stimulus.user_utterance, context: neutralContext(stimulus.user_utterance) }
    requests.push({
      case_id: stimulus.id,
      request_id: `${stimulus.id}--case`,
      judgments: ['routing', 'intent_ambiguous', 'clarification_required'].map((id) => ({ id, target: id, parameter: null })),
      body: { model: protocol.model, state: neutralState, questions: caseQuestions }
    })
    for (const parameter of scopeByCase.get(stimulus.id)) {
      const definition = context.parameters[parameter]
      if (!definition) throw new Error(`No neutral definition for ${parameter}`)
      const perParameterState = { utterance: stimulus.user_utterance, context: neutralContext(stimulus.user_utterance), parameter: { name: parameter, definition: definition.name } }
      requests.push({
        case_id: stimulus.id,
        request_id: `${stimulus.id}--${parameter}`,
        judgments: [
          { id: 'user_present', target: 'user_present', parameter },
          { id: 'validity', target: 'validity', parameter },
          { id: 'sufficient', target: 'sufficient', parameter }
        ],
        body: { model: protocol.model, state: perParameterState, questions: {
          user_present: { type: 'noul', instructions: `Is ${definition.name} explicitly provided by the user in the utterance? Invalid explicit candidates count as present; catalog values, defaults, and derived values do not.`, criteria: { true: 'The utterance explicitly supplies this parameter.', false: 'The utterance does not explicitly supply this parameter.' } },
          validity: { type: 'choice', instructions: `Is the currently available information for ${definition.name} valid under the generic domain and constraints in context? Consider explicit, catalog, documented-default, and derived information that is available. Choose unknown only when validity cannot be determined.`, criteria: { valid: 'Available information is valid for the parameter.', invalid: 'Available information is outside allowed constraints or otherwise invalid.', unknown: 'Available evidence cannot determine validity.' } },
          sufficient: { type: 'noul', instructions: `Is the current information for ${definition.name} usable for this parameter in the requested operation? Judge this parameter alone; do not decide whether the whole request is ready.`, criteria: { true: 'Current information can be used for this parameter in this operation.', false: 'Current information cannot yet be used for this parameter in this operation.' } }
        } }
      })
    }
  }
  return requests
}

function sourceFiles() {
  const excluded = new Set(['freeze.json'])
  const result = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'reports' || entry.name === 'runs' || entry.name === 'analysis' || entry.name === 'dry-run-output') continue
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (!excluded.has(entry.name)) result.push(path.relative(DIR, absolute).replaceAll(path.sep, '/'))
    }
  }
  visit(DIR)
  return result.sort()
}

function verifyFrozen() {
  const manifest = read('freeze.json')
  if (manifest.dataset_sha256 !== DATASET_SHA256) throw new Error('Frozen dataset hash does not match V2.1')
  const files = sourceFiles()
  const recorded = Object.keys(manifest.files).sort()
  if (JSON.stringify(files) !== JSON.stringify(recorded)) throw new Error('Frozen source file set differs from the manifest')
  for (const file of files) if (sha256(fs.readFileSync(path.join(DIR, file))) !== manifest.files[file]) throw new Error(`Frozen file hash mismatch: ${file}`)
  const protocol = read('protocol.json')
  const protocolHash = sha256(Buffer.from(JSON.stringify(canonical({ version: manifest.version, dataset_sha256: manifest.dataset_sha256, files: manifest.files }))))
  if (protocol.dataset_sha256 !== DATASET_SHA256 || protocolHash !== manifest.protocol_sha256) throw new Error('Protocol freeze digest mismatch')
  return { protocolHash, manifest }
}

module.exports = { loadAssets, buildRequests, canonical, sha256, verifyFrozen, sourceFiles, DATASET_SHA256, ROUTES }

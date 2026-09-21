'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { loadAssets, buildRequests, verifyFrozen, sha256, canonical, DATASET_SHA256, ROUTES } = require('./common.cjs')

const BASE = __dirname
const REQUESTED_MODEL = 'jev-1.13.0'
const PROTOCOL_VERSION = '1.0.0'
const TARGETS = ['routing', 'intent_ambiguous', 'clarification_required', 'user_present', 'validity', 'sufficient']
const ROUTING = ROUTES
const VALIDITY = ['valid', 'invalid', 'unknown']
const CONFIDENCE_BANDS = [
  { name: 'very_low', min: 0, max: 0.5, inclusiveMax: false },
  { name: 'low', min: 0.5, max: 0.7, inclusiveMax: false },
  { name: 'medium', min: 0.7, max: 0.9, inclusiveMax: false },
  { name: 'high', min: 0.9, max: 1, inclusiveMax: true }
]

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function within(parent, child) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}
function realExistingAncestor(target) {
  let current = path.resolve(target)
  while (!fs.existsSync(current)) {
    const next = path.dirname(current)
    if (next === current) throw new Error(`Cannot resolve output path: ${target}`)
    current = next
  }
  const real = fs.realpathSync(current)
  return path.join(real, path.relative(current, path.resolve(target)))
}
function validateOutputLocation(runDir, outputFile) {
  const runReal = fs.realpathSync(runDir)
  const outputResolved = realExistingAncestor(outputFile)
  if (within(runReal, outputResolved)) throw new Error('Output must be outside the raw run directory')
  if (fs.existsSync(outputFile)) throw new Error(`Output already exists: ${outputFile}`)
  return outputResolved
}
function treeHashes(directory) {
  const result = new Map()
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        result.set(path.relative(directory, full).replaceAll(path.sep, '/'), `symlink:${fs.readlinkSync(full)}`)
      } else if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) result.set(path.relative(directory, full).replaceAll(path.sep, '/'), sha256(fs.readFileSync(full)))
    }
  }
  visit(directory)
  return result
}
function sameMap(a, b) {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v)
}
function answerKey(judgment) { return judgment.id }
function expectedFor(caseAsset, judgment) {
  const expected = caseAsset.expected
  if (judgment.id === 'routing') return expected.tool
  if (judgment.id === 'intent_ambiguous') return expected.intent_ambiguous
  if (judgment.id === 'clarification_required') return expected.clarification.required
  const state = expected.parameters[judgment.parameter]
  if (!state) throw new Error(`Missing expected parameter state: ${caseAsset.id} ${judgment.parameter}`)
  if (judgment.id === 'validity') return state.valid === true ? 'valid' : state.valid === false ? 'invalid' : 'unknown'
  return state[judgment.id]
}
function validProbability(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 }
function decodeAnswer(raw, judgment) {
  const errors = []
  const key = answerKey(judgment)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `Missing or invalid answer object for ${key}` }
  if (judgment.id === 'routing' || judgment.id === 'validity') {
    const options = judgment.id === 'routing' ? ROUTING : VALIDITY
    if (raw.type !== 'choice') return { error: `${key}: expected type choice` }
    if (!options.includes(raw.choice)) errors.push(`${key}: unknown choice ${String(raw.choice)}`)
    if (!raw.probabilities || typeof raw.probabilities !== 'object' || Array.isArray(raw.probabilities)) errors.push(`${key}: probabilities must be an object`)
    else {
      const keys = Object.keys(raw.probabilities).sort()
      if (JSON.stringify(keys) !== JSON.stringify([...options].sort())) errors.push(`${key}: probability keys do not match the pinned choice set`)
      let sum = 0
      for (const option of options) {
        const p = raw.probabilities[option]
        if (!validProbability(p)) errors.push(`${key}: invalid probability for ${option}`)
        else sum += p
      }
      if (options.every((option) => validProbability(raw.probabilities[option])) && Math.abs(sum - 1) > 1e-6) errors.push(`${key}: probabilities sum to ${sum}, not 1`)
      if (options.includes(raw.choice) && options.every((option) => validProbability(raw.probabilities[option]))) {
        const max = Math.max(...options.map((option) => raw.probabilities[option]))
        if (raw.probabilities[raw.choice] !== max) errors.push(`${key}: choice is not a maximum-probability option`)
      }
    }
    if (!validProbability(raw.confidence)) errors.push(`${key}: invalid API confidence`)
    return errors.length ? { error: errors.join('; ') } : {
      predicted: raw.choice,
      probabilities: raw.probabilities,
      confidence: raw.confidence,
      confidenceSource: 'API confidence'
    }
  }
  if (raw.type !== 'noul') return { error: `${key}: expected type noul` }
  if (!validProbability(raw.noul)) return { error: `${key}: invalid noul probability` }
  const positive = raw.noul >= 0.5
  const certainty = Math.max(raw.noul, 1 - raw.noul)
  return {
    predicted: positive,
    probabilities: { false: 1 - raw.noul, true: raw.noul },
    confidence: certainty,
    confidenceSource: 'derived decision certainty: max(p, 1-p)'
  }
}
function binaryCounts(rows, positiveExpected = true) {
  let tp = 0, tn = 0, fp = 0, fn = 0
  for (const row of rows) {
    const e = row.expected === positiveExpected
    const p = row.predicted === positiveExpected
    if (e && p) tp++
    else if (!e && !p) tn++
    else if (!e && p) fp++
    else fn++
  }
  const div = (a, b) => b ? a / b : null
  const precision = div(tp, tp + fp), recall = div(tp, tp + fn)
  return { support: tp + fn, observed: rows.length, correct: tp + tn, tp, tn, fp, fn,
    accuracy: div(tp + tn, rows.length), precision, recall,
    f1: 2 * tp + fp + fn === 0 ? null : (2 * tp) / (2 * tp + fp + fn) }
}
function choiceMetrics(rows, choices) {
  const matrix = Object.fromEntries(choices.map((e) => [e, Object.fromEntries(choices.map((p) => [p, 0]))]))
  let correct = 0
  for (const row of rows) {
    if (matrix[row.expected] && Object.hasOwn(matrix[row.expected], row.predicted)) matrix[row.expected][row.predicted]++
    if (row.expected === row.predicted) correct++
  }
  return { support: rows.length, observed: rows.length, correct, accuracy: rows.length ? correct / rows.length : null, labels: [...choices], confusion_matrix: matrix }
}
function metricFor(rows, target) {
  if (target === 'routing') return choiceMetrics(rows, ROUTING)
  if (target === 'validity') return choiceMetrics(rows, VALIDITY)
  return binaryCounts(rows)
}
function hasSlice(caseAsset, slice) {
  const tags = caseAsset.tags || []
  const states = Object.values(caseAsset.expected.parameters || {})
  switch (slice) {
    case 'ambiguous_requests': return caseAsset.expected.intent_ambiguous === true
    case 'invalid_requests': return states.some((s) => s.valid === false)
    case 'missing_source': return states.some((s) => s.source === 'missing')
    case 'range_cases': return states.some((s) => s.value && typeof s.value === 'object' && !Array.isArray(s.value) && Number.isFinite(s.value.min) && Number.isFinite(s.value.max))
    case 'catalog_source': return states.some((s) => s.source === 'product_catalog')
    case 'derived_source': return states.some((s) => s.source === 'derived')
    case 'possible_typo': return states.some((s) => s.possible_typo === true) || caseAsset.case_type === 'typo' || tags.includes('typo')
    case 'conflict_present': return states.some((s) => s.conflict !== undefined && s.conflict !== null)
    case 'resolved_conflict': return states.some((s) => s.conflict && typeof s.conflict.resolution === 'string' && s.conflict.resolution.length > 0 && caseAsset.user_utterance.includes(s.conflict.resolution))
    case 'mixed_language': return caseAsset.case_type === 'mixed_language' || tags.includes('mixed_language')
    case 'alternative_units': return caseAsset.case_type === 'alternative_units' || tags.includes('alternative_units')
    default: throw new Error(`Unknown frozen slice: ${slice}`)
  }
}
const SLICE_RULES = {
  ambiguous_requests: 'expected.intent_ambiguous === true',
  invalid_requests: 'at least one expected parameter has valid === false',
  missing_source: 'at least one expected parameter has source === missing',
  range_cases: 'at least one expected parameter value is an object with finite min and max',
  catalog_source: 'at least one expected parameter has source === product_catalog',
  derived_source: 'at least one expected parameter has source === derived',
  possible_typo: 'possible_typo === true, or case_type/tags marks typo',
  conflict_present: 'at least one expected parameter has a conflict object',
  resolved_conflict: 'a conflict resolution substring is present in the utterance',
  mixed_language: 'case_type === mixed_language or tags contains mixed_language',
  alternative_units: 'case_type === alternative_units or tags contains alternative_units'
}

function loadRun(runDir, protocolHash, requestsById) {
  const runFile = path.join(runDir, 'run.json')
  const run = readJson(runFile)
  if (run.run_id !== path.basename(runDir)) throw new Error('Run ID does not match raw run directory')
  if (run.dataset_sha256 !== DATASET_SHA256) throw new Error('Run dataset hash does not match frozen V2.1')
  if (run.protocol_sha256 !== protocolHash) throw new Error('Run protocol hash does not match frozen protocol')
  if (run.requested_model !== REQUESTED_MODEL) throw new Error('Run requested model does not match pinned model')
  if (run.protocol_version !== PROTOCOL_VERSION) throw new Error('Run protocol version does not match pinned protocol')
  const recordsDir = path.join(runDir, 'records')
  const entries = fs.readdirSync(recordsDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json'))
  const parsed = new Map()
  const errors = []
  const invalidRequests = new Set()
  const attemptStats = []
  for (const entry of entries) {
    const file = path.join(recordsDir, entry.name)
    let record
    try { record = readJson(file) } catch (error) { errors.push({ kind: 'record_json', file: path.relative(runDir, file).replaceAll(path.sep, '/'), message: error.message }); continue }
    if (typeof record.request_id === 'string' && Number.isInteger(record.attempt)) attemptStats.push(record)
    const expectedName = `${record.request_id}.attempt-${record.attempt}.json`
    if (entry.name !== expectedName) { errors.push({ kind: 'record_filename', file: path.relative(runDir, file).replaceAll(path.sep, '/'), message: `filename does not match request/attempt (${expectedName})` }); invalidRequests.add(record.request_id) }
    const req = requestsById.get(record.request_id)
    if (!req || req.case_id !== record.case_id) { errors.push({ kind: 'unknown_request', request_id: record.request_id, case_id: record.case_id, rawref: path.relative(runDir, file).replaceAll(path.sep, '/') }); continue }
    if (record.dataset_sha256 !== DATASET_SHA256 || record.protocol_sha256 !== protocolHash || record.protocol_version !== PROTOCOL_VERSION || record.requested_model !== REQUESTED_MODEL) {
      errors.push({ kind: 'identity_mismatch', request_id: record.request_id, rawref: path.relative(runDir, file).replaceAll(path.sep, '/') }); invalidRequests.add(record.request_id); continue
    }
    if (record.model !== null && record.model !== REQUESTED_MODEL) { errors.push({ kind: 'actual_model_mismatch', request_id: record.request_id, model: record.model, rawref: path.relative(runDir, file).replaceAll(path.sep, '/') }); invalidRequests.add(record.request_id); continue }
    if (JSON.stringify(record.judgments) !== JSON.stringify(req.judgments)) { errors.push({ kind: 'judgment_identity_mismatch', request_id: record.request_id, rawref: path.relative(runDir, file).replaceAll(path.sep, '/') }); invalidRequests.add(record.request_id); continue }
    if (!record.request_body || JSON.stringify(canonical(record.request_body)) !== JSON.stringify(canonical(req.body))) { errors.push({ kind: 'request_body_mismatch', request_id: record.request_id, rawref: path.relative(runDir, file).replaceAll(path.sep, '/') }); invalidRequests.add(record.request_id); continue }
    if (!Number.isInteger(record.attempt) || record.attempt < 1 || record.attempt > 3 || !Number.isFinite(record.latency_ms) || record.latency_ms < 0) { errors.push({ kind: 'record_metadata', request_id: record.request_id, rawref: path.relative(runDir, file).replaceAll(path.sep, '/') }); invalidRequests.add(record.request_id); continue }
    if (!parsed.has(record.request_id)) parsed.set(record.request_id, [])
    parsed.get(record.request_id).push({ record, file, rawref: path.relative(runDir, file).replaceAll(path.sep, '/') })
  }
  const finals = new Map()
  for (const [requestId, attempts] of parsed) {
    attempts.sort((a, b) => a.record.attempt - b.record.attempt)
    const attemptNumbers = attempts.map((a) => a.record.attempt)
    if (attemptNumbers.some((value, i) => value !== i + 1) || attemptNumbers.length > 3) { errors.push({ kind: 'attempt_sequence', request_id: requestId, attempts: attemptNumbers }); invalidRequests.add(requestId) }
    for (const item of attempts) if (item.record.transport_retries !== item.record.attempt - 1) { errors.push({ kind: 'retry_count_mismatch', request_id: requestId, attempt: item.record.attempt, rawref: item.rawref }); invalidRequests.add(requestId) }
    for (let i = 0; i < attempts.length - 1; i++) {
      const prior = attempts[i].record
      const retryable = prior.api_error && (['network_error', 'timeout', 'network', '5xx'].includes(prior.api_error.kind) || prior.http_status === 408 || prior.http_status === 429 || (prior.http_status >= 500 && prior.http_status <= 599))
      if (prior.final !== false || !retryable) { errors.push({ kind: 'invalid_retry_predecessor', request_id: requestId, attempt: prior.attempt, rawref: attempts[i].rawref }); invalidRequests.add(requestId) }
    }
    const marked = attempts.filter((a) => a.record.final === true)
    if (marked.length !== 1) { errors.push({ kind: 'final_attempt_count', request_id: requestId, count: marked.length }); invalidRequests.add(requestId); continue }
    const fin = marked[0]
    if (fin.record.attempt !== attempts.length) { errors.push({ kind: 'final_not_last_attempt', request_id: requestId, final_attempt: fin.record.attempt, attempts: attemptNumbers }); invalidRequests.add(requestId) }
    if (fin.record.response_body_file === null) {
      if (fin.record.api_error !== null) { finals.set(requestId, { record: fin.record, response: null, rawref: fin.rawref }); continue }
      errors.push({ kind: 'missing_response_body', request_id: requestId, rawref: fin.rawref }); invalidRequests.add(requestId); continue
    }
    if (fin.record.api_error !== null) { finals.set(requestId, { record: fin.record, response: null, rawref: fin.rawref }); continue }
    const bodyRel = fin.record.response_body_file
    if (typeof bodyRel !== 'string' || path.isAbsolute(bodyRel) || bodyRel.split(/[\\/]/).includes('..')) { errors.push({ kind: 'unsafe_response_path', request_id: requestId, rawref: fin.rawref }); invalidRequests.add(requestId); continue }
    const bodyFile = path.resolve(runDir, bodyRel)
    if (!within(fs.realpathSync(runDir), realExistingAncestor(bodyFile))) { errors.push({ kind: 'unsafe_response_path', request_id: requestId, rawref: fin.rawref }); invalidRequests.add(requestId); continue }
    let response
    try { response = JSON.parse(fs.readFileSync(bodyFile, 'utf8')) } catch (error) { errors.push({ kind: 'response_json', request_id: requestId, message: error.message, rawref: fin.rawref }); invalidRequests.add(requestId); continue }
    if (!response || typeof response !== 'object' || !response.answers || typeof response.answers !== 'object' || Array.isArray(response.answers)) { errors.push({ kind: 'response_shape', request_id: requestId, rawref: fin.rawref }); invalidRequests.add(requestId); continue }
    if (response.model !== REQUESTED_MODEL) { errors.push({ kind: 'response_model_mismatch', request_id: requestId, model: response.model ?? null, rawref: fin.rawref }); invalidRequests.add(requestId); continue }
    if (fin.record.model !== response.model) { errors.push({ kind: 'record_response_model_mismatch', request_id: requestId, record_model: fin.record.model, response_model: response.model, rawref: fin.rawref }); invalidRequests.add(requestId); continue }
    finals.set(requestId, { record: fin.record, response, rawref: fin.rawref })
  }
  for (const requestId of requestsById.keys()) {
    if (!parsed.has(requestId)) errors.push({ kind: 'missing_request_record', request_id: requestId })
    else if (!finals.has(requestId) && !errors.some((e) => e.request_id === requestId && ['final_attempt_count', 'missing_response_body', 'response_json', 'response_shape', 'response_model_mismatch'].includes(e.kind))) {
      errors.push({ kind: 'missing_final_response', request_id: requestId })
    }
  }
  for (const requestId of invalidRequests) finals.delete(requestId)
  return { run, finals, errors, attempts: [...parsed.values()], attemptStats }
}

function loadGroundTruth() {
  const dir = path.resolve(BASE, '..', 'v2.1')
  const files = ['audio.cases.json', 'av-and-controls.cases.json', 'audio.additions.json', 'av.additions.json']
  const cases = files.flatMap((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))).sort((a, b) => a.id.localeCompare(b.id))
  const hash = sha256(Buffer.from(`${JSON.stringify(canonical(cases))}\n`, 'utf8'))
  if (hash !== DATASET_SHA256) throw new Error(`Ground-truth dataset integrity failure: ${hash}`)
  return cases
}

function evaluateRun(runDir, options = {}) {
  const runPath = path.resolve(runDir)
  if (!fs.statSync(runPath).isDirectory()) throw new Error('--run must point to a directory')
  const outputFile = options.output ? path.resolve(options.output) : null
  if (outputFile) validateOutputLocation(runPath, outputFile)
  const rawBefore = treeHashes(runPath)
  const frozen = options.verifyFrozen ? options.verifyFrozen() : verifyFrozen()
  const protocolHash = frozen.protocolHash
  if (typeof protocolHash !== 'string' || !/^[a-f0-9]{64}$/.test(protocolHash)) throw new Error('Frozen protocol verification did not return a SHA-256 digest')
  const assets = loadAssets()
  const groundTruthCases = loadGroundTruth()
  const requests = buildRequests(assets)
  const requestsById = new Map(requests.map((r) => [r.request_id, r]))
  if (groundTruthCases.length !== 144 || requests.length !== 1286 || requests.reduce((n, r) => n + r.judgments.length, 0) !== 3858) throw new Error('Frozen benchmark shape differs from expected V2.1 plan')
  const casesById = new Map(groundTruthCases.map((c) => [c.id, c]))
  const { run, finals, errors, attemptStats } = loadRun(runPath, protocolHash, requestsById)
  if (run.planned_cases !== groundTruthCases.length || run.planned_requests !== requests.length || run.planned_judgments !== 3858) throw new Error('Run planned counts differ from frozen benchmark plan')
  const rows = []
  const errorList = [...errors]
  const retryMaxByRequest = new Map()
  for (const record of attemptStats) if (Number.isInteger(record.transport_retries) && record.transport_retries >= 0) retryMaxByRequest.set(record.request_id, Math.max(retryMaxByRequest.get(record.request_id) || 0, record.transport_retries))
  const apiTransportRetries = [...retryMaxByRequest.values()].reduce((sum, retries) => sum + retries, 0)
  const validLatencies = attemptStats.map((r) => r.latency_ms).filter((value) => Number.isFinite(value) && value >= 0)
  const latencyTotalMs = validLatencies.reduce((sum, value) => sum + value, 0)
  const latencyCount = validLatencies.length
  for (const [requestId, req] of requestsById) {
    const final = finals.get(requestId)
    if (!final) continue
    const record = final.record
    if (record.api_error !== null) {
      errorList.push({ kind: 'api_error', request_id: requestId, detail: record.api_error, rawref: final.rawref })
      continue
    }
    const caseAsset = casesById.get(req.case_id)
    const answerKeys = req.judgments.map(answerKey).sort()
    const responseKeys = Object.keys(final.response.answers).sort()
    if (JSON.stringify(answerKeys) !== JSON.stringify(responseKeys)) {
      errorList.push({ kind: 'answer_keys', request_id: requestId, expected: answerKeys, observed: responseKeys, rawref: final.rawref })
      continue
    }
    for (const judgment of req.judgments) {
      const answer = decodeAnswer(final.response.answers[answerKey(judgment)], judgment)
      if (answer.error) {
        errorList.push({ kind: 'invalid_answer', request_id: requestId, target: judgment.id, parameter: judgment.parameter, message: answer.error, rawref: final.rawref })
        continue
      }
      const expected = expectedFor(caseAsset, judgment)
      const predicted = judgment.id === 'validity' && answer.predicted === 'unknown' ? 'unknown' : answer.predicted
      rows.push({ case_id: caseAsset.id, utterance: caseAsset.user_utterance, target: judgment.id, parameter: judgment.parameter,
        expected, predicted, probabilities: answer.probabilities, confidence: answer.confidence, confidence_source: answer.confidenceSource,
        rawref: final.rawref, case_type: caseAsset.case_type, tags: caseAsset.tags || [], category: caseAsset.category })
    }
  }
  const disagreements = rows.filter((r) => r.expected !== r.predicted)
  const plannedForTarget = (target, caseIds = null) => requests.reduce((sum, request) => sum + (caseIds && !caseIds.has(request.case_id) ? 0 : request.judgments.filter((j) => j.id === target).length), 0)
  const addCoverage = (metric, target, caseIds = null) => {
    const planned = plannedForTarget(target, caseIds)
    return { ...metric, planned, end_to_end_accuracy: planned ? metric.correct / planned : null,
      coverage: planned ? metric.observed / planned : null }
  }
  const targetMetrics = Object.fromEntries(TARGETS.map((target) => [target, addCoverage(metricFor(rows.filter((r) => r.target === target), target), target)]))
  const correct = rows.filter((r) => r.expected === r.predicted).length
  const validFinalResponses = [...finals.values()].filter((item) => item.response !== null).length
  const plannedJudgments = Number.isInteger(run.planned_judgments) ? run.planned_judgments : requests.reduce((n, r) => n + r.judgments.length, 0)
  const sliceNames = Object.keys(SLICE_RULES)
  const slices = Object.fromEntries(sliceNames.map((name) => {
    const selected = new Set(groundTruthCases.filter((c) => hasSlice(c, name)).map((c) => c.id))
    const subset = rows.filter((r) => selected.has(r.case_id))
    return [name, { definition: SLICE_RULES[name], planned_cases: selected.size, observed_judgments: subset.length,
      targets: Object.fromEntries(TARGETS.map((target) => [target, addCoverage(metricFor(subset.filter((r) => r.target === target), target), target, selected)])) }]
  }))
  const perToolRecall = Object.fromEntries(ROUTING.filter((tool) => !['multiple', 'unclear'].includes(tool)).map((tool) => {
    const supportRows = rows.filter((r) => r.target === 'routing' && r.expected === tool)
    const support = groundTruthCases.filter((c) => c.expected.tool === tool).length
    const observedSupport = supportRows.length
    const correctTool = supportRows.filter((r) => r.predicted === tool).length
    return [tool, { support, observed_support: observedSupport, coverage: support ? observedSupport / support : null,
      recall: support >= 5 && observedSupport ? correctTool / observedSupport : null, below_minimum_support: support < 5 }]
  }))
  const highConfidenceWrong = disagreements.filter((r) => r.confidence >= 0.9)
  const lowConfidenceCorrect = rows.filter((r) => r.expected === r.predicted && r.confidence < 0.7)
  const confidenceSummary = {}
  for (const target of TARGETS) {
    const rs = rows.filter((r) => r.target === target)
    confidenceSummary[target] = {
      confidence_source: target === 'routing' || target === 'validity' ? 'API confidence' : 'derived decision certainty: max(p, 1-p)',
      bands: CONFIDENCE_BANDS.map((band) => {
        const inBand = rs.filter((r) => r.confidence >= band.min && (band.inclusiveMax ? r.confidence <= band.max : r.confidence < band.max))
        const correctInBand = inBand.filter((r) => r.expected === r.predicted).length
        return { ...band, count: inBand.length, correct: correctInBand, agreement_rate: inBand.length ? correctInBand / inBand.length : null }
      })
    }
  }
  const report = {
    report_version: '1.0.0', run_id: run.run_id, run_ref: path.relative(process.cwd(), runPath).replaceAll(path.sep, '/'),
    dataset_sha256: DATASET_SHA256, protocol_sha256: protocolHash, requested_model: REQUESTED_MODEL,
    started_at: run.started_at, evaluated_at: new Date().toISOString(), planned: { cases: run.planned_cases, requests: run.planned_requests, judgments: plannedJudgments },
    observed: { requests_with_final_response: validFinalResponses, judgments: rows.length, valid_judgments: rows.length, errors: errorList.length,
      end_to_end_accuracy: plannedJudgments ? correct / plannedJudgments : null, observed_accuracy: rows.length ? correct / rows.length : null,
      exact_correct: correct, disagreements: disagreements.length },
    coverage: { planned_judgments: plannedJudgments, observed_valid_judgments: rows.length, fraction: plannedJudgments ? rows.length / plannedJudgments : null,
      planned_requests: run.planned_requests, observed_final_responses: validFinalResponses, errors: errorList },
    metrics: targetMetrics,
    per_tool_recall: perToolRecall,
    slices: { definitions: SLICE_RULES, metrics: slices },
    confidence: { bands_are_descriptive: true, bands: CONFIDENCE_BANDS, by_target: confidenceSummary,
      high_confidence_wrong: highConfidenceWrong, low_confidence_correct: lowConfidenceCorrect },
    disagreements,
    transport: { retry_count: apiTransportRetries, attempts_with_latency: latencyCount, total_attempt_latency_ms: latencyTotalMs,
      mean_attempt_latency_ms: latencyCount ? latencyTotalMs / latencyCount : null,
      note: 'Latency is recorded per API request, not per individual judgment.' }
  }
  const rawAfter = treeHashes(runPath)
  if (!sameMap(rawBefore, rawAfter)) throw new Error('Raw run files changed during evaluation')
  if (outputFile) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true })
    const fd = fs.openSync(outputFile, 'wx')
    try { fs.writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`, 'utf8') } finally { fs.closeSync(fd) }
  }
  return report
}

function cli(argv) {
  let runDir = null, output = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run' && argv[i + 1]) runDir = argv[++i]
    else if (argv[i] === '--output' && argv[i + 1]) output = argv[++i]
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`)
  }
  if (!runDir || !output) throw new Error('Usage: node evaluate.cjs --run <path> --output <path>')
  const report = evaluateRun(runDir, { output })
  process.stdout.write(JSON.stringify({ output: path.resolve(output), observed: report.observed, coverage: { ...report.coverage, errors: report.coverage.errors.length } }, null, 2) + '\n')
}

if (require.main === module) {
  try { cli(process.argv.slice(2)) } catch (error) { process.stderr.write(`Evaluator error: ${error.message}\n`); process.exitCode = 1 }
}

module.exports = { evaluateRun, decodeAnswer, binaryCounts, choiceMetrics, hasSlice, SLICE_RULES, CONFIDENCE_BANDS }

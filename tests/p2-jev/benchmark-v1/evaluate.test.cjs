'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { evaluateRun, decodeAnswer, binaryCounts } = require('./evaluate.cjs')
const common = require('./common.cjs')
const TEST_PROTOCOL_HASH = 'a'.repeat(64)
const TEST_OPTIONS = { verifyFrozen: () => ({ protocolHash: TEST_PROTOCOL_HASH }) }

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jev-eval-')) }
function put(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
function runFixture(root, overrides = {}) {
  const runDir = path.join(root, 'run-1')
  fs.mkdirSync(path.join(runDir, 'records'), { recursive: true })
  fs.mkdirSync(path.join(runDir, 'bodies'), { recursive: true })
  const protocolHash = TEST_PROTOCOL_HASH
  put(path.join(runDir, 'run.json'), JSON.stringify({
    run_id: 'run-1', dataset_sha256: common.DATASET_SHA256, protocol_sha256: protocolHash,
    protocol_version: '1.0.0', requested_model: 'jev-1.13.0', started_at: '2026-09-21T00:00:00.000Z',
    planned_cases: 144, planned_requests: 1286, planned_judgments: 3858, ...overrides
  }))
  return runDir
}
function syntheticExpectedCases() {
  const dir = path.resolve(__dirname, '..', 'v2.1')
  return new Map(['audio.cases.json', 'av-and-controls.cases.json', 'audio.additions.json', 'av.additions.json']
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))).map((c) => [c.id, c]))
}
function syntheticPrediction(request, judgment, truth, flip = false) {
  let expected
  if (judgment.id === 'routing') expected = truth.expected.tool
  else if (judgment.id === 'intent_ambiguous') expected = truth.expected.intent_ambiguous
  else if (judgment.id === 'clarification_required') expected = truth.expected.clarification.required
  else {
    const state = truth.expected.parameters[judgment.parameter]
    expected = judgment.id === 'validity' ? state.valid === true ? 'valid' : state.valid === false ? 'invalid' : 'unknown' : state[judgment.id]
  }
  if (judgment.id === 'routing' || judgment.id === 'validity') {
    const choices = judgment.id === 'routing' ? common.ROUTES : ['valid', 'invalid', 'unknown']
    const predicted = flip ? choices.find((choice) => choice !== expected) : expected
    return { type: 'choice', choice: predicted, probabilities: Object.fromEntries(choices.map((choice) => [choice, choice === predicted ? 1 : 0])), confidence: 1 }
  }
  const predicted = flip ? !expected : expected
  return { type: 'noul', noul: predicted ? 0.99 : 0.01 }
}
function createSyntheticRun(root) {
  const runDir = runFixture(root)
  const assets = common.loadAssets()
  const requests = common.buildRequests(assets)
  const cases = syntheticExpectedCases()
  const frozen = { protocolHash: TEST_PROTOCOL_HASH }
  for (const request of requests) {
    const answers = Object.fromEntries(request.judgments.map((judgment) => [judgment.id, syntheticPrediction(request, judgment, cases.get(request.case_id))]))
    const bodyRel = `bodies/${request.request_id}.attempt-1.body`
    put(path.join(runDir, bodyRel), JSON.stringify({ model: 'jev-1.13.0', answers, usage: { total_tokens: 0 } }))
    put(path.join(runDir, 'records', `${request.request_id}.attempt-1.json`), JSON.stringify({
      case_id: request.case_id, request_id: request.request_id, dataset_sha256: common.DATASET_SHA256,
      protocol_sha256: frozen.protocolHash, protocol_version: '1.0.0', requested_model: 'jev-1.13.0', model: 'jev-1.13.0',
      timestamp: '2026-09-21T00:00:00.000Z', latency_ms: 3, attempt: 1, transport_retries: 0, http_status: 200,
      api_error: null, judgments: request.judgments, request_body: request.body, response_body_file: bodyRel, final: true
    }))
  }
  return { runDir, requests, cases }
}
function hashTree(root) {
  const values = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else values.push([path.relative(root, file).replaceAll(path.sep, '/'), common.sha256(fs.readFileSync(file))])
    }
  }
  visit(root)
  return JSON.stringify(values.sort(([a], [b]) => a.localeCompare(b)))
}

test('binary metrics report counts and null for zero denominators', () => {
  const rows = [
    { expected: true, predicted: true },
    { expected: false, predicted: false },
    { expected: false, predicted: true },
    { expected: true, predicted: false }
  ]
  assert.deepEqual(binaryCounts(rows), { support: 2, observed: 4, correct: 2, tp: 1, tn: 1, fp: 1, fn: 1, accuracy: 0.5, precision: 0.5, recall: 0.5, f1: 0.5 })
  const empty = binaryCounts([])
  assert.equal(empty.accuracy, null)
  assert.equal(empty.precision, null)
  assert.equal(empty.recall, null)
  assert.equal(empty.f1, null)
  assert.equal(binaryCounts([{ expected: true, predicted: false }]).f1, 0)
})

test('noul threshold includes the 0.5 boundary and reports derived certainty', () => {
  const judgment = { id: 'user_present', parameter: 'camera_fov.hfov_deg' }
  assert.deepEqual(decodeAnswer({ type: 'noul', noul: 0.5 }, judgment), {
    predicted: true, probabilities: { false: 0.5, true: 0.5 }, confidence: 0.5,
    confidenceSource: 'derived decision certainty: max(p, 1-p)'
  })
  assert.equal(decodeAnswer({ type: 'noul', noul: 0.499999 }, judgment).predicted, false)
})

test('choice decoding rejects invalid probabilities, unknown choices and missing answers', () => {
  const judgment = { id: 'routing', parameter: null }
  const probs = Object.fromEntries(common.ROUTES.map((route) => [route, route === 'camera_fov' ? 1 : 0]))
  assert.equal(decodeAnswer({ type: 'choice', choice: 'camera_fov', probabilities: probs, confidence: 0.9 }, judgment).predicted, 'camera_fov')
  assert.match(decodeAnswer({ type: 'choice', choice: 'camera_fov', probabilities: { ...probs, venue: 0.2 }, confidence: 0.9 }, judgment).error, /sum/)
  assert.match(decodeAnswer({ type: 'choice', choice: 'made_up', probabilities: probs, confidence: 0.9 }, judgment).error, /unknown choice/)
  assert.match(decodeAnswer(undefined, judgment).error, /Missing/)
  assert.match(decodeAnswer({ type: 'choice', choice: 'camera_fov', probabilities: { ...probs, venue: 2 }, confidence: 0.9 }, judgment).error, /invalid probability/)
})

test('run rejects a dataset hash mismatch before producing analysis', (t) => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runDir = runFixture(root, { dataset_sha256: '0'.repeat(64) })
  assert.throws(() => evaluateRun(runDir, TEST_OPTIONS), /dataset hash/)
})

test('run rejects a protocol hash mismatch before scoring records', (t) => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runDir = runFixture(root, { protocol_sha256: 'b'.repeat(64) })
  assert.throws(() => evaluateRun(runDir, TEST_OPTIONS), /protocol hash/)
})

test('path traversal in a response reference is reported and raw files remain byte-identical', (t) => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runDir = runFixture(root)
  const request = common.buildRequests()[0]
  const protocolHash = TEST_PROTOCOL_HASH
  put(path.join(runDir, 'records', `${request.request_id}.attempt-1.json`), JSON.stringify({
    case_id: request.case_id, request_id: request.request_id, dataset_sha256: common.DATASET_SHA256,
    protocol_sha256: protocolHash, protocol_version: '1.0.0', requested_model: 'jev-1.13.0', model: 'jev-1.13.0',
    timestamp: '2026-09-21T00:00:00.000Z', latency_ms: 4, attempt: 1, transport_retries: 0, http_status: 200,
    api_error: null, judgments: request.judgments, request_body: request.body,
    response_body_file: '../outside.body', final: true
  }))
  const before = hashTree(runDir)
  const report = evaluateRun(runDir, TEST_OPTIONS)
  assert.ok(report.coverage.errors.some((error) => error.kind === 'unsafe_response_path'))
  assert.equal(hashTree(runDir), before)
})

test('duplicate final attempts and invalid retry chains do not contribute scored answers', (t) => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runDir = runFixture(root)
  const request = common.buildRequests()[0]
  for (const attempt of [1, 2]) {
    put(path.join(runDir, 'records', `${request.request_id}.attempt-${attempt}.json`), JSON.stringify({
      case_id: request.case_id, request_id: request.request_id, dataset_sha256: common.DATASET_SHA256,
      protocol_sha256: TEST_PROTOCOL_HASH, protocol_version: '1.0.0', requested_model: 'jev-1.13.0', model: null,
      timestamp: '2026-09-21T00:00:00.000Z', latency_ms: 2, attempt, transport_retries: attempt - 1, http_status: 200,
      api_error: null, judgments: request.judgments, request_body: request.body, response_body_file: null, final: true
    }))
  }
  const report = evaluateRun(runDir, TEST_OPTIONS)
  assert.ok(report.coverage.errors.some((error) => error.kind === 'final_attempt_count'))
  assert.equal(report.observed.judgments, 0)
  assert.equal(report.observed.requests_with_final_response, 0)
  assert.equal(report.transport.attempts_with_latency, 2)
})

test('analysis output cannot alias the raw run and is created exclusively outside it', (t) => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runDir = runFixture(root)
  assert.throws(() => evaluateRun(runDir, { output: path.join(runDir, 'analysis.json') }), /outside the raw run/)
  assert.throws(() => evaluateRun(runDir, { ...TEST_OPTIONS, output: runDir }), /outside the raw run/)
  const output = path.join(root, 'analysis', 'run-1', 'report.json')
  const report = evaluateRun(runDir, { ...TEST_OPTIONS, output })
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).run_id, report.run_id)
  assert.throws(() => evaluateRun(runDir, { ...TEST_OPTIONS, output }), /already exists/)
})

test('run plan counts are checked against the frozen benchmark', (t) => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const runDir = runFixture(root, { planned_requests: 1285 })
  assert.throws(() => evaluateRun(runDir, TEST_OPTIONS), /planned counts/)
})

test('synthetic offline benchmark fixture scores all 3858 labels and preserves all six target disagreements', (t) => {
  const root = tempRoot(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { runDir, requests, cases } = createSyntheticRun(root)
  const rawBefore = hashTree(runDir)
  const perfect = evaluateRun(runDir, TEST_OPTIONS)
  assert.equal(perfect.observed.observed_accuracy, 1)
  assert.equal(perfect.observed.end_to_end_accuracy, 1)
  assert.equal(perfect.observed.disagreements, 0)
  assert.equal(perfect.observed.judgments, 3858)
  assert.equal(perfect.coverage.errors.length, 0)
  for (const metric of Object.values(perfect.metrics)) {
    assert.equal(metric.coverage, 1)
    assert.equal(metric.end_to_end_accuracy, 1)
  }
  assert.equal(JSON.stringify(perfect.metrics).includes('null'), false)
  assert.equal(hashTree(runDir), rawBefore)

  const flipped = new Set()
  for (const target of ['routing', 'intent_ambiguous', 'clarification_required', 'user_present', 'validity', 'sufficient']) {
    const request = requests.find((candidate) => candidate.judgments.some((judgment) => judgment.id === target))
    assert.ok(request, `fixture includes ${target}`)
    const judgment = request.judgments.find((item) => item.id === target)
    const recordFile = path.join(runDir, 'records', `${request.request_id}.attempt-1.json`)
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
    const bodyFile = path.join(runDir, record.response_body_file)
    const response = JSON.parse(fs.readFileSync(bodyFile, 'utf8'))
    const truth = cases.get(request.case_id)
    response.answers[judgment.id] = syntheticPrediction(request, judgment, truth, true)
    put(bodyFile, JSON.stringify(response))
    flipped.add(target)
  }
  assert.equal(flipped.size, 6)
  const beforeScoringFlippedFixture = hashTree(runDir)
  const scored = evaluateRun(runDir, TEST_OPTIONS)
  assert.equal(scored.observed.disagreements, 6)
  assert.equal(new Set(scored.disagreements.map((row) => row.target)).size, 6)
  assert.equal(hashTree(runDir), beforeScoringFlippedFixture)
})

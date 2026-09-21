'use strict'

const assert = require('node:assert/strict')
const { loadAssets, buildRequests, ROUTES } = require('./common.cjs')

const assets = loadAssets()
const requests = buildRequests(assets)
const requestWith = (id) => requests.find((request) => request.request_id === id)
const forbiddenAnnotationKey = (value) => {
  if (Array.isArray(value)) return value.some(forbiddenAnnotationKey)
  if (value && typeof value === 'object') return Object.entries(value).some(([key, child]) => ['case_id', 'case_type', 'tags', 'expected', 'rationale', 'review', 'gold'].includes(key) || forbiddenAnnotationKey(child))
  return false
}

assert.equal(assets.stimuli.length, 144)
assert.equal(assets.scope.reduce((sum, item) => sum + item.parameters.length, 0), 1142)
assert.equal(requests.length, 1286)
assert.deepEqual(assets.protocol.routing_choices, ROUTES)
assert.equal(Object.keys(assets.context.parameters).length, 125)

for (const stimulus of assets.stimuli) assert.deepEqual(Object.keys(stimulus).sort(), ['id', 'user_utterance'])
for (const scope of assets.scope) {
  assert.deepEqual(Object.keys(scope).sort(), ['case_id', 'parameters'])
  assert.deepEqual(scope.parameters, [...scope.parameters].sort())
}

const allowedBody = ['model', 'questions', 'state']
for (const request of requests) {
  assert.deepEqual(Object.keys(request.body).sort(), allowedBody)
  assert.deepEqual(Object.keys(request.body.state).sort(), request.judgments.some((item) => item.parameter) ? ['context', 'parameter', 'utterance'] : ['context', 'utterance'])
  assert.deepEqual(Object.keys(request.body.questions).sort(), request.judgments.map((item) => item.id).sort())
  assert.equal(request.body.model, 'jev-1.13.0')
  assert(!JSON.stringify(request.body).includes(request.case_id))
  assert.equal(forbiddenAnnotationKey(request.body), false)
  for (const question of Object.values(request.body.questions)) {
    assert(['choice', 'noul'].includes(question.type))
    assert(question.criteria && typeof question.criteria === 'object')
  }
}

assert.deepEqual(Object.keys(requestWith(`${assets.stimuli[0].id}--case`).body.questions.routing.criteria).sort(), [...ROUTES].sort())
assert.deepEqual(Object.keys(requests.find((request) => request.judgments.some((item) => item.id === 'validity')).body.questions.validity.criteria), ['valid', 'invalid', 'unknown'])
assert(requestWith('GAIN-001--case'))
assert(requestWith('GAIN-001--gain_structure.target_peak_dbfs'))

const routeRequests = requests.filter((request) => request.request_id.endsWith('--case'))
assert.equal(routeRequests.length, 144)
for (const request of routeRequests) {
  assert.deepEqual(Object.keys(request.body.questions.routing.criteria).sort(), [...ROUTES].sort())
  assert.deepEqual(request.body.questions.routing.criteria, routeRequests[0].body.questions.routing.criteria)
  assert.equal(request.body.questions.routing.instructions, routeRequests[0].body.questions.routing.instructions)
}
const scopeChanged = structuredClone(assets)
scopeChanged.scope.find((item) => item.case_id === routeRequests[0].case_id).parameters = []
assert.deepEqual(requestWith(`${routeRequests[0].case_id}--case`).body, buildRequests(scopeChanged).find((item) => item.request_id === `${routeRequests[0].case_id}--case`).body)

const equipment = require('../../../data/equipment.js')
const cameras = require('../../../data/cameras.js')
const lighting = require('../../../data/stage-lighting.js')
const productionCatalog = new Map([...equipment.amplifiers, ...equipment.speakers, ...cameras.cameras, ...Object.values(lighting).filter(Array.isArray).flat()].map((record) => [record.model, record]))
assert.equal(assets.context.catalog_facts.length, productionCatalog.size)
for (const fact of assets.context.catalog_facts) assert.deepEqual(fact.record, productionCatalog.get(fact.model))

const poisoned = structuredClone(assets)
poisoned.stimuli[0].expected = { tool: 'POISON_ROUTE', parameters: { 'poison.field': { value: 'POISON_VALUE' } } }
poisoned.scope[0].expected = { rationale: 'POISON_RATIONALE' }
assert.deepEqual(buildRequests(poisoned), requests)

const gainBody = requestWith('GAIN-001--gain_structure.target_peak_dbfs').body
assert.equal(gainBody.state.context.documented_defaults[0].value, '-6 dBFS')
const limiterBody = requestWith('LIM-004--limiter.amplifier_model').body
assert(!limiterBody.state.context.catalog_facts.some((item) => item.model === 'TC-2500'))
assert(limiterBody.state.context.catalog_facts.some((item) => item.model === 'TC-2500B'))
assert(requestWith('CROSS-003--case').body.state.context.catalog_facts.some((item) => item.model === 'TL-SL333'))

process.stdout.write('benchmark-v1 common contract tests passed\n')

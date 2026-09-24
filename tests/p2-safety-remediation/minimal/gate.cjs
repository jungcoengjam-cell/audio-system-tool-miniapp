'use strict'

const assert = require('assert')
const gate = require('../../../utils/operation-inputs')

const modal = { showModal(options) { modal.options = options } }
global.wx = modal

const contract = {
  id: 'minimal-test',
  kinds: ['report', 'discussion'],
  fields: { width: { unit: 'm', dataKey: 'width' }, mode: { unit: 'mode', dataKey: 'mode' } },
  requiredFields: { 'minimal-test': ['width'], report: ['width', 'mode'], discussion: ['width'] },
}
function page(data = { width: '99', mode: 'default', result: { stale: true } }) {
  return { data, setData(patch) { this.data = { ...this.data, ...patch } } }
}
const methods = gate.createOperationMethods(contract)
const attach = (value) => Object.assign(value, methods)

let p = attach(page())
let snap = p.beginStructuredOperation({ width: '4', mode: 'report' }, 'report')
assert.deepStrictEqual(snap.blockers, [])
assert.strictEqual(snap.ready, true)
assert.strictEqual(p.data.width, '99', 'begin ignores page defaults')
assert.strictEqual(p.data.result, null, 'begin clears stale result')
const prepared = gate.prepareOperation(p)
const result = { value: 'fresh' }
const effect = prepared.commit(result)
assert(effect)
assert.strictEqual(gate.isOperationResultCurrent(p, effect), true)
p.setOperationCandidate('width', '', 'm')
assert.strictEqual(p.getOperationSnapshot().ready, false, 'invalid edit removes prior confirmation')
assert.strictEqual(gate.isOperationResultCurrent(p, effect), false, 'candidate invalidates output')

p = attach(page({ width: '99', mode: '', result: { stale: true } }))
p.beginStructuredOperation({ width: '4' }, 'discussion')
p.confirmOperationField({ currentTarget: { dataset: { field: 'mode' } } })
assert.strictEqual(modal.options, undefined, 'missing UI candidate cannot be confirmed')
p.data.mode = 'report'
assert.strictEqual(p.confirmOperationField({ currentTarget: { dataset: { field: 'mode' } } }), true)
const oldModal = modal.options
p.beginStructuredOperation({ width: '4' }, 'discussion')
oldModal.success({ confirm: true })
assert.strictEqual(p.getOperationSnapshot().fields.find((field) => field.key === 'mode').confirmed, false, 'old modal is revoked')

p = attach(page())
p.beginStructuredOperation({ width: '4', mode: 'report' }, 'report')
const oldCommit = gate.prepareOperation(p).commit
p.beginStructuredOperation({ width: '5', mode: 'report' }, 'report')
assert.strictEqual(oldCommit({ answer: 'old' }), null, 'old structured closure is revoked')
gate.invalidateOperation(p, 'unload')
assert.strictEqual(gate.prepareOperation(p).blocked, true, 'closed page stays blocked')

p = attach(page())
p.beginStructuredOperation({ width: '4', mode: 'report' }, 'report')
const resultBeforeDispose = { value: 'owned before dispose' }
const disposalGuard = gate.prepareOperation(p).commit(resultBeforeDispose)
assert(disposalGuard)
assert.strictEqual(gate.disposeOperation(p), true, 'first terminal disposal should take effect')
assert.strictEqual(gate.disposeOperation(p), false, 'repeated terminal disposal should be idempotent')
gate.invalidateOperation(p, 'unsupported-input')
gate.invalidateOperation(p, 'candidate')
p.endStructuredOperation()
assert.strictEqual(p.beginStructuredOperation({ width: '9', mode: 'report' }, 'report').ready, false,
  'begin cannot recreate an operation after disposal')
assert.strictEqual(gate.prepareOperation(p).blocked, true, 'dispose cannot fall through to manual calculation')
assert.strictEqual(gate.prepareOperation(p).disposed, true, 'terminal state remains visible to execution guards')
assert.strictEqual(gate.captureOperationResult(p, resultBeforeDispose), null, 'disposed page cannot capture a result')
assert.strictEqual(gate.isOperationResultCurrent(p, disposalGuard), false, 'dispose revokes already captured result guards')
assert.strictEqual(p.getOperationSnapshot()?.ready, false, 'lazy snapshot lookup cannot recreate readiness')

p = attach(page())
const manualResult = { manual: 1 }
const manualGuard = gate.captureOperationResult(p, manualResult)
assert.strictEqual(gate.isOperationResultCurrent(p, manualGuard), true)
p.beginStructuredOperation({ width: '1' }, 'discussion')
assert.strictEqual(gate.isOperationResultCurrent(p, manualGuard), false, 'manual callback is revoked by new operation')

p = attach(page())
const manualPrepared = gate.prepareOperation(p)
p.beginStructuredOperation({ width: '1' }, 'discussion')
assert.strictEqual(manualPrepared.commit({ manual: 2 }), null, 'manual prepare closure is revoked by new operation')

p = attach(page())
assert.strictEqual(p.beginStructuredOperation({ width: '', mode: 'report' }, 'report').ready, false)
assert.strictEqual(p.beginStructuredOperation({ width: NaN, mode: 'report' }, 'report').ready, false)
assert.strictEqual(p.beginStructuredOperation({ width: '1', source: 'user' }, 'report').error, 'invalid structured operation')
assert.strictEqual(p.beginStructuredOperation({ width: { value: '1' } }, 'report').error, 'operation inputs must be flat values')
assert.strictEqual(p.beginStructuredOperation({ width: '1', mode: 'report' }, 'report').fields[0].value, '1')
const frozen = p.getOperationSnapshot()
assert.throws(() => { frozen.fields[0].value = 'forged' }, TypeError)
assert.strictEqual(p.getOperationSnapshot().fields[0].value, '1')

console.log('minimal gate test passed')

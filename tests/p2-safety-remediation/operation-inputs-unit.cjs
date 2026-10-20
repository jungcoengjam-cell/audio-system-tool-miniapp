'use strict'
const assert = require('assert')
const gate = require('../../utils/operation-inputs')
global.wx = { showModal(options) { this.modal = options } }
const contract = {
  id: 'unit-test', kinds: ['a', 'b'], fields: {
    width: { label: 'Width', unit: 'm', dataKey: 'width', validate: (v) => Number.isFinite(Number(v)) && String(v).trim() !== '', write: (s, v) => { s.width = String(v) }, read: (_p, s) => s.width },
    mode: { label: 'Mode', unit: 'mode', dataKey: 'mode', validate: (v) => ['a', 'b'].includes(v) },
  },
  requiredFields(kind) { return kind === 'a' ? ['width'] : ['width', 'mode'] },
  dependencies: { mode: ['width'] },
}
function page(data = { width: '2', mode: 'a', result: { value: 2 } }) {
  return { data, setData(patch) { this.data = { ...this.data, ...patch } } }
}
function confirm(page, field) {
  const snapshot = page.getOperationSnapshot()
  assert.strictEqual(page.confirmOperationValue(field, snapshot.fields.find((f) => f.key === field).value, snapshot.fields.find((f) => f.key === field).unit, snapshot), false, 'direct call cannot authorize')
  assert.strictEqual(page.confirmOperationField({ currentTarget: { dataset: { field } } }), true)
  wx.modal.success({ confirm: true })
}
const mix = gate.createOperationMethods(contract)
let p = Object.assign(page(), mix)
let snap = p.beginStructuredOperation({ width: 2 }, 'a')
assert.strictEqual(p.data.width, '2')
assert.strictEqual(snap.fields.find((field) => field.key === 'width').value, '2', 'round-trip normalized candidate')
assert.strictEqual(p.getOperationSnapshot().ready, false)
assert.strictEqual(gate.captureOperationResult(p, null), null, 'blocked capture fails closed')
confirm(p, 'width')
assert.strictEqual(p.getOperationSnapshot().ready, true, 'same displayed value confirmation is accepted')
let prepared = gate.prepareOperation(p, p.data)
assert.strictEqual(prepared.blocked, false)
const acceptedResult = { value: 2 }
assert.strictEqual(gate.acceptOperationResult(p, prepared.ticket, acceptedResult), true)
const ticket = gate.captureOperationResult(p, acceptedResult)
assert.strictEqual(gate.isOperationResultCurrent(p, ticket), true)
p.data.width = '3'
assert.strictEqual(gate.isOperationResultCurrent(p, ticket), false, 'synchronous edit invalidates before debounce')
assert.strictEqual(gate.isOperationResultCurrent(p, {}), false, 'forged ticket rejected')

p = Object.assign(page(), mix)
p.beginStructuredOperation({ width: '2' }, 'a')
const before = p.getOperationSnapshot()
p.confirmOperationField({ currentTarget: { dataset: { field: 'width' } } })
p.beginStructuredOperation({ width: '2' }, 'a')
wx.modal.success({ confirm: true })
assert.strictEqual(p.getOperationSnapshot().ready, false, 'stale modal cannot confirm newer same-value operation')
assert(Object.isFrozen(before) && Object.isFrozen(before.fields[0]))
assert.strictEqual(before.fields[0].confirmed, false)

p = Object.assign(page(), mix)
p.beginStructuredOperation({ width: '2' }, 'a')
confirm(p, 'width')
p.data.width = ''
assert.strictEqual(gate.prepareOperation(p, p.data).blocked, true, 'blank is not numeric zero')
assert.strictEqual(gate.captureOperationResult(p, null), null)

p = Object.assign(page(), mix)
const a = gate.captureOperationResult(p, { manual: 1 })
const b = gate.captureOperationResult(p, { manual: 2 })
assert.strictEqual(a, b)
assert.strictEqual(gate.isOperationResultCurrent(p, a), true, 'manual captures are read-only')
p.beginStructuredOperation({ width: '2' }, 'a')
assert.strictEqual(gate.isOperationResultCurrent(p, a), false, 'structured begin revokes manual effects')

p = Object.assign(page(), mix)
p.beginStructuredOperation({ width: '2' }, 'a')
gate.invalidateOperation(p, 'unload')
assert.strictEqual(gate.captureOperationResult(p, {}), null)
assert.strictEqual(gate.prepareOperation(p, p.data).blocked, true, 'unload cannot return to manual mode')

p = Object.assign(page(), mix)
p.beginStructuredOperation({ width: '2' }, 'a')
p.confirmOperationField({ currentTarget: { dataset: { field: 'width' } } })
wx.modal.success({ confirm: true })
assert.strictEqual(p.getOperationSnapshot().ready, true)
p.setOperationCandidate('width', '2', 'cm')
assert.strictEqual(p.getOperationSnapshot().ready, false, 'wrong units invalidate confirmation')

p = Object.assign(page(), mix)
const supplied = { width: 2 }
p.beginStructuredOperation(supplied, 'a')
supplied.width = 99
assert.strictEqual(p.getOperationSnapshot().fields.find((field) => field.key === 'width').value, '2', 'caller mutation cannot change captured candidate')
const snapCopy = p.getOperationSnapshot()
assert.throws(() => { snapCopy.fields[0].value = 'forged' }, TypeError)
assert.strictEqual(p.getOperationSnapshot().fields.find((field) => field.key === 'width').value, '2')

p = Object.assign(page(), mix)
p.beginStructuredOperation({ width: 2 }, 'a')
p.confirmOperationField({ currentTarget: { dataset: { field: 'width' } } })
p.data.width = '4'
wx.modal.success({ confirm: true })
assert.strictEqual(p.getOperationSnapshot().ready, false, 'modal cannot confirm after live value changes')

p = Object.assign(page(), mix)
p.beginStructuredOperation({ width: 2 }, 'a')
assert.strictEqual(p.getOperationSnapshot().ready, false)
p.beginStructuredOperation({ width: 2 }, 'not-an-operation-kind')
assert.strictEqual(p.getOperationSnapshot().status, 'invalid', 'unknown kind establishes blocked structured state')
assert.strictEqual(gate.prepareOperation(p, p.data).blocked, true)
assert.strictEqual(gate.captureOperationResult(p, {}), null)

const invalidContract = { ...contract, id: 'bad-required', requiredFields: () => ['not-a-field'] }
const invalidPage = Object.assign(page(), gate.createOperationMethods(invalidContract))
invalidPage.beginStructuredOperation({ width: 2 })
assert.strictEqual(gate.prepareOperation(invalidPage, invalidPage.data).blocked, true, 'unknown contract requirements fail closed')

console.log('p2 safety operation-inputs focused tests passed')






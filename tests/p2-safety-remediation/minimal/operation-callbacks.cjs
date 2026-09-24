'use strict'

const assert = require('node:assert/strict')
const gate = require('../../../utils/operation-inputs')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')

function makePage() {
  return {
    data: { result: { stale: true }, operationActive: false },
    setData(patch) { this.data = { ...this.data, ...patch } },
  }
}

function attach(page) {
  const methods = gate.createOperationMethods({
    id: 'venue-report',
    fields: { lengthText: { unit: 'm' }, mode: { unit: 'mode' }, product: { unit: 'key' } },
    requiredFields: { 'venue-report': ['lengthText', 'mode', 'product'] },
  })
  return Object.assign(page, methods)
}

function run() {
  const env = createDelayedEnvironment()
  const page = attach(makePage())

  const first = page.beginStructuredOperation({ lengthText: '12', mode: 'report', product: 'venue'})
  assert(first.ready)
  const prepared = gate.prepareOperation(page)
  const result = { answer: 'first' }
  const guard = prepared.commit(result)
  assert(gate.isOperationResultCurrent(page, guard))

  // A changed value clears the result and makes a previously captured guard
  // stale before any report/cache/effect callback can commit.
  page.setOperationCandidate('lengthText', '13', 'm')
  assert(!page.data.result)
  assert(!gate.isOperationResultCurrent(page, guard))

  for (const [field, value, unit] of [['mode', 'discussion', 'mode'], ['product', 'other-product', 'key']]) {
    page.beginStructuredOperation({ lengthText: '12', mode: 'report', product: 'venue' })
    const operation = gate.prepareOperation(page)
    const operationResult = { field, value }
    const operationGuard = operation.commit(operationResult)
    assert(gate.isOperationResultCurrent(page, operationGuard))
    page.setOperationCandidate(field, value, unit)
    assert(!gate.isOperationResultCurrent(page, operationGuard), `${field} change kept a stale result guard`)
    assert(!page.data.result, `${field} change kept a stale result`)
  }

  // A delayed confirmation from an older operation cannot confirm the new one.
  page.beginStructuredOperation({ lengthText: '14', mode: 'report', product: 'venue'})
  page.confirmOperationField({ currentTarget: { dataset: { field: 'lengthText' } } })
  assert.strictEqual(env.pending.modals.length, 1)
  const staleModal = env.pending.modals[0]
  page.beginStructuredOperation({ mode: 'report', product: 'venue'})
  staleModal.success({ confirm: true })
  assert.strictEqual(page.getOperationSnapshot().fields.find((field) => field.key === 'lengthText').confirmed, false,
    'stale callback confirmed a field in a newer operation')
  assert.strictEqual(page.getOperationSnapshot().revision, 1)

  // Manual callback captured before a structured operation starts is also
  // rejected.  This closes the bypass where a late manual calculation could
  // repopulate a result after a structured boundary began.
  page.endStructuredOperation()
  const manual = gate.prepareOperation(page)
  const manualResult = { answer: 'manual' }
  const manualGuard = manual.commit(manualResult)
  assert(gate.isOperationResultCurrent(page, manualGuard))
  page.beginStructuredOperation({ lengthText: '16', mode: 'report', product: 'venue'})
  assert(!gate.isOperationResultCurrent(page, manualGuard))
  assert(!gate.captureOperationResult(page, manualResult))

  // Closing the page rejects a held callback even if it has the right result
  // object from the current operation.
  const active = gate.prepareOperation(page)
  page.endStructuredOperation()
  assert(active.blocked || !gate.isOperationResultCurrent(page, active.guard))
  return { staleConfirmRejected: true, valueInvalidation: true, manualCallbackRejected: true, closeRejected: true }
}

module.exports = { run }

if (require.main === module) console.log(JSON.stringify(run(), null, 2))

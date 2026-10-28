'use strict'

const assert = require('assert')
const measure = require('../pages/common/result-card-placeholder')

const queries = []
global.wx = {
  createSelectorQuery() {
    const query = {
      in(page) { query.page = page; return query },
      select(selector) { query.selector = selector; return query },
      boundingClientRect(callback) { query.callback = callback; return query },
      exec() { queries.push(query) },
    }
    return query
  },
}

function makePage() {
  return {
    _pageVisible: true,
    data: { result: {}, resultAreaStyle: '', canUseResultActions: true },
    updates: 0,
    setData(patch) { this.updates += 1; Object.assign(this.data, patch) },
  }
}

function queryFor(page) {
  measure(page)
  const query = queries[queries.length - 1]
  assert.strictEqual(query.page, page)
  assert.strictEqual(query.selector, '.result-card')
  return query
}

const page = makePage()
const initial = queryFor(page)
initial.callback({ height: 320.2 })
assert.strictEqual(page.data.resultAreaStyle, 'min-height:321px;')
assert.strictEqual(page.updates, 1)

queryFor(page).callback({ height: 320.8 })
assert.strictEqual(page.updates, 1, 'same rounded height must not call setData again')

const old = queryFor(page)
const latest = queryFor(page)
old.callback({ height: 600 })
assert.strictEqual(page.data.resultAreaStyle, 'min-height:321px;')
latest.callback({ height: 340 })
assert.strictEqual(page.data.resultAreaStyle, 'min-height:340px;')

for (const invalidate of [
  (p) => { p.data.inputPending = true },
  (p) => { p.data.isCalculationPending = true },
  (p) => { p.data.result = {} },
  (p) => { p._pageVisible = false },
  (p) => { p._isUnloaded = true },
  (p) => { p._ledUnloaded = true },
  (p) => { p.data.canUseResultActions = false },
  (p) => { p.data.result = null; p.data.resultAreaStyle = '' },
]) {
  const candidate = makePage()
  const stale = queryFor(candidate)
  invalidate(candidate)
  stale.callback({ height: 500 })
  assert.strictEqual(candidate.updates, 0, 'stale measurement must not update placeholder')
}

for (const height of [null, 0, -1, NaN, Infinity]) {
  const candidate = makePage()
  queryFor(candidate).callback(height === null ? null : { height })
  assert.strictEqual(candidate.updates, 0, 'invalid height must be ignored')
}

const unsupported = makePage()
const originalWx = global.wx
delete global.wx
assert.doesNotThrow(() => measure(unsupported))
global.wx = {}
assert.doesNotThrow(() => measure(unsupported))
global.wx = { createSelectorQuery() { throw new Error('query unavailable') } }
assert.doesNotThrow(() => measure(unsupported))
global.wx = originalWx

console.log('input layout stability helper checks passed')

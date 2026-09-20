'use strict'

const assert = require('node:assert/strict')
const classifications = new Set(['implementation bug', 'engineering-rule ambiguity', 'test problem'])

function createHarness() {
  const results = []
  const tests = []

  function close(actual, expected, tolerance = 1e-9, message) {
    assert.strictEqual(typeof actual, 'number', message || 'actual must be numeric')
    assert.strictEqual(typeof expected, 'number', message || 'expected must be numeric')
    assert(Number.isFinite(actual) && Number.isFinite(expected), message || `non-finite comparison: ${actual} vs ${expected}`)
    assert(typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 0, 'tolerance must be finite and non-negative')
    assert(Math.abs(actual - expected) <= tolerance, message || `${actual} is not within ${tolerance} of ${expected}`)
  }

  function finiteTree(value, path = 'value', seen = new Set()) {
    if (typeof value === 'number') assert(Number.isFinite(value), `${path} is not finite: ${String(value)}`)
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    for (const key of Object.keys(value)) finiteTree(value[key], `${path}.${key}`, seen)
  }

  function test(name, fn, metadata = {}) {
    assert.strictEqual(typeof name, 'string')
    assert(name.length > 0, 'test name must not be empty')
    assert(!tests.some((item) => item.name === name), `duplicate test name: ${name}`)
    assert.strictEqual(typeof fn, 'function', `test ${name} requires a function`)
    assert(metadata && typeof metadata === 'object' && !Array.isArray(metadata), `test ${name} metadata must be an object`)
    assert(classifications.has(metadata.classification), `test ${name} has invalid classification`)
    assert.strictEqual(typeof metadata.basis, 'string', `test ${name} requires a basis`)
    tests.push({ name, fn, metadata })
  }

  async function run() {
    for (const item of tests) {
      try {
        await item.fn()
        results.push({ name: item.name, passed: true, metadata: item.metadata })
      } catch (error) {
        results.push({ name: item.name, passed: false, metadata: item.metadata, error })
      }
    }
    return results
  }

  return { test, assert, close, finiteTree, run, results }
}

module.exports = { createHarness }

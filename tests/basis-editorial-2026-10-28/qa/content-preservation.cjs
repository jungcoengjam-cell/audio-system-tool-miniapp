'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const baselinePath = path.join(__dirname, 'baseline/content.json')
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const { getTool } = require(path.join(root, 'utils/tool-registry.js'))
const { buildBasisPresentation } = require(path.join(root, 'pages/basis/presentation.js'))

function assertBaselineValues(expected, actual, where, stats) {
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), `${where}: original array was removed`)
    assert.equal(actual.length, expected.length, `${where}: original array length changed`)
    expected.forEach((item, index) => assertBaselineValues(item, actual[index], `${where}[${index}]`, stats))
    return
  }
  if (expected && typeof expected === 'object') {
    assert(actual && typeof actual === 'object' && !Array.isArray(actual), `${where}: original object was removed`)
    for (const key of Object.keys(expected)) {
      assert(Object.hasOwn(actual, key), `${where}.${key}: original field was removed`)
      assertBaselineValues(expected[key], actual[key], `${where}.${key}`, stats)
    }
    return
  }
  assert.equal(actual, expected, `${where}: original value changed`)
  stats.values += 1
}

const stats = { values: 0 }
for (const frozen of baseline.tools) {
  const current = getTool(frozen.id)
  assert(current, `Tool disappeared: ${frozen.id}`)
  assertBaselineValues(frozen, {
    id: frozen.id,
    title: current.title,
    category: current.category,
    route: current.path,
    icon: current.icon,
    basis: current.basis,
    presentation: buildBasisPresentation(current),
  }, `tool:${frozen.id}`, stats)
}

console.log(JSON.stringify({ tools: baseline.tools.length, frozenValuesPreserved: stats.values, baselinePath }, null, 2))

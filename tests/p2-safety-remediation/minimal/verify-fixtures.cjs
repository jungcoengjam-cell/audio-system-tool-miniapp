'use strict'

const path = require('node:path')
const { assertFrozenFacts } = require('./fixtures.cjs')

const caseDir = path.resolve(__dirname, '../../p2-jev/v2.1')
const cases = [
  ...require(path.join(caseDir, 'audio.additions.json')),
  ...require(path.join(caseDir, 'av-and-controls.cases.json')),
]
assertFrozenFacts(cases)
console.log('minimal fixture mappings match frozen V2.1 facts')

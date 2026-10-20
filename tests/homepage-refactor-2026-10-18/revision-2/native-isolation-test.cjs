'use strict'
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict'), { createRequire } = require('node:module')
const directory = path.resolve(__dirname, '..'), file = path.join(directory, 'prepare-qa.cjs'), root = path.resolve(directory, '../..')
const source = fs.readFileSync(file, 'utf8'), start = source.indexOf("const reportV2 = process.argv.includes('--report-v2')"), end = source.indexOf("fs.writeFileSync(path.join(destination, 'app.js')", start)
assert(start >= 0 && end > start, 'Native fixture generator markers must match before evaluating it')
const setup = { fs, path, root, __dirname: directory, require: createRequire(file), process: { argv: ['node', file, '--persistent-qa', '--report-v2'] } }
vm.runInNewContext(source.slice(start, end) + ';globalThis.generatedWrapper=wrapper;globalThis.generatedSeed=seed;', setup)
assert(!setup.generatedWrapper.split('\n')[0].includes('\\n'), 'QA setup must be actual JavaScript lines, not swallowed by its opening comment')
const prefix = '__TuneBuddy_HomeQA_01a14dd7_20261018_revision2__:'
const store = new Map([['audioTool.records.v1', [{ id: 'owner-record' }]], ['audioTool.projects.v1', [{ id: 'owner-project' }]], ['__TuneBuddy_HomeQA_01a14dd7_20261018__:initialized', 1]])
const original = JSON.stringify([...store]), writes = []
const platform = { wx: {
  getStorageSync: key => structuredClone(store.get(key)),
  setStorageSync: (key, value) => { writes.push(key); store.set(key, structuredClone(value)) },
  removeStorageSync: key => { writes.push(key); store.delete(key) },
  getStorageInfoSync: () => ({ keys: [...store.keys()], currentSize: 0, limitSize: 10240 }),
} }
vm.runInNewContext(setup.generatedWrapper, platform)
assert(writes.length > 0 && writes.every(key => key.startsWith(prefix)), 'All initial fixture writes use the new QA namespace')
assert.equal(JSON.stringify(store.get(prefix + 'audioTool.records.v1')), JSON.stringify(setup.generatedSeed['audioTool.records.v1']))
assert.equal(JSON.stringify(platform.wx.getStorageSync('audioTool.projects.v1')), JSON.stringify(setup.generatedSeed['audioTool.projects.v1']))
platform.wx.setStorageSync('probe', { ok: true }); platform.wx.removeStorageSync('probe')
assert(!store.has('probe') && !store.has(prefix + 'probe'))
assert([...platform.wx.getStorageInfoSync().keys].every(key => !key.startsWith(prefix) && key !== 'initialized'))
assert.equal(JSON.stringify([...store].filter(([key]) => !key.startsWith(prefix))), original, 'Owner records and old QA storage remain byte-for-byte unchanged')
console.log('Native QA isolation PASS: generated wrapper executes, valid seed is prefixed, read/write/remove/info are isolated, owner and prior QA data are preserved.')

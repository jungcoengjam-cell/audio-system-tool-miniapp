'use strict'

const { createHarness } = require('../helpers/deterministic-harness')
const childProcess = require('child_process')
const path = require('path')
const { safeValue } = require('../helpers/report-serialize')

module.exports = function register({ test, assert }) {
  test('harness records every failed assertion and continues to later tests', async () => {
    const nested = createHarness()
    nested.test('first deliberately fails', () => { throw new Error('first failure') }, { classification: 'test problem', basis: 'harness self-check' })
    nested.test('second deliberately fails', () => { throw new Error('second failure') }, { classification: 'test problem', basis: 'harness self-check' })
    nested.test('later case still runs', () => assert(true), { classification: 'test problem', basis: 'harness self-check' })
    const results = await nested.run()
    assert(results.length === 3, 'all test cases should be recorded')
    assert(results.filter((result) => !result.passed).length === 2, 'both expected failures should be recorded')
    assert(results[2].passed, 'later test should run after prior failures')
  }, { classification: 'test problem', basis: 'The test harness must aggregate failures and continue execution.' })

  test('finiteTree rejects non-finite values at nested object paths', () => {
    let rejected = false
    try { createHarness().finiteTree({ output: [1, { value: NaN }] }, 'result') } catch (error) { rejected = /result\.output\.1\.value/.test(error.message) }
    assert(rejected, 'nested NaN must be rejected with a useful path')
  }, { classification: 'test problem', basis: 'Numerical tests must reject NaN and infinity recursively.' })

  test('caught mocked network calls are recorded for distinct wx objects and make the child exit nonzero', () => {
    const guard = path.resolve(__dirname, '../helpers/offline-guard.js')
    const script = [
      "const g=require(process.argv[1]);",
      "for(const label of ['first','second']){const wx={request(){}};g.registerWx(wx);try{wx.request()}catch(e){if(e.code!=='ERR_OFFLINE_GUARD')throw e}}",
    ].join('')
    const env = { ...process.env }
    const child = childProcess.spawnSync(process.execPath, ['-e', script, guard], { encoding: 'utf8', env })
    assert.strictEqual(child.status, 1, 'caught blocked calls must still force a nonzero exit')
    assert(child.stderr.includes('wx.request, wx.request'), 'the guard must report both separate mock objects')
  }, { classification: 'test problem', basis: 'The offline guard must detect attempted API calls even when caught and must patch each independent page mock.' })

  test('offline preload blocks Node HTTP, socket, and constructible WebSocket attempts without connecting', () => {
    const guard = path.resolve(__dirname, '../helpers/offline-guard.js')
    const script = [
      "const http=require('http');try{http.request('http://127.0.0.1')}catch(e){}",
      "const net=require('net');try{new net.Socket().connect(80,'127.0.0.1')}catch(e){}",
      "global.WebSocket=class WebSocketMock{};delete require.cache[require.resolve(process.argv[1])];require(process.argv[1]);try{new WebSocket('ws://127.0.0.1')}catch(e){}",
    ].join('')
    const env = { ...process.env, NODE_OPTIONS: '' }
    const child = childProcess.spawnSync(process.execPath, ['--require', guard, '-e', script, guard], { encoding: 'utf8', env })
    assert.strictEqual(child.status, 1, 'blocked built-in requests must set a nonzero child status')
    assert(child.stderr.includes('http.request') && child.stderr.includes('net.Socket.prototype.connect') && child.stderr.includes('global.WebSocket'), 'HTTP, sockets, and constructible WebSocket should be reported')
  }, { classification: 'test problem', basis: 'The offline guard must intercept common Node networking entry points before any socket connects.' })

  test('Windows minimal-environment bootstrap can preload the offline guard', () => {
    const guard = path.resolve(__dirname, '../helpers/offline-guard.js').replace(/\\/g, '/')
    const env = {}
    for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec']) if (process.env[name]) env[name] = process.env[name]
    env.NODE_OPTIONS = '--require "' + guard + '"'
    const child = childProcess.spawnSync(process.execPath, ['-e', "if(!Array.isArray(global.__offlineAttempts))process.exit(2);process.stdout.write('guard-loaded')"], {
      encoding: 'utf8', env,
    })
    assert.strictEqual(child.status, 0, 'minimal environment should resolve the quoted forward-slash preload path: ' + child.stderr)
    assert.strictEqual(child.stdout, 'guard-loaded', 'preload should run before the child script')
  }, { classification: 'test problem', basis: 'The runner must bootstrap successfully on Windows with its minimal environment and quoted preload path.' })

  test('runner exits nonzero after an isolated deterministic failure', () => {
    const runner = path.resolve(__dirname, '../deterministic-check.js')
    const child = childProcess.spawnSync(process.execPath, [runner, '--self-test-nonzero'], { encoding: 'utf8', env: process.env })
    assert.strictEqual(child.status, 1, 'runner must exit nonzero when a deterministic case fails')
    assert(child.stderr.includes('intentional isolated runner failure'), 'runner should print the failing case')
    assert(child.stderr.includes('expected: nonzero process status') && child.stderr.includes('actual: test case failure'), 'runner should report expected and actual values')
  }, { classification: 'test problem', basis: 'The runner contract requires a nonzero process exit and expected/actual failure detail for any failed case.' })

  test('report serialization preserves non-finite numbers and handles optional, bigint, and cyclic values', () => {
    const value = { nan: NaN, infinity: Infinity, absent: undefined, big: 8n }
    value.self = value
    const json = JSON.stringify(safeValue(value))
    assert(json.includes('"nan":"NaN"') && json.includes('"infinity":"Infinity"'))
    assert(json.includes('"big":"8n"') && json.includes('"self":"[Circular]"'))
    assert.strictEqual(safeValue(undefined), null)
    assert(!json.includes('absent'))
  }, { classification: 'test problem', basis: 'Machine reports must not silently turn non-finite numbers into null or crash on optional, bigint, and cyclic data.' })
}

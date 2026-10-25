'use strict'

const assert = require('node:assert/strict')
const Module = require('node:module')

const recordsPath = require.resolve('../utils/records')
const wiringPath = require.resolve('../utils/project-wiring')
const metadataPath = require.resolve('../utils/record-modules')
const registryPath = require.resolve('../utils/tool-registry')
const storageModules = new Set([recordsPath, wiringPath])
for (const file of [...storageModules, metadataPath, registryPath]) {
  assert.equal(require.cache[file], undefined, 'This boundary check must start with a cold module cache')
}

const originalLoad = Module._load
const previousWx = global.wx
const loaded = new Set()
let storageCalls = 0
let registry
global.wx = new Proxy({}, {
  get(_target, name) {
    if (!/Storage/.test(String(name))) return undefined
    return () => { storageCalls += 1; throw new Error('The tool registry must not access storage') }
  },
})
Module._load = function trackRegistryDependencies(request, parent, isMain) {
  const filename = Module._resolveFilename(request, parent, isMain)
  loaded.add(filename)
  assert(!storageModules.has(filename), 'Reading tool metadata must not load records or project wiring')
  return originalLoad.call(this, request, parent, isMain)
}
try {
  registry = require(registryPath)
  assert(registry.getTools().length > 0, 'The storage-free registry must still expose the tool catalog')
  assert.equal(storageCalls, 0)
} finally {
  Module._load = originalLoad
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}
assert(loaded.has(metadataPath), 'The catalog must use the shared record metadata')
for (const file of storageModules) assert.equal(require.cache[file], undefined)

const metadata = require(metadataPath)
const records = require(recordsPath)
assert.strictEqual(records.MODULES, metadata.MODULES, 'Existing records consumers must receive the same metadata objects')
assert.strictEqual(records.getModuleMetadata, metadata.getModuleMetadata, 'The legacy records lookup must remain the same API')
for (const [key, value] of Object.entries(metadata.MODULES)) {
  assert.strictEqual(records.getModuleMetadata(key), value)
  const tool = registry.getTool(key)
  assert(tool, 'Every active record module must retain its tool entry')
  assert.equal(tool.path, value.path, 'Tool and record restore routes must stay aligned')
}
assert.strictEqual(records.getModuleMetadata('venue'), metadata.LEGACY_MODULES.venue)
assert.equal(records.getModuleMetadata('venue').retired, true, 'Retired venue records must retain metadata')
for (const key of ['__unknown__', 'constructor', 'toString', '__proto__']) {
  assert.equal(records.getModuleMetadata(key), undefined, 'Unknown and inherited keys must not become record modules')
}

console.log('record-module-boundary: storage-free tool catalog, shared metadata identity and legacy lookup passed')

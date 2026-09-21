const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')

const root = path.resolve(__dirname, '../..')
const SOURCE_SHA256 = '8e821adbacbf54cc4a80861d4d1ed9b163fd2ffd287ec83c19d2d7e924d07582'
const sourcePath = path.join(root, 'docs/catalog-source/stage-lighting.json')
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
assert(Array.isArray(source) && source.every((product) => Object.getPrototypeOf(product) === Object.prototype))
const productsFromSource = source
const sourceDigest = crypto.createHash('sha256').update(JSON.stringify(productsFromSource)).digest('hex')
assert.strictEqual(sourceDigest, SOURCE_SHA256, 'maintained catalog differs from the frozen original serialized product snapshot')

const catalog = require('../../data/stage-lighting')
const { dmxFixtures, stageLightingProductIndex, stageLightingProducts } = catalog
const isolatedModule = { exports: {} }
require('vm').runInNewContext(fs.readFileSync(path.join(root, 'data/stage-lighting.js'), 'utf8'), { module: isolatedModule })
const isolatedCatalog = isolatedModule.exports
assert.deepStrictEqual(JSON.parse(JSON.stringify(stageLightingProducts)), productsFromSource)
assert.strictEqual(stageLightingProducts.length, 149)
assert.strictEqual(dmxFixtures.length, 121)
assert.deepStrictEqual(Object.keys(catalog), ['dmxFixtures', 'stageLightingProductIndex', 'stageLightingProducts'])
assert.strictEqual(new Set(stageLightingProducts.map(({ model }) => model)).size, 149)
assert(stageLightingProducts.every((product) => Object.getPrototypeOf(product) === Object.prototype))
assert(stageLightingProducts.every((product) => !Object.isFrozen(product)))
assert(!Object.isFrozen(stageLightingProducts) && !Object.isFrozen(dmxFixtures))
assert(stageLightingProductIndex instanceof Map)
assert.strictEqual(stageLightingProductIndex.size, 149)
stageLightingProducts.forEach((product, index) => {
  assert.strictEqual(stageLightingProductIndex.get(product.model), product)
  assert.strictEqual(stageLightingProductIndex.has(product.model), true)
  if (product.categoryKey === 'fixture' && product.channelModes.length) {
    assert.strictEqual(dmxFixtures.includes(product), true)
  }
  const expectedKeys = Object.keys(productsFromSource[index])
  assert.deepStrictEqual(Object.keys(product), expectedKeys, `${product.model}: property order differs`)
  assert.deepStrictEqual(Object.getOwnPropertyNames(product), expectedKeys, `${product.model}: own property presence differs`)
  assert(Object.isExtensible(product), `${product.model}: product must remain extensible`)
  assert.deepStrictEqual(Object.getOwnPropertySymbols(product), [], `${product.model}: unexpected symbol property`)
  expectedKeys.forEach((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(product, key)
    assert.deepStrictEqual([descriptor.enumerable, descriptor.configurable, descriptor.writable], [true, true, true])
  })
})
assert.deepStrictEqual(dmxFixtures, stageLightingProducts.filter((product) => product.categoryKey === 'fixture' && product.channelModes.length))
assert(dmxFixtures.every((product) => stageLightingProductIndex.get(product.model) === product))
assert.deepStrictEqual(dmxFixtures.map(({ model, channelModes, source: productSource }) => ({ model, channelModes, source: productSource })),
  productsFromSource.filter((product) => product.categoryKey === 'fixture' && product.channelModes.length)
    .map(({ model, channelModes, source: productSource }) => ({ model, channelModes, source: productSource })))

// Mutate a fresh module instance to verify actual export semantics without poisoning require caches.
const probe = isolatedCatalog.stageLightingProducts[0]
probe.name = 'mutated'
probe.__reclaimProbe = true
assert.strictEqual(probe.name, 'mutated')
assert.strictEqual(isolatedCatalog.stageLightingProductIndex.get(probe.model).name, 'mutated')
assert.strictEqual(probe.__reclaimProbe, true)
delete probe.__reclaimProbe
delete probe.__optionalProbe
assert.strictEqual(Object.hasOwn(probe, '__reclaimProbe'), false)
const mutableFixture = isolatedCatalog.dmxFixtures[0]
mutableFixture.name = 'mutated fixture'
assert.strictEqual(isolatedCatalog.stageLightingProductIndex.get(mutableFixture.model).name, 'mutated fixture')
assert.strictEqual(isolatedCatalog.stageLightingProducts.find((product) => product.model === mutableFixture.model).name, 'mutated fixture')
const originalModeCount = mutableFixture.channelModes.length
mutableFixture.channelModes.push(999)
assert.strictEqual(mutableFixture.channelModes[originalModeCount], 999)
mutableFixture.channelModes.pop()
assert.strictEqual(mutableFixture.channelModes.length, originalModeCount)
isolatedCatalog.stageLightingProducts.push({ model: '__probe__' })
assert.strictEqual(isolatedCatalog.stageLightingProducts.length, 150)
isolatedCatalog.stageLightingProducts.pop()
isolatedCatalog.dmxFixtures.push({ model: '__fixture_probe__' })
assert.strictEqual(isolatedCatalog.dmxFixtures.length, 122)
isolatedCatalog.dmxFixtures.pop()
isolatedCatalog.stageLightingProductIndex.set('__probe__', {})
assert.strictEqual(isolatedCatalog.stageLightingProductIndex.has('__probe__'), true)
isolatedCatalog.stageLightingProductIndex.delete('__probe__')

// Runtime consumers must observe the same catalog behavior as before refactoring.
const productUtils = require('../../utils/products')
const productList = productUtils.getProductList('lighting')
assert.strictEqual(productList.length, 149)
assert.deepStrictEqual(productUtils.getCategories('lighting'), ['全部', ...new Set(productsFromSource.map((product) => product.category))])
assert.deepStrictEqual(productUtils.getProductFilters('lighting'), [
  { key: 'all', label: '全部能力' },
  { key: 'dmxAddress', label: '可用于 DMX 编址' },
])
assert.deepStrictEqual(productUtils.filterProducts('lighting', 'TL-SK9201', '全部', 'all').map(({ model }) => model), ['TL-SK9201'])
assert.deepStrictEqual(productUtils.filterProducts('lighting', '灯具', '灯具', 'dmxAddress').map(({ model }) => model),
  productsFromSource.filter((product) => product.category === '灯具' && product.dmxAddressable).map(({ model }) => model))
const fixtureDetail = productUtils.getProductDetail('lighting', 'TL-SK9201')
const expectedDetailProduct = { ...productsFromSource.find((product) => product.model === 'TL-SK9201'), type: 'lighting' }
assert.deepStrictEqual(Object.fromEntries(Object.keys(productsFromSource.find((product) => product.model === 'TL-SK9201'))
  .map((key) => [key, fixtureDetail[key]])), expectedDetailProduct)

const Module = require('module')
function createProductUtilsWithCatalog(catalogProducts) {
  const filename = path.join(root, 'utils/products.js')
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalRequire = instance.require.bind(instance)
  instance.require = (request) => request === '../data/stage-lighting'
    ? { stageLightingProducts: catalogProducts }
    : originalRequire(request)
  instance._compile(fs.readFileSync(filename, 'utf8'), filename)
  return instance.exports
}
const originalConsumer = createProductUtilsWithCatalog(productsFromSource)
const compactConsumer = createProductUtilsWithCatalog(stageLightingProducts)
assert.deepStrictEqual(compactConsumer.getProductList('lighting'), originalConsumer.getProductList('lighting'))
assert.deepStrictEqual(compactConsumer.getCategories('lighting'), originalConsumer.getCategories('lighting'))
assert.deepStrictEqual(compactConsumer.getProductFilters('lighting'), originalConsumer.getProductFilters('lighting'))
for (const { model } of productsFromSource) {
  assert.deepStrictEqual(compactConsumer.getProductDetail('lighting', model), originalConsumer.getProductDetail('lighting', model), `${model}: consumer detail differs`)
}
for (const query of ['', 'TL-SK9201', '灯具', '染色', '不存在的型号']) {
  for (const category of ['全部', '灯具', '电源直通箱']) {
    for (const capability of ['all', 'dmxAddress']) {
      assert.deepStrictEqual(compactConsumer.filterProducts('lighting', query, category, capability),
        originalConsumer.filterProducts('lighting', query, category, capability), `${query}/${category}/${capability}: consumer filtering differs`)
    }
  }
}
function createDmxGroupConsumer(catalogValue) {
  const filename = path.join(root, 'pages/dmx-address/group-input.js')
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalRequire = instance.require.bind(instance)
  instance.require = (request) => request === '../../data/stage-lighting'
    ? catalogValue
    : originalRequire(request)
  instance._compile(fs.readFileSync(filename, 'utf8'), filename)
  return instance.exports
}
const originalDmx = createDmxGroupConsumer({
  stageLightingProductIndex: new Map(productsFromSource.map((product) => [product.model, product])),
  dmxFixtures: productsFromSource.filter((product) => product.categoryKey === 'fixture' && product.channelModes.length),
})
const compactDmx = createDmxGroupConsumer(catalog)
for (const product of productsFromSource.filter((item) => item.categoryKey === 'fixture' && item.channelModes.length)) {
  assert.deepStrictEqual(compactDmx.createGroup(1, { fixtureModel: product.model }),
    originalDmx.createGroup(1, { fixtureModel: product.model }), `${product.model}: DMX group consumer differs`)
}
const generatedSource = fs.readFileSync(path.join(root, 'data/stage-lighting.js'), 'utf8')
const loadSamples = []
for (let index = 0; index < 50; index += 1) {
  const start = performance.now()
  const freshModule = { exports: {} }
  require('vm').runInNewContext(generatedSource, { module: freshModule })
  assert.strictEqual(freshModule.exports.stageLightingProducts.length, 149)
  loadSamples.push(performance.now() - start)
}
loadSamples.sort((a, b) => a - b)
const medianLoadMs = loadSamples[Math.floor(loadSamples.length / 2)]
const p95LoadMs = loadSamples[Math.ceil(loadSamples.length * 0.95) - 1]
console.log(`catalog equivalence passed: ${stageLightingProducts.length} products, ${dmxFixtures.length} fixtures, SHA-256 ${sourceDigest}; fresh module load median/p95 ${medianLoadMs.toFixed(3)}/${p95LoadMs.toFixed(3)} ms`)

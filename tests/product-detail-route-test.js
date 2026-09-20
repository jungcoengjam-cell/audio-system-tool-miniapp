const assert = require('assert/strict')

const storage = new Map()
let storageWrites = 0
let page
global.Page = (definition) => { page = definition }
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => { storageWrites += 1; storage.set(key, value) },
  setNavigationBarTitle: ({ title }) => { page._title = title },
}

const products = require('../utils/products')
delete require.cache[require.resolve('../pages/products/detail')]
require('../pages/products/detail')
page.setData = (patch) => { page.data = { ...page.data, ...patch } }

const recentKey = products.RECENT_STORAGE_KEY
const samples = ['amplifier', 'speaker', 'camera', 'lighting']
  .map((type) => ({ type, model: products.getProductList(type)[0].model }))

function load(options) {
  page.data = { product: null }
  page._productDetail = undefined
  page._title = undefined
  page.onLoad(options)
  return page.data.product
}

for (const sample of samples) {
  storage.delete(recentKey)
  storageWrites = 0
  const plain = load(sample)
  assert.equal(plain.model, sample.model, `${sample.type} plain route`)
  assert.equal(storageWrites, 1)
  assert.equal(storage.get(recentKey)[0].model, sample.model)
  assert.equal(storage.get(recentKey)[0].type, sample.type)
  assert.equal(page._title, sample.model)

  const encodedModel = `%${sample.model.charCodeAt(0).toString(16).toUpperCase()}${sample.model.slice(1)}`
  storageWrites = 0
  const encoded = load({ type: sample.type, model: encodedModel })
  assert.deepEqual(encoded, plain, `${sample.type} encoded projection`)
  assert.equal(storageWrites, 1)
  assert.equal(page._title, sample.model)
  assert.equal(storage.get(recentKey)[0].type, sample.type)
}

for (const model of ['%', '%E0%A4%A', '%FF']) {
  storage.set(recentKey, [{ type: 'speaker', model: 'sentinel', viewedAt: 1 }])
  storageWrites = 0
  assert.doesNotThrow(() => load({ type: 'speaker', model }))
  assert.equal(page.data.product, null)
  assert.equal(storageWrites, 0)
  assert.deepEqual(storage.get(recentKey), [{ type: 'speaker', model: 'sentinel', viewedAt: 1 }])
  assert.equal(page._title, '产品资料')
}

storage.delete(recentKey)
storageWrites = 0
assert.equal(load({ type: 'speaker', model: '' }), null)
assert.equal(load({ type: 'speaker', model: 'unknown-model' }), null)
assert.equal(storageWrites, 0)
assert.doesNotThrow(() => load(undefined))
assert.equal(storageWrites, 0)
assert.equal(load({ type: 'unknown', model: samples[1].model }).model, samples[1].model)
assert.equal(storage.get(recentKey)[0].type, 'speaker')
assert.equal(load({ model: samples[1].model }).model, samples[1].model)

console.log('product detail route handling PASS')

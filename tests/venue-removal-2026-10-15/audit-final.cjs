'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '../..')
const normalize = (value) => value.split(path.sep).join('/')
const read = (file) => fs.readFileSync(path.resolve(root, file))
const json = (file) => JSON.parse(read(file).toString('utf8').replace(/^\uFEFF/, ''))
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const walk = (dir) => fs.readdirSync(path.resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const file = normalize(path.join(dir, entry.name))
  return entry.isDirectory() ? walk(file) : [file]
})
const production = ['pages', 'utils', 'data', 'assets', 'templates', 'styles'].flatMap(walk)
const baseline = json('tests/venue-removal-2026-10-15/baseline.json')
const app = json('app.json')
const config = json('project.config.json')
const registered = [...app.pages, ...(app.subPackages || []).flatMap((item) => item.pages.map((page) => `${item.root}/${page}`))]
assert(!registered.some((page) => page.startsWith('pages/venue/')))
for (const page of registered) {
  assert(fs.existsSync(path.join(root, `${page}.js`)), `Missing page controller: ${page}`)
  assert(fs.existsSync(path.join(root, `${page}.wxml`)), `Missing page template: ${page}`)
}
assert(!fs.existsSync(path.join(root, 'pages/venue')))
assert(!production.some((file) => /^utils\/venue.*\.js$/.test(file)))
assert(!fs.existsSync(path.join(root, 'data/speaker-recommendation-profiles.js')))
assert(!(config.packOptions?.include || []).some((item) => /venue/.test(item.value)))

const requires = []
for (const file of production.filter((name) => name.endsWith('.js'))) {
  const source = read(file).toString('utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, , request] of source.matchAll(/\brequire\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) {
    const target = path.resolve(root, path.dirname(file), request)
    const found = [target, `${target}.js`, `${target}.json`, path.join(target, 'index.js')]
      .some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    requires.push({ file, request, found })
  }
}
const missing = requires.filter((item) => !item.found)
assert.deepEqual(missing, [], 'Production relative imports must resolve after removal')

const gzipJson = (file) => JSON.parse(zlib.gunzipSync(read(file)).toString('utf8'))
const previousRenderer = gzipJson('tests/venue-removal-2026-10-15/baseline/calculator-renderer-baseline.json.gz')
const currentRenderer = gzipJson('tests/fixtures/calculator-renderer-baseline.json.gz')
assert.deepEqual(currentRenderer.camera, previousRenderer.camera, 'Four camera command fixtures must remain unchanged')
assert(!Object.hasOwn(currentRenderer, 'venue'), 'Retired renderer fixtures must be removed')
const previousUi = json('tests/venue-removal-2026-10-15/baseline/ui-test-first.json')
const currentUi = json('tests/package-reclaim/ui-test-first.json')
assert.deepEqual(currentUi.expandedWxmlSha256, Object.fromEntries(Object.entries(previousUi.expandedWxmlSha256).filter(([file]) => !file.startsWith('pages/venue/'))))
assert.equal(currentUi.xlrImageSha256, previousUi.xlrImageSha256)
assert.equal(currentUi.approvedSplRefactorExpandedWxmlSha256, previousUi.approvedSplRefactorExpandedWxmlSha256)
assert(!Object.hasOwn(currentUi, 'approvedVenueRefactorExpandedWxmlSha256'))
const previousReports = json('tests/venue-removal-2026-10-15/baseline/report-canvas-equivalence.fixture.json')
const currentReports = json('tests/report-canvas-equivalence.fixture.json')
assert.deepEqual(currentReports.scenarios.filter((item) => !/project/i.test(item.kind)), previousReports.scenarios.filter((item) => !/project/i.test(item.kind)))

const products = require('../../utils/products')
const previousProducts = json('tests/venue-removal-2026-10-15/products-before.json')
const collectNumbers = (value, prefix = '', result = {}) => {
  if (typeof value === 'number') result[prefix] = value
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'profile' && key !== 'modules') collectNumbers(child, `${prefix}/${key}`, result)
    }
  }
  return result
}
const speakers = products.getProductList('speaker')
assert.equal(speakers.length, previousProducts.length)
for (const previous of previousProducts) {
  const current = { list: speakers.find((item) => item.model === previous.list.model), detail: products.getProductDetail('speaker', previous.list.model) }
  assert.deepEqual(collectNumbers(current), collectNumbers(previous), `Speaker numeric values changed: ${previous.list.model}`)
}

const previousKnowledge = require('./baseline/knowledge-before.cjs').knowledgeItems
const currentKnowledge = require('../../data/knowledge').knowledgeItems
const withoutRetiredLink = (items) => items.map((item) => {
  if (item.id !== 'fill-handoff') return item
  const { relatedPath, relatedLabel, ...content } = item
  return content
})
assert.deepEqual(withoutRetiredLink(currentKnowledge), withoutRetiredLink(previousKnowledge), 'Knowledge content must remain unchanged apart from its retired tool link')
assert(!currentKnowledge.some((item) => /pages\/venue\//.test(item.relatedPath || '')))
const protectedData = baseline.files.filter((file) => file.path.startsWith('data/')
  && !['data/speaker-recommendation-profiles.js', 'data/knowledge.js'].includes(file.path))
const dataChanges = protectedData.filter((file) => !fs.existsSync(path.join(root, file.path)) || sha(read(file.path)) !== file.sha256).map((file) => file.path)
assert.deepEqual(dataChanges, [], 'Unrelated product data must remain unchanged')
const delta = baseline.files.flatMap((file) => !fs.existsSync(path.join(root, file.path))
  ? [{ path: file.path, kind: 'deleted', beforeBytes: file.bytes }]
  : sha(read(file.path)) !== file.sha256 ? [{ path: file.path, kind: 'changed', beforeBytes: file.bytes, afterBytes: read(file.path).length }] : [])
const result = {
  generatedAt: new Date().toISOString(), passed: true, registeredPages: registered.length,
  productionLiteralRelativeRequiresChecked: requires.length, missingImports: missing,
  cameraFixtureCasesUnchanged: currentRenderer.camera.length,
  nonProjectReportScenariosUnchanged: currentReports.scenarios.filter((item) => !/project/i.test(item.kind)).length,
  otherUiBaselinesUnchanged: true, speakersWithUnchangedNumericValues: speakers.length,
  otherDataFilesWithUnchangedHashes: protectedData.length, delta,
  note: 'Working-state delta records all observed changes; separate concurrent changes must not be reverted or attributed automatically.',
}
fs.writeFileSync(path.join(__dirname, 'parent-audit.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ passed: true, pages: registered.length, imports: requires.length, speakers: speakers.length, cameraCases: currentRenderer.camera.length, dataFiles: protectedData.length }))

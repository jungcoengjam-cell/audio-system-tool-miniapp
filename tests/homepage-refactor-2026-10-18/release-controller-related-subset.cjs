'use strict'

// Runs the release-check controller scenarios that remain valid for this
// refactor while excluding unchanged, unrelated legacy DMX/camera and product
// library/detail fixtures. It executes the source from release-check.js in
// memory and does not edit that file or any tracked fixture.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../..')
const releaseCheckPath = path.join(root, 'tests/release-check.js')
const releaseRequire = createRequire(releaseCheckPath)
const source = fs.readFileSync(releaseCheckPath, 'utf8')

function sliceBetween(input, startMarker, endMarker, label) {
  const start = input.indexOf(startMarker)
  const end = input.indexOf(endMarker, start + startMarker.length)
  assert(start >= 0 && end > start, `release-check ${label} block markers were not found`)
  return input.slice(start, end)
}

function stripBetween(input, startMarker, endMarker, label) {
  const start = input.indexOf(startMarker)
  const end = input.indexOf(endMarker, start + startMarker.length)
  assert(start >= 0 && end > start, `release-check ${label} exclusion markers were not found`)
  return `${input.slice(0, start)}\n  // Excluded from this related-scope run: ${label}.\n${input.slice(end)}`
}

const importPrefix = source.slice(0, source.indexOf('const root = path.resolve(__dirname'))
const rootAndWxml = `const root = ${JSON.stringify(root)};\n${sliceBetween(
  source,
  'function expandWxmlIncludes(',
  'const themeAliasMap =',
  'workspace root/WXML helper',
)}`
const themeAliasMap = sliceBetween(source, 'const themeAliasMap =', 'const assertFinalThemeDeclaration =', 'theme aliases')
const finalThemeHelper = sliceBetween(source, 'const assertFinalThemeDeclaration =', '// Scoped cascade check', 'final theme helper')
const cascadeHelper = sliceBetween(source, 'const assertThemeCascade =', 'const cascadeFixture =', 'theme cascade helper')
const brightTailHelper = sliceBetween(source, 'const assertDarkNoBrightTail =', 'const brightTailFixture =', 'dark-tail helper')
const findByModel = sliceBetween(source, 'function findByModel(', 'function checkCatalogSelector(', 'model lookup helper')
const formatKiB = sliceBetween(source, 'function formatKiB(', 'function findSensitiveApiCalls(', 'size formatter')

let controller = sliceBetween(source, 'function checkPageControllers() {', 'function checkPerformanceMeasurements() {', 'page controller')
controller = stripBetween(controller,
  "  const dmxPage = loadPage('pages/dmx-address/dmx-address.js')",
  "  const legacyProject = recordsApi.createProject('Release legacy project')",
  'legacy DMX and camera controller baselines')
controller = stripBetween(controller,
  "  const libraryPage = loadPage('pages/products/library.js')",
  "  const projectPage = loadPage('pages/records/project.js')",
  'product library/detail fixtures')

const runnable = [
  importPrefix,
  rootAndWxml,
  themeAliasMap,
  finalThemeHelper,
  cascadeHelper,
  brightTailHelper,
  findByModel,
  formatKiB,
  controller,
  'checkPageControllers();',
].join('\n')

const runRelatedSubset = new Function('require', '__dirname', 'Buffer', runnable)
runRelatedSubset(releaseRequire, path.dirname(releaseCheckPath), Buffer)
console.log('release-controller-related-subset: PASS (DMX/camera and product-library/detail legacy fixtures excluded)')

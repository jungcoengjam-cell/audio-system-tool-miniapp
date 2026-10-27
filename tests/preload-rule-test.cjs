'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appPath = path.join(__dirname, '..', 'app.json')
const app = JSON.parse(fs.readFileSync(appPath, 'utf8'))
const triggerPage = 'pages/tools/tools'
const expectedPackages = [
  'pages/audio-wiring',
  'pages/project-wiring',
  'pages/dmx-address',
  'pages/control-protocol',
]
const rule = app.preloadRule && app.preloadRule[triggerPage]

assert.ok(app.pages.includes(triggerPage), 'preload trigger must be a main-package page')
assert.ok(rule && typeof rule === 'object', 'tools page must have a preload rule')
assert.equal(rule.network, 'wifi', 'preload must run only on Wi-Fi')
assert.deepEqual(Object.keys(rule).sort(), ['network', 'packages'])
assert.ok(Array.isArray(rule.packages), 'preload packages must be an array')
assert.equal(new Set(rule.packages).size, rule.packages.length, 'preload packages must be unique')
assert.deepEqual([...rule.packages].sort(), [...expectedPackages].sort())

for (const root of expectedPackages) {
  const subpackage = app.subPackages.find((item) => item.root === root)
  assert.ok(subpackage, `preload root must exist in app.json subPackages: ${root}`)
  assert.ok(Array.isArray(subpackage.pages) && subpackage.pages.length > 0, `subpackage must declare pages: ${root}`)
}

console.log('preload-rule-test: all assertions passed')

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const app = require('../../app.json')
const subpackages = (app.subPackages || []).map(item => item.root + '/')
const visited = new Set(), failures = []
function visit(relative, chain) {
  if (visited.has(relative)) return
  visited.add(relative)
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  for (const match of source.matchAll(/\brequire\(['"]([^'"]+)['"]\)/g)) {
    if (!match[1].startsWith('.')) continue
    let next = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]))
    if (!path.posix.extname(next)) next += '.js'
    if (subpackages.some(prefix => next.startsWith(prefix))) {
      failures.push([...chain, relative, next].join(' -> '))
    } else if (next.endsWith('.js') && fs.existsSync(path.join(root, next))) visit(next, [...chain, relative])
  }
}
for (const page of app.pages) visit(page + '.js', [])
visit('app.js', [])
assert.deepEqual(failures, [], 'Main-package code cannot require subpackage-only modules')
console.log(`Main-package dependency boundary passed: ${visited.size} JS modules`)

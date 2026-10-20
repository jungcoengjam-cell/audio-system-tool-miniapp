'use strict'

// Attribute cross-module failures without changing the current working tree.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '../..')
const target = path.join(root, 'utils/records.js')
const baseline = fs.readFileSync(path.join(__dirname, 'before/utils/records.js'), 'utf8')
const original = Module._extensions['.js']
Module._extensions['.js'] = (module, file) => file === target ? module._compile(baseline, file) : original(module, file)

'use strict'

const childProcess = require('node:child_process')
const path = require('node:path')

const cases = [
  'testProjectKeyboardResizeLifecycle',
  'testProjectKeyboardEventsAndMetadataIdentity',
  'testProjectFocusDefersKeyboardLayout',
]

childProcess.execFileSync(process.execPath, [path.join(__dirname, 'vm-regression.cjs')], {
  cwd: path.resolve(__dirname, '../..'),
  env: { ...process.env, SPL_VM_CASES: cases.join(',') },
  stdio: 'inherit',
})

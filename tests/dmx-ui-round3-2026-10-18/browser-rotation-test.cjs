'use strict'

const { runLayoutRotationChecks } = require('../helpers/dmx-layout-browser-boundaries.cjs')

runLayoutRotationChecks({
  directory: __dirname,
  scriptPath: __filename,
  scope: 'dmx-ui-round3-2026-10-18',
  driver: require('./browser-driver.cjs'),
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})

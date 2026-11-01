'use strict'

const { createHarness } = require('./helpers/deterministic-harness')
const registerSpatialMathSuite = require('./deterministic/spatial-math.suite')

const harness = createHarness()
const selfTestFailure = process.argv.includes('--self-test-failure')

try {
  registerSpatialMathSuite(harness)
  if (selfTestFailure) harness.test('intentional spatial runner failure self-test', () => {
    throw new Error('intentional self-test: runner failures must set a nonzero process status')
  }, {
    classification: 'test problem',
    basis: 'This opt-in case verifies that the runner and its release-check invocation propagate failures.',
  })
} catch (error) {
  console.error(`FAIL [test problem] spatial-math suite registration: ${error.stack || error.message || error}`)
  process.exitCode = 1
}

async function main() {
  if (process.exitCode) return
  await harness.run()
  const failed = harness.results.filter((result) => !result.passed)
  for (const result of harness.results) {
    if (result.passed) {
      console.log(`PASS ${result.name}`)
      continue
    }
    console.error(`FAIL [${result.metadata.classification}] ${result.name}`)
    console.error(result.error?.stack || result.error?.message || String(result.error))
  }
  console.log(`Spatial math checks: ${harness.results.length - failed.length}/${harness.results.length} passed.`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`FAIL [test problem] spatial-math runner: ${error.stack || error.message || error}`)
  process.exitCode = 1
})

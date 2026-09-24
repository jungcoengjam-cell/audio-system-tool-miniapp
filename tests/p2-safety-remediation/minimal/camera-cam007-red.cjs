'use strict'

// Preserved CAM-007 pre-fix evidence. This exercises the real Camera Page
// initialization and handlers before structured operation support is added.
const assert = require('node:assert/strict')
const { createDelayedEnvironment } = require('./delayed-environment.cjs')

function run() {
  const env = createDelayedEnvironment()
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  const initialVerticalCandidate = page.data.customVerticalFovText
  page.onSourceModeTap({ currentTarget: { dataset: { index: 1 } } })
  env.flushNextTicks()
  for (const [field, value] of Object.entries({
    customHorizontalFovText: '75', groundWidthText: '6', groundDepthText: '4',
    subjectHeightText: '1.8',
  })) page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } })
  page.flushPendingCalculation()
  env.flushNextTicks()
  const result = page.data.result
  const evidence = {
    page: 'pages/camera/camera.js',
    operation: 'CAM-007 full-area automatic-height request',
    suppliedCurrentOperationInputs: {
      horizontalFov: 75, widthMeters: 6, depthMeters: 4,
      subjectHeightMeters: 1.8, heightMode: 'auto', marginPercent: 10,
    },
    verticalFovSuppliedForOperation: false,
    pageVerticalFovCandidate: initialVerticalCandidate,
    actualCalculationVerticalFov: result?.verticalFov ?? null,
    actualCoverageVerified: result?.coverageVerified ?? false,
    actualPrimaryDistanceMeters: result?.primaryDistanceMeters ?? null,
    unsafeCandidateConsumed: result?.verticalFov === 36 && result?.coverageVerified === true,
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  assert.equal(evidence.unsafeCandidateConsumed, true,
    'pre-fix red evidence should prove the page VFOV candidate reaches a full-area result')
  return evidence
}

if (require.main === module) run()
module.exports = { run }

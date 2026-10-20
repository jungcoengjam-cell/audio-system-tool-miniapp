'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDelayedEnvironment } = require('./p2-safety-remediation/minimal/delayed-environment.cjs')
const { ceilMinimumDistanceMeters, getPresentedMinimumDistanceMeters } = require('../pages/camera/camera-presentation')
const { drawPreviewAtSize } = require('../pages/camera/preview-renderer')
const { buildCameraReportPayload, buildCameraReportLayout, drawCameraReport } = require('../pages/camera/camera-report')

const repoRoot = path.resolve(__dirname, '..')
const cameraMarkup = fs.readFileSync(path.join(repoRoot, 'pages/camera/camera.wxml'), 'utf8')
const tap = (index) => ({ currentTarget: { dataset: { index: String(index) } } })
const close = (actual, expected, label) => assert(Math.abs(actual - expected) <= 1e-9, `${label}: ${actual} / ${expected}`)

function openPage() {
  const env = createDelayedEnvironment()
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  return { env, page }
}

function createCanvasSpy() {
  const textCalls = []
  const target = {
    font: '16px sans-serif',
    measureText(value) { return { width: [...String(value)].length * 8 } },
    fillText(value) { textCalls.push(String(value)) },
  }
  const context = new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key]
      return () => {}
    },
  })
  return { context, textCalls }
}

function verifyDisplayedTuple(result, label) {
  const dimensions = result.worldDimensions
  const distanceMatch = String(result.presentation.distanceText).match(/^([0-9]+(?:\.[0-9]+)?)\s*m$/)
  const heightMatch = String(result.presentation.heightDisplayText).match(/^([0-9]+(?:\.[0-9]+)?)\s*m$/)
  const pitchMatch = String(result.presentation.pitchLabel).match(/^(俯角|仰角|水平)\s+([0-9]+(?:\.[0-9]+)?)°$/)
  assert(distanceMatch && heightMatch && pitchMatch, `${label}: presentation must expose parseable units and direction`)
  const distance = Number(distanceMatch[1])
  const height = Number(heightMatch[1])
  const displayedPitchDegrees = pitchMatch[1] === '俯角' ? -Number(pitchMatch[2])
    : pitchMatch[1] === '仰角' ? Number(pitchMatch[2]) : 0
  const radians = displayedPitchDegrees * Math.PI / 180
  const xValues = result.sceneMode === 'ground'
    ? [distance, distance + dimensions.depth]
    : [distance]
  const horizontal = []
  const vertical = []
  for (const x of xValues) for (const z of [dimensions.bottom, dimensions.top]) {
    for (const y of [-dimensions.width / 2, dimensions.width / 2]) {
      const relativeHeight = z - height
      const axialDepth = x * Math.cos(radians) + relativeHeight * Math.sin(radians)
      assert(axialDepth > 0, `${label}: displayed tuple must keep every target corner in front of the lens`)
      horizontal.push(y / axialDepth)
      vertical.push((-x * Math.sin(radians) + relativeHeight * Math.cos(radians)) / axialDepth)
    }
  }
  const marginScale = 1 + Number(result.marginRatio)
  const requiredFromCenteredEnvelope = (coordinates) => {
    const minimum = Math.min(...coordinates)
    const maximum = Math.max(...coordinates)
    const center = (minimum + maximum) / 2
    const halfRange = (maximum - minimum) / 2
    const expandedMinimum = center - (halfRange * marginScale)
    const expandedMaximum = center + (halfRange * marginScale)
    return 2 * Math.atan(Math.max(Math.abs(expandedMinimum), Math.abs(expandedMaximum))) * 180 / Math.PI
  }
  const requiredHorizontal = requiredFromCenteredEnvelope(horizontal)
  const requiredVertical = requiredFromCenteredEnvelope(vertical)
  assert(requiredHorizontal <= Number(result.calculationHorizontalFov) + 1e-12,
    `${label}: displayed distance/height/tilt must fit the horizontal optical angle`)
  if (!result.horizontalOnly) {
    assert(requiredVertical <= Number(result.calculationVerticalFov) + 1e-12,
      `${label}: displayed distance/height/tilt must fit the vertical optical angle`)
  }
  return { requiredHorizontal, requiredVertical, displayedPitchDegrees, distance, height }
}

function scenario(label, setup) {
  const { env, page } = openPage()
  setup?.(page, env)
  const result = page.data.result
  assert(result && result.framingVersion === 2, `${label}: expected the current v2 library-camera calculation`)
  const rawFieldsBeforePresentation = JSON.stringify({ primaryDistanceMeters: result.primaryDistanceMeters,
    calculationDistanceMeters: result.calculationDistanceMeters, worldDimensions: result.worldDimensions })
  const preferencesBeforePresentation = page.getPreferences()
  const displayDistance = getPresentedMinimumDistanceMeters(result)
  assert.equal(result.presentedMinimumDistanceMeters, displayDistance, `${label}: page result exposes the shared presentation value`)
  assert(displayDistance >= result.calculationDistanceMeters, `${label}: presented minimum may not understate the exact solver distance`)
  assert.equal(result.primaryDistanceMeters, Number(result.calculationDistanceMeters.toFixed(2)),
    `${label}: existing numeric solver field remains unchanged`)
  assert.equal(JSON.stringify({ primaryDistanceMeters: result.primaryDistanceMeters,
    calculationDistanceMeters: result.calculationDistanceMeters, worldDimensions: result.worldDimensions }), rawFieldsBeforePresentation,
    `${label}: raw solver fields and world dimensions remain byte-value equivalent`)
  assert.deepEqual(page.getPreferences(), preferencesBeforePresentation, `${label}: saved and user-entered preferences are unchanged`)
  const geometry = verifyDisplayedTuple(result, label)
  const expected = `${displayDistance} m`
  const pageText = page.getResultText(page.data, result)
  const distanceLine = result.sceneMode === 'ground'
    ? `摄像机距区域前沿：${expected}`
    : `摄像机距目标平面：${expected}`
  assert(pageText.includes(distanceLine), `${label}: page text uses the presented minimum`)
  assert(pageText.includes(`计算结论：${result.calculationConclusion}`), `${label}: calculation conclusion remains in page text`)
  assert(result.calculationRows.at(-1).value === expected, `${label}: final calculation row uses the same presentation`)
  assert.equal(result.calculationConclusion, result.presentation.statusText,
    `${label}: calculation conclusion uses the shared presentation status`)
  const recordPayload = page.getRecordPayload(page.data, result)
  assert(recordPayload.summary.includes(expected), `${label}: record preview summary uses the same presentation`)
  assert(cameraMarkup.includes('result.presentationDistanceText')
    && cameraMarkup.includes('result.presentationHeightText')
    && cameraMarkup.includes('result.presentationPitchLabel')
    && cameraMarkup.includes('result.presentationStatusText'),
  'canvas accessibility text uses the same displayed tuple and status')

  const previewSpy = createCanvasSpy()
  drawPreviewAtSize(previewSpy.context, result, 331, 350, 'spatial', 'light')
  assert(previewSpy.textCalls.includes(expected), `${label}: current 3D preview label uses the presented minimum`)

  const reportPayload = buildCameraReportPayload(result, { theme: 'light', generatedAt: '2026-10-19 12:00' })
  assert.equal(reportPayload.distanceValue, expected, `${label}: report payload uses the same presentation`)
  const reportSpy = createCanvasSpy()
  const layout = buildCameraReportLayout(reportSpy.context, reportPayload)
  assert(drawCameraReport(reportSpy.context, reportPayload, layout), `${label}: report image draws`)
  assert(reportSpy.textCalls.filter((value) => value === expected).length >= 2,
    `${label}: report card and embedded 3D drawing both use the presented minimum`)
  return { label, rawCalculationDistanceMeters: result.calculationDistanceMeters, rawPrimaryDistanceMeters: result.primaryDistanceMeters,
    presentedMinimumDistanceMeters: displayDistance, cameraHeightMeters: geometry.height, pitchDegrees: geometry.displayedPitchDegrees,
    requiredHorizontalFov: geometry.requiredHorizontal, requiredVerticalFov: geometry.requiredVertical,
    horizontalFov: result.calculationHorizontalFov, verticalFov: result.calculationVerticalFov }
}

function editField(page, env, field, value) {
  page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value: String(value) } })
  page.onFieldBlur()
  env.flushNextTicks()
}

const roundingCases = [
  [4.653141850232092, 4.66],
  [4.65, 4.65],
  [4.650000000000001, 4.66],
  [4.649999999999999, 4.65],
  [1.005, 1.01],
  [1.15, 1.15],
  [2.675, 2.68],
  [0.004, 0.01],
]
roundingCases.forEach(([raw, expected]) => assert.equal(ceilMinimumDistanceMeters(raw), expected, `conservative 0.01 m display for ${raw}`))
assert.equal(getPresentedMinimumDistanceMeters({ framingVersion: 1, primaryDistanceMeters: 4.83, calculationDistanceMeters: 4.826429371771909 }), 4.83,
  'v1 compatibility numeric values are not rewritten')
assert.equal(getPresentedMinimumDistanceMeters({ framingVersion: 2, primaryDistanceMeters: 4.65, calculationDistanceMeters: 4.653141850232092 }), 4.66)

const results = [
  scenario('reported default ground / auto height'),
  scenario('ground / fixed non-step 3.001 m height', (page, env) => {
    page.onHeightModeTap(tap(1))
    env.flushNextTicks()
    editField(page, env, 'fixedCameraHeightText', '3.001')
    assert.equal(page.data.result.heightMode, 'fixed')
  }),
  scenario('plane / auto height', (page, env) => {
    page.onSceneModeTap(tap(1))
    env.flushNextTicks()
    assert.equal(page.data.result.heightMode, 'auto')
  }),
  scenario('plane / fixed non-step 3.001 m height', (page, env) => {
    page.onSceneModeTap(tap(1))
    env.flushNextTicks()
    page.onHeightModeTap(tap(1))
    env.flushNextTicks()
    editField(page, env, 'fixedCameraHeightText', '3.001')
    assert.equal(page.data.result.heightMode, 'fixed')
  }),
  scenario('tall plane / fixed non-step 3.001 m, near vertical constraint', (page, env) => {
    page.onSceneModeTap(tap(1))
    env.flushNextTicks()
    editField(page, env, 'planeHeightText', '5')
    editField(page, env, 'planeBottomHeightText', '0.5')
    page.onHeightModeTap(tap(1))
    env.flushNextTicks()
    editField(page, env, 'fixedCameraHeightText', '3.001')
    assert.equal(page.data.result.heightMode, 'fixed')
  }),
]
close(results[0].rawCalculationDistanceMeters, 4.653141850232092, 'reported exact calculation distance')
assert.equal(results[0].rawPrimaryDistanceMeters, 4.65, 'reported existing numeric field stays 4.65')
assert.equal(results[0].presentedMinimumDistanceMeters, 4.66, 'reported display rounds conservatively to 4.66')
console.log(JSON.stringify({ passed: true, roundingCases: roundingCases.length, scenarios: results, checks: [
  'display-step boundaries and floating-point edges', 'v1 numeric compatibility preservation',
  'independent displayed distance/height/tilt corner projection', 'page text, calculation process, record summary, canvas accessibility',
  'current 3D preview label and generated report image consistency',
] }, null, 2))

'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDelayedEnvironment } = require('./p2-safety-remediation/minimal/delayed-environment.cjs')
const { drawPreviewAtSize } = require('../pages/camera/preview-renderer')
const { buildCameraReportPayload, buildCameraReportLayout, drawCameraReport } = require('../pages/camera/camera-report')
const { REPORT_WIDTH } = require('../utils/report-drawing')

const ROOT = path.resolve(__dirname, '..')
const PAGE_WXML = fs.readFileSync(path.join(ROOT, 'pages/camera/camera.wxml'), 'utf8')
const PAGE_WXSS = fs.readFileSync(path.join(ROOT, 'pages/camera/camera.wxss'), 'utf8')
const BASE_PREFERENCES = {
  cameraCalculationVersion: 2,
  sourceMode: 'library',
  cameraModel: 'TV-6124HK',
  viewIndex: 0,
  definitionMode: 'angles',
  sceneMode: 'ground',
  heightMode: 'auto',
  marginPercent: 10,
  groundWidthText: '6',
  groundDepthText: '4',
  subjectHeightText: '1.8',
  planeWidthText: '1',
  planeHeightText: '1',
  planeBottomHeightText: '0',
  fixedCameraHeightText: '2.3',
}

function openPage(overrides = {}) {
  const env = createDelayedEnvironment()
  env.storage.set('audioTool.camera.preferences', { ...BASE_PREFERENCES, ...overrides })
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  assert(page.data.result, 'real camera Page should calculate from the isolated synthetic library preferences')
  return { env, page }
}

function createCanvasSpy() {
  const textCalls = []
  const textBoxes = []
  const state = { font: '16px sans-serif', textAlign: 'left' }
  const target = {
    get font() { return state.font },
    set font(value) { state.font = String(value) },
    get textAlign() { return state.textAlign },
    set textAlign(value) { state.textAlign = String(value) },
    setFontSize(value) { state.font = `${value}px sans-serif` },
    setTextAlign(value) { state.textAlign = String(value) },
    setFillStyle() {}, setStrokeStyle() {}, setLineWidth() {}, setLineDash() {},
    save() {}, restore() {}, scale() {}, translate() {},
    measureText(value) { return { width: [...String(value)].length * 8 } },
    fillText(value, x = 0, y = 0) {
      const text = String(value)
      textCalls.push(text)
      const width = this.measureText(text).width
      const size = Number(state.font.match(/([\d.]+)px/)?.[1]) || 16
      const left = state.textAlign === 'center' ? x - (width / 2)
        : state.textAlign === 'right' ? x - width : x
      textBoxes.push({ text, x, y, font: state.font, align: state.textAlign,
        left, right: left + width, top: y - size, bottom: y + (size * 0.25), width })
    },
  }
  const context = new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key]
      return () => {}
    },
  })
  return { context, textCalls, textBoxes }
}

function assertContainedBox(box, width, height, label) {
  assert(box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= height,
    `${label} text box must remain inside ${width}x${height}: ${JSON.stringify(box)}`)
}

function assertNoTextOverlap(first, second, label) {
  const overlaps = first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top
  assert(!overlaps, `${label} labels overlap: ${JSON.stringify(first)} / ${JSON.stringify(second)}`)
}

function parseDisplayedMeters(label, name) {
  const match = String(label).match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*m$/i)
  assert(match, `${name} must carry a parseable meter unit: ${label}`)
  return Number(match[1])
}

function parseDisplayedPitch(label) {
  const match = String(label).match(/^(俯角|仰角|水平)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)°$/)
  assert(match, `displayed pitch must include a direction and degree unit: ${label}`)
  const magnitude = Number(match[2])
  if (match[1] === '俯角') return -Math.abs(magnitude)
  if (match[1] === '仰角') return Math.abs(magnitude)
  assert.equal(magnitude, 0, 'horizontal label must represent zero degrees')
  return 0
}

// Independent pinhole corner projection. Inputs come only from actual final
// presentation strings plus the unmodified physical target dimensions.
function assessDisplayedTuple(result) {
  const presentation = result.presentation
  const distance = parseDisplayedMeters(presentation.distanceText, 'displayed distance')
  const cameraHeight = parseDisplayedMeters(presentation.heightDisplayText, 'displayed camera height')
  const pitchDegrees = parseDisplayedPitch(presentation.pitchLabel)
  const dimensions = result.worldDimensions
  const radians = pitchDegrees * Math.PI / 180
  const xValues = result.sceneMode === 'ground'
    ? [distance, distance + Number(dimensions.depth)]
    : [distance]
  const horizontal = []
  const vertical = []
  for (const x of xValues) for (const z of [Number(dimensions.bottom), Number(dimensions.top)]) {
    for (const y of [-Number(dimensions.width) / 2, Number(dimensions.width) / 2]) {
      const relativeHeight = z - cameraHeight
      const axialDepth = x * Math.cos(radians) + relativeHeight * Math.sin(radians)
      if (!(axialDepth > 0)) return { fits: false, distance, cameraHeight, pitchDegrees, requiredHorizontal: Infinity, requiredVertical: Infinity }
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
  const tolerance = 1e-12
  return {
    fits: requiredHorizontal <= Number(result.calculationHorizontalFov) + tolerance
      && requiredVertical <= Number(result.calculationVerticalFov) + tolerance,
    distance, cameraHeight, pitchDegrees, requiredHorizontal, requiredVertical,
  }
}

function checkSurfaces(label, page, { rawPreferences, expectedStatus, expectedHeightText, expectedAim }) {
  const result = page.data.result
  assert.equal(result.framingVersion, 2, `${label}: current v2 calculation`)
  assert.equal(result.presentation.statusKind, expectedStatus, `${label}: presentation status`)
  const geometry = assessDisplayedTuple(result)
  assert.equal(geometry.fits, expectedStatus === 'verified-v2', `${label}: independently checked displayed tuple`)
  assert.equal(result.presentation.heightDisplayText, expectedHeightText, `${label}: exact displayed height text`)
  assert.equal(result.presentation.aimValue, expectedAim, `${label}: displayed aim direction and value`)
  assert.equal(result.presentation.validation.fits, geometry.fits, `${label}: production and independent tuple result agree`)
  assert.equal(result.presentation.recommendationAllowed, geometry.fits, `${label}: recommendation follows complete displayed tuple`)

  const rawAfter = JSON.stringify({
    primaryDistanceMeters: result.primaryDistanceMeters,
    calculationDistanceMeters: result.calculationDistanceMeters,
    calculationAimAngleDegrees: result.calculationAimAngleDegrees,
    cameraHeightMeters: result.cameraHeightMeters,
    worldDimensions: result.worldDimensions,
    groundWidthText: page.data.groundWidthText,
    groundDepthText: page.data.groundDepthText,
    planeWidthText: page.data.planeWidthText,
    planeHeightText: page.data.planeHeightText,
    fixedCameraHeightText: page.data.fixedCameraHeightText,
  })
  assert.equal(result.primaryDistanceMeters, Number(result.calculationDistanceMeters.toFixed(2)), `${label}: legacy numeric distance remains unchanged`)
  assert.equal(page.data.fixedCameraHeightText, rawPreferences.fixedCameraHeightText, `${label}: saved fixed-height input remains unchanged`)
  assert.equal(page.getPreferences().fixedCameraHeightText, rawPreferences.fixedCameraHeightText, `${label}: preference payload preserves original input text`)

  const pageText = page.getResultText(page.data, result)
  assert(pageText.includes(result.presentation.distanceText), `${label}: page text uses displayed distance`)
  assert(pageText.includes(result.presentation.heightDisplayText), `${label}: page text uses full displayed height`)
  assert(pageText.includes(result.presentation.aimValue), `${label}: page text uses displayed aim`)
  assert(pageText.includes(result.presentation.statusText), `${label}: page text exposes tuple status`)
  const recordPayload = page.getRecordPayload(page.data, result)
  assert(recordPayload.resultText.includes(result.presentation.statusText), `${label}: record text preserves tuple status`)
  assert(recordPayload.summary.includes(result.presentation.distanceText), `${label}: saved preview uses displayed distance`)

  const previewSpy = createCanvasSpy()
  drawPreviewAtSize(previewSpy.context, result, 331, 350, 'spatial', 'light')
  assert(previewSpy.textCalls.includes(result.presentation.pitchLabel), `${label}: diagram shows the exact verified pitch label`)
  assert(previewSpy.textCalls.includes(result.presentation.distanceText), `${label}: diagram shows the exact displayed distance`)
  let renderedHeightLabel
  if (result.presentation.heightDisplayText.length * 8 > 331 * 0.46) {
    assert(previewSpy.textCalls.includes('高度完整数值见图下结果文字'), `${label}: long exact height is referenced below instead of clipped`)
    assert(!previewSpy.textCalls.includes(result.presentation.heightDisplayText), `${label}: diagram does not draw a too-wide height label`)
    renderedHeightLabel = '高度完整数值见图下结果文字'
  } else {
    assert(previewSpy.textCalls.includes(result.presentation.heightDisplayText), `${label}: diagram shows height when it fits`)
    renderedHeightLabel = result.presentation.heightDisplayText
  }
  const previewLabels = [result.presentation.pitchLabel, result.presentation.distanceText, renderedHeightLabel]
    .map((text) => previewSpy.textBoxes.find((box) => box.text === text))
  assert(previewLabels.every(Boolean), `${label}: all displayed tuple labels have measured canvas boxes`)
  previewLabels.forEach((box) => assertContainedBox(box, 331, 350, `${label}: preview`))
  assertNoTextOverlap(previewLabels[0], previewLabels[1], `${label}: pitch and distance`)
  assertNoTextOverlap(previewLabels[0], previewLabels[2], `${label}: pitch and height`)
  assertNoTextOverlap(previewLabels[1], previewLabels[2], `${label}: distance and height`)

  const reportPayload = buildCameraReportPayload(result, { theme: 'light', generatedAt: '2026-10-19 12:00' })
  assert.equal(reportPayload.distanceValue, result.presentation.distanceText, `${label}: report uses displayed distance`)
  assert.equal(reportPayload.heightValue, result.presentation.heightDisplayText, `${label}: report uses exact height text`)
  assert.equal(reportPayload.aimValue, result.presentation.aimValue, `${label}: report uses displayed aim`)
  assert.equal(reportPayload.presentationStatusText, result.presentation.statusText, `${label}: report uses shared status`)
  const reportSpy = createCanvasSpy()
  const layout = buildCameraReportLayout(reportSpy.context, reportPayload)
  assert(layout.sections.some((section) => section.type === 'status' && section.lines.join('').includes(result.presentation.statusText)),
    `${label}: report lays out shared status`)
  const heightMetric = layout.sections.find((section) => section.type === 'metrics')?.metrics[0]
  assert(heightMetric && heightMetric.valueLines.join('') === result.presentation.heightDisplayText,
    `${label}: report wraps without dropping height characters`)
  const reportTextWidth = (text) => [...String(text)].length * 8
  const metricTextWidth = heightMetric.width - 36
  assert(heightMetric.labelLines.every((line) => reportTextWidth(line) <= metricTextWidth)
    && heightMetric.valueLines.every((line) => reportTextWidth(line) <= metricTextWidth),
  `${label}: report height label and value line boxes remain within their metric column`)
  assert(heightMetric.x >= 0 && heightMetric.x + heightMetric.width <= REPORT_WIDTH,
    `${label}: report metric column remains inside the report canvas`)
  assert(heightMetric.contentHeight >= (heightMetric.labelLines.length * 32) + 10 + (heightMetric.valueLines.length * 40),
    `${label}: report metric row reserves non-overlapping wrapped line height`)
  const statusSection = layout.sections.find((section) => section.type === 'status')
  const reportContentWidth = REPORT_WIDTH - 88 - 56
  assert(statusSection?.lines.every((line) => reportTextWidth(line) <= reportContentWidth),
    `${label}: report warning/status lines remain within the card content bounds`)
  const metricsSection = layout.sections.find((section) => section.type === 'metrics')
  const diagramSection = layout.sections.find((section) => section.type === 'diagram')
  assert(statusSection && statusSection.y >= metricsSection.y + metricsSection.height
    && diagramSection.y >= statusSection.y + statusSection.height,
  `${label}: report status and diagram sections have separate vertical layout bounds`)
  assert(drawCameraReport(reportSpy.context, reportPayload, layout), `${label}: report image draws`)

  if (expectedStatus === 'display-unverified') {
    assert(result.heightSummary.startsWith('参考'), `${label}: warning result is not presented as a recommended height`)
    assert(result.resultNatureText.includes('不形成安装建议'), `${label}: warning result disclaims installation advice`)
    assert(result.calculationConclusion.includes('请勿据此安装'), `${label}: calculation conclusion blocks installation use`)
    assert(!result.mountGuidanceText.includes('初始俯仰参考'), `${label}: mount text does not publish a failed pitch as guidance`)
    assert(!/安装建议|推荐/.test(reportPayload.title), `${label}: report title must not frame an unverified tuple as installation advice`)
    assert(!/自动建议|推荐/.test(reportPayload.heightBasis), `${label}: report height basis must not frame the failed tuple as recommended`)
  }

  const rawAfterDraws = JSON.stringify({
    primaryDistanceMeters: result.primaryDistanceMeters,
    calculationDistanceMeters: result.calculationDistanceMeters,
    calculationAimAngleDegrees: result.calculationAimAngleDegrees,
    cameraHeightMeters: result.cameraHeightMeters,
    worldDimensions: result.worldDimensions,
    groundWidthText: page.data.groundWidthText,
    groundDepthText: page.data.groundDepthText,
    planeWidthText: page.data.planeWidthText,
    planeHeightText: page.data.planeHeightText,
    fixedCameraHeightText: page.data.fixedCameraHeightText,
  })
  assert.equal(rawAfterDraws, rawAfter, `${label}: rendering and report layout do not mutate raw solver geometry or inputs`)
  assert(PAGE_WXML.includes('result.presentationStatusText'), `${label}: Page markup exposes a live status region`)
  return {
    label,
    status: result.presentation.statusKind,
    rawDistance: result.calculationDistanceMeters,
    displayedDistance: result.presentation.distanceText,
    rawReportedCameraHeightMeters: result.cameraHeightMeters,
    rawWorldCameraHeightMeters: result.worldDimensions.cameraHeight,
    displayedHeight: result.presentation.heightDisplayText,
    rawPitchDegrees: result.calculationAimAngleDegrees,
    displayedPitch: result.presentation.pitchLabel,
    independentRequiredHorizontalFov: geometry.requiredHorizontal,
    independentRequiredVerticalFov: geometry.requiredVertical,
    horizontalFov: result.calculationHorizontalFov,
    verticalFov: result.calculationVerticalFov,
  }
}

function checkHorizontalReference(page, rawPreferences) {
  const result = page.data.result
  assert(result?.horizontalOnly, 'existing horizontal-only library view should use its actual composed Page path')
  assert.equal(result.selectedCamera?.model || page.data.selectedCamera?.model, 'TS-0650JSM', 'the existing TS-0650JSM catalog item is selected')
  assert.equal(page.data.viewIndex, 1, 'the existing Teacher panoramic lens view is selected')
  assert.equal(result.presentation.statusKind, 'horizontal-reference')
  assert.equal(result.presentation.recommendationAllowed, false)
  assert.equal(result.presentation.validation, null, 'horizontal-only reference does not claim a full tuple verification')
  assert.equal(result.calculationVerticalFov, null)
  assert.equal(result.verticalCoverageVerified, false)
  assert.equal(result.worldDimensions.cameraHeight, Number(rawPreferences.fixedCameraHeightText))
  assert.equal(result.presentation.heightDisplayText, `${rawPreferences.fixedCameraHeightText} m`,
    'current v2 horizontal-only fixed height retains exact input text')
  assert.equal(page.getPreferences().fixedCameraHeightText, rawPreferences.fixedCameraHeightText)
  assert.equal(result.presentation.aimValue, '未校核')
  assert(result.presentation.statusText.includes('垂直覆盖未校核'))
  assert(!result.mountGuidanceText.includes('初始俯仰参考'))
  assert(result.mountGuidanceText.includes('不得作为完整安装建议'))
  assert(result.heightSummary.startsWith('参考'))

  const pageText = page.getResultText(page.data, result)
  assert(pageText.includes(result.presentation.heightDisplayText))
  assert(pageText.includes(result.presentation.statusText))
  assert(pageText.includes('垂直未校核'))
  const recordPayload = page.getRecordPayload(page.data, result)
  assert(recordPayload.resultText.includes(result.presentation.statusText))

  const previewSpy = createCanvasSpy()
  drawPreviewAtSize(previewSpy.context, result, 331, 350, 'spatial', 'light')
  assert(!previewSpy.textCalls.some((label) => /^(?:俯角|仰角)\s/.test(label)),
    'horizontal-only diagram must not draw an unverified pitch angle')
  for (const label of [result.presentation.distanceText, result.presentation.heightDisplayText]) {
    assert(previewSpy.textCalls.includes(label), `horizontal reference diagram exposes ${label}`)
    assertContainedBox(previewSpy.textBoxes.find((box) => box.text === label), 331, 350, 'horizontal reference preview')
  }

  const reportPayload = buildCameraReportPayload(result, { theme: 'light', generatedAt: '2026-10-19 12:00' })
  assert.equal(reportPayload.title, '摄像机水平覆盖参考')
  assert.equal(reportPayload.heightValue, result.presentation.heightDisplayText)
  assert.equal(reportPayload.presentationStatusText, result.presentation.statusText)
  assert(!/安装建议|推荐/.test(reportPayload.title + reportPayload.heightBasis))
  const reportSpy = createCanvasSpy()
  const layout = buildCameraReportLayout(reportSpy.context, reportPayload)
  assert(layout.sections.some((section) => section.type === 'status' && section.lines.join('').includes(result.presentation.statusText)))
  const heightMetric = layout.sections.find((section) => section.type === 'metrics')?.metrics[0]
  assert.equal(heightMetric.valueLines.join(''), result.presentation.heightDisplayText)
  assert(drawCameraReport(reportSpy.context, reportPayload, layout))
  return { label: 'TS-0650JSM Teacher panoramic view', status: result.presentation.statusKind,
    horizontalFov: result.calculationHorizontalFov, verticalFov: result.calculationVerticalFov,
    inputFixedHeight: rawPreferences.fixedCameraHeightText, displayedFixedHeight: result.presentation.heightDisplayText }
}

const scenarios = []
const mountGuidanceScenarios = []

function checkMountGuidanceUsesPresentation(overrides, expected) {
  const { page } = openPage(overrides)
  const result = page.data.result
  assert.equal(result.mountType, expected.mountType)
  assert.equal(result.presentation.statusKind, 'verified-v2')
  assert.equal(result.presentation.heightText, expected.heightText)
  assert.equal(result.presentation.pitchText, expected.pitchText)
  assert.equal(result.presentation.pitchLabel, expected.pitchLabel)
  assert.equal(result.presentation.aimValue, expected.aimValue)
  assert.equal(result.presentation.precision.heightPlaces, expected.heightPlaces)
  assert.equal(result.presentation.precision.pitchPlaces, expected.pitchPlaces)
  assert.equal(result.aimText, expected.rawAimText)
  assert.notEqual(result.aimText, result.presentation.aimValue,
    'this catalog case must expose the raw-versus-presented precision difference')
  assert(result.mountGuidanceText.includes(expected.aimValue),
    'mount guidance must use the same presented angle as the Page tuple')
  assert(!result.mountGuidanceText.includes(result.aimText),
    'mount guidance must not reinsert the lower-precision raw angle')

  const pageText = page.getResultText(page.data, result)
  assert(pageText.includes('取景方式：' + result.mountGuidanceText))
  assert(pageText.includes(result.presentation.aimValue))
  const report = buildCameraReportPayload(result, { theme: 'light', generatedAt: '2026-10-19 12:00' })
  assert.equal(report.aimValue, result.presentation.aimValue)
  assert.equal(report.mountGuidanceText, result.mountGuidanceText)
  assert(report.mountGuidanceText.includes(result.presentation.aimValue))
  assert(!report.mountGuidanceText.includes(result.aimText))
  return {
    model: overrides.cameraModel,
    viewIndex: overrides.viewIndex,
    mountType: result.mountType,
    displayedHeight: result.presentation.heightText,
    displayedAim: result.presentation.aimValue,
    rawAim: result.aimText,
    guidance: result.mountGuidanceText,
    reportAim: report.aimValue,
    reportGuidance: report.mountGuidanceText,
  }
}

{
  const rawPreferences = { ...BASE_PREFERENCES, sceneMode: 'plane', heightMode: 'fixed',
    planeWidthText: '1', planeHeightText: '1', planeBottomHeightText: '0',
    fixedCameraHeightText: '1.0010000000000000000000' }
  const { page } = openPage(rawPreferences)
  scenarios.push(checkSurfaces('TV-6124HK 1m plane, exact long fixed input', page, {
    rawPreferences, expectedStatus: 'verified-v2', expectedHeightText: '1.0010000000000000000000 m', expectedAim: '向下 19.6°',
  }))
}

{
  const rawPreferences = { ...BASE_PREFERENCES, sceneMode: 'ground', heightMode: 'auto',
    groundWidthText: '0.465', groundDepthText: '6.357', subjectHeightText: '4.667' }
  const { page } = openPage(rawPreferences)
  const result = page.data.result
  assert.equal(result.presentation.heightText, '5.17', 'precision refinement keeps auto height at two decimals')
  assert.equal(result.presentation.pitchText, '-21.91°', 'precision refinement uses the first passing two-decimal pitch')
  assert.equal(result.presentation.precision.heightPlaces, 2)
  assert.equal(result.presentation.precision.pitchPlaces, 2)
  scenarios.push(checkSurfaces('TV-6124HK wide ground: auto-height/pitch precision refinement', page, {
    rawPreferences, expectedStatus: 'verified-v2', expectedHeightText: '5.17 m', expectedAim: '向下 21.91°',
  }))
}

{
  const rawPreferences = { ...BASE_PREFERENCES, sceneMode: 'ground', heightMode: 'fixed',
    groundWidthText: '1.629', groundDepthText: '9.591', subjectHeightText: '1.697',
    fixedCameraHeightText: '8.258' }
  const { page } = openPage(rawPreferences)
  const result = page.data.result
  assert.equal(result.presentation.statusKind, 'display-unverified', 'legal fixed-height Page counterexample blocks all display candidates')
  assert.equal(result.presentation.pitchText, '-45.640°', 'warning reports the highest tested pitch precision')
  const geometry = assessDisplayedTuple(result)
  assert(geometry.requiredVertical > result.calculationVerticalFov,
    `real Page counterexample must remain over vertical FOV: ${geometry.requiredVertical} > ${result.calculationVerticalFov}`)
  scenarios.push(checkSurfaces('TV-6124HK wide ground: legal fixed-height tuple warning', page, {
    rawPreferences, expectedStatus: 'display-unverified', expectedHeightText: '8.258 m', expectedAim: '向下 45.640°',
  }))
}

{
  const rawPreferences = { ...BASE_PREFERENCES, sceneMode: 'plane', heightMode: 'fixed',
    planeWidthText: '6', planeHeightText: '2.5', planeBottomHeightText: '0.8', fixedCameraHeightText: '3.001' }
  const { page } = openPage(rawPreferences)
  scenarios.push(checkSurfaces('TV-6124HK standard plane: non-step fixed 3.001 m', page, {
    rawPreferences, expectedStatus: page.data.result.presentation.statusKind,
    expectedHeightText: '3.001 m', expectedAim: page.data.result.presentation.aimValue,
  }))
}

{
  const rawPreferences = { ...BASE_PREFERENCES, cameraModel: 'TS-0650JSM', viewIndex: 1,
    sceneMode: 'plane', heightMode: 'fixed', planeWidthText: '6', planeHeightText: '2.5',
    planeBottomHeightText: '0.8', fixedCameraHeightText: '1.0010' }
  const { page } = openPage(rawPreferences)
  scenarios.push(checkHorizontalReference(page, rawPreferences))
}

{
  mountGuidanceScenarios.push(checkMountGuidanceUsesPresentation({
    ...BASE_PREFERENCES, cameraModel: 'TS-0650JSP', viewIndex: 1, sceneMode: 'ground',
    heightMode: 'auto', groundWidthText: '0.465', groundDepthText: '6.357', subjectHeightText: '4.667',
  }, {
    mountType: 'fixed', heightText: '5.167', pitchText: '-13.51°', pitchLabel: '俯角 13.51°',
    aimValue: '向下 13.51°', rawAimText: '向下 13.5°', heightPlaces: 3, pitchPlaces: 2,
  }))
}

{
  mountGuidanceScenarios.push(checkMountGuidanceUsesPresentation({
    ...BASE_PREFERENCES, cameraModel: 'TS-0663JP', viewIndex: 0, sceneMode: 'ground',
    heightMode: 'auto', groundWidthText: '0.303', groundDepthText: '9.302', subjectHeightText: '1.407',
  }, {
    mountType: 'eptz', heightText: '1.91', pitchText: '-13.53°', pitchLabel: '俯角 13.53°',
    aimValue: '向下 13.53°', rawAimText: '向下 13.5°', heightPlaces: 2, pitchPlaces: 2,
  }))
}

{
  const invalidPreferences = { ...BASE_PREFERENCES, sceneMode: 'plane', planeWidthText: '' }
  const env = createDelayedEnvironment()
  env.storage.set('audioTool.camera.preferences', invalidPreferences)
  const page = env.loadPage('pages/camera/camera.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  assert.equal(page.data.result, null, 'invalid page input must not create a presentation/result')
  assert(page.data.inputErrors.planeWidthText, 'invalid page input must show its existing field validation error')
  assert.equal(page.getResultText(page.data, null), '', 'invalid page input has no result text')
  assert.equal(page.getRecordPayload(page.data, null), null, 'invalid page input cannot create a record/report payload')
  assert.equal(buildCameraReportPayload(null), null, 'invalid page input cannot export a report payload')
  assert.equal(env.pending.canvases.length, 0, 'invalid page input does not enqueue a report image')
}

assert(PAGE_WXML.includes('aria-label="{{result.displayModel}}')
  && PAGE_WXML.includes('{{result.presentationDistanceText}}')
  && PAGE_WXML.includes('{{result.presentationHeightText}}')
  && PAGE_WXML.includes('{{result.presentationPitchLabel}}')
  && PAGE_WXML.includes('role="status" aria-live="polite">{{result.presentationStatusText}}'),
'canvas accessibility summary and visible status region use shared displayed tuple values')
assert(/\.camera-presentation-summary\{[^}]*word-break:break-all;overflow-wrap:anywhere/.test(PAGE_WXSS)
  && /\.camera-presentation-status\{[^}]*word-break:break-all;overflow-wrap:anywhere/.test(PAGE_WXSS),
'long display text and warnings should wrap within the visible result panel')

console.log(JSON.stringify({
  passed: true,
  scenarios,
  mountGuidanceScenarios,
  checks: [
    'actual composed camera Page onLoad/onShow with isolated synthetic preferences',
    'independent trigonometric projection of parsed displayed meter and signed-degree strings',
    'auto precision refinement selects H2/P2 for the documented TV-6124HK case',
    'legal fixed-height failure warns and suppresses installation recommendation across page/report',
    'fixed input text, raw solver fields, original geometry, and preferences remain unchanged',
    'page text, canvas aria, 3D diagram, and report share the same presentation tuple',
    'preview labels fit mocked measured bounds without overlap; report labels wrap within measured columns',
    'long fixed-height labels are retained and wrapped or referenced instead of clipped',
    'horizontal-only catalog view remains explicitly reference-only and preserves fixed input precision',
    'invalid page input produces no verified result, record payload, or report payload',
    'real fixed and EPTZ catalog guidance plus report use the precision-refined presented angle',
  ],
  textMeasurement: 'deterministic harness measureText widths, not native font or pixel rendering',
}, null, 2))

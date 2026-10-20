'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDelayedEnvironment } = require('./p2-safety-remediation/minimal/delayed-environment.cjs')

const root = path.resolve(__dirname, '..')
const pageSource = path.join(root, 'pages/led-screen/led-screen.js')
const wxmlSource = path.join(root, 'pages/led-screen/led-screen.wxml')
const wxssSource = path.join(root, 'pages/led-screen/led-screen.wxss')
const preferenceKey = 'audioTool.ledScreen.preferences'

function captureTimers(run) {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const callbacks = new Map()
  const delays = []
  let nextId = 1
  global.setTimeout = (callback, delay, ...args) => {
    const id = nextId++
    callbacks.set(id, () => callback(...args))
    delays.push(delay)
    return id
  }
  global.clearTimeout = (id) => callbacks.delete(id)
  try {
    return run({ callbacks, delays, fire(id) { const callback = callbacks.get(id); callbacks.delete(id); callback() } })
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
}

function createPage(preferences) {
  const env = createDelayedEnvironment()
  if (preferences) env.wx.setStorageSync(preferenceKey, preferences)
  const page = env.loadPage('pages/led-screen/led-screen.js')
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  return { env, page }
}

function input(page, env, field, value) {
  page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } })
  env.flushNextTicks()
}

function blur(page, env) {
  page.onFieldBlur()
  env.flushNextTicks()
}

function checkDefaultAndCurrentSiteCopy() {
  const { env, page } = createPage()
  const result = page.data.result
  assert(result, 'defaults should produce an initial result')
  assert.equal(result.dimensionText, '4.48 × 2.4 m')
  assert.equal(result.columns, 14)
  assert.equal(result.rows, 15)
  assert.equal(result.totalUnits, 210)
  assert.equal(result.layoutText, '横向模组 14 × 纵向模组 15，总共 210 块')
  assert.equal(result.ratioFallback, false, 'an exact 5% ratio boundary is not an algorithm fallback')
  assert.match(result.ratioSummaryText, /目标 16:9.*实际 1\.87:1.*偏差 5\.0%/)
  assert.match(result.integerLayoutNote, /完整单元拼装.*实际比例/)

  page.copyResult()
  const firstCopy = env.effects.clipboard.at(-1)
  for (const expected of ['现场墙面：6 × 3 m', '上/下最低预留：0.2 / 0.2 m', '实际比例：1.87:1', '偏差 5.0%']) {
    assert(firstCopy.includes(expected), `copied text omitted ${expected}`)
  }

  input(page, env, 'wallWidthText', '9.2')
  blur(page, env)
  page.copyResult()
  const updatedCopy = env.effects.clipboard.at(-1)
  assert(updatedCopy.includes('现场墙面：9.2 × 3 m'), 'copy must describe the latest wall width')
  assert(updatedCopy.includes('上/下最低预留：0.2 / 0.2 m'), 'copy must describe both current reserve values')
}

function checkDebounceAndImmediateInvalidation() {
  captureTimers(({ callbacks, delays, fire }) => {
    const { env, page } = createPage()
    const result = page.data.result
    page.toggleCurrentFavorite()
    assert.equal(page.data.currentFavorite, true)

    page.generateReportImage()
    env.flushNextTicks()
    assert.equal(env.pending.draws.length, 1)
    env.finishDraw(0)
    assert.equal(env.pending.canvases.length, 1)
    env.finishCanvas(0, 'wxfile://led-current.png')
    env.flushNextTicks()
    assert.equal(page.data.reportImagePath, 'wxfile://led-current.png')

    const timerCount = callbacks.size
    input(page, env, 'wallWidthText', '6')
    assert.equal(page.data.result, result, 'same-value input must retain the valid result')
    assert.equal(page.data.currentFavorite, true, 'same-value input must retain favorite state')
    assert.equal(page.data.reportImagePath, 'wxfile://led-current.png', 'same-value input must retain the report image')
    assert.equal(callbacks.size, timerCount, 'same-value input should not start a new calculation timer')

    input(page, env, 'wallWidthText', '')
    assert.equal(delays.at(-1), 160, 'manual input should keep the 160 ms debounce')
    assert.equal(page.data.inputPending, true, 'a lightweight pending state should be exposed during debounce')
    assert.equal(page.data.result, null, 'changed input must invalidate the old result synchronously')
    assert.equal(page.data.currentFavorite, false, 'changed input must clear the old favorite state synchronously')
    assert.equal(page.data.reportImagePath, '', 'changed input must clear the old report image synchronously')
    assert.equal(page.data.reportPreviewVisible, false)
    assert.equal(page.getRecordPayload(), null, 'a stale result must not remain available to record actions')

    const timerId = [...callbacks.keys()].at(-1)
    fire(timerId)
    env.flushNextTicks()
    assert.equal(page.data.inputPending, false)
    assert.equal(page.data.result, null)
    assert(page.data.fieldErrors.wallWidthText, 'empty wall width must get an inline error')
    page.copyResult()
    assert.equal(env.effects.clipboard.length, 0, 'invalid current input must not copy the stale result')
  })
}

function checkNumericValidationAndRecovery() {
  const { env, page } = createPage()
  const requiredPositive = [
    ['wallWidthText', ['wallWidthText']],
    ['wallHeightText', ['wallHeightText']],
    ['viewingDistanceText', ['viewingDistanceText']],
  ]
  const nonNegative = [
    ['topReserveText', ['topReserveText']],
    ['bottomReserveText', ['bottomReserveText']],
    ['frameWidthText', ['frameWidthText']],
  ]
  const originals = Object.fromEntries([...requiredPositive, ...nonNegative].map(([field]) => [field, page.data[field]]))
  const malformed = ['', '   ', 'NaN', 'Infinity', '-Infinity']

  for (const [field, relatedFields] of requiredPositive) {
    for (const value of [...malformed, '0', '-1']) {
      input(page, env, field, value)
      blur(page, env)
      assert.equal(page.data.result, null, `${field}=${JSON.stringify(value)} must be rejected`)
      for (const related of relatedFields) assert(page.data.fieldErrors[related], `${related} must be marked invalid`)
    }
    input(page, env, field, originals[field]); blur(page, env)
    assert(page.data.result, `${field} should recover after valid input`)
  }

  for (const [field, relatedFields] of nonNegative) {
    for (const value of [...malformed, '-1']) {
      input(page, env, field, value)
      blur(page, env)
      assert.equal(page.data.result, null, `${field}=${JSON.stringify(value)} must be rejected`)
      for (const related of relatedFields) assert(page.data.fieldErrors[related], `${related} must be marked invalid`)
    }
    input(page, env, field, '0'); blur(page, env)
    assert(page.data.result, `${field}=0 is a valid non-negative value`)
    input(page, env, field, originals[field]); blur(page, env)
    assert(page.data.result, `${field} should recover after valid input`)
  }
}

function checkCrossFieldErrorsAndRecovery() {
  const { env, page } = createPage()
  input(page, env, 'wallWidthText', '0.1'); blur(page, env)
  assert.equal(page.data.result, null)
  assert(page.data.fieldErrors.wallWidthText)
  assert(page.data.fieldErrors.frameWidthText)
  assert.match(page.data.inputSuggestion, /包边|墙宽/)

  input(page, env, 'wallWidthText', '6'); blur(page, env)
  input(page, env, 'wallHeightText', '0.4'); blur(page, env)
  assert.equal(page.data.result, null)
  for (const field of ['wallHeightText', 'topReserveText', 'bottomReserveText', 'frameWidthText']) {
    assert(page.data.fieldErrors[field], `${field} must be marked for a vertical clearance conflict`)
  }
  assert.match(page.data.inputSuggestion, /预留|包边|墙高/)
  input(page, env, 'wallHeightText', '3'); blur(page, env)
  assert(page.data.result, 'raising the wall height should restore calculation')
  assert.deepEqual(page.data.fieldErrors, {})
}

function checkRatioFallbackAndDiagramGeometry() {
  const fallback = createPage({
    wallWidthText: '0.32', wallHeightText: '0.16', topReserveText: '0', bottomReserveText: '0',
    frameWidthText: '0', viewingDistanceText: '1', aspectRatio: '16:9', unitKey: 'module', pitch: 'recommended',
  })
  const { page: fallbackPage } = fallback
  assert(fallbackPage.data.result.ratioFallback, 'a true integer-layout deviation above 5% must be explicit')
  assert.match(fallbackPage.data.result.ratioFallbackText, /超过 5%|无法满足/)
  assert.match(fallbackPage.data.result.ratioSummaryText, /实际 2:1.*偏差 12\.5%/)

  const drawCalls = []
  const context = new Proxy({
    fillText: (text, x, y) => drawCalls.push({ text: String(text), x, y }),
    measureText: (text) => ({ width: String(text).length * 9 }),
  }, { get: (target, key) => key in target ? target[key] : () => {} })
  const report = require('../pages/led-screen/report')
  const payload = report.buildLedScreenReportPayload(fallbackPage.getOutputState())
  const layout = report.buildLedScreenReportLayout(context, payload)
  report.drawLedScreenReport(context, payload, layout)
  const diagram = layout.sections.find((section) => section.type === 'diagram')
  const wallLabelY = diagram.y + diagram.wallLabelTop + 18
  const diagramTop = diagram.y + diagram.wallLabelTop + diagram.wallLabelLines.length * 24 + 7
  assert(drawCalls.some((call) => call.text === '墙体 0.32 × 0.16 m' && call.x === 375 && call.y === wallLabelY),
    'short-wall dimensions should remain centered and visible above the diagram')
  assert(wallLabelY < diagramTop, 'wall dimensions must not overlap the short-wall diagram')
  assert(drawCalls.some((call) => call.text.startsWith('左右实际余量') && call.x === 72),
    'the diagram should retain its horizontal margin summary below the drawing')

  const tall = createPage({
    wallWidthText: '1', wallHeightText: '20', topReserveText: '0.2', bottomReserveText: '0.2',
    frameWidthText: '5', viewingDistanceText: '3', aspectRatio: '16:9', unitKey: 'module', pitch: 'recommended',
  }).page.data.result
  const fitWidthPercent = Number(tall.diagramFitStyle.match(/width:([\d.]+)%/)[1])
  const wallPaddingPercent = Number(tall.wallDiagramStyle.match(/padding-top:([\d.]+)%/)[1])
  assert(fitWidthPercent > 0 && fitWidthPercent <= 100, 'diagram must fit the available width')
  assert(wallPaddingPercent > 0, 'wall diagram must keep the actual wall ratio')
  const renderedRatio = 100 / wallPaddingPercent
  assert(Math.abs(renderedRatio - (1 / 20)) < 1e-7, 'the tall wall must retain its true 1:20 ratio')
  assert(tall.diagramHeightRpx <= 420, 'legacy diagram height must remain bounded')
  assert(tall.diagramLabelsBelow, 'labels must move below a wall too narrow to hold them')
}

function checkPickerFallbackAndResponsiveGuidance() {
  const { page } = createPage()
  page.onAspectRatioChange({ detail: { value: '-1' } })
  assert.equal(page.data.aspectRatioIndex, -1)
  assert.equal(page.data.result, null)
  assert(page.data.fieldErrors.aspectRatioIndex)

  const { page: structuredPage } = createPage()
  structuredPage.beginStructuredOperation({})
  assert.equal(structuredPage.data.aspectRatioIndex, -1)
  assert.equal(structuredPage.data.unitIndex, -1)
  assert.equal(structuredPage.data.pitchIndex, -1)

  const wxml = fs.readFileSync(wxmlSource, 'utf8')
  const wxss = fs.readFileSync(wxssSource, 'utf8')
  assert(wxml.includes('请选择'), 'invalid picker indexes need a visible placeholder')
  assert(wxml.includes('inputPending'), 'input changes should expose the pending state')
  assert(wxss.includes('max-width:350px'), 'the three reserve fields must reflow on 320 px screens')
  assert(wxss.includes('white-space:normal'), 'long unit descriptions must be allowed to wrap')
  assert(fs.readFileSync(pageSource, 'utf8').includes('INPUT_CALCULATION_DELAY = 160'))
}

function checkResetPersistenceAndVerifiedViewingEstimate() {
  const { env, page } = createPage()
  const numericFields = [
    'wallWidthText', 'wallHeightText', 'topReserveText', 'bottomReserveText', 'frameWidthText', 'viewingDistanceText',
  ]

  assert.equal(page.resetInputs(), true)
  assert.deepEqual(numericFields.map((field) => page.data[field]), ['', '', '', '', '', ''])
  assert.equal(page.data.result, null)
  assert.deepEqual([page.data.aspectRatioIndex, page.data.unitIndex, page.data.pitchIndex], [0, 0, 0])
  const savedPreferences = env.wx.getStorageSync(preferenceKey)
  assert.deepEqual(numericFields.map((field) => savedPreferences[field]), ['', '', '', '', '', ''],
    'reset must persist all six blank numeric fields')

  const reopened = createPage(savedPreferences).page
  assert.deepEqual(numericFields.map((field) => reopened.data[field]), ['', '', '', '', '', ''],
    'reopening after reset must preserve blank numeric fields')
  assert.equal(reopened.data.result, null, 'blank reset values must not recreate the example result on load')
  assert.deepEqual([reopened.data.aspectRatioIndex, reopened.data.unitIndex, reopened.data.pitchIndex], [0, 0, 0])

  const sample = createPage()
  input(sample.page, sample.env, 'viewingDistanceText', '2')
  blur(sample.page, sample.env)
  const result = sample.page.data.result
  assert(result, 'the 6 × 3 m / 2 m viewing case should calculate')
  assert.equal(result.dimensionText, '4.48 × 2.4 m')
  assert.deepEqual([result.columns, result.rows, result.totalUnits], [14, 15, 210])
  assert.equal(result.pixelPitch, 1.25)
  assert.equal(result.statusKey, 'near')
  assert.match(result.viewingAssessmentText, /低于.*舒适距离/)
}

checkDefaultAndCurrentSiteCopy()
checkDebounceAndImmediateInvalidation()
checkNumericValidationAndRecovery()
checkCrossFieldErrorsAndRecovery()
checkRatioFallbackAndDiagramGeometry()
checkPickerFallbackAndResponsiveGuidance()
checkResetPersistenceAndVerifiedViewingEstimate()
console.log('LED first-use regression passed')

'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const preferencesKey = 'audioTool.gainStructure.preferences'
let storedPreferences = {}
let pageDefinition
const previousPage = global.Page
const previousWx = global.wx

global.wx = {
  getStorageSync(key) {
    return key === preferencesKey ? { ...storedPreferences } : undefined
  },
  setStorageSync(key, value) {
    if (key === preferencesKey) storedPreferences = { ...value }
  },
  removeStorageSync(key) {
    if (key === preferencesKey) storedPreferences = {}
  },
  canIUse() { return false },
  vibrateShort() {},
}
global.Page = (definition) => { pageDefinition = definition }
require(path.join(root, 'pages/gain-structure/gain-structure.js'))
if (previousPage === undefined) delete global.Page
else global.Page = previousPage

const { buildResultReportPayload } = require('../utils/result-report')
const {
  calculateResultReportHeight,
  drawResultReport,
  getCanonicalResultNature,
} = require('../pages/gain-structure/gain-report')

function makePage(preferences) {
  storedPreferences = { ...preferences }
  const page = {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(update, callback) {
      Object.assign(this.data, update)
      if (typeof callback === 'function') callback()
    },
  }
  page.onLoad()
  return page
}

function makeMeasureContext() {
  const context = {
    font: '400 16px sans-serif',
    align: 'left',
    drawnText: [],
    measureText(value) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || 16)
      const width = [...String(value)].reduce((total, character) => {
        if (/\s/.test(character)) return total + (size * 0.28)
        return total + (size * (character.codePointAt(0) < 128 ? 0.56 : 1))
      }, 0)
      return { width }
    },
    setFillStyle() {},
    setStrokeStyle() {},
    setLineWidth() {},
    setTextAlign(value) { this.align = value },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    fillRect() {},
    fillText(value, x, y) {
      this.drawnText.push({
        text: String(value),
        x,
        y,
        align: this.align,
        width: this.measureText(value).width,
        size: Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || 16),
      })
    },
  }
  return context
}

function renderPageReport(page) {
  assert.strictEqual(page.data.hasValidResult, true, 'fixture must produce a valid result')
  const record = page.getRecordPayload()
  assert(record && record.resultText, 'live controller must produce a canonical record')
  const payload = buildResultReportPayload(record)
  payload.resultNature = getCanonicalResultNature(record.resultText)
  assert(payload.resultNature, 'canonical result nature remains available in the report payload')
  assert(record.resultText.split(/\r?\n/).some((line) => line.startsWith('结果性质：')), 'canonical record keeps its result-nature line')
  const context = makeMeasureContext()
  const height = calculateResultReportHeight(payload, context)
  assert(height > 0 && height < 4096, `report canvas height must be bounded, got ${height}`)
  drawResultReport(context, payload, height)
  for (const item of context.drawnText) {
    const left = item.align === 'center' ? item.x - (item.width / 2)
      : item.align === 'right' ? item.x - item.width : item.x
    const right = left + item.width
    assert(left >= -1 && right <= 751,
      `drawn text must stay within 750px canvas: ${item.text} (${left}..${right})`)
    assert(item.y <= height,
      `drawn text baseline must stay within measured canvas: ${item.text} at ${item.y}/${height}`)
  }
  return {
    page,
    record,
    payload,
    height,
    text: context.drawnText.map((item) => item.text).join(''),
    drawnLines: context.drawnText.map((item) => item.text),
  }
}

function assertIncludesIgnoringWhitespace(text, value, label) {
  const normalize = (source) => String(source).replace(/\s/g, '')
  assert(normalize(text).includes(normalize(value)), `${label} must be visible in report text`)
}

const attenuation = renderPageReport(makePage({
  amplifierModel: 'TC-X2200B',
  stageValue: 1,
  mode: 'stereo',
  loadImpedance: null,
  targetPeakDbfs: -6,
}))
for (const expected of [
  '系统对齐衰减',
  '10.19 dB',
  'DSP 目标峰值',
  '-6 dBFS = 12.4 dBu',
  '功放额定输入点',
  '1 V = 2.21 dBu',
  '衰减执行位置',
  'DSP 输入表目标',
  'DSP 最终输出增益',
  '功放输入电平控制',
  '0 dB 衰减',
  '本次衰减只在 DSP 最终输出执行，功放输入电平控制不要重复衰减。',
]) assertIncludesIgnoringWhitespace(attenuation.text, expected, expected)
for (const [label, value] of [
  ['generatedAt', attenuation.payload.generatedAt],
  ['appVersion', attenuation.payload.appVersion],
  ['productDataDate', attenuation.payload.productDataDate],
]) assertIncludesIgnoringWhitespace(attenuation.text, value, `${label} traceability value`)
for (const label of ['生成时间：', '小程序版本：', '产品资料日期：']) {
  assertIncludesIgnoringWhitespace(attenuation.text, label, `${label} traceability label`)
}
assert(attenuation.payload.summary.includes('10.19'), 'canonical record summary must remain unchanged')
assert(attenuation.payload.title, 'canonical payload title must remain in the payload')
assert(attenuation.payload.trustLabel && attenuation.payload.trustDescription,
  'canonical trust metadata must remain in the payload')
assert(attenuation.record.resultText.includes('结果性质：'),
  'canonical result-nature text must remain in the record')
const omittedVisualLines = attenuation.payload.lines.filter((line) => (
  /^(结果性质：|结果边界：|后续步骤：|现场响度：|现场复核：)/.test(line)
))
assert(omittedVisualLines.length >= 4, 'canonical record must retain the omitted visual sections')
const normalizeReportText = (value) => String(value).replace(/\s/g, '')
assert(!attenuation.drawnLines.some((line) => normalizeReportText(line).includes(
  normalizeReportText(attenuation.payload.title))), 'report must omit the redundant payload title')
for (const value of [attenuation.payload.trustLabel, attenuation.payload.trustDescription]) {
  assert(!normalizeReportText(attenuation.text).includes(normalizeReportText(value)),
    'report must omit the trust paragraph while preserving source payload metadata')
}
for (const line of omittedVisualLines) {
  assert(attenuation.record.resultText.includes(line), 'omitted report content remains canonical record text')
  assert(!normalizeReportText(attenuation.text).includes(normalizeReportText(line)),
    'report must omit result-nature, boundary, and field follow-up blocks')
}
assert(!attenuation.text.replace(/\s/g, '').includes(attenuation.payload.summary.replace(/\s/g, '')),
  'the card should not repeat the summary when its numbers are already in the hero and metrics')
assert(attenuation.drawnLines.findIndex((line) => line.includes('衰减执行位置'))
  < attenuation.drawnLines.findIndex((line) => line.includes('功放型号')),
'execution guidance must precede the retained condition card')
assert(!attenuation.text.includes('系统无需增加衰减'),
  'attenuation report must not imply zero attenuation when a nonzero canonical value exists')

const drive = renderPageReport(makePage({
  amplifierModel: 'TC-22000',
  stageValue: 33,
  mode: 'bridge',
  loadImpedance: 8,
  targetPeakDbfs: -3,
}))
for (const expected of [
  '驱动差额',
  '1.17 dB',
  'DSP 目标峰值',
  '-3 dBFS = 15.4 dBu',
  '5.222 V = 16.57 dBu',
  'DSP 最终输出增益',
  '0 dB',
  '当前目标驱动不足，DSP 和功放都不要再衰减；应更换输入级档位或提高目标峰值。',
]) assertIncludesIgnoringWhitespace(drive.text, expected, expected)
assert(!drive.text.includes('建议系统衰减'),
  'drive-shortfall report must remain distinct from an attenuation recommendation')
assert(drive.drawnLines.some((line) => line.includes('16.57 dBu')),
  'numeric value and dBu unit must stay together when the rated input wraps')

const direct = makePage({
  amplifierModel: 'KT-P21000',
  stageValue: 1,
  mode: 'stereo',
  loadImpedance: null,
  targetPeakDbfs: -6,
})
const directTarget = Math.round((direct.data.result.fullPowerInputDbu
  - direct.data.result.dspMaxOutputDbu) * 100) / 100
direct.data.targetPeaks = [{ value: directTarget, label: `${directTarget} dBFS` }]
direct.data.targetPeakIndex = 0
direct.commitCalculatedState({}, 'calculate')
assert.strictEqual(direct.data.result.alignmentMode, 'direct', 'edge fixture must be an actual zero-difference result')
const zeroEdge = renderPageReport(direct)
assertIncludesIgnoringWhitespace(zeroEdge.text, '系统对齐衰减', 'canonical zero adjustment label')
assertIncludesIgnoringWhitespace(zeroEdge.text, '0 dB', 'zero adjustment value')

const sharePage = makePage({
  amplifierModel: 'TC-X2200B',
  stageValue: 1,
  mode: 'stereo',
  loadImpedance: null,
  targetPeakDbfs: -6,
})
const shareCanvasContext = makeMeasureContext()
shareCanvasContext.draw = (_reserve, callback) => {
  if (typeof callback === 'function') callback()
}
const originalCreateCanvasContext = global.wx.createCanvasContext
const originalCanvasToTempFilePath = global.wx.canvasToTempFilePath
let canvasContextCalls = 0
let exportedOptions
global.wx.createCanvasContext = () => {
  canvasContextCalls += 1
  return shareCanvasContext
}
global.wx.canvasToTempFilePath = (options) => {
  exportedOptions = options
  options.success({ tempFilePath: 'mock://gain-result.png' })
}
try {
  assert.doesNotThrow(() => sharePage.openSharePreview(),
    'actual share-preview flow must build and render the canonical payload')
  assert.strictEqual(sharePage.data.shareSheetVisible, true)
  assert.strictEqual(sharePage.data.isGeneratingResultReport, false)
  assert.strictEqual(sharePage.data.resultReportPreviewVisible, true)
  assert.strictEqual(sharePage.data.resultReportImagePath, 'mock://gain-result.png')
  assert.strictEqual(canvasContextCalls, 2,
    'controller must measure and draw the actual report through canvas contexts')
  assert(exportedOptions && exportedOptions.width === 750 && exportedOptions.height > 0,
    'controller must export the dynamically measured poster dimensions')
  const generatedReportText = shareCanvasContext.drawnText.map((item) => item.text).join('')
  for (const expected of ['10.19 dB', '-6 dBFS = 12.4 dBu', '1 V = 2.21 dBu']) {
    assertIncludesIgnoringWhitespace(generatedReportText, expected,
      `actual share-preview export must draw ${expected}`)
  }
} finally {
  if (originalCreateCanvasContext === undefined) delete global.wx.createCanvasContext
  else global.wx.createCanvasContext = originalCreateCanvasContext
  if (originalCanvasToTempFilePath === undefined) delete global.wx.canvasToTempFilePath
  else global.wx.canvasToTempFilePath = originalCanvasToTempFilePath
}

assert.throws(() => calculateResultReportHeight({
  ...attenuation.payload,
  lines: attenuation.payload.lines.filter((line) => !line.startsWith('系统对齐衰减：')),
}, makeMeasureContext()), /缺少规范的调整值/,
'report generation must fail clearly instead of inventing a dash or zero adjustment')

const pageSource = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/gain-structure/gain-structure.wxss'), 'utf8')
const railStart = wxml.indexOf('<view class="action-rail"')
const railEnd = wxml.indexOf('\n    </view>', railStart)
const railBlock = railStart >= 0 && railEnd > railStart
  ? wxml.slice(railStart, railEnd)
  : ''
assert.strictEqual((railBlock.match(/<button\b/g) || []).length, 4, 'result rail must keep four actions')
assert.match(wxss, /\.action-rail\{[^}]*width:44px;[^}]*flex-direction:column;[^}]*gap:2px/,
  'four result actions must form a 44px vertical rail with a compact gap')
assert.match(wxss, /\.action-button\.action-button\{[^}]*flex:0 0 44px/,
  'native buttons must keep 44px height without flex shrinking')
assert.match(wxss, /\.action-button\.action-button\{[^}]*width:44px;[^}]*height:44px/,
  'each action button must retain a 44px square touch target')
assert.match(wxml, /class="choice-grid choice-grid-targets"[\s\S]*?wx:for="\{\{targetPeaks\}\}"/,
  'the three target options must remain bound to the canonical target list')
assert.match(wxss, /\.choice-grid-targets\{display:flex;[^}]*flex-direction:column;[^}]*gap:8px/,
  'target option cards must use full-width native-compatible rows')
assert.match(wxss, /\.choice-grid-targets \.choice-card\{[^}]*width:100%;[^}]*min-height:64px/,
  'target rows must retain full-width 64px touch targets')
assert.match(wxss, /\.choice-grid-targets \.choice-label,\.choice-grid-targets \.choice-description\{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/,
  'target labels and descriptions must wrap inside their own touch rows')
assert.match(wxml, /class="target-radio" aria-hidden="true"/,
  'target rows must show a radio-like selection indicator')
assert.doesNotMatch(wxss, /\.result-facts\{flex-direction:column/,
  'secondary result facts should remain side by side at short heights when they fit')
assert.match(wxss, /\.result-pane\{position:relative;[^}]*flex:0 0 320px/,
  'the result pane must use a bounded normal-height profile')
assert.match(wxss, /\.result-heading\{[^}]*flex:0 0 20px;[^}]*min-height:20px/,
  'the result status line must stay compact enough to preserve the hero and detail space')
assert.match(wxss, /\.result-primary\{[^}]*flex:0 0 130px/,
  'the normal-height hero must keep its deliberate readout space')
assert.match(wxss, /@media\(max-height:680px\)\{[\s\S]*?\.result-pane\{flex-basis:300px/,
  'the result pane must use the compact 300px profile on short screens')
assert.match(wxss, /@media\(max-height:460px\)\{[\s\S]*?\.result-pane\{flex-basis:220px/,
  'the result pane must preserve input space at very short heights')
assert.match(wxss, /@media\(max-height:460px\)\{[\s\S]*?\.result-primary\{flex-basis:72px/,
  'the short-screen hero must keep enough height clear of the result facts')
assert.match(wxss, /\.input-pane\{[^}]*height:0;[^}]*min-height:0;[^}]*flex:1 1 0/,
  'the input pane must fill remaining space and shrink safely')
assert.match(wxss, /\.editor-scroll\{[^}]*height:0;[^}]*min-height:40px;[^}]*flex:1 1 0/,
  'editor content must scroll inside the available input pane')
assert.match(wxss, /\.result-details-scroll\{[^}]*height:0;[^}]*min-height:0;[^}]*flex:1 1 0/,
  'valid result details must use their available space and scroll when needed')
assert.doesNotMatch(wxss, /\.result-details-scroll\{[^}]*height:150px/,
  'valid result details must not keep a fixed 150px viewport')
assert.match(wxss, /\.result-primary\{[^}]*align-items:center;[^}]*padding:0 54px 0 6px/,
  'primary result must align with the facts while keeping clear of the action rail')
assert.match(wxss, /\.result-heading\{[^}]*padding-right:52px/,
  'the heading must reserve a safe gutter beside the vertical action rail')
assert.match(wxss, /\.result-fact-value\{[^}]*font-size:18px/,
  'secondary values must remain readable')
assert.match(wxss, /\.result-fact-value\{font-size:16px\}/,
  'short-screen primary metric values must stay at least 16px')
assert.match(wxss, /\.editor-group\{[^}]*min-height:0;/,
  'input groups must not force a full-viewport minimum height')
assert.match(wxml, /\{\{result\.fullPowerInputVoltage\}\} V/,
  'the full-power input voltage must remain visible in the result facts')
assert.match(wxml, /\{\{result\.fullPowerInputDbu\}\} dBu/,
  'the full-power input dBu value must remain visible in the result facts')
assert.match(wxml, /class="calibration-standard">0 dBFS = \+18\.4 dBu/,
  'the calibration reference must sit beside the DSP target heading')
assert.doesNotMatch(wxml, /目标峰值保留相应的数字输出余量/,
  'the calibration section must not add a redundant helper line below the target rows')
assert.match(wxml, /class="amplifier-summary"[^>]*\{\{selectedAmplifier\.model\}\}/,
  'the selected amplifier model must be visible beside the input heading')
assert.match(wxss, /\.amplifier-summary\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis/,
  'the compact amplifier summary must truncate without replacing the full field value')
const detailScrollStart = wxml.indexOf('<scroll-view class="result-details-scroll"')
const detailContentStart = wxml.indexOf('<view class="result-details-content">', detailScrollStart)
const resultFactsStart = wxml.indexOf('<view class="result-facts">', detailContentStart)
const placementWarningStart = wxml.indexOf('class="placement-warning amplifier-setting"', resultFactsStart)
const detailScrollEnd = wxml.indexOf('</scroll-view>', detailScrollStart)
assert(detailScrollStart >= 0 && detailContentStart > detailScrollStart
  && resultFactsStart > detailContentStart && placementWarningStart > resultFactsStart
  && detailScrollEnd > placementWarningStart,
'facts and persistent placement warning must stay together in the content-sized details group')
assert.match(wxml, /class="result-heading"[\s\S]*?class="reset-error"[^>]*role="alert"[\s\S]*?class="result-primary"/,
  'storage/reset failure alerts must remain visible before the primary result and details')
assert(wxml.indexOf('class="reset-error"') < detailScrollStart,
  'reset storage errors must stay outside the details scroller')
assert.match(wxss, /\.reset-error\{[^}]*padding-right:52px/,
  'reset storage errors must stay clear of the vertical action rail')
assert.doesNotMatch(wxml, /class="editor-caption"/,
  'the redundant device-manual caption must be removed')
assert.match(wxss, /\.action-button\.action-button\[disabled\]\{[^}]*opacity:1/,
  'dark disabled actions must retain a visible border instead of fading away')
assert.match(wxss, /\.action-button\.action-button\[aria-pressed="true"\]/,
  'the selected favorite action must have a persistent pressed state')
assert.match(wxss, /\.action-button\.action-button:active\{[^}]*background:#294a66/,
  'the pressed interaction state must remain distinguishable from favorite selection')
assert.doesNotMatch(wxss, /\.page-root\{height:auto;overflow-y:auto\}/,
  'short screens must not become whole-page scrolling layouts')
assert.match(pageSource, /onTargetPeakTap\(event\)[\s\S]*?setSelectionAndCalculate\('targetPeakIndex', index\)/,
  'target peak changes must keep automatic recalculation')
const autoUpdate = makePage({
  amplifierModel: 'TC-X2200B',
  stageValue: 1,
  mode: 'stereo',
  loadImpedance: null,
  targetPeakDbfs: -6,
})
assert.strictEqual(autoUpdate.onTargetPeakTap({ currentTarget: { dataset: { index: 2 } } }), true)
assert.strictEqual(autoUpdate.data.hasValidResult, true)
assert.strictEqual(autoUpdate.data.result.targetPeakDbfs, -9,
  'target tap must recalculate a valid result immediately')
assert.strictEqual(storedPreferences.targetPeakDbfs, -9,
  'automatic target selection must preserve preference writes')

console.log('Gain report, layout, and auto-update regressions passed.')

if (previousWx === undefined) delete global.wx
else global.wx = previousWx

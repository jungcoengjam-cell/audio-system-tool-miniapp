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
  assert(payload.resultNature, 'canonical result nature must survive generic line cleanup')
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
  '结果边界',
  '后续步骤',
  '现场响度',
  '现场复核',
]) assertIncludesIgnoringWhitespace(attenuation.text, expected, expected)
assertIncludesIgnoringWhitespace(attenuation.text, attenuation.payload.trustLabel, 'source trust label')
assertIncludesIgnoringWhitespace(attenuation.text, attenuation.payload.trustDescription, 'source trust description')
assertIncludesIgnoringWhitespace(attenuation.text, attenuation.payload.resultNature, 'canonical result nature')
for (const [label, value] of [
  ['generatedAt', attenuation.payload.generatedAt],
  ['appVersion', attenuation.payload.appVersion],
  ['productDataDate', attenuation.payload.productDataDate],
]) assertIncludesIgnoringWhitespace(attenuation.text, value, `${label} traceability value`)
for (const label of ['生成时间：', '小程序版本：', '产品资料日期：']) {
  assertIncludesIgnoringWhitespace(attenuation.text, label, `${label} traceability label`)
}
assert(attenuation.payload.summary.includes('10.19'), 'canonical record summary must remain unchanged')
assert(!attenuation.text.replace(/\s/g, '').includes(attenuation.payload.summary.replace(/\s/g, '')),
  'the card should not repeat the summary when its numbers are already in the hero and metrics')
assert(attenuation.drawnLines.findIndex((line) => line.includes('衰减执行位置'))
  < attenuation.drawnLines.findIndex((line) => line.includes('结果性质与计算依据')),
'execution guidance must precede the source/trust block')
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
assert.match(wxss, /\.choice-grid-targets\{display:flex;[^}]*gap:7rpx/,
  'target option cards must use explicit native-compatible flex spacing')
assert.match(wxss, /\.choice-grid-targets \.choice-card\{[^}]*width:0;min-width:0;flex:1 1 0/,
  'target options must have equal shrink-safe cell widths')
assert.match(wxss, /\.choice-grid-targets \.choice-label,\.choice-grid-targets \.choice-description\{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/,
  'target labels and descriptions must wrap inside their own touch cells')
assert.doesNotMatch(wxss, /\.result-facts\{flex-direction:column/,
  'secondary result facts should remain side by side at short heights when they fit')
assert.match(wxss, /\.result-primary\{[^}]*align-items:center;[^}]*padding:0 52px/,
  'primary result must center within safe space beside the action rail')
assert.match(wxss, /\.result-heading\{[^}]*padding-right:0/,
  'the heading must not reserve a second full-width action rail')
assert.match(wxss, /\.result-fact-value\{[^}]*font-size:16px/,
  'secondary values must remain readable')
assert.match(wxss, /\.editor-group\{min-height:0\}/,
  'input groups must not force a full-viewport minimum height')
assert.match(wxml, /<scroll-view class="result-details-scroll"[^>]*scroll-y[\s\S]*?<\/scroll-view>\s*<view class="[^"]*\bplacement-warning\b[^"]*"/,
  'metrics may scroll independently while the persistent placement warning stays outside the scroller')
assert.match(wxml, /class="result-heading"[\s\S]*?class="reset-error"[^>]*role="alert"[\s\S]*?class="result-primary"/,
  'storage/reset failure alerts must remain visible before the primary result and details')
assert.match(wxss, /\.input-pane\{flex:0 0 calc\(236px \+ env\(safe-area-inset-bottom\)\)/,
  'the editor pane must keep an independently sized compact profile')
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

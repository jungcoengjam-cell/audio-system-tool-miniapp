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
    fillStyle: '',
    drawnText: [],
    cardRects: [],
    strokedLines: [],
    pathPoints: [],
    pathHasCurve: false,
    measureText(value) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || 16)
      const width = [...String(value)].reduce((total, character) => {
        if (/\s/.test(character)) return total + (size * 0.28)
        return total + (size * (character.codePointAt(0) < 128 ? 0.56 : 1))
      }, 0)
      return { width }
    },
    setFillStyle(value) { this.fillStyle = value },
    setStrokeStyle() {},
    setLineWidth() {},
    setTextAlign(value) { this.align = value },
    beginPath() { this.pathPoints = []; this.pathHasCurve = false },
    moveTo(x, y) { this.pathPoints.push({ x, y }) },
    lineTo(x, y) { this.pathPoints.push({ x, y }) },
    quadraticCurveTo(controlX, controlY, x, y) {
      this.pathHasCurve = true
      this.pathPoints.push({ x: controlX, y: controlY }, { x, y })
    },
    closePath() {},
    stroke() {
      if (!this.pathHasCurve && this.pathPoints.length === 2) {
        this.strokedLines.push(this.pathPoints.map((point) => ({ ...point })))
      }
    },
    fill() {
      if (!this.pathPoints.length) return
      const xs = this.pathPoints.map((point) => point.x)
      const ys = this.pathPoints.map((point) => point.y)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      this.cardRects.push({
        x, y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
        fill: this.fillStyle,
      })
    },
    fillRect() {},
    fillText(value, x, y) {
      this.drawnText.push({
        text: String(value), x, y, align: this.align,
        width: this.measureText(value).width,
        size: Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || 16),
        weight: Number(/^(\d+)\s/.exec(this.font)?.[1] || 400),
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
    drawnItems: context.drawnText.map((item) => ({ ...item })),
    cardRects: context.cardRects.map((rect) => ({ ...rect })),
    strokedLines: context.strokedLines.map((line) => line.map((point) => ({ ...point }))),
  }
}

function getItemBounds(item) {
  const left = item.align === 'center' ? item.x - (item.width / 2)
    : item.align === 'right' ? item.x - item.width : item.x
  return { left, right: left + item.width, top: item.y - item.size }
}

function itemsWithinCard(report, card) {
  return report.drawnItems.filter((item) => {
    const bounds = getItemBounds(item)
    return bounds.top >= card.y - 1 && bounds.top < card.y + card.height
      && bounds.left >= card.x - 1 && bounds.right <= card.x + card.width + 1
  })
}

function assertTextInsideCard(item, card, lineHeight, horizontalPadding, label) {
  const bounds = getItemBounds(item)
  assert.strictEqual(item.align, 'center', label + ' must be center aligned')
  assert(Math.abs(item.x - (card.x + (card.width / 2))) < 0.01, label + ' must use its own card center')
  assert(bounds.left >= card.x + horizontalPadding - 1, label + ' must fit the left card padding')
  assert(bounds.right <= card.x + card.width - horizontalPadding + 1, label + ' must fit the right card padding')
  assert(bounds.top >= card.y - 1 && bounds.top + lineHeight <= card.y + card.height + 1, label + ' line box must fit the card')
}

function findReportCard(report, predicate, label) {
  const card = report.cardRects.find(predicate)
  assert(card, label + ' card must be drawn')
  return card
}

function assertGainReportLayout(report) {
  const badge = findReportCard(report, (card) => card.width === 260 && card.fill === '#eef6ff', 'module badge')
  const badgeItems = itemsWithinCard(report, badge)
  assert(badgeItems.length > 0, 'module badge must include its title')
  badgeItems.forEach((item) => assertTextInsideCard(item, badge, 32, 16, 'module title'))
  const badgeFirstTop = Math.min(...badgeItems.map((item) => getItemBounds(item).top))
  const badgeLastBottom = Math.max(...badgeItems.map((item) => getItemBounds(item).top + 32))
  assert(Math.abs((badgeFirstTop - badge.y) - (badge.y + badge.height - badgeLastBottom)) <= 1, 'module title block must be vertically centered')

  const metricCards = report.cardRects.filter((card) => card.width === 325 && card.fill === '#eef6ff').sort((a, b) => a.x - b.x)
  assert.strictEqual(metricCards.length, 2, 'both metric cards must remain distinct')
  const metricCenters = metricCards.map((card) => card.x + (card.width / 2))
  assert(Math.abs(metricCenters[0] - 206.5) < 0.01 && Math.abs(metricCenters[1] - 543.5) < 0.01, 'metric cards must keep separate centers')
  assert(metricCards[0].height === metricCards[1].height, 'metric cards must share one measured height')
  metricCards.forEach((card, index) => {
    const items = itemsWithinCard(report, card)
    assert(items.length > 0, 'metric ' + (index + 1) + ' must include its label and value')
    items.forEach((item) => assertTextInsideCard(item, card, item.size === 24 ? 32 : 40, 18, 'metric text'))
    const firstTop = Math.min(...items.map((item) => getItemBounds(item).top))
    const lastBottom = Math.max(...items.map((item) => getItemBounds(item).top + (item.size === 24 ? 32 : 40)))
    assert(Math.abs((firstTop - card.y) - (card.y + card.height - lastBottom)) <= 1, 'metric content must be vertically centered')
  })

  const wideCards = report.cardRects.filter((card) => card.width === 662).sort((a, b) => a.y - b.y)
  assert(wideCards.length >= 2, 'hero and execution cards must be present')
  const heroItems = itemsWithinCard(report, wideCards[0])
  assert(heroItems.length > 0, 'hero card must include its adjustment')
  heroItems.forEach((item) => assertTextInsideCard(item, wideCards[0], item.size === 23 ? 32 : 84, 26, 'hero text'))

  const execution = findReportCard(report, (card) => card.width === 662 && card.fill === '#ffffff', 'execution')
  const executionItems = itemsWithinCard(report, execution)
  assert(executionItems.length >= 8, 'execution card must retain four label/value groups')
  executionItems.forEach((item) => {
    assert.strictEqual(item.size, 26, 'execution headings must be at least as large as values')
    assert(item.weight === 650 || item.weight === 500, 'execution label/value weight hierarchy must remain clear')
    assertTextInsideCard(item, execution, item.weight === 650 ? 34 : 36, 24, 'execution text')
  })
  const executionLabels = executionItems.filter((item) => item.weight === 650)
  const executionValues = executionItems.filter((item) => item.weight === 500)
  assert.strictEqual(executionLabels.length, 4, 'execution card must show four centered subheadings')
  assert(executionValues.length >= 4, 'each execution heading must have visible content')
  const firstExecutionTop = getItemBounds(executionItems[0]).top
  const lastExecutionItem = executionItems[executionItems.length - 1]
  const lastExecutionBottom = getItemBounds(lastExecutionItem).top + 36
  assert(Math.abs(firstExecutionTop - execution.y - 14) <= 1 && Math.abs(execution.y + execution.height - lastExecutionBottom - 14) <= 1, 'execution groups must keep balanced vertical padding')

  const sectionTitles = report.drawnItems.filter((item) => item.size === 32)
  assert(sectionTitles.length > 0, 'execution section title must remain visible')
  sectionTitles.forEach((item) => {
    const bounds = getItemBounds(item)
    assert.strictEqual(item.align, 'center', 'section title must be centered')
    assert(Math.abs(item.x - 375) < 0.01 && bounds.left >= 43 && bounds.right <= 707, 'section title must fit the content bounds')
  })

  const warning = report.cardRects.find((card) => card.width === 662 && card.fill === '#fff4e5' && card.y > execution.y + execution.height)
  if (warning) {
    const warningItems = itemsWithinCard(report, warning)
    assert(warningItems.length > 0, 'warning card must include its message')
    warningItems.forEach((item) => assertTextInsideCard(item, warning, 34, 20, 'warning text'))
    const firstTop = Math.min(...warningItems.map((item) => getItemBounds(item).top))
    const lastBottom = Math.max(...warningItems.map((item) => getItemBounds(item).top + 34))
    assert(Math.abs(firstTop - warning.y - 20) <= 1 && Math.abs(warning.y + warning.height - lastBottom - 20) <= 1, 'warning text must have balanced vertical padding')
  }
  const lastCardBottom = Math.max(...report.cardRects.map((card) => card.y + card.height))
  assert.strictEqual(report.height - lastCardBottom, 20, 'canvas must end 20px after its last actual card')
  assert(!report.strokedLines.some(([start, end]) => Math.abs(start.x - 44) < 0.01 && Math.abs(end.x - 706) < 0.01 && Math.abs(start.y - end.y) < 0.01), 'traceability footer divider must be absent')
}

function replacePayloadField(payload, label, value) {
  let replaced = false
  const lines = payload.lines.map((line) => {
    const colon = line.indexOf('\uff1a')
    if (colon >= 0 && line.slice(0, colon) === label) {
      replaced = true
      return line.slice(0, colon + 1) + value
    }
    return line
  })
  assert(replaced, 'long-layout fixture must replace a canonical execution field')
  return { ...payload, lines }
}

function assertIncludesIgnoringWhitespace(text, value, label) {
  const normalize = (input) => String(input).replace(/\s/g, '')
  assert(normalize(text).includes(normalize(value)), label + ' must be visible in report text')
}
const attenuation = renderPageReport(makePage({
  amplifierModel: 'TC-X2200B',
  stageValue: 1,
  mode: 'stereo',
  loadImpedance: null,
  targetPeakDbfs: -6,
}))
assertGainReportLayout(attenuation)
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
for (const key of ['generatedAt', 'appVersion', 'productDataDate']) {
  assert(attenuation.payload[key], 'canonical ' + key + ' metadata must remain in the payload')
  assert(!attenuation.text.includes(String(attenuation.payload[key])), 'share image must omit ' + key + ' while retaining source metadata')
}
const expandedMetadataPayload = { ...attenuation.payload, generatedAt: 'generated metadata '.repeat(100), appVersion: 'version metadata '.repeat(100), productDataDate: 'product data metadata '.repeat(100) }
const expandedMetadataHeight = calculateResultReportHeight(expandedMetadataPayload, makeMeasureContext())
assert.strictEqual(expandedMetadataHeight, attenuation.height, 'traceability metadata must not reserve image height')
const expandedMetadataContext = makeMeasureContext()
drawResultReport(expandedMetadataContext, expandedMetadataPayload, expandedMetadataHeight)
assert.deepStrictEqual(expandedMetadataContext.drawnText, attenuation.drawnItems, 'traceability metadata must not change visible commands')
assert.deepStrictEqual(expandedMetadataContext.cardRects, attenuation.cardRects, 'traceability metadata must not change card geometry')
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
assert(!attenuation.text.includes('设备、模式与校准条件'),
  'the share report must omit the condition section heading')
const conditionSourceLabels = ['功放', '输入级档位', '工作条件', 'DSP 标定']
for (const label of conditionSourceLabels) {
  const sourceLine = attenuation.payload.lines.find((line) => line.startsWith(`${label}：`))
  assert(sourceLine, `the canonical payload must retain ${label}`)
  assert(attenuation.record.resultText.includes(sourceLine),
    `the canonical record must retain ${label}`)
}
for (const label of ['功放型号', '输入级位置', '工作模式与负载', 'DSP 校准基准']) {
  assert(!attenuation.drawnLines.some((line) => line.includes(label)),
    `the share report must omit the ${label} condition row`)
}
const expandedConditionsPayload = {
  ...attenuation.payload,
  lines: attenuation.payload.lines.map((line) => {
    const label = line.slice(0, line.indexOf('：'))
    return conditionSourceLabels.includes(label)
      ? `${label}：${'长条件信息用于高度回归'.repeat(80)}`
      : line
  }),
}
const expandedConditionsHeight = calculateResultReportHeight(
  expandedConditionsPayload, makeMeasureContext())
assert.strictEqual(expandedConditionsHeight, attenuation.height,
  'omitted condition text must not reserve report height')
const expandedConditionsContext = makeMeasureContext()
drawResultReport(expandedConditionsContext, expandedConditionsPayload, expandedConditionsHeight)
assert.deepStrictEqual(expandedConditionsContext.drawnText, attenuation.drawnItems,
  'omitted condition text must not change the report drawing')
assert(!attenuation.text.includes('系统无需增加衰减'),
  'attenuation report must not imply zero attenuation when a nonzero canonical value exists')

const drive = renderPageReport(makePage({
  amplifierModel: 'TC-22000',
  stageValue: 33,
  mode: 'bridge',
  loadImpedance: 8,
  targetPeakDbfs: -3,
}))
assertGainReportLayout(drive)
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

const placementLabels = [
  '\u8870\u51cf\u6267\u884c\u4f4d\u7f6e',
  'DSP \u8f93\u5165\u8868\u76ee\u6807',
  'DSP \u6700\u7ec8\u8f93\u51fa\u589e\u76ca',
  '\u529f\u653e\u8f93\u5165\u7535\u5e73\u63a7\u5236',
]
let longLayoutPayload = { ...attenuation.payload, moduleLabel: '\u589e\u76ca\u7ed3\u6784'.repeat(8) }
placementLabels.forEach((label, index) => {
  const suffix = index === 1 ? ' -6 dBFS = 12.4 dBu' : ' 1.23 dB'
  const value = '\u8d85\u957f\u6267\u884c\u4f4d\u7f6e\u5185\u5bb9'.repeat(12) + suffix
  longLayoutPayload = replacePayloadField(longLayoutPayload, label, value)
})
const warningLineIndex = longLayoutPayload.lines.findIndex((line) => line.includes('DSP') && line.includes('\u8870\u51cf'))
assert(warningLineIndex >= 0, 'long-layout fixture must retain its warning message')
longLayoutPayload.lines[warningLineIndex] = 'DSP \u8870\u51cf \u529f\u653e ' + '\u8d85\u957f\u8b66\u544a\u5e03\u5c40'.repeat(36)
const longReportContext = makeMeasureContext()
const longReportHeight = calculateResultReportHeight(longLayoutPayload, longReportContext)
assert(longReportHeight > 0 && longReportHeight < 4096, 'long wrapped layout must remain bounded')
drawResultReport(longReportContext, longLayoutPayload, longReportHeight)
const longLayoutReport = { ...attenuation, height: longReportHeight, drawnItems: longReportContext.drawnText.map((item) => ({ ...item })), drawnLines: longReportContext.drawnText.map((item) => item.text), cardRects: longReportContext.cardRects.map((rect) => ({ ...rect })), strokedLines: longReportContext.strokedLines.map((line) => line.map((point) => ({ ...point }))) }
assertGainReportLayout(longLayoutReport)
const longBadge = findReportCard(longLayoutReport, (card) => card.width === 260 && card.fill === '#eef6ff', 'wrapped module badge')
assert(itemsWithinCard(longLayoutReport, longBadge).length > 1, 'module title must wrap inside its badge')
const longExecution = findReportCard(longLayoutReport, (card) => card.width === 662 && card.fill === '#ffffff', 'long execution')
const longWarning = longLayoutReport.cardRects.find((card) => card.width === 662 && card.fill === '#fff4e5' && card.y > longExecution.y + longExecution.height)
assert(longWarning && itemsWithinCard(longLayoutReport, longWarning).length > 1, 'long warning text must wrap inside its card')
assert(longReportContext.drawnText.some((item) => /-6\s+dBFS/.test(item.text)) && longReportContext.drawnText.some((item) => /12\.4\s+dBu/.test(item.text)), 'wrapped execution values must keep numbers joined to units')

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
assertGainReportLayout(zeroEdge)

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
assert.match(wxml, /class="choice-grid choice-grid-modes"[\s\S]*?<view wx:for="\{\{modes\}\}" wx:key="value" class="mode-choice-cell[\s\S]*?<button class="choice-card mode-choice-card[^"]*" aria-pressed="\{\{index === modeIndex\}\}" data-index="\{\{index\}\}" bindtap="onModeTap"/,
  'mode choices must preserve their native button bindings inside wrapper cells')
assert.match(wxss, /\.choice-grid-modes\{display:flex;[^}]*flex-wrap:wrap/,
  'mode options must wrap in the native renderer')
assert.match(wxss, /\.choice-grid-modes \.mode-choice-cell\{[^}]*flex:0 0 50%;[^}]*padding:0 4px 8px/,
  'mode option cells must keep bounded half-width columns and spacing')
assert.match(wxss, /\.choice-grid-modes \.mode-choice-card\.mode-choice-card\{[^}]*width:100%;[^}]*max-width:100%;[^}]*min-width:0;[^}]*min-height:56px/,
  'mode buttons must fill their wrapped cells with native-safe dimensions')
assert.match(wxss, /\.choice-grid-modes \.mode-choice-card \.choice-label\{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/,
  'mode labels must wrap safely within their own buttons')
assert.match(wxml, /<picker class="field-picker-load"[^>]*range="\{\{loadOptions\}\}"/,
  'load impedance must remain the native picker backed by current options')
assert.match(wxss, /\.field-picker-load\{[^}]*width:100%;[^}]*min-width:0/,
  'the native load picker must fill its bounded row')
assert.match(wxss, /\.field-value-load\{[^}]*min-width:0;[^}]*flex:1 1 0;[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/,
  'the selected load value must wrap before the fixed picker arrow')
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
assert.match(wxss, /\.result-pane\{position:relative;[^}]*flex:0 0 340px/,
  'the result pane must use a bounded normal-height profile')
assert.match(wxss, /\.result-heading\{[^}]*flex:0 0 20px;[^}]*min-height:20px/,
  'the result status line must stay compact enough to preserve the hero and detail space')
assert.match(wxss, /\.result-primary\{[^}]*flex:0 0 136px/,
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

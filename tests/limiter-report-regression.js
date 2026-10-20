'use strict'

const assert = require('assert/strict')
const path = require('path')

const root = path.resolve(__dirname, '..')
const preferenceKey = 'audioTool.limiter.preferences'
const metadata = {
  generatedAt: '2026-10-08 12:00',
  appVersion: 'test-only',
  productDataDate: 'test-only',
}
const basePreferences = {
  amplifierModel: 'TC-2350B',
  speakerModel: 'TS-803C',
  count: 1,
  wiring: 'parallel',
  mode: 'stereo',
  sensitivityVoltage: 1,
  highPassFrequency: 80,
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function makeCanvasContext() {
  return {
    font: '400 16px sans-serif',
    align: 'left',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    pathPoints: [],
    pathHasCurve: false,
    drawnText: [],
    cardRects: [],
    strokeRects: [],
    strokedLines: [],
    backgroundRects: [],
    measureText(value) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || 16)
      const width = [...String(value)].reduce((total, character) => {
        if (/\s/.test(character)) return total + (size * 0.28)
        return total + (size * (/^[\x00-\xff]$/.test(character) ? 0.56 : 1))
      }, 0)
      return { width }
    },
    setFillStyle(value) { this.fillStyle = value },
    setStrokeStyle(value) { this.strokeStyle = value },
    setLineWidth(value) { this.lineWidth = value },
    setTextAlign(value) { this.align = value },
    beginPath() {
      this.pathPoints = []
      this.pathHasCurve = false
    },
    moveTo(x, y) { this.pathPoints.push({ x, y }) },
    lineTo(x, y) { this.pathPoints.push({ x, y }) },
    quadraticCurveTo(controlX, controlY, x, y) {
      this.pathHasCurve = true
      this.pathPoints.push({ x: controlX, y: controlY }, { x, y })
    },
    closePath() {},
    fill() {
      if (!this.pathHasCurve || !this.pathPoints.length) return
      const xs = this.pathPoints.map((point) => point.x)
      const ys = this.pathPoints.map((point) => point.y)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      this.cardRects.push({
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
        fill: this.fillStyle,
      })
    },
    stroke() {
      if (!this.pathPoints.length) return
      if (this.pathHasCurve) {
        const xs = this.pathPoints.map((point) => point.x)
        const ys = this.pathPoints.map((point) => point.y)
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        this.strokeRects.push({
          x,
          y,
          width: Math.max(...xs) - x,
          height: Math.max(...ys) - y,
          color: this.strokeStyle,
          lineWidth: this.lineWidth,
        })
      } else if (this.pathPoints.length === 2) {
        this.strokedLines.push(this.pathPoints.map((point) => ({ ...point })))
      }
    },
    fillRect(x, y, width, height) {
      this.backgroundRects.push({ x, y, width, height, fill: this.fillStyle })
    },
    fillText(value, x, y) {
      this.drawnText.push({
        text: String(value),
        x,
        y,
        align: this.align,
        width: this.measureText(value).width,
        size: Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || 16),
        weight: Number(/^(\d+)\s/.exec(this.font)?.[1] || 400),
        color: this.fillStyle,
      })
    },
  }
}

function makePageContext(preferences) {
  const previous = { Page: global.Page, wx: global.wx }
  const storage = new Map([[preferenceKey, clone(preferences)]])
  const writes = []
  let definition
  const wx = {
    getStorageSync(key) { return clone(storage.get(key)) },
    setStorageSync(key, value) {
      writes.push(key)
      storage.set(key, clone(value))
    },
    removeStorageSync(key) {
      writes.push(key)
      storage.delete(key)
    },
    getStorageInfoSync() { return { currentSize: 1, limitSize: 10240 } },
    getSystemInfoSync() { return { theme: 'light', windowWidth: 390, windowHeight: 844, pixelRatio: 3 } },
    canIUse() { return false },
    vibrateShort() {},
    showToast() {},
    showModal() {},
  }

  global.wx = wx
  global.Page = (value) => { definition = value }
  for (const relative of [
    '../pages/limiter/limiter.js',
    '../utils/preferences.js',
    '../utils/records.js',
  ]) {
    const absolute = path.resolve(__dirname, relative)
    delete require.cache[require.resolve(absolute)]
  }
  const pagePath = path.join(root, 'pages/limiter/limiter.js')
  require(pagePath)
  global.Page = previous.Page

  const page = Object.assign({}, definition, {
    data: clone(definition.data),
    setData(changes, callback) {
      Object.assign(this.data, changes)
      if (typeof callback === 'function') callback()
    },
  })
  page.onLoad()

  return {
    page,
    storage,
    writes,
    close() {
      try {
        if (!page._isUnloaded) page.onUnload()
      } finally {
        global.Page = previous.Page
        global.wx = previous.wx
      }
    },
  }
}

const { buildResultReportPayload } = require('../utils/result-report')
const {
  calculateResultReportHeight,
  drawResultReport,
} = require('../pages/limiter/limiter-report')
const gainReport = require('../pages/gain-structure/gain-report')

function renderPayload(payload) {
  const before = clone(payload)
  const context = makeCanvasContext()
  const height = calculateResultReportHeight(payload, context)
  assert.equal(height, calculateResultReportHeight(payload, context),
    'height calculation must remain deterministic')
  assert(height > 0 && height < 4096, 'measured report height must stay within export limits')
  drawResultReport(context, payload, height)
  assert.deepEqual(payload, before, 'drawing must not mutate the canonical report DTO')
  return { payload, height, context }
}

function makeControllerReport(pageContext) {
  const { page, storage, writes } = pageContext
  assert.equal(page.data.calculationState, 'valid', 'controller fixture must have valid inputs')
  assert.equal(page.data.hasValidResult, true, 'controller fixture must have a valid result')
  const canonical = clone(page.getRecordPayload())
  const preferences = clone(page.getPreferences())
  const reportRecord = page.buildResultReportRecord()
  assert(reportRecord && reportRecord.resultText, 'controller must build a report record')
  assert(reportRecord.resultText.startsWith(canonical.resultText + '\n'),
    'report-only inputs must append to the canonical result without changing it')
  const payload = buildResultReportPayload(reportRecord, metadata)
  assert(payload && Array.isArray(payload.lines), 'controller output must form a result DTO')
  const recordBefore = clone(reportRecord)
  const storageBefore = clone([...storage.entries()])
  const writesBefore = writes.slice()
  const report = renderPayload(payload)

  assert.deepEqual(page.getRecordPayload(), canonical,
    'rendering must leave the controller canonical record unchanged')
  assert.deepEqual(page.getPreferences(), preferences,
    'rendering must leave canonical preferences unchanged')
  assert.deepEqual(reportRecord, recordBefore,
    'rendering must leave the controller report record unchanged')
  assert.deepEqual([...storage.entries()], storageBefore,
    'rendering must not change the isolated preference store')
  assert.deepEqual(writes, writesBefore,
    'rendering must not write preferences')
  return { canonical, preferences, reportRecord, payload, report }
}

function allText(report) {
  return report.context.drawnText.map((item) => item.text).join('\n')
}

function normalize(value) {
  return String(value).replace(/\s/g, '')
}

function textBounds(item) {
  const left = item.align === 'center' ? item.x - (item.width / 2)
    : item.align === 'right' ? item.x - item.width : item.x
  return { left, right: left + item.width, top: item.y - item.size, bottom: item.y }
}

function findCard(report, predicate, label) {
  const card = report.context.cardRects.find(predicate)
  assert(card, label + ' card must be drawn')
  return card
}

function itemsInCard(report, card) {
  return report.context.drawnText.filter((item) => {
    const bounds = textBounds(item)
    return bounds.top >= card.y - 1 && bounds.top < card.y + card.height
      && bounds.left >= card.x - 1 && bounds.right <= card.x + card.width + 1
  })
}

function matchingStroke(report, card, color) {
  return report.context.strokeRects.find((stroke) => (
    stroke.color === color
    && Math.abs(stroke.x - card.x) < 0.01
    && Math.abs(stroke.y - card.y) < 0.01
    && Math.abs(stroke.width - card.width) < 0.01
    && Math.abs(stroke.height - card.height) < 0.01
  ))
}

function assertNoCardOverlap(report) {
  const cards = report.context.cardRects
  cards.forEach((left, leftIndex) => {
    cards.slice(leftIndex + 1).forEach((right) => {
      const horizontalOverlap = Math.min(left.x + left.width, right.x + right.width)
        - Math.max(left.x, right.x)
      const verticalOverlap = Math.min(left.y + left.height, right.y + right.height)
        - Math.max(left.y, right.y)
      assert(!(horizontalOverlap > 0.5 && verticalOverlap > 0.5),
        'report cards must not overlap: ' + JSON.stringify({ left, right }))
    })
  })
}

function assertReportBounds(report) {
  const { height, context } = report
  for (const item of context.drawnText) {
    const bounds = textBounds(item)
    assert(bounds.left >= -1 && bounds.right <= 751,
      'text must stay inside the 750px canvas: ' + item.text)
    assert(bounds.top >= 0 && item.y <= height,
      'text must stay inside the measured canvas height: ' + item.text)
  }
  for (const card of context.cardRects) {
    assert(card.x >= 0 && card.y >= 0 && card.x + card.width <= 750,
      'cards must stay inside the canvas width')
    assert(card.y + card.height <= height,
      'cards must stay inside the measured canvas height')
  }
  assertNoCardOverlap(report)
  const lastCardBottom = Math.max(...context.cardRects.map((card) => card.y + card.height))
  assert.equal(height - lastCardBottom, 20,
    'report height must end 20px after the last visible card')
}

function assertInputCard(report) {
  const inputCard = report.context.cardRects.find((card) => (
    card.width === 662 && card.fill === '#ffffff'
      && itemsInCard(report, card).some((item) => item.text.includes('功放型号'))
  ))
  assert(inputCard, 'white input card must be drawn')
  assert(matchingStroke(report, inputCard, '#e5e5ea'),
    'white input card must have the Gain-style border')
  const items = itemsInCard(report, inputCard)
  const labels = items.filter((item) => item.size === 26 && item.weight === 650 && item.x === 68)
  const values = items.filter((item) => item.size === 26 && item.weight === 500 && item.x === 312)
  assert.equal(labels.length, 7, 'all seven Limiter inputs must be retained in the label column')
  assert.equal(values.length, 7, 'all seven Limiter input values must be retained')
  assert.deepEqual(labels.map((item) => textBounds(item).top),
    values.map((item) => textBounds(item).top),
    'input labels and values must share each row first baseline')
  for (const item of labels) {
    const bounds = textBounds(item)
    assert(item.color === '#6e6e73', 'input labels must use the secondary text color')
    assert(bounds.left >= 68 - 1 && bounds.right <= 296 + 1,
      'input labels must remain within the 228px label column')
  }
  for (const item of values) {
    const bounds = textBounds(item)
    assert(item.color === '#1d1d1f', 'input values must use the primary text color')
    assert(bounds.left >= 312 - 1 && bounds.right <= 682 + 1,
      'input values must remain within the 370px value column')
  }
  const title = report.context.drawnText.find((item) => item.text === '输入参数')
  assert(title, 'input section title must be visible')
  assert.equal(title.x, 44)
  assert.equal(title.size, 32)
  assert.equal(title.weight, 650)
  return inputCard
}

function assertLimiterMatchesGain(report, gainReference) {
  const badge = findCard(report, (card) => (
    card.x === 44 && card.y === 32 && card.width === 260
      && card.height === 52 && card.fill === '#eef6ff'
  ), 'module capsule')
  assert(matchingStroke(report, badge, '#d6e5f4'))
  const badgeText = report.context.drawnText.find((item) => item.text === '限幅器')
  const gainBadgeText = gainReference.context.drawnText.find((item) => (
    item.text === '增益结构' && item.x === 60 && item.size === 24
  ))
  assert(badgeText && gainBadgeText, 'Limiter and Gain module capsules must both be visible')
  assert.equal(badgeText.x, gainBadgeText.x)
  assert.equal(badgeText.size, gainBadgeText.size)
  assert.equal(badgeText.weight, gainBadgeText.weight)
  assert.equal(badgeText.color, '#087f70')
  assert.equal(badgeText.weight, 650)

  const hero = findCard(report, (card) => (
    card.width === 662 && card.fill === '#eaf7f5'
  ), 'mint hero')
  assert(matchingStroke(report, hero, '#c5e5de'))
  const gainHero = findCard(gainReference, (card) => (
    card.width === 662 && card.fill === '#eaf7f5'
  ), 'Gain mint hero')
  const heroItems = itemsInCard(report, hero)
  const gainHeroItems = itemsInCard(gainReference, gainHero)
  const limiterHeroLabel = heroItems.find((item) => item.size === 23)
  const gainHeroLabel = gainHeroItems.find((item) => item.size === 23)
  const limiterHeroValue = heroItems.find((item) => item.size === 72)
  const gainHeroValue = gainHeroItems.find((item) => item.size === 72)
  assert(limiterHeroLabel && gainHeroLabel && limiterHeroValue && gainHeroValue)
  for (const item of [limiterHeroLabel, gainHeroLabel]) {
    assert.equal(item.size, 23)
    assert.equal(item.weight, 650)
    assert.equal(item.color, '#087f70')
  }
  for (const item of [limiterHeroValue, gainHeroValue]) {
    assert.equal(item.size, 72)
    assert.equal(item.weight, 720)
    assert.equal(item.color, '#1d1d1f')
  }

  const limiterTiles = report.context.cardRects.filter((card) => (
    card.width === 325 && card.fill === '#eef6ff'
  ))
  const gainTiles = gainReference.context.cardRects.filter((card) => (
    card.width === 325 && card.fill === '#eef6ff'
  ))
  assert(limiterTiles.length >= 2 && gainTiles.length >= 2,
    'both reports must use the same two-column secondary tile grid')
  const limiterLabels = itemsInCard(report, limiterTiles[0]).filter((item) => item.size === 24)
  const gainLabels = itemsInCard(gainReference, gainTiles[0]).filter((item) => item.size === 24)
  const limiterValues = itemsInCard(report, limiterTiles[0]).filter((item) => item.size === 30)
  const gainValues = itemsInCard(gainReference, gainTiles[0]).filter((item) => item.size === 30)
  assert(limiterLabels[0] && gainLabels[0] && limiterValues[0] && gainValues[0])
  assert.equal(limiterLabels[0].size, gainLabels[0].size)
  assert.equal(limiterLabels[0].weight, gainLabels[0].weight)
  assert.equal(limiterLabels[0].color, '#6e6e73')
  assert.equal(limiterLabels[0].weight, 600)
  assert.equal(limiterValues[0].size, gainValues[0].size)
  assert.equal(limiterValues[0].weight, gainValues[0].weight)
  assert.equal(limiterValues[0].color, '#1d1d1f')
  assert.equal(limiterValues[0].weight, 650)
  assert(limiterTiles.every((card) => card.height >= 144),
    'secondary tiles must keep at least the Gain minimum height')
}

function makeGainReference() {
  const payload = {
    moduleLabel: '增益结构',
    lines: [
      '目标峰值：-6 dBFS = 12.4 dBu',
      '功放额定输出输入点：1 V = 2.21 dBu',
      '系统对齐衰减：10.19 dB',
      '衰减执行位置：DSP 最终输出',
      'DSP 输入表目标：0 dBFS',
      'DSP 最终输出增益：0 dB',
      '功放输入电平控制：0 dB',
    ],
  }
  const context = makeCanvasContext()
  const height = gainReport.calculateResultReportHeight(payload, context)
  gainReport.drawResultReport(context, payload, height)
  return { payload, height, context }
}

function extractInputLines(reportRecord, canonicalText) {
  return reportRecord.resultText.slice(canonicalText.length).split(/\r?\n/)
    .filter((line) => /^(功放型号|音箱型号|每通道音箱数量|连接方式|功放模式|功放输入灵敏度|通道 HPF)：/.test(line))
}

const basePage = makePageContext(basePreferences)
let standard
try {
  standard = makeControllerReport(basePage)
  const inputLines = extractInputLines(standard.reportRecord, standard.canonical.resultText)
  assert.equal(inputLines.length, 7, 'controller DTO must retain all seven report inputs')
  for (const line of inputLines) {
    assert(standard.payload.lines.includes(line), 'report DTO must retain ' + line)
  }
  const layout = renderPayload(standard.payload)
  const text = allText(layout)
  for (const line of inputLines) {
    const value = line.slice(line.indexOf('：') + 1).trim()
    assert(normalize(text).includes(normalize(value)),
      'every actual controller input value must be drawn: ' + line)
  }
  assert(layout.context.drawnText.some((item) => item.text === '80 Hz'),
    'numeric HPF and Hz unit must stay together on the input value line')
  assert(normalize(text).includes('0dBFS=+18.4dBu'),
    'DSP calibration must remain literal and visible')
  assert(!text.includes(standard.payload.title),
    'the product-combination title must not be repeated')
  assert(!layout.context.drawnText.some((item) => item.text === standard.payload.summary),
    'the canonical summary must not create a duplicate card')
  assert(!text.includes('状态说明') && !text.includes('结果性质')
    && !text.includes('版本 ') && !text.includes('产品资料'),
  'generic status, traceability, and source sections must remain omitted')
  for (const omitted of [
    '功放额定输出低于音箱额定承受能力，阈值按功放满功率输入限制。',
    '阈值按音箱额定功率计算。',
    '注：按说明书额定功率作理论计算，现场仍需核对接线、标定和实际电平。',
  ]) assert(!text.includes(omitted), 'legacy omitted line must stay omitted')
  assert(text.includes('总阻抗') && text.includes('音箱总额定功率'),
    'canonical total load must become its two literal secondary tiles')
  assertInputCard(layout)
  assertReportBounds(layout)
} finally {
  basePage.close()
}

const noHpfPage = makePageContext({ ...basePreferences, highPassFrequency: null })
let noHpf
try {
  noHpf = makeControllerReport(noHpfPage)
  assert.equal(noHpf.canonical.preferences.highPassFrequency, null,
    'unselected HPF must remain null in the canonical DTO')
  assert(noHpf.payload.lines.includes('通道 HPF：未选择'),
    'unselected HPF must remain literal in the report DTO')
  const report = renderPayload(noHpf.payload)
  const timeValues = report.context.drawnText.filter((item) => item.text === '— ms')
  assert.equal(timeValues.length, 2, 'missing HPF timing must display two literal — ms values')
  assert(!allText(report).includes('0 ms'), 'missing timing must never be displayed as a computed zero')
  assertInputCard(report)
  assertReportBounds(report)
} finally {
  noHpfPage.close()
}

const multiplePage = makePageContext({ ...basePreferences, count: 2, wiring: 'series' })
let multiple
try {
  multiple = makeControllerReport(multiplePage)
  assert(multiple.reportRecord.resultText.includes('每通道音箱数量：2'),
    'multi-speaker report must preserve the controller count')
  assert(multiple.reportRecord.resultText.includes('连接方式：串联'),
    'multi-speaker report must preserve its valid wiring')
  assert(allText(multiple.report).includes('串联'),
    'multi-speaker wiring must remain visible in the input card')
  assertReportBounds(multiple.report)
} finally {
  multiplePage.close()
}

const reminderPage = makePageContext({ ...basePreferences, highPassFrequency: null })
let reminder
try {
  const firstHpfIndex = reminderPage.page.data.highPassFrequencies
    .findIndex((item) => item.value === 80)
  const changedHpfIndex = reminderPage.page.data.highPassFrequencies
    .findIndex((item) => item.value === 100)
  assert(firstHpfIndex >= 0 && changedHpfIndex >= 0)
  reminderPage.page.pauseReminderForPicker()
  reminderPage.page.onPickerChange({
    currentTarget: { dataset: { field: 'highPassFrequencyIndex' } },
    detail: { value: String(firstHpfIndex) },
  })
  assert.equal(reminderPage.page.data.reminderActive, false,
    'first valid HPF selection must preserve the controller baseline behavior')
  reminderPage.page.pauseReminderForPicker()
  reminderPage.page.onPickerChange({
    currentTarget: { dataset: { field: 'highPassFrequencyIndex' } },
    detail: { value: String(changedHpfIndex) },
  })
  assert.equal(reminderPage.page.data.reminderActive, true,
    'a subsequent HPF change must activate the real advisory reminder')
  reminder = makeControllerReport(reminderPage)
  assert(reminder.payload.lines.includes('提醒：部分参数仍沿用原值，请结合现场核对。'),
    'controller must supply the real unchanged reminder copy')
  const report = renderPayload(reminder.payload)
  const warning = findCard(report, (card) => (
    card.width === 662 && card.fill === '#fff4e5'
  ), 'advisory reminder')
  assert(matchingStroke(report, warning, '#f0d4ad'))
  const warningItems = itemsInCard(report, warning)
  assert(warningItems.length > 0)
  assert(warningItems.every((item) => (
    item.size === 24 && item.weight === 600 && item.color === '#8a5700'
  )), 'reminder must use the Gain warning text style')
  assert(normalize(allText(report)).includes(
    normalize('提醒：部分参数仍沿用原值，请结合现场核对。')),
  'reminder text must remain complete and unchanged')
  const ordinaryHero = standard.report.context.cardRects.find((card) => (
    card.width === 662 && card.fill === '#eaf7f5'
  ))
  const reminderHero = report.context.cardRects.find((card) => (
    card.width === 662 && card.fill === '#eaf7f5'
  ))
  assert.deepEqual(
    [reminderHero.x, reminderHero.y, reminderHero.width, reminderHero.height],
    [ordinaryHero.x, ordinaryHero.y, ordinaryHero.width, ordinaryHero.height],
    'separate reminder card must not shift or resize the hero',
  )
  assert(warning.y >= reminderHero.y + reminderHero.height,
    'reminder card must remain outside and below the hero')
  assertInputCard(report)
  assertReportBounds(report)
} finally {
  reminderPage.close()
}

const longPage = makePageContext(basePreferences)
try {
  const actual = makeControllerReport(longPage)
  const longAmplifier = '长型号-' + 'A'.repeat(64) + '-73142.8 ms'
  const longSpeaker = '长音箱型号-' + '音箱'.repeat(22)
  const unknownLine = '未知扩展字段：现场阶段 73142.8 ms 的补充说明必须完整保留。'
  let longText = actual.reportRecord.resultText
  longText = longText.split(actual.canonical.preferences.amplifierModel).join(longAmplifier)
  longText = longText.split(actual.canonical.preferences.speakerModel).join(longSpeaker)
  longText += '\n' + unknownLine
  const longRecord = { ...actual.reportRecord, resultText: longText }
  const longPayload = buildResultReportPayload(longRecord, metadata)
  const report = renderPayload(longPayload)
  const text = normalize(allText(report))
  assert(text.includes(normalize(longAmplifier)),
    'long amplifier model must wrap without losing any characters')
  assert(text.includes(normalize(longSpeaker)),
    'long speaker model must wrap without losing any characters')
  assert(text.includes(normalize(unknownLine)),
    'unknown supplementary content and its numeric-unit token must be retained')
  assert(report.context.drawnText.some((item) => item.text.includes('73142.8 ms')),
    'numeric and ms units must stay grouped together when wrapping long text')
  const inputCard = assertInputCardLong(report, longAmplifier, longSpeaker)
  const ordinaryInputCard = standard.report.context.cardRects.find((card) => (
    card.width === 662 && card.fill === '#ffffff'
      && itemsInCard(standard.report, card).some((item) => item.text.includes('功放型号'))
  ))
  assert(inputCard.height > ordinaryInputCard.height,
    'input card height must grow with wrapped model names')
  assertReportBounds(report)
} finally {
  longPage.close()
}

function assertInputCardLong(report, longAmplifier, longSpeaker) {
  const inputCard = report.context.cardRects.find((card) => (
    card.width === 662 && card.fill === '#ffffff'
      && itemsInCard(report, card).some((item) => item.text.includes('功放型号'))
  ))
  assert(inputCard, 'long input card must be present')
  const values = itemsInCard(report, inputCard).filter((item) => (
    item.size === 26 && item.weight === 500 && item.x === 312
  ))
  assert(values.some((item) => normalize(item.text).includes(normalize(longAmplifier)))
    || values.map((item) => normalize(item.text)).join('').includes(normalize(longAmplifier)),
  'long amplifier token must stay in the value column')
  assert(values.map((item) => normalize(item.text)).join('').includes(normalize(longSpeaker)),
    'long speaker name must stay in the value column')
  for (const item of values) {
    const bounds = textBounds(item)
    assert(bounds.left >= 311 && bounds.right <= 683,
      'long values must never cross into or outside the neighboring column')
  }
  return inputCard
}

const secondaryPage = makePageContext({ ...basePreferences, highPassFrequency: null })
try {
  const actual = makeControllerReport(secondaryPage)
  const loadLine = actual.payload.lines.find((line) => line.startsWith('总负载：'))
  const loadMatch = /^总负载：(.+?)\s*Ω\s*·\s*(.+?)\s*W$/i.exec(loadLine || '')
  assert(loadMatch, 'actual canonical total-load line must carry both literal components')
  const dynamicPayload = {
    ...actual.payload,
    lines: [
      ...actual.payload.lines,
      '总阻抗：' + loadMatch[1].trim() + ' Ω',
      '总负载：约 ' + loadMatch[1].trim() + ' Ω · 合计 W',
      '未知扩展字段：' + loadMatch[1].trim() + ' Ω 保留原文。',
    ],
  }
  const report = renderPayload(dynamicPayload)
  const tiles = report.context.cardRects.filter((card) => (
    card.width === 325 && card.fill === '#eef6ff'
  ))
  assert.equal(tiles.length, 4,
    'additional supported secondary fields must not be capped to a fixed pair')
  assert(normalize(allText(report)).includes('总阻抗'))
  assert(normalize(allText(report)).includes('音箱总额定功率'))
  assert(normalize(allText(report)).includes('总负载约' + loadMatch[1].trim() + 'Ω·合计W'),
    'nonstandard total load must keep its original value in the secondary fallback')
  assert(normalize(allText(report)).includes('未知扩展字段：' + loadMatch[1].trim() + 'Ω保留原文。'),
    'unrecognized lines must retain their original text fallback')
  assertReportBounds(report)
} finally {
  secondaryPage.close()
}

const gainReference = makeGainReference()
const referenceLayout = renderPayload(standard.payload)
assertLimiterMatchesGain(referenceLayout, gainReference)
assertReportBounds(referenceLayout)

const invalidContext = makeCanvasContext()
assert.throws(
  () => calculateResultReportHeight({ lines: null }, invalidContext),
  TypeError,
  'malformed report payload must throw',
)
assert.throws(
  () => calculateResultReportHeight({ lines: [] }, {}),
  TypeError,
  'missing measure context must throw',
)
assert.throws(
  () => drawResultReport(makeCanvasContext(), standard.payload, standard.report.height - 1),
  RangeError,
  'draw must reject a height smaller than its measured model',
)

console.log('Limiter share report regression passed.')
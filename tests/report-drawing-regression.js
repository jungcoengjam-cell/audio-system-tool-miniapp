const assert = require('assert')
const fs = require('fs')
const Module = require('module')
const path = require('path')

function loadPrivate(file, names) {
  const filename = path.resolve(__dirname, '..', file)
  const source = `${fs.readFileSync(filename, 'utf8')}\nmodule.exports.__private = { ${names.join(', ')} }\n`
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  loaded._compile(source, filename)
  return loaded.exports.__private
}

function context({ captureTextBounds = false } = {}) {
  const calls = []
  const state = { font: '', textAlign: 'left' }
  const measuredWidth = (text) => [...String(text)].length * 10
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'measureText') return (text) => {
        calls.push(['measureText', text])
        return { width: measuredWidth(text) }
      }
      if (key === 'setTextAlign') return (value) => {
        state.textAlign = value
        calls.push(['setTextAlign', value])
      }
      if (key === 'fillText') return (...args) => {
        calls.push(['fillText', ...args])
        if (captureTextBounds) {
          calls.push(['textBounds', {
            text: String(args[0]), x: Number(args[1]), y: Number(args[2]),
            width: measuredWidth(args[0]), textAlign: state.textAlign,
            font: state.font,
          }])
        }
      }
      return (...args) => calls.push([key, ...args])
    },
    set(_, key, value) {
      state[key] = value
      calls.push(['set', key, value])
      return true
    },
  })
  return { ctx, calls, state }
}

const drawing = require('../utils/report-drawing')
const result = loadPrivate('utils/result-report.js', ['drawWrappedText'])
const led = require('../pages/led-screen/report')

assert.deepStrictEqual(drawing.REPORT_COLORS, {
  background: '#f5f5f7', card: '#ffffff', text: '#1d1d1f', secondary: '#6e6e73',
  tertiary: '#8e8e93', line: '#e5e5ea', blue: '#007aff', blueSoft: '#eef6ff',
})
assert.deepStrictEqual(drawing.getExportDimensions(1320), { destWidth: 1500, destHeight: 2640 })
assert.deepStrictEqual(drawing.getExportDimensions(2048), { destWidth: 1500, destHeight: 4096 })
assert.deepStrictEqual(drawing.getExportDimensions(2049), { destWidth: 1499, destHeight: 4096 })
assert.deepStrictEqual(drawing.getExportDimensions(4096), { destWidth: 750, destHeight: 4096 })

const wrappedContext = context()
assert.strictEqual(drawing.drawWrappedText(wrappedContext.ctx, 'abcde', 1, 2, 25, 20), 2)
assert.ok(wrappedContext.state.font.startsWith('400 18px'))
assert.deepStrictEqual(wrappedContext.calls.filter((call) => call[0] === 'measureText')
  .map((call) => call[1]), ['ab', 'abc', 'cd', 'cde', 'cd…', 'c…'])
assert.deepStrictEqual(wrappedContext.calls.filter((call) => call[0] === 'fillText')
  .map((call) => call.slice(1)), [['ab', 1, 2], ['c…', 1, 22]])
const resultContext = context()
assert.strictEqual(result.drawWrappedText(resultContext.ctx, 'abc', 1, 2, 100, 20), 1)
assert.ok(resultContext.state.font.startsWith('400 20px'))
assert.throws(() => drawing.drawWrappedText(context().ctx, 'x', 0, 0, 20, 20, null), TypeError)

function assertPill(fn, expectedWidth, expectedHeight) {
  const { ctx, calls } = context()
  fn(ctx, 'x', 100, 20, { size: 0, color: '', weight: 0, height: 0, background: '' })
  const measureIndex = calls.findIndex((call) => call[0] === 'measureText')
  const beginIndex = calls.findIndex((call) => call[0] === 'beginPath')
  const fillTextIndex = calls.findIndex((call) => call[0] === 'fillText')
  assert.deepStrictEqual(calls[measureIndex], ['measureText', 'x'])
  assert.ok(measureIndex > 0 && measureIndex < beginIndex)
  assert.ok(calls.findIndex((call) => call[0] === 'fill') < fillTextIndex)
  assert.strictEqual(calls.find((call) => call[0] === 'moveTo')[1], 100 - expectedWidth + expectedHeight / 2)
  return calls
}
const sharedPillCalls = assertPill(drawing.drawPill, 38, 34)
assert.ok(sharedPillCalls.some((call) => call[0] === 'set' && call[1] === 'font' && call[2].startsWith('600 18px')))
assert.deepStrictEqual(sharedPillCalls.find((call) => call[0] === 'fillText').slice(1), ['x', 81, 44])
assert.throws(() => drawing.drawPill(context().ctx, 'x', 100, 20, null), TypeError)

const ledContext = context()
const ledWrappedLines = led.wrapMeasuredText(ledContext.ctx, 'abcde', 25, 18)
assert.deepStrictEqual(ledWrappedLines, ['ab', 'cd', 'e'])
assert.ok(ledWrappedLines.every((line) => ledContext.ctx.measureText(line).width <= 25),
  'LED public wrapping API keeps each measured line within its bound')
assert.ok(ledContext.state.font.startsWith('400 18px'))

const ledPayload = led.buildLedScreenReportPayload({
  wallWidthText: '18',
  wallHeightText: '8',
  topReserveText: '0.5',
  bottomReserveText: '0.5',
  viewingDistanceText: '12',
  result: {
    dimensionText: '11.80 × 4.60 m',
    layoutText: '4 × 4 标准模组',
    installedDimensionText: '12.00 × 4.80 m',
    frameWidthText: '0.10 m',
    horizontalMarginMeters: 3,
    actualTopMarginMeters: 1.6,
    actualBottomMarginMeters: 1.6,
    installedWidthMeters: 12,
    installedHeightMeters: 4.8,
    frameWidthMeters: 0.1,
    screenWidthMeters: 11.8,
    screenHeightMeters: 4.6,
    columns: 4,
    rows: 4,
    unitLabel: 'P3.9',
    unitSizeText: '0.50 × 0.50 m',
    resolutionText: '3024 × 1176 px',
    pitchModeLabel: '标准点间距',
    pitchText: '3.91 mm',
    targetAspectRatioKey: '16:9',
    actualRatioText: '2.57:1',
    ratioDeviationText: '43.0%',
    statusKey: 'fit',
    statusLabel: '合适',
    statusText: '观看距离合适',
    viewingAssessmentText: '观看距离合适',
    comfortableRangeText: '约 8–16 m',
  },
})
assert(ledPayload, 'LED public payload builder returns a report payload')
const ledDraw = context({ captureTextBounds: true })
const ledLayout = led.buildLedScreenReportLayout(ledDraw.ctx, ledPayload)
assert.ok(Number.isFinite(ledLayout.height) && ledLayout.height > 0,
  'actual report drawing uses its calculated height rather than a private fixed-wrap helper')
assert.deepStrictEqual(ledLayout.sections.map((section) => section.type), ['title', 'hero', 'diagram', 'specs'])
led.drawLedScreenReport(ledDraw.ctx, ledPayload, ledLayout)
const ledTextCalls = ledDraw.calls.filter((call) => call[0] === 'fillText')
const ledTextBounds = ledDraw.calls.filter((call) => call[0] === 'textBounds').map((call) => call[1])
assert.ok(ledTextCalls.length > 20, 'actual LED report drawing emits measured text across sections')
assert.ok(ledTextCalls.some((call) => String(call[1]).includes('LED 大屏尺寸方案')))
assert.ok(ledTextCalls.some((call) => String(call[1]).includes('墙面安装示意')))
assert.ok(ledTextCalls.some((call) => String(call[1]).includes('方案参数')))
assert.ok(ledTextCalls.some((call) => String(call[1]).includes('3024 × 1176 px')))
for (const call of ledDraw.calls.filter((entry) => ['fillRect', 'strokeRect'].includes(entry[0]))) {
  const [, x, y, width, height] = call
  assert.ok([x, y, width, height].every(Number.isFinite), `${call[0]} uses finite bounds`)
  assert.ok(x >= 0 && y >= 0 && width >= 0 && height >= 0)
  assert.ok(x + width <= led.REPORT_WIDTH + 0.01, `${call[0]} stays within the report width`)
  assert.ok(y + height <= ledLayout.height + 0.01, `${call[0]} stays within the calculated report height`)
}
assert.strictEqual(ledTextBounds.length, ledTextCalls.length,
  'each actual text call records its font, alignment, and mocked measured width')
for (const bounds of ledTextBounds) {
  const left = bounds.textAlign === 'center' ? bounds.x - bounds.width / 2
    : bounds.textAlign === 'right' || bounds.textAlign === 'end' ? bounds.x - bounds.width : bounds.x
  const right = left + bounds.width
  assert.ok(bounds.font, `text ${bounds.text} records its active font`)
  assert.ok(Number.isFinite(left) && Number.isFinite(right), `text ${bounds.text} has finite horizontal bounds`)
  assert.ok(left >= -0.01 && right <= led.REPORT_WIDTH + 0.01,
    `mock-measured text bounds for ${bounds.text} stay within the report width`)
  assert.ok(bounds.y >= 0 && bounds.y <= ledLayout.height,
    `text origin for ${bounds.text} stays within the calculated report height`)
}

const longChinesePayload = {
  ...ledPayload,
  result: { ...ledPayload.result, dimensionText: '舞台扩声系统多区域分区覆盖方案'.repeat(12) },
}
const longChineseDraw = context({ captureTextBounds: true })
const longChineseLayout = led.buildLedScreenReportLayout(longChineseDraw.ctx, longChinesePayload)
assert(longChineseLayout.sections[1].primaryLines.length > 1,
  'long Chinese dimension text exercises public wrapping in a real report section')
assert(longChineseLayout.sections[1].primaryLines.every((line) => longChineseDraw.ctx.measureText(line).width <= 606),
  'wrapped Chinese lines remain within the report content width under the explicit mock measureText')
led.drawLedScreenReport(longChineseDraw.ctx, longChinesePayload, longChineseLayout)
const longChineseBounds = longChineseDraw.calls.filter((call) => call[0] === 'textBounds').map((call) => call[1])
assert(longChineseBounds.some((bounds) => bounds.text === longChineseLayout.sections[1].primaryLines[0]),
  'the wrapped long Chinese title text reaches the actual draw call')
for (const bounds of longChineseBounds) {
  const left = bounds.textAlign === 'center' ? bounds.x - bounds.width / 2
    : bounds.textAlign === 'right' || bounds.textAlign === 'end' ? bounds.x - bounds.width : bounds.x
  assert.ok(left >= -0.01 && left + bounds.width <= led.REPORT_WIDTH + 0.01,
    `long-case mock-measured text bounds for ${bounds.text} stay within the report width`)
  assert.ok(bounds.y >= 0 && bounds.y <= longChineseLayout.height,
    `long-case text origin for ${bounds.text} stays within the calculated report height`)
}

assert.deepStrictEqual(Object.keys(require('../utils/result-report')).sort(), [
  'REPORT_CANVAS_ID', 'REPORT_WIDTH', 'buildResultReportPayload', 'calculateResultReportHeight',
  'drawResultReport', 'getExportDimensions',
])
assert.deepStrictEqual(Object.keys(require('../pages/led-screen/report')).sort(), [
  'REPORT_CANVAS_ID', 'REPORT_HEIGHT', 'REPORT_WIDTH', 'buildLedScreenReportLayout', 'buildLedScreenReportPayload',
  'drawLedScreenReport', 'wrapMeasuredText',
])
console.log('report drawing regression passed')

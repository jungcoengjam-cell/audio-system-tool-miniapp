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

function context() {
  const calls = []
  const state = { font: '' }
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'measureText') return (text) => {
        calls.push(['measureText', text])
        return { width: [...String(text)].length * 10 }
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
const project = loadPrivate('pages/records/project-report.js', ['drawPill'])
const led = loadPrivate('pages/led-screen/report.js', ['drawWrappedText'])

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
const projectPillCalls = assertPill(project.drawPill, 36, 33)
assert.ok(sharedPillCalls.some((call) => call[0] === 'set' && call[1] === 'font' && call[2].startsWith('600 18px')))
assert.ok(projectPillCalls.some((call) => call[0] === 'set' && call[1] === 'font' && call[2].startsWith('600 17px')))
assert.deepStrictEqual(sharedPillCalls.find((call) => call[0] === 'fillText').slice(1), ['x', 81, 44])
assert.deepStrictEqual(projectPillCalls.find((call) => call[0] === 'fillText').slice(1), ['x', 82, 43])
assert.throws(() => drawing.drawPill(context().ctx, 'x', 100, 20, null), TypeError)

const ledContext = context()
const ledResult = led.drawWrappedText(ledContext.ctx, 'abcde', 1, 2, 25, 20, { maxLines: 1 })
assert.strictEqual(ledResult, undefined)
assert.deepStrictEqual(ledContext.calls.filter((call) => call[0] === 'measureText').map((call) => call[1]),
  ['ab', 'abc', 'cd', 'cde'])
assert.deepStrictEqual(ledContext.calls.filter((call) => call[0] === 'fillText').map((call) => call.slice(1)),
  [['ab', 1, 2]])
assert.ok(!ledContext.calls.some((call) => call[0] === 'fillText' && String(call[1]).includes('…')))
assert.ok(ledContext.state.font.startsWith('400 18px'))

assert.deepStrictEqual(Object.keys(require('../utils/result-report')).sort(), [
  'REPORT_CANVAS_ID', 'REPORT_WIDTH', 'buildResultReportPayload', 'calculateResultReportHeight',
  'drawResultReport', 'getExportDimensions',
])
assert.deepStrictEqual(Object.keys(require('../pages/records/project-report')).sort(), [
  'REPORT_CANVAS_ID', 'REPORT_WIDTH', 'buildProjectReportPayload', 'calculateProjectReportHeight',
  'drawProjectReport', 'getExportDimensions',
])
assert.deepStrictEqual(Object.keys(require('../pages/led-screen/report')).sort(), [
  'REPORT_CANVAS_ID', 'REPORT_HEIGHT', 'REPORT_WIDTH', 'buildLedScreenReportPayload', 'drawLedScreenReport',
])
console.log('report drawing regression passed')

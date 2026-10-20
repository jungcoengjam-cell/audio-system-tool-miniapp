const assert = require('node:assert/strict')
const { calculateLedScreenPlan, LED_UNIT_SPECS } = require('../utils/led-screen')
const {
  buildLedScreenReportLayout,
  buildLedScreenReportPayload,
  drawLedScreenReport,
} = require('../pages/led-screen/report')

function createState(unitKey) {
  const result = calculateLedScreenPlan({
    wallWidthMeters: 6,
    wallHeightMeters: 3,
    topReserveMeters: 0.2,
    bottomReserveMeters: 0.2,
    frameWidthMeters: 0.05,
    viewingDistanceMeters: 3,
    aspectRatioKey: '16:9',
    unitKey,
    pixelPitch: 'recommended',
  })
  const actualRatio = result.screenWidthMeters / result.screenHeightMeters
  const deviation = Math.abs(actualRatio - result.targetAspectRatio) / result.targetAspectRatio * 100
  return {
    wallWidthText: '6',
    wallHeightText: '3',
    topReserveText: '0.2',
    bottomReserveText: '0.2',
    frameWidthText: '5',
    viewingDistanceText: '3',
    result: {
      ...result,
      actualRatioText: `${actualRatio.toFixed(2)}:1`,
      ratioDeviationText: `${deviation.toFixed(1)}%`,
    },
  }
}
const state = createState('module')
assert.equal(state.result.columns, 14)
assert.equal(state.result.rows, 15)

const fillRects = []
const segments = []
const textDraws = []
let fillStyle = ''
let currentPoint = null
let context
context = new Proxy({
  measureText: (text) => {
    const fontSize = Number(/(\d+(?:\.\d+)?)px/.exec(context.font || '')?.[1] || 16)
    const width = [...String(text)].reduce((sum, character) => (
      sum + (character.codePointAt(0) <= 0xff ? fontSize * 0.56 : fontSize)
    ), 0)
    return { width }
  },
  fillText: (text) => textDraws.push({ text: String(text), font: context.font }),
  setFillStyle: (value) => { fillStyle = value },
  fillRect: (...rect) => fillRects.push({ fillStyle, rect }),
  beginPath: () => { currentPoint = null },
  moveTo: (x, y) => { currentPoint = [x, y] },
  lineTo: (x, y) => {
    if (currentPoint) segments.push({ from: currentPoint, to: [x, y] })
    currentPoint = [x, y]
  },
}, {
  get: (target, key) => key in target ? target[key] : () => {},
  set: (target, key, value) => { target[key] = value; return true },
})
const payload = buildLedScreenReportPayload(state)
const layout = buildLedScreenReportLayout(context, payload)
drawLedScreenReport(context, payload, layout)

const specs = layout.sections.find(({ type }) => type === 'specs')
assert(specs, 'report renderer did not lay out the parameter section')
assert.equal(specs.cells.length, 6, 'parameter section must have six metrics')
assert.equal(new Set(specs.cells.map(({ width }) => width)).size, 1,
  'all parameter boxes must have the same width')
assert.equal(new Set(specs.cells.map(({ height }) => height)).size, 1,
  'all parameter boxes must have the same height')
assert.equal(new Set(specs.cells.map(({ x }) => x)).size, 2,
  'six parameter boxes must use two columns')
assert.equal(new Set(specs.cells.map(({ y }) => y)).size, 3,
  'six parameter boxes must use three rows')
assert(specs.cells[0].height >= 78 && specs.cells[0].height <= 86,
  'single-line parameter boxes must use compact height')
assert(specs.cells.every(({ height }) => height === specs.cells[0].height),
  'all six parameter boxes must remain equal height')
assert(specs.cells.every(({ labelLines }) => labelLines.length === 1),
  'parameter labels must fit on one line')
assert(specs.cells.every(({ valueLines }) => valueLines.length === 1),
  'supported parameter values must fit on one line')
assert(specs.cells.every(({ valueFontSize }) => valueFontSize === specs.cells[0].valueFontSize),
  'all values must use one shared font size')
assert(specs.cells[0].valueFontSize >= 18 && specs.cells[0].valueFontSize <= 21,
  'shared value font size must stay between 18 and 21 px')
const expectedValues = [
  `${state.result.unitLabel} · ${state.result.unitSizeText.replace(' × ', '×')}`,
  state.result.resolutionText,
  `${state.result.pitchModeLabel} ${state.result.pitchText}`,
  `${state.result.targetAspectRatioKey} / ${state.result.actualRatioText}（${state.result.ratioDeviationText}）`,
  `${state.viewingDistanceText} m`,
  state.result.comfortableRangeText,
]
assert.deepEqual(specs.cells.map(({ valueLines }) => valueLines.join('')), expectedValues,
  'parameter values, including ratio deviation and both viewing distances, must remain complete')
assert.deepEqual(specs.cells.map(({ labelLines }) => labelLines.join('')),
  ['拼装规格', '估算分辨率', '点间距', '目标 / 实际比例（偏差）', '最近观看距离', '舒适观看距离'],
  'recent viewing and comfortable viewing distance must be separate metrics')
assert(specs.cells.every((cell) => textDraws.some(({ text, font }) => (
  text === cell.valueLines[0] && font.includes(`${cell.valueFontSize}px`)
))), 'renderer must draw each value at its measured font size')

const screenRect = fillRects.find(({ fillStyle: color }) => color === '#4f46e5')?.rect
assert(screenRect, 'report renderer did not draw the screen grid')
const [screenX, screenY, screenWidth, screenHeight] = screenRect
assert(screenWidth / state.result.columns >= 3, 'sample columns must have at least 3 px per unit')
assert(screenHeight / state.result.rows >= 3, 'sample rows must have at least 3 px per unit')

const epsilon = 1e-7
const close = (actual, expected) => Math.abs(actual - expected) <= epsilon
const verticalLines = segments.filter(({ from, to }) => (
  close(from[0], to[0]) && close(from[1], screenY) && close(to[1], screenY + screenHeight)
  && from[0] > screenX + epsilon && from[0] < screenX + screenWidth - epsilon
))
const horizontalLines = segments.filter(({ from, to }) => (
  close(from[1], to[1]) && close(from[0], screenX) && close(to[0], screenX + screenWidth)
  && from[1] > screenY + epsilon && from[1] < screenY + screenHeight - epsilon
))

assert.equal(verticalLines.length, 13, '14 columns with readable spacing need 13 internal vertical lines')
assert.equal(horizontalLines.length, 14, '15 rows with readable spacing need 14 internal horizontal lines')
verticalLines.forEach(({ from }, index) => {
  assert(close(from[0], screenX + screenWidth * (index + 1) / state.result.columns),
    `vertical grid line ${index + 1} must mark its module boundary`)
})
horizontalLines.forEach(({ from }, index) => {
  assert(close(from[1], screenY + screenHeight * (index + 1) / state.result.rows),
    `horizontal grid line ${index + 1} must mark its module boundary`)
})

for (const unitKey of Object.keys(LED_UNIT_SPECS)) {
  const unitState = createState(unitKey)
  const unitPayload = buildLedScreenReportPayload(unitState)
  const unitLayout = buildLedScreenReportLayout(context, unitPayload)
  const unitCells = unitLayout.sections.find(({ type }) => type === 'specs').cells
  const unitFontSize = unitCells[0].valueFontSize
  assert(unitFontSize >= 18 && unitFontSize <= 21, `${unitKey} must use a readable shared value font size`)
  assert(unitCells.every(({ valueFontSize }) => valueFontSize === unitFontSize),
    `${unitKey} parameter values must share one font size`)
  assert(unitCells.every(({ valueLines }) => valueLines.length === 1),
    `${unitKey} parameter values must fit on one line without truncation`)
  assert(unitCells.every(({ height }) => height === unitCells[0].height)
    && unitCells[0].height >= 78 && unitCells[0].height <= 86,
  `${unitKey} parameter boxes must be equally sized and compact`)

  const unitResult = unitState.result
  assert.equal(unitCells[0].valueLines.join(''),
    `${unitResult.unitLabel} · ${unitResult.unitSizeText.replace(' × ', '×')}`,
    `${unitKey} assembly specification must remain complete`)
  assert.equal(unitCells[3].valueLines.join(''),
    `${unitResult.targetAspectRatioKey} / ${unitResult.actualRatioText}（${unitResult.ratioDeviationText}）`,
    `${unitKey} ratio and deviation must remain complete`)

  const drawStart = textDraws.length
  drawLedScreenReport(context, unitPayload, unitLayout)
  const unitDraws = textDraws.slice(drawStart)
  assert(unitCells.every((cell) => unitDraws.some(({ text, font }) => (
    text === cell.valueLines[0] && font.includes(`${unitFontSize}px`)
  ))), `${unitKey} values must render at their measured font size`)
}

console.log('LED report grid and three single-line equal-size parameter layouts passed')

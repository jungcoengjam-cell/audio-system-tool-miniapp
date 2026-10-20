'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { createPage, installPlatform, loadPageDefinition, root } = require('./harness.cjs')

const {
  REPORT_CANVAS_ID,
  REPORT_WIDTH,
  SPL_REPORT_DESIGN_VERSION,
  buildSplReportPayload,
  buildSplReportSignature,
  calculateSplReportHeight,
  drawSplReport,
  getExportDimensions,
} = require(path.join(root, 'pages/spl/spl-report.js'))

function readFontSize(font) {
  return Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || 0)
}

function measureText(text, font) {
  const size = readFontSize(font)
  return [...String(text)].reduce((total, character) => (
    total + (/[\u2e80-\u9fff]/u.test(character) ? size : size * 0.56)
  ), 0)
}

function recordingContext() {
  let font = ''
  let fillStyle = ''
  let strokeStyle = ''
  let textAlign = 'left'
  let lineWidth = 1
  let currentPath = null
  const properties = {}
  const commands = []
  const paths = []
  const measureFonts = new Set()

  const methods = {
    measureText(text) {
      measureFonts.add(font)
      return { width: measureText(text, font) }
    },
    setFillStyle(value) {
      fillStyle = value
      commands.push({ type: 'setFillStyle', value })
    },
    setStrokeStyle(value) {
      strokeStyle = value
      commands.push({ type: 'setStrokeStyle', value })
    },
    setTextAlign(value) {
      textAlign = value
    },
    setLineWidth(value) {
      lineWidth = Number(value)
    },
    fillText(text, x, y) {
      commands.push({ type: 'fillText', text: String(text), x: Number(x), y: Number(y), font, fillStyle, textAlign })
    },
    fillRect(x, y, width, height) {
      commands.push({ type: 'fillRect', x, y, width, height, fillStyle })
    },
    beginPath() {
      currentPath = { commands: [], fillStyle, strokeStyle, lineWidth }
      paths.push(currentPath)
    },
    moveTo(x, y) { currentPath?.commands.push({ type: 'moveTo', values: [x, y] }) },
    lineTo(x, y) { currentPath?.commands.push({ type: 'lineTo', values: [x, y] }) },
    quadraticCurveTo(x1, y1, x2, y2) {
      currentPath?.commands.push({ type: 'quadraticCurveTo', values: [x1, y1, x2, y2] })
    },
    closePath() { currentPath?.commands.push({ type: 'closePath', values: [] }) },
    fill() { currentPath?.commands.push({ type: 'fill', values: [] }) },
    stroke() { currentPath?.commands.push({ type: 'stroke', values: [] }) },
  }
  const context = new Proxy({}, {
    get(_target, property) {
      return methods[property] || (() => {})
    },
    set(_target, property, value) {
      if (property === 'font') font = String(value)
      else properties[property] = value
      return true
    },
  })

  return { context, commands, paths, measureFonts }
}

function collectPathPoints(pathRecord) {
  return pathRecord.commands.flatMap((command) => command.values || [])
}

function findLongestReconstruction(texts, source) {
  let longest = ''
  for (let start = 0; start < texts.length; start += 1) {
    let candidate = ''
    for (let index = start; index < texts.length; index += 1) {
      const text = texts[index]
      const remaining = source.slice(candidate.length)
      if (!text || !remaining) break
      let matched = 0
      while (matched < text.length && matched < remaining.length
        && text[matched] === remaining[matched]) matched += 1
      if (!matched) break
      candidate += text.slice(0, matched)
      if (candidate.length > longest.length) longest = candidate
      if (candidate === source) return candidate
      if (matched < text.length) break
    }
  }
  return longest
}

const platform = installPlatform()
try {
  const page = createPage(loadPageDefinition())
  page.onLoad()
  page.onShow()
  const recordBefore = page.getRecordPayload()
  const resultBefore = JSON.stringify(page.data.result)
  const resultTextBefore = recordBefore.resultText
  const longModel = `超长型号系列-${'ABCDEFGHIJKLMN'.repeat(3)}-定制末尾`
  const customDistance = '123.456789'
  const stressState = {
    ...page.data,
    result: {
      ...page.data.result,
      model: longModel,
      speakerCount: 16,
      distanceMeters: Number(customDistance),
      selectedSpl: 107.7,
      oneMeterSpl: 119.8,
      totalRatedPower: 19200,
      sensitivityDb: 99.9,
      summationGainDb: 12,
      summationModeShortLabel: '常规叠加（推荐）',
      distanceRows: Array.from({ length: 8 }, (_, index) => ({
        distanceMeters: index === 6 ? Number(customDistance) : index + 1,
        spl: 109.2 - (index * 6),
        isSelected: index === 6,
      })),
    },
  }
  const payload = buildSplReportPayload(stressState)
  assert(payload, 'valid SPL state must produce a report payload')
  assert.equal(REPORT_CANVAS_ID, 'resultReportCanvas')
  assert.equal(REPORT_WIDTH, 750)
  assert.deepEqual(Object.keys(payload), [
    'title', 'primaryLabel', 'primaryValue', 'primaryUnit', 'description', 'metrics', 'parameters', 'distanceRows',
  ], 'local report exposes only user-facing result content')
  assert.match(payload.primaryLabel, /自由场理论估算/)
  assert(!/(?:版本|产品资料|产品数据|使用边界|边界说明)/.test(JSON.stringify(payload)),
    'the rendered payload must not expose report version, product data, or boundary metadata')
  assert.equal(payload.distanceRows.length, 8, 'all report distance rows are retained')

  const first = recordingContext()
  const height = calculateSplReportHeight(payload, first.context)
  assert.ok(Number.isFinite(height) && height > 0)
  const exportDimensions = getExportDimensions(height)
  assert(exportDimensions.destWidth <= 1500 && exportDimensions.destHeight <= 4096,
    'SPL report export remains within the shared canvas export limits')
  const second = recordingContext()
  drawSplReport(second.context, payload, height)

  const requiredFontSizes = [22, 23, 24, 26, 30, 32, 72]
  const observedFontSizes = new Set([...first.measureFonts, ...second.measureFonts]
    .map(readFontSize).filter((size) => size > 0))
  for (const size of requiredFontSizes) {
    assert(observedFontSizes.has(size), `local report must measure and draw the ${size}px cable-report typography tier`)
  }
  const reportFonts = [...first.measureFonts, ...second.measureFonts]
  const usesCableStack = (font) => /-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif/.test(font)
  const primaryFont = '700 72px Arial'
  assert(reportFonts.every((font) => usesCableStack(font) || font === primaryFont),
    'report uses the cable font stack except for the primary numeral whose WeChat rendering is explicitly Arial')
  assert(reportFonts.includes(primaryFont)
    && second.commands.some((command) => command.type === 'fillText'
      && command.text === payload.primaryValue && command.font === primaryFont),
  'the measured and drawn primary numeral use the Arial face verified against the WeChat image')
  assert(second.commands.some((command) => command.type === 'setFillStyle' && command.value === '#eaf7f5'),
    'primary report card uses the cable mint color')
  assert(second.commands.some((command) => command.type === 'setFillStyle' && command.value === '#eef6ff'),
    'metric cards use the cable blue color')

  const textCommands = second.commands.filter((command) => command.type === 'fillText')
  assert(textCommands.length > 20, 'drawing emits the expected title, result, metrics, and parameter text')
  for (const command of textCommands) {
    const size = readFontSize(command.font)
    const width = measureText(command.text, command.font)
    const left = command.textAlign === 'center' ? command.x - (width / 2)
      : command.textAlign === 'right' ? command.x - width : command.x
    const right = left + width
    assert(left >= -0.5 && right <= REPORT_WIDTH + 0.5,
      `drawn report text must stay inside the canvas: ${command.text}`)
    assert(command.y >= size && command.y <= height,
      `drawn report text baseline must stay inside the measured canvas: ${command.text}`)
  }
  const drawnText = textCommands.map((command) => command.text)
  assert.equal(findLongestReconstruction(drawnText, longModel), longModel,
    'a long speaker model wraps across lines without dropping or clipping characters')
  assert(drawnText.includes(`${customDistance} m`),
    'a custom distance and unit remain intact in the measured report rows')
  assert(!/(?:版本|产品资料|产品数据|使用边界|边界说明)/.test(drawnText.join('')),
    'drawing commands omit version, product-data, and boundary copy')

  const pathBounds = second.paths.map((pathRecord) => {
    const coordinates = collectPathPoints(pathRecord)
    const xs = coordinates.filter((_value, index) => index % 2 === 0)
    const ys = coordinates.filter((_value, index) => index % 2 === 1)
    return {
      hasRoundedCorners: pathRecord.commands.some((command) => command.type === 'quadraticCurveTo'),
      minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
      firstLine: pathRecord.commands.find((command) => command.type === 'lineTo')?.values,
      firstCurve: pathRecord.commands.find((command) => command.type === 'quadraticCurveTo')?.values,
    }
  }).filter((bounds) => Number.isFinite(bounds.minX))
  assert(pathBounds.every((bounds) => bounds.minX >= 0 && bounds.maxX <= REPORT_WIDTH
    && bounds.minY >= 0 && bounds.maxY <= height), 'all drawing paths remain within the measured canvas')
  const roundedPaths = pathBounds.filter((bounds) => bounds.hasRoundedCorners)
  assert(roundedPaths.length >= 12, 'report uses rounded cards for the result, metrics, parameters, and distance grid')
  for (const bounds of roundedPaths) {
    const firstCurve = bounds.firstCurve
    const firstLine = bounds.firstLine
    const radiusFromY = firstCurve[3] - bounds.minY
    const radiusFromX = firstCurve[0] - firstLine[0]
    assert(Math.abs(radiusFromY - 22) <= 0.01 && Math.abs(radiusFromX - 22) <= 0.01,
      'report cards use the cable radius of 22px')
  }
  assert(pathBounds.filter((bounds) => bounds.hasRoundedCorners
    && Math.abs((bounds.maxY - bounds.minY) - 84) <= 0.01).length >= 8,
  'all eight distance cells retain the 84px cable-report row height')
  const distanceCells = roundedPaths.slice(-16).filter((_bounds, index) => index % 2 === 0)
  assert.equal(distanceCells.length, 8, 'the eight measured distance rows each draw one rounded card')
  for (const cell of distanceCells) {
    const cellTexts = textCommands.filter((command) => command.y > cell.minY && command.y < cell.maxY
      && command.x >= cell.minX && command.x <= cell.maxX)
    assert(cellTexts.length >= 2, 'each distance card draws a label and SPL value')
    for (const command of cellTexts) {
      const size = readFontSize(command.font)
      const width = measureText(command.text, command.font)
      const left = command.textAlign === 'center' ? command.x - (width / 2)
        : command.textAlign === 'right' ? command.x - width : command.x
      const right = left + width
      assert(left >= cell.minX + 17 && right <= cell.maxX - 17,
        `distance-row text remains inside its 18px content inset: ${command.text}`)
      assert(command.y >= cell.minY + size && command.y <= cell.maxY,
        `distance-row text baseline remains inside its cell: ${command.text}`)
    }
  }

  const recordAfter = page.getRecordPayload()
  assert.equal(JSON.stringify(page.data.result), resultBefore,
    'report payload building and drawing do not mutate SPL calculation state')
  assert.equal(recordAfter.resultText, resultTextBefore,
    'the established record resultText remains byte-for-byte unchanged')
  assert.equal(recordAfter.summary, recordBefore.summary)
  const signature = buildSplReportSignature(recordBefore)
  assert(signature.startsWith(`${SPL_REPORT_DESIGN_VERSION}|`), 'report cache signature includes its local design version')

  process.stdout.write(`SPL local report regression: passed (${height}px, ${textCommands.length} text draws, ${roundedPaths.length} rounded paths)\n`)
} finally {
  platform.restore()
}

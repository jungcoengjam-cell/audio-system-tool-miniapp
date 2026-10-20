'use strict'

const assert = require('node:assert/strict')
const { cameras } = require('../../data/cameras')
const {
  calculateGroundAreaPlacement,
  calculateHorizontalOnlyPlacement,
  calculateVerticalPlanePlacement,
  resolveCustomFov,
  resolveLibraryFov,
  resolveLibraryOptics,
} = require('../../utils/camera-fov')
const { buildCameraScene, fitCameraScene } = require('../../pages/camera/camera-scene')
const { adaptCanvas2dContext, drawPreviewAtSize } = require('../../pages/camera/preview-renderer')

const DEG = Math.PI / 180
const close = (actual, expected, label, tolerance = 1e-7) => {
  assert(Number.isFinite(actual), `${label} must be finite`)
  assert(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`)
}

function assertFiniteNumbers(value, label) {
  if (typeof value === 'number') {
    assert(Number.isFinite(value), `${label} contains non-finite value ${value}`)
  } else if (Array.isArray(value)) {
    value.forEach((item) => assertFiniteNumbers(item, label))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => assertFiniteNumbers(item, label))
  }
}

function recordedTextWidth(value, fontSize) {
  return Array.from(String(value)).reduce((width, character) => (
    width + (/^[\u2e80-\u9fff]$/u.test(character) ? fontSize : fontSize * 0.55)
  ), 0)
}

function createRecorder(supportsArc = true) {
  const commands = []
  const record = (name) => (...args) => commands.push([name, ...args])
  const context = {}
  const directMethods = [
    'setFillStyle', 'setStrokeStyle', 'setLineWidth', 'setTextAlign', 'setLineDash',
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'rect', 'clip', 'fill', 'stroke',
    'fillRect', 'strokeRect', 'fillText', 'save', 'restore',
  ]
  if (supportsArc) directMethods.push('arc')
  directMethods.forEach((name) => { context[name] = record(name) })
  context.supportsArc = supportsArc
  let fontSize = 13
  context.setFontSize = (value) => {
    fontSize = Number(value)
    commands.push(['setFontSize', value])
  }
  context.measureText = (value) => recordedTextWidth(value, fontSize)

  const nativeContext = {}
  const styleProperties = {
    fillStyle: 'setFillStyle',
    strokeStyle: 'setStrokeStyle',
    lineWidth: 'setLineWidth',
    textAlign: 'setTextAlign',
  }
  Object.entries(styleProperties).forEach(([property, command]) => {
    Object.defineProperty(nativeContext, property, { set: (value) => commands.push([command, value]) })
  })
  Object.defineProperty(nativeContext, 'font', {
    set: (value) => {
      fontSize = Number.parseFloat(value)
      commands.push(['setFontSize', fontSize])
    },
  })
  const nativeMethods = [
    'setLineDash', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'rect', 'clip',
    'fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'save', 'restore',
  ]
  if (supportsArc) nativeMethods.push('arc')
  nativeMethods.forEach((name) => { nativeContext[name] = record(name) })
  nativeContext.measureText = (value) => ({ width: recordedTextWidth(value, fontSize) })
  return { context, nativeContext, commands }
}

function render(result, { width = 640, height = 500, theme = 'dark', supportsArc = true, native = false } = {}) {
  const recorder = createRecorder(supportsArc)
  const context = native ? adaptCanvas2dContext(recorder.nativeContext) : recorder.context
  drawPreviewAtSize(context, result, width, height, 'spatial', theme)
  return { ...recorder, width, height, theme, supportsArc }
}

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z }
function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function magnitude(a) { return Math.hypot(a.x, a.y, a.z) }
function opticalAngle(section, lens) {
  const left = subtract(section.points[1], lens)
  const right = subtract(section.points[2], lens)
  return Math.acos(Math.max(-1, Math.min(1, dot(left, right) / (magnitude(left) * magnitude(right))))) / DEG
}

function scenePoints(scene) {
  return [
    scene.lens,
    scene.groundProjection,
    ...scene.site,
    ...scene.siteTop,
    ...scene.innerFrame,
    ...(scene.outerFrame || []),
    ...scene.body,
    ...scene.sections.flatMap((section) => section.points),
  ]
}

function projectedBounds(scene, width, height, label) {
  const fitted = fitCameraScene(scene, width, height)
  assert(Number.isFinite(fitted.scale) && fitted.scale > 0, `${label}: orthographic scale must be finite and positive`)
  const points = scenePoints(scene).map(fitted.project)
  points.forEach((point) => {
    assert(Number.isFinite(point.x) && Number.isFinite(point.y), `${label}: projection must be finite`)
    assert(point.x >= -1e-7 && point.x <= width + 1e-7
      && point.y >= -1e-7 && point.y <= height + 1e-7,
    `${label}: fitted scene point is outside canvas bounds: ${JSON.stringify(point)}`)
  })
  const frame = scene.innerFrame.map(fitted.project)
  const box = {
    left: Math.min(...frame.map((point) => point.x)),
    right: Math.max(...frame.map((point) => point.x)),
    top: Math.min(...frame.map((point) => point.y)),
    bottom: Math.max(...frame.map((point) => point.y)),
  }
  assert(box.right > box.left && box.bottom > box.top, `${label}: target frame bounds must be non-degenerate`)
  return { scale: fitted.scale, targetBounds: box }
}

function assertSceneGeometry(result, label, expectedSectionCount) {
  const scene = buildCameraScene(result)
  assert(scene, `${label}: current 3D scene should be constructible`)
  assert.equal(scene.sections.length, expectedSectionCount, `${label}: optical sections must reflect available axes`)
  assertFiniteNumbers(scene, `${label} scene`)
  assert(scene.dimensions.width > 0 && scene.distance > 0 && scene.dimensions.cameraHeight > 0,
    `${label}: scene dimensions and distance must be positive`)
  for (const section of scene.sections) {
    assert.deepEqual(section.points[0], scene.lens, `${label}/${section.axis}: section must share the lens-centre apex`)
    for (const point of section.points.slice(1)) close(point.x, scene.distance, `${label}/${section.axis} front-plane intersection`)
    if (!section.clipped) {
      const sourceFov = section.axis === 'horizontal' ? result.horizontalFov : result.verticalFov
      close(opticalAngle(section, scene.lens), sourceFov, `${label}/${section.axis} source optical angle`, 1e-6)
    }
  }
  const centerHeight = (scene.dimensions.bottom + scene.dimensions.top) / 2
  const expectedFrameDepth = Number.isFinite(Number(result.framingBounds?.referenceDepthMeters))
    ? Number(result.framingBounds.referenceDepthMeters)
    : scene.distance * scene.basis.forward.x
      + (centerHeight - scene.dimensions.cameraHeight) * scene.basis.forward.z
  for (const point of [...scene.innerFrame, ...(scene.outerFrame || [])]) {
    const cameraNormalDepth = dot(subtract(point, scene.lens), scene.basis.forward)
    close(cameraNormalDepth, expectedFrameDepth, label + ' camera-normal frame depth', 1e-6)
  }  const bounds = projectedBounds(scene, 390, 302, label)
  return { scene, bounds }
}

function labelsOf(rendered) {
  return rendered.commands.filter(([name]) => name === 'fillText').map(([, value]) => String(value))
}

function projectedHeightDimension(scene, width, height) {
  const { project } = fitCameraScene(scene, width - 56, height)
  const site = scene.site.map(project)
  const siteTop = scene.siteTop.map(project)
  const highestIndex = scene.ground ? 2 : 3
  const heightOffset = Math.max(7, Math.min(16, width - 8 - site[highestIndex].x))
  const start = { x: siteTop[highestIndex].x + heightOffset, y: siteTop[highestIndex].y }
  const end = { x: site[highestIndex].x + heightOffset, y: site[highestIndex].y }
  return {
    start,
    end,
    titleX: width - 5,
    titleY: (start.y + end.y) / 2 - 5,
    valueX: width - 5,
    valueY: (start.y + end.y) / 2 + 13,
  }
}

function renderedHeightArrowPaths(commands, start, end) {
  const paths = []
  let current = null
  for (const command of commands) {
    if (command[0] === 'beginPath') {
      current = { points: [], closed: false }
      paths.push(current)
    } else if (current && command[0] === 'moveTo') {
      current.points.push({ x: command[1], y: command[2] })
    } else if (current && command[0] === 'lineTo') {
      current.points.push({ x: command[1], y: command[2] })
    } else if (current && command[0] === 'closePath') {
      current.closed = true
    } else if (current && (command[0] === 'fill' || command[0] === 'stroke')) {
      current = null
    }
  }
  const samePoint = (point, expected) => (
    Math.abs(point.x - expected.x) < 1e-7 && Math.abs(point.y - expected.y) < 1e-7
  )
  return paths.filter((path) => path.points.length >= 2
    && path.points.some((point) => samePoint(point, start) || samePoint(point, end)))
}

function pathSegments(path) {
  const segments = path.points.slice(1).map((point, index) => [path.points[index], point])
  if (path.closed) segments.push([path.points[path.points.length - 1], path.points[0]])
  return segments
}

function renderedStrokeSegments(commands) {
  const paths = []
  let current = null
  const finish = () => {
    if (current?.stroked) paths.push(current)
    current = null
  }
  for (const command of commands) {
    if (command[0] === 'beginPath') {
      finish()
      current = { points: [], closed: false, stroked: false }
    } else if (current && command[0] === 'moveTo') {
      current.points.push({ x: command[1], y: command[2] })
    } else if (current && command[0] === 'lineTo') {
      current.points.push({ x: command[1], y: command[2] })
    } else if (current && command[0] === 'closePath') {
      current.closed = true
    } else if (current && command[0] === 'stroke') {
      current.stroked = true
      finish()
    }
  }
  finish()
  return paths.flatMap(pathSegments)
}

function segmentIntersectsRect(start, end, rect) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let lower = 0
  let upper = 1
  const p = [-dx, dx, -dy, dy]
  const q = [start.x - rect.left, rect.right - start.x, start.y - rect.top, rect.bottom - start.y]
  for (let index = 0; index < 4; index += 1) {
    if (Math.abs(p[index]) < 1e-12) {
      if (q[index] < 0) return false
      continue
    }
    const ratio = q[index] / p[index]
    if (p[index] < 0) lower = Math.max(lower, ratio)
    else upper = Math.min(upper, ratio)
    if (lower > upper) return false
  }
  return true
}

function heightTitleTextBounds(rendered, labelIndex, heightLabel) {
  const command = rendered.commands[labelIndex]
  const fontSize = rendered.commands[labelIndex - 2][1]
  const textWidth = recordedTextWidth(heightLabel, fontSize)
  return {
    left: command[2] - textWidth - 1,
    right: command[2] + 1,
    top: command[3] - fontSize - 1,
    bottom: command[3] + fontSize * 0.25 + 1,
  }
}

function rectanglesOverlap(first, second) {
  return first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top
}

function displayNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function assertHeightLabelClearance(result, label, width, height, theme) {
  const scene = buildCameraScene(result)
  const rendered = render(result, { width, height, theme })
  const adapted = render(result, { width, height, theme, native: true })
  assert.deepEqual(adapted.commands, rendered.commands,
    `${label}/${width}/${theme}: native adapter must preserve the responsive renderer trace`)
  const heightLabel = scene.ground ? '目标最高' : '目标高'
  const heightValue = `${displayNumber(scene.dimensions.top - scene.dimensions.bottom)} m`
  const labelIndex = rendered.commands.findIndex(([name, value]) => name === 'fillText' && value === heightLabel)
  const valueIndex = rendered.commands.findIndex(([name, value]) => name === 'fillText' && value === heightValue)
  assert(labelIndex >= 0 && valueIndex >= 0, `${label}/${width}/${theme}: target height label and value remain present`)
  const labelCommand = rendered.commands[labelIndex]
  const valueCommand = rendered.commands[valueIndex]
  assert.deepEqual(rendered.commands[labelIndex - 1], ['setTextAlign', 'right'],
    `${label}/${width}/${theme}: target height label remains right-aligned`)
  assert.deepEqual(rendered.commands[valueIndex - 1], ['setTextAlign', 'right'],
    `${label}/${width}/${theme}: target height value remains right-aligned`)
  const dimension = projectedHeightDimension(scene, width, height)
  assert(Math.abs(labelCommand[2] - dimension.titleX) < 1e-7
    && Math.abs(labelCommand[3] - dimension.titleY) < 1e-7,
  `${label}/${width}/${theme}: target height title follows the projected height dimension`)
  assert.equal(valueCommand[1], heightValue, `${label}/${width}/${theme}: target height numeric text is unchanged`)

  assert(Math.abs(valueCommand[2] - dimension.valueX) < 1e-7
    && Math.abs(valueCommand[3] - dimension.valueY) < 1e-7,
  `${label}/${width}/${theme}: target height value remains paired below the title`)
  const hasExpectedArrowShaft = rendered.commands.some((command, index) => (
    command[0] === 'moveTo'
      && Math.abs(command[1] - dimension.start.x) < 1e-7
      && Math.abs(command[2] - dimension.start.y) < 1e-7
      && rendered.commands[index + 1]?.[0] === 'lineTo'
      && Math.abs(rendered.commands[index + 1][1] - dimension.end.x) < 1e-7
      && Math.abs(rendered.commands[index + 1][2] - dimension.end.y) < 1e-7
  ))
  assert(hasExpectedArrowShaft, `${label}/${width}/${theme}: height arrow endpoints remain unchanged`)
  const arrowPaths = renderedHeightArrowPaths(rendered.commands, dimension.start, dimension.end)
  assert(arrowPaths.some((path) => path.points.length === 2
    && Math.abs(path.points[0].x - dimension.start.x) < 1e-7
    && Math.abs(path.points[0].y - dimension.start.y) < 1e-7
    && Math.abs(path.points[1].x - dimension.end.x) < 1e-7
    && Math.abs(path.points[1].y - dimension.end.y) < 1e-7),
  `${label}/${width}/${theme}: full height arrow shaft remains present`)
  assert(arrowPaths.some((path) => path.closed && path.points.length === 3
    && Math.abs(path.points[0].x - dimension.start.x) < 1e-7
    && Math.abs(path.points[0].y - dimension.start.y) < 1e-7)
    && arrowPaths.some((path) => path.closed && path.points.length === 3
      && Math.abs(path.points[0].x - dimension.end.x) < 1e-7
      && Math.abs(path.points[0].y - dimension.end.y) < 1e-7),
  `${label}/${width}/${theme}: both height arrowheads remain present`)
  const titleRect = heightTitleTextBounds(rendered, labelIndex, heightLabel)
  const valueRect = heightTitleTextBounds(rendered, valueIndex, heightValue)
  for (const [kind, rect] of [['title', titleRect], ['value', valueRect]]) {
    assert(rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= height,
      `${label}/${width}/${theme}: target height ${kind} text bounds stay inside the canvas`)
  }
  const lineSegments = renderedStrokeSegments(rendered.commands)
  for (const [kind, rect] of [['title', titleRect], ['value', valueRect]]) {
    assert(!lineSegments.some(([start, end]) => segmentIntersectsRect(start, end, rect)),
      `${label}/${width}/${theme}: target height ${kind} text bounds clear every rendered stroke segment`)
  }
  const heightMidY = (dimension.start.y + dimension.end.y) / 2
  const leaderY = heightMidY
  const leaderStartX = (dimension.start.x + dimension.end.x) / 2
  const textLeft = dimension.titleX - Math.max(recordedTextWidth(heightLabel, 10.5), recordedTextWidth(heightValue, 12))
  const leaderEndX = textLeft - 5
  assert(leaderEndX > leaderStartX,
    `${label}/${width}/${theme}: annotation leader has positive length`)
  assert(lineSegments.some(([start, end]) => (
    Math.abs(start.x - leaderStartX) < 1e-7 && Math.abs(start.y - leaderY) < 1e-7
      && Math.abs(end.x - leaderEndX) < 1e-7 && Math.abs(end.y - leaderY) < 1e-7
  )), `${label}/${width}/${theme}: annotation leader attaches at the height shaft midpoint`)
  assert(Math.abs(textLeft - leaderEndX) <= 5 + 1e-7,
    `${label}/${width}/${theme}: annotation leader ends within 5px of the text pair`)
  assert(rendered.commands.filter(([name]) => name === 'fillText').every(([, , x, y]) => (
    x >= 0 && x <= width && y >= 0 && y <= height
  )), `${label}/${width}/${theme}: responsive label anchors stay within the canvas`)
}

function assertHeightPairAvoidsCameraToolbar(result, label, viewportWidth, theme) {
  const canvasWidth = viewportWidth * 686 / 750
  const canvasHeight = Math.max(340, viewportWidth * (viewportWidth <= 350 ? 800 : 760) / 750)
  const scene = buildCameraScene(result)
  const rendered = render(result, { width: canvasWidth, height: canvasHeight, theme })
  const heightLabel = scene.ground ? '目标最高' : '目标高'
  const heightValue = `${displayNumber(scene.dimensions.top - scene.dimensions.bottom)} m`
  const labelIndex = rendered.commands.findIndex(([name, value]) => name === 'fillText' && value === heightLabel)
  const valueIndex = rendered.commands.findIndex(([name, value]) => name === 'fillText' && value === heightValue)
  assert(labelIndex >= 0 && valueIndex >= 0,
    `${label}/${viewportWidth}/${theme}: target height title and value remain present`)
  const titleRect = heightTitleTextBounds(rendered, labelIndex, heightLabel)
  const valueRect = heightTitleTextBounds(rendered, valueIndex, heightValue)
  const railLeft = canvasWidth - 44
  const headingText = { kind: 'heading-text', left: 3, right: canvasWidth - 54, top: -44, bottom: 0 }
  const actionButtons = [0, 1, 2, 3].map((index) => ({
      kind: `action-${index + 1}`,
      left: railLeft,
      right: canvasWidth,
      top: index * 47 - 44,
      bottom: index * 47,
    }))
  assert.equal(headingText.bottom - headingText.top, 44,
    `${viewportWidth}: camera page heading text region is 44px high`)
  assert.equal(actionButtons.length, 4, `${viewportWidth}: camera page has four action buttons`)
  actionButtons.forEach((region, index) => {
    assert.equal(region.bottom - region.top, 44,
      `${viewportWidth}: ${region.kind} toolbar region is 44px high`)
    if (index > 0) {
      const prior = actionButtons[index - 1]
      assert.equal(region.top - prior.bottom, 3,
        `${viewportWidth}: toolbar region ${index} has a 3px gap before ${region.kind}`)
    }
  })
  for (const [kind, textRect] of [['title', titleRect], ['value', valueRect]]) {
    ;[headingText, ...actionButtons].forEach((region) => {
      assert(!rectanglesOverlap(textRect, region),
        `${label}/${viewportWidth}/${theme}: ${kind} text bounds clear ${region.kind} toolbar region`)
    })
  }
}

function assertCurrentRenderer(result, label, expectedSections = 2) {
  const scenarioLabels = []
  for (const theme of ['dark', 'light']) {
    const direct = render(result, { theme })
    const native = render(result, { theme, native: true })
    assert.deepEqual(native.commands, direct.commands,
      `${label}/${theme}: the native Canvas adapter must preserve the direct renderer command trace`)
    assert.equal(direct.commands[0][0], 'setFillStyle')
    assert.equal(direct.commands[1][0], 'fillRect')
    assert.deepEqual(direct.commands[1].slice(1), [0, 0, direct.width, direct.height],
      `${label}/${theme}: the background must cover the requested canvas`)
    assert.equal(direct.commands[0][1], theme === 'dark' ? '#000000' : '#f6f7f9',
      `${label}/${theme}: selected theme must reach the renderer`)
    assertFiniteNumbers(direct.commands, `${label}/${theme} direct render`)
    const labels = labelsOf(direct)
    assert(labels.some((text) => text.startsWith('横视角 H ')), `${label}/${theme}: horizontal-angle label missing`)
    assert(labels.some((text) => text.includes('理论最小') || text.includes('水平覆盖下界')),
      `${label}/${theme}: distance label missing`)
    assert(labels.some((text) => text.includes('镜头中心高')), `${label}/${theme}: camera-height label missing`)
    assert(labels.every((text) => !/俯视·|侧视·|TARGET/.test(text)),
      `${label}/${theme}: retired 2D view headings must not be rendered`)
    assert(direct.commands.filter(([name]) => name === 'fillText').every(([, , x, y]) => (
      Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= direct.width && y >= 0 && y <= direct.height
    )), `${label}/${theme}: text anchors must stay within the canvas`)
    if (expectedSections === 1) {
      assert(labels.some((text) => text.includes('V 未提供') && text.includes('垂直未校核')),
        `${label}/${theme}: horizontal-only limitation must remain explicit`)
      assert(!labels.some((text) => text.startsWith('纵视角 V ')),
        `${label}/${theme}: no unsupported vertical angle should be presented`)
    }
    if (label === 'ground') {
      assert(labels.includes('4.66 m'), `${label}/${theme}: page presentation should use the conservative display minimum`)
      assert(labels.includes('目标框') && labels.includes('计算框'),
        `${label}/${theme}: target and margin frames should remain separately labelled`)
    }
    scenarioLabels.push({ theme, labels, commands: direct.commands.length })
  }

  const withArc = render(result, { supportsArc: true })
  const withoutArc = render(result, { supportsArc: false })
  const adaptedWithoutArc = render(result, { supportsArc: false, native: true })
  assert.deepEqual(adaptedWithoutArc.commands, withoutArc.commands,
    `${label}: direct and native no-arc fallback traces must match`)
  assert.equal(withoutArc.commands.filter(([name]) => name === 'arc').length, 0,
    `${label}: no-arc fallback must not issue arc commands`)
  assert(withoutArc.commands.filter(([name]) => name === 'fillRect').length
    > withArc.commands.filter(([name]) => name === 'fillRect').length,
  `${label}: no-arc fallback should draw square markers`)
  return scenarioLabels
}

const libraryCamera = cameras.find((camera) => camera.model === 'TV-6124HK')
assert(libraryCamera, 'TV-6124HK reference camera is missing')
const libraryFov = resolveLibraryFov(libraryCamera, 0, 'wide')
assert.equal(libraryFov.horizontalFov, 71)
assert.equal(libraryFov.verticalFov, 42.7)

const groundOptions = {
  widthMeters: 6,
  depthMeters: 4,
  subjectHeightMeters: 1.8,
  heightMode: 'auto',
  marginRatio: 0.1,
}
const ground = calculateGroundAreaPlacement(libraryFov, groundOptions)
assert.equal(ground.cameraSetbackMeters, 4.65, 'v2 library ground numeric solver baseline changed')
assert.equal(ground.cameraHeightMeters, 2.3, 'library ground height baseline changed')

const ts0663Camera = cameras.find((camera) => camera.model === 'TS-0663JP')
assert(ts0663Camera, 'TS-0663JP reference camera is missing')
const ts0663Fov = resolveLibraryFov(ts0663Camera, 0, 'wide')
assert.equal(ts0663Fov.horizontalFov, 44, 'TS-0663JP main-lens horizontal angle changed')
assert.equal(ts0663Fov.verticalFov, 25, 'TS-0663JP main-lens vertical angle changed')
const ts0663Ground = calculateGroundAreaPlacement(ts0663Fov, { ...groundOptions, marginRatio: 0.05 })
assert.equal(ts0663Ground.cameraSetbackMeters, 7.82, 'TS-0663JP 44/25 screenshot setback should remain 7.82 m')
assert.equal(ts0663Ground.cameraHeightMeters, 2.3, 'TS-0663JP 44/25 screenshot camera height should remain 2.3 m')

const customFov = resolveCustomFov({ definitionMode: 'angles', horizontalFov: 60, verticalFov: 36 })
const customGround = calculateGroundAreaPlacement(customFov, groundOptions)
assert.equal(customGround.cameraSetbackMeters, 5.74, 'v2 custom-optics solver baseline changed')
assert.equal(customGround.cameraHeightMeters, 2.3, 'custom-optics ground height baseline changed')

const defaultPlane = calculateVerticalPlanePlacement(libraryFov, {
  widthMeters: 6,
  heightMeters: 2.5,
  bottomHeightMeters: 0.8,
  heightMode: 'auto',
  marginRatio: 0.1,
})
assert.equal(defaultPlane.distanceMeters, 4.63, 'v2 vertical-plane numeric solver baseline changed')
assert.equal(defaultPlane.cameraHeightMeters, 2.05, 'vertical-plane height baseline changed')
assert(defaultPlane.requiredVerticalFov < defaultPlane.verticalFov - 5,
  'reference scene must retain the difference between source VFOV and target-required VFOV')
const shortHeightPlane = calculateVerticalPlanePlacement(libraryFov, {
  widthMeters: 6,
  heightMeters: 0.01,
  bottomHeightMeters: 0.8,
  heightMode: 'fixed',
  cameraHeightMeters: 1,
  marginRatio: 0.1,
})
assert(shortHeightPlane, 'a positive 0.01 m target-height scene should remain renderable')
const shortHeightScene = buildCameraScene(shortHeightPlane)
close(shortHeightScene.dimensions.top - shortHeightScene.dimensions.bottom, 0.01,
  'the short-height regression must preserve the requested target height')

const v1Ground = calculateGroundAreaPlacement(libraryFov, { ...groundOptions, calculationVersion: 1 })
assert.equal(v1Ground.primaryDistanceMeters, 4.83, 'v1 library ground compatibility value changed')
const v1CustomGround = calculateGroundAreaPlacement(customFov, { ...groundOptions, calculationVersion: 1 })
assert.equal(v1CustomGround.primaryDistanceMeters, 5.92, 'v1 custom-optics ground compatibility value changed')
const v1Plane = calculateVerticalPlanePlacement(libraryFov, {
  widthMeters: 6,
  heightMeters: 2.5,
  bottomHeightMeters: 0.8,
  heightMode: 'auto',
  marginRatio: 0.1,
  calculationVersion: 1,
})
assert.equal(v1Plane.distanceMeters, 4.63, 'v1 vertical-plane compatibility value changed')

const tallPlane = calculateVerticalPlanePlacement(libraryFov, {
  widthMeters: 3,
  heightMeters: 5,
  bottomHeightMeters: 0.5,
  heightMode: 'fixed',
  cameraHeightMeters: 1,
  marginRatio: 0.1,
})
assert(tallPlane && Math.abs(tallPlane.aimAngleDegrees) > 1, 'fixed-height plane scene should produce a real aim angle')
assert(tallPlane.requiredHorizontalFov < tallPlane.horizontalFov - 10,
  'fixed-height reference scene must retain source/required horizontal angle distinction')

const horizontalCamera = cameras.find((camera) => camera.model === 'TV-6124UK')
assert(horizontalCamera, 'horizontal-only camera reference is missing')
const horizontalFov = resolveLibraryOptics(horizontalCamera, 0, 'wide')
assert.equal(horizontalFov.horizontalOnly, true)
assert.equal(horizontalFov.verticalFov, null)
const horizontalOnly = calculateHorizontalOnlyPlacement(horizontalFov, {
  sceneMode: 'ground',
  ...groundOptions,
})
assert.equal(horizontalOnly.horizontalOnly, true)
assert.equal(horizontalOnly.verticalCoverageVerified, false)

const extremeFov = resolveCustomFov({ definitionMode: 'angles', horizontalFov: 178, verticalFov: 120 })
const crossingPlane = calculateVerticalPlanePlacement(extremeFov, {
  widthMeters: 0.5,
  heightMeters: 1,
  bottomHeightMeters: 8,
  heightMode: 'fixed',
  cameraHeightMeters: 1,
  marginRatio: 0,
})
assert(crossingPlane, 'extreme-angle crossing-plane solver case should remain available')
assert(crossingPlane, 'extreme optical boundaries crossing the front plane should remain renderable')
const knownRisk = calculateVerticalPlanePlacement({ horizontalFov: 71, verticalFov: 80, diagonalFov: 100 }, {
  widthMeters: 6,
  heightMeters: 2.5,
  bottomHeightMeters: 50,
  heightMode: 'fixed',
  cameraHeightMeters: 0.5,
  marginRatio: 0.1,
  calculationVersion: 1,
})
assert.equal(knownRisk.distanceMeters, 4.63, 'the historical v1 vertical-plane numeric witness changed')
assert.equal(knownRisk.aimAngleDegrees, 84.8, 'the historical vertical-plane aim witness changed')
assert(knownRisk.aimAngleDegrees - knownRisk.verticalFov / 2 < 90
  && knownRisk.aimAngleDegrees + knownRisk.verticalFov / 2 >= 90,
'the known optical bounds must still exercise the 90-degree crossing case')
const cases = [
  { label: 'ground', result: ground, sections: 2 },
  { label: 'custom-optics-ground', result: customGround, sections: 2 },
  { label: 'vertical-plane', result: defaultPlane, sections: 2 },
  { label: 'fixed-height-tall-plane', result: tallPlane, sections: 2 },
  { label: 'horizontal-only', result: horizontalOnly, sections: 1 },
  { label: 'extreme-crossing-plane', result: crossingPlane, sections: 2 },
  { label: 'known-tangent-boundary-risk', result: knownRisk, sections: 2 },
]
const sceneSummaries = []
const rendererSummaries = []
for (const item of cases) {
  const { scene, bounds } = assertSceneGeometry(item.result, item.label, item.sections)
  if (item.label === 'extreme-crossing-plane') {
    const vertical = scene.sections.find((section) => section.axis === 'vertical')
    assert(vertical?.clipped, 'a vertical ray that misses the front plane must use the finite clipped section')
    assert(vertical.points.every((point) => [point.x, point.y, point.z].every(Number.isFinite)),
      'clipped vertical fallback points must remain finite')
  }
  sceneSummaries.push({
    scenario: item.label,
    distance: scene.distance,
    pitchDegrees: scene.pitchDegrees,
    sectionAxes: scene.sections.map((section) => section.axis),
    verticalSectionClipped: Boolean(scene.sections.find((section) => section.axis === 'vertical')?.clipped),
    scale390x302: bounds.scale,
    targetBounds390x302: bounds.targetBounds,
  })
  rendererSummaries.push({
    scenario: item.label,
    themes: assertCurrentRenderer(item.result, item.label, item.sections),
  })
}

for (const item of [
  { label: 'TS-0663JP44-25-ground', result: ts0663Ground },
  { label: 'height-plane', result: defaultPlane },
]) {
  for (const size of [
    { width: 320, height: 302 },
    { width: 331, height: 350 },
    { width: 390, height: 302 },
  ]) {
    for (const theme of ['dark', 'light']) {
      assertHeightLabelClearance(item.result, item.label, size.width, size.height, theme)
    }
  }
}

{
  const rendered = render(shortHeightPlane, { width: 320, height: 302, theme: 'dark' })
  const heightValue = `${displayNumber(shortHeightScene.dimensions.top - shortHeightScene.dimensions.bottom)} m`
  assert(labelsOf(rendered).includes(heightValue),
    'the 0.01 m regression must preserve the rendered numeric height text')
  const dimension = projectedHeightDimension(shortHeightScene, 320, 302)
  const heightMidX = (dimension.start.x + dimension.end.x) / 2
  const heightMidY = (dimension.start.y + dimension.end.y) / 2
  assert(heightMidY >= Math.min(dimension.start.y, dimension.end.y)
    && heightMidY <= Math.max(dimension.start.y, dimension.end.y),
  'the short-height leader attachment must stay between the shaft endpoints')
  const heightLabel = shortHeightScene.ground ? '目标最高' : '目标高'
  const textLeft = dimension.titleX - Math.max(recordedTextWidth(heightLabel, 10.5), recordedTextWidth(heightValue, 12))
  const leaderEndX = textLeft - 5
  assert(leaderEndX > heightMidX, 'the short-height annotation leader must have positive length')
  assert(renderedStrokeSegments(rendered.commands).some(([start, end]) => (
    Math.abs(start.x - heightMidX) < 1e-7
      && Math.abs(start.y - heightMidY) < 1e-7
      && Math.abs(end.x - leaderEndX) < 1e-7
      && Math.abs(end.y - heightMidY) < 1e-7
  )), 'the 0.01 m leader must begin at the shaft midpoint and extend toward the annotation')
}

for (const item of [
  { label: 'TS-0663JP44-25-ground', result: ts0663Ground },
  { label: 'height-plane', result: defaultPlane },
]) {
  for (const viewportWidth of [320, 350, 375, 390, 430]) {
    for (const theme of ['dark', 'light']) {
      assertHeightPairAvoidsCameraToolbar(item.result, item.label, viewportWidth, theme)
    }
  }
}

const clippingRender = render(crossingPlane, { theme: 'dark' })
assert(labelsOf(clippingRender).includes('垂直截面按前沿交会范围截取'),
  'clipped optical section must be explained in the current spatial renderer')

const summary = {
  status: 'passed',
  numericSolver: {
    v2LibraryGroundMeters: ground.primaryDistanceMeters,
    v2CustomOpticsGroundMeters: customGround.primaryDistanceMeters,
    v2PlaneMeters: defaultPlane.distanceMeters,
    v1LibraryGroundMeters: v1Ground.primaryDistanceMeters,
    v1CustomOpticsGroundMeters: v1CustomGround.primaryDistanceMeters,
    v1PlaneMeters: v1Plane.distanceMeters,
  },
  current3d: {
    scenes: sceneSummaries,
    renderer: rendererSummaries,
    checks: [
      'shared lens-centre apex and real front-plane section intersections',
      'source optical angles and camera-normal frame depth',
      'orthographic scene bounds and non-degenerate target frame',
      'dark/light label rendering and direct/native Canvas parity',
      'camera page height annotation pair follows the projected shaft through a connected right-side channel',
      'arc-supported rendering and square-marker no-arc fallback',
      'finite clipped vertical section and current spatial warning label',
      'horizontal-only output does not invent a vertical angle',
    ],
  },
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

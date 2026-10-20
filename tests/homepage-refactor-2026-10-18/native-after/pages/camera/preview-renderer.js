const { buildCameraScene, fitCameraScene } = require('./camera-scene')

function adaptCanvas2dContext(context) {
  return {
    setFillStyle: (value) => { context.fillStyle = value },
    setStrokeStyle: (value) => { context.strokeStyle = value },
    setLineWidth: (value) => { context.lineWidth = value },
    setFontSize: (value) => { context.font = `${value}px -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif` },
    setTextAlign: (value) => { context.textAlign = value },
    measureText: (value) => Number(context.measureText?.(String(value))?.width) || String(value).length * 7,
    setLineDash: (value) => context.setLineDash?.(value),
    supportsArc: typeof context.arc === 'function',
    beginPath: () => context.beginPath(), closePath: () => context.closePath(),
    moveTo: (...args) => context.moveTo(...args), lineTo: (...args) => context.lineTo(...args),
    arc: (...args) => context.arc(...args), rect: (...args) => context.rect(...args),
    clip: () => context.clip(), save: () => context.save(), restore: () => context.restore(),
    fill: () => context.fill(), stroke: () => context.stroke(),
    fillRect: (...args) => context.fillRect(...args), strokeRect: (...args) => context.strokeRect(...args),
    fillText: (...args) => context.fillText(...args),
  }
}

const DARK = {
  background: '#000000', text: '#eef2f6', muted: '#a9b8c1', ghost: '#50777d', ground: '#43858d',
  target: '#73d1da', groundFill: '#0c2227', dimension: '#48dce6', witness: '#438b93',
  h: '#4caafa', hFill: 'rgba(38,152,236,.14)', v: '#bd8af6', vFill: 'rgba(173,115,241,.14)',
  margin: '#e9b654', marginFill: 'rgba(229,177,80,.23)',
  body: ['#9ba8b5', '#cad3dd', '#77828e', '#1a222c'], bodyEdge: '#d4dde6',
  person: '#a0afbb', personBody: '#8395a2', neutral: '#aab9c5', lens: '#08141b',
}
const LIGHT = {
  background: '#f6f7f9', text: '#243746', muted: '#586e7a', ghost: '#6b9298', ground: '#42828a',
  target: '#087e87', groundFill: '#e5eeee', dimension: '#12828c', witness: '#4d929a',
  h: '#087bc9', hFill: 'rgba(38,152,236,.12)', v: '#8750ca', vFill: 'rgba(140,83,205,.13)',
  margin: '#a86b00', marginFill: 'rgba(200,140,20,.17)',
  body: ['#8797a7', '#c4cfd8', '#778a9a', '#263a47'], bodyEdge: '#647b89',
  person: '#708894', personBody: '#8fa2ad', neutral: '#687c8c', lens: '#152a34',
}

function number(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1') : '—'
}

function path(context, points, fill, stroke, lineWidth = 1, closed = true, dash = []) {
  if (!points.length) return
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y))
  if (closed) context.closePath()
  if (fill) { context.setFillStyle(fill); context.fill() }
  if (stroke) {
    context.setStrokeStyle(stroke); context.setLineWidth(lineWidth); context.setLineDash(dash); context.stroke(); context.setLineDash([])
  }
}

function text(context, value, x, y, color, size = 12, align = 'left') {
  context.setFillStyle(color); context.setFontSize(size); context.setTextAlign(align)
  context.fillText(value, x, y)
}

function dot(context, point, radius, fill, stroke) {
  if (context.supportsArc) {
    context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2)
    context.setFillStyle(fill); context.fill()
    if (stroke) { context.setStrokeStyle(stroke); context.setLineWidth(0.8); context.stroke() }
  } else {
    context.setFillStyle(fill); context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2)
  }
}

function arrow(context, start, end, color) {
  path(context, [start, end], null, color, 1, false)
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length < 2) return
  const dx = (end.x - start.x) / length
  const dy = (end.y - start.y) / length
  const size = Math.min(5, length / 4)
  const head = (point, direction) => path(context, [point,
    { x: point.x + direction * dx * size - dy * 2, y: point.y + direction * dy * size + dx * 2 },
    { x: point.x + direction * dx * size + dy * 2, y: point.y + direction * dy * size - dx * 2 }], color)
  head(start, 1); head(end, -1)
}

function dimension(context, actualStart, actualEnd, offset, colors, label, labelOffset = { x: 0, y: 17 }) {
  const start = { x: actualStart.x + offset.x, y: actualStart.y + offset.y }
  const end = { x: actualEnd.x + offset.x, y: actualEnd.y + offset.y }
  path(context, [actualStart, start], null, colors.witness, 0.65, false)
  path(context, [actualEnd, end], null, colors.witness, 0.65, false)
  arrow(context, start, end, colors.dimension)
  if (label) text(context, label, (start.x + end.x) / 2 + labelOffset.x,
    (start.y + end.y) / 2 + labelOffset.y, colors.dimension, 12, 'center')
  return { start, end }
}

function drawPerson(context, person, project, scale, colors) {
  const h = person.height
  // Upright illustrative people face the orthographic viewer. Their height
  // and every joint still use world units and the same scene scale.
  const point = (y, z) => project({ x: person.x + y * h * Math.SQRT1_2,
    y: person.y + y * h * Math.SQRT1_2, z: z * h })
  const thickness = Math.max(0.45, h * 0.046 * scale)
  path(context, [point(-0.045, 0.53), point(-0.052, 0.06), point(-0.09, 0.025)], null, colors.person, thickness, false)
  path(context, [point(0.045, 0.53), point(0.052, 0.06), point(0.09, 0.025)], null, colors.person, thickness, false)
  path(context, [point(-0.065, 0.81), point(-0.135, 0.64), point(-0.145, 0.42)], null, colors.person, thickness * 0.8, false)
  path(context, [point(0.065, 0.81), point(0.135, 0.64), point(0.145, 0.42)], null, colors.person, thickness * 0.8, false)
  path(context, [point(-0.07, 0.82), point(0.07, 0.82), point(0.08, 0.52), point(-0.08, 0.52)], colors.personBody, colors.person, 0.5)
  path(context, [point(0, 0.82), point(0.06, 0.82), point(0.07, 0.53), point(0, 0.53)], colors.person)
  dot(context, point(0, 0.94), h * 0.065 * scale, colors.person)
}

function drawCamera(context, scene, project, colors) {
  const body = scene.body.map(project)
  ;[[0, 1, 3, 2], [1, 5, 7, 3], [2, 3, 7, 6], [4, 5, 7, 6]].forEach((indices, index) => {
    path(context, indices.map((i) => body[i]), colors.body[index], colors.bodyEdge, 0.7)
  })
  const radius = Math.max(1, Math.hypot(body[5].x - body[4].x, body[5].y - body[4].y) * 0.24)
  dot(context, project(scene.lens), radius, colors.lens, colors.ground)
  dot(context, project(scene.lens), radius * 0.35, colors.h)
}

function drawMarginRing(context, outer, inner, color) {
  // Four strips form one subtle ring, leaving its centre unfilled. They are
  // framing allowance, never additional optical frustum faces.
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4
    path(context, [outer[index], outer[next], inner[next], inner[index]], color)
  }
}

function drawPreviewAtSize(context, result, width, height, view = 'spatial', theme = 'dark') {
  if (!context || !result || !(Number(width) > 0) || !(Number(height) > 0)) return
  const colors = theme === 'light' ? LIGHT : DARK
  context.setFillStyle(colors.background); context.fillRect(0, 0, width, height)
  const scene = buildCameraScene(result)
  if (!scene) { text(context, '当前条件无法生成有限三维截面', width / 2, height / 2, colors.muted, 12, 'center'); return }
  const { project, scale } = fitCameraScene(scene, width, height)
  const site = scene.site.map(project)
  const siteTop = scene.siteTop.map(project)
  if (scene.ground) {
    path(context, site, colors.groundFill, colors.ground, 0.9)
    path(context, siteTop, null, colors.ghost, 0.65, true, [3, 4])
    site.forEach((point, index) => path(context, [point, siteTop[index]], null, colors.ghost, 0.65, false, [3, 4]))
  } else {
    path(context, [site[0], site[3], siteTop[3], siteTop[0]], null, colors.ghost, 0.8, true, [3, 4])
  }
  scene.sections.forEach((section) => path(context, section.points.map(project),
    section.axis === 'horizontal' ? colors.hFill : colors.vFill,
    section.axis === 'horizontal' ? colors.h : colors.v, 1))
  const lens = project(scene.lens)
  const axisEnd = project({ x: scene.distance, y: 0, z: scene.dimensions.cameraHeight + scene.distance * Math.tan(scene.pitchDegrees * Math.PI / 180) })
  path(context, [lens, axisEnd], null, colors.neutral, 0.55, false, [3, 5])
  scene.people.sort((a, b) => (b.x - b.y) - (a.x - a.y)).forEach((person) => drawPerson(context, person, project, scale, colors))
  const inner = scene.innerFrame.map(project)
  if (scene.outerFrame) {
    const outer = scene.outerFrame.map(project)
    drawMarginRing(context, outer, inner, colors.marginFill)
    path(context, outer, null, colors.margin, 1.4)
  }
  path(context, inner, null, colors.target, 1.1)
  const ground = project(scene.groundProjection)
  path(context, [lens, ground], null, colors.neutral, 0.6, false, [3, 4])
  dot(context, ground, 1.8, colors.neutral)
  drawCamera(context, scene, project, colors)

  const angleX = Math.max(12, width * (scene.ground ? 0.15 : 0.1))
  const angleY = scene.horizontalOnly ? 32 : 84
  text(context, `横视角 H ${number(result.horizontalFov)}°`, angleX, angleY, colors.h, 13)
  text(context, scene.horizontalOnly ? 'V 未提供 · 垂直未校核' : `纵视角 V ${number(result.verticalFov)}°`,
    angleX, angleY + 25, scene.horizontalOnly ? colors.muted : colors.v, scene.horizontalOnly ? 12 : 13)
  scene.sections.forEach((section) => {
    if (scene.horizontalOnly) return
    const points = section.points.map(project)
    const center = { x: (points[0].x + points[1].x + points[2].x) / 3,
      y: (points[0].y + points[1].y + points[2].y) / 3 }
    const horizontal = section.axis === 'horizontal'
    path(context, [{ x: angleX + (horizontal ? 98 : 75), y: horizontal ? 89 : 114 },
      { x: angleX + (horizontal ? 108 : 72), y: horizontal ? 104 : 137 }, center], null,
    horizontal ? colors.h : colors.v, 0.6, false)
  })
  const clipped = scene.sections.some((section) => section.clipped)
  if (clipped) text(context, '垂直截面按前沿交会范围截取', angleX, 130, colors.muted, 11)
  const pitchLabel = scene.horizontalOnly ? '初始瞄准未校核' : `${scene.pitchDegrees < 0 ? '俯角' : scene.pitchDegrees > 0 ? '仰角' : '俯仰'} ${number(Math.abs(Number(result.aimAngleDegrees ?? scene.pitchDegrees)))}°`
  if (!scene.horizontalOnly) text(context, pitchLabel, Math.max(8, lens.x - 28), Math.max(88, lens.y - 24), colors.text, 12)
  const marginX = width - 57
  text(context, `${scene.historical ? '旧版余量' : '取景余量'} ${number(result.marginPercent)}%`, marginX, 79, colors.margin, 12, 'right')
  if (scene.marginRatio > 0) {
    text(context, '目标框', marginX - 45, 96, colors.target, 10.5, 'right')
    text(context, '计算框', marginX, 96, colors.margin, 10.5, 'right')
  } else text(context, '目标框 · 无额外余量', marginX, 96, colors.target, 10.5, 'right')

  const heightLineX = Math.max(7, lens.x - 18)
  dimension(context, lens, ground, { x: heightLineX - lens.x, y: 0 }, colors)
  text(context, '镜头中心高', Math.max(8, lens.x - 9), ground.y + 16, colors.muted, 10.5)
  text(context, `${number(result.cameraHeightMeters)} m`, Math.max(8, lens.x - 9), ground.y + 33, colors.dimension, 13)
  dimension(context, site[0], site[3], { x: -3, y: 21 }, colors, `宽 ${number(result.widthMeters)} m`,
    { x: scene.horizontalOnly ? 25 : 0, y: 17 })
  if (scene.ground) dimension(context, site[3], site[2], { x: 9, y: 22 }, colors,
    `纵深 ${number(result.depthMeters)} m`, { x: 15, y: 15 })
  const highestIndex = scene.ground ? 2 : 3
  const heightOffset = Math.max(7, Math.min(16, width - 8 - site[highestIndex].x))
  dimension(context, siteTop[highestIndex], site[highestIndex], { x: heightOffset, y: 0 }, colors)
  const labelX = Math.min(width - 5, site[highestIndex].x + heightOffset + 5)
  const heightY = (site[highestIndex].y + siteTop[highestIndex].y) / 2
  text(context, scene.ground ? '目标最高' : '目标高', labelX, heightY - 3, colors.muted, 10.5, 'right')
  text(context, `${number(scene.dimensions.top - scene.dimensions.bottom)} m`, labelX, heightY + 14, colors.dimension, 12, 'right')
  const setback = dimension(context, ground, project(scene.frontCenter), { x: 30, y: 60 },
    { ...colors, dimension: colors.neutral })
  const midpoint = { x: (setback.start.x + setback.end.x) / 2, y: Math.max(setback.start.y, setback.end.y) + 22 }
  text(context, result.horizontalOnly ? '水平覆盖下界 · 前沿' : scene.ground ? '理论最小前沿退距' : '理论最小水平距离',
    width / 2, Math.min(height - 27, midpoint.y), colors.muted, 11, 'center')
  text(context, `${number(result.primaryDistanceMeters)} m`, width / 2, Math.min(height - 7, midpoint.y + 21), colors.text, 17, 'center')
}

module.exports = { adaptCanvas2dContext, drawPreviewAtSize }

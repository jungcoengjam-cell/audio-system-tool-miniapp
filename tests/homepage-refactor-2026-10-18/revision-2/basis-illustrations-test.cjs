'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const registry = require(path.join(root, 'utils/tool-registry'))
const { buildBasisPresentation } = require(path.join(root, 'pages/basis/presentation'))
const { calculateConstantVoltageCable } = require(path.join(root, 'utils/cable'))
const { launch, delay } = require('../browser-driver.cjs')
const ids = ['cable', 'gainStructure', 'limiter', 'spl', 'camera', 'ledScreen']
const requiredFigureText = {
  cable: ['输入单程距离（m）', '单芯截面积 S', '公司对照表', 'P表=总功率×1.5', 'P[kW] = P表[W] ÷ 1000', 'L[km] = 输入m ÷ 1000', 'S ≥ P × L × 5'],
  gainStructure: ['0 dBFS', '本设备实测', '+18.4 dBu', '满功率', '总衰减'],
  limiter: ['音箱保护上限', '功放可提供上限', 'V_target = min(', 'V_speaker, V_amp)', 'dBu → dBFS'],
  spl: ['1 m 参考', '目标距离 d', '20 log₁₀(d)', '相干'],
  camera: ['非比例', '地面区域 8 角点', '垂直目标面 4 角点', '相机 C', '退距 D', '俯仰 θ', '水平边界', '垂直边界'],
  ledScreen: ['墙面可用净空间', '上方预留', '下方预留', '包边', '整数行 × 列', 'cm'],
}
const intendedTextPanels = {
  cable: [
    { text: 'P表=总功率×1.5', bounds: [28, 392, 205, 148] },
    { text: 'P[kW] = P表[W] ÷ 1000', bounds: [487, 392, 235, 148] },
    { text: 'L[km] = 输入m ÷ 1000', bounds: [487, 392, 235, 148] },
  ],
  gainStructure: [
    { text: '本设备实测', bounds: [262, 112, 222, 160] },
    { text: '满功率输入', bounds: [494, 121, 225, 235] },
  ],
  limiter: [
    { text: '按额定功率和总阻抗', bounds: [31, 122, 280, 160] },
    { text: '按说明书额定功率点', bounds: [439, 122, 280, 160] },
  ],
  camera: [
    { text: '地面区域 8 角点', bounds: [44, 137, 172, 38] },
    { text: '垂直目标面 4 角点', bounds: [225, 137, 215, 38] },
  ],
  ledScreen: [
    { text: '比例误差筛选；像素按净尺寸 ÷ 标称点间距 P 估算', bounds: [31, 478, 688, 48] },
  ],
}

function pageText(markup) {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function checkIllustrations() {
  const sourceDir = path.join(__dirname, 'illustration-sources')
  const assetDir = path.join(root, 'assets/basis')
  let bytes = 0
  let sourceBytes = 0
  for (const id of ids) {
    const sourceFile = path.join(sourceDir, id + '.svg')
    const imageFile = path.join(assetDir, id + '.png')
    assert.ok(fs.existsSync(sourceFile), 'missing editable SVG source: ' + id)
    assert.ok(fs.existsSync(imageFile), 'missing displayed PNG: ' + id)
    const source = fs.readFileSync(sourceFile, 'utf8')
    const png = fs.readFileSync(imageFile)
    sourceBytes += fs.statSync(sourceFile).size
    bytes += png.length
    assert.match(source, /<svg[^>]*width="750"[^>]*height="560"[^>]*viewBox="0 0 750 560"/, id + ' dimensions')
    assert.match(source, /<title\b/, id + ' accessible title')
    const visible = pageText(source)
    for (const phrase of requiredFigureText[id]) assert.ok(visible.includes(phrase), id + ' figure missing label: ' + phrase)
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], id + ' PNG signature')
    assert.equal(png.readUInt32BE(16), 750, id + ' PNG width')
    assert.equal(png.readUInt32BE(20), 560, id + ' PNG height')
    const tool = registry.getBasisTool(id)
    const presentation = buildBasisPresentation(tool)
    assert.equal(presentation.figure.src, '/assets/basis/' + id + '.png')
    assert.ok(presentation.figure.alt.length > 20, id + ' figure needs meaningful alternative text')
    assert.deepEqual(
      JSON.parse(JSON.stringify(presentation.completeExplanation)),
      {
        what: tool.basis.what,
        method: tool.basis.method,
        inputs: tool.basis.inputs,
        sourceSummary: tool.basis.sourceSummary,
        limits: tool.basis.limits,
      },
      id + ' original explanation must remain intact',
    )
    assert.ok(presentation.quick.method.length < tool.basis.method.length, id + ' primary method should be concise')
  }
  const cable = buildBasisPresentation(registry.getBasisTool('cable')).quick
  assert.match(cable.method, /公司表按单程距离 m、功率 W 查档/)
  assert.match(cable.method, /P\[kW\]=P表\[W\]÷1000/)
  assert.match(cable.method, /L\[km\]=距离\[m\]÷1000/)
  assert.match(cable.figureCaption, /单程距离（m）.*按 m 与功率 W 查档.*P\[kW\].*L\[km\]/)
  const converted = calculateConstantVoltageCable({ totalPowerW: 1000, distanceMeters: 1000, environment: 'indoor' })
  assert.deepEqual(
    { distanceMeters: converted.distanceMeters, designPowerW: converted.designPowerW, formulaMinimumArea: converted.formulaMinimumArea },
    { distanceMeters: 1000, designPowerW: 1500, formulaMinimumArea: 7.5 },
    'company formula uses input meters and watts converted to km and kW before S ≥ P × L × 5',
  )
  return { bytes, sourceBytes, withinBudget: bytes <= 150 * 1024 }
}

async function checkSvgTextLayout() {
  const browser = await launch()
  const report = []
  try {
    await browser.viewport(750, 560, 'light')
    for (const id of ids) {
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${browser.port}/tests/homepage-refactor-2026-10-18/revision-2/basis-illustration-render.html?id=${id}` })
      let ready = false
      for (let attempt = 0; attempt < 80; attempt += 1) {
        ready = await browser.evaluate('document.readyState === "complete"')
        if (ready) break
        await delay(50)
      }
      assert.ok(ready, id + ' SVG render page did not load')
      const boxes = await browser.evaluate(`(async () => {
        const response = await fetch('illustration-sources/${id}.svg')
        if (!response.ok) throw new Error('SVG source unavailable: ${id}')
        const source = await response.text()
        const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
        const svg = parsed.documentElement
        document.body.replaceChildren(document.importNode(svg, true))
        await document.fonts.ready
        return [...document.querySelectorAll('svg text')].map((node, index) => {
          const box = node.getBBox()
          return { index, text: node.textContent.trim(), x: box.x, y: box.y, width: box.width, height: box.height }
        })
      })()`)
      assert.ok(boxes.length > 0, id + ' SVG has no measurable text')
      const outOfBounds = boxes.filter((box) => box.x < -0.5 || box.y < -0.5 || box.x + box.width > 750.5 || box.y + box.height > 560.5)
      assert.deepEqual(outOfBounds, [], id + ' SVG text must stay inside the 750 × 560 canvas')
      for (const rule of intendedTextPanels[id] || []) {
        const box = boxes.find((item) => item.text === rule.text)
        assert.ok(box, id + ' missing measured panel label: ' + rule.text)
        const [x, y, width, height] = rule.bounds
        assert.ok(box.x >= x && box.y >= y && box.x + box.width <= x + width && box.y + box.height <= y + height, id + ' panel label exceeds its card: ' + rule.text)
      }
      const overlaps = []
      for (let left = 0; left < boxes.length; left += 1) {
        for (let right = left + 1; right < boxes.length; right += 1) {
          const a = boxes[left]
          const b = boxes[right]
          const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          if (width > 1 && height > 1) overlaps.push({ first: a.text, second: b.text, intersection: [Math.round(width), Math.round(height)] })
        }
      }
      assert.deepEqual(overlaps, [], id + ' SVG text boxes must not overlap')
      report.push({ id, textNodes: boxes.length, outOfBounds: outOfBounds.length, overlaps: overlaps.length })
    }
  } finally {
    await browser.close()
  }
  return report
}

function checkDetailToggleAndRoutes() {
  const detailPath = path.join(root, 'pages/basis/detail.js')
  delete require.cache[require.resolve(detailPath)]
  const originalPage = global.Page
  const originalWx = global.wx
  const originalGetCurrentPages = global.getCurrentPages
  let definition
  const navigation = []
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateBack: (options) => navigation.push({ kind: 'back', options }),
    navigateTo: (options) => navigation.push({ kind: 'to', options }),
  }
  global.getCurrentPages = () => []
  try {
    require(detailPath)
    assert.ok(definition, 'detail page definition should load')
    const context = {
      data: { ...definition.data },
      setData(update) { this.data = { ...this.data, ...update } },
    }
    for (const id of ids) {
      definition.onLoad.call(context, { tool: id })
      assert.equal(context.data.notFound, false, id + ' should resolve')
      assert.equal(context.data.showFullExplanation, false, id + ' explanation starts collapsed')
      assert.equal(context.data.presentation.figure.src, '/assets/basis/' + id + '.png')
      definition.toggleFullExplanation.call(context)
      assert.equal(context.data.showFullExplanation, true, id + ' expands full explanation')
      definition.toggleFullExplanation.call(context)
      assert.equal(context.data.showFullExplanation, false, id + ' collapses full explanation')
      navigation.length = 0
      global.getCurrentPages = () => [{ route: context.data.basisTool.path.replace(/^\//, '') }, { route: 'pages/basis/detail' }]
      definition.openTool.call(context)
      assert.deepEqual(navigation[0], { kind: 'back', options: { delta: 1 } }, id + ' returns to previous tool route')
      navigation.length = 0
      global.getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'pages/basis/detail' }]
      definition.openTool.call(context)
      assert.deepEqual(navigation[0], { kind: 'to', options: { url: context.data.basisTool.path } }, id + ' opens the same tool route')
    }
    definition.onLoad.call(context, { tool: 'unknown' })
    assert.equal(context.data.notFound, true, 'unknown basis keeps the existing empty state')
  } finally {
    if (originalPage === undefined) delete global.Page
    else global.Page = originalPage
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
    if (originalGetCurrentPages === undefined) delete global.getCurrentPages
    else global.getCurrentPages = originalGetCurrentPages
    delete require.cache[require.resolve(detailPath)]
  }
}

function checkMarkup() {
  const detail = fs.readFileSync(path.join(root, 'pages/basis/detail.wxml'), 'utf8')
  const directory = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
  for (const field of ['what', 'method', 'inputs', 'sourceSummary', 'limits']) {
    assert.ok(detail.includes('presentation.completeExplanation.' + field), 'full explanation omits ' + field)
  }
  assert.match(detail, /bindtap="toggleFullExplanation"/)
  assert.match(detail, /aria-expanded="\{\{showFullExplanation\}\}"/)
  assert.match(detail, /mode="widthFix"/)
  assert.match(detail, /bindtap="openTool"/)
  assert.ok(!directory.includes('home-basis-category'), 'basis directory must not show category badges')
  assert.ok(!fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8').includes('.home-basis-category'), 'category badge style should be removed')
}

async function main() {
  const illustrationBytes = checkIllustrations()
  const textLayout = await checkSvgTextLayout()
  checkDetailToggleAndRoutes()
  checkMarkup()
  console.log(JSON.stringify({ assets: ids.length, totalPngBytes: illustrationBytes.bytes, totalSvgSourceBytes: illustrationBytes.sourceBytes, pngBudget150KiB: illustrationBytes.withinBudget, svgTextLayout: textLayout, pageRoutes: ids.length, fullExplanation: 'preserved and toggleable', categoryBadge: 'removed' }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

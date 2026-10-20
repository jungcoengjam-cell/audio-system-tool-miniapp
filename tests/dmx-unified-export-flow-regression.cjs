'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const storage = new Map()
const routeEvents = []
let exportSequence = 0
let activeExportContext = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function setDataPath(target, dataPath, value) {
  const segments = dataPath.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current = target
  segments.slice(0, -1).forEach((segment) => {
    if (!current[segment] || typeof current[segment] !== 'object') current[segment] = {}
    current = current[segment]
  })
  current[segments[segments.length - 1]] = value
}

function instantiateRegisteredPage(relativePath) {
  let definition = null
  global.Page = (value) => { definition = value }
  const absolute = path.join(root, relativePath)
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  assert(definition, relativePath + ' did not register a Page')
  return {
    ...definition,
    data: clone(definition.data),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setDataPath(this.data, key, value))
      if (callback) callback()
    },
  }
}

function createRecordingContext() {
  const calls = []
  const state = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '16px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineDashOffset: 0,
  }
  const fontSize = () => {
    const match = String(state.font).match(/([\d.]+)px/)
    return match ? Number(match[1]) : 16
  }
  return new Proxy({ calls, state }, {
    get(target, name) {
      if (name === 'measureText') {
        return (value) => ({
          width: require('../pages/dmx-layout/layout-renderer').estimateExportTextWidth(String(value), fontSize()),
          actualBoundingBoxAscent: fontSize() * .82,
          actualBoundingBoxDescent: fontSize() * .24,
        })
      }
      if (name === 'fillText') {
        return (value, x, y) => {
          calls.push({
            op: 'fillText',
            text: String(value),
            x: Number(x),
            y: Number(y),
            fontSize: fontSize(),
            align: state.textAlign,
            width: require('../pages/dmx-layout/layout-renderer').estimateExportTextWidth(String(value), fontSize()),
          })
        }
      }
      if (name === 'setTransform') return (...args) => calls.push({ op: 'setTransform', args })
      if (name in target) return target[name]
      return (...args) => calls.push({ op: String(name), args })
    },
    set(target, name, value) {
      state[name] = value
      return true
    },
  })
}

function createCanvasNode(context) {
  return {
    width: 0,
    height: 0,
    getContext(type) {
      assert.strictEqual(type, '2d')
      return context
    },
    requestAnimationFrame(callback) {
      callback(Date.now())
      return 1
    },
    cancelAnimationFrame() {},
  }
}

function installWx() {
  const stageContext = createRecordingContext()
  const exportContext = createRecordingContext()
  const stageCanvas = createCanvasNode(stageContext)
  const exportCanvas = createCanvasNode(exportContext)
  const actions = { previews: [], shares: [], saves: [], toasts: [], loading: [] }
  const wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, clone(value)) },
    removeStorageSync(key) { storage.delete(key) },
    getStorageInfoSync() { return { currentSize: 0, limitSize: 10240 } },
    getSystemInfoSync() { return { theme: 'light', windowWidth: 390, windowHeight: 844, pixelRatio: 1, statusBarHeight: 24 } },
    getWindowInfo() {
      return {
        theme: 'light',
        windowWidth: 390,
        windowHeight: 844,
        pixelRatio: 1,
        statusBarHeight: 24,
        safeArea: { top: 24, bottom: 820 },
      }
    },
    getMenuButtonBoundingClientRect() { return { left: 300, top: 28, right: 380, bottom: 60 } },
    onThemeChange() {},
    offThemeChange() {},
    setNavigationBarTitle() {},
    enableAlertBeforeUnload() {},
    disableAlertBeforeUnload() {},
    showToast(options = {}) { actions.toasts.push(options) },
    showLoading(options = {}) { actions.loading.push({ kind: 'show', ...options }) },
    hideLoading() { actions.loading.push({ kind: 'hide' }) },
    vibrateShort() {},
    navigateTo(options) { routeEvents.push(options.url) },
    navigateBack() {},
    switchTab() {},
    previewImage(options) { actions.previews.push(options) },
    showShareImageMenu(options) { actions.shares.push(options) },
    saveImageToPhotosAlbum(options) {
      actions.saves.push(options)
      if (options.success) options.success()
    },
    createSelectorQuery() {
      const selections = []
      const query = {
        in() { return this },
        select(selector) {
          const selection = { selector, rect: null, fields: null }
          selections.push(selection)
          return {
            boundingClientRect(callback) { selection.rect = callback; return query },
            fields(_options, callback) { selection.fields = callback; return query },
          }
        },
        exec(callback) {
          selections.forEach((selection) => {
            if (selection.rect) selection.rect({ left: 0, top: 0, width: 760, height: 760 })
            if (selection.fields) {
              if (selection.selector === '#dmxLayoutExportCanvas') {
                selection.fields({ node: exportCanvas, width: 1120, height: 1160 })
              } else {
                selection.fields({ node: stageCanvas, width: 760, height: 760 })
              }
            }
          })
          if (callback) callback()
        },
      }
      return query
    },
    canvasToTempFilePath(options) {
      assert.strictEqual(options.canvas, exportCanvas, 'Export callback did not receive the export canvas')
      exportSequence += 1
      activeExportContext = exportContext
      const currentPath = 'temp://dmx-unified-' + exportSequence + '.png'
      setTimeout(() => options.success({ tempFilePath: currentPath }), 0)
    },
  }
  global.wx = wx
  return { wx, actions, exportContext, exportCanvas }
}

function makePreferences(counts) {
  return {
    startAddressText: '1',
    allocationMode: 'auto',
    groupSummary: counts.map((count, index) => '测试组' + (index + 1) + '×' + count + '（1CH）').join('；'),
    groups: counts.map((count, index) => ({
      name: '测试组' + (index + 1),
      fixtureSource: 'custom',
      fixtureModel: '',
      libraryChannelCount: '',
      customName: '测试组' + (index + 1),
      customChannelCount: '1',
      channelCount: '1',
      fixtureCount: String(count),
    })),
  }
}

function assignPositions(layout, fixtures) {
  const rods = layout.internalRods.concat(layout.frontRods)
  const placedFixtures = fixtures.slice(0, Math.max(0, fixtures.length - 1))
  const countByRod = rods.map((_, rodIndex) => placedFixtures.filter((_, index) => index % rods.length === rodIndex).length)
  placedFixtures.forEach((fixture, index) => {
    const rodIndex = index % rods.length
    const order = Math.floor(index / rods.length)
    const count = countByRod[rodIndex]
    layout.positionsById[fixture.stableId] = {
      rodId: rods[rodIndex].id,
      t: count <= 1 ? .5 : .05 + (order / (count - 1)) * .9,
    }
  })
  return {
    placed: placedFixtures.length,
    unplaced: fixtures.slice(placedFixtures.length),
  }
}

function parseRouteQuery(url) {
  const query = String(url).split('?')[1] || ''
  return Object.fromEntries(new URLSearchParams(query).entries())
}

function findHandlerTag(wxml, className, eventName = 'bindtap') {
  const tags = [...wxml.matchAll(/<view\b[^>]*>/g)].map((match) => match[0])
  const tag = tags.find((candidate) => candidate.includes('class="' + className))
  assert(tag, 'WXML view class not found: ' + className)
  const match = tag.match(new RegExp('\\b' + eventName + '="([^"]+)"'))
  assert(match, 'WXML handler missing for ' + className)
  return match[1]
}

function findButtonHandler(wxml, className) {
  const tags = [...wxml.matchAll(/<(?:button|image)\b[^>]*>/g)].map((match) => match[0])
  const tag = tags.find((candidate) => candidate.includes('class="' + className))
  assert(tag, 'WXML button/image class not found: ' + className)
  const match = tag.match(/\bbindtap="([^"]+)"/)
  assert(match, 'WXML action binding missing for ' + className)
  return match[1]
}

function assertBaseDiagramFloor(page, label) {
  const addressReserve = page.addressLayout.height ? page.addressLayout.height + 16 : 0
  const baseDerivedHeight = Math.max(100, 1160 - page.diagramTop - addressReserve - 48)
  const maxAvailableHeight = Math.max(100, 4096 - page.diagramTop - addressReserve - 48)
  const expectedMinimum = Math.min(baseDerivedHeight, maxAvailableHeight)
  assert(page.diagramHeight >= expectedMinimum,
    label + ': export diagram fell below the base-height-derived floor (' + page.diagramHeight + ' < ' + expectedMinimum + ')')
  return expectedMinimum
}

function runEmptyDiagramHeightCase() {
  const renderer = require('../pages/dmx-layout/layout-renderer')
  const model = require('../pages/dmx-layout/layout-model')
  const layout = model.createDefaultStageLayout('12', '8', (kind, index) => kind + '-' + (index + 1))
  const snapshot = { contextLabel: '空场景', layout, fixtures: [] }
  const page = renderer.buildLightingExportPages(snapshot, { width: 1120, height: 1160 })[0]
  const expectedMinimum = assertBaseDiagramFloor(page, 'empty diagram')
  const context = createRecordingContext()
  renderer.renderLightingExportPage(context, snapshot, page)
  assert(context.calls.some((call) => call.op === 'fillText' && call.text === '灯位图'), 'empty export omitted the diagram title')
  assert(context.calls.some((call) => call.op === 'stroke' || call.op === 'strokeRect'), 'empty export omitted stage/rod drawing')
  return { label: 'empty', diagramHeight: page.diagramHeight, baseDerivedMinimum: expectedMinimum, canvas: { width: page.width, height: page.height } }
}

function assertTextBounds(textCall, width, height) {
  const x = textCall.x
  const y = textCall.y
  const textWidth = textCall.width
  const left = textCall.align === 'center' ? x - textWidth / 2
    : textCall.align === 'right' ? x - textWidth
      : x
  const right = left + textWidth
  const top = y - textCall.fontSize * .82
  const bottom = y + textCall.fontSize * .24
  assert(Number.isFinite(x) && Number.isFinite(y), 'Non-finite Canvas text coordinate: ' + textCall.text)
  assert(left >= -1 && right <= width + 1, 'Clipped Canvas text horizontally: ' + JSON.stringify(textCall))
  assert(top >= -1 && bottom <= height + 1, 'Clipped Canvas text vertically: ' + JSON.stringify(textCall))
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert(predicate(), message)
}

async function runCase(label, counts) {
  storage.clear()
  routeEvents.length = 0
  exportSequence = 0
  activeExportContext = null
  const runtime = installWx()
  storage.set('audioTool.dmxAddress.preferences', makePreferences(counts))

  const addressPage = instantiateRegisteredPage('pages/dmx-address/dmx-address.js')
  addressPage.onLoad({ lightingCatalogImport: true })
  assert(addressPage._calculationResult && addressPage._calculationResult.valid,
    label + ': source DMX Page did not load a valid address plan')

  const addressWxml = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxml'), 'utf8')
  const layoutEntryHandler = findHandlerTag(addressWxml, 'layout-entry')
  assert.strictEqual(typeof addressPage[layoutEntryHandler], 'function', 'WXML route handler is not callable')
  const workspaceApi = require('../pages/dmx-layout/lighting-workspace')
  const model = require('../pages/dmx-layout/layout-model')
  const current = workspaceApi.readLightingWorkspace(workspaceApi.TEMPORARY_CONTEXT_ID)
  assert(current.ok && current.scheme, label + ': imported lighting workspace unavailable')
  const calculated = workspaceApi.calculateScheme(current.scheme)
  assert(calculated.ok && calculated.valid, label + ': workspace calculation failed')
  const layout = model.createDefaultStageLayout('12', '8', (kind, index) => kind + '-' + (index + 1))
  const placement = assignPositions(layout, calculated.result.fixtures)
  calculated.scheme.layout = layout
  const saved = workspaceApi.saveLightingScheme(current.contextId, calculated.scheme, current.revision)
  assert(saved.ok, label + ': could not seed isolated workspace layout: ' + saved.error)
  const originalPositions = JSON.stringify(layout.positionsById)

  addressPage[layoutEntryHandler]()
  assert.strictEqual(routeEvents.length, 1, label + ': route handler did not navigate exactly once')
  assert(routeEvents[0].startsWith('/pages/dmx-layout/dmx-layout?lightingContextId='),
    label + ': WXML-bound route did not target the unified layout page')
  const routeQuery = parseRouteQuery(routeEvents[0])

  const layoutPage = instantiateRegisteredPage('pages/dmx-layout/dmx-layout.js')
  const layoutWxml = fs.readFileSync(path.join(root, 'pages/dmx-layout/dmx-layout.wxml'), 'utf8')
  const shareHandler = findHandlerTag(layoutWxml, 'context-share')
  const imageTag = [...layoutWxml.matchAll(/<image\b[^>]*>/g)].map((match) => match[0])
    .find((tag) => tag.includes('class="export-image"'))
  assert(imageTag && imageTag.includes('src="{{layoutImagePath}}"'), 'Preview image is not bound to generated path')
  const previewHandlerMatch = imageTag.match(/\bbindtap="([^"]+)"/)
  assert(previewHandlerMatch, 'Preview image is missing its WXML-bound action')
  const shareImageHandler = findButtonHandler(layoutWxml, 'export-share')
  const saveImageHandler = findButtonHandler(layoutWxml, 'export-save-current')

  layoutPage.onLoad(routeQuery)
  assert.strictEqual(layoutPage.data.hasPlan, true, label + ': routed page did not load the plan')
  assert.strictEqual(layoutPage._contextId, routeQuery.lightingContextId)
  assert.strictEqual(layoutPage._fixtures.length, counts.reduce((sum, count) => sum + count, 0))
  assert.deepStrictEqual(Object.keys(layoutPage._layout.positionsById).sort(),
    Object.keys(layout.positionsById).sort(), label + ': saved placements changed while opening route')
  assert.strictEqual(placement.unplaced.length, 1)

  const positionsBefore = JSON.stringify(layoutPage._layout.positionsById)
  layoutPage[shareHandler]()
  await waitFor(() => layoutPage.data.previewVisible, label + ': export did not reach the preview state')
  const imagePath = layoutPage.data.layoutImagePath
  assert.strictEqual(imagePath, 'temp://dmx-unified-1.png')
  assert.deepStrictEqual(layoutPage.data.layoutImagePaths, [imagePath])
  assert.strictEqual(layoutPage.data.isGeneratingImage, false)
  assert.strictEqual(layoutPage.data.exportCanvasActive, false)
  assert.strictEqual(activeExportContext, runtime.exportContext)
  assert.strictEqual(exportSequence, 1, label + ': export callback count was not exactly one')

  const textCalls = runtime.exportContext.calls.filter((call) => call.op === 'fillText')
  const outputTexts = new Set(textCalls.map((call) => call.text))
  const expectedAddresses = layoutPage._fixtures.map((fixture) => fixture.addressText)
  assert(outputTexts.has('灯位图'), label + ': output omitted the stage diagram title')
  assert(outputTexts.has('台口'), label + ': output omitted the apron/front direction')
  assert(outputTexts.has('观众区'), label + ': output omitted the audience boundary')
  for (const rodLabel of ['灯杆1', '灯杆2', '灯杆3']) {
    assert([...outputTexts].some((text) => text === rodLabel || text.startsWith(rodLabel + '（')),
      label + ': output omitted internal rod group ' + rodLabel)
  }
  assert(outputTexts.has('面光杆1'), label + ': output omitted the front-light rod label')
  const exportPage = layoutPage._exportPages[0]
  const baseDerivedDiagramMinimum = assertBaseDiagramFloor(exportPage, label)
  assert(exportPage.addressLayout && exportPage.addressLayout.sections.length > 0,
    label + ': unified image omitted the complete grouped address list')
  assert(outputTexts.has('完整地址清单（' + expectedAddresses.length + ' 台）'),
    label + ': output omitted the address-list heading')
  assert(outputTexts.has('未上杆（1台）'), label + ': output omitted the unplaced fixture section/count')
  const appendixCalls = textCalls.filter((call) => call.y > exportPage.diagramTop + exportPage.diagramHeight)
  const appendixText = appendixCalls.map((call) => call.text).join(' ')
  const appendixTokens = new Set(appendixText.split(/\s+/).filter(Boolean))
  const missingAddresses = expectedAddresses.filter((address) => !appendixTokens.has(address))
  assert.deepStrictEqual(missingAddresses, [], label + ': address appendix omitted addresses: ' + missingAddresses.slice(0, 8).join(', '))
  assert(appendixCalls.some((call) => call.text.includes(placement.unplaced[0].addressText)),
    label + ': address appendix omitted the unplaced fixture address')
  assert(exportPage.width <= 4096 && exportPage.height <= 4096, label + ': export dimensions exceed the canvas bounds')
  textCalls.forEach((call) => assertTextBounds(call, exportPage.width, exportPage.height))
  assert.strictEqual(JSON.stringify(layoutPage._layout.positionsById), positionsBefore,
    label + ': export mutated in-memory placement positions')
  const storedAfterExport = workspaceApi.readLightingWorkspace(routeQuery.lightingContextId)
  assert(storedAfterExport.ok)
  assert.strictEqual(JSON.stringify(storedAfterExport.scheme.layout.positionsById), originalPositions,
    label + ': export mutated saved placement positions')

  layoutPage[previewHandlerMatch[1]]()
  assert.deepStrictEqual(runtime.actions.previews, [{ current: imagePath, urls: [imagePath] }],
    label + ': preview action did not use the generated image path')
  layoutPage[shareImageHandler]()
  assert.strictEqual(runtime.actions.shares.length, 1)
  assert.strictEqual(runtime.actions.shares[0].path, imagePath,
    label + ': forward action did not use the generated image path')
  layoutPage[saveImageHandler]()
  assert.strictEqual(runtime.actions.saves.length, 1)
  assert.strictEqual(runtime.actions.saves[0].filePath, imagePath,
    label + ': save action did not use the generated image path')
  layoutPage.onUnload()
  if (typeof addressPage.onUnload === 'function') addressPage.onUnload()
  return {
    label,
    fixtures: expectedAddresses.length,
    placed: placement.placed,
    unplaced: placement.unplaced.length,
    canvas: { width: exportPage.width, height: exportPage.height },
    diagramHeight: exportPage.diagramHeight,
    baseDerivedDiagramMinimum,
    addressSections: exportPage.addressLayout.sections.map((section) => ({
      label: section.label,
      fixtures: section.addresses.length,
      lines: section.lines.length,
    })),
    textCalls: textCalls.length,
    allAddressesPresent: true,
    actions: { preview: 1, forward: 1, save: 1 },
  }
}

async function main() {
  const empty = runEmptyDiagramHeightCase()
  const small = await runCase('small', [4, 4])
  const single = await runCase('single', [1])
  const onePerRod = await runCase('one-per-rod', [1, 1, 1, 1])
  const dense = await runCase('dense', [200, 200, 100])
  process.stdout.write(JSON.stringify({
    status: 'PASS',
    flow: 'address WXML route -> layout Page -> WXML share binding -> real draw/export callback -> preview/forward/save',
    cases: [empty, small, single, onePerRod, dense],
  }) + '\n')
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error))
  process.stderr.write('\n')
  process.exitCode = 1
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const storage = new Map()
const mainTextCalls = []
const exportTextCalls = []
const exportRequests = []
let deferExport = false
let deferSelectorQuery = false
let failExport = false
let devicePixelRatio = 2
let mainCanvasSizeOverride = null
const queuedSelectorQueries = []
let activePage = null
let selectorQueryCount = 0

function createContext(textCalls) {
  const target = {
    setTransform(...args) { target.transform = args },
    measureText(value) { return { width: Array.from(String(value)).length * 8 } },
    fillText(value, ...coords) { textCalls.push({ value: String(value), coords, font: target.font }) },
  }
  return new Proxy(target, {
    get(object, key) { return key in object ? object[key] : () => {} },
  })
}

class CanvasNode {
  constructor(textCalls) {
    this.width = 300
    this.height = 150
    this.context = createContext(textCalls)
    this.frames = new Map()
    this.frameHistory = new Map()
    this.cancelledFrames = []
    this.nextFrameId = 1
  }
  getContext(type) { assert.equal(type, '2d'); return this.context }
  requestAnimationFrame(callback) {
    const id = this.nextFrameId++
    this.frames.set(id, callback)
    this.frameHistory.set(id, callback)
    return id
  }
  cancelAnimationFrame(id) {
    this.cancelledFrames.push(id)
    this.frames.delete(id)
  }
  flushFrames() {
    const callbacks = [...this.frames.values()]
    this.frames.clear()
    callbacks.forEach((callback) => callback(0))
  }
}

let mainNode = new CanvasNode(mainTextCalls)
const exportNode = new CanvasNode(exportTextCalls)
const preferences = {
  startAddressText: '1',
  allocationMode: 'auto',
  groups: [{ name: '成像灯', fixtureSource: 'library', fixtureModel: 'TL-SL323', channelCount: '2', libraryChannelCount: '2', fixtureCount: '3', targetUniverse: 'A' }],
  groupSummary: '',
}
const preferencesKey = 'audioTool.dmxAddress.preferences'
const progressKey = 'audioTool.dmxAddress.progress'
storage.set(preferencesKey, preferences)
storage.set(progressKey, { calculationSignature: JSON.stringify(preferences), keys: [] })
storage.set('audioTool.projects.v1', [{ id: 'qa-project-two', name: '第二项目', createdAt: 1, updatedAt: 1, recordIds: [] }])

global.wx = {
  getStorageSync(key) { const value = storage.get(key); return value === undefined ? '' : JSON.parse(JSON.stringify(value)) },
  setStorageSync(key, value) { storage.set(key, JSON.parse(JSON.stringify(value))) },
  removeStorageSync(key) { storage.delete(key) },
  getSystemInfoSync() { return { theme: 'light', windowWidth: 390, windowHeight: 844, pixelRatio: devicePixelRatio, statusBarHeight: 24 } },
  getWindowInfo() { return { windowWidth: 390, windowHeight: 844, pixelRatio: devicePixelRatio, statusBarHeight: 24 } },
  getAppBaseInfo() { return { theme: 'light' } },
  getMenuButtonBoundingClientRect() { return { left: 293, right: 380, top: 28, bottom: 60, width: 87, height: 32 } },
  onThemeChange() {}, offThemeChange() {}, onWindowResize() {}, offWindowResize() {},
  enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
  createCanvasContext() { throw new Error('legacy canvas context must not be used') },
  createSelectorQuery() {
    selectorQueryCount += 1
    const selections = []
    const query = {
      in() { return query },
      select(selector) {
        const selection = { selector }
        selections.push(selection)
        return {
          boundingClientRect(callback) { selection.rectCallback = callback; return query },
          fields(fields, callback) { selection.fields = fields; selection.fieldsCallback = callback; return query },
        }
      },
      exec(callback) {
        const run = () => {
          selections.forEach((selection) => {
            if (selection.selector === '#dmxLayoutCanvasShell' && selection.rectCallback) {
              selection.rectCallback({ left: 10, top: 120, width: 390, height: 620 })
            }
            if (selection.selector === '#dmxLayoutCanvas' && selection.fieldsCallback) {
              selection.fieldsCallback({ node: activePage && activePage.isStageCanvasBlocked() ? null : mainNode, width: mainCanvasSizeOverride ? mainCanvasSizeOverride.width : 390, height: mainCanvasSizeOverride ? mainCanvasSizeOverride.height : 620 })
            }
            if (selection.selector === '#dmxLayoutExportCanvas' && selection.fieldsCallback) {
              selection.fieldsCallback({ node: exportNode, width: 1, height: 1 })
            }
          })
          if (callback) callback(selections)
        }
        if (deferSelectorQuery) queuedSelectorQueries.push(run)
        else run()
        return query
      },
    }
    return query
  },
  canvasToTempFilePath(options) {
    exportRequests.push({ ...options, backingWidth: options.canvas.width, backingHeight: options.canvas.height })
    if (deferExport) return
    if (failExport) { options.fail?.({ errMsg: 'injected failure' }); return }
    options.success?.({ tempFilePath: 'native-layout.png' })
  },
  showToast() {}, showLoading() {}, hideLoading() {}, vibrateShort() {},
  navigateBack() {}, navigateTo() {},
  showModal(options) { options.success?.({ confirm: false }) },
  nextTick(callback) { callback() },
}
global.getApp = () => ({ globalData: { theme: 'light' } })

const { createDmxLayoutPage } = require('../../pages/dmx-layout/page-factory')
const { saveLightingScheme } = require('../../pages/dmx-layout/lighting-workspace')
const { pointOnRod } = require('../../pages/dmx-layout/layout-model')
const sourceRoot = path.resolve(__dirname, '../..')
for (const relative of ['pages/dmx-layout/dmx-layout.wxml', 'pages/dmx-layout-landscape/dmx-layout-landscape.wxml']) {
  const markup = fs.readFileSync(path.join(sourceRoot, relative), 'utf8')
  assert.match(markup, /<canvas\s+wx:if="\{\{!layoutPanelVisible && !locateVisible && !placementVisible && !previewVisible && !isGeneratingImage && !exportCanvasActive\}\}"\s+type="2d"\s+id="dmxLayoutCanvas"/, `${relative} must unmount its native 2D stage node while a native overlay is active`)
  assert.match(markup, /<canvas\s+wx:if="\{\{exportCanvasActive\}\}"\s+type="2d"\s+id="dmxLayoutExportCanvas"/, `${relative} must use a native 2D export node`)
  assert.doesNotMatch(markup, /canvas-id=/, `${relative} must not retain the legacy canvas-id path`)
}
assert.doesNotMatch(fs.readFileSync(path.join(sourceRoot, 'pages/dmx-layout/page-factory.js'), 'utf8'), /createCanvasContext|canvasId\s*:/,
  'production page must not use legacy canvas contexts or canvas IDs')
for (const relative of ['pages/dmx-layout/dmx-layout.wxss', 'pages/dmx-layout-landscape/dmx-layout-landscape.wxss']) {
  const styles = fs.readFileSync(path.join(sourceRoot, relative), 'utf8')
  assert.doesNotMatch(styles, /\.export-canvas\{[^}]*left:-2000px|\.export-canvas\{[^}]*z-index:-1/,
    `${relative} export node must stay mounted visibly in the native layer`)
  assert.match(styles, /\.overlay,\.export-overlay\{[^}]*top:0;right:0;bottom:0;left:0/,
    `${relative} overlays need explicit inset properties`)
  assert.doesNotMatch(styles, /\.settings-scroll\{height:0/,
    `${relative} settings scroll area must have an effective height`)
  assert.match(styles, /\.settings-heading button\.sheet-close\{[^}]*width:58px;[^}]*flex:0 0 58px/,
    `${relative} settings close button should remain compact in the native view`)
  assert.match(styles, /\.settings-actions button\.settings-apply\{[^}]*width:100%;[^}]*min-width:0/,
    `${relative} settings action button should fill its local action row`)
}

;(async () => {
const pageDefinition = createDmxLayoutPage({ mode: 'portrait' })
const page = { ...pageDefinition, data: JSON.parse(JSON.stringify(pageDefinition.data)) }
activePage = page
let stageWasBlocked = false
page.setData = (patch, callback) => {
  const wasBlocked = stageWasBlocked
  Object.keys(patch).forEach((key) => { page.data[key] = patch[key] })
  stageWasBlocked = page.isStageCanvasBlocked()
  if (wasBlocked && !stageWasBlocked) mainNode = new CanvasNode(mainTextCalls)
  if (callback) callback()
}
page.onLoad({})

const waitForPanelExit = () => new Promise((resolve) => setTimeout(resolve, 220))

const geometryBeforeOverlay = page.getGeometry()
const stageBeforeSettings = mainNode
page.drawLayout()
assert.equal(stageBeforeSettings.frames.size, 1)
const staleSettingsFrame = [...stageBeforeSettings.frameHistory.values()][0]
const queriesBeforeSettings = selectorQueryCount
deferSelectorQuery = true
page.measureCanvas()
assert.equal(queuedSelectorQueries.length, 1, 'stage measurement can be pending before the native panel opens')
page.openLayoutSettings()
assert.equal(page._canvasNode, null, 'opening settings should detach the main canvas reference')
assert.equal(stageBeforeSettings.frames.size, 0, 'opening settings should cancel the queued stage frame')
assert.equal(stageBeforeSettings.cancelledFrames.length, 1)
assert.equal(page.isStageCanvasBlocked(), true)
deferSelectorQuery = false
queuedSelectorQueries.splice(0).forEach((run) => run())
assert.equal(page._canvasNode, null, 'a late pre-overlay selector result must not restore the unmounted node')
page.measureCanvas()
assert.equal(selectorQueryCount, queriesBeforeSettings + 1, 'blocked overlays should not queue a stage canvas selector query')
page.closeLayoutSettings()
await waitForPanelExit()
assert.equal(page.data.layoutPanelVisible, false)
assert.notStrictEqual(mainNode, stageBeforeSettings, 'closing settings should acquire the newly mounted native canvas node')
assert.strictEqual(page._canvasNode, mainNode)
assert.strictEqual(page.getGeometry(), geometryBeforeOverlay, 'overlay remount at the same size should reuse cached stage geometry')
const textCountBeforeStaleSettingsFrame = mainTextCalls.length
staleSettingsFrame(0)
assert.equal(mainTextCalls.length, textCountBeforeStaleSettingsFrame, 'a cancelled old-node RAF must not draw after the replacement node mounts')
mainNode.flushFrames()

const stageBeforeLocate = mainNode
page.openLocatePanel()
assert.equal(page._canvasNode, null, 'opening locate should detach the main canvas reference')
const queriesBeforeLocate = selectorQueryCount
page.measureCanvas()
assert.equal(selectorQueryCount, queriesBeforeLocate, 'locate should not query a canvas while its overlay is open')
page.closeLocatePanel()
await waitForPanelExit()
assert.equal(page.data.locateVisible, false)
assert.notStrictEqual(mainNode, stageBeforeLocate, 'closing locate should remount and reacquire the stage canvas')
assert.strictEqual(page._canvasNode, mainNode)
mainNode.flushFrames()

const stageBeforePlacement = mainNode
page.openPlacementPanel()
assert.equal(page._canvasNode, null, 'opening placement should detach the main canvas reference')
page.closePlacementPanel()
await waitForPanelExit()
assert.equal(page.data.placementVisible, false)
assert.notStrictEqual(mainNode, stageBeforePlacement, 'closing placement should remount and reacquire the stage canvas')
assert.strictEqual(page._canvasNode, mainNode)
mainNode.flushFrames()

const stageBeforeFixtureTap = mainNode
page.drawLayout()
const staleFixtureTapFrame = [...stageBeforeFixtureTap.frameHistory.values()][0]
const textCountBeforeFixtureTap = mainTextCalls.length
page._touchState = { fixtureId: String(page._fixtures[0].stableId), start: { x: 100, y: 100 }, last: { x: 100, y: 100 }, moved: false, dragging: false }
page._gesture = { type: 'single', view: { ...page._view } }
page.onCanvasTouchEnd({ touches: [] })
assert.equal(page.data.placementVisible, true, 'a fixture tap should open its placement card')
assert.equal(page._canvasNode, null, 'fixture-tap placement must also suspend the native stage node')
assert.equal(stageBeforeFixtureTap.frames.size, 0, 'fixture-tap placement must cancel any pending stage RAF')
staleFixtureTapFrame(0)
assert.equal(mainTextCalls.length, textCountBeforeFixtureTap, 'a cancelled fixture-tap RAF must not paint over its panel')
page.closePlacementPanel()
await waitForPanelExit()
assert.notStrictEqual(mainNode, stageBeforeFixtureTap, 'fixture-tap panel close should reacquire a fresh stage node')
assert.strictEqual(page._canvasNode, mainNode)
mainNode.flushFrames()

const stageBeforeRodTap = mainNode
page.drawLayout()
const staleRodTapFrame = [...stageBeforeRodTap.frameHistory.values()][0]
const textCountBeforeRodTap = mainTextCalls.length
const emptyRod = page.getGeometry().rods.find((item) => !Object.values(page._layout.positionsById || {}).some((position) => String(position.rodId) === String(item.id)))
const emptyRodPoint = pointOnRod(emptyRod, .5)
page._touchState = { fixtureId: '', rodId: String(emptyRod.id), start: emptyRodPoint, last: emptyRodPoint, moved: false, dragging: false }
page._gesture = { type: 'single', view: { ...page._view } }
page.onCanvasTouchEnd({ touches: [] })
assert.equal(page.data.placementVisible, true, 'a rod tap should open its placement card')
assert.equal(page._canvasNode, null, 'rod-tap placement must suspend the native stage node')
assert.equal(stageBeforeRodTap.frames.size, 0, 'rod-tap placement must cancel any pending stage RAF')
staleRodTapFrame(0)
assert.equal(mainTextCalls.length, textCountBeforeRodTap, 'a cancelled rod-tap RAF must not paint over its panel')
page.closePlacementPanel()
await waitForPanelExit()
assert.notStrictEqual(mainNode, stageBeforeRodTap, 'rod-tap panel close should reacquire a fresh stage node')
assert.strictEqual(page._canvasNode, mainNode)
mainNode.flushFrames()

assert.equal(page.data.hasPlan, true)
assert.equal(page.canvasDimensions().width, 390, 'geometry width must use CSS logical pixels')
assert.equal(page.canvasDimensions().height, 620, 'geometry height must use CSS logical pixels')
assert.deepEqual(mainNode.context.transform, [2, 0, 0, 2, 0, 0], 'main canvas context must scale by the real DPR')
assert.equal(mainNode.width, 780)
assert.equal(mainNode.height, 1240)
assert.deepEqual(page.canvasPoint({}, { clientX: 205, clientY: 430 }), { x: 195, y: 310 }, 'touch input must remain in logical pixels')
assert.strictEqual(page.getGeometry(), page.getGeometry(), 'stage geometry should be cached for repeated touch/render work')

for (const ratio of [1, 3]) {
  devicePixelRatio = ratio
  page.measureCanvas()
  assert.equal(mainNode.width, 390 * ratio, `DPR ${ratio} should only change the native backing width`)
  assert.equal(mainNode.height, 620 * ratio, `DPR ${ratio} should only change the native backing height`)
  assert.deepEqual(mainNode.context.transform, [ratio, 0, 0, ratio, 0, 0])
  assert.deepEqual(page.canvasDimensions(), { width: 390, height: 620 }, `DPR ${ratio} must preserve logical geometry`)
  assert.deepEqual(page.canvasPoint({}, { clientX: 205, clientY: 430 }), { x: 195, y: 310 }, `DPR ${ratio} must preserve logical touch points`)
}
devicePixelRatio = 2
page.measureCanvas()

const geometryBeforeZeroMeasure = page.getGeometry()
const rectBeforeZeroMeasure = { ...page._canvasRect }
mainCanvasSizeOverride = { width: 0, height: 620 }
let zeroMeasureCallbackRan = false
page.measureCanvas(() => { zeroMeasureCallbackRan = true })
assert.equal(zeroMeasureCallbackRan, false, 'zero native canvas width must not be treated as a successful 1px measurement')
assert.deepEqual(page._canvasRect, rectBeforeZeroMeasure, 'invalid measurement must preserve the last valid canvas rectangle')
assert.strictEqual(page.getGeometry(), geometryBeforeZeroMeasure, 'invalid measurement must retain the last valid stage geometry')
assert.equal(page.data.saveRetryVisible, true, 'invalid measurement must expose a retry action')
assert.match(page.data.saveNotice, /画布尺寸无效/)
mainCanvasSizeOverride = null
page.retryLayoutSave()
assert.equal(page.data.saveNotice, '', 'retry should clear the canvas measurement notice after a valid measurement')
mainNode.flushFrames()

const originalAddress = page._fixtures[0].addressText
const projectScheme = JSON.parse(JSON.stringify(page._scheme))
projectScheme.layout = JSON.parse(JSON.stringify(page._layout))
const projectFixtureId = String(page._fixtures[0].stableId)
const projectRodId = String(projectScheme.layout.internalRods[0].id)
projectScheme.layout.positionsById[projectFixtureId] = { rodId: projectRodId, t: 0.37 }
const expectedProjectPositions = JSON.parse(JSON.stringify(projectScheme.layout.positionsById))
assert.equal(saveLightingScheme('qa-project-two', projectScheme, 0).ok, true, 'test project should receive a valid lighting scheme')
page._view = { s: 5, x: 9999, y: -9999 }
page._viewAnimationToken = 80
page._highlightTimer = setTimeout(() => {}, 10000)
page.setData({ selectedFixtureId: page._fixtures[0].stableId, highlightFixtureId: page._fixtures[0].stableId })
page._gesture = { type: 'single' }
page._touchState = { moved: true }
page.selectLightingContext({ currentTarget: { dataset: { contextId: 'qa-project-two' } } })
assert.equal(page._contextId, 'qa-project-two')
assert.deepEqual(page._view, { s: 1, x: 0, y: 0 }, 'switching projects should restore the initial canvas fit without changing layout coordinates')
assert.equal(page._gesture, null)
assert.equal(page._touchState, null)
assert.equal(page._highlightTimer, null)
assert.equal(page.data.highlightFixtureId, '')
assert.equal(page.data.selectedFixtureId, '')
assert.equal(page._fixtures[0].addressText, originalAddress, 'view reset must not change fixture addresses')
assert.deepEqual(page._layout.positionsById, expectedProjectPositions, 'view reset must retain saved fixture-to-rod coordinates')
mainNode.flushFrames()

page.animateViewTo({ x: 100, y: 100 })
const animatedViewToken = page._viewAnimationToken
page.onCanvasTouchStart({ touches: [{ clientX: 50, clientY: 50 }] })
assert.equal(page._viewAnimationToken, animatedViewToken + 1, 'manual canvas input should cancel an in-flight locate animation')
page.clearPendingGesture()

page._view = { s: 1, x: 0, y: 0 }
page.setData({ placementVisible: false })
const rod = page.getGeometry().rods.find((item) => String(item.id) !== projectRodId)
const rodPoint = pointOnRod(rod, 0.5)
assert.equal(page.findFixtureAt(rodPoint), null, 'pan target should be a rod with no nearby placed fixture')
assert.ok(page.findRodAt(rodPoint), 'default rod remains tappable at its center')
const rodTouch = { clientX: page._canvasRect.left + rodPoint.x, clientY: page._canvasRect.top + rodPoint.y }
const positionsBeforePan = JSON.stringify(page._layout.positionsById)
page.onCanvasTouchStart({ touches: [rodTouch] })
page.onCanvasTouchMove({ touches: [{ clientX: rodTouch.clientX + 6, clientY: rodTouch.clientY + 4 }] })
assert.equal(page._view.x, 6, 'single-finger movement from a rod should pan once it crosses the pan threshold')
page.onCanvasTouchEnd({ touches: [] })
assert.equal(page.data.placementVisible, false, 'a short pan gesture must not also open the rod placement card')
assert.equal(JSON.stringify(page._layout.positionsById), positionsBeforePan, 'ending a pan over a rod must not change lamp placement')
page._view = { s: 1, x: 0, y: 0 }
mainNode.flushFrames()

page.drawLayout()
page.drawLayout()
page.drawLayout()
assert.equal(mainNode.frames.size, 1, 'multiple invalidations must coalesce into one canvas frame')
mainNode.flushFrames()
assert.ok(mainTextCalls.some((call) => call.value === '12 m'), 'main 2D node should render stage annotations')

page.drawLayout()
assert.equal(mainNode.frames.size, 1)
const lateMainFrame = [...mainNode.frames.values()][0]
const renderedTextBeforeHide = mainTextCalls.length
let lateMeasureCompleted = false
deferSelectorQuery = true
page.measureCanvas(() => { lateMeasureCompleted = true })
assert.equal(queuedSelectorQueries.length, 1)
page.onHide()
assert.equal(mainNode.frames.size, 0, 'hide should cancel a queued native frame')
assert.equal(mainNode.cancelledFrames.length, 1)
lateMainFrame(0)
assert.equal(mainTextCalls.length, renderedTextBeforeHide, 'a late native frame must not draw after hide')
deferSelectorQuery = false
queuedSelectorQueries.splice(0).forEach((run) => run())
assert.equal(lateMeasureCompleted, false, 'a late selector query must not configure or draw a hidden page')
page.onShow()
mainNode.flushFrames()

const stageBeforeExport = mainNode
page.generateLayoutImage()
assert.equal(page._canvasNode, null, 'export generation should unmount the main stage canvas before querying the export node')
assert.equal(page.isStageCanvasBlocked(), true)
assert.equal(exportRequests.length, 1, 'export should rasterize through the mounted 2D node')
assert.equal(exportRequests[0].canvas, exportNode)
assert.equal(exportRequests[0].canvasId, undefined)
assert.equal(exportRequests[0].backingWidth, exportRequests[0].width)
assert.equal(exportRequests[0].backingHeight, exportRequests[0].height)
assert.ok(exportTextCalls.some((call) => call.value === '灯位图'), 'export node should receive the real diagram title draw call')
assert.ok(!exportTextCalls.some((call) => /灯具地址清单|灯具编址与灯位图|地址清单/.test(String(call.value))), 'native export draw calls must not include the removed list/report')
assert.equal(page.data.previewVisible, true)
assert.equal(page.data.exportCanvasActive, false)
assert.equal(page._canvasNode, null, 'preview should continue to keep the main stage node unmounted')
assert.ok(stageBeforeExport, 'export should retain no dependency on the stage canvas node')

page.closePreview()
assert.equal(page.data.previewClosing, true)
await waitForPanelExit()
assert.notStrictEqual(mainNode, stageBeforeExport, 'closing export preview should remount a fresh stage node')
assert.strictEqual(page._canvasNode, mainNode)
mainNode.flushFrames()
deferExport = true
page.generateLayoutImage()
assert.equal(exportRequests.length, 2)
page.onHide()
assert.equal(page._canvasNode, null, 'hiding during export must not revive the stage canvas')
exportRequests[1].success({ tempFilePath: 'late-layout.png' })
assert.equal(page.data.previewVisible, false, 'late export completion after hide must not open the cancelled preview')
assert.equal(page.data.isGeneratingImage, false)
assert.equal(page.data.exportCanvasActive, false)
assert.deepEqual(page.data.layoutImagePaths, [], 'cancel should discard partial image paths')
deferExport = false
page.onShow()
mainNode.flushFrames()
failExport = true
page.generateLayoutImage()
assert.equal(page.data.isGeneratingImage, false, 'failed native export must stop the loading state')
assert.equal(page.data.exportCanvasActive, false)
assert.deepEqual(page.data.layoutImagePaths, [], 'failed native export must discard partial paths')
failExport = false
page.onUnload()

const openExportDefinition = createDmxLayoutPage({ mode: 'portrait' })
const openExportPage = { ...openExportDefinition, data: JSON.parse(JSON.stringify(openExportDefinition.data)) }
activePage = openExportPage
stageWasBlocked = false
openExportPage.setData = (patch, callback) => {
  const wasBlocked = stageWasBlocked
  Object.keys(patch).forEach((key) => { openExportPage.data[key] = patch[key] })
  stageWasBlocked = openExportPage.isStageCanvasBlocked()
  if (wasBlocked && !stageWasBlocked) mainNode = new CanvasNode(mainTextCalls)
  if (callback) callback()
}
const requestsBeforeDirectExport = exportRequests.length
openExportPage.onLoad({ openExport: '1' })
assert.equal(openExportPage.data.previewVisible, true, 'direct openExport navigation should still render the export node')
assert.equal(openExportPage._canvasNode, null, 'direct export should not require the main stage node after loading')
assert.equal(exportRequests.length, requestsBeforeDirectExport + 1)
openExportPage.closePreview()
assert.equal(openExportPage.data.previewClosing, true)
await waitForPanelExit()
assert.strictEqual(openExportPage._canvasNode, mainNode, 'closing direct export should mount and measure a fresh stage node')
openExportPage.onUnload()

console.log('Native 2D canvas DPR, CSS coordinates, RAF scheduling, export node and lifecycle checks passed')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

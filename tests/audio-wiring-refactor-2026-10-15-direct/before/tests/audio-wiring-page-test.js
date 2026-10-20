const assert = require('assert')
const fs = require('fs')

let pageDefinition = null
global.Page = (definition) => { pageDefinition = definition }

function createRuntime(options = {}) {
  const runtime = {
    toasts: [], clipboard: [], saves: [], shares: [], previews: [], reportExports: [], reportTexts: [], reportLineWidths: [],
    reportDrawCallbacks: [], reportContextIds: [], removedThemeHandlers: [], pendingClipboardCallbacks: [],
    screenQueries: 0, screenDraws: 0, screenTexts: [], transforms: [], scaleCalls: 0,
    screenPhotoDraws: 0, reportPhotoDraws: 0, imageInfoReads: [],
    screenNodeCreations: 0, deferNextScreenQuery: false, pendingScreenQueries: [], vibrations: 0,
    deferScreenImageLoad: Boolean(options.deferScreenImageLoad), pendingScreenImages: [],
    deferImageInfo: Boolean(options.deferImageInfo), pendingImageInfoCallbacks: [],
    deferNextPreviewQuery: false, pendingPreviewQueries: [],
    measuredWidth: 319, throwNextScreenContext: false, throwNextImageSrc: false, page: null, canvasAttached: false,
    actionSheets: [], modals: [],
    storage: new Map(Object.entries(options.storage || {})), storageWrites: [],
    failStorageRead: Boolean(options.failStorageRead), failStorageWrite: Boolean(options.failStorageWrite),
    beforeStorageRead: options.beforeStorageRead || null,
    storageApiAvailable: options.storageApiAvailable !== false,
    previewMeasurements: options.previewMeasurements || null,
  }

  function createScreenContext() {
    const context = {
      font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      textAlign: 'left', textBaseline: 'alphabetic',
      beginPath() {}, save() {}, restore() {}, rect(...args) { runtime.screenClips = (runtime.screenClips || []).concat([['rect', ...args]]) },
      clip() { runtime.screenClips = (runtime.screenClips || []).concat([['clip']]) },
      moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, closePath() {},
      fill() {}, stroke() {}, arc() {},
      fillRect(...args) { runtime.screenDraws += 1; runtime.lastScreenFillRect = args },
      drawImage(...args) { runtime.screenPhotoDraws += 1; runtime.screenImages = (runtime.screenImages || []).concat([args]) },
      fillText(value, x, y) { runtime.screenTexts.push({ value, x, y, font: this.font }) },
      setTransform(...args) { runtime.transforms.push(args) },
      scale() { runtime.scaleCalls += 1 },
      setLineCap() {},
    }
    return context
  }

  function createScreenNode() {
    runtime.screenNodeCreations += 1
    const context = createScreenContext()
    return {
      id: runtime.screenNodeCreations,
      width: 0,
      height: 0,
      getContext(kind) {
        assert.strictEqual(kind, '2d')
        if (runtime.throwNextScreenContext) {
          runtime.throwNextScreenContext = false
          throw new Error('simulated 2D context failure')
        }
        return context
      },
      createImage() {
        const image = { onload: null, onerror: null, _src: '' }
        Object.defineProperty(image, 'src', {
          get() { return this._src },
          set(value) {
            if (runtime.throwNextImageSrc) {
              runtime.throwNextImageSrc = false
              throw new Error('simulated image src setter failure')
            }
            this._src = value
            if (runtime.deferScreenImageLoad) runtime.pendingScreenImages.push(this)
            else if (this.onload) this.onload()
          },
        })
        return image
      },
    }
  }

  runtime.attachScreenCanvas = () => {
    runtime.canvasAttached = true
    runtime.screenCanvasNode = createScreenNode()
  }
  runtime.detachScreenCanvas = () => { runtime.canvasAttached = false }
  runtime.snapshotScreenQuery = () => ({
    node: runtime.canvasAttached ? runtime.screenCanvasNode : null,
    width: runtime.canvasAttached && runtime.page ? runtime.measuredWidth : 0,
    height: runtime.canvasAttached && runtime.page ? runtime.page.data.diagramCanvasHeight : 0,
  })
  runtime.resolveNextScreenQuery = () => {
    const pending = runtime.pendingScreenQueries.shift()
    assert(pending, 'a deferred screen canvas query should exist')
    pending.callback([pending.result])
  }
  runtime.resolvePendingScreenImages = () => {
    const pending = runtime.pendingScreenImages.splice(0)
    pending.forEach((image) => image.onload && image.onload())
  }
  runtime.resolvePendingImageInfo = () => {
    const pending = runtime.pendingImageInfoCallbacks.splice(0)
    pending.forEach((value) => value.success({ path: value.src, width: 384, height: 384 }))
  }
  runtime.resolveNextPreviewQuery = () => {
    const pending = runtime.pendingPreviewQueries.shift()
    assert(pending, 'a deferred preview layout query should exist')
    pending()
  }

  function createReportContext(canvasId) {
    runtime.reportContextIds.push(canvasId)
    return {
      font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      textAlign: 'left', textBaseline: 'alphabetic',
      setFontSize(size) { this.font = `${size}px sans-serif` },
      setFillStyle(value) { this.fillStyle = value },
      setTextAlign(value) { this.textAlign = value },
      setTextBaseline(value) { this.textBaseline = value },
      fillText(value) { runtime.reportTexts.push(String(value)) }, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, closePath() {},
      fill() {}, setStrokeStyle(value) { this.strokeStyle = value },
      setLineWidth(value) { this.lineWidth = value; runtime.reportLineWidths.push(value) },
      stroke() {}, arc() {}, fillRect() {}, drawImage(...args) { runtime.reportPhotoDraws += 1 },
      save() {}, restore() {}, rect() {}, clip() {}, scale() {},
      draw(reserve, callback) {
        runtime.reportDrawCallbacks.push(callback)
      },
    }
  }

  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }),
    getAppBaseInfo: () => ({ theme: 'light' }),
    getImageInfo(value) {
      runtime.imageInfoReads.push(value.src)
      if (runtime.deferImageInfo) {
        runtime.pendingImageInfoCallbacks.push(value)
        return
      }
      if (runtime.failNextImageInfo) {
        runtime.failNextImageInfo = false
        if (value.fail) value.fail(new Error('simulated getImageInfo failure'))
        return
      }
      if (value.success) value.success({ path: value.src, width: 384, height: 384 })
    },
    ...(runtime.storageApiAvailable ? {
      getStorageSync(key) {
        if (runtime.failStorageRead) throw new Error('simulated storage read failure')
        if (runtime.beforeStorageRead) runtime.beforeStorageRead(key)
        return runtime.storage.get(key)
      },
      setStorageSync(key, value) {
        if (runtime.failStorageWrite) throw new Error('simulated storage write failure')
        runtime.storage.set(key, value)
        runtime.storageWrites.push({ key, value: JSON.parse(JSON.stringify(value)) })
      },
    } : {}),
    onThemeChange() {},
    offThemeChange(handler) { runtime.removedThemeHandlers.push(handler) },
    showToast(value) { runtime.toasts.push(value) },
    showActionSheet(value) { runtime.actionSheets.push(value) },
    showModal(value) { runtime.modals.push(value) },
    showLoading() {}, hideLoading() {}, vibrateShort() { runtime.vibrations += 1 },
    setClipboardData(value) {
      runtime.clipboard.push(value.data)
      if (runtime.deferClipboardCallback) runtime.pendingClipboardCallbacks.push(value)
      else if (value.success) value.success()
    },
    previewImage(value) { runtime.previews.push(value) },
    showShareImageMenu(value) { runtime.shares.push(value) },
    saveImageToPhotosAlbum(value) { runtime.saves.push(value.filePath); if (value.success) value.success() },
    createSelectorQuery() {
      let page = null
      const selections = []
      const query = {
        in(value) { page = value; return query },
        select(selector) {
          const selection = { selector, fields: null, callback: null }
          selections.push(selection)
          return {
            fields(value, callback) { selection.fields = value; selection.callback = callback; return query },
            boundingClientRect(callback) { selection.callback = callback; return query },
          }
        },
        exec(callback) {
          assert.strictEqual(page, runtime.page)
          if (selections.length === 1 && selections[0].selector === '#wiringDiagramCanvas') {
            runtime.screenQueries += 1
            assert.deepStrictEqual(selections[0].fields, { node: true, size: true })
            const result = runtime.snapshotScreenQuery()
            if (runtime.deferNextScreenQuery) {
              runtime.deferNextScreenQuery = false
              runtime.pendingScreenQueries.push({ callback, result })
            } else callback([result])
            return
          }
          const defaults = () => {
            const width = 375
            const height = 800
            return {
              '.page-root': { rect: { top: 0, left: 0, width, height, right: width, bottom: height } },
              '.result-report-preview-overlay': {
                rect: { top: 0, left: 0, width, height, right: width, bottom: height },
                computedStyle: { paddingTop: '16px', paddingBottom: '22px' },
              },
              '.result-report-preview-sheet': {
                rect: { top: 200, left: 20, width: 335, height: 578, right: 355, bottom: 778 },
                computedStyle: { paddingTop: '10px', paddingBottom: '8px', borderTopWidth: '1px', borderBottomWidth: '1px' },
              },
              '.result-report-preview-header': { rect: { top: 210, left: 30, width: 315, height: 70 } },
              '.result-report-preview-actions': { rect: { top: 720, left: 30, width: 315, height: 56 } },
              '.result-report-preview-scroll': {
                rect: { top: 280, left: 30, width: 315, height: 440 },
                computedStyle: { borderTopWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderRightWidth: '1px' },
              },
              '.result-report-preview-image': { rect: { top: 281, left: 31, width: 313, height: 417 } },
            }
          }
          const measurements = { ...defaults(), ...(runtime.previewMeasurements || {}) }
          const resolve = () => {
            selections.forEach((selection) => {
              if (selection.callback) selection.callback(measurements[selection.selector])
            })
            if (callback) callback()
          }
          if (runtime.deferNextPreviewQuery) {
            runtime.deferNextPreviewQuery = false
            runtime.pendingPreviewQueries.push(resolve)
          } else resolve()
        },
      }
      return query
    },
    createCanvasContext(canvasId) {
      assert.strictEqual(canvasId, 'resultReportCanvas', 'only the shared legacy export canvas should be used')
      return createReportContext(canvasId)
    },
    canvasToTempFilePath(value) { runtime.reportExports.push(value) },
  }
  return runtime
}

function createPage(runtime) {
  const page = {
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    mutationCount: 0,
    setData(changes, callback) {
      this.data = { ...this.data, ...changes }
      this.mutationCount += 1
      if (Object.prototype.hasOwnProperty.call(changes, 'supported')) {
        if (changes.supported) {
          if (!runtime.canvasAttached) runtime.attachScreenCanvas()
        } else runtime.detachScreenCanvas()
      }
      if (callback) callback()
    },
  }
  for (const [key, value] of Object.entries(pageDefinition)) if (typeof value === 'function') page[key] = value
  runtime.page = page
  page.onLoad()
  assert.strictEqual(page.data.diagramError, '', 'diagramError must be declared on initial data')
  page.onShow()
  page.onReady()
  return page
}

function getPreferenceWriteCount(runtime) {
  return runtime.storageWrites.filter((entry) => entry.key === 'audioWiringPreferencesV1').length
}

function getStoredRecords(runtime) {
  const records = runtime.storage.get('audioTool.records.v1')
  return Array.isArray(records) ? records : []
}

function pointOnArea(area) {
  if (Array.isArray(area && area.pathPoints) && area.pathPoints.length) {
    const [x, y] = area.pathPoints[Math.floor(area.pathPoints.length / 2)]
    return { x, y }
  }
  return { x: area.left + area.width / 2, y: area.top + area.height / 2 }
}

function findViewBlockEnd(source, openingIndex) {
  const viewTags = /<\/?view\b/g
  viewTags.lastIndex = openingIndex
  let depth = 0
  let match
  while ((match = viewTags.exec(source))) {
    if (match[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) return match.index
    } else {
      depth += 1
    }
  }
  return -1
}

function selectProjectAction(runtime, page, confirm, projectName = '接线回归项目') {
  if (page.data.projectDialogVisible) page.closeProjectDialog(true)
  assert.strictEqual(page.saveToActiveProject(), true, 'ready wiring result should open project selection')
  const project = page.data.projectProjects.find((item) => item.name === projectName)
  assert(project, 'the existing project should appear in the project sheet')
  const revision = page.data.projectDialogRevision
  const selectEvent = { currentTarget: { dataset: { id: project.id, step: 'select', dialogRevision: revision } } }
  assert.strictEqual(page.selectProjectTarget(selectEvent), true, 'selecting a project should open its confirmation form')
  assert.strictEqual(page.data.projectDialogStep, 'confirm')
  const confirmEvent = { currentTarget: { dataset: { step: 'confirm', dialogRevision: revision } } }
  const handle = {
    success({ confirm } = {}) {
      if (confirm === true) return page.saveProjectTarget(confirmEvent)
      if (confirm === false) {
        const returned = page.returnToProjectSelection(confirmEvent)
        if (returned) page.closeProjectDialog(true)
        return returned
      }
      return false
    },
    event: confirmEvent,
  }
  if (confirm !== undefined) handle.success({ confirm })
  return handle
}

function choose(page, side, id) {
  page.openEndpointSelector({ currentTarget: { dataset: { side } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id } } })
}

function chooseRequirement(page, requirementId, optionId) {
  page.selectWiringRequirement({ currentTarget: { dataset: { requirementId, optionId } } })
}

function testWiringPreferencesAndFirstUse() {
  const storageKey = 'audioWiringPreferencesV1'
  const { buildWiringText } = require('../pages/audio-wiring/wiring-model')
  const runtime = createRuntime()
  const page = createPage(runtime)
  assert.strictEqual(page.data.outputId, 'xlrBalanced')
  assert.strictEqual(page.data.inputId, 'terminalBalanced')
  assert.deepStrictEqual(page.data.manualSelected, { output: false, input: false })
  assert.strictEqual(getPreferenceWriteCount(runtime), 0, 'onLoad must not save the default example as user-selected')
  assert.deepStrictEqual(getStoredRecords(runtime), [], 'onLoad and favorite synchronization must not save a wiring plan')
  assert.strictEqual(page.data.supported, true, 'the ready default example remains usable without a new confirmation gate')
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.length, 1, 'the example can still be copied under the existing ready-model rule')
  assert.strictEqual(runtime.clipboard.at(-1),
    `默认示例，先核对实际两端接口。\n\n${buildWiringText(page.data.model)}`,
    'default clipboard text carries the example notice before the unchanged connection text')
  const defaultReport = startReport(page, runtime)
  assert(runtime.reportPhotoDraws >= 2,
    'the exported default solder diagram draws both real endpoint photos through the legacy canvas adapter')
  assert(runtime.reportTexts.join('').includes('默认示例，先核对实际两端接口。'),
    'a standalone report preserves the default-example warning')
  defaultReport.success({ tempFilePath: '/tmp/default-example.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/default-example.png')
  page.closeResultReportPreview()
  assert.strictEqual(getPreferenceWriteCount(runtime), 0, 'copying/exporting does not persist wiring preferences')
  assert.deepStrictEqual(getStoredRecords(runtime), [], 'copying/exporting does not persist a wiring plan')

  choose(page, 'output', 'xlrBalanced')
  assert.deepStrictEqual(page.data.manualSelected, { output: true, input: false },
    'reselecting the same output still records that the user checked it')
  assert.strictEqual(getPreferenceWriteCount(runtime), 1)
  assert.strictEqual(page.data.resultReportImagePath, '',
    'a changed example notice invalidates the old report image')
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.at(-1),
    `仍有接口为默认示例，请核对实际两端接口。\n\n${buildWiringText(page.data.model)}`,
    'one-endpoint selection carries the remaining example notice in copied text')
  choose(page, 'input', 'terminalBalanced')
  assert.deepStrictEqual(page.data.manualSelected, { output: true, input: true })
  assert.strictEqual(page.data.resultReportImagePath, '',
    'removing the last example notice invalidates the cached report')
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.at(-1), buildWiringText(page.data.model),
    'two manually checked endpoints copy only the original connection text')

  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'tsMono')
  const writesBeforeRequirement = getPreferenceWriteCount(runtime)
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert.strictEqual(getPreferenceWriteCount(runtime), writesBeforeRequirement,
    'fixed T routing does not create a stored UI choice')
  choose(page, 'input', 'xlrBalanced')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'ready',
    'stereo35 to mono always uses T and needs no source-channel confirmation')

  const stored = runtime.storage.get(storageKey)
  assert.deepStrictEqual(Object.keys(stored).sort(),
    ['face', 'inputId', 'manualSelected', 'outputId', 'version', 'viewMode'].sort(),
    'the saved preference schema contains no requirements, results, copied text, or pin plan')
  assert.strictEqual(stored.version, 1)
  assert.strictEqual(stored.outputId, 'stereo35')
  assert.strictEqual(stored.inputId, 'tsMono')
  assert.strictEqual(stored.viewMode, 'connectors')
  assert.strictEqual(stored.face, 'solder')
  assert.deepStrictEqual(stored.manualSelected, { output: true, input: true })
  const { OUTPUT_OPTIONS, INPUT_OPTIONS } = require('../pages/audio-wiring/wiring-model')
  assert(OUTPUT_OPTIONS.some((option) => option.id === stored.outputId))
  assert(INPUT_OPTIONS.some((option) => option.id === stored.inputId))

  const malicious = { ...stored, selections: { sourceChannel: 'left', outputMode: 'coldReturn' } }
  const restoredRuntime = createRuntime({ storage: { [storageKey]: malicious } })
  const restoredPage = createPage(restoredRuntime)
  assert.strictEqual(restoredPage.data.outputId, 'stereo35')
  assert.strictEqual(restoredPage.data.inputId, 'tsMono')
  assert.strictEqual(restoredPage.data.viewMode, 'connectors')
  assert.strictEqual(restoredPage.data.face, 'solder')
  assert.deepStrictEqual(restoredPage.data.selections, {}, 'cached requirement selections must be ignored')
  assert.strictEqual(restoredPage.data.wiringStatus, 'ready')
  assert.strictEqual(restoredPage.data.supported, true)
  assert.strictEqual(restoredPage.data.showRestoredHint, true)
  assert.deepStrictEqual(restoredPage.data.model.connections.map((wire) => `${wire.fromPin}>${wire.toPin}`), ['T>T', 'S>S'],
    'restored stereo-to-mono always uses fixed T routing')
  const copiesBeforeRestoreAttempt = restoredRuntime.clipboard.length
  restoredPage.copyConnection()
  assert.strictEqual(restoredRuntime.clipboard.length, copiesBeforeRestoreAttempt + 1)
  const restoredFixedReport = startReport(restoredPage, restoredRuntime)
  restoredFixedReport.success({ tempFilePath: '/tmp/restored-fixed-t.png' })
  assert.strictEqual(restoredPage.data.resultReportImagePath, '/tmp/restored-fixed-t.png',
    'restored fixed T routing remains ready to copy and export')

  const maliciousColdReturn = {
    ...stored,
    outputId: 'xlrBalanced',
    inputId: 'rcaStereo',
    selections: { outputMode: 'coldReturn', destinationChannel: 'both', sourceChannel: 'right' },
  }
  const coldRestoreRuntime = createRuntime({ storage: { [storageKey]: maliciousColdReturn } })
  const coldRestorePage = createPage(coldRestoreRuntime)
  assert.deepStrictEqual(coldRestorePage.data.selections, {})
  assert.strictEqual(coldRestorePage.data.wiringStatus, 'needs-choice')
  assert.deepStrictEqual(coldRestorePage.data.requirements.map((item) => item.id), ['outputMode', 'destinationChannel'])
  assert(coldRestorePage.data.requirements.every((item) => !item.value),
    'cold-return and destination-channel conditions always need fresh choices')

  const readyPreference = {
    version: 1,
    outputId: 'xlrBalanced',
    inputId: 'terminalBalanced',
    manualSelected: { output: true, input: true },
    viewMode: 'connectors',
    face: 'mating',
  }
  const restoredReadyRuntime = createRuntime({ storage: { [storageKey]: readyPreference } })
  const restoredReadyPage = createPage(restoredReadyRuntime)
  assert.strictEqual(getPreferenceWriteCount(restoredReadyRuntime), 0, 'restoration itself does not write preferences')
  assert(restoredReadyPage.data.showRestoredHint)
  restoredReadyPage.copyConnection()
  assert.strictEqual(restoredReadyRuntime.clipboard.at(-1),
    `已恢复上次接口，请按本次设备核对；接线条件需重新确认。\n\n${buildWiringText(restoredReadyPage.data.model)}`,
    'restored clipboard text carries the current-equipment notice')
  const restoredReadyReportStart = restoredReadyRuntime.reportTexts.length
  const restoredReadyReport = startReport(restoredReadyPage, restoredReadyRuntime)
  assert(restoredReadyRuntime.reportTexts.slice(restoredReadyReportStart).join('').includes('按本次设备核对'),
    'a restored report reminds users to check the current equipment')
  restoredReadyReport.success({ tempFilePath: '/tmp/restored-ready.png' })

  const invalidRuntime = createRuntime({ storage: { [storageKey]: {
    ...stored, outputId: 'unrecognized-endpoint', manualSelected: { output: 1, input: true },
  } } })
  const invalidPage = createPage(invalidRuntime)
  assert.strictEqual(invalidPage.data.outputId, 'xlrBalanced')
  assert.strictEqual(invalidPage.data.inputId, 'terminalBalanced')
  assert.deepStrictEqual(invalidPage.data.manualSelected, { output: false, input: false })
  assert(invalidPage.data.wiringStorageWarning.includes('无法识别'))
  const badVersionRuntime = createRuntime({ storage: { [storageKey]: { ...stored, version: 99 } } })
  const badVersionPage = createPage(badVersionRuntime)
  assert.strictEqual(badVersionPage.data.outputId, 'xlrBalanced')
  assert(badVersionPage.data.wiringStorageWarning)

  const missingApiRuntime = createRuntime({ storageApiAvailable: false })
  const missingApiPage = createPage(missingApiRuntime)
  assert(missingApiPage.data.wiringStorageWarning.includes('无法记住'))
  choose(missingApiPage, 'output', 'xlrBalanced')
  assert.strictEqual(missingApiPage.data.manualSelected.output, true,
    'missing storage APIs leave the current page interactive')
  assert.strictEqual(missingApiRuntime.storageWrites.length, 0)

  const readFailureRuntime = createRuntime({ failStorageRead: true })
  const readFailurePage = createPage(readFailureRuntime)
  assert(readFailurePage.data.wiringStorageWarning.includes('读取'))
  assert.strictEqual(readFailurePage.data.supported, true)
  const writeFailureRuntime = createRuntime({ failStorageWrite: true })
  const writeFailurePage = createPage(writeFailureRuntime)
  choose(writeFailurePage, 'input', 'terminalBalanced')
  assert.strictEqual(writeFailurePage.data.manualSelected.input, true)
  assert(writeFailurePage.data.wiringStorageWarning.includes('保存失败'))
}

function testWiringMainScreenStructure() {
  const wxml = fs.readFileSync(require.resolve('../pages/audio-wiring/index.wxml'), 'utf8')
  assert(wxml.startsWith('<view class="wiring-page page-root" style="{{resultReportPreviewStyle}}">'),
    'the cable-aligned preview can apply measured size limits to its page root')
  const diagramStart = wxml.indexOf('<view class="diagram-card">')
  const diagramEnd = findViewBlockEnd(wxml, diagramStart)
  const endpointStart = wxml.indexOf('<view class="endpoint-row">')
  assert(diagramStart >= 0 && diagramEnd > diagramStart && endpointStart > diagramEnd,
    'the complete wiring diagram card must appear above endpoint selection')
  const diagram = wxml.slice(diagramStart, diagramEnd)
  assert.strictEqual((diagram.match(/class="action-button"/g) || []).length, 4,
    'the diagram heading should contain reset, share, favorite, and project actions')
  assert(diagram.includes('aria-label="重置接线方案"')
    && diagram.includes('disabled="{{!outputId && !inputId && !manualSelected.output && !manualSelected.input}}"')
    && diagram.includes('aria-label="分享接线方案图片"')
    && diagram.includes('aria-label="收藏当前接线方案"')
    && diagram.includes('aria-label="保存接线方案到项目"'),
  'all four diagram actions should have accessible labels')
  assert(!wxml.includes('wiring-state-banner') && !wxml.includes('explanation-card')
    && !wxml.includes('diagram-footnote') && !wxml.includes('wiring-actions-safe-area')
    && !wxml.includes('导出方案图片') && !wxml.includes('复制接法'),
  'the old reminders and fixed bottom export/copy row should be removed')
}

function testWiringRecordActionsAndRestore() {
  const recordsApi = require('../utils/records')
  const runtime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const project = recordsApi.createProject('接线回归项目')
  assert(project)
  const page = createPage(runtime)
  assert.deepStrictEqual(getStoredRecords(runtime), [], 'opening a ready default example must not create a record')
  const payload = page.getRecordPayload()
  assert.strictEqual(payload.module, 'audioWiring')
  assert.deepStrictEqual(Object.keys(payload.preferences),
    ['version', 'outputId', 'inputId', 'manualSelected', 'viewMode', 'face', 'selections'],
    'record preferences should append canonical selections after the six legacy fields')
  assert(payload.resultText.includes('结果性质：接线参考')
    && payload.resultText.includes('按具体设备型号说明书核对'))

  selectProjectAction(runtime, page, false)
  assert.deepStrictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records, [],
    'canceling the native project confirmation should not save a record')

  const failedSave = selectProjectAction(runtime, page)
  runtime.failStorageWrite = true
  failedSave.success({ confirm: true })
  runtime.failStorageWrite = false
  assert.deepStrictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records, [],
    'a failed local write should leave no project record')
  assert(page.data.projectError.includes('保存失败'),
    'a failed project write should keep the in-sheet error and allow retry')

  const hiddenConfirmation = selectProjectAction(runtime, page)
  const hiddenRequestId = page._projectSaveRequestId
  page.onHide()
  page.onShow()
  const resumedConfirmation = selectProjectAction(runtime, page)
  const resumedRequestId = page._projectSaveRequestId
  assert(resumedRequestId > hiddenRequestId, 'showing the page should allow a fresh project request')
  hiddenConfirmation.success({ confirm: true })
  assert.strictEqual(page._projectSaveRequestId, resumedRequestId,
    'a hidden request callback must not change the newer request token')
  assert.strictEqual(page.data.projectDialogStep, 'confirm',
    'a hidden confirmation callback must not alter the newer project sheet')
  assert.strictEqual(page._projectSavePending, false,
    'opening a confirmation form does not start a project write')
  assert.deepStrictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records, [],
    'a project confirmation received after hide/show must not save the old request')
  assert.deepStrictEqual(recordsApi.getProjectRecords(project.id), [],
    'a stale hide/show callback must not attach a record to the project')
  resumedConfirmation.success({ confirm: false })
  assert.strictEqual(page._projectSavePending, false, 'canceling the replacement confirmation leaves no project write pending')

  choose(page, 'output', 'xlrBalanced')
  choose(page, 'input', 'terminalBalanced')
  page.toggleCurrentFavorite()
  assert.strictEqual(page.data.currentFavorite, true)
  assert.strictEqual(runtime.toasts.at(-1)?.title, '已收藏常用',
    'the first successful favorite action reports that the plan was saved')
  let records = recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records
  assert.strictEqual(records.length, 1)
  const defaultRecordId = records[0].id
  assert.strictEqual(records[0].module, 'audioWiring')
  assert(records[0].favorite)

  const staleSave = selectProjectAction(runtime, page)
  page.closeProjectDialog(true)
  choose(page, 'output', 'rcaMono')
  choose(page, 'input', 'tsMono')
  staleSave.success({ confirm: true })
  records = recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records
  assert.strictEqual(records.length, 1)
  assert.strictEqual(records[0].id, defaultRecordId)
  assert.deepStrictEqual(records[0].projectIds, [],
    'a confirmation callback from a closed sheet must not save its old wiring payload')
  choose(page, 'output', 'xlrBalanced')
  choose(page, 'input', 'terminalBalanced')
  assert.strictEqual(page.data.currentFavorite, true,
    'favorite state should resync when the original interface combination returns')

  selectProjectAction(runtime, page, true)
  records = recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records
  assert.strictEqual(records.length, 1, 'favorite and project save should deduplicate the same wiring signature')
  assert.strictEqual(records[0].id, defaultRecordId)
  assert(records[0].favorite && records[0].projectIds.includes(project.id))

  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert(!page.data.requirements.some((item) => item.id === 'sourceChannel'))
  page.toggleCurrentFavorite()
  const leftPayload = page.getRecordPayload()
  assert.deepStrictEqual(leftPayload.preferences.selections, { sourceChannel: 'left' })
  records = recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records
  const channelRecords = records.filter((record) => record.preferences.outputId === 'stereo35')
  assert.strictEqual(channelRecords.length, 1, 'the fixed stereo-to-mono route has one record identity')
  assert(channelRecords[0].favorite)

  const leftRecord = channelRecords.find((record) => record.preferences.selections.sourceChannel === 'left')
  const tampered = {
    ...leftRecord,
    preferences: { ...leftRecord.preferences, selections: { sourceChannel: 'right', extra: 'ignored' } },
  }
  assert.strictEqual(recordsApi.restoreRecord(tampered), '/pages/audio-wiring/index')
  const restoredPreferences = runtime.storage.get('audioWiringPreferencesV1')
  assert.deepStrictEqual(Object.keys(restoredPreferences),
    ['version', 'outputId', 'inputId', 'manualSelected', 'viewMode', 'face'],
    'record restoration should write only the six legacy preference fields')
  page.onHide()
  const restoredPage = createPage(runtime)
  assert.strictEqual(restoredPage.data.outputId, 'stereo35')
  assert.strictEqual(restoredPage.data.inputId, 'tsMono')
  assert.deepStrictEqual(restoredPage.data.selections, {},
    'reopening a restored record does not restore choice state')
  assert.strictEqual(restoredPage.data.wiringStatus, 'ready',
    'the fixed stereo T mapping is ready without a stored user choice')
  assert.deepStrictEqual(restoredPage.data.model.connections.map((wire) => `${wire.fromPin}>${wire.toPin}`), ['T>T', 'S>S'])
  const unloadProject = recordsApi.createProject('接线卸载回调项目')
  assert(unloadProject)
  restoredPage.resetWiring()
  choose(restoredPage, 'output', 'xlrBalanced')
  choose(restoredPage, 'input', 'terminalBalanced')
  const recordIdsBeforeUnload = recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records.map((record) => record.id)
  const unloadedConfirmation = selectProjectAction(runtime, restoredPage, undefined, unloadProject.name)
  restoredPage.onUnload()
  unloadedConfirmation.success({ confirm: true })
  assert.deepStrictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records.map((record) => record.id),
    recordIdsBeforeUnload, 'a project confirmation received after unload must not create or alter a record')
  assert.deepStrictEqual(recordsApi.getProjectRecords(unloadProject.id), [],
    'a stale unload callback must not attach a record to the project')

  restoredPage.onUnload()
  const invalidManualRecord = {
    ...leftRecord,
    preferences: {
      ...leftRecord.preferences,
      manualSelected: { output: 1, input: true },
    },
  }
  assert.strictEqual(recordsApi.restoreRecord(invalidManualRecord), '/pages/audio-wiring/index')
  const invalidManualPreferences = runtime.storage.get('audioWiringPreferencesV1')
  assert.deepStrictEqual(invalidManualPreferences.manualSelected, { output: 1, input: true },
    'record restoration must preserve invalid legacy field types for the original page validator')
  const invalidManualPage = createPage(runtime)
  assert.strictEqual(invalidManualPage.data.outputId, 'xlrBalanced',
    'invalid restored manualSelected types must make the page fall back to default interfaces')
  assert.strictEqual(invalidManualPage.data.inputId, 'terminalBalanced')
  assert.strictEqual(invalidManualPage.data.showRestoredHint, false)
  assert(invalidManualPage.data.wiringStorageWarning.includes('无法识别'))
  invalidManualPage.onUnload()
}

function testWiringResetInvalidatesPendingWork() {
  const recordsApi = require('../utils/records')
  const runtime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  recordsApi.createProject('接线回归项目')
  const page = createPage(runtime)
  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'tsMono')
  const { getWiringHitAreas } = require('../pages/audio-wiring/wiring-renderer')
  const areas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { layout: 'solder-wiring', avoidRail: true, selectedId: '', showTitle: false })
  assert(areas.length)
  page.onDiagramTap({ detail: pointOnArea(areas[0]) })
  assert(page.data.selectedId)
  const pendingReport = startReport(page, runtime)
  const pendingProjectSave = selectProjectAction(runtime, page)

  page.resetWiring()
  assert.strictEqual(page.data.outputId, '')
  assert.strictEqual(page.data.inputId, '')
  assert.deepStrictEqual(page.data.manualSelected, { output: false, input: false })
  assert.deepStrictEqual(page.data.selections, {})
  assert.strictEqual(page.data.selectedId, '')
  assert.strictEqual(page.data.selectedConnection, null)
  assert.strictEqual(page.data.viewMode, 'connectors')
  assert.strictEqual(page.data.face, 'solder')
  assert.strictEqual(page.data.showRestoredHint, false)
  assert.strictEqual(page.data.supported, false, 'reset should leave both interfaces unselected')
  assert.strictEqual(page.data.model, null)
  assert.strictEqual(page.data.hasBothEndpoints, false)
  assert.strictEqual(page.data.wiringStatus, 'incomplete')
  const storedPreferences = runtime.storage.get('audioWiringPreferencesV1')
  assert.deepStrictEqual(Object.keys(storedPreferences).sort(),
    ['face', 'inputId', 'manualSelected', 'outputId', 'version', 'viewMode'].sort())
  assert.deepStrictEqual(storedPreferences.manualSelected, { output: false, input: false })
  assert.strictEqual(storedPreferences.outputId, '')
  assert.strictEqual(storedPreferences.inputId, '')
  assert.strictEqual(storedPreferences.viewMode, 'connectors')
  assert.strictEqual(storedPreferences.face, 'solder')

  const mutationsAfterReset = page.mutationCount
  pendingReport.success({ tempFilePath: '/tmp/stale-after-wiring-reset.png' })
  pendingProjectSave.success({ confirm: true })
  assert.strictEqual(page.mutationCount, mutationsAfterReset,
    'reset should invalidate pending report and project callbacks')
  assert.deepStrictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records, [],
    'reset should prevent a prior project confirmation from saving the old wiring plan')
  assert.strictEqual(page.data.resultReportImagePath, '')
  const reopenedPage = createPage(runtime)
  assert.strictEqual(reopenedPage.data.outputId, '', 'persisted reset should reopen with no output selected')
  assert.strictEqual(reopenedPage.data.inputId, '', 'persisted reset should reopen with no input selected')
  assert.strictEqual(reopenedPage.data.model, null)
  reopenedPage.onUnload()
  page.onUnload()
}

function testWiringFavoriteLegacyFallback() {
  const recordsApi = require('../utils/records')
  const runtime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const project = recordsApi.createProject('接线旧记录保护')
  assert(project)
  const page = createPage(runtime)
  const payload = page.getRecordPayload()
  const legacyPreferences = { ...payload.preferences, viewMode: 'wiring', face: 'mating' }
  delete legacyPreferences.selections
  const legacyPayload = { ...payload, title: '旧接线标题', summary: '旧接线摘要', resultText: '旧接线正文', preferences: legacyPreferences }
  const legacyRecord = recordsApi.saveRecord(legacyPayload, { favorite: true })
  assert(recordsApi.addRecordToProject(legacyPayload, project.id))
  const canonicalRecord = recordsApi.saveRecord(payload, { favorite: true })
  assert(legacyRecord && canonicalRecord)
  assert.strictEqual(page.toggleCurrentFavorite(), true)
  let records = recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records
  assert.strictEqual(runtime.toasts.at(-1)?.title, '当前兼容方案仍已收藏',
    'removing the exact canonical view reports the still-favorited compatible legacy view')
  assert(!records.some((record) => record.id === canonicalRecord.id),
    'toggling off the canonical record should remove its exact saved signature')
  assert(records.some((record) => record.id === legacyRecord.id && record.favorite),
    'a separately favorited compatible legacy record remains available')
  const preservedLegacy = records.find((record) => record.id === legacyRecord.id)
  assert.strictEqual(preservedLegacy.title, '旧接线标题')
  assert.strictEqual(preservedLegacy.summary, '旧接线摘要')
  assert.strictEqual(preservedLegacy.resultText, '旧接线正文')
  assert.deepStrictEqual(preservedLegacy.preferences, legacyPreferences,
    'removing the canonical favorite must not rewrite a compatible legacy record body or preferences')
  assert.strictEqual(page.data.currentFavorite, true,
    'the active compatible favorite state follows the remaining legacy record')
  assert.strictEqual(page.toggleCurrentFavorite(), true)
  records = recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records
  assert.strictEqual(records.length, 1, 'unfavoriting a project record keeps its archived entry')
  assert.strictEqual(records[0].favorite, false)
  assert.strictEqual(records[0].title, '旧接线标题')
  assert.strictEqual(records[0].summary, '旧接线摘要')
  assert.strictEqual(records[0].resultText, '旧接线正文')
  assert.deepStrictEqual(records[0].preferences, legacyPreferences,
    'favorite toggles by record ID preserve the older connection text and signature')
  assert.deepStrictEqual(records[0].projectIds, [project.id])
  assert.strictEqual(page.data.currentFavorite, false)
  assert.strictEqual(runtime.toasts.at(-1)?.title, '已取消收藏')
  page.onUnload()

  const failedRuntime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const failedPage = createPage(failedRuntime)
  const failedPayload = failedPage.getRecordPayload()
  const failedLegacyPreferences = { ...failedPayload.preferences, viewMode: 'wiring', face: 'mating' }
  delete failedLegacyPreferences.selections
  const failedLegacy = recordsApi.saveRecord({ ...failedPayload,
    title: '旧视角收藏标题', summary: '旧视角收藏摘要', resultText: '旧视角收藏正文',
    preferences: failedLegacyPreferences,
  }, { favorite: true })
  assert(failedLegacy)
  const failedProject = recordsApi.createProject('旧视角收藏写入失败项目')
  assert(failedProject && recordsApi.addRecordToProject({ ...failedPayload,
    title: '旧视角收藏标题', summary: '旧视角收藏摘要', resultText: '旧视角收藏正文',
    preferences: failedLegacyPreferences,
  }, failedProject.id))
  const recordBeforeFailure = JSON.parse(JSON.stringify(
    recordsApi.getRecords().find((record) => record.id === failedLegacy.id)))
  const vibrationsBeforeFailure = failedRuntime.vibrations
  failedRuntime.failStorageWrite = true
  assert.strictEqual(failedPage.toggleCurrentFavorite(), false,
    'a failed write cannot report removal when the compatible legacy record still exists')
  assert.strictEqual(failedRuntime.toasts.at(-1)?.title, '保存失败，请检查本地存储')
  assert.strictEqual(failedRuntime.vibrations, vibrationsBeforeFailure,
    'a failed favorite write does not emit success haptics')
  assert.deepStrictEqual(recordsApi.getRecords().find((record) => record.id === failedLegacy.id), recordBeforeFailure,
    'a failed legacy favorite write preserves the complete record and preferences')
  failedRuntime.failStorageWrite = false
  assert.strictEqual(failedPage.toggleCurrentFavorite(), true,
    'the existing compatible legacy favorite can still be canceled after retry')
  const canceledLegacy = recordsApi.getRecords().find((record) => record.id === failedLegacy.id)
  assert.strictEqual(canceledLegacy.favorite, false)
  assert.strictEqual(canceledLegacy.title, recordBeforeFailure.title)
  assert.strictEqual(canceledLegacy.summary, recordBeforeFailure.summary)
  assert.strictEqual(canceledLegacy.resultText, recordBeforeFailure.resultText)
  assert.deepStrictEqual(canceledLegacy.preferences, recordBeforeFailure.preferences)
  failedPage.onUnload()
}

function testFixedStereoRecordIdentityAndLegacyLookup() {
  const recordsApi = require('../utils/records')
  const runtime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const page = createPage(runtime)
  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert.deepStrictEqual(page.data.model.connections.map((wire) => `${wire.fromPin}>${wire.toPin}`), ['T>T', 'S>S'])
  const current = page.getRecordPayload()
  assert.deepStrictEqual(current.preferences.selections, { sourceChannel: 'left' },
    'fixed T remains an identity field in new record signatures without a UI requirement')

  const legacyPreferences = {
    ...current.preferences,
    viewMode: 'wiring',
    face: 'mating',
    selections: { sourceChannel: 'left' },
  }
  const legacyPayload = {
    ...current,
    title: '旧版左声道接法',
    summary: '旧版摘要',
    resultText: '旧版完整正文',
    preferences: legacyPreferences,
  }
  const legacyRecord = recordsApi.saveRecord(legacyPayload, { favorite: true })
  assert(legacyRecord)
  assert.strictEqual(page.findCompatibleWiringRecord(current).id, legacyRecord.id,
    'legacy left-channel records match the fixed T plan')
  page.onShow()
  assert.strictEqual(page.data.currentFavorite, true)
  assert.strictEqual(page.saveToActiveProject(), true)
  assert.strictEqual(page.data.projectFrozenTitle, '旧版左声道接法')
  assert.strictEqual(page.data.projectFrozenSummary, '旧版摘要')
  assert.strictEqual(page.data.projectFrozenResultText, '旧版完整正文',
    'saving a compatible legacy plan uses its existing body instead of regenerating copy')
  page.closeProjectDialog(true)

  const incompatibleCases = [
    { sourceChannel: 'right' },
    {},
  ]
  incompatibleCases.forEach((selections, index) => {
    const isolatedRuntime = createRuntime()
    assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
    const isolatedPage = createPage(isolatedRuntime)
    choose(isolatedPage, 'output', 'stereo35')
    choose(isolatedPage, 'input', 'tsMono')
    const currentPayload = isolatedPage.getRecordPayload()
    const oldPreferences = {
      ...currentPayload.preferences,
      viewMode: index ? 'connectors' : 'wiring',
      face: index ? 'solder' : 'mating',
      selections,
    }
    const oldRecord = recordsApi.saveRecord({
      ...currentPayload,
      title: `不兼容旧接法${index}`,
      summary: '旧摘要保留',
      resultText: '旧正文保留',
      preferences: oldPreferences,
    }, { favorite: true })
    assert(oldRecord)
    assert.strictEqual(isolatedPage.findCompatibleWiringRecord(currentPayload), null,
      'old right or missing-source identity is ambiguous and cannot match fixed T')
    assert.strictEqual(isolatedPage.data.currentFavorite, false)
    isolatedPage.onUnload()
  })
  page.onUnload()
}

function testWiringProjectDialogGuardsAndLifecycle() {
  const recordsApi = require('../utils/records')
  const runtime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const target = recordsApi.createProject('接线生命周期项目')
  assert(target)
  const page = createPage(runtime)
  choose(page, 'output', 'xlrBalanced')
  choose(page, 'input', 'terminalBalanced')

  assert.strictEqual(page.saveToActiveProject(), true)
  const firstRevision = page._projectDialogRevision
  const staleSelect = { currentTarget: { dataset: { step: 'select', dialogRevision: firstRevision } } }
  const staleSearch = { currentTarget: { dataset: { step: 'select', dialogRevision: firstRevision } }, detail: { value: 'stale query' } }
  assert.strictEqual(page.closeProjectDialog(true), true)
  assert.strictEqual(page.saveToActiveProject(), true)
  assert(page._projectDialogRevision > firstRevision)
  page.onProjectSearch(staleSearch)
  assert.strictEqual(page.data.projectSearchText, '', 'search input from an earlier sheet revision is ignored')
  assert.strictEqual(page.openProjectCreateForm(staleSelect), false, 'stale selection actions cannot open create form')
  assert.strictEqual(page.selectProjectTarget({
    currentTarget: { dataset: { ...staleSelect.currentTarget.dataset, id: target.id } },
  }), false, 'stale selection actions cannot choose a target')

  const selectEvent = { currentTarget: { dataset: { step: 'select', dialogRevision: page._projectDialogRevision } } }
  assert.strictEqual(page.openProjectCreateForm(selectEvent), true)
  const createRevision = page._projectDialogRevision
  const createEvent = { currentTarget: { dataset: { step: 'create', dialogRevision: createRevision } } }
  page.onProjectNameInput({
    currentTarget: { dataset: { step: 'create', dialogRevision: createRevision } },
    detail: { value: '迟到创建项目' },
  })
  assert.strictEqual(page.returnToProjectSelection(createEvent), true)
  const currentSelectEvent = { currentTarget: { dataset: { step: 'select', dialogRevision: page._projectDialogRevision } } }
  assert.strictEqual(page.selectProjectTarget({
    currentTarget: { dataset: { ...currentSelectEvent.currentTarget.dataset, id: target.id } },
  }), true)
  const projectsBeforeLateCreate = recordsApi.getProjects().map((project) => project.id)
  assert.strictEqual(page.createProjectFromForm(createEvent), false,
    'a delayed create action from the previous dialog step cannot create a project')
  assert.deepStrictEqual(recordsApi.getProjects().map((project) => project.id), projectsBeforeLateCreate)

  const renameEvent = { currentTarget: { dataset: { step: 'confirm', dialogRevision: page._projectDialogRevision } } }
  assert(recordsApi.updateProject(target.id, { name: '改名后的接线项目' }))
  assert.strictEqual(page.saveProjectTarget(renameEvent), false)
  assert.strictEqual(page.data.projectDialogStep, 'select', 'renamed targets return to project selection')
  assert.strictEqual(page.data.projectSaving, false, 'renamed targets clear the saving state')
  assert.deepStrictEqual(recordsApi.getProjectRecords(target.id), [], 'renamed targets do not receive a stale save')

  const renamedSelect = { currentTarget: { dataset: { step: 'select', dialogRevision: page._projectDialogRevision, id: target.id } } }
  assert.strictEqual(page.selectProjectTarget(renamedSelect), true)
  const deleteEvent = { currentTarget: { dataset: { step: 'confirm', dialogRevision: page._projectDialogRevision } } }
  assert(recordsApi.deleteProject(target.id))
  assert.strictEqual(page.saveProjectTarget(deleteEvent), false)
  assert.strictEqual(page.data.projectDialogStep, 'select', 'deleted targets return to project selection')
  assert.strictEqual(page.data.projectSaving, false, 'deleted targets clear the saving state and leave close available')
  assert.strictEqual(page.data.projectTarget, null)
  assert.strictEqual(page.closeProjectDialog(true), true)
  page.onUnload()

  const hookRuntime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const hookProject = recordsApi.createProject('读存储时失效项目')
  assert(hookProject)
  const hookPage = createPage(hookRuntime)
  choose(hookPage, 'output', 'xlrBalanced')
  choose(hookPage, 'input', 'tsMono')
  chooseRequirement(hookPage, 'outputMode', 'coldReturn')
  assert.strictEqual(hookPage.data.wiringStatus, 'ready')
  assert.strictEqual(hookPage.saveToActiveProject(), true)
  const hookTarget = hookPage.data.projectProjects.find((project) => project.id === hookProject.id)
  const hookRevision = hookPage._projectDialogRevision
  assert.strictEqual(hookPage.selectProjectTarget({
    currentTarget: { dataset: { id: hookTarget.id, step: 'select', dialogRevision: hookRevision } },
  }), true)
  const hookConfirm = { currentTarget: { dataset: { step: 'confirm', dialogRevision: hookRevision } } }
  hookRuntime.beforeStorageRead = () => {
    if (!hookPage.data.projectSaving) return
    hookRuntime.beforeStorageRead = null
    hookPage.clearWiringRequirement({ currentTarget: { dataset: { requirementId: 'outputMode' } } })
  }
  assert.strictEqual(hookPage.saveProjectTarget(hookConfirm), false,
    'a selection change raised during project snapshot storage reads aborts the stale save')
  assert.strictEqual(hookPage.data.projectSaving, false)
  assert.strictEqual(hookPage._projectSavePending, false)
  assert.strictEqual(hookPage.data.projectSaveBlocked, true)
  assert.deepStrictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).records, [])
  assert.deepStrictEqual(recordsApi.getProjectRecords(hookProject.id), [])
  assert.strictEqual(hookPage.closeProjectDialog(true), true,
    'invalidating a read-hook save leaves the close action available')
  hookPage.onUnload()

  const metadataRuntime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const metadataPage = createPage(metadataRuntime)
  assert.strictEqual(metadataPage.saveToActiveProject(), true)
  const metadataRevision = metadataPage._projectDialogRevision
  const selectForCreate = { currentTarget: { dataset: { step: 'select', dialogRevision: metadataRevision } } }
  assert.strictEqual(metadataPage.openProjectCreateForm(selectForCreate), true)
  const metadataCreateRevision = metadataPage._projectDialogRevision
  const metadataCreateEvent = { currentTarget: { dataset: { step: 'create', dialogRevision: metadataCreateRevision } } }
  const focusEvent = {
    currentTarget: { dataset: { step: 'create', dialogRevision: metadataCreateRevision, field: 'projectNameText' } },
    timeStamp: 100,
  }
  metadataPage.beginProjectInputFocus(focusEvent)
  const focusEpisode = metadataPage.data.projectFocusEpisode
  metadataPage.onProjectKeyboardHeightChange({
    currentTarget: { dataset: { step: 'create', dialogRevision: metadataCreateRevision, field: 'projectNameText', focusEpisode: focusEpisode - 1 } },
    timeStamp: 101,
    detail: { height: 260, timeStamp: 101 },
  })
  assert.strictEqual(metadataPage.data.projectKeyboardOpen, false,
    'keyboard events from an earlier focus episode cannot resize the project sheet')
  metadataPage.onProjectKeyboardHeightChange({
    currentTarget: { dataset: { step: 'create', dialogRevision: metadataCreateRevision, field: 'projectNameText', focusEpisode } },
    timeStamp: 102,
    detail: { height: 260, timeStamp: 102 },
  })
  assert.strictEqual(metadataPage.data.projectKeyboardOpen, true,
    'the active project-name focus episode opens the keyboard-aware sheet')
  metadataPage.onProjectNameInput({
    currentTarget: { dataset: { step: 'create', dialogRevision: metadataCreateRevision } },
    detail: { value: '音频新建记录项目' },
  })
  assert.strictEqual(metadataPage.createProjectFromForm(metadataCreateEvent), true,
    'a current create-form action creates and selects a project')
  const createdProjectId = metadataPage.data.projectTarget.id
  const metadataConfirm = { currentTarget: { dataset: { step: 'confirm', dialogRevision: metadataPage._projectDialogRevision } } }
  metadataPage.onProjectConfigNameInput({
    currentTarget: { dataset: { step: 'confirm', dialogRevision: metadataPage._projectDialogRevision } },
    detail: { value: '左声道监听接法' },
  })
  metadataPage.onProjectConfigNoteInput({
    currentTarget: { dataset: { step: 'confirm', dialogRevision: metadataPage._projectDialogRevision } },
    detail: { value: '施工前复核输入端说明书' },
  })
  assert.strictEqual(metadataPage.saveProjectTarget(metadataConfirm), true,
    'the project form saves a wiring record with its per-project name and note')
  assert.strictEqual(metadataPage.data.projectDialogStep, 'success')
  const savedProjectRecord = recordsApi.getProjectRecords(createdProjectId)[0]
  const savedProjectView = recordsApi.getProjectRecordView(savedProjectRecord, createdProjectId)
  assert.strictEqual(savedProjectView.title, '左声道监听接法')
  assert.strictEqual(savedProjectView.projectNote, '施工前复核输入端说明书')
  assert.strictEqual(savedProjectView.hasProjectMetadata, true)
  metadataPage.onUnload()

  const legacyRuntime = createRuntime()
  assert.strictEqual(recordsApi.getWorkspaceSnapshot({ forceRefresh: true }).ok, true)
  const legacyPage = createPage(legacyRuntime)
  const legacyPayload = legacyPage.getRecordPayload()
  const legacyPreferences = { ...legacyPayload.preferences, viewMode: 'wiring', face: 'mating' }
  delete legacyPreferences.selections
  const legacyRecord = recordsApi.saveRecord({ ...legacyPayload, preferences: legacyPreferences }, { favorite: true })
  const legacyProject = recordsApi.createProject('兼容记录变化项目')
  assert(legacyRecord && legacyProject)
  assert.strictEqual(legacyPage.saveToActiveProject(), true)
  const legacyTarget = legacyPage.data.projectProjects.find((project) => project.id === legacyProject.id)
  const legacyRevision = legacyPage._projectDialogRevision
  assert.strictEqual(legacyPage.selectProjectTarget({
    currentTarget: { dataset: { step: 'select', dialogRevision: legacyRevision, id: legacyTarget.id } },
  }), true)
  const legacyConfirm = { currentTarget: { dataset: { step: 'confirm', dialogRevision: legacyRevision } } }
  legacyRuntime.beforeStorageRead = (key) => {
    if (!legacyPage.data.projectSaving || key !== 'audioTool.records.v1') return
    legacyRuntime.beforeStorageRead = null
    legacyRuntime.storage.set('audioTool.records.v1',
      (legacyRuntime.storage.get('audioTool.records.v1') || []).filter((record) => record.id !== legacyRecord.id))
  }
  assert.strictEqual(legacyPage.saveProjectTarget(legacyConfirm), false,
    'a legacy-compatible record disappearing during forced refresh aborts the frozen save')
  assert.strictEqual(legacyPage.data.projectSaving, false)
  assert.strictEqual(legacyPage._projectSavePending, false)
  assert.strictEqual(legacyPage.data.projectSaveBlocked, true)
  assert(legacyPage.data.projectError.includes('兼容记录已变化'))
  assert.strictEqual(legacyPage.data.projectDialogStep, 'confirm')
  assert.deepStrictEqual(recordsApi.getProjectRecords(legacyProject.id), [],
    'the invalidated compatibility signature is not written to the project')
  assert.strictEqual(legacyPage.closeProjectDialog(true), true,
    'aborting a compatibility-record save leaves the dialog close action available')
  legacyPage.onUnload()
}

function testWiringResetStorageWarnings() {
  const missingStorageRuntime = createRuntime({ storageApiAvailable: false })
  const missingStoragePage = createPage(missingStorageRuntime)
  const missingStorageWarning = missingStoragePage.data.wiringStorageWarning
  assert(missingStorageWarning.includes('无法记住'))
  missingStoragePage.resetWiring()
  assert.strictEqual(missingStoragePage.data.wiringStorageWarning, missingStorageWarning,
    'reset must preserve the storage-unavailable warning when preferences cannot be written')
  assert.strictEqual(getPreferenceWriteCount(missingStorageRuntime), 0)
  missingStoragePage.onUnload()

  const failedStorageRuntime = createRuntime()
  const failedStoragePage = createPage(failedStorageRuntime)
  failedStorageRuntime.failStorageWrite = true
  failedStoragePage.resetWiring()
  assert(failedStoragePage.data.wiringStorageWarning.includes('保存失败'),
    'reset must retain the existing save-failure warning when the write throws')
  assert.strictEqual(getPreferenceWriteCount(failedStorageRuntime), 0)
  failedStoragePage.onUnload()
}

function testSelectorCloseGeometryAndHelpRemoval() {
  const runtime = createRuntime()
  const page = createPage(runtime)
  const report = startReport(page, runtime)
  report.success({ tempFilePath: '/tmp/help-cache.png' })
  page.closeResultReportPreview()
  const screenQueries = runtime.screenQueries
  const screenDraws = runtime.screenDraws
  const savedSelection = { ...page.data.selections }
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'output' } } })
  assert.strictEqual(page.data.selectorVisible, true)
  assert.strictEqual(page.data.selectorHelpVisible, undefined, 'the removed help panel has no page state')
  assert.strictEqual(runtime.screenQueries, screenQueries, 'the selector does not query the covered canvas')
  assert.strictEqual(runtime.screenDraws, screenDraws, 'the covered diagram stays hidden while the selector is open')
  assert.deepStrictEqual(page.data.selections, savedSelection)
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/help-cache.png')
  page.closeEndpointSelector()
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/help-cache.png')
  const wxml = fs.readFileSync(require.resolve('../pages/audio-wiring/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(require.resolve('../pages/audio-wiring/index.wxss'), 'utf8')
  const js = fs.readFileSync(require.resolve('../pages/audio-wiring/index.js'), 'utf8')
  assert(!wxml.includes('当前为默认示例；正式制作前，请核对并选择实际两端接口。'), 'removed the old full-page state reminder')
  assert(wxml.includes('role="button" aria-label="关闭接口选择"'), 'the selector close has an accessible label')
  assert(wxml.includes('class="selector-close-icon"'), 'the close glyph is CSS drawn')
  assert(!wxml.includes('selector-help') && !wxml.includes('识别说明'))
  assert(!wxss.includes('.selector-help-') && !js.includes('selectorHelpVisible')
    && !js.includes('openEndpointHelp') && !js.includes('closeEndpointHelp'),
  'removed selector help state, handlers, and styles together')
  assert(/\.selector-close\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*max-width:\s*44px;[^}]*height:\s*44px;[^}]*min-height:\s*44px;[^}]*max-height:\s*44px;[^}]*flex:\s*0\s+0\s+44px;/s.test(wxss),
    'close target cannot shrink below its required 44 by 44 pixels')
  assert(/\.selector-title\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1\s+1\s+auto;/s.test(wxss),
    'long selector title yields width before the close target')
}

function finishReportDraw(runtime) {
  const callback = runtime.reportDrawCallbacks.shift()
  assert.strictEqual(typeof callback, 'function', 'report canvas should queue a draw completion')
  callback()
  const task = runtime.reportExports.at(-1)
  assert(task, 'report export should begin after drawing')
  return task
}

function startReport(page, runtime) {
  const previousCount = runtime.reportExports.length
  page.generateResultReportImage()
  assert.strictEqual(page.data.isGeneratingResultReport, true)
  const task = finishReportDraw(runtime)
  assert.strictEqual(runtime.reportExports.length, previousCount + 1)
  return task
}

function testSupportedOptionsAndCopy(page, runtime) {
  const { OUTPUT_OPTIONS, INPUT_OPTIONS, buildWiringText } = require('../pages/audio-wiring/wiring-model')
  const { getWiringHitAreas } = require('../pages/audio-wiring/wiring-renderer')
  const balanced = ['xlrBalanced', 'trsBalanced', 'terminalBalanced']
  const mono = ['rcaMono', 'tsMono']
  const stereo = ['rcaStereo', 'tsStereo']
  const readyPairs = new Set()
  const choicePairs = new Set()
  balanced.forEach((output) => balanced.forEach((input) => readyPairs.add(`${output}|${input}`)))
  mono.forEach((output) => mono.forEach((input) => readyPairs.add(`${output}|${input}`)))
  mono.forEach((output) => balanced.forEach((input) => readyPairs.add(`${output}|${input}`)))
  balanced.forEach((output) => {
    mono.concat(stereo).forEach((input) => choicePairs.add(`${output}|${input}`))
  })
  mono.forEach((output) => stereo.forEach((input) => choicePairs.add(`${output}|${input}`)))
  OUTPUT_OPTIONS.forEach((output) => INPUT_OPTIONS.forEach((input) => {
    if (output.id === 'stereo35') readyPairs.add(`${output.id}|${input.id}`)
  }))
  assert.strictEqual(readyPairs.size, 26)
  assert.strictEqual(choicePairs.size, 16)
  assert.strictEqual(page.data.outputId, 'xlrBalanced')
  assert.strictEqual(page.data.inputId, 'terminalBalanced')
  assert.strictEqual(page.data.supported, true)
  assert.strictEqual(page.data.outputSignalSummary, '平衡单声道')

  let readyCount = 0
  let needsChoiceCount = 0
  OUTPUT_OPTIONS.forEach((output) => INPUT_OPTIONS.forEach((input) => {
    choose(page, 'output', output.id)
    choose(page, 'input', input.id)
    const pair = `${output.id}|${input.id}`
    const expectedStatus = readyPairs.has(pair) ? 'ready' : choicePairs.has(pair) ? 'needs-choice' : 'unsupported'
    assert.strictEqual(page.data.wiringStatus, expectedStatus, `${output.id} → ${input.id}`)
    assert.strictEqual(page.data.supported, expectedStatus === 'ready', `${output.id} → ${input.id}`)
    if (expectedStatus === 'ready') {
      readyCount += 1
    } else {
      assert.strictEqual(page.data.model.connections.length, 0)
      if (expectedStatus === 'needs-choice') {
        needsChoiceCount += 1
        assert(page.data.requirements.length > 0, `${pair} should expose a choice instead of a dead-end state`)
      }
      const exportsBefore = runtime.reportExports.length
      const copiesBefore = runtime.clipboard.length
      page.copyConnection()
      page.generateResultReportImage()
      assert.strictEqual(runtime.reportExports.length, exportsBefore)
      assert.strictEqual(runtime.clipboard.length, copiesBefore)
    }
  }))
  assert.strictEqual(readyCount, 26)
  assert.strictEqual(needsChoiceCount, 16)

  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'rcaStereo')
  assert.strictEqual(page.data.outputSignalSummary, '立体声非平衡')
  assert.strictEqual(page.data.outputSignalPortLabel, '立体声模拟 L/R')
  assert.strictEqual(page.data.outputSignalTypeLabel, '非平衡')
  assert(!page.data.outputSignalPortLabel.includes('LINE'), '3.5 mm stereo retains its model label without a LINE claim')
  assert(page.data.model.output.signalLabel.includes('L/R'), 'display text must not replace the full model signal label')
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.at(-1), buildWiringText(page.data.model))

  const areas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { layout: 'solder-wiring', avoidRail: true, showTitle: false })
  assert(areas[0].width >= 44)
  const point = pointOnArea(areas[0])
  page.onDiagramTouchStart({ touches: [{ x: point.x, y: point.y, pageX: point.x + 32, pageY: point.y + 480 }] })
  page.onDiagramTouchEnd({ changedTouches: [{ x: point.x, y: point.y, pageX: point.x + 32, pageY: point.y + 480 }] })
  assert.strictEqual(page.data.selectedConnection.id, areas[0].id)
}

function testWiringRequirements(page, runtime) {
  const { buildWiringText, getWiringModel } = require('../pages/audio-wiring/wiring-model')
  const { getWiringHitAreas } = require('../pages/audio-wiring/wiring-renderer')
  choose(page, 'output', 'xlrBalanced')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert.strictEqual(page.data.supported, false)
  assert.strictEqual(page.data.requirements[0].id, 'outputMode')
  assert.deepStrictEqual(page.data.selections, {})
  assert.strictEqual(page.data.model.connections.length, 0)
  const copiesBefore = runtime.clipboard.length
  const exportsBefore = runtime.reportExports.length
  page.copyConnection()
  page.generateResultReportImage()
  assert.strictEqual(runtime.clipboard.length, copiesBefore, 'unknown wiring choice must not copy a connection')
  assert.strictEqual(runtime.reportExports.length, exportsBefore, 'unknown wiring choice must not export a diagram')

  const legacyColdOpen = getWiringModel('xlrBalanced', 'tsMono', { outputMode: 'coldOpen' })
  assert.strictEqual(legacyColdOpen.status, 'needs-choice', 'legacy coldOpen must remain unresolved')
  assert.strictEqual(legacyColdOpen.supported, false)
  assert.strictEqual(legacyColdOpen.connections.length, 0)
  assert.deepStrictEqual(page.data.requirements[0].options.map((option) => option.id), ['coldReturn'],
    'the selector must no longer offer a cold-open option')
  chooseRequirement(page, 'outputMode', 'coldOpen')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice', 'a stale coldOpen event must not resolve the requirement')
  assert.strictEqual(page.data.supported, false)
  assert.deepStrictEqual(page.data.selections, {})
  assert.strictEqual(page.data.resultReportImagePath, '')
  const copiesAfterLegacyOption = runtime.clipboard.length
  const exportsAfterLegacyOption = runtime.reportExports.length
  page.copyConnection()
  page.generateResultReportImage()
  assert.strictEqual(runtime.clipboard.length, copiesAfterLegacyOption, 'legacy coldOpen cannot be copied')
  assert.strictEqual(runtime.reportExports.length, exportsAfterLegacyOption, 'legacy coldOpen cannot be exported')

  chooseRequirement(page, 'outputMode', 'coldReturn')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert.strictEqual(page.data.supported, true)
  assert.strictEqual(page.data.selections.outputMode, 'coldReturn')
  const { getReportHeight } = require('../pages/audio-wiring/wiring-renderer')
  assert.strictEqual(page.data.resultReportCanvasHeight, getReportHeight(720, page.data.model, {
    layout: 'solder-wiring',
    compact: true,
    viewMode: page.data.viewMode,
    face: page.data.face,
    selectedId: '',
    theme: page.data.theme,
    preferenceNotice: '',
  }), 'requirement selection sizes the report with the same current view options')
  assert.strictEqual(page.data.model.connections.length, 3, 'coldReturn must contain signal, cold-return, and shield lines')
  assert(page.data.selectionSummary.length > 0)
  assert(page.data.criticalNotes.length > 0)
  const coldReturnText = buildWiringText(page.data.model)
  const copiedWireLines = coldReturnText.split('\n').filter((line) => line.startsWith('- '))
  assert.strictEqual(copiedWireLines.length, 3, 'coldReturn copy must list all three wire connections')
  page.data.model.connections.forEach((connection) => {
    assert(coldReturnText.includes(`- ${connection.fromLabel} → ${connection.toLabel}：${connection.label}`))
  })
  page.copyConnection()
  assert.strictEqual(runtime.clipboard.at(-1), coldReturnText)

  const writesBeforeWithdrawal = runtime.storageWrites.length
  page.clearWiringRequirement({ currentTarget: { dataset: { requirementId: 'outputMode' } } })
  assert.strictEqual(page.data.wiringStatus, 'needs-choice', 'withdrawing manual confirmation restores needs-choice')
  assert.deepStrictEqual(page.data.selections, {})
  assert.strictEqual(page.data.supported, false)
  assert.strictEqual(page.data.resultReportImagePath, '')
  const copiesBeforeWithdrawal = runtime.clipboard.length
  const exportsBeforeWithdrawal = runtime.reportExports.length
  page.copyConnection()
  page.generateResultReportImage()
  assert.strictEqual(runtime.clipboard.length, copiesBeforeWithdrawal, 'withdrawn cold-return confirmation cannot be copied')
  assert.strictEqual(runtime.reportExports.length, exportsBeforeWithdrawal, 'withdrawn cold-return confirmation cannot be exported')
  assert.strictEqual(runtime.storageWrites.length, writesBeforeWithdrawal, 'manual wiring conditions are not persisted')
  chooseRequirement(page, 'outputMode', 'coldReturn')
  assert.strictEqual(page.data.wiringStatus, 'ready', 'explicit manual confirmation restores the original supported path')

  const reportTextStart = runtime.reportTexts.length
  const coldReturnExport = startReport(page, runtime)
  const coldReturnReportText = runtime.reportTexts.slice(reportTextStart).join('')
  assert(!coldReturnReportText.includes('接线对应') && !coldReturnReportText.includes('对应关系'),
    'compact share relies on the annotated wiring image instead of repeating every connection in text')
  assert(coldReturnReportText.includes('仅在两台设备手册允许时施工。'),
    'compact share retains the cold-return safety condition in concise form')
  assert(!coldReturnReportText.includes(page.data.selectionSummary[0]),
    'compact share does not repeat the selection summary above the diagram')
  assert(!coldReturnReportText.includes(page.data.criticalNotes[0]),
    'compact share summarizes critical notes without repeating the long copy')
  assert(coldReturnReportText.includes('冷端') && coldReturnReportText.includes('汇接'))
  coldReturnExport.success({ tempFilePath: '/tmp/cold-return.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/cold-return.png')
  page.closeResultReportPreview()

  const areas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { layout: 'solder-wiring', avoidRail: true, showTitle: false })
  const point = pointOnArea(areas[0])
  page.onDiagramTap({ detail: point })
  assert(page.data.selectedConnection)

  choose(page, 'input', 'rcaStereo')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert.strictEqual(page.data.resultReportImagePath, '', 'changing endpoint must clear the prior coldReturn image')
  chooseRequirement(page, 'outputMode', 'coldReturn')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert.deepStrictEqual(page.data.requirements.find((item) => item.id === 'destinationChannel')
    .options.map((option) => option.id), ['both'],
  'balanced output to stereo inputs only offers the fixed 1-to-2 confirmation')
  chooseRequirement(page, 'destinationChannel', 'left')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice', 'legacy one-sided choices cannot confirm a 1-to-2 route')
  chooseRequirement(page, 'destinationChannel', 'both')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  const leftAreas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { layout: 'solder-wiring', avoidRail: true, showTitle: false })
  const leftPoint = pointOnArea(leftAreas[0])
  page.onDiagramTap({ detail: leftPoint })
  assert(page.data.selectedId, 'a selected diagram line must set selectedId before changing the requirement')
  assert(page.data.selectedConnection, 'the selected diagram line must be non-empty before the change')
  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  assert.strictEqual(runtime.pendingScreenQueries.length, 1)
  const staleExport = startReport(page, runtime)
  page.clearWiringRequirement({ currentTarget: { dataset: { requirementId: 'outputMode' } } })
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert.strictEqual(page.data.selections.destinationChannel, 'both',
    'withdrawing the balanced cold-return confirmation preserves the independent load confirmation')
  assert.strictEqual(page.data.selectedId, '')
  assert.strictEqual(page.data.selectedConnection, null)
  assert.strictEqual(page.data.resultReportImagePath, '')
  const drawsAfterChoice = runtime.screenDraws
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsAfterChoice, 'choice changes must invalidate the previous screen canvas query')
  const mutationsBeforeStaleExport = page.mutationCount
  staleExport.success({ tempFilePath: '/tmp/stale-choice.png' })
  assert.strictEqual(page.data.resultReportImagePath, '')
  assert.strictEqual(page.mutationCount, mutationsBeforeStaleExport, 'choice change must invalidate a pending image callback')

  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  assert(!page.data.requirements.some((item) => item.id === 'sourceChannel'))
  assert.deepStrictEqual(page.data.selections, {}, 'fixed T selection is not a page-level confirmation')

  choose(page, 'output', 'rcaMono')
  choose(page, 'input', 'tsStereo')
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  assert(page.data.requirements.some((item) => item.id === 'destinationChannel'))
  chooseRequirement(page, 'destinationChannel', 'both')
  assert.strictEqual(page.data.wiringStatus, 'ready')
  choose(page, 'input', 'terminalBalanced')
  assert.deepStrictEqual(page.data.selections, {}, 'changing an endpoint must clear every prior wiring choice')

  const wxml = fs.readFileSync(require.resolve('../pages/audio-wiring/index.wxml'), 'utf8')
  assert(wxml.includes('bindtap="selectWiringRequirement"'))
  assert(wxml.includes('{{criticalNotes}}'))
  assert(wxml.includes('wiring-route-guide'))
  assert(wxml.includes("wiringStatus === 'needs-choice'"), 'needs-choice must have a separate state from unsupported')
}

function testScreenCanvasApiAndResize(page, runtime) {
  assert(runtime.screenDraws > 0, 'the 2D screen renderer should draw the initial diagram')
  assert((runtime.screenClips || []).some((call) => call[0] === 'clip'),
    'the 2D screen adapter clips source photographs to their cropped content rectangles')
  assert.strictEqual(runtime.reportContextIds.length, 0)
  assert.deepStrictEqual(runtime.transforms.at(-1), [2, 0, 0, 2, 0, 0])
  assert.strictEqual(runtime.screenCanvasNode.width, Math.round(page.data.diagramCanvasWidth * 2))
  assert.strictEqual(runtime.screenCanvasNode.height, Math.round(page.data.diagramCanvasHeight * 2))
  assert.strictEqual(runtime.scaleCalls, 0, 'DPR transform must not accumulate with scale()')
  assert(runtime.screenTexts.some((item) => /(?:500|600) /.test(item.font)), 'renderer font assignment must reach the native context')
  assert(!runtime.reportContextIds.includes('wiringDiagramCanvas'))

  const mutationsBeforeStableRedraw = page.mutationCount
  page.renderDiagram()
  assert.strictEqual(page.mutationCount, mutationsBeforeStableRedraw, 'a successful stable redraw must not write unchanged diagramError')

  runtime.measuredWidth = 287
  const mutationsBeforeResize = page.mutationCount
  page.onResize()
  assert.strictEqual(page.mutationCount, mutationsBeforeResize + 1, 'a size-changing resize should write the new measured canvas dimensions once')
  assert.strictEqual(page.data.diagramCanvasWidth, 287)
  assert.strictEqual(runtime.screenCanvasNode.width, 574)
  assert(runtime.transforms.every((value) => value[0] === 2 && value[3] === 2))
}

function testCanvasRemountAndModalRecovery(page, runtime) {
  const firstNodeId = runtime.screenCanvasNode.id
  choose(page, 'output', 'xlrBalanced')
  choose(page, 'input', 'tsMono')
  assert.strictEqual(page.data.supported, false)
  assert.strictEqual(page.data.wiringStatus, 'needs-choice')
  choose(page, 'input', 'terminalBalanced')
  assert.strictEqual(page.data.supported, true)
  assert(runtime.screenCanvasNode.id > firstNodeId,
    'ready canvas should be queried again after a confirmation-required state removes it')

  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  assert.strictEqual(runtime.pendingScreenQueries.length, 1)
  const queriesBeforeSheet = runtime.screenQueries
  const drawsBeforeSheet = runtime.screenDraws
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'output' } } })
  assert.strictEqual(page.data.selectorVisible, true)
  page.renderDiagram()
  assert.strictEqual(runtime.screenQueries, queriesBeforeSheet, 'render requests must not query while selector sheet is open')
  assert.strictEqual(runtime.screenDraws, drawsBeforeSheet, 'screen canvas must not draw while selector sheet is open')
  page.closeEndpointSelector()
  assert.strictEqual(page.data.selectorVisible, false)
  assert(runtime.screenQueries > queriesBeforeSheet, 'closing selector must requery and redraw the canvas')
  assert(runtime.screenDraws > drawsBeforeSheet)
  const drawsAfterClose = runtime.screenDraws
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsAfterClose, 'query started before opening selector must not draw after it closes')
  const wxml = fs.readFileSync(require.resolve('../pages/audio-wiring/index.wxml'), 'utf8')
  assert(wxml.includes('<canvas type="2d" id="wiringDiagramCanvas"'))
  assert(wxml.includes('hidden="{{selectorVisible || resultReportPreviewVisible || projectDialogVisible || diagramError}}"'))
  assert(wxml.includes('style="height:{{diagramCanvasHeight}}px;"'))
}

function testStaleQueriesAndVisibility() {
  const runtime = createRuntime()
  require('../pages/audio-wiring/index')
  const page = createPage(runtime)
  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  assert.strictEqual(runtime.pendingScreenQueries.length, 1)
  const drawsBeforeHide = runtime.screenDraws
  page.onHide()
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsBeforeHide, 'late query after hide must not draw')
  page.onShow()
  assert(runtime.screenDraws > drawsBeforeHide, 'onShow must requery and redraw')

  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  const drawsBeforeSwitch = runtime.screenDraws
  page.onResize()
  const drawsAfterLatest = runtime.screenDraws
  assert(drawsAfterLatest > drawsBeforeSwitch, 'latest resize query should draw')
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsAfterLatest, 'late query after a fast resize must be ignored')

  runtime.deferNextScreenQuery = true
  page.renderDiagram()
  const drawsBeforeUnload = runtime.screenDraws
  page.onUnload()
  const mutationsBeforeLate = page.mutationCount
  runtime.resolveNextScreenQuery()
  assert.strictEqual(runtime.screenDraws, drawsBeforeUnload)
  assert.strictEqual(page.mutationCount, mutationsBeforeLate, 'late query after unload must not write page state')
}

function testDrawingFailureRecovery(page, runtime) {
  runtime.throwNextScreenContext = true
  page.renderDiagram()
  assert.strictEqual(page.data.diagramError, '接线图暂时无法显示')
  const queriesBeforeRetry = runtime.screenQueries
  page.retryDiagram()
  assert.strictEqual(page.data.diagramError, '')
  assert(runtime.screenQueries > queriesBeforeRetry, 'retry must reacquire the 2D canvas node')
}

function testExportLifecycle(page, runtime) {
  const success = startReport(page, runtime)
  const pendingExportCount = runtime.reportExports.length
  page.generateResultReportImage()
  assert.strictEqual(runtime.reportExports.length, pendingExportCount)
  success.success({ tempFilePath: '/tmp/wiring-success.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/wiring-success.png')
  assert.strictEqual(page.data.resultReportPreviewVisible, true)
  const queriesDuringPreview = runtime.screenQueries
  const drawsDuringPreview = runtime.screenDraws
  page.renderDiagram()
  assert.strictEqual(runtime.screenQueries, queriesDuringPreview, 'render requests must not query while report preview is open')
  assert.strictEqual(runtime.screenDraws, drawsDuringPreview, 'screen canvas must stay hidden while report preview is open')
  const queriesWhilePreviewOpen = runtime.screenQueries
  page.closeResultReportPreview()
  assert(runtime.screenQueries > queriesWhilePreviewOpen, 'closing report preview must restore the 2D screen diagram')
  page.generateResultReportImage()
  assert.strictEqual(page.data.resultReportPreviewVisible, true)
  page.previewResultReportImage()
  page.saveResultReportImage()
  page.shareResultReportImage()
  assert.strictEqual(runtime.previews.at(-1).current, '/tmp/wiring-success.png')
  assert.strictEqual(runtime.saves.at(-1), '/tmp/wiring-success.png')
  assert.strictEqual(runtime.shares.at(-1).path, '/tmp/wiring-success.png')

  page.closeResultReportPreview()
  page.onHide()
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/wiring-success.png', 'successful image should survive hide')
  page.onShow()
  page.generateResultReportImage()
  assert.strictEqual(page.data.resultReportPreviewVisible, true, 'cached image should reopen after returning to the page')
  page.closeResultReportPreview()
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id: 'invalid-option-id' } } })
  assert.strictEqual(page.data.selectorVisible, false, 'invalid selector events should close the sheet')
  assert.strictEqual(page.data.resultReportImagePath, '', 'invalid selector events should invalidate a cached export')

  assert.strictEqual(page.data.resultReportImagePath, '')
  const failed = startReport(page, runtime)
  failed.fail({ errMsg: 'simulated export failure' })
  assert.strictEqual(page.data.isGeneratingResultReport, false)
  assert.strictEqual(page.data.resultReportImagePath, '')
  const retry = startReport(page, runtime)
  retry.success({ tempFilePath: '/tmp/wiring-retry.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/wiring-retry.png')

  page.closeResultReportPreview()
  choose(page, 'output', 'rcaMono')
  choose(page, 'input', 'tsMono')
  const oldTask = startReport(page, runtime)
  choose(page, 'output', 'xlrBalanced')
  choose(page, 'input', 'terminalBalanced')
  const currentTask = startReport(page, runtime)
  const beforeOldCallback = page.mutationCount
  oldTask.success({ tempFilePath: '/tmp/stale.png' })
  assert.strictEqual(page.mutationCount, beforeOldCallback)
  currentTask.success({ tempFilePath: '/tmp/current.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/current.png')

  page.closeResultReportPreview()
  choose(page, 'output', 'rcaMono')
  choose(page, 'input', 'tsMono')
  const hiddenTask = startReport(page, runtime)
  page.onHide()
  const beforeHiddenCallback = page.mutationCount
  hiddenTask.success({ tempFilePath: '/tmp/hidden-stale.png' })
  assert.strictEqual(page.mutationCount, beforeHiddenCallback)
  page.onShow()
  page.closeResultReportPreview()
  const unloadTask = startReport(page, runtime)
  page.onUnload()
  const beforeUnloadCallback = page.mutationCount
  unloadTask.success({ tempFilePath: '/tmp/unload-stale.png' })
  assert.strictEqual(page.mutationCount, beforeUnloadCallback)
  assert.strictEqual(runtime.removedThemeHandlers.length, 1)
  assert(runtime.reportContextIds.every((id) => id === 'resultReportCanvas'), 'export continues through shared legacy canvas')
}

function testReportUsesCurrentView() {
  const { getReportHeight, getWiringHitAreas } = require('../pages/audio-wiring/wiring-renderer')
  const runtime = createRuntime()
  const page = createPage(runtime)
  const areas = getWiringHitAreas(page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { layout: 'solder-wiring', avoidRail: true, selectedId: '', showTitle: false })
  assert(areas.length > 0)
  const point = pointOnArea(areas[0])
  page.onDiagramTap({ detail: point })
  assert.strictEqual(page.data.selectedId, areas[0].id)
  const expectedHeight = getReportHeight(720, page.data.model, {
    layout: 'solder-wiring', compact: true, viewMode: 'connectors', face: 'solder',
    selectedId: areas[0].id, theme: 'light',
    preferenceNotice: '默认示例，先核对实际两端接口。',
  })
  assert.strictEqual(page.data.resultReportCanvasHeight, expectedHeight,
    'report height uses the unified solder layout, highlight, and theme as the current diagram')
  runtime.reportTexts.length = 0
  runtime.reportLineWidths.length = 0
  const task = startReport(page, runtime)
  const exportedText = runtime.reportTexts.join('').replace(/\s/g, '')
  const normalizeReportText = (value) => String(value).replace(/\s/g, '')
  assert(exportedText.includes(normalizeReportText('接线参考 · 焊接端示意'))
    && exportedText.includes(normalizeReportText(`输出端：${page.data.model.output.label}`))
    && exportedText.includes(normalizeReportText(`输入端：${page.data.model.input.label}`)),
  'the compact report names both endpoints and the unified solder diagram')
  assert(!exportedText.includes('适用说明') && !exportedText.includes('参考与适用边界'),
    'the compact report omits the long notes and sources sections')
  page.data.model.criticalNotes.forEach((note) => assert(exportedText.includes(note),
    `the compact report retains critical note: ${note}`))
  assert(runtime.reportLineWidths.some((width) => width > 2.2), 'report diagram carries the selected connection highlight')
  assert(!runtime.reportTexts.some((value) => value.includes('接线对应') || value.includes('对应关系')),
    'compact report does not repeat the diagram connection list')
  assert(runtime.reportPhotoDraws > 0, 'compact report draws the loaded rear-contact photos')
  task.success({ tempFilePath: '/tmp/current-solder-view.png' })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/current-solder-view.png')
}

function testResponsiveSharePreviewLayout() {
  const root = { rect: { top: 0, left: 0, width: 320, height: 640, right: 320, bottom: 640 } }
  const previewMeasurements = {
    '.page-root': root,
    '.result-report-preview-overlay': {
      rect: { top: 0, left: 0, width: 320, height: 640, right: 320, bottom: 640 },
      computedStyle: { paddingTop: '14px', paddingBottom: '20px' },
    },
    '.result-report-preview-sheet': {
      rect: { top: 80, left: 0, width: 320, height: 540, right: 320, bottom: 620 },
      computedStyle: { paddingTop: '9px', paddingBottom: '8px', borderTopWidth: '1px', borderBottomWidth: '1px' },
    },
    '.result-report-preview-header': { rect: { top: 90, left: 10, width: 300, height: 164 } },
    '.result-report-preview-actions': { rect: { top: 500, left: 10, width: 300, height: 96 } },
    '.result-report-preview-scroll': {
      rect: { top: 254, left: 10, width: 300, height: 246 },
      computedStyle: { borderTopWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderRightWidth: '1px' },
    },
    '.result-report-preview-image': { rect: { top: 255, left: 11, width: 298, height: 398 } },
  }
  const runtime = createRuntime({ previewMeasurements })
  const page = createPage(runtime)
  runtime.deferNextPreviewQuery = true
  const task = startReport(page, runtime)
  task.success({ tempFilePath: '/tmp/large-font-preview.png' })
  assert.strictEqual(page.data.resultReportPreviewVisible, true)
  assert.strictEqual(runtime.pendingPreviewQueries.length, 1)
  page.onHide()
  assert.strictEqual(page.data.resultReportPreviewStyle, '', 'hiding the page invalidates pending preview measurements')
  runtime.deferNextPreviewQuery = false
  page.onShow()
  const computedStyle = page.data.resultReportPreviewStyle
  assert(computedStyle.includes('--cable-report-sheet-max-height:606px'), computedStyle)
  const scrollMatch = computedStyle.match(/--cable-report-scroll-height:([\d.]+)px/)
  assert(scrollMatch, 'preview scroll height is derived from measured header and action heights')
  const scrollHeight = Number(scrollMatch[1])
  const fixedHeight = 9 + 8 + 2 + 164 + 96
  assert(scrollHeight + fixedHeight <= 606.01,
    'the measured large-font close header and two action buttons fit inside the sheet')
  const actionBottom = root.rect.bottom - 20 - 8
  assert(actionBottom <= root.rect.bottom && actionBottom >= 96,
    'the complete 96px action row remains above the 640px viewport bottom')
  runtime.resolveNextPreviewQuery()
  assert.strictEqual(page.data.resultReportPreviewStyle, computedStyle,
    'a stale pre-hide measurement cannot replace the reopened preview layout')
  page.closeResultReportPreview()
  assert.strictEqual(page.data.resultReportPreviewStyle, '')
  page.onUnload()
}

function testModalAndLateInteractionCallbacks() {
  const runtime = createRuntime()
  require('../pages/audio-wiring/index')
  const page = createPage(runtime)

  const pendingReport = startReport(page, runtime)
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  assert.strictEqual(page.data.selectorVisible, true)
  assert.strictEqual(page.data.isGeneratingResultReport, false, 'opening selector cancels an in-flight report')
  const mutationsBeforeLateReport = page.mutationCount
  pendingReport.success({ tempFilePath: '/tmp/late-selector-report.png' })
  assert.strictEqual(page.mutationCount, mutationsBeforeLateReport, 'late report callback must not mutate an open selector')
  assert.strictEqual(page.data.resultReportPreviewVisible, false)
  assert.strictEqual(page.data.selectorVisible, true)

  page.closeEndpointSelector()
  const areas = require('../pages/audio-wiring/wiring-renderer').getWiringHitAreas(
    page.data.model, page.data.diagramCanvasWidth, page.data.diagramCanvasHeight,
    { layout: 'solder-wiring', avoidRail: true, showTitle: false },
  )
  const point = pointOnArea(areas[0])
  page.onDiagramTouchStart({ touches: [{ x: point.x, y: point.y }] })
  page.onHide()
  const mutationsBeforeHiddenTouch = page.mutationCount
  page.onDiagramTouchEnd({ changedTouches: [{ x: point.x, y: point.y }] })
  assert.strictEqual(page.mutationCount, mutationsBeforeHiddenTouch, 'late touch end after hide must not mutate page state')

  page.onShow()
  page.onDiagramTouchStart({ touches: [{ x: point.x, y: point.y }] })
  page.onHide()
  page.onShow()
  const mutationsBeforeReshownTouch = page.mutationCount
  page.onDiagramTouchEnd({ changedTouches: [{ x: point.x, y: point.y }] })
  assert.strictEqual(page.mutationCount, mutationsBeforeReshownTouch, 'touch start before hide must be cleared so late touch end after show cannot select a wire')

  const completedReport = startReport(page, runtime)
  completedReport.success({ tempFilePath: '/tmp/cached-selector-report.png' })
  page.closeResultReportPreview()
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/cached-selector-report.png', 'opening selector must preserve completed report cache')
  page.closeEndpointSelector()
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/cached-selector-report.png', 'cancelling selector must preserve completed report cache')
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id: page.data.inputId } } })
  assert.strictEqual(page.data.resultReportImagePath, '',
    'confirming the default endpoint updates report notice and invalidates the old image')
  const partialSelectionReport = startReport(page, runtime)
  partialSelectionReport.success({ tempFilePath: '/tmp/partial-selection.png' })
  page.closeResultReportPreview()
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  page.selectEndpointOption({ currentTarget: { dataset: { id: page.data.inputId } } })
  assert.strictEqual(page.data.resultReportImagePath, '/tmp/partial-selection.png',
    'reconfirming an already checked endpoint leaves the report cache intact')

  page.onShow()
  runtime.deferClipboardCallback = true
  const toastCount = runtime.toasts.length
  page.copyConnection()
  const clipboard = runtime.pendingClipboardCallbacks.pop()
  page.onUnload()
  clipboard.success()
  assert.strictEqual(runtime.toasts.length, toastCount, 'clipboard callback after unload must not show a toast')
}

async function testScreenPhotoCacheRetriesAfterSynchronousSrcFailure() {
  const { getModelPhotoSpecs, getLoadedScreenPhotos, loadScreenSolderPhotos } = require('../pages/audio-wiring/wiring-photos')
  const model = require('../pages/audio-wiring/wiring-model').getWiringModel('xlrBalanced', 'terminalBalanced')
  const specs = getModelPhotoSpecs(model)
  let failOnce = true
  let attempts = 0
  const canvas = {
    createImage() {
      const image = { onload: null, onerror: null }
      Object.defineProperty(image, 'src', {
        set() {
          attempts += 1
          if (failOnce) {
            failOnce = false
            throw new Error('sync src failure')
          }
          this.onload()
        },
      })
      return image
    },
  }
  await assert.rejects(loadScreenSolderPhotos(canvas, model), /sync src failure/)
  assert.strictEqual(getLoadedScreenPhotos(canvas, model), null,
    'a synchronous src setter error cannot leave a rejected promise in the cache')
  const photos = await loadScreenSolderPhotos(canvas, model)
  assert.deepStrictEqual(Object.keys(photos).sort(), specs.map((spec) => spec.key).sort(),
    'retry loads every required endpoint image after the synchronous source error')
  assert.deepStrictEqual(Object.keys(getLoadedScreenPhotos(canvas, model)).sort(), specs.map((spec) => spec.key).sort())
  const completedAttempts = attempts
  await loadScreenSolderPhotos(canvas, model)
  assert.strictEqual(attempts, completedAttempts, 'loaded image objects are reused after a successful retry')
}

async function testReportPhotoPathsAreNormalizedAndValidated() {
  const { loadReportSolderPhotos } = require('../pages/audio-wiring/wiring-photos')
  const { getWiringModel } = require('../pages/audio-wiring/wiring-model')
  createRuntime()
  const model = getWiringModel('xlrBalanced', 'terminalBalanced')
  const relativePaths = [
    'pages/audio-wiring/assets/solder/xlr-female-rear.png',
    './pages/audio-wiring/assets/terminal.png',
  ]
  let pathIndex = 0
  global.wx.getImageInfo = (options) => options.success({
    path: relativePaths[pathIndex++], width: 384, height: 384,
  })
  const photos = await loadReportSolderPhotos(model)
  assert.deepStrictEqual(Object.values(photos), [
    '/pages/audio-wiring/assets/solder/xlr-female-rear.png',
    '/pages/audio-wiring/assets/terminal.png',
  ], 'only known package-relative image paths gain the required leading slash')

  const externalPaths = ['wxfile://tmp/audio-wiring.png', 'https://tmp/audio-wiring.png']
  pathIndex = 0
  global.wx.getImageInfo = (options) => options.success({
    tempFilePath: externalPaths[pathIndex++], width: 384, height: 384,
  })
  const externalModel = getWiringModel('stereo35', 'rcaStereo')
  const externalPhotos = await loadReportSolderPhotos(externalModel)
  assert.deepStrictEqual(Object.values(externalPhotos), externalPaths,
    'temporary URI paths are preserved without adding a slash or changing their protocol')

  global.wx.getImageInfo = (options) => options.success({ path: '', tempFilePath: '', width: 384, height: 384 })
  await assert.rejects(loadReportSolderPhotos(model), /incomplete/,
    'a missing resolved path fails instead of silently drawing the package path')
  global.wx.getImageInfo = (options) => options.success({ path: '/pages/audio-wiring/assets/terminal.png', width: 0, height: 384 })
  await assert.rejects(loadReportSolderPhotos(model), /incomplete/,
    'zero image dimensions fail instead of exporting an unresolved endpoint image')
}

function testReportPhotoFailureCanRetry() {
  const runtime = createRuntime()
  runtime.failNextImageInfo = true
  const page = createPage(runtime)
  page.generateResultReportImage()
  assert.strictEqual(page.data.isGeneratingResultReport, false, 'report photo failure clears the pending export state')
  assert.strictEqual(runtime.reportContextIds.length, 0, 'report rendering waits for image info success')
  assert(runtime.toasts.some((item) => item.title === '接头照片读取失败，请重试'))
  const retry = startReport(page, runtime)
  assert(runtime.reportPhotoDraws > 0, 'a report retries successfully after image-info failure')
  retry.success({ tempFilePath: '/tmp/photo-retry.png' })
}

async function testLatePhotoLoadsCannotDrawAnOldWiringChoice() {
  const runtime = createRuntime({ deferScreenImageLoad: true })
  const page = createPage(runtime)
  assert.strictEqual(runtime.screenDraws, 0, 'screen waits until every required photo has loaded')
  choose(page, 'output', 'stereo35')
  choose(page, 'input', 'tsStereo')
  chooseRequirement(page, 'destinationChannel', 'both')
  const pendingPaths = runtime.pendingScreenImages.map((image) => image._src).sort()
  assert(pendingPaths.some((path) => path.endsWith('/stereo35-rear.png')))
  assert(pendingPaths.some((path) => /\/xlr-(?:male|female)-rear\.png$/.test(path)))
  runtime.resolvePendingScreenImages()
  await new Promise((resolve) => setImmediate(resolve))
  assert(runtime.screenDraws > 0, 'the current photo combination draws after its images resolve')
  assert(runtime.screenImages.every((args) => !/\/xlr-(?:male|female)-rear\.png$/.test(String(args[0]._src))),
    'late image callbacks for the old XLR choice cannot draw over the current stereo output')
  assert(runtime.screenImages.some((args) => String(args[0]._src).endsWith('/stereo35-rear.png')))
}

function testLateReportImageInfoCannotRenderBehindSelector() {
  const runtime = createRuntime({ deferImageInfo: true })
  const page = createPage(runtime)
  page.generateResultReportImage()
  assert(runtime.pendingImageInfoCallbacks.length > 0, 'report waits for local image path resolution')
  page.openEndpointSelector({ currentTarget: { dataset: { side: 'input' } } })
  runtime.resolvePendingImageInfo()
  assert.strictEqual(runtime.reportContextIds.length, 0,
    'image-info callbacks arriving behind the selector cannot start a report draw')
  assert.strictEqual(runtime.reportExports.length, 0)
  page.onUnload()
}

async function run() {
  await testScreenPhotoCacheRetriesAfterSynchronousSrcFailure()
  await testReportPhotoPathsAreNormalizedAndValidated()
  require('../pages/audio-wiring/index')
  testWiringPreferencesAndFirstUse()
  testWiringMainScreenStructure()
  testWiringRecordActionsAndRestore()
  testWiringFavoriteLegacyFallback()
  testFixedStereoRecordIdentityAndLegacyLookup()
  testWiringProjectDialogGuardsAndLifecycle()
  testWiringResetInvalidatesPendingWork()
  testWiringResetStorageWarnings()
  testSelectorCloseGeometryAndHelpRemoval()
  const runtime = createRuntime()
  const page = createPage(runtime)
  testScreenCanvasApiAndResize(page, runtime)
  testSupportedOptionsAndCopy(page, runtime)
  testWiringRequirements(page, runtime)
  testCanvasRemountAndModalRecovery(page, runtime)
  testDrawingFailureRecovery(page, runtime)
  testExportLifecycle(page, runtime)
  testReportUsesCurrentView()
  testResponsiveSharePreviewLayout()
  testModalAndLateInteractionCallbacks()
  testStaleQueriesAndVisibility()
  await testLatePhotoLoadsCannotDrawAnOldWiringChoice()
  testLateReportImageInfoCannotRenderBehindSelector()
  testReportPhotoFailureCanRetry()
  console.log('audio wiring page tests passed (strict 2D canvas/selector query/export mocks; WeChat native layers and album permissions not exercised)')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

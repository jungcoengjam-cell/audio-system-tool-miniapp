'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { createDelayedEnvironment } = require('../p2-safety-remediation/minimal/delayed-environment.cjs')

const root = path.resolve(__dirname, '../..')
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const preferenceKey = 'audioTool.ledScreen.preferences'
const recordsKey = 'audioTool.records.v1'
const projectsKey = 'audioTool.projects.v1'
const activeProjectKey = 'audioTool.activeProject.v1'
const storageModules = [
  '../../utils/records', '../../utils/preferences', '../../utils/result-record-actions',
  '../../utils/operation-inputs', '../../pages/led-screen/led-screen',
  '../../pages/led-screen/led-project', '../../pages/led-screen/report',
]
const core = require('../../utils/led-screen')
const ledPagePath = path.join(root, 'pages/led-screen/led-screen.js')

function loadLedPageSource(env) {
  let definition
  const previousPage = global.Page
  const sourcePath = process.env.LED_PROJECT_PAGE_SOURCE
    ? path.resolve(root, process.env.LED_PROJECT_PAGE_SOURCE)
    : ledPagePath
  global.Page = (value) => { definition = value }
  try {
    const pageModule = new Module(ledPagePath, module)
    pageModule.filename = ledPagePath
    pageModule.paths = Module._nodeModulePaths(path.dirname(ledPagePath))
    pageModule.require = Module.createRequire(ledPagePath)
    pageModule._compile(fs.readFileSync(sourcePath, 'utf8'), ledPagePath)
  } finally {
    global.Page = previousPage
  }
  assert(definition?.data, `LED Page definition did not register from ${sourcePath}`)
  const page = { ...definition, data: clone(definition.data) }
  page.setData = (patch, callback) => {
    for (const [key, value] of Object.entries(patch)) {
      const segments = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (const segment of segments.slice(0, -1)) target = target[segment]
      target[segments.at(-1)] = clone(value)
    }
    if (callback) env.pending.nextTicks.push(callback)
  }
  return page
}

function clearStorageModules() {
  for (const id of storageModules) {
    try { delete require.cache[require.resolve(id)] } catch (_) {}
  }
}

function fixture(preferences) {
  clearStorageModules()
  const env = createDelayedEnvironment()
  env.wx.setStorageSync(recordsKey, [])
  env.wx.setStorageSync(projectsKey, [])
  env.wx.setStorageSync('audioTool.favorites.v1', [])
  env.wx.setStorageSync('audioTool.recovery.v1', [])
  env.wx.setStorageSync(activeProjectKey, '')
  env.wx.setStorageSync('audioTool.storageSchemaVersion', 4)
  if (preferences) env.wx.setStorageSync(preferenceKey, preferences)
  const page = loadLedPageSource(env)
  page.onLoad()
  env.flushNextTicks()
  page.onShow()
  env.flushNextTicks()
  return { env, page, records: require('../../utils/records') }
}

function setInputs(page, values) {
  for (const [field, value] of Object.entries(values)) {
    page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value: String(value) } })
  }
  page.onFieldBlur()
}

function setSelections(page, ratioIndex, unitIndex, pitchIndex) {
  page.onAspectRatioChange({ detail: { value: ratioIndex } })
  page.onUnitChange({ detail: { value: unitIndex } })
  page.onPitchChange({ detail: { value: pitchIndex } })
}

function coreInput(page) {
  return {
    wallWidthMeters: page.data.wallWidthText,
    wallHeightMeters: page.data.wallHeightText,
    topReserveMeters: page.data.topReserveText,
    bottomReserveMeters: page.data.bottomReserveText,
    frameWidthMeters: Number(page.data.frameWidthText) / 100,
    viewingDistanceMeters: page.data.viewingDistanceText,
    aspectRatioKey: page.data.aspectRatioOptions[page.data.aspectRatioIndex]?.key,
    unitKey: page.data.unitOptions[page.data.unitIndex]?.key,
    pixelPitch: page.data.pitchOptions[page.data.pitchIndex]?.value,
  }
}

function assertEngineeringResult(page, label) {
  const expected = core.calculateLedScreenPlan(coreInput(page))
  assert.equal(expected.error || '', '', `${label}: test setup must be a valid core calculation`)
  const actual = page.data.result
  assert(actual, `${label}: production controller should expose a result`)
  const engineeringKeys = [
    'screenWidthMeters', 'screenHeightMeters', 'installedWidthMeters', 'installedHeightMeters',
    'columns', 'rows', 'totalUnits', 'targetAspectRatio', 'targetAspectRatioKey', 'actualRatio',
    'horizontalMarginMeters', 'actualTopMarginMeters', 'actualBottomMarginMeters',
    'frameWidthMeters', 'pixelPitch', 'pitchMode', 'resolutionWidth', 'resolutionHeight',
    'statusKey', 'comfortableMinimumMeters', 'comfortableMaximumMeters',
  ]
  for (const key of engineeringKeys) {
    if (Object.prototype.hasOwnProperty.call(expected, key)) {
      assert.equal(actual[key], expected[key], `${label}: controller/core mismatch at ${key}`)
    }
  }
}

function assertBlankDefaults() {
  const { env, page } = fixture()
  const numeric = [
    'wallWidthText', 'wallHeightText', 'topReserveText', 'bottomReserveText',
    'frameWidthText', 'viewingDistanceText',
  ]
  assert.deepEqual(numeric.map((field) => page.data[field]), ['6', '3', '0.2', '0.2', '5', '3'],
    'first use should retain the existing example input')
  assert.equal(page.data.aspectRatioOptions[page.data.aspectRatioIndex]?.key, '16:9')
  assert.equal(page.data.unitOptions[page.data.unitIndex]?.key, 'module')
  assert.equal(page.data.pitchOptions[page.data.pitchIndex]?.value, 'recommended')
  assert(page.data.result, 'first use should retain the existing example result')

  page.resetInputs()
  const saved = page.data
  for (const field of numeric) assert.equal(saved[field], '', `reset ${field} must remain blank`)
  const persistedPreferences = env.storage.get(preferenceKey)
  assert.deepEqual(numeric.map((field) => persistedPreferences[field]), ['', '', '', '', '', ''],
    'reset must persist the cleared numeric inputs')
  const reopened = fixture(persistedPreferences)
  for (const field of numeric) assert.equal(reopened.page.data[field], '', `reopened ${field} must preserve blank`)
  assert.equal(reopened.page.data.aspectRatioOptions[reopened.page.data.aspectRatioIndex]?.key, '16:9')
  assert.equal(reopened.page.data.unitOptions[reopened.page.data.unitIndex]?.key, 'module')
  assert.equal(reopened.page.data.pitchOptions[reopened.page.data.pitchIndex]?.value, 'recommended')
  return 1
}

function assertSampleAndModeMatrix() {
  const { page } = fixture()
  setInputs(page, {
    wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2',
    frameWidthText: '5', viewingDistanceText: '2',
  })
  setSelections(page, 0, 0, 0)
  assertEngineeringResult(page, 'sample')
  assert.equal(page.data.result.dimensionText, '4.48 × 2.4 m')
  assert.equal(page.data.result.columns, 14)
  assert.equal(page.data.result.rows, 15)
  assert.equal(page.data.result.totalUnits, 210)
  assert.equal(page.data.result.actualTopMarginMeters, 0.25)
  assert.equal(page.data.result.actualBottomMarginMeters, 0.25)
  assert.equal(page.data.result.pixelPitch, 1.25)
  assert.equal(page.data.result.statusKey, 'near')
  assert.match(page.data.result.viewingAssessmentText, /低于.*舒适距离/)

  const ratios = page.data.aspectRatioOptions
  const units = page.data.unitOptions
  const pitches = page.data.pitchOptions
  assert.equal(ratios.length, 5)
  assert.equal(units.length, 3)
  assert.equal(pitches.length, 5)
  let cases = 0
  for (let ratioIndex = 0; ratioIndex < ratios.length; ratioIndex += 1) {
    for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
      for (let pitchIndex = 0; pitchIndex < pitches.length; pitchIndex += 1) {
        setInputs(page, {
          wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2',
          frameWidthText: '5', viewingDistanceText: '4',
        })
        setSelections(page, ratioIndex, unitIndex, pitchIndex)
        assertEngineeringResult(page, `${ratios[ratioIndex].key}/${units[unitIndex].key}/${pitches[pitchIndex].value}`)
        cases += 1
      }
    }
  }
  assert.equal(cases, 75)

  setInputs(page, {
    wallWidthText: '6', wallHeightText: '3', topReserveText: '0.1', bottomReserveText: '0.8',
    frameWidthText: '5', viewingDistanceText: '4',
  })
  setSelections(page, 0, 0, 0)
  assertEngineeringResult(page, 'asymmetric-reserves')
  assert.equal(page.data.result.actualBottomMarginMeters - page.data.result.actualTopMarginMeters, 0.7)
  assert.notEqual(page.data.result.actualTopMarginMeters, page.data.result.actualBottomMarginMeters)

  setInputs(page, {
    wallWidthText: '6', wallHeightText: '3', topReserveText: '0', bottomReserveText: '0',
    frameWidthText: '0', viewingDistanceText: '4',
  })
  setSelections(page, 0, 0, 0)
  assertEngineeringResult(page, 'zero-reserves-and-frame')
  assert.equal(page.data.result.frameWidthMeters, 0)
  return cases + 2
}

function assertInvalidInputs() {
  const invalidCases = [
    ['wallWidthText', '.'],
    ['wallWidthText', '0'],
    ['viewingDistanceText', '0'],
    ['wallWidthText', '0.1'],
  ]
  for (const [field, value] of invalidCases) {
    const { page } = fixture()
    setInputs(page, {
      wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2',
      frameWidthText: '5', viewingDistanceText: '4',
    })
    page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } })
    assert.equal(page.data.result, null, `${field}=${value} must immediately invalidate prior output`)
    page.onFieldBlur()
    assert.equal(page.data.result, null, `${field}=${value} must not retain a stale result after calculation`)
    assert(page.data.inputError, `${field}=${value} must show an input error`)
  }
  const { page } = fixture()
  setInputs(page, {
    wallWidthText: '6', wallHeightText: '3', topReserveText: '.', bottomReserveText: '0.2',
    frameWidthText: '5', viewingDistanceText: '4',
  })
  assert.equal(page.data.result, null, 'a partial decimal reserve must be rejected')
  page.onFieldBlur()
  assert.equal(page.data.result, null)
  return invalidCases.length + 1
}

function projectFlow(page, target, name, note) {
  assert(page.openProjectSheet())
  assert(page.selectProjectTarget({ currentTarget: { dataset: { id: target.id } } }))
  page.onProjectConfigNameInput({ detail: { value: name } })
  page.onProjectConfigNoteInput({ detail: { value: note } })
}

function seedProjects(env, records) {
  const first = records.createProject('LED QA North Hall')
  const second = records.createProject('LED QA South Hall')
  assert(first && second, 'test projects must be available')
  return { first, second }
}

function assertRecordMetadataAndValidation() {
  const { env, page, records } = fixture()
  setInputs(page, {
    wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2',
    frameWidthText: '5', viewingDistanceText: '2',
  })
  setSelections(page, 0, 0, 0)
  const { first, second } = seedProjects(env, records)
  page.toggleCurrentFavorite()
  const favoriteBefore = records.getFavorites()[0]
  assert(favoriteBefore?.favorite)
  const favoriteSnapshotBefore = JSON.parse(JSON.stringify(favoriteBefore))

  projectFlow(page, first, 'N'.repeat(61), 'N'.repeat(201))
  assert.equal(page.saveProjectTarget(), false, 'oversized project name and note must be rejected')
  assert(page.data.projectNameError)
  assert(page.data.projectNoteError)
  assert.equal(records.getProjectRecords(first.id).length, 0, 'invalid metadata must not write a record')

  page.onProjectConfigNameInput({ detail: { value: 'N'.repeat(60) } })
  page.onProjectConfigNoteInput({ detail: { value: 'T'.repeat(200) } })
  assert(page.saveProjectTarget(), '60-character name and 200-character note should be accepted')
  assert.equal(records.getProjectRecords(first.id).length, 0, 'async save must wait for its guarded callback')
  env.flushNextTicks()
  const firstStored = records.getProjectRecords(first.id)[0]
  assert(firstStored, 'accepted metadata should persist')
  const firstView = records.getProjectRecordView(firstStored, first.id)
  assert.equal(firstView.title, 'N'.repeat(60))
  assert.equal(firstView.projectNote, 'T'.repeat(200))
  assert.equal(firstView.hasProjectMetadata, true)
  assert.notEqual(firstStored.id, favoriteBefore.id, 'project records and favorites have independent identities')
  assert.equal(firstStored.favorite, false, 'project record must not become a favorite')
  assert.deepEqual(records.getFavorites().find((item) => item.id === favoriteBefore.id), favoriteSnapshotBefore,
    'saving project metadata must leave the favorite snapshot unchanged')

  projectFlow(page, second, 'South Hall final', '独立项目备注')
  assert(page.saveProjectTarget())
  env.flushNextTicks()
  const latest = records.getProjectRecords(first.id).find((item) => item.id === firstStored.id)
  assert(latest, 'the same engineering result should remain one record')
  assert.equal(records.getProjectRecords(first.id).length, 1, 'resaving one project must not duplicate its result')
  assert.equal(records.getProjectRecords(second.id).length, 1, 'second project should point to one shared result')
  assert.equal(records.getProjectRecords(second.id)[0].id, firstStored.id,
    'the same result keeps one project record identity across projects')
  assert.deepEqual(latest.projectIds.slice().sort(), [first.id, second.id].sort())
  assert.equal(records.getProjectRecordView(latest, first.id).title, 'N'.repeat(60))
  assert.equal(records.getProjectRecordView(latest, first.id).projectNote, 'T'.repeat(200))
  assert.equal(records.getProjectRecordView(latest, second.id).title, 'South Hall final')
  assert.equal(records.getProjectRecordView(latest, second.id).projectNote, '独立项目备注')
  assert.deepEqual(records.getFavorites().find((item) => item.id === favoriteBefore.id), favoriteSnapshotBefore,
    'project writes leave the independent favorite snapshot unchanged')

  const legacy = records.addRecordToProject({
    ...page.getRecordPayload(),
    preferences: { ...page.getRecordPayload().preferences, wallWidthText: '7.2' },
  }, first.id)
  assert(legacy, 'legacy metadata-free record can be added for compatibility')
  const legacyView = records.getProjectRecordView(legacy, first.id)
  assert.equal(legacyView.hasProjectMetadata, undefined)
  assert.equal(legacyView.title, legacy.title)
  assert.equal(legacyView.projectNote, undefined)
  assert.equal(records.restoreRecord(legacy), '/pages/led-screen/led-screen')
  assert.equal(env.storage.get(preferenceKey).wallWidthText, '6',
    'resolving a restore route must not overwrite the current temporary inputs')
  return 7
}

function assertCancelAndStorageFailure() {
  {
    const { env, page, records } = fixture()
    setInputs(page, { wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2', frameWidthText: '5', viewingDistanceText: '2' })
    const { first } = seedProjects(env, records)
    const before = records.getRecords().length
    projectFlow(page, first, 'Canceled configuration', '')
    page.closeProjectDialog(true)
    env.flushNextTicks()
    assert.equal(records.getRecords().length, before, 'canceling project confirmation must not write a record')
  }
  {
    const { env, page, records } = fixture()
    setInputs(page, { wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2', frameWidthText: '5', viewingDistanceText: '2' })
    const { first } = seedProjects(env, records)
    projectFlow(page, first, 'Storage failure', '')
    const originalSet = env.wx.setStorageSync
    env.wx.setStorageSync = (key, value) => {
      if (key === recordsKey) throw new Error('QA simulated records write failure')
      originalSet(key, value)
    }
    assert(page.saveProjectTarget())
    env.flushNextTicks()
    assert.equal(records.getProjectRecords(first.id).length, 0, 'storage failure must not create a partial record')
    assert(page.data.projectError, 'storage failure should remain visible to the user')
  }
  return 2
}

function assertDelayedTargetRace() {
  let cases = 0
  for (const mutation of ['rename', 'delete', 'change-input', 'hide']) {
    const { env, page, records } = fixture()
    setInputs(page, { wallWidthText: '6', wallHeightText: '3', topReserveText: '0.2', bottomReserveText: '0.2', frameWidthText: '5', viewingDistanceText: '2' })
    const { first } = seedProjects(env, records)
    projectFlow(page, first, `Race ${mutation}`, 'late response guard')
    assert(page.saveProjectTarget(), `${mutation}: save should queue confirmation callback`)
    const queuedWritesBefore = records.getRecords().length
    if (mutation === 'rename') {
      env.storage.set(projectsKey, env.storage.get(projectsKey).map((project) => (
        project.id === first.id ? { ...project, name: `${project.name} renamed` } : project
      )))
    } else if (mutation === 'delete') {
      env.storage.set(projectsKey, env.storage.get(projectsKey).filter((project) => project.id !== first.id))
    } else if (mutation === 'change-input') {
      page.onFieldInput({ currentTarget: { dataset: { field: 'wallWidthText' } }, detail: { value: '7' } })
    } else {
      page.onHide()
    }
    env.flushNextTicks()
    const after = records.getRecords()
    assert.equal(after.length, queuedWritesBefore, `${mutation}: stale async confirmation must not write a record`)
    assert(!after.some((record) => record.projectIds?.includes(first.id)), `${mutation}: stale target association must not persist`)
    cases += 1
  }
  return cases
}

function generateReportImage(env, page, filePath) {
  assert.equal(page.openSharePreview(), true, 'current LED result should start report generation')
  env.flushNextTicks()
  assert.equal(env.pending.draws.length, 1, 'report drawing should wait for the deferred page update')
  env.finishDraw(0)
  env.flushNextTicks()
  assert.equal(env.pending.canvases.length, 1, 'report export should follow completed drawing')
  env.finishCanvas(0, filePath)
  env.flushNextTicks()
  assert.equal(page.data.reportImagePath, filePath)
  assert.equal(page.data.reportPreviewVisible, true)
}

function assertNativeReportPreviewGuards() {
  const { env, page } = fixture()
  const previews = []
  env.wx.previewImage = (options) => previews.push(options)
  const imagePath = 'wxfile://led-native-preview.png'
  generateReportImage(env, page, imagePath)

  assert.equal(page.previewReportImage(), true, 'the current report should open through native preview')
  assert.deepEqual(previews, [{ current: imagePath, urls: [imagePath] }],
    'native LED preview should pass the complete cached path as current and its only URL')

  const previewCountBeforeMissingPath = previews.length
  page.setData({ reportImagePath: '' })
  assert.equal(page.previewReportImage(), false, 'a report without a local path cannot open native preview')
  assert.equal(previews.length, previewCountBeforeMissingPath)
  page.setData({ reportImagePath: imagePath })

  env.wx.getFileSystemManager = () => ({ accessSync() { throw new Error('missing LED image') } })
  assert.equal(page.previewReportImage(), true, 'a missing cached image should trigger guarded regeneration')
  assert.equal(previews.length, previewCountBeforeMissingPath, 'a missing local image must not reach wx.previewImage')
  assert.equal(page.data.reportImagePath, '')
  assert.equal(page.data.isGeneratingReport, true)
  env.wx.getFileSystemManager = () => ({ accessSync() {} })
  env.flushNextTicks()
  env.finishDraw(0)
  env.flushNextTicks()
  env.finishCanvas(0, 'wxfile://led-native-preview-regenerated.png')
  env.flushNextTicks()

  page.onHide()
  const previewCountBeforeHiddenTap = previews.length
  assert.equal(page.previewReportImage(), false, 'a hidden LED page cannot open native preview')
  assert.equal(previews.length, previewCountBeforeHiddenTap)
  page.onShow()
  env.flushNextTicks()

  page.onFieldInput({ currentTarget: { dataset: { field: 'wallWidthText' } }, detail: { value: '7' } })
  assert.equal(page.data.reportImagePath, '', 'input changes must invalidate the cached LED report')
  assert.equal(page.data.reportPreviewVisible, false)
  const previewCountBeforeStaleTap = previews.length
  assert.equal(page.previewReportImage(), false, 'an input-invalidated LED report cannot open native preview')
  assert.equal(previews.length, previewCountBeforeStaleTap)
  page.onHide()
  return 8
}

function assertReportPreviewCloseTimerLifecycle() {
  const { env, page } = fixture()
  generateReportImage(env, page, 'wxfile://led-close-timer.png')

  const timers = []
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cancelled: false }
    timers.push(timer)
    return timer
  }
  global.clearTimeout = (timer) => {
    if (timer) timer.cancelled = true
  }

  try {
    assert.equal(page.closeReportPreview(), true)
    env.flushNextTicks()
    const firstClose = timers[0]
    assert(firstClose, 'closing the LED sheet should schedule its delayed hide')
    assert.equal(firstClose.delay, 300, 'the close animation should retain its 300 ms lifecycle')
    assert.equal(page.data.reportPreviewVisible, true)
    assert.equal(page.data.reportPreviewClosing, true)
    assert.equal(page.closeReportPreview(), false, 'a repeated close must not start a second timer')
    env.flushNextTicks()
    assert.equal(timers.length, 1)

    assert.equal(page.openSharePreview(), true, 'quick reopen should reuse the current cached report')
    assert.equal(firstClose.cancelled, true, 'reopening should cancel the previous close timer')
    assert.equal(page.data.reportPreviewVisible, true)
    assert.equal(page.data.reportPreviewClosing, false)

    assert.equal(page.closeReportPreview(), true)
    env.flushNextTicks()
    const secondClose = timers[1]
    assert(secondClose)
    firstClose.callback()
    assert.equal(page._ledReportPreviewCloseTimer, secondClose,
      'a stale callback must not clear the newer close timer reference')
    assert.equal(page.data.reportPreviewVisible, true)
    assert.equal(page.data.reportPreviewClosing, true)
    secondClose.callback()
    assert.equal(page._ledReportPreviewCloseTimer, null)
    assert.equal(page.data.reportPreviewVisible, false)
    assert.equal(page.data.reportPreviewClosing, false)

    assert.equal(page.openSharePreview(), true)
    assert.equal(page.closeReportPreview(), true)
    env.flushNextTicks()
    const hideClose = timers[2]
    page.onHide()
    assert.equal(hideClose.cancelled, true, 'hide should cancel the pending close timer')
    hideClose.callback()
    assert.equal(page.data.reportPreviewVisible, false, 'a close callback cannot reopen a hidden sheet')

    page.onShow()
    env.flushNextTicks()
    assert.equal(page.openSharePreview(), true)
    assert.equal(page.closeReportPreview(), true)
    env.flushNextTicks()
    const inputClose = timers[3]
    page.onFieldInput({ currentTarget: { dataset: { field: 'wallWidthText' } }, detail: { value: '7' } })
    assert.equal(inputClose.cancelled, true, 'input invalidation should cancel the pending close timer')
    assert.equal(page.data.reportImagePath, '')
    assert.equal(page.data.reportPreviewVisible, false)
    inputClose.callback()
    assert.equal(page.data.reportPreviewVisible, false, 'a stale close callback cannot revive an invalidated report')
    page.onHide()
    assert(timers.some((timer) => timer.delay === 160 && timer.cancelled),
      'hiding after input invalidation should clear the scheduled input calculation')

    page.onShow()
    env.flushNextTicks()
    generateReportImage(env, page, 'wxfile://led-close-unload.png')
    const timersBeforeUnloadClose = timers.length
    assert.equal(page.closeReportPreview(), true)
    env.flushNextTicks()
    const unloadClose = timers[timers.length - 1]
    assert.equal(timers.length, timersBeforeUnloadClose + 1)
    assert.equal(unloadClose.delay, 300)
    page.onUnload()
    assert.equal(unloadClose.cancelled, true, 'unload should cancel the pending close timer')
    unloadClose.callback()
    assert.equal(page.data.reportPreviewVisible, false)
    assert.equal(page._ledReportPreviewCloseTimer, null)
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
  return 15
}

function main() {
  const counts = {
    defaultsAndBlankReopen: assertBlankDefaults(),
    matrixAndGeometry: assertSampleAndModeMatrix(),
    invalidInputs: assertInvalidInputs(),
    recordsAndMetadata: assertRecordMetadataAndValidation(),
    cancellationAndWriteFailure: assertCancelAndStorageFailure(),
    delayedProjectTargetRaces: assertDelayedTargetRace(),
    nativeReportPreviewGuards: assertNativeReportPreviewGuards(),
    reportPreviewCloseTimerLifecycle: assertReportPreviewCloseTimerLifecycle(),
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  process.stdout.write(`LED controller regression passed: ${total} assertions/cases\n`)
  process.stdout.write(`${JSON.stringify(counts, null, 2)}\n`)
}

main()

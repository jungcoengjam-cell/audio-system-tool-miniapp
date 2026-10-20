'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { catalog, CATEGORIES } = require('../../pages/control-protocol/catalog')
const viewerState = require('../../pages/control-protocol/viewer-state')

const root = path.resolve(__dirname, '../..')
const detailPath = path.join(root, 'pages/control-protocol/detail.js')
const indexPath = path.join(root, 'pages/control-protocol/index.js')
const STORAGE_KEY = viewerState.STORAGE_KEY

function capturePage(absolutePath) {
  const previousPage = global.Page
  let definition
  global.Page = (value) => { definition = value }
  try {
    delete require.cache[absolutePath]
    require(absolutePath)
    assert(definition, `${path.basename(absolutePath)} registers a Page`)
    return definition
  } finally {
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
}

function makeHarness(options = {}) {
  const effects = {
    clipboard: [],
    previews: [],
    fileCopies: [],
    loading: [],
    hiddenLoading: 0,
    toasts: [],
    routes: [],
    networkCalls: 0,
    storage: options.storage || {},
    storageWrites: 0,
  }
  const api = {
    getSystemInfoSync: () => ({ windowWidth: 320, windowHeight: 640, reducedMotion: options.reducedMotion === true }),
    getStorageSync(key) {
      if (options.storageReadThrows) throw new Error('storage read disabled')
      return effects.storage[key]
    },
    setStorageSync(key, value) {
      effects.storageWrites += 1
      if (options.storageWriteThrows) throw new Error('storage write disabled')
      effects.storage[key] = value
    },
    setClipboardData(config) {
      effects.clipboard.push(config)
      if (options.clipboardBehavior === 'sync-success' && config.success) config.success()
      else if (options.clipboardBehavior === 'sync-fail' && config.fail) config.fail()
    },
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager() {
      return {
        copyFile(config) {
          effects.fileCopies.push(config)
          const behavior = typeof options.copyFileBehavior === 'function'
            ? options.copyFileBehavior(config, effects.fileCopies.length)
            : options.copyFileBehavior || 'sync-success'
          if (behavior === 'sync-success') config.success()
          else if (behavior === 'sync-fail') config.fail(new Error('simulated copy failure'))
        },
      }
    },
    previewImage(config) {
      effects.previews.push(config)
      if (options.previewImageFail && config.fail) config.fail(new Error('simulated preview failure'))
    },
    showLoading(config) { effects.loading.push(config.title) },
    hideLoading() { effects.hiddenLoading += 1 },
    showToast(config) { effects.toasts.push(config.title) },
    redirectTo(config) { effects.routes.push(config) },
    navigateBack: (config) => { effects.routes.push(config) },
    request: () => { effects.networkCalls += 1 },
    connectSocket: () => { effects.networkCalls += 1 },
    sendSocketMessage: () => { effects.networkCalls += 1 },
  }
  return { api, effects }
}

function makePageState(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch, callback) {
      this.data = { ...this.data, ...patch }
      if (callback) callback()
    },
  }
}

function withWx(api, callback) {
  const previous = global.wx
  global.wx = api
  const restore = () => {
    if (previous === undefined) delete global.wx
    else global.wx = previous
  }
  let result
  try {
    result = callback()
  } catch (error) {
    restore()
    throw error
  }
  if (result && typeof result.then === 'function') return Promise.resolve(result).finally(restore)
  restore()
  return result
}

function sanitizeAndStorageChecks() {
  const deviceRef = { type: 'reference', id: 'reference-kylin-k100r-01', ignored: 'extra' }
  const malicious = {
    deviceRef: { ...deviceRef, mac: 'A1B2C3D4E5F6' },
    deviceMac: 'A1B2C3D4E5F6',
    devices: [
      {
        deviceRef,
        lastMode: 'unsupported',
        mac: 'A1B2C3D4E5F6',
        transports: {
          udp: { scrollTop: 999999, loopIndex: 999, showManualWrites: true, deviceMacInput: 'A1B2C3D4E5F6' },
          rs485: { scrollTop: -20, loopIndex: -5, showManualWrites: 'true' },
          tcp: { scrollTop: 11, loopIndex: 1, showManualWrites: true },
        },
      },
      { deviceRef: { type: 'reference', id: 'missing' }, lastMode: 'udp', transports: {} },
      { deviceRef: { ...deviceRef }, lastMode: 'udp', transports: {} },
    ],
  }
  const clean = viewerState.sanitizeViewerState(malicious, catalog)
  assert.deepEqual(clean.deviceRef, { type: 'reference', id: deviceRef.id })
  assert.equal(clean.devices.length, 1, 'unknown and duplicate references are discarded')
  assert.equal(clean.devices[0].lastMode, '', 'unsupported remembered mode is rejected')
  assert.deepEqual(Object.keys(clean.devices[0].transports).sort(), ['rs485', 'udp'], 'only supported modes survive')
  assert.equal(clean.devices[0].transports.udp.scrollTop, 200000, 'scroll is bounded')
  assert.equal(clean.devices[0].transports.udp.loopIndex, 7, 'loop index is clamped to K100R loop count')
  assert.equal(clean.devices[0].transports.udp.showManualWrites, true)
  assert.equal(clean.devices[0].transports.rs485.scrollTop, 0)
  assert.equal(clean.devices[0].transports.rs485.loopIndex, 0)
  assert.equal(clean.devices[0].transports.rs485.showManualWrites, false)
  assert.equal(JSON.stringify(clean).includes('A1B2C3D4E5F6'), false, 'MAC data and unknown fields are stripped')
  assert.equal(viewerState.getLastMode({ devices: [] }, deviceRef, catalog), '', 'no remembered mode is distinct from a valid one')
  assert.equal(viewerState.normalizeDeviceRef({ type: 'reference', id: 'missing' }, catalog), null)

  const failedStorage = makeHarness({ storageReadThrows: true, storageWriteThrows: true })
  withWx(failedStorage.api, () => {
    assert.deepEqual(viewerState.readViewerState(catalog), { deviceRef: null, devices: [] })
    assert.deepEqual(viewerState.saveViewerState(clean, catalog), { ok: false, changed: false })
  })
}

function initialModeAndRestoreChecks() {
  const firstHarness = makeHarness({ reducedMotion: true })
  withWx(firstHarness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, {})
    assert.equal(state.data.reference.id, 'reference-smartplc-f300-01', 'without memory the first usable real manual reference is selected')
    assert.equal(state.data.manual.transports.length, 2)
    assert.equal(state.data.manualTransport.id, 'rtu', 'first visit defaults to the sorted RS485/RTU tab, not source order TCP')
    assert.equal(state.data.deviceTitle, 'SmartPLC-F300', 'header uses the single controller model label')
    assert.equal(state.data.deviceSubtitle, undefined, 'removed subtitle is not retained as unused header state')
    assert.equal(state.data.scopeSummary, '仅限 itC KZX 现场样本', 'F300 keeps only its short sample boundary')
    assert.equal(state.data.deviceMacInput, '', 'MAC remains an ephemeral empty field')
    page.onUnload.call(state)
  })

  const persisted = {
    deviceRef: { type: 'reference', id: 'reference-kylin-k100r-01' },
    devices: [{
      deviceRef: { type: 'reference', id: 'reference-kylin-k100r-01' },
      lastMode: 'udp',
      transports: { udp: { scrollTop: 321, loopIndex: 7, showManualWrites: true } },
    }],
  }
  const restoreHarness = makeHarness({ reducedMotion: true, storage: { [STORAGE_KEY]: persisted } })
  withWx(restoreHarness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, {})
    assert.equal(state.data.currentDeviceRef.id, 'reference-kylin-k100r-01')
    assert.equal(state.data.scopeSummary, '仅限照片中 K100R 控制卡', 'K100R keeps only its visible-card boundary')
    assert.equal(state.data.manualTransport.id, 'udp', 'a valid remembered mode is restored')
    assert.equal(state.data.selectedLoopIndex, 7)
    assert.equal(state.data.readerScrollTop, 321)
    assert.equal(state.data.showManualWrites, true)
    assert.equal(state.data.deviceMacInput, '', 'remembered reader state never restores an address')
    page.onUnload.call(state)
  })

  const invalidModeHarness = makeHarness({
    reducedMotion: true,
    storage: {
      [STORAGE_KEY]: {
        deviceRef: { type: 'reference', id: 'reference-kylin-k100r-01' },
        devices: [{
          deviceRef: { type: 'reference', id: 'reference-kylin-k100r-01' },
          lastMode: 'tcp',
          transports: {},
        }],
      },
    },
  })
  withWx(invalidModeHarness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, {})
    assert.equal(state.data.manualTransport.id, 'rs485', 'invalid persisted modes fall back to the sorted first supported mode')
    page.onUnload.call(state)
  })
}

function directoryAndPhotoChecks() {
  const harness = makeHarness({ reducedMotion: true })
  return withWx(harness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    assert.equal(typeof page.openInfoSheet, 'undefined', 'the reader no longer exposes the removed information sheet')
    page.openDeviceSelector.call(state)
    assert.equal(state.data.activeOverlay, 'device')
    assert.equal(state.data.sheetOpen, true)
    assert.equal(state.data.directoryItems.length, 2, 'directory reuses the two real independent references')
    assert.equal(state.data.categories.length, 7, 'all seven existing directory categories remain available')
    assert.equal(state.data.directoryListHeight, 276, 'two results use their content height on a 320px viewport')

    page.onSearchInput.call(state, { detail: { value: 'K100R' } })
    assert.deepEqual(state.data.directoryItems.map((item) => item.id), ['reference-kylin-k100r-01'])
    assert.equal(state.data.selectedDeviceHidden, true, 'filtering out the current reference is explicit')
    const stillSelected = state.data.currentDeviceRef.id
    const photoPath = state.data.directoryItems[0].photoPath
    page.previewDirectoryPhoto.call(state, { currentTarget: { dataset: { path: photoPath } } })
    assert.equal(harness.effects.fileCopies.at(-1).srcPath, photoPath.replace(/^\/+/, ''),
      'package image paths are copied from the original app asset')
    assert.equal(harness.effects.previews.at(-1).current, harness.effects.fileCopies.at(-1).destPath,
      'native preview receives a readable USER_DATA_PATH copy, not a package URI')
    assert(harness.effects.previews.at(-1).current.startsWith('/user-data/'))
    assert.notEqual(harness.effects.previews.at(-1).current, photoPath)
    assert.equal(harness.effects.loading.length, 1, 'copying an original shows a brief loading indicator')
    assert.equal(harness.effects.hiddenLoading, 1, 'loading ends before native preview opens')
    assert.equal(state.data.activeOverlay, 'device', 'photo preview does not select or close the directory')
    assert.equal(state.data.currentDeviceRef.id, stillSelected)

    const itemKey = state.data.directoryItems[0].key
    page.onDirectoryPhotoError.call(state, { currentTarget: { dataset: { key: itemKey } } })
    assert.equal(state.data.directoryItems[0].imageFailed, true, 'directory image failure has an explicit recovery state')
    page.retryDirectoryPhoto.call(state, { currentTarget: { dataset: { key: itemKey } } })
    assert.equal(state.data.directoryItems[0].imageFailed, false, 'directory image can be retried')

    page.onCategoryTap.call(state, { currentTarget: { dataset: { key: 'audio' } } })
    assert.equal(state.data.directoryIsEmpty, true, 'an unmatched category shows a real empty result')
    assert.equal(state.data.selectedDeviceHidden, true)
    page.clearFilters.call(state)
    assert.equal(state.data.directoryItems.length, 2, 'clear filters restores the directory')
    page.selectDevice.call(state, { currentTarget: { dataset: { type: 'reference', id: 'reference-kylin-k100r-01' } } })
    assert.equal(state.data.currentDeviceRef.id, 'reference-kylin-k100r-01')
    assert.equal(state.data.manualTransport.id, 'rs485')
    assert.equal(state.data.deviceMacInput, '', 'switching devices clears the transient MAC')
    assert.equal(state.data.activeOverlay, '', 'selecting a device closes the sheet after state changes')

    page.onPhotoError.call(state, { currentTarget: { dataset: { path: state.data.mainPhoto.path } } })
    assert.equal(state.data.mainPhoto.imageFailed, true)
    page.retryPhoto.call(state, { currentTarget: { dataset: { path: state.data.mainPhoto.path } } })
    assert.equal(state.data.mainPhoto.imageFailed, false, 'main photo has a retry path')
    page.previewPhoto.call(state, { currentTarget: { dataset: { path: state.data.mainPhoto.path } } })
    assert.equal(harness.effects.previews.at(-1).current, harness.effects.fileCopies.at(-1).destPath,
      'main photo preview uses its full-resolution local copy')
    assert.deepEqual(harness.effects.previews.at(-1).urls, [harness.effects.fileCopies.at(-1).destPath])
    const firstPhoto = state.data.photos[0]
    const secondPath = firstPhoto.path.replace(/\.jpg$/i, '-alternate.jpg')
    state.data.photos = [firstPhoto, { ...firstPhoto, id: `${firstPhoto.id}-alternate`, path: secondPath }]
    page.previewPhoto.call(state, { currentTarget: { dataset: { path: secondPath } } })
    const multiPhotoPreview = harness.effects.previews.at(-1)
    assert.equal(multiPhotoPreview.current, multiPhotoPreview.urls[1], 'the selected full-resolution image remains current')
    assert.equal(multiPhotoPreview.urls.length, 2, 'all images in the main-photo viewer are mapped for native swiping')
    assert(multiPhotoPreview.urls.every((localPath) => localPath.startsWith('/user-data/')))
    assert.equal(harness.effects.networkCalls, 0)
    page.onUnload.call(state)
  })
}

function photoCacheAsyncChecks() {
  const retryHarness = makeHarness({
    copyFileBehavior: (_config, index) => index === 1 ? 'sync-fail' : 'sync-success',
  })
  withWx(retryHarness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    const source = state.data.mainPhoto.path
    const tap = { currentTarget: { dataset: { path: source } } }
    page.previewPhoto.call(state, tap)
    assert.deepEqual(retryHarness.effects.previews, [], 'a failed package copy never falls back to the unreadable package path')
    assert.deepEqual(retryHarness.effects.toasts, ['照片暂不可查看，请重试'], 'copy failure is recoverable')
    assert.equal(retryHarness.effects.hiddenLoading, 1)
    page.previewPhoto.call(state, tap)
    assert.equal(retryHarness.effects.fileCopies.length, 2, 'failed copy can be retried')
    assert.equal(retryHarness.effects.previews.length, 1)
    assert.equal(retryHarness.effects.previews[0].current, retryHarness.effects.fileCopies[1].destPath)
    page.onUnload.call(state)
  })

  const staleHarness = makeHarness({ copyFileBehavior: 'deferred' })
  withWx(staleHarness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    const oldSource = state.data.mainPhoto.path
    page.previewPhoto.call(state, { currentTarget: { dataset: { path: oldSource } } })
    const oldCopy = staleHarness.effects.fileCopies[0]
    page.selectDevice.call(state, {
      currentTarget: { dataset: { type: 'reference', id: 'reference-kylin-k100r-01' } },
    })
    const newSource = state.data.mainPhoto.path
    page.previewPhoto.call(state, { currentTarget: { dataset: { path: newSource } } })
    const newCopy = staleHarness.effects.fileCopies[1]
    newCopy.success()
    oldCopy.success()
    assert.equal(staleHarness.effects.previews.length, 1, 'late prior-device copy does not open or replace the current preview')
    assert.equal(staleHarness.effects.previews[0].current, newCopy.destPath)
    assert.deepEqual(staleHarness.effects.toasts, [], 'stale copy success has no feedback')
    page.onUnload.call(state)
  })

  const unloadHarness = makeHarness({ copyFileBehavior: 'deferred' })
  withWx(unloadHarness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    page.previewPhoto.call(state, { currentTarget: { dataset: { path: state.data.mainPhoto.path } } })
    page.onUnload.call(state)
    unloadHarness.effects.fileCopies[0].success()
    assert.deepEqual(unloadHarness.effects.previews, [], 'unload cancels a pending native preview')
    assert.deepEqual(unloadHarness.effects.toasts, [], 'unload suppresses stale copy feedback')
    assert.equal(unloadHarness.effects.hiddenLoading, 1, 'unload dismisses its loading indicator')
  })

  const duplicateHarness = makeHarness({ copyFileBehavior: 'deferred' })
  withWx(duplicateHarness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    const tap = { currentTarget: { dataset: { path: state.data.mainPhoto.path } } }
    page.previewPhoto.call(state, tap)
    page.previewPhoto.call(state, tap)
    assert.equal(duplicateHarness.effects.fileCopies.length, 1, 'rapid repeated taps share one asset copy')
    duplicateHarness.effects.fileCopies[0].success()
    assert.equal(duplicateHarness.effects.previews.length, 1, 'only the latest repeated tap opens the original')
    page.onUnload.call(state)
  })

  const boundedCacheHarness = makeHarness()
  withWx(boundedCacheHarness.api, () => {
    const page = capturePage(detailPath)
    const firstState = makePageState(page)
    page.onLoad.call(firstState, { referenceId: 'reference-smartplc-f300-01' })
    const source = firstState.data.mainPhoto.path
    page.previewPhoto.call(firstState, { currentTarget: { dataset: { path: source } } })
    const firstDestination = boundedCacheHarness.effects.fileCopies[0].destPath
    assert.equal(firstDestination, `/user-data/tunebuddy-protocol-photo-${source.split('/').pop()}`,
      'cache path is stable and uniquely tied to the original photo basename')
    page.onUnload.call(firstState)

    const nextState = makePageState(page)
    page.onLoad.call(nextState, { referenceId: 'reference-smartplc-f300-01' })
    page.previewPhoto.call(nextState, { currentTarget: { dataset: { path: source } } })
    const destinations = boundedCacheHarness.effects.fileCopies.map((copy) => copy.destPath)
    assert.equal(destinations[1], firstDestination, 'a new page instance replaces the same bounded cache file')
    assert.equal(new Set(destinations).size, 1, 'reopening a reader does not accumulate another cache path')
    page.onUnload.call(nextState)
  })

  const viewerFailHarness = makeHarness({ previewImageFail: true })
  withWx(viewerFailHarness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    const tap = { currentTarget: { dataset: { path: state.data.mainPhoto.path } } }
    page.previewPhoto.call(state, tap)
    assert.deepEqual(viewerFailHarness.effects.toasts, ['照片暂不可查看，请重试'], 'native viewer failure gets brief retry feedback')
    viewerFailHarness.api.previewImage = (config) => viewerFailHarness.effects.previews.push(config)
    page.previewPhoto.call(state, tap)
    assert.equal(viewerFailHarness.effects.fileCopies.length, 1, 'retry reuses the successful local photo copy')
    assert.equal(viewerFailHarness.effects.previews.length, 2)
    assert.equal(viewerFailHarness.effects.previews[1].current, viewerFailHarness.effects.fileCopies[0].destPath)
    page.onUnload.call(state)
  })
}

async function overlayLifecycleChecks() {
  const harness = makeHarness({ reducedMotion: false })
  return withWx(harness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    page.openDeviceSelector.call(state)
    assert.equal(state.data.sheetOpen, false, 'animated sheet begins offscreen')
    return new Promise((resolve) => setTimeout(resolve, 24)).then(() => {
      assert.equal(state.data.sheetOpen, true, 'sheet enters after the transition frame')
      page.closeOverlay.call(state)
      assert.equal(state.data.activeOverlay, 'device', 'closing keeps content and mask mounted through exit animation')
      assert.equal(state.data.sheetOpen, false)
      page.openDeviceSelector.call(state)
      assert.equal(state.data.activeOverlay, 'device', 'reopening the device directory replaces the pending close timer')
      return new Promise((resolve) => setTimeout(resolve, 24))
    }).then(() => {
      assert.equal(state.data.sheetOpen, true)
      page.closeOverlay.call(state)
      const target = {}
      page.onSheetTransitionEnd.call(state, { target, currentTarget: target })
      assert.equal(state.data.activeOverlay, '', 'transition end removes the overlay immediately')
      page.onUnload.call(state)
    })
  })
}

async function clipboardChecks() {
  const harness = makeHarness()
  await withWx(harness.api, async () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-kylin-k100r-01' })
    page.selectManualTransport.call(state, { currentTarget: { dataset: { index: '1' } } })
    page.onDeviceMacInput.call(state, { detail: { value: 'A1B2C3D4E5F6' } })
    const event = { currentTarget: { dataset: { commandId: 'udp-relay-01-close' } } }
    page.copyManualCommand.call(state, event)
    page.copyManualCommand.call(state, event)
    assert.equal(harness.effects.clipboard.length, 1, 'duplicate taps during one clipboard request are ignored')
    assert.deepEqual(harness.effects.clipboard[0].data.split(' '), ['43', '53', '52', '59', 'A1', 'B2', 'C3', 'D4', 'E5', 'F6', '31'])
    assert.deepEqual(harness.effects.toasts, [], 'copy feedback waits for the clipboard callback')
    harness.effects.clipboard[0].success()
    assert.deepEqual(harness.effects.toasts, ['已复制到剪贴板'], 'success appears only from the success callback')
    page.onHide.call(state)
    const saved = JSON.stringify(harness.effects.storage[STORAGE_KEY])
    assert(!saved.includes('deviceMac') && !saved.includes('A1B2C3D4E5F6'), 'reader persistence excludes the live MAC input')
    page.onUnload.call(state)
  })

  const failHarness = makeHarness()
  await withWx(failHarness.api, async () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    const event = { currentTarget: { dataset: { commandId: state.data.commonManualCommands[0].id } } }
    page.copyManualCommand.call(state, event)
    failHarness.effects.clipboard[0].fail()
    assert.deepEqual(failHarness.effects.toasts, ['复制失败，请重试'], 'failure callback gives a brief recoverable message')
    page.copyManualCommand.call(state, event)
    assert.equal(failHarness.effects.clipboard.length, 2, 'failed copy can be retried')
    failHarness.effects.clipboard[1].success()
    assert.deepEqual(failHarness.effects.toasts, ['复制失败，请重试', '已复制到剪贴板'],
      'a successful retry replaces feedback from the preceding failure')
    page.onUnload.call(state)
  })

  const modeHarness = makeHarness({ reducedMotion: true })
  await withWx(modeHarness.api, async () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-kylin-k100r-01' })
    page.copyManualCommand.call(state, {
      currentTarget: { dataset: { commandId: 'rs485-all-close' } },
    })
    const staleModeRequest = modeHarness.effects.clipboard[0]
    page.selectManualTransport.call(state, { currentTarget: { dataset: { index: '1' } } })
    page.onDeviceMacInput.call(state, { detail: { value: '001122334455' } })
    page.copyManualCommand.call(state, {
      currentTarget: { dataset: { commandId: 'udp-relay-01-close' } },
    })
    assert.equal(modeHarness.effects.clipboard.length, 2, 'changing transport releases the old in-flight copy lock')
    staleModeRequest.success()
    assert.deepEqual(modeHarness.effects.toasts, [], 'a late callback from a previous transport has no feedback')
    modeHarness.effects.clipboard[1].success()
    assert.deepEqual(modeHarness.effects.toasts, ['已复制到剪贴板'], 'the current transport callback remains active')
    page.onUnload.call(state)
  })

  const staleHarness = makeHarness()
  await withWx(staleHarness.api, async () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    page.copyManualCommand.call(state, {
      currentTarget: { dataset: { commandId: state.data.commonManualCommands[0].id } },
    })
    const staleDeviceRequest = staleHarness.effects.clipboard[0]
    page.selectDevice.call(state, {
      currentTarget: { dataset: { type: 'reference', id: 'reference-kylin-k100r-01' } },
    })
    page.copyManualCommand.call(state, {
      currentTarget: { dataset: { commandId: state.data.commonManualCommands[0].id } },
    })
    assert.equal(staleHarness.effects.clipboard.length, 2, 'changing device releases the previous copy lock')
    staleDeviceRequest.success()
    assert.deepEqual(staleHarness.effects.toasts, [], 'a late callback from the previous device does not show stale feedback')
    staleHarness.effects.clipboard[1].success()
    assert.deepEqual(staleHarness.effects.toasts, ['已复制到剪贴板'], 'the new device copy remains active')
    const pendingOnUnload = state.data.commonManualCommands[0]
    page.copyManualCommand.call(state, { currentTarget: { dataset: { commandId: pendingOnUnload.id } } })
    page.onUnload.call(state)
    staleHarness.effects.clipboard[2].success()
    assert.deepEqual(staleHarness.effects.toasts, ['已复制到剪贴板'], 'unload invalidates callbacks still pending')
  })
}

function loopAndRouteChecks() {
  const harness = makeHarness({ reducedMotion: true })
  withWx(harness.api, () => {
    const page = capturePage(detailPath)
    const state = makePageState(page)
    page.onLoad.call(state, { referenceId: 'reference-smartplc-f300-01' })
    page.onReaderScroll.call(state, { detail: { scrollTop: 300 } })
    assert.equal(state.data.readerScrollTop, 300, 'controlled reader position tracks native scroll events')
    page.selectManualLoop.call(state, { detail: { value: '39' } })
    page.toggleManualWrites.call(state)
    page.selectManualTransport.call(state, { currentTarget: { dataset: { index: '0' } } })
    assert.equal(state.data.manualTransport.id, 'tcp')
    assert.equal(state.data.selectedLoopIndex, 39, 'switching transports preserves the selected loop number')
    assert.deepEqual(state.data.selectedLoopCommands.map((command) => command.label), ['第40路启动', '第40路关闭'])
    assert.equal(state.data.readerScrollTop, 0, 'an unread transport starts at its own saved/default position')
    assert.equal(state.data.showManualWrites, false, 'expanded request state is restored per transport')
    page.onReaderScroll.call(state, { detail: { scrollTop: 480 } })
    page.selectManualTransport.call(state, { currentTarget: { dataset: { index: '1' } } })
    assert.equal(state.data.manualTransport.id, 'rtu')
    assert.equal(state.data.selectedLoopIndex, 39)
    assert.equal(state.data.readerScrollTop, 300, 'switching back restores that transport reading position')
    assert.equal(state.data.showManualWrites, true, 'switching back restores that transport expansion state')
    page.onUnload.call(state)
  })

  const index = capturePage(indexPath)
  withWx(harness.api, () => {
    index.onLoad.call({ data: {} }, { referenceId: 'reference-kylin-k100r-01' })
    assert.equal(harness.effects.routes.at(-1).url,
      '/pages/control-protocol/detail?referenceId=reference-kylin-k100r-01', 'explicit legacy reference route is preserved')
    index.onLoad.call({ data: {} }, { appearanceGroupId: 'draft-smartplc-f300-sample' })
    assert.equal(harness.effects.routes.at(-1).url,
      '/pages/control-protocol/detail?appearanceGroupId=draft-smartplc-f300-sample', 'explicit legacy appearance route is preserved')
  })
}

async function main() {
  sanitizeAndStorageChecks()
  initialModeAndRestoreChecks()
  directoryAndPhotoChecks()
  photoCacheAsyncChecks()
  await overlayLifecycleChecks()
  await clipboardChecks()
  loopAndRouteChecks()
  process.stdout.write('Control protocol viewer behavior checks passed.\n')
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})

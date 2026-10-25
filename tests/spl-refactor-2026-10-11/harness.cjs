'use strict'

const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const pagePath = path.join(root, 'pages/spl/spl.js')

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

class FakeClock {
  constructor() {
    this.now = 0
    this.nextId = 1
    this.jobs = new Map()
  }

  setTimeout(callback, delay = 0) {
    const id = this.nextId++
    this.jobs.set(id, { id, at: this.now + Math.max(0, Number(delay) || 0), callback })
    return id
  }

  clearTimeout(id) {
    this.jobs.delete(id)
  }

  tick(milliseconds) {
    const end = this.now + milliseconds
    while (true) {
      const next = [...this.jobs.values()]
        .filter((job) => job.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!next) break
      this.jobs.delete(next.id)
      this.now = next.at
      next.callback()
    }
    this.now = end
  }

  flush() {
    while (this.jobs.size) {
      const nextAt = Math.min(...[...this.jobs.values()].map((job) => job.at))
      this.tick(nextAt - this.now)
    }
  }

  get pendingCount() {
    return this.jobs.size
  }
}

function makeCanvasContext(enqueueDraw) {
  const context = Object.create(null)
  return new Proxy(context, {
    get(target, property) {
      if (property === 'measureText') return () => ({ width: 0 })
      if (property === 'createLinearGradient' || property === 'createCircularGradient') {
        return () => ({ addColorStop() {} })
      }
      if (property === 'draw') return (_reserve, callback) => (enqueueDraw ? enqueueDraw(callback) : callback?.())
      if (!(property in target)) target[property] = () => context
      return target[property]
    },
  })
}

function installPlatform(options = {}) {
  const storage = new Map(Object.entries(options.initialStorage || {}))
  const failedReads = new Set()
  const failedWrites = new Set()
  const writeLog = []
  const vibrationLog = []
  const canvasExports = []
  const drawCallbacks = []
  const navigation = []
  const toastLog = []
  const modalLog = []
  const fileAccessLog = []
  const accessibleFiles = new Set(options.accessibleFiles || [])
  const clock = options.clock || new FakeClock()
  let currentPages = []
  const previous = {
    wx: global.wx,
    getCurrentPages: global.getCurrentPages,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    DateNow: Date.now,
    setCurrentPages: global.__setCurrentPages,
  }
  global.setTimeout = clock.setTimeout.bind(clock)
  global.clearTimeout = clock.clearTimeout.bind(clock)
  Date.now = () => clock.now

  const wx = {
    getStorageSync(key) {
      if (failedReads.has(key)) throw new Error(`simulated storage read failure: ${key}`)
      return clone(storage.get(key))
    },
    setStorageSync(key, value) {
      writeLog.push({ key, value: clone(value) })
      if (failedWrites.has(key)) throw new Error(`simulated storage write failure: ${key}`)
      storage.set(key, clone(value))
    },
    removeStorageSync(key) {
      if (failedWrites.has(key)) throw new Error(`simulated storage removal failure: ${key}`)
      storage.delete(key)
    },
    getStorageInfoSync() { return { currentSize: 1, limitSize: 100 } },
    getWindowInfo() {
      return {
        windowWidth: options.windowWidth || 390,
        windowHeight: options.windowHeight || 671,
      }
    },
    getSystemInfoSync() {
      return {
        windowWidth: options.windowWidth || 390,
        windowHeight: options.windowHeight || 671,
      }
    },
    showToast(value) { toastLog.push(clone(value)) },
    showLoading() {},
    hideLoading() {},
    hideKeyboard() {},
    vibrateShort(value) { vibrationLog.push(clone(value)) },
    vibrateLong() {},
    navigateTo(value) { navigation.push(clone(value)) },
    setClipboardData(value) { wx.clipboardData = clone(value) },
    createCanvasContext() { return makeCanvasContext() },
    canvasToTempFilePath(value) {
      canvasExports.push(value)
      if (options.autoCanvasExportPath) value.success?.({ tempFilePath: options.autoCanvasExportPath })
    },
    previewImage(value) { wx.previewRequest = clone(value) },
    saveImageToPhotosAlbum(value) { wx.saveImageRequest = clone(value) },
    shareFileMessage(value) { wx.shareRequest = clone(value) },
    showActionSheet(value) { wx.actionSheetRequest = clone(value) },
    showModal(value) { modalLog.push(value) },
    getFileSystemManager() {
      return {
        access(value) {
          fileAccessLog.push(value.path)
          if (accessibleFiles.has(value.path)) value.success?.({})
          else value.fail?.(new Error(`simulated missing file: ${value.path}`))
        },
      }
    },
  }
  global.wx = wx
  global.getCurrentPages = () => currentPages
  global.__setCurrentPages = (pages) => { currentPages = pages }
  wx.createCanvasContext = () => makeCanvasContext((callback) => {
    if (options.deferDrawCallbacks) drawCallbacks.push(callback)
    else callback?.()
  })

  return {
    wx,
    storage,
    failedReads,
    failedWrites,
    writeLog,
    vibrationLog,
    canvasExports,
    drawCallbacks,
    navigation,
    toastLog,
    modalLog,
    fileAccessLog,
    accessibleFiles,
    clock,
    setCurrentPages(pages) { currentPages = pages },
    runNextDrawCallback() {
      const callback = drawCallbacks.shift()
      if (callback) callback()
      return Boolean(callback)
    },
    resolveCanvasExport(index = 0, tempFilePath = `/tmp/spl-report-${index}.png`) {
      const request = canvasExports[index]
      if (!request) return false
      request.success?.({ tempFilePath })
      canvasExports.splice(index, 1)
      return true
    },
    rejectCanvasExport(index = 0) {
      const request = canvasExports[index]
      if (!request) return false
      request.fail?.(new Error('simulated canvas export failure'))
      canvasExports.splice(index, 1)
      return true
    },
    restore() {
      global.wx = previous.wx
      global.getCurrentPages = previous.getCurrentPages
      global.setTimeout = previous.setTimeout
      global.clearTimeout = previous.clearTimeout
      Date.now = previous.DateNow
      global.__setCurrentPages = previous.setCurrentPages
    },
  }
}

const pageDependencies = [
  'utils/performance.js',
  'data/equipment.js',
  'utils/spl.js',
  'utils/preferences.js',
  'utils/haptics.js',
  'utils/result-report-controller.js',
  'utils/result-report.js',
  'utils/report-canvas.js',
  'utils/report-image-actions.js',
  'pages/spl/spl-report.js',
  'utils/catalog-selector.js',
  'utils/result-record-actions.js',
  'utils/records.js',
]

function loadPageDefinition() {
  let definition
  const previousPage = global.Page
  global.Page = (value) => { definition = value }
  delete require.cache[pagePath]
  for (const relativePath of pageDependencies) {
    const dependencyPath = path.join(root, relativePath)
    delete require.cache[require.resolve(dependencyPath)]
  }
  const pageModule = new Module(pagePath, module)
  pageModule.filename = pagePath
  pageModule.paths = Module._nodeModulePaths(path.dirname(pagePath))
  pageModule.require = Module.createRequire(pagePath)
  const sourcePath = process.env.SPL_PROJECT_PAGE_SOURCE || pagePath
  pageModule._compile(fs.readFileSync(sourcePath, 'utf8'), pagePath)
  global.Page = previousPage
  if (!definition) throw new Error('pages/spl/spl.js did not register Page()')
  return definition
}

function createPage(definition, initialData = {}) {
  const page = {
    ...definition,
    data: { ...clone(definition.data), ...clone(initialData) },
    _deferSetDataCallbacks: false,
    _pendingSetDataCallbacks: [],
    setData(changes, callback) {
      this.data = { ...this.data, ...clone(changes) }
      if (callback) {
        if (this._deferSetDataCallbacks) this._pendingSetDataCallbacks.push(callback)
        else callback.call(this)
      }
    },
    flushSetDataCallbacks() {
      const callbacks = this._pendingSetDataCallbacks.splice(0)
      callbacks.forEach((callback) => callback.call(this))
      return callbacks.length
    },
  }
  global.__setCurrentPages?.([page])
  return page
}

module.exports = {
  FakeClock,
  clone,
  createPage,
  installPlatform,
  loadPageDefinition,
  root,
}

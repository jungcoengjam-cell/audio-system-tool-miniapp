const fs = require('node:fs')
const http = require('node:http')
const Module = require('node:module')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(process.env.CABLE_QA_EVIDENCE_ROOT
  || 'C:/Users/wxx/Documents/Codex/2026-10-10/tunebuddy-cable-revision-010048', 'browser-qa')
const reportEvidence = path.join(evidence, 'report-canvas')
const qaServerStartedAt = new Date().toISOString()
const currentCablePath = path.join(root, 'pages/cable/cable.js')
const productionSourceFiles = {
  controller: 'pages/cable/cable.js',
  report: 'pages/cable/cable-report.js',
  records: 'utils/records.js',
  drawing: 'utils/report-drawing.js',
  cable: 'utils/cable.js',
  pageWxml: 'pages/cable/cable.wxml',
  pageWxss: 'pages/cable/cable.wxss',
  overlaysWxml: 'pages/cable/cable-overlays.wxml',
  previewWxml: 'templates/result-report-preview.wxml',
  appWxss: 'app.wxss',
  sharedWxss: 'styles/theme-page-shared.wxss',
  qaServer: 'tests/cable-refactor-2026-10-09/browser-server.cjs',
  qaBrowser: 'tests/cable-refactor-2026-10-09/browser.js',
  qaRunner: 'tests/cable-refactor-2026-10-09/browser-run.cjs',
  qaHtml: 'tests/cable-refactor-2026-10-09/browser.html',
  qaCss: 'tests/cable-refactor-2026-10-09/browser.css',
  regression: 'tests/cable-refactor-2026-10-09/run.cjs',
  canvasRunner: 'tests/cable-refactor-2026-10-09/report-canvas-run.cjs',
  canvasHarness: 'tests/cable-refactor-2026-10-09/report-canvas.js',
  uiResources: 'tests/package-reclaim/ui-resources.cjs',
  uiResourceHashes: 'tests/package-reclaim/ui-test-first.json',
}

function digest(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex')
}

function getProductionSourceHashes() {
  return Object.fromEntries(Object.entries(productionSourceFiles)
    .map(([name, relativePath]) => [name, digest(relativePath)]))
}

const loadedSourceHashes = getProductionSourceHashes()
const storage = new Map()
let activeWindowHeight = 844
let readFailureKey = ''
const previewLayoutSessions = new Map()
let currentSelectorSnapshot = null
let lastBrowserSelectorQueryTrace = []

function projectSelectorQueryValue(source, options) {
  if (!source || typeof source !== 'object') return null
  const output = {}
  if (options.rect) {
    for (const key of ['left', 'right', 'top', 'bottom']) {
      if (source.rect && Object.prototype.hasOwnProperty.call(source.rect, key)) output[key] = source.rect[key]
    }
  }
  if (options.size) {
    if (source.rect && Object.prototype.hasOwnProperty.call(source.rect, 'width')) output.width = source.rect.width
    if (source.rect && Object.prototype.hasOwnProperty.call(source.rect, 'height')) output.height = source.rect.height
  }
  for (const key of Array.isArray(options.computedStyle) ? options.computedStyle : []) {
    if (source.computedStyle && Object.prototype.hasOwnProperty.call(source.computedStyle, key)) {
      output[key] = source.computedStyle[key]
    }
  }
  return output
}

function createBrowserSelectorQuery() {
  const selections = []
  return {
    in() { return this },
    select(selector) {
      return {
        fields(options, callback) {
          selections.push({ selector, options: clone(options || {}), callback })
        },
        boundingClientRect(callback) {
          selections.push({ selector, options: { rect: true }, callback })
        },
      }
    },
    exec(callback) {
      const trace = []
      selections.forEach(({ selector, options, callback: resultCallback }) => {
        const result = projectSelectorQueryValue(currentSelectorSnapshot?.[selector], options)
        trace.push({ selector, options, returnedKeys: Object.keys(result || {}) })
        if (resultCallback) resultCallback(result)
      })
      lastBrowserSelectorQueryTrace = trace
      if (callback) callback()
    },
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

global.wx = {
  getStorageSync(key) {
    if (key === readFailureKey) throw new Error('browser QA read failure')
    return clone(storage.get(key))
  },
  setStorageSync(key, value) { storage.set(key, clone(value)) },
  removeStorageSync(key) { storage.delete(key) },
  getWindowInfo() { return { windowHeight: activeWindowHeight } },
  showToast() {},
  hideLoading() {},
  showLoading() {},
  hideKeyboard() {},
  vibrateShort() {},
  vibrateLong() {},
  createSelectorQuery: createBrowserSelectorQuery,
}
global.getCurrentPages = () => []

let pageDefinition
global.Page = (definition) => { pageDefinition = definition }
const pageModule = new Module(currentCablePath, module)
pageModule.filename = currentCablePath
pageModule.paths = Module._nodeModulePaths(path.dirname(currentCablePath))
pageModule.require = Module.createRequire(currentCablePath)
pageModule._compile(fs.readFileSync(currentCablePath, 'utf8'), currentCablePath)
const records = require(path.join(root, 'utils/records.js'))

function projectFixture(id, name, updatedAt) {
  return {
    id, name, createdAt: updatedAt, updatedAt, venueName: '', engineer: '',
    projectDate: '2026-10-09', notes: '', roomLengthText: '', roomWidthText: '',
    roomHeightText: '', standardClassKey: 'conference', gradeKey: 'II',
  }
}

function resetWorkspace(includeProjects = true) {
  storage.set('audioTool.records.v1', [])
  const projects = includeProjects
    ? [projectFixture('qa-current', 'QA Current', 300), projectFixture('qa-target', 'QA Target', 200)]
    : []
  if (includeProjects) {
    for (let index = 3; index <= 18; index += 1) {
      projects.push(projectFixture(`qa-project-${index}`, `Field Project ${index}`, 200 - index))
    }
  }
  storage.set('audioTool.projects.v1', projects)
  storage.set('audioTool.activeProject.v1', projects[0]?.id || '')
  storage.set('audioTool.storageSchemaVersion', 3)
  readFailureKey = ''
  records.getWorkspaceSnapshot({ forceRefresh: true })
  return projects
}

function createPage() {
  return {
    ...pageDefinition,
    data: clone(pageDefinition.data),
    setData(changes, callback) {
      this.data = { ...this.data, ...clone(changes) }
      if (callback) callback.call(this)
    },
  }
}

function controllerState(name, viewportHeight, reportCase = 'constant') {
  activeWindowHeight = viewportHeight
  const page = createPage()
  page._pageVisible = false
  const projects = resetWorkspace(!['project-empty', 'project-error'].includes(name))

  if (name === 'blank') {
    page.data.constantPowerText = ''
    page.commitCalculatedState()
  } else if (name === 'error') {
    page.data.constantDistanceText = '1001'
    page.commitCalculatedState()
  } else if (name === 'review') {
    page.data.constantPowerText = '1200'
    page.data.constantDistanceText = '1000'
    page.data.environmentIndex = 1
    page.commitCalculatedState()
  } else if (name === 'professional') {
    page.data.modeIndex = 1
    page.commitCalculatedState()
  } else if (name === 'reset-draft') {
    page.data.canReset = true
    page.data.inputPending = true
    page.data.calculationState = 'pending'
    page.data.canUseResultActions = false
  } else if (name === 'professional-longtext') {
    page.data.modeIndex = 1
    page.commitCalculatedState()
    const long = '工程复核条件：线材供货与现场敷设参数需结合设备负载、环境温度和当地规范完整核对。'.repeat(2)
    page.data.result = {
      ...page.data.result,
      spec: 'RVV2×10 mm² / ' + '专业音箱长规格描述 '.repeat(3),
      description: long,
      warnings: [long],
      isWithinStandard: false,
      status: '需工程复核',
    }
  } else if (name === 'longtext') {
    page.commitCalculatedState()
    const long = 'Long engineering context, installation constraints, cable sourcing limits, ambient conditions, and verification notes. '.repeat(3)
    page.data.result = {
      ...page.data.result,
      spec: 'RVV2x10 mm2 / ' + 'extended conductor description '.repeat(4),
      description: long,
      warnings: [long, long],
      isWithinStandard: false,
    }
  } else {
    page.commitCalculatedState()
  }

  if (name === 'project' || name === 'project-empty' || name === 'project-error') {
    if (name === 'project-error') readFailureKey = 'audioTool.projects.v1'
    page.openProjectSheet()
    if (name === 'project-error') readFailureKey = ''
  } else if (name === 'project-confirm') {
    page.openProjectSheet()
    page.selectProjectTarget({ currentTarget: { dataset: { id: projects[1].id } } })
  } else if (name === 'project-success' || name === 'project-save-error' || name === 'project-save-blocked') {
    page.openProjectSheet()
    page.selectProjectTarget({ currentTarget: { dataset: { id: projects[1].id } } })
    if (name === 'project-success') {
      page.data.projectDialogStep = 'success'
      page.data.projectConfigName = 'East Hall baseline'
      page.data.projectSavedConfigName = 'East Hall baseline'
    } else if (name === 'project-save-error') {
      page.data.projectError = '暂时无法核对保存状态，请重试确认。'
    } else {
      page.data.projectSaveBlocked = true
      page.data.projectError = '本页结果已变化，请关闭并重新选择保存目标。'
    }
  } else if (name === 'project-keyboard') {
    page.openProjectSheet()
    page.openProjectCreateForm()
    page.data.projectNameText = 'Main Hall'
    const revision = page._projectDialogRevision
    const field = {
      currentTarget: { dataset: { dialogRevision: revision, step: 'create', field: 'projectNameText' } },
    }
    page.beginProjectInputFocus(field)
    page.onProjectKeyboardHeightChange({
      currentTarget: { dataset: {
        dialogRevision: revision,
        focusEpisode: page.data.projectFocusEpisode,
        step: 'create',
         field: 'projectNameText',
      } },
      detail: { height: Math.min(300, Math.floor(viewportHeight * 0.67)) },
    })
  } else if (name === 'project-list-keyboard') {
    page.openProjectSheet()
    page.beginProjectInputFocus({ currentTarget: { dataset: {
      dialogRevision: page._projectDialogRevision,
      step: 'select',
      field: 'projectSearchText',
    } } })
    page.onProjectKeyboardHeightChange({
      currentTarget: { dataset: {
        dialogRevision: page._projectDialogRevision,
        focusEpisode: page.data.projectFocusEpisode,
        step: 'select',
         field: 'projectSearchText',
      } },
      detail: { height: Math.min(300, Math.floor(viewportHeight * 0.67)) },
    })
  } else if (name === 'project-config-name-keyboard' || name === 'project-config-note-keyboard') {
    page.openProjectSheet()
    page.selectProjectTarget({ currentTarget: { dataset: { id: projects[1].id } } })
    const fieldName = name === 'project-config-name-keyboard' ? 'projectConfigName' : 'projectConfigNote'
    page.beginProjectInputFocus({ timeStamp: 100, currentTarget: { dataset: {
      dialogRevision: page._projectDialogRevision,
      step: 'confirm',
      field: fieldName,
    } } })
    page.onProjectKeyboardHeightChange({
      timeStamp: 110,
      currentTarget: { dataset: {
        dialogRevision: page._projectDialogRevision,
        focusEpisode: page.data.projectFocusEpisode,
        step: 'confirm',
        field: fieldName,
      } },
      detail: { height: Math.min(300, Math.floor(viewportHeight * 0.67)) },
    })
  } else if (name === 'share' || name === 'share-viewer') {
    if (!['constant', 'professional', 'review'].includes(reportCase)) {
      throw new Error(`Unknown report artifact: ${reportCase}`)
    }
    const artifactPath = path.join(reportEvidence, `${reportCase}.png`)
    if (!fs.existsSync(artifactPath)) throw new Error(`Missing report artifact: ${reportCase}`)
    const reportPng = fs.readFileSync(artifactPath)
    page._pageVisible = true
    page._isUnloaded = false
    page.data.resultReportCanvasWidth = reportPng.readUInt32BE(16)
    page.data.resultReportCanvasHeight = reportPng.readUInt32BE(20)
    page.data.resultReportPreviewVisible = true
    page.data.resultReportImagePath = `data:image/png;base64,${reportPng.toString('base64')}`
    page.resultReportSignature = page.getResultReportSignature(page.getRecordPayload())
    if (name === 'share-viewer') {
      page.data.resultReportImageViewerVisible = true
      page.data.resultReportImageViewerScale = 300
      page.data.resultReportImageViewerEpisode = 1
    }
  } else if (name === 'share-failed') {
    page.data.resultReportPreviewVisible = false
    page.data.resultReportImagePath = ''
    page.data.isGeneratingResultReport = false
  }

  if (name === 'preference-save-error-reset' || name === 'preference-save-error-write') {
    page.data.preferenceSaveError = 'browser QA preference write failure'
    page.data.preferenceSaveErrorAction = name === 'preference-save-error-reset' ? 'reset' : 'write'
  }

  const state = clone(page.data)
  if (name === 'share' || name === 'share-viewer') {
    const token = crypto.randomUUID()
    previewLayoutSessions.set(token, page)
    state.qaLayoutToken = token
  }
  return state
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wxss': 'text/css; charset=utf-8',
  '.wxml': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
}

fs.mkdirSync(evidence, { recursive: true })
fs.mkdirSync(reportEvidence, { recursive: true })
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:8123')
  if (url.pathname === '/__state') {
    const currentSourceHashes = getProductionSourceHashes()
    if (JSON.stringify(currentSourceHashes) !== JSON.stringify(loadedSourceHashes)) {
      response.writeHead(409, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({
        error: 'QA server source differs from the loaded controller graph; restart the server before capture',
        loadedSourceHashes,
        currentSourceHashes,
      }))
      return
    }
    const name = url.searchParams.get('state') || 'valid'
    const height = Number(url.searchParams.get('viewportHeight')) || 844
    const reportCase = url.searchParams.get('reportCase') || 'constant'
    const state = controllerState(name, height, reportCase)
    state.qaServerStartedAt = qaServerStartedAt
    state.loadedSourceHashes = loadedSourceHashes
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(state))
    return
  }
  if (url.pathname === '/__preview-layout' && request.method === 'POST') {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const page = previewLayoutSessions.get(input.token)
        if (!page) {
          response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: 'preview layout session expired' }))
          return
        }
        currentSelectorSnapshot = input.selectors || {}
        lastBrowserSelectorQueryTrace = []
        const methodCalled = typeof page.updateResultReportPreviewLayout === 'function'
        let methodResult = false
        try {
          methodResult = methodCalled ? page.updateResultReportPreviewLayout() : false
        } finally {
          currentSelectorSnapshot = null
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({
          methodCalled,
          methodResult,
          resultReportPreviewStyle: page.data.resultReportPreviewStyle || '',
          canvas: {
            width: page.data.resultReportCanvasWidth,
            height: page.data.resultReportCanvasHeight,
          },
          selectorQueryTrace: lastBrowserSelectorQueryTrace,
          observedSelectors: input.selectors,
          qaServerStartedAt,
          loadedSourceHashes,
        }))
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: String(error && error.stack || error) }))
      }
    })
    return
  }
  if (url.pathname === '/__report-artifact' && request.method === 'POST') {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try {
        const artifact = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!['constant', 'professional', 'review'].includes(artifact.case)) {
          response.writeHead(400)
          response.end('unknown report case')
          return
        }
        const match = String(artifact.imageDataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
        if (!match) {
          response.writeHead(400)
          response.end('expected PNG data URL')
          return
        }
        const png = Buffer.from(match[1], 'base64')
        if (png.length < 64 || png.readUInt32BE(0) !== 0x89504e47) {
          response.writeHead(400)
          response.end('invalid PNG data')
          return
        }
        const fileName = `${artifact.case}.png`
        fs.writeFileSync(path.join(reportEvidence, fileName), png)
        const manifest = {
          case: artifact.case,
          renderer: 'Chromium Canvas2D; actual cable-report.js and utils/report-drawing.js executed in browser',
          limits: 'Browser Canvas2D evidence only. It is not a WeChat runtime or native PNG export.',
          qaServerStartedAt: artifact.qaServerStartedAt,
          sourceHashes: {
            cableReport: digest('pages/cable/cable-report.js'),
            reportDrawing: digest('utils/report-drawing.js'),
            controller: digest('pages/cable/cable.js'),
            cableUtility: digest('utils/cable.js'),
          },
          loadedSourceHashes,
          inputs: artifact.inputs,
          result: artifact.result,
          payload: artifact.payload,
          layout: artifact.layout,
          output: {
            fileName,
            sha256: require('node:crypto').createHash('sha256').update(png).digest('hex'),
            width: artifact.width,
            height: artifact.height,
            bytes: png.length,
          },
        }
        fs.writeFileSync(path.join(reportEvidence, `${artifact.case}.json`), `${JSON.stringify(manifest, null, 2)}\n`)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ saved: true, fileName, sha256: manifest.output.sha256 }))
      } catch (error) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        response.end(String(error && error.stack || error))
      }
    })
    return
  }
  if (url.pathname === '/__geometry' && request.method === 'POST') {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const report = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      report.sourceHashes = {
        wxml: digest('pages/cable/cable.wxml'),
        wxss: digest('pages/cable/cable.wxss'),
        controller: digest('pages/cable/cable.js'),
        report: digest('pages/cable/cable-report.js'),
        overlays: digest('pages/cable/cable-overlays.wxml'),
        preview: digest('templates/result-report-preview.wxml'),
        appWxss: digest('app.wxss'),
        sharedWxss: digest('styles/theme-page-shared.wxss'),
      }
      report.loadedSourceHashes = loadedSourceHashes
      report.currentProductionSourceHashes = getProductionSourceHashes()
      report.qaServerStartedAt = qaServerStartedAt
      const name = `${report.case}-${report.viewport.width}x${report.viewport.height}-${report.theme}`
      fs.writeFileSync(path.join(evidence, `${name}.json`), JSON.stringify(report, null, 2) + '\n')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        saved: true,
        loadedSourceHashes,
        currentProductionSourceHashes: report.currentProductionSourceHashes,
        qaServerStartedAt,
      }))
    })
    return
  }

  const relativePath = decodeURIComponent(url.pathname === '/' ? '/tests/cable-refactor-2026-10-09/browser.html' : url.pathname)
  const file = path.resolve(root, `.${relativePath}`)
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404)
    response.end('not found')
    return
  }
  response.writeHead(200, { 'content-type': contentTypes[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(response)
})

const qaPort = Number(process.env.CABLE_QA_PORT) || 8123
server.listen(qaPort, '127.0.0.1', () => console.log(`Cable browser QA bridge at http://127.0.0.1:${qaPort}`))

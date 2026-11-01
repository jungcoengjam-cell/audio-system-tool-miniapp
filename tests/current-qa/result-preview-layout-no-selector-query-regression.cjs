'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createEnvironment } = require('../p2-safety/harness.cjs')

const root = path.resolve(__dirname, '../..')

function createPage(relativePath, revisionKey, validState) {
  const env = createEnvironment()
  let selectorQueryCalls = 0
  env.wx.createSelectorQuery = () => {
    selectorQueryCalls += 1
    throw new Error('result preview must use the shared flex layout, not selector-query geometry')
  }
  const page = env.loadPage(relativePath)
  Object.assign(page, validState.state)
  Object.assign(page.data, validState.data)
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch)
    if (callback) callback()
  }
  return { env, page, revisionKey, selectorQueryCalls: () => selectorQueryCalls }
}

function exercisePage(relativePath, revisionKey, validState) {
  const fixture = createPage(relativePath, revisionKey, validState)
  const { page } = fixture
  const before = Number(page[revisionKey]) || 0
  assert.equal(page.updateResultReportPreviewLayout(), true,
    `${relativePath} accepts a visible, current preview without a geometry query`)
  assert.equal(fixture.selectorQueryCalls(), 0, `${relativePath} does not start selector-query`)
  assert.equal(page[revisionKey], before + 1, `${relativePath} advances its stale-work revision`)
  assert.equal(page.data.resultReportPreviewStyle, '', `${relativePath} clears obsolete inline dimensions`)

  page.data.resultReportPreviewStyle = '--legacy-preview-height:999px'
  page.data.resultReportPreviewClosing = true
  const closingRevision = page[revisionKey]
  assert.equal(page.updateResultReportPreviewLayout(), false,
    `${relativePath} preserves the closing-state guard`)
  assert.equal(page[revisionKey], closingRevision, `${relativePath} does not advance revision while closing`)
  assert.equal(page.data.resultReportPreviewStyle, '--legacy-preview-height:999px',
    `${relativePath} keeps the original guard-before-clear ordering`)
  assert.equal(fixture.selectorQueryCalls(), 0)

  page.data.resultReportPreviewClosing = false
  page.data.resultReportPreviewStyle = '--legacy-preview-height:999px'
  page.renderDiagram = () => {}
  assert.equal(page.closeResultReportPreview(true), true, `${relativePath} keeps the immediate close path`)
  assert(page[revisionKey] > closingRevision, `${relativePath} close invalidates earlier preview work`)
  assert.equal(page.data.resultReportPreviewVisible, false, `${relativePath} closes the same preview state`)
  assert.equal(page.data.resultReportPreviewStyle, '', `${relativePath} clears legacy inline dimensions on close`)
  assert.equal(fixture.selectorQueryCalls(), 0)
}

exercisePage('pages/camera/camera.js', '_cameraReportPreviewLayoutRevision', {
  state: {
    _pageVisible: true, _cameraUnloaded: false, _isUnloaded: false,
    _cameraReportPreviewLayoutRevision: 4, resultReportSignature: 'camera-report-signature',
    getResultReportSignature() { return 'camera-report-signature' },
    canUseCurrentResultReport() { return true },
  },
  data: {
    resultReportPreviewVisible: true, resultReportPreviewClosing: false,
    resultReportPreviewStyle: '--camera-report-scroll-height:999px',
    resultReportImagePath: 'wxfile://camera-report.png', resultUpdating: false,
    legacyCustomUnsupported: false,
  },
})

exercisePage('pages/cable/cable.js', '_reportPreviewLayoutRevision', {
  state: {
    _pageVisible: true, _isUnloaded: false, _reportPreviewLayoutRevision: 7,
    resultReportSignature: 'cable-report-signature',
  },
  data: {
    resultReportPreviewVisible: true, resultReportPreviewClosing: false,
    resultReportPreviewStyle: '--cable-report-scroll-height:999px',
    resultReportImagePath: 'wxfile://cable-report.png',
  },
})

exercisePage('pages/audio-wiring/index.js', '_reportPreviewLayoutRevision', {
  state: {
    _pageVisible: true, _pageUnloaded: false, _reportPreviewLayoutRevision: 10,
    getRecordPayload() { return { outputId: 'xlrBalanced', inputId: 'terminalBalanced' } },
  },
  data: {
    resultReportPreviewVisible: true, resultReportPreviewClosing: false,
    resultReportPreviewStyle: '--cable-report-scroll-height:999px',
    resultReportImagePath: 'wxfile://audio-wiring-report.png',
  },
})

const appStyles = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
const sheetRule = appStyles.match(/\.result-sheet\.result-sheet\.result-sheet\{([^}]*)\}/)?.[1] || ''
const imageScrollRule = appStyles.match(/\.result-sheet\.result-share\.result-share \.result-scroll\{([^}]*)\}/)?.[1] || ''
assert.match(sheetRule, /(?:^|;)height:86vh(?:;|$)/,
  'shared result preview height remains CSS-owned at 86vh')
assert.match(imageScrollRule, /(?:^|;)flex:1 1 0(?:;|$)/,
  'result image area grows inside the shared fixed-height panel')
assert.match(imageScrollRule, /(?:^|;)overflow-y:auto(?:;|$)/,
  'long result images remain scrollable inside the panel')
const previewTemplate = fs.readFileSync(path.join(root, 'templates/result-report-preview.wxml'), 'utf8')
assert.match(previewTemplate, /<scroll-view class="result-report-preview-scroll result-scroll" scroll-y/,
  'camera, cable, and audio previews retain their internal scroll-view')
assert.match(previewTemplate, /class="result-report-preview-actions result-footer"/,
  'shared image preview actions remain in the fixed footer')

console.log('PASS camera/cable/audio preview geometry uses shared CSS without selector-query')

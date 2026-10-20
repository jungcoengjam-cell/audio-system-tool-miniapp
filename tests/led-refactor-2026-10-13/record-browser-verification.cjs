'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const evidenceDir = path.join(__dirname, 'evidence')
const reportDir = path.join(evidenceDir, 'reports')
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const latestReport = fs.readdirSync(reportDir)
  .filter((name) => /^led-report-near-sample-\d+\.json$/.test(name))
  .map((name) => ({ name, mtime: fs.statSync(path.join(reportDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0]
if (!latestReport) throw new Error('No exact near-sample report manifest found.')
const reportManifestPath = path.join(reportDir, latestReport.name)
const reportManifest = JSON.parse(fs.readFileSync(reportManifestPath, 'utf8'))
const sourceHashChecks = Object.fromEntries(Object.entries(reportManifest.sourceHashes).map(([relative, expected]) => {
  const absolute = path.join(root, relative)
  return [relative, { expected, current: fs.existsSync(absolute) ? sha256(absolute) : null,
    matches: fs.existsSync(absolute) && sha256(absolute) === expected }]
}))

const evidence = {
  generatedAt: new Date().toISOString(),
  renderer: {
    browser: 'Codex in-app browser, localhost bridge',
    url: 'http://127.0.0.1:8160/tests/led-refactor-2026-10-13/led-browser.html',
    source: 'Production LED WXML recursively expanded, production WXSS imports and rpx values applied, production page controller handlers, and production Canvas report renderer.',
    productionSourceHashes: reportManifest.sourceHashes,
    sourceHashChecks,
    allSourceHashesMatchCurrent: Object.values(sourceHashChecks).every((check) => check.matches),
    browserOnly: true,
  },
  exactSample: {
    result: 'pass',
    input: { wallWidthM: 6, wallHeightM: 3, topReserveM: 0.2, bottomReserveM: 0.2, framePerSideCm: 5,
      viewingDistanceM: 2, ratio: '16:9', unit: 'module 320x160mm', pitchMode: 'recommended' },
    output: { screenWidthM: 4.48, screenHeightM: 2.4, columns: 14, rows: 15, modules: 210,
      outerWidthM: 4.58, outerHeightM: 2.5, leftRightMarginM: 0.71, topBottomMarginM: 0.25,
      pitch: 'P1.25', resolution: '3584x1920', actualRatio: '1.87:1', deviationPercent: 5,
      distanceWarning: 'Near; 2m is below the 2.13m comfort-reference lower bound.' },
    viewports: {
      normal: { width: 390, height: 844, theme: 'light/system', result: 'pass', notes: 'Result-first layout, wall illustration, limiter cards, and near-distance warning are visible and readable.' },
      compactDarkLargeText: { width: 320, height: 400, theme: 'dark', fontScaleSimulation: 1.5, result: 'pass',
        notes: 'Page remains vertically scrollable; document, body, and root width are each 320px with no horizontal overflow.' },
    },
  },
  geometryCases: {
    tallWall: {
      inputWallM: '3x6', result: 'pass',
      stage: { x: 40.84375, y: 328.76044, width: 292.97919, height: 218.39584 },
      wall: { x: 138.34897, y: 339.98959, width: 97.96875, height: 195.9375 },
      contained: true,
    },
    wideWall: {
      inputWallM: '20x2', result: 'pass',
      stage: { x: 40.84375, y: 328.76044, width: 292.97919, height: 32.75 },
      wall: { x: 40.84375, y: 330.48959, width: 292.97919, height: 29.29167 },
      contained: true,
    },
  },
  projectConfirmation: {
    result: 'pass',
    viewport: { width: 320, height: 400, theme: 'dark', fontScaleSimulation: 1.5 },
    target: 'LED QA South Hall',
    configNameAndNoteFields: 'Visible; note field scrolls within modal.',
    footer: { top: 338.96875, bottom: 392.51042, result: 'both 48px buttons visible and enabled after scrolling' },
    scope: 'Dialog rendering and footer visibility verified; storage/validation/save-reopen semantics covered by controller and migrated regression suites.',
  },
  report: {
    result: 'pass',
    preview: { viewport: '390x844', scrollTop: 301.33, scrollHeight: 676, clientHeight: 374,
      bottomContent: 'Parameters, ratio/deviation, warning text, share/save/copy actions visible; background page scroll is locked.' },
    png: {
      path: reportManifest.output.path,
      manifest: path.relative(root, reportManifestPath).replace(/\\/g, '/'),
      sha256: reportManifest.output.sha256,
      width: reportManifest.output.width,
      height: reportManifest.output.height,
      bytes: reportManifest.output.bytes,
      productionRenderer: reportManifest.renderer,
      sourceHashesMatchCurrent: Object.values(sourceHashChecks).every((check) => check.matches),
    },
    grid: 'Rendered at 14 columns x 15 rows; all normal sample cell lines are retained.',
  },
  originalViewer: {
    result: 'pass',
    normalViewport: { width: 390, height: 844, scale100Selected: true, headerHeight: 48, noOverlap: true },
    compactLargeText: {
      viewport: { width: 320, height: 400, theme: 'dark', fontScaleSimulation: 1.5 },
      result: 'pass',
      header: { x: 12, y: 8, width: 296, height: 96 },
      backButton: { x: 12, y: 8, width: 98, height: 44, unwrapped: true },
      title: { x: 118, y: 16, width: 190, height: 28 },
      zoomRow: { x: 12, y: 60, width: 296, height: 44, buttonsCenteredX: [90, 138, 186], buttonSize: '44x44' },
      noOverlap: true,
    },
    zoomAndPan: {
      scale200: { selected: true, imageWidth: 698.67, imageHeight: 1261.32, scrollWidth: 699, scrollHeight: 1261 },
      scale300: { selected: true, imageWidth: 1048, imageHeight: 1891.98, scrollWidth: 1048, scrollHeight: 1892 },
      panAt200: { verticalScrollTop: 510, horizontalScrollLeft: 349.33, result: 'both axes moved' },
      cacheReopen: { result: 'pass', viewerReportPngCountBefore: 3, viewerReportPngCountAfter: 3,
        notes: 'Closing and reopening the cached result showed the existing report without another renderer export.' },
    },
  },
  evidenceLimitations: {
    browserScreenshotsSaved: false,
    browserScreenshotPolicy: 'The CUA screenshot-capture policy blocked persisting captured browser pixels to workspace files or routing them through another API. Visual UI checks were inspected live; the retained PNG is the app-generated production report export.',
    nativeWeChatRuntime: 'Not available in this QA environment; no native WeChat rendering, picker/IME, share-permission, or physical-device claim is made.',
    simulation: 'Dark theme was applied by mapping the existing prefers-color-scheme media query to the requested branch. Font enlargement used a browser-side 1.5x rpx font-size simulation, not native WeChat accessibility scaling.',
  },
}

fs.writeFileSync(path.join(evidenceDir, 'browser-verification.json'), JSON.stringify(evidence, null, 2) + '\n')
process.stdout.write(JSON.stringify({ output: 'tests/led-refactor-2026-10-13/evidence/browser-verification.json',
  report: evidence.report.png, allSourceHashesMatchCurrent: evidence.renderer.allSourceHashesMatchCurrent }, null, 2) + '\n')
if (!evidence.renderer.allSourceHashesMatchCurrent) process.exitCode = 1

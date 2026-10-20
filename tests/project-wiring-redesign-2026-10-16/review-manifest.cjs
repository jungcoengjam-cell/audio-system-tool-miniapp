const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..'), evidence = path.join(__dirname, 'evidence')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const read = name => fs.existsSync(path.join(evidence, name)) ? JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8')) : null
const uiSources = ['app.wxss', 'styles/theme-page-shared.wxss', 'pages/project-wiring/index.js', 'pages/project-wiring/index.wxml', 'pages/project-wiring/index.wxss', 'pages/project-wiring/workspace-ui.js', 'pages/project-wiring/workspace-model.js', 'pages/project-wiring/workspace.wxml', 'pages/project-wiring/workspace.wxss', 'utils/project-wiring.js', 'utils/records.js']
const reportSources = ['pages/project-wiring/report.js', 'pages/project-wiring/workspace-model.js', 'utils/project-wiring.js']
const currentHashes = Object.fromEntries([...new Set([...uiSources, ...reportSources])].filter(name => fs.existsSync(path.join(root, name))).map(name => [name, hash(path.join(root, name))]))
const browser = read('browser-checks.json'), canvas = read('report-checks.json'), interaction = read('interaction-checks.json'), compile = read('compile/compile.json'), events = read('event-binding-checks.json')
const captures = (browser?.captures || []).map(capture => {
  const scene = read('scenes/' + capture.name + '.json'), theme = /(?:^|-)dark(?:-|$)/.test(capture.name) ? 'dark' : 'light'
  const sourceHashes = Object.fromEntries(uiSources.map(name => [name, scene.sources[name] || null]))
  const staleSources = uiSources.filter(name => sourceHashes[name] !== currentHashes[name])
  return { scene: capture.name, path: capture.file, theme, viewport: { width: capture.width, height: capture.height }, sha256: hash(capture.file), sourceHashes, staleSources }
})
for (const file of events?.screenshots || []) captures.push({ scene: path.basename(file, '.png'), path: file, theme: 'dark', viewport: { width: 390, height: 844 }, sha256: hash(file), sourceHashes: Object.fromEntries(uiSources.map(name => [name, events.sources[name]])), staleSources: uiSources.filter(name => events.sources[name] !== currentHashes[name]) })
const exportReports = (canvas?.reports || []).map(report => ({ fixture: report.fixture, count: report.count, theme: report.theme, pageCount: report.pages, sourceHashes: Object.fromEntries(reportSources.map(name => [name, report.sources[name]])), staleSources: reportSources.filter(name => report.sources[name] !== currentHashes[name]), pages: report.outputs.map(page => ({ path: page.filename, sha256: hash(page.filename), width: page.width, height: page.height, bytes: page.bytes })) }))
const allChecks = [...(browser?.checks || []).map(check => ({ suite: 'browser', ...check })), ...(canvas?.checks || []).map(check => ({ suite: 'actual-canvas', ...check })), ...(interaction?.checks || []).map(check => ({ suite: 'controller-interactions', ...check })), ...(events?.checks || []).map(check => ({ suite: 'actual-dom-event-bindings', ...check })), ...(compile?.executions || []).map(check => ({ suite: 'native-source-compile', name: check.name, passed: check.exitCode === 0 && !check.error, evidence: { exitCode: check.exitCode, error: check.error } }))]
const manifest = { generatedAt: new Date().toISOString(), root, currentHashes, captures, exports: exportReports,
  passed: allChecks.filter(check => check.passed), failed: allChecks.filter(check => !check.passed),
  notRun: [
    { name: 'Native WeChat simulator runtime and native wheel', reason: 'This QA uses current WXML/WXSS mapped into Chromium and an HTML wheel-column adapter.' },
    { name: 'Physical iOS/Android device keyboard, performance and safe-area behavior', reason: 'No physical device connected; browser checks are not reported as device acceptance.' },
    { name: 'Native WeChat Canvas temp-file export, album permissions and share menu delivery', reason: 'Real production renderer ran on Chromium Canvas2D; native API behavior requires WeChat runtime/device.' },
    { name: 'Data-specific suites and full release', reason: 'Already executed by root; not repeated by this agent.' },
  ],
  limits: ['Raster PNGs are actual production-source renders in Chromium adapters, not hand-drawn mockups.', 'Native WCC/WCSC compilation is source compilation only.', 'No commit, push or publication performed.'],
  status: { passed: allChecks.filter(check => check.passed).length, failed: allChecks.filter(check => !check.passed).length, staleCaptures: captures.filter(capture => capture.staleSources.length).length, staleExports: exportReports.filter(report => report.staleSources.length).length }
}
for (const [name, checks] of [['browser-run.log', browser?.checks], ['report-canvas-run.log', canvas?.checks], ['interactions.log', interaction?.checks], ['event-bindings.log', events?.checks]]) if (checks) fs.writeFileSync(path.join(evidence, name), checks.map(check => `${check.passed ? 'PASS' : 'FAIL'} ${check.name}`).join('\n') + '\n')
fs.writeFileSync(path.join(evidence, 'review-manifest.json'), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest.status, null, 2))

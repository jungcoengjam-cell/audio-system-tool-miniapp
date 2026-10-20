'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const phase = process.argv[2] || 'after'
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after')
const project = path.join(__dirname, 'native-' + phase)
fs.mkdirSync(project, { recursive: true })
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline/manifest.json')))
const sourceFiles = [...Object.keys(baseline.hashes).filter(file => !file.startsWith('project.') && file !== 'app.js')]
if (fs.existsSync(path.join(root, 'pages/control-protocol/viewer-state.js'))) sourceFiles.push('pages/control-protocol/viewer-state.js')
// Other authorized tasks can add routes while verification is running. Include
// their current local dependencies so the isolated app uses a coherent app.json.
if (phase === 'after') {
  const seen = new Set(sourceFiles)
  function includeCurrent(relative) {
    const absolute = path.join(root, relative)
    if (!fs.existsSync(absolute)) return
    const stat = fs.lstatSync(absolute)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute)) includeCurrent(path.posix.join(relative, name))
    } else if (stat.isFile() && !seen.has(relative)) {
      seen.add(relative)
      sourceFiles.push(relative)
    }
  }
  for (const directory of ['pages', 'utils', 'data', 'styles', 'templates', 'assets']) includeCurrent(directory)
}
const hashes = {}
for (const file of sourceFiles) {
  const baselineFile = path.join(__dirname, 'baseline', file)
  const source = phase === 'before' && file.startsWith('pages/control-protocol/') && fs.existsSync(baselineFile)
    ? baselineFile : path.join(root, file)
  if (!fs.existsSync(source)) continue
  const target = path.join(project, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json')))
config.projectname = 'TuneBuddy-Protocol-UI-' + phase
fs.writeFileSync(path.join(project, 'project.config.json'), JSON.stringify(config, null, 2))
// Keep the production subpackage and native rendering/theme settings, while
// excluding unrelated routes that are being rewritten concurrently. This is
// a feature-isolation app, not evidence of a complete application build.
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json')))
appConfig.pages = ['qa/launcher']
appConfig.subPackages = [{ root: 'pages/control-protocol', pages: ['index', 'detail'] }]
delete appConfig.tabBar
fs.writeFileSync(path.join(project, 'app.json'), JSON.stringify(appConfig, null, 2))
fs.mkdirSync(path.join(project, 'qa'), { recursive: true })
fs.writeFileSync(path.join(project, 'qa/launcher.js'), "Page({onLoad(){wx.redirectTo({url:'/pages/control-protocol/index'})}})\n")
fs.writeFileSync(path.join(project, 'qa/launcher.json'), '{}\n')
fs.writeFileSync(path.join(project, 'qa/launcher.wxml'), '<view>正在打开协议速查…</view>\n')
fs.writeFileSync(path.join(project, 'qa/launcher.wxss'), '')
// Keep the real UI, theme, navigation, image and clipboard APIs. Isolate only
// storage so UI verification cannot read or overwrite the owner's records.
fs.writeFileSync(path.join(project, 'app.js'), `const store = Object.create(null)
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
App({ onLaunch() {
  this.__protocolQaStore = store
  wx.getStorageSync = key => clone(store[key])
  wx.setStorageSync = (key, value) => { store[key] = clone(value) }
  wx.removeStorageSync = key => { delete store[key] }
  wx.getStorageInfoSync = () => ({ keys: Object.keys(store), currentSize: 0, limitSize: 10240 })
} })
`)
const manifest = { createdAt: new Date().toISOString(), project, phase, storage: 'isolated App memory map; no owner persistent records read or written', routeIsolation: 'QA launcher plus unchanged production control-protocol subpackage; unrelated concurrent routes excluded', wholeApplicationBuild: false, appidSource: 'existing project AppID', hashes }
fs.writeFileSync(path.join(__dirname, 'native-' + phase + '-manifest.json'), JSON.stringify(manifest, null, 2))
fs.mkdirSync(path.join(__dirname, 'evidence'), { recursive: true })
console.log(JSON.stringify({ project, phase, sourceFiles: Object.keys(hashes).length, isolatedStorage: true }))

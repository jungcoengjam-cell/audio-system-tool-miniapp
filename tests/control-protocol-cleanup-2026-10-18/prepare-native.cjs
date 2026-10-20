'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const project = path.join(__dirname, 'native')
const hashes = {}
function copy(relative) {
  const source = path.join(root, relative)
  if (fs.statSync(source).isDirectory()) {
    for (const name of fs.readdirSync(source)) copy(path.posix.join(relative, name))
    return
  }
  const target = path.join(project, relative), bytes = fs.readFileSync(source)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, bytes)
  hashes[relative] = crypto.createHash('sha256').update(bytes).digest('hex')
}
for (const file of ['pages/control-protocol', 'utils/preferences.js', 'styles', 'app.wxss', 'theme.json']) copy(file)
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json')))
config.projectname = 'TuneBuddy-Protocol-Cleanup'
fs.writeFileSync(path.join(project, 'project.config.json'), JSON.stringify(config, null, 2))
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')))
app.pages = ['qa/launcher']
app.subPackages = [{ root: 'pages/control-protocol', pages: ['index', 'detail'] }]
delete app.tabBar
fs.writeFileSync(path.join(project, 'app.json'), JSON.stringify(app, null, 2))
// Reuse the prior QA storage sandbox; keep native rendering, files and input.
fs.copyFileSync(path.join(__dirname, '../control-protocol-refactor-2026-10-18/native-after/app.js'), path.join(project, 'app.js'))
fs.mkdirSync(path.join(project, 'qa'), { recursive: true })
fs.writeFileSync(path.join(project, 'qa/launcher.js'), "Page({onLoad(){wx.redirectTo({url:'/pages/control-protocol/index'})}})\n")
fs.writeFileSync(path.join(project, 'qa/launcher.json'), '{}\n')
fs.writeFileSync(path.join(project, 'qa/launcher.wxml'), '<view />\n')
fs.writeFileSync(path.join(project, 'qa/launcher.wxss'), '')
fs.writeFileSync(path.join(__dirname, 'native-manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), project, hashes, routeIsolation: 'QA launcher and unchanged production protocol subpackage only', storage: 'isolated memory; no owner records read or written', wholeApplicationBuild: false }, null, 2))
console.log('Prepared isolated native protocol project')

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const phase = process.argv[2] || 'after'
assert(['before', 'after'].includes(phase))
const target = path.join(__dirname, 'native-' + phase)
fs.mkdirSync(target, { recursive: true })
for (const directory of ['pages', 'utils', 'data', 'styles', 'assets', 'components', 'custom-tab-bar']) {
  const source = path.join(root, directory)
  if (fs.existsSync(source)) fs.cpSync(source, path.join(target, directory), { recursive: true })
}
for (const name of ['app.json', 'app.wxss', 'theme.json', 'sitemap.json']) {
  if (fs.existsSync(path.join(root, name))) fs.copyFileSync(path.join(root, name), path.join(target, name))
}
if (phase === 'before') {
  for (const name of ['dmx-address', 'dmx-layout', 'dmx-layout-landscape']) {
    fs.cpSync(path.join(__dirname, 'baseline/pages', name), path.join(target, 'pages', name), { recursive: true })
  }
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
config.projectname = 'dmx-native-' + phase
fs.writeFileSync(path.join(target, 'project.config.json'), JSON.stringify(config, null, 2))
const { createGroup, buildPreferences } = require('../../pages/dmx-address/group-input')
const now = Date.now()
const seed = {
  'audioTool.dmxAddress.preferences': buildPreferences({ startAddressText: '1', allocationMode: 'auto', groups: [
    createGroup(1, { fixtureSource: 'library', fixtureModel: 'TL-SL323', libraryChannelCount: 2, fixtureCount: 12 }),
    createGroup(2, { fixtureSource: 'library', fixtureModel: 'TL-SK3101', libraryChannelCount: 2, fixtureCount: 7 }),
    createGroup(3, { fixtureSource: 'library', fixtureModel: 'TL-SL113', fixtureCount: 8 }),
  ] }),
  'audioTool.projects.v1': [{ id: 'dmx-native-qa-1', name: '测试礼堂', createdAt: now, updatedAt: now, recordIds: [] }, { id: 'dmx-native-qa-2', name: '测试会议室', createdAt: now, updatedAt: now, recordIds: [] }],
  'audioTool.storage.schemaVersion': 2,
}
// The official tool requires the existing valid AppID. Isolate storage before any page loads.
// Native UI, 2D nodes, picker/input activation and rendering remain real WeChat APIs.
fs.writeFileSync(path.join(target, 'app.js'), `const qaStore=${JSON.stringify(seed)};\nconst clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));\nApp({onLaunch(){this.__lightingQaStore=qaStore;wx.getStorageSync=k=>clone(qaStore[k]);wx.setStorageSync=(k,v)=>{qaStore[k]=clone(v)};wx.removeStorageSync=k=>{delete qaStore[k]};wx.clearStorageSync=()=>{Object.keys(qaStore).forEach(k=>delete qaStore[k])};wx.getStorageInfoSync=()=>({keys:Object.keys(qaStore),currentSize:0,limitSize:10240});}});\n`)
const metadata = { createdAt: new Date().toISOString(), project: target, isolated: true, appidSource: 'existing project AppID', storage: 'test App bootstrap memory map; native persistent storage is not read or written', sourcePhase: phase, sources: {} }
for (const name of ['dmx-address', 'dmx-layout', 'dmx-layout-landscape']) {
  for (const file of fs.readdirSync(path.join(target, 'pages', name))) {
    const relative = 'pages/' + name + '/' + file
    const full = path.join(target, relative)
    if (fs.statSync(full).isFile()) metadata.sources[relative] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
  }
}
fs.writeFileSync(path.join(__dirname, 'native-' + phase + '-manifest.json'), JSON.stringify(metadata, null, 2))
console.log(JSON.stringify({ project: target, phase, sourceFiles: Object.keys(metadata.sources).length, isolated: true }))

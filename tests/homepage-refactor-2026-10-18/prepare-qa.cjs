'use strict'
// Source-backed browser supplement and isolated official-runtime project.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const old = path.join(__dirname, '../control-protocol-refactor-2026-10-18')
const name = 'homepage-refactor-2026-10-18'
for (const file of ['browser-driver.cjs', 'browser-host.cjs', 'browser.html']) {
  let source = fs.readFileSync(path.join(old, file), 'utf8')
    .replaceAll('control-protocol-refactor-2026-10-18', name)
    .replaceAll('Protocol production', 'Homepage production')
    .replaceAll('tunebuddy-protocol-qa-', 'tunebuddy-homepage-qa-')
  if (file === 'browser-host.cjs') source = source.replace("if (!['pages/control-protocol/detail.js', 'pages/control-protocol/index.js'].includes(entry)) throw Error('Invalid entry')", "if (!/^pages\\/[a-z0-9-]+\\/[a-z0-9-]+\\.js$/.test(entry)) throw Error('Invalid entry')")
  if (file === 'browser.html') source = source.replace('</style>', 'switch{display:inline-flex;position:relative;box-sizing:border-box;width:52px;height:32px;flex-shrink:0;border-radius:18px;background:#c7c7cc;cursor:pointer}switch::after{content:"";position:absolute;left:2px;top:2px;width:28px;height:28px;border-radius:50%;background:white;box-shadow:0 1px 3px #0003}switch[checked="true"]{background:#0066cc}switch[checked="true"]::after{left:22px}switch[disabled]{opacity:.45;cursor:default}button:not([size="mini"]){margin-left:auto;margin-right:auto;width:184px}button[size="mini"]{font-size:13px;line-height:2.3;padding:0 1.34em}</style>')
  fs.writeFileSync(path.join(__dirname, file), source)
}
let runtime = fs.readFileSync(path.join(old, 'browser.js'), 'utf8')
runtime = runtime.slice(0, runtime.indexOf('async function boot()')) + `
async function boot() {
  window.__homepageQa = qa
  const seed = await fetch('/__seed?fixture='+encodeURIComponent(query.get('seed')||'default')).then(r=>r.json())
  for (const [key,value] of Object.entries(seed)) storage.set(key,value)
  const options=Object.fromEntries(query)
  await window.__openPage(query.get('entry') || 'pages/tools/tools.js', options)
}
boot().catch(reportError)
`
runtime = runtime.replace('switchTab:()=>{}', 'switchTab:options=>{events.navigations.push(options.url);options.success?.()}')
// Adapter for native label/switch interaction; production handlers and storage run unchanged.
runtime = runtime.replace("app.addEventListener('click',event=>nativeEvent(event.target,'tap',{x:event.clientX,y:event.clientY}))", "app.addEventListener('click',event=>{const toggle=event.target.closest('switch')||event.target.closest('label')?.querySelector('switch');if(toggle){if(!toggle.hasAttribute('disabled'))nativeEvent(toggle,'change',{value:toggle.getAttribute('checked')!=='true'});return}nativeEvent(event.target,'tap',{x:event.clientX,y:event.clientY})})")
// WXML treats a missing optional data field as undefined, not a JS ReferenceError.
runtime = runtime.replace("Function('scope', `with(scope){return (${expression})}`)(scope)", "Function('scope', `with(scope){return (${expression})}`)(new Proxy(scope,{has:()=>true,get:(target,key)=>key===Symbol.unscopables?undefined:key in target?target[key]:globalThis[key]}))")
runtime = runtime.replace("window.getApp = () => ({ globalData: {theme}, getTheme:()=>theme })", "const qaApp={globalData:{theme},getTheme:()=>theme}; window.getApp=()=>qaApp")
runtime = runtime.replace('window.__answerModal = async confirm =>', 'window.__answerModal = async (confirm,content) =>').replace('options.success?.({confirm,cancel:!confirm});options.complete?.({confirm,cancel:!confirm})', 'options.success?.({confirm,cancel:!confirm,content});options.complete?.({confirm,cancel:!confirm,content})')
runtime = require('./revision-2/browser-runtime-patches.cjs')(runtime)
fs.writeFileSync(path.join(__dirname, 'browser.js'), runtime)
const hostPath = path.join(__dirname, 'browser-host.cjs')
let host = fs.readFileSync(hostPath, 'utf8').replace("if (url.pathname === '/__meta') {", `if (url.pathname === '/__seed') {
      const fixture = url.searchParams.get('fixture') || 'default'
      const seedPath = path.join(__dirname, fixture === 'report-v2' ? 'revision-2/qa-report-seed.cjs' : fixture === 'report' ? 'qa-seed-report.cjs' : 'qa-seed.cjs')
      response.setHeader('Content-Type','application/json')
      const loaded = fs.existsSync(seedPath) ? require(seedPath) : {}
      const seed = fixture === 'report-v2' ? loaded.createReportQaStorage(4) : (loaded.storage || loaded)
      return response.end(JSON.stringify(seed))
    }
    if (url.pathname === '/__meta') {`)
fs.writeFileSync(hostPath, host)
if (process.argv.includes('--browser-only')) process.exit(0)
const externalHost = 'C:/Users/wxx/.codex/visualizations/2026/10/18/01a14dd7-7462-7bc1-a9ac-b00cd5523d7b'
const destination = process.argv.includes('--external-native') ? path.join(externalHost,'homepage-native-qa') : path.join(__dirname, 'native-after')
const hashes = {}
function copy(relative) {
  const source = path.join(root, relative)
  if (!fs.existsSync(source)) return
  if (fs.statSync(source).isDirectory()) {
    for (const name of fs.readdirSync(source)) copy(path.posix.join(relative, name))
    return
  }
  const target = path.join(destination, relative)
  fs.mkdirSync(path.dirname(target), {recursive:true})
  fs.copyFileSync(source, target)
  hashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
}
for (const item of ['pages','utils','data','assets','styles','templates','app.json','app.wxss','theme.json','sitemap.json']) copy(item)
const config = JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8'))
config.projectname = 'TuneBuddy-Homepage-QA'
fs.writeFileSync(path.join(destination,'project.config.json'), JSON.stringify(config,null,2))
const reportV2 = process.argv.includes('--report-v2')
const seedPath = path.join(__dirname, reportV2 ? 'revision-2/qa-report-seed.cjs' : 'qa-seed.cjs')
const loadedSeed = fs.existsSync(seedPath) ? require(seedPath) : {}
const seed = reportV2 ? loadedSeed.createReportQaStorage(4) : loadedSeed
const application = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const persistentQa = process.argv.includes('--persistent-qa')
const storageMode = persistentQa ? 'real wx storage under exclusive QA prefix; seeded once, supports restart checks; owner keys never read or written' : 'isolated in-memory fixture only; no owner persistent data'
const qaPrefix = reportV2 ? '__TuneBuddy_HomeQA_01a14dd7_20261018_revision2__:' : '__TuneBuddy_HomeQA_01a14dd7_20261018__:'
const wrapper = persistentQa ? `// QA-only namespace, excluded from production source.\nconst __qaPrefix=${JSON.stringify(qaPrefix)}\nconst __qaGet=wx.getStorageSync.bind(wx),__qaSet=wx.setStorageSync.bind(wx),__qaRemove=wx.removeStorageSync.bind(wx),__qaInfo=wx.getStorageInfoSync.bind(wx)\nif(__qaGet(__qaPrefix+'initialized')!==1){const seed=${JSON.stringify(seed)};for(const key of Object.keys(seed))__qaSet(__qaPrefix+key,seed[key]);__qaSet(__qaPrefix+'initialized',1)}\nwx.getStorageSync=key=>__qaGet(__qaPrefix+key)\nwx.setStorageSync=(key,value)=>__qaSet(__qaPrefix+key,value)\nwx.removeStorageSync=key=>__qaRemove(__qaPrefix+key)\nwx.getStorageInfoSync=()=>{const info=__qaInfo();return {...info,keys:info.keys.filter(key=>key.startsWith(__qaPrefix)&&key!==__qaPrefix+'initialized').map(key=>key.slice(__qaPrefix.length))}}\n` : `// QA only: owner persistent storage is never read/written.\nconst __qaStore=${JSON.stringify(seed)}\nconst __clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v))\nwx.getStorageSync=key=>__clone(__qaStore[key])\nwx.setStorageSync=(key,value)=>{__qaStore[key]=__clone(value)}\nwx.removeStorageSync=key=>{delete __qaStore[key]}\nwx.getStorageInfoSync=()=>({keys:Object.keys(__qaStore),currentSize:0,limitSize:10240})\n`
fs.writeFileSync(path.join(destination, 'app.js'), wrapper + application)
fs.writeFileSync(path.join(__dirname,'native-after-manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),destination,storage:storageMode,hashes},null,2))
console.log(JSON.stringify({destination,files:Object.keys(hashes).length,storage:storageMode}))

const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {createRuntime}=require('./controller-runtime.cjs')
const root=path.resolve(__dirname,'../..')
const nativeTags=new Set(['view','text','image','input','textarea','button','picker','picker-view','picker-view-column','scroll-view','canvas','block','template','include','import','rich-text','switch','label','navigator','swiper','swiper-item','movable-area','movable-view','cover-view','cover-image'])
const appConfig=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'))
const registeredPages=[...(appConfig.pages||[]),...(appConfig.subPackages||[]).flatMap(pkg=>(pkg.pages||[]).map(page=>path.posix.join(pkg.root,page)))]
assert(!registeredPages.includes('pages/dmx-layout-landscape/dmx-layout-landscape'),'Retired landscape route must stay out of app.json')
assert.equal(fs.existsSync(path.join(root,'pages/dmx-layout-landscape')),false,'Retired landscape page source must stay absent')
for(const [kind,base]of [['main','pages/dmx-address/dmx-address'],['portrait','pages/dmx-layout/dmx-layout'],['landscape','pages/dmx-layout/dmx-layout']]){
  const r=createRuntime();r.seed()
  try{
    const page=r.make(kind),xml=fs.readFileSync(path.join(root,base+'.wxml'),'utf8'),css=fs.readFileSync(path.join(root,base+'.wxss'),'utf8')
    for(const [,tag]of xml.matchAll(/<\/?([a-z][a-z\d-]*)\b/g))assert(nativeTags.has(tag),'Unsupported non-native WXML element '+tag+' in '+base)
    for(const [,method]of xml.matchAll(/\b(?:bind|catch)(?::?[a-z]+)="([a-zA-Z]\w*)"/g))assert.equal(typeof page[method],'function','Unreachable handler '+method+' in '+base)
    for(const [,url]of css.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g))assert(/^(?:data:|https:|wxfile:)/.test(url),'Local WXSS background image must be a native <image>: '+url)
    const json=JSON.parse(fs.readFileSync(path.join(root,base+'.json'),'utf8'));assert.equal(json.navigationStyle,'custom','In-page header duplicated by native navigation')
  }finally{r.dispose()}
}
assert(fs.statSync(path.join(root,'assets/lighting/fixture-types.png')).size<64*1024,'Shared UI sprite grew past the reviewed asset size')
console.log('native-source-contracts: supported WXML, real handlers, image elements and custom navigation passed')

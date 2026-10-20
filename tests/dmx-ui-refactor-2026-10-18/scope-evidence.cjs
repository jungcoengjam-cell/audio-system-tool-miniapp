const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'evidence/scope')
fs.mkdirSync(out,{recursive:true})
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'baseline/sources.json'),'utf8'))
const changed=[],unchanged=[]
for(const [relative,before]of Object.entries(baseline)){
  const file=path.join(root,relative),after=fs.existsSync(file)?hash(file):null
  ;(after===before.sha256?unchanged:changed).push({file:relative,before:before.sha256,after})
}
const entryFiles=['pages/records/project.js','pages/projects/projects.js','pages/products/detail.js']
const entries=entryFiles.map(relative=>{
  const before=path.join(__dirname,'entry-baseline',relative),after=path.join(root,relative)
  const diff=spawnSync('git',['diff','--no-index','--ignore-space-at-eol','--',before,after],{cwd:root,encoding:'utf8',windowsHide:true})
  const name=relative.replaceAll('/','_')+'.diff.txt';fs.writeFileSync(path.join(out,name),diff.stdout||'')
  return{file:relative,before:hash(before),after:hash(after),diff:name}
})
const manifest={}
for(const directory of ['pages/dmx-address','pages/dmx-layout','pages/dmx-layout-landscape']){
  for(const name of fs.readdirSync(path.join(root,directory)))if(/\.(?:js|json|wxml|wxss)$/.test(name))manifest[directory+'/'+name]=hash(path.join(root,directory,name))
}
for(const relative of entryFiles.concat(['assets/lighting/fixture-types.png','tests/audit-dmx-regression.js','tests/dmx-first-use-experience-test.js','tests/dmx-lifecycle-regression.js','tests/dmx-product-import-test.js','tests/package-reclaim/ui-resources.cjs','tests/package-reclaim/ui-test-first.json','tests/release-check.js']))manifest[relative]=hash(path.join(root,relative))
const result={runAt:new Date().toISOString(),baselineChanged:changed,baselineUnchanged:unchanged,entries,manifest}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({baselineChanged:changed.map(item=>item.file),baselineUnchanged:unchanged.length,entryDiffs:entries.map(item=>item.diff),manifestCount:Object.keys(manifest).length}))
if(changed.some(item=>/^(?:utils|data)\//.test(item.file)))throw Error('Protected utility or product source differs from the task baseline')

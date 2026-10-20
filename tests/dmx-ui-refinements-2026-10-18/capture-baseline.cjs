const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'),target=path.join(__dirname,'baseline')
assert(!fs.existsSync(target),'Do not overwrite an existing refinement baseline')
fs.mkdirSync(target,{recursive:true})
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),files={}
const entries=[]
for(const dir of ['pages/dmx-address','pages/dmx-layout','pages/dmx-layout-landscape'])for(const name of fs.readdirSync(path.join(root,dir)))if(/\.(?:js|json|wxml|wxss)$/.test(name))entries.push(dir+'/'+name)
const original=JSON.parse(fs.readFileSync(path.join(root,'tests/dmx-ui-refactor-2026-10-18/baseline/sources.json'),'utf8'))
entries.push(...Object.keys(original).filter(f=>/^(?:utils\/|data\/|pages\/dmx-address\/(?:data\/|utils\/))/.test(f)))
entries.push('project.config.json','app.json','app.wxss','styles/theme-page-shared.wxss','tests/package-reclaim/ui-resources.cjs','tests/package-reclaim/ui-test-first.json','tests/release-check.js')
for(const file of new Set(entries)){const b=fs.readFileSync(path.join(root,file)),out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b);files[file]={sha256:sha(b),bytes:b.length}}
fs.writeFileSync(path.join(__dirname,'baseline-sources.json'),JSON.stringify({createdAt:new Date().toISOString(),files},null,2))
console.log(JSON.stringify({files:Object.keys(files).length,baseline:target}))

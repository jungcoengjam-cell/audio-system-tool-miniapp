const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'),baseline=path.join(__dirname,'baseline'),out=path.join(__dirname,'evidence')
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const changes=[],preserved=[]
for(const dir of ['pages/dmx-address','pages/dmx-layout','pages/dmx-layout-landscape']) {
  for(const name of fs.readdirSync(path.join(root,dir)).filter(n=>/\.(js|json|wxml|wxss)$/.test(n))) {
    const relative=dir+'/'+name,old=path.join(baseline,relative),current=fs.readFileSync(path.join(root,relative))
    const entry={file:relative,before:fs.existsSync(old)?sha(fs.readFileSync(old)):null,after:sha(current)}
    ;(entry.before===entry.after?preserved:changes).push(entry)
  }
}
for(const file of ['pages/dmx-address/group-input.js','pages/dmx-address/result-view.js','pages/dmx-layout/lighting-workspace.js','pages/dmx-layout/layout-model.js','pages/dmx-layout/layout-renderer.js','pages/dmx-layout/layout-storage.js']) {
  const entry=[...preserved,...changes].find(x=>x.file===file)
  assert(entry&&entry.before===entry.after,'Business helper changed during native fixes: '+file)
}
const original=JSON.parse(fs.readFileSync(path.join(root,'tests/dmx-ui-refactor-2026-10-18/baseline/sources.json'),'utf8'))
const protectedFiles=Object.keys(original).filter(f=>/^(?:utils\/|data\/|pages\/dmx-address\/(?:data\/|utils\/|group-input\.js$|result-view\.js$|channel-guide\.js$))/.test(f))
for(const file of protectedFiles)assert.equal(sha(fs.readFileSync(path.join(root,file))),original[file].sha256,'Protected source changed: '+file)
const nativeManifest=JSON.parse(fs.readFileSync(path.join(__dirname,'native-after-manifest.json'),'utf8'))
const nativeDifferences=Object.entries(nativeManifest.sources).filter(([f,h])=>fs.existsSync(path.join(root,f))&&sha(fs.readFileSync(path.join(root,f)))!==h).map(([file])=>file)
const result={runAt:new Date().toISOString(),changes,preserved,protectedFiles,protectedCount:protectedFiles.length,helpersUnchanged:true,nativeManifestDifferences:nativeDifferences}
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'source-audit.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({changed:changes.map(x=>x.file),protectedCount:protectedFiles.length,helpersUnchanged:true,nativeManifestDifferences:nativeDifferences},null,2))

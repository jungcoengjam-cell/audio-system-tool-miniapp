const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),phase=process.argv[2]||'final'
if(!/^[a-z0-9-]+$/.test(phase))throw Error('Invalid evidence label')
const output=path.join(__dirname,'evidence/regressions-'+phase);fs.mkdirSync(output,{recursive:true})
const cases=fs.readdirSync(path.join(root,'tests')).filter(name=>/^(?:dmx-.*|audit-dmx-regression)\.js$/.test(name)).map(name=>'tests/'+name)
cases.push(...['calculation-equivalence.cjs','workspace-helper-test.cjs','layout-migration-test.cjs','layout-canvas-export-test.cjs','layout-interactions-test.cjs','layout-extra-interactions-test.cjs','depth-label-width-test.cjs','layout-annotation-collision-test.cjs','layout-theme-lifecycle-test.cjs','main-interactions-test.cjs','native-source-contracts-test.cjs','browser-parser-test.cjs'].map(name=>'tests/dmx-ui-refactor-2026-10-18/'+name))
cases.push('tests/package-reclaim/ui-resources.cjs')
cases.push(...['calculation-boundary-regression.js','page-lifecycle-regression.js','report-lifecycle-regression.js','records-storage-regression.js'].filter(name=>fs.existsSync(path.join(root,'tests',name))).map(name=>'tests/'+name))
const results=[]
for(const file of cases){
  const result=spawnSync(process.execPath,[file],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024})
  const name=file.replaceAll('/','_');fs.writeFileSync(path.join(output,name+'.stdout.txt'),result.stdout||'');fs.writeFileSync(path.join(output,name+'.stderr.txt'),result.stderr||'')
  const row={file,exitCode:result.status,error:result.error?.message||null};results.push(row);console.log(`${result.status===0?'PASS':'FAIL'} ${file}`)
}
const sources={}
for(const dir of ['pages/dmx-address','pages/dmx-layout','pages/dmx-layout-landscape']){
  for(const name of fs.readdirSync(path.join(root,dir)))if(/\.(?:js|json|wxml|wxss)$/.test(name)){const relative=dir+'/'+name;sources[relative]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex')}
}
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({runAt:new Date().toISOString(),results,sources},null,2))
if(results.some(result=>result.exitCode!==0))process.exitCode=1

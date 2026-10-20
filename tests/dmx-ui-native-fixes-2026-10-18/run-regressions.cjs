const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'evidence/regressions')
fs.mkdirSync(out,{recursive:true})
const cases=fs.readdirSync(path.join(root,'tests')).filter(n=>/^(?:dmx-.*|audit-dmx-regression)\.js$/.test(n)).map(n=>'tests/'+n)
cases.push(...['calculation-equivalence.cjs','workspace-helper-test.cjs','layout-migration-test.cjs','layout-canvas-export-test.cjs','layout-interactions-test.cjs','layout-extra-interactions-test.cjs','depth-label-width-test.cjs','layout-annotation-collision-test.cjs','layout-theme-lifecycle-test.cjs','main-interactions-test.cjs','native-source-contracts-test.cjs','browser-parser-test.cjs'].map(n=>'tests/dmx-ui-refactor-2026-10-18/'+n))
cases.push(...['main-native-structure-test.cjs','layout-canvas-2d-regression-test.cjs'].map(n=>'tests/dmx-ui-native-fixes-2026-10-18/'+n))
cases.push('tests/package-reclaim/ui-resources.cjs','tests/calculation-boundary-regression.js','tests/page-lifecycle-regression.js','tests/report-lifecycle-regression.js')
const results=cases.map(file=>{
  const r=spawnSync(process.execPath,[file],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024})
  const name=file.replaceAll('/','_');fs.writeFileSync(path.join(out,name+'.stdout.txt'),r.stdout||'');fs.writeFileSync(path.join(out,name+'.stderr.txt'),r.stderr||'')
  const row={file,exitCode:r.status,error:r.error?.message||null};console.log(`${r.status===0?'PASS':'FAIL'} ${file}`);return row
})
const sources={}
for(const dir of ['pages/dmx-address','pages/dmx-layout','pages/dmx-layout-landscape'])for(const name of fs.readdirSync(path.join(root,dir)))if(/\.(?:js|json|wxml|wxss)$/.test(name))sources[dir+'/'+name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,dir,name))).digest('hex')
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({runAt:new Date().toISOString(),results,sources},null,2))
if(results.some(r=>r.exitCode!==0))process.exitCode=1

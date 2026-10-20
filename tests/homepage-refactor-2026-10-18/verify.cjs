'use strict'
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'evidence/final-tests')
fs.mkdirSync(out,{recursive:true})
const local=['navigation-basis-behavior.cjs','main-package-dependencies.cjs','interior-view.test.cjs','interior-context.test.cjs','projects-context-lifecycle.cjs','projects-storage-recovery.cjs','storage-adversarial.cjs','report-completeness.cjs','report-runtime-seed.cjs','report-save-ownership.cjs','audit-scope.cjs','audit-tool-surface.cjs','release-controller-related-subset.cjs','compile.cjs']
const targets=local.map(name=>'tests/homepage-refactor-2026-10-18/'+name).concat(['tests/result-project-target-test.js','tests/limiter-project-metadata-test.js','tests/gain-project-metadata-test.js','tests/led-records-regression.js','tests/project-wiring-entry-test.js','tests/calculation-boundary-regression.js','tests/audio-wiring-page-test.js','tests/camera-refactor-2026-10-11/camera-v3-controller-regression.cjs','tests/camera-refactor-2026-10-11/camera-v4-record-metadata-regression.cjs','tests/report-lifecycle-regression.js','tests/release-check.js'])
const results=[]
for(const file of targets){
 const result=spawnSync(process.execPath,[file],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024})
 const name=path.basename(file).replace(/\.(cjs|js)$/,'')
 fs.writeFileSync(path.join(out,name+'.log'),(result.stdout||'')+(result.stderr||''))
 results.push({command:'node '+file,exitCode:result.status,signal:result.signal,status:result.status===0?'PASS':'FAIL',log:'final-tests/'+name+'.log'})
}
const summary={at:new Date().toISOString(),scope:'Source and compiler checks only; no physical-device claims. release-check stops at its first failure.',results}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify(results.map(({command,status})=>({command,status})),null,2))
if(results.some(r=>r.status==='FAIL'))process.exitCode=1

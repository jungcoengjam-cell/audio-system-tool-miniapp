'use strict'
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'evidence/adjacent-tests')
fs.mkdirSync(out,{recursive:true})
const names=['page-lifecycle-regression.js','report-lifecycle-regression.js','calculator-renderer-regression.js','camera-refactor-2026-10-11/camera-v3-controller-regression.cjs','camera-refactor-2026-10-11/camera-v4-ui-markup-regression.cjs','camera-refactor-2026-10-11/camera-v4-record-metadata-regression.cjs','camera-refactor-2026-10-11/camera-v4-actions-regression.cjs','audio-wiring-page-test.js']
const results=names.map(name=>{
 const result=spawnSync(process.execPath,['tests/'+name],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024})
 const log=name.replaceAll('/','--')+'.log'
 fs.writeFileSync(path.join(out,log),(result.stdout||'')+(result.stderr||''))
 return {command:'node tests/'+name,exitCode:result.status,status:result.status===0?'PASS':'FAIL',log}
})
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({at:new Date().toISOString(),results},null,2))
console.log(JSON.stringify(results,null,2))
if(results.some(r=>r.status==='FAIL'))process.exitCode=1

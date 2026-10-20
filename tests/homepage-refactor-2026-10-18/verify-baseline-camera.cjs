'use strict'
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'evidence/baseline-camera-replay')
fs.mkdirSync(out,{recursive:true})
const results=['page-lifecycle-regression.js','camera-refactor-2026-10-11/camera-geometry-regression.cjs','camera-refactor-2026-10-11/camera-v4-ui-markup-regression.cjs'].map(name=>{
 const result=spawnSync(process.execPath,['-r',path.join(__dirname,'replay-baseline.cjs'),'tests/'+name],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024})
 const log=name.replaceAll('/','--')+'.log'
 fs.writeFileSync(path.join(out,log),(result.stdout||'')+(result.stderr||''))
 return {test:name,exitCode:result.status,log}
})
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({at:new Date().toISOString(),kind:'Diagnostic replay against baseline production modules/markup, using current test files. Failure remains a failure; no benchmark updated.',results},null,2))
console.log(JSON.stringify(results,null,2))

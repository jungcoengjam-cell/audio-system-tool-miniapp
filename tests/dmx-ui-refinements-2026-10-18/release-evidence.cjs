const fs=require('node:fs')
const path=require('node:path')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),output=path.join(__dirname,'evidence/release-check')
fs.mkdirSync(output,{recursive:true})
const result=spawnSync(process.execPath,['tests/release-check.js'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:32*1024*1024})
fs.writeFileSync(path.join(output,'stdout.txt'),result.stdout||'');fs.writeFileSync(path.join(output,'stderr.txt'),result.stderr||'')
const summary={runAt:new Date().toISOString(),command:'node tests/release-check.js',exitCode:result.status,error:result.error?.message||null,passed:result.status===0}
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));console.log((result.stderr||result.stdout||'').slice(0,2400))
if(result.status!==0)process.exitCode=1

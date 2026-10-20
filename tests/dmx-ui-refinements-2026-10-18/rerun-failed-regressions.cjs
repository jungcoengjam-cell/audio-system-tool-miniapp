// Re-run only failed cases after a narrow test-harness repair. Preserve first-run logs.
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'evidence/regressions'),file=path.join(out,'summary.json')
const summary=JSON.parse(fs.readFileSync(file,'utf8'))
summary.firstRunAt=summary.firstRunAt||summary.runAt
for(const row of summary.results.filter(r=>r.exitCode!==0)){
  const name=row.file.replaceAll('/','_')
  for(const channel of ['stdout','stderr']){
    const log=path.join(out,name+'.'+channel+'.txt'),backup=path.join(out,name+'.first-run.'+channel+'.txt')
    if(!fs.existsSync(backup)&&fs.existsSync(log))fs.copyFileSync(log,backup)
  }
  const previous={exitCode:row.exitCode,error:row.error,at:summary.runAt}
  const result=spawnSync(process.execPath,[row.file],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024})
  fs.writeFileSync(path.join(out,name+'.stdout.txt'),result.stdout||'');fs.writeFileSync(path.join(out,name+'.stderr.txt'),result.stderr||'')
  row.previousRuns=[...(row.previousRuns||[]),previous]
  row.exitCode=result.status;row.error=result.error?.message||null;row.retriedAt=new Date().toISOString()
  row.testSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,row.file))).digest('hex')
  console.log(`${result.status===0?'PASS':'FAIL'} rerun ${row.file}`)
}
summary.finalizedAt=new Date().toISOString()
fs.writeFileSync(file,JSON.stringify(summary,null,2))
console.log(`${summary.results.filter(r=>r.exitCode===0).length}/${summary.results.length} related regression scripts passed`)
if(summary.results.some(r=>r.exitCode!==0))process.exitCode=1

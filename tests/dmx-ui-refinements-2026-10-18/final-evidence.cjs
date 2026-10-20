const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'evidence')
const read=relative=>JSON.parse(fs.readFileSync(path.join(out,relative),'utf8'))
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const audit=read('source/audit.json'),compile=read('compile/compile.json'),regressions=read('regressions/summary.json'),browser=read('browser/results-all.json'),exportEvidence=read('export/summary.json'),release=read('release-check/summary.json'),calculations=read('calculation-equivalence.json')
for(const [relative,row]of Object.entries(audit.files))assert.equal(sha(path.join(root,relative)),row.sha256,'Final source changed after audit: '+relative)
for(const [relative,row]of Object.entries(audit.testMigrations))assert.equal(sha(path.join(root,relative)),row.sha256,'Reviewed test migration changed: '+relative)
for(const [relative,hash]of Object.entries(compile.sources))assert.equal(sha(path.join(root,relative)),hash,'Compiled source changed: '+relative)
for(const [relative,hash]of Object.entries(regressions.sources))assert.equal(sha(path.join(root,relative)),hash,'Regression source changed: '+relative)
assert(compile.results.every(r=>r.exitCode===0&&!r.error))
assert(regressions.results.every(r=>r.exitCode===0&&!r.error))
assert(browser.results.every(r=>r.passed))
assert(exportEvidence.results.every(r=>r.passed))
assert(calculations.passed&&audit.protectedUnchanged&&audit.failures.length===0)
const production=audit.allowedProduction.map(relative=>({path:relative,...audit.files[relative]}))
const pngs=exportEvidence.results.map(({direction,file,width,height,bytes,sha256,fixtureCount,drawnAddressCount})=>{
  assert.equal(sha(file),sha256,'Export PNG changed after pixel verification')
  return{direction,file,width,height,bytes,sha256,fixtureCount,drawnAddressCount}
})
const summary={
  runAt:new Date().toISOString(),sourceBaselineAt:audit.baselineAt,
  production,productionByteDelta:production.reduce((sum,row)=>sum+row.bytes-row.beforeBytes,0),
  compiledSourcesMatchCurrent:true,regressionSourcesMatchCurrent:true,sourceAuditMatchCurrent:true,
  officialCompilation:compile.results.map(({name,exitCode,error})=>({name,exitCode,error})),
  relatedRegressionScripts:{passed:regressions.results.filter(r=>r.exitCode===0).length,total:regressions.results.length,targetedReruns:regressions.results.filter(r=>r.previousRuns?.length).map(r=>({file:r.file,previousRuns:r.previousRuns,finalExitCode:r.exitCode}))},
  browserFlows:{passed:browser.results.length,total:browser.results.length,screenshots:browser.scenes.filter(s=>s.file).length,profiles:browser.profiles,nativeRuntime:false,physicalDevice:false},
  rawDiagramPng:{passed:pngs.length,total:pngs.length,pngs},
  calculations:{engineCases:calculations.cases,workspaceCases:calculations.workspaceCases,totalCases:calculations.cases+calculations.workspaceCases,protectedEngineAndDataFiles:calculations.protectedFiles.length,engineSha256:calculations.engineSha256},
  protectedUnchanged:audit.protectedCount,testMigrations:audit.testMigrations,
  releaseCheck:release,nativeRuntime:'NOT RUN - user owns native acceptance',physicalDevice:'NOT RUN - user owns device acceptance',
}
fs.writeFileSync(path.join(out,'final-summary.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify({relatedRegressionScripts:summary.relatedRegressionScripts,browserFlows:summary.browserFlows,rawDiagramPng:{passed:pngs.length,total:pngs.length},calculations:summary.calculations,protectedUnchanged:summary.protectedUnchanged,productionByteDelta:summary.productionByteDelta,releaseCheck:release},null,2))

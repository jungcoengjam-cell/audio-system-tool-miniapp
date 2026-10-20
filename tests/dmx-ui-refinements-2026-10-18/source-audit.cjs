const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'evidence/source')
const baseline=require('./baseline-sources.json')
const allowedProduction=[
  'pages/dmx-address/dmx-address.js','pages/dmx-address/dmx-address.wxml','pages/dmx-address/dmx-address.wxss',
  'pages/dmx-layout/page-factory.js','pages/dmx-layout/layout-renderer.js','pages/dmx-layout/dmx-layout.wxml','pages/dmx-layout/dmx-layout.wxss',
  'pages/dmx-layout-landscape/dmx-layout-landscape.wxml','pages/dmx-layout-landscape/dmx-layout-landscape.wxss',
]
const allowedTestMigrations=['tests/package-reclaim/ui-resources.cjs','tests/package-reclaim/ui-test-first.json','tests/dmx-ui-refactor-2026-10-18/layout-canvas-export-test.cjs','tests/dmx-ui-native-fixes-2026-10-18/layout-canvas-2d-regression-test.cjs','tests/dmx-ui-native-fixes-2026-10-18/main-native-structure-test.cjs','tests/dmx-search-lifecycle-regression.js']
const allowed=new Set([...allowedProduction,...allowedTestMigrations]),files={},changes=[],failures=[]
fs.mkdirSync(out,{recursive:true})
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
for(const [relative,old]of Object.entries(baseline.files)){
  const source=path.join(root,relative),exists=fs.existsSync(source),bytes=exists?fs.readFileSync(source):Buffer.alloc(0),hash=exists?sha(bytes):null
  const row={sha256:hash,bytes:bytes.length,beforeSha256:old.sha256,beforeBytes:old.bytes,unchanged:hash===old.sha256,allowed:allowed.has(relative)}
  files[relative]=row
  if(!row.unchanged){
    changes.push(relative)
    if(!row.allowed)failures.push(relative+' changed outside this round scope')
    const diff=spawnSync('git',['diff','--no-index','--no-ext-diff','--',path.join(__dirname,'baseline',relative),source],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024})
    fs.writeFileSync(path.join(out,relative.replaceAll('/','_')+'.diff'),diff.stdout||diff.stderr||'')
  }
}
for(const dir of ['pages/dmx-address','pages/dmx-layout','pages/dmx-layout-landscape'])for(const name of fs.readdirSync(path.join(root,dir)))if(/\.(?:js|json|wxml|wxss)$/.test(name)&&!Object.hasOwn(baseline.files,dir+'/'+name))failures.push('Unexpected new production file '+dir+'/'+name)
const testMigrations={}
for(const relative of allowedTestMigrations){
  const before=path.join(__dirname,Object.hasOwn(baseline.files,relative)?'baseline':'baseline/test-migrations',relative)
  const source=path.join(root,relative),bytes=fs.readFileSync(source),oldBytes=fs.readFileSync(before)
  testMigrations[relative]={beforeSha256:sha(oldBytes),sha256:sha(bytes),beforeBytes:oldBytes.length,bytes:bytes.length}
  const diff=spawnSync('git',['diff','--no-index','--no-ext-diff','--',before,source],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024})
  fs.writeFileSync(path.join(out,relative.replaceAll('/','_')+'.diff'),diff.stdout||diff.stderr||'')
}
const summary={runAt:new Date().toISOString(),baselineAt:baseline.createdAt,allowedProduction,allowedTestMigrations,changes,protectedCount:Object.values(files).filter(f=>!f.allowed).length,protectedUnchanged:Object.values(files).filter(f=>!f.allowed).every(f=>f.unchanged),files,testMigrations,failures}
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify({changes,protectedCount:summary.protectedCount,protectedUnchanged:summary.protectedUnchanged,failures},null,2))
assert.deepEqual(failures,[],'Only authorized presentation files and narrow resource test migrations may change')

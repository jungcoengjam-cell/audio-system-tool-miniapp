// Re-run the established exhaustive cases against this round's frozen baseline.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..')
const original=require('./baseline/utils/dmx-address.js')
const current=require('../../utils/dmx-address.js')
const {dmxFixtures}=require('../../data/stage-lighting.js')
const workspace=require('../../pages/dmx-layout/lighting-workspace.js')
const baseline=require('./baseline-sources.json').files
const protectedFiles=Object.keys(baseline).filter(relative=>/^(?:utils\/|data\/|pages\/dmx-address\/(?:data\/|utils\/|group-input\.js$|result-view\.js$|channel-guide\.js$))/.test(relative))
for(const relative of protectedFiles)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex'),baseline[relative].sha256,'Protected source changed: '+relative)
let cases=0,workspaceCases=0
function compare(options){assert.deepEqual(current.calculateDmxAddressPlan(options),original.calculateDmxAddressPlan(options));cases++}
for(const fixture of dmxFixtures)for(const mode of fixture.channelModes)for(const startAddress of [1,497,512])for(const allocationMode of ['auto','manual']){
  const groups=[{id:'fixture',name:fixture.name,fixtureModel:fixture.model,channelCount:mode,fixtureCount:4,targetUniverse:'B'}]
  compare({startAddress,allocationMode,groups})
  const scheme=workspace.createLightingScheme({startAddressText:String(startAddress),allocationMode,groups:groups.map(group=>({...group,fixtureSource:'library'}))})
  const actual=workspace.calculateScheme(scheme)
  const expected=original.calculateDmxAddressPlan({startAddress,allocationMode,groups:groups.map((group,index)=>({...group,id:scheme.groupIds[index]}))})
  if(expected.error)assert.equal(actual.error,expected.error)
  else{
    const strip=value=>JSON.parse(JSON.stringify(value,(key,item)=>['stableId','valid'].includes(key)?undefined:item))
    assert.deepEqual(strip(actual.result),expected)
    assert.equal(new Set(actual.result.fixtures.map(item=>item.stableId)).size,expected.totalFixtures)
  }
  workspaceCases++
}
for(const startAddress of ['',0,-1,1,500,512,513,1.5,'x'])for(const channelCount of [0,1,25,128,512,513])for(const fixtureCount of [0,1,4,200,201])for(const allocationMode of ['auto','manual'])compare({startAddress,allocationMode,groups:[{name:'Boundary',channelCount,fixtureCount,targetUniverse:'D'}]})
const summary={runAt:new Date().toISOString(),passed:true,cases,workspaceCases,protectedFiles,engineSha256:baseline['utils/dmx-address.js'].sha256}
fs.mkdirSync(path.join(__dirname,'evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'evidence/calculation-equivalence.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify({passed:true,cases,workspaceCases,protectedCount:protectedFiles.length,engineSha256:summary.engineSha256}))

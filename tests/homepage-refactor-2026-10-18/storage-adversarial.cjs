'use strict'
// Independent acceptance probes: fail closed and preserve the owner's raw data.
const assert=require('node:assert/strict')
const recordsPath=require.resolve('../../utils/records')
const keys={schema:'audioTool.storageSchemaVersion',projects:'audioTool.projects.v1',records:'audioTool.records.v1',favorites:'audioTool.favorites.v1',journal:'audioTool.storageMigrationJournal.v1'}
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x))
function setup(overrides={}){
 const initial={
  [keys.schema]:3,
  [keys.projects]:[{id:'p-one',name:'Owner project',createdAt:100,updatedAt:200}],
  [keys.records]:[{id:'owner-record',module:'spl',title:'Owner result',preferences:{distance:'9'},resultText:'Saved result 81 dB',summary:'81 dB',signature:JSON.stringify(['spl',{distance:'9'}]),favorite:true,projectIds:['p-one'],createdAt:110,updatedAt:210}],
  ...overrides,
 }
 const storage=new Map(Object.entries(clone(initial)))
 let failKey=''
 global.wx={getStorageSync:key=>clone(storage.get(key)),setStorageSync:(key,value)=>{if(key===failKey)throw Error('Injected storage quota');storage.set(key,clone(value))},removeStorageSync:key=>{if(key===failKey)throw Error('Injected remove failure');storage.delete(key)}}
 delete require.cache[recordsPath]
 return {api:require(recordsPath),storage,initial,fail:key=>{failKey=key}}
}
const results=[]
function check(name,run){try{run();results.push({name,status:'PASS'})}catch(error){results.push({name,status:'FAIL',error:error.stack})}}
check('migration preserves IDs and historical payloads, is idempotent, and separates snapshots',()=>{
 const {api,storage,initial}=setup()
 assert.equal(api.getWorkspaceSnapshot({forceRefresh:true}).ok,true)
 const migrated=clone(Object.fromEntries(storage))
 const projectRecord=api.getProjectRecords('p-one').find(r=>r.id==='owner-record')
 const favorite=api.getFavorites().find(r=>r.id==='owner-record')
 assert.ok(projectRecord);assert.ok(favorite)
 for(const field of ['id','preferences','resultText','createdAt','updatedAt']){assert.deepEqual(projectRecord[field],initial[keys.records][0][field]);assert.deepEqual(favorite[field],initial[keys.records][0][field])}
 api.getWorkspaceSnapshot({forceRefresh:true})
 assert.deepEqual(Object.fromEntries(storage),migrated)
 assert.ok(api.saveRecord({...projectRecord,preferences:{distance:'12'},resultText:'Edited 78 dB'},{recordId:projectRecord.id,projectId:'p-one'}))
 assert.equal(api.getFavorites()[0].resultText,'Saved result 81 dB')
})
check('future schema refuses mutation without overwriting raw owner state',()=>{
 const fixture=setup({[keys.schema]:99})
 const before=clone(Object.fromEntries(fixture.storage))
 assert.equal(fixture.api.getWorkspaceSnapshot({forceRefresh:true}).ok,false)
 assert.equal(fixture.api.createProject('Must not be created'),null)
 assert.deepEqual(Object.fromEntries(fixture.storage),before)
})
check('malformed current projects cannot be normalized to empty then overwritten',()=>{
 const fixture=setup({[keys.schema]:4,[keys.projects]:{unexpected:'owner data'},[keys.favorites]:[]})
 const before=clone(Object.fromEntries(fixture.storage))
 assert.equal(fixture.api.createProject('Must not replace corrupt data'),null)
 assert.deepEqual(Object.fromEntries(fixture.storage),before)
})
check('malformed current favorites cannot be replaced by a new snapshot',()=>{
 const fixture=setup({[keys.schema]:4,[keys.favorites]:{unexpected:'owner snapshot'}})
 const before=clone(Object.fromEntries(fixture.storage))
 assert.equal(fixture.api.saveFavoriteSnapshot({module:'spl',preferences:{distance:'1'},resultText:'new',title:'new'}),null)
 assert.deepEqual(Object.fromEntries(fixture.storage),before)
})
check('migration write failure retains raw copy and retries to one record and snapshot',()=>{
 const fixture=setup()
 fixture.fail(keys.records)
 assert.equal(fixture.api.getWorkspaceSnapshot({forceRefresh:true}).ok,false)
 assert.deepEqual(fixture.storage.get(keys.records),fixture.initial[keys.records])
 assert.deepEqual(fixture.storage.get(keys.projects),fixture.initial[keys.projects])
 fixture.fail('')
 const result=fixture.api.getWorkspaceSnapshot({forceRefresh:true})
 assert.equal(result.ok,true)
 assert.equal(result.records.filter(r=>r.id==='owner-record').length,1)
 assert.equal(result.favorites.filter(r=>r.id==='owner-record').length,1)
})
check('migration backup restoration remains usable after an explicit migration error',()=>{
 const fixture=setup()
 assert.equal(fixture.api.getWorkspaceSnapshot({forceRefresh:true}).ok,true)
 const backups=fixture.api.getStorageMigrationBackups()
 assert.equal(backups.ok,true);assert.ok(backups.backups.length)
 fixture.storage.set(keys.journal,{version:123,backupId:'bad'})
 assert.equal(fixture.api.getWorkspaceSnapshot({forceRefresh:true}).ok,false)
 assert.equal(fixture.api.restoreStorageMigrationBackup(backups.backups[0].id),true)
 assert.deepEqual(fixture.storage.get(keys.records),fixture.initial[keys.records])
})
console.log(JSON.stringify({runAt:new Date().toISOString(),results},null,2))
if(results.some(r=>r.status!=='PASS'))process.exitCode=1

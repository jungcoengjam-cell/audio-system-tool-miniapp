const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRuntime } = require('./runtime.cjs')
const checks = []
async function test(name, task) { try { const evidence=await task();checks.push({name,passed:true,evidence});console.log('PASS '+name) } catch(error) {checks.push({name,passed:false,error:error.stack});console.error('FAIL '+name+' '+error.message)} }
async function main() {
  for(const [name,options] of [['legacy-api-throws',{systemInfoThrows:true}],['legacy-api-absent',{systemInfoAbsent:true}],['legacy-disagrees',{systemTheme:'light'}]]) await test('dark cold-start resolves getAppBaseInfo when '+name,async()=>{
    const env=createRuntime({theme:'dark',baseTheme:'dark',...options});env.page();const state=env.snapshot()
    assert.ok(state.data.projectWheelMaskStyle.includes('#121212'));assert.equal(env.events.navigationColors.at(-1).frontColor,'#ffffff')
    await env.dispatch('requestProjectPicker');await env.dispatch('onProjectWheelChange',{}, {value:[1]});const candidate=env.snapshot().data.pendingProjectId
    await env.dispatch('onResize');assert.equal(env.snapshot().data.pendingProjectId,candidate);assert.deepEqual(env.snapshot().data.wheelProjectIndex,[1]);assert.ok(env.snapshot().data.projectWheelMaskStyle.includes('#121212'))
    env.theme('light');assert.ok(env.snapshot().data.projectWheelMaskStyle.includes('#ffffff'));env.theme('dark');assert.ok(env.snapshot().data.projectWheelMaskStyle.includes('#121212'))
    return{mask:env.snapshot().data.projectWheelMaskStyle,candidate,wheelHeight:env.snapshot().data.projectWheelHeight}
  })
  await test('resize preserves shared length and partial pair draft',async()=>{const env=createRuntime({theme:'dark'});env.page();await env.dispatch('openNewLine');await env.dispatch('onDraftInput',{field:'lengthText'},{value:'5'});await env.dispatch('onPairInput',{index:0,field:'fromPort'},{value:'PRESERVED OUT'});const before=env.snapshot();await env.dispatch('onResize');const after=env.snapshot();assert.deepEqual(after.data.draftPairs,before.data.draftPairs);assert.equal(after.data.draft.lengthText,'5');assert.deepEqual(after.schedule,before.schedule);return{pairs:after.data.draftPairs,length:after.data.draft.lengthText}})
  const output=path.join(__dirname,'evidence/native-fix-2026-10-16');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'functional-checks.json'),JSON.stringify({runAt:new Date().toISOString(),isolatedWxRuntime:true,nativeRuntime:false,checks},null,2));if(checks.some(item=>!item.passed))process.exitCode=1
}
main().catch(error=>{console.error(error);process.exitCode=1})

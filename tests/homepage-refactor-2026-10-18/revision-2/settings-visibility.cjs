'use strict'
const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'../../..')
const registry=require(path.join(root,'utils/tool-registry'))
const visibility=require(path.join(root,'utils/tool-visibility'))
const storage=new Map(),toasts=[];let modal=null,failWrite=false,failRead=false
global.getApp=()=>({globalData:{primaryNavigation:{restoreChecked:true}}})
global.wx={
 getStorageSync:key=>{if(failRead&&key===visibility.TOOL_VISIBILITY_KEY)throw Error('read');return storage.get(key)},
 setStorageSync:(key,value)=>{if(failWrite&&key===visibility.TOOL_VISIBILITY_KEY)throw Error('quota');storage.set(key,JSON.parse(JSON.stringify(value)))},
 removeStorageSync:key=>storage.delete(key),showToast:value=>toasts.push(value),showModal:value=>{modal=value},vibrateShort(){},
}
function page(relative){let definition;global.Page=value=>{definition=value};const file=path.join(root,relative);delete require.cache[require.resolve(file)];require(file);const result={...definition,data:JSON.parse(JSON.stringify(definition.data))};result.setData=(next,callback)=>{Object.assign(result.data,next);callback?.()};return result}
const tools=page('pages/tools/tools.js'),settings=page('pages/settings/settings.js')
const preserved=[['audioTool.projects.v1',[{id:'kept-project'}]],['audioTool.records.v1',[{id:'kept-record'}]],['audioTool.favorites.v1',[{id:'kept-favorite'}]],['audioTool.dmxLightingWorkspace.v2',{id:'kept-lighting'}],['audioTool.activeProject.v1','kept-legacy-id'],['audioTool.audioWiring.preferences',{face:'mating'}]]
preserved.forEach(([key,value])=>storage.set(key,value));const before=JSON.stringify(preserved)
settings.onShow();tools.onShow();assert.equal(settings.data.toolRows.length,registry.TOOLS.length);assert.equal(tools.data.tools.length,registry.TOOLS.length)
const change=(id,value)=>settings.onToolVisibilityChange({currentTarget:{dataset:{id}},detail:{value}})
change('camera',false);tools.onShow();assert(!tools.data.tools.some(tool=>tool.id==='camera'));assert(!settings.data.toolRows.find(tool=>tool.id==='camera').visible)
const restartedTools=page('pages/tools/tools.js');restartedTools.onShow();assert(!restartedTools.data.tools.some(tool=>tool.id==='camera'),'hide survives page recreation')
tools.onCategoryTap({currentTarget:{dataset:{category:'视频'}}});assert.deepEqual(tools.data.tools.map(tool=>tool.id),['ledScreen'])
change('camera',true);tools.onShow();assert(tools.data.tools.some(tool=>tool.id==='camera'),'settings change is reflected when returning')
for(const tool of registry.TOOLS)change(tool.id,false)
tools.onCategoryTap({currentTarget:{dataset:{category:'全部'}}});assert.equal(tools.data.tools.length,0);assert.equal(typeof tools.openSettings,'function')
failWrite=true;const oldRaw=JSON.stringify(storage.get(visibility.TOOL_VISIBILITY_KEY));change('camera',true);assert.equal(JSON.stringify(storage.get(visibility.TOOL_VISIBILITY_KEY)),oldRaw);assert(!settings.data.toolRows.find(tool=>tool.id==='camera').visible);assert.match(toasts.at(-1).title,/失败/);failWrite=false
assert.equal(visibility.setToolVisible('unknown-tool',true),false)
storage.set(visibility.TOOL_VISIBILITY_KEY,{version:2,hiddenToolIds:['camera']});assert.equal(visibility.readToolVisibility().ok,false);assert.equal(visibility.setToolVisible('camera',true),false);tools.onShow();assert(tools.data.visibilityError);assert.equal(tools.data.tools.length,registry.TOOLS.length,'storage failure keeps tools usable and warns')
failRead=true;settings.onShow();assert(settings.data.visibilityError);failRead=false
const originalKeys=['limiter','spl','cable','camera','ledScreen','gainStructure','dmxAddress'].map(id=>`audioTool.${id}.preferences`)
originalKeys.forEach(key=>storage.set(key,{keptUntilConfirm:true}));settings.resetPreferences();modal.success({confirm:false});assert(storage.has(originalKeys[0]));assert(storage.has(visibility.TOOL_VISIBILITY_KEY))
settings.resetPreferences();modal.success({confirm:true});assert(originalKeys.every(key=>!storage.has(key)));assert(!storage.has(visibility.TOOL_VISIBILITY_KEY));assert(settings.data.toolRows.every(tool=>tool.visible));assert.equal(toasts.at(-1).icon,'success')
assert.equal(JSON.stringify(preserved.map(([key])=>[key,storage.get(key)])),before,'visibility and reset never alter project/favorite/result/lighting/legacy-active/audio wiring data')
console.log('settings visibility PASS: persistent hide/show, category filtering, all-hidden recovery, write/read failure, future-version refusal, reset cancel/confirm and data isolation')
